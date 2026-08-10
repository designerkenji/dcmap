"""Aggregate the registry into an operator directory, grouped by region.

    python3 operators.py

The registry stores whatever each source called the operator, so one company
arrives spelled many ways: "Equinix", "Equinix, Inc.", "Equinix (EMEA)",
"EQUINIX LD8". Counting those separately puts a 174-site company below a
40-site one. This collapses them and emits data/operators.json for the map's
operator directory.

WHY THIS DOES NOT REUSE dedupe.canon_operator
---------------------------------------------
It looks like duplication and it is deliberate. dedupe's version decides
whether two nearby rows may MERGE INTO ONE SITE, so a false collapse silently
destroys a distinct facility - it is tuned conservatively and its brand list is
short on purpose. This one decides how rows are GROUPED IN A LIST, where a
false collapse is a visible labelling mistake and a missed collapse just splits
a company into two entries. Different blast radius, so different tuning.
Widening dedupe's list to serve the directory would change which sites merge,
which is not a display concern's business.

Region comes from the same Natural Earth 10m file world.py attributes
countries with - it carries CONTINENT and SUBREGION per country, so grouping
costs nothing new. It must be the SAME resolution as the attribution step or
countries that exist in one and not the other silently lose their region:
reading 110m here while world.py had moved to 10m left Macau, Cape Verde,
the Faroes and the Isle of Man region-less.

The basemap the browser renders stays 110m, for reasons documented in
data.mjs - that is a rendering constraint, not a geography one.
"""

from __future__ import annotations

import collections
import csv
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITES = ROOT / "data" / "facilities_sites.csv"
NE = ROOT / "data" / "raw" / "ne_countries_10m.geojson"
OUT = ROOT / "data" / "operators.json"

# Legal-form and boilerplate noise, stripped before matching.
NOISE = re.compile(
    r"\b(inc|ltd|limited|llc|llp|lp|corp|corporation|co|company|gmbh|mbh|ag|bv|nv|sa|sas"
    r"|spa|srl|sarl|as|a/s|oy|oyj|ab|plc|pty|pte|kk|kg|se|cv|group|holdings?|holding"
    r"|international|worldwide|global|solutions?|services?|technologies|technology"
    r"|communications?|networks?|telecom|telecoms|data ?cent(er|re)s?|dc|colocation"
    r"|colo|hosting|cloud|infrastructure|properties|trust|reit)\b", re.I)

# Brands worth collapsing by hand, because their rows are spelled every way a
# field engineer might type them. Order matters: the first hit wins, so more
# specific strings ("digital realty") come before anything they contain.
BRANDS = [
    ("amazon", ("amazon", "aws", "a100 row", "vadata")),          # vadata = AWS's build entity
    ("google", ("google", "alphabet", "raiders llc")),            # Raiders LLC = Google's Nevada SPV
    ("microsoft", ("microsoft", "azure", "msft")),
    ("meta", ("meta platforms", "meta ", "facebook", "raven northbrook", "greater kudu")),
    ("equinix", ("equinix", "telecity", "switch and data", "bit-isle", "packet host")),
    ("digital realty", ("digital realty", "digitalrealty", "interxion", "dupont fabros",
                        "telx", "ascenty")),
    ("ntt", ("ntt", "e-shelter", "gyron", "netmagic", "raging wire", "ragingwire")),
    ("telehouse", ("telehouse", "kddi")),
    ("gds", ("gds ", "gds holdings", "万国数据")),
    ("cyrusone", ("cyrusone", "cyrus one")),
    ("iron mountain", ("iron mountain", "ironmountain")),
    ("coresite", ("coresite",)),
    ("qts", ("qts", "quality technology")),
    ("vantage", ("vantage data", "vantage dc")),
    # "Infrastructre" is a real misspelling in the OSM data for ZUR01A in Rafz;
    # without it that site splits into a company of its own.
    ("stack", ("stack infrastructure", "stack infrastructre", "stack emea",
               "stack americas")),
    ("aligned", ("aligned data", "aligned energy")),
    ("edgeconnex", ("edgeconnex", "edge connex")),
    ("databank", ("databank", "data bank")),
    ("flexential", ("flexential", "peak 10", "viawest")),
    ("tierpoint", ("tierpoint", "tier point")),
    ("cologix", ("cologix",)),
    # "DATA4 s.a r.l" and "Data4 Italia" were each splitting into a company of
    # their own: the punctuation scrub turns "s.a r.l" into four single letters
    # that the legal-form list cannot see, and "Italia" is a country adjective
    # rather than boilerplate. Two of six Data4 sites were being lost this way.
    ("data4", ("data4", "data 4")),
    ("centersquare", ("centersquare", "cyxtera", "evoque")),
    ("stt", ("st telemedia", "stt gdc", "sttelemedia")),
    # VIRTUS is owned by STT GDC but trades under its own name, with its own
    # site and locations page, so it gets its own entry rather than being
    # absorbed - "VIRTUS Data Centres" was previously matching STT's
    # "virtus data" needle and vanishing into a 25-site parent.
    ("virtus", ("virtus",)),
    # "nLighten HQ BV", "nLighten France", "nLighten UK" and "nLighten" were
    # four separate companies in the directory. The country and HQ suffixes are
    # not legal forms, so the boilerplate stripper cannot see them.
    ("nlighten", ("nlighten", "n lighten")),
    ("switch", ("switch inc", "switch ltd", "switch datacenters", "supernap")),
    ("coreweave", ("coreweave", "core weave")),
    ("oracle", ("oracle",)),
    ("apple", ("apple inc", "apple computer")),
    ("lumen", ("lumen", "centurylink", "level 3", "level3", "qwest")),
    ("cogent", ("cogent",)),
    ("exa infrastructure", ("exa infrastructure", "ge telecom")),
    ("eunetworks", ("eunetworks", "eu networks")),
    ("colt", ("colt ",)),
    ("global switch", ("global switch",)),
    ("cloudhq", ("cloudhq", "cloud hq")),
    ("scala", ("scala data", "scaladata")),
    ("odata", ("odata",)),
    ("airtrunk", ("airtrunk", "air trunk")),
    ("princeton digital", ("princeton digital",)),
    ("keppel", ("keppel",)),
    ("alibaba", ("alibaba", "aliyun", "阿里")),
    ("tencent", ("tencent", "腾讯")),
    ("huawei", ("huawei", "华为")),
    ("china telecom", ("china telecom", "chinanet", "中国电信")),
    ("china unicom", ("china unicom", "中国联通")),
    ("china mobile", ("china mobile", "中国移动")),
    ("bytedance", ("bytedance", "tiktok", "字节")),
    ("xai", ("xai", "x.ai", "spacexai")),
]


