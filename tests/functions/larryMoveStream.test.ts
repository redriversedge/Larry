// Larry's Move transport: the handler streams, so the answer is no longer
// bound by Netlify's 10-second limit on a buffered response. What is pinned
// here is what reaches the client and with which status. The card contract
// itself (validateMove) is covered in larryMove.test.ts.

import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- .mjs has no type declarations
import handler, { _internal } from "../../netlify/functions/larry-move.mjs";

const ORIGIN = "https://larrybball.netlify.app";
const FIXTURE = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, "../fixtures/larry-move/clear-add-drop.json"), "utf8"));

let ipSeq = 0;
function post(body: unknown): Request {
  ipSeq++;
  return new Request("https://larrybball.netlify.app/.netlify/functions/larry-move", {
    method: "POST",
    headers: {
      "Content-Type": "application/json", origin: ORIGIN,
      "x-nf-client-connection-ip": "10.9.0." + ipSeq,
    },
    body: JSON.stringify(body),
  });
}

function sse(obj: any): string {
  return "event: " + obj.type + "\ndata: " + JSON.stringify(obj) + "\n\n";
}

const GOOD_INPUT = {
  headline: "Add the stealer, drop the dead roster spot.",
  noMove: false,
  actions: [{ type: "add_drop", action: "Add A, drop B", reason: "Steals are close." }],
  matchupRead: { summary: "You lead 4 of 5.", winning: ["REB"], close: ["STL"], losing: [] },
  confidence: "medium",
};

// The tool input split into fragments, the way the API streams it.
function toolEvents(input: unknown, pieces = 5): string[] {
  const json = JSON.stringify(input);
  const size = Math.ceil(json.length / pieces);
  const out = [sse({ type: "message_start", message: {} }),
    sse({ type: "content_block_start", index: 0,
      content_block: { type: "tool_use", name: "report_move", id: "t1", input: {} } })];
  for (let i = 0; i < json.length; i += size) {
    out.push(sse({ type: "content_block_delta", index: 0,
      delta: { type: "input_json_delta", partial_json: json.slice(i, i + size) } }));
  }
  out.push(sse({ type: "content_block_stop", index: 0 }));
  out.push(sse({ type: "message_stop" }));
  return out;
}

function upstream(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(ctrl) { for (const c of chunks) ctrl.enqueue(enc.encode(c)); ctrl.close(); },
  }), { status });
}

async function framesOf(res: Response): Promise<any[]> {
  return (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

let realFetch: typeof globalThis.fetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  delete process.env.ANTHROPIC_API_KEY;
});

