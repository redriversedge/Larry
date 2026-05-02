# REPO_MAP.md

Phase 0 audit of the Larry repo as it exists today. This is a snapshot — re-run the audit if the structure changes materially.

> **Note on `tree`:** the `tree` binary is not installed on this machine. The file inventory below was produced with `find . -type d \( -name node_modules -o -name .git -o -name dist -o -name build -o -name 'temporary screenshots' \) -prune -o -print`, which is functionally equivalent to `tree -I "node_modules|.git|dist|build"` for the purpose of this map. `temporary screenshots/` is also excluded as transient working material.

---

## Key file summaries

### `package.json`
**Does not exist.** Larry has no `package.json`, no `node_modules`, no lockfile, no bundler, and no build step. This is intentional: per `CLAUDE.md`, Larry is a "Vanilla JS multi-file app. No framework, no build step, no bundler. Files deploy directly to Netlify." This is the single biggest mismatch with the plan and is flagged in [PLAN_RECONCILED.md](./PLAN_RECONCILED.md).

### `netlify.toml`
9 lines. Sets `publish = "."` (deploys the repo root as the static site) and `functions = "netlify/functions"`. Adds two response headers globally: `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff`. No build command, no plugins, no scheduled-function declarations, no edge functions.

### `netlify/functions/espn-proxy.js`
85 lines. CORS proxy for ESPN's private fantasy API. Reads league id, `espn_s2`, `SWID`, season from custom request headers (`x-espn-league-id`, `x-espn-s2`, `x-espn-swid`, `x-espn-season`); forwards GET to `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{season}/segments/0/leagues/{leagueId}` with cookies attached. CommonJS, uses raw `https` module (no fetch, no SDK). 10s timeout. Returns 400 if any cred missing, passes through ESPN status on 4xx/5xx.

### `netlify/functions/larry-chat.js`
153 lines. Proxy to Anthropic's Messages API (`api.anthropic.com/v1/messages`). Reads `ANTHROPIC_API_KEY` from env. Hard-codes `claude-sonnet-4-20250514` (note: this is an outdated model id; current Sonnet is 4.6 / `claude-sonnet-4-6`). Builds a system prompt from a `context` payload that already includes league info, user team, category ranks, current matchup state, full roster (with z-scores), and top free agents. Trims to last 20 messages. **This means the function already passes per-user context** — the "same suggestions for everyone" bug, if it still exists, is most likely upstream of this function (i.e. the client may not be populating `context` per-user) rather than a missing-input problem at the Claude layer.

### Frontend entry — `index.html`
145 lines. Plain HTML shell with header, `<main id="tab-content">`, and bottom nav placeholder. PWA manifest linked. Inline pre-paint theme bootstrap reads `larry_theme` from `localStorage`. Loads the JS modules in dependency order at the bottom: `themes.js → core.js → espn.js → engines.js → tabs.js → chat.js`. No bundler; each file is its own `<script>` tag.

### Files matching projection / recommend / rank / espn_s2
197 occurrences across all 5 frontend JS files. The bulk are in:
- `js/engines.js` (82 hits) — implements the analysis engines per `CLAUDE.md`: z-scores, Monte Carlo, DURANT composite ranking, availability/opportunity multipliers, recommendations (filtered for injury), trade analyzer, punt analysis, volatility, streaks, ROS projections, risers/fallers, trade finder, matchup strategy. All wrapped in a single IIFE: `var Engines = (function() { ... })();`.
- `js/tabs.js` (90 hits) — tab renderers consume engine output.
- `js/chat.js` (8 hits) — passes ranking and roster data into the Claude proxy context.
- `js/core.js` (12 hits) — global `S` state (S.espn, S.league, S.myTeam, S.matchup, S.players, S.teams) persisted in `localStorage` under `larry_state`.
- `js/espn.js` (5 hits) — ESPN client; sends `espn_s2`/`SWID` via the proxy headers above.

`espn_s2` appears as the cookie name (passed through the proxy) and as a state key. **Cookie storage is in `localStorage`,** which the plan calls out as the #1 security issue (Part 4).

### Other notable files
- `js/themes.js` (274 lines) — theme definitions and toggle.
- `js/core.js` (1002 lines) — state, nav, localStorage helpers, utilities.
- `js/espn.js` (701 lines) — ESPN data fetching, parsing, sync orchestration.
- `js/engines.js` (880 lines) — all 12 analysis engines.
- `js/tabs.js` (2408 lines, the largest file) — every tab renderer + League sub-pages.
- `js/chat.js` (190 lines) — Larry chat UI + Claude proxy call.
- `sw.js` (63 lines) — service worker; `CACHE_VERSION` must be bumped on every deploy.
- `manifest.json` — PWA manifest (name, icons, theme color `#3b82f6`, background `#0a0a1a`).
- `css/larry.css` — single stylesheet, dark theme, mobile-first.
- `assets/` — `icon-192.png`, `icon-512.png`, `larry-logo.svg`.
- `docs/BUGS.md` — current bug list (per `CLAUDE.md` reference).
- `docs/plans/2026-03-06-phases-3-4-5.md` — pre-existing phase plan from March (unrelated to `LARRY_PLAN.md`'s phase numbering — see [PLAN_RECONCILED.md](./PLAN_RECONCILED.md)).
- `CLAUDE.md` (7707 bytes) — authoritative project conventions; **explicitly forbids `let`/`const`/arrow functions/template literals** and **explicitly forbids a build step**.
- `LARRY_PLAN.md` (52286 bytes) — the new plan being executed.

---

## File tree (excluding node_modules, .git, dist, build, temporary screenshots)

```
.
├── .claude/
│   └── settings.local.json
├── .gitignore
├── CLAUDE.md
├── LARRY_PLAN.md
├── README.md
├── assets/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── larry-logo.svg
├── css/
│   └── larry.css
├── docs/
│   ├── BUGS.md
│   └── plans/
│       └── 2026-03-06-phases-3-4-5.md
├── index.html
├── js/
│   ├── chat.js
│   ├── core.js
│   ├── engines.js
│   ├── espn.js
│   ├── tabs.js
│   └── themes.js
├── manifest.json
├── netlify/
│   └── functions/
│       ├── espn-proxy.js
│       └── larry-chat.js
├── netlify.toml
└── sw.js
```

(`.claude/` is git-ignored. `temporary screenshots/` is untracked working material and not part of the deployable surface.)

---

## Quick architecture summary

- **Frontend:** vanilla ES5 JS, six modules served as separate `<script>` tags from `index.html`. Global IIFE modules (`Engines`, `Themes`, etc.) and a single global state object `S` persisted to `localStorage`.
- **Backend:** two Netlify Functions in CommonJS (`espn-proxy.js`, `larry-chat.js`). No scheduled functions, no background functions, no Netlify Blobs, no database.
- **Storage:** browser `localStorage` only. `espn_s2` and `SWID` cookies are stored unencrypted in `localStorage` (security concern flagged by the plan).
- **Build/deploy:** none. `publish = "."` means Netlify ships the repo root verbatim. Auto-deploy from `main` branch on the `redriversedge/Larry` GitHub remote → `larrybball.netlify.app`.
- **Engine status:** the plan describes the engine as missing. **It is not.** A 12-engine analysis system already exists in `js/engines.js`, including z-scores, DURANT ranking, Monte Carlo win probability, ROS projections, matchup strategy (Lock/Target/Punt), and matchup-aware recommendations. The plan's prescriptive `src/engine/{marcel,minutes,zscore,teamFit,recommend,explain}.ts` will need to be reconciled against this existing code, not built on a blank slate.
