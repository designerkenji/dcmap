"""Merge Epoch AI's AI Data Centers dataset into the OSM facility registry.

Two datasets, deliberately kept distinguishable rather than blended:

  OSM (4,653)  physical data centre buildings worldwide. Answers "where".
  Epoch (75)   AI compute sites with real facility power, H100-equivalents,
               capital cost and named energy companies. Answers "how big".

The output tags every row `facility_type` = ai | traditional, so an AI site can
be filtered in or out rather than silently averaged into a building count.

Joining is by geography, because the two sources share no identifier and only
4 of 75 Epoch names match the GPU-cluster dataset worldmonitor ships. Epoch
gives a street address and no coordinates, so addresses are geocoded once via
Nominatim and cached.

Source: Epoch AI, 'AI Data Centers', https://epoch.ai/data/ai-data-centers
(CC-BY). Cite Epoch AI when redistributing these rows.
"""

from __future__ import annotations

import csv
import json
import math
import pathlib
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
EPOCH_DIR = ROOT / "data_centers_from_EPOCH_AI"
OSM_CSV = ROOT / "data" / "osm_world_by_country.csv"
GEOCACHE = ROOT / "data" / "raw" / "epoch_geocode.json"
# Intermediate: peeringdb.py consumes this and owns facilities_global.csv.
OUT = ROOT / "data" / "facilities_osm_epoch.csv"

UA = {"User-Agent": "reinsurance_dc-research/1.0 (data centre registry research)"}
NOMINATIM = "https://nominatim.openstreetmap.org/search"

# Epoch coordinates come from a geocoded street address, OSM's from a building
# polygon, so they disagree by a few hundred metres on the same site. 2 km is
# wide enough to bridge that without merging neighbouring campuses - Ashburn
# has distinct operators inside 2 km, so anything larger would over-merge.
MATCH_KM = 2.0

# Proximity alone is not evidence of identity. Ashburn, Council Bluffs and New
# Albany all pack several operators' buildings inside 2 km, so a distance-only
# join produced "Amazon IAD90 = Google Arcola" and matched a Union Pacific
# office to Google Omaha. A pair must also agree on who runs it.
OPERATOR_ALIASES = {
    "amazon": {"amazon", "aws", "amazon web services", "vadata", "anthropic"},
    "google": {"google", "alphabet"},
    "meta": {"meta", "facebook"},
    "microsoft": {"microsoft", "msft", "openai"},
    "xai": {"xai", "spacexai", "x ai"},
    "oracle": {"oracle"},
    "qts": {"qts", "quality technology services"},
    "stack": {"stack", "stack infrastructure"},
    "coreweave": {"coreweave"},
    "equinix": {"equinix"},
    "digital realty": {"digital realty", "digital"},
    "vantage": {"vantage"},
    "cyrusone": {"cyrusone"},
    "switch": {"switch"},
    "crusoe": {"crusoe"},
    "nebius": {"nebius"},
    "lambda": {"lambda"},
    "iren": {"iren"},
    "cipher": {"cipher"},
    "applied digital": {"applied digital"},
}


def op_key(value: str) -> set:
    """Canonical operator tokens for a free-text owner/operator string."""
    v = " ".join(str(value or "").lower().replace(",", " ").split())
    if not v:
        return set()
    keys = {canon for canon, alts in OPERATOR_ALIASES.items()
            if any(a in v for a in alts)}
    return keys or {v}


def operators_agree(osm_operator: str, osm_name: str, epoch_owner: str, epoch_name: str) -> bool:
    """True when the two records plausibly describe the same organisation.

    Checks owner against operator *and* against the site names, because OSM
    frequently leaves `operator` blank while naming the building after its
    tenant ("Amazon IAD90").
    """
    a = op_key(osm_operator) | op_key(osm_name)
    b = op_key(epoch_owner) | op_key(epoch_name)
    return bool(a & b)


def num(v) -> float:
    try:
        return float(str(v).replace(",", "").strip() or 0)
    except ValueError:
        return 0.0


def clean(v) -> str:
    """Strip Epoch's inline confidence tags, preserving comma structure.

    Epoch annotates values as 'Anthropic #confident, Cursor #confident'. The
    tags are whitespace-delimited but the commas attach to them, so dropping
    '#'-prefixed tokens wholesale also drops the separators and collapses a
    three-tenant list into one opaque string - which silently destroyed the
    multi-tenancy signal on every AI row. Split on commas FIRST, then de-tag
    each item.
    """
    items = []
    for part in str(v or "").split(","):
        words = [w for w in part.split() if not w.startswith("#")]
        item = " ".join(words).strip()
        if item:
            items.append(item)
    return ", ".join(items)


def _coarse(addr: str) -> str:
    """Drop the street line, keep town/state/postcode.

    Nominatim has no house number for most greenfield builds - 26 of 65 Epoch
    addresses fail on the full string but resolve at town level, which is well
    inside the 2 km match radius anyway.
    """
    parts = [p.strip() for p in addr.split(",") if p.strip()]
    return ", ".join(parts[1:]) if len(parts) > 2 else addr


