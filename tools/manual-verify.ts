// tools/manual-verify.ts
//
// Phase 1 verification helper. Reads a snapshot of the live S object
// (exported from localStorage in the browser) and runs LarryEngine.recommend
// against it. Prints the user's top 5 needs, the v2 top 5 picks, and the
// breakdown for each so we can compare side-by-side against v1 output
// before merging to dev.
//
// Run with:
//   npx tsx tools/manual-verify.ts tests/fixtures/users/cliff-real-roster.json
//
// The snapshot file is git-ignored. To produce one: open Larry in your
// browser, then in DevTools:
//   copy(JSON.stringify(JSON.parse(localStorage.getItem('larry_state'))))
// then paste into the target path.

import * as fs from "fs";
import * as path from "path";
import { recommend } from "../src/engine/recommend";
import { createInMemoryProjectionSource } from "../src/engine/projectionSource";
import type {
  CategoryVector,
  PlayerProjection,
  Position,
  RecommendationContext,
  RosterContext,
} from "../src/shared/types";
import { CATEGORIES } from "../src/shared/types";

// Lightweight subset of S we actually read.
interface SnapshotPlayer {
  id: number | string;
  name?: string;
  positions?: string[];
  nbaTeam?: string;
  injuryStatus?: string;
  onTeamId?: number;
  slotId?: number;
  gamesPlayed?: number;
  gamesRemaining?: number;
  stats?: { season?: Record<string, number> };
}

interface SnapshotState {
  league?: { teamCount?: number; categories?: Array<{ abbr?: string }> };
  myTeam?: { teamId?: number; players?: SnapshotPlayer[] };
  teams?: Array<{ teamId: number }>;
  allPlayers?: SnapshotPlayer[];
  players?: SnapshotPlayer[];
}

function asPosition(s: string): Position | null {
  if (s === "PG" || s === "SG" || s === "SF" || s === "PF" || s === "C") return s;
  return null;
}

