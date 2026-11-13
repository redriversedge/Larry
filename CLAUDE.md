# Larry -- Fantasy Basketball Command Center

ESPN fantasy basketball analytics PWA. Deployed at larrybball.netlify.app via GitHub to Netlify auto-deploy from `main`.

This file is the rules. The detail lives in docs and is linked below: read the relevant doc before changing that area.

## Architecture

**Legacy frontend (production surface):** vanilla JS in `js/`, no framework, no build step. Files deploy to the browser as-is.

**Engine (TypeScript):** `src/` and `tests/`, `tsc --strict` and `vitest`. `npm run build` bundles it to `dist/` as IIFE globals (`window.LarryEngine`, `window.LarryCookies`), committed to git.

**Functions:** Netlify Functions in `netlify/functions/`; the four Claude-backed ones stream (Functions v2) because a buffered response dies at 10s. Detail in `docs/FUNCTIONS.md`.

```
index.html              -- App shell, 5-tab bottom nav
css/larry.css           -- Dark theme, mobile-first
js/core.js              -- State (S object), nav, localStorage, utils
js/espn.js              -- ESPN API integration, parsing, sync
js/engines.js           -- Analysis engines (docs/FUNCTIONS.md)
js/tabs.js              -- All 5 tab renderers + League sub-pages
js/draft.js             -- Draft Room: mock drafts vs AI managers
js/chat.js, chat-tools.js   -- Larry chat and the app tools it can call
js/larry-move.js        -- Larry's Move card
js/gameplan.js          -- Game Plan (Matchup tab)
js/reports.js           -- League reports
sw.js                   -- Service worker (bump CACHE_VERSION on every deploy)
netlify/functions/espn-proxy.js        -- ESPN API CORS proxy
netlify/functions/larry-chat.mjs       -- Chat (streams)
netlify/functions/larry-move.mjs       -- Larry's Move (streams)
netlify/functions/larry-plan.mjs       -- Game Plan (streams)
netlify/functions/recommend-explain.ts -- Two-sentence pickup rationale
netlify/shared/app-tools.mjs   -- Tool schemas and turn validation for chat and Move
netlify/shared/daily-cap.mjs   -- Daily request caps in Netlify Blobs
public/                 -- /connect bookmarklet install, /link cookie handler
src/                    -- TypeScript engine, cookies, shared types
dist/                   -- Built bundles, committed
tests/                  -- vitest
tools/                  -- Backtest gates and data refreshers (docs/TOOLS.md)
data/                   -- Public ranking and ADP history, committed
```

## Commands

- `node --check js/*.js` -- Syntax-check legacy JS files. Run before every commit that touches `js/`.
- `grep -rP '[\x80-\xFF]' js/` -- ASCII verification. No smart quotes or unicode corruption.
- `npx serve .` -- Local dev server (no Netlify functions locally, but UI works).
- `npm test` -- Run vitest suite for new TypeScript code under `src/` and `tests/`.
- `npx tsc --noEmit` -- Typecheck new TS code without producing build output.
- `npm run build` -- Rebuild `dist/` after any change under `src/`.
- Backtest gates and data refreshers: see `docs/TOOLS.md`.

## Git workflow

- Branch off `dev` (or `main`) as `feature/*` or `fix/*`. Never commit or push directly to `main`.
- Open a pull request into `main`. CI (`.github/workflows/ci.yml`) must pass: syntax check, ASCII check, typecheck, tests, and committed bundles matching source. Check the change on the PR's Netlify deploy preview before asking for a merge.
- The owner merges. Netlify auto-deploys `main`.
- Commit messages: `fix: keyboard dismiss on Players search` or `feat: date-scrollable roster view`.
- Bump `CACHE_VERSION` in sw.js in every PR that changes a shipped file.

## Code conventions

### Legacy `js/*.js` (existing files)

Files in `js/` deploy straight to the browser with no build step, so whatever is written here has to run as-is.

