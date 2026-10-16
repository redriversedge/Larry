// Mock draft: AI managers that draft the way the league's real managers do.
//
// Pure, per CLAUDE.md. The caller owns the board data, the pick order and
// the saved mock state; this module only decides picks.
//
// The model, for manager m on the clock at overall pick p, over every
// available player i:
//
//   u_i = - rank_i / tau(m, phase)
//         + lambda * w(m) . (premium(m) * z_i)     // category taste
//         - gamma * overload(m, pos_i)              // position need
//         + alpha * affinity(m, team_i)             // small
//
// and the pick is drawn from softmax(u).
//
// rank_i is ESPN ADP. That is deliberate and is not a statement about player
// value: these managers draft out of the ESPN draft room off ESPN's board,
// so ESPN's board is the right base for PREDICTING them. Larry's own rank is
// what the Draft Room recommends to the user, which is a different question
// and a different column.
//
// Determinism (s4.2): every pick draws from a PRNG seeded by the mock's seed
// mixed with the overall pick number, never from one long stream. So undoing
// a pick and re-simulating reproduces exactly the same draft, and a mock
// survives a page reload without drifting.

import { CATEGORIES, type Category, type CategoryVector } from "../shared/types";
import {
  MOCK_ALPHA,
  MOCK_BETA,
  MOCK_CANDIDATE_POOL,
  MOCK_GAMMA,
  MOCK_LAMBDA,
  MOCK_OVERLOAD_THRESHOLD,
  MOCK_RANK_FALLBACK,
  MOCK_REACH_SHRINK_K,
  MOCK_SIM_CANDIDATE_POOL,
  MOCK_TAU_EARLY,
  MOCK_TAU_LATE,
  MOCK_TAU_MID,
  MOCK_WEIGHT_MODERATE,
  MOCK_WEIGHT_STRONG,
  MOCK_Z_POOL_SIZE,
  DRAFT_PREMIUM_MAX_ROUND,
  STDEV_FLOOR,
} from "./constants";
import { phaseForRound, type ManagerProfile, type Phase } from "./draftProfiles";

// --- Inputs ---

export interface MockPlayer {
  playerId: number;
  name: string;
  posId: number;
  proTeamId: number;
  // Live ESPN ADP for the current season, or that season's ESPN ADP when
  // fitting on history. Null when ESPN has no ADP for the player.
  espnAdp: number | null;
  // ESPN's STANDARD draft rank. First fallback when ADP is missing.
  espnDraftRank: number | null;
  // Larry's own preseason rank (durantRank). Second fallback, and the column
  // the Draft Room recommends from.
  larryRank: number | null;
  // Per-game projection, REB/AST/STL/BLK/PTS. From stats.projectedRate.
  perGame: CategoryVector;
}

export interface MockParams {
  tauEarly: number;
  tauMid: number;
  tauLate: number;
  beta: number;
  lambda: number;
  gamma: number;
  alpha: number;
}

export const DEFAULT_MOCK_PARAMS: MockParams = {
  tauEarly: MOCK_TAU_EARLY,
  tauMid: MOCK_TAU_MID,
  tauLate: MOCK_TAU_LATE,
  beta: MOCK_BETA,
  lambda: MOCK_LAMBDA,
  gamma: MOCK_GAMMA,
  alpha: MOCK_ALPHA,
};

export interface MockDraftConfig {
  // teamId for each overall pick, index 0 being pick 1. Length is the whole
  // draft, so rounds and team count are derived from it rather than assumed.
  order: number[];
  teamCount: number;
  players: MockPlayer[];
  // Current-season teamId -> that team's manager profile, or null when
  // profiles have not been built. A null profile falls back to rank-only.
  profileByTeam: Record<string, ManagerProfile | null>;
  leagueReach: Record<Phase, number>;
  params?: Partial<MockParams>;
  candidatePool?: number;
}

// [overall, teamId, playerId]
export type MockPick = [number, number, number];

export interface MockState {
  seed: number;
  picks: MockPick[];
}

export interface PickDecision {
  playerId: number;
  reason: string;
}

