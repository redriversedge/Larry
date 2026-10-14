// Larry's own player projections.
//
// Why bother when ESPN already publishes projections: ESPN's are a black
// box that we cannot inspect, cannot correct, and that occasionally ship
// obvious errors (Tyrese Haliburton went into 2026-27 projected for a
// single game). Having our own means the preseason board and the in-season
// shrink prior stop depending on one opaque source, and it gives the owner
// somewhere to put knowledge the model cannot have.
//
// The model is Marcel (Tom Tango), adapted for basketball. Three ideas:
//
//   1. Weight the last three seasons 5/4/3.
//   2. Regress toward the league average in proportion to sample size.
//   3. Project RATE and PLAYING TIME separately, then multiply.
//
// Point 3 matters more in basketball than in baseball. A role change moves
// minutes far more than it moves per-minute production: a bench guard
// promoted to starter does not suddenly score more per minute, he plays
// twice as long. Mixing the two into a single per-game number makes every
// role change look like a skill change.
//
// Deliberately NOT here: no age curve (ESPN exposes no birth dates, so
// there is nothing to compute one from; ageFactor is left as a hook), no
// machine learning, no scraped data source, no rookies (they have no
// history, so they keep ESPN's projection).
//
// Pure functions over plain data. No I/O, no state, no imports from
// src/data. The backtest in tools/backtest-projections.ts is what justifies
// every constant.

import type { Category, CategoryVector } from "../shared/types";
import { CATEGORIES } from "../shared/types";
import {
  GP_FALLBACK,
  GP_MAX,
  GP_PRIOR,
  GP_PRIOR_WEIGHT,
  GP_WEIGHTS,
  MARCEL_LEAGUE_MIN_MINUTES,
  MARCEL_MPG_GP_FLOOR,
  MARCEL_MPG_PRIOR,
  MARCEL_MPG_PRIOR_WEIGHT,
  MARCEL_REGRESSION_MINUTES,
  MARCEL_WEIGHTS,
  PROJECTION_BLEND_ALPHA,
} from "./constants";

const MINUTES_BASE = 36;

// One season of real box-score TOTALS for one player.
export interface SeasonTotals {
  GP: number;
  MIN: number;
  REB: number;
  AST: number;
  STL: number;
  BLK: number;
  PTS: number;
}

export interface ProjectionInput {
  id: string;
  // Most recent first: index 0 is T-1, 1 is T-2, 2 is T-3. Seasons the
  // player missed entirely are omitted, not zero-filled: a zero season
  // would say "played and produced nothing", which is a different claim.
  seasons: SeasonTotals[];
  // ESPN's projection for the target season, as totals, when it has one.
  espnProjection?: SeasonTotals | null;
}

export interface LeagueRates {
  // League average production per MINUTE, already weighted across seasons.
  perMinute: CategoryVector;
}

export interface ProjectionOverride {
  name?: string;
  gp?: number;
  mpg?: number;
  note?: string;
  // ISO date. Past this the entry is ignored, so a stale injury note
  // cannot quietly distort the board for a whole season.
  until?: string;
}

export interface ProjectionOptions {
  categories?: readonly Category[];
  regressionMinutes?: number;
  blendAlpha?: number;
  override?: ProjectionOverride | null;
  // Local YYYY-MM-DD. Overrides with an earlier `until` are ignored.
  today?: string;
  // Hook for a future age curve. ESPN exposes no birth dates today.
  ageFactor?: number;
}

export type ProjectionSourceKind = "larry" | "espn" | "blend" | "override" | "none";

export interface PlayerProjectionResult {
  id: string;
  perGame: CategoryVector;
  per36: CategoryVector;
  gp: number;
  mpg: number;
  source: ProjectionSourceKind;
  // How many prior seasons fed the rate. 0 means a rookie, who gets ESPN's
  // projection unchanged.
  seasonsUsed: number;
}

