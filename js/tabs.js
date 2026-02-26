// ============================================================
// LARRY v2.3 -- TAB RENDERERS
// All 5 main tabs + League sub-pages
// ============================================================

// --- SHARED: Stat view selector ---
var currentStatView = 'season'; // 'season' | 'last30' | 'last15' | 'last7' | 'zScores' | 'durant' | 'per36' | 'totals' | 'custom'
var customDateRange = { from: '', to: '' };
var playingOnDate = ''; // YYYY-MM-DD filter for Players tab

function statViewSelector(onChange) {
  var views = [
    { id: 'season', label: 'Season' },
    { id: 'last30', label: 'L30' },
    { id: 'last15', label: 'L15' },
    { id: 'last7', label: 'L7' },
    { id: 'totals', label: 'Totals' },
    { id: 'per36', label: 'Per 36' },
    { id: 'zScores', label: 'Z-Score' },
    { id: 'durant', label: 'DURANT' },
    { id: 'custom', label: 'Custom' }
  ];
  var html = '<div class="stat-view-toggle">';
  views.forEach(function(v) {
    html += '<button class="toggle-btn' + (currentStatView === v.id ? ' active' : '') + '" onclick="currentStatView=\'' + v.id + '\';render()">' + v.label + '</button>';
  });
  html += '</div>';
  if (currentStatView === 'custom') {
    html += '<div class="custom-date-range">';
    html += '<input type="date" class="form-input date-input" value="' + esc(customDateRange.from) + '" onchange="customDateRange.from=this.value;render()" />';
    html += '<span class="muted">to</span>';
    html += '<input type="date" class="form-input date-input" value="' + esc(customDateRange.to) + '" onchange="customDateRange.to=this.value;render()" />';
    html += '</div>';
  }
  return html;
}

function getPlayerStatVal(player, catAbbr) {
  if (currentStatView === 'zScores' || currentStatView === 'durant') {
    return player.zScores ? player.zScores[catAbbr] : null;
  }
  if (currentStatView === 'per36') {
    var mins = player.minutesPerGame || (player.stats && player.stats.season ? player.stats.season.MIN : null);
    var raw = player.stats && player.stats.season ? player.stats.season[catAbbr] : null;
    if (mins && mins > 0 && raw !== null && raw !== undefined) {
      return (raw / mins) * 36;
    }
    return null;
  }
  if (currentStatView === 'totals') {
    var avg = player.stats && player.stats.season ? player.stats.season[catAbbr] : null;
    var cat = S.league.categories.find(function(c) { return c.abbr === catAbbr; });
    if (cat && cat.isPercent) return avg; // show pct as-is for totals
    var gp = player.gamesPlayed || 0;
    if (avg !== null && avg !== undefined && gp > 0) return avg * gp;
    return null;
  }
  if (currentStatView === 'custom') {
    // Compute from game log if available, otherwise fall back to season
    if (player.gameLog && player.gameLog.length && customDateRange.from && customDateRange.to) {
      var from = customDateRange.from, to = customDateRange.to;
      var games = player.gameLog.filter(function(g) { return g.date >= from && g.date <= to; });
      if (games.length === 0) return null;
      var sum = 0;
      games.forEach(function(g) { sum += (g[catAbbr] || 0); });
      return sum / games.length;
    }
    return player.stats && player.stats.season ? player.stats.season[catAbbr] : null;
  }
  var period = currentStatView;
  return player.stats && player.stats[period] ? player.stats[period][catAbbr] : null;
}

function fmtStat(val, cat) {
  if (val === null || val === undefined || isNaN(val)) return '-';
  if (currentStatView === 'zScores' || currentStatView === 'durant') return (val >= 0 ? '+' : '') + parseFloat(val).toFixed(2);
  if (currentStatView === 'totals' && cat && !cat.isPercent) return Math.round(val).toLocaleString();
  if (cat && cat.isPercent) return pct(val);
  return fmt(val, 1);
}

// ========== TAB 1: ROSTER ==========
var rosterSubTab = 'lineup'; // 'lineup' | 'decisions'

function renderRoster(container) {
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

  var starters = players.filter(function(p) { return p.slotId !== 12 && p.slotId !== 13; });
  var bench = players.filter(function(p) { return p.slotId === 12; });
  var ir = players.filter(function(p) { return p.slotId === 13; });

  html += '<div class="roster-section"><h3 class="section-title">Starters</h3>';
  html += buildRosterTable(starters, cats, 'roster-start');
  html += '</div>';

  if (bench.length) {
    html += '<div class="roster-section"><h3 class="section-title">Bench</h3>';
    html += buildRosterTable(bench, cats, 'roster-bench');
    html += '</div>';
  }

  if (ir.length) {
    html += '<div class="roster-section"><h3 class="section-title">IR</h3>';
    html += buildRosterTable(ir, cats, 'roster-ir');
    html += '</div>';
  }

  return html;
}

