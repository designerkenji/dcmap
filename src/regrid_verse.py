#!/usr/bin/env python3
"""When each county's parcel data was last refreshed, from Regrid's verse table.

    python3 regrid_verse.py [--force]

WHY THIS EXISTS
The parcel cache never re-asked about a site once it had an answer, which is
the right instinct for a vendor that bills per record returned and the wrong
behaviour for somebody who has just clicked "Pull REGRID parcel" - a click IS
the question "has this changed?".

The verse table answers that without guessing. Each row is a US county with
`last_refresh`, "the date of the last full refresh of data from our county
source". Compare it against when we cached a parcel and the answer is exact:
if the county has not been refreshed since, re-asking cannot return anything
new and would only spend money to receive the same record. If it HAS, the
cached copy is stale and worth replacing.

BILLING
Regrid bills per parcel RECORD RETURNED. verse rows are county metadata, not
parcels, so this should not touch the parcel quota - but "should" is doing work
there, so the run prints the row count and nothing here loops.

The output is data/regrid_counties.json, keyed by the Census county GEOID.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "regrid_counties.json"
TOKEN_FILE = RAW / "regrid_token.txt"
API = "https://app.regrid.com/api/v2/verse"
UA = {"User-Agent": "reinsurance_dc-research/1.0"}


def token() -> str:
    t = os.environ.get("REGRID_TOKEN", "").strip()
    if not t and TOKEN_FILE.exists():
        t = TOKEN_FILE.read_text().strip()
    if not t:
        raise SystemExit("no token: set REGRID_TOKEN or put it in "
                         f"{TOKEN_FILE.relative_to(ROOT)} (data/raw/ is gitignored)")
    return t


def fetch(tok: str) -> list[dict]:
    """The whole verse table. ~3,200 US counties, one request."""
    url = API + "?" + urllib.parse.urlencode({"token": tok})
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as fh:
        body = json.load(fh)
    # {"verse": {"type": "FeatureCollection", "features": [...]}} - the same
    # envelope the parcel endpoints use, so verse rows arrive as Features with
    # the row under `properties`.
    v = body.get("verse") if isinstance(body, dict) else None
    if isinstance(v, dict) and isinstance(v.get("features"), list):
        return v["features"]
    if isinstance(v, list):
        return v
    if isinstance(body, list):
        return body
    raise SystemExit(f"unexpected verse response shape: {list(body)[:8]}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="refetch even if the file exists")
    args = ap.parse_args()

    if OUT.exists() and not args.force:
        print(f"{OUT.relative_to(ROOT)} exists — pass --force to refresh")
        return

    rows = fetch(token())
    print(f"verse: {len(rows):,} rows")

    out = {}
    for r in rows:
        # Rows may arrive flat or as GeoJSON-ish features.
        f = r.get("properties") if isinstance(r.get("properties"), dict) else r
        geoid = str(f.get("geoid") or "").strip()
        if not geoid:
            continue
        # The API returns friendlier names than the verse TABLE schema
        # documents: county/state here, admin2/admin1 in the table. Read both.
        rec = {
            "county": f.get("county") or f.get("admin2") or "",
            "state": f.get("state") or f.get("admin1") or "",
            "last_refresh": (f.get("last_refresh") or "")[:10],
        }
        if f.get("total_objects"):
            rec["parcels"] = f["total_objects"]
        for extra in ("assessor_data_date", "usps_data_date", "address_date"):
            v = f.get(extra)
            if v:
                rec[extra] = str(v)[:10]
        out[geoid] = rec

    dated = sum(1 for r in out.values() if r["last_refresh"])
    OUT.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}  ({len(out):,} counties, {dated:,} with a refresh date)")

    if dated:
        newest = sorted((r["last_refresh"] for r in out.values() if r["last_refresh"]),
                        reverse=True)
        print(f"  newest county refresh: {newest[0]} · oldest: {newest[-1]}")


if __name__ == "__main__":
    main()
