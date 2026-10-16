// Pull four seasons of real NBA box-score totals from ESPN's public
// fantasy endpoint and write them to a committed fixture.
//
// No login: leaguedefaults/3 is the public "default league" view, so this
// needs no espn_s2 / SWID and does not touch the owner's league.
//
// Run before each season:
//   npx tsx tools/fetch-espn-history.ts
//
// Output: tests/fixtures/projections/espn-history.json, committed so the
// backtest and the projection tests run offline and deterministically.

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "tests/fixtures/projections/espn-history.json");
const OUT_DURABILITY = path.join(ROOT, "data/durability-history.json");

// ESPN's seasonId is the calendar year the season ENDS in, so 2026 is the
// 2025-26 season. 2027 is the season about to start: projections only.
//
// Back to 2020 so the durability model (src/engine/durability.ts) can read
// three prior seasons of actual games for any board year it is backtested
// on: a 2024 board needs 2021 to 2023, and the fit runs on 2024 to 2026.
//
// Two facts worth recording, both verified 2026-10-15 against the named
// players in docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md:
//   - Every one of these seasons returns a full ~1000-player actual line.
//   - For a FINISHED season, statSourceId 1 is still ESPN's PRESEASON
//     projection, not a rest-of-season update. Zion's 2025 line reads
//     projected 64, actual 30, which is exactly what ESPN published before
//     that season. That is what makes a preseason backtest possible at all.
const SEASONS = [2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027];
const LIMIT = 1000;

// Mirrors ESPN_STAT_MAP in js/core.js for the ids used here.
const STAT: Record<string, string> = {
  "0": "PTS", "1": "BLK", "2": "STL", "3": "AST", "6": "REB",
  "40": "MIN", "42": "GP",
};
const KEEP = ["GP", "MIN", "REB", "AST", "STL", "BLK", "PTS"] as const;

export interface SeasonLine {
  GP: number; MIN: number; REB: number; AST: number;
  STL: number; BLK: number; PTS: number;
}

export interface HistoryPlayer {
  id: number;
  name: string;
  proTeamId: number;
  // Real box-score totals, keyed by seasonId.
  actual: Record<string, SeasonLine>;
  // ESPN's own preseason projection, keyed by seasonId. 2026's is the
  // benchmark the backtest scores against.
  espnProjection: Record<string, SeasonLine>;
}

function emptyLine(): SeasonLine {
  return { GP: 0, MIN: 0, REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
}

function mapLine(raw: Record<string, number> | undefined): SeasonLine | null {
  if (!raw) return null;
  const out = emptyLine();
  let any = false;
  for (const k of Object.keys(raw)) {
    const name = STAT[k];
    if (!name) continue;
    const v = raw[k];
    if (typeof v !== "number" || !isFinite(v)) continue;
    (out as any)[name] = v;
    if (v !== 0) any = true;
  }
  return any ? out : null;
}

function round(line: SeasonLine): SeasonLine {
  const out = emptyLine();
  for (const k of KEEP) {
    // Totals are counting stats; one decimal is plenty and keeps the
    // committed fixture small.
    out[k] = Math.round(line[k] * 10) / 10;
  }
  return out;
}

async function fetchSeason(season: number): Promise<any[]> {
  const url = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/" +
    season + "/segments/0/leaguedefaults/3?view=kona_player_info";
  const filter = {
    players: { limit: LIMIT, sortPercOwned: { sortAsc: false, sortPriority: 1 } },
  };
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0",
      "x-fantasy-filter": JSON.stringify(filter),
    },
  });
  if (!res.ok) throw new Error(season + ": HTTP " + res.status);
  const body: any = await res.json();
  const players: any[] = body.players ?? [];
  // The filter header is not always honored. Say so rather than silently
  // backtesting on a truncated player set.
  if (players.length < LIMIT * 0.5) {
    console.warn("  WARNING: only " + players.length + " players returned for " +
      season + "; the x-fantasy-filter limit may not be honored");
  }
  return players;
}

