# Larry: Complete Improvement Plan
*A repo-aware redesign for a hobbyist-built, Netlify-hosted, mobile-first ESPN H2H 5-cat fantasy basketball app*

---

## How to use this document

This is a roadmap, **not** a single prompt for Claude Code. Work through it phase by phase, in order. Reference this file from every Claude Code session so context stays consistent.

### Workflow discipline (read this before starting)

1. **Commit after every phase.** No exceptions. Each phase below has a `Commit:` instruction. Stop and commit before moving on. If a phase takes more than one session, commit at the end of each session with a clear message (`wip(phase-1): marcel projection working`).
2. **Branch per phase.** Use `feat/phase-0-audit`, `feat/phase-1-engine`, `feat/phase-2-cookies`, etc. Merge to `main` only after the phase's "Done when" criterion is verified. This gives you a safe rollback point if a later phase breaks something.
3. **One phase per Claude Code session.** Don't combine phases. The context bloat hurts quality and makes mistakes hard to trace.
4. **Verify "Done when" before moving on.** Each phase has a concrete success criterion. If it isn't met, do not start the next phase.
5. **Tests live in the same commit as the code they test.** Don't push code without tests, then "add tests later." Later never comes.
6. **If Claude Code suggests something that contradicts this plan, pause.** Sometimes the plan is wrong (the repo doesn't match my prescriptive paths); sometimes Claude Code is taking a shortcut. Reconcile in `PLAN_RECONCILED.md` (created in Phase 0), don't just go with whichever feels easier.

---

## TL;DR

- **The "same suggestions for every user" bug is almost certainly a missing-input problem, not a model problem.** Fix it by passing each user's roster, league cookies, current matchup, and category needs into the recommendation function — then layering a Marcel projection → z-score (per league) → team-fit blend → Claude rationale pipeline behind a single deterministic `/api/recommend` endpoint. That single change will produce bespoke output without rewriting the UI.
- **The cookie-pasting pain on iPhone Safari cannot be fully eliminated, but it can go from ~10 minutes to ~30 seconds with a `javascript:` bookmarklet** that reads `document.cookie` on `fantasy.espn.com`, base64-encodes the SWID/espn_s2 pair, and opens `https://larry.app/link?token=…` — both cookies are NOT marked HttpOnly by ESPN, so JS access works. Bookmarklets still run in iOS Safari 17/18 (Apple did not ban them; the workflow is just clunky). Provide a "Connect ESPN" page with a one-tap "Add to Bookmarks" flow plus an iOS Shortcut as a fallback. A Chrome/Edge extension is the right answer for desktop power users.
- **Stay on Netlify, but commit to a clear backbone:** Netlify Functions + Netlify Scheduled Functions (nightly Marcel re-projection at 5:00 UTC) + Netlify Blobs for projection JSON snapshots and per-user encrypted cookie storage + Turso/libSQL (or Supabase Postgres if you prefer) for relational data (users, leagues, picks, draft state). Add Claude API only at the explanation layer — never inside the ranking loop — so the engine is deterministic, cheap, and testable, and Larry's "voice" sits on top.

---

## Important note on repo access

The research that produced this plan could not directly fetch the GitHub repo. The recommendations below are written to be **structurally specific to the architecture you described** (Netlify deploy, Claude API, ESPN cookie auth, tab bar with Roster/Matchup/Players/Larry/League, hobbyist Claude-Code workflow on Windows) rather than to literal file paths. Wherever a file is named (e.g. `netlify/functions/recommend.ts`), treat it as a **prescriptive target path** for Claude Code to create or rename to, not a claim that the file exists today. The first task in Phase 0 below is a 30-minute repo audit script you (or Claude Code) should run to map current paths to the prescribed ones.

---

## Key Findings

1. **Root cause of "same suggestions for everyone" is almost certainly one of three things, in order of likelihood:**
   - (a) The recommendation endpoint takes only league-level inputs (league id, scoring) and not the calling user's `teamId`, current roster, or category standings — so every user in the same league gets the same list.
   - (b) Recommendations are cached at the league or global level (e.g., a Netlify Blob keyed only on `leagueId`) and served back to all users.
   - (c) The "engine" is actually a single Claude prompt with hard-coded examples and no structured roster context, so the LLM defaults to generic top-available advice.
   
   The fix in all three cases is the same: a deterministic ranking core that consumes a typed `RecommendationContext` (user roster + matchup + league settings + remaining FAs/draft pool), and a thin Claude layer that only narrates the deterministic output.

2. **ESPN's `espn_s2` and `SWID` cookies are NOT set with `HttpOnly`.** Multiple Chrome/Firefox extensions ("ESPN Cookie Finder," GameDayBot's helper, Flock Fantasy sync) all read these cookies via `chrome.cookies` or content scripts that touch `document.cookie` — which is only possible because the flag isn't set. This is the single most important technical fact for the cookie-setup redesign: **a bookmarklet on `fantasy.espn.com` can read both values directly with `document.cookie`.**

