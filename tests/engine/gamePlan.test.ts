// Game Plan (js/gameplan.js): what changed since the last plan, the games
// strip, and pickup targets. Synthetic league only.
import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const src = fs.readFileSync(path.resolve(__dirname, "../../js/gameplan.js"), "utf8");
const localDateStr = (d?: Date) => {
  const x = d || new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
};
const CATS = ["REB", "AST", "STL", "BLK", "PTS"].map((abbr) => ({ abbr, color: "#fff" }));
const games = (...dates: string[]) => dates.map((date) => ({ date }));

function pl(id: number, name: string, rate: Record<string, number>, extra: any = {}) {
  return { id, name, nbaTeam: "AAA", eligibleSlots: [], durantRank: id, rate, schedule: [], injuryStatus: "ACTIVE", slotId: 0, ...extra };
}

function load(S: any, opts: { pickups?: any } = {}) {
  const pickups = opts.pickups || { used: 1, limit: 3, left: 2 };
  const env: Record<string, any> = {
    S,
    localDateStr,
    autosave: () => {},
    getOrderedCategories: () => CATS,
    getMatchupWindow: () => ({ startStr: "2026-11-02", endStr: "2026-11-08" }),
    matchupGamesLeft: () => 0,
    matchupPhase: () => ({ phase: "pregame", planDate: "2026-11-03" }),
    pickupAllowance: () => pickups,
    pickupStartDateStr: () => "2026-11-03",
    gameDatesBetween: () => [],
    shortDayLabel: (d: string) => d,
    blendedPerGame: (p: any) => p.rate || {},
    byDurantRank: (a: any, b: any) => a.durantRank - b.durantRank,
    esc: (s: any) => String(s),
    Engines: {
      enrichPlayer: (p: any) => p,
      normalizeInjuryStatus: (s: any) => String(s || "ACTIVE"),
      isValidAddCandidate: (p: any) => p.injuryStatus !== "OUT",
      ensureDURANT: () => {},
    },
    ESPNSync: { getPerGameStats: () => ({}) },
  };
  const names = Object.keys(env);
  return new Function(...names, src + "; return GamePlan;")(...names.map((n) => env[n]));
}

function league() {
  const mine = [pl(1, "Mine A", { REB: 10 }, { onTeamId: 10 }), pl(2, "Mine B", { PTS: 20 }, { onTeamId: 10 })];
  const theirs = [pl(3, "Their C", { REB: 5 }, { onTeamId: 4, injuryStatus: "ACTIVE" })];
  const fa = [
    pl(20, "Big Wed Thu Sat", { REB: 9, BLK: 1.5, PTS: 10 }, { schedule: games("2026-11-04", "2026-11-05", "2026-11-07") }),
    pl(21, "Guard one game", { AST: 8, PTS: 20 }, { schedule: games("2026-11-04") }),
    pl(22, "Hurt big", { REB: 12 }, { injuryStatus: "OUT", schedule: games("2026-11-04", "2026-11-05") }),
    pl(23, "Waiver big", { REB: 9 }, { poolStatus: "WAIVERS", waiverClearsAt: new Date(2026, 10, 5, 3).getTime(),
      schedule: games("2026-11-03", "2026-11-04", "2026-11-06") }),
  ];
  return {
    league: { currentMatchupPeriod: 3, rosterSlots: [{ slotId: 0, count: 10 }] },
    myTeam: { teamId: 10, players: mine },
    teams: [{ teamId: 4, name: "Rival", players: theirs }],
    matchup: { opponentTeamId: 4, myScores: { REB: 30 }, oppScores: { REB: 20 }, strategy: { winProb: { REB: 0.5, AST: 0.95, STL: 0.4, BLK: 0.05, PTS: 0.6 } } },
    allPlayers: mine.concat(theirs, fa),
    espn: { connected: true, leagueId: "1" },
    prefs: { collapsedSections: {} },
  };
}

afterEach(() => { vi.useRealTimers(); });

