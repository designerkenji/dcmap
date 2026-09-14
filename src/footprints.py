"""Building footprints and campus boundaries, as polygons the map can draw.

Every other layer in this project reduces a facility to a dot. The shapes
exist in two of the sources already used for those dots and were being thrown
away at ingest:

  - OSM: ways and relations tagged as data centers carry their full ring
    geometry. osm.py used to ask Overpass for `out center` and kept only the
    point; it now asks for `out geom`, and this file is the consumer.
  - IM3 atlas (PNNL / DOE): data/raw/im3_footprints.geojson holds 1,239
    measured building polygons and 135 campus boundaries, US-only. im3.py
    reads the same file and keeps only centroid + sqft.

Output is data/footprints.geojson. Each feature carries:

  id     fp-w<osmid> / fp-r<osmid> / fp-im3-<coord hash>  (stable across runs)
  kind   building | campus  (campus = OSM landuse, or IM3's own type column)
  src    osm | im3
  name, op
  sites  [site_id, ...] - registry dots inside the shape, or within 250 m of
         its centroid when it contains none. A campus legitimately holds many.
  bbox   [w, s, e, n]
  m2     ground area, for the popup - equirectangular, fine at building scale

Shapes a person draws or corrects in the app do NOT pass through here: they
live in data/footprint_overrides.geojson, which is a SOURCE in the same sense
as site_overrides.csv - nothing generates it, and dcmap applies it over this
file at load time. So a rebuild refreshes the derived shapes without touching
anyone's hand work.

Usage:
    python3 footprints.py            # build from cached raw files
    python3 footprints.py --fetch    # refetch OSM world geometry first
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import pathlib
import re
import sys
import time

import geo
import osm

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
IM3_SRC = RAW / "im3_footprints.geojson"
PARCELS = RAW / "parcels.geojson"
PARCELS_WFS = RAW / "parcels_wfs.geojson"
PARCELS_UK = RAW / "parcels_uk.geojson"
PARCELS_JP = RAW / "parcels_jp.geojson"
PARCELS_SCOT = RAW / "parcels_scotland.geojson"
PARCELS_PCY_INTL = RAW / "parcels_precisely_intl.geojson"
PARCELS_FR = RAW / "parcels_fr.geojson"
DEST = ROOT / "data" / "footprints.geojson"

# A dot beside a building rather than inside it is the normal case for
# geocoded addresses, so containment alone under-attaches. 250 m keeps the
# fallback inside one campus without reaching the neighbour's.
NEAR_M = 250.0


# ---- geometry helpers -------------------------------------------------------

def bbox_of(geom: dict) -> list[float]:
    x0, y0, x1, y1 = geo._bbox(geo._rings(geom))
    return [round(x0, 6), round(y0, 6), round(x1, 6), round(y1, 6)]


def area_m2(geom: dict) -> int:
    """Ground area, equirectangular at the shape's latitude.

    A ring is a HOLE when an odd number of other rings contain it - the
    even-odd rule, the same one contains() and the map's fill-rule use. The
    obvious version, "ring 0 is the outer and the rest are holes", is wrong for
    the shapes that arrive from a cadastre: Esri packs a MULTI-PART parcel into
    one flat ring list and distinguishes the parts by winding order, not by
    position. Twelve Loudoun parcels are two separate lots of similar size, and
    index-based logic subtracted the second from the first and reported an area
    of ZERO - which then sorted them first in the map's smallest-shape-wins
    picker, so they would have swallowed every click over their own ground.
    """
    total = 0.0
    polys = (geom["coordinates"] if geom["type"] == "MultiPolygon"
             else [geom["coordinates"]])
    for poly in polys:
        rings = [r for r in poly if len(r) >= 4]
        for i, ring in enumerate(rings):
            depth = sum(1 for j, other in enumerate(rings)
                        if j != i and geo._in_ring(ring[0][0], ring[0][1], other))
            lat = sum(p[1] for p in ring) / len(ring)
            m = (geo._m_per_deg_lon(lat) * geo.M_PER_DEG_LAT
                 * abs(geo._ring_area(ring)))
            total += -m if depth % 2 else m
    return int(round(max(total, 0)))


def contains(geom: dict, lon: float, lat: float) -> bool:
    """Even-odd over all rings, so holes subtract - same rule PolygonIndex uses."""
    rings = geo._rings(geom)
    return sum(1 for r in rings if geo._in_ring(lon, lat, r)) % 2 == 1


def dist_m(lon_a: float, lat_a: float, lon_b: float, lat_b: float) -> float:
    return math.hypot((lon_a - lon_b) * geo._m_per_deg_lon((lat_a + lat_b) / 2),
                      (lat_a - lat_b) * geo.M_PER_DEG_LAT)


# ---- OSM: elements -> polygons ---------------------------------------------

def way_polygon(e: dict) -> dict | None:
    ring = [[p["lon"], p["lat"]] for p in e.get("geometry") or []]
    if len(ring) < 4 or ring[0] != ring[-1]:
        return None                     # open way: a fence line, not a footprint
    return {"type": "Polygon", "coordinates": [ring]}


def chain(segments: list[list[list[float]]]) -> list[list[list[float]]]:
    """Assemble ways into closed rings by matching endpoints.

    A relation's outer boundary is routinely split across several member ways,
    in arbitrary order and direction. Greedy endpoint-matching is enough here:
    these are building outlines, not coastlines, and a ring that will not
    close is dropped and counted rather than guessed at.
    """
    segs = [s for s in segments if len(s) >= 2]
    rings = []
    while segs:
        ring = segs.pop(0)
        while ring[0] != ring[-1]:
            for i, s in enumerate(segs):
                if s[0] == ring[-1]:
                    ring = ring + s[1:]
                elif s[-1] == ring[-1]:
                    ring = ring + s[-2::-1]
                elif s[-1] == ring[0]:
                    ring = s + ring[1:]
                elif s[0] == ring[0]:
                    ring = s[::-1] + ring[1:]
                else:
                    continue
                segs.pop(i)
                break
            else:
                break                   # no segment continues this ring
        if len(ring) >= 4 and ring[0] == ring[-1]:
            rings.append(ring)
    return rings


def relation_polygon(e: dict) -> dict | None:
    outers, inners = [], []
    for m in e.get("members") or []:
        pts = [[p["lon"], p["lat"]] for p in m.get("geometry") or []]
        if m.get("type") != "way" or not pts:
            continue
        (inners if m.get("role") == "inner" else outers).append(pts)
    outer_rings = chain(outers)
    if not outer_rings:
        return None
    inner_rings = chain(inners)
    # Assign each hole to the outer ring that contains its first vertex.
    polys = [[r] for r in outer_rings]
    for hole in inner_rings:
        for poly in polys:
            if geo._in_ring(hole[0][0], hole[0][1], poly[0]):
                poly.append(hole)
                break
    if len(polys) == 1:
        return {"type": "Polygon", "coordinates": polys[0]}
    return {"type": "MultiPolygon", "coordinates": polys}


def osm_features(payload: dict) -> tuple[list[dict], int]:
    feats, dropped = [], 0
    for e in payload.get("elements", []):
        if e["type"] == "node":
            continue                    # a point can corroborate, not outline
        geom = way_polygon(e) if e["type"] == "way" else relation_polygon(e)
        if not geom:
            dropped += 1
            continue
        t = e.get("tags") or {}
        # WHAT MAKES AN OSM FEATURE A CAMPUS RATHER THAN A HALL.
        #
        # The obvious test - landuse=data_center - matches NOTHING: the tag is
        # not in use anywhere on earth (0 of 4,701 elements), so every OSM
        # footprint was classified `building` and the campus half of this layer
        # came entirely from IM3, which is US-only.
        #
        # What mappers actually draw is an ordinary land parcel - landuse=
        # industrial, sometimes commercial - carrying industrial=data_centre.
        # A `landuse` tag of any value is the signal, because it says the
        # feature is an area of LAND: a roof is never tagged landuse. The
        # split it produces is the right one - median 41,260 m2 against 5,281
        # for the rest, and the names read "Data4 Campus Paris Saclay".
        campus = bool(t.get("landuse")) or t.get("industrial") in ("data_center",
                                                                  "data_centre")
        feats.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "id": f"fp-{e['type'][0]}{e['id']}",
                "osm_id": e["id"],
                "kind": "campus" if campus else "building",
                "src": "osm",
                "name": t.get("name", ""),
                "op": t.get("operator", ""),
            },
        })
    return feats, dropped


# ---- the buildings OSM never labelled ---------------------------------------
# osm.py asks for features TAGGED as data centres, and worldwide there are only
# ~4,700 of them. That is the ceiling of this layer's first version: 3,908
# footprints against 6,255 mapped sites, 65% of which had no outline at all. A
# campus of ten halls where somebody drew the perimeter and tagged that returns
# one shape, not ten.
#
# So stop asking what a building is CALLED and ask where it IS: every building
# near a registry dot, then keep the ones big enough to be a data hall.
#
# SIZE IS THE FILTER THAT WORKS, and it is the only one that does. Measured on
# 25 random sites, every building within 250 m:
#
#     no filter                    127/site   ~795,000 - mostly houses
#     non-residential only         111/site   ~697,000 - building=yes says nothing
#     non-residential + >=1,000 m2   8.2/site  ~51,000
#     non-residential + >=2,000 m2   4.7/site  ~29,500   <- this
#     non-residential + >=5,000 m2   1.8/site  ~11,500
#
# The median building near a site is 118 m2 and a data hall is 5,000-50,000, so
# the two populations barely overlap. Type alone cannot separate them, because
# `building=yes` is the commonest tag in OSM and carries no information.
#
# Overpass CANNOT do this filter: there is no area() evaluator ("Function
# "area" not known"), so the size test is ours and the residential exclusion is
# theirs - it is the half that reduces what crosses the wire.
NEAR_RADIUS_M = 250
MIN_AREA_M2 = 2000
SITES_PER_QUERY = 100

# Dropped at the server. Everything here is a dwelling or an outbuilding and
# none of it is ever a data hall, whatever its size.
EXCLUDE_BUILDING = ("apartments|house|residential|detached|terrace|"
                    "semidetached_house|dormitory|hut|garage|garages|shed|roof|"
                    "carport|bungalow|cabin|static_caravan|greenhouse|barn|"
                    "farm|farm_auxiliary|stable|chapel|church|cathedral|mosque|"
                    "synagogue|temple|school|kindergarten|hospital|retail|"
                    "supermarket|hotel|stadium|sports_hall|train_station")

NEAR_DIR = RAW / "osm_site_buildings"


def near_query(clauses: list[str]) -> str:
    body = "\n  ".join(clauses)
    return f"[out:json][timeout:600];\n(\n  {body}\n);\nout tags geom;\n"


def near_clauses(sites: list[tuple[str, float, float]],
                 campus_bboxes: list[list[float]]) -> list[list[str]]:
    """One clause per site, plus one per known campus, in batches.

    A campus gets its BOUNDING BOX rather than a radius round the dot, because
    a hyperscale campus is a kilometre across - Meta's Eagle Mountain is 2.1
    million m2 - and 250 m from the centre dot misses most of its own halls.
    Where we already know the boundary, that boundary is the right question.
    """
    sel = f'["building"]["building"!~"^({EXCLUDE_BUILDING})$"]'
    clauses = []
    for _sid, lon, lat in sites:
        clauses.append(f'way{sel}(around:{NEAR_RADIUS_M},{lat:.6f},{lon:.6f});')
        clauses.append(f'rel{sel}(around:{NEAR_RADIUS_M},{lat:.6f},{lon:.6f});')
    for w, s, e, n in campus_bboxes:
        clauses.append(f'way{sel}({s:.6f},{w:.6f},{n:.6f},{e:.6f});')
    # Batched by CLAUSE count, not site count: a query with thousands of
    # around: filters is refused, and one that is merely large times out.
    per = SITES_PER_QUERY * 2
    return [clauses[i:i + per] for i in range(0, len(clauses), per)]


def fetch_site_buildings(sites, campus_bboxes, force: bool = False) -> list[dict]:
    """Every batch, cached one file per batch so a failure resumes."""
    NEAR_DIR.mkdir(parents=True, exist_ok=True)
    batches = near_clauses(sites, campus_bboxes)
    out = []
    for i, batch in enumerate(batches):
        dest = NEAR_DIR / f"batch_{i:04d}.json"
        if dest.exists() and not force:
            out.append(json.loads(dest.read_text()))
            continue
        print(f"  batch {i + 1}/{len(batches)} ...", flush=True)
        try:
            payload = osm.run(near_query(batch))
        except Exception as e:  # noqa: BLE001
            # One dead batch must not cost the other sixty-two.
            print(f"    failed, skipping: {e}")
            continue
        dest.write_text(json.dumps(payload))
        out.append(payload)
        time.sleep(2)          # the public instances are volunteer-run
    return out


def site_building_features(payloads: list[dict], known: set[str]) -> list[dict]:
    """Big non-residential buildings, as candidate footprints.

    `src` is osm-site, NOT osm, and the distinction is the honest part of this
    whole idea. An `osm` footprint is a claim somebody made - this building is
    a data centre. An `osm-site` footprint is an inference we made: it is a
    large building standing on a site the registry already knows about. Most
    are halls. Some are the warehouse next door. Recording which is which is
    what lets a reader, or a later filter, tell them apart.
    """
    feats, seen = [], set()
    for payload in payloads:
        for e in payload.get("elements", []):
            if e["type"] == "node":
                continue
            key = f"fp-{e['type'][0]}{e['id']}"
            if key in known or key in seen:
                continue                    # already carried as a tagged feature
            geom = way_polygon(e) if e["type"] == "way" else relation_polygon(e)
            if not geom or area_m2(geom) < MIN_AREA_M2:
                continue
            seen.add(key)
            t = e.get("tags") or {}
            feats.append({
                "type": "Feature",
                "geometry": geom,
                "properties": {
                    "id": key, "osm_id": e["id"], "kind": "building",
                    "src": "osm-site", "name": t.get("name", ""),
                    "op": t.get("operator", ""),
                },
            })
    return feats


# ---- the parcel OSM already drew ---------------------------------------------
# Outside the US there is mostly no cadastre to fetch. Brazil, India, Indonesia,
# China, Russia, Argentina, Mexico and Turkey between them hold ~1,300 sites and
# publish no open parcel data at all, and the registry is 75% non-US, so the
# county work covers a quarter of it.
#
# What DOES exist almost everywhere is an OSM landuse polygon. This asks for the
# one each site stands inside - not the ones tagged as data centres, which the
# world query already has, but any landuse area at all.
#
# THE FILTER IS THE WHOLE IDEA. A landuse polygon is as often an industrial
# ESTATE as a site, and an estate is a district, not a boundary: measured on 40
# non-US sites, exactly half the containing polygons were 1-3% built by the
# site's own halls - a 1.9 km2 Australian estate holding 52,000 m2 of our
# buildings, a Bulgarian RESIDENTIAL polygon holding none. The other half were
# 26-53% built and were plainly the site itself.
#
# So the same built-ratio test that keeps a derived hull honest decides this
# too: the site's buildings must fill enough of the polygon for it to be the
# site's own ground. The upper bound catches the opposite error, a polygon
# smaller than the buildings standing on it, which is a mistagged fragment.
LANDUSE_MIN_RATIO = 0.10
LANDUSE_MAX_RATIO = 1.5
LANDUSE_MAX_M2 = 5_000_000
LANDUSE_RADIUS_M = 220
LANDUSE_DIR = RAW / "osm_site_landuse"

# Never a data centre's own parcel, whatever the ratio says.
LANDUSE_REJECT = {"residential", "forest", "grass", "meadow", "farmland", "farmyard",
                  "orchard", "vineyard", "cemetery", "allotments", "recreation_ground",
                  "village_green", "military", "quarry", "landfill", "basin"}


def landuse_query(batch: list[tuple[str, float, float]]) -> str:
    body = "\n  ".join(
        f'way["landuse"](around:{LANDUSE_RADIUS_M},{lat:.6f},{lon:.6f});\n  '
        f'rel["landuse"](around:{LANDUSE_RADIUS_M},{lat:.6f},{lon:.6f});'
        for _sid, lon, lat in batch)
    return f"[out:json][timeout:600];\n(\n  {body}\n);\nout tags geom;\n"


def fetch_site_landuse(pts, force: bool = False) -> list[dict]:
    LANDUSE_DIR.mkdir(parents=True, exist_ok=True)
    batches = [pts[i:i + SITES_PER_QUERY] for i in range(0, len(pts), SITES_PER_QUERY)]
    out = []
    for i, batch in enumerate(batches):
        dest = LANDUSE_DIR / f"batch_{i:04d}.json"
        if dest.exists() and not force:
            out.append(json.loads(dest.read_text()))
            continue
        print(f"  landuse batch {i + 1}/{len(batches)} ...", flush=True)
        try:
            payload = osm.run(landuse_query(batch))
        except Exception as e:  # noqa: BLE001
            print(f"    failed, skipping: {e}")
            continue
        dest.write_text(json.dumps(payload))
        out.append(payload)
        time.sleep(2)
    return out


def landuse_boundaries(payloads: list[dict], pts, built_by_site: dict,
                       have_boundary: set) -> tuple[list[dict], dict]:
    """The landuse polygon each uncovered site stands in, where it reads as a site."""
    shapes = []
    seen = set()
    for payload in payloads:
        for e in payload.get("elements", []):
            if e["type"] == "node":
                continue
            key = f"{e['type'][0]}{e['id']}"
            if key in seen:
                continue
            t = e.get("tags") or {}
            if t.get("landuse") in LANDUSE_REJECT:
                continue
            geom = way_polygon(e) if e["type"] == "way" else relation_polygon(e)
            if not geom:
                continue
            a = area_m2(geom)
            if not (2000 <= a <= LANDUSE_MAX_M2):
                continue
            seen.add(key)
            shapes.append((key, geom, a, t))

    grid: dict[tuple[int, int], list] = {}
    for s in shapes:
        bb = bbox_of(s[1])
        for cx in range(int(bb[0] // 0.05), int(bb[2] // 0.05) + 1):
            for cy in range(int(bb[1] // 0.05), int(bb[3] // 0.05) + 1):
                grid.setdefault((cx, cy), []).append(s)

    out, tally = [], {"district": 0, "fragment": 0, "unbuilt": 0, "kept": 0}
    used: dict[str, dict] = {}
    for sid, lon, lat in pts:
        if sid in have_boundary:
            continue
        built = built_by_site.get(sid, 0)
        best = None
        for key, geom, a, t in grid.get((int(lon // 0.05), int(lat // 0.05)), ()):
            if not contains(geom, lon, lat):
                continue
            if best is None or a < best[2]:      # the tightest one that contains it
                best = (key, geom, a, t)
        if not best:
            continue
        key, geom, a, t = best
        if not built:
            tally["unbuilt"] += 1
            continue
        ratio = built / a
        if ratio < LANDUSE_MIN_RATIO:
            tally["district"] += 1
            continue
        if ratio > LANDUSE_MAX_RATIO:
            tally["fragment"] += 1
            continue
        tally["kept"] += 1
        if key in used:                          # one parcel, several dots
            used[key]["properties"]["sites"].append(sid)
            continue
        ft = {
            "type": "Feature", "geometry": geom,
            "properties": {
                "id": f"fp-landuse-{key}", "kind": "campus", "src": "osm-landuse",
                "name": t.get("name", ""), "op": t.get("operator", ""),
                "landuse": t.get("landuse", ""),
                "sites": [sid], "built_ratio": round(ratio, 3),
            },
        }
        used[key] = ft
        out.append(ft)
    return out, tally


# ---- IM3 ---------------------------------------------------------------------

def im3_features() -> list[dict]:
    feats, seen = [], set()
    for ft in json.loads(IM3_SRC.read_text()).get("features", []):
        geom = ft.get("geometry") or {}
        if geom.get("type") not in ("Polygon", "MultiPolygon"):
            continue                    # its point records are already dots
        p = ft.get("properties") or {}
        # The file carries no ids, so derive one from the shape itself: stable
        # across runs, and two identical shapes are the same footprint anyway -
        # the atlas holds three campus rows twice, and one copy is plenty.
        digest = hashlib.sha1(json.dumps(geom["coordinates"]).encode()).hexdigest()[:10]
        if digest in seen:
            continue
        seen.add(digest)
        feats.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "id": f"fp-im3-{digest}",
                "kind": "campus" if geom["type"] == "MultiPolygon" else "building",
                "src": "im3",
                "name": p.get("name") or "",
                "op": p.get("operator") or "",
            },
        })
    return feats


# ---- site boundaries, derived from the halls --------------------------------
# A building outline says what is built; a site boundary says how far the place
# extends, and it is the thing you actually want when you ask "is this all one
# AWS campus". Three sources can answer it, and only two are facts:
#
#   landuse parcels    OSM, where a mapper drew the parcel      197 of them
#   IM3 campus layer   PNNL/DOE, US only                        132 of them
#   county parcels     the legal boundary - see parcels.py
#
# Between them they cover 259 sites of 5,068 with an outline. For the rest
# there is nothing to fetch: the AWS campus at New Albany has 35 landuse
# polygons within 1.5 km and not one of them covers its buildings.
#
# So this DERIVES a boundary from the halls themselves - the convex hull of
# every building on a site, pushed out far enough to take in the apron. It is
# an inference and it is labelled one (src=derived), because a hull is not a
# survey and the difference matters to anyone reading a boundary as ownership.
#
# WHERE IT OVER-CLAIMS, which is the honest caveat: a convex hull swallows
# everything between the buildings, so a site split by a public road claims the
# road, and an L-shaped campus claims the notch. The built-ratio floor below is
# what keeps that from becoming absurd - buildings scattered too thinly across
# their own hull are not one site, they are a bad attachment.
HULL_BUFFER_M = 25
MIN_BUILT_RATIO = 0.08
MIN_HULL_BUILDINGS = 2


def convex_hull(points: list[tuple[float, float]]) -> list[list[float]]:
    """Andrew's monotone chain. Returns an open ring, counter-clockwise."""
    pts = sorted(set(points))
    if len(pts) < 3:
        return [list(p) for p in pts]

    def half(seq):
        out = []
        for p in seq:
            while len(out) >= 2:
                (ox, oy), (ax, ay) = out[-2], out[-1]
                if (ax - ox) * (p[1] - oy) - (ay - oy) * (p[0] - ox) > 0:
                    break
                out.pop()
            out.append(p)
        return out[:-1]

    return [list(p) for p in half(pts) + half(reversed(pts))]


