# Larry projections: backtest results

**Verdict: `S.prefs.useLarryProjections` ships OFF by default.**

The model does not beat ESPN at the thing that matters most (ranking
players), so turning it on would make the board worse. One component does
beat ESPN, and that is the part worth building on next.

Reproduce: `npx tsx tools/backtest-projections.ts`
Pinned by: `tests/engine/backtestProjections.test.ts`
Data: `tests/fixtures/projections/espn-history.json`, pulled 2026-10-14,
848 players, seasons 2023 to 2027.

## Protocol

Tuning and reporting use different seasons, so the reported numbers are
not a measure of how well the constants were fit to them.

| Step | Season | Prior seasons used | Purpose |
|---|---|---|---|
| Tune | 2025 (2024-25) | 2023, 2024 | Pick `R` and `a` |
| Report | 2026 (2025-26) | 2023, 2024, 2025 | Score against ESPN |

2026 is never read during tuning. Player set: everyone with 20 or more
actual games in the target season, an ESPN projection for it, and at least
one prior season in the window. That is 316 players for 2026.

The headline metric is **value rank correlation**: run `computeBaseValues`
on the projected rates and on the actual rates, then Spearman between the
two orderings. Per-category MAE says how close the stat lines are; value
rho says whether the projection would have produced the right draft board,
which is what a projection is for.

## Results, 2026 held out

| model | MAE REB | MAE AST | MAE STL | MAE BLK | MAE PTS | MAE GP | value rho | top-100 |
|---|---|---|---|---|---|---|---|---|
| larry | 0.883 | 0.723 | **0.189** | **0.153** | 2.712 | **13.51** | 0.794 | 75 |
| espn  | 0.863 | **0.673** | 0.203 | 0.159 | **2.576** | 14.04 | **0.839** | **80** |
| blend (a=0.2) | **0.843** | **0.673** | 0.197 | 0.156 | 2.569 | **13.51** | **0.839** | 79 |

## Acceptance (spec 2.8)

All three were required to default the flag on.

| Criterion | Result |
|---|---|
| blend value rho >= espn + 0.02 | **FAIL** (0.839 vs 0.839, gain 0.000) |
| blend MAE no worse in 4 of 5 categories | PASS (5 of 5) |
| larry GP MAE < espn GP MAE | PASS (13.51 vs 14.04) |

Criterion 1 fails, so the flag ships off.

## What the numbers actually say

**ESPN's rates are better than Larry's, and it is not close.** Value rho
0.839 against 0.794. The gap is widest exactly where you would expect:
points (2.58 vs 2.71 MAE) and assists (0.67 vs 0.72). ESPN knows about
trades, role changes, training-camp reports and contract situations;
Marcel knows only what the box scores said. Three years of history cannot
tell you a player just moved to a team where he will be the first option.

**Larry's rates are better at the defensive counting stats:** steals 0.189
vs 0.203, blocks 0.153 vs 0.159. Those are the categories where
per-minute rate is stable and playing time is the main unknown, which is
precisely what the per-36 plus minutes split is designed for.

**Larry's expected-games model beats ESPN's**, 13.51 against 14.04 MAE.
This is the only component that wins outright, and it wins on both
seasons. It is also the cheapest to exploit: games played feeds the
preseason long-term-injury discount directly.

**Blending does not rescue the rates.** Value rho falls monotonically as
Larry's weight rises, on the held-out season as well as the tuning one:

| a | 0.0 | 0.2 | 0.4 | 0.6 | 0.8 | 1.0 |
|---|---|---|---|---|---|---|
| 2026 value rho | 0.839 | 0.839 | 0.835 | 0.824 | 0.814 | 0.794 |

A pure-rho optimizer picks `a = 0.0`, which makes the blend identical to
ESPN and the acceptance test unsatisfiable by construction. `a = 0.2` is
the largest weight that costs nothing in rank correlation while improving
rebounds, steals and blocks, so that is what `PROJECTION_BLEND_ALPHA` is
set to. It only takes effect if the flag is turned on.

`MARCEL_REGRESSION_MINUTES` barely matters: value rho moves by 0.001
across the entire range 250 to 3000, so it is left at a round 1000 rather
than fit to the fourth decimal of a single season.

## A result that points the other way, and why the flag is still off

Measured separately, on the real mid-season snapshot (2026, matchup 21),
running the actual `computeDURANT` with the flag both ways and correlating
the finished board against the expert consensus:

| | rank correlation vs experts |
|---|---|
| flag off | 0.766 |
| **flag on** | **0.801** |

So turning it on makes the *in-season* board measurably better, by 0.035.
That is the opposite sign to the backtest, and the reason is worth
writing down.

In season the prior is weighted `1 - gp/(gp+8)`, so it only matters for
players with few games. For those players the comparison is not "Larry's
rate against ESPN's rate", it is "Larry's rate against ESPN's projected
totals divided by 82". That divisor is the bug Part 1 found: a player
ESPN expects to play 40 games has a `/82` prior at roughly half his true
rate. Larry's model has no such distortion, so it wins by default.

The honest reading is that this measures a weakness in how the in-season
prior is derived, not a strength of the Marcel rates. The backtest
compares rates against rates with no divisor involved, and there ESPN
wins clearly. Fixing the in-season prior to use `projectedRate` (which
Part 1 already parses) would likely capture most of the 0.035 without
turning on a model that is worse at ranking.

Flag stays off: spec 2.8's criteria are explicit, criterion 1 failed, and
one snapshot is not a backtest. Recorded here so the decision can be
revisited on evidence rather than relitigated from memory.

## What to try next

In rough order of expected value for the effort:

1. **Use Larry's expected games and keep ESPN's rates.** This is the one
   measured win and the spec's criteria do not currently allow expressing
   it: criterion 1 is about rates, criterion 3 is about games, and the
   flag is all-or-nothing. A games-only mode would improve the preseason
   discount with no measured downside.
2. **Age curves.** The single biggest missing term. ESPN exposes no birth
   dates on this endpoint, so it needs another source; `ageFactor` is
   already a hook in `projectPlayer`.
3. **Team-context features.** Depth-chart changes and departed usage are
   what ESPN has and Marcel does not. This is where the points and assists
   gap lives.
4. **Per-36 minutes projection from recent games rather than whole
   seasons.** Role changes show up in the last 20 games long before they
   show up in a season total.

## Honest limitations

- One held-out season. 2026 is a single draw, and a 0.045 rho gap on 316
  players is suggestive, not conclusive. The direction is consistent
  across both seasons tested, which is the main reason to believe it.
- Players who missed a whole season have it omitted rather than counted as
  zero, and the remaining seasons shift up into the heavier weights. That
  is standard Marcel, but it means a player returning from a lost season
  gets no availability penalty from the model. The overrides file exists
  for exactly that case.
- Rookies are excluded entirely. They keep ESPN's projection, which is
  correct for now: there is no history to model.
