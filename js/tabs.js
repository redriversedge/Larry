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
var _playersAvailFilter = 'all';
var _playersSortCol = 'durantScore';
var _playersSortDir = -1;

// --- ROSTER TAB STATE ---
var _rosterDateOffset = 0;
var _rosterStatView = 'season';

// --- MATCHUP STATE ---
var _matchupSubTab = 'score';


// ========== ROSTER TAB ==========

function renderRoster(container) {
  var cats = getOrderedCategories();
  var html = '';

  // Dashboard section (moved here from League in v3)
  html += renderDashboardInline();

  // Date navigation (v3 new)
  html += renderDateNav();

  // Stat view dropdown (v3: dropdown not buttons)
  html += '<div class="stat-view-bar">';
  html += '<select class="stat-view-select" onchange="_rosterStatView=this.value;render()">';
  ['season','last30','last15','last7'].forEach(function(v) {
    var labels = {season:'Season Avg',last30:'Last 30',last15:'Last 15',last7:'Last 7'};
    html += '<option value="' + v + '"' + (_rosterStatView === v ? ' selected' : '') + '>' + labels[v] + '</option>';
  });
  html += '</select>';
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

  // Decision Hub (v3 fix: smarter recs)
  if (S.allPlayers.length) {
    Engines.computeDURANT(S.allPlayers);
    var recs = Engines.generateRecommendations(myPlayers, S.allPlayers);
    if (recs.length) {
      html += '<div class="card">';
      html += '<div class="card-header">Decision Hub</div>';
      html += '<div class="decision-list">';
      recs.slice(0, 5).forEach(function(rec, i) {
        html += '<div class="decision-item">';
        html += '<div class="decision-rank">#' + (i+1) + '</div>';
        html += '<div class="decision-content">';
        html += '<div class="decision-player"><strong>' + esc(rec.action) + '</strong></div>';
        html += '<div class="decision-replacement">' + esc(rec.detail) + '</div>';
        html += '</div></div>';
      });
      html += '</div></div>';
    }
  }

  container.innerHTML = html;
}

