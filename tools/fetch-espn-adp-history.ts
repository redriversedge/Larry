// Fetch historical ESPN average draft position from FantasyPros and write
// data/espn-adp-history.json.
//
// Why this file is committed, and why it exists at all:
//
//   The Draft Room measures each manager's "reach" as ESPN ADP minus the
//   overall pick they used. That needs the PRE-draft board for a finished
//   season, and ESPN does not keep one. For a past season:
//     - draftRanksByRankType (STANDARD and ROTO) holds ESPN's END-OF-SEASON
//       ranks. 2026 ROTO has Jalen Johnson 5th; he went around 33rd.
//     - ownership.averageDraftPosition is garbage for past seasons (Jokic 140).
//   Using either one makes every manager look like a genius or an idiot
//   depending on which players broke out. See docs/DRAFT_ROOM_SPEC.md s1.
//
//   FantasyPros keeps an ESPN ADP column per season back to 2018-19. That is
//   public data about public draft boards, not league data, so unlike the
//   draft history itself it may be committed. The browser cannot fetch it
//   (no CORS headers), which is why the result ships as a JSON file.
//
// Season id convention matches the rest of the app: seasonId is the calendar
// year the season ENDS in, so FantasyPros year=2025 is seasonId 2026.
// ESPN ADP starts with the 2018-19 season, i.e. seasonId 2019, so the 2018
// draft has no reach data.
//
// Run: npx tsx tools/fetch-espn-adp-history.ts
//      npx tsx tools/fetch-espn-adp-history.ts --check   (no write, report only)

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data/espn-adp-history.json");

// seasonId, inclusive. 2019 is the first season with an ESPN ADP column.
const FIRST_SEASON = 2019;
const LAST_SEASON = 2026;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type AdpRow = [string, number];

function url(seasonId: number): string {
  return `https://www.fantasypros.com/nba/adp/overall.php?year=${seasonId - 1}`;
}

// Same normalization as tools/preseason-vs-experts.ts, so names matched
// against ESPN players go through one shared rule.
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

function decodeEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// The ADP table's <tr> elements are never closed and the column count
// changes by year (2018-19 and 2019-20 carry a CBS column, later years do
// not). So: find the ESPN column index from the header, then split the body
// on <tr> and read cells positionally.
export function parseAdpPage(html: string): AdpRow[] {
  const thead = html.match(/<thead[\s\S]*?<\/thead>/);
  if (!thead) throw new Error("no <thead> in ADP page");

  const headers = (thead[0].match(/<th[^>]*>([\s\S]*?)<\/th>/g) || []).map((th) =>
    th.replace(/<[^>]*>/g, "").trim().toLowerCase(),
  );
  const espnCol = headers.indexOf("espn");
  if (espnCol < 0) {
    throw new Error(`no ESPN column; headers were [${headers.join(", ")}]`);
  }

  const bodyStart = html.indexOf("<tbody");
  if (bodyStart < 0) throw new Error("no <tbody> in ADP page");
  const bodyEnd = html.indexOf("</tbody>", bodyStart);
  const body = html.slice(bodyStart, bodyEnd < 0 ? undefined : bodyEnd);

  const out: AdpRow[] = [];
  const seen = new Set<string>();

  for (const chunk of body.split(/<tr[^>]*>/).slice(1)) {
    const cells = (chunk.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []).map((td) => td);
    if (cells.length <= espnCol) continue;

    // Prefer the explicit fp-player-name attribute over the link text: it is
    // the unabbreviated name and has no trailing "(DEN - C)" position blurb.
    const nameCell = cells.find((c) => c.indexOf("player-label") >= 0) || cells[1] || "";
    const attr = nameCell.match(/fp-player-name="([^"]*)"/);
    const rawName = attr
      ? attr[1]
      : nameCell
          .replace(/<small>[\s\S]*?<\/small>/g, "")
          .replace(/<[^>]*>/g, "")
          .trim();
    const name = norm(decodeEntities(rawName || ""));
    if (!name) continue;

    const espnCell = cells[espnCol];
    if (espnCell === undefined) continue;
    const espnText = espnCell.replace(/<[^>]*>/g, "").trim();
    const adp = Number(espnText);
    // A dash or blank means that site did not rank the player.
    if (!espnText || !Number.isFinite(adp) || adp <= 0) continue;

    // Keep the first (best) listing if a name somehow repeats.
    if (seen.has(name)) continue;
    seen.add(name);
    out.push([name, adp]);
  }

  if (!out.length) throw new Error("parsed 0 rows from ADP page");
  out.sort((a, b) => a[1] - b[1]);
  return out;
}

async function fetchSeason(seasonId: number): Promise<AdpRow[]> {
  const resp = await fetch(url(seasonId), { headers: { "user-agent": UA } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return parseAdpPage(await resp.text());
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  const history: Record<string, AdpRow[]> = {};
  const failures: string[] = [];

  for (let season = FIRST_SEASON; season <= LAST_SEASON; season++) {
    try {
      const rows = await fetchSeason(season);
      history[String(season)] = rows;
      const top = rows[0];
      console.log(
        `${season} (FantasyPros year=${season - 1}): ${rows.length} players, ` +
          `top=${top ? top[0] : "none"}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${season}: FAILED (${msg})`);
      failures.push(`${season}: ${msg}`);
    }
  }

  const seasons = Object.keys(history);
  if (!seasons.length) {
    console.error("No seasons fetched. Not writing.");
    process.exit(1);
  }

  // Two pages returning an identical list means the year parameter was
  // ignored and every season would share one board. Worth failing on.
  for (let i = 0; i < seasons.length; i++) {
    for (let j = i + 1; j < seasons.length; j++) {
      const a = history[seasons[i] as string] as AdpRow[];
      const b = history[seasons[j] as string] as AdpRow[];
      if (JSON.stringify(a) === JSON.stringify(b)) {
        console.error(
          `Seasons ${seasons[i]} and ${seasons[j]} are identical. ` +
            "FantasyPros likely ignored the year parameter.",
        );
        process.exit(1);
      }
    }
  }

  if (checkOnly) {
    console.log("\n--check: parsed cleanly, nothing written.");
    if (failures.length) process.exit(1);
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(history) + "\n");
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`\nWrote ${OUT} (${seasons.length} seasons, ${kb} KB)`);
  if (failures.length) {
    console.error(`\n${failures.length} season(s) missing:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