function emptyVector(): CategoryVector {
  return { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
}

function num(v: number | undefined | null): number {
  return typeof v === "number" && isFinite(v) ? v : 0;
}

// League average production per minute, weighted across seasons the same
// 5/4/3 way as a player's own history.
//
// Only players with real minutes count. Including everyone would drag the
// average down with garbage time and ten-day contracts, and the regression
// target would stop meaning "a league-average NBA player".
export function computeLeagueRates(
  seasonsByPlayer: SeasonTotals[][],
  opts: { categories?: readonly Category[]; minMinutes?: number } = {},
): LeagueRates {
  const cats = opts.categories ?? CATEGORIES;
  const minMinutes = opts.minMinutes ?? MARCEL_LEAGUE_MIN_MINUTES;
  const totals = emptyVector();
  let minutes = 0;

  for (const seasons of seasonsByPlayer) {
    for (let i = 0; i < seasons.length && i < MARCEL_WEIGHTS.length; i++) {
      const s = seasons[i]!;
      if (num(s.MIN) < minMinutes) continue;
      const w = MARCEL_WEIGHTS[i]!;
      minutes += w * num(s.MIN);
      for (const c of cats) totals[c] += w * num((s as any)[c]);
    }
  }

  const perMinute = emptyVector();
  if (minutes > 0) {
    for (const c of cats) perMinute[c] = totals[c] / minutes;
  }
  return { perMinute };
}

// Per-36 rate, regressed toward the league average by `R` minutes of
// average play. The regression is in the denominator as well as the
// numerator, which is what makes it a true weighted average rather than a
// shrink toward zero.
export function per36Rate(
  seasons: SeasonTotals[],
  league: LeagueRates,
  opts: ProjectionOptions = {},
): CategoryVector {
  const cats = opts.categories ?? CATEGORIES;
  const R = opts.regressionMinutes ?? MARCEL_REGRESSION_MINUTES;
  const out = emptyVector();

  let weightedMinutes = 0;
  const weightedStat = emptyVector();
  for (let i = 0; i < seasons.length && i < MARCEL_WEIGHTS.length; i++) {
    const s = seasons[i]!;
    const w = MARCEL_WEIGHTS[i]!;
    weightedMinutes += w * num(s.MIN);
    for (const c of cats) weightedStat[c] += w * num((s as any)[c]);
  }

  const denom = weightedMinutes + R;
  if (denom <= 0) return out;
  const ageFactor = opts.ageFactor ?? 1;
  for (const c of cats) {
    const perMin = (weightedStat[c] + R * league.perMinute[c]) / denom;
    out[c] = MINUTES_BASE * perMin * ageFactor;
  }
  return out;
}

// Minutes per game, weighted by games so a 10-game season counts for less
// than a full one. Players without much history are pulled toward a
// replacement-level role rather than being trusted at face value.
export function projectMinutesPerGame(seasons: SeasonTotals[]): number {
  let weightedMinutes = 0;
  let weightedGames = 0;
  let totalGP = 0;
  for (let i = 0; i < seasons.length && i < MARCEL_WEIGHTS.length; i++) {
    const s = seasons[i]!;
    const w = MARCEL_WEIGHTS[i]!;
    weightedMinutes += w * num(s.MIN);
    weightedGames += w * num(s.GP);
    totalGP += num(s.GP);
  }
  if (weightedGames <= 0) return 0;
  const raw = weightedMinutes / weightedGames;
  if (totalGP >= MARCEL_MPG_GP_FLOOR) return raw;
  return (1 - MARCEL_MPG_PRIOR_WEIGHT) * raw + MARCEL_MPG_PRIOR_WEIGHT * MARCEL_MPG_PRIOR;
}

// Expected games played.
//
// Availability is far noisier than production and regresses hard: a player
// who missed 40 games once is not a 42-game player forever. Weights are
// renormalized over the seasons that exist, so a player with two seasons is
// not punished for the missing third.
export function projectGamesPlayed(
  seasons: SeasonTotals[],
  espnProjection?: SeasonTotals | null,
): number {
  const usable = seasons.slice(0, GP_WEIGHTS.length);
  if (usable.length <= 1) {
    // One season or none is not enough to say anything about availability.
    const espnGP = num(espnProjection?.GP);
    if (espnGP > 0) return Math.min(espnGP, GP_MAX);
    return GP_FALLBACK;
  }

  let weighted = 0;
  let weightSum = 0;
  for (let i = 0; i < usable.length; i++) {
    const w = GP_WEIGHTS[i]!;
    weighted += w * num(usable[i]!.GP);
    weightSum += w;
  }
  if (weightSum <= 0) return GP_FALLBACK;

  let gp = weighted / weightSum;
  gp = (1 - GP_PRIOR_WEIGHT) * gp + GP_PRIOR_WEIGHT * GP_PRIOR;
  return Math.min(gp, GP_MAX);
}

// True when the override is present and has not expired.
export function overrideIsActive(
  override: ProjectionOverride | null | undefined,
  today?: string,
): boolean {
  if (!override) return false;
  if (!override.until) return true;
  if (!today) return true;
  // Plain string comparison on YYYY-MM-DD. Never new Date(str): that is
  // UTC midnight and reads as the previous day in US Central.
  return today <= override.until;
}

// ESPN's projection expressed as a per-game rate over the games ESPN
// expects the player to PLAY. Null when there is nothing usable.
export function espnPerGameRate(
  espnProjection: SeasonTotals | null | undefined,
  cats: readonly Category[] = CATEGORIES,
): CategoryVector | null {
  if (!espnProjection) return null;
  const gp = num(espnProjection.GP);
  if (gp < 1) return null;
  const out = emptyVector();
  let any = false;
  for (const c of cats) {
    const v = num((espnProjection as any)[c]) / gp;
    out[c] = v;
    if (v !== 0) any = true;
  }
  return any ? out : null;
}

// The whole projection for one player: Marcel rate, expected games, the
// owner's override, and the blend with ESPN.
export function projectPlayer(
  input: ProjectionInput,
  league: LeagueRates,
  opts: ProjectionOptions = {},
): PlayerProjectionResult {
  const cats = opts.categories ?? CATEGORIES;
  const alpha = opts.blendAlpha ?? PROJECTION_BLEND_ALPHA;
  const override = overrideIsActive(opts.override, opts.today) ? opts.override! : null;

  const seasons = (input.seasons ?? []).slice(0, MARCEL_WEIGHTS.length);
  const espnRate = espnPerGameRate(input.espnProjection, cats);

  // A rookie has no history to model. ESPN has scouting we do not, so use
  // its number unchanged rather than inventing one.
  if (seasons.length === 0) {
    const gp = override?.gp ?? num(input.espnProjection?.GP) ?? GP_FALLBACK;
    const mpg = override?.mpg ?? 0;
    const perGame = espnRate ?? emptyVector();
    const per36 = emptyVector();
    if (mpg > 0) {
      for (const c of cats) per36[c] = (perGame[c] * MINUTES_BASE) / mpg;
    }
    return {
      id: input.id,
      perGame,
      per36,
      gp: Math.min(gp > 0 ? gp : GP_FALLBACK, GP_MAX),
      mpg,
      source: espnRate ? (override ? "override" : "espn") : "none",
      seasonsUsed: 0,
    };
  }

  const per36 = per36Rate(seasons, league, opts);
  const modelMpg = projectMinutesPerGame(seasons);
  const mpg = override?.mpg ?? modelMpg;

  const larryRate = emptyVector();
  for (const c of cats) larryRate[c] = (per36[c] * mpg) / MINUTES_BASE;

  // Blend. ESPN's games-played number is the noisiest part of its
  // projection, so only the RATE is blended; expected games comes from the
  // model or the override.
  const perGame = emptyVector();
  let source: ProjectionSourceKind;
  if (!espnRate) {
    for (const c of cats) perGame[c] = larryRate[c];
    source = "larry";
  } else if (alpha >= 1) {
    for (const c of cats) perGame[c] = larryRate[c];
    source = "larry";
  } else if (alpha <= 0) {
    for (const c of cats) perGame[c] = espnRate[c];
    source = "espn";
  } else {
    for (const c of cats) perGame[c] = alpha * larryRate[c] + (1 - alpha) * espnRate[c];
    source = "blend";
  }

  const gp = override?.gp ?? projectGamesPlayed(seasons, input.espnProjection);

  return {
    id: input.id,
    perGame,
    per36,
    gp: Math.min(Math.max(gp, 0), GP_MAX),
    mpg,
    source: override ? "override" : source,
    seasonsUsed: seasons.length,
  };
}

export function projectAll(
  inputs: ProjectionInput[],
  opts: ProjectionOptions & { overrides?: Record<string, ProjectionOverride> } = {},
): Map<string, PlayerProjectionResult> {
  const league = computeLeagueRates(
    inputs.map((i) => i.seasons ?? []),
    { categories: opts.categories },
  );
  const out = new Map<string, PlayerProjectionResult>();
  for (const input of inputs) {
    const override = opts.overrides ? opts.overrides[input.id] : opts.override;
    out.set(input.id, projectPlayer(input, league, { ...opts, override }));
  }
  return out;
}
