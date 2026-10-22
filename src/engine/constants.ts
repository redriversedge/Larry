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

// Team count assumption, for the same reason. teamCount * rosterSize is the
// number of rostered players in the league, so the first player past it is
// the waiver wire. A 10-team league has a much shallower wire.
export const DEFAULT_TEAM_COUNT = 12;

// Width of the replacement-level band, in players. The line is the mean
// prior of the players ranked just past the last rostered spot, averaged
// over this many of them rather than read off a single player, because one
// row's projection is noisy and the line it anchors moves every unprojected
// player on the board.
export const REPLACEMENT_BAND_WIDTH = 20;

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
// Fitted on the owner's real draft history: fit on the 2019 to 2025 drafts
// with each season's profiles built from prior seasons only, held out on
// 2026. Every number below is from that fit.
//
// Held-out 2026, mean log-likelihood per pick:
//
//   log form, fitted                 -3.094   <- shipped
//   log form, rank-only refit        -3.13
//   log form, previous constants     -3.23
//   linear form, fitted              -3.69
//
// The log form beats the best linear fit by 0.57 nats and passes the
// top-pick gate at 100%. That is a real margin, unlike the 0.03 nats the
// linear form managed over its own rank-only baseline.
//
// Component ablation on held-out 2026, log form:
//
//   beta    -0.012   HURTS, ships at 0
//   lambda  +0.005
//   alpha   +0.011
//   gamma   +0.003
//
// The profile terms are worth a few thousandths of a nat each. ESPN ADP
// explains most of what happens in this league and nine years of history
// adds a little on top. Worth having, not worth overselling.
export const MOCK_FITTED = true;

// How the rank term enters the utility: -rank/tau or -ln(rank)/tau.
//
// The LOG form is what ships, and the reason is that one linear tau cannot
// describe a draft. Under -rank/tau the gap between consecutive players is
// the same everywhere on the board: 1/tau between ADP 1 and 2, and 1/tau
// between ADP 100 and 101. But a real draft is nearly deterministic at the
// top and nearly a free-for-all by round 10. Fitting one tau to both ends
// splits the difference and gets both wrong, which is exactly what the
// owner's fit on the real 2019 to 2025 drafts showed: held-out 2026 mean
// log-likelihood -3.69 fitted against -3.72 for a rank-only refit, a gain
// of 0.03 nats, while the ADP #1 player went first in only 19% of drafts.
//
// Under -ln(rank)/tau the gap is ln(2) - ln(1) = 0.69 at the top of the
// board and ln(101) - ln(100) = 0.01 at pick 100. Same single parameter,
// but the shape now matches how drafts actually behave: consensus early,
// loose late. MOCK_TOP_PICK_* below is the acceptance test that pins it.
export const MOCK_RANK_FORM: "linear" | "log" = "log";

// Acceptance test on the shipped parameters, enforced by
// tests/engine/mockDraft.test.ts and reported by tools/fit-mock-draft.ts.
// The ADP #1 player has to go inside the first MOCK_TOP_PICK_WINDOW picks
// in at least MOCK_TOP_PICK_SHARE of simulated drafts. This replaced a
// weaker "not still there at pick 10" check, which the linear form could
// pass while still letting the consensus number one slide to pick 6.
export const MOCK_TOP_PICK_WINDOW = 3;
export const MOCK_TOP_PICK_SHARE = 0.95;
export const MOCK_TOP_PICK_SIMS = 500;

