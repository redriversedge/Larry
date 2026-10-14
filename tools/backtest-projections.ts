// Backtest Larry's projections against ESPN's, on real seasons.
//
// The protocol matters more than the numbers. Tuning and reporting happen
// on DIFFERENT seasons:
//
//   TUNE on 2025 (the 2024-25 season) using 2023 and 2024 only.
//   REPORT on 2026 (the 2025-26 season) using 2023, 2024 and 2025.
//
// 2026 is never looked at while choosing constants. Tuning and reporting on
// the same season would just measure how well the constants were fit to it,
// which is how a model that is worse in production looks better on paper.
//
// The benchmark is ESPN's own 2025-26 preseason projection, taken from the
// same fixture, over the same players.
//
// Run: npx tsx tools/backtest-projections.ts
//      npx tsx tools/backtest-projections.ts --tune    (full sweep)

import * as fs from "fs";
import * as path from "path";

import { computeBaseValues } from "../src/engine/zscore";
import {
  computeLeagueRates,
  espnPerGameRate,
  projectGamesPlayed,
  projectMinutesPerGame,
  per36Rate,
  type SeasonTotals,
} from "../src/engine/projections";
import {
  MARCEL_REGRESSION_MINUTES,
  PROJECTION_BLEND_ALPHA,
} from "../src/engine/constants";

const ROOT = path.resolve(__dirname, "..");
const HISTORY = path.join(ROOT, "tests/fixtures/projections/espn-history.json");
const CATS = ["REB", "AST", "STL", "BLK", "PTS"] as const;
type Cat = (typeof CATS)[number];

const MIN_ACTUAL_GP = 20;
const ROSTER_SIZE = 13;

interface HistoryPlayer {
  id: number;
  name: string;
  actual: Record<string, SeasonTotals>;
  espnProjection: Record<string, SeasonTotals>;
}

function perGameOf(line: SeasonTotals): Record<Cat, number> {
  const out = {} as Record<Cat, number>;
  const gp = line.GP > 0 ? line.GP : 1;
  for (const c of CATS) out[c] = (line as any)[c] / gp;
  return out;
}

// Prior seasons for a target, most recent first, missing ones omitted.
function priorSeasons(p: HistoryPlayer, target: number, window: number): SeasonTotals[] {
  const out: SeasonTotals[] = [];
  for (let back = 1; back <= window; back++) {
    const s = p.actual[String(target - back)];
    if (s && s.GP > 0) out.push(s);
  }
  return out;
}

