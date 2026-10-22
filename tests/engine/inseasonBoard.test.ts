// The in-season board, end to end through js/engines.js with the real
// TypeScript engine wired in as window.LarryEngine.
//
// docs/RANKINGS_V3_1_INSEASON_SPEC.md. Two things are pinned here:
//
//   change A   an unprojected player is shrunk toward the replacement-level
//              line, so one game of nothing does not buy a top-150 rank
//   change B   NOT SHIPPED. The in-season shrink prior stays ESPN's
//              projected totals over 82. Dividing by ESPN's projected GAMES
//              instead was measured and lost: see the gates table in
//              docs/RANKINGS_V3_INSEASON_BACKTEST.md.
//
// The legacyEngines suite loads engines.js without an engine attached, which
// exercises the fallback path. This file attaches the real one, so the
// options engines.js passes to computeBaseValues are covered too.

import * as fs from "fs";
import * as path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import * as LarryEngine from "../../src/engine/index";

const ROOT = path.resolve(__dirname, "../..");
const CATS = ["REB", "AST", "STL", "BLK", "PTS"] as const;
const FULL_SEASON = 82;

type Line = Record<string, number>;

function loadEngines(state: any) {
  const src = fs.readFileSync(path.join(ROOT, "js/engines.js"), "utf8");
  const sandbox: any = { S: state };
  sandbox.window = sandbox;
  sandbox.LarryEngine = LarryEngine;
  const getOrderedCategories = () => (state.league?.categories ?? []).slice();
  const fmt = (n: number, d: number) => Number(n).toFixed(d);
  const ESPNSync = { splitGP: () => 0 };
  const durantKey = (v: unknown) =>
    (v === null || v === undefined ? -Infinity : (v as number));
  const durantText = (v: unknown, d = 1) =>
    (v === null || v === undefined ? "--" : Number(v).toFixed(d));
  const isPreseason = () => state.__preseason === true;
  const localDateStr = () => "2026-12-01";
  const fn = new Function(
    "window", "S", "getOrderedCategories", "fmt", "console", "document", "ESPNSync",
    "durantKey", "durantText", "isPreseason", "localDateStr",
    src + "\n; window.Engines = Engines; return window.Engines;",
  );
  return fn(sandbox, state, getOrderedCategories, fmt, console,
    { querySelectorAll: () => [] }, ESPNSync, durantKey, durantText, isPreseason,
    localDateStr);
}

function baseState(): any {
  return {
    league: {
      teamCount: 12,
      rosterSize: 13,
      // Week 3 of the season, so a 10-game sample is a full attendance
      // record and a 5-game one is half of it.
      currentScoringPeriodId: 21,
      categories: CATS.map((abbr) => ({ abbr, isNegative: false, isPercent: false })),
    },
    espn: { lastSync: "2026-11-10T00:00:00Z" },
    myTeam: { teamId: 1, players: [] },
    teams: [],
    matchup: {},
    allPlayers: [],
    prefs: {},
    analysisCache: {},
  };
}

// A legacy player object of the shape parsePlayer produces: stats.season is
// already per-game, projections are totals plus their two companions.
function makePlayer(args: {
  id: number;
  gamesPlayed: number;
  perGame?: Line;
  projectedTotals?: Line;
  projectedGP?: number;
}): any {
  const season: Line = {};
  for (const c of CATS) season[c] = args.perGame?.[c] ?? 0;
  const stats: any = {
    season, last7: { ...season }, last15: { ...season }, last30: { ...season },
    totals: {}, gp: {},
  };
  if (args.projectedTotals) {
    const perGame82: Line = {};
    const rate: Line = {};
    const gp = args.projectedGP ?? 0;
    for (const c of CATS) {
      perGame82[c] = (args.projectedTotals[c] ?? 0) / FULL_SEASON;
      rate[c] = gp >= 1 ? (args.projectedTotals[c] ?? 0) / gp : 0;
    }
    stats.projectedSeason = { ...args.projectedTotals, GP: gp };
    stats.projectedPerGame = perGame82;
    stats.projectedGP = gp;
    stats.projectedRate = gp >= 1 ? rate : null;
  }
  return {
    id: args.id, name: "P" + args.id, slotId: 12, onTeamId: 0, proTeamId: 24,
    injuryStatus: "ACTIVE", gamesPlayed: args.gamesPlayed, gamesRemaining: 3,
    minutesPerGame: 30, percentOwned: 50, positions: ["C"], nbaTeam: "SAS",
    stats,
  };
}

