"""Add PeeringDB colocation facilities, and derive tenancy.

PeeringDB is the interconnection industry's own facility registry. It matters
here for two reasons:

  rows     5,860 facilities, 5,256 geolocated. Only ~34% overlap the OSM set,
           so it roughly doubles the location count.
  tenancy  `net_count` is how many distinct networks are present in a
           facility. That is direct evidence of multi-tenancy - Equinix
           Ashburn reports 511 networks, a hyperscaler self-build reports
           none - and it is the only public source for a column the rest of
           the pipeline has zero coverage on.

Runs AFTER epoch.py and manual.py. epoch.py writes facilities_osm_epoch.csv,
manual.py folds any hand-added sites into facilities_with_manual.csv; this
reads whichever is present,
appends what PeeringDB adds, and owns the final facilities_global.csv. Keeping
one writer per file avoids a stage silently dropping another stage's rows.

Note what PeeringDB does NOT give: `available_voltage_services` is populated on
only 9% and is rack-level (48 VDC, 480 VAC), not facility capacity, so it does
not answer "how much power can the utility deliver".

Source: https://www.peeringdb.com (CC-BY-4.0).
"""

from __future__ import annotations

import collections
import csv
import json
import math
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CACHE = RAW / "peeringdb_fac.json"
# manual.py folds hand-added sites in between epoch.py and here, so prefer its
# output when it exists. Falling back keeps the chain working for anyone who
# has never added one.
_WITH_MANUAL = ROOT / "data" / "facilities_with_manual.csv"
SRC = _WITH_MANUAL if _WITH_MANUAL.exists() else ROOT / "data" / "facilities_osm_epoch.csv"
OUT = ROOT / "data" / "facilities_global.csv"

API = "https://www.peeringdb.com/api/fac"
UA = {"User-Agent": "reinsurance_dc-research/1.0 (data centre registry research)"}

# Same radius epoch.py uses for OSM<->Epoch: enough to bridge a geocoded point
# against a building centroid without merging neighbouring campuses.
DEDUPE_KM = 0.5

# Colocation providers lease space to many customers by business model, so a
# facility they run is multi-tenant even when PeeringDB reports no networks.
COLO = ("equinix", "digital realty", "digital bridge", "cyrusone", "qts",
        "coresite", "iron mountain", "vantage", "stack", "aligned", "databank",
        "flexential", "cologix", "tierpoint", "switch", "cyxtera", "centersquare",
        "edgeconnex", "ntt", "telehouse", "interxion", "global switch", "colt",
        "rackspace", "zayo", "lumen", "sungard", "evoque", "netrality", "dataspan")
# Operators that build for their own workloads. Their sites are single-tenant
# unless something says otherwise.
HYPERSCALE = ("google", "alphabet", "meta", "facebook", "amazon", "aws",
              "microsoft", "apple", "oracle", "xai", "spacexai", "openai",
              "bytedance", "tencent", "alibaba", "baidu", "tesla")


def fetch(force: bool = False) -> list[dict]:
    if CACHE.exists() and not force:
        return json.loads(CACHE.read_text()).get("data", [])
    req = urllib.request.Request(API, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r:
        payload = json.loads(r.read().decode("utf-8", "replace"))
    RAW.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(payload))
    return payload.get("data", [])


def classify(operator: str, net_count, users: str = "") -> tuple[str, str]:
    """Return (tenancy, basis). Basis records why, so the call is auditable."""
    op = " ".join(str(operator or "").lower().split())
    nc = net_count if isinstance(net_count, int) else 0
    if nc > 1:
        return ("multi", f"peeringdb net_count={nc}")
    if any(c in op for c in COLO):
        return ("multi", "colocation operator")
    # Epoch names the workloads running at a site; more than one distinct user
    # means more than one tenant even on a self-built campus.
    tenants = {u.strip().lower() for u in str(users or "").split(",") if u.strip()}
    if len(tenants) > 1:
        return ("multi", f"epoch users={len(tenants)}")
    if any(h in op for h in HYPERSCALE):
        return ("single", "hyperscale self-build")
    if nc == 1:
        return ("single", "peeringdb net_count=1")
    return ("", "")


def km(lon_a, lat_a, lon_b, lat_b) -> float:
    return math.hypot((lon_a - lon_b) * 111.32 * math.cos(math.radians((lat_a + lat_b) / 2)),
                      (lat_a - lat_b) * 111.32)


