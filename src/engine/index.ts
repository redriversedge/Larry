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
export {
  computeLeagueRates,
  espnPerGameRate,
  overrideIsActive,
  per36Rate,
  projectAll,
  projectGamesPlayed,
  projectMinutesPerGame,
  projectPlayer,
} from "./projections";
export type {
  LeagueRates,
  PlayerProjectionResult,
  ProjectionInput,
  ProjectionOptions,
  ProjectionOverride,
  ProjectionSourceKind,
  SeasonTotals,
} from "./projections";
export {
  applyHaircut,
  applyPreseasonDiscount,
  buildQPool,
  computeBaseValues,
  gScore,
  gVector,
  sumVector,
  zVector,
} from "./zscore";
export type {
  BaseValueInput,
  BaseValueOptions,
  BaseValueResult,
  BaseValueRow,
  PoolStats,
} from "./zscore";
export {
  buildAdpLookup,
  buildDraftProfiles,
  leagueReachMedians,
  median,
  normName,
  phaseForRound,
} from "./draftProfiles";
export type {
  AdpHistory,
  CategoryPremium,
  DraftHistory,
  DraftHistorySeason,
  HistoryPick,
  HistoryPlayer,
  ManagerProfile,
  Phase,
  PositionLean,
  ProfileOptions,
  ProfileResult,
  ReachProfile,
  Strength,
  TeamAffinity,
} from "./draftProfiles";
export {
  buildHistoricalBoard,
  checkModel,
  combineEvals,
  evaluateDraft,
  fitMockDraft,
  profilesBySeason,
} from "./draftFit";
export type { EvalResult, FitOptions, FitResult, ModelCheck } from "./draftFit";
export {
  availableIdsFor,
  bestAvailableByLarry,
  categoryWeight,
  decidePick,
  DEFAULT_MOCK_PARAMS,
  emptyAvailabilityCounts,
  firstAvailableByRank,
  mixSeed,
  mulberry32,
  myUpcomingPicks,
  nextPickIndex,
  overloadFor,
  pickUtilities,
  prepareBoard,
  rankOf,
  reachShrunk,
  roundForIndex,
  runAvailabilitySims,
  simulateUntil,
  snakeOrder,
  softmax,
  tauFor,
} from "./mockDraft";
export type {
  AvailabilityCounts,
  MockDraftConfig,
  MockParams,
  MockPick,
  MockPlayer,
  MockState,
  PickDecision,
  PreparedBoard,
  UtilityBreakdown,
} from "./mockDraft";
export {
  DURANT_SCALE,
  MOCK_AVAIL_CHUNK,
  MOCK_AVAIL_SIMS,
  MOCK_AVAIL_SIMS_REDUCED,
  MOCK_AVAIL_TOP_N,
  MOCK_CAN_WAIT_THRESHOLD,
  MOCK_FITTED,
  PRESEASON_GP_REFERENCE,
  PRESEASON_LONG_TERM_GP,
  PRESEASON_SUSPECT_GP,
} from "./constants";
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
