// ============================================================
// LEAGUE REPORTS: Last Night, Rookie Report, LM Notes
// ============================================================
//
// All three read real box scores and rosters from ESPN's public site API
// (the same host the player card's news already uses from the browser), not
// the fantasy API: one night's box scores cover every NBA player who played,
// rostered or not, and need no league cookies.
//
// Box scores for a finished night never change, so they are cached in
// localStorage under larry_day_lines. A night is only cached once every game
// on it is final.

var Reports = (function() {
  var SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
  var DAY_KEY = 'larry_day_lines';
  var ROOKIE_KEY = 'larry_rookies';
  var DAY_CACHE_MAX = 40;
  var STAT_LABELS = ['MIN', 'REB', 'AST', 'STL', 'BLK', 'PTS'];

  var _days = {};      // dateStr -> { status: 'loading'|'ready'|'error', data, error }
  var _rookies = null; // { status, data, error }

  // ---------- storage ----------
  function readStore(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function writeStore(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* full or blocked */ }
  }

  function cachedDay(dateStr) {
    var store = readStore(DAY_KEY);
    return store && store.days && store.days[dateStr] ? store.days[dateStr] : null;
  }
  function cacheDay(dateStr, data) {
    var store = readStore(DAY_KEY) || { v: 1, days: {} };
    if (!store.days) store.days = {};
    store.days[dateStr] = data;
    var keys = Object.keys(store.days).sort();
    while (keys.length > DAY_CACHE_MAX) { delete store.days[keys.shift()]; }
    writeStore(DAY_KEY, store);
  }

  function fetchJSON(url) {
    return fetch(url).then(function(r) {
      if (!r.ok) throw new Error('ESPN returned ' + r.status);
      return r.json();
    });
  }

  // ---------- box scores ----------

  // One game's box score into players[id] = { n, t, s: { MIN, REB, ... } }.
  // ESPN lists stat columns by label, so look each one up rather than
  // trusting a column position.
  function parseBox(summary, players) {
    var teams = (summary && summary.boxscore && summary.boxscore.players) || [];
    teams.forEach(function(team) {
      var abbr = team.team ? (team.team.abbreviation || '') : '';
      (team.statistics || []).forEach(function(block) {
        var labels = block.labels || block.names || [];
        var idx = {};
        STAT_LABELS.forEach(function(l) { idx[l] = labels.indexOf(l); });
        (block.athletes || []).forEach(function(a) {
          if (!a || !a.athlete || a.didNotPlay || !a.stats || !a.stats.length) return;
          var s = {};
          STAT_LABELS.forEach(function(l) {
            var v = idx[l] >= 0 ? parseFloat(a.stats[idx[l]]) : 0;
            s[l] = isFinite(v) ? v : 0;
          });
          if (!s.MIN && !s.PTS && !s.REB && !s.AST) return;
          players[a.athlete.id] = { n: a.athlete.displayName || a.athlete.shortName || '', t: abbr, s: s };
        });
      });
    });
  }

  function loadDay(dateStr) {
    var ymd = dateStr.replace(/-/g, '');
    return fetchJSON(SITE + 'scoreboard?dates=' + ymd).then(function(board) {
      var events = (board && board.events) || [];
      var started = events.filter(function(e) {
        var st = e.status && e.status.type ? e.status.type.state : '';
        return st === 'in' || st === 'post';
      });
      var complete = events.length > 0 && events.every(function(e) {
        return e.status && e.status.type && e.status.type.state === 'post';
      });
      var players = {};
      return Promise.all(started.map(function(e) {
        return fetchJSON(SITE + 'summary?event=' + e.id).then(function(sum) {
          parseBox(sum, players);
        });
      })).then(function() {
        var data = { date: dateStr, games: events.length, played: started.length,
          complete: complete, players: players };
        if (complete) cacheDay(dateStr, data);
        return data;
      });
    });
  }

  // Synchronous read for a renderer: returns the state now and starts a
  // fetch if needed, calling onReady when it lands.
  function day(dateStr, onReady) {
    var mem = _days[dateStr];
    if (mem && (mem.status === 'loading' || mem.status === 'ready')) return mem;
    var cached = cachedDay(dateStr);
    if (cached) {
      _days[dateStr] = { status: 'ready', data: cached };
      return _days[dateStr];
    }
    _days[dateStr] = { status: 'loading' };
    loadDay(dateStr).then(function(data) {
      _days[dateStr] = { status: 'ready', data: data };
      if (onReady) onReady();
    }, function(err) {
      _days[dateStr] = { status: 'error', error: err && err.message ? err.message : 'failed' };
      if (onReady) onReady();
    });
    return _days[dateStr];
  }

  // Forget an unfinished night so the next render refetches it.
  function refreshDay(dateStr) { delete _days[dateStr]; }

  // ---------- scoring ----------
  //
  // "Best line" across the five categories. Each category is standardised
  // against everyone who played in the same sample, so a 5-block night and a
  // 40-point night are on one scale, then summed. Internal only: users see
  // the stat line and the order, never the number.
  function scoreLines(players, cats) {
    var ids = Object.keys(players || {});
    var stats = {};
    cats.forEach(function(cat) {
      var vals = ids.map(function(id) { return players[id].s[cat.abbr] || 0; });
      var mean = vals.reduce(function(a, b) { return a + b; }, 0) / (vals.length || 1);
      var v = vals.reduce(function(a, b) { return a + (b - mean) * (b - mean); }, 0) / (vals.length || 1);
      stats[cat.abbr] = { mean: mean, sd: Math.sqrt(v) || 1 };
    });
    return ids.map(function(id) {
      var p = players[id];
      var score = 0;
      cats.forEach(function(cat) {
        var st = stats[cat.abbr];
        var z = ((p.s[cat.abbr] || 0) - st.mean) / st.sd;
        if (cat.isNegative) z = -z;
        score += z;
      });
      return { id: id, n: p.n, t: p.t, s: p.s, g: p.g || 1, score: score };
    }).sort(function(a, b) { return b.score - a.score; });
  }

  // Sum several nights into week totals per player, counting games.
  function sumDays(dayDatas) {
    var out = {};
    dayDatas.forEach(function(d) {
      Object.keys((d && d.players) || {}).forEach(function(id) {
        var p = d.players[id];
        if (!out[id]) out[id] = { n: p.n, t: p.t, s: {}, g: 0 };
        out[id].g++;
        Object.keys(p.s).forEach(function(k) { out[id].s[k] = (out[id].s[k] || 0) + p.s[k]; });
      });
    });
    return out;
  }

  // Top n in one category.
  function leaders(players, abbr, n, negative) {
    return Object.keys(players || {}).map(function(id) {
      var p = players[id];
      return { id: id, n: p.n, t: p.t, s: p.s, g: p.g || 1, v: p.s[abbr] || 0 };
    }).sort(function(a, b) { return negative ? a.v - b.v : b.v - a.v; }).slice(0, n);
  }

  // ---------- rookies ----------
  //
  // ESPN's team rosters carry each player's years of experience; zero is a
  // rookie. Thirty small requests, refreshed once a day.
  function loadRookies() {
    var teamIds = Object.keys(ESPN_TEAM_MAP);
    var out = {};
    return Promise.all(teamIds.map(function(tid) {
      return fetchJSON(SITE + 'teams/' + tid + '/roster').then(function(data) {
        var list = (data && data.athletes) || [];
        // Some sports group athletes by position; NBA is flat. Handle both.
        var flat = [];
        list.forEach(function(a) {
          if (a && a.items) flat = flat.concat(a.items); else flat.push(a);
        });
        flat.forEach(function(a) {
          if (!a || !a.id) return;
          var yrs = a.experience && typeof a.experience.years === 'number' ? a.experience.years : null;
          if (yrs === 0) out[a.id] = { n: a.fullName || a.displayName || '', t: ESPN_TEAM_MAP[tid] || '' };
        });
      }, function() { /* one team failing should not lose the other 29 */ });
    })).then(function() {
      var data = { fetchedOn: localDateStr(new Date()), ids: out };
      if (Object.keys(out).length) writeStore(ROOKIE_KEY, data);
      return data;
    });
  }

  function rookies(onReady) {
    if (_rookies && (_rookies.status === 'loading' || _rookies.status === 'ready')) return _rookies;
    var stored = readStore(ROOKIE_KEY);
    if (stored && stored.fetchedOn === localDateStr(new Date()) && stored.ids) {
      _rookies = { status: 'ready', data: stored };
      return _rookies;
    }
    _rookies = { status: 'loading', stale: stored };
    loadRookies().then(function(data) {
      _rookies = { status: 'ready', data: Object.keys(data.ids).length ? data : (stored || data) };
      if (onReady) onReady();
    }, function(err) {
      _rookies = stored ? { status: 'ready', data: stored }
        : { status: 'error', error: err && err.message ? err.message : 'failed' };
      if (onReady) onReady();
    });
    return _rookies;
  }

  return {
    day: day,
    refreshDay: refreshDay,
    scoreLines: scoreLines,
    sumDays: sumDays,
    leaders: leaders,
    rookies: rookies,
    _internal: { parseBox: parseBox, loadDay: loadDay, loadRookies: loadRookies }
  };
})();


