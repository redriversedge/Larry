// Draft Room page smoke tests.
//
// js/draft.js is an IIFE written for a browser, so like
// tests/engine/legacyEngines.test.ts this loads the REAL shipping file into
// a sandbox with the globals it closes over, together with the real
// dist/larry-engine.js bundle. node --check only proves the file parses;
// this proves the page actually renders and that Sim, Undo, Restart and
// drafting work against the real engine.
//
// All data synthetic. See tests/engine/draftFixtures.ts.

import * as fs from "fs";
import * as path from "path";
import { beforeEach, describe, expect, it } from "vitest";

import { makeLeague } from "./draftFixtures";

const ROOT = path.resolve(__dirname, "../..");
const TEAMS = 12;
const ROUNDS = 12;

interface Harness {
  DraftRoom: any;
  renderDraftRoom: () => string;
  state: any;
  store: Map<string, string>;
  renders: () => number;
}

function makePlayers(count: number): any[] {
  const out: any[] = [];
  for (let i = 0; i < count; i++) {
    const quality = 1 - i / count;
    out.push({
      id: 2000 + i,
      name: "Player " + String.fromCharCode(65 + (i % 26)) + Math.floor(i / 26),
      defaultPositionId: (i % 5) + 1,
      proTeamId: (i % 30) + 1,
      durantRank: i + 1,
      espnAdp: i + 1,
      espnDraftRank: i + 1,
      stats: {
        projectedRate: {
          REB: 2 + 8 * quality,
          AST: 1 + 6 * quality,
          STL: 0.3 + 1.2 * quality,
          BLK: 0.1 + 1.2 * quality,
          PTS: 8 + 20 * quality,
        },
      },
    });
  }
  return out;
}

function baseState(): any {
  const teams = [];
  for (let t = 1; t <= TEAMS; t++) {
    teams.push({ teamId: t, name: "Team " + t, abbrev: "T" + t });
  }
  return {
    espn: { leagueId: "12345", espnS2: "s2", swid: "swid" },
    league: { seasonId: 2027, teamCount: TEAMS },
    myTeam: { teamId: 3, players: [] },
    teams,
    allPlayers: makePlayers(300),
    prefs: {},
  };
}

function snakeOrder(): number[] {
  const out: number[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    for (let t = 0; t < TEAMS; t++) out.push(r % 2 === 0 ? t + 1 : TEAMS - t);
  }
  return out;
}

function load(
  state: any,
  options: { history?: unknown; adp?: unknown } = {},
): Harness {
  const engineSrc = fs.readFileSync(path.join(ROOT, "dist/larry-engine.js"), "utf8");
  const draftSrc = fs.readFileSync(path.join(ROOT, "js/draft.js"), "utf8");

  const store = new Map<string, string>();
  if (options.history) store.set("larry_draft_history", JSON.stringify(options.history));

  let renderCount = 0;
  const sandbox: any = {};
  sandbox.window = sandbox;
  sandbox.render = () => { renderCount++; };

  const localStorage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };

  const ownersByTeam: Record<string, string> = {};
  for (let t = 1; t <= TEAMS; t++) ownersByTeam[String(t)] = "M" + t;

  const ESPNSync = {
    fetchDraftOrder: () =>
      Promise.resolve({
        order: snakeOrder(),
        ownersByTeam,
        drafted: false,
        teamCount: TEAMS,
      }),
    loadDraftHistory: () => {
      const raw = store.get("larry_draft_history");
      return raw ? JSON.parse(raw) : null;
    },
    clearDraftHistory: () => { store.delete("larry_draft_history"); },
    fetchDraftHistory: () => Promise.resolve(null),
  };

  // The real committed ADP history, served the way the browser gets it.
  // Profiles need it for the reach line.
  const adpFile = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/espn-adp-history.json"), "utf8"),
  );
  const fetchStub = (url: string) => {
    if (String(url).indexOf("espn-adp-history.json") >= 0) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.adp === undefined ? adpFile : options.adp),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
  };

  const names = [
    "window", "S", "localStorage", "document", "console", "ESPNSync", "Engines",
    "esc", "fmt", "ESPN_POS_MAP", "ESPN_TEAM_MAP", "DEFAULT_CAT_COLORS",
    "openPlayerPopup", "setTimeout", "clearTimeout", "fetch",
  ];
  const fn = new Function(
    ...names,
    engineSrc +
      "\n; window.LarryEngine = LarryEngine;\n" +
      draftSrc +
      "\n; return { DraftRoom: DraftRoom, renderDraftRoom: renderDraftRoom };",
  );

  const api = fn(
    sandbox,
    state,
    localStorage,
    { getElementById: () => null },
    console,
    ESPNSync,
    { ensureDURANT: () => {} },
    (s: unknown) => String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;"),
    (n: number, d: number) => Number(n || 0).toFixed(d),
    { 1: "PG", 2: "SG", 3: "SF", 4: "PF", 5: "C" },
    { 1: "ATL", 7: "DEN", 13: "LAL" },
    { PTS: "#3b82f6", REB: "#f97316", AST: "#22c55e", STL: "#a855f7", BLK: "#ef4444" },
    () => {},
    // Synchronous, so the availability chunks run inline and the page is
    // fully settled by the time a test reads it.
    (cb: () => void) => { cb(); return 0; },
    () => {},
    fetchStub,
  );

  return { ...api, state, store, renders: () => renderCount };
}

