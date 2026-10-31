// Usable games left in the matchup (core.js matchupGamesLeft). Oct 31 2026:
// Schedule Advantage showed 18 vs 13 on a Saturday when the owner counted
// about 10 vs 7.
import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const core = fs.readFileSync(path.resolve(__dirname, "../../js/core.js"), "utf8");
const block = core.slice(core.indexOf("var BLEND_PRIOR_GAMES"), core.indexOf("// Roster tag for a player"));

function load(S: any) {
  const localDateStr = (d?: Date) => {
    const x = d || new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
  };
  return new Function("S", "getOrderedCategories", "getMatchupWindow", "localDateStr", "durantKey",
    block + "; return { matchupGamesLeft };")(
    S, () => [{ abbr: "PTS" }], () => ({ startStr: "2026-10-26", endStr: "2026-11-01" }),
    localDateStr, (v: any) => (v == null ? -Infinity : v));
}

afterEach(() => { vi.useRealTimers(); });

function pl(id: number, dates: string[], extra: any = {}) {
  return { id, slotId: 12, injuryStatus: "ACTIVE", durantScore: 10 - id,
    stats: { season: { PTS: 10 } }, schedule: dates.map((date) => ({ date, timeLocal: "7:00 PM" })), ...extra };
}

describe("matchupGamesLeft", () => {
  it("counts only remaining days in the window, healthy non-IR players, capped by starting slots", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 31, 9, 44)); // Sat Oct 31, 9:44am local
    const roster = [
      pl(1, ["2026-10-31", "2026-11-01", "2026-11-02"]), // Monday Nov 2 is next matchup
      pl(2, ["2026-10-31"]),
      pl(3, ["2026-11-01"], { injuryStatus: "OUT" }),     // OUT: does not count
      pl(4, ["2026-10-31", "2026-11-01"], { slotId: 13 }), // IR: does not count
      pl(5, ["2026-10-30"]),                                // already played
      pl(6, ["2026-10-31"]),
    ];
    const S = { allPlayers: roster, league: { rosterSlots: [{ slotId: 0, count: 2 }] } };
    // Sat: players 1, 2, 6 have games but only 2 slots. Sun: player 1.
    expect(load(S).matchupGamesLeft(roster.map((p) => ({ id: p.id, slotId: p.slotId })))).toBe(3);
  });

  it("drops today's games once they have tipped", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 31, 21, 0)); // Sat 9pm, after the 7pm tip
    const roster = [pl(1, ["2026-10-31", "2026-11-01"])];
    const S = { allPlayers: roster, league: { rosterSlots: [{ slotId: 0, count: 10 }] } };
    expect(load(S).matchupGamesLeft([{ id: 1, slotId: 0 }])).toBe(1);
  });
});
