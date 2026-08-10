"""Build a USGS ShakeMap layer, and score the registry's exposure to it.

    python3 shakemap.py us20005iis kumamoto "Japan Kumamoto EQ"

This is the accumulation question a data centre registry exists to answer: not
"where are the data centres" but "how many, whose, and how much capacity sat
inside MMI VII when the ground moved".

Two USGS products, used for two different jobs:

  cont_mmi.json          contour lines, for drawing. USGS ships its own
                         colours with them and we keep those - the ShakeMap
                         palette is the convention seismologists read.
  coverage_mmi_*.covjson a regular lat/lon grid of MMI, for sampling. Contours
                         alone would mean inferring "inside" from nested rings,
                         which is fragile where a contour is clipped by the
                         grid edge; the grid answers directly.

MMI is Modified Mercalli Intensity - observed shaking, not magnitude. VI is
where non-structural damage starts, VII is where it gets real. A site's MMI is
bilinearly interpolated from the grid, so it does not snap to a cell.
"""

from __future__ import annotations

import collections
import csv
import json
import math
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
SITES = ROOT / "data" / "facilities_sites.csv"
API = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid="

# USGS ShakeMap's own MMI palette, so the layer reads the way every other
# ShakeMap does. Index is the floor of MMI.
MMI_COLOR = {
    1: "#ffffff", 2: "#bfccff", 3: "#a0e5ff", 4: "#80ffff", 5: "#7cff90",
    6: "#ffff00", 7: "#ffc600", 8: "#ff9100", 9: "#ff0000", 10: "#c00000",
}
# Contours below this are not drawn - see the note where they are filtered.
MIN_CONTOUR_MMI = 5.0

MMI_LABEL = {
    1: "I  not felt", 2: "II  weak", 3: "III  weak", 4: "IV  light",
    5: "V  moderate", 6: "VI  strong — non-structural damage begins",
    7: "VII  very strong — moderate damage", 8: "VIII  severe",
    9: "IX  violent", 10: "X+  extreme",
}


def fetch(url: str, dest: pathlib.Path) -> dict:
    if not dest.exists():
        req = urllib.request.Request(url, headers={"User-Agent": "reinsurance_dc-research/1.0"})
        with urllib.request.urlopen(req, timeout=180) as r:
            dest.write_bytes(r.read())
    return json.loads(dest.read_text())


def sample_grid(cov: dict):
    """Bilinear MMI lookup over the CoverageJSON grid."""
    ax = cov["domain"]["axes"]
    x0, x1, nx = ax["x"]["start"], ax["x"]["stop"], ax["x"]["num"]
    y0, y1, ny = ax["y"]["start"], ax["y"]["stop"], ax["y"]["num"]
    vals = cov["ranges"]["MMI"]["values"]
    dx = (x1 - x0) / (nx - 1)
    dy = (y1 - y0) / (ny - 1)

    def at(ix, iy):
        v = vals[iy * nx + ix]
        return None if v is None else float(v)

    def lookup(lon, lat):
        fx, fy = (lon - x0) / dx, (lat - y0) / dy
        if not (0 <= fx <= nx - 1 and 0 <= fy <= ny - 1):
            return None
        ix, iy = int(fx), int(fy)
        ix1, iy1 = min(ix + 1, nx - 1), min(iy + 1, ny - 1)
        tx, ty = fx - ix, fy - iy
        c = [at(ix, iy), at(ix1, iy), at(ix, iy1), at(ix1, iy1)]
        if any(v is None for v in c):
            return None
        return (c[0] * (1 - tx) * (1 - ty) + c[1] * tx * (1 - ty)
                + c[2] * (1 - tx) * ty + c[3] * tx * ty)

    return lookup


def km(lon_a, lat_a, lon_b, lat_b) -> float:
    dx = (lon_a - lon_b) * 111.32 * math.cos(math.radians((lat_a + lat_b) / 2))
    return math.hypot(dx, (lat_a - lat_b) * 111.32)


