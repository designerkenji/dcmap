"""US parcel boundaries by point, from Precisely's Property Information API.

    python3 parcels_precisely.py --budget 10     # first run: a probe
    python3 parcels_precisely.py                 # then: default 250 requests

The second US parcel vendor, wired the same way as parcels_regrid.py so the
two can be compared on the map and against the footprints - which is the
point: each vendor is on trial, and trials are judged side by side.

CREDENTIALS. OAuth2 client-credentials: data/raw/precisely_key.txt holds
KEY:SECRET on one line (or set PRECISELY_KEY and PRECISELY_SECRET). data/raw/
is gitignored. The token endpoint mints a bearer that this script refreshes
when it expires.

THE BUDGET COUNTS REQUESTS, NOT RESULTS - the opposite of Regrid's, because
the billing is the opposite: Precisely deducts credits per successful call,
and a successful call that finds no parcel may still bill. The trial holds
2,500 credits and the parcelboundary endpoint's credit WEIGHT is not
published anywhere, which is why the first run should be a small probe:
check the account's credit balance before and after ~10 calls, and the
difference divided by ten is the number Precisely does not print. Every
answer is cached; nothing is asked twice.
"""

from __future__ import annotations

import base64
import csv
import json
import os
import pathlib
import sys
import time
import urllib.parse
import urllib.request

import geo

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
DEST = RAW / "parcels_precisely.geojson"
DEST_INTL = RAW / "parcels_precisely_intl.geojson"
CACHE = RAW / "parcels_precisely_cache"
KEY_FILE = RAW / "precisely_key.txt"
TOKEN_URL = "https://api.cloud.precisely.com/auth/v2/token"
# The Data Integrity Suite's OGC API Features service. The classic
# parcelboundary endpoint lives on the OLD platform and rejects DIS keys -
# probed live 2026-08-24: DIS serves the same claim through the standards
# path, GET collections/properties/parcels/items with a bounding box, and the
# same service also carries properties/buildings and the risk layers.
API = ("https://api.cloud.precisely.com/v1/ogcapi/enrich"
       "/collections/properties/parcels/items")
# The catalog scan of 2026-08-27 found parcel geometry for exactly three
# countries; each rides its own collection with its own schema. area units
# differ and were established against known lots: US square feet, CA/AU
# square metres (a Vancouver house lot read 564, a Derrimut industrial lot
# 86,837 - neither is sane in feet).
COLLECTIONS = {
    "US": API,
    "CA": ("https://api.cloud.precisely.com/v1/ogcapi/enrich"
           "/collections/properties/parcels_canada/items"),
    "AU": ("https://api.cloud.precisely.com/v1/ogcapi/enrich"
           "/collections/properties/parcels_australia_lot/items"),
}
# Owner names live in a SEPARATE collection of address points - the parcels
# collection carries geometry and APN only, by schema, not by settings. So a
# named parcel costs two requests where Regrid's costs one; --owners spends
# the second request for parcels already fetched.
ATTRS = ("https://api.cloud.precisely.com/v1/ogcapi/enrich"
         "/collections/properties/property_attributes/items")
UA = {"User-Agent": "reinsurance_dc-research/1.0"}


def credentials() -> tuple[str, str]:
    k = os.environ.get("PRECISELY_KEY", "").strip()
    s = os.environ.get("PRECISELY_SECRET", "").strip()
    if not (k and s) and KEY_FILE.exists():
        raw = KEY_FILE.read_text().strip()
        if ":" in raw:
            k, s = raw.split(":", 1)
        else:
            lines = raw.splitlines()
            if len(lines) >= 2:
                k, s = lines[0].strip(), lines[1].strip()
    if not (k and s):
        raise SystemExit("need KEY and SECRET: put KEY:SECRET in "
                         f"{KEY_FILE.relative_to(ROOT)} (gitignored) or set "
                         "PRECISELY_KEY / PRECISELY_SECRET")
    return k, s


