// ============================================================
// LARRY v2.3 -- CORE MODULE
// State management, setup flow, navigation, utilities
// ============================================================

var S = null; // Global state
var SAVE_TIMER = null;
var SYNC_TIMER = null;

// --- ESPN MAPPINGS ---
var ESPN_STAT_MAP = {0:'PTS',1:'BLK',2:'STL',3:'AST',6:'REB',17:'3PM',19:'FG%',20:'FT%',11:'TO',37:'DD',39:'TD',40:'OREB',41:'DREB',16:'FGM',13:'FTM',15:'FGA',14:'FTA'};
var ESPN_STAT_REVERSE = {};
Object.keys(ESPN_STAT_MAP).forEach(function(k){ ESPN_STAT_REVERSE[ESPN_STAT_MAP[k]] = parseInt(k); });

var ESPN_SLOT_MAP = {0:'PG',1:'SG',2:'SF',3:'PF',4:'C',5:'G',6:'F',7:'SG/SF',8:'G/F',9:'PF/C',10:'F/C',11:'UTIL',12:'BE',13:'IR'};
var ESPN_SLOT_REVERSE = {};
Object.keys(ESPN_SLOT_MAP).forEach(function(k){ ESPN_SLOT_REVERSE[ESPN_SLOT_MAP[k]] = parseInt(k); });

var ESPN_POS_MAP = {1:'PG',2:'SG',3:'SF',4:'PF',5:'C'};

var ESPN_TEAM_MAP = {1:'ATL',2:'BOS',3:'NOP',4:'CHI',5:'CLE',6:'DAL',7:'DEN',8:'DET',9:'GSW',10:'HOU',11:'IND',12:'LAC',13:'LAL',14:'MIA',15:'MIL',16:'MIN',17:'BKN',18:'NYK',19:'ORL',20:'PHI',21:'PHX',22:'POR',23:'SAC',24:'SAS',25:'OKC',26:'UTA',27:'WAS',28:'TOR',29:'MEM',30:'CHA'};

var DEFAULT_CAT_COLORS = {'PTS':'#3b82f6','REB':'#f97316','AST':'#22c55e','STL':'#a855f7','BLK':'#ef4444','3PM':'#06b6d4','FG%':'#8b5cf6','FT%':'#ec4899','TO':'#f43f5e','DD':'#14b8a6','TD':'#eab308'};

// --- TAB CONFIG ---
var TABS = [
  { id: 'roster', label: 'Roster', icon: '\u{1F4CB}' },
  { id: 'matchup', label: 'Matchup', icon: '\u{1F3C6}' },
  { id: 'players', label: 'Players', icon: '\u{1F465}' },
  { id: 'larry', label: 'Larry', icon: '\u{1F989}' },
  { id: 'league', label: 'League', icon: '\u{1F3C0}' }
];

// --- LEAGUE MENU ITEMS ---
var LEAGUE_MENU = [
  { id: 'dashboard', label: 'Dashboard', icon: '\u{1F4CA}' },
  { id: 'trades', label: 'Trade Center', icon: '\u{1F4E6}' },
  { id: 'teamAnalyzer', label: 'Team Analyzer', icon: '\u{1F50D}' },
  { id: 'statsTrends', label: 'Stats & Trends', icon: '\u{1F4C8}' },
  { id: 'projectedStandings', label: 'Projected Standings', icon: '\u{1F3AF}' },
  { id: 'projections', label: 'ROS Projections', icon: '\u{1F52E}' },
  { id: 'opponentScout', label: 'Opponent Scout', icon: '\u{1F575}\u{FE0F}' },
  { id: 'news', label: 'News & Injuries', icon: '\u{1F4F0}' },
  { id: 'schedule', label: 'Schedule', icon: '\u{1F4C5}' },
  { id: 'draftCenter', label: 'Draft Center', icon: '\u{1F3C6}' },
  { id: 'playoffs', label: 'Playoff Projector', icon: '\u{1F3C5}' },
  { id: 'timeline', label: 'Season Timeline', icon: '\u{23F3}' },
  { id: 'notifications', label: 'Notifications', icon: '\u{1F514}' },
  { id: 'settings', label: 'Settings & Data', icon: '\u{2699}\u{FE0F}' }
];

// --- INITIALIZATION ---
function initState() {
  return {
    version: '2.3.0',
    initialized: false,
    setupComplete: false,
    currentTab: 0,
    leagueSubPage: null,
    lastActivity: new Date().toISOString(),
    espn: {
      leagueId: '', espnS2: '', swid: '', connected: false,
      lastSync: null, syncInterval: 15, autoSync: true,
      syncLog: [], syncMethod: 'proxy'
    },
    league: {
      name: '', seasonId: 2026, segmentId: 0, teamCount: 0,
      scoringType: '', categories: [], rosterSlots: [],
      startingSlots: 0, benchSlots: 0, irSlots: 0,
      acquisitionLimit: -1, matchupPeriodLength: 7,
      playoffTeams: 0, playoffStartMatchup: 0, playoffLength: 0,
      currentMatchupPeriod: 0, currentScoringPeriodId: 0, schedule: []
    },
    myTeam: {
      teamId: 0, name: '', abbrev: '', owner: '',
      record: { wins: 0, losses: 0, ties: 0 },
      pointsFor: 0, pointsAgainst: 0, playoffSeed: 0,
      waiverRank: 0, acquisitionsUsed: 0, acquisitionsTotal: 0,
      players: []
    },
    teams: [],
    matchup: {
      matchupPeriodId: 0, startDate: '', endDate: '',
      myTeamId: 0, opponentTeamId: 0, opponentName: '',
      myScores: {}, oppScores: {},
      myRecord: { wins: 0, losses: 0, ties: 0 },
      daysRemaining: 0, myGamesRemaining: 0, oppGamesRemaining: 0
    },
    allPlayers: [],
    freeAgents: [],
    watchlist: [],
    notifications: [],
    notifBadgeCount: 0,
    prefs: {
      defaultStatView: 'season', chartTheme: 'dark',
      collapsedSections: {}, claudeApiKey: '',
      recencyWeight: 0.3 // 0 = season only, 1 = recent only
    },
    chatHistory: [],
    analysisCache: {
      zScores: null, projections: null, tradeTargets: null,
      puntAnalysis: null, lastComputed: null
    },
    draft: {
      active: false,
      picks: [],
      myPicks: [],
      draftedIds: [],
      puntCats: []
    }
  };
}

