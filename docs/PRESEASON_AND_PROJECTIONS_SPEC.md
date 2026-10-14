# Preseason board and Larry projections

Spec date: 2026-10-14. Draft is Sun Oct 18 2026, 7:30 PM CT. Opening night is Tue Oct 20.

Two parts, done in order:

1. **Part 1, preseason board.** Small, fully specified, measured. Ship to `main` before the draft.
2. **Part 2, Larry projections.** Our own projections from four seasons of history, blended with ESPN, behind a flag. Build and backtest; turn on only if it beats ESPN on the backtest.

Read CLAUDE.md first. Everything there still applies: `dev` branch, `node --check`, `npm test`, `npx tsc --noEmit`, ASCII only, no em dashes, bump `CACHE_VERSION` on every push.

**The regular-season ranking must not change.** The owner is happy with it. Every change in this spec is either preseason-only or behind a flag, except fix 1.1, which is a bug in every phase. Gate: `npx tsx tools/rank-v2-vs-experts.ts` must still PASS with rho 0.758 and 0 parity mismatches after every commit.

---

## Part 1: preseason board

### Why (measured live on 2026-10-14 against the FantasyPros 6-expert consensus top 150, `tests/fixtures/expert-consensus-2026-10-13.json`)

| Version | rho vs consensus | Top-25 overlap | Top-50 overlap |
|---|---|---|---|
| Live today | 0.637 | 13 | 34 |
| 1.1 only (unknowns ranked last) | 0.665 | 13 | 34 |
| 1.1 + per-game rate, no injury discount | 0.719 | 14 | 35 |
| 1.1 + rate + full discount below 60 projected games | 0.660 | 14 | 35 |
| **1.1 + rate + soft discount below 60 games + bad-data guard (this spec)** | **0.720** | **14** | **35** |

The harness that produced these numbers reproduced the live board exactly (0 of 1,000 rank mismatches) using `LarryEngine.computeBaseValues(inputs, { categories: [REB, AST, STL, BLK, PTS], rosterSize: 13 })`.

Two causes, in order of impact:

