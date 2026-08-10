"""Build an ERCOT load-zone layer for worldmonitor.

ERCOT is the only US market publishing a large-load interconnection queue at
all, and it reports by load zone rather than by site. Those four zones are
therefore the finest public geography for "how much new large load is coming",
and they turn out to tell a sharp story: the West zone holds 4 AI sites today
at 790 MW and is projected to reach 4,215 MW - a 5.3x jump concentrated in the
Abilene corridor - while Houston has 27 data centres and no AI capacity at all.

Per-zone figures here are computed from this project's own registry by
point-in-polygon, NOT taken from ERCOT. ERCOT's own by-zone split exists only
as a chart image in the monthly TAC report, with no extractable text.

Geometry is third-party (ArcGIS Online, ICF) and covers the four major zones.
ERCOT settles against eight load zones - the four here plus LZ_AEN, LZ_CPS,
LZ_LCRA and LZ_RAYBN - so municipal territories around Austin and San Antonio
are folded into their surrounding zone.
"""

from __future__ import annotations

import collections
import csv
import json
import math
import pathlib

import geo

ROOT = pathlib.Path(__file__).resolve().parent.parent
ZONES = ROOT / "data" / "raw" / "ercot_zones.geojson"
GLOBAL = ROOT / "data" / "facilities_global.csv"
OUT_TS = ROOT / "worldmonitor" / "src" / "config" / "ercot-load-zones.ts"
OUT_CSV = ROOT / "data" / "ercot_zone_summary.csv"

# The raw layer is 11.5 MB / 320k vertices - unusable in a bundle. Zones are
# displayed at country-to-state zoom, so ~1 km of boundary detail is invisible.
EPSILON_DEG = 0.01


def num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _perp(p, a, b) -> float:
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def simplify(pts: list, eps: float) -> list:
    """Douglas-Peucker, iterative so a 220k-vertex ring cannot blow the stack."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        worst, wi = 0.0, i
        for k in range(i + 1, j):
            d = _perp(pts[k], pts[i], pts[j])
            if d > worst:
                worst, wi = d, k
        if worst > eps:
            keep[wi] = True
            stack.append((i, wi))
            stack.append((wi, j))
    return [p for p, k in zip(pts, keep) if k]


def rings_of(geom: dict) -> list:
    t = geom.get("type")
    c = geom.get("coordinates") or []
    if t == "Polygon":
        return list(c)
    if t == "MultiPolygon":
        return [r for poly in c for r in poly]
    return []


def main() -> None:
    z = json.loads(ZONES.read_text())
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
                           fieldnames=["zone", "sites", "ai_sites", "multi_tenant",
                                       "ai_mw_current", "ai_mw_peak", "growth_multiple"])
        w.writeheader()
        for name, a in sorted(agg.items(), key=lambda kv: -kv[1]["sites"]):
            cur, pk = a["mw_current"], a["mw_peak"]
            w.writerow({"zone": name, "sites": a["sites"], "ai_sites": a["ai_sites"],
                        "multi_tenant": a["multi_tenant"],
                        "ai_mw_current": round(cur), "ai_mw_peak": round(pk),
                        "growth_multiple": round(pk / cur, 2) if cur else ""})
    print(f"wrote {OUT_CSV.relative_to(ROOT)}")

    feats, before, after = [], 0, 0
    for ft in z.get("features", []):
        name = (ft.get("properties") or {}).get("NAME")
        rings = []
        for r in rings_of(ft.get("geometry")):
            before += len(r)
            s = simplify([tuple(p[:2]) for p in r], EPSILON_DEG)
            # A ring degenerate after simplification is a coastal islet; drop it
            # rather than emit an unclosed polygon deck.gl will render as a spike.
            if len(s) >= 4:
                after += len(s)
                rings.append([[round(x, 4), round(y, 4)] for x, y in s])
        if not rings:
            continue
        a = agg.get(name, collections.Counter())
        cur, pk = a["mw_current"], a["mw_peak"]
        feats.append({
            "id": f"ercot-{str(name).lower()}", "name": f"ERCOT {name}",
            "zone": name, "sites": a["sites"], "aiSites": a["ai_sites"],
            "multiTenant": a["multi_tenant"],
            "mwCurrent": round(cur), "mwPeak": round(pk),
            "growth": round(pk / cur, 2) if cur else 0,
            "rings": rings,
        })
    print(f"  vertices {before:,} -> {after:,} ({after / before:.1%})")

    body = ",\n".join(
        "  { " + ", ".join([
            f"id: '{f['id']}'", f"name: '{f['name']}'", f"zone: '{f['zone']}'",
            f"sites: {f['sites']}", f"aiSites: {f['aiSites']}",
            f"multiTenant: {f['multiTenant']}", f"mwCurrent: {f['mwCurrent']}",
            f"mwPeak: {f['mwPeak']}", f"growth: {f['growth']}",
            "rings: " + json.dumps(f["rings"], separators=(",", ":")),
        ]) + " }" for f in feats)

    OUT_TS.parent.mkdir(parents=True, exist_ok=True)
    OUT_TS.write_text(
        "import type { ErcotLoadZone } from '@/types';\n\n"
        "// ERCOT load zones - the finest geography at which any US market\n"
        "// publishes large-load interconnection data.\n"
        "//\n"
        "// Per-zone counts and MW are computed from this project's facility\n"
        "// registry by point-in-polygon, not taken from ERCOT: ERCOT's own\n"
        "// by-zone split is published only as a chart image.\n"
        "//\n"
        "// Geometry: ArcGIS Online (ICF), simplified with Douglas-Peucker at\n"
        "// 0.01 deg. Covers the four major zones; ERCOT settles against eight,\n"
        "// so the Austin (LZ_AEN) and San Antonio (LZ_CPS) municipal areas fold\n"
        "// into their surrounding zone.\n"
        "// Generated by src/ercot_zones.py. Do not edit.\n\n"
        "export const ERCOT_LOAD_ZONES: ErcotLoadZone[] = [\n" + body + ",\n];\n")
    kb = OUT_TS.stat().st_size / 1024
    print(f"wrote {OUT_TS.relative_to(ROOT)}  ({len(feats)} zones, {kb:.0f} KB)")


if __name__ == "__main__":
    main()