def bearer(k: str, s: str) -> str:
    # DIS insists on scope=default and the v2 path; v1 answers 415 and the old
    # platform's /oauth/token calls a DIS key "invalid client".
    req = urllib.request.Request(
        TOKEN_URL, data=b"grant_type=client_credentials&scope=default",
        headers={**UA, "Authorization": "Basic "
                 + base64.b64encode(f"{k}:{s}".encode()).decode(),
                 "Content-Type": "application/x-www-form-urlencoded"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())["access_token"]


def find_geometry(obj):
    """The first Polygon/MultiPolygon anywhere in the response.

    Parsed structurally rather than by field name: the docs behind the trial
    wall do not say whether the geometry rides as `geometry`, `parcelBoundary`
    or something else, and a wrong guess would read as "no parcel anywhere".
    """
    if isinstance(obj, dict):
        if obj.get("type") in ("Polygon", "MultiPolygon") and obj.get("coordinates"):
            return obj
        for v in obj.values():
            g = find_geometry(v)
            if g:
                return g
    elif isinstance(obj, list):
        for v in obj:
            g = find_geometry(v)
            if g:
                return g
    return None


def parcel_at(tok: str, lon: float, lat: float, country: str = "US") -> dict | None:
    # A ~40 m box, because OGC Features has no point-intersects shorthand.
    # Several parcels can graze the box; the one CONTAINING the dot is the
    # answer, and none containing it is the honest nothing.
    d = 0.0002
    q = urllib.parse.urlencode({
        "bbox": f"{lon - d},{lat - d},{lon + d},{lat + d}", "limit": "5"})
    req = urllib.request.Request(f"{COLLECTIONS[country]}?{q}",
                                 headers={**UA, "Authorization": f"Bearer {tok}"})
    body = json.loads(urllib.request.urlopen(req, timeout=60).read())
    for f in body.get("features") or []:
        geom = f.get("geometry") or {}
        if geom.get("type") not in ("Polygon", "MultiPolygon"):
            continue
        rings = geo._rings(geom if geom["type"] == "Polygon"
                           else {"type": "Polygon",
                                 "coordinates": [r for p in geom["coordinates"] for r in p]})
        if sum(1 for r in rings if geo._in_ring(lon, lat, r)) % 2 != 1:
            continue
        a = f.get("properties") or {}
        if country == "US":
            attrs = {"ref": a.get("parcel_apn") or a.get("prclid") or "",
                     "fips": a.get("fips") or "",
                     # `area` measured against a known lot reads as square feet.
                     "acres": round(float(a["area"]) / 43560, 2) if a.get("area") else ""}
        else:
            # CA carries no locality field at all; AU names suburb and state.
            loc = ", ".join(x for x in (a.get("locality"), a.get("state_abbr"))
                            if x) or ("Canada" if country == "CA" else "Australia")
            attrs = {"ref": a.get("cpn") or a.get("prclid") or "",
                     "fips": loc,
                     "acres": round(float(a["area"]) / 4046.856, 2) if a.get("area") else ""}
        return {"geometry": geom, "attrs": attrs}
    return None


def owner_at(tok: str, lon: float, lat: float, geom, apn: str) -> str:
    """The owner of THIS parcel, from the property points around the site.

    Ranked join, strongest claim first: a point whose APN matches the
    parcel's AND stands inside it; then an APN match; then any named point
    inside the parcel. A point merely nearby claims nothing - the next lot's
    owner is exactly the wrong answer to return confidently.
    """
    d = 0.0015
    q = urllib.parse.urlencode({
        "bbox": f"{lon - d},{lat - d},{lon + d},{lat + d}", "limit": "10"})
    req = urllib.request.Request(f"{ATTRS}?{q}",
                                 headers={**UA, "Authorization": f"Bearer {tok}"})
    body = json.loads(urllib.request.urlopen(req, timeout=60).read())
    rings = geo._rings(geom if geom["type"] == "Polygon"
                       else {"type": "Polygon",
                             "coordinates": [r for pp in geom["coordinates"] for r in pp]})
    best, best_rank = "", -1
    for f in body.get("features") or []:
        g = f.get("geometry") or {}
        if g.get("type") != "Point":
            continue
        px, py = g["coordinates"][:2]
        p = f.get("properties") or {}
        name = (p.get("owner_name") or "").strip()
        if not name or name.lower() == "none":
            continue
        inside = sum(1 for r in rings if geo._in_ring(px, py, r)) % 2 == 1
        apn_ok = bool(apn) and p.get("prop_apn") == apn
        rank = (2 if apn_ok else 0) + (1 if inside else 0)
        if rank > best_rank and (inside or apn_ok):
            best, best_rank = name, rank
    return best


def enrich_owners(tok: str) -> None:
    coords = {}
    with (ROOT / "data" / "facilities_sites.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r.get("lat"):
                coords[r["site_id"]] = (float(r["lon"]), float(r["lat"]))
    todo = []
    for p in sorted(CACHE.glob("*.json")):
        hit = json.loads(p.read_text())
        if hit and hit.get("geometry") and not hit.get("attrs", {}).get("owner"):
            if p.stem in coords:
                todo.append((p, hit))
    print(f"{len(todo)} parcels without an owner name")
    done = named = errs = 0
    for p, hit in todo:
        lon, lat = coords[p.stem]
        try:
            owner = owner_at(tok, lon, lat, hit["geometry"],
                             hit.get("attrs", {}).get("ref", ""))
        except Exception as e:  # noqa: BLE001
            errs += 1
            print(f"  {p.stem}: {e}")
            if errs >= 5:
                print("  five straight failures - stopping")
                break
            continue
        errs = 0
        hit.setdefault("attrs", {})["owner"] = owner
        p.write_text(json.dumps(hit))
        done += 1
        if owner:
            named += 1
        time.sleep(0.25)
    print(f"asked {done}, named {named}")
    write_out()


def site_groups(country: str = "US") -> tuple[list, list]:
    fp = ROOT / "data" / "footprints.geojson"
    covered = set()
    if fp.exists():
        for f in json.loads(fp.read_text()).get("features", []):
            covered.update(f["properties"].get("sites") or ())
    new, verify = [], []
    with (ROOT / "data" / "facilities_sites.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r.get("country") != country or not r.get("lat"):
                continue
            if (r.get("geo_precision") or "exact") != "exact":
                continue
            t = (r["site_id"], float(r["lon"]), float(r["lat"]))
            (verify if r["site_id"] in covered else new).append(t)
    return new, verify


def retry_buildings(tok: str, countries: list, budget: int) -> None:
    """Second chance for dots that hit nothing: ask at the site's building
    rooftops instead. The England matcher proved the failure mode - a dot
    geocoded to the kerb sits between parcels; a building centroid cannot -
    and each retry costs a request, so only sites with a mapped building and
    an empty cached answer are re-asked, two rooftops at most.
    """
    import parcels_inspire_uk as uk
    bcents = uk.building_centroids()
    country = {}
    with (ROOT / "data" / "facilities_sites.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            country[r["site_id"]] = r.get("country") or ""
    todo = []
    for pth in sorted(CACHE.glob("*.json")):
        if country.get(pth.stem) not in countries:
            continue
        if json.loads(pth.read_text()):
            continue                      # already has a parcel
        cents = bcents.get(pth.stem)
        if cents:
            todo.append((pth.stem, cents[:2]))
    print(f"{len(todo)} empty-answer sites in {'/'.join(countries)} with a "
          f"mapped building; budget {budget} requests")
    asked = won = 0
    for sid, cents in todo:
        if asked >= budget:
            print("  budget reached")
            break
        hit = None
        for cx, cy in cents:
            if asked >= budget:
                break
            try:
                hit = parcel_at(tok, cx, cy, country[sid])
            except Exception as e:  # noqa: BLE001
                print(f"  {sid}: {e}")
                break
            asked += 1
            time.sleep(0.25)
            if hit:
                break
        if hit:
            hit["grp"] = "new"
            hit["via"] = "building-centroid"
            (CACHE / f"{sid}.json").write_text(json.dumps(hit))
            won += 1
    print(f"asked {asked}, recovered {won}")
    write_out()


def main() -> None:
    budget = 250
    if "--budget" in sys.argv:
        budget = int(sys.argv[sys.argv.index("--budget") + 1])
    k, s = credentials()
    tok = bearer(k, s)
    CACHE.mkdir(parents=True, exist_ok=True)
    if "--owners" in sys.argv:
        return enrich_owners(tok)
    if "--retry-buildings" in sys.argv:
        countries = [a.upper() for a in sys.argv[1:] if a.upper() in COLLECTIONS] or ["CA", "AU"]
        return retry_buildings(tok, countries, budget)
    cached = {p.stem for p in CACHE.glob("*.json")}
    countries = [a.upper() for a in sys.argv[1:] if a.upper() in COLLECTIONS] or ["US"]
    # Every country's new-coverage group outranks every verify group: when the
    # budget dies mid-run it should die on parcels nobody had, not on
    # double-checks.
    ordered = []
    for cy in countries:
        new, verify = site_groups(cy)
        ordered.append((cy, "new", new))
    for cy in countries:
        ordered.append((cy, "verify", site_groups(cy)[1]))
    for cy, g, sites in ordered:
        left = sum(1 for t in sites if t[0] not in cached)
        print(f"{cy} {g}: {len(sites)} sites, {left} not yet asked")
    print(f"request budget this run: {budget}")

    asked = hits = errs = 0
    for cy, g, sites in ordered:
        for sid, lon, lat in sites:
            if sid in cached:
                continue
            if asked >= budget:
                print(f"  request budget of {budget} reached - check the credit "
                      "balance to learn the per-call weight, then rerun")
                return write_out()
            try:
                hit = parcel_at(tok, lon, lat, cy)
            except urllib.error.HTTPError as e:
                if e.code == 401:            # token expired mid-run: refresh once
                    tok = bearer(k, s)
                    continue
                errs += 1
                print(f"  {sid}: HTTP {e.code}")
                if e.code in (402, 403, 429) or errs >= 5:
                    print("  quota or repeated failure - stopping")
                    return write_out()
                continue
            except Exception as e:  # noqa: BLE001
                errs += 1
                print(f"  {sid}: {e}")
                if errs >= 5:
                    print("  five straight failures - stopping")
                    return write_out()
                continue
            errs = 0
            asked += 1
            if hit:
                hit["grp"] = g
                hits += 1
            (CACHE / f"{sid}.json").write_text(json.dumps(hit or {}))
            cached.add(sid)
            time.sleep(0.25)
    write_out()


def write_out() -> None:
    # Two files from one cache, split by the SITE's country. The US parcels
    # were bought as verification instruments against the footprints and must
    # stay outside the layer they check; the Canadian and Australian ones are
    # PRIMARY coverage - no other parcel source exists there - so they merge
    # into the footprints like the UK and Scottish files do.
    country = {}
    with (ROOT / "data" / "facilities_sites.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            country[r["site_id"]] = r.get("country") or ""
    feats, intl = [], []
    for p in sorted(CACHE.glob("*.json")):
        hit = json.loads(p.read_text())
        if not hit:
            continue
        cy = country.get(p.stem, "US")
        if cy in ("CA", "AU"):
            intl.append({
                "type": "Feature", "geometry": hit["geometry"],
                "properties": {
                    "id": f"fp-parcel-pcy-{hit.get('attrs', {}).get('ref') or p.stem}",
                    "kind": "campus", "src": "parcel", "name": "", "op": "",
                    "ref": hit.get("attrs", {}).get("ref", ""),
                    "locality": hit.get("attrs", {}).get("fips", "") or cy,
                    "acres": str(hit.get("attrs", {}).get("acres", "")),
                    "for_site": p.stem,
                    **({"via": hit["via"]} if hit.get("via") else {}),
                },
            })
            continue
        feats.append({
            "type": "Feature", "geometry": hit["geometry"],
            "properties": {
                "id": f"precisely-{p.stem}",
                "src": "precisely", "grp": hit.get("grp", "new"),
                "op": hit.get("attrs", {}).get("owner", ""),
                "ref": hit.get("attrs", {}).get("ref", ""),
                "locality": hit.get("attrs", {}).get("fips", "") or "US",
                "acres": str(hit.get("attrs", {}).get("acres", "")),
                "for_site": p.stem,
            },
        })
    DEST.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    DEST_INTL.write_text(json.dumps({"type": "FeatureCollection", "features": intl}))
    n = sum(1 for f in feats if f["properties"]["grp"] == "new")
    print(f"wrote {DEST.relative_to(ROOT)}  ({len(feats)} US parcels: "
          f"{n} new-coverage, {len(feats) - n} for verification)")
    print(f"wrote {DEST_INTL.relative_to(ROOT)}  ({len(intl)} CA/AU parcels, "
          "merged by footprints.py as primary coverage)")


if __name__ == "__main__":
    main()
