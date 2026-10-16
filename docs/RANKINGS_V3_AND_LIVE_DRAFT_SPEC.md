# Rankings v3, team fit, and live draft sync

Spec date: 2026-10-15, written against `main` at 269ec2f (v3.26.0).
Real draft: Sun Oct 18 2026, 7:30 PM CT. Opening night is Tue Oct 20. All three parts are to be built now, in one pass.

The owner has approved changing **both** the preseason board and the regular-season ranking. That overrides the CLAUDE.md "Do NOT change the regular-season ranking" rule for this work only, under the gates below. Update CLAUDE.md when it ships: the rule becomes "do not change the ranking without beating the backtest gates in `docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md`".

CLAUDE.md applies otherwise: `dev` branch, `node --check`, `npm test`, `npx tsc --noEmit`, ASCII only, no em dashes, ES5 house style in `js/`, bump `CACHE_VERSION` on every push. The public-repo rule still holds: no league data in commits. Everything in Parts A and C runs on public ESPN and FantasyPros data, so it may be committed.

| Part | What |
|---|---|
| A | Preseason board v3: durability and value above replacement |
| B | Draft Room: team fit card and live draft sync |
| C | Regular-season ranking v3 |

Order of work: A1 (the backtest tool) first, because every other A and C decision is measured with it. Then A2 to A4, then B, then C.

---

## Why: what the reviewer measured on 2026-10-15

The reviewer rebuilt Larry's preseason board for the 2024-25 and 2025-26 seasons from ESPN's preseason projections, then scored it against what players actually produced in the five categories (season totals, two-pass z against the top 156).

**Where Larry beat the FantasyPros expert consensus:** players in Larry's top 30 who were not in the experts' top 30, and where they actually finished:
- 2024-25: Sengun (7th), Cade (8th), Bam (9th), Jaren Jackson (17th), Gobert (33rd)
- 2025-26: Amen Thompson (7th), Dyson Daniels (10th), Bam (14th)

**Where Larry got burned:** players in Larry's top 30 who were not in the experts' top 30, with ESPN's projected games, actual games, and actual 5-cat finish:

| Season | Player | Larry rank | ESPN proj GP | Actual GP | Finished |
|---|---|---|---|---|---|
| 2024-25 | Zion Williamson | 21 | 64 | 30 | 202nd |
| 2024-25 | Kawhi Leonard | 27 | 50 | 37 | 187th |
| 2024-25 | Ja Morant | 12 | 70 | 50 | 98th |
| 2024-25 | Paolo Banchero | 28 | 76 | 46 | 115th |
| 2025-26 | Joel Embiid | 15 | 56 | 38 | 164th |
| 2025-26 | Ja Morant | 23 | 67 | 20 | 333rd |
| 2025-26 | Zion Williamson | 14 | 64 | 62 | 83rd |
| 2025-26 | Jaren Jackson Jr. | 26 | 62 | 48 | 112th |

**Diagnosis.**
1. Larry trusts ESPN's projected games, and ESPN is consistently optimistic about players with injury histories. Simply weighting by ESPN's projected GP changed season-total rho by only +0.005, because the GP input itself is what is wrong.
2. Value is measured against an average starter, not against the waiver-wire player who fills a missed game. A quick test of "(per-game value minus replacement) x games" improved season-total rho by +0.018 (2024-25) and +0.013 (2025-26), and cut top-50 busts from 11 to 9 in 2025-26.
3. The +/- 3 per-category cap made no measurable difference. Leave it.

