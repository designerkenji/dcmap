"""UK parcel boundaries from HM Land Registry's INSPIRE index polygons.

    python3 parcels_inspire_uk.py

There is no UK point-to-parcel API at the free tier: HMLR publishes INSPIRE
index polygons as one downloadable zip of GML PER LOCAL AUTHORITY (318 of
them, England and Wales only). So this is a download-and-join, not a query
client: resolve each needy site to its local authority, fetch only those
authorities' files, and point-in-polygon locally.

THE STEPS, AND WHERE EACH ANSWER COMES FROM
  site -> local authority   ONS's Local Authority Districts boundary service,
                            one ArcGIS point query per site, cached. The ONS
                            name ("Barnet") and HMLR's file name
                            ("London_Borough_of_Barnet.zip") differ by
                            ceremony, so matching strips the ceremony: drop
                            council/borough/district/city/... tokens from the
                            file name and require the rest to cover the ONS
                            name's tokens.
  authority -> parcels      use-land-property-data.service.gov.uk zip, cached
                            under data/raw/uk_inspire/. GML inside is
                            EPSG:27700 (British National Grid).
  27700 -> WGS84            Airy-1830 inverse transverse Mercator, then a
                            7-parameter Helmert. Good to ~5 m, which against
                            parcels drawn at 1:1250 is invisible.
  site -> its parcel        containment or nothing, as everywhere else - in
                            two passes. Pass 1: the parcel containing the
                            site's dot. Pass 2, for dots that hit nothing:
                            the parcel(s) containing the site's BUILDING
                            footprint centroids. INSPIRE maps registered land
                            only, so a dot geocoded to the road outside the
                            gate sits in a gap between polygons; a rooftop
                            centroid cannot. Still containment, just of the
                            building instead of the dot - the first live run
                            left 15 English sites 9-283 m from their parcel
                            this way, 14 of them with mapped buildings.
                            Pass-2 features carry via=building-centroid.

SCOTLAND IS REPORTED, NOT SILENTLY DROPPED. HMLR covers England and Wales;
Registers of Scotland sells its cadastre separately. Sites whose authority
matches no file are counted and named in the output summary.

LICENCE: the polygons are OGL v3. The required acknowledgment - "This
information is subject to Crown copyright and database rights [year] and is
reproduced with the permission of HM Land Registry" - travels in this file,
the README, and the popup label chain. INSPIRE polygons are INDICATIVE title
extents (generalised, freeholds only), which is exactly a campus boundary's
job here.

Output: data/raw/parcels_uk.geojson, merged by footprints.py alongside the
ArcGIS and WFS parcel files (kind=campus, src=parcel). The write is
INCREMENTAL: once footprints.py has merged a run's parcels, those sites stop
being needy, so a later run sees only the leftovers - rewriting the file
from one run's matches alone would silently drop every parcel already won
(the wfs_parcels.py single-source clobber, rediscovered here). Existing
features are kept unless this run re-matched their site.
"""

from __future__ import annotations

import csv
import io
import json
import math
import pathlib
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

import geo

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
ZIPS = RAW / "uk_inspire"
LA_CACHE = RAW / "uk_la_cache"
DEST = RAW / "parcels_uk.geojson"
FILE_LIST = RAW / "uk_inspire_files.json"
UA = {"User-Agent": "reinsurance_dc-research/1.0 (OGL INSPIRE polygons)"}

ONS = ("https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/"
       "Local_Authority_Districts_May_2024_Boundaries_UK_BUC/FeatureServer/0/query")
HMLR = "https://use-land-property-data.service.gov.uk/datasets/inspire/download/"

# Ceremony tokens HMLR file names carry and ONS names may not. 'and'/'upon'
# etc. stay - they are part of real names (Bath and North East Somerset).
CEREMONY = {"council", "borough", "district", "city", "county", "metropolitan",
            "corporation", "london", "royal", "the", "of"}


def toks(s: str) -> set:
    return {t for t in re.split(r"[^a-z]+", s.lower()) if t}


