# Larry handoff for Claude Code

Date: 2026-10-12. Baseline: `main` at 94af034, live site sw.js `larry-v3.8.1`. Source of findings: two code-review passes, a headless run of `js/engines.js` against a real `larry_state` snapshot, and a click-through of every page in the live app. Items marked (verified) were reproduced; (review) were found by reading code.

Follow CLAUDE.md throughout: legacy `js/*.js` stays ES5 (var only, no let/const/arrows/template literals, no `.find`/`.includes`), new logic goes in `src/**/*.ts` as pure functions, work on `dev`, bump `CACHE_VERSION` in `sw.js` on every push, no em dashes in any file, run `node --check js/*.js`, `npm test`, `npx tsc --noEmit` before each commit.

Do the phases in order. Phase 1 changes the meaning of `stats.*`, so everything after it depends on it.

---

## Phase 1: data correctness (do first, before opening night)

### 1.1 Per-game normalization at parse time
Problem (verified): `stats.season.*`, `last30`, `last15`, `last7` are totals. Jokic `stats.season.PTS = 1799` over 65 GP. Most engines read them as per-game averages. Effects seen live: ROS Projections shows Towns at 78,905 PTS; matchup strategy projects remaining production at 52x the actual weekly score so every category is "Target"; Risers/Fallers shows +0% / -100% for everyone; `frustrationValue` is NaN for 137 of 666 players.

