import { describe, expect, it } from "vitest";
import { recommend } from "../../src/engine/recommend";
import { createInMemoryProjectionSource } from "../../src/engine/projectionSource";
import type {
  CategoryVector,
  PlayerProjection,
  RecommendationContext,
} from "../../src/shared/types";
import { CATEGORIES } from "../../src/shared/types";
import { makePlayer } from "./fixtures";

// Build a synthetic league + free-agent pool used by both the headline test
// and the category-fit test. Free agents are designed to have clean,
// distinguishable category strengths so we can verify the engine actually
// surfaces the ones the user needs.
function buildSharedPool(): {
  freeAgents: PlayerProjection[];
  leagueRosters: Record<string, PlayerProjection[]>;
} {
  // Free-agent pool: a spread of players with one or two strong categories
  // each, plus a handful of all-around contributors. Names indicate the
  // primary strength so failures are easy to read.
  const freeAgents: PlayerProjection[] = [
    // PTS specialists (5)
    makePlayer({ id: "scorer1", name: "Scorer1", perGame: { REB: 3, AST: 3, STL: 1.0, BLK: 0.3, PTS: 22 } }),
    makePlayer({ id: "scorer2", name: "Scorer2", perGame: { REB: 4, AST: 2, STL: 0.8, BLK: 0.4, PTS: 20 } }),
    makePlayer({ id: "scorer3", name: "Scorer3", perGame: { REB: 2, AST: 4, STL: 1.1, BLK: 0.2, PTS: 19 } }),
    makePlayer({ id: "scorer4", name: "Scorer4", perGame: { REB: 3, AST: 3, STL: 0.7, BLK: 0.3, PTS: 18 } }),
    makePlayer({ id: "scorer5", name: "Scorer5", perGame: { REB: 3, AST: 5, STL: 0.9, BLK: 0.3, PTS: 17 } }),
    // BLK specialists (5)
    makePlayer({ id: "blocker1", name: "Blocker1", perGame: { REB: 8, AST: 1, STL: 0.5, BLK: 2.5, PTS: 9 } }),
    makePlayer({ id: "blocker2", name: "Blocker2", perGame: { REB: 9, AST: 1, STL: 0.6, BLK: 2.2, PTS: 10 } }),
    makePlayer({ id: "blocker3", name: "Blocker3", perGame: { REB: 7, AST: 0.5, STL: 0.4, BLK: 2.0, PTS: 8 } }),
    makePlayer({ id: "blocker4", name: "Blocker4", perGame: { REB: 6, AST: 1, STL: 0.5, BLK: 1.8, PTS: 11 } }),
    makePlayer({ id: "blocker5", name: "Blocker5", perGame: { REB: 8, AST: 0.7, STL: 0.5, BLK: 1.6, PTS: 9 } }),
    // REB specialists (5)
    makePlayer({ id: "rebound1", name: "Rebound1", perGame: { REB: 12, AST: 1, STL: 0.6, BLK: 0.7, PTS: 10 } }),
    makePlayer({ id: "rebound2", name: "Rebound2", perGame: { REB: 11, AST: 1, STL: 0.5, BLK: 0.6, PTS: 11 } }),
    makePlayer({ id: "rebound3", name: "Rebound3", perGame: { REB: 10, AST: 1.5, STL: 0.7, BLK: 0.8, PTS: 9 } }),
    makePlayer({ id: "rebound4", name: "Rebound4", perGame: { REB: 9.5, AST: 1, STL: 0.6, BLK: 0.5, PTS: 12 } }),
    makePlayer({ id: "rebound5", name: "Rebound5", perGame: { REB: 9, AST: 2, STL: 0.5, BLK: 0.7, PTS: 10 } }),
    // AST specialists (5)
    makePlayer({ id: "passer1", name: "Passer1", perGame: { REB: 3, AST: 8, STL: 1.0, BLK: 0.2, PTS: 12 } }),
    makePlayer({ id: "passer2", name: "Passer2", perGame: { REB: 3, AST: 7.5, STL: 1.3, BLK: 0.2, PTS: 11 } }),
    makePlayer({ id: "passer3", name: "Passer3", perGame: { REB: 4, AST: 7, STL: 1.1, BLK: 0.3, PTS: 13 } }),
    makePlayer({ id: "passer4", name: "Passer4", perGame: { REB: 3, AST: 6.5, STL: 1.2, BLK: 0.2, PTS: 12 } }),
    makePlayer({ id: "passer5", name: "Passer5", perGame: { REB: 3, AST: 6, STL: 0.9, BLK: 0.2, PTS: 13 } }),
    // STL specialists (3)
    makePlayer({ id: "thief1", name: "Thief1", perGame: { REB: 4, AST: 4, STL: 2.5, BLK: 0.2, PTS: 13 } }),
    makePlayer({ id: "thief2", name: "Thief2", perGame: { REB: 3, AST: 4, STL: 2.2, BLK: 0.3, PTS: 12 } }),
    makePlayer({ id: "thief3", name: "Thief3", perGame: { REB: 4, AST: 3, STL: 2.0, BLK: 0.2, PTS: 11 } }),
    // Balanced (3)
    makePlayer({ id: "all1", name: "AllAround1", perGame: { REB: 5, AST: 4, STL: 1.2, BLK: 0.7, PTS: 14 } }),
    makePlayer({ id: "all2", name: "AllAround2", perGame: { REB: 4.5, AST: 4.5, STL: 1.1, BLK: 0.8, PTS: 13 } }),
    makePlayer({ id: "all3", name: "AllAround3", perGame: { REB: 5.5, AST: 3.5, STL: 1.0, BLK: 0.9, PTS: 13 } }),
  ];

  // Build 12 league teams with mixed profiles. We want league averages to be
  // roughly mid-range so different "my teams" produce distinct need vectors.
  function clone(template: PlayerProjection, idPrefix: string, count: number): PlayerProjection[] {
    return Array.from({ length: count }, (_, i) => ({
      ...template,
      id: `${idPrefix}_${i}`,
      name: `${template.name}#${i}`,
    }));
  }
  const leagueRosters: Record<string, PlayerProjection[]> = {};
  for (let t = 0; t < 12; t++) {
    leagueRosters[`L${t}`] = clone(
      makePlayer({
        id: `tmpl${t}`,
        name: `Avg${t}`,
        perGame: {
          REB: 5 + ((t % 4) - 2) * 0.5,
          AST: 4 + ((t % 5) - 2) * 0.4,
          STL: 1 + ((t % 3) - 1) * 0.2,
          BLK: 0.7 + ((t % 4) - 2) * 0.15,
          PTS: 13 + ((t % 6) - 3) * 0.5,
        },
      }),
      `L${t}p`,
      10,
    );
  }
  return { freeAgents, leagueRosters };
}

