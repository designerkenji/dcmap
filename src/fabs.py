"""Build the semiconductor fab layer.

    python3 fabs.py

WHY THIS ONE IS HAND-BUILT AND THE OTHER LAYERS ARE NOT
Power plants came from two public inventories. Fabs have no equivalent, and
that is not for want of looking. Seven candidate sources were probed:

  SEMI World Fab Forecast   the authoritative one. US$11,100/yr.
  Wikipedia fab list        477 operating fabs with node and wafer size, and
                            NO COORDINATES. CC BY-SA, share-alike.
  Wikidata                  CC0 and real coordinates, but 55 items, mostly
                            Soviet-era. Zero TSMC, Samsung, Micron, SK Hynix.
  SIA US fab map            118 US sites with coordinates, no licence stated,
                            copyright asserted.
  CHIPS Act awards          47 US sites, public domain, no coordinates.
  OpenStreetMap             152 objects, ODbL share-alike.
  CSET / ETO                no facilities at all, and CC BY-NC.

They are complementary in exactly the wrong way: the one with the rows has no
geometry and a viral licence, and the one with the clean licence has no rows.
Joining them carries the share-alike into the merged table regardless of which
half the coordinates came from.

So the Wikipedia page was used as a WORKLIST OF NAMES - names are facts, not
protectable expression - and every value here was then sourced independently
from company disclosures, CHIPS Act filings and official plant pages, with the
URL kept per record in `src`. Nothing was copied across from the worklist.

A SECOND PASS took the layer from 90 fabs to 214, over the 252 names on that
worklist the first pass had not reached. Same method, made structural: the
researchers were handed company/plant/location and NOT the list's own spec
columns, so there was nothing to copy even by accident.

118 of the 252 were rejected, which is the more interesting half. They are kept
with their reasons in data/fabs_rejected.json - 28 that could not be located to
a building, 24 back-end packaging or test sites rather than front-end fabs, 11
not fabs at all, 10 closed, 10 the same site listed again under a former owner.
That file exists so the next pass does not re-research them; the count is also
the honest measure of what a public fab list is worth without verification.

Coverage is now weighted very differently. The first pass was leading-edge
heavy - 71 of 90 at 300 mm - because that is what gets written about. The
second added mostly 200 mm and 150 mm lines, which is where most of the world's
fabs actually are, and took the layer from 13 countries to 23.

ALMOST NO FAB PUBLISHES ITS ELECTRICITY DEMAND - BUT THE CARBON FILINGS DO
The first pass concluded "not one". TSMC, Samsung and Intel publish
company-wide GWh and never break it out by site, and the only per-fab figure it
found anywhere was TSMC Arizona at roughly 200 MW, from trade press quoting the
utility rather than from either party.

That conclusion was too strong, and the second pass found the way round it.
Taiwanese fabs publish BSI- and DNV-verified ISO 14064-1 greenhouse-gas
inventories per SITE, and those state Category 2 / Scope 2 emissions from
imported electricity. Divided by Taiwan's published grid factor (0.474
kgCO2/kWh for 2024) that is a per-fab annual consumption, third-party verified,
from the operator's own filing. Epistar's eight factories and AWSC's Nanke
plant are all sourced this way, and Europe has an equivalent in the EMAS
statement, which gave Micronas Freiburg's 99 GWh site total outright.

So the honest statement is: nobody publishes a fab's MW as a MW, and a growing
number publish something you can divide into one. `mw` in this file is still
ESTIMATED from the wafer model, always, and labelled as an estimate everywhere
it is shown - deriving it from carbon disclosures is a per-record research
finding kept in powerNote, not a second model. See the model below and believe
it to within about a factor of two.
"""

from __future__ import annotations

import collections
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "fabs_sourced.json"      # what the research pass produced
OUT = ROOT / "data" / "fabs.json"

# ---- the power model --------------------------------------------------------
# MW = wspm x 12 x k(node) x (wafer/300)^2 / 8760 / 1000
#
# k is kWh per 300 mm wafer and is where all the uncertainty lives. Two anchors
# are real and the rest are interpolation:
#
#   6,000 kWh/wafer at <=5 nm. Back-solved from the one published per-fab
#   figure - TSMC Arizona at ~200 MW against a press-reported 20,000 wspm:
#   200 MW x 8760 h x 0.92 / (20,000 x 12) = 6,716. Rounded DOWN because the
#   denominator is press-reported and the 200 MW may include site loads beyond
#   the fab shell.
#
#   1,692 kWh/wafer for TSMC's whole fleet, from TSMC's own annual report:
#   28,756 GWh over 17M 12-inch-equivalent wafers. Fully cited, and the WRONG
#   number for any single leading-edge fab - it blends four GIGAFABs with
#   8-inch and 6-inch lines.
#
# The three middle values are engineering judgement on the roughly-doubling-
# per-node trend between those two. They are not citable and the UI says so.
K_NODE = [
    (5,    6000),    # <=5 nm
    (16,   2200),    # 7-16 nm
    (65,    800),    # 28-65 nm
    (10**9, 450),    # >=90 nm
]

