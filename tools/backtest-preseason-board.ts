// Score preseason boards against what players actually did.
// docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md A1.
//
// Every earlier measurement of the preseason board compared it to the
// expert consensus, which only answers "does Larry agree with the experts".
// This answers the question that matters: of the players Larry put in the
// first three rounds, how many were actually worth a first-three-round
// pick. The experts are scored here too, as one comparison among several,
// not as the target.
//
// Ground truth for a season is that season's real 5-category value, built
// the same way the board is built but from actual production.
//
// All inputs are public: ESPN's own preseason projections and box scores
// (tests/fixtures/projections/espn-history.json) and FantasyPros ECR and
// ADP (data/preseason-rankings-history.json). No league data.
//
// Run: npx tsx tools/backtest-preseason-board.ts
//      npx tsx tools/backtest-preseason-board.ts --write   (updates the doc)

import * as fs from "fs";
import * as path from "path";

import {
  applyPreseasonDiscount,
  computeBaseValues,
  type BaseValueInput,
} from "../src/engine/zscore";
import { expectedGames, type DurabilityInput } from "../src/engine/durability";
import { seasonValues } from "../src/engine/replacement";
import { CATEGORIES, type Category, type CategoryVector } from "../src/shared/types";
import { PRESEASON_SUSPECT_GP } from "../src/engine/constants";

const ROOT = path.resolve(__dirname, "..");
const HISTORY = path.join(ROOT, "tests/fixtures/projections/espn-history.json");
const RANKINGS = path.join(ROOT, "data/preseason-rankings-history.json");
const REPORT = path.join(ROOT, "docs/RANKINGS_V3_BACKTEST.md");

const SEASONS = [2025, 2026];
const TEAM_COUNT = 12;
const ROSTER_SIZE = 13;
const POOL_SIZE = TEAM_COUNT * ROSTER_SIZE; // 156
const BOARD_DEPTH = 150;
const TOP_ROUNDS_2 = 24;
// A drafted player who never played is not "unranked", he is a zero.
const MISSED_SEASON_RANK = 500;
const BOOTSTRAP_RESAMPLES = 1000;

// --- Fixture types ---

interface SeasonLine {
  GP: number; MIN: number; REB: number; AST: number;
  STL: number; BLK: number; PTS: number;
}

interface HistoryPlayer {
  id: number;
  name: string;
  proTeamId: number;
  actual: Record<string, SeasonLine>;
  espnProjection: Record<string, SeasonLine>;
}

interface History {
  seasons: number[];
  players: HistoryPlayer[];
}

type RankRow = [string, number];
interface SeasonBoards {
  ecr: RankRow[];
  yahooAdp: RankRow[];
  espnAdp: RankRow[];
  experts: number;
}

// --- Small helpers ---

function norm(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 1;
  const m = mean(xs);
  let sq = 0;
  for (const x of xs) sq += (x - m) * (x - m);
  return Math.max(Math.sqrt(sq / (xs.length - 1)), 1e-9);
}

// Spearman with average ranks for ties.
function spearman(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const rank = (xs: number[]): number[] => {
    const order = xs.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]);
    const out = new Array<number>(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && (order[j + 1] as [number, number])[0] === (order[i] as [number, number])[0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) out[(order[k] as [number, number])[1]] = avg;
      i = j + 1;
    }
    return out;
  };
  const ra = rank(a);
  const rb = rank(b);
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = (ra[i] as number) - ma;
    const y = (rb[i] as number) - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

// Deterministic PRNG so the bootstrap is reproducible.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Ground truth ---
//
// Two passes, matching how the board itself defines a reference pool: pass
// one scores everyone against the whole population, pass two recomputes the
// mean and standard deviation from the top POOL_SIZE of pass one. Without
// the second pass the distribution is dominated by deep bench players and
// every starter looks identical.