3. **Bookmarklets DO still work in iOS Safari (16, 17, 18).** The "Apple banned bookmarklets" claim that circulates in old Apple Community threads is incorrect — what changed is that the *creation* flow is clunky (you can't drag-drop on iPhone, you must edit a saved bookmark and replace its URL with `javascript:…`). Once installed, tapping a Favorites-bar bookmarklet on `fantasy.espn.com` runs the JS on that page.

4. **Web Share Target API cannot solve this problem.** `share_target` only receives `title`, `text`, `url`, or files — never cookies. iOS also does not honor `share_target` at all (it's Android/Chrome/Edge only). Cross it off the list.

5. **iframes cannot solve this either.** ESPN sets `X-Frame-Options: SAMEORIGIN` on fantasy.espn.com, and even if it didn't, same-origin policy would block reading the iframe's cookies. Cross it off.

6. **iOS Shortcuts can run "Run JavaScript on Web Page" against a Safari tab,** which is a legitimate alternative path for the most determined users — but distribution is awkward (you publish a `.shortcut` iCloud link). Treat it as a **secondary** recovery path.

7. **Netlify Scheduled Functions are GA and free up to credit cap** (cron-syntax, JS/TS native, runs only on published deploys, max 30s for synchronous and longer for background). They are the correct primitive for the nightly Marcel rebuild — no GitHub Actions cron needed unless you outgrow Netlify's runtime ceiling.

8. **Netlify Blobs is the right home for projection snapshots, ranking tables, and encrypted cookie blobs** (free tier during/after beta, ~5 GB per object, 600-byte key limit, eventual consistency by default with strong consistency available). It is wrong for relational data like users ↔ leagues ↔ picks; for that, prefer **Turso (libSQL/SQLite at the edge)** or **Neon serverless Postgres** — both have generous free tiers and 0-config Netlify integrations. **Supabase** is fine if you also want auth, but adds weight you may not need.

9. **Z-scores are the industry standard for category leagues; G-scores (Rosenof, arXiv 2307.02188) are strictly better for H2H** because they account for week-to-week variance — particularly relevant for steals and blocks, which Z over-weights. For your 5-cat H2H league, the right scoring metric is **G-score**, not raw Z.

10. **Marcel for basketball is straightforward** but Larry needs an explicit "minutes projection" step (last 30 days weighted heaviest) layered on top of the standard 5/4/3 weighting of the prior three seasons, otherwise role changes (rookies, injuries, trades) will be badly missed.

---

## Part 1 — Repository Review (prescriptive)

### Likely current architecture

- Frontend: a single-page React or Vue app (or vanilla + HTMX) served from Netlify, with a bottom tab bar (Roster, Matchup, Players, Larry, League).
- Backend: Netlify Functions in `netlify/functions/*.ts` or `*.js` proxying ESPN's private league APIs at `https://lm-api-reads.fantasy.espn.com/apiv3/games/fba/seasons/{year}/segments/0/leagues/{leagueId}` with the user's `espn_s2` and `SWID` attached as `Cookie:` header.
- Storage: probably localStorage for cookies (a security smell — see below) and Netlify env vars for secrets like `ANTHROPIC_API_KEY`.
- Claude: a single function (likely `netlify/functions/larry.ts` or `chat.ts`) that POSTs to `https://api.anthropic.com/v1/messages` and pipes the response back.

### What "good" looks like after the refactor (target tree)

```
larry/
├── netlify.toml
├── netlify/
│   └── functions/
│       ├── espn-link.ts            # receives bookmarklet POST, encrypts cookies, stores
│       ├── espn-proxy.ts           # internal: read-only ESPN reads with user cookies
│       ├── recommend.ts            # main per-user recommendation endpoint
│       ├── projections-rebuild.ts  # SCHEDULED: nightly Marcel + z/g rebuild
│       ├── matchup.ts              # weekly matchup + projected category margins
│       ├── trade.ts                # trade analyzer
│       └── chat.ts                 # Claude rationale wrapper
├── src/
│   ├── engine/
│   │   ├── marcel.ts               # projection model
│   │   ├── minutes.ts              # minutes/role projection
│   │   ├── zscore.ts               # league-aware z & g scores
│   │   ├── teamFit.ts              # category-need bonus, alpha schedule
│   │   ├── recommend.ts            # composes ranking + fit + tie-breaks
│   │   └── explain.ts              # builds Claude prompt from deterministic output
│   ├── data/
│   │   ├── espn.ts                 # ESPN client (cookie-auth)
│   │   ├── nba.ts                  # NBA stats source (gamelogs, schedule)
│   │   └── cache.ts                # Netlify Blobs wrapper
│   ├── db/
│   │   └── schema.sql              # Turso/Postgres tables
│   ├── ui/
│   │   ├── tabs/{Roster,Matchup,Players,Larry,League}.tsx
│   │   ├── components/RecCard.tsx  # the bespoke recommendation card
│   │   └── onboarding/EspnLink.tsx
│   └── shared/
│       ├── types.ts                # RecommendationContext, ProjectionRow, etc.
│       └── crypto.ts               # AES-GCM helpers for cookie at-rest encryption
├── public/
│   ├── bookmarklet.html            # install page
│   └── manifest.webmanifest        # PWA basics
└── tests/
    ├── engine/marcel.test.ts
    ├── engine/zscore.test.ts
    ├── engine/recommend.test.ts
    └── golden/*.json               # backtest fixtures
```

### Code-quality observations to verify in the audit

- TypeScript on/off: if currently JavaScript, **migrate to TypeScript** with `strict: true`. With Claude Code as the developer, types are a force multiplier — they let Claude verify call sites without re-reading the whole codebase.
- Cookie storage: if `espn_s2` is in `localStorage` or a non-HttpOnly Larry cookie, that's the #1 security issue. See Part 4.
- Single function doing everything: very likely there is one mega-function (e.g., `larry-api.js`) handling ESPN reads, ranking, AND Claude. Split it.
- Claude prompts inline in handlers: move every prompt to `src/engine/explain.ts` so they're versionable and testable.

---

## Part 2 — Engine Integration Plan

### 2.1 The deterministic recommendation pipeline

```
              ┌────────────────────────────────────────────────────────┐
nightly cron──►│ projections-rebuild.ts (Netlify Scheduled Function)    │
              │  1. pull NBA gamelogs (last 3 seasons + current YTD)   │
              │  2. minutes model → projected MPG                       │
              │  3. Marcel: 5/4/3/season-blend per-36 → per-game        │
              │  4. compute league-agnostic z-scores (5-cat)            │
              │  5. write Blob: projections/{date}.json (and latest)   │
              └────────────────────────────────────────────────────────┘
                              │
                              ▼   (Blob read, ~10ms)
per request──► recommend.ts ──► load latest projections
                              ──► load user roster + league settings (Turso)
                              ──► load current matchup category state
                              ──► engine/recommend.ts:
                                   • G-score per remaining FA / draft pool
                                   • category-need vector vs current roster
                                   • team-fit bonus = α·(need · z_player)
                                   • α schedule: draft round-dependent OR
                                     in-season matchup-leverage-dependent
                                   • final = Gscore + α·fit
                              ──► engine/explain.ts → Claude (only top 3-5)
                              ──► return { ranked: [...], rationale: "..." }
```

### 2.2 Marcel for basketball (`src/engine/marcel.ts`)

Standard Marcel is `(5·Y0 + 4·Y-1 + 3·Y-2)/12`, regressed toward league mean with weight `~1200 PA` for baseball; for basketball, regress toward position-mean per-36 stats with a regression weight of roughly **600 minutes** for counting stats (rebounds, assists, points) and **800 minutes** for blocks/steals (noisier). Then multiply by projected minutes from the minutes model.

```ts
// src/engine/marcel.ts (sketch)
export function marcelPer36(history: SeasonStats[], leaguePositionMean: PositionMean): Per36 {
  const w = [5, 4, 3];
  const totalWeight = history.slice(0, 3).reduce((s, _, i) => s + w[i], 0) || 1;
  const blended = blendStats(history.slice(0, 3), w, totalWeight); // weighted mean per-36
  const ageAdjust = ageAdjustment(history[0]?.age, history[0]?.position);
  return regressToMean(blended, leaguePositionMean, REG_WEIGHT, ageAdjust);
}
```

The minutes model (`src/engine/minutes.ts`) should: (1) start from last 30 days when available, (2) fall back to projected role from depth chart inputs, (3) zero out for known injured/suspended players from a daily news cache.

### 2.3 G-score over Z-score (`src/engine/zscore.ts`)

Implement both, default to G. Per Rosenof (2023), G-score divides by a denominator that includes weekly variance from the player set Q, which is what makes H2H formats reward high-floor over high-ceiling players. For your 5-cat (PTS/AST/REB/STL/BLK):

```
score(stat, player, Q) =
  (proj[stat][player] - mean(Q, stat)) /
  sqrt( var_acrossPlayers(Q, stat)  +  κ · var_weekToWeek(stat) )
```

Compute Q as the top N=12·rosterSize players by a first-pass z-score, then iterate twice (Q stabilizes quickly). This is league-aware: 10-team and 12-team leagues get different Qs and therefore different rankings, which directly addresses the "same recs for everyone" complaint.

### 2.4 Team-fit bonus and α schedule (`src/engine/teamFit.ts`)

```
need[c]   = max(0, leagueAvg[c] - myRoster[c])  // per category, normalized
fit_bonus = Σ_c need[c] · z_player[c]           // dot product
final     = G_player + α(round, matchup) · fit_bonus
```

- **Draft mode:** `α(round) = clamp(0.05·round, 0.0, 0.6)` — early rounds prioritize BPA, later rounds prioritize fit.
- **In-season mode:** `α(matchup) = base + leverage`, where `leverage` rises if the user is within 1 category of winning/losing the week. This is the primary lever that makes recommendations *bespoke* to matchup state.

### 2.5 Where Claude fits (`src/engine/explain.ts`)

Claude **never sees the player pool** and **never ranks**. It receives a structured JSON payload:

```json
{
  "user": "fred",
  "context": "draft, round 7, league 12-team H2H 5cat",
  "topK": [
    {"player":"Naz Reid","gScore":+0.82,"fitBonus":+0.34,
     "categoryDeltas":{"REB":+0.21,"BLK":+0.18,"PTS":-0.05}}
  ],
  "myRosterNeeds": {"REB":+0.6,"BLK":+0.4,"AST":-0.2}
}
```

Prompt: "You are Larry. Explain in 2 sentences why the top recommendation fits this user's roster *right now*. Use the categoryDeltas. Do not invent stats." This keeps Claude bills tiny (~300 tokens/request), keeps recs deterministic and testable, and stops Larry from hallucinating.

### 2.6 Migration plan that doesn't break existing features

**Phase A (parallel run, ~3 days):** Add `/api/recommend?engine=v2` as a new function. Keep the old endpoint live. Add a hidden toggle in the Larry tab to switch engines. Diff outputs locally for your own roster.

**Phase B (~2 days):** Once v2 looks right for ≥5 sample rosters, flip the default. Leave `?engine=v1` as a one-week safety net.

**Phase C:** Delete v1. Remove dead code paths.

### 2.7 Netlify pipeline architecture (decision)

- **Scheduled Functions for nightly rebuild** — chosen over GitHub Actions cron because (a) the data lives next to the code, (b) you avoid maintaining a second secrets store, (c) you keep a single deploy artifact. Use cron `0 9 * * *` (5 AM ET / 9 UTC, after all NBA games are final).
- **Background Functions** for ad-hoc trade-analyzer simulations that may exceed 10s.
- **GitHub Actions** only as a safety-net "ping" if you ever see Scheduled Functions miss runs (it has historically had ±1 min jitter — fine for a daily projection, irrelevant for fantasy).

### 2.8 Database recommendation (decision)

- **Turso (libSQL)** for relational data: users, linked leagues, encrypted cookie blobs, draft sessions, recommendation history. Free tier is generous (5GB, 9B row reads/mo at last check), latency is excellent from Netlify Functions, and the SQLite mental model fits a hobbyist solo project. Driver: `@libsql/client`.
- **Netlify Blobs** for the nightly projections snapshot (`projections/latest.json`), ranking tables per league size, and per-user explanation cache (60-min TTL). Use **strong consistency** for the latest projections key so Scheduled Function writes are immediately visible to Functions.
- **Avoid Supabase** unless you want auth + Postgres + RLS as a bundle; the added concept count isn't worth it for a solo hobbyist. **Avoid Neon** unless you have a strong Postgres preference; it's also fine but Turso is closer to "zero-config."

### 2.9 Determinism and explainability

Every recommendation response should carry a `breakdown` array:

```json
{ "player":"Naz Reid","gScore":0.82,"alpha":0.45,"fitBonus":0.34,
  "final":0.97,"why":["+REB","+BLK"],"projection":{},"confidence":0.71 }
```

This is what you render in the UI (Part 3) and what Claude paraphrases. It is also what you write to a `recommendations` table for backtesting.

---

## Part 3 — UX Improvements

### 3.1 Tab bar refinements

- **Rename "Larry" tab → "Coach"** (or keep "Larry" as the brand but label the tab "Coach"). Users don't know what "Larry" does until they tap; "Coach" telegraphs purpose.
- **Reorder: Coach | Matchup | Roster | Players | League.** "Coach" first because that's the differentiating value; "League" last because it's reference, not action.
- **Add a global "?" affordance in the header** that opens a contextual help sheet explaining the current screen in 1 sentence.

### 3.2 The Coach tab (the new recommendation surface)

Each recommendation should be a **card** with:

1. Player name, team, position, projected MPG (last 14d).
2. A horizontal **5-category bar chart** showing the player's z-score per cat, color-graded.
3. **Two badges:** the "BPA" badge (G-score rank) and the "Fit" badge (fit_bonus rank for *your* roster).
4. **One-sentence Larry rationale** (the Claude output).
5. A "Why?" expand that reveals the numeric breakdown (gScore, alpha, fitBonus, categoryDeltas) — this is the explainability surface and builds trust.
6. Action buttons: **Add (waivers)**, **Compare**, **Mute** (so Larry stops suggesting this player).

### 3.3 Matchup tab — make leverage visible

Show the current week's category margins as a 5-row strip: green if winning, red if losing, with the **projected end-of-week delta** to the right (rest-of-week games × proj per-game). The Coach tab should auto-filter to "players who help close the red rows."

### 3.4 Roster tab

- **Per-category strength bars** vs. league average (this directly visualizes "team needs").
- Tag players with a "punt candidate" pill if dropping them would push the user from contender to leader in 4 of 5 cats.
- "Trade up/down" affordance on each player → opens trade analyzer.

### 3.5 Players tab

- Default sort: **G-score for your league** (not ESPN ADP).
- Filters: punt FT% / punt AST / etc.
- Each row shows mini sparkline of last 10 games' fantasy value.

### 3.6 Onboarding flow

**Today:** new user opens app → blank state → form for SWID + espn_s2 → confusion.

**Target flow:**

1. Welcome screen ("Larry helps you win your H2H 5-cat league. We need read-only access to your ESPN league.")
2. Big primary button: **"Connect ESPN"** → routes to `/connect` page (Part 4).
3. While cookies are processing, show a 4-step animated checklist: (a) Cookies linked, (b) League found, (c) Roster loaded, (d) Larry ready.
4. After link, immediately drop the user on the Coach tab with their first 3 personalized recommendations.

### 3.7 Loading & empty states

- **Loading**: skeleton cards (not spinners) for every tab; preload next likely tab on idle.
- **Empty**: never blank. If no recs yet, say "Larry's still pulling your league. This usually takes 5 seconds." with a progress indicator pulled from a `/api/status` endpoint.
- **Error**: explicit "Cookie expired — Reconnect ESPN" CTA, never a generic "something went wrong."

### 3.8 Reasoning visualization

On the Coach tab, add a header strip: **"Your team needs: REB ↑, BLK ↑, FT% ↓"** computed from the same need[] vector that drives the engine. This is the user-visible proof that recommendations are bespoke.

---

## Part 4 — Cookie Setup Flow (the critical fix)

### 4.1 Decision summary

- **Primary path:** a `javascript:` bookmarklet that runs on `fantasy.espn.com`, reads `document.cookie`, and POSTs to Larry. Works on iOS Safari, Android Chrome, desktop Chrome/Firefox/Safari/Edge.
- **Power-user path:** a Manifest V3 Chrome/Edge extension (~50 lines) for one-click connect on desktop, plus optional Firefox add-on.
- **Recovery path:** an iOS Shortcut that runs the same JS via "Run JavaScript on Web Page."
- **Always available:** the existing manual paste box, kept as a fallback.

### 4.2 Why the bookmarklet works (and the security model)

ESPN sets `espn_s2` and `SWID` *without* the `HttpOnly` flag — confirmed by every existing third-party tool that reads them. That means `document.cookie` on `fantasy.espn.com` returns both values. Same-origin policy means Larry's own JS at `larry.app` cannot read those cookies — only code running on `fantasy.espn.com` can — which is exactly what a bookmarklet does (it executes in the context of the currently loaded page).

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
    location.href = "https://larry.app/link?token=" + encodeURIComponent(payload);
  } catch (e) { alert("Larry Link error: " + e.message); }
})();
```

Notes:

- **Why redirect, not `fetch()`:** an XHR/`fetch()` from `fantasy.espn.com` to `larry.app` is a cross-origin call without CORS pre-approval, so it will fail. Using `location.href` to navigate the same tab to a Larry URL with the encoded token in the query string is the most reliable cross-browser approach. Larry's `/link` page extracts the token, immediately POSTs it to `/api/espn-link` (same origin, no CORS issue), and clears the URL.
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
import { decryptKey, encrypt } from "../../src/shared/crypto";
export default async (req, ctx) => {
  const { token } = await req.json();
  const { s2, swid, ts } = JSON.parse(atob(token));
  if (Date.now() - ts > 5 * 60_000) return new Response("expired", { status: 400 });
  const userId = await requireSession(req);              // your own session (cookie or magic link)
  const enc = await encrypt({ s2, swid }, process.env.LARRY_KMS_KEY);
  await getStore("espn-cookies").set(userId, enc);       // or write to Turso
  return new Response("ok");
};
```