function loadState() {
  try {
    var raw = localStorage.getItem('larry_state');
    if (raw) {
      var loaded = JSON.parse(raw);
      S = mergeDeep(initState(), loaded);
      S.version = '2.3.0';
    } else {
      S = initState();
    }
  } catch (e) {
    console.error('State load failed:', e);
    S = initState();
  }
}

function saveState() {
  try {
    S.lastActivity = new Date().toISOString();
    localStorage.setItem('larry_state', JSON.stringify(S));
  } catch (e) {
    console.error('State save failed:', e);
  }
}

function autosave() {
  if (SAVE_TIMER) clearTimeout(SAVE_TIMER);
  SAVE_TIMER = setTimeout(saveState, 400);
}

// --- DEEP MERGE ---
function mergeDeep(target, source) {
  var result = Object.assign({}, target);
  for (var key in source) {
    if (source.hasOwnProperty(key)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        result[key] = mergeDeep(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
  }
  return result;
}

// --- DATA EXPORT / IMPORT ---
function exportData() {
  var blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'larry-backup-' + localDateStr() + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = JSON.parse(e.target.result);
      S = mergeDeep(initState(), data);
      saveState();
      render();
      showToast('Data imported successfully', 'success');
    } catch (err) {
      showToast('Import failed: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

// --- NAVIGATION ---
function switchTab(index) {
  S.currentTab = index;
  S.leagueSubPage = null;
  autosave();
  render();
  updateNav();
  window.scrollTo(0, 0);
}

function openLeagueSub(pageId) {
  S.currentTab = 4; // League tab
  S.leagueSubPage = pageId;
  autosave();
  render();
  updateNav();
}

function backToLeagueMenu() {
  S.leagueSubPage = null;
  render();
}

function updateNav() {
  var nav = document.getElementById('bottom-nav');
  if (!nav) return;
  var btns = nav.querySelectorAll('.nav-tab');
  btns.forEach(function(btn, i) {
    btn.classList.toggle('active', i === S.currentTab);
  });
  var badge = document.getElementById('notif-badge');
  if (badge) {
    var count = S.notifications.filter(function(n) { return !n.read; }).length;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  }
}

function buildNav() {
  var nav = document.getElementById('bottom-nav');
  if (!nav) return;
  var html = '';
  TABS.forEach(function(tab, i) {
    var badge = '';
    if (tab.id === 'league') {
      badge = '<span class="notif-badge" id="notif-badge" style="display:none">0</span>';
    }
    var isLarry = tab.id === 'larry';
    html += '<button class="nav-tab' + (i === S.currentTab ? ' active' : '') + (isLarry ? ' nav-larry' : '') + '" onclick="switchTab(' + i + ')">';
    if (isLarry) {
      html += '<span class="nav-icon larry-glow-wrap">';
      html += '<span class="larry-glow"></span>';
      html += '<img src="assets/larry-logo.svg" class="larry-nav-icon" width="28" height="28" alt="Larry">';
      html += '</span>';
    } else {
      html += '<span class="nav-icon">' + tab.icon + '</span>';
    }
    html += '<span class="nav-label">' + tab.label + '</span>';
    html += badge;
    html += '</button>';
  });
  nav.innerHTML = html;
}

// --- KEYBOARD SHORTCUTS ---
function initKeyboard() {
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key >= '1' && e.key <= '5') {
      e.preventDefault();
      switchTab(parseInt(e.key) - 1);
    } else if (e.key === '/') {
      e.preventDefault();
      openSearch();
    } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      toggleHelp();
    } else if (e.key === 'Escape') {
      closeSearch();
      closePlayerPopup();
    }
  });
}

// --- RENDER SYSTEM ---
function render() {
  var container = document.getElementById('tab-content');
  if (!container) return;

  if (!S.setupComplete) {
    renderSetup(container);
    return;
  }

  if (needsTeamSelection()) {
    renderTeamSelector(container);
    return;
  }

  safeRender(container);
}

function needsTeamSelection() {
  return S.espn.connected && S.teams.length > 0 && S.myTeam.teamId === 0;
}