describe("Game Plan", () => {
  it("reads what changed since the last plan from the roster", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 4, 9, 0));
    const S = league();
    const gp = load(S, { pickups: { used: 2, limit: 3, left: 1 } });
    const prev = {
      plan: { pickupSteps: [{ when: "Tue night", date: "2026-11-03", title: "Add a big", status: "planned" }] },
      snapshot: { roster: [1, 9], pickupsUsed: 1, myScores: { REB: 10 }, oppScores: { REB: 10 }, oppStatus: { 3: { name: "Their C", status: "OUT" } } },
    };
    const lines: string[] = gp._internal.sinceLast(prev);
    expect(lines).toContain("You added Mine B.");
    expect(lines.some((l) => /dropped/.test(l))).toBe(true);
    expect(lines.some((l) => /REB margin went from \+0 to \+10/.test(l))).toBe(true);
    expect(lines.some((l) => /Their C went from OUT to ACTIVE/.test(l))).toBe(true);
    // An add was made, so the planned step is not reported as missed.
    expect(lines.some((l) => /was not made/.test(l))).toBe(false);
  });

  it("reports a planned pickup that was not made", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 4, 9, 0));
    const S = league();
    const gp = load(S);
    const prev = {
      plan: { pickupSteps: [{ when: "Tue night", date: "2026-11-03", title: "Add a big", status: "planned" }] },
      snapshot: { roster: [1, 2], pickupsUsed: 1, myScores: { REB: 30 }, oppScores: { REB: 20 }, oppStatus: {} },
    };
    const lines: string[] = gp._internal.sinceLast(prev);
    expect(lines).toContain("No roster moves since the last plan.");
    expect(lines.some((l) => /"Add a big" pickup \(Tue night\) was not made/.test(l))).toBe(true);
  });

  it("needs the categories still in play when there is no plan", () => {
    const gp = load(league());
    expect(gp._internal.needCats(null)).toEqual(["REB", "STL", "PTS"]);
    expect(gp._internal.needCats({ pickupSteps: [{ status: "planned", needCats: ["BLK", "XYZ"] }] })).toEqual(["BLK"]);
  });

  it("ranks this week's targets on the needed categories and usable games", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 2, 9, 0));
    const gp = load(league());
    const week = gp._internal.targets("week", { pickupSteps: [{ status: "planned", needCats: ["REB"] }] });
    const names = week.map((t: any) => t.p.name);
    expect(names[0]).toBe("Big Wed Thu Sat");
    // Injured players are not targets this week, but are in the free agent list.
    expect(names).not.toContain("Hurt big");
    expect(gp._internal.targets("all", null).map((t: any) => t.p.name)).toContain("Hurt big");
    // Rostered players never appear.
    expect(names).not.toContain("Mine A");
  });

  it("strikes the days a waiver player cannot play", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 2, 9, 0));
    const gp = load(league());
    const t = gp._internal.targets("week", null).find((x: any) => x.p.name === "Waiver big");
    expect(t.onWaivers).toBe(true);
    expect(t.lost).toEqual(["2026-11-03", "2026-11-04"]);
    expect(t.usable).toEqual(["2026-11-06"]);
  });

  it("gives each pickup step a different target who plays its days", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 2, 9, 0));
    const gp = load(league());
    const steps = gp._internal.stepTargets({
      pickupSteps: [
        { status: "planned", needCats: ["REB"], forDays: ["2026-11-05", "2026-11-07"] },
        { status: "planned", needCats: ["REB"], forDays: ["2026-11-04"] },
        { status: "done", needCats: ["REB"] },
      ],
    });
    expect(steps[0].p.name).toBe("Big Wed Thu Sat");
    expect(steps[1].p.name).not.toBe("Big Wed Thu Sat");
    expect(steps[2]).toBeNull();
  });

  it("counts usable games per day, capped at starting slots", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 4, 9, 0));
    const S = league();
    S.myTeam.players[0].schedule = games("2026-11-04") as any;
    S.myTeam.players[1].schedule = games("2026-11-04", "2026-11-05") as any;
    S.league.rosterSlots = [{ slotId: 0, count: 1 }];
    const f = load(S)._internal.facts();
    expect(f.days).toHaveLength(7);
    const wed = f.days.find((d: any) => d.date === "2026-11-04");
    expect(wed.you).toBe(1);
    expect(wed.today).toBe(true);
    expect(f.days[0].past).toBe(true);
    expect(f.dayOf).toBe(3);
  });

  it("carries the owner's calls into the summary Move and chat read", () => {
    const S: any = league();
    S.gamePlanIntents = { 3: [{ id: 1, text: "Punt AST this week" }] };
    S.gamePlan = { mp: 3, plan: { headline: "Win the bigs", pickupSteps: [{ when: "Tue", title: "Add a big", status: "planned", needCats: ["REB"] }] }, generatedAt: "x" };
    const sum = load(S).summary();
    expect(sum.intents).toEqual(["Punt AST this week"]);
    expect(sum.headline).toBe("Win the bigs");
    expect(sum.steps[0].needCats).toEqual(["REB"]);
  });
});
