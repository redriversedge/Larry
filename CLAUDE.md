# Larry -- Fantasy Basketball Command Center

ESPN fantasy basketball analytics PWA. Deployed at larrybball.netlify.app via GitHub to Netlify auto-deploy.

## Architecture

**Legacy frontend:** vanilla JS multi-file app. No framework, no build step, no bundler. Files deploy directly to Netlify. This is the production surface.

**New code (Phase 1+):** TypeScript under `src/` and `tests/`, with `tsc --strict` and `vitest`. New engine modules compile to `dist/` and are loaded into `index.html` as ES modules. The build pipeline is added in Phase 1 when the first `src/engine/*.ts` file lands; until then the toolchain (package.json, tsconfig.json, vitest) exists but does not build anything.

```
index.html              -- App shell, 5-tab bottom nav
css/larry.css           -- Dark theme, mobile-first
js/core.js              -- State (S object), nav, localStorage, utils [LEGACY ES5]
js/espn.js              -- ESPN API integration, data parsing, sync [LEGACY ES5]
js/engines.js           -- 12 analysis engines (see Analysis Engines below) [LEGACY ES5]
js/tabs.js              -- All 5 tab renderers + League sub-pages [LEGACY ES5]
js/draft.js             -- Draft Room: mock drafts vs AI managers [LEGACY ES5]
js/chat.js              -- Larry AI chat via Claude API proxy [LEGACY ES5]
manifest.json           -- PWA manifest
sw.js                   -- Service worker (bump CACHE_VERSION on every deploy)
netlify/functions/espn-proxy.js   -- ESPN API CORS proxy
netlify/functions/larry-chat.mjs  -- Claude API proxy, STREAMS the reply (Functions v2)
public/                 -- Static pages (Phase 2+): /connect bookmarklet install, /link cookie handler, ios-shortcut.txt
src/                    -- TypeScript code (Phase 1+); engine, cookies, types, shared
dist/                   -- Built IIFE bundles, committed to git (larry-engine.js, larry-cookies.js)
tests/                  -- vitest tests for new TS code
package.json            -- devDeps only; no runtime deps
tsconfig.json           -- strict, noUncheckedIndexedAccess, scoped to src/ and tests/
vitest.config.ts        -- minimal vitest config
LARRY_PLAN.md           -- Active improvement roadmap
PLAN_RECONCILED.md      -- Phase 0 reconciliation: plan paths -> actual paths
REPO_MAP.md             -- Phase 0 audit: file tree + key-file summaries
```

## Key Concepts

- **S object**: Global state in localStorage under `larry_state`. All app data lives here. `S.version` drives one-time migrations in `migrateState()` (core.js); bump `APP_VERSION` and add a branch there when the shape changes.
- **Stats are PER-GAME**: `p.stats.{season,last30,last15,last7}` hold per-game rates, normalized once in `parsePlayer` (espn.js). Raw ESPN split totals live under `p.stats.totals.<split>`, each split's game count under `p.stats.gp.<split>`. Percentages and GP/GS pass through undivided. Never divide `stats.season` by `gamesPlayed` again; that was the old shape and it caused the 52x matchup inflation and the 78,905-point ROS projection. `projectedSeason` stays as totals, with `projectedPerGame` alongside it.
- **Season id**: `S.league.seasonId` is the calendar year the season ENDS in (2026-27 season = 2027). Seeded by `computeSeasonId()` and overwritten by ESPN on first sync. Never hardcode it.
- **DURANT ranking (v2)**: Primary player ranking. Per-game z-score against a starter-quality Q-pool, with small samples shrunk toward the player's own ESPN projection (`stats.projectedPerGame`, falling back to `projectedSeason / 82`, and to the replacement line when there is no projection at all) and each category capped at +/- 3. `durantScore` is the sum of category z-scores times 10. Nothing multiplies it: no injury discount, no games-remaining factor, no trend or scarcity bonus. Computed by `computeBaseValues` in `src/engine/zscore.ts`, consumed by `computeDURANT` in `js/engines.js`. See `docs/RANKING_V2_SPEC.md`.
  - **Internal only, like z-scores.** Users never see the word DURANT, the score, or any z value. Every surface shows "Larry rank #N" (`larryRankText()` in core.js), and the chat and coach prompts are told never to quote internal scores. Keep the names in code; keep them off the screen.
  - The prior is the player's projection, not the pool mean. Shrinking to the pool mean scores *everyone* at 0 before opening night, so the whole preseason board was blank and tied. Mid-season rank correlation with the FantasyPros 6-expert consensus top 150 is 0.758 (down from 0.786 with the pool-mean prior, still above the 0.75 acceptance gate); the preseason board goes from 1 distinct score to 379, at rho 0.605. That trade is deliberate.
  - When no player has yet reached `MIN_GP_POOL`, the Q-pool itself is built from projections rather than from observed rates, or there would be no pool to z-score against.
