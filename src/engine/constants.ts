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

// --- Draft Room: manager profiles (docs/DRAFT_ROOM_SPEC.md s3) ---

// Half-width of the "picks made around here" comparison window, in overall
// slots. A pick's category residual is its z minus the mean z of the OTHER
// picks within this many slots. Wide enough to hold a comparison group at
// any point in the draft, narrow enough that the group is genuinely picking
// from the same board.
export const DRAFT_NEIGHBOR_WINDOW = 8;

// Category premium reads rounds 1 to 10 only. Deep-bench picks are mostly
// noise and lottery tickets, and including them washes out the signal.
export const DRAFT_PREMIUM_MAX_ROUND = 10;

// Position lean reads rounds 1 to 8, and is reported in percentage points
// of share against the league's share of the same picks.
export const DRAFT_POSITION_LEAN_MAX_ROUND = 8;
export const DRAFT_POSITION_LEAN_THRESHOLD = 8;

// NBA team affinity is display-led: show a team only when the manager has
// taken this many of its players AND at twice the league's rate.
export const DRAFT_AFFINITY_MIN_PICKS = 4;
export const DRAFT_AFFINITY_RATE_MULTIPLE = 2;
export const DRAFT_AFFINITY_TOP_N = 3;

// Under this many drafts a card is labelled "Small sample".
export const DRAFT_SMALL_SAMPLE_DRAFTS = 5;

// |t| thresholds on the category premium. Strong signals drive the AI;
// moderate ones are halved; anything weaker is treated as no signal at all,
// because a premium of 0.05 at t = 0.4 is a coin flip dressed as a read.
export const DRAFT_STRENGTH_STRONG_T = 2;
export const DRAFT_STRENGTH_MODERATE_T = 1.2;

// Minimum premium magnitude, in z units, before |t| is allowed to call
// anything a lean. t alone is not enough: it is mean over standard error, so
// a manager whose residuals have almost no spread can post |t| = 2.4 on a
// premium of 0.0003. That is a precisely measured non-effect. Every
// moderate or strong value in the spec's reference table is at least 0.11,
// so this floor cannot reclassify a real signal; it only rules out the
// degenerate case where the standard error collapses.
export const DRAFT_PREMIUM_MIN_EFFECT = 0.02;

// A strong negative premium reads as a deliberate punt only when the manager
// was positive in at most this many seasons. Otherwise it is "Avoids".
export const DRAFT_PUNT_MAX_POSITIVE_SEASONS = 1;

// Reach label cutoffs, in overall slots of ESPN ADP minus actual pick.
export const DRAFT_REACH_OFTEN_MEDIAN = 12;
export const DRAFT_REACH_BOARD_MEDIAN = 0;

// --- Draft Room: AI pick model (docs/DRAFT_ROOM_SPEC.md s4) ---
//
// u_i = -rank_i / tau(m, phase)
//       + lambda * w(m) . (premium(m) * z_i)
//       - gamma * overload(m, pos_i)
//       + alpha * affinity(m, team_i)
// and the pick is drawn from softmax(u).
//
// rank_i is ESPN ADP, not Larry's rank, on purpose. The model predicts what
// these managers will DO in the ESPN draft room, which is not a claim about
// what the right pick is.
//
// MOCK_FITTED is false while these are the spec's starting values rather
// than the output of tools/fit-mock-draft.ts. The UI footer reads it and
// says so. Flip it to true in the same commit that replaces the numbers,
// and record the measured log-likelihood and top-5 hit rate here.
export const MOCK_FITTED = false;

// Softmax temperature per phase, in units of ESPN ADP slots. Higher means
// more willing to leave the board. It rises through the draft because late
// rounds are where personal preference actually shows up; round 1 is close
// to consensus for everyone.
//
// These are the spec's provisional 6 / 10 / 18 divided by 3. The spec's raw
// values are too hot to be a draft. Measured over 400 simulated drafts on a
// synthetic board with flat profiles:
//
//   tau_early   P(#1 goes 1st)   P(#1 alive at pick 10)   mean |rank - pick|
//   6.00        0.165            0.1075                   5.5
//   3.00        0.290            0.0025                   2.8
//   2.00        0.370            0.0000                   1.9
//   1.50        0.485            0.0000                   1.4
//
// At 6 the consensus number one slides out of the top nine in 11% of
// drafts, which is not a thing that happens and which the spec's own
// acceptance test in s8 rules out. At 2 the board drifts by about two slots
// through the first two rounds, which is what a real draft looks like, and
// there is room left for profiles to add their own deviation on top.
//
// All seven of these remain unfitted. tools/fit-mock-draft.ts replaces them
// from the owner's real history; see MOCK_FITTED.
export const MOCK_TAU_EARLY = 2;
export const MOCK_TAU_MID = 3.33;
export const MOCK_TAU_LATE = 6;