### 4.6 Security implications and mitigations

- **At rest:** Encrypt the cookie pair with AES-GCM using a key stored in Netlify env vars (`LARRY_KMS_KEY`). Never log raw cookies. Store only ciphertext in Blobs/Turso.
- **In transit:** HTTPS everywhere (Netlify default); the `token` is in a URL fragment for ~200ms before being stripped — acceptable for a hobbyist app, but for extra safety use the URL fragment (`#token=…`) instead of query string so it never hits Netlify access logs.
- **Scope:** Larry should only ever do *read* operations against ESPN; document this. Add a per-request kill switch (`COOKIE_KILL_SWITCH=1`) that purges all stored cookies if you ever need to.
- **Rotation:** ESPN cookies last ~1 year but rotate when users change their password. Detect 401s from ESPN and prompt the user to reconnect; never silently fail.
- **Deletion:** Add an explicit "Disconnect ESPN" button in Settings that DELETEs the blob and revokes the session.
- **Bookmarklet trust:** Publish the source on `https://larry.app/bookmarklet.html` with the JS shown plain-text so users can read what it does before adding. This is a hobbyist-credibility requirement.

### 4.7 Why the alternatives don't work (and stay rejected)

- **PWA Web Share Target:** receives only `title`/`text`/`url`/files. Cookies cannot be shared via OS share sheet. Cross off.
- **iframe of espn.com:** blocked by `X-Frame-Options: SAMEORIGIN` and same-origin policy even if it weren't. Cross off.
- **OAuth/redirect:** ESPN does not offer a public OAuth flow for fantasy data. Cross off.
- **iOS Share Extension:** requires native app + App Store distribution. Outside your hobbyist scope.

