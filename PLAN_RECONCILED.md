# PLAN_RECONCILED.md

This document maps every prescriptive path and architectural assumption from `LARRY_PLAN.md` to the current state of this repo. It also flags decisions where the plan and the repo conflict.

> **Plan authors note (LARRY_PLAN.md, lines 29–31):** "The research that produced this plan could not directly fetch the GitHub repo. Wherever a file is named (e.g. `netlify/functions/recommend.ts`), treat it as a **prescriptive target path** for Claude Code to create or rename to, not a claim that the file exists today. The first task in Phase 0 below is a 30-minute repo audit script you (or Claude Code) should run to map current paths to the prescribed ones." — this document is that map.

---

## TL;DR of the mismatch and the resolution

The plan assumes a Node-toolchained TypeScript project (package.json, src/ tree, .ts files, vitest, build step). The repo is intentionally a **vanilla ES5 JavaScript multi-file PWA with no build step, no bundler, and no Node toolchain**. `CLAUDE.md` actively forbids `let`/`const`/arrow functions/template literals and "no framework, no build step, no bundler."

**Resolution chosen by Clifford on 2026-05-01 (recorded for audit trail):**

- **Path (D) Hybrid TypeScript.** Existing `js/*.js` stays as ES5 vanilla per `CLAUDE.md`'s legacy rule. New code under `src/` and `tests/` is real `.ts` with `strict: true` + `noUncheckedIndexedAccess: true`. Phase 0 only sets up the toolchain (`package.json`, `tsconfig.json`, `vitest`); the build pipeline (`tsc --outDir dist/` or `tsup`) is deferred to Phase 1 when the first real `src/engine/*.ts` file lands.
- **`CLAUDE.md` updated** in the same Phase 0 commit so the hybrid rule is documented and future sessions don't whiplash.
- **Branching:** follow `CLAUDE.md`'s `feat/* -> dev -> main` flow. See conflict #4 below for the actual current state of `dev` vs `main`, which is broken in a way that needs a one-time reconcile.
- **Phase 1 regression test:** the plan's "two real rosters" test will be done with **one real roster + one synthetic roster derived from it** (e.g., swap in different category strengths). Clifford only has direct access to one real ESPN roster right now; the synthetic variant is sufficient to prove "different inputs -> different top 3" without losing the regression-test value.

---

## Path mapping (plan → reality)

Every prescriptive path the plan names, mapped to what exists today.

### Top-level

| Plan path | Status | Actual path | Notes |
|---|---|---|---|
| `larry/` (project root) | exists | repo root | Repo is at `Sterling/Larry/` locally; remote is `github.com/redriversedge/Larry`. |
| `netlify.toml` | exists | `netlify.toml` | 9 lines; minimal. Will need `[functions.projections-rebuild]` schedule block in Phase 1. |
| `package.json` | **missing** | — | Does not exist. See "Conflict: TypeScript migration" below. |
| `tsconfig.json` | **missing** | — | Plan Phase 0 task 3 wants this with `strict: true` + `noUncheckedIndexedAccess: true`. Blocked on TS decision. |
| `README.md` | exists (stub) | `README.md` | 51 bytes, two lines. Phase 0 task 5 adds a Netlify build badge. |
| `LARRY_PLAN.md` | exists | `LARRY_PLAN.md` | The plan being executed. |
| `REPO_MAP.md` | created this phase | `REPO_MAP.md` | Phase 0 deliverable. |
| `PLAN_RECONCILED.md` | created this phase | `PLAN_RECONCILED.md` | This file. |

### Netlify Functions (`netlify/functions/`)

