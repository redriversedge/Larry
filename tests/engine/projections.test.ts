// Larry's own projections (Marcel, adapted for basketball).
//
// The model projects RATE and PLAYING TIME separately and multiplies. That
// split is the whole point: in basketball a role change moves minutes far
// more than it moves per-minute production, so a single per-game number
// makes every promotion look like a skill jump.
//
// Numbers below are hand-computed from the formulas rather than captured
// from the implementation, so a change in behaviour fails the test instead
// of quietly rewriting the expectation.

import { describe, expect, it } from "vitest";

import {
  computeLeagueRates,
  espnPerGameRate,
  overrideIsActive,
  per36Rate,
  projectAll,
  projectGamesPlayed,
  projectMinutesPerGame,
  projectPlayer,
  type SeasonTotals,
} from "../../src/engine/projections";
import {
  GP_FALLBACK,
  GP_MAX,
  MARCEL_REGRESSION_MINUTES,
} from "../../src/engine/constants";

const CATS = ["REB", "AST", "STL", "BLK", "PTS"] as const;

function season(GP: number, MIN: number, line: Partial<SeasonTotals> = {}): SeasonTotals {
  return {
    GP, MIN,
    REB: line.REB ?? 0, AST: line.AST ?? 0, STL: line.STL ?? 0,
    BLK: line.BLK ?? 0, PTS: line.PTS ?? 0,
  };
}

// A league where the average player produces exactly 0.5 PTS and 0.2 REB
// per minute, so the regression target is trivial to reason about.
const FLAT_LEAGUE = {
  perMinute: { REB: 0.2, AST: 0.1, STL: 0.05, BLK: 0.02, PTS: 0.5 },
};

describe("league rates", () => {
  it("weights seasons 5/4/3 and ignores low-minute players", () => {
    const heavy = [season(80, 2000, { PTS: 2000 })]; // 1.0 PTS a minute
    const light = [season(5, 100, { PTS: 1000 })]; // 10 a minute, must not count
    const league = computeLeagueRates([heavy, light], { categories: CATS });
    expect(league.perMinute.PTS).toBeCloseTo(1.0, 10);
  });

  it("applies the 5/4/3 weights across a player's own seasons", () => {
    // One player, three seasons, all above the minutes floor.
    // weighted PTS = 5*1000 + 4*500 + 3*600 = 8800
    // weighted MIN = 5*1000 + 4*1000 + 3*1000 = 12000
    const p = [
      season(60, 1000, { PTS: 1000 }),
      season(60, 1000, { PTS: 500 }),
      season(60, 1000, { PTS: 600 }),
    ];
    const league = computeLeagueRates([p], { categories: CATS });
    expect(league.perMinute.PTS).toBeCloseTo(8800 / 12000, 10);
  });

  it("returns zeros rather than NaN when nobody clears the floor", () => {
    const league = computeLeagueRates([[season(2, 30, { PTS: 40 })]], { categories: CATS });
    expect(league.perMinute.PTS).toBe(0);
  });
});

