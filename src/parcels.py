"""Site boundaries from county parcel records — the legal line, not a guess.

footprints.py knows three kinds of site boundary and only two of them are
facts: an OSM landuse parcel somebody drew, the IM3 atlas campus layer, and a
convex hull derived from the halls. The hull is honest about being an
inference, but it is still an inference: it swallows whatever lies between the
buildings, so a site split by a public road claims the road.

A county parcel is the actual boundary. It is what the assessor recorded, it
carries the owner's name and the acreage, and where a county publishes one
there is no reason to prefer a hull.

WHY THIS IS COUNTY BY COUNTY AND ALWAYS WILL BE

There is no national parcel layer. Every county runs its own ArcGIS server with
its own schema, its own field names and its own idea of what a data centre is,
which is why src/arcgis.py exists - one well-tested pager over all of them.
This file adds the geometry half: pull_sites.py already reads two of these
layers for their ATTRIBUTES and throws the polygons away.

Loudoun is the place to start and not only because it was already wired: it is
the densest concentration of data centres on earth, and its layer is already
filtered to data centre parcels, so every polygon in it is one we want.

    python3 parcels.py          # fetch and write data/raw/parcels.geojson
    python3 footprints.py       # picks the file up if it is there

Output is data/raw/parcels.geojson, and footprints.py merges it as
kind=campus, src=parcel - ranking above a derived hull for the same site and
below nothing, because a recorded boundary beats a computed one.
"""

from __future__ import annotations

import csv
import json
import pathlib
import sys
import time

import arcgis
import geo

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEST = ROOT / "data" / "raw" / "parcels.geojson"

# Each entry is one county layer that publishes DATA CENTRE parcels as
# polygons. `where` narrows it when the layer is not already specific; `name`
# and `owner` name the fields to carry through, because no two counties agree
# on what to call them.
SOURCES = [
    {
        "key": "loudoun",
        "locality": "Loudoun County, VA",
        "layer": "https://services1.arcgis.com/MxjRokvPm7bjslyR/ArcGIS/rest/services/"
                 "Existing_Data_Center_Parcel/FeatureServer/1",
        "where": "1=1",              # the layer is already only DC parcels
        "name": ["Project"],
        "owner": ["Owner"],
        "ref": ["PA_MCPI"],          # the parcel id registry.csv already carries
        "acres": ["PA_GIS_ACRE", "PA_LEGAL_ACRE", "Existing_Acres"],
    },
    {
        "key": "pw",
        "locality": "Prince William County, VA",
        "layer": "https://gisweb.pwcva.gov/arcgis/rest/services/Planning/"
                 "Build_Out_Analysis/MapServer/10",
        "where": "1=1",
        "name": ["PlanName", "NAME", "Name"],
        "owner": ["Owner", "OWNER"],
        "ref": ["GPIN", "PIN"],
        "acres": ["Acres", "ACRES", "GIS_ACRES"],
    },
]


