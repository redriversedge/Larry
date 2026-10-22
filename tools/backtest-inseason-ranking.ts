// In-season ranking backtest.
// docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md C2 and C3, extended by
// docs/RANKINGS_V3_1_INSEASON_SPEC.md section 4.
//
// Mid-season the question is not "who is the better player" but "who will
// produce more from today to the end of the season". Those differ whenever
// a player's remaining availability differs: a 40-minute star with a
// chronic knee is a better player and a worse rest-of-season asset than a
// durable starter. That is settled; the shipped score is
//
//   rosValue = (rateValue - replacement) * expectedRemainingGames / 82
//
// What this file now measures is the two v3.1 changes to the rateValue that
// feeds it, each as a whole BOARD rather than as a scoring form:
//
//   old board   unprojected players shrink to the pool mean, and the
//               shrink prior is ESPN's projected totals over 82
//   A           unprojected players shrink to the replacement-level line
//   A+B         ... and the prior is totals over ESPN's projected GAMES,
//               so availability is counted once rather than twice
//
// Seven checkpoints per season, two seasons, scored against what actually
// happened after each one. Everything before a checkpoint is input,
// everything after it is truth. Nothing leaks.
//
// The three early checkpoints exist because the four original ones cannot
// SEE problem A: the earliest was week 3 and it dropped anyone with fewer
// than 5 games, which is most of the players a one-game sample ruins.
//
// Needs tests/fixtures/projections/game-logs-<season>.json (public,
// committed) from tools/fetch-game-logs.ts, plus the ESPN history fixture
// for preseason projections and prior-season games.
//
// Run: npx tsx tools/backtest-inseason-ranking.ts
//      npx tsx tools/backtest-inseason-ranking.ts --write

import * as fs from "fs";
import * as path from "path";

import { computeBaseValues, type BaseValueInput } from "../src/engine/zscore";
import { weightedHistory } from "../src/engine/durability";
import { replacementLevel } from "../src/engine/replacement";
import { CATEGORIES, type CategoryVector } from "../src/shared/types";

const ROOT = path.resolve(__dirname, "..");
const HISTORY = path.join(ROOT, "tests/fixtures/projections/espn-history.json");
const REPORT = path.join(ROOT, "docs/RANKINGS_V3_INSEASON_BACKTEST.md");
// --write regenerates everything ABOVE this line in the report and leaves
// everything below it alone.
const HAND_WRITTEN_MARKER = "<!-- hand-written below this line -->";

const SEASONS = [2025, 2026];
const TEAM_COUNT = 12;
const ROSTER_SIZE = 13;
const POOL_SIZE = TEAM_COUNT * ROSTER_SIZE;
const FULL_SEASON = 82;
const BOOTSTRAP_RESAMPLES = 1000;

// At the four original checkpoints a ranking is only interesting for
// players worth rostering, and a rest-of-season rank for someone with 3
// games of evidence is noise. The three early checkpoints deliberately
// drop this filter: the players it excludes are the ones problem A ruins.
const MIN_GAMES_AT_CHECKPOINT = 5;
const BOARD_DEPTH = 150;

// Below this many ESPN projected games, availability is the thing the
// board gets wrong, and change B is what should fix it.
const LOW_GP_THRESHOLD = 60;

// Checkpoints as scoring periods. Periods are DAYS: period 1 is opening
// night and the season runs to 174.
//
// Week 3 and week 8 are 21 and 56 days in. The All-Star break is found
// from the data rather than hardcoded: it is the long gameless gap in the
// back half, which lands at period 115 in both seasons. The trade deadline
// is a week before it, which is where the NBA puts it.
const EARLY_PERIODS = [3, 7, 14];
const WEEK_3 = 21;
const WEEK_8 = 56;
const DEADLINE_BEFORE_BREAK = 7;

