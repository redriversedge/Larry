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
  MOCK_CANDIDATE_POOL_EARLY,
  MOCK_CANDIDATE_POOL_LATE,
  MOCK_REACH_R1_MAX,
  MOCK_REACH_R2_MAX,
} from "../../src/engine/constants";
import {
  checkModel,
  checkReachFrequency,
  combineEvals,
  buildHistoricalBoard,
  evaluateDraft,
  fitMockDraft,
  profilesBySeason,
  realReachFrequency,
  simulatedReachFrequency,
  type ReachFrequency,
} from "../../src/engine/draftFit";
import { buildAdpLookup, buildDraftProfiles } from "../../src/engine/draftProfiles";
import { candidatePoolFor, DEFAULT_MOCK_PARAMS } from "../../src/engine/mockDraft";
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

    // The fit starts from form-appropriate taus, not from the shipped
    // constants, so this compares against the shipped constants as a
    // reference point rather than as the literal starting value.
    expect(fit.fitEval.meanLogLik).toBeGreaterThan(atStart.meanLogLik);
    expect(fit.trace.length).toBeGreaterThan(0);
    expect(fit.params.rankForm).toBe("log");
    const numeric = ["tauEarly", "tauMid", "tauLate", "beta", "lambda", "gamma", "alpha"] as const;
    for (const key of numeric) {
      expect(Number.isFinite(fit.params[key])).toBe(true);
      expect(fit.params[key]).toBeGreaterThanOrEqual(0);
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
    expect(check.full.meanLogLik - check.baseline.meanLogLik).toBeGreaterThan(0.1);
  });

  it("has the category term cost exactly nothing when nobody has a preference", () => {
    // The property that makes lambda safe: with no category signal, every
    // premium's strength is "none", the weight is 0, and the term cannot
    // move a single pick. Isolated to lambda, because alpha is a separate
    // question (below).
    const league = flatLeague();
    const adpLookup = buildAdpLookup(league.adp);
    const profiles = buildDraftProfiles(league.history, league.adp, {
      asOfSeason: TEST,
    }).profiles;

    const lambdaOnly = { ...DEFAULT_MOCK_PARAMS, beta: 0, gamma: 0, alpha: 0 };
    const withTerm = evaluateDraft(league.history, TEST, adpLookup, profiles, lambdaOnly);
    const without = evaluateDraft(league.history, TEST, adpLookup, profiles, {
      ...lambdaOnly,
      lambda: 0,
    });
    expect(withTerm.meanLogLik).toBeCloseTo(without.meanLogLik, 10);
  });

  it("earns its keep from the category term when there IS a preference", () => {
    const league = tastefulLeague();
    const adpLookup = buildAdpLookup(league.adp);
    const profiles = buildDraftProfiles(league.history, league.adp, {
      asOfSeason: TEST,
    }).profiles;

    const lambdaOnly = { ...DEFAULT_MOCK_PARAMS, beta: 0, gamma: 0, alpha: 0 };
    const withTerm = evaluateDraft(league.history, TEST, adpLookup, profiles, lambdaOnly);
    const without = evaluateDraft(league.history, TEST, adpLookup, profiles, {
      ...lambdaOnly,
      lambda: 0,
    });
    expect(withTerm.meanLogLik - without.meanLogLik).toBeGreaterThan(0.1);
  });

  // There is deliberately NO test here that the shipped lambda is optimal.
  // On this generator a larger lambda scores better, because its managers
  // have far stronger and cleaner category preferences than real ones do
  // (they take the best player for a category inside a 4-pick window, every
  // single pick). The shipped lambda of 0.84 is fitted on the real drafts,
  // where the ablation is +0.005. Synthetic data cannot adjudicate that,
  // and a test asserting it would only be pinning the fixture's quirks.

  it("costs almost nothing overall on a league with no signal of any kind", () => {
    // Not exactly nothing: alpha is nonzero, and a by-the-board drafter
    // still accumulates 4+ players from some team at twice the league rate
    // across eight seasons by chance, so the affinity term fires on noise.
    // The point is that the cost is negligible, well under the 0.28 nats
    // the same weights GAIN when there is a real preference to find.
    //
    // Nothing stronger than this can be asserted about alpha from
    // synthetic data; see the proTeamId note in draftFixtures.ts. The real
    // ablation on the owner's drafts put alpha at +0.015.
    const league = flatLeague();
    const check = checkModel(league.history, TEST, league.adp, DEFAULT_MOCK_PARAMS);
    const cost = check.baseline.meanLogLik - check.full.meanLogLik;
    expect(cost).toBeGreaterThanOrEqual(0);
    expect(cost).toBeLessThan(0.02);
  });
});

