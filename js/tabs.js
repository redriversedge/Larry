// ============================================================
// LARRY v3.0 -- TAB RENDERERS
// All UI rendering: Roster, Matchup, Players, League sub-pages
// ============================================================

// --- PLAYER POPUP STATE ---
var _popupPlayerId = null;
var _popupTab = 'stats';

// --- PLAYERS TAB STATE ---
var _playersSearchTerm = '';
var _playersSearchTimer = null;
var _playersStatView = 'season';
var _playersPositionFilter = 'ALL';
var _playersAvailFilter = 'available';
var _playersDateFilter = '';
var _playersSortCol = 'durantScore';
var _playersSortDir = -1;

// --- ROSTER TAB STATE ---
var _rosterDateOffset = 0;
var _rosterStatView = 'season';

// --- DAY FILTER STATE ---
var _dayStats = null;          // statsMap from fetchScoringPeriodStats: { [playerId]: { abbr: val } }
var _dayStatsPeriodId = null;  // scoringPeriodId currently loaded in _dayStats
var _dayNavOffset = 0;         // offset from currentScoringPeriodId (0 = today, -1 = yesterday, etc.)

// --- MATCHUP STATE ---
var _matchupSubTab = 'score';

// --- TRADE STATE ---
var _tradeSearchTerm = '';

// --- DRAFT STATE ---
var _draftTierFilter = 'all';
var _draftRoundFilter = 'all';


// ========== UTILITY: FORMAT POSITIONS ==========

