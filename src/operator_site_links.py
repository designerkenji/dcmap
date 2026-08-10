"""Harvest each operator's own page for each of its data centres.

    python3 operator_site_links.py [operator_key ...]

The registry can say "this dot is Vantage Berlin II". What it could not do is
send you to what Vantage says about Berlin II. Operators publish a page per
campus - usually with the street address, often with IT load and commissioning
date - and that page is the best available primary source for a site we
otherwise know only as an OSM polygon.

Writes data/operator_site_links.json:

    {"vantage": {"index": [...], "sites": [{name, url, address, city, country}]}}

TABLE-DRIVEN ON PURPOSE
Every operator lays their site out differently and there is no standard to code
against, so each one gets a RECIPES entry rather than a bespoke function. The
cost of a new operator is a table row. The alternative - one parser per
operator - is how this kind of file becomes 2,000 lines nobody will re-run.

WHAT IS DELIBERATELY NOT DONE HERE
No geocoding, and no injection of unseen campuses into the registry as new
sites. A harvested address that does not match anything we hold is recorded and
counted, not turned into a dot: deciding that Vantage's 23 unmatched campuses
should become registry rows is an ingestion decision, not a link-collection
one.
"""

from __future__ import annotations

import concurrent.futures
import html
import json
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "operator_site_links.json"
CACHE = ROOT / "data" / "raw" / "operator_pages"

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"}
# Politeness is expressed as a concurrency cap rather than a sleep between
# requests. The first version slept 0.4 s serially, which meant NTT's 91 pages
# cost three minutes of pure waiting and Equinix's 277 would have cost ten. Six
# in flight is gentler on a marketing site than a browser opening a page, and
# turns those into well under a minute.
WORKERS = 6