describe("per-36 rate", () => {
  it("matches the hand-computed Marcel formula", () => {
    // Single season: 2000 minutes, 1000 points.
    // weighted PTS = 5 * 1000 = 5000, weighted MIN = 5 * 2000 = 10000
    // perMin = (5000 + 1000 * 0.5) / (10000 + 1000) = 5500 / 11000 = 0.5
    // per36 = 18
    const r = per36Rate([season(70, 2000, { PTS: 1000 })], FLAT_LEAGUE, {
      categories: CATS, regressionMinutes: 1000,
    });
    expect(r.PTS).toBeCloseTo(18, 10);
  });

  it("blends three seasons with 5/4/3 weights", () => {
    // weighted PTS = 5*1200 + 4*900 + 3*600 = 6000+3600+1800 = 11400
    // weighted MIN = 5*2000 + 4*1800 + 3*1500 = 10000+7200+4500 = 21700
    // perMin = (11400 + 1000*0.5) / (21700 + 1000) = 11900 / 22700
    // per36  = 36 * that
    const r = per36Rate(
      [
        season(70, 2000, { PTS: 1200 }),
        season(70, 1800, { PTS: 900 }),
        season(70, 1500, { PTS: 600 }),
      ],
      FLAT_LEAGUE,
      { categories: CATS, regressionMinutes: 1000 },
    );
    expect(r.PTS).toBeCloseTo((36 * 11900) / 22700, 10);
  });

  it("ignores a fourth season, because Marcel is a three-year window", () => {
    const three = [
      season(70, 2000, { PTS: 1200 }),
      season(70, 1800, { PTS: 900 }),
      season(70, 1500, { PTS: 600 }),
    ];
    const four = [...three, season(70, 2000, { PTS: 9999 })];
    const a = per36Rate(three, FLAT_LEAGUE, { categories: CATS });
    const b = per36Rate(four, FLAT_LEAGUE, { categories: CATS });
    expect(b.PTS).toBeCloseTo(a.PTS, 10);
  });

  it("pulls a tiny sample most of the way to league average", () => {
    // 80 minutes of play (weighted to 400) against 1000 minutes of
    // regression, so the player keeps only 400/1400 = 28.6% of their own
    // rate. Own rate is 160/80 = 2.0 a minute, i.e. 72 per 36; league is
    // 18 per 36. The result must land at the weighted average of the two.
    const wild = per36Rate([season(10, 80, { PTS: 160 })], FLAT_LEAGUE, {
      categories: CATS, regressionMinutes: MARCEL_REGRESSION_MINUTES,
    });
    const own = 72;
    const league = 18;
    const ownShare = 400 / 1400;
    expect(wild.PTS).toBeCloseTo(ownShare * own + (1 - ownShare) * league, 10);
    // Which is most of the way down from 72 toward 18.
    expect((own - wild.PTS) / (own - league)).toBeCloseTo(1 - ownShare, 10);
  });

  it("barely moves an established starter", () => {
    const starter = [
      season(80, 2800, { PTS: 2100 }),
      season(80, 2800, { PTS: 2100 }),
      season(80, 2800, { PTS: 2100 }),
    ];
    const r = per36Rate(starter, FLAT_LEAGUE, {
      categories: CATS, regressionMinutes: MARCEL_REGRESSION_MINUTES,
    });
    const ownPer36 = (2100 / 2800) * 36; // 27
    expect(Math.abs(r.PTS - ownPer36)).toBeLessThan(0.6);
  });

  it("returns exactly league average for an empty history", () => {
    // Not zero, and not NaN. With no minutes of their own, a player is
    // 100% regression, which is the definition of league average. The
    // rookie path in projectPlayer prefers ESPN over this, but the formula
    // still has to degrade sensibly on its own.
    const r = per36Rate([], FLAT_LEAGUE, { categories: CATS });
    for (const c of CATS) {
      expect(r[c]).toBeCloseTo(36 * FLAT_LEAGUE.perMinute[c], 10);
      expect(Number.isFinite(r[c])).toBe(true);
    }
  });

  it("returns zeros rather than NaN when there is no regression either", () => {
    const r = per36Rate([], { perMinute: { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 } }, {
      categories: CATS, regressionMinutes: 0,
    });
    for (const c of CATS) expect(r[c]).toBe(0);
  });

  it("honours the age hook when one is supplied", () => {
    const base = per36Rate([season(70, 2000, { PTS: 1000 })], FLAT_LEAGUE, {
      categories: CATS, regressionMinutes: 1000,
    });
    const aged = per36Rate([season(70, 2000, { PTS: 1000 })], FLAT_LEAGUE, {
      categories: CATS, regressionMinutes: 1000, ageFactor: 0.9,
    });
    expect(aged.PTS).toBeCloseTo(base.PTS * 0.9, 10);
  });
});

