"""Build a NYISO load-zone layer.

New York settles against eleven load zones, A-K, and unlike ERCOT it publishes
a per-zone forecast that isolates large loads: the Gold Book (Load & Capacity
Data) carries a large-load block separate from baseline demand. That makes this
the third market where the map can show an operator's own number rather than
only our registry's dots - PJM via Table B-9b, and now NYISO.

Per-zone site counts here are computed from this project's own registry by
point-in-polygon. Zone J is New York City and zone K is Long Island, which is
where the state's colocation stock concentrates; the upstate zones (A-E) are
where new large load is actually being proposed, because that is where the
transmission headroom and the hydro/nuclear supply sit.

Geometry is NOT simplified. The raw layer is already small, and Douglas-Peucker
at the 0.01 deg used elsewhere pushes Manhattan carrier hotels across the
zone J boundary - the zones here are small and dense enough that boundary
precision decides assignment, unlike the state-sized ERCOT and PJM polygons.
"""

from __future__ import annotations

import collections
import csv
import json
import pathlib
import urllib.parse
import urllib.request

import geo

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "raw" / "nyiso_zones.geojson"
GLOBAL = ROOT / "data" / "facilities_global.csv"
OUT_TS = ROOT / "worldmonitor" / "src" / "config" / "nyiso-zones.ts"
OUT_CSV = ROOT / "data" / "nyiso_zone_summary.csv"

SERVICE = ("https://services3.arcgis.com/IjH5oxISveik310X/arcgis/rest/services/"
           "NYISO_Load_Zones/FeatureServer/0")

# NYISO's own names for the eleven zones. The letters are what the Gold Book
# and the settlement data use; the names are what a reader recognises.
ZONE_NAMES = {
    "A": "West", "B": "Genesee", "C": "Central", "D": "North", "E": "Mohawk Valley",
    "F": "Capital", "G": "Hudson Valley", "H": "Millwood", "I": "Dunwoodie",
    "J": "New York City", "K": "Long Island",
}


def num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def fetch_geometry() -> dict:
    if CACHE.exists():
        return json.loads(CACHE.read_text())
    q = urllib.parse.urlencode({
        "where": "1=1", "outFields": "Zone_Name", "returnGeometry": "true",
        "outSR": "4326", "f": "geojson"})
    req = urllib.request.Request(f"{SERVICE}/query?{q}",
                                 headers={"User-Agent": "reinsurance_dc-research/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        d = json.loads(r.read().decode("utf-8", "replace"))
    feats = d.get("features") or []
    if not feats:
        raise SystemExit("NYISO zone service returned nothing - layout changed?")
    # Zone B ships as two polygons; normalise the property name the index uses.
    for f in feats:
        p = f.setdefault("properties", {})
        p["NAME"] = str(p.get("Zone_Name") or "").strip().upper()
    payload = {"type": "FeatureCollection", "features": feats}
    CACHE.write_text(json.dumps(payload))
    print(f"  fetched {len(feats)} polygons -> {CACHE.relative_to(ROOT)}")
    return payload


def rings_of(geom: dict) -> list:
    t, c = geom.get("type"), geom.get("coordinates") or []
    if t == "Polygon":
        return list(c)
    if t == "MultiPolygon":
        return [r for poly in c for r in poly]
    return []


def main() -> None:
    z = fetch_geometry()
    idx = geo.PolygonIndex(z, "NAME")
    rows = [r for r in csv.DictReader(GLOBAL.open()) if r.get("lat")]

    agg = collections.defaultdict(lambda: collections.Counter())
    for r in rows:
        m = idx.find_all(float(r["lon"]), float(r["lat"]))
        if not m:
            continue
        a = agg[m[0]["name"]]
        a["sites"] += 1
        if r.get("tenancy") == "multi":
            a["multi_tenant"] += 1
        if r["facility_type"] == "ai":
            a["ai_sites"] += 1
            a["mw_current"] += num(r.get("power_mw_total_current"))
            a["mw_peak"] += num(r.get("power_mw_total_peak"))

    with OUT_CSV.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n",
                           fieldnames=["zone", "zone_name", "sites", "ai_sites",
                                       "multi_tenant", "ai_mw_current", "ai_mw_peak"])
        w.writeheader()
        for letter in sorted(ZONE_NAMES):
            a = agg.get(letter, collections.Counter())
            w.writerow({"zone": letter, "zone_name": ZONE_NAMES[letter],
                        "sites": a["sites"], "ai_sites": a["ai_sites"],
                        "multi_tenant": a["multi_tenant"],
                        "ai_mw_current": round(a["mw_current"]),
                        "ai_mw_peak": round(a["mw_peak"])})
    print(f"wrote {OUT_CSV.relative_to(ROOT)}")

    # One entry per zone letter, merging zone B's two polygons.
    by_zone: dict[str, list] = collections.defaultdict(list)
    verts = 0
    for ft in z.get("features", []):
        name = (ft.get("properties") or {}).get("NAME")
        if name not in ZONE_NAMES:
            continue
        for r in rings_of(ft.get("geometry")):
            if len(r) >= 4:
                verts += len(r)
                by_zone[name].append([[round(p[0], 4), round(p[1], 4)] for p in r])

    total_sites = sum(a["sites"] for a in agg.values()) or 1
    feats = []
    for letter in sorted(by_zone):
        a = agg.get(letter, collections.Counter())
        feats.append({
            "id": f"nyiso-{letter.lower()}",
            "name": f"NYISO {letter} — {ZONE_NAMES[letter]}",
            "zone": letter, "sites": a["sites"], "aiSites": a["ai_sites"],
            "multiTenant": a["multi_tenant"],
            "mwCurrent": round(a["mw_current"]), "mwPeak": round(a["mw_peak"]),
            "share": round(a["sites"] / total_sites, 4),
            "rings": by_zone[letter],
        })
    print(f"  vertices {verts:,} (not simplified - zones are small and dense)")

    body = ",\n".join(
        "  { " + ", ".join([
            f"id: '{f['id']}'", f"name: '{f['name']}'", f"zone: '{f['zone']}'",
            f"sites: {f['sites']}", f"aiSites: {f['aiSites']}",
            f"multiTenant: {f['multiTenant']}", f"mwCurrent: {f['mwCurrent']}",
            f"mwPeak: {f['mwPeak']}", f"share: {f['share']}",
            "rings: " + json.dumps(f["rings"], separators=(",", ":")),
        ]) + " }" for f in feats)

    OUT_TS.parent.mkdir(parents=True, exist_ok=True)
    OUT_TS.write_text(
        "import type { NyisoLoadZone } from '@/types';\n\n"
        "// NYISO load zones A-K. Per-zone counts are computed from this\n"
        "// project's facility registry by point-in-polygon.\n"
        "//\n"
        "// Geometry: ArcGIS Online, NOT simplified. Zones J (New York City)\n"
        "// and I/H are small enough that Douglas-Peucker at the 0.01 deg used\n"
        "// for ERCOT and PJM moves Manhattan carrier hotels out of zone J.\n"
        "// Zone B ships as two polygons upstream and is merged here.\n"
        "// Generated by src/nyiso_zones.py. Do not edit.\n\n"
        "export const NYISO_LOAD_ZONES: NyisoLoadZone[] = [\n" + body + ",\n];\n")
    kb = OUT_TS.stat().st_size / 1024
    print(f"wrote {OUT_TS.relative_to(ROOT)}  ({len(feats)} zones, {kb:.0f} KB)")


if __name__ == "__main__":
    main()
