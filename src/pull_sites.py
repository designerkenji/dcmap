"""Pull data center site records from Loudoun, Prince William, and PEC statewide.

Emits data/raw/*.json plus a normalized data/sites.csv with the columns the
project actually cares about: where, who operates it, how big, how much power.
Power and utility are deliberately left mostly empty here — neither county
publishes MW, so they get filled by separate joins (see enrich_power.py).
"""

from __future__ import annotations

import csv
import json
import pathlib

import arcgis

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
RAW.mkdir(parents=True, exist_ok=True)

LOUDOUN_EXISTING = "https://services1.arcgis.com/MxjRokvPm7bjslyR/ArcGIS/rest/services/Existing_Data_Center_Parcel/FeatureServer/1"
LOUDOUN_PIPELINE = "https://services1.arcgis.com/MxjRokvPm7bjslyR/ArcGIS/rest/services/Pipeline_Data_Center_Areas/FeatureServer/1"
LOUDOUN_PERMITS = "https://logis.loudoun.gov/gis/rest/services/LMARC/LandMARC_Permits/MapServer/1"
LOUDOUN_PLANS = "https://logis.loudoun.gov/gis/rest/services/Projects/LOLA_DATA/MapServer/0"
PW_BUILDINGS = "https://gisweb.pwcva.gov/arcgis/rest/services/Planning/Build_Out_Analysis/MapServer/9"
PW_CAMPUSES = "https://gisweb.pwcva.gov/arcgis/rest/services/Planning/Build_Out_Analysis/MapServer/10"
PEC = "https://services3.arcgis.com/mTaShYKffyWc5uRb/arcgis/rest/services/Data_Centers_Virginia/FeatureServer/19"

DC_LIKE = "UPPER(DESCRIPTION) LIKE '%DATA CENTER%'"
PLAN_LIKE = "UPPER(PlanName) LIKE '%DATA CENTER%'"

COLUMNS = [
    "source", "locality", "site_id", "name", "operator", "status",
    "sq_ft", "mw", "utility", "self_generation",
    "parcel_id", "zoning_case", "permit_case", "address", "year", "notes",
]


def save(name: str, rows: list[dict]) -> list[dict]:
    (RAW / f"{name}.json").write_text(json.dumps(rows, indent=1, default=str))
    print(f"  {name:<26} {len(rows):>6} rows")
    return rows


def blank(**kw) -> dict:
    r = {c: "" for c in COLUMNS}
    r.update(kw)
    return r


def main() -> None:
    out: list[dict] = []
    print("Loudoun:")
    for r in save("loudoun_existing", arcgis.query(LOUDOUN_EXISTING)):
        out.append(blank(
            source="loudoun_existing_dc_parcel", locality="Loudoun County",
            site_id=r.get("PA_MCPI", ""), name=r.get("Project", ""),
            operator=r.get("Owner", ""),
            status=r.get("Built_Status") or r.get("Data_Center_Status", ""),
            sq_ft=arcgis.coalesce(r, "Overall_SQ_FT", "CONCATENATE_Permit_Square_Feet", "Proposed_SQ_FT") or "",
            parcel_id=r.get("PA_MCPI", ""), zoning_case=r.get("Zoning_Case_Number", ""),
            permit_case=r.get("CONCATENATE_Permit_Number", ""),
            notes=r.get("Ownership_Category", ""),
        ))
    for r in save("loudoun_pipeline", arcgis.query(LOUDOUN_PIPELINE)):
        out.append(blank(
            source="loudoun_pipeline", locality="Loudoun County",
            name=r.get("Application", ""), status=r.get("FIRST_Status", ""),
            sq_ft=arcgis.num(r.get("FIRST_Overall_SQ_FT")) or "",
            zoning_case=r.get("FIRST_Zoning_Case_Num", ""),
            notes=f"pipeline acres={r.get('SUM_Pipeline_Acres', '')}",
        ))
    # Permits carry SQUAREFEET + applicant NAME - the finest-grain Loudoun size data.
    for r in save("loudoun_permits", arcgis.query(LOUDOUN_PERMITS, where=DC_LIKE)):
        addr = " ".join(str(r.get(k) or "") for k in
                        ("MAIN", "PREDIRECTION", "ADDRESSLINE1", "STREETTYPE")).split()
        out.append(blank(
            source="loudoun_permit", locality="Loudoun County",
            site_id=r.get("PermitNumber", ""), name=r.get("DESCRIPTION", ""),
            operator=r.get("NAME", ""), status=r.get("PermitStatus", ""),
            sq_ft=arcgis.num(r.get("SQUAREFEET")) or "",
            parcel_id=r.get("ParcelPIN", ""), permit_case=r.get("PermitNumber", ""),
            address=" ".join(addr), year=str(r.get("ISSUEDATE") or ""),
            notes=r.get("PermitType", ""),
        ))
    save("loudoun_plans", arcgis.query(LOUDOUN_PLANS, where=PLAN_LIKE))

    print("Prince William:")
    for r in save("pw_buildings", arcgis.query(PW_BUILDINGS)):
        out.append(blank(
            source="pw_building", locality="Prince William County",
            site_id=r.get("BuildingID", ""), name=r.get("BuildingName", ""),
            status=r.get("BuildingStatus", ""),
            # GFA is null on ~17% of rows, concentrated in completed buildings.
            sq_ft=arcgis.coalesce(r, "GFA", "PermittedGFA", "BPGFA", "ApprovedGFA", "REATaxedGFA") or "",
            parcel_id=r.get("GPIN", ""), zoning_case=r.get("PlanningCaseNumber", ""),
            permit_case=r.get("PermitCase", ""), address=r.get("Address", ""),
            year=str(r.get("YearBuilt") or ""), notes=r.get("PermitStatus", ""),
        ))
    for r in save("pw_campuses", arcgis.query(PW_CAMPUSES)):
        out.append(blank(
            source="pw_campus", locality="Prince William County",
            name=r.get("CampusName") or r.get("CaseName", ""),
            status=r.get("ProjectStatus", ""),
            sq_ft=arcgis.num(r.get("PlannedGFA")) or "",
            zoning_case=r.get("CaseNumber", ""), notes=r.get("ZoningDistrict", ""),
        ))

    print("Statewide:")
    for r in save("pec_statewide", arcgis.query(PEC)):
        out.append(blank(
            source="pec", locality=(r.get("Locality") or "").strip(),
            site_id=r.get("PEC_ID", ""), name=r.get("Name", ""),
            operator=r.get("Owner_Applicant", ""), status=r.get("Build_Status", ""),
            sq_ft=arcgis.num(r.get("Building_Sq_Ft")) or "",
            mw=arcgis.num(r.get("MW_reported")) or "",
            parcel_id=r.get("Parcel_ID", ""), address=r.get("Street_Address", ""),
            notes=f"updated={r.get('Date_Updated', '')}",
        ))

    dest = ROOT / "data" / "sites.csv"
    with dest.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=COLUMNS)
        w.writeheader()
        w.writerows({k: arcgis.scrub(v) for k, v in r.items()} for r in out)
    print(f"\nwrote {dest.relative_to(ROOT)}  ({len(out)} rows)")


if __name__ == "__main__":
    main()
