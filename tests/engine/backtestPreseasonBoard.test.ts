// Pins the pieces of the preseason backtest that must not drift.
// docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md A1 and A2.
//
// The tool itself reads committed fixtures and prints a report; what is
// worth pinning is the durability model and the replacement-value maths,
// plus the one fact the whole backtest rests on: that ESPN's stored
// projection for a FINISHED season is still the PRESEASON projection.

import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

import {
  clampGames,
  durabilityDetail,
  espnMAE,
  expectedGames,
  fitDurability,
  weightedHistory,
  DURABILITY_K,
  DURABILITY_W,
  type FitSample,
} from "../../src/engine/durability";
import { replacementLevel, seasonValueFor, seasonValues } from "../../src/engine/replacement";
import { durabilityBand } from "../../src/engine/preseasonBoard";

const ROOT = path.resolve(__dirname, "../..");
const HISTORY = path.join(ROOT, "tests/fixtures/projections/espn-history.json");

interface SeasonLine {
  GP: number; MIN: number; REB: number; AST: number;
  STL: number; BLK: number; PTS: number;
}
interface HistoryPlayer {
  id: number; name: string; proTeamId: number;
  actual: Record<string, SeasonLine>;
  espnProjection: Record<string, SeasonLine>;
}
const history = JSON.parse(fs.readFileSync(HISTORY, "utf8")) as {
  seasons: number[];
  players: HistoryPlayer[];
};

function find(name: string): HistoryPlayer {
  const p = history.players.find((x) => x.name === name);
  if (!p) throw new Error("missing from fixture: " + name);
  return p;
}

describe("the history fixture", () => {
  it("covers 2020 through 2027", () => {
    expect(history.seasons[0]).toBe(2020);
    expect(history.seasons[history.seasons.length - 1]).toBe(2027);
    // Three prior seasons must exist for any board year the fit uses.
    for (const season of [2024, 2025, 2026]) {
      for (let s = season - 1; s >= season - 3; s--) {
        expect(history.seasons).toContain(s);
      }
    }
  });

  it("stores the PRESEASON projection for a finished season, not a mid-season update", () => {
    // The entire preseason backtest depends on this. These are the exact
    // numbers ESPN published before those seasons, quoted in the spec. If
    // ESPN ever starts overwriting them with rest-of-season values, these
    // break and the backtest becomes meaningless rather than merely wrong.
    const cases: Array<[string, number, number, number]> = [
      // name, season, projected GP, actual GP
      ["Zion Williamson", 2025, 64, 30],
      ["Kawhi Leonard", 2025, 50, 37],
      ["Ja Morant", 2025, 70, 50],
      ["Paolo Banchero", 2025, 76, 46],
      ["Joel Embiid", 2026, 56, 38],
      ["Ja Morant", 2026, 67, 20],
      ["Zion Williamson", 2026, 64, 62],
      ["Jaren Jackson Jr.", 2026, 62, 48],
    ];
    for (const [name, season, projGP, actualGP] of cases) {
      const p = find(name);
      expect(p.espnProjection[String(season)]?.GP, name + " " + season + " projected").toBe(projGP);
      expect(p.actual[String(season)]?.GP, name + " " + season + " actual").toBe(actualGP);
    }
  });
});

describe("durability: weighted history", () => {
  it("weights recent seasons 5/4/3", () => {
    expect(weightedHistory([60, 70, 80])).toBeCloseTo((5 * 60 + 4 * 70 + 3 * 80) / 12, 10);
    // A single season is just that season.
    expect(weightedHistory([50])).toBe(50);
    // No history at all.
    expect(weightedHistory([])).toBeNull();
  });

  it("counts a played-zero season but not an absent one", () => {
    // Two seasons of history, the most recent a wipeout, is a much worse
    // record than one good season and a year out of the league.
    const wipeout = weightedHistory([0, 70]) as number;
    const single = weightedHistory([70]) as number;
    expect(wipeout).toBeLessThan(single);
    expect(single).toBe(70);
  });
});

