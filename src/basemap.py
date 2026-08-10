"""Build the 2D map's basemap from Natural Earth 10m.

The app shipped 110m admin-0, which is generalised to roughly 100 km of
coastline. That is fine for a world view and actively misleading past about
zoom 5: it cannot resolve Bahrain, Hong Kong, Singapore or the Gulf coast, so
correctly-placed data centres appear to sit in the sea. 225 of 6,248 mapped
sites fell outside its landmass; on 10m simplified here, 103 do.

The remainder are not a basemap problem - they are reclaimed land newer than
the Natural Earth vintage, genuinely small islands, and a tail of imprecise
coordinates. See the precision work in epoch.py for that half.

10m raw is 13 MB / 548k vertices, too much to hand a browser. Douglas-Peucker
at 0.01 deg (~1.1 km) cuts it to 3.6 MB / 189k, well inside the zoom 9 the app
stops at. That epsilon was chosen by measuring, and the result is not
monotonic: 0.01 leaves 103 sites off the landmass where the finer 0.005 leaves
120 and 0.002 leaves 118. Simplification nudges a coastline both ways, so past
a point extra vertices buy noise, not accuracy - and 0.01 is also 32% smaller
than 0.005, which matters because MapLibre tiles this GeoJSON client-side on
every load. Coarser is worse: 0.02 gives 134 and 0.04 gives 216, no better
than the 110m it replaced.

The globe keeps using 110m. Its country choropleth samples hex cells by
point-in-polygon over every feature, which is 26x more work on 10m for a
layer only ever seen at planetary zoom.
"""

from __future__ import annotations

import json
import pathlib
import urllib.request

from ercot_zones import simplify

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
SRC = RAW / "ne10_raw.geojson"
OUT = RAW / "ne_countries_10m.geojson"
URL = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
       "master/geojson/ne_10m_admin_0_countries.geojson")

# Natural Earth ships ~170 attributes per feature; the app reads five. Dropping
# the rest is most of the size win before a single vertex is simplified.
KEEP = ("ADMIN", "NAME", "ISO_A2", "ISO_A2_EH", "CONTINENT")
EPSILON_DEG = 0.01


def rings_of(geom: dict) -> list:
    c = geom.get("coordinates") or []
    if geom.get("type") == "Polygon":
        return list(c)
    return [r for poly in c for r in poly]


def main() -> None:
    if not SRC.exists():
        print(f"downloading {URL.rsplit('/', 1)[-1]} ...")
        req = urllib.request.Request(URL, headers={"User-Agent": "reinsurance_dc-research/1.0"})
        with urllib.request.urlopen(req, timeout=300) as r:
            SRC.write_bytes(r.read())
    src = json.loads(SRC.read_text())

    feats, before, after = [], 0, 0
    for f in src.get("features", []):
        rings = []
        for r in rings_of(f.get("geometry") or {}):
            before += len(r)
            s = simplify([tuple(p[:2]) for p in r], EPSILON_DEG)
            # Below four points a ring cannot close; those are islets the
            # simplifier has collapsed, and emitting them draws spikes.
            if len(s) >= 4:
                after += len(s)
                rings.append([[round(x, 4), round(y, 4)] for x, y in s])
        if not rings:
            continue
        props = f.get("properties") or {}
        feats.append({
            "type": "Feature",
            "properties": {k: props.get(k) for k in KEEP},
            "geometry": {"type": "MultiPolygon", "coordinates": [[r] for r in rings]},
        })

    blob = json.dumps({"type": "FeatureCollection", "features": feats},
                      separators=(",", ":"))
    OUT.write_text(blob)
    print(f"  vertices {before:,} -> {after:,} ({after / before:.1%})")
    print(f"wrote {OUT.relative_to(ROOT)}  ({len(feats)} features, {len(blob) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