function safeRender(container) {
  try {
    var renderers = [renderRoster, renderMatchup, renderPlayers, renderLarry, renderLeague];
    if (S.currentTab >= 0 && S.currentTab < renderers.length) {
      renderers[S.currentTab](container);
    }
  } catch (e) {
    container.innerHTML = '<div class="error-card">' +
      '<h3>Something went wrong</h3>' +
      '<p>' + e.message + '</p>' +
      '<pre>' + (e.stack || '').substring(0, 500) + '</pre>' +
      '<p>Tab: ' + S.currentTab + ' | Sub: ' + S.leagueSubPage + '</p>' +
      '<p>TeamId: ' + S.myTeam.teamId + ' | Players: ' + (S.myTeam.players ? S.myTeam.players.length : 0) + ' | Teams: ' + S.teams.length + '</p>' +
      '<button class="btn btn-primary" onclick="render()">Retry</button> ' +
      '<button class="btn btn-secondary" onclick="switchTab(0)">Go to Roster</button> ' +
      '<button class="btn btn-warning" onclick="changeTeam()">Change Team</button> ' +
      '<button class="btn btn-danger" onclick="if(confirm(\'Reset all data?\')){ S=initState(); saveState(); render(); }">Reset App</button>' +
      '</div>';
  }
}

// --- TEAM SELECTOR ---
function renderTeamSelector(container) {
  var html = '<div class="setup-container">';
  html += '<div class="setup-logo">';
  html += '<div class="larry-avatar large">' + getLarryAvatar(80) + '</div>';
  html += '<h1 class="setup-title">Select Your Team</h1>';
  html += '<p class="setup-subtitle">' + esc(S.league.name) + ' &mdash; ' + S.league.teamCount + ' teams</p>';
  html += '</div>';

  html += '<div class="setup-card">';
  html += '<p style="margin-bottom:16px;color:#94a3b8;">Tap your team below.</p>';
  html += '<div class="team-selector-list">';

  S.teams.forEach(function(team) {
    var record = team.record.wins + '-' + team.record.losses + '-' + team.record.ties;
    var playerCount = team.players ? team.players.length : 0;
    html += '<button class="team-selector-item" onclick="selectMyTeam(' + team.teamId + ')">';
    html += '<div class="team-selector-name">' + esc(team.name) + '</div>';
    html += '<div class="team-selector-meta">';
    if (team.owner) html += '<span>' + esc(team.owner) + '</span> &middot; ';
    html += '<span>' + record + '</span>';
    html += ' &middot; <span>' + playerCount + ' players</span>';
    html += '</div>';
    html += '</button>';
  });

  html += '</div>';
  html += '<button class="btn btn-secondary btn-full" onclick="resetSetup()" style="margin-top:16px;">Start Over</button>';
  html += '</div></div>';

  container.innerHTML = html;
}

function selectMyTeam(teamId) {
  if (ESPNSync.selectTeam(teamId)) {
    if (ESPNSync._lastLeagueData) {
      ESPNSync.parseMatchup(ESPNSync._lastLeagueData);
    }
    S.myTeam.owner = (S.teams.find(function(t) { return t.teamId === teamId; }) || {}).owner || '';
    saveState();
    render();
    updateNav();
    showToast('Team selected: ' + S.myTeam.name, 'success');
  } else {
    showToast('Failed to select team. Try syncing again.', 'error');
  }
}

function changeTeam() {
  S.myTeam.teamId = 0;
  S.myTeam.name = '';
  S.myTeam.players = [];
  saveState();
  render();
}

// --- SETUP FLOW ---
function renderSetup(container) {
  var step = S.espn.leagueId ? (S.espn.connected ? 3 : 2) : 1;
  var html = '<div class="setup-container">';
  html += '<div class="setup-logo">';
  html += '<div class="larry-avatar large">' + getLarryAvatar(120) + '</div>';
  html += '<h1 class="setup-title">Meet Larry</h1>';
  html += '<p class="setup-subtitle">Your AI-powered fantasy basketball command center.<br>Named after the Larry O\'Brien Trophy.</p>';
  html += '</div>';

  if (step === 1) {
    html += '<div class="setup-card">';
    html += '<h2>Connect Your ESPN League</h2>';
    html += '<div class="form-group"><label>ESPN League ID</label>';
    html += '<input type="text" class="form-input" id="setup-league-id" placeholder="e.g. 62378" value="' + esc(S.espn.leagueId) + '" />';
    html += '<p class="help-text">Find this in your ESPN league URL: fantasy.espn.com/basketball/league?leagueId=<b>XXXXX</b></p>';
    html += '</div>';
    html += '<div class="form-group"><label>espn_s2 Cookie</label>';
    html += '<input type="text" class="form-input" id="setup-s2" placeholder="Paste espn_s2 value" value="' + esc(S.espn.espnS2) + '" />';
    html += '</div>';
    html += '<div class="form-group"><label>SWID Cookie</label>';
    html += '<input type="text" class="form-input" id="setup-swid" placeholder="Paste SWID value (include braces)" value="' + esc(S.espn.swid) + '" />';
    html += '</div>';
    html += '<div class="how-to-find">';
    html += '<h4>How to find your ESPN cookies:</h4>';
    html += '<ol>';
    html += '<li>Go to <a href="https://fantasy.espn.com" target="_blank">fantasy.espn.com</a> and log in</li>';
    html += '<li>Open browser DevTools: <kbd>F12</kbd> or <kbd>Cmd+Opt+I</kbd> (Mac) / <kbd>Ctrl+Shift+I</kbd> (Windows)</li>';
    html += '<li>Go to <b>Application</b> tab (Chrome) or <b>Storage</b> tab (Firefox)</li>';
    html += '<li>Under <b>Cookies</b>, click <code>https://fantasy.espn.com</code></li>';
    html += '<li>Find <code>espn_s2</code> and copy its <b>Value</b> (long string)</li>';
    html += '<li>Find <code>SWID</code> and copy its <b>Value</b> (format: {GUID})</li>';
    html += '</ol>';
    html += '</div>';
    html += '<button class="btn btn-primary btn-full" onclick="testConnection()">Test Connection</button>';
    html += '<div id="setup-status"></div>';
    html += '</div>';
  } else if (step === 2) {
    html += '<div class="setup-card">';
    html += '<div class="loading">Testing connection...</div>';
    html += '</div>';
  } else if (step === 3) {
    html += '<div class="setup-card">';
    html += '<div class="success-badge">\u2705</div>';
    html += '<h2>Connected!</h2>';
    html += '<div class="setup-confirm">';
    html += '<div class="confirm-row"><span class="confirm-label">League</span><span class="confirm-value">' + esc(S.league.name) + '</span></div>';
    html += '<div class="confirm-row"><span class="confirm-label">Format</span><span class="confirm-value">' + esc(S.league.scoringType) + '</span></div>';
    html += '<div class="confirm-row"><span class="confirm-label">Teams</span><span class="confirm-value">' + S.league.teamCount + '</span></div>';
    html += '<div class="confirm-row"><span class="confirm-label">Categories</span><span class="confirm-value">' + S.league.categories.map(function(c) { return c.abbr; }).join(', ') + '</span></div>';
    if (S.myTeam.teamId > 0) {
      html += '<div class="confirm-row"><span class="confirm-label">Your Team</span><span class="confirm-value">' + esc(S.myTeam.name) + '</span></div>';
    }
    html += '</div>';
    html += '<button class="btn btn-primary btn-full" onclick="completeSetup()">Launch Larry</button>';
    html += '<button class="btn btn-secondary btn-full" onclick="resetSetup()">Start Over</button>';
    html += '</div>';
  }

  html += '</div>';
  container.innerHTML = html;
}

