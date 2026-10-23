// The chat client's streaming reader and its history rules (js/chat.js).
//
// docs/CHAT_TIMEOUT_SPEC.md 2b and 2d. Two of these are rules that have
// already been broken once and are invisible when they break:
//
//   - error text must never reach _chatHistory, or every later request
//     replays "Chat is unavailable right now." to the model as a real
//     assistant turn and teaches it that apologising is a normal answer;
//   - thinking text must never reach _chatHistory either, for the same
//     reason plus the fact that it is the model's own reasoning.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

// js/chat.js is a browser script of top-level functions. Load it with the
// globals it closes over and hand back the ones the tests drive.
function loadChat() {
  const src = fs.readFileSync(path.join(ROOT, "js/chat.js"), "utf8");

  // Minimal DOM: the functions under test only read a handful of elements.
  const elements: Record<string, any> = {};
  const mkEl = () => ({ innerHTML: "", value: "", disabled: false, scrollTop: 0, scrollHeight: 0 });
  for (const id of ["chat-messages", "chat-stream-think", "chat-stream-text", "chat-input"]) {
    elements[id] = mkEl();
  }
  const document = {
    getElementById: (id: string) => elements[id] || null,
    querySelector: () => mkEl(),
    querySelectorAll: () => [],
  };

  const S: any = {
    league: { teamCount: 12, name: "L", scoringType: "H2H" },
    myTeam: { teamId: 1, players: [], record: { wins: 1, losses: 0, ties: 0 } },
    matchup: {},
    allPlayers: [],
    prefs: {},
  };

  const globals: Record<string, any> = {
    document,
    S,
    console,
    window: {},
    TextDecoder,
    // Resolved per call, not captured once: the tests swap globalThis.fetch
    // between cases, and binding it here by value gave every test the
    // previous test's stub.
    fetch: (...args: any[]) => (globalThis.fetch as any)(...args),
    esc: (s: any) => String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    getLarryAvatar: () => "<svg></svg>",
    render: () => {},
    getOrderedCategories: () => [{ abbr: "PTS" }],
    byDurantRank: () => 0,
    getMatchupDates: () => ({ start: new Date(), end: new Date(), daysLeft: 4 }),
    Engines: {
      ensureDURANT: () => {},
      isValidAddCandidate: () => false,
      generateRecommendations: () => [],
    },
    durantKey: () => 0,
  };

  const names = Object.keys(globals);
  const exported = [
    "sendChat", "retryChat", "runChatRequest", "chatMessagesHtml",
    "chatThinkingHtml", "chatStreamTextHtml", "dismissChatError",
  ];
  const fn = new Function(
    ...names,
    src + "\n; return {" + exported.map((n) => n + ": " + n).join(", ") +
      ", state: function() { return { history: _chatHistory, error: _chatError, " +
      "canRetry: _chatCanRetry, sending: _chatSending, stream: _chatStream }; }" +
      ", reset: function() { _chatHistory = []; _chatError = ''; _chatCanRetry = false; " +
      "_chatSending = false; _chatStream = null; } };",
  );
  return { api: fn(...names.map((n) => globals[n])), elements, S };
}

// A streamed NDJSON response, the shape larry-chat.mjs returns.
function ndjson(lines: unknown[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(ctrl) {
      for (const l of lines) ctrl.enqueue(encoder.encode(JSON.stringify(l) + "\n"));
      ctrl.close();
    },
  });
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

let chat: ReturnType<typeof loadChat>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  chat = loadChat();
  chat.api.reset();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("chat client: streaming an answer", () => {
  it("assembles the deltas into one history entry", async () => {
    globalThis.fetch = vi.fn(async () => ndjson([
      { t: "Garland " }, { t: "is the " }, { t: "better buy." }, { done: true },
    ])) as any;

    await chat.api.sendChat("Who should I trade for?");

    const s = chat.api.state();
    expect(s.history).toEqual([
      { role: "user", content: "Who should I trade for?" },
      { role: "assistant", content: "Garland is the better buy." },
    ]);
    expect(s.error).toBe("");
    expect(s.sending).toBe(false);
    expect(s.stream).toBeNull();
  });

  it("handles frames split across chunk boundaries", async () => {
    // A delta can be cut anywhere, including mid-JSON. Losing the remainder
    // would silently drop words out of the answer.
    const encoder = new TextEncoder();
    globalThis.fetch = vi.fn(async () => new Response(new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(encoder.encode('{"t":"Gar'));
        ctrl.enqueue(encoder.encode('land"}\n{"t":" it is"}\n{"done"'));
        ctrl.enqueue(encoder.encode(":true}\n"));
        ctrl.close();
      },
    }), { status: 200 })) as any;

    await chat.api.sendChat("q");
    expect(chat.api.state().history[1].content).toBe("Garland it is");
  });

  it("renders thinking as progress and never stores it", async () => {
    globalThis.fetch = vi.fn(async () => ndjson([
      { k: "Weighing projected games" },
      { t: "Take Garland." },
      { done: true },
    ])) as any;

    await chat.api.sendChat("q");

    const s = chat.api.state();
    expect(s.history[1].content).toBe("Take Garland.");
    expect(JSON.stringify(s.history)).not.toContain("Weighing projected games");
  });
});

