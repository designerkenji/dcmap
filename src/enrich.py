"""Enrich the site registry with operator, utility, and self-generation.

Three attributes the counties do not publish:
  operator        - resolved from SPV/title-holder names via brand matching
  utility         - point-in-polygon against retail service territories
  self_generation - presence of a DEQ air permit (permitted combustion on site)

Each is an inference, not a published field. Confidence is recorded per row.
"""

from __future__ import annotations

import csv
import json
import pathlib
import re

import arcgis
import geo
import osm

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"

LOUDOUN_EXISTING = "https://services1.arcgis.com/MxjRokvPm7bjslyR/ArcGIS/rest/services/Existing_Data_Center_Parcel/FeatureServer/1"
PW_BUILDINGS = "https://gisweb.pwcva.gov/arcgis/rest/services/Planning/Build_Out_Analysis/MapServer/9"

# Brand -> patterns seen in title-holder / applicant / facility-name strings.
# Order matters: first match wins, so put specific before generic.
OPERATORS = [
    ("Amazon (AWS)", r"AMAZON|AWS|VADATA"),
    ("Microsoft", r"MICROSOFT|MSFT"),
    ("Google", r"\bGOOGLE\b|ALPHABET"),
    ("Meta", r"\bMETA\b|FACEBOOK"),
    ("Apple", r"\bAPPLE INC"),
    ("Oracle", r"\bORACLE\b"),
    ("Equinix", r"EQUINIX"),
    ("Digital Realty", r"DIGITAL REALTY|DIGITAL LOUDOUN|DUPONT FABROS|DLR "),
    ("QTS", r"\bQTS\b"),
    ("CyrusOne", r"CYRUSONE|CYRUS ONE"),
    ("Vantage", r"VANTAGE"),
    ("STACK Infrastructure", r"\bSTACK\b"),
    ("CloudHQ", r"CLOUDHQ|CLOUD HQ"),
    ("Iron Mountain", r"IRON MOUNTAIN"),
    ("Aligned", r"ALIGNED (DATA|ENERGY)"),
    ("EdgeCore", r"EDGECORE|EDGE CORE"),
    ("PowerHouse", r"POWERHOUSE"),
    ("CoreSite", r"CORESITE"),
    ("Prologis", r"PROLOGIS"),
    ("Verizon", r"VERIZON"),
    ("NTT / RagingWire", r"RAGINGWIRE|\bNTT\b"),
    ("Sabey", r"SABEY|INTERGATE"),
    ("CleanArc", r"CLEANARC|\bCADC\b"),
    ("Compass", r"COMPASS DATA"),
    ("Switch", r"\bSWITCH\b"),
    ("Peterson/Medina", r"MEDINA"),
    ("Chirisa", r"CHIRISA"),
    ("Blackstone/QTS", r"BLACKSTONE"),
    ("BlackChamber", r"BLACKCHAMBER|BLACK CHAMBER"),
    ("Centersquare", r"CENTERSQUARE|CYXTERA|EVOQUE"),
    ("Yondr", r"\bYONDR\b"),
    ("TPC Data Centers", r"TPC DATA"),
    ("DBT Data", r"\bDBT DATA\b"),
    ("True North", r"TRUE NORTH DATA"),
    ("DataBank", r"\bDATABANK\b"),
    ("Lumen", r"\bLUMEN\b|LEVEL 3|CENTURYLINK"),
    ("COPT", r"\bCOPT\b|CORPORATE OFFICE PROPERT"),
    # Enterprise self-operators. These run their own halls rather than leasing
    # from a colocation provider, so they never appear in a colo brand list -
    # but they are real operators with a distinct counterparty profile.
    ("Verisign (enterprise)", r"VERISIGN"),
    ("Visa (enterprise)", r"\bVISA\b"),
    ("SWIFT (enterprise)", r"^SWIFT$|\bSWIFT\b"),
    ("Northrop Grumman (enterprise)", r"NORTHROP"),
    ("SLK Global (enterprise)", r"SLK GLOBAL"),
]

# Serving utility comes from a Virginia state territory layer, not HIFLD.
# Virginia grants exclusive certificated territories under Title 56, so the
# state layers are non-overlapping: all 830 sites resolve to exactly one
# provider. HIFLD's approximate territories overlap so heavily that 41% of
# these sites fell in two at once (320 in the NOVEC/Dominion overlap alone),
# making assignment depend on feature order in the file rather than on fact.
#
# Primary is Virginia Energy (32 polygons, updated 2025-04). The SCC's own
# 2016 layer is kept as an independent check - the two agree on 821 of 830
# sites, and every difference is a naming variant, not a territory conflict.
# Join on the full `Utility` name: `UtilityAbv` collides, with both Craig
# Botetourt and Central Virginia carrying 'CVEC'.
TERRITORIES = "vaenergy_territories.geojson"
TERRITORY_FIELD = "Utility"
TERRITORIES_CHECK = "scc_territories.geojson"

