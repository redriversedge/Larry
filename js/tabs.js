// ============================================================
// LARRY v2 -- TAB RENDERERS
// All 5 main tabs + League sub-pages
// ============================================================

// --- SHARED: Stat view selector ---
var currentStatView = 'season'; // 'season' | 'last30' | 'last7' | 'zScores'

function statViewSelector(onChange) {
  var views = [
    { id: 'season', label: 'Season' },
    { id: 'last30', label: 'L30' },
    { id: 'last7', label: 'L7' },
    { id: 'zScores', label: 'Z-Score' }
  ];
  var html = '<div class="stat-view-toggle">';
  views.forEach(function(v) {
    html += '<button class="toggle-btn' + (currentStatView === v.id ? ' active' : '') + '" onclick="currentStatView=\'' + v.id + '\';;render()">' + v.label + '</button>';
  });
  html += '</div>';
  return html;
}

function getPlayerStatVal(player, catAbbr) {
  if (currentStatView === 'zScores') {
    return player.zScores ? player.zScores[catAbbr] : null;
  }
  var period = currentStatView;
  return player.stats && player.stats[period] ? player.stats[period][catAbbr] : null;
}

function fmtStat(val, cat) {
  if (val === null || val === undefined || isNaN(val)) return '-';
  if (currentStatView === 'zScores') return (val >= 0 ? '+' : '') + parseFloat(val).toFixed(2);
  if (cat && cat.isPercent) return pct(val);
  return fmt(val, 1);
}

// ========== TAB 1: ROSTER ==========
var rosterSubTab = 'lineup'; // 'lineup' | 'decisions'

function renderRoster(container) {
  // Ensure z-scores are computed
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');

  var html = '<div class="tab-header">';
  html += '<h2>' + esc(S.myTeam.name) + '</h2>';
  html += '<div class="sub-tab-bar">';
  html += '<button class="sub-tab' + (rosterSubTab === 'lineup' ? ' active' : '') + '" onclick="rosterSubTab=\'lineup\';render()">Lineup</button>';
  html += '<button class="sub-tab' + (rosterSubTab === 'decisions' ? ' active' : '') + '" onclick="rosterSubTab=\'decisions\';render()">Decisions</button>';
  html += '</div>';
  html += '</div>';

  if (rosterSubTab === 'lineup') {
    html += renderRosterLineup();
  } else {
    html += renderRosterDecisions();
  }
  container.innerHTML = html;
}

function renderRosterLineup() {
  var players = S.myTeam.players || [];
  if (!players.length) return '<div class="empty-state"><p>No roster data. Try syncing.</p><button class="btn btn-primary" onclick="ESPNSync.syncAll()">Sync Now</button></div>';

  var cats = S.league.categories;
  var html = statViewSelector();

  // Group by slot type: starters, bench, IR
  var starters = players.filter(function(p) { return p.slotId !== 12 && p.slotId !== 13; });
  var bench = players.filter(function(p) { return p.slotId === 12; });
  var ir = players.filter(function(p) { return p.slotId === 13; });

  // Starters table
  html += '<div class="roster-section">';
  html += '<h3 class="section-title">Starters</h3>';
  html += buildRosterTable(starters, cats, 'roster-start');
  html += '</div>';

  // Bench
  if (bench.length) {
    html += '<div class="roster-section">';
    html += '<h3 class="section-title">Bench</h3>';
    html += buildRosterTable(bench, cats, 'roster-bench');
    html += '</div>';
  }

  // IR
  if (ir.length) {
    html += '<div class="roster-section">';
    html += '<h3 class="section-title">IR</h3>';
    html += buildRosterTable(ir, cats, 'roster-ir');
    html += '</div>';
  }

  return html;
}

