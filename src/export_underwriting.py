#!/usr/bin/env python3
"""Export the registry as the underwriting platform's asset feed.

    python3 export_underwriting.py

Writes the three CSVs that Reinsurance_Underwriting_Platform_Package's
10_asset_intelligence.py ingests (05_Sample_Data/sample_asset_data is the
reference shape):

    data/export_underwriting/assets.csv
    data/export_underwriting/dependencies.csv
    data/export_underwriting/asset_dependency_links.csv

WHAT IS EXPORTED, AND WHAT HONESTLY CANNOT BE
  assets        every exactly-mapped site (DATA_CENTER) and fab
                (SEMICONDUCTOR_FAB). The loader requires latitude/longitude
                as floats, so approximately-located rows stay home rather
                than being shipped wearing a coordinate they do not have.
  estimated_tiv_m  REQUIRED by the loader, and this registry does not
                estimate valuations - inventing one here would launder a
                guess into a pricing input. Exported as 0.0, which any
                consumer must treat as "not established". The moment the
                registry earns a TIV model, this is the column it feeds.
  dependencies  every PLACED substation from the dependency ledger
                (POWER_SUBSTATION). Unplaced ones have no coordinate to
                stand behind and are counted in the summary instead.
  links         dependency edges whose load resolves to an exported asset.
                Most edges hang off NYISO queue loads that are not yet
                matched to registry sites - those are reported, not shipped,
                because a link to an asset the file does not contain is a
                foreign-key error at best.
"""

from __future__ import annotations

import csv
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = DATA / "export_underwriting"

STATUS = {"operating": "OPERATIONAL", "construction": "CONSTRUCTION",
          "announced": "ANNOUNCED", "closed": "OPERATIONAL"}


def region_of(country: str, state: str = "") -> str:
    country = (country or "").strip().upper()
    state = (state or "").strip().upper()
    return f"{country}-{state}" if country == "US" and state else country or "UNKNOWN"


def overrides() -> dict:
    """site_id -> {field: value}, latest write wins.

    The pipeline never applies data/site_overrides.csv - the SERVER does, at
    load time, so facilities_sites.csv carries pre-correction values on every
    hand-corrected site. An export that skipped this shipped the Goodnight
    campus 11 km from where a person had already put it. Same latest-wins rule
    as dcmap/lib/overrides.mjs.
    """
    out: dict[str, dict] = {}
    f = DATA / "site_overrides.csv"
    if f.exists():
        with f.open(encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                out.setdefault(r["site_id"], {})[r["field"]] = r["value"]
    return out


def main() -> None:
    OUT.mkdir(exist_ok=True)

    ovr = overrides()
    assets, skipped_loc = [], 0
    with (DATA / "facilities_sites.csv").open(encoding="utf-8") as fh:
        for s in csv.DictReader(fh):
            o = ovr.get(s["site_id"], {})
            for k in ("lat", "lon", "name", "operator", "address"):
                if o.get(k):
                    s[k] = o[k]
            # A hand-placed coordinate is exact by construction: a person put
            # the dot there, which is precisely what "exact" claims.
            if o.get("lat") and o.get("lon"):
                s["geo_precision"] = "exact"
            if not s.get("lat") or (s.get("geo_precision") or "exact") != "exact":
                skipped_loc += 1
                continue
            assets.append({
                "asset_id": s["site_id"],
                "asset_name": s.get("name") or s.get("epoch_name") or s["site_id"],
                "asset_type": "DATA_CENTER",
                "campus_id": s.get("parent_site_id") or "",
                "operator": s.get("operator") or "",
                "latitude": s["lat"], "longitude": s["lon"],
                "address": s.get("address") or s.get("city") or "",
                "region": region_of(s.get("country"), s.get("state")),
                "estimated_tiv_m": "0.0",
            })
    for f in json.loads((DATA / "fabs.json").read_text()):
        if f.get("lat") is None:
            skipped_loc += 1
            continue
        assets.append({
            "asset_id": f["id"],
            "asset_name": f.get("nm") or f.get("name") or f["id"],
            "asset_type": "SEMICONDUCTOR_FAB",
            "campus_id": "",
            "operator": f.get("op") or f.get("grp") or "",
            "latitude": f["lat"], "longitude": f["lon"],
            "address": f.get("pl") or "",
            "region": region_of(f.get("cy"), f.get("st")),
            "estimated_tiv_m": "0.0",
        })

    subs = json.loads((DATA / "substations.json").read_text())
    deps, unplaced = [], 0
    for s in subs:
        if s.get("lat") is None:
            unplaced += 1
            continue
        deps.append({"dependency_id": s["id"], "dependency_type": "POWER_SUBSTATION",
                     "dependency_name": s.get("name") or s["id"]})
    dep_ids = {d["dependency_id"] for d in deps}
    asset_ids = {a["asset_id"] for a in assets}

    links, dropped = [], 0
    for e in json.loads((DATA / "power_dependencies.json").read_text()):
        if e.get("asset_id") in asset_ids and e.get("dependency_asset_id") in dep_ids:
            links.append({"asset_id": e["asset_id"],
                          "dependency_id": e["dependency_asset_id"]})
        else:
            dropped += 1

    for name, rows, cols in (
        ("assets.csv", assets, ["asset_id", "asset_name", "asset_type", "campus_id",
                                "operator", "latitude", "longitude", "address",
                                "region", "estimated_tiv_m"]),
        ("dependencies.csv", deps, ["dependency_id", "dependency_type", "dependency_name"]),
        ("asset_dependency_links.csv", links, ["asset_id", "dependency_id"]),
    ):
        with (OUT / name).open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=cols, lineterminator="\n")
            w.writeheader()
            w.writerows(rows)
        print(f"wrote {(OUT / name).relative_to(ROOT)}  ({len(rows):,} rows)")

    print(f"  held back: {skipped_loc:,} assets without an exact coordinate, "
          f"{unplaced} unplaced substations, {dropped} edges whose load is not "
          f"an exported asset (mostly unmatched NYISO queue entries)")
    print("  estimated_tiv_m is 0.0 THROUGHOUT - the registry does not estimate "
          "valuations; treat zero as \"not established\", never as a value")


if __name__ == "__main__":
    main()
