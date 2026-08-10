"""Join harvested operator pages to registry sites, and refuse to guess.

    python3 match_site_links.py [--audit]

Reads data/operator_site_links.json (what each operator publishes about each of
its campuses) and data/facilities_sites.csv, and writes data/site_links.json:

    {"site-1a2b3c": {"url": "...", "name": "Berlin II", "via": "ordinal"}}

THE DESIGN CONSTRAINT IS THAT A WRONG LINK IS WORSE THAN NO LINK
Sending someone from our "Vantage Santa Clara CA2" dot to Vantage's Santa Clara
*I* page states something false about a real building, and it looks
authoritative because it is the operator's own site. So the matcher only emits
a link when it can name the reason:

    code      our name carries the operator's facility code and their page
              says the same code                             - strongest
    ordinal   same city AND the same campus number, Roman or Arabic, so two
              campuses in one metro cannot swap
    name      our name carries their city and only one of their pages does -
              covers sites named for a metro but sited in its suburbs
    city      exactly ONE published campus in that city, so there is nothing
              to confuse it with
    country   one apiece in the whole country - weak in the US, decisive in
              Poland, and the only thing that bridges Warszawa/Warsaw
    manual    a person said so, from data/manual_links.csv - always wins, and
              is the only route for pages no scraper can reach at all

Anything else is left unmatched on purpose. Ambiguous metros - Vantage has two
campuses in Santa Clara and three around Ashburn - resolve to nothing, and the
detail page falls back to the operator's location index, which is honest about
what we do and do not know.

TWO RULES THAT EXIST BECAUSE THE FIRST VERSION GOT IT WRONG
-----------------------------------------------------------
Mismatched codes REJECT. Equinix MD6 and Equinix "Madrid MD1" are both in
Madrid and are not the same building. A code on both sides that disagrees is
positive evidence of a different facility, not weak evidence of the same one -
without this the city tier linked MD6->MD1, ML4->ML2 and MAD3->MAD1, all
confidently and all wrong.

A capped harvest cannot use the absence-based tiers. `city` and `country`
argue from "there is no other candidate", which is only sound if the list is
complete. Five operators here were truncated at 60 pages, so their apparent
uniqueness was an artifact of truncation. Those two tiers are switched off for
them; `code` and `ordinal` argue from positive evidence and still hold.
Enforcing this dropped 113 links, every one of which would have been wrong.
"""

from __future__ import annotations

import csv
import json
import pathlib
import re
import sys
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
from operators import canon                                   # noqa: E402

SITES = ROOT / "data" / "facilities_sites.csv"
HARVEST = ROOT / "data" / "operator_site_links.json"
OUT = ROOT / "data" / "site_links.json"
MANUAL_LINKS = ROOT / "data" / "manual_links.csv"

ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6}

# Words that appear on both sides and carry no identity.
FILLER = re.compile(
    r"\b(data|center|centre|centers|centres|campus|campuses|the|a|inc|llc|ltd"
    r"|facility|colocation|dc)\b", re.I)


def norm(s: str) -> str:
    # Strip accents first: our cities come from OSM as "Québec" and "Montréal",
    # and a naive [^a-z] scrub turns those into "qu bec" and "montr al", which
    # match nothing. This silently cost two correct links.
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9 ]+", " ", s.lower())
    return " ".join(FILLER.sub(" ", s).split())


def ordinal_of(s: str) -> int | None:
    """The campus number: "Berlin II" -> 2, "Hillsboro 1" -> 1.

    Both notations are in use and often by the same operator, so only reading
    Roman numerals left every Arabic-numbered campus ambiguous - QTS, NTT and
    CyrusOne number almost everything that way. Only a STANDALONE small integer
    counts: "FRA1" and "DC2" are facility codes, not campus numbers, and tier 1
    already handles those.
    """
    for t in norm(s).split():
        if t in ROMAN:
            return ROMAN[t]
        if t.isdigit() and 1 <= len(t) <= 2 and 1 <= int(t) <= 20:
            return int(t)
    return None


def codes_of(s: str) -> set[str]:
    """Operator facility codes like VA2, FRA21, ZRH1, BER11, WAW1, TX22."""
    return {m.upper() for m in re.findall(r"\b([A-Za-z]{2,4}\d{1,2})\b", s or "")}