describe("minutes per game", () => {
  it("weights by games so a short season counts for less", () => {
    // weighted MIN = 5*2400 + 4*300 = 12000 + 1200 = 13200
    // weighted GP  = 5*80   + 4*10  = 400 + 40 = 440
    // raw = 30.0, totalGP = 90 which is under the 100 floor, so regressed
    const seasons = [season(80, 2400), season(10, 300)];
    const expectedRaw = 13200 / 440;
    const expected = 0.75 * expectedRaw + 0.25 * 24;
    expect(projectMinutesPerGame(seasons)).toBeCloseTo(expected, 10);
  });

  it("leaves an established player's minutes alone", () => {
    // 160 games total, comfortably over the floor, so no regression.
    const seasons = [season(80, 2400), season(80, 2400)];
    expect(projectMinutesPerGame(seasons)).toBeCloseTo(30, 10);
  });

  it("regresses a thin sample toward a bench role", () => {
    const thin = projectMinutesPerGame([season(12, 420)]); // raw 35 mpg
    expect(thin).toBeCloseTo(0.75 * 35 + 0.25 * 24, 10);
    expect(thin).toBeLessThan(35);
  });

  it("returns zero for no history", () => {
    expect(projectMinutesPerGame([])).toBe(0);
  });
});

describe("expected games played", () => {
  it("weights 0.5/0.3/0.2 and regresses toward 70", () => {
    // raw = 0.5*82 + 0.3*82 + 0.2*82 = 82, then 0.75*82 + 0.25*70 = 79
    expect(projectGamesPlayed([season(82, 2000), season(82, 2000), season(82, 2000)]))
      .toBeCloseTo(79, 10);
  });

  it("renormalizes when a season is missing", () => {
    // Two seasons: weights 0.5 and 0.3 renormalized over 0.8.
    // raw = (0.5*40 + 0.3*80) / 0.8 = (20 + 24) / 0.8 = 55
    // then 0.75*55 + 0.25*70 = 41.25 + 17.5 = 58.75
    expect(projectGamesPlayed([season(40, 1000), season(80, 2000)]))
      .toBeCloseTo(58.75, 10);
  });

  it("pulls a chronically unavailable player up toward the prior", () => {
    // A 30-game player is not a 30-game player forever.
    const gp = projectGamesPlayed([season(30, 900), season(30, 900), season(30, 900)]);
    expect(gp).toBeCloseTo(0.75 * 30 + 0.25 * 70, 10);
    expect(gp).toBeGreaterThan(30);
  });

  it("never exceeds a full season", () => {
    expect(projectGamesPlayed([season(82, 2000), season(82, 2000), season(82, 2000)]))
      .toBeLessThanOrEqual(GP_MAX);
  });

  it("uses ESPN's number when there is one season or fewer", () => {
    expect(projectGamesPlayed([season(70, 2000)], season(64, 2000))).toBe(64);
    expect(projectGamesPlayed([], season(64, 2000))).toBe(64);
  });

  it("falls back to a default when there is nothing at all", () => {
    expect(projectGamesPlayed([])).toBe(GP_FALLBACK);
    expect(projectGamesPlayed([season(70, 2000)])).toBe(GP_FALLBACK);
  });

  it("caps an absurd ESPN number", () => {
    expect(projectGamesPlayed([], season(200, 5000))).toBe(GP_MAX);
  });
});