# ---- statewide layers, asked one site at a time -----------------------------
# The county layers above are pulled WHOLE because they are already filtered to
# data centre parcels - every polygon in them is one we want. A statewide
# parcel layer is the opposite: millions of polygons, almost none of them ours,
# and no attribute that says which. Pulling it is out of the question and
# filtering it is impossible.
#
# So it is asked point by point instead: for each site that still has no
# recorded boundary, one intersects-query at its coordinates returns the one
# parcel it stands on. Precise, and one request per site rather than one per
# county - which is why this runs only for sites that need it.
#
# Virginia first because VGIN publishes every locality in one layer, and
# because Virginia holds more data centres than anywhere on earth. The trade
# against the Loudoun layer is detail: VGIN carries the parcel id and the
# locality but no owner and no acreage, so where both cover a site the county
# layer is the better record and this never replaces it.
POINT_SOURCES = [
    {
        "key": "va",
        "region": "Virginia",
        "bbox": (-83.7, 36.5, -75.2, 39.5),
        "layer": "https://vginmaps.vdem.virginia.gov/arcgis/rest/services/"
                 "VA_Base_Layers/VA_Parcels/MapServer/0",
        "ref": ["PARCELID", "VGIN_QPID"],
        "locality": ["LOCALITY"],
        "owner": [],
        "acres": [],
    },
    # Eleven more statewide layers and five metro ones, every URL confirmed by
    # a live intersects-query returning real rings before it was written down.
    # Where a state publishes nothing, the county covering its data centres
    # does, and its bbox is narrowed to that metro so no request is wasted
    # asking a county about ground it has never heard of.
    {
        "key": "tx", "region": "Texas", "bbox": (-106.7, 25.8, -93.5, 36.5),
        "layer": "https://services1.arcgis.com/1mtXwieMId59thmg/arcgis/rest/services/"
                 "2019_Texas_Parcels_StratMap/FeatureServer/0",
        # TxGIO's aggregate of ~250 county appraisal districts. The service path
        # says 2019 and the layer inside it is the 2025 vintage; the path is the
        # address, not a date, so it is left exactly as it resolves.
        "ref": ["Prop_ID", "GEO_ID"], "owner": ["OWNER_NAME"],
        "locality": [], "acres": ["LEGAL_AREA"],
    },
    {
        "key": "ca", "region": "California", "bbox": (-124.5, 32.5, -114.1, 42.0),
        "layer": "https://services2.arcgis.com/zr3KAIbsRSUyARHG/arcgis/rest/services/"
                 "CA_State_Parcels/FeatureServer/0",
        # Named for the earthquake-hazard map it backs, but it is all 13.1M
        # California parcels. No owner: CA assessors do not publish names here.
        "ref": ["PARCEL_APN"], "owner": [],
        "locality": ["SITE_CITY"], "acres": [],
    },
    {
        "key": "nj", "region": "New Jersey", "bbox": (-75.6, 38.9, -73.9, 41.4),
        "layer": "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/"
                 "Parcels_Composite_NJ_WM/FeatureServer/0",
        "ref": ["PAMS_PIN", "GIS_PIN"], "owner": [],
        "locality": ["COUNTY", "MUN_NAME"], "acres": ["CALC_ACRE"],
    },
    {
        "key": "ny", "region": "New York", "bbox": (-79.8, 40.5, -71.8, 45.0),
        "layer": "https://gisservices.its.ny.gov/arcgis/rest/services/"
                 "NYS_Tax_Parcels_Public/FeatureServer/1",
        "ref": ["PRINT_KEY", "SBL"], "owner": ["PRIMARY_OWNER"],
        "locality": ["COUNTY_NAME", "MUNI_NAME"], "acres": ["CALC_ACRES", "ACRES"],
    },
    {
        "key": "oh", "region": "Ohio", "bbox": (-84.9, 38.3, -80.5, 42.0),
        "layer": "https://gis.ohiodnr.gov/arcgis/rest/services/OIT_Services/"
                 "odnr_landbase/MapServer/4",
        "ref": ["PIN", "STATEWIDE_PIN"], "owner": ["OWNER1", "OWNER2"],
        "locality": ["COUNTY"], "acres": ["ASSR_ACRES", "CALC_ACRES"],
    },
    {
        "key": "co", "region": "Colorado", "bbox": (-109.1, 36.9, -102.0, 41.0),
        "layer": "https://gis.colorado.gov/public/rest/services/Address_and_Parcel/"
                 "Colorado_Public_Parcels/FeatureServer/0",
        "ref": ["parcel_id"], "owner": ["owner", "owner2"],
        "locality": ["countyName", "sitAddCty"], "acres": ["landAcres"],
    },
    {
        "key": "wa", "region": "Washington", "bbox": (-124.8, 45.5, -116.9, 49.1),
        "layer": "https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/"
                 "Current_Parcels/FeatureServer/0",
        "ref": ["PARCEL_ID_NR", "ORIG_PARCEL_ID"], "owner": [],
        # COUNTY_NM holds a numeric FIPS despite the _NM, so the city is asked
        # for first and the guard in pull_points catches the rest.
        "locality": ["SITUS_CITY_NM", "COUNTY_NM"], "acres": [],
    },
    {
        "key": "ma", "region": "Massachusetts", "bbox": (-73.6, 41.2, -69.9, 42.9),
        "layer": "https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/"
                 "L3Parcels_feature_service/MapServer/0",
        "ref": ["MAP_PAR_ID", "LOC_ID"], "owner": ["OWNER1"],
        "locality": ["CITY"], "acres": ["LOT_SIZE"],
    },
    {
        "key": "ne", "region": "Nebraska", "bbox": (-104.1, 39.9, -95.3, 43.0),
        "layer": "https://giscat.ne.gov/enterprise/rest/services/"
                 "StatewideParcelsExternal/FeatureServer/0",
        "ref": ["State_PID", "Parcel_ID"], "owner": [],
        "locality": ["Ph_City"], "acres": ["Acres_Deeded", "GIS_Acres"],
    },
    {
        "key": "ia", "region": "Iowa", "bbox": (-96.7, 40.3, -90.1, 43.6),
        "layer": "https://services3.arcgis.com/kd9gaiUExYqUbnoq/ArcGIS/rest/services/"
                 "Iowa_Parcels_2017/FeatureServer/0",
        "ref": ["STATEPARID", "PARCELNUMB"], "owner": ["DEEDHOLDER"],
        "locality": ["COUNTYNAME"], "acres": [],
    },
    {
        "key": "nc", "region": "North Carolina", "bbox": (-84.4, 33.8, -75.4, 36.6),
        "layer": "https://services.nconemap.gov/secure/rest/services/"
                 "NC1Map_Parcels/FeatureServer/1",
        # "secure" in the path is the host's own naming; the layer answers
        # anonymously, which is why it is here.
        "ref": ["parno", "altparno"], "owner": ["ownname"],
        "locality": ["cntyname", "scity"], "acres": ["gisacres"],
    },
    {
        "key": "az", "region": "Arizona", "bbox": (-114.9, 31.3, -109.0, 37.0),
        "layer": "https://azwatermaps.azwater.gov/arcgis/rest/services/General/"
                 "Parcels/MapServer/7",
        # Published by the Department of Water Resources, and it answered in
        # both Maricopa and Pima, so it is treated as statewide.
        "ref": ["APN"], "owner": ["OWNER_NAME"],
        "locality": ["COUNTY", "SITE_CITY"], "acres": ["ACRES_US"],
    },
    {
        "key": "il-cook", "region": "Cook County, IL", "bbox": (-88.3, 41.45, -87.5, 42.15),
        "layer": "https://gis.cookcountyil.gov/traditional/rest/services/"
                 "CookViewer3Parcels/MapServer/0",
        # No owner and no acreage: CookViewer3Parcels publishes PIN, address,
        # assessed values and building sqft, and NOT the assessor's owner name.
        # PROPNAME/BILLNAME/ACREAGE were configured here and none of the three
        # exists on the layer, so every Cook County parcel silently came back
        # ownerless. Empty says so; a wrong field name reads like a bug.
        "ref": ["PIN14_dash", "PIN14", "PIN10"], "owner": [],
        "locality": ["CITYNAME"], "acres": [],
    },
    {
        "key": "ga-fulton", "region": "Fulton County, GA", "bbox": (-84.9, 33.4, -84.2, 34.3),
        "layer": "https://gismaps.fultoncountyga.gov/arcgispub2/rest/services/"
                 "PropertyMapViewer/PropertyMapViewer/MapServer/11",
        "ref": ["ParcelID"], "owner": ["Owner"],
        "locality": [], "acres": ["LandAcres"],
    },
    {
        "key": "or-metro", "region": "Portland metro, OR", "bbox": (-123.3, 45.1, -122.3, 45.9),
        "layer": "https://services2.arcgis.com/McQ0OlIABe29rJJy/arcgis/rest/services/"
                 "Taxlots_with_Right_of_Way_Public/FeatureServer/3",
        "ref": ["TLID", "PRIMACCNUM"], "owner": [],
        # COUNTY here is a one-letter code - W, C, M for Washington, Clackamas,
        # Multnomah - so the city fields come first.
        "locality": ["SITECITY", "JURIS_CITY", "COUNTY"],
        "acres": ["A_T_ACRES", "GIS_ACRES"],
    },
    {
        "key": "mi-se", "region": "Southeast Michigan", "bbox": (-83.9, 42.0, -82.8, 42.95),
        "layer": "https://services1.arcgis.com/b6rkZNtCd6Mx2gvB/arcgis/rest/services/"
                 "Parcels_AssessmentData/FeatureServer/0",
        # The weakest of the set - one county, 1 of 3 test points - kept
        # because Detroit's sites are inside it and it costs nothing elsewhere.
        "ref": ["pnum"], "owner": ["OwnerName"],
        "locality": ["Muni"], "acres": ["Acerage"],
    },

    # ---- outside the US -----------------------------------------------------
    # Only the countries whose land agency already speaks ArcGIS REST are here;
    # most of Europe answers WFS instead and is handled by wfs_parcels.py.
    #
    # Note what is NOT here and why, because the absences are the finding:
    # Great Britain publishes INSPIRE index polygons as bulk downloads only,
    # with no live query service of any kind; Germany, Canada and Australia
    # have no national cadastre at all - land title is a Land, provincial or
    # state competence - so Australia is five separate entries below and the
    # German states answer WFS one at a time.
    {
        "key": "nz", "region": "New Zealand", "bbox": (166.3, -47.4, 178.6, -34.3),
        "layer": "https://services.arcgis.com/xdsHIIxuCWByZiCB/arcgis/rest/services/"
                 "LINZ_NZ_Primary_Parcels/FeatureServer/0",
        "ref": ["appellation", "id"], "owner": [],
        "locality": ["land_district"], "acres": [],
    },
    {
        "key": "se", "region": "Sweden", "bbox": (10.9, 55.3, 24.2, 69.1),
        "layer": "https://ext-geodata-nationella-visning.lansstyrelsen.se/arcgis/rest/"
                 "services/LM/LM_Fastighetsindelning_EXT/FeatureServer/0",
        # Lantmäteriet's property division, republished for public viewing by
        # the county administrative boards.
        "ref": ["FASTIGHET"], "owner": [], "locality": [], "acres": [],
    },
    {
        "key": "be", "region": "Belgium", "bbox": (2.5, 49.4, 6.4, 51.6),
        "layer": "https://ccff02.minfin.fgov.be/geoservices/arcgis/rest/services/WMS/"
                 "Cadastral_LayersWFS/MapServer/11",
        "ref": ["CaPaKey"], "owner": [], "locality": ["CaSeKey"], "acres": ["SuVaCn"],
    },
    {
        "key": "ie", "region": "Ireland", "bbox": (-10.6, 51.4, -5.9, 55.5),
        "layer": "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/"
                 "Cadastral_Parcels_Freehold/FeatureServer/12",
        "ref": ["OBJECTID"], "owner": [], "locality": [], "acres": [],
    },
    # Australia, state by state. ACT sits inside the NSW box and is listed
    # first; NSW simply answers nothing for a Canberra point, which costs one
    # request and no correctness.
    {
        "key": "au-act", "region": "Australian Capital Territory",
        "bbox": (148.7, -35.95, 149.45, -35.1),
        "layer": "https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services/"
                 "ACTGOV_BLOCKS/FeatureServer/0",
        "ref": ["BLOCK_KEY"], "owner": [],
        "locality": ["DIVISION_NAME", "DISTRICT_NAME"], "acres": [],
    },
    {
        "key": "au-nsw", "region": "New South Wales", "bbox": (140.9, -37.6, 153.7, -28.1),
        "layer": "https://maps.six.nsw.gov.au/arcgis/rest/services/public/"
                 "NSW_Cadastre/MapServer/9",
        # No locality on this layer - it carries lot/plan identifiers and
        # nothing administrative. "councilname" never resolved.
        "ref": ["lotidstring", "planlabel"], "owner": [],
        "locality": [], "acres": [],
    },
    {
        "key": "au-vic", "region": "Victoria", "bbox": (140.9, -39.2, 150.1, -33.9),
        "layer": "https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/arcgis/rest/services/"
                 "Vicmap_Parcel/FeatureServer/0",
        # Vicmap prefixes every field "parcel_"; the bare names never matched.
        "ref": ["parcel_spi"], "owner": [],
        "locality": ["parcel_lga_code"], "acres": [],
    },
    {
        "key": "au-wa", "region": "Western Australia", "bbox": (112.9, -35.2, 129.1, -13.6),
        "layer": "https://services.slip.wa.gov.au/public/rest/services/"
                 "SLIP_Public_Services/Property_and_Planning/MapServer/2",
        # THIS LAYER CARRIES NO ATTRIBUTES. Its three fields are objectid,
        # view_scale and shape - it is a cartographic display layer, not a
        # cadastral one, so a WA parcel arrives as an anonymous polygon with
        # no id to cite and no owner. Kept because the geometry is still the
        # recorded boundary, but nothing else here can come from it.
        "ref": [], "owner": [],
        "locality": [], "acres": [],
    },
    {
        "key": "au-tas", "region": "Tasmania", "bbox": (144.5, -43.7, 148.6, -39.5),
        "layer": "https://services.thelist.tas.gov.au/arcgis/rest/services/Public/"
                 "CadastreAndAdministrative/MapServer/38",
        "ref": ["PID"], "owner": [],
        "locality": [], "acres": [],
    },
]