describe("durability: expected games", () => {
  const leagueMeanGP = 65;

  it("regresses a short history toward the league mean", () => {
    // One season at 78 is not a durability record; it should be pulled down.
    const one = expectedGames({ espnGP: 78, priorGP: [78], leagueMeanGP });
    const three = expectedGames({ espnGP: 78, priorGP: [78, 78, 78], leagueMeanGP });
    expect(one).toBeLessThan(three);
  });

  it("leans on history rather than on ESPN, at the fitted weight", () => {
    // w = 0.2, so a player ESPN likes but whose record says otherwise
    // lands much closer to the record.
    const d = durabilityDetail({ espnGP: 75, priorGP: [40, 45, 50], leagueMeanGP });
    expect(DURABILITY_W).toBeLessThan(0.5);
    expect(d.expectedGP).toBeLessThan(60);
    expect(d.histGP).toBeLessThan(60);
  });

  it("lets ESPN cap the estimate when it knows about a new injury", () => {
    // A durable player with a May Achilles tear: history says 72, ESPN
    // says 20. Averaging would produce a nonsense 60.
    const d = durabilityDetail({ espnGP: 20, priorGP: [72, 70, 74], leagueMeanGP });
    expect(d.overrideApplied).toBe(true);
    expect(d.expectedGP).toBeLessThanOrEqual(20);
  });

  it("does not let the override fire on a small disagreement", () => {
    const d = durabilityDetail({ espnGP: 66, priorGP: [72, 70, 74], leagueMeanGP });
    expect(d.overrideApplied).toBe(false);
  });

  it("ignores ESPN entirely for a suspect projection, rather than letting it cap the estimate", () => {
    // The Haliburton case. ESPN publishes 1 game for a player whose own
    // record says 70, which is a data error, not an injury report. The
    // override's trigger (ESPN far BELOW history) is exactly the shape of
    // a broken projection, so without the suspect guard the broken number
    // became a hard ceiling and the board showed "Exp GP 1" with a red
    // dot on a healthy star.
    const broken = { espnGP: 1, priorGP: [70, 69, 74], leagueMeanGP };

    const unguarded = durabilityDetail(broken);
    expect(unguarded.overrideApplied).toBe(true);
    expect(unguarded.expectedGP).toBeLessThanOrEqual(1);

    const guarded = durabilityDetail({ ...broken, suspect: true });
    expect(guarded.overrideApplied).toBe(false);
    // History only: no 20% of ESPN's 1 mixed in either.
    expect(guarded.expectedGP).toBeCloseTo(guarded.histGP as number, 10);
    expect(guarded.expectedGP).toBeGreaterThan(60);
    expect(durabilityBand(guarded.expectedGP)).not.toBe("red");
  });

  it("falls back to the league mean for a suspect projection with no history", () => {
    // A rookie ESPN projects for 2 games. There is no record to fall back
    // on, so the league mean is the honest placeholder; ESPN's 2 is not.
    const d = durabilityDetail({
      espnGP: 2,
      priorGP: [],
      leagueMeanGP,
      suspect: true,
    });
    expect(d.seasons).toBe(0);
    expect(d.expectedGP).toBe(leagueMeanGP);
  });

  it("still gives a suspect player with no NBA team zero games", () => {
    // The no-team rule outranks everything: no team, no games.
    const d = durabilityDetail({
      espnGP: 1,
      priorGP: [70, 70],
      leagueMeanGP,
      suspect: true,
      onTeam: false,
    });
    expect(d.expectedGP).toBe(0);
  });

  it("leaves the ranking alone, because a suspect player is charged a full season", () => {
    // seasonValueFor ignores expectedGP when suspect, so the fix above
    // moves the Exp GP column and the fit bonus without touching value.
    const histOnly = seasonValueFor(8, 2, 70, true);
    const broken = seasonValueFor(8, 2, 1, true);
    expect(histOnly).toBe(broken);
  });

  it("falls back to ESPN for a rookie", () => {
    const d = durabilityDetail({ espnGP: 70, priorGP: [], leagueMeanGP });
    expect(d.seasons).toBe(0);
    expect(d.expectedGP).toBe(70);
  });

  it("gives a player with no NBA team zero games, never a default", () => {
    expect(
      expectedGames({ espnGP: 70, priorGP: [70, 70], leagueMeanGP, onTeam: false }),
    ).toBe(0);
  });

  it("clamps to a sane range", () => {
    expect(clampGames(-5)).toBe(0);
    expect(clampGames(200)).toBe(78);
    expect(clampGames(Number.NaN)).toBe(0);
  });
});