**House style (enforced):** `var`, not `let`/`const`. `function` expressions, not arrow functions. String concatenation, not template literals. This is a consistency rule, not a compatibility one; keep it so the files read as one codebase.

**Language baseline: ES2017.** Shipping code already uses `async function` and `\u{...}` escapes, so every browser in use supports ES2017. `find`, `includes`, `startsWith`, `padStart` and `Object.assign` are fine; do not rewrite them into loops.

**Still genuinely required:**
- `node --check js/*.js` before every commit. With no build step this is the only thing standing between a typo and a blank app.
- ASCII only. Write the escape sequence, never a pasted arrow glyph.

- Global modules use IIFE pattern: `var ModuleName = (function() { ... return { publicAPI }; })();`

### New TypeScript code (`src/`, `tests/`)

- Modern TypeScript with `strict: true` and `noUncheckedIndexedAccess: true` (see `tsconfig.json`).
- Use `let`/`const`, arrow functions, template literals, ES modules, generics, all the modern things. The legacy house style does NOT apply here.
- Engine modules (`src/engine/*.ts`) must be pure functions over typed inputs. Do not import from `src/data/*` or any I/O-touching module. This is what makes them testable and backtest-friendly.
- I/O lives in Netlify Functions (`netlify/functions/*.ts` once that migration starts) and `src/data/*`. UI consumes typed responses; it never recomputes ranks.
- `npm run build` bundles `src/engine` and `src/cookies` to `dist/` with esbuild. The bundles are committed (Netlify has no build step), and CI fails if they are stale, so rebuild and commit `dist/` whenever `src/` changes.

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

## Testing checklist (run after every feature)

1. `node --check js/*.js` passes (legacy syntax check)
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

