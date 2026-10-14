// Pins the backtest result so a later edit to the projection model cannot
// silently make it worse.
//
// Runs the 2026 report from the committed history fixture, offline and
// deterministically. If someone changes the Marcel weights, the regression
// constant or the minutes model, the numbers here move and this fails,
// which is the point. Regenerate the expectations with
// `npx tsx tools/backtest-projections.ts` and only update them alongside a
// deliberate, explained change.

import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

import { computeBaseValues } from "../../src/engine/zscore";
import {
  computeLeagueRates,
  espnPerGameRate,
  per36Rate,
  projectGamesPlayed,
  projectMinutesPerGame,
  type SeasonTotals,
} from "../../src/engine/projections";

const ROOT = path.resolve(__dirname, "../..");
const CATS = ["REB", "AST", "STL", "BLK", "PTS"] as const;
type Cat = (typeof CATS)[number];
const MIN_ACTUAL_GP = 20;

interface HistoryPlayer {
  id: number;
  name: string;
  actual: Record<string, SeasonTotals>;
  espnProjection: Record<string, SeasonTotals>;
}

const hist = JSON.parse(
  fs.readFileSync(path.join(ROOT, "tests/fixtures/projections/espn-history.json"), "utf8"),
);
const players: HistoryPlayer[] = hist.players;

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
  const rank = (v: number[]): number[] => {
    const order = v.map((_, i) => i).sort((i, j) => v[i]! - v[j]!);
    const r = new Array<number>(n);
    order.forEach((idx, pos) => { r[idx] = pos + 1; });
    return r;
  };
  const x = rank(a);
  const y = rank(b);
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (x[i]! - y[i]!) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

function valueRanking(rows: Array<{ id: string; rate: Record<Cat, number> }>) {
  const res = computeBaseValues(
    rows.map((r) => ({ id: r.id, gamesPlayed: 0, projectedPerGame: r.rate })),
    { categories: CATS, rosterSize: 13 },
  );
  const sorted = res.rows.slice().sort((a, b) => b.baseValue - a.baseValue);
  const out = new Map<string, number>();
  sorted.forEach((r, i) => out.set(r.id, i + 1));
  return out;
}

// The 2026 report: project 2025-26 from 2023, 2024 and 2025.
function report2026(alpha: number) {
  const eligible = players.filter((p) => {
    const act = p.actual["2026"];
    if (!act || act.GP < MIN_ACTUAL_GP) return false;
    if (!p.espnProjection["2026"]) return false;
    return priorSeasons(p, 2026, 3).length >= 1;
  });

  const league = computeLeagueRates(
    eligible.map((p) => priorSeasons(p, 2026, 3)),
    { categories: CATS },
  );

  const larry: Array<{ id: string; rate: Record<Cat, number>; gp: number }> = [];
  const espn: Array<{ id: string; rate: Record<Cat, number>; gp: number }> = [];
  const blend: Array<{ id: string; rate: Record<Cat, number>; gp: number }> = [];
  const actual: Array<{ id: string; rate: Record<Cat, number>; gp: number }> = [];

  for (const p of eligible) {
    const id = String(p.id);
    const seasons = priorSeasons(p, 2026, 3);
    const espnLine = p.espnProjection["2026"]!;
    const per36 = per36Rate(seasons, league, { categories: CATS });
    const mpg = projectMinutesPerGame(seasons);
    const lr = {} as Record<Cat, number>;
    for (const c of CATS) lr[c] = (per36[c] * mpg) / 36;
    const lgp = projectGamesPlayed(seasons, espnLine);
    const er = espnPerGameRate(espnLine, CATS)!;
    const br = {} as Record<Cat, number>;
    for (const c of CATS) br[c] = alpha * lr[c] + (1 - alpha) * er[c];

    larry.push({ id, rate: lr, gp: lgp });
    espn.push({ id, rate: { ...er }, gp: espnLine.GP });
    blend.push({ id, rate: br, gp: lgp });

    const act = p.actual["2026"]!;
    const ar = {} as Record<Cat, number>;
    for (const c of CATS) ar[c] = (act as any)[c] / act.GP;
    actual.push({ id, rate: ar, gp: act.GP });
  }
  return { larry, espn, blend, actual };
}

function metrics(
  proj: Array<{ id: string; rate: Record<Cat, number>; gp: number }>,
  actual: Array<{ id: string; rate: Record<Cat, number>; gp: number }>,
) {
  const byId = new Map(actual.map((a) => [a.id, a]));
  let gpMae = 0;
  const mae = {} as Record<Cat, number>;
  for (const c of CATS) mae[c] = 0;
  for (const p of proj) {
    const a = byId.get(p.id)!;
    for (const c of CATS) mae[c] += Math.abs(p.rate[c] - a.rate[c]);
    gpMae += Math.abs(p.gp - a.gp);
  }
  for (const c of CATS) mae[c] /= proj.length;
  gpMae /= proj.length;
  const pr = valueRanking(proj);
  const ar = valueRanking(actual);
  const ids = proj.map((p) => p.id);
  const valueRho = spearman(ids.map((i) => pr.get(i)!), ids.map((i) => ar.get(i)!));
  return { mae, gpMae, valueRho, n: proj.length };
}

describe("projection backtest, 2026 held-out season", () => {
  const sets = report2026(0.2);
  const mLarry = metrics(sets.larry, sets.actual);
  const mEspn = metrics(sets.espn, sets.actual);

  it("runs over the expected player population", () => {
    // Everyone with 20+ actual games in 2025-26, an ESPN projection for it,
    // and at least one prior season in the window.
    expect(mLarry.n).toBe(316);
  });

  it("pins ESPN's value rank correlation as the benchmark", () => {
    expect(mEspn.valueRho).toBeCloseTo(0.839, 2);
  });

  it("pins Larry's value rank correlation", () => {
    // Worse than ESPN. This is the measured reason useLarryProjections
    // ships OFF, so it is pinned rather than hidden.
    expect(mLarry.valueRho).toBeCloseTo(0.794, 2);
    expect(mLarry.valueRho).toBeLessThan(mEspn.valueRho);
  });

  it("confirms Larry's expected-games model beats ESPN's", () => {
    // The one component that does win, and the reason the module is worth
    // keeping. If a future change breaks this, the feature loses its only
    // measured advantage.
    expect(mLarry.gpMae).toBeLessThan(mEspn.gpMae);
    expect(mLarry.gpMae).toBeCloseTo(13.51, 1);
    expect(mEspn.gpMae).toBeCloseTo(14.04, 1);
  });

  it("blending at 0.2 costs nothing in rank and improves the stat lines", () => {
    const mBlend = metrics(sets.blend, sets.actual);
    expect(mBlend.valueRho).toBeGreaterThanOrEqual(mEspn.valueRho - 0.005);
    expect(mBlend.mae.REB).toBeLessThan(mEspn.mae.REB);
    expect(mBlend.mae.STL).toBeLessThan(mEspn.mae.STL);
    expect(mBlend.mae.BLK).toBeLessThan(mEspn.mae.BLK);
  });

  it("gets monotonically worse as Larry's weight rises", () => {
    // Documents the shape of the curve, which is what rules out a higher
    // alpha. If a model change inverts this, the default should be revisited.
    const rhos = [0, 0.4, 0.8, 1].map((a) => metrics(report2026(a).blend, sets.actual).valueRho);
    for (let i = 1; i < rhos.length; i++) {
      expect(rhos[i]!).toBeLessThanOrEqual(rhos[i - 1]! + 1e-9);
    }
  });
});