// Softmax temperature per phase. Higher means more willing to leave the
// board. It rises through the draft because late rounds are where personal
// preference shows up; round 1 is close to consensus for everyone.
//
// These are LOG-form taus and are not comparable to linear ones: the units
// are log-slots, and ln(400) is only 6, so sensible values are fractions.
// The 1 : 1.67 : 3 ratio between phases is the spec's.
//
// Fitted values. tauMid landing a hair below tauEarly is not a typo and not
// worth smoothing: the fit put them within 0.01 of each other, which says
// rounds 1 through 7 behave about the same in this league and the real
// loosening happens from round 8.
//
// For the record, measured against MOCK_TOP_PICK_*, 500 simulated drafts
// per row, which is what ruled the linear form out:
//
//   form     tauEarly   P(ADP #1 goes inside the first 3 picks)
//   linear   4.75         52.2%     <- the fitted linear value
//   linear   2.00         87.2%
//   log      0.60         91.0%
//   log      0.32        100.0%     <- shipped, fitted
//
// One linear tau controls both ends of the board at once, so the only way
// to make it pass was to drive it low enough that the late rounds became
// absurdly rigid. The log form does not have that problem.
export const MOCK_TAU_EARLY = 0.32;
export const MOCK_TAU_MID = 0.31;
export const MOCK_TAU_LATE = 0.84;

// tau is scaled by exp(beta * shrunk phase reach), so a manager who
// habitually reaches gets a flatter distribution over the board.
//
// Ships at ZERO, and this one is not merely unhelpful: on held-out 2026 the
// log-form ablation puts beta at -0.012, so turning it on makes the model
// actively WORSE. Reach is real and it stays on the profile card, but it
// does not predict the next pick once ESPN ADP is in the model. Which makes
// sense: a manager who reaches is telling you they disagree with the board,
// not which way they disagree.
export const MOCK_BETA = 0;

// Weight on category taste, on position overload, and on NBA team affinity.
// Fitted on the real drafts; see MOCK_FITTED for the ablation.
//
// gamma ships at 1 as a GUARDRAIL as much as a fitted value. Its ablation
// is +0.003, which is close enough to indifferent that the likelihood is
// not really the argument: it stops an AI team hoarding one position across
// a long mock. A model can be well calibrated on average and still produce
// one absurd roster, and an absurd roster is what the user notices. Held
// out at -3.094 with gamma 1.
export const MOCK_LAMBDA = 0.84;
export const MOCK_GAMMA = 1;
export const MOCK_ALPHA = 0.19;

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

// Only the top N available players by rank are scored for a pick.
//
// This started as a speed optimization and turned out to be a correctness
// knob, because of something a per-pick likelihood cannot see. Each deep
// player in the pool is individually unlikely, but there are a lot of them
// and their combined softmax mass is not small: over a 120-player pool it
// reached 17% at pick 8 in one probe. The result was an AI that reached
// constantly. Share of picks taken 20 or more slots ahead of ESPN ADP:
//
//                            round 1   round 2   rounds 3 to 5
//   real drafts 2019 to 26      0.0%      3.0%      14.0%
//   previous constants, 120     6.7%     17.0%      36.0%
//   fitted constants, 120       3.1%     10.9%      20.5%
//   fitted constants, 40        2.1%      7.5%      14.2%
//   fitted constants, 24        0.7%      2.3%       4.5%
//
// So the pool is capped by round: tight early, where real managers are
// close to the consensus board, and looser from round 3, where they are
// not. 24 then 40 reproduces the real reach frequency closely in rounds 1
// and 2 and lands inside the tolerance for rounds 3 to 5.
//
// This is a truncation of the model, not a reweighting, so the likelihood
// has to account for it: a real pick outside the cap is scored with its
// uncapped probability rather than as impossible. The cap covers 87% of
// real picks at 24. See scoreDraft in draftFit.ts.
//
// The availability simulations use the same pool as real picks, so the odds
// the user reads come from the same model that makes the picks.
export const MOCK_POOL_EARLY_ROUNDS = 2;
export const MOCK_CANDIDATE_POOL_EARLY = 24;
export const MOCK_CANDIDATE_POOL_LATE = 40;

// --- Draft Room: reach-frequency gate (the second thing logLik misses) ---

// A pick this many slots or more ahead of ESPN ADP counts as a reach.
export const MOCK_REACH_AHEAD_SLOTS = 20;