UTILITY_SHORT = {
    "Dominion Virginia Power": "Dominion (VEPCO)",
    "Northern Virginia Electric Cooperative": "NOVEC (co-op)",
    "Rappahannock Electric Cooperative": "REC (co-op)",
    "Shenandoah Valley Electric Cooperative": "SVEC (co-op)",
    "Central Virginia Electric Cooperative": "CVEC (co-op)",
    "Craig Botetourt Electric Cooperative": "Craig Botetourt EC (co-op)",
    "Mecklenburg Electric Cooperative": "Mecklenburg EC (co-op)",
    "Southside Electric Cooperative": "Southside EC (co-op)",
    "Prince George Electric Cooperative": "Prince George EC (co-op)",
    "Powell Valley Electric Cooperative": "Powell Valley EC (co-op)",
    "Appalachian Power Company": "Appalachian Power",
    "Kentucky Utilities/Old Dominion Power Company": "Old Dominion Power",
    "Virginia Tech Electric Service": "Virginia Tech Electric",
    "City of Manassas": "Manassas (municipal)",
    "City of Danville": "Danville (municipal)",
    "City of Harrisonburg": "Harrisonburg (municipal)",
    "Town of Culpeper": "Culpeper (municipal)",
}


def operator_of(*candidates: str) -> tuple[str, str]:
    """Return (brand, confidence). Falls back to the raw string as 'unresolved'."""
    joined = " ".join(c for c in candidates if c).upper()
    if not joined.strip():
        return ("", "none")
    for brand, pat in OPERATORS:
        if re.search(pat, joined):
            return (brand, "matched")
    raw = next((c for c in candidates if c and c.strip()), "")
    return (raw.strip(), "unresolved")


