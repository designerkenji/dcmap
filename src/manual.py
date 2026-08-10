"""Add a data centre by hand, and keep it through every pipeline re-run.

    python3 manual.py add "1515 Port Industrial Way, Quincy, WA, USA" \\
        --name "Microsoft Quincy MWH01" --operator "Microsoft"
    python3 manual.py list
    python3 manual.py build

Everything else in this registry is derived: OSM, PeeringDB and Epoch are
re-pulled and facilities_sites.csv is rebuilt from scratch. So a row typed
into a generated file survives exactly until the next run, which makes hand
knowledge worthless.

data/manual_sites.csv is therefore a SOURCE, not an output. Nothing generates
it, nothing overwrites it, and `build` folds it into the chain the same way
epoch.py folds in Epoch:

    osm.py -> epoch.py -> [manual.py] -> peeringdb.py -> dedupe.py

which means a manual site gets deduped, clustered, given a stable site_id and
a shareable page like any other. If it turns out to be 200 m from a site OSM
already knew about, dedupe merges the two and the manual row becomes another
source on one site rather than a duplicate dot.

GEOCODING
An address is not a location. `add` resolves one through the US Census
geocoder (free, no key, US-only) and falls back to OSM Nominatim (global, one
request a second, needs a real User-Agent). Results are cached so re-running
costs nothing. If both fail, pass --lat/--lon; the row is never written
without a coordinate, because a site the map cannot draw is not much use.

It also WARNS about anything already within 1 km and shows what it found.
It does not refuse: two buildings on one campus are a real thing, and only
the person adding it knows which case this is.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
MANUAL = ROOT / "data" / "manual_sites.csv"
LINKS = ROOT / "data" / "manual_links.csv"
SRC = ROOT / "data" / "facilities_osm_epoch.csv"
OUT = ROOT / "data" / "facilities_with_manual.csv"
SITES = ROOT / "data" / "facilities_sites.csv"
CACHE = ROOT / "data" / "raw" / "geocode_cache.json"

UA = {"User-Agent": "reinsurance_dc-research/1.0 (data centre registry)"}

# What a person can usefully know without a source system. Deliberately short:
# anything derivable (site_id, country, geo_precision) is derived, not typed.
COLUMNS = ["name", "operator", "address", "city", "country", "lat", "lon",
           "geo_precision", "facility_type", "power_mw_it", "ref", "utility",
           "note", "added"]

LINK_COLUMNS = ["site_id", "url", "label", "note", "added"]

NEAR_KM = 1.0


def km(lon_a, lat_a, lon_b, lat_b) -> float:
    return math.hypot((lon_a - lon_b) * 111.32 * math.cos(math.radians((lat_a + lat_b) / 2)),
                      (lat_a - lat_b) * 111.32)


def load_cache() -> dict:
    return json.loads(CACHE.read_text()) if CACHE.exists() else {}


def save_cache(c: dict) -> None:
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(c, indent=1))


def _get(url: str) -> dict | None:
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read())
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError,
            OSError, ValueError):
        return None


def _census(q: str):
    p = urllib.parse.urlencode({"address": q, "benchmark": "Public_AR_Current",
                                "format": "json"})
    d = _get(f"https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?{p}")
    m = ((d or {}).get("result") or {}).get("addressMatches") or []
    return (float(m[0]["coordinates"]["x"]), float(m[0]["coordinates"]["y"])) if m else None


def _nominatim(q: str):
    time.sleep(1.1)                          # Nominatim asks for <=1 req/s
    p = urllib.parse.urlencode({"q": q, "format": "json", "limit": 1})
    d = _get(f"https://nominatim.openstreetmap.org/search?{p}")
    return (float(d[0]["lon"]), float(d[0]["lat"])) if d else None


def geocode(address: str) -> tuple[float, float, str, str] | None:
    """(lon, lat, provider, precision) for an address, or None.

    Tries the full address, then the street, then the town, and REPORTS WHICH
    ONE ANSWERED. Plenty of real addresses are not geocodable - "1515 Port
    Industrial Way, Quincy WA" is unknown to both the US Census TIGER file and
    OSM, because private industrial roads are often in neither - and silently
    handing back the town centroid as if it were a rooftop would put a dot on
    the map claiming a precision nobody has.

    precision is the registry's own vocabulary: "exact" means a located
    building, "town" means a settlement centroid, and the map already draws
    the second hollow.
    """
    cache = load_cache()
    if address in cache:
        c = cache[address]
        return (c["lon"], c["lat"], c["via"] + " (cached)", c["precision"]) if c else None

    parts = [p.strip() for p in address.split(",") if p.strip()]
    # Full address; then drop the house number; then the town alone.
    street = re.sub(r"^\s*\d+[A-Za-z]?\s+", "", parts[0]) if parts else ""
    attempts = [(address, "exact")]
    if street and street != parts[0]:
        attempts.append((", ".join([street] + parts[1:]), "exact"))
    if len(parts) > 1:
        attempts.append((", ".join(parts[1:]), "town"))

    result = None
    for q, precision in attempts:
        for name, fn in (("US Census", _census), ("Nominatim", _nominatim)):
            got = fn(q)
            if got:
                result = (got[0], got[1], f"{name} <- {q!r}", precision)
                break
        if result:
            break

    cache[address] = ({"lon": result[0], "lat": result[1], "via": result[2],
                       "precision": result[3]} if result else None)
    save_cache(cache)
    return result


def read_manual() -> list[dict]:
    if not MANUAL.exists():
        return []
    return list(csv.DictReader(MANUAL.open()))


def write_manual(rows: list[dict]) -> None:
    MANUAL.parent.mkdir(parents=True, exist_ok=True)
    with MANUAL.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=COLUMNS,
                           extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def iso2(address: str, explicit: str) -> str:
    if explicit:
        return explicit.upper()
    tail = address.rsplit(",", 1)[-1].strip().lower()
    return {"usa": "US", "united states": "US", "us": "US", "uk": "GB",
            "united kingdom": "GB", "canada": "CA", "germany": "DE",
            "france": "FR", "netherlands": "NL", "ireland": "IE",
            "singapore": "SG", "japan": "JP", "australia": "AU",
            "india": "IN", "brazil": "BR"}.get(tail, "")


def cmd_add(a: argparse.Namespace) -> int:
    rows = read_manual()
    if any((r.get("address") or "").lower() == a.address.lower() for r in rows):
        print(f"already in {MANUAL.name}: {a.address}")
        return 1

    if a.lat is not None and a.lon is not None:
        lon, lat, via, precision = a.lon, a.lat, "supplied", "exact"
    else:
        print(f"geocoding {a.address!r} ...")
        got = geocode(a.address)
        if not got:
            print("  could not resolve it. Pass --lat and --lon, or refine the address.")
            return 1
        lon, lat, via, precision = got
    print(f"  {lat:.6f}, {lon:.6f}   via {via}")
    if precision != "exact":
        print("  ! TOWN CENTROID, not this building. The address itself is unknown to")
        print("    both geocoders. It goes on the map hollow, and stays that way until")
        print("    someone supplies --lat/--lon.")

    # Warn, do not block: a second building on one campus is legitimate, and
    # only the person adding it can tell that from a duplicate.
    if SITES.exists():
        near = []
        for r in csv.DictReader(SITES.open()):
            if not r.get("lat"):
                continue
            d = km(float(r["lon"]), float(r["lat"]), lon, lat)
            if d <= NEAR_KM:
                near.append((d, r))
        for d, r in sorted(near)[:5]:
            print(f"  ! {d*1000:.0f} m from {(r['name'] or r['epoch_name'] or '(unnamed)')[:38]}"
                  f"  [{r.get('operator') or 'operator unknown'}]  {r['site_id']}")
        if near:
            print("    dedupe merges anything within 500 m of the same operator into one site.")

    cc = iso2(a.address, a.country)
    if not cc:
        print("  ! country not recognised from the address; pass --country XX")
        return 1

    rows.append({
        "name": a.name or "", "operator": a.operator or "", "address": a.address,
        "city": a.city or "", "country": cc,
        "lat": f"{lat:.6f}", "lon": f"{lon:.6f}",
        "facility_type": a.type, "power_mw_it": a.mw or "", "ref": a.ref or "",
        "geo_precision": precision,
        "utility": a.utility or "", "note": a.note or "",
        "added": time.strftime("%Y-%m-%d"),
    })
    write_manual(rows)
    print(f"\nwrote {MANUAL.relative_to(ROOT)}  ({len(rows)} manual site"
          f"{'' if len(rows) == 1 else 's'})")
    print("next: python3 manual.py build && python3 peeringdb.py && python3 dedupe.py")
    return 0


def cmd_link(a: argparse.Namespace) -> int:
    """Attach a link to a site by hand.

    match_site_links.py derives links by proving which published page belongs
    to which building, and refuses when it cannot. Some links it can never
    derive: datacenters.com sits behind a bot wall, so nothing there is
    reachable by any scraper, and a person who knows the right page is the
    only way that link exists.

    Kept in its own file for the same reason manual_sites.csv is - the
    generated site_links.json is rebuilt from nothing on every run.
    """
    sites = {r["site_id"]: r for r in csv.DictReader(SITES.open())}
    if a.site_id not in sites:
        print(f"no such site: {a.site_id}")
        return 1
    if not a.url.startswith(("http://", "https://")):
        print("url must be absolute")
        return 1
    site = sites[a.site_id]

    rows = list(csv.DictReader(LINKS.open())) if LINKS.exists() else []
    rows = [r for r in rows if not (r["site_id"] == a.site_id and r["url"] == a.url)]
    rows.append({"site_id": a.site_id, "url": a.url,
                 "label": a.label or urllib.parse.urlparse(a.url).netloc,
                 "note": a.note or "", "added": time.strftime("%Y-%m-%d")})
    with LINKS.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=LINK_COLUMNS,
                           extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print(f"linked {site.get('name') or site.get('epoch_name') or a.site_id}")
    print(f"   -> {a.url}")
    print(f"\nwrote {LINKS.relative_to(ROOT)}  ({len(rows)} manual link"
          f"{'' if len(rows) == 1 else 's'})")
    print("next: python3 match_site_links.py")
    return 0


def cmd_list(_a: argparse.Namespace) -> int:
    rows = read_manual()
    if not rows:
        print(f"no manual sites yet - add one with `manual.py add \"<address>\"`")
        return 0
    print(f"{len(rows)} manual site{'' if len(rows) == 1 else 's'} in "
          f"{MANUAL.relative_to(ROOT)}\n")
    for r in rows:
        print(f"  {(r['name'] or '(unnamed)')[:34]:<36}{(r['operator'] or '—')[:20]:<22}"
              f"{r['country']}  {r['lat']},{r['lon']}  added {r['added']}")
        print(f"      {r['address']}")
        if r.get("note"):
            print(f"      note: {r['note']}")
    return 0


def cmd_build(_a: argparse.Namespace) -> int:
    """Fold the manual rows into the pipeline, between epoch.py and peeringdb.py."""
    if not SRC.exists():
        raise SystemExit(f"{SRC.relative_to(ROOT)} missing - run epoch.py first")
    base = list(csv.DictReader(SRC.open()))
    cols = list(base[0].keys())
    manual = read_manual()

    added = []
    for r in manual:
        if not r.get("lat") or not r.get("lon"):
            print(f"  ! skipped, no coordinate: {r.get('address')}")
            continue
        row = {c: "" for c in cols}
        row.update({
            "facility_type": r.get("facility_type") or "traditional",
            "source": "manual",
            "name": r.get("name", ""),
            "operator": r.get("operator", ""),
            "country": r.get("country", ""),
            "lat": r["lat"], "lon": r["lon"],
            # Carried from what the geocoder actually achieved, not assumed:
            # a town centroid must not claim to be a located building.
            "geo_precision": r.get("geo_precision") or "exact",
            "address": r.get("address", ""),
            "city": r.get("city", ""),
            "utility": r.get("utility", ""),
            "ref": r.get("ref", ""),
            "power_mw_it": r.get("power_mw_it", ""),
        })
        added.append(row)

    with OUT.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=cols,
                           extrasaction="ignore")
        w.writeheader()
        w.writerows(base + added)
    print(f"wrote {OUT.relative_to(ROOT)}  ({len(base):,} + {len(added)} manual "
          f"= {len(base) + len(added):,} rows)")
    if added:
        print("  peeringdb.py reads this file; run it then dedupe.py to publish.")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("add", help="add one site by address")
    a.add_argument("address")
    a.add_argument("--name", help="what to call it on the map")
    a.add_argument("--operator", help="who runs it")
    a.add_argument("--city")
    a.add_argument("--country", help="ISO2, if it cannot be read off the address")
    a.add_argument("--lat", type=float, help="skip geocoding")
    a.add_argument("--lon", type=float, help="skip geocoding")
    a.add_argument("--type", choices=["traditional", "ai"], default="traditional")
    a.add_argument("--mw", help="IT load in MW, if known")
    a.add_argument("--ref", help="facility code, e.g. MWH01")
    a.add_argument("--utility")
    a.add_argument("--note", help="how you know - this is the provenance")
    a.set_defaults(fn=cmd_add)

    l = sub.add_parser("link", help="attach a URL to a site by hand")
    l.add_argument("site_id")
    l.add_argument("url")
    l.add_argument("--label", help="link text; defaults to the domain")
    l.add_argument("--note", help="how you know this is the right page")
    l.set_defaults(fn=cmd_link)

    sub.add_parser("list", help="show the manual sites").set_defaults(fn=cmd_list)
    sub.add_parser("build", help="fold them into the pipeline").set_defaults(fn=cmd_build)

    args = p.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