- Use `let`, `const`, arrow functions, or template literals in legacy `js/*.js` files (house style for legacy code only; `src/*.ts` follows modern conventions)
- Recommend dropping top-tier players (top 60% by DURANT rank) in the Decision Hub
- Recommend adding players with OUT, SUSPENSION, or IR injury status
- Re-render input elements during search (causes mobile keyboard dismissal)
- Use `new Date().toISOString()` for local dates (use local timezone conversion)
- Put long content in fixed-height containers without overflow scroll
- Hardcode team names or roster data, everything comes from ESPN API
- Divide `stats.season` by `gamesPlayed` (it is already per-game, see docs/KEY_CONCEPTS.md)
- Parse a schedule date with `new Date('YYYY-MM-DD')` (reads as UTC midnight and drops today's games after 7pm Central). Compare local `YYYY-MM-DD` strings instead.
- Invent data when the real thing is missing. Show "unavailable" instead; the player popup used to hash the team name into a fake 7-day schedule.
- Treat the season `acquisitionLimit` as the binding pickup limit, or derive the matchup window from a Monday-to-Sunday calendar week (see docs/KEY_CONCEPTS.md).
- Read `scheduleSettings.matchupPeriods` values as scoring periods. They are week numbers. Call `getMatchupWindow()` rather than `getMatchupDates()` for anything the user sees.
- Assume every ESPN week is 7 days (the All-Star week is 14) or search the whole season for the break (December's NBA Cup gap is longer).
- Cache the NBA schedule for the season. It changes: NBA Cup games and reschedules are added later. `loadNbaSchedule` refetches when `S.scheduleFetchedAt` is over 24 hours old.
- Shrink a small sample toward the pool mean. Use the player's own projection, or every player scores 0 before opening night; with no projection at all use the replacement line, or one garbage-time appearance makes an unprojected player an average starter (see docs/KEY_CONCEPTS.md).
- Trust a prompt rule to constrain model output when the constraint is checkable in code. Enforce it in the validator too.
- Write `(p.durantScore || 0)` or `(p.effectiveDURANT || 0)` in a sort comparator. Null means "no evidence" and must sort below every number; `|| 0` puts the player at average-starter. Use `durantKey()`.
- Divide `projectedSeason` by 82 for anything preseason-facing, or by `projectedGP` for the in-season shrink prior. The two divisors are not interchangeable, and the in-season swap has already been measured and rejected (see docs/KEY_CONCEPTS.md).
- Trust that ESPN's current-season `statSourceId 1, statSplitTypeId 0` set is rest-of-season. It is a FULL-SEASON total all year and ESPN revises it, which is why dividing by games stays correct in March. `checkProjectionDivisor` in espn.js warns in the sync log if the median projected GP ever collapses below 40 before the All-Star break, which is what a change of meaning would look like.
- Change the ranking, preseason or in-season, without beating the backtest gates in `docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md` and recording the result in `docs/RANKINGS_V3_BACKTEST.md`. `npx tsx tools/rank-v2-vs-experts.ts` must stay at parity with `proto.py` and rho 0.758, and `npx tsx tools/backtest-preseason-board.ts` must reconcile against the reviewer's baseline before any tuning is believed. Agreeing with the experts is not the target; actual outcomes are. Preseason work goes behind `isPreseason()`; projection work goes behind `S.prefs.useLarryProjections`.
- Put an injury opinion in `data/projection-overrides.json`. It is for cases where ESPN's data is provably wrong, with an `until` date so it expires.
- Pin a Claude model id in a Netlify function. Read `process.env.ANTHROPIC_MODEL` with a current default, or it silently 404s when the model retires.
- Make `larry-chat` buffer its reply again, or lower its `MAX_TOKENS` to fit one. A buffered answer dies at 10s and thinking shares the budget (see docs/FUNCTIONS.md).
- Push streamed thinking text, or any error text, into `_chatHistory`. Both get replayed to the model as a real assistant turn on every later message.
- Add an HTML page without the home-screen icon block (manifest, 180px `apple-touch-icon`, favicon, `apple-mobile-web-app-title`). Phones take the icon from whichever page is open when "Add to Home Screen" is tapped; `/connect` and `/link` had none, so the app was saved as a letter "L". Icons are generated from `assets/icon-512.png`: opaque 180px for iOS at `/apple-touch-icon.png`, and `icon-maskable-*.png` with the art inside the 80% safe zone for Android.
- Commit any league member's draft history, manager names, or derived profiles. The repo is public. Tests use the synthetic generator in `tests/engine/draftFixtures.ts`; real exports live in git-ignored `tests/fixtures/users/`.
- Measure Draft Room reach against `draftRanksByRankType` or `ownership.averageDraftPosition` for a PAST season. Both are end-of-season values and make every manager look like a genius or an idiot depending on who broke out. Use `data/espn-adp-history.json`.
- Commit directly to `main`
- Use em dashes in any file (use commas, periods, or double hyphens)

## Reference docs

- `docs/KEY_CONCEPTS.md` -- State, per-game stats, season ids, DURANT ranking, preseason board v3, replacement line, projections, Draft Room. Read before touching rankings, projections or the draft.
- `docs/FUNCTIONS.md` -- Netlify functions (streaming, thinking, frames, limits), the analysis engines, Larry Chat.
- `docs/TOOLS.md` -- Backtest gates and data refreshers.
- `docs/RANKING_V2_SPEC.md`, `docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md`, `docs/RANKINGS_V3_1_INSEASON_SPEC.md` -- Ranking specs; results in `docs/RANKINGS_V3_BACKTEST.md` and `docs/RANKINGS_V3_INSEASON_BACKTEST.md`.
- `docs/DRAFT_ROOM_SPEC.md` -- Draft Room: manager profiles, pick model, availability odds.
- `docs/BUGS.md` -- Bug list.
- `tools/proto.py` -- Reference implementation of ranking v2.
- `docs/archive/` -- Superseded plans (LARRY_PLAN, PLAN_RECONCILED, REPO_MAP, HANDOFF), kept for rationale.
- ESPN Fantasy app, BasketballMonster.com, HashtagBasketball.com -- UX and ranking references.