// --- Seeded PRNG ---

// mulberry32. Small, fast, good enough for drawing picks, and reproducible
// across browsers, which Math.random is not.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mix a seed with a salt (the overall pick number, or a simulation index) so
// each draw has its own independent stream.
export function mixSeed(seed: number, salt: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = (Math.imul(h ^ salt, 0x85ebca6b) ^ (salt << 13)) >>> 0;
  h = (Math.imul(h ^ (h >>> 13), 0xc2b2ae35) ^ salt) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// --- Board preparation ---

interface BoardEntry {
  player: MockPlayer;
  rank: number;
  z: CategoryVector;
}

export interface PreparedBoard {
  entries: BoardEntry[];
  byId: Map<number, BoardEntry>;
  // Player ids sorted by rank ascending. The candidate pool is taken off
  // the front of this, filtered for availability.
  rankOrder: number[];
  rounds: number;
}

export function rankOf(player: MockPlayer): number {
  if (player.espnAdp !== null && Number.isFinite(player.espnAdp) && player.espnAdp > 0) {
    return player.espnAdp;
  }
  if (
    player.espnDraftRank !== null &&
    Number.isFinite(player.espnDraftRank) &&
    player.espnDraftRank > 0
  ) {
    return player.espnDraftRank;
  }
  if (player.larryRank !== null && Number.isFinite(player.larryRank) && player.larryRank > 0) {
    return player.larryRank;
  }
  return MOCK_RANK_FALLBACK;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function sampleStdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let sq = 0;
  for (const v of values) sq += (v - m) * (v - m);
  return Math.sqrt(sq / (values.length - 1));
}

// Category z is computed against the top MOCK_Z_POOL_SIZE by rank, so "a lot
// of blocks" means a lot relative to draftable players, not relative to the
// whole league including bodies nobody takes.
export function prepareBoard(config: MockDraftConfig): PreparedBoard {
  const entries: BoardEntry[] = config.players.map((player) => ({
    player,
    rank: rankOf(player),
    z: { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 },
  }));

  const byRank = entries.slice().sort((a, b) => a.rank - b.rank);
  const pool = byRank.slice(0, MOCK_Z_POOL_SIZE);

  for (const c of CATEGORIES) {
    const values = pool.map((e) => e.player.perGame[c] || 0);
    const m = mean(values);
    const sd = Math.max(sampleStdev(values), STDEV_FLOOR);
    for (const entry of entries) {
      entry.z[c] = ((entry.player.perGame[c] || 0) - m) / sd;
    }
  }

  const byId = new Map<number, BoardEntry>();
  for (const entry of entries) byId.set(entry.player.playerId, entry);

  return {
    entries,
    byId,
    rankOrder: byRank.map((e) => e.player.playerId),
    rounds: config.teamCount > 0 ? Math.ceil(config.order.length / config.teamCount) : 0,
  };
}

// --- Order helpers ---

export function roundForIndex(index: number, teamCount: number): number {
  if (teamCount <= 0) return 1;
  return Math.floor(index / teamCount) + 1;
}

// Build a snake order from a round-1 pick order. Only used when ESPN has not
// published draft slots yet.
export function snakeOrder(firstRound: number[], rounds: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < rounds; r++) {
    const row = r % 2 === 0 ? firstRound : firstRound.slice().reverse();
    for (const teamId of row) out.push(teamId);
  }
  return out;
}

// Index (0-based) of a team's next pick at or after fromIndex, or -1.
export function nextPickIndex(order: number[], teamId: number, fromIndex: number): number {
  for (let i = Math.max(0, fromIndex); i < order.length; i++) {
    if (order[i] === teamId) return i;
  }
  return -1;
}

export function myUpcomingPicks(order: number[], teamId: number, fromIndex: number): number[] {
  const out: number[] = [];
  for (let i = Math.max(0, fromIndex); i < order.length; i++) {
    if (order[i] === teamId) out.push(i);
  }
  return out;
}

// --- Model pieces ---

function resolveParams(config: MockDraftConfig): MockParams {
  return { ...DEFAULT_MOCK_PARAMS, ...(config.params || {}) };
}

