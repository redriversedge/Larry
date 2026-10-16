// Pull the preseason boards OTHER people published, so Larry's board can be
// scored against them rather than only against itself.
// docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md A1.
//
// Three comparison boards per season:
//   - FantasyPros expert consensus (ECR), 11 experts
//   - Yahoo ADP
//   - ESPN ADP
//
// All public data about public draft boards, so unlike league draft history
// this may be committed. Nothing in the app reads the output; it exists for
// tools/backtest-preseason-board.ts.
//
// Season id convention is the app's: the calendar year the season ENDS in,
// so FantasyPros year=2024 is seasonId 2025.
//
// Run: npx tsx tools/fetch-preseason-rankings-history.ts
//      npx tsx tools/fetch-preseason-rankings-history.ts --check

import * as fs from "fs";
import * as path from "path";

import { parseAdpPage } from "./fetch-espn-adp-history";

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data/preseason-rankings-history.json");
// The CURRENT season's market, which the live board blends with. Same
// pages with no year parameter. Re-run this right before the draft.
const OUT_CURRENT = path.join(ROOT, "data/market-rankings-current.json");

// The seasons the backtest scores. Both are complete, so ground truth
// exists for them.
const SEASONS = [2025, 2026];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// [normalizedName, rank]
export type RankRow = [string, number];

export interface SeasonBoards {
  ecr: RankRow[];
  yahooAdp: RankRow[];
  espnAdp: RankRow[];
  experts: number;
  ecrUpdated: string;
}

// Same rule as tools/fetch-espn-adp-history.ts and draftProfiles.normName.
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

// The rankings page embeds the whole board as `var ecrData = {...}`. Brace
// matching rather than a regex, because the object contains player page
// URLs with braces nowhere but is still too big to trust a lazy match on.
export function parseEcrPage(html: string): { rows: RankRow[]; experts: number; updated: string } {
  const marker = html.indexOf("ecrData");
  if (marker < 0) throw new Error("no ecrData on the rankings page");
  const start = html.indexOf("{", marker);
  if (start < 0) throw new Error("no ecrData object");

  let depth = 0;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error("unterminated ecrData object");

  const data = JSON.parse(html.slice(start, end)) as {
    players?: Array<{ player_name?: string; rank_ecr?: string }>;
    total_experts?: number;
    last_updated?: string;
  };

  const rows: RankRow[] = [];
  const seen = new Set<string>();
  for (const player of data.players || []) {
    const name = norm(String(player.player_name || ""));
    const rank = Number(player.rank_ecr);
    if (!name || !Number.isFinite(rank) || rank <= 0) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    rows.push([name, rank]);
  }
  if (!rows.length) throw new Error("parsed 0 rows from ecrData");
  rows.sort((a, b) => a[1] - b[1]);

  return {
    rows,
    experts: Number(data.total_experts) || 0,
    updated: String(data.last_updated || ""),
  };
}