- **Preseason board**: Before opening night nobody has played, so the board runs on projections alone. `isPreseason()` (core.js) compares today against `ESPNSync.openingNightStr()` and flips itself off on the first sync on or after the first game. In that mode `computeDURANT` uses `stats.projectedRate` and applies `applyPreseasonDiscount`. Rank correlation with the expert consensus went 0.637 to 0.862; run `npx tsx tools/preseason-vs-experts.ts` to re-measure.
- **`projectedRate` vs `projectedPerGame`**: two different divisors and they are not interchangeable. `projectedPerGame` is the projection over a FULL 82 games and is what the in-season shrink prior reads; do not change it, the regular-season ranking is tuned on it. `projectedRate` is the projection over the games ESPN expects the player to PLAY (`stats.projectedGP`), which is their rate when healthy, and is what the preseason board reads. ESPN's projected totals already assume missed games, so dividing by 82 understates anyone with an injury history by as much as half.
  - **Switching the in-season prior to `projectedRate` was tried and lost.** Rankings v3.1 change B: in season the /82 prior double-counts availability, because `applyRestOfSeason` already multiplies by `expectedRemainingGames`. Dividing by `projectedGP` instead fixes the double count on paper and measures WORSE: average rest-of-season rho 0.453 against 0.455, one checkpoint down 0.012, per-game rho down 0.017, all outside the spec's gates (`docs/RANKINGS_V3_INSEASON_BACKTEST.md`). ESPN's projected game count carries 11 to 12 games of median error, and dividing by it pushes that error into all five category rates, which costs more than the double count does. Low-projected-GP players do move up and their rank error does shrink in 2025-26, so the diagnosis is right and this divisor is the wrong cure.
- **No-evidence players**: a player with 0 games and no usable projection gets `durantScore = null` and `noEvidence = true`, and sorts after everyone with a number. Null is not zero: zero is average-starter, which is why 596 unprojected players used to occupy ranks 65 to 660. Never write `(p.durantScore || 0)` in a comparator; use `durantKey()` for sorting and `durantText()` for display, both in core.js.
- **Unprojected players shrink to the REPLACEMENT LINE, not the pool mean** (rankings v3.1 change A, `computeReplacementLine` in `src/engine/zscore.ts`). The Q pool is starter quality, so its mean is an average STARTER's line. With `SHRINK_K = 8` one game carries weight 1/9 and the prior carries 8/9, so any unprojected player who logged a single game came out roughly an average starter whatever he actually did. Three days into 2026-27 that put 53 unprojected players inside the live top 150: Kobe Sanders 70th on 2 points and 3 assists in 19 minutes.
  - The line is the mean per-game PRIOR of the players ranked `teamCount * rosterSize + 1` through `+ 20`, exposed as `stats.replacementLine`. Priors rather than the band's own observed rates, so it is stable from opening night; a 20-player band rather than one player, because a single order statistic moves with the composition of the pool. Players with no prior are not candidates for the band, which would be circular.
  - This is the same mistake the no-evidence rule fixed preseason ("null is not zero") coming back through the shrink. It only touches players ESPN has no opinion about: every projected player's score is bit-identical. Measured over seven checkpoints in two seasons, unprojected players in the top 150 fall by 82 to 100%, top-150 precision rises at all six early checkpoints, and rest-of-season rho rises at all 14.
  - Real games still move the player at the usual rate, so a genuine breakout climbs in a week or two. On a synthetic league: rank 157 on one game of an average-starter line, 133 on five, 110 on fifteen.
  - **Do not let the line feed back into pool membership.** The Q pool is still the top `rosterSize * 12` by observed rate (or by prior preseason), computed before the line exists.
- **Larry projections (`larryProj`)**: Larry's own Marcel model over four seasons of box scores, in `src/engine/projections.ts`, behind `S.prefs.useLarryProjections`, **off by default**. The backtest found ESPN's rates rank players better (0.839 against 0.794 on a held-out season); the expected-GAMES half does beat ESPN (13.51 against 14.04 MAE). History lives in `tests/fixtures/projections/espn-history.json`, regenerated by `tools/fetch-espn-history.ts`. Owner corrections go in `data/projection-overrides.json`, which is for data errors with a date attached, not for medical opinions. Full results and the next steps are in `docs/PROJECTIONS_BACKTEST.md`.
- **Draft Room**: mock drafts where the other 11 teams are drafted by AI managers built from the league's real draft history. `js/draft.js` (page), `src/engine/draftProfiles.ts` (profiles), `src/engine/mockDraft.ts` (pick model), `src/engine/draftFit.ts` (fit and scoring). Two localStorage keys of its own: `larry_draft_history` (the fetched history, permanent per league) and `larry_mock_draft` (the in-progress mock). Entry point is League, Draft Room; the old `draftCenter` route redirects there. See `docs/DRAFT_ROOM_SPEC.md`.
  - **The repo is public and draft history is league members' data.** It is fetched in the browser with the user's cookies, kept in localStorage, and never committed, never sent to the chat or Move functions, never written into a test fixture. Every committed test uses the synthetic generator in `tests/engine/draftFixtures.ts` (managers `M1`..`M12`, invented players). A local real export goes under `tests/fixtures/users/` (git-ignored) and must not be referenced from a committed test.
  - **The profile method, in three lines.** Within a season's pool of drafted players, z-score each per-game category. For each pick, subtract the mean z of the *other* picks within +/- 8 overall slots: that residual is what the manager chose given where they were picking, with "early picks are better at everything" removed. A manager's premium for a category is the mean residual over their rounds 1 to 10 picks across every season, and `t` is that mean over its standard error. Strength needs |t| past 2 (strong) or 1.2 (moderate) **and** |premium| of at least `DRAFT_PREMIUM_MIN_EFFECT`, because t alone will call a premium of 0.0003 strong when the standard error collapses. Profiles are keyed by **member id, not team id**: teams change hands and team ids move between seasons.
  - **Reach is measured against ESPN ADP from `data/espn-adp-history.json`**, never against a past season's `draftRanksByRankType` or `ownership.averageDraftPosition`. For a finished season both of those hold *end-of-season* values: 2026 ROTO has Jalen Johnson 5th where he was drafted around 33rd, and ADP has Jokic at 140. The file is public FantasyPros data, not league data, so it is committed; regenerate with `npx tsx tools/fetch-espn-adp-history.ts`. It covers seasonId 2019 onward, so the 2018 draft has no reach. For the **current** season `ownership.averageDraftPosition` is live ESPN ADP and is fine.
  - **The pick model uses ESPN ADP as its base, not Larry's rank.** That is a prediction of what these managers will do in the ESPN draft room, not a claim about player value. Larry's rank is what the Draft Room *recommends* to the user, which is a different question and a different column.
  - **The rank term is logarithmic**: `-ln(rank)/tau`, not `-rank/tau` (`MOCK_RANK_FORM`). A linear term spaces consecutive players evenly all the way down the board, so one `tau` has to describe both a near-deterministic round 1 and a near-random round 10, and it gets both wrong. Fitted on the real drafts the linear form beat a rank-only baseline by only 0.03 nats while putting the ADP #1 player first in 19% of drafts. The log gap is `ln(2)` at the top of the board and `ln(101/100)` at pick 100, which is the shape a draft actually has. **Log-form taus are fractions and do not convert to linear ones.**
  - **Two acceptance gates exist because a per-pick log-likelihood cannot see either problem.** `tools/fit-mock-draft.ts` fits both rank forms and ships the better held-out log-likelihood **subject to both**.
    - `MOCK_TOP_PICK_*`: the ADP #1 player must go inside the first 3 picks in at least 95% of 500 simulated drafts. Only 12 of 144 picks are in round 1, so a model can score well on average and still let the consensus number one slide to pick 6.
    - `MOCK_REACH_*`: the simulated share of picks taken 20+ slots ahead of ESPN ADP must be under 2% in round 1, under 5% in round 2, and within 5 points of the real rate in rounds 3 to 5. Reaching lives in the **tail**: each deep candidate is individually unlikely, but their combined softmax mass is not, and over a 120-player pool it reached 17% at pick 8.
  - **The candidate pool is capped by round and that cap is a correctness knob, not just a speed one.** `MOCK_CANDIDATE_POOL_EARLY` (24) through round 2, `MOCK_CANDIDATE_POOL_LATE` (40) after, which is what brought simulated reach frequency into line with the real drafts. Availability simulations use the same pool, so the odds the user reads come from the same model that makes the picks. Because the cap is a truncation, `evaluateDraft` scores a real pick that falls outside it with its **uncapped** probability rather than as impossible, and reports `poolCoverage` (about 87% of real picks at 24). That makes the result a comparable score rather than a true log-likelihood; both the model and the baseline are scored the same way.
  - **The model weights are fitted** on the owner's 2019 to 2025 drafts, held out on 2026 (`MOCK_FITTED` true; the UI footer warns when it is false). The log form beats the best linear fit by 0.57 nats. Every profile term is worth only thousandths of a nat, so ESPN ADP is doing most of the work. `beta` ships at 0 because it measured **negative** (-0.012), and `gamma` ships at 1 as a position guardrail rather than on the strength of its +0.003. Do not hand-adjust these; rerun the fit.