# One entry per operator.
#   index      pages that list the campuses
#   link       regex whose group(1) is a campus-page href
#   keep       if set, ONLY hrefs whose path matches are kept
#   skip       hrefs matching this are section indexes, not campuses
#   addr_from  text that immediately precedes the street address on a campus page
#   addr_to    text that ends it
RECIPES = {
    "vantage": {
        "index": ["https://vantage-dc.com/data-center-locations/"],
        "link": r'href="((?:https://vantage-dc\.com)?/data-center-locations/'
                r'(?:north-america|emea|apac)/[a-z0-9-]+/?)"',
        # /emea/ and /apac/ alone are the regional indexes, not campuses.
        "skip": r"/data-center-locations/(?:north-america|emea|apac)/?$",
        "addr_from": "Campus Address",
        "addr_to": "Get directions",
    },

    # NTT's own sitemap carries 91 campus pages. The fleet pass that seeded the
    # other operators was capped at 60, which silently truncated the largest
    # operator in the set - taking it from the sitemap instead is both complete
    # and cheaper than crawling four regional indexes.
    "ntt": {
        "index": ["https://services.global.ntt/en-us/sitemap.xml"],
        "link": r"<loc>(https://services\.global\.ntt/en-us/services-and-products/"
                r"global-data-centers/global-locations/[a-z-]+/[a-z0-9-]+)</loc>",
        # Singular is a building, plural is the metro roll-up above it:
        # ".../americas/ashburn-va-1-data-center" vs ".../americas/ashburn-data-centers".
        "skip": r"-data-centers$",
    },

    # Global Switch publishes one page per city. No street address on any of
    # them, so matching leans on city alone - which is fine here because they
    # run one campus per city.
    "global switch": {
        "index": ["https://www.globalswitch.com/page-sitemap.xml"],
        "link": r"<loc>(https://www\.globalswitch\.com/data-centres/[a-z-]+)/</loc>",
    },

    # nLighten's sitemap carries all five language editions of every page;
    # only the /en/ set is wanted or the same site lands five times.
    "nlighten": {
        "index": ["https://www.nlighten.com/edge-location-sitemap.xml"],
        "link": r"<loc>(https://www\.nlighten\.com/en/edge-location/[a-z0-9-]+)/</loc>",
    },

    # VIRTUS wraps every <loc> in CDATA, which the plain <loc>(...)</loc>
    # pattern used everywhere else silently matches zero of.
    "virtus": {
        "index": ["https://virtusdatacentres.com/sitemap.xml"],
        "link": r"<loc><!\[CDATA\[(https://virtusdatacentres\.com/locations/[a-z0-9/-]+)\]\]></loc>",
        # /uk and /germany are country indexes, not sites.
        "skip": r"^/locations/(uk|germany|eu)$",
    },

    # The next four were seeded by a research pass that was capped at 60 pages
    # each, which is far short of their real estates and, worse, made the
    # matcher's absence-based tiers unsound for them ("the only campus in that
    # city" is meaningless on a truncated list). Each is now taken from its own
    # sitemap, where PATH DEPTH separates a facility page from the metro,
    # country and region indexes above it - [^/<]+ cannot span a slash, so
    # counting segments in the regex is the whole classifier.

    # 5 segments = per-IBX. Depths 2-4 are the global, region/country and metro
    # indexes. sitemap-core.xml is reachable from sitemap.xml but robots.txt
    # does not advertise it.
    "equinix": {
        "index": ["https://www.equinix.com/sitemap-core.xml"],
        "link": r"<loc>(https://www\.equinix\.com/data-centers/[^/<]+/[^/<]+/[^/<]+/[^/<]+)</loc>",
    },

    # 4 segments = per-facility; depth 3 is the metro page.
    "digital realty": {
        "index": ["https://www.digitalrealty.com/en-sitemap.xml"],
        "link": r"<loc>(https://www\.digitalrealty\.com/data-centers/"
                r"(?:americas|emea|asia-pacific)/[^/<]+/[^/<]+)</loc>",
    },

    # Custom post-type sitemap, 117 entries. Leaves are 2 or 3 segments deep
    # depending on whether the market has a campus level; both are real pages,
    # so both are kept and only the 1-segment market pages are excluded.
    "databank": {
        "index": ["https://www.databank.com/db_data_center-sitemap.xml"],
        "link": r"<loc>(https://www\.databank\.com/data-centers/"
                r"[^/<]+/[^/<]+(?:/[^/<]+)?)/?</loc>",
    },

    # CURRENTLY BLOCKED - leaving the recipe in place because it is correct and
    # they may relax. As of 2026-08-02 every edgeconnex.com path returns 403 to
    # a plain client, including campus pages that fetched fine earlier the same
    # day, and adding a Referer or full browser Accept headers does not change
    # it. That is a deliberate block, so it is not worked around; the 60 records
    # already on disk are kept by the empty-harvest guard in main().
    #
    # Neither source is complete on its own, so take the union: the Yoast
    # sitemap caps itself at 60, and the regional indexes carry the rest. One
    # pattern matches the URL in either a <loc> or an href.
    "edgeconnex": {
        "index": ["https://www.edgeconnex.com/data-center-sitemap.xml",
                  "https://www.edgeconnex.com/americas/",
                  "https://www.edgeconnex.com/emea/",
                  "https://www.edgeconnex.com/asia-pacific/"],
        "link": r'(?:<loc>|href=")(https://www\.edgeconnex\.com/locations/'
                r'(?:americas|emea|asia-pacific)/[^/"<]+)/?(?:</loc>|")',
    },

    # DATA4 publishes one page per country/metro campus, not per building, and
    # those pages sit among ~350 marketing pages sharing the "data-center-"
    # prefix ("data-center-solutions", "data-center-certifications"). The slug
    # ending in a country name is what actually separates them.
    "data4": {
        "index": ["https://www.data4group.com/page-sitemap.xml"],
        "link": r"<loc>(https://www\.data4group\.com/en/data-centers?-[a-z0-9-]+)/</loc>",
        "keep": r"(greece|germany|luxemburg|luxembourg|spain|italy|france|poland"
                r"|netherlands|belgium|portugal|austria|switzerland)(-\d+)?$",
    },
}


def fetch(url: str) -> str | None:
    """Fetch with an on-disk cache, so re-runs cost nothing and are reproducible."""
    CACHE.mkdir(parents=True, exist_ok=True)
    key = re.sub(r"[^a-z0-9]+", "_", url.lower())[:120]
    dest = CACHE / f"{key}.html"
    if dest.exists():
        return dest.read_text(errors="ignore")
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8", errors="ignore")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
        print(f"    ! {url} -> {e}")
        return None
    dest.write_text(body)
    return body


def text_between(page: str, start: str, end: str, limit: int = 1200) -> str:
    """Visible text between two marker phrases, tags stripped."""
    i = page.find(start)
    if i < 0:
        return ""
    seg = page[i + len(start):i + len(start) + limit]
    j = seg.find(end)
    if j >= 0:
        seg = seg[:j]
    txt = html.unescape(re.sub(r"(?s)<[^>]+>", "\n", seg))
    lines = [l.strip() for l in txt.split("\n") if l.strip()]
    # Marketing pages repeat the address block for mobile and desktop layouts;
    # take the first run and stop when it starts over.
    out = []
    for l in lines:
        if out and l == out[0]:
            break
        out.append(l)
    return ", ".join(out)


