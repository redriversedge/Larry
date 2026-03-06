// ============================================================
// LARRY v3.0 -- CORE MODULE
// State management, setup flow, navigation, utilities
// ============================================================

var S = null;
var SAVE_TIMER = null;
var SYNC_TIMER = null;
var AUTO_REFRESH_TIMER = null;

// --- STAT ORDER: enforced everywhere ---
var STAT_ORDER = ['REB','AST','STL','BLK','PTS','3PM','FG%','FT%','TO','DD','TD'];

function getOrderedCategories() {
  if (!S || !S.league || !S.league.categories) return [];
  var ordered = [];
  STAT_ORDER.forEach(function(abbr) {
    var cat = S.league.categories.find(function(c) { return c.abbr === abbr; });
    if (cat) ordered.push(cat);
  });
  // Append any league cats not in STAT_ORDER
  S.league.categories.forEach(function(c) {
    if (!ordered.find(function(o) { return o.abbr === c.abbr; })) ordered.push(c);
  });
  return ordered;
}

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

var ESPN_TEAM_COLORS = {
  ATL:'#E03A3E',BOS:'#007A33',NOP:'#0C2340',CHI:'#CE1141',CLE:'#860038',
  DAL:'#00538C',DEN:'#0E2240',DET:'#C8102E',GSW:'#1D428A',HOU:'#CE1141',
  IND:'#002D62',LAC:'#C8102E',LAL:'#552583',MIA:'#98002E',MIL:'#00471B',
  MIN:'#0C2340',BKN:'#000000',NYK:'#006BB6',ORL:'#0077C0',PHI:'#006BB6',
  PHX:'#1D1160',POR:'#E03A3E',SAC:'#5A2D81',SAS:'#C4CED4',OKC:'#007AC1',
  UTA:'#002B5C',WAS:'#002B5C',TOR:'#CE1141',MEM:'#5D76A9',CHA:'#1D1160'
};

// --- TAB CONFIG ---
var TABS = [
  { id: 'roster', label: 'Roster', icon: '\u{1F4CB}' },
  { id: 'matchup', label: 'Matchup', icon: '\u{1F3C6}' },
  { id: 'players', label: 'Players', icon: '\u{1F465}' },
  { id: 'larry', label: 'Larry', icon: '\u{1F989}' },
  { id: 'league', label: 'League', icon: '\u{1F3C0}' }
];

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

// --- STATE ---
function initState() {
  return {
    version: '3.0.0',
    initialized: false,
    setupComplete: false,
    currentTab: 0,
    leagueSubPage: null,
    lastActivity: new Date().toISOString(),
    espn: {
      leagueId: '', espnS2: '', swid: '', connected: false,
      lastSync: null, syncInterval: 2, autoSync: true,
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
      pointsFor: 0, pointsAgainst: 0,
      playoffSeed: 0, waiverRank: 0, acquisitionsUsed: 0, acquisitionsTotal: 0,
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
      theme: 'larry-dark',
      defaultStatView: 'season', chartTheme: 'dark',
      collapsedSections: {}, claudeApiKey: '',
      recencyWeight: 0.3
    },
    chatHistory: [],
    analysisCache: {
      zScores: null, projections: null, tradeTargets: null,
      puntAnalysis: null, lastComputed: null
    },
    draft: { active: false, picks: [], myPicks: [], draftedIds: [], puntCats: [] }
  };
}

function loadState() {
  try {
    var raw = localStorage.getItem('larry_state');
    if (raw) {
      var loaded = JSON.parse(raw);
      S = mergeDeep(initState(), loaded);
      S.version = '3.0.0';
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
  } catch (e) { console.error('State save failed:', e); }
}

function autosave() {
  if (SAVE_TIMER) clearTimeout(SAVE_TIMER);
  SAVE_TIMER = setTimeout(saveState, 400);
}

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

// --- EXPORT/IMPORT ---
function exportData() {
  var blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'larry-backup-' + localDateStr() + '.json'; a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = JSON.parse(e.target.result);
      S = mergeDeep(initState(), data);
      saveState(); render();
      showToast('Data imported successfully', 'success');
    } catch (err) { showToast('Import failed: ' + err.message, 'error'); }
  };
  reader.readAsText(file);
}

// --- NAVIGATION ---
function switchTab(index) {
  S.currentTab = index;
  S.leagueSubPage = null;
  autosave(); render(); updateNav();
  var tc = document.getElementById('tab-content');
  if (tc) tc.scrollTop = 0;
}

