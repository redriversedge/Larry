// In-season ranking backtest: does rest-of-season value beat per-game
// value at predicting the rest of the season?
// docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md C2 and C3.
//
// Mid-season the question is not "who is the better player" but "who will
// produce more from today to the end of the season". Those differ whenever
// a player's remaining availability differs: a 40-minute star with a
// chronic knee is a better player and a worse rest-of-season asset than a
// durable starter.
//
// Four checkpoints per season, two seasons, scored against what actually
// happened after each one. Everything before a checkpoint is input;
// everything after it is truth. Nothing leaks.
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

const SEASONS = [2025, 2026];
const TEAM_COUNT = 12;
const ROSTER_SIZE = 13;
const POOL_SIZE = TEAM_COUNT * ROSTER_SIZE;
const FULL_SEASON = 82;
const BOOTSTRAP_RESAMPLES = 1000;

// A ranking is only interesting for players worth rostering, and a
// rest-of-season rank for someone with 3 games of evidence is noise.
const MIN_GAMES_AT_CHECKPOINT = 5;
const BOARD_DEPTH = 150;

// Checkpoints as scoring periods. Periods are DAYS: period 1 is opening
// night and the season runs to 174.
//
// Week 3 and week 8 are 21 and 56 days in. The All-Star break is found
// from the data rather than hardcoded: it is the long gameless gap in the
// back half, which lands at period 115 in both seasons. The trade deadline
// is a week before it, which is where the NBA puts it.
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

interface Candidate {
  label: string;
  // Higher is better.
  score: (p: PlayerAtCheckpoint) => number;
}

interface PlayerAtCheckpoint {
  id: number;
  rateValue: number;
  replacement: number;
  expectedRemainingGames: number;
}

interface CheckpointResult {
  season: number;
  label: string;
  period: number;
  players: number;
  rho: Record<string, number>;
  bootstrap: Record<string, number>;
}

