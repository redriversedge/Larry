# Rankings v3.1: in-season fixes (unprojected players, single availability discount)

Written 2026-10-22, day 3 of the 2026-27 season, from the live board. Builds on `docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md` and `docs/RANKINGS_V3_ADDENDUM.md`. Where they disagree on the in-season path, this file wins.

Two ranking changes (A and B) and one guard (C). A and B change the in-season board, so neither ships until it passes the gates in section 4. Do them in order: A, then B, measuring after each.

## 1. What is wrong, measured on the live board

### 1a. Unprojected players jump into the top 150 after one game

51 of Larry's top 150 have **no ESPN projection at all**. One game moved each of them hundreds of places:

| Player | Rank now | Rank with this season's games removed | One-game line |
|---|---|---|---|
| Kobe Sanders | 69 | 474 | 2 PTS, 3 AST, 3 STL in 19 min |
| Emanuel Sharp | 83 | 511 | 8 PTS, 1 REB, 1 STL in 17 min |
| Sion James | 84 | 475 | 3 PTS, 3 REB, 1 STL in 27 min |
| Josh Okogie | 129 | 526 | 0 PTS, 1 REB in 8 min |

Pushed out of the top 150 as a result: Darius Garland (153), Stephon Castle (154), Kevin Porter Jr. (155), AJ Dybantsa (156).

**Cause.** `computeBaseValues` in `src/engine/zscore.ts` shrinks each player toward a prior: the ESPN projection when there is one, otherwise `stats.mean`, the Q-pool mean. The Q-pool is starter quality, so the pool mean is an **average starter's line**. With `SHRINK_K = 8`, one game gets weight 1/9 and the prior gets 8/9, so any unprojected player who logs a game becomes roughly an average starter, whatever he actually did.

This is the same mistake the no-evidence rule fixed preseason ("null is not zero: zero is average-starter"), coming back through the shrink.

Projected players are fine. For them one game is 1/9 against their own projection: Anthony Edwards scored 45 and moved to #7, Wembanyama scored 12 and stayed #3.

### 1b. Injury-prone players are discounted twice in season

In season the shrink prior is `stats.projectedPerGame`: ESPN's projected **season totals divided by 82**. ESPN's totals already assume missed games, so for a player projected for 47 games that prior is about 57% of his real per-game rate. Then `applyRestOfSeason` multiplies value above replacement by `expectedRemainingGames`, which discounts missed games **again**.

So availability counts twice for anyone with an injury history. Live examples, with ESPN projected games in brackets: Anthony Davis #13 (about 47 expected remaining), Trae Young #31 (47), Jayson Tatum #33 (51).