- **Live draft sync and team fit** (`js/draft.js`, `src/engine/draftTeamFit.ts`): the Draft Room can follow the real ESPN draft read-only, polling `mDraftDetail` every 4s while visible, backing off to 8/15/30s on error, stopping on `visibilitychange` and polling immediately on return (a locked phone misses picks otherwise). While following, picks are ESPN's and Sim/Undo/Auto-draft are hidden; turning the toggle off leaves the real picks in place as the start of a normal mock. **Larry never makes or submits a pick on ESPN.** Settings has "Replay last season's draft", which feeds stored picks through the same path on a 2s timer and is the only way to exercise live sync before draft night. When the user is on the clock the card splits into **best value** (top of the board) and **best fit** (board value plus a bonus weighting the categories the user's roster is weakest in, active from their 3rd pick); when the two agree it collapses to one card.
- **Preseason board v3** (`src/engine/preseasonBoard.ts`, shipped; `S.prefs.rankingVersion = 'v2'` in Settings rolls it back). Three steps, each measured in `docs/RANKINGS_V3_BACKTEST.md`:
  1. **Expected games from the player's own attendance record**, not ESPN's optimism (`src/engine/durability.ts`, fitted k 1.25, **w 0.2**, so four fifths of the signal is history). ESPN is persistently optimistic about players with injury histories: it projected Zion 64 and Ja 67 games in seasons where they played 30 and 20. Prior-season games reach the browser through the committed `data/durability-history.json`, because the live kona fetch carries only the current season.
  2. **Value against the waiver wire, times those games** (`src/engine/replacement.ts`): `seasonValue = (rateValue - replacement) * expectedGP / 82`, replacement being the player ranked `teamCount * rosterSize + 1`. A missed game costs you the difference between the player and the streamer who replaces him, not the player's whole production. This is also why a below-replacement player can score negative, which the old multiplicative discount could not express.
  3. **A log-rank blend with the market** (`src/engine/blend.ts`), Larry 3 against 1 each for Yahoo ADP, live ESPN ADP and the expert consensus. Larry and the market make different mistakes: the market knows camp news and health, Larry knows this league scores only 5 categories while those lists price 9-cat and points. In log space so the top of the board dominates. Market data is `data/market-rankings-current.json`; **re-run `tools/fetch-preseason-rankings-history.ts` before each draft.** Missing lists renormalize the weights; no market at all falls back to Larry's board.
  - Measured against real outcomes: season rho 0.519 -> 0.533 (2024-25) and 0.410 -> 0.446 (2025-26), paired bootstrap 98.8% and 90.3%, average actual rank of the top 24 improving by 10.1 places, and per-game rho holding or rising (0.732, 0.555 -> 0.602) so the format edge survives.
  - The 2025-26 numbers moved slightly in rankings v3.1 (from 0.409 -> 0.455 at bootstrap 95.8%) and **the board did not change**. Two rows in `espn-history.json` carry an ESPN projection of zero production in all five categories, so they are no-evidence players the app has always kept off the board, and `tools/backtest-preseason-board.ts` was scoring them anyway. They sat at exactly 0, in the middle of the pool, dragging the single-player replacement level `seasonValues` reads. Excluding them, which is what `applyPreseasonV3` does, is the truer measurement: Larry's own v3 board improves (0.403 -> 0.432) and the blend gives back a little of what it was earning from noise. Forcing the pre-v3.1 prior with the exclusion in place reproduces these numbers exactly, which is how we know change A is not responsible.
  - **`durantScore` and `durantRank` deliberately disagree on the v3 preseason board.** The score is the 5-category season value, the rank is the blend. Everything that orders players reads the rank. `p.fiveCatRank` and `p.marketRank` are exposed so the board can show where Larry and the market differ, which is the most useful thing on it.
  - **A no-evidence player keeps a null score and must stay below everyone with a number.** v3 originally overwrote that null with a season value and put several hundred unprojected players back into the middle of the board; `tools/preseason-vs-experts.ts` caught it by putting Damian Lillard at 738. See the guard in `applyPreseasonV3`.
