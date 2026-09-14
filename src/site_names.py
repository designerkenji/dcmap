"""Compare each dot's name against the name on the footprint drawn round it.

A registry name comes from whichever source won the dedupe; a footprint name
comes from whoever mapped the building. Neither is reliably better, so this
compares them and says which - it does not assume the newer one wins.

    python3 site_names.py            # report only
    python3 site_names.py --apply    # write the safe verdicts to site_overrides.csv

WHY MOST CANDIDATES ARE NOT AN IMPROVEMENT AT ALL

3,908 footprints attach to 2,198 sites, and 885 of those pairings disagree
about the name. Almost none of them are a better name for the same building:

    Equinix DB2          vs  Digital Realty DUB3     - a different company
    Vantage VA16         vs  Amazon IAD230           - a different company
    Amazon IAD62         vs  Amazon IAD68            - the hall next door
    OpenColo             vs  five different neighbours in one Santa Clara block

footprints.py attaches a site to a shape by containment, by osm_id, or by
nearest-within-250m, and on a dense campus the last two routinely land on the
building next door. A name is not a shape: being 40 m away makes a footprint a
good outline and a terrible label. So the first job here is not comparing
names, it is deciding whether the two things are the SAME BUILDING.

THE SAME-BUILDING TEST

Only the osm_id join proves it: that registry row was BUILT from that OSM way,
which is identity, not proximity. Containment cannot be used, because a campus
contains every hall inside it and a hall contains the dot of its neighbour when
the geocoder put it a few metres off.

Even identity is not enough on its own. dedupe.py merges several OSM ways into
one site, so a site assembled from five ways carries five footprints with five
different names, and picking one is arbitrary - site "1A" would be renamed to
"1B", "2", "3" or "4" depending on file order. Those are held back too.

WHAT SURVIVES, AND THE VERDICT FOR EACH

Of 885 disagreements, 52 sites have a single, unambiguous footprint name.
Those are classified, never guessed:

    fill      the dot has no name at all and the footprint has one
    expand    the footprint says everything the dot's name says AND more
              ("Longcross Park" -> "Ark Data Centres - Longcross Park")
    shrink    the dot's name already contains the footprint's, so the dot wins
              ("Meta Los Lunas Data Center" -> "Meta" is a downgrade)
    cosmetic  same name, different case or punctuation - not worth an override
    generic   one side is a bare operator or the words "data center"; the
              specific side wins
    conflict  two different names for one building. NOT applied: this is where
              "Cologix ASH2 -> Cologix ASH1" lives, and no rule can tell a
              renamed facility from a mismapped one. Reported for a person.

Only fill, expand and generic-favouring-the-footprint are written.
"""

from __future__ import annotations

import csv
import datetime
import json
import math
import pathlib
import re
import sys
import unicodedata
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OVERRIDES = DATA / "site_overrides.csv"
QUEUE = DATA / "name_conflicts.json"
COLUMNS = ["site_id", "field", "value", "lat", "lon", "note", "edited"]

# Words that carry no identifying information on their own. A name made only of
# these plus an operator is a category, not a label.
STOP = {"data", "center", "centre", "datacenter", "datacentre", "dc", "the",
        "building", "bldg", "facility", "site", "campus", "hall", "colo",
        "colocation", "gmbh", "inc", "llc", "ltd", "sa", "bv", "ag", "corp"}


def norm(s: str) -> str:
    """Fold to comparable words: accents stripped, punctuation to spaces.

    The folding is not cosmetic. Without it "Télécom" splits into t/l/com,
    because the accented letters are not in [a-z0-9] and become separators -
    which made "Datacenter Bouygues Télécom" share no words with "Bouygues
    Telecom Montigny-le-Bretonneux" and land in `conflict`. Folded, it is the
    shorter of the two names and the registry rightly keeps its own. Names in
    scripts with no ASCII form (唐木田テクノロジービル) survive as themselves: NFKD
    leaves them alone and the category test below never fires on them.
    """
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9À-￿]+", " ", s.lower()).strip()


