"""Collapse facility rows into distinct sites, and stamp a stable site_id.

The registry counts *rows*, and a row is whatever its source mapped: OSM often
draws each building on a campus separately, PeeringDB lists one record per
carrier-neutral facility. Counting rows as facilities inflates the total - the
US reads 2,499 rows but 1,534 distinct sites at 500 m, and the difference is
almost entirely osm<->osm pairs on the same campus.

Two rules, both learned the hard way earlier in this project:

  distance      500 m. Wide enough to join a parcel centroid to a building
                centroid, tight enough that Ashburn's neighbouring operators
                stay separate.
  operator      Rows with *different* known operators never merge, however
                close. Proximity is not identity - the same mistake produced
                "Amazon IAD90 = Google Arcola" in the Epoch join.

site_id is derived from the cluster's rounded centroid, so it is stable across
runs and independent of input order.
"""

from __future__ import annotations

import collections
import csv
import hashlib
import math
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
GLOBAL = ROOT / "data" / "facilities_global.csv"
OUT_SITES = ROOT / "data" / "facilities_sites.csv"

RADIUS_KM = 0.5

SUFFIX = re.compile(
    r"\b(inc|ltd|limited|gmbh|bv|nv|sa|sas|spa|ag|as|oy|ab|plc|llc|corp|corporation"
    r"|group|holdings?|international|europe|deutschland|italia|france|espana|polska"
    r"|hq|cv|spolka|akcyjna|srl|sarl|kg|se)\b", re.I)


def canon_operator(v: str) -> str:
    x = re.sub(r"[.,'`]", " ", (v or "").lower())
    x = re.sub(r"\b(data ?cent(er|re)s?|global data centers division)\b", " ", x)
    x = SUFFIX.sub(" ", x)
    x = " ".join(x.split())
    # Collapse the obvious brand families so "aws" and "amazon web services"
    # are not treated as conflicting operators and blocked from merging.
    for brand in ("amazon", "aws", "google", "microsoft", "meta", "equinix",
                  "digital realty", "qts", "cyrusone", "vantage", "stack",
                  "ntt", "iron mountain", "coresite", "cloudhq", "edgeconnex"):
        if brand in x:
            return {"aws": "amazon"}.get(brand, brand)
    return x


def km(lon_a, lat_a, lon_b, lat_b) -> float:
    return math.hypot((lon_a - lon_b) * 111.32 * math.cos(math.radians((lat_a + lat_b) / 2)),
                      (lat_a - lat_b) * 111.32)


def num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


SUITE = re.compile(
    r"\b(suite|ste|floor|fl|unit|room|rm|bldg|building|level|lvl|no)\b.*$", re.I)


def norm_address(a: str) -> str:
    """A street address reduced to the building it names, suite dropped."""
    a = re.sub(r"[^a-z0-9 ]+", " ", (a or "").lower())
    a = SUITE.sub(" ", a)
    return " ".join(a.split())