function evaluateCheckpoint(
  season: number,
  label: string,
  period: number,
  logs: GameLogs,
  history: Map<number, HistoryPlayer>,
  days: number[],
  candidates: Candidate[],
): CheckpointResult | null {
  const lastDay = days[days.length - 1] as number;
  const elapsedDays = days.filter((d) => d <= period).length;
  const remainingDays = days.filter((d) => d > period).length;
  if (!elapsedDays || !remainingDays) return null;

  const elapsedShare = elapsedDays / days.length;
  const remainingShare = remainingDays / days.length;

  // --- Inputs: everything up to and including the checkpoint ---
  const rows: Array<{
    id: number;
    perGame: CategoryVector;
    gp: number;
    priorRate: CategoryVector | null;
    availability: number;
  }> = [];

  for (const idStr of Object.keys(logs.logs)) {
    const id = Number(idStr);
    const games = logs.logs[idStr] as GameLine[];
    const sofar = sumGames(games, 1, period);
    if (sofar.gp < MIN_GAMES_AT_CHECKPOINT) continue;

    const perGame = emptyVec();
    for (const c of CATEGORIES) perGame[c] = sofar.vec[c] / sofar.gp;

    // The shrink prior is ESPN's preseason projection over 82, exactly as
    // the shipped in-season board does it (v2ShrinkPrior).
    const h = history.get(id);
    const proj = h ? h.espnProjection[String(season)] : undefined;
    const priorRate = proj
      ? {
          REB: proj.REB / FULL_SEASON, AST: proj.AST / FULL_SEASON,
          STL: proj.STL / FULL_SEASON, BLK: proj.BLK / FULL_SEASON,
          PTS: proj.PTS / FULL_SEASON,
        }
      : null;

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

    rows.push({ id, perGame, gp: sofar.gp, priorRate, availability });
  }
  if (rows.length < 50) return null;

  // v2 per-game value, from the shipped engine.
  const inputs: BaseValueInput[] = rows.map((r) => ({
    id: String(r.id),
    gamesPlayed: r.gp,
    perGame: r.perGame,
    projectedPerGame: r.priorRate,
  }));
  const base = computeBaseValues(inputs, { categories: CATEGORIES, rosterSize: ROSTER_SIZE });
  const rateById = new Map<number, number>();
  for (const row of base.rows) rateById.set(Number(row.id), row.baseValue);

  const replacement = replacementLevel(
    rows.map((r) => rateById.get(r.id) ?? 0),
    POOL_SIZE,
  );

  const atCheckpoint: PlayerAtCheckpoint[] = rows.map((r) => ({
    id: r.id,
    rateValue: rateById.get(r.id) ?? 0,
    replacement,
    // Schedule left is the same for everyone (every team plays 82), so
    // what differs between players is availability, which is the point.
    expectedRemainingGames: FULL_SEASON * remainingShare * r.availability,
  }));

  // --- Truth: rest-of-season 5-category value ---
  const rosRows: Array<{ id: number; vec: CategoryVector }> = [];
  for (const p of atCheckpoint) {
    const games = logs.logs[String(p.id)] as GameLine[];
    const rest = sumGames(games, period + 1, lastDay);
    rosRows.push({ id: p.id, vec: rest.vec });
  }
  const rosValue = twoPassValue(rosRows);
  const rosRank = new Map<number, number>();
  Array.from(rosValue.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([id], i) => rosRank.set(id, i + 1));

  // --- Score every candidate over the SAME player set ---
  //
  // Scoring each candidate over its own top 150 is not a fair comparison:
  // the boards select different players, so a candidate that happens to
  // pick an easier-to-rank 150 gets a better rho without ranking anyone
  // better. That produced a table where one candidate had the higher rho
  // at every checkpoint and still lost the paired bootstrap at six of
  // eight, which is a contradiction the method created rather than a
  // finding.
  //
  // The common set is the top BOARD_DEPTH by the BASELINE, fixed for all
  // candidates: "of the players v2 would put on your radar, who orders
  // them best". boards[] keeps each candidate's own ordering for the
  // bootstrap, which resamples shared players and is unaffected either way.
  const baselineCand = candidates[0] as Candidate;
  const commonSet = atCheckpoint
    .slice()
    .sort((a, b) => baselineCand.score(b) - baselineCand.score(a))
    .slice(0, BOARD_DEPTH)
    .map((p) => p.id);
  const commonIds = new Set(commonSet);

  const rho: Record<string, number> = {};
  const boards: Record<string, number[]> = {};
  for (const cand of candidates) {
    const full = atCheckpoint
      .slice()
      .sort((a, b) => cand.score(b) - cand.score(a))
      .map((p) => p.id);
    boards[cand.label] = full.slice(0, BOARD_DEPTH);

    // This candidate's ordering restricted to the common set.
    const ordered = full.filter((id) => commonIds.has(id));
    rho[cand.label] = spearman(
      ordered.map((_, i) => i + 1),
      ordered.map((id) => rosRank.get(id) ?? rosRank.size + 1),
    );
  }

  // Paired bootstrap of each candidate against v2 over shared players.
  const bootstrap: Record<string, number> = {};
  const baseline = candidates[0] as Candidate;
  const baseBoard = boards[baseline.label] as number[];
  const baseRank = new Map<number, number>();
  baseBoard.forEach((id, i) => baseRank.set(id, i + 1));

  for (const cand of candidates) {
    if (cand.label === baseline.label) continue;
    const board = boards[cand.label] as number[];
    const candRank = new Map<number, number>();
    board.forEach((id, i) => candRank.set(id, i + 1));
    const shared = Array.from(candRank.keys()).filter((id) => baseRank.has(id));
    if (shared.length < 20) {
      bootstrap[cand.label] = 0;
      continue;
    }
    const next = rng(season * 1000 + period);
    let wins = 0;
    for (let i = 0; i < BOOTSTRAP_RESAMPLES; i++) {
      const ids: number[] = [];
      for (let j = 0; j < shared.length; j++) {
        ids.push(shared[Math.floor(next() * shared.length)] as number);
      }
      const truth = ids.map((id) => rosRank.get(id) ?? rosRank.size + 1);
      const a = spearman(ids.map((id) => candRank.get(id) as number), truth);
      const b = spearman(ids.map((id) => baseRank.get(id) as number), truth);
      if (a > b) wins++;
    }
    bootstrap[cand.label] = wins / BOOTSTRAP_RESAMPLES;
  }

  return { season, label, period, players: atCheckpoint.length, rho, bootstrap };
}