def tokens(s: str) -> set[str]:
    return {t for t in norm(s).split() if t}


def informative(name: str, operator: str) -> bool:
    """Does this name say anything beyond 'a data centre run by X'?"""
    return bool(tokens(name) - STOP - tokens(operator))


def load():
    sites = {r["site_id"]: r for r in csv.DictReader((DATA / "facilities_sites.csv").open())}
    # Names already corrected by hand, laid over the pipeline's own, exactly as
    # dcmap does at load time. Without this the comparison reads the file the
    # pipeline wrote, never sees the overrides THIS SCRIPT appended, and every
    # re-run re-appends the same fourteen rows - which the append-only log
    # tolerates (the last one wins) but which is noise, and which would hide a
    # later human correction behind a machine one that keeps coming back.
    if OVERRIDES.exists():
        for r in csv.DictReader(OVERRIDES.open()):
            if r.get("field") == "name" and r["site_id"] in sites:
                sites[r["site_id"]]["name"] = r["value"]
    # The identity join: which sites were assembled from which OSM elements.
    osm2site = defaultdict(set)
    for r in csv.DictReader((DATA / "facilities_global.csv").open()):
        if r.get("osm_id") and r.get("site_id"):
            osm2site[str(r["osm_id"])].add(r["site_id"])
    fps = json.loads((DATA / "footprints.geojson").read_text())["features"]
    bysite = defaultdict(list)
    for f in fps:
        for sid in f["properties"].get("sites") or []:
            bysite[sid].append(f["properties"])
    return sites, osm2site, bysite


def classify(site_name: str, fp_name: str, operator: str) -> tuple[str, str]:
    """(verdict, winning name). Verdict is one of the words in the docstring."""
    sn, fn = site_name.strip(), fp_name.strip()
    if not fn:
        return "none", sn
    if not sn:
        return "fill", fn
    ns, nf = norm(sn), norm(fn)
    if ns == nf:
        return "cosmetic", sn
    # One name says everything the other says, and more. Two refinements, both
    # load-bearing. Token SUBSET rather than substring, because "Flexential
    # Nashville - Brentwood" against "Flexential Brentwood Data Center" is a
    # reordering and no substring test sees it. And the category words are
    # dropped first: "Datacenter Bouygues Télécom" is the SHORTER of the two
    # names once "Datacenter" is set aside, so the registry's
    # "Bouygues Telecom Montigny-le-Bretonneux" keeps its place instead of
    # being scored as an unrelated name.
    ts, tf = tokens(sn) - STOP, tokens(fn) - STOP
    if ts < tf:
        return "expand", fn
    if tf < ts:
        return "shrink", sn
    si, fi = informative(sn, operator), informative(fn, operator)
    if fi and not si:
        return "generic", fn      # the dot is a category, the footprint is a name
    if si and not fi:
        return "generic", sn      # the footprint is the category - keep the dot
    return "conflict", sn


def candidates():
    sites, osm2site, bysite = load()
    out, ambiguous, nonident = [], 0, 0
    for sid, ps in bysite.items():
        s = sites.get(sid)
        if not s:
            continue
        ident = [p for p in ps
                 if str(p.get("osm_id") or "")
                 and sid in osm2site.get(str(p.get("osm_id")), ())
                 and (p.get("name") or "").strip()]
        if not ident:
            if any((p.get("name") or "").strip() != (s.get("name") or "").strip()
                   for p in ps):
                nonident += 1
            continue
        names = {(p["name"] or "").strip() for p in ident}
        if len(names) > 1:
            ambiguous += 1
            continue
        fn = names.pop()
        sn = (s.get("name") or "").strip()
        if fn == sn:
            continue
        verdict, winner = classify(sn, fn, s.get("operator") or "")
        f = ident[0]
        # How far the outline's middle is from the dot. The strongest single
        # clue a reviewer has: "Cologix ASH2" against "Cologix ASH1" is the
        # hall next door, and the metres say so where the names cannot.
        km = ""
        if s.get("lat") and f.get("bbox"):
            b = f["bbox"]
            km = round(dist_km(float(s["lon"]), float(s["lat"]),
                               (b[0] + b[2]) / 2, (b[1] + b[3]) / 2), 3)
        out.append({"site_id": sid, "site": sn, "fp": fn, "kind": f["kind"],
                    "operator": (s.get("operator") or "").strip(),
                    "fp_id": f.get("id", ""), "fp_op": (f.get("op") or "").strip(),
                    "src": f.get("src", ""), "m2": f.get("m2", 0), "km": km,
                    "city": (s.get("city") or "").strip(),
                    "country": (s.get("country") or "").strip(),
                    "verdict": verdict, "winner": winner,
                    "change": winner != sn,
                    "lat": s.get("lat", ""), "lon": s.get("lon", "")})
    return out, ambiguous, nonident


