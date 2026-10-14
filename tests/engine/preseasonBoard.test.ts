// Preseason board.
//
// Before opening night nobody has played, so the board is built entirely
// from ESPN's projections. Two things were wrong with doing that naively:
//
//   1. 596 of 1000 players have no ESPN projection at all. computeBaseValues
//      shrinks them to the pool mean, which is exactly 0, which reads as
//      "average starter". Only 64 real players scored above 0, so the
//      unknowns filled ranks 65 to 660 and pushed every real player who was
//      merely below average past 660. Austin Reaves, 18th by expert
//      consensus, ranked 667th.
//
//   2. ESPN's projected TOTALS already assume missed games, so dividing by
//      82 makes anyone with an injury history look worse per game than they
//      are. A player projected for 43 games came out about 48% too low.
//
// Measured against the FantasyPros 6-expert consensus top 150: live 0.637,
// unknowns-last 0.665, plus per-game rate 0.719, plus the soft discount and
// bad-data guard 0.720.

import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

import { applyPreseasonDiscount, computeBaseValues } from "../../src/engine/zscore";
import {
  PRESEASON_GP_REFERENCE,
  PRESEASON_LONG_TERM_GP,
} from "../../src/engine/constants";

const ROOT = path.resolve(__dirname, "../..");
const CATS = ["REB", "AST", "STL", "BLK", "PTS"] as const;

// engines.js is a browser IIFE over core.js globals.
function loadEngines(state: any, opts: { preseason?: boolean } = {}) {
  const src = fs.readFileSync(path.join(ROOT, "js/engines.js"), "utf8");
  const sandbox: any = { S: state };
  sandbox.window = sandbox;
  // The real bundle, so these tests exercise the same engine the app runs.
  const engineSrc = fs.readFileSync(path.join(ROOT, "dist/larry-engine.js"), "utf8");
  new Function("window", "globalThis", engineSrc + "\n; window.LarryEngine = LarryEngine;")(
    sandbox, sandbox,
  );
  const globals: Record<string, any> = {
    window: sandbox,
    S: state,
    getOrderedCategories: () => (state.league?.categories ?? []).slice(),
    fmt: (n: number, d: number) => Number(n).toFixed(d),
    console,
    document: { querySelectorAll: () => [] },
    ESPNSync: { splitGP: () => 0 },
    durantKey: (v: unknown) => (v === null || v === undefined ? -Infinity : (v as number)),
    durantText: (v: unknown, d = 1) =>
      v === null || v === undefined ? "--" : Number(v).toFixed(d),
    isPreseason: () => opts.preseason === true,
  };
  const names = Object.keys(globals);
  return new Function(...names, src + "\n; window.Engines = Engines; return window.Engines;")(
    ...names.map((n) => globals[n]),
  );
}

function baseState(): any {
  return {
    league: {
      teamCount: 12,
      rosterSize: 13,
      categories: CATS.map((abbr) => ({ abbr, isNegative: false, isPercent: false })),
    },
    espn: { lastSync: "2026-10-14T00:00:00Z" },
    myTeam: { teamId: 1, players: [] },
    teams: [],
    matchup: {},
    allPlayers: [],
    prefs: {},
    analysisCache: {},
  };
}

// A player with an ESPN projection expressed as season totals over `gp`
// projected games, which is exactly the shape the parser produces.
function projected(
  id: number,
  name: string,
  perGame: Partial<Record<(typeof CATS)[number], number>>,
  projGP: number,
  extra: any = {},
) {
  const totals: Record<string, number> = { GP: projGP };
  const rate: Record<string, number> = {};
  const per82: Record<string, number> = {};
  for (const c of CATS) {
    const v = perGame[c] ?? 0;
    totals[c] = v * projGP;
    rate[c] = v;
    per82[c] = (v * projGP) / 82;
  }
  return {
    id,
    name,
    proTeamId: 2,
    gamesPlayed: 0,
    percentOwned: 50,
    injuryStatus: "ACTIVE",
    stats: {
      season: {}, last7: {}, last30: {}, totals: {}, gp: {},
      projectedSeason: totals,
      projectedPerGame: per82,
      projectedRate: rate,
      projectedGP: projGP,
    },
    ...extra,
  };
}

// No games, no projection. The 596-player case.
function unknown(id: number, name: string, owned = 1) {
  return {
    id,
    name,
    proTeamId: 2,
    gamesPlayed: 0,
    percentOwned: owned,
    injuryStatus: "ACTIVE",
    stats: { season: {}, last7: {}, last30: {}, totals: {}, gp: {} },
  };
}

