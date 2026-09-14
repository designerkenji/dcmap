"""Identity evidence for the dots, from Precisely's business registry.

    python3 poi_precisely.py                     # verify: unverified sites first
    python3 poi_precisely.py --budget 100
    python3 poi_precisely.py --discover -97.6,32.5,-96.4,33.2   # a region sweep

TWO DIFFERENT PRODUCTS, DELIBERATELY KEPT APART FROM THE PARCEL WORK. A
parcel says where a site ENDS; this says what a site IS. places/poi_world
classifies every registered business by SIC and ties it to an address point,
which cuts both ways:

  VERIFY    For a dot we already have, a business at that address classified
            "DATA PROCESSING" or "ELECTRIC SERVICES" is independent evidence
            the dot is what the registry claims. The 654 needs_review sites -
            PeeringDB listings with no networks, where a sample found gravel
            pits and revoked ISPs - are exactly the dots that need this, so
            they are asked first.

  DISCOVER  A business so classified where the registry has NO dot is a
            candidate site. CANDIDATE, with parcel_discover.py's whole
            philosophy attached: SIC lumps a hyperscale campus with a
            five-person IT consultancy, an address point is not a facility,
            and nothing here writes to the registry. Output is a worklist
            for a research pass, each entry flagged with whether a known dot
            already sits within 400 m of it.

Every verify answer is cached per site (empty answers too - "no business
registered here" is itself evidence about an unverified listing). The
aggregate lands in data/raw/poi_evidence.json for the site pages to show, and
discovery candidates in data/raw/poi_candidates.json. Each items request spends
one trial credit; both modes take --budget and stop cleanly.
"""

from __future__ import annotations

import csv
import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request

import parcels_precisely as pp

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CACHE = RAW / "poi_verify_cache"
# Under raw/ (gitignored) like the vendor parcels: these are extracts of
# licensed trial data, and the repo must stay publishable without them.
EVIDENCE = RAW / "poi_evidence.json"
CANDIDATES = RAW / "poi_candidates.json"
POI = ("https://api.cloud.precisely.com/v1/ogcapi/enrich"
       "/collections/places/poi_world/items")
UA = {"User-Agent": "reinsurance_dc-research/1.0"}

# What counts as which kind of facility, in SIC-description terms. Written
# down rather than inlined so the inevitable argument about a pattern has a
# single place to happen. DATA is deliberately narrower than LIKE '%DATA%' -
# that matched a video-wiring contractor in the first live test.
DC_PAT = re.compile(r"DATA PROCESSING|DATA STORAGE|COMPUTER.*(RENTAL|FACILIT)"
                    r"|HOSTING|COLOCATION|INTERNET SERVICE", re.I)
PLANT_PAT = re.compile(r"ELECTRIC SERVICES|ELECTRIC POWER|POWER GENERATION"
                       r"|COGENERATION", re.I)


def classify(props: dict) -> str:
    # Only the two most specific fields. The broader ones (main_class,
    # group_name) classified a computer-repair shop as a data centre in the
    # first live batch - category labels are too coarse to be evidence. And
    # a consultant SIC (73790202 DATA PROCESSING CONSULTANT) is advice about
    # facilities, not a facility.
    hay = " ".join(str(props.get(k) or "") for k in
                   ("sic8_description", "business_line"))
    if "CONSULT" in hay.upper():
        return ""
    if DC_PAT.search(hay):
        return "dc"
    if PLANT_PAT.search(hay):
        return "plant"
    return ""


# Words too generic to link a POI name to an operator name on their own -
# including legal-form suffixes, which linked a German wind fund to a hosting
# firm on the strength of GMBH in the first live batch.
STOP = {"DATA", "CENTER", "CENTRE", "TECH", "TECNOLOGIA", "SERVICES",
        "SERVICOS", "SERVICIOS", "SISTEMAS", "INFORMATICA", "GROUP", "GRUPO",
        "CLOUD", "GLOBAL", "DIGITAL", "SYSTEMS", "SOLUTIONS", "NETWORK",
        "NETWORKS", "INTERNET", "TELECOM", "BRASIL", "BRAZIL", "COMPANY",
        "CORP", "INC", "LLC", "GMBH", "LTDA", "HOLDING", "HOLDINGS"}
NAME_PAT = re.compile(r"DATA ?CENT|COLOCATION|\bCOLO\b|HOSTING", re.I)