describe("larry-move handler: streaming", () => {
  it("reassembles the streamed tool input and sends one validated move", async () => {
    globalThis.fetch = vi.fn(async () => upstream(toolEvents(GOOD_INPUT))) as any;
    const res = await handler(post(Object.assign({}, FIXTURE, { payloadHash: "h-good-" + Date.now() })), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const frames = await framesOf(res);
    expect(frames[0]).toEqual({ p: 0 });
    const moves = frames.filter((f) => f.move);
    expect(moves).toHaveLength(1);
    expect(moves[0].move.headline).toBe(GOOD_INPUT.headline);
    expect(moves[0].move.matchupRead.close).toEqual(["STL"]);
    expect(frames[frames.length - 1]).toEqual({ done: true });
  });

  it("asks the API to stream, with the forced report_move tool", async () => {
    let sent: any = null;
    globalThis.fetch = vi.fn(async (_u: any, init: any) => {
      sent = JSON.parse(init.body);
      return upstream(toolEvents(GOOD_INPUT));
    }) as any;
    await (await handler(post(Object.assign({}, FIXTURE, { payloadHash: "h-req-" + Date.now() })), {})).text();
    expect(sent.stream).toBe(true);
    expect(sent.tool_choice).toEqual({ type: "tool", name: "report_move" });
    expect(sent.max_tokens).toBe(1800);
    expect(sent.thinking).toEqual({ type: "disabled" });
  });

  it("serves a repeat request from cache without calling the API", async () => {
    const hash = "h-cache-" + Date.now();
    globalThis.fetch = vi.fn(async () => upstream(toolEvents(GOOD_INPUT))) as any;
    await (await handler(post(Object.assign({}, FIXTURE, { payloadHash: hash })), {})).text();
    const spy = vi.fn();
    globalThis.fetch = spy as any;
    const frames = await framesOf(await handler(post(Object.assign({}, FIXTURE, { payloadHash: hash })), {}));
    expect(spy).not.toHaveBeenCalled();
    expect(frames[0].cached).toBe(true);
    expect(frames[0].move.headline).toBe(GOOD_INPUT.headline);
  });

  it("sends an error line, not a move, when the tool input is unusable", async () => {
    globalThis.fetch = vi.fn(async () => upstream(toolEvents({ headline: "" }))) as any;
    const frames = await framesOf(await handler(post(Object.assign({}, FIXTURE, { payloadHash: "h-bad-" + Date.now() })), {}));
    expect(frames.some((f) => f.move)).toBe(false);
    expect(frames[frames.length - 1].error).toMatch(/usable answer/);
  });

  it("returns 504 with a retry message when the API cannot be reached", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("socket hang up"); }) as any;
    const res = await handler(post(Object.assign({}, FIXTURE, { payloadHash: "h-down-" + Date.now() })), {});
    expect(res.status).toBe(504);
    expect((await res.json()).error).toMatch(/took too long/);
  });

  it("falls back to ANTHROPIC_MODEL when the Move model 404s", async () => {
    const models: string[] = [];
    process.env.ANTHROPIC_MODEL = "fallback-model";
    globalThis.fetch = vi.fn(async (_u: any, init: any) => {
      const m = JSON.parse(init.body).model;
      models.push(m);
      return models.length === 1 ? new Response("not found", { status: 404 }) : upstream(toolEvents(GOOD_INPUT));
    }) as any;
    const frames = await framesOf(await handler(post(Object.assign({}, FIXTURE, { payloadHash: "h-404-" + Date.now() })), {}));
    delete process.env.ANTHROPIC_MODEL;
    if (_internal.MODEL === "fallback-model") return; // nothing to fall back to
    expect(models[1]).toBe("fallback-model");
    expect(frames.some((f) => f.move)).toBe(true);
  });

  it("rejects a foreign origin before any upstream call", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as any;
    const req = new Request("https://larrybball.netlify.app/.netlify/functions/larry-move", {
      method: "POST", headers: { origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify(FIXTURE),
    });
    expect((await handler(req, {})).status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("larry-move client: parseLarryMoveStream", () => {
  // The client is legacy browser JS; load the one pure function it needs.
  const src = fs.readFileSync(path.resolve(__dirname, "../../js/larry-move.js"), "utf8");
  const start = src.indexOf("function parseLarryMoveStream");
  const end = src.indexOf("\n}\n", start) + 2;
  const parse = new Function(src.slice(start, end) + "\nreturn parseLarryMoveStream;")();

  it("takes the move and ignores progress lines", () => {
    const out = parse('{"p":0}\n{"p":4}\n{"move":{"headline":"x"},"cached":false}\n{"done":true}\n');
    expect(out.move).toEqual({ headline: "x" });
    expect(out.error).toBe("");
  });

  it("reports the error line when no move arrived", () => {
    const out = parse('{"p":0}\n{"error":"Larry took too long. Tap Retry to try again."}\n');
    expect(out.move).toBeNull();
    expect(out.error).toMatch(/took too long/);
  });
});

// Oct 29-30 2026: every Move call ran ~11s and came back "could not produce
// a usable answer". The tool JSON was being cut off at max_tokens.
describe("larry-move truncated tool input", () => {
  it("records why: stop_reason max_tokens and an unparsable fragment", () => {
    const c = (_internal as any).toolCollector();
    c.push({ type: "content_block_start", content_block: { type: "tool_use", name: "report_move" } });
    c.push({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"headline":"Start Chet","matchupRead":{"summ' } });
    c.push({ type: "message_delta", delta: { stop_reason: "max_tokens" } });
    expect(c.input()).toBeNull();
    expect(c.stopReason()).toBe("max_tokens");
    expect(c.jsonLength()).toBeGreaterThan(0);
  });
});
