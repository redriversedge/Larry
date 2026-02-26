// ============================================================
// LARRY v2.3 -- ANALYSIS ENGINES
// All calculation engines: valuation, projections, trades, etc.
// Auto-adapts to whatever categories the league uses
// ============================================================

var Engines = (function() {

  // ========== ENGINE 1: PLAYER VALUATION (Z-SCORES) ==========

  function computeAllZScores(players, period, opts) {
    period = period || 'season';
    opts = opts || {};
    var cats = S.league.categories;
    if (!cats.length || !players.length) return;

    // Recency weighting: blend season and recent stats
    var recencyWeight = opts.recencyWeight || (S.prefs.recencyWeight || 0);

    // Compute league averages and std deviations per category
    var catStats = {};
    cats.forEach(function(cat) {
      var values = [];
      players.forEach(function(p) {
        var val = getBlendedStat(p, cat.abbr, period, recencyWeight);
        if (val !== null && val !== undefined && !isNaN(val)) values.push(val);
      });
      var mean = values.length ? values.reduce(function(a, b) { return a + b; }, 0) / values.length : 0;
      var variance = values.length ? values.reduce(function(a, b) { return a + Math.pow(b - mean, 2); }, 0) / values.length : 1;
      var stdDev = Math.sqrt(variance) || 1;
      catStats[cat.abbr] = { mean: mean, stdDev: stdDev, scarcity: 1, variance: variance };
    });

    // Category scarcity weights (rarer production weighted higher)
    var cvs = [];
    cats.forEach(function(cat) {
      var cs = catStats[cat.abbr];
      cs.cv = cs.mean !== 0 ? cs.stdDev / Math.abs(cs.mean) : 1;
      cvs.push(cs.cv);
    });
    var avgCV = cvs.reduce(function(a, b) { return a + b; }, 0) / cvs.length || 1;
    cats.forEach(function(cat) {
      catStats[cat.abbr].scarcity = 0.7 + 0.6 * (catStats[cat.abbr].cv / avgCV);
    });

    // Variance penalty: high-variance stats get consistency discount
    cats.forEach(function(cat) {
      var cs = catStats[cat.abbr];
      // STL, BLK, 3PM tend to be high variance
      cs.variancePenalty = computeVariancePenalty(players, cat, period);
    });

    // Compute z-scores for each player
    players.forEach(function(p) {
      p.zScores = {};
      var total = 0;
      var catZValues = [];
      cats.forEach(function(cat) {
        var val = getBlendedStat(p, cat.abbr, period, recencyWeight);
        if (val !== null && val !== undefined && !isNaN(val)) {
          var z = (val - catStats[cat.abbr].mean) / catStats[cat.abbr].stdDev;
          if (cat.isNegative) z = -z;
          p.zScores[cat.abbr] = z;
          // Apply scarcity weight and variance penalty
          var zWeighted = z * catStats[cat.abbr].scarcity * (1 - catStats[cat.abbr].variancePenalty * 0.15);
          total += zWeighted;
          catZValues.push({ abbr: cat.abbr, z: zWeighted });
        } else {
          p.zScores[cat.abbr] = 0;
          catZValues.push({ abbr: cat.abbr, z: 0 });
        }
      });
      p.zScores.total = total;

      // DURANT Value: scarcity-weighted composite
      p.zScores.durant = total;

      // DURANT H2H: drop worst category value (mimics punt strategy)
      if (catZValues.length > 1) {
        catZValues.sort(function(a, b) { return a.z - b.z; });
        var drop1 = 0;
        for (var i = 1; i < catZValues.length; i++) drop1 += catZValues[i].z;
        p.zScores.durantH2H = drop1;
        var drop2 = 0;
        for (var j = 2; j < catZValues.length; j++) drop2 += catZValues[j].z;
        p.zScores.durantH2H2 = drop2;
      } else {
        p.zScores.durantH2H = total;
        p.zScores.durantH2H2 = total;
      }

      // Frustration Value: variance between recent and season (0-10 scale)
      var frustDiffs = [];
      cats.forEach(function(cat) {
        var season = p.stats && p.stats.season ? p.stats.season[cat.abbr] : null;
        var l7 = p.stats && p.stats.last7 ? p.stats.last7[cat.abbr] : null;
        if (season !== null && season !== 0 && l7 !== null) {
          frustDiffs.push(Math.pow((l7 - season) / Math.max(Math.abs(season), 0.1), 2));
        }
      });
      p.frustrationValue = frustDiffs.length ? Math.min(10, Math.sqrt(frustDiffs.reduce(function(a,b){return a+b;},0) / frustDiffs.length) * 5) : 0;
    });

    return catStats;
  }

  // Blend stats based on recency weight (0 = season only, 1 = recent only)
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

  // Compute variance penalty for a category (0-1, higher = more volatile)
  function computeVariancePenalty(players, cat, period) {
    var diffs = [];
    players.forEach(function(p) {
      var season = p.stats && p.stats.season ? p.stats.season[cat.abbr] : null;
      var l7 = p.stats && p.stats.last7 ? p.stats.last7[cat.abbr] : null;
      if (season !== null && l7 !== null && season !== 0) {
        diffs.push(Math.abs(l7 - season) / Math.max(Math.abs(season), 0.1));
      }
    });
    if (!diffs.length) return 0;
    var avg = diffs.reduce(function(a,b){return a+b;},0) / diffs.length;
    return Math.min(1, avg);
  }


  // ========== ENGINE 2: MONTE CARLO MATCHUP SIMULATOR ==========

  function monteCarloMatchup(myPlayers, oppPlayers, gamesRemainingMap, simulations) {
    simulations = simulations || 5000;
    var cats = S.league.categories;
    var results = {};
    cats.forEach(function(cat) { results[cat.abbr] = { wins: 0, losses: 0, ties: 0 }; });

    function playerVariance(p, cat) {
      var season = p.stats.season ? p.stats.season[cat.abbr] : 0;
      var l7 = p.stats.last7 ? p.stats.last7[cat.abbr] : season;
      if (!season) return 0.3;
      return Math.abs(l7 - season) / Math.max(Math.abs(season), 0.1);
    }

    for (var sim = 0; sim < simulations; sim++) {
      cats.forEach(function(cat) {
        var myTotal = 0, oppTotal = 0;

        myPlayers.forEach(function(p) {
          if (p.slotId === 13) return;
          var avg = p.stats.season ? (p.stats.season[cat.abbr] || 0) : 0;
          var games = gamesRemainingMap ? (gamesRemainingMap[p.id] || 0) : (p.gamesRemaining || 0);
          var variance = playerVariance(p, cat);
          var noise = gaussianRandom() * variance * avg;
          if (cat.isPercent) {
            myTotal += avg + noise * 0.05;
          } else {
            myTotal += (avg + noise) * games;
          }
        });

        oppPlayers.forEach(function(p) {
          if (p.slotId === 13) return;
          var avg = p.stats.season ? (p.stats.season[cat.abbr] || 0) : 0;
          var games = gamesRemainingMap ? (gamesRemainingMap[p.id] || 0) : (p.gamesRemaining || 0);
          var variance = playerVariance(p, cat);
          var noise = gaussianRandom() * variance * avg;
          if (cat.isPercent) {
            oppTotal += avg + noise * 0.05;
          } else {
            oppTotal += (avg + noise) * games;
          }
        });

        var myCurrent = S.matchup.myScores[cat.abbr] || 0;
        var oppCurrent = S.matchup.oppScores[cat.abbr] || 0;
        myTotal += myCurrent;
        oppTotal += oppCurrent;

        if (cat.isNegative) {
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

    var winProbs = {};
    cats.forEach(function(cat) {
      winProbs[cat.abbr] = {
        win: (results[cat.abbr].wins / simulations * 100).toFixed(1),
        lose: (results[cat.abbr].losses / simulations * 100).toFixed(1),
        tie: (results[cat.abbr].ties / simulations * 100).toFixed(1)
      };
    });
    return winProbs;
  }

  function gaussianRandom() {
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }


  // ========== ENGINE 3: TRADE EVALUATION (ENHANCED) ==========

  function evaluateTrade(givePlayers, getPlayers, opts) {
    opts = opts || {};
    var cats = S.league.categories;
    var giveZ = 0, getZ = 0;
    var catImpact = {};

    cats.forEach(function(cat) {
      var give = 0, get = 0;
      givePlayers.forEach(function(p) { give += p.zScores ? (p.zScores[cat.abbr] || 0) : 0; });
      getPlayers.forEach(function(p) { get += p.zScores ? (p.zScores[cat.abbr] || 0) : 0; });
      catImpact[cat.abbr] = { before: give, after: get, diff: get - give };
      giveZ += give;
      getZ += get;
    });

    var diff = getZ - giveZ;
    var grade, fairness;
    if (diff >= 3) { grade = 'A+'; fairness = 'Strong win'; }
    else if (diff >= 1.5) { grade = 'A'; fairness = 'Clear win'; }
    else if (diff >= 0.5) { grade = 'B+'; fairness = 'Slight win'; }
    else if (diff >= -0.5) { grade = 'B'; fairness = 'Fair trade'; }
    else if (diff >= -1.5) { grade = 'C'; fairness = 'Slight loss'; }
    else if (diff >= -3) { grade = 'D'; fairness = 'Clear loss'; }
    else { grade = 'F'; fairness = 'Bad trade'; }

    var oppDiff = -diff;
    var acceptProb;
    if (oppDiff >= 2) acceptProb = 'Very likely (90%+)';
    else if (oppDiff >= 0.5) acceptProb = 'Likely (70%)';
    else if (oppDiff >= -0.5) acceptProb = 'Coin flip (50%)';
    else if (oppDiff >= -2) acceptProb = 'Unlikely (25%)';
    else acceptProb = 'Very unlikely (<10%)';

    var giveGR = 0, getGR = 0;
    givePlayers.forEach(function(p) { giveGR += p.gamesRemainingROS || 0; });
    getPlayers.forEach(function(p) { getGR += p.gamesRemainingROS || 0; });

    var catsHelped = [], catsHurt = [];
    cats.forEach(function(cat) {
      if (catImpact[cat.abbr].diff > 0.3) catsHelped.push(cat.abbr);
      if (catImpact[cat.abbr].diff < -0.3) catsHurt.push(cat.abbr);
    });

    // NEW: League rank shift per category
    var rankShift = {};
    if (opts.myTeamId) {
      cats.forEach(function(cat) {
        var currentRank = getTeamCategoryRankById(opts.myTeamId, cat.abbr);
        // Estimate new rank by adjusting team strength
        var impactZ = catImpact[cat.abbr].diff;
        // Rough: each 0.5 z moves ~1 rank
        var newRank = Math.max(1, Math.min(S.league.teamCount, Math.round(currentRank - impactZ * 2)));
        rankShift[cat.abbr] = { before: currentRank, after: newRank };
      });
    }

    // NEW: Positional impact check
    var positionalIssue = checkPositionalImpact(givePlayers, getPlayers);

    // NEW: Punt alignment
    var puntAlignment = checkPuntAlignment(catImpact);

    return {
      grade: grade,
      fairness: fairness,
      zDiff: diff,
      giveZTotal: giveZ,
      getZTotal: getZ,
      catImpact: catImpact,
      acceptProbability: acceptProb,
      scheduleImpact: { give: giveGR, get: getGR, diff: getGR - giveGR },
      catsHelped: catsHelped,
      catsHurt: catsHurt,
      rankShift: rankShift,
      positionalIssue: positionalIssue,
      puntAlignment: puntAlignment
    };
  }

  function getTeamCategoryRankById(teamId, catAbbr) {
    var cat = S.league.categories.find(function(c) { return c.abbr === catAbbr; });
    var vals = S.teams.map(function(t) {
      return { teamId: t.teamId, val: teamCategoryStrength(t, catAbbr) };
    });
    vals.sort(function(a, b) { return cat && cat.isNegative ? (a.val - b.val) : (b.val - a.val); });
    var idx = vals.findIndex(function(v) { return v.teamId === teamId; });
    return idx + 1;
  }

  function checkPositionalImpact(givePlayers, getPlayers) {
    // Check if trade creates roster slot bottleneck
    var myPlayers = S.myTeam.players.slice();
    // Remove given players, add gotten players
    var afterTrade = myPlayers.filter(function(p) {
      return !givePlayers.some(function(gp) { return gp.id === p.id; });
    });
    getPlayers.forEach(function(p) { afterTrade.push(p); });

    // Count position eligibility
    var posCounts = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
    afterTrade.forEach(function(p) {
      if (p.positions) p.positions.forEach(function(pos) { if (posCounts[pos] !== undefined) posCounts[pos]++; });
    });

    var issues = [];
    var posSlots = {};
    S.league.rosterSlots.forEach(function(rs) {
      var name = rs.name;
      if (posSlots[name]) posSlots[name] += rs.count;
      else posSlots[name] = rs.count;
    });

    // Check for gluts: more players at a position than can play
    Object.keys(posCounts).forEach(function(pos) {
      var slots = posSlots[pos] || 0;
      if (posCounts[pos] > slots + (posSlots.UTIL || 0) + (posSlots.BE || 0)) {
        issues.push('Surplus at ' + pos + ' (' + posCounts[pos] + ' players)');
      }
    });

    return issues.length ? issues : null;
  }

  function checkPuntAlignment(catImpact) {
    // Check if trade helps or hurts punt strategy
    var punt = Engines.puntStrategyAnalysis();
    if (!punt.length) return null;
    var bestPunt = punt[0]; // Most viable punt
    if (!bestPunt.viable) return { aligned: true, msg: 'No clear punt strategy detected' };

    var puntCat = bestPunt.puntCat;
    var helpsPunt = true;
    var msg = '';

    Object.keys(catImpact).forEach(function(cat) {
      if (cat === puntCat && catImpact[cat].diff > 0.5) {
        helpsPunt = false;
        msg = 'Adds value in ' + puntCat + ' (your punt cat) -- works against your punt strategy';
      }
    });

    if (helpsPunt) {
      msg = 'Aligned with punt ' + puntCat + ' strategy';
    }

    return { aligned: helpsPunt, puntCat: puntCat, msg: msg };
  }

  // Trade finder: scan league for mutually beneficial trades
  function findTrades(targetCats) {
    var suggestions = [];
    var myPlayers = S.myTeam.players.filter(function(p) { return p.slotId !== 13; });

    S.teams.forEach(function(team) {
      if (team.teamId === S.myTeam.teamId) return;

      team.players.forEach(function(target) {
        if (!target.zScores || target.slotId === 13) return;
        var targetHelps = false;
        if (targetCats) {
          targetCats.forEach(function(cat) {
            if (target.zScores[cat] > 0.5) targetHelps = true;
          });
        } else {
          targetHelps = target.zScores.total > 1;
        }
        if (!targetHelps) return;

        myPlayers.forEach(function(give) {
          if (!give.zScores) return;
          var result = evaluateTrade([give], [target], { myTeamId: S.myTeam.teamId });
          if (result.zDiff > -1 && result.zDiff < 3 && result.acceptProbability !== 'Very unlikely (<10%)') {
            suggestions.push({
              give: give,
              get: target,
              team: team,
              result: result
            });
          }
        });
      });
    });

    suggestions.sort(function(a, b) { return b.result.zDiff - a.result.zDiff; });
    return suggestions.slice(0, 20);
  }


  // ========== ENGINE 4: LINEUP OPTIMIZATION ==========

  function optimizeLineup(players, date) {
    var withGames = players.filter(function(p) {
      if (p.status === 'OUT' || p.status === 'SUSPENSION') return false;
      if (date) {
        return p.schedule && p.schedule.some(function(g) { return g.date === date; });
      }
      return p.gamesToday;
    });

    var noGames = players.filter(function(p) { return !withGames.includes(p); });
    withGames.sort(function(a, b) { return (b.zScores.total || 0) - (a.zScores.total || 0); });

    var slots = [];
    S.league.rosterSlots.forEach(function(rs) {
      for (var i = 0; i < rs.count; i++) {
        if (rs.slotId !== 12 && rs.slotId !== 13) {
          slots.push({ slotId: rs.slotId, name: rs.name, player: null });
        }
      }
    });

    var assigned = [];
    withGames.forEach(function(p) {
      if (assigned.includes(p.id)) return;
      var bestSlot = null;
      slots.forEach(function(slot) {
        if (slot.player) return;
        if (p.eligibleSlots.includes(slot.slotId)) {
          if (!bestSlot || slot.slotId < 11) bestSlot = slot;
        }
      });
      if (bestSlot) {
        bestSlot.player = p;
        assigned.push(p.id);
      }
    });

    var bench = players.filter(function(p) { return !assigned.includes(p.id) && p.slotId !== 13; });
    var ir = players.filter(function(p) { return p.slotId === 13; });

    return { starters: slots, bench: bench, ir: ir, warnings: findLineupWarnings(slots, bench) };
  }

  function findLineupWarnings(starters, bench) {
    var warnings = [];
    starters.forEach(function(slot) {
      if (slot.player && !slot.player.gamesToday) {
        bench.forEach(function(bp) {
          if (bp.gamesToday && bp.eligibleSlots.includes(slot.slotId)) {
            warnings.push({
              type: 'swap',
              message: bp.name + ' (bench, has game) could replace ' + slot.player.name + ' (' + slot.name + ', no game)',
              benchPlayer: bp,
              startingSlot: slot
            });
          }
        });
      }
    });
    starters.forEach(function(slot) {
      if (!slot.player) {
        warnings.push({ type: 'empty', message: slot.name + ' slot is empty' });
      }
    });
    return warnings;
  }


  // ========== ENGINE 5: RECOMMENDATIONS ==========

  function getDropCandidates() {
    var players = S.myTeam.players.filter(function(p) { return p.slotId !== 13; });
    computeAllZScores(S.allPlayers, 'season');

    var ranked = players.slice().sort(function(a, b) {
      return (a.zScores.total || 0) - (b.zScores.total || 0);
    });

    return ranked.slice(0, 5).map(function(p) {
      var replacement = findBestReplacement(p);
      return {
        player: p,
        zScore: p.zScores.total || 0,
        replacement: replacement,
        reasoning: buildDropReasoning(p, replacement)
      };
    });
  }

  function findBestReplacement(dropPlayer) {
    var fas = S.freeAgents.filter(function(fa) {
      return fa.positions.some(function(pos) { return dropPlayer.positions.includes(pos); });
    });
    computeAllZScores(fas.concat(S.myTeam.players), 'season');
    fas.sort(function(a, b) { return (b.zScores.total || 0) - (a.zScores.total || 0); });
    return fas[0] || null;
  }

  function buildDropReasoning(player, replacement) {
    var cats = S.league.categories;
    var reason = player.name + ' (z: ' + fmt(player.zScores.total, 2) + ')';
    if (replacement) {
      reason += ' -> ' + replacement.name + ' (z: ' + fmt(replacement.zScores.total, 2) + ')';
      var gains = [], losses = [];
      cats.forEach(function(cat) {
        var diff = (replacement.stats.season[cat.abbr] || 0) - (player.stats.season[cat.abbr] || 0);
        if (Math.abs(diff) > 0.5) {
          if (diff > 0 && !cat.isNegative || diff < 0 && cat.isNegative) {
            gains.push('+' + fmt(Math.abs(diff), 1) + ' ' + cat.abbr);
          } else {
            losses.push('-' + fmt(Math.abs(diff), 1) + ' ' + cat.abbr);
          }
        }
      });
      if (gains.length) reason += ' | Gains: ' + gains.join(', ');
      if (losses.length) reason += ' | Loses: ' + losses.join(', ');
    }
    return reason;
  }

  function getAddTargets(weakCats) {
    var fas = S.freeAgents.slice();
    computeAllZScores(fas.concat(S.myTeam.players), 'season');

    if (weakCats && weakCats.length) {
      fas.sort(function(a, b) {
        var aVal = 0, bVal = 0;
        weakCats.forEach(function(cat) {
          aVal += a.zScores[cat] || 0;
          bVal += b.zScores[cat] || 0;
        });
        return bVal - aVal;
      });
    } else {
      fas.sort(function(a, b) { return (b.zScores.total || 0) - (a.zScores.total || 0); });
    }

    return fas.slice(0, 15);
  }

  function getStreamingTargets(date) {
    var fas = S.freeAgents.filter(function(p) {
      if (date) return p.schedule && p.schedule.some(function(g) { return g.date === date; });
      return p.gamesToday;
    });
    computeAllZScores(fas.concat(S.myTeam.players), 'season');
    fas.sort(function(a, b) { return (b.zScores.total || 0) - (a.zScores.total || 0); });
    return fas.slice(0, 10);
  }


  // ========== ENGINE 6: TREND ANALYSIS ==========

  function detectStreaks(player) {
    var cats = S.league.categories;
    var hotCats = [], coldCats = [];
    cats.forEach(function(cat) {
      var season = player.stats.season ? player.stats.season[cat.abbr] : null;
      var recent = player.stats.last7 ? player.stats.last7[cat.abbr] : null;
      if (season && recent && season !== 0) {
        var change = (recent - season) / Math.abs(season);
        if (cat.isNegative) change = -change;
        if (change > 0.2) hotCats.push({ cat: cat.abbr, pct: (change * 100).toFixed(0) });
        if (change < -0.2) coldCats.push({ cat: cat.abbr, pct: (Math.abs(change) * 100).toFixed(0) });
      }
    });

    if (hotCats.length >= 3) return { trend: 'hot', label: 'Hot: ' + hotCats.map(function(c) { return c.cat + ' +' + c.pct + '%'; }).join(', '), cats: hotCats };
    if (coldCats.length >= 3) return { trend: 'cold', label: 'Cold: ' + coldCats.map(function(c) { return c.cat + ' -' + c.pct + '%'; }).join(', '), cats: coldCats };
    return { trend: 'stable', label: 'Stable', cats: [] };
  }

  function categoryVolatility(players) {
    var cats = S.league.categories;
    var volatility = {};
    cats.forEach(function(cat) {
      var diffs = [];
      players.forEach(function(p) {
        var season = p.stats.season ? p.stats.season[cat.abbr] : null;
        var l7 = p.stats.last7 ? p.stats.last7[cat.abbr] : null;
        if (season !== null && l7 !== null && season !== 0) {
          diffs.push(Math.abs(l7 - season) / Math.abs(season));
        }
      });
      var avg = diffs.length ? diffs.reduce(function(a, b) { return a + b; }, 0) / diffs.length : 0;
      volatility[cat.abbr] = { coefficient: avg, label: avg > 0.3 ? 'High' : avg > 0.15 ? 'Medium' : 'Low' };
    });
    return volatility;
  }


  // ========== ENGINE 7: LEAGUE INTELLIGENCE ==========

  function teamOfTheWeek() {
    var teamScores = [];
    S.teams.forEach(function(team) {
      var matchup = S.league.schedule.find(function(m) {
        return m.matchupPeriodId === S.league.currentMatchupPeriod &&
          ((m.home && m.home.teamId === team.teamId) || (m.away && m.away.teamId === team.teamId));
      });
      if (!matchup) return;

      var catWins = 0;
      S.teams.forEach(function(opp) {
        if (opp.teamId === team.teamId) return;
        var teamZ = team.players.reduce(function(sum, p) { return sum + (p.zScores ? p.zScores.total || 0 : 0); }, 0);
        var oppZ = opp.players.reduce(function(sum, p) { return sum + (p.zScores ? p.zScores.total || 0 : 0); }, 0);
        if (teamZ > oppZ) catWins++;
      });

      teamScores.push({ team: team, winsVsField: catWins });
    });

    teamScores.sort(function(a, b) { return b.winsVsField - a.winsVsField; });
    return teamScores;
  }

  function whoBeatsMe() {
    var cats = S.league.categories;
    var results = [];
    S.teams.forEach(function(team) {
      if (team.teamId === S.myTeam.teamId) return;
      var wins = 0, losses = 0;
      cats.forEach(function(cat) {
        var myVal = teamCategoryStrength(S.myTeam, cat.abbr);
        var oppVal = teamCategoryStrength(team, cat.abbr);
        if (cat.isNegative) {
          if (myVal < oppVal) wins++; else if (myVal > oppVal) losses++;
        } else {
          if (myVal > oppVal) wins++; else if (myVal < oppVal) losses++;
        }
      });
      results.push({ team: team, wins: wins, losses: losses, diff: wins - losses });
    });
    results.sort(function(a, b) { return a.diff - b.diff; });
    return results;
  }

  function teamCategoryStrength(team, catAbbr) {
    var starters = team.players.filter(function(p) { return p.slotId !== 12 && p.slotId !== 13; });
    if (starters.length === 0) return 0;
    var total = starters.reduce(function(sum, p) {
      return sum + (p.stats.season ? (p.stats.season[catAbbr] || 0) : 0);
    }, 0);
    return total;
  }

  function puntStrategyAnalysis() {
    var cats = S.league.categories;
    var results = [];
    cats.forEach(function(puntCat) {
      var otherCats = cats.filter(function(c) { return c.abbr !== puntCat.abbr; });
      var winsVsLeague = 0;
      var totalComparisons = 0;
      S.teams.forEach(function(team) {
        if (team.teamId === S.myTeam.teamId) return;
        var wins = 0;
        otherCats.forEach(function(cat) {
          var myVal = teamCategoryStrength(S.myTeam, cat.abbr);
          var oppVal = teamCategoryStrength(team, cat.abbr);
          if (cat.isNegative) { if (myVal < oppVal) wins++; }
          else { if (myVal > oppVal) wins++; }
        });
        winsVsLeague += wins;
        totalComparisons += otherCats.length;
      });
      var winRate = totalComparisons > 0 ? winsVsLeague / totalComparisons : 0;
      results.push({
        puntCat: puntCat.abbr,
        winRate: winRate,
        winsVsLeague: winsVsLeague,
        totalComparisons: totalComparisons,
        viable: winRate > 0.55
      });
    });
    results.sort(function(a, b) { return b.winRate - a.winRate; });
    return results;
  }

  function playoffProjection() {
    var record = S.myTeam.record;
    var totalGames = record.wins + record.losses + record.ties;
    if (totalGames === 0) return null;
    var winRate = record.wins / totalGames;
    var totalMatchups = 20;
    var remaining = totalMatchups - (S.league.currentMatchupPeriod || 1);
    var projectedWins = record.wins + Math.round(winRate * remaining * S.league.categories.length);
    var projectedLosses = record.losses + Math.round((1 - winRate) * remaining * S.league.categories.length);

    var standings = S.teams.slice().sort(function(a, b) {
      var aWinPct = a.record.wins / (a.record.wins + a.record.losses + a.record.ties || 1);
      var bWinPct = b.record.wins / (b.record.wins + b.record.losses + b.record.ties || 1);
      return bWinPct - aWinPct;
    });
    var myRank = standings.findIndex(function(t) { return t.teamId === S.myTeam.teamId; }) + 1;
    var inPlayoffs = myRank <= S.league.playoffTeams;

    return {
      currentRecord: record,
      winRate: winRate,
      projectedWins: projectedWins,
      projectedLosses: projectedLosses,
      currentSeed: myRank,
      inPlayoffs: inPlayoffs,
      playoffTeams: S.league.playoffTeams,
      matchupsRemaining: remaining
    };
  }


  // ========== ENGINE 8: SCHEDULE ANALYSIS ==========

  function scheduleHeatMap(players, days) {
    days = days || 14;
    var today = localNow();
    var heatmap = [];
    for (var d = 0; d < days; d++) {
      var date = new Date(today);
      date.setDate(date.getDate() + d);
      var dateStr = localDateStr(date);
      var dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      var playersWithGames = [];
      players.forEach(function(p) {
        if (p.schedule) {
          var hasGame = p.schedule.some(function(g) { return g.date === dateStr; });
          if (hasGame) playersWithGames.push(p);
        }
      });
      heatmap.push({
        date: dateStr,
        dayName: dayName,
        count: playersWithGames.length,
        players: playersWithGames,
        isToday: d === 0
      });
    }
    return heatmap;
  }

  function backToBackDetection(players) {
    var alerts = [];
    players.forEach(function(p) {
      if (!p.schedule || p.schedule.length < 2) return;
      for (var i = 0; i < p.schedule.length - 1; i++) {
        var d1 = new Date(p.schedule[i].date);
        var d2 = new Date(p.schedule[i + 1].date);
        var diffDays = (d2 - d1) / (1000 * 60 * 60 * 24);
        if (diffDays === 1) {
          alerts.push({
            player: p,
            date1: p.schedule[i].date,
            date2: p.schedule[i + 1].date,
            risk: p.minutesPerGame > 34 ? 'High' : 'Moderate'
          });
        }
      }
    });
    return alerts;
  }


  // ========== ENGINE 9: INJURY IMPACT (USAGE MONSTER) ==========

  function injuryImpact(injuredPlayer) {
    // When a player goes down, who benefits?
    // Find teammates and estimate usage boost
    var team = injuredPlayer.nbaTeam;
    var teammates = S.allPlayers.filter(function(p) {
      return p.nbaTeam === team && p.id !== injuredPlayer.id && p.status === 'ACTIVE';
    });

    if (!teammates.length) return [];

    var cats = S.league.categories;
    var injuredStats = injuredPlayer.stats.season || {};
    var injuredMins = injuredPlayer.minutesPerGame || 0;

    var beneficiaries = [];
    teammates.forEach(function(tm) {
      var tmMins = tm.minutesPerGame || 0;
      // Estimate minutes boost: proportional to current minutes share
      var teamMinutes = teammates.reduce(function(s, p) { return s + (p.minutesPerGame || 0); }, 0);
      var share = teamMinutes > 0 ? tmMins / teamMinutes : 0;
      var minsBoost = injuredMins * share;
      var boostPct = tmMins > 0 ? minsBoost / tmMins : 0;

      // Estimate stat boost per category
      var catBoosts = {};
      var totalBoost = 0;
      cats.forEach(function(cat) {
        if (cat.isPercent) { catBoosts[cat.abbr] = 0; return; }
        var tmStat = tm.stats.season ? (tm.stats.season[cat.abbr] || 0) : 0;
        var boost = tmStat * boostPct * 0.6; // 60% efficiency on extra minutes
        catBoosts[cat.abbr] = boost;
        totalBoost += boost;
      });

      // Check if this player is on waivers (pickup opportunity)
      var onWaivers = !tm.onTeamId;

      beneficiaries.push({
        player: tm,
        minsBoost: minsBoost,
        boostPct: boostPct,
        catBoosts: catBoosts,
        totalBoost: totalBoost,
        onWaivers: onWaivers,
        // Flag if same position
        samePosition: tm.positions.some(function(pos) { return injuredPlayer.positions.includes(pos); })
      });
    });

    beneficiaries.sort(function(a, b) { return b.totalBoost - a.totalBoost; });
    return beneficiaries.slice(0, 10);
  }


  // ========== ENGINE 10: ROSTER CONSTRUCTION AUDIT ==========

  function rosterConstructionAudit(players) {
    players = players || S.myTeam.players;
    var slots = {};
    S.league.rosterSlots.forEach(function(rs) {
      if (rs.slotId !== 12 && rs.slotId !== 13) { // Not bench/IR
        if (!slots[rs.name]) slots[rs.name] = { count: 0, needed: rs.count };
        else slots[rs.name].needed += rs.count;
      }
    });

    // Count how many players can fill each slot
    var posMap = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
    players.forEach(function(p) {
      if (p.positions) p.positions.forEach(function(pos) { if (posMap[pos] !== undefined) posMap[pos]++; });
    });

    var issues = [];
    var strengths = [];

    // Check each position
    Object.keys(posMap).forEach(function(pos) {
      var slotInfo = slots[pos];
      var needed = slotInfo ? slotInfo.needed : 0;
      if (posMap[pos] < needed) {
        issues.push({ type: 'shortage', pos: pos, have: posMap[pos], need: needed, msg: pos + ' shortage: ' + posMap[pos] + ' players for ' + needed + ' slots' });
      } else if (posMap[pos] > needed + 2) {
        issues.push({ type: 'surplus', pos: pos, have: posMap[pos], need: needed, msg: pos + ' surplus: ' + posMap[pos] + ' players for ' + needed + ' slots (consider trading)' });
      } else {
        strengths.push({ pos: pos, have: posMap[pos], need: needed });
      }
    });

    // Check bench utilization
    var benchPlayers = players.filter(function(p) { return p.slotId === 12; });
    var irPlayers = players.filter(function(p) { return p.slotId === 13; });
    var irEligible = players.filter(function(p) {
      return p.slotId !== 13 && (p.status === 'OUT' || p.status === 'SUSPENSION' || p.status === 'IR' || p.status === 'INJURED_RESERVE');
    });

    if (irEligible.length > 0 && irPlayers.length < S.league.irSlots) {
      issues.push({ type: 'ir', msg: 'IR slot available! Move ' + irEligible[0].name + ' to IR to open a roster spot' });
    }

    return { posMap: posMap, issues: issues, strengths: strengths, benchCount: benchPlayers.length, irCount: irPlayers.length, irEligible: irEligible };
  }


  // ========== ENGINE 11: OPPONENT SCOUTING ==========

  function opponentScoutingReport(teamId) {
    var team = S.teams.find(function(t) { return t.teamId === teamId; });
    if (!team) return null;

    computeAllZScores(S.allPlayers, 'season');
    var cats = S.league.categories;

    // Category strengths
    var catRanks = {};
    cats.forEach(function(cat) {
      catRanks[cat.abbr] = getTeamCategoryRankById(teamId, cat.abbr);
    });

    // Top players
    var topPlayers = team.players.slice()
      .filter(function(p) { return p.zScores; })
      .sort(function(a, b) { return (b.zScores.total || 0) - (a.zScores.total || 0); })
      .slice(0, 5);

    // Weaknesses (bottom 3 cats)
    var catSorted = cats.slice().sort(function(a, b) { return catRanks[b.abbr] - catRanks[a.abbr]; });
    var weakCats = catSorted.slice(0, 3).map(function(c) { return c.abbr; });
    var strongCats = catSorted.slice(-3).map(function(c) { return c.abbr; });

    // Head-to-head vs me
    var h2h = { wins: 0, losses: 0 };
    cats.forEach(function(cat) {
      var myVal = teamCategoryStrength(S.myTeam, cat.abbr);
      var oppVal = teamCategoryStrength(team, cat.abbr);
      if (cat.isNegative) {
        if (myVal < oppVal) h2h.wins++; else if (myVal > oppVal) h2h.losses++;
      } else {
        if (myVal > oppVal) h2h.wins++; else if (myVal < oppVal) h2h.losses++;
      }
    });

    // Injury report
    var injured = team.players.filter(function(p) { return p.status !== 'ACTIVE' && p.status !== 'HEALTHY'; });

    // Roster audit
    var rosterAudit = rosterConstructionAudit(team.players);

    return {
      team: team,
      catRanks: catRanks,
      topPlayers: topPlayers,
      weakCats: weakCats,
      strongCats: strongCats,
      h2h: h2h,
      injured: injured,
      rosterAudit: rosterAudit,
      record: team.record
    };
  }


  // ========== ENGINE 12: IR STASH CANDIDATES ==========

  function irStashCandidates() {
    // Find injured players on waivers worth stashing
    var candidates = S.freeAgents.filter(function(p) {
      return (p.status === 'OUT' || p.status === 'IR' || p.status === 'INJURED_RESERVE' || p.status === 'SUSPENSION');
    });

    computeAllZScores(candidates.concat(S.myTeam.players), 'season');

    // Only show players with meaningful value
    candidates = candidates.filter(function(p) {
      return p.zScores && p.zScores.total > 0.5 && p.gamesPlayed > 5;
    });

    candidates.sort(function(a, b) { return (b.zScores.total || 0) - (a.zScores.total || 0); });

    return candidates.slice(0, 10).map(function(p) {
      return {
        player: p,
        zScore: p.zScores.total,
        ownership: p.ownership,
        status: p.status,
        value: p.zScores.total > 2 ? 'High' : (p.zScores.total > 1 ? 'Medium' : 'Low')
      };
    });
  }


  // ========== ENGINE 13: PROJECTED STANDINGS ==========

  function projectedStandings() {
    var cats = S.league.categories;
    var totalMatchups = 20;
    var currentMP = S.league.currentMatchupPeriod || 1;
    var remaining = totalMatchups - currentMP;

    return S.teams.map(function(team) {
      var record = team.record;
      var totalGames = record.wins + record.losses + record.ties;
      var winRate = totalGames > 0 ? record.wins / totalGames : 0.5;

      // Adjust win rate based on team strength (z-score sum)
      var teamZ = team.players.reduce(function(s, p) { return s + (p.zScores ? p.zScores.total || 0 : 0); }, 0);
      var leagueAvgZ = S.teams.reduce(function(s, t) {
        return s + t.players.reduce(function(ps, p) { return ps + (p.zScores ? p.zScores.total || 0 : 0); }, 0);
      }, 0) / S.teams.length;

      // Blend actual record with projected strength
      var strengthFactor = leagueAvgZ !== 0 ? teamZ / Math.max(Math.abs(leagueAvgZ), 1) : 1;
      var adjustedWinRate = winRate * 0.6 + Math.min(1, Math.max(0, 0.5 + (strengthFactor - 1) * 0.2)) * 0.4;

      var projWins = record.wins + Math.round(adjustedWinRate * remaining * cats.length);
      var projLosses = record.losses + Math.round((1 - adjustedWinRate) * remaining * cats.length);

      return {
        team: team,
        currentRecord: record,
        winRate: winRate,
        adjustedWinRate: adjustedWinRate,
        projectedWins: projWins,
        projectedLosses: projLosses,
        teamStrength: teamZ,
        isMe: team.teamId === S.myTeam.teamId
      };
    }).sort(function(a, b) {
      var aPct = a.projectedWins / Math.max(a.projectedWins + a.projectedLosses, 1);
      var bPct = b.projectedWins / Math.max(b.projectedWins + b.projectedLosses, 1);
      return bPct - aPct;
    });
  }


  // ========== ENGINE 14: DRAFT CENTER ==========

  function generateDraftRankings(puntCats) {
    // Generate draft rankings based on z-scores adjusted for user's league
    var allPlayers = S.allPlayers.slice();
    computeAllZScores(allPlayers, 'season');

    var cats = S.league.categories;
    var activeCats = puntCats ? cats.filter(function(c) { return !puntCats.includes(c.abbr); }) : cats;

    allPlayers.forEach(function(p) {
      // Recalculate value excluding punted cats
      var draftValue = 0;
      activeCats.forEach(function(cat) {
        draftValue += (p.zScores[cat.abbr] || 0);
      });
      p.draftValue = draftValue;

      // Position scarcity bonus
      var posCount = allPlayers.filter(function(op) {
        return op.draftValue > 0 && op.positions.some(function(pos) { return p.positions.includes(pos); });
      }).length;
      p.positionalScarcity = posCount < 30 ? 'Scarce' : (posCount < 60 ? 'Moderate' : 'Deep');
      if (posCount < 30) p.draftValue *= 1.1; // 10% boost for scarce positions
    });

    allPlayers.sort(function(a, b) { return (b.draftValue || 0) - (a.draftValue || 0); });

    // Assign tiers (top 15 = tier 1, next 30 = tier 2, etc.)
    allPlayers.forEach(function(p, i) {
      if (i < 15) p.draftTier = 1;
      else if (i < 45) p.draftTier = 2;
      else if (i < 90) p.draftTier = 3;
      else if (i < 150) p.draftTier = 4;
      else p.draftTier = 5;
      p.draftRank = i + 1;
    });

    return allPlayers.filter(function(p) { return p.draftValue > -5; }).slice(0, 200);
  }

  function draftDynamicValue(draftedPlayerIds, remainingPlayers) {
    // Recalculate values based on what's been drafted (dynamic scarcity)
    var available = remainingPlayers.filter(function(p) { return !draftedPlayerIds.includes(p.id); });
    computeAllZScores(available, 'season');

    // Recalculate scarcity based on remaining pool
    available.forEach(function(p) {
      var posAvailable = available.filter(function(op) {
        return op.positions.some(function(pos) { return p.positions.includes(pos); });
      }).length;
      p.dynamicScarcity = posAvailable < 15 ? 'Critical' : (posAvailable < 30 ? 'Scarce' : 'Available');
      if (posAvailable < 15) p.zScores.total *= 1.15;
    });

    available.sort(function(a, b) { return (b.zScores.total || 0) - (a.zScores.total || 0); });
    return available;
  }

  function postDraftReport(draftedTeam) {
    // Generate comprehensive post-draft analysis
    var cats = S.league.categories;
    computeAllZScores(S.allPlayers, 'season');

    var catProfile = {};
    cats.forEach(function(cat) {
      var teamTotal = draftedTeam.reduce(function(s, p) { return s + (p.zScores ? p.zScores[cat.abbr] || 0 : 0); }, 0);
      var rank = getTeamCategoryRankById(S.myTeam.teamId, cat.abbr);
      var grade;
      if (rank <= 2) grade = 'A';
      else if (rank <= 4) grade = 'B';
      else if (rank <= 7) grade = 'C';
      else if (rank <= 9) grade = 'D';
      else grade = 'F';
      catProfile[cat.abbr] = { total: teamTotal, rank: rank, grade: grade };
    });

    // Natural punt detection
    var sortedCats = cats.slice().sort(function(a, b) {
      return (catProfile[b.abbr].rank || 0) - (catProfile[a.abbr].rank || 0);
    });
    var naturalPunts = sortedCats.slice(0, 2).filter(function(c) { return catProfile[c.abbr].rank >= Math.ceil(S.league.teamCount * 0.7); }).map(function(c) { return c.abbr; });
    var strengthCats = sortedCats.slice(-3).map(function(c) { return c.abbr; });

    // Overall grade
    var avgRank = cats.reduce(function(s, c) { return s + catProfile[c.abbr].rank; }, 0) / cats.length;
    var overallGrade;
    if (avgRank <= 3) overallGrade = 'A';
    else if (avgRank <= 5) overallGrade = 'B';
    else if (avgRank <= 7) overallGrade = 'C';
    else overallGrade = 'D';

    return {
      catProfile: catProfile,
      naturalPunts: naturalPunts,
      strengthCats: strengthCats,
      overallGrade: overallGrade,
      avgRank: avgRank,
      rosterAudit: rosterConstructionAudit(draftedTeam)
    };
  }


  // ========== PUBLIC API ==========
  return {
    computeAllZScores: computeAllZScores,
    monteCarloMatchup: monteCarloMatchup,
    evaluateTrade: evaluateTrade,
    findTrades: findTrades,
    optimizeLineup: optimizeLineup,
    getDropCandidates: getDropCandidates,
    getAddTargets: getAddTargets,
    getStreamingTargets: getStreamingTargets,
    findBestReplacement: findBestReplacement,
    detectStreaks: detectStreaks,
    categoryVolatility: categoryVolatility,
    teamOfTheWeek: teamOfTheWeek,
    whoBeatsMe: whoBeatsMe,
    puntStrategyAnalysis: puntStrategyAnalysis,
    playoffProjection: playoffProjection,
    scheduleHeatMap: scheduleHeatMap,
    backToBackDetection: backToBackDetection,
    teamCategoryStrength: teamCategoryStrength,
    injuryImpact: injuryImpact,
    rosterConstructionAudit: rosterConstructionAudit,
    opponentScoutingReport: opponentScoutingReport,
    irStashCandidates: irStashCandidates,
    projectedStandings: projectedStandings,
    generateDraftRankings: generateDraftRankings,
    draftDynamicValue: draftDynamicValue,
    postDraftReport: postDraftReport,
    getTeamCategoryRankById: getTeamCategoryRankById
  };
})();