# Fabs run flat out. APS's own rate-class threshold for TSMC Arizona is 92%,
# which is why average and peak are within ~10% here and a data centre needs a
# separate peak model while a fab does not.
LOAD_FACTOR = 0.92


# The research returns the LEGAL operator, which is the right thing to record
# and the wrong thing to group by: TSMC runs Fab 18 as itself, Kumamoto through
# JASM, Dresden through ESMC, Arizona through TSMC Arizona Corporation and
# Singapore through SSMC. Grouped on the legal name that is five companies with
# one fab each, and the question "who runs the most fabs" gets a wrong answer.
#
# So `grp` is the parent everyone means, matched on the first pattern that hits.
# Order matters: the JV names are tested before their parents.
GROUP = [
    (r"jasm|japan advanced semiconductor|esmc|european semiconductor manufacturing"
     r"|ssmc|systems on silicon|tsmc|taiwan semiconductor", "TSMC"),
    (r"usjc|united semiconductor|united microelectronics|\bumc\b", "UMC"),
    (r"globalfoundries|global ?foundries", "GlobalFoundries"),
    (r"samsung", "Samsung"),
    (r"sk ?hynix", "SK hynix"),
    (r"micron", "Micron"),
    # Before Intel deliberately: "SpaceX, with Tesla and Intel" names Intel as
    # a partner, and first-match would file the biggest announced fab in the
    # world under a company that is contributing process technology to it.
    (r"terafab|spacex|\btesla\b", "Terafab"),
    (r"\bintel\b", "Intel"),
    (r"kioxia|toshiba memory", "Kioxia"),
    (r"texas instruments", "Texas Instruments"),
    (r"smic|semiconductor manufacturing international", "SMIC"),
    (r"hua ?hong|hlmc", "Hua Hong"),
    (r"infineon", "Infineon"),
    (r"stmicro", "STMicroelectronics"),
    (r"\bbosch\b", "Bosch"),
    (r"nanya", "Nanya"),
    (r"winbond", "Winbond"),
    (r"powerchip|psmc", "Powerchip"),
    (r"vanguard|\bvis\b", "Vanguard"),
    (r"\bymtc\b|yangtze", "YMTC"),
    (r"\bcxmt\b|changxin", "CXMT"),
    (r"nexchip", "Nexchip"),
    (r"cansemi", "CanSemi"),
    (r"rapidus", "Rapidus"),
    (r"\bsony\b", "Sony"),
    (r"renesas", "Renesas"),
    (r"tower semi", "Tower"),
    (r"wolfspeed", "Wolfspeed"),
    # \b anchored. Unanchored, "on semiconductor" matches INSIDE "Global
    # Communicati|on Semiconductor|s, LLC" and filed an independent GaAs
    # foundry in Torrance under onsemi.
    (r"\bonsemi\b|\bon semiconductor", "onsemi"),
    (r"skywater", "SkyWater"),
    (r"polar semi", "Polar"),
    # VSMC is the Vanguard/NXP JOINT VENTURE in Singapore. The bare "nxp"
    # alternative that used to sit here filed NXP's own fabs - Nijmegen ICN8,
    # Austin ATMC - under the JV they are not part of. NXP is its own company
    # and gets its own group; the JV is matched by its own name.
    (r"\bvsmc\b|visionpower", "VSMC"),
    (r"\bnxp\b", "NXP"),
    (r"x-?fab", "X-FAB"),
    (r"analog devices", "Analog Devices"),
]


def group_of(operator: str) -> str:
    o = (operator or "").lower()
    for pat, name in GROUP:
        if re.search(pat, o):
            return name
    # Fall back to the legal name's first clause rather than the whole thing -
    # an ungrouped operator is still better as "Foo Inc" than as forty words.
    return re.split(r"[,(]", operator or "Unknown")[0].strip() or "Unknown"


