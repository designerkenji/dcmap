"""Parse Dominion supplemental-project decks from PJM TEAC.

These decks are the only public source tying data center MW to a named county.
Each project slide carries a Need Number, the requesting entity, a substation,
a county and an expected load, so the deck set gives a county-level MW series
that Dominion does not otherwise publish.

Two things the format forces:
  - Item numbers change every meeting and the filename alternates between
    'dom-' and 'dominion-', so deck URLs must be discovered, not constructed.
  - Loads are revised in place across meetings. The PDF text layer flattens
    struck-through values, so '270 292 MW' means 292. We take the last value
    and keep every observation so a restatement is visible rather than silent.
"""

from __future__ import annotations

import csv
import json
import pathlib
import re
import urllib.request

import pypdf

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "raw" / "teac"
CACHE.mkdir(parents=True, exist_ok=True)
INDEX = ROOT / "data" / "raw" / "teac_decks.json"

UA = {"User-Agent": "Mozilla/5.0 (reinsurance_dc research)"}
BASE = "https://www.pjm.com/-/media/DotCom/committees-groups/committees/teac"
TEAC_PAGE = "https://www.pjm.com/committees-and-groups/committees/teac"

# Meeting dates before the current year are not listed on the committee page.
KNOWN_DATES = [
    "20250107", "20250204", "20250304", "20250401", "20250506", "20250605",
    "20250708", "20250805", "20250902", "20251008", "20251104", "20251202",
]
NAME_VARIANTS = ["dom-supplemental-projects", "dominion-supplemental-projects"]

COUNTIES = (r"Loudoun|Prince William|Fairfax|Chesterfield|Henrico|Louisa|Spotsylvania|Culpeper|"
            r"Stafford|Fauquier|Caroline|Pittsylvania|Goochland|Hanover|Powhatan|Surry|"
            r"Charles City|King George|Greensville|Mecklenburg|Halifax|Appomattox|New Kent|"
            r"James City|Isle of Wight|Sussex|Brunswick|Amelia|Cumberland|Fluvanna|Orange|"
            r"Madison|Greene|Albemarle|Augusta|Rockingham|Shenandoah|Frederick|Clarke|"
            r"Warren|Page|Prince George|Dinwiddie|Nottoway|Lunenburg|Campbell|Bedford")

RE_NEED = re.compile(r"Need Number:\s*([A-Z]{3}-\d{4}-\d{4}(?:-\w+)?)")
RE_STAGE = re.compile(r"Process Stage:\s*([A-Za-z ]+?)(?:\s*\d|\s*Previously|\s*Project)")
RE_DRIVER = re.compile(r"Project Driver:\s*([A-Za-z \-–]+?)(?:\s*Specific|\s*Proposed|\s*$)")
RE_COUNTY = re.compile(rf"({COUNTIES})\s+(?:County|Area)", re.I)
RE_MW = re.compile(r"([\d,]+(?:\.\d+)?)\s*(?:\xa0)?MW", re.I)

# Anchor load to the phrase that actually states it. Taking the last MW on the
# slide instead picks up thermal/transfer ratings on Operational Flexibility
# slides (6,800 MW) and contingency thresholds on Do-No-Harm slides ("a 300MW
# load drop violation") - neither is customer load.
RE_LOAD = re.compile(
    r"(?:total\s+expected\s+load(?:\s+of)?|expected\s+load\s+of|total\s+load\s+of|"
    r"load\s+request\s+of|capacity\s+of)\s*(?:is\s*)?"
    r"((?:[\d,]+(?:\.\d+)?[\s\xa0]+)*[\d,]+(?:\.\d+)?)\s*(?:\xa0)?MW", re.I)
RE_DNH = re.compile(r"-DNH\b|Do\s*No\s*Harm", re.I)
# Only these drivers represent a customer asking to be served.
LOAD_DRIVERS = re.compile(r"Customer\s+Service", re.I)
RE_DATE = re.compile(r"(?:in-service|target|requested in-service)\s*(?:date)?\s*(?:is)?\s*"
                     r"(\d{1,2}/\d{1,2}/\d{4}|[A-Z][a-z]+ \d{1,2},? \d{4})", re.I)
RE_ENTITY = re.compile(r"\b(DEV Distribution|DEV|REC|NOVEC|ODEC|Rappahannock[\w ]*)\b"
                       r"\s+has submitted", re.I)
