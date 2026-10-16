// Expected games played: how many games a player will actually be
// available for, as opposed to how many ESPN hopes.
// docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md A2.
//
// Pure, per CLAUDE.md.
//
// Why this exists. The preseason board trusted ESPN's projected games, and
// ESPN is consistently optimistic about players with injury histories. The
// 2024-25 and 2025-26 boards put these players in the first three rounds:
//
//   Zion Williamson   projected 64, played 30, finished 202nd
//   Kawhi Leonard     projected 50, played 37, finished 187th
//   Ja Morant         projected 67, played 20, finished 333rd
//   Joel Embiid       projected 56, played 38, finished 164th
//
// Re-weighting by ESPN's projected games changed season rho by +0.005,
// because the projected-games input is itself the thing that is wrong. What
// the model below adds is the player's own attendance record.
//
// No age term. ESPN exposes no birth dates (see the note in
// projections.ts), and hardcoding ages is how a ranking silently rots.

import { GP_MAX } from "./constants";

// Weights on prior seasons, most recent first. Same shape as the Marcel
// model's GP weights in projections.ts, which beat ESPN on games MAE
// (13.51 against 14.04) in the earlier backtest.
export const DURABILITY_WEIGHTS = [5, 4, 3];

// Regression toward the league mean by k / (k + seasons). Fitted on
// seasonIds 2024, 2025 and 2026, each predicted from its own priors only.
export const DURABILITY_K = 1.25;

// Share of the blend taken from ESPN's projection, the rest from history.
//
// Fitted at 0.2, which is the headline of this whole module: four fifths of
// the signal is the player's own attendance record and only one fifth is
// ESPN's forecast. Mean absolute error in games, 1078 player-seasons:
//
//   season   ESPN alone   history alone   blend
//   2024       15.90         15.79        15.39
//   2025       15.86         15.15        14.16
//   2026       16.64         16.56        15.33
//   pooled     16.13         15.83        14.95
//
// The blend beats ESPN alone in every season, which is the A2 gate. It is
// not a huge win in absolute terms, roughly one game of error, but it is
// concentrated exactly where the board was losing money: players ESPN is
// optimistic about.
export const DURABILITY_W = 0.2;

// When ESPN projects a player this far below their own history, ESPN knows
// something history cannot: a May Achilles tear is not in last season's
// game count. In that case ESPN's number becomes a ceiling.
export const DURABILITY_OVERRIDE_GAP = 15;

export interface DurabilityInput {
  // ESPN's projected games for the target season.
  espnGP: number;
  // Actual games in prior seasons, most recent first. A season the player
  // was not in the league is ABSENT from this array, not a zero. A season
  // they were rostered for and played none of is a zero.
  priorGP: number[];
  // League mean games for rotation players, computed from the same pool
  // the caller is ranking. About 65.
  leagueMeanGP: number;
  // proTeamId 0 means no NBA team, so no games.
  onTeam?: boolean;
  // ESPN's projection for this player is a data error rather than a
  // forecast (PRESEASON_SUSPECT_GP: under 10 projected games and not
  // tagged OUT). When set, ESPN's number is ignored entirely rather than
  // being treated as information.
  suspect?: boolean;
}

export interface DurabilityOptions {
  k?: number;
  w?: number;
}

export interface DurabilityDetail {
  expectedGP: number;
  histGP: number | null;
  blendGP: number;
  overrideApplied: boolean;
  seasons: number;
}

export function weightedHistory(priorGP: number[]): number | null {
  if (!priorGP.length) return null;
  let num = 0;
  let den = 0;
  for (let i = 0; i < priorGP.length && i < DURABILITY_WEIGHTS.length; i++) {
    const gp = priorGP[i];
    if (typeof gp !== "number" || !Number.isFinite(gp) || gp < 0) continue;
    const weight = DURABILITY_WEIGHTS[i] as number;
    num += weight * gp;
    den += weight;
  }
  return den > 0 ? num / den : null;
}