function openLeagueSub(pageId) {
  S.currentTab = 4;
  S.leagueSubPage = pageId;
  autosave(); render(); updateNav();
}

function backToLeagueMenu() {
  S.leagueSubPage = null;
  render();
}

function updateNav() {
  var nav = document.getElementById('bottom-nav');
  if (!nav) return;
  var btns = nav.querySelectorAll('.nav-tab');
  btns.forEach(function(btn, i) { btn.classList.toggle('active', i === S.currentTab); });
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
    if (tab.id === 'league') badge = '<span class="notif-badge" id="notif-badge" style="display:none">0</span>';
    var isLarry = tab.id === 'larry';
    html += '<button class="nav-tab' + (i === S.currentTab ? ' active' : '') + (isLarry ? ' nav-larry' : '') + '" onclick="switchTab(' + i + ')">';
    if (isLarry) {
      html += '<span class="nav-icon larry-glow-wrap"><span class="larry-glow"></span>';
      html += '<img src="assets/larry-logo.svg" class="larry-nav-icon" width="28" height="28" alt="Larry"></span>';
    } else {
      html += '<span class="nav-icon">' + tab.icon + '</span>';
    }
    html += '<span class="nav-label">' + tab.label + '</span>' + badge + '</button>';
  });
  nav.innerHTML = html;
}

// --- KEYBOARD ---
function initKeyboard() {
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key >= '1' && e.key <= '5') { e.preventDefault(); switchTab(parseInt(e.key) - 1); }
    else if (e.key === '/') { e.preventDefault(); openSearch(); }
    else if (e.key === '?') { e.preventDefault(); toggleHelp(); }
    else if (e.key === 'Escape') { closeSearch(); closePlayerPopup(); closeStatsKey(); }
  });
}

// --- SORT STATE ---
var sortState = {};

function sortTable(tableKey, col, sortDir) {
  var st = sortState[tableKey];
  if (st && st.col === col) { st.dir = st.dir === 'asc' ? 'desc' : 'asc'; }
  else { sortState[tableKey] = { col: col, dir: sortDir || 'desc' }; }
  render();
}

