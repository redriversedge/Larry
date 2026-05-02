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
}

interface NetlifyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

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
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: "POST only" }) };
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
    const systemPrompt = loadPromptTemplate();
    const userMessage = JSON.stringify(parsed);
    const requestPayload = JSON.stringify({
      model: "claude-sonnet-4-6",
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
