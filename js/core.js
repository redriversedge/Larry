// ============================================================
// LARRY v2 -- CORE MODULE
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
  { id: 'news', label: 'News & Injuries', icon: '\u{1F4F0}' },
  { id: 'schedule', label: 'Schedule', icon: '\u{1F4C5}' },
  { id: 'playoffs', label: 'Playoff Projector', icon: '\u{1F3C5}' },
  { id: 'timeline', label: 'Season Timeline', icon: '\u{23F3}' },
  { id: 'notifications', label: 'Notifications', icon: '\u{1F514}' },
  { id: 'settings', label: 'Settings & Data', icon: '\u{2699}\u{FE0F}' }
];

// --- INITIALIZATION ---
function initState() {
  return {
    version: '2.1.0',
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
      collapsedSections: {}, claudeApiKey: ''
    },
    chatHistory: [],
    analysisCache: {
      zScores: null, projections: null, tradeTargets: null,
      puntAnalysis: null, lastComputed: null
    }
  };
}

function loadState() {
  try {
    var raw = localStorage.getItem('larry_state');
    if (raw) {
      var loaded = JSON.parse(raw);
      // Merge with defaults to ensure all keys exist
      S = mergeDeep(initState(), loaded);
      S.version = '2.1.0';
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
  // Update notification badge
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
    html += '<button class="nav-tab' + (i === S.currentTab ? ' active' : '') + '" onclick="switchTab(' + i + ')">';
    html += '<span class="nav-icon">' + tab.icon + '</span>';
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
    }
  });
}

// --- RENDER SYSTEM ---
function render() {
  var container = document.getElementById('tab-content');
  if (!container) return;

  // Step 1: Setup flow (ESPN credentials)
  if (!S.setupComplete) {
    renderSetup(container);
    return;
  }

  // Step 2: Team selector (if connected but no team chosen)
  if (needsTeamSelection()) {
    renderTeamSelector(container);
    return;
  }

  // Step 3: Normal tab rendering
  safeRender(container);
}

function needsTeamSelection() {
  // Show team selector if we have league data but no team selected
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
    // Team selected successfully -- parse matchup with this team context
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
  // Reset team selection to trigger the team picker
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
    // Connected - show confirmation before team selection
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
      // Store for later re-parsing
      ESPNSync._lastLeagueData = data;

      ESPNSync.parseLeagueSettings(data);
      ESPNSync.parseTeams(data);

      // Only parse matchup if we have a team identified
      if (S.myTeam.teamId > 0) {
        ESPNSync.parseMatchup(data);
      }

      S.espn.connected = true;
      S.espn.lastSync = new Date().toISOString();

      // Diagnostic info
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
  // Start auto-sync
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
    html += '<div class="search-result-item" onclick="closeSearch();viewPlayer(' + p.id + ')">';
    html += '<strong>' + esc(p.name) + '</strong>' + (onRoster ? ' \u2B50' : '') + '<br>';
    html += '<span class="search-result-meta">' + p.positions.join('/') + ' | ' + p.nbaTeam + '</span>';
    html += '</div>';
  });
  html += '</div>';
  results.innerHTML = html;
}

function viewPlayer(playerId) {
  // Navigate to Players tab with this player selected
  S.currentTab = 2;
  S.selectedPlayerId = playerId;
  autosave();
  render();
  updateNav();
}

// --- LARRY AVATAR ---
function getLarryAvatar(size) {
  size = size || 32;
  return '<img src="assets/larry-logo.svg" width="' + size + '" height="' + size + '" alt="Larry" style="border-radius:50%;object-fit:cover;">';
}

// --- SORTING ---
var sortState = {}; // {tableKey: {col: 'name', dir: 'asc'}}

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
  // Register service worker
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
