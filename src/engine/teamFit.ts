// Team-need vector and fit bonus.
//
// need[c] = (leagueAvgPerTeam[c] - myRosterPerTeam[c]) / leagueStdevPerTeam[c]
//
// Negative need means the user's roster is above the league average in that
// category (surplus). Positive need means the user is below average (need).
// Fit bonus for a player is the dot product of the user's need vector and
// the player's z vector against the Q pool. A player who is strong exactly
// where the user is weak gets a positive bonus; one who is strong where the
// user is already strong gets a negative bonus.
//
// Alpha schedule: Phase 1 uses ALPHA_IN_SEASON (0.3) constant. Phase 4+
// will detect leverage (close matchup, late round in draft) and modulate.

import type {
  Category,
  CategoryVector,
  PlayerProjection,
  RosterContext,
} from "../shared/types";
import { CATEGORIES } from "../shared/types";
import { ALPHA_DRAFT, ALPHA_IN_SEASON, STDEV_FLOOR } from "./constants";
import { sumVector, type PoolStats, zVector } from "./zscore";

function emptyVector(): CategoryVector {
  return { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
}

// Sum a roster's per-game projection across all players, divided by team
// size to give a per-team average. We sum because in H2H each-cat the
// matchup is decided by team totals, so a team's "production" in REB is
// the sum of its players' REB.
export function rosterTotal(players: PlayerProjection[]): CategoryVector {
  const total = emptyVector();
  for (const p of players) {
    for (const c of CATEGORIES) {
      total[c] += p.perGame[c];
    }
  }
  return total;
}

export interface LeagueAverages {
  meanPerTeam: CategoryVector; // Average of teams' summed per-game category totals.
  stdevPerTeam: CategoryVector; // Stdev of teams' summed totals.
  teamCount: number;
}

export function computeLeagueAverages(roster: RosterContext): LeagueAverages {
  const teamIds = Object.keys(roster.leaguePlayers);
  const teamTotals = teamIds.map((id) => rosterTotal(roster.leaguePlayers[id] ?? []));
  const meanPerTeam = emptyVector();
  const stdevPerTeam = emptyVector();
  if (teamTotals.length === 0) {
    return { meanPerTeam, stdevPerTeam, teamCount: 0 };
  }
  for (const c of CATEGORIES) {
    const values = teamTotals.map((t) => t[c]);
    let sum = 0;
    for (const v of values) sum += v;
    const mean = sum / values.length;
    let sqSum = 0;
    for (const v of values) {
      const d = v - mean;
      sqSum += d * d;
    }
    const variance = values.length > 1 ? sqSum / (values.length - 1) : 0;
    meanPerTeam[c] = mean;
    stdevPerTeam[c] = Math.max(Math.sqrt(variance), STDEV_FLOOR);
  }
  return { meanPerTeam, stdevPerTeam, teamCount: teamTotals.length };
}

// Compute the team-need vector. Continuous, unbounded. Positive entries =
// need; negative entries = surplus.
export function teamNeedVector(
  roster: RosterContext,
  leagueAvg: LeagueAverages,
): CategoryVector {
  const need = emptyVector();
  const myTotal = rosterTotal(roster.myPlayers);
  for (const c of CATEGORIES) {
    need[c] = (leagueAvg.meanPerTeam[c] - myTotal[c]) / leagueAvg.stdevPerTeam[c];
  }
  return need;
}

// Dot product of need vector and player z vector. A positive value means
// the player addresses the team's needs.
export function fitBonus(
  player: PlayerProjection,
  need: CategoryVector,
  poolStats: PoolStats,
): number {
  const z = zVector(player, poolStats);
  let dot = 0;
  for (const c of CATEGORIES) dot += need[c] * z[c];
  return dot;
}

export function alphaFor(mode: "draft" | "in-season"): number {
  return mode === "draft" ? ALPHA_DRAFT : ALPHA_IN_SEASON;
}