function main(): void {
  const historyRaw = JSON.parse(fs.readFileSync(HISTORY, "utf8")) as {
    players: HistoryPlayer[];
  };
  const history = new Map<number, HistoryPlayer>();
  for (const p of historyRaw.players) history.set(p.id, p);

  const candidates: Candidate[] = [
    { label: "v2 per-game", score: (p) => p.rateValue },
    { label: "rate x games", score: (p) => p.rateValue * p.expectedRemainingGames },
    {
      label: "above replacement x games",
      score: (p) => (p.rateValue - p.replacement) * p.expectedRemainingGames,
    },
  ];

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
    "Four checkpoints per season. Everything up to a checkpoint is input, " +
      "everything after it is truth, which is rest-of-season 5-category " +
      "value built the same two-pass way as every other board in this repo. " +
      "Players with fewer than " + MIN_GAMES_AT_CHECKPOINT + " games at the " +
      "checkpoint are excluded; a rest-of-season rank off three games is noise.",
  );
  say("");
  say(
    "**Value above replacement alone cannot change an in-season ranking.** " +
      "Subtracting a constant and multiplying by a constant leaves the order " +
      "untouched, so it only does anything when multiplied by games that " +
      "differ per player. That is why the candidates below are per-game " +
      "value, value times expected remaining games, and value above " +
      "replacement times expected remaining games, rather than the four in " +
      "the spec.",
  );
  say("");

  const results: CheckpointResult[] = [];

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

    const checkpoints: Array<[string, number]> = [
      ["week 3", WEEK_3],
      ["week 8", WEEK_8],
      ["trade deadline", deadline],
      ["All-Star break", allStar],
    ];

    say("## Season " + season);
    say("");
    say(
      "Game days " + days.length + ", All-Star break detected at period " +
        allStar + ", deadline taken as " + deadline + ".",
    );
    say("");
    say("| Checkpoint | period | players | " + candidates.map((c) => c.label).join(" | ") + " |");
    say("|---|---|---|" + candidates.map(() => "---").join("|") + "|");

    for (const [label, period] of checkpoints) {
      const r = evaluateCheckpoint(season, label, period, logs, history, days, candidates);
      if (!r) {
        say("| " + label + " | " + period + " | too few | | | |");
        continue;
      }
      results.push(r);
      say(
        "| " + label + " | " + period + " | " + r.players + " | " +
          candidates.map((c) => (r.rho[c.label] as number).toFixed(3)).join(" | ") + " |",
      );
    }
    say("");
    say("Paired bootstrap against v2 per-game, share of resamples ahead:");
    say("");
    say("| Checkpoint | " + candidates.slice(1).map((c) => c.label).join(" | ") + " |");
    say("|---|" + candidates.slice(1).map(() => "---").join("|") + "|");
    for (const r of results.filter((x) => x.season === season)) {
      say(
        "| " + r.label + " | " +
          candidates.slice(1).map((c) =>
            ((r.bootstrap[c.label] as number) * 100).toFixed(1) + "%",
          ).join(" | ") + " |",
      );
    }
    say("");
  }

  // --- C3 gates ---
  say("## C3 gates");
  say("");
  say(
    "A candidate ships only if it beats v2 on rest-of-season rho at **at " +
      "least 3 of 4 checkpoints in each season** and on the average across " +
      "all eight.",
  );
  say("");
  say("| Candidate | 2025 wins | 2026 wins | avg rho | v2 avg rho | result |");
  say("|---|---|---|---|---|---|");

  const v2Label = (candidates[0] as Candidate).label;
  const v2Avg = mean(results.map((r) => r.rho[v2Label] as number));
  let anyPass = false;

  for (const cand of candidates.slice(1)) {
    const winsBySeason = SEASONS.map(
      (s) =>
        results.filter(
          (r) => r.season === s && (r.rho[cand.label] as number) > (r.rho[v2Label] as number),
        ).length,
    );
    const avg = mean(results.map((r) => r.rho[cand.label] as number));
    const ok = winsBySeason.every((w) => w >= 3) && avg > v2Avg;
    if (ok) anyPass = true;
    say(
      "| " + cand.label + " | " + winsBySeason[0] + " of 4 | " + winsBySeason[1] +
        " of 4 | " + avg.toFixed(3) + " | " + v2Avg.toFixed(3) + " | " +
        (ok ? "**PASS**" : "FAIL") + " |",
    );
  }
  say("");
  say(
    anyPass
      ? "At least one candidate passes. Ship the best one."
      : "**Nothing beats v2. Leave the in-season ranking alone.** The owner " +
        "asked for the best rankings, not a change for its own sake.",
  );
  say("");

  if (process.argv.includes("--write")) {
    fs.writeFileSync(REPORT, lines.join("\n") + "\n");
    console.log("\nWrote " + REPORT);
  }
}

if (require.main === module) {
  main();
}
