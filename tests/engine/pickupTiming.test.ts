// League rule: once the day's first game tips, a pickup does not join the
// lineup until tomorrow (core.js pickupStartDateStr, gameDatesBetween).
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
function load(S: any) {
  return new Function("S", "getOrderedCategories", "getMatchupWindow", "localDateStr", "durantKey",
    block + "; return { pickupStartDateStr, gameDatesBetween, shortDayLabel };")(
    S, () => [], () => ({}), localDateStr, (v: any) => v);
}
afterEach(() => { vi.useRealTimers(); });

const S = {
  scheduleLookup: { 1: [{ date: "2026-10-31", timeLocal: "2:00 PM" }, { date: "2026-11-01", timeLocal: "6:00 PM" }] },
  allPlayers: [{ id: 7, schedule: [{ date: "2026-10-31" }, { date: "2026-11-01" }, { date: "2026-11-02" }] }],
};

describe("pickup timing", () => {
  it("is today before the first tip and tomorrow after it", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 31, 13, 0));
    expect(load(S).pickupStartDateStr()).toBe("2026-10-31");
    vi.setSystemTime(new Date(2026, 9, 31, 15, 45));
    expect(load(S).pickupStartDateStr()).toBe("2026-11-01");
  });
  it("lists only the game days inside the range, from the live player", () => {
    const m = load(S);
    expect(m.gameDatesBetween({ id: 7 }, "2026-11-01", "2026-11-01")).toEqual(["2026-11-01"]);
    expect(m.shortDayLabel("2026-11-01")).toBe("Sun 11/1");
  });
});