function buildRosterTable(players, cats, tableKey) {
  var html = '<div class="table-scroll"><table class="data-table">';
  html += '<thead><tr>';
  html += '<th onclick="sortTable(\'' + tableKey + '\',\'slot\',null);render()">Slot' + sortIcon(tableKey, 'slot') + '</th>';
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
    html += '<td><span class="slot-badge">' + esc(p.slot) + '</span></td>';
    html += '<td class="player-cell"><div class="player-cell-inner">';
    html += '<div class="player-cell-headshot">' + playerHeadshot(p, 28) + '</div>';
    html += '<div class="player-cell-info">' + statusBadge(p.status) + ' ';
    html += '<span class="player-name">' + esc(p.name) + '</span>';
    html += '<span class="player-meta">' + p.positions.join('/') + ' - ' + p.nbaTeam + '</span>';
    html += '</div></div></td>';
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
      if ((currentStatView === 'zScores' || currentStatView === 'durant') && val !== null) {
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

  // Roster construction audit
  var audit = Engines.rosterConstructionAudit(S.myTeam.players);
  if (audit.issues.length) {
    html += '<div class="card">';
    html += '<div class="card-header">\u{1F6A8} Roster Issues</div>';
    audit.issues.forEach(function(issue) {
      var cls = issue.type === 'ir' ? 'alert-info' : (issue.type === 'shortage' ? 'alert-warning' : 'alert-info');
      html += '<div class="alert ' + cls + '">' + esc(issue.msg) + '</div>';
    });
    html += '</div>';
  }

  // Acquisitions
  html += '<div class="card">';
  html += '<div class="card-header">Acquisitions</div>';
  var limit = S.league.acquisitionLimit;
  var used = S.myTeam.acquisitionsUsed || 0;
  html += '<div class="acq-tracker">';
  if (limit > 0) {
    html += '<span class="acq-count">' + used + '/' + limit + ' used</span>';
    html += '<div class="progress-bar"><div class="progress-fill" style="width:' + Math.min(100, used / limit * 100) + '%"></div></div>';
  } else {
    html += '<span class="acq-count">Unlimited (' + used + ' used)</span>';
  }
  html += '</div></div>';

  // Start/Sit
  html += '<div class="card">';
  html += '<div class="card-header" onclick="toggleSection(\'startSit\')">Start/Sit Optimizer ' + (isSectionCollapsed('startSit') ? '\u25B6' : '\u25BC') + '</div>';
  if (!isSectionCollapsed('startSit')) html += renderStartSit();
  html += '</div>';

  // Drop candidates
  html += '<div class="card">';
  html += '<div class="card-header" onclick="toggleSection(\'drops\')">Drop Candidates ' + (isSectionCollapsed('drops') ? '\u25B6' : '\u25BC') + '</div>';
  if (!isSectionCollapsed('drops')) html += renderDropCandidates();
  html += '</div>';

  // Add targets
  html += '<div class="card">';
  html += '<div class="card-header" onclick="toggleSection(\'adds\')">Add Targets ' + (isSectionCollapsed('adds') ? '\u25B6' : '\u25BC') + '</div>';
  if (!isSectionCollapsed('adds')) html += renderAddTargets();
  html += '</div>';

  // IR Stash Candidates
  var irStash = Engines.irStashCandidates();
  if (irStash.length) {
    html += '<div class="card">';
    html += '<div class="card-header" onclick="toggleSection(\'irStash\')">IR Stash Candidates ' + (isSectionCollapsed('irStash') ? '\u25B6' : '\u25BC') + '</div>';
    if (!isSectionCollapsed('irStash')) {
      irStash.forEach(function(s) {
        html += '<div class="decision-item" onclick="openPlayerPopup(' + s.player.id + ')">';
        html += statusBadge(s.player.status) + ' <strong>' + esc(s.player.name) + '</strong>';
        html += ' <span class="muted">' + s.player.nbaTeam + ' | Own: ' + fmt(s.player.ownership, 0) + '% | Z: ' + fmt(s.zScore, 2) + '</span>';
        html += ' <span class="ir-stash-value stash-' + s.value.toLowerCase() + '">' + s.value + ' value</span>';
        html += '</div>';
      });
    }
    html += '</div>';
  }

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
  html += '<h4>Optimal Lineup Today</h4><div class="mini-table">';
  lineup.starters.forEach(function(slot) {
    html += '<div class="mini-row"><span class="slot-badge">' + slot.name + '</span> ';
    if (slot.player) {
      html += statusBadge(slot.player.status) + ' <span class="player-name">' + esc(slot.player.name) + '</span>';
      html += ' <span class="muted">(' + slot.player.nbaTeam + ')</span>';
      if (slot.player.gamesToday) html += ' <span class="game-badge">\u{1F3C0}</span>';
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
    html += '<div class="decision-item"><div class="decision-rank">#' + (i + 1) + '</div><div class="decision-content">';
    html += '<div class="decision-player">' + statusBadge(d.player.status) + ' ' + esc(d.player.name) + ' <span class="z-badge z-' + (d.zScore > 0 ? 'pos' : 'neg') + '">' + fmt(d.zScore, 2) + '</span></div>';
    if (d.replacement) {
      html += '<div class="decision-replacement">\u27A1 Pick up: <strong>' + esc(d.replacement.name) + '</strong> (' + d.replacement.nbaTeam + ') z: ' + fmt(d.replacement.zScores ? d.replacement.zScores.total : 0, 2) + '</div>';
    }
    html += '</div></div>';
  });
  html += '</div>';
  return html;
}

function renderAddTargets() {
  var weakCats = [];
  S.league.categories.forEach(function(cat) {
    var rank = getTeamCategoryRank(S.myTeam, cat.abbr);
    if (rank > Math.ceil(S.league.teamCount * 0.6)) weakCats.push(cat.abbr);
  });

  var targets = Engines.getAddTargets(weakCats);
  if (!targets.length) return '<p class="muted">No available targets found.</p>';

  var html = weakCats.length ? '<p class="muted">Targeting weak cats: ' + weakCats.join(', ') + '</p>' : '';
  html += '<div class="table-scroll"><table class="data-table compact"><thead><tr><th>Player</th><th>Team</th><th>Own%</th>';
  S.league.categories.forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
  html += '<th>Z</th></tr></thead><tbody>';
  targets.forEach(function(p) {
    html += '<tr onclick="openPlayerPopup(' + p.id + ')"><td class="player-cell"><div class="player-cell-inner"><div class="player-cell-headshot">' + playerHeadshot(p, 22) + '</div><div class="player-cell-info">' + esc(p.name) + ' <span class="muted">' + p.positions.join('/') + '</span></div></div></td>';
    html += '<td>' + p.nbaTeam + '</td><td>' + fmt(p.ownership, 0) + '%</td>';
    S.league.categories.forEach(function(cat) {
      html += '<td>' + fmtStat(p.stats.season ? p.stats.season[cat.abbr] : null, cat) + '</td>';
    });
    html += '<td class="z-badge z-' + ((p.zScores && p.zScores.total > 0) ? 'pos' : 'neg') + '">' + fmt(p.zScores ? p.zScores.total : 0, 2) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function getTeamCategoryRank(team, catAbbr) {
  var vals = S.teams.map(function(t) {
    return { teamId: t.teamId, val: Engines.teamCategoryStrength(t, catAbbr) };
  });
  var cat = S.league.categories.find(function(c) { return c.abbr === catAbbr; });
  vals.sort(function(a, b) { return cat && cat.isNegative ? (a.val - b.val) : (b.val - a.val); });
  return vals.findIndex(function(v) { return v.teamId === team.teamId; }) + 1;
}


// ========== TAB 2: MATCHUP ==========
var matchupSubTab = 'score'; // 'score' | 'schedule' | 'projections' | 'recap'

function renderMatchup(container) {
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');

  var html = '<div class="tab-header">';
  html += '<h2>Matchup ' + S.matchup.matchupPeriodId + '</h2>';
  html += '<div class="sub-tab-bar">';
  html += '<button class="sub-tab' + (matchupSubTab === 'score' ? ' active' : '') + '" onclick="matchupSubTab=\'score\';render()">Score</button>';
  html += '<button class="sub-tab' + (matchupSubTab === 'schedule' ? ' active' : '') + '" onclick="matchupSubTab=\'schedule\';render()">Schedule</button>';
  html += '<button class="sub-tab' + (matchupSubTab === 'projections' ? ' active' : '') + '" onclick="matchupSubTab=\'projections\';render()">Projections</button>';
  html += '<button class="sub-tab' + (matchupSubTab === 'recap' ? ' active' : '') + '" onclick="matchupSubTab=\'recap\';render()">Recap</button>';
  html += '</div></div>';

  if (matchupSubTab === 'score') html += renderMatchupScore();
  else if (matchupSubTab === 'schedule') html += renderMatchupSchedule();
  else if (matchupSubTab === 'projections') html += renderMatchupProjections();
  else html += renderMatchupRecap();

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
  html += '<div class="card"><div class="card-header">Schedule Advantage</div>';
  html += '<div class="sched-advantage">';
  html += '<span>My games: <strong>' + (S.matchup.myGamesRemaining || '?') + '</strong></span>';
  html += '<span>Opponent: <strong>' + (S.matchup.oppGamesRemaining || '?') + '</strong></span>';
  var diff = (S.matchup.myGamesRemaining || 0) - (S.matchup.oppGamesRemaining || 0);
  if (diff > 0) html += '<span class="advantage positive">+' + diff + ' advantage</span>';
  else if (diff < 0) html += '<span class="advantage negative">' + diff + ' deficit</span>';
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
    html += '<div class="mc-bar-container"><div class="mc-bar win" style="width:' + prob.win + '%"></div></div>';
    html += '<span class="mc-pct">' + prob.win + '%</span></div>';
  });
  html += '</div>';
  var projTies = Math.max(0, cats.length - projWins - projLosses);
  html += '<div class="mc-summary">Projected: <strong>' + projWins + '-' + projLosses + '-' + projTies + '</strong></div>';
  html += '</div>';

  var vol = Engines.categoryVolatility(S.myTeam.players);
  html += '<div class="card"><div class="card-header">Category Volatility</div><div class="vol-list">';
  cats.forEach(function(cat) {
    var v = vol[cat.abbr];
    if (!v) return;
    html += '<span class="vol-badge vol-' + v.label.toLowerCase() + '" style="border-color:' + cat.color + '">' + cat.abbr + ': ' + v.label + '</span>';
  });
  html += '</div></div>';

  return html;
}


// --- MATCHUP RECAP (auto-generated post-matchup) ---
function renderMatchupRecap() {
  var cats = S.league.categories;
  var myRec = S.matchup.myRecord || { wins: 0, losses: 0, ties: 0 };
  var totalCats = myRec.wins + myRec.losses + myRec.ties;
  var matchupComplete = S.matchup.isComplete || false;

  var html = '';
  if (!matchupComplete && totalCats > 0) {
    html += '<div class="alert alert-info">Matchup still in progress. Recap will auto-generate when the period ends.</div>';
  }

  // Result banner
  var result = myRec.wins > myRec.losses ? 'win' : (myRec.losses > myRec.wins ? 'loss' : 'tie');
  html += '<div class="recap-banner recap-' + result + '">';
  html += '<div class="recap-result">' + (result === 'win' ? '\u{1F3C6} WIN' : (result === 'loss' ? '\u{1F4A5} LOSS' : '\u{1F91D} TIE')) + '</div>';
  html += '<div class="recap-score">' + myRec.wins + '-' + myRec.losses + '-' + myRec.ties + '</div>';
  html += '<div class="recap-vs">vs ' + esc(S.matchup.opponentName) + '</div>';
  html += '</div>';

  // Category breakdown
  html += '<div class="card"><div class="card-header">Category Breakdown</div>';
  html += '<div class="recap-cats">';
  var marginalWins = [], marginalLosses = [], blowouts = [];
  cats.forEach(function(cat) {
    var my = S.matchup.myScores[cat.abbr] || 0;
    var opp = S.matchup.oppScores[cat.abbr] || 0;
    var diff = cat.isNegative ? (opp - my) : (my - opp);
    var pctDiff = opp !== 0 ? Math.abs(diff / opp) * 100 : 100;
    var won = diff > 0;
    var tied = my === opp;
    var cls = tied ? 'recap-cat-tied' : (won ? 'recap-cat-won' : 'recap-cat-lost');

    html += '<div class="recap-cat ' + cls + '">';
    html += '<span class="recap-cat-name" style="color:' + cat.color + '">' + cat.abbr + '</span>';
    html += '<span class="recap-cat-vals">' + fmtCatVal(my, cat) + ' vs ' + fmtCatVal(opp, cat) + '</span>';
    html += '<span class="recap-cat-diff">' + (won ? '+' : '') + (cat.isPercent ? fmt(diff * 100, 1) + '%' : fmt(diff, 1)) + '</span>';
    html += '</div>';

    if (!tied && pctDiff < 10) { (won ? marginalWins : marginalLosses).push(cat.abbr); }
    if (!tied && pctDiff > 40) blowouts.push({ cat: cat.abbr, won: won });
  });
  html += '</div></div>';

  // Insights
  html += '<div class="card"><div class="card-header">Insights</div>';
  if (marginalLosses.length) {
    html += '<div class="recap-insight">\u{1F534} Close losses (' + marginalLosses.join(', ') + ') \u2014 a single streaming add might have flipped these.</div>';
  }
  if (marginalWins.length) {
    html += '<div class="recap-insight">\u{1F7E2} Close wins (' + marginalWins.join(', ') + ') \u2014 barely held on. Watch these categories next week.</div>';
  }
  if (blowouts.length) {
    var blowoutWins = blowouts.filter(function(b) { return b.won; }).map(function(b) { return b.cat; });
    var blowoutLosses = blowouts.filter(function(b) { return !b.won; }).map(function(b) { return b.cat; });
    if (blowoutWins.length) html += '<div class="recap-insight">\u{1F4AA} Dominant in: ' + blowoutWins.join(', ') + '</div>';
    if (blowoutLosses.length) html += '<div class="recap-insight">\u26A0 Outclassed in: ' + blowoutLosses.join(', ') + ' \u2014 consider trade targets or punt strategy.</div>';
  }
  html += '</div>';

  // MVP / LVP
  var players = S.myTeam.players.filter(function(p) { return p.slotId !== 13 && p.slotId !== 12; });
  if (players.length) {
    players.forEach(function(p) {
      p._weekValue = 0;
      cats.forEach(function(cat) {
        var val = p.stats && p.stats.last7 ? p.stats.last7[cat.abbr] : (p.stats && p.stats.season ? p.stats.season[cat.abbr] : 0);
        p._weekValue += (p.zScores ? (p.zScores[cat.abbr] || 0) : 0);
      });
    });
    var sorted = players.slice().sort(function(a, b) { return (b._weekValue || 0) - (a._weekValue || 0); });
    var mvp = sorted[0], lvp = sorted[sorted.length - 1];

    html += '<div class="card"><div class="card-header">Performance Awards</div>';
    if (mvp) html += '<div class="recap-award"><span class="award-icon">\u{1F3C5}</span><span><strong>MVP:</strong> ' + esc(mvp.name) + ' (z: ' + fmt(mvp._weekValue, 2) + ')</span></div>';
    if (lvp && lvp !== mvp) html += '<div class="recap-award"><span class="award-icon">\u{1F4A4}</span><span><strong>LVP:</strong> ' + esc(lvp.name) + ' (z: ' + fmt(lvp._weekValue, 2) + ')</span></div>';
    html += '</div>';
  }

  // Schedule impact
  var myGR = S.matchup.myGamesRemaining || 0;
  var oppGR = S.matchup.oppGamesRemaining || 0;
  if (myGR > 0 || oppGR > 0) {
    html += '<div class="card"><div class="card-header">Schedule Impact</div>';
    html += '<p>Your team had <strong>' + (S.matchup.myGamesPlayed || '?') + '</strong> games this period vs opponent\'s <strong>' + (S.matchup.oppGamesPlayed || '?') + '</strong>.</p>';
    html += '</div>';
  }

  return html;
}


// ========== TAB 3: PLAYERS ==========
var playerFilters = { pos: 'All', status: 'available', search: '' };

function renderPlayers(container) {
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');

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
  html += '<div class="filter-row-date">';
  html += '<label class="date-filter-label">Playing on:</label>';
  html += '<input type="date" class="form-input date-input" value="' + esc(playingOnDate) + '" onchange="playingOnDate=this.value;render()" />';
  if (playingOnDate) html += '<button class="chip active" onclick="playingOnDate=\'\';render()">\u2715 Clear</button>';
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
  if (playingOnDate) {
    players = players.filter(function(p) {
      return p.schedule && p.schedule.some(function(g) { return g.date === playingOnDate; });
    });
  }

  var zKey = currentStatView === 'durant' ? 'durant' : 'total';
  players.sort(function(a, b) { return (b.zScores ? b.zScores[zKey] || 0 : 0) - (a.zScores ? a.zScores[zKey] || 0 : 0); });

  var cats = S.league.categories;
  var zLabel = currentStatView === 'durant' ? 'DUR' : 'Z';
  html += '<div class="table-scroll"><table class="data-table"><thead><tr>';
  html += '<th onclick="sortPlayerTable(\'name\')">Player' + sortIcon('players', 'name') + '</th>';
  html += '<th>Team</th><th onclick="sortPlayerTable(\'ownership\')">Own%' + sortIcon('players', 'ownership') + '</th>';
  cats.forEach(function(cat) {
    html += '<th class="stat-col" style="color:' + cat.color + '" onclick="sortPlayerTable(\'' + cat.abbr + '\')">' + cat.abbr + sortIcon('players', cat.abbr) + '</th>';
  });
  html += '<th onclick="sortPlayerTable(\'zTotal\')">' + zLabel + sortIcon('players', 'zTotal') + '</th>';
  if (currentStatView === 'durant') {
    html += '<th onclick="sortPlayerTable(\'durantH2H\')">H2H' + sortIcon('players', 'durantH2H') + '</th>';
  }
  html += '<th>Trend</th></tr></thead><tbody>';

  players.slice(0, 75).forEach(function(p) {
    var onWatch = S.watchlist.includes(p.id);
    html += '<tr onclick="openPlayerPopup(' + p.id + ')"><td class="player-cell"><div class="player-cell-inner">';
    html += '<div class="player-cell-headshot">' + playerHeadshot(p, 24) + '</div>';
    html += '<div class="player-cell-info">' + statusBadge(p.status) + ' <span class="player-name">' + esc(p.name) + '</span>';
    html += '<span class="player-meta">' + p.positions.join('/') + (onWatch ? ' \u2B50' : '') + '</span></div></div></td>';
    html += '<td>' + p.nbaTeam + '</td><td>' + fmt(p.ownership, 0) + '%</td>';
    cats.forEach(function(cat) {
      var val = getPlayerStatVal(p, cat.abbr);
      var cls = '';
      if ((currentStatView === 'zScores' || currentStatView === 'durant') && val !== null) cls = val > 0.5 ? 'stat-positive' : (val < -0.5 ? 'stat-negative' : '');
      html += '<td class="stat-col ' + cls + '">' + fmtStat(val, cat) + '</td>';
    });
    var zVal = currentStatView === 'durant' ? (p.zScores ? p.zScores.durant : 0) : (p.zScores ? p.zScores.total : 0);
    html += '<td class="z-badge z-' + (zVal > 0 ? 'pos' : 'neg') + '">' + fmt(zVal, 2) + '</td>';
    if (currentStatView === 'durant') {
      html += '<td class="z-badge z-' + ((p.zScores ? p.zScores.durantH2H : 0) > 0 ? 'pos' : 'neg') + '">' + fmt(p.zScores ? p.zScores.durantH2H : 0, 2) + '</td>';
    }
    html += '<td>' + trendArrow(p.stats.last7 ? avgCatVal(p, 'last7') : null, p.stats.season ? avgCatVal(p, 'season') : null) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  if (players.length > 75) html += '<p class="muted text-center">Showing 75 of ' + players.length + '</p>';

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
  var st = sortState['players'] || { col: 'zTotal', dir: 'desc' };
  if (st.col === col) st.dir = st.dir === 'asc' ? 'desc' : 'asc';
  else { st.col = col; st.dir = 'desc'; }
  sortState['players'] = st;
  render();
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
  html += '<div class="chat-header"><div class="larry-chat-avatar">' + getLarryAvatar(32) + '</div>';
  html += '<span class="chat-title">Larry</span>';
  html += '<button class="btn btn-sm btn-secondary" onclick="if(confirm(\'Clear chat history?\')){LarryChat.clearChat();}">Clear</button></div>';
  html += '<div class="chat-messages" id="chat-messages"></div>';
  html += '<div class="typing-indicator" id="typing-indicator" style="display:none">';
  html += '<div class="larry-chat-avatar small">' + getLarryAvatar(20) + '</div>';
  html += '<div class="typing-dots"><span></span><span></span><span></span></div></div>';
  html += '<div class="chat-input-area">';
  html += '<textarea class="chat-input" id="chat-input" rows="1" placeholder="Ask Larry anything..." onkeydown="handleChatKey(event)" oninput="autoResizeChat(this)"></textarea>';
  html += '<button class="chat-send-btn" onclick="sendChatMessage()" id="chat-send">\u27A4</button></div></div>';
  container.innerHTML = html;
  setTimeout(function() { LarryChat.renderChatMessages(); }, 10);
  setupChatKeyboard();
}

function handleChatKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }
function sendChatMessage() {
  var input = document.getElementById('chat-input');
  if (!input) return;
  var msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  autoResizeChat(input);
  LarryChat.sendMessage(msg);
}
function autoResizeChat(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }

function setupChatKeyboard() {
  var chatInput = document.getElementById('chat-input');
  if (!chatInput) return;
  if (window.visualViewport) {
    var chatContainer = document.querySelector('.chat-container');
    window.visualViewport.addEventListener('resize', function() {
      if (chatContainer) chatContainer.style.height = window.visualViewport.height + 'px';
    });
  }
  chatInput.addEventListener('focus', function() {
    setTimeout(function() { var msgs = document.getElementById('chat-messages'); if (msgs) msgs.scrollTop = msgs.scrollHeight; }, 300);
  });
}


// ========== TAB 5: LEAGUE ==========
function renderLeague(container) {
  if (S.leagueSubPage) { renderLeagueSubPage(container); return; }
  var html = '<div class="tab-header"><h2>League</h2></div>';
  html += '<div class="league-menu">';
  LEAGUE_MENU.forEach(function(item) {
    var badge = '';
    if (item.id === 'notifications') {
      var unread = S.notifications.filter(function(n) { return !n.read; }).length;
      if (unread) badge = '<span class="menu-badge">' + unread + '</span>';
    }
    html += '<button class="menu-item" onclick="openLeagueSub(\'' + item.id + '\')">';
    html += '<span class="menu-icon">' + item.icon + '</span><span class="menu-label">' + item.label + '</span>' + badge;
    html += '<span class="menu-arrow">\u203A</span></button>';
  });
  html += '</div>';

  // Standings
  html += '<div class="card standings-card"><div class="card-header">Standings</div>';
  html += renderStandings();
  html += '</div>';
  container.innerHTML = html;
}

function renderStandings() {
  var teams = S.teams.slice().sort(function(a, b) {
    return (b.record.wins / Math.max(b.record.wins + b.record.losses + b.record.ties, 1)) - (a.record.wins / Math.max(a.record.wins + a.record.losses + a.record.ties, 1));
  });
  var html = '<div class="table-scroll"><table class="data-table compact"><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>T</th><th>%</th></tr></thead><tbody>';
  teams.forEach(function(t, i) {
    var isMe = t.teamId === S.myTeam.teamId;
    html += '<tr class="' + (isMe ? 'my-team-row' : '') + '">';
    html += '<td>' + (i + 1) + '</td><td>' + esc(t.name) + (isMe ? ' \u2B50' : '') + '</td>';
    html += '<td>' + t.record.wins + '</td><td>' + t.record.losses + '</td><td>' + t.record.ties + '</td>';
    html += '<td>' + fmt(t.record.wins / Math.max(t.record.wins + t.record.losses + t.record.ties, 1) * 100, 1) + '</td></tr>';
    if (i === S.league.playoffTeams - 1 && i < teams.length - 1) html += '<tr class="playoff-line"><td colspan="6"><hr class="playoff-divider"></td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}


// ========== LEAGUE SUB-PAGES ==========
function renderLeagueSubPage(container) {
  var html = '<div class="sub-page-header">';
  html += '<button class="btn btn-back" onclick="backToLeagueMenu()">\u2190 League</button>';
  var menuItem = LEAGUE_MENU.find(function(m) { return m.id === S.leagueSubPage; });
  html += '<h2>' + (menuItem ? menuItem.icon + ' ' + menuItem.label : '') + '</h2></div>';

  try {
    switch (S.leagueSubPage) {
      case 'dashboard': html += renderDashboard(); break;
      case 'trades': html += renderTradeCenter(); break;
      case 'teamAnalyzer': html += renderTeamAnalyzer(); break;
      case 'statsTrends': html += renderStatsTrends(); break;
      case 'projectedStandings': html += renderProjectedStandings(); break;
      case 'projections': html += renderROSProjections(); break;
      case 'opponentScout': html += renderOpponentScout(); break;
      case 'news': html += renderNewsInjuries(); break;
      case 'schedule': html += renderSchedulePage(); break;
      case 'draftCenter': html += renderDraftCenter(); break;
      case 'playoffs': html += renderPlayoffProjector(); break;
      case 'timeline': html += renderTimeline(); break;
      case 'notifications': html += renderNotifications(); break;
      case 'settings': html += renderSettings(); break;
      default: html += '<p class="muted">Coming soon.</p>';
    }
  } catch (e) {
    html += '<div class="error-card"><h3>Error loading ' + esc(S.leagueSubPage || 'page') + '</h3><p>' + esc(e.message) + '</p><pre>' + (e.stack || '').substring(0, 300) + '</pre><button class="btn btn-primary" onclick="backToLeagueMenu()">Back</button></div>';
  }
  container.innerHTML = html;
}

// --- DASHBOARD ---
function renderDashboard() {
  var cats = S.league.categories;
  var html = '';
  html += '<div class="card"><div class="card-header">Matchup vs ' + esc(S.matchup.opponentName) + '</div>';
  html += '<div class="quick-matchup"><span class="matchup-record-big">' + S.matchup.myRecord.wins + '-' + S.matchup.myRecord.losses + '-' + S.matchup.myRecord.ties + '</span></div>';
  var winning = [], losing = [], close = [];
  cats.forEach(function(cat) {
    var my = S.matchup.myScores[cat.abbr] || 0, opp = S.matchup.oppScores[cat.abbr] || 0;
    var w = cat.isNegative ? (my < opp) : (my > opp);
    if (my === opp) close.push(cat.abbr); else if (w) winning.push(cat.abbr); else losing.push(cat.abbr);
  });
  if (winning.length) html += '<p class="dash-winning">\u2705 Winning: ' + winning.join(', ') + '</p>';
  if (losing.length) html += '<p class="dash-losing">\u274C Losing: ' + losing.join(', ') + '</p>';
  if (close.length) html += '<p class="dash-close">\u2796 Tied: ' + close.join(', ') + '</p>';
  html += '</div>';

  var playing = S.myTeam.players.filter(function(p) { return p.gamesToday; });
  html += '<div class="card"><div class="card-header">Today (' + playing.length + ' games)</div>';
  if (playing.length) {
    html += '<div class="mini-table">';
    playing.forEach(function(p) {
      html += '<div class="mini-row">' + statusBadge(p.status) + ' ' + esc(p.name) + ' <span class="muted">' + (p.gameToday ? ((p.gameToday.home ? 'vs' : '@') + ' ' + (p.gameToday.opponent || '')) : '') + '</span></div>';
    });
    html += '</div>';
  } else html += '<p class="muted">No games today.</p>';
  html += '</div>';

  // Alerts
  var alerts = [];
  S.myTeam.players.forEach(function(p) {
    var streak = Engines.detectStreaks(p);
    if (streak.trend === 'hot') alerts.push('\u{1F525} ' + p.name + ': ' + streak.label);
    if (streak.trend === 'cold') alerts.push('\u{1F9CA} ' + p.name + ': ' + streak.label);
    if (p.status === 'OUT' || p.status === 'GTD') alerts.push('\u{1FA79} ' + p.name + ': ' + p.status);
  });
  if (alerts.length) {
    html += '<div class="card"><div class="card-header">Alerts</div>';
    alerts.forEach(function(a) { html += '<div class="alert">' + esc(a) + '</div>'; });
    html += '</div>';
  }
  return html;
}

// --- TRADE CENTER (ENHANCED) ---
var tradeSubTab = 'analyzer';
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

  // Give side - my team
  html += '<div class="trade-side"><h4>You Give</h4><div class="trade-player-list">';
  S.myTeam.players.forEach(function(p) {
    var selected = tradeState.givePlayers.includes(p.id);
    html += '<div class="trade-player-option ' + (selected ? 'selected' : '') + '" onclick="toggleTradePlayer(\'give\',' + p.id + ')">';
    html += esc(p.name) + ' <span class="muted">z:' + fmt(p.zScores ? p.zScores.total : 0, 2) + '</span></div>';
  });
  html += '</div></div>';

  // Get side - select team
  html += '<div class="trade-side"><h4>You Get</h4>';
  html += '<select class="form-input" onchange="tradeState.getTeam=parseInt(this.value);tradeState.getPlayers=[];render()"><option value="0">Select team...</option>';
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
      html += esc(p.name) + ' <span class="muted">z:' + fmt(p.zScores ? p.zScores.total : 0, 2) + '</span></div>';
    });
    html += '</div>';
  }
  html += '</div></div>';

  // Results
  if (tradeState.givePlayers.length && tradeState.getPlayers.length) {
    var give = tradeState.givePlayers.map(function(id) { return S.allPlayers.find(function(p) { return p.id === id; }); }).filter(Boolean);
    var get = tradeState.getPlayers.map(function(id) { return S.allPlayers.find(function(p) { return p.id === id; }); }).filter(Boolean);
    var result = Engines.evaluateTrade(give, get, { myTeamId: S.myTeam.teamId });

    html += '<div class="trade-result">';
    html += '<div class="trade-grade grade-' + result.grade.charAt(0).toLowerCase() + '">' + result.grade + '</div>';
    html += '<p class="trade-fairness">' + result.fairness + '</p>';
    html += '<p class="muted">Acceptance: ' + result.acceptProbability + '</p>';

    // Category impact with rank shift
    html += '<div class="table-scroll"><table class="data-table compact"><thead><tr><th>Cat</th><th>Before</th><th>After</th><th>Impact</th>';
    if (result.rankShift && Object.keys(result.rankShift).length) html += '<th>Rank</th>';
    html += '</tr></thead><tbody>';
    S.league.categories.forEach(function(cat) {
      var imp = result.catImpact[cat.abbr];
      if (!imp) return;
      var cls = imp.diff > 0.1 ? 'stat-positive' : (imp.diff < -0.1 ? 'stat-negative' : '');
      html += '<tr><td style="color:' + cat.color + '">' + cat.abbr + '</td>';
      html += '<td>' + fmt(imp.before, 2) + '</td><td>' + fmt(imp.after, 2) + '</td>';
      html += '<td class="' + cls + '">' + (imp.diff >= 0 ? '+' : '') + fmt(imp.diff, 2) + '</td>';
      if (result.rankShift && result.rankShift[cat.abbr]) {
        var rs = result.rankShift[cat.abbr];
        var rankCls = rs.after < rs.before ? 'stat-positive' : (rs.after > rs.before ? 'stat-negative' : '');
        html += '<td class="' + rankCls + '">#' + rs.before + ' \u2192 #' + rs.after + '</td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    if (result.catsHelped.length) html += '<p class="stat-positive">\u2705 Helps: ' + result.catsHelped.join(', ') + '</p>';
    if (result.catsHurt.length) html += '<p class="stat-negative">\u274C Hurts: ' + result.catsHurt.join(', ') + '</p>';

    // Positional impact
    if (result.positionalIssue) {
      html += '<div class="trade-warning">\u26A0 Positional: ' + result.positionalIssue.join(', ') + '</div>';
    }

    // Punt alignment
    if (result.puntAlignment) {
      html += '<div class="trade-punt ' + (result.puntAlignment.aligned ? 'aligned' : 'misaligned') + '">';
      html += (result.puntAlignment.aligned ? '\u2705' : '\u26A0') + ' ' + result.puntAlignment.msg;
      html += '</div>';
    }

    html += '</div>';
  }
  return html;
}

function toggleTradePlayer(side, playerId) {
  var arr = side === 'give' ? tradeState.givePlayers : tradeState.getPlayers;
  var idx = arr.indexOf(playerId);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(playerId);
  render();
}

function renderTradeFinder() {
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');
  var weakCats = [];
  S.league.categories.forEach(function(cat) {
    if (getTeamCategoryRank(S.myTeam, cat.abbr) > Math.ceil(S.league.teamCount * 0.5)) weakCats.push(cat.abbr);
  });
  var suggestions = Engines.findTrades(weakCats);
  if (!suggestions.length) return '<p class="muted">No trade suggestions. Sync data first.</p>';
  var html = '<p class="muted">Targeting: ' + (weakCats.length ? weakCats.join(', ') : 'all') + '</p>';
  suggestions.slice(0, 10).forEach(function(s) {
    html += '<div class="trade-suggestion"><div class="trade-suggestion-header">';
    html += '<span class="trade-grade grade-' + s.result.grade.charAt(0).toLowerCase() + '">' + s.result.grade + '</span>';
    html += '<span>' + esc(s.team.name) + '</span></div><div class="trade-suggestion-body">';
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
  var targets = [];
  S.teams.forEach(function(team) {
    if (team.teamId === S.myTeam.teamId) return;
    team.players.forEach(function(p) { if (p.zScores && p.zScores.total > 1) targets.push({ player: p, team: team }); });
  });
  targets.sort(function(a, b) { return (b.player.zScores.total || 0) - (a.player.zScores.total || 0); });
  var html = '<div class="table-scroll"><table class="data-table compact"><thead><tr><th>Player</th><th>Owner</th><th>Z</th>';
  cats.forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
  html += '</tr></thead><tbody>';
  targets.slice(0, 20).forEach(function(t) {
    html += '<tr onclick="openPlayerPopup(' + t.player.id + ')"><td>' + esc(t.player.name) + '</td><td class="muted">' + esc(t.team.abbrev) + '</td>';
    html += '<td>' + fmt(t.player.zScores.total, 2) + '</td>';
    cats.forEach(function(cat) { html += '<td>' + (t.player.stats.season ? fmt(t.player.stats.season[cat.abbr], 1) : '-') + '</td>'; });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function renderTradeWindows() {
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');
  var sellHigh = [], buyLow = [];
  S.allPlayers.forEach(function(p) {
    if (!p.stats.season || !p.stats.last7 || p.onTeamId === 0) return;
    var streak = Engines.detectStreaks(p);
    if (streak.trend === 'hot') sellHigh.push({ player: p, streak: streak });
    if (streak.trend === 'cold') buyLow.push({ player: p, streak: streak });
  });
  var html = '<h3>Sell High \u{1F4C8}</h3><p class="muted">Overperforming -- perceived value peaking.</p>';
  sellHigh.slice(0, 10).forEach(function(s) {
    var isMyPlayer = s.player.onTeamId === S.myTeam.teamId;
    html += '<div class="window-item sell-high' + (isMyPlayer ? ' my-player' : '') + '"><strong>' + esc(s.player.name) + '</strong>' + (isMyPlayer ? ' (yours)' : '') + '<div class="muted">' + s.streak.label + '</div></div>';
  });
  if (!sellHigh.length) html += '<p class="muted">None detected.</p>';

  html += '<h3>Buy Low \u{1F4C9}</h3><p class="muted">Underperforming -- acquire cheaply.</p>';
  buyLow.slice(0, 10).forEach(function(s) {
    var owner = S.teams.find(function(t) { return t.teamId === s.player.onTeamId; });
    html += '<div class="window-item buy-low"><strong>' + esc(s.player.name) + '</strong>';
    if (owner) html += ' <span class="muted">(' + esc(owner.abbrev) + ')</span>';
    html += '<div class="muted">' + s.streak.label + '</div></div>';
  });
  if (!buyLow.length) html += '<p class="muted">None detected.</p>';
  return html;
}

// --- TEAM ANALYZER ---
function renderTeamAnalyzer() {
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');
  var cats = S.league.categories;
  var html = '';

  // Category rankings
  html += '<div class="card"><div class="card-header">Your Category Rankings</div><div class="cat-ranks">';
  cats.forEach(function(cat) {
    var rank = getTeamCategoryRank(S.myTeam, cat.abbr);
    var cls = rank <= 3 ? 'rank-top' : (rank >= S.league.teamCount - 2 ? 'rank-bottom' : 'rank-mid');
    html += '<div class="cat-rank-item ' + cls + '"><span class="cat-rank-name" style="color:' + cat.color + '">' + cat.abbr + '</span><span class="cat-rank-num">#' + rank + '</span></div>';
  });
  html += '</div></div>';

  // Radar chart for team shape
  var teamProfile = {};
  cats.forEach(function(cat) {
    teamProfile[cat.abbr] = { rank: getTeamCategoryRank(S.myTeam, cat.abbr) };
  });
  html += '<div class="card"><div class="card-header">Team Shape</div>';
  html += buildRadarChart(cats, teamProfile);
  html += '</div>';

  // Roster construction audit
  var audit = Engines.rosterConstructionAudit(S.myTeam.players);
  if (audit.issues.length) {
    html += '<div class="card"><div class="card-header">\u{1F6A8} Roster Construction</div>';
    audit.issues.forEach(function(issue) {
      html += '<div class="alert alert-info">' + esc(issue.msg) + '</div>';
    });
    html += '</div>';
  }

  // Punt analysis
  var puntResults = Engines.puntStrategyAnalysis();
  html += '<div class="card"><div class="card-header">Punt Strategy Advisor</div>';
  puntResults.forEach(function(p) {
    html += '<div class="punt-item ' + (p.viable ? 'punt-viable' : 'punt-weak') + '"><span style="color:' + catColor(p.puntCat) + '">Punt ' + p.puntCat + '</span>';
    html += '<span>Win rate: ' + fmt(p.winRate * 100, 1) + '%</span>' + (p.viable ? ' \u2705' : '') + '</div>';
  });
  html += '</div>';

  // Who beats me
  var wbm = Engines.whoBeatsMe();
  html += '<div class="card"><div class="card-header">Matchup Difficulty</div>';
  html += '<div class="table-scroll"><table class="data-table compact"><thead><tr><th>Team</th><th>W</th><th>L</th><th>Diff</th></tr></thead><tbody>';
  wbm.forEach(function(m) {
    html += '<tr><td>' + esc(m.team.name) + '</td><td>' + m.wins + '</td><td>' + m.losses + '</td>';
    html += '<td class="' + (m.diff > 0 ? 'stat-positive' : (m.diff < 0 ? 'stat-negative' : '')) + '">' + (m.diff > 0 ? '+' : '') + m.diff + '</td></tr>';
  });
  html += '</tbody></table></div></div>';

  return html;
}

// --- STATS & TRENDS ---
function renderStatsTrends() {
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');
  var cats = S.league.categories;
  var html = '';

  var top50 = S.allPlayers.slice().sort(function(a, b) { return (b.zScores ? b.zScores.total : 0) - (a.zScores ? a.zScores.total : 0); }).slice(0, 50);
  html += '<div class="card"><div class="card-header" onclick="toggleSection(\'top50\')">Top 50 ' + (isSectionCollapsed('top50') ? '\u25B6' : '\u25BC') + '</div>';
  if (!isSectionCollapsed('top50')) {
    html += '<div class="table-scroll"><table class="data-table compact"><thead><tr><th>#</th><th>Player</th><th>Team</th>';
    cats.forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
    html += '<th>Z</th></tr></thead><tbody>';
    top50.forEach(function(p, i) {
      html += '<tr onclick="openPlayerPopup(' + p.id + ')"><td>' + (i + 1) + '</td><td>' + esc(p.name) + '</td><td>' + p.nbaTeam + '</td>';
      cats.forEach(function(cat) { html += '<td>' + (p.stats.season ? fmt(p.stats.season[cat.abbr], 1) : '-') + '</td>'; });
      html += '<td>' + fmt(p.zScores.total, 2) + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div>';

  // Risers and fallers
  var trending = S.allPlayers.filter(function(p) { return p.stats.season && p.stats.last7; });
  trending.forEach(function(p) {
    p._trendScore = 0;
    cats.forEach(function(cat) {
      var s = p.stats.season[cat.abbr] || 0, r = p.stats.last7[cat.abbr] || 0;
      if (s !== 0) { var ch = (r - s) / Math.abs(s); if (cat.isNegative) ch = -ch; p._trendScore += ch; }
    });
  });
  var risers = trending.slice().sort(function(a, b) { return b._trendScore - a._trendScore; }).slice(0, 10);
  var fallers = trending.slice().sort(function(a, b) { return a._trendScore - b._trendScore; }).slice(0, 10);

  html += '<div class="card"><div class="card-header">Biggest Risers \u{1F4C8}</div><div class="mini-table">';
  risers.forEach(function(p) { html += '<div class="mini-row" onclick="openPlayerPopup(' + p.id + ')">' + esc(p.name) + ' <span class="stat-positive">+' + fmt(p._trendScore * 100, 0) + '%</span></div>'; });
  html += '</div></div>';

  html += '<div class="card"><div class="card-header">Biggest Fallers \u{1F4C9}</div><div class="mini-table">';
  fallers.forEach(function(p) { html += '<div class="mini-row" onclick="openPlayerPopup(' + p.id + ')">' + esc(p.name) + ' <span class="stat-negative">' + fmt(p._trendScore * 100, 0) + '%</span></div>'; });
  html += '</div></div>';

  return html;
}

// --- PROJECTED STANDINGS (NEW) ---
function renderProjectedStandings() {
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');
  var standings = Engines.projectedStandings();
  if (!standings.length) return '<p class="muted">Not enough data yet.</p>';

  var html = '<div class="card"><div class="card-header">Projected Final Standings</div>';
  html += '<p class="muted">Blends current record (60%) with team roster strength (40%).</p>';
  html += '<div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Team</th><th>Current</th><th>Proj W</th><th>Proj L</th><th>Strength</th></tr></thead><tbody>';
  standings.forEach(function(s, i) {
    var cls = s.isMe ? 'my-team-row' : '';
    html += '<tr class="' + cls + '"><td>' + (i + 1) + '</td>';
    html += '<td>' + esc(s.team.name) + (s.isMe ? ' \u2B50' : '') + '</td>';
    html += '<td>' + s.currentRecord.wins + '-' + s.currentRecord.losses + '</td>';
    html += '<td>' + s.projectedWins + '</td><td>' + s.projectedLosses + '</td>';
    html += '<td>' + fmt(s.teamStrength, 1) + '</td></tr>';
    if (i === S.league.playoffTeams - 1) html += '<tr class="playoff-line"><td colspan="6"><hr class="playoff-divider"></td></tr>';
  });
  html += '</tbody></table></div></div>';
  return html;
}

// --- ROS PROJECTIONS (NEW) ---
function renderROSProjections() {
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');
  var cats = S.league.categories;
  var players = S.myTeam.players.filter(function(p) { return p.slotId !== 13; });

  var html = '<div class="card"><div class="card-header">Rest-of-Season Projections</div>';
  html += '<p class="muted">Projected totals for remaining games based on current averages.</p>';
  html += '<div class="table-scroll"><table class="data-table"><thead><tr><th>Player</th><th>GP Left</th>';
  cats.forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
  html += '<th>Z</th></tr></thead><tbody>';

  var totals = {};
  cats.forEach(function(cat) { totals[cat.abbr] = 0; });

  players.forEach(function(p) {
    var gr = p.gamesRemainingROS || p.gamesRemaining || 0;
    html += '<tr onclick="openPlayerPopup(' + p.id + ')"><td>' + esc(p.name) + '</td><td>' + gr + '</td>';
    cats.forEach(function(cat) {
      var avg = p.stats.season ? (p.stats.season[cat.abbr] || 0) : 0;
      var proj = cat.isPercent ? avg : avg * gr;
      if (!cat.isPercent) totals[cat.abbr] += proj;
      html += '<td>' + (cat.isPercent ? pct(avg) : fmt(proj, 0)) + '</td>';
    });
    html += '<td>' + fmt(p.zScores ? p.zScores.total : 0, 2) + '</td></tr>';
  });

  html += '<tr class="totals-row"><td><strong>Team Total</strong></td><td></td>';
  cats.forEach(function(cat) { html += '<td><strong>' + (cat.isPercent ? '-' : fmt(totals[cat.abbr], 0)) + '</strong></td>'; });
  html += '<td></td></tr>';
  html += '</tbody></table></div></div>';
  return html;
}

// --- OPPONENT SCOUTING REPORT (NEW) ---
var scoutTeamId = 0;
function renderOpponentScout() {
  var html = '<select class="form-input" onchange="scoutTeamId=parseInt(this.value);render()" style="margin-bottom:12px">';
  html += '<option value="0">Select team to scout...</option>';

  // Default to current opponent
  var defaultTeam = scoutTeamId || S.matchup.opponentTeamId || 0;
  S.teams.forEach(function(t) {
    if (t.teamId === S.myTeam.teamId) return;
    var selected = t.teamId === defaultTeam ? ' selected' : '';
    html += '<option value="' + t.teamId + '"' + selected + '>' + esc(t.name) + '</option>';
  });
  html += '</select>';

  var teamId = scoutTeamId || S.matchup.opponentTeamId || 0;
  if (!teamId) return html + '<p class="muted">Select a team to view their scouting report.</p>';

  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');
  var report = Engines.opponentScoutingReport(teamId);
  if (!report) return html + '<p class="muted">Team not found.</p>';

  var cats = S.league.categories;

  // H2H
  html += '<div class="card"><div class="card-header">H2H vs ' + esc(report.team.name) + '</div>';
  html += '<div class="quick-matchup"><span class="matchup-record-big">' + report.h2h.wins + '-' + report.h2h.losses + '-' + Math.max(0, cats.length - report.h2h.wins - report.h2h.losses) + '</span></div>';
  html += '<p class="muted">' + report.team.record.wins + '-' + report.team.record.losses + '-' + report.team.record.ties + ' overall</p>';
  html += '</div>';

  // Strengths & Weaknesses
  html += '<div class="card"><div class="card-header">Category Profile</div>';
  html += '<div class="cat-ranks">';
  cats.forEach(function(cat) {
    var rank = report.catRanks[cat.abbr];
    var cls = rank <= 3 ? 'rank-top' : (rank >= S.league.teamCount - 2 ? 'rank-bottom' : 'rank-mid');
    html += '<div class="cat-rank-item ' + cls + '"><span style="color:' + cat.color + '">' + cat.abbr + '</span><span>#' + rank + '</span></div>';
  });
  html += '</div>';
  html += '<p class="stat-positive">Strong: ' + report.strongCats.join(', ') + '</p>';
  html += '<p class="stat-negative">Weak: ' + report.weakCats.join(', ') + '</p>';
  html += '</div>';

  // Top players
  html += '<div class="card"><div class="card-header">Key Players</div><div class="mini-table">';
  report.topPlayers.forEach(function(p) {
    html += '<div class="mini-row" onclick="openPlayerPopup(' + p.id + ')">' + statusBadge(p.status) + ' <strong>' + esc(p.name) + '</strong> <span class="muted">z: ' + fmt(p.zScores.total, 2) + '</span></div>';
  });
  html += '</div></div>';

  // Injuries
  if (report.injured.length) {
    html += '<div class="card"><div class="card-header">Injured (' + report.injured.length + ')</div>';
    report.injured.forEach(function(p) {
      html += '<div class="injury-row">' + statusBadge(p.status) + ' ' + esc(p.name) + ' - ' + esc(p.status) + '</div>';
    });
    html += '</div>';
  }

  return html;
}

// --- NEWS & INJURIES ---
function renderNewsInjuries() {
  var injured = S.allPlayers.filter(function(p) { return p.status && p.status !== 'ACTIVE' && p.status !== 'HEALTHY'; });
  injured.sort(function(a, b) { return ({ OUT: 0, SUSPENSION: 1, GTD: 2, DAY_TO_DAY: 3 }[a.status] || 4) - ({ OUT: 0, SUSPENSION: 1, GTD: 2, DAY_TO_DAY: 3 }[b.status] || 4); });
  var myInjured = injured.filter(function(p) { return p.onTeamId === S.myTeam.teamId; });
  var html = '';
  if (myInjured.length) {
    html += '<div class="card"><div class="card-header">Your Injured Players</div>';
    myInjured.forEach(function(p) {
      html += '<div class="injury-row" onclick="openPlayerPopup(' + p.id + ')">' + statusBadge(p.status) + ' <strong>' + esc(p.name) + '</strong> - ' + esc(p.status);
      if (p.injuryNote) html += ' <span class="muted">(' + esc(p.injuryNote) + ')</span>';
      html += '</div>';
    });
    html += '</div>';
  }
  html += '<div class="card"><div class="card-header">League Injuries (' + injured.length + ')</div>';
  html += '<div class="table-scroll"><table class="data-table compact"><thead><tr><th>Player</th><th>Team</th><th>Status</th><th>Owner</th></tr></thead><tbody>';
  injured.slice(0, 50).forEach(function(p) {
    var owner = S.teams.find(function(t) { return t.teamId === p.onTeamId; });
    html += '<tr onclick="openPlayerPopup(' + p.id + ')"><td>' + statusBadge(p.status) + ' ' + esc(p.name) + '</td><td>' + p.nbaTeam + '</td><td>' + esc(p.status) + '</td><td>' + (owner ? esc(owner.abbrev) : 'FA') + '</td></tr>';
  });
  html += '</tbody></table></div></div>';
  return html;
}

// --- SCHEDULE PAGE (BBM-STYLE GRID) ---
function renderSchedulePage() {
  var players = S.myTeam.players.filter(function(p) { return p.slotId !== 13; });
  var heatmap = Engines.scheduleHeatMap(players, 14);
  var html = '<div class="card"><div class="card-header">Schedule Grid (14 days)</div>';

  // BBM-style grid: players as rows, dates as columns
  html += '<div class="table-scroll"><table class="data-table schedule-grid-table"><thead><tr><th>Player</th>';
  heatmap.forEach(function(day) {
    html += '<th class="sched-col' + (day.isToday ? ' today' : '') + '">' + day.dayName + '<br><span class="text-xs">' + day.date.substring(5) + '</span></th>';
  });
  html += '<th>Total</th></tr></thead><tbody>';

  players.forEach(function(p) {
    var total = 0;
    html += '<tr><td class="player-cell" onclick="openPlayerPopup(' + p.id + ')">' + statusBadge(p.status) + ' ' + esc(p.name.split(' ').pop()) + '</td>';
    heatmap.forEach(function(day) {
      var hasGame = p.schedule && p.schedule.some(function(g) { return g.date === day.date; });
      if (hasGame) total++;
      html += '<td class="sched-cell ' + (hasGame ? 'has-game' : 'no-game') + '">' + (hasGame ? '\u{1F3C0}' : '') + '</td>';
    });
    html += '<td><strong>' + total + '</strong></td></tr>';
  });

  // Totals row
  html += '<tr class="totals-row"><td><strong>Total</strong></td>';
  heatmap.forEach(function(day) {
    var stacked = day.count > S.league.startingSlots;
    html += '<td class="' + (stacked ? 'stacked' : '') + '"><strong>' + day.count + '</strong>' + (stacked ? ' \u26A0' : '') + '</td>';
  });
  html += '<td></td></tr>';
  html += '</tbody></table></div></div>';

  // B2B alerts
  var b2b = Engines.backToBackDetection(players);
  if (b2b.length) {
    html += '<div class="card"><div class="card-header">Back-to-Back Alerts</div>';
    b2b.forEach(function(a) { html += '<div class="alert alert-info">' + esc(a.player.name) + ': B2B ' + a.date1 + ' / ' + a.date2 + ' (Risk: ' + a.risk + ')</div>'; });
    html += '</div>';
  }
  return html;
}

// --- DRAFT CENTER (NEW) ---
var draftSubTab = 'rankings';
function renderDraftCenter() {
  var html = '<div class="sub-tab-bar">';
  ['rankings','tracker','analysis'].forEach(function(t) {
    var label = { rankings: 'Rankings', tracker: 'Tracker', analysis: 'Post-Draft' }[t];
    html += '<button class="sub-tab' + (draftSubTab === t ? ' active' : '') + '" onclick="draftSubTab=\'' + t + '\';render()">' + label + '</button>';
  });
  html += '</div>';
  if (draftSubTab === 'rankings') html += renderDraftRankings();
  else if (draftSubTab === 'tracker') html += renderDraftTracker();
  else html += renderPostDraftAnalysis();
  return html;
}

function renderDraftRankings() {
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');
  var cats = S.league.categories;

  // Punt selector
  var html = '<div class="card"><div class="card-header">Punt Categories (optional)</div><div class="filter-chips">';
  cats.forEach(function(cat) {
    var active = S.draft.puntCats.includes(cat.abbr);
    html += '<button class="chip' + (active ? ' active' : '') + '" onclick="toggleDraftPunt(\'' + cat.abbr + '\')" style="border-color:' + cat.color + '">' + cat.abbr + '</button>';
  });
  html += '</div></div>';

  var rankings = Engines.generateDraftRankings(S.draft.puntCats.length ? S.draft.puntCats : null);
  html += '<div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Tier</th><th>Player</th><th>Pos</th><th>Team</th>';
  cats.forEach(function(cat) {
    if (S.draft.puntCats.includes(cat.abbr)) return;
    html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>';
  });
  html += '<th>Value</th></tr></thead><tbody>';

  rankings.slice(0, 150).forEach(function(p) {
    var drafted = S.draft.draftedIds.includes(p.id);
    html += '<tr class="' + (drafted ? 'drafted-player' : '') + ' tier-' + p.draftTier + '" onclick="openPlayerPopup(' + p.id + ')">';
    html += '<td>' + p.draftRank + '</td><td class="tier-badge tier-' + p.draftTier + '">T' + p.draftTier + '</td>';
    html += '<td>' + esc(p.name) + (drafted ? ' \u2713' : '') + '</td><td>' + p.positions.join('/') + '</td><td>' + p.nbaTeam + '</td>';
    cats.forEach(function(cat) {
      if (S.draft.puntCats.includes(cat.abbr)) return;
      html += '<td>' + (p.stats.season ? fmt(p.stats.season[cat.abbr], 1) : '-') + '</td>';
    });
    html += '<td><strong>' + fmt(p.draftValue, 2) + '</strong></td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function toggleDraftPunt(catAbbr) {
  var idx = S.draft.puntCats.indexOf(catAbbr);
  if (idx >= 0) S.draft.puntCats.splice(idx, 1);
  else S.draft.puntCats.push(catAbbr);
  autosave();
  render();
}

function renderDraftTracker() {
  var html = '<div class="card"><div class="card-header">Draft Tracker</div>';
  html += '<p class="muted">Tap players in Rankings to mark as drafted. Track picks here.</p>';
  html += '<p>Drafted: <strong>' + S.draft.draftedIds.length + '</strong> players</p>';
  if (S.draft.draftedIds.length) {
    html += '<button class="btn btn-sm btn-danger" onclick="if(confirm(\'Clear all draft picks?\')){S.draft.draftedIds=[];S.draft.picks=[];autosave();render();}">Reset Draft</button>';
  }
  html += '</div>';
  return html;
}

// --- RADAR / SPIDER CHART (SVG) ---
function buildRadarChart(cats, catProfile) {
  var n = cats.length;
  if (n < 3) return '<p class="muted">Need at least 3 categories for radar chart.</p>';

  var size = 260, cx = size / 2, cy = size / 2, maxR = 100;
  var angleStep = (2 * Math.PI) / n;

  // Convert ranks to 0-1 scale (rank 1 = 1.0, rank = teamCount = 0)
  var tc = S.league.teamCount || 10;
  var values = cats.map(function(cat) {
    var cp = catProfile[cat.abbr];
    return cp ? Math.max(0, (tc - cp.rank) / (tc - 1)) : 0.5;
  });

  function polarX(i, r) { return cx + r * Math.sin(i * angleStep); }
  function polarY(i, r) { return cy - r * Math.cos(i * angleStep); }

  var svg = '<svg viewBox="0 0 ' + size + ' ' + size + '" class="radar-chart">';

  // Grid rings
  [0.25, 0.5, 0.75, 1.0].forEach(function(pct) {
    var r = maxR * pct;
    var pts = [];
    for (var i = 0; i < n; i++) pts.push(polarX(i, r).toFixed(1) + ',' + polarY(i, r).toFixed(1));
    svg += '<polygon points="' + pts.join(' ') + '" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>';
  });

  // Axis lines
  for (var i = 0; i < n; i++) {
    svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + polarX(i, maxR).toFixed(1) + '" y2="' + polarY(i, maxR).toFixed(1) + '" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>';
  }

  // Data polygon
  var dataPts = values.map(function(v, i) {
    return polarX(i, maxR * v).toFixed(1) + ',' + polarY(i, maxR * v).toFixed(1);
  });
  svg += '<polygon points="' + dataPts.join(' ') + '" fill="rgba(59,130,246,0.2)" stroke="var(--accent-blue)" stroke-width="2"/>';

  // Data points + labels
  values.forEach(function(v, i) {
    var px = polarX(i, maxR * v), py = polarY(i, maxR * v);
    svg += '<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="3" fill="var(--accent-blue)"/>';

    // Label position (pushed further out)
    var lx = polarX(i, maxR + 18), ly = polarY(i, maxR + 18);
    var color = cats[i].color || 'var(--text-secondary)';
    var anchor = 'middle';
    if (lx < cx - 10) anchor = 'end';
    else if (lx > cx + 10) anchor = 'start';
    svg += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 4).toFixed(1) + '" text-anchor="' + anchor + '" fill="' + color + '" font-size="10" font-weight="700">' + cats[i].abbr + '</text>';
  });

  svg += '</svg>';
  return '<div class="radar-wrap">' + svg + '</div>';
}

function renderPostDraftAnalysis() {
  if (!S.myTeam.players.length) return '<p class="muted">No roster data. Complete your draft and sync to see analysis.</p>';
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');
  var report = Engines.postDraftReport(S.myTeam.players);
  var cats = S.league.categories;

  var html = '<div class="card"><div class="card-header">Draft Grade: ' + report.overallGrade + '</div>';
  html += '<p class="muted">Avg category rank: ' + fmt(report.avgRank, 1) + '</p>';
  html += '</div>';

  html += '<div class="card"><div class="card-header">Category Grades</div>';
  html += '<div class="cat-ranks">';
  cats.forEach(function(cat) {
    var cp = report.catProfile[cat.abbr];
    var cls = cp.grade === 'A' ? 'rank-top' : (cp.grade === 'D' || cp.grade === 'F' ? 'rank-bottom' : 'rank-mid');
    html += '<div class="cat-rank-item ' + cls + '"><span style="color:' + cat.color + '">' + cat.abbr + '</span><span>' + cp.grade + ' (#' + cp.rank + ')</span></div>';
  });
  html += '</div></div>';

  // Radar/Spider chart
  html += '<div class="card"><div class="card-header">Team Shape</div>';
  html += buildRadarChart(cats, report.catProfile);
  html += '</div>';

  if (report.naturalPunts.length) {
    html += '<div class="card"><div class="card-header">Natural Punts Detected</div>';
    html += '<p>' + report.naturalPunts.join(', ') + ' -- consider building around punting these categories.</p></div>';
  }

  if (report.strengthCats.length) {
    html += '<div class="card"><div class="card-header">Strengths</div><p>' + report.strengthCats.join(', ') + '</p></div>';
  }

  return html;
}

// --- PLAYOFF PROJECTOR ---
function renderPlayoffProjector() {
  var proj = Engines.playoffProjection();
  if (!proj) return '<p class="muted">Not enough data.</p>';
  var html = '<div class="card"><div class="card-header">Playoff Outlook</div><div class="playoff-proj">';
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
  html += '<p class="muted">5,000 iteration Monte Carlo. See Matchup > Projections.</p>';
  html += '<button class="btn btn-primary" onclick="switchTab(1);matchupSubTab=\'projections\';render()">View Projections</button></div>';

  var totw = Engines.teamOfTheWeek();
  html += '<div class="card"><div class="card-header">Team of the Week</div>';
  if (totw.length) {
    html += '<div class="table-scroll"><table class="data-table compact"><thead><tr><th>#</th><th>Team</th><th>Wins vs Field</th></tr></thead><tbody>';
    totw.forEach(function(t, i) {
      html += '<tr class="' + (t.team.teamId === S.myTeam.teamId ? 'my-team-row' : '') + '"><td>' + (i + 1) + '</td><td>' + esc(t.team.name) + '</td><td>' + t.winsVsField + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div>';
  return html;
}

// --- NOTIFICATIONS ---
function renderNotifications() {
  if (!S.notifications.length) return '<div class="empty-state"><p>No notifications yet.</p></div>';
  var html = '<button class="btn btn-secondary btn-sm" onclick="markAllRead()">Mark All Read</button>';
  S.notifications.forEach(function(n) {
    html += '<div class="notification-item ' + (n.read ? '' : 'unread') + '" onclick="markRead(\'' + n.id + '\')">';
    html += '<div class="notif-title">' + esc(n.title) + '</div>';
    html += '<div class="notif-body">' + esc(n.body) + '</div>';
    html += '<div class="notif-time">' + timeSince(n.timestamp) + '</div></div>';
  });
  return html;
}
function markRead(id) { var n = S.notifications.find(function(x) { return x.id === id; }); if (n) n.read = true; autosave(); render(); updateNav(); }
function markAllRead() { S.notifications.forEach(function(n) { n.read = true; }); autosave(); render(); updateNav(); }

// --- SETTINGS (ENHANCED) ---
function renderSettings() {
  var html = '';

  // ESPN connection
  html += '<div class="card"><div class="card-header">ESPN Connection</div>';
  html += '<div class="form-group"><label>League ID</label><input type="text" class="form-input" value="' + esc(S.espn.leagueId) + '" onchange="S.espn.leagueId=this.value;autosave()" /></div>';
  html += '<div class="form-group"><label>espn_s2</label><input type="text" class="form-input" value="' + esc(S.espn.espnS2) + '" onchange="S.espn.espnS2=this.value;autosave()" /></div>';
  html += '<div class="form-group"><label>SWID</label><input type="text" class="form-input" value="' + esc(S.espn.swid) + '" onchange="S.espn.swid=this.value;autosave()" /></div>';
  html += '<span class="' + (S.espn.connected ? 'stat-positive' : 'stat-negative') + '">' + (S.espn.connected ? '\u2705 Connected' : '\u274C Disconnected') + '</span>';
  html += '<div style="margin-top:8px"><button class="btn btn-primary" onclick="ESPNSync.syncAll()">Sync Now</button> ';
  html += '<button class="btn btn-secondary" onclick="testConnection()">Test</button> ';
  html += '<button class="btn btn-secondary" onclick="changeTeam()">Change Team</button></div>';
  html += '</div>';

  // Analysis settings
  html += '<div class="card"><div class="card-header">Analysis Settings</div>';
  html += '<div class="form-group"><label>Recency Weight (0 = season only, 100 = recent only)</label>';
  html += '<input type="range" class="form-input" min="0" max="100" value="' + Math.round((S.prefs.recencyWeight || 0) * 100) + '" onchange="S.prefs.recencyWeight=parseInt(this.value)/100;autosave()" />';
  html += '<span class="muted">' + Math.round((S.prefs.recencyWeight || 0) * 100) + '%</span></div>';
  html += '</div>';

  // Sync settings
  html += '<div class="card"><div class="card-header">Sync</div>';
  html += '<div class="form-group"><label>Auto-refresh (min)</label>';
  html += '<input type="number" class="form-input" value="' + S.espn.syncInterval + '" min="5" max="60" onchange="S.espn.syncInterval=parseInt(this.value);autosave();startAutoSync()" /></div>';
  html += '<div class="form-group"><label>Last sync</label><span>' + (S.espn.lastSync ? timeSince(S.espn.lastSync) : 'Never') + '</span></div>';
  if (S.espn.syncLog.length) {
    html += '<h4>Sync Log</h4>';
    S.espn.syncLog.forEach(function(log) { html += '<div class="sync-log-item ' + log.status + '">' + timeSince(log.timestamp) + ': ' + esc(log.message) + '</div>'; });
  }
  html += '</div>';

  // Data
  html += '<div class="card"><div class="card-header">Data</div>';
  html += '<button class="btn btn-primary" onclick="exportData()">Export Backup</button> ';
  html += '<label class="btn btn-secondary">Import <input type="file" accept=".json" style="display:none" onchange="importData(this.files[0])" /></label></div>';

  // League info
  html += '<div class="card"><div class="card-header">League Info</div>';
  html += '<div class="settings-display">';
  html += '<div class="setting-row"><span>League</span><span>' + esc(S.league.name) + '</span></div>';
  html += '<div class="setting-row"><span>Format</span><span>' + esc(S.league.scoringType) + '</span></div>';
  html += '<div class="setting-row"><span>Teams</span><span>' + S.league.teamCount + '</span></div>';
  html += '<div class="setting-row"><span>Cats</span><span>' + S.league.categories.map(function(c) { return c.abbr; }).join(', ') + '</span></div>';
  html += '<div class="setting-row"><span>Starters</span><span>' + S.league.startingSlots + '</span></div>';
  html += '<div class="setting-row"><span>Version</span><span>' + S.version + '</span></div>';
  html += '</div></div>';

  // Danger zone
  html += '<div class="card card-danger"><div class="card-header">Danger Zone</div>';
  html += '<button class="btn btn-danger" onclick="if(confirm(\'Erase ALL data?\')){localStorage.clear();location.reload();}">Reset Everything</button></div>';

  return html;
}
