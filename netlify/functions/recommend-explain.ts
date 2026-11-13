// netlify/functions/recommend-explain.ts
//
// Receives the deterministic engine's top 5 RankedPlayer objects + the
// user's team-need vector, calls Claude to produce a 2-sentence rationale,
// and returns { rationale: string }.
//
// Per LARRY_PLAN.md: Claude narrates deterministic numbers; it never ranks
// or scores. The engine has already decided. This function only writes
// English.
//
// Reuses the CORS pattern, ANTHROPIC_API_KEY env var lookup, and timeout
// handling from larry-chat.js.

import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import { connectLambda } from "@netlify/blobs";
import { checkDailyCap, DAILY_CAP_MESSAGE } from "../shared/daily-cap.mjs";

interface CategoryVector {
  REB: number;
  AST: number;
  STL: number;
  BLK: number;
  PTS: number;
}

interface ExplainTopPlayer {
  id: string;
  name: string;
  team: string;
  positions: string[];
  projection: CategoryVector;
  z: CategoryVector;
  final: number;
  fitBonus: number;
  why: string[];
}

interface ExplainPayload {
  topPlayers: ExplainTopPlayer[];
  teamNeeds: CategoryVector;
  biggestNeed: { category: string; magnitude: number };
  biggestSurplus: { category: string; magnitude: number };
}

interface NetlifyEvent {
  httpMethod: string;
  body: string | null;
  headers?: Record<string, string | undefined>;
  blobs?: string;
}

interface NetlifyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// Nov 2026: this was the one Claude-backed function with a wildcard CORS
// header, no rate limit and a pinned model id. It now follows the same
// trust model as larry-chat, larry-move and larry-plan: known origins only
// (plus this site's deploy previews), a per-minute bucket, the daily cap in
// netlify/shared/daily-cap.mjs, a payload cap, and the model from env.
const ALLOWED_ORIGINS = [
  "https://larrybball.netlify.app",
  "http://localhost:3000",
  "http://localhost:5000",
  "http://localhost:8888",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5000",
];
const PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+--larrybball\.netlify\.app$/;

const MODEL = process.env["ANTHROPIC_EXPLAIN_MODEL"] || process.env["ANTHROPIC_MODEL"] || "claude-sonnet-5";
const MAX_BODY_BYTES = 32 * 1024;
const MAX_TOP_PLAYERS = 5;

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const rateBuckets = new Map<string, { start: number; count: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) if (now - v.start > RATE_LIMIT_WINDOW_MS) rateBuckets.delete(k);
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

function headerOf(event: NetlifyEvent, name: string): string {
  const h = event.headers || {};
  return String(h[name] ?? h[name.toLowerCase()] ?? "");
}

function corsHeaders(origin: string): { headers: Record<string, string>; allowed: boolean } {
  const allowed = ALLOWED_ORIGINS.indexOf(origin) >= 0 || PREVIEW_ORIGIN.test(origin);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    Vary: "Origin",
  };
  if (allowed) headers["Access-Control-Allow-Origin"] = origin;
  return { headers, allowed };
}

// Resolved at cold-start. The prompt template lives next to the engine
// source. Netlify deploys the whole repo so this path is stable. If the
// file is missing we fall back to an inline prompt so we don't 500.
function loadPromptTemplate(): string {
  const candidates = [
    path.resolve(__dirname, "../../src/engine/prompts/coach.v1.md"),
    path.resolve(process.cwd(), "src/engine/prompts/coach.v1.md"),
  ];
  for (const candidate of candidates) {
    try {
      return fs.readFileSync(candidate, "utf-8");
    } catch {
      // Try next candidate.
    }
  }
  return (
    "You are Larry, a fantasy basketball assistant. " +
    "In two sentences, no preamble, no emojis, no em dashes: explain why " +
    "the top recommended player addresses the user's biggest category need."
  );
}

function callClaude(apiKey: string, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.anthropic.com",
      port: 443,
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on("end", () => {
        if ((res.statusCode ?? 0) >= 400) {
          const err = new Error(
            "Claude API returned " + res.statusCode + ": " + body.substring(0, 200),
          );
          (err as Error & { statusCode?: number }).statusCode = res.statusCode;
          reject(err);
        } else {
          resolve(body);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Claude API timed out"));
    });
    req.write(payload);
    req.end();
  });
}

export const handler = async (event: NetlifyEvent): Promise<NetlifyResponse> => {
  const origin = headerOf(event, "origin");
  const { headers: HEADERS, allowed } = corsHeaders(origin);
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: allowed ? 200 : 403, headers: HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: "POST only" }) };
  }
  // Same rule as the other functions: a browser request from an origin we do
  // not serve is refused; a request with no Origin (curl, the CLI) is not.
  if (origin && !allowed) {
    return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: "Origin not allowed" }) };
  }
  const ip =
    headerOf(event, "x-nf-client-connection-ip") ||
    headerOf(event, "client-ip") ||
    headerOf(event, "x-forwarded-for").split(",")[0]!.trim() ||
    "unknown";
  if (rateLimited(ip)) {
    return {
      statusCode: 429,
      headers: Object.assign({ "Retry-After": "60" }, HEADERS),
      body: JSON.stringify({ error: "Too many requests. Wait a minute and try again." }),
    };
  }
  if (Buffer.byteLength(event.body ?? "", "utf8") > MAX_BODY_BYTES) {
    return { statusCode: 413, headers: HEADERS, body: JSON.stringify({ error: "Request too large" }) };
  }
  try {
    const parsed = JSON.parse(event.body ?? "{}") as Partial<ExplainPayload>;
    if (!parsed.topPlayers || !Array.isArray(parsed.topPlayers) || !parsed.teamNeeds) {
      return {
        statusCode: 400,
        headers: HEADERS,
        body: JSON.stringify({
          error: "topPlayers (array) and teamNeeds (object) are required",
        }),
      };
    }
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: HEADERS,
        body: JSON.stringify({
          error: "ANTHROPIC_API_KEY not configured. Add it in Netlify site settings.",
        }),
      };
    }
    // Lambda-compatible functions have to hand Blobs its context explicitly.
    try {
      if (event.blobs) connectLambda(event as unknown as Parameters<typeof connectLambda>[0]);
    } catch {
      // checkDailyCap fails open on its own if the store is unreachable.
    }
    const daily = await checkDailyCap("recommend-explain", ip);
    if (daily.limited) {
      return {
        statusCode: 429,
        headers: Object.assign({ "Retry-After": "3600" }, HEADERS),
        body: JSON.stringify({ error: DAILY_CAP_MESSAGE }),
      };
    }
    const systemPrompt = loadPromptTemplate();
    const userMessage = JSON.stringify(Object.assign({}, parsed, { topPlayers: parsed.topPlayers.slice(0, MAX_TOP_PLAYERS) }));
    const requestPayload = JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    const data = await callClaude(apiKey, requestPayload);
    const claudeResponse = JSON.parse(data) as { content?: Array<{ type: string; text?: string }> };
    let rationale = "";
    if (claudeResponse.content) {
      for (const block of claudeResponse.content) {
        if (block.type === "text" && block.text) rationale += block.text;
      }
    }
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ rationale: rationale.trim() }),
    };
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    console.error("recommend-explain error:", e.message);
    return {
      statusCode: e.statusCode ?? 500,
      headers: HEADERS,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