function renderDashboardInline() {
  var html = '<div class="card">';
  html += '<div class="card-header" onclick="this.nextElementSibling.classList.toggle(\'hidden\')">Dashboard <span class="text-xs muted">\u25BC</span></div>';
  html += '<div>';

  // Quick cards
  html += '<div class="quick-cards">';
  var rec = S.myTeam.record || {wins:0,losses:0,ties:0};
  html += '<div class="quick-card"><div class="qc-value">' + rec.wins + '-' + rec.losses + '-' + rec.ties + '</div><div class="qc-label">Record</div></div>';

  // Matchup record
  var mr = S.matchup.myRecord || {wins:0,losses:0,ties:0};
  html += '<div class="quick-card"><div class="qc-value">' + mr.wins + '-' + mr.losses + '-' + mr.ties + '</div><div class="qc-label">Matchup</div></div>';

  // Playoff seed
  html += '<div class="quick-card"><div class="qc-value">#' + (S.myTeam.playoffSeed || '-') + '</div><div class="qc-label">Seed</div></div>';

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
  html += '<th class="game-cell">Today</th>';
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

    // Today column: show opponent + time (v3 fix)
    html += '<td class="game-cell">';
    if (p.gameToday) {
      html += '<span class="game-info">' + esc(p.gameToday.opponent || '') + '</span>';
      if (p.gameToday.time) html += '<br><span class="text-xs muted">' + p.gameToday.time + '</span>';
    } else if (p.gamesToday) {
      html += '<span class="game-info">' + p.nbaTeam + '</span>';
    } else {
      html += '<span class="no-game-label">-</span>';
    }
    html += '</td>';

    var period = _rosterStatView;
    cats.forEach(function(cat) {
      var val = p.stats && p.stats[period] ? p.stats[period][cat.abbr] : null;
      var cls = '';
      if (p.zScores && p.zScores[cat.abbr]) {
        cls = p.zScores[cat.abbr] > 0.5 ? 'stat-positive' : (p.zScores[cat.abbr] < -0.5 ? 'stat-negative' : '');
      }
      html += '<td class="stat-col ' + cls + '">' + (val !== null ? (cat.isPercent ? pct(val) : fmt(val, 1)) : '-') + '</td>';
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
  html += '<span class="player-name">' + statusBadge(p.injuryStatus) + ' ' + esc(p.name) + '</span>';
  html += '<span class="player-meta">' + p.positions.join('/') + ' - ' + p.nbaTeam + '</span>';
  html += '</div></div>';
  return html;
}


// ========== MATCHUP TAB ==========

function renderMatchup(container) {
  var cats = getOrderedCategories();
  var html = '';

  // Sub-tabs
  html += '<div class="sub-tab-bar">';
  ['score','projections','recap'].forEach(function(st) {
    var labels = {score:'Score',projections:'Projections',recap:'Recap'};
    html += '<button class="sub-tab' + (_matchupSubTab === st ? ' active' : '') + '" onclick="_matchupSubTab=\'' + st + '\';render()">' + labels[st] + '</button>';
  });
  html += '</div>';

  if (_matchupSubTab === 'score') {
    html += renderMatchupScore(cats);
  } else if (_matchupSubTab === 'projections') {
    html += renderMatchupProjections(cats);
  } else if (_matchupSubTab === 'recap') {
    html += renderMatchupRecap(cats);
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

  // Category bars
  html += '<div class="cat-scores">';
  cats.forEach(function(cat) {
    var my = S.matchup.myScores ? S.matchup.myScores[cat.abbr] || 0 : 0;
    var opp = S.matchup.oppScores ? S.matchup.oppScores[cat.abbr] || 0 : 0;
    var winning = cat.isNegative ? (my < opp) : (my > opp);
    var losing = cat.isNegative ? (my > opp) : (my < opp);
    var cls = winning ? 'winning' : (losing ? 'losing' : 'tied');
    var total = my + opp || 1;
    var myPct = cat.isNegative ? ((opp / total) * 100) : ((my / total) * 100);

    html += '<div class="cat-bar ' + cls + '">';
    html += '<span class="cat-val" style="color:' + (winning ? 'var(--accent-green)' : (losing ? 'var(--accent-red)' : 'var(--text-secondary)')) + '">' + (cat.isPercent ? pct(my) : fmt(my, 1)) + '</span>';
    html += '<span class="cat-name" style="color:' + cat.color + '">' + cat.abbr + '</span>';
    html += '<div class="cat-meter"><div class="cat-fill" style="width:' + myPct + '%;background:' + cat.color + '"></div></div>';
    html += '<span class="cat-val">' + (cat.isPercent ? pct(opp) : fmt(opp, 1)) + '</span>';
    html += '</div>';
  });
  html += '</div>';

  // Schedule Advantage (v3 fix)
  html += renderScheduleAdvantage();

  // Team of the Week (v3: moved to matchup)
  html += renderTeamOfWeek(cats);

  return html;
}

function renderScheduleAdvantage() {
  // Count games remaining this matchup period for each team
  var myGames = 0, oppGames = 0;
  var myPlayers = S.myTeam.players || [];
  myPlayers.forEach(function(p) { if (p.slotId < 12) myGames += (p.gamesRemaining || 0); });

  var oppTeam = S.teams.find(function(t) { return t.teamId === S.matchup.opponentTeamId; });
  if (oppTeam && oppTeam.players) {
    oppTeam.players.forEach(function(p) { if (p.slotId < 12) oppGames += (p.gamesRemaining || 0); });
  }

  var diff = myGames - oppGames;
  var html = '<div class="card"><div class="card-header">Schedule Advantage</div>';
  html += '<div class="sched-adv">';
  html += '<div class="sched-adv-team"><div class="adv-count">' + myGames + '</div><div class="adv-label">Your Games</div></div>';
  html += '<div class="sched-adv-diff ' + (diff > 0 ? 'positive' : (diff < 0 ? 'negative' : '')) + '">' + (diff > 0 ? '+' : '') + diff + '</div>';
  html += '<div class="sched-adv-team"><div class="adv-count">' + oppGames + '</div><div class="adv-label">Opp Games</div></div>';
  html += '</div></div>';
  return html;
}

function renderTeamOfWeek(cats) {
  // Find best player for each category across the league this period
  if (!cats.length || !S.allPlayers.length) return '';
  var html = '<div class="card"><div class="card-header" onclick="this.nextElementSibling.classList.toggle(\'hidden\')">Team of the Week <span class="text-xs muted">\u25BC</span></div>';
  html += '<div class="hidden"><div class="mini-table">';
  cats.forEach(function(cat) {
    var best = null; var bestVal = cat.isNegative ? Infinity : -Infinity;
    S.allPlayers.forEach(function(p) {
      var val = p.stats && p.stats.last7 ? p.stats.last7[cat.abbr] : null;
      if (val === null) return;
      if (cat.isNegative ? val < bestVal : val > bestVal) { bestVal = val; best = p; }
    });
    if (best) {
      var isMyPlayer = best.onTeamId === S.myTeam.teamId;
      html += '<div class="mini-row' + (isMyPlayer ? ' my-team-row' : '') + '">';
      html += '<span style="color:' + cat.color + ';min-width:36px;font-weight:700">' + cat.abbr + '</span>';
      html += '<span style="flex:1;cursor:pointer" onclick="openPlayerPopup(' + best.id + ')">' + esc(best.name) + '</span>';
      html += '<span style="font-weight:700">' + (cat.isPercent ? pct(bestVal) : fmt(bestVal, 1)) + '</span>';
      html += '</div>';
    }
  });
  html += '</div></div></div>';
  return html;
}

function renderMatchupProjections(cats) {
  var myPlayers = (S.myTeam.players || []).filter(function(p) { return p.slotId < 12; });
  var oppTeam = S.teams.find(function(t) { return t.teamId === S.matchup.opponentTeamId; });
  var oppPlayers = oppTeam ? (oppTeam.players || []).filter(function(p) { return p.slotId < 12; }) : [];

  if (!myPlayers.length) return '<div class="empty-state"><p>No roster data. Sync with ESPN first.</p></div>';

  // Build games remaining map
  var gamesMap = {};
  myPlayers.concat(oppPlayers).forEach(function(p) { gamesMap[p.id] = p.gamesRemaining || 2; });

  var probs = Engines.monteCarloMatchup(myPlayers, oppPlayers, gamesMap, 3000);

  var html = '<div class="card"><div class="card-header">Win Probability (Monte Carlo)</div>';
  var projWins = 0, projLosses = 0;

  cats.forEach(function(cat) {
    var prob = probs[cat.abbr] || {win:50,lose:50,tie:0};
    var winPct = prob.win;
    if (winPct > 50) projWins++;
    else if (winPct < 50) projLosses++;

    var cls = winPct > 60 ? 'stat-positive' : (winPct < 40 ? 'stat-negative' : '');
    html += '<div class="mini-row">';
    html += '<span style="color:' + cat.color + ';min-width:36px;font-weight:700">' + cat.abbr + '</span>';
    html += '<div style="flex:1;height:6px;background:var(--bg-surface);border-radius:3px;overflow:hidden">';
    html += '<div style="width:' + winPct + '%;height:100%;background:' + (winPct > 50 ? 'var(--accent-green)' : 'var(--accent-red)') + ';border-radius:3px"></div></div>';
    html += '<span class="' + cls + '" style="min-width:40px;text-align:right;font-weight:700">' + winPct + '%</span>';
    html += '</div>';
  });

  var projTies = Math.max(0, cats.length - projWins - projLosses);
  html += '<div style="text-align:center;padding:12px;font-size:1.1rem;font-weight:800">Projected: ' + projWins + '-' + projLosses + '-' + projTies + '</div>';
  html += '</div>';

  // Volatility
  var vol = Engines.categoryVolatility(myPlayers);
  html += '<div class="card"><div class="card-header">Category Volatility</div><div class="filter-chips">';
  cats.forEach(function(cat) {
    var v = vol[cat.abbr];
    if (!v) return;
    var cls = v.label === 'High' ? 'stat-negative' : (v.label === 'Low' ? 'stat-positive' : '');
    html += '<span class="chip ' + cls + '" style="border-color:' + cat.color + '">' + cat.abbr + ': ' + v.label + '</span>';
  });
  html += '</div></div>';
  return html;
}

function renderMatchupRecap(cats) {
  var mr = S.matchup.myRecord || {wins:0,losses:0,ties:0};
  var total = mr.wins + mr.losses + mr.ties;
  if (!total) return '<div class="empty-state"><p>No matchup data available yet.</p></div>';

  var result = mr.wins > mr.losses ? 'win' : (mr.losses > mr.wins ? 'loss' : 'tie');
  var html = '<div class="card" style="text-align:center;padding:24px">';
  html += '<div style="font-size:2.5rem">' + (result === 'win' ? '\u{1F3C6}' : (result === 'loss' ? '\u{1F4A5}' : '\u{1F91D}')) + '</div>';
  html += '<div style="font-size:1.5rem;font-weight:800;margin:8px 0">' + mr.wins + '-' + mr.losses + '-' + mr.ties + '</div>';
  html += '<div class="muted">vs ' + esc(S.matchup.opponentName || 'Opponent') + '</div>';
  html += '</div>';

  html += '<div class="card"><div class="card-header">Category Breakdown</div>';
  cats.forEach(function(cat) {
    var my = S.matchup.myScores ? S.matchup.myScores[cat.abbr] || 0 : 0;
    var opp = S.matchup.oppScores ? S.matchup.oppScores[cat.abbr] || 0 : 0;
    var diff = cat.isNegative ? (opp - my) : (my - opp);
    var won = diff > 0;
    var icon = won ? '\u2705' : (diff === 0 ? '\u{1F91D}' : '\u274C');
    html += '<div class="mini-row"><span>' + icon + '</span><span style="color:' + cat.color + ';min-width:36px;font-weight:700">' + cat.abbr + '</span>';
    html += '<span style="flex:1">' + (cat.isPercent ? pct(my) : fmt(my,1)) + ' vs ' + (cat.isPercent ? pct(opp) : fmt(opp,1)) + '</span></div>';
  });
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
  html += '<select class="filter-select" onchange="_playersStatView=this.value;renderPlayersList()">';
  ['season','last30','last15','last7'].forEach(function(v) {
    var labels = {season:'Season',last30:'Last 30',last15:'Last 15',last7:'Last 7'};
    html += '<option value="' + v + '"' + (_playersStatView === v ? ' selected' : '') + '>' + labels[v] + '</option>';
  });
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
    return true;
  });

  // Sort by DURANT by default
  filtered.sort(function(a,b) {
    if (_playersSortCol === 'durantScore') return (b.durantScore || 0) - (a.durantScore || 0);
    if (_playersSortCol === 'name') return (a.name || '').localeCompare(b.name || '');
    // Sort by stat
    var aVal = a.stats && a.stats[_playersStatView] ? a.stats[_playersStatView][_playersSortCol] || 0 : 0;
    var bVal = b.stats && b.stats[_playersStatView] ? b.stats[_playersStatView][_playersSortCol] || 0 : 0;
    return (bVal - aVal) * _playersSortDir;
  });

  // Render table
  var html = '<div class="text-xs muted" style="margin-bottom:6px">' + filtered.length + ' players</div>';
  html += '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr>';
  html += '<th style="text-align:left;min-width:28px">#</th>';
  html += '<th style="text-align:left;min-width:120px" onclick="sortPlayers(\'name\')">Player</th>';
  html += '<th onclick="sortPlayers(\'durantScore\')">DURANT</th>';
  cats.forEach(function(cat) {
    html += '<th class="stat-col" style="color:' + cat.color + '" onclick="sortPlayers(\'' + cat.abbr + '\')">' + cat.abbr + '</th>';
  });
  html += '</tr></thead><tbody>';

  filtered.slice(0, 100).forEach(function(p, idx) {
    var isMyTeam = p.onTeamId === S.myTeam.teamId;
    html += '<tr class="' + (isMyTeam ? 'my-team-row' : '') + '">';
    html += '<td class="text-xs muted">' + (p.durantRank || idx + 1) + '</td>';
    html += '<td style="cursor:pointer" onclick="openPlayerPopup(' + p.id + ')">' + renderPlayerCell(p) + '</td>';
    html += '<td><strong>' + fmt(p.durantScore || 0, 1) + '</strong></td>';

    var period = _playersStatView;
    cats.forEach(function(cat) {
      var val = p.stats && p.stats[period] ? p.stats[period][cat.abbr] : null;
      var cls = '';
      if (p.zScores && p.zScores[cat.abbr]) {
        cls = p.zScores[cat.abbr] > 0.5 ? 'stat-positive' : (p.zScores[cat.abbr] < -0.5 ? 'stat-negative' : '');
      }
      html += '<td class="stat-col ' + cls + '">' + (val !== null ? (cat.isPercent ? pct(val) : fmt(val, 1)) : '-') + '</td>';
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


// ========== LEAGUE TAB ==========

function renderLeague(container) {
  // If on a sub-page, render that
  if (S.leagueSubPage) {
    renderLeagueSubPage(container);
    return;
  }

  var html = '<div class="tab-header"><h2>League</h2></div>';
  html += '<div class="league-menu">';
  LEAGUE_MENU.forEach(function(item) {
    html += '<button class="menu-item" onclick="S.leagueSubPage=\'' + item.id + '\';render()">';
    html += '<span class="menu-icon">' + item.icon + '</span>';
    html += '<span class="menu-label">' + item.label + '</span>';
    html += '<span class="menu-arrow">\u276F</span>';
    html += '</button>';
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
      case 'settings': html += renderSettingsPage(); break;
      default: html += '<div class="empty-state"><p>Coming soon.</p></div>';
    }
  } catch(e) {
    html += '<div class="error-card"><h3>Error</h3><p>' + esc(e.message) + '</p>';
    html += '<pre>' + esc(e.stack || '') + '</pre>';
    html += '<button class="btn btn-primary" onclick="S.leagueSubPage=null;render()">Go Back</button></div>';
  }

  container.innerHTML = html;
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
  // Trade Finder with 50%+ acceptance filter (v3)
  html += '<div class="card"><div class="card-header">Trade Finder</div>';
  var trades = Engines.findTrades({ minAcceptance: 50 });
  if (!trades.length) {
    html += '<div class="empty-state"><p>No strong trade matches found with 50%+ acceptance likelihood.</p></div>';
  } else {
    trades.slice(0, 10).forEach(function(t) {
      html += '<div class="decision-item" style="cursor:pointer" onclick="openPlayerPopup(' + t.get.id + ')">';
      html += '<div class="decision-content">';
      html += '<div class="decision-player">';
      html += '<span class="stat-negative">Give: ' + esc(t.give.name) + '</span> \u{2194}\u{FE0F} ';
      html += '<span class="stat-positive">Get: ' + esc(t.get.name) + '</span>';
      html += '</div>';
      html += '<div class="decision-replacement">';
      html += esc(t.team.name) + ' | Acceptance: ' + t.acceptanceLikelihood + '% | ';
      html += 'Helps us: ' + (t.helpsUs.length ? t.helpsUs.join(', ') : 'even') + ' | ';
      html += 'Helps them: ' + (t.helpsThem.length ? t.helpsThem.join(', ') : 'even');
      html += '</div></div></div>';
    });
  }
  html += '</div>';

  // Trade Analyzer
  html += '<div class="card"><div class="card-header">Trade Analyzer</div>';
  html += '<p class="muted text-sm">Select players in popups to analyze trades. Coming in next update.</p>';
  html += '</div>';
  return html;
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

  myPlayers.sort(function(a,b) { return (b.durantScore || 0) - (a.durantScore || 0); });
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

function renderSchedulePage() {
  var html = '<div class="card"><div class="card-header">Team Schedule Grid</div>';
  html += '<p class="muted text-sm">Game counts by day for this matchup period.</p>';

  // Build schedule grid
  var myPlayers = (S.myTeam.players || []).filter(function(p) { return p.slotId < 12; });
  if (!myPlayers.length) { html += '<p class="muted">No roster data.</p></div>'; return html; }

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
  myPlayers.forEach(function(p) {
    html += '<tr><td style="text-align:left">' + esc(p.name) + '</td>';
    var total = 0;
    days.forEach(function(day, di) {
      var hasGame = p.gamesToday && di === 0; // Simplified: we only know today
      html += '<td class="sched-cell ' + (hasGame ? 'has-game' : '') + '">' + (hasGame ? p.nbaTeam : '-') + '</td>';
      if (hasGame) { total++; dailyTotals[di]++; }
    });
    html += '<td><strong>' + total + '</strong></td></tr>';
  });

  html += '<tr class="totals-row"><td><strong>Total</strong></td>';
  dailyTotals.forEach(function(t) { html += '<td><strong>' + t + '</strong></td>'; });
  html += '<td><strong>' + dailyTotals.reduce(function(a,b){return a+b;},0) + '</strong></td></tr>';
  html += '</tbody></table></div></div>';
  return html;
}

function renderDraftCenter() {
  var cats = getOrderedCategories();
  var players = (S.allPlayers || []).slice();
  if (!players.length) return '<div class="empty-state"><p>No player data.</p></div>';

  Engines.computeDURANT(players);
  players.sort(function(a,b) { return (b.durantScore || 0) - (a.durantScore || 0); });

  var html = '<div class="card">';
  // v3 FIX: Scrollable container
  html += '<div class="table-scroll" style="max-height:60vh;overflow-y:auto">';
  html += '<table class="data-table compact">';
  html += '<thead><tr><th>#</th><th style="text-align:left">Player</th><th>DURANT</th><th>Z-Total</th>';
  cats.slice(0,5).forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
  html += '</tr></thead><tbody>';

  players.slice(0, 150).forEach(function(p, i) {
    html += '<tr class="' + (p.onTeamId === S.myTeam.teamId ? 'my-team-row' : '') + '">';
    html += '<td>' + (i+1) + '</td>';
    html += '<td style="text-align:left;cursor:pointer" onclick="openPlayerPopup(' + p.id + ')">' + esc(p.name) + '</td>';
    html += '<td><strong>' + fmt(p.durantScore || 0, 1) + '</strong></td>';
    html += '<td>' + fmt(p.zScores ? p.zScores.total : 0, 2) + '</td>';
    cats.slice(0,5).forEach(function(cat) {
      var val = p.stats && p.stats.season ? p.stats.season[cat.abbr] : null;
      html += '<td>' + (val !== null ? fmt(val, 1) : '-') + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table></div></div>';
  return html;
}

function renderSettingsPage() {
  // v3 FIX: Scrollable container
  var html = '<div style="max-height:70vh;overflow-y:auto;-webkit-overflow-scrolling:touch">';

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
  var onWatch = S.prefs.watchlist && S.prefs.watchlist.indexOf(p.id) >= 0;

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
  html += '<div class="popup-meta">' + p.positions.join('/') + ' | ' + p.nbaTeam + ' | Own: ' + fmt(p.ownership, 0) + '%</div>';
  if (p.status !== 'ACTIVE' && p.status !== 'HEALTHY') {
    html += '<div class="popup-injury">' + p.status + '</div>';
  }
  html += '</div></div>';

  // Quick stats
  html += '<div class="popup-quick-stats">';
  cats.slice(0, 6).forEach(function(cat) {
    var val = p.stats && p.stats.season ? p.stats.season[cat.abbr] : null;
    html += '<div class="quick-stat"><span class="qs-label" style="color:' + cat.color + '">' + cat.abbr + '</span>';
    html += '<span class="qs-val">' + (val !== null ? (cat.isPercent ? pct(val) : fmt(val, 1)) : '-') + '</span></div>';
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
  else if (_popupTab === 'news') html += '<p class="muted">News data requires ESPN player news API integration.</p>';
  else if (_popupTab === 'schedule') html += '<p class="muted">Player schedule: ' + (p.gamesRemaining || '?') + ' games remaining this period.</p>';
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
    html += '<tr><td><strong>' + labels[period] + '</strong></td>';
    cats.forEach(function(cat) {
      var val = p.stats[period] ? p.stats[period][cat.abbr] : null;
      html += '<td>' + (val !== null ? (cat.isPercent ? pct(val) : fmt(val, 1)) : '-') + '</td>';
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
  periods.forEach(function(period) {
    if (!p.stats[period]) return;
    html += '<tr><td>' + labels[period] + '</td>';
    cats.forEach(function(cat) {
      var val = p.stats[period][cat.abbr];
      var seasonVal = p.stats.season ? p.stats.season[cat.abbr] : null;
      var cls = '';
      if (period !== 'season' && val !== null && seasonVal !== null) {
        var diff = val - seasonVal;
        if (!cat.isNegative) cls = diff > 0.1 ? 'stat-positive' : (diff < -0.1 ? 'stat-negative' : '');
        else cls = diff < -0.1 ? 'stat-positive' : (diff > 0.1 ? 'stat-negative' : '');
      }
      html += '<td class="' + cls + '">' + (val !== null ? (cat.isPercent ? pct(val) : fmt(val, 1)) : '-') + '</td>';
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

function toggleWatchlist(playerId) {
  if (!S.prefs.watchlist) S.prefs.watchlist = [];
  var idx = S.prefs.watchlist.indexOf(playerId);
  if (idx >= 0) S.prefs.watchlist.splice(idx, 1);
  else S.prefs.watchlist.push(playerId);
  autosave();
}


// Export/Import/StatsKey handled in core.js
