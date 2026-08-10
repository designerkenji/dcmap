"""Build ONE earthquake layer for the last N days, not one layer per event.

    python3 quakes.py [days] [min_magnitude]

524 M5+ events in the last three months makes per-event layers impossible, so
this splits the problem the way USGS's own map does:

  the layer    every epicentre, as a point scaled by magnitude. Cheap, and it
               shows the whole seismic picture at once.
  the detail   ShakeMap contours and per-site exposure, precomputed only for
               the events that can matter and fetched when one is clicked.

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
DETAIL_DIR = ROOT / "data" / "quake_events"
OUT_TS = ROOT / "worldmonitor" / "src" / "config" / "quakes-recent.ts"
# NO endtime. USGS reads a bare date as MIDNIGHT UTC, so endtime=<today> ended
# the window at 00:00 and silently dropped everything that had happened today -
# up to 24 hours of events, reported as a clean success. It was found by an
# M7.4 south of San Jose del Palmar, Colombia at 2026-08-10T12:34Z being absent
# from a run made that afternoon. Omitted, the feed runs to the present instant.
FEED = ("https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson"
        "&starttime={start}&minmagnitude={mag}")

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
    minmag = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0
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

    sites = [r for r in csv.DictReader(SITES.open()) if r.get("lat")]
    pts = [(float(r["lon"]), float(r["lat"]), r) for r in sites]
    # One-degree buckets: 524 events x 6,248 sites is 3.3M distance calls
    # otherwise, and this runs on every refresh.
    grid = collections.defaultdict(list)
    for lon, lat, r in pts:
        grid[(round(lon), round(lat))].append((lon, lat, r))

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
            "nearestKm": round(near[0][0]) if near else None,
            "url": p.get("url"),
            "detail": False,
        }
        # Only pull a ShakeMap when there is something for it to have shaken.
        if has_sm and near:
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
                mmi = lookup(float(r["lon"]), float(r["lat"]))
                if mmi is None or mmi < 2:
                    continue
                exposed.append({
                    "site_id": r["site_id"], "name": r["name"] or r["epoch_name"],
                    "operator": r["operator"], "mmi": round(mmi, 2),
                    "km": round(d, 1),
                })
            exposed.sort(key=lambda e: -e["mmi"])
            bands = collections.Counter(int(e["mmi"]) for e in exposed)

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
                "bands": [{"mmi": b, "sites": bands[b], "color": MMI_COLOR.get(b, "#ccc"),
                           "label": MMI_LABEL.get(b, str(b))}
                          for b in sorted(bands, reverse=True)],
            }, separators=(",", ":")))
            rec["detail"] = True
            rec["exposed"] = len(exposed)
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
