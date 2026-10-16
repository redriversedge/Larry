// Fitting and scoring the mock-draft model against real drafts.
//
// Pure, per CLAUDE.md. Shared deliberately between tools/fit-mock-draft.ts
// and the in-app "Draft model check" in the Draft Room footer, so the number
// the owner sees on his phone is produced by exactly the same code as the
// number in the PR.
//
// What "the board" means here
// ---------------------------
// A finished season's history holds only the players who were DRAFTED, not
// the whole player universe ESPN showed that year. So the pool at pick k is
// the players drafted that season who have not gone yet. The question the
// likelihood asks is therefore "given that these 144 players came off the
// board, who did this manager take next" rather than "who did they take out
// of every NBA player". That is the right conditional for fitting drafting
// BEHAVIOUR, it needs no historical player universe, and both the full model
// and the baseline are scored on it identically.

import {
  buildAdpLookup,
  buildDraftProfiles,
  leagueReachMedians,
  normName,
  type AdpHistory,
  type DraftHistory,
  type ManagerProfile,
} from "./draftProfiles";
import { MOCK_TOP_PICK_SIMS, MOCK_TOP_PICK_WINDOW } from "./constants";
import {
  DEFAULT_MOCK_PARAMS,
  pickUtilities,
  prepareBoard,
  softmax,
  topPickRate,
  type MockDraftConfig,
  type MockParams,
  type MockPlayer,
  type MockState,
  type RankForm,
} from "./mockDraft";

// Large enough that every available player is scored, so the likelihood is
// a true probability over the pool rather than over a truncation of it.
const FIT_CANDIDATE_POOL = 100000;

export interface EvalResult {
  picks: number;
  // Mean log-likelihood per pick. Higher (less negative) is better.
  meanLogLik: number;
  // Share of picks where the actual player was the model's most likely, and
  // where it was among the model's five most likely.
  top1: number;
  top5: number;
}

export function emptyEval(): EvalResult {
  return { picks: 0, meanLogLik: 0, top1: 0, top5: 0 };
}

export function buildHistoricalBoard(
  history: DraftHistory,
  seasonId: number,
  adpLookup: Map<string, Map<string, number>>,
): MockPlayer[] {
  const season = history.seasons[String(seasonId)];
  if (!season) return [];
  const adp = adpLookup.get(String(seasonId));

  const out: MockPlayer[] = [];
  for (const id of Object.keys(season.players)) {
    const row = season.players[id];
    if (!row) continue;
    const gp = row[4];
    const perGame = {
      PTS: gp > 0 ? (row[5] || 0) / gp : 0,
      REB: gp > 0 ? (row[6] || 0) / gp : 0,
      AST: gp > 0 ? (row[7] || 0) / gp : 0,
      STL: gp > 0 ? (row[8] || 0) / gp : 0,
      BLK: gp > 0 ? (row[9] || 0) / gp : 0,
    };
    const fromFile = adp ? adp.get(normName(row[0])) : undefined;
    out.push({
      playerId: Number(id),
      name: row[0],
      posId: row[1],
      proTeamId: row[2],
      // That season's ESPN ADP, from the committed history file. Never the
      // stored espnRank: for a finished season that is an end-of-season
      // rank, not the pre-draft board.
      espnAdp: fromFile === undefined ? null : fromFile,
      espnDraftRank: row[3],
      larryRank: null,
      perGame,
    });
  }
  return out;
}

function configForSeason(
  history: DraftHistory,
  seasonId: number,
  board: MockPlayer[],
  profiles: Record<string, ManagerProfile>,
  params: MockParams,
): MockDraftConfig | null {
  const season = history.seasons[String(seasonId)];
  if (!season || !season.picks.length) return null;

  const ordered = season.picks.slice().sort((a, b) => a[0] - b[0]);
  const order = ordered.map((p) => p[2]);
  const teamIds = new Set(order);

  const profileByTeam: Record<string, ManagerProfile | null> = {};
  for (const teamId of teamIds) {
    const memberId = season.owners[String(teamId)];
    profileByTeam[String(teamId)] = (memberId && profiles[memberId]) || null;
  }

  return {
    order,
    teamCount: teamIds.size,
    players: board,
    profileByTeam,
    leagueReach: leagueReachMedians(profiles),
    params,
  };
}