// Ceilings on the simulated reach rate in rounds 1 and 2, and the tolerance
// band around the real rate for rounds 3 to 5. Enforced by
// tools/fit-mock-draft.ts and tests/engine/draftFit.test.ts.
export const MOCK_REACH_R1_MAX = 0.02;
export const MOCK_REACH_R2_MAX = 0.05;
export const MOCK_REACH_R35_TOLERANCE = 0.05;

// --- Draft Room: availability odds (docs/DRAFT_ROOM_SPEC.md s6) ---

// Simulations per recalculation, and the reduced count used when a device
// cannot finish the full run inside the budget.
export const MOCK_AVAIL_SIMS = 500;
export const MOCK_AVAIL_SIMS_REDUCED = 250;

// Simulations per setTimeout slice, so the main thread stays responsive.
export const MOCK_AVAIL_CHUNK = 50;

// Odds are shown for this many players at the top of the current sort.
export const MOCK_AVAIL_TOP_N = 40;

// "Can wait" thresholds. If Larry's top available player is this likely or
// better to still be there at the user's next pick, the card recommends
// taking a SCARCE player now instead: the best Larry-ranked player whose
// availability is below MOCK_SCARCE_THRESHOLD. Taking the player who will
// not last and coming back for the one who will is strictly better when
// both are true.
export const MOCK_CAN_WAIT_THRESHOLD = 0.7;
export const MOCK_SCARCE_THRESHOLD = 0.5;

// --- Preseason board v3: blending Larry with the market ---
//
// The board is a log-rank blend of Larry's v3 board with three market
// lists (Yahoo ADP, ESPN ADP, FantasyPros ECR). Measured on real outcomes
// for both completed seasons, with Larry's board built from the durability
// model and value above replacement:
//
//   board                           24-25 rho / top24 / busts   25-26 rho / top24 / busts
//   current (shipped v2)              0.519 / 44.4 /  8           0.410 / 88.5 / 13
//   v3 (durability + replacement)     0.541 / 50.2 /  8           0.432 / 81.6 / 10
//   replacement only, ESPN GP         0.543 / 47.3 /  8           0.437 / 86.3 / 10
//   FantasyPros ECR                   0.533 / 40.9 /  7           0.430 / 76.5 / 11
//   Yahoo ADP                         0.519 / 45.5 /  6           0.548 / 74.2 /  9
//   ESPN ADP                          0.539 / 43.3 /  6           0.464 / 78.5 / 10
//   v3 blended 3:1:1:1                0.533 / 44.7 /  7           0.446 / 68.1 / 10
//
// The blend wins the paired bootstrap against the current board 0.99 and
// 0.90, and its per-game rho is 0.732 and 0.602 against the current
// board's 0.732 and 0.555, so the 5-category format edge survives.
//
// The 25-26 column moved in rankings v3.1 without the board changing: two
// rows in the history fixture have a projection of zero production in all
// five categories, the app has always kept such players off the board, and
// the backtest was scoring them. See CLAUDE.md.
//
// Larry weight 3 against 1 for each market list. Sensitivity: 2 and 3 are
// both good; 1 gives up too much of the format edge (per-game rho falls to
// 0.697 in 24-25) and 4 or more starts losing 25-26.
export const BLEND_LARRY_WEIGHT = 3;

// A market list that does not reach this deep is not saying the player is
// bad, only that he is outside the range the list covers.
export const BLEND_MARKET_DEPTH = 250;
export const BLEND_MISSING_RANK = 300;

// ESPN position ID -> position string. 1=PG, 2=SG, 3=SF, 4=PF, 5=C.
// 12=Bench, 13=IR are slot ids, not positions; not included here.
export const ESPN_POSITION_ID_TO_NAME: Record<number, "PG" | "SG" | "SF" | "PF" | "C"> = {
  1: "PG",
  2: "SG",
  3: "SF",
  4: "PF",
  5: "C",
};