def tag_buildings(out: list[dict], rows: list[dict], site_of: dict) -> None:
    """Group sites that are suites in ONE building, without merging them.

    A carrier hotel is many colocation facilities at one street address - 111
    8th Avenue in Manhattan carries six, 36 NE 2nd Street in Miami six more.
    They are genuinely distinct facilities: different operators, different
    customers, separately listed in PeeringDB. But they are one STRUCTURE, and
    for the question this registry exists to answer - what is exposed when
    something hits that address - counting six is wrong by a factor of six.

    So they are grouped, not merged. Merging would delete real facilities;
    leaving them ungrouped overstates the building count. `building` lets a
    reader have it either way.

    Deliberately NOT done in the clustering pass above. That pass refuses to
    merge rows with different known operators, and it is right to: proximity is
    not identity, and relaxing it produced "Amazon IAD90 = Google Arcola". An
    identical street address is a different and much stronger claim than
    proximity, so it gets its own pass rather than a loosened radius.
    """
    addr_of: dict[str, str] = {}
    for r in rows:
        sid = site_of.get(id(r))
        a = norm_address(r.get("address", ""))
        # Longest address wins: sources abbreviate to different depths.
        if sid and len(a) > 8 and len(a) > len(addr_of.get(sid, "")):
            addr_of[sid] = a

    by_addr: dict[tuple, list[str]] = collections.defaultdict(list)
    site = {s["site_id"]: s for s in out}
    for sid, a in addr_of.items():
        by_addr[(a, site[sid].get("country", ""))].append(sid)

    groups = 0
    for (a, _cc), sids in by_addr.items():
        if len(sids) < 2:
            continue
        # Same string, far apart, is a coincidence - "main street" exists
        # everywhere. Require them to actually be the same place.
        located = [s for s in sids if site[s].get("lat") != ""]
        if len(located) >= 2:
            lo = [(float(site[s]["lon"]), float(site[s]["lat"])) for s in located]
            if max(km(x, y, lo[0][0], lo[0][1]) for x, y in lo) > 1.0:
                continue
        bid = "bldg-" + hashlib.sha1(f"{a}|{_cc}".encode()).hexdigest()[:8]
        groups += 1
        for s in sids:
            site[s]["building"] = bid
            site[s]["building_n"] = len(sids)

    for s in out:
        s.setdefault("building", "")
        s.setdefault("building_n", "")
    inflated = sum(len(v) - 1 for v in by_addr.values()
                   if len(v) > 1 and site[v[0]].get("building"))
    print(f"  shared-address buildings: {groups} covering "
          f"{groups + inflated} sites - the registry counts those as "
          f"{groups + inflated} facilities in {groups} structures")