interface SeasonLine {
  GP: number; MIN: number; REB: number; AST: number;
  STL: number; BLK: number; PTS: number;
}
interface HistoryPlayer {
  id: number; name: string; proTeamId: number;
  actual: Record<string, SeasonLine>;
  espnProjection: Record<string, SeasonLine>;
}
type GameLine = [number, number, number, number, number, number];
interface GameLogs {
  season: number;
  logs: Record<string, GameLine[]>;
  names: Record<string, string>;
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

// Two-pass z over the top POOL_SIZE, the same way the board and the
// preseason truth are built.
function twoPassValue(rows: Array<{ id: number; vec: CategoryVector }>): Map<number, number> {
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
  const score = (st: { m: CategoryVector; s: CategoryVector }): Map<number, number> => {
    const out = new Map<number, number>();
    for (const r of rows) {
      let v = 0;
      for (const c of CATEGORIES) v += (r.vec[c] - st.m[c]) / st.s[c];
      out.set(r.id, v);
    }
    return out;
  };
  if (!rows.length) return new Map();
  const pass1 = score(statsOf(rows));
  const top = rows
    .slice()
    .sort((a, b) => (pass1.get(b.id) as number) - (pass1.get(a.id) as number))
    .slice(0, POOL_SIZE);
  return score(statsOf(top));
}

function emptyVec(): CategoryVector {
  return { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
}

// Sum a player's game lines over a period range into category totals.
function sumGames(games: GameLine[], from: number, to: number): { vec: CategoryVector; gp: number } {
  const vec = emptyVec();
  let gp = 0;
  for (const g of games) {
    if (g[0] < from || g[0] > to) continue;
    vec.PTS += g[1];
    vec.REB += g[2];
    vec.AST += g[3];
    vec.STL += g[4];
    vec.BLK += g[5];
    gp++;
  }
  return { vec, gp };
}

// The league's game days, so "how much season is left" is measured in real
// playing days rather than calendar days.
function gameDays(logs: GameLogs): number[] {
  const days = new Set<number>();
  for (const id of Object.keys(logs.logs)) {
    for (const g of logs.logs[id] as GameLine[]) days.add(g[0]);
  }
  return Array.from(days).sort((a, b) => a - b);
}

// The All-Star break: the longest gameless run in the back half.
function allStarPeriod(days: number[]): number {
  let best = { at: 115, gap: 0 };
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1] as number;
    const gap = (days[i] as number) - prev;
    if (prev > 90 && prev < 140 && gap > best.gap) best = { at: prev, gap };
  }
  return best.at;
}

// --- The three boards --------------------------------------------------
//
// A board is a way of building rateValue. The score on top of it is the
// shipped one for every board, so the comparison is about the rate and
// nothing else.
interface Board {
  label: string;
  // Change B. "82" divides ESPN's projected totals by a full season, which
  // double-counts missed games once applyRestOfSeason multiplies by
  // expected remaining games. "projectedGP" divides by the games ESPN
  // expects the player to PLAY, so availability enters once.
  divisor: "82" | "projectedGP";
  // Change A. What a player with no ESPN projection shrinks toward.
  unprojectedPrior: "poolMean" | "replacement";
}

const BOARDS: Board[] = [
  { label: "old board", divisor: "82", unprojectedPrior: "poolMean" },
  { label: "A", divisor: "82", unprojectedPrior: "replacement" },
  { label: "A+B", divisor: "projectedGP", unprojectedPrior: "replacement" },
];
const OLD = (BOARDS[0] as Board).label;

interface PlayerRow {
  id: number;
  perGame: CategoryVector;
  gp: number;
  projected: boolean;
  projectedGP: number;
  // The shrink prior under each divisor, null when ESPN has no projection.
  priorBy: Record<string, CategoryVector | null>;
  availability: number;
}

interface BoardResult {
  // rateValue by player id.
  rate: Map<number, number>;
  // The shipped rest-of-season score by player id.
  ros: Map<number, number>;
  // Own board order, best first.
  rosOrder: number[];
  perGameOrder: number[];
}

interface CheckpointResult {
  season: number;
  label: string;
  period: number;
  early: boolean;
  players: number;
  rosRho: Record<string, number>;
  perGameRho: Record<string, number>;
  bootstrap: Record<string, number>;
  // Early-checkpoint diagnostics, per board.
  unprojectedInTop: Record<string, number>;
  unprojectedActualRank: Record<string, number>;
  precision: Record<string, number>;
  // Change B diagnostics: players ESPN projects for under 60 games.
  lowGpCount: number;
  lowGpBoardRank: Record<string, number>;
  lowGpRankError: Record<string, number>;
  lowGpAbsError: Record<string, number>;
}

