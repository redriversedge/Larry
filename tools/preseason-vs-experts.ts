// Preseason board acceptance: measure the board against the FantasyPros
// 6-expert consensus top 150.
//
// The regular-season gate (tools/rank-v2-vs-experts.ts) cannot cover this.
// It scores a mid-season snapshot where every player has real production;
// the preseason board runs on projections alone and exercises a different
// code path. Before this board existed the live ranking scored rho 0.637
// against the consensus, with Austin Reaves (expert 18) at 667th.
//
// Needs a preseason snapshot, which is git-ignored because it is a copy of
// the owner's league state. Two ways to produce one:
//
//   From the browser (what the spec describes):
//     copy(localStorage.getItem('larry_state'))
//     save to tests/fixtures/users/preseason-2027-snapshot.json
//
//   From a public fetch (reproducible, no login):
//     curl -H 'x-fantasy-filter: {"players":{"limit":1000,
//       "sortPercOwned":{"sortAsc":false,"sortPriority":1}}}' \
//       'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/\
//        2027/segments/0/leaguedefaults/3?view=kona_player_info' -o kona.json
//     npx tsx tools/kona-to-snapshot.ts kona.json 2027 \
//       tests/fixtures/users/preseason-2027-snapshot.json
//
// Run: npx tsx tools/preseason-vs-experts.ts

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT = path.join(ROOT, "tests/fixtures/users/preseason-2027-snapshot.json");
const CONSENSUS = path.join(ROOT, "tests/fixtures/expert-consensus-2026-10-13.json");

const RHO_FLOOR = 0.70;
const TOP50_FLOOR = 34;

// Spot checks from the spec. These are the players the old board got most
// obviously wrong, so they are the ones worth pinning by name.
const SPOT: Array<{ name: string; min?: number; max?: number }> = [
  { name: "Nikola Jokic", max: 1 },
  { name: "Austin Reaves", max: 100 },
  { name: "Kawhi Leonard", max: 50 },
  { name: "Damian Lillard", max: 100 },
  { name: "Kyrie Irving", min: 30, max: 60 },
  { name: "Dejounte Murray", min: 25, max: 45 },
  { name: "Tyrese Haliburton", max: 30 },
];

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

// Run the real js/engines.js against the snapshot, so this measures the
// code that ships rather than a reimplementation of it.
function computeBoard(state: any): any[] {
  const sandbox: any = { S: state };
  sandbox.window = sandbox;
  const engineSrc = fs.readFileSync(path.join(ROOT, "dist/larry-engine.js"), "utf8");
  new Function("window", "globalThis", engineSrc + "\n; window.LarryEngine = LarryEngine;")(
    sandbox, sandbox,
  );
  const globals: Record<string, any> = {
    window: sandbox,
    S: state,
    getOrderedCategories: () => state.league.categories.slice(),
    fmt: (n: number, d: number) => Number(n).toFixed(d),
    console,
    document: { querySelectorAll: () => [] },
    ESPNSync: { splitGP: () => 0 },
    durantKey: (v: unknown) => (v === null || v === undefined ? -Infinity : (v as number)),
    durantText: (v: unknown, d = 1) =>
      v === null || v === undefined ? "--" : Number(v).toFixed(d),
    isPreseason: () => true,
  };
  const names = Object.keys(globals);
  const Engines = new Function(
    ...names,
    fs.readFileSync(path.join(ROOT, "js/engines.js"), "utf8") +
      "\n; window.Engines = Engines; return window.Engines;",
  )(...names.map((n) => globals[n]));
  Engines.computeDURANT(state.allPlayers, { preseason: true });
  return state.allPlayers;
}

