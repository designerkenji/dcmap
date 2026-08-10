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
RE_SUB = re.compile(r"\(([A-Z][A-Za-z ]{2,28})\)\s*(?:to be located|substation|delivery)?", re.I)


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
    if INDEX.exists():
        return json.loads(INDEX.read_text())
    urls: list[str] = []
    try:
        req = urllib.request.Request(TEAC_PAGE, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            html = r.read().decode("utf-8", "replace")
        for m in re.findall(r'href="(/-/media/[^"]*dom(?:inion)?-supplemental[^"]*\.pdf)"', html, re.I):
            urls.append("https://www.pjm.com" + m)
    except Exception as e:  # noqa: BLE001
        print(f"  committee page scrape failed: {e}")
    listed = {u.rsplit("/", 1)[-1][:8] for u in urls}
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
        out.append({
            "need_number": need,
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
    cols = ["meeting", "page", "need_number", "process_stage", "driver", "county",
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
