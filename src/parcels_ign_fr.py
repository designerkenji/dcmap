#!/usr/bin/env python3
"""French parcel boundaries by point, from IGN's API Carto cadastre module.

    python3 parcels_ign_fr.py [--limit N]

The French member of the free-cadastre family (parcels_inspire_uk.py,
parcels_moj_jp.py, parcels_ros_scotland.py): a national register, no billing,
no key, and the answer is authoritative rather than assembled. France is the
EASY one - where the UK ships 318 GML zips to be reprojected off Airy 1830,
IGN answers a point query with WGS84 GeoJSON in one round trip.

Same claim on the way out as the rest of the family - kind=campus, src=parcel
- and footprints.py merges the output alongside them. The in-app "Pull French
cadastre parcel" button shares nothing with this file ON PURPOSE: the button
is an aimed, per-site preview into the vendor layer; this sweep writes campus
boundaries wholesale, and its cache answers only for the site list it swept.

TWO PASSES, LIKE THE UK RUN PROVED NECESSARY
  pass 1  the parcel containing the site's dot.
  pass 2  for dots that hit nothing: the parcel containing the site's mapped
          building centroids, largest building first. A dot geocoded to the
          road outside the gate sits on unparcelled highway; a rooftop
          centroid cannot. Features won this way carry via=building-centroid.

Every asked site is cached under data/raw/parcels_fr_cache/<sid>.json ({} for
"nothing contains this point"), and the output file is rebuilt from the WHOLE
cache each run, so re-runs only ask about new sites and nothing already won
is ever dropped (the wfs_parcels.py single-source clobber, avoided by
construction). The API is free; empties are re-asked on the next run only if
their cache file is deleted, because a free question is still a request
against a public service.

LICENCE: Etalab Licence Ouverte 2.0. The polygons are the plan cadastral -
indicative extents, which is exactly a campus boundary's job here.
"""

from __future__ import annotations

import argparse
import csv
import json
import pathlib
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CACHE = RAW / "parcels_fr_cache"
DEST = RAW / "parcels_fr.geojson"
API = "https://apicarto.ign.fr/api/cadastre/parcelle"
UA = {"User-Agent": "reinsurance_dc-research/1.0"}
PAUSE = 0.35   # a public service, not a race


def rings_of(geom):
    if not geom:
        return []
    if geom["type"] == "Polygon":
        return geom["coordinates"]
    if geom["type"] == "MultiPolygon":
        return [r for poly in geom["coordinates"] for r in poly]
    return []


def contains(geom, lon, lat):
    inside = 0
    for ring in rings_of(geom):
        c = False
        for i in range(len(ring)):
            xi, yi = ring[i]
            xj, yj = ring[i - 1]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                c = not c
        if c:
            inside += 1
    return inside % 2 == 1


def ask(lon: float, lat: float) -> dict | None:
    """The parcel containing the point, or None. One retry on a 5xx."""
    q = urllib.parse.urlencode({"geom": json.dumps(
        {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]})})
    for attempt in (1, 2):
        try:
            req = urllib.request.Request(f"{API}?{q}", headers=UA)
            with urllib.request.urlopen(req, timeout=60) as fh:
                fc = json.load(fh)
            break
        except urllib.error.HTTPError as e:
            if e.code >= 500 and attempt == 1:
                time.sleep(3)
                continue
            raise
    for f in fc.get("features") or []:
        if f.get("geometry") and contains(f["geometry"], lon, lat):
            return {"geometry": f["geometry"], "attrs": f.get("properties") or {}}
    return None


def needy_fr() -> list[dict]:
    """FR sites, exactly located, without a real campus boundary."""
    fp = json.loads((ROOT / "data" / "footprints.geojson").read_text())
    real = set()
    for f in fp["features"]:
        p = f["properties"]
        if p["kind"] == "campus" and p["src"] not in ("derived", "osm-landuse"):
            real.update(p.get("sites") or ())
    out = []
    with (ROOT / "data" / "facilities_sites.csv").open(encoding="utf-8") as fh:
        for s in csv.DictReader(fh):
            if s.get("country") != "FR" or not s.get("lat"):
                continue
            if (s.get("geo_precision") or "exact") != "exact" or s["site_id"] in real:
                continue
            out.append({"sid": s["site_id"], "lat": float(s["lat"]), "lon": float(s["lon"])})
    return out


def building_centroids() -> dict[str, list]:
    """sid -> centroids of its mapped buildings, largest first (the pass-2
    anchor - see parcels_inspire_uk.py for why the rooftop beats the kerb)."""
    fp = json.loads((ROOT / "data" / "footprints.geojson").read_text())
    per: dict[str, list] = {}
    for f in fp["features"]:
        p = f["properties"]
        if p.get("kind") != "building" or not p.get("sites"):
            continue
        g = f.get("geometry") or {}
        rings = rings_of(g)
        if not rings:
            continue
        ring = rings[0]
        lon = sum(pt[0] for pt in ring) / len(ring)
        lat = sum(pt[1] for pt in ring) / len(ring)
        # shoelace, purely for ordering
        area = abs(sum(ring[i][0] * ring[i - 1][1] - ring[i - 1][0] * ring[i][1]
                       for i in range(len(ring))))
        for sid in p["sites"]:
            per.setdefault(sid, []).append((area, lon, lat))
    return {sid: [(lon, lat) for _, lon, lat in sorted(v, reverse=True)]
            for sid, v in per.items()}


def write_out() -> int:
    feats = []
    for cf in sorted(CACHE.glob("*.json")):
        hit = json.loads(cf.read_text())
        if not hit or not hit.get("geometry"):
            continue
        a = hit.get("attrs") or {}
        props = {
            "id": f"fp-parcel-fr-{a.get('idu') or cf.stem}",
            "kind": "campus", "src": "parcel",
            "name": "", "op": "",          # the cadastre never names owners
            "ref": a.get("idu") or "",
            "locality": ", ".join(x for x in (a.get("nom_com"), "FR") if x),
            "acres": "", "for_site": cf.stem,
        }
        if hit.get("via"):
            props["via"] = hit["via"]
        feats.append({"type": "Feature", "geometry": hit["geometry"],
                      "properties": props})
    DEST.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    return len(feats)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="stop after N new asks")
    args = ap.parse_args()

    CACHE.mkdir(parents=True, exist_ok=True)
    sites = needy_fr()
    centroids = building_centroids()
    print(f"{len(sites)} needy FR sites")

    asked = hits = via_bldg = 0
    for s in sites:
        cf = CACHE / f"{s['sid']}.json"
        if cf.exists():
            continue
        if args.limit and asked >= args.limit:
            break
        asked += 1
        hit = ask(s["lon"], s["lat"])
        time.sleep(PAUSE)
        if not hit:
            for lon, lat in centroids.get(s["sid"], [])[:3]:
                hit = ask(lon, lat)
                time.sleep(PAUSE)
                if hit:
                    hit["via"] = "building-centroid"
                    via_bldg += 1
                    break
        if hit:
            hits += 1
        cf.write_text(json.dumps(hit or {}))
        if asked % 25 == 0:
            print(f"  {asked} asked, {hits} parcels ({via_bldg} via buildings)")

    n = write_out()
    print(f"{asked} asked this run, {hits} new parcels ({via_bldg} via building"
          f" centroids) -> {DEST.relative_to(ROOT)} holds {n}")


if __name__ == "__main__":
    main()
