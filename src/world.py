"""Attribute the global OSM pull to countries, and rank regions to work next.

`osm.py world` returns every mapped data center on the planet but OSM's
addr:country tag is only ~5% populated, so country has to come from geometry.

WHY 10m AND NOT 110m
110m was used first, on the reasoning that countries are large relative to
the coordinate precision here and the only cost is "a handful of coastal
misses". That was wrong in a way that mattered, because data centres are
built on exactly the land 110m generalises away - reclaimed waterfront,
islands, and city-states:

  90 sites landed in UNKNOWN, every one of them coastal - Cornwall,
     Kerala, Hokkaido, Madagascar, Hong Kong.
  Singapore has NO polygon at 110m at all, so its sites fell inside
     Malaysia's. Global Switch and Google both had Singapore data centres
     filed under MY.
  Plan-les-Ouates, in Geneva canton, was filed under France.

10m is only used for point-in-polygon here, never rendered, so the reason
basemap.py's 10m coastline is unusable in the browser does not apply.

Points that still match nothing get snapped to the nearest country within
SNAP_KM. That is not a fudge: a data centre 1.8 km off Hong Kong's 10m
outline is on reclaimed land the outline predates, and the next nearest
country is 25 km away. Beyond SNAP_KM the coordinate is more likely wrong
than the boundary, so it stays UNKNOWN.

The point of this file is sequencing. The Virginia pipeline has three tiers of
portability, and only the first is global:

  global   OSM locations, operators, facility refs        (this file)
  US-wide  IM3 Atlas footprints, EPA ECHO air permits
  local    county permits, state air permits, utility
           service territories, RTO/ISO load filings

So a worldwide list answers "where and who", not "how much power and from
which utility". Those need a per-jurisdiction build, which is why this ranks
countries by how much is already mapped.
"""

from __future__ import annotations

import collections
import csv
import json
import math
import pathlib
import urllib.request

import geo

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
NE = RAW / "ne_countries_10m.geojson"
NE_URL = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
          "master/geojson/ne_10m_admin_0_countries.geojson")

# A point further than this from every land polygon is treated as a bad
# coordinate rather than an offshore site.
SNAP_KM = 25.0


def boundaries() -> dict:
    if not NE.exists():
        req = urllib.request.Request(NE_URL, headers={"User-Agent": "reinsurance_dc-research/1.0"})
        with urllib.request.urlopen(req, timeout=180) as r:
            NE.write_bytes(r.read())
    return json.loads(NE.read_text())


def _rings(geom: dict) -> list:
    c = (geom or {}).get("coordinates") or []
    if (geom or {}).get("type") == "Polygon":
        return list(c)
    if (geom or {}).get("type") == "MultiPolygon":
        return [r for poly in c for r in poly]
    return []


def nearest_iso(lon: float, lat: float, feats: list) -> tuple[str, float]:
    """Closest country polygon to a point that is inside none of them.

    Bbox-prefiltered: only features whose bounding box comes within SNAP_KM
    are measured vertex by vertex, which keeps this cheap enough to run on
    every unmatched point rather than a sample.
    """
    deg = SNAP_KM / 111.32
    best_iso, best_km = "", float("inf")
    for ft in feats:
        iso = (ft.get("properties") or {}).get("ISO_A2")
        if not iso or iso == "-99":
            continue
        rings = _rings(ft.get("geometry") or {})
        if not rings:
            continue
        xs = [p[0] for r in rings for p in r]
        ys = [p[1] for r in rings for p in r]
        if not xs or lon < min(xs) - deg * 2 or lon > max(xs) + deg * 2 \
           or lat < min(ys) - deg or lat > max(ys) + deg:
            continue
        cos = math.cos(math.radians(lat))
        m = min(((x - lon) * 111.32 * cos) ** 2 + ((y - lat) * 111.32) ** 2
                for r in rings for x, y in r)
        if m < best_km ** 2:
            best_km, best_iso = math.sqrt(m), iso
    return (best_iso, best_km) if best_km <= SNAP_KM else ("", best_km)


def main() -> None:
    src = ROOT / "data" / "osm_world.csv"
    if not src.exists():
        raise SystemExit("run `python3 osm.py world` first")
    rows = list(csv.DictReader(src.open()))

    ne = boundaries()
    # Natural Earth sets ISO_A2 to "-99" for France, Norway and a few others
    # (its handling of overseas/disputed territory), while ISO_A2_EH carries the
    # real code. Preferring ISO_A2 alone left 373 facilities labelled "France"
    # or "Norway" instead of FR/NO, which then failed every ISO2 join.
    for ft in ne.get("features", []):
        pr = ft.get("properties") or {}
        code = pr.get("ISO_A2")
        if not code or code == "-99":
            eh = pr.get("ISO_A2_EH")
            if eh and eh != "-99":
                pr["ISO_A2"] = eh
        # Taiwan appears as CN-TW in some NE builds.
        if pr.get("ISO_A2") == "CN-TW":
            pr["ISO_A2"] = "TW"
    idx = geo.PolygonIndex(ne, "ISO_A2")
    # ISO_A2 is "-99" for a few entries (Kosovo, N. Cyprus, Somaliland); fall
    # back to the admin name so those are labelled rather than silently binned.
    #
    # At 10m one ISO code covers many features - FR is France, Clipperton
    # Island, French Guiana and more - so a plain last-one-wins dict labelled
    # 374 French sites "Clipperton Island". Prefer the feature that IS the
    # sovereign state (ADMIN == SOVEREIGNT); dependencies never satisfy that.
    name_of = {}
    for ft in ne["features"]:
        p = ft["properties"]
        iso, admin = p.get("ISO_A2"), p.get("ADMIN")
        if iso not in name_of or p.get("SOVEREIGNT") == admin:
            name_of[iso] = admin

    feats = ne["features"]
    out, unmatched, snapped = [], 0, 0
    for r in rows:
        lon, lat = float(r["lon"]), float(r["lat"])
        hits = idx.find_all(lon, lat)
        iso = hits[0]["name"] if hits else ""
        if iso in ("", "-99"):
            iso = (hits[0]["props"].get("ADMIN") if hits else "") or ""
            if not iso:
                # Inside nothing: offshore, reclaimed land, or a bad fix.
                iso, km = nearest_iso(lon, lat, feats)
                if iso:
                    snapped += 1
                else:
                    iso, unmatched = "UNKNOWN", unmatched + 1
        r["country"] = iso
        r["country_name"] = name_of.get(iso, iso)
        out.append(r)

    dest = ROOT / "data" / "osm_world_by_country.csv"
    cols = list(rows[0].keys())
    with dest.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=cols)
        w.writeheader()
        w.writerows(out)
    print(f"wrote {dest.relative_to(ROOT)}  ({len(out)} features)")
    print(f"  snapped to nearest country within {SNAP_KM:.0f} km: {snapped}")
    print(f"  still unmatched: {unmatched} ({unmatched / len(out):.1%})")

    by = collections.Counter(r["country"] for r in out)
    op = collections.Counter(r["country"] for r in out if r["operator"])
    print(f"\n{'country':<26}{'sites':>7}{'operator known':>16}")
    print("-" * 49)
    for iso, n in by.most_common(20):
        pct = op[iso] / n if n else 0
        print(f"{name_of.get(iso, iso)[:24]:<26}{n:>7}{op[iso]:>10} ({pct:.0%})")
    print("-" * 49)
    print(f"{'TOTAL':<26}{len(out):>7}{sum(op.values()):>10} "
          f"({sum(op.values()) / len(out):.0%})")


if __name__ == "__main__":
    main()
