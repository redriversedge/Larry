// Synthetic draft-history fixtures for the Draft Room tests.
//
// PRIVACY (docs/DRAFT_ROOM_SPEC.md s0): this repo is public and real draft
// history is league members' data. Everything here is invented: managers
// M1..M12, players named from the NATO alphabet, generated picks. Never
// replace any of this with a real league export. A local real export belongs
// in tests/fixtures/users/ (git-ignored) and must not be referenced from a
// committed test.
//
// Player names are built from letters only, because the ADP matcher
// normalizes names by stripping everything that is not a letter: "Player 12"
// and "Player 13" both normalize to "player" and would collide.

import type {
  AdpHistory,
  CategoryPremium,
  DraftHistory,
  DraftHistorySeason,
  HistoryPick,
  HistoryPlayer,
  ManagerProfile,
  ReachProfile,
  Strength,
} from "../../src/engine/draftProfiles";
import { normName } from "../../src/engine/draftProfiles";
import type { MockPlayer } from "../../src/engine/mockDraft";
import { CATEGORIES, type Category } from "../../src/shared/types";

const FIRST = [
  "Alpha",
  "Bravo",
  "Charlie",
  "Delta",
  "Echo",
  "Foxtrot",
  "Golf",
  "Hotel",
  "India",
  "Juliett",
  "Kilo",
  "Lima",
  "Mike",
  "November",
  "Oscar",
  "Papa",
  "Quebec",
  "Romeo",
  "Sierra",
  "Tango",
  "Uniform",
  "Victor",
  "Whiskey",
  "Xray",
  "Yankee",
  "Zulu",
];

const LAST = [
  "Ashford",
  "Brennan",
  "Caldwell",
  "Donnelly",
  "Ellsworth",
  "Fairbanks",
  "Goodwin",
  "Hollingsworth",
  "Ingersoll",
  "Jennings",
  "Kirkpatrick",
  "Lockridge",
  "Merriweather",
  "Northrup",
  "Oakhurst",
  "Pendleton",
  "Quarrington",
  "Rutherford",
  "Stanbridge",
  "Thorncastle",
  "Underhill",
  "Vanderveer",
  "Westbrooke",
  "Yarborough",
];

export function playerName(index: number): string {
  const first = FIRST[index % FIRST.length] as string;
  const last = LAST[Math.floor(index / FIRST.length) % LAST.length] as string;
  // The pair repeats only past 26 * 24 = 624 players, more than any draft
  // pool here, so normalized names stay unique.
  return first + " " + last;
}

// Deterministic PRNG so every fixture is byte-identical between runs.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SynthPlayer {
  playerId: number;
  name: string;
  posId: number;
  proTeamId: number;
  gp: number;
  // Per-game, by category.
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  // The player's position on the pre-draft board.
  adp: number;
}

export interface PoolOptions {
  count: number;
  seed: number;
  // 0 makes every category a clean linear function of board position, so a
  // draft taken in strict rank order produces residuals of ~0. Above 0,
  // categories vary independently of rank, which is what lets a manager
  // express a category preference.
  categoryNoise: number;
}

// A board where overall quality falls with ADP, and each category is that
// baseline plus independent noise.
export function makePool(options: PoolOptions): SynthPlayer[] {
  const next = rng(options.seed);
  const out: SynthPlayer[] = [];
  for (let i = 0; i < options.count; i++) {
    const adp = i + 1;
    // Falls from 1.0 at the top of the board to 0.0 at the bottom.
    const quality = 1 - i / options.count;
    const noise = (): number => (options.categoryNoise ? (next() - 0.5) * 2 * options.categoryNoise : 0);
    const gp = 70;
    out.push({
      playerId: 1000 + i,
      name: playerName(i),
      posId: (i % 5) + 1,
      proTeamId: (i % 30) + 1,
      gp,
      pts: Math.max(0, 8 + 20 * quality + 20 * noise()),
      reb: Math.max(0, 2 + 8 * quality + 8 * noise()),
      ast: Math.max(0, 1 + 6 * quality + 6 * noise()),
      stl: Math.max(0, 0.3 + 1.2 * quality + 1.2 * noise()),
      blk: Math.max(0, 0.1 + 1.2 * quality + 1.2 * noise()),
      adp,
    });
  }
  return out;
}