def title_of(page: str) -> str:
    m = re.search(r"(?is)<title[^>]*>(.*?)</title>", page)
    if not m:
        return ""
    t = html.unescape(re.sub(r"\s+", " ", m.group(1))).strip()
    # Marketing titles are "<campus> - <brand>" or "<campus> | <brand>", and
    # the brand is already on the page that shows this link. Keep the campus.
    t = re.split(r"\s*[|·—–]\s*|\s+-\s+", t)[0].strip()
    return re.sub(r"(?i)\s*Data\s+Cent(er|re)s?(\s+Campus)?$|\s*Campus$", "", t).strip()


def harvest(key: str, rec: dict) -> dict:
    print(f"\n{key}:")
    urls: list[str] = []
    for idx in rec["index"]:
        page = fetch(idx)
        if not page:
            continue
        for href in re.findall(rec["link"], page):
            full = urllib.parse.urljoin(idx, href)
            p = urllib.parse.urlparse(full).path.rstrip("/")
            if rec.get("keep") and not re.search(rec["keep"], p):
                continue
            if rec.get("skip") and re.search(rec["skip"], p):
                continue
            # Some hrefs appear with and without a trailing slash; treat them as one.
            full = full.rstrip("/") + "/"
            if full not in urls:
                urls.append(full)
    print(f"  {len(urls)} campus pages found from {len(rec['index'])} index page(s)")

    # Fetch concurrently, then build the records in URL order so the output is
    # deterministic regardless of which response lands first.
    pages: dict[str, str] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for u, page in zip(urls, pool.map(fetch, urls)):
            if page:
                pages[u] = page

    sites, with_addr = [], 0
    for u in urls:
        page = pages.get(u)
        if not page:
            continue
        addr = ""
        if rec.get("addr_from"):
            addr = text_between(page, rec["addr_from"], rec.get("addr_to", "\x00"))
        if addr:
            with_addr += 1
        # Slug is the most reliable name: titles get suffixed with marketing.
        slug = urllib.parse.urlparse(u).path.rstrip("/").split("/")[-1]
        sites.append({
            "name": title_of(page) or slug.replace("-", " ").title(),
            "slug": slug, "url": u, "address": addr,
        })
    print(f"  {len(sites)} fetched, {with_addr} publish a street address")
    return {"index": rec["index"], "sites": sites}


def main() -> None:
    want = sys.argv[1:] or list(RECIPES)
    out = {}
    if OUT.exists():
        out = json.loads(OUT.read_text())      # keep operators not being re-run
    for key in want:
        if key not in RECIPES:
            print(f"no recipe for {key!r}; known: {', '.join(sorted(RECIPES))}")
            continue
        got = harvest(key, RECIPES[key])
        # A harvest that returns nothing is a FAILED harvest, not an empty
        # operator - EdgeConneX started 403ing all four of its index pages and
        # this line, without the guard, replaced 60 good records with zero.
        # Keep what is on disk and say so; re-running must never lose data.
        if not got["sites"] and out.get(key, {}).get("sites"):
            print(f"  ! kept the existing {len(out[key]['sites'])} records: "
                  f"this run fetched nothing")
            continue
        # Addresses are expensive to extract and some recipes do not do it at
        # all. Where a URL was already known WITH an address, carry it over
        # rather than blanking it - re-harvesting a longer page list should not
        # cost the detail already collected from the short one.
        prior = {s["url"].rstrip("/"): s.get("address", "")
                 for s in out.get(key, {}).get("sites", []) if s.get("address")}
        kept = 0
        for s in got["sites"]:
            if not s.get("address") and prior.get(s["url"].rstrip("/")):
                s["address"] = prior[s["url"].rstrip("/")]
                kept += 1
        if kept:
            print(f"  carried {kept} addresses over from the previous harvest")
        out[key] = got

    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    total = sum(len(v["sites"]) for v in out.values())
    addrs = sum(1 for v in out.values() for s in v["sites"] if s["address"])
    print(f"\nwrote {OUT.relative_to(ROOT)}  "
          f"({len(out)} operators, {total} sites, {addrs} with an address)")


if __name__ == "__main__":
    main()
