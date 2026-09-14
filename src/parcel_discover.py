"""Find data centres and fabs the registry does not have, by parcel OWNER.

WHAT THIS ADDS TO parcels.py, WHICH ALREADY TALKS TO THESE SAME LAYERS

parcels.py asks a statewide layer one question: "what parcel stands at this
coordinate?" That is enrichment, and by construction it can never find a site,
because it only ever looks where a site is already known to be. Its own comment
explains why it settled for that:

    a statewide parcel layer is millions of polygons, almost none of them ours,
    and no attribute that says which

True for "is this a data centre" - and NOT true for "who owns this". Eleven of
the twenty-six statewide layers publish an owner name, and an owner name is
exactly the attribute that says which. "ALIGNED DATA CENTERS CHANDLER PROPCO
LLC" is not ambiguous about what it is.

So this asks the opposite question of the same servers: not "what is at this
point" but "where is everything this owner holds". A parcel that comes back far
from every site in the registry is a site the registry is missing.

WHERE THE PATTERNS COME FROM

Not invented. parcels.py has already cached 967 parcels at known sites, 444 of
them carrying an owner, and those 372 distinct owner strings are a vocabulary
of how data-centre holding companies actually name themselves in assessor
records. They are the seed; the operator lists below extend them.

The generic patterns do most of the work. Site-holding LLCs are named after the
thing they hold - "NEW ALBANY DATA CENTER SPE LLC", "IO DATA CENTERS LLC" - so
"%DATA CENTER%" alone finds operators nobody thought to list.

WHAT THIS IS NOT

It is not a site list. A parcel owned by Amazon Data Services may be a running
data centre, a graded pad, or land bought for one - and the assessor's record
cannot tell those apart. Output is CANDIDATES, with the distance to the nearest
known site attached, for a human or a research pass to resolve. Nothing here
writes to the registry.

TWO LAYERS THIS CANNOT READ, AND WHY THAT IS NOT A BUG HERE

TxGIO's Texas parcels (14.3 million rows) and NCOneMap's statewide layer both
refuse an owner scan. Texas answers "Cannot perform query. Invalid query
parameters" after 55 seconds and North Carolina 504s - both are the gateway
timing out, not a malformed request, which is worth knowing because the Texas
message reads exactly like a bug in the caller and is not one. A leading-
wildcard LIKE cannot use an index, so the server scans, and at that row count
the scan outlives the gateway.

Constraining the envelope fixes it where the envelope can be made small enough:
the identical Texas query returns in 18 seconds over San Antonio alone, and
finds H5 Data Centers and Vantage TX1/TX2. The dense metros - DFW, Austin,
Houston - are still too big, and subdividing to reach them costs more requests
than the yield justifies at this depth cap.

So these two are REPORTED as unread rather than quietly returning nothing. An
empty result and an unasked question look identical in the output, and the
difference matters: "no data centres in Charlotte" is a claim this pass is in
no position to make.

    python3 parcel_discover.py            # all owner-bearing layers
    python3 parcel_discover.py tx az      # just these
"""

from __future__ import annotations

import collections
import concurrent.futures as cf
import json
import math
import pathlib
import re
import sys
import urllib.parse
import urllib.request

import parcels

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "raw" / "parcel_candidates.json"
SITES = ROOT / "data" / "facilities_sites.csv"
UA = {"User-Agent": "Mozilla/5.0 (reinsurance_dc research)"}

# Generic first, because they are the ones that find operators nobody listed.
GENERIC = ["DATA CENTER", "DATACENTER", "DATA CENTRE", "DATA CTR"]

# Patterns short enough to live inside an unrelated word need a word-boundary
# check after the fetch. SQL LIKE has no \\b, so the server over-returns on
# purpose and the filter happens here: "%BOSCH%" pulled sixty Arizona dairy
# parcels - BOSCHMA TOLLESON, GERBEN BOSCHMA DAIRY, BOSCHEE CHARLES L - and
# "%NXP%"/"%TSMC%"/"%MACOM%" are the same shape of trap.
TIGHT = {"BOSCH", "ROHM", "NXP SEMICONDUCTORS", "TSMC", "MACOM", "COHERENT",
         "II-VI", "QORVO", "VISHAY", "INTEL CORP", "SWITCH LTD", "SWITCH INC",
         "ALIGNED", "DIODES INC", "SEMICONDUCTOR", "ONSEMI"}

