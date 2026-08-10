"""Build the power plant layer from EIA-860M.

    python3 plants.py [min_mw]

WHY THIS SOURCE AND NOT THE OBVIOUS ONE
The obvious one is the Esri-hosted "Power Plants in the U.S." feature service,
which is what every tutorial reaches for: 13,446 plants, coordinates, MW split
by fuel, no key. Two problems. Its item metadata carries "This work is licensed
under the Esri Master License Agreement" - the same string that stopped us
redistributing World Imagery - and every row is stamped period 202502, so it is
eighteen months stale. EIA-860M is the upstream of that service anyway: it is a
US Government work in the public domain, needs no key, and June 2026 is two
months old. One 13.9 MB request replaces a seven-page paginated pull.

It is also the only route that carries ACTUAL retirement dates rather than a
planned-retirement year, which matters more than it sounds - see below.

ONE RECORD PER PLANT, NOT PER GENERATOR
860M is a generator inventory: 28,199 operating rows resolve to 14,551 plants.
It also splits across sheets by status, and a plant can appear in all three at
once - a coal station with units retiring, the survivors still running, and a
gas unit planned on the same pad. Emitting three records would stack three dots
on one coordinate and hide the very thing worth seeing. So each plant is one
record carrying all three capacities, and the status class is derived from
which of them are non-zero.

That combination is the co-location profile. The asset at a retiring coal site
is not the boiler, it is the switchyard, the interconnection rights, the
cooling water and the fibre - which is why Homer City, Cayuga and PORTS were
bought. A layer built only from operating generators cannot see any of them.

THE FLOOR IS 100 MW
Below that a plant is not a plausible host for anything: the regulatory
thresholds that make a large load a regulated object at all run 25-75 MW
depending on the state, a hyperscale campus worth structuring around is 100 MW
and up, and to carve out a firm 100 MW you need a site materially bigger than
100 MW because the plant still has to meet its existing obligations. 100 MW
keeps 4,000-odd plants and drops 10,000 that would only be clutter. It is
deliberately well below the ~300 MW where screening actually starts, so the
threshold is the map's, not the analyst's.

WHAT THIS LAYER CANNOT TELL YOU
Nameplate is not spare capacity, and spare capacity is the field that decides
co-location deals. A 2.5 GW nuclear plant at a 92% capacity factor fully
cleared into a capacity market has effectively none; a merchant CCGT at 45% has
real headroom. Ranking by nameplate ranks the least available plants first.
Nothing public carries the number - it needs capacity-auction clearing,
bilateral hedge books and interconnection service levels - so this ships fuel
and capacity factor's proxy (technology) and leaves the judgement to the user.
"""

from __future__ import annotations

import collections
import json
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "power_plants.json"

# Pinned rather than "latest": EIA names each month's file, and a floating URL
# would make the committed JSON irreproducible. Bump both together.
VINTAGE = "June 2026"
SRC = "https://www.eia.gov/electricity/data/eia860m/xls/june_generator2026.xlsx"

SHEETS = [
    ("Operating", "op"), ("Planned", "pl"), ("Retired", "re"),
    ("Operating_PR", "op"), ("Planned_PR", "pl"), ("Retired_PR", "re"),
]

# EIA's Technology column has 25-odd values; the map needs a handful. Grouped
# by what a siting question actually asks, which is why pumped storage sits
# with hydro (it is a dam) and not with batteries (it is not a shed).
FUEL = {
    "Nuclear": "nuclear",
    "Conventional Steam Coal": "coal",
    "Coal Integrated Gasification Combined Cycle": "coal",
    "Petroleum Coke": "coal",
    "Natural Gas Fired Combined Cycle": "gas",
    "Natural Gas Fired Combustion Turbine": "gas",
    "Natural Gas Steam Turbine": "gas",
    "Natural Gas Internal Combustion Engine": "gas",
    "Natural Gas with Compressed Air Storage": "gas",
    "Other Natural Gas": "gas",
    "Other Gases": "gas",
    "Petroleum Liquids": "oil",
    "Conventional Hydroelectric": "hydro",
    "Hydroelectric Pumped Storage": "hydro",
    "Onshore Wind Turbine": "wind",
    "Offshore Wind Turbine": "wind",
    "Solar Photovoltaic": "solar",
    "Solar Thermal with Energy Storage": "solar",
    "Solar Thermal without Energy Storage": "solar",
    "Batteries": "storage",
    "Flywheels": "storage",
    "Geothermal": "other",
    "Wood/Wood Waste Biomass": "other",
    "Landfill Gas": "other",
    "Municipal Solid Waste": "other",
    "Other Waste Biomass": "other",
    "All Other": "other",
}


def num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def year(v) -> int | None:
    y = int(num(v))
    # 860M leaves the cell blank rather than zero, but a stray 0 or a two-digit
    # year would render as a plausible-looking date, so bound it.
    return y if 1880 <= y <= 2100 else None


def fetch(url: str, dest: pathlib.Path) -> pathlib.Path:
    if dest.exists():
        return dest
    req = urllib.request.Request(url, headers={"User-Agent": "reinsurance_dc-research/1.0"})
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(req, timeout=300) as r:
        dest.write_bytes(r.read())
    return dest