def tier_of(rec: dict, op_names: str, place: str = "") -> str:
    """How much a classified POI actually proves.

    SIC 7374 covers both a hyperscale campus and a two-person data-entry
    bureau, so the class alone is only ever WEAK. It is STRONG when the
    business NAME says facility (contains DATA CENTER / COLO / HOSTING) or
    matches the operator the registry already names for this site - then the
    commercial registry is confirming the specific claim, not the genre.
    The site's own place names are excluded from the match: an accountancy
    called "... Bologna" does not corroborate a site named "... Bologna" -
    they merely share a city.
    """
    name = (rec.get("name") or "").upper()
    if NAME_PAT.search(name) or NAME_PAT.search((rec.get("parent") or "").upper()):
        return "strong"
    placetoks = set(re.split(r"[^A-Z0-9]+", place.upper()))
    ops = {t for t in re.split(r"[^A-Z0-9]+", op_names.upper())
           if len(t) >= 4 and t not in STOP and t not in placetoks}
    if ops & {t for t in re.split(r"[^A-Z0-9]+", name) if len(t) >= 4}:
        return "strong"
    return "weak"


def poi_query(tok: str, params: dict, timeout: int = 60) -> dict:
    u = f"{POI}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(u, headers={**UA, "Authorization": f"Bearer {tok}"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())


# ---- verify -----------------------------------------------------------------

def verify_targets() -> list[dict]:
    """Unverified sites first, then the rest - all exact-located."""
    first, rest = [], []
    with (ROOT / "data" / "facilities_sites.csv").open(encoding="utf-8") as fh:
        for s in csv.DictReader(fh):
            if not s.get("lat") or (s.get("geo_precision") or "exact") != "exact":
                continue
            t = {"sid": s["site_id"], "lat": float(s["lat"]), "lon": float(s["lon"])}
            (first if s.get("needs_review") else rest).append(t)
    return first + rest


def verify(tok: str, budget: int) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = {p.stem for p in CACHE.glob("*.json")}
    targets = verify_targets()
    todo = [t for t in targets if t["sid"] not in cached]
    print(f"{len(targets)} sites ({len(todo)} unasked), budget {budget} requests")
    asked = found = errs = 0
    d = 0.0012                     # ~130 m: the address point of THIS building
    for t in todo:
        if asked >= budget:
            print(f"  budget reached; rerun to continue")
            break
        try:
            out = poi_query(tok, {"bbox": f"{t['lon']-d},{t['lat']-d},"
                                          f"{t['lon']+d},{t['lat']+d}", "limit": "10"})
        except Exception as e:  # noqa: BLE001
            errs += 1
            print(f"  {t['sid']}: {e}")
            if errs >= 5:
                print("  five straight failures - stopping")
                break
            continue
        errs = 0
        asked += 1
        best = {}
        for f in out.get("features") or []:
            p = f.get("properties") or {}
            kind = classify(p)
            # Only the MATCHING kind corroborates: an electric-power company
            # at a data-centre dot proves nothing about the data centre.
            # (These targets are all DC sites; a plant verify pass would
            # demand "plant" here.)
            if kind == "dc" and not best:
                best = {"kind": kind, "name": p.get("name") or "",
                        "cls": p.get("sic8_description") or p.get("business_line") or "",
                        "addr": p.get("main_address_line") or "",
                        "parent": p.get("global_ultimate_business_name")
                                  or p.get("parent_business_name") or ""}
        (CACHE / f"{t['sid']}.json").write_text(json.dumps(best))
        if best:
            found += 1
        time.sleep(0.25)
    write_evidence()
    print(f"asked {asked}, corroborated {found}")


def write_evidence() -> None:
    # Empty records are kept: "we asked, and no such business is registered
    # here" is the finding that matters most on a needs_review site. Cached
    # hits are RE-validated against today's classify() - the cache stores what
    # the registry said, this function decides what it proves, so a tightened
    # pattern demotes old false hits without re-spending their requests.
    ops = {}
    with (ROOT / "data" / "facilities_sites.csv").open(encoding="utf-8") as fh:
        for s in csv.DictReader(fh):
            ops[s["site_id"]] = (f"{s.get('operator') or ''} {s.get('name') or ''}",
                                 f"{s.get('city') or ''} {s.get('country') or ''}")
    out, strong = {}, 0
    for p in sorted(CACHE.glob("*.json")):
        rec = json.loads(p.read_text())
        if rec and (not DC_PAT.search(rec.get("cls") or "")
                    or "CONSULT" in (rec.get("cls") or "").upper()):
            rec = {}    # wrong kind for a site, or a field we no longer trust
        if rec and p.stem.startswith("site-") and rec.get("kind") != "dc":
            rec = {}
        if rec:
            rec["tier"] = tier_of(rec, *ops.get(p.stem, ("", "")))
            strong += rec["tier"] == "strong"
        out[p.stem] = rec
    hits = sum(1 for v in out.values() if v)
    EVIDENCE.write_text(json.dumps(out, indent=1))
    print(f"wrote {EVIDENCE.relative_to(ROOT)}: {len(out)} sites asked, "
          f"{hits} corroborated ({strong} strong)")


# ---- discover ---------------------------------------------------------------

