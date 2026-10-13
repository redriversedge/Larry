// Ranking v2 base value. See docs/RANKING_V2_SPEC.md and HANDOFF.md phase 2.
//
// These tests use synthetic pools only. The real regression gate lives in
// tools/rank-v2-vs-experts.ts, which asserts numeric parity against the 666
// rows produced by tools/proto.py on the Oct 12 2026 snapshot; that snapshot
// contains personal roster data and is git-ignored, so it cannot be a test.
// What is covered here is the behavior that must not drift regardless of
// data: the three cases the spec names, plus guards on two decisions that a
// well-meaning refactor could quietly undo.

import { describe, expect, it } from "vitest";
import { applyHaircut, computeBaseValues } from "../../src/engine/zscore";
import { MIN_GP_POOL, SHRINK_K, Z_CAP } from "../../src/engine/constants";
import type { Category, CategoryVector } from "../../src/shared/types";
import { CATEGORIES } from "../../src/shared/types";
import { makeBaseValueInput } from "./fixtures";

// A pool of ordinary rotation players, all with full samples so they define
// the reference stats. Spread is deliberate: without variance every stdev
// collapses to the floor and every z explodes.
function rotationPool(count = 160): ReturnType<typeof makeBaseValueInput>[] {
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    out.push(
      makeBaseValueInput({
        id: `pool${i}`,
        gamesPlayed: 60 + (i % 20),
        perGame: {
          REB: 2 + t * 8,
          AST: 1 + t * 6,
          STL: 0.3 + t * 1.2,
          BLK: 0.1 + t * 1.4,
          PTS: 5 + t * 20,
        },
      }),
    );
  }
  return out;
}

function byId(result: ReturnType<typeof computeBaseValues>, id: string) {
  const row = result.rows.find((r) => r.id === id);
  if (!row) throw new Error(`no row for ${id}`);
  return row;
}

function rankOf(result: ReturnType<typeof computeBaseValues>, id: string): number {
  const sorted = [...result.rows].sort((a, b) => b.baseValue - a.baseValue);
  return sorted.findIndex((r) => r.id === id) + 1;
}

