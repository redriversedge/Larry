// The daily caps that survive cold starts (netlify/shared/daily-cap.mjs).
// The store is injected, so nothing here touches Netlify Blobs.

import { afterEach, describe, expect, it } from "vitest";
import { checkDailyCap, centralDay, hashIp, DAILY_CAPS } from "../../netlify/shared/daily-cap.mjs";

function memoryStore() {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key: string) { return data.has(key) ? data.get(key) : null; },
    async setJSON(key: string, value: unknown) { data.set(key, value); return {}; },
  };
}

afterEach(() => {
  delete process.env.LARRY_DAILY_CAP_LARRY_PLAN;
});

describe("checkDailyCap", () => {
  it("lets requests through up to the cap, then refuses", async () => {
    const store = memoryStore();
    const cap = DAILY_CAPS["larry-plan"]!;
    for (let i = 0; i < cap; i++) {
      expect((await checkDailyCap("larry-plan", "203.0.113.5", { store })).limited).toBe(false);
    }
    const over = await checkDailyCap("larry-plan", "203.0.113.5", { store });
    expect(over.limited).toBe(true);
    expect(over.count).toBe(cap);
  });

  it("counts each IP and each function separately", async () => {
    const store = memoryStore();
    process.env.LARRY_DAILY_CAP_LARRY_PLAN = "1";
    expect((await checkDailyCap("larry-plan", "a", { store })).limited).toBe(false);
    expect((await checkDailyCap("larry-plan", "a", { store })).limited).toBe(true);
    expect((await checkDailyCap("larry-plan", "b", { store })).limited).toBe(false);
    expect((await checkDailyCap("larry-chat", "a", { store })).limited).toBe(false);
  });

  it("resets on a new Central-time day", async () => {
    const store = memoryStore();
    process.env.LARRY_DAILY_CAP_LARRY_PLAN = "1";
    const lateNight = new Date("2026-11-13T05:30:00Z"); // 11:30 PM Central, Nov 12
    const nextMorning = new Date("2026-11-13T07:00:00Z"); // 1:00 AM Central, Nov 13
    expect(centralDay(lateNight)).toBe("2026-11-12");
    expect(centralDay(nextMorning)).toBe("2026-11-13");
    await checkDailyCap("larry-plan", "a", { store, now: lateNight });
    expect((await checkDailyCap("larry-plan", "a", { store, now: lateNight })).limited).toBe(true);
    expect((await checkDailyCap("larry-plan", "a", { store, now: nextMorning })).limited).toBe(false);
  });

  it("never stores a raw IP", async () => {
    const store = memoryStore();
    await checkDailyCap("larry-chat", "198.51.100.7", { store });
    const keys = [...store.data.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain("198.51.100.7");
    expect(keys[0]).toContain(hashIp("198.51.100.7"));
  });

  it("fails open when the store is unreachable", async () => {
    const broken = {
      async get() { throw new Error("blobs down"); },
      async setJSON() { throw new Error("blobs down"); },
    };
    const res = await checkDailyCap("larry-chat", "a", { store: broken });
    expect(res.limited).toBe(false);
    expect(res.skipped).toBe(true);
  });
});
