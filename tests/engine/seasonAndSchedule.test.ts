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
    "\n; return { getMatchupWindow: getMatchupWindow, getMatchupDates: getMatchupDates };");
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

describe("getMatchupWindow (what the UI prints)", () => {
  it("counts days left inside the real window, not the calendar week", () => {
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