function applySortState(data, tableKey, colAccessor) {
  var st = sortState[tableKey];
  if (!st) return data;
  data.sort(function(a, b) {
    var va = colAccessor(a, st.col);
    var vb = colAccessor(b, st.col);
    if (va === null || va === undefined) va = -Infinity;
    if (vb === null || vb === undefined) vb = -Infinity;
    if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase(); }
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
  autosave(); render();
}

function isSectionCollapsed(key) { return !!S.prefs.collapsedSections[key]; }

// --- RENDER SYSTEM ---
function render() {
  var container = document.getElementById('tab-content');
  if (!container) return;
  if (!S.setupComplete) { renderSetup(container); return; }
  if (needsTeamSelection()) { renderTeamSelector(container); return; }
  safeRender(container);
}

function needsTeamSelection() {
  return S.espn.connected && S.teams.length > 0 && S.myTeam.teamId === 0;
}

function safeRender(container) {
  try {
    var renderers = [renderRoster, renderMatchup, renderPlayers, renderChat, renderLeague];
    if (S.currentTab >= 0 && S.currentTab < renderers.length) {
      renderers[S.currentTab](container);
    }
  } catch (e) {
    container.innerHTML = '<div class="error-card"><h3>Something went wrong</h3><p>' + e.message + '</p>' +
      '<pre>' + (e.stack || '').substring(0, 500) + '</pre>' +
      '<p>Tab: ' + S.currentTab + ' | Sub: ' + S.leagueSubPage + '</p>' +
      '<p>TeamId: ' + S.myTeam.teamId + ' | Players: ' + (S.myTeam.players ? S.myTeam.players.length : 0) + ' | Teams: ' + S.teams.length + '</p>' +
      '<button class="btn btn-primary" onclick="render()">Retry</button> ' +
      '<button class="btn btn-secondary" onclick="switchTab(0)">Go to Roster</button> ' +
      '<button class="btn btn-warning" onclick="changeTeam()">Change Team</button> ' +
      '<button class="btn btn-danger" onclick="if(confirm(\'Reset all data?\')){S=initState();saveState();render();}">Reset App</button></div>';
  }
}

// --- TEAM SELECTOR (post-setup team change) ---
function renderTeamSelector(container) {
  var html = '<div class="setup-container">';
  html += '<div class="setup-logo"><div class="larry-avatar large">' + getLarryAvatar(80) + '</div>';
  html += '<h1 class="setup-title">Select Your Team</h1>';
  html += '<p class="setup-subtitle">' + esc(S.league.name) + ' &mdash; ' + S.league.teamCount + ' teams</p></div>';
  html += '<div class="setup-card">';
  html += renderTeamList(function(teamId) { return 'selectMyTeam(' + teamId + ')'; });
  html += '<button class="btn btn-secondary btn-full" onclick="resetSetup()" style="margin-top:16px;">Start Over</button>';
  html += '</div></div>';
  container.innerHTML = html;
}

function selectMyTeam(teamId) {
  if (ESPNSync.selectTeam(teamId)) {
    if (ESPNSync._lastLeagueData) ESPNSync.parseMatchup(ESPNSync._lastLeagueData);
    S.myTeam.owner = (S.teams.find(function(t) { return t.teamId === teamId; }) || {}).owner || '';
    saveState(); render(); updateNav();
    showToast('Team selected: ' + S.myTeam.name, 'success');
  } else { showToast('Failed to select team.', 'error'); }
}

function changeTeam() {
  S.myTeam.teamId = 0; S.myTeam.name = ''; S.myTeam.players = [];
  saveState(); render();
}

// --- SHARED TEAM LIST RENDERER ---
function renderTeamList(onclickBuilder) {
  var html = '<div class="team-selector-list">';
  var detectedTeam = S.teams.find(function(t) { return t.isMyTeam; });
  if (detectedTeam) {
    html += '<div class="alert alert-info" style="margin-bottom:10px">Auto-detected your team based on your ESPN account.</div>';
  }
  S.teams.forEach(function(team) {
    var isDetected = detectedTeam && team.teamId === detectedTeam.teamId;
    var record = team.record.wins + '-' + team.record.losses + '-' + team.record.ties;
    html += '<button class="team-selector-item' + (isDetected ? ' detected' : '') + '" onclick="' + onclickBuilder(team.teamId) + '">';
    if (isDetected) html += '<span class="detected-badge">Your Team</span>';
    html += '<div class="team-selector-name">' + esc(team.name) + '</div>';
    html += '<div class="team-selector-meta">';
    if (team.owner) html += '<span>' + esc(team.owner) + '</span> &middot; ';
    html += record + ' &middot; ' + (team.players ? team.players.length : 0) + ' players</div></button>';
  });
  html += '</div>';
  return html;
}

// ============================================================
// SETUP WIZARD (4-step)
// ============================================================
var _setupStep = 1;
var _wizardData = { leagueId: '', espnS2: '', swid: '' };
var _wizardConnecting = false;
var _wizardError = null;
var _wizardConnectTriggered = false;

// --- VALIDATION HELPERS ---
function extractLeagueId(input) {
  if (!input) return '';
  input = input.trim();
  if (/^\d+$/.test(input)) return input;
  var match = input.match(/leagueId=(\d+)/);
  if (match) return match[1];
  match = input.match(/\/league\/(\d+)/);
  if (match) return match[1];
  return input;
}

function validateSWID(value) {
  if (!value) return { valid: false, hint: 'SWID is required' };
  value = value.trim();
  if (!/^\{?[A-Fa-f0-9-]+\}?$/.test(value)) {
    return { valid: false, hint: 'SWID should look like {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}' };
  }
  if (!value.startsWith('{')) value = '{' + value;
  if (!value.endsWith('}')) value = value + '}';
  return { valid: true, value: value };
}

function validateEspnS2(value) {
  if (!value) return { valid: false, hint: 'espn_s2 is required' };
  value = value.trim();
  if (value.length < 100) {
    return { valid: false, hint: 'espn_s2 looks too short. It\'s usually 200+ characters.' };
  }
  return { valid: true, value: value };
}

function tryParseBothCookies(pastedText) {
  var result = { espnS2: '', swid: '' };
  if (!pastedText) return result;
  var swidMatch = pastedText.match(/SWID\s*[=:]\s*(\{[^}]+\})/i);
  if (swidMatch) result.swid = swidMatch[1];
  var s2Match = pastedText.match(/espn_s2\s*[=:]\s*([A-Za-z0-9%+/=]{100,})/i);
  if (s2Match) {
    try { result.espnS2 = decodeURIComponent(s2Match[1]); }
    catch(e) { result.espnS2 = s2Match[1]; }
  }
  return result;
}