export function toHistoryPlayer(p: SynthPlayer, espnRank: number | null): HistoryPlayer {
  // Totals, as ESPN publishes them. Per-game is the engine's job.
  return [
    p.name,
    p.posId,
    p.proTeamId,
    espnRank,
    p.gp,
    p.pts * p.gp,
    p.reb * p.gp,
    p.ast * p.gp,
    p.stl * p.gp,
    p.blk * p.gp,
  ];
}

// Picks the index into the rank-sorted available list.
export type Strategy = (context: {
  teamId: number;
  memberId: string;
  round: number;
  overall: number;
  available: SynthPlayer[];
}) => number;

export const byRank: Strategy = () => 0;

// Takes the highest-PTS player inside a window at the top of the board.
export function highestInWindow(
  category: "pts" | "reb" | "ast" | "stl" | "blk",
  window: number,
): Strategy {
  return ({ available }) => {
    let best = 0;
    for (let i = 1; i < Math.min(window, available.length); i++) {
      if ((available[i] as SynthPlayer)[category] > (available[best] as SynthPlayer)[category]) {
        best = i;
      }
    }
    return best;
  };
}

// Takes the LOWEST value in the window: a manager who never spends on a
// category.
export function lowestInWindow(
  category: "pts" | "reb" | "ast" | "stl" | "blk",
  window: number,
): Strategy {
  return ({ available }) => {
    let best = 0;
    for (let i = 1; i < Math.min(window, available.length); i++) {
      if ((available[i] as SynthPlayer)[category] < (available[best] as SynthPlayer)[category]) {
        best = i;
      }
    }
    return best;
  };
}

export interface LeagueOptions {
  seasons: number[];
  teams?: number;
  rounds?: number;
  seed?: number;
  categoryNoise?: number;
  // memberId per teamId, per season. Defaults to member "M<teamId>" in every
  // season.
  owners?: Record<number, Record<number, string>>;
  // Strategy per memberId. Anyone missing drafts by rank.
  strategies?: Record<string, Strategy>;
  // Value written into the player tuple's espnRank slot. Deliberately
  // wrong-by-design in one test, to prove reach never reads it.
  espnRankFor?: (p: SynthPlayer) => number | null;
}

export interface SynthLeague {
  history: DraftHistory;
  adp: AdpHistory;
  pools: Record<number, SynthPlayer[]>;
  // Who actually took whom, for assertions.
  picksByMember: Record<string, Array<{ season: number; overall: number; player: SynthPlayer }>>;
}

// --- Factories for the mock-draft model ---

// A board for the AI pick model. ESPN ADP equals board position, so "rank
// order" and "ADP order" are the same thing and a rank-only model is easy to
// assert against.
export function makeBoard(players: SynthPlayer[]): MockPlayer[] {
  return players.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    posId: p.posId,
    proTeamId: p.proTeamId,
    espnAdp: p.adp,
    espnDraftRank: p.adp,
    larryRank: p.adp,
    perGame: { REB: p.reb, AST: p.ast, STL: p.stl, BLK: p.blk, PTS: p.pts },
  }));
}

export interface ProfileSpec {
  memberId?: string;
  name?: string;
  // Category premium and strength. Anything omitted is a flat non-signal.
  premium?: Partial<Record<Category, { premium: number; strength: Strength }>>;
  reach?: Partial<ReachProfile>;
  teamAffinity?: number[];
  draftCount?: number;
}

