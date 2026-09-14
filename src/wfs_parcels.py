"""Cadastral parcels from national WFS services — Europe, and BC.

parcels.py speaks ArcGIS REST, which is what US counties and a handful of other
land agencies run. Most of Europe runs the other thing: OGC WFS, because the
INSPIRE directive obliges member states to publish cadastral parcels and WFS is
the protocol it names. Same question, different wire format, so this is a
second client rather than a fifth branch in the first one.

    python3 wfs_parcels.py          # every source
    python3 wfs_parcels.py fr       # one

Output is data/raw/parcels_wfs.geojson, which footprints.py merges exactly like
the ArcGIS parcels: kind=campus, src=parcel.

TWO THINGS ABOUT WFS THAT COST A DAY IF YOU GUESS

AXIS ORDER. With the URN form of the CRS - urn:ogc:def:crs:EPSG::4326 - a WFS
2.0 server expects and returns LATITUDE FIRST. Every service tested here agrees
on that, and the failure when you get it wrong is the worst kind: not an error,
just an empty FeatureCollection, indistinguishable from "no parcel here".

So the bbox is written lat,lon deliberately, and the RESPONSE is checked rather
than trusted: a returned ring is compared against the point that was asked
about, and if it only makes sense with the coordinates swapped, they are
swapped. Servers disagree about the response even when they agree about the
request, and the query point is a fact we already have - it is cheaper to
measure than to maintain a table of who does what.

GML. GeoJSON output is common but not universal, and the ones that lack it are
not optional - Spain's Catastro is the cadastre for a whole country. So both
are parsed: application/json when the server advertises it, GML otherwise, via
stdlib ElementTree. GML polygons are gml:posList (3.x) or gml:coordinates
(2.x), and a multi-part parcel arrives as gml:MultiSurface.
"""

from __future__ import annotations

import csv
import json
import math
import pathlib
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

import geo

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEST = ROOT / "data" / "raw" / "parcels_wfs.geojson"
CACHE = ROOT / "data" / "raw" / "parcels_wfs_cache"
UA = {"User-Agent": "reinsurance_dc-research/1.0"}

# Half-width of the box asked about, in degrees. Big enough to catch the parcel
# a dot stands in even when the dot is off-centre, small enough that a dense
# city block does not come back whole.
PAD = 0.0009

