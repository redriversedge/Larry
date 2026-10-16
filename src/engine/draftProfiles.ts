// Manager draft profiles: what each manager in the league actually does on
// draft night, derived from their real pick history.
//
// Pure, per CLAUDE.md: no DOM, no network, no localStorage. The caller
// (js/draft.js) hands in the object that js/espn.js cached under
// larry_draft_history plus the committed ESPN ADP history, and gets back one
// profile per MEMBER id.
//
// Keyed by member id, not team id, on purpose: teams change hands and team
// ids change between seasons, so a team-keyed profile silently blends two
// different people's drafting.
//
// PRIVACY (docs/DRAFT_ROOM_SPEC.md s0): this repo is public and the input is
// league members' data. Nothing here writes to disk. Tests use synthetic
// managers M1..M12 and invented players.
//
// The method, in three lines:
//   1. Within a season's pool of drafted players, z-score each per-game
//      category.
//   2. For each pick, subtract the mean z of the OTHER picks within +/- 8
//      overall slots. That residual is what the manager chose given where
//      they were picking, with "early picks are better at everything"
//      removed.
//   3. A manager's premium for a category is the mean residual over their
//      rounds 1 to 10 picks across all seasons; t is that mean over its
//      standard error.

import {
  CATEGORIES,
  type Category,
  type CategoryVector,
  type Position,
} from "../shared/types";
import {
  DRAFT_NEIGHBOR_WINDOW,
  DRAFT_PREMIUM_MAX_ROUND,
  DRAFT_POSITION_LEAN_MAX_ROUND,
  DRAFT_POSITION_LEAN_THRESHOLD,
  DRAFT_AFFINITY_MIN_PICKS,
  DRAFT_AFFINITY_RATE_MULTIPLE,
  DRAFT_AFFINITY_TOP_N,
  DRAFT_SMALL_SAMPLE_DRAFTS,
  DRAFT_STRENGTH_STRONG_T,
  DRAFT_STRENGTH_MODERATE_T,
  DRAFT_PREMIUM_MIN_EFFECT,
  DRAFT_PUNT_MAX_POSITIVE_SEASONS,
  DRAFT_REACH_OFTEN_MEDIAN,
  DRAFT_REACH_BOARD_MEDIAN,
  ESPN_POSITION_ID_TO_NAME,
  STDEV_FLOOR,
} from "./constants";

// --- Input shapes (mirror the larry_draft_history cache exactly) ---

// [overall, round, teamId, playerId]
export type HistoryPick = [number, number, number, number];

