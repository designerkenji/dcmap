"""Building footprints for the sites OSM has not drawn, from Overture Maps.

    python3 footprints_overture.py          # needs: pip install duckdb

WHY A SECOND FOOTPRINT SOURCE
footprints.py gets its shapes from OSM and the IM3 atlas, and after both,
999 of the 6,234 exactly-located sites still have no polygon - 16%, and not
randomly distributed: Brazil, India, Indonesia, Argentina, Bangladesh, the
places where OSM's building coverage is thinnest. Overture Maps merges OSM
with Microsoft's and Google's ML-extracted building footprints, which is
strongest exactly there. This script queries only those gap sites against
Overture and writes what it finds to its own file; footprints.geojson is
never touched (one writer per file).

HOW THE QUERY STAYS SMALL
The buildings theme is hundreds of GB of GeoParquet on S3. Nobody downloads
that: DuckDB reads it remotely, and every query here carries a CONSTANT
bounding-box predicate, which prunes parquet row groups on their bbox column
statistics before any geometry is transferred. The gap sites are grouped
into 2-degree cells, one query per cell over one connection with the object
cache on, so the file footers are fetched once, not once per cell. The whole
run transfers a few GB and takes on the order of an hour or two.

MATCHING, AND WHY IT IS CONSERVATIVE
Only sites with geo_precision=exact are queried at all. A town-geocoded dot
is a guess, and "the building at the town centroid" would dress the guess up
as a survey - the hollow-dot convention exists to prevent exactly that.
A site takes the building CONTAINING its dot when there is one, else the
nearest within ~130 m (0.0012 deg), else nothing. Two sites matching the
same building share one feature, the same way OSM campus features carry
several sites. Matches keep Overture's GERS id for provenance.

The output schema is footprints.geojson's, so dcmap merges the two files at
load with no special casing: id fp-ovt-<gers-prefix>, kind building,
src overture, sites [...], bbox, m2. Overture's buildings theme is ODbL
(it includes OSM), so the credit line reads Overture Maps Foundation, ODbL.

Interrupted runs resume: every cell's result is appended to a JSONL
checkpoint keyed by cell, and finished cells are skipped on the next run.
Delete data/raw/overture_checkpoint.jsonl to force a full re-query.
"""

from __future__ import annotations

import csv
import json
import pathlib
import sys
import time

from footprints import area_m2, bbox_of

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CHECKPOINT = DATA / "raw" / "overture_checkpoint.jsonl"
DEST = DATA / "footprints_overture.geojson"
# --fabs sweeps the fab layer instead: its own checkpoint (cell keys from the
# site sweep must not mark fab cells done) and its own output file. One
# caveat rides with it: fab ids are POSITIONAL (fabs.py numbers them in MW
# order), so a fabs.json regeneration that reorders can shift which fab a
# shape claims to be attached to. The map only draws the polygons, so the
# harm is bounded; re-run this sweep after any fab reordering.
CHECKPOINT_FABS = DATA / "raw" / "overture_fabs_checkpoint.jsonl"
DEST_FABS = DATA / "footprints_overture_fabs.geojson"

RELEASE = "2026-08-19.0"
BUILDINGS = (f"s3://overturemaps-us-west-2/release/{RELEASE}"
             "/theme=buildings/type=building/*")

# ~130 m at the equator. Wide enough for "the dot is in the car park",
# narrow enough that the neighbour's warehouse does not get claimed.
MAX_DEG = 0.0012
CELL_DEG = 2.0


def targets_fabs() -> list[dict]:
    covered = set()
    if DEST_FABS.exists():
        for f in json.loads(DEST_FABS.read_text())["features"]:
            covered.update(f["properties"].get("sites") or ())
    out = []
    for f in json.loads((DATA / "fabs.json").read_text()):
        if f["id"] in covered:
            continue
        # Every kept fab is a verified exact location - fabs.py drops the
        # unlocatable ones - so there is no precision gate to apply here.
        out.append({"sid": f["id"], "lat": f["lat"], "lon": f["lon"],
                    "name": f.get("n") or "", "op": f.get("op") or ""})
    return out


