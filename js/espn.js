// ============================================================
// LARRY v3.0 -- ESPN SYNC MODULE
// API integration, data parsing, auto-detection
// ============================================================

var ESPNSync = (function() {

  var PROXY_URL = '/.netlify/functions/espn-proxy';

  // --- FETCH THROUGH PROXY ---
  // seasonOverride lets the rollover probe ask ESPN about a season other
  // than the one currently in state, without writing it to state first.
  async function fetchESPN(views, extraParams, seasonOverride) {
    var params = new URLSearchParams();
    if (views) views.forEach(function(v) { params.append('view', v); });
    if (extraParams) Object.keys(extraParams).forEach(function(k) { params.set(k, extraParams[k]); });

    var url = PROXY_URL + '?' + params.toString();
    var headers = {
      'x-espn-league-id': S.espn.leagueId,
      'x-espn-s2': S.espn.espnS2,
      'x-espn-swid': S.espn.swid,
      'x-espn-season': String(seasonOverride || S.league.seasonId)
    };

    var resp = await fetch(url, { headers: headers });
    if (!resp.ok) {
      // Phase 2: 401 from ESPN means cookies expired. Surface a banner
      // via the cookieExpired flag instead of failing silently.
      if (resp.status === 401 && typeof setEspnExpired === 'function') {
        setEspnExpired(true);
      }
      var err = new Error('ESPN API returned ' + resp.status);
      err.status = resp.status;
      throw err;
    }
    return await resp.json();
  }

  // Season-scoped fetch: no league id, no cookies. Only views on the
  // proxy's allowlist are permitted.
  async function fetchSeasonView(view, seasonId) {
    var url = PROXY_URL + '?view=' + encodeURIComponent(view);
    var resp = await fetch(url, {
      headers: {
        'x-espn-scope': 'season',
        'x-espn-season': String(seasonId || S.league.seasonId)
      }
    });
    if (!resp.ok) {
      var err = new Error('ESPN season fetch returned ' + resp.status);
      err.status = resp.status;
      throw err;
    }
    return await resp.json();
  }

  // --- SEASON ROLLOVER ---
  //
  // computeSeasonId() only ever seeded initState(). An existing install kept
  // S.league.seasonId at last season forever: every fetch sent that season,
  // ESPN answered for that season, and parseLeagueSettings wrote the same
  // value straight back. Nothing ever asked for the new season, so the
  // "sync to load 2027" banner could never clear no matter how many times
  // you tapped Sync.
  //
  // The fix is to probe before syncing. Pure decision logic, no I/O, so it
  // is testable.
  function rollOverDecision(storedSeason, computedSeason, probeStatus) {
    if (!storedSeason || storedSeason === computedSeason) {
      return { action: 'keep', season: computedSeason || storedSeason };
    }
    if (probeStatus === 200) {
      return { action: 'adopt', season: computedSeason };
    }
    if (probeStatus === 404) {
      // The new season's league does not exist yet. ESPN creates it when the
      // manager renews, which can be weeks after the calendar rolls over.
      return {
        action: 'not-open',
        season: storedSeason,
        reason: "ESPN hasn't opened your " + computedSeason + ' league yet.'
      };
    }
    // Anything else (401, 500, offline) is not evidence about the season.
    return { action: 'keep', season: storedSeason };
  }

  // Everything that belongs to one season and must not survive a rollover.
  // S.espn (credentials), S.prefs and S.watchlist are deliberately kept.
  function clearSeasonScopedState() {
    S.matchup = {};
    S.myTeam.players = [];
    S.myTeam.record = null;
    (S.teams || []).forEach(function(t) { t.players = []; });
    S.teams = [];
    S.allPlayers = [];
    S.freeAgents = [];
    S.scheduleLookup = {};
    S.analysisCache = {
      zScores: null, monteCarlo: null, durant: null, recommendations: null,
      puntAnalysis: null, lastComputed: null,
      durantComputedAt: null, durantPlayerCount: 0, larryMove: null
    };
    S.needsResync = false;
    S.resyncReason = '';
    S.resyncDismissed = false;
    S.league.schedule = [];
  }

  // Probe the computed season before syncing. Returns the season to use.
  async function resolveSeason() {
    var stored = S.league.seasonId;
    var computed = computeSeasonId();
    if (stored === computed) return { season: stored, rolled: false };

    var status = 0;
    try {
      // mSettings is the cheapest view that proves the league exists.
      await fetchESPN(['mSettings'], null, computed);
      status = 200;
    } catch (e) {
      status = e.status || 0;
    }

    var decision = rollOverDecision(stored, computed, status);
    if (decision.action === 'adopt') {
      addSyncLog('success', 'Rolling over to the ' + computed + ' season');
      clearSeasonScopedState();
      S.league.seasonId = computed;
      return { season: computed, rolled: true };
    }
    if (decision.action === 'not-open') {
      S.needsResync = true;
      S.resyncReason = decision.reason;
      S.resyncDismissed = false;
      S.seasonNotOpen = true;
      return { season: stored, rolled: false };
    }
    return { season: decision.season, rolled: false };
  }

  // --- MAIN FETCH: LEAGUE DATA ---
  async function fetchLeague() {
    return await fetchESPN([
      'mTeam', 'mRoster', 'mMatchup', 'mSettings',
      'mSchedule', 'mScoreboard', 'mStatus', 'mNav'
    ]);
  }

  // Pre-draft the whole league is on the wire, so pull a deeper pool.
  function freeAgentFetchLimit() {
    var drafted = ((S.myTeam && S.myTeam.players) || []).length;
    return drafted ? 500 : 1000;
  }

  // --- FETCH PLAYERS (FREE AGENTS) ---
  async function fetchPlayers(status) {
    var url = PROXY_URL + '?view=kona_player_info&scoringPeriodId=' + String(S.league.currentScoringPeriodId || 0);
    var headers = {
      'x-espn-league-id': S.espn.leagueId,
      'x-espn-s2': S.espn.espnS2,
      'x-espn-swid': S.espn.swid,
      'x-espn-season': String(S.league.seasonId),
      // Before the draft every NBA player is a free agent, so a 500 cap
      // truncates the pool to the 500 most-owned and hides deep sleepers
      // exactly when the draft board matters most. Pull more pre-draft,
      // then drop back once rosters exist and the pool is naturally small.
      'x-fantasy-filter': JSON.stringify({
        players: {
          limit: freeAgentFetchLimit(),
          filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
          sortPercOwned: { sortAsc: false, sortPriority: 1 }
        }
      })
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

    // Acquisition limits. There are two and they mean different things:
    // acquisitionLimit is the season cap (-1 for unlimited), while
    // matchupAcquisitionLimit is pickups allowed per matchup. Only the
    // season one was being read, so Larry's Move was always told "unlimited"
    // for a league that actually allows 3 per matchup.
    if (settings.acquisitionSettings) {
      var acq = settings.acquisitionSettings;
      S.league.acquisitionLimit = acq.acquisitionLimit === undefined ? -1 : acq.acquisitionLimit;
      S.league.matchupAcquisitionLimit =
        acq.matchupAcquisitionLimit === undefined ? -1 : acq.matchupAcquisitionLimit;
    }

    // Lineup lock type. Was hard-coded to 'daily' on the way to Larry's
    // Move; INDIVIDUAL_GAME means a slot locks when that player's game
    // tips, so late games can still be swapped after early ones start.
    if (settings.rosterSettings) {
      S.league.lineupLocktimeType =
        settings.rosterSettings.lineupLocktimeType || 'INDIVIDUAL_GAME';
    }

    // Draft date, for the pre-draft Larry's Move message.
    if (settings.draftSettings && settings.draftSettings.date) {
      S.league.draftDate = settings.draftSettings.date;
    }

    // Schedule / matchup info
    if (data.status) {
      S.league.currentMatchupPeriod = data.status.currentMatchupPeriod || 0;
      S.league.currentScoringPeriodId = data.status.currentScoringPeriodId || 0;
      if (data.status.firstScoringPeriod) {
        S.league.firstScoringPeriod = data.status.firstScoringPeriod;
      }
    }

    // Playoff settings and the real matchup period map.
    if (settings.scheduleSettings) {
      var sched = settings.scheduleSettings;
      S.league.playoffTeams = sched.playoffTeamCount || 0;
      S.league.matchupPeriodLength = sched.matchupPeriodLength || 7;
      // matchupPeriods maps each matchup to the scoring-period weeks it
      // spans, e.g. {"18":[18,19]} for a two-week playoff round. Without
      // this, "games this week" assumed a Monday-to-Sunday calendar week
      // and silently halved every multi-week playoff matchup.
      if (sched.matchupPeriods) {
        S.league.matchupPeriods = sched.matchupPeriods;
      }
    }
  }

  // --- ACQUISITION COUNTS ---
  // ESPN reports these on the team's transactionCounter in the mTeam view.
  function seasonAcquisitions(team) {
    var tc = team && team.transactionCounter;
    if (!tc) return 0;
    return tc.acquisitions || 0;
  }

  // Pickups used in the CURRENT matchup period. matchupAcquisitionTotals is
  // keyed by matchup period id.
  function matchupAcquisitions(team) {
    var tc = team && team.transactionCounter;
    if (!tc) return 0;
    var totals = tc.matchupAcquisitionTotals;
    if (!totals) return 0;
    var mp = (S.league && S.league.currentMatchupPeriod) || 0;
    var v = totals[String(mp)];
    return typeof v === 'number' ? v : 0;
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
        // Season-long and this-matchup pickup counts. Larry's Move needs
        // the matchup one to know whether a suggested add would spend the
        // user's last pickup; it was reading S.myTeam.acquisitions, a field
        // that never existed, so it always saw 0.
        acquisitionsUsed: seasonAcquisitions(team),
        matchupAcquisitionsUsed: matchupAcquisitions(team),
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
    S.myTeam.acquisitionsUsed = teamObj.acquisitionsUsed || 0;
    S.myTeam.matchupAcquisitionsUsed = teamObj.matchupAcquisitionsUsed || 0;
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

  // --- NBA SCHEDULE ---
  //
  // The old builder read data.scoreboard.proGames from the league-scoped
  // mScoreboard view. ESPN does not return that for this league, so
  // S.scheduleLookup was always empty, every player had schedule: [], and
  // gamesRemaining fell back to a constant for all 666 players. Everything
  // downstream (streaming, schedule advantage, ROS projections, Larry's
  // Move) was running on that estimate.
  //
  // proTeamSchedules_wl is a season-level endpoint that returns the real
  // full-season schedule for all 30 teams. No cookies needed.
  //
  // Shape: settings.proTeams[] with { id, abbrev, proGamesByScoringPeriod }
  // keyed by scoring period, each a list of
  // { id, date (epoch ms), homeProTeamId, awayProTeamId, scoringPeriodId }.
  function buildScheduleLookup(data) {
    var lookup = {};
    var teams = data && data.settings && data.settings.proTeams;
    if (!teams || !teams.length) return lookup;

    for (var t = 0; t < teams.length; t++) {
      var team = teams[t];
      if (!team || !team.id) continue;
      var byPeriod = team.proGamesByScoringPeriod;
      if (!byPeriod) continue;

      var games = [];
      var periods = Object.keys(byPeriod);
      for (var p = 0; p < periods.length; p++) {
        var list = byPeriod[periods[p]];
        if (!list || !list.length) continue;
        for (var g = 0; g < list.length; g++) {
          var game = list[g];
          if (!game || !game.date) continue;
          var isHome = game.homeProTeamId === team.id;
          var oppId = isHome ? game.awayProTeamId : game.homeProTeamId;
          // Epoch ms -> LOCAL date string. Never toISOString: that yields a
          // UTC date, which is the previous day for an evening game in US
          // Central and silently drops today's games after 7pm.
          var when = new Date(game.date);
          games.push({
            date: localDateStr(when),
            timeLocal: game.startTimeTBD ? '' :
              when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
            opponent: ESPN_TEAM_MAP[oppId] || '???',
            opponentId: oppId,
            isHome: isHome,
            scoringPeriodId: game.scoringPeriodId || Number(periods[p]) || 0
          });
        }
      }
      games.sort(function(a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
      lookup[team.id] = games;
    }
    return lookup;
  }

  // Schedules are the same for everyone and barely change, so fetch once per
  // season and reuse. Keyed by season so a rollover refetches.
  async function loadNbaSchedule() {
    if (S.scheduleLookup && S.scheduleSeasonId === S.league.seasonId &&
        Object.keys(S.scheduleLookup).length) {
      return;
    }
    try {
      var data = await fetchSeasonView('proTeamSchedules_wl', S.league.seasonId);
      var lookup = buildScheduleLookup(data);
      var teamCount = Object.keys(lookup).length;
      if (teamCount) {
        S.scheduleLookup = lookup;
        S.scheduleSeasonId = S.league.seasonId;
        addSyncLog('success', 'Loaded NBA schedule for ' + teamCount + ' teams');
      } else {
        console.warn('proTeamSchedules_wl returned no usable teams');
      }
    } catch (e) {
      // Not fatal: gamesRemaining falls back to an estimate.
      console.warn('NBA schedule fetch failed:', e.message);
      addSyncLog('error', 'Could not load the NBA schedule; using estimates');
    }
  }

  // --- FULL SYNC ---
  async function syncAll() {
    if (SYNC_IN_PROGRESS) return;
    SYNC_IN_PROGRESS = true;
    try {
      updateSyncIndicator('syncing');

      // Decide which season we are in BEFORE fetching anything, or an
      // existing install can never leave last season.
      var seasonInfo = await resolveSeason();

      var data = await fetchLeague();
      if (data) {
        ESPNSync._lastLeagueData = data;
        parseLeagueSettings(data);
        parseTeams(data);

        await loadNbaSchedule();
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

        // Rank before anything reads ranks. The sync clears
        // durantComputedAt, and only render paths called ensureDURANT, so
        // opening Larry chat or the Move card first after a sync sent
        // durantRank and durantScore as undefined.
        Engines.ensureDURANT(S.allPlayers);
        Engines.computeMatchupStrategy();
        Engines.rosProjections(S.allPlayers);

        S.espn.lastSync = new Date().toISOString();
        S.espn.connected = true;
        // Phase 2: clear the expired-cookies flag on successful sync.
        S.espn.cookieExpired = false;
        // Fresh data clears the migration prompt. The season-not-open
        // notice is the exception: a successful sync of LAST season does
        // not mean the new one has opened.
        if (!S.seasonNotOpen) {
          S.needsResync = false;
          S.resyncReason = '';
          S.resyncDismissed = false;
        }
        addSyncLog('success', 'Synced ' + S.teams.length + ' teams, ' +
          S.allPlayers.length + ' players' +
          (seasonInfo.rolled ? ' (' + S.league.seasonId + ' season)' : ''));
        S.analysisCache.lastComputed = null;
        autosave();
        updateSyncIndicator('connected');
        render();
      }
    } catch (e) {
      addSyncLog('error', e.message);
      updateSyncIndicator('error');
      console.error('Sync failed:', e);
    } finally {
      SYNC_IN_PROGRESS = false;
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

  // --- MATCHUP WINDOWS ---
  //
  // "Games this week" has to mean "games in my current matchup", which is
  // not the same thing as the calendar week. Before opening night the
  // calendar week contains no NBA games at all, so every player showed 0.
  //
  // ESPN has two period concepts and they are very easy to confuse:
  //
  //   SCORING PERIOD  a single DAY. Period 1 is opening night (Tue Oct 20
  //                   2026), 2 is Oct 21, 3 is Oct 22, up to 174 on
  //                   Apr 11 2027.
  //   MATCHUP PERIOD  one head-to-head matchup. scheduleSettings
  //                   .matchupPeriods maps each one to the list of WEEKS it
  //                   covers: {"1":[1], "2":[2], ... "18":[18,19]}.
  //
  // Those week numbers were previously read as scoring periods. Because a
  // scoring period is a single day, matchup 1 came out one day long (Oct 20
  // instead of Oct 20 to 25) and the two-week playoff matchups came out two
  // days long. Live symptom: 168 of 1000 players had exactly 1 game this
  // matchup and Jokic had 0 despite playing Oct 22 and Oct 24.
  //
  // So the chain is weeks -> day range -> count games by local date string.

  // Local YYYY-MM-DD to a local Date. Never new Date('YYYY-MM-DD'): that
  // parses as UTC midnight, which lands on the previous day in US Central.
  function parseDateStr(str) {
    var parts = String(str || '').split('-');
    if (parts.length !== 3) return null;
    var y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
    if (!isFinite(y) || !isFinite(m) || !isFinite(d)) return null;
    return new Date(y, m - 1, d);
  }

  function addDaysStr(str, n) {
    var d = parseDateStr(str);
    if (!d) return null;
    d.setDate(d.getDate() + n);
    return localDateStr(d);
  }

  // The matchup period's weeks. Values are week numbers, not scoring periods.
  function matchupWeeks(matchupPeriodId) {
    var map = S.league && S.league.matchupPeriods;
    if (map) {
      var entry = map[String(matchupPeriodId)];
      if (entry && entry.length) {
        var out = [];
        for (var i = 0; i < entry.length; i++) {
          var n = Number(entry[i]);
          if (isFinite(n) && n > 0) out.push(n);
        }
        if (out.length) return out;
      }
    }
    // No map: one week per matchup, which is ESPN's default schedule.
    var only = Number(matchupPeriodId);
    return isFinite(only) && only > 0 ? [only] : [];
  }

  // Opening night as a local date string: the first scoring period's date.
  // Games carry scoringPeriodId, so prefer that; the earliest game on the
  // whole calendar is the same date and covers a missing id.
  function openingNightStr() {
    if (!S.scheduleLookup) return null;
    var first = (S.league && Number(S.league.firstScoringPeriod)) || 1;
    var exact = null, earliest = null;
    var teamIds = Object.keys(S.scheduleLookup);
    for (var t = 0; t < teamIds.length; t++) {
      var games = S.scheduleLookup[teamIds[t]] || [];
      for (var g = 0; g < games.length; g++) {
        var d = games[g].date;
        if (!d) continue;
        if (earliest === null || d < earliest) earliest = d;
        if (Number(games[g].scoringPeriodId) === first) {
          if (exact === null || d < exact) exact = d;
        }
      }
    }
    return exact || earliest;
  }

  // A fantasy week as a local date range.
  //
  // Week 1 is the short opening week: opening night through the first Sunday
  // on or after it, so Tue Oct 20 2026 gives Oct 20 to Oct 25. Every later
  // week is the following Monday through Sunday.
  //
  // ASSUMPTION: ESPN starts week 2 on the first Monday after opening night
  // rather than folding the short opening week into week 2. Worth one check
  // against the ESPN matchup page on opening night.
  function weekRangeFrom(openingStr, weekNum) {
    if (!openingStr) return null;
    var n = Number(weekNum);
    if (!isFinite(n) || n < 1) return null;
    var opening = parseDateStr(openingStr);
    if (!opening) return null;
    var week1End = addDaysStr(openingStr, (7 - opening.getDay()) % 7);
    if (n === 1) return { startStr: openingStr, endStr: week1End };
    var startStr = addDaysStr(week1End, 1 + (n - 2) * 7);
    return { startStr: startStr, endStr: addDaysStr(startStr, 6) };
  }

  // The matchup's window: first day of its first week through the last day
  // of its last week, so a two-week playoff matchup spans 14 days.
  function matchupWindowFor(matchupPeriodId, openingStr) {
    var weeks = matchupWeeks(matchupPeriodId);
    if (!weeks.length) return null;
    var startStr = null, endStr = null;
    for (var i = 0; i < weeks.length; i++) {
      var r = weekRangeFrom(openingStr, weeks[i]);
      if (!r || !r.startStr || !r.endStr) continue;
      if (startStr === null || r.startStr < startStr) startStr = r.startStr;
      if (endStr === null || r.endStr > endStr) endStr = r.endStr;
    }
    return startStr ? { startStr: startStr, endStr: endStr } : null;
  }

  // Which matchup contains this date. Only needed when ESPN has not told us
  // the current matchup period.
  function matchupForDateStr(dateStr, openingStr) {
    var map = (S.league && S.league.matchupPeriods) || null;
    if (!map) return 0;
    var ids = Object.keys(map);
    for (var i = 0; i < ids.length; i++) {
      var win = matchupWindowFor(ids[i], openingStr);
      if (win && dateStr >= win.startStr && dateStr <= win.endStr) {
        return Number(ids[i]);
      }
    }
    return 0;
  }

  // The window to count games against: the current matchup if one is
  // running, otherwise matchup 1 (preseason).
  function activeMatchupWindow() {
    var openingStr = openingNightStr();
    var todayStr = localDateStr(new Date());
    // ESPN's own answer first. During the season currentMatchupPeriod is
    // authoritative and cannot drift from our week arithmetic.
    var target = (S.league && Number(S.league.currentMatchupPeriod)) || 0;
    if (!(target > 0)) {
      // Before opening night there is no current matchup and matchup 1 is
      // what the user wants to see. Mid-season with the value missing, use
      // whichever matchup's window contains today.
      target = (openingStr && todayStr > openingStr)
        ? (matchupForDateStr(todayStr, openingStr) || 1)
        : 1;
    }
    var win = matchupWindowFor(target, openingStr);
    if (win) {
      return {
        startStr: win.startStr,
        endStr: win.endStr,
        matchupPeriodId: target,
        source: 'schedule'
      };
    }
    // No schedule to derive from; fall back to the calendar week.
    var dates = getMatchupDates();
    return {
      startStr: localDateStr(dates.start),
      endStr: localDateStr(dates.end),
      matchupPeriodId: target,
      source: 'calendar'
    };
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
    var todayStr = localDateStr(new Date());
    // The window is the current matchup (or matchup 1 before the season
    // starts), derived from the real schedule rather than assumed to be
    // this Monday-to-Sunday.
    var win = activeMatchupWindow();
    S.matchup = S.matchup || {};
    S.matchup.windowStart = win.startStr;
    S.matchup.windowEnd = win.endStr;
    S.matchup.windowSource = win.source;
    S.matchup.windowMatchupPeriodId = win.matchupPeriodId;
    // The dashboard, Timeline and Larry's Move read these two. They were
    // never assigned, so every surface that wanted to print the matchup
    // date range printed nothing.
    S.matchup.startDate = win.startStr;
    S.matchup.endDate = win.endStr;

    // Count from today, or from the window start when the window is still
    // in the future (preseason: matchup 1 begins on opening night).
    var fromStr = todayStr > win.startStr ? todayStr : win.startStr;
    var endStr = win.endStr;

    // Fallback only for when the whole schedule fetch failed: NBA teams
    // average ~3.5 games a week.
    var matchupDates = getMatchupDates();
    var estFallback = Math.round((matchupDates.daysLeft || 0) * (3.5 / 7));
    var seasonEndStr = seasonEndDateStr();

    // Did the schedule fetch work at all? If it did, a player without a
    // schedule genuinely has no games, and guessing would be wrong.
    var haveSchedule = !!(S.scheduleLookup && Object.keys(S.scheduleLookup).length);

    S.allPlayers.forEach(function(p) {
      if (p.schedule && p.schedule.length) {
        p.gamesRemaining = countGamesInRange(p.schedule, fromStr, endStr);
        // Rest-of-season count. Referenced by ROS projections, which until
        // now read an undefined value.
        p.gamesRemainingROS = countGamesInRange(p.schedule, fromStr, seasonEndStr);
        return;
      }
      // No NBA team means no games, full stop. The 3.5-games-a-week estimate
      // was being applied to unsigned free agents (Westbrook, Chris Paul,
      // D'Angelo Russell), giving them 3 phantom games while every signed
      // player correctly showed 0. Streaming and Larry's Move then ranked
      // the unsigned players above real ones.
      if (!p.proTeamId) {
        p.gamesRemaining = 0;
        p.gamesRemainingROS = 0;
        return;
      }
      if (haveSchedule) {
        // We have the league schedule and this player's team is not in it,
        // or their team has no games left. Either way the answer is 0.
        p.gamesRemaining = 0;
        p.gamesRemainingROS = 0;
      } else {
        // The schedule fetch failed. An estimate beats nothing here.
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
    fetchScoringPeriodStats: fetchScoringPeriodStats,
    // Exported for tests and for the banner's Sync button.
    rollOverDecision: rollOverDecision,
    buildScheduleLookup: buildScheduleLookup,
    clearSeasonScopedState: clearSeasonScopedState,
    loadNbaSchedule: loadNbaSchedule,
    enrichPlayerSchedules: enrichPlayerSchedules,
    countGamesInRange: countGamesInRange,
    // Matchup window arithmetic. Exported so the week-to-day-range mapping
    // can be pinned directly; reading ESPN's week numbers as scoring periods
    // silently broke every weekly number in the app.
    matchupWeeks: matchupWeeks,
    openingNightStr: openingNightStr,
    weekRangeFrom: weekRangeFrom,
    matchupWindowFor: matchupWindowFor,
    matchupForDateStr: matchupForDateStr,
    activeMatchupWindow: activeMatchupWindow
  };
})();
