// Draft Room AI pick model, docs/DRAFT_ROOM_SPEC.md s4 and s8.
// All data synthetic. See tests/engine/draftFixtures.ts for why.

import { describe, expect, it } from "vitest";

import type { ManagerProfile } from "../../src/engine/draftProfiles";
import {
  availableIdsFor,
  bestAvailableByLarry,
  decidePick,
  emptyAvailabilityCounts,
  mixSeed,
  mulberry32,
  myUpcomingPicks,
  nextPickIndex,
  prepareBoard,
  rankOf,
  reachShrunk,
  roundForIndex,
  runAvailabilitySims,
  simulateUntil,
  snakeOrder,
  softmax,
  tauFor,
  type MockDraftConfig,
  type MockPlayer,
  type MockState,
} from "../../src/engine/mockDraft";
import {
  makeBoard,
  makePool,
  makeProfile,
  makeSnakeOrder,
} from "./draftFixtures";

const TEAMS = 12;
const ROUNDS = 12;

function flatProfiles(profile?: ManagerProfile | null): Record<string, ManagerProfile | null> {
  const out: Record<string, ManagerProfile | null> = {};
  for (let t = 1; t <= TEAMS; t++) out[String(t)] = profile ?? makeProfile();
  return out;
}

function makeConfig(overrides: Partial<MockDraftConfig> = {}): MockDraftConfig {
  const players = makeBoard(makePool({ count: 300, seed: 11, categoryNoise: 0.35 }));
  return {
    order: makeSnakeOrder(TEAMS, ROUNDS),
    teamCount: TEAMS,
    players,
    profileByTeam: flatProfiles(),
    leagueReach: { early: 0, mid: 0, late: 0 },
    ...overrides,
  };
}

function freshState(seed: number): MockState {
  return { seed, picks: [] };
}

