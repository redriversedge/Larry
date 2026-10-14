// ============================================================
// LARRY v3.0 -- ANALYSIS ENGINES
// Z-scores, Monte Carlo, DURANT, recommendations
// Auto-adapts to league categories
// ============================================================

var Engines = (function() {

  // ========== ENGINE 1: Z-SCORES ==========

  function computeAllZScores(players, period, opts) {
    period = period || 'season';
    opts = opts || {};
    var cats = getOrderedCategories();
    if (!cats.length || !players.length) return;
    var recencyWeight = opts.recencyWeight || (S.prefs.recencyWeight || 0);

    var catStats = {};
    cats.forEach(function(cat) {
      var values = [];
      players.forEach(function(p) {
        var val = getBlendedStat(p, cat.abbr, period, recencyWeight);
        if (val !== null && val !== undefined && !isNaN(val)) values.push(val);
      });
      var mean = values.length ? values.reduce(function(a,b){return a+b;},0) / values.length : 0;
      var variance = values.length ? values.reduce(function(a,b){return a + Math.pow(b-mean,2);},0) / values.length : 1;
      var stdDev = Math.sqrt(variance) || 1;
      catStats[cat.abbr] = { mean: mean, stdDev: stdDev, scarcity: 1, variance: variance };
    });

    // Category weighting. This used to scale each z by a "scarcity" factor
    // derived from the category's coefficient of variation, which quietly
    // up-weighted BLK and STL because those have the widest relative spread.
    // In H2H each-category every category is worth exactly one win, so equal
    // weights are correct. The cv is still reported for display; scarcity is
    // held at 1 so nothing downstream has to change shape.
    cats.forEach(function(cat) {
      var cs = catStats[cat.abbr];
      cs.cv = cs.mean !== 0 ? cs.stdDev / Math.abs(cs.mean) : 1;
      cs.scarcity = 1;
    });

    // Compute z-scores
    players.forEach(function(p) {
      p.zScores = {};
      var totalZ = 0;
      cats.forEach(function(cat) {
        var val = getBlendedStat(p, cat.abbr, period, recencyWeight);
        if (val === null || val === undefined || isNaN(val)) { p.zScores[cat.abbr] = 0; return; }
        var cs = catStats[cat.abbr];
        var z = (val - cs.mean) / cs.stdDev;
        if (cat.isNegative) z = -z;
        z *= cs.scarcity;
        p.zScores[cat.abbr] = z;
        totalZ += z;
      });
      p.zScores.total = totalZ;

      // Trend detection, through the one shared definition.
      var l7 = p.stats && p.stats.last7 ? p.stats.last7 : null;
      var season = p.stats && p.stats.season ? p.stats.season : null;
      if (l7 && season) {
        p.trend = trendLabel(trendDelta(p, 'last7', 'season').avgChange);
      }

      // Frustration value: how far recent form swings from the baseline,
      // regardless of direction.
      //
      // The guards here were `!== null`, which passes for undefined. A
      // missing category then produced NaN, and one NaN poisons the whole
      // average. `== null` catches both null and undefined.
      var frustDiffs = [];
      cats.forEach(function(cat) {
        var sv = season ? season[cat.abbr] : null;
        var rv = l7 ? l7[cat.abbr] : null;
        if (sv == null || rv == null || sv === 0) return;
        frustDiffs.push(Math.pow((rv - sv) / Math.max(Math.abs(sv), 0.1), 2));
      });
      p.frustrationValue = frustDiffs.length ?
        Math.min(10, Math.sqrt(frustDiffs.reduce(function(a, b) { return a + b; }, 0) / frustDiffs.length) * 5) : 0;
    });

    return catStats;
  }

  function getBlendedStat(player, catAbbr, period, recencyWeight) {
    if (!recencyWeight || period !== 'season') {
      return player.stats && player.stats[period] ? player.stats[period][catAbbr] : null;
    }
    var season = player.stats && player.stats.season ? player.stats.season[catAbbr] : null;
    var recent = player.stats && player.stats.last30 ? player.stats.last30[catAbbr] : null;
    // `== null` so an absent category (undefined) takes the same path as an
    // explicit null. With `=== null` an undefined fell through to the blend
    // and produced NaN.
    if (season == null) return recent == null ? null : recent;
    if (recent == null) return season;
    return season * (1 - recencyWeight) + recent * recencyWeight;
  }

  // ========== ENGINE 2: MONTE CARLO (v3 FIX: forward projection) ==========



  // ========== ENGINE 3: DURANT RANKING (v2) ==========
  //
  // Base value is a per-game z-score against a starter-quality pool, computed
  // by window.LarryEngine.computeBaseValues (src/engine/zscore.ts). See
  // docs/RANKING_V2_SPEC.md. Nothing multiplies the base score: no injury
  // discount, no games-remaining factor, no trend or scarcity bonus. Those
  // either made the ranking worse against expert consensus or, in the case of
  // the injury multiplier, actively inverted it for anyone below zero.
  //
  // Measured on the Oct 12 2026 snapshot against the FantasyPros 6-expert
  // consensus top 150: rank correlation moves from 0.296 to 0.786, and the
  // OUT stars the old multiplier buried (Doncic 83rd, Giannis 199th, Tatum
  // 404th) come back to 2nd, 12th and 21st.

  // The five categories src/shared/types.ts CategoryVector understands. A
  // league scoring 3PM or FG% still ranks on the counting stats it shares
  // with this list; widening it is engine work, not a mapping change.
  var V2_CATEGORIES = ['REB', 'AST', 'STL', 'BLK', 'PTS'];

  // Mirrors DURANT_SCALE in src/engine/constants.ts. durantScore is a sum of
  // z-scores times this, so anything compared against it has to be on the
  // same scale.
  var DURANT_SCALE = 10;

  // ESPN reports the same unavailability under several spellings. Normalize
  // once so every filter agrees: INJURY_RESERVE and IR were treated as
  // different statuses in different places, so a player could be excluded
  // from add recommendations but still surface in the chat free-agent list.
  var OUT_STATUSES = {
    OUT: 1, SUSPENSION: 1, IR: 1, INJURY_RESERVE: 1, INJURED_RESERVE: 1, NA: 1
  };
  var GTD_STATUSES = {
    GTD: 1, DAY_TO_DAY: 1, GAME_TIME_DECISION: 1, QUESTIONABLE: 1, DOUBTFUL: 1
  };

  function normalizeInjuryStatus(status) {
    var s = String(status || 'ACTIVE').toUpperCase();
    if (OUT_STATUSES[s]) return 'OUT';
    if (GTD_STATUSES[s]) return 'GTD';
    return 'ACTIVE';
  }

  // True when a player cannot be counted on to play: never recommend adding
  // one, per CLAUDE.md.
  function isUnavailable(player) {
    return normalizeInjuryStatus(player && player.injuryStatus) === 'OUT';
  }

  function v2LeagueCategories() {
    var cats = getOrderedCategories();
    var out = [];
    cats.forEach(function(cat) {
      if (V2_CATEGORIES.indexOf(cat.abbr) >= 0) out.push(cat.abbr);
    });
    return out.length ? out : V2_CATEGORIES.slice();
  }

  // Single source of truth for turning a legacy player into the ranking
  // engine's input shape.
  //
  // As of the parse-time normalization, stats.season is ALREADY per-game, so
  // this hands the engine `perGame` directly rather than totals plus a
  // divisor. computeBaseValues accepts either shape and the resulting
  // baseValue is identical, which tests/engine/baseValue.test.ts pins.
  //
  // gamesPlayed still matters: it drives the shrink weight, so a 15-game
  // sample is still pulled toward the pool mean.
  function v2BaseValueInput(p) {
    return {
      id: String(p.id),
      gamesPlayed: p.gamesPlayed || 0,
      perGame: v2PerGame(p),
      // The shrink prior. Without this the engine falls back to the pool
      // mean, which scores every player at 0 before opening night.
      projectedPerGame: v2ProjectedPerGame(p)
    };
  }

  // Games ESPN expects this player to play, 0 when it did not say.
  function v2ProjectedGP(p) {
    var gp = p && p.stats ? p.stats.projectedGP : 0;
    return (typeof gp === 'number' && isFinite(gp) && gp > 0) ? gp : 0;
  }

  // A projection built on almost no games is a data error rather than a
  // forecast, and discounting on it would compound ESPN's mistake.
  // Haliburton shipped ACTIVE with a 1-game projection while the experts
  // had him 13th. An OUT player projected for a handful of games is not
  // suspect; that is ESPN agreeing with itself.
  function v2ProjectionSuspect(p) {
    var Eng = window.LarryEngine;
    var limit = (Eng && typeof Eng.PRESEASON_SUSPECT_GP === 'number')
      ? Eng.PRESEASON_SUSPECT_GP : 10;
    var gp = v2ProjectedGP(p);
    if (!(gp > 0) || gp >= limit) return false;
    return (p.injuryStatus || p.status || 'ACTIVE') !== 'OUT';
  }

  // Preseason rate: the projection divided by the games ESPN expects the
  // player to play, not by 82. Falls back to the /82 rate when ESPN gave no
  // game count, which is the best available answer in that case.
  function v2ProjectedRate(p) {
    var rate = p && p.stats ? p.stats.projectedRate : null;
    if (rate) {
      var out = {};
      var any = false;
      for (var i = 0; i < V2_CATEGORIES.length; i++) {
        var c = V2_CATEGORIES[i];
        var v = typeof rate[c] === 'number' && isFinite(rate[c]) ? rate[c] : 0;
        out[c] = v;
        if (v !== 0) any = true;
      }
      if (any) return out;
    }
    return v2ProjectedPerGame(p);
  }

  // Preseason value input. Nobody has played, so the observed rate is
  // irrelevant and the projection carries the whole score. gamesPlayed is
  // passed through rather than forced to 0 so that an early-season sync
  // that still counts as preseason behaves sensibly.
  function v2PreseasonInput(p) {
    var rate = v2ProjectedRate(p);
    return {
      id: String(p.id),
      gamesPlayed: p.gamesPlayed || 0,
      perGame: rate,
      projectedPerGame: rate
    };
  }

  // The player's projected per-game rate, or null when ESPN has not
  // projected them (deep bench, two-way contracts). Null means the engine
  // uses the pool mean and the player scores 0, which is the honest answer
  // for someone we know nothing about.
  function v2ProjectedPerGame(p) {
    var stats = p.stats || {};
    var src = stats.projectedPerGame;
    var out = {};
    var any = false;
    var i, c, v;
    if (src) {
      for (i = 0; i < V2_CATEGORIES.length; i++) {
        c = V2_CATEGORIES[i];
        v = typeof src[c] === 'number' && isFinite(src[c]) ? src[c] : 0;
        out[c] = v;
        if (v !== 0) any = true;
      }
      if (any) return out;
    }
    // Pre-migration state stores projections as season totals only.
    var totals = stats.projectedSeason;
    if (totals) {
      out = {};
      any = false;
      for (i = 0; i < V2_CATEGORIES.length; i++) {
        c = V2_CATEGORIES[i];
        v = typeof totals[c] === 'number' && isFinite(totals[c]) ? totals[c] / 82 : 0;
        out[c] = v;
        if (v !== 0) any = true;
      }
      if (any) return out;
    }
    return null;
  }

  // Per-game rates for a legacy player object. stats.season is per-game after
  // parse; a player with no games at all falls back to the projection, which
  // the parser pro-rates over a full season into stats.projectedPerGame.
  function v2PerGame(p) {
    var perGame = { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
    var stats = p.stats || {};
    var gp = p.gamesPlayed || 0;
    var src = gp > 0 ? (stats.season || {}) : (stats.projectedPerGame || {});
    for (var i = 0; i < V2_CATEGORIES.length; i++) {
      var c = V2_CATEGORIES[i];
      perGame[c] = typeof src[c] === 'number' && isFinite(src[c]) ? src[c] : 0;
    }
    return perGame;
  }

  function v2RosterSize() {
    return (S && S.league && S.league.rosterSize) || 13;
  }

  function computeDURANT(players, opts) {
    opts = opts || {};
    // Still needed: this is where p.trend and p.frustrationValue come from,
    // and several tabs read them. The z-scores it writes are overwritten
    // below with the v2 per-game values.
    computeAllZScores(players, 'season');

    var Eng = window.LarryEngine;
    if (!Eng || typeof Eng.computeBaseValues !== 'function') {
      console.warn('LarryEngine not loaded; DURANT falling back to legacy z-total');
      computeDURANTLegacy(players);
      return;
    }

    var cats = v2LeagueCategories();
    var scale = typeof Eng.DURANT_SCALE === 'number' ? Eng.DURANT_SCALE : 10;
    // Preseason the board is built from projections alone, so it reads the
    // rate ESPN expects the player to produce WHEN PLAYING and discounts
    // long-term absences separately. In season this is false and the code
    // below is exactly what it was.
    var preseason = typeof opts.preseason === 'boolean'
      ? opts.preseason
      : (typeof isPreseason === 'function' && isPreseason());
    var inputs = players.map(function(p) {
      return preseason ? v2PreseasonInput(p) : v2BaseValueInput(p);
    });
    var result = Eng.computeBaseValues(inputs, {
      categories: cats,
      rosterSize: v2RosterSize()
    });

    var rowById = {};
    result.rows.forEach(function(row) { rowById[row.id] = row; });

    players.forEach(function(p) {
      var row = rowById[String(p.id)];
      if (!row) { p.durantScore = null; p.noEvidence = true; return; }
      p.projectionSuspect = preseason && v2ProjectionSuspect(p);
      // No games played and no projection means we know nothing at all.
      // Scoring such a player 0 reads as "average starter" and floats them
      // above every real player who is merely below average.
      if (!row.hasEvidence) {
        p.durantScore = null;
        p.noEvidence = true;
      } else {
        p.noEvidence = false;
        var base = row.baseValue;
        if (preseason) {
          base = Eng.applyPreseasonDiscount(
            base, v2ProjectedGP(p), p.projectionSuspect);
        }
        // Scaled by 10 to sit on the same range as the old zTotal * 10
        // score, because the +3 free agent gap in tabs.js and the trade
        // acceptance margin here are absolute numbers tuned against it.
        p.durantScore = base * scale;
      }
      // Replace the totals-based, scarcity-weighted z-scores with the v2
      // per-game ones so the Z column, matchupAdjustedValue and the trade
      // analyzer all read the corrected numbers.
      var z = { total: 0 };
      for (var i = 0; i < cats.length; i++) {
        var c = cats[i];
        z[c] = row.z[c];
        z.total += row.z[c];
      }
      p.zScores = z;
      p.perGameStats = row.perGame;
    });

    // Rank. Evidenced players by score, then everyone we know nothing about,
    // ordered by ownership so the list is at least plausible rather than
    // arbitrary. A null score sorts below every number, including negatives.
    players.sort(function(a, b) {
      var aNone = a.durantScore === null || a.durantScore === undefined;
      var bNone = b.durantScore === null || b.durantScore === undefined;
      if (aNone !== bNone) return aNone ? 1 : -1;
      if (aNone && bNone) return (b.percentOwned || 0) - (a.percentOwned || 0);
      return b.durantScore - a.durantScore;
    });
    players.forEach(function(p, i) { p.durantRank = i + 1; });

    // Availability stays a separate field. It is read by add/drop, streaming
    // and lineup logic only; it must never move a player's season-long rank.
    var boostMap = computeOpportunityBoost(players);
    players.forEach(function(p) {
      p.availability = computeAvailabilityScore(p);
      var boost = boostMap[p.proTeamId] || 1.0;
      p.effectiveDURANT = applyDurantHaircut(p.durantScore, p.availability * boost);
    });
  }

  // Multipliers only ever reduce. Applying a 0.3x to a negative score raised
  // it, which is how an OUT player on z -4.2 outranked a healthy player on
  // z -4.1 by 131 places.
  //
  // A null score means "no evidence" and must stay null: coercing it to 0
  // here would put the player back at average-starter and undo the ordering
  // computeDURANT just established.
  function applyDurantHaircut(score, factor) {
    if (score === null || score === undefined) return null;
    var Eng = window.LarryEngine;
    if (Eng && typeof Eng.applyHaircut === 'function') return Eng.applyHaircut(score || 0, factor);
    var s = score || 0;
    return s > 0 ? s * factor : s;
  }

  // Pre-v2 scoring, kept only as a fallback for when dist/larry-engine.js
  // fails to load. Do not extend this; it has the defects documented in
  // docs/RANKING_V2_SPEC.md.
  function computeDURANTLegacy(players) {
    var cats = getOrderedCategories();
    players.forEach(function(p) {
      var zTotal = p.zScores ? p.zScores.total || 0 : 0;
      var trendBonus = p.trend === 'hot' ? 0.15 : (p.trend === 'cold' ? -0.10 : 0);
      var scarcityBonus = 0;
      cats.forEach(function(cat) {
        var z = p.zScores ? p.zScores[cat.abbr] || 0 : 0;
        if (z > 1.5) scarcityBonus += 0.05 * z;
      });
      p.durantScore = (zTotal * 10) + (trendBonus * 10) + scarcityBonus;
    });
    players.sort(function(a,b) { return (b.durantScore || 0) - (a.durantScore || 0); });
    players.forEach(function(p, i) { p.durantRank = i + 1; });
    var boostMap = computeOpportunityBoost(players);
    players.forEach(function(p) {
      p.availability = computeAvailabilityScore(p);
      var boost = boostMap[p.proTeamId] || 1.0;
      p.effectiveDURANT = applyDurantHaircut(p.durantScore, p.availability * boost);
    });
  }

  // DURANT is a whole-population computation: a Q-pool plus two iterations
  // over every player Larry knows about. It only changes when the data
  // changes, but it used to run on seven different render paths, including
  // every tap of the Roster date navigation. Compute it once per sync and
  // let renders read the result.
  function ensureDURANT(players) {
    if (!players || !players.length) return;
    if (!S) return;
    var stamp = (S.espn && S.espn.lastSync) || '';
    S.analysisCache = S.analysisCache || {};
    if (S.analysisCache.durantComputedAt === stamp &&
        S.analysisCache.durantPlayerCount === players.length) {
      return;
    }
    computeDURANT(players);
    S.analysisCache.durantComputedAt = stamp;
    S.analysisCache.durantPlayerCount = players.length;
  }


  // ========== ENGINE 3.5: AVAILABILITY SCORE ==========

  function computeAvailabilityScore(player) {
    // mpgFactor
    var mpg = player.minutesPerGame || 0;
    var mpgFactor = mpg >= 20 ? 1.0 : mpg >= 10 ? 0.75 : 0.5;

    // ownershipFactor
    var owned = player.percentOwned || 0;
    var ownershipFactor = owned >= 5 ? 1.0 : owned >= 1 ? 0.8 : 0.6;

    // recentActivityFactor
    var last7 = player.stats && player.stats.last7 ? player.stats.last7 : {};
    var hasActivity = Object.keys(last7).some(function(k) { return last7[k] && last7[k] !== 0; });
    var recentActivityFactor = hasActivity ? 1.0 : 0.5;

    // injuryFactor (GTD types already penalized in DURANT; re-applied here for availability multiplier)
    var status = player.injuryStatus || 'ACTIVE';
    var injuryFactor = normalizeInjuryStatus(status) === 'GTD' ? 0.85 : 1.0;

    return mpgFactor * ownershipFactor * recentActivityFactor * injuryFactor;
  }


  // ========== ENGINE 3.6: OPPORTUNITY BOOST ==========

  function computeOpportunityBoost(allPlayers) {
    // Count OUT/IR starters per NBA team (proTeamId)
    var teamInjuries = {};
    allPlayers.forEach(function(p) {
      if (!p.proTeamId) return;
      var isOut = isUnavailable(p);
      var isStarter = p.slotId < 12; // non-bench, non-IR fantasy slot
      if (isOut && isStarter) {
        teamInjuries[p.proTeamId] = (teamInjuries[p.proTeamId] || 0) + 1;
      }
    });

    // Build boost map: proTeamId -> multiplier
    var boostMap = {};
    Object.keys(teamInjuries).forEach(function(teamId) {
      if (teamInjuries[teamId] >= 2) {
        boostMap[teamId] = 1.15;
      }
    });

    return boostMap; // caller applies: boostMap[player.proTeamId] || 1.0
  }


  // ========== ENGINE 4: RECOMMENDATIONS (v3 FIX: smarter drops) ==========

  function isValidAddCandidate(player) {
    // Covers OUT, SUSPENSION, IR, INJURY_RESERVE and the other spellings
    // ESPN uses. This used to compare three literals, so INJURY_RESERVE
    // slipped through.
    if (isUnavailable(player)) return false;

    // No games and no projection means we have no basis for recommending
    // them over anyone else. Keeps them out of the chat and Larry's Move
    // free-agent lists as well, since both call through here.
    if (player.noEvidence) return false;

    // A player with no NBA team cannot play, so they can never help.
    // Westbrook, Chris Paul and D'Angelo Russell were all unsigned in the
    // snapshot and were being offered as pickups.
    if (!player.proTeamId) return false;

    var mpg = player.minutesPerGame || 0;
    var owned = player.percentOwned || 0;
    if (mpg < 5 && owned < 1) return false;

    var gp = player.gamesPlayed || 0;
    if (gp > 0) return true;

    var last7 = player.stats && player.stats.last7 ? player.stats.last7 : {};
    var hasLast7 = Object.keys(last7).some(function(k) { return last7[k] && last7[k] !== 0; });
    if (hasLast7) return true;

    // Nobody has played yet. Rejecting gp 0 outright meant the Streaming
    // page showed "No free agents available" with 500 free agents loaded,
    // and Larry's Move received zero of them. That would have persisted
    // through opening week, since on Oct 20 every free agent still has 0
    // games. A projection plus a real NBA team is enough to consider
    // someone addable.
    return !!v2ProjectedPerGame(player);
  }

  // Phase 1 v2 engine bridge. When useV2 is true, generateRecommendations
  // delegates to the bespoke G-score + team-fit engine bundled at
  // dist/larry-engine.js (global window.LarryEngine). When useV2 is false,
  // the legacy v1 path runs unchanged. Persisted in S.prefs so the toggle
  // survives reload.
  function v2Enabled() {
    if (S && S.prefs && typeof S.prefs.useV2Engine === 'boolean') return S.prefs.useV2Engine;
    return false;
  }

  function v2BuildPlayerProjection(p) {
    // Project the legacy player object into the shape src/shared/types.ts
    // PlayerProjection expects. The per-game derivation is shared with the
    // ranking so the two can never disagree about what a player produced.
    var perGame = v2PerGame(p);
    var positions = (p.positions || []).filter(function(pos) {
      return ['PG','SG','SF','PF','C'].indexOf(pos) >= 0;
    });
    return {
      id: String(p.id),
      name: p.name || ('Player ' + p.id),
      team: p.nbaTeam || '',
      positions: positions,
      gamesRemaining: p.gamesRemaining || 0,
      perGame: perGame,
      injuryStatus: p.injuryStatus || 'ACTIVE'
    };
  }

  function v2BuildContext(myPlayers, allPlayers) {
    var freeAgents = (allPlayers || [])
      .filter(function(p) { return p.onTeamId === 0 && isValidAddCandidate(p); })
      .map(v2BuildPlayerProjection);
    var myProj = (myPlayers || []).map(v2BuildPlayerProjection);
    // League-wide rosters keyed by team id. Each team's players are looked up
    // from allPlayers via onTeamId. This drives the team-need vector's stdev.
    var leaguePlayers = {};
    (S.teams || []).forEach(function(t) {
      var tid = String(t.teamId);
      leaguePlayers[tid] = (allPlayers || [])
        .filter(function(p) { return p.onTeamId === t.teamId; })
        .map(v2BuildPlayerProjection);
    });
    var Eng = window.LarryEngine;
    var source = Eng.createInMemoryProjectionSource(freeAgents, myProj);
    var leagueCats = (S.league && S.league.categories) ?
      S.league.categories.map(function(c){return c.abbr;}) :
      ['REB','AST','STL','BLK','PTS'];
    return {
      roster: { myPlayers: myProj, leaguePlayers: leaguePlayers },
      league: {
        size: (S.league && S.league.teamCount) || 12,
        scoringPeriod: (S.league && S.league.currentScoringPeriodId) || 0,
        currentMatchup: null,
        allCategories: leagueCats
      },
      projectionSource: source,
      mode: 'in-season'
    };
  }

  function v2ToLegacyRecs(output, myPlayers) {
    // Map RankedPlayer -> the legacy rec shape so renderAddDropTiles() does
    // not need to change. The v2 engine does not propose drops, so we pick
    // drop targets here.
    var sortedMy = (myPlayers || []).slice().sort(function(a, b) {
      return durantKey(a.effectiveDURANT) - durantKey(b.effectiveDURANT);
    });

    // CLAUDE.md: never suggest dropping a top-60% player. The legacy path
    // enforces this; the v2 path did not, so with the flag on Larry would
    // happily tell you to cut a starter. Droppable = bottom 40%, bench
    // first.
    var cutoff = Math.floor(sortedMy.length * 0.4);
    var droppable = [];
    for (var i = 0; i < sortedMy.length; i++) {
      if (i >= cutoff && cutoff > 0) break;
      if (sortedMy[i].slotId === 13) continue; // IR cannot simply be dropped
      droppable.push(sortedMy[i]);
    }
    // Prefer bench players when any are available.
    var bench = droppable.filter(function(p) { return p.slotId === 12; });
    if (bench.length) droppable = bench;
    if (!droppable.length && sortedMy.length) droppable = [sortedMy[0]];

    var top = (output.ranked || []).slice(0, 5);
    return top.map(function(rp, idx) {
      var why = (rp.breakdown.why || []).join(' ');
      // Distinct drop per suggestion where the roster allows it, matching
      // the legacy path's behavior rather than naming one player five times.
      var drop = droppable.length ? droppable[idx % droppable.length] : null;
      return {
        type: 'pickup',
        priority: idx === 0 ? 'high' : 'medium',
        action: drop ? ('Add ' + rp.player.name + ', Drop ' + drop.name) : ('Add ' + rp.player.name),
        detail: 'v2 score: ' + rp.breakdown.final.toFixed(2) +
                ' (G=' + rp.breakdown.gScore.toFixed(2) +
                ', fit=' + rp.breakdown.fitBonus.toFixed(2) + '). ' + why,
        player: rp.player,
        dropPlayer: drop,
        improvement: rp.breakdown.final
      };
    });
  }

  // Signature of a recommendation set, so we do not pay for an identical
  // explanation twice.
  function v2RecSignature(payload) {
    try {
      return JSON.stringify(payload).slice(0, 2000);
    } catch (e) {
      return '';
    }
  }

  var _v2RationaleSig = '';
  var _v2RationaleInFlight = false;

  function v2FetchRationale(payload) {
    if (typeof fetch !== 'function') return;

    // This fired on every render of the Add/Drop card, so scrolling the
    // Roster tab repeatedly billed an LLM call for the same five players.
    // Memoize on the rec-set signature and never run two at once.
    var sig = v2RecSignature(payload);
    if (!sig || sig === _v2RationaleSig || _v2RationaleInFlight) return;
    _v2RationaleSig = sig;
    _v2RationaleInFlight = true;

    // The old path was /api/recommend-explain, which Netlify does not route
    // anywhere: every call 404'd and the .catch swallowed it silently.
    fetch('/.netlify/functions/recommend-explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(res) { return res.ok ? res.json() : null; })
      .then(function(data) {
        if (!data || !data.rationale) return;
        S.matchup = S.matchup || {};
        S.matchup.lastV2Rationale = data.rationale;
        // Best-effort DOM merge: prepend a banner to the Add / Drop card.
        var headers = document.querySelectorAll('.card-header');
        for (var i = 0; i < headers.length; i++) {
          if ((headers[i].textContent || '').indexOf('Add / Drop') >= 0) {
            var card = headers[i].parentNode;
            var existing = card.querySelector('[data-v2-rationale]');
            var div = existing || document.createElement('div');
            div.setAttribute('data-v2-rationale', '1');
            div.style.cssText = 'padding:8px 12px;margin:8px 0;background:var(--bg-input);border-radius:8px;font-size:13px';
            div.textContent = 'Larry v2: ' + data.rationale;
            if (!existing) card.insertBefore(div, headers[i].nextSibling);
            break;
          }
        }
      })
      .catch(function() { /* best effort; the card renders fine without it */ })
      .then(function() { _v2RationaleInFlight = false; });
  }

  function v2GenerateRecommendations(myPlayers, allPlayers) {
    var Eng = window.LarryEngine;
    if (!Eng || typeof Eng.recommend !== 'function') {
      console.warn('LarryEngine v2 not loaded; falling back to v1');
      return null;
    }
    // Returning null anywhere here hands control back to the legacy path.
    // Previously an exception inside recommend() propagated out and killed
    // the whole Roster render instead of degrading to v1.
    try {
      var ctx = v2BuildContext(myPlayers, allPlayers);
      var output = Eng.recommend(ctx);
      if (!output || !output.ranked || !output.ranked.length) {
        console.warn('LarryEngine v2 returned no recommendations; falling back to v1');
        return null;
      }
      var recs = v2ToLegacyRecs(output, myPlayers);
      if (!recs.length) return null;
      try {
        v2FetchRationale(Eng.buildExplainPayload(output.ranked.slice(0, 5), output.teamNeeds));
      } catch (explainErr) {
        // The rationale is decoration; never let it break the recs.
      }
      return recs;
    } catch (e) {
      console.warn('LarryEngine v2 failed; falling back to v1:', e.message);
      return null;
    }
  }

  function generateRecommendations(myPlayers, allPlayers) {
    if (v2Enabled()) {
      var v2Recs = v2GenerateRecommendations(myPlayers, allPlayers);
      if (v2Recs && v2Recs.length) return v2Recs;
    }
    // Re-compute effectiveDURANT here using the full allPlayers pool.
    // computeDURANT may be called on a subset; we need the full pool for an
    // accurate boostMap. This overwrite is intentional.
    var boostMap = computeOpportunityBoost(allPlayers);

    allPlayers.forEach(function(p) {
      p.availability = computeAvailabilityScore(p);
      var boost = boostMap[p.proTeamId] || 1.0;
      p.effectiveDURANT = applyDurantHaircut(p.durantScore, p.availability * boost);
    });

    var cats = getOrderedCategories();
    var recs = [];
    if (!myPlayers || !myPlayers.length) return recs;

    // Matchup strategy: weight recommendations toward target categories
    var strat = S.matchup.strategy || {};
    var catWeights = strat.categoryWeights || {};
    var hasStrategy = Object.keys(catWeights).length > 0;
    var targetCats = strat.targets || [];

    // Sort my players by effectiveDURANT (worst first for drops)
    var sortedMy = myPlayers.slice().sort(function(a,b) { return durantKey(a.effectiveDURANT) - durantKey(b.effectiveDURANT); });

    // Get free agents sorted by effectiveDURANT (best first), filtered by hard criteria
    var freeAgents = allPlayers
      .filter(function(p) { return p.onTeamId === 0 && isValidAddCandidate(p); })
      .sort(function(a, b) { return durantKey(b.effectiveDURANT) - durantKey(a.effectiveDURANT); });

    // v3 FIX: Only recommend dropping bench players with low DURANT
    // Never recommend dropping top-50 ranked players
    var droppable = sortedMy.filter(function(p) {
      // Only bench (IR players cannot be simply dropped)
      if (p.slotId !== 12) return false;
      // Don't drop players ranked in top 60% of roster
      var rosterRank = sortedMy.indexOf(p);
      var threshold = Math.floor(sortedMy.length * 0.4);
      return rosterRank < threshold;
    });

    // Score every pickup/drop pair, then select. The old code pushed the
    // first five pairs it encountered while walking drops in the outer loop,
    // so all five tiles named the same drop target and often overlapped on
    // pickups too. Scoring first and selecting after is what makes the five
    // suggestions actually distinct.
    var candidates = [];
    droppable.forEach(function(dropCandidate) {
      freeAgents.forEach(function(pickup) {
        var durantImprovement = pickup.effectiveDURANT - dropCandidate.effectiveDURANT;

        // Matchup fit, scaled by DURANT_SCALE so it is comparable with
        // durantImprovement. matchupAdjustedValue sums weighted z-scores,
        // which live on a roughly +/-5 scale, while DURANT is that times 10.
        // Blending them raw let the DURANT term swamp the matchup term.
        var matchupImprovement = 0;
        if (hasStrategy) {
          matchupImprovement = (matchupAdjustedValue(pickup, catWeights) -
            matchupAdjustedValue(dropCandidate, catWeights)) * DURANT_SCALE;
        }

        // Blend 40/60 toward matchup fit when a strategy exists. Gate on the
        // blended value, not on durantImprovement: a pickup that is slightly
        // worse overall but much better in the categories actually in play
        // is a real recommendation, and the old `durantImprovement <= 0`
        // early-return threw those away before the blend was ever computed.
        var improvement = hasStrategy
          ? (durantImprovement * 0.4) + (matchupImprovement * 0.6)
          : durantImprovement;

        if (improvement > 2) {
          // Check category impact, highlighting target cats
          var catImpact = [];
          cats.forEach(function(cat) {
            var pickupZ = pickup.zScores ? pickup.zScores[cat.abbr] || 0 : 0;
            var dropZ = dropCandidate.zScores ? dropCandidate.zScores[cat.abbr] || 0 : 0;
            var isTarget = targetCats.indexOf(cat.abbr) >= 0;
            var prefix = isTarget ? '[TARGET]' : '';
            if (pickupZ > dropZ + 0.3) catImpact.push(prefix + '+' + cat.abbr);
            else if (pickupZ < dropZ - 0.3) catImpact.push(prefix + '-' + cat.abbr);
          });

          // Build detail with strategy context
          var detailParts = [];
          detailParts.push('DURANT: ' + durantText(pickup.durantScore, 1) + ' vs ' + durantText(dropCandidate.durantScore, 1));
          if (catImpact.length) {
            detailParts.push(catImpact.join(', '));
          }
          if (hasStrategy && targetCats.length) {
            // Count how many target cats this pickup helps
            var targetHelps = [];
            targetCats.forEach(function(tc) {
              var pz = pickup.zScores ? pickup.zScores[tc] || 0 : 0;
              var dz = dropCandidate.zScores ? dropCandidate.zScores[tc] || 0 : 0;
              if (pz > dz + 0.2) targetHelps.push(tc);
            });
            if (targetHelps.length) {
              detailParts.push('Helps targets: ' + targetHelps.join(', '));
            }
          }

          candidates.push({
            type: 'pickup',
            priority: improvement > 5 ? 'high' : 'medium',
            action: 'Add ' + pickup.name + ', Drop ' + dropCandidate.name,
            detail: detailParts.join('. ') + '.',
            player: pickup,
            dropPlayer: dropCandidate,
            improvement: improvement
          });
        }
      });
    });

    // Best first, then take the top 5 with a distinct pickup AND a distinct
    // drop. One suggestion per player on each side keeps the five tiles
    // genuinely different options rather than five spellings of one move.
    candidates.sort(compareRecs);
    var usedPickups = {};
    var usedDrops = {};
    for (var ci = 0; ci < candidates.length && recs.length < 5; ci++) {
      var c = candidates[ci];
      var pid = String(c.player.id);
      var did = String(c.dropPlayer.id);
      if (usedPickups[pid] || usedDrops[did]) continue;
      usedPickups[pid] = true;
      usedDrops[did] = true;
      recs.push(c);
    }

    // Streaming recommendations (for today's games), sorted by matchup fit
    var benchNoGame = myPlayers.filter(function(p) { return p.slotId === 12 && !p.gamesToday; });
    var faWithGame = freeAgents.filter(function(p) { return p.gamesToday; });
    if (hasStrategy) {
      faWithGame.sort(function(a, b) {
        return matchupAdjustedValue(b, catWeights) - matchupAdjustedValue(a, catWeights);
      });
    }
    faWithGame.slice(0, 3).forEach(function(fa) {
      if (benchNoGame.length && recs.length < 8) {
        var streamDetail = fa.nbaTeam + ' game. DURANT: ' + durantText(fa.durantScore, 1);
        if (hasStrategy && targetCats.length) {
          var helps = [];
          targetCats.forEach(function(tc) {
            var z = fa.zScores ? fa.zScores[tc] || 0 : 0;
            if (z > 0.3) helps.push(tc);
          });
          if (helps.length) streamDetail += '. Boosts ' + helps.join(', ');
        }
        recs.push({
          type: 'stream',
          priority: 'low',
          action: 'Stream ' + fa.name + ' (playing today)',
          detail: streamDetail,
          player: fa
        });
      }
    });

    recs.sort(compareRecs);
    return recs;
  }

  // One numeric key, so the ordering is total and transitive.
  //
  // The old comparator used fuzzy bands ("if the gap is more than 2, order
  // by improvement; otherwise fall through to ownership..."), which is not
  // transitive: A could tie B, B could tie C, and A still beat C. Array
  // sorts given an inconsistent comparator are free to produce any order,
  // and V8's does. Folding the tiebreakers into one score keeps the same
  // intent with a well-defined result.
  function recSortKey(rec) {
    var p = rec.player || {};
    return (rec.improvement || 0) +
      (p.percentOwned || 0) * 0.01 +
      (p.minutesPerGame || 0) * 0.001;
  }

  function compareRecs(a, b) {
    var diff = recSortKey(b) - recSortKey(a);
    if (diff !== 0) return diff;
    var an = (a.player && (a.player.lastName || a.player.name)) || '';
    var bn = (b.player && (b.player.lastName || b.player.name)) || '';
    return an < bn ? -1 : (an > bn ? 1 : 0);
  }


  // ========== ENGINE 5: TRADE ANALYZER ==========

  function analyzeTrade(givePlayers, getPlayers) {
    var cats = getOrderedCategories();
    var giveTotal = 0, getTotal = 0;
    var catDiffs = {};

    cats.forEach(function(cat) {
      var giveSum = 0, getSum = 0;
      givePlayers.forEach(function(p) {
        var e = enrichPlayer(p);
        giveSum += e.zScores ? e.zScores[cat.abbr] || 0 : 0;
      });
      getPlayers.forEach(function(p) {
        var e = enrichPlayer(p);
        getSum += e.zScores ? e.zScores[cat.abbr] || 0 : 0;
      });
      catDiffs[cat.abbr] = getSum - giveSum;
    });

    givePlayers.forEach(function(p) { giveTotal += enrichPlayer(p).durantScore || 0; });
    getPlayers.forEach(function(p) { getTotal += enrichPlayer(p).durantScore || 0; });

    // Raw value difference, kept for display.
    var netValue = getTotal - giveTotal;

    // Grade on category impact weighted by the current matchup strategy
    // rather than on raw DURANT totals. In H2H each-category, a trade that
    // loses overall value but converts a category you are already losing
    // into one you can win is a good trade; grading on summed DURANT called
    // that an F.
    var strat = (S.matchup && S.matchup.strategy) || {};
    var catWeights = strat.categoryWeights || {};
    var weightedImpact = 0;
    cats.forEach(function(cat) {
      var w = catWeights[cat.abbr];
      if (w === undefined) w = 1.0;
      var delta = catDiffs[cat.abbr];
      if (cat.isNegative) delta = -delta;
      weightedImpact += delta * w;
    });

    var grade = weightedImpact > 3 ? 'A' :
      weightedImpact > 1.5 ? 'B' :
      weightedImpact > -0.5 ? 'C' :
      weightedImpact > -2 ? 'D' : 'F';

    return {
      giveTotal: giveTotal,
      getTotal: getTotal,
      netValue: netValue,
      weightedImpact: weightedImpact,
      grade: grade,
      catDiffs: catDiffs
    };
  }


  // ========== ENGINE 6: PUNT ANALYSIS ==========

  function puntAnalysis() {
    var cats = getOrderedCategories();
    var myPlayers = S.myTeam.players || [];
    if (!myPlayers.length) return [];

    var results = [];
    cats.forEach(function(puntCat) {
      // Calculate team z-score sum excluding this category
      var teamZWithout = 0;
      var teamZWith = 0;
      myPlayers.forEach(function(p) {
        cats.forEach(function(cat) {
          var z = p.zScores ? p.zScores[cat.abbr] || 0 : 0;
          teamZWith += z;
          if (cat.abbr !== puntCat.abbr) teamZWithout += z;
        });
      });

      // How much we lose by keeping this cat
      var catContribution = teamZWith - teamZWithout;
      var teamRankInCat = getTeamCatRank(puntCat.abbr);

      results.push({
        cat: puntCat,
        contribution: catContribution,
        rank: teamRankInCat,
        viable: teamRankInCat > Math.ceil(S.league.teamCount * 0.6),
        gainFromPunt: teamZWithout / (cats.length - 1) - teamZWith / cats.length
      });
    });

    results.sort(function(a,b) { return b.gainFromPunt - a.gainFromPunt; });
    return results;
  }

  function getTeamCatRank(catAbbr) {
    if (!S.teams.length) return 0;
    var teamTotals = S.teams.map(function(t) {
      var sum = 0;
      (t.players || []).forEach(function(p) {
        if (p.slotId < 12 && p.stats && p.stats.season) sum += p.stats.season[catAbbr] || 0;
      });
      return { teamId: t.teamId, total: sum };
    });
    var cat = S.league.categories.find(function(c) { return c.abbr === catAbbr; });
    teamTotals.sort(function(a,b) {
      return cat && cat.isNegative ? a.total - b.total : b.total - a.total;
    });
    var myIdx = teamTotals.findIndex(function(t) { return t.teamId === S.myTeam.teamId; });
    return myIdx >= 0 ? myIdx + 1 : S.league.teamCount;
  }


  // ========== ENGINE 7: CATEGORY VOLATILITY ==========



  // ========== ENGINE 8: STREAK DETECTION ==========

  function detectStreaks(player) {
    var l7 = player.stats ? player.stats.last7 : null;
    var season = player.stats ? player.stats.season : null;
    if (!l7 || !season) return { trend: 'stable', label: 'Stable', cats: [] };

    // Same threshold as p.trend and Risers/Fallers. This used its own 0.2,
    // so a player could be "hot" on the roster tile and "stable" here.
    var d = trendDelta(player, 'last7', 'season');
    var upCats = d.up, downCats = d.down;

    if (upCats.length >= 3) return { trend: 'hot', label: 'Hot streak: ' + upCats.join(', ') + ' up', cats: upCats };
    if (downCats.length >= 3) return { trend: 'cold', label: 'Cold streak: ' + downCats.join(', ') + ' down', cats: downCats };
    if (upCats.length > downCats.length) return { trend: 'hot', label: 'Trending up in ' + upCats.join(', '), cats: upCats };
    if (downCats.length > upCats.length) return { trend: 'cold', label: 'Trending down in ' + downCats.join(', '), cats: downCats };
    return { trend: 'stable', label: 'Stable performance', cats: [] };
  }


  // ========== ENGINE 9: ROS PROJECTIONS (v3 FIX) ==========

  function rosProjections(players) {
    var cats = getOrderedCategories();
    // Fallback only: 82 games over a ~170-day season. The old code then
    // multiplied this by another 0.5 "because only half the days have
    // games", but 82/170 is already per team per day, so the extra halving
    // undercounted every projection.
    var now = new Date();
    var seasonEnd = new Date(now.getFullYear(), 3, 13); // approx April 13
    if (now > seasonEnd) seasonEnd = new Date(now.getFullYear() + 1, 3, 13);
    var daysLeft = Math.max(0, Math.ceil((seasonEnd - now) / (1000 * 60 * 60 * 24)));
    var fallbackGamesLeft = Math.round(daysLeft * (82 / 170));

    players.forEach(function(p) {
      p.rosProjection = {};
      // Rest of SEASON, so use the season-long count. This used to prefer
      // p.gamesRemaining, which is games left in the current WEEK, so every
      // season projection was built on about four games.
      var gamesLeft = p.gamesRemainingROS > 0 ? p.gamesRemainingROS : fallbackGamesLeft;

      var gp = p.gamesPlayed || 0;
      // The prior, same source the ranking uses, so the two agree.
      var projPg = v2ProjectedPerGame(p);
      // Blend observed production toward the projection exactly as the
      // ranking does. At gp 0 this is all projection, which is what fixes
      // "80 games left, 0 projected points".
      var w = gp > 0 ? gp / (gp + 8) : 0;
      var totals = (p.stats && p.stats.totals && p.stats.totals.season) || null;

      cats.forEach(function(cat) {
        var season = p.stats && p.stats.season ? p.stats.season[cat.abbr] : null;
        if (cat.isPercent) {
          // Rates do not accumulate; carry the current rate forward.
          p.rosProjection[cat.abbr] = season;
          return;
        }
        var l30 = p.stats && p.stats.last30 ? p.stats.last30[cat.abbr] : null;
        // Weight recent form, but keep the season as the anchor.
        var observed = null;
        if (season != null && l30 != null) observed = season * 0.6 + l30 * 0.4;
        else if (season != null) observed = season;
        else if (l30 != null) observed = l30;

        var prior = projPg ? projPg[cat.abbr] : null;

        // With no games played, the observed rate is 0 for everyone, which
        // is why Jokic showed 80 games left and a projection of 0 points.
        var perGame;
        if (gp === 0) {
          perGame = prior != null ? prior : observed;
        } else if (prior != null && observed != null) {
          perGame = w * observed + (1 - w) * prior;
        } else {
          perGame = observed != null ? observed : prior;
        }
        if (perGame == null) { p.rosProjection[cat.abbr] = null; return; }

        // Use the REAL banked totals when we have them. Reconstructing them
        // from the blended rate (gp * blendedRate) silently rewrote history
        // to match the projection.
        var banked;
        if (totals && typeof totals[cat.abbr] === 'number') {
          banked = totals[cat.abbr];
        } else {
          banked = gp * (observed != null ? observed : perGame);
        }
        p.rosProjection[cat.abbr] = banked + gamesLeft * perGame;
      });
      p.rosGamesLeft = gamesLeft;
    });
  }


  // ========== ENGINE 10: RISERS & FALLERS ==========

  // One definition of "trending", used by risersAndFallers, detectStreaks
  // and computeAllZScores. Three separate thresholds (0.15, 0.2, and a
  // capped average) used to disagree about the same player.
  var TREND_THRESHOLD = 0.15;

  // Average per-category change from a baseline split to a recent one, as a
  // signed fraction. Both splits are per-game, so this compares rates rather
  // than the old totals-vs-totals comparison, which made every player look
  // like +0% or -100% depending on sample size.
  function trendDelta(player, recentSplit, baseSplit) {
    var cats = getOrderedCategories();
    var stats = player.stats || {};
    var recent = stats[recentSplit || 'last7'];
    var base = stats[baseSplit || 'season'];
    if (!recent || !base) return { avgChange: 0, counted: 0, up: [], down: [] };
    var total = 0, counted = 0, up = [], down = [];
    for (var i = 0; i < cats.length; i++) {
      var cat = cats[i];
      if (cat.isPercent) continue;
      var bv = base[cat.abbr];
      var rv = recent[cat.abbr];
      if (bv == null || rv == null || bv === 0) continue;
      // Cap at +/-100% so one near-zero baseline cannot dominate the mean.
      var pct = Math.max(-1, Math.min(1, (rv - bv) / Math.abs(bv)));
      total += pct;
      counted++;
      if (pct > TREND_THRESHOLD) up.push(cat.abbr);
      else if (pct < -TREND_THRESHOLD) down.push(cat.abbr);
    }
    return {
      avgChange: counted > 0 ? total / counted : 0,
      counted: counted, up: up, down: down
    };
  }

  function trendLabel(avgChange) {
    if (avgChange > TREND_THRESHOLD) return 'hot';
    if (avgChange < -TREND_THRESHOLD) return 'cold';
    return 'stable';
  }

  function risersAndFallers(players, limit) {
    limit = limit || 10;

    var scored = [];
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (!p.stats || !p.stats.season || !p.stats.last7) continue;
      var d = trendDelta(p, 'last7', 'season');
      // A player with no comparable categories has no trend; including them
      // packed the fallers list with zeros.
      if (d.counted === 0) continue;
      scored.push({ player: p, avgChange: d.avgChange });
    }

    scored.sort(function(a, b) { return b.avgChange - a.avgChange; });
    var risers = scored.slice(0, limit);
    var fallers = scored.slice(-limit).reverse();

    return { risers: risers, fallers: fallers };
  }


  // ========== ENGINE 11: TRADE FINDER ==========

  // Rank every team in a category, 1 = best. Returns { teamId: rank }.
  // The old code decided a team was "weak" in a category when the z-sum of
  // its roster was negative, but z is centered on a starter-quality pool, so
  // a full 13-man roster sums negative almost everywhere. Every team looked
  // weak in everything, which is half of why this engine returned nothing
  // usable. Relative standing is the real question, so rank across teams.
  function teamCatRanks(catAbbr) {
    var cat = null;
    var leagueCats = (S.league && S.league.categories) || [];
    for (var c = 0; c < leagueCats.length; c++) {
      if (leagueCats[c].abbr === catAbbr) { cat = leagueCats[c]; break; }
    }
    var totals = (S.teams || []).map(function(t) {
      var sum = 0;
      (t.players || []).forEach(function(p) {
        if (p.slotId >= 12) return;
        var e = enrichPlayer(p);
        if (e.stats && e.stats.season) sum += e.stats.season[catAbbr] || 0;
      });
      return { teamId: t.teamId, total: sum };
    });
    totals.sort(function(a, b) {
      return cat && cat.isNegative ? a.total - b.total : b.total - a.total;
    });
    var ranks = {};
    for (var i = 0; i < totals.length; i++) ranks[totals[i].teamId] = i + 1;
    return ranks;
  }

  function findTrades(opts) {
    opts = opts || {};
    var myPlayers = S.myTeam.players || [];
    var cats = getOrderedCategories();
    var trades = [];
    var teamCount = (S.teams || []).length;
    if (!teamCount || !myPlayers.length) return trades;

    // Rank every team in every category once.
    var ranksByCat = {};
    cats.forEach(function(cat) { ranksByCat[cat.abbr] = teamCatRanks(cat.abbr); });

    // A team needs a category when it sits in the bottom half of the league.
    var midpoint = Math.ceil(teamCount / 2);
    function needsOf(teamId) {
      var needs = [];
      cats.forEach(function(cat) {
        var rank = ranksByCat[cat.abbr][teamId];
        if (rank && rank > midpoint) needs.push(cat.abbr);
      });
      return needs;
    }

    var myNeeds = needsOf(S.myTeam.teamId);

    // Net category gain for a side: what the incoming player adds in the
    // categories that side needs, minus what the outgoing player took with
    // them in those same categories.
    function categoryGain(incoming, outgoing, needs) {
      var gain = 0;
      for (var i = 0; i < needs.length; i++) {
        var cat = needs[i];
        var inZ = incoming.zScores ? incoming.zScores[cat] || 0 : 0;
        var outZ = outgoing.zScores ? outgoing.zScores[cat] || 0 : 0;
        gain += inZ - outZ;
      }
      return gain;
    }

    S.teams.forEach(function(team) {
      if (team.teamId === S.myTeam.teamId) return;
      if (!team.players || !team.players.length) return;
      var theirNeeds = needsOf(team.teamId);
      if (!theirNeeds.length && !myNeeds.length) return;

      myPlayers.forEach(function(myStub) {
        if (myStub.slotId === 13) return; // IR players cannot be traded here
        var myP = enrichPlayer(myStub);

        team.players.forEach(function(theirStub) {
          if (theirStub.slotId === 13) return;
          var theirP = enrichPlayer(theirStub);

          var ourGain = categoryGain(theirP, myP, myNeeds);
          var theirGain = categoryGain(myP, theirP, theirNeeds);
          if (ourGain <= 0 || theirGain <= 0) return; // must help both sides

          // Value they give up, from their perspective. Positive means we
          // are asking for the better player.
          var valueToUs = (theirP.durantScore || 0) - (myP.durantScore || 0);

          // Acceptance falls as we ask for more value, and rises with how
          // much the deal fixes their own weakness.
          //
          // The old formula was `50 + netDURANT * 2` with netDURANT = theirs
          // minus mine, so asking for a BETTER player made them MORE likely
          // to accept. The sign was inverted, which is the other half of why
          // this engine produced nothing sane.
          var acceptance = 50 - valueToUs * 1.5 + theirGain * 8;
          acceptance = Math.max(0, Math.min(100, acceptance));

          if (opts.minAcceptance && acceptance < opts.minAcceptance) return;

          trades.push({
            team: team,
            give: myP,
            get: theirP,
            netDURANT: valueToUs,
            ourGain: ourGain,
            theirGain: theirGain,
            acceptanceLikelihood: Math.round(acceptance),
            helpsUs: myNeeds.filter(function(c) {
              return (theirP.zScores ? theirP.zScores[c] || 0 : 0) >
                (myP.zScores ? myP.zScores[c] || 0 : 0);
            }),
            helpsThem: theirNeeds.filter(function(c) {
              return (myP.zScores ? myP.zScores[c] || 0 : 0) >
                (theirP.zScores ? theirP.zScores[c] || 0 : 0);
            })
          });
        });
      });
    });

    // Rank by how much the deal helps us, discounted by how unlikely it is
    // to be accepted. A great trade nobody would take is worth less than a
    // good one they might.
    trades.sort(function(a, b) {
      var sa = a.ourGain * (a.acceptanceLikelihood / 100);
      var sb = b.ourGain * (b.acceptanceLikelihood / 100);
      return sb - sa;
    });

    return trades.slice(0, 20);
  }


  // ========== ENGINE 12: MATCHUP STRATEGY ==========

  function computeMatchupStrategy() {
    var cats = getOrderedCategories();
    var strategy = { locks: [], targets: [], punts: [], categoryWeights: {}, summary: '' };
    if (!cats.length) { S.matchup.strategy = strategy; return strategy; }

    var myScores = S.matchup.myScores || {};
    var oppScores = S.matchup.oppScores || {};
    var myGR = S.matchup.myGamesRemaining || 0;
    var oppGR = S.matchup.oppGamesRemaining || 0;
    var hasScores = Object.keys(myScores).length > 0;

    // Get my team's per-game production by category (starters only)
    var myPlayers = (S.myTeam.players || []).filter(function(p) { return p.slotId < 12; });
    var oppTeam = S.teams.find(function(t) { return t.teamId === S.matchup.opponentTeamId; });
    var oppPlayers = oppTeam ? (oppTeam.players || []).filter(function(p) { return p.slotId < 12; }) : [];

    strategy.winProb = {};

    cats.forEach(function(cat) {
      var myNow = myScores[cat.abbr] || 0;
      var oppNow = oppScores[cat.abbr] || 0;

      // Project remaining production and its variance. Variance accumulates
      // per game, so a category decided over 25 remaining games is far less
      // certain than the same margin with 2 games left: that is the whole
      // reason to model it instead of scaling the margin.
      var myProj = projectSide(myPlayers, cat);
      var oppProj = projectSide(oppPlayers, cat);

      var myTotal = myNow + myProj.mean;
      var oppTotal = oppNow + oppProj.mean;
      var mean = cat.isNegative ? (oppTotal - myTotal) : (myTotal - oppTotal);
      var variance = myProj.variance + oppProj.variance;

      strategy.winProb[cat.abbr] = categoryWinProb(mean, variance);

      if (strategy.winProb[cat.abbr] > LOCK_THRESHOLD) {
        strategy.locks.push(cat.abbr);
        strategy.categoryWeights[cat.abbr] = 0.5;
      } else if (strategy.winProb[cat.abbr] < PUNT_THRESHOLD) {
        strategy.punts.push(cat.abbr);
        strategy.categoryWeights[cat.abbr] = 0.3;
      } else {
        strategy.targets.push(cat.abbr);
        strategy.categoryWeights[cat.abbr] = 2.0;
      }
    });

    // Build summary
    var parts = [];
    if (strategy.targets.length) parts.push('Target ' + strategy.targets.join(', '));
    if (strategy.locks.length) parts.push('Lock ' + strategy.locks.join(', '));
    if (strategy.punts.length) parts.push('Punt ' + strategy.punts.join(', '));
    strategy.summary = parts.join('. ');
    if (!strategy.summary) strategy.summary = 'No matchup data available.';

    S.matchup.strategy = strategy;
    return strategy;
  }


  // S.teams[].players and S.myTeam.players are separate deserialized copies
  // of the same players, and only S.allPlayers gets refreshed with ranks,
  // z-scores and schedules. Resolve a roster stub to the live object so
  // consumers do not silently read a stale shell.
  function enrichPlayer(stub) {
    if (!stub || !S || !S.allPlayers) return stub;
    var id = stub.id;
    for (var i = 0; i < S.allPlayers.length; i++) {
      if (S.allPlayers[i].id === id) return S.allPlayers[i];
    }
    return stub;
  }

  // Lock above 70% win probability, punt below 30%, target in between.
  var LOCK_THRESHOLD = 0.70;
  var PUNT_THRESHOLD = 0.30;

  // Per-game standard deviation as a fraction of a player's own per-game
  // mean. Blocks and steals are spiky (a player averaging 1.0 blocks swings
  // between 0 and 3 nightly); points and rebounds are comparatively smooth.
  // These are proxies until gamelogs land and we can measure per-player
  // variance directly.
  var CATEGORY_CV = { REB: 0.45, AST: 0.50, STL: 0.85, BLK: 0.95, PTS: 0.35 };
  var DEFAULT_CV = 0.60;

  // Standard normal CDF via the Abramowitz and Stegun 7.1.26 erf
  // approximation. Accurate to ~1e-7, which is far finer than anything that
  // depends on it here.
  function normalCDF(z) {
    var sign = z < 0 ? -1 : 1;
    var x = Math.abs(z) / Math.sqrt(2);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
      0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return 0.5 * (1 + sign * y);
  }

  // Projected remaining production for one side of a category: the sum of
  // each player's per-game rate times their games left, with variance
  // accumulating per game.
  function projectSide(players, cat) {
    var mean = 0;
    var variance = 0;
    var cv = CATEGORY_CV[cat.abbr] || DEFAULT_CV;
    for (var i = 0; i < players.length; i++) {
      var p = enrichPlayer(players[i]);
      var games = p.gamesRemaining || 0;
      if (games <= 0) continue;
      var perGame = p.stats && p.stats.season ? (p.stats.season[cat.abbr] || 0) : 0;
      mean += perGame * games;
      var sd = perGame * cv;
      variance += sd * sd * games;
    }
    return { mean: mean, variance: variance };
  }

  // Probability that a projected margin ends up positive. With no variance
  // the outcome is already decided, so collapse to a hard 0/1/0.5.
  function categoryWinProb(mean, variance) {
    if (variance <= 0) return mean > 0 ? 1 : (mean < 0 ? 0 : 0.5);
    var p = normalCDF(mean / Math.sqrt(variance));
    // Never claim certainty: injuries and rest days are not in the model.
    return Math.min(0.97, Math.max(0.03, p));
  }

  // ========== MATCHUP-ADJUSTED VALUE HELPER ==========

  function matchupAdjustedValue(player, catWeights) {
    var cats = getOrderedCategories();
    var score = 0;
    cats.forEach(function(cat) {
      var z = player.zScores ? player.zScores[cat.abbr] || 0 : 0;
      var w = catWeights[cat.abbr] || 1.0;
      score += z * w;
    });
    return score;
  }


  // ========== PUBLIC API ==========

  return {
    computeAllZScores: computeAllZScores,
    computeDURANT: computeDURANT,
    ensureDURANT: ensureDURANT,
    enrichPlayer: enrichPlayer,
    isValidAddCandidate: isValidAddCandidate,
    isUnavailable: isUnavailable,
    normalizeInjuryStatus: normalizeInjuryStatus,
    trendDelta: trendDelta,
    trendLabel: trendLabel,
    normalCDF: normalCDF,
    categoryWinProb: categoryWinProb,
    generateRecommendations: generateRecommendations,
    analyzeTrade: analyzeTrade,
    puntAnalysis: puntAnalysis,
    detectStreaks: detectStreaks,
    rosProjections: rosProjections,
    v2BaseValueInput: v2BaseValueInput,
    v2ProjectedGP: v2ProjectedGP,
    v2ProjectionSuspect: v2ProjectionSuspect,
    v2ProjectedRate: v2ProjectedRate,
    v2PreseasonInput: v2PreseasonInput,
    risersAndFallers: risersAndFallers,
    findTrades: findTrades,
    getTeamCatRank: getTeamCatRank,
    getBlendedStat: getBlendedStat,
    computeMatchupStrategy: computeMatchupStrategy,
    matchupAdjustedValue: matchupAdjustedValue
  };
})();
