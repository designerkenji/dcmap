"""Build ONE earthquake layer for the last N days, not one layer per event.

    python3 quakes.py [days] [min_magnitude]

524 M5+ events in the last three months makes per-event layers impossible, so
this splits the problem the way USGS's own map does:

  the layer    every epicentre, as a point scaled by magnitude. Cheap, and it
               shows the whole seismic picture at once.
  the detail   ShakeMap contours and per-site exposure, precomputed for the
               events that can matter - anything with a registry site within
               200 km, plus every M7.0+ wherever it struck - and fetched when
               one is clicked.

"Can matter" is doing real work there. Of 524 events, 132 have a registry site
within 200 km and only 53 of those publish a ShakeMap. Computing exposure for
the other 471 would be 9 MB of downloads to prove that an M5.1 in the Kermadec
Trench shook nothing.

Exposure uses the same method as shakemap.py: bilinear interpolation of the
MMI grid, never the contours, because contours cannot answer "how hard did
THIS point shake" without inferring insideness from nested rings.
"""

from __future__ import annotations

import collections
import csv
import json
import math
import pathlib
import sys
import urllib.error
import urllib.request

from shakemap import MMI_COLOR, MMI_LABEL, MIN_CONTOUR_MMI, sample_grid

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
SITES = ROOT / "data" / "facilities_sites.csv"
PLANTS = ROOT / "data" / "power_plants.json"
FABS = ROOT / "data" / "fabs.json"
DETAIL_DIR = ROOT / "data" / "quake_events"
OUT_TS = ROOT / "worldmonitor" / "src" / "config" / "quakes-recent.ts"
# NO endtime. USGS reads a bare date as MIDNIGHT UTC, so endtime=<today> ended
# the window at 00:00 and silently dropped everything that had happened today -
# up to 24 hours of events, reported as a clean success. It was found by an
# M7.4 south of San Jose del Palmar, Colombia at 2026-08-10T12:34Z being absent
# from a run made that afternoon. Omitted, the feed runs to the present instant.
FEED = ("https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson"
        "&starttime={start}&minmagnitude={mag}")

# A great earthquake gets its footprint whatever the registry looks like. The
# proximity rule below exists to avoid 9 MB of downloads proving that an M5.1
# in the Kermadec Trench shook nothing; that argument does not survive contact
# with an M7.7, which is the largest thing on the map that month and the event
# a reader will click first. There are only a handful a year, so the floor
# costs almost nothing - on the 2026-08-14 pull it adds exactly two events.
MAJOR_MAG = 7.0

# Only events with a site this close get their ShakeMap pulled. Beyond ~200 km
# an M5-6 is not felt at damaging intensity, and the grid would return MMI < 2
# for every site anyway.
NEAR_KM = 200.0


def km(lon_a, lat_a, lon_b, lat_b) -> float:
    dx = (lon_a - lon_b) * 111.32 * math.cos(math.radians((lat_a + lat_b) / 2))
    return math.hypot(dx, (lat_a - lat_b) * 111.32)