### 4.8 The iOS Shortcut fallback (one-page recipe)

Provide a downloadable Shortcut at `larry.app/ios-shortcut` containing:

1. "Get URLs from input" → restrict to `*.espn.com`.
2. "Run JavaScript on Web Page" → paste the same bookmarklet code (without the `javascript:` prefix).
3. "Open URLs" → opens the resulting `larry.app/link?token=…`.

This gets installed via an iCloud share link in 2 taps and shows up in Safari's Share Sheet on every page — which is the closest thing iOS gives you to a bookmarklet shortcut.

### 4.9 The desktop browser extension (small Manifest V3)

For desktop users this is genuinely one click. Total surface area: a `manifest.json` with `"permissions":["cookies"]`, `"host_permissions":["*://*.espn.com/*"]`, a popup with one button that calls `chrome.cookies.get({url:"https://fantasy.espn.com", name:"espn_s2"})` and posts to Larry. ~50 LOC. Distribute on Chrome Web Store ($5 one-time) and Firefox Add-ons (free). This is a Phase 2 effort, not Phase 1.

### 4.10 Onboarding copy that ties it together

On the Connect screen, show three options as cards in this order:

1. **iPhone / iPad** → "Add Larry Link to your bookmarks" (animated GIF showing the install flow), with the JS source visible underneath.
2. **Computer** → "Install the Chrome extension" (when ready) OR "Drag this button to your bookmarks bar."
3. **Manual (Power User)** → the existing paste form.

