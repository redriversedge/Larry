"use strict";
var LarryCookies = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/cookies/index.ts
  var index_exports = {};
  __export(index_exports, {
    DEFAULT_MAX_AGE_MS: () => DEFAULT_MAX_AGE_MS,
    MIN_S2_LENGTH: () => MIN_S2_LENGTH,
    SWID_RE: () => SWID_RE,
    parseLinkToken: () => parseLinkToken
  });

  // src/cookies/parseToken.ts
  var DEFAULT_MAX_AGE_MS = 5 * 60 * 1e3;
  var MIN_S2_LENGTH = 100;
  var SWID_RE = /^\{?[A-Fa-f0-9-]+\}?$/;
  function parseLinkToken(fragment, options = {}) {
    if (typeof fragment !== "string" || fragment.length === 0) {
      return { ok: false, error: "Missing token. Open the bookmarklet on fantasy.espn.com." };
    }
    const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
    if (!raw) {
      return { ok: false, error: "Empty fragment." };
    }
    let token;
    try {
      token = new URLSearchParams(raw).get("token");
    } catch {
      token = null;
    }
    if (!token) {
      return { ok: false, error: "Token missing from URL fragment." };
    }
    let json;
    try {
      json = atob(token);
    } catch {
      return { ok: false, error: "Token base64 decode failed." };
    }
    let payload;
    try {
      payload = JSON.parse(json);
    } catch {
      return { ok: false, error: "Token JSON parse failed." };
    }
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "Token payload is not an object." };
    }
    const obj = payload;
    const s2 = typeof obj.s2 === "string" ? obj.s2 : "";
    const swid = typeof obj.swid === "string" ? obj.swid : "";
    const ts = typeof obj.ts === "number" ? obj.ts : NaN;
    if (!s2) return { ok: false, error: "Token is missing espn_s2." };
    if (!swid) return { ok: false, error: "Token is missing SWID." };
    if (!Number.isFinite(ts)) return { ok: false, error: "Token timestamp invalid." };
    if (s2.length < MIN_S2_LENGTH) {
      return { ok: false, error: "espn_s2 looks too short. ESPN s2 cookies are typically 200+ characters." };
    }
    if (!SWID_RE.test(swid)) {
      return { ok: false, error: "SWID format invalid." };
    }
    const now = options.now ?? Date.now();
    const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    if (now - ts > maxAge) {
      return { ok: false, error: "Token expired. Tap the bookmarklet on fantasy.espn.com again." };
    }
    if (ts - now > 6e4) {
      return { ok: false, error: "Token timestamp is in the future. Check the device clock." };
    }
    return { ok: true, s2, swid, ts };
  }
  return __toCommonJS(index_exports);
})();
//# sourceMappingURL=larry-cookies.js.map