# Field names differ per layer and every layer is somebody else's schema, so
# these lists are unions of what has actually been seen in a response rather
# than a guess at a convention - first() takes whichever is present.

POINT_CACHE = ROOT / "data" / "raw" / "parcels_point"


def place(value: str, fallback: str) -> str:
    """A locality has to read like a place name, or it is not one.

    Field NAMES lie. Portland Metro's `COUNTY` holds a one-letter code (W, C,
    M) and Washington's `COUNTY_NM` holds a numeric FIPS despite the _NM, so
    both produced localities like "W" and "33" that read as data corruption on
    a popup. Rather than chase each layer's quirks, anything too short or
    entirely numeric is dropped for the region name, which is always true.
    """
    v = (value or "").strip()
    if len(v) < 3 or v.replace(".", "").isdigit():
        return fallback
    return v


def parcel_at(layer: str, lon: float, lat: float) -> dict | None:
    """The one parcel a point stands on, or None."""
    params = {
        "geometry": json.dumps({"x": lon, "y": lat,
                                "spatialReference": {"wkid": 4326}}),
        "geometryType": "esriGeometryPoint",
        "inSR": "4326", "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "*", "returnGeometry": "true", "f": "json",
    }
    j = arcgis._get(layer + "/query", params)
    fs = j.get("features") or []
    return fs[0] if fs else None