- **In-season rest-of-season value** (v3, in `js/engines.js` `applyRestOfSeason`): `rosValue = (rateValue - replacement) * expectedRemainingGames / 82`. Availability enters exactly once, here; `tests/engine/inseasonBoard.test.ts` pins the identity. Mid-season the useful question is not who is the better player but who will produce more from here, and those differ whenever remaining availability does. Measured over seven checkpoints in each of the last two seasons (`docs/RANKINGS_V3_INSEASON_BACKTEST.md`): average rest-of-season rho **0.467 against per-game value 0.423** at the four original checkpoints, and 0.694 against the whole board at the three early ones. The form was chosen on the original four, where it ran 0.455 against 0.403 before change A improved both.
  - **Subtracting replacement first is what makes it work.** Multiplying raw per-game value by games scored 0.382, WORSE than per-game alone, because it rewards durable mediocrity: a replacement-level player who suits up nightly piles up a big number without being worth a roster spot. The thing that scales with games is value ABOVE the waiver wire.
  - **Never feed this to the matchup engines.** Weekly decisions use per-game value times games THIS WEEK, a different question; season-long value would make the strategy engine prefer durable players in a week they barely play. The Players tab has a Per game / Rest of season toggle (`S.prefs.valueView`), default rest of season.
  - Value above replacement ALONE cannot reorder an in-season board: subtracting and multiplying by constants leaves the order untouched. It only does anything multiplied by games that differ per player.
- **Availability vs DURANT**: `durantScore` and `durantRank` are season-long value and are what every ranking surface sorts on. `availability` (0 to 1) and the opportunity boost are separate fields combined into `effectiveDURANT`, which only add/drop, streaming and lineup logic may read. Any multiplier applies only when the score is positive, because scaling a negative score raises it.
- **H2H Each Category**: League format. Categories: REB, AST, STL, BLK, PTS (display in this order everywhere).
- **Games remaining**: Most important variable. Factor into every analysis. Raw averages without games context are meaningless. `gamesRemaining` counts the current **matchup window**, never a calendar week: the preseason sits before any NBA game, so a Monday-to-Sunday assumption reports zero for everyone. A player with `proTeamId` 0 is not on an NBA team and gets **zero** games, never the 3.5-per-week estimate.
- **Scoring period vs matchup period**: ESPN's two period concepts, and confusing them has broken this app twice.
  - A **scoring period** is a single DAY. Period 1 is opening night (Tue Oct 20 2026), 2 is Oct 21, up to 174 on Apr 11 2027.
  - A **matchup period** is one head-to-head matchup. `scheduleSettings.matchupPeriods` maps each one to the list of **WEEKS** it covers: `{"1":[1], ..., "18":[18,19]}`. Those values are week numbers, *not* scoring periods.
  - Reading them as scoring periods made matchup 1 one day long and the two-week playoff matchups two days long. Live symptom: 168 of 1000 players had exactly 1 game and Jokic had 0 despite playing Oct 22 and Oct 24.
  - Week 1 is short: opening night through the first Sunday on or after it (Oct 20 to 25). Every later week is Monday to Sunday, **except the All-Star week**, which ESPN folds into a single 14-day week, shifting every week after it by 7 days. A matchup's window is its first week's first day through its last week's last day. `activeMatchupWindow()` in espn.js owns this; `S.matchup.startDate`/`endDate`/`daysRemaining` publish it and `getMatchupWindow()` in core.js is what UI code should read. `S.matchup.windowSource` records whether it came from the schedule, an observed window, or the calendar fallback.
  - The All-Star week is found from the schedule, not a hardcoded date: the longest run of 4 to 12 gameless days between Feb 1 and Mar 15. The date range is required, because the NBA Cup knockout window leaves a *longer* gameless run (8 days, Dec 4 to 11 in 2026) that would otherwise double the wrong week. Confirmed against the real 2026-27 schedule, whose only two 4+ day gaps are exactly those two. Pinned by `tests/fixtures/nba-schedule-2027-gamedays.json`, which holds the season's real game days.
  - Finished matchups self-correct. `pointsByScoringPeriod` records which days ESPN actually scored, and a scoring period is one day, so `observedMatchupWindows()` gives an exact window with no week arithmetic and is preferred wherever available. `parseMatchup` keeps those period ids as `scoredPeriods`; do not drop them, or the self-correction becomes dead code.
