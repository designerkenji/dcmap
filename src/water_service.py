#!/usr/bin/env python3
"""Which water utility each US site depends on, from EPA's service-area boundaries.

    python3 water_service.py

Water is the second physical dependency after power, and until this file the
registry held none of it. EPA's Community Water System Service Area Boundaries
(SAB, v3.0, March 2026) give a polygon for 44,656 community water systems -
about 99% of the population served in the US - each keyed by its federal
PWSID. A point-in-polygon of every US site against that layer turns "somewhere
in America" into "depends on a NAMED utility, serving N people through M
connections, regulated by primacy agency X" - a counterparty the registry can
track the way it already tracks substations, and every field observed.

WHAT IS RECORDED, AND WHAT DELIBERATELY IS NOT
  recorded    the PWSID (joins to SDWIS and to EPA ECHO's enforcement history,
              whose per-system URL the dataset carries), the name, primacy
              agency, population served, service connections, how the boundary
              was made (state-sourced, system-sourced or EPA-modelled), and
              its verification status - because a modelled boundary is a
              weaker fact than a utility-drawn one and a reader should see
              which they are looking at.
  not derived any water USE. Knowing the utility does not tell you the site's
              draw, and the registry states nothing it did not observe. The
              single most decision-relevant water fact is the size of the
              system the site is a marginal industrial load on, and that is
              exactly what population and connections give, unmodelled.

OVERLAPS. Service areas nest: a wholesaler's area can contain the retailers it
sells to. Where a point lands in more than one polygon, the SMALLEST is kept
as the serving system - it is the most specific claim - and the count of
overlapping systems is recorded so the ambiguity is visible rather than hidden.

CRS. The layer is NAD83 (EPSG:4269); registry coordinates are WGS84. Across
the conterminous US the two differ by under a metre, which against boundaries
drawn at parcel scale is nothing. Treated as equivalent, stated here.

COVERAGE. US only, and community systems only (the T_NTNC layer of transient
and non-transient non-community systems - campgrounds, factories with their
own wells - is not joined: a data centre on its own well is a different fact,
and the layer's own README says those areas are parcel-level estimates).

Input: data/raw/epa_sab/3_0/Service_Areas_V_3_0.gpkg, from
https://github.com/USEPA/ORD_SAB_Model/raw/refs/heads/main/Version_History/PWS_Boundaries_Latest.zip
(570 MB; extract the .gpkg). Public domain - a US Government work. EPA
"disclaims responsibility for the spatial accuracy" and calls modelled
boundaries "estimates"; the verification_status column carries that caveat
per row.

Output: data/water_service.csv, regenerated whole each run.
"""

from __future__ import annotations

import csv
import json
import pathlib
import sqlite3
import struct
import sys

from shapely import wkb
from shapely.geometry import Point

ROOT = pathlib.Path(__file__).resolve().parents[1]
GPKG = ROOT / "data" / "raw" / "epa_sab" / "3_0" / "Service_Areas_V_3_0.gpkg"
OUT = ROOT / "data" / "water_service.csv"

COLUMNS = ["asset_id", "kind", "pwsid", "pws_name", "primacy_agency",
           "population_served", "service_connections", "boundary_method",
           "verification_status", "data_source", "echo_url", "overlapping_systems"]


def gpb_to_geom(blob: bytes):
    """GeoPackage binary -> shapely. Header is 8 bytes plus an envelope whose
    size the flags byte encodes; the WKB follows."""
    if blob[:2] != b"GP":
        return None
    flags = blob[3]
    env = (flags >> 1) & 0b111
    env_len = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}.get(env, 0)
    return wkb.loads(blob[8 + env_len:])


def assets() -> list[dict]:
    out = []
    with (ROOT / "data" / "facilities_sites.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r.get("country") == "US" and r.get("lat") and r.get("lon"):
                out.append({"id": r["site_id"], "kind": "site",
                            "lat": float(r["lat"]), "lon": float(r["lon"])})
    for f in json.loads((ROOT / "data" / "fabs.json").read_text()):
        if f.get("cy") == "US" and f.get("lat") is not None:
            out.append({"id": f["id"], "kind": "fab", "lat": f["lat"], "lon": f["lon"]})
    return out


def main() -> None:
    if not GPKG.exists():
        sys.exit(f"{GPKG.relative_to(ROOT)} missing - see the docstring for the download")
    db = sqlite3.connect(GPKG)
    # The R-tree narrows 44,656 polygons to the handful whose envelope holds
    # the point; shapely then does the exact test on those alone.
    rtree = ("SELECT id FROM rtree_CWS_geom WHERE minx <= ? AND maxx >= ? "
             "AND miny <= ? AND maxy >= ?")
    row_q = ("SELECT geom, PWSID, PWS_Name, Primacy_Agency, Population_Served_Count, "
             "Service_Connections_Count, Model_Method, Symbology_Field, "
             "Verification_Status, Data_Source, Detailed_Facility_Report, Shape_Area "
             "FROM CWS WHERE fid = ?")
    geom_cache: dict[int, object] = {}

    rows, hit = [], 0
    targets = assets()
    for a in targets:
        pt = Point(a["lon"], a["lat"])
        cands = [r[0] for r in db.execute(rtree, (a["lon"], a["lon"], a["lat"], a["lat"]))]
        matches = []
        for fid in cands:
            rec = db.execute(row_q, (fid,)).fetchone()
            if rec is None:
                continue
            g = geom_cache.get(fid)
            if g is None:
                g = gpb_to_geom(rec[0])
                geom_cache[fid] = g
            if g is not None and g.contains(pt):
                matches.append((rec[11] or 0.0, rec))
        if not matches:
            continue
        hit += 1
        matches.sort(key=lambda m: m[0])          # smallest area = most specific
        rec = matches[0][1]
        rows.append({
            "asset_id": a["id"], "kind": a["kind"],
            "pwsid": rec[1] or "", "pws_name": rec[2] or "",
            "primacy_agency": rec[3] or "",
            "population_served": rec[4] if rec[4] is not None else "",
            "service_connections": rec[5] if rec[5] is not None else "",
            # Symbology_Field is the human reading of Model_Method
            # ("System Sourced", "State Sourced", "EPA Modeled").
            "boundary_method": rec[7] or rec[6] or "",
            "verification_status": rec[8] or "",
            "data_source": rec[9] or "",
            "echo_url": rec[10] or "",
            "overlapping_systems": len(matches),
        })

    with OUT.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)

    n = len(targets)
    print(f"wrote {OUT.relative_to(ROOT)}  ({hit:,} of {n:,} US assets inside a "
          f"community water system's service area, {100 * hit / n:.0f}%)")
    from collections import Counter
    meth = Counter(r["boundary_method"] for r in rows)
    print("  boundary provenance:", ", ".join(f"{k or '?'} {v:,}" for k, v in meth.most_common()))
    multi = sum(1 for r in rows if r["overlapping_systems"] > 1)
    print(f"  points inside more than one system: {multi:,} (smallest kept, count recorded)")
    big = sorted(rows, key=lambda r: -(int(r["population_served"] or 0)))[:3]
    print("  largest systems hit:", "; ".join(
        f"{r['pws_name']} ({int(r['population_served']):,} served)" for r in big))


if __name__ == "__main__":
    main()
