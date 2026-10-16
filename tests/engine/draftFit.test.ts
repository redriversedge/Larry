// Fitting and scoring the mock-draft model, docs/DRAFT_ROOM_SPEC.md s4.1.
//
// The real fit runs on the owner's league history, which cannot live in a
// public repo. These tests use the synthetic generator instead, which is
// enough to prove the machinery: that the likelihood responds to a real
// preference, that the model beats a rank-only baseline when there IS
// something to learn, that it does not when there is not, and that profiles
// never see the season being predicted.

import { describe, expect, it } from "vitest";

import {
  checkModel,
  combineEvals,
  buildHistoricalBoard,
  evaluateDraft,
  fitMockDraft,
  profilesBySeason,
} from "../../src/engine/draftFit";
import { buildAdpLookup, buildDraftProfiles } from "../../src/engine/draftProfiles";
import { DEFAULT_MOCK_PARAMS } from "../../src/engine/mockDraft";
import { byRank, highestInWindow, makeLeague } from "./draftFixtures";

const SEASONS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const FIT = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const TEST = 2026;

describe("buildHistoricalBoard", () => {
  it("reads ADP from the history file, not from the stored ESPN rank", () => {
    // Stored espnRank is 1 for everyone, as it is for a finished season.
    const league = makeLeague({
      seasons: [TEST],
      categoryNoise: 0,
      espnRankFor: () => 1,
    });
    const board = buildHistoricalBoard(league.history, TEST, buildAdpLookup(league.adp));

    expect(board.length).toBeGreaterThan(100);
    const adps = board.map((p) => p.espnAdp).filter((v) => v !== null);
    expect(adps.length).toBe(board.length);
    // A real spread of ADPs, not 144 copies of 1.
    expect(new Set(adps).size).toBeGreaterThan(100);
    for (const player of board) expect(player.espnDraftRank).toBe(1);
  });

  it("leaves ADP null for a player missing from the file", () => {
    const league = makeLeague({ seasons: [TEST], categoryNoise: 0 });
    const trimmed = { [String(TEST)]: (league.adp[String(TEST)] || []).slice(0, 20) };
    const board = buildHistoricalBoard(league.history, TEST, buildAdpLookup(trimmed));
    expect(board.filter((p) => p.espnAdp === null).length).toBeGreaterThan(0);
    expect(board.filter((p) => p.espnAdp !== null).length).toBe(20);
  });
});

describe("evaluateDraft", () => {
  it("scores a real draft and returns a usable likelihood", () => {
    const league = makeLeague({ seasons: [TEST] });
    const profiles = buildDraftProfiles(league.history, league.adp).profiles;
    const result = evaluateDraft(
      league.history,
      TEST,
      buildAdpLookup(league.adp),
      profiles,
      DEFAULT_MOCK_PARAMS,
    );

    expect(result.picks).toBeGreaterThan(100);
    expect(result.meanLogLik).toBeLessThan(0);
    expect(Number.isFinite(result.meanLogLik)).toBe(true);
    expect(result.top1).toBeGreaterThan(0);
    expect(result.top5).toBeGreaterThanOrEqual(result.top1);
    expect(result.top5).toBeLessThanOrEqual(1);
  });

  it("scores a by-the-board draft better than the same model scores a chaotic one", () => {
    const orderly = makeLeague({ seasons: [TEST], categoryNoise: 0, strategies: {} });
    // Every manager reaches 30 slots down the board at random, which the
    // rank term cannot explain.
    const chaotic = makeLeague({
      seasons: [TEST],
      categoryNoise: 0,
      strategies: {
        ...Object.fromEntries(
          Array.from({ length: 12 }, (_, i) => [
            "M" + (i + 1),
            ({ available, overall }: { available: unknown[]; overall: number }) =>
              Math.min((overall * 7) % 30, available.length - 1),
          ]),
        ),
      },
    });

    const score = (league: ReturnType<typeof makeLeague>): number =>
      evaluateDraft(
        league.history,
        TEST,
        buildAdpLookup(league.adp),
        buildDraftProfiles(league.history, league.adp).profiles,
        DEFAULT_MOCK_PARAMS,
      ).meanLogLik;

    expect(score(orderly)).toBeGreaterThan(score(chaotic));
  });
});