def short_place(place: str, country: str) -> str:
    """The last couple of meaningful parts of an address, without the country.

    Some records came back with a full street address and some with a city, so
    a table column has to be given one shape. Keeping the TAIL rather than the
    head is what makes them comparable: the tail is the city and the park, and
    the head is a house number nobody is reading in a table.
    """
    parts = [p.strip() for p in re.split(r"[,/]", place or "") if p.strip()]
    # Drop a trailing country, which most records repeat and one repeats twice.
    names = {v.lower() for v in COUNTRY_NAME.values()}
    while parts and parts[-1].lower() in names:
        parts.pop()
    # And drop postcodes. They arrive two ways - as their own part, and glued
    # to the city ("Tainan 744092"), which the fullmatch alone did not catch.
    parts = [p for p in parts if not re.fullmatch(r"[\d\-\s]{4,12}", p)]
    parts = [re.sub(r"\s+[\d][\d\-\s]{3,}$", "", p).strip() for p in parts]
    return ", ".join(parts[-2:])


# Only used to STRIP a trailing country from a place string, so a code missing
# here is cosmetic - the country simply survives into the table column. It has
# to keep pace with the layer's coverage all the same: the second research pass
# took this from 13 countries to 23, and every one it did not know left "United
# Kingdom" or "Russia" repeated in a column that already has a country beside it.
COUNTRY_NAME = {
    "TW": "Taiwan", "CN": "China", "JP": "Japan", "KR": "South Korea",
    "US": "United States", "DE": "Germany", "FR": "France", "IT": "Italy",
    "AT": "Austria", "IE": "Ireland", "SG": "Singapore", "MY": "Malaysia",
    "IL": "Israel", "GB": "United Kingdom", "RU": "Russia", "CH": "Switzerland",
    "IN": "India", "NL": "Netherlands", "CA": "Canada", "FI": "Finland",
    "CZ": "Czechia", "BY": "Belarus", "BR": "Brazil",
}


def k_for(node_nm: float | None) -> int:
    # No node means no estimate. Guessing the node dominates every other error
    # in this model - k spans more than an order of magnitude across the range -
    # so an unknown node has to produce an unknown MW, not a middle guess.
    if not node_nm:
        return 0
    for cut, k in K_NODE:
        if node_nm <= cut:
            return k
    return K_NODE[-1][1]