def match_file(lad: str, files: list[str]) -> str | None:
    # ONS writes "Bristol, City of" - fold the ceremony clause back in.
    lad = re.sub(r",\s*(city|county)\s+of\s*$", "", lad, flags=re.I)
    want = toks(lad) - CEREMONY
    best, best_extra = None, 99
    for f in files:
        have = toks(f[:-4]) - CEREMONY
        if want <= have:
            extra = len(have - want)
            if extra < best_extra:
                best, best_extra = f, extra
    if best:
        return best
    # The reverse reading, for names where the COUNCIL is the shorter one:
    # "Newcastle upon Tyne" is the district, "Newcastle City Council" the
    # file, and {newcastle} is a subset of the district's tokens, not a
    # superset. Only exact-ish reversals qualify - at most one spare token -
    # so "North" cannot claim "North Yorkshire".
    for f in files:
        have = toks(f[:-4]) - CEREMONY
        if have and have <= want and len(want - have) <= 2:
            return f
    return None


# ---- EPSG:27700 -> WGS84 ----------------------------------------------------
# Inverse transverse Mercator on Airy 1830, then Helmert to WGS84. Standard
# constants from the OS's own guide; ~5 m absolute, which is under the line
# width these parcels are drawn at.
def en_to_ll(E: float, N: float) -> tuple[float, float]:
    a, b = 6377563.396, 6356256.909            # Airy 1830
    F0, lat0, lon0 = 0.9996012717, math.radians(49), math.radians(-2)
    E0, N0 = 400000.0, -100000.0
    e2 = 1 - (b * b) / (a * a)
    n = (a - b) / (a + b)
    lat = lat0
    M = 0.0
    while True:
        lat = (N - N0 - M) / (a * F0) + lat
        dl, sl = lat - lat0, lat + lat0
        M = b * F0 * (
            (1 + n + 1.25 * n * n + 1.25 * n ** 3) * dl
            - (3 * n + 3 * n * n + 2.625 * n ** 3) * math.sin(dl) * math.cos(sl)
            + (1.875 * n * n + 1.875 * n ** 3) * math.sin(2 * dl) * math.cos(2 * sl)
            - (35 / 24) * n ** 3 * math.sin(3 * dl) * math.cos(3 * sl))
        if abs(N - N0 - M) < 1e-5:
            break
    sin_l, cos_l, tan_l = math.sin(lat), math.cos(lat), math.tan(lat)
    nu = a * F0 / math.sqrt(1 - e2 * sin_l ** 2)
    rho = a * F0 * (1 - e2) * (1 - e2 * sin_l ** 2) ** -1.5
    eta2 = nu / rho - 1
    VII = tan_l / (2 * rho * nu)
    VIII = tan_l / (24 * rho * nu ** 3) * (5 + 3 * tan_l ** 2 + eta2 - 9 * tan_l ** 2 * eta2)
    IX = tan_l / (720 * rho * nu ** 5) * (61 + 90 * tan_l ** 2 + 45 * tan_l ** 4)
    X = 1 / (cos_l * nu)
    XI = 1 / (cos_l * 6 * nu ** 3) * (nu / rho + 2 * tan_l ** 2)
    XII = 1 / (cos_l * 120 * nu ** 5) * (5 + 28 * tan_l ** 2 + 24 * tan_l ** 4)
    XIIA = 1 / (cos_l * 5040 * nu ** 7) * (61 + 662 * tan_l ** 2 + 1320 * tan_l ** 4 + 720 * tan_l ** 6)
    dE = E - E0
    lat_os = lat - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6
    lon_os = lon0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7

    # OSGB36 -> WGS84 Helmert
    sin_p, cos_p = math.sin(lat_os), math.cos(lat_os)
    nu2 = a / math.sqrt(1 - e2 * sin_p ** 2)
    x = nu2 * cos_p * math.cos(lon_os)
    y = nu2 * cos_p * math.sin(lon_os)
    z = (1 - e2) * nu2 * sin_p
    tx, ty, tz = 446.448, -125.157, 542.060
    s = 20.4894e-6
    rx, ry, rz = (math.radians(v / 3600) for v in (0.1502, 0.2470, 0.8421))
    x2 = tx + (1 + s) * x - rz * y + ry * z
    y2 = ty + rz * x + (1 + s) * y - rx * z
    z2 = tz - ry * x + rx * y + (1 + s) * z
    a84, b84 = 6378137.0, 6356752.3142
    e284 = 1 - (b84 * b84) / (a84 * a84)
    p = math.hypot(x2, y2)
    lat_w = math.atan2(z2, p * (1 - e284))
    for _ in range(6):
        nu3 = a84 / math.sqrt(1 - e284 * math.sin(lat_w) ** 2)
        lat_w = math.atan2(z2 + e284 * nu3 * math.sin(lat_w), p)
    return math.degrees(math.atan2(y2, x2)), math.degrees(lat_w)


