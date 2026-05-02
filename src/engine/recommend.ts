// recommend.ts: composes scoring, fit, position constraints into a ranked
// list of recommended pickups. Pure function over RecommendationContext.

import type {
  Breakdown,
  CategoryVector,
  EngineMeta,
  EngineOutput,
  PlayerProjection,
  Position,
  RankedPlayer,
  RecommendationContext,
  RosterContext,
} from "../shared/types";
import { CATEGORIES } from "../shared/types";
import {
  EXPLAIN_TOP_N,
  POSITION_PENALTY,
  projectionConfidence,
} from "./constants";
import { buildQPool, gVector, sumVector, type PoolStats, zVector } from "./zscore";
import {
  alphaFor,
  computeLeagueAverages,
  fitBonus,
  rosterTotal,
  teamNeedVector,
} from "./teamFit";

const INJURED_STATUSES = new Set(["OUT", "SUSPENSION", "INJURY_RESERVE", "IR"]);

function isInjured(p: PlayerProjection): boolean {
  return INJURED_STATUSES.has(p.injuryStatus);
}

// Standard fantasy basketball roster slots (Larry's default):
//  PG x1, SG x1, SF x1, PF x1, C x1, G x1, F x1, UTIL x3, Bench x3.
// We approximate "all slots filled for position P" by counting how many
// players on the roster are eligible at P and comparing to the slot quota
// for that position. For Phase 1 we use a conservative quota: 3 per
// pure position (counts the position-specific slot, the G/F flex if
// applicable, and any UTIL slot).
const POSITION_QUOTA: Record<Position, number> = {
  PG: 3,
  SG: 3,
  SF: 3,
  PF: 3,
  C: 2,
};

function positionPenalty(player: PlayerProjection, myPlayers: PlayerProjection[]): number {
  if (player.positions.length === 0) return 0;
  // Count current roster eligibility per position.
  const counts: Record<Position, number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
  for (const r of myPlayers) {
    for (const pos of r.positions) {
      counts[pos] += 1;
    }
  }
  // If for EVERY position the player covers the roster is at or above
  // quota, apply the penalty. If the player provides position relief at
  // any of their slots, no penalty.
  let allFilled = true;
  for (const pos of player.positions) {
    if (counts[pos] < POSITION_QUOTA[pos]) {
      allFilled = false;
      break;
    }
  }
  return allFilled ? POSITION_PENALTY : 0;
}

function whyForPlayer(
  z: CategoryVector,
  need: CategoryVector,
  posPenalty: number,
): string[] {
  const why: string[] = [];
  // Top contributing categories: where z * need is largest positive.
  const contributions = CATEGORIES.map((c) => ({
    cat: c,
    contribution: need[c] * z[c],
    z: z[c],
    need: need[c],
  })).sort((a, b) => b.contribution - a.contribution);
  const positives = contributions.filter((x) => x.contribution > 0.1).slice(0, 2);
  for (const p of positives) {
    why.push(
      `Strong in ${p.cat} (z=${p.z.toFixed(2)}); your roster is ${p.need.toFixed(2)} stdev below league average there.`,
    );
  }
  if (positives.length === 0) {
    // Fall back to raw strengths.
    const strongest = CATEGORIES.map((c) => ({ cat: c, z: z[c] }))
      .sort((a, b) => b.z - a.z)
      .slice(0, 2);
    for (const s of strongest) {
      if (s.z > 0.5) why.push(`Above pool average in ${s.cat} (z=${s.z.toFixed(2)}).`);
    }
  }
  // Note material drag categories.
  const drags = contributions.filter((x) => x.z < -0.5).slice(0, 1);
  for (const d of drags) {
    why.push(`Below pool average in ${d.cat} (z=${d.z.toFixed(2)}).`);
  }
  if (posPenalty > 0) {
    why.push("Position group already deep on your roster.");
  }
  return why;
}

function buildBreakdown(
  player: PlayerProjection,
  poolStats: PoolStats,
  need: CategoryVector,
  alpha: number,
  myPlayers: PlayerProjection[],
): Breakdown {
  const z = zVector(player, poolStats);
  const g = gVector(player, poolStats);
  const gScoreVal = sumVector(g);
  const fit = fitBonus(player, need, poolStats);
  const posPen = positionPenalty(player, myPlayers);
  const final = gScoreVal + alpha * fit - posPen;
  const why = whyForPlayer(z, need, posPen);
  return {
    gScore: gScoreVal,
    alpha,
    fitBonus: fit,
    positionPenalty: posPen,
    final,
    why,
    categoryDeltas: z,
    projection: player.perGame,
    confidence: projectionConfidence(player.gamesRemaining),
  };
}

// Filter: never include players already on the user's roster, or injured.
function eligibleCandidates(
  candidates: PlayerProjection[],
  roster: RosterContext,
): PlayerProjection[] {
  const onMyRoster = new Set(roster.myPlayers.map((p) => p.id));
  return candidates.filter((p) => !onMyRoster.has(p.id) && !isInjured(p));
}

export function recommend(ctx: RecommendationContext): EngineOutput {
  const candidates = eligibleCandidates(ctx.projectionSource.getFreeAgents(), ctx.roster);
  const rosterSize = Math.max(ctx.roster.myPlayers.length, 1);
  const referencePool = [...candidates, ...ctx.roster.myPlayers].filter((p) => !isInjured(p));
  const { stats: poolStats, players: qPool } = buildQPool(referencePool, rosterSize);
  const leagueAvg = computeLeagueAverages(ctx.roster);
  const need = teamNeedVector(ctx.roster, leagueAvg);
  const alpha = alphaFor(ctx.mode);

  const ranked: RankedPlayer[] = candidates
    .map((player) => ({
      player,
      breakdown: buildBreakdown(player, poolStats, need, alpha, ctx.roster.myPlayers),
    }))
    .sort((a, b) => b.breakdown.final - a.breakdown.final);

  const meta: EngineMeta = {
    qPoolSize: qPool.length,
    leagueSize: ctx.league.size,
    alphaUsed: alpha,
    poolStdev: poolStats.stdev,
    poolMean: poolStats.mean,
    generatedAt: new Date().toISOString(),
    engineVersion: "v2.0.0",
  };
  return { ranked, teamNeeds: need, meta };
}

// Convenience export: just the top N. Used by the integration layer in
// js/engines.js to avoid sending the full ranked list across the wire to
// /api/recommend-explain.
export function topN(output: EngineOutput, n = EXPLAIN_TOP_N): RankedPlayer[] {
  return output.ranked.slice(0, n);
}