describe("chat client: the partial answer", () => {
  it("keeps a cut-short answer and labels it", async () => {
    globalThis.fetch = vi.fn(async () => ndjson([
      { t: "Garland is the " }, { error: "cut short" },
    ])) as any;

    await chat.api.sendChat("q");

    const s = chat.api.state();
    expect(s.history[1].content).toBe("Garland is the \n\n(answer was cut short)");
    // A partial answer is not an error state, but it is worth retrying.
    expect(s.error).toBe("");
    expect(s.canRetry).toBe(true);
  });

  it("treats a cut-short with no text at all as a timeout, not an empty reply", async () => {
    globalThis.fetch = vi.fn(async () => ndjson([{ error: "cut short" }])) as any;

    await chat.api.sendChat("q");

    const s = chat.api.state();
    expect(s.history.length).toBe(1); // the user turn only
    expect(s.error).toContain("Tap retry");
    expect(s.canRetry).toBe(true);
  });
});

describe("chat client: error text never enters the history", () => {
  it("keeps an in-stream error out of the history", async () => {
    globalThis.fetch = vi.fn(async () => ndjson([
      { error: "Chat is unavailable right now." },
    ])) as any;

    await chat.api.sendChat("q");

    const s = chat.api.state();
    expect(s.history).toEqual([{ role: "user", content: "q" }]);
    expect(JSON.stringify(s.history)).not.toContain("unavailable");
    expect(s.error).toBe("Chat is unavailable right now.");
  });

  it("keeps a 504 out of the history and offers a retry", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: "Larry took too long on that one. Tap retry." }),
      { status: 504, headers: { "Content-Type": "application/json" } },
    )) as any;

    await chat.api.sendChat("q");

    const s = chat.api.state();
    expect(s.history).toEqual([{ role: "user", content: "q" }]);
    expect(s.error).toBe("Larry took too long on that one. Tap retry.");
    expect(s.canRetry).toBe(true);
    expect(chat.api.chatMessagesHtml()).toContain("retryChat()");
  });

  it("does not offer a retry on a request we know is bad", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: "Request too large" }),
      { status: 413, headers: { "Content-Type": "application/json" } },
    )) as any;

    await chat.api.sendChat("q");

    const s = chat.api.state();
    expect(s.canRetry).toBe(false);
    expect(chat.api.chatMessagesHtml()).not.toContain("retryChat()");
  });

  it("partial text already rendered is still discarded if the stream then errors", async () => {
    // Half an answer followed by a real failure is not a cut-short: there
    // is no telling whether what arrived is usable, so it is not stored.
    globalThis.fetch = vi.fn(async () => ndjson([
      { t: "Garland is" }, { error: "Chat is unavailable right now." },
    ])) as any;

    await chat.api.sendChat("q");
    expect(chat.api.state().history.length).toBe(1);
  });
});

describe("chat client: retry", () => {
  it("resends the question without duplicating the user turn", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: "Larry took too long on that one. Tap retry." }),
      { status: 504, headers: { "Content-Type": "application/json" } },
    )) as any;
    await chat.api.sendChat("Who should I trade for?");
    expect(chat.api.state().history.length).toBe(1);

    globalThis.fetch = vi.fn(async () => ndjson([{ t: "Garland." }, { done: true }])) as any;
    await chat.api.retryChat();

    const s = chat.api.state();
    expect(s.history).toEqual([
      { role: "user", content: "Who should I trade for?" },
      { role: "assistant", content: "Garland." },
    ]);
    expect(s.error).toBe("");
  });

  it("does nothing when the last turn is not a question", async () => {
    globalThis.fetch = vi.fn(async () => ndjson([{ t: "a" }, { done: true }])) as any;
    await chat.api.sendChat("q");
    const before = chat.api.state().history.length;

    const spy = vi.fn();
    globalThis.fetch = spy as any;
    await chat.api.retryChat();

    expect(spy).not.toHaveBeenCalled();
    expect(chat.api.state().history.length).toBe(before);
  });

  it("sends the whole history, so the retry has the same context", async () => {
    const bodies: any[] = [];
    globalThis.fetch = vi.fn(async (_u: any, init: any) => {
      bodies.push(JSON.parse(init.body));
      return ndjson([{ t: "ok" }, { done: true }]);
    }) as any;

    await chat.api.sendChat("first");
    await chat.api.sendChat("second");

    expect(bodies[1].messages).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "second" },
    ]);
    // Still no client-supplied system prompt.
    expect(bodies[1].system).toBeUndefined();
  });
});