---

## Part 5 — Code Quality

### 5.1 TypeScript first

If the repo is JS, migrate. With Claude Code as your pair programmer, types eliminate a class of bugs Claude would otherwise introduce when refactoring. Set `"strict": true`, `"noUncheckedIndexedAccess": true`. Add `tsx`/`tsup` for function bundling.

### 5.2 Module boundaries (enforced)

- `src/engine/*` must not import from `src/data/*` or `src/ui/*`. Engine is pure functions over typed inputs. This is what makes it unit-testable and what lets you backtest.
- `netlify/functions/*` is the only place that touches I/O (network, blobs, db). Functions compose engine + data; they do not contain business logic.
- `src/ui/*` only consumes typed responses from functions; it never recomputes ranks.

### 5.3 Testing — what to write first (in this order)

1. **`engine/marcel.test.ts`** with golden fixtures for 5 known players (e.g., 2023 LeBron, 2023 Wemby rookie, a punt build target). If Marcel output for these doesn't match within tolerance, fail.
2. **`engine/zscore.test.ts`** verifying that league size affects rankings (10-team vs 12-team produces measurably different orders).
3. **`engine/recommend.test.ts`** verifying that **two different rosters in the same league get different top 3.** This is your regression test for the original bug.
4. **`functions/espn-link.test.ts`** mocked, verifying token expiry and encryption round-trip.
5. End-to-end: a Playwright script that spins up Netlify Dev, hits `/api/recommend` with two different mock users, and asserts non-identical responses.

### 5.4 Error handling and observability

- Wrap every Netlify function with a `withTelemetry()` higher-order function that logs `userId`, function name, duration, and error code.
- Use Netlify Log Drains (Pro) or just stdout + a daily Blob log file for hobbyist budget.
- Add `Sentry` (free tier) for the React app; it pays for itself the first time an iPhone user reports a vague bug.

### 5.5 Refactors to do explicitly

- Replace any `localStorage.setItem("espn_s2", …)` with the encrypted server-side blob flow.
- Replace any inline Claude prompt strings with versioned prompt files in `src/engine/prompts/` (e.g., `coach.v3.md`).
- Replace any "magic" numbers (regression weights, alpha schedule) with a single `src/engine/constants.ts` so backtests can sweep them.

---

## Part 6 — Feature Suggestions

### 6.1 Keep, simplify, or remove (per current tab bar)

- **Roster** — keep. Add per-category strength visualization and punt-candidate badges.
- **Matchup** — keep, elevate. Add projected end-of-week deltas; this is one of the highest-leverage screens for an H2H league and is currently probably underbuilt.
- **Players** — keep but **rip out ESPN's default ordering**. Sort by Larry's G-score for the user's league size. Add punt filters.
- **Larry** — rename to **Coach**, repurpose as the home of bespoke recommendations. The chat affordance can stay as a sub-tab inside Coach.
- **League** — keep but make it lightweight. Just power rankings + a "schedule strength" chart for the rest of the season. If it's currently more than that, simplify.

### 6.2 New features that pull weight (priority-ordered)