// A hand-built profile, so a model test can state exactly one taste and
// hold everything else flat.
export function makeProfile(spec: ProfileSpec = {}): ManagerProfile {
  const premium = {} as Record<Category, CategoryPremium>;
  for (const c of CATEGORIES) {
    const given = spec.premium?.[c];
    premium[c] = {
      category: c,
      premium: given?.premium ?? 0,
      t: given ? (given.strength === "strong" ? 3 : given.strength === "moderate" ? 1.5 : 0) : 0,
      n: 90,
      seasonsPositive: given && given.premium > 0 ? 9 : 0,
      seasonsTotal: spec.draftCount ?? 9,
      strength: given?.strength ?? "none",
      label: "",
    };
  }
  const reach: ReachProfile = {
    median: spec.reach?.median ?? 0,
    early: spec.reach?.early ?? 0,
    mid: spec.reach?.mid ?? 0,
    late: spec.reach?.late ?? 0,
    n: spec.reach?.n ?? 90,
    label: spec.reach?.label ?? "Drafts the board",
  };
  return {
    memberId: spec.memberId ?? "M1",
    name: spec.name ?? "Manager M1",
    seasons: [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].slice(
      0,
      spec.draftCount ?? 9,
    ),
    draftCount: spec.draftCount ?? 9,
    smallSample: (spec.draftCount ?? 9) < 5,
    pickCount: 108,
    premium,
    order: CATEGORIES.slice().sort((a, b) => premium[b].premium - premium[a].premium),
    reach,
    positionLean: [],
    teamAffinity: (spec.teamAffinity ?? []).map((proTeamId) => ({
      proTeamId,
      count: 6,
      share: 10,
      leagueShare: 3,
    })),
    summary: "",
  };
}

// Snake order over teamCount teams and rounds rounds, as a teamId per
// overall pick.
export function makeSnakeOrder(teamCount: number, rounds: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < rounds; r++) {
    for (let t = 0; t < teamCount; t++) {
      out.push(r % 2 === 0 ? t + 1 : teamCount - t);
    }
  }
  return out;
}

export function makeLeague(options: LeagueOptions): SynthLeague {
  const teams = options.teams ?? 12;
  const rounds = options.rounds ?? 12;
  const seed = options.seed ?? 7;
  const noise = options.categoryNoise ?? 0.35;

  const seasons: Record<string, DraftHistorySeason> = {};
  const members: Record<string, string> = {};
  const pools: Record<number, SynthPlayer[]> = {};
  const picksByMember: SynthLeague["picksByMember"] = {};
  const adp: AdpHistory = {};

  options.seasons.forEach((seasonId, seasonIndex) => {
    const pool = makePool({
      count: teams * rounds + 40,
      seed: seed + seasonIndex * 101,
      categoryNoise: noise,
    });
    pools[seasonId] = pool;
    adp[String(seasonId)] = pool.map((p) => [normName(p.name), p.adp] as [string, number]);

    const ownersForSeason = options.owners?.[seasonId];
    const owners: Record<string, string> = {};
    for (let t = 1; t <= teams; t++) {
      const memberId = ownersForSeason?.[t] ?? "M" + t;
      owners[String(t)] = memberId;
      members[memberId] = "Manager " + memberId;
    }

    // Snake order.
    const order: number[] = [];
    for (let r = 0; r < rounds; r++) {
      for (let t = 0; t < teams; t++) {
        order.push(r % 2 === 0 ? t + 1 : teams - t);
      }
    }

    const available = pool.slice();
    const picks: HistoryPick[] = [];
    const players: Record<string, HistoryPlayer> = {};

    order.forEach((teamId, index) => {
      const memberId = owners[String(teamId)] as string;
      const round = Math.floor(index / teams) + 1;
      const overall = index + 1;
      const strategy = options.strategies?.[memberId] ?? byRank;
      const choice = Math.min(
        Math.max(0, strategy({ teamId, memberId, round, overall, available })),
        available.length - 1,
      );
      const player = available.splice(choice, 1)[0] as SynthPlayer;

      picks.push([overall, round, teamId, player.playerId]);
      players[String(player.playerId)] = toHistoryPlayer(
        player,
        options.espnRankFor ? options.espnRankFor(player) : player.adp,
      );

      if (!picksByMember[memberId]) picksByMember[memberId] = [];
      (picksByMember[memberId] as Array<{ season: number; overall: number; player: SynthPlayer }>).push(
        { season: seasonId, overall, player },
      );
    });

    seasons[String(seasonId)] = { picks, owners, players };
  });

  return {
    history: { leagueId: "synthetic", version: 1, seasons, members },
    adp,
    pools,
    picksByMember,
  };
}