def push_out(ring: list[list[float]], metres: float) -> list[list[float]]:
    """Move each vertex away from the centre. Convex in, convex out."""
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    mlon = geo._m_per_deg_lon(cy) or 1.0
    out = []
    for x, y in ring:
        dx, dy = (x - cx) * mlon, (y - cy) * geo.M_PER_DEG_LAT
        d = math.hypot(dx, dy)
        if d < 1e-6:
            out.append([x, y])
            continue
        out.append([x + (dx / d) * metres / mlon,
                    y + (dy / d) * metres / geo.M_PER_DEG_LAT])
    return out


def _bbox_gap_m(a: list[float], b: list[float]) -> float:
    """Distance between two bounding boxes, zero if they touch."""
    lat = (a[1] + a[3] + b[1] + b[3]) / 4
    dx = max(0.0, max(a[0], b[0]) - min(a[2], b[2])) * geo._m_per_deg_lon(lat)
    dy = max(0.0, max(a[1], b[1]) - min(a[3], b[3])) * geo.M_PER_DEG_LAT
    return math.hypot(dx, dy)


# Halls closer than this, under one operator, are one place. Measured against
# the gap between BOUNDING BOXES rather than between centroids: a data hall is
# routinely 200 m long, so two adjacent buildings can have centroids 250 m
# apart while their walls nearly touch.
MERGE_GAP_M = 250


