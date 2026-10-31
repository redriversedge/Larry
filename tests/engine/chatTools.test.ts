// Larry chat's app tools (js/chat-tools.js): name matching and day parsing.
import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const src = fs.readFileSync(path.resolve(__dirname, "../../js/chat-tools.js"), "utf8");
const localDateStr = (d?: Date) => {
  const x = d || new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
};
function load(players: any[]) {
  const S = { allPlayers: players };
  return new Function("S", "localDateStr", src + "; return ChatTools;")(S, localDateStr);
}
afterEach(() => { vi.useRealTimers(); });

describe("chat tools", () => {
  const players = [{ name: "Luka Dončić" }, { name: "De'Aaron Fox" }, { name: "Jalen Green" }, { name: "Jalen Williams" }];
  it("matches accents, apostrophes and last names", () => {
    const t = load(players)._internal;
    expect(t.findPlayers("luka doncic").map((p: any) => p.name)).toEqual(["Luka Dončić"]);
    expect(t.findPlayers("deaaron fox").map((p: any) => p.name)).toEqual(["De'Aaron Fox"]);
    expect(t.findPlayers("Jalen")).toHaveLength(2);
  });
  it("reads weekday names, today and tomorrow as dates", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 31, 15, 0)); // Saturday
    const t = load(players)._internal;
    expect(t.resolveDay("Sunday")).toBe("2026-11-01");
    expect(t.resolveDay("tomorrow")).toBe("2026-11-01");
    expect(t.resolveDay("today")).toBe("2026-10-31");
    expect(t.resolveDay("sat")).toBe("2026-10-31");
    expect(t.resolveDay("nonsense")).toBeNull();
  });
  it("turns an unknown tool into an error the model can read", async () => {
    const out = await load(players).run("delete_league", {});
    expect(JSON.parse(out).error).toMatch(/Unknown tool/);
  });
});
