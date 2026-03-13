// ============================================================
// LARRY v3.0 -- ESPN SYNC MODULE
// API integration, data parsing, auto-detection
// ============================================================

var ESPNSync = (function() {

  var PROXY_URL = '/.netlify/functions/espn-proxy';

  // --- FETCH THROUGH PROXY ---
  async function fetchESPN(views, extraParams) {
    var params = new URLSearchParams();
    if (views) views.forEach(function(v) { params.append('view', v); });
    if (extraParams) Object.keys(extraParams).forEach(function(k) { params.set(k, extraParams[k]); });

    var url = PROXY_URL + '?' + params.toString();
    var headers = {
      'x-espn-league-id': S.espn.leagueId,
      'x-espn-s2': S.espn.espnS2,
      'x-espn-swid': S.espn.swid,
      'x-espn-season': String(S.league.seasonId)
    };

    var resp = await fetch(url, { headers: headers });
    if (!resp.ok) throw new Error('ESPN API returned ' + resp.status);
    return await resp.json();
  }

  // --- MAIN FETCH: LEAGUE DATA ---
  async function fetchLeague() {
    return await fetchESPN([
      'mTeam', 'mRoster', 'mMatchup', 'mSettings',
      'mSchedule', 'mScoreboard', 'mStatus', 'mNav'
    ]);
  }

  // --- FETCH PLAYERS (FREE AGENTS) ---
  async function fetchPlayers(status) {
    var url = PROXY_URL + '?view=kona_player_info&scoringPeriodId=' + String(S.league.currentScoringPeriodId || 0);
    var headers = {
      'x-espn-league-id': S.espn.leagueId,
      'x-espn-s2': S.espn.espnS2,
      'x-espn-swid': S.espn.swid,
      'x-espn-season': String(S.league.seasonId),
      'x-fantasy-filter': JSON.stringify({ players: { limit: 500, filterStatus: { value: ['FREEAGENT', 'WAIVERS'] }, sortPercOwned: { sortAsc: false, sortPriority: 1 } } })
    };
    var resp = await fetch(url, { headers: headers });
    if (!resp.ok) throw new Error('ESPN API returned ' + resp.status);
    return await resp.json();
  }

  // --- PARSE LEAGUE SETTINGS ---
  function parseLeagueSettings(data) {
    if (!data || !data.settings) return;
    var settings = data.settings;
    S.league.name = settings.name || '';
    S.league.teamCount = data.teams ? data.teams.length : 0;

    // Scoring type
    var scoringTypeId = settings.scoringSettings ? settings.scoringSettings.scoringType : null;
    S.league.scoringType = scoringTypeId === 0 ? 'H2H Each Category' :
                           scoringTypeId === 1 ? 'H2H Total Points' :
                           scoringTypeId === 2 ? 'Rotisserie' : 'H2H Each Category';

    // Categories
    if (settings.scoringSettings && settings.scoringSettings.scoringItems) {
      S.league.categories = [];
      settings.scoringSettings.scoringItems.forEach(function(item) {
        var abbr = ESPN_STAT_MAP[item.statId];
        if (!abbr) return;
        var isPercent = abbr === 'FG%' || abbr === 'FT%';
        var isNegative = abbr === 'TO';
        S.league.categories.push({
          id: item.statId,
          abbr: abbr,
          isPercent: isPercent,
          isNegative: isNegative,
          color: DEFAULT_CAT_COLORS[abbr] || '#94a3b8'
        });
      });
    }

    // Roster slots
    if (settings.rosterSettings && settings.rosterSettings.lineupSlotCounts) {
      S.league.rosterSlots = [];
      var counts = settings.rosterSettings.lineupSlotCounts;
      var totalStarting = 0, benchCount = 0, irCount = 0;
      Object.keys(counts).forEach(function(slotId) {
        var count = counts[slotId];
        if (count <= 0) return;
        var name = ESPN_SLOT_MAP[parseInt(slotId)] || 'UNK';
        S.league.rosterSlots.push({ slotId: parseInt(slotId), name: name, count: count });
        if (parseInt(slotId) === 12) benchCount = count;
        else if (parseInt(slotId) === 13) irCount = count;
        else totalStarting += count;
      });
      S.league.startingSlots = totalStarting;
      S.league.benchSlots = benchCount;
      S.league.irSlots = irCount;
    }

    // Acquisition limit
    if (settings.acquisitionSettings) {
      S.league.acquisitionLimit = settings.acquisitionSettings.acquisitionLimit || -1;
    }

    // Schedule / matchup info
    if (data.status) {
      S.league.currentMatchupPeriod = data.status.currentMatchupPeriod || 0;
      S.league.currentScoringPeriodId = data.status.currentScoringPeriodId || 0;
    }

    // Playoff settings
    if (settings.scheduleSettings) {
      var sched = settings.scheduleSettings;
      S.league.playoffTeams = sched.playoffTeamCount || 0;
      S.league.matchupPeriodLength = sched.matchupPeriodLength || 7;
    }
  }

  // --- NORMALIZE SWID ---
  function normalizeSWID(swid) {
    if (!swid) return '';
    return swid.replace(/[{}]/g, '').toLowerCase().trim();
  }

  // --- PARSE TEAMS ---
  function parseTeams(data) {
    if (!data || !data.teams) return;
    S.teams = [];
    var detectedTeamId = 0;
    var normalizedSwid = normalizeSWID(S.espn.swid);

    data.teams.forEach(function(team) {
      var isMe = false;

      // Method 1: Match SWID against members -> owners chain
      if (!isMe && data.members && normalizedSwid) {
        data.members.forEach(function(m) {
          if (isMe) return;
          var normalizedMemberId = normalizeSWID(m.id);
          if (normalizedMemberId === normalizedSwid) {
            if (team.owners && team.owners.some(function(oid) {
              return normalizeSWID(oid) === normalizedMemberId;
            })) { isMe = true; }
          }
        });
      }
      // Method 2: Direct owner ID match
      if (!isMe && team.owners && normalizedSwid) {
        isMe = team.owners.some(function(oid) {
          return normalizeSWID(oid) === normalizedSwid;
        });
      }
      // Method 3: primaryOwner
      if (!isMe && team.primaryOwner && normalizedSwid) {
        isMe = normalizeSWID(team.primaryOwner) === normalizedSwid;
      }

      if (isMe) detectedTeamId = team.id;

      // Parse team players
      var players = [];
      if (team.roster && team.roster.entries) {
        team.roster.entries.forEach(function(entry) {
          var p = parsePlayer(entry);
          if (p) { p.onTeamId = team.id; players.push(p); }
        });
      }

      var record = team.record && team.record.overall ? team.record.overall : { wins: 0, losses: 0, ties: 0 };
      var ownerName = '';
      if (data.members && team.owners) {
        var ownerMember = data.members.find(function(m) {
          return team.owners.some(function(oid) { return normalizeSWID(oid) === normalizeSWID(m.id); });
        });
        if (ownerMember) ownerName = (ownerMember.firstName || '') + ' ' + (ownerMember.lastName || '');
      }

      S.teams.push({
        teamId: team.id,
        name: (team.name || team.location + ' ' + (team.nickname || '')).trim(),
        abbrev: team.abbrev || '',
        owner: ownerName.trim(),
        record: { wins: record.wins || 0, losses: record.losses || 0, ties: record.ties || 0 },
        pointsFor: record.pointsFor || team.points || 0,
        pointsAgainst: record.pointsAgainst || 0,
        playoffSeed: team.playoffSeed || 0,
        waiverRank: team.waiverRank || 0,
        players: players,
        isMyTeam: isMe
      });
    });

    // Apply team detection
    var finalTeamId = 0;
    if (S.myTeam.teamId > 0 && S.teams.some(function(t) { return t.teamId === S.myTeam.teamId; })) {
      finalTeamId = S.myTeam.teamId;
    } else if (detectedTeamId > 0) {
      finalTeamId = detectedTeamId;
    }
    if (finalTeamId > 0) applyMyTeam(finalTeamId);

    // Build allPlayers
    S.allPlayers = [];
    S.teams.forEach(function(t) {
      t.players.forEach(function(p) { S.allPlayers.push(p); });
    });
  }

  // --- APPLY SELECTED TEAM ---
  function applyMyTeam(teamId) {
    var teamObj = S.teams.find(function(t) { return t.teamId === teamId; });
    if (!teamObj) return false;
    S.myTeam.teamId = teamObj.teamId;
    S.myTeam.name = teamObj.name;
    S.myTeam.abbrev = teamObj.abbrev;
    S.myTeam.owner = teamObj.owner;
    S.myTeam.record = teamObj.record;
    S.myTeam.pointsFor = teamObj.pointsFor;
    S.myTeam.pointsAgainst = teamObj.pointsAgainst;
    S.myTeam.playoffSeed = teamObj.playoffSeed;
    S.myTeam.waiverRank = teamObj.waiverRank;
    S.myTeam.players = teamObj.players;
    return true;
  }

  function selectTeam(teamId) {
    if (applyMyTeam(teamId)) {
      if (ESPNSync._lastLeagueData) parseMatchup(ESPNSync._lastLeagueData);
      Engines.computeMatchupStrategy();
      autosave();
      return true;
    }
    return false;
  }

  // --- STAT SPLIT IDENTIFIER ---
  function identifyStatSplit(statSet) {
    var src = statSet.statSourceId;
    var split = statSet.statSplitTypeId;
    if (src === 0 && split === 0) return 'season';
    if (src === 0 && split === 1) return 'last7';
    if (src === 0 && split === 2) return 'last15';
    if (src === 0 && split === 3) return 'last30';
    if (src === 1) return 'projectedSeason';
    if (src === 2) return 'projectedMatchup';
    return null;
  }

  // --- PARSE SINGLE PLAYER ---
  function parsePlayer(entry) {
    if (!entry || !entry.playerPoolEntry || !entry.playerPoolEntry.player) return null;
    var raw = entry.playerPoolEntry.player;

    var player = {
      id: raw.id,
      name: raw.fullName || ((raw.firstName || '') + ' ' + (raw.lastName || '')).trim(),
      firstName: raw.firstName || '',
      lastName: raw.lastName || '',
      positions: [],
      eligibleSlots: (raw.eligibleSlots || []).slice(),
      defaultPositionId: raw.defaultPositionId || 0,
      proTeamId: raw.proTeamId || 0,
      nbaTeam: ESPN_TEAM_MAP[raw.proTeamId] || '???',
      status: 'ACTIVE',
      injuryStatus: raw.injuryStatus || 'ACTIVE',
      slot: ESPN_SLOT_MAP[entry.lineupSlotId] || 'BE',
      slotId: entry.lineupSlotId || 12,
      onTeamId: 0,
      percentOwned: raw.ownership ? raw.ownership.percentOwned || 0 : 0,
      stats: { season: {}, last30: {}, last15: {}, last7: {}, projectedSeason: {}, projectedMatchup: {} },
      gamesPlayed: 0,
      minutesPerGame: 0,
      schedule: [],
      gamesRemaining: 0,
      gamesToday: false,
      gameToday: null,
      zScores: {},
      trend: 'stable',
      notes: ''
    };

    // Map positions
    if (raw.eligibleSlots) {
      raw.eligibleSlots.forEach(function(sid) {
        var pos = ESPN_SLOT_MAP[sid];
        if (pos && pos !== 'BE' && pos !== 'IR' && pos !== 'UTIL' && player.positions.indexOf(pos) === -1) {
          player.positions.push(pos);
        }
      });
    }
    if (!player.positions.length && raw.defaultPositionId) {
      var defPos = ESPN_POS_MAP[raw.defaultPositionId];
      if (defPos) player.positions.push(defPos);
    }

    // Parse stats
    if (raw.stats) {
      raw.stats.forEach(function(statSet) {
        var splitName = identifyStatSplit(statSet);
        if (!splitName || !statSet.stats) return;
        var mapped = {};
        Object.keys(statSet.stats).forEach(function(espnId) {
          var abbr = ESPN_STAT_MAP[parseInt(espnId)];
          if (abbr) mapped[abbr] = statSet.stats[espnId];
        });
        player.stats[splitName] = mapped;

        // GP and MPG from season
        if (splitName === 'season') {
          player.gamesPlayed = statSet.stats['42'] || statSet.stats['40'] || mapped['GP'] || 0;
          if (player.gamesPlayed === 0 && statSet.appliedTotal) player.gamesPlayed = Math.round(statSet.appliedTotal / 20) || 0;
          player.minutesPerGame = statSet.stats['28'] || mapped['MPG'] || 0;
        }
      });
    }

    // Injury status
    if (raw.injuryStatus && raw.injuryStatus !== 'ACTIVE') {
      player.status = raw.injuryStatus;
    }

    // Note: player.schedule is initialized above to []
    // Schedule data is populated by enrichPlayerSchedules() post-pass
    // (called after S.scheduleLookup is built)

    return player;
  }

  function parsePlayerDirect(raw) {
    if (!raw || !raw.player) return null;
    var entry = { playerPoolEntry: { player: raw.player }, lineupSlotId: raw.lineupSlotId || 12 };
    var result = parsePlayer(entry);
    if (!result && raw.player.id) {
      result = {
        id: raw.player.id, name: raw.player.fullName || '',
        positions: [], nbaTeam: ESPN_TEAM_MAP[raw.player.proTeamId] || '???',
        injuryStatus: raw.player.injuryStatus || 'ACTIVE',
        stats: { season: {}, last30: {}, last7: {} }, onTeamId: 0,
        ownership: raw.player.ownership ? raw.player.ownership.percentOwned || 0 : 0
      };
    }
    return result;
  }

  // --- PARSE MATCHUP ---
  function parseMatchup(data) {
    if (!data || !data.schedule) return;
    var mp = S.league.currentMatchupPeriod;
    var myMatch = data.schedule.find(function(m) {
      return m.matchupPeriodId === mp && (
        (m.home && m.home.teamId === S.myTeam.teamId) ||
        (m.away && m.away.teamId === S.myTeam.teamId)
      );
    });

    if (myMatch) {
      S.matchup.matchupPeriodId = mp;
      var isHome = myMatch.home && myMatch.home.teamId === S.myTeam.teamId;
      var mySide = isHome ? myMatch.home : myMatch.away;
      var oppSide = isHome ? myMatch.away : myMatch.home;

      if (oppSide) {
        S.matchup.opponentTeamId = oppSide.teamId;
        var oppTeam = S.teams.find(function(t) { return t.teamId === oppSide.teamId; });
        S.matchup.opponentName = oppTeam ? oppTeam.name : 'Opponent';
      }

      // Category scores
      S.matchup.myScores = {};
      S.matchup.oppScores = {};
      var myWins = 0, myLosses = 0, myTies = 0;

      if (mySide && mySide.cumulativeScore && mySide.cumulativeScore.scoreByStat) {
        var myStats = mySide.cumulativeScore.scoreByStat;
        var oppStats = oppSide && oppSide.cumulativeScore ? oppSide.cumulativeScore.scoreByStat : {};

        S.league.categories.forEach(function(cat) {
          var myVal = myStats[String(cat.id)] ? myStats[String(cat.id)].score : 0;
          var oppVal = oppStats[String(cat.id)] ? oppStats[String(cat.id)].score : 0;
          S.matchup.myScores[cat.abbr] = myVal;
          S.matchup.oppScores[cat.abbr] = oppVal;

          if (cat.isNegative) {
            if (myVal < oppVal) myWins++;
            else if (myVal > oppVal) myLosses++;
            else myTies++;
          } else {
            if (myVal > oppVal) myWins++;
            else if (myVal < oppVal) myLosses++;
            else myTies++;
          }
        });
      }
      S.matchup.myRecord = { wins: myWins, losses: myLosses, ties: myTies };
      S.matchup.myTeamId = S.myTeam.teamId;
    }

    // Full schedule
    S.league.schedule = data.schedule.map(function(m) {
      return {
        matchupPeriodId: m.matchupPeriodId,
        home: m.home ? { teamId: m.home.teamId, wins: m.home.totalPoints || 0 } : null,
        away: m.away ? { teamId: m.away.teamId, wins: m.away.totalPoints || 0 } : null
      };
    });
  }

  // --- BUILD SCHEDULE LOOKUP FROM mScoreboard ---
  // ESPN returns scoreboard data under data.scoreboard (from mScoreboard view).
  // data.scoreboard.proGames is an object keyed by proTeamId (string) where each
  // value is an array of game objects. Each game has:
  //   - date: ISO date string (e.g. "2026-03-12T00:00:00.000Z")
  //   - proTeamIds: [awayProTeamId, homeProTeamId]
  //   - (optionally) startTimeUTCStr or gameTime for tip-off time
  // Returns: { [proTeamId]: [{ date, opponent, isHome, time }] }
  function buildScheduleLookup(data) {
    var lookup = {};
    try {
      var sb = data && data.scoreboard;
      if (!sb) return lookup;

      // Primary structure: scoreboard.proGames keyed by proTeamId string
      var proGames = sb.proGames || sb.proGamesByScoringPeriod || null;

      // proGamesByScoringPeriod is keyed by scoring period first, then by team
      // Flatten it if that's what we got
      if (proGames && !Array.isArray(proGames)) {
        var firstVal = proGames[Object.keys(proGames)[0]];
        // If firstVal is also an object (not array of game objects), it's nested by scoring period
        if (firstVal && !Array.isArray(firstVal) && typeof firstVal === 'object' && !firstVal.proTeamIds) {
          var flat = {};
          Object.keys(proGames).forEach(function(periodId) {
            var periodGames = proGames[periodId];
            if (periodGames && typeof periodGames === 'object') {
              Object.keys(periodGames).forEach(function(teamId) {
                if (!flat[teamId]) flat[teamId] = [];
                var games = periodGames[teamId];
                if (Array.isArray(games)) {
                  games.forEach(function(g) { flat[teamId].push(g); });
                }
              });
            }
          });
          proGames = flat;
        }
      }

      if (!proGames || typeof proGames !== 'object') return lookup;

      Object.keys(proGames).forEach(function(teamIdStr) {
        var teamId = parseInt(teamIdStr, 10);
        var games = proGames[teamIdStr];
        if (!Array.isArray(games)) return;

        lookup[teamId] = [];
        games.forEach(function(game) {
          // date: prefer date field, fallback to startTimestamp
          var rawDate = game.date || game.gameDate || game.startDate || '';
          if (!rawDate) return;

          // Normalize to YYYY-MM-DD local date string
          var dateObj = new Date(rawDate);
          if (isNaN(dateObj.getTime())) return;
          var dateStr = localDateStr(dateObj);

          // Determine opponent and home/away
          // proTeamIds: [awayId, homeId] based on ESPN convention
          var proTeamIds = game.proTeamIds || [];
          var awayId = proTeamIds[0] || 0;
          var homeId = proTeamIds[1] || 0;
          var isHome = homeId === teamId;
          var opponentId = isHome ? awayId : homeId;
          var opponent = ESPN_TEAM_MAP[opponentId] || ('T' + opponentId);

          // Game time: ESPN may provide startTimeUTCStr, or we format from date
          var time = '';
          if (game.startTimeUTCStr) {
            time = game.startTimeUTCStr;
          } else if (game.gameTime || game.time) {
            time = game.gameTime || game.time;
          } else if (rawDate && rawDate.indexOf('T') >= 0) {
            // Format UTC time to ET approximation (UTC-5 standard / UTC-4 daylight)
            var utcHour = dateObj.getUTCHours();
            var utcMin = dateObj.getUTCMinutes();
            // Rough ET offset: -5 (use -5, close enough for display)
            var etHour = utcHour - 5;
            if (etHour < 0) etHour += 24;
            var ampm = etHour >= 12 ? 'PM' : 'AM';
            var h = etHour % 12 || 12;
            var m = utcMin < 10 ? '0' + utcMin : String(utcMin);
            time = h + ':' + m + ' ' + ampm + ' ET';
          }

          lookup[teamId].push({
            date: dateStr,
            opponent: opponent,
            isHome: isHome,
            time: time
          });
        });
      });
    } catch (e) {
      console.warn('buildScheduleLookup error:', e.message);
    }
    return lookup;
  }

  // --- PARSE FREE AGENTS ---
  function parseFreeAgents(data) {
    S.freeAgents = [];
    if (!data || !data.players) return;
    data.players.forEach(function(entry) {
      var player = parsePlayerDirect(entry);
      if (player) {
        player.onTeamId = 0;
        S.freeAgents.push(player);
        if (!S.allPlayers.find(function(p) { return p.id === player.id; })) {
          S.allPlayers.push(player);
        }
      }
    });
  }

  // --- FULL SYNC ---
  async function syncAll() {
    try {
      updateSyncIndicator('syncing');
      var data = await fetchLeague();
      if (data) {
        ESPNSync._lastLeagueData = data;
        parseLeagueSettings(data);
        parseTeams(data);
        S.scheduleLookup = buildScheduleLookup(data);
        enrichPlayerSchedules();
        if (S.myTeam.teamId > 0) parseMatchup(data);

        // Fetch free agents to populate allPlayers for search/rankings
        try {
          var faData = await fetchPlayers();
          if (faData) {
            parseFreeAgents(faData);
            enrichPlayerSchedules();
          }
        } catch (faErr) {
          console.warn('Free agent fetch failed:', faErr.message);
        }

        enrichGamesRemaining();
        Engines.computeMatchupStrategy();
        Engines.rosProjections(S.allPlayers);

        S.espn.lastSync = new Date().toISOString();
        S.espn.connected = true;
        addSyncLog('success', 'Synced ' + S.teams.length + ' teams, ' + S.allPlayers.length + ' players');
        S.analysisCache.lastComputed = null;
        autosave();
        updateSyncIndicator('connected');
        render();
      }
    } catch (e) {
      addSyncLog('error', e.message);
      updateSyncIndicator('error');
      console.error('Sync failed:', e);
    }
  }

  // --- ENRICH ALL PLAYERS WITH SCHEDULE DATA ---
  // Called after S.scheduleLookup is built. parsePlayer runs before the lookup
  // exists, so rostered players need a post-pass to get schedule populated.
  // Free agents parsed later (parseFreeAgents) will hit the inline branch in
  // parsePlayer which already checks S.scheduleLookup.
  function enrichPlayerSchedules() {
    if (!S.scheduleLookup) return;
    var todayStr = localDateStr(new Date());
    S.allPlayers.forEach(function(p) {
      if (!p.nbaTeamId) return;
      p.schedule = S.scheduleLookup[p.nbaTeamId] || [];
      var todayGame = p.schedule.find(function(g) { return g.date === todayStr; });
      if (todayGame) {
        p.gamesToday = true;
        p.gameToday = todayGame;
      } else {
        p.gamesToday = false;
        p.gameToday = null;
      }
    });
  }

  function enrichGamesRemaining() {
    // NBA teams play ~3.5 games per week on average
    // Estimate games remaining in matchup period per player
    var matchupDates = getMatchupDates();
    var daysLeft = matchupDates.daysLeft;
    var gamesPerDay = 3.5 / 7; // ~0.5 games per day per team

    S.allPlayers.forEach(function(p) {
      // Estimate: daysLeft * gamesPerDay, rounded
      var est = Math.round(daysLeft * gamesPerDay);
      // If player has a known schedule array, use that instead
      if (p.schedule && p.schedule.length) {
        var remaining = p.schedule.filter(function(g) {
          var gDate = new Date(g.date);
          return gDate >= new Date() && gDate <= matchupDates.end;
        }).length;
        if (remaining > 0) est = remaining;
      }
      p.gamesRemaining = est;
    });

    // Update matchup games remaining totals
    var myPlayers = S.myTeam.players || [];
    var myGames = 0;
    myPlayers.forEach(function(p) { if (p.slotId < 12) myGames += (p.gamesRemaining || 0); });
    S.matchup.myGamesRemaining = myGames;

    var oppTeam = S.teams.find(function(t) { return t.teamId === S.matchup.opponentTeamId; });
    var oppGames = 0;
    if (oppTeam && oppTeam.players) {
      oppTeam.players.forEach(function(p) { if (p.slotId < 12) oppGames += (p.gamesRemaining || 0); });
    }
    S.matchup.oppGamesRemaining = oppGames;
  }

  // --- PER-GAME STAT HELPER ---
  function getPerGameStats(player, period) {
    // period: 'season' | 'last7' | 'last15' | 'last30'
    var stats = player.stats && player.stats[period] ? player.stats[period] : {};
    var gp = player.stats && player.stats[period + 'GP'] ? player.stats[period + 'GP'] : (player.gamesPlayed || 0);
    if (!gp || gp === 0) return null; // blank, not zero
    var perGame = {};
    Object.keys(stats).forEach(function(cat) {
      if (stats[cat] != null) {
        perGame[cat] = parseFloat((stats[cat] / gp).toFixed(1));
      }
    });
    return perGame;
  }

  // --- FETCH STATS FOR A SINGLE SCORING PERIOD (DAY) ---
  function fetchScoringPeriodStats(scoringPeriodId) {
    var url = PROXY_URL + '?view=kona_player_info&scoringPeriodId=' + scoringPeriodId;
    var headers = {
      'x-espn-league-id': S.espn.leagueId,
      'x-espn-s2': S.espn.espnS2,
      'x-espn-swid': S.espn.swid,
      'x-espn-season': String(S.league.seasonId)
    };
    return fetch(url, { headers: headers })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var statsMap = {};
        // Parse kona_player_info response - same structure as the free agents fetch
        // playerPoolEntries contains player objects with stats
        var entries = data && data.playerPoolEntries ? data.playerPoolEntries : [];
        entries.forEach(function(entry) {
          var id = entry.playerId || (entry.playerPoolEntry && entry.playerPoolEntry.player && entry.playerPoolEntry.player.id);
          var rawStats = entry.playerPoolEntry && entry.playerPoolEntry.player && entry.playerPoolEntry.player.stats;
          if (id && rawStats) {
            // Find stats for this specific scoring period
            var periodStats = null;
            (rawStats || []).forEach(function(s) {
              if (s.scoringPeriodId === scoringPeriodId && s.statSourceId === 0) {
                periodStats = s.stats;
              }
            });
            if (periodStats) {
              // Map ESPN stat IDs to abbreviations
              var mapped = {};
              Object.keys(periodStats).forEach(function(espnId) {
                var abbr = ESPN_STAT_MAP[parseInt(espnId)];
                if (abbr) mapped[abbr] = periodStats[espnId];
              });
              statsMap[id] = mapped;
            }
          }
        });
        return statsMap;
      });
  }

  var _lastLeagueData = null;

  return {
    fetchLeague: fetchLeague,
    fetchPlayers: fetchPlayers,
    parseLeagueSettings: parseLeagueSettings,
    parseTeams: parseTeams,
    parseMatchup: parseMatchup,
    parseFreeAgents: parseFreeAgents,
    syncAll: syncAll,
    enrichGamesRemaining: enrichGamesRemaining,
    selectTeam: selectTeam,
    applyMyTeam: applyMyTeam,
    _lastLeagueData: _lastLeagueData,
    parsePlayer: parsePlayer,
    getPerGameStats: getPerGameStats,
    fetchScoringPeriodStats: fetchScoringPeriodStats
  };
})();