// [name, posId, proTeamId, espnRank|null, gp, pts, reb, ast, stl, blk]
// gp and the five categories are PROJECTED SEASON TOTALS as ESPN published
// them before that season. Per-game is computed here, not in the fetch layer.
//
// espnRank is kept only for display and for the mock-draft rank fallback. It
// is NOT used for reach: for a finished season ESPN's stored rank is an
// END-OF-SEASON rank, not the pre-draft board.
export type HistoryPlayer = [
  string,
  number,
  number,
  number | null,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface DraftHistorySeason {
  picks: HistoryPick[];
  owners: Record<string, string>;
  players: Record<string, HistoryPlayer>;
}

export interface DraftHistory {
  leagueId?: string | number;
  builtAt?: string;
  version?: number;
  seasons: Record<string, DraftHistorySeason>;
  members: Record<string, string>;
}

// { "<seasonId>": [[normalizedName, espnAdp], ...] } as written by
// tools/fetch-espn-adp-history.ts.
export type AdpHistory = Record<string, Array<[string, number]>>;

// --- Output shapes ---

export type Strength = "strong" | "moderate" | "none";

export interface CategoryPremium {
  category: Category;
  premium: number;
  t: number;
  n: number;
  seasonsPositive: number;
  seasonsTotal: number;
  strength: Strength;
  label: string;
}

export interface ReachProfile {
  median: number | null;
  early: number | null;
  mid: number | null;
  late: number | null;
  n: number;
  label: string;
}

export interface PositionLean {
  position: Position;
  lean: number;
  share: number;
  leagueShare: number;
}

export interface TeamAffinity {
  proTeamId: number;
  count: number;
  share: number;
  leagueShare: number;
}

export interface ManagerProfile {
  memberId: string;
  name: string;
  seasons: number[];
  draftCount: number;
  smallSample: boolean;
  pickCount: number;
  premium: Record<Category, CategoryPremium>;
  order: Category[];
  reach: ReachProfile;
  positionLean: PositionLean[];
  teamAffinity: TeamAffinity[];
  summary: string;
}

export interface ProfileOptions {
  // Build as if standing before this season's draft: only seasons strictly
  // before it are read. This is what keeps the fit tool honest; without it a
  // profile used to predict the 2026 draft would already contain the 2026
  // draft.
  asOfSeason?: number;
}

export interface ProfileResult {
  profiles: Record<string, ManagerProfile>;
  seasonsUsed: number[];
  seasonsSkipped: number[];
}

// --- Small numeric helpers ---

function mean(values: number[]): number {
  if (!values.length) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

// Sample standard deviation (n - 1), matching meanStdev in zscore.ts so the
// two engines describe spread the same way.
function sampleStdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let sq = 0;
  for (const v of values) sq += (v - m) * (v - m);
  return Math.sqrt(sq / (values.length - 1));
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function emptyVector(): CategoryVector {
  return { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
}

// Same normalization as tools/fetch-espn-adp-history.ts and
// tools/preseason-vs-experts.ts. Exported so the fetch layer can match ESPN
// names to the ADP file with exactly this rule.
export function normName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export function buildAdpLookup(adp: AdpHistory | undefined): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  if (!adp) return out;
  for (const season of Object.keys(adp)) {
    const inner = new Map<string, number>();
    for (const row of adp[season] || []) {
      const name = row[0];
      const value = row[1];
      if (typeof name === "string" && Number.isFinite(value) && !inner.has(name)) {
        inner.set(name, value);
      }
    }
    out.set(season, inner);
  }
  return out;
}

// Phase buckets, shared with the mock-draft model so "mid round" means one
// thing in the whole feature.
export type Phase = "early" | "mid" | "late";

export function phaseForRound(round: number): Phase {
  if (round <= 3) return "early";
  if (round <= 7) return "mid";
  return "late";
}

// --- Per-season residuals ---

interface PickResidual {
  memberId: string;
  season: number;
  overall: number;
  round: number;
  playerId: number;
  posId: number;
  proTeamId: number;
  resid: CategoryVector;
  reach: number | null;
}

// Pool member: a drafted player with a projection and projected GP > 0.
interface PoolEntry {
  pick: HistoryPick;
  perGame: CategoryVector;
  z: CategoryVector;
  posId: number;
  proTeamId: number;
  name: string;
}

function seasonResiduals(
  seasonId: number,
  season: DraftHistorySeason,
  adpForSeason: Map<string, number> | undefined,
): PickResidual[] {
  const pool: PoolEntry[] = [];

  for (const pick of season.picks || []) {
    const playerId = pick[3];
    const row = season.players[String(playerId)];
    if (!row) continue;
    const gp = row[4];
    if (!Number.isFinite(gp) || gp <= 0) continue;

    // Tuple order after the first four fields: gp, pts, reb, ast, stl, blk.
    const perGame: CategoryVector = {
      PTS: (row[5] || 0) / gp,
      REB: (row[6] || 0) / gp,
      AST: (row[7] || 0) / gp,
      STL: (row[8] || 0) / gp,
      BLK: (row[9] || 0) / gp,
    };

    pool.push({
      pick,
      perGame,
      z: emptyVector(),
      posId: row[1],
      proTeamId: row[2],
      name: row[0],
    });
  }

  if (!pool.length) return [];

  // z within this season's pool, per category.
  for (const c of CATEGORIES) {
    const values = pool.map((p) => p.perGame[c]);
    const m = mean(values);
    const sd = Math.max(sampleStdev(values), STDEV_FLOOR);
    for (const entry of pool) {
      entry.z[c] = (entry.perGame[c] - m) / sd;
    }
  }

  // Residual against the neighborhood, excluding the pick itself. This is
  // what removes "early picks are just better at everything": a 3rd-overall
  // pick is compared with the other picks made around 3rd overall, not with
  // the whole draft.
  const out: PickResidual[] = [];
  for (const entry of pool) {
    const overall = entry.pick[0];
    const neighbors = pool.filter(
      (other) =>
        other !== entry && Math.abs(other.pick[0] - overall) <= DRAFT_NEIGHBOR_WINDOW,
    );
    // No neighbors means no basis for a residual. Only reachable in a
    // degenerate pool; skipping is honest, zero would invent a signal.
    if (!neighbors.length) continue;

    const resid = emptyVector();
    for (const c of CATEGORIES) {
      resid[c] = entry.z[c] - mean(neighbors.map((n) => n.z[c]));
    }

    const teamId = entry.pick[2];
    const memberId = (season.owners || {})[String(teamId)];
    if (!memberId) continue;

    const adp = adpForSeason ? adpForSeason.get(normName(entry.name)) : undefined;

    out.push({
      memberId,
      season: seasonId,
      overall,
      round: entry.pick[1],
      playerId: entry.pick[3],
      posId: entry.posId,
      proTeamId: entry.proTeamId,
      resid,
      // Positive means they took the player EARLIER than ESPN drafters did.
      // Players with no ESPN ADP that season get null and are left out
      // entirely: they were off the board, so any number would be noise.
      reach: adp === undefined ? null : adp - overall,
    });
  }

  return out;
}

// --- Labels ---

function strengthFor(t: number, premium: number): Strength {
  // A premium too small to matter is not a lean, however tight its standard
  // error. See DRAFT_PREMIUM_MIN_EFFECT.
  if (Math.abs(premium) < DRAFT_PREMIUM_MIN_EFFECT) return "none";
  const abs = Math.abs(t);
  if (abs >= DRAFT_STRENGTH_STRONG_T) return "strong";
  if (abs >= DRAFT_STRENGTH_MODERATE_T) return "moderate";
  return "none";
}

function premiumLabel(
  category: Category,
  premium: number,
  strength: Strength,
  seasonsPositive: number,
): string {
  if (strength === "none") return "";
  const positive = premium > 0;
  if (strength === "strong") {
    if (positive) return "Pays up for " + category;
    return seasonsPositive <= DRAFT_PUNT_MAX_POSITIVE_SEASONS
      ? "Punts " + category
      : "Avoids " + category;
  }
  return positive ? "Leans " + category : "Light on " + category;
}

function reachLabel(med: number | null): string {
  if (med === null) return "No ESPN ADP overlap";
  if (med >= DRAFT_REACH_OFTEN_MEDIAN) return "Reaches often";
  if (med <= DRAFT_REACH_BOARD_MEDIAN) return "Drafts the board";
  return "Slight reacher";
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] || "";
  if (parts.length === 2) return parts[0] + " and " + parts[1];
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

function buildSummary(premium: Record<Category, CategoryPremium>): string {
  const strong = CATEGORIES.filter((c) => premium[c].strength === "strong");
  const moderate = CATEGORIES.filter((c) => premium[c].strength === "moderate");
  if (!strong.length && !moderate.length) return "No clear category lean";

  const sentences: string[] = [];

  for (const c of strong) {
    const p = premium[c];
    if (p.premium > 0) {
      sentences.push("Pays up for " + c);
    } else if (p.seasonsPositive <= DRAFT_PUNT_MAX_POSITIVE_SEASONS) {
      sentences.push(
        "Punts " + c + " (" + p.seasonsPositive + " of " + p.seasonsTotal + " seasons)",
      );
    } else {
      sentences.push("Avoids " + c);
    }
  }

  const up = moderate.filter((c) => premium[c].premium > 0);
  const down = moderate.filter((c) => premium[c].premium <= 0);
  if (up.length) sentences.push("Leans " + joinList(up.slice()));
  if (down.length) sentences.push("Light on " + joinList(down.slice()));

  return sentences.join(". ") + ".";
}

// --- Main entry point ---

export function buildDraftProfiles(
  history: DraftHistory,
  adp?: AdpHistory,
  options: ProfileOptions = {},
): ProfileResult {
  const adpLookup = buildAdpLookup(adp);
  const seasonsUsed: number[] = [];
  const seasonsSkipped: number[] = [];

  const allResiduals: PickResidual[] = [];
  // Position lean and team affinity are counted over raw picks, which include
  // players with no projection, so they are tracked separately from
  // residuals.
  interface RawPick {
    memberId: string;
    season: number;
    round: number;
    posId: number;
    proTeamId: number;
  }
  const allRaw: RawPick[] = [];
  const seasonsByMember = new Map<string, Set<number>>();

  const seasonKeys = Object.keys(history.seasons || {})
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  for (const seasonId of seasonKeys) {
    if (options.asOfSeason !== undefined && seasonId >= options.asOfSeason) continue;
    const season = history.seasons[String(seasonId)];
    if (!season || !season.picks || !season.picks.length) {
      seasonsSkipped.push(seasonId);
      continue;
    }
    seasonsUsed.push(seasonId);

    const residuals = seasonResiduals(seasonId, season, adpLookup.get(String(seasonId)));
    for (const r of residuals) allResiduals.push(r);

    for (const pick of season.picks) {
      const memberId = (season.owners || {})[String(pick[2])];
      if (!memberId) continue;
      const row = season.players[String(pick[3])];
      allRaw.push({
        memberId,
        season: seasonId,
        round: pick[1],
        posId: row ? row[1] : 0,
        proTeamId: row ? row[2] : 0,
      });
      let set = seasonsByMember.get(memberId);
      if (!set) {
        set = new Set<number>();
        seasonsByMember.set(memberId, set);
      }
      set.add(seasonId);
    }
  }

  // League baselines for position lean and team affinity.
  const leaguePosPicks = allRaw.filter(
    (p) => p.round <= DRAFT_POSITION_LEAN_MAX_ROUND && p.posId >= 1 && p.posId <= 5,
  );
  const leaguePosCounts = new Map<number, number>();
  for (const p of leaguePosPicks) {
    leaguePosCounts.set(p.posId, (leaguePosCounts.get(p.posId) || 0) + 1);
  }

  const leagueTeamCounts = new Map<number, number>();
  let leagueTeamTotal = 0;
  for (const p of allRaw) {
    if (!p.proTeamId) continue;
    leagueTeamCounts.set(p.proTeamId, (leagueTeamCounts.get(p.proTeamId) || 0) + 1);
    leagueTeamTotal++;
  }

  const profiles: Record<string, ManagerProfile> = {};
  const memberIds = Array.from(seasonsByMember.keys());

  for (const memberId of memberIds) {
    const seasons = Array.from(seasonsByMember.get(memberId) || []).sort((a, b) => a - b);
    const draftCount = seasons.length;
    const mine = allResiduals.filter((r) => r.memberId === memberId);
    const myRaw = allRaw.filter((p) => p.memberId === memberId);

    // --- Category premium, rounds 1 to 10 ---
    const premiumPicks = mine.filter((r) => r.round <= DRAFT_PREMIUM_MAX_ROUND);
    const premium = {} as Record<Category, CategoryPremium>;

    for (const c of CATEGORIES) {
      const values = premiumPicks.map((r) => r.resid[c]);
      const m = mean(values);
      const sd = sampleStdev(values);
      const n = values.length;
      // t = mean / standard error. No spread or no sample means no claim.
      const t = n >= 2 && sd > 0 ? m / (sd / Math.sqrt(n)) : 0;

      let seasonsPositive = 0;
      for (const s of seasons) {
        const inSeason = premiumPicks.filter((r) => r.season === s).map((r) => r.resid[c]);
        if (inSeason.length && mean(inSeason) > 0) seasonsPositive++;
      }

      const strength = strengthFor(t, m);
      premium[c] = {
        category: c,
        premium: m,
        t,
        n,
        seasonsPositive,
        seasonsTotal: draftCount,
        strength,
        label: premiumLabel(c, m, strength, seasonsPositive),
      };
    }

    const order = CATEGORIES.slice().sort((a, b) => premium[b].premium - premium[a].premium);

    // --- Reach, against that season's ESPN ADP ---
    const reaches = mine.filter((r) => r.reach !== null).map((r) => r.reach as number);
    const byPhase = (phase: Phase): number[] =>
      mine
        .filter((r) => r.reach !== null && phaseForRound(r.round) === phase)
        .map((r) => r.reach as number);
    const reachMedian = median(reaches);
    const reach: ReachProfile = {
      median: reachMedian,
      early: median(byPhase("early")),
      mid: median(byPhase("mid")),
      late: median(byPhase("late")),
      n: reaches.length,
      label: reachLabel(reachMedian),
    };

    // --- Position lean, rounds 1 to 8 ---
    const myPosPicks = myRaw.filter(
      (p) => p.round <= DRAFT_POSITION_LEAN_MAX_ROUND && p.posId >= 1 && p.posId <= 5,
    );
    const positionLean: PositionLean[] = [];
    if (myPosPicks.length && leaguePosPicks.length) {
      const myCounts = new Map<number, number>();
      for (const p of myPosPicks) myCounts.set(p.posId, (myCounts.get(p.posId) || 0) + 1);
      for (const posId of [1, 2, 3, 4, 5]) {
        const share = (myCounts.get(posId) || 0) / myPosPicks.length;
        const leagueShare = (leaguePosCounts.get(posId) || 0) / leaguePosPicks.length;
        const lean = (share - leagueShare) * 100;
        if (Math.abs(lean) >= DRAFT_POSITION_LEAN_THRESHOLD) {
          const position = ESPN_POSITION_ID_TO_NAME[posId];
          if (position) {
            positionLean.push({
              position,
              lean,
              share: share * 100,
              leagueShare: leagueShare * 100,
            });
          }
        }
      }
      positionLean.sort((a, b) => Math.abs(b.lean) - Math.abs(a.lean));
    }

    // --- NBA team affinity. Display-led, tiny weight in the pick model. ---
    const myTeamCounts = new Map<number, number>();
    let myTeamTotal = 0;
    for (const p of myRaw) {
      if (!p.proTeamId) continue;
      myTeamCounts.set(p.proTeamId, (myTeamCounts.get(p.proTeamId) || 0) + 1);
      myTeamTotal++;
    }
    const teamAffinity: TeamAffinity[] = [];
    const ranked = Array.from(myTeamCounts.entries()).sort((a, b) => b[1] - a[1]);
    for (const [proTeamId, count] of ranked.slice(0, DRAFT_AFFINITY_TOP_N)) {
      if (count < DRAFT_AFFINITY_MIN_PICKS) continue;
      const share = myTeamTotal ? count / myTeamTotal : 0;
      const leagueShare = leagueTeamTotal
        ? (leagueTeamCounts.get(proTeamId) || 0) / leagueTeamTotal
        : 0;
      if (leagueShare > 0 && share < leagueShare * DRAFT_AFFINITY_RATE_MULTIPLE) continue;
      teamAffinity.push({
        proTeamId,
        count,
        share: share * 100,
        leagueShare: leagueShare * 100,
      });
    }

    profiles[memberId] = {
      memberId,
      name: (history.members || {})[memberId] || "Manager " + memberId,
      seasons,
      draftCount,
      smallSample: draftCount < DRAFT_SMALL_SAMPLE_DRAFTS,
      pickCount: myRaw.length,
      premium,
      order,
      reach,
      positionLean,
      teamAffinity,
      summary: buildSummary(premium),
    };
  }

  return { profiles, seasonsUsed, seasonsSkipped };
}

// League median phase reach, used by the mock-draft model to shrink a
// manager's own reach toward the field.
export function leagueReachMedians(
  profiles: Record<string, ManagerProfile>,
): Record<Phase, number> {
  const out: Record<Phase, number> = { early: 0, mid: 0, late: 0 };
  const phases: Phase[] = ["early", "mid", "late"];
  for (const phase of phases) {
    const values: number[] = [];
    for (const id of Object.keys(profiles)) {
      const value = profiles[id]?.reach[phase];
      if (value !== null && value !== undefined) values.push(value);
    }
    out[phase] = median(values) ?? 0;
  }
  return out;
}
