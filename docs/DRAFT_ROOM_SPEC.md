# Draft Room: mock drafts against the league's real managers

Spec date: 2026-10-15, written against `dev` at eb11224 (v3.23.0).
**Real draft: Sun Oct 18 2026, 7:30 PM CT.** Opening night is Tue Oct 20.

The owner wants an interactive mock draft inside Larry where the other 11 teams are drafted by AI managers built from each manager's real draft history. That includes which of the 5 categories each one pays a premium for. Both the owner and his brother use Larry in this league, so it has to work for whichever team is `S.myTeam`.

CLAUDE.md applies throughout:
- Work on `dev`; run `node --check js/*.js`, `npm test` and `npx tsc --noEmit`.
- ASCII only, no em dashes, ES5 house style in `js/`.
- Bump `CACHE_VERSION` on every push.
- The regular-season gate (`npx tsx tools/rank-v2-vs-experts.ts`: parity PASS, rho 0.758) must pass after every commit. Nothing here touches the ranking, so it should.

---

## 0. Privacy rule: the repo is public

`redriversedge/Larry` is a **public** repository. Draft history, manager names, team names and the profiles derived from them are league members' data.

- **Never commit any of it.** Profiles are computed in the browser from a live fetch and stored in localStorage only.
- Test fixtures are **synthetic**: invented players, managers `M1`..`M12`, generated picks. Do not export a real league fetch into `tests/fixtures/` (even git-ignored ones are easy to leak; if a local real export is needed, put it under `tests/fixtures/users/`, which is already ignored, and never reference it from a committed test).
- Do not send profiles to the chat or Larry's Move functions. Out of scope.
- The reference numbers in section 9 are keyed by ESPN `teamId` only, on purpose.

---

## 1. What already works (verified 2026-10-15 in the live app)

Draft history is reachable through the existing proxy in league scope with the user's cookies. **No proxy change is needed.**

| Need | Request (through `PROXY_URL`, league headers, `x-espn-season: <yr>`) |
|---|---|
| Picks, teams, owners, names | `?view=mDraftDetail&view=mTeam&view=mSettings` |
| Player info + that season's ESPN preseason projection + ESPN draft rank | `?view=kona_player_info&scoringPeriodId=0` with `x-fantasy-filter: {"players":{"limit":1000,"sortPercOwned":{"sortAsc":false,"sortPriority":1}}}` |

Facts found while building the reference profiles:

- Seasons with a completed draft: **2018 to 2026** (9 drafts; 168, 156, 156, then 144 picks x 6). 2027 has 144 empty slots with the order already set.
- `draftDetail.picks[]`: `overallPickNumber`, `roundId`, `roundPickNumber`, `teamId`, `playerId`. Skip `keeper: true` picks if present.
- The owner of a team is `team.primaryOwner` (a member id). Names come from `members[]` (`firstName`, `lastName`, `displayName`). **Key profiles by member id, not teamId**: teams change hands and ids across seasons.
- The projection is the `stats[]` entry with `statSourceId 1`, `seasonId <yr>`, `statSplitTypeId 0`. Projected GP is stat `'42'`. Category stats: `0` PTS, `1` BLK, `2` STL, `3` AST, `6` REB.
- **Past-season ESPN ranks are not the pre-draft board.** `draftRanksByRankType` (STANDARD and ROTO) for a finished season holds ESPN's *end-of-season* ranks: 2026 ROTO has Jalen Johnson 5th, where he was drafted around 33rd. `ownership.averageDraftPosition` for past seasons is garbage too (Jokic 140). Use neither for history.
- **The historical board is ESPN ADP from FantasyPros** (`https://www.fantasypros.com/nba/adp/overall.php?year=<Y>`, where `year=2025` is the 2025-26 season, i.e. seasonId 2026). It has an ESPN column for every year back to 2018 (2018-19). This is public data, not league data, so it may be committed: add `tools/fetch-espn-adp-history.ts` that writes `data/espn-adp-history.json` as `{ "<seasonId>": [[name, espnAdp], ...] }`, and match to drafted players by normalized name (the same `norm()` as `tools/preseason-vs-experts.ts`). The browser cannot fetch FantasyPros directly (CORS), which is why this is a committed file.
- For the **current** season, `ownership.averageDraftPosition` from the league `kona_player_info` is live ESPN ADP and is fine to use.
- In this H2H category league the `ROTO` rank type is ESPN's 9-category rank (Giannis 19th, Zion 94th, because of FT%). It is not the right value scale for 5 categories; it only matters as a guess at what the ESPN draft room shows.
- A `filterIds` filter returns ESPN 400. Use the limit-1000 sort instead; it covers about 99% of drafted players.
- Current-manager sample sizes: 8 managers with 9 drafts, 2 with 8, 1 with 7, 1 with 4.

