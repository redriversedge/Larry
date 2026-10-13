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

      // Trend detection
      var l7 = p.stats && p.stats.last7 ? p.stats.last7 : null;
      var season = p.stats && p.stats.season ? p.stats.season : null;
      if (l7 && season) {
        var diffs = [];
        cats.forEach(function(cat) {
          if (cat.isPercent) return;
          var s = season[cat.abbr]; var r = l7[cat.abbr];
          if (s && r && s !== 0) diffs.push((r - s) / Math.abs(s));
        });
        var avgDiff = diffs.length ? diffs.reduce(function(a,b){return a+b;},0) / diffs.length : 0;
        p.trend = avgDiff > 0.15 ? 'hot' : (avgDiff < -0.15 ? 'cold' : 'stable');
      }

      // Frustration value
      var frustDiffs = [];
      cats.forEach(function(cat) {
        var sv = season ? season[cat.abbr] : null;
        var rv = l7 ? l7[cat.abbr] : null;
        if (sv !== null && sv !== 0 && rv !== null) {
          frustDiffs.push(Math.pow((rv - sv) / Math.max(Math.abs(sv), 0.1), 2));
        }
      });
      p.frustrationValue = frustDiffs.length ? Math.min(10, Math.sqrt(frustDiffs.reduce(function(a,b){return a+b;},0) / frustDiffs.length) * 5) : 0;
    });

    return catStats;
  }

  function getBlendedStat(player, catAbbr, period, recencyWeight) {
    if (!recencyWeight || period !== 'season') {
      return player.stats && player.stats[period] ? player.stats[period][catAbbr] : null;
    }
    var season = player.stats && player.stats.season ? player.stats.season[catAbbr] : null;
    var recent = player.stats && player.stats.last30 ? player.stats.last30[catAbbr] : null;
    if (season === null) return recent;
    if (recent === null) return season;
    return season * (1 - recencyWeight) + recent * recencyWeight;
  }

  // ========== ENGINE 2: MONTE CARLO (v3 FIX: forward projection) ==========

  function monteCarloMatchup(myPlayers, oppPlayers, gamesRemainingMap, simulations) {
    simulations = simulations || 5000;
    var cats = getOrderedCategories();

    // If no games remaining data at all, use a reasonable default
    var hasAnyGames = false;
    if (gamesRemainingMap) {
      Object.keys(gamesRemainingMap).forEach(function(k) {
        if (gamesRemainingMap[k] > 0) hasAnyGames = true;
      });
    }
    if (!hasAnyGames) {
      // Fallback: estimate 2 games remaining per player
      myPlayers.concat(oppPlayers).forEach(function(p) {
        if (!gamesRemainingMap) gamesRemainingMap = {};
        gamesRemainingMap[p.id] = 2;
      });
    }
    var results = {};
    cats.forEach(function(cat) { results[cat.abbr] = { wins: 0, losses: 0, ties: 0 }; });

    // v3 FIX: Use current matchup scores as base, then project REMAINING games
    var currentMyScores = S.matchup.myScores || {};
    var currentOppScores = S.matchup.oppScores || {};

    function playerVariance(p, cat) {
      var season = p.stats && p.stats.season ? p.stats.season[cat.abbr] : 0;
      var l7 = p.stats && p.stats.last7 ? p.stats.last7[cat.abbr] : season;
      if (!season) return 0.3;
      return Math.min(0.8, Math.abs(l7 - season) / Math.max(Math.abs(season), 0.1));
    }

    function gaussianRandom() {
      var u1 = Math.random(), u2 = Math.random();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    for (var sim = 0; sim < simulations; sim++) {
      cats.forEach(function(cat) {
        // v3: Start from current scores, add projected remaining production
        var myTotal = currentMyScores[cat.abbr] || 0;
        var oppTotal = currentOppScores[cat.abbr] || 0;

        // Project remaining games for my players
        myPlayers.forEach(function(p) {
          if (p.slotId === 13) return; // Skip IR
          var avg = p.stats && p.stats.season ? (p.stats.season[cat.abbr] || 0) : 0;
          var gamesLeft = (gamesRemainingMap && gamesRemainingMap[p.id]) ? gamesRemainingMap[p.id] : 0;
          if (gamesLeft <= 0 || avg === 0) return;

          var v = playerVariance(p, cat);
          for (var g = 0; g < gamesLeft; g++) {
            var noise = 1 + gaussianRandom() * v;
            myTotal += avg * Math.max(0, noise);
          }
        });

        // Project remaining games for opponent players
        oppPlayers.forEach(function(p) {
          if (p.slotId === 13) return;
          var avg = p.stats && p.stats.season ? (p.stats.season[cat.abbr] || 0) : 0;
          var gamesLeft = (gamesRemainingMap && gamesRemainingMap[p.id]) ? gamesRemainingMap[p.id] : 0;
          if (gamesLeft <= 0 || avg === 0) return;

          var v = playerVariance(p, cat);
          for (var g = 0; g < gamesLeft; g++) {
            var noise = 1 + gaussianRandom() * v;
            oppTotal += avg * Math.max(0, noise);
          }
        });

        // Compare
        if (cat.isPercent) {
          // For percentages, compare directly
          if (myTotal > oppTotal) results[cat.abbr].wins++;
          else if (myTotal < oppTotal) results[cat.abbr].losses++;
          else results[cat.abbr].ties++;
        } else if (cat.isNegative) {
          if (myTotal < oppTotal) results[cat.abbr].wins++;
          else if (myTotal > oppTotal) results[cat.abbr].losses++;
          else results[cat.abbr].ties++;
        } else {
          if (myTotal > oppTotal) results[cat.abbr].wins++;
          else if (myTotal < oppTotal) results[cat.abbr].losses++;
          else results[cat.abbr].ties++;
        }
      });
    }

    // Convert to probabilities
    var probs = {};
    cats.forEach(function(cat) {
      var r = results[cat.abbr];
      probs[cat.abbr] = {
        win: Math.round(r.wins / simulations * 100),
        lose: Math.round(r.losses / simulations * 100),
        tie: Math.round(r.ties / simulations * 100)
      };
    });
    return probs;
  }


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
      perGame: v2PerGame(p)
    };
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
    var inputs = players.map(v2BaseValueInput);
    var result = Eng.computeBaseValues(inputs, {
      categories: cats,
      rosterSize: v2RosterSize()
    });

    var rowById = {};
    result.rows.forEach(function(row) { rowById[row.id] = row; });

    players.forEach(function(p) {
      var row = rowById[String(p.id)];
      if (!row) { p.durantScore = 0; return; }
      // Scaled by 10 to sit on the same range as the old zTotal * 10 score,
      // because the +3 free agent gap in tabs.js and the trade acceptance
      // margin here are absolute numbers tuned against it.
      p.durantScore = row.baseValue * scale;
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

    // Rank
    players.sort(function(a,b) { return (b.durantScore || 0) - (a.durantScore || 0); });
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
  function applyDurantHaircut(score, factor) {
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
    var injuryFactor = (status === 'GTD' || status === 'DAY_TO_DAY' || status === 'GAME_TIME_DECISION') ? 0.85 : 1.0;

    return mpgFactor * ownershipFactor * recentActivityFactor * injuryFactor;
  }


  // ========== ENGINE 3.6: OPPORTUNITY BOOST ==========

  function computeOpportunityBoost(allPlayers) {
    // Count OUT/IR starters per NBA team (proTeamId)
    var teamInjuries = {};
    allPlayers.forEach(function(p) {
      if (!p.proTeamId) return;
      var isOut = p.injuryStatus === 'OUT' || p.injuryStatus === 'IR';
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
    var status = player.injuryStatus || 'ACTIVE';
    if (status === 'OUT' || status === 'SUSPENSION' || status === 'IR') return false;
    var mpg = player.minutesPerGame || 0;
    var owned = player.percentOwned || 0;
    if (mpg < 5 && owned < 1) return false;
    var gp = player.gamesPlayed || 0;
    var last7 = player.stats && player.stats.last7 ? player.stats.last7 : {};
    var hasLast7 = Object.keys(last7).some(function(k) { return last7[k] && last7[k] !== 0; });
    if (gp === 0 && !hasLast7) return false;
    return true;
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
    // Map RankedPlayer -> the legacy rec shape so the existing
    // renderAddDropTiles() does not need to change. We pick a drop target
    // (worst bench player by effectiveDURANT) just so the UI fields are
    // populated; the v2 engine itself does not currently propose drops.
    var sortedMy = (myPlayers || []).slice().sort(function(a,b) {
      return (a.effectiveDURANT || 0) - (b.effectiveDURANT || 0);
    });
    var drop = sortedMy.find(function(p) { return p.slotId === 12; }) || sortedMy[0] || null;
    var top = (output.ranked || []).slice(0, 5);
    return top.map(function(rp, idx) {
      var why = (rp.breakdown.why || []).join(' ');
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

  function v2FetchRationale(payload) {
    if (typeof fetch !== 'function') return;
    fetch('/api/recommend-explain', {
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
      .catch(function() { /* ignore */ });
  }

  function v2GenerateRecommendations(myPlayers, allPlayers) {
    var Eng = window.LarryEngine;
    if (!Eng || typeof Eng.recommend !== 'function') {
      console.warn('LarryEngine v2 not loaded; falling back to v1');
      return null;
    }
    var ctx = v2BuildContext(myPlayers, allPlayers);
    var output = Eng.recommend(ctx);
    var recs = v2ToLegacyRecs(output, myPlayers);
    var payload = Eng.buildExplainPayload(output.ranked.slice(0, 5), output.teamNeeds);
    v2FetchRationale(payload);
    return recs;
  }

  function generateRecommendations(myPlayers, allPlayers) {
    if (v2Enabled()) {
      var v2Recs = v2GenerateRecommendations(myPlayers, allPlayers);
      if (v2Recs) return v2Recs;
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
    var sortedMy = myPlayers.slice().sort(function(a,b) { return (a.effectiveDURANT || 0) - (b.effectiveDURANT || 0); });

    // Get free agents sorted by effectiveDURANT (best first), filtered by hard criteria
    var freeAgents = allPlayers
      .filter(function(p) { return p.onTeamId === 0 && isValidAddCandidate(p); })
      .sort(function(a, b) { return b.effectiveDURANT - a.effectiveDURANT; });

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

    // For each droppable player, see if a free agent would be an upgrade
    droppable.forEach(function(dropCandidate) {
      freeAgents.forEach(function(pickup) {
        if (recs.length >= 5) return;
        var durantImprovement = pickup.effectiveDURANT - dropCandidate.effectiveDURANT;
        if (durantImprovement <= 0) return;

        // Compute matchup-adjusted improvement (weighted by target categories)
        var matchupImprovement = 0;
        if (hasStrategy) {
          matchupImprovement = matchupAdjustedValue(pickup, catWeights) - matchupAdjustedValue(dropCandidate, catWeights);
        }

        // Blend: 40% overall value, 60% matchup fit (or 100% overall if no strategy)
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
          detailParts.push('DURANT: ' + fmt(pickup.durantScore || 0, 1) + ' vs ' + fmt(dropCandidate.durantScore || 0, 1));
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

          recs.push({
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
        var streamDetail = fa.nbaTeam + ' game. DURANT: ' + fmt(fa.durantScore || 0, 1);
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

    // Sort by improvement, with tiebreaker chain
    recs.sort(function(a, b) {
      var diff = (b.improvement || 0) - (a.improvement || 0);
      if (Math.abs(diff) > 2) return diff;
      // Tiebreaker: ownership, then MPG, then alphabetical
      var ownDiff = (b.player.percentOwned || 0) - (a.player.percentOwned || 0);
      if (Math.abs(ownDiff) > 0.5) return ownDiff;
      var mpgDiff = (b.player.minutesPerGame || 0) - (a.player.minutesPerGame || 0);
      if (Math.abs(mpgDiff) > 1) return mpgDiff;
      return (a.player.lastName || a.player.name || '').localeCompare(b.player.lastName || b.player.name || '');
    });
    return recs;
  }


  // ========== ENGINE 5: TRADE ANALYZER ==========

  function analyzeTrade(givePlayers, getPlayers) {
    var cats = getOrderedCategories();
    var giveTotal = 0, getTotal = 0;
    var catDiffs = {};

    cats.forEach(function(cat) {
      var giveSum = 0, getSum = 0;
      givePlayers.forEach(function(p) { giveSum += p.zScores ? p.zScores[cat.abbr] || 0 : 0; });
      getPlayers.forEach(function(p) { getSum += p.zScores ? p.zScores[cat.abbr] || 0 : 0; });
      catDiffs[cat.abbr] = getSum - giveSum;
    });

    givePlayers.forEach(function(p) { giveTotal += p.durantScore || 0; });
    getPlayers.forEach(function(p) { getTotal += p.durantScore || 0; });

    var netValue = getTotal - giveTotal;
    var grade = netValue > 10 ? 'A' : netValue > 5 ? 'B' : netValue > 0 ? 'C' : netValue > -5 ? 'D' : 'F';

    return {
      giveTotal: giveTotal,
      getTotal: getTotal,
      netValue: netValue,
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

  function categoryVolatility(players) {
    var cats = getOrderedCategories();
    var vol = {};
    cats.forEach(function(cat) {
      var diffs = [];
      players.forEach(function(p) {
        var season = p.stats && p.stats.season ? p.stats.season[cat.abbr] : null;
        var l7 = p.stats && p.stats.last7 ? p.stats.last7[cat.abbr] : null;
        if (season !== null && l7 !== null && season !== 0) {
          diffs.push(Math.abs(l7 - season) / Math.max(Math.abs(season), 0.1));
        }
      });
      var avg = diffs.length ? diffs.reduce(function(a,b){return a+b;},0) / diffs.length : 0;
      var label = avg > 0.3 ? 'High' : (avg > 0.15 ? 'Medium' : 'Low');
      vol[cat.abbr] = { value: avg, label: label };
    });
    return vol;
  }


  // ========== ENGINE 8: STREAK DETECTION ==========

  function detectStreaks(player) {
    var cats = getOrderedCategories();
    var l7 = player.stats ? player.stats.last7 : null;
    var season = player.stats ? player.stats.season : null;
    if (!l7 || !season) return { trend: 'stable', label: 'Stable', cats: [] };

    var upCats = [], downCats = [];
    cats.forEach(function(cat) {
      if (cat.isPercent) return;
      var sv = season[cat.abbr] || 0;
      var rv = l7[cat.abbr] || 0;
      if (sv === 0) return;
      var pctChange = (rv - sv) / Math.abs(sv);
      if (pctChange > 0.2) upCats.push(cat.abbr);
      else if (pctChange < -0.2) downCats.push(cat.abbr);
    });

    if (upCats.length >= 3) return { trend: 'hot', label: 'Hot streak: ' + upCats.join(', ') + ' up', cats: upCats };
    if (downCats.length >= 3) return { trend: 'cold', label: 'Cold streak: ' + downCats.join(', ') + ' down', cats: downCats };
    if (upCats.length > downCats.length) return { trend: 'hot', label: 'Trending up in ' + upCats.join(', '), cats: upCats };
    if (downCats.length > upCats.length) return { trend: 'cold', label: 'Trending down in ' + downCats.join(', '), cats: downCats };
    return { trend: 'stable', label: 'Stable performance', cats: [] };
  }


  // ========== ENGINE 9: ROS PROJECTIONS (v3 FIX) ==========

  function rosProjections(players) {
    var cats = getOrderedCategories();
    // Estimate games remaining in season (rough: ~82 game season, ~170 day season)
    var now = new Date();
    var seasonEnd = new Date(now.getFullYear(), 3, 13); // April 13 approx
    if (now > seasonEnd) seasonEnd = new Date(now.getFullYear() + 1, 3, 13);
    var daysLeft = Math.max(0, Math.ceil((seasonEnd - now) / (1000*60*60*24)));
    var avgGamesPerDay = 82 / 170;

    players.forEach(function(p) {
      p.rosProjection = {};
      // Estimate remaining games for this player
      var estGamesLeft = Math.round(daysLeft * avgGamesPerDay * 0.5); // ~half the days have games for any team
      if (p.gamesRemaining > 0) estGamesLeft = p.gamesRemaining;
      else if (p.gamesRemainingROS > 0) estGamesLeft = p.gamesRemainingROS;

      // v3 FIX: Use blended recent + season stats for projection
      cats.forEach(function(cat) {
        if (cat.isPercent) {
          // Percentages don't accumulate
          var season = p.stats && p.stats.season ? p.stats.season[cat.abbr] : null;
          p.rosProjection[cat.abbr] = season;
          return;
        }
        var season = p.stats && p.stats.season ? p.stats.season[cat.abbr] : null;
        var l30 = p.stats && p.stats.last30 ? p.stats.last30[cat.abbr] : null;
        var avg = null;
        if (season !== null && l30 !== null) avg = season * 0.6 + l30 * 0.4;
        else if (season !== null) avg = season;
        else if (l30 !== null) avg = l30;

        if (avg !== null && estGamesLeft > 0) {
          // Current totals + projected remaining
          var currentTotal = (p.gamesPlayed || 0) * avg;
          var projectedRemaining = estGamesLeft * avg;
          p.rosProjection[cat.abbr] = currentTotal + projectedRemaining;
        } else {
          p.rosProjection[cat.abbr] = null;
        }
      });
      p.rosGamesLeft = estGamesLeft;
    });
  }


  // ========== ENGINE 10: RISERS & FALLERS ==========

  function risersAndFallers(players, limit) {
    limit = limit || 10;
    var cats = getOrderedCategories();

    var scored = players.filter(function(p) {
      return p.stats && p.stats.season && p.stats.last7;
    }).map(function(p) {
      var totalPctChange = 0;
      var counted = 0;
      cats.forEach(function(cat) {
        if (cat.isPercent) return;
        var sv = p.stats.season[cat.abbr] || 0;
        var rv = p.stats.last7[cat.abbr] || 0;
        if (sv !== 0) {
          // v3 FIX: Cap percentage change to avoid >100%
          var pctChange = Math.max(-1, Math.min(1, (rv - sv) / Math.abs(sv)));
          totalPctChange += pctChange;
          counted++;
        }
      });
      return { player: p, avgChange: counted > 0 ? totalPctChange / counted : 0 };
    });

    scored.sort(function(a,b) { return b.avgChange - a.avgChange; });
    var risers = scored.slice(0, limit);
    var fallers = scored.slice(-limit).reverse();

    return { risers: risers, fallers: fallers };
  }


  // ========== ENGINE 11: TRADE FINDER ==========

  function findTrades(opts) {
    opts = opts || {};
    var myPlayers = S.myTeam.players || [];
    var cats = getOrderedCategories();
    var trades = [];

    // Find categories where we're weak
    var weakCats = [];
    cats.forEach(function(cat) {
      var rank = getTeamCatRank(cat.abbr);
      if (rank > Math.ceil(S.league.teamCount / 2)) weakCats.push(cat.abbr);
    });

    // For each other team, find mutually beneficial trades
    S.teams.forEach(function(team) {
      if (team.teamId === S.myTeam.teamId) return;
      if (!team.players || !team.players.length) return;

      // What are they weak in?
      var theirWeakCats = [];
      cats.forEach(function(cat) {
        var theirTeamPlayers = team.players || [];
        var theirSum = 0;
        theirTeamPlayers.forEach(function(p) {
          theirSum += p.zScores ? p.zScores[cat.abbr] || 0 : 0;
        });
        // Rough: if their total z is negative, they're weak
        if (theirSum < 0) theirWeakCats.push(cat.abbr);
      });

      // Find our players strong in their weak cats
      myPlayers.forEach(function(myP) {
        if (myP.slotId === 13) return; // Skip IR
        var myStrengthForThem = 0;
        theirWeakCats.forEach(function(cat) {
          myStrengthForThem += myP.zScores ? myP.zScores[cat] || 0 : 0;
        });

        (team.players || []).forEach(function(theirP) {
          if (theirP.slotId === 13) return;
          var theirStrengthForUs = 0;
          weakCats.forEach(function(cat) {
            theirStrengthForUs += theirP.zScores ? theirP.zScores[cat] || 0 : 0;
          });

          // Both sides benefit?
          if (myStrengthForThem > 1 && theirStrengthForUs > 1) {
            var netDURANT = (theirP.durantScore || 0) - (myP.durantScore || 0);
            // v3 FIX: Filter by 50%+ acceptance likelihood
            var acceptanceLikelihood = 50 + netDURANT * 2; // rough heuristic
            acceptanceLikelihood = Math.max(0, Math.min(100, acceptanceLikelihood));

            if (!opts.minAcceptance || acceptanceLikelihood >= opts.minAcceptance) {
              trades.push({
                team: team,
                give: myP,
                get: theirP,
                netDURANT: netDURANT,
                acceptanceLikelihood: Math.round(acceptanceLikelihood),
                helpsUs: weakCats.filter(function(c) {
                  return (theirP.zScores ? theirP.zScores[c] || 0 : 0) > (myP.zScores ? myP.zScores[c] || 0 : 0);
                }),
                helpsThem: theirWeakCats.filter(function(c) {
                  return (myP.zScores ? myP.zScores[c] || 0 : 0) > (theirP.zScores ? theirP.zScores[c] || 0 : 0);
                })
              });
            }
          }
        });
      });
    });

    // Sort by net benefit
    trades.sort(function(a,b) {
      return (b.acceptanceLikelihood + (b.helpsUs.length * 10)) - (a.acceptanceLikelihood + (a.helpsUs.length * 10));
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

    cats.forEach(function(cat) {
      var myNow = myScores[cat.abbr] || 0;
      var oppNow = oppScores[cat.abbr] || 0;
      var margin = cat.isNegative ? (oppNow - myNow) : (myNow - oppNow);

      // Project remaining production
      var myRemaining = 0;
      myPlayers.forEach(function(p) {
        var avg = p.stats && p.stats.season ? (p.stats.season[cat.abbr] || 0) : 0;
        myRemaining += avg * (p.gamesRemaining || 0);
      });
      var oppRemaining = 0;
      oppPlayers.forEach(function(p) {
        var enriched = S.allPlayers.find(function(ap) { return ap.id === p.id; }) || p;
        var avg = enriched.stats && enriched.stats.season ? (enriched.stats.season[cat.abbr] || 0) : 0;
        oppRemaining += avg * (enriched.gamesRemaining || p.gamesRemaining || 0);
      });

      var projectedMargin;
      if (cat.isNegative) {
        projectedMargin = (oppNow + oppRemaining) - (myNow + myRemaining);
      } else {
        projectedMargin = (myNow + myRemaining) - (oppNow + oppRemaining);
      }

      // Win probability from projected margin as percentage of total production
      var projMyTotal = cat.isNegative ? (oppNow + oppRemaining) : (myNow + myRemaining);
      var projOppTotal = cat.isNegative ? (myNow + myRemaining) : (oppNow + oppRemaining);
      var totalProduction = projMyTotal + projOppTotal;
      var winProb = 50;
      if (totalProduction > 0) {
        var marginPct = projectedMargin / (totalProduction / 2);
        winProb = Math.round(Math.min(95, Math.max(5, 50 + marginPct * 30)));
      }

      if (winProb > 70) {
        strategy.locks.push(cat.abbr);
        strategy.categoryWeights[cat.abbr] = 0.5;
      } else if (winProb < 30) {
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
    monteCarloMatchup: monteCarloMatchup,
    generateRecommendations: generateRecommendations,
    analyzeTrade: analyzeTrade,
    puntAnalysis: puntAnalysis,
    categoryVolatility: categoryVolatility,
    detectStreaks: detectStreaks,
    rosProjections: rosProjections,
    risersAndFallers: risersAndFallers,
    findTrades: findTrades,
    getTeamCatRank: getTeamCatRank,
    getBlendedStat: getBlendedStat,
    computeMatchupStrategy: computeMatchupStrategy,
    matchupAdjustedValue: matchupAdjustedValue
  };
})();
