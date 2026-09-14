"""Scottish parcel boundaries from Registers of Scotland's INSPIRE service.

    python3 parcels_ros_scotland.py

The Scottish gap in parcels_inspire_uk.py turns out to be closeable: RoS
relaunched its INSPIRE Cadastral Parcels service (March 2025, hosted at
ros-inspire.themapcloud.com) under OGL v3 with no auth, and unlike HMLR it
answers POINT QUERIES - WMS GetFeatureInfo with info_format=application/json
returns the containing parcel's full geometry. So this is a query client
like the French cadastre one, not a download-and-join: one request per
needy Scottish site, plus the building-centroid second chance the England
matcher grew (INSPIRE maps registered land; kerbs are not registered).

The needy list and the LA cache are parcels_inspire_uk.py's own - a site is
Scottish when the ONS authority it already resolved to is one of the 32
Scottish councils. Coordinates go out in EPSG:27700; rather than a second,
subtly different Helmert, the forward transform inverts uk.en_to_ll
numerically, so both directions are the same proven arithmetic.

Trust, but verify: the service's answer is only accepted if the returned
polygon actually CONTAINS the query point after conversion back to WGS84
(smallest containing wins - RoS's model allows stacked/overlapping titles).

CAVEATS from RoS's own spec: Land Register titles only (~61% of Scotland by
area; Sasines-only land is absent), ~30% of titles excluded (leases, flats,
ambiguity), extents are indicative. Commercial sites are the well-registered
kind, which is why this is worth one request per site.

LICENCE: OGL v3. Attribution: "(c) Crown copyright. Reproduced with the
permission of Registers of Scotland. Contains OS data (c) Crown copyright
and database right 2026." Travels here, in the summary line, and the README.

Output: data/raw/parcels_scotland.geojson (own file, own writer), merged by
footprints.py alongside the other parcel files (kind=campus, src=parcel).
"""

from __future__ import annotations

import json
import math
import pathlib
import time
import urllib.parse
import urllib.request

import geo
import parcels_inspire_uk as uk

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CACHE = RAW / "ros_cache"
DEST = RAW / "parcels_scotland.geojson"
WMS = "https://ros-inspire.themapcloud.com/maps/wms"
UA = {"User-Agent": "reinsurance_dc-research/1.0 (OGL INSPIRE parcels)"}

SCOTTISH_LADS = {
    "Aberdeen City", "Aberdeenshire", "Angus", "Argyll and Bute",
    "City of Edinburgh", "Clackmannanshire", "Dumfries and Galloway",
    "Dundee City", "East Ayrshire", "East Dunbartonshire", "East Lothian",
    "East Renfrewshire", "Falkirk", "Fife", "Glasgow City", "Highland",
    "Inverclyde", "Midlothian", "Moray", "Na h-Eileanan Siar",
    "North Ayrshire", "North Lanarkshire", "Orkney Islands",
    "Perth and Kinross", "Renfrewshire", "Scottish Borders",
    "Shetland Islands", "South Ayrshire", "South Lanarkshire", "Stirling",
    "West Dunbartonshire", "West Lothian",
}


def ll_to_en(lon: float, lat: float) -> tuple[float, float]:
    """WGS84 -> EPSG:27700 by inverting uk.en_to_ll numerically.

    The local Jacobian is near-identity times the metre scale, so a few
    fixed-point steps land under a metre - and there is exactly one Helmert
    in the codebase to be wrong about.
    """
    E, N = 400000.0, 500000.0
    for _ in range(12):
        glon, glat = uk.en_to_ll(E, N)
        dE = (lon - glon) * 111320 * math.cos(math.radians(lat))
        dN = (lat - glat) * 111320
        E, N = E + dE, N + dN
        if abs(dE) < 0.5 and abs(dN) < 0.5:
            break
    return E, N