def main() -> None:
    min_mw = float(sys.argv[1]) if len(sys.argv) > 1 else 100.0
    import openpyxl

    xlsx = fetch(SRC, RAW / "eia860m_june2026.xlsx")
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)

    def rows(sheet):
        ws = wb[sheet]
        it = ws.iter_rows(values_only=True)
        for _ in range(2):          # two title lines above the header
            next(it)
        hdr = [str(c).strip() if c else "" for c in next(it)]
        for r in it:
            d = dict(zip(hdr, r))
            if d.get("Plant ID"):
                yield d

    plants: dict[int, dict] = {}
    gens = 0
    for sheet, cls in SHEETS:
        for d in rows(sheet):
            gens += 1
            pid = int(d["Plant ID"])
            p = plants.setdefault(pid, {
                "id": pid, "n": (d.get("Plant Name") or "").strip(),
                "lat": None, "lon": None,
                "st": (d.get("Plant State") or "").strip(),
                "ba": (d.get("Balancing Authority Code") or "").strip(),
                "own": (d.get("Entity Name") or "").strip(),
                "mw": 0.0, "pmw": 0.0, "rmw": 0.0, "xmw": 0.0, "u": 0,
                "tech": collections.Counter(), "y": None, "ry": None,
            })
            mw = num(d.get("Nameplate Capacity (MW)"))
            p["mw" if cls == "op" else "pmw" if cls == "pl" else "rmw"] += mw

            # Fuel is decided by MW, not by unit count: a 1,200 MW coal station
            # with four little diesel black-start sets is a coal station.
            # Operating capacity outvotes the rest, so a retired coal site with
            # a new gas unit running reads as gas, which is what it now is.
            p["tech"][d.get("Technology") or "Other"] += mw * (4 if cls == "op" else 1)

            # Coordinates from the largest generator seen. Every row of a plant
            # carries the same pair in practice, but a blank on one row would
            # otherwise win by arriving last.
            if p["lat"] is None and d.get("Latitude") is not None:
                p["lat"], p["lon"] = num(d["Latitude"]), num(d["Longitude"])

            if cls == "op":
                p["u"] += 1
                oy = year(d.get("Operating Year"))
                if oy and (p["y"] is None or oy < p["y"]):
                    p["y"] = oy
                # EARLIEST announced retirement, not latest: the first unit to
                # go is when the interconnection starts freeing up, and that is
                # the date a siting question is asking about.
                ry = year(d.get("Planned Retirement Year"))
                if ry:
                    # Only the units actually leaving. The whole plant's
                    # nameplate would say a 2.4 GW station is retiring when one
                    # 90 MW peaker is, and that is the number a siting question
                    # would act on.
                    p["xmw"] += mw
                    if p["ry"] is None or ry < p["ry"]:
                        p["ry"] = ry
            elif cls == "re":
                ry = year(d.get("Retirement Year"))
                # For a plant with nothing left running this is the date the
                # site went dark, so the LAST unit is the meaningful one.
                if ry and (p["ry"] is None or ry > p["ry"]):
                    p["ry"] = ry
            else:
                py = year(d.get("Planned Operation Year"))
                if py and (p["y"] is None or py < p["y"]):
                    p["y"] = py

    out, dropped, nocoord = [], 0, 0
    for p in plants.values():
        big = max(p["mw"], p["pmw"], p["rmw"])
        if big < min_mw:
            dropped += 1
            continue
        if p["lat"] is None or (p["lat"] == 0 and p["lon"] == 0):
            nocoord += 1
            continue
        tech = p["tech"].most_common(1)[0][0]
        rec = {
            "id": p["id"], "n": p["n"], "lat": round(p["lat"], 4), "lon": round(p["lon"], 4),
            "mw": round(p["mw"]), "st": p["st"], "ba": p["ba"], "own": p["own"],
            "f": FUEL.get(tech, "other"), "tech": tech, "u": p["u"],
            # Status is derived, never read from a column: "retired" means
            # nothing is running here now, which no single 860M field says.
            "k": "op" if p["mw"] > 0 else ("plan" if p["pmw"] > 0 else "ret"),
        }
        if p["pmw"]:
            rec["pmw"] = round(p["pmw"])
        if p["rmw"]:
            rec["rmw"] = round(p["rmw"])
        if p["xmw"]:
            rec["xmw"] = round(p["xmw"])
        if p["y"]:
            rec["y"] = p["y"]
        if p["ry"]:
            rec["ry"] = p["ry"]
        out.append(rec)

    # Biggest first so the map draws the ones that matter on top of the ones
    # that do not, without a sort expression in the paint.
    out.sort(key=lambda r: -(r["mw"] or r.get("rmw", 0) or r.get("pmw", 0)))
    OUT.write_text(json.dumps(out, separators=(",", ":")))

    by_k = collections.Counter(r["k"] for r in out)
    by_f = collections.Counter(r["f"] for r in out)
    print(f"EIA-860M {VINTAGE}: {gens:,} generator rows -> {len(plants):,} plants")
    print(f"  dropped below {min_mw:.0f} MW: {dropped:,}   no usable coordinate: {nocoord}")
    print(f"  kept: {len(out):,}   operating {by_k['op']:,} · retired {by_k['ret']:,} · planned-only {by_k['plan']:,}")
    print("  by fuel: " + " · ".join(f"{k} {v:,}" for k, v in by_f.most_common()))
    print(f"  operating capacity mapped: {sum(r['mw'] for r in out):,.0f} MW")
    ret = [r for r in out if r.get("xmw")]
    print(f"  plants with an announced retirement: {len(ret):,} "
          f"({sum(r['xmw'] for r in ret):,.0f} MW leaving, soonest {min(r['ry'] for r in ret)})")
    dark = [r for r in out if r["k"] == "ret"]
    print(f"  already dark, interconnection may be reusable: {len(dark):,} "
          f"({sum(r.get('rmw', 0) for r in dark):,.0f} MW was there)")
    print(f"wrote {OUT.relative_to(ROOT)}  ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