function spearman(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return NaN;
  const rank = (v: number[]): number[] => {
    const order = v.map((_, i) => i).sort((i, j) => v[i]! - v[j]!);
    const r = new Array<number>(n);
    order.forEach((idx, pos) => { r[idx] = pos + 1; });
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

interface Scored {
  id: string;
  rate: Record<Cat, number>;
  gp: number;
}

interface Metrics {
  mae: Record<Cat, number>;
  gpMae: number;
  valueRho: number;
  top100: number;
  n: number;
}

// The number that actually matters. Per-category MAE says how close the
// stat lines are; this says whether the projections would have produced
// the right DRAFT BOARD, which is what the projections are for.
//
// gp 0 on both sides so computeBaseValues does not shrink anything: we are
// comparing two sets of rates directly, not modelling a season in progress.
function valueRanking(rows: Scored[]): Map<string, number> {
  const res = computeBaseValues(
    rows.map((r) => ({ id: r.id, gamesPlayed: 0, projectedPerGame: r.rate })),
    { categories: CATS, rosterSize: ROSTER_SIZE },
  );
  const sorted = res.rows
    .slice()
    .sort((a, b) => b.baseValue - a.baseValue);
  const out = new Map<string, number>();
  sorted.forEach((r, i) => out.set(r.id, i + 1));
  return out;
}

function evaluate(projected: Scored[], actual: Scored[]): Metrics {
  const actualById = new Map(actual.map((a) => [a.id, a]));
  const mae = {} as Record<Cat, number>;
  for (const c of CATS) mae[c] = 0;
  let gpMae = 0;
  let n = 0;

  for (const p of projected) {
    const a = actualById.get(p.id);
    if (!a) continue;
    n++;
    for (const c of CATS) mae[c] += Math.abs(p.rate[c] - a.rate[c]);
    gpMae += Math.abs(p.gp - a.gp);
  }
  if (n > 0) {
    for (const c of CATS) mae[c] /= n;
    gpMae /= n;
  }

  const projRank = valueRanking(projected);
  const actRank = valueRanking(actual);
  const ids = projected.map((p) => p.id).filter((id) => actRank.has(id));
  const valueRho = spearman(
    ids.map((id) => projRank.get(id)!),
    ids.map((id) => actRank.get(id)!),
  );

  const projTop = new Set(ids.filter((id) => projRank.get(id)! <= 100));
  let top100 = 0;
  for (const id of ids) {
    if (actRank.get(id)! <= 100 && projTop.has(id)) top100++;
  }

  return { mae, gpMae, valueRho, top100, n };
}

interface Tuning {
  R: number;
  alpha: number;
}

// Build the three candidate projections (Larry, ESPN, blend) plus the
// actual outcome, for one target season.
function buildSets(
  players: HistoryPlayer[],
  target: number,
  window: number,
  tuning: Tuning,
): { larry: Scored[]; espn: Scored[]; blend: Scored[]; actual: Scored[] } {
  const eligible = players.filter((p) => {
    const act = p.actual[String(target)];
    if (!act || act.GP < MIN_ACTUAL_GP) return false;
    return priorSeasons(p, target, window).length >= 1;
  });

  const league = computeLeagueRates(
    eligible.map((p) => priorSeasons(p, target, window)),
    { categories: CATS },
  );

  const larry: Scored[] = [];
  const espn: Scored[] = [];
  const blend: Scored[] = [];
  const actual: Scored[] = [];

  for (const p of eligible) {
    const id = String(p.id);
    const seasons = priorSeasons(p, target, window);
    const espnLine = p.espnProjection[String(target)] ?? null;

    const per36 = per36Rate(seasons, league, {
      categories: CATS, regressionMinutes: tuning.R,
    });
    const mpg = projectMinutesPerGame(seasons);
    const larryRate = {} as Record<Cat, number>;
    for (const c of CATS) larryRate[c] = (per36[c] * mpg) / 36;
    const larryGp = projectGamesPlayed(seasons, espnLine);

    const espnRate = espnPerGameRate(espnLine, CATS);
    const espnGp = espnLine ? espnLine.GP : 0;

    // ESPN-only and blend are measured over the players ESPN projected, so
    // the comparison is like for like.
    if (espnRate) {
      espn.push({ id, rate: { ...espnRate }, gp: espnGp });
      const mixed = {} as Record<Cat, number>;
      for (const c of CATS) {
        mixed[c] = tuning.alpha * larryRate[c] + (1 - tuning.alpha) * espnRate[c];
      }
      blend.push({ id, rate: mixed, gp: larryGp });
    }

    larry.push({ id, rate: larryRate, gp: larryGp });
    const act = p.actual[String(target)]!;
    actual.push({ id, rate: perGameOf(act) as Record<Cat, number>, gp: act.GP });
  }

  // Restrict every set to the players ESPN also projected, or the three
  // columns would be scored on different populations.
  const common = new Set(espn.map((e) => e.id));
  return {
    larry: larry.filter((x) => common.has(x.id)),
    espn,
    blend,
    actual: actual.filter((x) => common.has(x.id)),
  };
}

function fmt(n: number, d = 3): string {
  return (isFinite(n) ? n.toFixed(d) : "--").padStart(7);
}

function printTable(title: string, rows: Array<[string, Metrics]>): void {
  console.log("  " + title);
  console.log("    " + "model".padEnd(9) +
    CATS.map((c) => ("MAE " + c).padStart(9)).join("") +
    "   MAE GP".padStart(10) + "  valueRho".padStart(10) + "  top100".padStart(9));
  for (const [name, m] of rows) {
    console.log("    " + name.padEnd(9) +
      CATS.map((c) => fmt(m.mae[c]).padStart(9)).join("") +
      fmt(m.gpMae, 2).padStart(10) + fmt(m.valueRho).padStart(10) +
      String(m.top100).padStart(9));
  }
}

function main(): void {
  if (!fs.existsSync(HISTORY)) {
    console.error("Missing " + path.relative(ROOT, HISTORY) +
      "; run: npx tsx tools/fetch-espn-history.ts");
    process.exit(2);
  }
  const hist = JSON.parse(fs.readFileSync(HISTORY, "utf8"));
  const players: HistoryPlayer[] = hist.players;
  const wantSweep = process.argv.includes("--tune");

  const line = "=".repeat(96);
  console.log(line);
  console.log("  PROJECTION BACKTEST   history pulled " + hist.pulledAt +
    ", " + players.length + " players");
  console.log(line);

  // --- Step 1: tune on 2025, using 2023 and 2024 only (a 2-season window).
  console.log("");
  console.log("  STEP 1  tune on 2025 (2024-25), window = 2 prior seasons");
  console.log("          2026 is not read here.");
  console.log("");

  const R_GRID = wantSweep
    ? [250, 500, 750, 1000, 1500, 2000, 3000]
    : [500, 1000, 2000];
  const A_GRID = [0, 0.2, 0.4, 0.6, 0.8, 1.0];

  let best: { R: number; alpha: number; rho: number } | null = null;
  const tuneRows: Array<[string, Metrics]> = [];

  for (const R of R_GRID) {
    for (const alpha of A_GRID) {
      const sets = buildSets(players, 2025, 2, { R, alpha });
      const m = evaluate(sets.blend, sets.actual);
      if (!best || m.valueRho > best.rho) best = { R, alpha, rho: m.valueRho };
      if (alpha === 0.6) {
        tuneRows.push(["R=" + R, m]);
      }
    }
  }
  printTable("blend at a=0.6 across R:", tuneRows);
  console.log("");

  const alphaRows: Array<[string, Metrics]> = [];
  for (const alpha of A_GRID) {
    const sets = buildSets(players, 2025, 2, { R: best!.R, alpha });
    alphaRows.push(["a=" + alpha.toFixed(1), evaluate(sets.blend, sets.actual)]);
  }
  printTable("at R=" + best!.R + " across a:", alphaRows);
  console.log("");
  console.log("  TUNED: R = " + best!.R + ", a = " + best!.alpha.toFixed(1) +
    "  (2025 blend valueRho " + best!.rho.toFixed(3) + ")");

  // --- Step 2: report on 2026 with the tuned constants, 3-season window.
  const tuning = { R: best!.R, alpha: best!.alpha };
  const sets = buildSets(players, 2026, 3, tuning);
  const mLarry = evaluate(sets.larry, sets.actual);
  const mEspn = evaluate(sets.espn, sets.actual);
  const mBlend = evaluate(sets.blend, sets.actual);

  console.log("");
  console.log(line);
  console.log("  STEP 2  report on 2026 (2025-26), window = 3 prior seasons, " +
    sets.actual.length + " players");
  console.log(line);
  console.log("");
  printTable("", [["larry", mLarry], ["espn", mEspn], ["blend", mBlend]]);
  console.log("");

  // Sensitivity on the held-out season. Tuning picked a single alpha by one
  // metric; this shows the whole curve so the choice is not taken on faith,
  // and so a degenerate optimum (a = 0, which makes the blend identical to
  // ESPN and the acceptance test unsatisfiable by construction) is visible
  // rather than hidden behind a verdict.
  const sweepRows: Array<[string, Metrics]> = [];
  for (const alpha of A_GRID) {
    const s = buildSets(players, 2026, 3, { R: best!.R, alpha });
    sweepRows.push(["a=" + alpha.toFixed(1), evaluate(s.blend, s.actual)]);
  }
  printTable("2026 sensitivity to the blend weight (held out, not tuned on):", sweepRows);
  console.log("");

  // --- Step 3: the acceptance rules from the spec, section 2.8.
  const rhoGain = mBlend.valueRho - mEspn.valueRho;
  const catsNoWorse = CATS.filter((c) => mBlend.mae[c] <= mEspn.mae[c] + 1e-12).length;
  const gpBetter = mLarry.gpMae < mEspn.gpMae;

  const c1 = rhoGain >= 0.02;
  const c2 = catsNoWorse >= 4;
  const c3 = gpBetter;
  const pass = c1 && c2 && c3;

  console.log("  ACCEPTANCE (spec 2.8), all three required to default the flag ON");
  console.log("    blend valueRho >= espn + 0.02      " + (c1 ? "PASS" : "FAIL") +
    "   (" + mBlend.valueRho.toFixed(3) + " vs " + mEspn.valueRho.toFixed(3) +
    ", gain " + (rhoGain >= 0 ? "+" : "") + rhoGain.toFixed(3) + ")");
  console.log("    blend MAE no worse in 4+ of 5      " + (c2 ? "PASS" : "FAIL") +
    "   (" + catsNoWorse + " of 5)");
  console.log("    larry GP MAE < espn GP MAE         " + (c3 ? "PASS" : "FAIL") +
    "   (" + mLarry.gpMae.toFixed(2) + " vs " + mEspn.gpMae.toFixed(2) + ")");
  console.log("");

  const larryVsBlend = mLarry.valueRho - mBlend.valueRho;
  console.log("  larry-only vs blend valueRho: " +
    (larryVsBlend >= 0 ? "+" : "") + larryVsBlend.toFixed(3) +
    (larryVsBlend > 0.03
      ? "   (larry-only wins by more than 0.03; the spec says report it)"
      : "   (within 0.03, so ship the blend: more robust to one bad season)"));
  console.log("");
  console.log("  VERDICT: useLarryProjections should default " +
    (pass ? "ON" : "OFF"));
  console.log(line);

  // Machine-readable, so the vitest pin can assert against the same run.
  const out = {
    pulledAt: hist.pulledAt,
    tuned: tuning,
    report2026: { larry: mLarry, espn: mEspn, blend: mBlend },
    acceptance: { rhoGain: c1, maeNoWorse: c2, gpBetter: c3, pass },
  };
  fs.writeFileSync(
    path.join(ROOT, "tests/fixtures/projections/backtest-result.json"),
    JSON.stringify(out, null, 1) + "\n",
    "ascii",
  );
  console.log("  wrote tests/fixtures/projections/backtest-result.json");
  console.log("  (defaults in constants.ts are R=" + MARCEL_REGRESSION_MINUTES +
    ", a=" + PROJECTION_BLEND_ALPHA + ")");
}

main();
