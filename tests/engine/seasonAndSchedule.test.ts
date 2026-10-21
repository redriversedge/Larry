// Tests for the season rollover decision and the NBA schedule parser.
//
// Both of these were silently broken on the live site in a way that unit
// tests would have caught: the rollover could never fire because nothing
// ever asked ESPN about the new season, and the schedule parser read a
// field ESPN does not return for this league, so every player ended up
// with an empty schedule and a constant gamesRemaining.

import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Several tests describe opening week as it looks BEFORE opening night
// ("the whole 6-day window counts"). They read the real clock, so they
// started failing on Oct 21 2026, the day after the season began. Pin the
// clock for those tests instead of letting them drift with the calendar.
function pinClock(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}
afterEach(() => { vi.useRealTimers(); });

const ROOT = path.resolve(__dirname, "../..");

// espn.js is a browser IIFE. Load it with the globals it closes over.
function loadESPNSync(state: any, overrides: Record<string, any> = {}) {
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
  Object.assign(globals, overrides);
  const names = Object.keys(globals);
  const fn = new Function(...names, src + "\n; window.ESPNSync = ESPNSync; return window.ESPNSync;");
  return fn(...names.map((n) => globals[n]));
}

// core.js is a plain script of top-level functions over a module-scope S.
function loadCore(state: any) {
  const src = fs.readFileSync(path.join(ROOT, "js/core.js"), "utf8");
  const sandbox: any = {};
  sandbox.window = sandbox;
  const mkEl = () => ({
    innerHTML: "", textContent: "", style: { setProperty() {}, cssText: "" },
    classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {},
    querySelector: () => null, querySelectorAll: () => [], appendChild() {},
  });
  const store = () => ({
    _d: {} as Record<string, string>,
    getItem(k: string) { return this._d[k] ?? null; },
    setItem(k: string, v: string) { this._d[k] = String(v); },
    removeItem(k: string) { delete this._d[k]; },
  });
  const globals: Record<string, any> = {
    window: sandbox, globalThis: sandbox, console,
    document: {
      getElementById: () => mkEl(), querySelector: () => null,
      querySelectorAll: () => [], addEventListener() {}, createElement: mkEl,
      body: mkEl(), documentElement: mkEl(),
    },
    localStorage: store(), sessionStorage: store(),
    navigator: { userAgent: "node" }, location: { href: "", reload() {} },
    setTimeout, clearTimeout, fetch: undefined,
  };
  const names = Object.keys(globals);
  const fn = new Function(...names, src +
    "\n; S = arguments[arguments.length - 1];" +
    "\n; return { getMatchupWindow: getMatchupWindow, getMatchupDates: getMatchupDates," +
    " blendedPerGame: blendedPerGame, gameHasStarted: gameHasStarted, projectRestOfMatchup: projectRestOfMatchup };");
  return fn(...names.map((n) => globals[n]), state);
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
  // A matchup window is a span of WEEKS, not a span of scoring periods.
  //
  // ESPN's scoringPeriods are single days: period 1 is opening night
  // (Tue Oct 20 2026), 2 is Oct 21, up to 174 on Apr 11 2027. But
  // scheduleSettings.matchupPeriods maps a matchup to WEEK numbers:
  // {"1":[1], ... "18":[18,19]}. Reading those as scoring periods made
  // matchup 1 one day long and the two-week playoff matchups two days long,
  // so only 168 of 1000 players had any game and each had exactly 1.
  //
  // These tests use the real 2026-27 opening night so the arithmetic is
  // pinned to a date that can be checked against ESPN.
  const OPENING = "2026-10-20"; // Tuesday

  // A full 174-day scoring period calendar from opening night, which is
  // what ESPN actually publishes.
  function dayStr(offset: number): string {
    const d = new Date(2026, 9, 20);
    d.setDate(d.getDate() + offset);
    const p = (n: number) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function stateWithSchedule(over: any = {}) {
    const s = baseState(2027);
    s.league.matchupPeriods = {
      "1": [1], "2": [2], "3": [3], "17": [17], "18": [18, 19], "19": [20, 21],
    };
    s.league.currentMatchupPeriod = 0; // preseason
    s.league.firstScoringPeriod = 1;
    // Denver: plays Oct 20 (opening night), Oct 22 and Oct 24, then Oct 27.
    // Three of those are inside opening week, which is the whole point.
    s.scheduleLookup = {
      7: [
        { date: "2026-10-22", scoringPeriodId: 3 },
        { date: "2026-10-24", scoringPeriodId: 5 },
        { date: "2026-10-27", scoringPeriodId: 8 },
        { date: "2026-11-01", scoringPeriodId: 13 },
      ],
      13: [
        { date: "2026-10-20", scoringPeriodId: 1 },
        { date: "2026-10-21", scoringPeriodId: 2 },
        { date: "2026-10-26", scoringPeriodId: 7 },
      ],
    };
    return Object.assign(s, over);
  }

  it("finds opening night from the first scoring period", () => {
    const state = stateWithSchedule();
    const ESPNSync = loadESPNSync(state);
    expect(ESPNSync.openingNightStr()).toBe(OPENING);
  });

  it("reads matchupPeriods values as weeks", () => {
    const state = stateWithSchedule();
    const ESPNSync = loadESPNSync(state);
    expect(ESPNSync.matchupWeeks(1)).toEqual([1]);
    expect(ESPNSync.matchupWeeks(18)).toEqual([18, 19]);
    // Unmapped matchup: one week per matchup is ESPN's default.
    expect(ESPNSync.matchupWeeks(99)).toEqual([99]);
  });

  it("runs week 1 from opening night through the first Sunday", () => {
    const state = stateWithSchedule();
    const ESPNSync = loadESPNSync(state);
    // Tue Oct 20 through Sun Oct 25. The short opening week is the one ESPN
    // does not start on a Monday.
    expect(ESPNSync.weekRangeFrom(OPENING, 1))
      .toEqual({ startStr: "2026-10-20", endStr: "2026-10-25" });
  });

  it("runs every later week Monday to Sunday", () => {
    const state = stateWithSchedule();
    const ESPNSync = loadESPNSync(state);
    expect(ESPNSync.weekRangeFrom(OPENING, 2))
      .toEqual({ startStr: "2026-10-26", endStr: "2026-11-01" });
    expect(ESPNSync.weekRangeFrom(OPENING, 3))
      .toEqual({ startStr: "2026-11-02", endStr: "2026-11-08" });
    // Every week from 2 on starts on a Monday and ends on a Sunday.
    for (let w = 2; w <= 24; w++) {
      const r = ESPNSync.weekRangeFrom(OPENING, w);
      const start = new Date(2026, 9, 20);
      start.setDate(start.getDate() + 6 + (w - 2) * 7);
      expect(r.startStr).toBe(dayStr(6 + (w - 2) * 7));
      expect(start.getDay()).toBe(1); // Monday
      const end = new Date(2026, 9, 20);
      end.setDate(end.getDate() + 12 + (w - 2) * 7);
      expect(end.getDay()).toBe(0); // Sunday
      expect(r.endStr).toBe(dayStr(12 + (w - 2) * 7));
    }
  });

  it("spans a two-week playoff matchup across both weeks", () => {
    const state = stateWithSchedule();
    const ESPNSync = loadESPNSync(state);
    const win = ESPNSync.matchupWindowFor(18, OPENING);
    const w18 = ESPNSync.weekRangeFrom(OPENING, 18);
    const w19 = ESPNSync.weekRangeFrom(OPENING, 19);
    expect(win.startStr).toBe(w18.startStr);
    expect(win.endStr).toBe(w19.endStr);
    // Two full Monday-to-Sunday weeks is 14 days, not the 2 days the old
    // scoring-period reading produced.
    const a = new Date(2026, 9, 20);
    a.setDate(a.getDate() + 6 + (18 - 2) * 7);
    const b = new Date(2026, 9, 20);
    b.setDate(b.getDate() + 12 + (19 - 2) * 7);
    expect(Math.round((b.getTime() - a.getTime()) / 86400000) + 1).toBe(14);
    expect(a.getDay()).toBe(1); // starts Monday
    expect(b.getDay()).toBe(0); // ends Sunday
  });

  it("uses matchup 1's full opening week before the season starts", () => {
    const state = stateWithSchedule();
    const ESPNSync = loadESPNSync(state);
    ESPNSync.enrichGamesRemaining();
    expect(state.matchup.windowMatchupPeriodId).toBe(1);
    expect(state.matchup.windowStart).toBe("2026-10-20");
    expect(state.matchup.windowEnd).toBe("2026-10-25");
    expect(state.matchup.windowSource).toBe("schedule");
  });

  it("publishes the window as startDate and endDate for the UI", () => {
    // These two were never assigned, so the dashboard and Timeline had
    // nothing to print.
    const state = stateWithSchedule();
    const ESPNSync = loadESPNSync(state);
    ESPNSync.enrichGamesRemaining();
    expect(state.matchup.startDate).toBe("2026-10-20");
    expect(state.matchup.endDate).toBe("2026-10-25");
  });

  it("gives Jokic his two opening-week games, not zero", () => {
    pinClock("2026-10-13T12:00:00");
    // The live symptom. Denver plays Oct 22 and Oct 24, both inside week 1.
    // The old one-day window (Oct 20 only) counted neither.
    const state = stateWithSchedule();
    state.allPlayers = [
      { id: 1, proTeamId: 7, schedule: state.scheduleLookup[7] },
      { id: 2, proTeamId: 13, schedule: state.scheduleLookup[13] },
    ];
    const ESPNSync = loadESPNSync(state);
    ESPNSync.enrichGamesRemaining();
    expect(state.allPlayers[0].gamesRemaining).toBe(2); // Oct 22, Oct 24
    expect(state.allPlayers[1].gamesRemaining).toBe(2); // Oct 20, Oct 21
  });

  it("picks the matchup whose window contains a given date", () => {
    const state = stateWithSchedule();
    const ESPNSync = loadESPNSync(state);
    expect(ESPNSync.matchupForDateStr("2026-10-20", OPENING)).toBe(1);
    expect(ESPNSync.matchupForDateStr("2026-10-25", OPENING)).toBe(1);
    expect(ESPNSync.matchupForDateStr("2026-10-26", OPENING)).toBe(2);
    expect(ESPNSync.matchupForDateStr("2026-11-01", OPENING)).toBe(2);
    expect(ESPNSync.matchupForDateStr("2026-11-02", OPENING)).toBe(3);
    // A date past the last mapped matchup belongs to none of them.
    expect(ESPNSync.matchupForDateStr("2027-08-01", OPENING)).toBe(0);
  });

  it("prefers ESPN's current matchup period over its own arithmetic", () => {
    // During the season ESPN tells us the answer directly, and that cannot
    // drift from our week math the way a date lookup could.
    const state = stateWithSchedule();
    state.league.currentMatchupPeriod = 3;
    const ESPNSync = loadESPNSync(state);
    ESPNSync.enrichGamesRemaining();
    expect(state.matchup.windowMatchupPeriodId).toBe(3);
    expect(state.matchup.windowStart).toBe("2026-11-02");
    expect(state.matchup.windowEnd).toBe("2026-11-08");
  });

  it("falls back to the calendar week when there is no schedule", () => {
    const state = stateWithSchedule({ scheduleLookup: {} });
    const ESPNSync = loadESPNSync(state);
    ESPNSync.enrichGamesRemaining();
    expect(state.matchup.windowSource).toBe("calendar");
  });

  it("does not parse date strings as UTC midnight", () => {
    // new Date('2026-10-20') is UTC midnight, which is Oct 19 in Central.
    // Week arithmetic built on that shifts every window a day early.
    const state = stateWithSchedule();
    const ESPNSync = loadESPNSync(state);
    expect(ESPNSync.weekRangeFrom("2026-10-20", 2).startStr).toBe("2026-10-26");
    // Crossing a DST boundary must not drop or add a day either. US DST
    // ended Nov 1 2026, so week 2 (Oct 26 to Nov 1) straddles it.
    expect(ESPNSync.weekRangeFrom(OPENING, 2).endStr).toBe("2026-11-01");
    expect(ESPNSync.weekRangeFrom(OPENING, 3).startStr).toBe("2026-11-02");
  });
});