async function main(): Promise<void> {
  const byId = new Map<number, HistoryPlayer>();

  for (const season of SEASONS) {
    process.stdout.write("fetching " + season + " ... ");
    const entries = await fetchSeason(season);
    let actuals = 0;
    let projections = 0;

    for (const e of entries) {
      const pl = e.player ?? {};
      const id = Number(pl.id);
      if (!isFinite(id)) continue;

      let rec = byId.get(id);
      if (!rec) {
        rec = {
          id,
          name: String(pl.fullName ?? ""),
          proTeamId: Number(pl.proTeamId ?? 0),
          actual: {},
          espnProjection: {},
        };
        byId.set(id, rec);
      }
      // Later seasons carry the current team, which is the one we want.
      if (pl.proTeamId !== undefined) rec.proTeamId = Number(pl.proTeamId);
      if (pl.fullName) rec.name = String(pl.fullName);

      // statSourceId 0 = actual, 1 = ESPN projection.
      // statSplitTypeId 0 = full season; the rest are splits.
      for (const s of (pl.stats ?? []) as any[]) {
        if (s.statSplitTypeId !== 0) continue;
        const line = mapLine(s.stats);
        if (!line) continue;
        const sid = String(s.seasonId);
        if (s.statSourceId === 0) {
          if (!rec.actual[sid] || line.GP > rec.actual[sid]!.GP) {
            rec.actual[sid] = round(line);
            actuals++;
          }
        } else if (s.statSourceId === 1) {
          if (!rec.espnProjection[sid]) {
            rec.espnProjection[sid] = round(line);
            projections++;
          }
        }
      }
    }
    console.log(entries.length + " players, " + actuals + " actual lines, " +
      projections + " projection lines");
  }

  // Drop players with nothing usable: no actuals and no projection.
  const players = Array.from(byId.values()).filter(
    (p) => Object.keys(p.actual).length > 0 || Object.keys(p.espnProjection).length > 0,
  );
  players.sort((a, b) => a.id - b.id);

  const out = {
    _note: "Real NBA totals and ESPN preseason projections from the public " +
      "kona_player_info endpoint. seasonId is the calendar year the season " +
      "ENDS in, so 2026 is the 2025-26 season. Regenerate with " +
      "npx tsx tools/fetch-espn-history.ts",
    pulledAt: new Date().toISOString().slice(0, 10),
    seasons: SEASONS,
    count: players.length,
    players,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + "\n", "ascii");

  // A compact games-played history the BROWSER can read. The full fixture
  // is 575 KB and mostly stat lines the durability model never looks at;
  // all it needs is each player's actual games in the three seasons before
  // the one being ranked. The live kona fetch does not carry prior-season
  // lines, so without this the app would have to trust ESPN's projected
  // games, which is the whole thing the model exists to correct.
  const target = SEASONS[SEASONS.length - 1] as number; // the upcoming season
  const priorSeasons = [target - 1, target - 2, target - 3];
  const durability: Record<string, number[]> = {};
  for (const p of players) {
    const row: number[] = [];
    for (const s of priorSeasons) {
      const line = p.actual[String(s)];
      // Absent seasons are omitted, not zeroed: a year out of the league
      // is not a year of missed games. weightedHistory reads this order.
      if (line) row.push(Math.round(line.GP));
    }
    if (row.length) durability[String(p.id)] = row;
  }
  const durabilityOut = {
    _note: "Actual games played, most recent first, for the three seasons " +
      "before " + target + ". Read by the preseason board's durability model.",
    season: target,
    priorSeasons,
    gp: durability,
  };
  fs.mkdirSync(path.dirname(OUT_DURABILITY), { recursive: true });
  fs.writeFileSync(OUT_DURABILITY, JSON.stringify(durabilityOut) + "\n", "ascii");

  console.log("");
  console.log("wrote " + players.length + " players to " +
    path.relative(ROOT, OUT) + " (" +
    Math.round(fs.statSync(OUT).size / 1024) + " KB)");
  console.log("wrote " + Object.keys(durability).length + " players to " +
    path.relative(ROOT, OUT_DURABILITY) + " (" +
    Math.round(fs.statSync(OUT_DURABILITY).size / 1024) + " KB)");
  for (const season of SEASONS) {
    const n = players.filter((p) => p.actual[String(season)]).length;
    const pr = players.filter((p) => p.espnProjection[String(season)]).length;
    console.log("  " + season + ": " + String(n).padStart(4) + " with actuals, " +
      String(pr).padStart(4) + " with an ESPN projection");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