# ---- substations ------------------------------------------------------------
# Dominion names them four ways, and these are ordered by how much they prove:
#
#   "a new substation (Flamingo) to serve a data center in Hanover County"
#       the parenthetical - the strongest, because the same sentence usually
#       says what the substation is FOR.
#   "terminates at New Road Substation"          a capitalised name + the word
#   "between CIA and Idylwood substations"       a pair sharing one plural
#   "located at Pleasant View, Greenwich, Liberty ... and Newport News
#    substations"                                a list sharing one plural
#
# Extraction runs on the FULL page text, not the 400-character `text` column
# the CSV carries: ten names in this corpus appear only past that cut, and the
# column exists for eyeballing rather than for parsing.
# RE_NEED is anchored to the literal "Need Number:" label, which is right for
# identifying WHOSE slide this is and useless for finding the others cited on
# it. Do-No-Harm slides list co-studied needs as bare ids in prose.
RE_NEED_ANY = re.compile(r"\b(DOM-\d{4}-\d{4}(?:-\w+)?)\b")
RE_SUB_PAREN = re.compile(r"substation\s*\(([A-Z][A-Za-z0-9'. -]{2,30})\)", re.I)
RE_SUB_NAMED = re.compile(r"\b([A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+){0,2})\s+[Ss]ubstation\b")
RE_SUB_LIST = re.compile(r"\b((?:[A-Z][A-Za-z'.]+(?:\s+[A-Z][A-Za-z'.]+){0,2}"
                         r"(?:,\s*|\s+and\s+)){1,12}[A-Z][A-Za-z'.]+"
                         r"(?:\s+[A-Z][A-Za-z'.]+){0,2})\s+substations\b")
# Words that pass the shape test and name nothing.
SUB_STOP = {
    "the", "a", "an", "new", "proposed", "existing", "future", "this", "that",
    "line", "lines", "both", "each", "other", "same", "two", "three", "four",
    "dominion", "energy", "dev", "distribution", "customer", "data", "center",
    "supplemental", "transmission", "zone", "need", "project", "problem",
    "statement", "solution", "status", "planning", "model", "rtep", "teac",
    "cap", "bank", "banks", "breaker", "position", "segment", "circuit",
    "single", "double", "mile", "miles", "extend", "loop", "cut", "rebuild",
    "between", "located", "terminates", "serve", "serving", "in-service",
    # Descriptors that sit immediately before the word "substation" in ratings
    # and scope sentences: "...1573 MVA. Upgrade substation equipment..."
    "mva", "mw", "kv", "upgrade", "upgrades", "equipment", "rating", "ratings",
    "summer", "winter", "normal", "minimum", "maximum", "achieve", "standards",
    "replace", "replacement", "install", "add", "build", "construct", "at",
}


# Verbs and qualifiers Dominion puts in front of a name. "Construct James
# Hill substation" is James Hill; "Proposed Stockholm" is Stockholm, and it
# also appears bare elsewhere, so leaving the qualifier on would split one
# substation into two.
# "new" is NOT in this list, deliberately: New Post and New Road are real
# substations in this corpus, and stripping the qualifier turned them into
# "Post" and "Road" - two inventions replacing two facts. A qualifier that is
# also a name is not safe to strip, and "new substation (Flamingo)" is caught
# by the parenthetical pattern anyway.
RE_LEAD = re.compile(r"^(?:construct|constructing|expand|expanding|rebuild|"
                     r"rebuilding|proposed|existing|future|the|a|an)\s+", re.I)



