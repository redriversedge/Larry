// Pins the game-log fixtures the in-season backtest rests on.
// docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md C1.
//
// The logs are reconstructed from ESPN's per-scoring-period stat lines.
// The one property that makes them trustworthy is that a player's days sum
// to their season total, so that is checked here over every player rather
// than spot-checked, because a silent change in what ESPN serves would
// otherwise invalidate every in-season conclusion without failing anything.

import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

interface SeasonLine {
  GP: number; MIN: number; REB: number; AST: number;
  STL: number; BLK: number; PTS: number;
}
interface HistoryPlayer {
  id: number; name: string;
  actual: Record<string, SeasonLine>;
  espnProjection: Record<string, SeasonLine>;
}
type GameLine = [number, number, number, number, number, number];
interface GameLogs {
  season: number;
  logs: Record<string, GameLine[]>;
  names: Record<string, string>;
}

const history = JSON.parse(
  fs.readFileSync(path.join(ROOT, "tests/fixtures/projections/espn-history.json"), "utf8"),
) as { players: HistoryPlayer[] };
const byId = new Map<number, HistoryPlayer>();
for (const p of history.players) byId.set(p.id, p);

const SEASONS = [2025, 2026];

function loadLogs(season: number): GameLogs {
  return JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "tests/fixtures/projections/game-logs-" + season + ".json"),
      "utf8",
    ),
  ) as GameLogs;
}

describe.each(SEASONS)("game logs for %i", (season) => {
  const logs = loadLogs(season);

  it("covers the whole season for a few hundred players", () => {
    expect(logs.season).toBe(season);
    const ids = Object.keys(logs.logs);
    expect(ids.length).toBeGreaterThan(400);

    let lines = 0;
    let maxPeriod = 0;
    for (const id of ids) {
      const games = logs.logs[id] as GameLine[];
      lines += games.length;
      for (const g of games) maxPeriod = Math.max(maxPeriod, g[0]);
    }
    expect(lines).toBeGreaterThan(20000);
    // A season runs to scoring period 174.
    expect(maxPeriod).toBeGreaterThan(160);
    expect(maxPeriod).toBeLessThanOrEqual(174);
  });

  it("has every player's days sum to their season total", () => {
    // This is the whole basis for trusting the reconstruction. It held
    // exactly for 547 of 547 players in 2025 and 552 of 552 in 2026 when
    // the fixture was built.
    let checked = 0;
    const failures: string[] = [];

    for (const idStr of Object.keys(logs.logs)) {
      const h = byId.get(Number(idStr));
      const total = h?.actual[String(season)];
      if (!total) continue;
      const games = logs.logs[idStr] as GameLine[];

      let pts = 0;
      let reb = 0;
      let ast = 0;
      let stl = 0;
      let blk = 0;
      for (const g of games) {
        pts += g[1]; reb += g[2]; ast += g[3]; stl += g[4]; blk += g[5];
      }
      checked++;

      // One-and-a-half of slack for the fixture's one-decimal rounding.
      const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1.5;
      if (
        games.length !== Math.round(total.GP) ||
        !near(pts, total.PTS) || !near(reb, total.REB) ||
        !near(ast, total.AST) || !near(stl, total.STL) || !near(blk, total.BLK)
      ) {
        failures.push(logs.names[idStr] || idStr);
      }
    }

    expect(checked).toBeGreaterThan(400);
    expect(failures, "players whose days do not sum to their season total").toEqual([]);
  });

  it("has each player's games in ascending period order, with no duplicates", () => {
    for (const idStr of Object.keys(logs.logs)) {
      const games = logs.logs[idStr] as GameLine[];
      const periods = games.map((g) => g[0]);
      expect(new Set(periods).size, idStr).toBe(periods.length);
      for (let i = 1; i < periods.length; i++) {
        expect(periods[i]).toBeGreaterThan(periods[i - 1] as number);
      }
    }
  });

  it("puts the All-Star break where the backtest's checkpoints assume it is", () => {
    // The checkpoints are derived from this gap, not hardcoded, so if the
    // shape of the season changes the backtest should be re-read rather
    // than trusted.
    const days = new Set<number>();
    for (const idStr of Object.keys(logs.logs)) {
      for (const g of logs.logs[idStr] as GameLine[]) days.add(g[0]);
    }
    const sorted = Array.from(days).sort((a, b) => a - b);

    let best = { at: 0, gap: 0 };
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1] as number;
      const gap = (sorted[i] as number) - prev;
      if (prev > 90 && prev < 140 && gap > best.gap) best = { at: prev, gap };
    }
    // Both seasons break after period 115, with a 6 or 7 day gap.
    expect(best.at).toBe(115);
    expect(best.gap).toBeGreaterThanOrEqual(5);
  });
});
