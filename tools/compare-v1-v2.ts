// Side-by-side: v2 engine vs a faithful slice of v1 Engine 4.
//
// We can't easily import js/engines.js (ES5 IIFE depending on globals), so
// this script reproduces the v1 recommend() *ranking step* using the
// already-computed durantScore and zScores stored in the snapshot. v1's
// final blend is `0.4 * DURANT + 0.6 * matchup-adjusted-z` when the strategy
// classifier produced category weights, otherwise raw DURANT. The snapshot
// shows the current strategy targets every category at weight 2, which
// makes matchup-adjusted-z roughly proportional to the sum of z-scores --
// so v1 collapses to a DURANT-led ranking.

import * as fs from "fs";
import * as path from "path";
import { recommend } from "../src/engine/recommend";
import { createInMemoryProjectionSource } from "../src/engine/projectionSource";
import type {
  CategoryVector,
  PlayerProjection,
  Position,
  RecommendationContext,
} from "../src/shared/types";
import { CATEGORIES } from "../src/shared/types";

interface SnapshotPlayer {
  id: number | string;
  name?: string;
  positions?: string[];
  nbaTeam?: string;
  injuryStatus?: string;
  onTeamId?: number;
  slotId?: number;
  gamesPlayed?: number;
  gamesRemaining?: number;
  durantScore?: number;
  effectiveDURANT?: number;
  zScores?: Partial<CategoryVector> & { total?: number };
  stats?: { season?: Record<string, number>; projectedSeason?: Record<string, number> };
}

interface SnapshotState {
  league?: { teamCount?: number };
  myTeam?: { teamId?: number; players?: SnapshotPlayer[] };
  teams?: Array<{ teamId: number }>;
  allPlayers?: SnapshotPlayer[];
  matchup?: { strategy?: { categoryWeights?: Record<string, number> } };
}

const INJURED = new Set(["OUT", "SUSPENSION", "INJURY_RESERVE", "IR"]);

function isFreeAgent(p: SnapshotPlayer): boolean {
  return (p.onTeamId ?? 0) === 0;
}

function isInjured(p: SnapshotPlayer): boolean {
  return p.injuryStatus !== undefined && INJURED.has(p.injuryStatus);
}

function asPosition(s: string): Position | null {
  if (s === "PG" || s === "SG" || s === "SF" || s === "PF" || s === "C") return s;
  return null;
}