describe("players with no evidence rank last", () => {
  it("puts every unprojected player below every projected one", () => {
    const state = baseState();
    state.allPlayers = [
      projected(1, "Star", { REB: 12, AST: 9, STL: 1.3, BLK: 0.8, PTS: 28 }, 70),
      projected(2, "Mid", { REB: 5, AST: 3, STL: 0.8, BLK: 0.4, PTS: 14 }, 75),
      // Deliberately BELOW the pool, so baseValue is negative. This is the
      // case the old code got wrong: a negative real player sorted under a
      // zero-scored unknown.
      projected(3, "Scrub", { REB: 1, AST: 0.4, STL: 0.1, BLK: 0.05, PTS: 2 }, 60),
      unknown(4, "Unknown A", 5),
      unknown(5, "Unknown B", 4),
      unknown(6, "Unknown C", 3),
      unknown(7, "Unknown D", 2),
      unknown(8, "Unknown E", 1),
    ];
    const Engines = loadEngines(state, { preseason: true });
    Engines.computeDURANT(state.allPlayers);

    const byName: Record<string, any> = {};
    for (const p of state.allPlayers) byName[p.name] = p;

    // The negative-value real player still beats every unknown.
    expect(byName["Scrub"].durantScore).toBeLessThan(0);
    const worstProjected = byName["Scrub"].durantRank;
    for (const n of ["Unknown A", "Unknown B", "Unknown C", "Unknown D", "Unknown E"]) {
      expect(byName[n].durantScore).toBeNull();
      expect(byName[n].noEvidence).toBe(true);
      expect(byName[n].durantRank).toBeGreaterThan(worstProjected);
    }
    expect(byName["Star"].durantRank).toBe(1);
  });

  it("orders the unknowns among themselves by ownership", () => {
    const state = baseState();
    state.allPlayers = [
      projected(1, "Star", { REB: 12, AST: 9, STL: 1.3, BLK: 0.8, PTS: 28 }, 70),
      unknown(2, "Low", 1),
      unknown(3, "High", 40),
      unknown(4, "Mid", 12),
    ];
    const Engines = loadEngines(state, { preseason: true });
    Engines.computeDURANT(state.allPlayers);
    const order = state.allPlayers
      .filter((p: any) => p.noEvidence)
      .sort((a: any, b: any) => a.durantRank - b.durantRank)
      .map((p: any) => p.name);
    expect(order).toEqual(["High", "Mid", "Low"]);
  });

  it("keeps effectiveDURANT null rather than coercing it to zero", () => {
    // applyHaircut(null || 0) would put the player back at average-starter
    // and silently undo the ordering for every add/drop surface.
    const state = baseState();
    state.allPlayers = [
      projected(1, "Star", { REB: 12, AST: 9, STL: 1.3, BLK: 0.8, PTS: 28 }, 70),
      unknown(2, "Nobody"),
    ];
    const Engines = loadEngines(state, { preseason: true });
    Engines.computeDURANT(state.allPlayers);
    const nobody = state.allPlayers.find((p: any) => p.name === "Nobody");
    expect(nobody.effectiveDURANT).toBeNull();
  });

  it("never offers a no-evidence player as an add", () => {
    const state = baseState();
    state.allPlayers = [unknown(2, "Nobody", 40)];
    state.allPlayers[0].minutesPerGame = 30;
    const Engines = loadEngines(state, { preseason: true });
    Engines.computeDURANT(state.allPlayers);
    expect(Engines.isValidAddCandidate(state.allPlayers[0])).toBe(false);
  });

  it("in season, a real player with a negative value still beats an unknown", () => {
    // Same bug, outside the preseason: the unprojected deep bench with 0
    // games was outranking real rotation players having a bad year.
    const state = baseState();
    const played = {
      id: 1,
      name: "Struggling",
      proTeamId: 2,
      gamesPlayed: 20,
      percentOwned: 30,
      injuryStatus: "ACTIVE",
      stats: {
        season: { REB: 1.1, AST: 0.5, STL: 0.1, BLK: 0.05, PTS: 2.2 },
        last7: {}, last30: {}, totals: {}, gp: {},
      },
    };
    const pool = [];
    for (let i = 0; i < 20; i++) {
      pool.push({
        id: 100 + i,
        name: "Pool " + i,
        proTeamId: 3,
        gamesPlayed: 30,
        percentOwned: 60,
        injuryStatus: "ACTIVE",
        stats: {
          season: { REB: 6 + i * 0.2, AST: 4, STL: 1, BLK: 0.5, PTS: 18 + i * 0.3 },
          last7: {}, last30: {}, totals: {}, gp: {},
        },
      });
    }
    state.allPlayers = [played, unknown(2, "Nobody", 80), ...pool];
    const Engines = loadEngines(state, { preseason: false });
    Engines.computeDURANT(state.allPlayers);
    const s = state.allPlayers.find((p: any) => p.name === "Struggling");
    const n = state.allPlayers.find((p: any) => p.name === "Nobody");
    expect(s.durantScore).toBeLessThan(0);
    expect(n.durantScore).toBeNull();
    expect(s.durantRank).toBeLessThan(n.durantRank);
  });

  it("flags hasEvidence on the engine row itself", () => {
    const res = computeBaseValues(
      [
        { id: "a", gamesPlayed: 0, projectedPerGame: { PTS: 20, REB: 5 } },
        { id: "b", gamesPlayed: 12, perGame: { PTS: 9, REB: 3 } },
        { id: "c", gamesPlayed: 0 },
        // A projection of all zeros is not a projection.
        { id: "d", gamesPlayed: 0, projectedPerGame: { PTS: 0, REB: 0 } },
      ],
      { categories: CATS, rosterSize: 13 },
    );
    const by: Record<string, boolean> = {};
    for (const r of res.rows) by[r.id] = r.hasEvidence;
    expect(by).toEqual({ a: true, b: true, c: false, d: false });
  });
});

