// Team fit during a draft: which available player most helps the roster
// the user has actually built, as opposed to who is simply best.
// docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md B1.
//
// Pure, per CLAUDE.md.
//
// Best value and best fit are shown side by side rather than blended into
// one number, because they answer different questions and the user is the
// one who should trade them off. Blending hides the choice.
//
// NOTE ON INPUTS. The spec writes this in terms of Part A's seasonValue and
// expectedGP. Part A did not ship: its board gates failed (see
// docs/RANKINGS_V3_BACKTEST.md). So the shape of the formula is the
// spec's, but it is driven by what the app actually has today: the shipped
// board value and ESPN's projected games. If Part A ships later, the only
// change needed here is passing expectedGP from the durability model
// instead of ESPN's number.

import { CATEGORIES, type Category, type CategoryVector } from "../shared/types";

// Weight on a category by how badly the roster needs it. Ranks are 1 (best
// in the league) to teamCount (worst).
export const FIT_WEIGHT_WEAK = 1.5;
export const FIT_WEIGHT_EVEN = 1.0;
export const FIT_WEIGHT_STRONG = 0.5;

// Scales the whole fit bonus against board value.
export const FIT_LAMBDA = 0.5;

// Fit is noise until the roster says something. Before the user's third
// pick, one player dominates every category total.
export const FIT_MIN_PICKS = 2;

const SEASON_GAMES = 82;

export interface FitPlayer {
  playerId: number;
  // Per-game projected production, by category.
  perGame: CategoryVector;
  // Per-game category z against the draftable pool.
  z: CategoryVector;
  // Games this player is expected to play.
  expectedGP: number;
}

function emptyVector(): CategoryVector {
  return { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
}

// Season production for a roster: per-game rate times games, summed. A
// 30-game star contributes 30 games of production, not a full season of it.
export function rosterCategoryTotals(players: FitPlayer[]): CategoryVector {
  const out = emptyVector();
  for (const p of players) {
    for (const c of CATEGORIES) {
      out[c] += (p.perGame[c] || 0) * (p.expectedGP || 0);
    }
  }
  return out;
}

// The user's rank in each category, 1 best. Teams with no picks yet all sit
// at zero and tie; that is fine, because fit does not switch on until the
// user has three picks anyway.
export function categoryRanks(
  totalsByTeam: Map<string, CategoryVector>,
  myTeamId: string,
): Record<Category, number> {
  const out = {} as Record<Category, number>;
  const mine = totalsByTeam.get(myTeamId);
  for (const c of CATEGORIES) {
    const myValue = mine ? mine[c] : 0;
    let better = 0;
    for (const [teamId, totals] of totalsByTeam) {
      if (teamId === myTeamId) continue;
      if (totals[c] > myValue) better++;
    }
    out[c] = better + 1;
  }
  return out;
}

export function fitWeights(
  ranks: Record<Category, number>,
  teamCount: number,
): CategoryVector {
  // Thirds of the league: top third already strong, bottom third weak.
  const third = Math.max(1, Math.round(teamCount / 4));
  const out = emptyVector();
  for (const c of CATEGORIES) {
    const rank = ranks[c];
    if (rank <= third) out[c] = FIT_WEIGHT_STRONG;
    else if (rank <= third * 2) out[c] = FIT_WEIGHT_EVEN;
    else out[c] = FIT_WEIGHT_WEAK;
  }
  return out;
}

// fitBonus = lambda * sum over cats of (weight - 1) * z * expectedGP / 82
//
// (weight - 1) is the point: an even category contributes nothing, a weak
// one adds, a strong one subtracts. A player who piles on a category the
// roster already leads is actively worth less than their board value.
export function fitBonus(
  player: FitPlayer,
  weights: CategoryVector,
  lambda: number = FIT_LAMBDA,
): number {
  let sum = 0;
  for (const c of CATEGORIES) {
    sum += (weights[c] - 1) * (player.z[c] || 0);
  }
  return (lambda * sum * (player.expectedGP || 0)) / SEASON_GAMES;
}

export interface FitRecommendation {
  // Top available by board value alone.
  valueId: number | null;
  // Top available by board value plus fit bonus.
  fitId: number | null;
  // True once the user has enough roster for fit to mean anything.
  active: boolean;
  ranks: Record<Category, number>;
  weights: CategoryVector;
  // Weakest categories, worst first, for the one-line explanation.
  weakest: Array<{ category: Category; rank: number }>;
}

export interface FitInput {
  available: FitPlayer[];
  // Board value per player id, the number the Draft Room already sorts on.
  valueOf: (playerId: number) => number;
  totalsByTeam: Map<string, CategoryVector>;
  myTeamId: string;
  myPickCount: number;
  teamCount: number;
  lambda?: number;
}

export function recommendValueAndFit(input: FitInput): FitRecommendation {
  const ranks = categoryRanks(input.totalsByTeam, input.myTeamId);
  const weights = fitWeights(ranks, input.teamCount);
  const active = input.myPickCount >= FIT_MIN_PICKS;

  let valueId: number | null = null;
  let bestValue = -Infinity;
  let fitId: number | null = null;
  let bestFit = -Infinity;

  for (const p of input.available) {
    const value = input.valueOf(p.playerId);
    if (!Number.isFinite(value)) continue;
    if (value > bestValue) {
      bestValue = value;
      valueId = p.playerId;
    }
    const combined = value + fitBonus(p, weights, input.lambda ?? FIT_LAMBDA);
    if (combined > bestFit) {
      bestFit = combined;
      fitId = p.playerId;
    }
  }

  const weakest = CATEGORIES.map((c) => ({ category: c, rank: ranks[c] }))
    .filter((r) => weights[r.category] === FIT_WEIGHT_WEAK)
    .sort((a, b) => b.rank - a.rank);

  return {
    valueId,
    fitId: active ? fitId : valueId,
    active,
    ranks,
    weights,
    weakest,
  };
}