describe("mulberry32 and mixSeed", () => {
  it("is reproducible for a given seed and diverges for different seeds", () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    const c = mulberry32(1235);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    const seqC = [c(), c(), c()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("gives each pick number its own stream", () => {
    expect(mixSeed(99, 1)).not.toBe(mixSeed(99, 2));
    expect(mixSeed(99, 1)).toBe(mixSeed(99, 1));
  });
});

describe("determinism", () => {
  it("produces the same draft from the same seed and a different one from a different seed", () => {
    const config = makeConfig();
    const board = prepareBoard(config);

    const first = simulateUntil(board, config, freshState(777), null);
    const second = simulateUntil(board, config, freshState(777), null);
    const other = simulateUntil(board, config, freshState(778), null);

    expect(first.state.picks).toEqual(second.state.picks);
    expect(first.state.picks).not.toEqual(other.state.picks);
    expect(first.state.picks.length).toBe(TEAMS * ROUNDS);
  });

  it("reproduces the same picks after an undo, because each pick seeds off its own slot", () => {
    const config = makeConfig();
    const board = prepareBoard(config);

    const full = simulateUntil(board, config, freshState(42), null, 20);
    // Undo the last five picks and re-simulate them.
    const rewound: MockState = {
      seed: full.state.seed,
      picks: full.state.picks.slice(0, 15),
    };
    const redone = simulateUntil(board, config, rewound, null, 5);

    expect(redone.state.picks).toEqual(full.state.picks);
  });
});

describe("rank-only behaviour", () => {
  it("picks in exact rank order with every profile term switched off and a tiny tau", () => {
    const config = makeConfig({
      params: {
        tauEarly: 0.01,
        tauMid: 0.01,
        tauLate: 0.01,
        beta: 0,
        lambda: 0,
        gamma: 0,
        alpha: 0,
      },
    });
    const board = prepareBoard(config);
    const result = simulateUntil(board, config, freshState(5), null);

    // ADP equals board position in the fixture, so rank order is 1, 2, 3...
    const ranks = result.state.picks.map((p) => rankOf(
      config.players.find((x) => x.playerId === p[2]) as MockPlayer,
    ));
    const expected = Array.from({ length: TEAMS * ROUNDS }, (_, i) => i + 1);
    expect(ranks).toEqual(expected);
  });

  it("falls back through ESPN draft rank, then Larry rank, then 400", () => {
    const base: MockPlayer = {
      playerId: 1,
      name: "Alpha Ashford",
      posId: 1,
      proTeamId: 1,
      espnAdp: 12,
      espnDraftRank: 30,
      larryRank: 44,
      perGame: { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 },
    };
    expect(rankOf(base)).toBe(12);
    expect(rankOf({ ...base, espnAdp: null })).toBe(30);
    expect(rankOf({ ...base, espnAdp: null, espnDraftRank: null })).toBe(44);
    expect(rankOf({ ...base, espnAdp: null, espnDraftRank: null, larryRank: null })).toBe(400);
    // ESPN writes 0 for "no ADP" as often as null.
    expect(rankOf({ ...base, espnAdp: 0, espnDraftRank: 0, larryRank: 0 })).toBe(400);
  });

  it("treats a null profile as rank-only rather than crashing", () => {
    const config = makeConfig({ profileByTeam: {} });
    const board = prepareBoard(config);
    const result = simulateUntil(board, config, freshState(3), null);
    expect(result.state.picks.length).toBe(TEAMS * ROUNDS);
  });
});

describe("category taste", () => {
  it("takes the higher-PTS player between two adjacent-rank players more often than not", () => {
    // Two players, one slot apart on the board. One scores well above the
    // pool, the other well below. Everything else is identical.
    const players: MockPlayer[] = [
      {
        playerId: 1,
        name: "Alpha Ashford",
        posId: 1,
        proTeamId: 1,
        espnAdp: 20,
        espnDraftRank: 20,
        larryRank: 20,
        perGame: { REB: 5, AST: 5, STL: 1, BLK: 1, PTS: 14 },
      },
      {
        playerId: 2,
        name: "Bravo Brennan",
        posId: 2,
        proTeamId: 2,
        espnAdp: 21,
        espnDraftRank: 21,
        larryRank: 21,
        perGame: { REB: 5, AST: 5, STL: 1, BLK: 1, PTS: 26 },
      },
    ];
    // Reference pool so the z-scores have a scale to sit on.
    const filler = makeBoard(makePool({ count: 200, seed: 3, categoryNoise: 0.3 })).map(
      (p, i) => ({ ...p, playerId: 100 + i, espnAdp: 30 + i, espnDraftRank: 30 + i, larryRank: 30 + i }),
    );

    const ptsLover = makeProfile({
      premium: { PTS: { premium: 0.45, strength: "strong" } },
    });

    const config: MockDraftConfig = {
      order: [1],
      teamCount: 1,
      players: [...players, ...filler],
      profileByTeam: { "1": ptsLover },
      leagueReach: { early: 0, mid: 0, late: 0 },
    };
    const board = prepareBoard(config);

    let higherPts = 0;
    const draws = 1000;
    for (let i = 0; i < draws; i++) {
      const available = new Set([1, 2]);
      const decision = decidePick(board, config, freshState(i + 1), 0, available);
      if (decision?.playerId === 2) higherPts++;
    }
    expect(higherPts).toBeGreaterThan(draws / 2);

    // And the opposite taste flips it, which is what proves the premium
    // sign is doing the work rather than the rank tie-break.
    const ptsPunter = makeProfile({
      premium: { PTS: { premium: -0.45, strength: "strong" } },
    });
    const punterConfig: MockDraftConfig = { ...config, profileByTeam: { "1": ptsPunter } };
    let punterHigherPts = 0;
    for (let i = 0; i < draws; i++) {
      const available = new Set([1, 2]);
      const decision = decidePick(board, punterConfig, freshState(i + 1), 0, available);
      if (decision?.playerId === 2) punterHigherPts++;
    }
    expect(punterHigherPts).toBeLessThan(higherPts);
  });

  it("ignores a weak signal entirely", () => {
    // Same large premium, but strength "none": the AI must not read it.
    const weak = makeProfile({ premium: { PTS: { premium: 0.45, strength: "none" } } });
    const strong = makeProfile({ premium: { PTS: { premium: 0.45, strength: "strong" } } });

    const config = makeConfig({ profileByTeam: flatProfiles(weak) });
    const rankOnly = makeConfig({ profileByTeam: flatProfiles(makeProfile()) });
    const strongConfig = makeConfig({ profileByTeam: flatProfiles(strong) });

    const weakDraft = simulateUntil(prepareBoard(config), config, freshState(9), null, 24);
    const rankDraft = simulateUntil(prepareBoard(rankOnly), rankOnly, freshState(9), null, 24);
    const strongDraft = simulateUntil(
      prepareBoard(strongConfig),
      strongConfig,
      freshState(9),
      null,
      24,
    );

    expect(weakDraft.state.picks).toEqual(rankDraft.state.picks);
    expect(strongDraft.state.picks).not.toEqual(rankDraft.state.picks);
  });
});

describe("tau and reach", () => {
  it("shrinks a manager's phase reach toward the league median by n / (n + 15)", () => {
    const league = { early: 0, mid: 10, late: 0 };
    // n = 15 gives exactly half weight.
    const halfWeight = makeProfile({ reach: { mid: 30, n: 15 } });
    expect(reachShrunk(halfWeight, "mid", league)).toBeCloseTo(0.5 * 30 + 0.5 * 10, 6);

    // A manager with no picks at all is the league median.
    const noPicks = makeProfile({ reach: { mid: 30, n: 0 } });
    expect(reachShrunk(noPicks, "mid", league)).toBe(10);

    // So is a manager with no ADP overlap.
    const noOverlap = makeProfile({ reach: { mid: null, n: 0 } });
    expect(reachShrunk(noOverlap, "mid", league)).toBe(10);

    // And no profile at all.
    expect(reachShrunk(null, "mid", league)).toBe(10);
  });

  it("raises tau for a reacher, so they leave the board more often", () => {
    const params = {
      tauEarly: 6,
      tauMid: 10,
      tauLate: 18,
      beta: 0.04,
      lambda: 4,
      gamma: 3,
      alpha: 1,
    };
    const league = { early: 0, mid: 0, late: 0 };
    const boardDrafter = makeProfile({ reach: { mid: 0, n: 90 } });
    const reacher = makeProfile({ reach: { mid: 26, n: 90 } });

    expect(tauFor(boardDrafter, "mid", league, params)).toBeCloseTo(10, 6);
    expect(tauFor(reacher, "mid", league, params)).toBeGreaterThan(10);

    // Phases are ordered: late rounds are looser than early ones.
    expect(tauFor(boardDrafter, "early", league, params)).toBeLessThan(
      tauFor(boardDrafter, "mid", league, params),
    );
    expect(tauFor(boardDrafter, "mid", league, params)).toBeLessThan(
      tauFor(boardDrafter, "late", league, params),
    );
  });
});

describe("draft integrity", () => {
  it("drafts nobody twice and follows the snake order exactly", () => {
    const config = makeConfig();
    const board = prepareBoard(config);
    const result = simulateUntil(board, config, freshState(2024), null);

    const ids = result.state.picks.map((p) => p[2]);
    expect(new Set(ids).size).toBe(ids.length);

    result.state.picks.forEach((pick, index) => {
      expect(pick[0]).toBe(index + 1);
      expect(pick[1]).toBe(config.order[index]);
    });

    // Round 1 runs 1..12, round 2 runs 12..1.
    expect(config.order.slice(0, TEAMS)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(config.order.slice(TEAMS, TEAMS * 2)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    ]);
  });

  it("stops when the user's team is on the clock", () => {
    const config = makeConfig();
    const board = prepareBoard(config);
    // Team 5 picks 5th overall, so the AI should make 4 picks and stop.
    const result = simulateUntil(board, config, freshState(1), 5);
    expect(result.state.picks.length).toBe(4);
    expect(config.order[result.state.picks.length]).toBe(5);
  });

  it("restores the exact prior state on undo", () => {
    const config = makeConfig();
    const board = prepareBoard(config);

    const before = simulateUntil(board, config, freshState(8), null, 10).state;
    const snapshot = JSON.parse(JSON.stringify(before)) as MockState;

    const after = simulateUntil(board, config, before, null, 1).state;
    expect(after.picks.length).toBe(11);
    // The simulate call must not have mutated the state it was handed.
    expect(before).toEqual(snapshot);

    const undone: MockState = { seed: after.seed, picks: after.picks.slice(0, -1) };
    expect(undone).toEqual(snapshot);
    expect(availableIdsFor(board, undone).size).toBe(
      availableIdsFor(board, after).size + 1,
    );
  });

  it("maps overall pick numbers to rounds", () => {
    expect(roundForIndex(0, 12)).toBe(1);
    expect(roundForIndex(11, 12)).toBe(1);
    expect(roundForIndex(12, 12)).toBe(2);
    expect(roundForIndex(119, 12)).toBe(10);
  });

  it("snakes a round-1 order when ESPN has not published slots", () => {
    expect(snakeOrder([1, 2, 3], 3)).toEqual([1, 2, 3, 3, 2, 1, 1, 2, 3]);
  });

  it("finds a team's upcoming picks", () => {
    const order = makeSnakeOrder(TEAMS, ROUNDS);
    expect(nextPickIndex(order, 3, 0)).toBe(2);
    // Team 3 picks 3rd in round 1 and 10th in round 2 (index 21).
    expect(myUpcomingPicks(order, 3, 0).slice(0, 2)).toEqual([2, 21]);
    expect(nextPickIndex(order, 3, 3)).toBe(21);
  });
});

describe("position overload", () => {
  it("never lets an AI manager finish rounds 1 to 10 with more than 5 at one position", () => {
    const config = makeConfig({ order: makeSnakeOrder(TEAMS, 10) });
    const board = prepareBoard(config);

    let worst = 0;
    for (let sim = 0; sim < 200; sim++) {
      const result = simulateUntil(board, config, freshState(sim + 1), null);
      const counts = new Map<string, number>();
      for (const pick of result.state.picks) {
        const player = board.byId.get(pick[2]);
        if (!player) continue;
        const key = pick[1] + ":" + player.player.posId;
        const next = (counts.get(key) || 0) + 1;
        counts.set(key, next);
        if (next > worst) worst = next;
      }
    }
    expect(worst).toBeLessThanOrEqual(5);
  });
});

describe("availability odds", () => {
  it("has the top pick gone and a deep player still there at the user's next pick", () => {
    const config = makeConfig();
    const board = prepareBoard(config);
    // Team 10 picks 10th overall, so nine AI picks happen first.
    const myTeamId = 10;
    const counts = runAvailabilitySims(
      board,
      config,
      freshState(1),
      myTeamId,
      0,
      200,
      emptyAvailabilityCounts(),
    );

    expect(counts.sims).toBe(200);

    const topId = board.rankOrder[0] as number;
    const deepId = board.rankOrder[299] as number;

    expect(counts.atNext.get(topId) || 0).toBe(0);
    expect((counts.atNext.get(deepId) || 0) / counts.sims).toBeGreaterThan(0.99);

    // A player right around the turn is genuinely uncertain, which is the
    // whole point of the column.
    const bubbleId = board.rankOrder[9] as number;
    const share = (counts.atNext.get(bubbleId) || 0) / counts.sims;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
  });

  it("accumulates across chunks the way the UI runs it", () => {
    const config = makeConfig();
    const board = prepareBoard(config);
    const state = freshState(4);

    const whole = runAvailabilitySims(
      board,
      config,
      state,
      10,
      0,
      100,
      emptyAvailabilityCounts(),
    );

    let chunked = emptyAvailabilityCounts();
    for (let offset = 0; offset < 100; offset += 50) {
      chunked = runAvailabilitySims(board, config, state, 10, offset, 50, chunked);
    }

    expect(chunked.sims).toBe(whole.sims);
    // Same seeds in the same order, so the counts must agree exactly.
    expect(Array.from(chunked.atNext.entries()).sort()).toEqual(
      Array.from(whole.atNext.entries()).sort(),
    );
  });

  it("is less likely to have a player survive to the pick after next", () => {
    const config = makeConfig();
    const board = prepareBoard(config);
    const counts = runAvailabilitySims(
      board,
      config,
      freshState(6),
      10,
      0,
      200,
      emptyAvailabilityCounts(),
    );

    // Pick 10 then pick 15 of round 2: more players come off the board in
    // between, so nobody can be MORE available later.
    let checked = 0;
    for (const id of board.rankOrder.slice(0, 40)) {
      const next = counts.atNext.get(id) || 0;
      const second = counts.atSecond.get(id) || 0;
      expect(second).toBeLessThanOrEqual(next);
      checked++;
    }
    expect(checked).toBe(40);
  });

  it("returns empty counts when the user has no picks left", () => {
    const config = makeConfig();
    const board = prepareBoard(config);
    const done = simulateUntil(board, config, freshState(1), null).state;
    const counts = runAvailabilitySims(
      board,
      config,
      done,
      10,
      0,
      50,
      emptyAvailabilityCounts(),
    );
    expect(counts.sims).toBe(0);
    expect(counts.atNext.size).toBe(0);
  });
});

describe("softmax", () => {
  it("normalizes and survives large negative utilities", () => {
    const p = softmax([0, -1, -2]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(p[0]).toBeGreaterThan(p[1] as number);

    const extreme = softmax([-1e6, -1e6 - 1]);
    expect(extreme.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(Number.isFinite(extreme[0] as number)).toBe(true);
    expect(softmax([])).toEqual([]);
  });
});

describe("Larry's pick", () => {
  it("recommends the best available by Larry rank, not by ESPN rank", () => {
    const players = makeBoard(makePool({ count: 50, seed: 2, categoryNoise: 0.3 }));
    // Larry disagrees with ESPN: the ESPN 5th is Larry's 1st.
    players[4] = { ...(players[4] as MockPlayer), larryRank: 1 };
    players[0] = { ...(players[0] as MockPlayer), larryRank: 5 };

    const config: MockDraftConfig = {
      order: makeSnakeOrder(TEAMS, 4),
      teamCount: TEAMS,
      players,
      profileByTeam: flatProfiles(),
      leagueReach: { early: 0, mid: 0, late: 0 },
    };
    const board = prepareBoard(config);
    const available = availableIdsFor(board, freshState(1));

    expect(bestAvailableByLarry(board, available)).toBe(players[4]?.playerId);
  });

  it("does not read a null Larry rank as rank zero", () => {
    const players = makeBoard(makePool({ count: 10, seed: 2, categoryNoise: 0 }));
    const withNull = players.map((p, i) => (i === 0 ? { ...p, larryRank: null } : p));
    const config: MockDraftConfig = {
      order: [1],
      teamCount: 1,
      players: withNull,
      profileByTeam: flatProfiles(),
      leagueReach: { early: 0, mid: 0, late: 0 },
    };
    const board = prepareBoard(config);
    const available = availableIdsFor(board, freshState(1));

    // The unranked player must not win just because null sorts low.
    expect(bestAvailableByLarry(board, available)).toBe(withNull[1]?.playerId);
  });
});
