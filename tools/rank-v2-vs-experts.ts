// tools/rank-v2-vs-experts.ts
//
// Acceptance gate for ranking v2 (docs/RANKING_V2_SPEC.md, HANDOFF.md phase 2).
//
// Two jobs:
//
//   1. Parity. Re-runs src/engine/zscore.ts computeBaseValues over the same
//      snapshot tools/proto.py was developed against and asserts the scores
//      match the committed baseline row for row. proto.py is the reference
//      implementation; if the TypeScript drifts from it, the correlation
//      numbers below stop meaning anything.
//
//   2. Agreement. Scores the result against the FantasyPros 6-expert
//      consensus top 150 and prints the legacy DURANT numbers beside it, so
//      the 0.296 -> 0.786 move is visible rather than asserted.
//
// Run with:
//   npx tsx tools/rank-v2-vs-experts.ts
//
// Snapshots hold personal roster data and are git-ignored, which is why this
// is a tool and not a vitest. To produce one: open Larry in the browser, then
// in DevTools:
//   copy(JSON.stringify(JSON.parse(localStorage.getItem('larry_state'))))
//
// IMPORTANT: the parity half only means something against the exact snapshot
// the baseline CSV was generated from. Pass a different export and names will
// come up unmatched and every rank after the first difference will shift by
// one. That is a mismatched pair, not a regression in the engine. The
// agreement half (section 2 onward) is fine on any snapshot.

import * as fs from "fs";
import * as path from "path";
import { computeBaseValues, type BaseValueInput } from "../src/engine/zscore";
import { DEFAULT_ROSTER_SIZE } from "../src/engine/constants";
import type { CategoryVector } from "../src/shared/types";
import { CATEGORIES } from "../src/shared/types";

const PARITY_TOLERANCE = 0.01;
const RHO_FLOOR = 0.75;
const MUST_BE_TOP = 40;
const ACCEPTANCE_PLAYERS = [
  "Luka Doncic",
  "Kevin Durant",
  "Cooper Flagg",
  "Giannis Antetokounmpo",
  "Jayson Tatum",
];

interface SnapshotPlayer {
  id: number | string;
  name?: string;
  gamesPlayed?: number;
  injuryStatus?: string;
  stats?: {
    season?: Record<string, number>;
    projectedSeason?: Record<string, number>;
  };
}

interface BaselineRow {
  name: string;
  norm: string;
  newScore: number;
  newRank: number;
  legacyRank: number;
  expertRank: number | null;
}

// Name normalization, byte-for-byte equivalent to norm() in tools/proto.py.
// NFKD then dropping non-ASCII strips accents (Jokic, Doncic, Porzingis);
// the suffix pass keeps "Jaren Jackson Jr." and "Jaren Jackson" together.
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

// Spearman exactly as tools/proto.py computes it: re-rank both vectors, then
// the no-ties shortcut. Reproduced rather than improved so the number printed
// here is directly comparable to the 0.786 in the spec.
function spearman(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return NaN;
  const rank = (v: number[]): number[] => {
    const order = v.map((_, i) => i).sort((i, j) => v[i]! - v[j]!);
    const r = new Array<number>(n);
    order.forEach((idx, pos) => {
      r[idx] = pos + 1;
    });
    return r;
  };
  const x = rank(a);
  const y = rank(b);
  let d2 = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i]! - y[i]!;
    d2 += d * d;
  }
  return 1 - (6 * d2) / (n * (n * n - 1));
}

function parseCsv(text: string): BaselineRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = (lines.shift() ?? "").split(",").map((h) => h.trim());
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) {
      throw new Error(
        `baseline CSV is missing the '${name}' column. Found: ${header.join(", ")}`,
      );
    }
    return i;
  };
  const iName = col("name");
  const iScore = col("new_score");
  const iRank = col("new_rank");
  const iLegacy = col("legacy_durant_rank");
  const iExpert = col("expert_rank_top150");

  return lines.map((line) => {
    // Player names in this file contain no commas or quotes, so a plain
    // split is safe. Guard anyway so a future export does not silently skew.
    if (line.includes('"')) throw new Error(`quoted CSV field not supported: ${line}`);
    const f = line.split(",");
    const name = (f[iName] ?? "").trim();
    const expertRaw = (f[iExpert] ?? "").trim();
    return {
      name,
      norm: norm(name),
      newScore: Number(f[iScore]),
      newRank: Number(f[iRank]),
      legacyRank: Number(f[iLegacy]),
      expertRank: expertRaw === "" ? null : Number(expertRaw),
    };
  });
}

function toInput(p: SnapshotPlayer): BaseValueInput {
  const season = p.stats?.season ?? {};
  const projected = p.stats?.projectedSeason ?? {};
  const seasonTotals: Partial<CategoryVector> = {};
  const projectedSeason: Partial<CategoryVector> = {};
  for (const c of CATEGORIES) {
    seasonTotals[c] = season[c] ?? 0;
    projectedSeason[c] = projected[c] ?? 0;
  }
  return {
    id: String(p.id),
    gamesPlayed: p.gamesPlayed ?? 0,
    seasonTotals,
    projectedSeason,
  };
}