def num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def main() -> None:
    if len(sys.argv) < 4:
        raise SystemExit("usage: shakemap.py <usgs_event_id> <slug> <display name>")
    eid, slug, label = sys.argv[1], sys.argv[2], " ".join(sys.argv[3:])

    ev = fetch(API + eid, RAW / f"quake_{slug}_event.json")
    p = ev["properties"]
    elon, elat, depth = ev["geometry"]["coordinates"]
    sm = p["products"]["shakemap"][0]["contents"]

    cont = fetch(sm["download/cont_mmi.json"]["url"], RAW / f"quake_{slug}_cont_mmi.json")
    cov = fetch(sm["download/coverage_mmi_medium_res.covjson"]["url"],
                RAW / f"quake_{slug}_cov_mmi.json")
    lookup = sample_grid(cov)

    sites = [r for r in csv.DictReader(SITES.open()) if r.get("lat")]
    exposed = []
    for r in sites:
        lon, lat = float(r["lon"]), float(r["lat"])
        mmi = lookup(lon, lat)
        if mmi is None or mmi < 2:
            continue
        exposed.append({
            "site_id": r["site_id"],
            "name": r["name"] or r["epoch_name"],
            "operator": r["operator"], "country": r["country"], "city": r["city"],
            "facility_type": r["facility_type"], "tenancy": r["tenancy"],
            "mmi": round(mmi, 2), "mmi_band": int(mmi),
            "km_from_epicentre": round(km(lon, lat, elon, elat), 1),
            "power_mw": round(num(r["power_mw_total_current"]), 1),
        })
    exposed.sort(key=lambda e: -e["mmi"])

    out_csv = ROOT / "data" / f"quake_exposure_{slug}.csv"
    with out_csv.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=list(exposed[0].keys()))
        w.writeheader()
        w.writerows(exposed)
    print(f"wrote {out_csv.relative_to(ROOT)}  ({len(exposed)} sites at MMI >= 2)")

    bands = collections.Counter(e["mmi_band"] for e in exposed)
    for b in sorted(bands, reverse=True):
        mw = sum(e["power_mw"] for e in exposed if e["mmi_band"] == b)
        print(f"  MMI {b:>2}  {bands[b]:>4} sites" + (f"  {mw:,.0f} MW" if mw else ""))

    # Contours: keep USGS's own colour and value, drop everything else - and
    # clip the grid edge. A ShakeMap grid is a rectangle, so the low contours
    # do not close: they run along the boundary, drawing straight lines that
    # box the whole event in. That frame is an artefact of where USGS stopped
    # computing, not the shape of the shaking, so split each line wherever it
    # touches the edge and keep only the runs that do not.
    ax = cov["domain"]["axes"]
    gx0, gx1 = ax["x"]["start"], ax["x"]["stop"]
    gy0, gy1 = ax["y"]["start"], ax["y"]["stop"]
    EDGE = 0.02

    def on_edge(x, y):
        return (abs(x - gx0) < EDGE or abs(x - gx1) < EDGE
                or abs(y - gy0) < EDGE or abs(y - gy1) < EDGE)

    def declip(seg):
        runs, cur = [], []
        for x, y in seg:
            if on_edge(x, y):
                if len(cur) > 1:
                    runs.append(cur)
                cur = []
            else:
                cur.append([round(x, 4), round(y, 4)])
        if len(cur) > 1:
            runs.append(cur)
        return runs

    lines, dropped = [], 0
    for f in cont.get("features", []):
        pr = f.get("properties") or {}
        # Below MMI V the contours are the faint outer rings that dominate the
        # picture while meaning "felt, no damage". They are also the ones the
        # grid clips, so they arrive as loose arcs. Damage-relevant intensity
        # starts at V-VI, so that is where the drawing starts. Exposure scoring
        # is unaffected: it reads the MMI grid, not these lines.
        if (pr.get("value") or 0) < MIN_CONTOUR_MMI:
            continue
        g = f.get("geometry") or {}
        segs = g.get("coordinates") or []
        if g.get("type") == "LineString":
            segs = [segs]
        kept = []
        for seg in segs:
            if len(seg) < 2:
                continue
            runs = declip(seg)
            dropped += len(seg) - sum(len(r) for r in runs)
            kept += runs
        if kept:
            lines.append({"value": pr.get("value"), "color": pr.get("color"), "segments": kept})
    print(f"  contour points dropped on the grid edge: {dropped}")

    band_rows = [{"mmi": b, "sites": bands[b], "color": MMI_COLOR.get(b, "#cccccc"),
                  "label": MMI_LABEL.get(b, str(b)),
                  "mw": round(sum(e["power_mw"] for e in exposed if e["mmi_band"] == b))}
                 for b in sorted(bands, reverse=True)]

    payload = {
        "id": slug, "name": label, "eventId": eid,
        "title": p.get("title"), "magnitude": p.get("mag"),
        "place": p.get("place"), "time": p.get("time"), "depthKm": depth,
        "epicentre": [round(elon, 4), round(elat, 4)],
        "url": p.get("url"),
        "contours": lines,
        "bands": band_rows,
        "exposed": len(exposed),
        "topSites": [{k: e[k] for k in ("name", "operator", "city", "mmi", "km_from_epicentre")}
                     for e in exposed[:12]],
    }
    out_ts = ROOT / "worldmonitor" / "src" / "config" / f"quake-{slug}.ts"
    const = f"QUAKE_{slug.upper()}"
    out_ts.parent.mkdir(parents=True, exist_ok=True)
    out_ts.write_text(
        f"import type {{ QuakeShakeMap }} from '@/types';\n\n"
        f"// {p.get('title')}\n"
        f"// USGS ShakeMap MMI contours, event {eid}. Colours are USGS's own.\n"
        f"// Site counts per band are this project's registry sampled against\n"
        f"// the ShakeMap MMI grid (bilinear), not a USGS product.\n"
        f"// Source: {p.get('url')}\n"
        f"// Generated by src/shakemap.py. Do not edit.\n\n"
        f"export const {const}: QuakeShakeMap = "
        + json.dumps(payload, separators=(",", ":")) + ";\n")
    kb = out_ts.stat().st_size / 1024
    print(f"wrote {out_ts.relative_to(ROOT)}  ({len(lines)} contours, {kb:.0f} KB)")


if __name__ == "__main__":
    main()
