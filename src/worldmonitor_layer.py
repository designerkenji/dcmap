"""Emit a worldmonitor map layer config from the OSM facility pull.

worldmonitor already ships an "AI Data Centers" layer built from Epoch AI's
GPU cluster dataset. That layer counts *compute clusters*: 313 records keyed
on chipCount, with powerMW meaning cluster IT load (median 4 MW).

This emits a second, deliberately separate layer counting *facilities*: the
buildings themselves, from OpenStreetMap, 4.6k worldwide. The two are not
merged because their MW fields are different quantities - a 13 MW Epoch
cluster sits inside a facility whose delivery point can draw 300 MW - and
silently joining them would understate facility load by an order of
magnitude.

Writes a TypeScript config in the same shape as ai-datacenters.ts so the
repo keeps one convention.
"""

from __future__ import annotations

import csv
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "osm_world_by_country.csv"
OUT = ROOT / "worldmonitor" / "src" / "config" / "datacenter-facilities.ts"

# Registry rows carry the Virginia-only enrichment (serving utility). Keyed by
# rounded coordinate so the facility layer can surface it where it exists.
REGISTRY = ROOT / "data" / "registry.csv"


# Invisible characters are legitimate in some scripts - U+200C separates word
# parts in Persian - but a zero-width character sitting in a source file is
# also how you hide things in code, and worldmonitor's `lint:unicode` gate
# rejects them. Emit them as visible \uXXXX escapes: the string is identical
# at runtime, and a reviewer can see exactly what is there.
INVISIBLE = {
    0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0x00AD, 0xFEFF,
    0x202A, 0x202B, 0x202C, 0x202D, 0x202E,
    0x2066, 0x2067, 0x2068, 0x2069, 0x061C,
}


def esc(s: str) -> str:
    """Single-quoted TS string literal, with invisibles escaped."""
    out = []
    for ch in (s or ""):
        cp = ord(ch)
        if ch == "\\":
            out.append("\\\\")
        elif ch == "'":
            out.append("\\'")
        elif cp in INVISIBLE or cp < 0x20:
            out.append(f"\\u{cp:04X}")
        else:
            out.append(ch)
    return "'" + "".join(out) + "'"


def load_utility_by_coord() -> dict:
    if not REGISTRY.exists():
        return {}
    out = {}
    for r in csv.DictReader(REGISTRY.open()):
        if not r.get("lat") or not r.get("utility"):
            continue
        key = (round(float(r["lon"]), 3), round(float(r["lat"]), 3))
        out.setdefault(key, r["utility"])
    return out


def main() -> None:
    if not SRC.exists():
        raise SystemExit("run `python3 osm.py world && python3 world.py` first")
    rows = list(csv.DictReader(SRC.open()))
    util = load_utility_by_coord()

    recs, seen = [], set()
    for r in rows:
        try:
            lon, lat = float(r["lon"]), float(r["lat"])
        except (TypeError, ValueError):
            continue
        # OSM occasionally maps a campus as both a way and an enclosing
        # relation; identical rounded coordinates are that duplicate.
        key = (round(lon, 5), round(lat, 5), r.get("name", ""))
        if key in seen:
            continue
        seen.add(key)
        name = (r.get("name") or "").strip()
        operator = (r.get("operator") or "").strip()
        # These configs are bundled directly, so redundancy costs shipped bytes.
        # OSM very often repeats the brand in both fields ("Amazon Web Services"
        # as name and operator); the renderer falls back to operator when name
        # is absent, so dropping the duplicate is lossless.
        if name and name.casefold() == operator.casefold():
            name = ""
        d = {
            "id": f"dcf-{r['osm_type'][0]}{r['osm_id']}",
            "name": name,
            "operator": operator,
            "country": r.get("country") or "",
            "lat": round(lat, 5),
            "lon": round(lon, 5),
        }
        if r.get("ref"):
            d["ref"] = r["ref"]
        if r.get("addr_city"):
            d["city"] = r["addr_city"]
        u = util.get((round(lon, 3), round(lat, 3)))
        if u:
            d["utility"] = u
        recs.append(d)

    recs.sort(key=lambda d: (d["country"], d["operator"] or "zz", d["name"]))

    lines = [
        "import type { DataCenterFacility } from '@/types';",
        "",
        "// Data center FACILITIES from OpenStreetMap (ODbL).",
        "// https://www.openstreetmap.org/copyright",
        "//",
        "// Distinct from AI_DATA_CENTERS in ./ai-datacenters.ts, which is Epoch AI's",
        "// GPU *cluster* dataset. This layer counts buildings; that one counts compute.",
        "// Their power figures are different quantities and must not be summed: an",
        "// Epoch cluster's powerMW is IT load inside a facility, while a facility's",
        "// utility delivery point is typically an order of magnitude larger.",
        "//",
        "// `utility` is the certificated retail provider and is currently Virginia-only,",
        "// resolved by point-in-polygon against Virginia Energy / SCC territory layers.",
        f"// Generated by src/worldmonitor_layer.py - {len(recs)} facilities. Do not edit.",
        "",
        "export const DATACENTER_FACILITIES: DataCenterFacility[] = [",
    ]
    for d in recs:
        parts = [f"id: {esc(d['id'])}"]
        for k in ("name", "operator", "country", "ref", "city", "utility"):
            if d.get(k):
                parts.append(f"{k}: {esc(d[k])}")
        parts.append(f"lat: {d['lat']}")
        parts.append(f"lon: {d['lon']}")
        lines.append("  { " + ", ".join(parts) + " },")
    lines.append("];")
    lines.append("")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines))
    kb = OUT.stat().st_size / 1024
    named = sum(1 for d in recs if d["operator"])
    withu = sum(1 for d in recs if d.get("utility"))
    print(f"wrote {OUT.relative_to(ROOT)}  ({len(recs)} facilities, {kb:.0f} KB)")
    print(f"  operator known : {named}/{len(recs)} ({named / len(recs):.0%})")
    print(f"  utility known  : {withu} (Virginia only)")
    print(f"  countries      : {len({d['country'] for d in recs})}")


if __name__ == "__main__":
    main()
