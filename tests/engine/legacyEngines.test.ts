// Tests for the legacy ES5 engines in js/engines.js.
//
// Those engines are an IIFE meant for a browser, not a module, so the suite
// loads the real file into a sandbox with the globals it expects and then
// exercises the exported helpers. This is deliberately the actual shipping
// file rather than a reimplementation: the bugs phase 3 fixes were all in
// code that looked fine in isolation.

import * as fs from "fs";
import * as path from "path";
import { beforeEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

interface LegacyPlayer {
  id: number;
  name: string;
  slotId: number;
  onTeamId: number;
  proTeamId: number;
  injuryStatus: string;
  gamesPlayed: number;
  gamesRemaining: number;
  gamesRemainingROS?: number;
  gamesToday?: boolean;
  minutesPerGame: number;
  percentOwned: number;
  positions: string[];
  nbaTeam: string;
  stats: Record<string, Record<string, number>>;
  zScores?: Record<string, number>;
  durantScore?: number;
  effectiveDURANT?: number;
}

const CATS = ["REB", "AST", "STL", "BLK", "PTS"];

function makePlayer(over: Partial<LegacyPlayer> & { id: number }): LegacyPlayer {
  const season: Record<string, number> = {};
  for (const c of CATS) season[c] = 0;
  return {
    name: `P${over.id}`,
    slotId: 12,
    onTeamId: 0,
    proTeamId: 1,
    injuryStatus: "ACTIVE",
    gamesPlayed: 60,
    gamesRemaining: 3,
    gamesRemainingROS: 40,
    gamesToday: false,
    minutesPerGame: 30,
    percentOwned: 50,
    positions: ["SG"],
    nbaTeam: "BOS",
    stats: { season, last7: { ...season }, last30: { ...season }, totals: {}, gp: {} },
    ...over,
  } as LegacyPlayer;
}

// Load engines.js with the globals it closes over. Returns the Engines
// module plus the live S object so tests can mutate state.
function loadEngines(state: any) {
  const src = fs.readFileSync(path.join(ROOT, "js/engines.js"), "utf8");
  const sandbox: any = { S: state };
  sandbox.window = sandbox;
  const getOrderedCategories = () =>
    (state.league?.categories ?? []).slice();
  const fmt = (n: number, d: number) => Number(n).toFixed(d);
  const ESPNSync = { splitGP: () => 0 };
  const fn = new Function(
    "window", "S", "getOrderedCategories", "fmt", "console", "document", "ESPNSync",
    src + "\n; window.Engines = Engines; return window.Engines;",
  );
  return fn(sandbox, state, getOrderedCategories, fmt, console,
    { querySelectorAll: () => [] }, ESPNSync);
}

function baseState(): any {
  return {
    league: {
      teamCount: 12,
      rosterSize: 13,
      categories: CATS.map((abbr) => ({ abbr, isNegative: false, isPercent: false })),
    },
    espn: { lastSync: "2026-10-13T00:00:00Z" },
    myTeam: { teamId: 1, players: [] },
    teams: [],
    matchup: {},
    allPlayers: [],
    prefs: {},
    analysisCache: {},
  };
}

describe("legacy engines: injury status normalization", () => {
  let Engines: any;
  beforeEach(() => { Engines = loadEngines(baseState()); });

  it("treats every ESPN spelling of unavailable as OUT", () => {
    // These used to be compared as string literals in three different
    // places, each checking a different subset. INJURY_RESERVE in
    // particular slipped past the add-candidate filter.
    for (const s of ["OUT", "SUSPENSION", "IR", "INJURY_RESERVE", "INJURED_RESERVE", "NA"]) {
      expect(Engines.normalizeInjuryStatus(s)).toBe("OUT");
      expect(Engines.isUnavailable({ injuryStatus: s })).toBe(true);
    }
  });

  it("collapses the day-to-day spellings to GTD", () => {
    for (const s of ["GTD", "DAY_TO_DAY", "GAME_TIME_DECISION", "QUESTIONABLE", "DOUBTFUL"]) {
      expect(Engines.normalizeInjuryStatus(s)).toBe("GTD");
      expect(Engines.isUnavailable({ injuryStatus: s })).toBe(false);
    }
  });

  it("defaults missing or unknown status to ACTIVE", () => {
    expect(Engines.normalizeInjuryStatus(undefined)).toBe("ACTIVE");
    expect(Engines.normalizeInjuryStatus("")).toBe("ACTIVE");
    expect(Engines.normalizeInjuryStatus("ACTIVE")).toBe("ACTIVE");
  });

  it("never offers an unavailable player as an add", () => {
    const out = makePlayer({ id: 1, injuryStatus: "INJURY_RESERVE", minutesPerGame: 34 });
    expect(Engines.isValidAddCandidate(out)).toBe(false);
  });
});

describe("legacy engines: win probability", () => {
  let Engines: any;
  beforeEach(() => { Engines = loadEngines(baseState()); });

  it("normalCDF matches known values", () => {
    expect(Engines.normalCDF(0)).toBeCloseTo(0.5, 6);
    expect(Engines.normalCDF(1)).toBeCloseTo(0.8413, 3);
    expect(Engines.normalCDF(-1)).toBeCloseTo(0.1587, 3);
    expect(Engines.normalCDF(1.96)).toBeCloseTo(0.975, 3);
  });

  it("is symmetric around a tied projection", () => {
    expect(Engines.categoryWinProb(0, 100)).toBeCloseTo(0.5, 6);
  });

  it("gets less certain as more games remain", () => {
    // Same 10-unit lead. With little variance left the category is nearly
    // decided; with a lot of basketball still to play it is not. The old
    // margin-percentage formula could not express this at all.
    const nearlyOver = Engines.categoryWinProb(10, 4);
    const lotsLeft = Engines.categoryWinProb(10, 400);
    expect(nearlyOver).toBeGreaterThan(lotsLeft);
    expect(lotsLeft).toBeGreaterThan(0.5);
  });

  it("never claims certainty", () => {
    // Injuries and rest days are not modelled, so 100% is a lie.
    expect(Engines.categoryWinProb(99999, 1)).toBeLessThanOrEqual(0.97);
    expect(Engines.categoryWinProb(-99999, 1)).toBeGreaterThanOrEqual(0.03);
  });

  it("collapses to a decided outcome when no variance remains", () => {
    expect(Engines.categoryWinProb(5, 0)).toBe(1);
    expect(Engines.categoryWinProb(-5, 0)).toBe(0);
    expect(Engines.categoryWinProb(0, 0)).toBe(0.5);
  });
});

describe("legacy engines: matchup strategy", () => {
  it("does not classify every category as Target", () => {
    // The regression this guards: stats.season held season TOTALS and was
    // multiplied by games remaining, inflating both sides by ~52x. Margins
    // became enormous, the margin-percentage formula saturated, and every
    // category came back "Target" on the live app.
    const state = baseState();
    const strong = (id: number, mult: number) => makePlayer({
      id, slotId: 1, gamesRemaining: 3,
      stats: {
        season: { REB: 8 * mult, AST: 5 * mult, STL: 1.2 * mult, BLK: 0.8 * mult, PTS: 22 * mult },
        last7: {}, last30: {}, totals: {}, gp: {},
      },
    });
    const mine = [strong(1, 1.6), strong(2, 1.5)];
    const theirs = [strong(3, 0.5), strong(4, 0.45)];
    state.myTeam.players = mine;
    state.teams = [
      { teamId: 1, players: mine },
      { teamId: 2, players: theirs },
    ];
    state.allPlayers = mine.concat(theirs);
    state.matchup = {
      opponentTeamId: 2,
      myScores: { REB: 40, AST: 25, STL: 6, BLK: 4, PTS: 110 },
      oppScores: { REB: 12, AST: 8, STL: 2, BLK: 1, PTS: 35 },
    };

    const Engines = loadEngines(state);
    const strategy = Engines.computeMatchupStrategy();

    // A roster this dominant should lock categories, not "target" them.
    expect(strategy.locks.length).toBeGreaterThan(0);
    expect(strategy.targets.length).toBeLessThan(CATS.length);
    for (const c of CATS) {
      expect(strategy.winProb[c]).toBeGreaterThan(0);
      expect(strategy.winProb[c]).toBeLessThanOrEqual(0.97);
    }
  });
});

describe("legacy engines: trend", () => {
  let Engines: any;
  beforeEach(() => { Engines = loadEngines(baseState()); });

  it("reads a real improvement as hot and a decline as cold", () => {
    const hot = makePlayer({
      id: 1,
      stats: {
        season: { REB: 5, AST: 4, STL: 1, BLK: 0.5, PTS: 14 },
        last7: { REB: 8, AST: 6, STL: 1.6, BLK: 0.9, PTS: 22 },
        last30: {}, totals: {}, gp: {},
      },
    });
    const cold = makePlayer({
      id: 2,
      stats: {
        season: { REB: 8, AST: 6, STL: 1.6, BLK: 0.9, PTS: 22 },
        last7: { REB: 5, AST: 4, STL: 1, BLK: 0.5, PTS: 14 },
        last30: {}, totals: {}, gp: {},
      },
    });
    expect(Engines.trendLabel(Engines.trendDelta(hot).avgChange)).toBe("hot");
    expect(Engines.trendLabel(Engines.trendDelta(cold).avgChange)).toBe("cold");
  });

  it("reports stable when nothing moved", () => {
    const flat = makePlayer({
      id: 3,
      stats: {
        season: { REB: 5, AST: 4, STL: 1, BLK: 0.5, PTS: 14 },
        last7: { REB: 5, AST: 4, STL: 1, BLK: 0.5, PTS: 14 },
        last30: {}, totals: {}, gp: {},
      },
    });
    const d = Engines.trendDelta(flat);
    expect(d.avgChange).toBeCloseTo(0, 10);
    expect(Engines.trendLabel(d.avgChange)).toBe("stable");
  });

  it("reports no comparable categories rather than a fake 0% change", () => {
    // Risers/Fallers showed +0% / -100% for everyone partly because players
    // with nothing to compare were still scored and ranked.
    const empty = makePlayer({
      id: 4,
      stats: { season: {}, last7: {}, last30: {}, totals: {}, gp: {} },
    });
    expect(Engines.trendDelta(empty).counted).toBe(0);
  });

  it("caps a near-zero baseline so one category cannot dominate", () => {
    const spike = makePlayer({
      id: 5,
      stats: {
        season: { REB: 5, AST: 4, STL: 0.01, BLK: 0.5, PTS: 14 },
        last7: { REB: 5, AST: 4, STL: 3, BLK: 0.5, PTS: 14 },
        last30: {}, totals: {}, gp: {},
      },
    });
    // Uncapped this single category would be +29900%.
    expect(Engines.trendDelta(spike).avgChange).toBeLessThanOrEqual(1);
  });
});

describe("legacy engines: stale roster copies", () => {
  it("resolves a roster stub to the live player in S.allPlayers", () => {
    // S.teams[].players and S.myTeam.players are separate deserialized
    // copies; only S.allPlayers gets ranks and z-scores written to it.
    const state = baseState();
    const live = makePlayer({ id: 7, durantScore: 55 });
    live.zScores = { REB: 1, AST: 1, STL: 1, BLK: 1, PTS: 1, total: 5 } as any;
    const stub = makePlayer({ id: 7 }); // no durantScore, no zScores
    state.allPlayers = [live];
    const Engines = loadEngines(state);
    expect(Engines.enrichPlayer(stub).durantScore).toBe(55);
  });

  it("returns the stub unchanged when the player is unknown", () => {
    const state = baseState();
    const Engines = loadEngines(state);
    const orphan = makePlayer({ id: 999 });
    expect(Engines.enrichPlayer(orphan)).toBe(orphan);
  });
});

describe("legacy engines: recommendations", () => {
  it("suggests distinct pickups and distinct drops", () => {
    // The live app showed five tiles that all said "drop Jonathan Kuminga":
    // the old loop pushed the first five pairs it walked, with drops in the
    // outer loop, so one drop target paired with five pickups.
    const state = baseState();

    const bench = [];
    for (let i = 0; i < 6; i++) {
      const p = makePlayer({
        id: 100 + i, slotId: 12, onTeamId: 1, name: `Bench${i}`,
        durantScore: 5 + i, effectiveDURANT: 5 + i,
      });
      p.zScores = { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0, total: 0 } as any;
      bench.push(p);
    }
    const starters = [];
    for (let i = 0; i < 7; i++) {
      const p = makePlayer({
        id: 200 + i, slotId: 1, onTeamId: 1, name: `Starter${i}`,
        durantScore: 60 + i, effectiveDURANT: 60 + i,
      });
      p.zScores = { REB: 1, AST: 1, STL: 1, BLK: 1, PTS: 1, total: 5 } as any;
      starters.push(p);
    }
    const freeAgents = [];
    for (let i = 0; i < 8; i++) {
      const p = makePlayer({
        id: 300 + i, slotId: 12, onTeamId: 0, name: `FA${i}`,
        durantScore: 40 - i, effectiveDURANT: 40 - i,
        minutesPerGame: 30, percentOwned: 20,
      });
      p.zScores = { REB: 0.8, AST: 0.8, STL: 0.8, BLK: 0.8, PTS: 0.8, total: 4 } as any;
      freeAgents.push(p);
    }

    const roster = starters.concat(bench);
    state.myTeam.players = roster;
    state.allPlayers = roster.concat(freeAgents);
    state.teams = [{ teamId: 1, players: roster }];

    const Engines = loadEngines(state);
    const recs = Engines.generateRecommendations(roster, state.allPlayers)
      .filter((r: any) => r.type === "pickup");

    expect(recs.length).toBeGreaterThan(1);
    const pickupIds = recs.map((r: any) => r.player.id);
    const dropIds = recs.map((r: any) => r.dropPlayer.id);
    expect(new Set(pickupIds).size).toBe(pickupIds.length);
    expect(new Set(dropIds).size).toBe(dropIds.length);
  });

  it("never proposes adding an unavailable player", () => {
    const state = baseState();
    const bench = [];
    for (let i = 0; i < 6; i++) {
      const p = makePlayer({
        id: 100 + i, slotId: 12, onTeamId: 1,
        durantScore: 2, effectiveDURANT: 2,
      });
      p.zScores = { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0, total: 0 } as any;
      bench.push(p);
    }
    const starters = [];
    for (let i = 0; i < 7; i++) {
      const p = makePlayer({ id: 200 + i, slotId: 1, onTeamId: 1, durantScore: 60 });
      p.zScores = { REB: 1, AST: 1, STL: 1, BLK: 1, PTS: 1, total: 5 } as any;
      starters.push(p);
    }
    // Attractive on paper, but on IR.
    const injuredStar = makePlayer({
      id: 999, slotId: 12, onTeamId: 0, name: "Injured Star",
      injuryStatus: "INJURY_RESERVE", durantScore: 95, effectiveDURANT: 95,
    });
    injuredStar.zScores = { REB: 3, AST: 3, STL: 3, BLK: 3, PTS: 3, total: 15 } as any;

    const roster = starters.concat(bench);
    state.myTeam.players = roster;
    state.allPlayers = roster.concat([injuredStar]);
    state.teams = [{ teamId: 1, players: roster }];

    const Engines = loadEngines(state);
    const recs = Engines.generateRecommendations(roster, state.allPlayers);
    expect(recs.every((r: any) => r.player.id !== 999)).toBe(true);
  });
});

describe("legacy engines: ROS projections", () => {
  it("projects over the season, not the current week", () => {
    // rosProjections used to prefer p.gamesRemaining (games left this WEEK)
    // over gamesRemainingROS, so a season projection was built on ~4 games.
    const state = baseState();
    const p = makePlayer({
      id: 1, gamesPlayed: 20, gamesRemaining: 3, gamesRemainingROS: 50,
      stats: {
        season: { REB: 10, AST: 5, STL: 1, BLK: 1, PTS: 20 },
        last30: { REB: 10, AST: 5, STL: 1, BLK: 1, PTS: 20 },
        last7: {}, totals: {}, gp: {},
      },
    });
    state.allPlayers = [p];
    const Engines = loadEngines(state);
    Engines.rosProjections([p]);

    expect((p as any).rosGamesLeft).toBe(50);
    // 20 games banked + 50 to come, at 20 PTS a game.
    expect((p as any).rosProjection.PTS).toBeCloseTo(70 * 20, 6);
  });

  it("carries percentage categories forward as rates", () => {
    const state = baseState();
    state.league.categories = [
      { abbr: "PTS", isPercent: false, isNegative: false },
      { abbr: "FG%", isPercent: true, isNegative: false },
    ];
    const p = makePlayer({
      id: 1, gamesPlayed: 20, gamesRemainingROS: 50,
      stats: {
        season: { PTS: 20, "FG%": 0.52 }, last30: {}, last7: {}, totals: {}, gp: {},
      },
    });
    state.allPlayers = [p];
    const Engines = loadEngines(state);
    Engines.rosProjections([p]);
    expect((p as any).rosProjection["FG%"]).toBeCloseTo(0.52, 6);
  });
});

describe("legacy engines: trade finder", () => {
  it("does not reward asking for the better player", () => {
    // Acceptance was `50 + (theirs - mine) * 2`, so demanding a star made
    // the other manager MORE likely to accept. Sign was inverted.
    const state = baseState();

    const mk = (id: number, teamId: number, z: number, durant: number) => {
      const p = makePlayer({
        id, slotId: 1, onTeamId: teamId, name: `T${teamId}P${id}`,
        durantScore: durant, effectiveDURANT: durant,
        stats: {
          season: { REB: z, AST: z, STL: z, BLK: z, PTS: z * 10 },
          last7: {}, last30: {}, totals: {}, gp: {},
        },
      });
      p.zScores = { REB: z, AST: z, STL: z, BLK: z, PTS: z, total: z * 5 } as any;
      return p;
    };

    // My team is weak; theirs is strong, so I have real needs.
    const mine = [mk(1, 1, 0.1, 20), mk(2, 1, 0.2, 25)];
    const theirs = [mk(3, 2, 2.0, 80), mk(4, 2, 1.8, 75)];
    state.myTeam = { teamId: 1, players: mine };
    state.teams = [{ teamId: 1, players: mine }, { teamId: 2, players: theirs }];
    state.allPlayers = mine.concat(theirs);

    const Engines = loadEngines(state);
    const trades = Engines.findTrades({});

    for (const t of trades) {
      expect(t.acceptanceLikelihood).toBeGreaterThanOrEqual(0);
      expect(t.acceptanceLikelihood).toBeLessThanOrEqual(100);
    }
    // Lopsided asks should not come back as highly likely.
    const lopsided = trades.filter((t: any) => t.netDURANT > 40);
    for (const t of lopsided) {
      expect(t.acceptanceLikelihood).toBeLessThan(50);
    }
  });
});

describe("legacy engines: NaN guards", () => {
  it("keeps frustrationValue finite when a split is missing categories", () => {
    // The guards were `!== null`, which passes for undefined, so a missing
    // category produced NaN and one NaN poisoned the average.
    const state = baseState();
    const p = makePlayer({
      id: 1,
      stats: {
        season: { REB: 5, AST: 4, STL: 1, BLK: 0.5, PTS: 14 },
        last7: { REB: 6 }, // only one category reported
        last30: {}, totals: {}, gp: {},
      },
    });
    state.allPlayers = [p];
    const Engines = loadEngines(state);
    Engines.computeAllZScores([p], "season");
    expect(Number.isFinite((p as any).frustrationValue)).toBe(true);
  });

  it("keeps z-scores finite when a player reports no stats at all", () => {
    const state = baseState();
    const withStats = makePlayer({
      id: 1,
      stats: {
        season: { REB: 5, AST: 4, STL: 1, BLK: 0.5, PTS: 14 },
        last7: {}, last30: {}, totals: {}, gp: {},
      },
    });
    const empty = makePlayer({
      id: 2, stats: { season: {}, last7: {}, last30: {}, totals: {}, gp: {} },
    });
    state.allPlayers = [withStats, empty];
    const Engines = loadEngines(state);
    Engines.computeAllZScores(state.allPlayers, "season");
    for (const p of state.allPlayers) {
      expect(Number.isFinite((p as any).zScores.total)).toBe(true);
    }
  });
});