- **Pickup limits**: `S.league.acquisitionLimit` (season) is usually -1 (unlimited) while `matchupAcquisitionLimit` is the one that actually binds. Counts come from `team.transactionCounter.matchupAcquisitionTotals[matchupPeriodId]`. Larry's Move is told the limit *and* `validateMove` drops `add_drop`/`stream` actions server-side once it is spent, because a prompt rule is advisory and ESPN would reject the add anyway.
- **Matchup strategy**: Weekly strategy engine (Engine 12) classifies each category as Lock (>70% win probability), Target (30-70%), or Punt (<30%). Strategy drives recommendations, add/drop suggestions, and streaming picks. Recalculates on team change or sync.
- **Injury awareness**: Players with OUT, SUSPENSION, or IR status are filtered from add recommendations and free agent suggestions in chat. Injury status shown on tiles, roster rows, and chat context. Never recommend injured players as pickups.
- **Cookie linking (Phase 2+)**: ESPN's `espn_s2` and `SWID` cookies live in `S.espn` (localStorage). Two paths: (a) manual paste in wizard step 3, (b) Larry Link bookmarklet on fantasy.espn.com that base64-encodes the cookies into a URL fragment and redirects through `/link` (handled by `public/link.html` + `dist/larry-cookies.js`) which writes to `S.espn` and bounces to the app. No server-side cookie storage; cookies stay client-side only. 401 from ESPN sets `S.espn.cookieExpired` and `safeRender` shows a banner with a Reconnect button routing to `/connect`.

## Netlify Functions

- `espn-proxy.js` -- ESPN API CORS proxy
- `larry-chat.mjs` -- Chat. Builds the system prompt **server-side**; the client sends structured context only. Every ESPN-sourced string is sanitized into a delimited `<data>` block labelled untrusted, because team names are written by other managers in the league. Origin allowlist, per-IP rate limit, payload caps.
  - **Functions v2 and streamed, because a buffered answer does not fit in 10 seconds.** Every real question used to die at 9.6s and come back as a 500 saying "Chat is unavailable right now." Measured on the live site: a streamed response delivers all 31 lines of a 30-second probe unbuffered and closes at 29.4s, first byte ~350ms, so the 10s kill applies to buffered responses only. The function caps itself at 25s. See `docs/CHAT_TIMEOUT_SPEC.md`.
  - **`claude-sonnet-5` thinks unless you tell it not to, and thinking shares `max_tokens` with the answer.** Omitting `thinking` runs adaptive thinking at effort `high`, and `display` defaults to `"omitted"`, so the old function spent its 9 seconds on reasoning that came back as empty blocks. It now sends `thinking: {type: 'adaptive', display: 'summarized'}` so the reasoning is visible progress instead of a blank wait, and `MAX_TOKENS` is 4000 so thinking and the answer both fit. Do not drop that to 1500; a question that reasons for a while would have nothing left to answer with.
  - **Frames are newline-delimited JSON**: `{"t":"..."}` answer text, `{"k":"..."}` thinking text, `{"done":true}`, `{"error":"..."}` where `"cut short"` means the cap fired and the partial answer is usable. Answer and thinking are separate keys on purpose: the client renders thinking and throws it away, and must never store it as something Larry said.
  - A timeout is a **504** with "Larry took too long on that one. Tap retry.", not a 500. The status is chosen before the first frame goes out, which is why the function waits for the first event from Claude before committing to a 200.
- `larry-move.mjs` -- Larry's Move. Same trust model, plus a forced `report_move` tool and server-side validation of the result before the client renders it. Streams NDJSON (see below).

Chat reads the model from `process.env.ANTHROPIC_MODEL` (default `claude-sonnet-5`). Larry's Move reads `process.env.ANTHROPIC_MOVE_MODEL`, then `ANTHROPIC_MODEL`, then `claude-sonnet-5`; on a 404 it falls back to `ANTHROPIC_MODEL`. **Both stream** (Functions v2, `.mjs`): Netlify kills a BUFFERED response at 10s, which is what broke Move (8.5 to 9.3s timeouts on the chat model) and chat (9.6s). A streamed response survives past 29s on this site. Move streams `{"p":n}` progress lines and then one `{"move":...}` line, because its card is structured and has nothing useful to show half-written; chat streams text. Both stop themselves at 25s (`ANTHROPIC_STREAM_CAP_MS`). Never pin a model id in code: `claude-sonnet-4-20250514` was hardcoded here and silently 404'd for months after it retired, and `claude-haiku-5-5` was retired under Move in October 2026.

## Analysis Engines (js/engines.js)

All engines live in the `Engines` IIFE module.

1. **Z-Scores** -- Per-category z-scores for all players against league averages
2. **Monte Carlo** -- Forward-projected matchup simulation using remaining games
3. **DURANT Ranking (v2)** -- Per-game z vs a starter-quality Q-pool, shrunk and capped. No multipliers. `computeDURANT` delegates to `window.LarryEngine.computeBaseValues`; `ensureDURANT` is the entry point renders should call, which computes once per sync instead of on every tab switch.
3.5. **Availability Score** -- Multiplier based on injury status and games played consistency. Feeds `effectiveDURANT` only, never `durantScore`.
3.6. **Opportunity Boost** -- Multiplier for players on teams with injuries to key players
4. **Recommendations** -- Add/drop and streaming suggestions, matchup-adjusted via strategy weights. Filters injured players (OUT/SUSPENSION/IR). Uses 40% DURANT + 60% matchup fit blend when strategy exists.
5. **Trade Analyzer** -- Evaluate proposed trades by category impact
6. **Punt Analysis** -- Identify optimal punt builds for the roster
7. **Category Volatility** -- Measure stat consistency vs boom/bust tendency
8. **Streak Detection** -- Hot/cold streak identification from recent vs season splits
9. **ROS Projections** -- Rest-of-season projected totals
10. **Risers and Fallers** -- Trending players based on recent production changes
11. **Trade Finder** -- Auto-find mutually beneficial trades with other teams
12. **Matchup Strategy** -- Weekly strategy: classifies categories as Lock/Target/Punt using projected margin as percentage of total production. Drives recommendation weighting.

