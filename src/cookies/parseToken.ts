// Pure token parser for the Larry Link bookmarklet handoff.
//
// The bookmarklet running on fantasy.espn.com base64-encodes
// JSON.stringify({ s2, swid, ts }), URI-encodes that string, and redirects
// to /link#token=<encoded>. This module decodes that fragment and
// validates the contents. All side effects (localStorage, history,
// redirect) live in the link handler page; this stays pure so it can
// be unit-tested in isolation.

export type ParseOk = {
  ok: true;
  s2: string;
  swid: string;
  ts: number;
};

export type ParseErr = {
  ok: false;
  error: string;
};

export type ParseResult = ParseOk | ParseErr;

export type ParseOptions = {
  now?: number;
  maxAgeMs?: number;
};

export const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;
export const MIN_S2_LENGTH = 100;
export const SWID_RE = /^\{?[A-Fa-f0-9-]+\}?$/;

export function parseLinkToken(fragment: string, options: ParseOptions = {}): ParseResult {
  if (typeof fragment !== 'string' || fragment.length === 0) {
    return { ok: false, error: 'Missing token. Open the bookmarklet on fantasy.espn.com.' };
  }

  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (!raw) {
    return { ok: false, error: 'Empty fragment.' };
  }

  let token: string | null;
  try {
    token = new URLSearchParams(raw).get('token');
  } catch {
    token = null;
  }
  if (!token) {
    return { ok: false, error: 'Token missing from URL fragment.' };
  }

  let json: string;
  try {
    json = atob(token);
  } catch {
    return { ok: false, error: 'Token base64 decode failed.' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Token JSON parse failed.' };
  }

  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Token payload is not an object.' };
  }

  const obj = payload as Record<string, unknown>;
  const s2 = typeof obj.s2 === 'string' ? obj.s2 : '';
  const swid = typeof obj.swid === 'string' ? obj.swid : '';
  const ts = typeof obj.ts === 'number' ? obj.ts : NaN;

  if (!s2) return { ok: false, error: 'Token is missing espn_s2.' };
  if (!swid) return { ok: false, error: 'Token is missing SWID.' };
  if (!Number.isFinite(ts)) return { ok: false, error: 'Token timestamp invalid.' };

  if (s2.length < MIN_S2_LENGTH) {
    return { ok: false, error: 'espn_s2 looks too short. ESPN s2 cookies are typically 200+ characters.' };
  }

  if (!SWID_RE.test(swid)) {
    return { ok: false, error: 'SWID format invalid.' };
  }

  const now = options.now ?? Date.now();
  const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (now - ts > maxAge) {
    return { ok: false, error: 'Token expired. Tap the bookmarklet on fantasy.espn.com again.' };
  }
  if (ts - now > 60_000) {
    return { ok: false, error: 'Token timestamp is in the future. Check the device clock.' };
  }

  return { ok: true, s2, swid, ts };
}
