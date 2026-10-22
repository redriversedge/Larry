// What rankings v3.1 change A does to the LIVE in-season board.
//
// docs/RANKINGS_V3_1_INSEASON_SPEC.md section 7 asks for the board's before
// and after for a named list of players. The backtest answers "is this
// better on average over two seasons"; this answers "what does the owner
// actually see tomorrow morning", which is a different and equally fair
// question.
//
// Runs js/engines.js itself, with the real src/engine wired in as
// window.LarryEngine, so the numbers come from the shipping code path and
// not from a reimplementation of it. The only difference between the two
// boards is the option change A introduced:
//
//   before   computeBaseValues(..., unprojectedPrior: "poolMean")
//   after    computeBaseValues(..., unprojectedPrior: "replacement")
//
// Needs an in-season snapshot. Build one from a public kona fetch, no login
// required:
//
//   curl -H 'x-fantasy-filter: {"players":{"limit":1000,
//     "sortPercOwned":{"sortAsc":false,"sortPriority":1}}}' \
//     'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027\
//      /segments/0/leaguedefaults/3?view=kona_player_info' -o kona.json
//   npx tsx tools/kona-to-snapshot.ts kona.json 2027 \
//     tests/fixtures/users/inseason-2027-snapshot.json
//   npx tsx tools/inseason-board-diff.ts <scoringPeriodId> [snapshot]
//
// Snapshots live under tests/fixtures/users/, which is git-ignored.

import * as fs from "fs";
import * as path from "path";
import * as LarryEngine from "../src/engine/index";

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_SNAPSHOT = "tests/fixtures/users/inseason-2027-snapshot.json";
const CATS = ["REB", "AST", "STL", "BLK", "PTS"];
const BOARD_DEPTH = 150;

// The players section 1 of the spec names, plus the four it says were
// pushed out of the top 150.
const NAMED = [
  "Kobe Sanders", "Emanuel Sharp", "Sion James", "Josh Okogie",
  "Anthony Davis", "Trae Young", "Jayson Tatum",
  "Darius Garland", "Stephon Castle", "Kevin Porter Jr.", "AJ Dybantsa",
];

interface Snapshot {
  league?: { seasonId?: number; teamCount?: number; rosterSize?: number };
  allPlayers: any[];
}