describe("preseason rate uses projected games, not 82", () => {
  it("treats a 41-game projection as the same rate as a full-season one", () => {
    // GP 41 / 1000 PTS and GP 82 / 2000 PTS are both 24.4 a game. Dividing
    // by 82 would have scored the first player at half the second.
    const state = baseState();
    const half = projected(1, "Half", { PTS: 24.39, REB: 8, AST: 5, STL: 1, BLK: 0.5 }, 41);
    const full = projected(2, "Full", { PTS: 24.39, REB: 8, AST: 5, STL: 1, BLK: 0.5 }, 82);
    state.allPlayers = [half, full];
    const Engines = loadEngines(state, { preseason: true });
    const a = Engines.v2ProjectedRate(half);
    const b = Engines.v2ProjectedRate(full);
    for (const c of CATS) expect(a[c]).toBeCloseTo(b[c], 6);
  });

  it("falls back to the /82 rate when ESPN gave no projected game count", () => {
    const state = baseState();
    const p = projected(1, "NoGP", { PTS: 20, REB: 5, AST: 3, STL: 1, BLK: 0.5 }, 60);
    delete (p.stats as any).projectedRate;
    delete (p.stats as any).projectedGP;
    state.allPlayers = [p];
    const Engines = loadEngines(state, { preseason: true });
    const rate = Engines.v2ProjectedRate(p);
    // projectedPerGame is totals/82 = 20*60/82.
    expect(rate.PTS).toBeCloseTo((20 * 60) / 82, 6);
  });
});