# ---- the join ---------------------------------------------------------------

def needy_gb() -> list[dict]:
    fp = json.loads((ROOT / "data" / "footprints.geojson").read_text())
    real = set()
    for f in fp["features"]:
        p = f["properties"]
        if p["kind"] == "campus" and p["src"] not in ("derived", "osm-landuse"):
            real.update(p.get("sites") or ())
    out = []
    with (ROOT / "data" / "facilities_sites.csv").open(encoding="utf-8") as fh:
        for s in csv.DictReader(fh):
            if s.get("country") != "GB" or not s.get("lat"):
                continue
            if (s.get("geo_precision") or "exact") != "exact" or s["site_id"] in real:
                continue
            out.append({"sid": s["site_id"], "lat": float(s["lat"]), "lon": float(s["lon"])})
    return out


def building_centroids() -> dict[str, list]:
    """sid -> centroids of its mapped buildings, largest building first.

    The pass-2 anchor: a building footprint is tied to its site by identity
    (OSM tagging, Overture back-fill), not by the dot, so its centroid stays
    on the rooftop even when the dot was geocoded to the kerb.
    """
    fp = json.loads((ROOT / "data" / "footprints.geojson").read_text())
    per: dict[str, list] = {}
    for f in fp["features"]:
        p = f["properties"]
        if p.get("kind") != "building" or not p.get("sites"):
            continue
        g = f.get("geometry") or {}
        ring = (g.get("coordinates") or [[]])[0] if g.get("type") == "Polygon" \
            else ((g.get("coordinates") or [[[]]])[0] or [[]])[0]
        if len(ring) < 4:
            continue
        cx = sum(pt[0] for pt in ring) / len(ring)
        cy = sum(pt[1] for pt in ring) / len(ring)
        for sid in p["sites"]:
            per.setdefault(sid, []).append((p.get("m2") or 0, cx, cy))
    return {sid: [(x, y) for _, x, y in sorted(v, reverse=True)]
            for sid, v in per.items()}


def la_of(site: dict) -> str:
    LA_CACHE.mkdir(parents=True, exist_ok=True)
    cf = LA_CACHE / f"{site['sid']}.json"
    if cf.exists():
        return json.loads(cf.read_text())["lad"]
    q = urllib.parse.urlencode({
        "geometry": f"{site['lon']},{site['lat']}", "geometryType": "esriGeometryPoint",
        "inSR": "4326", "spatialRel": "esriSpatialRelIntersects",
        "outFields": "LAD24NM", "returnGeometry": "false", "f": "json"})
    out = json.loads(urllib.request.urlopen(
        urllib.request.Request(f"{ONS}?{q}", headers=UA), timeout=60).read())
    feats = out.get("features") or []
    lad = feats[0]["attributes"]["LAD24NM"] if feats else ""
    cf.write_text(json.dumps({"lad": lad}))
    time.sleep(0.3)
    return lad


def fetch_zip(fname: str) -> pathlib.Path | None:
    ZIPS.mkdir(parents=True, exist_ok=True)
    dest = ZIPS / fname
    if dest.exists():
        return dest
    # The service redirects to S3; a cookie processor rides the hop chain.
    import http.cookiejar
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    try:
        with opener.open(urllib.request.Request(HMLR + fname, headers=UA),
                         timeout=300) as r:
            dest.write_bytes(r.read())
        time.sleep(1.0)
        return dest
    except Exception as e:  # noqa: BLE001
        print(f"    {fname}: download failed ({e})")
        return None


def parcels_from(zp: pathlib.Path):
    """(inspire_id, rings-in-WGS84, bbox) for every polygon in one LA file."""
    with zipfile.ZipFile(zp) as z:
        gml_name = next(n for n in z.namelist() if n.endswith(".gml"))
        root = ET.parse(io.TextIOWrapper(z.open(gml_name), encoding="utf-8",
                                         errors="replace")).getroot()
    out = []
    for member in root.iter():
        if not member.tag.endswith("member"):
            continue
        for feat in list(member):
            pid = ""
            for el in feat.iter():
                if el.tag.endswith("localId") and el.text:
                    pid = el.text.strip()
                    break
            rings = []
            for el in feat.iter():
                if el.tag.endswith("posList") and el.text:
                    v = [float(x) for x in el.text.split()]
                    ring = [list(en_to_ll(v[i], v[i + 1]))
                            for i in range(0, len(v) - 1, 2)]
                    if len(ring) >= 4:
                        rings.append(ring)
            if rings:
                xs = [p[0] for r in rings for p in r]
                ys = [p[1] for r in rings for p in r]
                out.append((pid, rings, (min(xs), min(ys), max(xs), max(ys))))
    return out


