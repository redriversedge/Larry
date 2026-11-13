// Chat's cap on how much tool output one question sends to Claude.

import { describe, expect, it } from "vitest";
// @ts-expect-error -- .mjs has no type declarations
import { trimToolResults } from "../../netlify/shared/app-tools.mjs";

function turn(id: string, size: number) {
  return {
    assistant: [{ type: "thinking", thinking: "t", signature: "sig-" + id }, { type: "tool_use", id, name: "x", input: {} }],
    results: [{ type: "tool_result", tool_use_id: id, content: "x".repeat(size) }],
  };
}

const total = (turns: any[]) => turns.reduce((n, t) => n + t.results.reduce((m: number, r: any) => m + r.content.length, 0), 0);

describe("trimToolResults", () => {
  it("leaves a request under budget untouched", () => {
    const turns = [turn("a", 1000), turn("b", 1000)];
    expect(total(trimToolResults(turns, 5000))).toBe(2000);
  });

  it("trims the oldest rounds first and keeps the newest whole", () => {
    const turns = trimToolResults([turn("a", 30000), turn("b", 30000), turn("c", 30000)], 64000);
    expect(turns[2].results[0].content.length).toBe(30000);
    expect(turns[0].results[0].content).toMatch(/trimmed to fit\)$/);
    expect(total(turns)).toBeLessThanOrEqual(64000 + 40);
  });

  it("never touches the assistant blocks, whose thinking signatures must round-trip", () => {
    const turns = trimToolResults([turn("a", 90000), turn("b", 10)], 1000);
    expect(turns[0].assistant[0].signature).toBe("sig-a");
    expect(turns[0].results[0].tool_use_id).toBe("a");
  });

  it("passes null and empty lists through", () => {
    expect(trimToolResults(null, 10)).toBeNull();
    expect(trimToolResults([], 10)).toEqual([]);
  });
});