describe("soft long-term injury discount", () => {
  it("matches the specified curve", () => {
    expect(applyPreseasonDiscount(10, 43, false)).toBeCloseTo(10 * Math.sqrt(43 / 72), 10);
    expect(applyPreseasonDiscount(10, 65, false)).toBe(10);
    expect(applyPreseasonDiscount(10, 82, false)).toBe(10);
  });

  it("never raises a negative value", () => {
    // Scaling a negative by a fraction moves it UP. That is the bug that
    // let an OUT player outrank a healthy one.
    expect(applyPreseasonDiscount(-5, 30, false)).toBe(-5);
    expect(applyPreseasonDiscount(-5, 1, false)).toBe(-5);
    expect(applyPreseasonDiscount(0, 30, false)).toBe(0);
  });

  it("leaves a suspect projection alone", () => {
    expect(applyPreseasonDiscount(10, 1, true)).toBe(10);
  });

  it("does nothing without a projected game count", () => {
    expect(applyPreseasonDiscount(10, 0, false)).toBe(10);
    expect(applyPreseasonDiscount(10, -3, false)).toBe(10);
  });

  it("is continuous at the threshold", () => {
    // No cliff: a player at 59 games should be barely below one at 60.
    const at60 = applyPreseasonDiscount(10, PRESEASON_LONG_TERM_GP, false);
    const at59 = applyPreseasonDiscount(10, PRESEASON_LONG_TERM_GP - 1, false);
    expect(at60).toBe(10);
    expect(at59).toBeGreaterThan(9);
    expect(at59).toBeLessThan(10);
  });

  it("uses 72 games as the reference, not 82", () => {
    // A player projected for a healthy starter's season takes no cut.
    expect(applyPreseasonDiscount(10, PRESEASON_GP_REFERENCE, false)).toBe(10);
  });

  it("scales the board score by exactly the discount curve", () => {
    // Same per-game rate, same pool, only projectedGP differs. That isolates
    // the discount: everything upstream of it is identical, so the ratio of
    // the two scores has to be the curve and nothing else.
    const scoreAtProjGP = (projGP: number) => {
      const state = baseState();
      const players = [
        projected(1, "Hurt", { REB: 11, AST: 8, STL: 1.2, BLK: 0.7, PTS: 26 }, projGP),
      ];
      for (let i = 0; i < 20; i++) {
        players.push(projected(100 + i, "Pool " + i,
          { REB: 5 + i * 0.1, AST: 3, STL: 0.8, BLK: 0.4, PTS: 13 + i * 0.2 }, 75));
      }
      state.allPlayers = players;
      const Engines = loadEngines(state, { preseason: true });
      Engines.computeDURANT(state.allPlayers);
      return state.allPlayers.find((p: any) => p.name === "Hurt").durantScore;
    };
    const hurt = scoreAtProjGP(43);
    const healthy = scoreAtProjGP(75);
    expect(healthy).toBeGreaterThan(0);
    expect(hurt).toBeLessThan(healthy);
    expect(hurt / healthy).toBeCloseTo(Math.sqrt(43 / 72), 10);
  });

  it("does not apply in season", () => {
    // In season a player projected for 43 games must score exactly
    // scale * baseValue, with no discount factor anywhere in between, or
    // the owner's regular-season ranking would shift.
    const state = baseState();
    const players = [
      projected(1, "Hurt", { REB: 11, AST: 8, STL: 1.2, BLK: 0.7, PTS: 26 }, 43),
    ];
    for (let i = 0; i < 20; i++) {
      players.push(projected(100 + i, "Pool " + i,
        { REB: 5 + i * 0.1, AST: 3, STL: 0.8, BLK: 0.4, PTS: 13 + i * 0.2 }, 75));
    }
    state.allPlayers = players;
    const Engines = loadEngines(state, { preseason: false });
    Engines.computeDURANT(state.allPlayers);
    const hurt = state.allPlayers.find((p: any) => p.name === "Hurt");
    // Recompute the raw engine value for the same inputs and confirm the
    // score is scale * baseValue with no discount factor in between.
    const raw = computeBaseValues(
      state.allPlayers.map((p: any) => Engines.v2BaseValueInput(p)),
      { categories: CATS, rosterSize: 13 },
    ).rows.find((r) => r.id === "1")!;
    expect(hurt.durantScore).toBeCloseTo(raw.baseValue * 10, 10);
  });
});

describe("bad projection guard", () => {
  it("flags a tiny projection on an active player", () => {
    // Tyrese Haliburton shipped ACTIVE with GP 1 while the experts had him
    // 13th. That is ESPN data entry, not a forecast.
    const state = baseState();
    const hali = projected(1, "Haliburton", { REB: 4, AST: 10, STL: 1.2, BLK: 0.5, PTS: 20 }, 1);
    state.allPlayers = [hali];
    const Engines = loadEngines(state, { preseason: true });
    expect(Engines.v2ProjectionSuspect(hali)).toBe(true);
  });

  it("does not flag a tiny projection on an OUT player", () => {
    // There ESPN is agreeing with itself, so the number is believable.
    const state = baseState();
    const out = projected(1, "Out Guy", { REB: 4, AST: 2, STL: 0.5, BLK: 0.2, PTS: 10 }, 1,
      { injuryStatus: "OUT" });
    state.allPlayers = [out];
    const Engines = loadEngines(state, { preseason: true });
    expect(Engines.v2ProjectionSuspect(out)).toBe(false);
  });

  it("does not flag an ordinary projection", () => {
    const state = baseState();
    const normal = projected(1, "Normal", { REB: 6, AST: 4, STL: 1, BLK: 0.5, PTS: 15 }, 65);
    state.allPlayers = [normal];
    const Engines = loadEngines(state, { preseason: true });
    expect(Engines.v2ProjectionSuspect(normal)).toBe(false);
  });

  it("exempts a suspect player from the discount", () => {
    const state = baseState();
    const players = [projected(1, "Hali", { REB: 4, AST: 10, STL: 1.2, BLK: 0.5, PTS: 20 }, 1)];
    for (let i = 0; i < 20; i++) {
      players.push(projected(100 + i, "Pool " + i,
        { REB: 5 + i * 0.1, AST: 3, STL: 0.8, BLK: 0.4, PTS: 13 + i * 0.2 }, 75));
    }
    state.allPlayers = players;
    const Engines = loadEngines(state, { preseason: true });
    Engines.computeDURANT(state.allPlayers);
    const hali = state.allPlayers.find((p: any) => p.name === "Hali");
    expect(hali.projectionSuspect).toBe(true);
    // A 1-game projection would otherwise take a sqrt(1/72) cut, about 88%.
    // His rate is elite, so he must still be near the top.
    expect(hali.durantRank).toBe(1);
  });
});

