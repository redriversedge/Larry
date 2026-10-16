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
    DEFAULT_MOCK_PARAMS: () => DEFAULT_MOCK_PARAMS,
    DURANT_SCALE: () => DURANT_SCALE,
    FIT_LAMBDA: () => FIT_LAMBDA,
    FIT_MIN_PICKS: () => FIT_MIN_PICKS,
    FIT_WEIGHT_EVEN: () => FIT_WEIGHT_EVEN,
    FIT_WEIGHT_STRONG: () => FIT_WEIGHT_STRONG,
    FIT_WEIGHT_WEAK: () => FIT_WEIGHT_WEAK,
    MOCK_AVAIL_CHUNK: () => MOCK_AVAIL_CHUNK,
    MOCK_AVAIL_SIMS: () => MOCK_AVAIL_SIMS,
    MOCK_AVAIL_SIMS_REDUCED: () => MOCK_AVAIL_SIMS_REDUCED,
    MOCK_AVAIL_TOP_N: () => MOCK_AVAIL_TOP_N,
    MOCK_CAN_WAIT_THRESHOLD: () => MOCK_CAN_WAIT_THRESHOLD,
    MOCK_FITTED: () => MOCK_FITTED,
    MOCK_RANK_FORM: () => MOCK_RANK_FORM,
    MOCK_SCARCE_THRESHOLD: () => MOCK_SCARCE_THRESHOLD,
    MOCK_TOP_PICK_SHARE: () => MOCK_TOP_PICK_SHARE,
    MOCK_TOP_PICK_SIMS: () => MOCK_TOP_PICK_SIMS,
    MOCK_TOP_PICK_WINDOW: () => MOCK_TOP_PICK_WINDOW,
    PRESEASON_GP_REFERENCE: () => PRESEASON_GP_REFERENCE,
    PRESEASON_LONG_TERM_GP: () => PRESEASON_LONG_TERM_GP,
    PRESEASON_SUSPECT_GP: () => PRESEASON_SUSPECT_GP,
    applyHaircut: () => applyHaircut,
    applyPreseasonDiscount: () => applyPreseasonDiscount,
    availabilityTargets: () => availabilityTargets,
    availableIdsFor: () => availableIdsFor,
    bestAvailableByLarry: () => bestAvailableByLarry,
    buildAdpLookup: () => buildAdpLookup,
    buildDraftProfiles: () => buildDraftProfiles,
    buildExplainPayload: () => buildExplainPayload,
    buildHistoricalBoard: () => buildHistoricalBoard,
    buildQPool: () => buildQPool,
    categoryRanks: () => categoryRanks,
    categoryWeight: () => categoryWeight,
    checkModel: () => checkModel,
    clampGames: () => clampGames,
    combineEvals: () => combineEvals,
    computeBaseValues: () => computeBaseValues,
    computeLeagueAverages: () => computeLeagueAverages,
    computeLeagueRates: () => computeLeagueRates,
    createEspnProjectionSource: () => createEspnProjectionSource,
    createInMemoryProjectionSource: () => createInMemoryProjectionSource,
    decidePick: () => decidePick,
    durabilityDetail: () => durabilityDetail,
    emptyAvailabilityCounts: () => emptyAvailabilityCounts,
    espnPerGameRate: () => espnPerGameRate,
    evaluateDraft: () => evaluateDraft,
    expectedGames: () => expectedGames,
    firstAvailableByRank: () => firstAvailableByRank,
    fitBonus: () => fitBonus2,
    fitMockDraft: () => fitMockDraft,
    fitWeights: () => fitWeights,
    gScore: () => gScore,
    gVector: () => gVector,
    larryPickAdvice: () => larryPickAdvice,
    leagueReachMedians: () => leagueReachMedians,
    median: () => median,
    mixSeed: () => mixSeed,
    mulberry32: () => mulberry32,
    myUpcomingPicks: () => myUpcomingPicks,
    nextPickIndex: () => nextPickIndex,
    normName: () => normName,
    overloadFor: () => overloadFor,
    overrideIsActive: () => overrideIsActive,
    per36Rate: () => per36Rate,
    phaseForRound: () => phaseForRound,
    pickUtilities: () => pickUtilities,
    prepareBoard: () => prepareBoard,
    profilesBySeason: () => profilesBySeason,
    projectAll: () => projectAll,
    projectGamesPlayed: () => projectGamesPlayed,
    projectMinutesPerGame: () => projectMinutesPerGame,
    projectPlayer: () => projectPlayer,
    rankOf: () => rankOf,
    rankUtility: () => rankUtility,
    reachShrunk: () => reachShrunk,
    recommend: () => recommend,
    recommendValueAndFit: () => recommendValueAndFit,
    rosterCategoryTotals: () => rosterCategoryTotals,
    rosterTotal: () => rosterTotal,
    roundForIndex: () => roundForIndex,
    runAvailabilitySims: () => runAvailabilitySims,
    simulateUntil: () => simulateUntil,
    snakeOrder: () => snakeOrder,
    softmax: () => softmax,
    sumVector: () => sumVector,
    tauFor: () => tauFor,
    teamNeedVector: () => teamNeedVector,
    toPlayerProjection: () => toPlayerProjection,
    topN: () => topN,
    topPickRate: () => topPickRate,
    weightedHistory: () => weightedHistory,
    zVector: () => zVector
  });

  // src/shared/types.ts
  var CATEGORIES = ["REB", "AST", "STL", "BLK", "PTS"];

  // src/engine/constants.ts
  var Q_POOL_MULTIPLIER = 12;
  var Q_POOL_ITERATIONS = 2;
  var DEFAULT_ROSTER_SIZE = 13;
  var SHRINK_K = 8;
  var Z_CAP = 3;
  var MIN_GP_POOL = 10;
  var FULL_SEASON_GAMES = 82;
  var PRESEASON_LONG_TERM_GP = 60;
  var PRESEASON_GP_REFERENCE = 72;
  var PRESEASON_DISCOUNT_POWER = 0.5;
  var MARCEL_WEIGHTS = [5, 4, 3];
  var MARCEL_REGRESSION_MINUTES = 1e3;
  var MARCEL_LEAGUE_MIN_MINUTES = 500;
  var MARCEL_MPG_GP_FLOOR = 100;
  var MARCEL_MPG_PRIOR = 24;
  var MARCEL_MPG_PRIOR_WEIGHT = 0.25;
  var GP_WEIGHTS = [0.5, 0.3, 0.2];
  var GP_PRIOR = 70;
  var GP_PRIOR_WEIGHT = 0.25;
  var GP_MAX = 82;
  var GP_FALLBACK = 65;
  var PROJECTION_BLEND_ALPHA = 0.2;
  var PRESEASON_SUSPECT_GP = 10;
  var DURANT_SCALE = 10;
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
  var DRAFT_NEIGHBOR_WINDOW = 8;
  var DRAFT_PREMIUM_MAX_ROUND = 10;
  var DRAFT_POSITION_LEAN_MAX_ROUND = 8;
  var DRAFT_POSITION_LEAN_THRESHOLD = 8;
  var DRAFT_AFFINITY_MIN_PICKS = 4;
  var DRAFT_AFFINITY_RATE_MULTIPLE = 2;
  var DRAFT_AFFINITY_TOP_N = 3;
  var DRAFT_SMALL_SAMPLE_DRAFTS = 5;
  var DRAFT_STRENGTH_STRONG_T = 2;
  var DRAFT_STRENGTH_MODERATE_T = 1.2;
  var DRAFT_PREMIUM_MIN_EFFECT = 0.02;
  var DRAFT_PUNT_MAX_POSITIVE_SEASONS = 1;
  var DRAFT_REACH_OFTEN_MEDIAN = 12;
  var DRAFT_REACH_BOARD_MEDIAN = 0;
  var MOCK_FITTED = true;
  var MOCK_RANK_FORM = "log";
  var MOCK_TOP_PICK_WINDOW = 3;
  var MOCK_TOP_PICK_SHARE = 0.95;
  var MOCK_TOP_PICK_SIMS = 500;
  var MOCK_TAU_EARLY = 0.32;
  var MOCK_TAU_MID = 0.31;
  var MOCK_TAU_LATE = 0.84;
  var MOCK_BETA = 0;
  var MOCK_LAMBDA = 0.84;
  var MOCK_GAMMA = 1;
  var MOCK_ALPHA = 0.19;
  var MOCK_REACH_SHRINK_K = 15;
  var MOCK_WEIGHT_STRONG = 1;
  var MOCK_WEIGHT_MODERATE = 0.5;
  var MOCK_OVERLOAD_THRESHOLD = 3;
  var MOCK_RANK_FALLBACK = 400;
  var MOCK_Z_POOL_SIZE = 200;
  var MOCK_POOL_EARLY_ROUNDS = 2;
  var MOCK_CANDIDATE_POOL_EARLY = 24;
  var MOCK_CANDIDATE_POOL_LATE = 40;
  var MOCK_AVAIL_SIMS = 500;
  var MOCK_AVAIL_SIMS_REDUCED = 250;
  var MOCK_AVAIL_CHUNK = 50;
  var MOCK_AVAIL_TOP_N = 40;
  var MOCK_CAN_WAIT_THRESHOLD = 0.7;
  var MOCK_SCARCE_THRESHOLD = 0.5;
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
    const mean3 = sum / values.length;
    let sqSum = 0;
    for (const v of values) {
      const d = v - mean3;
      sqSum += d * d;
    }
    const variance = values.length > 1 ? sqSum / (values.length - 1) : 0;
    const stdev = Math.max(Math.sqrt(variance), STDEV_FLOOR);
    return { mean: mean3, stdev };
  }
  function statsFromPlayers(players, cats = CATEGORIES) {
    const stats = {
      mean: emptyVector(),
      stdev: emptyVector(),
      poolSize: players.length
    };
    for (const c of cats) {
      const values = players.map((p) => p.perGame[c]);
      const { mean: mean3, stdev } = meanStdev(values);
      stats.mean[c] = mean3;
      stats.stdev[c] = stdev;
    }
    return stats;
  }
  function zVector(player, stats, cats = CATEGORIES) {
    const z = emptyVector();
    for (const c of cats) {
      z[c] = (player.perGame[c] - stats.mean[c]) / stats.stdev[c];
    }
    return z;
  }
  function sumVector(v, cats = CATEGORIES) {
    let s = 0;
    for (const c of cats) s += v[c];
    return s;
  }
  function clamp(value, limit) {
    if (value > limit) return limit;
    if (value < -limit) return -limit;
    return value;
  }
  function buildQPool(pool, rosterSize, opts = {}) {
    const cats = opts.categories ?? CATEGORIES;
    const cap = opts.cap;
    if (pool.length === 0) {
      return { stats: { mean: emptyVector(), stdev: emptyVector(), poolSize: 0 }, players: [] };
    }
    const targetSize = Math.min(pool.length, rosterSize * Q_POOL_MULTIPLIER);
    let stats = statsFromPlayers(pool, cats);
    let current = pool;
    for (let i = 0; i < Q_POOL_ITERATIONS; i++) {
      const ranked = [...pool].map((p) => {
        const z = zVector(p, stats, cats);
        if (cap !== void 0) {
          for (const c of cats) z[c] = clamp(z[c], cap);
        }
        return { p, score: sumVector(z, cats) };
      }).sort((a, b) => b.score - a.score).slice(0, targetSize).map((x) => x.p);
      current = ranked;
      stats = statsFromPlayers(ranked, cats);
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
  function num(v) {
    return typeof v === "number" && isFinite(v) ? v : 0;
  }
  function toPerGame(input, cats) {
    const pg = emptyVector();
    const gp = input.gamesPlayed;
    if (input.perGame) {
      for (const c of cats) pg[c] = num(input.perGame[c]);
      return pg;
    }
    if (gp > 0) {
      const totals = input.seasonTotals ?? {};
      for (const c of cats) pg[c] = num(totals[c]) / gp;
      return pg;
    }
    if (input.projectedPerGame) {
      for (const c of cats) pg[c] = num(input.projectedPerGame[c]);
      return pg;
    }
    const projected = input.projectedSeason ?? {};
    for (const c of cats) pg[c] = num(projected[c]) / FULL_SEASON_GAMES;
    return pg;
  }
  function priorPerGame(input, cats) {
    if (input.projectedPerGame) {
      const prior = emptyVector();
      let any = false;
      for (const c of cats) {
        const v = num(input.projectedPerGame[c]);
        prior[c] = v;
        if (v !== 0) any = true;
      }
      return any ? prior : null;
    }
    if (input.projectedSeason) {
      const prior = emptyVector();
      let any = false;
      for (const c of cats) {
        const v = num(input.projectedSeason[c]) / FULL_SEASON_GAMES;
        prior[c] = v;
        if (v !== 0) any = true;
      }
      return any ? prior : null;
    }
    return null;
  }
  function asProjection(id, perGame) {
    return {
      id,
      name: id,
      team: "",
      positions: [],
      gamesRemaining: 0,
      perGame,
      injuryStatus: "UNKNOWN"
    };
  }
  function computeBaseValues(players, opts = {}) {
    const cats = opts.categories && opts.categories.length > 0 ? opts.categories : CATEGORIES;
    const rosterSize = opts.rosterSize && opts.rosterSize > 0 ? opts.rosterSize : DEFAULT_ROSTER_SIZE;
    const prepared = players.map((input) => ({
      input,
      perGame: toPerGame(input, cats),
      // Step 1b. The prior: our best guess at this player's rate BEFORE we
      // have seen them play. The projection when we have one, otherwise null
      // and we fall back to the pool mean.
      //
      // This is what the shrink pulls toward, and it is the whole reason
      // preseason ranking works. Shrinking toward the pool mean meant that at
      // gp = 0, w = 0, every player landed exactly on the mean and scored 0.
      // That is defensible as "no evidence" mid-season, but before opening
      // night EVERY player has 0 games, so the entire board was zeros and the
      // displayed order was just ESPN's ownership ranking. Meanwhile each
      // player's projection was sitting right there unused.
      prior: priorPerGame(input, cats)
    }));
    if (prepared.length === 0) {
      return {
        rows: [],
        stats: { mean: emptyVector(), stdev: emptyVector(), poolSize: 0 },
        poolSize: 0
      };
    }
    const eligible = prepared.filter((r) => r.input.gamesPlayed >= MIN_GP_POOL);
    const usePriorPool = eligible.length === 0;
    const firstPass = usePriorPool ? prepared : eligible;
    const { stats, players: qPool } = buildQPool(
      firstPass.map((r) => asProjection(r.input.id, usePriorPool ? r.prior ?? r.perGame : r.perGame)),
      rosterSize,
      { categories: cats, cap: Z_CAP }
    );
    const rows = prepared.map(({ input, perGame, prior }) => {
      const gp = input.gamesPlayed;
      const w = gp < FULL_SEASON_GAMES ? gp / (gp + SHRINK_K) : 1;
      const shrunk = emptyVector();
      const z = emptyVector();
      let baseValue = 0;
      for (const c of cats) {
        const priorC = prior ? prior[c] : stats.mean[c];
        shrunk[c] = w * perGame[c] + (1 - w) * priorC;
        z[c] = clamp((shrunk[c] - stats.mean[c]) / stats.stdev[c], Z_CAP);
        baseValue += z[c];
      }
      return {
        id: input.id,
        gamesPlayed: gp,
        perGame,
        shrunk,
        z,
        baseValue,
        hasEvidence: gp > 0 || prior !== null
      };
    });
    return { rows, stats, poolSize: qPool.length };
  }
  function applyPreseasonDiscount(baseValue, projectedGP, suspect) {
    if (suspect) return baseValue;
    if (!(projectedGP > 0) || projectedGP >= PRESEASON_LONG_TERM_GP) return baseValue;
    if (baseValue <= 0) return baseValue;
    return baseValue * Math.pow(projectedGP / PRESEASON_GP_REFERENCE, PRESEASON_DISCOUNT_POWER);
  }
  function applyHaircut(baseValue, factor) {
    return baseValue > 0 ? baseValue * factor : baseValue;
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
      const mean3 = sum / values.length;
      let sqSum = 0;
      for (const v of values) {
        const d = v - mean3;
        sqSum += d * d;
      }
      const variance = values.length > 1 ? sqSum / (values.length - 1) : 0;
      meanPerTeam[c] = mean3;
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

  // src/engine/projections.ts
  var MINUTES_BASE = 36;
  function emptyVector3() {
    return { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
  }
  function num2(v) {
    return typeof v === "number" && isFinite(v) ? v : 0;
  }
  function computeLeagueRates(seasonsByPlayer, opts = {}) {
    const cats = opts.categories ?? CATEGORIES;
    const minMinutes = opts.minMinutes ?? MARCEL_LEAGUE_MIN_MINUTES;
    const totals = emptyVector3();
    let minutes = 0;
    for (const seasons of seasonsByPlayer) {
      for (let i = 0; i < seasons.length && i < MARCEL_WEIGHTS.length; i++) {
        const s = seasons[i];
        if (num2(s.MIN) < minMinutes) continue;
        const w = MARCEL_WEIGHTS[i];
        minutes += w * num2(s.MIN);
        for (const c of cats) totals[c] += w * num2(s[c]);
      }
    }
    const perMinute = emptyVector3();
    if (minutes > 0) {
      for (const c of cats) perMinute[c] = totals[c] / minutes;
    }
    return { perMinute };
  }
  function per36Rate(seasons, league, opts = {}) {
    const cats = opts.categories ?? CATEGORIES;
    const R = opts.regressionMinutes ?? MARCEL_REGRESSION_MINUTES;
    const out = emptyVector3();
    let weightedMinutes = 0;
    const weightedStat = emptyVector3();
    for (let i = 0; i < seasons.length && i < MARCEL_WEIGHTS.length; i++) {
      const s = seasons[i];
      const w = MARCEL_WEIGHTS[i];
      weightedMinutes += w * num2(s.MIN);
      for (const c of cats) weightedStat[c] += w * num2(s[c]);
    }
    const denom = weightedMinutes + R;
    if (denom <= 0) return out;
    const ageFactor = opts.ageFactor ?? 1;
    for (const c of cats) {
      const perMin = (weightedStat[c] + R * league.perMinute[c]) / denom;
      out[c] = MINUTES_BASE * perMin * ageFactor;
    }
    return out;
  }
  function projectMinutesPerGame(seasons) {
    let weightedMinutes = 0;
    let weightedGames = 0;
    let totalGP = 0;
    for (let i = 0; i < seasons.length && i < MARCEL_WEIGHTS.length; i++) {
      const s = seasons[i];
      const w = MARCEL_WEIGHTS[i];
      weightedMinutes += w * num2(s.MIN);
      weightedGames += w * num2(s.GP);
      totalGP += num2(s.GP);
    }
    if (weightedGames <= 0) return 0;
    const raw = weightedMinutes / weightedGames;
    if (totalGP >= MARCEL_MPG_GP_FLOOR) return raw;
    return (1 - MARCEL_MPG_PRIOR_WEIGHT) * raw + MARCEL_MPG_PRIOR_WEIGHT * MARCEL_MPG_PRIOR;
  }
  function projectGamesPlayed(seasons, espnProjection) {
    const usable = seasons.slice(0, GP_WEIGHTS.length);
    if (usable.length <= 1) {
      const espnGP = num2(espnProjection?.GP);
      if (espnGP > 0) return Math.min(espnGP, GP_MAX);
      return GP_FALLBACK;
    }
    let weighted = 0;
    let weightSum = 0;
    for (let i = 0; i < usable.length; i++) {
      const w = GP_WEIGHTS[i];
      weighted += w * num2(usable[i].GP);
      weightSum += w;
    }
    if (weightSum <= 0) return GP_FALLBACK;
    let gp = weighted / weightSum;
    gp = (1 - GP_PRIOR_WEIGHT) * gp + GP_PRIOR_WEIGHT * GP_PRIOR;
    return Math.min(gp, GP_MAX);
  }
  function overrideIsActive(override, today) {
    if (!override) return false;
    if (!override.until) return true;
    if (!today) return true;
    return today <= override.until;
  }
  function espnPerGameRate(espnProjection, cats = CATEGORIES) {
    if (!espnProjection) return null;
    const gp = num2(espnProjection.GP);
    if (gp < 1) return null;
    const out = emptyVector3();
    let any = false;
    for (const c of cats) {
      const v = num2(espnProjection[c]) / gp;
      out[c] = v;
      if (v !== 0) any = true;
    }
    return any ? out : null;
  }
  function projectPlayer(input, league, opts = {}) {
    const cats = opts.categories ?? CATEGORIES;
    const alpha = opts.blendAlpha ?? PROJECTION_BLEND_ALPHA;
    const override = overrideIsActive(opts.override, opts.today) ? opts.override : null;
    const seasons = (input.seasons ?? []).slice(0, MARCEL_WEIGHTS.length);
    const espnRate = espnPerGameRate(input.espnProjection, cats);
    if (seasons.length === 0) {
      const gp2 = override?.gp ?? num2(input.espnProjection?.GP) ?? GP_FALLBACK;
      const mpg2 = override?.mpg ?? 0;
      const perGame2 = espnRate ?? emptyVector3();
      const per362 = emptyVector3();
      if (mpg2 > 0) {
        for (const c of cats) per362[c] = perGame2[c] * MINUTES_BASE / mpg2;
      }
      return {
        id: input.id,
        perGame: perGame2,
        per36: per362,
        gp: Math.min(gp2 > 0 ? gp2 : GP_FALLBACK, GP_MAX),
        mpg: mpg2,
        source: espnRate ? override ? "override" : "espn" : "none",
        seasonsUsed: 0
      };
    }
    const per36 = per36Rate(seasons, league, opts);
    const modelMpg = projectMinutesPerGame(seasons);
    const mpg = override?.mpg ?? modelMpg;
    const larryRate = emptyVector3();
    for (const c of cats) larryRate[c] = per36[c] * mpg / MINUTES_BASE;
    const perGame = emptyVector3();
    let source;
    if (!espnRate) {
      for (const c of cats) perGame[c] = larryRate[c];
      source = "larry";
    } else if (alpha >= 1) {
      for (const c of cats) perGame[c] = larryRate[c];
      source = "larry";
    } else if (alpha <= 0) {
      for (const c of cats) perGame[c] = espnRate[c];
      source = "espn";
    } else {
      for (const c of cats) perGame[c] = alpha * larryRate[c] + (1 - alpha) * espnRate[c];
      source = "blend";
    }
    const gp = override?.gp ?? projectGamesPlayed(seasons, input.espnProjection);
    return {
      id: input.id,
      perGame,
      per36,
      gp: Math.min(Math.max(gp, 0), GP_MAX),
      mpg,
      source: override ? "override" : source,
      seasonsUsed: seasons.length
    };
  }
  function projectAll(inputs, opts = {}) {
    const league = computeLeagueRates(
      inputs.map((i) => i.seasons ?? []),
      { categories: opts.categories }
    );
    const out = /* @__PURE__ */ new Map();
    for (const input of inputs) {
      const override = opts.overrides ? opts.overrides[input.id] : opts.override;
      out.set(input.id, projectPlayer(input, league, { ...opts, override }));
    }
    return out;
  }

  // src/engine/draftProfiles.ts
  function mean(values) {
    if (!values.length) return 0;
    let sum = 0;
    for (const v of values) sum += v;
    return sum / values.length;
  }
  function sampleStdev(values) {
    if (values.length < 2) return 0;
    const m = mean(values);
    let sq = 0;
    for (const v of values) sq += (v - m) * (v - m);
    return Math.sqrt(sq / (values.length - 1));
  }
  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  function emptyVector4() {
    return { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
  }
  function normName(raw) {
    return raw.normalize("NFKD").replace(/[^\x00-\x7F]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean).join(" ");
  }
  function buildAdpLookup(adp) {
    const out = /* @__PURE__ */ new Map();
    if (!adp) return out;
    for (const season of Object.keys(adp)) {
      const inner = /* @__PURE__ */ new Map();
      for (const row of adp[season] || []) {
        const name = row[0];
        const value = row[1];
        if (typeof name === "string" && Number.isFinite(value) && !inner.has(name)) {
          inner.set(name, value);
        }
      }
      out.set(season, inner);
    }
    return out;
  }
  function phaseForRound(round) {
    if (round <= 3) return "early";
    if (round <= 7) return "mid";
    return "late";
  }
  function seasonResiduals(seasonId, season, adpForSeason) {
    const pool = [];
    for (const pick of season.picks || []) {
      const playerId = pick[3];
      const row = season.players[String(playerId)];
      if (!row) continue;
      const gp = row[4];
      if (!Number.isFinite(gp) || gp <= 0) continue;
      const perGame = {
        PTS: (row[5] || 0) / gp,
        REB: (row[6] || 0) / gp,
        AST: (row[7] || 0) / gp,
        STL: (row[8] || 0) / gp,
        BLK: (row[9] || 0) / gp
      };
      pool.push({
        pick,
        perGame,
        z: emptyVector4(),
        posId: row[1],
        proTeamId: row[2],
        name: row[0]
      });
    }
    if (!pool.length) return [];
    for (const c of CATEGORIES) {
      const values = pool.map((p) => p.perGame[c]);
      const m = mean(values);
      const sd = Math.max(sampleStdev(values), STDEV_FLOOR);
      for (const entry of pool) {
        entry.z[c] = (entry.perGame[c] - m) / sd;
      }
    }
    const out = [];
    for (const entry of pool) {
      const overall = entry.pick[0];
      const neighbors = pool.filter(
        (other) => other !== entry && Math.abs(other.pick[0] - overall) <= DRAFT_NEIGHBOR_WINDOW
      );
      if (!neighbors.length) continue;
      const resid = emptyVector4();
      for (const c of CATEGORIES) {
        resid[c] = entry.z[c] - mean(neighbors.map((n) => n.z[c]));
      }
      const teamId = entry.pick[2];
      const memberId = (season.owners || {})[String(teamId)];
      if (!memberId) continue;
      const adp = adpForSeason ? adpForSeason.get(normName(entry.name)) : void 0;
      out.push({
        memberId,
        season: seasonId,
        overall,
        round: entry.pick[1],
        playerId: entry.pick[3],
        posId: entry.posId,
        proTeamId: entry.proTeamId,
        resid,
        // Positive means they took the player EARLIER than ESPN drafters did.
        // Players with no ESPN ADP that season get null and are left out
        // entirely: they were off the board, so any number would be noise.
        reach: adp === void 0 ? null : adp - overall
      });
    }
    return out;
  }
  function strengthFor(t, premium) {
    if (Math.abs(premium) < DRAFT_PREMIUM_MIN_EFFECT) return "none";
    const abs = Math.abs(t);
    if (abs >= DRAFT_STRENGTH_STRONG_T) return "strong";
    if (abs >= DRAFT_STRENGTH_MODERATE_T) return "moderate";
    return "none";
  }
  function premiumLabel(category, premium, strength, seasonsPositive) {
    if (strength === "none") return "";
    const positive = premium > 0;
    if (strength === "strong") {
      if (positive) return "Pays up for " + category;
      return seasonsPositive <= DRAFT_PUNT_MAX_POSITIVE_SEASONS ? "Punts " + category : "Avoids " + category;
    }
    return positive ? "Leans " + category : "Light on " + category;
  }
  function reachLabel(med) {
    if (med === null) return "No ESPN ADP overlap";
    if (med >= DRAFT_REACH_OFTEN_MEDIAN) return "Reaches often";
    if (med <= DRAFT_REACH_BOARD_MEDIAN) return "Drafts the board";
    return "Slight reacher";
  }
  function joinList(parts) {
    if (parts.length <= 1) return parts[0] || "";
    if (parts.length === 2) return parts[0] + " and " + parts[1];
    return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  }
  function buildSummary(premium) {
    const strong = CATEGORIES.filter((c) => premium[c].strength === "strong");
    const moderate = CATEGORIES.filter((c) => premium[c].strength === "moderate");
    if (!strong.length && !moderate.length) return "No clear category lean";
    const sentences = [];
    for (const c of strong) {
      const p = premium[c];
      if (p.premium > 0) {
        sentences.push("Pays up for " + c);
      } else if (p.seasonsPositive <= DRAFT_PUNT_MAX_POSITIVE_SEASONS) {
        sentences.push(
          "Punts " + c + " (" + p.seasonsPositive + " of " + p.seasonsTotal + " seasons)"
        );
      } else {
        sentences.push("Avoids " + c);
      }
    }
    const up = moderate.filter((c) => premium[c].premium > 0);
    const down = moderate.filter((c) => premium[c].premium <= 0);
    if (up.length) sentences.push("Leans " + joinList(up.slice()));
    if (down.length) sentences.push("Light on " + joinList(down.slice()));
    return sentences.join(". ") + ".";
  }
  function buildDraftProfiles(history, adp, options = {}) {
    const adpLookup = buildAdpLookup(adp);
    const seasonsUsed = [];
    const seasonsSkipped = [];
    const allResiduals = [];
    const allRaw = [];
    const seasonsByMember = /* @__PURE__ */ new Map();
    const seasonKeys = Object.keys(history.seasons || {}).map((k) => Number(k)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    for (const seasonId of seasonKeys) {
      if (options.asOfSeason !== void 0 && seasonId >= options.asOfSeason) continue;
      const season = history.seasons[String(seasonId)];
      if (!season || !season.picks || !season.picks.length) {
        seasonsSkipped.push(seasonId);
        continue;
      }
      seasonsUsed.push(seasonId);
      const residuals = seasonResiduals(seasonId, season, adpLookup.get(String(seasonId)));
      for (const r of residuals) allResiduals.push(r);
      for (const pick of season.picks) {
        const memberId = (season.owners || {})[String(pick[2])];
        if (!memberId) continue;
        const row = season.players[String(pick[3])];
        allRaw.push({
          memberId,
          season: seasonId,
          round: pick[1],
          posId: row ? row[1] : 0,
          proTeamId: row ? row[2] : 0
        });
        let set = seasonsByMember.get(memberId);
        if (!set) {
          set = /* @__PURE__ */ new Set();
          seasonsByMember.set(memberId, set);
        }
        set.add(seasonId);
      }
    }
    const leaguePosPicks = allRaw.filter(
      (p) => p.round <= DRAFT_POSITION_LEAN_MAX_ROUND && p.posId >= 1 && p.posId <= 5
    );
    const leaguePosCounts = /* @__PURE__ */ new Map();
    for (const p of leaguePosPicks) {
      leaguePosCounts.set(p.posId, (leaguePosCounts.get(p.posId) || 0) + 1);
    }
    const leagueTeamCounts = /* @__PURE__ */ new Map();
    let leagueTeamTotal = 0;
    for (const p of allRaw) {
      if (!p.proTeamId) continue;
      leagueTeamCounts.set(p.proTeamId, (leagueTeamCounts.get(p.proTeamId) || 0) + 1);
      leagueTeamTotal++;
    }
    const profiles = {};
    const memberIds = Array.from(seasonsByMember.keys());
    for (const memberId of memberIds) {
      const seasons = Array.from(seasonsByMember.get(memberId) || []).sort((a, b) => a - b);
      const draftCount = seasons.length;
      const mine = allResiduals.filter((r) => r.memberId === memberId);
      const myRaw = allRaw.filter((p) => p.memberId === memberId);
      const premiumPicks = mine.filter((r) => r.round <= DRAFT_PREMIUM_MAX_ROUND);
      const premium = {};
      for (const c of CATEGORIES) {
        const values = premiumPicks.map((r) => r.resid[c]);
        const m = mean(values);
        const sd = sampleStdev(values);
        const n = values.length;
        const t = n >= 2 && sd > 0 ? m / (sd / Math.sqrt(n)) : 0;
        let seasonsPositive = 0;
        for (const s of seasons) {
          const inSeason = premiumPicks.filter((r) => r.season === s).map((r) => r.resid[c]);
          if (inSeason.length && mean(inSeason) > 0) seasonsPositive++;
        }
        const strength = strengthFor(t, m);
        premium[c] = {
          category: c,
          premium: m,
          t,
          n,
          seasonsPositive,
          seasonsTotal: draftCount,
          strength,
          label: premiumLabel(c, m, strength, seasonsPositive)
        };
      }
      const order = CATEGORIES.slice().sort((a, b) => premium[b].premium - premium[a].premium);
      const reaches = mine.filter((r) => r.reach !== null).map((r) => r.reach);
      const byPhase = (phase) => mine.filter((r) => r.reach !== null && phaseForRound(r.round) === phase).map((r) => r.reach);
      const reachMedian = median(reaches);
      const reach = {
        median: reachMedian,
        early: median(byPhase("early")),
        mid: median(byPhase("mid")),
        late: median(byPhase("late")),
        n: reaches.length,
        label: reachLabel(reachMedian)
      };
      const myPosPicks = myRaw.filter(
        (p) => p.round <= DRAFT_POSITION_LEAN_MAX_ROUND && p.posId >= 1 && p.posId <= 5
      );
      const positionLean = [];
      if (myPosPicks.length && leaguePosPicks.length) {
        const myCounts = /* @__PURE__ */ new Map();
        for (const p of myPosPicks) myCounts.set(p.posId, (myCounts.get(p.posId) || 0) + 1);
        for (const posId of [1, 2, 3, 4, 5]) {
          const share = (myCounts.get(posId) || 0) / myPosPicks.length;
          const leagueShare = (leaguePosCounts.get(posId) || 0) / leaguePosPicks.length;
          const lean = (share - leagueShare) * 100;
          if (Math.abs(lean) >= DRAFT_POSITION_LEAN_THRESHOLD) {
            const position = ESPN_POSITION_ID_TO_NAME[posId];
            if (position) {
              positionLean.push({
                position,
                lean,
                share: share * 100,
                leagueShare: leagueShare * 100
              });
            }
          }
        }
        positionLean.sort((a, b) => Math.abs(b.lean) - Math.abs(a.lean));
      }
      const myTeamCounts = /* @__PURE__ */ new Map();
      let myTeamTotal = 0;
      for (const p of myRaw) {
        if (!p.proTeamId) continue;
        myTeamCounts.set(p.proTeamId, (myTeamCounts.get(p.proTeamId) || 0) + 1);
        myTeamTotal++;
      }
      const teamAffinity = [];
      const ranked = Array.from(myTeamCounts.entries()).sort((a, b) => b[1] - a[1]);
      for (const [proTeamId, count] of ranked.slice(0, DRAFT_AFFINITY_TOP_N)) {
        if (count < DRAFT_AFFINITY_MIN_PICKS) continue;
        const share = myTeamTotal ? count / myTeamTotal : 0;
        const leagueShare = leagueTeamTotal ? (leagueTeamCounts.get(proTeamId) || 0) / leagueTeamTotal : 0;
        if (leagueShare > 0 && share < leagueShare * DRAFT_AFFINITY_RATE_MULTIPLE) continue;
        teamAffinity.push({
          proTeamId,
          count,
          share: share * 100,
          leagueShare: leagueShare * 100
        });
      }
      profiles[memberId] = {
        memberId,
        name: (history.members || {})[memberId] || "Manager " + memberId,
        seasons,
        draftCount,
        smallSample: draftCount < DRAFT_SMALL_SAMPLE_DRAFTS,
        pickCount: myRaw.length,
        premium,
        order,
        reach,
        positionLean,
        teamAffinity,
        summary: buildSummary(premium)
      };
    }
    return { profiles, seasonsUsed, seasonsSkipped };
  }
  function leagueReachMedians(profiles) {
    const out = { early: 0, mid: 0, late: 0 };
    const phases = ["early", "mid", "late"];
    for (const phase of phases) {
      const values = [];
      for (const id of Object.keys(profiles)) {
        const value = profiles[id]?.reach[phase];
        if (value !== null && value !== void 0) values.push(value);
      }
      out[phase] = median(values) ?? 0;
    }
    return out;
  }

  // src/engine/draftTeamFit.ts
  var FIT_WEIGHT_WEAK = 1.5;
  var FIT_WEIGHT_EVEN = 1;
  var FIT_WEIGHT_STRONG = 0.5;
  var FIT_LAMBDA = 0.5;
  var FIT_MIN_PICKS = 2;
  var SEASON_GAMES = 82;
  function emptyVector5() {
    return { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
  }
  function rosterCategoryTotals(players) {
    const out = emptyVector5();
    for (const p of players) {
      for (const c of CATEGORIES) {
        out[c] += (p.perGame[c] || 0) * (p.expectedGP || 0);
      }
    }
    return out;
  }
  function categoryRanks(totalsByTeam, myTeamId) {
    const out = {};
    const mine = totalsByTeam.get(myTeamId);
    for (const c of CATEGORIES) {
      const myValue = mine ? mine[c] : 0;
      let better = 0;
      for (const [teamId, totals] of totalsByTeam) {
        if (teamId === myTeamId) continue;
        if (totals[c] > myValue) better++;
      }
      out[c] = better + 1;
    }
    return out;
  }
  function fitWeights(ranks, teamCount) {
    const third = Math.max(1, Math.round(teamCount / 4));
    const out = emptyVector5();
    for (const c of CATEGORIES) {
      const rank = ranks[c];
      if (rank <= third) out[c] = FIT_WEIGHT_STRONG;
      else if (rank <= third * 2) out[c] = FIT_WEIGHT_EVEN;
      else out[c] = FIT_WEIGHT_WEAK;
    }
    return out;
  }
  function fitBonus2(player, weights, lambda = FIT_LAMBDA) {
    let sum = 0;
    for (const c of CATEGORIES) {
      sum += (weights[c] - 1) * (player.z[c] || 0);
    }
    return lambda * sum * (player.expectedGP || 0) / SEASON_GAMES;
  }
  function recommendValueAndFit(input) {
    const ranks = categoryRanks(input.totalsByTeam, input.myTeamId);
    const weights = fitWeights(ranks, input.teamCount);
    const active = input.myPickCount >= FIT_MIN_PICKS;
    let valueId = null;
    let bestValue = -Infinity;
    let fitId = null;
    let bestFit = -Infinity;
    for (const p of input.available) {
      const value = input.valueOf(p.playerId);
      if (!Number.isFinite(value)) continue;
      if (value > bestValue) {
        bestValue = value;
        valueId = p.playerId;
      }
      const combined = value + fitBonus2(p, weights, input.lambda ?? FIT_LAMBDA);
      if (combined > bestFit) {
        bestFit = combined;
        fitId = p.playerId;
      }
    }
    const weakest = CATEGORIES.map((c) => ({ category: c, rank: ranks[c] })).filter((r) => weights[r.category] === FIT_WEIGHT_WEAK).sort((a, b) => b.rank - a.rank);
    return {
      valueId,
      fitId: active ? fitId : valueId,
      active,
      ranks,
      weights,
      weakest
    };
  }

  // src/engine/durability.ts
  var DURABILITY_WEIGHTS = [5, 4, 3];
  var DURABILITY_K = 1.25;
  var DURABILITY_W = 0.2;
  var DURABILITY_OVERRIDE_GAP = 15;
  function weightedHistory(priorGP) {
    if (!priorGP.length) return null;
    let num3 = 0;
    let den = 0;
    for (let i = 0; i < priorGP.length && i < DURABILITY_WEIGHTS.length; i++) {
      const gp = priorGP[i];
      if (typeof gp !== "number" || !Number.isFinite(gp) || gp < 0) continue;
      const weight = DURABILITY_WEIGHTS[i];
      num3 += weight * gp;
      den += weight;
    }
    return den > 0 ? num3 / den : null;
  }
  function durabilityDetail(input, options = {}) {
    const k = options.k ?? DURABILITY_K;
    const w = options.w ?? DURABILITY_W;
    const espnGP = Number.isFinite(input.espnGP) && input.espnGP > 0 ? input.espnGP : 0;
    if (input.onTeam === false) {
      return { expectedGP: 0, histGP: null, blendGP: 0, overrideApplied: false, seasons: 0 };
    }
    const usable = input.priorGP.filter(
      (gp) => typeof gp === "number" && Number.isFinite(gp) && gp >= 0
    );
    const raw = weightedHistory(usable);
    if (raw === null) {
      return {
        expectedGP: clampGames(espnGP),
        histGP: null,
        blendGP: espnGP,
        overrideApplied: false,
        seasons: 0
      };
    }
    const seasons = usable.length;
    const shrink = k / (k + seasons);
    const histGP = (1 - shrink) * raw + shrink * input.leagueMeanGP;
    const blendGP = w * espnGP + (1 - w) * histGP;
    const overrideApplied = espnGP > 0 && espnGP <= histGP - DURABILITY_OVERRIDE_GAP;
    const expected = overrideApplied ? Math.min(blendGP, espnGP) : blendGP;
    return {
      expectedGP: clampGames(expected),
      histGP,
      blendGP,
      overrideApplied,
      seasons
    };
  }
  function expectedGames(input, options = {}) {
    return durabilityDetail(input, options).expectedGP;
  }
  function clampGames(gp) {
    if (!Number.isFinite(gp) || gp < 0) return 0;
    return Math.min(gp, GP_MAX - 4);
  }

  // src/engine/mockDraft.ts
  var DEFAULT_MOCK_PARAMS = {
    tauEarly: MOCK_TAU_EARLY,
    tauMid: MOCK_TAU_MID,
    tauLate: MOCK_TAU_LATE,
    beta: MOCK_BETA,
    lambda: MOCK_LAMBDA,
    gamma: MOCK_GAMMA,
    alpha: MOCK_ALPHA,
    rankForm: MOCK_RANK_FORM
  };
  function rankUtility(rank, tau, form) {
    if (form === "log") return -Math.log(Math.max(rank, 1)) / tau;
    return -rank / tau;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a = a + 1831565813 >>> 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function mixSeed(seed, salt) {
    let h = (seed ^ 2654435769) >>> 0;
    h = (Math.imul(h ^ salt, 2246822507) ^ salt << 13) >>> 0;
    h = (Math.imul(h ^ h >>> 13, 3266489909) ^ salt) >>> 0;
    return (h ^ h >>> 16) >>> 0;
  }
  function rankOf(player) {
    if (player.espnAdp !== null && Number.isFinite(player.espnAdp) && player.espnAdp > 0) {
      return player.espnAdp;
    }
    if (player.espnDraftRank !== null && Number.isFinite(player.espnDraftRank) && player.espnDraftRank > 0) {
      return player.espnDraftRank;
    }
    if (player.larryRank !== null && Number.isFinite(player.larryRank) && player.larryRank > 0) {
      return player.larryRank;
    }
    return MOCK_RANK_FALLBACK;
  }
  function mean2(values) {
    if (!values.length) return 0;
    let sum = 0;
    for (const v of values) sum += v;
    return sum / values.length;
  }
  function sampleStdev2(values) {
    if (values.length < 2) return 0;
    const m = mean2(values);
    let sq = 0;
    for (const v of values) sq += (v - m) * (v - m);
    return Math.sqrt(sq / (values.length - 1));
  }
  function prepareBoard(config) {
    const entries = config.players.map((player) => ({
      player,
      rank: rankOf(player),
      z: { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 }
    }));
    const byRank = entries.slice().sort((a, b) => a.rank - b.rank);
    const pool = byRank.slice(0, MOCK_Z_POOL_SIZE);
    for (const c of CATEGORIES) {
      const values = pool.map((e) => e.player.perGame[c] || 0);
      const m = mean2(values);
      const sd = Math.max(sampleStdev2(values), STDEV_FLOOR);
      for (const entry of entries) {
        entry.z[c] = ((entry.player.perGame[c] || 0) - m) / sd;
      }
    }
    const byId = /* @__PURE__ */ new Map();
    for (const entry of entries) byId.set(entry.player.playerId, entry);
    return {
      entries,
      byId,
      rankOrder: byRank.map((e) => e.player.playerId),
      rounds: config.teamCount > 0 ? Math.ceil(config.order.length / config.teamCount) : 0
    };
  }
  function candidatePoolFor(round) {
    return round <= MOCK_POOL_EARLY_ROUNDS ? MOCK_CANDIDATE_POOL_EARLY : MOCK_CANDIDATE_POOL_LATE;
  }
  function roundForIndex(index, teamCount) {
    if (teamCount <= 0) return 1;
    return Math.floor(index / teamCount) + 1;
  }
  function snakeOrder(firstRound, rounds) {
    const out = [];
    for (let r = 0; r < rounds; r++) {
      const row = r % 2 === 0 ? firstRound : firstRound.slice().reverse();
      for (const teamId of row) out.push(teamId);
    }
    return out;
  }
  function nextPickIndex(order, teamId, fromIndex) {
    for (let i = Math.max(0, fromIndex); i < order.length; i++) {
      if (order[i] === teamId) return i;
    }
    return -1;
  }
  function availabilityTargets(order, teamId, fromIndex) {
    const upcoming = myUpcomingPicks(order, teamId, fromIndex);
    const userIsOnTheClock = upcoming[0] === fromIndex;
    const offset = userIsOnTheClock ? 1 : 0;
    return {
      first: upcoming[offset] ?? null,
      second: upcoming[offset + 1] ?? null
    };
  }
  function myUpcomingPicks(order, teamId, fromIndex) {
    const out = [];
    for (let i = Math.max(0, fromIndex); i < order.length; i++) {
      if (order[i] === teamId) out.push(i);
    }
    return out;
  }
  function resolveParams(config) {
    return { ...DEFAULT_MOCK_PARAMS, ...config.params || {} };
  }
  function categoryWeight(strength) {
    if (strength === "strong") return MOCK_WEIGHT_STRONG;
    if (strength === "moderate") return MOCK_WEIGHT_MODERATE;
    return 0;
  }
  function reachShrunk(profile, phase, leagueReach) {
    const league = leagueReach[phase] || 0;
    if (!profile) return league;
    const own = profile.reach[phase];
    if (own === null || own === void 0) return league;
    const n = profile.reach.n || 0;
    const w = n / (n + MOCK_REACH_SHRINK_K);
    return w * own + (1 - w) * league;
  }
  function tauFor(profile, phase, leagueReach, params) {
    const base = phase === "early" ? params.tauEarly : phase === "mid" ? params.tauMid : params.tauLate;
    const tau = base * Math.exp(params.beta * reachShrunk(profile, phase, leagueReach));
    return Math.min(Math.max(tau, 1e-6), 500);
  }
  function overloadFor(state, board, config, teamId, posId) {
    let count = 0;
    for (const pick of state.picks) {
      if (pick[1] !== teamId) continue;
      const round = roundForIndex(pick[0] - 1, config.teamCount);
      if (round > DRAFT_PREMIUM_MAX_ROUND) continue;
      const entry = board.byId.get(pick[2]);
      if (entry && entry.player.posId === posId) count++;
    }
    return Math.max(0, count - MOCK_OVERLOAD_THRESHOLD);
  }
  function affinityFor(profile, proTeamId) {
    if (!profile || !proTeamId) return 0;
    for (const t of profile.teamAffinity) {
      if (t.proTeamId === proTeamId) return 1;
    }
    return 0;
  }
  function pickUtilities(board, config, state, index, availableIds, candidatePool) {
    const params = resolveParams(config);
    const teamId = config.order[index];
    if (teamId === void 0) return [];
    const profile = config.profileByTeam[String(teamId)] || null;
    const round = roundForIndex(index, config.teamCount);
    const phase = phaseForRound(round);
    const tau = tauFor(profile, phase, config.leagueReach, params);
    const poolSize = candidatePool ?? config.candidatePool ?? candidatePoolFor(round);
    const out = [];
    for (const playerId of board.rankOrder) {
      if (!availableIds.has(playerId)) continue;
      const entry = board.byId.get(playerId);
      if (!entry) continue;
      let categoryTerm = 0;
      let topCategory = null;
      let topContribution = 0;
      if (profile) {
        for (const c of CATEGORIES) {
          const p = profile.premium[c];
          const w = categoryWeight(p.strength);
          if (!w) continue;
          const contribution = w * p.premium * entry.z[c];
          categoryTerm += contribution;
          if (Math.abs(contribution) > Math.abs(topContribution)) {
            topContribution = contribution;
            topCategory = c;
          }
        }
      }
      const rankTerm = rankUtility(entry.rank, tau, params.rankForm);
      const catTerm = params.lambda * categoryTerm;
      const overloadTerm = -params.gamma * overloadFor(state, board, config, teamId, entry.player.posId);
      const affTerm = params.alpha * affinityFor(profile, entry.player.proTeamId);
      out.push({
        playerId,
        utility: rankTerm + catTerm + overloadTerm + affTerm,
        rankTerm,
        categoryTerm: catTerm,
        overloadTerm,
        affinityTerm: affTerm,
        topCategory: topContribution > 0 ? topCategory : null
      });
      if (out.length >= poolSize) break;
    }
    return out;
  }
  function softmax(utilities) {
    if (!utilities.length) return [];
    let max = -Infinity;
    for (const u of utilities) if (u > max) max = u;
    const exps = utilities.map((u) => Math.exp(u - max));
    let sum = 0;
    for (const e of exps) sum += e;
    if (!(sum > 0)) return utilities.map(() => 1 / utilities.length);
    return exps.map((e) => e / sum);
  }
  function drawIndex(probabilities, roll) {
    let acc = 0;
    for (let i = 0; i < probabilities.length; i++) {
      acc += probabilities[i];
      if (roll < acc) return i;
    }
    return probabilities.length - 1;
  }
  function reasonFor(board, chosen, profile, overall) {
    const entry = board.byId.get(chosen.playerId);
    const rank = entry ? Math.round(entry.rank) : 0;
    if (rank && rank - overall >= 8) {
      return "Reach: ESPN #" + rank + " at pick " + overall;
    }
    if (profile && chosen.topCategory) {
      const p = profile.premium[chosen.topCategory];
      if (p.label) return p.label;
    }
    if (rank && overall - rank >= 8) {
      return "Value: ESPN #" + rank + " still there at " + overall;
    }
    return "Best available";
  }
  function decidePick(board, config, state, index, availableIds, candidatePool) {
    const utilities = pickUtilities(board, config, state, index, availableIds, candidatePool);
    if (!utilities.length) return null;
    const probabilities = softmax(utilities.map((u) => u.utility));
    const rng = mulberry32(mixSeed(state.seed, index + 1));
    const chosen = utilities[drawIndex(probabilities, rng())];
    if (!chosen) return null;
    const teamId = config.order[index];
    const profile = teamId === void 0 ? null : config.profileByTeam[String(teamId)] || null;
    return {
      playerId: chosen.playerId,
      reason: reasonFor(board, chosen, profile, index + 1)
    };
  }
  function availableIdsFor(board, state) {
    const taken = /* @__PURE__ */ new Set();
    for (const pick of state.picks) taken.add(pick[2]);
    const out = /* @__PURE__ */ new Set();
    for (const id of board.rankOrder) if (!taken.has(id)) out.add(id);
    return out;
  }
  function simulateUntil(board, config, state, stopForTeamId, maxPicks = Infinity) {
    const picks = state.picks.slice();
    const available = availableIdsFor(board, state);
    const made = [];
    let count = 0;
    while (picks.length < config.order.length && count < maxPicks) {
      const index = picks.length;
      const teamId = config.order[index];
      if (teamId === void 0) break;
      if (stopForTeamId !== null && teamId === stopForTeamId) break;
      const working = { seed: state.seed, picks };
      const decision = decidePick(board, config, working, index, available);
      if (!decision) break;
      available.delete(decision.playerId);
      const pick = [index + 1, teamId, decision.playerId];
      picks.push(pick);
      made.push({ pick, reason: decision.reason });
      count++;
    }
    return { state: { seed: state.seed, picks }, made };
  }
  function topPickRate(board, config, sims, window) {
    const topId = board.rankOrder[0];
    if (topId === void 0) return 0;
    let hits = 0;
    for (let s = 0; s < sims; s++) {
      const result = simulateUntil(board, config, { seed: s + 1, picks: [] }, null, window);
      for (const pick of result.state.picks) {
        if (pick[2] === topId) {
          hits++;
          break;
        }
      }
    }
    return sims > 0 ? hits / sims : 0;
  }
  function emptyAvailabilityCounts() {
    return { sims: 0, atNext: /* @__PURE__ */ new Map(), atSecond: /* @__PURE__ */ new Map() };
  }
  function runAvailabilitySims(board, config, state, myTeamId, simOffset, simCount, counts) {
    const fromIndex = state.picks.length;
    const targets = availabilityTargets(config.order, myTeamId, fromIndex);
    const firstTarget = targets.first === null ? void 0 : targets.first;
    const secondTarget = targets.second === null ? void 0 : targets.second;
    if (firstTarget === void 0) return counts;
    const baseAvailable = availableIdsFor(board, state);
    for (let s = 0; s < simCount; s++) {
      const simSeed = mixSeed(state.seed, 24320 + simOffset + s);
      const available = new Set(baseAvailable);
      const picks = state.picks.slice();
      const limit = secondTarget === void 0 ? firstTarget : secondTarget;
      for (let index = fromIndex; index <= limit; index++) {
        if (index === firstTarget) {
          for (const id of available) counts.atNext.set(id, (counts.atNext.get(id) || 0) + 1);
          if (secondTarget === void 0) break;
        } else if (index === secondTarget) {
          for (const id of available) {
            counts.atSecond.set(id, (counts.atSecond.get(id) || 0) + 1);
          }
          break;
        }
        if (config.order[index] === myTeamId) {
          const mine = firstAvailableByRank(board, available);
          if (mine === null) break;
          available.delete(mine);
          picks.push([index + 1, myTeamId, mine]);
          continue;
        }
        const working = { seed: simSeed, picks };
        const decision = decidePick(board, config, working, index, available);
        if (!decision) break;
        available.delete(decision.playerId);
        const teamId = config.order[index];
        if (teamId === void 0) break;
        picks.push([index + 1, teamId, decision.playerId]);
      }
      counts.sims++;
    }
    return counts;
  }
  function firstAvailableByRank(board, available) {
    for (const id of board.rankOrder) if (available.has(id)) return id;
    return null;
  }
  function larryPickAdvice(board, available, shares) {
    const topId = bestAvailableByLarry(board, available);
    const none = { recommendId: topId, waitId: null, waitShare: 0 };
    if (topId === null || !shares || !shares.size) return none;
    const topShare = shares.get(topId);
    if (topShare === void 0 || topShare < MOCK_CAN_WAIT_THRESHOLD) return none;
    let scarceId = null;
    let scarceRank = Infinity;
    for (const id of available) {
      if (id === topId) continue;
      const share = shares.get(id);
      if (share === void 0 || share >= MOCK_SCARCE_THRESHOLD) continue;
      const entry = board.byId.get(id);
      if (!entry) continue;
      const rank = entry.player.larryRank;
      if (rank === null || !Number.isFinite(rank) || rank <= 0) continue;
      if (rank < scarceRank) {
        scarceRank = rank;
        scarceId = id;
      }
    }
    if (scarceId === null) return none;
    return { recommendId: scarceId, waitId: topId, waitShare: topShare };
  }
  function bestAvailableByLarry(board, available) {
    let best = null;
    let bestRank = Infinity;
    for (const id of available) {
      const entry = board.byId.get(id);
      if (!entry) continue;
      const rank = entry.player.larryRank;
      if (rank === null || !Number.isFinite(rank) || rank <= 0) continue;
      if (rank < bestRank) {
        bestRank = rank;
        best = id;
      }
    }
    if (best !== null) return best;
    return firstAvailableByRank(board, available);
  }

  // src/engine/draftFit.ts
  var UNCAPPED_POOL = 1e5;
  function emptyEval() {
    return { picks: 0, meanLogLik: 0, top1: 0, top5: 0, poolCoverage: 0 };
  }
  function buildHistoricalBoard(history, seasonId, adpLookup) {
    const season = history.seasons[String(seasonId)];
    if (!season) return [];
    const adp = adpLookup.get(String(seasonId));
    const out = [];
    for (const id of Object.keys(season.players)) {
      const row = season.players[id];
      if (!row) continue;
      const gp = row[4];
      const perGame = {
        PTS: gp > 0 ? (row[5] || 0) / gp : 0,
        REB: gp > 0 ? (row[6] || 0) / gp : 0,
        AST: gp > 0 ? (row[7] || 0) / gp : 0,
        STL: gp > 0 ? (row[8] || 0) / gp : 0,
        BLK: gp > 0 ? (row[9] || 0) / gp : 0
      };
      const fromFile = adp ? adp.get(normName(row[0])) : void 0;
      out.push({
        playerId: Number(id),
        name: row[0],
        posId: row[1],
        proTeamId: row[2],
        // That season's ESPN ADP, from the committed history file. Never the
        // stored espnRank: for a finished season that is an end-of-season
        // rank, not the pre-draft board.
        espnAdp: fromFile === void 0 ? null : fromFile,
        espnDraftRank: row[3],
        larryRank: null,
        perGame
      });
    }
    return out;
  }
  function configForSeason(history, seasonId, board, profiles, params) {
    const season = history.seasons[String(seasonId)];
    if (!season || !season.picks.length) return null;
    const ordered = season.picks.slice().sort((a, b) => a[0] - b[0]);
    const order = ordered.map((p) => p[2]);
    const teamIds = new Set(order);
    const profileByTeam = {};
    for (const teamId of teamIds) {
      const memberId = season.owners[String(teamId)];
      profileByTeam[String(teamId)] = memberId && profiles[memberId] || null;
    }
    return {
      order,
      teamCount: teamIds.size,
      players: board,
      profileByTeam,
      leagueReach: leagueReachMedians(profiles),
      params
    };
  }
  function evaluateDraft(history, seasonId, adpLookup, profiles, params) {
    const season = history.seasons[String(seasonId)];
    if (!season || !season.picks.length) return emptyEval();
    const board = buildHistoricalBoard(history, seasonId, adpLookup);
    const config = configForSeason(history, seasonId, board, profiles, params);
    if (!config) return emptyEval();
    const prepared = prepareBoard(config);
    const ordered = season.picks.slice().sort((a, b) => a[0] - b[0]);
    const available = /* @__PURE__ */ new Set();
    for (const player of board) available.add(player.playerId);
    const state = { seed: 1, picks: [] };
    let logLikSum = 0;
    let scored = 0;
    let top1 = 0;
    let top5 = 0;
    let inPool = 0;
    for (let index = 0; index < ordered.length; index++) {
      const pick = ordered[index];
      if (!pick) continue;
      const actual = pick[3];
      if (!available.has(actual)) continue;
      const utilities = pickUtilities(prepared, config, state, index, available);
      const capped = utilities.length > 1 ? utilities : null;
      const actualInPool = capped ? capped.some((u) => u.playerId === actual) : false;
      const scoring = actualInPool ? capped : pickUtilities(prepared, config, state, index, available, UNCAPPED_POOL);
      if (scoring && scoring.length > 1) {
        const probabilities = softmax(scoring.map((u) => u.utility));
        let actualP = 0;
        for (let i = 0; i < scoring.length; i++) {
          const entry = scoring[i];
          const p = probabilities[i];
          if (!entry || p === void 0) continue;
          if (entry.playerId === actual) actualP = p;
        }
        let better = 0;
        for (let i = 0; i < scoring.length; i++) {
          const entry = scoring[i];
          const p = probabilities[i];
          if (!entry || p === void 0) continue;
          if (entry.playerId !== actual && p > actualP) better++;
        }
        logLikSum += Math.log(Math.max(actualP, 1e-12));
        if (better === 0) top1++;
        if (better < 5) top5++;
        if (actualInPool) inPool++;
        scored++;
      }
      available.delete(actual);
      state.picks.push([index + 1, pick[2], actual]);
    }
    return {
      picks: scored,
      meanLogLik: scored ? logLikSum / scored : 0,
      top1: scored ? top1 / scored : 0,
      top5: scored ? top5 / scored : 0,
      poolCoverage: scored ? inPool / scored : 0
    };
  }
  function combineEvals(results) {
    let picks = 0;
    let logLik = 0;
    let top1 = 0;
    let top5 = 0;
    let coverage = 0;
    for (const r of results) {
      picks += r.picks;
      logLik += r.meanLogLik * r.picks;
      top1 += r.top1 * r.picks;
      top5 += r.top5 * r.picks;
      coverage += r.poolCoverage * r.picks;
    }
    if (!picks) return emptyEval();
    return {
      picks,
      meanLogLik: logLik / picks,
      top1: top1 / picks,
      top5: top5 / picks,
      poolCoverage: coverage / picks
    };
  }
  function profilesBySeason(history, seasons, adp) {
    const out = {};
    for (const seasonId of seasons) {
      out[seasonId] = buildDraftProfiles(history, adp, { asOfSeason: seasonId }).profiles;
    }
    return out;
  }
  function startingParams(form, rankOnly) {
    const base = { ...DEFAULT_MOCK_PARAMS, rankForm: form };
    if (form === "log") {
      base.tauEarly = 0.3;
      base.tauMid = 0.5;
      base.tauLate = 0.9;
    } else {
      base.tauEarly = 2;
      base.tauMid = 3.33;
      base.tauLate = 6;
    }
    if (rankOnly) {
      base.beta = 0;
      base.lambda = 0;
      base.gamma = 0;
      base.alpha = 0;
    }
    return base;
  }
  var TAU_KEYS = ["tauEarly", "tauMid", "tauLate"];
  var TERM_KEYS = ["beta", "lambda", "gamma", "alpha"];
  function fitMockDraft(history, fitSeasons, adp, options = {}) {
    const adpLookup = buildAdpLookup(adp);
    const profiles = profilesBySeason(history, fitSeasons, adp);
    const trace = [];
    const form = options.rankForm ?? DEFAULT_MOCK_PARAMS.rankForm;
    const params = startingParams(form, !!options.rankOnly);
    const score = (candidate) => combineEvals(
      fitSeasons.map(
        (seasonId) => evaluateDraft(
          history,
          seasonId,
          adpLookup,
          profiles[seasonId] || {},
          candidate
        )
      )
    );
    let best = score(params);
    trace.push("start: mean log-likelihood " + best.meanLogLik.toFixed(4));
    const iterations = options.iterations ?? 6;
    for (let pass = 0; pass < iterations; pass++) {
      const shrink = Math.pow(0.5, pass);
      let improved = false;
      for (const key of TAU_KEYS) {
        for (const factor of [1 + 0.5 * shrink, 1 / (1 + 0.5 * shrink)]) {
          const candidate = { ...params };
          candidate[key] = Math.min(Math.max(params[key] * factor, 0.05), 200);
          const result = score(candidate);
          if (result.meanLogLik > best.meanLogLik) {
            best = result;
            params[key] = candidate[key];
            improved = true;
            trace.push(
              key + " -> " + params[key].toFixed(3) + " (mean log-likelihood " + best.meanLogLik.toFixed(4) + ")"
            );
          }
        }
      }
      if (!options.rankOnly) {
        for (const key of TERM_KEYS) {
          const step = (key === "beta" ? 0.04 : 4) * shrink;
          for (const delta of [step, -step]) {
            const candidate = { ...params };
            candidate[key] = Math.max(params[key] + delta, 0);
            const result = score(candidate);
            if (result.meanLogLik > best.meanLogLik) {
              best = result;
              params[key] = candidate[key];
              improved = true;
              trace.push(
                key + " -> " + params[key].toFixed(3) + " (mean log-likelihood " + best.meanLogLik.toFixed(4) + ")"
              );
            }
          }
        }
      }
      if (!improved) break;
    }
    return { params, fitEval: best, trace };
  }
  function checkModel(history, testSeason, adp, params = DEFAULT_MOCK_PARAMS) {
    const adpLookup = buildAdpLookup(adp);
    const profiles = buildDraftProfiles(history, adp, { asOfSeason: testSeason }).profiles;
    const full = evaluateDraft(history, testSeason, adpLookup, profiles, params);
    const baseline = evaluateDraft(history, testSeason, adpLookup, profiles, {
      ...params,
      beta: 0,
      lambda: 0,
      gamma: 0,
      alpha: 0
    });
    return {
      season: testSeason,
      full,
      baseline,
      beatsBaseline: full.meanLogLik > baseline.meanLogLik
    };
  }
  return __toCommonJS(index_exports);
})();
//# sourceMappingURL=larry-engine.js.map