// --- PROGRESS BAR ---
function renderSetupProgress(currentStep) {
  var steps = ['Welcome', 'League ID', 'Cookies', 'Connect'];
  var html = '<div class="setup-progress"><div class="setup-progress-bar">';
  steps.forEach(function(label, i) {
    var stepNum = i + 1;
    var status = stepNum < currentStep ? 'done' : (stepNum === currentStep ? 'active' : 'pending');
    html += '<div class="setup-step-dot ' + status + '">';
    html += '<span class="step-number">' + (status === 'done' ? '&#10003;' : stepNum) + '</span></div>';
    if (i < steps.length - 1) {
      html += '<div class="setup-step-line ' + (stepNum < currentStep ? 'done' : '') + '"></div>';
    }
  });
  html += '</div><div class="setup-progress-labels">';
  steps.forEach(function(label, i) {
    html += '<span class="step-label ' + ((i + 1) === currentStep ? 'active' : '') + '">' + label + '</span>';
  });
  html += '</div></div>';
  return html;
}

// --- MAIN SETUP RENDERER ---
function renderSetup(container) {
  // Pre-fill wizard data from saved state
  if (S.espn.leagueId && !_wizardData.leagueId) _wizardData.leagueId = S.espn.leagueId;
  if (S.espn.espnS2 && !_wizardData.espnS2) _wizardData.espnS2 = S.espn.espnS2;
  if (S.espn.swid && !_wizardData.swid) _wizardData.swid = S.espn.swid;

  // Skip to step 4 if already connected
  if (S.espn.connected && S.teams.length > 0 && !S.setupComplete) {
    _setupStep = 4;
  }

  var html = '<div class="setup-container">';
  html += renderSetupProgress(_setupStep);

  switch (_setupStep) {
    case 1: html += renderSetupStep1(); break;
    case 2: html += renderSetupStep2(); break;
    case 3: html += renderSetupStep3(); break;
    case 4: html += renderSetupStep4(); break;
  }

  html += '</div>';
  container.innerHTML = html;
}

// --- STEP 1: WELCOME + THEME ---
function renderSetupStep1() {
  var html = '<div class="setup-logo">';
  html += '<div class="larry-avatar large">' + getLarryAvatar(120) + '</div>';
  html += '<h1 class="setup-title">Meet Larry</h1>';
  html += '<p class="setup-subtitle">Your AI-powered fantasy basketball command center.<br>Named after the Larry O\'Brien Trophy.</p></div>';
  html += '<div class="setup-card"><h2>Choose Your Theme</h2>';
  html += '<p class="text-sm muted" style="margin-bottom:12px">Pick a color scheme. You can always change this later in Settings.</p>';
  html += renderThemePicker(getCurrentThemeId());
  html += '<button class="btn btn-primary btn-full" onclick="_setupStep=2;render()">Get Started</button></div>';
  return html;
}

// --- STEP 2: LEAGUE ID ---
function renderSetupStep2() {
  var html = '<div class="setup-card"><h2>Your ESPN League</h2>';
  html += '<p class="text-sm muted" style="margin-bottom:16px">Enter your ESPN Fantasy Basketball league ID or paste the full league URL.</p>';
  html += '<div class="form-group"><label>ESPN League ID or URL</label>';
  html += '<input type="text" class="form-input" id="setup-league-id" ';
  html += 'placeholder="e.g. 62378 or paste full ESPN league URL" ';
  html += 'value="' + esc(_wizardData.leagueId) + '" ';
  html += 'oninput="wizardValidateLeagueId(this.value)" />';
  html += '<div id="league-id-feedback" class="form-feedback"></div></div>';
  html += '<div class="how-to-find"><h4>Where to find your League ID</h4>';
  html += '<p>Open your league on ESPN and look at the URL:</p>';
  html += '<code style="word-break:break-all;display:block;margin:8px 0;padding:6px;background:var(--bg-input);border-radius:4px">fantasy.espn.com/basketball/league?leagueId=<strong>12345</strong></code>';
  html += '<p>The number after <code>leagueId=</code> is what you need. Or just paste the whole URL above.</p></div>';
  html += '<div class="setup-nav-buttons">';
  html += '<button class="btn btn-secondary" onclick="_setupStep=1;render()">Back</button>';
  html += '<button class="btn btn-primary" onclick="wizardStep2Next()">Next</button></div></div>';
  return html;
}

