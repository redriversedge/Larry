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

    // Scarcity weighting
    var cvs = [];
    cats.forEach(function(cat) {
      var cs = catStats[cat.abbr];
      cs.cv = cs.mean !== 0 ? cs.stdDev / Math.abs(cs.mean) : 1;
      cvs.push(cs.cv);
    });
    var maxCV = Math.max.apply(null, cvs) || 1;
    cats.forEach(function(cat) {
      catStats[cat.abbr].scarcity = 0.5 + 0.5 * (catStats[cat.abbr].cv / maxCV);
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


  // ========== ENGINE 3: DURANT RANKING ==========

  function computeDURANT(players, opts) {
    opts = opts || {};
    var cats = getOrderedCategories();
    computeAllZScores(players, 'season');

    players.forEach(function(p) {
      var zTotal = p.zScores ? p.zScores.total || 0 : 0;
      var gamesRemaining = p.gamesRemaining || 0;
      var gp = p.gamesPlayed || 0;
      var trendBonus = p.trend === 'hot' ? 0.15 : (p.trend === 'cold' ? -0.10 : 0);

      // Scarcity bonus for rare position production
      var scarcityBonus = 0;
      cats.forEach(function(cat) {
        var z = p.zScores ? p.zScores[cat.abbr] || 0 : 0;
        if (z > 1.5) scarcityBonus += 0.05 * z;
      });

      // Schedule factor (games remaining vs average)
      var avgGamesRemaining = 0;
      var countForAvg = 0;
      players.forEach(function(pl) {
        if (pl.gamesRemaining > 0) { avgGamesRemaining += pl.gamesRemaining; countForAvg++; }
      });
      avgGamesRemaining = countForAvg > 0 ? avgGamesRemaining / countForAvg : 3;
      var schedFactor = avgGamesRemaining > 0 ? (gamesRemaining / avgGamesRemaining) : 1;
      schedFactor = Math.max(0.5, Math.min(1.5, schedFactor));

      // v3 FIX: Weight z-score heavily, factor in games + trend + scarcity
      p.durantScore = (zTotal * 10 * schedFactor) + (trendBonus * 10) + scarcityBonus;

      // Reliability factor (more games = more reliable)
      if (gp < 10) p.durantScore *= 0.7;
      else if (gp < 20) p.durantScore *= 0.85;

      // Injury discount
      if (p.status === 'OUT' || p.status === 'SUSPENSION') p.durantScore *= 0.3;
      else if (p.status === 'GTD' || p.status === 'DAY_TO_DAY' || p.status === 'GAME_TIME_DECISION') p.durantScore *= 0.85;
    });

    // Rank
    players.sort(function(a,b) { return (b.durantScore || 0) - (a.durantScore || 0); });
    players.forEach(function(p, i) { p.durantRank = i + 1; });
  }


  // ========== ENGINE 4: RECOMMENDATIONS (v3 FIX: smarter drops) ==========

  function generateRecommendations(myPlayers, allPlayers) {
    var cats = getOrderedCategories();
    var recs = [];
    if (!myPlayers || !myPlayers.length) return recs;

    // Sort my players by DURANT (worst first for drops)
    var sortedMy = myPlayers.slice().sort(function(a,b) { return (a.durantScore || 0) - (b.durantScore || 0); });

    // Get free agents sorted by DURANT (best first)
    var freeAgents = allPlayers.filter(function(p) { return p.onTeamId === 0; });
    freeAgents.sort(function(a,b) { return (b.durantScore || 0) - (a.durantScore || 0); });

    // v3 FIX: Only recommend dropping bench players with low DURANT
    // Never recommend dropping top-50 ranked players
    var droppable = sortedMy.filter(function(p) {
      // Only bench or IR
      if (p.slotId !== 12 && p.slotId !== 13) return false;
      // Don't drop players ranked in top 60% of roster
      var rosterRank = sortedMy.indexOf(p);
      var threshold = Math.floor(sortedMy.length * 0.4);
      return rosterRank < threshold;
    });

    // For each droppable player, see if a free agent would be an upgrade
    droppable.forEach(function(dropCandidate) {
      freeAgents.forEach(function(pickup) {
        if (recs.length >= 5) return;
        // Must be a meaningful upgrade
        var improvement = (pickup.durantScore || 0) - (dropCandidate.durantScore || 0);
        if (improvement > 2) {
          // Check if the pickup helps categories we need
          var catImpact = [];
          cats.forEach(function(cat) {
            var pickupZ = pickup.zScores ? pickup.zScores[cat.abbr] || 0 : 0;
            var dropZ = dropCandidate.zScores ? dropCandidate.zScores[cat.abbr] || 0 : 0;
            if (pickupZ > dropZ + 0.3) catImpact.push('+' + cat.abbr);
            else if (pickupZ < dropZ - 0.3) catImpact.push('-' + cat.abbr);
          });

          recs.push({
            type: 'pickup',
            priority: improvement > 5 ? 'high' : 'medium',
            action: 'Add ' + pickup.name + ', Drop ' + dropCandidate.name,
            detail: 'DURANT +' + fmt(improvement, 1) + '. ' + (catImpact.length ? catImpact.join(', ') : 'Similar production.'),
            player: pickup,
            dropPlayer: dropCandidate,
            improvement: improvement
          });
        }
      });
    });

    // Streaming recommendations (for today's games)
    var benchNoGame = myPlayers.filter(function(p) { return p.slotId === 12 && !p.gamesToday; });
    var faWithGame = freeAgents.filter(function(p) { return p.gamesToday; }).slice(0, 3);
    faWithGame.forEach(function(fa) {
      if (benchNoGame.length && recs.length < 8) {
        recs.push({
          type: 'stream',
          priority: 'low',
          action: 'Stream ' + fa.name + ' (playing today)',
          detail: fa.nbaTeam + ' game. DURANT: ' + fmt(fa.durantScore || 0, 1),
          player: fa
        });
      }
    });

    // Sort by improvement
    recs.sort(function(a,b) { return (b.improvement || 0) - (a.improvement || 0); });
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
      t.players.forEach(function(p) {
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

        team.players.forEach(function(theirP) {
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


  // ========== PUBLIC API ==========

  return {
    computeAllZScores: computeAllZScores,
    computeDURANT: computeDURANT,
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
    getBlendedStat: getBlendedStat
  };
})();