def pull_points(src: dict, wanted: list[tuple[str, float, float]]) -> list[dict]:
    """Emit every parcel already cached; query only the sites not yet asked.

    WHAT TO EMIT AND WHAT TO FETCH ARE DIFFERENT QUESTIONS, and conflating them
    made this file destroy its own output. `wanted` is computed from sites that
    have no recorded boundary in footprints.geojson - but once a run has
    written its parcels and footprints.py has merged them, those sites HAVE a
    recorded boundary, so the next run wanted nothing, emitted nothing, and the
    parcel count fell from 931 back to 255.

    The cache is the record of every parcel ever found, so it is what gets
    written out. `wanted` now only decides which sites are worth a NEW request.
    """
    cache_dir = POINT_CACHE / src["key"]
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached = {p.stem for p in cache_dir.glob("*.json")}

    # Ask only for sites never asked before; everything already cached is
    # emitted below whether or not it is still on the wanted list.
    out, asked, found = [], 0, 0
    for sid, lon, lat in wanted:
        if sid in cached:
            continue
        asked += 1
        try:
            (cache_dir / f"{sid}.json").write_text(
                json.dumps(parcel_at(src["layer"], lon, lat) or {}))
        except Exception as e:  # noqa: BLE001
            print(f"    {sid}: {e}")
            continue
        time.sleep(0.4)              # a state GIS server, not a CDN
        cached.add(sid)

    for sid in sorted(cached):
        hit = json.loads((cache_dir / f"{sid}.json").read_text())
        if not hit:
            continue
        geom = rings_to_geojson(hit.get("geometry"))
        if not geom:
            continue
        a = hit.get("attributes") or {}
        found += 1
        ref = first(a, src["ref"])
        out.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "id": f"fp-parcel-{src['key']}-{ref or sid}",
                "kind": "campus", "src": "parcel",
                "name": "", "op": first(a, src["owner"]),
                "ref": ref,
                "locality": place(first(a, src["locality"]), src["region"]),
                "acres": first(a, src.get("acres") or []),
                # Which dot the query was made for. attach_sites will confirm
                # it by containment, but a parcel fetched FOR a site should not
                # depend on that test to find its way back to it.
                "for_site": sid,
            },
        })
    print(f"    {len(cached)} sites asked to date ({asked} new) -> {found} parcels")
    return out