describe("ESPN folds the All-Star break into one 14-day week", () => {
  // Regression test against this league's COMPLETED 2025-26 season, where
  // pointsByScoringPeriod records exactly which days ESPN scored in each
  // matchup. The observed ranges were:
  //
  //   matchup  1: days 1-6     (6d)   weeks [1]
  //   matchup  2: days 7-13    (7d)   weeks [2]
  //   matchup 16: days 105-111 (7d)   weeks [16]
  //   matchup 17: days 112-125 (14d)  weeks [17]   <- All-Star week
  //   matchup 18: days 126-132 (7d)   weeks [18]
  //   matchup 19: days 133-146 (14d)  weeks [19,20]
  //   matchup 20: days 147-160 (14d)  weeks [21,22]
  //   matchup 21: days 161-174 (14d)  weeks [23,24]
  //
  // Opening night was Tue Oct 21 2025. Day 112 = Mon Feb 9 2026 and day 125
  // = Sun Feb 22 2026, so week 17 is one ESPN week across two calendar
  // weeks and every week after it shifts by 7 days.
  const OPENING_2026 = "2025-10-21";

  function dayStrFrom(opening: string, dayNum: number): string {
    const q = opening.split("-");
    const dt = new Date(Number(q[0]), Number(q[1]) - 1, Number(q[2]));
    dt.setDate(dt.getDate() + (dayNum - 1));
    const p = (n: number) => String(n).padStart(2, "0");
    return dt.getFullYear() + "-" + p(dt.getMonth() + 1) + "-" + p(dt.getDate());
  }

  // A schedule with a game every day from opening night except the All-Star
  // break, which is what the detector looks for. 2026's break was Feb 13-18.
  function seasonSchedule(opening: string, breakFrom: string, breakTo: string, days: number) {
    const games: any[] = [];
    for (let i = 1; i <= days; i++) {
      const date = dayStrFrom(opening, i);
      if (date >= breakFrom && date <= breakTo) continue;
      games.push({ date, scoringPeriodId: i });
    }
    return games;
  }

  function state2026() {
    const s = baseState(2026);
    s.league.firstScoringPeriod = 1;
    s.league.matchupPeriods = {
      "1": [1], "2": [2], "16": [16], "17": [17], "18": [18],
      "19": [19, 20], "20": [21, 22], "21": [23, 24],
    };
    s.league.currentMatchupPeriod = 0;
    s.scheduleLookup = {
      2: seasonSchedule(OPENING_2026, "2026-02-13", "2026-02-18", 174),
    };
    return s;
  }

  it("locates the break and the week it belongs to", () => {
    const state = state2026();
    const ESPNSync = loadESPNSync(state);
    expect(ESPNSync.allStarBreakStr()).toBe("2026-02-13");
    // The merge applies to the week containing the break's FIRST day.
    expect(ESPNSync.normalWeekOf(OPENING_2026, "2026-02-13")).toBe(17);
    const plan = ESPNSync.weekPlan();
    expect(plan.openingStr).toBe(OPENING_2026);
    expect(plan.doubleWeek).toBe(17);
  });

  it("reproduces every observed 2025-26 matchup window exactly", () => {
    const state = state2026();
    const ESPNSync = loadESPNSync(state);
    const plan = ESPNSync.weekPlan();
    const expected: Array<[number, number, number]> = [
      [1, 1, 6],
      [2, 7, 13],
      [16, 105, 111],
      [17, 112, 125],
      [18, 126, 132],
      [19, 133, 146],
      [20, 147, 160],
      [21, 161, 174],
    ];
    for (const [matchup, firstDay, lastDay] of expected) {
      const win = ESPNSync.matchupWindowFor(matchup, plan);
      expect(win.startStr, "matchup " + matchup + " start").toBe(dayStrFrom(OPENING_2026, firstDay));
      expect(win.endStr, "matchup " + matchup + " end").toBe(dayStrFrom(OPENING_2026, lastDay));
    }
    // Day 174 is the last day of the NBA regular season.
    expect(dayStrFrom(OPENING_2026, 174)).toBe("2026-04-12");
  });

  it("makes the All-Star week 14 days and keeps the rest at 7", () => {
    const state = state2026();
    const ESPNSync = loadESPNSync(state);
    const plan = ESPNSync.weekPlan();
    const span = (w: number) => {
      const r = ESPNSync.weekRangeFrom(plan, w);
      const a = r.startStr.split("-");
      const b = r.endStr.split("-");
      return Math.round(
        (new Date(Number(b[0]), Number(b[1]) - 1, Number(b[2])).getTime() -
          new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2])).getTime()) / 86400000,
      ) + 1;
    };
    expect(span(1)).toBe(6); // short opening week
    expect(span(16)).toBe(7);
    expect(span(17)).toBe(14); // All-Star
    expect(span(18)).toBe(7);
    expect(span(24)).toBe(7);
  });

  it("derives the 2026-27 double week as 18, which moves the playoffs", () => {
    // The 2027 All-Star break is Feb 19-24, inside the Feb 15-21 week, so
    // ESPN's week 18 should run Feb 15 to Feb 28. Without the merge the app
    // put playoff matchup 18 at Feb 15 to Feb 28 and every later matchup a
    // week early.
    const s = baseState(2027);
    s.league.firstScoringPeriod = 1;
    s.league.matchupPeriods = { "18": [18, 19], "19": [20, 21], "20": [22, 23] };
    s.league.currentMatchupPeriod = 0;
    s.scheduleLookup = {
      2: seasonSchedule("2026-10-20", "2027-02-19", "2027-02-24", 174),
    };
    const ESPNSync = loadESPNSync(s);
    const plan = ESPNSync.weekPlan();
    expect(plan.doubleWeek).toBe(18);
    expect(ESPNSync.weekRangeFrom(plan, 18))
      .toEqual({ startStr: "2027-02-15", endStr: "2027-02-28" });
    // Matchup 18 covers weeks 18 and 19, so it reaches into March.
    expect(ESPNSync.matchupWindowFor(18, plan).startStr).toBe("2027-02-15");
    expect(ESPNSync.matchupWindowFor(18, plan).endStr).toBe("2027-03-07");
    expect(ESPNSync.matchupWindowFor(19, plan).startStr).toBe("2027-03-08");
    expect(ESPNSync.matchupWindowFor(19, plan).endStr).toBe("2027-03-21");
    expect(ESPNSync.matchupWindowFor(20, plan).startStr).toBe("2027-03-22");
    expect(ESPNSync.matchupWindowFor(20, plan).endStr).toBe("2027-04-04");
  });

  it("ignores the December NBA Cup gap, which looks identical", () => {
    // The 2027 schedule has 8 straight gameless days Dec 4-11 (the NBA Cup
    // knockout window). Searching the whole season would find that run
    // first and double the wrong week.
    const s = baseState(2027);
    s.league.firstScoringPeriod = 1;
    const games = seasonSchedule("2026-10-20", "2027-02-19", "2027-02-24", 174)
      .filter((g: any) => !(g.date >= "2026-12-04" && g.date <= "2026-12-11"));
    s.scheduleLookup = { 2: games };
    const ESPNSync = loadESPNSync(s);
    expect(ESPNSync.allStarBreakStr()).toBe("2027-02-19");
    expect(ESPNSync.weekPlan().doubleWeek).toBe(18);
  });

  it("leaves weeks at 7 days when no break can be found", () => {
    const s = baseState(2027);
    s.league.firstScoringPeriod = 1;
    // A game every single day: no break to find.
    s.scheduleLookup = { 2: seasonSchedule("2026-10-20", "2099-01-01", "2099-01-02", 174) };
    const ESPNSync = loadESPNSync(s);
    expect(ESPNSync.allStarBreakStr()).toBeNull();
    expect(ESPNSync.weekPlan().doubleWeek).toBe(0);
    expect(ESPNSync.weekRangeFrom(ESPNSync.weekPlan(), 18))
      .toEqual({ startStr: "2027-02-15", endStr: "2027-02-21" });
  });

  it("needs a run of at least 4 gameless days", () => {
    const s = baseState(2027);
    s.league.firstScoringPeriod = 1;
    // A 3-day gap is an ordinary light stretch, not the All-Star break.
    s.scheduleLookup = { 2: seasonSchedule("2026-10-20", "2027-02-19", "2027-02-21", 174) };
    const ESPNSync = loadESPNSync(s);
    expect(ESPNSync.allStarBreakStr()).toBeNull();
  });

  it("rejects an implausibly long run as missing data, not a break", () => {
    // If February has no games at all the longest run is the whole search
    // window. That means the schedule is incomplete, not that the league
    // took three weeks off, and merging on it would shift every later week.
    const s = baseState(2027);
    s.league.firstScoringPeriod = 1;
    s.scheduleLookup = {
      2: seasonSchedule("2026-10-20", "2027-02-01", "2027-03-15", 174),
    };
    const ESPNSync = loadESPNSync(s);
    expect(ESPNSync.allStarBreakStr()).toBeNull();
    expect(ESPNSync.weekPlan().doubleWeek).toBe(0);
  });
});