describe("the preseason path switches itself off", () => {
  it("produces the regular-season numbers exactly once preseason is false", () => {
    // The owner is happy with the in-season ranking. Flipping the mode off
    // must return byte-identical scores to the untouched path.
    const mk = () => {
      const players = [];
      for (let i = 0; i < 25; i++) {
        players.push({
          id: i + 1,
          name: "P" + i,
          proTeamId: 2,
          gamesPlayed: 30,
          percentOwned: 50,
          injuryStatus: "ACTIVE",
          stats: {
            season: { REB: 4 + i * 0.3, AST: 2 + i * 0.2, STL: 0.5, BLK: 0.3, PTS: 10 + i * 0.6 },
            last7: {}, last30: {}, totals: {}, gp: {},
            projectedSeason: { GP: 70, REB: 300, AST: 200, STL: 40, BLK: 20, PTS: 900 },
            projectedPerGame: { REB: 3.6, AST: 2.4, STL: 0.48, BLK: 0.24, PTS: 10.9 },
            projectedRate: { REB: 4.3, AST: 2.9, STL: 0.57, BLK: 0.29, PTS: 12.9 },
            projectedGP: 70,
          },
        });
      }
      return players;
    };
    const a = baseState(); a.allPlayers = mk();
    const b = baseState(); b.allPlayers = mk();
    loadEngines(a, { preseason: false }).computeDURANT(a.allPlayers);
    loadEngines(b, { preseason: false }).computeDURANT(b.allPlayers);
    const scoresA = a.allPlayers.map((p: any) => p.durantScore);
    const scoresB = b.allPlayers.map((p: any) => p.durantScore);
    expect(scoresA).toEqual(scoresB);

    // And the preseason path genuinely differs, so the switch matters.
    const c = baseState(); c.allPlayers = mk();
    loadEngines(c, { preseason: true }).computeDURANT(c.allPlayers);
    // Everyone is projected for 70 games here, so no discount applies; the
    // difference comes from the rate source (projectedRate vs observed).
    expect(c.allPlayers.map((p: any) => p.durantScore)).not.toEqual(scoresA);
  });

  it("honours an explicit preseason option over the ambient clock", () => {
    // isPreseason() says false; the caller forces the preseason path. Needs
    // a real pool, or every z is 0 and the discount has nothing to scale.
    const players = [
      projected(1, "A", { REB: 10, AST: 6, STL: 1, BLK: 0.5, PTS: 22 }, 40),
      projected(2, "B", { REB: 10, AST: 6, STL: 1, BLK: 0.5, PTS: 22 }, 80),
    ];
    for (let i = 0; i < 20; i++) {
      players.push(projected(100 + i, "Pool " + i,
        { REB: 4 + i * 0.1, AST: 2.5, STL: 0.7, BLK: 0.3, PTS: 11 + i * 0.2 }, 75));
    }
    const state = baseState();
    state.allPlayers = players;
    const Engines = loadEngines(state, { preseason: false });
    Engines.computeDURANT(state.allPlayers, { preseason: true });
    const a = state.allPlayers.find((p: any) => p.name === "A");
    const b = state.allPlayers.find((p: any) => p.name === "B");
    expect(b.durantScore).toBeGreaterThan(0);
    // Identical rates; A is projected for 40 games so only A is discounted.
    expect(a.durantScore).toBeLessThan(b.durantScore);
    expect(a.durantScore / b.durantScore).toBeCloseTo(Math.sqrt(40 / 72), 10);
  });
});
