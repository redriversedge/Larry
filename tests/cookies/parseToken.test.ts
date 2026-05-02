import { describe, expect, it } from 'vitest';
import { parseLinkToken, DEFAULT_MAX_AGE_MS } from '../../src/cookies/parseToken.js';

const VALID_S2 = 'A'.repeat(220);
const VALID_SWID = '{12345678-1234-1234-1234-123456789012}';

function makeFragment(payload: unknown): string {
  const json = JSON.stringify(payload);
  // btoa is polyfilled by Node 16+; vitest uses a node env, so it is available.
  const b64 = Buffer.from(json, 'utf-8').toString('base64');
  return '#token=' + encodeURIComponent(b64);
}

describe('parseLinkToken', () => {
  it('accepts a valid fresh token', () => {
    const now = 1_700_000_000_000;
    const fragment = makeFragment({ s2: VALID_S2, swid: VALID_SWID, ts: now - 5_000 });
    const result = parseLinkToken(fragment, { now });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.s2).toBe(VALID_S2);
      expect(result.swid).toBe(VALID_SWID);
      expect(result.ts).toBe(now - 5_000);
    }
  });

  it('rejects a token whose timestamp is older than 5 minutes', () => {
    const now = 1_700_000_000_000;
    const fragment = makeFragment({
      s2: VALID_S2,
      swid: VALID_SWID,
      ts: now - DEFAULT_MAX_AGE_MS - 1,
    });
    const result = parseLinkToken(fragment, { now });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/expired/i);
  });

  it('rejects a token whose timestamp is far in the future', () => {
    const now = 1_700_000_000_000;
    const fragment = makeFragment({
      s2: VALID_S2,
      swid: VALID_SWID,
      ts: now + 5 * 60_000,
    });
    const result = parseLinkToken(fragment, { now });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/future/i);
  });

  it('rejects a token missing s2', () => {
    const now = 1_700_000_000_000;
    const fragment = makeFragment({ swid: VALID_SWID, ts: now });
    const result = parseLinkToken(fragment, { now });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/espn_s2/i);
  });

  it('rejects a token missing swid', () => {
    const now = 1_700_000_000_000;
    const fragment = makeFragment({ s2: VALID_S2, ts: now });
    const result = parseLinkToken(fragment, { now });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/swid/i);
  });

  it('rejects a token where s2 is suspiciously short', () => {
    const now = 1_700_000_000_000;
    const shortS2 = 'A'.repeat(40);
    const fragment = makeFragment({ s2: shortS2, swid: VALID_SWID, ts: now });
    const result = parseLinkToken(fragment, { now });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/short/i);
  });

  it('rejects a token where SWID is malformed', () => {
    const now = 1_700_000_000_000;
    const fragment = makeFragment({ s2: VALID_S2, swid: 'not-a-uuid!!!', ts: now });
    const result = parseLinkToken(fragment, { now });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/swid/i);
  });

  it('rejects malformed JSON inside the base64 payload', () => {
    const broken = Buffer.from('{not json', 'utf-8').toString('base64');
    const fragment = '#token=' + encodeURIComponent(broken);
    const result = parseLinkToken(fragment);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/json/i);
  });

  it('rejects malformed base64', () => {
    // '@@@' is not legal base64 in any common decoder
    const fragment = '#token=' + encodeURIComponent('@@@not_base64@@@');
    const result = parseLinkToken(fragment);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/base64|json/i);
  });

  it('rejects an empty fragment', () => {
    const result = parseLinkToken('');
    expect(result.ok).toBe(false);
  });

  it('rejects a fragment with no token parameter', () => {
    const result = parseLinkToken('#foo=bar');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/token missing/i);
  });

  it('rejects a token whose payload is not an object', () => {
    const broken = Buffer.from('"just a string"', 'utf-8').toString('base64');
    const fragment = '#token=' + encodeURIComponent(broken);
    const result = parseLinkToken(fragment);
    expect(result.ok).toBe(false);
  });

  it('uses a custom maxAgeMs option', () => {
    const now = 1_700_000_000_000;
    const fragment = makeFragment({ s2: VALID_S2, swid: VALID_SWID, ts: now - 30_000 });
    // 10 second window: token is older than that
    const result = parseLinkToken(fragment, { now, maxAgeMs: 10_000 });
    expect(result.ok).toBe(false);
  });

  it('accepts SWID with surrounding braces preserved', () => {
    const now = 1_700_000_000_000;
    const swid = '{ABCDEFAB-1234-5678-9ABC-DEF012345678}';
    const fragment = makeFragment({ s2: VALID_S2, swid, ts: now });
    const result = parseLinkToken(fragment, { now });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.swid).toBe(swid);
  });

  it('accepts a fragment without leading hash', () => {
    const now = 1_700_000_000_000;
    const fragmentNoHash = makeFragment({ s2: VALID_S2, swid: VALID_SWID, ts: now }).slice(1);
    const result = parseLinkToken(fragmentNoHash, { now });
    expect(result.ok).toBe(true);
  });
});