| Plan path | Status | Actual path | Notes |
|---|---|---|---|
| `netlify/functions/espn-link.ts` | to create (Phase 2) | — | Bookmarklet receiver + AES-GCM. |
| `netlify/functions/espn-proxy.ts` | exists as `.js` | `netlify/functions/espn-proxy.js` | 85 lines. Already implements cookie-authed read proxy — matches the plan's "internal: read-only ESPN reads with user cookies." Will need rename to `.ts` if TS migration goes ahead. |
| `netlify/functions/recommend.ts` | to create (Phase 1) | — | Plan's main per-user recommendation endpoint. |
| `netlify/functions/projections-rebuild.ts` | to create (Phase 1) | — | Scheduled Function for nightly Marcel rebuild. |
| `netlify/functions/matchup.ts` | to create (Phase 4) | — | Weekly matchup analyzer. |
| `netlify/functions/trade.ts` | to create (Phase 4) | — | Trade analyzer endpoint. |
| `netlify/functions/chat.ts` | exists as `larry-chat.js` | `netlify/functions/larry-chat.js` | 153 lines. Already a Claude proxy. Filename differs from the plan (`chat.ts` vs `larry-chat.js`). Already accepts a structured `context` payload — closer to the plan's "explanation layer only" target than the plan suggests. **Note:** hard-coded model id is `claude-sonnet-4-20250514`, which is outdated; current Sonnet is 4.6 (`claude-sonnet-4-6`). Refresh in Phase 1. |

### Source tree (`src/`)

The plan prescribes a `src/` tree. **None of `src/` exists today.** All frontend code is at the root `js/` directory.

| Plan path | Status | Actual path | Notes |
|---|---|---|---|
| `src/engine/marcel.ts` | to create (Phase 1) | — | New module. |
| `src/engine/minutes.ts` | to create (Phase 1) | — | New module. |
| `src/engine/zscore.ts` | to create (Phase 1) | partial logic in `js/engines.js` | Z-scores already computed in `Engines` IIFE; G-score is new. |
| `src/engine/teamFit.ts` | to create (Phase 1) | partial logic in `js/engines.js` | Engine 12 (Matchup Strategy) already classifies categories Lock/Target/Punt and weights matchup-fit; not the same shape as the plan's `α(round) / α(matchup)` schedule but covers similar intent. |
| `src/engine/recommend.ts` | to create (Phase 1) | partial logic in `js/engines.js` | Engine 4 (Recommendations) already exists, blends 40% DURANT + 60% matchup fit, filters injured. The plan's deterministic ranking + Claude-narration split needs to be reconciled with this. |
| `src/engine/explain.ts` | to create (Phase 1) | partial logic in `js/chat.js` + `larry-chat.js` | A system-prompt builder already exists in `larry-chat.js` (`buildSystemPrompt`). It already gets per-user context (roster, matchup, free agents). Should move to a versionable prompt file per Part 5.5 of the plan. |
| `src/engine/constants.ts` | to create (Phase 1) | scattered | Magic numbers currently inlined across `js/engines.js`. |
| `src/engine/prompts/coach.v1.md` | to create (Phase 1) | inline string in `larry-chat.js` (lines 63–76) | Versioning the prompt is a Phase-1 deliverable. |
| `src/data/espn.ts` | to create | partial logic in `js/espn.js` | ESPN client logic already exists (701 lines). |
| `src/data/nba.ts` | to create | — | No NBA stats source today (DURANT uses ESPN-derived per-game). |
| `src/data/cache.ts` | to create | — | No Netlify Blobs usage today. |
| `src/db/schema.sql` | to create (Phase 1+) | — | No database today. |
| `src/ui/tabs/{Roster,Matchup,Players,Larry,League}.tsx` | to create (Phase 3) | partial in `js/tabs.js` | All five tabs already exist as ES5 functions inside `js/tabs.js` (2408 lines). Plan calls for renaming "Larry" tab to "Coach" — see Part 3.1. |
| `src/ui/components/RecCard.tsx` | to create (Phase 3) | — | New. |
| `src/ui/onboarding/EspnLink.tsx` | to create (Phase 2) | manual paste flow in core/espn | Phase 2 replaces. |
| `src/shared/types.ts` | to create (Phase 1) | — | No types today (vanilla JS). |
| `src/shared/crypto.ts` | to create (Phase 2) | — | New. AES-GCM helpers. |

### Public assets

| Plan path | Status | Actual path | Notes |
|---|---|---|---|
| `public/bookmarklet.html` | to create (Phase 2) | — | Phase 2 deliverable. |
| `public/manifest.webmanifest` | exists at root | `manifest.json` | Already a PWA manifest; rename or relocate is cosmetic. |

### Tests