function twoPassValue(
  rows: Array<{ id: number; vec: CategoryVector }>,
): Map<number, number> {
  const score = (stats: { m: CategoryVector; s: CategoryVector }): Map<number, number> => {
    const out = new Map<number, number>();
    for (const r of rows) {
      let v = 0;
      for (const c of CATEGORIES) v += (r.vec[c] - stats.m[c]) / stats.s[c];
      out.set(r.id, v);
    }
    return out;
  };
  const statsOf = (subset: Array<{ vec: CategoryVector }>) => {
    const m = {} as CategoryVector;
    const s = {} as CategoryVector;
    for (const c of CATEGORIES) {
      const vals = subset.map((r) => r.vec[c]);
      m[c] = mean(vals);
      s[c] = stdev(vals);
    }
    return { m, s };
  };

  const pass1 = score(statsOf(rows));
  const top = rows
    .slice()
    .sort((a, b) => (pass1.get(b.id) as number) - (pass1.get(a.id) as number))
    .slice(0, POOL_SIZE);
  return score(statsOf(top));
}

interface Truth {
  // id -> actual rank, 1 best.
  seasonRank: Map<number, number>;
  perGameRank: Map<number, number>;
  nameToId: Map<string, number>;
  nameById: Map<number, string>;
}

function buildTruth(history: History, season: number): Truth {
  const key = String(season);
  const played = history.players.filter((p) => (p.actual[key]?.GP ?? 0) > 0);

  const totals = played.map((p) => {
    const a = p.actual[key] as SeasonLine;
    return {
      id: p.id,
      vec: { REB: a.REB, AST: a.AST, STL: a.STL, BLK: a.BLK, PTS: a.PTS } as CategoryVector,
    };
  });
  const seasonValue = twoPassValue(totals);

  const rates = played
    .filter((p) => (p.actual[key] as SeasonLine).GP >= 25)
    .map((p) => {
      const a = p.actual[key] as SeasonLine;
      return {
        id: p.id,
        vec: {
          REB: a.REB / a.GP, AST: a.AST / a.GP, STL: a.STL / a.GP,
          BLK: a.BLK / a.GP, PTS: a.PTS / a.GP,
        } as CategoryVector,
      };
    });
  const perGameValue = twoPassValue(rates);

  const toRanks = (vals: Map<number, number>): Map<number, number> => {
    const sorted = Array.from(vals.entries()).sort((a, b) => b[1] - a[1]);
    const out = new Map<number, number>();
    sorted.forEach(([id], i) => out.set(id, i + 1));
    return out;
  };

  const nameToId = new Map<string, number>();
  const nameById = new Map<number, string>();
  for (const p of history.players) {
    const n = norm(p.name);
    if (n && !nameToId.has(n)) nameToId.set(n, p.id);
    nameById.set(p.id, p.name);
  }

  return {
    seasonRank: toRanks(seasonValue),
    perGameRank: toRanks(perGameValue),
    nameToId,
    nameById,
  };
}

// --- Boards ---

// A board is an ordered list of player ids, best first.
type Board = number[];

function projectedRate(line: SeasonLine): CategoryVector | null {
  if (!(line.GP > 0)) return null;
  return {
    REB: line.REB / line.GP, AST: line.AST / line.GP, STL: line.STL / line.GP,
    BLK: line.BLK / line.GP, PTS: line.PTS / line.GP,
  };
}

interface Candidate {
  id: number;
  rate: CategoryVector;
  espnGP: number;
  priorGP: number[];
}

function candidatesFor(history: History, season: number): Candidate[] {
  const key = String(season);
  const out: Candidate[] = [];
  for (const p of history.players) {
    const proj = p.espnProjection[key];
    if (!proj) continue;
    const rate = projectedRate(proj);
    if (!rate) continue;
    // Actual games in the three seasons before this one, most recent first.
    // A season the player was not in the league is absent, not zero.
    const priorGP: number[] = [];
    for (let s = season - 1; s >= season - 3; s--) {
      const line = p.actual[String(s)];
      if (line) priorGP.push(line.GP);
    }
    out.push({ id: p.id, rate, espnGP: proj.GP, priorGP });
  }
  return out;
}