def dist_km(lon_a, lat_a, lon_b, lat_b) -> float:
    return math.hypot((lon_a - lon_b) * 111.32 * math.cos(math.radians((lat_a + lat_b) / 2)),
                      (lat_a - lat_b) * 111.32)


REVIEWS = DATA / "name_reviews.csv"


def reviewed() -> set:
    """site_ids a person has already ruled on, so the queue does not re-ask."""
    if not REVIEWS.exists():
        return set()
    with REVIEWS.open(encoding="utf-8") as fh:
        return {r["site_id"] for r in csv.DictReader(fh) if r.get("site_id")}


APPLY = {"fill", "expand", "generic"}


def main() -> None:
    rows, ambiguous, nonident = candidates()
    apply = "--apply" in sys.argv

    order = ["fill", "expand", "generic", "shrink", "cosmetic", "conflict"]
    print(f"held back: {nonident} sites whose footprint is only NEARBY (no osm_id "
          f"identity), {ambiguous} whose merged OSM ways disagree on the name")
    print(f"comparable: {len(rows)} sites with one unambiguous footprint name\n")
    for v in order:
        got = [r for r in rows if r["verdict"] == v]
        if not got:
            continue
        writes = [r for r in got if r["change"]]
        print(f"  {v:9} {len(got):3}  "
              f"{'-> ' + str(len(writes)) + ' rename(s)' if v in APPLY else 'keep the registry name'}")
    print()

    todo = [r for r in rows if r["verdict"] in APPLY and r["change"]]
    for r in todo:
        print(f"  {r['verdict']:7} {r['site'] or '(blank)':<38.38} -> {r['fp']:<44.44}")
    # The conflicts are the queue for /review/names. Written out rather than
    # recomputed in the server, because the classification is here and having
    # two implementations of "is this the same building" is how they drift.
    done = reviewed()
    review = [r for r in rows if r["verdict"] == "conflict" and r["site_id"] not in done]
    QUEUE.write_text(json.dumps(sorted(review, key=lambda r: (r["km"] == "", r["km"]))))
    if review or done:
        print(f"\n  {len(review)} conflicts for a person to settle"
              + (f", {len(done)} already reviewed" if done else "")
              + f" -> {QUEUE.relative_to(ROOT)}, reviewable at /review/names")
        for r in review[:8]:
            print(f"          {r['site']:<34.34} vs {r['fp']:<34.34}"
                  f"{('  ' + str(r['km']) + ' km') if r['km'] != '' else ''}")
        if len(review) > 8:
            print(f"          … and {len(review) - 8} more")

    if not apply:
        print(f"\n{len(todo)} would be written. Re-run with --apply to write them.")
        return
    if not todo:
        print("nothing to write")
        return
    now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    fresh = not OVERRIDES.exists()
    cell = lambda v: ('"' + v.replace('"', '""') + '"' if re.search(r'[",\n\r]', v) else v)
    lines = [",".join(COLUMNS)] if fresh else []
    for r in todo:
        lines.append(",".join(cell(str(x)) for x in [
            r["site_id"], "name", r["fp"], r["lat"], r["lon"],
            f"name from the {r['kind']} footprint ({r['verdict']})", now]))
    with OVERRIDES.open("a") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"\nwrote {len(todo)} name override(s) to {OVERRIDES.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