describe("All-Star detection against the real 2026-27 NBA schedule", () => {
  // Not synthetic. These are the 156 real game days of the 2026-27 season,
  // fetched from ESPN's proTeamSchedules_wl. The whole season contains
  // exactly two gameless runs of 4 or more days:
  //
  //   2026-12-04 to 2026-12-11  (8 days)  NBA Cup knockout window
  //   2027-02-19 to 2027-02-24  (6 days)  All-Star break
  //
  // The December run is longer, which is precisely why the search is
  // restricted to Feb 1 through Mar 15.
  const real = JSON.parse(
    fs.readFileSync(path.join(ROOT, "tests/fixtures/nba-schedule-2027-gamedays.json"), "utf8"),
  );

  function realState() {
    const s = baseState(2027);
    s.league.firstScoringPeriod = real.firstScoringPeriod;
    s.league.matchupPeriods = {
      "1": [1], "2": [2], "17": [17], "18": [18, 19], "19": [20, 21], "20": [22, 23],
    };
    s.league.currentMatchupPeriod = 0;
    s.scheduleLookup = {
      2: real.gameDays.map((g: [string, number]) => ({ date: g[0], scoringPeriodId: g[1] })),
    };
    return s;
  }

  it("picks the February break over the longer December gap", () => {
    const ESPNSync = loadESPNSync(realState());
    expect(ESPNSync.openingNightStr()).toBe("2026-10-20");
    expect(ESPNSync.allStarBreakStr()).toBe("2027-02-19");
    expect(ESPNSync.weekPlan().doubleWeek).toBe(18);
  });

  it("stretches week 18 to 14 days and shifts the rest", () => {
    const ESPNSync = loadESPNSync(realState());
    const plan = ESPNSync.weekPlan();
    expect(ESPNSync.weekRangeFrom(plan, 17))
      .toEqual({ startStr: "2027-02-08", endStr: "2027-02-14" });
    expect(ESPNSync.weekRangeFrom(plan, 18))
      .toEqual({ startStr: "2027-02-15", endStr: "2027-02-28" });
    expect(ESPNSync.weekRangeFrom(plan, 19))
      .toEqual({ startStr: "2027-03-01", endStr: "2027-03-07" });
  });

  it("places the three playoff matchups where ESPN's pattern says", () => {
    // These are the dates the round-4 report inferred from last season's
    // completed scores. Before this fix the app had matchup 18 ending
    // Feb 28 and 19 and 20 each a full week early.
    const ESPNSync = loadESPNSync(realState());
    const plan = ESPNSync.weekPlan();
    const win = (id: number) => {
      const w = ESPNSync.matchupWindowFor(id, plan);
      return w.startStr + ".." + w.endStr;
    };
    expect(win(18)).toBe("2027-02-15..2027-03-07");
    expect(win(19)).toBe("2027-03-08..2027-03-21");
    expect(win(20)).toBe("2027-03-22..2027-04-04");
  });

  it("still gets opening week and week 2 right", () => {
    const ESPNSync = loadESPNSync(realState());
    const plan = ESPNSync.weekPlan();
    expect(ESPNSync.matchupWindowFor(1, plan).startStr).toBe("2026-10-20");
    expect(ESPNSync.matchupWindowFor(1, plan).endStr).toBe("2026-10-25");
    expect(ESPNSync.matchupWindowFor(2, plan).startStr).toBe("2026-10-26");
    expect(ESPNSync.matchupWindowFor(2, plan).endStr).toBe("2026-11-01");
  });

  it("counts a Denver-shaped week correctly through the break", () => {
    // Week 18 is 14 days, so a team plays roughly twice as many games in it
    // as in a normal week. That is the number streaming decisions turn on.
    const state = realState();
    const schedule = state.scheduleLookup[2];
    const ESPNSync = loadESPNSync(state);
    const plan = ESPNSync.weekPlan();
    const w17 = ESPNSync.weekRangeFrom(plan, 17);
    const w18 = ESPNSync.weekRangeFrom(plan, 18);
    const n17 = ESPNSync.countGamesInRange(schedule, w17.startStr, w17.endStr);
    const n18 = ESPNSync.countGamesInRange(schedule, w18.startStr, w18.endStr);
    // The fixture holds league-wide game days, so this counts days with any
    // game. A 14-day week must contain more of them than a 7-day week.
    expect(n17).toBeGreaterThan(0);
    expect(n18).toBeGreaterThan(n17);
  });
});

