// ============================================================
// LARRY v2 -- ESPN SYNC MODULE
// API integration, data parsing, auto-detection
// ============================================================

var ESPNSync = (function() {

  var BASE_URL = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{SEASON}/segments/0/leagues/{LEAGUE}';
  var PROXY_URL = '/.netlify/functions/espn-proxy';

  function getApiUrl() {
    return BASE_URL.replace('{SEASON}', S.league.seasonId).replace('{LEAGUE}', S.espn.leagueId);
  }

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

    try {
      var resp = await fetch(url, { headers: headers });
      if (!resp.ok) throw new Error('ESPN API returned ' + resp.status);
      return await resp.json();
    } catch (e) {
      console.error('ESPN fetch failed:', e);
      // Fallback: try direct API (will fail with CORS in browser, but works with extension)
      try {
        var directUrl = getApiUrl() + '?' + params.toString();
        var directResp = await fetch(directUrl, {
          headers: {
            'Cookie': 'espn_s2=' + S.espn.espnS2 + '; SWID=' + S.espn.swid
          }
        });
        if (directResp.ok) return await directResp.json();
      } catch (e2) { /* direct failed too */ }
      throw e;
    }
  }

  // --- MAIN FETCH: LEAGUE DATA ---
  async function fetchLeague() {
    return await fetchESPN([
      'mTeam', 'mRoster', 'mMatchup', 'mSettings',
      'mSchedule', 'mScoreboard', 'mStatus', 'mNav'
    ]);
  }

  // --- FETCH PLAYERS (FREE AGENTS + ALL) ---
  async function fetchPlayers(status) {
    var filter = {
      players: {
        filterStatus: { value: status === 'freeagent' ? ['FREEAGENT'] : ['FREEAGENT', 'WAIVERS', 'ONTEAM'] },
        filterSlotIds: { value: [0,1,2,3,4,5,6,7,8,9,10,11] },
        sortPercOwned: { sortPriority: 1, sortAsc: false },
        limit: 300,
        offset: 0
      }
    };
    return await fetchESPN(['kona_player_info'], {
      'scoringPeriodId': S.league.currentScoringPeriodId || 0
    });
  }

  // --- PARSE LEAGUE SETTINGS ---
  function parseLeagueSettings(data) {
    if (!data || !data.settings) return;
    var settings = data.settings;

    S.league.name = settings.name || '';
    S.league.teamCount = data.teams ? data.teams.length : 0;

    // Scoring type
    var scoringTypeId = settings.scoringSettings ? settings.scoringSettings.scoringType : '';
    var typeMap = { 'H2H_CATEGORY': 'H2H Each Category', 'H2H_MOST_CATEGORIES': 'H2H Most Categories', 'H2H_POINTS': 'H2H Points', 'TOTAL_SEASON_POINTS': 'Roto' };
    S.league.scoringType = typeMap[scoringTypeId] || scoringTypeId || 'H2H Each Category';

    // Categories
    S.league.categories = [];
    if (settings.scoringSettings && settings.scoringSettings.scoringItems) {
      settings.scoringSettings.scoringItems.forEach(function(item) {
        var abbr = ESPN_STAT_MAP[item.statId];
        if (abbr && item.isReverseItem !== true) {
          S.league.categories.push({
            id: item.statId,
            abbr: abbr,
            name: abbr,
            color: DEFAULT_CAT_COLORS[abbr] || '#94a3b8',
            isPercent: abbr === 'FG%' || abbr === 'FT%',
            isNegative: abbr === 'TO' // turnovers = lower is better
          });
        }
      });
    }
    // If no categories parsed, default to common 9-cat
    if (S.league.categories.length === 0) {
      ['PTS','REB','AST','STL','BLK','3PM','FG%','FT%','TO'].forEach(function(abbr) {
        S.league.categories.push({
          id: ESPN_STAT_REVERSE[abbr] || 0, abbr: abbr, name: abbr,
          color: DEFAULT_CAT_COLORS[abbr] || '#94a3b8',
          isPercent: abbr === 'FG%' || abbr === 'FT%',
          isNegative: abbr === 'TO'
        });
      });
    }

    // Roster slots
    S.league.rosterSlots = [];
    S.league.startingSlots = 0;
    S.league.benchSlots = 0;
    S.league.irSlots = 0;
    if (settings.rosterSettings && settings.rosterSettings.lineupSlotCounts) {
      var counts = settings.rosterSettings.lineupSlotCounts;
      Object.keys(counts).forEach(function(slotId) {
        var ct = counts[slotId];
        if (ct > 0) {
          var name = ESPN_SLOT_MAP[slotId] || 'UNK';
          S.league.rosterSlots.push({ slotId: parseInt(slotId), name: name, count: ct });
          if (parseInt(slotId) === 12) S.league.benchSlots = ct;
          else if (parseInt(slotId) === 13) S.league.irSlots = ct;
          else S.league.startingSlots += ct;
        }
      });
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
      if (sched.playoffMatchupPeriodLength) {
        // Find playoff start
        var periods = sched.matchupPeriods || {};
        S.league.playoffStartMatchup = Object.keys(periods).length - (sched.playoffMatchupPeriodLength || 3) + 1;
      }
    }
  }

  // --- NORMALIZE SWID FOR MATCHING ---
  function normalizeSWID(swid) {
    if (!swid) return '';
    // Strip braces and lowercase for comparison
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
            // Found the member, check if they own this team
            if (team.owners && team.owners.some(function(oid) {
              return normalizeSWID(oid) === normalizedMemberId;
            })) {
              isMe = true;
            }
          }
        });
      }

      // Method 2: Direct owner ID match against SWID
      if (!isMe && team.owners && normalizedSwid) {
        isMe = team.owners.some(function(oid) {
          return normalizeSWID(oid) === normalizedSwid;
        });
      }

      // Method 3: primaryOwner field
      if (!isMe && team.primaryOwner && normalizedSwid) {
        isMe = normalizeSWID(team.primaryOwner) === normalizedSwid;
      }

      var teamObj = {
        teamId: team.id,
        name: (team.name || ((team.location || '') + ' ' + (team.nickname || '')).trim()).trim(),
        abbrev: team.abbrev || '',
        owner: '', // will set below
        record: { wins: 0, losses: 0, ties: 0 },
        pointsFor: 0,
        pointsAgainst: 0,
        playoffSeed: team.playoffSeed || 0,
        waiverRank: team.waiverRank || 0,
        players: [],
        catTotals: {} // season category totals for league comparison
      };

      if (team.record && team.record.overall) {
        teamObj.record.wins = team.record.overall.wins || 0;
        teamObj.record.losses = team.record.overall.losses || 0;
        teamObj.record.ties = team.record.overall.ties || 0;
        teamObj.pointsFor = team.record.overall.pointsFor || 0;
        teamObj.pointsAgainst = team.record.overall.pointsAgainst || 0;
      }

      // Parse roster
      if (team.roster && team.roster.entries) {
        team.roster.entries.forEach(function(entry) {
          var player = parsePlayer(entry);
          if (player) {
            player.onTeamId = team.id;
            teamObj.players.push(player);
          }
        });
      }

      S.teams.push(teamObj);
      if (isMe) {
        detectedTeamId = team.id;
      }
    });

    // Set owner names
    if (data.members) {
      data.members.forEach(function(m) {
        S.teams.forEach(function(t) {
          var rawTeam = data.teams.find(function(dt) { return dt.id === t.teamId; });
          if (rawTeam && rawTeam.owners && rawTeam.owners.some(function(oid) {
            return normalizeSWID(oid) === normalizeSWID(m.id);
          })) {
            t.owner = (m.displayName || ((m.firstName || '') + ' ' + (m.lastName || '')).trim()).trim();
          }
        });
      });
    }

    // Determine which team is ours:
    // Priority 1: Previously manually selected team
    // Priority 2: Auto-detected from SWID
    // Priority 3: 0 (will trigger team selector)
    var finalTeamId = 0;
    if (S.myTeam.teamId > 0 && S.teams.some(function(t) { return t.teamId === S.myTeam.teamId; })) {
      // User previously selected a team and it still exists in the league
      finalTeamId = S.myTeam.teamId;
    } else if (detectedTeamId > 0) {
      finalTeamId = detectedTeamId;
    }

    if (finalTeamId > 0) {
      applyMyTeam(finalTeamId);
    }
    // If finalTeamId is 0, caller will check S.myTeam.teamId and show team selector

    // Build allPlayers from all teams
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

  // --- SELECT TEAM (called from UI team picker) ---
  function selectTeam(teamId) {
    if (applyMyTeam(teamId)) {
      // Re-parse matchup with the new team context
      if (ESPNSync._lastLeagueData) {
        parseMatchup(ESPNSync._lastLeagueData);
      }
      autosave();
      return true;
    }
    return false;
  }

  // --- PARSE SINGLE PLAYER ---
  function parsePlayer(entry) {
    if (!entry || !entry.playerPoolEntry || !entry.playerPoolEntry.player) return null;
    var raw = entry.playerPoolEntry.player;
    var info = raw;

    var player = {
      id: raw.id,
      name: raw.fullName || ((raw.firstName || '') + ' ' + (raw.lastName || '')).trim(),
      firstName: raw.firstName || '',
      lastName: raw.lastName || '',
      positions: [],
      eligibleSlots: (raw.eligibleSlots || []).map(function(s) { return s; }),
      defaultPositionId: raw.defaultPositionId || 0,
      nbaTeamId: raw.proTeamId || 0,
      nbaTeam: ESPN_TEAM_MAP[raw.proTeamId] || '???',
      nbaTeamName: '',
      status: 'ACTIVE',
      injuryStatus: raw.injuryStatus || 'ACTIVE',
      injuryNote: '',
      slot: ESPN_SLOT_MAP[entry.lineupSlotId] || 'BE',
      slotId: entry.lineupSlotId || 12,
      onTeamId: 0,
      ownership: raw.ownership ? raw.ownership.percentOwned || 0 : 0,
      stats: { season: {}, last30: {}, last15: {}, last7: {}, projectedSeason: {}, projectedMatchup: {} },
      gamesPlayed: 0,
      minutesPerGame: 0,
      schedule: [],
      gamesRemaining: 0,
      gamesRemainingROS: 0,
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
        if (pos && !['BE','IR','UTIL','G','F','G/F','PF/C','SG/SF','F/C'].includes(pos) && !player.positions.includes(pos)) {
          player.positions.push(pos);
        }
      });
    }
    if (player.positions.length === 0 && raw.defaultPositionId) {
      var defPos = ESPN_POS_MAP[raw.defaultPositionId];
      if (defPos) player.positions.push(defPos);
    }

    // Injury status
    if (raw.injuryStatus) {
      player.status = raw.injuryStatus;
      player.injuryStatus = raw.injuryStatus;
    }
    if (raw.injured) player.status = player.injuryStatus || 'OUT';

    // Parse stats from different splits
    if (raw.stats) {
      raw.stats.forEach(function(statSet) {
        var splitType = detectSplit(statSet);
        if (splitType && statSet.stats) {
          var parsed = {};
          S.league.categories.forEach(function(cat) {
            var val = statSet.stats[String(cat.id)];
            if (val !== undefined) {
              // Per-game averages
              if (statSet.stats['42'] && statSet.stats['42'] > 0 && !cat.isPercent) {
                parsed[cat.abbr] = val / statSet.stats['42']; // stat / games played
              } else {
                parsed[cat.abbr] = val;
              }
            }
          });
          // Games played
          if (statSet.stats['42']) {
            if (splitType === 'season') player.gamesPlayed = statSet.stats['42'];
          }
          // Minutes
          if (statSet.stats['40']) {
            if (splitType === 'season' && statSet.stats['42'] > 0) {
              player.minutesPerGame = statSet.stats['40'] / statSet.stats['42'];
            }
          }
          player.stats[splitType] = parsed;
        }
      });
    }

    // Determine trend
    if (player.stats.last7 && player.stats.season) {
      var upCats = 0, downCats = 0;
      S.league.categories.forEach(function(cat) {
        var recent = player.stats.last7[cat.abbr];
        var season = player.stats.season[cat.abbr];
        if (recent && season && season !== 0) {
          var pctChange = (recent - season) / Math.abs(season);
          if (cat.isNegative) pctChange = -pctChange;
          if (pctChange > 0.15) upCats++;
          if (pctChange < -0.15) downCats++;
        }
      });
      if (upCats >= 3) player.trend = 'hot';
      else if (downCats >= 3) player.trend = 'cold';
    }

    return player;
  }

  function detectSplit(statSet) {
    // ESPN uses statSourceId + statSplitTypeId
    // 0/0 = season actual, 0/1 = last 7, 0/2 = last 15, 0/3 = last 30
    // 1/0 = projected season, 2/0 = projected matchup
    var src = statSet.statSourceId;
    var split = statSet.statSplitTypeId;
    if (src === 0 && split === 0) return 'season';
    if (src === 0 && split === 1) return 'last7';
    if (src === 0 && split === 2) return 'last15';
    if (src === 0 && split === 3) return 'last30';
    if (src === 1) return 'projectedSeason';
    if (src === 2) return 'projectedMatchup';
    // Fallback: check appliedTotal
    if (statSet.id && statSet.id.includes && statSet.id.includes('last')) return 'last30';
    return null;
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

          // Determine winner (handle TO where lower is better)
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

    // Parse full schedule for league overview
    S.league.schedule = data.schedule.map(function(m) {
      return {
        matchupPeriodId: m.matchupPeriodId,
        home: m.home ? { teamId: m.home.teamId, wins: (m.home.totalPoints || 0) } : null,
        away: m.away ? { teamId: m.away.teamId, wins: (m.away.totalPoints || 0) } : null
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
        // Add to allPlayers if not already there
        if (!S.allPlayers.find(function(p) { return p.id === player.id; })) {
          S.allPlayers.push(player);
        }
      }
    });
  }

  function parsePlayerDirect(raw) {
    if (!raw || !raw.player) return null;
    var p = raw.player;
    // Similar to parsePlayer but different structure (no playerPoolEntry wrapper)
    var entry = { playerPoolEntry: { player: p }, lineupSlotId: raw.lineupSlotId || 12 };
    // Reuse parsePlayer with adapted structure
    var result = parsePlayer(entry);
    if (!result && p.id) {
      // Minimal fallback
      result = {
        id: p.id,
        name: p.fullName || '',
        positions: [],
        nbaTeam: ESPN_TEAM_MAP[p.proTeamId] || '???',
        stats: { season: {}, last30: {}, last7: {} },
        onTeamId: 0,
        ownership: p.ownership ? p.ownership.percentOwned || 0 : 0
      };
    }
    return result;
  }

  // --- FULL SYNC ---
  async function syncAll() {
    try {
      updateSyncIndicator();
      var data = await fetchLeague();
      if (data) {
        // Store raw data for re-parsing after team selection
        ESPNSync._lastLeagueData = data;

        parseLeagueSettings(data);
        parseTeams(data);

        // If no team detected, don't parse matchup yet (need team selection first)
        if (S.myTeam.teamId > 0) {
          parseMatchup(data);
        }

        S.espn.lastSync = new Date().toISOString();
        S.espn.connected = true;
        addSyncLog('success', 'Synced ' + S.teams.length + ' teams, ' + S.allPlayers.length + ' players' + (S.myTeam.teamId > 0 ? '' : ' (team selection needed)'));

        // Invalidate analysis cache
        S.analysisCache.lastComputed = null;

        autosave();
        updateSyncIndicator();
        render();
      }
    } catch (e) {
      addSyncLog('error', e.message);
      console.error('Sync failed:', e);
    }
  }

  // Store last raw ESPN response for re-parsing
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
    _lastLeagueData: _lastLeagueData
  };
})();