async function testConnection() {
  var leagueId = document.getElementById('setup-league-id').value.trim();
  var s2 = document.getElementById('setup-s2').value.trim();
  var swid = document.getElementById('setup-swid').value.trim();
  var statusEl = document.getElementById('setup-status');

  if (!leagueId || !s2 || !swid) {
    if (statusEl) statusEl.innerHTML = '<p class="error-msg">Please fill in all fields.</p>';
    return;
  }

  S.espn.leagueId = leagueId;
  S.espn.espnS2 = s2;
  S.espn.swid = swid;
  autosave();

  if (statusEl) statusEl.innerHTML = '<p class="loading">Connecting to ESPN...</p>';

  try {
    var data = await ESPNSync.fetchLeague();
    if (data) {
      ESPNSync._lastLeagueData = data;
      ESPNSync.parseLeagueSettings(data);
      ESPNSync.parseTeams(data);
      if (S.myTeam.teamId > 0) {
        ESPNSync.parseMatchup(data);
      }
      S.espn.connected = true;
      S.espn.lastSync = new Date().toISOString();
      var diagMsg = 'Connected. ' + S.teams.length + ' teams, ' + S.allPlayers.length + ' players.';
      if (S.myTeam.teamId > 0) {
        diagMsg += ' Auto-detected: ' + S.myTeam.name;
      } else {
        diagMsg += ' You\'ll pick your team next.';
      }
      addSyncLog('success', diagMsg);
      autosave();
      render();
    } else {
      if (statusEl) statusEl.innerHTML = '<p class="error-msg">Could not connect. Check your credentials and try again.</p>';
    }
  } catch (e) {
    if (statusEl) statusEl.innerHTML = '<p class="error-msg">Connection error: ' + esc(e.message) + '</p>';
    addSyncLog('error', e.message);
  }
}

function completeSetup() {
  S.setupComplete = true;
  S.initialized = true;
  S.currentTab = 0;
  saveState();
  buildNav();
  render();
  updateNav();
  startAutoSync();
  showToast('Welcome to Larry! Your command center is ready.', 'success');
}

function resetSetup() {
  S.espn = initState().espn;
  S.league = initState().league;
  S.myTeam = initState().myTeam;
  S.teams = [];
  S.setupComplete = false;
  S.espn.connected = false;
  saveState();
  render();
}

// --- AUTO SYNC ---
function startAutoSync() {
  if (SYNC_TIMER) clearInterval(SYNC_TIMER);
  if (S.espn.autoSync && S.espn.connected) {
    SYNC_TIMER = setInterval(function() {
      ESPNSync.syncAll();
    }, S.espn.syncInterval * 60 * 1000);
  }
}

function addSyncLog(status, message) {
  S.espn.syncLog.unshift({
    timestamp: new Date().toISOString(),
    status: status,
    message: message
  });
  if (S.espn.syncLog.length > 10) S.espn.syncLog.length = 10;
}

// --- UTILITY FUNCTIONS ---
function fmt(n, decimals) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  decimals = decimals !== undefined ? decimals : 1;
  return parseFloat(n).toFixed(decimals);
}