// The ADP page's Yahoo column, read the same way fetch-espn-adp-history.ts
// reads the ESPN column.
export function parseAdpColumn(html: string, column: string): RankRow[] {
  const thead = html.match(/<thead[\s\S]*?<\/thead>/);
  if (!thead) throw new Error("no <thead> on the ADP page");
  const headers = (thead[0].match(/<th[^>]*>([\s\S]*?)<\/th>/g) || []).map((th) =>
    th.replace(/<[^>]*>/g, "").trim().toLowerCase(),
  );
  const col = headers.indexOf(column.toLowerCase());
  if (col < 0) throw new Error("no " + column + " column; headers [" + headers.join(", ") + "]");

  const bodyStart = html.indexOf("<tbody");
  const bodyEnd = html.indexOf("</tbody>", bodyStart);
  const body = html.slice(bodyStart, bodyEnd < 0 ? undefined : bodyEnd);

  const out: RankRow[] = [];
  const seen = new Set<string>();
  for (const chunk of body.split(/<tr[^>]*>/).slice(1)) {
    const cells = chunk.match(/<td[^>]*>[\s\S]*?<\/td>/g) || [];
    if (cells.length <= col) continue;
    const nameCell = cells.find((c) => c.indexOf("player-label") >= 0) || cells[1] || "";
    const attr = nameCell.match(/fp-player-name="([^"]*)"/);
    const rawName = attr
      ? attr[1] || ""
      : nameCell.replace(/<small>[\s\S]*?<\/small>/g, "").replace(/<[^>]*>/g, "").trim();
    const name = norm(rawName);
    if (!name || seen.has(name)) continue;
    const text = (cells[col] as string).replace(/<[^>]*>/g, "").trim();
    const value = Number(text);
    if (!text || !Number.isFinite(value) || value <= 0) continue;
    seen.add(name);
    out.push([name, value]);
  }
  out.sort((a, b) => a[1] - b[1]);
  return out;
}

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return res.text();
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  const out: Record<string, SeasonBoards> = {};

  for (const seasonId of SEASONS) {
    const year = seasonId - 1;
    const ecrHtml = await get(
      "https://www.fantasypros.com/nba/rankings/overall.php?year=" + year,
    );
    const adpHtml = await get("https://www.fantasypros.com/nba/adp/overall.php?year=" + year);

    const ecr = parseEcrPage(ecrHtml);
    const yahooAdp = parseAdpColumn(adpHtml, "Yahoo");
    const espnAdp = parseAdpPage(adpHtml);

    out[String(seasonId)] = {
      ecr: ecr.rows,
      yahooAdp,
      espnAdp,
      experts: ecr.experts,
      ecrUpdated: ecr.updated,
    };

    console.log(
      seasonId + " (FantasyPros year=" + year + "): ECR " + ecr.rows.length +
        " players from " + ecr.experts + " experts, updated " + ecr.updated +
        "; Yahoo ADP " + yahooAdp.length + "; ESPN ADP " + espnAdp.length,
    );
  }

  // Two seasons returning an identical board means the year parameter was
  // ignored and the whole comparison would be meaningless.
  const keys = Object.keys(out);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = out[keys[i] as string] as SeasonBoards;
      const b = out[keys[j] as string] as SeasonBoards;
      if (JSON.stringify(a.ecr) === JSON.stringify(b.ecr)) {
        console.error("Seasons " + keys[i] + " and " + keys[j] + " have identical ECR.");
        process.exit(1);
      }
    }
  }

  // --- The current season, which the live board actually blends with ---
  //
  // No year parameter means "now". The ESPN column here is preseason ADP
  // for the season about to start; the app prefers its own live ESPN ADP
  // from the league fetch, but having it here keeps the file self
  // contained if that is ever unavailable.
  const currentEcrHtml = await get("https://www.fantasypros.com/nba/rankings/overall.php");
  const currentAdpHtml = await get("https://www.fantasypros.com/nba/adp/overall.php");
  const currentEcr = parseEcrPage(currentEcrHtml);
  const current = {
    pulledAt: new Date().toISOString(),
    ecr: currentEcr.rows,
    yahooAdp: parseAdpColumn(currentAdpHtml, "Yahoo"),
    espnAdp: parseAdpPage(currentAdpHtml),
    experts: currentEcr.experts,
    ecrUpdated: currentEcr.updated,
  };
  console.log(
    "current: ECR " + current.ecr.length + " players from " + current.experts +
      " experts, updated " + current.ecrUpdated + "; Yahoo ADP " +
      current.yahooAdp.length + "; ESPN ADP " + current.espnAdp.length,
  );

  // A current board identical to last season's means the un-parameterized
  // pages are serving an archive, and the live blend would be a year out
  // of date without anyone noticing.
  const lastSeason = out[String(SEASONS[SEASONS.length - 1])];
  if (lastSeason && JSON.stringify(lastSeason.ecr) === JSON.stringify(current.ecr)) {
    console.error(
      "The current ECR is identical to " + SEASONS[SEASONS.length - 1] +
        ". FantasyPros is serving an archived board; not writing the current file.",
    );
    process.exit(1);
  }

  if (checkOnly) {
    console.log("\n--check: parsed cleanly, nothing written.");
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
  console.log("\nWrote " + OUT + " (" + Math.round(fs.statSync(OUT).size / 1024) + " KB)");
  fs.writeFileSync(OUT_CURRENT, JSON.stringify(current) + "\n");
  console.log(
    "Wrote " + OUT_CURRENT + " (" +
      Math.round(fs.statSync(OUT_CURRENT).size / 1024) + " KB)",
  );
}

if (require.main === module) {
  void main();
}
