// explain.ts: builds the structured payload for the Claude rationale
// layer. This module does NOT call the Claude API. It just shapes the
// engine output into a small, prompt-ready object that the Netlify
// function (/api/recommend-explain) can serialize.
//
// Per LARRY_PLAN.md: Claude narrates deterministic numbers; it never
// ranks or scores.

import type { Category, CategoryVector, RankedPlayer } from "../shared/types";
import { CATEGORIES } from "../shared/types";

export interface ExplainPayload {
  topPlayers: Array<{
    id: string;
    name: string;
    team: string;
    positions: string[];
    projection: CategoryVector;
    z: CategoryVector;
    final: number;
    fitBonus: number;
    why: string[];
  }>;
  // The user's team need vector. Strong positive = need; strong negative = surplus.
  teamNeeds: CategoryVector;
  // Convenience: the user's biggest need and biggest surplus.
  biggestNeed: { category: string; magnitude: number };
  biggestSurplus: { category: string; magnitude: number };
}

export function buildExplainPayload(
  topPlayers: RankedPlayer[],
  teamNeeds: CategoryVector,
): ExplainPayload {
  let needMaxCat: Category = "REB";
  let needMaxVal = -Infinity;
  let surplusMaxCat: Category = "REB";
  let surplusMaxVal = Infinity;
  for (const c of CATEGORIES) {
    const v = teamNeeds[c];
    if (v > needMaxVal) {
      needMaxVal = v;
      needMaxCat = c;
    }
    if (v < surplusMaxVal) {
      surplusMaxVal = v;
      surplusMaxCat = c;
    }
  }
  return {
    topPlayers: topPlayers.map((rp) => ({
      id: rp.player.id,
      name: rp.player.name,
      team: rp.player.team,
      positions: rp.player.positions,
      projection: rp.breakdown.projection,
      z: rp.breakdown.categoryDeltas,
      final: rp.breakdown.final,
      fitBonus: rp.breakdown.fitBonus,
      why: rp.breakdown.why,
    })),
    teamNeeds,
    biggestNeed: { category: needMaxCat, magnitude: needMaxVal },
    biggestSurplus: { category: surplusMaxCat, magnitude: surplusMaxVal },
  };
}
