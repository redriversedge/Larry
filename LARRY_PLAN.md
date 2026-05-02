# Larry: Complete Improvement Plan
*A repo-aware redesign for a hobbyist-built, Netlify-hosted, mobile-first ESPN H2H 5-cat fantasy basketball app*

---

## How to use this document

This is a roadmap, **not** a single prompt for Claude Code. Work through it phase by phase, in order. Reference this file from every Claude Code session so context stays consistent.

### Workflow discipline (read this before starting)

1. **Commit after every phase.** No exceptions. Each phase below has a `Commit:` instruction. Stop and commit before moving on. If a phase takes more than one session, commit at the end of each session with a clear message (`wip(phase-1): G-score working`).
2. **Branch per phase, off `dev`.** Per CLAUDE.md: feature work uses `feature/*` branches off `dev`, then merges back to `dev`, then `dev` merges to `main` for deploy. Use `feature/phase-1-engine`, `feature/phase-2-cookies`, etc. Netlify auto-deploys from `main`.
3. **One phase per Claude Code session.** Don't combine phases. The context bloat hurts quality and makes mistakes hard to trace.
4. **Verify "Done when" before moving on.** Each phase has a concrete success criterion. If it isn't met, do not start the next phase.
5. **Tests live in the same commit as the code they test.** Don't push code without tests, then "add tests later." Later never comes.
6. **No em dashes anywhere.** Per CLAUDE.md, do not use em dashes in any file. Use commas, periods, or double hyphens.
7. **If Claude Code suggests something that contradicts this plan, pause.** Sometimes the plan is wrong (the repo doesn't match prescriptive paths); sometimes Claude Code is taking a shortcut. Reconcile in `PLAN_RECONCILED.md` (created in Phase 0). Don't just go with whichever feels easier.

---

## TL;DR

- **The "same suggestions for every user" bug is a coarse-signal problem, not a missing-input problem.** The existing Engine 4 already uses roster context via `matchupAdjustedValue()` and Engine 12's Lock/Target/Punt classification, but the 3-state buckets are too coarse and DURANT dominates the 40/60 blend. The fix: a TypeScript engine that computes continuous G-scores and a continuous category-need vector, then layers a team-fit bonus on top. It runs alongside the existing engines under a v2 feature flag.
- **The cookie-pasting pain on iPhone Safari cannot be fully eliminated, but it can go from ~10 minutes to ~30 seconds with a `javascript:` bookmarklet** that reads `document.cookie` on `fantasy.espn.com`, base64-encodes the SWID/espn_s2 pair, and opens `https://larrybball.netlify.app/link?token=...` Both cookies are NOT marked HttpOnly by ESPN, so JS access works. Bookmarklets still run in iOS Safari 17/18 (Apple did not ban them; the workflow is just clunky). Provide a "Connect ESPN" page with a one-tap "Add to Bookmarks" flow plus an iOS Shortcut as a fallback. A Chrome/Edge extension is the right answer for desktop power users.
- **Stay on Netlify, but commit to a clear backbone:** Netlify Functions + Netlify Scheduled Functions (nightly Marcel re-projection at 9 UTC) + Netlify Blobs for projection JSON snapshots and per-user encrypted cookie storage + Turso/libSQL (or Supabase Postgres if you prefer) for relational data (users, leagues, picks, draft state). Add Claude API only at the explanation layer, never inside the ranking loop, so the engine is deterministic, cheap, and testable, and Larry's "voice" sits on top.

---

## Status

- **Phase 0 complete.** REPO_MAP.md, PLAN_RECONCILED.md, tsconfig.json, vitest.config.ts, and package.json with vitest in devDependencies. Hybrid architecture (legacy ES5 in `js/*.js` plus new TypeScript in `src/`) documented in CLAUDE.md.
- **Phase 1 complete.** Bespoke recommendation engine shipped under `src/engine/` with G-score, continuous team-fit, deterministic ranking, and a Claude rationale wrapper. Built bundle at `dist/larry-engine.js`, feature-flagged behind `S.prefs.useV2Engine`. Marcel deferred to Phase 1.5.
- **Phase 2 complete.** Bookmarklet-based ESPN cookie linking, iOS Shortcut fallback, Disconnect button, and expired-cookies banner. Cookies stay in `S.espn` (localStorage); no server-side encryption (see Phase 2 entry below for the scope reframe). Manual e2e on real devices is pending.
- **Phase 3 is next.** UX overhaul. See Phase 3 entry in the roadmap.

Each phase ends with a doc-update step that brings CLAUDE.md, LARRY_PLAN.md, and PLAN_RECONCILED.md current with what actually shipped, before the final commit.

---

## Key Findings

1. **Root cause of "same suggestions for everyone" is finer than originally diagnosed.** The existing Engine 4 already incorporates roster context. The actual cause is more nuanced:
   - (a) The Lock/Target/Punt buckets are too coarse: two teams with the same classification get similar weights even when their roster compositions differ materially.
   - (b) The 3-state classification collapses what should be a continuous category-need vector.
   - (c) DURANT dominates the 40/60 blend and washes out smaller team-fit signals.
   
   The fix in all three cases: a deterministic ranking core that consumes a typed `RecommendationContext` and emits continuous G-scores plus a continuous need vector, with a thin Claude layer that only narrates the deterministic output.

2. **ESPN's `espn_s2` and `SWID` cookies are NOT set with `HttpOnly`.** Multiple Chrome/Firefox extensions ("ESPN Cookie Finder," GameDayBot's helper, Flock Fantasy sync) all read these cookies via `chrome.cookies` or content scripts that touch `document.cookie`, which is only possible because the flag isn't set. This is the single most important technical fact for the cookie-setup redesign: a bookmarklet on `fantasy.espn.com` can read both values directly with `document.cookie`.