function toProjection(p: SnapshotPlayer): PlayerProjection {
  // ESPN season stats are season *totals*. Always divide by gamesPlayed to
  // get per-game. If gp is 0 (rookie hasn't played, or trade), fall back to
  // projectedSeason / 82 as a reasonable per-game stand-in.
  const season = p.stats?.season ?? {};
  const projected = (p.stats as { projectedSeason?: Record<string, number> } | undefined)
    ?.projectedSeason ?? {};
  const gp = p.gamesPlayed ?? 0;
  const perGame: CategoryVector = { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
  for (const c of CATEGORIES) {
    if (gp > 0) {
      const raw = season[c];
      perGame[c] = typeof raw === "number" ? raw / gp : 0;
    } else {
      const raw = projected[c];
      perGame[c] = typeof raw === "number" ? raw / 82 : 0;
    }
  }
  const positions: Position[] = (p.positions ?? [])
    .map(asPosition)
    .filter((x): x is Position => x !== null);
  return {
    id: String(p.id),
    name: p.name ?? `Player ${p.id}`,
    team: p.nbaTeam ?? "",
    positions,
    gamesRemaining: p.gamesRemaining ?? 0,
    perGame,
    injuryStatus: (p.injuryStatus ?? "ACTIVE") as PlayerProjection["injuryStatus"],
  };
}

function isFreeAgent(p: SnapshotPlayer): boolean {
  return (p.onTeamId ?? 0) === 0;
}

function describeVector(v: CategoryVector): string {
  return CATEGORIES.map((c) => `${c}=${v[c].toFixed(2)}`).join("  ");
}

function rankNeeds(needs: CategoryVector): Array<{ cat: string; mag: number }> {
  return CATEGORIES.map((c) => ({ cat: c, mag: needs[c] })).sort(
    (a, b) => Math.abs(b.mag) - Math.abs(a.mag),
  );
}

function main(): void {
  const inputPath = process.argv[2] ?? "tests/fixtures/users/cliff-real-roster.json";
  const absPath = path.resolve(inputPath);
  if (!fs.existsSync(absPath)) {
    console.error(`Snapshot file not found: ${absPath}`);
    console.error("");
    console.error("To produce one: open Larry in your browser, then in DevTools:");
    console.error('  copy(JSON.stringify(JSON.parse(localStorage.getItem("larry_state"))))');
    console.error(`Paste into ${inputPath}.`);
    process.exit(1);
  }
  const raw = fs.readFileSync(absPath, "utf-8");
  const state = JSON.parse(raw) as SnapshotState;
  const all: SnapshotPlayer[] = state.allPlayers ?? state.players ?? [];
  if (all.length === 0) {
    console.error("Snapshot has no allPlayers / players array. Cannot proceed.");
    process.exit(1);
  }
  const myPlayers = (state.myTeam?.players ?? []).map(toProjection);
  const freeAgents = all.filter(isFreeAgent).map(toProjection);

  // Build league rosters keyed by team id from allPlayers.
  const leaguePlayers: Record<string, PlayerProjection[]> = {};
  for (const t of state.teams ?? []) {
    leaguePlayers[String(t.teamId)] = all
      .filter((p) => p.onTeamId === t.teamId)
      .map(toProjection);
  }

  const roster: RosterContext = { myPlayers, leaguePlayers };
  const source = createInMemoryProjectionSource(freeAgents, myPlayers);
  const ctx: RecommendationContext = {
    roster,
    league: {
      size: state.league?.teamCount ?? 12,
      scoringPeriod: 0,
      currentMatchup: null,
      allCategories: CATEGORIES,
    },
    projectionSource: source,
    mode: "in-season",
  };

  console.log("=".repeat(70));
  console.log("Larry v2 manual verification");
  console.log("=".repeat(70));
  console.log(`Snapshot: ${absPath}`);
  console.log(`My roster: ${myPlayers.length} players`);
  console.log(`Free agents in pool: ${freeAgents.length}`);
  console.log(`League teams: ${Object.keys(leaguePlayers).length}`);
  console.log("");

  const out = recommend(ctx);

  console.log("Team needs (continuous, in stdev units; positive = need):");
  console.log("  " + describeVector(out.teamNeeds));
  const ranked = rankNeeds(out.teamNeeds);
  console.log("");
  console.log("Top 5 needs by magnitude (sign matters):");
  for (let i = 0; i < Math.min(5, ranked.length); i++) {
    const r = ranked[i];
    if (!r) continue;
    const tag = r.mag > 0 ? "NEED" : "SURPLUS";
    console.log(`  ${i + 1}. ${r.cat}: ${r.mag.toFixed(2)} (${tag})`);
  }
  console.log("");

  console.log(`v2 top ${Math.min(5, out.ranked.length)} recommendations:`);
  console.log("");
  const top5 = out.ranked.slice(0, 5);
  for (let i = 0; i < top5.length; i++) {
    const rp = top5[i];
    if (!rp) continue;
    const b = rp.breakdown;
    console.log(`#${i + 1}  ${rp.player.name}  (${rp.player.team}, ${rp.player.positions.join("/")})`);
    console.log(
      `     final=${b.final.toFixed(2)}  G=${b.gScore.toFixed(2)}  fit=${b.fitBonus.toFixed(2)}  ` +
        `posPen=${b.positionPenalty.toFixed(2)}  conf=${b.confidence.toFixed(2)}`,
    );
    console.log(`     proj per-game: ${describeVector(rp.player.perGame)}`);
    console.log(`     z vector:      ${describeVector(b.categoryDeltas)}`);
    if (b.why.length) {
      for (const w of b.why) console.log(`     - ${w}`);
    }
    console.log("");
  }

  console.log(`Engine meta: qPool=${out.meta.qPoolSize}  alpha=${out.meta.alphaUsed}  ` +
    `leagueSize=${out.meta.leagueSize}  generated=${out.meta.generatedAt}`);
}

main();
