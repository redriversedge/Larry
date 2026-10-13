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
    if (!resp.ok) {
      // Phase 2: 401 from ESPN means cookies expired. Surface a banner
      // via the cookieExpired flag instead of failing silently.
      if (resp.status === 401 && typeof setEspnExpired === 'function') {
        setEspnExpired(true);
      }
      throw new Error('ESPN API returned ' + resp.status);
    }
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
    if (!resp.ok) {
      if (resp.status === 401 && typeof setEspnExpired === 'function') {
        setEspnExpired(true);
      }
      throw new Error('ESPN API returned ' + resp.status);
    }
    return await resp.json();
  }

  // --- PARSE LEAGUE SETTINGS ---
  function parseLeagueSettings(data) {
    if (!data || !data.settings) return;
    var settings = data.settings;
    S.league.name = settings.name || '';
    S.league.teamCount = data.teams ? data.teams.length : 0;

    // ESPN is authoritative for the season. computeSeasonId() only seeds the
    // first request; once the league responds we use what it tells us.
    if (data.seasonId) S.league.seasonId = data.seasonId;
    if (data.segmentId !== undefined) S.league.segmentId = data.segmentId;

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

  var FULL_SEASON_GAMES = 82;

  // Stats that must NOT be divided by games played. Percentages are already
  // rates, and GP/GS are game counts rather than accumulated production.
  var NON_RATE_STATS = { 'FG%': 1, 'FT%': 1, 'GP': 1, 'GS': 1 };

  // Games played for one split. Stat id 42 is games played; the id-40 slot is
  // minutes and was once used as a fallback here, which silently divided
  // every rate by roughly 30x too much. appliedTotal/20 is a last-resort
  // estimate for splits that report neither.
  function splitGamesPlayed(statSet, mapped) {
    var gp = statSet.stats['42'];
    if (!gp && typeof mapped['GP'] === 'number') gp = mapped['GP'];
    if (!gp && statSet.appliedTotal) gp = Math.round(statSet.appliedTotal / 20);
    return gp || 0;
  }

  // Divide counting stats by games, pass rates through untouched. With no
  // games the split has no rate to report, so counting stats come back 0.
  function toPerGameStats(totals, gp) {
    var perGame = {};
    if (!totals) return perGame;
    Object.keys(totals).forEach(function(key) {
      var val = totals[key];
      if (typeof val !== 'number' || !isFinite(val)) { perGame[key] = val; return; }
      if (NON_RATE_STATS[key]) { perGame[key] = val; return; }
      perGame[key] = gp > 0 ? val / gp : 0;
    });
    return perGame;
  }

  // Convert one already-stored player from the pre-3.9.0 totals shape to the
  // per-game shape. Called by the loadState migration so an existing
  // larry_state does not have to be thrown away. Idempotent: a player that
  // already carries stats.totals is left alone.
  function migrateStatsToPerGame(player) {
    if (!player || !player.stats) return false;
    if (player.stats.totals) return false; // already migrated
    var splits = ['season', 'last30', 'last15', 'last7'];
    var totals = {};
    var gpBySplit = {};
    var seasonGP = player.gamesPlayed || 0;
    for (var i = 0; i < splits.length; i++) {
      var name = splits[i];
      var raw = player.stats[name];
      if (!raw) continue;
      totals[name] = raw;
      // Pre-migration state only tracked season GP, so that is the best
      // divisor available for the recent splits. They get refreshed with
      // real per-split counts on the next sync.
      gpBySplit[name] = seasonGP;
      player.stats[name] = toPerGameStats(raw, seasonGP);
    }
    player.stats.totals = totals;
    player.stats.gp = gpBySplit;
    if (player.stats.projectedSeason) {
      player.stats.projectedPerGame =
        toPerGameStats(player.stats.projectedSeason, FULL_SEASON_GAMES);
    }
    return true;
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
      // season/last30/last15/last7 hold PER-GAME rates; raw split totals live
      // under stats.totals and each split's game count under stats.gp.
      stats: {
        season: {}, last30: {}, last15: {}, last7: {},
        projectedSeason: {}, projectedMatchup: {}, projectedPerGame: {},
        totals: {}, gp: {}
      },
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

    // Parse stats.
    //
    // ESPN returns counting stats as split TOTALS. Almost every consumer in
    // this app wants per-game rates, and most of them used to read the totals
    // as if they already were rates: the matchup engine multiplied a season
    // total by games remaining, which is why every category read "Target" and
    // ROS projected Towns at 78,905 points.
    //
    // So normalization happens once, here, at the boundary:
    //   stats.<split>        per-game rates  (what everything should read)
    //   stats.totals.<split> raw totals      (for anything that needs them)
    //   stats.gp.<split>     games in that split
    //
    // Each split is divided by its OWN games played, not the season's. Last-7
    // totals over the season's 65 games would understate a hot streak by an
    // order of magnitude.
    if (raw.stats) {
      raw.stats.forEach(function(statSet) {
        var splitName = identifyStatSplit(statSet);
        if (!splitName || !statSet.stats) return;
        var mapped = {};
        Object.keys(statSet.stats).forEach(function(espnId) {
          var abbr = ESPN_STAT_MAP[parseInt(espnId)];
          if (abbr) mapped[abbr] = statSet.stats[espnId];
        });

        var splitGP = splitGamesPlayed(statSet, mapped);
        player.stats.totals[splitName] = mapped;
        player.stats.gp[splitName] = splitGP;
        player.stats[splitName] = toPerGameStats(mapped, splitGP);

        // Season GP and MPG are promoted to the player for convenience; a lot
        // of code reads p.gamesPlayed directly.
        if (splitName === 'season') {
          player.gamesPlayed = splitGP;
          player.minutesPerGame = statSet.stats['28'] ||
            (splitGP > 0 && typeof mapped['MIN'] === 'number' ? mapped['MIN'] / splitGP : 0);
        }
      });

      // Projections stay as totals (they describe a full season, not a
      // sample), with a per-game companion for the ranking engine's gp=0
      // fallback path.
      var projTotals = player.stats.totals.projectedSeason;
      if (projTotals) {
        player.stats.projectedSeason = projTotals;
        player.stats.projectedPerGame = toPerGameStats(projTotals, FULL_SEASON_GAMES);
      }
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
        stats: {
          season: {}, last30: {}, last15: {}, last7: {},
          projectedSeason: {}, projectedMatchup: {}, projectedPerGame: {},
          totals: {}, gp: {}
        }, onTeamId: 0, gamesPlayed: 0,
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
            // Render in the user's own timezone. This used to subtract a flat
            // 5 hours and label the result "ET", which was wrong for every
            // user outside Eastern and wrong for everyone during daylight
            // time. toLocaleTimeString handles both.
            time = dateObj.toLocaleTimeString([], {
              hour: 'numeric', minute: '2-digit'
            });
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
        // Phase 2: clear the expired-cookies flag on successful sync.
        S.espn.cookieExpired = false;
        // Fresh data clears the migration / stale-season prompt.
        S.needsResync = false;
        S.resyncReason = '';
        S.resyncDismissed = false;
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
      // parsePlayer stores the NBA team under proTeamId. This used to read
      // p.nbaTeamId, which is never assigned anywhere, so the guard returned
      // early for every player and all 666 ended up with an empty schedule.
      // That in turn made gamesRemaining a constant for the whole league.
      if (!p.proTeamId) return;
      p.schedule = S.scheduleLookup[p.proTeamId] || [];
      var todayGame = null;
      for (var i = 0; i < p.schedule.length; i++) {
        if (p.schedule[i].date === todayStr) { todayGame = p.schedule[i]; break; }
      }
      p.gamesToday = !!todayGame;
      p.gameToday = todayGame;
    });
  }

  // Last day of the NBA regular season, as a local YYYY-MM-DD string. ESPN's
  // seasonId is the calendar year the season ends in, so the 2026-27 season
  // carries seasonId 2027 and ends in April 2027. Mid-April is close enough:
  // this only bounds a game count that the real schedule already limits.
  function seasonEndDateStr() {
    var endYear = (S.league && S.league.seasonId) || new Date().getFullYear();
    return String(endYear) + '-04-15';
  }

  // Count real games between today and a cutoff, comparing local YYYY-MM-DD
  // strings. Never parse these with new Date('YYYY-MM-DD'): that reads as UTC
  // midnight, so in US Central the comparison drops today's games after 7pm.
  function countGamesInRange(schedule, fromStr, toStr) {
    if (!schedule || !schedule.length) return 0;
    var n = 0;
    for (var i = 0; i < schedule.length; i++) {
      var d = schedule[i].date;
      if (!d) continue;
      if (d >= fromStr && d <= toStr) n++;
    }
    return n;
  }

  function enrichGamesRemaining() {
    var matchupDates = getMatchupDates();
    var todayStr = localDateStr(new Date());
    var endStr = matchupDates.end ? localDateStr(matchupDates.end) : todayStr;
    // Fallback only for players with no schedule at all: NBA teams average
    // ~3.5 games a week.
    var estFallback = Math.round((matchupDates.daysLeft || 0) * (3.5 / 7));
    var seasonEndStr = seasonEndDateStr();

    S.allPlayers.forEach(function(p) {
      if (p.schedule && p.schedule.length) {
        p.gamesRemaining = countGamesInRange(p.schedule, todayStr, endStr);
        // Rest-of-season count. Referenced by ROS projections, which until
        // now read an undefined value.
        p.gamesRemainingROS = countGamesInRange(p.schedule, todayStr, seasonEndStr);
      } else {
        p.gamesRemaining = estFallback;
        p.gamesRemainingROS = 0;
      }
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
  // stats.<split> is already per-game as of the parse-time normalization, so
  // this no longer divides. It still rounds for display and still returns
  // null when the split has no games, so callers can render a blank rather
  // than a misleading 0.0.
  function getPerGameStats(player, period) {
    // period: 'season' | 'last7' | 'last15' | 'last30'
    var stats = player.stats && player.stats[period] ? player.stats[period] : {};
    var gp = splitGP(player, period);
    if (!gp) return null; // blank, not zero
    var perGame = {};
    Object.keys(stats).forEach(function(cat) {
      if (stats[cat] != null) {
        perGame[cat] = typeof stats[cat] === 'number' ?
          parseFloat(stats[cat].toFixed(1)) : stats[cat];
      }
    });
    return perGame;
  }

  // Games played in a split, falling back to the season count for splits that
  // predate the stats.gp bookkeeping.
  function splitGP(player, period) {
    if (!player || !player.stats) return 0;
    if (player.stats.gp && typeof player.stats.gp[period] === 'number') {
      return player.stats.gp[period];
    }
    return player.gamesPlayed || 0;
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
    splitGP: splitGP,
    toPerGameStats: toPerGameStats,
    migrateStatsToPerGame: migrateStatsToPerGame,
    fetchScoringPeriodStats: fetchScoringPeriodStats
  };
})();
