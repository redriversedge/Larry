# Larry player ranking v2 -- spec for Claude Code

Goal: replace the DURANT base score (`computeDURANT` in `js/engines.js`) with a per-game, starter-pool z-score. Prototype and results are in `proto.py`; full output is in `larry_rank_v2_vs_experts.csv`.

## Why (measured on the Oct 12 2026 snapshot, 666 players)

| Version | Rank corr. vs FantasyPros 6-expert consensus (top 150) | Top-10 | Top-25 | Top-50 |
|---|---|---|---|---|
| Legacy DURANT | 0.296 | 6/10 | 11/25 | 26/50 |
| v2 (this spec) | 0.786 | 7/10 | 15/25 | 35/50 |

Experts rank for 9-cat; Larry's league is 5-cat (REB, AST, STL, BLK, PTS). Some gap is expected and is not a bug (3PM, FG%, FT% shooters rank lower here).

## Defects in legacy DURANT

1. z-scores use season TOTALS, so games missed last year are punished (Trae Young: 17.9 pts / 8.0 ast over 15 GP gets z = -3.0).
2. Mean and stdev are computed over all players, including scrubs, not a starter-quality pool.
3. Multipliers (OUT x0.3, GTD x0.85, low-GP x0.7/0.85) are applied to the score. On negative scores they RAISE the value. 129 of 666 players carry OUT in the snapshot, so stars (Doncic, Durant, Flagg, Giannis) were buried.
4. `gamesRemaining` is 4 for every player in preseason, so the schedule factor is inert.
5. `scarcity` re-weights categories by coefficient of variation, which up-weights BLK/STL. Equal weights are correct for H2H each-category.

## Algorithm (base value)

Inputs per player: `stats.season[REB|AST|STL|BLK|PTS]` totals, `gamesPlayed`. Fall back to `stats.projectedSeason / 82` when `gamesPlayed == 0`.

1. `pg[c] = season[c] / gamesPlayed`.
2. First-pass pool = players with `gamesPlayed >= 10`. Compute mean and sample stdev per category.
3. Q-pool: rank pool by sum of z, keep top `12 * rosterSize` (156 at roster size 13), recompute mean/stdev. Repeat 2 iterations total. (This is `buildQPool` in `src/engine/zscore.ts`; reuse it.)
4. Shrink small samples toward the Q-pool mean: `w = gp / (gp + 8)`, `pg' = w * pg + (1 - w) * poolMean`.
5. `z[c] = (pg'[c] - poolMean[c]) / poolStdev[c]`, capped to [-3, +3].
6. `baseValue = sum(z[c])` over the 5 league categories (take them from `league.categories`, do not hardcode).

Constants: `Q_POOL_MULTIPLIER = 12`, `Q_POOL_ITERATIONS = 2`, `SHRINK_K = 8`, `Z_CAP = 3.0`, `MIN_GP_POOL = 10`.

## Injuries and schedule

- Do NOT multiply baseValue by injury factors. The snapshot cannot say how long a player is out, and a flat haircut did not improve agreement with experts (0.85 and 0.70 both left correlation unchanged), while it did drop stars sharply (Doncic 3rd -> 10th at x0.4).
- Keep availability as a separate field (`availability`, 0 to 1) used only by add/drop, lineup and streaming logic. Existing rule stays: never recommend adding OUT/SUSPENSION/IR players.
- Any haircut must apply only when baseValue > 0.
- Schedule/games-remaining adjustment applies to weekly and ROS decisions only, not to the preseason or season-long rank.

## Wiring notes

- Legacy `js/*.js` must stay ES5 (no let/const/arrows/template literals). Engine modules in `src/engine/*.ts` are pure functions; I/O stays out of them.
- Preferred path: extend `src/engine/zscore.ts` (already has Q-pool) with the per-game input, shrink and cap, expose via `dist/larry-engine.js`, and have `computeDURANT` consume it. Keep `durantRank` and `effectiveDURANT` field names so `tabs.js`, `chat.js` and the trade analyzer keep working.
- Bump `CACHE_VERSION` in `sw.js`. Work on `dev`, not `main`.

## Acceptance test

Load the snapshot, compute v2, compare to the expert consensus top 150: rank correlation >= 0.75, and Doncic, Durant, Flagg, Giannis, Tatum all inside the top 40 regardless of OUT status. Add a vitest with a small fixture covering: a low-GP star, a negative-score injured player (must not move up), and the cap on a BLK outlier.

## Known limits

- Snapshot stats are last season's; preseason ranks will shift once 2026-27 games are played.
- Consensus is 6 experts as of Oct 12 and 9-cat. Re-check against a 5-cat source if one is available.
- Remaining big misses are 3PM/FT%-heavy guards and bigs (Knueppel, Coby White, Dylan Harper, Champagnie, Brook Lopez); expected under 5-cat.
