"""Build the PowerDependency ledger: who depends on which piece of grid.

Sources, in descending order of what they prove:

  1. data/nyiso_load_projects.csv - filed load interconnection requests that
     NAME a substation. The only per-project public source of its kind in the
     US (see src/nyiso_loads.py for why). Evidence class: interconnection
     queue, read here as `interconnection_agreement` only where the queue
     records an executed IA, and `iso_planning` otherwise - a request is not
     an agreement.
  2. data/dc_plant_links.json - the hand-researched generator pairings. These
     become dependency edges whose relationship carries the structure that
     was researched: behind-the-meter and net-metered are physical, a PPA is
     explicitly not.

What this script deliberately does NOT do: invent a nearest-substation edge
for every asset. Proximity is in the evidence vocabulary because someone will
eventually want it, but a graph seeded with 6,000 guesses would drown the
forty things that are actually known, and every accumulation number computed
off it would be fiction. Edges here come from documents.

Nodes minted:
  sub-<slug>   a substation named by a filing. Geometry is NOT invented; a
               substation gets coordinates only when something places it.
  load-<slug>  a filed load that is not (yet) a registry asset.
"""

from __future__ import annotations

import csv
import json
import pathlib
import re
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

NYISO = DATA / "nyiso_load_projects.csv"
# A person saying which registry campus a filed load IS. The automatic matcher
# (match_asset) is deliberately conservative - name tokens corroborated by
# county - and leaves most of the queue as anonymous load-nyiso-* nodes; this
# ledger is where researched, vouched identities go, and it always wins.
# Columns: queue, asset_id (site-… or f…), note (how you know, with a URL),
# added. Append-only, like every hand ledger here.
LOAD_LINKS = DATA / "load_site_links.csv"
TEAC = DATA / "teac_needs.csv"
LINKS = DATA / "dc_plant_links.json"
SITES = DATA / "facilities_sites.csv"
FABS = DATA / "fabs.json"

OUT_DEPS = DATA / "power_dependencies.json"
OVERRIDES = DATA / "dependency_overrides.csv"
OUT_SUBS = DATA / "substations.json"

# NYISO zone -> the state it sits in. Every load project in this queue is in
# New York (two rows carry Pennsylvania counties under a NYSEG territory,
# which is a data-entry artefact, not a second state's queue).
NY_BBOX = (40.4, 45.1, -80.0, -71.8)          # s, n, w, e


# Words that describe what a thing IS rather than which one it is. Stripping
# them before comparing is what lets "Oak St" and "Oak Street" - and "Clay"
# and "Clay Station" - be recognised as one substation.
_NOISE = re.compile(r"\b(substation|switching\s*station|station|sub|switchyard|"
                    r"terminal|tap|transmission|delivery|point|yard|feeder|existing)\b", re.I)
_ST = re.compile(r"\bst\b", re.I)


def canon_key(name: str) -> str:
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    s = _NOISE.sub(" ", s)
    s = _ST.sub("street", s)                      # "Oak St" == "Oak Street"
    s = re.sub(r"\b\d{2,3}\s*kv\b", " ", s, flags=re.I)
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()
    return re.sub(r"-{2,}", "-", s)


# Variant spellings seen in this corpus, mapped by hand rather than by fuzzy
# matching. An edit-distance rule would also merge genuinely different
# stations that happen to look alike, and the cost of that error - moving a
# gigawatt onto the wrong substation - is far higher than the cost of leaving
# a duplicate visible. Each entry here is a judgement someone can check.
ALIASES = {
    "adirondak": "adirondack",          # misspelt in the queue's own cell
    "moses-massena": "moses",           # NYPA's Moses station, at Massena NY
    "kintigh-niagara": "kintigh",       # one end wearing two names, not two ends
    # Both name the Packard end of a line: Beck-Packard is the Sir Adam Beck
    # (Ontario) to Packard (Niagara Falls NY) tie, Niagara-Packard 77 is the
    # line from the Niagara switchyard. Three nodes for one yard split the
    # Niagara Falls load three ways; vouched 2026-09-10 (both resolved to
    # OSM way/147381638, which is where sub-packard already stands).
    "beck-packard": "packard",
    "niagara-packard": "packard",
    "maplewood-menands": "menands",     # the Maplewood-Menands line's far end
}


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()
    return re.sub(r"-{2,}", "-", s)


