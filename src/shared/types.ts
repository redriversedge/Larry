// Shared types for the Larry v2 recommendation engine.
//
// Engine code must be pure: no DOM, no network, no localStorage. Anything
// stateful or side-effectful flows through these types as plain data.

// Category order is REB, AST, STL, BLK, PTS everywhere in the app. Do not
// reorder. ESPN stat IDs map: 0=PTS, 1=BLK, 2=STL, 3=AST, 6=REB.
export type Category = "REB" | "AST" | "STL" | "BLK" | "PTS";

export const CATEGORIES: readonly Category[] = ["REB", "AST", "STL", "BLK", "PTS"] as const;

export type CategoryVector = Record<Category, number>;

// ESPN injury status strings we filter on. We never recommend injured
// players (CLAUDE.md rule).
export type InjuryStatus =
  | "ACTIVE"
  | "DAY_TO_DAY"
  | "OUT"
  | "SUSPENSION"
  | "INJURY_RESERVE"
  | "IR"
  | "QUESTIONABLE"
  | "PROBABLE"
  | "DOUBTFUL"
  | "UNKNOWN";

// ESPN position IDs, decoded. 1=PG, 2=SG, 3=SF, 4=PF, 5=C. We carry the
// strings for readability inside the engine.
export type Position = "PG" | "SG" | "SF" | "PF" | "C";

export interface PlayerProjection {
  id: string;
  name: string;
  team: string;
  positions: Position[];
  gamesRemaining: number;
  // Per-game projection in REB / AST / STL / BLK / PTS.
  perGame: CategoryVector;
  injuryStatus: InjuryStatus;
}

export interface RosterContext {
  // Players currently on the user's team.
  myPlayers: PlayerProjection[];
  // Roster for every team in the league, keyed by team id. Used to compute
  // league averages and standard deviations for the team-need vector.
  leaguePlayers: Record<string, PlayerProjection[]>;
}

export interface CurrentMatchup {
  // Optional: not all callers will have a matchup loaded.
  myTeamId: string;
  opponentTeamId: string;
  scoringPeriodId: number;
}

export interface LeagueContext {
  size: number; // Number of teams in the league. Drives Q-pool size.
  scoringPeriod: number;
  currentMatchup: CurrentMatchup | null;
  // Categories scored in the league. For Larry we expect all 5, in canonical
  // order, but the type allows for future flexibility.
  allCategories: readonly Category[];
}

export type RecommendationMode = "draft" | "in-season";

export interface ProjectionSource {
  // Returns the full free-agent projection pool the engine should consider.
  // Pure: implementations may close over already-loaded data, but must not
  // perform I/O when called.
  getFreeAgents(): PlayerProjection[];
  // Returns the projection for a given player id, or undefined if unknown.
  getById(id: string): PlayerProjection | undefined;
}

export interface RecommendationContext {
  roster: RosterContext;
  league: LeagueContext;
  projectionSource: ProjectionSource;
  mode: RecommendationMode;
}

export interface Breakdown {
  gScore: number; // Pure G-score, before any team-fit blend.
  alpha: number; // Team-fit blend weight in this run.
  fitBonus: number; // Dot product of need vector and player z vector.
  positionPenalty: number; // Subtracted from final. Positive number.
  final: number; // gScore + alpha * fitBonus - positionPenalty.
  why: string[]; // Short human-readable reasons. Used by explain.ts.
  categoryDeltas: CategoryVector; // Player z-score per category.
  projection: CategoryVector; // Per-game projection echoed for rendering.
  confidence: number; // 0..1. Rough proxy for projection reliability.
}

export interface RankedPlayer {
  player: PlayerProjection;
  breakdown: Breakdown;
}

export interface EngineMeta {
  qPoolSize: number;
  leagueSize: number;
  alphaUsed: number;
  poolStdev: CategoryVector;
  poolMean: CategoryVector;
  generatedAt: string; // ISO timestamp from caller; engine fills in via Date.
  engineVersion: "v2.0.0";
}

export interface EngineOutput {
  ranked: RankedPlayer[];
  teamNeeds: CategoryVector; // Need vector for the user's roster.
  meta: EngineMeta;
}