def sites_needing_boundary(bbox) -> list[tuple[str, float, float]]:
    """Sites in the box whose only boundary is a hull, or none at all."""
    fp = ROOT / "data" / "footprints.geojson"
    real = set()
    if fp.exists():
        for f in json.loads(fp.read_text()).get("features", []):
            p = f["properties"]
            if p["kind"] == "campus" and p["src"] != "derived":
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


def first(row: dict, keys: list[str]) -> str:
    for k in keys:
        v = row.get(k)
        if v not in (None, "", " "):
            return arcgis.scrub(v) if isinstance(v, str) else str(v)
    return ""


def rings_to_geojson(esri: dict) -> dict | None:
    """Esri rings -> GeoJSON. Winding is left alone; even-odd reads either way.

    Esri packs outer rings and holes into one flat `rings` list and tells them
    apart by winding order, which is exactly the information a GeoJSON
    Polygon's ring ORDER carries instead. Rather than re-derive that - and get
    it wrong on the parcels that are genuinely multi-part - every ring is kept
    and the consumer uses the even-odd rule, which is what geo.py, the
    pipeline's containment test and the map's fill-rule all already do.
    """
    rings = [r for r in (esri or {}).get("rings") or [] if len(r) >= 4]
    if not rings:
        return None
    if len(rings) == 1:
        return {"type": "Polygon", "coordinates": [[[p[0], p[1]] for p in rings[0]]]}
    return {"type": "Polygon",
            "coordinates": [[[p[0], p[1]] for p in r] for r in rings]}