# Trailing legal form, stripped for DISPLAY only. Grouping already ignores it;
# this is so the directory reads "Cogent Communications" and not
# "Cogent Communications, Inc". Anchored at the end so "Iron Mountain Data
# Centers" and "euNetworks Group" keep the words that are part of the name.
LEGAL_TAIL = re.compile(
    r"[\s,]*\b(inc|incorporated|ltd|ltda|limited|llc|l\.l\.c|llp|lp|corp|corporation"
    r"|gmbh|mbh|ag|bv|b\.v|nv|n\.v|sa|s\.a|sas|spa|s\.p\.a|srl|s\.r\.l|sarl|as|a/s"
    r"|oy|oyj|ab|plc|pty|pte|kk|k\.k|kg|se|cv|co|company|group|holdings?|sdn bhd|bhd)\b\.?$",
    re.I)


def display(raw: str) -> str:
    prev = None
    out = (raw or "").strip()
    while out != prev:                      # "Foo Holdings Ltd." needs two passes
        prev = out
        out = LEGAL_TAIL.sub("", out).strip()
    return out or (raw or "").strip()

BRAND_KEYS = {k for k, _ in BRANDS}


def canon(raw: str) -> str:
    """Collapse an operator string to a grouping key. Empty if unusable."""
    x = (raw or "").lower()
    x = re.sub(r"[‘’“”'`]", "", x)
    x = re.sub(r"[.,;:/\\()\[\]{}&+_-]", " ", x)
    x = " ".join(x.split())
    if not x:
        return ""
    for key, needles in BRANDS:
        if any(n in x for n in needles):
            return key
    stripped = " ".join(NOISE.sub(" ", x).split())
    # Stripping boilerplate can land a DIFFERENT company exactly on a brand key:
    # "Stack Group", a Russian operator, reduces to "stack" and was silently
    # merging into STACK Infrastructure, which it has nothing to do with. When
    # that happens keep the fuller name so the two stay apart. It only bites
    # where a brand key is also an ordinary word, which is why it is a rule
    # rather than a list of exceptions.
    if stripped != x and stripped in BRAND_KEYS:
        return x
    # A row whose operator was ONLY boilerplate ("Data Center LLC") carries no
    # identity - grouping those together would invent a company.
    return stripped if len(stripped) > 2 else ""


# Kept as a backstop from when this read 110m, which omitted territories too
# small to draw at that scale - Hong Kong and Singapore among them. At 10m
# they all exist and this table should be dead code, but it costs twelve lines
# and it is the difference between a site losing its region silently and not.
MICRO = {
    "HK": ("Hong Kong", "Asia", "Eastern Asia"),
    "SG": ("Singapore", "Asia", "South-Eastern Asia"),
    "BH": ("Bahrain", "Asia", "Western Asia"),
    "MV": ("Maldives", "Asia", "Southern Asia"),
    "MU": ("Mauritius", "Africa", "Eastern Africa"),
    "LI": ("Liechtenstein", "Europe", "Western Europe"),
    "GU": ("Guam", "Oceania", "Micronesia"),
    "MP": ("Northern Mariana Islands", "Oceania", "Micronesia"),
    "CW": ("Curacao", "North America", "Caribbean"),
    "BL": ("Saint Barthelemy", "North America", "Caribbean"),
    "GP": ("Guadeloupe", "North America", "Caribbean"),
    "GF": ("French Guiana", "South America", "South America"),
}