# Named operators, for the sites whose holding company is named after the
# parent rather than after the building.
DC_OWNERS = [
    "AMAZON DATA SERVICES", "MICROSOFT CORP", "META PLATFORMS", "GOOGLE LLC",
    "QTS ", "VANTAGE DATA", "EQUINIX", "DIGITAL REALTY", "CYRUSONE", "CORESITE",
    "STACK INFRA", "ALIGNED", "SWITCH LTD", "SWITCH INC", "EDGECONNEX",
    "DATABANK", "FLEXENTIAL", "TIERPOINT", "CYXTERA",
    "H5 DATA", "NTT GLOBAL", "PRIME DATA", "COMPASS DATA", "COLOHOUSE",
    # "IRON MOUNTAIN" alone is a Colorado PLACE name before it is a colo
    # operator: Iron Mountain Hot Springs, Iron Mountain Land Improvement,
    # Flatiron Mountain Ranch. The operator always writes a line of business
    # after it, so that is what is asked for.
    "IRON MOUNTAIN INFO", "IRON MOUNTAIN DATA",
    "COLOGIX", "COREWEAVE", "CLOUDHQ", "CORESCIENTIFIC", "APPLIED DIGITAL",
]

# Fabs. Front-end wafer fabs are owned under the parent's name far more often
# than data centres are, so these carry more of the load here than GENERIC does.
FAB_OWNERS = [
    "TEXAS INSTRUMENTS", "SAMSUNG AUSTIN", "INTEL CORP", "MICRON TECH",
    "GLOBALFOUNDRIES", "ANALOG DEVICES", "ON SEMICONDUCTOR", "ONSEMI",
    "WOLFSPEED", "SKYWATER", "X-FAB", "INFINEON", "NXP SEMICONDUCTORS",
    "TSMC", "QORVO", "MACOM", "COHERENT", "II-VI", "ROBERT BOSCH", "ROHM SEMICONDUCTOR",
    "SEMICONDUCTOR", "MICROCHIP TECH", "DIODES INC", "VISHAY", "POLAR SEMI",
]
# "BOSCH" was here and is not any more. A word-boundary check does not save it,
# because the boundaries are real: Bosch is a common SURNAME, and Iowa and
# Arizona between them returned a hundred parcels held by Bosch Farms LLC,
# BOSCH ARTHUR & BOSCH NAOMI TRUST and BOSCH KIM R. Only the corporate form
# distinguishes the company from the family, so only the corporate form is
# asked for. The same reasoning retired "%GOOGLE%", which matched 13,732 Google
# Fiber easements across Texas and not one data centre.

# UPPER() is not universally supported - TxGIO and NC both reject it - so each
# layer is tried with it and retried without. Case then depends on how the
# county stores names, which is why the plain form is a real fallback and not a
# formality: most store them upper already.
def where_for(field: str, pats: list[str], upper: bool) -> str:
    lhs = f"UPPER({field})" if upper else field
    return " OR ".join(f"{lhs} LIKE '%{p}%'" for p in pats)


def get(layer: str, params: dict, timeout: int = 150) -> dict:
    """POST to the layer's /query endpoint.

    The /query is not optional decoration. Posted to the LAYER url instead, an
    ArcGIS server ignores every parameter it does not recognise and returns the
    layer's own metadata document - which has no "error" key and no "features"
    key, so it reads as a perfectly successful query that matched nothing. That
    is how this returned a clean zero from eleven states at once.

    POST rather than GET because the where clause runs to hundreds of
    characters once the owner patterns are ORed together, and some of these
    servers cap the query string.
    """
    body = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(f"{layer}/query", data=body, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def envelope(b) -> dict:
    return {"xmin": b[0], "ymin": b[1], "xmax": b[2], "ymax": b[3],
            "spatialReference": {"wkid": 4326}}


def query(layer: str, field: str, pats: list[str], bbox, timeout: int = 45) -> list[dict]:
    """Rows for one batch of patterns inside one envelope.

    Raises on failure so the caller can decide to subdivide. UPPER() is tried
    first and retried without: TxGIO and NCOneMap both reject it.
    """
    last = None
    for upper in (True, False):
        params = {
            "where": where_for(field, pats, upper),
            "outFields": field,
            "returnGeometry": "true",
            "outSR": 4326,
            "resultRecordCount": 2000,
            "f": "json",
            "geometry": json.dumps(envelope(bbox)),
            "geometryType": "esriGeometryEnvelope",
            "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects",
        }
        try:
            d = get(layer, params, timeout=timeout)
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}"
            continue
        if "error" in d:
            last = (d["error"].get("message") or "")[:60]
            continue
        if "features" not in d:
            last = f"no 'features' key; got {sorted(d)[:5]}"
            continue
        return d["features"]
    raise RuntimeError(last or "query failed")


