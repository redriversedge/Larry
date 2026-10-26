// Team of the Week (tabs.js) and the league reports (reports.js): Last
// Night, Rookie Report, LM Notes. Synthetic league only: the repo is public.
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const tabs = fs.readFileSync(path.join(ROOT, "js/tabs.js"), "utf8");
const totwSrc = tabs.slice(tabs.indexOf("function totwCatResult"), tabs.indexOf("function totwTeamName"));
const reportsSrc = fs.readFileSync(path.join(ROOT, "js/reports.js"), "utf8");

const CATS = ["REB", "AST", "STL", "BLK", "PTS"].map((abbr) => ({ abbr, isNegative: false, color: "#fff" }));

function load(S: any) {
  const store: Record<string, string> = {};
  const localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
  };
  const fmt = (v: number, d: number) => Number(v).toFixed(d);
  const localDateStr = (d?: Date) => {
    const x = d || new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
  };
  return new Function("S", "localStorage", "fmt", "localDateStr", "ESPN_TEAM_MAP", "fetch",
    totwSrc + "\nfunction recText(r) { return r.w + '-' + r.l + (r.t ? '-' + r.t : ''); }\n" + reportsSrc +
    "; return { computeTeamOfWeek, totwCompare, Reports, computeLmTeamStats, buildLmNotes, rookieCall, statLine };")(
    S, localStorage, fmt, localDateStr, { 1: "ATL" }, undefined);
}

function side(teamId: number, vals: number[]) {
  const cats: any = {};
  CATS.forEach((c, i) => { cats[c.abbr] = vals[i]; });
  return { teamId, cats };
}

// Matchup 3: 1 beats 2 (4-1), 3 beats 4 (3-2), 5 and 6 dead even.
const schedule = [
  { matchupPeriodId: 3, home: side(1, [200, 100, 30, 20, 500]), away: side(2, [150, 90, 25, 25, 450]) },
  { matchupPeriodId: 3, home: side(3, [180, 120, 20, 10, 520]), away: side(4, [170, 110, 25, 8, 530]) },
  { matchupPeriodId: 3, home: side(5, [100, 100, 10, 10, 300]), away: side(6, [100, 100, 10, 10, 300]) },
  { matchupPeriodId: 4, home: { teamId: 1 }, away: { teamId: 2 } },
];

describe("Team of the Week", () => {
  it("plays each matchup winner against every other winner", () => {
    const m = load({});
    const r = m.computeTeamOfWeek(schedule, 3, CATS);
    const ids = r.winners.map((w: any) => w.teamId);
    expect(ids).toContain(1);
    expect(ids).toContain(3);
    expect(ids).not.toContain(2);
    // A dead-even matchup sends both teams through, flagged.
    expect(r.winners.filter((w: any) => w.tied).map((w: any) => w.teamId).sort()).toEqual([5, 6]);
    // Team 1 vs 3: REB W, AST L, STL W, BLK W, PTS L -> 3-2 win. Beats 5 and 6 5-0.
    const t1 = r.winners.find((w: any) => w.teamId === 1);
    expect(t1.record).toEqual({ w: 3, l: 0, t: 0 });
    expect(r.winners[0].teamId).toBe(1);
    expect(t1.vs).toHaveLength(3);
  });
  it("returns null before any category totals exist", () => {
    expect(load({}).computeTeamOfWeek(schedule, 4, CATS)).toBeNull();
  });
});

describe("LM notes team stats", () => {
  it("finds the blowout, the closest matchup and the category kings", () => {
    const m = load({ teams: [] });
    const t = m.computeLmTeamStats(schedule, 3, CATS);
    expect(t.blowout.winner.teamId).toBe(1);
    expect(t.closest.winner).toBeNull();
    expect(t.kings.PTS.teamId).toBe(4);
    expect(t.kings.REB.teamId).toBe(1);
  });
});

describe("box scores", () => {
  const summary = {
    boxscore: { players: [{
      team: { abbreviation: "ATL" },
      statistics: [{
        labels: ["MIN", "FG", "3PT", "FT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "PF", "+/-", "PTS"],
        athletes: [
          { athlete: { id: "101", displayName: "Big Man" }, stats: ["36", "12-20", "0-1", "6-8", "5", "13", "18", "3", "1", "5", "2", "3", "+9", "30"] },
          { athlete: { id: "102", displayName: "Bench Guy" }, stats: ["12", "1-4", "0-2", "0-0", "0", "2", "2", "1", "0", "0", "1", "1", "-4", "2"] },
          { athlete: { id: "103", displayName: "DNP" }, didNotPlay: true, stats: [] },
        ],
      }],
    }] },
  };
  it("reads stats by label, skips players who did not play", () => {
    const m = load({});
    const players: any = {};
    m.Reports._internal.parseBox(summary, players);
    expect(Object.keys(players).sort()).toEqual(["101", "102"]);
    expect(players["101"].s).toMatchObject({ MIN: 36, REB: 18, AST: 3, STL: 1, BLK: 5, PTS: 30 });
    expect(players["101"].t).toBe("ATL");
  });
  it("ranks the monster line first and sums a week", () => {
    const m = load({});
    const players: any = {};
    m.Reports._internal.parseBox(summary, players);
    expect(m.Reports.scoreLines(players, CATS)[0].id).toBe("101");
    const week = m.Reports.sumDays([{ players }, { players }]);
    expect(week["101"].g).toBe(2);
    expect(week["101"].s.PTS).toBe(60);
    expect(m.Reports.leaders(week, "BLK", 1)[0].n).toBe("Big Man");
  });
});

describe("rookie pickup call", () => {
  const S = { league: { teamCount: 12, rosterSize: 13 } };
  it("says pick up for a roster-worthy free agent", () => {
    expect(load(S).rookieCall({ durantRank: 120 }, "up").label).toBe("Pick up");
  });
  it("says watch for a rising rookie just outside the cut", () => {
    expect(load(S).rookieCall({ durantRank: 190 }, "up").label).toBe("Watch");
  });
  it("passes on a cold or irrelevant rookie and flags injured ones", () => {
    expect(load(S).rookieCall({ durantRank: 400 }, "flat").label).toBe("Pass");
    expect(load(S).rookieCall({ durantRank: 50, injuryStatus: "OUT" }, "up").label).toBe("Hurt");
  });
});
