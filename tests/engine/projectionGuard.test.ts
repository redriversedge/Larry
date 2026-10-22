// Rankings v3.1 change C: what ESPN's projection set MEANS, and a guard for
// the day it changes. docs/RANKINGS_V3_1_INSEASON_SPEC.md sections 1c and 5.
//
// The `statSourceId 1, statSplitTypeId 0` set for the current season is a
// FULL-SEASON total: games already played plus games still to come. Three
// days into 2026-27, Mikal Bridges, Buddy Hield and Harrison Barnes were all
// projected for 82 games after their teams had already played one, and a
// rest-of-season number cannot exceed 81.
//
// That is worth pinning because nothing would fail if ESPN changed it. Every
// projected rate in the app would just quietly shrink toward zero as the
// season went on, and the board would get worse for a reason no test could
// see.

import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

// ESPN stat ids, per CLAUDE.md: 0=PTS, 1=BLK, 2=STL, 3=AST, 6=REB, 42=GP.
const STAT_IDS = { PTS: "0", BLK: "1", STL: "2", AST: "3", REB: "6", GP: "42", MIN: "40" };

interface SyncLogEntry { status: string; message: string }

// espn.js is a browser IIFE. Load it with the globals it closes over.
function loadESPNSync(state: any, log: SyncLogEntry[], today?: string) {
  const src = fs.readFileSync(path.join(ROOT, "js/espn.js"), "utf8");
  const sandbox: any = {};
  sandbox.window = sandbox;
  const localDateStr = (d?: any) => {
    if (!d && today) return today;
    const dt = d ? new Date(d) : new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return dt.getFullYear() + "-" + p(dt.getMonth() + 1) + "-" + p(dt.getDate());
  };
  const globals: Record<string, any> = {
    window: sandbox,
    globalThis: sandbox,
    console,
    document: { querySelectorAll: () => [], getElementById: () => null },
    fetch: undefined,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    S: state,
    SYNC_IN_PROGRESS: false,
    ESPN_TEAM_MAP: { 24: "SAS", 17: "BKN" },
    ESPN_SLOT_MAP: { 0: "PG", 11: "UTIL", 12: "BE", 13: "IR" },
    ESPN_POS_MAP: { 1: "PG", 5: "C" },
    ESPN_STAT_MAP: { 0: "PTS", 1: "BLK", 2: "STL", 3: "AST", 6: "REB", 40: "MIN", 42: "GP" },
    localDateStr,
    computeSeasonId: () => 2027,
    getOrderedCategories: () => [],
    getMatchupDates: () => ({ start: new Date(), end: new Date(), daysLeft: 4 }),
    autosave: () => {},
    render: () => {},
    addSyncLog: (status: string, message: string) => { log.unshift({ status, message }); },
    updateSyncIndicator: () => {},
    setEspnExpired: () => {},
    Engines: {
      ensureDURANT: () => {}, computeMatchupStrategy: () => {}, rosProjections: () => {},
    },
  };
  const names = Object.keys(globals);
  const fn = new Function(
    ...names,
    src + "\n; window.ESPNSync = ESPNSync; return window.ESPNSync;",
  );
  return fn(...names.map((n) => globals[n]));
}

function baseState(over: Record<string, any> = {}) {
  return {
    league: { seasonId: 2027, teamCount: 12, rosterSize: 13, currentScoringPeriodId: 3 },
    espn: { syncLog: [] },
    allPlayers: [],
    nbaSchedule: null,
    scheduleLookup: {},
    ...over,
  };
}

// One ESPN player entry with a full-season projection and an actual line.
function entryWith(args: {
  id: number;
  name: string;
  playedGames: number;
  played?: Record<string, number>;
  projected: Record<string, number>;
  projectedGP: number;
}) {
  const statsOf = (vals: Record<string, number>, gp: number) => {
    const out: Record<string, number> = {};
    for (const [cat, v] of Object.entries(vals)) {
      out[(STAT_IDS as Record<string, string>)[cat] as string] = v;
    }
    out[STAT_IDS.GP] = gp;
    return out;
  };
  const stats: any[] = [
    {
      seasonId: 2027, statSourceId: 1, statSplitTypeId: 0,
      stats: statsOf(args.projected, args.projectedGP),
    },
  ];
  if (args.playedGames > 0 && args.played) {
    stats.push({
      seasonId: 2027, statSourceId: 0, statSplitTypeId: 0,
      stats: statsOf(args.played, args.playedGames),
    });
  }
  return {
    lineupSlotId: 11,
    playerPoolEntry: {
      player: {
        id: args.id, fullName: args.name, proTeamId: 24,
        eligibleSlots: [11], defaultPositionId: 5,
        injuryStatus: "ACTIVE", ownership: { percentOwned: 50 },
        stats,
      },
    },
  };
}