// The draft order and the ADP file both arrive by promise, so the first
// render returns a loading state. Settle everything, then render for real.
async function ready(h: Harness): Promise<string> {
  for (let i = 0; i < 6; i++) {
    h.renderDraftRoom();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return h.renderDraftRoom();
}

describe("Draft Room: page renders", () => {
  it("shows the loading state, then the board", async () => {
    const h = load(baseState());
    const first = h.renderDraftRoom();
    expect(first).toContain("Reading the draft order");

    const html = await ready(h);
    expect(html).toContain("Round 1, pick 1");
    expect(html).toContain("1st overall");
    expect(html).toContain("On the clock: Team 1");
    expect(html).toContain("draft-board-body");
    // Category columns in the house order.
    const order = ["REB", "AST", "STL", "BLK", "PTS"].map((c) => html.indexOf(">" + c + "<"));
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1] as number);
    }
  });

  it("offers to build profiles and says the model is unfitted", async () => {
    const h = load(baseState());
    const html = await ready(h);
    expect(html).toContain("Build manager profiles");
    expect(html).toContain("unfitted");
    expect(html).toContain("Seed ");
  });

  it("lists the user's upcoming picks", async () => {
    const h = load(baseState());
    const html = await ready(h);
    // Team 3 picks 3rd, then 22nd on the snake back.
    expect(html).toContain("Your picks: 3, 22");
  });

  it("renders without a player pool, a league, or an engine", () => {
    const noPlayers = baseState();
    noPlayers.allPlayers = [];
    expect(load(noPlayers).renderDraftRoom()).toContain("Sync first");

    const noLeague = baseState();
    noLeague.espn = {};
    expect(load(noLeague).renderDraftRoom()).toContain("Connect your ESPN league");
  });
});

