"""Build a PJM zone layer for worldmonitor from utility service territories.

PJM publishes new large-load MW by zone (Table B-9b, parsed in pjm_load.py)
but does not distribute transmission-zone shapefiles - zone boundaries are
CEII. PJM zones are however defined by their member utility, so a utility
retail service territory is a close stand-in and one is public nationally.

Sub-areas are drawn separately rather than dissolved into their parent zone.
The DOM zone alone contains Dominion, NOVEC, REC and ODEC, and co-ops cross
50% of new large load there around 2030 - collapsing them into one polygon
would erase the single most useful thing the PJM data says.

Two caveats the output cannot fix:
  - Territory polygons overlap (~42% of Virginia sites fall inside two), so
    adjacent fills will visibly overlap at boundaries.
  - A retail territory is not a transmission zone. Close, not identical.
"""

from __future__ import annotations

import collections
import csv
import json
import math
import pathlib
import urllib.parse
import urllib.request

from ercot_zones import rings_of, simplify

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOAD = ROOT / "data" / "pjm_large_load.csv"
GLOBAL = ROOT / "data" / "facilities_global.csv"
CACHE = ROOT / "data" / "raw" / "pjm_zone_geom.geojson"
OUT_TS = ROOT / "worldmonitor" / "src" / "config" / "pjm-zones.ts"
OUT_CSV = ROOT / "data" / "pjm_zone_summary.csv"

TERRITORIES = ("https://services6.arcgis.com/BAJNi3EgCdtQ1BCG/arcgis/rest/services/"
               "Electric_Retail_Service_Territories/FeatureServer/0")

# PJM area code -> the retail utility whose territory approximates it.
# ODEC is a generation & transmission co-op that owns no retail territory; its
# load sits inside its member distribution co-ops, so it has no polygon.
AREA_TO_UTILITY = {
    "AEPOHIO": "OHIO POWER CO",
    "BGE": "BALTIMORE GAS & ELECTRIC CO",
    "COMED": "COMMONWEALTH EDISON CO",
    "DAY": "DAYTON POWER & LIGHT CO",
    # Recovered once the B-9b parser stopped discarding zones whose only row
    # carries no AREANAME. HIFLD abbreviates Jersey Central as "LT CO".
    "DLCO": "DUQUESNE LIGHT CO",
    "JCPL": "JERSEY CENTRAL POWER & LT CO",
    "METED": "METROPOLITAN EDISON CO",
    "DEOK": "DUKE ENERGY OHIO INC",
    "DOM": "VIRGINIA ELECTRIC & POWER CO",
    "IM": "INDIANA MICHIGAN POWER CO",
    "NVEC": "NORTHERN VIRGINIA ELEC COOP",
    "OHIO": "OHIO EDISON CO",
    "PE": "THE POTOMAC EDISON COMPANY",
    "PECO": "PECO ENERGY CO",
    "PEPCO": "POTOMAC ELECTRIC POWER CO",
    "PP": "PENNSYLVANIA POWER CO",
    "PPL": "PPL ELECTRIC UTILITIES CORP",
    "PSEG": "PUBLIC SERVICE ELEC & GAS CO",
    "REC": "RAPPAHANNOCK ELECTRIC COOP",
    "SMECO": "SOUTHERN MARYLAND ELEC COOP INC",
    "WPP": "WEST PENN POWER COMPANY",
}
NO_TERRITORY = {"ODEC"}

EPSILON_DEG = 0.01
YEARS = (2026, 2030, 2035, 2046)


def num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def fetch_geometry() -> dict:
    if CACHE.exists():
        return json.loads(CACHE.read_text())
    feats = []
    for area, name in AREA_TO_UTILITY.items():
        q = urllib.parse.urlencode({
            "where": f"NAME='{name}'", "outFields": "NAME,TYPE,CUSTOMERS",
            "returnGeometry": "true", "outSR": "4326", "f": "geojson"})
        req = urllib.request.Request(f"{TERRITORIES}/query?{q}",
                                     headers={"User-Agent": "reinsurance_dc-research/1.0"})
        with urllib.request.urlopen(req, timeout=180) as r:
            d = json.loads(r.read().decode("utf-8", "replace"))
        got = d.get("features") or []
        if not got:
            print(f"  MISS {area:<9} {name}")
            continue
        # Pick the largest by customers; a few utilities appear once per state.
        best = max(got, key=lambda f: (f.get("properties") or {}).get("CUSTOMERS") or 0)
        best.setdefault("properties", {})["pjm_area"] = area
        feats.append(best)
        print(f"  ok   {area:<9} {name}")
    payload = {"type": "FeatureCollection", "features": feats}
    CACHE.write_text(json.dumps(payload))
    return payload