// The CURRENT shipped preseason board, built by calling the shipped engine
// rather than reimplementing it. js/engines.js v2PreseasonInput builds
// exactly this input shape and then applies the same discount.
function currentBoard(cands: Candidate[]): { board: Board; score: Map<number, number> } {
  const inputs: BaseValueInput[] = cands.map((c) => ({
    id: String(c.id),
    gamesPlayed: 0,
    perGame: c.rate,
    projectedPerGame: c.rate,
  }));
  const result = computeBaseValues(inputs, {
    categories: CATEGORIES,
    rosterSize: ROSTER_SIZE,
  });

  const byId = new Map<string, number>();
  for (const row of result.rows) byId.set(row.id, row.baseValue);

  const score = new Map<number, number>();
  for (const c of cands) {
    const base = byId.get(String(c.id)) ?? 0;
    // The app's suspect test also requires status !== OUT. Past-season
    // injury status is not in the fixture; every player under 10 projected
    // games is treated as suspect, which is the app's behaviour for all but
    // the handful ESPN tagged OUT, and none of them are near the top 150.
    const suspect = c.espnGP > 0 && c.espnGP < PRESEASON_SUSPECT_GP;
    score.set(c.id, applyPreseasonDiscount(base, c.espnGP, suspect));
  }

  const board = cands
    .slice()
    .sort((a, b) => (score.get(b.id) as number) - (score.get(a.id) as number))
    .map((c) => c.id);
  return { board, score };
}

// Board v3: durability-adjusted expected games, and value measured against
// the replacement player rather than against an average starter.
export interface V3Options {
  k?: number;
  w?: number;
}

function v3Board(
  cands: Candidate[],
  opts: V3Options = {},
): { board: Board; score: Map<number, number>; expGP: Map<number, number> } {
  const leagueMeanGP = mean(
    cands.filter((c) => c.espnGP >= 20).flatMap((c) => c.priorGP),
  );

  const expGP = new Map<number, number>();
  for (const c of cands) {
    const input: DurabilityInput = {
      espnGP: c.espnGP,
      priorGP: c.priorGP,
      leagueMeanGP,
      onTeam: true,
    };
    expGP.set(c.id, expectedGames(input, opts));
  }

  // rateValue uses exactly the shipped per-game z, so the only differences
  // from the current board are the games model and the replacement level.
  const inputs: BaseValueInput[] = cands.map((c) => ({
    id: String(c.id),
    gamesPlayed: 0,
    perGame: c.rate,
    projectedPerGame: c.rate,
  }));
  const result = computeBaseValues(inputs, {
    categories: CATEGORIES,
    rosterSize: ROSTER_SIZE,
  });
  const rateById = new Map<number, number>();
  for (const row of result.rows) rateById.set(Number(row.id), row.baseValue);

  const score = seasonValues(
    cands.map((c) => ({
      id: c.id,
      rateValue: rateById.get(c.id) ?? 0,
      expectedGP: expGP.get(c.id) ?? 0,
      suspect: c.espnGP > 0 && c.espnGP < PRESEASON_SUSPECT_GP,
    })),
    POOL_SIZE,
  );

  const board = cands
    .slice()
    .sort((a, b) => (score.get(b.id) as number) - (score.get(a.id) as number))
    .map((c) => c.id);
  return { board, score, expGP };
}