def norm_name(s: str) -> str:
    """Loose comparison key: lowercase alphanumerics, corporate noise gone."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(llc|inc|corp|corporation|company|co|lp|ltd|holdings?|"
               r"properties|infrastructure|data\s*center[s]?|datacenter[s]?|"
               r"project|campus|site|the)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def tokens(s: str) -> set[str]:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    stop = {"llc", "inc", "corp", "corporation", "company", "co", "lp", "ltd",
            "the", "of", "and", "data", "center", "centre", "datacenter",
            "project", "campus", "site", "holdings", "holding", "new", "york",
            "properties", "infrastructure", "ii", "iii", "1", "2", "3"}
    return {t for t in re.split(r"[^a-z0-9]+", s) if len(t) > 2 and t not in stop}


# ---- registry ---------------------------------------------------------------

def load_registry() -> tuple[list[dict], list[dict]]:
    sites = []
    with SITES.open() as fh:
        for r in csv.DictReader(fh):
            if not r.get("lat") or not r.get("lon"):
                continue
            try:
                lat, lon = float(r["lat"]), float(r["lon"])
            except ValueError:
                continue
            sites.append({"id": r["site_id"], "name": r.get("name") or r.get("epoch_name") or "",
                          "operator": r.get("operator") or "", "city": r.get("city") or "",
                          "lat": lat, "lon": lon})
    fabs = [{"id": f["id"], "name": f.get("n") or "", "operator": f.get("op") or "",
             "city": f.get("pl") or "", "lat": f.get("lat"), "lon": f.get("lon")}
            for f in json.loads(FABS.read_text())
            if f.get("lat") is not None]
    return sites, fabs


def in_ny(a: dict) -> bool:
    s, n, w, e = NY_BBOX
    return a["lat"] is not None and s < a["lat"] < n and w < a["lon"] < e


def match_asset(proj: dict, candidates: list[dict]) -> tuple[str | None, str]:
    """Match one NYISO project to a registry asset. Conservative on purpose:
    a wrong match attributes someone else's 1,900 MW to the wrong campus.

    Names alone are weak here - "Micron Fab 2" and "Clay Megafab Fab 1" are
    the same complex under two naming conventions, while "Data Center 1" and
    "Data Center 1" could be two thousand miles apart. So a name-token match
    is only accepted when the FILING'S COUNTY also lands on the asset. The
    queue's county column is the corroborator that makes the join safe."""
    pt = tokens(proj["project"]) | tokens(proj["developer"])
    if not pt:
        return None, ""
    pn = norm_name(proj["project"])
    dn = norm_name(proj["developer"])
    county = re.sub(r"[^a-z]", "", (proj.get("county") or "").lower())

    best, best_score, basis = None, 0.0, ""
    for c in candidates:
        cn = norm_name(c["name"])
        co = norm_name(c["operator"])
        ct = tokens(c["name"]) | tokens(c["operator"])
        if not ct:
            continue
        place = re.sub(r"[^a-z]", "", (c["city"] or "").lower())
        county_hit = bool(county) and len(county) > 3 and county in place

        score, why = 0.0, ""
        # A whole normalised name containing the other stands on its own.
        if cn and pn and (cn in pn or pn in cn) and min(len(cn), len(pn)) >= 6:
            score, why = 0.9, "name"
        elif co and dn and (co in dn or dn in co) and min(len(co), len(dn)) >= 6:
            score, why = 0.82, "operator"
        else:
            shared = pt & ct
            if shared:
                # Overlap coefficient, not Jaccard: a long descriptive registry
                # name should not dilute a real operator match.
                ov = len(shared) / min(len(pt), len(ct))
                if ov >= 0.5 and county_hit:
                    score = 0.55 + 0.35 * ov
                    why = "tokens:" + "+".join(sorted(shared))
        # The county lands on the asset: worth the same small boost whichever
        # signal found the candidate. (It used to be given only to the name
        # and operator branches - backwards, since the token branch is the one
        # that leans on geography to be safe at all.)
        if score and county_hit and "county" not in why:
            score += 0.05
            why += "+county"
        if score > best_score:
            best, best_score, basis = c, score, why
    if best_score >= 0.75:
        return best["id"], basis
    return None, ""