describe("observed windows self-correct a wrong week guess", () => {
  // A finished matchup's pointsByScoringPeriod is keyed by scoring period,
  // and a scoring period is one day, so it gives the exact window with no
  // week arithmetic involved. Preferring it means a bad All-Star guess fixes
  // itself for every matchup already played.
  function stateWithHistory() {
    const s = baseState(2027);
    s.league.firstScoringPeriod = 1;
    s.league.matchupPeriods = { "1": [1], "2": [2] };
    s.scheduleLookup = {
      2: [
        { date: "2026-10-20", scoringPeriodId: 1 },
        { date: "2026-10-21", scoringPeriodId: 2 },
        { date: "2026-10-22", scoringPeriodId: 3 },
        { date: "2026-10-26", scoringPeriodId: 7 },
        { date: "2026-10-28", scoringPeriodId: 9 },
      ],
    };
    s.league.schedule = [
      {
        matchupPeriodId: 1,
        home: { pointsByScoringPeriod: { "1": 90, "3": 102 } },
        away: { pointsByScoringPeriod: { "2": 88 } },
      },
    ];
    return s;
  }

  it("keeps the scored day ids when parsing the matchup schedule", () => {
    // parseMatchup used to store only {teamId, wins}, which threw away the
    // one record of which days ESPN scored. The self-correction below would
    // have been dead code against real state.
    const state = baseState(2027);
    state.myTeam.teamId = 1;
    state.league.currentMatchupPeriod = 1;
    const ESPNSync = loadESPNSync(state);
    ESPNSync.parseMatchup({
      schedule: [{
        matchupPeriodId: 1,
        home: { teamId: 1, totalPoints: 5, pointsByScoringPeriod: { "1": 90, "3": 102 } },
        away: { teamId: 2, totalPoints: 4, pointsByScoringPeriod: { "2": 88 } },
      }],
    });
    expect(state.league.schedule[0].home.scoredPeriods).toEqual([1, 3]);
    expect(state.league.schedule[0].away.scoredPeriods).toEqual([2]);
    // The float scores themselves are not retained; only which days counted.
    expect(state.league.schedule[0].home.pointsByScoringPeriod).toBeUndefined();
  });

  it("reads scored days from parsed state, not just raw ESPN data", () => {
    const s = stateWithHistory();
    // Replace the raw shape with the shape parseMatchup actually stores.
    s.league.schedule = [{
      matchupPeriodId: 1,
      home: { teamId: 1, wins: 5, scoredPeriods: [1, 3] },
      away: { teamId: 2, wins: 4, scoredPeriods: [2] },
    }];
    const ESPNSync = loadESPNSync(s);
    expect(ESPNSync.observedMatchupWindows()[1])
      .toEqual({ startStr: "2026-10-20", endStr: "2026-10-22" });
  });

  it("maps scoring periods to their dates", () => {
    const ESPNSync = loadESPNSync(stateWithHistory());
    const dates = ESPNSync.scoringPeriodDates();
    expect(dates[1]).toBe("2026-10-20");
    expect(dates[3]).toBe("2026-10-22");
    expect(dates[9]).toBe("2026-10-28");
  });

  it("reads a finished matchup's real day range from both sides", () => {
    const ESPNSync = loadESPNSync(stateWithHistory());
    const obs = ESPNSync.observedMatchupWindows();
    // Periods 1, 2 and 3 across home and away: Oct 20 through Oct 22.
    expect(obs[1]).toEqual({ startStr: "2026-10-20", endStr: "2026-10-22" });
  });

  it("prefers the observed window over the computed one", () => {
    const state = stateWithHistory();
    const ESPNSync = loadESPNSync(state);
    const plan = ESPNSync.weekPlan();
    const win = ESPNSync.matchupWindowFor(1, plan, ESPNSync.observedMatchupWindows());
    expect(win.source).toBe("observed");
    expect(win.endStr).toBe("2026-10-22");
    // Without the observed data the week model gives the full opening week.
    expect(ESPNSync.matchupWindowFor(1, plan).endStr).toBe("2026-10-25");
  });

  it("ignores the matchup still in progress", () => {
    // Day two of matchup 1 has scored only Oct 20 and 21. Reading that as
    // the window ended the week on Oct 21 and reported 1 day remaining.
    const state = stateWithHistory();
    state.league.currentMatchupPeriod = 1;
    const ESPNSync = loadESPNSync(state);
    expect(ESPNSync.observedMatchupWindows()[1]).toBeUndefined();
    const win = ESPNSync.matchupWindowFor(1, ESPNSync.weekPlan(),
      ESPNSync.observedMatchupWindows());
    expect(win.source).toBe("weeks");
    expect(win.endStr).toBe("2026-10-25");
  });

  it("still reads a finished matchup once the next one starts", () => {
    const state = stateWithHistory();
    state.league.currentMatchupPeriod = 2;
    const ESPNSync = loadESPNSync(state);
    expect(ESPNSync.observedMatchupWindows()[1])
      .toEqual({ startStr: "2026-10-20", endStr: "2026-10-22" });
  });

  it("falls back to the week model for a matchup with no history", () => {
    const state = stateWithHistory();
    const ESPNSync = loadESPNSync(state);
    const win = ESPNSync.matchupWindowFor(2, ESPNSync.weekPlan(),
      ESPNSync.observedMatchupWindows());
    expect(win.source).toBe("weeks");
    expect(win.startStr).toBe("2026-10-26");
  });

  it("warns in the sync log when ESPN disagrees with the computed window", () => {
    // The self-correction signal. If ESPN says matchup N and today is not
    // inside our window for N, the week model is wrong and the user should
    // see it rather than get silently bad numbers all season.
    const logs: Array<[string, string]> = [];
    const state = baseState(2027);
    state.league.firstScoringPeriod = 1;
    state.league.matchupPeriods = { "1": [1] };
    state.league.currentMatchupPeriod = 1;
    // Opening night a long way in the past, so today is well outside
    // matchup 1's window while still being after the season started.
    state.scheduleLookup = { 2: [{ date: "2026-01-05", scoringPeriodId: 1 }] };
    const ESPNSync = loadESPNSync(state, {
      addSyncLog: (level: string, msg: string) => { logs.push([level, msg]); },
    });
    ESPNSync.enrichGamesRemaining();
    const warning = logs.find(([, m]) => /Matchup window looks wrong/.test(m));
    expect(warning).toBeDefined();
    expect(warning![0]).toBe("error");
    expect(warning![1]).toMatch(/ESPN says matchup 1/);
    expect(warning![1]).toMatch(/All-Star week/);
  });

  it("stays quiet before opening night, when being outside is normal", () => {
    // Preseason, the window is matchup 1's and today is legitimately before
    // it. Warning here would fire on every sync until the season started.
    const logs: Array<[string, string]> = [];
    const state = baseState(2027);
    state.league.firstScoringPeriod = 1;
    state.league.matchupPeriods = { "1": [1] };
    state.league.currentMatchupPeriod = 1;
    const future = new Date();
    future.setDate(future.getDate() + 30);
    const p = (n: number) => String(n).padStart(2, "0");
    const futureStr = future.getFullYear() + "-" + p(future.getMonth() + 1) +
      "-" + p(future.getDate());
    state.scheduleLookup = { 2: [{ date: futureStr, scoringPeriodId: 1 }] };
    const ESPNSync = loadESPNSync(state, {
      addSyncLog: (level: string, msg: string) => { logs.push([level, msg]); },
    });
    ESPNSync.enrichGamesRemaining();
    expect(logs.find(([, m]) => /looks wrong/.test(m))).toBeUndefined();
  });

  it("stays quiet when the window contains today", () => {
    const logs: Array<[string, string]> = [];
    const state = baseState(2027);
    state.league.firstScoringPeriod = 1;
    state.league.matchupPeriods = { "1": [1] };
    state.league.currentMatchupPeriod = 1;
    const today = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const todayStr = today.getFullYear() + "-" + p(today.getMonth() + 1) + "-" + p(today.getDate());
    state.scheduleLookup = { 2: [{ date: todayStr, scoringPeriodId: 1 }] };
    const ESPNSync = loadESPNSync(state, {
      addSyncLog: (level: string, msg: string) => { logs.push([level, msg]); },
    });
    ESPNSync.enrichGamesRemaining();
    expect(logs.find(([, m]) => /looks wrong/.test(m))).toBeUndefined();
  });
});

