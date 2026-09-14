#!/usr/bin/env python3
"""Transmission line corridors from OpenStreetMap.

    python3 power_lines.py [--regions US-VA,US-NY] [--min-kv 0] [--force]

WHY THIS AND NOT THE FEDERAL LAYER
The obvious source is Esri's "U.S. Electric Power Transmission Lines", and it
cannot be used: its own metadata says "This work is licensed under the Esri
Master License Agreement", which requires an ArcGIS subscription for non-Esri
apps and restricts redistribution. It is also archived - "will no longer be
updated or maintained" - with its data frozen at 2024-09-30. OpenStreetMap is
ODbL, which this registry already carries for the footprints layer, so it adds
no new licence question. ODbL is share-alike: the output file records its
source and licence in its own properties, and the map credits OSM.

WHAT THIS IS AND IS NOT
These are CORRIDORS: where conductors actually run. They are NOT dependency
edges and must never be read as any. A line passing a substation says nothing
about which load that substation serves - that question is answered by filings
in src/power_deps.py, never by geometry, and the whole dependency layer exists
because proximity is not evidence. The two are separate layers on the map for
that reason.

SCOPE
Regions come from data/substations.json, so the pull covers exactly the ground
where the dependency ledger has substations and grows when the ledger does.
Everything tagged power=line is kept: that tag IS transmission in OSM's data
model (distribution is power=minor_line), and filtering by voltage would drop
the untagged ones, which are not the low-voltage ones - they are the ones
nobody has finished mapping.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from osm import run, snapshot_age_days  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
SUBS = ROOT / "data" / "substations.json"
OUT = ROOT / "data" / "transmission_lines.geojson"

# ODbL requires the source to travel with the data. It goes in the file, not
# only in a comment here, because the file is what gets copied.
LICENCE = "ODbL 1.0"
ATTRIBUTION = "© OpenStreetMap contributors"

# The tags worth keeping. `voltage` is the one that matters and is the one most
# often a semicolon list, because a single mapped way frequently carries two
# circuits at the same or different voltages.
KEEP = ("operator", "cables", "circuits", "ref", "name", "line", "location")


def regions_from_ledger() -> list[str]:
    """ISO3166-2 codes for wherever the dependency ledger has substations."""
    if not SUBS.exists():
        return ["US-VA", "US-NY"]
    try:
        subs = json.loads(SUBS.read_text())
    except Exception:  # noqa: BLE001
        return ["US-VA", "US-NY"]
    codes = sorted({f"{s.get('country', 'US')}-{s['region']}"
                    for s in subs if s.get("region")})
    return codes or ["US-VA", "US-NY"]


def query_for(region: str) -> str:
    """power=line ways with their geometry, inside one ISO3166-2 area.

    `out geom` rather than `out body` plus a node pass: the ways are what we
    want and their vertices are not reused for anything else here, so asking
    the server to inline the geometry halves the round trips and avoids
    reassembling node references by hand.
    """
    return (
        "[out:json][timeout:180];"
        # .upper() like osm.py:70 does. Overpass matches the tag exactly, so
        # "us-va" finds no area and returns zero features - a silent empty
        # answer that reads as "no transmission lines here".
        f'area["ISO3166-2"="{region.upper()}"]->.a;'
        'way["power"="line"](area.a);'
        "out geom;"
    )


def kv_of(raw: str | None) -> tuple[float | None, list[float]]:
    """"230000;138000" -> (230, [230, 138]).

    The headline is the HIGHEST voltage on the way, because a way carrying a
    230 kV and a 138 kV circuit is a 230 kV corridor; the full list is kept so
    nothing is silently discarded.

    HALF-KILOVOLTS SURVIVE. round(34500 / 1000) is 34 in Python, not 35 -
    round() breaks halves to even - and 34.5 kV is a real, standard class while
    "34 kV" is not one at all. Rounding to integers invented a voltage class
    for 1,332 corridors before this kept the decimal.
    """
    if not raw:
        return None, []
    vals = []
    for part in str(raw).replace(",", ";").split(";"):
        part = part.strip()
        if not part:
            continue
        try:
            kv = round(float(part) / 1000, 1)
        except ValueError:
            continue
        if not 1 <= kv <= 1200:     # sanity: kV, not volts and not a typo
            continue
        # 230.0 should print as 230, but 34.5 must stay 34.5.
        vals.append(int(kv) if kv == int(kv) else kv)
    if not vals:
        return None, []
    return max(vals), sorted(set(vals), reverse=True)


# line=busbar and line=bay are the bars and bays INSIDE a switchyard fence, not
# spans between places. They are 22% of the ways returned and 0.4% of the
# length - a median of 29 m - so they cost a fifth of the payload to draw
# hatching inside substations that already have their own dot.
INTERNAL = {"busbar", "bay"}


def features_from(payload: dict, region: str, min_kv: int) -> tuple[list, int, int, int]:
    feats, skipped_geom, skipped_kv, skipped_internal = [], 0, 0, 0
    for el in payload.get("elements", []):
        if el.get("type") != "way":
            continue
        geom = el.get("geometry") or []
        if len(geom) < 2:
            skipped_geom += 1        # a line needs two ends
            continue
        tags = el.get("tags") or {}
        if tags.get("line") in INTERNAL:
            skipped_internal += 1
            continue
        kv, kvs = kv_of(tags.get("voltage"))
        if min_kv and (kv is None or kv < min_kv):
            skipped_kv += 1
            continue
        props = {
            "id": f"tl-{el['id']}",
            "osm": f"way/{el['id']}",
            "region": region,
            "kv": kv,
            "src": "osm",
            "licence": LICENCE,
        }
        if len(kvs) > 1:
            props["kvs"] = kvs
        for k in KEEP:
            v = tags.get(k)
            if v:
                props[k] = v
        feats.append({
            "type": "Feature",
            "properties": props,
            # 5 decimal places is about a metre, which is far finer than a
            # transmission corridor is surveyed to and cuts the file by
            # roughly a third against raw OSM precision.
            "geometry": {"type": "LineString",
                         "coordinates": [[round(p["lon"], 5), round(p["lat"], 5)]
                                         for p in geom]},
        })
    return feats, skipped_geom, skipped_kv, skipped_internal


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", default="",
                    help="comma-separated ISO3166-2 to FETCH, e.g. US-VA,US-NY. Every "
                         "region the ledger covers is still written from cache.")
    ap.add_argument("--min-kv", type=int, default=0,
                    help="drop ways below this kV (0 keeps everything, including untagged)")
    ap.add_argument("--force", action="store_true", help="refetch even if cached")
    args = ap.parse_args()

    # --regions narrows what is FETCHED, never what is written. The output is
    # always rebuilt from every region the ledger covers, reading each one's
    # cache - otherwise `--regions US-NY` would quietly rewrite the file with
    # New York alone and drop Virginia, which is the class of silent data loss
    # this repo keeps having to design against.
    wanted = [r.strip() for r in args.regions.split(",") if r.strip()]
    regions = regions_from_ledger()
    for r in wanted:                      # allow fetching a region not yet in the ledger
        if r not in regions:
            regions.append(r)
    fetch_only = set(wanted) if wanted else None
    print(f"regions: {', '.join(regions)}"
          + (f" · fetching only {', '.join(sorted(fetch_only))}" if fetch_only else ""))

    feats: list = []
    for region in regions:
        cache = RAW / f"power_lines_{region}.json"
        payload = None
        # A region outside --regions is served from cache only; it is not
        # skipped, because it still has to appear in the output.
        cache_only = fetch_only is not None and region not in fetch_only
        if cache.exists() and (not args.force or cache_only):
            try:
                payload = json.loads(cache.read_text())
                print(f"  {region}: cached")
            except Exception:  # noqa: BLE001
                payload = None
        if payload is None and cache_only:
            print(f"  {region}: no cache and not selected for fetch — skipped")
            continue
        if payload is None:
            print(f"  {region}: asking Overpass…")
            try:
                payload = run(query_for(region))
            except Exception as exc:  # noqa: BLE001
                # Overpass is frequently busy. A failed region must not destroy
                # the cache or the output: skip it and keep what we have.
                print(f"  {region}: FAILED ({exc}) — keeping any previous data")
                if cache.exists():
                    try:
                        payload = json.loads(cache.read_text())
                    except Exception:  # noqa: BLE001
                        continue
                else:
                    continue
            else:
                cache.write_text(json.dumps(payload))

        age = snapshot_age_days(payload)
        got, no_geom, low, internal = features_from(payload, region, args.min_kv)
        feats.extend(got)
        print(f"  {region}: {len(got):,} corridors"
              + (f", {internal:,} switchyard busbars/bays dropped" if internal else "")
              + (f", {low:,} below {args.min_kv} kV" if low else "")
              + (f", {no_geom} without geometry" if no_geom else "")
              + (f" · snapshot {age:.1f} days old" if age is not None else ""))

    # Area queries return ways UNCLIPPED at the border, so two adjacent regions
    # would each hand back the same span. NY and VA do not touch, but the first
    # bordering pair added would have silently doubled those corridors.
    seen, unique = set(), []
    for f in feats:
        i = f["properties"]["id"]
        if i in seen:
            continue
        seen.add(i)
        unique.append(f)
    if len(unique) != len(feats):
        print(f"  deduplicated {len(feats) - len(unique):,} ways seen in two regions")
    feats = unique
    feats.sort(key=lambda f: (-(f["properties"].get("kv") or 0), f["properties"]["id"]))
    OUT.write_text(json.dumps({
        "type": "FeatureCollection",
        # ODbL: the credit travels with the file.
        "attribution": ATTRIBUTION,
        "licence": LICENCE,
        "source": "OpenStreetMap power=line via Overpass",
        "note": ("Corridors, not dependency edges. A line passing a substation says "
                 "nothing about which load that substation serves."),
        "features": feats,
    }, separators=(",", ":")) + "\n")

    placed = sum(1 for f in feats if f["properties"].get("kv"))
    mb = OUT.stat().st_size / 1e6
    print(f"\nwrote {OUT.relative_to(ROOT)}  ({len(feats):,} corridors, {mb:.1f} MB)")
    print(f"  with a voltage tag: {placed:,} of {len(feats):,}")
    if feats:
        top = {}
        for f in feats:
            k = f["properties"].get("kv")
            if k:
                top[k] = top.get(k, 0) + 1
        for k in sorted(top, reverse=True)[:6]:
            print(f"    {k:>4} kV  {top[k]:,}")


if __name__ == "__main__":
    main()