COUNTRY = {
    "usa": "US", "united states": "US", "canada": "CA", "germany": "DE",
    "switzerland": "CH", "italy": "IT", "poland": "PL", "netherlands": "NL",
    "united kingdom": "GB", "ireland": "IE", "france": "FR", "spain": "ES",
    "sweden": "SE", "norway": "NO", "denmark": "DK", "finland": "FI",
    "austria": "AT", "belgium": "BE", "japan": "JP", "australia": "AU",
    "singapore": "SG", "malaysia": "MY", "hong kong": "HK", "taiwan": "TW",
    "south africa": "ZA", "india": "IN", "brazil": "BR", "mexico": "MX",
}


def country_of(addr: str, slug: str) -> str:
    """ISO2 from the tail of a published address, else from the slug's tail."""
    parts = [norm(p) for p in (addr or "").split(",") if p.strip()]
    if parts and parts[-1] in COUNTRY:
        return COUNTRY[parts[-1]]
    tail = " ".join((slug or "").split("-")[-3:]).replace("-", " ")
    for name, cc in COUNTRY.items():
        if name in tail:
            return cc
    return ""


def addr_haystack(addr: str) -> str:
    """The address as searchable words, digits dropped.

    Deliberately NOT "extract the city". Published addresses put the city at a
    different comma position every time - "Brandenburg Park, Uferring 5,
    Ludwigsfelde, 14974, Germany" has it third, "Goethering 27, 63067 Offenbach
    am Main, Germany" has it second and glued to a postcode. Picking an index
    got both wrong. Asking "does OUR city appear anywhere in here" is the
    question we actually have, and it has one answer.
    """
    return " " + re.sub(r"\d+", " ", norm(addr)) + " "


def city_of_slug(slug: str) -> str:
    """'santa-clara-i-california' -> 'santa clara'; drops ordinal and region."""
    toks = [t for t in (slug or "").split("-") if t]
    out = []
    for t in toks:
        if t in ROMAN:
            break
        out.append(t)
    return norm(" ".join(out))