// A projected league with a real top, middle and waiver wire. Everyone is
// projected at the rate they are producing, so the board and the prior
// ranking agree and the replacement band is known by construction.
function projectedLeague(count = 300, gamesPlayed = 20): any[] {
  const out: any[] = [];
  for (let i = 0; i < count; i++) {
    const t = 1 - i / count;
    const perGame: Line = {
      REB: 1 + t * 10, AST: 0.5 + t * 8, STL: 0.2 + t * 1.6,
      BLK: 0.1 + t * 1.8, PTS: 3 + t * 27,
    };
    const projectedTotals: Line = {};
    for (const c of CATS) projectedTotals[c] = (perGame[c] as number) * FULL_SEASON;
    out.push(makePlayer({
      id: i, gamesPlayed, perGame, projectedTotals, projectedGP: FULL_SEASON,
    }));
  }
  return out;
}

describe("in-season shrink prior (change B did NOT ship)", () => {
  let Engines: any;
  let state: any;
  beforeEach(() => { state = baseState(); Engines = loadEngines(state); });

  it("returns ESPN's projected totals over 82, not over the projected games", () => {
    // Change B proposed dividing by projectedGP here, so availability would
    // be counted once rather than twice. It was measured over seven
    // checkpoints in two seasons and lost: average rest-of-season rho
    // 0.453 against 0.455, one checkpoint down 0.012, and per-game rho down
    // 0.017, all outside the spec's own gates. ESPN's projected game count
    // carries 11 to 12 games of median error, and dividing by it pushes
    // that error into all five category rates.
    //
    // So this stays /82. Anything that changes it has to beat
    // tools/backtest-inseason-ranking.ts first.
    const p = makePlayer({
      id: 1, gamesPlayed: 0,
      projectedTotals: { REB: 376, AST: 141, STL: 47, BLK: 94, PTS: 1081 },
      projectedGP: 47,
    });
    const prior = Engines.v2ShrinkPrior(p);
    expect(prior.PTS).toBeCloseTo(1081 / FULL_SEASON, 10);
    expect(prior.REB).toBeCloseTo(376 / FULL_SEASON, 10);
    // And is deliberately NOT the rate-when-playing, which the preseason
    // board reads instead.
    expect(prior.PTS).not.toBeCloseTo(1081 / 47, 3);
    expect(Engines.v2ProjectedRate(p).PTS).toBeCloseTo(1081 / 47, 10);
  });

  it("falls back to the /82 rate when ESPN gives no projection at all", () => {
    expect(Engines.v2ShrinkPrior(makePlayer({ id: 2, gamesPlayed: 10 }))).toBeNull();
  });
});

