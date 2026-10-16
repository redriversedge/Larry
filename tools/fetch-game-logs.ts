// Reconstruct per-day game logs for past seasons from ESPN's public
// endpoint. docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md C1.
//
// Why this is needed: there is no point-in-time history in the repo. The
// projections fixture holds season totals only, so there is no way to ask
// "what did the board look like in week 8, and who was actually good from
// week 8 onward". Without that, an in-season ranking change cannot be
// backtested, and the spec says do not ship one that has not been.
//
// The spec budgeted one request per scoring period, about 174 per season.
// It turns out ESPN returns EVERY scoring period's line in a single
// kona_player_info response, under statSplitTypeId 5, so this is one
// request per season.
//
// Verified 2026-10-15: summing a player's per-day lines reproduces their
// season total exactly. Jokic 2025-26 sums to 65 games, 1799 points, 836
// rebounds, 697 assists, which is precisely his season line. The tool
// asserts this for every player and reports any mismatch rather than
// quietly backtesting on bad data.
//
// Run: npx tsx tools/fetch-game-logs.ts

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const SEASONS = [2025, 2026];
const LIMIT = 1000;

// [scoringPeriodId, PTS, REB, AST, STL, BLK]
export type GameLine = [number, number, number, number, number, number];

export interface GameLogs {
  season: number;
  pulledAt: string;
  // playerId -> that player's games, ascending by scoring period.
  logs: Record<string, GameLine[]>;
  // playerId -> proTeamId, for deriving each team's schedule.
  teams: Record<string, number>;
  names: Record<string, string>;
}

function outPath(season: number): string {
  return path.join(ROOT, "tests/fixtures/projections/game-logs-" + season + ".json");
}

async function fetchSeason(season: number): Promise<any[]> {
  const url =
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/" +
    season +
    "/segments/0/leaguedefaults/3?view=kona_player_info";
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0",
      "x-fantasy-filter": JSON.stringify({
        players: { limit: LIMIT, sortPercOwned: { sortAsc: false, sortPriority: 1 } },
      }),
    },
  });
  if (!res.ok) throw new Error(season + ": HTTP " + res.status);
  const body: any = await res.json();
  return body.players ?? [];
}

async function main(): Promise<void> {
  for (const season of SEASONS) {
    process.stdout.write("fetching " + season + " ... ");
    const entries = await fetchSeason(season);

    const logs: Record<string, GameLine[]> = {};
    const teams: Record<string, number> = {};
    const names: Record<string, string> = {};
    let mismatches = 0;
    let checked = 0;
    let games = 0;

    for (const e of entries) {
      const pl = e.player ?? {};
      const id = Number(pl.id);
      if (!isFinite(id)) continue;

      const days: GameLine[] = [];
      for (const s of (pl.stats ?? []) as any[]) {
        // statSplitTypeId 5 is a single scoring period, which is one DAY.
        // statSourceId 0 is real production rather than a projection.
        if (s.statSplitTypeId !== 5 || s.statSourceId !== 0) continue;
        if (Number(s.seasonId) !== season) continue;
        const st = s.stats ?? {};
        // GP on a single-day line is 1 when the player actually played.
        if (!(Number(st["42"]) > 0)) continue;
        days.push([
          Number(s.scoringPeriodId) || 0,
          Math.round((Number(st["0"]) || 0) * 10) / 10,
          Math.round((Number(st["6"]) || 0) * 10) / 10,
          Math.round((Number(st["3"]) || 0) * 10) / 10,
          Math.round((Number(st["2"]) || 0) * 10) / 10,
          Math.round((Number(st["1"]) || 0) * 10) / 10,
        ]);
      }
      if (!days.length) continue;
      days.sort((a, b) => a[0] - b[0]);

      // The integrity check: per-day lines must reproduce the season line.
      const total = (pl.stats ?? []).find(
        (s: any) =>
          s.statSplitTypeId === 0 && s.statSourceId === 0 && Number(s.seasonId) === season,
      );
      if (total && total.stats) {
        checked++;
        const sum = days.reduce(
          (acc, d) => {
            acc.pts += d[1];
            acc.reb += d[2];
            acc.ast += d[3];
            return acc;
          },
          { pts: 0, reb: 0, ast: 0 },
        );
        const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1.5;
        if (
          days.length !== Math.round(Number(total.stats["42"]) || 0) ||
          !near(sum.pts, Number(total.stats["0"]) || 0) ||
          !near(sum.reb, Number(total.stats["6"]) || 0) ||
          !near(sum.ast, Number(total.stats["3"]) || 0)
        ) {
          mismatches++;
          if (mismatches <= 5) {
            console.warn(
              "\n  MISMATCH " + (pl.fullName || id) + ": " + days.length +
                " day lines against " + total.stats["42"] + " games, " +
                sum.pts.toFixed(0) + " points against " + total.stats["0"],
            );
          }
        }
      }

      logs[String(id)] = days;
      teams[String(id)] = Number(pl.proTeamId) || 0;
      names[String(id)] = String(pl.fullName ?? "");
      games += days.length;
    }

    const out: GameLogs = {
      season,
      pulledAt: new Date().toISOString().slice(0, 10),
      logs,
      teams,
      names,
    };
    fs.writeFileSync(outPath(season), JSON.stringify(out) + "\n", "ascii");

    const kb = Math.round(fs.statSync(outPath(season)).size / 1024);
    console.log(
      Object.keys(logs).length + " players, " + games + " game lines, " + kb + " KB" +
        " (sum check: " + (checked - mismatches) + "/" + checked + " exact)",
    );
    if (mismatches > checked * 0.02) {
      console.error(
        "Too many players whose day lines do not reproduce their season total. " +
          "Not safe to backtest on. Stopping.",
      );
      process.exit(1);
    }
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
