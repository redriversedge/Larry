// IIFE entry for the cookies bundle. esbuild emits this as
// dist/larry-cookies.js with --global-name=LarryCookies, so the link
// handler page can call window.LarryCookies.parseLinkToken(location.hash).

export { parseLinkToken, DEFAULT_MAX_AGE_MS, MIN_S2_LENGTH, SWID_RE } from './parseToken.js';
export type { ParseResult, ParseOk, ParseErr, ParseOptions } from './parseToken.js';