**matchupAdjustedValue()** -- Helper that scores a player's z-scores weighted by the current strategy's category weights (targets 2x, locks 0.5x, punts 0.3x). Used by Engine 4 to rank pickups and streaming options.

## Commands

- `node --check js/*.js` -- Syntax-check legacy JS files. Run before every commit that touches `js/`.
- `npx tsx tools/rank-v2-vs-experts.ts` -- Ranking v2 acceptance gate: score parity with `tools/proto.py` plus rank correlation against the expert consensus. Needs a snapshot at `tests/fixtures/users/rank-v2-parity-snapshot.json` (git-ignored). Run it after any change to `src/engine/zscore.ts` or `computeDURANT`.
- `python -I tools/proto.py tests/fixtures/users/rank-v2-parity-snapshot.json tests/fixtures/rank-v2-expert-baseline.csv --csv <out.csv>` -- Regenerate the parity baseline the gate above asserts against, FROM proto.py, so parity holds by construction rather than by loosening the check. The expert and legacy columns are carried through from the existing baseline because they are inputs, not outputs. Write to a temp path and move it into place; do not write over the input.
- `npx tsx tools/backtest-inseason-ranking.ts [--write]` -- In-season board gate: seven checkpoints in each of 2024-25 and 2025-26, comparing the shipped board against candidate changes to `rateValue`. The three early checkpoints score the whole board with no minimum-games filter, which is the only way to see what an unprojected player's prior does. Exits non-zero if the shipped change regresses. `--write` updates `docs/RANKINGS_V3_INSEASON_BACKTEST.md`.
- `npx tsx tools/inseason-board-diff.ts <scoringPeriodId> [snapshot]` -- What a ranking change does to the LIVE in-season board, by running `js/engines.js` itself with the real engine attached. Prints the unprojected count inside the top 150, a named-player table and the twenty largest moves. Build the snapshot with `tools/kona-to-snapshot.ts` from a public `kona_player_info` fetch, no login required.
- `npx tsx tools/preseason-vs-experts.ts` -- Preseason board gate: rho >= 0.70 and top-50 overlap >= 34 against `tests/fixtures/expert-consensus-2026-10-13.json`, plus named spot checks. Needs `tests/fixtures/users/preseason-2027-snapshot.json` (git-ignored); build one with `tools/kona-to-snapshot.ts` from a public `kona_player_info` fetch, no login required.
- `npx tsx tools/backtest-preseason-board.ts [--write]` -- Score the preseason board against real 5-category outcomes for 2025 and 2026, alongside FantasyPros ECR, Yahoo ADP and ESPN ADP, with a paired bootstrap. Exits non-zero until the current board reconciles with the reviewer's baseline. `--write` updates `docs/RANKINGS_V3_BACKTEST.md`.
- `npx tsx tools/fetch-preseason-rankings-history.ts` -- Refresh `data/preseason-rankings-history.json` (FantasyPros ECR plus Yahoo and ESPN ADP). Public data, committed.
- `npx tsx tools/fetch-espn-adp-history.ts` -- Refresh `data/espn-adp-history.json` (historical ESPN ADP from FantasyPros, seasonId 2019 on). Public data, committed. `--check` parses without writing. Run before each season.
- `npx tsx tools/fit-mock-draft.ts <export>` -- Fit the Draft Room's pick model on 2019 to 2025 and test on held-out 2026 against a rank-only baseline, with a per-term ablation. Needs a local export of `larry_draft_history` under `tests/fixtures/users/` (git-ignored, never committed).
- `npx tsx tools/fetch-espn-history.ts` -- Refresh `tests/fixtures/projections/espn-history.json` (four seasons of real totals plus ESPN projections). Run before each season.
- `npx tsx tools/backtest-projections.ts [--tune]` -- Tune the projection model on 2025, report on 2026 against ESPN. Pinned by `tests/engine/backtestProjections.test.ts`.
- `grep -rP '[\x80-\xFF]' js/` -- ASCII verification. No smart quotes or unicode corruption.
- `npx serve .` -- Local dev server (no Netlify functions locally, but UI works).
- `npm test` -- Run vitest suite for new TypeScript code under `src/` and `tests/`.
- `npx tsc --noEmit` -- Typecheck new TS code without producing build output.

## Git Workflow

- Work on `dev` branch. When ready to deploy: push `dev`, merge `dev` into `main`, push `main`. Netlify auto-deploys from `main`.
- For larger features, use `feature/*` branches off `dev`.
- Commit messages: `fix: keyboard dismiss on Players search` or `feat: date-scrollable roster view`
- Bump `CACHE_VERSION` in sw.js with every push that changes any file.

## Code Conventions

### Legacy `js/*.js` (existing files)

Files in `js/` deploy straight to the browser with no build step, so whatever is written here has to run as-is.

**House style (enforced):** `var`, not `let`/`const`. `function` expressions, not arrow functions. String concatenation, not template literals. This is a consistency rule, not a compatibility one; keep it so the files read as one codebase.

**Actual language baseline: ES2017.** The previous rule said "ES5 for maximum compatibility", but that was never true of the shipping code: `js/` contains 7 `async function` declarations and 43 `\u{...}` code-point escapes, both of which are *syntax-level* ES6+. A genuine ES5 engine would throw `SyntaxError` while parsing and the app would not load at all. Since it does load, every browser in use supports ES2017. So `Array.prototype.find`, `includes`, `startsWith`, `padStart` and `Object.assign` are all fine, and rewriting them into loops buys nothing. Do not "fix" them.