def pull(src: dict) -> list[dict]:
    print(f"  {src['key']}: querying ...", flush=True)
    try:
        rows = arcgis.query(src["layer"], where=src["where"], geometry=True)
    except Exception as e:  # noqa: BLE001
        # One county being down must not cost the others.
        print(f"    failed: {e}")
        return []
    out = []
    for i, r in enumerate(rows):
        geom = rings_to_geojson(r.get("_geometry"))
        if not geom:
            continue
        ref = first(r, src["ref"])
        out.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                # Stable across runs: the parcel id where the county gives one,
                # its row position only as a fallback.
                "id": f"fp-parcel-{src['key']}-{ref or i}",
                "kind": "campus", "src": "parcel",
                "name": first(r, src["name"]),
                "op": first(r, src["owner"]),
                "ref": ref,
                "locality": src["locality"],
                "acres": first(r, src["acres"]),
            },
        })
    print(f"    {len(rows)} rows -> {len(out)} polygons")
    return out


def main() -> None:
    want = sys.argv[1] if len(sys.argv) > 1 else "--all"
    feats = []
    for src in SOURCES:
        if want not in ("--all", src["key"]):
            continue
        feats += pull(src)
    for src in POINT_SOURCES:
        if want not in ("--all", src["key"]):
            continue
        need = sites_needing_boundary(src["bbox"])
        print(f"  {src['key']}: {len(need)} sites in {src['region']} still without a "
              f"recorded boundary")
        # Called even when nothing needs asking: it still has to emit what the
        # cache already holds, or a source whose sites are all covered would
        # quietly drop its parcels from the output.
        feats += pull_points(src, need)
    if not feats:
        print("nothing fetched; leaving any existing file alone")
        return
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    areas = []
    for f in feats:
        c = geo.centroid(f["geometry"])
        if c:
            areas.append(c)
    print(f"wrote {DEST.relative_to(ROOT)}  ({len(feats)} parcels, "
          f"{DEST.stat().st_size / 1e6:.1f} MB)")
    named = sum(1 for f in feats if f["properties"]["name"])
    owned = sum(1 for f in feats if f["properties"]["op"])
    print(f"  named: {named}/{len(feats)}   with an owner: {owned}/{len(feats)}")


if __name__ == "__main__":
    main()
