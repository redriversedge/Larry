// Public API for the v2 recommendation engine. esbuild bundles this file
// into dist/larry-engine.js as an IIFE under the global name LarryEngine.
// js/engines.js (legacy ES5) reads window.LarryEngine.recommend(...).

export { recommend, topN } from "./recommend";
export { buildExplainPayload } from "./explain";
export {
  createEspnProjectionSource,
  createInMemoryProjectionSource,
  toPlayerProjection,
} from "./projectionSource";
export { teamNeedVector, computeLeagueAverages, rosterTotal } from "./teamFit";
export { buildQPool, zVector, gVector, gScore, sumVector } from "./zscore";
export type {
  Breakdown,
  Category,
  CategoryVector,
  EngineMeta,
  EngineOutput,
  InjuryStatus,
  LeagueContext,
  PlayerProjection,
  Position,
  ProjectionSource,
  RankedPlayer,
  RecommendationContext,
  RecommendationMode,
  RosterContext,
} from "../shared/types";
export { CATEGORIES } from "../shared/types";