def rings_ll(geom: dict) -> list:
    """Geometry rings as WGS84 lon/lat, whatever CRS the server answered in."""
    if geom["type"] == "Polygon":
        polys = [geom["coordinates"]]
    elif geom["type"] == "MultiPolygon":
        polys = geom["coordinates"]
    else:
        return []
    out = []
    for poly in polys:
        for ring in poly:
            if not ring:
                continue
            if abs(ring[0][0]) > 180:      # easting/northing, convert
                out.append([list(uk.en_to_ll(x, y)) for x, y in ring])
            else:
                out.append([[x, y] for x, y in ring])
    return out


def parcel_at(lon: float, lat: float) -> dict | None:
    """The parcel containing this point, or None - smallest containing wins."""
    E, N = ll_to_en(lon, lat)
    q = urllib.parse.urlencode({
        "service": "WMS", "version": "1.3.0", "request": "GetFeatureInfo",
        "layers": "CP.CadastralParcel", "query_layers": "CP.CadastralParcel",
        "crs": "EPSG:27700",
        "bbox": f"{E - 100},{N - 100},{E + 100},{N + 100}",
        "width": "200", "height": "200", "i": "100", "j": "100",
        "info_format": "application/json", "feature_count": "5"})
    out = json.loads(urllib.request.urlopen(
        urllib.request.Request(f"{WMS}?{q}", headers=UA), timeout=60).read())
    best = None
    for f in out.get("features") or []:
        if not f.get("geometry"):
            continue
        rings = rings_ll(f["geometry"])
        gj = {"type": "Polygon", "coordinates":
              [r + [r[0]] if r[0] != r[-1] else r for r in rings]}
        if sum(1 for r in geo._rings(gj)
               if geo._in_ring(lon, lat, r)) % 2 != 1:
            continue
        area = abs(sum((r[i][0] - r[i - 1][0]) * (r[i][1] + r[i - 1][1])
                       for r in rings for i in range(1, len(r))))
        pid = (f.get("properties") or {}).get("inspireid") \
            or (f.get("properties") or {}).get("INSPIREID") or f.get("id") or ""
        if best is None or area < best[0]:
            best = (area, {"ref": str(pid), "geometry": gj})
    return best[1] if best else None


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    lads = {}
    targets = []
    for s in uk.needy_gb():
        cf = uk.LA_CACHE / f"{s['sid']}.json"
        lad = json.loads(cf.read_text())["lad"] if cf.exists() else ""
        if lad in SCOTTISH_LADS:
            targets.append(s)
            lads[s["sid"]] = lad
    print(f"{len(targets)} Scottish sites without a recorded boundary")

    bcents = uk.building_centroids()
    for s in targets:
        cf = CACHE / f"{s['sid']}.json"
        if cf.exists():
            continue
        hit, via = None, ""
        try:
            hit = parcel_at(s["lon"], s["lat"])
            if not hit:
                for cx, cy in bcents.get(s["sid"], ()):
                    hit = parcel_at(cx, cy)
                    if hit:
                        via = "building-centroid"
                        break
        except Exception as e:  # noqa: BLE001
            print(f"  {s['sid']} ({lads[s['sid']]}): {e}")
            continue
        if hit:
            hit["via"] = via
        cf.write_text(json.dumps(hit or {}))
        print(f"  {s['sid']} ({lads[s['sid']]}): "
              f"{'parcel ' + hit['ref'] + (' via ' + via if via else '') if hit else 'nothing registered at the point'}")
        time.sleep(1.0)

    feats = []
    for p in sorted(CACHE.glob("*.json")):
        rec = json.loads(p.read_text())
        if not rec:
            continue
        props = {"id": f"fp-parcel-scot-{rec['ref'] or p.stem}",
                 "kind": "campus", "src": "parcel", "name": "", "op": "",
                 "ref": rec["ref"], "locality": lads.get(p.stem, "Scotland"),
                 "acres": "", "for_site": p.stem}
        if rec.get("via"):
            props["via"] = rec["via"]
        feats.append({"type": "Feature", "geometry": rec["geometry"],
                      "properties": props})
    DEST.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    print(f"wrote {DEST.relative_to(ROOT)}: {len(feats)} parcels")
    print("(c) Crown copyright. Reproduced with the permission of Registers "
          "of Scotland. Contains OS data (c) Crown copyright and database "
          "right 2026. OGL v3.")


if __name__ == "__main__":
    main()