def known_points() -> list[tuple[float, float]]:
    pts = []
    with (ROOT / "data" / "facilities_sites.csv").open(encoding="utf-8") as fh:
        for s in csv.DictReader(fh):
            if s.get("lat"):
                pts.append((float(s["lon"]), float(s["lat"])))
    for pl in json.loads((ROOT / "data" / "power_plants.json").read_text()):
        pts.append((pl["lon"], pl["lat"]))
    return pts


def discover(tok: str, region: str, budget: int) -> None:
    w, s_, e, n = (float(x) for x in region.split(","))
    known = known_points()
    grid: dict[tuple, list] = {}
    for lon, lat in known:
        grid.setdefault((round(lon, 1), round(lat, 1)), []).append((lon, lat))

    def near_known(lon: float, lat: float, m: float = 400) -> bool:
        import math
        for dx in (-0.1, 0, 0.1):
            for dy in (-0.1, 0, 0.1):
                for klon, klat in grid.get((round(lon + dx, 1), round(lat + dy, 1)), ()):
                    dxm = (lon - klon) * 111320 * math.cos(math.radians(lat))
                    if math.hypot(dxm, (lat - klat) * 111320) <= m:
                        return True
        return False

    cands, asked = [], 0
    # LIKE patterns kept close to classify()'s; each page is one credit.
    # SERVICE not bare PROCESSING: the consultant SIC would fill whole pages
    # otherwise, and a metro-scale LIKE takes ~1-2 min a page as it is
    # (hence the long timeout - a timed-out request bills nothing).
    for flt, kind in ((r"sic8_description LIKE '%DATA PROCESSING SERVICE%'", "dc"),
                      (r"sic8_description LIKE '%DATA STORAGE%'", "dc"),
                      (r"sic8_description LIKE '%HOSTING%'", "dc"),
                      (r"sic8_description LIKE '%ELECTRIC SERVICES%'", "plant")):
        offset = 0
        while asked < budget:
            # offset only when paging: DIS rejects params it does not know
            # (DIS-OAF-1015), and losing page 2 beats losing page 1.
            params = {"bbox": f"{w},{s_},{e},{n}", "limit": "100", "filter": flt}
            if offset:
                params["offset"] = str(offset)
            try:
                out = poi_query(tok, params, timeout=300)
            except Exception as ex:  # noqa: BLE001
                print(f"  {flt}: {ex}")
                break
            asked += 1
            feats = out.get("features") or []
            for f in feats:
                g = f.get("geometry") or {}
                if g.get("type") != "Point":
                    continue
                lon, lat = g["coordinates"][:2]
                p = f.get("properties") or {}
                if not classify(p):
                    continue                    # the filter is looser than we are
                name = p.get("name") or ""
                parent = (p.get("global_ultimate_business_name")
                          or p.get("parent_business_name") or "")
                cands.append({"kind": kind, "name": name,
                              "cls": p.get("sic8_description") or "",
                              "parent": parent,
                              "addr": ", ".join(str(p.get(k) or "") for k in
                                                ("main_address_line", "areaname3",
                                                 "areaname1") if p.get(k)),
                              "lon": lon, "lat": lat,
                              # The worklist ordering: a NAME that says
                              # facility outranks a bare SIC class, which in
                              # this code sweeps in every payroll bureau and
                              # home business in the metro.
                              "rank": "name" if NAME_PAT.search(f"{name} {parent}")
                                      else "class",
                              "known_nearby": near_known(lon, lat)})
            if len(feats) < 100:
                break
            offset += 100
            time.sleep(0.25)
    cands.sort(key=lambda c: (c["rank"] != "name", c["known_nearby"]))
    new = [c for c in cands if not c["known_nearby"]]
    lead = [c for c in new if c["rank"] == "name"]
    CANDIDATES.write_text(json.dumps({"region": region, "candidates": cands},
                                     indent=1))
    print(f"{asked} requests: {len(cands)} classified POIs, {len(new)} NOT near "
          f"any known dot ({len(lead)} facility-named) -> "
          f"{CANDIDATES.relative_to(ROOT)}")
    for c in lead[:20]:
        print(f"  [{c['kind']}] {c['name'][:40]:40} {c['addr'][:40]:40} "
              f"{('<- ' + c['parent']) if c['parent'] and c['parent'] != c['name'] else ''}")


def main() -> None:
    budget = 250
    if "--budget" in sys.argv:
        budget = int(sys.argv[sys.argv.index("--budget") + 1])
    k, s = pp.credentials()
    tok = pp.bearer(k, s)
    if "--discover" in sys.argv:
        region = sys.argv[sys.argv.index("--discover") + 1]
        return discover(tok, region, min(budget, 60))
    verify(tok, budget)


if __name__ == "__main__":
    main()