def _query(q: str) -> dict | None:
    qs = urllib.parse.urlencode({"q": q, "format": "json", "limit": 1})
    req = urllib.request.Request(f"{NOMINATIM}?{qs}", headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read().decode("utf-8", "replace"))
    if not d:
        return None
    return {"lat": float(d[0]["lat"]), "lon": float(d[0]["lon"]),
            "kind": d[0].get("type", ""), "precision": "exact"}


def geocode(addresses: list[str]) -> dict:
    cache = json.loads(GEOCACHE.read_text()) if GEOCACHE.exists() else {}
    todo = [a for a in addresses if a and a not in cache]
    if todo:
        print(f"  geocoding {len(todo)} new addresses (1/sec, Nominatim policy)...")
    for i, addr in enumerate(todo, 1):
        hit = None
        try:
            hit = _query(addr)
        except Exception as e:  # noqa: BLE001 - public service, keep going
            print(f"    [{i}/{len(todo)}] error: {addr[:46]} ({e})")
        if hit is None:
            time.sleep(1.1)
            coarse = _coarse(addr)
            if coarse != addr:
                try:
                    hit = _query(coarse)
                    if hit:
                        hit["precision"] = "town"
                except Exception:  # noqa: BLE001
                    pass
        cache[addr] = hit
        time.sleep(1.1)
        if i % 10 == 0:
            GEOCACHE.write_text(json.dumps(cache, indent=1))
    GEOCACHE.parent.mkdir(parents=True, exist_ok=True)
    GEOCACHE.write_text(json.dumps(cache, indent=1))
    return cache


def km(lon_a, lat_a, lon_b, lat_b) -> float:
    return math.hypot((lon_a - lon_b) * 111.32 * math.cos(math.radians((lat_a + lat_b) / 2)),
                      (lat_a - lat_b) * 111.32)


COUNTRY_ISO2 = {
    "united states": "US", "united states of america": "US", "china": "CN",
    "united kingdom": "GB", "malaysia": "MY", "indonesia": "ID",
    "portugal": "PT", "canada": "CA", "germany": "DE", "france": "FR",
    "japan": "JP", "india": "IN", "ireland": "IE", "netherlands": "NL",
    "singapore": "SG", "australia": "AU", "brazil": "BR", "norway": "NO",
    "sweden": "SE", "finland": "FI", "denmark": "DK", "spain": "ES",
    "italy": "IT", "poland": "PL", "israel": "IL", "south korea": "KR",
    "saudi arabia": "SA", "united arab emirates": "AE", "qatar": "QA",
    "switzerland": "CH", "mexico": "MX", "chile": "CL",
}


def iso2(value: str) -> str:
    v = " ".join(str(value or "").strip().split())
    if len(v) == 2:
        return v.upper()
    return COUNTRY_ISO2.get(v.lower(), v)


# `Current power (MW)` in data_centers.csv is IT load, verified: it equals the
# timelines' `IT power (MW)` on all 75 sites, while the timelines' `Power (MW)`
# is 1.19-1.40x higher. The utility delivers the larger one, so never let a
# column called just "power_mw" stand in for facility load.
# `geo_precision` records how well the coordinate is known: "exact" when the
# geocoder resolved a building or street address, "town" when it fell back to
# a settlement or administrative area. That distinction matters twice over -
# a town-level point should not be drawn as if surveyed, and it must not be
# clustered as if it were, or the same project lands twice in the registry
# (OpenAI Stargate UAE did: the Al Dhafrah region centroid put it 221 km from
# its own OSM record, and both survived deduplication).
COLUMNS = ["facility_type", "source", "name", "epoch_name", "operator", "country", "lat", "lon",
           "geo_precision",
           "power_mw_it", "h100_equivalents", "chip_types", "users", "energy_companies",
           "capex_usd_bn", "address", "ref", "city", "utility", "osm_id", "matched_osm"]