describe("overrides", () => {
  const seasons = [
    season(80, 2400, { PTS: 1600, REB: 400, AST: 300, STL: 80, BLK: 40 }),
    season(80, 2400, { PTS: 1600, REB: 400, AST: 300, STL: 80, BLK: 40 }),
  ];

  it("is active with no expiry, and until the expiry date", () => {
    expect(overrideIsActive({ gp: 70 })).toBe(true);
    expect(overrideIsActive({ gp: 70, until: "2026-12-01" }, "2026-10-14")).toBe(true);
    expect(overrideIsActive({ gp: 70, until: "2026-12-01" }, "2026-12-01")).toBe(true);
  });

  it("is ignored past its expiry", () => {
    expect(overrideIsActive({ gp: 70, until: "2026-12-01" }, "2026-12-02")).toBe(false);
  });

  it("is inactive when absent", () => {
    expect(overrideIsActive(null)).toBe(false);
    expect(overrideIsActive(undefined)).toBe(false);
  });

  it("replaces the model's games played", () => {
    const r = projectPlayer({ id: "a", seasons }, FLAT_LEAGUE, {
      categories: CATS, override: { gp: 55 }, today: "2026-10-14",
    });
    expect(r.gp).toBe(55);
    expect(r.source).toBe("override");
  });

  it("replaces the model's minutes, which moves the per-game rate", () => {
    const base = projectPlayer({ id: "a", seasons }, FLAT_LEAGUE, { categories: CATS });
    const doubled = projectPlayer({ id: "a", seasons }, FLAT_LEAGUE, {
      categories: CATS, override: { mpg: base.mpg * 2 },
    });
    // per36 is unchanged; only the playing time doubled.
    expect(doubled.per36.PTS).toBeCloseTo(base.per36.PTS, 10);
    expect(doubled.perGame.PTS).toBeCloseTo(base.perGame.PTS * 2, 10);
  });

  it("lets gp and mpg be set independently", () => {
    const base = projectPlayer({ id: "a", seasons }, FLAT_LEAGUE, { categories: CATS });
    const onlyGp = projectPlayer({ id: "a", seasons }, FLAT_LEAGUE, {
      categories: CATS, override: { gp: 50 },
    });
    expect(onlyGp.gp).toBe(50);
    expect(onlyGp.mpg).toBeCloseTo(base.mpg, 10);
  });

  it("an expired override changes nothing", () => {
    const base = projectPlayer({ id: "a", seasons }, FLAT_LEAGUE, { categories: CATS });
    const expired = projectPlayer({ id: "a", seasons }, FLAT_LEAGUE, {
      categories: CATS, override: { gp: 10, mpg: 5, until: "2026-01-01" }, today: "2026-10-14",
    });
    expect(expired.gp).toBeCloseTo(base.gp, 10);
    expect(expired.mpg).toBeCloseTo(base.mpg, 10);
    expect(expired.source).not.toBe("override");
  });
});

