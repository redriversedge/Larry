// Trade analyzer (tabs.js): category ranks before and after, and the verdict.
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const src = fs.readFileSync(path.resolve(__dirname, "../../js/tabs.js"), "utf8");
const block = src.slice(src.indexOf("function computeTradeImpact"), src.indexOf("function tradeRate"));
const api = new Function(block + "; return { computeTradeImpact, tradeVerdict };")();

const CATS = ["REB", "AST", "STL", "BLK", "PTS"].map((abbr) => ({ abbr, isNegative: false }));
const rate = (p: any) => p.r;
function pl(id: number, team: number, r: number[]) {
  const o: any = {};
  CATS.forEach((c, i) => { o[c.abbr] = r[i]; });
  return { id, onTeamId: team, slotId: 0, r: o };
}
// Three teams. Team 1 is us.
const big = pl(1, 1, [12, 2, 0.5, 2.5, 20]);
const guard = pl(2, 2, [4, 9, 1.8, 0.3, 22]);
const teams = [
  { teamId: 1, players: [big, pl(3, 1, [5, 5, 1, 0.5, 15])] },
  { teamId: 2, players: [guard, pl(4, 2, [6, 3, 1, 1, 12])] },
  { teamId: 3, players: [pl(5, 3, [8, 6, 1.2, 1, 18]), pl(6, 3, [7, 4, 1.1, 0.8, 16])] },
];

describe("computeTradeImpact", () => {
  it("moves our totals and ranks the way the swap says", () => {
    const r = api.computeTradeImpact(teams, 1, [big], [guard], CATS, rate);
    expect(r.mine.REB.before).toBe(17);
    expect(r.mine.REB.after).toBe(9);
    expect(r.mine.AST.after).toBe(14);
    expect(r.mine.REB.rankBefore).toBe(1);
    expect(r.mine.REB.rankAfter).toBe(3);
    expect(r.mine.AST.rankAfter).toBe(1);
    expect(r.better).toContain("AST");
    expect(r.worse).toContain("REB");
    expect(r.partnerId).toBe(2);
    expect(r.partner.REB.after).toBe(18);
  });
  it("ignores IR when totalling", () => {
    const ir = Object.assign({}, pl(9, 1, [10, 10, 10, 10, 10]), { slotId: 13 });
    const t = [{ teamId: 1, players: [big, ir] }, teams[1], teams[2]];
    const r = api.computeTradeImpact(t, 1, [big], [guard], CATS, rate);
    expect(r.mine.REB.before).toBe(12);
  });
});

describe("tradeVerdict", () => {
  it("combines category ranks and value", () => {
    expect(api.tradeVerdict({ rankDelta: 3 }, 20, 50).label).toBe("Take it");
    expect(api.tradeVerdict({ rankDelta: 3 }, -20, 50).label).toBe("Toss-up");
    expect(api.tradeVerdict({ rankDelta: 0 }, 20, 50).label).toBe("Lean yes");
    expect(api.tradeVerdict({ rankDelta: -4 }, -30, 50).label).toBe("Pass");
    // A category collapse decides it on its own.
    expect(api.tradeVerdict({ rankDelta: -20 }, 0, 50).label).toBe("Pass");
    expect(api.tradeVerdict({ rankDelta: 8 }, -20, 50).label).toBe("Lean yes");
  });
});
