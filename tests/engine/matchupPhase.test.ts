// The fantasy day's phase and which day advice is for (core.js
// matchupPhase), and the pickup allowance with the Settings override.
// Oct 31 2026, 10:40 PM after the last game: Larry's Move said to sit tight
// when the job was to set up tomorrow before the wire was picked over.
import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const core = fs.readFileSync(path.resolve(__dirname, "../../js/core.js"), "utf8");
const block = core.slice(core.indexOf("var BLEND_PRIOR_GAMES"), core.indexOf("// Roster tag for a player"));
const localDateStr = (d?: Date) => {
  const x = d || new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
};
function load(S: any, window: any) {
  return new Function("S", "getOrderedCategories", "getMatchupWindow", "localDateStr", "durantKey",
    block + "; return { matchupPhase, pickupAllowance };")(S, () => [], () => window, localDateStr, (v: any) => v);
}
afterEach(() => { vi.useRealTimers(); });

const S = {
  scheduleLookup: {
    1: [{ date: "2026-10-31", timeLocal: "6:00 PM" }, { date: "2026-11-01", timeLocal: "2:30 PM" }, { date: "2026-11-02", timeLocal: "6:00 PM" }],
    2: [{ date: "2026-10-31", timeLocal: "9:00 PM" }],
  },
};
const WEEK = { startStr: "2026-10-26", endStr: "2026-11-01" };
function at(h: number, m: number, d = 31) {
  vi.useFakeTimers({ toFake: ["Date"] });
  // d <= 7 means early November; otherwise October.
  vi.setSystemTime(d <= 7 ? new Date(2026, 10, d, h, m) : new Date(2026, 9, d, h, m));
}

describe("matchupPhase", () => {
  it("before the first tip, advice is for today", () => {
    at(15, 0);
    const p = load(S, WEEK).matchupPhase();
    expect(p.phase).toBe("pregame");
    expect(p.planDate).toBe("2026-10-31");
  });
  it("during games, advice moves to tomorrow but is marked live", () => {
    at(19, 30);
    const p = load(S, WEEK).matchupPhase();
    expect(p.phase).toBe("live");
    expect(p.planDate).toBe("2026-11-01");
    expect(p.firstTip).toBe("6:00 PM");
  });
  it("after the last game (last tip + 3h), today is final", () => {
    at(23, 50);
    expect(load(S, WEEK).matchupPhase().phase).toBe("live");
    at(23, 59);
    // 9:00 PM tip + 180 minutes is midnight, so still live at 11:59
    expect(load(S, WEEK).matchupPhase().phase).toBe("live");
    const early = { scheduleLookup: { 1: [{ date: "2026-10-31", timeLocal: "6:00 PM" }, { date: "2026-11-01", timeLocal: "2:30 PM" }] } };
    at(22, 40);
    expect(load(early, WEEK).matchupPhase().phase).toBe("final");
  });
  it("on the last day of a matchup, once games start the plan is the next matchup", () => {
    at(13, 0, 1); // Sun Nov 1, before the 2:30 tip
    expect(load(S, WEEK).matchupPhase().nextMatchup).toBe(false);
    at(16, 0, 1);
    const p = load(S, WEEK).matchupPhase();
    expect(p.planDate).toBe("2026-11-02");
    expect(p.nextMatchup).toBe(true);
    expect(p.lastDayOfMatchup).toBe(true);
  });
});

describe("pickupAllowance", () => {
  it("uses ESPN's per-matchup limit, and the Settings override when set", () => {
    const base = { myTeam: { matchupAcquisitionsUsed: 2 }, league: { matchupAcquisitionLimit: -1 }, prefs: {} as any };
    expect(load(base, WEEK).pickupAllowance()).toMatchObject({ used: 2, limit: -1, left: null });
    base.league.matchupAcquisitionLimit = 3;
    expect(load(base, WEEK).pickupAllowance()).toMatchObject({ used: 2, limit: 3, left: 1, limitSource: "ESPN" });
    base.prefs.matchupPickupLimit = 4;
    expect(load(base, WEEK).pickupAllowance()).toMatchObject({ limit: 4, left: 2, limitSource: "your Settings" });
  });
});
