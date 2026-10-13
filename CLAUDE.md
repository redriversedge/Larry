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
js/chat.js              -- Larry AI chat via Claude API proxy [LEGACY ES5]
manifest.json           -- PWA manifest
sw.js                   -- Service worker (bump CACHE_VERSION on every deploy)
netlify/functions/espn-proxy.js   -- ESPN API CORS proxy
netlify/functions/larry-chat.js   -- Claude API proxy (reads ANTHROPIC_API_KEY env var)
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
- **DURANT ranking (v2)**: Primary player ranking. Per-game z-score against a starter-quality Q-pool, with small samples shrunk toward the pool mean and each category capped at +/- 3. `durantScore` is the sum of category z-scores times 10. Nothing multiplies it: no injury discount, no games-remaining factor, no trend or scarcity bonus. Computed by `computeBaseValues` in `src/engine/zscore.ts`, consumed by `computeDURANT` in `js/engines.js`. See `docs/RANKING_V2_SPEC.md`. Rank correlation with the FantasyPros 6-expert consensus top 150 is 0.786, up from 0.296 under the pre-v2 score.
- **Availability vs DURANT**: `durantScore` and `durantRank` are season-long value and are what every ranking surface sorts on. `availability` (0 to 1) and the opportunity boost are separate fields combined into `effectiveDURANT`, which only add/drop, streaming and lineup logic may read. Any multiplier applies only when the score is positive, because scaling a negative score raises it.
- **H2H Each Category**: League format. Categories: REB, AST, STL, BLK, PTS (display in this order everywhere).
- **Games remaining**: Most important variable. Factor into every analysis. Raw averages without games context are meaningless.
- **Matchup strategy**: Weekly strategy engine (Engine 12) classifies each category as Lock (>70% win probability), Target (30-70%), or Punt (<30%). Strategy drives recommendations, add/drop suggestions, and streaming picks. Recalculates on team change or sync.
- **Injury awareness**: Players with OUT, SUSPENSION, or IR status are filtered from add recommendations and free agent suggestions in chat. Injury status shown on tiles, roster rows, and chat context. Never recommend injured players as pickups.
- **Cookie linking (Phase 2+)**: ESPN's `espn_s2` and `SWID` cookies live in `S.espn` (localStorage). Two paths: (a) manual paste in wizard step 3, (b) Larry Link bookmarklet on fantasy.espn.com that base64-encodes the cookies into a URL fragment and redirects through `/link` (handled by `public/link.html` + `dist/larry-cookies.js`) which writes to `S.espn` and bounces to the app. No server-side cookie storage; cookies stay client-side only. 401 from ESPN sets `S.espn.cookieExpired` and `safeRender` shows a banner with a Reconnect button routing to `/connect`.

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

- Endpoint: `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2026/segments/0/leagues/{leagueId}`
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
- Pin a Claude model id in a Netlify function. Read `process.env.ANTHROPIC_MODEL` with a current default, or it silently 404s when the model retires.
- Commit directly to `main`
- Use em dashes in any file (use commas, periods, or double hyphens)

## Reference Docs

- `docs/HANDOFF.md` -- Active 8-phase roadmap (data correctness, ranking v2, engine and UI fixes, chat hardening, Larry's Move). Phase 2 is done; phase 1 is next.
- `docs/RANKING_V2_SPEC.md` -- Ranking v2 algorithm, measurements and acceptance criteria
- `tools/proto.py` -- Reference implementation of ranking v2. `tools/rank-v2-vs-experts.ts` asserts the TypeScript engine reproduces it.
- `LARRY_PLAN.md` -- Earlier improvement roadmap (Phases 0 through 7), superseded by `docs/HANDOFF.md`
- `PLAN_RECONCILED.md` -- Phase 0 reconciliation: plan paths to actual paths, architectural conflicts
- `REPO_MAP.md` -- Phase 0 audit: file tree + key-file summaries
- `docs/SCHEMA.md` -- Full state object schema, all localStorage keys
- `docs/BUGS.md` -- Current bug list with priority order
- ESPN Fantasy app/website -- Baseline UX reference for roster view, player cards, matchup layout
- BasketballMonster.com -- Z-score rankings, punt analysis reference
- HashtagBasketball.com -- Player rankings, schedule grid, data density reference
