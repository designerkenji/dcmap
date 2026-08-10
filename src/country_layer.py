"""Build a country choropleth layer for worldmonitor.

Counts distinct SITES (see dedupe.py), not source rows.

The ERCOT and PJM layers are US-only because those are the only markets that
publish sub-national load data. This is the global counterpart: one polygon per
country, shaded by data centre count, with AI capacity and tenancy attached.

Counts are bottom-up from this project's registry (OSM + PeeringDB + Epoch),
so they are a floor, not a census. Coverage is demonstrably uneven - Singapore
resolves to 4 facilities against a real estate well into the dozens - and the
layer says so rather than implying a complete count.
"""

from __future__ import annotations

import collections
import csv
import json
import math
import pathlib

from ercot_zones import rings_of, simplify

ROOT = pathlib.Path(__file__).resolve().parent.parent
NE = ROOT / "data" / "raw" / "ne_countries.geojson"
# Deduped sites, not rows: OSM maps a campus as several buildings, so
# counting rows inflated the US from 1,556 sites to 2,499.
GLOBAL = ROOT / "data" / "facilities_sites.csv"
OUT_TS = ROOT / "worldmonitor" / "src" / "config" / "datacenter-countries.ts"
OUT_CSV = ROOT / "data" / "country_summary.csv"

# Countries are drawn at global zoom; 0.05 deg is well below one screen pixel
# there and takes the 110m Natural Earth rings down to a bundle-safe size.
EPSILON_DEG = 0.05


def num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def main() -> None:
    rows = list(csv.DictReader(GLOBAL.open()))
    agg: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for r in rows:
        cc = (r.get("country") or "").strip()
        if not cc or len(cc) != 2:
            continue
        a = agg[cc]
        a["sites"] += 1
        if r["facility_type"] == "ai":
            a["ai_sites"] += 1
            a["mw_current"] += num(r.get("power_mw_total_current"))
            a["mw_peak"] += num(r.get("power_mw_total_peak"))
        if r.get("tenancy") == "multi":
            a["multi"] += 1
        elif r.get("tenancy") == "single":
            a["single"] += 1
        if r.get("operator"):
            a["with_operator"] += 1
    print(f"facilities {len(rows)}  countries with ISO2 {len(agg)}")

    with OUT_CSV.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n",
                           fieldnames=["country", "sites", "ai_sites", "multi_tenant",
                                       "single_tenant", "operator_known",
                                       "ai_mw_current", "ai_mw_peak"])
        w.writeheader()
        for cc, a in sorted(agg.items(), key=lambda kv: -kv[1]["sites"]):
            w.writerow({"country": cc, "sites": a["sites"], "ai_sites": a["ai_sites"],
                        "multi_tenant": a["multi"], "single_tenant": a["single"],
                        "operator_known": a["with_operator"],
                        "ai_mw_current": round(a["mw_current"]),
                        "ai_mw_peak": round(a["mw_peak"])})
    print(f"wrote {OUT_CSV.relative_to(ROOT)}")

    ne = json.loads(NE.read_text())
    peak = max((a["sites"] for a in agg.values()), default=1) or 1
    feats, before, after, skipped = [], 0, 0, 0
    for ft in ne.get("features", []):
        p = ft.get("properties") or {}
        cc = p.get("ISO_A2")
        if not cc or cc == "-99":
            eh = p.get("ISO_A2_EH")
            cc = eh if eh and eh != "-99" else None
        if not cc or cc not in agg:
            skipped += 1
            continue
        a = agg[cc]
        rings = []
        for r in rings_of(ft.get("geometry")):
            before += len(r)
            s = simplify([tuple(pt[:2]) for pt in r], EPSILON_DEG)
            if len(s) >= 4:
                after += len(s)
                rings.append([[round(x, 3), round(y, 3)] for x, y in s])
        if not rings:
            continue
        # Log scale: the US has 1,556 sites and the median country has single
        # digits, so a linear ramp would leave everything but the US invisible.
        share = math.log10(a["sites"] + 1) / math.log10(peak + 1)
        feats.append({
            "id": f"dcc-{cc.lower()}", "cc": cc, "name": p.get("ADMIN") or cc,
            "sites": a["sites"], "aiSites": a["ai_sites"],
            "multiTenant": a["multi"], "singleTenant": a["single"],
            "operatorKnown": a["with_operator"],
            "mwCurrent": round(a["mw_current"]), "mwPeak": round(a["mw_peak"]),
            "share": round(share, 3), "rings": rings,
        })
    print(f"  countries drawn {len(feats)}  (no facilities: {skipped})")
    print(f"  vertices {before:,} -> {after:,} ({after / before:.1%})")

    body = ",\n".join(
        "  { " + ", ".join([
            f"id: '{x['id']}'", f"cc: '{x['cc']}'", "name: " + json.dumps(x["name"]),
            f"sites: {x['sites']}", f"aiSites: {x['aiSites']}",
            f"multiTenant: {x['multiTenant']}", f"singleTenant: {x['singleTenant']}",
            f"operatorKnown: {x['operatorKnown']}",
            f"mwCurrent: {x['mwCurrent']}", f"mwPeak: {x['mwPeak']}",
            f"share: {x['share']}",
            "rings: " + json.dumps(x["rings"], separators=(",", ":")),
        ]) + " }" for x in sorted(feats, key=lambda z: -z["sites"]))

    OUT_TS.parent.mkdir(parents=True, exist_ok=True)
    OUT_TS.write_text(
        "import type { DataCenterCountry } from '@/types';\n\n"
        "// Data centre counts by country, shaded on a log scale.\n"
        "//\n"
        "// Bottom-up from OpenStreetMap + PeeringDB + Epoch AI, so these are a\n"
        "// FLOOR, not a census, and coverage is uneven: Singapore resolves to a\n"
        "// handful against a real estate many times larger. Read the shading as\n"
        "// 'where we have found facilities', not 'where facilities are'.\n"
        "//\n"
        "// Log scale is deliberate - the US alone holds ~30% of known sites and a\n"
        "// linear ramp renders every other country invisible.\n"
        "// Boundaries: Natural Earth 110m, Douglas-Peucker at 0.05 deg.\n"
        "// Generated by src/country_layer.py. Do not edit.\n\n"
        "export const DATACENTER_COUNTRIES: DataCenterCountry[] = [\n" + body + ",\n];\n")
    print(f"wrote {OUT_TS.relative_to(ROOT)}  ({len(feats)} countries, "
          f"{OUT_TS.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