- **596 of 1,000 players have no ESPN projection.** `computeBaseValues` shrinks them to the pool mean, which is exactly 0, which is "average starter". Only 64 real players score above 0, so the unknowns fill ranks 65 to 660, and every real player slightly below starter-average is pushed to 661+. Live examples: Austin Reaves (experts #18) is 667th, Kawhi Leonard (#25) 674th, Damian Lillard (#67) 697th, Donovan Clingan (#46) 669th.
- **Injuries enter through ESPN's projected games, not the status tag.** `stats.projectedPerGame = projectedSeason / 82` (js/espn.js:610). ESPN's projected totals already assume missed games, so a player projected for 43 games gets a per-game rate about 48% too low. The DAY_TO_DAY / OUT tag is not used by the ranking. The tag is also not a usable long-term signal: Dejounte Murray is DAY_TO_DAY but projected for 38 games; Kyrie Irving is ACTIVE at 43; Jimmy Butler is OUT but projected for 68. ESPN gives no return dates (kona_player_info has `injured` and `injuryStatus` only).
- **ESPN data error:** Tyrese Haliburton is ACTIVE with a projection of `GP: 1` (20 PTS, 10 AST, 4 REB in that one game). Experts have him 13th. Live he ranks 1,000th.

### 1.1 Players with no evidence rank last (all phases)

A player with `gamesPlayed === 0` and no usable projection (null from `v2ProjectedPerGame`) has no evidence. Today they get `baseValue 0`.

- `computeBaseValues` (src/engine/zscore.ts): add `hasEvidence: boolean` to `BaseValueRow` (true when gp > 0 or a projection with at least one non-zero category exists). Keep `baseValue` numeric so nothing downstream breaks.
- `computeDURANT` (js/engines.js): sort evidenced players by score first, then all no-evidence players after them (ties by `percentOwned` desc). Set `p.durantScore = null` and `p.noEvidence = true` for those players.
- Every reader of `durantScore` must treat null as "below everyone": sorts use `-Infinity`, display shows `--`. Grep `durantScore` and `effectiveDURANT` in js/ (tabs.js, chat.js, larry-move.js, engines.js recommendations, trade analyzer). `effectiveDURANT` for these players is also null.
- Chat and Larry's Move payload builders: exclude no-evidence players from free-agent lists.
- This also fixes the same problem in-season (unprojected deep bench with 0 games outranking real players).

### 1.2 Preseason mode

- `isPreseason()` in core.js: true when today (local `YYYY-MM-DD`) is before `ESPNSync.openingNightStr()` for the current season. If the schedule is missing, true when no player in `S.allPlayers` has `gamesPlayed > 0`.
- In preseason mode `computeDURANT` uses the preseason value (1.3 to 1.5). Outside it, today's code path runs unchanged.
- It switches itself off: the first sync on or after opening night uses the regular rules. No user action.

### 1.3 Per-game rate from projected games

- In `parsePlayer` (js/espn.js ~line 607), keep `stats.projectedPerGame` exactly as it is (`/ 82`). The in-season shrink prior reads it and must not change.
- Add `stats.projectedRate = projectedSeason[c] / projectedSeason.GP` for counting stats when `projectedSeason.GP >= 1`, else null. Also store `stats.projectedGP = projectedSeason.GP || 0`.
- Preseason value input: `projectedPerGame: projectedRate` for evidenced players (fall back to `projectedPerGame` when `projectedRate` is null).
- Migration: bump `APP_VERSION`; `migrateState()` computes `projectedRate` / `projectedGP` from stored `projectedSeason` so a user does not need to resync.

### 1.4 Soft long-term injury discount

After `computeBaseValues` returns, for each evidenced player in preseason mode:

```
g = stats.projectedGP
longTerm = g > 0 && g < 60 && !suspect          // suspect from 1.5
if (longTerm && baseValue > 0) baseValue = baseValue * Math.sqrt(g / 72)
```

- Never scale a negative value (CLAUDE.md rule).
- Rationale: 60+ projected games is normal rest and minor knocks, so no discount. Below 60, a partial discount. The full `g / 82` cut buried real long-term players far below the experts (Kyrie 266th, Dejounte Murray 276th) and scored worse than live.
- Constants in src/engine/constants.ts: `PRESEASON_LONG_TERM_GP = 60`, `PRESEASON_GP_REFERENCE = 72`, `PRESEASON_DISCOUNT_POWER = 0.5`.
- Put the discount in a pure function `applyPreseasonDiscount(baseValue, projectedGP, suspect)` in src/engine/zscore.ts so it is unit-tested.

### 1.5 Bad projection guard

- `suspect = projectedGP > 0 && projectedGP < 10 && injuryStatus !== 'OUT'`. Store `p.projectionSuspect = true`.
- Suspect players get no discount. Their rate still comes from the tiny sample (Haliburton's 1-game line). Part 2's overrides file is the real fix for him.
- Show "Projection limited" next to their rank in the Players tab and the player popup.

### 1.6 UI

- Players tab header in preseason mode: "Preseason board. Per-game value from projections; long-term injuries discounted." Plus a small "Proj GP" column (from `stats.projectedGP`).
- Player popup: show projected games and, when discounted, "Long-term discount applied (projected N games)".
- No-evidence players show `--` for rank and score.

### Part 1 build steps

1. Branch `feature/preseason-board` off `dev`.
2. Engine first: `hasEvidence` in `computeBaseValues`, `applyPreseasonDiscount`, constants. Rebuild `dist/larry-engine.js` with the repo's existing build (commit the bundle; see CLAUDE.md on dist/).
3. Parser and migration: `projectedRate`, `projectedGP`, `APP_VERSION` bump.
4. `computeDURANT`: preseason branch, no-evidence ordering, null handling.
5. Null-safe readers across js/ (grep list in 1.1).
6. UI labels (1.6).
7. Tests (below), then the regular-season gate, then merge.

### Part 1 tests (vitest, add to tests/engine/)

- `preseasonBoard.test.ts`
  - Unknowns last: 3 projected players + 5 unprojected gp-0 players. Every unprojected player ranks after every projected one, including projected players with negative values.
  - In-season unknowns: one player with gp > 0 and value < 0 still outranks an unprojected gp-0 player.
  - Rate vs /82: a player with `GP 41, PTS 1000` gets the same preseason rate as one with `GP 82, PTS 2000`.
  - Discount: `applyPreseasonDiscount(10, 43, false)` = `10 * sqrt(43/72)`; `(10, 65, false)` = 10; `(-5, 30, false)` = -5; `(10, 1, true)` = 10.
  - Suspect flag: `GP 1, ACTIVE` is suspect; `GP 1, OUT` is not.
  - Mode switch: with a fixed clock before opening night, preseason path runs; on opening night and after, the regular path runs and returns today's numbers exactly.
- Regular-season regression: `tests/engine/baseValue.test.ts` and `tools/rank-v2-vs-experts.ts` unchanged and passing (rho 0.758, parity PASS).
- Consensus acceptance (new script `tools/preseason-vs-experts.ts`, run manually; needs a snapshot because the board uses live projections):
  - Export a preseason snapshot from the app (DevTools: `copy(localStorage.getItem('larry_state'))`), remove the `espn` key, save to `tests/fixtures/users/preseason-2027-snapshot.json` (git-ignored).
  - Compute the preseason board from it; compare with `tests/fixtures/expert-consensus-2026-10-13.json` using the same name normalization as `tools/proto.py`.
  - Pass: rho over the matched top 150 >= 0.70, top-50 overlap >= 34.
  - Spot checks that must hold: Austin Reaves <= 100, Kawhi Leonard <= 50, Damian Lillard <= 100, Kyrie Irving between 30 and 60, Dejounte Murray between 25 and 45, Tyrese Haliburton <= 30, Jokic 1st, no unprojected player above any projected player.
  - Reference result from the live harness: rho 0.720; top 10 Jokic, Anthony Davis, Giannis, Wembanyama, Doncic, SGA, Amen Thompson, Harden, Cade, LeBron.

### Part 1 deploy and live check

1. Merge `feature/preseason-board` to `dev`, push, fast-forward `main`, push. Bump `CACHE_VERSION`.
2. On the live site after the service worker reloads:
   - Players tab shows the preseason header and Proj GP column.
   - Ranks 1 to 10 match the reference list above (small shifts are fine if ESPN updated projections).
   - Reaves, Kawhi, Lillard are inside the top 100. No `--` player appears above a ranked one.
   - Chat and Larry's Move still work (pre-draft Move card still shows the draft date).
3. Report rho and the spot checks from `tools/preseason-vs-experts.ts` in the PR or commit message.

---

## Part 2: Larry projections

### Goal

Our own per-game rates and expected games for every player with NBA history, so the preseason board and the in-season shrink prior stop depending only on ESPN. Blend with ESPN rather than replace it. Turn it on only if the backtest says it is better.

Non-goals: no new paid data source, no scraping, no machine learning. Rookies keep ESPN's projection.

### 2.1 Data

ESPN's public player endpoint needs no login (verified 2026-10-14):

```
GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{seasonId}/segments/0/leaguedefaults/3?view=kona_player_info
Header: X-Fantasy-Filter: {"players":{"limit":1000,"sortPercOwned":{"sortAsc":false,"sortPriority":1}}}
```

- `players[].player.stats[]` entries: `seasonId`, `statSourceId` (0 = actual, 1 = ESPN projection), `statSplitTypeId` (0 = full season), `stats` keyed by ESPN stat id. Ids used here: 0 PTS, 1 BLK, 2 STL, 3 AST, 6 REB, 40 MIN, 42 GP (see `ESPN_STAT_MAP` in core.js).
- Verified through the league proxy for seasons 2023, 2024, 2025, 2026: about 295 of the top 300 players by ownership have full-season actuals each year (Jokic: 69, 79, 70, 65 games). The 2026 response also carries ESPN's 2025-26 preseason projection (`statSourceId 1`), which is the benchmark.
- Check the filter header is honored on the public endpoint (player count near 1000). If not, page with `offset` in the filter.

Write `tools/fetch-espn-history.ts` (run with `npx tsx`):
- Fetch seasons 2023 to 2027. Keep per player: id, name, proTeamId, and for each season `{GP, MIN, REB, AST, STL, BLK, PTS}` actual totals; ESPN projection for 2026 and 2027.
- Write `tests/fixtures/projections/espn-history.json` and commit it (public data, about 300 KB). Tests run offline from this file.
- Re-run before each season; the fixture records its pull date.

### 2.2 Layer 1: rates (Marcel style)

Pure module `src/engine/projections.ts`. Work in per-36-minute rates and minutes separately, because role changes move minutes far more than they move per-minute production.

For target season T, using actual seasons T-1, T-2, T-3 with weights 5, 4, 3:

Per-36 rate, regressed toward league average by `R` minutes:

```
perMin[c] = ( sum_y w_y * stat[c]_y  +  R * leaguePerMin[c] )
            / ( sum_y w_y * MIN_y      +  R )
per36[c]  = 36 * perMin[c]
```

- `stat[c]_y` and `MIN_y` are season totals. Start `R = 1000` minutes.
- `leaguePerMin[c]` = total stat / total minutes across all players with 500+ minutes, per season, then weighted the same 5/4/3 way.

Minutes per game, weighted by games so a 10-game season counts less:

```
mpg_raw = sum_y (w_y * GP_y * MPG_y) / sum_y (w_y * GP_y)
totalGP = sum_y GP_y
mpg     = totalGP >= 100 ? mpg_raw : 0.75 * mpg_raw + 0.25 * 24
```

Projected per-game: `perGame[c] = per36[c] * mpg / 36`.

Age adjustment: skipped. ESPN does not expose birth dates. Leave a hook (`ageFactor = 1`) for later.

All constants (`WEIGHTS`, `R`, MPG regression) in src/engine/constants.ts so the backtest can tune them.

### 2.3 Layer 2: expected games

```
gp = 0.5 * GP_{T-1} + 0.3 * GP_{T-2} + 0.2 * GP_{T-3}      // missing seasons drop out, weights renormalized
gp = 0.75 * gp + 0.25 * 70                               // regress toward a typical season
gp = min(gp, 82)
```

Players with one prior season or less: use ESPN's projected GP if present, else 65.

### 2.4 Overrides (owner-editable)

`data/projection-overrides.json`, committed, edited by hand:

```json
{
  "_note": "Owner overrides. gp and mpg replace the model. Remove entries when stale.",
  "players": {
    "<espnPlayerId>": { "name": "Tyrese Haliburton", "gp": 70, "mpg": 33, "note": "Back from Achilles; ESPN projection is a 1-game placeholder", "until": "2026-12-01" }
  }
}
```

- `gp` and `mpg` each optional. Entries past `until` are ignored.
- Ship with Haliburton only, using a placeholder the owner will confirm (flag it in the commit message). Do not invent injury facts for anyone else.
- An override with `gp` also clears `projectionSuspect` from Part 1.

### 2.5 Blend with ESPN

```
rate_final[c] = a * rate_larry[c] + (1 - a) * rate_espn[c]     // rate_espn = ESPN projectedRate (per game played)
gp_final      = override.gp ?? gp_larry                          // ESPN GP is the noisiest part; do not blend it
```

- Start `a = 0.6`. Tune `a` in the backtest (2.7) over {0, 0.2, 0.4, 0.6, 0.8, 1.0}.
- Rookies and players with no NBA history: `a = 0` (ESPN only).
- Output per player: `p.stats.larryProj = { perGame: {REB, AST, STL, BLK, PTS}, gp, mpg, source: "blend" | "espn" | "override" }`.

### 2.6 Wiring (behind a flag)

- `S.prefs.useLarryProjections`, default **false** until 2.8 passes; then default true. Toggle in Settings & Data.
- Preseason board (Part 1): when on, use `larryProj.perGame` as the rate and `larryProj.gp` as the projected games for the long-term discount and the suspect check.
- In-season shrink prior: when on, use `larryProj.perGame` instead of `projectedPerGame`. This changes regular-season ranks for low-game-count players only. Run the regular-season gate with the flag on and off and report both rho values; it must not drop below 0.75 with the flag on.
- Compute projections once per sync (they only change when the history fixture or overrides change), store under `S.analysisCache.larryProjections` with the inputs' hash.
- Player popup: a "Larry projection" line (per-game REB AST STL BLK PTS, games, source).

### 2.7 Backtest harness

`tools/backtest-projections.ts` (also a vitest file for the deterministic parts):

1. **Tune on 2025.** Project the 2024-25 season using 2023 and 2024 only (two seasons; weights 5/4). Pick `R`, the MPG regression and `a` that minimize the error below. Do not touch 2026 while tuning.
2. **Report on 2026.** Project 2025-26 using 2023, 2024, 2025 with the tuned constants. Compare against 2026 actuals.
3. **Benchmark:** ESPN's 2025-26 preseason projection from the same fixture, same players.

Player set: everyone with 20+ actual games in the target season and at least one prior season in the window (about 300 players).

Metrics, printed as a table for Larry-only, ESPN-only and blend:
- Per-category MAE of per-game REB, AST, STL, BLK, PTS.
- Games-played MAE.
- **Value rank correlation:** run `computeBaseValues` on projected per-game rates and on actual per-game rates (both with gp = 0 so nothing is shrunk; same Q-pool settings as production), then Spearman between the two value rankings. This is the number that matters for fantasy.
- Top-100 overlap between projected and actual value rankings.

### 2.8 Acceptance for Part 2

Turn `useLarryProjections` on by default only if, on the 2026 report:

- Blend value rank correlation >= ESPN-only value rank correlation + 0.02, and
- Blend per-game MAE is no worse than ESPN-only in at least 4 of 5 categories, and
- Larry games-played MAE < ESPN games-played MAE.

If Larry-only beats the blend, still ship the blend (more robust to one bad season) unless the gap is over 0.03 rho; report it either way. If none pass, leave the flag off, commit the harness and report the table so the owner can decide.

### Part 2 tests (vitest)

- `projections.test.ts`
  - Marcel weights: three synthetic seasons, verify per-36 and mpg math by hand-computed numbers.
  - Regression: a 10-game, 80-minute player lands near league average; a 3x80-game starter barely moves.
  - Missing seasons renormalize weights.
  - Expected games: regression toward 70, cap at 82, fallbacks for 0/1 prior seasons.
  - Overrides: `gp` and `mpg` replace the model; expired entries ignored; override clears `projectionSuspect`.
  - Blend: `a = 0` equals ESPN rate, `a = 1` equals Larry rate; rookies always ESPN.
- `backtestProjections.test.ts`: run the 2026 backtest from the committed fixture and assert the tuned constants reproduce the reported metrics (pins the result so future edits can't silently regress it).
- Regular-season gate with the flag off: unchanged (rho 0.758, parity PASS).

### Part 2 build steps

1. Branch `feature/larry-projections` off `dev` after Part 1 is merged.
2. `tools/fetch-espn-history.ts`, run it, commit the fixture.
3. `src/engine/projections.ts` + tests (2.2 to 2.5), pure functions only.
4. `tools/backtest-projections.ts`; tune on 2025, report on 2026. Paste the results table into `docs/PROJECTIONS_BACKTEST.md`.
5. Wiring behind the flag (2.6), overrides file, popup line.
6. Decide the default per 2.8. Merge to `dev`, then `main` with a `CACHE_VERSION` bump.
7. Live check: Settings toggle works both ways; Haliburton shows the override source; preseason board rho (with `tools/preseason-vs-experts.ts`) is reported with the flag on and off.

---

## Done means

- [ ] Part 1 merged to `main` before Sun Oct 18 7:30 PM CT, live check passed, rho and spot checks reported.
- [ ] Regular-season gate unchanged after every commit.
- [ ] Part 2 harness committed with `docs/PROJECTIONS_BACKTEST.md`, flag default decided by 2.8, decision explained in the commit message.
- [ ] CLAUDE.md updated: preseason mode, `projectedRate` vs `projectedPerGame`, no-evidence players, `larryProj`, overrides file, and the "Do NOT" entries that follow from them.