describe("Draft Room: drafting", () => {
  let h: Harness;
  beforeEach(async () => {
    h = load(baseState());
    await ready(h);
  });

  it("sims to the user's pick and stops there", () => {
    h.DraftRoom.simToMyPick();
    const html = h.renderDraftRoom();
    // Team 3 is on the clock at pick 3, so two AI picks happened.
    expect(html).toContain("On the clock: Team 3");
    expect(html).toContain("3rd overall");
    expect(html).toContain("Larry's pick");
  });

  it("sims one pick at a time", () => {
    h.DraftRoom.simOne();
    expect(h.renderDraftRoom()).toContain("On the clock: Team 2");
    h.DraftRoom.simOne();
    expect(h.renderDraftRoom()).toContain("On the clock: Team 3");
  });

  // A player deep enough down the board that the first few AI picks cannot
  // have taken them.
  const DEEP_PLAYER = 2250;

  it("drafts a player, then undoes it back to the identical state", () => {
    h.DraftRoom.simToMyPick();
    const before = h.store.get("larry_mock_draft");

    const saved = JSON.parse(before as string);
    expect(saved.picks.length).toBe(2);

    h.DraftRoom.draftPlayer(DEEP_PLAYER);
    const mid = JSON.parse(h.store.get("larry_mock_draft") as string);
    expect(mid.picks.length).toBe(3);
    expect(mid.picks[2][2]).toBe(DEEP_PLAYER);
    expect(mid.picks[2][1]).toBe(3);

    h.DraftRoom.undo();
    const after = JSON.parse(h.store.get("larry_mock_draft") as string);
    expect(after.picks).toEqual(saved.picks);
    expect(after.seed).toBe(saved.seed);
  });

  it("refuses to draft a player who is already off the board", () => {
    h.DraftRoom.simToMyPick();
    const taken = JSON.parse(h.store.get("larry_mock_draft") as string).picks[0][2];

    // Trying to take someone an AI manager already drafted is a no-op, not
    // a duplicate entry.
    h.DraftRoom.draftPlayer(taken);
    const after = JSON.parse(h.store.get("larry_mock_draft") as string);
    expect(after.picks.length).toBe(2);

    const ids = after.picks.map((p: number[]) => p[2]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("restarts with a new seed and an empty board", () => {
    h.DraftRoom.simToMyPick();
    const before = JSON.parse(h.store.get("larry_mock_draft") as string);
    h.DraftRoom.restart();
    const after = JSON.parse(h.store.get("larry_mock_draft") as string);
    expect(after.picks).toEqual([]);
    expect(after.seed).not.toBe(before.seed);
  });

  it("runs a whole draft from pick 1 to the last pick", () => {
    h.DraftRoom.toggleAutoDraft();
    h.DraftRoom.simToMyPick();
    const saved = JSON.parse(h.store.get("larry_mock_draft") as string);
    expect(saved.picks.length).toBe(TEAMS * ROUNDS);

    const ids = saved.picks.map((p: number[]) => p[2]);
    expect(new Set(ids).size).toBe(ids.length);

    const html = h.renderDraftRoom();
    expect(html).toContain("Draft complete");
    expect(html).toContain(String(TEAMS * ROUNDS) + " picks");
  });

  it("survives a reload mid-mock by reading the saved state back", async () => {
    h.DraftRoom.simToMyPick();
    h.DraftRoom.draftPlayer(DEEP_PLAYER);
    const saved = h.store.get("larry_mock_draft") as string;
    expect(JSON.parse(saved).picks.length).toBe(3);

    // A fresh page load with the same localStorage.
    const reloaded = load(baseState());
    reloaded.store.set("larry_mock_draft", saved);
    const html = await ready(reloaded);
    expect(html).toContain("On the clock: Team 4");
    expect(JSON.parse(reloaded.store.get("larry_mock_draft") as string).picks.length).toBe(3);
  });
});

describe("Draft Room: profiles", () => {
  it("renders a profile card with bars, reach and the sample size", async () => {
    const league = makeLeague({
      seasons: [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
      categoryNoise: 0,
      strategies: {},
    });
    // The harness maps team t to member "Mt", which is what makeLeague uses.
    // The synthetic ADP stands in for the committed file.
    const h = load(baseState(), { history: league.history, adp: league.adp });
    await ready(h);

    h.DraftRoom.openTeam(5);
    const html = h.renderDraftRoom();

    expect(html).toContain("draft-bars");
    expect(html).toContain("8 drafts (2019 to 2026)");
    expect(html).toContain("How this is measured");
    expect(html).toContain("Mock roster");
    // The build banner is gone once profiles exist.
    expect(html).not.toContain("Build manager profiles");
    expect(html).toContain("Profiles from 8 drafts");

    // Reach needs the ADP file. Everyone drafted the board, so it is 0.
    expect(html).toContain("Drafts the board (median +0)");
    expect(html).toContain("No clear category lean");
  });

  it("drops the reach line rather than the page when the ADP file is unavailable", async () => {
    const league = makeLeague({ seasons: [2025, 2026], strategies: {} });
    // An empty ADP file: no player matches, so reach has no overlap.
    const h = load(baseState(), { history: league.history, adp: {} });
    const html = await ready(h);

    expect(html).toContain("Round 1, pick 1");
    h.DraftRoom.openTeam(5);
    const card = h.renderDraftRoom();
    expect(card).toContain("No ESPN ADP overlap");
    expect(card).toContain("draft-bars");
  });

  it("flags a small sample", async () => {
    const league = makeLeague({ seasons: [2025, 2026], strategies: {} });
    const h = load(baseState(), { history: league.history, adp: league.adp });
    await ready(h);
    h.DraftRoom.openTeam(5);
    expect(h.renderDraftRoom()).toContain("Small sample");
  });

  it("shows category totals and league ranks on a team's mock roster", async () => {
    const league = makeLeague({ seasons: [2025, 2026], strategies: {} });
    const h = load(baseState(), { history: league.history, adp: league.adp });
    await ready(h);
    h.DraftRoom.toggleAutoDraft();
    h.DraftRoom.simToMyPick();
    h.DraftRoom.openTeam(5);
    const html = h.renderDraftRoom();
    expect(html).toContain("draft-cat-totals");
    expect(html).toMatch(/\d+(st|nd|rd|th)/);
  });
});

describe("Draft Room: in-app model check", () => {
  it("reports both models on a held-out season", async () => {
    const league = makeLeague({
      seasons: [2022, 2023, 2024, 2025, 2026],
      strategies: {},
    });
    const h = load(baseState(), { history: league.history, adp: league.adp });
    await ready(h);

    h.DraftRoom.modelCheck();
    const html = h.DraftRoom.renderModelCheckCard();

    expect(html).toContain("Held-out season 2026");
    expect(html).toContain("With profiles");
    expect(html).toContain("Rank only");
    // A real log-likelihood, negative, and hit rates as percentages.
    expect(html).toMatch(/-\d+\.\d{3}/);
    expect(html).toMatch(/\d+%/);
  });

  it("asks for profiles first when there is no history", async () => {
    const h = load(baseState());
    await ready(h);
    h.DraftRoom.modelCheck();
    expect(h.DraftRoom.renderModelCheckCard()).toContain("Build manager profiles first");
  });

  it("refuses to test on the only draft it has", async () => {
    const league = makeLeague({ seasons: [2026], strategies: {} });
    const h = load(baseState(), { history: league.history, adp: league.adp });
    await ready(h);
    h.DraftRoom.modelCheck();
    expect(h.DraftRoom.renderModelCheckCard()).toContain("at least two drafts");
  });
});

describe("Draft Room: availability odds", () => {
  it("fills in the Avail column and never offers a stale number", async () => {
    const h = load(baseState());
    const html = await ready(h);
    expect(html).toContain("simulations");
    // The top of the board cannot survive to the user's pick.
    expect(html).toMatch(/\d+%/);
  });

  it("does not show 100% for everyone when the user is on the clock", async () => {
    // The bug: the odds were measured at the pick on the clock, which is
    // the current board, so every player read 100%.
    const h = load(baseState());
    await ready(h);

    // Team 3 is the user and picks 3rd, so put them on the clock.
    h.DraftRoom.simToMyPick();
    const html = h.renderDraftRoom();
    expect(html).toContain("On the clock: Team 3");

    // Team 3's next pick after pick 3 is pick 22 on the snake back, so the
    // column is measured there and says so.
    expect(html).toContain(">At 22<");
    expect(html).toContain("still being on the board at pick 22");

    // Count the percentages in the Avail column. If the bug were back,
    // every one of them would be 100%.
    const percents = (html.match(/>(\d+)%</g) || []).map((m) =>
      Number(m.replace(/[^0-9]/g, "")),
    );
    expect(percents.length).toBeGreaterThan(10);
    expect(percents.filter((p) => p === 100).length).toBeLessThan(percents.length);
    // And the very top of the board cannot survive 19 more picks.
    expect(Math.min(...percents)).toBe(0);
  });

  it("labels the column with the next pick when the user is NOT on the clock", async () => {
    const h = load(baseState());
    const html = await ready(h);
    // Team 1 is on the clock at pick 1; team 3's next pick is pick 3.
    expect(html).toContain(">At 3<");
  });
});

describe("Draft Room: Larry's pick", () => {
  it("tells the user to take the scarce player when Larry's top can wait", async () => {
    const h = load(baseState());
    await ready(h);
    h.DraftRoom.simToMyPick();
    const html = h.renderDraftRoom();

    expect(html).toContain("Larry's pick");

    // Either it recommends the top player outright, or it fires the
    // can-wait advice. Both are valid; what must never happen is the old
    // behaviour, where the advice could not fire at all because it looked
    // for a player ranked above the top-ranked player.
    if (html.indexOf("so take") >= 0) {
      expect(html).toMatch(/is \d+% likely to be there at pick 22, so take .+ now\./);
      // The player it tells you to take is the one on the Draft button.
      const take = html.match(/so take (.+?) now\./);
      const button = html.match(/>Draft (.+?)<\/button>/);
      expect(take?.[1]).toBe(button?.[1]);
    } else {
      expect(html).toMatch(/>Draft .+?<\/button>/);
    }
  });

  it("recommends a player who is actually still available", async () => {
    const h = load(baseState());
    await ready(h);
    h.DraftRoom.simToMyPick();
    const html = h.renderDraftRoom();

    const id = Number((html.match(/DraftRoom\.draftPlayer\((\d+)\)">Draft/) || [])[1]);
    expect(Number.isFinite(id)).toBe(true);

    const taken = JSON.parse(h.store.get("larry_mock_draft") as string).picks.map(
      (p: number[]) => p[2],
    );
    expect(taken).not.toContain(id);

    // And drafting it works.
    h.DraftRoom.draftPlayer(id);
    const after = JSON.parse(h.store.get("larry_mock_draft") as string);
    expect(after.picks[after.picks.length - 1][2]).toBe(id);
  });
});
