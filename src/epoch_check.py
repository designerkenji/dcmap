#!/usr/bin/env python3
"""Sanity-check Epoch's H100-equivalent figures against its own chip counts.

    python3 epoch_check.py [--all] [--json]

Epoch publishes both a headline compute figure per site and, separately, the
chip inventory it is built from. Those two can be reconciled: multiply each
chip count by that chip's H100-equivalent rating and the sum should be the
headline. This file does that arithmetic, so a release can be VERIFIED rather
than absorbed - when Epoch revised Google's fleet down 4.8% in September 2026,
this check is what said the revision moved Google TOWARDS its own chip counts:
its anchored points went from 25 of 27 reconciling to 33 of 33.

Measure that claim the way this file measures, not the way a first pass does.
Comparing each site at its LATEST timeline point suggested Google's median
error fell from 53% to 20% - a dramatic number that was mostly an artifact of
including projections and stale-inventory points. Restricted to anchored,
past-dated points the truth is smaller and firmer: Google reconciled well
before the revision (median 0.09%) and perfectly after it (0.05%).

THREE THINGS THE DATA DOES THAT A NAIVE JOIN GETS WRONG

  Counts carry forward.  A quantities row is that chip type's count AS OF that
      date, and a type not restated on a later date is still installed. Google
      Papillion reads TPU v4 115,242 in 2023 and never again; summing only the
      2024 rows loses it and lands 19% low. Reconstructing a date means taking
      the latest count per type at or before it.

  Half the timeline is the future.  Timeline rows run out to 2030 and carry
      projected compute; the chip table records chips somebody has actually
      reported. A projection exceeding its chip inventory is Epoch working as
      intended, not a discrepancy, so future-dated points are reported apart
      and never counted as failures.

  Only some points are anchored.  A timeline date that coincides with a
      chip-count date is a like-for-like comparison. A timeline date with no
      chip restatement is being compared against a stale inventory, so a gap
      there means "the chip table lags", not "the numbers disagree". Both are
      worth seeing; only the first is evidence.

The anchored, past-dated points are the real test: 117 of 119 within 1% on the
September 2026 release, median error 0.04%. Against that baseline an anchored
outlier is a genuine contradiction inside one release and worth a look.

Exit status is 0 whatever it finds: this reports, it does not gate a build.
"""

from __future__ import annotations

import argparse
import csv
import datetime
import json
import pathlib
import statistics
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
EPOCH = ROOT / "data_centers_from_EPOCH_AI"
# Anchored points agree to ~0.04%; 1% is loose enough for rounding in the
# published H100e ratings and tight enough that a real disagreement shows.
TOLERANCE_PCT = 1.0
# Worth a human look. Below this a gap is stale-inventory noise.
FLAG_PCT = 15.0


def num(v: str) -> float | None:
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def load() -> tuple[dict, dict, dict]:
    """H100e per chip type, chip counts per site, and the stated timeline."""
    h100e, missing = {}, []
    for r in csv.DictReader((EPOCH / "chip_types.csv").open(encoding="utf-8")):
        v = num(r.get("H100e"))
        if r.get("Name") and v:
            h100e[r["Name"].strip()] = v

    counts: dict[str, list] = defaultdict(list)
    for r in csv.DictReader(
            (EPOCH / "data_center_chip_quantities.csv").open(encoding="utf-8")):
        dc, date = r.get("Data center", "").strip(), r.get("Date", "")[:10]
        chip, n = r.get("Chip type", "").strip(), num(r.get("Number of Units"))
        if not (dc and date and chip and n):
            continue
        if chip not in h100e:
            missing.append(chip)
        counts[dc].append((date, chip, n))

    stated: dict[str, list] = defaultdict(list)
    for r in csv.DictReader(
            (EPOCH / "data_center_timelines.csv").open(encoding="utf-8")):
        dc, date = r.get("Data center", "").strip(), r.get("Date", "")[:10]
        v = num(r.get("H100 equivalents"))
        if dc and date and v:
            stated[dc].append((date, v))

    if missing:
        print(f"  chip types with no H100e rating: {sorted(set(missing))}")
    return h100e, counts, stated


def held_at(rows: list, upto: str) -> dict[str, float]:
    """Latest count per chip type at or before `upto` - the carry-forward."""
    held: dict[str, float] = {}
    for date, chip, n in sorted(rows):
        if date <= upto:
            held[chip] = n
    return held