SOURCES = [
    {"key": "fr", "region": "France", "bbox": (-5.2, 41.3, 9.6, 51.1),
     "service": "https://data.geopf.fr/wfs/ows",
     "typename": "CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle",
     "ref": ["idu"], "owner": [], "locality": ["nom_com"], "area": ["contenance"]},
    {"key": "nl", "region": "Netherlands", "bbox": (3.2, 50.7, 7.3, 53.6),
     "service": "https://service.pdok.nl/kadaster/kadastralekaart/wfs/v5_0",
     "typename": "kadastralekaart:Perceel",
     "ref": ["identificatieLokaalID", "perceelnummer"], "owner": [],
     "locality": ["kadastraleGemeenteWaarde"], "area": ["kadastraleGrootteWaarde"]},
    {"key": "es", "region": "Spain", "bbox": (-9.4, 35.9, 4.4, 43.9),
     "service": "https://ovc.catastro.meh.es/INSPIRE/wfsCP.aspx",
     "typename": "cp:CadastralParcel",
     "ref": ["nationalCadastralReference", "localId"], "owner": [],
     "locality": [], "area": ["areaValue"],
     "srsname": False, "geojson": False},
    {"key": "it", "region": "Italy", "bbox": (6.6, 35.4, 18.6, 47.1),
     "service": "https://wfs.cartografia.agenziaentrate.gov.it/inspire/wfs/owfs01.php",
     "typename": "CP:CadastralParcel",
     "ref": ["NATIONALCADASTRALREFERENCE", "INSPIREID_LOCALID", "LABEL"], "owner": [],
     "locality": ["ADMINISTRATIVEUNIT"], "area": ["AREAVALUE"],
     "crs": "urn:ogc:def:crs:EPSG::6706", "srsname": False, "geojson": False},
    {"key": "pl", "region": "Poland", "bbox": (14.1, 49.0, 24.2, 54.9),
     "service": "https://mapy.geoportal.gov.pl/wss/service/PZGIK/EGIB/WFS/UslugaZbiorcza",
     "typename": "ms:dzialki",
     "ref": ["ID_DZIALKI", "NUMER_DZIALKI"], "owner": [],
     "locality": ["NAZWA_GMINY"], "area": []},
    {"key": "cz", "region": "Czechia", "bbox": (12.0, 48.5, 18.9, 51.1),
     "service": "https://services.cuzk.cz/wfs/inspire-cp-wfs.asp",
     "typename": "cp:CadastralParcel",
     "ref": ["nationalCadastralReference", "label"], "owner": [],
     "locality": [], "area": ["areaValue"]},
    {"key": "ch", "region": "Switzerland", "bbox": (5.9, 45.8, 10.5, 47.9),
     "service": "https://geodienste.ch/db/av_0/deu", "typename": "ms:RESF",
     "ref": ["EGRIS_EGRID", "Nummer"], "owner": [],
     "locality": ["Kanton"], "area": ["Flaeche"]},
    {"key": "no", "region": "Norway", "bbox": (4.0, 57.8, 31.5, 71.4),
     "service": "https://wfs.geonorge.no/skwms1/wfs.matrikkelen-eiendomskart-teig",
     "typename": "app:Teig",
     "ref": ["matrikkelnummerTekst"], "owner": [],
     "locality": ["kommunenavn"], "area": ["lagretBeregnetAreal"]},
    {"key": "de-he", "region": "Hessen, Germany", "bbox": (7.7, 49.3, 10.3, 51.7),
     "service": "https://inspire-hessen.de/ows/services/"
                "org.2.07247d95-adc7-4c7d-9c7a-ed17af855317_wfs",
     "typename": "cp:CadastralParcel",
     "ref": ["nationalCadastralReference", "label"], "owner": [],
     "locality": ["gemarkung"], "area": ["areaValue"]},
    # Denmark: free but registered. Typename per Datafordeler's Matriklen2
    # service; the first credentialed run is the verification - a wrong guess
    # here reports zero parcels loudly rather than silently.
    {"key": "dk", "region": "Denmark", "bbox": (8.0, 54.5, 15.3, 57.8),
     "service": "https://services.datafordeler.dk/Matriklen2/Matriklen2/1.0.0/WFS",
     "typename": "mat:Jordstykke",
     "ref": ["matrikelnummer", "BFEnummer"], "owner": [],
     "locality": ["ejerlavsnavn"], "area": ["registreretAreal"],
     "auth_file": "datafordeler_user.txt"},
    {"key": "de-nw", "region": "Nordrhein-Westfalen, Germany",
     "bbox": (5.8, 50.3, 9.5, 52.6),
     "service": "https://www.wfs.nrw.de/geobasis/wfs_nw_inspire-flurstuecke_alkis",
     "typename": "cp:CadastralParcel",
     "ref": ["nationalCadastralReference", "label"], "owner": [],
     "locality": [], "area": ["areaValue"], "geojson": False},
    {"key": "ca-bc", "region": "British Columbia", "bbox": (-139.1, 48.2, -114.0, 60.1),
     "service": "https://openmaps.gov.bc.ca/geo/pub/"
                "WHSE_CADASTRE.PMBC_PARCEL_FABRIC_POLY_SVW/ows",
     "typename": "pub:WHSE_CADASTRE.PMBC_PARCEL_FABRIC_POLY_SVW",
     "ref": ["PID_FORMATTED", "PID"], "owner": ["OWNER_TYPE"],
     "locality": ["MUNICIPALITY"], "area": ["FEATURE_AREA_SQM"]},
    # ARBA is the PROVINCE of Buenos Aires, deliberately including the city in
    # its bbox: CABA runs its own cadastre, so city sites simply get an empty
    # answer here, which the containment test already treats as the honest
    # nothing. cca is the full cadastral nomenclature, pda the tax partida;
    # ara1 is m2. Verified live 2026-08-23: GeoServer, GeoJSON out, lat-first
    # URN axis order like everyone else. Romania's ANCPI was probed the same
    # day and is NOT here: geoportal.ancpi.ro no longer resolves and
    # eterra.ancpi.ro answers "Acces restrictionat" to foreign addresses -
    # revisit from an EU vantage point, not by retrying harder from here.
    {"key": "ar-ba", "region": "Buenos Aires Province, Argentina",
     "bbox": (-63.45, -41.1, -56.6, -33.2),
     "service": "https://geo.arba.gov.ar/geoserver/idera/wfs",
     "typename": "idera:Parcela",
     "ref": ["cca", "pda"], "owner": [],
     "locality": [], "area": ["ara1"]},
]

LOCAL = {"{http://www.opengis.net/gml/3.2}", "{http://www.opengis.net/gml}"}


def tag(e) -> str:
    return e.tag.rsplit("}", 1)[-1]


def get(url: str, timeout: int = 90, tries: int = 3) -> bytes:
    """One GET, retried, because a reset here is usually throttling not refusal.

    Spain's Catastro resets the connection under load and answers the identical
    URL a few seconds later - the first version of this read that as "no parcel
    in Spain" and quietly skipped a whole country. Anything national is run by
    a small team on a modest budget, so back off and ask again rather than
    concluding anything from one failure.
    """
    last = None
    for n in range(tries):
        try:
            return urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=timeout).read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (n + 1))
    raise last