# ---- the ledger -------------------------------------------------------------

def main() -> None:
    sites, fabs = load_registry()
    ny_assets = [a for a in sites + fabs if in_ny(a)]
    print(f"registry: {len(sites)} sites, {len(fabs)} fabs · {len(ny_assets)} inside the NY bbox")

    subs: dict[str, dict] = {}
    deps: list[dict] = []

    def sub_id(name: str, kv: str, county: str = "") -> str:
        """One node per SUBSTATION, not per substation-and-voltage.

        Voltage is an attribute of a bus, not an identity: a station with a
        345 kV and a 115 kV yard is one station, one switchyard, one fire.
        Keying the id on name+kV split Clay into three nodes and Packard into
        two, which quietly divided their load across separate rows and made
        the accumulation numbers smaller than the truth - the single worst
        failure mode available to this layer."""
        canon = ALIASES.get(canon_key(name), canon_key(name))
        s = "sub-" + (canon or slug(name))
        rec = subs.setdefault(s, {"id": s, "name": name, "kv": None, "kvs": [],
                                  "aka": [], "spellings": {}, "country": "US",
                                  "region": "NY", "sources": [], "counties": []})
        rec["spellings"][name] = rec["spellings"].get(name, 0) + 1
        # The county its filings put it in. Already used to CHECK an OSM match;
        # kept on the record too, because for a substation no match ever found
        # it is the only thing that says where to start looking.
        if county and county not in rec["counties"]:
            rec["counties"].append(county)
        if kv:
            k = int(kv)
            if k not in rec["kvs"]:
                rec["kvs"].append(k)
            # The headline voltage is the highest yard the filings mention.
            rec["kv"] = max(rec["kvs"])
        # Display the spelling the filings use MOST, breaking ties on the
        # longest. Preferring the shortest looked tidier and picked
        # "Adirondak" over "Adirondack" and "Oak St" over "Oak Street" - the
        # typo and the abbreviation both win a shortness contest. Every other
        # spelling is kept in `aka` so a reader can find the filing's words.
        # A spelling that ALIASES declares to be a variant loses to one that
        # does not, however often the filings repeat it - "Adirondak" is more
        # common in this queue than "Adirondack" and is still a typo. Only
        # among equally-canonical spellings does frequency, then length,
        # decide.
        # Order of preference: not a declared variant spelling; free of
        # descriptor words ("Adirondack" over "Adirondack transmission");
        # then the more common spelling; then the longer, which is what makes
        # "Oak Street" beat "Oak St".
        best = max(rec["spellings"].items(),
                   key=lambda kv: (canon_key(kv[0]) not in ALIASES,
                                   not _NOISE.search(kv[0]), kv[1], len(kv[0])))[0]
        rec["name"] = best
        rec["aka"] = sorted(n for n in rec["spellings"] if n != best)
        return s

    # ---- 1. NYISO filed loads ----------------------------------------------
    matched = unmatched = 0
    with NYISO.open() as fh:
        projects = list(csv.DictReader(fh))
    vouched: dict[str, dict] = {}
    if LOAD_LINKS.exists():
        known = {a["id"] for a in sites + fabs}
        for r in csv.DictReader(LOAD_LINKS.open()):
            if r["asset_id"] not in known:
                raise SystemExit(f"load_site_links.csv: {r['asset_id']} is not a registry asset")
            vouched[r["queue"]] = r
    for p in projects:
        names = [n for n in p["poi_names"].split(" | ") if n]
        if not names:
            continue
        kvs = p["poi_kv"].split(" | ")
        if p["queue"] in vouched:
            asset_id, basis = vouched[p["queue"]]["asset_id"], "vouched"
        else:
            asset_id, basis = match_asset(p, ny_assets)
        if asset_id:
            matched += 1
        else:
            unmatched += 1
            asset_id = "load-nyiso-" + slug(p["queue"] or p["project"])[:40]
        try:
            mw = float(p["mw"]) if p["mw"] else None
        except ValueError:
            mw = None
        # A queue POI that lists several ends does not tell us which one the
        # load sits behind; relationship stays primary_feed but the note says
        # the reading is a list, and confidence drops a class.
        listed = p["poi_shape"] == "listed"
        for i, nm in enumerate(names):
            kv = kvs[i] if i < len(kvs) else ""
            sid = sub_id(nm, kv, (p.get("county") or "").strip())
            subs[sid]["sources"].append(p["queue"])
            e = {
                "asset_id": asset_id,
                "dependency_asset_id": sid,
                "dependency_type": "electricity",
                "relationship": "secondary_feed" if (i and not listed) else "primary_feed",
                "evidence": "iso_planning",
                "url": "https://www.nyiso.com/interconnections",
                "note": (f"NYISO load interconnection queue {p['queue']}: "
                         f"{p['project'] or p['developer']}"
                         + (f", {mw:,.0f} MW" if mw else "")
                         + f", point of interconnection \"{p['poi_raw']}\""
                         + (". The queue cell lists several points; which one carries "
                            "the load is not stated." if listed else "")),
                "mw": mw,
                "source": "nyiso_queue",
                # The FILING this edge came from. Needed because one filing can
                # name several points of interconnection, and its megawatts
                # belong to the filing, not to each point: without this key an
                # exposure that spans two of those points counts the load twice.
                "src_ref": p["queue"],
                "backup_power": "unknown",
            }
            if listed:
                e["confidence"] = 0.60
                e["confidence_note"] = ("the filing names this substation but lists "
                                        "several points of interconnection, so the "
                                        "serving one is not established")
            # NYISO's "Project Status #" legend: 0 is Withdrawn. A withdrawn
            # filing stays on the graph as history - the edge existed and the
            # ledger should say so - but it is MARKED, and every accumulation
            # number excludes it. Seventeen of these carried 2,979 MW as live
            # load while the status column was being swallowed by a blank
            # neighbour (see nyiso_loads.py's cell regex).
            if str(p.get("status") or "").strip() == "0":
                e["withdrawn"] = True
            if asset_id.startswith("load-"):
                e["load"] = {"name": p["project"] or p["developer"],
                             "developer": p["developer"], "county": p["county"],
                             "zone": p["zone"], "status": p["status"],
                             "end_use": p["end_use"], "reading": p["end_use_reading"],
                             "registry": False}
            elif basis:
                e["match_basis"] = basis
            deps.append(e)
    print(f"nyiso: {len(projects)} projects · {matched} matched to registry assets, "
          f"{unmatched} kept as filed loads")

    # ---- 1b. PJM TEAC: Dominion's supplemental-project filings ---------------
    # The second per-project source, and the one that puts Virginia on the map:
    # Loudoun, Prince William and Henrico are the densest data-centre ground in
    # the world and NYISO obviously says nothing about them. A Dominion need is
    # a delivery-point request - "DEV Distribution has submitted a DP Request to
    # serve a data center in X County" - so unlike a NYISO row it names no
    # campus. The load is real and filed; the customer is not disclosed. It
    # therefore lands as an anonymous filed load, the same shape the announced
    # NYISO entries take.
    #
    # Ids carry a -va- segment. There is no collision with the NYISO set today
    # (checked: zero overlapping slugs), but "Hopewell", "Clay" and "Liberty"
    # are the kind of names two states both use, and a silent merge of a
    # Virginia substation into a New York one would be invisible and wrong.
    # The existing NY ids stay unprefixed: they are referenced by pulled parcel
    # caches and saved footprints, and renaming them to match would orphan
    # those to buy symmetry.
    n_teac = 0
    if TEAC.exists():
        with TEAC.open() as fh:
            for r in csv.DictReader(fh):
                if r.get("is_data_center") != "yes":
                    continue
                names = [n.strip() for n in (r.get("substations") or "").split(" | ") if n.strip()]
                if not names:
                    continue
                try:
                    mw = float(r["mw_current"]) if r.get("mw_current") else None
                except ValueError:
                    mw = None
                need = r["need_number"]
                asset = "load-teac-" + slug(need)
                # A need that names ONE substation says where the load lands. A
                # need that names five is describing a scope of work, and which
                # of them serves the load is not stated - same problem as a
                # NYISO cell listing several points, and it takes the same
                # confidence haircut rather than a confident guess.
                listed = len(names) > 1
                for nm in names:
                    sid = "sub-va-" + slug(nm)
                    rec = subs.setdefault(sid, {
                        "id": sid, "name": nm, "kv": None, "kvs": [], "aka": [],
                        "spellings": {}, "country": "US", "region": "VA",
                        "sources": [], "counties": []})
                    rec["spellings"][nm] = rec["spellings"].get(nm, 0) + 1
                    _c = (r.get("county") or "").strip()
                    if _c and _c not in rec["counties"]:
                        rec["counties"].append(_c)
                    rec["name"] = max(rec["spellings"].items(),
                                      key=lambda kv: (kv[1], len(kv[0])))[0]
                    rec["sources"].append(need)
                    e = {
                        "asset_id": asset,
                        "dependency_asset_id": sid,
                        "dependency_type": "electricity",
                        "relationship": "primary_feed",
                        "evidence": "iso_planning",
                        "url": "https://www.pjm.com/committees-and-groups/committees/teac",
                        "note": (f"PJM TEAC Dominion supplemental need {need}"
                                 + (f", {r['county']} County" if r.get("county") else "")
                                 + (f", {mw:,.0f} MW" if mw else "")
                                 + f", substation \"{nm}\""
                                 + (". The need names several substations; which one "
                                    "carries the load is not stated." if listed else "")),
                        "mw": mw,
                        "source": "teac",
                        "src_ref": need,
                        "backup_power": "unknown",
                        "load": {"name": f"Data centre load, {r.get('county') or 'Virginia'}"
                                         f" ({need})",
                                 "developer": r.get("requesting_entity", ""),
                                 "county": r.get("county", ""), "zone": "DOM",
                                 "status": r.get("latest_stage", ""),
                                 "end_use": "DAT", "reading": "data centre",
                                 "registry": False},
                    }
                    if listed:
                        e["confidence"] = 0.60
                        e["confidence_note"] = ("the filing names this substation but lists "
                                                "several; which serves the load is not stated")
                    deps.append(e)
                    n_teac += 1
    print(f"teac: {n_teac} edges from Dominion supplemental filings")

    # ---- 2. the researched generator pairings -------------------------------
    REL = {"btm": "behind_meter", "netmeter": "net_metered",
           "ppa": "contract", "announced": "announced"}
    n_links = 0
    for l in json.loads(LINKS.read_text()):
        asset = l.get("site_id") or l.get("fab_id") or ""
        if not asset:
            dcn = (l.get("dc") or {}).get("name") or l.get("plant_name") or ""
            if not dcn:
                continue
            asset = "load-" + slug(dcn)[:44]
        plant = l.get("plant_id") or ""
        if not plant:
            continue
        e = {
            "asset_id": asset,
            "dependency_asset_id": plant,
            "dependency_type": "electricity",
            "relationship": REL.get(l.get("structure"), "announced"),
            # These were researched from filings and trade press case by case;
            # the note carries the actual basis, so the evidence class is the
            # weakest thing that could have produced it unless the note shows
            # a docket.
            "evidence": ("regulatory_docket"
                         if re.search(r"docket|PUCT|FERC|PSC|commission", l.get("note", ""), re.I)
                         else "press_report"),
            "url": l.get("url", ""),
            "note": l.get("note", ""),
            "source": "dc_plant_links",
            "backup_power": "unknown",
        }
        if (l.get("dc") or {}).get("corp"):
            # A corporate-wide offtake has no single load to pin.
            e["relationship"] = "contract"
            e["note"] = "Corporate-wide offtake — no single load to pin. " + e["note"]
        if not e["url"] and not e["note"]:
            continue
        deps.append(e)
        n_links += 1
    print(f"dc_plant_links: {n_links} edges")

    # Substations keep the queue positions that named them - the provenance a
    # reader needs to check any cluster this graph reports.
    def county_canon(c: str) -> str:
        """'St. Lawrence' and 'St Lawrence' are one county, not two.

        The queue spells it both ways and keeping both would render as two
        counties disagreeing about where a substation is - a conflict invented
        entirely by a full stop."""
        c = re.sub(r"\bSt\.?\s+", "St ", c.strip(), flags=re.I)
        c = re.sub(r"\s+County$", "", re.sub(r"\s+", " ", c), flags=re.I)
        return c.title()

    for s in subs.values():
        s["sources"] = sorted({x for x in s["sources"] if x})
        s["named_by"] = len(s["sources"])
        s["counties"] = sorted({county_canon(c) for c in s.get("counties", []) if c.strip()})
        s.pop("spellings", None)     # working state, not part of the record

    # Carry forward whatever src/substation_geo.py established. This file is
    # regenerated from the filings on every run, and the geocoding lives in it
    # rather than beside it - so writing it blind un-places every substation
    # that a county-checked OSM match had located, silently, and the map goes
    # empty for reasons nothing reports. Rebuild the names, keep the ground.
    GEO_KEYS = ("lat", "lon", "osm", "osm_name", "osm_county", "located",
                "geo_rejected", "kv_note", "operator", "placed_by"
)
    if OUT_SUBS.exists():
        try:
            prev = {s["id"]: s for s in json.loads(OUT_SUBS.read_text())}
        except Exception:  # noqa: BLE001
            prev = {}
        kept = 0
        for sid, rec in subs.items():
            old_rec = prev.get(sid)
            if not old_rec:
                continue
            for k in GEO_KEYS:
                if k in old_rec and k not in rec:
                    rec[k] = old_rec[k]
            if rec.get("located"):
                kept += 1
        if kept:
            print(f"kept geocoding for {kept} substation(s) from the previous build")

    # ---- hand-vouched edge facts -----------------------------------------
    # data/dependency_overrides.csv is an append-only SOURCE with the same
    # contract as site_overrides.csv: a person read the evidence and stands
    # behind the value, the note says on what basis, and this rebuild folds
    # the latest write per (edge, field) over the derived edge. The research
    # pipeline never writes here - findings live under data/review/ until a
    # person vouches.
    ALLOWED = {
        "backup_power": lambda v: v in ("yes", "no", "partial", "unknown"),
        "backup_hours": lambda v: v.replace(".", "", 1).isdigit(),
        # a dependency id names the redundant path (the same substation is a
        # legal and meaningful answer: it says the two feeds SHARE it);
        # 'none' records researched absence, which is the fact that turns
        # "exposed" into "lost" on the event pages.
        "secondary_feed": lambda v: v == "none" or re.match(r"^(sub|corr)-[a-z0-9][\w.-]{0,60}$", v),
    }
    if OVERRIDES.exists():
        # ALL edges wearing the pair, not the last one keyed: a fab whose two
        # queue phases each hold an edge to the same substation is one campus,
        # and a fact about the campus belongs on every edge it stands behind.
        by_edge: dict = {}
        for e in deps:
            by_edge.setdefault((e["asset_id"], e["dependency_asset_id"]), []).append(e)
        # A row names the FILING's node as it stood when written. The queue
        # number is the stable identity: once a filing is vouched onto a
        # registry site its edges wear the site's id, and the row must follow
        # rather than orphan - nineteen vouched facts fell off the graph the
        # day thirteen campuses were promoted. Likewise a substation that
        # merged into another (Beck-Packard -> Packard) resolves to the node
        # its edges now carry.
        load_now = {}
        for e in deps:
            if e.get("src_ref") and e.get("source") == "nyiso_queue":
                load_now["load-nyiso-" + slug(e["src_ref"])[:40]] = e["asset_id"]
        def dep_now(d: str) -> str:
            key = d[4:] if d.startswith("sub-") else d
            return ("sub-" + ALIASES[key]) if d.startswith("sub-") and key in ALIASES else d
        n_ovr, orphans = 0, []
        for r in csv.DictReader(OVERRIDES.open()):
            a = load_now.get(r["asset_id"], r["asset_id"])
            d = dep_now(r["dependency_asset_id"])
            targets = by_edge.get((a, d))
            f, v = r["field"], r["value"]
            if not targets:
                orphans.append(f'{r["asset_id"]}->{r["dependency_asset_id"]}')
                continue
            if f not in ALLOWED or not ALLOWED[f](v):
                raise SystemExit(f"dependency_overrides.csv: bad {f}={v!r}")
            for e in targets:
                e[f] = float(v) if f == "backup_hours" else v
                if r.get("note"):
                    e.setdefault("override_notes", []).append(r["note"])
            n_ovr += 1
        print(f"dependency overrides: {n_ovr} field(s) applied"
              + (f", {len(orphans)} orphaned: {orphans}" if orphans else ""))

    OUT_SUBS.write_text(json.dumps(sorted(subs.values(), key=lambda s: s["id"]),
                                   indent=1) + "\n")
    OUT_DEPS.write_text(json.dumps(deps, indent=1) + "\n")
    print(f"\nwrote {OUT_SUBS.relative_to(ROOT)}  ({len(subs)} substations)")
    print(f"wrote {OUT_DEPS.relative_to(ROOT)}  ({len(deps)} dependency edges)")

    # ---- what the graph is for ---------------------------------------------
    by_dep: dict[str, list[dict]] = {}
    for e in deps:
        if e["relationship"] in {"contract", "announced"}:
            continue                      # not physical: carries no outage correlation
        by_dep.setdefault(e["dependency_asset_id"], []).append(e)
    # Two different concentrations, and both are underwriting facts: several
    # assets behind one substation, and a lot of megawatts behind one
    # substation. A single 1 GW campus on one bus is not "unshared risk".
    rows = []
    for k, v in by_dep.items():
        assets = {e["asset_id"] for e in v}
        rows.append({
            "id": k, "name": subs[k]["name"] if k in subs else k,
            "assets": len(assets), "mw": sum(e.get("mw") or 0 for e in v),
            "registry": sum(1 for a in assets if not a.startswith("load-")),
        })
    multi = [r for r in rows if r["assets"] > 1]
    print(f"\nphysical dependency points: {len(rows)} · carrying more than one asset: {len(multi)}")
    print(f"{'dependency':<30}{'assets':>7}{'in reg':>7}{'MW':>10}")
    for r in sorted(rows, key=lambda r: (-r["assets"], -r["mw"]))[:14]:
        print(f"  {r['name']:<28}{r['assets']:>7}{r['registry']:>7}{r['mw']:>10,.0f}")


if __name__ == "__main__":
    main()
