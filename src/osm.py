"""Pull data centers from OpenStreetMap via Overpass, for any region.

OSM is the only source in this project with global coverage: 4,138 features
carry telecom=data_center worldwide. It is also the best public source for
operator - county records name the title holder, usually an SPV, while OSM
names the operating brand - and it carries `ref`, the industry facility code
(AWS IAD69, NTT VA7, Equinix LC10) that appears in no government record.

Usage:
    python3 osm.py            # US-VA (default)
    python3 osm.py US-TX      # any ISO3166-2 subdivision
    python3 osm.py DE         # any ISO3166-1 country
    python3 osm.py world      # everything, ~4.1k features

Crowd-sourced, so treat it as corroboration, not authority. Coverage is
uneven and a missing feature is not evidence of absence - it skews toward
well-known campuses in well-mapped countries.
"""

from __future__ import annotations

import csv
import json
import pathlib
import datetime
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
RAW.mkdir(parents=True, exist_ok=True)

# Mirrors are NOT interchangeable, and the failure mode is silent.
#   - overpass-api.de is the reference instance and tracks minutely. It
#     rate-limits and 504s under load, but its data is current.
#   - kumi.systems stays up when .de is refusing, but was observed serving a
#     2026-06-01 planet snapshot on 2026-07-26 - eight weeks stale, which
#     dropped 44 of 389 Virginia features (11%) with no error of any kind.
#   - overpass.osm.ch is a Switzerland-only extract. It answers a Virginia
#     query with total=0, which reads as "none exist" rather than "not
#     covered", so it is excluded entirely rather than used as a fallback.
# Order is freshest-first; STALE_DAYS makes a stale answer loud.
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
STALE_DAYS = 14

# Overpass rejects a raw POST body with 406: the query must be form-encoded
# under `data=`, and the request needs a User-Agent.
SELECTORS = ['nwr["telecom"="data_center"]{area};',
             'nwr["building"="data_center"]{area};',
             'nwr["man_made"="data_center"]{area};',
             'nwr["landuse"="data_center"]{area};']

FIELDS = ["region", "osm_type", "osm_id", "name", "operator", "ref", "building",
          "telecom", "addr_street", "addr_city", "addr_country", "levels",
          "website", "lon", "lat"]


def build_query(region: str) -> str:
    """Region is 'world', an ISO3166-1 country, or an ISO3166-2 subdivision."""
    region = region.strip()
    if region.lower() in ("world", "global", "all"):
        area_def, area_ref = "", ""
    else:
        key = "ISO3166-2" if "-" in region else "ISO3166-1"
        area_def = f'area["{key}"="{region.upper()}"]->.a;'
        area_ref = "(area.a)"
    body = "\n  ".join(s.replace("{area}", area_ref) for s in SELECTORS)
    return f"[out:json][timeout:600];\n{area_def}\n(\n  {body}\n);\nout tags center;\n"


def snapshot_age_days(payload: dict) -> float | None:
    """Days between the mirror's planet snapshot and now, if reported."""
    ts = (payload.get("osm3s") or {}).get("timestamp_osm_base")
    if not ts:
        return None
    try:
        t = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None
    return (datetime.datetime.utcnow() - t).total_seconds() / 86400


def run(query: str, retries: int = 2) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for attempt in range(retries):
        for ep in ENDPOINTS:
            try:
                req = urllib.request.Request(
                    ep, data=body,
                    headers={"User-Agent": "reinsurance_dc-research/1.0",
                             "Content-Type": "application/x-www-form-urlencoded"})
                with urllib.request.urlopen(req, timeout=600) as r:
                    payload = json.loads(r.read().decode("utf-8", "replace"))
                age = snapshot_age_days(payload)
                payload["_endpoint"] = ep
                payload["_snapshot_age_days"] = age
                if age is not None and age > STALE_DAYS:
                    print(f"  WARNING {ep.split('/')[2]} snapshot is "
                          f"{age:.0f} days old - features added since are absent")
                return payload
            except Exception as e:  # noqa: BLE001
                last = f"{ep.split('/')[2]}: {e}"
                print(f"  {last}")
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"all Overpass mirrors failed - last: {last}")


def cache_path(region: str) -> pathlib.Path:
    return RAW / f"osm_{region.lower().replace('-', '_')}.json"


def fetch(region: str = "US-VA", force: bool = False) -> dict:
    dest = cache_path(region)
    if dest.exists() and not force:
        return json.loads(dest.read_text())
    payload = run(build_query(region))
    dest.write_text(json.dumps(payload))
    return payload


def rows(payload: dict, region: str) -> list[dict]:
    out = []
    for e in payload.get("elements", []):
        t = e.get("tags") or {}
        c = e.get("center") or {"lat": e.get("lat"), "lon": e.get("lon")}
        if not c.get("lat"):
            continue
        out.append({
            "region": region.upper(), "osm_type": e["type"], "osm_id": e["id"],
            "name": t.get("name", ""), "operator": t.get("operator", ""),
            "ref": t.get("ref", ""), "building": t.get("building", ""),
            "telecom": t.get("telecom", ""),
            "addr_street": t.get("addr:street", ""), "addr_city": t.get("addr:city", ""),
            "addr_country": t.get("addr:country", ""),
            "levels": t.get("building:levels", ""), "website": t.get("website", ""),
            "lon": round(c["lon"], 6), "lat": round(c["lat"], 6),
        })
    return out


def load(region: str = "US-VA") -> list[dict]:
    """Rows with coordinates, for use as an operator lookup by other scripts."""
    return rows(fetch(region), region)


def main() -> None:
    region = sys.argv[1] if len(sys.argv) > 1 else "US-VA"
    try:
        payload = fetch(region, force=True)
    except Exception as e:  # noqa: BLE001
        # A refresh failure must not destroy a working local copy.
        if not cache_path(region).exists():
            raise
        print(f"  refresh failed ({e}); using cached {cache_path(region).name}")
        payload = fetch(region)
    data = rows(payload, region)
    slug = region.lower().replace("-", "_")
    dest = ROOT / "data" / ("osm_datacenters.csv" if region.upper() == "US-VA"
                            else f"osm_{slug}.csv")
    with dest.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=FIELDS)
        w.writeheader()
        w.writerows(data)
    n = len(data) or 1
    op = sum(1 for r in data if r["operator"])
    rf = sum(1 for r in data if r["ref"])
    age = payload.get("_snapshot_age_days")
    print(f"wrote {dest.relative_to(ROOT)}  ({len(data)} features, region={region.upper()})")
    print(f"  source         : {(payload.get('_endpoint') or '?').split('/')[2]}"
          + (f"  snapshot {age:.1f}d old" if age is not None else ""))
    print(f"  operator tagged: {op}/{len(data)} ({op / n:.0%})")
    print(f"  ref tagged     : {rf}/{len(data)} ({rf / n:.0%})")


if __name__ == "__main__":
    main()
