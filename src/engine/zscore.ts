// Z-score and G-score computation, league-aware Q pool.
//
// Z-score: standard z = (x - mean) / stdev computed over a Q pool of
// "starter-quality" players (top N=12*rosterSize by first-pass z), iterated
// twice so the pool converges.
//
// G-score (Rosenof 2023): for H2H category leagues, the right denominator
// is var_acrossPlayers + kappa * var_weekToWeek. The pool variance term is
// the same as Z's; the week-to-week term penalizes high-volatility cats
// (BLK, STL) which would otherwise look better than they perform when the
// matchup is decided over a single week.

import type { Category, CategoryVector, PlayerProjection } from "../shared/types";
import { CATEGORIES } from "../shared/types";
import {
  DEFAULT_ROSTER_SIZE,
  FULL_SEASON_GAMES,
  G_SCORE_KAPPA,
  MIN_GP_POOL,
  PROXY_WEEK_VARIANCE,
  Q_POOL_ITERATIONS,
  Q_POOL_MULTIPLIER,
  SHRINK_K,
  STDEV_FLOOR,
  Z_CAP,
} from "./constants";

export interface PoolStats {
  mean: CategoryVector;
  stdev: CategoryVector;
  poolSize: number;
}

function emptyVector(): CategoryVector {
  return { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
}

function meanStdev(values: number[]): { mean: number; stdev: number } {
  if (values.length === 0) return { mean: 0, stdev: STDEV_FLOOR };
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let sqSum = 0;
  for (const v of values) {
    const d = v - mean;
    sqSum += d * d;
  }
  const variance = values.length > 1 ? sqSum / (values.length - 1) : 0;
  const stdev = Math.max(Math.sqrt(variance), STDEV_FLOOR);
  return { mean, stdev };
}

function statsFromPlayers(
  players: PlayerProjection[],
  cats: readonly Category[] = CATEGORIES,
): PoolStats {
  const stats: PoolStats = {
    mean: emptyVector(),
    stdev: emptyVector(),
    poolSize: players.length,
  };
  for (const c of cats) {
    const values = players.map((p) => p.perGame[c]);
    const { mean, stdev } = meanStdev(values);
    stats.mean[c] = mean;
    stats.stdev[c] = stdev;
  }
  return stats;
}

export function zVector(
  player: PlayerProjection,
  stats: PoolStats,
  cats: readonly Category[] = CATEGORIES,
): CategoryVector {
  const z = emptyVector();
  for (const c of cats) {
    z[c] = (player.perGame[c] - stats.mean[c]) / stats.stdev[c];
  }
  return z;
}

export function sumVector(v: CategoryVector, cats: readonly Category[] = CATEGORIES): number {
  let s = 0;
  for (const c of cats) s += v[c];
  return s;
}

function clamp(value: number, limit: number): number {
  if (value > limit) return limit;
  if (value < -limit) return -limit;
  return value;
}

export interface QPoolOptions {
  // Categories to score on. Defaults to all five; ranking v2 passes the
  // league's own category list.
  categories?: readonly Category[];
  // Clamp each category z to +/- cap while ranking for pool membership.
  // Undefined means no clamp, which is the historical behavior relied on by
  // recommend.ts. Ranking v2 passes Z_CAP so that pool selection and the
  // final score agree, matching tools/proto.py.
  cap?: number;
}

// Build a league-aware Q pool by ranking everyone on first-pass z over the
// full population, taking the top N, and recomputing. Iterate Q_POOL_ITERATIONS
// times. Returns the final pool stats and the pool itself (callers may want
// to inspect it).
export function buildQPool(
  pool: PlayerProjection[],
  rosterSize: number,
  opts: QPoolOptions = {},
): { stats: PoolStats; players: PlayerProjection[] } {
  const cats = opts.categories ?? CATEGORIES;
  const cap = opts.cap;
  if (pool.length === 0) {
    return { stats: { mean: emptyVector(), stdev: emptyVector(), poolSize: 0 }, players: [] };
  }
  const targetSize = Math.min(pool.length, rosterSize * Q_POOL_MULTIPLIER);
  let stats = statsFromPlayers(pool, cats);
  let current = pool;
  for (let i = 0; i < Q_POOL_ITERATIONS; i++) {
    const ranked = [...pool]
      .map((p) => {
        const z = zVector(p, stats, cats);
        if (cap !== undefined) {
          for (const c of cats) z[c] = clamp(z[c], cap);
        }
        return { p, score: sumVector(z, cats) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, targetSize)
      .map((x) => x.p);
    current = ranked;
    stats = statsFromPlayers(ranked, cats);
  }
  return { stats, players: current };
}

// G-score per category. Denominator = poolStdev^2 + kappa * weekVar (in
// stdev units). We approximate weekVar via PROXY_WEEK_VARIANCE; Phase 1.5
// will replace with empirical per-player variance from gamelogs.
export function gVector(player: PlayerProjection, stats: PoolStats): CategoryVector {
  const g = emptyVector();
  for (const c of CATEGORIES) {
    const poolVar = stats.stdev[c] * stats.stdev[c];
    const weekVar = PROXY_WEEK_VARIANCE[c] * stats.stdev[c] * PROXY_WEEK_VARIANCE[c] * stats.stdev[c];
    const denom = Math.sqrt(poolVar + G_SCORE_KAPPA * weekVar);
    g[c] = (player.perGame[c] - stats.mean[c]) / Math.max(denom, STDEV_FLOOR);
  }
  return g;
}

export function gScore(player: PlayerProjection, stats: PoolStats): number {
  return sumVector(gVector(player, stats));
}

// ---------------------------------------------------------------------------
// Ranking v2 base value. See docs/RANKING_V2_SPEC.md and HANDOFF.md phase 2.
//
// This replaces the DURANT base score. The legacy score z-scored season
// TOTALS over the whole 666-player population, then multiplied the result by
// injury, low-games and schedule factors. Three things went wrong: players
// who missed time were punished for the games they missed rather than judged
// on the games they played; the population mean was dragged down by players
// no one would roster; and because the multipliers were applied to a signed
// score, a 0.3x injury factor RAISED the value of anyone already below zero.
//
// The replacement is a plain per-game z against a starter-quality pool, with
// small samples shrunk toward that pool and each category clamped. Nothing
// multiplies the result. Measured against the FantasyPros 6-expert consensus
// top 150 this moves rank correlation from 0.296 to 0.786.
//
// The reference implementation is tools/proto.py; tools/rank-v2-vs-experts.ts
// asserts this function reproduces it on the Oct 12 2026 snapshot.
// ---------------------------------------------------------------------------

export interface BaseValueInput {
  id: string;
  gamesPlayed: number;
  // Already-per-game rates. This is the shape HANDOFF phase 1 will produce
  // once normalization moves to parse time; prefer it when present.
  perGame?: Partial<CategoryVector> | null;
  // Season totals, the shape ESPN gives us today. Divided by gamesPlayed.
  seasonTotals?: Partial<CategoryVector> | null;
  // Full-season projected totals. Only consulted when gamesPlayed is 0.
  projectedSeason?: Partial<CategoryVector> | null;
}

export interface BaseValueRow {
  id: string;
  gamesPlayed: number;
  perGame: CategoryVector; // raw rate, before shrink
  shrunk: CategoryVector; // after shrink toward the pool mean
  z: CategoryVector; // after shrink and clamp
  baseValue: number; // sum of z over the league's categories
}

export interface BaseValueOptions {
  categories?: readonly Category[];
  rosterSize?: number;
}

export interface BaseValueResult {
  rows: BaseValueRow[];
  stats: PoolStats;
  poolSize: number;
}

function num(v: number | undefined): number {
  return typeof v === "number" && isFinite(v) ? v : 0;
}

// Step 1. Per-game rate. Prefer an explicit per-game vector, else divide
// season totals by games played, else pro-rate the projection over a full
// season. Mirrors per_game() in tools/proto.py.
function toPerGame(input: BaseValueInput, cats: readonly Category[]): CategoryVector {
  const pg = emptyVector();
  const gp = input.gamesPlayed;
  if (input.perGame) {
    for (const c of cats) pg[c] = num(input.perGame[c]);
    return pg;
  }
  if (gp > 0) {
    const totals = input.seasonTotals ?? {};
    for (const c of cats) pg[c] = num(totals[c]) / gp;
    return pg;
  }
  const projected = input.projectedSeason ?? {};
  for (const c of cats) pg[c] = num(projected[c]) / FULL_SEASON_GAMES;
  return pg;
}

// Adapt a per-game vector to the PlayerProjection shape buildQPool consumes.
// Only id and perGame are read on that path.
function asProjection(id: string, perGame: CategoryVector): PlayerProjection {
  return {
    id,
    name: id,
    team: "",
    positions: [],
    gamesRemaining: 0,
    perGame,
    injuryStatus: "UNKNOWN",
  };
}

export function computeBaseValues(
  players: BaseValueInput[],
  opts: BaseValueOptions = {},
): BaseValueResult {
  const cats = opts.categories && opts.categories.length > 0 ? opts.categories : CATEGORIES;
  const rosterSize = opts.rosterSize && opts.rosterSize > 0 ? opts.rosterSize : DEFAULT_ROSTER_SIZE;

  const prepared = players.map((input) => ({
    input,
    perGame: toPerGame(input, cats),
  }));

  if (prepared.length === 0) {
    return {
      rows: [],
      stats: { mean: emptyVector(), stdev: emptyVector(), poolSize: 0 },
      poolSize: 0,
    };
  }

  // Step 2. First-pass pool is everyone with a real sample. Below MIN_GP_POOL
  // games the per-game rate says more about noise than about the player, so
  // those rows are scored against the pool but never help define it. If no
  // one clears the bar (a synthetic fixture, or a snapshot taken on opening
  // night) fall back to the whole population rather than dividing by nothing.
  const eligible = prepared.filter((r) => r.input.gamesPlayed >= MIN_GP_POOL);
  const firstPass = eligible.length > 0 ? eligible : prepared;

  // Step 3. Iterate the pool down to starter quality. Pool selection uses the
  // same clamp as the final score so a single category outlier cannot buy a
  // seat in the reference pool.
  const { stats, players: qPool } = buildQPool(
    firstPass.map((r) => asProjection(r.input.id, r.perGame)),
    rosterSize,
    { categories: cats, cap: Z_CAP },
  );

  const rows: BaseValueRow[] = prepared.map(({ input, perGame }) => {
    const gp = input.gamesPlayed;
    // Step 4. Shrink toward the pool mean in proportion to sample size. A
    // full season is taken at face value. gp = 0 lands on w = 0, which is
    // the pool mean exactly and therefore a base value of 0: we are saying
    // "no evidence", not "average player".
    const w = gp < FULL_SEASON_GAMES ? gp / (gp + SHRINK_K) : 1;
    const shrunk = emptyVector();
    const z = emptyVector();
    let baseValue = 0;
    for (const c of cats) {
      shrunk[c] = w * perGame[c] + (1 - w) * stats.mean[c];
      // Step 5.
      z[c] = clamp((shrunk[c] - stats.mean[c]) / stats.stdev[c], Z_CAP);
      // Step 6.
      baseValue += z[c];
    }
    return { id: input.id, gamesPlayed: gp, perGame, shrunk, z, baseValue };
  });

  return { rows, stats, poolSize: qPool.length };
}

// Apply a 0-to-1 multiplier (availability, opportunity) to a base value
// without ever improving a negative one. The legacy code multiplied signed
// scores directly, which is how an OUT player on a -4.2 z outranked a healthy
// player on -4.1. Every haircut in the app goes through here.
export function applyHaircut(baseValue: number, factor: number): number {
  return baseValue > 0 ? baseValue * factor : baseValue;
}
