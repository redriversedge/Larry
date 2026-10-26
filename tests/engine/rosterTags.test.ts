// Must Roster / Don't Drop tags (core.js). Top 75 by Larry rank: a free
// agent gets MUST ROSTER, a rostered player gets DON'T DROP.
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const src = fs.readFileSync(path.resolve(__dirname, "../../js/core.js"), "utf8");
const start = src.indexOf("var ROSTER_TAG_CUTOFF");
const end = src.indexOf("function rosterTagHtml");
const close = src.indexOf("\n}\n", end) + 3;
const api = new Function(src.slice(start, close) + "; return { rosterTagFor, rosterTagHtml };")();

describe("roster tags", () => {
  it("tags a top-75 free agent MUST ROSTER", () => {
    expect(api.rosterTagFor({ durantRank: 40, onTeamId: 0 })).toBe("must");
    expect(api.rosterTagHtml({ durantRank: 75, onTeamId: 0 })).toContain("MUST ROSTER");
  });
  it("tags a top-75 rostered player DON'T DROP", () => {
    expect(api.rosterTagFor({ durantRank: 3, onTeamId: 10 })).toBe("dontdrop");
    expect(api.rosterTagHtml({ durantRank: 3, onTeamId: 10 })).toContain("DON'T DROP");
  });
  it("leaves rank 76, unranked and no-evidence players untagged", () => {
    expect(api.rosterTagHtml({ durantRank: 76, onTeamId: 0 })).toBe("");
    expect(api.rosterTagHtml({ onTeamId: 0 })).toBe("");
    expect(api.rosterTagHtml({ durantRank: 5, noEvidence: true, onTeamId: 0 })).toBe("");
    expect(api.rosterTagHtml(null)).toBe("");
  });
});
