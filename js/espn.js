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
    return await fetchESPN(['kona_player_info'], {
      'scoringPeriodId': String(S.league.currentScoringPeriodId || 0)
    });
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
      nbaTeamId: raw.proTeamId || 0,
      nbaTeam: ESPN_TEAM_MAP[raw.proTeamId] || '???',
      status: 'ACTIVE',
      injuryStatus: raw.injuryStatus || 'ACTIVE',
      slot: ESPN_SLOT_MAP[entry.lineupSlotId] || 'BE',
      slotId: entry.lineupSlotId || 12,
      onTeamId: 0,
      ownership: raw.ownership ? raw.ownership.percentOwned || 0 : 0,
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

    // Today's game - check proTeamId schedule
    player.gamesToday = false;
    player.gameToday = null;
    if (raw.proTeamId) {
      // ESPN schedule data comes from mScoreboard
      // We mark this in the enrichment phase after full data is loaded
    }

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
        if (S.myTeam.teamId > 0) parseMatchup(data);
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

  var _lastLeagueData = null;

  return {
    fetchLeague: fetchLeague,
    fetchPlayers: fetchPlayers,
    parseLeagueSettings: parseLeagueSettings,
    parseTeams: parseTeams,
    parseMatchup: parseMatchup,
    parseFreeAgents: parseFreeAgents,
    syncAll: syncAll,
    selectTeam: selectTeam,
    applyMyTeam: applyMyTeam,
    _lastLeagueData: _lastLeagueData,
    parsePlayer: parsePlayer
  };
})();
