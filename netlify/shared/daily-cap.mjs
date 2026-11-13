// netlify/shared/daily-cap.mjs
//
// Daily request caps for the functions that spend Anthropic credit, kept in
// Netlify Blobs so they survive cold starts. The per-minute buckets in each
// function live in memory and reset whenever a container is recycled, which
// makes them a speed bump against a loop and nothing more. This is the
// ceiling that holds for the whole day.
//
// Counted per caller IP and per function, by Central-time calendar day. The
// IP is hashed before it is used as a key, so the store never holds a raw
// address.
//
// Fails OPEN. If Blobs cannot be reached (local dev, vitest, a Netlify
// outage) the request goes through and a warning is logged. A broken counter
// must never lock the league out of Larry; the hard backstop for cost is the
// monthly spend limit on the Anthropic key itself.
//
// Not atomic: two requests landing in the same instant can both read the
// same count. At three users that is a rounding error, not a hole.

import { createHash } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const STORE_NAME = 'larry-daily-caps';
const warned = {};

// Requests per IP per day. A chat question costs one request plus one per
// lookup Larry makes while answering (up to 5), and a Move costs one plus up
// to 3, so these are sized in requests, not questions.
export const DAILY_CAPS = {
  'larry-chat': 600,
  'larry-move': 120,
  'larry-plan': 30,
  'recommend-explain': 100,
};

// Override any cap without a deploy, e.g. LARRY_DAILY_CAP_LARRY_CHAT=300.
function capFor(fn) {
  const envName = 'LARRY_DAILY_CAP_' + fn.toUpperCase().replace(/-/g, '_');
  const fromEnv = Number(process.env[envName]);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  return DAILY_CAPS[fn] || 0;
}

// YYYY-MM-DD in Central time, the league's clock.
export function centralDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function hashIp(ip) {
  return createHash('sha256').update('larry:' + String(ip || 'unknown')).digest('hex').slice(0, 24);
}

function defaultStore() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

// Resolves { limited, count, cap }. `store` is injectable for tests.
export async function checkDailyCap(fn, ip, { store, now } = {}) {
  const cap = capFor(fn);
  if (!cap) return { limited: false, count: 0, cap: 0 };
  try {
    const s = store || defaultStore();
    const key = fn + '/' + centralDay(now) + '/' + hashIp(ip);
    const current = (await s.get(key, { type: 'json' })) || { count: 0 };
    const count = Number(current.count) || 0;
    if (count >= cap) return { limited: true, count, cap };
    await s.setJSON(key, { count: count + 1 });
    return { limited: false, count: count + 1, cap };
  } catch (err) {
    // Once per function per container, so an outage does not flood the log.
    if (!warned[fn]) {
      warned[fn] = true;
      console.warn('[daily-cap] skipped for ' + fn + ': ' + (err && err.message ? err.message : err));
    }
    return { limited: false, count: 0, cap, skipped: true };
  }
}

export const DAILY_CAP_MESSAGE = 'Larry has hit his daily limit for this device. It resets at midnight Central.';
