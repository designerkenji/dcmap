#!/usr/bin/env python3
"""Vector tiles for the heavy read-only map layers.

    python3 tiles.py

WHY. Transmission corridors shipped as one GeoJSON: 9,368 ways, 1.45 MB
gzipped, fetched on every page load for a layer that is on by default - and
nearly all of it is geometry for corridors nowhere near the viewport. A tile
pyramid inverts that: the browser asks for the tiles under the view at the
zoom it is at, and tippecanoe has already simplified each level so a
continental view is not paying for hairline detail it cannot draw. The app
already serves PMTiles by HTTP range for the basemap (see basemap_tiles.py),
so the serving side costs nothing new - this is the same archive format on the
same route pattern.

WHAT IS TILED, AND WHAT DELIBERATELY IS NOT.
  transmission   pure display: one layer reads it, nothing else on the client
                 touches the data. Tiled.
  water          the service areas of the 577 community water systems that
                 registry sites sit inside (water_service.py names them).
                 Raw, those polygons are 121 MB; even simplified to 50 m they
                 are 9.5 MB. Only tiles make a boundary drawn at parcel scale
                 affordable at continental zoom. Tiled, from the EPA
                 GeoPackage directly.
  plants         a first-class client data structure - search, the heat map,
                 the fuel key, tooltips, the timeline all read the array. Tiling
                 it would break ten consumers to save one fetch. Its 1.2 MB is
                 a lazy-loading problem (the layer is OFF by default and the
                 file is fetched anyway), not a tiling one.
  footprints     already per-viewport through /api/footprints, and the in-map
                 editor writes to that GeoJSON source with setData(). Tiles are
                 read-only; leave them.

The tile carries only what the hover tip reads - `kv` and `n` - which is
exactly what /data/power_lines.json already trims to. Everything else stays in
the file on disk.

Output goes to data/raw/ (gitignored, like basemap.pmtiles): it is derived,
small and regenerable, and a clone without it degrades to the GeoJSON route
rather than losing the layer.

Needs tippecanoe on PATH (`brew install tippecanoe`).
"""

from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
SRC = ROOT / "data" / "transmission_lines.geojson"
OUT = RAW / "transmission.pmtiles"
WATER_CSV = ROOT / "data" / "water_service.csv"
WATER_GPKG = RAW / "epa_sab" / "3_0" / "Service_Areas_V_3_0.gpkg"
WATER_OUT = RAW / "water.pmtiles"


def run_tippecanoe(src_ndjson: str, out: pathlib.Path, layer: str, extra: list[str]) -> None:
    cmd = ["tippecanoe", "-o", str(out), "-l", layer, "--force", "--quiet", "-P",
           *extra, src_ndjson]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"tippecanoe failed for {layer}:\n{r.stderr[-2000:]}")


def water_tiles() -> None:
    """Service-area polygons for the systems our sites are in. Properties are
    the hover tip's: pwsid, name, population, connections, method, and how
    many registry assets sit inside - the same facts the site page shows."""
    if not (WATER_CSV.exists() and WATER_GPKG.exists()):
        print("  water: skipped (run water_service.py first, and keep the EPA GeoPackage)")
        return
    import csv
    import sqlite3
    from collections import Counter
    from shapely import wkb
    from shapely.geometry import mapping

    def gpb(blob):
        env = (blob[3] >> 1) & 0b111
        return wkb.loads(blob[8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}.get(env, 0):])

    sites = Counter(r["pwsid"] for r in csv.DictReader(WATER_CSV.open(encoding="utf-8")))
    db = sqlite3.connect(WATER_GPKG)
    q = ("SELECT geom, PWS_Name, Population_Served_Count, Service_Connections_Count, "
         "Symbology_Field, Model_Method FROM CWS WHERE PWSID = ? ORDER BY Shape_Area LIMIT 1")
    n = 0
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        for pwsid, count in sites.items():
            rec = db.execute(q, (pwsid,)).fetchone()
            if not rec:
                continue
            g = gpb(rec[0])
            # 5 m pre-simplification only trims vertex noise from the source;
            # tippecanoe does the real per-zoom simplification itself.
            fh.write(json.dumps({
                "type": "Feature", "geometry": mapping(g.simplify(0.00005, preserve_topology=True)),
                "properties": {"pwsid": pwsid, "n": rec[1] or "", "pop": rec[2] or 0,
                               "conn": rec[3] or 0, "m": rec[4] or rec[5] or "", "s": count},
            }) + "\n")
            n += 1
        tmp = fh.name
    # -Z3: a service area is a region, legible from a continental view.
    # --coalesce-densest-as-needed keeps the fills contiguous at low zoom
    # instead of dropping whole systems; --detect-shared-borders stops the
    # shared edges between neighbouring systems from being simplified apart.
    run_tippecanoe(tmp, WATER_OUT, "water",
                   ["-Z", "3", "-z", "12", "--coalesce-densest-as-needed",
                    "--detect-shared-borders", "--extend-zooms-if-still-dropping"])
    pathlib.Path(tmp).unlink(missing_ok=True)
    print(f"wrote {WATER_OUT.relative_to(ROOT)}  ({n:,} water systems, "
          f"{WATER_OUT.stat().st_size / 1048576:.1f} MB, z3-z12)")


def main() -> None:
    if not shutil.which("tippecanoe"):
        sys.exit("tippecanoe not found - `brew install tippecanoe`")
    if not SRC.exists():
        sys.exit(f"{SRC.relative_to(ROOT)} missing - run power_lines.py first")

    fc = json.loads(SRC.read_text())
    feats = fc.get("features") or []
    # Newline-delimited, trimmed to the two fields the client reads. tippecanoe
    # streams ndjson without holding the collection, and dropping operator,
    # cables, circuits and the licence string per feature keeps the tiles to
    # geometry plus a label.
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        for f in feats:
            p = f.get("properties") or {}
            fh.write(json.dumps({
                "type": "Feature", "geometry": f["geometry"],
                "properties": {"kv": p.get("kv"), "n": p.get("name") or p.get("ref") or ""},
            }) + "\n")
        tmp = fh.name

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # -Z4: below zoom 4 the continent is four tiles and every corridor is a
    #      hairline on top of another; the client's own width ramp starts at 5.
    # -z12: past 12 the tile is over-zoomed by the renderer, which is fine for
    #      lines and keeps the archive small.
    # --drop-smallest-as-needed: at the low zooms, shed the shortest spurs
    #      first rather than thinning every line uniformly, so the long
    #      interstate corridors - the ones a continental view is for - survive.
    run_tippecanoe(tmp, OUT, "transmission",
                   ["-Z", "4", "-z", "12", "--drop-smallest-as-needed",
                    "--extend-zooms-if-still-dropping"])
    pathlib.Path(tmp).unlink(missing_ok=True)
    print(f"wrote {OUT.relative_to(ROOT)}  ({len(feats):,} corridors, "
          f"{OUT.stat().st_size / 1048576:.1f} MB, z4-z12)")
    water_tiles()


if __name__ == "__main__":
    main()