describe("reach frequency", () => {
  it("scores a by-the-board league at zero and a 25-slot reacher at one", () => {
    const board = makeLeague({ seasons: [TEST], categoryNoise: 0, strategies: {} });
    const zero = realReachFrequency(board.history, [TEST], buildAdpLookup(board.adp));
    expect(zero.r1).toBe(0);
    expect(zero.r2).toBe(0);
    expect(zero.r35).toBe(0);
    // Denominators are real: the bands were measured, not skipped.
    expect(zero.n1).toBeGreaterThan(0);
    expect(zero.n35).toBeGreaterThan(zero.n1);

    // Every manager takes the player 25 slots down the board, so every pick
    // is a reach of about 25, comfortably past the 20-slot threshold.
    const reachers = makeLeague({
      seasons: [TEST],
      categoryNoise: 0,
      strategies: Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [
          "M" + (i + 1),
          ({ available }: { available: unknown[] }) => Math.min(25, available.length - 1),
        ]),
      ),
    });
    const all = realReachFrequency(reachers.history, [TEST], buildAdpLookup(reachers.adp));
    expect(all.r1).toBe(1);
    expect(all.r2).toBe(1);
    expect(all.r35).toBe(1);
  });

  it("leaves out picks with no ESPN ADP rather than counting them as not-reaches", () => {
    const league = makeLeague({ seasons: [TEST], categoryNoise: 0, strategies: {} });
    const trimmed = { [String(TEST)]: (league.adp[String(TEST)] || []).slice(0, 40) };
    const full = realReachFrequency(league.history, [TEST], buildAdpLookup(league.adp));
    const partial = realReachFrequency(league.history, [TEST], buildAdpLookup(trimmed));
    expect(partial.n1 + partial.n2 + partial.n35).toBeLessThan(full.n1 + full.n2 + full.n35);
    expect(partial.n1).toBeGreaterThan(0);
  });

  it("reaches less often with a tighter candidate pool, which is the whole fix", () => {
    // The causal claim behind MOCK_CANDIDATE_POOL_EARLY. Each deep
    // candidate is individually unlikely, but over a wide pool their
    // combined softmax mass produces reaches; narrowing the pool removes
    // that mass. If this inverts, the pool constants are not doing what
    // their comment says.
    const league = tastefulLeague();
    const adpLookup = buildAdpLookup(league.adp);
    const profiles = profilesBySeason(league.history, [TEST], league.adp);

    const sweep = [120, 40, 24].map((pool) =>
      simulatedReachFrequency(
        league.history,
        [TEST],
        adpLookup,
        profiles,
        DEFAULT_MOCK_PARAMS,
        20,
        pool,
      ),
    );
    const [wide, mid, tight] = sweep as [
      ReturnType<typeof simulatedReachFrequency>,
      ReturnType<typeof simulatedReachFrequency>,
      ReturnType<typeof simulatedReachFrequency>,
    ];

    expect(wide.r35).toBeGreaterThan(mid.r35);
    expect(mid.r35).toBeGreaterThan(tight.r35);
    expect(wide.r2).toBeGreaterThan(tight.r2);
  });

  it("keeps rounds 1 and 2 under their ceilings at the shipped parameters", () => {
    // The R3-5 band is NOT asserted here. This generator's managers barely
    // reach at all (real R3-5 is 0% on it, against 14% in the real
    // league), so the tolerance band is meaningless on synthetic data. The
    // round 1 and 2 ceilings are absolute, so they do carry over.
    const league = tastefulLeague();
    const simulated = simulatedReachFrequency(
      league.history,
      [TEST],
      buildAdpLookup(league.adp),
      profilesBySeason(league.history, [TEST], league.adp),
      DEFAULT_MOCK_PARAMS,
      30,
    );
    expect(simulated.r1).toBeLessThanOrEqual(MOCK_REACH_R1_MAX);
    expect(simulated.r2).toBeLessThanOrEqual(MOCK_REACH_R2_MAX);
  });

  it("applies the gate's three conditions independently", () => {
    const real: ReachFrequency = { r1: 0, r2: 0.03, r35: 0.14, n1: 96, n2: 96, n35: 288 };
    const pass = checkReachFrequency(real, {
      r1: 0.007,
      r2: 0.023,
      r35: 0.145,
      n1: 1,
      n2: 1,
      n35: 1,
    });
    expect(pass.pass).toBe(true);

    // Round 1 over its ceiling.
    expect(
      checkReachFrequency(real, { r1: 0.067, r2: 0.023, r35: 0.14, n1: 1, n2: 1, n35: 1 }).r1Pass,
    ).toBe(false);
    // Round 2 over its ceiling.
    expect(
      checkReachFrequency(real, { r1: 0.0, r2: 0.17, r35: 0.14, n1: 1, n2: 1, n35: 1 }).r2Pass,
    ).toBe(false);
    // Rounds 3 to 5 outside the tolerance band, in either direction.
    expect(
      checkReachFrequency(real, { r1: 0, r2: 0.03, r35: 0.36, n1: 1, n2: 1, n35: 1 }).r35Pass,
    ).toBe(false);
    expect(
      checkReachFrequency(real, { r1: 0, r2: 0.03, r35: 0.045, n1: 1, n2: 1, n35: 1 }).r35Pass,
    ).toBe(false);
    // Inside it. Not tested at exactly 0.05 of separation: 0.14 - 0.09 is
    // 0.050000000000000016 in binary floating point, so the boundary case
    // is a float question rather than a behaviour question.
    expect(
      checkReachFrequency(real, { r1: 0, r2: 0.03, r35: 0.1, n1: 1, n2: 1, n35: 1 }).r35Pass,
    ).toBe(true);
  });
});