3. **Bookmarklets DO still work in iOS Safari (16, 17, 18).** The "Apple banned bookmarklets" claim that circulates in old Apple Community threads is incorrect. What changed is that the *creation* flow is clunky (you can't drag-drop on iPhone, you must edit a saved bookmark and replace its URL with `javascript:...`). Once installed, tapping a Favorites-bar bookmarklet on `fantasy.espn.com` runs the JS on that page.

4. **Web Share Target API cannot solve this problem.** `share_target` only receives `title`, `text`, `url`, or files. It never receives cookies. iOS also does not honor `share_target` at all (Android/Chrome/Edge only). Cross it off the list.

5. **iframes cannot solve this either.** ESPN sets `X-Frame-Options: SAMEORIGIN` on fantasy.espn.com, and even if it didn't, same-origin policy would block reading the iframe's cookies. Cross it off.

6. **iOS Shortcuts can run "Run JavaScript on Web Page" against a Safari tab,** which is a legitimate alternative path for the most determined users. Distribution is awkward (you publish a `.shortcut` iCloud link). Treat it as a secondary recovery path.

7. **Netlify Scheduled Functions are GA and free up to credit cap** (cron syntax, JS/TS native, runs only on published deploys, max 30s for synchronous and longer for background). They are the correct primitive for the nightly Marcel rebuild. No GitHub Actions cron needed unless you outgrow Netlify's runtime ceiling.

8. **Netlify Blobs is the right home for projection snapshots, ranking tables, and encrypted cookie blobs** (free tier during/after beta, ~5 GB per object, 600-byte key limit, eventual consistency by default with strong consistency available). It is wrong for relational data like users to leagues to picks. For that, prefer Turso (libSQL/SQLite at the edge) or Neon serverless Postgres. Both have generous free tiers and 0-config Netlify integrations. Supabase is fine if you also want auth, but adds weight you may not need.

9. **Z-scores are the industry standard for category leagues; G-scores (Rosenof, arXiv 2307.02188) are strictly better for H2H** because they account for week-to-week variance, particularly relevant for steals and blocks, which Z over-weights. For your 5-cat H2H league, the right scoring metric is G-score, not raw Z.

10. **Marcel for basketball is straightforward** but Larry needs an explicit "minutes projection" step (last 30 days weighted heaviest) layered on top of the standard 5/4/3 weighting of the prior three seasons, otherwise role changes (rookies, injuries, trades) will be badly missed. Marcel is deferred to Phase 1.5 so the bespoke G-score and team-fit fix can ship in Phase 1 using ESPN's existing projections from `kona_player_info`.

---

## Part 1, Repository Review

### Actual current architecture (per CLAUDE.md, REPO_MAP.md, PLAN_RECONCILED.md)

- **Frontend (legacy):** vanilla JavaScript multi-file PWA. No framework, no bundler, no build step. Files in `js/` (core.js, espn.js, engines.js, tabs.js, chat.js) deploy directly to Netlify as ES5. The 5-tab bottom nav (Roster, Matchup, Players, Larry, League) is rendered from `js/tabs.js`.
- **Frontend (new):** TypeScript under `src/` and `tests/`, with `tsc --strict` and `vitest`. Build pipeline lands in Phase 1 when the first `src/engine/*.ts` file ships.
- **Backend:** Netlify Functions in `netlify/functions/*.js` proxying ESPN's private league APIs and the Claude API. Specifically `netlify/functions/espn-proxy.js` (ESPN CORS proxy) and `netlify/functions/larry-chat.js` (Claude proxy reading `ANTHROPIC_API_KEY` env var).
- **Storage:** localStorage under `larry_state` (the `S` object). Cookies stored in `S.espn`. This is the security smell. See Part 4.
- **Existing engine:** 12 analysis engines in `js/engines.js` including DURANT ranking, Z-Scores, Monte Carlo, Engine 4 Recommendations (with `matchupAdjustedValue()`), Engine 12 Matchup Strategy (Lock/Target/Punt classifier).
- **Categories:** REB, AST, STL, BLK, PTS in this exact order everywhere.
- **ESPN stat IDs:** 0=PTS, 1=BLK, 2=STL, 3=AST, 6=REB.

### What "good" looks like after the refactor (target tree)

```
larry/
|-- netlify.toml
|-- netlify/
|   `-- functions/
|       |-- espn-proxy.js              # existing
|       |-- larry-chat.js              # existing (Claude proxy)
|       |-- recommend-explain.ts       # NEW Phase 1: Claude rationale wrapper
|       |-- espn-link.ts               # Phase 2: receives bookmarklet POST
|       |-- projections-rebuild.ts     # Phase 1.5: SCHEDULED nightly Marcel rebuild
|       |-- matchup.ts                 # Phase 4: weekly category margins
|       `-- trade.ts                   # Phase 4: trade analyzer
|-- src/
|   |-- engine/
|   |   |-- index.ts                   # public API entry, IIFE attaches to window.LarryEngine
|   |   |-- zscore.ts                  # Z and G score, league-aware Q pool
|   |   |-- teamFit.ts                 # need vector, fit_bonus dot product, alpha schedule
|   |   |-- recommend.ts               # composes ranking, fit, returns RankedPlayer[]
|   |   |-- explain.ts                 # builds structured payload for Claude
|   |   |-- constants.ts               # all magic numbers
|   |   |-- projectionSource.ts        # interface + EspnFromState impl (Phase 1)
|   |   |-- marcel.ts                  # Phase 1 STUB, real impl in Phase 1.5
|   |   |-- minutes.ts                 # Phase 1 STUB, real impl in Phase 1.5
|   |   `-- prompts/coach.v1.md        # Claude prompt template
|   |-- data/
|   |   |-- espn.ts                    # Phase 2+: ESPN client
|   |   |-- nba.ts                     # Phase 1.5: gamelogs source
|   |   `-- cache.ts                   # Phase 1.5+: Netlify Blobs wrapper
|   |-- db/
|   |   `-- schema.sql                 # Phase 2+: Turso tables
|   |-- ui/                            # Phase 3+: TS UI components
|   `-- shared/
|       |-- types.ts                   # RecommendationContext, ProjectionRow, etc.
|       `-- crypto.ts                  # Phase 2: AES-GCM helpers
|-- dist/
|   `-- larry-engine.js                # NEW Phase 1: bundled IIFE for legacy js/ to consume
|-- public/
|   |-- bookmarklet.html               # Phase 2: install page
|   `-- manifest.webmanifest           # PWA basics (existing as manifest.json)
`-- tests/
    |-- engine/zscore.test.ts          # Phase 1
    |-- engine/teamFit.test.ts         # Phase 1
    |-- engine/recommend.test.ts       # Phase 1 (HEADLINE TEST)
    |-- engine/marcel.test.ts          # Phase 1.5
    |-- fixtures/users/                # gitignored, real S object snapshots
    `-- golden/*.json                  # backtest fixtures
```

---

## Part 2, Engine Integration Plan

### 2.1 The deterministic recommendation pipeline

```
              +------------------------------------------------------+
nightly cron->| projections-rebuild.ts (Phase 1.5)                   |
              |  1. pull NBA gamelogs (last 3 seasons + current YTD) |
              |  2. minutes model -> projected MPG                   |
              |  3. Marcel: 5/4/3/season-blend per-36 -> per-game    |
              |  4. compute league-agnostic z-scores (5-cat)         |
              |  5. write Blob: projections/{date}.json (and latest) |
              +------------------------------------------------------+
                              |
                              v   (Blob read, ~10ms)
per request -> client engine -> read S object via projectionSource
                              -> engine/recommend.ts:
                                 - G-score per remaining FA
                                 - category-need vector vs current roster
                                 - team-fit bonus = alpha * (need . z_player)
                                 - alpha schedule (in-season default 0.3)
                                 - final = Gscore + alpha * fit
                              -> engine/explain.ts -> Claude (top 3-5 only)
                              -> return { ranked: [...], rationale: "..." }
```

In Phase 1, the projection source is `EspnFromState` (reads ESPN's projections out of S.players). In Phase 1.5, `MarcelProjectionSource` replaces it without changing engine signatures.

### 2.2 Marcel for basketball, deferred to Phase 1.5 (`src/engine/marcel.ts`)

Standard Marcel is `(5*Y0 + 4*Y-1 + 3*Y-2)/12`, regressed toward league mean with weight ~1200 PA for baseball. For basketball, regress toward position-mean per-36 stats with a regression weight of roughly 600 minutes for counting stats (rebounds, assists, points) and 800 minutes for blocks/steals (noisier). Then multiply by projected minutes from the minutes model.

```ts
// src/engine/marcel.ts (sketch, target for Phase 1.5)
export function marcelPer36(history: SeasonStats[], leaguePositionMean: PositionMean): Per36 {
  const w = [5, 4, 3];
  const totalWeight = history.slice(0, 3).reduce((s, _, i) => s + w[i], 0) || 1;
  const blended = blendStats(history.slice(0, 3), w, totalWeight);
  const ageAdjust = ageAdjustment(history[0]?.age, history[0]?.position);
  return regressToMean(blended, leaguePositionMean, REG_WEIGHT, ageAdjust);
}
```

The minutes model (`src/engine/minutes.ts`, Phase 1.5) should: (1) start from last 30 days when available, (2) fall back to projected role from depth chart inputs, (3) zero out for known injured/suspended players from a daily news cache.

In Phase 1 these files exist as stubs that throw "not implemented" or delegate to the ESPN projection source. The interface is settled in Phase 1; Phase 1.5 just swaps the implementation.

### 2.3 G-score over Z-score (`src/engine/zscore.ts`)

Implement both, default to G. Per Rosenof (2023), G-score divides by a denominator that includes weekly variance from the player set Q, which is what makes H2H formats reward high-floor over high-ceiling players. For the 5-cat order REB/AST/STL/BLK/PTS:

```
score(stat, player, Q) =
  (proj[stat][player] - mean(Q, stat)) /
  sqrt( var_acrossPlayers(Q, stat)  +  kappa * var_weekToWeek(stat) )
```

Compute Q as the top N=12*rosterSize players by a first-pass z-score, then iterate twice (Q stabilizes quickly). This is league-aware: 10-team and 12-team leagues get different Qs and therefore different rankings.

### 2.4 Team-fit bonus and alpha schedule (`src/engine/teamFit.ts`)

```
need[c]   = (leagueAvg[c] - myRoster[c]) / leagueStdev[c]   // continuous, signed
fit_bonus = sum over c of need[c] * z_player[c]              // dot product
final     = G_player + alpha(round, matchup) * fit_bonus
```

- **Draft mode:** `alpha(round) = clamp(0.05 * round, 0.0, 0.6)`. Early rounds prioritize BPA, later rounds prioritize fit.
- **In-season mode:** `alpha(matchup) = base + leverage`. base = 0.3 default. leverage rises if the user is within 1 category of winning/losing the week. Phase 1 uses base only; leverage detection is Phase 4 territory.

### 2.5 Where Claude fits (`src/engine/explain.ts`)

Claude never sees the player pool and never ranks. It receives a structured JSON payload:

```json
{
  "user": "cliff",
  "context": "in-season, week 12, league 12-team H2H 5cat",
  "topK": [
    {"player":"Naz Reid","gScore":0.82,"fitBonus":0.34,
     "categoryDeltas":{"REB":0.21,"BLK":0.18,"PTS":-0.05}}
  ],
  "myRosterNeeds": {"REB":0.6,"BLK":0.4,"AST":-0.2}
}
```

Prompt: "You are Larry. Explain in 2 sentences why the top recommendation fits this user's roster *right now*. Use the categoryDeltas. Do not invent stats." This keeps Claude bills tiny (~300 tokens/request), keeps recs deterministic and testable, and stops Larry from hallucinating.

### 2.6 Migration plan that doesn't break existing features

**Phase 1 (parallel run):** Add the new TS engine. Expose via a feature flag `Engines.useV2` in `js/engines.js`. Default OFF. Existing Engine 4 is unchanged when flag is off. Diff outputs locally on your own roster.

**Post-Phase 1 (~2 weeks of personal use):** Once v2 looks right, flip the default. Leave v1 path alive as a safety net.

**Phase 3 cleanup:** Delete v1 logic from Engine 4. Engine 4 becomes a thin caller of the v2 engine.

### 2.7 Netlify pipeline architecture (decision)

- **Scheduled Functions for nightly rebuild** (Phase 1.5+). Chosen over GitHub Actions cron because (a) the data lives next to the code, (b) you avoid maintaining a second secrets store, (c) you keep a single deploy artifact. Use cron `0 9 * * *` (5 AM ET / 9 UTC, after all NBA games are final).
- **Background Functions** for ad-hoc trade-analyzer simulations that may exceed 10s.
- **GitHub Actions** only as a safety-net "ping" if you ever see Scheduled Functions miss runs (it has historically had +/- 1 min jitter, fine for a daily projection, irrelevant for fantasy).

### 2.8 Database recommendation (decision)

- **Turso (libSQL)** for relational data (Phase 2+): users, linked leagues, encrypted cookie blobs, draft sessions, recommendation history. Free tier is generous (5GB, 9B row reads/mo at last check), latency is excellent from Netlify Functions, and the SQLite mental model fits a hobbyist solo project. Driver: `@libsql/client`.
- **Netlify Blobs** for the nightly projections snapshot (`projections/latest.json`), ranking tables per league size, and per-user explanation cache (60-min TTL). Use strong consistency for the latest projections key so Scheduled Function writes are immediately visible to Functions.
- **Avoid Supabase** unless you want auth + Postgres + RLS as a bundle. The added concept count isn't worth it for a solo hobbyist. **Avoid Neon** unless you have a strong Postgres preference. It's also fine but Turso is closer to "zero-config."

### 2.9 Determinism and explainability

Every recommendation response should carry a `breakdown` array:

```json
{ "player":"Naz Reid","gScore":0.82,"alpha":0.45,"fitBonus":0.34,
  "final":0.97,"why":["+REB","+BLK"],"projection":{},"confidence":0.71 }
```

This is what you render in the UI (Part 3) and what Claude paraphrases. It is also what you write to a `recommendations` table for backtesting.

---

## Part 3, UX Improvements

### 3.1 Tab bar refinements

- **Rename "Larry" tab to "Coach"** (or keep "Larry" as the brand but label the tab "Coach"). Users don't know what "Larry" does until they tap; "Coach" telegraphs purpose.
- **Reorder: Coach | Matchup | Roster | Players | League.** Coach first because that's the differentiating value; League last because it's reference, not action.
- **Add a global "?" affordance in the header** that opens a contextual help sheet explaining the current screen in 1 sentence.

### 3.2 The Coach tab (the new recommendation surface)

Each recommendation should be a card with:

1. Player name, team, position, projected MPG (last 14d).
2. A horizontal 5-category bar chart showing the player's z-score per cat, color-graded.
3. Two badges: the "BPA" badge (G-score rank) and the "Fit" badge (fit_bonus rank for *your* roster).
4. One-sentence Larry rationale (the Claude output).
5. A "Why?" expand that reveals the numeric breakdown (gScore, alpha, fitBonus, categoryDeltas). This is the explainability surface and builds trust.
6. Action buttons: Add (waivers), Compare, Mute (so Larry stops suggesting this player).

### 3.3 Matchup tab, make leverage visible

Show the current week's category margins as a 5-row strip: green if winning, red if losing, with the projected end-of-week delta to the right (rest-of-week games * proj per-game). The Coach tab should auto-filter to "players who help close the red rows."

### 3.4 Roster tab

- Per-category strength bars vs. league average (this directly visualizes "team needs").
- Tag players with a "punt candidate" pill if dropping them would push the user from contender to leader in 4 of 5 cats.
- "Trade up/down" affordance on each player, opens trade analyzer.

### 3.5 Players tab

- Default sort: G-score for your league (not ESPN ADP).
- Filters: punt FT% / punt AST / etc.
- Each row shows mini sparkline of last 10 games' fantasy value.

### 3.6 Onboarding flow

Today: new user opens app, blank state, form for SWID + espn_s2, confusion.

Target flow:

1. Welcome screen ("Larry helps you win your H2H 5-cat league. We need read-only access to your ESPN league.")
2. Big primary button: "Connect ESPN", routes to `/connect` page (Part 4).
3. While cookies are processing, show a 4-step animated checklist: (a) Cookies linked, (b) League found, (c) Roster loaded, (d) Larry ready.
4. After link, immediately drop the user on the Coach tab with their first 3 personalized recommendations.

### 3.7 Loading & empty states

- Loading: skeleton cards (not spinners) for every tab. Preload next likely tab on idle.
- Empty: never blank. If no recs yet, say "Larry's still pulling your league. This usually takes 5 seconds." with a progress indicator pulled from a `/api/status` endpoint.
- Error: explicit "Cookie expired, Reconnect ESPN" CTA. Never a generic "something went wrong."

### 3.8 Reasoning visualization

On the Coach tab, add a header strip: "Your team needs: REB up, BLK up, FT% down" computed from the same need[] vector that drives the engine. This is the user-visible proof that recommendations are bespoke.

---

## Part 4, Cookie Setup Flow (the critical fix)

### 4.1 Decision summary

- **Primary path:** a `javascript:` bookmarklet that runs on `fantasy.espn.com`, reads `document.cookie`, and POSTs to Larry. Works on iOS Safari, Android Chrome, desktop Chrome/Firefox/Safari/Edge.
- **Power-user path:** a Manifest V3 Chrome/Edge extension (~50 lines) for one-click connect on desktop, plus optional Firefox add-on.
- **Recovery path:** an iOS Shortcut that runs the same JS via "Run JavaScript on Web Page."
- **Always available:** the existing manual paste box, kept as a fallback.

### 4.2 Why the bookmarklet works (and the security model)

ESPN sets `espn_s2` and `SWID` without the `HttpOnly` flag, confirmed by every existing third-party tool that reads them. That means `document.cookie` on `fantasy.espn.com` returns both values. Same-origin policy means Larry's own JS at `larrybball.netlify.app` cannot read those cookies. Only code running on `fantasy.espn.com` can, which is exactly what a bookmarklet does (it executes in the context of the currently loaded page).

### 4.3 The bookmarklet code

```javascript
javascript:(function(){
  try {
    if (!/(^|\.)espn\.com$/i.test(location.hostname)) {
      alert("Open ESPN Fantasy first, then tap Larry Link.");
      return;
    }
    var c = document.cookie.split(';').reduce(function(a,p){
      var i = p.indexOf('='); if (i<0) return a;
      a[p.slice(0,i).trim()] = decodeURIComponent(p.slice(i+1).trim());
      return a;
    }, {});
    if (!c.espn_s2 || !c.SWID) {
      alert("Sign in to ESPN Fantasy first, then tap Larry Link again.");
      return;
    }
    var payload = btoa(JSON.stringify({
      s2:   c.espn_s2,
      swid: c.SWID,
      ts:   Date.now()
    }));
    location.href = "https://larrybball.netlify.app/link?token=" + encodeURIComponent(payload);
  } catch (e) { alert("Larry Link error: " + e.message); }
})();
```

Notes:

- **Why redirect, not `fetch()`:** an XHR/`fetch()` from `fantasy.espn.com` to `larrybball.netlify.app` is a cross-origin call without CORS pre-approval, so it will fail. Using `location.href` to navigate the same tab to a Larry URL with the encoded token in the query string is the most reliable cross-browser approach. Larry's `/link` page extracts the token, immediately POSTs it to `/api/espn-link` (same origin, no CORS issue), and clears the URL.
- **Size:** under 1 KB minified, well within bookmark URL limits on iOS Safari (~80 KB).
- **Domain check** prevents the bookmarklet from accidentally running on the wrong page.

### 4.4 The companion `/link` page (sketch)

```ts
// src/ui/pages/link.tsx
useEffect(() => {
  const token = new URL(location.href).searchParams.get("token");
  if (!token) return;
  fetch("/api/espn-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  }).then(r => r.ok ? location.replace("/coach") : showRetry());
  history.replaceState({}, "", "/connect"); // strip token from URL
}, []);
```

### 4.5 The `/api/espn-link` Netlify function

```ts
import { getStore } from "@netlify/blobs";
import { encrypt } from "../../src/shared/crypto";
export default async (req, ctx) => {
  const { token } = await req.json();
  const { s2, swid, ts } = JSON.parse(atob(token));
  if (Date.now() - ts > 5 * 60_000) return new Response("expired", { status: 400 });
  const userId = await requireSession(req);
  const enc = await encrypt({ s2, swid }, process.env.LARRY_KMS_KEY);
  await getStore("espn-cookies").set(userId, enc);
  return new Response("ok");
};
```

### 4.6 Security implications and mitigations

- **At rest:** Encrypt the cookie pair with AES-GCM using a key stored in Netlify env vars (`LARRY_KMS_KEY`). Never log raw cookies. Store only ciphertext in Blobs/Turso.
- **In transit:** HTTPS everywhere (Netlify default). The token is in a URL fragment for ~200ms before being stripped, acceptable for a hobbyist app, but for extra safety use the URL fragment (`#token=...`) instead of query string so it never hits Netlify access logs.
- **Scope:** Larry should only ever do read operations against ESPN. Document this. Add a per-request kill switch (`COOKIE_KILL_SWITCH=1`) that purges all stored cookies if you ever need to.
- **Rotation:** ESPN cookies last ~1 year but rotate when users change their password. Detect 401s from ESPN and prompt the user to reconnect. Never silently fail.
- **Deletion:** Add an explicit "Disconnect ESPN" button in Settings that DELETEs the blob and revokes the session.
- **Bookmarklet trust:** Publish the source on `https://larrybball.netlify.app/bookmarklet.html` with the JS shown plain-text so users can read what it does before adding. This is a hobbyist-credibility requirement.

### 4.7 Why the alternatives don't work (and stay rejected)

- **PWA Web Share Target:** receives only `title`/`text`/`url`/files. Cookies cannot be shared via OS share sheet. Cross off.
- **iframe of espn.com:** blocked by `X-Frame-Options: SAMEORIGIN` and same-origin policy even if it weren't. Cross off.
- **OAuth/redirect:** ESPN does not offer a public OAuth flow for fantasy data. Cross off.
- **iOS Share Extension:** requires native app + App Store distribution. Outside the hobbyist scope.

### 4.8 The iOS Shortcut fallback (one-page recipe)

Provide a downloadable Shortcut at `larrybball.netlify.app/ios-shortcut` containing:

1. "Get URLs from input", restrict to `*.espn.com`.
2. "Run JavaScript on Web Page", paste the same bookmarklet code (without the `javascript:` prefix).
3. "Open URLs", opens the resulting `larrybball.netlify.app/link?token=...`.

This gets installed via an iCloud share link in 2 taps and shows up in Safari's Share Sheet on every page, the closest thing iOS gives you to a bookmarklet shortcut.

### 4.9 The desktop browser extension (small Manifest V3)

For desktop users this is genuinely one click. Total surface area: a `manifest.json` with `"permissions":["cookies"]`, `"host_permissions":["*://*.espn.com/*"]`, a popup with one button that calls `chrome.cookies.get({url:"https://fantasy.espn.com", name:"espn_s2"})` and posts to Larry. ~50 LOC. Distribute on Chrome Web Store ($5 one-time) and Firefox Add-ons (free). This is a Phase 6 effort, not Phase 2.

### 4.10 Onboarding copy that ties it together

On the Connect screen, show three options as cards in this order:

1. **iPhone / iPad**: "Add Larry Link to your bookmarks" (animated GIF showing the install flow), with the JS source visible underneath.
2. **Computer**: "Install the Chrome extension" (when ready) OR "Drag this button to your bookmarks bar."
3. **Manual (Power User)**: the existing paste form.

---

## Part 5, Code Quality

### 5.1 TypeScript first

Phase 0 already enabled TypeScript with `strict: true` and `noUncheckedIndexedAccess: true`. Keep it that way. New code in `src/` and `tests/` is TS. Legacy `js/*.js` stays ES5 (no `let`/`const`/arrow functions/template literals) per CLAUDE.md.

### 5.2 Module boundaries (enforced)

- `src/engine/*` must not import from `src/data/*` or `src/ui/*`. Engine is pure functions over typed inputs. This is what makes it unit-testable and what lets you backtest.
- `netlify/functions/*` is the only place that touches I/O (network, blobs, db). Functions compose engine + data; they do not contain business logic.
- `src/ui/*` only consumes typed responses from functions. It never recomputes ranks.

### 5.3 Testing, what to write first (in this order)

1. `engine/zscore.test.ts` verifying that league size affects rankings (10-team vs 12-team produces measurably different orders) and that Z and G differ for high-variance vs low-variance categories.
2. `engine/teamFit.test.ts` verifying that the need vector flips when roster strengths flip.
3. `engine/recommend.test.ts` verifying that two different rosters in the SAME league with the SAME Lock/Target/Punt classification get materially different top 5. This is the regression test for the original bug.
4. `engine/marcel.test.ts` (Phase 1.5) with golden fixtures for 3-5 known players.
5. `functions/espn-link.test.ts` (Phase 2) mocked, verifying token expiry and encryption round-trip.
6. End-to-end (Phase 3+): a Playwright script that hits `/api/recommend-explain` with two different mock users and asserts non-identical responses.

### 5.4 Error handling and observability

- Wrap every Netlify function with a `withTelemetry()` higher-order function that logs `userId`, function name, duration, and error code.
- Use Netlify Log Drains (Pro) or just stdout + a daily Blob log file for hobbyist budget.
- Add Sentry (free tier) for the frontend. It pays for itself the first time an iPhone user reports a vague bug.

### 5.5 Refactors to do explicitly

- Replace any `localStorage.setItem("espn_s2", ...)` with the encrypted server-side blob flow (Phase 2).
- Replace any inline Claude prompt strings with versioned prompt files in `src/engine/prompts/` (e.g., `coach.v1.md`).
- Replace any "magic" numbers (regression weights, alpha schedule) with a single `src/engine/constants.ts` so backtests can sweep them.

---

## Part 6, Feature Suggestions

### 6.1 Keep, simplify, or remove (per current tab bar)

- **Roster**: keep. Add per-category strength visualization and punt-candidate badges.
- **Matchup**: keep, elevate. Add projected end-of-week deltas. This is one of the highest-leverage screens for an H2H league and is currently probably underbuilt.
- **Players**: keep but rip out ESPN's default ordering. Sort by Larry's G-score for the user's league size. Add punt filters.
- **Larry**: rename to Coach, repurpose as the home of bespoke recommendations. The chat affordance can stay as a sub-tab inside Coach.
- **League**: keep but make it lightweight. Just power rankings + a "schedule strength" chart for the rest of the season.

### 6.2 New features that pull weight (priority-ordered)

1. **Trade Analyzer** (`/trade`): given proposed trade, recompute G-scores + matchup deltas before/after for both teams, with a verdict + Larry rationale. The single most-requested feature by H2H users.
2. **Schedule Analyzer**: for a given upcoming week, project category margins for every matchup, with rest-adjusted MPG and B2B impact. This sells your engine's value the way Basketball Monster does.
3. **Punt Build Helper**: interactive punt toggles on the Players tab that re-rank in real time. Core to H2H 5-cat strategy.
4. **Injury & news alerts** affecting your roster only (use ESPN's news endpoints + a `news` Netlify Blob updated nightly). Push via web push to PWA.
5. **Draft Mode**: a separate route `/draft/{leagueId}` with a real-time draft board, your queue, and round-aware alpha. Must-have for the user's stated use case and requires a different UI than in-season.
6. **Streamer planner**: given the upcoming 7 days, who to add/drop for max games played in your weak categories.

### 6.3 Premium / power features (Phase 3+)

- Projection comparison vs. Hashtag, Rotowire, FantasyPros (paste-in import).
- "Larry's confidence" score on each rec, learned from previous weeks (post-hoc check: did the recommended add actually outperform the alternatives?).
- League-wide power rankings with playoff probability via Monte Carlo.

### 6.4 Features to actively NOT build

- Daily fantasy (DraftKings/FanDuel). Different problem, different model.
- Live game tracking. ESPN already does this, you can't beat them on it.
- Multi-sport. Stay focused on basketball; the engine assumptions don't transfer cleanly.

---

## Part 7, Concrete Roadmap

> **Discipline reminder:** Branch per phase off `dev`, named `feature/phase-N-name`. Commit at the end of every phase. If a phase spans sessions, commit at the end of each session with a `wip(phase-N):` prefix. Merge to `dev` after the phase's "Done when" criterion is verified, then merge `dev` to `main` for deploy. Do not skip the commit step.

### Phase 0, Audit & TypeScript baseline ✅ COMPLETE

- REPO_MAP.md with file tree + key-file summaries.
- PLAN_RECONCILED.md mapping plan paths to actual paths.
- TypeScript strict mode enabled (`tsconfig.json`).
- vitest configured (`vitest.config.ts`, `package.json` devDeps).
- Netlify build status badge in README.
- **Doc updates:** CLAUDE.md updated with hybrid TS rule. LARRY_PLAN.md status reflects Phase 0 done. PLAN_RECONCILED.md created with Path (D) Hybrid resolution.

### Phase 1, Bespoke recommendations engine ✅ COMPLETE

- **Branch:** `feature/phase-1-engine` off `dev`.
- **Scope:** ship the new TS engine running ALONGSIDE the existing engines under a feature flag. G-score, continuous team-fit, deterministic ranking, Claude rationale layer. Marcel deferred to Phase 1.5.
- **Files to create:**
  - `src/engine/{index,zscore,teamFit,recommend,explain,constants,projectionSource,marcel,minutes}.ts`
  - `src/engine/prompts/coach.v1.md`
  - `src/shared/types.ts`
  - `tests/engine/{zscore,teamFit,recommend}.test.ts`
  - `netlify/functions/recommend-explain.ts`
  - `dist/larry-engine.js` (build output)
  - `tools/manual-verify.ts`
- **Files to modify:**
  - `package.json` (add esbuild, build scripts)
  - `js/engines.js` (add `Engines.useV2` feature flag in Engine 4)
  - `index.html` (load `dist/larry-engine.js`)
  - `sw.js` (bump CACHE_VERSION)
  - `netlify.toml` (build step if needed)
- **Steps:**
  1. Verify Phase 0 artifacts.
  2. Add esbuild build pipeline (decide: commit `dist/` or add Netlify build step).
  3. Implement engine modules (G-score, need vector, fit_bonus, recommend composition).
  4. Implement `recommend-explain.ts` Netlify function (Claude proxy for top 5 rationale).
  5. Wire feature flag in `js/engines.js` Engine 4.
  6. Write tests, including the headline regression test.
  7. Verify on real personal roster snapshot.
  8. Bump CACHE_VERSION, run full Testing Checklist.
  9. **Doc updates:** mark Phase 1 complete in `LARRY_PLAN.md`, update `CLAUDE.md` if architecture or file tree changed, log any plan divergence in `PLAN_RECONCILED.md`. Do this before the final commit.
  10. Commit.
- **Done when:** the headline test passes (two rosters, same strategy bucket, materially different top 5), the category-fit test passes, your own roster shows a v2 top 5 that differs from v1 with a rationale referencing a real weak category.
- **Commit:** `feat(phase-1): bespoke recommendation engine with G-score and team-fit blend`. Merge `feature/phase-1-engine` to `dev`. Tag as `v0.2.0-phase1`.

### Phase 1.5, Marcel projection model (~1 week, ~10h)

- **Branch:** `feature/phase-1-5-marcel` off `dev`.
- **Scope:** swap the projection source from ESPN's `kona_player_info` to a Marcel-from-scratch model. The engine signatures from Phase 1 do not change.
- **Files to create/modify:**
  - `src/engine/marcel.ts` (real implementation, replaces stub)
  - `src/engine/minutes.ts` (real implementation, replaces stub)
  - `src/engine/constants.ts` (regression weights, age curve coefficients)
  - `src/data/nba.ts` (gamelogs source: NBA stats API or committed Kaggle dump)
  - `src/data/cache.ts` (Netlify Blobs wrapper)
  - `netlify/functions/projections-rebuild.ts` (Scheduled Function, cron `0 9 * * *`)
  - `tests/engine/marcel.test.ts` (golden fixtures for 3-5 known players)
  - `tests/engine/minutes.test.ts`
  - `data/seed/` (committed gamelog dataset OR fetched on first run)
- **Steps:**
  1. Pick a gamelogs data source. STOP AND ASK ME which (NBA stats API, Basketball Reference scrape, Kaggle dump). Each has tradeoffs (Kaggle is reproducible but stale, NBA stats has more recent data but is rate-limited).
  2. Implement Marcel per-36 (5/4/3 weighting + position-mean regression + age curve).
  3. Implement minutes model (last 30 days + role projection + injury filter).
  4. Add `MarcelProjectionSource` implementing the `ProjectionSource` interface from Phase 1.
  5. Build the Scheduled Function that runs nightly and writes `projections/latest.json` to Netlify Blobs with strong consistency.
  6. Add a config toggle (`Engines.projectionSource = "espn" | "marcel"`) that defaults to `"marcel"` once the rebuild has run successfully at least once.
  7. Backtest: compute correlation between Marcel projections and last season's actuals. Compare to ESPN's projection RMSE on the same player set. Document findings in `tests/golden/marcel-backtest.md`.
  8. **Doc updates:** mark Phase 1.5 complete in `LARRY_PLAN.md`, update `CLAUDE.md` if architecture or file tree changed, log any plan divergence in `PLAN_RECONCILED.md`. Do this before the final commit.
- **Done when:** the Scheduled Function has run successfully, projections show up in Netlify Blobs, the engine produces v2 top 5 that differs from the Phase-1-with-ESPN-projections v2 top 5, and the backtest correlation against last season's actuals is at least as good as ESPN's projections.
- **Commit:** `feat(phase-1-5): Marcel projection model with minutes/age curves`. Merge to `dev`. Tag as `v0.2.5-phase1-5`.

### Phase 2, Cookie flow rewrite ✅ COMPLETE (manual e2e pending)

- **Branch:** `feature/phase-2-cookies` off `dev`. Pushed; merge to `dev` after manual e2e on real devices.
- **Scope reframe (during Phase 2):** Original plan prescribed a server-side encrypted cookie store via `netlify/functions/espn-link.ts` and `src/shared/crypto.ts` with AES-GCM. Larry has no userId, no auth, no session system; each browser is an island. Server-side storage with a session token doesn't help because the same XSS would steal the session token instead. Real security improvement requires httpOnly session cookies + CSRF + auth, which is multiple phases of work for a single-user hobbyist app. Phase 2 therefore writes the bookmarklet's cookies directly to localStorage, mirroring manual paste. PLAN_RECONCILED.md entry for this reframe is pending.
- **Files added:**
  - `public/bookmarklet.js` -- audit-friendly bookmarklet source
  - `public/connect-bookmarklet.html` -- install page (rewritten to /connect via netlify.toml)
  - `public/link.html` -- handler page (rewritten to /link)
  - `public/ios-shortcut.txt` -- TODO + manual publish steps for the iCloud Shortcut
  - `src/cookies/parseToken.ts` -- pure parser (testable, no DOM)
  - `src/cookies/index.ts` -- IIFE entry, builds dist/larry-cookies.js
  - `tests/cookies/parseToken.test.ts` -- 15 cases (valid, expired, future, missing s2/swid, short s2, malformed swid, malformed JSON, malformed base64, empty fragment, no token param, non-object payload, custom maxAgeMs, brace-wrapped SWID, no-hash fragment)
  - `dist/larry-cookies.js[.map]` -- bundle, committed to git for Netlify publish
- **Files modified:**
  - `js/core.js` -- "Use Bookmarklet" button at top of wizard step 3, gotoBookmarkletInstall, disconnectEspn, reconnectEspn, setEspnExpired, expired-banner hook in safeRender
  - `js/tabs.js` -- Disconnect button on Settings ESPN Connection card, renderEspnExpiredBanner
  - `js/espn.js` -- 401 detection in fetchESPN/fetchPlayers; success path clears expired flag
  - `package.json` -- build:cookies esbuild script alongside build:engine
  - `netlify.toml` -- /link and /connect rewrites (status 200 so the fragment reaches the client)
  - `sw.js` -- bumped CACHE_VERSION to v3.8.0; added new routes and bundle
  - `.gitignore` -- allow dist/larry-cookies.js[.map]
- **Done when (achieved):**
  - Bookmarklet on espn.com subdomains base64-encodes {s2, swid, ts} and redirects to /link with token in URL fragment.
  - /link parses, validates 5-min window, validates s2 length and SWID shape, writes S.espn.{espnS2, swid}, strips fragment via history.replaceState, and redirects to /.
  - Manual paste flow still works as a fallback (regression check, not removed).
  - Disconnect button clears cookies + cached league/team/roster, returns user to wizard.
  - 401 from ESPN sets cookieExpired flag; banner with Reconnect button shown atop tabs and routes to /connect.
  - npm test 28/28 passing (15 new); npm run build clean; npx tsc --noEmit clean; node --check js/*.js clean; ASCII grep clean.
- **Manual e2e (deferred to human):** real-device verification on iPhone Safari, Android Chrome, desktop Chrome and Safari. Publish iCloud share link for the iOS Shortcut from iPhone (steps in public/ios-shortcut.txt). Goal: fresh user connects ESPN on iPhone in under 60 seconds.
- **Doc updates (this commit):** marked Phase 1 and Phase 2 complete in LARRY_PLAN.md status. Updated CLAUDE.md with Phase 2 file tree entries and a "Cookie linking" key concept. PLAN_RECONCILED.md update for the scope reframe is pending.
- **Commit:** `feat(phase-2): bookmarklet-based ESPN cookie linking with iOS Shortcut fallback` (c76774b). Merge `feature/phase-2-cookies` to `dev` after manual e2e passes. Tag as `v0.3.0-phase2`.

### Phase 3, UX overhaul (~1 weekend, ~8h)

- **Branch:** `feature/phase-3-ux` off `dev`.
- **Files:** `src/ui/components/RecCard.tsx`, `src/ui/tabs/Coach.tsx`, `src/ui/tabs/Matchup.tsx`, `src/ui/tabs/Roster.tsx`, `src/ui/tabs/Players.tsx`, plus shared `src/ui/components/{CategoryBars,LoadingSkeleton,EmptyState}.tsx`.
- **Steps:**
  1. Rebuild each tab per Part 3, with skeleton loaders, the category-need header, and the explainability "Why?" expander.
  2. Lighthouse mobile >=90, manual on iPhone SE viewport.
  3. **Doc updates:** mark Phase 3 complete in `LARRY_PLAN.md`, update `CLAUDE.md` if architecture or file tree changed, log any plan divergence in `PLAN_RECONCILED.md`. Do this before the final commit.
- **Done when:** every tab tells you something specific about *your* team within 1 second of opening.
- **Commit:** `feat(phase-3): mobile-first UX overhaul with explainable recommendations`. Merge to `dev`. Tag as `v0.4.0-phase3`.

### Phase 4, Trade analyzer + schedule analyzer (~1 week, ~12h)

- **Branch:** `feature/phase-4-trade-schedule` off `dev`.
- **Files:** `netlify/functions/trade.ts`, `src/engine/trade.ts`, `src/ui/pages/Trade.tsx`, `src/engine/schedule.ts`, `src/ui/tabs/Matchup.tsx` augmented.
- **Steps:**
  1. Build the trade analyzer engine and Netlify Function.
  2. Build the schedule-aware matchup projections.
  3. **Doc updates:** mark Phase 4 complete in `LARRY_PLAN.md`, update `CLAUDE.md` if architecture or file tree changed, log any plan divergence in `PLAN_RECONCILED.md`. Do this before the final commit.
- **Done when:** pasting two rosters yields a verdict you'd actually trust.
- **Commit:** `feat(phase-4): trade analyzer and schedule-aware matchup projections`. Merge to `dev`. Tag as `v0.5.0-phase4`.

### Phase 5, Draft mode (~1 week, ~10h, time it for August before NBA season)

- **Branch:** `feature/phase-5-draft` off `dev`.
- **Files:** `src/ui/pages/Draft/{Board,Queue,Tier}.tsx`, `netlify/functions/draft-state.ts`, Turso table `draft_picks`.
- **Steps:**
  1. Build draft board, queue, tier UIs.
  2. Wire round-aware alpha into the engine.
  3. **Doc updates:** mark Phase 5 complete in `LARRY_PLAN.md`, update `CLAUDE.md` if architecture or file tree changed, log any plan divergence in `PLAN_RECONCILED.md`. Do this before the final commit.
- **Done when:** you can mock-draft your own league and the recs change appropriately by round and roster construction.
- **Commit:** `feat(phase-5): live draft mode with round-aware recommendations`. Merge to `dev`. Tag as `v0.6.0-phase5`.

### Phase 6, Browser extension + power features (rolling, ~10h)

- **Branch:** `feature/phase-6-extension` off `dev`.
- **Steps:**
  1. Manifest V3 Chrome extension for one-click connect on desktop.
  2. Streamer planner.
  3. Injury push notifications (PWA web-push).
  4. **Doc updates:** mark Phase 6 complete in `LARRY_PLAN.md`, update `CLAUDE.md` if architecture or file tree changed, log any plan divergence in `PLAN_RECONCILED.md`. Do this before the final commit.
- **Commit:** `feat(phase-6): chrome extension and power-user features`. Merge to `dev`. Tag as `v0.7.0-phase6`.

### Phase 7, Backtesting + polish (rolling)

- **Branch:** `feature/phase-7-backtest` off `dev`.
- **Steps:**
  1. Backtest the engine against last season: did its top-3 weekly add suggestions outperform a random/top-ADP baseline?
  2. Tune alpha schedule and regression weights based on the backtest.
  3. Add a "Larry's track record" page that publicly shows hit rate. Builds trust for new users.
  4. **Doc updates:** mark Phase 7 complete in `LARRY_PLAN.md`, update `CLAUDE.md` if architecture or file tree changed, log any plan divergence in `PLAN_RECONCILED.md`. Do this before the final commit.
- **Commit:** `feat(phase-7): season backtest + alpha/regression tuning + public track record page`. Merge to `dev`. Tag as `v1.0.0`.

### Effort summary

| Phase | Scope | Effort | Risk |
|---|---|---|---|
| 0 | TS + audit | 3h | ✅ Done |
| 1 | Engine math + integration (G-score, team-fit, Claude rationale) | ~10h | ✅ Done |
| 1.5 | Marcel projection model + Scheduled Function | ~10h | Medium (data sourcing) |
| 2 | Cookie flow (bookmarklet + iOS Shortcut, localStorage only) | ~6h | ✅ Done (manual e2e pending) |
| 3 | UX | ~8h | Low |
| 4 | Trade + schedule | ~12h | Medium |
| 5 | Draft mode | ~10h | Medium (time-boxed to season) |
| 6 | Extension + power | ~10h | Low |
| 7 | Backtest | rolling | High value, low risk |

---

## Recommendations (decision-ready)

1. **Do Phase 1 next, before any UX work.** The "same recs for everyone" complaint is the credibility bug; fixing UX without fixing the engine is rearranging deck chairs.
2. **TypeScript stays the standard for new code.** Legacy `js/*.js` stays ES5 per CLAUDE.md, but every new module goes in `src/`.
3. **Adopt G-score, not just Z-score.** For a 5-cat H2H league this is a free accuracy win and is the differentiator vs. ESPN's default ordering.
4. **Defer Marcel to Phase 1.5.** Use ESPN's existing projections in Phase 1 to ship the engine math faster, then swap in Marcel when the data pipeline is ready.
5. **Ship the bookmarklet flow before the browser extension.** It works on every platform, it's 50 lines, and it removes the single biggest UX wart.
6. **Pick Turso + Netlify Blobs + Netlify Scheduled Functions.** Resist Supabase/Neon unless you have a specific reason. The fewer moving parts, the longer you stay a hobbyist.
7. **Keep Claude on the explanation layer only.** Never let it rank or compute; it should narrate deterministic numbers. This makes Larry cheap, testable, and trustworthy.
8. **Write the headline regression test on day 1 of Phase 1.** Two rosters, same Lock/Target/Punt bucket, materially different top 5. It's the canary for the entire project.
9. **Threshold to revisit native app:** if iOS bookmarklet install friction still kills onboarding after Phase 2 ships, build the Manifest V3 extension (Phase 6 brought forward). Only consider native iOS if you cross 1,000 users.
10. **Threshold to leave Netlify:** stay until either (a) Scheduled Function runtime exceeds 30s or (b) credit costs exceed $25/mo. At that point evaluate Cloudflare Workers + D1 (which is also SQLite-based, so the Turso to D1 migration is mechanical).

---

## Caveats

- **ESPN's API is undocumented and can break.** It has been stable for years but has no SLA. Build a `USING_ESPN_FALLBACK` flag that lets you serve "engine-only" recommendations (using last successful roster pull from cache) when ESPN returns 5xx.
- **G-score (Rosenof) is academic, not a vendor product.** Implement carefully against the paper. The variance term `kappa * var_weekToWeek(stat)` is the right shape but the empirical kappa values come from his Table 8. Verify in Phase 7 backtest before tuning further.
- **Bookmarklet UX on iOS is functional but not delightful.** The install flow is multi-step and feels janky compared to a native share extension. An animated GIF and clear copy mitigate but do not eliminate this. Expect 10-20% of mobile users to fall back to manual paste.
- **Marcel + last-30-day minutes is a strong baseline, not state of the art.** Vendors like Basketball Monster have years of refinement (rest, B2B, pace, injuries) baked in. Larry's first version will not match them on raw projection accuracy. It will win on *fit* (bespoke to the user's matchup state) and *explanation* (Claude rationales). Position the product accordingly.
- **iOS Shortcuts as a fallback work but distribution is fragile** (iCloud share links can be blocked by some MDM profiles). Keep the manual paste as the ultimate floor.
- **Claude API rate limits** at the free/low tier can bite during draft mode (10 picks * 12 users in a few minutes). Cache explanations by `(player, rosterHash)` and pre-warm the top 30 at draft start.
- **Hobbyist-maintainable** has to constrain every decision. If you find yourself adding a third storage system, a queue, or a custom auth flow, stop. You're past the maintainable line.

---

## Appendix A, Session-Start Prompts for Claude Code

Copy these prompts directly into a fresh Claude Code session at the start of each phase. Do not start a phase without using its prompt.

### Phase 1 prompt, Bespoke recommendations engine (ACTIVE)

```
We're starting Phase 1 of the Larry improvement plan. Read CLAUDE.md, LARRY_PLAN.md, REPO_MAP.md, and PLAN_RECONCILED.md before doing anything else. CLAUDE.md is the project bible. If anything in this prompt contradicts CLAUDE.md, CLAUDE.md wins.

GROUND RULES (do not skip):

1. Branch: feature/phase-1-engine off dev. Create it now if it doesn't exist.
2. Phase 0 must already be complete. Confirm REPO_MAP.md, PLAN_RECONCILED.md, tsconfig.json, vitest.config.ts, and package.json (with vitest in devDependencies) all exist. If any are missing, STOP and tell me.
3. Commit at end of every working session with `wip(phase-1):` prefix if not done. Final commit: `feat(phase-1): bespoke recommendation engine with G-score and team-fit blend`.
4. NO em dashes anywhere. Code, comments, prose, commit messages, none of it. Use commas, periods, or double hyphens. CLAUDE.md is explicit about this rule.
5. Do NOT touch any legacy `js/*.js` file beyond minimum integration: ONE feature flag in `js/engines.js`, and a CACHE_VERSION bump in `sw.js`. All new logic goes in `src/`.
6. Do NOT replace DURANT ranking, Engine 4 Recommendations, or Engine 12 Matchup Strategy. The new engine runs ALONGSIDE existing engines under a v2 feature flag. v1 stays default.
7. Do NOT redesign the Larry tab UI. Phase 3 covers UX. Phase 1 wires the new engine to the existing tab behind a hidden toggle, nothing more.
8. Category order is REB, AST, STL, BLK, PTS everywhere. Do not reorder.
9. ESPN stat IDs: 0=PTS, 1=BLK, 2=STL, 3=AST, 6=REB. Document in code where you read S.players projections.
10. The "two rosters with same strategy bucket get different top 5" regression test is non-negotiable. Write it BEFORE shipping, not after. See task 8.
11. If a decision the plan does not cover comes up, STOP and ask. Do not improvise.

CONTEXT REFRAME (read before designing):

The existing Engine 4 already uses roster context via matchupAdjustedValue and Engine 12's Lock/Target/Punt classification. The "same suggestions for multiple users" complaint is more nuanced than the original plan suggested. The likely real cause:
(a) Lock/Target/Punt buckets are too coarse: two teams with the same classification get similar weights even with quite different rosters.
(b) The 3-state classification collapses what should be a continuous category-need vector.
(c) DURANT score dominates the 40/60 blend and washes out smaller team-fit signals.

The new TS engine fixes this with:
- CONTINUOUS G-score per category (Rosenof 2023, better than Z for H2H since it accounts for week-to-week variance).
- CONTINUOUS team-need vector (5-dimensional, normalized in stdev).
- fit_bonus as dot product of need vector and player z vector.
- Deterministic ranked output with full breakdowns ready for explainable rendering.

DATA SOURCE NOTE (deferred Marcel): The original plan put Marcel projections in Phase 1. To ship the bespoke fix faster, defer Marcel to Phase 1.5. Use the projection data already in S.players (ESPN's kona_player_info) for now. Define a `ProjectionSource` interface so Phase 1.5 can swap in Marcel without changing engine signatures. Mark the Marcel module as a stub.

PHASE 1 TASKS (in order):

1. ENVIRONMENT CHECK
   - Verify Phase 0 artifacts exist.
   - Run `npx tsc --noEmit`, confirm passes.
   - Run `npm test`, confirm sanity test passes.
   - Run `node --check js/*.js`, confirm legacy JS parses.
   - If anything fails, STOP and tell me.

2. BUILD PIPELINE
   The legacy app has no bundler. Phase 1 introduces one for `src/` only. Use esbuild.
   - Add devDep: esbuild (latest stable).
   - Add script: `"build:engine": "esbuild src/engine/index.ts --bundle --format=iife --global-name=LarryEngine --outfile=dist/larry-engine.js --target=es2020 --sourcemap"`
   - Add script: `"build": "npm run build:engine"`
   - Decide: commit `dist/` to git OR add a Netlify build step. STOP AND ASK ME which approach before deciding. Both are valid; the tradeoff is build complexity vs repo cleanliness.
   - Update `netlify.toml` if needed.

3. ENGINE MODULES under `src/engine/` (all pure functions, no I/O imports):
   - `index.ts` (public API, re-exports recommend and types, IIFE entry point)
   - `zscore.ts` (Z and G score, league-aware Q pool)
   - `teamFit.ts` (need vector, fit_bonus dot product, alpha schedule)
   - `recommend.ts` (composes scoring, fit, position constraints, returns RankedPlayer[])
   - `explain.ts` (builds structured payload for Claude; does NOT call the API)
   - `constants.ts` (regression weights, kappa for G-score, alpha schedule, all magic numbers)
   - `projectionSource.ts` (interface + EspnFromState impl reading from S-shaped input)
   - `marcel.ts` (STUB for Phase 1; throws "not implemented" or delegates. Real impl in Phase 1.5)
   - `minutes.ts` (STUB for Phase 1, same pattern)
   - `prompts/coach.v1.md` (Claude prompt template, plain text)

4. TYPES in `src/shared/types.ts`:
   - `Category` = "REB" | "AST" | "STL" | "BLK" | "PTS" (this exact order)
   - `CategoryVector` = Record<Category, number>
   - `PlayerProjection` (id, name, team, position, gamesRemaining, perGame: CategoryVector, injuryStatus)
   - `RosterContext` (myPlayers, leaguePlayers per team)
   - `LeagueContext` (size, scoringPeriod, currentMatchup, allCategories)
   - `RecommendationContext` (roster, league, projectionSource, mode: "draft" or "in-season")
   - `Breakdown` (gScore, alpha, fitBonus, final, why: string[], categoryDeltas: CategoryVector, projection, confidence)
   - `RankedPlayer` (player + breakdown)
   - `EngineOutput` (ranked, teamNeeds, meta)

5. ENGINE MATH:
   - Z-score: standard formula, mean and stdev over Q pool.
   - Q pool: top N=12*rosterSize by first-pass z, iterate twice.
   - G-score: Rosenof denominator `var_acrossPlayers + kappa * var_weekToWeek`. kappa = 1.0 default in constants. Document that empirical kappa per category gets tuned in Phase 7 backtest.
   - Team-need vector: `need[c] = (leagueAvgPerTeam[c] - myRosterPerTeam[c]) / leagueStdevPerTeam[c]`. Negative = surplus, positive = need.
   - Fit bonus: `fit_bonus[player] = sum over c of need[c] * playerZ[c]`.
   - Alpha (in-season): base = 0.3 default. Do NOT try to detect leverage in Phase 1.
   - Final: `final = gScore + alpha * fit_bonus`.
   - Position constraints: light penalty if all roster slots for a position are filled. Document penalty value in constants.
   - Filter injured players (OUT, SUSPENSION, IR) from output. Per CLAUDE.md: never recommend injured players.
   - Output: ranked list with full breakdowns.

6. NETLIFY FUNCTION `netlify/functions/recommend-explain.ts`:
   Netlify compiles TS functions natively, so use TS here.
   - Accepts POST body with top 5 RankedPlayer objects + team-need vector.
   - Calls Claude via existing pattern (read ANTHROPIC_API_KEY from env, POST to api.anthropic.com/v1/messages).
   - Loads coach.v1.md prompt as a string.
   - Returns `{ rationale: string }` with a 2-sentence rationale referencing the user's biggest need and how the top recommendation fills it.
   - Reuse CORS pattern from `netlify/functions/larry-chat.js`.

7. INTEGRATE WITH LEGACY ENGINE:
   In `js/engines.js`:
   - Add feature flag `Engines.useV2` (default false).
   - When useV2 is true, Engine 4 recommendations() builds a context object from the S object (S.players filtered to FAs, S.myTeam.roster, S.teams for league averages, S.league.size for Q pool size) and calls `window.LarryEngine.recommend(ctx)`.
   - After the deterministic engine returns, fetch `/api/recommend-explain` with the top 5 + team needs and merge the rationale into the recommendation cards.
   - When useV2 is off, current behavior is unchanged.
   - Add a hidden settings toggle to flip useV2. Plain checkbox under a "Beta" section. No UI redesign in this phase.

8. TESTS in `tests/engine/`:
   - `zscore.test.ts`: golden fixture proving Z and G differ for high-variance vs low-variance categories. 10-team and 12-team produce different orderings on the same pool.
   - `teamFit.test.ts`: golden fixture proving need vector flips when roster strengths flip.
   - `recommend.test.ts` (HEADLINE TEST): two different rosters in the SAME league with the SAME Lock/Target/Punt strategy classification (e.g. both classified Punt-BLK) get MATERIALLY different top 5. Materially = at least 2 different players in positions 1 to 5. This proves the new engine has finer-grained signal than the existing buckets.
   - `recommend.test.ts` second test: a roster strong in REB and AST but weak in PTS and BLK gets recommendations systematically high in PTS or BLK in the top 5. Use a synthetic player pool with clean category profiles.
   - All tests pass via `npm test`.
   - `npx tsc --noEmit` passes.

9. VERIFY ON REAL DATA:
   - Take a snapshot of my own S object (export from localStorage in DevTools, save to `tests/fixtures/users/cliff-real-roster.json`. Add to .gitignore. Do NOT commit.)
   - Run a manual verification script `tools/manual-verify.ts` that loads the snapshot, runs LarryEngine.recommend, and prints: my top 5 needs, the top 5 recommended players, the breakdown for each.
   - Compare side by side with v1 Engine 4 output.
   - Report findings to me before committing. Specifically: (a) does v2 top 5 differ from v1, (b) does the rationale match a category my team is actually weak in, (c) any failures (negative MPG, players already on my roster, injured players surfacing).

10. CACHE BUST AND DEPLOY READINESS:
    - Bump CACHE_VERSION in sw.js per CLAUDE.md.
    - Confirm index.html loads dist/larry-engine.js as a script tag (since it's IIFE, not ES module).
    - Run the full Testing Checklist from CLAUDE.md (node --check, ASCII grep, npm test, tsc --noEmit, file references match).
    - Do NOT merge to main. Push the feature branch.

11. STOP. Final commit. Do not proceed to Phase 1.5 or Phase 2.

DONE WHEN:
- Build pipeline produces dist/larry-engine.js without errors.
- All engine modules under src/engine/ exist, are pure, are typed.
- src/shared/types.ts exists and is used.
- Headline test (two rosters, same strategy bucket, materially different top 5) passes.
- Category-fit test (REB+AST-strong roster gets PTS+BLK-heavy recs) passes.
- /api/recommend-explain returns a 2-sentence rationale referencing real categories.
- v2 feature flag in js/engines.js works; v1 default unchanged.
- My personal roster snapshot produces a v2 top 5 that differs from v1 and references a real weak category.
- All Testing Checklist items from CLAUDE.md pass.
- Final commit `feat(phase-1): bespoke recommendation engine with G-score and team-fit blend` on feature/phase-1-engine and pushed.

Confirm to me when each numbered task is complete before moving to the next. Do not silently make decisions.
```

### Phase 1.5 prompt, Marcel projection model

To be drafted before starting Phase 1.5. Ping Claude (in chat, not Claude Code) when Phase 1 is merged and you're ready to start. The plan section above outlines the scope; the full prompt with task-level detail comes when you're ready.

### Future phase prompts

Phase 2 through Phase 7 prompts will be drafted as each phase becomes active. Same pattern as Phase 1: branch from `dev` as `feature/phase-N-name`, ground rules, numbered tasks, "Done when" criterion, final commit message.

---

*Last updated: when Phase 0 was complete and Phase 1 became active. Update the version note when phases ship.*
