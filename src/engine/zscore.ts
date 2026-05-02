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
  G_SCORE_KAPPA,
  PROXY_WEEK_VARIANCE,
  Q_POOL_ITERATIONS,
  Q_POOL_MULTIPLIER,
  STDEV_FLOOR,
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

function statsFromPlayers(players: PlayerProjection[]): PoolStats {
  const stats: PoolStats = {
    mean: emptyVector(),
    stdev: emptyVector(),
    poolSize: players.length,
  };
  for (const c of CATEGORIES) {
    const values = players.map((p) => p.perGame[c]);
    const { mean, stdev } = meanStdev(values);
    stats.mean[c] = mean;
    stats.stdev[c] = stdev;
  }
  return stats;
}

export function zVector(player: PlayerProjection, stats: PoolStats): CategoryVector {
  const z = emptyVector();
  for (const c of CATEGORIES) {
    z[c] = (player.perGame[c] - stats.mean[c]) / stats.stdev[c];
  }
  return z;
}

export function sumVector(v: CategoryVector): number {
  let s = 0;
  for (const c of CATEGORIES) s += v[c];
  return s;
}

// Build a league-aware Q pool by ranking everyone on first-pass z over the
// full population, taking the top N, and recomputing. Iterate Q_POOL_ITERATIONS
// times. Returns the final pool stats and the pool itself (callers may want
// to inspect it).
export function buildQPool(
  pool: PlayerProjection[],
  rosterSize: number,
): { stats: PoolStats; players: PlayerProjection[] } {
  if (pool.length === 0) {
    return { stats: { mean: emptyVector(), stdev: emptyVector(), poolSize: 0 }, players: [] };
  }
  const targetSize = Math.min(pool.length, rosterSize * Q_POOL_MULTIPLIER);
  let stats = statsFromPlayers(pool);
  let current = pool;
  for (let i = 0; i < Q_POOL_ITERATIONS; i++) {
    const ranked = [...pool]
      .map((p) => ({ p, score: sumVector(zVector(p, stats)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, targetSize)
      .map((x) => x.p);
    current = ranked;
    stats = statsFromPlayers(ranked);
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