def overridden_coords() -> dict:
    """Hand corrections from the app's ledger. The raw CSV keeps the old
    coordinate, and querying Overture around a dot somebody has already
    moved re-asks the wrong ground - AlohaNAP's sweep miss was the sweep
    faithfully finding nothing at a water park. To re-query a corrected
    site, delete its CELL's {"cell_done": "<lon>_<lat>"} line from the
    checkpoint (the cell key is int(lon//2)_int(lat//2)) and rerun - the
    per-building lines are results, not the gate."""
    ov = {}
    f = DATA / "site_overrides.csv"
    if not f.exists():
        return ov
    for r in csv.DictReader(f.open(encoding="utf-8")):
        if r.get("field") in ("lat", "lon") and r.get("value"):
            ov.setdefault(r["site_id"], {})[r["field"]] = float(r["value"])
    return ov


def targets() -> list[dict]:
    covered = set()
    fp = json.loads((DATA / "footprints.geojson").read_text())
    for f in fp["features"]:
        covered.update(f["properties"].get("sites") or [])
    ov = overridden_coords()
    out = []
    with open(DATA / "facilities_sites.csv") as fh:
        for s in csv.DictReader(fh):
            if not s.get("lat") or s["site_id"] in covered:
                continue
            if (s.get("geo_precision") or "exact") != "exact":
                continue
            o = ov.get(s["site_id"]) or {}
            out.append({"sid": s["site_id"], "lat": o.get("lat", float(s["lat"])),
                        "lon": o.get("lon", float(s["lon"])),
                        "name": s.get("name") or "", "op": s.get("operator") or ""})
    return out


def cells_of(pts: list[dict]) -> dict[str, list[dict]]:
    cells: dict[str, list[dict]] = {}
    for p in pts:
        k = f"{int(p['lon'] // CELL_DEG)}_{int(p['lat'] // CELL_DEG)}"
        cells.setdefault(k, []).append(p)
    return cells