function wizardValidateLeagueId(value) {
  var extracted = extractLeagueId(value);
  var feedback = document.getElementById('league-id-feedback');
  if (!feedback) return;
  if (!value.trim()) { feedback.innerHTML = ''; return; }
  if (extracted && /^\d+$/.test(extracted)) {
    if (value.trim() !== extracted) {
      feedback.innerHTML = '<span class="form-hint success">Detected League ID: ' + extracted + '</span>';
    } else {
      feedback.innerHTML = '<span class="form-hint success">Looks good!</span>';
    }
  } else {
    feedback.innerHTML = '<span class="form-hint error">Could not detect a valid League ID</span>';
  }
}

function wizardStep2Next() {
  var raw = document.getElementById('setup-league-id').value;
  var leagueId = extractLeagueId(raw);
  if (!leagueId || !/^\d+$/.test(leagueId)) {
    showToast('Please enter a valid League ID', 'error');
    return;
  }
  _wizardData.leagueId = leagueId;
  _setupStep = 3;
  render();
}

// --- STEP 3: COOKIES ---
function renderSetupStep3() {
  var html = '<div class="setup-card"><h2>ESPN Authentication</h2>';
  html += '<p class="text-sm muted" style="margin-bottom:16px">Larry needs your ESPN cookies to access your private league data.</p>';

  // Quick paste
  html += '<div class="form-group"><label>Quick Paste (try pasting both cookies at once)</label>';
  html += '<textarea class="form-input" id="setup-paste-all" rows="3" ';
  html += 'placeholder="Paste cookies here -- Larry will try to detect both espn_s2 and SWID" ';
  html += 'oninput="wizardParseCookies(this.value)"></textarea>';
  html += '<div id="paste-all-feedback" class="form-feedback"></div></div>';

  html += '<div class="setup-divider"><span>or enter individually</span></div>';

  // espn_s2
  html += '<div class="form-group"><label>espn_s2 Cookie</label>';
  html += '<input type="text" class="form-input" id="setup-s2" ';
  html += 'placeholder="Long string (200+ characters)" ';
  html += 'value="' + esc(_wizardData.espnS2) + '" ';
  html += 'oninput="wizardValidateS2(this.value)" />';
  html += '<div id="s2-feedback" class="form-feedback"></div></div>';

  // SWID
  html += '<div class="form-group"><label>SWID Cookie</label>';
  html += '<input type="text" class="form-input" id="setup-swid" ';
  html += 'placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}" ';
  html += 'value="' + esc(_wizardData.swid) + '" ';
  html += 'oninput="wizardValidateSwid(this.value)" />';
  html += '<div id="swid-feedback" class="form-feedback"></div></div>';

  // Collapsible guide
  html += '<details class="cookie-guide"><summary>How to find your ESPN cookies</summary>';
  html += '<div class="cookie-guide-content">';
  html += '<div class="cookie-step"><span class="cookie-step-num">1</span>';
  html += '<div>Go to <a href="https://fantasy.espn.com" target="_blank" rel="noopener">fantasy.espn.com</a> and make sure you\'re logged in</div></div>';
  html += '<div class="cookie-step"><span class="cookie-step-num">2</span>';
  html += '<div>Open DevTools: <kbd>F12</kbd> (Windows) or <kbd>Cmd+Opt+I</kbd> (Mac)</div></div>';
  html += '<div class="cookie-step"><span class="cookie-step-num">3</span>';
  html += '<div>Click the <strong>Application</strong> tab, then expand <strong>Cookies</strong> in the left sidebar</div></div>';
  html += '<div class="cookie-step"><span class="cookie-step-num">4</span>';
  html += '<div>Click on <code>https://fantasy.espn.com</code></div></div>';
  html += '<div class="cookie-step"><span class="cookie-step-num">5</span>';
  html += '<div>Find <code>espn_s2</code> and <code>SWID</code> in the list. Double-click each value to select it, then copy.</div></div>';
  html += '</div></details>';

  if (_wizardError) {
    html += '<div class="alert alert-danger" style="margin-top:12px">' + esc(_wizardError) + '</div>';
  }

  html += '<div class="setup-nav-buttons">';
  html += '<button class="btn btn-secondary" onclick="_setupStep=2;render()">Back</button>';
  html += '<button class="btn btn-primary" onclick="wizardStep3Next()">Next</button></div></div>';
  return html;
}