1. **Trade Analyzer** (`/trade`) — given proposed trade, recompute G-scores + matchup deltas before/after for both teams, with a verdict + Larry rationale. The single most-requested feature by H2H users.
2. **Schedule Analyzer** — for a given upcoming week, project category margins for every matchup, with rest-adjusted MPG and B2B impact. This sells your engine's value in the way Basketball Monster does.
3. **Punt Build Helper** — interactive "punt FT% / punt AST / punt TO" toggles on the Players tab that re-rank in real time; this is core to H2H 5-cat strategy.
4. **Injury & news alerts** affecting your roster only (use ESPN's news endpoints + a `news` Netlify Blob updated nightly). Push via web push to PWA.
5. **Draft Mode** — a separate route `/draft/{leagueId}` with a real-time draft board, your queue, and round-aware α. This is a *must* for the user's stated use case and requires a different UI than in-season.
6. **Streamer planner** — given the upcoming 7 days, who to add/drop for max games played in your weak categories. Targets the highest-leverage in-season decision.

### 6.3 Premium / power features (Phase 3+)

- Projection comparison vs. Hashtag, Rotowire, FantasyPros (paste-in import).
- "Larry's confidence" score on each rec, learned from previous weeks (post-hoc check: did the recommended add actually outperform the alternatives?).
- League-wide power rankings with playoff probability via Monte Carlo.

### 6.4 Features to actively NOT build

- Daily fantasy (DraftKings/FanDuel) — different problem, different model.
- Live game tracking — ESPN already does this, you can't beat them on it.
- Multi-sport — stay focused on basketball; the engine assumptions don't transfer cleanly.

---

## Part 7 — Concrete Roadmap

> **Discipline reminder:** Branch per phase (`feat/phase-N-name`). Commit at the end of every phase. If a phase spans sessions, commit at the end of each session with a `wip(phase-N):` prefix. Merge to `main` only after the phase's "Done when" criterion is verified. **Do not skip the commit step.**

### Phase 0 — Audit & TypeScript baseline (1 evening, ~3h)

- **Branch:** `feat/phase-0-audit`
- Run `tree -I node_modules` and paste the output into a `REPO_MAP.md` so Claude Code can plan against real paths.
- Reconcile every prescriptive path in `LARRY_PLAN.md` to actual paths in `PLAN_RECONCILED.md`.
- Migrate to TypeScript (`tsc --init`, rename `.js` → `.ts`, fix the easy errors, allow `// @ts-expect-error` for the rest).
- Add `vitest`, write one trivial passing test to prove CI works.
- Add Netlify build status badge to README.
- **Commit:** `chore(phase-0): repo audit, TypeScript migration, vitest baseline`. Merge to main. Tag as `v0.1.0-phase0`.

### Phase 1 — Bespoke recommendations (the headline fix) (~1 weekend, ~10h)

- **Branch:** `feat/phase-1-engine`
- **Files:** create `src/engine/{marcel,minutes,zscore,teamFit,recommend,explain}.ts`; create `netlify/functions/recommend.ts` and `netlify/functions/projections-rebuild.ts`.
- **Steps:**
  1. Implement Marcel + minutes + Z over a static seed dataset (one season of NBA gamelogs from `nba.com/stats` JSON or a Kaggle dump, committed to the repo for reproducibility).
  2. Wire `recommend.ts` to take `userId` → fetch roster → compute ranking. **Add the regression test that two users get different top 3.**
  3. Wire Claude into `explain.ts` for the top 3 only.
  4. Replace the existing Coach-tab data source with `/api/recommend?engine=v2`.
  5. Schedule `projections-rebuild.ts` at `0 9 * * *`, write to `projections/latest.json` Blob.
- **Tests:** the engine unit tests above; manual A/B vs. v1 on 3 sample rosters.
- **Done when:** your own roster gets a recommendation that mentions a real category your team is weak in.
- **Commit:** `feat(phase-1): bespoke recommendation engine with Marcel + G-score + team-fit`. Merge to main. Tag as `v0.2.0-phase1`.

### Phase 2 — Cookie flow rewrite (~1 weekend, ~6h)

- **Branch:** `feat/phase-2-cookies`
- **Files:** new `public/connect.html`, `src/ui/pages/link.tsx`, `netlify/functions/espn-link.ts`, `src/shared/crypto.ts`. Delete localStorage cookie code.
- **Steps:**
  1. Build the bookmarklet install page with the JS source visible.
  2. Implement `/api/espn-link` with AES-GCM encryption.
  3. Migrate existing users: keep manual paste working; on next login show a one-time "upgrade your security" banner that prompts re-connect via bookmarklet.
  4. Add Disconnect button in Settings.
  5. Publish iOS Shortcut as a fallback.
- **Tests:** end-to-end script on iPhone (real device), Android Chrome, desktop Safari, desktop Chrome.
- **Done when:** a fresh user can connect ESPN on iPhone in under 60 seconds.
- **Commit:** `feat(phase-2): bookmarklet-based ESPN cookie linking with AES-GCM at-rest`. Merge to main. Tag as `v0.3.0-phase2`.

### Phase 3 — UX overhaul (~1 weekend, ~8h)

- **Branch:** `feat/phase-3-ux`
- **Files:** `src/ui/components/RecCard.tsx`, `src/ui/tabs/Coach.tsx`, `src/ui/tabs/Matchup.tsx`, `src/ui/tabs/Roster.tsx`, `src/ui/tabs/Players.tsx`, plus shared `src/ui/components/{CategoryBars,LoadingSkeleton,EmptyState}.tsx`.
- **Steps:** rebuild each tab per Part 3, with skeleton loaders, the category-need header, and the explainability "Why?" expander.
- **Tests:** Lighthouse mobile ≥90, manual on iPhone SE viewport.
- **Done when:** every tab tells you something specific about *your* team within 1 second of opening.
- **Commit:** `feat(phase-3): mobile-first UX overhaul with explainable recommendations`. Merge to main. Tag as `v0.4.0-phase3`.

### Phase 4 — Trade analyzer + schedule analyzer (~1 week, ~12h)

- **Branch:** `feat/phase-4-trade-schedule`
- **Files:** `netlify/functions/trade.ts`, `src/engine/trade.ts`, `src/ui/pages/Trade.tsx`, `src/engine/schedule.ts`, `src/ui/tabs/Matchup.tsx` augmented.
- **Done when:** pasting two rosters yields a verdict you'd actually trust.
- **Commit:** `feat(phase-4): trade analyzer and schedule-aware matchup projections`. Merge to main. Tag as `v0.5.0-phase4`.

### Phase 5 — Draft mode (~1 week, ~10h, time it for August before NBA season)

- **Branch:** `feat/phase-5-draft`
- **Files:** `src/ui/pages/Draft/{Board,Queue,Tier}.tsx`, `netlify/functions/draft-state.ts`, Turso table `draft_picks`.
- **Done when:** you can mock-draft your own league and the recs change appropriately by round and roster construction.
- **Commit:** `feat(phase-5): live draft mode with round-aware recommendations`. Merge to main. Tag as `v0.6.0-phase5`.

### Phase 6 — Browser extension + power features (rolling, ~10h)

- **Branch:** `feat/phase-6-extension`
- Manifest V3 Chrome extension for one-click connect on desktop.
- Streamer planner.
- Injury push notifications (PWA web-push).
- **Commit:** `feat(phase-6): chrome extension and power-user features`. Merge to main. Tag as `v0.7.0-phase6`.

### Phase 7 — Backtesting + polish (rolling)

- **Branch:** `feat/phase-7-backtest`
- Backtest the engine against last season: did its top-3 weekly add suggestions outperform a random/top-ADP baseline?
- Tune α schedule and regression weights based on the backtest.
- Add a "Larry's track record" page that publicly shows hit rate. Builds trust for new users.
- **Commit:** `feat(phase-7): season backtest + α/regression tuning + public track record page`. Merge to main. Tag as `v1.0.0`.

### Effort summary

| Phase | Scope | Effort | Risk |
|---|---|---|---|
| 0 | TS + audit | 3h | Low |
| 1 | Bespoke recs | ~10h | Medium (engine correctness) |
| 2 | Cookie flow | ~6h | Low (well-understood) |
| 3 | UX | ~8h | Low |
| 4 | Trade + schedule | ~12h | Medium |
| 5 | Draft mode | ~10h | Medium (time-boxed to season) |
| 6 | Extension + power | ~10h | Low |
| 7 | Backtest | rolling | High value, low risk |

---

## Recommendations (decision-ready)

1. **Do Phase 0 + Phase 1 first, in that exact order, before touching UX.** The "same recs for everyone" complaint is the credibility bug; fixing UX without fixing the engine is rearranging deck chairs.
2. **Commit to TypeScript on day 1.** Claude Code is meaningfully better with a typed surface; the cost is one evening, the benefit compounds across every other phase.
3. **Adopt G-score, not just Z-score.** For a 5-cat H2H league this is a free accuracy win and is the differentiator vs. ESPN's default ordering.
4. **Ship the bookmarklet flow before the browser extension.** It works on every platform, it's 50 lines, and it removes the single biggest UX wart.
5. **Pick Turso + Netlify Blobs + Netlify Scheduled Functions.** Resist Supabase/Neon unless you have a specific reason. The fewer moving parts, the longer you stay a hobbyist.
6. **Keep Claude on the explanation layer only.** Never let it rank or compute; it should narrate deterministic numbers. This makes Larry cheap, testable, and trustworthy.
7. **Write the "two users → two different recs" regression test on day 1 of Phase 1.** It's the canary for the entire project.
8. **Threshold to revisit native app:** if iOS bookmarklet install friction still kills onboarding after Phase 2 ships, build the Manifest V3 extension (Phase 6 brought forward); only consider native iOS if you cross 1,000 users.
9. **Threshold to leave Netlify:** stay until either (a) Scheduled Function runtime exceeds 30s or (b) credit costs exceed $25/mo. At that point evaluate Cloudflare Workers + D1 (which is also SQLite-based, so the Turso → D1 migration is mechanical).

---

## Caveats

- **Repo not directly fetchable in this session.** Treat every literal file path I named as a *target* path. The first thing Claude Code should do is print the actual `tree` and reconcile names; my prescriptive paths are deliberately conventional so the rename is a search-and-replace.
- **ESPN's API is undocumented and can break.** It has been stable for years but has no SLA. Build a `USING_ESPN_FALLBACK` flag that lets you serve "engine-only" recommendations (using last successful roster pull from cache) when ESPN returns 5xx.
- **G-score (Rosenof) is academic, not a vendor product.** Implement carefully against the paper; the variance term `κ · var_weekToWeek(stat)` is the right shape but the empirical κ values come from his Table 8 — verify before shipping.
- **Bookmarklet UX on iOS is functional but not delightful.** The install flow is multi-step and feels janky compared to a native share extension; an animated GIF and clear copy mitigate but do not eliminate this. Expect ~10–20% of mobile users to fall back to manual paste.
- **Marcel + last-30-day minutes is a strong baseline, not state of the art.** Vendors like Basketball Monster have years of refinement (rest, B2B, pace, injuries) baked in. Larry's first version will not match them on raw projection accuracy; it will win on *fit* (bespoke to the user's matchup state) and *explanation* (Claude rationales). Position the product accordingly.
- **iOS Shortcuts as a fallback work but distribution is fragile** (iCloud share links can be blocked by some MDM profiles). Keep the manual paste as the ultimate floor.
- **Claude API rate limits** at the free/low tier can bite during draft mode (10 picks × 12 users in a few minutes). Cache explanations by `(player, rosterHash)` and pre-warm the top 30 at draft start.
- **"Hobbyist-maintainable"** has to constrain every decision. If you find yourself adding a third storage system, a queue, or a custom auth flow, stop — you're past the maintainable line.