def regions() -> dict:
    """ISO2 -> continent / subregion / display name, from Natural Earth."""
    if not NE.exists():
        raise SystemExit("data/raw/ne_countries.geojson missing - run `python3 world.py` first")
    out = {iso: {"n": n, "c": c, "s": s} for iso, (n, c, s) in MICRO.items()}
    for ft in json.loads(NE.read_text()).get("features", []):
        p = ft.get("properties") or {}
        # Same -99 problem world.py documents: NE blanks ISO_A2 for France,
        # Norway and others, and only ISO_A2_EH carries the real code.
        iso = p.get("ISO_A2")
        if not iso or iso == "-99":
            iso = p.get("ISO_A2_EH") or ""
        if iso == "CN-TW":
            iso = "TW"
        if not iso or iso == "-99":
            continue
        # One ISO covers many 10m features - FR is France, Clipperton Island
        # and French Guiana - so last-one-wins put a Paris site in
        # "Seven seas (open ocean)", which is Clipperton's continent. Prefer
        # the feature that IS the sovereign state; dependencies never are.
        if iso in out and p.get("SOVEREIGNT") != p.get("ADMIN"):
            continue
        out[iso] = {
            "n": p.get("ADMIN") or iso,
            "c": p.get("CONTINENT") or "Other",
            "s": p.get("SUBREGION") or p.get("CONTINENT") or "Other",
        }
    return out


def main() -> None:
    rows = list(csv.DictReader(SITES.open()))
    reg = regions()

    groups: dict[str, dict] = {}
    unnamed = 0
    for r in rows:
        key = canon(r.get("operator", ""))
        if not key:
            unnamed += 1
            continue
        g = groups.setdefault(key, {
            "key": key, "n": 0, "byCountry": collections.Counter(),
            "spellings": collections.Counter(), "mw": 0.0, "ai": 0,
        })
        g["n"] += 1
        g["byCountry"][r.get("country") or "??"] += 1
        g["spellings"][(r.get("operator") or "").strip()] += 1
        try:
            g["mw"] += float(r.get("power_mw_it") or 0)
        except ValueError:
            pass
        if (r.get("facility_type") or "") == "ai":
            g["ai"] += 1

    out = []
    for g in groups.values():
        # Display name = the spelling the sources use most. This gets "NTT",
        # "GDS" and "STT" right without a hand-written casing table, because
        # the sources already write them that way.
        name = display(g["spellings"].most_common(1)[0][0])
        conts = collections.Counter()
        for iso, n in g["byCountry"].items():
            # world.py leaves UNKNOWN where a point fell outside every 110m
            # polygon - coastal and offshore. Name that honestly rather than
            # burying it in an "Other" bucket alongside real regions.
            conts[reg.get(iso, {}).get("c") or "Unattributed"] += n
        out.append({
            "key": g["key"], "name": name, "n": g["n"], "ai": g["ai"],
            "mw": round(g["mw"], 1),
            "byCountry": dict(g["byCountry"].most_common()),
            "byContinent": dict(conts.most_common()),
            "spellings": len(g["spellings"]),
        })
    out.sort(key=lambda o: (-o["n"], o["name"].lower()))

    # raw -> key, so the Node side never reimplements the collapsing above.
    raw_to_key = {}
    for r in rows:
        raw = (r.get("operator") or "").strip()
        if raw and raw not in raw_to_key:
            k = canon(raw)
            if k:
                raw_to_key[raw] = k

    missing = sorted({r.get("country") for r in rows if r.get("country") not in reg})
    OUT.write_text(json.dumps({
        "regions": reg, "operators": out, "rawToKey": raw_to_key,
    }, separators=(",", ":"), ensure_ascii=False))

    named = len(rows) - unnamed
    print(f"sites {len(rows):,}   with an operator {named:,} ({named / len(rows):.0%})")
    print(f"distinct operator strings {len(raw_to_key):,}  ->  {len(out):,} companies")
    print(f"wrote {OUT.relative_to(ROOT)}  ({OUT.stat().st_size / 1024:.0f} KB)")
    if missing:
        print(f"  countries with no Natural Earth match: {', '.join(m or '(blank)' for m in missing)}")
    print(f"\n{'operator':<28}{'sites':>7}{'AI':>5}{'spellings':>11}  top regions")
    print("-" * 78)
    for o in out[:25]:
        top = ", ".join(f"{c} {n}" for c, n in list(o["byContinent"].items())[:3])
        print(f"{o['name'][:26]:<28}{o['n']:>7}{o['ai']:>5}{o['spellings']:>11}  {top}")


if __name__ == "__main__":
    main()