def main() -> None:
    try:
        import duckdb
    except ImportError:
        raise SystemExit("this enrichment step needs duckdb: pip install duckdb "
                         "(the core pipeline stays stdlib-only; this is optional, "
                         "like teac.py's pypdf)")

    global CHECKPOINT, DEST
    fabs_mode = "--fabs" in sys.argv
    if fabs_mode:
        CHECKPOINT, DEST = CHECKPOINT_FABS, DEST_FABS
    pts = targets_fabs() if fabs_mode else targets()
    cells = cells_of(pts)
    done = set()
    results: dict[str, dict] = {}          # gers id -> feature-in-progress
    if CHECKPOINT.exists():
        for line in CHECKPOINT.read_text().splitlines():
            rec = json.loads(line)
            if rec.get("cell_done"):
                done.add(rec["cell_done"])
                continue
            r = results.setdefault(rec["gers"], {"gers": rec["gers"],
                                                 "geometry": rec["geometry"], "sites": []})
            if rec["sid"] not in r["sites"]:
                r["sites"].append(rec["sid"])
    print(f"{len(pts)} gap sites in {len(cells)} cells "
          f"({len(done)} cells already done, {len(results)} buildings so far)")

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    con.execute("SET s3_region='us-west-2';")
    # The footers of a few hundred remote parquet files are the fixed cost of
    # every query; cached once per connection they are paid once per RUN.
    con.execute("SET enable_object_cache=true;")

    t0 = time.time()
    ck = open(CHECKPOINT, "a")
    for i, (key, cpts) in enumerate(sorted(cells.items(), key=lambda kv: -len(kv[1]))):
        if key in done:
            continue
        w = min(p["lon"] for p in cpts) - 0.002
        e = max(p["lon"] for p in cpts) + 0.002
        s = min(p["lat"] for p in cpts) - 0.002
        n = max(p["lat"] for p in cpts) + 0.002
        con.execute("CREATE OR REPLACE TABLE pts(sid VARCHAR, lat DOUBLE, lon DOUBLE)")
        con.executemany("INSERT INTO pts VALUES (?,?,?)",
                        [(p["sid"], p["lat"], p["lon"]) for p in cpts])
        t1 = time.time()
        try:
            rows = con.execute(f"""
              WITH b AS (
                SELECT id, geometry, bbox
                FROM read_parquet('{BUILDINGS}', hive_partitioning=1)
                WHERE bbox.xmin <= {e} AND bbox.xmax >= {w}
                  AND bbox.ymin <= {n} AND bbox.ymax >= {s}
              )
              SELECT p.sid,
                     arg_min(b.id, CASE WHEN ST_Contains(b.geometry, ST_Point(p.lon, p.lat)) THEN 0
                                        ELSE ST_Distance(ST_Centroid(b.geometry), ST_Point(p.lon, p.lat)) END),
                     arg_min(ST_AsGeoJSON(b.geometry),
                             CASE WHEN ST_Contains(b.geometry, ST_Point(p.lon, p.lat)) THEN 0
                                  ELSE ST_Distance(ST_Centroid(b.geometry), ST_Point(p.lon, p.lat)) END),
                     min(CASE WHEN ST_Contains(b.geometry, ST_Point(p.lon, p.lat)) THEN 0
                              ELSE ST_Distance(ST_Centroid(b.geometry), ST_Point(p.lon, p.lat)) END)
              FROM b JOIN pts p
                ON b.bbox.xmin <= p.lon + {MAX_DEG} AND b.bbox.xmax >= p.lon - {MAX_DEG}
               AND b.bbox.ymin <= p.lat + {MAX_DEG} AND b.bbox.ymax >= p.lat - {MAX_DEG}
              GROUP BY p.sid
              HAVING min(CASE WHEN ST_Contains(b.geometry, ST_Point(p.lon, p.lat)) THEN 0
                              ELSE ST_Distance(ST_Centroid(b.geometry), ST_Point(p.lon, p.lat)) END) <= {MAX_DEG}
            """).fetchall()
        except Exception as err:      # a flaky S3 read should cost one cell, not the run
            print(f"  cell {key}: FAILED ({err}) - rerun to retry it")
            continue
        for sid, gers, gjson, _score in rows:
            r = results.setdefault(gers, {"gers": gers, "geometry": json.loads(gjson),
                                          "sites": []})
            if "geometry" not in r or r["geometry"] is None:
                r["geometry"] = json.loads(gjson)
            if sid not in r["sites"]:
                r["sites"].append(sid)
                ck.write(json.dumps({"gers": gers, "sid": sid,
                                     "geometry": r["geometry"]}) + "\n")
        ck.write(json.dumps({"cell_done": key}) + "\n")
        ck.flush()
        done.add(key)
        print(f"  [{len(done)}/{len(cells)}] cell {key}: {len(cpts)} sites -> "
              f"{len(rows)} matched  ({time.time() - t1:.0f}s, total {time.time() - t0:.0f}s)")
    ck.close()

    feats = []
    for r in results.values():
        geom = r["geometry"]
        feats.append({"type": "Feature", "geometry": geom, "properties": {
            "id": "fp-ovt-" + r["gers"][:16],
            "gers": r["gers"], "kind": "building", "src": "overture",
            "bbox": bbox_of(geom), "m2": area_m2(geom),
            "sites": sorted(r["sites"]),
        }})
    feats.sort(key=lambda f: f["properties"]["id"])
    DEST.write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                               separators=(",", ":")))
    covered = {s for f in feats for s in f["properties"]["sites"]}
    print(f"wrote {DEST.relative_to(ROOT)}: {len(feats)} buildings covering "
          f"{len(covered)} of {len(pts)} gap sites "
          f"({DEST.stat().st_size / 1024:.0f} KB)")
    print(f"source: Overture Maps {RELEASE}, buildings theme (ODbL - includes OSM)")


if __name__ == "__main__":
    main()