---

## Appendix A — Session-Start Prompts for Claude Code

Copy these prompts directly into a fresh Claude Code session at the start of each phase. Do not start a phase without using its prompt.

### Phase 0 prompt — Audit & TypeScript baseline

```
We're starting Phase 0 of the Larry improvement plan. The full plan is in
LARRY_PLAN.md at the root of this repo. Read it before doing anything else.

GROUND RULES (from the plan, do not skip):
- Work on a branch called feat/phase-0-audit. Create it now if it doesn't exist.
- Commit at the end of this session, even if Phase 0 isn't complete. Use a
  wip(phase-0): prefix on partial commits.
- Do NOT start Phase 1. Stop when Phase 0's "Done when" criterion is met.
- If anything in LARRY_PLAN.md contradicts what you find in the repo, do NOT
  silently go with the repo. Add a note to PLAN_RECONCILED.md and ask me.

PHASE 0 TASKS (in order):

1. Audit the repo. Run `tree -I "node_modules|.git|dist|build"` and write
   the output to REPO_MAP.md at the repo root. Then read these key files
   yourself and summarize what each does at the top of REPO_MAP.md:
   - package.json
   - netlify.toml
   - any file matching netlify/functions/* (especially anything that handles
     ESPN API calls, recommendations, or Claude API)
   - the main frontend entry point
   - any file that mentions "projection", "recommend", "rank", or "espn_s2"

2. Reconcile the plan to reality. Create PLAN_RECONCILED.md that lists every
   prescriptive path from LARRY_PLAN.md and maps it to the actual path in the
   repo (or marks it as "to create"). Flag any place where my plan's
   architecture assumptions don't match the repo and explain the mismatch.

3. Migrate to TypeScript if the repo isn't already TS:
   - Run `npx tsc --init` with `strict: true` and `noUncheckedIndexedAccess: true`.
   - Rename `.js` files to `.ts` / `.tsx` where appropriate.
   - Fix easy type errors. For hard ones, add `// @ts-expect-error` with a
     comment explaining what to fix later. Do not let the build break.
   - If the repo is already TypeScript, just verify strict mode is on and
     tighten the config if it isn't.

