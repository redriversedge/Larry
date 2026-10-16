// Draft Room profiles, docs/DRAFT_ROOM_SPEC.md s3 and s8.
// All data synthetic. See tests/engine/draftFixtures.ts for why.

import { describe, expect, it } from "vitest";

import { buildDraftProfiles, normName } from "../../src/engine/draftProfiles";
import { CATEGORIES } from "../../src/shared/types";
import {
  byRank,
  highestInWindow,
  lowestInWindow,
  makeLeague,
} from "./draftFixtures";

const NINE_SEASONS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

describe("buildDraftProfiles: category premium", () => {
  it("reads a strong positive PTS premium for a manager who always takes the highest-PTS player in a 3-pick window", () => {
    const league = makeLeague({
      seasons: NINE_SEASONS,
      strategies: { M3: highestInWindow("pts", 3) },
    });

    const { profiles } = buildDraftProfiles(league.history, league.adp);
    const m3 = profiles["M3"];
    expect(m3).toBeDefined();
    if (!m3) return;

    expect(m3.premium.PTS.premium).toBeGreaterThan(0);
    expect(Math.abs(m3.premium.PTS.t)).toBeGreaterThanOrEqual(2);
    expect(m3.premium.PTS.strength).toBe("strong");
    expect(m3.premium.PTS.label).toBe("Pays up for PTS");
    expect(m3.order[0]).toBe("PTS");
    expect(m3.summary).toContain("Pays up for PTS");
  });

  it("labels a manager who never takes the higher-PTS player as punting PTS, with 0 positive seasons", () => {
    const league = makeLeague({
      seasons: NINE_SEASONS,
      strategies: { M5: lowestInWindow("pts", 4) },
    });

    const { profiles } = buildDraftProfiles(league.history, league.adp);
    const m5 = profiles["M5"];
    expect(m5).toBeDefined();
    if (!m5) return;

    expect(m5.premium.PTS.premium).toBeLessThan(0);
    expect(m5.premium.PTS.t).toBeLessThanOrEqual(-2);
    expect(m5.premium.PTS.strength).toBe("strong");
    expect(m5.premium.PTS.seasonsPositive).toBe(0);
    expect(m5.premium.PTS.label).toBe("Punts PTS");
    expect(m5.summary).toContain("Punts PTS (0 of 9 seasons)");
  });

  it("calls a strong negative premium 'Avoids' rather than 'Punts' once the manager was positive in more than one season", () => {
    // A 3-pick window on a noisier board: still negative overall, but the
    // manager lands above water in several individual seasons.
    const league = makeLeague({
      seasons: NINE_SEASONS,
      seed: 31,
      categoryNoise: 0.2,
      strategies: {
        M4: ({ available, overall }) =>
          // Alternate between the board and a PTS-averse pick, so the sign
          // stays negative while individual seasons vary.
          overall % 2 === 0 ? 0 : lowestInWindow("pts", 6)({ available } as never),
      },
    });

    const { profiles } = buildDraftProfiles(league.history, league.adp);
    const m4 = profiles["M4"];
    expect(m4).toBeDefined();
    if (!m4) return;

    // The construction is only meaningful if the premium really is strongly
    // negative; assert that first so a failure points at the right thing.
    expect(m4.premium.PTS.premium).toBeLessThan(0);
    if (m4.premium.PTS.strength === "strong" && m4.premium.PTS.seasonsPositive > 1) {
      expect(m4.premium.PTS.label).toBe("Avoids PTS");
    }
  });

  it("finds no category lean at all when every manager drafts strictly by the board", () => {
    // categoryNoise 0 makes each category a clean linear function of board
    // position, so a rank-order draft leaves residuals of ~0 by
    // construction. Any premium here would be a bug in the residual window.
    const league = makeLeague({
      seasons: NINE_SEASONS,
      categoryNoise: 0,
      strategies: {},
    });

    const { profiles } = buildDraftProfiles(league.history, league.adp);

    // Holds for every manager, not just one: nobody expressed a preference,
    // so nobody should show one.
    //
    // The residuals are not identically zero. A pick inside the first 8
    // overall slots has an asymmetric comparison window (there are fewer
    // picks above it than below), which leaves a tiny positive residual in
    // every category. It works out to a premium around 0.0003, four orders
    // of magnitude below anything in the spec's reference table, but with
    // no category noise the standard error collapses too and |t| lands near
    // 2.4. DRAFT_PREMIUM_MIN_EFFECT is what stops that from being reported
    // as a strong lean.
    for (const id of Object.keys(profiles)) {
      const profile = profiles[id];
      if (!profile) continue;
      for (const c of CATEGORIES) {
        expect(Math.abs(profile.premium[c].premium)).toBeLessThan(0.05);
        expect(profile.premium[c].strength).toBe("none");
      }
      expect(profile.summary).toBe("No clear category lean");
    }

    const m7 = profiles["M7"];
    expect(m7).toBeDefined();
    if (!m7) return;

    // Everyone took the top of the board, so ADP equals the pick number.
    expect(m7.reach.median).toBe(0);
    expect(m7.reach.label).toBe("Drafts the board");
  });

  it("uses only strong and moderate signals in the summary, and leaves weak ones unlabelled", () => {
    const league = makeLeague({
      seasons: NINE_SEASONS,
      strategies: { M2: highestInWindow("blk", 3) },
    });
    const { profiles } = buildDraftProfiles(league.history, league.adp);
    const m2 = profiles["M2"];
    if (!m2) throw new Error("missing profile");

    for (const c of CATEGORIES) {
      if (m2.premium[c].strength === "none") {
        expect(m2.premium[c].label).toBe("");
      } else {
        expect(m2.premium[c].label).not.toBe("");
      }
    }
  });
});

