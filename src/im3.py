"""IM3 Open Source Data Center Atlas (PNNL / DOE) - Virginia subset.

OSM-derived but curated: 317 Virginia records, 98% carrying a `sqft` measured
from the building polygon, plus a building/campus/point type distinction.

The value here is that `sqft` is an *independent measurement* of what is built,
whereas county records carry declared gross floor area for what was permitted.
Comparing them is a data-quality check, not a merge - see the footprint-vs-GFA
caveat in compare().

Source: https://github.com/IMMM-SFA/datacenter-atlas
"""

from __future__ import annotations

import csv
import json
import pathlib
import sys
import urllib.request

import geo

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
RAW.mkdir(parents=True, exist_ok=True)
DEST = RAW / "im3_footprints.geojson"

URL = ("https://raw.githubusercontent.com/IMMM-SFA/datacenter-atlas/main/"
       "static/im3_datacenter_footprints.geojson")

# Prefer a local MSD-LIVE release if one has been downloaded. That is the
# citable, versioned artifact (https://data.msdlive.org/records/p147s-4h760);
# the GitHub file is the working repo and lags it slightly - v2026.02.09 has
# 319 Virginia records against GitHub's 317.
LOCAL_GLOB = "im3_open_source_data_center_atlas_*/im3_open_source_data_center_atlas_*.csv"


def local_release() -> pathlib.Path | None:
    found = sorted(ROOT.glob(LOCAL_GLOB))
    return found[-1] if found else None


def fetch(force: bool = False) -> dict:
    if DEST.exists() and not force:
        return json.loads(DEST.read_text())
    req = urllib.request.Request(URL, headers={"User-Agent": "reinsurance_dc-research/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        payload = json.loads(r.read().decode("utf-8", "replace"))
    DEST.write_text(json.dumps(payload))
    return payload


def _num(v) -> float:
    try:
        return float(str(v).replace(",", "").strip() or 0)
    except ValueError:
        return 0.0


def load(state: str | None = "VA") -> list[dict]:
    """Atlas rows, from the local MSD-LIVE release when present.

    `state` is a two-letter abbreviation, or None for every state - the Atlas
    is US-only (50 states, 1,479 records in v2026.02.09).
    """
    src = local_release()
    out = []
    if src:
        for r in csv.DictReader(src.open(encoding="utf-8-sig")):
            if state and r.get("state_abb") != state:
                continue
            if not r.get("lon") or not r.get("lat"):
                continue
            out.append({
                "name": r.get("name") or "", "operator": r.get("operator") or "",
                "county": r.get("county") or "", "type": r.get("type") or "",
                "state": r.get("state_abb") or "", "ref": r.get("ref") or "",
                "sqft": _num(r.get("sqft")),
                "lon": round(float(r["lon"]), 6), "lat": round(float(r["lat"]), 6),
            })
        return out
    for ft in fetch().get("features", []):
        p = ft.get("properties") or {}
        if state and p.get("state_abb") != state:
            continue
        c = geo.centroid(ft.get("geometry"))
        if not c:
            continue
        out.append({
            "name": p.get("name") or "", "operator": p.get("operator") or "",
            "county": p.get("county") or "", "type": p.get("type") or "",
            "state": p.get("state_abb") or "", "ref": "",
            "sqft": _num(p.get("sqft")),
            "lon": round(c[0], 6), "lat": round(c[1], 6),
        })
    return out


def compare(registry: pathlib.Path) -> None:
    """Match registry rows to IM3 footprints and report size agreement.

    Not a merge. County `sq_ft` is declared gross floor area across all storeys;
    IM3 `sqft` is a ground-plan footprint. A multi-storey hall legitimately has
    GFA well above footprint, so a high ratio is expected, not an error. What is
    diagnostic is the tail: a county GFA *below* the measured footprint cannot
    be right, and a wildly high ratio suggests a campus-vs-building mismatch.
    """
    im3 = load()
    rows = [r for r in csv.DictReader(registry.open()) if r["lat"]]

    def near(lon, lat, deg=0.0035):
        best, bd = None, deg
        for p in im3:
            d = max(abs(p["lon"] - lon), abs(p["lat"] - lat))
            if d < bd:
                best, bd = p, d
        return best

    pairs = []
    for r in rows:
        try:
            sq = float(r["sq_ft"] or 0)
        except ValueError:
            sq = 0
        m = near(float(r["lon"]), float(r["lat"]))
        if m and sq > 0 and m["sqft"]:
            pairs.append((r, m, sq / m["sqft"]))
    if not pairs:
        print("no comparable pairs")
        return

    # Two effects make the raw ratio meaningless and both must be excluded:
    #   - IM3 `campus` polygons cover many buildings, so a single county
    #     building compared against one reads far too small (median 0.35).
    #   - On dense campuses several county buildings fall within the match
    #     radius of one IM3 building; up to 9 rows collapsed onto one feature.
    # Only 1:1 building matches support a size comparison.
    from collections import Counter
    hits = Counter((p[1]["name"], p[1]["lon"], p[1]["lat"]) for p in pairs)
    clean = [p for p in pairs
             if p[1]["type"] == "building"
             and hits[(p[1]["name"], p[1]["lon"], p[1]["lat"])] == 1]

    def med(vals):
        v = sorted(vals)
        return v[len(v) // 2] if v else 0

    print(f"  candidate pairs      : {len(pairs)}")
    print(f"  excluded campus      : {sum(1 for p in pairs if p[1]['type'] == 'campus')}")
    print(f"  excluded many-to-one : {len(pairs) - len(clean) - sum(1 for p in pairs if p[1]['type'] == 'campus')}")
    print(f"  usable 1:1 buildings : {len(clean)}")
    if not clean:
        return
    below = [p for p in clean if p[2] < 1]
    print(f"  median GFA/footprint : {med([p[2] for p in clean]):.2f}"
          f"   (multi-storey halls make >1 expected)")
    print(f"  GFA below footprint  : {len(below)} ({len(below) / len(clean):.0%})"
          f"  <- cannot be right, review these")
    for r, m, ratio in sorted(below, key=lambda x: x[2])[:5]:
        print(f"      {r['locality'][:16]:<18}{(r['name'] or '?')[:24]:<26}"
              f"GFA={int(float(r['sq_ft'])):>9,}  IM3={int(m['sqft']):>9,}  {ratio:.2f}")


def main() -> None:
    state = (sys.argv[1].upper() if len(sys.argv) > 1 else "VA")
    if state in ("ALL", "US", "*"):
        state = None
    data = load(state)
    src = local_release()
    print(f"source: {src.name if src else 'GitHub footprints'}"
          f"   scope: {state or 'all states'}")
    dest = ROOT / "data" / (f"im3_{(state or 'us').lower()}.csv")
    with dest.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=["name", "operator", "county",
                                           "state", "type", "ref", "sqft", "lon", "lat"])
        w.writeheader()
        w.writerows(data)
    n = len(data)
    print(f"wrote {dest.relative_to(ROOT)}  ({n} features)")
    print(f"  operator: {sum(1 for r in data if r['operator'])}/{n}"
          f"  sqft: {sum(1 for r in data if r['sqft'])}/{n}"
          f"  total {sum(r['sqft'] or 0 for r in data) / 1e6:.1f}M sq ft")
    reg = ROOT / "data" / "registry.csv"
    if reg.exists():
        print("\nsize cross-check vs county records:")
        compare(reg)


if __name__ == "__main__":
    main()
