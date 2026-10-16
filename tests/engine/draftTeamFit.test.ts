// Draft Room team fit, docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md B1.

import { describe, expect, it } from "vitest";

import {
  categoryRanks,
  fitBonus,
  fitWeights,
  recommendValueAndFit,
  rosterCategoryTotals,
  FIT_WEIGHT_STRONG,
  FIT_WEIGHT_WEAK,
  type FitPlayer,
} from "../../src/engine/draftTeamFit";
import { CATEGORIES, type CategoryVector } from "../../src/shared/types";

function vec(over: Partial<CategoryVector> = {}): CategoryVector {
  return { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0, ...over };
}

function player(id: number, z: Partial<CategoryVector>, expectedGP = 70): FitPlayer {
  return {
    playerId: id,
    perGame: vec(z),
    z: vec(z),
    expectedGP,
  };
}

describe("roster category totals", () => {
  it("counts production in games, not in rates", () => {
    const totals = rosterCategoryTotals([
      { playerId: 1, perGame: vec({ PTS: 20 }), z: vec(), expectedGP: 80 },
      { playerId: 2, perGame: vec({ PTS: 20 }), z: vec(), expectedGP: 40 },
    ]);
    expect(totals.PTS).toBe(20 * 80 + 20 * 40);
  });

  it("values a durable player above an equal rate who misses half a season", () => {
    const durable = rosterCategoryTotals([
      { playerId: 1, perGame: vec({ REB: 10 }), z: vec(), expectedGP: 78 },
    ]);
    const fragile = rosterCategoryTotals([
      { playerId: 2, perGame: vec({ REB: 10 }), z: vec(), expectedGP: 39 },
    ]);
    expect(durable.REB).toBe(fragile.REB * 2);
  });
});

describe("category ranks and weights", () => {
  const totals = new Map<string, CategoryVector>([
    ["1", vec({ AST: 100, BLK: 10 })],
    ["2", vec({ AST: 90, BLK: 20 })],
    ["3", vec({ AST: 80, BLK: 30 })],
    ["4", vec({ AST: 70, BLK: 40 })],
  ]);

  it("ranks the user against the rest of the league", () => {
    const r1 = categoryRanks(totals, "1");
    expect(r1.AST).toBe(1);
    expect(r1.BLK).toBe(4);
    const r4 = categoryRanks(totals, "4");
    expect(r4.AST).toBe(4);
    expect(r4.BLK).toBe(1);
  });

  it("weights a weak category up and a strong one down", () => {
    const weights = fitWeights(categoryRanks(totals, "1"), 4);
    expect(weights.AST).toBe(FIT_WEIGHT_STRONG);
    expect(weights.BLK).toBe(FIT_WEIGHT_WEAK);
  });

  it("gives every category the same rank when nobody has drafted", () => {
    const empty = new Map<string, CategoryVector>([
      ["1", vec()], ["2", vec()], ["3", vec()],
    ]);
    const ranks = categoryRanks(empty, "1");
    for (const c of CATEGORIES) expect(ranks[c]).toBe(1);
  });
});

describe("fit bonus", () => {
  const weights = vec({ AST: FIT_WEIGHT_WEAK, BLK: FIT_WEIGHT_STRONG, REB: 1, STL: 1, PTS: 1 });

  it("rewards a weak category and penalises a strong one", () => {
    expect(fitBonus(player(1, { AST: 2 }), weights)).toBeGreaterThan(0);
    expect(fitBonus(player(2, { BLK: 2 }), weights)).toBeLessThan(0);
  });

  it("is zero for a category the roster is even in", () => {
    expect(fitBonus(player(3, { PTS: 3 }), weights)).toBe(0);
  });

  it("scales with games, so a fragile specialist helps less", () => {
    const full = fitBonus(player(4, { AST: 2 }, 80), weights);
    const half = fitBonus(player(5, { AST: 2 }, 40), weights);
    expect(half).toBeCloseTo(full / 2, 10);
  });
});

describe("value and fit recommendations", () => {
  // The spec's test: a roster strong in BLK and weak in AST should take an
  // AST player over a BLK player of equal board value.
  const totals = new Map<string, CategoryVector>([
    ["me", vec({ BLK: 2000, AST: 100 })],
    ["b", vec({ BLK: 500, AST: 1200 })],
    ["c", vec({ BLK: 400, AST: 1100 })],
    ["d", vec({ BLK: 300, AST: 1000 })],
  ]);

  const astGuy = player(10, { AST: 2.5 });
  const blkGuy = player(11, { BLK: 2.5 });

  it("prefers the player who fills the hole when value is equal", () => {
    const rec = recommendValueAndFit({
      available: [astGuy, blkGuy],
      // Dead equal on the board, so only fit can separate them.
      valueOf: () => 5,
      totalsByTeam: totals,
      myTeamId: "me",
      myPickCount: 3,
      teamCount: 4,
    });
    expect(rec.active).toBe(true);
    expect(rec.fitId).toBe(10);
    // Value is a tie, so whichever came first is fine; the point is that
    // fit moved off it.
    expect(rec.weakest[0]?.category).toBe("AST");
  });

  it("still names the better player as best value", () => {
    const rec = recommendValueAndFit({
      available: [astGuy, blkGuy],
      // The BLK player is clearly better on the board.
      valueOf: (id) => (id === 11 ? 9 : 5),
      totalsByTeam: totals,
      myTeamId: "me",
      myPickCount: 3,
      teamCount: 4,
    });
    expect(rec.valueId).toBe(11);
    // And fit does not override a 4-point board gap on its own.
    expect(rec.fitId).toBe(11);
  });

  it("flips the pick when the board gap is small enough for need to matter", () => {
    const rec = recommendValueAndFit({
      available: [astGuy, blkGuy],
      valueOf: (id) => (id === 11 ? 5.05 : 5),
      totalsByTeam: totals,
      myTeamId: "me",
      myPickCount: 3,
      teamCount: 4,
    });
    expect(rec.valueId).toBe(11);
    expect(rec.fitId).toBe(10);
  });

  it("stays switched off until the user's third pick", () => {
    for (const picks of [0, 1]) {
      const rec = recommendValueAndFit({
        available: [astGuy, blkGuy],
        valueOf: () => 5,
        totalsByTeam: totals,
        myTeamId: "me",
        myPickCount: picks,
        teamCount: 4,
      });
      expect(rec.active).toBe(false);
      // Inactive means the fit card shows the same player as value.
      expect(rec.fitId).toBe(rec.valueId);
    }
    const third = recommendValueAndFit({
      available: [astGuy, blkGuy],
      valueOf: () => 5,
      totalsByTeam: totals,
      myTeamId: "me",
      myPickCount: 2,
      teamCount: 4,
    });
    expect(third.active).toBe(true);
  });

  it("reports the weakest categories worst first", () => {
    const rec = recommendValueAndFit({
      available: [astGuy],
      valueOf: () => 1,
      totalsByTeam: totals,
      myTeamId: "me",
      myPickCount: 5,
      teamCount: 4,
    });
    expect(rec.weakest.length).toBeGreaterThan(0);
    for (let i = 1; i < rec.weakest.length; i++) {
      expect(rec.weakest[i - 1]!.rank).toBeGreaterThanOrEqual(rec.weakest[i]!.rank);
    }
  });

  it("handles an empty board without throwing", () => {
    const rec = recommendValueAndFit({
      available: [],
      valueOf: () => 0,
      totalsByTeam: totals,
      myTeamId: "me",
      myPickCount: 5,
      teamCount: 4,
    });
    expect(rec.valueId).toBeNull();
    expect(rec.fitId).toBeNull();
  });
});