function wizardParseCookies(value) {
  var result = tryParseBothCookies(value);
  var feedback = document.getElementById('paste-all-feedback');
  if (!feedback) return;
  var found = [];
  if (result.espnS2) {
    found.push('espn_s2');
    _wizardData.espnS2 = result.espnS2;
    var s2Input = document.getElementById('setup-s2');
    if (s2Input) s2Input.value = result.espnS2;
    wizardValidateS2(result.espnS2);
  }
  if (result.swid) {
    found.push('SWID');
    _wizardData.swid = result.swid;
    var swidInput = document.getElementById('setup-swid');
    if (swidInput) swidInput.value = result.swid;
    wizardValidateSwid(result.swid);
  }
  if (found.length === 2) {
    feedback.innerHTML = '<span class="form-hint success">Found both cookies!</span>';
  } else if (found.length === 1) {
    feedback.innerHTML = '<span class="form-hint warning">Found ' + found[0] + ' but not the other. Enter the missing one below.</span>';
  } else if (value.trim()) {
    feedback.innerHTML = '<span class="form-hint error">Could not detect cookies. Try pasting them individually below.</span>';
  } else {
    feedback.innerHTML = '';
  }
}

function wizardValidateS2(value) {
  var result = validateEspnS2(value);
  var feedback = document.getElementById('s2-feedback');
  if (!feedback) return;
  if (!value || !value.trim()) { feedback.innerHTML = ''; return; }
  feedback.innerHTML = result.valid
    ? '<span class="form-hint success">Length OK (' + value.trim().length + ' chars)</span>'
    : '<span class="form-hint error">' + result.hint + '</span>';
}

function wizardValidateSwid(value) {
  var result = validateSWID(value);
  var feedback = document.getElementById('swid-feedback');
  if (!feedback) return;
  if (!value || !value.trim()) { feedback.innerHTML = ''; return; }
  feedback.innerHTML = result.valid
    ? '<span class="form-hint success">Format looks correct</span>'
    : '<span class="form-hint error">' + result.hint + '</span>';
}

function wizardStep3Next() {
  var s2 = (document.getElementById('setup-s2').value || '').trim();
  var swid = (document.getElementById('setup-swid').value || '').trim();
  var s2Result = validateEspnS2(s2);
  var swidResult = validateSWID(swid);
  if (!s2Result.valid) { _wizardError = s2Result.hint; render(); return; }
  if (!swidResult.valid) { _wizardError = swidResult.hint; render(); return; }
  _wizardData.espnS2 = s2Result.value || s2;
  _wizardData.swid = swidResult.value || swid;
  _wizardError = null;
  _wizardConnectTriggered = false;
  _setupStep = 4;
  render();
}

// --- STEP 4: CONNECT + TEAM SELECTION ---
function renderSetupStep4() {
  var html = '<div class="setup-card">';

  if (_wizardConnecting) {
    html += '<div class="setup-connecting">';
    html += '<div class="setup-spinner"></div>';
    html += '<h2>Connecting to ESPN...</h2>';
    html += '<p class="text-sm muted">Fetching your league data. This may take a few seconds.</p></div>';
  } else if (S.espn.connected && S.teams.length > 0) {
    html += '<div class="success-badge">&#9989;</div>';
    html += '<h2>Connected to ' + esc(S.league.name) + '</h2>';
    html += '<p class="text-sm muted" style="margin-bottom:4px">' + esc(S.league.scoringType) + ' &middot; ' + S.league.teamCount + ' teams &middot; ' + S.league.categories.map(function(c){return c.abbr;}).join(', ') + '</p>';
    html += '<h3 style="margin:16px 0 8px;font-size:0.95rem">Select Your Team</h3>';
    html += renderTeamList(function(teamId) { return 'wizardSelectTeam(' + teamId + ')'; });
    html += '<div class="setup-nav-buttons" style="margin-top:16px">';
    html += '<button class="btn btn-secondary" onclick="_setupStep=3;S.espn.connected=false;render()">Back</button></div>';
  } else if (_wizardError) {
    html += '<div class="error-icon">&#10060;</div>';
    html += '<h2>Connection Failed</h2>';
    html += '<div class="alert alert-danger" style="margin:12px 0">' + esc(_wizardError) + '</div>';
    html += '<div class="setup-nav-buttons">';
    html += '<button class="btn btn-secondary" onclick="_setupStep=3;_wizardError=null;render()">Back to Cookies</button>';
    html += '<button class="btn btn-primary" onclick="_wizardConnectTriggered=false;wizardConnect()">Retry</button></div>';
  } else if (!_wizardConnectTriggered) {
    _wizardConnectTriggered = true;
    html += '<div class="setup-connecting">';
    html += '<div class="setup-spinner"></div>';
    html += '<p class="muted">Preparing connection...</p></div>';
    setTimeout(wizardConnect, 100);
  }

  html += '</div>';
  return html;
}

