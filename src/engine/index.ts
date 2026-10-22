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
  BaseValuePoolStats,
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
  categoryRanks,
  fitBonus,
  fitWeights,
  recommendValueAndFit,
  rosterCategoryTotals,
  FIT_LAMBDA,
  FIT_MIN_PICKS,
  FIT_WEIGHT_EVEN,
  FIT_WEIGHT_STRONG,
  FIT_WEIGHT_WEAK,
} from "./draftTeamFit";
export type { FitInput, FitPlayer, FitRecommendation } from "./draftTeamFit";
export {
  clampGames,
  durabilityDetail,
  expectedGames,
  weightedHistory,
} from "./durability";
export type { DurabilityDetail, DurabilityInput } from "./durability";
export {
  blendBoard,
  blendScore,
  marketAgeDays,
  marketRankOrMissing,
  MARKET_STALE_DAYS,
} from "./blend";
export type { BlendInput, BlendRow } from "./blend";
export { replacementLevel, seasonValueFor, seasonValues } from "./replacement";
export { buildPreseasonBoard, durabilityBand } from "./preseasonBoard";
export type {
  PreseasonBoardResult,
  PreseasonBoardRow,
  PreseasonMarket,
  PreseasonPlayerInput,
} from "./preseasonBoard";
export { BLEND_LARRY_WEIGHT, BLEND_MARKET_DEPTH, BLEND_MISSING_RANK } from "./constants";
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
  availabilityTargets,
  availableIdsFor,
  bestAvailableByLarry,
  larryPickAdvice,
  rankUtility,
  topPickRate,
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
  LarryAdvice,
  MockDraftConfig,
  MockParams,
  MockPick,
  MockPlayer,
  MockState,
  PickDecision,
  PreparedBoard,
  RankForm,
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
  MOCK_RANK_FORM,
  MOCK_SCARCE_THRESHOLD,
  MOCK_TOP_PICK_SHARE,
  MOCK_TOP_PICK_SIMS,
  MOCK_TOP_PICK_WINDOW,
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