def main() -> None:
    epoch_rows = list(csv.DictReader((EPOCH_DIR / "data_centers.csv").open(encoding="utf-8-sig")))
    osm_rows = [r for r in csv.DictReader(OSM_CSV.open()) if r.get("lat")]
    print(f"epoch AI sites: {len(epoch_rows)}   osm facilities: {len(osm_rows)}")

    coords = geocode([(r.get("Address") or "").strip() for r in epoch_rows])
    located = sum(1 for r in epoch_rows if coords.get((r.get("Address") or "").strip()))
    print(f"  geocoded: {located}/{len(epoch_rows)}")

    osm_pts = [(float(r["lon"]), float(r["lat"]), r) for r in osm_rows]

    # Score every candidate pair, then assign greedily nearest-first so each
    # Epoch site and each OSM building is used at most once. Keying a dict on
    # osm_id instead lets a second Epoch site overwrite the first and vanish.
    pairs = []
    unmatched: list[tuple[dict, dict | None]] = []
    for ei, e in enumerate(epoch_rows):
        c = coords.get((e.get("Address") or "").strip())
        if not c:
            unmatched.append((e, None))
            continue
        for lon, lat, r in osm_pts:
            d = km(c["lon"], c["lat"], lon, lat)
            if d >= MATCH_KM:
                continue
            if not operators_agree(r.get("operator", ""), r.get("name", ""),
                                   e.get("Owner", ""), e.get("Name", "")):
                continue
            pairs.append((d, ei, r["osm_id"]))
    pairs.sort(key=lambda t: t[0])
    ai_osm_ids: dict[str, dict] = {}
    taken_epoch: set[int] = set()
    for _d, ei, oid in pairs:
        if ei in taken_epoch or oid in ai_osm_ids:
            continue
        ai_osm_ids[oid] = epoch_rows[ei]
        taken_epoch.add(ei)
    for ei, e in enumerate(epoch_rows):
        if ei in taken_epoch:
            continue
        c = coords.get((e.get("Address") or "").strip())
        if c and not any(u[0] is e for u in unmatched):
            unmatched.append((e, c))

    rows = []
    for r in osm_rows:
        e = ai_osm_ids.get(r["osm_id"])
        rows.append({
            "facility_type": "ai" if e else "traditional",
            "source": "osm+epoch" if e else "osm",
            "name": r.get("name") or (clean(e["Name"]) if e else ""),
            "epoch_name": clean(e["Name"]) if e else "",
            # On an AI match prefer Epoch's owner: OSM often names the landlord
            # or leaves operator blank, and the AI attribution is the point here.
            "operator": (clean(e.get("Owner")) or r.get("operator", "")) if e else r.get("operator", ""),
            "country": r.get("country", ""),
            "lat": r["lat"], "lon": r["lon"], "geo_precision": "exact",
            "power_mw_it": num(e.get("Current power (MW)")) or "" if e else "",
            "h100_equivalents": int(num(e.get("Current H100 equivalents"))) or "" if e else "",
            "chip_types": clean(e.get("Current chip types")) if e else "",
            "users": clean(e.get("Users")) if e else "",
            "energy_companies": clean(e.get("Energy companies")) if e else "",
            "capex_usd_bn": num(e.get("Current total capital cost (2025 USD billions)")) or "" if e else "",
            "address": clean(e.get("Address")) if e else "",
            "ref": r.get("ref", ""), "city": r.get("addr_city", ""),
            "utility": "", "osm_id": r["osm_id"],
            "matched_osm": "yes" if e else "",
        })

    # Epoch sites with no OSM building nearby are real facilities OSM has not
    # mapped - mostly 2025/26 greenfield builds. Dropping them would understate
    # exactly the fastest-growing part of the fleet.
    for e, c in unmatched:
        rows.append({
            "facility_type": "ai", "source": "epoch",
            "name": clean(e["Name"]), "epoch_name": clean(e["Name"]),
            "operator": clean(e.get("Owner")),
            "country": iso2(e.get("Country", "")),
            "lat": round(c["lat"], 6) if c else "", "lon": round(c["lon"], 6) if c else "",
            "geo_precision": (c.get("precision") or "") if c else "",
            "power_mw_it": num(e.get("Current power (MW)")) or "",
            "h100_equivalents": int(num(e.get("Current H100 equivalents"))) or "",
            "chip_types": clean(e.get("Current chip types")),
            "users": clean(e.get("Users")),
            "energy_companies": clean(e.get("Energy companies")),
            "capex_usd_bn": num(e.get("Current total capital cost (2025 USD billions)")) or "",
            "address": clean(e.get("Address")),
            "ref": "", "city": "", "utility": "", "osm_id": "", "matched_osm": "",
        })

    # Virginia utility enrichment, where the registry already resolved it.
    reg = ROOT / "data" / "registry.csv"
    if reg.exists():
        util = {}
        for r in csv.DictReader(reg.open()):
            if r.get("lat") and r.get("utility"):
                util.setdefault((round(float(r["lon"]), 3), round(float(r["lat"]), 3)), r["utility"])
        for row in rows:
            if row["lat"]:
                row["utility"] = util.get((round(float(row["lon"]), 3), round(float(row["lat"]), 3)), "")

    with OUT.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)

    ai = [r for r in rows if r["facility_type"] == "ai"]
    merged = [r for r in rows if r["source"] == "osm+epoch"]
    mw = sum(num(r["power_mw_it"]) for r in ai)
    print(f"\nwrote {OUT.relative_to(ROOT)}  ({len(rows)} facilities)")
    print(f"  traditional : {len(rows) - len(ai)}")
    print(f"  ai          : {len(ai)}   ({len(merged)} matched an OSM building, "
          f"{len(ai) - len(merged)} Epoch-only)")
    print(f"  AI IT load  : {mw:,.0f} MW across {sum(1 for r in ai if num(r['power_mw_it']))} sites")


if __name__ == "__main__":
    main()