describe("durability: the fit beats ESPN on games played", () => {
  // The A2 gate, run on the committed fixture so it cannot silently rot.
  function samplesFor(season: number): FitSample[] {
    const key = String(season);
    const pool = history.players.filter(
      (p) => (p.espnProjection[key]?.GP ?? 0) >= 20 && p.actual[key],
    );
    const priors = (p: HistoryPlayer): number[] => {
      const out: number[] = [];
      for (let s = season - 1; s >= season - 3; s--) {
        const line = p.actual[String(s)];
        if (line) out.push(line.GP);
      }
      return out;
    };
    const all = pool.flatMap((p) => priors(p));
    const leagueMeanGP = all.reduce((a, b) => a + b, 0) / Math.max(all.length, 1);
    return pool.map((p) => ({
      espnGP: (p.espnProjection[key] as SeasonLine).GP,
      priorGP: priors(p),
      leagueMeanGP,
      actualGP: (p.actual[key] as SeasonLine).GP,
    }));
  }

  it("beats ESPN alone in every fitted season", () => {
    for (const season of [2024, 2025, 2026]) {
      const samples = samplesFor(season);
      expect(samples.length).toBeGreaterThan(200);

      const blend =
        samples.reduce(
          (sum, s) =>
            sum +
            Math.abs(
              expectedGames(
                { espnGP: s.espnGP, priorGP: s.priorGP, leagueMeanGP: s.leagueMeanGP },
                { k: DURABILITY_K, w: DURABILITY_W },
              ) - s.actualGP,
            ),
          0,
        ) / samples.length;

      expect(blend, "season " + season).toBeLessThan(espnMAE(samples));
    }
  });

  it("re-fits to roughly the shipped constants", () => {
    const pooled = [2024, 2025, 2026].flatMap((s) => samplesFor(s));
    const fit = fitDurability(pooled);
    expect(fit.blendMAE).toBeLessThan(fit.espnMAE);
    expect(fit.blendMAE).toBeLessThan(fit.historyMAE);
    // The shipped values are the fitted ones; allow for grid resolution.
    expect(Math.abs(fit.w - DURABILITY_W)).toBeLessThanOrEqual(0.1);
  });
});

describe("value above replacement", () => {
  it("takes the replacement level one past the last rostered spot", () => {
    const rates = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    // poolSize 3 means three roster spots, so the 4th-best is replacement.
    expect(replacementLevel(rates, 3)).toBe(7);
    // A pool deeper than the player list clamps to the last player.
    expect(replacementLevel(rates, 999)).toBe(1);
  });

  it("scales value by games and lets a below-replacement player go negative", () => {
    const players = [
      { id: 1, rateValue: 10, expectedGP: 82 },
      { id: 2, rateValue: 10, expectedGP: 41 },
      { id: 3, rateValue: 2, expectedGP: 82 },
    ];
    const out = seasonValues(players, 2);
    // Replacement is the 3rd-best rate, which is 2.
    // Same rate, half the games, half the value.
    expect(out.get(2) as number).toBeCloseTo((out.get(1) as number) / 2, 10);
    // The replacement player himself is worth exactly zero.
    expect(out.get(3) as number).toBeCloseTo(0, 10);
  });

  it("goes negative below replacement, which the old discount could not express", () => {
    const out = seasonValues(
      [
        { id: 1, rateValue: 8, expectedGP: 82 },
        { id: 2, rateValue: 4, expectedGP: 82 },
        { id: 3, rateValue: 1, expectedGP: 82 },
      ],
      1,
    );
    // Replacement is the 2nd-best rate, 4. Player 3 is below it.
    expect(out.get(3) as number).toBeLessThan(0);
  });

  it("leaves a suspect projection on a full season rather than zeroing it", () => {
    // ESPN publishing a 1-game season for a healthy star is a data error.
    const real = seasonValueFor(8, 2, 1, false);
    const suspect = seasonValueFor(8, 2, 1, true);
    expect(suspect).toBeGreaterThan(real);
    expect(suspect).toBeCloseTo(8 - 2, 10);
  });
});