def main() -> None:
    if not SRC.exists():
        raise SystemExit("run `python3 epoch.py` first (writes facilities_osm_epoch.csv)")
    rows = list(csv.DictReader(SRC.open()))
    pdb = [f for f in fetch() if f.get("latitude") and f.get("longitude")]
    print(f"existing: {len(rows)}   peeringdb geolocated: {len(pdb)}")

    # Coarse grid so dedupe is not 4.7k x 5.3k brute force.
    grid = collections.defaultdict(list)
    for i, r in enumerate(rows):
        if r.get("lat"):
            grid[(round(float(r["lon"]), 2), round(float(r["lat"]), 2))].append(i)

    def nearest(lon: float, lat: float) -> int | None:
        best, bd = None, DEDUPE_KM
        for dx in (-0.01, 0.0, 0.01):
            for dy in (-0.01, 0.0, 0.01):
                for i in grid.get((round(lon + dx, 2), round(lat + dy, 2)), []):
                    r = rows[i]
                    d = km(lon, lat, float(r["lon"]), float(r["lat"]))
                    if d < bd:
                        best, bd = i, d
        return best

    cols = list(rows[0].keys())
    EXTRA = ("tenancy", "tenancy_basis", "networks_present", "pdb_id", "pdb_org",
             "geo_precision", "needs_review")
    for extra in EXTRA:
        if extra not in cols:
            cols.append(extra)
    for r in rows:
        for extra in EXTRA:
            r.setdefault(extra, "")

    enriched = added = 0
    for f in pdb:
        lon, lat = float(f["longitude"]), float(f["latitude"])
        nc = f.get("net_count")
        i = nearest(lon, lat)
        if i is not None:
            r = rows[i]
            r["networks_present"] = nc if isinstance(nc, int) else ""
            r["pdb_id"], r["pdb_org"] = f.get("id", ""), f.get("org_name", "")
            if not r.get("operator"):
                r["operator"] = f.get("org_name", "")
            if not r.get("city"):
                r["city"] = f.get("city", "")
            enriched += 1
        else:
            new = {c: "" for c in cols}
            new.update({
                "facility_type": "traditional", "source": "peeringdb",
                "name": f.get("name", ""), "operator": f.get("org_name", ""),
                "country": f.get("country", ""), "lat": round(lat, 6), "lon": round(lon, 6),
                "city": f.get("city", ""), "address": f.get("address1", ""),
                "networks_present": nc if isinstance(nc, int) else "",
                "pdb_id": f.get("id", ""), "pdb_org": f.get("org_name", ""),
                # PeeringDB rows are per-facility records with their own
                # address and coordinate, not a place lookup.
                "geo_precision": "exact",
                # A listing with no networks, no IXs and no carriers has no
                # evidence of being an operating interconnection facility. A
                # stratified sample of 18 (src note: 6 per activity band) found
                # 4 of 6 such rows were not data centres at all - a gravel pit
                # marketed as a future site, a never-commissioned build, a
                # reseller's own office, an ISP whose licence was revoked in
                # 2015 - against 0 of 12 in the two active bands.
                #
                # Flagged, never dropped: the same sample found a TIA-942 and
                # ISO 27001 certified hall in here whose operator simply never
                # registered its peering. This marks a review queue.
                "needs_review": "no_interconnection" if not (
                    (f.get("net_count") or 0) or (f.get("ix_count") or 0)
                    or (f.get("carrier_count") or 0)) else "",
            })
            rows.append(new)
            added += 1

    for r in rows:
        r["tenancy"], r["tenancy_basis"] = classify(
            r.get("operator", ""), r.get("networks_present") or 0, r.get("users", ""))

    with OUT.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    ten = collections.Counter(r["tenancy"] or "unknown" for r in rows)
    print(f"\nwrote {OUT.relative_to(ROOT)}  ({len(rows)} facilities)")
    print(f"  peeringdb enriched an existing row : {enriched}")
    print(f"  peeringdb added a new location     : {added}")
    print(f"  tenancy: " + "  ".join(f"{k}={v}" for k, v in ten.most_common()))
    known = len(rows) - ten["unknown"]
    print(f"  tenancy resolved: {known}/{len(rows)} ({known / len(rows):.0%})")


if __name__ == "__main__":
    main()