def derived_sites(feats: list[dict], site_operator: dict) -> tuple[list[dict], int]:
    """One boundary per CLUSTER of buildings, not per registry dot.

    Per-dot was the obvious version and it is wrong on the ground. AWS at New
    Albany is four halls that the registry splits across two site_ids, three on
    one and one on the other: hulling per dot drew a boundary round three of
    them and left the fourth outside a site it plainly belongs to. The land does
    not care how the dedupe apportioned the dots.

    So buildings are clustered by proximity, single-linkage, and merged only
    when the operators agree - which is what stops a dense Ashburn block from
    collapsing into one boundary spanning six different companies. An unknown
    operator merges with anything, because a blank is not a disagreement.
    """
    have_boundary, blds = set(), []
    for f in feats:
        p = f["properties"]
        if p["kind"] == "campus":
            have_boundary.update(p.get("sites") or ())
            continue
        if p.get("sites"):
            blds.append(f)

    def opkey(f):
        ops = {re.sub(r"[^a-z0-9]+", "", (site_operator.get(s) or "").lower())
               for s in f["properties"]["sites"]}
        return {o for o in ops if o}

    # Union-find over a coarse grid, so this stays linear rather than 19k^2.
    parent = list(range(len(blds)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        a, b = find(i), find(j)
        if a != b:
            parent[b] = a

    cell = {}
    CELL = 0.01                       # ~1 km, comfortably over MERGE_GAP_M
    for i, f in enumerate(blds):
        b = f["properties"]["bbox"]
        for cx in range(int(b[0] // CELL), int(b[2] // CELL) + 1):
            for cy in range(int(b[1] // CELL), int(b[3] // CELL) + 1):
                cell.setdefault((cx, cy), []).append(i)
    for idxs in cell.values():
        for n, i in enumerate(idxs):
            for j in idxs[n + 1:]:
                if find(i) == find(j):
                    continue
                oi, oj = opkey(blds[i]), opkey(blds[j])
                if oi and oj and not (oi & oj):
                    continue          # two named operators that disagree
                if _bbox_gap_m(blds[i]["properties"]["bbox"],
                               blds[j]["properties"]["bbox"]) <= MERGE_GAP_M:
                    union(i, j)

    groups: dict[int, list[dict]] = {}
    for i, f in enumerate(blds):
        groups.setdefault(find(i), []).append(f)

    out, thin = [], 0
    for bs in sorted(groups.values(), key=lambda g: g[0]["properties"]["id"]):
        sids = sorted({s for f in bs for s in f["properties"]["sites"]})
        if len(bs) < MIN_HULL_BUILDINGS or any(s in have_boundary for s in sids):
            continue
        sid = sids[0]
        pts = [(c[0], c[1]) for f in bs for r in geo._rings(f["geometry"]) for c in r]
        ring = convex_hull(pts)
        if len(ring) < 3:
            continue
        ring = push_out(ring, HULL_BUFFER_M)
        geom = {"type": "Polygon", "coordinates": [ring + [list(ring[0])]]}
        area = area_m2(geom)
        built = sum(f["properties"]["m2"] for f in bs)
        if not area or built / area < MIN_BUILT_RATIO:
            thin += 1
            continue
        out.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                # Keyed on the CLUSTER, not on its first site_id. Two clusters
                # can share a first site - a dot with halls on both sides of a
                # road belongs to both - and keying on it gave them the same
                # id, which the editor and the override log both treat as one
                # shape. The building ids are what actually define the cluster.
                "id": "fp-site-" + hashlib.sha1(
                    "|".join(sorted(f["properties"]["id"] for f in bs)).encode()
                ).hexdigest()[:10],
                "kind": "campus", "src": "derived",
                # Named for what it is, not for a building inside it. Borrowing
                # a hall's name would make a derived envelope look like a
                # mapped campus with a real name on it.
                "name": "", "op": bs[0]["properties"].get("op", ""),
                # Every dot the cluster stands under, not just the first: a
                # boundary drawn round four halls belongs to both site_ids the
                # registry split them across.
                "sites": sids,
                "buildings": len(bs),
                "built_ratio": round(built / area, 3),
            },
        })
    return out, thin


# ---- joins -------------------------------------------------------------------

def sites_by_osm_id() -> dict[int, set[str]]:
    out: dict[int, set[str]] = {}
    with (ROOT / "data" / "facilities_global.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r.get("osm_id") and r.get("site_id"):
                out.setdefault(int(r["osm_id"]), set()).add(r["site_id"])
    return out


def site_points() -> list[tuple[str, float, float]]:
    out = []
    with (ROOT / "data" / "facilities_sites.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r.get("lat") and r.get("lon"):
                out.append((r["site_id"], float(r["lon"]), float(r["lat"])))
    return out


class SiteGrid:
    """0.05-degree buckets, so 6k sites x 5k shapes stays linear."""

    CELL = 0.05

    def __init__(self, pts: list[tuple[str, float, float]]):
        self.cells: dict[tuple[int, int], list] = {}
        for sid, lon, lat in pts:
            key = (int(lon // self.CELL), int(lat // self.CELL))
            self.cells.setdefault(key, []).append((sid, lon, lat))

    def near_bbox(self, bbox: list[float], pad: float = 0.01) -> list:
        x0, y0, x1, y1 = bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad
        out = []
        for cx in range(int(x0 // self.CELL), int(x1 // self.CELL) + 1):
            for cy in range(int(y0 // self.CELL), int(y1 // self.CELL) + 1):
                out.extend(self.cells.get((cx, cy), []))
        return out


def attach_sites(feats: list[dict], grid: SiteGrid,
                 by_osm: dict[int, set[str]]) -> None:
    for ft in feats:
        p = ft["properties"]
        geom = ft["geometry"]
        ids = set(by_osm.get(p.get("osm_id"), ()))
        inside = [sid for sid, lon, lat in grid.near_bbox(p["bbox"])
                  if contains(geom, lon, lat)]
        ids.update(inside)
        if not ids:
            c = geo.centroid(geom)
            if c:
                best, best_d = None, NEAR_M
                for sid, lon, lat in grid.near_bbox(p["bbox"]):
                    d = dist_m(c[0], c[1], lon, lat)
                    if d < best_d:
                        best, best_d = sid, d
                if best:
                    ids.add(best)
        p["sites"] = sorted(ids)


def bbox_iou(a: list[float], b: list[float]) -> float:
    """Intersection over union of two bounding boxes."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


# Above this, two shapes are the same footprint drawn twice. Identical rings
# score 1.0; a campus boundary against a building standing inside it scores
# the building's share of the campus, which is far below this.
SAME_SHAPE_IOU = 0.5
# For the centroid test, "the same thing" also requires comparable size, so a
# campus is never deduped against a hall that happens to contain its centroid.
SAME_SIZE_RATIO = 0.5


def dedupe_im3(im3: list[dict], osm_feats: list[dict]) -> tuple[list[dict], int]:
    """Drop IM3 shapes that OSM already covers.

    IM3 is OSM-derived, so most of its buildings ARE osm ways as of the
    atlas's snapshot date. Where both have the shape, OSM wins: it is the
    live-maintained copy.

    The test is GEOMETRIC, and deliberately not "same kind, and one contains
    the other's centroid". That version leaked 85 exact duplicates into the
    layer, two ways at once:

      - `kind` is not comparable across the two sources. OSM only calls
        something a campus when it is tagged landuse=data_center; IM3 calls
        anything with multipolygon geometry a campus. Google's The Dalles site
        is one ring in both files, `building` in OSM and `campus` in IM3, so a
        kind-gated test kept both copies of an identical 42-vertex polygon.
      - A centroid is not necessarily inside its own polygon. 49 of the atlas's
        1,369 shapes are concave enough (L, U and T-shaped halls) that the area
        centroid falls outside the building, so the containment test could not
        match them against even a vertex-identical OSM twin.

    Comparing the shapes themselves has neither failure mode.
    """
    grid: dict[tuple[int, int], list] = {}
    for ft in osm_feats:
        bb = bbox_of(ft["geometry"])
        entry = (bb, ft["geometry"], area_m2(ft["geometry"]))
        for cx in range(int(bb[0] // 0.05), int(bb[2] // 0.05) + 1):
            for cy in range(int(bb[1] // 0.05), int(bb[3] // 0.05) + 1):
                grid.setdefault((cx, cy), []).append(entry)

    kept, dropped = [], 0
    for ft in im3:
        geom = ft["geometry"]
        bb = bbox_of(geom)
        mine = area_m2(geom)
        c = geo.centroid(geom)
        near = []
        for cx in range(int(bb[0] // 0.05), int(bb[2] // 0.05) + 1):
            for cy in range(int(bb[1] // 0.05), int(bb[3] // 0.05) + 1):
                near.extend(grid.get((cx, cy), ()))
        dup = False
        for obb, ogeom, oarea in near:
            if bbox_iou(bb, obb) >= SAME_SHAPE_IOU:
                dup = True
                break
            # Sizes within a factor of two AND one holds the other's centre:
            # the same building, remapped between the two snapshots.
            big, small = max(mine, oarea), min(mine, oarea)
            if big and small / big >= SAME_SIZE_RATIO:
                oc = geo.centroid(ogeom)
                if ((c and contains(ogeom, c[0], c[1]))
                        or (oc and contains(geom, oc[0], oc[1]))):
                    dup = True
                    break
        if dup:
            dropped += 1
        else:
            kept.append(ft)
    return kept, dropped


# ---- build -------------------------------------------------------------------

def main() -> None:
    payload = osm.fetch("world")
    has_geom = any(e.get("geometry") or e.get("members")
                   for e in payload.get("elements", []))
    if "--fetch" in sys.argv or not has_geom:
        # The cache predates the switch to `out geom` (or a refresh was asked
        # for). A failed refresh falls back to whatever the cache holds, which
        # for a pre-geometry cache means an IM3-only build - stated, not silent.
        why = "cache has no geometry" if not has_geom else "--fetch"
        print(f"refetching OSM world geometry ({why}) ...")
        try:
            payload = osm.fetch("world", force=True)
        except Exception as e:  # noqa: BLE001
            print(f"  refresh failed ({e}); continuing with the cache")
            payload = osm.fetch("world")

    osm_feats, unclosed = osm_features(payload)
    im3_raw = im3_features()
    im3_kept, im3_dropped = dedupe_im3(im3_raw, osm_feats)
    feats = osm_feats + im3_kept

    for ft in feats:
        ft["properties"]["bbox"] = bbox_of(ft["geometry"])
        ft["properties"]["m2"] = area_m2(ft["geometry"])

    # The untagged halls. Runs only when asked or when a cache already exists,
    # because it is ~60 Overpass queries against a volunteer-run service and
    # nobody should pay that cost by accident.
    pts = site_points()
    near_feats = []
    if "--near" in sys.argv or NEAR_DIR.exists():
        campus_bboxes = [f["properties"]["bbox"] for f in feats
                         if f["properties"]["kind"] == "campus"]
        print(f"fetching every building within {NEAR_RADIUS_M} m of {len(pts)} sites "
              f"and inside {len(campus_bboxes)} campus boundaries ...")
        payloads = fetch_site_buildings(pts, campus_bboxes, force="--refetch-near" in sys.argv)
        known = {f["properties"]["id"] for f in feats}
        near_feats = site_building_features(payloads, known)
        for ft in near_feats:
            ft["properties"]["bbox"] = bbox_of(ft["geometry"])
            ft["properties"]["m2"] = area_m2(ft["geometry"])
        feats += near_feats

    # County parcels, if src/parcels.py has been run. The recorded boundary
    # beats anything computed, so these go in BEFORE the hulls are derived -
    # derived_sites() skips any site that already has a campus boundary, and a
    # parcel is the best one available.
    parcel_feats = []
    # Two files because there are two protocols: parcels.py speaks ArcGIS REST
    # to US counties and the land agencies that run it, wfs_parcels.py speaks
    # OGC WFS to most of Europe. Same claim on the way out, so they merge here
    # and share the geometry dedupe below.
    #
    # parcels_regrid.py is deliberately NOT in this list yet: its output is a
    # separate REGRID layer on the map, bought partly to be VERIFIED against
    # the footprints this file builds. It merges here only after that
    # comparison earns it a place - a source should not certify itself.
    parcel_files = [p for p in (PARCELS, PARCELS_WFS, PARCELS_UK, PARCELS_JP,
                            PARCELS_SCOT, PARCELS_FR, PARCELS_PCY_INTL) if p.exists()]
    if parcel_files:
        # Deduped ON GEOMETRY, because the same parcel legitimately arrives
        # twice: two sites standing on one lot each point-query it, and a
        # multi-part parcel is several rows sharing one parcel id in the county
        # layer. Keying on the id alone would collide; keying on the shape is
        # what "the same parcel" actually means.
        seen = {}
        for ft in [f for p in parcel_files
                   for f in json.loads(p.read_text()).get("features", [])]:
            if not ft.get("geometry"):
                continue
            key = hashlib.sha1(
                json.dumps(ft["geometry"]["coordinates"]).encode()).hexdigest()
            if key in seen:
                continue
            seen[key] = ft
            ft["properties"]["id"] = f"{ft['properties']['id']}-{key[:6]}"
            ft["properties"]["bbox"] = bbox_of(ft["geometry"])
            ft["properties"]["m2"] = area_m2(ft["geometry"])
            parcel_feats.append(ft)
        feats += parcel_feats

    grid = SiteGrid(pts)
    attach_sites(feats, grid, sites_by_osm_id())

    # An INFERRED building that lands on no site is just a big building. The
    # tagged ones are kept regardless - somebody asserted those are data
    # centres, and an unattached one is a gap in the registry rather than
    # noise in the layer - but nothing here vouches for an osm-site shape
    # except its proximity to a dot, so without a dot it has no reason to be
    # on the map.
    orphans = [f for f in feats
               if f["properties"]["src"] == "osm-site" and not f["properties"]["sites"]]
    if orphans:
        drop = {id(f) for f in orphans}
        feats = [f for f in feats if id(f) not in drop]

    # An OSM landuse parcel, where a site stands in one and it reads as the
    # site's own ground rather than the estate around it. Ranked between the
    # county parcels above and the hulls below: a mapper drew this, so it beats
    # a convex hull, but nobody recorded it as a boundary, so a cadastral
    # record beats it.
    landuse_feats, tally = [], {}
    if "--landuse" in sys.argv or LANDUSE_DIR.exists():
        built_by_site: dict[str, float] = {}
        for f in feats:
            if f["properties"]["kind"] != "building":
                continue
            for s in f["properties"].get("sites") or ():
                built_by_site[s] = built_by_site.get(s, 0) + f["properties"]["m2"]
        have = {s for f in feats if f["properties"]["kind"] == "campus"
                for s in f["properties"].get("sites") or ()}
        print(f"fetching landuse parcels round {len(pts) - len(have)} sites "
              f"without a boundary ...")
        payloads = fetch_site_landuse(pts, force="--refetch-landuse" in sys.argv)
        landuse_feats, tally = landuse_boundaries(payloads, pts, built_by_site, have)
        for ft in landuse_feats:
            ft["properties"]["bbox"] = bbox_of(ft["geometry"])
            ft["properties"]["m2"] = area_m2(ft["geometry"])
        feats += landuse_feats

    # Site boundaries last, so they see the final set of buildings and skip any
    # site that already has a real one.
    site_operator = {}
    with (ROOT / "data" / "facilities_sites.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            site_operator[r["site_id"]] = r.get("operator") or ""
    hulls, thin = derived_sites(feats, site_operator)
    for ft in hulls:
        ft["properties"]["bbox"] = bbox_of(ft["geometry"])
        ft["properties"]["m2"] = area_m2(ft["geometry"])
    feats += hulls

    # IDS MUST BE UNIQUE, and this is the only place that can promise it.
    # Every id here is derived from something - an OSM element, a parcel
    # reference, a geometry hash - and each of those has been observed to
    # collide: county layers repeat a parcel id across the parts of one
    # multi-part parcel, two sites point-query the same lot, and a cluster key
    # can repeat. An id is what the editor looks a shape up by and what
    # footprint_overrides.geojsonl keys on, so a duplicate means a correction
    # silently lands on the wrong building. Loud, and fixed in place.
    by_id: dict[str, int] = {}
    collisions = 0
    for ft in feats:
        pid = ft["properties"]["id"]
        if pid in by_id:
            collisions += 1
            by_id[pid] += 1
            ft["properties"]["id"] = f"{pid}-{by_id[pid]}"
        else:
            by_id[pid] = 1
    if collisions:
        print(f"  NOTE: {collisions} duplicate id(s) suffixed to keep them unique")

    fc = {"type": "FeatureCollection", "features": feats}
    DEST.write_text(json.dumps(fc))

    n = len(feats)
    campuses = sum(1 for f in feats if f["properties"]["kind"] == "campus")
    attached = sum(1 for f in feats if f["properties"]["sites"])
    covered = len({s for f in feats for s in f["properties"]["sites"]})
    print(f"wrote {DEST.relative_to(ROOT)}  ({n} footprints, "
          f"{(DEST.stat().st_size / 1e6):.1f} MB)")
    print(f"  osm tagged   : {len(osm_feats)} ({unclosed} unclosed/unassembled dropped)")
    print(f"  im3          : {len(im3_kept)} kept, {im3_dropped} already in OSM")
    if near_feats:
        print(f"  osm-site     : {len(near_feats) - len(orphans)} large buildings on a "
              f"registry site ({len(orphans)} dropped, attached to nothing)")
    if parcel_feats:
        pa = sum(1 for f in parcel_feats if f["properties"]["sites"])
        print(f"  parcels      : {len(parcel_feats)} county parcel boundaries "
              f"({pa} land on a registry site)")
    if landuse_feats:
        print(f"  osm-landuse  : {len(landuse_feats)} parcels a mapper drew "
              f"({tally['district']} rejected as industrial estates, "
              f"{tally['fragment']} smaller than the buildings on them, "
              f"{tally['unbuilt']} with no building to measure against)")
    if hulls:
        print(f"  derived      : {len(hulls)} site boundaries hulled from their own "
              f"buildings ({thin} too thinly built to call one site)")
    print(f"  campuses     : {campuses}   buildings: {n - campuses}")
    print(f"  attached     : {attached}/{n} carry at least one site_id")
    print(f"  sites covered: {covered}/{len(pts)} "
          f"({covered / max(1, len(pts)):.0%} of mapped sites now have an outline)")


if __name__ == "__main__":
    main()