---

## 2. Data layer: `js/espn.js` `fetchDraftHistory()`

- Triggered from the Draft Room ("Build manager profiles" button on first visit), never by the normal sync. It makes 2 requests per season (about 18 total) with a progress line ("Reading the 2021 draft...").
- Seasons: 2018 (or the league's first season, whichever is later; stop at the first season that 404s or has no picks) through `S.league.seasonId - 1`.
- Store under a **separate** localStorage key `larry_draft_history`, not in `larry_state` (keeps the main state small and makes it easy to clear):

```
{
  leagueId, builtAt, version: 1,
  seasons: {
    "2026": {
      picks: [[overall, round, teamId, playerId], ...],
      owners: { "<teamId>": "<memberId>" },
      players: { "<playerId>": [name, posId, proTeamId, espnRank|null, gp, pts, reb, ast, stl, blk] }
    }, ...
  },
  members: { "<memberId>": "First Last" }
}
```

- `players` holds **drafted players only**, with projected season totals. Per-game is computed in the engine.
- Past drafts never change, so the cache is permanent per `leagueId`. Include a "Rebuild" link in the Draft Room footer. If `leagueId` differs from `S.espn.leagueId`, ignore the cache.
- Failure on one season: log it, skip the season, keep going. Show which seasons were used on the profile cards.
- The 2027 order: read `mDraftDetail` for the current season on Draft Room open (one request). `picks[]` are in slot order with `teamId` set. Fall back to `settings.draftSettings.pickOrder` (snake it) if `picks` is empty.

---

## 3. Profiles: `src/engine/draftProfiles.ts` (pure)

Input: the history object above. Output: one profile per member id. These are the exact steps that produced the reference numbers in section 9, so follow them.

### 3.1 Category premium

Per season:
1. Pool = every drafted player that season with a projection and projected GP > 0.
2. Per-game projection = projected total / projected GP, for each of PTS, REB, AST, STL, BLK.
3. `z[c]` = (value minus pool mean) / pool SD, per category, within that season's pool.
4. For each pick, `resid[c]` = its `z[c]` minus the mean `z[c]` of the **other** picks within +/- 8 overall slots of it in the same draft. This removes "early picks are just better at everything".

Per manager:
- `premium[c]` = mean `resid[c]` over that manager's picks in **rounds 1 to 10**, all seasons.
- `t[c]` = premium / (SD of those residuals / sqrt(n)).
- `seasonsPositive[c]` = number of seasons whose mean residual for c is above 0, out of seasons drafted.
- `strength[c]`: **strong** when |t| >= 2, **moderate** when 1.2 <= |t| < 2, else **none**.
- `order` = categories sorted by premium, descending.

Labels the UI shows, derived from strength and sign:
- strong positive: "Pays up for PTS"
- strong negative: "Punts PTS" (if seasonsPositive is 0 or 1) or "Avoids PTS"
- moderate: "Leans PTS" / "Light on PTS"
- none on every category: "No clear category lean"

### 3.2 Reach (against ESPN ADP that season)

- `reach` per pick = that season's ESPN ADP (from `data/espn-adp-history.json`) minus overall pick. **Positive means they took the player earlier than ESPN drafters did.** Players with no ESPN ADP that season are left out of reach (they were off the board, so the number would be meaningless).
- Report the median overall, and medians for early (rounds 1 to 3), mid (4 to 7) and late (8+).
- Label: median >= 12 "Reaches often", <= 0 "Drafts the board", else "Slight reacher".

### 3.3 Position lean (rounds 1 to 8)

Use the primary position (`defaultPositionId`). Lean = the manager's share minus the league share of the same picks. Show anything at +/- 8 points or more ("Heavy on C, +16").

### 3.4 NBA team affinity

Top 3 `proTeamId` by count across all picks, shown only when a team has 4+ picks and is at least twice the league rate. Display only; the pick model uses it with a small weight (section 4).

### 3.5 Sample size

Every card shows "N drafts (YYYY to YYYY)". Under 5 drafts, add "Small sample".

---

## 4. AI pick model: `src/engine/mockDraft.ts` (pure)

Managers in this league draft off the ESPN board, so ESPN ADP is the base and the profile bends it. (ESPN ADP exists from the 2018-19 season on, so the 2017-18 draft has no reach data.)

For manager m on the clock at overall pick p, every available player i gets a utility:

```
u_i = - rank_i / tau(m, phase)
      + lambda * w(m) . (premium(m) * z_i)        // category taste
      - gamma * overload(m, pos_i)                 // position need
      + alpha * affinity(m, team_i)                // small
```

and the pick is drawn from `softmax(u)`.

- `rank_i`: the player's current ESPN ADP (`ownership.averageDraftPosition` from the league kona fetch; when fitting on history, that season's ESPN ADP from `data/espn-adp-history.json`). Fallbacks in order: ESPN `STANDARD` draft rank, Larry's preseason `durantRank`, then 400. The AI uses ESPN because it models what these managers see in the ESPN draft room. It is a prediction of their behavior, not a judgment of player value.
- `phase`: early (rounds 1 to 3), mid (4 to 7), late (8+).
- `tau(m, phase) = tau_phase * exp(beta * reachShrunk(m, phase))`. A higher temperature means more willing to leave the board. `reachShrunk` = the manager's phase median reach shrunk toward the league median by `n / (n + 15)`, where n is that manager's pick count in the phase.
- `z_i`: 2027 per-game z by category from `stats.projectedRate`, computed against the top 200 by ESPN rank.
- `w(m)[c]`: 1 for strong, 0.5 for moderate, 0 for none. Weak signals do not move the AI.
- `overload(m, pos)`: count of that manager's already-drafted players at the same primary position beyond 3, rounds 1 to 10. Prevents 5 centers by round 6.
- `affinity`: 1 if `team_i` is in the manager's top 3, else 0.

