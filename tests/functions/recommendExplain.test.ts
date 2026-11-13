// recommend-explain follows the same trust model as the other Claude-backed
// functions: known origins only, a payload cap, and the model from env.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handler } from "../../netlify/functions/recommend-explain";

const BODY = JSON.stringify({
  topPlayers: [{ id: "1", name: "A", team: "T", positions: ["G"], projection: {}, z: {}, final: 1, fitBonus: 0, why: [] }],
  teamNeeds: { REB: 1, AST: 0, STL: 0, BLK: 0, PTS: 0 },
});

function event(origin: string, body = BODY, ip = "203.0.113." + Math.floor(Math.random() * 200 + 10)) {
  return { httpMethod: "POST", body, headers: { origin, "x-nf-client-connection-ip": ip } };
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe("recommend-explain", () => {
  it("no longer sends a wildcard CORS header", async () => {
    const res = await handler({ httpMethod: "OPTIONS", body: null, headers: { origin: "https://evil.example" } });
    expect(res.statusCode).toBe(403);
    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("refuses a browser request from an origin it does not serve", async () => {
    const res = await handler(event("https://evil.example"));
    expect(res.statusCode).toBe(403);
  });

  it("echoes the live site and its deploy previews", async () => {
    for (const origin of ["https://larrybball.netlify.app", "https://deploy-preview-12--larrybball.netlify.app"]) {
      const res = await handler({ httpMethod: "OPTIONS", body: null, headers: { origin } });
      expect(res.statusCode).toBe(200);
      expect(res.headers["Access-Control-Allow-Origin"]).toBe(origin);
    }
  });

  it("refuses an oversized payload before calling Claude", async () => {
    const res = await handler(event("https://larrybball.netlify.app", "x".repeat(40 * 1024)));
    expect(res.statusCode).toBe(413);
  });

  it("rate limits per IP", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const res = await handler(event("https://larrybball.netlify.app", "{}", "198.51.100.77"));
      last = res.statusCode;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});