// tau is scaled by exp(beta * shrunk phase reach), so a manager who
// habitually reaches gets a flatter distribution over the board. Unitless
// and inside an exponent, so the temperature rescaling above leaves it
// alone.
export const MOCK_BETA = 0.04;

// Weight on category taste, on position overload, and on NBA team affinity.
//
// lambda and gamma keep the spec's literal values even though tau was cut
// by 3, which makes the category term a third as influential relative to
// rank as the spec intended. That is deliberate and measured. Mean
// log-likelihood per pick on a held-out synthetic 2026 draft, scored by
// tests/engine/draftFit.test.ts' generator, where seven of twelve managers
// draft for a specific category:
//
//   weights                       tastes exist    nobody has a taste
//   rank only                       -1.7488           -1.4177
//   lambda 2,  gamma 3, alpha 0     -1.4537           -1.4177
//   lambda 4,  gamma 3, alpha 0     -1.3997           -1.4177
//   lambda 12, gamma 9, alpha 0     -2.0913           -1.4177
//   lambda 4,  gamma 3, alpha 3     -1.5112           -1.4314
//
// lambda 4 / gamma 3 / alpha 0 is the only row with both properties worth
// having: it beats rank-only by 0.35 nats when there is a taste to find,
// and it costs exactly nothing when there is not. Scaling lambda up with
// tau (the 12 row) is worse than ignoring profiles altogether.
//
// alpha ships at ZERO, which needs the honest version of the story. At
// these tau values an alpha of 3 is worth six ADP slots, and at that size
// NBA team affinity hurt in BOTH columns above, including the one where no
// manager had a real affinity: a by-the-board drafter still accumulates 4+
// players from some team at twice the league rate across nine seasons
// purely by chance, and the term fires on those false positives. Run the
// full fit, though, and the optimizer does want a SMALL nonzero alpha
// (1.625 at a fitted tauEarly of 1.9, so about three slots), worth +0.075.
//
// So affinity is not worthless, it is just worth less than any weight that
// can be guessed. Zero is the right unfitted default because it is exactly
// neutral; the fit can turn it back on once there is real data. Affinity
// stays on the profile card throughout, where it is an observation rather
// than a prediction.
//
// All of this is synthetic. The real fit and ablation need the owner's
// export; see tools/fit-mock-draft.ts and MOCK_FITTED.
export const MOCK_LAMBDA = 4;
export const MOCK_GAMMA = 3;
export const MOCK_ALPHA = 0;

// A manager's phase reach is shrunk toward the league median by
// n / (n + k), where n is their pick count in that phase. Without this, a
// manager with 3 late picks in one draft looks like a committed reacher.
export const MOCK_REACH_SHRINK_K = 15;

// Category weight by premium strength. Weak signals do not move the AI.
export const MOCK_WEIGHT_STRONG = 1;
export const MOCK_WEIGHT_MODERATE = 0.5;

// Position overload starts biting past this many at one primary position,
// counting rounds 1 to 10. Stops the AI building five centers by round 6.
export const MOCK_OVERLOAD_THRESHOLD = 3;

// Rank for a player with no ESPN ADP, no ESPN draft rank and no Larry rank.
// Effectively "off the board" without being infinite.
export const MOCK_RANK_FALLBACK = 400;

// Category z for the pick model is computed against the top N by ESPN rank,
// not the whole player universe, so "above average" means above a drafted
// player rather than above a deep-league waiver body.
export const MOCK_Z_POOL_SIZE = 200;

// Only the top N available players by rank are scored for a pick. Past this
// depth -rank/tau has made the softmax weight negligible, and evaluating the
// whole 500-player board on every simulated pick is what would blow the
// availability-odds budget on a phone. Sims use a tighter pool than real
// picks because they run thousands of times.
export const MOCK_CANDIDATE_POOL = 120;
export const MOCK_SIM_CANDIDATE_POOL = 60;

// --- Draft Room: availability odds (docs/DRAFT_ROOM_SPEC.md s6) ---

// Simulations per recalculation, and the reduced count used when a device
// cannot finish the full run inside the budget.
export const MOCK_AVAIL_SIMS = 500;
export const MOCK_AVAIL_SIMS_REDUCED = 250;

// Simulations per setTimeout slice, so the main thread stays responsive.
export const MOCK_AVAIL_CHUNK = 50;

// Odds are shown for this many players at the top of the current sort.
export const MOCK_AVAIL_TOP_N = 40;

// "Can wait" threshold: a higher-ranked player is only suggested as
// waitable at this availability or better.
export const MOCK_CAN_WAIT_THRESHOLD = 0.7;

// ESPN position ID -> position string. 1=PG, 2=SG, 3=SF, 4=PF, 5=C.
// 12=Bench, 13=IR are slot ids, not positions; not included here.
export const ESPN_POSITION_ID_TO_NAME: Record<number, "PG" | "SG" | "SF" | "PF" | "C"> = {
  1: "PG",
  2: "SG",
  3: "SF",
  4: "PF",
  5: "C",
};