Change:
- In `js/espn.js` `parsePlayer`, keep the raw totals under `stats.totals.{season,last30,last15,last7}` and store per-game under `stats.season`, `stats.last30`, `stats.last15`, `stats.last7` (divide each counting stat by that split's GP; percentages pass through). Store each split's GP as `stats.gp.{season,last30,last15,last7}`.
- ESPN gives GP per split in the stat set (id 42). Use it; do not divide last7 by the season GP.
- Keep `projectedSeason` as totals but add `projectedPerGame = projectedSeason / 82`.
- Add a one-time migration in `loadState()` keyed on `S.version` so an existing `larry_state` with totals is converted or forced to resync.
- Audit every reader: `computeAllZScores`, `getBlendedStat`, `rosProjections`, `computeMatchupStrategy`, `risersAndFallers`, `detectStreaks`, `monteCarloMatchup`, `puntAnalysis`, `getPerGameStats` (espn.js:641, which currently divides by GP; make it a passthrough), tabs.js stat tables, chat.js context, `v2BuildPlayerProjection` (engines.js:335, which currently expects totals).

### 1.2 ESPN stat id map (verified)
`ESPN_STAT_MAP` in core.js:29 has FG and FT swapped and labels minutes as OREB. Jokic's stored FTM/FTA = 644/1132 = 56.9%, which is his FG%; stored FGM (480) > FGA (399).
Correct: `13: FGM, 14: FGA, 15: FTM, 16: FTA, 40: MIN, 41: GS, 42: GP`. Remove the OREB/DREB labels on 40/41 unless you confirm ids 4 and 5 for those. `gamesPlayed` at espn.js:324 falls back to `stats['40']` (minutes) when 42 is missing; drop that fallback.

### 1.3 Season rollover (verified)
`seasonId: 2026` is hard-coded in core.js:88. ESPN's 2026 is the 2025-26 season, so the live app shows matchup 21 of 21 and clinched playoffs. Derive it: `month >= 9 ? year + 1 : year` (Oct 2026 -> 2027), and prefer `mSettings.seasonId` from the first sync. Show a banner if the stored seasonId differs from the computed one and offer a one-tap resync. Update the endpoint comment in CLAUDE.md.

### 1.4 Real schedules (verified that every player has `schedule: []`)
`enrichGamesRemaining` (espn.js:605) falls back to `round(daysLeft * 0.5)`, so all 666 players have `gamesRemaining = 4`. Everything that CLAUDE.md says depends on games remaining is running on a constant.
- Fetch ESPN `proTeamSchedules_wl` once per sync (`.../apis/v3/games/fba/seasons/{season}?view=proTeamSchedules_wl`), cache under `S.scheduleLookup[proTeamId] = [{date, opp, home, timeUTC}]`, and derive `p.schedule` from `p.proTeamId`.
- `gamesRemaining` = games with `date >= today && date <= matchup.endDate`, compared as local `YYYY-MM-DD` strings, never via `new Date('YYYY-MM-DD')`, which parses as UTC midnight and in Chicago drops today's games after 7 PM (tabs.js:523, espn.js:617, verified).
- Also compute `gamesRemainingROS` (to season end) for ROS projections; today `p.gamesRemainingROS` is referenced but never set.
- Format game times with `toLocaleTimeString` in the user's zone; remove the fixed UTC-5 "ET" offset (tabs.js:2397, espn.js ~500).
- Delete the fabricated schedule in the player popup (tabs.js:2383-2400); show "Schedule unavailable" when empty.

---

## Phase 2: ranking v2 (replaces the DURANT base score)

Measured on the Oct 12 snapshot against the FantasyPros 6-expert consensus (top 150): legacy DURANT rank correlation 0.296, top-50 overlap 26/50; v2 0.786 and 35/50. Experts rank 9-cat; Larry is 5-cat, so some gap is expected (3PM/FT% guards like Knueppel and Coby White rank lower here by design).

Algorithm (pure function, put it in `src/engine/zscore.ts` next to the existing `buildQPool`, expose through `dist/larry-engine.js`, call it from `computeDURANT`):
1. Inputs per player: per-game `REB, AST, STL, BLK, PTS` (from 1.1), `gp`. Fall back to `projectedPerGame` when `gp == 0`.
2. First-pass pool: players with `gp >= 10`. Mean and sample stdev per category.
3. Q-pool: rank by sum of z, keep top `12 * rosterSize` (156 at 13), recompute mean/stdev, 2 iterations total.
4. Shrink small samples toward the pool mean: `w = gp / (gp + 8)`, `pg' = w * pg + (1 - w) * poolMean`.
5. `z[c] = (pg'[c] - mean[c]) / stdev[c]`, capped to [-3, 3].
6. `baseValue = sum(z[c])` over `league.categories` (do not hardcode the five).
7. `durantScore = baseValue * 10` to keep the existing scale, because `tabs.js:2034` (+3 notification gap), `engines.js:886` (trade acceptance) and `engines.js:530` (40/60 blend) assume it.

Constants: `Q_POOL_MULTIPLIER 12`, `Q_POOL_ITERATIONS 2`, `SHRINK_K 8`, `Z_CAP 3`, `MIN_GP_POOL 10`.

Rules:
- No injury, GTD, low-GP or schedule multipliers on the base score. A flat OUT haircut did not improve agreement with experts and buried stars (Doncic 3rd -> 10th at x0.4). 129 of 666 players carry OUT with no return date.
- Keep `availability` (0 to 1) and the opportunity boost as separate fields used only by add/drop, lineup and streaming. Any multiplier applies only when the score is positive (today a x0.3 on a negative score moves the player up; Duop Reath OUT z -4.2 ranks 470 while Chris Paul ACTIVE z -4.1 ranks 601, verified).
- Drop the scarcity re-weighting in `computeAllZScores` (engines.js:31-41); equal category weights are correct for H2H each-category.
- Keep the field names `durantScore`, `durantRank`, `effectiveDURANT` so tabs.js, chat.js, trade analyzer and notifications keep working.
- Hoist `avgGamesRemaining` out of the per-player loop (engines.js:225-231, O(n^2)). Compute DURANT once per sync, store `S.analysisCache.durantComputedAt`, and make renders read instead of recompute (today it runs on Roster, Trade Center, Draft Center, Projected Standings, Opponent Scout and Timeline renders; `generateRecommendations` runs on every Roster date-nav tap).

Acceptance: load the snapshot, compute v2, rank correlation with the expert top 150 >= 0.75; Doncic, Durant, Flagg, Giannis, Tatum all inside the top 40 regardless of OUT status. Vitest fixture: a low-GP star, a negative-score injured player (must not move up), a BLK outlier (cap).

---

## Phase 3: engine bug fixes

3.1 **Matchup strategy** (engines.js:936-975, verified every category = Target). After 1.1, replace `50 + marginPct * 30` with a real probability: per category, `mean = myNow - oppNow + sum(myPG * gamesLeft) - sum(oppPG * gamesLeft)`, `var = sum(myVar * gamesLeft) + sum(oppVar * gamesLeft)` where per-game variance comes from the last-15/last-30 splits (or a per-category proxy until gamelogs exist), `winProb = normalCDF(mean / sqrt(var))`. Lock > 0.70, Punt < 0.30. Share this function with the Monte Carlo engine or delete Monte Carlo.

3.2 **ROS projections** (engines.js:757-800): `projected = currentTotal + perGame * gamesRemainingROS`; delete the `* 0.5` on `avgGamesPerDay` (82/170 is already per team per day) and stop letting the weekly `gamesRemaining` override the season estimate.

3.3 **Risers/Fallers and trend** (engines.js:804, :70, :743): compare per-game last-7 (or last-15) to per-game season. Unify the three trend thresholds (0.15, 0.2, capped avg) into one helper.

3.4 **Recommendations** (engines.js:470-620):
- Collect all pickup/drop pairs, sort, then take the top 5 with distinct pickup and distinct drop (today all five tiles say "drop Jonathan Kuminga", verified).
- Put `matchupImprovement` on the same scale as `durantImprovement` (x10) and gate on the blended value, not on `durantImprovement <= 0`.
- Treat `INJURY_RESERVE` the same as `IR` and `OUT` everywhere (`isValidAddCandidate`, chat filter, opportunity boost). Snapshot vocabulary seen: ACTIVE, OUT, DAY_TO_DAY; normalize at parse time to one enum.
- Sort on a single numeric key; the current comparator (`Math.abs(diff) > 2` then tiebreakers) is not transitive.

3.5 **Trade Finder** (engines.js:837-916, verified 0 results at `minAcceptance: 0`): acceptance sign is backwards (`50 + (their - mine) * 2`). Rebuild acceptance as the other team's category-need gain minus loss, using `getTeamCatRank` style ranking across teams rather than "z-sum below zero" for weak categories. Park the feature behind a flag until this lands.

3.6 **Trade Analyzer** (engines.js:623): grade on per-category z deltas and the user's current strategy weights, not on raw DURANT totals.

3.7 **NaN guards**: `getBlendedStat` (:94) and `frustrationValue` (:75) use `!== null` on values that are `undefined`; use `== null`. Monte Carlo `playerVariance` (:129) NaNs when `last7` is empty.

3.8 **Shared-state mutation**: `renderROSProjections` (tabs.js:1348) and chat.js:118 sort `S.myTeam.players` in place and the order persists through autosave. Use `.slice()` before sorting. Draft Center mutates `p.tier`/`p.projectedRound` on global players (tabs.js:1436).

3.9 **Stale copies**: `S.teams[].players` and `S.myTeam.players` are separate deserialized copies; `computeDURANT(S.allPlayers)` does not refresh them. Add `enrich(stub)` that resolves by id into `S.allPlayers`, and use it in TOTW (tabs.js:580), Team Analyzer (:1284), Projected Standings (:1503), Timeline (:1891), Opponent Scout (:1631) and Roster z/trend reads (:351, :373).

---

## Phase 4: UI bug fixes (js/tabs.js)

- Players sort: first tap sorts ascending (verified). In `sortPlayers` make dir mean 1 = desc, apply `dir` to the name branch too, add a sort indicator (core.js has `sortIcon`), allow restoring the default order, and read `rosProjection[col]` for the ROS view (:933-944 currently sorts on zeros).
- Fix the hard-coded "Sorted by Availability Score" label (:954).
- Notifications (:2028-2040): filter OUT/SUSPENSION/IR before suggesting a free agent; sort and compare on the same field. Or remove the page (see cuts).
- `renderMatchupStrategy` (:418): default `locks/targets/punts` to `[]`.
- Player popup: wrap `renderPlayerPopup` in try/catch with an error card; guard `p.stats`; rename "Log" to "Splits" and "News" to "Status" unless real data is wired.
- Trade search (:1206): 250 ms debounce like `handlePlayersSearch`; do not rewrite the input.
- Sync Now (:2090): disable while running, toast on finish.
- Collapsibles: route Dashboard, TOTW and schedule grid through `toggleSection`/`isSectionCollapsed`.
- Players table: "Show 100 more" button; header count says 666 while the table shows 100.
- Roster tables sortable (CLAUDE.md requires it); `th` as buttons for keyboard access.
- Players tab gets its own day navigation instead of sharing Roster's `_dayNavOffset`.
- `v2EngineToggle` handler (:2119): guard `S.prefs`, use `autosave`.
- Escape with `esc()`: injury banner names and `alt` (:67, :85-89), `p.nbaTeam` (:376, :1713, :1928, :2193, :2405, :2422), `p.status` (:2195, :2330), strategy cat labels (:435-453), `formatGameCell` output (:1392), `log.status` as class (:2107), `safeRender` message/stack in core.js.
- Accessibility: 44 px minimum on `.date-nav-btn`, `.popup-close`, `.header-btn`, `.btn-sm`, `.sub-tab`, `.popup-tab`, `.filter-select`, day-nav buttons, trade-search rows, injury-banner close; `role="dialog"`, `aria-modal`, `aria-label` on icon buttons; labels for `#players-search` and the trade inputs; remove `user-scalable=no`; `rel="noopener"` on `target=_blank` (:2233).
- ES5 cleanup in legacy files: replace `.find/.findIndex/.includes/.startsWith/.fill` with ES5 equivalents, `\u{...}` with surrogate pairs, and convert `sendChat` from async/await to promise chaining (chat.js:143).
- LEAGUE_MENU (core.js:59): either add `statsTrends`, `schedule` and `opponentScout` entries (so headers stop showing raw ids and the first two stop being dead code) or delete those renderers.

---

## Phase 5: chat and API hardening (netlify/functions/larry-chat.js, js/chat.js)

- Build the system prompt server-side. The client sends `{ context: {...}, messages }` only; delete the client `system` field and the duplicate `buildSystemPrompt` branch that never runs. Sanitize every string from ESPN or other managers (league name, team names, player names, injury notes): strip newlines and control characters, cap at 60 characters, and place them inside a delimited `<data>` block that the prompt labels as untrusted.
- Restrict CORS to `https://larrybball.netlify.app` (and localhost for dev), reject requests without an `Origin` match, cap `messages` at 20 and each content at 4,000 characters, and add a simple per-IP rate limit (Netlify Blobs counter or in-memory with a short TTL).
- Model id from `process.env.ANTHROPIC_MODEL` with a current default; `max_tokens` from env.
- Trim history from the front until the first message is a `user` turn (a `slice(-20)` can start with an assistant turn).
- Do not push error text into `_chatHistory`; show it in the UI only.
- Chat `render()` must update `#chat-messages` only, never rebuild the input (mobile keyboard dismissal).
- Chat context: use per-game stats, include `gamesRemaining` per player, the live category scores and the engine's actual add/drop output so chat and the Roster tiles agree; reuse `isValidAddCandidate` (export it) for the free-agent list.
- Set a function `timeout` in netlify.toml (or keep the Claude call under 10 s) so slow replies do not 502.
- v2 path: fall back to legacy when v2 returns empty or throws; apply the top-60% drop guard in `v2ToLegacyRecs`; point `v2FetchRationale` at `/.netlify/functions/recommend-explain` (or delete it) and memoize on the rec-set signature so it is not an LLM call per render.

---

## Phase 6: new feature, "Larry's Move" on the Roster tab

### What it is
A Larry icon button in the Roster tab header. Tap it and Larry returns one clear answer to "what should I do today to win this matchup", with the reasoning available under a collapsible detail. It is a true analysis (Claude reasons over the engine outputs and the per-game numbers and may disagree with the engine), not a rewrite of the tiles. It is an API call to the existing Claude proxy, cached per sync.

### UI
- Button: `larry-logo.svg` (assets/) in the Roster header next to Sync, 44 px target, `aria-label="Ask Larry for today's move"`. Pulses once when a cached result is stale (new sync since it was generated).
- Tap -> inline card `#larry-move-card` inserted directly under the Dashboard section. States: loading (skeleton, "Larry is thinking..."), result, error with Retry.
- Result layout:
  - Headline: one sentence, plain English, no z-scores, no jargon. Examples: "Start Pritchard over Kuminga tonight and pick up Kel'el Ware for Porzingis." or "No move today. Hold the roster, you are ahead in 3 of 5 and nobody on the wire beats your bench."
  - Up to 3 action rows, each with an icon (lineup / add-drop / IR / hold), the action, and a one-line reason. Each row has a chevron that expands the detail for that action.
  - Collapsible "Why" section (collapsed by default, state remembered via `toggleSection('larryMove')`) with: matchup picture (categories won/lost/close, games left each side), the risk Larry sees, what would change the call (e.g. "if Haliburton is ruled out, start X instead"), and the numbers used (per-game lines, games this week, acquisition budget).
  - Footer: "Based on sync at 10:26 PM" and a Refresh link (forces a new call).
- Cache: store under `S.analysisCache.larryMove = { syncedAt, generatedAt, dateLocal, payloadHash, result }`. On render, show the cached result if `syncedAt === S.lastSyncAt && dateLocal === today`; otherwise show the button in its stale state. Never auto-call the API on render; only on tap or Refresh.
- Daily rollover: the cache is also keyed on the local date, since "today's move" changes at midnight local time (use `localDateStr`, not `toISOString`).

### Payload the client sends (built in a new `js/larry-move.js`, ES5, loaded after engines.js)
All numbers per-game after Phase 1. Keep it under about 6k tokens: cap free agents at 15 and opponent roster at 13.
```
{
  "kind": "larry-move",
  "today": "2026-10-21",
  "league": { "scoringType": "H2H Each Category", "categories": ["REB","AST","STL","BLK","PTS"], "teamCount": 12,
              "rosterSlots": [{"slot":"PG","count":1}, ...], "startingSlots": 8, "benchSlots": 4, "irSlots": 3,
              "acquisitionLimit": -1 or N, "acquisitionsUsed": n, "acquisitionsTotal": n, "waiverRank": n,
              "lineupLock": "daily" | "weekly" },
  "matchup": { "period": 3, "daysLeft": 4, "myScores": {...}, "oppScores": {...},
               "myGamesLeft": 28, "oppGamesLeft": 25, "opponentName": "...",
               "strategy": { "locks": [], "targets": [], "punts": [], "winProb": {"REB":0.81, ...} } },
  "myRoster": [ { "id", "name", "team", "pos": ["PG","SG"], "slot": "BE", "slotEligible": ["PG","G","UTIL","BE"],
                  "injury": "ACTIVE|DAY_TO_DAY|OUT|SUSPENSION|INJURY_RESERVE", "injuryNote": "<=60 chars",
                  "irEligible": true/false, "gamesToday": 0/1, "gameToday": {"opp":"BOS","home":true,"timeLocal":"7:00 PM"},
                  "gamesLeftThisWeek": 3, "gamesByDay": {"2026-10-21":1, ...},
                  "perGame": {"REB":..}, "last15": {"REB":..}, "gp": 12, "mpg": 31.2,
                  "durantRank": 14, "value": 6.2, "trend": "hot|cold|flat" } ],
  "freeAgents": [ same shape, top 15 by effectiveDURANT after isValidAddCandidate, plus "pctOwned" ],
  "oppRoster": [ reduced shape: name, pos, injury, gamesLeftThisWeek, perGame ],
  "engineRecs": [ { "type": "pickup|stream|lineup", "add": "...", "drop": "...", "improvement": 3.9, "detail": "..." } ],
  "ruleSummary": { "irRule": "ESPN: only OUT or INJURY_RESERVE status players can occupy IR", "lineupLock": "..." }
}
```
`irEligible` = ESPN `injuryStatus` is OUT or INJURY_RESERVE (ESPN's rule) and an IR slot is free (`irSlots - players in slot 13`). `lineupLock` comes from `mSettings` (`scoringSettings.lineupLockType` or equivalent; default "daily"). `acquisitionLimit -1` means unlimited.

### Server (new `netlify/functions/larry-move.js`, or a `kind` switch inside larry-chat.js after Phase 5)
- Validate the payload shape and sizes; reject anything else.
- Build the system prompt server-side. Core instructions, in order:
  1. Role: fantasy basketball analyst helping one manager win THIS week's H2H category matchup.
  2. Hard rules: never recommend adding OUT, SUSPENSION or INJURY_RESERVE players; never recommend dropping anyone ranked in the top 60% of the user's roster by `value` unless replacing with a clearly better healthy player and say why; respect `acquisitionsUsed` vs limit and say when a move would spend the last acquisition; only propose IR moves for `irEligible` players when a slot is free; respect `lineupLock` (if weekly, lineup advice is for the week, not tonight).
  3. Method: (a) decide which categories are winnable, lost, or close given current scores, games left per side and per-game rates; (b) check today's lineup: every starter with a game today, bench players with games today who should swap in, empty slots; (c) check the wire: any free agent with more games left this week and better production in the close categories than the worst healthy bench player; (d) check IR: any OUT roster player who should move to IR to open a slot; (e) decide "no move" when nothing clears the bar, and say so plainly.
  4. Honesty: the engine recommendations are inputs, not answers; disagree when the numbers say so and explain in one line. State uncertainty (GTD players, small samples).
  5. Output JSON only, matching the schema below. Plain language in `headline` and `actions[].reason`: no z-scores, no "DURANT", no abbreviations other than category names. Numbers allowed in `detail`.
- Call the model with `temperature 0.2`, `max_tokens 1200`, and a JSON response schema (use tool-use with a single `report_move` tool to force the shape).
- Response schema returned to the client:
```
{ "headline": "string, <= 160 chars",
  "noMove": false,
  "actions": [ { "type": "lineup|add_drop|ir|hold|stream", "action": "Start X over Y tonight", "reason": "one line",
                 "detail": "2-4 sentences with the numbers", "players": { "in": "X", "out": "Y" } } ],  // max 3
  "matchupRead": { "winning": ["REB","BLK"], "losing": ["AST"], "close": ["STL","PTS"], "summary": "2 sentences" },
  "risks": ["..."], "wouldChangeIf": ["..."],
  "confidence": "high|medium|low",
  "dataUsed": { "syncedAt": "...", "gamesLeft": {"me": 28, "opp": 25}, "acquisitions": "3 of 4 used" } }
```
- Server validates the JSON against the schema, strips anything extra, and returns it. On model failure return `{ error }` and let the card show Retry.
- Cost control: the client sends a `payloadHash`; the function caches `{hash -> result}` for 30 minutes (Netlify Blobs or in-memory) so two taps do not pay twice. Rate limit per IP as in Phase 5.

### Client rendering rules
- `actions[].type` picks the icon; `players.in/out` get headshots using the existing tile helper.
- Everything from the API goes through `esc()` before innerHTML.
- The card re-renders only itself (do not call `render()`), so the Roster date-nav and search state survive.
- If `noMove` is true, show the headline and the matchup read only.
- "Apply" shortcuts are optional later work: the card can deep-link to the ESPN roster page, but Larry never makes ESPN moves itself.

### Tests
- Fixture payloads under `tests/fixtures/larry-move/`: (a) clear add/drop, (b) lineup-only day, (c) no move, (d) IR move available, (e) acquisition limit reached, (f) weekly lineup lock. A vitest that runs the server-side validator on canned model outputs, plus a prompt-quality checklist you run manually once per fixture: hard rules obeyed, no jargon in headline/reason, headline under 160 chars.
- Manual: tap on Roster, confirm card appears under Dashboard, collapse/expand persists, refresh after sync shows the stale pulse, 11:30 PM local test rolls over at midnight.

---

## Phase 7: cuts and merges

- Remove Draft Center from LEAGUE_MENU mid-season (its ranking is weekly `effectiveDURANT`, so "rounds" are meaningless) or rebuild it on the Phase 2 season-long value.
- Remove the Notifications page and badge; keep one alert ("better FA than your worst starter") on the Roster dashboard. `S.notifications` is never written.
- Park Trade Finder behind a flag until 3.5 lands.
- Delete `monteCarloMatchup` and `categoryVolatility` unless 3.1 reuses them.
- Delete Opponent Insight on the Matchup tab; link to Opponent Scout.
- Keep one of Team Analyzer Category Rankings / Projected Standings Power Rankings.
- Merge Standings, Projected Standings and Playoff Projector into one Standings page with a Current / Projected / Playoff toggle.
- Delete the unused `buildSystemPrompt` and `context` branch after Phase 5 makes the server path the only one.

## Phase 8: additions after the above

- Watchlist screen (`S.watchlist` is written by `toggleWatchlist` but has no view); add a Players filter for it.
- Streaming / waiver page: best healthy free agents by games this week, with the close categories highlighted.
- Real News & Injuries: injury notes and expected return dates from ESPN `kona_player_info` (`injuryStatus`, `injury` object) for roster + watchlist first, league-wide second.
- Fixture-based vitest for the legacy engines (synthetic 12-team league from `tests/engine/fixtures.ts`): negative score, missing stats, OUT, few games, strategy thresholds, recommendation dedupe.
- A shared `debounce` helper in core.js used by Players search, trade search and chat.

## Suggested PR order

1. Phase 1 (one PR: normalization, stat map, season rollover, schedules). Resync required; add the migration.
2. Phase 2 ranking v2 + 3.1 win probability + 3.4 recommendation dedupe.
3. Remaining Phase 3 and Phase 4 fixes.
4. Phase 5 hardening.
5. Phase 6 Larry's Move.
6. Phases 7 and 8.

Each PR: `node --check js/*.js`, `npm test`, `npx tsc --noEmit`, no non-ASCII in `js/`, bump `CACHE_VERSION`, test with fresh localStorage and with a migrated snapshot, check at 11:30 PM local.