function priorFor(
  proj: SeasonLine | undefined,
  divisor: "82" | "projectedGP",
): CategoryVector | null {
  if (!proj) return null;
  // ESPN's set is full-season TOTALS all season long (see section 1c of the
  // spec and the guard in tests). projectedGP under 1 means ESPN gave no
  // game count, in which case /82 is the best answer available.
  const games = divisor === "82" || !(proj.GP >= 1) ? FULL_SEASON : proj.GP;
  const out = emptyVec();
  let any = false;
  for (const c of CATEGORIES) {
    const v = proj[c] / games;
    out[c] = v;
    if (v !== 0) any = true;
  }
  return any ? out : null;
}

function buildBoard(board: Board, rows: PlayerRow[], remainingShare: number): BoardResult {
  const inputs: BaseValueInput[] = rows.map((r) => {
    const prior = r.priorBy[board.divisor] ?? null;
    return {
      id: String(r.id),
      gamesPlayed: r.gp,
      // Mirrors v2PerGame in js/engines.js: observed rate once there is one,
      // the projection before that. At gp = 0 the shrink weights this out
      // entirely, so it only has to avoid being a misleading zero.
      perGame: r.gp > 0 ? r.perGame : (prior ?? emptyVec()),
      projectedPerGame: prior,
    };
  });
  const base = computeBaseValues(inputs, {
    categories: CATEGORIES,
    rosterSize: ROSTER_SIZE,
    poolSize: POOL_SIZE,
    unprojectedPrior: board.unprojectedPrior,
  });
  const rate = new Map<number, number>();
  for (const row of base.rows) rate.set(Number(row.id), row.baseValue);

  const replacement = replacementLevel(
    rows.map((r) => rate.get(r.id) ?? 0),
    POOL_SIZE,
  );
  const ros = new Map<number, number>();
  for (const r of rows) {
    // Schedule left is the same for everyone (every team plays 82), so
    // what differs between players is availability, which is the point.
    const remaining = FULL_SEASON * remainingShare * r.availability;
    ros.set(r.id, ((rate.get(r.id) ?? 0) - replacement) * remaining);
  }
  const order = (m: Map<number, number>): number[] =>
    rows.slice().sort((a, b) => (m.get(b.id) as number) - (m.get(a.id) as number)).map((r) => r.id);

  return { rate, ros, rosOrder: order(ros), perGameOrder: order(rate) };
}

