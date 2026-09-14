"""Flag sites whose ADDRESS and DOT disagree, via Precisely geocoding.

    python3 geocode_verify.py                 # 20 requests (~500 sites)
    python3 geocode_verify.py --budget 60

The failure mode this hunts: the registry's address is right and its
coordinate is not - AlohaNAP's dot sat on a water park 400 m from the
building at its own address. Forward-geocode the recorded address, measure
the distance to the stored dot, and put every disagreement over 250 m on a
worklist sorted worst-first.

A DISAGREEMENT IS A FLAG, NEVER A FIX. The live probe that justified this
script also disproved auto-adoption: for AlohaNAP itself, Precisely's
score-100 ADDRESS_POINT landed 6 km from the true building - Hawaiian
hyphenated addressing defeats the geocoder too. Either side can be wrong;
only the disagreement is certain. Corrections stay human: the site page's
imagery viewer and its click-to-fix flow write the override.

Ordering: sites with an address but NO attached footprint go first - a dot
that landed on the wrong land has no building under it, so the uncovered
population is where the bad dots concentrate. Addresses are geocoded 25 to
a request (the API takes a batch; DIS bills the request), cached per site.

Output: data/raw/geocode_cache/<sid>.json per answer, and
data/raw/geocode_check.json - the worklist, worst first.
"""

from __future__ import annotations

import csv
import json
import math
import pathlib
import sys
import time
import urllib.request

import parcels_precisely as pp

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CACHE = RAW / "geocode_cache"
OUT = RAW / "geocode_check.json"
URL = "https://api.cloud.precisely.com/v1/geocode"
BATCH = 25
FLAG_KM = 0.25


def km(a_lon, a_lat, b_lon, b_lat):
    dx = (a_lon - b_lon) * 111.32 * math.cos(math.radians((a_lat + b_lat) / 2))
    return math.hypot(dx, (a_lat - b_lat) * 111.32)


def find_pt(o):
    if isinstance(o, dict):
        c = o.get("coordinates")
        if isinstance(c, list) and c and isinstance(c[0], (int, float)):
            return c
        for v in o.values():
            p = find_pt(v)
            if p:
                return p
    elif isinstance(o, list):
        for v in o:
            p = find_pt(v)
            if p:
                return p
    return None


def overridden_coords() -> dict:
    """Hand corrections from the app's ledger - the raw CSV keeps the old
    coordinate, so without this every already-fixed dot flags forever."""
    ov = {}
    f = ROOT / "data" / "site_overrides.csv"
    if not f.exists():
        return ov
    for r in csv.DictReader(f.open(encoding="utf-8")):
        if r.get("field") in ("lat", "lon") and r.get("value"):
            ov.setdefault(r["site_id"], {})[r["field"]] = float(r["value"])
    return ov


def targets() -> list[dict]:
    addr = {}
    for r in csv.DictReader((ROOT / "data" / "facilities_global.csv").open(encoding="utf-8")):
        a = (r.get("address") or "").strip()
        if a and r.get("site_id") and r["site_id"] not in addr:
            addr[r["site_id"]] = (a, (r.get("city") or "").strip())
    # A site with no shape under its dot is the likelier bad dot.
    outlined = set()
    for fn in ("footprints.geojson", "footprints_overture.geojson"):
        fp = ROOT / "data" / fn
        if not fp.exists():
            continue
        for f in json.loads(fp.read_text())["features"]:
            outlined.update(str(x) for x in f["properties"].get("sites") or ())
    ov = overridden_coords()
    first, rest = [], []
    for s in csv.DictReader((ROOT / "data" / "facilities_sites.csv").open(encoding="utf-8")):
        sid = s["site_id"]
        if sid not in addr or not s.get("lat"):
            continue
        if (s.get("geo_precision") or "exact") != "exact":
            continue
        o = ov.get(sid) or {}
        t = {"sid": sid, "lon": o.get("lon", float(s["lon"])),
             "lat": o.get("lat", float(s["lat"])),
             "addr": addr[sid][0], "city": addr[sid][1],
             "cy": s.get("country") or "", "name": s.get("name") or ""}
        (rest if sid in outlined else first).append(t)
    return first + rest


def geocode_batch(tok: str, batch: list[dict]) -> list[dict | None]:
    body = {"addresses": [
        {"addressLines": [t["addr"]] + ([t["city"]] if t["city"] else []),
         **({"country": t["cy"]} if t["cy"] else {})}
        for t in batch]}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={
        "Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    out = json.loads(urllib.request.urlopen(req, timeout=120).read())
    answers = []
    for resp in out.get("responses") or []:
        results = resp.get("results") or []
        if not results:
            answers.append(None)
            continue
        r = results[0]
        pt = find_pt(r.get("location") or {})
        answers.append({
            "pt": pt, "score": r.get("score"),
            "type": ((r.get("location") or {}).get("explanation") or {}).get("type") or "",
        } if pt else None)
    # Alignment is positional; a short reply must not shift the rest.
    while len(answers) < len(batch):
        answers.append(None)
    return answers


def main() -> None:
    budget = 20
    if "--budget" in sys.argv:
        budget = int(sys.argv[sys.argv.index("--budget") + 1])
    k, s = pp.credentials()
    tok = pp.bearer(k, s)
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = {p.stem for p in CACHE.glob("*.json")}
    todo = [t for t in targets() if t["sid"] not in cached]
    print(f"{len(todo)} addressed sites unasked; budget {budget} requests "
          f"x {BATCH} addresses")
    asked = 0
    while todo and asked < budget:
        batch, todo = todo[:BATCH], todo[BATCH:]
        try:
            answers = geocode_batch(tok, batch)
        except Exception as e:  # noqa: BLE001
            print(f"  batch failed: {e}")
            break
        asked += 1
        for t, a in zip(batch, answers):
            (CACHE / f"{t['sid']}.json").write_text(json.dumps(a or {}))
        time.sleep(0.4)

    # The worklist, from everything ever cached.
    tg = {t["sid"]: t for t in targets()}
    flags = []
    for p in CACHE.glob("*.json"):
        a = json.loads(p.read_text())
        t = tg.get(p.stem)
        if not a or not a.get("pt") or not t:
            continue
        d = km(a["pt"][0], a["pt"][1], t["lon"], t["lat"])
        if d >= FLAG_KM:
            flags.append({"sid": t["sid"], "name": t["name"], "addr": t["addr"],
                          "cy": t["cy"], "km": round(d, 2),
                          "dot": [t["lon"], t["lat"]],
                          "geocode": a["pt"], "score": a.get("score"),
                          "type": a.get("type")})
    flags.sort(key=lambda f: -f["km"])
    OUT.write_text(json.dumps(flags, indent=1))
    print(f"asked {asked} requests; {len(flags)} sites where address and dot "
          f"disagree by >= {FLAG_KM*1000:.0f} m -> {OUT.relative_to(ROOT)}")
    for f in flags[:12]:
        print(f"  {f['km']:>7.2f} km  {f['sid']}  {(f['name'] or '')[:30]:30} "
              f"{f['addr'][:44]}")


if __name__ == "__main__":
    main()
