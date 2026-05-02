import { describe, expect, it } from "vitest";
import {
  computeLeagueAverages,
  fitBonus,
  rosterTotal,
  teamNeedVector,
} from "../../src/engine/teamFit";
import { buildQPool } from "../../src/engine/zscore";
import type { CategoryVector, RosterContext } from "../../src/shared/types";
import { CATEGORIES } from "../../src/shared/types";
import { buildSyntheticLeague, buildRosterContext, makePlayer } from "./fixtures";

describe("teamFit", () => {
  it("rosterTotal sums per-game category stats across players", () => {
    const players = [
      makePlayer({ id: "1", perGame: { REB: 5, AST: 2, STL: 1, BLK: 0, PTS: 10 } }),
      makePlayer({ id: "2", perGame: { REB: 3, AST: 6, STL: 2, BLK: 1, PTS: 14 } }),
    ];
    const total = rosterTotal(players);
    expect(total.REB).toBe(8);
    expect(total.AST).toBe(8);
    expect(total.STL).toBe(3);
    expect(total.BLK).toBe(1);
    expect(total.PTS).toBe(24);
  });

  it("need vector flips sign when roster strengths flip", () => {
    // Two synthetic teams: one heavy in REB+BLK, one heavy in AST+PTS. In a
    // larger league with mixed flavors, the REB+BLK team should show
    // positive need in AST/PTS and negative need (surplus) in REB/BLK; the
    // AST+PTS team gets the opposite signs.
    const league = buildSyntheticLeague({ teams: 12, playersPerTeam: 10, seed: 7 });
    const rebPlayer = makePlayer({
      id: "rebPlayer",
      perGame: { REB: 12, AST: 1, STL: 0.5, BLK: 2, PTS: 8 },
    });
    const astPlayer = makePlayer({
      id: "astPlayer",
      perGame: { REB: 2, AST: 10, STL: 1, BLK: 0.2, PTS: 22 },
    });
    // Replace one team with a roster of REB-heavy clones, another with
    // AST-heavy clones, so the totals are extreme by construction.
    const REB_TEAM = league.teamIds[0];
    const AST_TEAM = league.teamIds[1];
    if (!REB_TEAM || !AST_TEAM) throw new Error("league missing team ids");
    const rebRoster = Array.from({ length: 10 }, (_, i) => ({ ...rebPlayer, id: `reb${i}` }));
    const astRoster = Array.from({ length: 10 }, (_, i) => ({ ...astPlayer, id: `ast${i}` }));
    league.rosters[REB_TEAM] = rebRoster;
    league.rosters[AST_TEAM] = astRoster;

    const ctxRebTeam: RosterContext = {
      myPlayers: rebRoster,
      leaguePlayers: league.rosters,
    };
    const ctxAstTeam: RosterContext = {
      myPlayers: astRoster,
      leaguePlayers: league.rosters,
    };
    const leagueAvg = computeLeagueAverages(ctxRebTeam);
    const needReb = teamNeedVector(ctxRebTeam, leagueAvg);
    const needAst = teamNeedVector(ctxAstTeam, leagueAvg);

    // REB-heavy roster: surplus in REB and BLK, need in AST and PTS.
    expect(needReb.REB).toBeLessThan(0);
    expect(needReb.BLK).toBeLessThan(0);
    expect(needReb.AST).toBeGreaterThan(0);
    expect(needReb.PTS).toBeGreaterThan(0);
    // AST-heavy roster: surplus in AST and PTS, need in REB and BLK.
    expect(needAst.AST).toBeLessThan(0);
    expect(needAst.PTS).toBeLessThan(0);
    expect(needAst.REB).toBeGreaterThan(0);
    expect(needAst.BLK).toBeGreaterThan(0);
    // For the 4 categories where flavors are extreme (REB, BLK, AST, PTS),
    // the sign should be opposite between the two teams. STL is near
    // league average for both rosters by construction so we don't assert
    // a sign flip there.
    for (const c of ["REB", "BLK", "AST", "PTS"] as const) {
      expect(Math.sign(needReb[c])).not.toBe(Math.sign(needAst[c]));
    }
  });

  it("fit bonus is positive when player strengths align with team needs", () => {
    // Team needs PTS heavily (positive PTS need), surplus in REB.
    const need: CategoryVector = { REB: -1.5, AST: 0, STL: 0, BLK: 0, PTS: 2.0 };
    // Build a pool to compute z-scores against.
    const pool = Array.from({ length: 30 }, (_, i) =>
      makePlayer({
        id: `p${i}`,
        perGame: {
          REB: 5 + (i % 4),
          AST: 4 + (i % 3),
          STL: 1 + (i % 2) * 0.3,
          BLK: 0.5 + (i % 2) * 0.3,
          PTS: 10 + (i % 7),
        },
      }),
    );
    const { stats } = buildQPool(pool, 3);
    // High-PTS, low-REB player should have positive fit bonus.
    const ptsPlayer = makePlayer({
      id: "scorer",
      perGame: { REB: 2, AST: 4, STL: 1, BLK: 0.5, PTS: 24 },
    });
    // High-REB player should have negative fit bonus (already a surplus).
    const rebPlayer = makePlayer({
      id: "bigman",
      perGame: { REB: 14, AST: 1, STL: 0.4, BLK: 0.5, PTS: 8 },
    });
    expect(fitBonus(ptsPlayer, need, stats)).toBeGreaterThan(0);
    expect(fitBonus(rebPlayer, need, stats)).toBeLessThan(0);
  });
});