def main() -> None:
    files = json.loads(FILE_LIST.read_text())
    sites = needy_gb()
    print(f"{len(sites)} GB sites without a recorded boundary")

    by_file: dict[str, list[dict]] = {}
    unmatched = []
    for s in sites:
        lad = la_of(s)
        f = match_file(lad, files) if lad else None
        if f:
            by_file.setdefault(f, []).append(s)
        else:
            unmatched.append((s["sid"], lad or "(no authority resolved)"))
    print(f"{len(by_file)} authorities to fetch; {len(unmatched)} sites outside "
          "England & Wales or unresolved (Scotland is a separate, paid registry)")

    bcents = building_centroids()
    feats, covered = [], set()
    for i, (fname, group) in enumerate(sorted(by_file.items())):
        zp = fetch_zip(fname)
        if not zp:
            continue
        try:
            parcels = parcels_from(zp)
        except Exception as e:  # noqa: BLE001
            print(f"    {fname}: parse failed ({e})")
            continue

        def parcel_at(lon, lat):
            for pid, rings, bb in parcels:
                if not (bb[0] <= lon <= bb[2] and bb[1] <= lat <= bb[3]):
                    continue
                geom = {"type": "Polygon",
                        "coordinates": [r + [r[0]] if r[0] != r[-1] else r for r in rings]}
                if sum(1 for r in geo._rings(geom)
                       if geo._in_ring(lon, lat, r)) % 2 == 1:
                    return pid, geom
            return None, None

        def emit(sid, pid, geom, via=""):
            props = {"id": f"fp-parcel-uk-{pid or sid}",
                     "kind": "campus", "src": "parcel", "name": "", "op": "",
                     "ref": pid, "locality": fname[:-4].replace("_", " "),
                     "acres": "", "for_site": sid}
            if via:
                props["via"] = via
            feats.append({"type": "Feature", "geometry": geom, "properties": props})
            covered.add(sid)

        hits = hits2 = 0
        for s in group:
            pid, geom = parcel_at(s["lon"], s["lat"])
            if geom:
                emit(s["sid"], pid, geom)
                hits += 1
                continue
            # Pass 2: the dot hit registered-land gaps (roads are unregistered);
            # anchor on the site's building rooftops instead. Every parcel that
            # contains a building centroid is individually containment-proven,
            # so a multi-building campus may honestly yield several.
            got = set()
            for cx, cy in bcents.get(s["sid"], ()):
                pid, geom = parcel_at(cx, cy)
                if geom and pid not in got:
                    emit(s["sid"], pid, geom, via="building-centroid")
                    got.add(pid)
            hits2 += bool(got)
        print(f"  [{i + 1}/{len(by_file)}] {fname[:-4]}: {len(group)} sites -> "
              f"{hits} by dot + {hits2} by building ({len(parcels)} in file)",
              flush=True)

    # Incremental write: keep every existing feature whose site this run did
    # not re-match - the needy list shrinks as footprints.py absorbs results,
    # so a fresh run only ever sees the leftovers.
    kept = []
    if DEST.exists():
        kept = [f for f in json.loads(DEST.read_text())["features"]
                if f["properties"].get("for_site") not in covered]
    DEST.write_text(json.dumps({"type": "FeatureCollection",
                                "features": kept + feats}))
    print(f"wrote {DEST.relative_to(ROOT)}: {len(kept)} kept + {len(feats)} new "
          f"parcels; this run covered {len(covered)} of {len(sites)} needy sites")
    if unmatched:
        print("unmatched:", ", ".join(f"{s} ({l})" for s, l in unmatched[:12]),
              "..." if len(unmatched) > 12 else "")
    print("Contains HM Land Registry data © Crown copyright and database "
          "rights 2026, reproduced under OGL v3.")


if __name__ == "__main__":
    main()
