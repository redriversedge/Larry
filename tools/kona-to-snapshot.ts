// Turn a raw kona_player_info response into the slice of larry_state the
// preseason acceptance tool needs.
//
// The alternative is exporting localStorage out of the browser by hand,
// which is what the spec describes for the owner. This exists so the board
// can be measured from a reproducible fetch instead:
//
//   curl -H 'x-fantasy-filter: {"players":{"limit":1000,
//     "sortPercOwned":{"sortAsc":false,"sortPriority":1}}}' \
//     'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027\
//      /segments/0/leaguedefaults/3?view=kona_player_info' -o kona.json
//   npx tsx tools/kona-to-snapshot.ts kona.json 2027 \
//     tests/fixtures/users/preseason-2027-snapshot.json
//
// The output mirrors what js/espn.js parsePlayer stores, so the tool reads
// the same shape the live app does.

import * as fs from "fs";

// Mirrors ESPN_STAT_MAP in js/core.js for the ids this needs.
const STAT: Record<string, string> = {
  "0": "PTS", "1": "BLK", "2": "STL", "3": "AST", "6": "REB",
  "40": "MIN", "42": "GP",
};

const FULL_SEASON_GAMES = 82;
const COUNTING = ["REB", "AST", "STL", "BLK", "PTS", "MIN"];

function mapStats(raw: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const k of Object.keys(raw)) {
    const name = STAT[k];
    if (name) out[name] = raw[k] as number;
  }
  return out;
}

function perGame(totals: Record<string, number>, gp: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(totals)) {
    out[k] = k === "GP" ? totals[k]! : (gp > 0 ? totals[k]! / gp : 0);
  }
  return out;
}

function main(): void {
  const [src, seasonArg, dest] = process.argv.slice(2);
  if (!src || !seasonArg || !dest) {
    console.error("usage: tsx tools/kona-to-snapshot.ts <kona.json> <seasonId> <out.json>");
    process.exit(2);
  }
  const season = Number(seasonArg);
  const data = JSON.parse(fs.readFileSync(src, "utf8"));
  const entries: any[] = data.players ?? [];

  const allPlayers = entries.map((e) => {
    const pl = e.player ?? {};
    const stats: any[] = pl.stats ?? [];
    // statSourceId 0 = actual, 1 = ESPN projection. statSplitTypeId 0 is
    // the full-season line; the rest are splits we do not need here.
    const find = (sid: number, src2: number) =>
      stats.find((s) => s.seasonId === sid && s.statSourceId === src2 && s.statSplitTypeId === 0);

    const projEntry = find(season, 1);
    const actualEntry = find(season, 0);

    const projTotals = mapStats(projEntry?.stats);
    const actualTotals = mapStats(actualEntry?.stats);
    const playedGP = Number(actualTotals["GP"] ?? 0) || 0;
    const projGP = Number(projTotals["GP"] ?? 0) || 0;

    const out: any = {
      id: pl.id,
      name: pl.fullName ?? "",
      proTeamId: pl.proTeamId ?? 0,
      onTeamId: 0,
      gamesPlayed: playedGP,
      percentOwned: pl.ownership?.percentOwned ?? 0,
      injuryStatus: pl.injuryStatus ?? "ACTIVE",
      status: pl.injuryStatus ?? "ACTIVE",
      minutesPerGame: playedGP > 0 && actualTotals["MIN"] !== undefined
        ? actualTotals["MIN"]! / playedGP
        : 0,
      stats: {
        season: playedGP > 0 ? perGame(actualTotals, playedGP) : {},
        last7: {}, last15: {}, last30: {},
        totals: playedGP > 0 ? { season: actualTotals } : {},
        gp: playedGP > 0 ? { season: playedGP } : {},
      },
    };

    if (projEntry) {
      out.stats.projectedSeason = projTotals;
      // Divided by a full season: the in-season shrink prior.
      out.stats.projectedPerGame = perGame(projTotals, FULL_SEASON_GAMES);
      // Divided by the games ESPN expects: the preseason rate.
      out.stats.projectedGP = projGP;
      out.stats.projectedRate = projGP >= 1 ? perGame(projTotals, projGP) : null;
    }
    return out;
  });

  const withProj = allPlayers.filter((p) => p.stats.projectedRate).length;
  const played = allPlayers.filter((p) => p.gamesPlayed > 0).length;

  fs.writeFileSync(dest, JSON.stringify({
    _note: "Derived from a public kona_player_info fetch by tools/kona-to-snapshot.ts.",
    league: { seasonId: season, teamCount: 12, rosterSize: 13,
      categories: COUNTING.filter((c) => c !== "MIN")
        .map((abbr) => ({ abbr, isNegative: false, isPercent: false })) },
    allPlayers,
  }, null, 1));

  console.log(`wrote ${allPlayers.length} players to ${dest}`);
  console.log(`  with an ESPN projection: ${withProj}`);
  console.log(`  with games already played: ${played}`);
}

main();