export function categoryWeight(strength: "strong" | "moderate" | "none"): number {
  if (strength === "strong") return MOCK_WEIGHT_STRONG;
  if (strength === "moderate") return MOCK_WEIGHT_MODERATE;
  return 0;
}

// A manager's phase reach, shrunk toward the league median by n / (n + k).
// Three late picks in a single draft is not evidence of a habit.
export function reachShrunk(
  profile: ManagerProfile | null,
  phase: Phase,
  leagueReach: Record<Phase, number>,
): number {
  const league = leagueReach[phase] || 0;
  if (!profile) return league;
  const own = profile.reach[phase];
  if (own === null || own === undefined) return league;
  const n = profile.reach.n || 0;
  const w = n / (n + MOCK_REACH_SHRINK_K);
  return w * own + (1 - w) * league;
}

export function tauFor(
  profile: ManagerProfile | null,
  phase: Phase,
  leagueReach: Record<Phase, number>,
  params: MockParams,
): number {
  const base =
    phase === "early" ? params.tauEarly : phase === "mid" ? params.tauMid : params.tauLate;
  const tau = base * Math.exp(params.beta * reachShrunk(profile, phase, leagueReach));
  // Clamped so a freak reach median cannot produce a degenerate softmax.
  return Math.min(Math.max(tau, 0.01), 500);
}

// Count of a manager's already-drafted players at a primary position, over
// rounds 1 to 10, beyond the threshold. Keeps the AI from taking five
// centers by round 6.
export function overloadFor(
  state: MockState,
  board: PreparedBoard,
  config: MockDraftConfig,
  teamId: number,
  posId: number,
): number {
  let count = 0;
  for (const pick of state.picks) {
    if (pick[1] !== teamId) continue;
    const round = roundForIndex(pick[0] - 1, config.teamCount);
    if (round > DRAFT_PREMIUM_MAX_ROUND) continue;
    const entry = board.byId.get(pick[2]);
    if (entry && entry.player.posId === posId) count++;
  }
  return Math.max(0, count - MOCK_OVERLOAD_THRESHOLD);
}

function affinityFor(profile: ManagerProfile | null, proTeamId: number): number {
  if (!profile || !proTeamId) return 0;
  for (const t of profile.teamAffinity) {
    if (t.proTeamId === proTeamId) return 1;
  }
  return 0;
}

export interface UtilityBreakdown {
  playerId: number;
  utility: number;
  rankTerm: number;
  categoryTerm: number;
  overloadTerm: number;
  affinityTerm: number;
  topCategory: Category | null;
}

// Utilities for the candidate pool at a given overall pick. Exported so the
// fit tool can read likelihoods and the UI can explain a pick.
export function pickUtilities(
  board: PreparedBoard,
  config: MockDraftConfig,
  state: MockState,
  index: number,
  availableIds: Set<number>,
  candidatePool?: number,
): UtilityBreakdown[] {
  const params = resolveParams(config);
  const teamId = config.order[index];
  if (teamId === undefined) return [];
  const profile = config.profileByTeam[String(teamId)] || null;
  const round = roundForIndex(index, config.teamCount);
  const phase = phaseForRound(round);
  const tau = tauFor(profile, phase, config.leagueReach, params);
  const poolSize = candidatePool ?? config.candidatePool ?? MOCK_CANDIDATE_POOL;

  const out: UtilityBreakdown[] = [];
  for (const playerId of board.rankOrder) {
    if (!availableIds.has(playerId)) continue;
    const entry = board.byId.get(playerId);
    if (!entry) continue;

    let categoryTerm = 0;
    let topCategory: Category | null = null;
    let topContribution = 0;
    if (profile) {
      for (const c of CATEGORIES) {
        const p = profile.premium[c];
        const w = categoryWeight(p.strength);
        if (!w) continue;
        const contribution = w * p.premium * entry.z[c];
        categoryTerm += contribution;
        if (Math.abs(contribution) > Math.abs(topContribution)) {
          topContribution = contribution;
          topCategory = c;
        }
      }
    }

    const rankTerm = -entry.rank / tau;
    const catTerm = params.lambda * categoryTerm;
    const overloadTerm =
      -params.gamma * overloadFor(state, board, config, teamId, entry.player.posId);
    const affTerm = params.alpha * affinityFor(profile, entry.player.proTeamId);

    out.push({
      playerId,
      utility: rankTerm + catTerm + overloadTerm + affTerm,
      rankTerm,
      categoryTerm: catTerm,
      overloadTerm,
      affinityTerm: affTerm,
      topCategory: topContribution > 0 ? topCategory : null,
    });

    if (out.length >= poolSize) break;
  }
  return out;
}