Preseason already uses the correct divisor (`projectedRate`, totals over ESPN's projected games played) for exactly this reason. See the `projectedRate` vs `projectedPerGame` entry in CLAUDE.md, which this spec deliberately revises for the in-season path.

### 1c. What ESPN's in-season projection is (settled, no fix needed)

The `statSourceId 1, statSplitTypeId 0` set for the current season is a **full-season total** (games already played plus remaining), and ESPN revises it during the season:
- **Full season, not rest of season:** Mikal Bridges, Buddy Hield and Harrison Barnes are projected for 82 games after their teams have already played one. A rest-of-season number could not exceed 81.
- **Revised:** Chet Holmgren's went from 68 games and 17.0 PTS per game on Oct 20 to 65 and 16.5 on Oct 22.
- **Historical fixture is clean:** `tests/fixtures/projections/espn-history.json` holds genuine preseason values, not end-of-season ones. Median absolute GP error against actual is 11 to 12 games and median relative PTS error is 25 to 27% in both seasons, so the backtests are not leaking actuals.

Dividing these totals by games is correct all season. Section C adds a guard so a change of meaning on ESPN's side is caught instead of silently shrinking every rate.

## 2. Change A: unprojected players start at replacement level

**Rule.** A player with no usable projection is shrunk toward the **replacement-level line**, not the pool mean. Real games still move him at the usual rate (`w = gp / (gp + SHRINK_K)`). A genuine breakout climbs within a week or two; one stint of garbage time does nothing.

**Replacement-level line.** Per category, the mean per-game prior of the players ranked `teamCount * rosterSize + 1` through `teamCount * rosterSize + 20` on prior-only value (156 to 175 in this league). Use their priors, not their observed rates, so the line is stable from opening night. Compute it inside `computeBaseValues` alongside the Q-pool stats and expose it on the result as `stats.replacementLine` (needed by the tests and tools).

**Where.** `src/engine/zscore.ts`, the `priorC` line:
```
// before
const priorC = prior ? prior[c] : stats.mean[c];
// after
const priorC = prior ? prior[c] : replacementLine[c];
```
- `hasEvidence` stays `gp > 0 || prior !== null`.
- The no-evidence rule (0 games and no projection gives a null score, sorted last) is unchanged.
- Preseason is unaffected: preseason every unprojected player has 0 games and is no-evidence already.

**Pool definition must not change.** The Q-pool is built from players at or above `MIN_GP_POOL` games (or from priors when nobody qualifies). Do not let the new line feed back into pool membership.

**Keep proto.py in lockstep.** `tools/proto.py` is the reference implementation and `tools/rank-v2-vs-experts.ts` asserts parity with it. Make the same change there, so parity holds by construction rather than by loosening the check.

## 3. Change B: count availability once

**Rule.** In season, the shrink prior becomes the player's per-game rate **when he plays**: `stats.projectedRate` (projected totals over `stats.projectedGP`), falling back to `projectedPerGame` only when ESPN gives no projected GP. Availability then enters exactly once, through `expectedRemainingGames` in `applyRestOfSeason`.

**Where.** `js/engines.js`:
- `v2ShrinkPrior` currently returns `v2ProjectedPerGame(p)`. Return the `projectedRate` equivalent instead (the same function the preseason input uses).
- With `S.prefs.useLarryProjections` on, Larry's projection keeps priority as today. Check whether `larryProj.perGame` is per game played or per 82, and make it per game played if it is not.

**Both views.** This applies to both the rest-of-season and the per-game Players view. The per-game view answers "how good is he when he plays", so a per-82 prior was wrong there too, just less visibly.

**Do not touch the matchup engines.** They already use per-game times games this week. `blendedPerGame` in core.js (Larry's Move, matchup projections) already uses `projectedRate`; leave it.

**Docs.** Update the CLAUDE.md entries that say the in-season prior must be `projectedPerGame`: the `projectedRate` vs `projectedPerGame` bullet, and the "Divide `projectedSeason` by 82 ... or by `projectedGP` for the in-season shrink prior" line in Do NOT. Record why, with the gate numbers.

## 4. Gates

The current in-season backtest (`tools/backtest-inseason-ranking.ts`) cannot see problem A. Its earliest checkpoint is week 3 and it drops anyone with fewer than 5 games (`MIN_GAMES_AT_CHECKPOINT`). Extend it before trusting any number.

### 4a. Add early-season checkpoints
- Add checkpoints at scoring periods **3, 7 and 14** alongside the existing four (week 3, week 8, deadline, All-Star break).
- At the early checkpoints, score the **whole board** with no minimum-games filter: rank everyone with evidence at that checkpoint, take Larry's top 150, and compare against actual rest-of-season 5-category value.
- Report two extra numbers at each early checkpoint:
  - **Unprojected in top 150:** how many of Larry's top 150 had no preseason ESPN projection, and their average actual rest-of-season rank.
  - **Top-150 precision:** the share of Larry's top 150 who finish inside the actual top 150 for the rest of the season.

### 4b. Acceptance, both seasons (2024-25 and 2025-26)
1. **A, early checkpoints (3, 7, 14):** unprojected players in the top 150 fall by at least 75%, and top-150 precision rises at every early checkpoint.
2. **A and B, existing four checkpoints:** average rest-of-season rho does not fall below the shipped 0.455, and no single checkpoint drops more than 0.01. The paired bootstrap against the shipped board must not show it worse at 90% or more.
3. **B specifically:** players with ESPN projected GP under 60 move up on average at the week 3 and week 8 checkpoints, and their rest-of-season rank error (Larry rank minus actual rank) shrinks on average.
4. **Per-game view:** per-game rho at the four existing checkpoints falls by no more than 0.01.
5. **Expert parity:** `npx tsx tools/rank-v2-vs-experts.ts` stays at parity with the updated `proto.py` and at rho 0.75 or better (shipped 0.758). The snapshot is git-ignored. If it is not available locally, say so in the report rather than skipping silently.
6. **Preseason untouched:** `npx tsx tools/backtest-preseason-board.ts` reproduces its pinned numbers exactly (0.519 / 0.409 current, blend 0.533 / 0.455).

If A passes and B does not, ship A alone and report B's numbers.

## 5. Change C: projection guard (no behaviour change)

- **Unit test:** pin that a current-season `statSourceId 1, split 0` set is read as full-season totals, so `projectedRate = totals / projectedGP`. Include a fixture case like Bridges: one team game played, projected GP 82, giving a rate equal to totals / 82.
- **Sync log warning:** on each sync, if the **median** projected GP across players with a projection drops below 40 before the All-Star break, add a sync-log warning: "ESPN projections look like rest-of-season totals; check the projection divisor." That catches ESPN changing the meaning without guessing at it per player.
- **No new fetches.** Projections already refresh on every sync; that is the daily update the owner asked for. Larry's own projection model (`useLarryProjections`) stays off.

## 6. Tests to add

- `zscore`: an unprojected player with 1 game of an average-starter line lands below every projected player at replacement or better. With 15 games of that line he is above replacement.
- `zscore`: `stats.replacementLine` equals the mean prior of ranks 156 to 175 on a synthetic pool.
- `engines`: `v2ShrinkPrior` returns the per-game-played rate (totals / projectedGP), and falls back to /82 when projectedGP is missing.
- `engines`: a player projected for 47 games with a strong rate ranks higher than before on rest of season, and his rest-of-season value includes his expected-games discount exactly once.
- Section C's two guards.

## 7. Report back

- Update `docs/RANKINGS_V3_INSEASON_BACKTEST.md` with the full gate table (old board, A, A+B) at all seven checkpoints for both seasons.
- In the summary include the live board's before and after for the named players in 1a and 1b, and Garland, Castle, Porter Jr. and Dybantsa.
- Ship through `dev` to `main` per CLAUDE.md, bumping `CACHE_VERSION`. The reviewer will check the live board after deploy.
