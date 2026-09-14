# Cross-checking Epoch's compute figures against its own chip counts

Epoch publishes a headline H100-equivalent figure per site *and*, separately,
the chip inventory behind it. Those reconcile: chip count × that chip's H100e
rating, summed, should be the headline. `src/epoch_check.py` does the
arithmetic; `data/epoch_check.json` is its report.

## Does the method work?

On the September 2026 release, **117 of 119 anchored past-dated points
reconcile within 1%, median error 0.04%**. "Anchored" means the timeline date
is one on which chip counts were actually restated — a like-for-like
comparison. At that accuracy, an anchored outlier is a real contradiction
inside one release rather than noise.

Three traps a naive join falls into, all documented in the script:

1. **Counts carry forward.** A quantities row is that chip type's count *as of*
   that date; a type not restated later is still installed. Google Papillion
   lists TPU v4 115,242 in 2023 and never again — drop it and the 2024 figure
   lands 19% low.
2. **Half the timeline is the future.** Rows run to 2030 with *projected*
   compute, while the chip table records chips somebody reported. A projection
   exceeding its inventory is Epoch working as intended, so future points are
   reported separately and never counted as failures.
3. **Unanchored points compare against a stale inventory.** A gap there means
   the chip table lags, not that the numbers disagree.

## What it says about the September revision

Epoch revised `Current H100 equivalents` down on 15 sites (14 down, 1 up),
−708,679 fleet-wide, essentially all Google. The check's verdict: **the
revision moved Google toward its own chip counts.** Google's anchored points
went from 25 of 27 reconciling to **33 of 33**, median error 0.090% → 0.051%.

A caveat on how that is measured, because the first pass got it wrong.
Comparing each site at its *latest* timeline point suggested Google's median
error fell from 53% to 20% — dramatic, and mostly an artifact of mixing in
projections and stale-inventory points. The anchored figure above is smaller
and firmer: Google reconciled well *before* the revision and perfectly after.
Quote the anchored numbers.

## What it flags now

**One contradiction** — chips restated on that very date and still disagreeing:

- **CoreWeave Denton TX**, 2025-12-31 — stated 64,679 vs 40,424 from chips
  (−37.5%). The inventory is B200 × 16,000; the stated figure implies ~25,600
  B200-equivalents, a factor of 1.6. Worth asking whether the site holds GB200
  racks counted differently, or whether one of the two numbers is stale.

**Seven stale-inventory points**, where the headline moved on but the chip
table did not — Google Pryor (North) is the extreme at −95.9% (stated 636,685
against an inventory of TPU v5e 77,886 + v5p 23,466). These are not errors;
they say Epoch has better information than the chip table currently reflects.
Colossus 1 is the only one where the chips imply *more* than stated (+31.9%).

## Running it

    python3 src/epoch_check.py          # summary, flags, writes data/epoch_check.json
    python3 src/epoch_check.py --all    # every point
    python3 src/epoch_check.py --json   # full result

It is registered as the `epoch_check` pipeline step and appears on `/data`.
It reports only — it never changes the registry, and never gates a build.
