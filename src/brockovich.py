"""Import the Brockovich AI Data Center map.

    python3 brockovich.py [--write]

https://www.brockovichdatacenter.com/ is an advocacy site - Erin Brockovich's
project documenting AI data centre build-out and collecting community reports
about water, power and noise. It is not a neutral registry and does not claim
to be. It is still worth ingesting, for one reason the neutral sources cannot
match: 89 of its 146 entries are CONSTRUCTION or PROPOSED, and every single
entry carries its own source citation.

That is exactly the population this registry is worst at. OSM cannot draw a
building that does not exist yet and PeeringDB cannot see a facility with no
interconnection, so pre-operational sites are structurally invisible to both.

WHAT IT COSTS
Coordinates are approximate. Many entries are a county or a town - "Loudoun
County, VA", "Madison County, MS" - not a located building, so they are
imported at geo_precision "town" unless they land within 500 m of something
already known. A naive 3 km spatial dedup called 117 of 146 net-new; matching
on operator and name as well brings that to 95, and the difference was
entirely coordinate slop on sites we already hold.

Status is theirs, not ours: operational / construction / proposed, kept
verbatim in the status column rather than mapped onto anything.

robots.txt is `Allow: /`. The data is a plain `var centers = [...]` array
inline in the page, not an API, so this parses the literal - with comments and
JS escapes in it, which is why it is read record by record rather than as
JSON.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import pathlib
import re
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITES = ROOT / "data" / "facilities_sites.csv"
OUT = ROOT / "data" / "brockovich_sites.csv"
CACHE = ROOT / "data" / "raw" / "brockovich.html"
URL = "https://www.brockovichdatacenter.com/"

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"}

FIELDS = ("name", "company", "city", "lat", "lng", "status", "note", "source")
COLUMNS = ["name", "operator", "city", "country", "lat", "lon", "geo_precision",
           "status", "note", "source", "url"]

# Under this, it is the same building someone else already mapped and the
# precise coordinate wins. Above it, keep ours but flag the precision.
SAME_KM = 0.5
NEAR_KM = 25.0


def km(lon_a, lat_a, lon_b, lat_b) -> float:
    return math.hypot((lon_a - lon_b) * 111.32 * math.cos(math.radians((lat_a + lat_b) / 2)),
                      (lat_a - lat_b) * 111.32)


def fetch() -> str:
    if CACHE.exists():
        return CACHE.read_text(errors="ignore")
    req = urllib.request.Request(URL, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode("utf-8", errors="ignore")
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(body)
    return body


def parse(page: str) -> list[dict]:
    """Pull `var centers = [...]` out of the page, record by record.

    Not json.loads: the literal carries `// === OPERATIONAL ===` section
    comments and JS string escapes that are not valid JSON, and stripping
    those with a regex risks mangling the notes, which contain the citations.
    """
    m = re.search(r"var\s+centers\s*=\s*\[", page)
    if not m:
        raise SystemExit("the `centers` array is gone - the page layout changed")
    i, depth, j = m.end() - 1, 0, m.end() - 1
    while j < len(page):
        if page[j] == "[":
            depth += 1
        elif page[j] == "]":
            depth -= 1
            if depth == 0:
                break
        j += 1
    body = page[i:j + 1]

    def field(rec: str, key: str) -> str:
        s = re.search(rf'\b{key}\s*:\s*"((?:[^"\\]|\\.)*)"', rec)
        if s:
            return s.group(1).replace("\\'", "'").replace('\\"', '"')
        n = re.search(rf"\b{key}\s*:\s*(-?[\d.]+)", rec)
        return n.group(1) if n else ""

    out = []
    for rec in re.findall(r"\{[^{}]*\}", body):
        if "lat" not in rec:
            continue
        out.append({k: field(rec, k) for k in FIELDS})
    return out


def iso2(city: str) -> str:
    """Their `city` is "Memphis, TN" style - US unless it says otherwise."""
    tail = (city or "").rsplit(",", 1)[-1].strip().lower()
    return {"uk": "GB", "england": "GB", "ireland": "IE", "canada": "CA",
            "mexico": "MX", "chile": "CL", "brazil": "BR", "india": "IN",
            "japan": "JP", "norway": "NO", "sweden": "SE", "finland": "FI",
            "denmark": "DK", "france": "FR", "germany": "DE", "spain": "ES",
            "netherlands": "NL", "poland": "PL"}.get(tail, "US")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--write", action="store_true",
                    help="write data/brockovich_sites.csv")
    a = ap.parse_args()

    centers = parse(fetch())
    print(f"parsed {len(centers)} entries from {URL}")
    by_status: dict[str, int] = {}
    for c in centers:
        by_status[c["status"]] = by_status.get(c["status"], 0) + 1
    print(f"  status: {by_status}")
    print(f"  with a source citation: {sum(1 for c in centers if c['source'])}")

    rows = list(csv.DictReader(SITES.open()))
    pts = [(float(r["lon"]), float(r["lat"]), r) for r in rows if r.get("lat")]

    def toks(v: str) -> set:
        return {t for t in re.sub(r"[^a-z0-9 ]", " ", (v or "").lower()).split() if len(t) > 2}

    sys.path.insert(0, str(ROOT / "src"))
    from operators import canon                                  # noqa: E402

    out, exact_dupe, near_dupe = [], 0, 0
    for c in centers:
        try:
            lon, lat = float(c["lng"]), float(c["lat"])
        except ValueError:
            continue
        ck = canon(c["company"])
        hit = None
        for x, y, r in pts:
            d = km(x, y, lon, lat)
            if d <= SAME_KM:
                hit = ("same", r)
                break
            # Their coordinate is often a county centroid, so a name+operator
            # agreement at distance is stronger evidence than the distance is
            # against. Without this, 22 sites we already hold looked new.
            if d <= NEAR_KM and ck and ck == canon(r.get("operator", "")) \
               and toks(c["name"]) & toks(r.get("name") or r.get("epoch_name") or ""):
                hit = ("near", r)
                break
        if hit and hit[0] == "same":
            exact_dupe += 1
            continue
        if hit:
            near_dupe += 1
            continue
        out.append({
            "name": c["name"], "operator": c["company"], "city": c["city"],
            "country": iso2(c["city"]), "lat": f"{lat:.6f}", "lon": f"{lon:.6f}",
            # A county or town label is not a located building, and saying so
            # is the difference between a hollow dot and a false claim.
            "geo_precision": "town",
            "status": c["status"], "note": c["note"], "source": c["source"],
            "url": URL,
        })

    print(f"\n  already held, within {SAME_KM*1000:.0f} m : {exact_dupe}")
    print(f"  already held, name+operator agree : {near_dupe}")
    print(f"  NET NEW                          : {len(out)}")
    ns: dict[str, int] = {}
    for r in out:
        ns[r["status"]] = ns.get(r["status"], 0) + 1
    print(f"  net-new by status: {ns}")

    if a.write:
        with OUT.open("w", newline="") as fh:
            w = csv.DictWriter(fh, lineterminator="\n", fieldnames=COLUMNS,
                               extrasaction="ignore")
            w.writeheader()
            w.writerows(out)
        print(f"\nwrote {OUT.relative_to(ROOT)}")
        print("  Attribution: Brockovich AI Data Center Reporting, "
              "brockovichdatacenter.com")
    else:
        print("\n  (dry run - pass --write to emit the CSV)")


if __name__ == "__main__":
    main()
