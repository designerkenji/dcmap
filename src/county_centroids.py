#!/usr/bin/env python3
"""Centre and bounding box for every county the power filings name.

Why this exists: a hundred substations in the dependency ledger have a name
from a filing and no coordinate, and three of them carry 3.2 GW. Placing one by
hand needs a map to open somewhere sensible, and the only "where" those records
hold is the county the filing puts them in. This resolves those county names to
a centre and a box, once, offline, into data/county_centroids.json.

It is deliberately NOT a geocoder for substations. A county centroid is never a
substation's position and this file never writes one onto a substation record -
it decides where a map opens, and a person still has to say where the thing is.

Nominatim, one request a second, cached by county. 38 counties today, so the
whole run is well inside any reasonable use of the service, and the cache means
a rerun asks for nothing it already has.

Usage:
    python3 src/county_centroids.py            # fill in what is missing
    python3 src/county_centroids.py --force    # re-fetch everything
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SUBS = ROOT / "data" / "substations.json"
OUT = ROOT / "data" / "county_centroids.json"

UA = "reinsurance-dc/1.0 (data-centre registry; county centroid lookup)"
ENDPOINT = "https://nominatim.openstreetmap.org/search"

# The states the ledger covers. A bare county name is ambiguous across the US -
# there are Franklin counties in 24 states - so the region always goes in the
# query and the result is rejected if it comes back from another one.
STATES = {"NY": "New York", "VA": "Virginia"}


def canon(county: str) -> str:
    """'St. Lawrence' and 'St Lawrence' are one county.

    The filings spell it both ways, and treating them as two would ask for two
    lookups and then disagree with itself about where St Lawrence County is.
    """
    c = county.strip()
    c = re.sub(r"\bSt\.?\s+", "St ", c, flags=re.I)
    c = re.sub(r"\s+", " ", c)
    c = re.sub(r"\s+County$", "", c, flags=re.I)
    return c.title()


def key(region: str, county: str) -> str:
    return f"{region}|{canon(county)}"


def fetch(region: str, county: str) -> dict | None:
    q = f"{canon(county)} County, {STATES.get(region, region)}, USA"
    url = ENDPOINT + "?" + urllib.parse.urlencode(
        {"q": q, "format": "jsonv2", "limit": 2, "polygon_geojson": 0})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as fh:
        hits = json.load(fh)

    for h in hits:
        # Must actually BE a county, and be in the state we asked about.
        # Nominatim will happily return a village of the same name.
        if h.get("addresstype") not in {"county", "administrative"}:
            continue
        name = h.get("display_name", "")
        if STATES.get(region, region) not in name:
            continue
        bb = [float(x) for x in h["boundingbox"]]     # s, n, w, e
        return {
            "region": region,
            "county": canon(county),
            "lat": round(float(h["lat"]), 6),
            "lon": round(float(h["lon"]), 6),
            # The box is what sets the zoom: a map opened on a county's centre
            # at a fixed zoom shows the wrong amount of ground for Loudoun and
            # for St Lawrence, which differ by a factor of nine in area.
            "bbox": [round(bb[2], 6), round(bb[0], 6), round(bb[3], 6), round(bb[1], 6)],
            "osm": f"{h.get('osm_type', '')[:1]}{h.get('osm_id', '')}",
            "display": name,
        }
    return None


def main() -> None:
    force = "--force" in sys.argv
    if not SUBS.exists():
        sys.exit(f"missing {SUBS.relative_to(ROOT)} - run src/power_deps.py first")

    subs = json.loads(SUBS.read_text())
    wanted: dict[str, tuple[str, str]] = {}
    for s in subs:
        for c in s.get("counties") or []:
            if c.strip():
                wanted[key(s.get("region", ""), c)] = (s.get("region", ""), c)

    have = {}
    if OUT.exists() and not force:
        try:
            have = {key(r["region"], r["county"]): r for r in json.loads(OUT.read_text())}
        except Exception:  # noqa: BLE001
            have = {}

    todo = [v for k, v in wanted.items() if k not in have]
    print(f"{len(wanted)} counties named by the filings · {len(have)} cached · "
          f"{len(todo)} to fetch")

    found = missed = 0
    for i, (region, county) in enumerate(todo):
        if i:
            time.sleep(1.1)          # Nominatim's published limit is 1/sec
        try:
            rec = fetch(region, county)
        except Exception as exc:     # noqa: BLE001
            print(f"  {county} ({region}): {exc}")
            missed += 1
            continue
        if not rec:
            print(f"  {county} ({region}): no county-level match")
            missed += 1
            continue
        have[key(region, county)] = rec
        found += 1
        print(f"  {rec['county']} ({region}) -> {rec['lat']}, {rec['lon']}")

    rows = sorted(have.values(), key=lambda r: (r["region"], r["county"]))
    OUT.write_text(json.dumps(rows, indent=1) + "\n")
    print(f"\nwrote {OUT.relative_to(ROOT)}  ({len(rows)} counties, "
          f"{found} new, {missed} unresolved)")


if __name__ == "__main__":
    main()
