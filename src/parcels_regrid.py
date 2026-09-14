"""US parcel boundaries by point, from Regrid's parcel API.

    python3 parcels_regrid.py [--limit N]

parcels.py reads the ~30 county layers that happen to publish data-centre
parcels; Regrid is the other 3,000 counties behind one endpoint. Same claim
on the way out as every other parcel source - kind=campus, src=parcel - and
footprints.py merges the output file exactly like the ArcGIS and WFS ones.

THE TOKEN, AND WHY THE CACHE IS NOT OPTIONAL
The token is read from $REGRID_TOKEN or data/raw/regrid_token.txt (data/raw/*
is gitignored, so it cannot be committed by accident). Regrid bills per parcel
RECORD RETURNED, not per request - an empty answer is free, a repeated answer
is not. So every site's answer is cached to disk the moment it arrives and a
cached site is never asked again; delete a file under
data/raw/parcels_regrid_cache/ to re-ask about one site deliberately.
limit=1 is pinned on every request for the same reason: the point form can
also take a radius, and a radius query returning N parcels bills N records.

The sandbox token answers for a handful of demo counties only and returns
empty everywhere else - which costs nothing, so a full run under sandbox is a
safe dry run that yields wherever the demo counties overlap the registry.

Only sites without a RECORDED campus boundary are asked (the wfs_parcels.py
criterion - a derived hull does not count, a parcel or OSM campus does), and
only exactly-located ones: buying the parcel under a town-centroid guess would
be paying money to dress the guess up as a survey.
"""

from __future__ import annotations

import csv
import json
import os
import pathlib
import time
import urllib.parse
import urllib.request

import geo

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
DEST = RAW / "parcels_regrid.geojson"
CACHE = RAW / "parcels_regrid_cache"
TOKEN_FILE = RAW / "regrid_token.txt"
API = "https://app.regrid.com/api/v2/parcels/point"
UA = {"User-Agent": "reinsurance_dc-research/1.0"}


def token() -> str:
    t = os.environ.get("REGRID_TOKEN", "").strip()
    if not t and TOKEN_FILE.exists():
        t = TOKEN_FILE.read_text().strip()
    if not t:
        raise SystemExit("no token: set REGRID_TOKEN or put it in "
                         f"{TOKEN_FILE.relative_to(ROOT)} (data/raw/ is gitignored)")
    return t