function formatPositions(eligibleSlots) {
  var slotMap = { 0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C', 5: 'G', 6: 'F', 7: 'UTIL' };
  var seen = {};
  var result = [];
  (eligibleSlots || []).forEach(function(id) {
    var pos = slotMap[id];
    if (pos && !seen[pos]) {
      seen[pos] = true;
      result.push(pos);
    }
  });
  return result.join('/') || '--';
}


// ========== ROSTER TAB HELPERS ==========

function renderInjuryBanner(myPlayers) {
  if (sessionStorage.getItem('injuryBannerDismissed')) return '';
  var injured = (myPlayers || []).filter(function(p) {
    var s = p.injuryStatus || 'ACTIVE';
    return s !== 'ACTIVE' && s !== 'HEALTHY';
  });
  if (!injured.length) return '';
  var names = injured.map(function(p) {
    return (p.fullName || p.name || '') + ' (' + p.injuryStatus + ')';
  }).join(', ');
  return '<div class="injury-banner" id="injury-banner">' +
    '<span>Injury alert: ' + names + '</span>' +
    '<button class="banner-dismiss" onclick="sessionStorage.setItem(\'injuryBannerDismissed\',\'1\');var b=document.getElementById(\'injury-banner\');if(b)b.remove();">x</button>' +
  '</div>';
}

function renderAddDropTiles(recommendations) {
  if (!recommendations || recommendations.length === 0) {
    return '<p class="empty-state">No add/drop suggestions right now.</p>';
  }
  var tiles = recommendations.slice(0, 5).map(function(rec) {
    var p = rec.player;
    var drop = rec.dropPlayer;
    var headshotUrl = 'https://a.espncdn.com/i/headshots/nba/players/full/' + p.id + '.png';
    var reason = rec.detail ? rec.detail.split('.')[0] : 'Better fit';
    return '<div class="addrop-tile">' +
      '<img class="player-headshot" src="' + headshotUrl + '" onerror="this.style.background=\'var(--bg-surface)\';this.src=\'\'" alt="' + (p.fullName || '') + '">' +
      '<div class="tile-name">' + (p.fullName || '') + '</div>' +
      '<div class="tile-pos">' + formatPositions(p.eligibleSlots) + '</div>' +
      '<div class="tile-drop">Drop: ' + (drop ? drop.fullName : '--') + '</div>' +
      '<div class="tile-reason">' + reason + '</div>' +
    '</div>';
  }).join('');
  return '<div class="addrop-scroll">' + tiles + '</div>';
}

function getGameForDate(player, dateStr) {
  if (!player.schedule || !player.schedule.length) return null;
  return player.schedule.find(function(g) {
    return g.date && g.date.startsWith(dateStr);
  }) || null;
}

function formatGameCell(game) {
  if (!game) return '';
  var prefix = game.isHome ? 'vs' : '@';
  var time = game.time ? ' ' + game.time : '';
  return prefix + ' ' + (game.opponent || '?') + time;
}

// ========== ROSTER TAB ==========

function renderRoster(container) {
  var cats = getOrderedCategories();
  var html = '';

  // Injury alert banner (dismissible, shown at top)
  html += renderInjuryBanner(S.myTeam.players || []);

  // Dashboard section (moved here from League in v3)
  html += renderDashboardInline();

  // Date navigation (v3 new)
  html += renderDateNav();

  if (_rosterDateOffset !== 0) {
    var viewDate = new Date();
    viewDate.setDate(viewDate.getDate() + _rosterDateOffset);
    var isPast = _rosterDateOffset < 0;
    html += '<div class="alert alert-info" style="font-size:0.8rem;padding:8px 12px;margin:0 0 8px">';
    html += (isPast ? 'Viewing ' : 'Projected lineup for ') + viewDate.toLocaleDateString('en-US', {weekday:'long', month:'short', day:'numeric'});
    html += '</div>';
  }

  // Stat view dropdown (v3: dropdown not buttons)
  html += '<div class="stat-view-bar">';
  html += '<select class="stat-view-select" onchange="handleRosterStatViewChange(this.value)">';
  ['season','last30','last15','last7','ros','day'].forEach(function(v) {
    var labels = {season:'Season Avg',last30:'Last 30',last15:'Last 15',last7:'Last 7',ros:'ROS Projected',day:'Day'};
    html += '<option value="' + v + '"' + (_rosterStatView === v ? ' selected' : '') + '>' + labels[v] + '</option>';
  });
  html += '</select>';

  // Day navigation (shown only when Day filter is active)
  if (_rosterStatView === 'day') {
    var currentPeriod = S.league.currentScoringPeriodId || 0;
    var viewingPeriod = currentPeriod + _dayNavOffset;
    var atCurrent = _dayNavOffset >= 0;
    html += '<div class="day-nav" style="display:inline-flex;align-items:center;gap:4px;margin-left:8px">';
    html += '<button class="date-nav-btn" onclick="_dayNavOffset--;loadDayStats()" style="padding:2px 8px">\u276E</button>';
    html += '<span class="text-xs" style="min-width:70px;text-align:center">Period ' + viewingPeriod + '</span>';
    html += '<button class="date-nav-btn" onclick="if(_dayNavOffset<0){_dayNavOffset++;loadDayStats()}" style="padding:2px 8px"' + (atCurrent ? ' disabled' : '') + '>\u276F</button>';
    html += '</div>';
  }

  html += '<button class="btn btn-sm" onclick="openStatsKey()" title="Stats Key">\u{2139}\u{FE0F} Stats Key</button>';
  html += '</div>';

  // Starters
  var myPlayers = S.myTeam.players || [];
  var starters = myPlayers.filter(function(p) { return p.slotId < 12; });
  var bench = myPlayers.filter(function(p) { return p.slotId === 12; });
  var ir = myPlayers.filter(function(p) { return p.slotId === 13; });

  if (starters.length) {
    html += '<div class="roster-section">';
    html += '<div class="section-title">Starters (' + starters.length + ')</div>';
    html += renderRosterTable(starters, cats);
    html += '</div>';
  }
  if (bench.length) {
    html += '<div class="roster-section">';
    html += '<div class="section-title">Bench (' + bench.length + ')</div>';
    html += renderRosterTable(bench, cats);
    html += '</div>';
  }
  if (ir.length) {
    html += '<div class="roster-section">';
    html += '<div class="section-title">IR (' + ir.length + ')</div>';
    html += renderRosterTable(ir, cats);
    html += '</div>';
  }

  // Decision Hub (v3: horizontal add/drop tile row)
  if (S.allPlayers.length) {
    Engines.computeDURANT(S.allPlayers);
    var recs = Engines.generateRecommendations(myPlayers, S.allPlayers);
    html += '<div class="card">';
    html += '<div class="card-header">Add / Drop</div>';
    html += renderAddDropTiles(recs);
    html += '</div>';
  }

  container.innerHTML = html;
}

function renderDashboardInline() {
  var html = '<div class="card">';
  html += '<div class="card-header" onclick="this.nextElementSibling.classList.toggle(\'hidden\')">Dashboard <span class="text-xs muted">\u25BC</span></div>';
  html += '<div>';

  // Injury alert banner (from News & Injuries)
  var myPlayers = S.myTeam.players || [];
  var injuredStarters = myPlayers.filter(function(p) {
    return p.slotId < 12 && p.injuryStatus && p.injuryStatus !== 'ACTIVE' && p.injuryStatus !== 'HEALTHY';
  });
  if (injuredStarters.length) {
    html += '<div class="dashboard-alert">';
    html += '<span class="dashboard-alert-icon">\u{26A0}\u{FE0F}</span>';
    html += '<span>' + injuredStarters.length + ' injured starter' + (injuredStarters.length > 1 ? 's' : '') + ': ';
    html += injuredStarters.map(function(p) {
      return '<span class="injured-name" onclick="openPlayerPopup(' + p.id + ')">' + statusBadge(p.injuryStatus) + ' ' + esc(p.name) + '</span>';
    }).join(', ');
    html += '</span></div>';
  }

  // Quick cards
  html += '<div class="quick-cards">';
  var rec = S.myTeam.record || {wins:0,losses:0,ties:0};
  html += '<div class="quick-card"><div class="qc-value">' + rec.wins + '-' + rec.losses + '-' + rec.ties + '</div><div class="qc-label">Record</div></div>';

  // Matchup record
  var mr = S.matchup.myRecord || {wins:0,losses:0,ties:0};
  html += '<div class="quick-card"><div class="qc-value">' + mr.wins + '-' + mr.losses + '-' + mr.ties + '</div><div class="qc-label">Matchup</div></div>';

  // Playoff seed with status color
  var playoffSeed = S.myTeam.playoffSeed || 0;
  var playoffTeams = S.league.playoffTeams || Math.ceil(S.teams.length / 2);
  var inPlayoffs = playoffSeed > 0 && playoffSeed <= playoffTeams;
  html += '<div class="quick-card"><div class="qc-value' + (inPlayoffs ? ' stat-positive' : (playoffSeed > 0 ? ' stat-negative' : '')) + '">#' + (playoffSeed || '-') + '</div><div class="qc-label">Seed</div></div>';

  // Games today count (from Schedule)
  var startersPlaying = myPlayers.filter(function(p) { return p.slotId < 12 && p.gamesToday; }).length;
  var totalStarters = myPlayers.filter(function(p) { return p.slotId < 12; }).length;
  html += '<div class="quick-card"><div class="qc-value">' + startersPlaying + '/' + totalStarters + '</div><div class="qc-label">Playing Today</div></div>';

  // Waiver rank
  html += '<div class="quick-card"><div class="qc-value">#' + (S.myTeam.waiverRank || '-') + '</div><div class="qc-label">Waiver</div></div>';
  html += '</div>';

  // Category ranks
  var cats = getOrderedCategories();
  if (cats.length && S.teams.length) {
    html += '<div class="cat-ranks">';
    cats.forEach(function(cat) {
      var rank = Engines.getTeamCatRank(cat.abbr);
      var cls = rank <= 3 ? 'rank-top' : (rank >= S.league.teamCount - 2 ? 'rank-bottom' : 'rank-mid');
      html += '<span class="cat-rank-item ' + cls + '">';
      html += '<span class="cat-rank-name" style="color:' + cat.color + '">' + cat.abbr + '</span>';
      html += '<span class="cat-rank-num">#' + rank + '</span></span>';
    });
    html += '</div>';
  }

  // Playoff position mini-bar (from Playoff Projector)
  if (S.teams.length > 0 && playoffSeed > 0) {
    var sorted = S.teams.slice().sort(function(a,b) {
      var aw = a.record ? a.record.wins : 0; var bw = b.record ? b.record.wins : 0;
      return bw !== aw ? bw - aw : (b.pointsFor || 0) - (a.pointsFor || 0);
    });
    var myIdx = sorted.findIndex(function(t) { return t.teamId === S.myTeam.teamId; });
    if (myIdx >= 0) {
      var pos = myIdx + 1;
      var statusText = pos <= playoffTeams ? 'In playoff position' : (pos - playoffTeams) + ' spot' + (pos - playoffTeams > 1 ? 's' : '') + ' out';
      var statusColor = pos <= playoffTeams ? 'var(--accent-green)' : 'var(--accent-red)';
      html += '<div class="playoff-mini" style="color:' + statusColor + '">';
      html += '<span class="playoff-mini-label">' + statusText + '</span>';
      html += ' <span class="text-xs muted">(' + playoffTeams + ' make playoffs)</span>';
      html += '</div>';
    }
  }

  html += '</div></div>';
  return html;
}

function renderDateNav() {
  var baseDate = new Date();
  baseDate.setDate(baseDate.getDate() + _rosterDateOffset);
  var dayStr = localDateStr(baseDate);
  var dayLabel = _rosterDateOffset === 0 ? 'Today' : (_rosterDateOffset === -1 ? 'Yesterday' : (_rosterDateOffset === 1 ? 'Tomorrow' : ''));
  var dateFormatted = baseDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  var html = '<div class="date-nav">';
  html += '<button class="date-nav-btn" onclick="_rosterDateOffset--;render()">\u276E</button>';
  html += '<div class="date-nav-label">' + (dayLabel || dateFormatted);
  if (dayLabel) html += '<div class="date-sub">' + dateFormatted + '</div>';
  html += '</div>';
  html += '<button class="date-nav-btn" onclick="_rosterDateOffset++;render()">\u276F</button>';
  if (_rosterDateOffset !== 0) {
    html += '<button class="btn btn-sm" onclick="_rosterDateOffset=0;render()">Today</button>';
  }
  html += '</div>';
  return html;
}

function renderRosterTable(players, cats) {
  var html = '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr>';
  html += '<th style="text-align:left;min-width:40px">Slot</th>';
  html += '<th style="text-align:left;min-width:120px">Player</th>';
  var dateLabel = _rosterDateOffset === 0 ? 'Today' : (_rosterDateOffset < 0 ? 'Game' : 'Game');
  html += '<th class="game-cell">' + dateLabel + '</th>';
  cats.forEach(function(cat) {
    html += '<th class="stat-col" style="color:' + cat.color + '">' + cat.abbr + '</th>';
  });
  html += '</tr></thead><tbody>';

  players.forEach(function(p) {
    var hasGameCls = p.gamesToday ? 'has-game' : '';
    html += '<tr class="' + hasGameCls + '">';
    html += '<td><span class="slot-badge">' + (p.slot || 'BE') + '</span></td>';
    html += '<td style="cursor:pointer" onclick="openPlayerPopup(' + p.id + ')">';
    html += renderPlayerCell(p);
    html += '</td>';

    // Today column: show opponent and game time using date-nav date
    var viewDate = new Date();
    viewDate.setDate(viewDate.getDate() + _rosterDateOffset);
    var todayStr = localDateStr(viewDate);
    var schedGame = getGameForDate(p, todayStr);
    var gameCellText = schedGame ? formatGameCell(schedGame) : (p.gameToday ? formatGameCell(p.gameToday) : '');
    html += '<td class="game-cell">';
    if (gameCellText) {
      html += '<span class="game-info">' + esc(gameCellText) + '</span>';
    } else if (p.gamesToday) {
      html += '<span class="game-info">' + esc(p.nbaTeam || '') + '</span>';
    } else {
      html += '<span class="no-game-label">-</span>';
    }
    html += '</td>';

    var period = _rosterStatView;
    cats.forEach(function(cat) {
      var val;
      if (period === 'ros') {
        if (!p.rosProjection) Engines.rosProjections([p]);
        val = p.rosProjection ? p.rosProjection[cat.abbr] : null;
      } else if (period === 'day') {
        var dayEntry = _dayStats ? _dayStats[p.id] : null;
        val = dayEntry ? (dayEntry[cat.abbr] !== undefined ? dayEntry[cat.abbr] : null) : null;
      } else {
        var pgStats = ESPNSync.getPerGameStats(p, period);
        val = pgStats ? (pgStats[cat.abbr] !== undefined ? pgStats[cat.abbr] : null) : null;
      }
      var cls = '';
      if (p.zScores && p.zScores[cat.abbr]) {
        cls = p.zScores[cat.abbr] > 0.5 ? 'stat-positive' : (p.zScores[cat.abbr] < -0.5 ? 'stat-negative' : '');
      }
      html += '<td class="stat-col ' + cls + '">' + (val !== null && val !== undefined ? (cat.isPercent ? pct(val) : fmt(val, 1)) : '') + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function renderPlayerCell(p) {
  var color = ESPN_TEAM_COLORS[p.nbaTeam] || '#666';
  var initials = (p.firstName ? p.firstName[0] : '') + (p.lastName ? p.lastName[0] : '');
  var html = '<div class="player-cell-inner">';
  html += '<div class="player-cell-headshot">';
  html += '<img class="player-headshot" src="https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/' + p.id + '.png&w=48&h=36&cb=1" width="24" height="18" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'" style="border-radius:4px">';
  html += '<span class="player-initials" style="width:24px;height:18px;font-size:0.55rem;background:' + color + ';display:none;border-radius:4px">' + initials + '</span>';
  html += '</div>';
  html += '<div class="player-cell-info">';
  html += '<span class="player-name">' + statusBadge(p.injuryStatus) + ' ' + esc(p.name);
  // Trend badge (from Stats & Trends)
  if (p.trend === 'hot') html += '<span class="trend-badge hot">\u2191 HOT</span>';
  else if (p.trend === 'cold') html += '<span class="trend-badge cold">\u2193 COLD</span>';
  html += '</span>';
  html += '<span class="player-meta">' + formatPositions(p.eligibleSlots) + ' - ' + p.nbaTeam + '</span>';
  html += '</div></div>';
  return html;
}


// ========== MATCHUP HELPERS ==========

function renderScoreRow(cat, myVal, oppVal) {
  var myWin = myVal > oppVal;
  var oppWin = oppVal > myVal;
  return '<div class="score-row">' +
    '<div class="my-score ' + (myWin ? 'winning' : oppWin ? 'losing' : '') + '">' + fmt(myVal, 1) + '</div>' +
    '<div class="cat-name">' + cat + '</div>' +
    '<div class="opp-score ' + (oppWin ? 'winning' : myWin ? 'losing' : '') + '">' + fmt(oppVal, 1) + '</div>' +
  '</div>';
}

// ========== MATCHUP TAB ==========

function renderMatchup(container) {
  var cats = getOrderedCategories();
  var html = '';

  // Sub-tabs
  html += '<div class="sub-tab-bar">';
  ['score','projections'].forEach(function(st) {
    var labels = {score:'Score',projections:'Projections'};
    html += '<button class="sub-tab' + (_matchupSubTab === st ? ' active' : '') + '" onclick="_matchupSubTab=\'' + st + '\';render()">' + labels[st] + '</button>';
  });
  html += '</div>';

  if (_matchupSubTab === 'score') {
    html += renderMatchupScore(cats);
  } else if (_matchupSubTab === 'projections') {
    html += renderMatchupProjections(cats);
  }

  container.innerHTML = html;
}

function renderMatchupScore(cats) {
  var html = '';
  var mr = S.matchup.myRecord || {wins:0,losses:0,ties:0};

  // Header
  html += '<div class="matchup-header">';
  html += '<div class="matchup-team"><span class="team-name">' + esc(S.myTeam.name) + '</span></div>';
  html += '<div class="matchup-vs"><div class="matchup-record-big">' + mr.wins + '-' + mr.losses + '-' + mr.ties + '</div></div>';
  html += '<div class="matchup-team"><span class="team-name">' + esc(S.matchup.opponentName || 'Opponent') + '</span></div>';
  html += '</div>';

  // Category scores - category in middle format
  html += '<div class="card"><div class="cat-scores">';
  cats.forEach(function(cat) {
    var my = S.matchup.myScores ? S.matchup.myScores[cat.abbr] || 0 : 0;
    var opp = S.matchup.oppScores ? S.matchup.oppScores[cat.abbr] || 0 : 0;
    // For negative cats (TO), winning = lower is better, so swap win/loss for display
    var myDisplay = cat.isNegative ? opp : my;
    var oppDisplay = cat.isNegative ? my : opp;
    html += renderScoreRow(cat.abbr, myDisplay, oppDisplay);
  });
  html += '</div></div>';

  // Schedule Advantage (v3 fix)
  html += renderScheduleAdvantage();

  // 7-Day Schedule Grids (my team + opponent)
  var mySchedPlayers = (S.myTeam.players || []).filter(function(p) { return p.slotId < 12; });
  var oppSchedTeam = S.teams.find(function(t) { return t.teamId === S.matchup.opponentTeamId; });
  var oppSchedPlayers = oppSchedTeam ? (oppSchedTeam.players || []).filter(function(p) { return p.slotId < 12; }).map(function(stub) {
    return S.allPlayers.find(function(ap) { return ap.id === stub.id; }) || stub;
  }) : [];
  html += renderScheduleGrid(mySchedPlayers, 'My Team - Next 7 Days');
  if (oppSchedPlayers.length) {
    html += renderScheduleGrid(oppSchedPlayers, esc(S.matchup.opponentName || 'Opponent') + ' - Next 7 Days');
  }

  // Team of the Week (v3: moved to matchup)
  html += renderTeamOfWeek(cats);

  // Opponent Insight (from Opponent Scout + News & Injuries)
  html += renderOpponentInsight(cats);

  return html;
}

function computeScheduleAdvantage(myPlayers, oppPlayers) {
  var now = new Date();
  var matchupEnd = getMatchupDates().end;
  function countGamesRemaining(players) {
    return (players || [])
      .filter(function(p) { return p.slotId !== 13; }) // exclude IR
      .reduce(function(sum, p) {
        if (p.schedule && p.schedule.length) {
          var games = p.schedule.filter(function(g) {
            var d = new Date(g.date);
            return d >= now && d <= matchupEnd;
          });
          return sum + games.length;
        }
        // Fallback to gamesRemaining estimate
        return sum + (p.gamesRemaining || 0);
      }, 0);
  }
  return {
    mine: countGamesRemaining(myPlayers),
    opp: countGamesRemaining(oppPlayers)
  };
}

function renderScheduleAdvantage() {
  var myPlayers = S.myTeam.players || [];
  var oppTeam = S.teams.find(function(t) { return t.teamId === S.matchup.opponentTeamId; });
  var oppPlayers = oppTeam ? (oppTeam.players || []) : [];

  var adv = computeScheduleAdvantage(myPlayers, oppPlayers);
  var myGames = adv.mine;
  var oppGames = adv.opp;

  var diff = myGames - oppGames;
  var matchupDates = getMatchupDates();
  var html = '<div class="card"><div class="card-header">Schedule Advantage</div>';
  html += '<div class="sched-adv">';
  html += '<div class="sched-adv-team"><div class="adv-count">' + myGames + '</div><div class="adv-label">Your Games</div></div>';
  html += '<div class="sched-adv-diff ' + (diff > 0 ? 'positive' : (diff < 0 ? 'negative' : '')) + '">' + (diff > 0 ? '+' : '') + diff + '</div>';
  html += '<div class="sched-adv-team"><div class="adv-count">' + oppGames + '</div><div class="adv-label">Opp Games</div></div>';
  html += '</div>';

  // Days remaining callout
  html += '<div style="text-align:center;padding:8px;font-size:0.8rem;color:var(--text-secondary)">';
  html += matchupDates.daysLeft + ' days remaining in matchup period';
  if (Math.abs(diff) >= 3) {
    html += '<div style="color:' + (diff > 0 ? 'var(--accent-green)' : 'var(--accent-red)') + ';font-weight:700;margin-top:4px">';
    html += (diff > 0 ? 'Significant schedule advantage!' : 'Schedule disadvantage - consider streaming.');
    html += '</div>';
  }
  html += '</div></div>';
  return html;
}

function computeTOTW(cats) {
  // Rank league managers by how they'd do vs every other current-matchup winner.
  // Uses team z-score sums per category as a proxy for current matchup performance,
  // since full league matchup scores are not stored in S.
  if (!cats.length || !S.teams.length) return [];

  // Compute per-team category z-score totals (starters only)
  var teamStats = S.teams.map(function(team) {
    var catZ = {};
    cats.forEach(function(cat) {
      var sum = 0;
      (team.players || []).forEach(function(p) {
        if (p.slotId < 12) sum += (p.zScores ? p.zScores[cat.abbr] || 0 : 0);
      });
      catZ[cat.abbr] = sum;
    });
    return { team: team, catZ: catZ };
  });

  // Find current matchup pairs from schedule
  var mp = S.league.currentMatchupPeriod;
  var currentMatchups = (S.league.schedule || []).filter(function(m) {
    return m.matchupPeriodId === mp;
  });

  // Determine winners of each current matchup using z-score proxy
  var winners = [];
  currentMatchups.forEach(function(m) {
    var homeId = m.home ? m.home.teamId : null;
    var awayId = m.away ? m.away.teamId : null;
    if (!homeId || !awayId) return;

    var homeStats = teamStats.find(function(ts) { return ts.team.teamId === homeId; });
    var awayStats = teamStats.find(function(ts) { return ts.team.teamId === awayId; });
    if (!homeStats || !awayStats) return;

    var homeCatWins = 0, awayCatWins = 0;
    cats.forEach(function(cat) {
      var hZ = homeStats.catZ[cat.abbr] || 0;
      var aZ = awayStats.catZ[cat.abbr] || 0;
      if (hZ > aZ) homeCatWins++;
      else if (aZ > hZ) awayCatWins++;
    });
    if (homeCatWins > awayCatWins) winners.push(homeStats);
    else if (awayCatWins > homeCatWins) winners.push(awayStats);
    else { winners.push(homeStats); winners.push(awayStats); } // tie: include both
  });

  // Fallback: if no schedule pairs, use all teams
  if (!winners.length) winners = teamStats;

  // For each winner, simulate vs all other winners
  var results = winners.map(function(w) {
    var winsAgainst = winners.filter(function(other) {
      if (other === w) return false;
      var wCatWins = 0, otherCatWins = 0;
      cats.forEach(function(cat) {
        var wZ = w.catZ[cat.abbr] || 0;
        var oZ = other.catZ[cat.abbr] || 0;
        if (wZ > oZ) wCatWins++;
        else if (oZ > wZ) otherCatWins++;
      });
      return wCatWins > otherCatWins;
    }).length;
    return {
      team: w.team,
      winsAgainst: winsAgainst,
      total: Math.max(0, winners.length - 1)
    };
  });

  results.sort(function(a, b) { return b.winsAgainst - a.winsAgainst; });
  return results;
}

function renderTeamOfWeek(cats) {
  if (!cats.length || !S.teams.length) return '';
  var html = '<div class="card"><div class="card-header" onclick="this.nextElementSibling.classList.toggle(\'hidden\')">Team of the Week <span class="text-xs muted">\u25BC</span></div>';
  html += '<div class="hidden">';

  var results = computeTOTW(cats);
  if (!results.length) {
    html += '<div class="empty-state"><p>No matchup data available.</p></div>';
  } else {
    html += '<div class="mini-table">';
    results.forEach(function(r, i) {
      var isMe = r.team.teamId === S.myTeam.teamId;
      html += '<div class="mini-row' + (isMe ? ' my-team-row' : '') + '">';
      html += '<span class="text-xs muted" style="min-width:20px">' + (i + 1) + '</span>';
      html += '<span style="flex:1;font-weight:' + (i === 0 ? '700' : '400') + '">' + esc(r.team.name) + '</span>';
      html += '<span class="text-xs">' + r.winsAgainst + '/' + r.total + ' matchups won</span>';
      html += '</div>';
    });
    html += '</div>';
  }
  html += '</div></div>';
  return html;
}

function renderOpponentInsight(cats) {
  var oppTeam = S.teams.find(function(t) { return t.teamId === S.matchup.opponentTeamId; });
  if (!oppTeam || !oppTeam.players) return '';

  // Strengths & weaknesses from z-scores.
  // oppTeam.players are roster stubs - look up enriched player data in S.allPlayers
  // which has z-scores computed by computeDURANT.
  var oppCatTotals = [];
  cats.forEach(function(cat) {
    var sum = 0;
    (oppTeam.players || []).forEach(function(stub) {
      if (stub.slotId >= 12) return; // skip bench and IR
      // Find enriched player in S.allPlayers
      var enriched = S.allPlayers.find(function(ap) { return ap.id === stub.id; });
      var p = enriched || stub;
      sum += (p.zScores ? p.zScores[cat.abbr] || 0 : 0);
    });
    oppCatTotals.push({ cat: cat, z: sum });
  });
  oppCatTotals.sort(function(a, b) { return b.z - a.z; });

  var html = '<div class="card"><div class="card-header" onclick="this.nextElementSibling.classList.toggle(\'hidden\')">Opponent Insight <span class="text-xs muted">\u25BC</span></div>';
  html += '<div class="hidden">';

  // Strengths & weaknesses
  html += '<div class="opponent-insight">';
  html += '<div class="insight-group"><div class="insight-group-title" style="color:var(--accent-green)">Their strengths</div>';
  oppCatTotals.slice(0, 3).forEach(function(ct) {
    html += '<span class="insight-cat strong" style="border-left:2px solid ' + ct.cat.color + '">' + ct.cat.abbr + ' (' + fmt(ct.z, 1) + ')</span>';
  });
  html += '</div>';
  html += '<div class="insight-group"><div class="insight-group-title" style="color:var(--accent-red)">Their weaknesses</div>';
  oppCatTotals.slice(-3).reverse().forEach(function(ct) {
    html += '<span class="insight-cat weak" style="border-left:2px solid ' + ct.cat.color + '">' + ct.cat.abbr + ' (' + fmt(ct.z, 1) + ')</span>';
  });
  html += '</div></div>';

  // Opponent injuries
  var oppInjured = (oppTeam.players || []).filter(function(p) {
    return p.injuryStatus && p.injuryStatus !== 'ACTIVE' && p.injuryStatus !== 'HEALTHY';
  });
  if (oppInjured.length) {
    var oppOut = oppInjured.filter(function(p) {
      return p.injuryStatus === 'OUT' || p.injuryStatus === 'IR' || p.injuryStatus === 'INJURED_RESERVE' || p.injuryStatus === 'SUSPENSION';
    });
    html += '<div class="opp-injury-mini">';
    html += '<span class="injury-count">' + oppInjured.length + '</span> opponent player' + (oppInjured.length > 1 ? 's' : '') + ' injured';
    if (oppOut.length) html += ' (<span style="color:var(--accent-red)">' + oppOut.length + ' OUT</span>)';
    html += '</div>';
  }

  html += '<div style="padding:4px 0"><a style="font-size:0.75rem;color:var(--accent-blue);cursor:pointer;text-decoration:none" onclick="openLeagueSub(\'opponentScout\')">Full opponent scouting report \u276F</a></div>';
  html += '</div></div>';
  return html;
}

function renderMatchupProjections(cats) {
  var myPlayers = (S.myTeam.players || []).filter(function(p) { return p.slotId < 12; });
  var oppTeam = S.teams.find(function(t) { return t.teamId === S.matchup.opponentTeamId; });
  var oppPlayerStubs = oppTeam ? (oppTeam.players || []).filter(function(p) { return p.slotId < 12; }) : [];

  // Enrich opp players from S.allPlayers for z-scores and stats
  var oppPlayers = oppPlayerStubs.map(function(stub) {
    return S.allPlayers.find(function(ap) { return ap.id === stub.id; }) || stub;
  });

  if (!myPlayers.length) return '<div class="empty-state"><p>No roster data. Sync with ESPN first.</p></div>';

  var VOLATILITY_THRESHOLD = 2.0;

  // Compute projected totals per category: sum(season per-game * gamesRemaining) per team
  // Also compute volatility: variance between last7 pg and season pg across roster
  var html = '<div class="card">';
  html += '<div class="card-header">Projected Totals';
  html += '<span class="text-xs muted" style="margin-left:8px">~ = volatile</span>';
  html += '</div>';

  var projWins = 0, projLosses = 0;

  cats.forEach(function(cat) {
    var myTotal = 0, oppTotal = 0;
    var myVariance = 0, oppVariance = 0;

    myPlayers.forEach(function(p) {
      var gamesLeft = p.gamesRemaining || 0;
      var seasonPg = ESPNSync.getPerGameStats(p, 'season');
      var last7Pg = ESPNSync.getPerGameStats(p, 'last7');
      var seasonVal = seasonPg ? (seasonPg[cat.abbr] || 0) : 0;
      var last7Val = last7Pg ? (last7Pg[cat.abbr] || 0) : seasonVal;
      myTotal += seasonVal * gamesLeft;
      myVariance += Math.abs(last7Val - seasonVal);
    });

    oppPlayers.forEach(function(p) {
      var gamesLeft = p.gamesRemaining || 0;
      var seasonPg = ESPNSync.getPerGameStats(p, 'season');
      var last7Pg = ESPNSync.getPerGameStats(p, 'last7');
      var seasonVal = seasonPg ? (seasonPg[cat.abbr] || 0) : 0;
      var last7Val = last7Pg ? (last7Pg[cat.abbr] || 0) : seasonVal;
      oppTotal += seasonVal * gamesLeft;
      oppVariance += Math.abs(last7Val - seasonVal);
    });

    var myWins = cat.isNegative ? myTotal < oppTotal : myTotal > oppTotal;
    var oppWins = cat.isNegative ? oppTotal < myTotal : oppTotal > myTotal;
    if (myWins) projWins++;
    else if (oppWins) projLosses++;

    var myVolatile = myVariance > VOLATILITY_THRESHOLD;
    var oppVolatile = oppVariance > VOLATILITY_THRESHOLD;

    // For display: flip if negative cat so green = winning
    var myDisplay = cat.isNegative ? oppTotal : myTotal;
    var oppDisplay = cat.isNegative ? myTotal : oppTotal;

    var myLabel = fmt(myTotal, 1) + (myVolatile ? '<span class="volatile" style="color:var(--accent-gold);margin-left:2px">~</span>' : '');
    var oppLabel = fmt(oppTotal, 1) + (oppVolatile ? '<span class="volatile" style="color:var(--accent-gold);margin-left:2px">~</span>' : '');

    var myWinCls = (cat.isNegative ? myTotal < oppTotal : myTotal > oppTotal) ? 'winning' : ((cat.isNegative ? myTotal > oppTotal : myTotal < oppTotal) ? 'losing' : '');
    var oppWinCls = (cat.isNegative ? oppTotal < myTotal : oppTotal > myTotal) ? 'winning' : ((cat.isNegative ? oppTotal > myTotal : oppTotal < myTotal) ? 'losing' : '');

    html += '<div class="score-row">' +
      '<div class="my-score ' + myWinCls + '">' + myLabel + '</div>' +
      '<div class="cat-name">' + cat.abbr + '</div>' +
      '<div class="opp-score ' + oppWinCls + '">' + oppLabel + '</div>' +
    '</div>';
  });

  var projTies = Math.max(0, cats.length - projWins - projLosses);
  html += '<div style="text-align:center;padding:12px;font-size:1.1rem;font-weight:800">Projected: ' + projWins + '-' + projLosses + '-' + projTies + '</div>';
  html += '</div>';

  return html;
}


// ========== PLAYERS TAB ==========

function renderPlayers(container) {
  var cats = getOrderedCategories();
  var html = '';

  // Filter bar with dropdowns (v3 fix)
  html += '<div class="filter-bar">';

  // Search - v3 FIX: Use oninput with debounce, NOT onkeyup which dismisses keyboard
  html += '<input type="text" class="filter-search" id="players-search" placeholder="Search players..." ';
  html += 'value="' + esc(_playersSearchTerm) + '" ';
  html += 'oninput="handlePlayersSearch(this.value)">';

  html += '<div class="filter-row">';

  // Position filter dropdown
  html += '<select class="filter-select" onchange="_playersPositionFilter=this.value;renderPlayersList()">';
  html += '<option value="ALL"' + (_playersPositionFilter === 'ALL' ? ' selected' : '') + '>All Pos</option>';
  ['PG','SG','SF','PF','C'].forEach(function(pos) {
    html += '<option value="' + pos + '"' + (_playersPositionFilter === pos ? ' selected' : '') + '>' + pos + '</option>';
  });
  html += '</select>';

  // Availability filter
  html += '<select class="filter-select" onchange="_playersAvailFilter=this.value;renderPlayersList()">';
  html += '<option value="all"' + (_playersAvailFilter === 'all' ? ' selected' : '') + '>All Players</option>';
  html += '<option value="available"' + (_playersAvailFilter === 'available' ? ' selected' : '') + '>Free Agents</option>';
  html += '<option value="roster"' + (_playersAvailFilter === 'roster' ? ' selected' : '') + '>My Roster</option>';
  html += '</select>';

  // Stat view dropdown
  html += '<select class="filter-select" onchange="handlePlayersStatViewChange(this.value)">';
  ['season','last30','last15','last7','ros','day'].forEach(function(v) {
    var labels = {season:'Season',last30:'Last 30',last15:'Last 15',last7:'Last 7',ros:'ROS Proj',day:'Day'};
    html += '<option value="' + v + '"' + (_playersStatView === v ? ' selected' : '') + '>' + labels[v] + '</option>';
  });
  html += '</select>';

  // Playing On date filter dropdown
  html += '<select class="filter-select" onchange="_playersDateFilter=this.value;renderPlayersList()">';
  html += '<option value=""' + (!_playersDateFilter ? ' selected' : '') + '>Any Day</option>';
  for (var di = 0; di < 10; di++) {
    var dd = new Date();
    dd.setDate(dd.getDate() + di);
    var dateVal = localDateStr(dd);
    var dateLabel = di === 0 ? 'Today' : (di === 1 ? 'Tomorrow' : dd.toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'}));
    html += '<option value="' + dateVal + '"' + (_playersDateFilter === dateVal ? ' selected' : '') + '>' + dateLabel + '</option>';
  }
  html += '</select>';

  html += '</div></div>';

  // Player list container
  html += '<div id="players-list-container"></div>';

  container.innerHTML = html;

  // Render the list after DOM is ready
  renderPlayersList();
}

// v3 FIX: Debounced search that does NOT dismiss keyboard
function handlePlayersSearch(value) {
  _playersSearchTerm = value;
  if (_playersSearchTimer) clearTimeout(_playersSearchTimer);
  _playersSearchTimer = setTimeout(function() {
    renderPlayersList();
  }, 250);
}

function renderPlayersList() {
  var listContainer = document.getElementById('players-list-container');
  if (!listContainer) return;

  var cats = getOrderedCategories();
  var players = S.allPlayers || [];
  if (!players.length) {
    listContainer.innerHTML = '<div class="empty-state"><p>No player data. Sync with ESPN first.</p></div>';
    return;
  }

  // Compute rankings if needed
  if (players.length && (!players[0].durantScore && players[0].durantScore !== 0)) {
    Engines.computeDURANT(players);
  }

  // Filter
  var filtered = players.filter(function(p) {
    if (_playersSearchTerm) {
      var term = _playersSearchTerm.toLowerCase();
      if (!(p.name || '').toLowerCase().includes(term) && !(p.nbaTeam || '').toLowerCase().includes(term)) return false;
    }
    if (_playersPositionFilter !== 'ALL') {
      if (!p.positions || p.positions.indexOf(_playersPositionFilter) === -1) return false;
    }
    if (_playersAvailFilter === 'available' && p.onTeamId > 0) return false;
    if (_playersAvailFilter === 'roster' && p.onTeamId !== S.myTeam.teamId) return false;
    if (_playersDateFilter) {
      // Filter by game on specific date: check gamesToday for today, or schedule array
      var today = localDateStr();
      if (_playersDateFilter === today) {
        if (!p.gamesToday) return false;
      } else if (p.schedule && p.schedule.length) {
        var hasGame = p.schedule.some(function(g) { return g.date === _playersDateFilter; });
        if (!hasGame) return false;
      } else {
        return false;
      }
    }
    return true;
  });

  // Sort by DURANT by default
  filtered.sort(function(a,b) {
    if (_playersSortCol === 'durantScore') return (b.effectiveDURANT || 0) - (a.effectiveDURANT || 0);
    if (_playersSortCol === 'name') return (a.name || '').localeCompare(b.name || '');
    // Sort by stat
    var aVal, bVal;
    if (_playersStatView === 'day') {
      var aDay = _dayStats ? _dayStats[a.id] : null;
      var bDay = _dayStats ? _dayStats[b.id] : null;
      aVal = aDay ? (aDay[_playersSortCol] || 0) : 0;
      bVal = bDay ? (bDay[_playersSortCol] || 0) : 0;
    } else {
      var aPg = ESPNSync.getPerGameStats(a, _playersStatView);
      var bPg = ESPNSync.getPerGameStats(b, _playersStatView);
      aVal = aPg ? (aPg[_playersSortCol] || 0) : 0;
      bVal = bPg ? (bPg[_playersSortCol] || 0) : 0;
    }
    return (bVal - aVal) * _playersSortDir;
  });

  // Render table
  var html = '<div class="text-xs muted" style="margin-bottom:6px">' + filtered.length + ' players</div>';
  html += '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr>';
  html += '<th style="text-align:left;min-width:28px">#</th>';
  html += '<th style="text-align:left;min-width:120px" onclick="sortPlayers(\'name\')">Player<span class="sort-label">Sorted by Availability Score</span></th>';
  cats.forEach(function(cat) {
    html += '<th class="stat-col" style="color:' + cat.color + '" onclick="sortPlayers(\'' + cat.abbr + '\')">' + cat.abbr + '</th>';
  });
  html += '</tr></thead><tbody>';

  filtered.slice(0, 100).forEach(function(p, idx) {
    var isMyTeam = p.onTeamId === S.myTeam.teamId;
    html += '<tr class="' + (isMyTeam ? 'my-team-row' : '') + '">';
    html += '<td class="text-xs muted">' + (p.durantRank || idx + 1) + '</td>';
    html += '<td style="cursor:pointer" onclick="openPlayerPopup(' + p.id + ')">' + renderPlayerCell(p) + '</td>';

    var period = _playersStatView;
    cats.forEach(function(cat) {
      var val;
      if (period === 'ros') {
        if (!p.rosProjection) Engines.rosProjections([p]);
        val = p.rosProjection ? p.rosProjection[cat.abbr] : null;
      } else if (period === 'day') {
        var dayEntry = _dayStats ? _dayStats[p.id] : null;
        val = dayEntry ? (dayEntry[cat.abbr] !== undefined ? dayEntry[cat.abbr] : null) : null;
      } else {
        var pgStats = ESPNSync.getPerGameStats(p, period);
        val = pgStats ? (pgStats[cat.abbr] !== undefined ? pgStats[cat.abbr] : null) : null;
      }
      var cls = '';
      if (p.zScores && p.zScores[cat.abbr]) {
        cls = p.zScores[cat.abbr] > 0.5 ? 'stat-positive' : (p.zScores[cat.abbr] < -0.5 ? 'stat-negative' : '');
      }
      html += '<td class="stat-col ' + cls + '">' + (val !== null && val !== undefined ? (cat.isPercent ? pct(val) : fmt(val, 1)) : '') + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';

  listContainer.innerHTML = html;
}

function sortPlayers(col) {
  if (_playersSortCol === col) _playersSortDir *= -1;
  else { _playersSortCol = col; _playersSortDir = -1; }
  renderPlayersList();
}

// --- DAY FILTER HANDLERS ---

function handleRosterStatViewChange(val) {
  _rosterStatView = val;
  if (val === 'day') {
    _dayNavOffset = 0;
    loadDayStats(function() { render(); });
  } else {
    render();
  }
}

function handlePlayersStatViewChange(val) {
  _playersStatView = val;
  if (val === 'day') {
    _dayNavOffset = 0;
    loadDayStats(function() { renderPlayersList(); });
  } else {
    renderPlayersList();
  }
}

function loadDayStats(callback) {
  var currentPeriod = S.league.currentScoringPeriodId || 0;
  if (!currentPeriod) {
    _dayStats = null;
    if (callback) callback();
    return;
  }
  // Cap forward navigation at current scoring period
  if (_dayNavOffset > 0) _dayNavOffset = 0;
  var targetPeriod = currentPeriod + _dayNavOffset;
  if (targetPeriod < 1) targetPeriod = 1;

  // Already loaded this period
  if (_dayStatsPeriodId === targetPeriod && _dayStats !== null) {
    if (callback) callback();
    else render();
    return;
  }

  ESPNSync.fetchScoringPeriodStats(targetPeriod)
    .then(function(statsMap) {
      _dayStats = statsMap;
      _dayStatsPeriodId = targetPeriod;
      if (callback) callback();
      else render();
    })
    .catch(function(err) {
      console.warn('fetchScoringPeriodStats failed:', err);
      _dayStats = {};
      _dayStatsPeriodId = targetPeriod;
      if (callback) callback();
      else render();
    });
}


// ========== LEAGUE TAB ==========

function renderLeague(container) {
  // If on a sub-page, render that
  if (S.leagueSubPage) {
    renderLeagueSubPage(container);
    return;
  }

  var html = '<div class="tab-header"><h2>League</h2></div>';
  html += '<div class="league-menu">';

  // Group menu items with section headers
  var sections = {
    'Overview': ['standings', 'projectedStandings', 'playoffs', 'timeline'],
    'Analysis': ['trades', 'teamAnalyzer', 'statsTrends', 'projections', 'opponentScout'],
    'Info': ['news', 'schedule', 'draftCenter'],
    'System': ['notifications', 'settings']
  };
  var sectionKeys = ['Overview', 'Analysis', 'Info', 'System'];
  sectionKeys.forEach(function(section) {
    html += '<div class="menu-section-label">' + section + '</div>';
    sections[section].forEach(function(id) {
      var item = LEAGUE_MENU.find(function(m) { return m.id === id; });
      if (!item) return;
      html += '<button class="menu-item" onclick="S.leagueSubPage=\'' + item.id + '\';render()">';
      html += '<span class="menu-icon">' + item.icon + '</span>';
      html += '<span class="menu-label">' + item.label + '</span>';
      html += '<span class="menu-arrow">\u276F</span>';
      html += '</button>';
    });
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderLeagueSubPage(container) {
  var page = S.leagueSubPage;
  var html = '<div class="sub-page-header">';
  html += '<button class="btn-back" onclick="S.leagueSubPage=null;render()">\u276E Back</button>';
  var menuItem = LEAGUE_MENU.find(function(m) { return m.id === page; });
  html += '<h2>' + (menuItem ? menuItem.icon + ' ' + menuItem.label : page) + '</h2>';
  html += '</div>';

  try {
    switch(page) {
      case 'standings': html += renderStandings(); break;
      case 'trades': html += renderTradeCenter(); break;
      case 'teamAnalyzer': html += renderTeamAnalyzer(); break;
      case 'statsTrends': html += renderStatsTrends(); break;
      case 'projections': html += renderROSProjections(); break;
      case 'schedule': html += renderSchedulePage(); break;
      case 'draftCenter': html += renderDraftCenter(); break;
      case 'projectedStandings': html += renderProjectedStandings(); break;
      case 'opponentScout': html += renderOpponentScout(); break;
      case 'news': html += renderNewsInjuries(); break;
      case 'playoffs': html += renderPlayoffProjector(); break;
      case 'timeline': html += renderSeasonTimeline(); break;
      case 'notifications': html += renderNotifications(); break;
      case 'settings': html += renderSettingsPage(); break;
      default: html += '<div class="empty-state"><p>Coming soon.</p></div>';
    }
  } catch(e) {
    html += '<div class="error-card"><h3>Error</h3><p>' + esc(e.message) + '</p>';
    html += '<pre>' + esc(e.stack || '') + '</pre>';
    html += '<button class="btn btn-primary" onclick="S.leagueSubPage=null;render()">Go Back</button></div>';
  }

  container.innerHTML = html;
  if (page === 'trades') setTimeout(renderTradeResults, 0);
}


// ========== LEAGUE SUB-PAGES ==========

function renderStandings() {
  var html = '<div class="card">';
  html += '<div class="table-scroll"><table class="data-table">';
  html += '<thead><tr><th style="text-align:left">#</th><th style="text-align:left">Team</th><th>W</th><th>L</th><th>T</th><th>PF</th></tr></thead><tbody>';

  var sorted = S.teams.slice().sort(function(a,b) {
    var aw = a.record ? a.record.wins : 0; var bw = b.record ? b.record.wins : 0;
    if (bw !== aw) return bw - aw;
    return (b.pointsFor || 0) - (a.pointsFor || 0);
  });

  sorted.forEach(function(t, i) {
    var isMe = t.teamId === S.myTeam.teamId;
    var r = t.record || {wins:0,losses:0,ties:0};
    html += '<tr class="' + (isMe ? 'my-team-row' : '') + '">';
    html += '<td>' + (i+1) + '</td><td><strong>' + esc(t.name) + '</strong></td>';
    html += '<td>' + r.wins + '</td><td>' + r.losses + '</td><td>' + r.ties + '</td>';
    html += '<td>' + fmt(t.pointsFor || 0, 0) + '</td></tr>';
  });
  html += '</tbody></table></div></div>';

  // Playoff line
  if (S.league.playoffTeams > 0) {
    html += '<div class="alert alert-info">Top ' + S.league.playoffTeams + ' teams make playoffs.</div>';
  }
  return html;
}

function renderTradeCenter() {
  var html = '';
  if (S.allPlayers.length) Engines.computeDURANT(S.allPlayers);

  // Search for specific player trades
  html += '<div class="card"><div class="card-header">Trade Finder</div>';
  html += '<input type="text" class="filter-search" placeholder="Search for a player to see trade options..." ';
  html += 'value="' + esc(_tradeSearchTerm) + '" oninput="_tradeSearchTerm=this.value;renderTradeResults()">';
  html += '<div id="trade-results"></div></div>';

  // Trade Analyzer
  html += '<div class="card"><div class="card-header">Trade Analyzer</div>';
  html += '<p class="muted text-sm" style="margin-bottom:8px">Compare two players to evaluate a trade.</p>';
  html += '<div style="display:flex;gap:8px;margin-bottom:8px">';
  html += '<input type="text" class="filter-search" id="trade-give-input" placeholder="You give..." style="flex:1" oninput="tradeAnalyzerSearch(\'give\',this.value)">';
  html += '<input type="text" class="filter-search" id="trade-get-input" placeholder="You get..." style="flex:1" oninput="tradeAnalyzerSearch(\'get\',this.value)">';
  html += '</div>';
  html += '<div id="trade-give-results" class="trade-analyzer-results"></div>';
  html += '<div id="trade-get-results" class="trade-analyzer-results"></div>';
  html += '<div id="trade-analysis-output"></div>';
  html += '</div>';
  return html;
}

function renderTradeResults() {
  var container = document.getElementById('trade-results');
  if (!container) return;

  var trades;
  if (_tradeSearchTerm && _tradeSearchTerm.length >= 2) {
    // Search mode: find all trades involving this player name, any acceptance %
    var allTrades = Engines.findTrades({ minAcceptance: 0 });
    var term = _tradeSearchTerm.toLowerCase();
    trades = allTrades.filter(function(t) {
      return (t.give.name || '').toLowerCase().indexOf(term) >= 0 ||
             (t.get.name || '').toLowerCase().indexOf(term) >= 0;
    });
  } else {
    // Default: 50%+ acceptance
    trades = Engines.findTrades({ minAcceptance: 50 });
  }

  if (!trades.length) {
    container.innerHTML = '<div class="empty-state"><p>' +
      (_tradeSearchTerm ? 'No trade matches for "' + esc(_tradeSearchTerm) + '".' : 'No strong trade matches found with 50%+ acceptance likelihood.') +
      '</p></div>';
    return;
  }

  var html = '<div class="text-xs muted" style="margin:8px 0">' + trades.length + ' trade' + (trades.length !== 1 ? 's' : '') + ' found</div>';
  trades.slice(0, 15).forEach(function(t) {
    html += '<div class="decision-item" style="cursor:pointer" onclick="openPlayerPopup(' + t.get.id + ')">';
    html += '<div class="decision-content">';
    html += '<div class="decision-player">';
    html += '<span class="stat-negative">Give: ' + esc(t.give.name) + '</span> ';
    html += '<span class="stat-positive">Get: ' + esc(t.get.name) + '</span>';
    html += '</div>';
    html += '<div class="decision-replacement">';
    html += esc(t.team.name) + ' | Acceptance: ' + t.acceptanceLikelihood + '% | ';
    html += 'Helps us: ' + (t.helpsUs.length ? t.helpsUs.join(', ') : 'even') + ' | ';
    html += 'Helps them: ' + (t.helpsThem.length ? t.helpsThem.join(', ') : 'even');
    html += '</div></div></div>';
  });
  container.innerHTML = html;
}

function renderTeamAnalyzer() {
  var cats = getOrderedCategories();
  var html = '';
  if (!S.teams.length) return '<div class="empty-state"><p>No team data.</p></div>';

  html += '<div class="card"><div class="card-header">Category Rankings</div>';
  html += '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr><th style="text-align:left">Team</th>';
  cats.forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
  html += '<th>Total Z</th></tr></thead><tbody>';

  S.teams.forEach(function(team) {
    var isMe = team.teamId === S.myTeam.teamId;
    html += '<tr class="' + (isMe ? 'my-team-row' : '') + '">';
    html += '<td style="text-align:left"><strong>' + esc(team.abbrev || team.name) + '</strong></td>';
    var totalZ = 0;
    cats.forEach(function(cat) {
      var sum = 0;
      (team.players || []).forEach(function(p) {
        if (p.slotId < 12) sum += (p.zScores ? p.zScores[cat.abbr] || 0 : 0);
      });
      totalZ += sum;
      html += '<td class="' + (sum > 1 ? 'stat-positive' : (sum < -1 ? 'stat-negative' : '')) + '">' + fmt(sum, 1) + '</td>';
    });
    html += '<td><strong>' + fmt(totalZ, 1) + '</strong></td></tr>';
  });
  html += '</tbody></table></div></div>';

  // Punt analysis
  var punts = Engines.puntAnalysis();
  if (punts.length) {
    html += '<div class="card"><div class="card-header">Punt Analysis</div>';
    punts.forEach(function(p) {
      html += '<div class="punt-item ' + (p.viable ? 'punt-viable' : 'punt-weak') + '">';
      html += '<span style="color:' + p.cat.color + ';font-weight:700">' + p.cat.abbr + '</span>';
      html += '<span>Rank #' + p.rank + '</span>';
      html += '<span>' + (p.viable ? '\u2705 Punt candidate' : '') + '</span>';
      html += '</div>';
    });
    html += '</div>';
  }
  return html;
}

function renderStatsTrends() {
  var rf = Engines.risersAndFallers(S.allPlayers, 8);
  var html = '';

  html += '<div class="card"><div class="card-header">\u{1F4C8} Risers</div>';
  rf.risers.forEach(function(item) {
    var pctStr = Math.round(item.avgChange * 100);
    html += '<div class="mini-row" style="cursor:pointer" onclick="openPlayerPopup(' + item.player.id + ')">';
    html += '<span style="flex:1">' + esc(item.player.name) + '</span>';
    html += '<span class="stat-positive">+' + Math.min(pctStr, 100) + '%</span>';
    html += '</div>';
  });
  html += '</div>';

  html += '<div class="card"><div class="card-header">\u{1F4C9} Fallers</div>';
  rf.fallers.forEach(function(item) {
    var pctStr = Math.round(Math.abs(item.avgChange) * 100);
    html += '<div class="mini-row" style="cursor:pointer" onclick="openPlayerPopup(' + item.player.id + ')">';
    html += '<span style="flex:1">' + esc(item.player.name) + '</span>';
    html += '<span class="stat-negative">-' + Math.min(pctStr, 100) + '%</span>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function renderROSProjections() {
  var cats = getOrderedCategories();
  var myPlayers = S.myTeam.players || [];
  if (!myPlayers.length) return '<div class="empty-state"><p>No roster data.</p></div>';

  Engines.rosProjections(myPlayers);

  var html = '<div class="card">';
  html += '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr><th style="text-align:left">Player</th><th>Games</th>';
  cats.forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
  html += '</tr></thead><tbody>';

  myPlayers.sort(function(a,b) { return (b.effectiveDURANT || 0) - (a.effectiveDURANT || 0); });
  myPlayers.forEach(function(p) {
    html += '<tr><td style="text-align:left;cursor:pointer" onclick="openPlayerPopup(' + p.id + ')">' + esc(p.name) + '</td>';
    html += '<td>' + (p.rosGamesLeft || '-') + '</td>';
    cats.forEach(function(cat) {
      var val = p.rosProjection ? p.rosProjection[cat.abbr] : null;
      html += '<td>' + (val !== null ? (cat.isPercent ? pct(val) : fmt(val, 0)) : '-') + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table></div></div>';
  return html;
}

function renderScheduleGrid(players, label) {
  var html = '<div class="card"><div class="card-header">' + esc(label) + '</div>';
  if (!players || !players.length) { html += '<p class="muted text-sm" style="padding:8px">No players.</p></div>'; return html; }

  var days = [];
  for (var d = 0; d < 7; d++) {
    var date = new Date();
    date.setDate(date.getDate() + d);
    days.push({ date: date, label: date.toLocaleDateString('en-US', {weekday:'short'}), dateStr: localDateStr(date) });
  }

  html += '<div class="table-scroll"><table class="data-table compact schedule-grid-table">';
  html += '<thead><tr><th style="text-align:left">Player</th>';
  days.forEach(function(day, i) {
    html += '<th class="sched-col' + (i === 0 ? ' today' : '') + '">' + day.label + '</th>';
  });
  html += '<th>Total</th></tr></thead><tbody>';

  var dailyTotals = new Array(7).fill(0);

  players.forEach(function(p) {
    html += '<tr><td style="text-align:left">' + esc(p.name) + '</td>';
    var total = 0;

    days.forEach(function(day, di) {
      var hasGame = false;

      if (p.schedule && p.schedule.length) {
        hasGame = p.schedule.some(function(g) { return g.date === day.dateStr; });
      } else if (di === 0 && p.gamesToday) {
        hasGame = true;
      } else {
        var teamHash = 0;
        var team = p.nbaTeam || '';
        for (var c = 0; c < team.length; c++) teamHash += team.charCodeAt(c);
        var gameDays = [(teamHash % 7), ((teamHash + 2) % 7), ((teamHash + 4) % 7)];
        if (teamHash % 3 === 0) gameDays.push((teamHash + 5) % 7);
        hasGame = gameDays.indexOf(di) >= 0;
      }

      var cellContent = hasGame ? p.nbaTeam : '-';
      var cellCls = hasGame ? 'has-game' : '';
      html += '<td class="sched-cell ' + cellCls + '">' + cellContent + '</td>';
      if (hasGame) { total++; dailyTotals[di]++; }
    });
    html += '<td><strong>' + total + '</strong></td></tr>';
  });

  html += '<tr class="totals-row"><td><strong>Total</strong></td>';
  dailyTotals.forEach(function(t) { html += '<td><strong>' + t + '</strong></td>'; });
  html += '<td><strong>' + dailyTotals.reduce(function(a, b) { return a + b; }, 0) + '</strong></td></tr>';
  html += '</tbody></table></div></div>';
  return html;
}

function renderSchedulePage() {
  var html = '<p class="muted text-sm" style="padding:0 0 8px">Estimated game schedule for the next 7 days. Based on real schedule data where available.</p>';
  var myPlayers = (S.myTeam.players || []).filter(function(p) { return p.slotId < 12; });
  html += renderScheduleGrid(myPlayers, 'My Team - 7-Day Schedule');
  return html;
}

function renderDraftCenter() {
  var cats = getOrderedCategories();
  var players = (S.allPlayers || []).slice();
  if (!players.length) return '<div class="empty-state"><p>No player data.</p></div>';

  Engines.computeDURANT(players);
  players.sort(function(a,b) { return (b.effectiveDURANT || 0) - (a.effectiveDURANT || 0); });

  // Assign tiers and projected rounds
  players.forEach(function(p, i) {
    var rank = i + 1;
    if (rank <= Math.ceil(players.length * 0.05)) p.tier = 'Elite';
    else if (rank <= Math.ceil(players.length * 0.15)) p.tier = 'Great';
    else if (rank <= Math.ceil(players.length * 0.35)) p.tier = 'Good';
    else if (rank <= Math.ceil(players.length * 0.60)) p.tier = 'Average';
    else p.tier = 'Below Avg';

    p.projectedRound = Math.ceil(rank / S.league.teamCount) || 1;
  });

  var maxRound = Math.ceil(players.length / Math.max(S.league.teamCount, 1));

  // Filters
  var html = '<div class="filter-bar"><div class="filter-row">';
  html += '<select class="filter-select" onchange="_draftTierFilter=this.value;openLeagueSub(\'draftCenter\')">';
  html += '<option value="all"' + (_draftTierFilter === 'all' ? ' selected' : '') + '>All Tiers</option>';
  ['Elite','Great','Good','Average','Below Avg'].forEach(function(tier) {
    html += '<option value="' + tier + '"' + (_draftTierFilter === tier ? ' selected' : '') + '>' + tier + '</option>';
  });
  html += '</select>';

  html += '<select class="filter-select" onchange="_draftRoundFilter=this.value;openLeagueSub(\'draftCenter\')">';
  html += '<option value="all"' + (_draftRoundFilter === 'all' ? ' selected' : '') + '>All Rounds</option>';
  for (var r = 1; r <= Math.min(maxRound, 15); r++) {
    html += '<option value="' + r + '"' + (_draftRoundFilter === String(r) ? ' selected' : '') + '>Round ' + r + '</option>';
  }
  html += '</select>';
  html += '</div></div>';

  // Apply filters
  var filtered = players.filter(function(p) {
    if (_draftTierFilter !== 'all' && p.tier !== _draftTierFilter) return false;
    if (_draftRoundFilter !== 'all' && String(p.projectedRound) !== _draftRoundFilter) return false;
    return true;
  });

  html += '<div class="text-xs muted" style="margin-bottom:6px">' + filtered.length + ' players</div>';
  html += '<div class="card"><div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr><th>#</th><th style="text-align:left">Player</th><th>Tier</th><th>Rd</th>';
  cats.slice(0,5).forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
  html += '</tr></thead><tbody>';

  var tierColors = {Elite:'var(--accent-gold)',Great:'var(--accent-green)',Good:'var(--accent-blue)',Average:'var(--text-secondary)','Below Avg':'var(--accent-red)'};
  filtered.slice(0, 150).forEach(function(p, i) {
    html += '<tr class="' + (p.onTeamId === S.myTeam.teamId ? 'my-team-row' : '') + '">';
    html += '<td>' + (p.durantRank || i+1) + '</td>';
    html += '<td style="text-align:left;cursor:pointer" onclick="openPlayerPopup(' + p.id + ')">' + esc(p.name) + '</td>';
    html += '<td style="color:' + (tierColors[p.tier] || 'inherit') + ';font-size:0.7rem">' + p.tier + '</td>';
    html += '<td>' + p.projectedRound + '</td>';
    cats.slice(0,5).forEach(function(cat) {
      var pgStats = ESPNSync.getPerGameStats(p, 'season');
      var val = pgStats ? (pgStats[cat.abbr] !== undefined ? pgStats[cat.abbr] : null) : null;
      html += '<td>' + (val !== null ? fmt(val, 1) : '') + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table></div></div>';
  return html;
}

// ========== PROJECTED STANDINGS ==========

function renderProjectedStandings() {
  var html = '';
  if (!S.teams.length) return '<div class="empty-state"><p>No team data.</p></div>';

  var cats = getOrderedCategories();

  // Compute DURANT for all players for z-score access
  if (S.allPlayers.length) Engines.computeDURANT(S.allPlayers);

  // Current standings with category wins projected
  var teamData = S.teams.map(function(team) {
    var r = team.record || {wins:0,losses:0,ties:0};
    var totalZ = 0;
    var catZScores = {};
    cats.forEach(function(cat) {
      var sum = 0;
      (team.players || []).forEach(function(p) {
        if (p.slotId < 12) sum += (p.zScores ? p.zScores[cat.abbr] || 0 : 0);
      });
      catZScores[cat.abbr] = sum;
      totalZ += sum;
    });

    // Project remaining wins based on category strength
    var totalMatchups = S.league.currentMatchupPeriod || 1;
    var remainingMatchups = Math.max(0, (S.league.playoffStartMatchup || 18) - totalMatchups);
    var winRate = (r.wins + r.losses + r.ties) > 0 ? r.wins / (r.wins + r.losses + r.ties) : 0.5;

    // Adjust win rate based on z-score strength (stronger teams win more)
    var avgZ = S.teams.length ? totalZ / cats.length : 0;
    var zBonus = Math.max(-0.15, Math.min(0.15, avgZ * 0.02));
    var projectedWinRate = Math.max(0.1, Math.min(0.9, winRate + zBonus));

    var projWins = r.wins + Math.round(remainingMatchups * projectedWinRate * cats.length);
    var projLosses = r.losses + Math.round(remainingMatchups * (1 - projectedWinRate) * cats.length);

    return {
      team: team,
      record: r,
      totalZ: totalZ,
      catZScores: catZScores,
      projWins: projWins,
      projLosses: projLosses,
      isMe: team.teamId === S.myTeam.teamId
    };
  });

  // Sort by projected wins
  teamData.sort(function(a, b) {
    if (b.projWins !== a.projWins) return b.projWins - a.projWins;
    return b.totalZ - a.totalZ;
  });

  html += '<div class="card"><div class="card-header">Projected Final Standings</div>';
  html += '<p class="muted text-sm">Projections based on current record, category z-scores, and remaining matchups.</p>';
  html += '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr><th>#</th><th style="text-align:left">Team</th><th>Current</th><th>Proj W</th><th>Proj L</th><th>Z-Total</th>';
  html += '<th>Trend</th></tr></thead><tbody>';

  var playoffLine = S.league.playoffTeams || Math.ceil(S.teams.length / 2);

  teamData.forEach(function(td, i) {
    var r = td.record;
    var inPlayoffs = (i + 1) <= playoffLine;
    html += '<tr class="' + (td.isMe ? 'my-team-row' : '') + '">';
    html += '<td>' + (i + 1) + '</td>';
    html += '<td style="text-align:left"><strong>' + esc(td.team.name) + '</strong></td>';
    html += '<td>' + r.wins + '-' + r.losses + '-' + r.ties + '</td>';
    html += '<td class="stat-positive"><strong>' + td.projWins + '</strong></td>';
    html += '<td class="stat-negative">' + td.projLosses + '</td>';
    html += '<td>' + fmt(td.totalZ, 1) + '</td>';
    html += '<td>' + (td.totalZ > 2 ? '\u{1F4C8}' : (td.totalZ < -2 ? '\u{1F4C9}' : '\u{2796}')) + '</td>';
    html += '</tr>';
    if ((i + 1) === playoffLine) {
      html += '<tr><td colspan="7" style="border-top:2px dashed var(--accent-blue);padding:2px;text-align:center;font-size:0.7rem;color:var(--accent-blue)">Playoff cutoff</td></tr>';
    }
  });

  html += '</tbody></table></div></div>';

  // Category power rankings
  html += '<div class="card"><div class="card-header">Category Power Rankings</div>';
  html += '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr><th style="text-align:left">Team</th>';
  cats.forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
  html += '</tr></thead><tbody>';

  teamData.sort(function(a,b) { return b.totalZ - a.totalZ; });
  teamData.forEach(function(td) {
    html += '<tr class="' + (td.isMe ? 'my-team-row' : '') + '">';
    html += '<td style="text-align:left"><strong>' + esc(td.team.abbrev || td.team.name) + '</strong></td>';
    cats.forEach(function(cat) {
      var z = td.catZScores[cat.abbr] || 0;
      html += '<td class="' + (z > 1 ? 'stat-positive' : (z < -1 ? 'stat-negative' : '')) + '">' + fmt(z, 1) + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table></div></div>';

  return html;
}


// ========== OPPONENT SCOUT ==========

function renderOpponentScout() {
  var html = '';
  var oppTeam = S.teams.find(function(t) { return t.teamId === S.matchup.opponentTeamId; });
  if (!oppTeam) return '<div class="empty-state"><p>No current opponent. Check back during an active matchup.</p></div>';

  var cats = getOrderedCategories();
  if (S.allPlayers.length) Engines.computeDURANT(S.allPlayers);

  // Opponent header
  var oppRec = oppTeam.record || {wins:0,losses:0,ties:0};
  html += '<div class="card"><div class="card-header">' + esc(oppTeam.name) + '</div>';
  html += '<div style="padding:8px 0;font-size:0.85rem;color:var(--text-secondary)">';
  html += 'Record: ' + oppRec.wins + '-' + oppRec.losses + '-' + oppRec.ties;
  if (oppTeam.owner) html += ' | Owner: ' + esc(oppTeam.owner);
  html += '</div></div>';

  // Current matchup score
  var mr = S.matchup.myRecord || {wins:0,losses:0,ties:0};
  html += '<div class="card"><div class="card-header">Current Matchup: ' + mr.wins + '-' + mr.losses + '-' + mr.ties + '</div>';
  html += '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr><th>Category</th><th>You</th><th>Them</th><th>Diff</th><th>Status</th></tr></thead><tbody>';

  cats.forEach(function(cat) {
    var myVal = S.matchup.myScores ? S.matchup.myScores[cat.abbr] || 0 : 0;
    var oppVal = S.matchup.oppScores ? S.matchup.oppScores[cat.abbr] || 0 : 0;
    var diff = myVal - oppVal;
    var winning = cat.isNegative ? (diff < 0) : (diff > 0);
    var losing = cat.isNegative ? (diff > 0) : (diff < 0);
    html += '<tr>';
    html += '<td style="color:' + cat.color + ';font-weight:700">' + cat.abbr + '</td>';
    html += '<td>' + (cat.isPercent ? pct(myVal) : fmt(myVal, 1)) + '</td>';
    html += '<td>' + (cat.isPercent ? pct(oppVal) : fmt(oppVal, 1)) + '</td>';
    html += '<td class="' + (winning ? 'stat-positive' : (losing ? 'stat-negative' : '')) + '">' + (diff > 0 ? '+' : '') + (cat.isPercent ? pct(diff) : fmt(diff, 1)) + '</td>';
    html += '<td>' + (winning ? '\u{1F7E2} W' : (losing ? '\u{1F534} L' : '\u{1F7E1} T')) + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table></div></div>';

  // Opponent roster
  var oppPlayers = (oppTeam.players || []).slice();
  oppPlayers.sort(function(a,b) { return (b.effectiveDURANT || 0) - (a.effectiveDURANT || 0); });

  html += '<div class="card"><div class="card-header">Opponent Roster</div>';
  html += '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr><th style="text-align:left">Player</th><th>Pos</th><th>Slot</th><th>Status</th>';
  cats.slice(0, 5).forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
  html += '</tr></thead><tbody>';

  oppPlayers.forEach(function(p) {
    html += '<tr style="cursor:pointer" onclick="openPlayerPopup(' + p.id + ')">';
    html += '<td style="text-align:left">' + esc(p.name) + '</td>';
    html += '<td>' + formatPositions(p.eligibleSlots) + '</td>';
    html += '<td>' + (p.slot || 'BE') + '</td>';
    html += '<td>' + statusBadge(p.injuryStatus) + '</td>';
    cats.slice(0, 5).forEach(function(cat) {
      var pgStats = ESPNSync.getPerGameStats(p, 'season');
      var val = pgStats ? (pgStats[cat.abbr] !== undefined ? pgStats[cat.abbr] : null) : null;
      html += '<td>' + (val !== null ? (cat.isPercent ? pct(val) : fmt(val, 1)) : '') + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table></div></div>';

  // Their strengths and weaknesses
  html += '<div class="card"><div class="card-header">Strengths & Weaknesses</div>';
  var oppCatTotals = [];
  cats.forEach(function(cat) {
    var sum = 0;
    oppPlayers.forEach(function(p) {
      if (p.slotId < 12) sum += (p.zScores ? p.zScores[cat.abbr] || 0 : 0);
    });
    oppCatTotals.push({ cat: cat, z: sum });
  });
  oppCatTotals.sort(function(a, b) { return b.z - a.z; });

  html += '<div style="padding:8px 0">';
  html += '<div style="margin-bottom:8px;font-size:0.8rem;font-weight:700;color:var(--accent-green)">Strongest categories:</div>';
  oppCatTotals.slice(0, 3).forEach(function(ct) {
    html += '<div class="mini-row"><span style="color:' + ct.cat.color + ';font-weight:700">' + ct.cat.abbr + '</span>';
    html += '<span class="stat-positive">z: ' + fmt(ct.z, 1) + '</span></div>';
  });

  html += '<div style="margin:12px 0 8px;font-size:0.8rem;font-weight:700;color:var(--accent-red)">Weakest categories:</div>';
  oppCatTotals.slice(-3).reverse().forEach(function(ct) {
    html += '<div class="mini-row"><span style="color:' + ct.cat.color + ';font-weight:700">' + ct.cat.abbr + '</span>';
    html += '<span class="stat-negative">z: ' + fmt(ct.z, 1) + '</span></div>';
  });
  html += '</div></div>';

  return html;
}


// ========== NEWS & INJURIES ==========

function renderNewsInjuries() {
  var html = '';
  if (!S.allPlayers.length) return '<div class="empty-state"><p>No player data.</p></div>';

  // Collect all injured/GTD/out players
  var injured = S.allPlayers.filter(function(p) {
    return p.injuryStatus && p.injuryStatus !== 'ACTIVE' && p.injuryStatus !== 'HEALTHY';
  });

  // Sort: OUT first, then GTD, then others
  var statusOrder = {OUT: 0, SUSPENSION: 0, IR: 1, INJURED_RESERVE: 1, GTD: 2, DAY_TO_DAY: 2, GAME_TIME_DECISION: 2};
  injured.sort(function(a, b) {
    var ao = statusOrder[a.injuryStatus] !== undefined ? statusOrder[a.injuryStatus] : 3;
    var bo = statusOrder[b.injuryStatus] !== undefined ? statusOrder[b.injuryStatus] : 3;
    if (ao !== bo) return ao - bo;
    return (b.effectiveDURANT || 0) - (a.effectiveDURANT || 0);
  });

  // My team injuries first
  var myInjured = injured.filter(function(p) { return p.onTeamId === S.myTeam.teamId; });
  var oppInjured = injured.filter(function(p) { return p.onTeamId === S.matchup.opponentTeamId; });
  var leagueInjured = injured.filter(function(p) {
    return p.onTeamId !== S.myTeam.teamId && p.onTeamId !== S.matchup.opponentTeamId;
  });

  function renderInjuryList(players, title) {
    if (!players.length) return '<p class="muted text-sm" style="padding:4px 0">No injuries reported.</p>';
    var h = '';
    players.forEach(function(p) {
      var teamName = '';
      var team = S.teams.find(function(t) { return t.teamId === p.onTeamId; });
      if (team) teamName = team.abbrev || team.name;
      h += '<div class="mini-row" style="cursor:pointer" onclick="openPlayerPopup(' + p.id + ')">';
      h += '<span style="flex:1">' + statusBadge(p.injuryStatus) + ' ' + esc(p.name) + '</span>';
      h += '<span class="text-xs muted">' + p.nbaTeam + ' | ' + esc(teamName) + '</span>';
      h += '<span class="text-xs" style="min-width:50px;text-align:right">' + (p.injuryStatus || '').replace(/_/g, ' ') + '</span>';
      h += '</div>';
    });
    return h;
  }

  html += '<div class="card"><div class="card-header">\u{1F6A8} Your Team Injuries (' + myInjured.length + ')</div>';
  html += renderInjuryList(myInjured, 'My Team');
  html += '</div>';

  html += '<div class="card"><div class="card-header">\u{1F50D} Opponent Injuries (' + oppInjured.length + ')</div>';
  html += renderInjuryList(oppInjured, 'Opponent');
  html += '</div>';

  html += '<div class="card"><div class="card-header">\u{1F3C0} League-Wide Injuries (' + leagueInjured.length + ')</div>';
  html += renderInjuryList(leagueInjured, 'League');
  html += '</div>';

  // Injury impact summary
  html += '<div class="card"><div class="card-header">Injury Impact</div>';
  html += '<p class="muted text-sm">Players on your team who are OUT or on IR may be streamable spots. Consider picking up free agents for their empty games.</p>';
  var myOut = myInjured.filter(function(p) {
    return p.injuryStatus === 'OUT' || p.injuryStatus === 'SUSPENSION' || p.injuryStatus === 'IR' || p.injuryStatus === 'INJURED_RESERVE';
  });
  if (myOut.length) {
    html += '<div style="margin-top:8px">';
    myOut.forEach(function(p) {
      html += '<div class="mini-row">';
      html += '<span>' + statusBadge(p.injuryStatus) + ' ' + esc(p.name) + ' (' + p.slot + ')</span>';
      html += '<span class="text-xs stat-negative">Lost production: ~' + fmt(p.zScores ? p.zScores.total : 0, 1) + ' z/game</span>';
      html += '</div>';
    });
    html += '</div>';
  }
  html += '</div>';

  return html;
}


// ========== PLAYOFF PROJECTOR ==========

function renderPlayoffProjector() {
  var html = '';
  if (!S.teams.length) return '<div class="empty-state"><p>No team data.</p></div>';

  var playoffTeams = S.league.playoffTeams || Math.ceil(S.teams.length / 2);
  var currentMP = S.league.currentMatchupPeriod || 1;
  var playoffStartMP = S.league.playoffStartMatchup || 18;
  var remainingMP = Math.max(0, playoffStartMP - currentMP);

  // Sort teams by record
  var sorted = S.teams.slice().sort(function(a, b) {
    var aw = a.record ? a.record.wins : 0; var bw = b.record ? b.record.wins : 0;
    if (bw !== aw) return bw - aw;
    return (b.pointsFor || 0) - (a.pointsFor || 0);
  });

  // Calculate magic numbers and clinch/elimination scenarios
  var leader = sorted[0];
  var leaderWins = leader.record ? leader.record.wins : 0;
  var cats = getOrderedCategories();
  var catsPerMatchup = cats.length;

  html += '<div class="card"><div class="card-header">Playoff Picture</div>';
  html += '<p class="muted text-sm">Playoffs: Top ' + playoffTeams + ' teams | ' + remainingMP + ' matchup' + (remainingMP !== 1 ? 's' : '') + ' remaining | Playoffs start matchup ' + playoffStartMP + '</p>';
  html += '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr><th>Seed</th><th style="text-align:left">Team</th><th>Record</th><th>GB</th><th>Max W</th><th>Status</th></tr></thead><tbody>';

  sorted.forEach(function(team, i) {
    var r = team.record || {wins:0,losses:0,ties:0};
    var totalGames = r.wins + r.losses + r.ties;
    var maxPossibleWins = r.wins + (remainingMP * catsPerMatchup);
    var gamesBack = leaderWins - r.wins;
    var isMe = team.teamId === S.myTeam.teamId;
    var inPlayoffSpot = (i + 1) <= playoffTeams;

    // Status determination
    var status = '';
    var statusCls = '';
    var cutoffTeam = sorted[playoffTeams - 1];
    var cutoffWins = cutoffTeam ? (cutoffTeam.record ? cutoffTeam.record.wins : 0) : 0;

    if (inPlayoffSpot && remainingMP === 0) {
      status = 'Clinched'; statusCls = 'stat-positive';
    } else if (!inPlayoffSpot && maxPossibleWins < cutoffWins) {
      status = 'Eliminated'; statusCls = 'stat-negative';
    } else if (inPlayoffSpot) {
      status = 'In position'; statusCls = 'stat-positive';
    } else {
      status = 'In the hunt'; statusCls = '';
    }

    html += '<tr class="' + (isMe ? 'my-team-row' : '') + '">';
    html += '<td>' + (i + 1) + '</td>';
    html += '<td style="text-align:left"><strong>' + esc(team.name) + '</strong></td>';
    html += '<td>' + r.wins + '-' + r.losses + '-' + r.ties + '</td>';
    html += '<td>' + (gamesBack > 0 ? '-' + gamesBack : '-') + '</td>';
    html += '<td>' + maxPossibleWins + '</td>';
    html += '<td class="' + statusCls + '">' + status + '</td>';
    html += '</tr>';
    if ((i + 1) === playoffTeams) {
      html += '<tr><td colspan="6" style="border-top:2px dashed var(--accent-blue);padding:2px;text-align:center;font-size:0.7rem;color:var(--accent-blue)">Playoff cutoff</td></tr>';
    }
  });
  html += '</tbody></table></div></div>';

  // My team playoff path
  var myTeamData = sorted.find(function(t) { return t.teamId === S.myTeam.teamId; });
  var myIndex = sorted.findIndex(function(t) { return t.teamId === S.myTeam.teamId; });

  if (myTeamData && myIndex >= 0) {
    var myRec = myTeamData.record || {wins:0,losses:0,ties:0};
    var inPlayoffs = (myIndex + 1) <= playoffTeams;

    html += '<div class="card"><div class="card-header">Your Playoff Path</div>';
    if (inPlayoffs) {
      html += '<div style="padding:8px;color:var(--accent-green);font-weight:700">You are currently in a playoff spot (seed #' + (myIndex + 1) + ')</div>';
      if (myIndex > 0) {
        var teamAbove = sorted[myIndex - 1];
        var winsToClimb = (teamAbove.record ? teamAbove.record.wins : 0) - myRec.wins;
        html += '<p class="muted text-sm">' + winsToClimb + ' category win' + (winsToClimb !== 1 ? 's' : '') + ' behind ' + esc(teamAbove.name) + ' for seed #' + myIndex + '.</p>';
      }
    } else {
      var lastPlayoffTeam = sorted[playoffTeams - 1];
      var winsNeeded = (lastPlayoffTeam.record ? lastPlayoffTeam.record.wins : 0) - myRec.wins + 1;
      html += '<div style="padding:8px;color:var(--accent-red);font-weight:700">Currently outside playoffs (seed #' + (myIndex + 1) + ')</div>';
      html += '<p class="muted text-sm">Need ' + winsNeeded + ' more category win' + (winsNeeded !== 1 ? 's' : '') + ' than ' + esc(lastPlayoffTeam.name) + ' to claim a spot.</p>';
    }
    html += '</div>';
  }

  return html;
}


// ========== SEASON TIMELINE ==========

function renderSeasonTimeline() {
  var html = '';
  if (!S.league.schedule || !S.league.schedule.length) return '<div class="empty-state"><p>No schedule data available.</p></div>';

  var currentMP = S.league.currentMatchupPeriod || 1;

  // Group schedule by matchup period and find my matchups
  var matchupPeriods = {};
  S.league.schedule.forEach(function(m) {
    if (!matchupPeriods[m.matchupPeriodId]) matchupPeriods[m.matchupPeriodId] = [];
    matchupPeriods[m.matchupPeriodId].push(m);
  });

  var periods = Object.keys(matchupPeriods).map(Number).sort(function(a, b) { return a - b; });

  html += '<div class="card"><div class="card-header">Season Schedule</div>';
  html += '<p class="muted text-sm">Matchup period ' + currentMP + ' of ' + periods.length + '</p>';

  periods.forEach(function(mp) {
    var matches = matchupPeriods[mp];
    var isCurrent = mp === currentMP;
    var isPast = mp < currentMP;

    // Find my matchup in this period
    var myMatch = matches.find(function(m) {
      return (m.home && m.home.teamId === S.myTeam.teamId) || (m.away && m.away.teamId === S.myTeam.teamId);
    });

    var oppName = '';
    if (myMatch) {
      var isHome = myMatch.home && myMatch.home.teamId === S.myTeam.teamId;
      var oppId = isHome ? (myMatch.away ? myMatch.away.teamId : 0) : (myMatch.home ? myMatch.home.teamId : 0);
      var oppTeam = S.teams.find(function(t) { return t.teamId === oppId; });
      oppName = oppTeam ? oppTeam.name : 'BYE';
    }

    html += '<div class="mini-row" style="' + (isCurrent ? 'background:var(--accent-blue-dim, rgba(59,130,246,0.1));border-radius:6px;padding:6px 8px' : '') + '">';
    html += '<span style="min-width:60px;font-weight:700;color:' + (isCurrent ? 'var(--accent-blue)' : (isPast ? 'var(--text-secondary)' : 'var(--text-primary)')) + '">Week ' + mp + '</span>';
    html += '<span style="flex:1">' + (isCurrent ? '\u{25B6} ' : '') + 'vs ' + esc(oppName) + '</span>';
    html += '<span class="text-xs">' + (isCurrent ? 'Current' : (isPast ? 'Done' : 'Upcoming')) + '</span>';
    html += '</div>';
  });

  html += '</div>';

  // Remaining opponent difficulty
  var upcomingMatches = periods.filter(function(mp) { return mp > currentMP; });
  if (upcomingMatches.length && S.allPlayers.length) {
    Engines.computeDURANT(S.allPlayers);

    html += '<div class="card"><div class="card-header">Remaining Schedule Difficulty</div>';
    upcomingMatches.slice(0, 8).forEach(function(mp) {
      var matches = matchupPeriods[mp];
      var myMatch = matches.find(function(m) {
        return (m.home && m.home.teamId === S.myTeam.teamId) || (m.away && m.away.teamId === S.myTeam.teamId);
      });
      if (!myMatch) return;

      var isHome = myMatch.home && myMatch.home.teamId === S.myTeam.teamId;
      var oppId = isHome ? (myMatch.away ? myMatch.away.teamId : 0) : (myMatch.home ? myMatch.home.teamId : 0);
      var oppTeam = S.teams.find(function(t) { return t.teamId === oppId; });
      if (!oppTeam) return;

      var oppZ = 0;
      (oppTeam.players || []).forEach(function(p) {
        if (p.slotId < 12) oppZ += (p.zScores ? p.zScores.total || 0 : 0);
      });
      var difficulty = oppZ > 5 ? 'Hard' : (oppZ > 0 ? 'Medium' : 'Easy');
      var diffColor = oppZ > 5 ? 'var(--accent-red)' : (oppZ > 0 ? 'var(--accent-gold)' : 'var(--accent-green)');

      html += '<div class="mini-row">';
      html += '<span style="min-width:60px">Week ' + mp + '</span>';
      html += '<span style="flex:1">vs ' + esc(oppTeam.name) + '</span>';
      html += '<span style="color:' + diffColor + ';font-weight:700;font-size:0.8rem">' + difficulty + '</span>';
      html += '</div>';
    });
    html += '</div>';
  }

  return html;
}


// ========== TRADE ANALYZER HELPERS ==========

var _tradeGivePlayer = null;
var _tradeGetPlayer = null;

function tradeAnalyzerSearch(side, query) {
  var resultsEl = document.getElementById('trade-' + side + '-results');
  if (!resultsEl) return;
  if (!query || query.length < 2) { resultsEl.innerHTML = ''; return; }

  var q = query.toLowerCase();
  var matches = S.allPlayers.filter(function(p) {
    return p.name && p.name.toLowerCase().indexOf(q) >= 0;
  }).slice(0, 6);

  var html = '';
  matches.forEach(function(p) {
    html += '<div class="mini-row" style="cursor:pointer;padding:4px 8px" onclick="selectTradePlayer(\'' + side + '\',' + p.id + ')">';
    html += '<span>' + esc(p.name) + '</span>';
    html += '<span class="text-xs muted">' + formatPositions(p.eligibleSlots) + ' | ' + p.nbaTeam + '</span>';
    html += '</div>';
  });
  resultsEl.innerHTML = html;
}

function selectTradePlayer(side, playerId) {
  var p = S.allPlayers.find(function(pl) { return pl.id === playerId; });
  if (!p) return;

  if (side === 'give') {
    _tradeGivePlayer = p;
    var inp = document.getElementById('trade-give-input');
    if (inp) inp.value = p.name;
  } else {
    _tradeGetPlayer = p;
    var inp2 = document.getElementById('trade-get-input');
    if (inp2) inp2.value = p.name;
  }

  document.getElementById('trade-' + side + '-results').innerHTML = '';

  if (_tradeGivePlayer && _tradeGetPlayer) {
    renderTradeAnalysis();
  }
}

function renderTradeAnalysis() {
  var container = document.getElementById('trade-analysis-output');
  if (!container || !_tradeGivePlayer || !_tradeGetPlayer) return;

  var result = Engines.analyzeTrade([_tradeGivePlayer], [_tradeGetPlayer]);
  var cats = getOrderedCategories();

  var gradeColors = {A:'var(--accent-green)',B:'var(--accent-blue)',C:'var(--accent-gold)',D:'var(--accent-red)',F:'var(--accent-red)'};

  var html = '<div style="margin-top:12px;padding:12px;background:var(--bg-input);border-radius:8px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
  html += '<div><strong>' + esc(_tradeGivePlayer.name) + '</strong> <span class="text-xs muted">DURANT: ' + fmt(_tradeGivePlayer.durantScore || 0, 1) + '</span></div>';
  html += '<span style="font-size:1.2rem">\u{27A1}\u{FE0F}</span>';
  html += '<div><strong>' + esc(_tradeGetPlayer.name) + '</strong> <span class="text-xs muted">DURANT: ' + fmt(_tradeGetPlayer.durantScore || 0, 1) + '</span></div>';
  html += '</div>';

  html += '<div style="text-align:center;margin:8px 0">';
  html += '<span style="font-size:1.5rem;font-weight:700;color:' + (gradeColors[result.grade] || 'inherit') + '">Grade: ' + result.grade + '</span>';
  html += '<div class="text-xs muted">Net value: ' + (result.netValue > 0 ? '+' : '') + fmt(result.netValue, 1) + '</div>';
  html += '</div>';

  html += '<div style="font-size:0.8rem;margin-top:8px">';
  cats.forEach(function(cat) {
    var diff = result.catDiffs[cat.abbr] || 0;
    var cls = diff > 0.3 ? 'stat-positive' : (diff < -0.3 ? 'stat-negative' : '');
    html += '<div class="mini-row" style="padding:2px 0">';
    html += '<span style="color:' + cat.color + ';font-weight:700;min-width:35px">' + cat.abbr + '</span>';
    html += '<span class="' + cls + '">' + (diff > 0 ? '+' : '') + fmt(diff, 2) + ' z</span>';
    html += '</div>';
  });
  html += '</div></div>';

  container.innerHTML = html;
}


// ========== NOTIFICATIONS ==========

function renderNotifications() {
  var html = '';
  var notifs = S.notifications || [];

  html += '<div class="card"><div class="card-header">Notifications</div>';

  if (!notifs.length) {
    // Generate some helpful notifications based on current state
    var autoNotifs = [];
    var myPlayers = S.myTeam.players || [];

    // Check for injured starters
    myPlayers.forEach(function(p) {
      if (p.slotId < 12 && p.injuryStatus && p.injuryStatus !== 'ACTIVE' && p.injuryStatus !== 'HEALTHY') {
        autoNotifs.push({
          type: 'warning',
          message: esc(p.name) + ' is ' + (p.injuryStatus || '').replace(/_/g, ' ') + ' and currently in your starting lineup.',
          action: 'openPlayerPopup(' + p.id + ')'
        });
      }
    });

    // Check matchup status
    var mr = S.matchup.myRecord || {wins:0,losses:0,ties:0};
    if (mr.wins + mr.losses + mr.ties > 0) {
      var status = mr.wins > mr.losses ? 'winning' : (mr.wins < mr.losses ? 'losing' : 'tied');
      autoNotifs.push({
        type: status === 'losing' ? 'warning' : 'info',
        message: 'Current matchup: ' + mr.wins + '-' + mr.losses + '-' + mr.ties + ' (' + status + ')',
        action: 'switchTab(1)'
      });
    }

    // Check for strong free agents
    if (S.allPlayers.length) {
      var freeAgents = S.allPlayers.filter(function(p) { return p.onTeamId === 0; });
      freeAgents.sort(function(a, b) { return (b.effectiveDURANT || 0) - (a.effectiveDURANT || 0); });
      var topFA = freeAgents[0];
      var worstStarter = myPlayers.filter(function(p) { return p.slotId < 12; }).sort(function(a, b) {
        return (a.effectiveDURANT || 0) - (b.effectiveDURANT || 0);
      })[0];
      if (topFA && worstStarter && (topFA.durantScore || 0) > (worstStarter.durantScore || 0) + 3) {
        autoNotifs.push({
          type: 'info',
          message: esc(topFA.name) + ' (DURANT: ' + fmt(topFA.durantScore, 1) + ') is available and better than ' + esc(worstStarter.name) + ' (DURANT: ' + fmt(worstStarter.durantScore, 1) + ').',
          action: 'openPlayerPopup(' + topFA.id + ')'
        });
      }
    }

    // Matchup days remaining
    var matchupDates = getMatchupDates();
    autoNotifs.push({
      type: 'info',
      message: matchupDates.daysLeft + ' day' + (matchupDates.daysLeft !== 1 ? 's' : '') + ' remaining in current matchup period.',
      action: ''
    });

    if (!autoNotifs.length) {
      html += '<div class="empty-state"><p>No notifications right now. Check back later.</p></div>';
    } else {
      autoNotifs.forEach(function(n) {
        var icon = n.type === 'warning' ? '\u{26A0}\u{FE0F}' : '\u{2139}\u{FE0F}';
        html += '<div class="mini-row" style="' + (n.action ? 'cursor:pointer' : '') + ';padding:8px" ' + (n.action ? 'onclick="' + n.action + '"' : '') + '>';
        html += '<span style="flex:1">' + icon + ' ' + n.message + '</span>';
        html += '</div>';
      });
    }
  } else {
    notifs.forEach(function(n, i) {
      var icon = n.type === 'warning' ? '\u{26A0}\u{FE0F}' : (n.type === 'error' ? '\u{1F534}' : '\u{2139}\u{FE0F}');
      html += '<div class="mini-row" style="padding:8px;' + (n.read ? 'opacity:0.6' : '') + '">';
      html += '<span style="flex:1">' + icon + ' ' + esc(n.message || '') + '</span>';
      html += '<span class="text-xs muted">' + (n.timestamp ? timeSince(n.timestamp) : '') + '</span>';
      html += '</div>';
    });

    html += '<button class="btn btn-sm btn-secondary" style="margin-top:8px" onclick="S.notifications=[];S.notifBadgeCount=0;autosave();render()">Clear All</button>';
  }

  html += '</div>';
  return html;
}


function renderSettingsPage() {
  var html = '';

  // Theme picker
  html += '<div class="card"><div class="card-header">Theme</div>';
  html += renderThemePicker(getCurrentThemeId());
  html += '</div>';

  html += '<div class="card"><div class="card-header">ESPN Connection</div>';
  html += '<div class="settings-row"><label>League ID</label><span>' + esc(S.espn.leagueId) + '</span></div>';
  html += '<div class="settings-row"><label>Last Sync</label><span>' + (S.espn.lastSync ? new Date(S.espn.lastSync).toLocaleString() : 'Never') + '</span></div>';
  html += '<div class="settings-row"><label>Status</label><span class="' + (S.espn.connected ? 'stat-positive' : 'stat-negative') + '">' + (S.espn.connected ? 'Connected' : 'Disconnected') + '</span></div>';
  html += '<button class="btn btn-primary btn-full" onclick="ESPNSync.syncAll()">Sync Now</button>';
  html += '</div>';

  // League info
  html += '<div class="card"><div class="card-header">League Info</div>';
  html += '<div class="settings-row"><label>Name</label><span>' + esc(S.league.name) + '</span></div>';
  html += '<div class="settings-row"><label>Type</label><span>' + esc(S.league.scoringType) + '</span></div>';
  html += '<div class="settings-row"><label>Teams</label><span>' + S.league.teamCount + '</span></div>';
  html += '<div class="settings-row"><label>Categories</label><span>' + getOrderedCategories().map(function(c){return c.abbr;}).join(', ') + '</span></div>';
  html += '</div>';

  // Sync log
  html += '<div class="card"><div class="card-header">Sync Log</div>';
  (S.espn.syncLog || []).forEach(function(log) {
    html += '<div class="sync-log-item ' + log.status + '">' + new Date(log.timestamp).toLocaleTimeString() + ' - ' + esc(log.message) + '</div>';
  });
  html += '</div>';

  // Data management
  html += '<div class="card"><div class="card-header">Data Management</div>';
  html += '<button class="btn btn-secondary btn-full" onclick="exportData()">Export Data (JSON)</button>';
  html += '<button class="btn btn-secondary btn-full" onclick="document.getElementById(\'import-file\').click()">Import Data</button>';
  html += '<input type="file" id="import-file" accept=".json" style="display:none" onchange="if(this.files[0])importData(this.files[0])">';
  html += '<button class="btn btn-danger btn-full" onclick="if(confirm(\'Reset all data?\'))resetSetup()">Reset All Data</button>';
  html += '</div>';

  return html;
}


// ========== PLAYER POPUP ==========

function openPlayerPopup(playerId) {
  _popupPlayerId = playerId;
  _popupTab = 'stats';
  var overlay = document.getElementById('player-popup-overlay');
  if (overlay) overlay.classList.add('open');
  renderPlayerPopup();
}

function closePlayerPopup() {
  _popupPlayerId = null;
  var overlay = document.getElementById('player-popup-overlay');
  if (overlay) overlay.classList.remove('open');
}

function switchPopupTab(tab) {
  _popupTab = tab;
  renderPlayerPopup();
}

function renderPlayerPopup() {
  if (!_popupPlayerId) return;
  var container = document.getElementById('player-popup-content');
  if (!container) return;

  var p = S.allPlayers.find(function(pl) { return pl.id === _popupPlayerId; });
  if (!p) { container.innerHTML = '<div class="empty-state"><p>Player not found.</p></div>'; return; }

  var cats = getOrderedCategories();
  var streak = Engines.detectStreaks(p);
  var onWatch = S.watchlist && S.watchlist.indexOf(p.id) >= 0;

  var html = '';

  // Header
  var color = ESPN_TEAM_COLORS[p.nbaTeam] || '#666';
  var initials = (p.firstName ? p.firstName[0] : '') + (p.lastName ? p.lastName[0] : '');
  html += '<div class="popup-header">';
  html += '<div class="popup-headshot">';
  html += '<img class="player-headshot" src="https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/' + p.id + '.png&w=96&h=72&cb=1" width="56" height="42" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'" style="border-radius:8px">';
  html += '<span class="player-initials" style="width:56px;height:42px;font-size:1.2rem;background:' + color + ';display:none;border-radius:8px">' + initials + '</span>';
  html += '</div>';
  html += '<div class="popup-info"><h3>' + statusBadge(p.injuryStatus) + ' ' + esc(p.name) + '</h3>';
  html += '<div class="popup-meta">' + formatPositions(p.eligibleSlots) + ' | ' + p.nbaTeam + ' | Own: ' + fmt(p.ownership, 0) + '%</div>';
  if (p.status !== 'ACTIVE' && p.status !== 'HEALTHY') {
    html += '<div class="popup-injury">' + p.status + '</div>';
  }
  html += '</div></div>';

  // Quick stats
  var popupSeasonPg = ESPNSync.getPerGameStats(p, 'season');
  html += '<div class="popup-quick-stats">';
  cats.slice(0, 6).forEach(function(cat) {
    var val = popupSeasonPg ? (popupSeasonPg[cat.abbr] !== undefined ? popupSeasonPg[cat.abbr] : null) : null;
    html += '<div class="quick-stat"><span class="qs-label" style="color:' + cat.color + '">' + cat.abbr + '</span>';
    html += '<span class="qs-val">' + (val !== null ? (cat.isPercent ? pct(val) : fmt(val, 1)) : '') + '</span></div>';
  });
  html += '</div>';

  if (streak.trend !== 'stable') {
    html += '<div style="text-align:center;padding:4px 12px;font-size:0.75rem;color:' + (streak.trend === 'hot' ? 'var(--accent-green)' : 'var(--accent-red)') + '">';
    html += (streak.trend === 'hot' ? '\u{1F525}' : '\u{1F9CA}') + ' ' + streak.label + '</div>';
  }

  // Tabs
  html += '<div class="popup-tabs">';
  ['stats','gameLog','news','schedule','analysis'].forEach(function(tab) {
    var label = {stats:'Stats',gameLog:'Log',news:'News',schedule:'Sched',analysis:'Analysis'}[tab];
    html += '<button class="popup-tab' + (_popupTab === tab ? ' active' : '') + '" onclick="switchPopupTab(\'' + tab + '\')">' + label + '</button>';
  });
  html += '</div><div class="popup-body">';

  if (_popupTab === 'stats') html += renderPopupStats(p, cats);
  else if (_popupTab === 'gameLog') html += renderPopupGameLog(p, cats);
  else if (_popupTab === 'news') html += renderPopupNews(p);
  else if (_popupTab === 'schedule') html += renderPopupSchedule(p);
  else if (_popupTab === 'analysis') html += renderPopupAnalysis(p, cats);

  html += '</div>';

  // Actions
  html += '<div class="popup-actions">';
  html += '<button class="btn btn-sm ' + (onWatch ? 'btn-warning' : 'btn-secondary') + '" onclick="toggleWatchlist(' + p.id + ');renderPlayerPopup()">' + (onWatch ? '\u2B50 Watching' : '\u2606 Watch') + '</button>';
  html += '<a href="https://fantasy.espn.com/basketball/player?playerId=' + p.id + '" target="_blank" class="btn btn-sm btn-secondary">ESPN</a>';
  html += '</div>';

  container.innerHTML = html;
}

function renderPopupStats(p, cats) {
  var html = '<table class="popup-stats-table"><thead><tr><th>Period</th>';
  cats.forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
  html += '</tr></thead><tbody>';
  ['season','last30','last15','last7'].forEach(function(period) {
    var labels = {season:'Season',last30:'L30',last15:'L15',last7:'L7'};
    if (!p.stats[period]) return;
    var pgStats = ESPNSync.getPerGameStats(p, period);
    html += '<tr><td><strong>' + labels[period] + '</strong></td>';
    cats.forEach(function(cat) {
      var val = pgStats ? (pgStats[cat.abbr] !== undefined ? pgStats[cat.abbr] : null) : null;
      html += '<td>' + (val !== null ? (cat.isPercent ? pct(val) : fmt(val, 1)) : '') + '</td>';
    });
    html += '</tr>';
  });
  // Z-score row
  html += '<tr style="border-top:2px solid var(--border)"><td><strong style="color:var(--accent-blue)">Z</strong></td>';
  cats.forEach(function(cat) {
    var z = p.zScores ? p.zScores[cat.abbr] : 0;
    html += '<td class="' + (z > 0.5 ? 'stat-positive' : (z < -0.5 ? 'stat-negative' : '')) + '">' + (z >= 0 ? '+' : '') + fmt(z, 2) + '</td>';
  });
  html += '</tr></tbody></table>';

  // DURANT & extras
  html += '<div style="display:flex;gap:12px;padding:8px 0;font-size:0.78rem;color:var(--text-secondary);border-top:1px solid var(--border);margin-top:8px">';
  html += '<span>GP: ' + (p.gamesPlayed || 0) + '</span><span>MPG: ' + fmt(p.minutesPerGame, 1) + '</span>';
  html += '<span>DURANT: ' + fmt(p.durantScore || 0, 1) + '</span><span>Z-Total: ' + fmt(p.zScores ? p.zScores.total : 0, 2) + '</span>';
  html += '</div>';
  return html;
}

function renderPopupGameLog(p, cats) {
  var html = '<table class="popup-stats-table"><thead><tr><th>Period</th>';
  cats.forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
  html += '</tr></thead><tbody>';
  var periods = ['last7','last15','last30','season'];
  var labels = {last7:'Last 7',last15:'Last 15',last30:'Last 30',season:'Season'};
  var seasonPg = ESPNSync.getPerGameStats(p, 'season');
  periods.forEach(function(period) {
    if (!p.stats[period]) return;
    var pgStats = ESPNSync.getPerGameStats(p, period);
    html += '<tr><td>' + labels[period] + '</td>';
    cats.forEach(function(cat) {
      var val = pgStats ? (pgStats[cat.abbr] !== undefined ? pgStats[cat.abbr] : null) : null;
      var seasonVal = seasonPg ? (seasonPg[cat.abbr] !== undefined ? seasonPg[cat.abbr] : null) : null;
      var cls = '';
      if (period !== 'season' && val !== null && seasonVal !== null) {
        var diff = val - seasonVal;
        if (!cat.isNegative) cls = diff > 0.1 ? 'stat-positive' : (diff < -0.1 ? 'stat-negative' : '');
        else cls = diff < -0.1 ? 'stat-positive' : (diff > 0.1 ? 'stat-negative' : '');
      }
      html += '<td class="' + cls + '">' + (val !== null ? (cat.isPercent ? pct(val) : fmt(val, 1)) : '') + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function renderPopupAnalysis(p, cats) {
  var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">';
  html += '<div style="background:var(--bg-input);border-radius:8px;padding:10px;text-align:center">';
  html += '<div style="font-size:1.1rem;font-weight:700">' + fmt(p.durantScore || 0, 1) + '</div><div class="text-xs muted">DURANT</div></div>';
  html += '<div style="background:var(--bg-input);border-radius:8px;padding:10px;text-align:center">';
  html += '<div style="font-size:1.1rem;font-weight:700">' + fmt(p.zScores ? p.zScores.total : 0, 2) + '</div><div class="text-xs muted">Z-Total</div></div>';
  html += '</div>';

  // Z-score bars
  html += '<div class="z-bars">';
  cats.forEach(function(cat) {
    var z = p.zScores ? p.zScores[cat.abbr] || 0 : 0;
    var isPos = z >= 0;
    var width = Math.min(50, Math.abs(z) * 15);
    html += '<div class="z-bar-row">';
    html += '<span class="z-bar-label" style="color:' + cat.color + '">' + cat.abbr + '</span>';
    html += '<div class="z-bar-track"><div class="z-bar-center"></div>';
    html += '<div class="z-bar-fill ' + (isPos ? 'positive' : 'negative') + '" style="width:' + width + '%"></div></div>';
    html += '<span class="z-bar-value ' + (isPos ? 'positive' : 'negative') + '">' + (isPos ? '+' : '') + fmt(z, 2) + '</span>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function renderPopupNews(p) {
  var html = '';
  var status = p.injuryStatus || 'ACTIVE';

  // Injury status
  html += '<div style="padding:8px 0;border-bottom:1px solid var(--border)">';
  html += '<div style="font-weight:700;margin-bottom:4px">Status</div>';
  html += '<div>' + statusBadge(status) + ' ' + status.replace(/_/g, ' ') + '</div>';
  html += '</div>';

  // Performance trend
  var streak = Engines.detectStreaks(p);
  html += '<div style="padding:8px 0;border-bottom:1px solid var(--border)">';
  html += '<div style="font-weight:700;margin-bottom:4px">Performance Trend</div>';
  var trendIcon = streak.trend === 'hot' ? '\u{1F525}' : (streak.trend === 'cold' ? '\u{1F9CA}' : '\u{2796}');
  html += '<div>' + trendIcon + ' ' + streak.label + '</div>';
  html += '</div>';

  // Ownership trend
  html += '<div style="padding:8px 0;border-bottom:1px solid var(--border)">';
  html += '<div style="font-weight:700;margin-bottom:4px">Ownership</div>';
  html += '<div>' + fmt(p.ownership, 1) + '% owned across ESPN leagues</div>';
  if (p.ownership < 50) {
    html += '<div class="text-xs muted" style="margin-top:4px">Low ownership - potential sleeper or streaming option</div>';
  } else if (p.ownership > 95) {
    html += '<div class="text-xs muted" style="margin-top:4px">Must-roster player in all formats</div>';
  }
  html += '</div>';

  // Fantasy relevance
  html += '<div style="padding:8px 0">';
  html += '<div style="font-weight:700;margin-bottom:4px">Fantasy Impact</div>';
  html += '<div>DURANT Rank: #' + (p.durantRank || '?') + ' | Z-Total: ' + fmt(p.zScores ? p.zScores.total : 0, 2) + '</div>';
  html += '<div class="text-xs muted" style="margin-top:4px">' + (p.gamesPlayed || 0) + ' games played | ' + fmt(p.minutesPerGame, 1) + ' MPG</div>';

  // Frustration index
  if (p.frustrationValue > 3) {
    html += '<div style="margin-top:6px;color:var(--accent-red)">\u{26A0}\u{FE0F} High frustration value (' + fmt(p.frustrationValue, 1) + '/10) - inconsistent performance</div>';
  }
  html += '</div>';

  return html;
}

function renderPopupSchedule(p) {
  var html = '';
  var matchupDates = getMatchupDates();

  // Games remaining this period
  html += '<div style="text-align:center;padding:12px 0;border-bottom:1px solid var(--border)">';
  html += '<div style="font-size:1.5rem;font-weight:700">' + (p.gamesRemaining || 0) + '</div>';
  html += '<div class="text-xs muted">Est. games remaining this matchup period</div>';
  html += '<div class="text-xs muted">' + matchupDates.daysLeft + ' days left in period</div>';
  html += '</div>';

  // 7-day schedule grid
  html += '<div style="padding:8px 0">';
  html += '<div style="font-weight:700;margin-bottom:8px">Next 7 Days</div>';
  html += '<div style="display:flex;gap:4px">';

  for (var d = 0; d < 7; d++) {
    var date = new Date();
    date.setDate(date.getDate() + d);
    var dayLabel = date.toLocaleDateString('en-US', {weekday: 'short'});
    var hasGame = false;

    if (p.schedule && p.schedule.length) {
      hasGame = p.schedule.some(function(g) { return g.date === localDateStr(date); });
    } else if (d === 0 && p.gamesToday) {
      hasGame = true;
    } else {
      var teamHash = 0;
      var team = p.nbaTeam || '';
      for (var c = 0; c < team.length; c++) teamHash += team.charCodeAt(c);
      var gameDays = [(teamHash % 7), ((teamHash + 2) % 7), ((teamHash + 4) % 7)];
      if (teamHash % 3 === 0) gameDays.push((teamHash + 5) % 7);
      hasGame = gameDays.indexOf(d) >= 0;
    }

    html += '<div style="flex:1;text-align:center;padding:6px 2px;border-radius:6px;';
    html += 'background:' + (hasGame ? 'var(--accent-blue-dim, rgba(59,130,246,0.15))' : 'var(--bg-input)') + '">';
    html += '<div class="text-xs" style="color:' + (d === 0 ? 'var(--accent-blue)' : 'var(--text-secondary)') + '">' + dayLabel + '</div>';
    html += '<div style="font-size:0.9rem;margin-top:2px;color:' + (hasGame ? 'var(--accent-blue)' : 'var(--text-secondary)') + '">' + (hasGame ? p.nbaTeam : '-') + '</div>';
    html += '</div>';
  }

  html += '</div></div>';

  // ROS projection
  if (p.rosGamesLeft) {
    html += '<div style="padding:8px 0;border-top:1px solid var(--border)">';
    html += '<div style="font-weight:700;margin-bottom:4px">Rest of Season</div>';
    html += '<div>~' + p.rosGamesLeft + ' games remaining in the NBA season</div>';
    html += '</div>';
  }

  // Today's game info
  html += '<div style="padding:8px 0;border-top:1px solid var(--border)">';
  html += '<div style="font-weight:700;margin-bottom:4px">Today</div>';
  html += '<div>' + (p.gamesToday ? '\u{1F7E2} ' + p.nbaTeam + ' has a game today' : '\u{1F534} No game today') + '</div>';
  html += '</div>';

  return html;
}

function toggleWatchlist(playerId) {
  if (!S.watchlist) S.watchlist = [];
  var idx = S.watchlist.indexOf(playerId);
  if (idx >= 0) S.watchlist.splice(idx, 1);
  else S.watchlist.push(playerId);
  autosave();
}


// Export/Import/StatsKey handled in core.js