**Reference numbers to beat** (reviewer's reconstruction, top 150, ground truth = actual 5-cat value):

| Board | 2024-25 season rho | 2024-25 avg actual rank of top 24 | 2025-26 season rho | 2025-26 avg actual rank of top 24 | 2025-26 per-game rho |
|---|---|---|---|---|---|
| Larry preseason board (current) | 0.484 | 52.9 | 0.448 | 76.6 | 0.598 |
| FantasyPros ECR (11 experts) | 0.533 | 40.9 | 0.430 | 76.5 | 0.594 |
| Yahoo ADP | 0.519 | 45.5 | 0.548 | 74.2 | 0.693 |
| ESPN ADP | 0.539 | 43.3 | 0.464 | 78.5 | 0.629 |
| Quick test: value above replacement x ESPN GP | 0.502 | 44.1 | 0.461 | 75.1 | 0.609 |

Your A1 tool will reproduce the first row within +/- 0.02; if it does not, stop and reconcile before tuning anything.

---

## Part A: preseason board v3

### A1. Backtest tool (build this first)

`tools/backtest-preseason-board.ts`, pinned by `tests/engine/backtestPreseasonBoard.test.ts`.

**Data.**
- Extend `tools/fetch-espn-history.ts` back to seasonId **2020**, so a board for seasonId Y can read three prior seasons of actual GP (Y-3 to Y-1). Regenerate `tests/fixtures/projections/espn-history.json`. Public endpoint, no login.
- New committed file `data/preseason-rankings-history.json`, built by `tools/fetch-preseason-rankings-history.ts` from FantasyPros (public): for seasonIds 2025 and 2026 (FantasyPros `year=2024`, `year=2025`), the ECR order (`/nba/rankings/overall.php?year=Y`, the page embeds `var ecrData = {...}`) and the Yahoo and ESPN ADP columns (`/nba/adp/overall.php?year=Y`). Comparison only; nothing in the app reads it.

**Ground truth.** For season Y, each player's actual 5-cat value:
- **Season value (primary):** z of season totals per category, two passes (all players with GP > 0, then mean and SD from the top 156 by pass-one value), summed. Rank everyone.
- **Per-game value (secondary):** the same on per-game rates, players with GP >= 25.

**Metrics,** for each board's top 150 matched to the fixture by normalized name (unmatched counted and printed; a drafted player who did not play gets actual rank 500):
- Spearman rho of board rank vs actual rank, season and per-game.
- Top-100 hits: board top 100 that finished in the actual top 100.
- Top-50 busts: board top 50 that finished outside 150.
- Average actual rank of the board's top 24 (rounds 1 and 2), each capped at 300.
- **Paired bootstrap** (1000 resamples of shared players) for v3 vs current, so a 0.01 change is not mistaken for progress.
- The named-player table above, for v3, showing where each player lands.

**Boards scored:** current board (reproduce exactly from the shipped code path), v3, ECR, Yahoo ADP, ESPN ADP. Write the report to `docs/RANKINGS_V3_BACKTEST.md` with the run date.

### A2. Expected games: the durability model

New pure module `src/engine/durability.ts`.

**Inputs per player:** ESPN projected GP for the target season; actual GP for up to three prior seasons from the history fixture (and, in the app, from the current-season kona fetch with prior seasons, or from the fixture when the app has no history for a player); NBA team (`proTeamId` 0 means no team, expected GP 0); current injury status.

**Model.**
1. `histGP` = weighted mean of prior-season GP with weights 5/4/3 (most recent first), over the seasons the player was in the league. Missing seasons are left out, not counted as zero, except a season where the player was on a roster and played 0 (that counts as 0).
2. Regress toward the league mean for rotation players (compute it from the fixture, about 65) by `k / (k + seasons)` with `k` fitted (start at 1).
3. `blendGP = w * espnGP + (1 - w) * histGP`, with `w` fitted.
4. **Current-injury override:** ESPN knows about injuries that history cannot see (an Achilles in May). If `espnGP <= histGP - 15`, use `min(blendGP, espnGP)`. This is what keeps Haliburton and Tatum handled the way the preseason board handles them today.
5. Rookies and players with no history: `espnGP`.
6. Clamp to [0, 78].

**Fit** `k` and `w` by minimizing MAE of predicted vs actual GP on seasonIds 2024, 2025 and 2026 (each predicted from its own priors only), among players with ESPN projected GP >= 20. Report MAE for ESPN alone, history alone, and the blend. **Gate: the blend beats ESPN alone on MAE in each of the three seasons.** If it does not in some season, report it and ship only if it wins on the pooled MAE and on A4's board metrics.

The existing Marcel `projectGamesPlayed` in `src/engine/projections.ts` is a fine starting point (it beat ESPN 13.51 vs 14.04 MAE in the earlier backtest). Reuse it if it fits the shape above; do not duplicate it.

**No age term.** ESPN exposes no birth dates (see the note in `projections.ts`). Do not hardcode ages.

### A3. Value above replacement, in games

Replace `applyPreseasonDiscount` with a season-value calculation:

```
rateValue      = sum over 5 cats of capped per-game z (exactly as today, from projectedRate)
replacement    = rateValue of the player ranked (teamCount * rosterSize + 1) by rateValue
seasonValue    = (rateValue - replacement) * expectedGP / 82
```

- `teamCount * rosterSize` comes from league settings (12 x 13 = 156 here), never hardcoded.
- Players below replacement get a negative seasonValue, which is correct: they are worse than the waiver wire.
- The preseason board sorts on `seasonValue`. `durantScore` displayed on the preseason board becomes `seasonValue * 10` so the scale stays familiar; keep `rateValue * 10` available as "per game" in the player popup.
- `projectionSuspect` stays as the guard for broken ESPN projections (GP < 10 and not OUT). It is now applied to `expectedGP`, not ESPN GP.

### A4. Board gates (all must hold to ship A)

Run `tools/backtest-preseason-board.ts`:

1. **v3 beats the current board on season rho in both 2024-25 and 2025-26**, and the paired bootstrap shows v3 ahead in at least 80% of resamples in each season.
2. **Average actual rank of v3's top 24 improves in both seasons.**
3. **Per-game rho drops by no more than 0.02** in either season. The edge on bigs and defenders must survive: Bam, Sengun, Cade (2024-25) and Amen Thompson, Dyson Daniels, Bam (2025-26) stay inside v3's top 36.
4. **Named busts move down:** in v3 the players in the table above rank lower than they do on the current board, each one. Report their new ranks.
5. Sanity, report-only: rho against the 2026-10-13 expert consensus for the 2027 board (`tools/preseason-vs-experts.ts`) stays >= 0.65. Matching the experts is not the goal, actual outcomes are; the old spot checks (Kyrie, Dejounte, Haliburton ranges) become report-only.
6. The current preseason board stays available behind `S.prefs.rankingVersion = 'v2'` in Settings ("Use previous rankings"), default `'v3'`, for rollback during the draft.

If v3 fails gate 1 or 2, do not ship it. Report what you found; the reviewer will look at it with you.

### A5. UI

- Players tab and Draft Room board: an **Exp GP** column (rounded) and a durability dot: green >= 70, yellow 55 to 69, red < 55. Tap the dot for "Expected 52 games: played 30, 70, 59 over the last three seasons; ESPN projects 64."
- Player popup: "Per game" value and "Season value" both shown, labelled.

---

## Part B: Draft Room

### B1. Team fit, shown next to best value

The Larry's pick card shows two recommendations side by side, with the existing "can wait" logic applied to the value pick as today:

- **Best value:** the top available by the board (v3 `seasonValue`).
- **Best fit:** the top available by `seasonValue + fitBonus`.

`fitBonus`, computed from the user's current mock roster:
- Category totals for the user's drafted players (sum of projected per-game rates x expected GP), and the same for every other team.
- The user's league rank in each category, 1 to 12.
- Weight per category: `1.5` for ranks 7 to 12 (weak), `1.0` for ranks 4 to 6, `0.5` for ranks 1 to 3 (already strong).
- `fitBonus = lambdaFit * sum over cats of (weight - 1) * z_cat * expectedGP / 82`, with `lambdaFit` 0.5 to start.
- Only active from the user's 3rd pick on (before that, both cards show the same player and the fit card is hidden).
- If both picks are the same player, show one card with "Best value and best fit".
- One line under the fit pick saying why: "Your weakest categories right now: STL (11th), AST (9th)."

Test: a synthetic roster strong in BLK and weak in AST makes the fit pick prefer an AST player over a BLK player of equal value.

### B2. Live draft sync (was P2)

**Toggle:** "Follow the real draft" at the top of the Draft Room, shown only when the current season's draft is not complete. Off by default; remembered per device in `larry_mock_draft`.

**Polling.**
- When on: fetch the current season `mDraftDetail` (league scope, the user's cookies, through the existing proxy) every **4 seconds** while the page is visible.
- Stop on `visibilitychange` to hidden; on visible again, poll immediately. iPhones pause pages when the screen locks; the immediate poll on return is what catches up.
- On network error: keep the last state, show "Last updated 40s ago", back off to 8s, 15s, then hold at 30s. A 401 uses the existing reconnect banner.
- When `drafted` becomes true: stop polling, show "Draft complete", and run the normal sync so rosters load everywhere in the app.

**Behaviour while following.**
- Real picks replace the mock's picks, in order. Picks are read-only while following; Sim, Undo and Auto-draft are hidden. Turning the toggle off returns to a normal mock seeded from the real picks so far, so the user can simulate ahead.
- Availability odds recompute after every new real pick, from the real state, at the user's next two picks.
- **"You're on the clock"** banner when the next pick belongs to the user, plus the value and fit cards. "Your pick in 3" when within three picks.
- A real pick of a player not on Larry's board (deep pick) is added as a placeholder row so the count stays right.
- Larry never makes or submits picks on ESPN.

**Replay mode, so it can be tested before the real draft.** Settings gets "Draft Room: replay last season's draft". It feeds the stored 2026 picks from `larry_draft_history` through the exact same code path as live polling, one pick every 2 seconds, against the 2026 board. This is how the reviewer verifies B2 before the draft; there is no other way to see it work.

**Edge cases to test:** joining mid-draft (catch up in one poll), the user's own pick arriving, two picks landing in one poll, the toggle turned off and on mid-draft, page reload mid-draft, ESPN returning picks with `playerId` -1 or 0 for unfilled slots (ignore).

---

## Part C: regular-season ranking v3 (after the draft)

The owner wants the in-season ranking improved with the same ideas. In-season, the question changes to **rest-of-season (ROS) value**: what a player will produce from today to the end of the season.

### C1. Backtest data (prerequisite; stop if it cannot be built)

There is no point-in-time history today: the fixture has season totals only. Build it:

- `tools/fetch-game-logs.ts`: for seasonIds 2025 and 2026, reconstruct per-player per-day stats from the public ESPN endpoint (`leaguedefaults/3`, `view=kona_player_info&scoringPeriodId=<day>`, reading the single-day stat entry for that scoring period). Verify first on three players against a known box score. Write `tests/fixtures/projections/game-logs-<season>.json` (public data, committed if under ~10 MB, otherwise git-ignored with the tool documented).
- If ESPN does not expose per-day stats for past seasons, **stop and report**. Do not ship an in-season change without a backtest.

From the logs, build ranking snapshots at four checkpoints per season: after week 3, after week 8, at the All-Star break, and at the trade deadline. Truth at each checkpoint is ROS 5-cat value (season-total method, over the remaining games only).

### C2. Candidates to test

Score each at every checkpoint against ROS truth, and keep only what helps:
1. **Current v2** (baseline, exactly as shipped).
2. **v2 + value above replacement:** `(rateValue - replacement) * expectedRemainingGames`.
3. **Expected remaining games** = games left on the player's NBA schedule x availability, where availability blends this season's games-played share with the A2 durability history, and is set to 0 until the return date for OUT players with a known return, and to 0 for the rest of the season for season-ending injuries.
4. Each of 2 and 3 alone, so their contributions are measured separately.

### C3. Gates (all must hold to ship C)

- The chosen v3 beats v2 on ROS rho at **at least 3 of 4 checkpoints in each season** and on the average across all eight. Paired bootstrap as in A1.
- The expert-consensus check (`tools/rank-v2-vs-experts.ts`) becomes report-only. The `proto.py` parity check stays as a regression test for v2, which remains selectable.
- Weekly decisions keep using per-game value times games this week (they already do through the engines); do not feed ROS value into the matchup engines. Ranking surfaces sort on ROS value in-season; the Players tab gets a "Per game / Rest of season" toggle, default Rest of season.
- `S.prefs.rankingVersion` covers both preseason and in-season.

---

## Done means

- [ ] `docs/RANKINGS_V3_BACKTEST.md`: every board in A1, both seasons, GP model MAE table, the named-player table, bootstrap results.
- [ ] A shipped with all A4 gates passing, or a written report of what failed and nothing shipped.
- [ ] B1 and B2 shipped, B2 verified with replay mode.
- [ ] Settings: "Use previous rankings" and "Draft Room: replay last season's draft".
- [ ] C1 data built or reported impossible; C shipped only past its gates.
- [ ] CLAUDE.md updated: v3 value formula, durability module, `rankingVersion`, the new ranking rule, the backtest commands, live sync.

## Suggested settings

Opus 5.5, high effort for A1 to A3 and C (the measurement has to be right), medium for B.