def _head_ok(url: str) -> bool:
    """True only if the URL really serves a PDF.

    PJM answers 200 with an HTML error body for media paths that do not exist,
    so status alone matches every probe. Check the magic bytes instead.
    """
    try:
        req = urllib.request.Request(url, headers={**UA, "Range": "bytes=0-1023"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read(5) == b"%PDF-"
    except Exception:  # noqa: BLE001
        return False


def discover() -> list[str]:
    """Find deck URLs: scrape the committee page, then probe known past dates."""
    # The index is a CACHE OF WHAT WAS FOUND, not a decision that discovery is
    # done. It used to short-circuit the whole function whenever the file
    # existed, which meant the September 2026 deck - posted, 5.95 MB, and eight
    # times the size of the one before it - could never be seen: the registry
    # would have gone on reporting a corpus that stopped in August forever,
    # with nothing to indicate it had stopped looking. Scrape every run, merge,
    # and let the date-probing below fill gaps the page no longer lists.
    urls: list[str] = json.loads(INDEX.read_text()) if INDEX.exists() else []
    try:
        req = urllib.request.Request(TEAC_PAGE, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            html = r.read().decode("utf-8", "replace")
        for m in re.findall(r'href="(/-/media/[^"]*dom(?:inion)?-supplemental[^"]*\.pdf)"', html, re.I):
            urls.append("https://www.pjm.com" + m)
    except Exception as e:  # noqa: BLE001
        print(f"  committee page scrape failed: {e}")
    listed = {u.rsplit("/", 1)[-1][:8] for u in urls}
    if urls:
        print(f"  {len(listed)} meeting(s) known after scraping the committee page")
    for d in KNOWN_DATES:
        if d in listed:
            continue
        for item in range(1, 17):
            hit = None
            for name in NAME_VARIANTS:
                u = f"{BASE}/{d[:4]}/{d}/{d}-item-{item:02d}---{name}.pdf"
                if _head_ok(u):
                    hit = u
                    break
            if hit:
                urls.append(hit)
                break
    urls = sorted(set(urls))
    INDEX.write_text(json.dumps(urls, indent=1))
    return urls


def fetch(url: str) -> pathlib.Path:
    dest = CACHE / url.rsplit("/", 1)[-1]
    if not dest.exists():
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=180) as r:
            dest.write_bytes(r.read())
    return dest


def clean_sub(name: str) -> str:
    n = " ".join(name.split()).strip(" .,;:-")
    prev = None
    while prev != n:                      # "Proposed New Stockholm"
        prev = n
        n = RE_LEAD.sub("", n).strip()
    if not n or n.lower() in SUB_STOP:
        return ""
    # A need id is not a substation.
    if RE_NEED_ANY.fullmatch(n) or n.upper().startswith("DOM-"):
        return ""
    # A name whose every word is a stop word names nothing; one that merely
    # starts with one usually does ("New Road", "Pleasant View").
    if all(w.lower() in SUB_STOP for w in n.split()):
        return ""
    if any(ch.isdigit() for ch in n):     # "approximately 14 miles"
        return ""
    if len(n) < 3 or len(n) > 34:
        return ""
    return n


def substations(text: str) -> list[str]:
    """Substation names on one slide, best-evidence first, de-duplicated."""
    found: list[str] = []
    taken: list[tuple[int, int]] = []     # spans a stronger pattern already read

    def add(n: str) -> None:
        n = clean_sub(n)
        if n and n.lower() not in {f.lower() for f in found}:
            found.append(n)

    for m in RE_SUB_PAREN.finditer(text):
        add(m.group(1))
        taken.append(m.span(1))
    # The list pattern must run BEFORE the singular one and claim its span:
    # "Valley and Newport News substations" splits into two names, but the
    # singular pattern reading the same text sees one called "Valley Newport
    # News". Whoever reads a stretch of text first owns it.
    for m in RE_SUB_LIST.finditer(text):
        for part in re.split(r",\s*|\s+and\s+", m.group(1)):
            add(part)
        taken.append(m.span(1))
    for m in RE_SUB_NAMED.finditer(text):
        a, b = m.span(1)
        if any(a < tb and ta < b for ta, tb in taken):
            continue
        add(m.group(1))
    return found


def parse_deck(path: pathlib.Path, meeting: str) -> list[dict]:
    """One row per project slide that names a load."""
    out = []
    try:
        reader = pypdf.PdfReader(str(path))
    except Exception as e:  # noqa: BLE001
        print(f"  unreadable {path.name}: {e}")
        return out
    for i, page in enumerate(reader.pages):
        raw = page.extract_text() or ""
        t = " ".join(raw.replace("​", "").split())
        need = RE_NEED.search(t)
        if not need:
            continue
        # Every need id on the slide, not only the labelled one. Do-No-Harm
        # slides cite the needs studied TOGETHER as bare ids in prose -
        # Dominion's own grouping of what shares a constraint, which is
        # stronger evidence of shared dependency than two needs happening to
        # name the same substation. RE_NEED is anchored to the "Need Number:"
        # label and so can never see them.
        all_needs = []
        for n in RE_NEED_ANY.findall(t):
            if n not in all_needs:
                all_needs.append(n)
        subs = substations(t)
        county = RE_COUNTY.search(t)
        ent = RE_ENTITY.search(t)
        dt = RE_DATE.search(t)
        driver_m = RE_DRIVER.search(t)
        driver = driver_m.group(1).strip() if driver_m else ""
        is_dnh = bool(RE_DNH.search(t))

        # A load figure only counts when the slide is a customer load request.
        load_m = RE_LOAD.search(t)
        mw, mw_basis, mws = "", "", []
        if load_m and not is_dnh and (LOAD_DRIVERS.search(driver) or LOAD_DRIVERS.search(t)):
            # '270 292 MW' is a flattened strikethrough - the last value is current.
            mws = load_m.group(1).split()
            mw = float(mws[-1].replace(",", ""))
            mw_basis = "stated_load"
        elif is_dnh:
            mw_basis = "excluded_do_no_harm"
        elif RE_MW.search(t):
            mw_basis = "excluded_unanchored_mw"
        out.append({
            "meeting": meeting,
            "page": i + 1,
            "need_number": need.group(1),
            "needs_on_slide": " ".join(all_needs),
            "substations": " | ".join(subs),
            "process_stage": (RE_STAGE.search(t).group(1).strip() if RE_STAGE.search(t) else ""),
            "driver": driver,
            "county": (county.group(1).title() if county else ""),
            "requesting_entity": (ent.group(1).upper().replace("DEV DISTRIBUTION", "DEV") if ent else ""),
            "mw": mw,
            "mw_basis": mw_basis,
            "mw_all_values": " ".join(mws) if len(mws) > 1 else "",
            "in_service": (dt.group(1) if dt else ""),
            "is_data_center": "yes" if re.search(r"data\s*center", t, re.I) else "",
            "text": t[:400],
        })
    return out


def consolidate(rows: list[dict]) -> list[dict]:
    """Collapse slides to one row per Need Number.

    A need appears at a Need Meeting with full detail, then again at Solution
    and Do-No-Harm meetings that cite only the number. Per-slide extraction
    therefore looks sparse; merging across meetings recovers the attributes.
    Later meetings win on load so restatements are reflected, and every
    distinct load seen is kept in mw_history.
    """
    by: dict[str, list[dict]] = {}
    for r in rows:
        by.setdefault(r["need_number"], []).append(r)
    out = []
    for need, group in by.items():
        g = sorted(group, key=lambda x: x["meeting"])
        def first(field):
            return next((x[field] for x in g if x[field]), "")
        def last(field):
            return next((x[field] for x in reversed(g) if x[field]), "")
        hist, seen = [], set()
        for x in g:
            if x["mw"] and x["mw"] not in seen:
                seen.add(x["mw"])
                hist.append(f"{x['meeting']}:{x['mw']}")
        # Union across every slide the need appears on: a substation named at
        # the Need Meeting and a load stated at the Solution Meeting belong to
        # the same need even though no single slide carries both.
        subs, seen_s = [], set()
        for x in g:
            for n in (x.get("substations") or "").split(" | "):
                if n and n.lower() not in seen_s:
                    seen_s.add(n.lower())
                    subs.append(n)
        with_needs = []
        for x in g:
            for n in (x.get("needs_on_slide") or "").split():
                if n != need and n not in with_needs:
                    with_needs.append(n)
        out.append({
            "need_number": need,
            "substations": " | ".join(subs),
            "studied_with": " ".join(with_needs),
            "county": first("county"),
            "requesting_entity": first("requesting_entity"),
            "is_data_center": "yes" if any(x["is_data_center"] for x in g) else "",
            "mw_current": last("mw"),
            "mw_history": " -> ".join(hist),
            "revised": "yes" if len(hist) > 1 else "",
            "in_service": last("in_service"),
            "first_seen": g[0]["meeting"],
            "last_seen": g[-1]["meeting"],
            "meetings": len(g),
            "latest_stage": last("process_stage"),
            "driver": first("driver"),
        })
    return sorted(out, key=lambda r: (r["county"], r["need_number"]))


def main() -> None:
    urls = discover()
    print(f"decks discovered: {len(urls)}")
    rows: list[dict] = []
    for u in urls:
        meeting = u.rsplit("/", 1)[-1][:8]
        try:
            p = fetch(u)
        except Exception as e:  # noqa: BLE001
            print(f"  fetch failed {meeting}: {e}")
            continue
        r = parse_deck(p, meeting)
        print(f"  {meeting}  {len(r):>3} project slides")
        rows.extend(r)
    dest = ROOT / "data" / "teac_projects.csv"
    cols = ["meeting", "page", "need_number", "needs_on_slide", "substations",
            "process_stage", "driver", "county",
            "requesting_entity", "mw", "mw_basis", "mw_all_values", "in_service",
            "is_data_center", "text"]
    with dest.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print(f"\nwrote {dest.relative_to(ROOT)}  ({len(rows)} slides)")

    needs = consolidate(rows)
    dest2 = ROOT / "data" / "teac_needs.csv"
    with dest2.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=list(needs[0].keys()))
        w.writeheader()
        w.writerows(needs)
    print(f"wrote {dest2.relative_to(ROOT)}  ({len(needs)} needs)")


if __name__ == "__main__":
    main()
