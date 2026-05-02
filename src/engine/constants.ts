// Magic numbers for the v2 recommendation engine. Tunable in Phase 7 backtest.

import type { Category, CategoryVector } from "../shared/types";

// Q-pool sizing. Top N players (ranked by first-pass z-score) form the
// reference pool used to compute mean and stdev for z and G scores.
// Empirically: ~12x roster size approximates "starter-quality" players in a
// fantasy league. Iterate twice so the pool stabilizes.
export const Q_POOL_MULTIPLIER = 12;
export const Q_POOL_ITERATIONS = 2;

// Roster size assumption when we cannot derive it from RosterContext. Larry's
// default is 13 (10 starters + 3 bench) but callers should always pass the
// real number.
export const DEFAULT_ROSTER_SIZE = 13;

// G-score variance kappa. final variance term = var_acrossPlayers + kappa *
// var_weekToWeek. kappa = 1.0 weights player-pool variance and per-player
// week-to-week noise equally. Empirical kappa per category gets tuned in
// Phase 7 backtest.
export const G_SCORE_KAPPA = 1.0;

// Default alpha (team-fit blend) for in-season recommendations. final =
// gScore + alpha * fit_bonus. 0.3 keeps G-score dominant but lets a
// genuinely needy category move recommendations meaningfully.
// Phase 1 does NOT detect leverage (close matchup, late round, etc.). That
// goes in Phase 4+.
export const ALPHA_IN_SEASON = 0.3;

// Draft mode weights team-fit higher: roster construction is the entire
// game in draft. 0.6 still keeps G-score in front but allows the need
// vector to flip between rounds. Not exercised in Phase 1 but defined here
// so future code paths use the same constant.
export const ALPHA_DRAFT = 0.6;

// Position-fullness penalty. If every roster slot for ALL of a player's
// listed positions is filled, subtract this from the player's final score.
// Light penalty: 0.5 nudges away from redundancy without hard-locking out a
// genuinely better player. Set to 0 in draft mode (any position is fair).
export const POSITION_PENALTY = 0.5;

// Floor on stdev when computing z-scores. Protects against divide-by-zero
// when a category has no spread in a degenerate test pool.
export const STDEV_FLOOR = 1e-6;

// Per-category week-to-week variance proxy (in stdev units). Used when the
// engine has no real per-game variance data yet (Phase 1 reads ESPN's
// aggregated kona projections, which are season-totals, not gamelogs).
// Numbers are conservative defaults derived from typical NBA category
// volatility: PTS and REB are smooth, BLK and STL spike.
export const PROXY_WEEK_VARIANCE: CategoryVector = {
  REB: 0.08,
  AST: 0.10,
  STL: 0.18,
  BLK: 0.20,
  PTS: 0.06,
};

// How many top players we ship to explain.ts (Claude rationale layer).
export const EXPLAIN_TOP_N = 5;

// Confidence baseline. Phase 1 has no real signal yet, so we use games
// remaining as a proxy: more games left = more reliable. A player with 30+
// games gets ~1.0; a player with <10 (recent injury return, late callup)
// gets a lower number that the UI can render as a warning.
export function projectionConfidence(gamesRemaining: number): number {
  if (gamesRemaining <= 0) return 0;
  if (gamesRemaining >= 30) return 1.0;
  return Math.max(0.2, gamesRemaining / 30);
}

// ESPN stat ID -> Category. Documented here so the projection source has
// one place to look. Per CLAUDE.md / ESPN API: 0=PTS, 1=BLK, 2=STL, 3=AST,
// 6=REB.
export const ESPN_STAT_ID_TO_CATEGORY: Record<number, Category> = {
  0: "PTS",
  1: "BLK",
  2: "STL",
  3: "AST",
  6: "REB",
};

// ESPN position ID -> position string. 1=PG, 2=SG, 3=SF, 4=PF, 5=C.
// 12=Bench, 13=IR are slot ids, not positions; not included here.
export const ESPN_POSITION_ID_TO_NAME: Record<number, "PG" | "SG" | "SF" | "PF" | "C"> = {
  1: "PG",
  2: "SG",
  3: "SF",
  4: "PF",
  5: "C",
};