def estimate_mw(wspm, node_nm, wafer_mm) -> int:
    if not wspm or not wafer_mm:
        return 0
    k = k_for(node_nm)
    if not k:
        return 0
    area = (wafer_mm / 300.0) ** 2
    kwh_year = wspm * 12 * k * area
    return round(kwh_year / 8760 / 1000 / LOAD_FACTOR)


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"{SRC.relative_to(ROOT)} not found - run the research pass first")
    raw = json.loads(SRC.read_text())

    out, dropped = [], []
    for r in raw:
        # A fab with no coordinate is not a map layer's problem to solve. The
        # research pass was told to return null rather than guess, so a null
        # here means nobody could establish one - which is a better outcome
        # than a dot on the right city and the wrong site.
        if r.get("lat") is None or r.get("lon") is None:
            dropped.append(f"{r.get('name')} - no coordinate established")
            continue
        if r.get("confidence") == "low":
            dropped.append(f"{r.get('name')} - low confidence")
            continue
        # ANNOUNCED FABS GET NO ESTIMATE. Their wafer figure is a target, not a
        # capacity, and running it through the model produces a load for a
        # building nobody has poured concrete for. Terafab's 1M wspm at 1.4 nm
        # comes out at ~8,900 MW - five times the entire rest of this layer -
        # which on a map reads as the largest thing in the world rather than as
        # somebody's 2030 ambition.
        mw = 0 if r.get("status") == "announced" else \
            estimate_mw(r.get("wspm"), r.get("nodeNm"), r.get("waferMm"))
        rec = {
            "id": "f" + str(len(out) + 1).rjust(3, "0"),
            "n": r["name"], "op": r["operator"], "grp": group_of(r["operator"]),
            "lat": round(float(r["lat"]), 5), "lon": round(float(r["lon"]), 5),
            "cy": r.get("country", ""),
            "pl": short_place(r.get("place", ""), r.get("country", "")),
            "k": r.get("status", "operating"),
        }
        for key, val in (("nm", r.get("nodeNm")), ("wf", r.get("waferMm")),
                         ("ws", r.get("wspm")), ("y", r.get("startYear"))):
            if val:
                rec[key] = val
        if mw:
            # est: this number was computed, not read. Every surface that shows
            # it has to say so, which is why it travels as its own flag rather
            # than being inferred from the absence of something else.
            rec["mw"] = mw
            rec["est"] = 1
        # Only a note that contains an actual NUMBER earns its bytes. Every one
        # of the 79 records came back with a powerNote and 78 of them say some
        # variant of "no per-fab figure is published" - which is the finding,
        # not per-record data, and belongs in this file's docstring rather than
        # 78 times in the payload.
        note = r.get("powerNote") or ""
        # A note earns its bytes if it carries a NUMBER or says something about
        # how the site is powered. "Islanded, own gas turbines, not on ERCOT" is
        # the most important sentence in this whole dataset and has no digits.
        if re.search(r"\b\d[\d,.]*\s*(MW|GWh|MWh|kWh)\b", note) or \
           re.search(r"island|off-grid|own .*(gas|generation)|not connect", note, re.I):
            rec["pn"] = note[:240]
        # A status note is the record admitting what it does not know, or what
        # is contested. Taylor Fab 1 is the reason this exists: three sources
        # gave three different production dates in one month and the honest
        # record is the disagreement, not a pick.
        if r.get("statusNote"):
            rec["nt"] = r["statusNote"][:320]
        # Announced investment, US$ MILLIONS - the unit every layer's `inv`
        # uses, because the map paints sites, plants and fabs on one shared
        # project-value ramp. Unlike `mw` this is never modelled: it is a
        # figure somebody announced, with its URL kept, or it is absent. The
        # note says what the figure covers - which phases, original currency,
        # announced when - because "$65bn" bare either overstates a first
        # phase or understates a campus, depending on which was announced.
        if r.get("investmentUsdM"):
            rec["inv"] = round(r["investmentUsdM"])
            if r.get("investmentNote"):
                rec["invn"] = r["investmentNote"][:280]
        srcs = [s for s in (r.get("sources") or []) if s.startswith("http")][:3]
        srcs += [s for s in (r.get("investmentSources") or [])
                 if s.startswith("http") and s not in srcs][:2]
        if srcs:
            rec["src"] = srcs
        out.append(rec)

    # FAB NAMES ARE NOT UNIQUE ACROSS COMPANIES. GlobalFoundries and TSMC both
    # run a "Fab 8", TSMC and Vanguard both a "Fab 5". A set keyed on the bare
    # name silently swallowed TSMC's Fab 8 when it was added, which is the worst
    # kind of failure: a missing record and no error. Disambiguate by the parent
    # so the name a reader sees is unambiguous, and say which ones collided.
    seen = collections.Counter(r["n"] for r in out)
    clashed = sorted(n for n, c in seen.items() if c > 1)
    for r in out:
        if seen[r["n"]] > 1:
            r["n"] = f'{r["n"]} ({r["grp"]})'

    out.sort(key=lambda r: -(r.get("mw") or 0))
    OUT.write_text(json.dumps(out, separators=(",", ":")))

    by_k = collections.Counter(r["k"] for r in out)
    by_cy = collections.Counter(r["cy"] for r in out)
    by_grp = collections.Counter(r["grp"] for r in out)
    est = [r for r in out if r.get("mw")]
    print(f"fabs kept: {len(out)}   dropped: {len(dropped)}")
    if clashed:
        print(f"  names shared by more than one company, disambiguated: {', '.join(clashed)}")
    for d in dropped:
        print(f"    {d}")
    print(f"  status: " + " · ".join(f"{k} {v}" for k, v in by_k.most_common()))
    print(f"  countries: " + " · ".join(f"{k} {v}" for k, v in by_cy.most_common(8)))
    print(f"  groups: {len(by_grp)}   " + " · ".join(f"{k} {v}" for k, v in by_grp.most_common(7)))
    print(f"  with an estimated MW: {len(est)} of {len(out)}"
          f"   total {sum(r['mw'] for r in est):,} MW (ESTIMATED, +/- a factor of two)")
    published = sum(1 for r in out if r.get("pn"))
    # Was "expected 0". The carbon-filing route described in the docstring is
    # what moved this off zero, so a count that climbs here is the research
    # working rather than something going wrong.
    print(f"  with a power note worth keeping: {published}"
          f"   (mostly Scope 2 filings divided by a grid factor, not published MW)")
    invd = [r for r in out if r.get("inv")]
    if invd:
        print(f"  with an announced investment: {len(invd)} of {len(out)}"
              f"   total US${sum(r['inv'] for r in invd) / 1000:,.0f}bn announced")
    print(f"wrote {OUT.relative_to(ROOT)}  ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
