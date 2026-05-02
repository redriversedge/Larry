// Shared fixture helpers for engine tests. Build players with explicit
// per-game category profiles so tests can reason about the math without
// having to read the engine internals.

import type {
  CategoryVector,
  PlayerProjection,
  Position,
  RosterContext,
} from "../../src/shared/types";

export function makePlayer(args: {
  id: string;
  name?: string;
  team?: string;
  positions?: Position[];
  perGame: CategoryVector;
  gamesRemaining?: number;
  injuryStatus?: PlayerProjection["injuryStatus"];
}): PlayerProjection {
  return {
    id: args.id,
    name: args.name ?? `P${args.id}`,
    team: args.team ?? "TST",
    positions: args.positions ?? ["SG"],
    gamesRemaining: args.gamesRemaining ?? 25,
    perGame: args.perGame,
    injuryStatus: args.injuryStatus ?? "ACTIVE",
  };
}

// Build a synthetic 12-team league: 12 teams x 13 players. Stat profiles are
// drawn from a reproducible per-team seed so we can swap "my team" between
// the slots and the league averages stay constant.
//
// Each team gets a "flavor": its players are biased toward 1-2 categories.
// Flavors are deterministic so tests are reproducible.
export interface SyntheticLeague {
  teamIds: string[];
  rosters: Record<string, PlayerProjection[]>;
  freeAgents: PlayerProjection[];
}

const FLAVORS: Array<Partial<CategoryVector>> = [
  { REB: 2, AST: 0, STL: 0, BLK: 1, PTS: 0 }, // 0: bigs
  { REB: 0, AST: 2, STL: 1, BLK: 0, PTS: 0 }, // 1: PG-heavy
  { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 2 }, // 2: scorers
  { REB: 1, AST: 1, STL: 1, BLK: 1, PTS: 1 }, // 3: balanced
  { REB: 1, AST: 0, STL: 2, BLK: 0, PTS: 0 }, // 4: thieves
  { REB: 0, AST: 1, STL: 0, BLK: 2, PTS: 0 }, // 5: rim protectors
  { REB: 1, AST: 1, STL: 0, BLK: 0, PTS: 1 }, // 6: forwards
  { REB: 0, AST: 0, STL: 1, BLK: 0, PTS: 2 }, // 7: scoring guards
  { REB: 2, AST: 1, STL: 0, BLK: 0, PTS: 1 }, // 8: stretch bigs
  { REB: 0, AST: 2, STL: 1, BLK: 0, PTS: 1 }, // 9: combos
  { REB: 1, AST: 0, STL: 0, BLK: 2, PTS: 1 }, // 10: rebounders
  { REB: 0, AST: 1, STL: 1, BLK: 1, PTS: 0 }, // 11: defenders
];

const BASE: CategoryVector = { REB: 5, AST: 4, STL: 1, BLK: 0.7, PTS: 14 };

function applyFlavor(base: CategoryVector, flavor: Partial<CategoryVector>): CategoryVector {
  return {
    REB: base.REB + (flavor.REB ?? 0),
    AST: base.AST + (flavor.AST ?? 0),
    STL: base.STL + (flavor.STL ?? 0) * 0.4,
    BLK: base.BLK + (flavor.BLK ?? 0) * 0.4,
    PTS: base.PTS + (flavor.PTS ?? 0) * 3,
  };
}

// Pseudo-random with a seed so tests are deterministic.
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function buildSyntheticLeague(opts: {
  teams?: number;
  playersPerTeam?: number;
  freeAgentCount?: number;
  seed?: number;
} = {}): SyntheticLeague {
  const teams = opts.teams ?? 12;
  const playersPerTeam = opts.playersPerTeam ?? 13;
  const freeAgentCount = opts.freeAgentCount ?? 60;
  const rand = seededRandom(opts.seed ?? 42);
  const teamIds: string[] = [];
  const rosters: Record<string, PlayerProjection[]> = {};
  let nextId = 1;
  for (let t = 0; t < teams; t++) {
    const tid = `T${t}`;
    teamIds.push(tid);
    const flavor = FLAVORS[t % FLAVORS.length] ?? {};
    const roster: PlayerProjection[] = [];
    for (let p = 0; p < playersPerTeam; p++) {
      const noise = (rand() - 0.5) * 0.6;
      const profile = applyFlavor(BASE, flavor);
      roster.push(
        makePlayer({
          id: `team${t}p${p}_${nextId++}`,
          team: tid,
          positions: ["SG"],
          perGame: {
            REB: Math.max(0, profile.REB + noise),
            AST: Math.max(0, profile.AST + noise),
            STL: Math.max(0, profile.STL + noise * 0.3),
            BLK: Math.max(0, profile.BLK + noise * 0.3),
            PTS: Math.max(0, profile.PTS + noise * 2),
          },
        }),
      );
    }
    rosters[tid] = roster;
  }
  // Free agents are drawn from a wider distribution so the engine has
  // material variation to choose from. Mix across categories.
  const freeAgents: PlayerProjection[] = [];
  for (let i = 0; i < freeAgentCount; i++) {
    const flavor = FLAVORS[i % FLAVORS.length] ?? {};
    const noise = (rand() - 0.5) * 1.0;
    const profile = applyFlavor(BASE, flavor);
    freeAgents.push(
      makePlayer({
        id: `fa${i + 1}`,
        team: "FA",
        positions: ["SG"],
        perGame: {
          REB: Math.max(0, profile.REB + noise),
          AST: Math.max(0, profile.AST + noise),
          STL: Math.max(0, profile.STL + noise * 0.4),
          BLK: Math.max(0, profile.BLK + noise * 0.4),
          PTS: Math.max(0, profile.PTS + noise * 3),
        },
      }),
    );
  }
  return { teamIds, rosters, freeAgents };
}

export function buildRosterContext(
  league: SyntheticLeague,
  myTeamId: string,
): RosterContext {
  const myPlayers = league.rosters[myTeamId] ?? [];
  return { myPlayers, leaguePlayers: league.rosters };
}