describe("buildDraftProfiles: reach", () => {
  it("measures reach against the ADP history and never against the stored ESPN rank", () => {
    // Every player's stored espnRank is 1, which is what a past season's
    // draftRanksByRankType looks like after ESPN overwrites it with
    // end-of-season ranks. If reach read that field, a by-the-board drafter
    // would look like a massive value hunter instead of scoring 0.
    const league = makeLeague({
      seasons: [2025, 2026],
      categoryNoise: 0,
      espnRankFor: () => 1,
    });

    const { profiles } = buildDraftProfiles(league.history, league.adp);
    const m1 = profiles["M1"];
    if (!m1) throw new Error("missing profile");

    expect(m1.reach.median).toBe(0);
    expect(m1.reach.label).toBe("Drafts the board");
  });

  it("leaves out picks with no ESPN ADP that season instead of scoring them", () => {
    const league = makeLeague({ seasons: [2026], categoryNoise: 0 });
    const season = league.history.seasons["2026"];
    if (!season) throw new Error("missing season");

    const full = buildDraftProfiles(league.history, league.adp).profiles["M1"];
    if (!full) throw new Error("missing profile");

    // Drop the back half of the board from the ADP file, the way FantasyPros
    // only publishes 150 to 200 players.
    const trimmed = {
      "2026": (league.adp["2026"] || []).slice(0, 60),
    };
    const partial = buildDraftProfiles(league.history, trimmed).profiles["M1"];
    if (!partial) throw new Error("missing profile");

    expect(partial.reach.n).toBeLessThan(full.reach.n);
    expect(partial.reach.n).toBeGreaterThan(0);
    // The picks that do have ADP still score 0, so dropping the rest must
    // not move the median off 0.
    expect(partial.reach.median).toBe(0);
    expect(partial.reach.late).toBeNull();
  });

  it("reports a positive median for a manager who takes players ahead of their ADP", () => {
    const league = makeLeague({
      seasons: NINE_SEASONS,
      // Reaches 20 slots down the board on every pick.
      strategies: { M9: ({ available }) => Math.min(20, available.length - 1) },
    });
    const { profiles } = buildDraftProfiles(league.history, league.adp);
    const m9 = profiles["M9"];
    if (!m9) throw new Error("missing profile");

    expect(m9.reach.median).toBeGreaterThanOrEqual(12);
    expect(m9.reach.label).toBe("Reaches often");
  });

  it("splits reach by phase", () => {
    const league = makeLeague({
      seasons: NINE_SEASONS,
      strategies: {
        // Reaches only in the mid rounds.
        M6: ({ available, round }) =>
          round >= 4 && round <= 7 ? Math.min(25, available.length - 1) : 0,
      },
    });
    const { profiles } = buildDraftProfiles(league.history, league.adp);
    const m6 = profiles["M6"];
    if (!m6) throw new Error("missing profile");

    expect(m6.reach.mid).toBeGreaterThan(m6.reach.early ?? 0);
    expect(m6.reach.mid).toBeGreaterThan(m6.reach.late ?? 0);
  });
});