def fetch(layer, field, pats, bbox, depth=0, max_depth=2, log_skip=None):
    """Adaptive quadtree. Subdivide on failure, because failure means SIZE.

    A leading-wildcard LIKE cannot use an index, so these servers scan. Across
    Texas's 14.3 million parcels that scan exceeds the gateway timeout and comes
    back as "Cannot perform query. Invalid query parameters" - a timeout wearing
    a parameter error's clothes, which is why the first version of this looked
    like a malformed request and was not one. Constrained to San Antonio the
    identical query returns in 18 seconds.

    So a failure is not a dead end, it is an instruction to ask for less ground.
    Quartering the envelope quarters the rows the scan has to touch, and only
    the dense metros ever need more than one cut. Depth is capped because a
    layer that fails at 1/64th of a state is failing for some other reason, and
    those are REPORTED rather than silently dropped - a discovery pass that
    quietly skipped Charlotte would read as "no data centres in Charlotte".
    """
    try:
        return query(layer, field, pats, bbox)
    except Exception as e:  # noqa: BLE001
        if depth >= max_depth:
            if log_skip is not None:
                log_skip.append((bbox, str(e)[:60]))
            return []
    x0, y0, x1, y1 = bbox
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    out = []
    for quad in ((x0, y0, mx, my), (mx, y0, x1, my), (x0, my, mx, y1), (mx, my, x1, y1)):
        out += fetch(layer, field, pats, quad, depth + 1, max_depth, log_skip)
    return out


def centroid(geom: dict):
    rings = geom.get("rings") or []
    pts = [p for r in rings for p in r]
    if not pts:
        return None
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def ring_area_m2(geom: dict) -> float:
    """Rough planar area, good enough to reject an easement from a campus."""
    rings = geom.get("rings") or []
    if not rings:
        return 0.0
    r = rings[0]
    if len(r) < 3:
        return 0.0
    lat = sum(p[1] for p in r) / len(r)
    mx = 111320.0 * math.cos(math.radians(lat))
    my = 110540.0
    s = 0.0
    for i in range(len(r) - 1):
        s += (r[i][0] * mx) * (r[i + 1][1] * my) - (r[i + 1][0] * mx) * (r[i][1] * my)
    return abs(s) / 2.0


def km(lat1, lon1, lat2, lon2) -> float:
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def load_sites():
    """Data-centre sites AND fabs, kept apart.

    Measuring everything against facilities_sites.csv alone was wrong in a way
    that read as a discovery: TSMC's 802-acre Arizona parcel came back "11.9 km
    from the nearest site", which is true and meaningless - the nearest DATA
    CENTRE is irrelevant to a fab that the fab layer already holds.
    """
    import csv
    dc = []
    with SITES.open() as fh:
        for s in csv.DictReader(fh):
            if s.get("lat") and s.get("lon"):
                dc.append((float(s["lat"]), float(s["lon"]), s["name"], s["site_id"]))
    fabs = []
    fp = ROOT / "data" / "fabs.json"
    if fp.exists():
        for r in json.loads(fp.read_text()):
            if r.get("lat") is not None:
                fabs.append((float(r["lat"]), float(r["lon"]), r["n"], r["id"]))
    return dc, fabs


def word_ok(owner: str, pats: list[str]) -> bool:
    """Did this row match on a pattern that is really there, as a word?"""
    o = owner.upper()
    for p in pats:
        if p not in o:
            continue
        if p not in TIGHT:
            return True
        for m in re.finditer(re.escape(p), o):
            before = o[m.start() - 1] if m.start() else " "
            after = o[m.end()] if m.end() < len(o) else " "
            if not before.isalpha() and not after.isalpha():
                return True
    return False