def site_groups() -> tuple[list, list]:
    """US exactly-located sites, split by whether a footprint already covers them.

    Two groups because the run has two jobs with separate record budgets:
      new     - no footprint of any kind: a Regrid parcel is NEW information.
      verify  - a footprint exists: the parcel is bought to be COMPARED with
                it on the map, which is how the source earns trust before its
                shapes are allowed to merge into the footprints layer proper.
    """
    fp = ROOT / "data" / "footprints.geojson"
    covered = set()
    if fp.exists():
        for f in json.loads(fp.read_text()).get("features", []):
            covered.update(f["properties"].get("sites") or ())
    new, verify = [], []
    with (ROOT / "data" / "facilities_sites.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r.get("country") != "US" or not r.get("lat"):
                continue
            if (r.get("geo_precision") or "exact") != "exact":
                continue
            t = (r["site_id"], float(r["lon"]), float(r["lat"]))
            (verify if r["site_id"] in covered else new).append(t)
    return new, verify


def parcel_at(tok: str, lon: float, lat: float) -> dict | None:
    q = urllib.parse.urlencode({"lat": f"{lat:.6f}", "lon": f"{lon:.6f}",
                                "limit": "1", "token": tok})
    body = urllib.request.urlopen(
        urllib.request.Request(f"{API}?{q}", headers=UA), timeout=60).read()
    fc = json.loads(body)
    feats = (fc.get("parcels") or fc).get("features") if isinstance(fc, dict) else None
    for f in feats or []:
        geom = f.get("geometry") or {}
        if geom.get("type") not in ("Polygon", "MultiPolygon"):
            continue
        # Regrid's point endpoint should return the containing parcel, but the
        # repo's rule is to measure rather than trust: if the dot is not
        # inside, the honest answer is nothing.
        rings = geo._rings(geom if geom["type"] == "Polygon"
                           else {"type": "Polygon",
                                 "coordinates": [r for p in geom["coordinates"] for r in p]})
        if sum(1 for r in rings if geo._in_ring(lon, lat, r)) % 2 != 1:
            continue
        props = f.get("properties") or {}
        fields = props.get("fields") or props
        # KEEP EVERY FIELD. This kept four and discarded ~160, which was
        # throwing away data already paid for: Regrid bills per parcel
        # RETURNED and a cached parcel is never re-asked, so a dropped field
        # could only be recovered by buying the same parcel again. The four
        # short names stay on top because the rest of the pipeline reads them
        # by those names; the county's own fields ride underneath.
        attrs = dict(fields)
        attrs.update({
            "ref": fields.get("parcelnumb") or props.get("ll_uuid") or "",
            "owner": fields.get("owner") or "",
            "locality": ", ".join(x for x in (fields.get("county"),
                                              fields.get("state2")) if x),
            "acres": fields.get("ll_gisacre") or fields.get("gisacre") or "",
        })
        return {"geometry": geom, "attrs": attrs}
    return None


# One thousand RECORDS per group, which is money (or sandbox quota), not
# requests: empties are free, so the whole target list can be asked and each
# group simply stops charging once its thousandth parcel has come back.
BUDGET = 1000

# The trial token also caps at 25 RESULTS PER DAY. Tracked off the cache
# files' own mtimes - a non-empty answer written today is a result spent
# today - so the cap needs no extra bookkeeping file and survives restarts.
# When it is hit the run stops cleanly; tomorrow's run resumes from the cache
# exactly where this one stopped. Raise (or delete) this on a paid plan.
DAY_BUDGET = 25


def spent_today() -> int:
    import datetime
    midnight = datetime.datetime.now().replace(
        hour=0, minute=0, second=0, microsecond=0).timestamp()
    n = 0
    for p in CACHE.glob("*.json"):
        if p.stat().st_mtime >= midnight and p.read_text() not in ("{}", ""):
            n += 1
    return n


def main() -> None:
    tok = token()
    CACHE.mkdir(parents=True, exist_ok=True)
    groups = dict(zip(("new", "verify"), site_groups()))
    # Which group a cached answer belonged to is re-derivable, but hits must
    # count against the right budget across runs, so group rides in the cache.
    spent = {"new": 0, "verify": 0}
    for p in CACHE.glob("*.json"):
        rec = json.loads(p.read_text())
        if rec:
            spent[rec.get("grp", "new")] = spent.get(rec.get("grp", "new"), 0) + 1
    cached = {p.stem for p in CACHE.glob("*.json")}
    today = spent_today()
    for g, sites in groups.items():
        print(f"{g}: {len(sites)} sites, {spent[g]}/{BUDGET} records already spent")
    print(f"today: {today}/{DAY_BUDGET} of the trial's daily results already used")

    errs = 0
    for g, sites in groups.items():
        for sid, lon, lat in sites:
            if sid in cached:
                continue
            if today >= DAY_BUDGET:
                print(f"  trial cap of {DAY_BUDGET} results/day reached - rerun "
                      "tomorrow; the cache resumes exactly here")
                return write_out()
            if spent[g] >= BUDGET:
                print(f"  {g}: budget of {BUDGET} records reached, stopping the group")
                break
            try:
                hit = parcel_at(tok, lon, lat)
            except Exception as e:  # noqa: BLE001
                errs += 1
                print(f"  {sid}: {e}")
                if errs >= 5:
                    print("  five straight failures - stopping rather than burning quota")
                    return write_out()
                continue
            errs = 0
            if hit:
                hit["grp"] = g
                spent[g] += 1
                today += 1
            (CACHE / f"{sid}.json").write_text(json.dumps(hit or {}))
            cached.add(sid)
            time.sleep(0.35)           # under their published 200/min
    write_out()


def write_out() -> None:
    feats = []
    for p in sorted(CACHE.glob("*.json")):
        hit = json.loads(p.read_text())
        if not hit:
            continue
        sid = p.stem
        a = hit["attrs"]
        feats.append({
            "type": "Feature", "geometry": hit["geometry"],
            "properties": {
                "id": f"regrid-{a['ref'] or sid}",
                "src": "regrid", "grp": hit.get("grp", "new"),
                "op": a["owner"], "ref": a["ref"],
                "locality": a["locality"] or "US",
                "acres": str(a["acres"]), "for_site": sid,
            },
        })
    DEST.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    n = sum(1 for f in feats if f["properties"]["grp"] == "new")
    print(f"wrote {DEST.relative_to(ROOT)}  ({len(feats)} parcels: "
          f"{n} new-coverage, {len(feats) - n} for verification)")


if __name__ == "__main__":
    main()