describe("fitMockDraft", () => {
  it("improves on the starting parameters", () => {
    const league = makeLeague({ seasons: FIT });
    const fit = fitMockDraft(league.history, FIT, league.adp, { iterations: 2 });

    const atStart = combineEvals(
      FIT.map((seasonId) =>
        evaluateDraft(
          league.history,
          seasonId,
          buildAdpLookup(league.adp),
          profilesBySeason(league.history, [seasonId], league.adp)[seasonId] || {},
          DEFAULT_MOCK_PARAMS,
        ),
      ),
    );

    expect(fit.fitEval.meanLogLik).toBeGreaterThanOrEqual(atStart.meanLogLik);
    expect(fit.trace.length).toBeGreaterThan(0);
    for (const value of Object.values(fit.params)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("holds every profile term at zero for the rank-only baseline", () => {
    const league = makeLeague({ seasons: FIT });
    const baseline = fitMockDraft(league.history, FIT, league.adp, {
      rankOnly: true,
      iterations: 2,
    });
    expect(baseline.params.beta).toBe(0);
    expect(baseline.params.lambda).toBe(0);
    expect(baseline.params.gamma).toBe(0);
    expect(baseline.params.alpha).toBe(0);
    // tau is still free to move.
    expect(baseline.params.tauEarly).toBeGreaterThan(0);
  });
});

// A league where seven of twelve managers draft for a specific category,
// and one that nobody has any preference in. The shipped weights have to
// help on the first and cost nothing on the second; see the ablation table
// against MOCK_LAMBDA in src/engine/constants.ts.
function tastefulLeague(): ReturnType<typeof makeLeague> {
  return makeLeague({
    seasons: SEASONS,
    strategies: {
      M1: highestInWindow("pts", 4),
      M2: highestInWindow("reb", 4),
      M3: highestInWindow("ast", 4),
      M4: highestInWindow("blk", 4),
      M5: highestInWindow("stl", 4),
      M6: highestInWindow("pts", 4),
      M7: byRank,
    },
  });
}

function flatLeague(): ReturnType<typeof makeLeague> {
  return makeLeague({ seasons: SEASONS, categoryNoise: 0, strategies: {} });
}

describe("checkModel", () => {
  it("beats the rank-only baseline at the shipped weights when managers have category tastes", () => {
    const league = tastefulLeague();
    const check = checkModel(league.history, TEST, league.adp, DEFAULT_MOCK_PARAMS);

    expect(check.season).toBe(TEST);
    expect(check.full.picks).toBeGreaterThan(100);
    expect(check.beatsBaseline).toBe(true);
    // Worth a real margin, not a rounding win.
    expect(check.full.meanLogLik - check.baseline.meanLogLik).toBeGreaterThan(0.2);
  });

  it("costs nothing at the shipped weights when nobody has a preference", () => {
    // This is the property that makes the weights safe to ship unfitted: a
    // league with no category signal must score exactly the same as
    // rank-only. It is why alpha ships at 0 (NBA team affinity fires on
    // chance affinities and made this case WORSE) and why lambda was not
    // scaled up alongside tau.
    const league = flatLeague();
    const check = checkModel(league.history, TEST, league.adp, DEFAULT_MOCK_PARAMS);
    expect(check.full.meanLogLik).toBeCloseTo(check.baseline.meanLogLik, 6);
  });

  it("gets worse, not better, if the category weight is scaled up with tau", () => {
    // Guards the reasoning in constants.ts: tau was cut by 3 and lambda was
    // deliberately NOT multiplied by 3 to match. If someone "restores the
    // spec's ratio" later, this fails.
    const league = tastefulLeague();
    const shipped = checkModel(league.history, TEST, league.adp, DEFAULT_MOCK_PARAMS);
    const scaledUp = checkModel(league.history, TEST, league.adp, {
      ...DEFAULT_MOCK_PARAMS,
      lambda: DEFAULT_MOCK_PARAMS.lambda * 3,
      gamma: DEFAULT_MOCK_PARAMS.gamma * 3,
    });
    expect(scaledUp.full.meanLogLik).toBeLessThan(shipped.full.meanLogLik);
    expect(scaledUp.full.meanLogLik).toBeLessThan(shipped.baseline.meanLogLik);
  });

  it("gets worse if NBA team affinity is given any weight", () => {
    // The other half of the constants.ts reasoning: alpha ships at 0.
    const league = flatLeague();
    const shipped = checkModel(league.history, TEST, league.adp, DEFAULT_MOCK_PARAMS);
    const withAffinity = checkModel(league.history, TEST, league.adp, {
      ...DEFAULT_MOCK_PARAMS,
      alpha: 3,
    });
    expect(DEFAULT_MOCK_PARAMS.alpha).toBe(0);
    expect(withAffinity.full.meanLogLik).toBeLessThan(shipped.full.meanLogLik);
  });
});

describe("no leakage", () => {
  it("builds each season's profiles from prior seasons only", () => {
    const league = makeLeague({ seasons: SEASONS });
    const bySeason = profilesBySeason(league.history, [2021, TEST], league.adp);

    const early = bySeason[2021]?.["M1"];
    const late = bySeason[TEST]?.["M1"];
    if (!early || !late) throw new Error("missing profile");

    expect(early.seasons).toEqual([2019, 2020]);
    expect(late.seasons).toEqual(FIT);
    expect(early.seasons).not.toContain(2021);
    expect(late.seasons).not.toContain(TEST);
  });

  it("gives the first fit season no profiles at all, since nothing precedes it", () => {
    const league = makeLeague({ seasons: SEASONS });
    const first = profilesBySeason(league.history, [2019], league.adp)[2019];
    expect(Object.keys(first || {})).toEqual([]);
  });
});