| Plan path | Status | Actual path | Notes |
|---|---|---|---|
| `tests/sanity.test.ts` | to create (Phase 0) | — | **Blocked** — see "Conflict: vitest" below. |
| `tests/engine/marcel.test.ts` | to create (Phase 1) | — | |
| `tests/engine/zscore.test.ts` | to create (Phase 1) | — | |
| `tests/engine/recommend.test.ts` | to create (Phase 1) | — | The "two rosters → two top 3s" regression test. |
| `tests/golden/*.json` | to create (Phase 1) | — | Backtest fixtures. |

---

## Architectural conflicts (need user decision)

These are places where the plan and the repo disagree on a load-bearing assumption. Per the plan's own ground rule #6, do not silently "go with the repo" or silently "go with the plan." Decide explicitly.

### 1. TypeScript migration vs. "no build step" rule (Phase 0, task 3) — **RESOLVED: Hybrid (D)**

**Plan (Part 5.1, Phase 0 task 3):** "If the repo is JS, migrate. … Set `'strict': true`, `'noUncheckedIndexedAccess': true`. Add `tsx`/`tsup` for function bundling."

**Repo (`CLAUDE.md`):**
- "Vanilla JS multi-file app. **No framework, no build step, no bundler.** Files deploy directly to Netlify."
- "All JS uses `var` (ES5 style for maximum compatibility). **No `let`/`const`, no arrow functions, no template literals.**"
- "Global modules use IIFE pattern: `var ModuleName = (function() { ... return { publicAPI }; })();`"
- `netlify.toml` has no `command =` line; `publish = "."` — the published site is the repo root, served as static files.

**Why this matters:** TypeScript requires either (a) a compile step (which `CLAUDE.md` forbids) or (b) JSDoc-only types with `// @ts-check` headers (which is plausibly compatible with the no-build rule and gives Claude Code a typed surface without changing the runtime artifact). The plan does not consider option (b).

**Possible resolutions (pick one):**

- **(A) Override `CLAUDE.md`.** Add a build step (e.g. `tsc` → `dist/` for the frontend, `tsup` → `netlify/functions/` for the functions). Update `CLAUDE.md` to remove the "no build step" rule. Update `netlify.toml` with a `command = "npm run build"` and a new `publish = "dist"`. This is the literal reading of the plan but is the largest single architectural change in the project's history. It also means the engine refactor in Phase 1 starts during a half-migrated build, which is risky.
- **(B) Use TypeScript via JSDoc only.** Add `tsconfig.json` with `allowJs: true`, `checkJs: true`, `noEmit: true`, `strict: true`, `noUncheckedIndexedAccess: true`. Add `// @ts-check` to each `.js` file. Get the "Claude Code is meaningfully better with a typed surface" benefit (Plan Part 5.1) **without** changing the runtime artifact, the file extensions, or `CLAUDE.md`'s no-build rule. `npx tsc --noEmit` becomes a CI step. This is a faithful spirit-of-the-plan compromise.
- **(C) Defer TS to Phase 1.** Skip task 3 in Phase 0; only do the audit + reconciliation + vitest + badge. Decide on TS strategy when Phase 1's `src/engine/` modules are designed, since those are greenfield and *can* be authored in `.ts` regardless of what we do with the existing `js/*.js` files.
- **(D) Hybrid.** New code under `src/engine/` is `.ts` and gets compiled to `dist/engine/` (loaded as ES modules in `index.html`). Existing `js/*.js` stays vanilla ES5. This contradicts `CLAUDE.md` slightly but localizes the build step to the new code only.

**Decision (2026-05-01):** Path **(D) Hybrid**. Rationale: the plan's later phases (Turso/libSQL, AES-GCM crypto, Scheduled Functions, Netlify Blobs) imply a toolchain anyway, so the "no build step" rule is going to strain regardless. (D) gets the real-`.ts` ergonomics for new engine code without churning the working `js/*.js` modules. JSDoc-only (path B) is best for the existing files but bad for the rich types Phase 1 will need (`RecommendationContext`, `ProjectionRow`, generics).