describe("in-season board: change A through computeDURANT", () => {
  let Engines: any;
  let state: any;
  beforeEach(() => { state = baseState(); Engines = loadEngines(state); });

  it("keeps an unprojected player with one game off the roster", () => {
    const league = projectedLeague();
    // The pool mean is roughly the middle of this league, which is what the
    // old rule shrank an unprojected player toward. One game of it is the
    // Kobe Sanders case: 19 minutes, nothing in particular.
    const mid = league[150];
    const oneGame = makePlayer({
      id: 9001, gamesPlayed: 1, perGame: { ...mid.stats.season },
    });
    const players = [...league, oneGame];
    Engines.computeDURANT(players, { preseason: false });

    const rostered = state.league.teamCount * state.league.rosterSize;
    const rank = players.findIndex((p: any) => p.id === 9001) + 1;
    expect(rank).toBeGreaterThan(rostered);
    // He has evidence (one real game), so he keeps a number rather than a
    // null. The no-evidence rule is a different case and is untouched.
    expect(oneGame.noEvidence).toBe(false);
    expect(oneGame.durantScore).not.toBeNull();
  });

  it("still gives a player with no games and no projection a null score", () => {
    const players = [...projectedLeague(), makePlayer({ id: 9002, gamesPlayed: 0 })];
    Engines.computeDURANT(players, { preseason: false });
    const unknown = players.find((p: any) => p.id === 9002) as any;
    expect(unknown.noEvidence).toBe(true);
    expect(unknown.durantScore).toBeNull();
    // And sorts below every player with a number.
    expect(players[players.length - 1].id).toBe(9002);
  });

  it("leaves a projected player's score untouched by the change", () => {
    // Anthony Edwards scored 45 on opening night and moved to #7;
    // Wembanyama scored 12 and stayed #3. Change A does not reach either.
    const league = projectedLeague();
    Engines.computeDURANT(league, { preseason: false });
    const before = league.map((p: any) => [p.id, p.durantScore]);

    const withNoise = [
      ...projectedLeague(),
      makePlayer({ id: 9003, gamesPlayed: 1, perGame: { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 } }),
    ];
    Engines.computeDURANT(withNoise, { preseason: false });
    const after = new Map(withNoise.map((p: any) => [p.id, p.durantScore]));
    for (const [id, score] of before) {
      expect(after.get(id)).toBeCloseTo(score as number, 10);
    }
  });
});

describe("rest-of-season value counts availability exactly once", () => {
  let Engines: any;
  let state: any;
  beforeEach(() => { state = baseState(); Engines = loadEngines(state); });

  it("multiplies value above replacement by expected remaining games and nothing else", () => {
    const league = projectedLeague(300, 20);
    // Same rate, half the attendance. At period 21 the league has played
    // about 10 games, so 20 appearances is a full record and 5 is half of
    // it. Both players are projected at exactly the rate they are
    // producing, so the shrink leaves their rateValue identical and
    // availability is the only thing that differs.
    const durable = league[20];
    const fragile = league[21];
    fragile.gamesPlayed = 5;
    Engines.computeDURANT(league, { preseason: false });

    const rates = league
      .filter((p: any) => !p.noEvidence && p.rateValue !== null)
      .map((p: any) => p.rateValue);
    const replacement = LarryEngine.replacementLevel(
      rates, state.league.teamCount * state.league.rosterSize,
    );

    for (const p of [durable, fragile]) {
      expect(p.expectedRemainingGames).toBeGreaterThan(0);
      // The identity: exactly one games factor, applied to value ABOVE
      // replacement. If a second discount crept in anywhere (a prior over
      // 82 that already assumed missed games, say, or an availability
      // haircut on the score) this would not hold.
      expect(p.rosValue).toBeCloseTo(
        ((p.rateValue - replacement) * p.expectedRemainingGames) / FULL_SEASON, 9,
      );
    }
    // And the fragile player is worth less from here despite the same rate.
    expect(fragile.expectedRemainingGames).toBeLessThan(durable.expectedRemainingGames);
    expect(fragile.rosValue).toBeLessThan(durable.rosValue);
  });

  it("gives a player with no NBA team no remaining games", () => {
    const league = projectedLeague();
    const freeAgent = league[30];
    freeAgent.proTeamId = 0;
    Engines.computeDURANT(league, { preseason: false });
    expect(freeAgent.expectedRemainingGames).toBe(0);
    expect(freeAgent.rosValue).toBe(0);
  });
});