// Score one real draft under one set of parameters.
export function evaluateDraft(
  history: DraftHistory,
  seasonId: number,
  adpLookup: Map<string, Map<string, number>>,
  profiles: Record<string, ManagerProfile>,
  params: MockParams,
): EvalResult {
  const season = history.seasons[String(seasonId)];
  if (!season || !season.picks.length) return emptyEval();

  const board = buildHistoricalBoard(history, seasonId, adpLookup);
  const config = configForSeason(history, seasonId, board, profiles, params);
  if (!config) return emptyEval();

  const prepared = prepareBoard(config);
  const ordered = season.picks.slice().sort((a, b) => a[0] - b[0]);

  const available = new Set<number>();
  for (const player of board) available.add(player.playerId);

  const state: MockState = { seed: 1, picks: [] };
  let logLikSum = 0;
  let scored = 0;
  let top1 = 0;
  let top5 = 0;

  for (let index = 0; index < ordered.length; index++) {
    const pick = ordered[index];
    if (!pick) continue;
    const actual = pick[3];
    if (!available.has(actual)) continue;

    const utilities = pickUtilities(
      prepared,
      config,
      state,
      index,
      available,
      FIT_CANDIDATE_POOL,
    );
    if (utilities.length > 1) {
      const probabilities = softmax(utilities.map((u) => u.utility));
      let actualP = 0;
      let better = 0;
      for (let i = 0; i < utilities.length; i++) {
        const entry = utilities[i];
        const p = probabilities[i];
        if (!entry || p === undefined) continue;
        if (entry.playerId === actual) actualP = p;
      }
      for (let i = 0; i < utilities.length; i++) {
        const entry = utilities[i];
        const p = probabilities[i];
        if (!entry || p === undefined) continue;
        if (entry.playerId !== actual && p > actualP) better++;
      }
      // Floored so one impossible pick cannot swamp the whole sum.
      logLikSum += Math.log(Math.max(actualP, 1e-12));
      if (better === 0) top1++;
      if (better < 5) top5++;
      scored++;
    }

    available.delete(actual);
    state.picks.push([index + 1, pick[2], actual]);
  }

  return {
    picks: scored,
    meanLogLik: scored ? logLikSum / scored : 0,
    top1: scored ? top1 / scored : 0,
    top5: scored ? top5 / scored : 0,
  };
}

// The top-pick acceptance gate, measured on a historical season's board and
// draft order. Lives here because it needs the same board-building logic as
// the likelihood, so the gate and the fit always see the same players.
export function topPickRateForSeason(
  history: DraftHistory,
  seasonId: number,
  adpLookup: Map<string, Map<string, number>>,
  profiles: Record<string, ManagerProfile>,
  params: MockParams,
  sims: number = MOCK_TOP_PICK_SIMS,
  window: number = MOCK_TOP_PICK_WINDOW,
): number {
  const board = buildHistoricalBoard(history, seasonId, adpLookup);
  const config = configForSeason(history, seasonId, board, profiles, params);
  if (!config) return 0;
  return topPickRate(prepareBoard(config), config, sims, window);
}

export function combineEvals(results: EvalResult[]): EvalResult {
  let picks = 0;
  let logLik = 0;
  let top1 = 0;
  let top5 = 0;
  for (const r of results) {
    picks += r.picks;
    logLik += r.meanLogLik * r.picks;
    top1 += r.top1 * r.picks;
    top5 += r.top5 * r.picks;
  }
  if (!picks) return emptyEval();
  return {
    picks,
    meanLogLik: logLik / picks,
    top1: top1 / picks,
    top5: top5 / picks,
  };
}

// Profiles for each draft year, built from PRIOR seasons only. Precomputed
// once because the optimizer re-scores the same drafts hundreds of times and
// profiles do not depend on the parameters.
export function profilesBySeason(
  history: DraftHistory,
  seasons: number[],
  adp?: AdpHistory,
): Record<number, Record<string, ManagerProfile>> {
  const out: Record<number, Record<string, ManagerProfile>> = {};
  for (const seasonId of seasons) {
    out[seasonId] = buildDraftProfiles(history, adp, { asOfSeason: seasonId }).profiles;
  }
  return out;
}

export interface FitOptions {
  // Hold these at zero and do not move them. Used for the rank-only
  // baseline, which refits tau with every profile term switched off.
  rankOnly?: boolean;
  iterations?: number;
  // Which rank form to fit. The two live on completely different tau
  // scales, so each gets its own starting point below.
  rankForm?: RankForm;
}