4. Add vitest. Install it, configure it, and write ONE trivial passing test
   at tests/sanity.test.ts (e.g., `expect(1+1).toBe(2)`). Make sure
   `npm test` runs and passes.

5. Add a Netlify build status badge to README.md.

6. STOP. Do not proceed to Phase 1.

DONE WHEN:
- REPO_MAP.md exists with the file tree and summaries
- PLAN_RECONCILED.md exists with path mappings
- TypeScript strict mode is enabled and the build passes
- `npm test` runs vitest and shows 1 passing test
- README has the Netlify build badge

FINAL STEP: commit with message
`chore(phase-0): repo audit, TypeScript migration, vitest baseline`
and confirm to me that the commit was made and the branch was pushed.
Do NOT merge to main until I review.
```

### Phase 1 prompt — Bespoke recommendations engine

```
We're starting Phase 1 of the Larry improvement plan. Reference LARRY_PLAN.md
(especially Part 2) and PLAN_RECONCILED.md from Phase 0.

GROUND RULES:
- Work on a branch called feat/phase-1-engine. Create it from main now.
- Phase 0 must already be merged. Do not start Phase 1 if REPO_MAP.md and
  PLAN_RECONCILED.md don't exist or if TypeScript isn't set up.
- Commit at the end of every working session with `wip(phase-1):` prefix
  if the phase isn't fully done. Final commit message at end of phase:
  `feat(phase-1): bespoke recommendation engine with Marcel + G-score + team-fit`.
- Do NOT start Phase 2. Do NOT touch the UI beyond wiring the new endpoint.
- Keep the existing recommendation endpoint working as `?engine=v1` for
  parallel comparison. Do not delete v1 in this phase.
- The headline regression test (two different rosters → two different top 3)
  is non-negotiable. Write it BEFORE shipping the engine, not after.
- If a decision the plan doesn't cover comes up (e.g. data source choice,
  schema specifics, edge cases), STOP and ask me. Don't improvise.

PHASE 1 TASKS (in order):

1. Set up engine module structure under src/engine/:
   - marcel.ts (projection model)
   - minutes.ts (minutes/role projection, last-30-days weighted)
   - zscore.ts (both Z and G score, league-aware Q pool)
   - teamFit.ts (need vector + alpha schedule)
   - recommend.ts (composes everything)
   - explain.ts (Claude prompt builder for top 3-5 only)
   - constants.ts (all magic numbers, regression weights, alpha schedule)
   - prompts/coach.v1.md (the Claude prompt template)

   Engine modules MUST be pure functions over typed inputs. They must NOT
   import from src/data/* or src/ui/*. Enforce this with module boundaries.

2. Define types in src/shared/types.ts:
   RecommendationContext, ProjectionRow, RankedPlayer, Breakdown, etc.
   Use these in every engine signature.

3. Source seed data. Pull last 3 seasons of NBA gamelogs (from nba.com/stats
   API or a committed Kaggle dump) and store under data/seed/. This is the
   bootstrap dataset for projections; production will replace this with
   the nightly Scheduled Function output. Commit the seed data so tests
   are reproducible. If the dataset is too large for the repo (>50MB),
   stop and ask me before using Git LFS.

4. Implement the engine:
   - Marcel per-36 projection with 5/4/3 weighting + age curve.
   - Minutes model that prioritizes last 30 days when available.
   - Z-score AND G-score (both implemented, G as default).
   - Team-fit need vector + alpha schedule per Part 2.4 of the plan.
   - The composed recommend() function returns RankedPlayer[] with breakdowns.

5. Build netlify/functions/recommend.ts:
   - Accept userId via session/cookie.
   - Load user roster + league settings (mock these for now if Phase 2 cookie
     flow isn't done; use a fixtures file under tests/fixtures/users/).
   - Load latest projections from Netlify Blobs OR (until the scheduled
     function exists) from the local seed file.
   - Run engine/recommend.ts.
   - Pass top 5 to engine/explain.ts → Claude API.
   - Return { ranked: RankedPlayer[], rationale: string }.
   - Mount at /api/recommend?engine=v2. Keep v1 alive for comparison.

6. Build netlify/functions/projections-rebuild.ts as a Scheduled Function
   with cron `0 9 * * *`. It should:
   - Pull NBA gamelogs (you can stub the source for this phase if the real
     data pipeline is too heavy).
   - Run Marcel for the full active player pool.
   - Write projections/latest.json to Netlify Blobs with strong consistency.
   - Log the run (count of players, top-line stats) so we can verify it ran.

7. Wire the Coach (or "Larry") tab to /api/recommend?engine=v2 behind a
   hidden feature flag. Keep v1 default for now. Do NOT redesign the UI
   in this phase. Just swap the data source.

8. WRITE TESTS:
   - tests/engine/marcel.test.ts with golden fixtures for 3-5 known players.
   - tests/engine/zscore.test.ts proving 10-team and 12-team produce
     different orderings on the same player pool.
   - tests/engine/recommend.test.ts proving two different rosters in the
     SAME league get different top 3. This is the regression test for the
     original "same suggestions for everyone" bug. It must pass.
   - All tests run via `npm test` and pass before commit.

9. Verify on real data:
   - Manually call /api/recommend?engine=v2 with my actual roster fixture.
   - Check the rationale mentions a category my team is actually weak in.
   - Compare to v1 output side-by-side.
   - Report findings to me before committing.

10. STOP. Final commit. Do not proceed to Phase 2.

DONE WHEN:
- All engine modules exist, are typed, and have tests.
- The regression test (two rosters → two top-3s) passes.
- /api/recommend?engine=v2 returns deterministic, bespoke results.
- The scheduled projections rebuild function exists and is wired.
- My own roster gets a recommendation that mentions a real weak category.
- Final commit
  `feat(phase-1): bespoke recommendation engine with Marcel + G-score + team-fit`
  is on the feat/phase-1-engine branch and pushed.

Confirm to me when each task is complete before moving to the next.
```

---

*Last updated: when this plan was created. Update the version note when phases ship.*
