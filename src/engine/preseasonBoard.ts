// The preseason board, v3: durability, value above replacement, and a
// log-rank blend with the market.
// docs/RANKINGS_V3_ADDENDUM.md section 3.
//
// Pure, per CLAUDE.md. js/engines.js calls this once per sync and copies
// the result onto the player objects.
//
// Three steps, each measured separately in docs/RANKINGS_V3_BACKTEST.md:
//   1. Expected games from the player's own attendance record, not from
//      ESPN's optimism (src/engine/durability.ts).
//   2. Value measured against the waiver wire rather than against an
//      average starter, times those games (src/engine/replacement.ts).
//   3. Blend with Yahoo ADP, ESPN ADP and the expert consensus in log-rank
//      space (src/engine/blend.ts).

import { blendBoard } from "./blend";
import { durabilityDetail, type DurabilityDetail } from "./durability";
import { replacementLevel, seasonValueFor } from "./replacement";

export interface PreseasonPlayerInput {
  id: number;
  // Sum of capped per-game category z, from computeBaseValues. The shipped
  // per-game value, unchanged by any of this.
  rateValue: number;
  // Normalized name, for matching the market lists.
  key: string;
  espnGP: number;
  priorGP: number[];
  onTeam: boolean;
  suspect: boolean;
  // Live ESPN ADP from the league fetch. Preferred over the market file.
  espnAdp?: number | null;
}

export interface PreseasonMarket {
  // normalized name -> rank
  yahoo?: Map<string, number> | null;
  ecr?: Map<string, number> | null;
  espn?: Map<string, number> | null;
}

export interface PreseasonBoardRow {
  id: number;
  rateValue: number;
  expectedGP: number;
  seasonValue: number;
  durability: DurabilityDetail;
  // Rank by seasonValue alone: the "5-cat" column.
  fiveCatRank: number;
  // Average market rank, or null when no list had this player.
  marketRank: number | null;
  // The board. Equals fiveCatRank when no market data is available.
  blendRank: number;
}

export interface PreseasonBoardResult {
  rows: PreseasonBoardRow[];
  replacement: number;
  leagueMeanGP: number;
  // How many market lists actually contributed.
  marketListCount: number;
}

export interface PreseasonBoardOptions {
  poolSize: number;
  market?: PreseasonMarket;
}

export function buildPreseasonBoard(
  players: PreseasonPlayerInput[],
  options: PreseasonBoardOptions,
): PreseasonBoardResult {
  if (!players.length) {
    return { rows: [], replacement: 0, leagueMeanGP: 0, marketListCount: 0 };
  }

  // League mean games for rotation players, from this pool rather than a
  // constant, so it tracks whatever ESPN is projecting this year.
  const rotation = players.filter((p) => p.espnGP >= 20).flatMap((p) => p.priorGP);
  const leagueMeanGP = rotation.length
    ? rotation.reduce((a, b) => a + b, 0) / rotation.length
    : 65;

  const detail = new Map<number, DurabilityDetail>();
  for (const p of players) {
    detail.set(
      p.id,
      durabilityDetail({
        espnGP: p.espnGP,
        priorGP: p.priorGP,
        leagueMeanGP,
        onTeam: p.onTeam,
      }),
    );
  }

  const replacement = replacementLevel(
    players.map((p) => p.rateValue),
    options.poolSize,
  );

  const rows: PreseasonBoardRow[] = players.map((p) => {
    const d = detail.get(p.id) as DurabilityDetail;
    return {
      id: p.id,
      rateValue: p.rateValue,
      expectedGP: d.expectedGP,
      seasonValue: seasonValueFor(p.rateValue, replacement, d.expectedGP, p.suspect),
      durability: d,
      fiveCatRank: 0,
      marketRank: null,
      blendRank: 0,
    };
  });

  // 5-cat rank: Larry's own board, before the market has a say.
  const byValue = rows.slice().sort((a, b) => b.seasonValue - a.seasonValue);
  byValue.forEach((r, i) => {
    r.fiveCatRank = i + 1;
  });

  // Which market lists do we actually have? A missing one renormalizes the
  // weights rather than voting "unranked" for everybody.
  const market = options.market || {};
  const lists: Array<Map<string, number> | null | undefined> = [
    market.yahoo,
    market.espn,
    market.ecr,
  ];
  const present = lists.filter((l) => l && l.size > 0) as Array<Map<string, number>>;

  const byId = new Map<number, PreseasonPlayerInput>();
  for (const p of players) byId.set(p.id, p);

  // Live ESPN ADP from the league fetch beats the committed file, so it is
  // substituted in for the ESPN slot when present on the player.
  const hasLiveEspnAdp = players.some(
    (p) => typeof p.espnAdp === "number" && (p.espnAdp as number) > 0,
  );
  const marketCount = present.length + (hasLiveEspnAdp && !market.espn ? 1 : 0);

  if (!marketCount) {
    // No market at all: the board is Larry's board.
    for (const r of rows) r.blendRank = r.fiveCatRank;
    return { rows, replacement, leagueMeanGP, marketListCount: 0 };
  }

  const blended = blendBoard(
    rows.map((r) => {
      const p = byId.get(r.id) as PreseasonPlayerInput;
      const ranks: Array<number | undefined> = [];
      if (market.yahoo && market.yahoo.size) ranks.push(market.yahoo.get(p.key));
      if (market.espn && market.espn.size) {
        ranks.push(market.espn.get(p.key));
      } else if (hasLiveEspnAdp) {
        ranks.push(
          typeof p.espnAdp === "number" && p.espnAdp > 0 ? p.espnAdp : undefined,
        );
      }
      if (market.ecr && market.ecr.size) ranks.push(market.ecr.get(p.key));
      return {
        id: r.id,
        larryRank: r.fiveCatRank,
        marketRanks: ranks,
        larryValue: r.seasonValue,
      };
    }),
  );

  const rowById = new Map<number, PreseasonBoardRow>();
  for (const r of rows) rowById.set(r.id, r);
  for (const b of blended) {
    const r = rowById.get(b.id);
    if (!r) continue;
    r.blendRank = b.blendRank;
    r.marketRank = b.marketRank;
  }

  return { rows, replacement, leagueMeanGP, marketListCount: marketCount };
}

// Durability dot for the UI: green durable, yellow some risk, red fragile.
export function durabilityBand(expectedGP: number): "green" | "yellow" | "red" {
  if (expectedGP >= 70) return "green";
  if (expectedGP >= 55) return "yellow";
  return "red";
}