describe("candidate pool and the likelihood", () => {
  it("caps the pool by round, tight early and looser from round 3", () => {
    expect(candidatePoolFor(1)).toBe(MOCK_CANDIDATE_POOL_EARLY);
    expect(candidatePoolFor(2)).toBe(MOCK_CANDIDATE_POOL_EARLY);
    expect(candidatePoolFor(3)).toBe(MOCK_CANDIDATE_POOL_LATE);
    expect(candidatePoolFor(12)).toBe(MOCK_CANDIDATE_POOL_LATE);
    expect(MOCK_CANDIDATE_POOL_EARLY).toBeLessThan(MOCK_CANDIDATE_POOL_LATE);
  });

  it("reports how much of the real data falls inside the pool", () => {
    const league = tastefulLeague();
    const profiles = buildDraftProfiles(league.history, league.adp, {
      asOfSeason: TEST,
    }).profiles;
    const result = evaluateDraft(
      league.history,
      TEST,
      buildAdpLookup(league.adp),
      profiles,
      DEFAULT_MOCK_PARAMS,
    );
    expect(result.poolCoverage).toBeGreaterThan(0);
    expect(result.poolCoverage).toBeLessThanOrEqual(1);
  });

  it("scores a pick outside the pool with its uncapped probability, not as impossible", () => {
    // Half the managers draft the board and half reach 50 slots deep.
    //
    // Both halves are needed. If EVERY manager reached, the top of the
    // board would never be drafted at all, so those players would not be
    // in season.players and would not be on the historical board, and the
    // reacher's pick would come out as the best available after all. The
    // board-drafters are what keep the better players on the board and
    // genuinely push the reachers' picks outside the cap.
    const deep = makeLeague({
      seasons: [TEST],
      categoryNoise: 0,
      strategies: Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [
          "M" + (i + 1),
          i % 2 === 0
            ? byRank
            : ({ available }: { available: unknown[] }) =>
                Math.min(50, available.length - 1),
        ]),
      ),
    });
    const result = evaluateDraft(
      deep.history,
      TEST,
      buildAdpLookup(deep.adp),
      buildDraftProfiles(deep.history, deep.adp, { asOfSeason: TEST }).profiles,
      DEFAULT_MOCK_PARAMS,
    );

    expect(result.picks).toBeGreaterThan(100);
    expect(Number.isFinite(result.meanLogLik)).toBe(true);
    // A meaningful share of picks fell outside the pool, which is the case
    // the fallback exists for.
    expect(result.poolCoverage).toBeLessThan(0.95);
    expect(result.poolCoverage).toBeGreaterThan(0.1);
    // And the score is not the degenerate floor: log(1e-12) is about -27.6,
    // so a run of "impossible" picks would drag the mean well past -20.
    expect(result.meanLogLik).toBeGreaterThan(-20);
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