function toProjection(p: SnapshotPlayer): PlayerProjection {
  const season = p.stats?.season ?? {};
  const projected = p.stats?.projectedSeason ?? {};
  const gp = p.gamesPlayed ?? 0;
  const perGame: CategoryVector = { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
  for (const c of CATEGORIES) {
    if (gp > 0) {
      const raw = season[c];
      perGame[c] = typeof raw === "number" ? raw / gp : 0;
    } else {
      const raw = projected[c];
      perGame[c] = typeof raw === "number" ? raw / 82 : 0;
    }
  }
  const positions: Position[] = (p.positions ?? [])
    .map(asPosition)
    .filter((x): x is Position => x !== null);
  return {
    id: String(p.id),
    name: p.name ?? `Player ${p.id}`,
    team: p.nbaTeam ?? "",
    positions,
    gamesRemaining: p.gamesRemaining ?? 0,
    perGame,
    injuryStatus: (p.injuryStatus ?? "ACTIVE") as PlayerProjection["injuryStatus"],
  };
}

function v1MatchupAdjusted(
  zs: Partial<CategoryVector> | undefined,
  weights: Record<string, number>,
): number {
  if (!zs) return 0;
  let sum = 0;
  for (const c of CATEGORIES) {
    const w = weights[c] ?? 1;
    const z = zs[c] ?? 0;
    sum += z * w;
  }
  return sum;
}

function main(): void {
  const inputPath = process.argv[2] ?? "tests/fixtures/users/cliff-real-roster.json";
  const absPath = path.resolve(inputPath);
  const raw = fs.readFileSync(absPath, "utf-8");
  const state = JSON.parse(raw) as SnapshotState;
  const all = state.allPlayers ?? [];
  const myPlayers = state.myTeam?.players ?? [];
  const myIds = new Set(myPlayers.map((p) => String(p.id)));
  const fa = all.filter(
    (p) => isFreeAgent(p) && !isInjured(p) && !myIds.has(String(p.id)),
  );
  const weights = state.matchup?.strategy?.categoryWeights ?? {};
  const hasStrategy = Object.keys(weights).length > 0;

  // v1 ranking: blend 40% effectiveDURANT + 60% matchup-adjusted-z if
  // strategy weights exist; otherwise raw DURANT. Same as Engine 4's
  // formula sans the drop-target loop.
  const v1Ranked = [...fa].sort((a, b) => {
    const aD = a.effectiveDURANT ?? a.durantScore ?? 0;
    const bD = b.effectiveDURANT ?? b.durantScore ?? 0;
    if (!hasStrategy) return bD - aD;
    const aM = v1MatchupAdjusted(a.zScores, weights);
    const bM = v1MatchupAdjusted(b.zScores, weights);
    const aBlend = aD * 0.4 + aM * 0.6;
    const bBlend = bD * 0.4 + bM * 0.6;
    return bBlend - aBlend;
  });
  const v1Top5 = v1Ranked.slice(0, 5);

  // v2 ranking via the new engine.
  const myProj = myPlayers.map(toProjection);
  const faProj = fa.map(toProjection);
  const leaguePlayers: Record<string, PlayerProjection[]> = {};
  for (const t of state.teams ?? []) {
    leaguePlayers[String(t.teamId)] = all
      .filter((p) => p.onTeamId === t.teamId)
      .map(toProjection);
  }
  const ctx: RecommendationContext = {
    roster: { myPlayers: myProj, leaguePlayers },
    league: {
      size: state.league?.teamCount ?? 12,
      scoringPeriod: 0,
      currentMatchup: null,
      allCategories: CATEGORIES,
    },
    projectionSource: createInMemoryProjectionSource(faProj, myProj),
    mode: "in-season",
  };
  const v2Out = recommend(ctx);
  const v2Top5 = v2Out.ranked.slice(0, 5);

  console.log("=".repeat(72));
  console.log("v1 vs v2 side-by-side, real roster");
  console.log("=".repeat(72));
  console.log(`Strategy weights: ${JSON.stringify(weights)}`);
  console.log("");

  console.log("v1 Engine 4 top 5 (40% DURANT + 60% matchup-z):");
  for (let i = 0; i < v1Top5.length; i++) {
    const p = v1Top5[i];
    if (!p) continue;
    const dur = (p.effectiveDURANT ?? p.durantScore ?? 0).toFixed(1);
    const m = v1MatchupAdjusted(p.zScores, weights).toFixed(2);
    const blend = ((p.effectiveDURANT ?? p.durantScore ?? 0) * 0.4 + v1MatchupAdjusted(p.zScores, weights) * 0.6).toFixed(2);
    console.log(`  ${i + 1}. ${(p.name ?? "?").padEnd(28)}  DURANT=${dur.padStart(7)}  matchupZ=${m.padStart(6)}  blend=${blend.padStart(7)}`);
  }
  console.log("");
  console.log("v2 engine top 5 (G-score + alpha * fit):");
  for (let i = 0; i < v2Top5.length; i++) {
    const rp = v2Top5[i];
    if (!rp) continue;
    const b = rp.breakdown;
    console.log(`  ${i + 1}. ${rp.player.name.padEnd(28)}  G=${b.gScore.toFixed(2).padStart(6)}  fit=${b.fitBonus.toFixed(2).padStart(6)}  final=${b.final.toFixed(2).padStart(6)}`);
  }
  console.log("");

  const v1Ids = new Set(v1Top5.map((p) => String(p.id)));
  const v2Ids = new Set(v2Top5.map((rp) => rp.player.id));
  const overlap = [...v2Ids].filter((id) => v1Ids.has(id)).length;
  console.log(`Overlap (top 5): ${overlap}/5`);
  console.log(`v2 unique: ${[...v2Ids].filter((id) => !v1Ids.has(id)).length}`);

  const need = v2Out.teamNeeds;
  const biggestNeed = CATEGORIES.reduce(
    (best, c) => (need[c] > need[best] ? c : best),
    CATEGORIES[0] ?? "REB",
  );
  console.log("");
  console.log(`v2 says biggest team need: ${biggestNeed} (${need[biggestNeed].toFixed(2)} stdev below league average)`);
  console.log("v2 needs vector:");
  for (const c of CATEGORIES) {
    const v = need[c];
    const tag = v > 0 ? "NEED   " : "SURPLUS";
    console.log(`  ${c}: ${v.toFixed(2).padStart(6)}  ${tag}`);
  }
}

main();