describe("blend with ESPN", () => {
  const seasons = [
    season(80, 2400, { PTS: 2400, REB: 480, AST: 240, STL: 80, BLK: 40 }),
    season(80, 2400, { PTS: 2400, REB: 480, AST: 240, STL: 80, BLK: 40 }),
  ];
  // ESPN says 10 a game over 70 games.
  const espn = season(70, 2100, { PTS: 700, REB: 140, AST: 70, STL: 35, BLK: 14 });

  it("a = 1 is Larry only", () => {
    const r = projectPlayer({ id: "a", seasons, espnProjection: espn }, FLAT_LEAGUE, {
      categories: CATS, blendAlpha: 1,
    });
    const larry = projectPlayer({ id: "a", seasons }, FLAT_LEAGUE, { categories: CATS });
    expect(r.perGame.PTS).toBeCloseTo(larry.perGame.PTS, 10);
    expect(r.source).toBe("larry");
  });

  it("a = 0 is ESPN only, as a per-game rate over projected games", () => {
    const r = projectPlayer({ id: "a", seasons, espnProjection: espn }, FLAT_LEAGUE, {
      categories: CATS, blendAlpha: 0,
    });
    expect(r.perGame.PTS).toBeCloseTo(700 / 70, 10);
    expect(r.source).toBe("espn");
  });

  it("a = 0.6 is exactly the weighted mix", () => {
    const larry = projectPlayer({ id: "a", seasons }, FLAT_LEAGUE, {
      categories: CATS, blendAlpha: 1,
    });
    const r = projectPlayer({ id: "a", seasons, espnProjection: espn }, FLAT_LEAGUE, {
      categories: CATS, blendAlpha: 0.6,
    });
    expect(r.perGame.PTS).toBeCloseTo(0.6 * larry.perGame.PTS + 0.4 * (700 / 70), 10);
    expect(r.source).toBe("blend");
  });

  it("never blends games played, which is ESPN's noisiest field", () => {
    const r = projectPlayer({ id: "a", seasons, espnProjection: espn }, FLAT_LEAGUE, {
      categories: CATS, blendAlpha: 0.6,
    });
    const modelGp = projectGamesPlayed(seasons, espn);
    expect(r.gp).toBeCloseTo(modelGp, 10);
  });

  it("falls back to Larry alone when ESPN has no projection", () => {
    const r = projectPlayer({ id: "a", seasons }, FLAT_LEAGUE, {
      categories: CATS, blendAlpha: 0.6,
    });
    expect(r.source).toBe("larry");
  });

  it("gives a rookie ESPN's projection unchanged", () => {
    const r = projectPlayer({ id: "rook", seasons: [], espnProjection: espn }, FLAT_LEAGUE, {
      categories: CATS, blendAlpha: 0.6,
    });
    expect(r.perGame.PTS).toBeCloseTo(700 / 70, 10);
    expect(r.gp).toBe(70);
    expect(r.source).toBe("espn");
    expect(r.seasonsUsed).toBe(0);
  });

  it("reports source none for a player nobody has projected", () => {
    const r = projectPlayer({ id: "ghost", seasons: [] }, FLAT_LEAGUE, { categories: CATS });
    expect(r.source).toBe("none");
    expect(r.gp).toBe(GP_FALLBACK);
  });
});

describe("espnPerGameRate", () => {
  it("divides by projected games, not 82", () => {
    const r = espnPerGameRate(season(41, 1200, { PTS: 820 }), CATS);
    expect(r!.PTS).toBeCloseTo(20, 10);
  });

  it("is null without a usable game count", () => {
    expect(espnPerGameRate(season(0, 0, { PTS: 500 }), CATS)).toBeNull();
    expect(espnPerGameRate(null, CATS)).toBeNull();
    expect(espnPerGameRate(undefined, CATS)).toBeNull();
  });

  it("is null when the projection is all zeros", () => {
    expect(espnPerGameRate(season(70, 0), CATS)).toBeNull();
  });
});

describe("projectAll", () => {
  it("derives the league average from the population it is given", () => {
    const inputs = [];
    for (let i = 0; i < 30; i++) {
      inputs.push({
        id: "p" + i,
        seasons: [season(80, 2400, { PTS: 1200, REB: 480, AST: 240, STL: 80, BLK: 40 })],
      });
    }
    const out = projectAll(inputs, { categories: CATS });
    expect(out.size).toBe(30);
    // Everyone identical, so everyone lands on the league rate exactly.
    const first = out.get("p0")!;
    expect(first.per36.PTS).toBeCloseTo((1200 / 2400) * 36, 10);
  });

  it("applies per-player overrides by id", () => {
    const inputs = [
      { id: "a", seasons: [season(80, 2400, { PTS: 1200 }), season(80, 2400, { PTS: 1200 })] },
      { id: "b", seasons: [season(80, 2400, { PTS: 1200 }), season(80, 2400, { PTS: 1200 })] },
    ];
    const out = projectAll(inputs, {
      categories: CATS,
      overrides: { a: { gp: 41 } },
      today: "2026-10-14",
    });
    expect(out.get("a")!.gp).toBe(41);
    expect(out.get("b")!.gp).not.toBe(41);
    expect(out.get("b")!.source).not.toBe("override");
  });
});