describe("ESPN projections are full-season totals, not rest of season", () => {
  it("reads a current-season source-1 split-0 set as full-season totals", () => {
    // The Bridges case: his team has played one game and ESPN projects him
    // for 82. A rest-of-season total could not exceed 81, so the set covers
    // the whole season and the right divisor is the projected game count.
    const log: SyncLogEntry[] = [];
    const ESPNSync = loadESPNSync(baseState(), log);
    const player = ESPNSync.parsePlayer(
      entryWith({
        id: 3907387, name: "Mikal Bridges", playedGames: 1,
        played: { PTS: 17, REB: 4, AST: 3, STL: 1, BLK: 0 },
        projected: { PTS: 1230, REB: 328, AST: 246, STL: 82, BLK: 41 },
        projectedGP: 82,
      }),
    );

    expect(player.stats.projectedGP).toBe(82);
    // projectedRate is totals over the games ESPN expects him to PLAY.
    expect(player.stats.projectedRate.PTS).toBeCloseTo(1230 / 82, 10);
    expect(player.stats.projectedRate.REB).toBeCloseTo(328 / 82, 10);
    // At 82 projected games the two divisors agree, which is the tell that
    // the set is full-season: a rest-of-season set after one game played
    // would have to divide by 81 or fewer.
    expect(player.stats.projectedPerGame.PTS).toBeCloseTo(
      player.stats.projectedRate.PTS, 10,
    );
    // The actual line is still his own one game, undisturbed.
    expect(player.gamesPlayed).toBe(1);
    expect(player.stats.season.PTS).toBeCloseTo(17, 10);
  });

  it("divides by the projected games, not 82, for a player ESPN expects to miss time", () => {
    const log: SyncLogEntry[] = [];
    const ESPNSync = loadESPNSync(baseState(), log);
    const player = ESPNSync.parsePlayer(
      entryWith({
        id: 1, name: "Chronic Knee", playedGames: 0,
        projected: { PTS: 1081, REB: 376, AST: 141, STL: 47, BLK: 94 },
        projectedGP: 47,
      }),
    );
    expect(player.stats.projectedGP).toBe(47);
    expect(player.stats.projectedRate.PTS).toBeCloseTo(1081 / 47, 10);
    expect(player.stats.projectedPerGame.PTS).toBeCloseTo(1081 / 82, 10);
    // 47 games over 82 is about 57%, which is how much the /82 divisor
    // understates him. The two are not interchangeable.
    expect(player.stats.projectedPerGame.PTS / player.stats.projectedRate.PTS)
      .toBeCloseTo(47 / 82, 10);
  });

  it("leaves projectedRate null when ESPN gives no projected game count", () => {
    const log: SyncLogEntry[] = [];
    const ESPNSync = loadESPNSync(baseState(), log);
    const player = ESPNSync.parsePlayer(
      entryWith({
        id: 2, name: "No Game Count", playedGames: 0,
        projected: { PTS: 820, REB: 246, AST: 164, STL: 41, BLK: 41 },
        projectedGP: 0,
      }),
    );
    expect(player.stats.projectedGP).toBe(0);
    expect(player.stats.projectedRate).toBeNull();
    // Callers fall back to the /82 rate, which is the best answer available.
    expect(player.stats.projectedPerGame.PTS).toBeCloseTo(820 / 82, 10);
  });
});

describe("projection divisor guard", () => {
  // A board of projected players. gpFor lets a test collapse every
  // projection to a rest-of-season-looking game count.
  function board(gpFor: (i: number) => number, count = 200) {
    const players = [];
    for (let i = 0; i < count; i++) {
      const gp = gpFor(i);
      players.push({
        id: i,
        stats: { projectedSeason: { GP: gp, PTS: 10 * gp, REB: 4 * gp, AST: 2 * gp, STL: gp, BLK: gp } },
      });
    }
    return players;
  }

  it("reads the median projected GP across projected players", () => {
    const ESPNSync = loadESPNSync(baseState(), []);
    // 0 to 199, so the median of the 199 with gp > 0 is 100.
    expect(ESPNSync.medianProjectedGP(board((i) => i))).toBe(100);
    // Players with no projection at all are not counted.
    const mixed = [...board(() => 70, 10), { id: 999, stats: {} }];
    expect(ESPNSync.medianProjectedGP(mixed)).toBe(70);
    expect(ESPNSync.medianProjectedGP([{ id: 1, stats: {} }])).toBeNull();
  });

  it("stays quiet on normal full-season projections", () => {
    const log: SyncLogEntry[] = [];
    const ESPNSync = loadESPNSync(baseState(), log);
    // A realistic spread: plenty of injury risks, median in the 60s.
    expect(ESPNSync.checkProjectionDivisor(board((i) => 40 + (i % 43)))).toBeNull();
    expect(log.length).toBe(0);
  });

  it("warns when the median projected GP collapses before the All-Star break", () => {
    const log: SyncLogEntry[] = [];
    const ESPNSync = loadESPNSync(baseState(), log);
    // What a switch to rest-of-season totals would look like in December.
    const med = ESPNSync.checkProjectionDivisor(board((i) => 20 + (i % 15)));
    expect(med).toBeLessThan(40);
    expect(log.length).toBe(1);
    expect((log[0] as SyncLogEntry).status).toBe("warning");
    expect((log[0] as SyncLogEntry).message).toContain("rest-of-season totals");
    expect((log[0] as SyncLogEntry).message).toContain("projection divisor");
  });

  it("stays quiet after the All-Star break, when the two are hard to tell apart", () => {
    const log: SyncLogEntry[] = [];
    const ESPNSync = loadESPNSync(
      baseState({
        league: {
          seasonId: 2027, teamCount: 12, rosterSize: 13,
          currentScoringPeriodId: 140,
        },
      }),
      log,
    );
    expect(ESPNSync.checkProjectionDivisor(board((i) => 20 + (i % 15)))).toBeNull();
    expect(log.length).toBe(0);
  });

  it("does not warn on an empty board", () => {
    const log: SyncLogEntry[] = [];
    const ESPNSync = loadESPNSync(baseState(), log);
    expect(ESPNSync.checkProjectionDivisor([])).toBeNull();
    expect(ESPNSync.checkProjectionDivisor(board(() => 0, 5))).toBeNull();
    expect(log.length).toBe(0);
  });
});
