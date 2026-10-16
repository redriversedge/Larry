// Log-rank blend of Larry's board with the market.
// docs/RANKINGS_V3_ADDENDUM.md section 3.

import { describe, expect, it } from "vitest";

import {
  blendBoard,
  blendScore,
  marketAgeDays,
  marketRankOrMissing,
  MARKET_STALE_DAYS,
} from "../../src/engine/blend";
import {
  BLEND_LARRY_WEIGHT,
  BLEND_MARKET_DEPTH,
  BLEND_MISSING_RANK,
} from "../../src/engine/constants";

describe("market rank handling", () => {
  it("passes a real rank through", () => {
    expect(marketRankOrMissing(1)).toBe(1);
    expect(marketRankOrMissing(BLEND_MARKET_DEPTH)).toBe(BLEND_MARKET_DEPTH);
  });

  it("treats absent, invalid and too-deep the same way", () => {
    // A list that stops at 200 is not saying player 260 is bad, only that
    // he is outside the range it covers.
    expect(marketRankOrMissing(undefined)).toBe(BLEND_MISSING_RANK);
    expect(marketRankOrMissing(0)).toBe(BLEND_MISSING_RANK);
    expect(marketRankOrMissing(-5)).toBe(BLEND_MISSING_RANK);
    expect(marketRankOrMissing(Number.NaN)).toBe(BLEND_MISSING_RANK);
    expect(marketRankOrMissing(BLEND_MARKET_DEPTH + 1)).toBe(BLEND_MISSING_RANK);
  });
});

describe("blend score", () => {
  it("weights Larry 3 against 1 for each market list", () => {
    // All four agree on rank 10, so the blend is ln(10) whatever the
    // weights are.
    expect(blendScore(10, [10, 10, 10])).toBeCloseTo(Math.log(10), 10);

    // Larry says 1, every market list says 100. With weight 3 against 3,
    // the answer is the midpoint in log space.
    const mixed = blendScore(1, [100, 100, 100]);
    expect(mixed).toBeCloseTo((3 * Math.log(1) + 3 * Math.log(100)) / 6, 10);
    expect(BLEND_LARRY_WEIGHT).toBe(3);
  });

  it("is a log average, so the top of the board matters more than the bottom", () => {
    // Moving 1 -> 11 is a bigger change than moving 191 -> 201, which is
    // the whole reason this is done in log space.
    const top = Math.abs(blendScore(1, [1]) - blendScore(11, [11]));
    const deep = Math.abs(blendScore(191, [191]) - blendScore(201, [201]));
    expect(top).toBeGreaterThan(deep * 5);
  });

  it("does not crash or vanish when a player is on no market list at all", () => {
    const score = blendScore(5, [undefined, undefined, undefined]);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeCloseTo(
      (3 * Math.log(5) + 3 * Math.log(BLEND_MISSING_RANK)) / 6,
      10,
    );
  });

  it("falls back to Larry alone when there are no market lists", () => {
    expect(blendScore(7, [])).toBeCloseTo(Math.log(7), 10);
  });

  it("renormalizes when only some market lists are available", () => {
    // One list missing entirely must not act like a missing-rank vote for
    // every player; it just shifts weight onto what is left.
    const twoLists = blendScore(1, [50, 50]);
    expect(twoLists).toBeCloseTo((3 * Math.log(1) + 2 * Math.log(50)) / 5, 10);
  });

  it("never takes the log of zero", () => {
    expect(Number.isFinite(blendScore(0, [1]))).toBe(true);
    expect(blendScore(0, [1])).toBeCloseTo(0, 10);
  });
});

describe("blend board", () => {
  it("ranks by blended score, best first", () => {
    const rows = blendBoard([
      { id: 1, larryRank: 1, marketRanks: [1, 1, 1] },
      { id: 2, larryRank: 2, marketRanks: [2, 2, 2] },
      { id: 3, larryRank: 3, marketRanks: [3, 3, 3] },
    ]);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.blendRank)).toEqual([1, 2, 3]);
  });

  it("lets the market pull down a player Larry loves and nobody else does", () => {
    const rows = blendBoard([
      // Larry's number one, but the market has him outside its lists.
      { id: 1, larryRank: 1, marketRanks: [undefined, undefined, undefined] },
      // Larry's 12th, and the market's 5th.
      { id: 2, larryRank: 12, marketRanks: [5, 5, 5] },
    ]);
    expect(rows[0]?.id).toBe(2);
  });

  it("keeps a player the market loves but Larry does not, in between", () => {
    const rows = blendBoard([
      { id: 1, larryRank: 1, marketRanks: [1, 1, 1] },
      // Market darling, Larry has him 60th: lands behind the consensus
      // number one but ahead of Larry's own 60th-ranked-everywhere player.
      { id: 2, larryRank: 60, marketRanks: [3, 3, 3] },
      { id: 3, larryRank: 60, marketRanks: [60, 60, 60] },
    ]);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("reports the market average for the Mkt column, and null when absent", () => {
    const rows = blendBoard([
      { id: 1, larryRank: 1, marketRanks: [10, 20, 30] },
      { id: 2, larryRank: 2, marketRanks: [undefined, undefined, undefined] },
    ]);
    expect(rows.find((r) => r.id === 1)?.marketRank).toBeCloseTo(20, 10);
    expect(rows.find((r) => r.id === 2)?.marketRank).toBeNull();
  });

  it("breaks ties on Larry's own value, so the order is stable", () => {
    const a = blendBoard([
      { id: 1, larryRank: 5, marketRanks: [5], larryValue: 1 },
      { id: 2, larryRank: 5, marketRanks: [5], larryValue: 9 },
    ]);
    const b = blendBoard([
      { id: 2, larryRank: 5, marketRanks: [5], larryValue: 9 },
      { id: 1, larryRank: 5, marketRanks: [5], larryValue: 1 },
    ]);
    expect(a.map((r) => r.id)).toEqual([2, 1]);
    expect(b.map((r) => r.id)).toEqual([2, 1]);
  });

  it("handles an empty board", () => {
    expect(blendBoard([])).toEqual([]);
  });
});

describe("market staleness", () => {
  it("measures age in days and tolerates a missing stamp", () => {
    const now = Date.parse("2026-10-18T00:00:00Z");
    expect(marketAgeDays("2026-10-17T00:00:00Z", now)).toBeCloseTo(1, 6);
    expect(marketAgeDays("2026-10-11T00:00:00Z", now)).toBeCloseTo(7, 6);
    expect(marketAgeDays(undefined, now)).toBeNull();
    expect(marketAgeDays("not a date", now)).toBeNull();
  });

  it("calls a week old stale", () => {
    const now = Date.parse("2026-10-18T00:00:00Z");
    const age = marketAgeDays("2026-10-09T00:00:00Z", now) as number;
    expect(age).toBeGreaterThan(MARKET_STALE_DAYS);
  });
});