function buildContext(
  myPlayers: PlayerProjection[],
  freeAgents: PlayerProjection[],
  leagueRosters: Record<string, PlayerProjection[]>,
): RecommendationContext {
  const source = createInMemoryProjectionSource(freeAgents, myPlayers);
  return {
    roster: { myPlayers, leaguePlayers: leagueRosters },
    league: {
      size: 12,
      scoringPeriod: 0,
      currentMatchup: null,
      allCategories: CATEGORIES,
    },
    projectionSource: source,
    mode: "in-season",
  };
}

describe("recommend (engine v2)", () => {
  it("HEADLINE: two rosters with the same Lock/Target/Punt strategy bucket get materially different top 5", () => {
    const { freeAgents, leagueRosters } = buildSharedPool();

    // Both rosters have a profile that the legacy Engine 12 strategy
    // classifier would bucket the same way: both punt BLK and target PTS,
    // because their team totals show low BLK and high relative PTS. The
    // distinction the v2 engine should detect is finer:
    //   Roster A: extreme PTS surplus + REB need.
    //   Roster B: extreme PTS surplus + AST need.
    // Both punt BLK; both target PTS; both have positive PTS production.
    const rosterA: PlayerProjection[] = [
      makePlayer({ id: "a1", name: "A1", perGame: { REB: 1, AST: 5, STL: 1.2, BLK: 0.1, PTS: 22 } }),
      makePlayer({ id: "a2", name: "A2", perGame: { REB: 1.5, AST: 4, STL: 1.0, BLK: 0.1, PTS: 24 } }),
      makePlayer({ id: "a3", name: "A3", perGame: { REB: 2, AST: 4.5, STL: 1.1, BLK: 0.1, PTS: 21 } }),
      makePlayer({ id: "a4", name: "A4", perGame: { REB: 1.5, AST: 5, STL: 1.0, BLK: 0.1, PTS: 20 } }),
      makePlayer({ id: "a5", name: "A5", perGame: { REB: 1, AST: 4, STL: 1.2, BLK: 0.1, PTS: 23 } }),
      makePlayer({ id: "a6", name: "A6", perGame: { REB: 2, AST: 4.5, STL: 1.0, BLK: 0.1, PTS: 21 } }),
      makePlayer({ id: "a7", name: "A7", perGame: { REB: 1.5, AST: 5, STL: 1.1, BLK: 0.1, PTS: 22 } }),
      makePlayer({ id: "a8", name: "A8", perGame: { REB: 2, AST: 4, STL: 1.0, BLK: 0.1, PTS: 20 } }),
    ];
    const rosterB: PlayerProjection[] = [
      makePlayer({ id: "b1", name: "B1", perGame: { REB: 12, AST: 0.5, STL: 0.7, BLK: 0.1, PTS: 22 } }),
      makePlayer({ id: "b2", name: "B2", perGame: { REB: 11, AST: 0.5, STL: 0.6, BLK: 0.1, PTS: 24 } }),
      makePlayer({ id: "b3", name: "B3", perGame: { REB: 13, AST: 0.4, STL: 0.5, BLK: 0.1, PTS: 21 } }),
      makePlayer({ id: "b4", name: "B4", perGame: { REB: 10, AST: 0.5, STL: 0.6, BLK: 0.1, PTS: 20 } }),
      makePlayer({ id: "b5", name: "B5", perGame: { REB: 12, AST: 0.5, STL: 0.7, BLK: 0.1, PTS: 23 } }),
      makePlayer({ id: "b6", name: "B6", perGame: { REB: 11, AST: 0.5, STL: 0.5, BLK: 0.1, PTS: 21 } }),
      makePlayer({ id: "b7", name: "B7", perGame: { REB: 10, AST: 0.5, STL: 0.6, BLK: 0.1, PTS: 22 } }),
      makePlayer({ id: "b8", name: "B8", perGame: { REB: 12, AST: 0.5, STL: 0.7, BLK: 0.1, PTS: 20 } }),
    ];

    const ctxA = buildContext(rosterA, freeAgents, leagueRosters);
    const ctxB = buildContext(rosterB, freeAgents, leagueRosters);
    const outA = recommend(ctxA);
    const outB = recommend(ctxB);

    const top5A = outA.ranked.slice(0, 5).map((rp) => rp.player.id);
    const top5B = outB.ranked.slice(0, 5).map((rp) => rp.player.id);

    // Materially different = at least 2 different players in positions 1-5.
    let differences = 0;
    for (const id of top5A) if (!top5B.includes(id)) differences += 1;
    expect(differences).toBeGreaterThanOrEqual(2);

    // Sanity: the engine respected each roster's actual weakness.
    // Roster A is starved of REB; the top 5 should include at least one
    // REB specialist.
    const rebSpecialistIds = freeAgents
      .filter((p) => p.perGame.REB >= 9)
      .map((p) => p.id);
    expect(top5A.some((id) => rebSpecialistIds.includes(id))).toBe(true);
    // Roster B is starved of AST; the top 5 should include at least one
    // AST specialist.
    const astSpecialistIds = freeAgents
      .filter((p) => p.perGame.AST >= 6)
      .map((p) => p.id);
    expect(top5B.some((id) => astSpecialistIds.includes(id))).toBe(true);
  });

  it("a roster strong in REB+AST and weak in PTS+BLK gets PTS or BLK heavy recs in the top 5", () => {
    const { freeAgents, leagueRosters } = buildSharedPool();
    const myPlayers: PlayerProjection[] = [
      makePlayer({ id: "m1", perGame: { REB: 11, AST: 8, STL: 1.0, BLK: 0.2, PTS: 8 } }),
      makePlayer({ id: "m2", perGame: { REB: 10, AST: 7, STL: 1.1, BLK: 0.2, PTS: 9 } }),
      makePlayer({ id: "m3", perGame: { REB: 12, AST: 7.5, STL: 1.0, BLK: 0.1, PTS: 8 } }),
      makePlayer({ id: "m4", perGame: { REB: 11, AST: 8, STL: 1.2, BLK: 0.2, PTS: 7 } }),
      makePlayer({ id: "m5", perGame: { REB: 10, AST: 7, STL: 1.0, BLK: 0.2, PTS: 9 } }),
      makePlayer({ id: "m6", perGame: { REB: 11, AST: 7.5, STL: 1.1, BLK: 0.1, PTS: 8 } }),
      makePlayer({ id: "m7", perGame: { REB: 12, AST: 8, STL: 1.0, BLK: 0.2, PTS: 7 } }),
      makePlayer({ id: "m8", perGame: { REB: 11, AST: 7, STL: 1.0, BLK: 0.2, PTS: 8 } }),
    ];
    const ctx = buildContext(myPlayers, freeAgents, leagueRosters);
    const out = recommend(ctx);

    // Need vector should show strong positive need in PTS and BLK.
    expect(out.teamNeeds.PTS).toBeGreaterThan(0);
    expect(out.teamNeeds.BLK).toBeGreaterThan(0);
    expect(out.teamNeeds.REB).toBeLessThan(0);

    const top5 = out.ranked.slice(0, 5);
    const top5Ids = top5.map((rp) => rp.player.id);
    const ptsSpecialists = freeAgents.filter((p) => p.perGame.PTS >= 17).map((p) => p.id);
    const blkSpecialists = freeAgents.filter((p) => p.perGame.BLK >= 1.5).map((p) => p.id);
    const ptsOrBlkInTop5 = top5Ids.filter(
      (id) => ptsSpecialists.includes(id) || blkSpecialists.includes(id),
    );
    // Expect at least 3 of the top 5 to be PTS or BLK specialists.
    expect(ptsOrBlkInTop5.length).toBeGreaterThanOrEqual(3);
  });

  it("filters injured players from the output", () => {
    const { freeAgents, leagueRosters } = buildSharedPool();
    // Inject an injured monster: would dominate every category but is OUT.
    const injured = makePlayer({
      id: "outguy",
      name: "Outguy",
      perGame: { REB: 20, AST: 15, STL: 5, BLK: 5, PTS: 40 },
      injuryStatus: "OUT",
    });
    const fa = [...freeAgents, injured];
    const myPlayers: PlayerProjection[] = [
      makePlayer({ id: "x1", perGame: { REB: 5, AST: 4, STL: 1, BLK: 0.5, PTS: 14 } }),
      makePlayer({ id: "x2", perGame: { REB: 5, AST: 4, STL: 1, BLK: 0.5, PTS: 14 } }),
    ];
    const ctx = buildContext(myPlayers, fa, leagueRosters);
    const out = recommend(ctx);
    const ids = out.ranked.map((rp) => rp.player.id);
    expect(ids).not.toContain("outguy");
  });

  it("never recommends players already on the user's roster", () => {
    const { freeAgents, leagueRosters } = buildSharedPool();
    const myPlayers: PlayerProjection[] = [
      // Use a player id that also appears in the FA pool to simulate a
      // dirty input.
      makePlayer({ id: "scorer1", name: "Scorer1", perGame: { REB: 3, AST: 3, STL: 1.0, BLK: 0.3, PTS: 22 } }),
      makePlayer({ id: "x1", perGame: { REB: 5, AST: 4, STL: 1, BLK: 0.5, PTS: 14 } }),
    ];
    const ctx = buildContext(myPlayers, freeAgents, leagueRosters);
    const out = recommend(ctx);
    const ids = out.ranked.map((rp) => rp.player.id);
    expect(ids).not.toContain("scorer1");
  });

  it("output is deterministic: same input produces the same ranking", () => {
    const { freeAgents, leagueRosters } = buildSharedPool();
    const myPlayers: PlayerProjection[] = [
      makePlayer({ id: "y1", perGame: { REB: 5, AST: 4, STL: 1, BLK: 0.5, PTS: 14 } }),
    ];
    const ctxA = buildContext(myPlayers, freeAgents, leagueRosters);
    const ctxB = buildContext(myPlayers, freeAgents, leagueRosters);
    const a = recommend(ctxA).ranked.map((rp) => rp.player.id);
    const b = recommend(ctxB).ranked.map((rp) => rp.player.id);
    expect(a).toEqual(b);
  });
});
