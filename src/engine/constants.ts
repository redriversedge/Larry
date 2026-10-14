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

// --- Ranking v2 base value (docs/RANKING_V2_SPEC.md, HANDOFF.md phase 2) ---

// Shrink constant for small samples. pg' = w * pg + (1 - w) * poolMean where
// w = gp / (gp + SHRINK_K). At k=8 a 15-game sample keeps ~65% of its own
// rate; a 60-game sample keeps ~88%. This is what stops a star who missed
// most of last season from being ranked as a scrub: under the legacy
// totals-based z, Trae Young's 269 points over 15 games read as z = -3.0.
export const SHRINK_K = 8;

// Per-category z clamp. One freak category (a 10-stdev blocks outlier on a
// tiny sample) must not dominate the sum of five.
export const Z_CAP = 3.0;

// Minimum games played to join the first-pass pool that seeds the Q-pool
// iteration. Below this the per-game rate is too noisy to describe the
// population.
export const MIN_GP_POOL = 10;

// A full NBA season. Two uses: the divisor turning projectedSeason totals
// into a per-game rate, and the point past which no shrink applies.
export const FULL_SEASON_GAMES = 82;

// --- Preseason board ---
//
// Preseason the only availability signal in ESPN's data is projected games
// played: the injury tag does not track it (DAY_TO_DAY at 38 projected
// games, ACTIVE at 43, OUT at 68) and there are no return dates.
//
// Projected games at or above this are normal rest and minor knocks, so no
// discount applies. Below it, a partial one.
export const PRESEASON_LONG_TERM_GP = 60;

// Denominator of the discount. Not 82: a player projected for 70 games is
// not 15% worse than one projected for 82, they are both available. 72 is
// roughly a healthy starter's season.
export const PRESEASON_GP_REFERENCE = 72;

// Exponent on (projectedGP / reference). 0.5 is a square root, i.e. a soft
// discount. Measured against the FantasyPros 6-expert consensus top 150: no
// discount gives rho 0.719, this soft discount 0.720, and a full linear
// g/82 cut only 0.660 because it buries genuine long-term players far below
// where the experts have them.
export const PRESEASON_DISCOUNT_POWER = 0.5;

// --- Larry projections (Marcel) ---
//
// Season weights, most recent first: T-1, T-2, T-3. Tom Tango's original
// Marcel ratios, which hold up well for basketball too.
export const MARCEL_WEIGHTS = [5, 4, 3];

// Regression to the mean, in MINUTES of league-average play added to every
// player's sample. A player with 3000 weighted minutes barely moves; one
// with 200 is pulled most of the way to average, which is the right answer
// for a 10-game sample.
//
// The backtest is almost completely insensitive to this: rank correlation
// moves by 0.001 across the whole range 250 to 3000. Left at a round
// middle value rather than fit to the fourth decimal of one season.
// See docs/PROJECTIONS_BACKTEST.md.
export const MARCEL_REGRESSION_MINUTES = 1000;

// Minutes played below which a player does not help define the league
// average per-minute rate. Garbage-time lines would drag it down.
export const MARCEL_LEAGUE_MIN_MINUTES = 500;

// Minutes per game are regressed too, but only for players without much
// history: below this many total games the sample does not pin a role.
export const MARCEL_MPG_GP_FLOOR = 100;
export const MARCEL_MPG_PRIOR = 24;
export const MARCEL_MPG_PRIOR_WEIGHT = 0.25;

// Expected games played. Recent seasons matter more for availability than
// for production, so these weights are steeper than the Marcel ones.
export const GP_WEIGHTS = [0.5, 0.3, 0.2];
export const GP_PRIOR = 70;
export const GP_PRIOR_WEIGHT = 0.25;
export const GP_MAX = 82;

// A player with no usable history at all. ESPN's projected games are used
// first; this is the last resort.
export const GP_FALLBACK = 65;

// Share of the final RATE taken from Larry's model, the rest from ESPN.
//
// The backtest does not support a high value here. ESPN's rates beat
// Larry's for ranking on both the tuning season and the held-out one, and
// value rank correlation falls monotonically as this rises (2026: 0.839 at
// 0.0 down to 0.794 at 1.0). Pure rho would pick 0.0, but that makes the
// blend identical to ESPN and the whole model a no-op.
//
// 0.2 is the largest weight that costs nothing in rank correlation
// (0.839 on 2026, same as ESPN alone) while improving the stat lines:
// rebounds 0.863 -> 0.843 MAE, steals 0.203 -> 0.197, blocks 0.159 ->
// 0.156. That is the honest "if you turn it on" setting.
//
// It is moot by default: S.prefs.useLarryProjections ships FALSE because
// the spec's acceptance test failed. See docs/PROJECTIONS_BACKTEST.md.
export const PROJECTION_BLEND_ALPHA = 0.2;

// A projection this small is a data error, not a forecast. Tyrese
// Haliburton shipped as ACTIVE with a 1-game projection (20 PTS, 10 AST,
// 4 REB in that single game) while the experts have him 13th. Discounting
// on it would be compounding ESPN's mistake, so suspect players are left
// alone and flagged in the UI instead.
export const PRESEASON_SUSPECT_GP = 10;

// baseValue (a sum of z-scores, roughly -5 to +8) -> durantScore. The legacy
// score was zTotal * 10 and several absolute thresholds were tuned against
// that scale: the +3 free-agent notification gap in tabs.js, the trade
// acceptance margin and the 40/60 blend in engines.js. Scaling at the legacy
// boundary keeps those meaningful without touching three unrelated call
// sites. The engine itself always returns the unscaled baseValue.
export const DURANT_SCALE = 10;

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