**Still genuinely required:**
- `node --check js/*.js` before every commit. With no build step this is the only thing standing between a typo and a blank app.
- ASCII only. Write the escape sequence, never a pasted arrow glyph.

- Global modules use IIFE pattern: `var ModuleName = (function() { ... return { publicAPI }; })();`

### New TypeScript code (`src/`, `tests/`)

- Modern TypeScript with `strict: true` and `noUncheckedIndexedAccess: true` (see `tsconfig.json`).
- Use `let`/`const`, arrow functions, template literals, ES modules, generics, all the modern things. The legacy ES5 rule does NOT apply here.
- Engine modules (`src/engine/*.ts`) must be pure functions over typed inputs. Do not import from `src/data/*` or any I/O-touching module. This is what makes them testable and backtest-friendly.
- I/O lives in Netlify Functions (`netlify/functions/*.ts` once that migration starts) and `src/data/*`. UI consumes typed responses; it never recomputes ranks.
- Build pipeline (compile `src/` to `dist/` for browser consumption) is added in Phase 1 when the first `src/engine/*.ts` lands. Until then `tsconfig` runs in `noEmit: true` typecheck-only mode.

### General conventions (apply to both legacy and new code)

- State access: `S.espn`, `S.league`, `S.myTeam`, `S.matchup`, `S.players`, `S.teams`
- Every tab/page render wrapped in try/catch with diagnostic error card (never blank screens).
- Mobile search inputs: use `oninput` with debounce, NOT `onkeyup` (preserves mobile keyboard).
- All stat columns sortable (tap header toggles asc/desc).
- Stat column order everywhere: REB, AST, STL, BLK, PTS.
- Collapsible sections: expanded first visit, collapsed on return.
- Add/drop tiles show player headshot, name, position, drop target, and reason.

## ESPN API

- Endpoint: `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{seasonId}/segments/0/leagues/{leagueId}`
- Views: `mTeam`, `mRoster`, `mMatchup`, `mMatchupScore`, `mSettings`, `kona_player_info`
- Auth: `Cookie: espn_s2={espn_s2}; SWID={swid}` passed via proxy
- Position IDs: 1=PG, 2=SG, 3=SF, 4=PF, 5=C, 12=Bench, 13=IR
- Stat IDs: 0=PTS, 1=BLK, 2=STL, 3=AST, 6=REB

## Design

- Dark theme: #0a0a1a background, #12122a cards, #3b82f6 accent blue
- Positive: #22c55e. Negative: #ef4444. Gold: #f59e0b.
- Category colors: REB=Orange, AST=Green, STL=Purple, BLK=Red, PTS=Blue
- Status badges: green=Healthy, yellow=GTD, red=OUT, white=IR
- Mobile-first. Touch targets minimum 44px. Test on iPhone Safari.

## Larry Chat (js/chat.js)

Chat context sent to Claude includes:
- Current matchup scores and record
- Matchup strategy (Lock/Target/Punt categories)
- Full roster with z-scores, DURANT scores, injury status, and slot
- Top 10 free agents (filtered: excludes OUT/SUSPENSION/IR players)

The chat is strategy-aware. It references target categories when discussing pickups and trades.

The reply **streams**. `runChatRequest()` reads newline-delimited JSON frames (see `larry-chat.mjs` above) and patches two elements inside the live bubble, never the input, per the mobile-keyboard rule. Rules that have each broken once and are invisible when they break:
- **Nothing enters `_chatHistory` until the stream finishes.** A cut-short answer goes in with a plain-text "(answer was cut short)" note.
- **Error text never enters `_chatHistory`**, or every later request replays "Chat is unavailable right now." to the model as a real assistant turn and teaches it that apologising is a normal answer.
- **Thinking text never enters `_chatHistory` either.** It is the model's own reasoning, shown dimmed as progress and discarded when the answer starts.
- Any retryable failure (504, 502, 500, 429, or a cut-short) shows a **Retry** button. Retry resends the question already at the end of the history; it must not push the user turn again.
Pinned by `tests/functions/chatClient.test.ts` and `tests/functions/larryChatStream.test.ts`.

## Testing Checklist (run after every feature)

1. `node --check js/*.js` passes (legacy ES5 syntax check)
2. `npm test` passes (vitest suite for new TS code, when `src/`/`tests/` is touched)
3. `npx tsc --noEmit` passes (typecheck for new TS code, when `src/`/`tests/` is touched)
4. No non-ASCII characters in JS files
5. All file references in index.html, manifest.json, sw.js match actual filenames
6. Test with fresh state (clear localStorage), mid-use state, and edge state
7. Test date operations at 11:30 PM local timezone
8. Verify scroll works on all pages (overflow-y: auto on content containers)
9. Verify mobile keyboard doesn't dismiss on search inputs
10. No console errors on any tab

## Do NOT