function pct(n) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  return (parseFloat(n) * 100).toFixed(1) + '%';
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function localDateStr(date) {
  var d = date ? new Date(date) : new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function localNow() { return new Date(); }

function daysUntil(dateStr) {
  var now = localNow();
  var target = new Date(dateStr);
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

function statusBadge(status) {
  switch ((status || '').toUpperCase()) {
    case 'ACTIVE': case 'HEALTHY': return '<span class="status-badge healthy" title="Healthy">\u{1F7E2}</span>';
    case 'GTD': case 'DAY_TO_DAY': case 'GAME_TIME_DECISION': return '<span class="status-badge gtd" title="Game-Time Decision">\u{1F7E1}</span>';
    case 'OUT': case 'SUSPENSION': return '<span class="status-badge out" title="Out">\u{1F534}</span>';
    case 'IR': case 'INJURED_RESERVE': return '<span class="status-badge ir" title="IR">\u26AA</span>';
    default: return '<span class="status-badge healthy">\u{1F7E2}</span>';
  }
}

function trendArrow(recent, season) {
  if (!recent || !season || season === 0) return '<span class="trend-flat">\u2794</span>';
  var change = (recent - season) / Math.abs(season);
  if (change > 0.15) return '<span class="trend-up">\u2B06 ' + (change * 100).toFixed(0) + '%</span>';
  if (change < -0.15) return '<span class="trend-down">\u2B07 ' + (Math.abs(change) * 100).toFixed(0) + '%</span>';
  return '<span class="trend-flat">\u2794</span>';
}

function catColor(abbr) {
  if (S && S.league && S.league.categories) {
    var cat = S.league.categories.find(function(c) { return c.abbr === abbr; });
    if (cat && cat.color) return cat.color;
  }
  return DEFAULT_CAT_COLORS[abbr] || '#94a3b8';
}

// --- TOAST NOTIFICATIONS ---
function showToast(message, type) {
  var toast = document.createElement('div');
  toast.className = 'toast toast-' + (type || 'info');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(function() { toast.classList.add('show'); }, 10);
  setTimeout(function() { toast.classList.remove('show'); setTimeout(function() { toast.remove(); }, 300); }, 3000);
}

// --- SEARCH ---
function openSearch() {
  var overlay = document.getElementById('search-overlay');
  if (overlay) { overlay.classList.add('active'); document.getElementById('global-search').focus(); }
}

function closeSearch() {
  var overlay = document.getElementById('search-overlay');
  if (overlay) overlay.classList.remove('active');
}

function toggleHelp() {
  var overlay = document.getElementById('help-overlay');
  if (overlay) overlay.classList.toggle('active');
}

// --- GLOBAL SEARCH ---
function handleGlobalSearch(query) {
  var results = document.getElementById('search-results');
  if (!results) return;
  if (!query || query.length < 2) { results.innerHTML = ''; return; }
  var lower = query.toLowerCase();
  var allPlayers = (S.allPlayers || []);
  var matches = allPlayers.filter(function(p) {
    return p.name.toLowerCase().includes(lower) || p.nbaTeam.toLowerCase().includes(lower);
  });
  if (matches.length === 0) { results.innerHTML = '<p class="muted" style="padding:12px">No results.</p>'; return; }
  var html = '<div style="padding:8px;max-height:300px;overflow-y:auto">';
  matches.slice(0, 15).forEach(function(p) {
    var onRoster = p.onTeamId === S.myTeam.teamId;
    html += '<div class="search-result-item" onclick="closeSearch();openPlayerPopup(' + p.id + ')">';
    html += '<div class="search-result-headshot">' + playerHeadshot(p, 28) + '</div>';
    html += '<div><strong>' + esc(p.name) + '</strong>' + (onRoster ? ' \u2B50' : '') + '<br>';
    html += '<span class="search-result-meta">' + p.positions.join('/') + ' | ' + p.nbaTeam + '</span></div>';
    html += '</div>';
  });
  html += '</div>';
  results.innerHTML = html;
}

function viewPlayer(playerId) {
  openPlayerPopup(playerId);
}

// --- LARRY AVATAR ---
function getLarryAvatar(size) {
  size = size || 32;
  return '<img src="assets/larry-logo.svg" width="' + size + '" height="' + size + '" alt="Larry" style="border-radius:50%;object-fit:cover;">';
}

// --- SORTING ---
var sortState = {};

function sortTable(tableKey, col, data, accessor) {
  if (!sortState[tableKey]) sortState[tableKey] = { col: col, dir: 'desc' };
  var st = sortState[tableKey];
  if (st.col === col) {
    st.dir = st.dir === 'asc' ? 'desc' : 'asc';
  } else {
    st.col = col;
    st.dir = 'desc';
  }
  data.sort(function(a, b) {
    var va = accessor ? accessor(a, col) : a[col];
    var vb = accessor ? accessor(b, col) : b[col];
    if (va === null || va === undefined) va = -Infinity;
    if (vb === null || vb === undefined) vb = -Infinity;
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (st.dir === 'asc') return va > vb ? 1 : va < vb ? -1 : 0;
    return va < vb ? 1 : va > vb ? -1 : 0;
  });
  return data;
}

function sortIcon(tableKey, col) {
  var st = sortState[tableKey];
  if (!st || st.col !== col) return '';
  return st.dir === 'asc' ? ' \u25B2' : ' \u25BC';
}

// --- SECTION COLLAPSE ---
function toggleSection(key) {
  S.prefs.collapsedSections[key] = !S.prefs.collapsedSections[key];
  autosave();
  render();
}

function isSectionCollapsed(key) {
  return !!S.prefs.collapsedSections[key];
}

// --- APP INITIALIZATION ---
function initApp() {
  loadState();
  buildNav();
  initKeyboard();
  render();
  updateNav();
  if (S.setupComplete && S.espn.connected) {
    startAutoSync();
    updateSyncIndicator();
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function(e) {
      console.warn('SW registration failed:', e);
    });
  }
}

function updateSyncIndicator() {
  var el = document.getElementById('sync-status');
  if (!el) return;
  if (S.espn.connected && S.espn.lastSync) {
    el.className = 'sync-indicator connected';
    el.innerHTML = '\u{1F7E2} ' + timeSince(S.espn.lastSync);
  } else {
    el.className = 'sync-indicator';
    el.innerHTML = '\u26AA Not connected';
  }
}

function timeSince(dateStr) {
  var seconds = Math.floor((new Date() - new Date(dateStr)) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}

// --- BOOT ---
document.addEventListener('DOMContentLoaded', initApp);

// --- ESPN TEAM COLORS (for headshot fallback initials) ---
var ESPN_TEAM_COLORS = {
  ATL:'#E03A3E',BOS:'#007A33',NOP:'#0C2340',CHI:'#CE1141',CLE:'#860038',
  DAL:'#00538C',DEN:'#0E2240',DET:'#C8102E',GSW:'#1D428A',HOU:'#CE1141',
  IND:'#002D62',LAC:'#C8102E',LAL:'#552583',MIA:'#98002E',MIL:'#00471B',
  MIN:'#0C2340',BKN:'#000000',NYK:'#006BB6',ORL:'#0077C0',PHI:'#006BB6',
  PHX:'#1D1160',POR:'#E03A3E',SAC:'#5A2D81',SAS:'#C4CED4',OKC:'#007AC1',
  UTA:'#002B5C',WAS:'#002B5C',TOR:'#CE1141',MEM:'#5D76A9',CHA:'#1D1160'
};

// --- PLAYER HEADSHOTS ---
function playerHeadshot(player, size) {
  size = size || 32;
  if (!player || !player.id) return playerInitials(player, size);
  var url = 'https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/' + player.id + '.png&w=' + (size * 2) + '&h=' + Math.round(size * 1.46) + '&cb=1';
  var teamColor = ESPN_TEAM_COLORS[player.nbaTeam] || '#666';
  return '<img src="' + url + '" width="' + size + '" height="' + size + '" ' +
    'class="player-headshot" alt="" loading="lazy" ' +
    'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
    '<span class="player-initials" style="display:none;width:' + size + 'px;height:' + size + 'px;background:' + teamColor + '">' +
    getInitials(player.name) + '</span>';
}

function playerInitials(player, size) {
  size = size || 32;
  var teamColor = (player && player.nbaTeam) ? (ESPN_TEAM_COLORS[player.nbaTeam] || '#666') : '#666';
  return '<span class="player-initials" style="width:' + size + 'px;height:' + size + 'px;background:' + teamColor + '">' + getInitials(player ? player.name : '') + '</span>';
}

function getInitials(name) {
  if (!name) return '?';
  var parts = name.split(' ');
  if (parts.length >= 2) return parts[0].charAt(0) + parts[parts.length - 1].charAt(0);
  return name.charAt(0);
}

// --- PLAYER POPUP (5 TABS: Stats, Game Log, News, Schedule, Analysis) ---
var _popupPlayerId = null;
var _popupTab = 'stats';

function openPlayerPopup(playerId) {
  _popupPlayerId = playerId;
  _popupTab = 'stats';
  renderPlayerPopup();
  var overlay = document.getElementById('player-popup-overlay');
  if (overlay) { overlay.classList.add('active'); document.body.style.overflow = 'hidden'; }
}

function closePlayerPopup() {
  _popupPlayerId = null;
  var overlay = document.getElementById('player-popup-overlay');
  if (overlay) { overlay.classList.remove('active'); document.body.style.overflow = ''; }
}

function switchPopupTab(tab) {
  _popupTab = tab;
  renderPlayerPopup();
}

function renderPlayerPopup() {
  var container = document.getElementById('player-popup-content');
  if (!container || !_popupPlayerId) return;
  var p = S.allPlayers.find(function(pl) { return pl.id === _popupPlayerId; });
  if (!p) { container.innerHTML = '<p class="muted">Player not found.</p>'; return; }
  if (S.allPlayers.length) Engines.computeAllZScores(S.allPlayers, 'season');
  var cats = S.league.categories;
  var onWatch = S.watchlist.includes(p.id);
  var streak = Engines.detectStreaks(p);

  var html = '<div class="popup-header">';
  html += '<div class="popup-headshot">' + playerHeadshot(p, 56) + '</div>';
  html += '<div class="popup-info">';
  html += '<h3>' + esc(p.name) + ' ' + statusBadge(p.status) + '</h3>';
  html += '<p class="popup-meta">' + p.positions.join('/') + ' | ' + p.nbaTeam + ' | Own: ' + fmt(p.ownership, 0) + '%</p>';
  if (p.injuryStatus && p.injuryStatus !== 'ACTIVE') html += '<p class="popup-injury">' + esc(p.injuryStatus) + '</p>';
  html += '</div></div>';

  // Quick stats
  html += '<div class="popup-quick-stats">';
  cats.forEach(function(cat) {
    var val = p.stats.season ? p.stats.season[cat.abbr] : null;
    html += '<div class="quick-stat"><span class="qs-label" style="color:' + cat.color + '">' + cat.abbr + '</span>';
    html += '<span class="qs-val">' + (val !== null ? (cat.isPercent ? pct(val) : fmt(val, 1)) : '-') + '</span></div>';
  });
  html += '</div>';

  if (streak.trend !== 'stable') {
    html += '<div class="popup-streak ' + streak.trend + '">' + (streak.trend === 'hot' ? '\u{1F525}' : '\u{1F9CA}') + ' ' + streak.label + '</div>';
  }

  // 5 Tabs
  html += '<div class="popup-tabs">';
  ['stats','gameLog','news','schedule','analysis'].forEach(function(tab) {
    var label = { stats: 'Stats', gameLog: 'Log', news: 'News', schedule: 'Schedule', analysis: 'Analysis' }[tab];
    html += '<button class="popup-tab' + (_popupTab === tab ? ' active' : '') + '" onclick="switchPopupTab(\'' + tab + '\')">' + label + '</button>';
  });
  html += '</div><div class="popup-body">';

  if (_popupTab === 'stats') {
    html += renderPopupStats(p, cats);
  } else if (_popupTab === 'gameLog') {
    html += renderPopupGameLog(p, cats);
  } else if (_popupTab === 'news') {
    html += renderPopupNews(p);
  } else if (_popupTab === 'schedule') {
    html += renderPopupSchedule(p);
  } else if (_popupTab === 'analysis') {
    html += renderPopupAnalysis(p, cats);
  }

  html += '</div>';
  // Actions
  html += '<div class="popup-actions">';
  html += '<button class="btn btn-sm ' + (onWatch ? 'btn-warning' : 'btn-secondary') + '" onclick="toggleWatchlist(' + p.id + ');renderPlayerPopup()">' + (onWatch ? '\u2B50 Watching' : '\u2606 Watch') + '</button>';
  html += '<a href="https://fantasy.espn.com/basketball/player?playerId=' + p.id + '" target="_blank" class="btn btn-sm btn-secondary">ESPN</a>';
  // Injury impact button
  if (p.status !== 'ACTIVE' && p.status !== 'HEALTHY') {
    html += '<button class="btn btn-sm btn-secondary" onclick="showInjuryImpact(' + p.id + ')">Impact</button>';
  }
  html += '</div>';

  container.innerHTML = html;
}

function renderPopupStats(p, cats) {
  var html = '<table class="popup-stats-table"><thead><tr><th>Period</th>';
  cats.forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
  html += '</tr></thead><tbody>';
  ['season','last30','last15','last7'].forEach(function(period) {
    var labels = { season: 'Season', last30: 'L30', last15: 'L15', last7: 'L7' };
    if (!p.stats[period]) return;
    html += '<tr><td><strong>' + labels[period] + '</strong></td>';
    cats.forEach(function(cat) {
      var val = p.stats[period] ? p.stats[period][cat.abbr] : null;
      html += '<td>' + (val !== null ? (cat.isPercent ? pct(val) : fmt(val, 1)) : '-') + '</td>';
    });
    html += '</tr>';
  });
  html += '<tr class="z-row"><td><strong>Z</strong></td>';
  cats.forEach(function(cat) {
    var z = p.zScores ? p.zScores[cat.abbr] : 0;
    html += '<td class="' + (z > 0.5 ? 'stat-positive' : (z < -0.5 ? 'stat-negative' : '')) + '">' + (z >= 0 ? '+' : '') + fmt(z, 2) + '</td>';
  });
  html += '</tr></tbody></table>';
  // Totals view
  if (p.gamesPlayed > 0) {
    html += '<h4 class="popup-section-title">Season Totals</h4>';
    html += '<div class="popup-quick-stats">';
    cats.forEach(function(cat) {
      if (cat.isPercent) return;
      var avg = p.stats.season ? p.stats.season[cat.abbr] : 0;
      var total = (avg || 0) * (p.gamesPlayed || 0);
      html += '<div class="quick-stat"><span class="qs-label" style="color:' + cat.color + '">' + cat.abbr + '</span>';
      html += '<span class="qs-val">' + fmt(total, 0) + '</span></div>';
    });
    html += '</div>';
  }
  html += '<div class="popup-extra-stats"><span>GP: ' + (p.gamesPlayed || 0) + '</span><span>MPG: ' + fmt(p.minutesPerGame, 1) + '</span>';
  html += '<span>Z: ' + fmt(p.zScores ? p.zScores.total : 0, 2) + '</span></div>';
  return html;
}

function renderPopupGameLog(p, cats) {
  // Game log from ESPN data (use available stat splits as proxy)
  var html = '<p class="muted">Recent performance by period. Full game-by-game log requires ESPN game log API.</p>';
  html += '<table class="popup-stats-table"><thead><tr><th>Period</th>';
  cats.forEach(function(cat) { html += '<th style="color:' + cat.color + '">' + cat.abbr + '</th>'; });
  html += '</tr></thead><tbody>';

  var periods = ['last7','last15','last30','season'];
  var labels = { last7: 'Last 7 Days', last15: 'Last 15 Days', last30: 'Last 30 Days', season: 'Full Season' };
  periods.forEach(function(period) {
    if (!p.stats[period]) return;
    var hasDiff = false;
    html += '<tr><td>' + labels[period] + '</td>';
    cats.forEach(function(cat) {
      var val = p.stats[period][cat.abbr];
      var seasonVal = p.stats.season ? p.stats.season[cat.abbr] : null;
      var diff = (val !== null && seasonVal !== null && period !== 'season') ? val - seasonVal : 0;
      var cls = '';
      if (period !== 'season' && Math.abs(diff) > 0.1) {
        cls = diff > 0 && !cat.isNegative ? 'stat-positive' : (diff < 0 && !cat.isNegative ? 'stat-negative' : '');
        if (cat.isNegative) cls = diff < 0 ? 'stat-positive' : (diff > 0 ? 'stat-negative' : '');
        hasDiff = true;
      }
      html += '<td class="' + cls + '">' + (val !== null ? (cat.isPercent ? pct(val) : fmt(val, 1)) : '-') + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';

  // Trend analysis
  var streak = Engines.detectStreaks(p);
  if (streak.trend !== 'stable') {
    html += '<div class="game-log-trend ' + streak.trend + '">';
    html += (streak.trend === 'hot' ? '\u{1F525} Trending Up' : '\u{1F9CA} Trending Down');
    html += ': ' + streak.label;
    html += '</div>';
  }

  return html;
}

function renderPopupNews(p) {
  var html = '';
  // Injury info
  if (p.injuryStatus && p.injuryStatus !== 'ACTIVE') {
    html += '<div class="news-item injury-news">';
    html += '<div class="news-badge">' + statusBadge(p.status) + ' ' + esc(p.injuryStatus) + '</div>';
    if (p.injuryNote) html += '<p>' + esc(p.injuryNote) + '</p>';
    html += '</div>';

    // Show injury impact
    var impact = Engines.injuryImpact(p);
    if (impact.length) {
      html += '<h4 class="popup-section-title">Who Benefits?</h4>';
      impact.slice(0, 5).forEach(function(b) {
        html += '<div class="news-item impact-item">';
        html += '<strong>' + esc(b.player.name) + '</strong>';
        html += ' <span class="muted">' + b.player.nbaTeam + ' ' + b.player.positions.join('/') + '</span>';
        if (b.onWaivers) html += ' <span class="add-badge">Available</span>';
        html += '<div class="muted">+' + fmt(b.minsBoost, 1) + ' min projected boost';
        if (b.samePosition) html += ' (same position)';
        html += '</div></div>';
      });
    }
  } else {
    html += '<p class="muted">No injury news for ' + esc(p.name) + '.</p>';
  }

  // Ownership trend
  html += '<div class="news-item">';
  html += '<strong>Ownership:</strong> ' + fmt(p.ownership, 1) + '%';
  html += '</div>';

  // Fantasy notes
  if (p.notes) {
    html += '<div class="news-item"><p>' + esc(p.notes) + '</p></div>';
  }

  return html;
}

function renderPopupSchedule(p) {
  var html = '';
  if (p.schedule && p.schedule.length) {
    html += '<div class="popup-schedule">';
    p.schedule.slice(0, 14).forEach(function(g) {
      html += '<div class="sched-game-row">';
      html += '<span class="sched-date">' + g.date + '</span>';
      html += '<span class="sched-opp">' + (g.home ? 'vs' : '@') + ' ' + esc(g.opponent || '?') + '</span>';
      html += '</div>';
    });
    html += '</div>';
  } else {
    html += '<p class="muted">No schedule data. Try syncing.</p>';
  }
  html += '<p class="muted" style="margin-top:8px">Games remaining this matchup: ' + (p.gamesRemaining || '?') + '</p>';
  html += '<p class="muted">Games remaining ROS: ' + (p.gamesRemainingROS || '?') + '</p>';
  return html;
}

function renderPopupAnalysis(p, cats) {
  var html = '<div class="analysis-values">';
  html += '<div class="analysis-val"><span class="av-num">' + fmt(p.zScores ? p.zScores.total : 0, 2) + '</span><span class="av-label">Z-Score</span></div>';
  html += '<div class="analysis-val"><span class="av-num">' + fmt(p.zScores ? p.zScores.durant : 0, 2) + '</span><span class="av-label">DURANT</span></div>';
  if (p.zScores && p.zScores.durantH2H !== undefined) {
    html += '<div class="analysis-val"><span class="av-num">' + fmt(p.zScores.durantH2H, 2) + '</span><span class="av-label">H2H Value</span></div>';
  }
  html += '<div class="analysis-val"><span class="av-num">' + fmt(p.frustrationValue || 0, 1) + '</span><span class="av-label">Frustration</span></div>';
  html += '</div>';

  // Z-score bars
  html += '<h4 class="popup-section-title">Category Z-Scores</h4><div class="z-bars">';
  cats.forEach(function(cat) {
    var z = p.zScores ? p.zScores[cat.abbr] : 0;
    var width = Math.min(Math.abs(z) * 20, 100);
    var isPos = z >= 0;
    html += '<div class="z-bar-row"><span class="z-bar-label" style="color:' + cat.color + '">' + cat.abbr + '</span>';
    html += '<div class="z-bar-track"><span class="z-bar-center"></span><div class="z-bar-fill ' + (isPos ? 'positive' : 'negative') + '" style="width:' + width + '%"></div></div>';
    html += '<span class="z-bar-value ' + (isPos ? 'positive' : 'negative') + '">' + (isPos ? '+' : '') + fmt(z, 2) + '</span></div>';
  });
  html += '</div>';

  // Per-36 stats
  var mins = p.minutesPerGame || 0;
  if (mins > 0) {
    html += '<h4 class="popup-section-title">Per-36 Minutes</h4>';
    html += '<div class="popup-quick-stats">';
    cats.forEach(function(cat) {
      if (cat.isPercent) return;
      var raw = p.stats.season ? p.stats.season[cat.abbr] : null;
      var per36 = raw !== null && raw !== undefined ? (raw / mins) * 36 : null;
      html += '<div class="quick-stat"><span class="qs-label" style="color:' + cat.color + '">' + cat.abbr + '</span>';
      html += '<span class="qs-val">' + (per36 !== null ? fmt(per36, 1) : '-') + '</span></div>';
    });
    html += '</div>';
  }

  return html;
}

// Show injury impact in a toast/alert
function showInjuryImpact(playerId) {
  var p = S.allPlayers.find(function(pl) { return pl.id === playerId; });
  if (!p) return;
  _popupTab = 'news';
  renderPlayerPopup();
}