function evaluateCheckpoint(
  season: number,
  label: string,
  period: number,
  early: boolean,
  logs: GameLogs,
  history: Map<number, HistoryPlayer>,
  days: number[],
): CheckpointResult | null {
  const lastDay = days[days.length - 1] as number;
  const elapsedDays = days.filter((d) => d <= period).length;
  const remainingDays = days.filter((d) => d > period).length;
  if (!elapsedDays || !remainingDays) return null;

  const elapsedShare = elapsedDays / days.length;
  const remainingShare = remainingDays / days.length;

  // --- Inputs: everything up to and including the checkpoint ---
  const rows: PlayerRow[] = [];

  for (const idStr of Object.keys(logs.logs)) {
    const id = Number(idStr);
    const games = logs.logs[idStr] as GameLine[];
    const sofar = sumGames(games, 1, period);
    const h = history.get(id);
    const proj = h ? h.espnProjection[String(season)] : undefined;
    const priorBy = {
      "82": priorFor(proj, "82"),
      projectedGP: priorFor(proj, "projectedGP"),
    };
    // Late checkpoints keep the rosterable filter the shipped table was
    // measured with. Early checkpoints score the whole board, which is
    // exactly the population the pool-mean prior was ruining, and the only
    // exclusion is a player with no evidence at all (no games, no
    // projection), who gets a null score in the app and sorts last.
    if (early) {
      if (sofar.gp === 0 && !priorBy["82"]) continue;
    } else if (sofar.gp < MIN_GAMES_AT_CHECKPOINT) {
      continue;
    }

    const perGame = emptyVec();
    if (sofar.gp > 0) {
      for (const c of CATEGORIES) perGame[c] = sofar.vec[c] / sofar.gp;
    }

    // Availability: this season's attendance so far, blended with the
    // player's prior-season record. Early in the season the record
    // dominates; by the deadline this season's own evidence does.
    const teamGamesSoFar = Math.max(1, FULL_SEASON * elapsedShare);
    const thisSeason = Math.min(1, sofar.gp / teamGamesSoFar);
    const priorGP: number[] = [];
    if (h) {
      for (let s = season - 1; s >= season - 3; s--) {
        const line = h.actual[String(s)];
        if (line) priorGP.push(line.GP);
      }
    }
    const hist = weightedHistory(priorGP);
    const histShare = hist === null ? thisSeason : Math.min(1, hist / FULL_SEASON);
    const w = sofar.gp / (sofar.gp + 15);
    const availability = w * thisSeason + (1 - w) * histShare;

    rows.push({
      id,
      perGame,
      gp: sofar.gp,
      projected: priorBy["82"] !== null,
      projectedGP: proj && proj.GP >= 1 ? proj.GP : 0,
      priorBy,
      availability,
    });
  }
  if (rows.length < 50) return null;

  const built = new Map<string, BoardResult>();
  for (const b of BOARDS) built.set(b.label, buildBoard(b, rows, remainingShare));

  // --- Truth: rest-of-season 5-category value ---
  const rosRows: Array<{ id: number; vec: CategoryVector }> = [];
  for (const r of rows) {
    const games = logs.logs[String(r.id)] as GameLine[];
    rosRows.push({ id: r.id, vec: sumGames(games, period + 1, lastDay).vec });
  }
  const rosValue = twoPassValue(rosRows);
  const rosRank = new Map<number, number>();
  Array.from(rosValue.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([id], i) => rosRank.set(id, i + 1));
  const truthRank = (id: number): number => rosRank.get(id) ?? rosRank.size + 1;

  // --- Score every board over the SAME player set ---
  //
  // Scoring each board over its own top 150 is not a fair comparison: the
  // boards select different players, so one that happens to pick an
  // easier-to-rank 150 gets a better rho without ranking anyone better.
  // That produced a table where one candidate had the higher rho at every
  // checkpoint and still lost the paired bootstrap at six of eight, which
  // is a contradiction the method created rather than a finding.
  //
  // The common set is the top BOARD_DEPTH by the OLD board's per-game
  // value, fixed for every board and for both the rest-of-season and
  // per-game tables: "of the players the shipped board puts on your radar,
  // who orders them best". It is also what the four original checkpoints
  // were measured against, so those numbers stay comparable.
  const oldBoard = built.get(OLD) as BoardResult;
  const commonIds = new Set(oldBoard.perGameOrder.slice(0, BOARD_DEPTH));

  const rhoOver = (order: number[]): number => {
    const ordered = order.filter((id) => commonIds.has(id));
    return spearman(ordered.map((_, i) => i + 1), ordered.map(truthRank));
  };

  const rosRho: Record<string, number> = {};
  const perGameRho: Record<string, number> = {};
  const unprojectedInTop: Record<string, number> = {};
  const unprojectedActualRank: Record<string, number> = {};
  const precision: Record<string, number> = {};
  const lowGpBoardRank: Record<string, number> = {};
  const lowGpRankError: Record<string, number> = {};
  const lowGpAbsError: Record<string, number> = {};

  const projectedById = new Map(rows.map((r) => [r.id, r.projected]));
  const lowGpIds = rows
    .filter((r) => r.projectedGP > 0 && r.projectedGP < LOW_GP_THRESHOLD)
    .map((r) => r.id);

  for (const b of BOARDS) {
    const res = built.get(b.label) as BoardResult;
    rosRho[b.label] = rhoOver(res.rosOrder);
    perGameRho[b.label] = rhoOver(res.perGameOrder);

    const top = res.rosOrder.slice(0, BOARD_DEPTH);
    const unprojected = top.filter((id) => !projectedById.get(id));
    unprojectedInTop[b.label] = unprojected.length;
    unprojectedActualRank[b.label] = unprojected.length
      ? mean(unprojected.map(truthRank))
      : 0;
    precision[b.label] = top.filter((id) => truthRank(id) <= BOARD_DEPTH).length / top.length;

    const boardRank = new Map<number, number>();
    res.rosOrder.forEach((id, i) => boardRank.set(id, i + 1));
    lowGpBoardRank[b.label] = mean(lowGpIds.map((id) => boardRank.get(id) as number));
    lowGpRankError[b.label] = mean(
      lowGpIds.map((id) => (boardRank.get(id) as number) - truthRank(id)),
    );
    lowGpAbsError[b.label] = mean(
      lowGpIds.map((id) => Math.abs((boardRank.get(id) as number) - truthRank(id))),
    );
  }

  // Paired bootstrap of each board against the old one, over the players
  // both put inside their own top BOARD_DEPTH.
  const bootstrap: Record<string, number> = {};
  const baseRank = new Map<number, number>();
  oldBoard.rosOrder.slice(0, BOARD_DEPTH).forEach((id, i) => baseRank.set(id, i + 1));

  for (const b of BOARDS) {
    if (b.label === OLD) continue;
    const res = built.get(b.label) as BoardResult;
    const candRank = new Map<number, number>();
    res.rosOrder.slice(0, BOARD_DEPTH).forEach((id, i) => candRank.set(id, i + 1));
    const shared = Array.from(candRank.keys()).filter((id) => baseRank.has(id));
    if (shared.length < 20) {
      bootstrap[b.label] = 0;
      continue;
    }
    const next = rng(season * 1000 + period);
    let wins = 0;
    for (let i = 0; i < BOOTSTRAP_RESAMPLES; i++) {
      const ids: number[] = [];
      for (let j = 0; j < shared.length; j++) {
        ids.push(shared[Math.floor(next() * shared.length)] as number);
      }
      const truth = ids.map(truthRank);
      const a = spearman(ids.map((id) => candRank.get(id) as number), truth);
      const c = spearman(ids.map((id) => baseRank.get(id) as number), truth);
      if (a > c) wins++;
    }
    bootstrap[b.label] = wins / BOOTSTRAP_RESAMPLES;
  }

  return {
    season, label, period, early, players: rows.length,
    rosRho, perGameRho, bootstrap,
    unprojectedInTop, unprojectedActualRank, precision,
    lowGpCount: lowGpIds.length, lowGpBoardRank, lowGpRankError, lowGpAbsError,
  };
}