// tau means different things in the two forms: linear tau is in ADP slots
// (a few to a few dozen), log tau is in log-slots (ln(400) is only 6, so
// sensible values are fractions). Starting the log fit at the linear
// default would begin 20x too flat and coordinate descent would spend its
// whole budget walking back.
function startingParams(form: RankForm, rankOnly: boolean): MockParams {
  const base: MockParams = { ...DEFAULT_MOCK_PARAMS, rankForm: form };
  if (form === "log") {
    base.tauEarly = 0.3;
    base.tauMid = 0.5;
    base.tauLate = 0.9;
  } else {
    base.tauEarly = 2;
    base.tauMid = 3.33;
    base.tauLate = 6;
  }
  if (rankOnly) {
    base.beta = 0;
    base.lambda = 0;
    base.gamma = 0;
    base.alpha = 0;
  }
  return base;
}

export interface FitResult {
  params: MockParams;
  fitEval: EvalResult;
  // One line per accepted improvement, for the report.
  trace: string[];
}

const TAU_KEYS = ["tauEarly", "tauMid", "tauLate"] as const;
const TERM_KEYS = ["beta", "lambda", "gamma", "alpha"] as const;

// Coordinate descent with a shrinking step. Seven parameters over a smooth
// likelihood: this converges quickly and, unlike a canned optimizer, it is
// obvious from the trace what moved and why.
export function fitMockDraft(
  history: DraftHistory,
  fitSeasons: number[],
  adp: AdpHistory | undefined,
  options: FitOptions = {},
): FitResult {
  const adpLookup = buildAdpLookup(adp);
  const profiles = profilesBySeason(history, fitSeasons, adp);
  const trace: string[] = [];

  const form = options.rankForm ?? DEFAULT_MOCK_PARAMS.rankForm;
  const params: MockParams = startingParams(form, !!options.rankOnly);

  const score = (candidate: MockParams): EvalResult =>
    combineEvals(
      fitSeasons.map((seasonId) =>
        evaluateDraft(
          history,
          seasonId,
          adpLookup,
          profiles[seasonId] || {},
          candidate,
        ),
      ),
    );

  let best = score(params);
  trace.push("start: mean log-likelihood " + best.meanLogLik.toFixed(4));

  const iterations = options.iterations ?? 6;
  for (let pass = 0; pass < iterations; pass++) {
    const shrink = Math.pow(0.5, pass);
    let improved = false;

    // tau is a positive scale, so it moves multiplicatively.
    for (const key of TAU_KEYS) {
      for (const factor of [1 + 0.5 * shrink, 1 / (1 + 0.5 * shrink)]) {
        const candidate = { ...params };
        candidate[key] = Math.min(Math.max(params[key] * factor, 0.05), 200);
        const result = score(candidate);
        if (result.meanLogLik > best.meanLogLik) {
          best = result;
          params[key] = candidate[key];
          improved = true;
          trace.push(
            key + " -> " + params[key].toFixed(3) +
              " (mean log-likelihood " + best.meanLogLik.toFixed(4) + ")",
          );
        }
      }
    }

    if (!options.rankOnly) {
      for (const key of TERM_KEYS) {
        const step = (key === "beta" ? 0.04 : 4) * shrink;
        for (const delta of [step, -step]) {
          const candidate = { ...params };
          // These are magnitudes, not signed preferences: a negative gamma
          // would reward position overload.
          candidate[key] = Math.max(params[key] + delta, 0);
          const result = score(candidate);
          if (result.meanLogLik > best.meanLogLik) {
            best = result;
            params[key] = candidate[key];
            improved = true;
            trace.push(
              key + " -> " + params[key].toFixed(3) +
                " (mean log-likelihood " + best.meanLogLik.toFixed(4) + ")",
            );
          }
        }
      }
    }

    if (!improved) break;
  }

  return { params, fitEval: best, trace };
}

// Score a held-out season under both the full model and the rank-only
// baseline. This is the gate in s4.1 and the in-app check in s4.1's last
// bullet.
export interface ModelCheck {
  season: number;
  full: EvalResult;
  baseline: EvalResult;
  beatsBaseline: boolean;
}

export function checkModel(
  history: DraftHistory,
  testSeason: number,
  adp?: AdpHistory,
  params: MockParams = DEFAULT_MOCK_PARAMS,
): ModelCheck {
  const adpLookup = buildAdpLookup(adp);
  const profiles = buildDraftProfiles(history, adp, { asOfSeason: testSeason }).profiles;

  const full = evaluateDraft(history, testSeason, adpLookup, profiles, params);
  const baseline = evaluateDraft(history, testSeason, adpLookup, profiles, {
    ...params,
    beta: 0,
    lambda: 0,
    gamma: 0,
    alpha: 0,
  });

  return {
    season: testSeason,
    full,
    baseline,
    beatsBaseline: full.meanLogLik > baseline.meanLogLik,
  };
}