async function testConnection() {
  S.espn.leagueId = _wizardData.leagueId;
  S.espn.espnS2 = _wizardData.espnS2;
  S.espn.swid = _wizardData.swid;
  autosave();

  try {
    var data = await ESPNSync.fetchLeague();
    if (data) {
      ESPNSync._lastLeagueData = data;
      ESPNSync.parseLeagueSettings(data);
      ESPNSync.parseTeams(data);
      if (S.myTeam.teamId > 0) ESPNSync.parseMatchup(data);
      S.espn.connected = true;
      S.espn.lastSync = new Date().toISOString();
      addSyncLog('success', 'Connected. ' + S.teams.length + ' teams, ' + S.allPlayers.length + ' players.');
      autosave();
      return { success: true, data: data };
    } else {
      return { success: false, errorType: 'empty', message: 'No data returned. Double-check your League ID.' };
    }
  } catch (e) {
    var msg = e.message || '';
    var hint = '';
    if (msg.indexOf('401') >= 0 || msg.indexOf('403') >= 0) {
      hint = 'Your cookies appear to be invalid or expired. Try copying fresh espn_s2 and SWID values from your browser.';
    } else if (msg.indexOf('404') >= 0) {
      hint = 'League not found. Double-check the League ID and make sure it\'s a current season league.';
    } else if (msg.indexOf('Failed to fetch') >= 0 || msg.indexOf('NetworkError') >= 0 || msg.indexOf('timed out') >= 0) {
      hint = 'Network error. Check your internet connection and try again.';
    } else {
      hint = 'Unexpected error: ' + msg;
    }
    addSyncLog('error', msg);
    return { success: false, errorType: 'error', message: hint };
  }
}

async function wizardConnect() {
  _wizardConnecting = true;
  _wizardError = null;
  render();

  var result = await testConnection();
  _wizardConnecting = false;

  if (result.success) {
    render();
  } else {
    _wizardError = result.message;
    render();
  }
}

function wizardSelectTeam(teamId) {
  if (ESPNSync.selectTeam(teamId)) {
    if (ESPNSync._lastLeagueData) ESPNSync.parseMatchup(ESPNSync._lastLeagueData);
    S.myTeam.owner = (S.teams.find(function(t) { return t.teamId === teamId; }) || {}).owner || '';
    completeSetup();
  } else {
    showToast('Failed to select team', 'error');
  }
}

function completeSetup() {
  S.setupComplete = true; S.initialized = true; S.currentTab = 0;
  saveState(); buildNav(); render(); updateNav();
  startAutoRefresh();
  showToast('Welcome to Larry! Your command center is ready.', 'success');
}

function resetSetup() {
  S.espn = initState().espn; S.league = initState().league; S.myTeam = initState().myTeam;
  S.teams = []; S.setupComplete = false; S.espn.connected = false;
  _setupStep = 1; _wizardData = { leagueId: '', espnS2: '', swid: '' };
  _wizardError = null; _wizardConnecting = false; _wizardConnectTriggered = false;
  saveState(); render();
}

// --- AUTO REFRESH (v3: on load + every 2 min) ---
function startAutoRefresh() {
  if (AUTO_REFRESH_TIMER) clearInterval(AUTO_REFRESH_TIMER);
  if (!S.espn.connected) return;
  // Sync immediately on load
  ESPNSync.syncAll();
  // Then every 2 minutes
  AUTO_REFRESH_TIMER = setInterval(function() {
    ESPNSync.syncAll();
  }, 2 * 60 * 1000);
}

function startAutoSync() { startAutoRefresh(); }