def fetch_json(url: str, dest: pathlib.Path | None = None, refresh: bool = False):
    # refresh writes the copy but never reads it. For the feed that is the only
    # correct behaviour - it is the live thing this script exists to pull - and
    # the copy is still worth keeping to diff a run against.
    if dest and dest.exists() and not refresh:
        return json.loads(dest.read_text())
    req = urllib.request.Request(url, headers={"User-Agent": "reinsurance_dc-research/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        raw = r.read()
    if dest:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw)
    return json.loads(raw)


def main() -> None:
    import datetime as dt
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 90
    # 4.0, not 5.0. The floor was lowered deliberately - M4 is where shaking
    # starts mattering to a building, and it takes the catalogue from 558
    # events to 3,868 - but the default here was left behind, so an
    # argument-free re-run silently threw the whole M4-M4.9 band away and
    # undid that. The default has to agree with the decision.
    minmag = float(sys.argv[2]) if len(sys.argv) > 2 else 4.0
    end = dt.date.today()
    start = end - dt.timedelta(days=days)

    # The feed is ALWAYS refetched. It was cached under quakes_{days}d_m{mag},
    # a key with no date in it, so for a rolling window it never changed and
    # every re-run after the first re-read the first pull and rewrote the same
    # events - a refresh script that could not refresh. Dating the file was not
    # enough either: a second run on the same day is exactly when you are
    # chasing an event that just happened.
    #
    # It costs one 400 KB request. The expensive part - 51 ShakeMap products,
    # ~9 MB - stays cached by event id below, and those are immutable, so a
    # re-run still only fetches the feed and whatever is new.
    feed = fetch_json(FEED.format(start=start, mag=minmag),
                      RAW / f"quakes_{end}_{days}d_m{minmag}.json", refresh=True)
    events = feed.get("features", [])
    print(f"USGS M{minmag}+ events, {start} to now: {len(events)}")

    # All three dot layers are exposed assets, not just the registry. A quake
    # that misses every data centre but levels the substation feeding one has
    # still taken the site off the air, and a fab is a harder thing to restart
    # than a hall of servers. They are kept as distinct kinds rather than
    # merged, because "12 assets shaken" answers nothing - what was shaken is
    # the whole question.
    assets = []
    for r in csv.DictReader(SITES.open()):
        if not r.get("lat"):
            continue
        assets.append({"kind": "dc", "site_id": r["site_id"],
                       "name": r["name"] or r["epoch_name"], "operator": r["operator"],
                       "lon": float(r["lon"]), "lat": float(r["lat"])})
    for r in json.loads(PLANTS.read_text()):
        if r.get("lat") is None or r.get("lon") is None:
            continue
        # Operating only. A plant is an exposed asset when it is generating;
        # "plan" covers announced and pre-construction, where there is nothing
        # on the ground to shake - the first version of this counted 1,082 such
        # records and led with Timor-3, a 100 MW gas station proposed for 2032,
        # as the M7.7's worst hit. "ret" is excluded for the opposite reason:
        # the structure is still standing, but nothing about it can be knocked
        # offline, and its value here is the switchyard, not the boiler.
        if r.get("k") != "op":
            continue
        assets.append({"kind": "plant", "site_id": r["id"], "name": r["n"],
                       "operator": r.get("own") or "", "fuel": r.get("f"),
                       "mw": r.get("mw") or 0, "status": r.get("k"),
                       "lon": float(r["lon"]), "lat": float(r["lat"])})
    for r in json.loads(FABS.read_text()):
        if r.get("lat") is None or r.get("lon") is None:
            continue
        # Under construction counts - a half-built fab is a physical site with
        # tools in it. "announced" is a press release with a coordinate.
        if r.get("k") not in ("operating", "construction"):
            continue
        assets.append({"kind": "fab", "site_id": r["id"], "name": r["n"],
                       "operator": r.get("grp") or r.get("op") or "",
                       "status": r.get("k"),
                       "lon": float(r["lon"]), "lat": float(r["lat"])})
    by_kind = collections.Counter(a["kind"] for a in assets)
    print(f"  exposed assets: {by_kind['dc']} data centres, "
          f"{by_kind['plant']} power plants, {by_kind['fab']} fabs")

    # One-degree buckets: 548 events x 34,500 assets is 19M distance calls
    # otherwise, and this runs on every refresh.
    grid = collections.defaultdict(list)
    for a in assets:
        grid[(round(a["lon"]), round(a["lat"]))].append((a["lon"], a["lat"], a))

    def nearby(elon, elat, limit):
        span = int(limit / 100) + 2
        out = []
        for dx in range(-span, span + 1):
            for dy in range(-span, span + 1):
                for lon, lat, r in grid.get((round(elon) + dx, round(elat) + dy), []):
                    d = km(lon, lat, elon, elat)
                    if d <= limit:
                        out.append((d, r))
        # Sort on distance only - tuples fall through to comparing the dicts
        # when two sites are exactly equidistant, which raises.
        return sorted(out, key=lambda t: t[0])

    DETAIL_DIR.mkdir(parents=True, exist_ok=True)
    layer, detailed, skipped = [], 0, 0
    for f in events:
        p = f["properties"]
        elon, elat, depth = f["geometry"]["coordinates"]
        near = nearby(elon, elat, NEAR_KM)
        has_sm = "shakemap" in (p.get("types") or "")
        rec = {
            "id": f["id"], "mag": round(p.get("mag") or 0, 1),
            "place": p.get("place") or "", "time": p.get("time"),
            "lon": round(elon, 3), "lat": round(elat, 3),
            "depthKm": round(depth or 0, 1),
            "near200": len(near),
            "near200dc": sum(1 for _, r in near if r["kind"] == "dc"),
            "nearestKm": round(near[0][0]) if near else None,
            "url": p.get("url"),
            "detail": False,
        }
        # Pull a ShakeMap when there is something for it to have shaken, or
        # when the event is large enough to be worth seeing on its own.
        if has_sm and (near or (p.get("mag") or 0) >= MAJOR_MAG):
            try:
                ev = fetch_json(
                    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid="
                    + f["id"], RAW / "quake_ev" / f"{f['id']}.json")
                sm = ev["properties"]["products"]["shakemap"][0]["contents"]
                cov = fetch_json(sm["download/coverage_mmi_low_res.covjson"]["url"],
                                 RAW / "quake_cov" / f"{f['id']}.json")
                cont = fetch_json(sm["download/cont_mmi.json"]["url"],
                                  RAW / "quake_cont" / f"{f['id']}.json")
            except (KeyError, IndexError, urllib.error.URLError, TimeoutError):
                skipped += 1
                layer.append(rec)
                continue

            lookup = sample_grid(cov)
            exposed = []
            for d, r in near:
                mmi = lookup(r["lon"], r["lat"])
                if mmi is None or mmi < 2:
                    continue
                e = {
                    "kind": r["kind"], "site_id": r["site_id"], "name": r["name"],
                    "operator": r["operator"], "mmi": round(mmi, 2), "km": round(d, 1),
                }
                # A shaken plant's fuel and megawatts are the point of it being
                # in the list at all - 900 MW of gas at MMI 7 is the headline,
                # not the plant's name.
                if r["kind"] == "plant":
                    e["fuel"], e["mw"] = r.get("fuel"), r.get("mw")
                exposed.append(e)
            exposed.sort(key=lambda e: -e["mmi"])
            bands = collections.Counter(int(e["mmi"]) for e in exposed)
            kinds = collections.Counter(e["kind"] for e in exposed)

            lines = []
            for cf in cont.get("features", []):
                pr = cf.get("properties") or {}
                if (pr.get("value") or 0) < MIN_CONTOUR_MMI:
                    continue
                g = cf.get("geometry") or {}
                segs = g.get("coordinates") or []
                if g.get("type") == "LineString":
                    segs = [segs]
                segs = [[[round(x, 3), round(y, 3)] for x, y in sg] for sg in segs if len(sg) > 1]
                if segs:
                    lines.append({"value": pr.get("value"), "color": pr.get("color"),
                                  "segments": segs})

            (DETAIL_DIR / f"{f['id']}.json").write_text(json.dumps({
                "id": f["id"], "title": p.get("title"), "mag": p.get("mag"),
                "epicentre": [round(elon, 4), round(elat, 4)],
                "contours": lines, "exposed": exposed,
                "kinds": {k: kinds[k] for k in ("dc", "plant", "fab") if kinds[k]},
                "mwShaken": round(sum(e.get("mw") or 0 for e in exposed
                                      if e["kind"] == "plant")),
                "bands": [{"mmi": b, "sites": bands[b], "color": MMI_COLOR.get(b, "#ccc"),
                           "label": MMI_LABEL.get(b, str(b))}
                          for b in sorted(bands, reverse=True)],
            }, separators=(",", ":")))
            rec["detail"] = True
            rec["exposed"] = len(exposed)
            for k in ("dc", "plant", "fab"):
                if kinds[k]:
                    rec[k] = kinds[k]
            rec["maxMmi"] = round(max((e["mmi"] for e in exposed), default=0), 1)
            detailed += 1
        layer.append(rec)

    layer.sort(key=lambda r: -r["mag"])
    with_sites = sum(1 for r in layer if r["near200"])
    print(f"  events with a registry site within {NEAR_KM:.0f} km: {with_sites}")
    print(f"  ShakeMap detail precomputed: {detailed}   (skipped, no usable product: {skipped})")
    hit = [r for r in layer if r.get("exposed")]
    print(f"  events that actually shook a site at MMI 2+: {len(hit)}")
    for r in sorted(hit, key=lambda r: -(r.get("maxMmi") or 0))[:6]:
        print(f"    M{r['mag']:<4} MMI {r['maxMmi']:<4} {r['exposed']:>3} sites  {r['place'][:44]}")

    OUT_TS.parent.mkdir(parents=True, exist_ok=True)
    OUT_TS.write_text(
        "import type { QuakeEvent } from '@/types';\n\n"
        f"// USGS M{minmag}+ earthquakes, last {days} days. One layer, not one per\n"
        "// event: 524 events in three months makes per-event layers absurd.\n"
        "// `detail: true` means a ShakeMap footprint and per-site exposure were\n"
        "// precomputed into data/quake_events/<id>.json and can be loaded on click.\n"
        "// Generated by src/quakes.py. Do not edit.\n\n"
        "export const QUAKES_RECENT: QuakeEvent[] = "
        + json.dumps(layer, separators=(",", ":")) + ";\n")
    print(f"wrote {OUT_TS.relative_to(ROOT)}  ({len(layer)} events, "
          f"{OUT_TS.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
