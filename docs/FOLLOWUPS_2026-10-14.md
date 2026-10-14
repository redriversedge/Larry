# Follow-ups after the preseason board (Oct 14 2026)

Spec date: 2026-10-14, after commit 48f268b (v3.22.0). Draft is Sun Oct 18 7:30 PM CT; opening night Tue Oct 20.

Three items, in order. F1 and F2 can ship before the draft if their gates pass. F3 is measure-and-report only.

CLAUDE.md applies throughout: `dev` branch, `node --check`, `npm test`, `npx tsc --noEmit`, ASCII only, no em dashes, bump `CACHE_VERSION` on every push. The regular-season gate (`npx tsx tools/rank-v2-vs-experts.ts`: parity PASS, rho 0.758) must pass after every commit.

---

## Why: the two ESPN feeds disagree

The preseason board was verified live on 2026-10-14 against the owner's real league data:

| | Reported by tools/preseason-vs-experts.ts | Live app (owner's league) |
|---|---|---|
| rho vs consensus top 150 | 0.864 | **0.720** |
| Austin Reaves (expert 18) | 40th | 91st |
| Kawhi Leonard (expert 25) | 17th | 38th |
| Damian Lillard (expert 67) | 82nd | 78th |
| Tyrese Haliburton (expert 13) | 16th, projected 64 games | 21st, projected **1 game**, flagged suspect |

The code is correct: the live numbers match the original prototype exactly. The difference is the data.

- The acceptance tool builds its snapshot from the **public** endpoint, `seasons/2027/segments/0/leaguedefaults/3?view=kona_player_info`.
- The app reads projections from the **league** endpoint, `seasons/2027/segments/0/leagues/{leagueId}?view=kona_player_info` through `espn-proxy`.
- They return different projections for the same players on the same day.

So the 0.864 measures a feed the app does not use. The public feed may simply be more current. F1 finds out and switches if it is better.

---

## F1: compare the two projection feeds, switch if public is better

### F1.1 Measure

New tool `tools/compare-projection-feeds.ts`:

- **Inputs:**
  - The public feed, fetched fresh (no login), turned into a snapshot with `tools/kona-to-snapshot.ts`.
  - A browser-exported snapshot from the owner's app: DevTools `copy(localStorage.getItem('larry_state'))`, delete the `espn` key, save as `tests/fixtures/users/preseason-2027-snapshot-league.json` (git-ignored). If the owner has not provided one, stop and ask; do not substitute the public feed for it.
- **Join** by ESPN player id. Report:
  - Players projected in one feed but not the other (counts, plus the top 20 by ownership).
  - Players whose projected GP differs by 10+ games, and players whose projected PTS/REB/AST per game differ by 10%+. List the top 30 by ownership with both values.
  - For each feed: run the real preseason board (same harness as `tools/preseason-vs-experts.ts`), then rho, top-25 and top-50 overlap against `tests/fixtures/expert-consensus-2026-10-13.json`, plus the named spot checks.
- **Write** results to `docs/PROJECTION_FEEDS.md` with the pull timestamp of each feed.

### F1.2 Decide

Switch the app's projection source to the public feed only if all hold:

- Public feed rho >= league feed rho + 0.02 on the preseason board.
- Public feed covers at least as many of the consensus top 150 as the league feed.
- No consensus top-50 player loses his projection.

Otherwise keep the league feed, commit the report, and stop.

### F1.3 Implement (only if F1.2 passes)

- **Proxy:** add `kona_player_info` to the season-scope allowlist in `netlify/functions/espn-proxy.js`, pointed at `leaguedefaults/3`. Keep it read-only. Only `view`, `x-fantasy-filter` and the season may vary; no league id, no cookies forwarded.
- **Parser (js/espn.js):** after the league sync, fetch projections from the public feed once per sync (cache with a timestamp like the NBA schedule, refetch after 24 hours). For each player id present in both feeds, take `projectedSeason` (statSourceId 1, current seasonId, full-season split) from the public feed. Everything else stays from the league feed: rosters, ownership, injury status, actual stats.
- Record the source per player: `stats.projectionSource = "public" | "league"`. Fall back to the league feed's projection when the public feed lacks the player or the fetch fails.
- `projectedPerGame` and `projectedRate` are derived exactly as today, just from the chosen totals. This changes the in-season shrink prior's input values (the formula stays), so run the regular-season gate and report its rho. It must stay >= 0.75. If it drops below, use the public feed for the preseason board only (`projectedRate`) and keep the league feed for `projectedPerGame`.
- Migration: none needed; the next sync repopulates.

### F1 tests

- **Unit:**
  - Feed merge prefers public totals when present.
  - It falls back to league totals when absent or when the fetch throws.
  - The proxy rejects any season-scope view outside the allowlist, and any request that carries a league id or cookies in season scope.
- **Acceptance:**
  - `tools/preseason-vs-experts.ts` on the **browser-exported** snapshot after the switch: rho >= 0.70 and the spot checks pass. Report the number next to the 0.720 baseline.
  - Change the tool to print which feed its snapshot came from, so this mix-up cannot recur.
- **Live check after deploy:** Haliburton's projected games in the app match the public feed; the board's rho on a fresh browser export matches the F1.1 public-feed number within 0.01.

---

## F2: use Larry's expected games for the preseason discount

### Why

The backtest (docs/PROJECTIONS_BACKTEST.md) found Larry's expected-games model beats ESPN's (MAE 13.51 vs 14.04, held-out 2025-26). ESPN's per-game rates are better, so keep those. But the preseason long-term discount and the suspect check run on projected games, which is the part where Larry is better.

### Build

- New pref `S.prefs.useLarryGames`, separate from `useLarryProjections`. Default decided by the F2 gate.
- In preseason mode when it is on, `v2ProjectedGP(p)` returns:
  1. The override `gp` from `data/projection-overrides.json`, if present and not expired.
  2. Else Larry's `gp` when the player has 2 or more prior seasons in the history fixture.
  3. Else ESPN's `projectedGP`.
- `projectionSuspect` is computed on the same chosen value. A Larry `gp` from 2+ seasons is never suspect.
- The per-game **rate** stays ESPN's `projectedRate` (or the F1 feed). Only the games input changes.
- The player popup's discount line names the source: "projected 43 games (Larry)" or "(ESPN)".
- Settings toggle labelled "Use Larry's games-played model for the preseason board".

### F2 gate

Run on the browser-exported league snapshot (and on the public-feed snapshot if F1 switched):

- Preseason board rho with `useLarryGames` on >= rho with it off. Default it **on** only if that holds; otherwise ship it off and report.
- Spot checks still pass: Kyrie between 30 and 60; Haliburton <= 30; Dejounte Murray between 25 and 45.
- Regular-season gate unchanged (the pref only acts in preseason mode).
- **Backtest addition:** in `tools/backtest-projections.ts`, add a "preseason board" row. Rank 2026 using ESPN rates with (a) ESPN GP and (b) Larry GP feeding `applyPreseasonDiscount`. Report value rho against 2026 actuals for both. Pin it in `tests/engine/backtestProjections.test.ts`.

### F2 tests

- `v2ProjectedGP` precedence: override, then Larry (2+ seasons), then ESPN. Test with an expired override, and with a 1-season player.
- The suspect flag follows the chosen GP.
- Pref off: output identical to today (snapshot test against the current board).

---

## F3: measure only, do not ship. In-season prior on `projectedRate`

The owner is happy with the regular-season ranking, and CLAUDE.md forbids changing it. This item produces numbers for the owner to decide on; it does not change behavior.

- On a branch, switch the in-season shrink prior from `projectedPerGame` (/82) to `projectedRate` (per projected game).
- Measure:
  - The regular-season gate rho, on the existing mid-season snapshot.
  - The ranks of players with under 20 games played, before and after. These are the players the prior actually affects: early-season, and returning from injury.
  - The same on a simulated "week 3" state, built by trimming the 2026 history to each player's first 10 games if the fixture allows. Skip if it does not.
- Write `docs/INSEASON_PRIOR_STUDY.md` with the numbers and a one-paragraph recommendation. Do not merge the branch. The owner decides.

---

## Order and timing

1. F1.1 and F1.2 (measure and decide) first. They need the owner's browser export; ask for it at the start.
2. F1.3 if it passes, then F2. Both behind gates; ship to `main` before Sun Oct 18 only if every gate passes. Otherwise leave them on `dev` and report.
3. F3 any time after the draft.

## Done means

- [ ] `docs/PROJECTION_FEEDS.md` with both feeds measured on the same day, and the switch decision.
- [ ] F2 shipped with its default set by the gate, numbers in the commit message.
- [ ] `tools/preseason-vs-experts.ts` prints its data source.
- [ ] `docs/INSEASON_PRIOR_STUDY.md` written, nothing merged for F3.
- [ ] CLAUDE.md updated: projection source per player, `useLarryGames`, and the two-feed note.
