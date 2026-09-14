"""Japanese parcel boundaries from the MOJ registry maps (登記所備付地図).

    python3 parcels_moj_jp.py

The Ministry of Justice opened the national registry maps in 2023; AIGID
republishes them per municipality as GeoJSON on the G-Spatial Information
Center's CKAN portal. No API takes a point, so like the UK this is a
download-and-join - but the municipality resolution is nicer: GSI's reverse
geocoder answers lat/lon -> 5-digit municipal code directly, and the CKAN
dataset for a code is `aigid-moj-<code>`.

WHY MISSES ARE EXPECTED AND CORRECT. The registry maps carry two kinds of
sheet: 公共座標 (surveyed into a real CRS) and 任意座標 (arbitrary local
coordinates from paper-era surveys, which cannot be placed on a map). The
converted GeoJSON keeps both; features from arbitrary sheets land nowhere
near the site and simply fail containment. Urban Tokyo/Osaka are mostly
surveyed; rural sheets often are not. A site in an unconverted area gets
nothing, honestly.

Municipal files run to hundreds of MB; they cache under data/raw/jp_moj/ and
resources over the size cap are skipped with a note rather than fetched.

Attribution (required): 「登記所備付地図データ（法務省）を加工して作成」-
carried here, in the README, and the popup's generic parcel label.

Output: data/raw/parcels_jp.geojson, merged by footprints.py (kind=campus,
src=parcel).
"""

from __future__ import annotations

import csv
import json
import pathlib
import time
import urllib.request

import geo

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
STORE = RAW / "jp_moj"
MUNI_CACHE = RAW / "jp_muni_cache"
DEST = RAW / "parcels_jp.geojson"
UA = {"User-Agent": "reinsurance_dc-research/1.0 (MOJ registry map join)"}

GSI = "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress"
CKAN = "https://www.geospatial.jp/ckan/api/3/action/package_show"
MAX_MB = 400


def get(url: str, timeout: int = 300) -> bytes:
    last = None
    for n in range(3):
        try:
            return urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=timeout).read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(5 * (n + 1))
    raise last


def needy_jp() -> list[dict]:
    fp = json.loads((ROOT / "data" / "footprints.geojson").read_text())
    real = set()
    for f in fp["features"]:
        p = f["properties"]
        if p["kind"] == "campus" and p["src"] not in ("derived", "osm-landuse"):
            real.update(p.get("sites") or ())
    out = []
    with (ROOT / "data" / "facilities_sites.csv").open(encoding="utf-8") as fh:
        for s in csv.DictReader(fh):
            if s.get("country") != "JP" or not s.get("lat"):
                continue
            if (s.get("geo_precision") or "exact") != "exact" or s["site_id"] in real:
                continue
            out.append({"sid": s["site_id"], "lat": float(s["lat"]), "lon": float(s["lon"])})
    return out


def muni_of(site: dict) -> str:
    MUNI_CACHE.mkdir(parents=True, exist_ok=True)
    cf = MUNI_CACHE / f"{site['sid']}.json"
    if cf.exists():
        return json.loads(cf.read_text())["muni"]
    out = json.loads(get(f"{GSI}?lat={site['lat']}&lon={site['lon']}", 30))
    muni = (out.get("results") or {}).get("muniCd") or ""
    cf.write_text(json.dumps({"muni": muni}))
    time.sleep(0.4)
    return muni


def geojson_resources(muni: str) -> list[dict]:
    cf = STORE / f"{muni}_resources.json"
    STORE.mkdir(parents=True, exist_ok=True)
    if cf.exists():
        return json.loads(cf.read_text())
    try:
        out = json.loads(get(f"{CKAN}?id=aigid-moj-{muni}", 60))
        res = [{"url": r["url"], "size": r.get("size") or 0, "name": r.get("name") or ""}
               for r in out["result"]["resources"]
               if (r.get("format") or "").lower() == "geojson"]
    except Exception as e:  # noqa: BLE001
        print(f"    {muni}: no CKAN dataset ({e})")
        res = []
    cf.write_text(json.dumps(res))
    time.sleep(0.5)
    return res


def parcels_of(muni: str):
    """Yield (ref, geometry, bbox) for every parcel in the municipality."""
    for i, r in enumerate(geojson_resources(muni)):
        f = STORE / f"{muni}_{i}.geojson"
        if not f.exists():
            size_mb = (int(r["size"]) if r["size"] else 0) / 1048576
            if size_mb > MAX_MB:
                print(f"    {muni}: resource {i} is {size_mb:.0f} MB - skipped "
                      f"(cap {MAX_MB} MB)")
                continue
            try:
                f.write_bytes(get(r["url"]))
            except Exception as e:  # noqa: BLE001
                print(f"    {muni}: download failed ({e})")
                continue
        try:
            fc = json.loads(f.read_text())
        except Exception:
            print(f"    {muni}: resource {i} unparseable")
            continue
        for feat in fc.get("features") or []:
            g = feat.get("geometry") or {}
            if g.get("type") not in ("Polygon", "MultiPolygon"):
                continue
            rings = geo._rings(g)
            if not rings:
                continue
            xs = [p[0] for r_ in rings for p in r_]
            ys = [p[1] for r_ in rings for p in r_]
            props = feat.get("properties") or {}
            ref = str(props.get("地番") or props.get("chiban") or "")
            yield ref, g, (min(xs), min(ys), max(xs), max(ys))


def main() -> None:
    sites = needy_jp()
    print(f"{len(sites)} JP sites without a recorded boundary")
    by_muni: dict[str, list[dict]] = {}
    for s in sites:
        m = muni_of(s)
        if m:
            by_muni.setdefault(m, []).append(s)
    print(f"{len(by_muni)} municipalities to fetch")

    feats, covered = [], set()
    for i, (muni, group) in enumerate(sorted(by_muni.items())):
        hits = 0
        n = 0
        for ref, g, bb in parcels_of(muni):
            n += 1
            for s in group:
                if s["sid"] in covered:
                    continue
                if not (bb[0] <= s["lon"] <= bb[2] and bb[1] <= s["lat"] <= bb[3]):
                    continue
                if sum(1 for r in geo._rings(g)
                       if geo._in_ring(s["lon"], s["lat"], r)) % 2 != 1:
                    continue
                feats.append({"type": "Feature", "geometry": g, "properties": {
                    "id": f"fp-parcel-jp-{muni}-{ref or s['sid']}",
                    "kind": "campus", "src": "parcel", "name": "", "op": "",
                    "ref": ref, "locality": f"JP {muni}", "acres": "",
                    "for_site": s["sid"]}})
                covered.add(s["sid"])
                hits += 1
        print(f"  [{i + 1}/{len(by_muni)}] {muni}: {len(group)} sites -> {hits} parcels "
              f"({n:,} parcels scanned)", flush=True)

    DEST.write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                               ensure_ascii=False))
    print(f"wrote {DEST.relative_to(ROOT)}: {len(feats)} parcels covering "
          f"{len(covered)} of {len(sites)} sites")
    print("出典: 登記所備付地図データ（法務省）を加工して作成")


if __name__ == "__main__":
    main()