### 4.1 Fit and test (in a tool, against the owner's real data)

New tool `tools/fit-mock-draft.ts` reads a local export of `larry_draft_history` (path passed as an argument, under `tests/fixtures/users/`, never committed):

- Fit `tau_early`, `tau_mid`, `tau_late`, `beta`, `lambda`, `gamma`, `alpha` by maximum likelihood on the **2019 to 2025** drafts (ESPN ADP exists for all of them). Profiles used for each draft must be built from **prior seasons only** (no leakage).
- Test on **2026**. Report, against a **rank-only baseline** (`beta = lambda = gamma = alpha = 0`, `tau` refit):
  - mean log-likelihood per pick
  - top-1 and top-5 hit rate (actual pick among the model's 5 most likely)
- **Gate:** the full model's 2026 log-likelihood must beat the baseline. If a component does not help, set its weight to 0 and say so in the report. Ship the fitted constants in `src/engine/constants.ts` with the measured numbers in a comment.
- If the owner has not provided an export, ask for one: in DevTools on larrybball.netlify.app after building profiles, `copy(localStorage.getItem('larry_draft_history'))`. Until then, ship sensible defaults (`tau` 6 / 10 / 18, `beta` 0.04, `lambda` 4, `gamma` 3, `alpha` 1) and mark them unfitted in the UI footer.
- Also add an in-app diagnostic (Settings, "Draft model check") that runs the same 2026 test in the browser and prints both numbers, so it can be verified without a local export.

### 4.2 Determinism

Use a seeded PRNG (mulberry32 or similar). Each mock gets a seed shown in the footer so a run can be replayed.

---

## 5. The Draft Room UI

Entry point: League tab, **Draft Room**. Add it to `LEAGUE_MENU` and put it first in the `'Overview'` section of `renderLeagueMenu` while `isPreseason()` is true (move it under `'Info'` after). Reuse the old `draftCenter` id so stale bookmarks land on the new page: replace its "This page was removed" case with the render call.

New file `js/draft.js` (ES5 house style) with `renderDraftRoom()`. Add it to `index.html` and to the `sw.js` precache list.

### 5.1 Layout, top to bottom

1. **Status bar**: "Round 2, pick 3 (15th overall). On the clock: <team>". Next to it: "Your picks: 10, 15, 34, 39, ..." for the user's team.
2. **Controls** (44px targets):
   - **Sim to my pick**: AI picks until the user is on the clock.
   - **Sim 1**: one AI pick.
   - **Undo**: removes the last pick, AI or user.
   - **Restart**: a new seed, same order.
   - **Auto-draft me**: the user's own picks use the "Larry's pick" rule below. Lets a whole mock run in one tap.
3. **Board**: available players, sortable columns (tap header). Columns:
   - Larry rank (preseason `durantRank`), ESPN rank, name, position, NBA team
   - REB, AST, STL, BLK, PTS projected per game (this order)
   - **Avail** at the user's next pick (section 6)
   - Toggle above the table: sort by Larry or ESPN rank. Search box with `oninput` debounce; never re-render the input.
   - Tapping a row while the user is on the clock drafts that player (with a one-tap confirm row, not `confirm()`). Tapping while not on the clock opens the existing player popup.
4. **Larry's pick** card when the user is on the clock: the best available by Larry rank, plus "Can wait: X is 78% likely to be there at pick 34" when a higher-ranked player has 70%+ availability at the next pick, so the user can take someone scarcer now.
5. **Teams strip**: horizontal chips, one per team. Tapping opens that team's **profile card** and its mock roster so far, with category totals (REB, AST, STL, BLK, PTS per game, summed) and the league rank of each total.
6. **Recent picks** ticker: the last 5 picks with a one-line reason for AI picks ("Pays up for PTS", "Reach: ESPN #48 at pick 31").

### 5.2 Profile card

- Header: manager display name, current team name, "N drafts (YYYY to YYYY)", "Small sample" if under 5.
- **Category bars**: 5 horizontal bars centered at 0 in the fixed order REB, AST, STL, BLK, PTS, colored by category, length = premium. Label each with its strength word. Under the bars, the one-line summary (for example "Punts PTS (0 of 9 seasons). Leans BLK and REB.").
- Reach line: "Drafts the board (median -3)" / "Reaches often (median +19; +26 in rounds 4 to 7)".
- Position lean line, NBA team line, both only when they clear the thresholds in section 3.
- A small "How this is measured" disclosure that explains the residual method in two sentences and says weak signals are not used by the AI.

### 5.3 State

- The mock lives in `larry_mock_draft` (separate localStorage key): `{ seed, order: [teamId...], picks: [[overall, teamId, playerId]], startedAt }`. It survives reloads; Restart clears it.
- Each user's mock is their own (the brother runs his own on his own phone). No shared state; nothing server-side.
- Every render is wrapped in try/catch with the diagnostic error card.
- No profiles yet: show the "Build manager profiles" button and a one-line explanation. The mock still works without profiles, using the rank-only model, labelled as such.

---

## 6. Availability odds (P1)

- After every pick, run **500** simulations from the current state through the user's **next two** picks, using the same pick model with fresh seeds.
- Avail = share of runs in which the player is still on the board at the user's next pick. Show it for the top 40 by the current sort. Optionally a second column for the pick after.
- Run it in chunks (`setTimeout` slices of 50 sims) so the UI never freezes; show "calculating" until done. Cancel stale runs when a new pick happens.
- Budget: under 1.5 s total on an iPhone. If over, drop to 250 sims and say so in the footer.

---

## 7. Live draft sync (P2, only if P0 and P1 are done and verified by Sat Oct 17)

- Toggle "Follow the real draft". When on and the ESPN draft is in progress, poll the current season's `mDraftDetail` every 10 s, fill real picks into the board, and recompute odds.
- Read-only. Larry never makes a pick on ESPN.
- Stop polling when `drafted` is true or the page is hidden (`visibilitychange`).

---

## 8. Tests (all synthetic data)

`tests/engine/draftProfiles.test.ts`:
- A generated league where M3 always takes the highest-PTS player within a 3-pick window: PTS premium strongly positive, |t| >= 2.
- A manager who never takes above-median PTS: "Punts PTS", seasonsPositive 0.
- A manager who picks exactly by rank: every category strength "none", reach median 0, "Drafts the board".
- Ownership change: a team id held by M2 in 2019 and M7 in 2020 credits each season to the right member.
- Reach ignores picks with no ESPN ADP that season, and reads ADP from the history file, never from a past season's `draftRanksByRankType`.
- Profiles for draft year Y built "as of" Y use only seasons before Y.

`tests/engine/mockDraft.test.ts`:
- Same seed gives the same draft; different seeds differ.
- With `lambda = gamma = alpha = beta = 0` and a tiny `tau`, the AI picks in exact rank order.
- A strong PTS manager takes the higher-PTS player between two adjacent-rank players more often than not over 1000 draws.
- No player is drafted twice; the snake order matches `order`; undo restores the exact prior state.
- Overload: no AI manager ends rounds 1 to 10 with more than 5 at one position across 200 simulated drafts.
- Availability: a player ranked 1 is 0% available at pick 10; one ranked 300 is about 100%.

UI checks (manual, report in the PR): fresh state, profiles not built, profiles built, mid-mock reload, iPhone width, keyboard stays up while searching.

---

## 9. Reference profile values (for verification after deploy)

Computed 2026-10-15 in the live app with the method in section 3. These are keyed by **2027 teamId**. The in-app profiles must match each **category premium** within **+/- 0.05** with the same sign, t within +/- 0.5, and each position lean within +/- 3 points.

**Do not match the reach numbers below.** They were measured against ESPN's end-of-season ranks (see section 1), not the pre-draft board, so they are wrong. Reach is re-measured against ESPN ADP after the build; report the new medians in the PR and the owner's reviewer will check them.

| teamId | Check |
|---|---|
| 2 | PTS premium -0.44, t -6.0, positive in 0 of 9 seasons ("Punts PTS"). BLK +0.16, REB +0.15 (7 of 9). C lean +16, SF -13. Reach median 19, mid-round +26. |
| 1 | PTS +0.23, t 3.6 (6 of 9), strong. AST +0.11. PF lean +13, C -9. Reach median 5. |
| 13 | STL -0.22, t -2.1 (strong); AST -0.18, t -1.9. Reach median 19, late +25. 8 drafts. |
| 6 | AST +0.15, t 1.6; BLK -0.17, t -1.9; REB -0.11. PG lean +10. Reach early +9, late -7. 8 drafts. |
| 9 | REB -0.16, t -1.8 (positive in 1 of 9); BLK +0.15. Reach median 9. |
| 18 | REB -0.32, t -2.3 (0 of 4). 4 drafts, "Small sample". |
| 17 | REB +0.15, t 1.5 (7 of 9). Reach median 4. |
| 10 | PTS +0.11, t 1.4. Reach median 13, late +19. |
| 5 | No category reaches moderate on the positive side (STL -0.11, t -1.1). Reach median -3, "Drafts the board". |
| 19 | PTS +0.11, t 1.6. PG lean -8. Reach mid +17. 7 drafts. |
| 16 | No moderate or strong category (REB +0.12, t 1.2 is the largest). Reach median 1. |
| 4 | No moderate or strong category (BLK -0.11, t -1.2). SG lean +11. Reach mid +26. |

Small differences are expected from the "exclude self" window and tie handling. A **sign flip** on any value above 0.10 means the pipeline is wrong; stop and fix before shipping.

---

## 10. Priorities and timeline

| | Scope | Target |
|---|---|---|
| **P0** | History fetch and cache, profiles engine and cards, manual mock with AI picks (defaults or fitted), Undo/Restart/Sim, synthetic tests | Fri Oct 16 night |
| **P1** | Availability odds, Larry's pick card with "can wait", fitted constants, in-app model check | Sat Oct 17 noon |
| **P2** | Live draft sync | Only if P0 and P1 are verified by Sat Oct 17 evening |

Ship P0 to `main` as soon as it passes the gates below, so the owner can run mocks Friday and Saturday. Do not push anything to `main` after **Sun Oct 18, 3:00 PM CT** unless it fixes a broken Draft Room.

## 11. Gates for every push

- [ ] `node --check js/*.js`, `npm test`, `npx tsc --noEmit` pass.
- [ ] `npx tsx tools/rank-v2-vs-experts.ts`: parity PASS, rho 0.758 unchanged.
- [ ] `npx tsx tools/preseason-vs-experts.ts` unchanged from before this work.
- [ ] `grep -rn "larry_draft_history\|members" tests/fixtures` finds no real league data; `git diff --stat` shows no JSON with real names.
- [ ] `js/draft.js` in `index.html` and `sw.js` precache; `CACHE_VERSION` bumped.
- [ ] CLAUDE.md updated: Draft Room section (files, the two localStorage keys, the public-repo privacy rule, the profile method in three lines, the fitted model numbers).

## Done means

- [ ] The owner can open League, Draft Room, build profiles, and run a full mock from pick 1 to 144 on his phone.
- [ ] His brother can do the same for his own team without any change.
- [ ] Profile cards match section 9.
- [ ] `tools/fit-mock-draft.ts` report in the PR: full model vs rank-only on 2026, log-likelihood and top-5 hit rate.

## Suggested Claude Code settings

Opus 5.5 at medium effort. The engines are small and well specified; the risk is in the fiddly UI state (undo, snake order, reloads), which medium handles well. Raise to high only if the fit tool misbehaves.