describe("the NBA schedule is refetched daily, not once a season", () => {
  // The NBA Cup knockout window leaves 8 gameless days in early December
  // for teams that have not advanced. Those games are added to the schedule
  // later, as are postponements and reschedules. Caching once per season
  // meant they would never appear and games remaining would undercount.
  function freshState(over: any = {}) {
    const s = baseState(2027);
    s.scheduleLookup = { 2: [{ date: "2026-10-20", scoringPeriodId: 1 }] };
    s.scheduleSeasonId = 2027;
    return Object.assign(s, over);
  }

  it("treats a schedule fetched minutes ago as fresh", () => {
    const state = freshState({ scheduleFetchedAt: new Date().toISOString() });
    const ESPNSync = loadESPNSync(state);
    expect(ESPNSync.scheduleIsFresh()).toBe(true);
  });

  it("treats a schedule over a day old as stale", () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const ESPNSync = loadESPNSync(freshState({ scheduleFetchedAt: old }));
    expect(ESPNSync.scheduleIsFresh()).toBe(false);
  });

  it("treats a schedule with no timestamp as stale", () => {
    // Everyone's existing state has no scheduleFetchedAt, so the first sync
    // after this ships must refetch rather than trust the cached copy.
    const ESPNSync = loadESPNSync(freshState());
    expect(ESPNSync.scheduleIsFresh()).toBe(false);
  });

  it("still refetches on a season rollover", () => {
    const state = freshState({
      scheduleFetchedAt: new Date().toISOString(),
      scheduleSeasonId: 2026,
    });
    const ESPNSync = loadESPNSync(state);
    expect(ESPNSync.scheduleIsFresh()).toBe(false);
  });

  it("treats an empty lookup as stale", () => {
    const state = freshState({
      scheduleFetchedAt: new Date().toISOString(),
      scheduleLookup: {},
    });
    const ESPNSync = loadESPNSync(state);
    expect(ESPNSync.scheduleIsFresh()).toBe(false);
  });
});