interface GateRow {
  gate: string;
  condition: string;
  measured: string;
  pass: boolean;
}

function main(): void {
  const historyRaw = JSON.parse(fs.readFileSync(HISTORY, "utf8")) as {
    players: HistoryPlayer[];
  };
  const history = new Map<number, HistoryPlayer>();
  for (const p of historyRaw.players) history.set(p.id, p);

  const lines: string[] = [];
  const say = (s = ""): void => {
    console.log(s);
    lines.push(s);
  };

  say("# In-season ranking backtest");
  say("");
  say("Generated by `npx tsx tools/backtest-inseason-ranking.ts`.");
  say("");
  say(
    "Seven checkpoints per season. Everything up to a checkpoint is input, " +
      "everything after it is truth, which is rest-of-season 5-category " +
      "value built the same two-pass way as every other board in this repo.",
  );
  say("");
  say(
    "Three boards, differing only in how `rateValue` is built. The score on " +
      "top of it is the shipped `(rateValue - replacement) * " +
      "expectedRemainingGames` for all three, so the comparison is about the " +
      "rate and nothing else.",
  );
  say("");
  say("| Board | unprojected player shrinks toward | shrink prior |");
  say("|---|---|---|");
  say("| old board | pool mean, an average starter's line | projected totals / 82 |");
  say("| A | the replacement-level line | projected totals / 82 |");
  say("| A+B | the replacement-level line | projected totals / ESPN projected GP |");
  say("");
  say(
    "At the four original checkpoints players with fewer than " +
      MIN_GAMES_AT_CHECKPOINT + " games are excluded, as they were when the " +
      "shipped numbers were measured. The three early checkpoints (periods " +
      EARLY_PERIODS.join(", ") + ") score the **whole board** with no " +
      "minimum: those players are precisely the ones a pool-mean prior " +
      "ruins, which is why the original four could not see problem A.",
  );
  say("");
  say(
    "Rank correlation is measured over a common set, the top " + BOARD_DEPTH +
      " by the OLD board's per-game value, for every board. Scoring each " +
      "board over its own top " + BOARD_DEPTH + " would reward one that " +
      "happens to select an easier-to-rank 150 without ranking anyone " +
      "better.",
  );
  say("");

  const results: CheckpointResult[] = [];
  const labels = BOARDS.map((b) => b.label);

  for (const season of SEASONS) {
    const logsPath = path.join(
      ROOT,
      "tests/fixtures/projections/game-logs-" + season + ".json",
    );
    if (!fs.existsSync(logsPath)) {
      console.error("Missing " + logsPath + ". Run: npx tsx tools/fetch-game-logs.ts");
      process.exit(1);
    }
    const logs = JSON.parse(fs.readFileSync(logsPath, "utf8")) as GameLogs;
    const days = gameDays(logs);
    const allStar = allStarPeriod(days);
    const deadline = allStar - DEADLINE_BEFORE_BREAK;

    const checkpoints: Array<[string, number, boolean]> = [
      ...EARLY_PERIODS.map((p) => ["period " + p, p, true] as [string, number, boolean]),
      ["week 3", WEEK_3, false],
      ["week 8", WEEK_8, false],
      ["trade deadline", deadline, false],
      ["All-Star break", allStar, false],
    ];

    say("## Season " + season);
    say("");
    say(
      "Game days " + days.length + ", All-Star break detected at period " +
        allStar + ", deadline taken as " + deadline + ".",
    );
    say("");

    const seasonResults: CheckpointResult[] = [];
    for (const [label, period, early] of checkpoints) {
      const r = evaluateCheckpoint(season, label, period, early, logs, history, days);
      if (r) {
        results.push(r);
        seasonResults.push(r);
      } else {
        say("- " + label + " (period " + period + "): too few players to score.");
      }
    }

    say("Rest-of-season rank correlation:");
    say("");
    say("| Checkpoint | period | board | players | " + labels.join(" | ") + " |");
    say("|---|---|---|---|" + labels.map(() => "---").join("|") + "|");
    for (const r of seasonResults) {
      say(
        "| " + r.label + " | " + r.period + " | " +
          (r.early ? "whole" : "5+ games") + " | " + r.players + " | " +
          labels.map((l) => (r.rosRho[l] as number).toFixed(3)).join(" | ") + " |",
      );
    }
    say("");

    say("Early checkpoints, the diagnostic the original four could not see:");
    say("");
    say(
      "| Checkpoint | board | unprojected in top " + BOARD_DEPTH +
        " | their avg actual ROS rank | top-" + BOARD_DEPTH + " precision |",
    );
    say("|---|---|---|---|---|");
    for (const r of seasonResults.filter((x) => x.early)) {
      for (const l of labels) {
        const n = r.unprojectedInTop[l] as number;
        say(
          "| " + r.label + " | " + l + " | " + n + " | " +
            (n ? (r.unprojectedActualRank[l] as number).toFixed(0) : "--") + " | " +
            ((r.precision[l] as number) * 100).toFixed(1) + "% |",
        );
      }
    }
    say("");

    say("Per-game view (gate 4), rank correlation at the four original checkpoints:");
    say("");
    say("| Checkpoint | " + labels.join(" | ") + " |");
    say("|---|" + labels.map(() => "---").join("|") + "|");
    for (const r of seasonResults.filter((x) => !x.early)) {
      say(
        "| " + r.label + " | " +
          labels.map((l) => (r.perGameRho[l] as number).toFixed(3)).join(" | ") + " |",
      );
    }
    say("");

    say(
      "Players ESPN projects for under " + LOW_GP_THRESHOLD +
        " games (gate 3), mean board rank and mean rank error against actual:",
    );
    say("");
    say("| Checkpoint | players | " + labels.map((l) => l + " rank").join(" | ") +
      " | " + labels.map((l) => l + " err").join(" | ") + " |");
    say("|---|---|" + labels.map(() => "---").join("|") + "|" +
      labels.map(() => "---").join("|") + "|");
    for (const r of seasonResults.filter((x) => !x.early)) {
      say(
        "| " + r.label + " | " + r.lowGpCount + " | " +
          labels.map((l) => (r.lowGpBoardRank[l] as number).toFixed(1)).join(" | ") + " | " +
          labels.map((l) => {
            const e = r.lowGpRankError[l] as number;
            return (e >= 0 ? "+" : "") + e.toFixed(1);
          }).join(" | ") + " |",
      );
    }
    say("");

    say("Paired bootstrap against the old board, share of resamples ahead:");
    say("");
    say("| Checkpoint | " + labels.slice(1).join(" | ") + " |");
    say("|---|" + labels.slice(1).map(() => "---").join("|") + "|");
    for (const r of seasonResults) {
      say(
        "| " + r.label + " | " +
          labels.slice(1).map((l) =>
            ((r.bootstrap[l] as number) * 100).toFixed(1) + "%").join(" | ") + " |",
      );
    }
    say("");
  }

  // --- Gates (spec section 4b) -------------------------------------------
  const early = results.filter((r) => r.early);
  const late = results.filter((r) => !r.early);
  const gates: GateRow[] = [];

  // Shipped average rest-of-season rho, from the four original checkpoints
  // in both seasons. This is the 0.455 in CLAUDE.md.
  const oldLateAvg = mean(late.map((r) => r.rosRho[OLD] as number));

  for (const l of labels.slice(1)) {
    // Gate 1 is change A's whole point, and it is only asked of A.
    if (l === "A") {
      const drops = early.map((r) => {
        const before = r.unprojectedInTop[OLD] as number;
        const after = r.unprojectedInTop[l] as number;
        return { r, before, after, fall: before > 0 ? 1 - after / before : 1 };
      });
      const worst = drops.reduce((a, b) => (a.fall < b.fall ? a : b));
      gates.push({
        gate: "1 (A, early)",
        condition: "unprojected in top " + BOARD_DEPTH + " falls >= 75% at every early checkpoint",
        measured: drops.map((d) => d.before + "->" + d.after).join(", ") +
          "; worst fall " + (worst.fall * 100).toFixed(0) + "%",
        pass: drops.every((d) => d.fall >= 0.75),
      });
      const rises = early.map((r) => ({
        r,
        before: r.precision[OLD] as number,
        after: r.precision[l] as number,
      }));
      gates.push({
        gate: "1 (A, early)",
        condition: "top-" + BOARD_DEPTH + " precision rises at every early checkpoint",
        measured: rises.map((d) =>
          (d.before * 100).toFixed(1) + "->" + (d.after * 100).toFixed(1)).join(", "),
        pass: rises.every((d) => d.after > d.before),
      });
    }

    const avg = mean(late.map((r) => r.rosRho[l] as number));
    gates.push({
      gate: "2 (" + l + ")",
      condition: "avg rest-of-season rho at the four original checkpoints >= " +
        oldLateAvg.toFixed(3),
      measured: avg.toFixed(3),
      pass: avg >= oldLateAvg - 0.0005,
    });
    const worstDrop = Math.max(
      ...late.map((r) => (r.rosRho[OLD] as number) - (r.rosRho[l] as number)),
    );
    gates.push({
      gate: "2 (" + l + ")",
      condition: "no single original checkpoint drops more than 0.010",
      measured: "worst drop " + worstDrop.toFixed(3),
      pass: worstDrop <= 0.010,
    });
    const worstBoot = Math.min(...late.map((r) => r.bootstrap[l] as number));
    gates.push({
      gate: "2 (" + l + ")",
      condition: "paired bootstrap never shows it worse at 90% or more",
      measured: "lowest share ahead " + (worstBoot * 100).toFixed(1) + "%",
      pass: worstBoot > 0.10,
    });

    // Gate 4: the per-game view must not pay for this.
    const worstPerGame = Math.max(
      ...late.map((r) => (r.perGameRho[OLD] as number) - (r.perGameRho[l] as number)),
    );
    gates.push({
      gate: "4 (" + l + ")",
      condition: "per-game rho falls by at most 0.010 at every original checkpoint",
      measured: "worst drop " + worstPerGame.toFixed(3),
      pass: worstPerGame <= 0.010,
    });
  }

  // Gate 3 is change B specifically, at week 3 and week 8.
  const weeks = late.filter((r) => r.label === "week 3" || r.label === "week 8");
  const moveUp = weeks.map((r) => ({
    r,
    before: r.lowGpBoardRank[OLD] as number,
    after: r.lowGpBoardRank["A+B"] as number,
  }));
  gates.push({
    gate: "3 (A+B)",
    condition: "players projected for under " + LOW_GP_THRESHOLD +
      " games move UP on average at week 3 and week 8",
    measured: moveUp.map((d) =>
      d.r.season + " " + d.r.label + ": " + d.before.toFixed(1) + "->" + d.after.toFixed(1)).join("; "),
    pass: moveUp.every((d) => d.after < d.before),
  });
  const errShrinks = weeks.map((r) => ({
    r,
    before: Math.abs(r.lowGpRankError[OLD] as number),
    after: Math.abs(r.lowGpRankError["A+B"] as number),
    absBefore: r.lowGpAbsError[OLD] as number,
    absAfter: r.lowGpAbsError["A+B"] as number,
  }));
  gates.push({
    gate: "3 (A+B)",
    condition: "their mean rank error (Larry rank minus actual) shrinks",
    measured: errShrinks.map((d) =>
      d.r.season + " " + d.r.label + ": " + d.before.toFixed(1) + "->" + d.after.toFixed(1) +
      " (abs " + d.absBefore.toFixed(1) + "->" + d.absAfter.toFixed(1) + ")").join("; "),
    pass: errShrinks.every((d) => d.after < d.before),
  });

  say("## Gates");
  say("");
  say(
    "Section 4b of `docs/RANKINGS_V3_1_INSEASON_SPEC.md`. Gates 5 (expert " +
      "parity) and 6 (preseason untouched) live in other tools and are " +
      "reported in the summary, not here.",
  );
  say("");
  say("| Gate | Condition | Measured | Result |");
  say("|---|---|---|---|");
  for (const g of gates) {
    say("| " + g.gate + " | " + g.condition + " | " + g.measured + " | " +
      (g.pass ? "**PASS**" : "FAIL") + " |");
  }
  say("");

  const aGates = gates.filter((g) => g.gate.includes("(A)") || g.gate.includes("A, early"));
  const abGates = gates.filter((g) => g.gate.includes("A+B"));
  const aOk = aGates.every((g) => g.pass);
  const abOk = abGates.every((g) => g.pass);
  say(
    "Change A: " + (aOk ? "**PASS**" : "FAIL") + ". Change A+B: " +
      (abOk ? "**PASS**" : "FAIL") + ".",
  );
  say("");
  if (aOk && !abOk) {
    say("Per the spec: ship A alone and report B's numbers.");
    say("");
  }

  say("### Averages across both seasons");
  say("");
  say("| Board | avg ROS rho, original four | avg ROS rho, early three | avg per-game rho |");
  say("|---|---|---|---|");
  for (const l of labels) {
    say(
      "| " + l + " | " + mean(late.map((r) => r.rosRho[l] as number)).toFixed(3) + " | " +
        mean(early.map((r) => r.rosRho[l] as number)).toFixed(3) + " | " +
        mean(late.map((r) => r.perGameRho[l] as number)).toFixed(3) + " |",
    );
  }
  say("");

  if (process.argv.includes("--write")) {
    // Everything from the marker onward is written by hand (the decision,
    // and the live board's before and after, which needs a git-ignored
    // snapshot this tool cannot see). Preserve it across regeneration.
    let tail = "";
    if (fs.existsSync(REPORT)) {
      const existing = fs.readFileSync(REPORT, "utf8");
      const at = existing.indexOf(HAND_WRITTEN_MARKER);
      if (at >= 0) tail = "\n" + existing.slice(at);
    }
    fs.writeFileSync(REPORT, lines.join("\n") + "\n" + tail);
    console.log("\nWrote " + REPORT + (tail ? " (hand-written tail preserved)" : ""));
  }
  process.exit(aOk ? 0 : 1);
}

if (require.main === module) {
  main();
}