export function durabilityDetail(
  input: DurabilityInput,
  options: DurabilityOptions = {},
): DurabilityDetail {
  const k = options.k ?? DURABILITY_K;
  const w = options.w ?? DURABILITY_W;
  const espnGP = Number.isFinite(input.espnGP) && input.espnGP > 0 ? input.espnGP : 0;

  // A player with no NBA team plays no games. Never the 65-game default.
  if (input.onTeam === false) {
    return { expectedGP: 0, histGP: null, blendGP: 0, overrideApplied: false, seasons: 0 };
  }

  const usable = input.priorGP.filter(
    (gp) => typeof gp === "number" && Number.isFinite(gp) && gp >= 0,
  );
  const raw = weightedHistory(usable);

  // Rookies and anyone else with no history: ESPN's number is all there
  // is. Unless it is a SUSPECT number, in which case there is nothing to
  // go on at all and the league mean is the honest placeholder; ESPN's 1
  // would put "Exp GP 1" and a red dot on a healthy player.
  if (raw === null) {
    const fallback = input.suspect ? input.leagueMeanGP : espnGP;
    return {
      expectedGP: clampGames(fallback),
      histGP: null,
      blendGP: fallback,
      overrideApplied: false,
      seasons: 0,
    };
  }

  // Regress toward the league mean in proportion to how little history
  // there is. One season of 20 games is not a durability record.
  const seasons = usable.length;
  const shrink = k / (k + seasons);
  const histGP = (1 - shrink) * raw + shrink * input.leagueMeanGP;

  // A suspect projection is a data error, so ESPN contributes nothing:
  // not to the blend, and not as a ceiling. History alone it is.
  //
  // This matters because the two rules collide exactly where they are both
  // loudest. The override below fires when ESPN is far BELOW a player's
  // own record, which is precisely the shape of a broken projection, so
  // without this guard a suspect player gets ESPN's number as a hard
  // ceiling. Haliburton read "Exp GP 1" with a red dot off a 1-game
  // projection while his history says 70.
  //
  // The RANKING never saw this: seasonValueFor ignores games for a suspect
  // player and charges them a full season. This only ever affected the
  // Exp GP column, the durability dot, and the Draft Room's fit bonus,
  // which is enough to matter on draft night.
  if (input.suspect) {
    return {
      expectedGP: clampGames(histGP),
      histGP,
      blendGP: histGP,
      overrideApplied: false,
      seasons,
    };
  }

  const blendGP = w * espnGP + (1 - w) * histGP;

  // ESPN's projection as a ceiling when it is far below the player's own
  // record. An Achilles tear in May is not in last season's game count,
  // and ESPN knows about it.
  const overrideApplied = espnGP > 0 && espnGP <= histGP - DURABILITY_OVERRIDE_GAP;
  const expected = overrideApplied ? Math.min(blendGP, espnGP) : blendGP;

  return {
    expectedGP: clampGames(expected),
    histGP,
    blendGP,
    overrideApplied,
    seasons,
  };
}

export function expectedGames(
  input: DurabilityInput,
  options: DurabilityOptions = {},
): number {
  return durabilityDetail(input, options).expectedGP;
}

// 78, not 82: nobody plays all 82, and the clamp is a sanity bound rather
// than a target.
export function clampGames(gp: number): number {
  if (!Number.isFinite(gp) || gp < 0) return 0;
  return Math.min(gp, GP_MAX - 4);
}

// --- Fitting ---

export interface FitSample {
  espnGP: number;
  priorGP: number[];
  leagueMeanGP: number;
  actualGP: number;
}

export interface FitOutcome {
  k: number;
  w: number;
  blendMAE: number;
  espnMAE: number;
  historyMAE: number;
}

function maeFor(samples: FitSample[], k: number, w: number): number {
  if (!samples.length) return Infinity;
  let sum = 0;
  for (const s of samples) {
    const predicted = expectedGames(
      { espnGP: s.espnGP, priorGP: s.priorGP, leagueMeanGP: s.leagueMeanGP },
      { k, w },
    );
    sum += Math.abs(predicted - s.actualGP);
  }
  return sum / samples.length;
}

export function espnMAE(samples: FitSample[]): number {
  if (!samples.length) return Infinity;
  let sum = 0;
  for (const s of samples) sum += Math.abs(s.espnGP - s.actualGP);
  return sum / samples.length;
}

export function historyMAE(samples: FitSample[]): number {
  if (!samples.length) return Infinity;
  let sum = 0;
  for (const s of samples) {
    const h = weightedHistory(s.priorGP);
    sum += Math.abs((h === null ? s.espnGP : h) - s.actualGP);
  }
  return sum / samples.length;
}

// Grid search. Two parameters over a smooth surface: a grid is easier to
// read in a report than an optimizer's trace, and fast enough.
export function fitDurability(samples: FitSample[]): FitOutcome {
  let best = { k: DURABILITY_K, w: DURABILITY_W, mae: Infinity };
  for (let k = 0.25; k <= 4.001; k += 0.25) {
    for (let w = 0; w <= 1.001; w += 0.05) {
      const mae = maeFor(samples, k, w);
      if (mae < best.mae) best = { k, w, mae };
    }
  }
  return {
    k: Math.round(best.k * 100) / 100,
    w: Math.round(best.w * 100) / 100,
    blendMAE: best.mae,
    espnMAE: espnMAE(samples),
    historyMAE: historyMAE(samples),
  };
}