describe("getMatchupWindow (what the UI prints)", () => {
  it("counts days left inside the real window, not the calendar week", () => {
    pinClock("2026-10-13T12:00:00");
    const state = baseState(2027);
    state.matchup = { startDate: "2026-10-20", endDate: "2026-10-25" };
    const core = loadCore(state);
    const win = core.getMatchupWindow();
    expect(win.startStr).toBe("2026-10-20");
    expect(win.endStr).toBe("2026-10-25");
    expect(win.label).toBe("2026-10-20 to 2026-10-25");
    expect(win.source).toBe("schedule");
    // Today is well before opening night, so the whole 6-day window counts.
    expect(win.daysLeft).toBe(6);
  });

  it("spans 14 days for a two-week playoff matchup", () => {
    const state = baseState(2027);
    state.matchup = { startDate: "2027-03-08", endDate: "2027-03-21" };
    const core = loadCore(state);
    expect(core.getMatchupWindow().daysLeft).toBe(14);
  });

  it("reports zero once the window has passed", () => {
    const state = baseState(2027);
    state.matchup = { startDate: "2020-01-01", endDate: "2020-01-07" };
    const core = loadCore(state);
    expect(core.getMatchupWindow().daysLeft).toBe(0);
  });

  it("falls back to the calendar week before the first sync", () => {
    const state = baseState(2027);
    state.matchup = {};
    const core = loadCore(state);
    const win = core.getMatchupWindow();
    expect(win.source).toBe("calendar");
    expect(win.label).toBe("");
    expect(win.daysLeft).toBeLessThanOrEqual(7);
  });

  it("accepts the window under its older field names", () => {
    const state = baseState(2027);
    state.matchup = { windowStart: "2026-10-20", windowEnd: "2026-10-25" };
    const core = loadCore(state);
    expect(core.getMatchupWindow().startStr).toBe("2026-10-20");
  });
});