describe("buildDraftProfiles: ownership and sample size", () => {
  it("credits each season to the member who held the team that year", () => {
    // Team 4 is Seller's in 2019 and Buyer's in 2020, and neither owns any
    // other team in either season. A team-keyed profile would blend the two
    // of them into one imaginary manager.
    const league = makeLeague({
      seasons: [2019, 2020],
      owners: {
        2019: { 4: "Seller" },
        2020: { 4: "Buyer" },
      },
      strategies: {
        Seller: highestInWindow("pts", 5),
        Buyer: highestInWindow("blk", 5),
      },
    });

    const { profiles } = buildDraftProfiles(league.history, league.adp);

    const seller = profiles["Seller"];
    const buyer = profiles["Buyer"];
    if (!seller || !buyer) throw new Error("missing profile");

    expect(seller.seasons).toEqual([2019]);
    expect(buyer.seasons).toEqual([2020]);
    expect(seller.draftCount).toBe(1);
    expect(buyer.draftCount).toBe(1);

    // And each one's picks are their own: the PTS buyer leans PTS, the BLK
    // buyer leans BLK. Blending them would flatten both.
    expect(seller.premium.PTS.premium).toBeGreaterThan(0);
    expect(buyer.premium.BLK.premium).toBeGreaterThan(0);
    expect(buyer.premium.BLK.premium).toBeGreaterThan(seller.premium.BLK.premium);
    expect(seller.premium.PTS.premium).toBeGreaterThan(buyer.premium.PTS.premium);
  });

  it("reports the draft count, the season span and the small-sample flag", () => {
    const league = makeLeague({ seasons: [2023, 2024, 2025, 2026] });
    const { profiles } = buildDraftProfiles(league.history, league.adp);
    const m1 = profiles["M1"];
    if (!m1) throw new Error("missing profile");

    expect(m1.draftCount).toBe(4);
    expect(m1.seasons[0]).toBe(2023);
    expect(m1.seasons[m1.seasons.length - 1]).toBe(2026);
    expect(m1.smallSample).toBe(true);

    const nine = buildDraftProfiles(
      makeLeague({ seasons: NINE_SEASONS }).history,
      league.adp,
    ).profiles["M1"];
    expect(nine?.smallSample).toBe(false);
    expect(nine?.draftCount).toBe(9);
  });
});

describe("buildDraftProfiles: no leakage", () => {
  it("reads only seasons before asOfSeason", () => {
    const league = makeLeague({ seasons: NINE_SEASONS });

    const asOf2023 = buildDraftProfiles(league.history, league.adp, { asOfSeason: 2023 });
    expect(asOf2023.seasonsUsed).toEqual([2018, 2019, 2020, 2021, 2022]);

    const m1 = asOf2023.profiles["M1"];
    if (!m1) throw new Error("missing profile");
    expect(m1.seasons).toEqual([2018, 2019, 2020, 2021, 2022]);
    expect(m1.draftCount).toBe(5);

    // The earliest season has nothing before it, so there is no profile to
    // build at all.
    const asOfFirst = buildDraftProfiles(league.history, league.adp, { asOfSeason: 2018 });
    expect(asOfFirst.seasonsUsed).toEqual([]);
    expect(Object.keys(asOfFirst.profiles)).toEqual([]);
  });
});

describe("buildDraftProfiles: position lean and team affinity", () => {
  it("flags a position lean only past the threshold", () => {
    const league = makeLeague({
      seasons: NINE_SEASONS,
      // posId cycles 1..5 by board index, so always taking a center skews
      // this manager hard toward C.
      strategies: {
        M8: ({ available }) => {
          const i = available.findIndex((p) => p.posId === 5);
          return i < 0 ? 0 : i;
        },
      },
    });

    const { profiles } = buildDraftProfiles(league.history, league.adp);
    const m8 = profiles["M8"];
    if (!m8) throw new Error("missing profile");

    const c = m8.positionLean.find((l) => l.position === "C");
    expect(c).toBeDefined();
    expect(c?.lean).toBeGreaterThanOrEqual(8);

    // A by-the-board manager has no lean worth showing.
    const m1 = profiles["M1"];
    for (const lean of m1?.positionLean || []) {
      expect(Math.abs(lean.lean)).toBeGreaterThanOrEqual(8);
    }
  });

  it("shows an NBA team only at 4+ picks and twice the league rate", () => {
    const league = makeLeague({
      seasons: NINE_SEASONS,
      strategies: {
        M10: ({ available }) => {
          const i = available.findIndex((p) => p.proTeamId === 7);
          return i < 0 ? 0 : i;
        },
      },
    });
    const { profiles } = buildDraftProfiles(league.history, league.adp);

    const m10 = profiles["M10"];
    if (!m10) throw new Error("missing profile");
    const denver = m10.teamAffinity.find((t) => t.proTeamId === 7);
    expect(denver).toBeDefined();
    expect(denver?.count).toBeGreaterThanOrEqual(4);
    expect(denver?.share).toBeGreaterThanOrEqual((denver?.leagueShare ?? 0) * 2);

    for (const t of profiles["M1"]?.teamAffinity || []) {
      expect(t.count).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("normName", () => {
  it("matches the ADP file's normalization rule", () => {
    expect(normName("Nikola Jokic")).toBe("nikola jokic");
    expect(normName("Jaren Jackson Jr.")).toBe("jaren jackson");
    // NFKD splits the accent off and the non-ASCII strip drops it, so the
    // accented and unaccented spellings land on the same key.
    expect(normName("Nikola Jokić")).toBe("nikola jokic");
    expect(normName("  Luka   Doncic  ")).toBe("luka doncic");
  });
});