def main() -> None:
    terr = json.loads((RAW / TERRITORIES).read_text())
    util_idx = geo.PolygonIndex(terr, TERRITORY_FIELD)
    bound_idx = geo.BoundaryIndex(terr)

    # OSM operator tags fill the gap county records leave. Loudoun publishes the
    # title holder (usually an SPV) and Prince William publishes no owner at
    # all, so brand matching alone resolves only about half the portfolio.
    try:
        osm_pts = [r for r in osm.load() if r.get("operator")]
    except Exception as e:  # noqa: BLE001 - Overpass is a third-party service
        print(f"  OSM unavailable, skipping operator fallback: {e}")
        osm_pts = []
    print(f"OSM features with operator: {len(osm_pts)}")

    def near_osm(lon: float, lat: float, deg: float = 0.0035) -> dict | None:
        """~350 m. Data center buildings are large and OSM centers are
        building centroids, so this is tight enough to avoid neighbouring
        campuses while tolerating parcel-vs-building offset."""
        best, bd = None, deg
        for p in osm_pts:
            d = max(abs(p["lon"] - lon), abs(p["lat"] - lat))
            if d < bd:
                best, bd = p, d
        return best

    # DEQ air permits: a permit means permitted combustion equipment on site.
    deq = []
    for lyr, status in (("deq_294", "operating"), ("deq_298", "planned")):
        for ft in json.loads((RAW / f"{lyr}.geojson").read_text()).get("features", []):
            c = geo.centroid(ft.get("geometry"))
            if c:
                p = ft["properties"]
                deq.append({"lon": c[0], "lat": c[1], "name": p.get("PLA_NAME") or "",
                            "reg": p.get("PLA_REG_NUM"), "status": status})
    print(f"DEQ air-permitted sites: {len(deq)}")

    def near_deq(lon: float, lat: float, deg: float = 0.0045) -> dict | None:
        """~500 m box. Air permit points are facility centroids, not parcels."""
        best, bd = None, deg
        for d in deq:
            dd = max(abs(d["lon"] - lon), abs(d["lat"] - lat))
            if dd < bd:
                best, bd = d, dd
        return best

    rows = []

    def add(src, locality, name, operator_src, status, sq_ft, geom, **extra):
        c = geo.centroid(geom)
        lon, lat = (c if c else ("", ""))
        util, util_conf, util_alts = "", "no_geometry", ""
        boundary_m = ""
        selfgen, selfgen_src = "", ""
        if c:
            hits = [UTILITY_SHORT.get(h["name"], h["name"]) for h in util_idx.find_all(lon, lat)]
            if len(hits) == 1:
                util, util_conf = hits[0], "unambiguous"
            elif len(hits) > 1:
                # Overlapping territories: record every candidate rather than
                # picking one. Resolving these needs a source other than HIFLD.
                util, util_conf = "", "ambiguous_overlap"
                util_alts = " | ".join(sorted(hits))
            else:
                util_conf = "outside_all_territories"
            # Assignment is a point-in-polygon inference. Near a boundary both
            # centroid error and the straddle rule can invalidate it.
            bd = bound_idx.distance_m(lon, lat)
            boundary_m = int(bd) if bd != float("inf") else ""
            if bd < 150:
                util_conf += "_near_boundary"
            d = near_deq(lon, lat)
            if d:
                selfgen = "yes (air permit)"
                selfgen_src = f"DEQ {d['reg']} [{d['status']}]"
        brand, conf = operator_of(operator_src, name)
        osm_ref, osm_operator = "", ""
        if c:
            hit = near_osm(lon, lat)
            if hit:
                osm_ref = hit.get("ref", "")
                osm_operator = hit["operator"]
                if conf != "matched":
                    # Prefer a tagged operator over an unresolved SPV string.
                    brand, conf = osm_operator, "osm_tag"
                elif brand.split(" (")[0].upper() not in osm_operator.upper():
                    # Recorded, not resolved. Most are naming variants
                    # ("NTT / RagingWire" vs "NTT"); some are real conflicts.
                    # Keeping both values makes the difference auditable.
                    conf = "matched_osm_differs"
        rows.append({
            "source": src, "locality": locality, "name": name,
            "operator": brand, "operator_confidence": conf,
            "operator_raw": operator_src, "operator_osm": osm_operator,
            "osm_ref": osm_ref, "status": status,
            "sq_ft": int(sq_ft) if sq_ft else "",
            "utility": util, "utility_confidence": util_conf,
            "utility_candidates": util_alts,
            "utility_boundary_m": boundary_m,
            "self_generation": selfgen, "self_generation_source": selfgen_src,
            "lon": round(lon, 6) if lon else "", "lat": round(lat, 6) if lat else "",
            **extra,
        })

    print("Loudoun existing DC parcels (with geometry)...")
    for r in arcgis.query(LOUDOUN_EXISTING, geometry=True):
        add("loudoun_existing", "Loudoun County", r.get("Project") or "",
            r.get("Owner") or "", r.get("Built_Status") or "",
            arcgis.coalesce(r, "Overall_SQ_FT", "CONCATENATE_Permit_Square_Feet", "Proposed_SQ_FT"),
            r.get("_geometry"), parcel_id=r.get("PA_MCPI") or "",
            zoning_case=r.get("Zoning_Case_Number") or "")

    print("Prince William buildings (with geometry)...")
    for r in arcgis.query(PW_BUILDINGS, geometry=True):
        add("pw_building", "Prince William County", r.get("BuildingName") or "",
            "", r.get("BuildingStatus") or "",
            arcgis.coalesce(r, "GFA", "PermittedGFA", "BPGFA", "ApprovedGFA", "REATaxedGFA"),
            r.get("_geometry"), parcel_id=r.get("GPIN") or "",
            zoning_case=r.get("PlanningCaseNumber") or "")

    print("PEC statewide...")
    for r in json.loads((RAW / "pec_statewide.json").read_text()):
        lon, lat = arcgis.num(r.get("Long")), arcgis.num(r.get("Lat"))
        geom = {"type": "Point", "coordinates": [lon, lat]} if lon and lat else None
        add("pec", (r.get("Locality") or "").strip(), r.get("Name") or "",
            r.get("Owner_Applicant") or "", r.get("Build_Status") or "",
            arcgis.num(r.get("Building_Sq_Ft")), geom,
            parcel_id=r.get("Parcel_ID") or "", zoning_case="",
            mw=arcgis.num(r.get("MW_reported")) or "")

    cols = ["source", "locality", "name", "operator", "operator_confidence", "operator_raw",
            "operator_osm", "osm_ref", "status", "sq_ft", "mw", "utility", "utility_confidence", "utility_candidates", "utility_boundary_m",
            "self_generation", "self_generation_source", "parcel_id", "zoning_case", "lon", "lat"]
    dest = ROOT / "data" / "registry.csv"
    with dest.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            r.setdefault("mw", "")
            w.writerow({k: arcgis.scrub(v) for k, v in r.items()})
    print(f"\nwrote {dest.relative_to(ROOT)}  ({len(rows)} rows)")


if __name__ == "__main__":
    main()