// Overlap at k, matching proto.py's ov(): of the experts' top k, how many does
// this ranking also place inside its own top k.
function overlapAt(
  k: number,
  expert: Array<{ norm: string; rank: number }>,
  ranks: Map<string, number>,
): number {
  let hits = 0;
  for (const e of expert) {
    if (e.rank > k) continue;
    const mine = ranks.get(e.norm);
    if (mine !== undefined && mine <= k) hits += 1;
  }
  return hits;
}

function evaluate(
  label: string,
  ranks: Map<string, number>,
  expert: Array<{ norm: string; rank: number }>,
): void {
  const ex: number[] = [];
  const mine: number[] = [];
  for (const e of expert) {
    const r = ranks.get(e.norm);
    if (r === undefined) continue;
    ex.push(e.rank);
    mine.push(r);
  }
  const rho = spearman(ex, mine);
  console.log(
    `  ${label.padEnd(30)} rho=${rho.toFixed(3)}  ` +
      `top10=${overlapAt(10, expert, ranks)}/10  ` +
      `top25=${overlapAt(25, expert, ranks)}/25  ` +
      `top50=${overlapAt(50, expert, ranks)}/50  ` +
      `(matched ${ex.length}/${expert.length})`,
  );
}

function main(): void {
  const snapshotPath = path.resolve(
    process.argv[2] ?? "tests/fixtures/users/rank-v2-parity-snapshot.json",
  );
  const baselinePath = path.resolve(
    process.argv[3] ?? "tests/fixtures/rank-v2-expert-baseline.csv",
  );
  for (const [label, p] of [
    ["Snapshot", snapshotPath],
    ["Baseline", baselinePath],
  ] as const) {
    if (!fs.existsSync(p)) {
      console.error(`${label} not found: ${p}`);
      process.exit(1);
    }
  }

  const snap = JSON.parse(fs.readFileSync(snapshotPath, "utf-8")) as {
    allPlayers?: SnapshotPlayer[];
    players?: SnapshotPlayer[];
  };
  const players = snap.allPlayers ?? snap.players ?? [];
  if (players.length === 0) {
    console.error("Snapshot has no allPlayers / players array.");
    process.exit(1);
  }
  const baseline = parseCsv(fs.readFileSync(baselinePath, "utf-8"));

  console.log("=".repeat(78));
  console.log("Larry ranking v2: parity and expert agreement");
  console.log("=".repeat(78));
  console.log(`Snapshot: ${snapshotPath}  (${players.length} players)`);
  console.log(`Baseline: ${baselinePath}  (${baseline.length} rows)`);
  console.log("");

  // --- compute v2 ---------------------------------------------------------
  const result = computeBaseValues(players.map(toInput), {
    categories: CATEGORIES,
    rosterSize: DEFAULT_ROSTER_SIZE,
  });
  console.log(`Q-pool size: ${result.poolSize}`);
  console.log(
    "Pool mean:   " + CATEGORIES.map((c) => `${c}=${result.stats.mean[c].toFixed(2)}`).join("  "),
  );
  console.log(
    "Pool stdev:  " + CATEGORIES.map((c) => `${c}=${result.stats.stdev[c].toFixed(2)}`).join("  "),
  );
  console.log("");

  // Rank over every player, stable so the gp=0 cluster at 0.0 resolves in
  // snapshot order the way Python's sorted() does.
  const nameById = new Map(players.map((p) => [String(p.id), p.name ?? String(p.id)]));
  const ranked = [...result.rows].sort((a, b) => b.baseValue - a.baseValue);

  const myRank = new Map<string, number>();
  const myScore = new Map<string, number>();
  ranked.forEach((row, i) => {
    const key = norm(nameById.get(row.id) ?? row.id);
    // Later rows win on duplicate normalized names, matching proto.py's
    // dict comprehension.
    myRank.set(key, i + 1);
    myScore.set(key, row.baseValue);
  });

  // --- 1. parity against proto.py ----------------------------------------
  console.log("-".repeat(78));
  console.log("1. Parity vs tools/proto.py baseline");
  console.log("-".repeat(78));
  let worstDelta = 0;
  let worstName = "";
  let scoreMismatches = 0;
  let rankMismatches = 0;
  let unmatched = 0;
  const examples: string[] = [];
  for (const row of baseline) {
    const mine = myScore.get(row.norm);
    const mineRank = myRank.get(row.norm);
    if (mine === undefined || mineRank === undefined) {
      unmatched += 1;
      if (examples.length < 10) examples.push(`  unmatched in snapshot: ${row.name}`);
      continue;
    }
    const delta = Math.abs(mine - row.newScore);
    if (delta > worstDelta) {
      worstDelta = delta;
      worstName = row.name;
    }
    if (delta > PARITY_TOLERANCE) {
      scoreMismatches += 1;
      if (examples.length < 10) {
        examples.push(
          `  score: ${row.name.padEnd(26)} baseline=${row.newScore.toFixed(4)} ` +
            `mine=${mine.toFixed(4)} delta=${delta.toFixed(4)}`,
        );
      }
    }
    if (mineRank !== row.newRank) {
      rankMismatches += 1;
      if (examples.length < 10) {
        examples.push(
          `  rank:  ${row.name.padEnd(26)} baseline=#${row.newRank} mine=#${mineRank}`,
        );
      }
    }
  }
  console.log(`  rows compared:      ${baseline.length - unmatched}`);
  console.log(`  unmatched names:    ${unmatched}`);
  console.log(`  max score delta:    ${worstDelta.toFixed(6)}  (${worstName})`);
  console.log(`  score mismatches:   ${scoreMismatches}  (tolerance ${PARITY_TOLERANCE})`);
  console.log(`  rank mismatches:    ${rankMismatches}`);
  for (const e of examples) console.log(e);
  const parityOk = scoreMismatches === 0 && unmatched === 0;
  console.log(`  PARITY: ${parityOk ? "PASS" : "FAIL"}`);
  console.log("");

  // --- 2. agreement with the expert consensus -----------------------------
  const expert = baseline
    .filter((r) => r.expertRank !== null)
    .map((r) => ({ norm: r.norm, rank: r.expertRank as number }))
    .sort((a, b) => a.rank - b.rank);

  const legacyRank = new Map<string, number>();
  for (const r of baseline) legacyRank.set(r.norm, r.legacyRank);

  console.log("-".repeat(78));
  console.log(`2. Agreement with the ${expert.length}-player expert consensus`);
  console.log("-".repeat(78));
  evaluate("legacy DURANT (as shipped)", legacyRank, expert);
  evaluate("ranking v2 (this engine)", myRank, expert);
  console.log("");

  const ex: number[] = [];
  const mineRanks: number[] = [];
  for (const e of expert) {
    const r = myRank.get(e.norm);
    if (r === undefined) continue;
    ex.push(e.rank);
    mineRanks.push(r);
  }
  const rho = spearman(ex, mineRanks);

  // --- 3. the named acceptance players ------------------------------------
  console.log("-".repeat(78));
  console.log(`3. Stars that the legacy injury multiplier buried`);
  console.log("-".repeat(78));
  const starFailures: string[] = [];
  for (const name of ACCEPTANCE_PLAYERS) {
    const key = norm(name);
    const r = myRank.get(key);
    const legacy = legacyRank.get(key);
    const snapshotPlayer = players.find((p) => norm(p.name ?? "") === key);
    const status = snapshotPlayer?.injuryStatus ?? "?";
    if (r === undefined) {
      starFailures.push(`${name} (not found)`);
      console.log(`  ${name.padEnd(24)} NOT FOUND`);
      continue;
    }
    const ok = r <= MUST_BE_TOP;
    if (!ok) starFailures.push(`${name} (#${r})`);
    console.log(
      `  ${name.padEnd(24)} v2 #${String(r).padStart(3)}   ` +
        `legacy #${String(legacy ?? "?").padStart(3)}   ` +
        `${status.padEnd(12)} ${ok ? "ok" : `FAIL, outside top ${MUST_BE_TOP}`}`,
    );
  }
  console.log("");

  // --- 4. biggest disagreements -------------------------------------------
  console.log("-".repeat(78));
  console.log("4. Twenty largest disagreements with the experts");
  console.log("   (3PM / FT% heavy players are expected here: experts rank 9-cat,");
  console.log("    Larry's league is 5-cat)");
  console.log("-".repeat(78));
  const byName = new Map(baseline.map((r) => [r.norm, r.name]));
  const diffs = expert
    .map((e) => ({ name: byName.get(e.norm) ?? e.norm, expert: e.rank, mine: myRank.get(e.norm) }))
    .filter((d): d is { name: string; expert: number; mine: number } => d.mine !== undefined)
    .map((d) => ({ ...d, gap: d.mine - d.expert }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, 20);
  for (const d of diffs) {
    const dir = d.gap > 0 ? "Larry lower" : "Larry higher";
    console.log(
      `  ${d.name.padEnd(26)} expert #${String(d.expert).padStart(3)}  ` +
        `v2 #${String(d.mine).padStart(3)}  ${dir} by ${Math.abs(d.gap)}`,
    );
  }
  console.log("");

  // --- verdict ------------------------------------------------------------
  console.log("=".repeat(78));
  const rhoOk = rho >= RHO_FLOOR;
  const starsOk = starFailures.length === 0;
  console.log(`  parity with proto.py       ${parityOk ? "PASS" : "FAIL"}`);
  console.log(
    `  rho >= ${RHO_FLOOR}                 ${rhoOk ? "PASS" : "FAIL"}  (${rho.toFixed(3)})`,
  );
  console.log(
    `  stars inside top ${MUST_BE_TOP}         ${starsOk ? "PASS" : `FAIL: ${starFailures.join(", ")}`}`,
  );
  const allOk = parityOk && rhoOk && starsOk;
  console.log(`  ACCEPTANCE: ${allOk ? "PASS" : "FAIL"}`);
  console.log("=".repeat(78));
  process.exit(allOk ? 0 : 1);
}

main();