describe("ranking v2 base value", () => {
  it("ranks a low-GP star near the top instead of the bottom", () => {
    // The defect this replaces: the legacy engine z-scored season TOTALS, so
    // Trae Young's 269 points over 15 games read as z = -3.0 and he ranked
    // below players who had never been worth rostering. Judged on the games
    // he played, a 15-game star is still a star.
    const star: CategoryVector = { REB: 8, AST: 10, STL: 1.8, BLK: 1.0, PTS: 29 };
    const players = [
      ...rotationPool(),
      makeBaseValueInput({ id: "lowGpStar", gamesPlayed: 15, perGame: star }),
      makeBaseValueInput({ id: "fullGpStar", gamesPlayed: 78, perGame: star }),
    ];
    const result = computeBaseValues(players, { rosterSize: 13 });

    const low = byId(result, "lowGpStar");
    expect(low.baseValue).toBeGreaterThan(0);
    expect(rankOf(result, "lowGpStar")).toBeLessThanOrEqual(players.length * 0.1);

    // Shrink still costs him something relative to the identical player who
    // played a full season. That is the point of the mechanism, not a bug.
    const full = byId(result, "fullGpStar");
    expect(low.baseValue).toBeLessThan(full.baseValue);
  });

  it("shrinks a small sample toward the pool mean by w = gp / (gp + k)", () => {
    const star: CategoryVector = { REB: 8, AST: 10, STL: 1.8, BLK: 1.0, PTS: 29 };
    const players = [
      ...rotationPool(),
      makeBaseValueInput({ id: "lowGpStar", gamesPlayed: 15, perGame: star }),
    ];
    const result = computeBaseValues(players, { rosterSize: 13 });
    const row = byId(result, "lowGpStar");
    const w = 15 / (15 + SHRINK_K);
    for (const c of CATEGORIES) {
      expect(row.shrunk[c]).toBeCloseTo(w * star[c] + (1 - w) * result.stats.mean[c], 10);
    }
  });

  it("never lets a haircut improve a negative score", () => {
    // The legacy bug in one line: durantScore *= 0.3 on an OUT player moved
    // anyone below zero UP the board. Duop Reath (OUT, z -4.2) outranked
    // Chris Paul (ACTIVE, z -4.1) by 131 places because of it.
    expect(applyHaircut(-2.5, 0.3)).toBe(-2.5);
    expect(applyHaircut(-0.0001, 0.3)).toBe(-0.0001);
    expect(applyHaircut(0, 0.3)).toBe(0);
    expect(applyHaircut(2.5, 0.3)).toBeCloseTo(0.75, 10);
  });

  it("keeps the ordering of negative scores intact when haircuts are applied", () => {
    const players = [
      ...rotationPool(),
      makeBaseValueInput({
        id: "badInjured",
        gamesPlayed: 40,
        perGame: { REB: 0.5, AST: 0.2, STL: 0.05, BLK: 0.02, PTS: 1 },
      }),
      makeBaseValueInput({
        id: "badHealthy",
        gamesPlayed: 40,
        perGame: { REB: 0.6, AST: 0.3, STL: 0.07, BLK: 0.03, PTS: 1.4 },
      }),
    ];
    const result = computeBaseValues(players, { rosterSize: 13 });
    const injured = byId(result, "badInjured");
    const healthy = byId(result, "badHealthy");
    expect(injured.baseValue).toBeLessThan(0);
    expect(healthy.baseValue).toBeLessThan(0);
    // Healthy is the better player and must stay ahead even after the
    // injured one takes a severe haircut.
    expect(applyHaircut(healthy.baseValue, 1.0)).toBeGreaterThan(
      applyHaircut(injured.baseValue, 0.3),
    );
  });

  it("caps a category outlier at Z_CAP", () => {
    const players = [
      ...rotationPool(),
      makeBaseValueInput({
        id: "blkFreak",
        gamesPlayed: 70,
        perGame: { REB: 5, AST: 2, STL: 0.6, BLK: 25, PTS: 10 },
      }),
    ];
    const result = computeBaseValues(players, { rosterSize: 13 });
    const row = byId(result, "blkFreak");
    expect(row.z.BLK).toBe(Z_CAP);
    expect(row.baseValue).toBeLessThanOrEqual(Z_CAP * CATEGORIES.length);
    for (const c of CATEGORIES) {
      expect(row.z[c]).toBeLessThanOrEqual(Z_CAP);
      expect(row.z[c]).toBeGreaterThanOrEqual(-Z_CAP);
    }
  });

  it("ranks a player with no games played on their projection", () => {
    // At gp = 0 the shrink weight is 0, so the score comes entirely from the
    // prior. The prior is the player's own projection, so a projected star
    // ranks like a star before they have played a game.
    //
    // This used to shrink toward the POOL MEAN, which scored every gp = 0
    // player at exactly 0. Defensible as "no evidence" mid-season, but in
    // the preseason every player has 0 games, so the entire board was zeros
    // and the displayed order was just ESPN's ownership ranking.
    const players = [
      ...rotationPool(),
      makeBaseValueInput({
        id: "projectedStar",
        gamesPlayed: 0,
        asProjection: true,
        perGame: { REB: 9, AST: 7, STL: 1.5, BLK: 1.2, PTS: 26 },
      }),
      makeBaseValueInput({
        id: "projectedScrub",
        gamesPlayed: 0,
        asProjection: true,
        perGame: { REB: 1, AST: 0.4, STL: 0.1, BLK: 0.05, PTS: 2 },
      }),
    ];
    const result = computeBaseValues(players, { rosterSize: 13 });
    const star = byId(result, "projectedStar");
    const scrub = byId(result, "projectedScrub");

    expect(star.baseValue).toBeGreaterThan(0);
    expect(scrub.baseValue).toBeLessThan(0);
    expect(star.baseValue).toBeGreaterThan(scrub.baseValue);
    expect(rankOf(result, "projectedStar")).toBeLessThan(rankOf(result, "projectedScrub"));
  });

  it("still scores zero when there is no projection to go on", () => {
    // No games AND no projection is genuine ignorance. Those players fall
    // back to the pool mean and score 0, which puts them below everyone we
    // do have an opinion about.
    const players = [
      ...rotationPool(),
      { id: "unknown", gamesPlayed: 0 },
    ];
    const result = computeBaseValues(players, { rosterSize: 13 });
    expect(byId(result, "unknown").baseValue).toBeCloseTo(0, 10);
  });

  it("produces a full distinct ranking when NOBODY has played yet", () => {
    // The live preseason case. Every player at gp 0, each with a different
    // projection: the board must be fully ordered, not 500 ties at zero.
    const players = [];
    for (let i = 0; i < 80; i++) {
      const t = i / 80;
      players.push(
        makeBaseValueInput({
          id: `pre${i}`,
          gamesPlayed: 0,
          asProjection: true,
          perGame: {
            REB: 2 + t * 9,
            AST: 1 + t * 7,
            STL: 0.3 + t * 1.4,
            BLK: 0.1 + t * 1.6,
            PTS: 5 + t * 23,
          },
        }),
      );
    }
    const result = computeBaseValues(players, { rosterSize: 13 });
    const values = result.rows.map((r) => r.baseValue);
    const distinct = new Set(values.map((v) => v.toFixed(6)));

    expect(distinct.size).toBe(players.length);
    expect(Math.max(...values)).toBeGreaterThan(0);
    expect(Math.min(...values)).toBeLessThan(0);
    // Ordered by projection strength: the best projection ranks first.
    expect(rankOf(result, "pre79")).toBe(1);
    expect(rankOf(result, "pre0")).toBe(players.length);
  });

  it("accepts an explicit projectedPerGame vector as the prior", () => {
    // What the app's parser produces (stats.projectedPerGame), as opposed
    // to projectedSeason totals.
    const players = [
      ...rotationPool(),
      {
        id: "ppg",
        gamesPlayed: 0,
        projectedPerGame: { REB: 9, AST: 7, STL: 1.5, BLK: 1.2, PTS: 26 },
      },
    ];
    const result = computeBaseValues(players, { rosterSize: 13 });
    expect(byId(result, "ppg").baseValue).toBeGreaterThan(0);
  });

  it("weights real production over the projection as games accumulate", () => {
    // A player projected for stardom who is actually producing nothing
    // should slide as the sample grows: all projection at gp 0, roughly
    // half and half by 8 games, mostly real production by 30.
    const projection = { REB: 9, AST: 7, STL: 1.5, BLK: 1.2, PTS: 26 };
    const actual = { REB: 1, AST: 0.5, STL: 0.1, BLK: 0.05, PTS: 2 };

    const scoreAt = (gp: number) => {
      const players = [
        ...rotationPool(),
        {
          id: "fading",
          gamesPlayed: gp,
          perGame: gp > 0 ? actual : projection,
          projectedPerGame: projection,
        },
      ];
      return byId(computeBaseValues(players, { rosterSize: 13 }), "fading").baseValue;
    };

    const atZero = scoreAt(0);
    const atEight = scoreAt(8);
    const atThirty = scoreAt(30);

    expect(atZero).toBeGreaterThan(atEight);
    expect(atEight).toBeGreaterThan(atThirty);
    expect(atThirty).toBeLessThan(0);
  });

  it("excludes sub-threshold samples from the pool that defines the mean", () => {
    // 200 fringe players on tiny samples must not drag the reference mean
    // down; that was the second legacy defect.
    const fringe = [];
    for (let i = 0; i < 200; i++) {
      fringe.push(
        makeBaseValueInput({
          id: `fringe${i}`,
          gamesPlayed: MIN_GP_POOL - 1,
          perGame: { REB: 0.4, AST: 0.3, STL: 0.05, BLK: 0.05, PTS: 1 },
        }),
      );
    }
    const withFringe = computeBaseValues([...rotationPool(), ...fringe], { rosterSize: 13 });
    const withoutFringe = computeBaseValues(rotationPool(), { rosterSize: 13 });
    for (const c of CATEGORIES) {
      expect(withFringe.stats.mean[c]).toBeCloseTo(withoutFringe.stats.mean[c], 10);
    }
  });

  it("sums only the categories the league actually scores", () => {
    const threeCats: readonly Category[] = ["REB", "AST", "PTS"];
    const players = rotationPool();
    const result = computeBaseValues(players, { rosterSize: 13, categories: threeCats });
    const row = result.rows[0];
    if (!row) throw new Error("no rows");
    expect(row.baseValue).toBeCloseTo(row.z.REB + row.z.AST + row.z.PTS, 10);
    // Unscored categories are left at zero rather than silently contributing.
    expect(row.z.STL).toBe(0);
    expect(row.z.BLK).toBe(0);
  });

  it("gives identical results for per-game input and the equivalent totals", () => {
    // HANDOFF phase 1 moves per-game normalization to parse time. When that
    // lands, callers pass perGame instead of seasonTotals and this must be a
    // no-op for the ranking.
    const profile: CategoryVector = { REB: 7.4, AST: 5.1, STL: 1.3, BLK: 0.9, PTS: 22.6 };
    const pool = rotationPool();
    const totalsRun = computeBaseValues(
      [...pool, makeBaseValueInput({ id: "subject", gamesPlayed: 55, perGame: profile })],
      { rosterSize: 13 },
    );
    const perGameRun = computeBaseValues(
      [
        ...pool,
        makeBaseValueInput({ id: "subject", gamesPlayed: 55, perGame: profile, asPerGame: true }),
      ],
      { rosterSize: 13 },
    );
    expect(byId(perGameRun, "subject").baseValue).toBeCloseTo(
      byId(totalsRun, "subject").baseValue,
      10,
    );
  });

  it("returns an empty result rather than dividing by nothing", () => {
    const result = computeBaseValues([], { rosterSize: 13 });
    expect(result.rows).toEqual([]);
    expect(result.poolSize).toBe(0);
  });

  it("falls back to the whole population when nobody clears MIN_GP_POOL", () => {
    // Opening night: every player has 0 to 9 games. The engine must still
    // produce a usable spread instead of crashing on an empty pool.
    const players = [];
    for (let i = 0; i < 40; i++) {
      players.push(
        makeBaseValueInput({
          id: `early${i}`,
          gamesPlayed: 5,
          perGame: { REB: 1 + i * 0.2, AST: 1 + i * 0.1, STL: 0.2, BLK: 0.1, PTS: 4 + i * 0.5 },
        }),
      );
    }
    const result = computeBaseValues(players, { rosterSize: 13 });
    expect(result.poolSize).toBeGreaterThan(0);
    const values = result.rows.map((r) => r.baseValue);
    expect(Math.max(...values)).toBeGreaterThan(Math.min(...values));
  });
});
