"""Site perimeters for the power plant layer, from OSM's power=plant areas.

    python3 plant_footprints.py

A power plant is not a building, which is why the Overture buildings sweep
deliberately skipped the layer: the polygon nearest a plant's pin is as
likely the admin block as the turbine hall, and a wind farm has no building
to find at all. What a plant does have is a SITE, and OpenStreetMap's power
mappers draw exactly that: power=plant is an area feature whose ring is the
plant's perimeter - fence line, switchyard, panel field and all. That is the
polygon this fetches, and it is claimed as what it is: kind=campus, never a
building footprint.

ONLY EXACTLY-LOCATED PLANTS ARE ASKED - 14,901 of 28,152. GEM grades 47% of
its own coordinates as settlement-level (`ax` on the record, hollow rings on
the map), and fetching "the plant site at the town centroid" would dress a
guess up as a survey. Same rule as every other footprint source here.

THE QUERIES ARE BATCHED AROUNDS, NOT A PLANET PULL. One hundred plants per
Overpass request as a union of around: clauses, ~150 requests for the whole
layer, well inside overpass-api.de fair use. around: measures distance to
the ring PATH, not the interior, so the radius (800 m) is generous enough
that a pin deep inside a large site still reaches its own perimeter; truly
giant wind farms whose ring is kilometres from the pin are accepted misses.

Matching per plant: an area CONTAINING the pin wins, else the nearest ring
within 300 m, else nothing. One OSM area routinely matches several plant
records (GEM and EIA both split some complexes), so features carry every
matched plant id in `sites`, the same way campus features carry site ids.

Batches cache raw under data/raw/plant_fp_cache/ and a rerun skips them;
output is data/footprints_plants.geojson, merged by dcmap at load. ODbL,
same as every other OSM-derived layer here.
"""

from __future__ import annotations

import json
import math
import pathlib
import time
import urllib.request

import geo
from footprints import area_m2, bbox_of, relation_polygon, way_polygon

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CACHE = RAW / "plant_fp_cache"
DEST = ROOT / "data" / "footprints_plants.geojson"
OVERPASS = "https://overpass-api.de/api/interpreter"
UA = {"User-Agent": "reinsurance_dc-research/1.0 (plant site perimeters)"}

BATCH = 100
AROUND_M = 800          # pin-to-ring reach; see docstring
MATCH_M = 300           # nearest-ring fallback cap when nothing contains


def targets() -> list[dict]:
    plants = json.loads((ROOT / "data" / "power_plants.json").read_text())
    return [p for p in plants if not p.get("ax")]


def query(batch: list[dict]) -> dict:
    clauses = "".join(
        f'way[power=plant](around:{AROUND_M},{p["lat"]:.5f},{p["lon"]:.5f});'
        f'relation[power=plant](around:{AROUND_M},{p["lat"]:.5f},{p["lon"]:.5f});'
        for p in batch)
    q = f"[out:json][timeout:180];({clauses});out geom;"
    for attempt in range(4):
        try:
            req = urllib.request.Request(OVERPASS, data=q.encode(),
                                         headers={**UA})
            return json.loads(urllib.request.urlopen(req, timeout=240).read())
        except Exception as e:  # noqa: BLE001 - 429/504 both mean back off
            if attempt == 3:
                raise
            wait = 30 * (attempt + 1)
            print(f"    retry in {wait}s ({e})", flush=True)
            time.sleep(wait)


def ring_dist_m(lon: float, lat: float, rings) -> float:
    """Distance from the point to the nearest ring VERTEX - crude, but it only
    breaks ties under 300 m where vertex spacing is far tighter than that."""
    best = math.inf
    for r in rings:
        for x, y in r:
            dx = (x - lon) * 111320 * math.cos(math.radians(lat))
            dy = (y - lat) * 111320
            d = math.hypot(dx, dy)
            if d < best:
                best = d
    return best


def main() -> None:
    pts = targets()
    CACHE.mkdir(parents=True, exist_ok=True)
    batches = [pts[i:i + BATCH] for i in range(0, len(pts), BATCH)]
    print(f"{len(pts)} exactly-located plants in {len(batches)} batches")

    elements: dict[str, dict] = {}
    t0 = time.time()
    for i, batch in enumerate(batches):
        cf = CACHE / f"batch_{i:03d}.json"
        if cf.exists():
            out = json.loads(cf.read_text())
        else:
            out = query(batch)
            cf.write_text(json.dumps(out))
            time.sleep(1.0)          # one public instance, run by volunteers
            print(f"  [{i + 1}/{len(batches)}] {len(out.get('elements', []))} elements "
                  f"({time.time() - t0:.0f}s)", flush=True)
        for e in out.get("elements", []):
            elements[f'{e["type"][0]}{e["id"]}'] = e

    print(f"{len(elements)} distinct power=plant areas near the layer")

    # Assemble geometry once per OSM element, then match every plant to its
    # containing (or nearest) area. 15k plants against ~20k shapes is 300M
    # ring tests done naively, so shapes are bucketed on a half-degree grid
    # by their bbox and each plant only ever meets its own cell's shapes.
    shapes = {}
    grid: dict[tuple, list] = {}
    PADDEG = MATCH_M / 111320 * 1.2
    for key, e in elements.items():
        geom = way_polygon(e) if e["type"] == "way" else relation_polygon(e)
        rings = geom and geo._rings(geom)
        if not rings:
            continue
        bb = bbox_of(geom)
        shapes[key] = {"geom": geom, "rings": rings, "tags": e.get("tags", {}),
                       "sites": []}
        for cx in range(int((bb[0] - PADDEG) // 0.5), int((bb[2] + PADDEG) // 0.5) + 1):
            for cy in range(int((bb[1] - PADDEG) // 0.5), int((bb[3] + PADDEG) // 0.5) + 1):
                grid.setdefault((cx, cy), []).append(key)

    matched = 0
    for p in pts:
        lon, lat = p["lon"], p["lat"]
        best, best_d = None, math.inf
        for key in grid.get((int(lon // 0.5), int(lat // 0.5)), ()):
            s = shapes[key]
            if sum(1 for r in s["rings"] if geo._in_ring(lon, lat, r)) % 2 == 1:
                best, best_d = key, -1      # containment beats any distance
                break
            d = ring_dist_m(lon, lat, s["rings"])
            if d < best_d:
                best, best_d = key, d
        if best is not None and (best_d < 0 or best_d <= MATCH_M):
            shapes[best]["sites"].append(p["id"])
            matched += 1

    feats = []
    for key, s in sorted(shapes.items()):
        if not s["sites"]:
            continue                 # an area none of our plants stand in
        t = s["tags"]
        feats.append({"type": "Feature", "geometry": s["geom"], "properties": {
            "id": f"fp-plant-{key}", "kind": "campus", "src": "osm-plant",
            "name": t.get("name") or "", "op": t.get("operator") or "",
            "bbox": bbox_of(s["geom"]), "m2": area_m2(s["geom"]),
            "sites": sorted(s["sites"]),
        }})
    DEST.write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                               separators=(",", ":")))
    print(f"wrote {DEST.relative_to(ROOT)}: {len(feats)} plant perimeters covering "
          f"{matched} of {len(pts)} exactly-located plants "
          f"({DEST.stat().st_size / 1048576:.1f} MB)")


if __name__ == "__main__":
    main()