- Use `let`, `const`, arrow functions, or template literals in legacy `js/*.js` files (the ES5 rule applies to legacy code only; `src/*.ts` follows modern conventions)
- Recommend dropping top-tier players (top 60% by DURANT rank) in the Decision Hub
- Recommend adding players with OUT, SUSPENSION, or IR injury status
- Re-render input elements during search (causes mobile keyboard dismissal)
- Use `new Date().toISOString()` for local dates (use local timezone conversion)
- Put long content in fixed-height containers without overflow scroll
- Hardcode team names or roster data, everything comes from ESPN API
- Divide `stats.season` by `gamesPlayed` (it is already per-game, see Key Concepts)
- Parse a schedule date with `new Date('YYYY-MM-DD')` (reads as UTC midnight and drops today's games after 7pm Central). Compare local `YYYY-MM-DD` strings instead.
- Invent data when the real thing is missing. Show "unavailable" instead; the player popup used to hash the team name into a fake 7-day schedule.
- Treat the season `acquisitionLimit` as the binding pickup limit, or derive the matchup window from a Monday-to-Sunday calendar week (see Key Concepts).
- Read `scheduleSettings.matchupPeriods` values as scoring periods. They are week numbers. Call `getMatchupWindow()` rather than `getMatchupDates()` for anything the user sees.
- Assume every ESPN week is 7 days (the All-Star week is 14) or search the whole season for the break (December's NBA Cup gap is longer).
- Cache the NBA schedule for the season. It changes: NBA Cup games and reschedules are added later. `loadNbaSchedule` refetches when `S.scheduleFetchedAt` is over 24 hours old.
- Shrink a small sample toward the pool mean. Use the player's own projection, or every player scores 0 before opening night; with no projection at all use the replacement line, or one garbage-time appearance makes an unprojected player an average starter (see Key Concepts).
- Trust a prompt rule to constrain model output when the constraint is checkable in code. Enforce it in the validator too.
- Write `(p.durantScore || 0)` or `(p.effectiveDURANT || 0)` in a sort comparator. Null means "no evidence" and must sort below every number; `|| 0` puts the player at average-starter. Use `durantKey()`.
- Divide `projectedSeason` by 82 for anything preseason-facing, or by `projectedGP` for the in-season shrink prior. The two divisors are not interchangeable, and the in-season swap has already been measured and rejected (see Key Concepts).
- Trust that ESPN's current-season `statSourceId 1, statSplitTypeId 0` set is rest-of-season. It is a FULL-SEASON total all year and ESPN revises it, which is why dividing by games stays correct in March. `checkProjectionDivisor` in espn.js warns in the sync log if the median projected GP ever collapses below 40 before the All-Star break, which is what a change of meaning would look like.
- Change the ranking, preseason or in-season, without beating the backtest gates in `docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md` and recording the result in `docs/RANKINGS_V3_BACKTEST.md`. `npx tsx tools/rank-v2-vs-experts.ts` must stay at parity with `proto.py` and rho 0.758, and `npx tsx tools/backtest-preseason-board.ts` must reconcile against the reviewer's baseline before any tuning is believed. Agreeing with the experts is not the target; actual outcomes are. Preseason work goes behind `isPreseason()`; projection work goes behind `S.prefs.useLarryProjections`.
- Put an injury opinion in `data/projection-overrides.json`. It is for cases where ESPN's data is provably wrong, with an `until` date so it expires.
- Pin a Claude model id in a Netlify function. Read `process.env.ANTHROPIC_MODEL` with a current default, or it silently 404s when the model retires.
- Make `larry-chat` buffer its reply again, or lower its `MAX_TOKENS` to fit one. A buffered answer dies at 10s and thinking shares the budget (see Netlify Functions).
- Push streamed thinking text, or any error text, into `_chatHistory`. Both get replayed to the model as a real assistant turn on every later message.
- Add an HTML page without the home-screen icon block (manifest, 180px `apple-touch-icon`, favicon, `apple-mobile-web-app-title`). Phones take the icon from whichever page is open when "Add to Home Screen" is tapped; `/connect` and `/link` had none, so the app was saved as a letter "L". Icons are generated from `assets/icon-512.png`: opaque 180px for iOS at `/apple-touch-icon.png`, and `icon-maskable-*.png` with the art inside the 80% safe zone for Android.
- Commit any league member's draft history, manager names, or derived profiles. The repo is public. Tests use the synthetic generator in `tests/engine/draftFixtures.ts`; real exports live in git-ignored `tests/fixtures/users/`.
- Measure Draft Room reach against `draftRanksByRankType` or `ownership.averageDraftPosition` for a PAST season. Both are end-of-season values and make every manager look like a genius or an idiot depending on who broke out. Use `data/espn-adp-history.json`.
- Commit directly to `main`
- Use em dashes in any file (use commas, periods, or double hyphens)

## Reference Docs

- `docs/HANDOFF.md` -- The 8-phase roadmap this app was rebuilt against. **All 8 phases are complete.** Kept for the rationale behind each change; the "current bugs" it describes are fixed.
- `docs/RANKING_V2_SPEC.md` -- Ranking v2 algorithm, measurements and acceptance criteria
- `docs/RANKINGS_V3_1_INSEASON_SPEC.md` -- The in-season fixes: the replacement-level prior (shipped), the single availability discount (measured and rejected) and the projection guard. Results in `docs/RANKINGS_V3_INSEASON_BACKTEST.md`.
- `docs/DRAFT_ROOM_SPEC.md` -- Draft Room: manager profiles, the AI pick model, availability odds
- `tools/proto.py` -- Reference implementation of ranking v2. `tools/rank-v2-vs-experts.ts` asserts the TypeScript engine reproduces it.
- `LARRY_PLAN.md` -- Earlier improvement roadmap (Phases 0 through 7), superseded by `docs/HANDOFF.md`
- `PLAN_RECONCILED.md` -- Phase 0 reconciliation: plan paths to actual paths, architectural conflicts
- `REPO_MAP.md` -- Phase 0 audit: file tree + key-file summaries
- `docs/SCHEMA.md` -- Full state object schema, all localStorage keys
- `docs/BUGS.md` -- Current bug list with priority order
- ESPN Fantasy app/website -- Baseline UX reference for roster view, player cards, matchup layout
- BasketballMonster.com -- Z-score rankings, punt analysis reference
- HashtagBasketball.com -- Player rankings, schedule grid, data density reference
