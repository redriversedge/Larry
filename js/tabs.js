// ============================================================
// LARRY v3.0 -- TAB RENDERERS
// All UI rendering: Roster, Matchup, Players, League sub-pages
// ============================================================

// --- PLAYER POPUP STATE ---
var _popupPlayerId = null;
var _popupTab = 'stats';

// --- PLAYERS TAB STATE ---
var _playersSearchTerm = '';
var _playersStatView = 'season';
var _playersPositionFilter = 'ALL';
var _playersAvailFilter = 'available';
var _playersDateFilter = '';
var _playersSortCol = 'durantScore';
// 1 = descending, -1 = ascending. Starts descending so the default view is
// best-ranked first.
var _playersSortDir = 1;
var _playersShowCount = 100;

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
    return esc(p.fullName || p.name || '') + ' (' + esc(p.injuryStatus) + ')';
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
    // Coerce the id to a number before building the URL so a crafted id
    // cannot break out of the src attribute.
    var headshotUrl = 'https://a.espncdn.com/i/headshots/nba/players/full/' +
      (parseInt(p.id, 10) || 0) + '.png';
    var reason = rec.detail ? rec.detail.split('.')[0] : 'Better fit';
    return '<div class="addrop-tile">' +
      '<img class="player-headshot" src="' + headshotUrl + '" onerror="this.style.background=\'var(--bg-surface)\';this.src=\'\'" alt="' + esc(p.name || '') + '">' +
      '<div class="tile-name">' + esc(p.name || '') + '</div>' +
      '<div class="tile-pos">' + formatPositions(p.eligibleSlots) + '</div>' +
      '<div class="tile-drop">Drop: ' + esc(drop ? drop.name : '--') + '</div>' +
      '<div class="tile-reason">' + esc(reason) + '</div>' +
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

  // Larry's Move. The container always renders; the card inside is empty
  // until the user asks for it, so nothing here triggers an API call.
  html += '<div style="display:flex;align-items:center;gap:8px;margin:8px 0">' +
    renderLarryMoveButton() +
    '<span class="text-xs muted">Ask Larry what to do today</span></div>';
  html += '<div id="larry-move-card">' + larryMoveCardHtml() + '</div>';

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

  // Strategy one-liner + Decision Hub (v3: horizontal add/drop tile row)
  if (S.allPlayers.length) {
    Engines.ensureDURANT(S.allPlayers);
    var strat = S.matchup.strategy || {};
    if (strat.summary) {
      html += '<div style="padding:8px 12px;margin-bottom:8px;background:var(--bg-input);border-radius:8px;font-size:13px">';
      html += '<span style="color:var(--accent-gold);font-weight:600">Strategy:</span> ' + esc(strat.summary);
      html += '</div>';
    }
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
  html += '<img class="player-headshot" src="https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/' + (parseInt(p.id, 10) || 0) + '.png&w=48&h=36&cb=1" width="24" height="18" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'" style="border-radius:4px">';
  html += '<span class="player-initials" style="width:24px;height:18px;font-size:0.55rem;background:' + color + ';display:none;border-radius:4px">' + initials + '</span>';
  html += '</div>';
  html += '<div class="player-cell-info">';
  html += '<span class="player-name">' + statusBadge(p.injuryStatus) + ' ' + esc(p.name);
  // Trend badge (from Stats & Trends)
  if (p.trend === 'hot') html += '<span class="trend-badge hot">\u2191 HOT</span>';
  else if (p.trend === 'cold') html += '<span class="trend-badge cold">\u2193 COLD</span>';
  html += '</span>';
  html += '<span class="player-meta">' + formatPositions(p.eligibleSlots) + ' - ' + esc(p.nbaTeam) + '</span>';
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

function renderMatchupStrategy() {
  var strat = S.matchup.strategy || {};
  // Default to empty arrays. The guard below used to check existence and
  // then immediately read .length on all three, so a strategy object with
  // only some of the keys present threw on the second line.
  var targets = strat.targets || [];
  var locks = strat.locks || [];
  var punts = strat.punts || [];
  strat.targets = targets;
  strat.locks = locks;
  strat.punts = punts;
  if (!targets.length && !locks.length && !punts.length) return '';

  var collapsed = isSectionCollapsed('matchupStrategy');
  var html = '<div class="card">';
  html += '<div class="card-header" onclick="toggleSection(\'matchupStrategy\');render()" style="cursor:pointer">';
  html += 'Matchup Strategy <span style="float:right;opacity:0.5">' + (collapsed ? '+' : '-') + '</span></div>';

  if (!collapsed) {
    html += '<div style="padding:12px">';

    // Strategy categories in colored pills
    if (strat.targets.length) {
      html += '<div style="margin-bottom:10px">';
      html += '<span style="color:var(--accent-gold);font-weight:600;margin-right:8px">TARGET</span>';
      strat.targets.forEach(function(cat) {
        html += '<span style="display:inline-block;padding:4px 10px;margin:2px 4px;border-radius:12px;background:rgba(245,158,11,0.15);color:var(--accent-gold);font-size:13px;font-weight:600">' + esc(cat) + '</span>';
      });
      html += '</div>';
    }

    if (strat.locks.length) {
      html += '<div style="margin-bottom:10px">';
      html += '<span style="color:var(--accent-green);font-weight:600;margin-right:8px">LOCK</span>';
      strat.locks.forEach(function(cat) {
        html += '<span style="display:inline-block;padding:4px 10px;margin:2px 4px;border-radius:12px;background:rgba(34,197,94,0.15);color:var(--accent-green);font-size:13px;font-weight:600">' + esc(cat) + '</span>';
      });
      html += '</div>';
    }

    if (strat.punts.length) {
      html += '<div style="margin-bottom:10px">';
      html += '<span style="color:var(--accent-red);font-weight:600;margin-right:8px">PUNT</span>';
      strat.punts.forEach(function(cat) {
        html += '<span style="display:inline-block;padding:4px 10px;margin:2px 4px;border-radius:12px;background:rgba(239,68,68,0.15);color:var(--accent-red);font-size:13px;font-weight:600">' + esc(cat) + '</span>';
      });
      html += '</div>';
    }

    html += '<p class="muted text-sm" style="margin-top:8px">Focus streaming and pickups on target categories. Locks are safe. Punts are not worth chasing this week.</p>';
    html += '</div>';
  }
  html += '</div>';
  return html;
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

  // Matchup Strategy card
  html += renderMatchupStrategy();

  // Schedule Advantage (v3 fix)
  html += renderScheduleAdvantage();

  // 7-Day Schedule Grids (my team + opponent)
  var mySchedPlayers = S.myTeam.players || [];
  var oppSchedTeam = S.teams.find(function(t) { return t.teamId === S.matchup.opponentTeamId; });
  var oppSchedPlayers = oppSchedTeam ? (oppSchedTeam.players || []).map(function(stub) {
    return S.allPlayers.find(function(ap) { return ap.id === stub.id; }) || stub;
  }) : [];
  html += renderScheduleGrid(mySchedPlayers, 'My Team - Next 7 Days');
  if (oppSchedPlayers.length) {
    html += renderScheduleGrid(oppSchedPlayers, esc(S.matchup.opponentName || 'Opponent') + ' - Next 7 Days');
  }

  // Team of the Week (v3: moved to matchup)
  html += renderTeamOfWeek(cats);

  // Opponent Insight was removed in phase 7: it duplicated the Opponent
  // Scout page in a smaller box. Link there instead.
  if (S.matchup && S.matchup.opponentTeamId) {
    html += '<div class="card"><div style="padding:12px;display:flex;' +
      'align-items:center;gap:10px;flex-wrap:wrap">' +
      '<span class="text-sm">Scouting ' + esc(S.matchup.opponentName || 'your opponent') + '?</span>' +
      '<button class="btn btn-sm btn-secondary" style="min-height:44px" ' +
      'onclick="openLeagueSub(\'opponentScout\')">Open Opponent Scout</button>' +
      '</div></div>';
  }

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
  var html = '<div class="card"><div class="card-header">Schedule Advantage</div>';
  html += '<div class="sched-adv">';
  html += '<div class="sched-adv-team"><div class="adv-count">' + myGames + '</div><div class="adv-label">Your Games</div></div>';
  html += '<div class="sched-adv-diff ' + (diff > 0 ? 'positive' : (diff < 0 ? 'negative' : '')) + '">' + (diff > 0 ? '+' : '') + diff + '</div>';
  html += '<div class="sched-adv-team"><div class="adv-count">' + oppGames + '</div><div class="adv-label">Opp Games</div></div>';
  html += '</div>';

  // Days remaining callout. Uses the real matchup window, not the calendar
  // week: opening week is Tuesday to Sunday and playoff matchups run two
  // weeks, so "days left" from a Mon-Sun assumption is wrong at both ends.
  var win = getMatchupWindow();
  html += '<div style="text-align:center;padding:8px;font-size:0.8rem;color:var(--text-secondary)">';
  html += win.daysLeft + ' days remaining in matchup period';
  if (win.label) {
    html += '<div class="text-xs muted" style="margin-top:2px">' + esc(win.label) + '</div>';
  }
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
  var myName = S.myTeam.name || 'My Team';
  var oppName = S.matchup.opponentName || 'Opponent';

  var html = '<div class="card">';
  html += '<div class="card-header">Actual + Projected Totals';
  html += '<span class="text-xs muted" style="margin-left:8px">~ = volatile</span>';
  html += '</div>';
  // Team name header row
  html += '<div class="score-row" style="font-weight:700;font-size:0.75rem;color:var(--text-secondary);border-bottom:2px solid var(--border);padding-bottom:6px">';
  html += '<div class="my-score">' + esc(myName) + '</div>';
  html += '<div class="cat-name"></div>';
  html += '<div class="opp-score">' + esc(oppName) + '</div>';
  html += '</div>';

  var projWins = 0, projLosses = 0;

  cats.forEach(function(cat) {
    var myProjected = 0, oppProjected = 0;
    var myVariance = 0, oppVariance = 0;

    myPlayers.forEach(function(p) {
      var gamesLeft = p.gamesRemaining || 0;
      var seasonPg = ESPNSync.getPerGameStats(p, 'season');
      var last7Pg = ESPNSync.getPerGameStats(p, 'last7');
      var seasonVal = seasonPg ? (seasonPg[cat.abbr] || 0) : 0;
      var last7Val = last7Pg ? (last7Pg[cat.abbr] || 0) : seasonVal;
      myProjected += seasonVal * gamesLeft;
      myVariance += Math.abs(last7Val - seasonVal);
    });

    oppPlayers.forEach(function(p) {
      var gamesLeft = p.gamesRemaining || 0;
      var seasonPg = ESPNSync.getPerGameStats(p, 'season');
      var last7Pg = ESPNSync.getPerGameStats(p, 'last7');
      var seasonVal = seasonPg ? (seasonPg[cat.abbr] || 0) : 0;
      var last7Val = last7Pg ? (last7Pg[cat.abbr] || 0) : seasonVal;
      oppProjected += seasonVal * gamesLeft;
      oppVariance += Math.abs(last7Val - seasonVal);
    });

    // Combine actual scores so far with remaining projection
    var myActual = (S.matchup.myScores && S.matchup.myScores[cat.abbr]) ? (S.matchup.myScores[cat.abbr] || 0) : 0;
    var oppActual = (S.matchup.oppScores && S.matchup.oppScores[cat.abbr]) ? (S.matchup.oppScores[cat.abbr] || 0) : 0;
    var myTotal = myActual + myProjected;
    var oppTotal = oppActual + oppProjected;

    var myWins = cat.isNegative ? myTotal < oppTotal : myTotal > oppTotal;
    var oppWins = cat.isNegative ? oppTotal < myTotal : oppTotal > myTotal;
    if (myWins) projWins++;
    else if (oppWins) projLosses++;

    var myVolatile = myVariance > VOLATILITY_THRESHOLD;
    var oppVolatile = oppVariance > VOLATILITY_THRESHOLD;

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
  html += '<input type="text" class="filter-search" id="players-search" aria-label="Search players" placeholder="Search players..." ';
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

// Disable the button while a sync runs so an impatient double-tap does not
// fire two overlapping syncs, and say something when it finishes.
function doManualSync(btn) {
  if (btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Syncing...';
  }
  var done = function(ok) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Sync Now';
    }
    if (typeof toast === 'function') toast(ok ? 'Sync complete' : 'Sync failed');
  };
  try {
    var result = ESPNSync.syncAll();
    if (result && typeof result.then === 'function') {
      result.then(function() { done(true); }, function() { done(false); });
    } else {
      done(true);
    }
  } catch (e) {
    done(false);
  }
}

// Trade search was re-rendering the results on every keystroke, which is
// both wasteful and the classic way to lose the mobile keyboard. Now on the
// shared debounce, and it never rewrites the input element.
var _debouncedTradeResults = debounce(function() { renderTradeResults(); }, 250);
function handleTradeSearch(value) {
  _tradeSearchTerm = value;
  _debouncedTradeResults();
}

// Debounced search that does NOT dismiss the keyboard: only the list
// re-renders, never the input element.
var _debouncedPlayersList = debounce(function() { renderPlayersList(); }, 250);
function handlePlayersSearch(value) {
  _playersSearchTerm = value;
  // A new search is a new result set, so start the page count over rather
  // than keeping whatever "show more" depth the previous query reached.
  _playersShowCount = 100;
  _debouncedPlayersList();
}

// The Players table label used to be hard-coded to "Availability Score",
// which was never what it sorted on. Report the column actually in use.
function playersSortLabel() {
  if (_playersSortCol === 'durantScore') return 'DURANT Rank';
  if (_playersSortCol === 'name') return 'Name';
  return _playersSortCol;
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
  Engines.ensureDURANT(players);

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

  // Sort by DURANT by default. The rank column prints p.durantRank, so this
  // has to sort on the same field the rank was assigned from; it used to
  // sort on effectiveDURANT and print durantRank, which disagreed.
  // dir is applied to every branch. It used to only reach the stat branch,
  // so tapping Player or the rank column could never reverse the order.
  filtered.sort(function(a, b) {
    var dir = _playersSortDir;
    if (_playersSortCol === 'durantScore') {
      // No-evidence players sort last in BOTH directions: reversing the
      // table should not promote players we know nothing about to the top.
      var aNo = a.durantScore === null || a.durantScore === undefined;
      var bNo = b.durantScore === null || b.durantScore === undefined;
      if (aNo !== bNo) return aNo ? 1 : -1;
      if (aNo && bNo) return (b.percentOwned || 0) - (a.percentOwned || 0);
      return (b.durantScore - a.durantScore) * dir;
    }
    if (_playersSortCol === 'name') {
      // Negated so the first tap on Player gives A to Z. For numbers "first
      // tap" means biggest first; for names it means alphabetical.
      return (a.name || '').localeCompare(b.name || '') * -dir;
    }
    var aVal = playersStatValue(a, _playersSortCol);
    var bVal = playersStatValue(b, _playersSortCol);
    return (bVal - aVal) * dir;
  });

  // Render trending section above table
  var todayStr = localDateStr(new Date());
  var trendingHtml = renderTrendingSection(players);

  // Render table
  var html = trendingHtml;
  // Say how many are actually on screen. The header used to report the full
  // filtered count while the table rendered only the first 100, so it read
  // "666 players" above a 100-row table with no way to reach the rest.
  var willShow = Math.min(_playersShowCount, filtered.length);
  var preseason = isPreseason();
  if (preseason) {
    html += '<div class="card" style="padding:8px 10px;margin-bottom:8px">' +
      '<div style="font-weight:700;font-size:0.85rem">Preseason board</div>' +
      '<div class="text-xs muted">Per-game value from projections; long-term ' +
      'injuries discounted.</div></div>';
  }
  html += '<div class="text-xs muted" style="margin-bottom:6px">Showing ' + willShow +
    ' of ' + filtered.length + ' players</div>';
  html += '<p class="sort-label">Sorted by ' + esc(playersSortLabel()) +
    (_playersSortCol !== 'durantScore' ?
      ' <button class="btn btn-sm btn-secondary" style="min-height:44px" ' +
      'onclick="resetPlayersSort()">Reset</button>' : '') + '</p>';
  html += '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr>';
  html += '<th style="text-align:left;min-width:28px"><button type="button" class="th-sort" ' +
    'onclick="sortPlayers(\'durantScore\')" aria-label="Sort by DURANT rank">#' +
    playersSortIndicator('durantScore') + '</button></th>';
  html += '<th class="stat-col">Today</th>';
  html += '<th style="text-align:left;min-width:120px"><button type="button" class="th-sort" ' +
    'onclick="sortPlayers(\'name\')" aria-label="Sort by player name">Player' +
    playersSortIndicator('name') + '</button></th>';
  // Preseason the whole board rests on ESPN's projected games, so show the
  // number the value was built from rather than making the user guess why
  // someone is lower than expected.
  if (preseason) html += '<th class="stat-col">Proj GP</th>';
  cats.forEach(function(cat) {
    html += '<th class="stat-col" style="color:' + cat.color + '">' +
      '<button type="button" class="th-sort" onclick="sortPlayers(\'' + cat.abbr + '\')" ' +
      'aria-label="Sort by ' + cat.abbr + '">' + cat.abbr +
      playersSortIndicator(cat.abbr) + '</button></th>';
  });
  html += '</tr></thead><tbody>';

  var shown = Math.min(_playersShowCount, filtered.length);
  filtered.slice(0, shown).forEach(function(p, idx) {
    var isMyTeam = p.onTeamId === S.myTeam.teamId;
    html += '<tr class="' + (isMyTeam ? 'my-team-row' : '') + '">';
    // A player we know nothing about gets no rank number. Printing one
    // would imply we had placed them, when all we did was run out of
    // players with evidence.
    html += '<td class="text-xs muted">' + (p.noEvidence ? '--' : (p.durantRank || idx + 1)) + '</td>';
    var gameCell = formatGameCell(getGameForDate(p, todayStr));
    html += '<td class="stat-col game-cell" style="font-size:0.72rem;white-space:nowrap">' + (gameCell ? gameCell : '<span class="muted">-</span>') + '</td>';
    html += '<td style="cursor:pointer" onclick="openPlayerPopup(' + p.id + ')">' + renderPlayerCell(p) +
      (p.projectionSuspect ? '<div class="text-xs muted">Projection limited</div>' : '') + '</td>';
    if (preseason) {
      var pgp = (p.stats && p.stats.projectedGP) || 0;
      html += '<td class="stat-col text-xs muted">' + (pgp > 0 ? Math.round(pgp) : '--') + '</td>';
    }

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

  if (filtered.length > shown) {
    html += '<div style="text-align:center;padding:12px 0">' +
      '<button class="btn btn-secondary" style="min-height:44px" onclick="showMorePlayers()">' +
      'Show 100 more (' + (filtered.length - shown) + ' remaining)</button></div>';
  }

  listContainer.innerHTML = html;
}

function showMorePlayers() {
  _playersShowCount += 100;
  renderPlayersList();
}

// _playersSortDir: 1 = descending, -1 = ascending.
//
// A fresh column starts descending, which is what you want from "sort by
// points". It used to start at -1 and the comparator computed
// (b - a) * dir, so the first tap produced ascending order and you had to
// tap twice to see the leaders.
function sortPlayers(col) {
  if (_playersSortCol === col) _playersSortDir *= -1;
  else { _playersSortCol = col; _playersSortDir = 1; }
  renderPlayersList();
}

// Restore the default view: DURANT rank, best first.
function resetPlayersSort() {
  _playersSortCol = 'durantScore';
  _playersSortDir = 1;
  renderPlayersList();
}

// The value the Players table is currently showing for a category, matching
// whatever stat view is active. The ROS view was missing here, so sorting
// the ROS column compared zeros and did nothing.
function playersStatValue(p, col) {
  if (_playersStatView === 'day') {
    var day = _dayStats ? _dayStats[p.id] : null;
    return day ? (day[col] || 0) : 0;
  }
  if (_playersStatView === 'ros') {
    if (!p.rosProjection) Engines.rosProjections([p]);
    return p.rosProjection ? (p.rosProjection[col] || 0) : 0;
  }
  var pg = ESPNSync.getPerGameStats(p, _playersStatView);
  return pg ? (pg[col] || 0) : 0;
}

function playersSortIndicator(col) {
  if (_playersSortCol !== col) return '';
  // Escapes, not literals: js/ must stay ASCII.
  return _playersSortDir === 1 ? ' \u25BC' : ' \u25B2';
}

function renderTrendingSection(allPlayers) {
  var risers = [], fallers = [];
  allPlayers.forEach(function(p) {
    if (p.trend === 'hot') risers.push(p);
    else if (p.trend === 'cold') fallers.push(p);
  });
  risers = risers.sort(function(a, b) { return durantKey(b.durantScore) - durantKey(a.durantScore); }).slice(0, 5);
  fallers = fallers.sort(function(a, b) { return durantKey(b.durantScore) - durantKey(a.durantScore); }).slice(0, 5);

  if (!risers.length && !fallers.length) return '<p class="empty-state">Not enough data for trends yet.</p>';

  var rows = function(players, dir) {
    return players.map(function(p) {
      return '<div class="trend-row">' +
        '<span class="trend-dir ' + (dir === 'up' ? 'rising' : 'falling') + '">' + (dir === 'up' ? '+' : '-') + '</span>' +
        '<span class="trend-name">' + esc(p.name || '') + '</span>' +
        '<span class="trend-team">' + esc(p.nbaTeam || '') + '</span>' +
        '</div>';
    }).join('');
  };

  return '<div class="trending-section card">' +
    '<div class="trending-header" onclick="this.parentElement.classList.toggle(\'open\')">' +
    '<span>League Trending</span><span class="toggle-arrow">&#9660;</span>' +
    '</div>' +
    '<div class="trending-body">' +
    (risers.length ? '<div class="trend-group"><div class="trend-group-label">Trending Up</div>' + rows(risers, 'up') + '</div>' : '') +
    (fallers.length ? '<div class="trend-group"><div class="trend-group-label">Trending Down</div>' + rows(fallers, 'down') + '</div>' : '') +
    '</div>' +
    '</div>';
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
    'Analysis': ['trades', 'teamAnalyzer', 'projections'],
    'Info': ['news'],
    'System': ['notifications', 'settings']
  };
  // In the week before the draft the Draft Room is the first thing anyone
  // opens the app for. Once the season starts it drops back under Info.
  if (isPreseason()) sections['Overview'].unshift('draftRoom');
  else sections['Info'].push('draftRoom');
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
  // The old Draft Center is the Draft Room now. A bookmark or a stored
  // leagueSubPage from before the rename still lands on the right page.
  if (page === 'draftCenter') page = 'draftRoom';
  var html = '<div class="sub-page-header">';
  html += '<button class="btn-back" onclick="S.leagueSubPage=null;render()">\u276E Back</button>';
  var menuItem = LEAGUE_MENU.find(function(m) { return m.id === page; });
  html += '<h2>' + (menuItem ? menuItem.icon + ' ' + menuItem.label : page) + '</h2>';
  html += '</div>';

  try {
    switch(page) {
      case 'standings': html += renderStandingsPage(); break;
      case 'trades': html += renderTradeCenter(); break;
      case 'teamAnalyzer': html += renderTeamAnalyzer(); break;
      case 'opponentScout': html += renderOpponentScout(); break;
      case 'streaming': html += renderStreamingPage(); break;
      case 'watchlist': html += renderWatchlistPage(); break;
      case 'statsTrends': html += renderStatsTrends(); break;
      case 'projections': html += renderROSProjections(); break;
      case 'schedule': html += renderSchedulePage(); break;
      case 'news': html += renderNewsInjuries(); break;
      case 'timeline': html += renderSeasonTimeline(); break;
      case 'settings': html += renderSettingsPage(); break;
      // Old routes from before the phase 7 merge. Someone's bookmarked
      // leagueSubPage can still be sitting in localStorage.
      case 'projectedStandings':
      case 'playoffs':
        html += renderStandingsPage(page === 'playoffs' ? 'playoff' : 'projected'); break;
      case 'draftRoom': html += renderDraftRoom(); break;
      case 'notifications':
        html += '<div class="empty-state"><p>This page was removed. ' +
          'Try Standings or the Roster dashboard.</p></div>'; break;
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

// --- WATCHLIST (phase 8) ---
// S.watchlist has been written by toggleWatchlist from the player popup for
// a long time, but nothing ever displayed it. Starring a player wrote to
// localStorage and then vanished.
function renderWatchlistPage() {
  var ids = S.watchlist || [];
  if (!ids.length) {
    return '<div class="empty-state"><p>Nothing on your watchlist yet.</p>' +
      '<p class="text-xs muted">Open any player and tap Watch to add them.</p></div>';
  }

  var players = [];
  for (var i = 0; i < ids.length; i++) {
    for (var j = 0; j < (S.allPlayers || []).length; j++) {
      if (S.allPlayers[j].id === ids[i]) { players.push(S.allPlayers[j]); break; }
    }
  }
  if (!players.length) {
    return '<div class="empty-state"><p>Your watchlist players are not in the ' +
      'current player pool. Sync to refresh.</p></div>';
  }

  Engines.ensureDURANT(S.allPlayers || []);
  players.sort(function(a, b) { return durantKey(b.durantScore) - durantKey(a.durantScore); });

  var cats = getOrderedCategories();
  var html = '<div class="card"><div class="table-scroll">' +
    '<table class="data-table compact"><thead><tr>' +
    '<th style="text-align:left;min-width:120px">Player</th>' +
    '<th class="stat-col">Status</th><th class="stat-col">Games</th>';
  cats.forEach(function(cat) {
    html += '<th class="stat-col" style="color:' + cat.color + '">' + cat.abbr + '</th>';
  });
  html += '<th class="stat-col"></th></tr></thead><tbody>';

  players.forEach(function(p) {
    var owner = p.onTeamId === 0 ? 'FA' : (p.onTeamId === S.myTeam.teamId ? 'Mine' : 'Rostered');
    html += '<tr>';
    html += '<td style="cursor:pointer" onclick="openPlayerPopup(' + p.id + ')">' +
      renderPlayerCell(p) + '</td>';
    html += '<td class="stat-col text-xs">' + statusBadge(p.injuryStatus) + ' ' + esc(owner) + '</td>';
    html += '<td class="stat-col">' + (p.gamesRemaining || 0) + '</td>';
    var pg = ESPNSync.getPerGameStats(p, 'season');
    cats.forEach(function(cat) {
      var v = pg ? pg[cat.abbr] : null;
      html += '<td class="stat-col">' + (v != null ? fmt(v, 1) : '') + '</td>';
    });
    html += '<td class="stat-col"><button class="btn btn-sm btn-secondary" ' +
      'style="min-height:44px" aria-label="Remove from watchlist" ' +
      'onclick="toggleWatchlist(' + p.id + ');render()">Remove</button></td>';
    html += '</tr>';
  });

  html += '</tbody></table></div></div>';
  return html;
}

// --- STREAMING (phase 8) ---
// The waiver question is not "who is best" but "who is available, healthy,
// playing the most games left this week, and helps a category still in
// play". That is a different sort from the Players tab and deserves its
// own page.
function renderStreamingPage() {
  var strat = (S.matchup && S.matchup.strategy) || {};
  var targets = strat.targets || [];
  var cats = getOrderedCategories();

  var fas = (S.allPlayers || []).filter(function(p) {
    return p.onTeamId === 0 && Engines.isValidAddCandidate(p);
  });
  if (!fas.length) {
    return '<div class="empty-state"><p>No free agents available. Sync to refresh.</p></div>';
  }

  Engines.ensureDURANT(S.allPlayers || []);

  // Rank by games left this week first, value second. A slightly worse
  // player with three games beats a better one with one.
  fas.forEach(function(p) {
    var targetHelp = 0;
    for (var i = 0; i < targets.length; i++) {
      targetHelp += (p.zScores ? p.zScores[targets[i]] || 0 : 0);
    }
    p._streamScore = (p.gamesRemaining || 0) * 10 +
      (p.durantScore || 0) * 0.5 + targetHelp * 5;
  });
  fas.sort(function(a, b) { return b._streamScore - a._streamScore; });

  var html = '';
  if (targets.length) {
    html += '<div class="card"><div style="padding:10px 12px" class="text-sm">' +
      'Highlighting <strong>' + esc(targets.join(', ')) + '</strong>, the categories ' +
      'still in play this week.</div></div>';
  }

  html += '<div class="card"><div class="table-scroll">' +
    '<table class="data-table compact"><thead><tr>' +
    '<th style="text-align:left;min-width:120px">Player</th>' +
    '<th class="stat-col">Games</th><th class="stat-col">Today</th>';
  cats.forEach(function(cat) {
    var isTarget = targets.indexOf(cat.abbr) >= 0;
    html += '<th class="stat-col"' + (isTarget ? ' style="color:' + cat.color +
      ';text-decoration:underline"' : ' style="color:' + cat.color + ';opacity:0.55"') +
      '>' + cat.abbr + '</th>';
  });
  html += '<th class="stat-col">Own</th></tr></thead><tbody>';

  fas.slice(0, 40).forEach(function(p) {
    html += '<tr>';
    html += '<td style="cursor:pointer" onclick="openPlayerPopup(' + p.id + ')">' +
      renderPlayerCell(p) + '</td>';
    html += '<td class="stat-col"><strong>' + (p.gamesRemaining || 0) + '</strong></td>';
    html += '<td class="stat-col">' + (p.gamesToday ? '\u{1F7E2}' : '-') + '</td>';
    var pg = ESPNSync.getPerGameStats(p, 'season');
    cats.forEach(function(cat) {
      var isTarget = targets.indexOf(cat.abbr) >= 0;
      var v = pg ? pg[cat.abbr] : null;
      html += '<td class="stat-col"' + (isTarget ? '' : ' style="opacity:0.55"') + '>' +
        (v != null ? fmt(v, 1) : '') + '</td>';
    });
    html += '<td class="stat-col text-xs muted">' + fmt(p.percentOwned || 0, 0) + '%</td>';
    html += '</tr>';
  });

  html += '</tbody></table></div></div>';
  return html;
}

// Standings, Projected Standings and Playoff Projector were three separate
// menu entries answering one question: where do I stand and where am I
// heading. Phase 7 merges them into one page with a Current / Projected /
// Playoff toggle, reusing the existing renderers unchanged.
var _standingsView = 'current';

function setStandingsView(view) {
  _standingsView = view;
  render();
}

function renderStandingsPage(forceView) {
  if (forceView) _standingsView = forceView;
  var views = [
    { id: 'current', label: 'Current' },
    { id: 'projected', label: 'Projected' },
    { id: 'playoff', label: 'Playoff' }
  ];
  var html = '<div class="sub-tab-bar" role="tablist" aria-label="Standings view">';
  views.forEach(function(v) {
    var active = _standingsView === v.id;
    html += '<button class="sub-tab' + (active ? ' active' : '') + '" role="tab" ' +
      'aria-selected="' + (active ? 'true' : 'false') + '" ' +
      'onclick="setStandingsView(\'' + v.id + '\')">' + v.label + '</button>';
  });
  html += '</div>';

  if (_standingsView === 'projected') html += renderProjectedStandings();
  else if (_standingsView === 'playoff') html += renderPlayoffProjector();
  else html += renderStandings();
  return html;
}

function renderStandings() {
  if (!S.teams.length) return '<div class="empty-state"><p>No standings data.</p></div>';
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
  if (S.allPlayers.length) Engines.ensureDURANT(S.allPlayers);

  // Search for specific player trades
  html += '<div class="card"><div class="card-header">Trade Finder</div>';
  html += '<input type="text" class="filter-search" aria-label="Search for a player to see trade options" placeholder="Search for a player to see trade options..." ';
  html += 'value="' + esc(_tradeSearchTerm) + '" oninput="handleTradeSearch(this.value)">';
  html += '<div id="trade-results"></div></div>';

  // Trade Analyzer
  html += '<div class="card"><div class="card-header">Trade Analyzer</div>';
  html += '<p class="muted text-sm" style="margin-bottom:8px">Compare two players to evaluate a trade.</p>';
  html += '<div style="display:flex;gap:8px;margin-bottom:8px">';
  html += '<input type="text" class="filter-search" id="trade-give-input" aria-label="Players you give" placeholder="You give..." style="flex:1" oninput="tradeAnalyzerSearch(\'give\',this.value)">';
  html += '<input type="text" class="filter-search" id="trade-get-input" aria-label="Players you get" placeholder="You get..." style="flex:1" oninput="tradeAnalyzerSearch(\'get\',this.value)">';
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
  // .slice() so the sort below does not reorder S.myTeam.players in place.
  // It used to, and autosave then persisted the render order as the user's
  // actual roster order.
  var myPlayers = (S.myTeam.players || []).slice();
  if (!myPlayers.length) return '<div class="empty-state"><p>No roster data.</p></div>';

  Engines.rosProjections(myPlayers);

  var html = '<div class="card">';
  html += '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr><th style="text-align:left">Player</th><th>Games</th>';
  cats.forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
  html += '</tr></thead><tbody>';

  myPlayers.sort(function(a,b) { return durantKey(b.durantScore) - durantKey(a.durantScore); });
  myPlayers.forEach(function(p) {
    html += '<tr><td style="text-align:left;cursor:pointer" onclick="openPlayerPopup(' + p.id + ')">' + esc(p.name) + '</td>';
    html += '<td>' + (p.rosGamesLeft || '-') + '</td>';
    cats.forEach(function(cat) {
      var val = p.rosProjection ? p.rosProjection[cat.abbr] : null;
      html += '<td>' + (val != null ? (cat.isPercent ? pct(val) : fmt(val, 0)) : '-') + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table></div></div>';
  return html;
}

function renderScheduleGrid(players, label) {
  var html = '<div class="card">';
  html += '<div class="card-header" onclick="this.nextElementSibling.classList.toggle(\'hidden\')">' + esc(label) + ' <span class="text-xs muted">\u25BC</span></div>';
  html += '<div class="hidden">';
  if (!players || !players.length) { html += '<p class="muted text-sm" style="padding:8px">No players.</p></div></div>'; return html; }

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
    var isBench = p.slotId >= 12;
    html += '<tr' + (isBench ? ' class="bench-row"' : '') + '><td style="text-align:left">' + esc(p.name) + (isBench ? ' <span class="text-xs muted">BE</span>' : '') + '</td>';
    var total = 0;

    days.forEach(function(day, di) {
      var game = getGameForDate(p, day.dateStr);
      var hasGame = !!game;
      var cellContent = game ? formatGameCell(game) : '<span class="muted">-</span>';
      var cellCls = hasGame ? 'has-game' : '';
      html += '<td class="sched-cell ' + cellCls + '" style="font-size:0.65rem">' + cellContent + '</td>';
      if (hasGame) { total++; dailyTotals[di]++; }
    });
    html += '<td><strong>' + total + '</strong></td></tr>';
  });

  html += '<tr class="totals-row"><td><strong>Total</strong></td>';
  dailyTotals.forEach(function(t) { html += '<td><strong>' + t + '</strong></td>'; });
  html += '<td><strong>' + dailyTotals.reduce(function(a, b) { return a + b; }, 0) + '</strong></td></tr>';
  html += '</tbody></table></div></div></div>';
  return html;
}

function renderSchedulePage() {
  var html = '<p class="muted text-sm" style="padding:0 0 8px">Estimated game schedule for the next 7 days. Based on real schedule data where available.</p>';
  var myPlayers = (S.myTeam.players || []).filter(function(p) { return p.slotId < 12; });
  html += renderScheduleGrid(myPlayers, 'My Team - 7-Day Schedule');
  return html;
}


// ========== PROJECTED STANDINGS ==========

function renderProjectedStandings() {
  var html = '';
  if (!S.teams.length) return '<div class="empty-state"><p>No team data.</p></div>';

  var cats = getOrderedCategories();

  // Compute DURANT for all players for z-score access
  if (S.allPlayers.length) Engines.ensureDURANT(S.allPlayers);

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
    var avgZ = (S.teams.length && cats.length) ? totalZ / cats.length : 0;
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
  if (S.allPlayers.length) Engines.ensureDURANT(S.allPlayers);

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
  oppPlayers.sort(function(a,b) { return durantKey(b.durantScore) - durantKey(a.durantScore); });

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
    return durantKey(b.durantScore) - durantKey(a.durantScore);
  });

  function renderInjuryList(players) {
    if (!players.length) return '<p class="muted text-sm" style="padding:4px 0">No injuries reported.</p>';
    var h = '';
    players.forEach(function(p) {
      var teamName = '';
      var team = S.teams.find(function(t) { return t.teamId === p.onTeamId; });
      if (team) teamName = team.abbrev || team.name;
      h += '<div class="mini-row" style="cursor:pointer" onclick="openPlayerPopup(' + p.id + ')">';
      h += '<span style="flex:1">' + statusBadge(p.injuryStatus) + ' ' + esc(p.name) + '</span>';
      h += '<span class="text-xs muted">' + esc(p.nbaTeam) + ' | ' + esc(teamName) + '</span>';
      h += '<span class="text-xs" style="min-width:50px;text-align:right">' + (p.injuryStatus || '').replace(/_/g, ' ') + '</span>';
      h += '</div>';
    });
    return h;
  }

  html += '<div class="card"><div class="card-header">\u{1F3C0} League-Wide Injuries (' + injured.length + ')</div>';
  html += renderInjuryList(injured);
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
    Engines.ensureDURANT(S.allPlayers);

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
    html += '<span class="text-xs muted">' + formatPositions(p.eligibleSlots) + ' | ' + esc(p.nbaTeam) + '</span>';
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
  html += '<div><strong>' + esc(_tradeGivePlayer.name) + '</strong> <span class="text-xs muted">DURANT: ' + durantText(_tradeGivePlayer.durantScore, 1) + '</span></div>';
  html += '<span style="font-size:1.2rem">\u{27A1}\u{FE0F}</span>';
  html += '<div><strong>' + esc(_tradeGetPlayer.name) + '</strong> <span class="text-xs muted">DURANT: ' + durantText(_tradeGetPlayer.durantScore, 1) + '</span></div>';
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



// Flipping this changes every rank, so the cached board has to go and
// DURANT has to run again before anything renders.
function toggleLarryProjections(on) {
  S.prefs = S.prefs || {};
  S.prefs.useLarryProjections = !!on;
  S.analysisCache = S.analysisCache || {};
  S.analysisCache.durantComputedAt = null;
  S.analysisCache.larryProjections = null;
  saveState();
  // Turning it on needs the history file, which is only fetched when the
  // flag is set, so load it before recomputing rather than silently
  // falling back to ESPN until the next sync.
  ESPNSync.loadProjectionData().catch(function() {}).then(function() {
    S.analysisCache.durantComputedAt = null;
    Engines.ensureDURANT(S.allPlayers);
    render();
  });
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
  html += '<button id="sync-now-btn" class="btn btn-primary btn-full" ' +
    'style="min-height:44px" onclick="doManualSync(this)">Sync Now</button>';
  // Phase 2: Disconnect clears cookies and cached league/team/roster data,
  // then drops the user back at the wizard. Theme and prefs survive.
  html += '<button class="btn btn-warning btn-full" style="margin-top:8px" onclick="if(confirm(\'This will sign you out of ESPN and clear your cookies. You will need to reconnect to use Larry.\'))disconnectEspn()">Disconnect ESPN</button>';
  html += '</div>';

  // Draft Room diagnostics. The same held-out test tools/fit-mock-draft.ts
  // runs, available without a local export.
  if (typeof DraftRoom !== 'undefined' && DraftRoom.renderModelCheckCard) {
    html += '<div class="card"><div class="card-header">Draft Room</div>';
    html += DraftRoom.renderModelCheckCard();
    html += '</div>';
  }

  // Larry projections. Off by default and labelled honestly: the backtest
  // says ESPN ranks players better, so this is an experiment the owner can
  // opt into, not a recommended setting.
  var lpOn = !!(S.prefs && S.prefs.useLarryProjections);
  html += '<div class="card"><div class="card-header">Projections</div>';
  html += '<div class="settings-row"><label for="larry-proj-toggle">Use Larry projections</label>';
  html += '<input type="checkbox" id="larry-proj-toggle" style="min-width:44px;min-height:44px" ' +
    (lpOn ? 'checked ' : '') + 'onchange="toggleLarryProjections(this.checked)"></div>';
  html += '<div class="text-xs muted" style="padding:0 4px 4px">' +
    'Off by default. Larry\'s own model is built from four seasons of box ' +
    'scores. On a held-out season it ranked players worse than ESPN ' +
    '(0.79 against 0.84 correlation with actual value), though it predicted ' +
    'games played better. Full numbers in docs/PROJECTIONS_BACKTEST.md.' +
    '</div>';
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

  // Phase 1 Beta: v2 recommendation engine toggle. Hidden under a
  // collapsed Beta card so it does not pollute the main settings view.
  // No UI redesign in this phase per LARRY_PLAN.md (Phase 3 covers UX).
  var v2On = !!(S.prefs && S.prefs.useV2Engine);
  html += '<div class="card">';
  html += '<div class="card-header" onclick="this.nextElementSibling.classList.toggle(\'hidden\')">Beta <span class="text-xs muted">\u25BC</span></div>';
  html += '<div class="hidden">';
  html += '<div class="settings-row"><label>v2 recommendation engine</label>';
  html += '<input type="checkbox" id="toggle-v2-engine" ' + (v2On ? 'checked' : '') + ' onchange="S.prefs.useV2Engine=this.checked;saveState();"></div>';
  html += '<div class="settings-row" style="font-size:12px;color:var(--muted)">G-score + team-fit blend. Reload after changing.</div>';
  html += '</div></div>';

  // Data management
  html += '<div class="card"><div class="card-header">Data Management</div>';
  html += '<button class="btn btn-secondary btn-full" onclick="exportData()">Export Data (JSON)</button>';
  html += '<button class="btn btn-secondary btn-full" onclick="document.getElementById(\'import-file\').click()">Import Data</button>';
  html += '<input type="file" id="import-file" accept=".json" style="display:none" onchange="if(this.files[0])importData(this.files[0])">';
  html += '<button class="btn btn-danger btn-full" onclick="if(confirm(\'Reset all data?\'))resetSetup()">Reset All Data</button>';
  html += '</div>';

  return html;
}


// Phase 2: top-of-tab banner shown when ESPN returns 401 (cookies
// expired). safeRender in core.js prepends this to whatever the
// current tab renders, so the banner appears on every tab without
// each tab having to know about it. The Reconnect button routes
// directly to /connect (bookmarklet install page), bypassing the
// wizard so users keep their league ID and prefs.
function renderEspnExpiredBanner() {
  return '<div class="alert alert-danger" style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">' +
    '<div style="flex:1;min-width:200px"><strong>ESPN session expired.</strong> Reconnect ESPN to continue.</div>' +
    '<button class="btn btn-primary btn-sm" onclick="reconnectEspn()" style="white-space:nowrap">Reconnect ESPN</button>' +
    '</div>';
}


// ========== PLAYER POPUP ==========

function openPlayerPopup(playerId) {
  _popupPlayerId = playerId;
  _popupTab = 'stats';
  var overlay = document.getElementById('player-popup-overlay');
  if (overlay) overlay.classList.add('open');
  renderPlayerPopup();
  // A modal that traps you until you find the X is a keyboard dead end.
  if (!_popupEscBound) {
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && _popupPlayerId) closePlayerPopup();
    });
    _popupEscBound = true;
  }
}
var _popupEscBound = false;

function closePlayerPopup() {
  _popupPlayerId = null;
  var overlay = document.getElementById('player-popup-overlay');
  if (overlay) overlay.classList.remove('open');
}

function switchPopupTab(tab) {
  _popupTab = tab;
  renderPlayerPopup();
}

// Every render path is wrapped so a bad player record shows a diagnostic
// card instead of a blank modal (CLAUDE.md: never blank screens). The popup
// was the one renderer still missing this.
function renderPlayerPopup() {
  if (!_popupPlayerId) return;
  var container = document.getElementById('player-popup-content');
  if (!container) return;
  try {
    container.innerHTML = buildPlayerPopup();
  } catch (e) {
    container.innerHTML = '<div class="error-card"><h3>Could not load this player</h3>' +
      '<p>' + esc(e.message) + '</p>' +
      '<pre>' + esc((e.stack || '').substring(0, 300)) + '</pre>' +
      '<button class="btn btn-secondary" style="min-height:44px" ' +
      'onclick="closePlayerPopup()">Close</button></div>';
  }
}

function buildPlayerPopup() {
  var p = null;
  for (var pi = 0; pi < S.allPlayers.length; pi++) {
    if (S.allPlayers[pi].id === _popupPlayerId) { p = S.allPlayers[pi]; break; }
  }
  if (!p) return '<div class="empty-state"><p>Player not found.</p></div>';
  // Guard the stats bag: a stub copied from a team roster may not have one.
  if (!p.stats) p.stats = { season: {}, last7: {}, last15: {}, last30: {}, totals: {}, gp: {} };

  var cats = getOrderedCategories();
  var streak = Engines.detectStreaks(p);
  var onWatch = S.watchlist && S.watchlist.indexOf(p.id) >= 0;

  var html = '';

  // Header
  var color = ESPN_TEAM_COLORS[p.nbaTeam] || '#666';
  var initials = (p.firstName ? p.firstName[0] : '') + (p.lastName ? p.lastName[0] : '');
  html += '<div class="popup-header">';
  html += '<div class="popup-headshot">';
  html += '<img class="player-headshot" src="https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/' + (parseInt(p.id, 10) || 0) + '.png&w=96&h=72&cb=1" width="56" height="42" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'" style="border-radius:8px">';
  html += '<span class="player-initials" style="width:56px;height:42px;font-size:1.2rem;background:' + color + ';display:none;border-radius:8px">' + initials + '</span>';
  html += '</div>';
  html += '<div class="popup-info"><h3>' + statusBadge(p.injuryStatus) + ' ' + esc(p.name) + '</h3>';
  // Ownership is blank until ESPN publishes it, which before the draft is
  // every player. "Own: -%" reads like a bug; omit the field instead.
  var ownPct = typeof p.ownership === 'number' && isFinite(p.ownership)
    ? ' | Own: ' + fmt(p.ownership, 0) + '%' : '';
  html += '<div class="popup-meta">' + formatPositions(p.eligibleSlots) + ' | ' + esc(p.nbaTeam) + ownPct + '</div>';
  if (p.status !== 'ACTIVE' && p.status !== 'HEALTHY') {
    html += '<div class="popup-injury">' + esc(p.status) + '</div>';
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
  html += '<a href="https://fantasy.espn.com/basketball/player?playerId=' +
    (parseInt(p.id, 10) || 0) + '" target="_blank" rel="noopener noreferrer" ' +
    'class="btn btn-sm btn-secondary" style="min-height:44px">ESPN</a>';
  html += '</div>';

  return html;
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
  html += '<span>DURANT: ' + durantText(p.durantScore, 1) + '</span><span>Z-Total: ' + fmt(p.zScores ? p.zScores.total : 0, 2) + '</span>';
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
  html += '<div style="font-size:1.1rem;font-weight:700">' + durantText(p.durantScore, 1) + '</div><div class="text-xs muted">DURANT</div></div>';
  html += '<div style="background:var(--bg-input);border-radius:8px;padding:10px;text-align:center">';
  html += '<div style="font-size:1.1rem;font-weight:700">' + fmt(p.zScores ? p.zScores.total : 0, 2) + '</div><div class="text-xs muted">Z-Total</div></div>';
  html += '</div>';

  // Larry's own projection, when the flag is on. Shows the source so an
  // override is visible as an override rather than looking like the model.
  var lproj = Engines.larryProjFor ? Engines.larryProjFor(p) : null;
  if (lproj && lproj.perGame) {
    html += '<div style="padding:8px 0;border-bottom:1px solid var(--border)">';
    html += '<div style="font-weight:700;margin-bottom:4px">Larry projection</div>';
    html += '<div class="text-xs">' + cats.map(function(cat) {
      return esc(cat.abbr) + ' ' + fmt(lproj.perGame[cat.abbr] || 0, 1);
    }).join('  ') + '</div>';
    html += '<div class="text-xs muted" style="margin-top:4px">' +
      Math.round(lproj.gp || 0) + ' games, ' + fmt(lproj.mpg || 0, 1) +
      ' mpg, source ' + esc(String(lproj.source || 'model')) + '</div>';
    html += '</div>';
  }

  // Why this player's preseason value is what it is. Without this the
  // discount is invisible and a lower-than-expected rank looks like a bug.
  if (isPreseason()) {
    var projGP = (p.stats && p.stats.projectedGP) || 0;
    var notes = [];
    if (projGP > 0) notes.push('ESPN projects ' + Math.round(projGP) + ' games');
    if (p.projectionSuspect) {
      notes.push('Projection limited: ESPN has too few games here to trust ' +
        'the rate, so no availability discount was applied');
    } else if (projGP > 0 && projGP < 60 && !p.noEvidence) {
      notes.push('Long-term discount applied (projected ' + Math.round(projGP) + ' games)');
    }
    if (p.noEvidence) {
      notes.push('No games played and no ESPN projection, so there is nothing ' +
        'to rank this player on');
    }
    if (notes.length) {
      html += '<div class="text-xs muted" style="margin-bottom:10px">' +
        esc(notes.join('. ')) + '.</div>';
    }
  }

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

  // Ownership trend. Skipped entirely when ESPN has not published a number,
  // which before the draft is everyone. Showing "-% owned across ESPN
  // leagues" looks like a failure rather than missing upstream data.
  if (typeof p.ownership === 'number' && isFinite(p.ownership)) {
    html += '<div style="padding:8px 0;border-bottom:1px solid var(--border)">';
    html += '<div style="font-weight:700;margin-bottom:4px">Ownership</div>';
    html += '<div>' + fmt(p.ownership, 1) + '% owned across ESPN leagues</div>';
    if (p.ownership < 50) {
      html += '<div class="text-xs muted" style="margin-top:4px">Low ownership - potential sleeper or streaming option</div>';
    } else if (p.ownership > 95) {
      html += '<div class="text-xs muted" style="margin-top:4px">Must-roster player in all formats</div>';
    }
    html += '</div>';
  }

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
  var popupWin = getMatchupWindow();

  // Games remaining this period. The count is real now (it comes from the
  // NBA schedule inside the real matchup window), so drop the "Est." hedge.
  html += '<div style="text-align:center;padding:12px 0;border-bottom:1px solid var(--border)">';
  html += '<div style="font-size:1.5rem;font-weight:700">' + (p.gamesRemaining || 0) + '</div>';
  html += '<div class="text-xs muted">Games remaining this matchup period</div>';
  html += '<div class="text-xs muted">' + popupWin.daysLeft + ' days left' +
    (popupWin.label ? ', ' + esc(popupWin.label) : '') + '</div>';
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

    // Only ever show real games. This used to fall through to a hash of the
    // team's name to invent game days, which rendered a confident-looking
    // schedule that was entirely fictional.
    if (p.schedule && p.schedule.length) {
      hasGame = p.schedule.some(function(g) { return g.date === localDateStr(date); });
    } else if (d === 0 && p.gamesToday) {
      hasGame = true;
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
  html += '<div>' + (p.gamesToday ? '\u{1F7E2} ' + esc(p.nbaTeam) + ' has a game today' : '\u{1F534} No game today') + '</div>';
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