def main() -> None:
    rows = list(csv.DictReader(GLOBAL.open()))
    located = [r for r in rows if r.get("lat")]
    print(f"rows {len(rows):,}   with coordinates {len(located):,}")

    pts = [(float(r["lon"]), float(r["lat"]), canon_operator(r.get("operator", "")), i)
           for i, r in enumerate(located)]
    grid = collections.defaultdict(list)
    for k, (lon, lat, _op, _i) in enumerate(pts):
        grid[(round(lon, 2), round(lat, 2))].append(k)

    parent = list(range(len(pts)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    blocked = 0
    for (gx, gy), idxs in grid.items():
        cand = []
        for dx in (-0.01, 0.0, 0.01):
            for dy in (-0.01, 0.0, 0.01):
                cand += grid.get((round(gx + dx, 2), round(gy + dy, 2)), [])
        for i in idxs:
            for j in cand:
                if j <= i:
                    continue
                if km(pts[i][0], pts[i][1], pts[j][0], pts[j][1]) >= RADIUS_KM:
                    continue
                oi, oj = pts[i][2], pts[j][2]
                if oi and oj and oi != oj:
                    blocked += 1   # different known operators: not the same site
                    continue
                union(i, j)

    clusters = collections.defaultdict(list)
    for k in range(len(pts)):
        clusters[find(k)].append(k)
    print(f"  merges blocked by operator conflict: {blocked:,}")
    print(f"  distinct sites: {len(clusters):,}")

    site_of = {}
    out = []
    seen_ids: dict[str, int] = {}

    def make_id(lon: float, lat: float, op: str) -> str:
        """Stable, position-derived, and unique.

        Operator is part of the key because two clusters deliberately kept
        apart by the operator rule can share a rounded centroid - that alone
        produced 114 duplicate ids. The counter is a last-resort guard so the
        column can be used as a primary key regardless.
        """
        base = "site-" + hashlib.sha1(f"{lon:.4f},{lat:.4f},{op}".encode()).hexdigest()[:10]
        n = seen_ids.get(base, 0)
        seen_ids[base] = n + 1
        return base if n == 0 else f"{base}-{n}"

    for members in clusters.values():
        recs = [located[pts[k][3]] for k in members]
        # A town-level geocode must never drag a site off a building that is
        # known exactly: average the precise members alone when there are any.
        precise = [r for r in recs if (r.get("geo_precision") or "exact") == "exact"]
        basis = precise or recs
        lon = sum(float(r["lon"]) for r in basis) / len(basis)
        lat = sum(float(r["lat"]) for r in basis) / len(basis)
        sid = make_id(lon, lat, pts[members[0]][2])
        for r in recs:
            site_of[id(r)] = sid

        def first(field):
            return next((r[field] for r in recs if r.get(field)), "")

        ai = [r for r in recs if r["facility_type"] == "ai"]
        out.append({
            "site_id": sid,
            # "town" means the coordinate is a settlement or region centroid,
            # not a located building - the map draws those hollow rather than
            # implying a survey it does not have.
            "geo_precision": "exact" if precise else "town",
            # Only if EVERY source row is flagged. A site corroborated by OSM
            # or Epoch is evidenced regardless of what PeeringDB knows about
            # its peering.
            "needs_review": "no_interconnection" if recs and all(
                r.get("needs_review") for r in recs) else "",
            "name": first("name") or first("epoch_name"),
            # Epoch names sites differently from OSM ("Colossus 2" vs "xAI
            # Macrohard Colossus 2"); keep both so the trajectory data joins.
            "epoch_name": first("epoch_name"),
            "operator": first("operator"),
            "country": first("country"),
            "lat": round(lat, 6), "lon": round(lon, 6),
            "rows": len(recs),
            "sources": " ".join(sorted({r["source"] for r in recs})),
            "facility_type": "ai" if ai else "traditional",
            "tenancy": first("tenancy"),
            "status": first("status"),
            # Sum across the cluster: separate AI rows are separate buildings on
            # one campus, so their loads add rather than duplicate.
            "power_mw_total_current": round(sum(num(r.get("power_mw_total_current")) for r in ai), 1) or "",
            "power_mw_total_peak": round(sum(num(r.get("power_mw_total_peak")) for r in ai), 1) or "",
            "utility": first("utility"),
            "ref": first("ref"), "city": first("city"),
        })

    # Un-geocoded rows cannot be clustered, but they are still real facilities.
    # Emitting one site each keeps their capacity in the totals instead of
    # deleting it - 14 Epoch AI sites carrying 1,598 MW were lost this way.
    unlocated = [r for r in rows if not r.get("lat")]
    for r in unlocated:
        sid = "site-nogeo-" + hashlib.sha1(
            f"{r.get('epoch_name') or r.get('name')}|{r.get('country')}".encode()).hexdigest()[:8]
        site_of[id(r)] = sid
        is_ai = r["facility_type"] == "ai"
        out.append({
            "site_id": sid,
            # No coordinate at all, so there is no precision to report - and
            # `precise`/`recs` here would be whatever the clustered loop above
            # happened to leave behind, which is a different site entirely.
            "geo_precision": "",
            "needs_review": r.get("needs_review", ""),
            "name": r.get("name") or r.get("epoch_name", ""),
            "epoch_name": r.get("epoch_name", ""),
            "operator": r.get("operator", ""), "country": r.get("country", ""),
            "lat": "", "lon": "", "rows": 1, "sources": r["source"],
            "facility_type": r["facility_type"], "tenancy": r.get("tenancy", ""),
            "status": r.get("status", ""),
            "power_mw_total_current": num(r.get("power_mw_total_current")) or "" if is_ai else "",
            "power_mw_total_peak": num(r.get("power_mw_total_peak")) or "" if is_ai else "",
            "utility": r.get("utility", ""), "ref": r.get("ref", ""), "city": r.get("city", ""),
        })
    if unlocated:
        print(f"  un-geocoded rows carried through as sites: {len(unlocated)}")

    tag_buildings(out, rows, site_of)

    with OUT_SITES.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(sorted(out, key=lambda r: (r["country"], r["name"])))
    print(f"wrote {OUT_SITES.relative_to(ROOT)}  ({len(out):,} sites)")

    # Stamp site_id back onto the row-level file so the two can be joined.
    cols = list(rows[0].keys())
    if "site_id" not in cols:
        cols.append("site_id")
    for r in rows:
        r["site_id"] = site_of.get(id(r), "")
    with GLOBAL.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print(f"  stamped site_id onto {GLOBAL.name}")

    multi = sum(1 for r in out if r["rows"] > 1)
    print(f"\n  sites built from >1 row: {multi:,}")
    print(f"  US rows {sum(1 for r in rows if r['country'] == 'US'):,} "
          f"-> sites {sum(1 for r in out if r['country'] == 'US'):,}")


if __name__ == "__main__":
    main()