def main() -> None:
    load = collections.defaultdict(dict)
    for r in csv.DictReader(LOAD.open()):
        load[r["area"]][int(r["year"])] = num(r["mw"])

    print("resolving PJM areas to utility territories:")
    geo_fc = fetch_geometry()
    have = {(f.get("properties") or {}).get("pjm_area") for f in geo_fc["features"]}
    missing = sorted(set(AREA_TO_UTILITY) - have)
    if missing:
        print(f"  unresolved: {missing}")
    print(f"  no retail territory by design: {sorted(NO_TERRITORY)}")

    # Facility counts per territory, using the same polygons we will draw.
    import geo as geomod
    idx = geomod.PolygonIndex(geo_fc, "pjm_area")
    counts = collections.defaultdict(collections.Counter)
    for r in csv.DictReader(GLOBAL.open()):
        if not r.get("lat"):
            continue
        for hit in idx.find_all(float(r["lon"]), float(r["lat"])):
            c = counts[hit["name"]]
            c["sites"] += 1
            if r["facility_type"] == "ai":
                c["ai_sites"] += 1

    with OUT_CSV.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n",
                           fieldnames=["area", "utility", "sites", "ai_sites"]
                                      + [f"mw_{y}" for y in YEARS])
        w.writeheader()
        for area in sorted(AREA_TO_UTILITY):
            c = counts.get(area, collections.Counter())
            w.writerow({"area": area, "utility": AREA_TO_UTILITY[area],
                        "sites": c["sites"], "ai_sites": c["ai_sites"],
                        **{f"mw_{y}": round(load.get(area, {}).get(y, 0)) for y in YEARS}})
    print(f"wrote {OUT_CSV.relative_to(ROOT)}")

    peak = max((load.get(a, {}).get(2046, 0) for a in AREA_TO_UTILITY), default=1) or 1
    feats, before, after = [], 0, 0
    for f in geo_fc["features"]:
        p = f.get("properties") or {}
        area = p.get("pjm_area")
        rings = []
        for r in rings_of(f.get("geometry")):
            before += len(r)
            s = simplify([tuple(pt[:2]) for pt in r], EPSILON_DEG)
            if len(s) >= 4:
                after += len(s)
                rings.append([[round(x, 4), round(y, 4)] for x, y in s])
        if not rings:
            continue
        c = counts.get(area, collections.Counter())
        mw = {y: round(load.get(area, {}).get(y, 0)) for y in YEARS}
        feats.append({
            "id": f"pjm-{area.lower()}", "area": area,
            "name": f"PJM {area}", "utility": AREA_TO_UTILITY[area],
            "sites": c["sites"], "aiSites": c["ai_sites"],
            "mw2026": mw[2026], "mw2035": mw[2035], "mw2046": mw[2046],
            "share": round(mw[2046] / peak, 3),
            "rings": rings,
        })
    print(f"  vertices {before:,} -> {after:,} ({after / before:.1%})")

    body = ",\n".join(
        "  { " + ", ".join([
            f"id: '{x['id']}'", f"area: '{x['area']}'", f"name: '{x['name']}'",
            "utility: " + json.dumps(x["utility"]),
            f"sites: {x['sites']}", f"aiSites: {x['aiSites']}",
            f"mw2026: {x['mw2026']}", f"mw2035: {x['mw2035']}", f"mw2046: {x['mw2046']}",
            f"share: {x['share']}",
            "rings: " + json.dumps(x["rings"], separators=(",", ":")),
        ]) + " }" for x in sorted(feats, key=lambda z: -z["mw2046"]))

    OUT_TS.parent.mkdir(parents=True, exist_ok=True)
    OUT_TS.write_text(
        "import type { PjmZone } from '@/types';\n\n"
        "// PJM zones, approximated by member utility retail service territory.\n"
        "//\n"
        "// PJM does not publish transmission-zone shapefiles (CEII), but each\n"
        "// zone is defined by its member utility and retail territories are\n"
        "// public. MW figures are PJM's own new-large-load adjustments\n"
        "// (Table B-9b); site counts are from this project's registry.\n"
        "//\n"
        "// Sub-areas are separate polygons on purpose: the DOM zone contains\n"
        "// Dominion, NOVEC, REC and ODEC, and co-ops cross 50% of new large\n"
        "// load there around 2030. ODEC is a G&T co-op with no retail\n"
        "// territory, so it has no polygon.\n"
        "//\n"
        "// Caveat: retail territories overlap, so adjacent fills overlap too.\n"
        "// Simplified with Douglas-Peucker at 0.01 deg.\n"
        "// Generated by src/pjm_zones.py. Do not edit.\n\n"
        "export const PJM_ZONES: PjmZone[] = [\n" + body + ",\n];\n")
    print(f"wrote {OUT_TS.relative_to(ROOT)}  ({len(feats)} zones, "
          f"{OUT_TS.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
