// Watchlist alerts (tabs.js): hot/cold form and injury status changes.
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const src = fs.readFileSync(path.resolve(__dirname, "../../js/tabs.js"), "utf8");
const block = src.slice(src.indexOf("function watchlistPlayers()"), src.indexOf("// Players tab: Players / Watchlist toggle."));

function load(S: any) {
  return new Function("S", "autosave", "render",
    block + "; return { watchlistAlerts, watchlistAlertCount, ackWatchStatus, watchStatusLabel };")(S, () => {}, () => {});
}

describe("watchlist alerts", () => {
  it("records the status on first sight and then flags a change", () => {
    const p: any = { id: 1, injuryStatus: "ACTIVE" };
    const S: any = { watchlist: [1], allPlayers: [p] };
    const w = load(S);
    expect(w.watchlistAlerts(p)).toEqual([]);
    p.injuryStatus = "OUT";
    const a = w.watchlistAlerts(p);
    expect(a).toHaveLength(1);
    expect(a[0].kind).toBe("injury");
    expect(a[0].text).toContain("Healthy");
    expect(a[0].text).toContain("Out");
    expect(w.watchlistAlertCount()).toBe(1);
    w.ackWatchStatus(1);
    expect(w.watchlistAlerts(p)).toEqual([]);
  });
  it("treats ACTIVE and HEALTHY as the same status", () => {
    const p: any = { id: 2, injuryStatus: "ACTIVE" };
    const S: any = { watchlist: [2], allPlayers: [p], watchlistSeen: { 2: "Healthy" } };
    p.injuryStatus = "HEALTHY";
    expect(load(S).watchlistAlerts(p)).toEqual([]);
  });
  it("flags hot and cold form", () => {
    const S: any = { watchlist: [3], allPlayers: [] };
    const w = load(S);
    expect(w.watchlistAlerts({ id: 3, trend: "hot" })[0].kind).toBe("hot");
    expect(w.watchlistAlerts({ id: 3, trend: "cold" })[0].kind).toBe("cold");
  });
});
