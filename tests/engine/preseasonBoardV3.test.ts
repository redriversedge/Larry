// The v3 preseason board, end to end through the REAL js/engines.js and
// the real dist bundle. docs/RANKINGS_V3_ADDENDUM.md section 3.
//
// The engine maths is covered by blend.test.ts and
// backtestPreseasonBoard.test.ts. What this file proves is the wiring:
// that computeDURANT actually produces a blended board, that the rank
// follows the blend, that the v2 rollback works, and that every missing
// input degrades instead of throwing.

import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

interface Harness {
  Engines: any;
  S: any;
  loadData: () => Promise<void>;
}

function makePlayers(count: number): any[] {
  const out: any[] = [];
  for (let i = 0; i < count; i++) {
    const quality = 1 - i / count;
    out.push({
      id: 1000 + i,
      name: "Player " + String.fromCharCode(65 + (i % 26)) + Math.floor(i / 26),
      defaultPositionId: (i % 5) + 1,
      proTeamId: (i % 30) + 1,
      positions: ["SG"],
      injuryStatus: "ACTIVE",
      gamesPlayed: 0,
      gamesRemaining: 0,
      minutesPerGame: 30,
      percentOwned: 100 - i / 10,
      espnAdp: i + 1,
      stats: {
        season: {}, last7: {}, last30: {}, last15: {},
        totals: {}, gp: {},
        projectedGP: 70,
        projectedRate: {
          REB: 2 + 8 * quality,
          AST: 1 + 6 * quality,
          STL: 0.3 + 1.2 * quality,
          BLK: 0.1 + 1.2 * quality,
          PTS: 8 + 20 * quality,
        },
      },
    });
  }
  return out;
}

const CATS = ["REB", "AST", "STL", "BLK", "PTS"];

function load(options: {
  players?: any[];
  durability?: Record<string, number[]> | null;
  market?: unknown;
  rankingVersion?: string;
} = {}): Harness {
  const engineSrc = fs.readFileSync(path.join(ROOT, "dist/larry-engine.js"), "utf8");
  const enginesSrc = fs.readFileSync(path.join(ROOT, "js/engines.js"), "utf8");

  const players = options.players ?? makePlayers(300);
  const state: any = {
    league: {
      teamCount: 12,
      rosterSize: 13,
      seasonId: 2027,
      categories: CATS.map((abbr) => ({ abbr, isNegative: false, isPercent: false })),
    },
    espn: { lastSync: "2026-10-15T00:00:00Z" },
    myTeam: { teamId: 1, players: [] },
    teams: [],
    matchup: {},
    allPlayers: players,
    prefs: options.rankingVersion ? { rankingVersion: options.rankingVersion } : {},
    analysisCache: {},
  };

  const sandbox: any = {};
  sandbox.window = sandbox;

  const durability =
    options.durability === undefined
      ? { "1000": [78, 76, 74], "1001": [20, 30, 25] }
      : options.durability;
  const market =
    options.market === undefined
      ? {
          pulledAt: "2026-10-14T00:00:00Z",
          // Reverse the top of Larry's board, so a blend is visibly
          // different from Larry alone.
          yahooAdp: players.slice(0, 60).reverse().map((p: any, i: number) => [
            p.name.normalize("NFKD").toLowerCase().replace(/[^a-z ]/g, "").trim(),
            i + 1,
          ]),
          ecr: players.slice(0, 60).reverse().map((p: any, i: number) => [
            p.name.normalize("NFKD").toLowerCase().replace(/[^a-z ]/g, "").trim(),
            i + 1,
          ]),
        }
      : options.market;

  const fetchStub = (url: string): Promise<any> => {
    const body =
      String(url).indexOf("durability-history") >= 0
        ? durability === null
          ? null
          : { gp: durability }
        : String(url).indexOf("market-rankings-current") >= 0
          ? market
          : null;
    return Promise.resolve({
      ok: body !== null,
      json: () => Promise.resolve(body),
    });
  };

  const names = [
    "window", "S", "getOrderedCategories", "fmt", "console", "document",
    "ESPNSync", "durantKey", "durantText", "isPreseason", "fetch", "render",
    "setTimeout", "clearTimeout",
  ];
  const fn = new Function(
    ...names,
    engineSrc +
      "\n; window.LarryEngine = LarryEngine;\n" +
      enginesSrc +
      "\n; window.Engines = Engines; return window.Engines;",
  );

  const Engines = fn(
    sandbox,
    state,
    () => state.league.categories.slice(),
    (n: number, d: number) => Number(n || 0).toFixed(d),
    console,
    { querySelectorAll: () => [], getElementById: () => null },
    { splitGP: () => 0, loadProjectionData: () => Promise.resolve() },
    (v: unknown) => (v === null || v === undefined ? -Infinity : (v as number)),
    (v: unknown, d = 1) => (v === null || v === undefined ? "--" : Number(v).toFixed(d)),
    () => true, // preseason
    fetchStub,
    () => {},
    (cb: () => void) => { cb(); return 0; },
    () => {},
  );

  return {
    Engines,
    S: state,
    loadData: () => Engines.loadPreseasonData(),
  };
}

