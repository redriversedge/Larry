// ProjectionSource: how the engine reads per-player projections.
//
// Phase 1 uses ESPN's kona_player_info data already present in S.players.
// Phase 1.5 will add a Marcel-based source (see marcel.ts) and the engine
// will not need to change because both implement the same interface.
//
// IMPORTANT: this module is a *factory*. It does NOT do I/O. The caller
// passes in already-loaded data (from S.players or wherever) and gets back
// a ProjectionSource the engine can read.

import type {
  Category,
  CategoryVector,
  InjuryStatus,
  PlayerProjection,
  Position,
  ProjectionSource,
} from "../shared/types";
import { ESPN_POSITION_ID_TO_NAME, ESPN_STAT_ID_TO_CATEGORY } from "./constants";

// Shape of the relevant slice of S.players. Larry stores ESPN data with
// minimal transformation; we only assert the fields we read.
export interface EspnPlayerInput {
  id: string | number;
  fullName?: string;
  defaultPositionId?: number;
  eligiblePositionIds?: number[];
  proTeamAbbreviation?: string;
  injuryStatus?: string;
  // Per-game stat dictionary keyed by ESPN stat id (number). This is the
  // shape Larry stores after parsing kona_player_info; see
  // js/espn.js for the parser.
  // For Phase 1 the values we care about are 0=PTS, 1=BLK, 2=STL, 3=AST,
  // 6=REB. The numbers are already per-game averages.
  perGame?: Record<string, number>;
  // Optional: games remaining for the rest of the season. If absent we
  // fall back to a season-average assumption.
  gamesRemaining?: number;
  // Optional: free-agency status. Only true free agents are eligible for
  // recommendations.
  isFreeAgent?: boolean;
}

export interface EspnInputs {
  players: EspnPlayerInput[];
  defaultGamesRemaining?: number;
}

const FALLBACK_GAMES_REMAINING = 20;

function normalizeInjuryStatus(s: string | undefined): InjuryStatus {
  if (!s) return "ACTIVE";
  const upper = s.toUpperCase();
  switch (upper) {
    case "ACTIVE":
    case "DAY_TO_DAY":
    case "OUT":
    case "SUSPENSION":
    case "INJURY_RESERVE":
    case "IR":
    case "QUESTIONABLE":
    case "PROBABLE":
    case "DOUBTFUL":
      return upper as InjuryStatus;
    default:
      return "UNKNOWN";
  }
}

function decodePositions(
  defaultId: number | undefined,
  eligibleIds: number[] | undefined,
): Position[] {
  const out = new Set<Position>();
  if (defaultId !== undefined) {
    const name = ESPN_POSITION_ID_TO_NAME[defaultId];
    if (name) out.add(name);
  }
  if (eligibleIds) {
    for (const pid of eligibleIds) {
      const name = ESPN_POSITION_ID_TO_NAME[pid];
      if (name) out.add(name);
    }
  }
  return Array.from(out);
}

function decodePerGame(perGame: Record<string, number> | undefined): CategoryVector {
  const out: CategoryVector = { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
  if (!perGame) return out;
  for (const key of Object.keys(perGame)) {
    const numericKey = Number(key);
    const cat = ESPN_STAT_ID_TO_CATEGORY[numericKey];
    if (cat) {
      out[cat] = perGame[key] ?? 0;
    }
  }
  return out;
}

export function toPlayerProjection(
  raw: EspnPlayerInput,
  defaultGamesRemaining: number,
): PlayerProjection {
  return {
    id: String(raw.id),
    name: raw.fullName ?? `Player ${raw.id}`,
    team: raw.proTeamAbbreviation ?? "",
    positions: decodePositions(raw.defaultPositionId, raw.eligiblePositionIds),
    gamesRemaining: raw.gamesRemaining ?? defaultGamesRemaining,
    perGame: decodePerGame(raw.perGame),
    injuryStatus: normalizeInjuryStatus(raw.injuryStatus),
  };
}

export interface EspnProjectionSourceOptions {
  // If true, only players where isFreeAgent === true are returned by
  // getFreeAgents(). If false, all players are returned (useful in tests).
  filterFreeAgents?: boolean;
}

// Build a projection source from already-shaped PlayerProjection objects.
// This is the path the legacy js/engines.js uses: it reads S.players (which
// already has per-category aggregated stats from the existing parser), maps
// each entry into PlayerProjection-shaped JS objects, then hands them in.
// Tests use it for the same reason: skip the ESPN-shape intermediate.
export function createInMemoryProjectionSource(
  freeAgents: PlayerProjection[],
  onRoster: PlayerProjection[] = [],
): ProjectionSource {
  const byId = new Map<string, PlayerProjection>();
  for (const p of freeAgents) byId.set(p.id, p);
  for (const p of onRoster) byId.set(p.id, p);
  return {
    getFreeAgents(): PlayerProjection[] {
      return freeAgents;
    },
    getById(id: string): PlayerProjection | undefined {
      return byId.get(id);
    },
  };
}

export function createEspnProjectionSource(
  inputs: EspnInputs,
  options: EspnProjectionSourceOptions = {},
): ProjectionSource {
  const defaultGames = inputs.defaultGamesRemaining ?? FALLBACK_GAMES_REMAINING;
  const all: PlayerProjection[] = inputs.players.map((p) => toPlayerProjection(p, defaultGames));
  const byId = new Map<string, PlayerProjection>();
  for (let i = 0; i < all.length; i++) {
    const proj = all[i];
    const raw = inputs.players[i];
    if (!proj || !raw) continue;
    byId.set(proj.id, proj);
  }
  const filterFreeAgents = options.filterFreeAgents ?? true;
  const freeAgents = all.filter((p, i) => {
    if (!filterFreeAgents) return true;
    return inputs.players[i]?.isFreeAgent === true;
  });
  return {
    getFreeAgents(): PlayerProjection[] {
      return freeAgents;
    },
    getById(id: string): PlayerProjection | undefined {
      return byId.get(id);
    },
  };
}