// ---------- shared page helpers ----------

function reportPlayer(id) {
  var n = Number(id);
  return (S.allPlayers || []).find(function(p) { return p.id === n; }) || null;
}

// Fantasy owner of an NBA player: the team name, "Free agent", or "".
function reportOwner(id) {
  var p = reportPlayer(id);
  if (!p) return 'Free agent';
  if (!(p.onTeamId > 0)) return 'Free agent';
  if (S.myTeam && p.onTeamId === S.myTeam.teamId) return 'Your team';
  var t = (S.teams || []).find(function(x) { return x.teamId === p.onTeamId; });
  return t ? t.name : 'Rostered';
}

function statLine(s, cats, games) {
  var parts = [];
  cats.forEach(function(cat) {
    var v = s[cat.abbr] || 0;
    parts.push((games > 1 ? fmt(v, 0) : String(Math.round(v))) + ' ' + cat.abbr);
  });
  return parts.join(', ');
}

function reportRerender(page) {
  return function() {
    if (S.leagueSubPage === page) render();
  };
}

function shiftDateStr(dateStr, days) {
  var parts = dateStr.split('-');
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

function prettyDate(dateStr) {
  var parts = dateStr.split('-');
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function reportLoading(msg) {
  return '<div class="empty-state"><p>' + esc(msg || 'Loading box scores...') + '</p></div>';
}


// ============================================================
// LAST NIGHT
// ============================================================
var _lastNightDate = null;

function lastNightDefault() {
  return shiftDateStr(localDateStr(new Date()), -1);
}

function setLastNightDate(dateStr) {
  _lastNightDate = dateStr;
  render();
}

function renderLastNightPage() {
  var cats = getOrderedCategories();
  var dateStr = _lastNightDate || lastNightDefault();
  var today = localDateStr(new Date());

  var html = '<div class="card"><div style="padding:10px 12px;display:flex;align-items:center;gap:8px">';
  html += '<button class="btn btn-sm btn-secondary" style="min-height:44px;min-width:44px" ' +
    'onclick="setLastNightDate(\'' + shiftDateStr(dateStr, -1) + '\')">\u276E</button>';
  html += '<div style="flex:1;text-align:center;font-weight:700">' + esc(prettyDate(dateStr)) + '</div>';
  var next = shiftDateStr(dateStr, 1);
  html += '<button class="btn btn-sm btn-secondary" style="min-height:44px;min-width:44px"' +
    (next > today ? ' disabled' : '') + ' onclick="setLastNightDate(\'' + next + '\')">\u276F</button>';
  html += '</div></div>';

  var st = Reports.day(dateStr, reportRerender('lastNight'));
  if (st.status === 'loading') return html + reportLoading();
  if (st.status === 'error') {
    return html + '<div class="empty-state"><p>Could not load box scores (' + esc(st.error) + ').</p>' +
      '<button class="btn btn-sm btn-secondary" style="min-height:44px" onclick="Reports.refreshDay(\'' +
      dateStr + '\');render()">Retry</button></div>';
  }
  var data = st.data;
  if (!data.games) return html + '<div class="empty-state"><p>No NBA games on this day.</p></div>';
  if (!data.played) return html + '<div class="empty-state"><p>No games have started yet.</p></div>';
  if (!data.complete) {
    html += '<div class="text-xs muted" style="padding:0 12px 8px">' + data.played + ' of ' + data.games +
      ' games started, still in progress. <a href="#" onclick="Reports.refreshDay(\'' + dateStr +
      '\');render();return false">Refresh</a></div>';
  }

  var ranked = Reports.scoreLines(data.players, cats);
  if (!ranked.length) return html + '<div class="empty-state"><p>No box scores yet.</p></div>';

  // Monstrous line of the night.
  var top = ranked[0];
  html += '<div class="card"><div style="padding:12px">';
  html += '<div class="text-xs muted">\u{1F479} Monstrous line of the night</div>';
  html += '<div style="font-size:1.1rem;font-weight:800;margin-top:2px;cursor:pointer" onclick="reportOpen(' + top.id + ')">' +
    esc(top.n) + ' <span class="text-xs muted">' + esc(top.t) + '</span></div>';
  html += '<div class="text-sm" style="margin-top:4px">' + esc(statLine(top.s, cats, 1)) +
    ' <span class="text-xs muted">in ' + Math.round(top.s.MIN || 0) + ' min</span></div>';
  html += '<div class="text-xs muted" style="margin-top:2px">' + esc(reportOwner(top.id)) + '</div>';
  if (ranked.length > 1) {
    html += '<div style="margin-top:10px" class="text-xs muted">Next best</div>';
    ranked.slice(1, 5).forEach(function(r) {
      html += '<div class="text-xs" style="padding:3px 0;cursor:pointer" onclick="reportOpen(' + r.id + ')"><strong>' +
        esc(r.n) + '</strong> ' + esc(statLine(r.s, cats, 1)) + ' <span class="muted">' +
        esc(reportOwner(r.id)) + '</span></div>';
    });
  }
  html += '</div></div>';

  // Player of the day in each category.
  html += '<div class="card"><div class="card-header">Player of the day, by category</div>';
  cats.forEach(function(cat) {
    var top3 = Reports.leaders(data.players, cat.abbr, 3, cat.isNegative);
    if (!top3.length) return;
    html += '<div style="padding:8px 12px;border-top:1px solid var(--border)">';
    html += '<div class="text-xs" style="color:' + cat.color + ';font-weight:700">' + cat.abbr + '</div>';
    top3.forEach(function(r, i) {
      html += '<div style="display:flex;gap:8px;align-items:baseline;padding:2px 0;cursor:pointer" onclick="reportOpen(' + r.id + ')">' +
        '<span style="min-width:28px;font-weight:' + (i === 0 ? '800' : '400') + '">' + Math.round(r.v) + '</span>' +
        '<span style="flex:1;font-weight:' + (i === 0 ? '700' : '400') + '">' + esc(r.n) +
        ' <span class="text-xs muted">' + esc(r.t) + '</span></span>' +
        '<span class="text-xs muted">' + esc(reportOwner(r.id)) + '</span></div>';
    });
    html += '</div>';
  });
  html += '</div>';
  return html;
}

// Open the player card when the player is in the league's pool.
function reportOpen(id) {
  if (reportPlayer(id) && typeof openPlayerPopup === 'function') openPlayerPopup(Number(id));
}


// ============================================================
// ROOKIE REPORT
// ============================================================
//
// Every rookie in the player pool, Larry rank first, with recent minutes
// and production and which way it is moving. For a free agent it makes a
// pickup call: grab, watch, or pass.

// Recent form against the season on the five categories plus minutes.
// Returns 'up', 'down' or 'flat'.
function rookieTrend(p, cats) {
  var recent = ESPNSync.getPerGameStats(p, 'last7');
  var season = ESPNSync.getPerGameStats(p, 'season');
  if (!recent || !season) return 'flat';
  var keys = cats.map(function(c) { return c.abbr; }).concat(['MIN']);
  var sumR = 0, sumS = 0, n = 0;
  keys.forEach(function(k) {
    if (season[k] > 0) { sumR += (recent[k] || 0) / season[k]; sumS += 1; n++; }
  });
  if (!n) return 'flat';
  var ratio = sumR / sumS;
  if (p.trend === 'hot' || ratio >= 1.15) return 'up';
  if (p.trend === 'cold' || ratio <= 0.85) return 'down';
  return 'flat';
}

// Pickup call for an unrostered rookie. Roster-worthy means inside the
// number of rostered spots in the league.
function rookieCall(p, trend) {
  var spots = ((S.league && S.league.teamCount) || 12) * ((S.league && S.league.rosterSize) || 13);
  var rank = p.noEvidence ? null : p.durantRank;
  if (p.injuryStatus && /^(OUT|SUSPENSION|IR|INJURED_RESERVE)$/i.test(p.injuryStatus)) {
    return { label: 'Hurt', cls: 'muted', why: 'Not playing right now.' };
  }
  if (rank && rank <= spots && trend !== 'down') {
    return { label: 'Pick up', cls: 'pos', why: 'Roster-worthy now' + (trend === 'up' ? ' and trending up.' : '.') };
  }
  if (rank && rank <= spots * 1.4 && trend === 'up') {
    return { label: 'Watch', cls: 'gold', why: 'Trending up, not quite there yet.' };
  }
  if (trend === 'up') return { label: 'Watch', cls: 'gold', why: 'Minutes and production rising.' };
  return { label: 'Pass', cls: 'muted', why: 'Not a fantasy factor yet.' };
}

var _rookieFilter = 'all';
function setRookieFilter(v) { _rookieFilter = v; render(); }

function renderRookieReport() {
  var st = Reports.rookies(reportRerender('rookies'));
  if (st.status === 'loading') return reportLoading('Finding this year\'s rookies...');
  if (st.status === 'error') {
    return '<div class="empty-state"><p>Could not load NBA rosters (' + esc(st.error) + ').</p></div>';
  }
  var ids = st.data.ids || {};
  if (typeof Engines !== 'undefined' && Engines.ensureDURANT) Engines.ensureDURANT(S.allPlayers || []);
  var cats = getOrderedCategories();
  var list = (S.allPlayers || []).filter(function(p) { return ids[p.id]; });
  if (!list.length) {
    return '<div class="empty-state"><p>No rookies in the player pool yet. Sync to refresh.</p></div>';
  }

  var rows = list.map(function(p) {
    var trend = rookieTrend(p, cats);
    return { p: p, trend: trend, call: p.onTeamId > 0 ? null : rookieCall(p, trend) };
  });
  rows.sort(function(a, b) { return byDurantRank(a.p, b.p); });
  var nUp = rows.filter(function(r) { return r.trend === 'up'; }).length;
  var nGrab = rows.filter(function(r) { return r.call && r.call.label === 'Pick up'; }).length;

  if (_rookieFilter === 'fa') rows = rows.filter(function(r) { return !(r.p.onTeamId > 0); });
  else if (_rookieFilter === 'up') rows = rows.filter(function(r) { return r.trend === 'up'; });

  var html = '<div class="card"><div style="padding:10px 12px">';
  html += '<div class="text-sm">' + list.length + ' rookies in the pool. <strong>' + nUp + '</strong> trending up, ' +
    '<strong>' + nGrab + '</strong> worth picking up.</div>';
  html += '<div class="text-xs muted" style="margin-top:2px">Trend is the last 7 days against the season, minutes included. Refreshed daily.</div>';
  html += '<div class="filter-chips" style="margin-top:8px">';
  [['all', 'All'], ['fa', 'Free agents'], ['up', 'Trending up']].forEach(function(f) {
    html += '<button class="chip' + (_rookieFilter === f[0] ? ' active' : '') + '" onclick="setRookieFilter(\'' +
      f[0] + '\')">' + f[1] + '</button>';
  });
  html += '</div></div></div>';

  if (!rows.length) return html + '<div class="empty-state"><p>Nobody matches that filter.</p></div>';

  rows.forEach(function(r) {
    var p = r.p;
    var recent = ESPNSync.getPerGameStats(p, 'last7') || ESPNSync.getPerGameStats(p, 'season');
    var season = ESPNSync.getPerGameStats(p, 'season');
    var arrow = r.trend === 'up' ? '<span style="color:var(--accent-green)">\u2B06 Up</span>' :
      (r.trend === 'down' ? '<span style="color:var(--accent-red)">\u2B07 Down</span>' :
        '<span class="muted">\u2794 Steady</span>');
    html += '<div class="card watch-card">';
    html += '<div class="watch-head"><div style="flex:1;min-width:0;cursor:pointer" onclick="openPlayerPopup(' + p.id + ')">' +
      renderPlayerCell(p) + '</div>';
    if (r.call) {
      var col = r.call.cls === 'pos' ? 'var(--accent-green)' : (r.call.cls === 'gold' ? 'var(--accent-gold)' : 'var(--text-muted)');
      html += '<span class="rookie-call" style="border-color:' + col + ';color:' + col + '">' + r.call.label + '</span>';
    }
    html += '</div>';
    html += '<div class="watch-meta">' + larryRankText(p) + ' &middot; ' + esc(reportOwner(p.id)) + ' &middot; ' +
      arrow + ' &middot; ' + (season && season.MIN ? fmt(season.MIN, 1) + ' min' : 'no games yet') +
      (recent && season && recent.MIN && recent !== season ? ' (' + fmt(recent.MIN, 1) + ' last 7)' : '') + '</div>';
    if (recent) {
      html += '<div class="watch-grid">';
      cats.forEach(function(cat) {
        html += '<div><div class="text-xs" style="color:' + cat.color + '">' + cat.abbr + '</div><div><strong>' +
          (recent[cat.abbr] != null ? fmt(recent[cat.abbr], 1) : '--') + '</strong></div></div>';
      });
      html += '</div>';
    }
    if (r.call) html += '<div class="text-xs muted" style="margin-top:4px">' + esc(r.call.why) + '</div>';
    html += '</div>';
  });
  return html;
}


// ============================================================
// LM NOTES
// ============================================================
//
// The commissioner's weekly write-up, built from the week's real results:
// matchup scores, Team of the Week, player of the week (best five-category
// week by matchup totals), line of the week, blowout and nail-biter, and
// who led the league in each category. One Copy button produces plain text
// ready to paste into the league chat.

var _lmMatchup = null;

function lmDefaultMatchup() {
  var cur = Number(S.league && S.league.currentMatchupPeriod) || 1;
  return cur > 1 ? cur - 1 : cur;
}

function setLmMatchup(mp) { _lmMatchup = mp; render(); }

// The dates of a matchup, first day through the earlier of its last day and
// yesterday (today's games are not over).
function lmDates(mp) {
  var win = ESPNSync.windowForMatchup ? ESPNSync.windowForMatchup(mp) : null;
  if (!win || !win.startStr) return [];
  var last = shiftDateStr(localDateStr(new Date()), -1);
  var end = win.endStr < last ? win.endStr : last;
  var out = [];
  var d = win.startStr;
  while (d <= end && out.length < 21) { out.push(d); d = shiftDateStr(d, 1); }
  return out;
}

function lmTeamName(teamId) {
  var t = (S.teams || []).find(function(x) { return x.teamId === teamId; });
  return t ? t.name : ('Team ' + teamId);
}

// Pure: matchup results and the fun stats from schedule category totals.
function computeLmTeamStats(schedule, mp, cats) {
  var games = (schedule || []).filter(function(m) {
    return m.matchupPeriodId === mp && m.home && m.away && m.home.cats && m.away.cats;
  });
  var results = games.map(function(m) {
    var r = totwCompare(cats, m.home.cats, m.away.cats);
    // Closeness: category record first, then how near the categories were.
    var rel = 0;
    cats.forEach(function(cat) {
      var a = m.home.cats[cat.abbr] || 0, b = m.away.cats[cat.abbr] || 0;
      rel += Math.abs(a - b) / (Math.max(a, b) || 1);
    });
    var homeWon = r.w > r.l;
    return {
      winner: homeWon ? m.home : (r.l > r.w ? m.away : null),
      loser: homeWon ? m.away : (r.l > r.w ? m.home : null),
      home: m.home, away: m.away,
      score: homeWon ? r : { w: r.l, l: r.w, t: r.t },
      margin: Math.abs(r.w - r.l), rel: rel
    };
  });
  var blowout = results.slice().sort(function(a, b) { return (b.margin - a.margin) || (b.rel - a.rel); })[0] || null;
  var closest = results.slice().sort(function(a, b) { return (a.margin - b.margin) || (a.rel - b.rel); })[0] || null;
  var kings = {};
  cats.forEach(function(cat) {
    var best = null;
    games.forEach(function(m) {
      [m.home, m.away].forEach(function(side) {
        var v = side.cats[cat.abbr] || 0;
        if (!best || (cat.isNegative ? v < best.v : v > best.v)) best = { teamId: side.teamId, v: v };
      });
    });
    kings[cat.abbr] = best;
  });
  return { results: results, blowout: blowout, closest: closest, kings: kings };
}

function renderLmNotesPage() {
  var cats = getOrderedCategories();
  var cur = Number(S.league && S.league.currentMatchupPeriod) || 1;
  var mp = _lmMatchup || lmDefaultMatchup();
  var isLive = mp >= cur;

  var html = '<div class="card"><div style="padding:10px 12px;display:flex;align-items:center;gap:8px">';
  html += '<button class="btn btn-sm btn-secondary" style="min-height:44px;min-width:44px"' + (mp <= 1 ? ' disabled' : '') +
    ' onclick="setLmMatchup(' + (mp - 1) + ')">\u276E</button>';
  html += '<div style="flex:1;text-align:center"><div style="font-weight:700">Matchup ' + mp + '</div>' +
    '<div class="text-xs muted">' + (isLive ? 'In progress, so far' : 'Final') + '</div></div>';
  html += '<button class="btn btn-sm btn-secondary" style="min-height:44px;min-width:44px"' + (mp >= cur ? ' disabled' : '') +
    ' onclick="setLmMatchup(' + (mp + 1) + ')">\u276F</button>';
  html += '</div></div>';

  var dates = lmDates(mp);
  var team = computeLmTeamStats(S.league.schedule, mp, cats);
  var totw = computeTeamOfWeek(S.league.schedule, mp, cats);

  // Box scores for every night of the matchup, for player of the week.
  var loading = 0, failed = 0, days = [];
  var rer = reportRerender('lmNotes');
  dates.forEach(function(d) {
    var st = Reports.day(d, rer);
    if (st.status === 'loading') loading++;
    else if (st.status === 'error') failed++;
    else days.push(st.data);
  });

  var notes = buildLmNotes(mp, isLive, cats, team, totw, days);

  html += '<div class="card"><div style="padding:10px 12px;display:flex;gap:8px;align-items:center">' +
    '<div style="flex:1" class="text-xs muted">' +
    (loading ? 'Loading box scores (' + (dates.length - loading) + ' of ' + dates.length + ' nights)...' :
      (failed ? failed + ' night(s) could not be loaded; player awards may be incomplete.' : 'Ready to paste into the league chat.')) +
    '</div><button class="btn btn-sm btn-primary" style="min-height:44px" onclick="copyLmNotes()">Copy</button></div>';
  html += '<pre class="lm-notes" id="lm-notes-text">' + esc(notes) + '</pre></div>';
  return html;
}

// Plain text, so it pastes cleanly into any group chat.
function buildLmNotes(mp, isLive, cats, team, totw, days) {
  var L = [];
  L.push('LARRY\'S LM NOTES: MATCHUP ' + mp + (isLive ? ' (SO FAR)' : ''));
  L.push('');

  if (team.results.length) {
    L.push('RESULTS');
    team.results.forEach(function(r) {
      if (r.winner) {
        L.push('- ' + lmTeamName(r.winner.teamId) + ' def. ' + lmTeamName(r.loser.teamId) + ' ' + recText(r.score));
      } else {
        L.push('- ' + lmTeamName(r.home.teamId) + ' and ' + lmTeamName(r.away.teamId) + ' tied ' + recText(r.score));
      }
    });
    L.push('');
  }

  if (totw && totw.winners.length) {
    var t = totw.winners[0];
    L.push('TEAM OF THE WEEK: ' + lmTeamName(t.teamId) + ' (' + recText(t.record) + ' against the other winners)');
    L.push('');
  }

  var weekly = Reports.sumDays(days);
  var ranked = Reports.scoreLines(weekly, cats);
  if (ranked.length) {
    var pw = ranked[0];
    L.push('PLAYER OF THE WEEK: ' + pw.n + ' (' + reportOwner(pw.id) + ')');
    L.push('  ' + statLine(pw.s, cats, 2) + ' in ' + pw.g + ' game' + (pw.g === 1 ? '' : 's'));
    if (ranked.length > 1) {
      L.push('  Runners-up: ' + ranked.slice(1, 4).map(function(r) {
        return r.n + ' (' + reportOwner(r.id) + ')';
      }).join(', '));
    }
    L.push('');
  }

  // Best single game of the week.
  var bestLine = null;
  days.forEach(function(d) {
    var r = Reports.scoreLines(d.players, cats)[0];
    if (r && (!bestLine || r.score > bestLine.r.score)) bestLine = { r: r, date: d.date };
  });
  if (bestLine) {
    L.push('LINE OF THE WEEK: ' + bestLine.r.n + ', ' + prettyDate(bestLine.date) + ' (' + reportOwner(bestLine.r.id) + ')');
    L.push('  ' + statLine(bestLine.r.s, cats, 1));
    L.push('');
  }

  if (team.blowout && team.blowout.winner) {
    L.push('BIGGEST BLOWOUT: ' + lmTeamName(team.blowout.winner.teamId) + ' over ' +
      lmTeamName(team.blowout.loser.teamId) + ', ' + recText(team.blowout.score));
  }
  if (team.closest && team.closest !== team.blowout) {
    var c = team.closest;
    L.push('NAIL-BITER: ' + (c.winner ? lmTeamName(c.winner.teamId) + ' edged ' + lmTeamName(c.loser.teamId)
      : lmTeamName(c.home.teamId) + ' and ' + lmTeamName(c.away.teamId) + ' tied') + ', ' + recText(c.score));
  }
  if (team.blowout || team.closest) L.push('');

  var kingLines = [];
  cats.forEach(function(cat) {
    var k = team.kings[cat.abbr];
    if (k) kingLines.push('- ' + cat.abbr + ': ' + lmTeamName(k.teamId) + ' (' + fmt(k.v, 0) + ')');
  });
  if (kingLines.length) {
    L.push('CATEGORY KINGS');
    L = L.concat(kingLines);
    L.push('');
  }

  // Category leaders among players for the week.
  var catLeaders = [];
  cats.forEach(function(cat) {
    var top = Reports.leaders(weekly, cat.abbr, 1, cat.isNegative)[0];
    if (top) catLeaders.push('- ' + cat.abbr + ': ' + top.n + ' ' + fmt(top.v, 0) + ' (' + reportOwner(top.id) + ')');
  });
  if (catLeaders.length) {
    L.push('WEEKLY LEADERS');
    L = L.concat(catLeaders);
  }
  return L.join('\n').replace(/\n+$/, '');
}

function copyLmNotes() {
  var el = document.getElementById('lm-notes-text');
  if (!el) return;
  var text = el.textContent || '';
  var done = function() { if (typeof toast === 'function') toast('Copied'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function() { fallbackCopy(text); done(); });
  } else {
    fallbackCopy(text);
    done();
  }
}

function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* nothing more to try */ }
  document.body.removeChild(ta);
}