def scan_one(job):
    """One source, one small batch of patterns. The unit of parallelism.

    BATCH SIZE IS THE WHOLE PERFORMANCE STORY. Each pattern is a leading-
    wildcard LIKE, which no index can serve, so twenty of them ORed together is
    twenty full scans in one request - and layers that answered a single
    pattern in under nine seconds began timing out, then subdividing, then
    issuing eighty-five requests to cover ground one request had covered
    before. Small batches keep every individual query inside the gateway
    timeout, which is what makes subdivision rare instead of routine.
    """
    s, pats = job
    bbox = s.get("bbox") or (-180, -85, 180, 85)
    skipped = []
    rows = fetch(s["layer"], s["owner"][0], pats, bbox, log_skip=skipped)
    return s, rows, skipped


def main() -> None:
    only = set(sys.argv[1:])
    dc_sites, fab_sites = load_sites()
    print(f"{len(dc_sites):,} data-centre sites and {len(fab_sites)} fabs to check against\n")

    pats = GENERIC + DC_OWNERS + FAB_OWNERS
    fabset = set(FAB_OWNERS)
    batches = [pats[i:i + 5] for i in range(0, len(pats), 5)]
    srcs = [s for s in parcels.POINT_SOURCES
            if s.get("owner") and (not only or s["key"] in only)]

    jobs = [(s, b) for s in srcs for b in batches]
    print(f"  {len(srcs)} layers x {len(batches)} pattern batches = {len(jobs)} queries\n")
    gathered = collections.defaultdict(list)
    all_skipped = []
    with cf.ThreadPoolExecutor(max_workers=8) as pool:
        for s, rows, skipped in pool.map(scan_one, jobs):
            gathered[s["key"]] += rows
            all_skipped += [(s["key"], b, e) for b, e in skipped]

    found, rejected = [], 0
    for s in srcs:
        rows = gathered[s["key"]]
        skipped = [x for x in all_skipped if x[0] == s["key"]]
        if True:
            field = s["owner"][0]
            seen = set()
            for f in rows:
                a = f.get("attributes") or {}
                g = f.get("geometry") or {}
                own = (a.get(field) or "").strip()
                c = centroid(g)
                if not own or not c:
                    continue
                if not word_ok(own, pats):
                    rejected += 1
                    continue
                lon, lat = c
                k = (own, round(lat, 5), round(lon, 5))
                if k in seen:
                    continue
                seen.add(k)
                # Which layer this parcel should be judged against depends on
                # what its owner is, not on where it happens to sit.
                is_fab = any(fp in own.upper() for fp in fabset)
                ref = fab_sites if (is_fab and fab_sites) else dc_sites
                near = min(ref, key=lambda x: km(lat, lon, x[0], x[1]))
                found.append({
                    "source": s["key"], "region": s.get("region", ""), "owner": own,
                    "kind": "fab" if is_fab else "datacentre",
                    "lat": round(lat, 6), "lon": round(lon, 6),
                    "acres": round(ring_area_m2(g) / 4046.86, 1),
                    "nearest_km": round(km(lat, lon, near[0], near[1]), 2),
                    "nearest": near[2], "nearest_id": near[3],
                })
            all_skipped += [(s["key"], b, e) for b, e in skipped]
            print(f"  {s['key']:10s} {len(rows):5d} rows -> {len(seen):4d} parcels"
                  f"{f'   [{len(skipped)} envelopes unreadable]' if skipped else ''}")

    found.sort(key=lambda r: -r["nearest_km"])
    OUT.write_text(json.dumps(found, indent=1, ensure_ascii=False) + "\n")
    band = collections.Counter(
        ">10km" if r["nearest_km"] > 10 else "2-10km" if r["nearest_km"] > 2
        else "0.5-2km" if r["nearest_km"] > 0.5 else "<0.5km" for r in found)
    kinds = collections.Counter(r["kind"] for r in found)
    print(f"\n{len(found)} owner-matched parcels ({dict(kinds)})")
    print(f"  {rejected} rejected as substring false positives (BOSCHMA, etc.)")
    print(f"  distance to the nearest KNOWN thing of its own kind: {dict(band)}")
    print(f"  wrote {OUT.relative_to(ROOT)}")
    # NO SILENT CAPS. Ground this pass could not read is named, because an
    # unreadable envelope and an empty one look identical in the output.
    if all_skipped:
        by = collections.Counter(k for k, _, _ in all_skipped)
        print(f"  UNREAD ground (reported, not dropped): {dict(by)}")


if __name__ == "__main__":
    main()
