// Blending Larry's board with the market.
// docs/RANKINGS_V3_ADDENDUM.md section 3.
//
// Pure, per CLAUDE.md.
//
// Larry's board and the market make DIFFERENT mistakes, which is the whole
// reason this helps. The market knows things projections cannot: a player
// who looked bad in camp, a role that changed in September, an injury that
// has not reached a stat line. Larry knows the format, which the market
// does not: these lists are priced for 9-category and points leagues, and
// this league scores only REB, AST, STL, BLK and PTS. Averaging the two
// keeps most of each one's edge.
//
// In LOG rank space, not raw rank. The difference between ranks 1 and 11
// matters enormously and the difference between 191 and 201 does not;
// averaging raw ranks would treat them the same and would let one deep
// market list drag a genuine first-rounder down the board.

import {
  BLEND_LARRY_WEIGHT,
  BLEND_MARKET_DEPTH,
  BLEND_MISSING_RANK,
} from "./constants";

export interface BlendInput {
  id: number;
  // Rank on Larry's v3 board, 1 best.
  larryRank: number;
  // Rank on each market list, 1 best. Undefined when the player is absent
  // from that list.
  marketRanks: Array<number | undefined>;
  // Tie-break, higher is better. The v3 season value.
  larryValue?: number;
}

export interface BlendRow {
  id: number;
  blendScore: number;
  blendRank: number;
  larryRank: number;
  // Average of the market ranks actually used, for the "Mkt" column. Null
  // when no market list had this player.
  marketRank: number | null;
}

// A market list that does not go deep enough is not evidence that a player
// is bad, but it is weak evidence that he is not a early pick. Clamping
// past BLEND_MARKET_DEPTH to a single sentinel says "outside the useful
// range" without pretending to know how far outside.
export function marketRankOrMissing(rank: number | undefined): number {
  if (rank === undefined || !Number.isFinite(rank) || rank <= 0) return BLEND_MISSING_RANK;
  if (rank > BLEND_MARKET_DEPTH) return BLEND_MISSING_RANK;
  return rank;
}

export interface BlendOptions {
  larryWeight?: number;
  // Number of market lists the caller intends to use. Weights renormalize
  // when a list is unavailable, so a missing Yahoo file shifts weight to
  // Larry and the remaining lists rather than silently penalising everyone.
  marketCount?: number;
}

export function blendScore(
  larryRank: number,
  marketRanks: Array<number | undefined>,
  options: BlendOptions = {},
): number {
  const larryWeight = options.larryWeight ?? BLEND_LARRY_WEIGHT;
  const safeLarry = Math.max(larryRank, 1);

  let sum = larryWeight * Math.log(safeLarry);
  let weight = larryWeight;
  for (const r of marketRanks) {
    sum += Math.log(marketRankOrMissing(r));
    weight += 1;
  }
  // No market lists at all: the blend is just Larry's board.
  return weight > 0 ? sum / weight : Math.log(safeLarry);
}

export function blendBoard(
  players: BlendInput[],
  options: BlendOptions = {},
): BlendRow[] {
  const rows: BlendRow[] = players.map((p) => {
    const used = p.marketRanks.filter(
      (r) => r !== undefined && Number.isFinite(r) && (r as number) > 0,
    ) as number[];
    return {
      id: p.id,
      blendScore: blendScore(p.larryRank, p.marketRanks, options),
      blendRank: 0,
      larryRank: p.larryRank,
      marketRank: used.length
        ? used.reduce((a, b) => a + b, 0) / used.length
        : null,
    };
  });

  const valueById = new Map<number, number>();
  for (const p of players) valueById.set(p.id, p.larryValue ?? 0);

  rows.sort((a, b) => {
    if (a.blendScore !== b.blendScore) return a.blendScore - b.blendScore;
    // Stable on Larry's own value, so a tie never reorders run to run.
    const va = valueById.get(a.id) ?? 0;
    const vb = valueById.get(b.id) ?? 0;
    if (va !== vb) return vb - va;
    return a.id - b.id;
  });

  rows.forEach((r, i) => {
    r.blendRank = i + 1;
  });
  return rows;
}

// --- Market lists as the app and the backtest both see them ---

export interface MarketList {
  name: string;
  // normalized name -> rank
  ranks: Map<string, number>;
}

export function marketListFromRows(
  name: string,
  rows: Array<[string, number]> | undefined,
): MarketList | null {
  if (!rows || !rows.length) return null;
  const ranks = new Map<string, number>();
  rows.forEach(([playerName, value], index) => {
    if (!ranks.has(playerName)) {
      // ADP files carry an average draft position, ranking files carry a
      // rank. Position in the sorted list is the rank either way.
      ranks.set(playerName, Number.isFinite(value) ? index + 1 : index + 1);
    }
  });
  return { name, ranks };
}

// Market data older than this is stale enough to say so in the UI. It is
// not a reason to drop it: a week-old consensus still beats no consensus.
export const MARKET_STALE_DAYS = 7;

export function marketAgeDays(pulledAt: string | undefined, now: number): number | null {
  if (!pulledAt) return null;
  const then = Date.parse(pulledAt);
  if (!Number.isFinite(then)) return null;
  return (now - then) / (1000 * 60 * 60 * 24);
}