function main(): void {
  if (!fs.existsSync(SNAPSHOT)) {
    console.error("Missing " + path.relative(ROOT, SNAPSHOT));
    console.error("See the header of this file for how to produce one.");
    process.exit(2);
  }
  const state = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  const consensusRaw = JSON.parse(fs.readFileSync(CONSENSUS, "utf8"));
  // The fixture pulled straight from FantasyPros keys the list "rankings".
  const consensus = {
    asOf: consensusRaw.asOf,
    players: (consensusRaw.rankings ?? consensusRaw.players) as Array<{ rank: number; name: string }>,
  };

  // A browser-exported larry_state has these; a snapshot built from a raw
  // kona fetch does not. Fill in the defaults the engines read.
  state.prefs = state.prefs ?? {};
  state.myTeam = state.myTeam ?? { teamId: 1, players: [] };
  state.teams = state.teams ?? [];
  state.matchup = state.matchup ?? {};
  state.analysisCache = state.analysisCache ?? {};
  state.espn = state.espn ?? { lastSync: consensus.asOf };
  state.league.teamCount = state.league.teamCount ?? 12;
  state.league.rosterSize = state.league.rosterSize ?? 13;

  const players = computeBoard(state);
  const ranked = players
    .slice()
    .sort((a: any, b: any) => (a.durantRank || 0) - (b.durantRank || 0));

  const byName = new Map<string, any>();
  for (const p of ranked) {
    const k = norm(p.name || "");
    if (k && !byName.has(k)) byName.set(k, p);
  }

  const matched: Array<{ name: string; expert: number; larry: number }> = [];
  const missing: string[] = [];
  for (const e of consensus.players) {
    const p = byName.get(norm(e.name));
    if (!p || p.durantRank === undefined) { missing.push(e.name); continue; }
    matched.push({ name: e.name, expert: e.rank, larry: p.durantRank });
  }

  const rho = spearman(matched.map((m) => m.expert), matched.map((m) => m.larry));

  const top50Experts = new Set(
    consensus.players.filter((e: any) => e.rank <= 50).map((e: any) => norm(e.name)),
  );
  const larryTop50 = ranked.slice(0, 50).map((p: any) => norm(p.name || ""));
  const top50Overlap = larryTop50.filter((n: string) => top50Experts.has(n)).length;

  const top25Experts = new Set(
    consensus.players.filter((e: any) => e.rank <= 25).map((e: any) => norm(e.name)),
  );
  const top25Overlap = ranked.slice(0, 25)
    .map((p: any) => norm(p.name || ""))
    .filter((n: string) => top25Experts.has(n)).length;

  const line = "=".repeat(78);
  console.log(line);
  console.log("  PRESEASON BOARD vs FantasyPros 6-expert consensus (" + consensus.asOf + ")");
  console.log(line);
  console.log("  players on the board:   " + players.length);
  console.log("  with evidence:          " + players.filter((p: any) => !p.noEvidence).length);
  console.log("  no evidence (unranked): " + players.filter((p: any) => p.noEvidence).length);
  console.log("  matched to consensus:   " + matched.length +
    (missing.length ? "  (unmatched: " + missing.length + ")" : ""));
  console.log("");

  console.log("  TOP 15");
  ranked.slice(0, 15).forEach((p: any, i: number) => {
    const e = consensus.players.find((x: any) => norm(x.name) === norm(p.name || ""));
    console.log("    #" + String(i + 1).padStart(2) + "  " +
      String(p.name || "").padEnd(26) +
      String(Number(p.durantScore).toFixed(1)).padStart(7) +
      "   expert " + (e ? "#" + e.rank : "--") +
      (p.projectionSuspect ? "   [projection limited]" : ""));
  });
  console.log("");

  // The ordering invariant from 1.1, checked over the whole board rather
  // than by sampling: no unranked player may sit above a ranked one.
  let firstNoEvidence = Infinity;
  let lastEvidence = -Infinity;
  for (const p of ranked) {
    if (p.noEvidence) firstNoEvidence = Math.min(firstNoEvidence, p.durantRank);
    else lastEvidence = Math.max(lastEvidence, p.durantRank);
  }
  const orderingHolds = !isFinite(firstNoEvidence) || firstNoEvidence > lastEvidence;

  console.log("  SPOT CHECKS");
  let spotFails = 0;
  for (const s of SPOT) {
    const p = byName.get(norm(s.name));
    if (!p) {
      console.log("    FAIL " + s.name.padEnd(24) + "not on the board");
      spotFails++;
      continue;
    }
    const r = p.durantRank;
    const okMin = s.min === undefined || r >= s.min;
    const okMax = s.max === undefined || r <= s.max;
    const ok = okMin && okMax;
    if (!ok) spotFails++;
    const want = s.min !== undefined && s.max !== undefined
      ? "want " + s.min + " to " + s.max
      : s.max !== undefined ? "want <= " + s.max : "want >= " + s.min;
    console.log("    " + (ok ? "ok  " : "FAIL") + " " + s.name.padEnd(24) +
      ("#" + r).padStart(6) + "   " + want +
      (p.projectionSuspect ? "   [projection limited]" : ""));
  }
  console.log("");

  const rhoOk = rho >= RHO_FLOOR;
  const overlapOk = top50Overlap >= TOP50_FLOOR;
  const pass = rhoOk && overlapOk && spotFails === 0 && orderingHolds;

  console.log(line);
  console.log("  rho over matched top 150   " + (rhoOk ? "PASS" : "FAIL") +
    "  (" + rho.toFixed(3) + ", floor " + RHO_FLOOR.toFixed(2) + ")");
  console.log("  top-50 overlap             " + (overlapOk ? "PASS" : "FAIL") +
    "  (" + top50Overlap + ", floor " + TOP50_FLOOR + ")");
  console.log("  top-25 overlap                   (" + top25Overlap + ", reference only)");
  console.log("  spot checks                " + (spotFails === 0 ? "PASS" : "FAIL") +
    "  (" + (SPOT.length - spotFails) + " of " + SPOT.length + ")");
  console.log("  no unranked above ranked   " + (orderingHolds ? "PASS" : "FAIL"));
  console.log("  ACCEPTANCE: " + (pass ? "PASS" : "FAIL"));
  console.log(line);
  process.exitCode = pass ? 0 : 1;
}

main();