describe("games remaining for players without a schedule", () => {
  it("gives an unsigned player zero games, not the weekly estimate", () => {
    pinClock("2026-10-13T12:00:00");
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

describe("lineup slots", () => {
  it("keeps a player in the PG slot (id 0) as a starter", () => {
    // `lineupSlotId || 12` turned slot 0 into the bench, so the Roster tab
    // showed 7 starters and 5 bench in a league that starts 8.
    const ESPNSync = loadESPNSync(baseState(2027));
    const p = ESPNSync.parsePlayer({
      lineupSlotId: 0,
      playerPoolEntry: { player: { id: 9, fullName: "Point Guard", proTeamId: 2, eligibleSlots: [0, 5, 11, 12] } },
    });
    expect(p.slotId).toBe(0);
    expect(p.slot).toBe("PG");
  });

  it("still defaults a missing slot to the bench", () => {
    const ESPNSync = loadESPNSync(baseState(2027));
    const p = ESPNSync.parsePlayer({
      playerPoolEntry: { player: { id: 9, fullName: "Nobody", proTeamId: 2, eligibleSlots: [12] } },
    });
    expect(p.slotId).toBe(12);
  });
});

describe("live matchup scores", () => {
  it("prefers cumulativeScoreLive so games in progress count", () => {
    const state = baseState(2027);
    state.myTeam.teamId = 1;
    state.league.currentMatchupPeriod = 1;
    state.league.categories = [{ id: 0, abbr: "PTS" }, { id: 6, abbr: "REB" }];
    state.teams = [{ teamId: 2, name: "Opp" }];
    const ESPNSync = loadESPNSync(state);
    ESPNSync.parseMatchup({
      schedule: [{
        matchupPeriodId: 1,
        home: {
          teamId: 1,
          cumulativeScore: { scoreByStat: {} },
          cumulativeScoreLive: { scoreByStat: { "0": { score: 61 }, "6": { score: 33 } } },
        },
        away: {
          teamId: 2,
          cumulativeScore: { scoreByStat: {} },
          cumulativeScoreLive: { scoreByStat: { "0": { score: 19 }, "6": { score: 40 } } },
        },
      }],
    });
    expect(state.matchup.myScores).toEqual({ PTS: 61, REB: 33 });
    expect(state.matchup.oppScores).toEqual({ PTS: 19, REB: 40 });
    expect(state.matchup.myRecord).toEqual({ wins: 1, losses: 1, ties: 0 });
  });
});

describe("matchup projection (rest of the matchup)", () => {
  function state() {
    const st = baseState(2027);
    st.matchup = { startDate: "2026-10-20", endDate: "2026-10-25" };
    st.league.rosterSlots = [{ slotId: 0, count: 1 }, { slotId: 12, count: 4 }];
    st.league.categories = [{ id: 0, abbr: "PTS" }];
    return st;
  }
  const cat = (s: any, k: string) => s[k];

  it("leans on the projection before a player has played", () => {
    const core = loadCore(state());
    const pg = core.blendedPerGame({ stats: {
      season: { PTS: 0 }, gp: { season: 0 }, projectedRate: { PTS: 20 },
    } });
    expect(cat(pg, "PTS")).toBe(20);
  });

  it("moves toward the season line as games accumulate", () => {
    const core = loadCore(state());
    const pg = core.blendedPerGame({ stats: {
      season: { PTS: 30 }, gp: { season: 5 }, projectedRate: { PTS: 20 },
    } });
    expect(cat(pg, "PTS")).toBe(25); // 5 / (5 + 5) of the way
  });

  it("knows a game has tipped off from its local start time", () => {
    const core = loadCore(state());
    const evening = new Date(2026, 9, 21, 19, 0);
    expect(core.gameHasStarted({ date: "2026-10-21", timeLocal: "6:30 PM" }, evening)).toBe(true);
    expect(core.gameHasStarted({ date: "2026-10-21", timeLocal: "9:00 PM" }, evening)).toBe(false);
    expect(core.gameHasStarted({ date: "2026-10-20", timeLocal: "9:00 PM" }, evening)).toBe(true);
    expect(core.gameHasStarted({ date: "2026-10-22", timeLocal: "6:00 PM" }, evening)).toBe(false);
  });

  it("adds only unstarted games inside the window, best players first per day", () => {
    pinClock("2026-10-21T12:00:00");
    const core = loadCore(state());
    const mk = (id: number, score: number, pts: number, dates: string[], extra: any = {}) => ({
      id, durantScore: score, slotId: 12, injuryStatus: "ACTIVE",
      stats: { season: {}, gp: { season: 0 }, projectedRate: { PTS: pts } },
      schedule: dates.map((d) => ({ date: d, timeLocal: "7:00 PM" })), ...extra,
    });
    const players = [
      mk(1, 50, 30, ["2026-10-21", "2026-10-23"]),
      // Same day as player 1 with only one starting slot: sits.
      mk(2, 10, 10, ["2026-10-21"]),
      // Outside the window: not counted.
      mk(3, 40, 25, ["2026-10-26"]),
      // OUT: not counted.
      mk(4, 60, 40, ["2026-10-22"], { injuryStatus: "OUT" }),
    ];
    const r = core.projectRestOfMatchup(players, new Date(2026, 9, 21, 12, 0));
    expect(r.games).toBe(2);
    expect(r.totals.PTS).toBe(60);
  });
});
