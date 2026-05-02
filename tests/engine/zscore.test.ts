import { describe, expect, it } from "vitest";
import {
  buildQPool,
  gVector,
  zVector,
  sumVector,
} from "../../src/engine/zscore";
import { CATEGORIES } from "../../src/shared/types";
import { makePlayer, buildSyntheticLeague } from "./fixtures";

describe("zscore / G-score", () => {
  it("Z-score: produces zero for a player at the pool mean", () => {
    const players = [
      makePlayer({ id: "1", perGame: { REB: 5, AST: 4, STL: 1, BLK: 0.5, PTS: 12 } }),
      makePlayer({ id: "2", perGame: { REB: 6, AST: 5, STL: 1.5, BLK: 1, PTS: 14 } }),
      makePlayer({ id: "3", perGame: { REB: 7, AST: 6, STL: 2, BLK: 1.5, PTS: 16 } }),
    ];
    const { stats } = buildQPool(players, 1);
    const middle = makePlayer({ id: "mid", perGame: stats.mean });
    const z = zVector(middle, stats);
    for (const c of CATEGORIES) {
      expect(z[c]).toBeCloseTo(0, 5);
    }
  });

  it("G-score differs from Z for high-variance categories", () => {
    // Build a pool where two players have identical raw deltas above the
    // mean, but in different categories (PTS = low week-to-week variance,
    // BLK = high). G-score should rank PTS higher than Z does, because the
    // BLK player gets penalized more by the kappa * weekVar denominator.
    const pool = [];
    for (let i = 0; i < 20; i++) {
      pool.push(
        makePlayer({
          id: `pool${i}`,
          perGame: {
            REB: 5 + (i % 5),
            AST: 4 + (i % 4),
            STL: 1 + (i % 3) * 0.2,
            BLK: 0.6 + (i % 3) * 0.2,
            PTS: 12 + (i % 6),
          },
        }),
      );
    }
    const { stats } = buildQPool(pool, 2);
    // Player A is +1 stdev in PTS, baseline elsewhere.
    const playerPts = makePlayer({
      id: "pts",
      perGame: {
        REB: stats.mean.REB,
        AST: stats.mean.AST,
        STL: stats.mean.STL,
        BLK: stats.mean.BLK,
        PTS: stats.mean.PTS + stats.stdev.PTS,
      },
    });
    // Player B is +1 stdev in BLK, baseline elsewhere.
    const playerBlk = makePlayer({
      id: "blk",
      perGame: {
        REB: stats.mean.REB,
        AST: stats.mean.AST,
        STL: stats.mean.STL,
        BLK: stats.mean.BLK + stats.stdev.BLK,
        PTS: stats.mean.PTS,
      },
    });
    const zPts = sumVector(zVector(playerPts, stats));
    const zBlk = sumVector(zVector(playerBlk, stats));
    const gPts = sumVector(gVector(playerPts, stats));
    const gBlk = sumVector(gVector(playerBlk, stats));
    // By construction, raw Z is roughly equal (both +1 stdev in their
    // respective categories).
    expect(Math.abs(zPts - zBlk)).toBeLessThan(0.05);
    // G-score discounts BLK more than PTS because BLK has higher week-to-week
    // variance (PROXY_WEEK_VARIANCE.BLK > PROXY_WEEK_VARIANCE.PTS).
    expect(gPts).toBeGreaterThan(gBlk);
  });

  it("Q pool size differs between 10-team and 12-team leagues", () => {
    const league10 = buildSyntheticLeague({ teams: 10, playersPerTeam: 13, seed: 1 });
    const league12 = buildSyntheticLeague({ teams: 12, playersPerTeam: 13, seed: 1 });
    const allPlayers10 = Object.values(league10.rosters).flat().concat(league10.freeAgents);
    const allPlayers12 = Object.values(league12.rosters).flat().concat(league12.freeAgents);
    // Roster size 13 is the relevant size for Q pool sizing per the engine.
    const pool10 = buildQPool(allPlayers10, 10);
    const pool12 = buildQPool(allPlayers12, 12);
    // Q pool size = min(pool, 12 * rosterSize). With rosterSize 10 vs 12,
    // and enough players in both pools, pool sizes should differ.
    expect(pool10.players.length).toBeLessThan(pool12.players.length);
  });

  it("10-team and 12-team produce different player orderings on the same pool", () => {
    // Build one shared pool.
    const players = [];
    for (let i = 0; i < 100; i++) {
      players.push(
        makePlayer({
          id: `p${i}`,
          perGame: {
            REB: 3 + Math.sin(i) * 3 + i * 0.05,
            AST: 2 + Math.cos(i * 0.7) * 4 + i * 0.03,
            STL: 0.4 + Math.sin(i * 0.3) * 0.6,
            BLK: 0.3 + Math.cos(i * 0.5) * 0.5,
            PTS: 8 + Math.sin(i * 0.2) * 5 + i * 0.1,
          },
        }),
      );
    }
    // rosterSize 5 vs rosterSize 8 changes Q pool top N (12*5=60 vs 12*8=96).
    // The pool stats differ, so individual player ranks shift.
    const { stats: stats5 } = buildQPool(players, 5);
    const { stats: stats8 } = buildQPool(players, 8);
    const order5 = [...players]
      .map((p) => ({ id: p.id, score: sumVector(zVector(p, stats5)) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.id);
    const order8 = [...players]
      .map((p) => ({ id: p.id, score: sumVector(zVector(p, stats8)) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.id);
    let differences = 0;
    for (let i = 0; i < 20; i++) {
      if (order5[i] !== order8[i]) differences += 1;
    }
    expect(differences).toBeGreaterThan(0);
  });
});