export function softmax(utilities: number[]): number[] {
  if (!utilities.length) return [];
  let max = -Infinity;
  for (const u of utilities) if (u > max) max = u;
  const exps = utilities.map((u) => Math.exp(u - max));
  let sum = 0;
  for (const e of exps) sum += e;
  if (!(sum > 0)) return utilities.map(() => 1 / utilities.length);
  return exps.map((e) => e / sum);
}

function drawIndex(probabilities: number[], roll: number): number {
  let acc = 0;
  for (let i = 0; i < probabilities.length; i++) {
    acc += probabilities[i] as number;
    if (roll < acc) return i;
  }
  return probabilities.length - 1;
}

// --- Picking ---

function reasonFor(
  board: PreparedBoard,
  chosen: UtilityBreakdown,
  profile: ManagerProfile | null,
  overall: number,
): string {
  const entry = board.byId.get(chosen.playerId);
  const rank = entry ? Math.round(entry.rank) : 0;

  // A clear reach is the most informative thing to say, so it wins.
  if (rank && rank - overall >= 8) {
    return "Reach: ESPN #" + rank + " at pick " + overall;
  }
  if (profile && chosen.topCategory) {
    const p = profile.premium[chosen.topCategory];
    if (p.label) return p.label;
  }
  if (rank && overall - rank >= 8) {
    return "Value: ESPN #" + rank + " still there at " + overall;
  }
  return "Best available";
}

// Decide the pick at a given index. Pure: the PRNG is derived from the seed
// and the pick number, so this is a function of (state, index) alone.
export function decidePick(
  board: PreparedBoard,
  config: MockDraftConfig,
  state: MockState,
  index: number,
  availableIds: Set<number>,
  candidatePool?: number,
): PickDecision | null {
  const utilities = pickUtilities(board, config, state, index, availableIds, candidatePool);
  if (!utilities.length) return null;

  const probabilities = softmax(utilities.map((u) => u.utility));
  const rng = mulberry32(mixSeed(state.seed, index + 1));
  const chosen = utilities[drawIndex(probabilities, rng())];
  if (!chosen) return null;

  const teamId = config.order[index];
  const profile =
    teamId === undefined ? null : config.profileByTeam[String(teamId)] || null;

  return {
    playerId: chosen.playerId,
    reason: reasonFor(board, chosen, profile, index + 1),
  };
}

export function availableIdsFor(board: PreparedBoard, state: MockState): Set<number> {
  const taken = new Set<number>();
  for (const pick of state.picks) taken.add(pick[2]);
  const out = new Set<number>();
  for (const id of board.rankOrder) if (!taken.has(id)) out.add(id);
  return out;
}

// Run AI picks until the given team is on the clock, the draft ends, or
// maxPicks picks have been made. Returns a NEW state; the caller keeps the
// old one for Undo.
export function simulateUntil(
  board: PreparedBoard,
  config: MockDraftConfig,
  state: MockState,
  stopForTeamId: number | null,
  maxPicks = Infinity,
): { state: MockState; made: Array<{ pick: MockPick; reason: string }> } {
  const picks = state.picks.slice();
  const available = availableIdsFor(board, state);
  const made: Array<{ pick: MockPick; reason: string }> = [];

  let count = 0;
  while (picks.length < config.order.length && count < maxPicks) {
    const index = picks.length;
    const teamId = config.order[index];
    if (teamId === undefined) break;
    if (stopForTeamId !== null && teamId === stopForTeamId) break;

    const working: MockState = { seed: state.seed, picks };
    const decision = decidePick(board, config, working, index, available);
    if (!decision) break;

    available.delete(decision.playerId);
    const pick: MockPick = [index + 1, teamId, decision.playerId];
    picks.push(pick);
    made.push({ pick, reason: decision.reason });
    count++;
  }

  return { state: { seed: state.seed, picks }, made };
}