def auth_params(src: dict) -> dict:
    """Datafordeler-style per-request credentials, from a gitignored file.

    Denmark's national geodata platform is free but not anonymous: a
    registered service user rides every request as username/password query
    parameters. The file holds user:pass on one line; without it the source
    is SKIPPED with instructions, never hammered into 401s."""
    if not src.get("auth_file"):
        return {}
    f = ROOT / "data" / "raw" / src["auth_file"]
    if not f.exists():
        return {}
    u, _, pw = f.read_text().strip().partition(":")
    return {"username": u, "password": pw}


def query_url(src: dict, lon: float, lat: float, geojson: bool) -> str:
    """Ask the smallest question the server will accept.

    Extra parameters are not free. Spain's Catastro RESETS THE CONNECTION when
    sent srsName or outputFormat, and Italy answers "Richiesta non valida" to
    the same - so both are opt-in per source rather than always sent. Italy
    also insists on its own datum, EPSG::6706 (ETRS89), and refuses 4326;
    the difference is sub-metre at this scale, so the geometry is used as it
    comes and orient() sorts the axes out.
    """
    crs = src.get("crs", "urn:ogc:def:crs:EPSG::4326")
    p = {
        "service": "WFS", "version": "2.0.0", "request": "GetFeature",
        "typeNames": src["typename"],
        # lat,lon - see the note at the top. Wrong order returns nothing at all.
        "bbox": f"{lat - PAD},{lon - PAD},{lat + PAD},{lon + PAD},{crs}",
        "count": "25",
    }
    if src.get("srsname", True):
        p["srsName"] = crs
    if geojson:
        p["outputFormat"] = "application/json"
    p.update(auth_params(src))
    return src["service"] + ("&" if "?" in src["service"] else "?") + urllib.parse.urlencode(p)


# ---- parsing ----------------------------------------------------------------

def rings_from_gml(el) -> list[list[list[float]]]:
    """Every exterior/interior ring under a GML geometry, as raw number pairs."""
    out = []
    for node in el.iter():
        t = tag(node)
        if t == "posList" and node.text:
            v = [float(x) for x in node.text.split()]
            out.append([[v[i], v[i + 1]] for i in range(0, len(v) - 1, 2)])
        elif t == "coordinates" and node.text:
            pts = []
            for pair in node.text.replace("\n", " ").split():
                a, _, b = pair.partition(",")
                if b:
                    pts.append([float(a), float(b)])
            if pts:
                out.append(pts)
    return [r for r in out if len(r) >= 4]


def attrs_from_gml(member) -> dict:
    """Leaf text under a feature, keyed by local tag name."""
    out = {}
    for node in member.iter():
        if len(node) == 0 and node.text and node.text.strip():
            out.setdefault(tag(node), node.text.strip())
        for k, v in node.attrib.items():
            if k.endswith("title") and v:
                out.setdefault(tag(node) + "_title", v)
    return out


def parse_gml(body: bytes) -> list[tuple[list, dict]]:
    root = ET.fromstring(body)
    out = []
    for member in root.iter():
        if tag(member) not in ("member", "featureMember", "featureMembers"):
            continue
        for feat in list(member):
            rings = rings_from_gml(feat)
            if rings:
                out.append((rings, attrs_from_gml(feat)))
    return out


def parse_geojson(body: bytes) -> list[tuple[list, dict]]:
    fc = json.loads(body)
    out = []
    for f in fc.get("features") or []:
        g = f.get("geometry") or {}
        c = g.get("coordinates")
        if not c:
            continue
        polys = [c] if g.get("type") == "Polygon" else c if g.get("type") == "MultiPolygon" else []
        rings = [r for poly in polys for r in poly if len(r) >= 4]
        if rings:
            out.append((rings, f.get("properties") or {}))
    return out


def orient(rings: list, lon: float, lat: float) -> list | None:
    """Return rings as [lon, lat], deciding the order by where the point is.

    The response is measured rather than trusted. A ring is scored against the
    coordinate we asked about under both readings, and the one that puts the
    parcel near the query point wins. Servers that agree about the REQUEST
    still disagree about the response, and this needs no table of who does what.
    """
    def spread(rs, flip):
        xs = [(p[1] if flip else p[0]) for r in rs for p in r]
        ys = [(p[0] if flip else p[1]) for r in rs for p in r]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        if not (-180 <= cx <= 180 and -90 <= cy <= 90):
            return float("inf")
        return math.hypot(cx - lon, cy - lat)

    plain, flipped = spread(rings, False), spread(rings, True)
    if min(plain, flipped) > 0.5:        # neither reading lands anywhere near
        return None
    if flipped < plain:
        return [[[p[1], p[0]] for p in r] for r in rings]
    return [[[p[0], p[1]] for p in r] for r in rings]


