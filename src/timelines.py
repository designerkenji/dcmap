"""Derive lifecycle status and power trajectory from Epoch AI timelines.

Epoch publishes 424 dated observations across 76 sites, 2018-12 to 2030-01,
each carrying IT power, total power, buildings operational and cumulative
capital cost. 79 of those observations are in the future - they are Epoch's
projected build-out, not history.

That turns a single "current power" number into three separate quantities an
exposure model needs to keep apart:

  power_mw_it_current     IT load energised today
  power_mw_total_current  facility load today - what the utility delivers
  power_mw_total_peak     projected facility peak
  peak_date               when
  pue                     total / IT for the latest observation

IT and total are kept apart because Epoch's headline "Current power (MW)" is
IT load - it matches the timelines' IT column on all 75 sites - while facility
load runs 1.19-1.40x higher. Sizing a grid connection off the IT figure
understates it by a third.

and a lifecycle status. The status vocabulary is deliberately the insurance
one, because "under construction" and "operational" are different risks on the
same asset:

  planned             nothing built, all activity is future-dated
  under_construction  work observed, no building energised yet (builders risk)
  operational         at least one building energised, no further growth booked
  expanding           energised AND more capacity projected

Run after peeringdb.py. Reads and rewrites facilities_global.csv in place,
joining on epoch_name.
"""

from __future__ import annotations

import collections
import csv
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TIMELINES = ROOT / "data_centers_from_EPOCH_AI" / "data_center_timelines.csv"
GLOBAL = ROOT / "data" / "facilities_global.csv"
OUT_SITES = ROOT / "data" / "ai_site_trajectories.csv"

# Observations dated after this are Epoch projections, not observed state.
# Passed explicitly rather than read from the clock so a re-run reproduces.
TODAY = "2026-07-26"

NEW_COLS = ["status", "power_mw_it_current", "power_mw_total_current",
            "power_mw_total_peak", "peak_date", "pue", "buildings_operational",
            "capex_peak_usd_bn", "water_mgd", "observations"]


def num(v) -> float:
    try:
        return float(str(v).replace(",", "").strip() or 0)
    except ValueError:
        return 0.0


def summarise(obs: list[dict]) -> dict:
    """Collapse one site's observation series into current/peak/status."""
    obs = sorted(obs, key=lambda r: r.get("Date") or "")
    past = [r for r in obs if (r.get("Date") or "") <= TODAY]
    latest = past[-1] if past else None

    cur_mw = num(latest.get("Power (MW)")) if latest else 0.0
    cur_it = num(latest.get("IT power (MW)")) if latest else 0.0
    cur_bldg = num(latest.get("Buildings operational")) if latest else 0.0
    peak = max(obs, key=lambda r: num(r.get("Power (MW)"))) if obs else None
    peak_mw = num(peak.get("Power (MW)")) if peak else 0.0

    energised = cur_bldg > 0 or cur_mw > 0
    # Any past observation at all means Epoch has seen activity on the ground;
    # with nothing energised yet that is the builders-risk window.
    seen = bool(past)
    if energised and peak_mw > cur_mw + 0.5:
        status = "expanding"
    elif energised:
        status = "operational"
    elif seen:
        status = "under_construction"
    else:
        status = "planned"

    water = max((num(r.get("Water use (MGD)")) for r in obs), default=0.0)
    return {
        "status": status,
        "power_mw_it_current": round(cur_it, 1) or "",
        "power_mw_total_current": round(cur_mw, 1) or "",
        "power_mw_total_peak": round(peak_mw, 1) or "",
        "pue": round(cur_mw / cur_it, 2) if cur_it else "",
        "peak_date": (peak.get("Date") or "")[:10] if peak and peak_mw else "",
        "buildings_operational": int(cur_bldg) if cur_bldg else "",
        "capex_peak_usd_bn": round(max((num(r.get("Total capital cost (2025 USD billions)"))
                                        for r in obs), default=0.0), 2) or "",
        "water_mgd": round(water, 2) or "",
        "observations": len(obs),
    }


def main() -> None:
    rows = list(csv.DictReader(TIMELINES.open(encoding="utf-8-sig")))
    by_site: dict[str, list[dict]] = collections.defaultdict(list)
    for r in rows:
        name = " ".join((r.get("Data center") or "").split())
        if name:
            by_site[name].append(r)
    summary = {name: summarise(obs) for name, obs in by_site.items()}
    print(f"timelines: {len(rows)} observations across {len(summary)} sites")

    with OUT_SITES.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=["site"] + NEW_COLS)
        w.writeheader()
        for name, s in sorted(summary.items()):
            w.writerow({"site": name, **s})
    print(f"  wrote {OUT_SITES.relative_to(ROOT)}")

    g = list(csv.DictReader(GLOBAL.open()))
    cols = list(g[0].keys())
    for c in NEW_COLS:
        if c not in cols:
            cols.append(c)

    joined = 0
    norm = {k.lower(): v for k, v in summary.items()}
    for r in g:
        for c in NEW_COLS:
            r.setdefault(c, "")
        key = " ".join((r.get("epoch_name") or "").split()).lower()
        s = norm.get(key)
        if s:
            r.update({k: str(v) for k, v in s.items()})
            joined += 1
        elif r.get("facility_type") != "ai":
            # Non-Epoch rows keep whatever status the county permit gave them,
            # which for most of the world is nothing.
            r["status"] = r.get("status") or ""

    with GLOBAL.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(g)

    ai = [r for r in g if r["facility_type"] == "ai"]
    st = collections.Counter(r["status"] or "unknown" for r in ai)
    cur_it = sum(num(r["power_mw_it_current"]) for r in ai)
    cur = sum(num(r["power_mw_total_current"]) for r in ai)
    pk = sum(num(r["power_mw_total_peak"]) for r in ai)
    print(f"\nwrote {GLOBAL.relative_to(ROOT)}  ({len(g)} rows)")
    print(f"  AI rows joined to a trajectory: {joined}/{len(ai)}")
    print("  status: " + "  ".join(f"{k}={v}" for k, v in st.most_common()))
    print(f"  AI IT load    current {cur_it:,.0f} MW")
    print(f"  AI facility   current {cur:,.0f} MW  ->  projected peak {pk:,.0f} MW"
          f"  (+{pk - cur:,.0f})")


if __name__ == "__main__":
    main()
