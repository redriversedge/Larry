// Types for daily-cap.mjs, so recommend-explain.ts can import it under
// tsc --strict.
export declare const DAILY_CAPS: Record<string, number>;
export declare const DAILY_CAP_MESSAGE: string;
export declare function centralDay(now?: Date): string;
export declare function hashIp(ip: string): string;
export interface DailyCapStore {
  get(key: string, opts: { type: "json" }): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<unknown>;
}
export declare function checkDailyCap(
  fn: string,
  ip: string,
  opts?: { store?: DailyCapStore; now?: Date },
): Promise<{ limited: boolean; count: number; cap: number; skipped?: boolean }>;