def check(today: str) -> list[dict]:
    h100e, counts, stated = load()
    out = []
    for dc, points in stated.items():
        if dc not in counts:
            continue
        chip_dates = {d for d, _, _ in counts[dc]}
        for date, says in sorted(points):
            held = held_at(counts[dc], date)
            est = sum(n * h100e.get(chip, 0.0) for chip, n in held.items())
            if not est:
                continue
            out.append({
                "site": dc, "date": date, "stated": says, "from_chips": est,
                "error_pct": (est - says) / says * 100.0,
                "anchored": date in chip_dates,
                "future": date > today,
                "chips": {c: int(n) for c, n in sorted(held.items())},
            })
    return out


OUT = ROOT / "data" / "epoch_check.json"


def write_report(rows: list, today: str) -> None:
    """A tracked output, so the pipeline's freshness view can see this ran and
    a later reader can ask what the last release reconciled to."""
    anchored = [r for r in rows if r["anchored"] and not r["future"]]
    errs = [abs(r["error_pct"]) for r in anchored]
    OUT.write_text(json.dumps({
        "checked": today,
        "anchored_points": len(anchored),
        "anchored_within_tolerance": sum(1 for e in errs if e < TOLERANCE_PCT),
        "anchored_median_error_pct": round(statistics.median(errs), 4) if errs else None,
        "contradictions": [r for r in rows
                           if r["anchored"] and not r["future"]
                           and abs(r["error_pct"]) >= FLAG_PCT],
        "stale_inventory": [r for r in rows
                            if not r["anchored"] and not r["future"]
                            and abs(r["error_pct"]) >= FLAG_PCT],
    }, indent=1) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="list every point, not just flags")
    ap.add_argument("--json", action="store_true", help="emit the full result as JSON")
    ap.add_argument("--today", default=datetime.date.today().isoformat(),
                    help="treat dates after this as projections")
    args = ap.parse_args()

    rows = check(args.today)
    if args.json:
        print(json.dumps(rows, indent=1))
        return
    write_report(rows, args.today)

    anchored = [r for r in rows if r["anchored"] and not r["future"]]
    past = [r for r in rows if not r["future"]]
    future = [r for r in rows if r["future"]]

    def summarise(label: str, rs: list) -> None:
        if not rs:
            return
        errs = [abs(r["error_pct"]) for r in rs]
        ok = sum(1 for e in errs if e < TOLERANCE_PCT)
        print(f"  {label:52} {len(rs):>4} points · within {TOLERANCE_PCT:g}%: "
              f"{ok:>3} ({100 * ok / len(rs):3.0f}%) · median {statistics.median(errs):.2f}%")

    print(f"Epoch H100-equivalents vs its own chip counts  (today = {args.today})\n")
    summarise("anchored, past  (chips restated on that date)", anchored)
    summarise("all past dates", past)
    summarise("future dates  (projections - not a failure)", future)

    flags = sorted((r for r in past if abs(r["error_pct"]) >= FLAG_PCT),
                   key=lambda r: -abs(r["error_pct"]))
    real = [r for r in flags if r["anchored"]]
    lag = [r for r in flags if not r["anchored"]]

    if real:
        print(f"\nCONTRADICTIONS - chips were restated on this very date, and still "
              f"disagree by >{FLAG_PCT:g}%:\n")
        for r in real:
            print(f"  {r['site'][:34]:34} {r['date']}  stated {r['stated']:>11,.0f}"
                  f" vs chips {r['from_chips']:>11,.0f}  {r['error_pct']:+7.1f}%")
            print(f"     {', '.join(f'{c} {n:,}' for c, n in r['chips'].items())[:100]}")
    if lag:
        print(f"\nSTALE INVENTORY - the headline moved on but the chip table did not:\n")
        for r in lag:
            print(f"  {r['site'][:34]:34} {r['date']}  stated {r['stated']:>11,.0f}"
                  f" vs chips {r['from_chips']:>11,.0f}  {r['error_pct']:+7.1f}%")
    if args.all:
        print("\nevery point:\n")
        for r in sorted(rows, key=lambda r: (r["site"], r["date"])):
            tag = "proj" if r["future"] else ("anch" if r["anchored"] else "    ")
            print(f"  {tag} {r['site'][:32]:32} {r['date']}  {r['stated']:>11,.0f}"
                  f" vs {r['from_chips']:>11,.0f}  {r['error_pct']:+7.1f}%")
    if not real:
        print("\nNo contradictions: every anchored past-dated point reconciles.")


if __name__ == "__main__":
    main()
