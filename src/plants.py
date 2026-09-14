"""Build the power plant layer: EIA-860M for the US, GEM for the rest of it.

    python3 plants.py [min_mw]

TWO SOURCES, BECAUSE NO ONE SOURCE IS BOTH GLOBAL AND GOOD
Three quarters of the registry - 4,689 of 6,249 geocoded sites - is outside
the US, and a US-only generation layer leaves all of them with no context at
all. But the US has a public-domain national inventory that no global source
matches, so this takes both and lets EIA win where they overlap.

  EIA-860M   United States. Public domain, June 2026, and the only source
             carrying real retirement dates, per-plant unit counts and the
             balancing authority. See below.
  GEM GIPT   Everywhere else. Global Energy Monitor's Global Integrated Power
             Tracker, August 2026, CC BY 4.0. 182,592 unit rows across eight
             asset types, every one geocoded.

GEM covers the US too, at 16,966 rows, and all of it is discarded: EIA is
richer for the same ground. Nothing is merged per plant - each record comes
whole from one source - so there is no reconciliation to get wrong, only a
country test.

ATTRIBUTION IS A LICENCE CONDITION
CC BY 4.0 permits the redistribution this does, and requires credit. The
layer carries it in the panel; do not remove it. Read from the ungated CSV
that backs GEM's own public map rather than the registration-gated bulk
download, at the user's explicit direction.

WHAT GEM DOES NOT HAVE
No battery storage: batteries are a separate GEM tracker, not part of the
integrated power one, so the Storage chip is US-only and a global view of it
would be a lie of omission if it were not stated here. Cancelled and shelved
projects are dropped - they are not going to exist. Mothballed is filed under
retired, because nothing is running, though its interconnection is live and
that is arguably the interesting case.

Roughly 55% of GEM plants above 100 MW carry an APPROXIMATE coordinate rather
than an exact one, which is flagged per record and drawn differently. The
share improves with size - above 300 MW the majority are exact - but a dot
that is only right to the town has to say so, the same way a town-geocoded
data centre does.

WHY EIA AND NOT THE OBVIOUS US SOURCE
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
import csv
import json
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "power_plants.json"

# Pinned rather than "latest": both publishers name each release, and a
# floating URL would make the committed JSON irreproducible. Bump together.
VINTAGE = "July 2026"
# EIA moves the previous month to /archive/xls/ the moment a new one lands, so
# THIS URL HAS AN EXPIRY DATE: when August publishes (2026-09-24), july at
# /xls/ starts 301-ing and its real home becomes
# .../eia860m/archive/xls/july_generator2026.xlsx. Bumping the month means
# bumping the path too, and back-month links must be rewritten to /archive/.
# Beware the landing page: it lists all twelve months of the year including
# ones not yet published, so link presence is not evidence a file exists.
SRC = "https://www.eia.gov/electricity/data/eia860m/xls/july_generator2026.xlsx"

GEM_VINTAGE = "August 2026"
# The path says Current_maps and means it: only the newest release is up there.
# 2026-06 and 2026-07 were already 404 the day 2026-08 was pulled, so a pinned
# month is a URL with an expiry date on it and there is no archive to fall back
# to. So try the current month first, then walk back a few, and if the whole
# window is gone say what to do about it rather than dying on a 404.
GEM_MONTHS_BACK = 4
GEM_URL = ("https://publicgemdata.nyc3.cdn.digitaloceanspaces.com/Current_maps"
           "/integrated-power/{m}/integrated_map_{m}.csv")
GEM_FALLBACK = "2026-08"     # the release this file's counts were written from
# Reproduced under CC BY 4.0. This string is a licence condition, not decoration
# - it is rendered in the layers panel. https://globalenergymonitor.org
GEM_CREDIT = "Global Energy Monitor, Global Integrated Power Tracker"
GEM_MANUAL = (
    "Could not reach any GEM monthly release in the last "
    f"{GEM_MONTHS_BACK} months.\n"
    "  The CDN keeps only the current one, so this happens if the path shape\n"
    "  changed. Two ways out:\n"
    "    1. Find the current URL under https://globalenergymonitor.org and\n"
    "       update GEM_URL.\n"
    "    2. Download the tracker XLSX from their /download-data form (it asks\n"
    "       for a name, organisation and a use case), convert it to CSV and\n"
    "       drop it at data/raw/gem_integrated_power_<month>.csv.\n"
    "  data/power_plants.json is committed, so the app keeps working meanwhile."
)

# GEM's eight asset types onto the same fuel classes EIA maps onto. oil/gas is
# the one that needs the row's own fuel string to split, and its order matters:
# a dual-fuel unit reads "fossil gas: natural gas, fossil liquids: fuel oil",
# gas first, and gas is what it burns most of.
GEM_FUEL = {
    "nuclear": "nuclear", "coal": "coal", "hydropower": "hydro",
    "wind": "wind", "utility-scale solar": "solar",
    "bioenergy": "other", "geothermal": "other",
}
# operating -> op, anything being built or promised -> plan, anything stopped
# -> ret. cancelled and shelved are dropped entirely rather than mapped: they
# are not going to exist, and a dot for one is a dot for nothing.
GEM_STATUS = {
    "operating": "op",
    "construction": "plan", "pre-construction": "plan", "announced": "plan",
    "retired": "ret", "mothballed": "ret",
}

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


# GEM names countries in prose ("United States", "Czechia") and EIA does not
# name them at all. Everything else in this app - sites, fabs, the operator
# directory's region table - keys on ISO 3166-1 alpha-2, so a plant layer that
# says "China" cannot be grouped by region alongside them. Natural Earth is
# already in the repo for the basemap and carries both, so it is the mapping.
_ISO2 = None


def iso2(name: str) -> str:
    """ISO2 for a country name, or '' when Natural Earth has never heard of it."""
    global _ISO2
    if _ISO2 is None:
        _ISO2 = {}
        geo = json.loads((ROOT / "data" / "raw" / "ne_countries.geojson").read_text())
        for f in geo["features"]:
            pr = f["properties"]
            code = (pr.get("ISO_A2_EH") or pr.get("ISO_A2") or "").strip().upper()
            if not code or code == "-99":
                continue
            for key in ("NAME", "NAME_LONG", "ADMIN", "BRK_NAME", "NAME_CIAWF", "NAME_SORT"):
                v = (pr.get(key) or "").strip().lower()
                if v:
                    _ISO2.setdefault(v, code)
        # Names GEM uses that Natural Earth spells differently. Kept short and
        # explicit rather than fuzzy-matched: a wrong country is worse than a
        # blank one, and a fuzzy matcher would have to be trusted silently.
        _ISO2.update({
            "united states": "US", "usa": "US", "south korea": "KR",
            "north korea": "KP", "russia": "RU", "vietnam": "VN", "laos": "LA",
            "syria": "SY", "iran": "IR", "tanzania": "TZ", "bolivia": "BO",
            "venezuela": "VE", "moldova": "MD", "brunei": "BN", "czechia": "CZ",
            "czech republic": "CZ", "turkiye": "TR", "turkey": "TR",
            "ivory coast": "CI", "cote d'ivoire": "CI", "cape verde": "CV",
            "democratic republic of the congo": "CD", "republic of the congo": "CG",
            "congo": "CG", "myanmar": "MM", "burma": "MM", "swaziland": "SZ",
            "eswatini": "SZ", "macedonia": "MK", "north macedonia": "MK",
            "east timor": "TL", "timor-leste": "TL", "palestine": "PS",
            "hong kong": "HK", "macau": "MO", "taiwan": "TW",
            "bosnia and herzegovina": "BA", "united kingdom": "GB", "uk": "GB",
            # Natural Earth ships 177 features at 110m, so every small island
            # state and overseas territory is simply absent from it. Plus
            # "Türkiye", which fails on the diaeresis rather than on absence.
            "türkiye": "TR", "åland islands": "AX", "dr congo": "CD",
            "bahrain": "BH", "singapore": "SG", "isle of man": "IM",
            "guernsey": "GG", "jersey": "JE", "malta": "MT", "macao": "MO",
            "gibraltar": "GI", "réunion": "RE", "reunion": "RE",
            "martinique": "MQ", "guadeloupe": "GP", "guam": "GU", "aruba": "AW",
            "cayman islands": "KY", "mauritius": "MU", "dominica": "DM",
            "french guiana": "GF", "bermuda": "BM", "barbados": "BB",
            "maldives": "MV",
        })
    return _ISO2.get((name or "").strip().lower(), "")


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


def load_eia(min_mw: float) -> tuple[list[dict], str]:
    import openpyxl

    # Derived from the URL, not written out again: a hardcoded "june" here
    # would have quietly served the old workbook after SRC was bumped.
    xlsx = fetch(SRC, RAW / ("eia860m_" + SRC.rsplit("/", 1)[-1].replace("_generator", "")))
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
                "tech": collections.Counter(), "y": None,
                # TWO retirement facts, never one. See the note at emit time.
                "ry": None,     # earliest ANNOUNCED retirement, units still running
                "dark": None,   # last ACTUAL retirement, i.e. the lights went out
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
                # A unit that HAS retired, which is a different fact from a
                # unit that is DUE to. Kept apart: this used to write p["ry"]
                # too, so a station with old units gone and new ones running
                # reported a retirement year in the past while still generating.
                if ry and (p["dark"] is None or ry > p["dark"]):
                    p["dark"] = ry
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
            "id": f"e{p['id']}", "n": p["n"],
            "lat": round(p["lat"], 4), "lon": round(p["lon"], 4),
            "mw": round(p["mw"]), "cy": "US", "st": p["st"], "ba": p["ba"], "own": p["own"],
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
        # ONE ry ON THE WIRE, AND IT MEANS ONE THING PER STATUS. A plant that
        # is still running reports the retirement it has ANNOUNCED; a plant
        # with nothing left running reports when it went dark. Emitting the
        # other one would be answering a question nobody asked: a dead
        # station's announced dates are moot, and a live station's history of
        # closed units is not its retirement date.
        ry = p["ry"] if rec["k"] == "op" else p["dark"]
        if ry:
            rec["ry"] = ry
        out.append(rec)

    return out, (f"EIA-860M {VINTAGE}: {gens:,} generator rows -> {len(plants):,} plants, "
                 f"{dropped:,} below {min_mw:.0f} MW, {nocoord} without a coordinate")


def gem_fuel(row: dict) -> str:
    at = (row.get("asset-type") or "").strip()
    if at != "oil/gas":
        return GEM_FUEL.get(at, "other")
    f = (row.get("fuel") or "").lower()
    # Gas first: dual-fuel units list the gas before the liquid, and that is
    # what they burn most of. Blast furnace gas and the other by-products fall
    # through to gas too, which is what they are.
    if "fossil liquids" in f and "fossil gas" not in f:
        return "oil"
    return "gas"


def gem_months() -> list[str]:
    """Current month first, then back GEM_MONTHS_BACK, then the pinned one."""
    import datetime as dt
    d = dt.date.today().replace(day=1)
    out = []
    for _ in range(GEM_MONTHS_BACK):
        out.append(f"{d.year:04d}-{d.month:02d}")
        d = (d - dt.timedelta(days=1)).replace(day=1)
    if GEM_FALLBACK not in out:
        out.append(GEM_FALLBACK)
    return out


def gem_csv() -> pathlib.Path:
    # A month already on disk wins outright - no point asking the CDN whether
    # last month still exists when we have last month.
    for m in gem_months():
        dest = RAW / f"gem_integrated_power_{m}.csv"
        if dest.exists():
            return dest
    for m in gem_months():
        dest = RAW / f"gem_integrated_power_{m}.csv"
        try:
            return fetch(GEM_URL.format(m=m), dest)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
            # fetch writes only after a clean read, so a 404 leaves no stub.
            continue
    raise SystemExit(GEM_MANUAL)


def load_gem(min_mw: float) -> tuple[list[dict], str]:
    path = gem_csv()
    with path.open(encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))

    plants: dict[str, dict] = {}
    skipped_us = dead = 0
    for r in rows:
        # EIA owns the US. GEM carries 16,966 rows there and every one is
        # dropped rather than reconciled - a record comes whole from one source
        # or the other, so there is no merge to get subtly wrong.
        if (r.get("country-area1") or "").strip() == "United States":
            skipped_us += 1
            continue
        k = GEM_STATUS.get((r.get("status") or "").strip())
        if k is None:
            dead += 1
            continue
        pid = (r.get("project-id") or "").strip()
        lat, lon = num(r.get("Latitude")), num(r.get("Longitude"))
        if not pid or (lat == 0 and lon == 0):
            continue
        p = plants.setdefault(pid, {
            "id": "g" + pid, "n": (r.get("name") or "").strip(),
            "lat": lat, "lon": lon,
            "cy": (r.get("country-area1") or "").strip(),
            "own": clean_owner(r.get("parent") or r.get("owner") or ""),
            "mw": 0.0, "pmw": 0.0, "rmw": 0.0, "u": 0,
            "fuel": collections.Counter(), "tech": collections.Counter(),
            "y": None, "ry": None, "dark": None,
            # GEM grades its own coordinates. Over half of these are only good
            # to the settlement, and a dot that precise-looking has to admit it.
            "ax": 1 if (r.get("location-accuracy") or "").lower() == "approximate" else 0,
        })
        cap = num(r.get("capacity"))
        p["mw" if k == "op" else "pmw" if k == "plan" else "rmw"] += cap
        p["fuel"][gem_fuel(r)] += cap * (4 if k == "op" else 1)
        p["tech"][(r.get("tech-type") or "").strip()] += cap
        if k == "op":
            p["u"] += 1
        sy, ey = year(r.get("start-year")), year(r.get("end-year"))
        if sy and (p["y"] is None or sy < p["y"]):
            p["y"] = sy
        if ey:
            # end-year on a RETIRED unit is a shutdown that happened; on a
            # running one it is a date that has been announced. Taking the min
            # across both made Chinon retire in 1973 - its A reactors did, and
            # its four B reactors have been running ever since.
            if k == "ret":
                if p["dark"] is None or ey > p["dark"]:
                    p["dark"] = ey
            elif p["ry"] is None or ey < p["ry"]:
                p["ry"] = ey

    out = []
    for p in plants.values():
        if max(p["mw"], p["pmw"], p["rmw"]) < min_mw:
            continue
        rec = {
            "id": p["id"], "n": p["n"],
            # 3 dp is 110 m. 4 would be spurious precision on a coordinate GEM
            # itself grades as approximate, and it is 24,000 records of bytes.
            "lat": round(p["lat"], 3), "lon": round(p["lon"], 3),
            "mw": round(p["mw"]), "cy": iso2(p["cy"]) or p["cy"], "cyn": p["cy"],
            "own": p["own"],
            "f": p["fuel"].most_common(1)[0][0],
            "tech": p["tech"].most_common(1)[0][0],
            "u": p["u"],
            "k": "op" if p["mw"] > 0 else ("plan" if p["pmw"] > 0 else "ret"),
            "src": "gem",
        }
        for k_, v in (("pmw", p["pmw"]), ("rmw", p["rmw"])):
            if v:
                rec[k_] = round(v)
        for k_ in ("y", "ax"):
            if p[k_]:
                rec[k_] = p[k_]
        # Same rule as the EIA half: announced while running, dark once not.
        ry = p["ry"] if rec["k"] == "op" else p["dark"]
        if ry:
            rec["ry"] = ry
        out.append(rec)

    return out, (f"GEM GIPT {path.stem.rsplit('_', 1)[-1]}: {len(rows):,} unit rows -> "
                 f"{len(plants):,} plants, {skipped_us:,} US rows left to EIA, "
                 f"{dead:,} cancelled/shelved dropped")


def clean_owner(s: str) -> str:
    # "China Huaneng Group Co Ltd [100%]; Someone Else [0%]" -> the first name.
    # The stakes are not worth 24,000 records of bytes and the string is a
    # tooltip line, not a cap table.
    first = s.split(";")[0]
    return first.split("[")[0].strip()


def main() -> None:
    min_mw = float(sys.argv[1]) if len(sys.argv) > 1 else 100.0
    us, us_note = load_eia(min_mw)
    world, world_note = load_gem(min_mw)
    out = us + world

    # Biggest first so the map draws the ones that matter on top of the ones
    # that do not, without a sort expression in the paint.
    out.sort(key=lambda r: -(r["mw"] or r.get("rmw", 0) or r.get("pmw", 0)))
    OUT.write_text(json.dumps(out, separators=(",", ":")))

    by_k = collections.Counter(r["k"] for r in out)
    by_f = collections.Counter(r["f"] for r in out)
    print(us_note)
    print(world_note)
    print(f"\nkept {len(out):,} plants at {min_mw:.0f} MW and up "
          f"({len(us):,} US · {len(world):,} rest of world, {len({r['cy'] for r in world})} countries)")
    print(f"  operating {by_k['op']:,} · retired {by_k['ret']:,} · planned-only {by_k['plan']:,}")
    print("  by fuel: " + " · ".join(f"{k} {v:,}" for k, v in by_f.most_common()))
    print(f"  operating capacity mapped: {sum(r['mw'] for r in out):,.0f} MW")
    ret = [r for r in out if r.get("xmw")]
    print(f"  US plants with an announced retirement: {len(ret):,} "
          f"({sum(r['xmw'] for r in ret):,.0f} MW leaving, soonest {min(r['ry'] for r in ret)})")
    dark = [r for r in out if r["k"] == "ret"]
    print(f"  already dark, interconnection may be reusable: {len(dark):,} "
          f"({sum(r.get('rmw', 0) for r in dark):,.0f} MW was there)")
    approx = sum(1 for r in out if r.get("ax"))
    print(f"  coordinate only approximate: {approx:,} ({approx / len(out) * 100:.0f}%), all from GEM")
    print(f"wrote {OUT.relative_to(ROOT)}  ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