// Load engines.js with the globals it closes over, the way the vitest suite
// does. fetch is pointed at the committed data files so the durability
// history reaches expectedRemainingGames exactly as it does in the browser.
function loadEngines(state: any, unprojectedPrior: "poolMean" | "replacement") {
  const src = fs.readFileSync(path.join(ROOT, "js/engines.js"), "utf8");
  const sandbox: any = { S: state };
  sandbox.window = sandbox;
  sandbox.LarryEngine = {
    ...LarryEngine,
    // The one line under test. Everything else is the shipping engine.
    computeBaseValues: (players: any, opts: any) =>
      LarryEngine.computeBaseValues(players, { ...opts, unprojectedPrior }),
  };
  const getOrderedCategories = () =>
    CATS.map((abbr) => ({ abbr, isNegative: false, isPercent: false }));
  const fmt = (n: number, d: number) => Number(n).toFixed(d);
  const ESPNSync = { splitGP: () => 0 };
  const durantKey = (v: unknown) =>
    (v === null || v === undefined ? -Infinity : (v as number));
  const durantText = (v: unknown, d = 1) =>
    (v === null || v === undefined ? "--" : Number(v).toFixed(d));
  const isPreseason = () => false;
  const localDateStr = () => new Date().toISOString().slice(0, 10);
  const localFetch = (url: string) => {
    const file = path.join(ROOT, url.replace(/^\//, ""));
    if (!fs.existsSync(file)) return Promise.resolve({ ok: false, json: () => null });
    return Promise.resolve({ ok: true, json: () => JSON.parse(fs.readFileSync(file, "utf8")) });
  };
  const fn = new Function(
    "window", "S", "getOrderedCategories", "fmt", "console", "document", "ESPNSync",
    "durantKey", "durantText", "isPreseason", "localDateStr", "fetch",
    src + "\n; window.Engines = Engines; return window.Engines;",
  );
  return fn(sandbox, state, getOrderedCategories, fmt, console,
    { querySelectorAll: () => [] }, ESPNSync, durantKey, durantText, isPreseason,
    localDateStr, localFetch);
}

function hasProjection(p: any): boolean {
  const proj = p.stats && p.stats.projectedSeason;
  if (!proj) return false;
  return CATS.some((c) => typeof proj[c] === "number" && proj[c] !== 0);
}

async function buildBoard(
  snap: Snapshot,
  period: number,
  unprojectedPrior: "poolMean" | "replacement",
): Promise<Map<number, any>> {
  // A deep-enough copy that the two runs cannot see each other's fields.
  const players = JSON.parse(JSON.stringify(snap.allPlayers));
  const state: any = {
    league: {
      seasonId: snap.league?.seasonId ?? 2027,
      teamCount: snap.league?.teamCount ?? 12,
      rosterSize: snap.league?.rosterSize ?? 13,
      currentScoringPeriodId: period,
    },
    espn: { lastSync: new Date().toISOString() },
    myTeam: { teamId: 1, players: [] },
    teams: [],
    matchup: {},
    allPlayers: players,
    prefs: {},
    analysisCache: {},
  };
  const Engines = loadEngines(state, unprojectedPrior);
  await Engines.loadPreseasonData();
  Engines.computeDURANT(players, { preseason: false });
  const byId = new Map<number, any>();
  for (const p of players) byId.set(p.id, p);
  return byId;
}

function pad(s: string | number, n: number): string {
  return String(s).padStart(n);
}

async function main(): Promise<void> {
  const periodArg = Number(process.argv[2]);
  if (!(periodArg > 0)) {
    console.error("usage: npx tsx tools/inseason-board-diff.ts <scoringPeriodId> [snapshot]");
    console.error("  scoringPeriodId is a DAY: 1 is opening night.");
    process.exit(2);
  }
  const snapPath = path.resolve(process.argv[3] ?? DEFAULT_SNAPSHOT);
  if (!fs.existsSync(snapPath)) {
    console.error("Snapshot not found: " + snapPath);
    console.error("Build one with tools/kona-to-snapshot.ts; see the header of this file.");
    process.exit(1);
  }
  const snap = JSON.parse(fs.readFileSync(snapPath, "utf8")) as Snapshot;

  const before = await buildBoard(snap, periodArg, "poolMean");
  const after = await buildBoard(snap, periodArg, "replacement");

  const played = snap.allPlayers.filter((p) => (p.gamesPlayed || 0) > 0).length;
  const projected = snap.allPlayers.filter(hasProjection).length;

  console.log("=".repeat(78));
  console.log("Live in-season board: change A, before and after");
  console.log("=".repeat(78));
  console.log("Snapshot: " + snapPath);
  console.log(
    "  players " + snap.allPlayers.length + ", with an ESPN projection " +
      projected + ", with games already played " + played,
  );
  console.log("  scoring period " + periodArg + " (period 1 is opening night)");
  console.log("");

  // --- The headline: unprojected players in the top 150 ------------------
  const topOf = (board: Map<number, any>): any[] =>
    Array.from(board.values())
      .filter((p) => p.durantRank && p.durantRank <= BOARD_DEPTH)
      .sort((a, b) => a.durantRank - b.durantRank);

  for (const [label, board] of [["before", before], ["after", after]] as const) {
    const top = topOf(board);
    const unproj = top.filter((p) => !hasProjection(p));
    console.log(
      label.padEnd(7) + " unprojected players inside the top " + BOARD_DEPTH +
        ": " + unproj.length + " of " + top.length,
    );
    if (unproj.length && unproj.length <= 12) {
      for (const p of unproj) {
        console.log(
          "          #" + pad(p.durantRank, 3) + "  " + p.name +
            "  (" + (p.gamesPlayed || 0) + " g)",
        );
      }
    }
  }
  console.log("");

  // --- The named players --------------------------------------------------
  const byName = new Map<string, number>();
  for (const p of snap.allPlayers) byName.set(p.name, p.id);

  console.log("-".repeat(78));
  console.log("  player                    before   after    move   g   proj GP");
  console.log("-".repeat(78));
  for (const name of NAMED) {
    const id = byName.get(name);
    if (id === undefined) {
      console.log("  " + name.padEnd(24) + "  not in snapshot");
      continue;
    }
    const b = before.get(id) as any;
    const a = after.get(id) as any;
    const move = b.durantRank - a.durantRank;
    const projGP = (a.stats && a.stats.projectedGP) || 0;
    console.log(
      "  " + name.padEnd(24) + pad("#" + b.durantRank, 7) +
        pad("#" + a.durantRank, 8) + pad((move > 0 ? "+" : "") + move, 8) +
        pad(a.gamesPlayed || 0, 4) + pad(hasProjection(a) ? projGP || "--" : "none", 10),
    );
  }
  console.log("");

  // --- The twenty largest moves ------------------------------------------
  const moves = snap.allPlayers
    .map((p) => {
      const b = before.get(p.id) as any;
      const a = after.get(p.id) as any;
      return { name: p.name, b: b.durantRank, a: a.durantRank, gp: p.gamesPlayed || 0,
        proj: hasProjection(p), move: b.durantRank - a.durantRank };
    })
    .sort((x, y) => Math.abs(y.move) - Math.abs(x.move))
    .slice(0, 20);
  console.log("-".repeat(78));
  console.log("Twenty largest moves");
  console.log("-".repeat(78));
  for (const m of moves) {
    console.log(
      "  " + m.name.padEnd(24) + pad("#" + m.b, 7) + pad("#" + m.a, 8) +
        pad((m.move > 0 ? "+" : "") + m.move, 8) + pad(m.gp, 4) +
        "  " + (m.proj ? "projected" : "UNPROJECTED"),
    );
  }
  console.log("");

  // Nothing that is projected should move far. Change A only reaches
  // players ESPN has no opinion about; everyone else moves only because
  // those players got out of the way.
  const projectedMoves = moves.filter((m) => m.proj);
  console.log(
    "Largest move by a PROJECTED player: " +
      (projectedMoves.length
        ? projectedMoves[0]!.name + " " + projectedMoves[0]!.move + " places"
        : "none in the top 20"),
  );
}

main();