function externalBoard(rows: RankRow[], truth: Truth): { board: Board; unmatched: number } {
  const board: Board = [];
  let unmatched = 0;
  const seen = new Set<number>();
  for (const [name] of rows) {
    const id = truth.nameToId.get(name);
    if (id === undefined) {
      unmatched++;
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    board.push(id);
  }
  return { board, unmatched };
}

// --- Metrics ---

interface Metrics {
  label: string;
  matched: number;
  unmatched: number;
  seasonRho: number;
  perGameRho: number;
  top100Hits: number;
  top50Busts: number;
  avgActualTop24: number;
}

function actualRankOf(truth: Truth, id: number, perGame: boolean): number {
  const m = perGame ? truth.perGameRank : truth.seasonRank;
  // Not in the truth map means the player did not play (or did not clear
  // the per-game games floor). That is an outcome, not missing data.
  return m.get(id) ?? MISSED_SEASON_RANK;
}

function score(label: string, board: Board, truth: Truth, unmatched: number): Metrics {
  const top = board.slice(0, BOARD_DEPTH);
  const boardRank = top.map((_, i) => i + 1);
  const seasonActual = top.map((id) => actualRankOf(truth, id, false));
  const perGameActual = top.map((id) => actualRankOf(truth, id, true));

  const top100 = board.slice(0, 100);
  const top100Hits = top100.filter((id) => actualRankOf(truth, id, false) <= 100).length;
  const top50 = board.slice(0, 50);
  const top50Busts = top50.filter((id) => actualRankOf(truth, id, false) > 150).length;
  const top24 = board.slice(0, TOP_ROUNDS_2);
  const avgActualTop24 = mean(top24.map((id) => Math.min(actualRankOf(truth, id, false), 300)));

  return {
    label,
    matched: top.length,
    unmatched,
    seasonRho: spearman(boardRank, seasonActual),
    perGameRho: spearman(boardRank, perGameActual),
    top100Hits,
    top50Busts,
    avgActualTop24,
  };
}

// Paired bootstrap over the players the two boards share, so a 0.01 change
// is not mistaken for progress.
function pairedBootstrap(a: Board, b: Board, truth: Truth, seed: number): number {
  const rankIn = (board: Board): Map<number, number> => {
    const m = new Map<number, number>();
    board.slice(0, BOARD_DEPTH).forEach((id, i) => m.set(id, i + 1));
    return m;
  };
  const ra = rankIn(a);
  const rb = rankIn(b);
  const shared = Array.from(ra.keys()).filter((id) => rb.has(id));
  if (shared.length < 10) return 0;

  const next = rng(seed);
  let wins = 0;
  for (let i = 0; i < BOOTSTRAP_RESAMPLES; i++) {
    const idx: number[] = [];
    for (let j = 0; j < shared.length; j++) {
      idx.push(Math.floor(next() * shared.length));
    }
    const ids = idx.map((j) => shared[j] as number);
    const actual = ids.map((id) => actualRankOf(truth, id, false));
    const rhoA = spearman(ids.map((id) => ra.get(id) as number), actual);
    const rhoB = spearman(ids.map((id) => rb.get(id) as number), actual);
    if (rhoA > rhoB) wins++;
  }
  return wins / BOOTSTRAP_RESAMPLES;
}

// --- Report ---

const NAMED_BUSTS: Record<number, string[]> = {
  2025: ["Zion Williamson", "Kawhi Leonard", "Ja Morant", "Paolo Banchero"],
  2026: ["Joel Embiid", "Ja Morant", "Zion Williamson", "Jaren Jackson Jr."],
};

const NAMED_WINS: Record<number, string[]> = {
  2025: ["Alperen Sengun", "Cade Cunningham", "Bam Adebayo"],
  2026: ["Amen Thompson", "Dyson Daniels", "Bam Adebayo"],
};

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function fmt(n: number, d = 3): string {
  return Number.isFinite(n) ? n.toFixed(d) : "n/a";
}

function main(): void {
  if (!fs.existsSync(HISTORY)) {
    console.error("Missing " + HISTORY + ". Run: npx tsx tools/fetch-espn-history.ts");
    process.exit(1);
  }
  if (!fs.existsSync(RANKINGS)) {
    console.error(
      "Missing " + RANKINGS + ". Run: npx tsx tools/fetch-preseason-rankings-history.ts",
    );
    process.exit(1);
  }

  const history = JSON.parse(fs.readFileSync(HISTORY, "utf8")) as History;
  const rankings = JSON.parse(fs.readFileSync(RANKINGS, "utf8")) as Record<string, SeasonBoards>;

  const lines: string[] = [];
  const say = (s = ""): void => {
    console.log(s);
    lines.push(s);
  };

  say("# Preseason board backtest");
  say("");
  say("Generated by `npx tsx tools/backtest-preseason-board.ts`.");
  say("");
  say(
    "Ground truth is each season's real 5-category value: z of season totals " +
      "per category, two passes, the second using the mean and standard " +
      "deviation of the top " + POOL_SIZE + " from the first. A board's top " +
      BOARD_DEPTH + " is scored against it. A drafted player who never played " +
      "gets actual rank " + MISSED_SEASON_RANK + ".",
  );
  say("");

  const summary: Record<number, Record<string, Metrics>> = {};
  const bootstrapBySeason: Record<number, number> = {};

  for (const season of SEASONS) {
    const truth = buildTruth(history, season);
    const cands = candidatesFor(history, season);
    const boards = rankings[String(season)];

    say("## Season " + season + " (" + (season - 1) + "-" + String(season).slice(2) + ")");
    say("");
    say(
      "Players with an ESPN preseason projection: " + cands.length +
        ". Players with actual production: " + truth.seasonRank.size + ".",
    );
    say("");

    const current = currentBoard(cands);
    const v3 = v3Board(cands);

    const rows: Metrics[] = [score("Larry current", current.board, truth, 0)];
    rows.push(score("Larry v3", v3.board, truth, 0));

    if (boards) {
      const ecr = externalBoard(boards.ecr, truth);
      rows.push(score("FantasyPros ECR", ecr.board, truth, ecr.unmatched));
      const yahoo = externalBoard(boards.yahooAdp, truth);
      rows.push(score("Yahoo ADP", yahoo.board, truth, yahoo.unmatched));
      const espn = externalBoard(boards.espnAdp, truth);
      rows.push(score("ESPN ADP", espn.board, truth, espn.unmatched));
    }

    summary[season] = {};
    for (const r of rows) summary[season][r.label] = r;

    say("| Board | season rho | per-game rho | top-100 hits | top-50 busts | avg actual rank of top 24 | unmatched |");
    say("|---|---|---|---|---|---|---|");
    for (const r of rows) {
      say(
        "| " + r.label + " | " + fmt(r.seasonRho) + " | " + fmt(r.perGameRho) +
          " | " + r.top100Hits + " | " + r.top50Busts + " | " +
          r.avgActualTop24.toFixed(1) + " | " + r.unmatched + " |",
      );
    }
    say("");

    const winRate = pairedBootstrap(v3.board, current.board, truth, season);
    bootstrapBySeason[season] = winRate;
    say(
      "Paired bootstrap, v3 against current, " + BOOTSTRAP_RESAMPLES +
        " resamples of the shared players: **v3 ahead in " +
        (winRate * 100).toFixed(1) + "%**.",
    );
    say("");

    // Named players, so the specific failures in the spec are visible.
    const rankOnBoard = (board: Board, id: number): string => {
      const i = board.indexOf(id);
      return i < 0 ? "--" : String(i + 1);
    };
    say("| Player | current board | v3 board | exp GP (v3) | ESPN proj GP | actual GP | actual finish |");
    say("|---|---|---|---|---|---|---|");
    for (const group of [NAMED_BUSTS[season] ?? [], NAMED_WINS[season] ?? []]) {
      for (const name of group) {
        const id = truth.nameToId.get(norm(name));
        if (id === undefined) {
          say("| " + name + " | not in fixture | | | | | |");
          continue;
        }
        const player = history.players.find((p) => p.id === id);
        const proj = player?.espnProjection[String(season)];
        const act = player?.actual[String(season)];
        say(
          "| " + name + " | " + rankOnBoard(current.board, id) + " | " +
            rankOnBoard(v3.board, id) + " | " +
            (v3.expGP.get(id) ?? 0).toFixed(0) + " | " +
            (proj ? proj.GP.toFixed(0) : "--") + " | " +
            (act ? act.GP.toFixed(0) : "0") + " | " +
            actualRankOf(truth, id, false) + " |",
        );
      }
    }
    say("");
  }

  // --- A4 gates ---
  say("## A4 gates");
  say("");
  const gateRows: string[] = [];
  let gate1 = true;
  let gate2 = true;
  let gate3 = true;
  for (const season of SEASONS) {
    const cur = summary[season]?.["Larry current"];
    const v3m = summary[season]?.["Larry v3"];
    if (!cur || !v3m) continue;
    const rhoUp = v3m.seasonRho > cur.seasonRho;
    const boot = bootstrapBySeason[season] ?? 0;
    const top24Up = v3m.avgActualTop24 < cur.avgActualTop24;
    const pgDrop = cur.perGameRho - v3m.perGameRho;
    if (!rhoUp || boot < 0.8) gate1 = false;
    if (!top24Up) gate2 = false;
    if (pgDrop > 0.02) gate3 = false;
    gateRows.push(
      "| 1 | " + season + " | v3 season rho above current, bootstrap >= 80% | " +
        fmt(cur.seasonRho) + " -> " + fmt(v3m.seasonRho) + ", boot " +
        (boot * 100).toFixed(1) + "% | " + (rhoUp && boot >= 0.8 ? "PASS" : "**FAIL**") + " |",
    );
    gateRows.push(
      "| 2 | " + season + " | avg actual rank of top 24 improves | " +
        cur.avgActualTop24.toFixed(1) + " -> " + v3m.avgActualTop24.toFixed(1) +
        " | " + (top24Up ? "PASS" : "**FAIL**") + " |",
    );
    gateRows.push(
      "| 3 | " + season + " | per-game rho drops by at most 0.02 | " +
        fmt(cur.perGameRho) + " -> " + fmt(v3m.perGameRho) + " | " +
        (pgDrop <= 0.02 ? "PASS" : "**FAIL**") + " |",
    );
  }
  say("| Gate | Season | Condition | Measured | Result |");
  say("|---|---|---|---|---|");
  for (const r of gateRows) say(r);
  say("");
  say(
    "Gates 3 (named winners inside the top 36) and 4 (named busts each move " +
      "down) are read off the per-season player tables above.",
  );
  say("");

  // --- Reference reconciliation, the hard gate before anything is tuned ---
  const REFERENCE: Record<number, number> = { 2025: 0.484, 2026: 0.448 };
  const REF_TOP24: Record<number, number> = { 2025: 52.9, 2026: 76.6 };

  say("## Reconciliation against the reviewer's numbers");
  say("");
  say("| Season | metric | reviewer | this tool | delta |");
  say("|---|---|---|---|---|");
  let reconciled = true;
  for (const season of SEASONS) {
    const cur = summary[season]?.["Larry current"];
    if (!cur) continue;
    const dRho = cur.seasonRho - (REFERENCE[season] as number);
    const dTop = cur.avgActualTop24 - (REF_TOP24[season] as number);
    say(
      "| " + season + " | current board season rho | " + fmt(REFERENCE[season] as number) +
        " | " + fmt(cur.seasonRho) + " | " + (dRho >= 0 ? "+" : "") + fmt(dRho) + " |",
    );
    say(
      "| " + season + " | current board avg top 24 | " + (REF_TOP24[season] as number).toFixed(1) +
        " | " + cur.avgActualTop24.toFixed(1) + " | " + (dTop >= 0 ? "+" : "") +
        dTop.toFixed(1) + " |",
    );
    if (Math.abs(dRho) > 0.02) reconciled = false;
  }
  say("");
  say(
    reconciled
      ? "**Reconciled**: the current board reproduces within +/- 0.02 in both seasons."
      : "**NOT RECONCILED**: the current board is outside +/- 0.02 of the reviewer's " +
        "numbers. Per the spec, stop and reconcile before tuning anything.",
  );
  say("");

  if (process.argv.includes("--write")) {
    fs.writeFileSync(REPORT, lines.join("\n") + "\n");
    console.log("\nWrote " + REPORT);
  }

  if (!reconciled) process.exit(1);
}

if (require.main === module) {
  main();
}
