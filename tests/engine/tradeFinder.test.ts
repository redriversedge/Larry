// Trade Finder (tabs.js findTradePackages): type a player, get trades of
// the chosen shape that involve him, from the right side of the deal.
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const src = fs.readFileSync(path.resolve(__dirname, "../../js/tabs.js"), "utf8");
const verdict = src.slice(src.indexOf("function tradeVerdict"), src.indexOf("function tradeRate"));
const finder = src.slice(src.indexOf("function combos(list, k)"), src.indexOf("function tradeResultsHtml()"));
const api = new Function(verdict + finder + "; return { findTradePackages };")();

const CATS = ["REB", "AST", "STL", "BLK", "PTS"].map((abbr) => ({ abbr, isNegative: false }));
function pl(id: number, team: number, r: number[], value: number) {
  const o: any = {};
  CATS.forEach((c, i) => { o[c.abbr] = r[i]; });
  return { id, onTeamId: team, slotId: 0, r: o, value };
}
const rate = (p: any) => p.r;
const score = (p: any) => p.value;
// Team 1 (me) is big-man heavy; team 2 has guards; team 3 is balanced.
const teams = [
  { teamId: 1, name: "Me", players: [pl(1, 1, [12, 2, 0.6, 2.4, 18], 40), pl(2, 1, [10, 2, 0.5, 2, 14], 25), pl(3, 1, [4, 3, 1, 0.3, 10], 5)] },
  { teamId: 2, name: "Guards", players: [pl(11, 2, [4, 9, 1.8, 0.3, 22], 42), pl(12, 2, [3, 7, 1.5, 0.2, 16], 22), pl(13, 2, [3, 2, 0.8, 0.1, 8], 3)] },
  { teamId: 3, name: "Mix", players: [pl(21, 3, [7, 5, 1.1, 1, 17], 30), pl(22, 3, [6, 4, 1, 0.8, 15], 20), pl(23, 3, [5, 3, 1, 0.6, 12], 10)] },
];
const ONE = { give: 1, get: 1 }, TWO_ONE = { give: 2, get: 1 }, TWO_TWO = { give: 2, get: 2 };

describe("findTradePackages", () => {
  it("for your own player, offers come from every other team and always include him", () => {
    const r = api.findTradePackages(teams, 1, 1, ONE, CATS, rate, score, [8]);
    expect(r.side).toBe("mine");
    expect(r.results.length).toBeGreaterThan(0);
    for (const t of r.results) {
      expect(t.give.map((p: any) => p.id)).toEqual([1]);
      expect(t.get).toHaveLength(1);
      expect(t.partnerId).not.toBe(1);
    }
    expect(new Set(r.results.map((t: any) => t.partnerId)).size).toBeGreaterThan(1);
  });

  it("for another team's player, packages come from your roster and only that team", () => {
    const r = api.findTradePackages(teams, 1, 11, TWO_ONE, CATS, rate, score, [8]);
    expect(r.side).toBe("theirs");
    for (const t of r.results) {
      expect(t.get.map((p: any) => p.id)).toEqual([11]);
      expect(t.give).toHaveLength(2);
      expect(t.give.every((p: any) => p.onTeamId === 1)).toBe(true);
      expect(t.partnerId).toBe(2);
    }
  });

  it("2 for 2 gets the target plus a teammate of his", () => {
    const r = api.findTradePackages(teams, 1, 11, TWO_TWO, CATS, rate, score, [8]);
    for (const t of r.results) {
      expect(t.get[0].id).toBe(11);
      expect(t.get).toHaveLength(2);
      expect(t.get[1].onTeamId).toBe(2);
      expect(t.give).toHaveLength(2);
    }
  });

  it("returns nothing for a player no team rosters", () => {
    expect(api.findTradePackages(teams, 1, 999, ONE, CATS, rate, score, []).results).toEqual([]);
  });
});
