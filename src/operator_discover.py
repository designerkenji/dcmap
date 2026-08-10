"""Find the website and logo for operators that do not have one yet.

    python3 operator_discover.py [--limit N] [--write]

The curated profiles in operator_profiles_raw.json were researched by hand,
which does not scale past a few dozen. Most of the remaining operators have an
obvious domain - CoreSite is coresite.com, euNetworks is eunetworks.com - and
guessing it is cheap. Guessing it WRONG is not: a squatted domain would put a
stranger's logo on a company's page, so nothing is accepted without proof.

THE PROOF
A candidate domain is only accepted if the page it serves names the operator
back: the <title>, og:site_name or the copyright line has to contain the
operator's distinctive token, compared with punctuation and case removed. That
rejects parked domains, "domain for sale" pages, and the wrong company sharing
a short name. Anything unproven is reported and skipped, not written.

Output is a REVIEW FILE by default. --write merges the verified ones into
operator_profiles_raw.json, which operator_logos.py then turns into cached
logos. No prose is invented here: these get a domain, a locations link and a
logo, and the profile text stays empty until someone writes one.
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
OPS = ROOT / "data" / "operators.json"
RAW = ROOT / "data" / "operator_profiles_raw.json"
REVIEW = ROOT / "data" / "operator_discovered.json"

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"}
WORKERS = 6

# Words that carry no identity, so they are not what a domain gets built from
# and not what the page has to echo back.
STOP = re.compile(
    r"\b(data|centers?|centres?|datacenters?|datacentres?|the|and|of|group|holdings?"
    r"|inc|llc|ltd|limited|corp|corporation|company|co|sa|bv|nv|gmbh|ag|plc|pty|pte"
    r"|technologies|technology|solutions?|services?|communications?|telecom|networks?"
    r"|international|global|digital|cloud|hosting|colocation)\b", re.I)

TLDS = (".com", ".net", ".io", ".eu", ".co", ".cloud")
# Country hints from the operator's own dominant country, tried before the
# generic TLDs - "Chorus New Zealand" is chorus.co.nz, never chorus.com.
CC_TLD = {"NZ": (".co.nz", ".nz"), "AU": (".com.au", ".au"), "IN": (".in", ".co.in"),
          "ID": (".co.id", ".id"), "BR": (".com.br", ".br"), "MX": (".com.mx", ".mx"),
          "AR": (".com.ar", ".ar"), "FR": (".fr",), "DE": (".de",), "NL": (".nl",),
          "NO": (".no",), "DK": (".dk",), "SE": (".se",), "GB": (".co.uk", ".uk"),
          "ES": (".es",), "IT": (".it",), "CA": (".ca",), "JP": (".jp", ".co.jp"),
          "BE": (".be",), "CH": (".ch",), "AT": (".at",), "PL": (".pl",)}


def tokens(name: str) -> list[str]:
    n = re.sub(r"[^A-Za-z0-9 ]+", " ", name)
    return [t for t in STOP.sub(" ", n).split() if len(t) > 2]


def candidates(name: str, cc: str) -> list[str]:
    """Domain stems, LONGEST FIRST.

    The full name matters more than the distinctive part: "Colocation America"
    is colocationamerica.com and "365 Data Centers" is 365datacenters.com. An
    earlier version tried the shortest stem first and cheerfully matched
    america.com (a travel site) and 365.net (a link directory), because the
    remaining token after stripping "colocation" and "data centers" is a
    generic English word that appears on any page.
    """
    full = re.sub(r"[^a-z0-9]+", "", name.lower())
    toks = tokens(name)
    stems = []
    if 3 <= len(full) <= 30:
        stems.append(full)
    if toks:
        j = "".join(toks).lower()
        if j != full and 3 <= len(j) <= 30:
            stems.append(j)
    out = []
    for st in stems:
        for t in CC_TLD.get(cc, ()) + TLDS:
            out.append(st + t)
    return out[:16]


def fetch(url: str) -> str | None:
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=12) as r:
            return r.read(400_000).decode("utf-8", errors="ignore")
    except Exception:
        return None


def flat(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def verify(page: str, name: str) -> str:
    """Return the evidence string if this page belongs to `name`, else ''."""
    if not page or len(page) < 1500:
        return ""
    fields = []
    m = re.search(r"(?is)<title[^>]*>(.*?)</title>", page)
    if m:
        fields.append(("title", html.unescape(re.sub(r"\s+", " ", m.group(1))).strip()))
    m = re.search(r'(?i)og:site_name"[^>]*content="([^"]{2,80})"', page)
    if m:
        fields.append(("og:site_name", html.unescape(m.group(1))))
    m = re.search(r"(?i)(©|&copy;|copyright)[^<]{0,80}", page)
    if m:
        fields.append(("copyright", html.unescape(m.group(0))[:80]))
    toks = [flat(t) for t in tokens(name)]
    if not toks:
        return ""
    # Second, independent signal: this is a directory of DATA CENTRE operators,
    # so the site should say so somewhere. A single generic token matching a
    # title is not enough on its own - that is how a golf-shaft manufacturer
    # was accepted as Digital Edge DC.
    dcish = bool(re.search(r"(?i)data ?cent(er|re)|colocation|colo\b|interconnect", page))
    for label, val in fields:
        fv = flat(val)
        # Every distinctive token must appear, so "Chorus" does not match a
        # page about a different Chorus that happens to rank.
        if all(t in fv for t in toks) and (dcish or len(toks) > 1):
            return f"{label}: {val[:70]}" + ("" if dcish else "  [no dc term]")
    return ""


def icons(page: str, base: str) -> list[str]:
    out = []
    for m in re.finditer(r'(?is)<link[^>]+rel="[^"]*icon[^"]*"[^>]*>', page):
        h = re.search(r'href="([^"]+)"', m.group(0))
        if h:
            out.append(urllib.parse.urljoin(base, html.unescape(h.group(1))))
    for m in re.finditer(r'(?i)<img[^>]+src="([^"]*logo[^"]*\.(?:svg|png))"', page):
        out.append(urllib.parse.urljoin(base, html.unescape(m.group(1))))
    # Apple touch icons are the largest thing most sites declare, so first.
    out.sort(key=lambda u: (0 if "apple-touch" in u else 1, "favicon" in u))
    seen, uniq = set(), []
    for u in out:
        if u not in seen:
            seen.add(u)
            uniq.append(u)
    return uniq[:5] + [f"https://{urllib.parse.urlparse(base).netloc}/favicon.ico"]


def locations_link(page: str, base: str) -> str:
    for m in re.finditer(r'(?i)href="([^"]*(?:data-cent|datacent|locations?|our-sites)[^"]*)"', page):
        u = urllib.parse.urljoin(base, html.unescape(m.group(1)))
        if urllib.parse.urlparse(u).netloc == urllib.parse.urlparse(base).netloc:
            return u
    return ""


def probe(op: dict) -> dict:
    name, cc = op["name"], op.get("cc", "")
    for dom in candidates(name, cc):
        for scheme in ("https://www.", "https://"):
            base = scheme + dom + "/"
            page = fetch(base)
            ev = verify(page or "", name)
            if ev:
                return {"key": op["key"], "displayName": name, "domain": dom,
                        "evidence": ev, "logoCandidates": icons(page, base),
                        "officialLocationList": locations_link(page, base)}
    return {"key": op["key"], "displayName": name, "domain": "", "evidence": ""}


def main() -> None:
    limit = 34
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    ops = json.loads(OPS.read_text())["operators"]
    have = {o["key"] for o in json.loads(RAW.read_text())}
    todo = []
    for o in ops:
        if o["key"] in have or len(todo) >= limit:
            continue
        cc = max(o["byCountry"], key=o["byCountry"].get) if o.get("byCountry") else ""
        todo.append({**o, "cc": cc})

    print(f"probing {len(todo)} operators ({sum(o['n'] for o in todo)} sites)\n")
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        found = list(pool.map(probe, todo))

    ok = [f for f in found if f["domain"]]
    print(f"{'operator':<28}{'domain':<26}evidence")
    print("-" * 92)
    for f in found:
        if f["domain"]:
            print(f"{f['displayName'][:26]:<28}{f['domain'][:24]:<26}{f['evidence'][:38]}")
    print("-" * 92)
    print(f"verified {len(ok)} of {len(found)}")
    miss = [f["displayName"] for f in found if not f["domain"]]
    if miss:
        print(f"\nunproven, skipped: {', '.join(m[:24] for m in miss)}")

    REVIEW.write_text(json.dumps(found, indent=1, ensure_ascii=False))
    print(f"\nwrote {REVIEW.relative_to(ROOT)}")

    if "--write" in sys.argv:
        raw = json.loads(RAW.read_text())
        raw += [{k: v for k, v in f.items() if k != "evidence"} for f in ok]
        RAW.write_text(json.dumps(raw, indent=1, ensure_ascii=False))
        print(f"merged {len(ok)} into {RAW.relative_to(ROOT)} - "
              f"run operator_logos.py next")


if __name__ == "__main__":
    main()