function buildRosterTable(players, cats, tableKey) {
  var html = '<div class="table-scroll"><table class="data-table">';
  html += '<thead><tr>';
  html += '<th class="sticky-col" onclick="sortTable(\'' + tableKey + '\',\'slot\',null);render()">Slot' + sortIcon(tableKey, 'slot') + '</th>';
  html += '<th onclick="sortTable(\'' + tableKey + '\',\'name\',null);render()">Player' + sortIcon(tableKey, 'name') + '</th>';
  html += '<th>Today</th>';
  cats.forEach(function(cat) {
    html += '<th class="stat-col" style="color:' + cat.color + '" onclick="sortTable(\'' + tableKey + '\',\'' + cat.abbr + '\',null);render()">' + cat.abbr + sortIcon(tableKey, cat.abbr) + '</th>';
  });
  html += '</tr></thead><tbody>';

  players.forEach(function(p) {
    var hasGame = p.gamesToday;
    var rowClass = hasGame ? 'has-game' : 'no-game';
    html += '<tr class="' + rowClass + '" onclick="viewPlayer(' + p.id + ')">';
    html += '<td class="sticky-col"><span class="slot-badge">' + esc(p.slot) + '</span></td>';
    html += '<td class="player-cell">';
    html += statusBadge(p.status) + ' ';
    html += '<span class="player-name">' + esc(p.name) + '</span>';
    html += '<span class="player-meta">' + p.positions.join('/') + ' - ' + p.nbaTeam + '</span>';
    html += '</td>';
    html += '<td class="game-cell">';
    if (p.gameToday) {
      html += '<span class="game-info">' + (p.gameToday.home ? 'vs' : '@') + ' ' + esc(p.gameToday.opponent || '') + '</span>';
    } else {
      html += '<span class="no-game-label">-</span>';
    }
    html += '</td>';
    cats.forEach(function(cat) {
      var val = getPlayerStatVal(p, cat.abbr);
      var cls = '';
      if (currentStatView === 'zScores' && val !== null) {
        cls = val > 0.5 ? 'stat-positive' : (val < -0.5 ? 'stat-negative' : '');
      }
      html += '<td class="stat-col ' + cls + '">' + fmtStat(val, cat) + '</td>';
    });
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

// --- ROSTER DECISIONS SUB-TAB ---
function renderRosterDecisions() {
  var html = '';

  // Acquisition tracker
  html += '<div class="card">';
  html += '<div class="card-header">Acquisitions</div>';
  var limit = S.league.acquisitionLimit;
  var used = S.myTeam.acquisitionsUsed || 0;
  html += '<div class="acq-tracker">';
  if (limit > 0) {
    html += '<span class="acq-count">' + used + '/' + limit + ' used this matchup</span>';
    html += '<div class="progress-bar"><div class="progress-fill" style="width:' + (used / limit * 100) + '%"></div></div>';
  } else {
    html += '<span class="acq-count">Unlimited acquisitions (' + used + ' used)</span>';
  }
  html += '</div></div>';

  // Start/Sit section
  html += '<div class="card">';
  html += '<div class="card-header" onclick="toggleSection(\'startSit\')">Start/Sit Optimizer ' + (isSectionCollapsed('startSit') ? '\u25B6' : '\u25BC') + '</div>';
  if (!isSectionCollapsed('startSit')) {
    html += renderStartSit();
  }
  html += '</div>';

  // Drop candidates
  html += '<div class="card">';
  html += '<div class="card-header" onclick="toggleSection(\'drops\')">Drop Candidates ' + (isSectionCollapsed('drops') ? '\u25B6' : '\u25BC') + '</div>';
  if (!isSectionCollapsed('drops')) {
    html += renderDropCandidates();
  }
  html += '</div>';

  // Add targets
  html += '<div class="card">';
  html += '<div class="card-header" onclick="toggleSection(\'adds\')">Add Targets ' + (isSectionCollapsed('adds') ? '\u25B6' : '\u25BC') + '</div>';
  if (!isSectionCollapsed('adds')) {
    html += renderAddTargets();
  }
  html += '</div>';

  return html;
}

function renderStartSit() {
  var lineup = Engines.optimizeLineup(S.myTeam.players);
  var html = '';
  if (lineup.warnings.length) {
    html += '<div class="alerts">';
    lineup.warnings.forEach(function(w) {
      html += '<div class="alert alert-' + (w.type === 'swap' ? 'warning' : 'info') + '">' + esc(w.message) + '</div>';
    });
    html += '</div>';
  }
  // Optimal lineup
  html += '<h4>Optimal Lineup Today</h4>';
  html += '<div class="mini-table">';
  lineup.starters.forEach(function(slot) {
    html += '<div class="mini-row">';
    html += '<span class="slot-badge">' + slot.name + '</span> ';
    if (slot.player) {
      html += statusBadge(slot.player.status) + ' ';
      html += '<span class="player-name">' + esc(slot.player.name) + '</span>';
      html += ' <span class="muted">(' + slot.player.nbaTeam + ')</span>';
      if (slot.player.gamesToday) {
        html += ' <span class="game-badge">\u{1F3C0}</span>';
      }
    } else {
      html += '<span class="muted">Empty</span>';
    }
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function renderDropCandidates() {
  var drops = Engines.getDropCandidates();
  if (!drops.length) return '<p class="muted">No drop candidates identified.</p>';
  var html = '<div class="decision-list">';
  drops.forEach(function(d, i) {
    html += '<div class="decision-item">';
    html += '<div class="decision-rank">#' + (i + 1) + '</div>';
    html += '<div class="decision-content">';
    html += '<div class="decision-player">' + statusBadge(d.player.status) + ' ' + esc(d.player.name) + ' <span class="z-badge z-' + (d.zScore > 0 ? 'pos' : 'neg') + '">' + fmt(d.zScore, 2) + '</span></div>';
    if (d.replacement) {
      html += '<div class="decision-replacement">\u27A1 Pick up: <strong>' + esc(d.replacement.name) + '</strong> (' + d.replacement.nbaTeam + ') z: ' + fmt(d.replacement.zScores ? d.replacement.zScores.total : 0, 2) + '</div>';
    }
    html += '<div class="decision-reasoning">' + esc(d.reasoning) + '</div>';
    html += '</div></div>';
  });
  html += '</div>';
  return html;
}

function renderAddTargets() {
  // Find weak categories
  var weakCats = [];
  S.league.categories.forEach(function(cat) {
    var rank = getTeamCategoryRank(S.myTeam, cat.abbr);
    if (rank > Math.ceil(S.league.teamCount * 0.6)) weakCats.push(cat.abbr);
  });

  var targets = Engines.getAddTargets(weakCats);
  if (!targets.length) return '<p class="muted">No available targets found.</p>';

  if (weakCats.length) {
    var html = '<p class="muted">Targeting your weak categories: ' + weakCats.join(', ') + '</p>';
  } else {
    var html = '';
  }
  html += '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr><th>Player</th><th>Team</th><th>Own%</th>';
  S.league.categories.forEach(function(cat) {
    html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>';
  });
  html += '<th>Z</th></tr></thead><tbody>';
  targets.forEach(function(p) {
    html += '<tr onclick="viewPlayer(' + p.id + ')">';
    html += '<td>' + esc(p.name) + ' <span class="muted">' + p.positions.join('/') + '</span></td>';
    html += '<td>' + p.nbaTeam + '</td>';
    html += '<td>' + fmt(p.ownership, 0) + '%</td>';
    S.league.categories.forEach(function(cat) {
      var val = p.stats.season ? p.stats.season[cat.abbr] : null;
      html += '<td>' + fmtStat(val, cat) + '</td>';
    });
    html += '<td class="z-badge z-' + ((p.zScores && p.zScores.total > 0) ? 'pos' : 'neg') + '">' + fmt(p.zScores ? p.zScores.total : 0, 2) + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function getTeamCategoryRank(team, catAbbr) {
  var vals = S.teams.map(function(t) {
    return { teamId: t.teamId, val: Engines.teamCategoryStrength(t, catAbbr) };
  });
  var cat = S.league.categories.find(function(c) { return c.abbr === catAbbr; });
  vals.sort(function(a, b) {
    return cat && cat.isNegative ? (a.val - b.val) : (b.val - a.val);
  });
  var rank = vals.findIndex(function(v) { return v.teamId === team.teamId; });
  return rank + 1;
}


// ========== TAB 2: MATCHUP ==========
var matchupSubTab = 'score'; // 'score' | 'schedule' | 'projections'

function renderMatchup(container) {
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');

  var html = '<div class="tab-header">';
  html += '<h2>Matchup ' + S.matchup.matchupPeriodId + '</h2>';
  html += '<div class="sub-tab-bar">';
  html += '<button class="sub-tab' + (matchupSubTab === 'score' ? ' active' : '') + '" onclick="matchupSubTab=\'score\';render()">Score</button>';
  html += '<button class="sub-tab' + (matchupSubTab === 'schedule' ? ' active' : '') + '" onclick="matchupSubTab=\'schedule\';render()">Schedule</button>';
  html += '<button class="sub-tab' + (matchupSubTab === 'projections' ? ' active' : '') + '" onclick="matchupSubTab=\'projections\';render()">Projections</button>';
  html += '</div></div>';

  if (matchupSubTab === 'score') html += renderMatchupScore();
  else if (matchupSubTab === 'schedule') html += renderMatchupSchedule();
  else html += renderMatchupProjections();

  container.innerHTML = html;
}

function renderMatchupScore() {
  var cats = S.league.categories;
  var html = '<div class="matchup-header">';
  html += '<div class="matchup-team my-team"><span class="team-name">' + esc(S.myTeam.name) + '</span><span class="team-record">' + S.myTeam.record.wins + '-' + S.myTeam.record.losses + '</span></div>';
  html += '<div class="matchup-vs"><span class="matchup-record">' + S.matchup.myRecord.wins + '-' + S.matchup.myRecord.losses + '-' + S.matchup.myRecord.ties + '</span></div>';
  html += '<div class="matchup-team opp-team"><span class="team-name">' + esc(S.matchup.opponentName) + '</span></div>';
  html += '</div>';

  html += '<div class="cat-scores">';
  cats.forEach(function(cat) {
    var my = S.matchup.myScores[cat.abbr] || 0;
    var opp = S.matchup.oppScores[cat.abbr] || 0;
    var winning = cat.isNegative ? (my < opp) : (my > opp);
    var tied = my === opp;
    var cls = tied ? 'tied' : (winning ? 'winning' : 'losing');

    html += '<div class="cat-score-row ' + cls + '">';
    html += '<span class="cat-val my-val">' + fmtCatVal(my, cat) + '</span>';
    html += '<span class="cat-label" style="color:' + cat.color + '">' + cat.abbr + '</span>';
    html += '<span class="cat-val opp-val">' + fmtCatVal(opp, cat) + '</span>';
    html += '</div>';
  });
  html += '</div>';

  // Schedule advantage
  html += '<div class="card">';
  html += '<div class="card-header">Schedule Advantage</div>';
  html += '<div class="sched-advantage">';
  html += '<span>My games remaining: <strong>' + (S.matchup.myGamesRemaining || '?') + '</strong></span>';
  html += '<span>Opponent: <strong>' + (S.matchup.oppGamesRemaining || '?') + '</strong></span>';
  var diff = (S.matchup.myGamesRemaining || 0) - (S.matchup.oppGamesRemaining || 0);
  if (diff > 0) html += '<span class="advantage positive">+' + diff + ' game advantage</span>';
  else if (diff < 0) html += '<span class="advantage negative">' + diff + ' game deficit</span>';
  else html += '<span class="advantage neutral">Even</span>';
  html += '</div></div>';

  return html;
}

function fmtCatVal(val, cat) {
  if (cat.isPercent) return pct(val);
  return fmt(val, cat.abbr === 'TO' ? 0 : 1);
}

function renderMatchupSchedule() {
  var players = S.myTeam.players.filter(function(p) { return p.slotId !== 13; });
  var heatmap = Engines.scheduleHeatMap(players, 7);

  var html = '<div class="schedule-grid">';
  heatmap.forEach(function(day) {
    html += '<div class="sched-day' + (day.isToday ? ' today' : '') + '">';
    html += '<div class="sched-day-header">' + day.dayName + '<br>' + day.date.substring(5) + '</div>';
    html += '<div class="sched-count">' + day.count + ' games</div>';
    day.players.forEach(function(p) {
      html += '<div class="sched-player">' + statusBadge(p.status) + ' ' + esc(p.name.split(' ').pop()) + '</div>';
    });
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function renderMatchupProjections() {
  var oppTeam = S.teams.find(function(t) { return t.teamId === S.matchup.opponentTeamId; });
  if (!oppTeam) return '<p class="muted">Opponent data not available.</p>';

  // Run Monte Carlo
  var winProbs = Engines.monteCarloMatchup(S.myTeam.players, oppTeam.players, null, 3000);
  var cats = S.league.categories;

  var html = '<div class="card"><div class="card-header">Win Probability by Category</div>';
  html += '<div class="mc-results">';
  var projWins = 0, projLosses = 0;
  cats.forEach(function(cat) {
    var prob = winProbs[cat.abbr];
    if (!prob) return;
    var winPct = parseFloat(prob.win);
    var cls = winPct > 60 ? 'likely-win' : (winPct < 40 ? 'likely-lose' : 'toss-up');
    if (winPct > 50) projWins++;
    else if (winPct < 50) projLosses++;

    html += '<div class="mc-row ' + cls + '">';
    html += '<span class="mc-cat" style="color:' + cat.color + '">' + cat.abbr + '</span>';
    html += '<div class="mc-bar-container">';
    html += '<div class="mc-bar win" style="width:' + prob.win + '%"></div>';
    html += '</div>';
    html += '<span class="mc-pct">' + prob.win + '%</span>';
    html += '</div>';
  });
  html += '</div>';
  html += '<div class="mc-summary">Projected: <strong>' + projWins + '-' + (cats.length - projWins - (cats.length - projWins - projLosses)) + '-' + Math.max(0, cats.length - projWins - projLosses) + '</strong></div>';
  html += '</div>';

  // Category volatility
  var vol = Engines.categoryVolatility(S.myTeam.players);
  html += '<div class="card"><div class="card-header">Category Volatility</div>';
  html += '<div class="vol-list">';
  cats.forEach(function(cat) {
    var v = vol[cat.abbr];
    if (!v) return;
    html += '<span class="vol-badge vol-' + v.label.toLowerCase() + '" style="border-color:' + cat.color + '">' + cat.abbr + ': ' + v.label + '</span>';
  });
  html += '</div></div>';

  return html;
}


// ========== TAB 3: PLAYERS ==========
var playerFilters = { pos: 'All', status: 'available', search: '' };
var selectedPlayerId = null;

function renderPlayers(container) {
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');

  if (S.selectedPlayerId) {
    container.innerHTML = renderPlayerDetail(S.selectedPlayerId);
    return;
  }

  var html = '<div class="tab-header"><h2>Players</h2></div>';

  // Filters
  html += '<div class="filter-bar">';
  html += '<input type="text" class="form-input filter-search" placeholder="Search players..." value="' + esc(playerFilters.search) + '" oninput="playerFilters.search=this.value;render()" />';
  html += '<div class="filter-chips">';
  ['All','PG','SG','SF','PF','C'].forEach(function(pos) {
    html += '<button class="chip' + (playerFilters.pos === pos ? ' active' : '') + '" onclick="playerFilters.pos=\'' + pos + '\';render()">' + pos + '</button>';
  });
  html += '</div>';
  html += '<div class="filter-chips">';
  html += '<button class="chip' + (playerFilters.status === 'available' ? ' active' : '') + '" onclick="playerFilters.status=\'available\';render()">Available</button>';
  html += '<button class="chip' + (playerFilters.status === 'all' ? ' active' : '') + '" onclick="playerFilters.status=\'all\';render()">All</button>';
  html += '<button class="chip' + (playerFilters.status === 'watchlist' ? ' active' : '') + '" onclick="playerFilters.status=\'watchlist\';render()">\u2B50 Watch</button>';
  html += '</div>';
  html += '</div>';

  html += statViewSelector();

  // Filter players
  var players = (playerFilters.status === 'available' ? S.freeAgents : S.allPlayers).slice();
  if (playerFilters.status === 'watchlist') {
    players = S.allPlayers.filter(function(p) { return S.watchlist.includes(p.id); });
  }
  if (playerFilters.pos !== 'All') {
    players = players.filter(function(p) { return p.positions.includes(playerFilters.pos); });
  }
  if (playerFilters.search) {
    var q = playerFilters.search.toLowerCase();
    players = players.filter(function(p) { return p.name.toLowerCase().includes(q) || p.nbaTeam.toLowerCase().includes(q); });
  }

  // Sort by z-score by default
  players.sort(function(a, b) { return (b.zScores ? b.zScores.total || 0 : 0) - (a.zScores ? a.zScores.total || 0 : 0); });

  var cats = S.league.categories;
  html += '<div class="table-scroll"><table class="data-table">';
  html += '<thead><tr>';
  html += '<th onclick="sortPlayerTable(\'name\')">Player' + sortIcon('players', 'name') + '</th>';
  html += '<th>Team</th>';
  html += '<th onclick="sortPlayerTable(\'ownership\')">Own%' + sortIcon('players', 'ownership') + '</th>';
  cats.forEach(function(cat) {
    html += '<th class="stat-col" style="color:' + cat.color + '" onclick="sortPlayerTable(\'' + cat.abbr + '\')">' + cat.abbr + sortIcon('players', cat.abbr) + '</th>';
  });
  html += '<th onclick="sortPlayerTable(\'zTotal\')">Z' + sortIcon('players', 'zTotal') + '</th>';
  html += '<th>Trend</th>';
  html += '</tr></thead><tbody>';

  players.slice(0, 75).forEach(function(p) {
    var onWatch = S.watchlist.includes(p.id);
    html += '<tr onclick="S.selectedPlayerId=' + p.id + ';render()">';
    html += '<td class="player-cell">';
    html += statusBadge(p.status) + ' ';
    html += '<span class="player-name">' + esc(p.name) + '</span>';
    html += '<span class="player-meta">' + p.positions.join('/') + (onWatch ? ' \u2B50' : '') + '</span>';
    html += '</td>';
    html += '<td>' + p.nbaTeam + '</td>';
    html += '<td>' + fmt(p.ownership, 0) + '%</td>';
    cats.forEach(function(cat) {
      var val = getPlayerStatVal(p, cat.abbr);
      var cls = '';
      if (currentStatView === 'zScores' && val !== null) cls = val > 0.5 ? 'stat-positive' : (val < -0.5 ? 'stat-negative' : '');
      html += '<td class="stat-col ' + cls + '">' + fmtStat(val, cat) + '</td>';
    });
    html += '<td class="z-badge z-' + ((p.zScores && p.zScores.total > 0) ? 'pos' : 'neg') + '">' + fmt(p.zScores ? p.zScores.total : 0, 2) + '</td>';
    html += '<td>' + trendArrow(p.stats.last7 ? avgCatVal(p, 'last7') : null, p.stats.season ? avgCatVal(p, 'season') : null) + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  if (players.length > 75) html += '<p class="muted" style="text-align:center">Showing 75 of ' + players.length + ' players</p>';

  container.innerHTML = html;
}

function avgCatVal(p, period) {
  var cats = S.league.categories;
  var sum = 0, count = 0;
  cats.forEach(function(cat) {
    var val = p.stats[period] ? p.stats[period][cat.abbr] : null;
    if (val !== null) { sum += val; count++; }
  });
  return count ? sum / count : 0;
}

function sortPlayerTable(col) {
  // Uses global sort, then re-render
  var st = sortState['players'] || { col: 'zTotal', dir: 'desc' };
  if (st.col === col) st.dir = st.dir === 'asc' ? 'desc' : 'asc';
  else { st.col = col; st.dir = 'desc'; }
  sortState['players'] = st;
  render();
}

function renderPlayerDetail(playerId) {
  var p = S.allPlayers.find(function(pl) { return pl.id === playerId; });
  if (!p) return '<div class="empty-state"><p>Player not found.</p><button class="btn btn-secondary" onclick="S.selectedPlayerId=null;render()">Back</button></div>';

  var cats = S.league.categories;
  var onWatch = S.watchlist.includes(p.id);
  var html = '<div class="player-detail">';
  html += '<button class="btn btn-back" onclick="S.selectedPlayerId=null;render()">\u2190 Back</button>';
  html += '<div class="player-detail-header">';
  html += '<div class="player-detail-info">';
  html += '<h2>' + statusBadge(p.status) + ' ' + esc(p.name) + '</h2>';
  html += '<p>' + p.positions.join('/') + ' | ' + p.nbaTeam + ' | Own: ' + fmt(p.ownership, 0) + '%</p>';
  if (p.injuryStatus && p.injuryStatus !== 'ACTIVE') {
    html += '<p class="injury-note">' + esc(p.injuryStatus) + (p.injuryNote ? ' - ' + esc(p.injuryNote) : '') + '</p>';
  }
  html += '<button class="btn btn-sm ' + (onWatch ? 'btn-warning' : 'btn-secondary') + '" onclick="toggleWatchlist(' + p.id + ')">' + (onWatch ? '\u2B50 On Watchlist' : 'Add to Watchlist') + '</button>';
  html += '</div></div>';

  // Stats comparison table
  html += '<div class="card"><div class="card-header">Stats Comparison</div>';
  html += '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr><th>Period</th>';
  cats.forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
  html += '</tr></thead><tbody>';
  ['season', 'last30', 'last7'].forEach(function(period) {
    html += '<tr><td><strong>' + ({ season: 'Season', last30: 'Last 30', last7: 'Last 7' }[period]) + '</strong></td>';
    cats.forEach(function(cat) {
      var val = p.stats[period] ? p.stats[period][cat.abbr] : null;
      html += '<td>' + (val !== null ? (cat.isPercent ? pct(val) : fmt(val, 1)) : '-') + '</td>';
    });
    html += '</tr>';
  });
  // Z-scores row
  html += '<tr class="z-row"><td><strong>Z-Score</strong></td>';
  cats.forEach(function(cat) {
    var z = p.zScores ? p.zScores[cat.abbr] : null;
    html += '<td class="' + (z > 0.5 ? 'stat-positive' : (z < -0.5 ? 'stat-negative' : '')) + '">' + (z !== null ? fmt(z, 2) : '-') + '</td>';
  });
  html += '</tr>';
  html += '</tbody></table></div></div>';

  // Total z-score
  html += '<div class="card"><div class="card-header">Fantasy Value</div>';
  html += '<div class="value-display">';
  html += '<span class="big-number z-' + ((p.zScores && p.zScores.total > 0) ? 'pos' : 'neg') + '">' + fmt(p.zScores ? p.zScores.total : 0, 2) + '</span>';
  html += '<span class="value-label">Composite Z-Score</span>';
  html += '</div></div>';

  // Upcoming schedule
  if (p.schedule && p.schedule.length) {
    html += '<div class="card"><div class="card-header">Upcoming Schedule</div>';
    html += '<div class="mini-table">';
    p.schedule.slice(0, 7).forEach(function(g) {
      html += '<div class="mini-row"><span>' + g.date + '</span><span>' + (g.home ? 'vs' : '@') + ' ' + esc(g.opponent || '?') + '</span></div>';
    });
    html += '</div></div>';
  }

  html += '</div>';
  return html;
}

function toggleWatchlist(playerId) {
  var idx = S.watchlist.indexOf(playerId);
  if (idx >= 0) S.watchlist.splice(idx, 1);
  else S.watchlist.push(playerId);
  autosave();
  render();
}


// ========== TAB 4: LARRY CHAT ==========
function renderLarry(container) {
  var html = '<div class="chat-container">';
  html += '<div class="chat-header">';
  html += '<div class="larry-chat-avatar">' + getLarryAvatar(32) + '</div>';
  html += '<span class="chat-title">Larry</span>';
  html += '<button class="btn btn-sm btn-secondary" onclick="if(confirm(\'Clear chat history?\')){LarryChat.clearChat();}">Clear</button>';
  html += '</div>';
  html += '<div class="chat-messages" id="chat-messages"></div>';
  html += '<div class="typing-indicator" id="typing-indicator" style="display:none">';
  html += '<div class="larry-chat-avatar small">' + getLarryAvatar(20) + '</div>';
  html += '<div class="typing-dots"><span></span><span></span><span></span></div>';
  html += '</div>';
  html += '<div class="chat-input-area">';
  html += '<textarea class="chat-input" id="chat-input" rows="1" placeholder="Ask Larry anything..." onkeydown="handleChatKey(event)" oninput="autoResizeChat(this)"></textarea>';
  html += '<button class="chat-send-btn" onclick="sendChatMessage()" id="chat-send">\u27A4</button>';
  html += '</div>';
  html += '</div>';
  container.innerHTML = html;

  // Render existing messages
  setTimeout(function() { LarryChat.renderChatMessages(); }, 10);

  // Mobile keyboard handling
  setupChatKeyboard();
}

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
}

function sendChatMessage() {
  var input = document.getElementById('chat-input');
  if (!input) return;
  var msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  autoResizeChat(input);
  LarryChat.sendMessage(msg);
}

function autoResizeChat(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function setupChatKeyboard() {
  // Prevent viewport jumping on mobile keyboard open
  var chatInput = document.getElementById('chat-input');
  if (!chatInput) return;

  if (window.visualViewport) {
    var chatContainer = document.querySelector('.chat-container');
    window.visualViewport.addEventListener('resize', function() {
      if (chatContainer) {
        var viewportHeight = window.visualViewport.height;
        chatContainer.style.height = viewportHeight + 'px';
      }
    });
    window.visualViewport.addEventListener('scroll', function() {
      if (chatContainer) {
        chatContainer.style.transform = 'translateY(' + window.visualViewport.offsetTop + 'px)';
      }
    });
  }

  chatInput.addEventListener('focus', function() {
    setTimeout(function() {
      var msgs = document.getElementById('chat-messages');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    }, 300);
  });
}


// ========== TAB 5: LEAGUE ==========
function renderLeague(container) {
  if (S.leagueSubPage) {
    renderLeagueSubPage(container);
    return;
  }

  var html = '<div class="tab-header"><h2>League</h2></div>';

  // Menu
  html += '<div class="league-menu">';
  LEAGUE_MENU.forEach(function(item) {
    var badge = '';
    if (item.id === 'notifications') {
      var unread = S.notifications.filter(function(n) { return !n.read; }).length;
      if (unread) badge = '<span class="menu-badge">' + unread + '</span>';
    }
    html += '<button class="menu-item" onclick="openLeagueSub(\'' + item.id + '\')">';
    html += '<span class="menu-icon">' + item.icon + '</span>';
    html += '<span class="menu-label">' + item.label + '</span>';
    html += badge;
    html += '<span class="menu-arrow">\u203A</span>';
    html += '</button>';
  });
  html += '</div>';

  // Standings
  html += '<div class="card standings-card">';
  html += '<div class="card-header">Standings</div>';
  html += renderStandings();
  html += '</div>';

  container.innerHTML = html;
}

function renderStandings() {
  var teams = S.teams.slice().sort(function(a, b) {
    var aPct = a.record.wins / Math.max(a.record.wins + a.record.losses + a.record.ties, 1);
    var bPct = b.record.wins / Math.max(b.record.wins + b.record.losses + b.record.ties, 1);
    return bPct - aPct;
  });

  var html = '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>T</th><th>%</th></tr></thead><tbody>';
  teams.forEach(function(t, i) {
    var isMe = t.teamId === S.myTeam.teamId;
    var inPlayoffs = i < S.league.playoffTeams;
    html += '<tr class="' + (isMe ? 'my-team-row' : '') + (inPlayoffs ? ' in-playoffs' : '') + '">';
    html += '<td>' + (i + 1) + '</td>';
    html += '<td onclick="openLeagueSub(\'teamAnalyzer\');window._scoutTeamId=' + t.teamId + '">' + esc(t.name) + (isMe ? ' \u2B50' : '') + '</td>';
    html += '<td>' + t.record.wins + '</td>';
    html += '<td>' + t.record.losses + '</td>';
    html += '<td>' + t.record.ties + '</td>';
    html += '<td>' + fmt(t.record.wins / Math.max(t.record.wins + t.record.losses + t.record.ties, 1) * 100, 1) + '</td>';
    html += '</tr>';
    if (i === S.league.playoffTeams - 1 && i < teams.length - 1) {
      html += '<tr class="playoff-line"><td colspan="6"><hr class="playoff-divider"></td></tr>';
    }
  });
  html += '</tbody></table></div>';
  return html;
}


// ========== LEAGUE SUB-PAGES ==========
function renderLeagueSubPage(container) {
  var html = '<div class="sub-page-header">';
  html += '<button class="btn btn-back" onclick="backToLeagueMenu()">\u2190 League</button>';
  var menuItem = LEAGUE_MENU.find(function(m) { return m.id === S.leagueSubPage; });
  html += '<h2>' + (menuItem ? menuItem.icon + ' ' + menuItem.label : '') + '</h2>';
  html += '</div>';

  try {
    switch (S.leagueSubPage) {
      case 'dashboard': html += renderDashboard(); break;
      case 'trades': html += renderTradeCenter(); break;
      case 'teamAnalyzer': html += renderTeamAnalyzer(); break;
      case 'statsTrends': html += renderStatsTrends(); break;
      case 'news': html += renderNewsInjuries(); break;
      case 'schedule': html += renderSchedulePage(); break;
      case 'playoffs': html += renderPlayoffProjector(); break;
      case 'timeline': html += renderTimeline(); break;
      case 'notifications': html += renderNotifications(); break;
      case 'settings': html += renderSettings(); break;
      default: html += '<p class="muted">Coming soon.</p>';
    }
  } catch (e) {
    html += '<div class="error-card"><h3>Error loading ' + (S.leagueSubPage || 'page') + '</h3><p>' + esc(e.message) + '</p><button class="btn btn-primary" onclick="backToLeagueMenu()">Back</button></div>';
  }

  container.innerHTML = html;
}

// --- DASHBOARD ---
function renderDashboard() {
  var cats = S.league.categories;
  var html = '';

  // Quick matchup status
  html += '<div class="card"><div class="card-header">Current Matchup vs ' + esc(S.matchup.opponentName) + '</div>';
  html += '<div class="quick-matchup">';
  html += '<span class="matchup-record-big">' + S.matchup.myRecord.wins + '-' + S.matchup.myRecord.losses + '-' + S.matchup.myRecord.ties + '</span>';
  html += '</div>';
  var winning = [], losing = [], close = [];
  cats.forEach(function(cat) {
    var my = S.matchup.myScores[cat.abbr] || 0;
    var opp = S.matchup.oppScores[cat.abbr] || 0;
    var w = cat.isNegative ? (my < opp) : (my > opp);
    if (my === opp) close.push(cat.abbr);
    else if (w) winning.push(cat.abbr);
    else losing.push(cat.abbr);
  });
  if (winning.length) html += '<p class="dash-winning">\u2705 Winning: ' + winning.join(', ') + '</p>';
  if (losing.length) html += '<p class="dash-losing">\u274C Losing: ' + losing.join(', ') + '</p>';
  if (close.length) html += '<p class="dash-close">\u2796 Tied: ' + close.join(', ') + '</p>';
  html += '</div>';

  // Today's action
  var playing = S.myTeam.players.filter(function(p) { return p.gamesToday; });
  html += '<div class="card"><div class="card-header">Today\'s Games (' + playing.length + ' players)</div>';
  if (playing.length) {
    html += '<div class="mini-table">';
    playing.forEach(function(p) {
      html += '<div class="mini-row">' + statusBadge(p.status) + ' ' + esc(p.name) + ' <span class="muted">' + (p.gameToday ? ((p.gameToday.home ? 'vs' : '@') + ' ' + (p.gameToday.opponent || '')) : '') + '</span></div>';
    });
    html += '</div>';
  } else {
    html += '<p class="muted">No players have games today.</p>';
  }
  html += '</div>';

  // Alerts
  var alerts = [];
  S.myTeam.players.forEach(function(p) {
    var streak = Engines.detectStreaks(p);
    if (streak.trend === 'hot') alerts.push({ type: 'hot', msg: '\u{1F525} ' + p.name + ' is on fire: ' + streak.label });
    if (streak.trend === 'cold') alerts.push({ type: 'cold', msg: '\u{1F9CA} ' + p.name + ' ice cold: ' + streak.label });
    if (p.status === 'OUT' || p.status === 'GTD') alerts.push({ type: 'injury', msg: '\u{1FA79} ' + p.name + ': ' + p.status });
  });
  if (alerts.length) {
    html += '<div class="card"><div class="card-header">Alerts</div>';
    alerts.forEach(function(a) {
      html += '<div class="alert alert-' + a.type + '">' + esc(a.msg) + '</div>';
    });
    html += '</div>';
  }

  return html;
}

// --- TRADE CENTER ---
var tradeSubTab = 'analyzer'; // 'analyzer' | 'finder' | 'targets' | 'windows'
var tradeState = { giveTeam: 0, getTeam: 0, givePlayers: [], getPlayers: [] };

function renderTradeCenter() {
  var html = '<div class="sub-tab-bar">';
  ['analyzer','finder','targets','windows'].forEach(function(t) {
    var label = { analyzer: 'Analyzer', finder: 'Finder', targets: 'Targets', windows: 'Windows' }[t];
    html += '<button class="sub-tab' + (tradeSubTab === t ? ' active' : '') + '" onclick="tradeSubTab=\'' + t + '\';render()">' + label + '</button>';
  });
  html += '</div>';

  if (tradeSubTab === 'analyzer') html += renderTradeAnalyzer();
  else if (tradeSubTab === 'finder') html += renderTradeFinder();
  else if (tradeSubTab === 'targets') html += renderTradeTargets();
  else html += renderTradeWindows();
  return html;
}

function renderTradeAnalyzer() {
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');

  var html = '<div class="trade-setup">';
  html += '<div class="trade-side"><h4>You Give</h4>';
  html += '<div class="trade-player-list">';
  S.myTeam.players.forEach(function(p) {
    var selected = tradeState.givePlayers.includes(p.id);
    html += '<div class="trade-player-option ' + (selected ? 'selected' : '') + '" onclick="toggleTradePlayer(\'give\',' + p.id + ')">';
    html += esc(p.name) + ' <span class="muted">z:' + fmt(p.zScores ? p.zScores.total : 0, 2) + '</span>';
    html += '</div>';
  });
  html += '</div></div>';

  html += '<div class="trade-side"><h4>You Get</h4>';
  html += '<select class="form-input" onchange="tradeState.getTeam=parseInt(this.value);render()">';
  html += '<option value="0">Select team...</option>';
  S.teams.forEach(function(t) {
    if (t.teamId === S.myTeam.teamId) return;
    html += '<option value="' + t.teamId + '"' + (tradeState.getTeam === t.teamId ? ' selected' : '') + '>' + esc(t.name) + '</option>';
  });
  html += '</select>';
  var getTeam = S.teams.find(function(t) { return t.teamId === tradeState.getTeam; });
  if (getTeam) {
    html += '<div class="trade-player-list">';
    getTeam.players.forEach(function(p) {
      var selected = tradeState.getPlayers.includes(p.id);
      html += '<div class="trade-player-option ' + (selected ? 'selected' : '') + '" onclick="toggleTradePlayer(\'get\',' + p.id + ')">';
      html += esc(p.name) + ' <span class="muted">z:' + fmt(p.zScores ? p.zScores.total : 0, 2) + '</span>';
      html += '</div>';
    });
    html += '</div>';
  }
  html += '</div></div>';

  // Evaluate if both sides have players
  if (tradeState.givePlayers.length && tradeState.getPlayers.length) {
    var give = tradeState.givePlayers.map(function(id) { return S.allPlayers.find(function(p) { return p.id === id; }); }).filter(Boolean);
    var get = tradeState.getPlayers.map(function(id) { return S.allPlayers.find(function(p) { return p.id === id; }); }).filter(Boolean);
    var result = Engines.evaluateTrade(give, get);

    html += '<div class="trade-result">';
    html += '<div class="trade-grade grade-' + result.grade.charAt(0).toLowerCase() + '">' + result.grade + '</div>';
    html += '<p class="trade-fairness">' + result.fairness + '</p>';
    html += '<p class="muted">Acceptance: ' + result.acceptProbability + '</p>';

    // Category impact
    html += '<div class="table-scroll"><table class="data-table compact">';
    html += '<thead><tr><th>Cat</th><th>Before</th><th>After</th><th>Impact</th></tr></thead><tbody>';
    S.league.categories.forEach(function(cat) {
      var imp = result.catImpact[cat.abbr];
      if (!imp) return;
      var cls = imp.diff > 0.1 ? 'stat-positive' : (imp.diff < -0.1 ? 'stat-negative' : '');
      html += '<tr><td style="color:' + cat.color + '">' + cat.abbr + '</td>';
      html += '<td>' + fmt(imp.before, 2) + '</td>';
      html += '<td>' + fmt(imp.after, 2) + '</td>';
      html += '<td class="' + cls + '">' + (imp.diff >= 0 ? '+' : '') + fmt(imp.diff, 2) + '</td></tr>';
    });
    html += '</tbody></table></div>';

    if (result.catsHelped.length) html += '<p class="stat-positive">Helps: ' + result.catsHelped.join(', ') + '</p>';
    if (result.catsHurt.length) html += '<p class="stat-negative">Hurts: ' + result.catsHurt.join(', ') + '</p>';
    html += '</div>';
  }

  return html;
}

function toggleTradePlayer(side, playerId) {
  var arr = side === 'give' ? tradeState.givePlayers : tradeState.getPlayers;
  var idx = arr.indexOf(playerId);
  if (idx >= 0) arr.splice(idx, 1);
  else arr.push(playerId);
  render();
}

function renderTradeFinder() {
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');

  // Find weak cats
  var weakCats = [];
  S.league.categories.forEach(function(cat) {
    var rank = getTeamCategoryRank(S.myTeam, cat.abbr);
    if (rank > Math.ceil(S.league.teamCount * 0.5)) weakCats.push(cat.abbr);
  });

  var suggestions = Engines.findTrades(weakCats);
  if (!suggestions.length) return '<p class="muted">No trade suggestions found. Try syncing data first.</p>';

  var html = '<p class="muted">Targeting improvements in: ' + (weakCats.length ? weakCats.join(', ') : 'all categories') + '</p>';
  suggestions.slice(0, 10).forEach(function(s) {
    html += '<div class="trade-suggestion">';
    html += '<div class="trade-suggestion-header">';
    html += '<span class="trade-grade grade-' + s.result.grade.charAt(0).toLowerCase() + '">' + s.result.grade + '</span>';
    html += '<span>' + esc(s.team.name) + '</span>';
    html += '</div>';
    html += '<div class="trade-suggestion-body">';
    html += '<div>Give: <strong>' + esc(s.give.name) + '</strong> (z: ' + fmt(s.give.zScores.total, 2) + ')</div>';
    html += '<div>Get: <strong>' + esc(s.get.name) + '</strong> (z: ' + fmt(s.get.zScores.total, 2) + ')</div>';
    html += '<div class="muted">' + s.result.fairness + ' | ' + s.result.acceptProbability + '</div>';
    if (s.result.catsHelped.length) html += '<div class="stat-positive">+' + s.result.catsHelped.join(', ') + '</div>';
    html += '</div></div>';
  });
  return html;
}

function renderTradeTargets() {
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');

  var cats = S.league.categories;
  var html = '<p class="muted">Players on other teams that fit your category needs.</p>';

  // Find target players across the league
  var targets = [];
  S.teams.forEach(function(team) {
    if (team.teamId === S.myTeam.teamId) return;
    team.players.forEach(function(p) {
      if (p.zScores && p.zScores.total > 1) {
        targets.push({ player: p, team: team });
      }
    });
  });
  targets.sort(function(a, b) { return (b.player.zScores.total || 0) - (a.player.zScores.total || 0); });

  html += '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr><th>Player</th><th>Owner</th><th>Z</th>';
  cats.forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
  html += '</tr></thead><tbody>';
  targets.slice(0, 20).forEach(function(t) {
    html += '<tr><td>' + esc(t.player.name) + '</td><td class="muted">' + esc(t.team.abbrev) + '</td>';
    html += '<td>' + fmt(t.player.zScores.total, 2) + '</td>';
    cats.forEach(function(cat) {
      var val = t.player.stats.season ? t.player.stats.season[cat.abbr] : null;
      html += '<td>' + (val !== null ? fmt(val, 1) : '-') + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function renderTradeWindows() {
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');

  var html = '';
  // Sell-high: players whose L7 >> season (perceived value is peaking)
  var sellHigh = [];
  var buyLow = [];
  S.allPlayers.forEach(function(p) {
    if (!p.stats.season || !p.stats.last7 || p.onTeamId === 0) return;
    var streak = Engines.detectStreaks(p);
    if (streak.trend === 'hot') sellHigh.push({ player: p, streak: streak });
    if (streak.trend === 'cold') buyLow.push({ player: p, streak: streak });
  });

  html += '<h3>Sell High \u{1F4C8}</h3><p class="muted">Players overperforming season averages -- perceived value is peaking.</p>';
  if (sellHigh.length) {
    sellHigh.slice(0, 10).forEach(function(s) {
      var isMyPlayer = s.player.onTeamId === S.myTeam.teamId;
      html += '<div class="window-item sell-high' + (isMyPlayer ? ' my-player' : '') + '">';
      html += '<strong>' + esc(s.player.name) + '</strong>' + (isMyPlayer ? ' (your team)' : '');
      html += '<div class="muted">' + s.streak.label + '</div></div>';
    });
  } else {
    html += '<p class="muted">No sell-high candidates detected.</p>';
  }

  html += '<h3>Buy Low \u{1F4C9}</h3><p class="muted">Players underperforming -- could bounce back, acquire cheaply.</p>';
  if (buyLow.length) {
    buyLow.slice(0, 10).forEach(function(s) {
      html += '<div class="window-item buy-low">';
      html += '<strong>' + esc(s.player.name) + '</strong>';
      var owner = S.teams.find(function(t) { return t.teamId === s.player.onTeamId; });
      if (owner) html += ' <span class="muted">(' + esc(owner.abbrev) + ')</span>';
      html += '<div class="muted">' + s.streak.label + '</div></div>';
    });
  } else {
    html += '<p class="muted">No buy-low candidates detected.</p>';
  }

  return html;
}

// --- TEAM ANALYZER ---
function renderTeamAnalyzer() {
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');
  var cats = S.league.categories;

  var html = '';

  // Category strengths
  html += '<div class="card"><div class="card-header">Your Category Rankings</div>';
  html += '<div class="cat-ranks">';
  cats.forEach(function(cat) {
    var rank = getTeamCategoryRank(S.myTeam, cat.abbr);
    var cls = rank <= 3 ? 'rank-top' : (rank >= S.league.teamCount - 2 ? 'rank-bottom' : 'rank-mid');
    html += '<div class="cat-rank-item ' + cls + '">';
    html += '<span class="cat-rank-name" style="color:' + cat.color + '">' + cat.abbr + '</span>';
    html += '<span class="cat-rank-num">#' + rank + '</span>';
    html += '</div>';
  });
  html += '</div></div>';

  // Punt analysis
  var puntResults = Engines.puntStrategyAnalysis();
  html += '<div class="card"><div class="card-header">Punt Strategy Advisor</div>';
  html += '<p class="muted">Categories ranked by how your team performs when punting each one.</p>';
  puntResults.forEach(function(p) {
    var cls = p.viable ? 'punt-viable' : 'punt-weak';
    html += '<div class="punt-item ' + cls + '">';
    html += '<span style="color:' + catColor(p.puntCat) + '">Punt ' + p.puntCat + '</span>';
    html += '<span>Win rate: ' + fmt(p.winRate * 100, 1) + '%</span>';
    html += p.viable ? ' \u2705' : '';
    html += '</div>';
  });
  html += '</div>';

  // Who Beats Me
  var wbm = Engines.whoBeatsMe();
  html += '<div class="card"><div class="card-header">Matchup Difficulty</div>';
  html += '<p class="muted">Sorted hardest to easiest.</p>';
  html += '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr><th>Team</th><th>W</th><th>L</th><th>Diff</th></tr></thead><tbody>';
  wbm.forEach(function(m) {
    var cls = m.diff > 0 ? 'stat-positive' : (m.diff < 0 ? 'stat-negative' : '');
    html += '<tr><td>' + esc(m.team.name) + '</td><td>' + m.wins + '</td><td>' + m.losses + '</td>';
    html += '<td class="' + cls + '">' + (m.diff > 0 ? '+' : '') + m.diff + '</td></tr>';
  });
  html += '</tbody></table></div></div>';

  // Leaderboard
  html += '<div class="card"><div class="card-header" onclick="toggleSection(\'leaderboard\')">League Leaderboard ' + (isSectionCollapsed('leaderboard') ? '\u25B6' : '\u25BC') + '</div>';
  if (!isSectionCollapsed('leaderboard')) {
    html += '<div class="table-scroll"><table class="data-table compact">';
    html += '<thead><tr><th>Team</th>';
    cats.forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
    html += '</tr></thead><tbody>';
    S.teams.forEach(function(t) {
      var isMe = t.teamId === S.myTeam.teamId;
      html += '<tr class="' + (isMe ? 'my-team-row' : '') + '">';
      html += '<td>' + esc(t.abbrev) + '</td>';
      cats.forEach(function(cat) {
        html += '<td>' + fmt(Engines.teamCategoryStrength(t, cat.abbr), 1) + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div>';

  return html;
}

// --- STATS & TRENDS ---
function renderStatsTrends() {
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');
  var cats = S.league.categories;

  var html = '';

  // Top 50 by z-score
  var top50 = S.allPlayers.slice().sort(function(a, b) { return (b.zScores ? b.zScores.total : 0) - (a.zScores ? a.zScores.total : 0); }).slice(0, 50);
  html += '<div class="card"><div class="card-header" onclick="toggleSection(\'top50\')">Top 50 Players ' + (isSectionCollapsed('top50') ? '\u25B6' : '\u25BC') + '</div>';
  if (!isSectionCollapsed('top50')) {
    html += '<div class="table-scroll"><table class="data-table compact">';
    html += '<thead><tr><th>#</th><th>Player</th><th>Team</th>';
    cats.forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
    html += '<th>Z</th></tr></thead><tbody>';
    top50.forEach(function(p, i) {
      html += '<tr onclick="viewPlayer(' + p.id + ')"><td>' + (i + 1) + '</td><td>' + esc(p.name) + '</td><td>' + p.nbaTeam + '</td>';
      cats.forEach(function(cat) {
        var val = p.stats.season ? p.stats.season[cat.abbr] : null;
        html += '<td>' + (val !== null ? fmt(val, 1) : '-') + '</td>';
      });
      html += '<td>' + fmt(p.zScores.total, 2) + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div>';

  // Biggest risers / fallers
  var trending = S.allPlayers.filter(function(p) { return p.stats.season && p.stats.last7; });
  trending.forEach(function(p) {
    p._trendScore = 0;
    cats.forEach(function(cat) {
      var season = p.stats.season[cat.abbr] || 0;
      var recent = p.stats.last7[cat.abbr] || 0;
      if (season !== 0) {
        var change = (recent - season) / Math.abs(season);
        if (cat.isNegative) change = -change;
        p._trendScore += change;
      }
    });
  });

  var risers = trending.slice().sort(function(a, b) { return b._trendScore - a._trendScore; }).slice(0, 10);
  var fallers = trending.slice().sort(function(a, b) { return a._trendScore - b._trendScore; }).slice(0, 10);

  html += '<div class="card"><div class="card-header">Biggest Risers \u{1F4C8}</div>';
  html += '<div class="mini-table">';
  risers.forEach(function(p) {
    html += '<div class="mini-row" onclick="viewPlayer(' + p.id + ')">' + esc(p.name) + ' (' + p.nbaTeam + ') <span class="stat-positive">+' + fmt(p._trendScore * 100, 0) + '%</span></div>';
  });
  html += '</div></div>';

  html += '<div class="card"><div class="card-header">Biggest Fallers \u{1F4C9}</div>';
  html += '<div class="mini-table">';
  fallers.forEach(function(p) {
    html += '<div class="mini-row" onclick="viewPlayer(' + p.id + ')">' + esc(p.name) + ' (' + p.nbaTeam + ') <span class="stat-negative">' + fmt(p._trendScore * 100, 0) + '%</span></div>';
  });
  html += '</div></div>';

  // Category volatility
  var vol = Engines.categoryVolatility(S.allPlayers.filter(function(p) { return p.gamesPlayed > 10; }));
  html += '<div class="card"><div class="card-header">Category Volatility Index</div>';
  html += '<p class="muted">High = unpredictable, leads not safe. Low = consistent, reliable.</p>';
  html += '<div class="vol-list">';
  cats.forEach(function(cat) {
    var v = vol[cat.abbr];
    if (!v) return;
    html += '<span class="vol-badge vol-' + v.label.toLowerCase() + '" style="border-color:' + cat.color + '">' + cat.abbr + ': ' + v.label + '</span>';
  });
  html += '</div></div>';

  return html;
}

// --- NEWS & INJURIES ---
function renderNewsInjuries() {
  var injured = S.allPlayers.filter(function(p) {
    return p.status && p.status !== 'ACTIVE' && p.status !== 'HEALTHY';
  });
  injured.sort(function(a, b) {
    var order = { OUT: 0, SUSPENSION: 1, GTD: 2, DAY_TO_DAY: 3, GAME_TIME_DECISION: 3 };
    return (order[a.status] || 4) - (order[b.status] || 4);
  });

  var myInjured = injured.filter(function(p) { return p.onTeamId === S.myTeam.teamId; });
  var html = '';

  if (myInjured.length) {
    html += '<div class="card"><div class="card-header">Your Injured Players</div>';
    myInjured.forEach(function(p) {
      html += '<div class="injury-row">' + statusBadge(p.status) + ' <strong>' + esc(p.name) + '</strong> - ' + esc(p.status);
      if (p.injuryNote) html += ' <span class="muted">(' + esc(p.injuryNote) + ')</span>';
      html += '</div>';
    });
    html += '</div>';
  }

  html += '<div class="card"><div class="card-header">League Injury Report (' + injured.length + ' players)</div>';
  html += '<div class="table-scroll"><table class="data-table compact">';
  html += '<thead><tr><th>Player</th><th>Team</th><th>Status</th><th>Owner</th></tr></thead><tbody>';
  injured.slice(0, 50).forEach(function(p) {
    var owner = S.teams.find(function(t) { return t.teamId === p.onTeamId; });
    html += '<tr onclick="viewPlayer(' + p.id + ')">';
    html += '<td>' + statusBadge(p.status) + ' ' + esc(p.name) + '</td>';
    html += '<td>' + p.nbaTeam + '</td>';
    html += '<td>' + esc(p.status) + '</td>';
    html += '<td>' + (owner ? esc(owner.abbrev) : 'FA') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table></div></div>';

  return html;
}

// --- SCHEDULE ---
function renderSchedulePage() {
  var players = S.myTeam.players.filter(function(p) { return p.slotId !== 13; });
  var heatmap = Engines.scheduleHeatMap(players, 14);

  var html = '<div class="card"><div class="card-header">Schedule Heat Map (14 days)</div>';
  html += '<div class="schedule-grid">';
  heatmap.forEach(function(day) {
    var intensity = day.count <= 2 ? 'low' : (day.count <= 5 ? 'med' : 'high');
    html += '<div class="sched-day ' + intensity + (day.isToday ? ' today' : '') + '">';
    html += '<div class="sched-day-header">' + day.dayName + '<br>' + day.date.substring(5) + '</div>';
    html += '<div class="sched-count' + (day.count > S.league.startingSlots ? ' stacked' : '') + '">' + day.count;
    if (day.count > S.league.startingSlots) html += ' \u26A0';
    html += '</div>';
    day.players.forEach(function(p) {
      html += '<div class="sched-player">' + esc(p.name.split(' ').pop()) + '</div>';
    });
    html += '</div>';
  });
  html += '</div></div>';

  // Back-to-backs
  var b2b = Engines.backToBackDetection(players);
  if (b2b.length) {
    html += '<div class="card"><div class="card-header">Back-to-Back Alerts</div>';
    b2b.forEach(function(a) {
      html += '<div class="alert alert-info">' + esc(a.player.name) + ': B2B on ' + a.date1 + ' / ' + a.date2 + ' (Risk: ' + a.risk + ')</div>';
    });
    html += '</div>';
  }

  return html;
}

// --- PLAYOFF PROJECTOR ---
function renderPlayoffProjector() {
  var proj = Engines.playoffProjection();
  if (!proj) return '<p class="muted">Not enough data for projections yet.</p>';

  var html = '<div class="card"><div class="card-header">Playoff Outlook</div>';
  html += '<div class="playoff-proj">';
  html += '<div class="proj-item"><span class="proj-label">Current Seed</span><span class="proj-value">#' + proj.currentSeed + '</span></div>';
  html += '<div class="proj-item"><span class="proj-label">Win Rate</span><span class="proj-value">' + fmt(proj.winRate * 100, 1) + '%</span></div>';
  html += '<div class="proj-item"><span class="proj-label">Matchups Left</span><span class="proj-value">' + proj.matchupsRemaining + '</span></div>';
  html += '<div class="proj-item"><span class="proj-label">Playoff?</span><span class="proj-value ' + (proj.inPlayoffs ? 'stat-positive' : 'stat-negative') + '">' + (proj.inPlayoffs ? 'Yes' : 'No') + ' (top ' + proj.playoffTeams + ')</span></div>';
  html += '</div></div>';
  return html;
}

// --- TIMELINE ---
function renderTimeline() {
  var html = '<div class="card"><div class="card-header">Matchup Simulator</div>';
  html += '<p class="muted">Monte Carlo simulation with 5,000 iterations. See Matchup tab > Projections for live results.</p>';
  html += '<button class="btn btn-primary" onclick="switchTab(1);matchupSubTab=\'projections\';render()">View Projections</button>';
  html += '</div>';

  // Team of the week
  var totw = Engines.teamOfTheWeek();
  html += '<div class="card"><div class="card-header">Team of the Week</div>';
  if (totw.length) {
    html += '<div class="table-scroll"><table class="data-table compact">';
    html += '<thead><tr><th>#</th><th>Team</th><th>Wins vs Field</th></tr></thead><tbody>';
    totw.forEach(function(t, i) {
      var isMe = t.team.teamId === S.myTeam.teamId;
      html += '<tr class="' + (isMe ? 'my-team-row' : '') + '"><td>' + (i + 1) + '</td><td>' + esc(t.team.name) + '</td><td>' + t.winsVsField + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div>';

  return html;
}

// --- NOTIFICATIONS ---
function renderNotifications() {
  if (!S.notifications.length) return '<div class="empty-state"><p>No notifications yet.</p><p class="muted">Alerts for injuries, lineup warnings, and trade opportunities will appear here.</p></div>';

  var html = '<button class="btn btn-secondary btn-sm" onclick="markAllRead()">Mark All Read</button>';
  S.notifications.forEach(function(n) {
    html += '<div class="notification-item ' + (n.read ? '' : 'unread') + '" onclick="markRead(\'' + n.id + '\')">';
    html += '<div class="notif-title">' + esc(n.title) + '</div>';
    html += '<div class="notif-body">' + esc(n.body) + '</div>';
    html += '<div class="notif-time">' + timeSince(n.timestamp) + '</div>';
    html += '</div>';
  });
  return html;
}

function markRead(id) {
  var n = S.notifications.find(function(x) { return x.id === id; });
  if (n) n.read = true;
  autosave();
  render();
  updateNav();
}

function markAllRead() {
  S.notifications.forEach(function(n) { n.read = true; });
  autosave();
  render();
  updateNav();
}

// --- SETTINGS ---
function renderSettings() {
  var html = '';

  // ESPN connection
  html += '<div class="card"><div class="card-header">ESPN Connection</div>';
  html += '<div class="form-group"><label>League ID</label><input type="text" class="form-input" value="' + esc(S.espn.leagueId) + '" onchange="S.espn.leagueId=this.value;autosave()" /></div>';
  html += '<div class="form-group"><label>espn_s2</label><input type="text" class="form-input" value="' + esc(S.espn.espnS2) + '" onchange="S.espn.espnS2=this.value;autosave()" /></div>';
  html += '<div class="form-group"><label>SWID</label><input type="text" class="form-input" value="' + esc(S.espn.swid) + '" onchange="S.espn.swid=this.value;autosave()" /></div>';
  html += '<div class="form-group"><label>Status</label><span class="' + (S.espn.connected ? 'stat-positive' : 'stat-negative') + '">' + (S.espn.connected ? '\u2705 Connected' : '\u274C Disconnected') + '</span></div>';
  html += '<button class="btn btn-primary" onclick="ESPNSync.syncAll()">Sync Now</button> ';
  html += '<button class="btn btn-secondary" onclick="testConnection()">Test Connection</button>';
  html += '</div>';

  // Sync settings
  html += '<div class="card"><div class="card-header">Sync Settings</div>';
  html += '<div class="form-group"><label>Auto-refresh interval (minutes)</label>';
  html += '<input type="number" class="form-input" value="' + S.espn.syncInterval + '" min="5" max="60" onchange="S.espn.syncInterval=parseInt(this.value);autosave();startAutoSync()" /></div>';
  html += '<div class="form-group"><label>Last sync</label><span>' + (S.espn.lastSync ? timeSince(S.espn.lastSync) : 'Never') + '</span></div>';
  if (S.espn.syncLog.length) {
    html += '<h4>Sync Log</h4>';
    S.espn.syncLog.forEach(function(log) {
      html += '<div class="sync-log-item ' + log.status + '">' + timeSince(log.timestamp) + ': ' + esc(log.message) + '</div>';
    });
  }
  html += '</div>';

  // Data management
  html += '<div class="card"><div class="card-header">Data Management</div>';
  html += '<button class="btn btn-primary" onclick="exportData()">Export Backup (JSON)</button> ';
  html += '<label class="btn btn-secondary">Import Backup <input type="file" accept=".json" style="display:none" onchange="importData(this.files[0])" /></label>';
  html += '<p class="muted" style="margin-top:12px">Export saves all data including chat history, preferences, and cached league data.</p>';
  html += '</div>';

  // League info
  html += '<div class="card"><div class="card-header">League Settings (Auto-Detected)</div>';
  html += '<div class="settings-display">';
  html += '<div class="setting-row"><span>League</span><span>' + esc(S.league.name) + '</span></div>';
  html += '<div class="setting-row"><span>Format</span><span>' + esc(S.league.scoringType) + '</span></div>';
  html += '<div class="setting-row"><span>Teams</span><span>' + S.league.teamCount + '</span></div>';
  html += '<div class="setting-row"><span>Categories</span><span>' + S.league.categories.map(function(c) { return c.abbr; }).join(', ') + '</span></div>';
  html += '<div class="setting-row"><span>Starting slots</span><span>' + S.league.startingSlots + '</span></div>';
  html += '<div class="setting-row"><span>Bench slots</span><span>' + S.league.benchSlots + '</span></div>';
  html += '<div class="setting-row"><span>IR slots</span><span>' + S.league.irSlots + '</span></div>';
  html += '<div class="setting-row"><span>Playoff teams</span><span>' + S.league.playoffTeams + '</span></div>';
  html += '</div></div>';

  // Danger zone
  html += '<div class="card card-danger"><div class="card-header">Danger Zone</div>';
  html += '<button class="btn btn-danger" onclick="if(confirm(\'This will erase ALL data including chat history, preferences, and cached data. Are you sure?\')){localStorage.clear();location.reload();}">Reset Everything</button>';
  html += '</div>';

  return html;
}