function addSyncLog(status, message) {
  S.espn.syncLog.unshift({ timestamp: new Date().toISOString(), status: status, message: message });
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
  var now = localNow(); var target = new Date(dateStr);
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

function ordinal(n) {
  var s = ['th','st','nd','rd'];
  var v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function statusBadge(status) {
  switch ((status || '').toUpperCase()) {
    case 'ACTIVE': case 'HEALTHY': return '<span class="status-badge healthy">\u{1F7E2}</span>';
    case 'GTD': case 'DAY_TO_DAY': case 'GAME_TIME_DECISION': return '<span class="status-badge gtd">\u{1F7E1}</span>';
    case 'OUT': case 'SUSPENSION': return '<span class="status-badge out">\u{1F534}</span>';
    case 'IR': case 'INJURED_RESERVE': return '<span class="status-badge ir">\u26AA</span>';
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

function timeSince(dateStr) {
  var seconds = Math.floor((new Date() - new Date(dateStr)) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}

// --- TOAST ---
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
  if (overlay) { overlay.classList.add('active'); var inp = document.getElementById('global-search'); if (inp) inp.focus(); }
}

function closeSearch() {
  var overlay = document.getElementById('search-overlay');
  if (overlay) overlay.classList.remove('active');
}

function handleSearch(query) {
  var resultsEl = document.getElementById('search-results');
  if (!resultsEl) return;
  if (!query || query.length < 2) { resultsEl.innerHTML = ''; return; }
  var q = query.toLowerCase();
  var matches = S.allPlayers.filter(function(p) { return p.name && p.name.toLowerCase().indexOf(q) >= 0; }).slice(0, 15);
  var html = '';
  matches.forEach(function(p) {
    html += '<div class="search-result-item" onclick="closeSearch();openPlayerPopup(' + p.id + ')">';
    html += '<div class="search-result-headshot">' + playerHeadshot(p, 28) + '</div>';
    html += '<div><strong>' + esc(p.name) + '</strong><div class="search-result-meta">' + p.positions.join('/') + ' | ' + p.nbaTeam + '</div></div></div>';
  });
  if (!matches.length) html = '<p class="muted" style="padding:12px;">No results for "' + esc(query) + '"</p>';
  resultsEl.innerHTML = html;
}

// --- HELP ---
function handleGlobalSearch(query) { handleSearch(query); }

function toggleHelp() {
  var overlay = document.getElementById('help-overlay');
  if (overlay) overlay.classList.toggle('active');
}

// --- STATS KEY MODAL (v3 new) ---
function openStatsKey() {
  var overlay = document.getElementById('stats-key-overlay');
  if (overlay) overlay.classList.add('open');
}

function closeStatsKey() {
  var overlay = document.getElementById('stats-key-overlay');
  if (overlay) overlay.classList.remove('open');
}

// --- SYNC INDICATOR ---
function updateSyncIndicator(status) {
  var el = document.getElementById('sync-status');
  if (!el) return;
  if (status === 'syncing') {
    el.className = 'sync-indicator syncing';
    el.innerHTML = 'Syncing...';
  } else if (status === 'error') {
    el.className = 'sync-indicator error';
    el.innerHTML = 'Sync error';
  } else if (S.espn.connected && S.espn.lastSync) {
    el.className = 'sync-indicator connected';
    el.innerHTML = timeSince(S.espn.lastSync);
  } else {
    el.className = 'sync-indicator';
    el.innerHTML = 'Not connected';
  }
}

// --- PLAYER HEADSHOTS ---
function playerHeadshot(player, size) {
  size = size || 32;
  if (!player || !player.id) return playerInitials(player, size);
  var url = 'https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/' + player.id + '.png&w=' + (size * 2) + '&h=' + Math.round(size * 1.46) + '&cb=1';
  var teamColor = ESPN_TEAM_COLORS[player.nbaTeam] || '#666';
  return '<img src="' + url + '" width="' + size + '" height="' + size + '" class="player-headshot" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
    '<span class="player-initials" style="display:none;width:' + size + 'px;height:' + size + 'px;background:' + teamColor + '">' + getInitials(player.name) + '</span>';
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

// --- LARRY AVATAR ---
function getLarryAvatar(size) {
  size = size || 32;
  return '<img src="assets/larry-logo.svg" width="' + size + '" height="' + size + '" alt="Larry" style="border-radius:50%">';
}

// --- APP INITIALIZATION ---
function initApp() {
  loadState();
  // Sync theme: standalone localStorage key is source of truth
  var storedTheme = getCurrentThemeId();
  if (S.prefs.theme !== storedTheme) S.prefs.theme = storedTheme;
  applyTheme(S.prefs.theme);
  buildNav();
  initKeyboard();
  render();
  updateNav();
  if (S.setupComplete && S.espn.connected) {
    startAutoRefresh();
    updateSyncIndicator();
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function(e) { console.warn('SW failed:', e); });
  }
}

document.addEventListener('DOMContentLoaded', initApp);