def first(d: dict, keys: list[str]) -> str:
    for k in keys:
        for have, v in d.items():
            if have == k or have.endswith(":" + k) or have.endswith("_" + k):
                if v not in (None, "", " "):
                    return str(v)[:120]
    return ""


def parcel_at(src: dict, lon: float, lat: float) -> dict | None:
    """The parcel containing the point, or None."""
    for geojson in ((True, False) if src.get("geojson", True) else (False,)):
        try:
            body = get(query_url(src, lon, lat, geojson))
        except Exception:
            continue
        try:
            feats = parse_geojson(body) if geojson else parse_gml(body)
        except Exception:
            continue
        if not feats and geojson:
            continue                      # server ignored the format; try GML
        for rings, a in feats:
            fixed = orient(rings, lon, lat)
            if not fixed:
                continue
            geom = {"type": "Polygon", "coordinates": [r + [r[0]] if r[0] != r[-1] else r
                                                       for r in fixed]}
            if not geo._rings(geom):
                continue
            # CONTAINMENT IS THE WHOLE TEST. A bbox query returns every parcel
            # near the point and the nearest of them is not an answer: Italy
            # offered one 66 m away, which as a "site boundary" would be a
            # neighbour's land drawn round somebody else's data centre. If
            # nothing contains the dot, the honest result is nothing.
            if sum(1 for r in geo._rings(geom) if geo._in_ring(lon, lat, r)) % 2 == 1:
                return {"geometry": geom, "attrs": a}
        if feats:
            return None                   # parcels here, but none is this site's
    return None


# ---- driver -----------------------------------------------------------------

def sites_needing(bbox) -> list[tuple[str, float, float]]:
    fp = ROOT / "data" / "footprints.geojson"
    real = set()
    if fp.exists():
        for f in json.loads(fp.read_text()).get("features", []):
            p = f["properties"]
            if p["kind"] == "campus" and p["src"] not in ("derived", "osm-landuse"):
                real.update(p.get("sites") or ())
    out = []
    with (ROOT / "data" / "facilities_sites.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if not r.get("lat") or r["site_id"] in real:
                continue
            lon, lat = float(r["lon"]), float(r["lat"])
            if bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]:
                out.append((r["site_id"], lon, lat))
    return out


def run_source(src: dict) -> list[dict]:
    if src.get("auth_file") and not (ROOT / "data" / "raw" / src["auth_file"]).exists():
        print(f"  {src['key']}: SKIPPED - needs a (free) Datafordeler service user: "
              f"register at datafordeler.dk, then put user:pass in "
              f"data/raw/{src['auth_file']}")
        return []
    cache_dir = CACHE / src["key"]
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached = {p.stem for p in cache_dir.glob("*.json")}
    need = sites_needing(src["bbox"])
    print(f"  {src['key']}: {len(need)} sites in {src['region']} without a recorded "
          f"boundary", flush=True)

    asked = 0
    for sid, lon, lat in need:
        if sid in cached:
            continue
        asked += 1
        try:
            hit = parcel_at(src, lon, lat)
        except Exception as e:  # noqa: BLE001
            print(f"    {sid}: {e}")
            continue
        (cache_dir / f"{sid}.json").write_text(json.dumps(hit or {}))
        cached.add(sid)
        time.sleep(0.5)              # national services, run by small teams

    out = []
    for sid in sorted(cached):
        hit = json.loads((cache_dir / f"{sid}.json").read_text())
        if not hit:
            continue
        a = hit["attrs"]
        ref = first(a, src["ref"])
        out.append({
            "type": "Feature", "geometry": hit["geometry"],
            "properties": {
                "id": f"fp-parcel-{src['key']}-{ref or sid}",
                "kind": "campus", "src": "parcel",
                "name": "", "op": first(a, src["owner"]),
                "ref": ref,
                "locality": first(a, src["locality"]) or src["region"],
                "acres": "", "for_site": sid,
            },
        })
    print(f"    {len(cached)} asked to date ({asked} new) -> {len(out)} parcels")
    return out


def main() -> None:
    want = sys.argv[1] if len(sys.argv) > 1 else "--all"
    feats = []
    for src in SOURCES:
        if want not in ("--all", src["key"]):
            continue
        feats += run_source(src)
    if not feats:
        print("nothing fetched; leaving any existing file alone")
        return
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    print(f"wrote {DEST.relative_to(ROOT)}  ({len(feats)} parcels, "
          f"{DEST.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