def main() -> None:
    audit = "--audit" in sys.argv
    if not HARVEST.exists():
        raise SystemExit("run operator_site_links.py first")
    harvest = json.loads(HARVEST.read_text())
    rows = list(csv.DictReader(SITES.open()))

    links, stats = {}, {"code": 0, "ordinal": 0, "name": 0, "city": 0, "country": 0}
    unmatched_sites, ambiguous = [], []

    for key, block in harvest.items():
        pub = []
        for s in block["sites"]:
            pub.append({
                **s,
                "hay": addr_haystack(s.get("address", "")),
                "slug_city": city_of_slug(s.get("slug", "")),
                "ord": ordinal_of(s.get("name", "")) or ordinal_of(s.get("slug", "")),
                "codes": codes_of(s.get("name", "")),
                "cc": country_of(s.get("address", ""), s.get("slug", "")),
            })
        # A capped harvest is a TRUNCATED list, so "the only campus in that
        # city" may just mean the others were not fetched. Tiers 3 and 4 argue
        # from absence and are therefore unsound here; tiers 1 and 2 argue from
        # positive evidence and still hold.
        capped = bool(block.get("capped"))
        mine = [r for r in rows if canon(r.get("operator", "")) == key]

        def in_city(p, city):
            """Our city named in their address, or either city containing the other.

            Containment rather than equality because the two sides label the
            same place at different grain: their slug says "quebec city canada"
            where OSM says "Quebec". The ordinal test runs first, so this cannot
            collapse Santa Clara I and II into each other.
            """
            if not city:
                return False
            if f" {city} " in p["hay"]:
                return True
            a, b = f" {p['slug_city']} ", f" {city} "
            return bool(p["slug_city"]) and (b in a or a in b)

        for r in mine:
            name = r.get("name") or r.get("epoch_name") or ""
            my_city = norm(r.get("city", ""))
            my_ord = ordinal_of(name)
            my_codes = codes_of(name)
            my_cc = (r.get("country") or "").upper()

            hit = via = None

            # A code on BOTH sides that does not match is positive evidence of
            # a DIFFERENT building, not weak evidence of the same one. Equinix
            # MD6 and Equinix "Madrid MD1" are both in Madrid and are not the
            # same facility; without this the city tier confidently linked them.
            def compatible(p):
                return not (my_codes and p["codes"] and not (my_codes & p["codes"]))

            # 1. facility code on both sides
            shared = [p for p in pub if p["codes"] & my_codes]
            if len(shared) == 1:
                hit, via = shared[0], "code"

            # 2. same city AND same ordinal
            if not hit and my_ord:
                c = [p for p in pub if p["ord"] == my_ord and in_city(p, my_city)
                     and compatible(p)]
                if len(c) == 1:
                    hit, via = c[0], "ordinal"

            # 2b. no city on our side, but our NAME carries their city + ordinal
            if not hit and my_ord:
                c = [p for p in pub if p["ord"] == my_ord and p["slug_city"]
                     and f" {p['slug_city']} " in f" {norm(name)} " and compatible(p)]
                if len(c) == 1:
                    hit, via = c[0], "ordinal"

            # 2c. our NAME carries their city, and only one candidate has it.
            #     Operators name a site for the metro it serves while the site
            #     itself sits in a suburb: "nLighten Berlin BER1" is in
            #     Kleinmachnow, "nLighten Cologne CGN1" in Hurth. The city field
            #     cannot bridge that and no address is published to do it, but
            #     the name says Berlin and exactly one of their pages is Berlin.
            #     Absence-based like tier 3, so capped operators are excluded.
            if not hit and not capped:
                c = [p for p in pub if p["slug_city"]
                     and f" {p['slug_city']} " in f" {norm(name)} " and compatible(p)]
                if len(c) == 1:
                    hit, via = c[0], "name"

            # 3. exactly one published campus in that city
            if not hit and my_city and not capped:
                c = [p for p in pub if in_city(p, my_city) and compatible(p)]
                if len(c) == 1:
                    hit, via = c[0], "city"
                elif len(c) > 1:
                    ambiguous.append((r["site_id"], name, my_city, [p["slug"] for p in c]))

            # 4. one apiece in the whole country. Weak in the US, decisive in
            #    Poland - and it is the only thing that bridges an exonym like
            #    Warszawa/Warsaw without a hand-written alias table.
            if not hit and my_cc and not capped:
                theirs = [p for p in pub if p["cc"] == my_cc and compatible(p)]
                ours = [x for x in mine if (x.get("country") or "").upper() == my_cc]
                if len(theirs) == 1 and len(ours) == 1:
                    hit, via = theirs[0], "country"

            if hit:
                links[r["site_id"]] = {"url": hit["url"], "name": hit["name"],
                                       "operator": key, "via": via}
                stats[via] += 1
            else:
                unmatched_sites.append((key, r["site_id"], name, r.get("city", "")))

    # Hand-added links win. This file only ever contains links a person
    # asserted, usually because no scraper could have found them - the
    # datacenters.com page for Microsoft Quincy sits behind a bot wall - and a
    # derived guess must never quietly displace someone's knowledge.
    manual = 0
    if MANUAL_LINKS.exists():
        for r in csv.DictReader(MANUAL_LINKS.open()):
            links[r["site_id"]] = {"url": r["url"], "name": r.get("label") or r["url"],
                                   "operator": "", "via": "manual"}
            manual += 1

    OUT.write_text(json.dumps(links, indent=1, ensure_ascii=False, sort_keys=True))

    pub_total = sum(len(b["sites"]) for b in harvest.values())
    mine_total = sum(1 for r in rows
                     if canon(r.get("operator", "")) in harvest)
    print(f"published campuses harvested : {pub_total}")
    print(f"our sites for those operators: {mine_total}")
    print(f"linked                       : {len(links)}  "
          f"(code {stats['code']}, ordinal {stats['ordinal']}, name {stats['name']}, "
          f"city {stats['city']}, country {stats['country']})")
    if manual:
        print(f"hand-added links (override any derived one): {manual}")
    print(f"left unlinked on purpose     : {mine_total - len(links)}")
    if ambiguous:
        print(f"\nambiguous - more than one campus in the city, so no link emitted "
              f"({len(ambiguous)}):")
        for sid, name, city, slugs in ambiguous:
            print(f"   {name[:32]:<34}{city:<18}-> {', '.join(slugs)}")
    if audit:
        print("\nevery link, for eyeballing:")
        for sid, v in sorted(links.items(), key=lambda kv: kv[1]["via"]):
            src = next(r for r in rows if r["site_id"] == sid)
            print(f"   [{v['via']:<7}] {(src['name'] or src['epoch_name'] or '')[:30]:<32}"
                  f"-> {v['url'][-52:]}")
        print("\nunlinked:")
        for key, sid, name, city in unmatched_sites:
            print(f"   {key:<12}{name[:32]:<34}{city}")
    print(f"\nwrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