// --- Availability odds (s6) ---

export interface AvailabilityCounts {
  sims: number;
  // playerId -> number of simulations in which the player was still on the
  // board at the user's next pick / the one after it.
  atNext: Map<number, number>;
  atSecond: Map<number, number>;
}

export function emptyAvailabilityCounts(): AvailabilityCounts {
  return { sims: 0, atNext: new Map(), atSecond: new Map() };
}

// Run a slice of simulations and ADD to counts, so the UI can run this in
// setTimeout chunks and keep the main thread free. simOffset makes each
// slice use fresh, non-overlapping seeds.
export function runAvailabilitySims(
  board: PreparedBoard,
  config: MockDraftConfig,
  state: MockState,
  myTeamId: number,
  simOffset: number,
  simCount: number,
  counts: AvailabilityCounts,
): AvailabilityCounts {
  const fromIndex = state.picks.length;
  const upcoming = myUpcomingPicks(config.order, myTeamId, fromIndex);
  const firstTarget = upcoming[0];
  const secondTarget = upcoming[1];
  if (firstTarget === undefined) return counts;

  const baseAvailable = availableIdsFor(board, state);

  for (let s = 0; s < simCount; s++) {
    const simSeed = mixSeed(state.seed, 0x5f00 + simOffset + s);
    const available = new Set(baseAvailable);
    const picks = state.picks.slice();

    const limit = secondTarget === undefined ? firstTarget : secondTarget;
    for (let index = fromIndex; index <= limit; index++) {
      if (index === firstTarget) {
        for (const id of available) counts.atNext.set(id, (counts.atNext.get(id) || 0) + 1);
        if (secondTarget === undefined) break;
        // The user's own pick inside a simulation is unknown. Taking the
        // best available by rank is the neutral assumption; it only shifts
        // the second-pick odds by one player.
        const mine = firstAvailableByRank(board, available);
        if (mine !== null) {
          available.delete(mine);
          picks.push([index + 1, myTeamId, mine]);
        }
        continue;
      }
      if (index === secondTarget) {
        for (const id of available) {
          counts.atSecond.set(id, (counts.atSecond.get(id) || 0) + 1);
        }
        break;
      }

      const working: MockState = { seed: simSeed, picks };
      const decision = decidePick(
        board,
        config,
        working,
        index,
        available,
        MOCK_SIM_CANDIDATE_POOL,
      );
      if (!decision) break;
      available.delete(decision.playerId);
      const teamId = config.order[index];
      if (teamId === undefined) break;
      picks.push([index + 1, teamId, decision.playerId]);
    }

    counts.sims++;
  }

  return counts;
}

export function firstAvailableByRank(
  board: PreparedBoard,
  available: Set<number>,
): number | null {
  for (const id of board.rankOrder) if (available.has(id)) return id;
  return null;
}

// Best available by LARRY rank. This is what the Draft Room recommends to
// the user, as opposed to rankOf() which is what it predicts the AI will do.
export function bestAvailableByLarry(
  board: PreparedBoard,
  available: Set<number>,
): number | null {
  let best: number | null = null;
  let bestRank = Infinity;
  for (const id of available) {
    const entry = board.byId.get(id);
    if (!entry) continue;
    const rank = entry.player.larryRank;
    // Null means no evidence, which must sort below every number rather
    // than being read as rank 0 (CLAUDE.md).
    if (rank === null || !Number.isFinite(rank) || rank <= 0) continue;
    if (rank < bestRank) {
      bestRank = rank;
      best = id;
    }
  }
  if (best !== null) return best;
  return firstAvailableByRank(board, available);
}