**Phase 0 scope under (D):**
- Add `package.json` (devDeps only: `typescript`, `vitest`, `@types/node`).
- Add `tsconfig.json` covering `src/` and `tests/`, with `strict: true`, `noUncheckedIndexedAccess: true`, `noEmit: true` for now (deferred build pipeline; no `src/` source files yet).
- Add `vitest.config.ts` (minimal).
- Add `tests/sanity.test.ts` (the plan's required trivial passing test).
- Update `.gitignore` for `node_modules/` (already present), `dist/`, `coverage/`, `temporary screenshots/`.
- Update `CLAUDE.md` to document the hybrid rule.

**Phase 1 picks up the build pipeline:** when the first `src/engine/*.ts` file lands, that phase sets up `tsc --outDir dist/` (or `tsup`), updates `index.html` to load compiled engine modules, and updates `netlify.toml` with a `build.command` if needed. Not Phase 0's problem.

### 2. vitest in a no-Node-toolchain repo (Phase 0, task 4)

vitest requires `package.json`, `node_modules`, and a runtime. None exist today. The fix is mechanical (`npm init -y`, `npm i -D vitest`) but the act of adding `package.json` itself is the architectural change — once it's in, the project is no longer "no toolchain." Tied to the decision above:

- If we go (A) or (B) above, `package.json` is fine.
- If we go (C) [defer], we should also defer vitest to Phase 1.
- If we go (D), `package.json` exists for new TS code; vitest fits there naturally.

### 3. The engine isn't missing (Phase 1 scope)

**Plan (Part 1, "Likely current architecture"):** treats the recommendation engine as a probable-mega-function-with-Claude-prompts, and prescribes building Marcel/Z-score/team-fit from scratch.

**Repo:** `js/engines.js` is 880 lines and already implements **12 named analysis engines**, including z-scores, DURANT composite ranking, Monte Carlo win probability, matchup-aware recommendations (Engine 4: 40% DURANT + 60% matchup fit, with injury filter), Monte Carlo, ROS projections, and a Lock/Target/Punt matchup strategy classifier (Engine 12). The system-prompt builder in `netlify/functions/larry-chat.js` *already* receives per-user roster + matchup + free agents.

**Implication:** the "same suggestions for everyone" diagnosis in the plan (Part 1.1) is plausible but unverified against this repo. Three scenarios:
- (a) The bug is real and it's a *client* issue — `js/chat.js` may not be populating the `context` payload correctly per user.
- (b) The bug is real and it's a *ranking* issue — Engine 4's matchup-fit blend may collapse to similar tops across users.
- (c) The bug is fixed or stale — the user's diagnosis predates recent engine work.

Phase 1 should start by **reproducing the bug against two rosters in a real league**, not by replacing the engine wholesale. The plan's prescription (rebuild as Marcel + G-score + α-fit) may still be the right move, but reproducing first prevents replacing a working engine with a less-tested one.

**Recommendation:** treat Part 2 of the plan as a **target architecture** for the engine, not a refutation of what's there. The migration-without-breaking-existing-features section (Part 2.6) is exactly right; lean on it.

### 4. Branching: plan says off `main`, `CLAUDE.md` says off `dev` — and `dev` is stale relative to `main`

**Plan:** "Use `feat/phase-0-audit`, `feat/phase-1-engine`, … Merge to `main` only after the phase's 'Done when' criterion is verified."

**`CLAUDE.md`:** "Work on `dev` branch. When ready to deploy: push `dev`, merge `dev` into `main`, push `main`. … For larger features, use `feature/*` branches off `dev`."

**Decision (2026-05-01):** follow `CLAUDE.md`. Phase merge target is `dev`, not `main`. So `feat/phase-0-audit` → `dev` → `main` (for deploy).

**Critical sub-finding: `dev` and `main` are inverted.** `git log --oneline dev..main` returns 31 commits; `git log --oneline main..dev` returns 0. **`main` is 31 commits ahead of `dev`**, including major engine work (effectiveDURANT, Engine 12 Matchup Strategy, opportunity boost, availability score, schedule grid, add/drop tile UI, ROS projections, schedule advantage logic, free-agent pool size, etc.). This means CLAUDE.md's stated workflow ("dev → main") has not been followed in practice — recent work has landed directly on `main`, leaving `dev` behind.

**Implication for Phase 0 onwards:**
- Branching `feat/phase-0-audit` off `dev` would put the entire effort on **stale code** (missing all 31 commits of recent engine work).
- Branching off `main` is correct for "freshest baseline" but contradicts `CLAUDE.md`'s rule.
- The clean fix is a one-time reconcile: **fast-forward `dev` to `main`** (or merge `main` into `dev`). After that, the stated `feat/* → dev → main` flow can resume.

**Action taken in this Phase 0:** branched off `main` (which is the latest production code). This is the only sensible choice until `dev` is reconciled with `main`. Surfacing this for Clifford to fix in a separate one-time housekeeping commit, ideally before Phase 1.

**Suggested fix (run this when convenient, NOT inside Phase 0):**
```bash
git checkout dev
git merge --ff-only main   # since main is strictly ahead, fast-forward should work
git push origin dev
```
After that, future feat/* branches should go off dev per CLAUDE.md.

### 5. Branch `feature/larry-overhaul` already exists

There is a pre-existing local + remote branch called `feature/larry-overhaul`. It is not used by Phase 0. Leaving it alone. If it has work that should land before Phase 1 starts, surface it.

### 6. Pre-existing `docs/plans/2026-03-06-phases-3-4-5.md`

A March-2026 phase plan exists in `docs/plans/`. Its phase numbering does **not** match `LARRY_PLAN.md`'s. They are two different plan generations. If the March doc represents in-flight commitments, the phase numbering in `LARRY_PLAN.md` should not be assumed to subsume them.

### 7. ESPN cookie storage location

**Plan (Part 4):** cookies stored in `localStorage` is "the #1 security issue." Plan replaces with AES-GCM encrypted server-side blob via `/api/espn-link`.

**Repo:** confirmed — `espn_s2` and `SWID` are kept in browser `localStorage` under the `S` state object. Phase 2 work as-described in the plan applies cleanly.

### 8. Outdated Claude model id

`netlify/functions/larry-chat.js` line 38 hard-codes `claude-sonnet-4-20250514`. Today's recommendation is Sonnet 4.6 (`claude-sonnet-4-6`) for chat or Opus 4.7 (`claude-opus-4-7`) if quality > cost. Refresh during Phase 1 when explanation layer is touched.

---

## What was done in this Phase 0 session

- Created branch `feat/phase-0-audit` off `main` (correct base — `dev` is stale; see conflict #4).
- Wrote `REPO_MAP.md` with file tree + key-file summaries.
- Wrote `PLAN_RECONCILED.md` (this file) — every prescriptive path mapped, eight architectural conflicts surfaced and resolved.
- Added `package.json`, `tsconfig.json`, `vitest.config.ts`, `tests/sanity.test.ts` per chosen path (D) Hybrid TypeScript. Build pipeline deferred to Phase 1.
- Added Netlify build badge to `README.md` (placeholder for site API ID).
- Updated `CLAUDE.md` with the hybrid TS rule (ES5 `js/*.js` legacy, modern TS in `src/`).
- Updated `.gitignore` for `dist/`, `coverage/`, `temporary screenshots/`.
- Confirmed `npm test` runs vitest and shows 1 passing test.

---

## Open items for Clifford (not blocking Phase 0 completion)

1. **`dev` vs `main` reconcile (conflict #4):** run the suggested fast-forward of `dev` to catch up to `main` before Phase 1 starts. Otherwise Phase 1's `feat/phase-1-engine` branch off `dev` will be on stale code.
2. **Netlify badge site API ID:** drop the actual ID from Netlify dashboard into `README.md` (placeholder is `REPLACE_WITH_SITE_API_ID`).
3. **Pre-existing plans (conflict #6):** does `docs/plans/2026-03-06-phases-3-4-5.md` represent in-flight work that conflicts with `LARRY_PLAN.md`'s phasing, or is it superseded? Needs a quick read on whether to archive it or honor it.
4. **Outdated Claude model id (conflict #8):** `larry-chat.js` line 38 hard-codes `claude-sonnet-4-20250514`. Refresh during Phase 1 when explanation layer is touched.
