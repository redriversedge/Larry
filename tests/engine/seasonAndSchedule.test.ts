// Tests for the season rollover decision and the NBA schedule parser.
//
// Both of these were silently broken on the live site in a way that unit
// tests would have caught: the rollover could never fire because nothing
// ever asked ESPN about the new season, and the schedule parser read a
// field ESPN does not return for this league, so every player ended up
// with an empty schedule and a constant gamesRemaining.

import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

// espn.js is a browser IIFE. Load it with the globals it closes over.
function loadESPNSync(state: any) {
  const src = fs.readFileSync(path.join(ROOT, "js/espn.js"), "utf8");
  const sandbox: any = {};
  sandbox.window = sandbox;

  const ESPN_TEAM_MAP: Record<number, string> = {
    1: "ATL", 2: "BOS", 5: "CLE", 9: "GSW", 13: "LAL", 17: "BKN", 25: "OKC",
  };
  const localDateStr = (d?: any) => {
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
    ESPN_TEAM_MAP,
    ESPN_SLOT_MAP: { 0: "PG", 12: "BE", 13: "IR" },
    ESPN_POS_MAP: { 1: "PG" },
    ESPN_STAT_MAP: { 0: "PTS", 42: "GP" },
    localDateStr,
    computeSeasonId: () => 2027,
    getOrderedCategories: () => [],
    getMatchupDates: () => ({ start: new Date(), end: new Date(), daysLeft: 4 }),
    autosave: () => {},
    render: () => {},
    addSyncLog: () => {},
    updateSyncIndicator: () => {},
    setEspnExpired: () => {},
    Engines: {
      ensureDURANT: () => {}, computeMatchupStrategy: () => {}, rosProjections: () => {},
    },
  };
  const names = Object.keys(globals);
  const fn = new Function(...names, src + "\n; window.ESPNSync = ESPNSync; return window.ESPNSync;");
  return fn(...names.map((n) => globals[n]));
}

function baseState(seasonId = 2026): any {
  return {
    league: { seasonId, categories: [], teamCount: 12, schedule: [] },
    espn: { leagueId: "1", espnS2: "x", swid: "y", lastSync: null },
    myTeam: { teamId: 1, players: [], record: { wins: 1, losses: 0, ties: 0 } },
    teams: [{ teamId: 1, players: [{ id: 1 }] }, { teamId: 2, players: [{ id: 2 }] }],
    allPlayers: [{ id: 1 }, { id: 2 }],
    freeAgents: [{ id: 3 }],
    matchup: { opponentTeamId: 2, myScores: { PTS: 100 } },
    scheduleLookup: { 1: [{ date: "2026-01-01" }] },
    scheduleSeasonId: 2026,
    analysisCache: { durantComputedAt: "x", larryMove: { result: {} } },
    prefs: { theme: "larry-dark" },
    watchlist: [42],
    needsResync: true,
    resyncDismissed: true,
  };
}

describe("season rollover decision", () => {
  const ESPNSync = loadESPNSync(baseState());
  const decide = ESPNSync.rollOverDecision;

  it("adopts the new season when ESPN confirms the league exists", () => {
    // The bug: nothing ever probed, so this branch could never be reached
    // and the "sync to load 2027" banner was unclearable.
    expect(decide(2026, 2027, 200)).toEqual({ action: "adopt", season: 2027 });
  });

  it("keeps the old season and explains when ESPN has not opened the new one", () => {
    const d = decide(2026, 2027, 404);
    expect(d.action).toBe("not-open");
    expect(d.season).toBe(2026);
    expect(d.reason).toMatch(/2027/);
    // Critically it must NOT tell the user to sync again, since syncing is
    // what just discovered this.
    expect(d.reason).not.toMatch(/sync/i);
  });

  it("does nothing when the stored season already matches the calendar", () => {
    expect(decide(2027, 2027, 200)).toEqual({ action: "keep", season: 2027 });
  });

  it("treats an inconclusive probe as no evidence and keeps the old season", () => {
    // A 401, a 500 or being offline says nothing about which season it is.
    for (const status of [0, 401, 403, 500, 503]) {
      expect(decide(2026, 2027, status)).toEqual({ action: "keep", season: 2026 });
    }
  });

  it("handles a missing stored season without claiming a rollover", () => {
    expect(decide(0, 2027, 200).action).toBe("keep");
    expect(decide(undefined as any, 2027, 404).action).toBe("keep");
  });
});

