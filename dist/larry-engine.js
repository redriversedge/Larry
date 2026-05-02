"use strict";
var LarryEngine = (() => {
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

  // src/engine/index.ts
  var index_exports = {};
  __export(index_exports, {
    CATEGORIES: () => CATEGORIES,
    buildExplainPayload: () => buildExplainPayload,
    buildQPool: () => buildQPool,
    computeLeagueAverages: () => computeLeagueAverages,
    createEspnProjectionSource: () => createEspnProjectionSource,
    createInMemoryProjectionSource: () => createInMemoryProjectionSource,
    gScore: () => gScore,
    gVector: () => gVector,
    recommend: () => recommend,
    rosterTotal: () => rosterTotal,
    sumVector: () => sumVector,
    teamNeedVector: () => teamNeedVector,
    toPlayerProjection: () => toPlayerProjection,
    topN: () => topN,
    zVector: () => zVector
  });

  // src/shared/types.ts
  var CATEGORIES = ["REB", "AST", "STL", "BLK", "PTS"];

  // src/engine/constants.ts
  var Q_POOL_MULTIPLIER = 12;
  var Q_POOL_ITERATIONS = 2;
  var G_SCORE_KAPPA = 1;
  var ALPHA_IN_SEASON = 0.3;
  var ALPHA_DRAFT = 0.6;
  var POSITION_PENALTY = 0.5;
  var STDEV_FLOOR = 1e-6;
  var PROXY_WEEK_VARIANCE = {
    REB: 0.08,
    AST: 0.1,
    STL: 0.18,
    BLK: 0.2,
    PTS: 0.06
  };
  var EXPLAIN_TOP_N = 5;
  function projectionConfidence(gamesRemaining) {
    if (gamesRemaining <= 0) return 0;
    if (gamesRemaining >= 30) return 1;
    return Math.max(0.2, gamesRemaining / 30);
  }
  var ESPN_STAT_ID_TO_CATEGORY = {
    0: "PTS",
    1: "BLK",
    2: "STL",
    3: "AST",
    6: "REB"
  };
  var ESPN_POSITION_ID_TO_NAME = {
    1: "PG",
    2: "SG",
    3: "SF",
    4: "PF",
    5: "C"
  };

  // src/engine/zscore.ts
  function emptyVector() {
    return { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
  }
  function meanStdev(values) {
    if (values.length === 0) return { mean: 0, stdev: STDEV_FLOOR };
    let sum = 0;
    for (const v of values) sum += v;
    const mean = sum / values.length;
    let sqSum = 0;
    for (const v of values) {
      const d = v - mean;
      sqSum += d * d;
    }
    const variance = values.length > 1 ? sqSum / (values.length - 1) : 0;
    const stdev = Math.max(Math.sqrt(variance), STDEV_FLOOR);
    return { mean, stdev };
  }
  function statsFromPlayers(players) {
    const stats = {
      mean: emptyVector(),
      stdev: emptyVector(),
      poolSize: players.length
    };
    for (const c of CATEGORIES) {
      const values = players.map((p) => p.perGame[c]);
      const { mean, stdev } = meanStdev(values);
      stats.mean[c] = mean;
      stats.stdev[c] = stdev;
    }
    return stats;
  }
  function zVector(player, stats) {
    const z = emptyVector();
    for (const c of CATEGORIES) {
      z[c] = (player.perGame[c] - stats.mean[c]) / stats.stdev[c];
    }
    return z;
  }
  function sumVector(v) {
    let s = 0;
    for (const c of CATEGORIES) s += v[c];
    return s;
  }
  function buildQPool(pool, rosterSize) {
    if (pool.length === 0) {
      return { stats: { mean: emptyVector(), stdev: emptyVector(), poolSize: 0 }, players: [] };
    }
    const targetSize = Math.min(pool.length, rosterSize * Q_POOL_MULTIPLIER);
    let stats = statsFromPlayers(pool);
    let current = pool;
    for (let i = 0; i < Q_POOL_ITERATIONS; i++) {
      const ranked = [...pool].map((p) => ({ p, score: sumVector(zVector(p, stats)) })).sort((a, b) => b.score - a.score).slice(0, targetSize).map((x) => x.p);
      current = ranked;
      stats = statsFromPlayers(ranked);
    }
    return { stats, players: current };
  }
  function gVector(player, stats) {
    const g = emptyVector();
    for (const c of CATEGORIES) {
      const poolVar = stats.stdev[c] * stats.stdev[c];
      const weekVar = PROXY_WEEK_VARIANCE[c] * stats.stdev[c] * PROXY_WEEK_VARIANCE[c] * stats.stdev[c];
      const denom = Math.sqrt(poolVar + G_SCORE_KAPPA * weekVar);
      g[c] = (player.perGame[c] - stats.mean[c]) / Math.max(denom, STDEV_FLOOR);
    }
    return g;
  }
  function gScore(player, stats) {
    return sumVector(gVector(player, stats));
  }

  // src/engine/teamFit.ts
  function emptyVector2() {
    return { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
  }
  function rosterTotal(players) {
    const total = emptyVector2();
    for (const p of players) {
      for (const c of CATEGORIES) {
        total[c] += p.perGame[c];
      }
    }
    return total;
  }
  function computeLeagueAverages(roster) {
    const teamIds = Object.keys(roster.leaguePlayers);
    const teamTotals = teamIds.map((id) => rosterTotal(roster.leaguePlayers[id] ?? []));
    const meanPerTeam = emptyVector2();
    const stdevPerTeam = emptyVector2();
    if (teamTotals.length === 0) {
      return { meanPerTeam, stdevPerTeam, teamCount: 0 };
    }
    for (const c of CATEGORIES) {
      const values = teamTotals.map((t) => t[c]);
      let sum = 0;
      for (const v of values) sum += v;
      const mean = sum / values.length;
      let sqSum = 0;
      for (const v of values) {
        const d = v - mean;
        sqSum += d * d;
      }
      const variance = values.length > 1 ? sqSum / (values.length - 1) : 0;
      meanPerTeam[c] = mean;
      stdevPerTeam[c] = Math.max(Math.sqrt(variance), STDEV_FLOOR);
    }
    return { meanPerTeam, stdevPerTeam, teamCount: teamTotals.length };
  }
  function teamNeedVector(roster, leagueAvg) {
    const need = emptyVector2();
    const myTotal = rosterTotal(roster.myPlayers);
    for (const c of CATEGORIES) {
      need[c] = (leagueAvg.meanPerTeam[c] - myTotal[c]) / leagueAvg.stdevPerTeam[c];
    }
    return need;
  }
  function fitBonus(player, need, poolStats) {
    const z = zVector(player, poolStats);
    let dot = 0;
    for (const c of CATEGORIES) dot += need[c] * z[c];
    return dot;
  }
  function alphaFor(mode) {
    return mode === "draft" ? ALPHA_DRAFT : ALPHA_IN_SEASON;
  }

  // src/engine/recommend.ts
  var INJURED_STATUSES = /* @__PURE__ */ new Set(["OUT", "SUSPENSION", "INJURY_RESERVE", "IR"]);
  function isInjured(p) {
    return INJURED_STATUSES.has(p.injuryStatus);
  }
  var POSITION_QUOTA = {
    PG: 3,
    SG: 3,
    SF: 3,
    PF: 3,
    C: 2
  };
  function positionPenalty(player, myPlayers) {
    if (player.positions.length === 0) return 0;
    const counts = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
    for (const r of myPlayers) {
      for (const pos of r.positions) {
        counts[pos] += 1;
      }
    }
    let allFilled = true;
    for (const pos of player.positions) {
      if (counts[pos] < POSITION_QUOTA[pos]) {
        allFilled = false;
        break;
      }
    }
    return allFilled ? POSITION_PENALTY : 0;
  }
  function whyForPlayer(z, need, posPenalty) {
    const why = [];
    const contributions = CATEGORIES.map((c) => ({
      cat: c,
      contribution: need[c] * z[c],
      z: z[c],
      need: need[c]
    })).sort((a, b) => b.contribution - a.contribution);
    const positives = contributions.filter((x) => x.contribution > 0.1).slice(0, 2);
    for (const p of positives) {
      why.push(
        `Strong in ${p.cat} (z=${p.z.toFixed(2)}); your roster is ${p.need.toFixed(2)} stdev below league average there.`
      );
    }
    if (positives.length === 0) {
      const strongest = CATEGORIES.map((c) => ({ cat: c, z: z[c] })).sort((a, b) => b.z - a.z).slice(0, 2);
      for (const s of strongest) {
        if (s.z > 0.5) why.push(`Above pool average in ${s.cat} (z=${s.z.toFixed(2)}).`);
      }
    }
    const drags = contributions.filter((x) => x.z < -0.5).slice(0, 1);
    for (const d of drags) {
      why.push(`Below pool average in ${d.cat} (z=${d.z.toFixed(2)}).`);
    }
    if (posPenalty > 0) {
      why.push("Position group already deep on your roster.");
    }
    return why;
  }
  function buildBreakdown(player, poolStats, need, alpha, myPlayers) {
    const z = zVector(player, poolStats);
    const g = gVector(player, poolStats);
    const gScoreVal = sumVector(g);
    const fit = fitBonus(player, need, poolStats);
    const posPen = positionPenalty(player, myPlayers);
    const final = gScoreVal + alpha * fit - posPen;
    const why = whyForPlayer(z, need, posPen);
    return {
      gScore: gScoreVal,
      alpha,
      fitBonus: fit,
      positionPenalty: posPen,
      final,
      why,
      categoryDeltas: z,
      projection: player.perGame,
      confidence: projectionConfidence(player.gamesRemaining)
    };
  }
  function eligibleCandidates(candidates, roster) {
    const onMyRoster = new Set(roster.myPlayers.map((p) => p.id));
    return candidates.filter((p) => !onMyRoster.has(p.id) && !isInjured(p));
  }
  function recommend(ctx) {
    const candidates = eligibleCandidates(ctx.projectionSource.getFreeAgents(), ctx.roster);
    const rosterSize = Math.max(ctx.roster.myPlayers.length, 1);
    const referencePool = [...candidates, ...ctx.roster.myPlayers].filter((p) => !isInjured(p));
    const { stats: poolStats, players: qPool } = buildQPool(referencePool, rosterSize);
    const leagueAvg = computeLeagueAverages(ctx.roster);
    const need = teamNeedVector(ctx.roster, leagueAvg);
    const alpha = alphaFor(ctx.mode);
    const ranked = candidates.map((player) => ({
      player,
      breakdown: buildBreakdown(player, poolStats, need, alpha, ctx.roster.myPlayers)
    })).sort((a, b) => b.breakdown.final - a.breakdown.final);
    const meta = {
      qPoolSize: qPool.length,
      leagueSize: ctx.league.size,
      alphaUsed: alpha,
      poolStdev: poolStats.stdev,
      poolMean: poolStats.mean,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      engineVersion: "v2.0.0"
    };
    return { ranked, teamNeeds: need, meta };
  }
  function topN(output, n = EXPLAIN_TOP_N) {
    return output.ranked.slice(0, n);
  }

  // src/engine/explain.ts
  function buildExplainPayload(topPlayers, teamNeeds) {
    let needMaxCat = "REB";
    let needMaxVal = -Infinity;
    let surplusMaxCat = "REB";
    let surplusMaxVal = Infinity;
    for (const c of CATEGORIES) {
      const v = teamNeeds[c];
      if (v > needMaxVal) {
        needMaxVal = v;
        needMaxCat = c;
      }
      if (v < surplusMaxVal) {
        surplusMaxVal = v;
        surplusMaxCat = c;
      }
    }
    return {
      topPlayers: topPlayers.map((rp) => ({
        id: rp.player.id,
        name: rp.player.name,
        team: rp.player.team,
        positions: rp.player.positions,
        projection: rp.breakdown.projection,
        z: rp.breakdown.categoryDeltas,
        final: rp.breakdown.final,
        fitBonus: rp.breakdown.fitBonus,
        why: rp.breakdown.why
      })),
      teamNeeds,
      biggestNeed: { category: needMaxCat, magnitude: needMaxVal },
      biggestSurplus: { category: surplusMaxCat, magnitude: surplusMaxVal }
    };
  }

  // src/engine/projectionSource.ts
  var FALLBACK_GAMES_REMAINING = 20;
  function normalizeInjuryStatus(s) {
    if (!s) return "ACTIVE";
    const upper = s.toUpperCase();
    switch (upper) {
      case "ACTIVE":
      case "DAY_TO_DAY":
      case "OUT":
      case "SUSPENSION":
      case "INJURY_RESERVE":
      case "IR":
      case "QUESTIONABLE":
      case "PROBABLE":
      case "DOUBTFUL":
        return upper;
      default:
        return "UNKNOWN";
    }
  }
  function decodePositions(defaultId, eligibleIds) {
    const out = /* @__PURE__ */ new Set();
    if (defaultId !== void 0) {
      const name = ESPN_POSITION_ID_TO_NAME[defaultId];
      if (name) out.add(name);
    }
    if (eligibleIds) {
      for (const pid of eligibleIds) {
        const name = ESPN_POSITION_ID_TO_NAME[pid];
        if (name) out.add(name);
      }
    }
    return Array.from(out);
  }
  function decodePerGame(perGame) {
    const out = { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
    if (!perGame) return out;
    for (const key of Object.keys(perGame)) {
      const numericKey = Number(key);
      const cat = ESPN_STAT_ID_TO_CATEGORY[numericKey];
      if (cat) {
        out[cat] = perGame[key] ?? 0;
      }
    }
    return out;
  }
  function toPlayerProjection(raw, defaultGamesRemaining) {
    return {
      id: String(raw.id),
      name: raw.fullName ?? `Player ${raw.id}`,
      team: raw.proTeamAbbreviation ?? "",
      positions: decodePositions(raw.defaultPositionId, raw.eligiblePositionIds),
      gamesRemaining: raw.gamesRemaining ?? defaultGamesRemaining,
      perGame: decodePerGame(raw.perGame),
      injuryStatus: normalizeInjuryStatus(raw.injuryStatus)
    };
  }
  function createInMemoryProjectionSource(freeAgents, onRoster = []) {
    const byId = /* @__PURE__ */ new Map();
    for (const p of freeAgents) byId.set(p.id, p);
    for (const p of onRoster) byId.set(p.id, p);
    return {
      getFreeAgents() {
        return freeAgents;
      },
      getById(id) {
        return byId.get(id);
      }
    };
  }
  function createEspnProjectionSource(inputs, options = {}) {
    const defaultGames = inputs.defaultGamesRemaining ?? FALLBACK_GAMES_REMAINING;
    const all = inputs.players.map((p) => toPlayerProjection(p, defaultGames));
    const byId = /* @__PURE__ */ new Map();
    for (let i = 0; i < all.length; i++) {
      const proj = all[i];
      const raw = inputs.players[i];
      if (!proj || !raw) continue;
      byId.set(proj.id, proj);
    }
    const filterFreeAgents = options.filterFreeAgents ?? true;
    const freeAgents = all.filter((p, i) => {
      if (!filterFreeAgents) return true;
      return inputs.players[i]?.isFreeAgent === true;
    });
    return {
      getFreeAgents() {
        return freeAgents;
      },
      getById(id) {
        return byId.get(id);
      }
    };
  }
  return __toCommonJS(index_exports);
})();
//# sourceMappingURL=larry-engine.js.map