async function board(h: Harness): Promise<any[]> {
  await h.loadData();
  h.S.analysisCache = {};
  h.Engines.computeDURANT(h.S.allPlayers);
  return h.S.allPlayers;
}

describe("v3 preseason board: wiring", () => {
  it("produces expected games, season value and all three ranks", async () => {
    const h = load();
    const players = await board(h);

    const ranked = players.filter((p) => p.blendRank);
    expect(ranked.length).toBeGreaterThan(200);

    for (const p of ranked.slice(0, 20)) {
      expect(Number.isFinite(p.expectedGP)).toBe(true);
      expect(p.expectedGP).toBeGreaterThan(0);
      expect(Number.isFinite(p.seasonValue)).toBe(true);
      expect(p.fiveCatRank).toBeGreaterThan(0);
      expect(p.blendRank).toBeGreaterThan(0);
      expect(p.rateValue).not.toBeNull();
    }
    // Every rank is used exactly once.
    const blendRanks = ranked.map((p) => p.blendRank).sort((a, b) => a - b);
    expect(new Set(blendRanks).size).toBe(blendRanks.length);
  });

  it("orders the board by the blend, not by the score", async () => {
    const h = load();
    const players = await board(h);
    // players[] is sorted, and durantRank follows that order.
    players.slice(0, 50).forEach((p, i) => {
      expect(p.durantRank).toBe(i + 1);
    });
    // The blend is monotonic down the sorted list.
    const blend = players.filter((p) => p.blendRank).slice(0, 50).map((p) => p.blendRank);
    for (let i = 1; i < blend.length; i++) {
      expect(blend[i]).toBeGreaterThan(blend[i - 1] as number);
    }
  });

  it("differs from Larry's own board, because the market is in it", async () => {
    const h = load();
    const players = await board(h);
    const disagreements = players.filter(
      (p) => p.blendRank && p.fiveCatRank && p.blendRank !== p.fiveCatRank,
    );
    expect(disagreements.length).toBeGreaterThan(20);
    // And the Mkt column has something in it for the players the market
    // actually lists.
    expect(players.filter((p) => p.marketRank !== null && p.marketRank !== undefined).length)
      .toBeGreaterThan(30);
  });

  it("uses the attendance record, so a fragile player loses games", async () => {
    const h = load();
    const players = await board(h);
    // 1000 has three durable seasons, 1001 three broken ones. Both are
    // projected for 70 by ESPN.
    const durable = players.find((p) => p.id === 1000);
    const fragile = players.find((p) => p.id === 1001);
    expect(durable.expectedGP).toBeGreaterThan(fragile.expectedGP + 10);
    expect(fragile.expectedGP).toBeLessThan(70);
  });

  it("gives a player with no NBA team zero expected games", async () => {
    const players = makePlayers(60);
    players[5].proTeamId = 0;
    const h = load({ players });
    const out = await board(h);
    expect(out.find((p) => p.id === 1005).expectedGP).toBe(0);
  });
});

describe("v3 preseason board: degradation", () => {
  it("falls back to Larry's board alone when there is no market data", async () => {
    const h = load({ market: null });
    const players = await board(h);
    const ranked = players.filter((p) => p.blendRank);
    expect(ranked.length).toBeGreaterThan(200);
    // With no market lists the blend IS the 5-cat board. The app still has
    // live ESPN ADP on the players, so this asserts the file being absent
    // does not break anything rather than that nothing changed.
    for (const p of ranked.slice(0, 10)) {
      expect(p.blendRank).toBeGreaterThan(0);
      expect(Number.isFinite(p.seasonValue)).toBe(true);
    }
  });

  it("falls back to ESPN's games when there is no durability history", async () => {
    const h = load({ durability: null });
    const players = await board(h);
    const p = players.find((x) => x.id === 1000);
    // No history, so the model has nothing to correct with and ESPN's 70
    // stands.
    expect(p.expectedGP).toBe(70);
  });

  it("survives both files being unavailable", async () => {
    const h = load({ durability: null, market: null });
    const players = await board(h);
    expect(players.filter((x) => x.blendRank).length).toBeGreaterThan(200);
  });
});

describe("v3 preseason board: the v2 rollback", () => {
  it("leaves the old board completely alone", async () => {
    const h = load({ rankingVersion: "v2" });
    const players = await board(h);

    // None of the v3 fields are set.
    for (const p of players.slice(0, 20)) {
      expect(p.blendRank).toBeUndefined();
      expect(p.seasonValue).toBeUndefined();
      expect(p.expectedGP).toBeUndefined();
      expect(p.durantScore).not.toBeNull();
    }
    // And the board is ordered by score, as it was.
    const scores = players
      .filter((p) => p.durantScore !== null && p.durantScore !== undefined)
      .slice(0, 40)
      .map((p) => p.durantScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1] as number);
    }
  });

  it("reports which version is active", async () => {
    expect(load().Engines.rankingVersion()).toBe("v3");
    expect(load({ rankingVersion: "v2" }).Engines.rankingVersion()).toBe("v2");
    // Anything unrecognised means v3, the measured default.
    expect(load({ rankingVersion: "nonsense" }).Engines.rankingVersion()).toBe("v3");
  });
});