describe("season-scoped state reset", () => {
  it("clears last season's data but keeps credentials, prefs and watchlist", () => {
    const state = baseState();
    const ESPNSync = loadESPNSync(state);
    ESPNSync.clearSeasonScopedState();

    // Gone: anything that described last season.
    expect(state.allPlayers).toEqual([]);
    expect(state.freeAgents).toEqual([]);
    expect(state.teams).toEqual([]);
    expect(state.myTeam.players).toEqual([]);
    expect(state.matchup).toEqual({});
    expect(state.scheduleLookup).toEqual({});
    expect(state.analysisCache.durantComputedAt).toBeNull();
    expect(state.analysisCache.larryMove).toBeNull();
    expect(state.needsResync).toBe(false);
    expect(state.resyncDismissed).toBe(false);

    // Kept: things that are not season-specific. Losing the ESPN cookies
    // on a rollover would log the user out for no reason.
    expect(state.espn.leagueId).toBe("1");
    expect(state.espn.espnS2).toBe("x");
    expect(state.prefs.theme).toBe("larry-dark");
    expect(state.watchlist).toEqual([42]);
  });
});

describe("NBA schedule parser (proTeamSchedules_wl)", () => {
  const ESPNSync = loadESPNSync(baseState());
  const build = ESPNSync.buildScheduleLookup;

  // Real response shape: settings.proTeams[] each with
  // proGamesByScoringPeriod keyed by period id.
  function fixture() {
    // 2026-10-20 19:30 local, expressed as epoch ms.
    const game1 = new Date(2026, 9, 20, 19, 30).getTime();
    const game2 = new Date(2026, 9, 22, 20, 0).getTime();
    return {
      settings: {
        proTeams: [
          {
            id: 2, abbrev: "BOS",
            proGamesByScoringPeriod: {
              "1": [{ id: 10, date: game1, homeProTeamId: 2, awayProTeamId: 13, scoringPeriodId: 1 }],
              "3": [{ id: 11, date: game2, homeProTeamId: 9, awayProTeamId: 2, scoringPeriodId: 3 }],
            },
          },
          {
            id: 13, abbrev: "LAL",
            proGamesByScoringPeriod: {
              "1": [{ id: 10, date: game1, homeProTeamId: 2, awayProTeamId: 13, scoringPeriodId: 1 }],
            },
          },
        ],
      },
    };
  }

  it("builds a lookup keyed by proTeamId", () => {
    const lookup = build(fixture());
    expect(Object.keys(lookup).sort()).toEqual(["13", "2"]);
    expect(lookup[2].length).toBe(2);
    expect(lookup[13].length).toBe(1);
  });

  it("resolves home and away correctly from each team's perspective", () => {
    const lookup = build(fixture());
    const bosHome = lookup[2][0];
    expect(bosHome.isHome).toBe(true);
    expect(bosHome.opponent).toBe("LAL");

    const lalAway = lookup[13][0];
    expect(lalAway.isHome).toBe(false);
    expect(lalAway.opponent).toBe("BOS");

    // Same game, opposite perspectives, same date.
    expect(bosHome.date).toBe(lalAway.date);
  });

  it("converts epoch ms to a LOCAL date string", () => {
    // This is the bug class that bit gamesRemaining: toISOString on a 7:30pm
    // US Central game yields the NEXT day in UTC, so today's games vanished
    // after 7pm.
    const lookup = build(fixture());
    expect(lookup[2][0].date).toBe("2026-10-20");
    expect(lookup[2][1].date).toBe("2026-10-22");
  });

  it("sorts each team's games by date", () => {
    const lookup = build(fixture());
    const dates = lookup[2].map((g: any) => g.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("flattens every scoring period into one list", () => {
    const lookup = build(fixture());
    const periods = lookup[2].map((g: any) => g.scoringPeriodId).sort();
    expect(periods).toEqual([1, 3]);
  });

  it("returns an empty lookup rather than throwing on a bad response", () => {
    // The old parser read scoreboard.proGames, which ESPN does not return
    // here. Whatever the shape, this must degrade and let gamesRemaining
    // fall back to an estimate.
    expect(build(undefined)).toEqual({});
    expect(build(null)).toEqual({});
    expect(build({})).toEqual({});
    expect(build({ settings: {} })).toEqual({});
    expect(build({ settings: { proTeams: [] } })).toEqual({});
    expect(build({ scoreboard: { proGames: {} } })).toEqual({});
  });

  it("skips malformed teams and games without dropping the good ones", () => {
    const f: any = fixture();
    f.settings.proTeams.push(null);
    f.settings.proTeams.push({ abbrev: "NOID" });
    f.settings.proTeams.push({ id: 5, proGamesByScoringPeriod: null });
    f.settings.proTeams.push({
      id: 9, proGamesByScoringPeriod: { "1": [{ id: 1 }, null] },
    });
    const lookup = build(f);
    expect(lookup[2].length).toBe(2);
    expect(lookup[9]).toEqual([]);
  });
});

describe("games remaining from a real schedule", () => {
  const ESPNSync = loadESPNSync(baseState());
  const count = ESPNSync.countGamesInRange;

  const schedule = [
    { date: "2026-10-18" },
    { date: "2026-10-20" },
    { date: "2026-10-21" },
    { date: "2026-10-25" },
    { date: "2027-01-05" },
  ];

  it("counts inclusively between two local date strings", () => {
    expect(count(schedule, "2026-10-20", "2026-10-25")).toBe(3);
  });

  it("includes a game played today", () => {
    // String comparison, so an evening game on the boundary date still
    // counts. This is the behaviour that broke under UTC parsing.
    expect(count(schedule, "2026-10-20", "2026-10-20")).toBe(1);
  });

  it("gives a rest-of-season count in the dozens, not the single digits", () => {
    const season = [];
    for (let d = 1; d <= 60; d++) {
      const day = new Date(2026, 10, 1);
      day.setDate(day.getDate() + d * 2);
      const p = (n: number) => String(n).padStart(2, "0");
      season.push({
        date: day.getFullYear() + "-" + p(day.getMonth() + 1) + "-" + p(day.getDate()),
      });
    }
    // The live symptom was gamesRemainingROS = 0 for all 666 players.
    expect(count(season, "2026-11-01", "2027-04-15")).toBeGreaterThan(20);
  });

  it("returns zero for an empty or missing schedule", () => {
    expect(count([], "2026-10-01", "2027-04-15")).toBe(0);
    expect(count(null, "2026-10-01", "2027-04-15")).toBe(0);
    expect(count(undefined, "2026-10-01", "2027-04-15")).toBe(0);
  });

  it("skips entries with no date", () => {
    expect(count([{ date: "" }, {}, { date: "2026-10-20" }], "2026-10-01", "2026-11-01")).toBe(1);
  });
});

describe("matchup windows", () => {
  // A matchup window is not a calendar week. Two ways that bit:
  //  - Preseason, the current calendar week has no NBA games at all, so
  //    every player showed 0 games even though matchup 1 is coming.
  //  - Playoff matchups span two scoring periods, so a calendar week
  //    covers half of one.
  function stateWithSchedule(over: any = {}) {
    const s = baseState(2027);
    s.league.matchupPeriods = { "1": [1], "2": [2], "18": [18, 19] };
    s.league.currentMatchupPeriod = 0; // preseason
    s.scheduleLookup = {
      2: [
        { date: "2026-10-20", scoringPeriodId: 1 },
        { date: "2026-10-22", scoringPeriodId: 1 },
        { date: "2026-10-27", scoringPeriodId: 2 },
        { date: "2027-02-16", scoringPeriodId: 18 },
        { date: "2027-02-23", scoringPeriodId: 19 },
      ],
      13: [
        { date: "2026-10-21", scoringPeriodId: 1 },
        { date: "2027-02-18", scoringPeriodId: 18 },
      ],
    };
    return Object.assign(s, over);
  }

  it("maps a playoff matchup to both of its scoring periods", () => {
    const state = stateWithSchedule();
    const ESPNSync = loadESPNSync(state);
    // Exercised through the window helpers, which are what callers use.
    state.league.currentMatchupPeriod = 18;
    ESPNSync.enrichGamesRemaining();
    // Matchup 18 spans periods 18 and 19, so the window has to reach the
    // Feb 23 game, not stop at the end of the first week.
    expect(state.matchup.windowStart).toBe("2027-02-16");
    expect(state.matchup.windowEnd).toBe("2027-02-23");
    expect(state.matchup.windowSource).toBe("schedule");
  });

  it("uses matchup 1's window before the season starts", () => {
    const state = stateWithSchedule();
    const ESPNSync = loadESPNSync(state);
    ESPNSync.enrichGamesRemaining();
    expect(state.matchup.windowMatchupPeriodId).toBe(1);
    expect(state.matchup.windowStart).toBe("2026-10-20");
    expect(state.matchup.windowEnd).toBe("2026-10-22");
  });

  it("counts a future window from its start, not from today", () => {
    // Today is before opening night, so counting "from today to window end"
    // would still work, but counting from the window start is what makes
    // the preseason number meaningful rather than zero.
    const state = stateWithSchedule();
    state.allPlayers = [
      { id: 1, proTeamId: 2, schedule: state.scheduleLookup[2] },
      { id: 2, proTeamId: 13, schedule: state.scheduleLookup[13] },
    ];
    const ESPNSync = loadESPNSync(state);
    ESPNSync.enrichGamesRemaining();
    expect(state.allPlayers[0].gamesRemaining).toBe(2); // Oct 20 and 22
    expect(state.allPlayers[1].gamesRemaining).toBe(1); // Oct 21
  });

  it("falls back to the calendar week when there is no schedule", () => {
    const state = stateWithSchedule({ scheduleLookup: {} });
    const ESPNSync = loadESPNSync(state);
    ESPNSync.enrichGamesRemaining();
    expect(state.matchup.windowSource).toBe("calendar");
  });
});

describe("games remaining for players without a schedule", () => {
  it("gives an unsigned player zero games, not the weekly estimate", () => {
    // The 3.5-games-a-week fallback was applied to anyone without a
    // schedule, so unsigned free agents (Westbrook, Chris Paul) showed 3
    // phantom games while every signed player correctly showed 0. Streaming
    // and Larry's Move then ranked the unsigned players higher.
    const state = baseState(2027);
    state.scheduleLookup = { 2: [{ date: "2026-10-20", scoringPeriodId: 1 }] };
    state.league.matchupPeriods = { "1": [1] };
    state.allPlayers = [
      { id: 1, proTeamId: 0, schedule: [] }, // unsigned
      { id: 2, proTeamId: 2, schedule: state.scheduleLookup[2] },
    ];
    const ESPNSync = loadESPNSync(state);
    ESPNSync.enrichGamesRemaining();

    expect(state.allPlayers[0].gamesRemaining).toBe(0);
    expect(state.allPlayers[0].gamesRemainingROS).toBe(0);
    expect(state.allPlayers[1].gamesRemaining).toBe(1);
  });

  it("gives a signed player zero when their team has no games left", () => {
    const state = baseState(2027);
    state.scheduleLookup = { 2: [{ date: "2026-10-20", scoringPeriodId: 1 }] };
    state.league.matchupPeriods = { "1": [1] };
    // On a real team, but no schedule entries of their own.
    state.allPlayers = [{ id: 3, proTeamId: 99, schedule: [] }];
    const ESPNSync = loadESPNSync(state);
    ESPNSync.enrichGamesRemaining();
    expect(state.allPlayers[0].gamesRemaining).toBe(0);
  });

  it("still estimates when the whole schedule fetch failed", () => {
    // Degrading to an estimate is right when we have no schedule at all;
    // it is only wrong when we DO have one and the player is absent from it.
    const state = baseState(2027);
    state.scheduleLookup = {};
    state.allPlayers = [{ id: 4, proTeamId: 2, schedule: [] }];
    const ESPNSync = loadESPNSync(state);
    ESPNSync.enrichGamesRemaining();
    expect(state.allPlayers[0].gamesRemaining).toBeGreaterThan(0);
  });
});
