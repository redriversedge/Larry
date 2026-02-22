// ============================================================
// LARRY v2 -- ANALYSIS ENGINES
// All calculation engines: valuation, projections, trades, etc.
// Auto-adapts to whatever categories the league uses
// ============================================================

var Engines = (function() {

  // ========== ENGINE 1: PLAYER VALUATION (Z-SCORES) ==========

  function computeAllZScores(players, period) {
    period = period || 'season';
    var cats = S.league.categories;
    if (!cats.length || !players.length) return;

    // Compute league averages and std deviations per category
    var catStats = {};
    cats.forEach(function(cat) {
      var values = [];
      players.forEach(function(p) {
        var val = p.stats && p.stats[period] ? p.stats[period][cat.abbr] : null;
        if (val !== null && val !== undefined && !isNaN(val)) values.push(val);
      });
      var mean = values.length ? values.reduce(function(a, b) { return a + b; }, 0) / values.length : 0;
      var variance = values.length ? values.reduce(function(a, b) { return a + Math.pow(b - mean, 2); }, 0) / values.length : 1;
      var stdDev = Math.sqrt(variance) || 1;
      catStats[cat.abbr] = { mean: mean, stdDev: stdDev, scarcity: 1 };
    });

    // Category scarcity weights (rarer production weighted higher)
    // Based on coefficient of variation - higher CV = rarer
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

    // Compute z-scores for each player
    players.forEach(function(p) {
      p.zScores = {};
      var total = 0;
      cats.forEach(function(cat) {
        var val = p.stats && p.stats[period] ? p.stats[period][cat.abbr] : null;
        if (val !== null && val !== undefined && !isNaN(val)) {
          var z = (val - catStats[cat.abbr].mean) / catStats[cat.abbr].stdDev;
          if (cat.isNegative) z = -z; // TO: lower is better
          z *= catStats[cat.abbr].scarcity; // Weight by scarcity
          p.zScores[cat.abbr] = z;
          total += z;
        } else {
          p.zScores[cat.abbr] = 0;
        }
      });
      p.zScores.total = total;
    });

    return catStats;
  }


  // ========== ENGINE 2: MONTE CARLO MATCHUP SIMULATOR ==========

  function monteCarloMatchup(myPlayers, oppPlayers, gamesRemainingMap, simulations) {
    simulations = simulations || 5000;
    var cats = S.league.categories;
    var results = {};
    cats.forEach(function(cat) { results[cat.abbr] = { wins: 0, losses: 0, ties: 0 }; });

    // Compute per-player variance (using L7 vs season as proxy)
    function playerVariance(p, cat) {
      var season = p.stats.season ? p.stats.season[cat.abbr] : 0;
      var l7 = p.stats.last7 ? p.stats.last7[cat.abbr] : season;
      if (!season) return 0.3; // default variance
      return Math.abs(l7 - season) / Math.max(Math.abs(season), 0.1);
    }

    for (var sim = 0; sim < simulations; sim++) {
      cats.forEach(function(cat) {
        var myTotal = 0, oppTotal = 0;

        myPlayers.forEach(function(p) {
          if (p.slotId === 13) return; // Skip IR
          var avg = p.stats.season ? (p.stats.season[cat.abbr] || 0) : 0;
          var games = gamesRemainingMap ? (gamesRemainingMap[p.id] || 0) : (p.gamesRemaining || 0);
          var variance = playerVariance(p, cat);
          // Gaussian noise based on variance
          var noise = gaussianRandom() * variance * avg;
          if (cat.isPercent) {
            myTotal += avg + noise * 0.05; // Less variance for percentages
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

        // Add current scores
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

    // Convert to percentages
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


  // ========== ENGINE 3: TRADE EVALUATION ==========

  function evaluateTrade(givePlayers, getPlayers) {
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

    // Acceptance probability (how likely the other manager accepts)
    var oppDiff = -diff;
    var acceptProb;
    if (oppDiff >= 2) acceptProb = 'Very likely (90%+)';
    else if (oppDiff >= 0.5) acceptProb = 'Likely (70%)';
    else if (oppDiff >= -0.5) acceptProb = 'Coin flip (50%)';
    else if (oppDiff >= -2) acceptProb = 'Unlikely (25%)';
    else acceptProb = 'Very unlikely (<10%)';

    // Schedule value comparison
    var giveGR = 0, getGR = 0;
    givePlayers.forEach(function(p) { giveGR += p.gamesRemainingROS || 0; });
    getPlayers.forEach(function(p) { getGR += p.gamesRemainingROS || 0; });

    // Category fit analysis
    var catsHelped = [], catsHurt = [];
    cats.forEach(function(cat) {
      if (catImpact[cat.abbr].diff > 0.3) catsHelped.push(cat.abbr);
      if (catImpact[cat.abbr].diff < -0.3) catsHurt.push(cat.abbr);
    });

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
      catsHurt: catsHurt
    };
  }

  // Trade finder: scan league for mutually beneficial trades
  function findTrades(targetCats) {
    var suggestions = [];
    var myPlayers = S.myTeam.players.filter(function(p) { return p.slotId !== 13; }); // exclude IR

    S.teams.forEach(function(team) {
      if (team.teamId === S.myTeam.teamId) return;

      team.players.forEach(function(target) {
        if (!target.zScores || target.slotId === 13) return;
        // Check if target helps our weak categories
        var targetHelps = false;
        if (targetCats) {
          targetCats.forEach(function(cat) {
            if (target.zScores[cat] > 0.5) targetHelps = true;
          });
        } else {
          targetHelps = target.zScores.total > 1;
        }
        if (!targetHelps) return;

        // Find a player we'd give up that the opponent would value
        myPlayers.forEach(function(give) {
          if (!give.zScores) return;
          var result = evaluateTrade([give], [target]);
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

    // Sort by value gained
    suggestions.sort(function(a, b) { return b.result.zDiff - a.result.zDiff; });
    return suggestions.slice(0, 20);
  }


  // ========== ENGINE 4: LINEUP OPTIMIZATION ==========

  function optimizeLineup(players, date) {
    // Get players with games on the given date
    var withGames = players.filter(function(p) {
      if (p.status === 'OUT' || p.status === 'SUSPENSION') return false;
      if (date) {
        return p.schedule && p.schedule.some(function(g) { return g.date === date; });
      }
      return p.gamesToday;
    });

    var noGames = players.filter(function(p) { return !withGames.includes(p); });

    // Sort by z-score value (best players first)
    withGames.sort(function(a, b) { return (b.zScores.total || 0) - (a.zScores.total || 0); });

    // Fill slots greedily
    var slots = [];
    S.league.rosterSlots.forEach(function(rs) {
      for (var i = 0; i < rs.count; i++) {
        if (rs.slotId !== 12 && rs.slotId !== 13) { // Not bench/IR
          slots.push({ slotId: rs.slotId, name: rs.name, player: null });
        }
      }
    });

    var assigned = [];
    // First pass: assign players with games to starting slots
    withGames.forEach(function(p) {
      if (assigned.includes(p.id)) return;
      // Find best fitting slot
      var bestSlot = null;
      slots.forEach(function(slot) {
        if (slot.player) return;
        if (p.eligibleSlots.includes(slot.slotId)) {
          if (!bestSlot || slot.slotId < 11) { // Prefer position-specific over UTIL
            bestSlot = slot;
          }
        }
      });
      if (bestSlot) {
        bestSlot.player = p;
        assigned.push(p.id);
      }
    });

    // Bench: everyone not starting
    var bench = players.filter(function(p) { return !assigned.includes(p.id) && p.slotId !== 13; });
    var ir = players.filter(function(p) { return p.slotId === 13; });

    return { starters: slots, bench: bench, ir: ir, warnings: findLineupWarnings(slots, bench) };
  }

  function findLineupWarnings(starters, bench) {
    var warnings = [];
    // Check for players on bench with games while starters don't have games
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
    // Empty slots
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

    // Rank by lowest z-score on team
    var ranked = players.slice().sort(function(a, b) {
      return (a.zScores.total || 0) - (b.zScores.total || 0);
    });

    return ranked.slice(0, 5).map(function(p) {
      // Find best replacement on waivers
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
      // Must share at least one position
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
      // Sort by z-score in weak categories
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
    // Players with games on the given date, sorted by value
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
    // How volatile is each category across a set of players?
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
    // Which team produced the most value this matchup period?
    var teamScores = [];
    S.teams.forEach(function(team) {
      // Find this team's matchup and check their scores
      var matchup = S.league.schedule.find(function(m) {
        return m.matchupPeriodId === S.league.currentMatchupPeriod &&
          ((m.home && m.home.teamId === team.teamId) || (m.away && m.away.teamId === team.teamId));
      });
      if (!matchup) return;

      // Count how many categories this team would beat against every other team
      var catWins = 0;
      S.teams.forEach(function(opp) {
        if (opp.teamId === team.teamId) return;
        // Compare category totals (simplified: use roster z-scores as proxy)
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
    results.sort(function(a, b) { return a.diff - b.diff; }); // Worst matchups first
    return results;
  }

  function teamCategoryStrength(team, catAbbr) {
    // Average production in this category across starters
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
      // If we punt this category, how does our team rank in the others?
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
    // Simple projection based on current win rate
    var record = S.myTeam.record;
    var totalGames = record.wins + record.losses + record.ties;
    if (totalGames === 0) return null;
    var winRate = record.wins / totalGames;
    // Estimate remaining matchups (rough: assume 20 total matchup periods)
    var totalMatchups = 20;
    var remaining = totalMatchups - (S.league.currentMatchupPeriod || 1);
    var projectedWins = record.wins + Math.round(winRate * remaining * S.league.categories.length);
    var projectedLosses = record.losses + Math.round((1 - winRate) * remaining * S.league.categories.length);

    // Determine projected seed
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
    // For the next N days, show which players have games
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
    teamCategoryStrength: teamCategoryStrength
  };
})();
