// ============================================================
// LARRY'S MOVE
// One answer to "what should I do today to win this matchup".
//
// Never calls the API on render. The card only fetches when the user taps
// the button or Refresh, and the result is cached in S.analysisCache keyed
// on the sync time, the local date, and a hash of the payload. Rendering
// an LLM call would bill on every tab switch.
// ============================================================

var _larryMoveLoading = false;
var _larryMoveError = '';

// Cheap non-cryptographic hash. Only needs to change when the payload does.
function larryMoveHash(obj) {
  var str;
  try { str = JSON.stringify(obj); } catch (e) { return ''; }
  var h = 5381;
  for (var i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return String(h >>> 0) + '-' + str.length;
}

function larryMoveCache() {
  S.analysisCache = S.analysisCache || {};
  return S.analysisCache.larryMove || null;
}

// A cached answer is good for today, from this sync, for this payload.
// "Today" is computed from local date, not toISOString, or the card would
// roll over at the wrong hour for anyone west of UTC.
function larryMoveCacheValid(payloadHash) {
  var c = larryMoveCache();
  if (!c || !c.result) return false;
  if (c.syncedAt !== (S.espn && S.espn.lastSync)) return false;
  if (c.dateLocal !== localDateStr(new Date())) return false;
  if (payloadHash && c.payloadHash !== payloadHash) return false;
  return true;
}

// Stale means: we have an answer, but something changed under it.
function larryMoveIsStale() {
  var c = larryMoveCache();
  if (!c || !c.result) return false;
  return !larryMoveCacheValid(null);
}

function larryMovePlayer(p, includeOwnership) {
  // Whether he plays TODAY, read from the schedule now. p.gamesToday is
  // stamped at sync time, so after midnight, or on the roster's own stub
  // copies, it can describe a different day.
  var todayStr = localDateStr(new Date());
  var today = null;
  (p.schedule || []).forEach(function(g) { if (!today && g && g.date === todayStr) today = g; });
  if (!today && !(p.schedule && p.schedule.length) && p.gamesToday) today = p.gameToday || { opponent: '' };
  var slotEligible = (p.eligibleSlots || []).map(function(sid) {
    return ESPN_SLOT_MAP[sid];
  }).filter(Boolean);
  var out = {
    id: p.id,
    name: p.name,
    team: p.nbaTeam,
    pos: p.positions || [],
    slot: p.slot,
    slotEligible: slotEligible,
    injury: Engines.normalizeInjuryStatus(p.injuryStatus),
    rawInjury: p.injuryStatus,
    irEligible: larryMoveIrEligible(p),
    gamesToday: !!today,
    gameToday: today ? {
      opp: today.opponent,
      home: !!today.isHome,
      timeLocal: today.timeLocal || today.time || ''
    } : null,
    gamesLeftThisWeek: p.gamesRemaining || 0,
    perGame: larryMovePerGame(p),
    gp: p.gamesPlayed || 0,
    mpg: p.minutesPerGame || 0,
    value: p.durantScore || 0,
    trend: p.trend || 'stable'
  };
  if (includeOwnership) out.pctOwned = p.percentOwned || 0;
  return out;
}

// Season line blended toward ESPN's projection early on (blendedPerGame
// in core.js). An unplayed player's all-zero line once read as "no
// production" and Larry told the owner to drop Peyton Watson on day two.
function larryMovePerGame(p) {
  var pg = blendedPerGame(p);
  Object.keys(pg).forEach(function(k) { pg[k] = Math.round(pg[k] * 10) / 10; });
  return pg;
}

// ESPN's rule: only OUT or INJURY_RESERVE players may occupy an IR slot,
// and there has to be a free one.
function larryMoveIrEligible(p) {
  if (Engines.normalizeInjuryStatus(p.injuryStatus) !== 'OUT') return false;
  if (p.slotId === 13) return false; // already there
  var irSlots = (S.league && S.league.irSlots) || 0;
  if (!irSlots) return false;
  var used = (S.myTeam.players || []).filter(function(x) { return x.slotId === 13; }).length;
  return used < irSlots;
}

// ESPN's lineupLocktimeType, mapped to something the prompt can reason
// about. This was hard-coded to 'daily'. INDIVIDUAL_GAME is meaningfully
// different: a slot locks when that player's game tips, so you can still
// swap players in later games after the early ones have started.
function larryMoveLineupLock() {
  var t = String((S.league && S.league.lineupLocktimeType) || '').toUpperCase();
  if (t === 'INDIVIDUAL_GAME') return 'individual_game';
  if (t.indexOf('WEEK') >= 0) return 'weekly';
  if (t === 'FIRST_GAME_OF_DAY' || t.indexOf('DAY') >= 0) return 'daily';
  return 'individual_game';
}

// The draft date as a readable local string, or '' when ESPN has not set
// one. settings.draftSettings.date is epoch ms.
function larryMoveDraftDateStr() {
  var ms = S.league && S.league.draftDate;
  if (!ms) return '';
  var d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) +
    ' at ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Nothing to advise on before the draft, so do not spend an API call
// discovering that. The card says when the draft is instead.
function larryMoveIsPreDraft() {
  return !((S.myTeam && S.myTeam.players) || []).length;
}

// Day N of M for the matchup window, from local date strings.
function larryMoveWindowDays(win) {
  if (!win || !win.startStr || !win.endStr) return { dayOf: 0, total: 0 };
  var count = function(a, b) {
    var pa = a.split('-'), pb = b.split('-');
    var da = new Date(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
    var db = new Date(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
    return Math.round((db - da) / 86400000) + 1;
  };
  var total = count(win.startStr, win.endStr);
  var today = localDateStr(new Date());
  var dayOf = today < win.startStr ? 0 : (today > win.endStr ? total : count(win.startStr, today));
  return { dayOf: dayOf, total: total };
}

function buildLarryMovePayload() {
  // Same reason as buildChatContext: a sync clears the rank cache and only
  // render paths recompute it, so tapping the Move button first after a
  // sync sent undefined ranks.
  Engines.ensureDURANT(S.allPlayers || []);

  var cats = getOrderedCategories();
  // Roster stubs carry the lineup slot; the live player in S.allPlayers
  // carries the schedule and stats. Merge them, keeping the slot.
  var myPlayers = (S.myTeam.players || []).map(function(stub) {
    var full = Engines.enrichPlayer(stub);
    return full === stub ? stub : Object.assign({}, full, { slot: stub.slot, slotId: stub.slotId });
  });
  var strat = (S.matchup && S.matchup.strategy) || {};
  // The real matchup window. getMatchupDates is a calendar-week guess and
  // reported the wrong day count in opening week and the playoffs.
  var win = getMatchupWindow() || {};
  var winDays = larryMoveWindowDays(win);

  var oppTeam = null;
  for (var i = 0; i < (S.teams || []).length; i++) {
    if (S.teams[i].teamId === S.matchup.opponentTeamId) { oppTeam = S.teams[i]; break; }
  }

  var freeAgents = (S.allPlayers || []).filter(function(p) {
    return p.onTeamId === 0 && Engines.isValidAddCandidate(p);
  });
  freeAgents.sort(byDurantRank);

  var engineRecs = [];
  try {
    engineRecs = Engines.generateRecommendations(myPlayers, S.allPlayers || [])
      .slice(0, 5).map(function(r) {
        return {
          type: r.type,
          add: r.player ? r.player.name : '',
          drop: r.dropPlayer ? r.dropPlayer.name : '',
          improvement: r.improvement || 0,
          detail: r.detail || '',
          action: r.action || ''
        };
      });
  } catch (e) {
    engineRecs = [];
  }

  var irUsed = myPlayers.filter(function(p) { return p.slotId === 13; }).length;

  return {
    kind: 'larry-move',
    today: localDateStr(new Date()),
    syncedAt: (S.espn && S.espn.lastSync) || '',
    league: {
      scoringType: S.league.scoringType,
      categories: cats.map(function(c) { return c.abbr; }),
      teamCount: S.league.teamCount,
      startingSlots: S.league.startingSlots,
      benchSlots: S.league.benchSlots,
      irSlots: S.league.irSlots || 0,
      irUsed: irUsed,
      // Season cap and per-matchup cap are different numbers. Only the
      // season one used to be sent, so a league with 3 pickups a matchup
      // looked unlimited to Larry.
      acquisitionLimit: S.league.acquisitionLimit,
      acquisitionsUsed: (S.myTeam && S.myTeam.acquisitionsUsed) || 0,
      matchupAcquisitionLimit: S.league.matchupAcquisitionLimit === undefined ?
        -1 : S.league.matchupAcquisitionLimit,
      matchupAcquisitionsUsed: (S.myTeam && S.myTeam.matchupAcquisitionsUsed) || 0,
      lineupLock: larryMoveLineupLock()
    },
    matchup: {
      period: S.league.currentMatchupPeriod || 0,
      daysLeft: win.daysLeft || 0,
      // How far into the matchup we are. On day 1 at 0-0 nothing is
      // decided, and Larry needs to be told that in numbers.
      dayOfMatchup: winDays.dayOf,
      matchupDays: winDays.total,
      projected: strat.projected || null,
      // The real matchup window, which is a span of ESPN weeks and not a
      // Monday-to-Sunday calendar week. Opening week is short (Tue through
      // Sun) and playoff matchups run two weeks, so "how many days are
      // left" is not something Larry can infer from the date alone.
      startDate: S.matchup.startDate || '',
      endDate: S.matchup.endDate || '',
      opponentName: S.matchup.opponentName || '',
      myScores: S.matchup.myScores || {},
      oppScores: S.matchup.oppScores || {},
      myGamesLeft: S.matchup.myGamesRemaining || 0,
      oppGamesLeft: S.matchup.oppGamesRemaining || 0,
      winProb: strat.winProb || {},
      strategy: {
        locks: strat.locks || [],
        targets: strat.targets || [],
        punts: strat.punts || []
      }
    },
    myRoster: myPlayers.map(function(p) { return larryMovePlayer(p, false); }),
    // Capped to keep the prompt near 6k tokens.
    freeAgents: freeAgents.slice(0, 15).map(function(p) { return larryMovePlayer(p, true); }),
    oppRoster: oppTeam ? (oppTeam.players || []).slice(0, 13).map(function(p) {
      var e = Engines.enrichPlayer(p);
      return {
        name: e.name,
        pos: e.positions || [],
        injury: Engines.normalizeInjuryStatus(e.injuryStatus),
        gamesLeftThisWeek: e.gamesRemaining || 0,
        perGame: larryMovePerGame(e)
      };
    }) : [],
    engineRecs: engineRecs,
    ruleSummary: {
      irRule: 'ESPN: only OUT or INJURY_RESERVE players can occupy an IR slot',
      lineupLock: S.league.lineupLock || 'daily'
    }
  };
}

function requestLarryMove(force) {
  if (_larryMoveLoading) return;
  // Pre-draft there is no roster to advise on. Previously this still made
  // the API call and Larry answered "roster data isn't showing", which
  // reads like a bug rather than the expected state.
  if (larryMoveIsPreDraft()) {
    _larryMoveError = '';
    renderLarryMoveCard();
    return;
  }
  var payload;
  try {
    payload = buildLarryMovePayload();
  } catch (e) {
    _larryMoveError = 'Could not read your roster: ' + e.message;
    renderLarryMoveCard();
    return;
  }
  var hash = larryMoveHash(payload);
  payload.payloadHash = hash;

  if (!force && larryMoveCacheValid(hash)) {
    renderLarryMoveCard();
    return;
  }

  _larryMoveLoading = true;
  _larryMoveError = '';
  renderLarryMoveCard();

  // One automatic retry for a transient upstream failure (the server caches
  // by payloadHash, so a retry after a slow success is free).
  postLarryMove(payload, 1).then(function(data) {
    if (!data || !data.move) throw new Error('Larry did not return an answer.');
    S.analysisCache = S.analysisCache || {};
    S.analysisCache.larryMove = {
      syncedAt: (S.espn && S.espn.lastSync) || '',
      generatedAt: new Date().toISOString(),
      dateLocal: localDateStr(new Date()),
      payloadHash: hash,
      result: data.move
    };
    // A fresh answer always opens, even if the last one was collapsed.
    if (S.prefs && S.prefs.collapsedSections) S.prefs.collapsedSections.larryMoveCard = false;
    autosave();
  }).catch(function(e) {
    _larryMoveError = e.message || 'Something went wrong.';
  }).then(function() {
    _larryMoveLoading = false;
    renderLarryMoveCard();
  });
}

// The function streams newline-delimited JSON: progress lines while the
// model writes, then {"move":...} and {"done":true}, or an {"error":...}
// line if it failed after the stream started. Streaming is what lets the
// answer take longer than Netlify's 10-second limit on a buffered reply.
// The card is structured, so the client simply waits for the whole stream.
function parseLarryMoveStream(text) {
  var out = { move: null, error: '' };
  String(text || '').split('\n').forEach(function(line) {
    if (!line.trim()) return;
    var obj;
    try { obj = JSON.parse(line); } catch (e) { return; }
    if (obj && obj.move) out.move = obj.move;
    if (obj && obj.error && !out.move) out.error = String(obj.error);
  });
  return out;
}

function postLarryMove(payload, retriesLeft) {
  return fetch('/.netlify/functions/larry-move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(res) {
    return res.text().catch(function() { return ''; }).then(function(text) {
      if (res.ok) {
        var parsed = parseLarryMoveStream(text);
        if (parsed.move) return { move: parsed.move };
        throw new Error(parsed.error || 'Larry did not return an answer.');
      }
      var data = null;
      try { data = JSON.parse(text); } catch (e) { data = null; }
      // 502/500 are transient upstream failures and worth one more try. A
      // 504 already waited up to 25 seconds, so retrying it would double the
      // wait; a 400 or 429 will not get better on its own.
      var retryable = res.status === 502 || res.status === 500;
      if (retryable && retriesLeft > 0) {
        return postLarryMove(payload, retriesLeft - 1);
      }
      var err = new Error(
        res.status === 504
          ? 'Larry took too long. Tap Retry to try again.'
          : (data && data.error ? data.error : 'Request failed')
      );
      err.status = res.status;
      throw err;
    });
  });
}

var LARRY_MOVE_ICONS = {
  lineup: '\u{1F504}',
  add_drop: '\u{1F501}',
  ir: '\u{1F3E5}',
  hold: '\u{270B}',
  stream: '\u{26A1}'
};

// The card re-renders itself only. Calling render() here would rebuild the
// whole Roster tab and lose date-nav and search state.
function renderLarryMoveCard() {
  var el = document.getElementById('larry-move-card');
  if (!el) return;
  el.innerHTML = larryMoveCardHtml();
}

function larryMoveCardHtml() {
  // Pre-draft state wins over everything: there is genuinely nothing to
  // say until there is a roster.
  if (larryMoveIsPreDraft()) {
    var when = larryMoveDraftDateStr();
    return '<div class="card"><div class="card-header">Larry\'s Move</div>' +
      '<div style="padding:12px" class="text-sm">' +
      (when
        ? 'Your draft is ' + esc(when) + '. Larry\'s Move starts once you have a roster.'
        : 'Larry\'s Move starts once you have a roster.') +
      '</div></div>';
  }

  if (_larryMoveLoading) {
    return '<div class="card"><div class="card-header">Larry\'s Move</div>' +
      '<div style="padding:16px;text-align:center" aria-live="polite">' +
      '<div class="typing-dots"><span>.</span><span>.</span><span>.</span></div>' +
      '<div class="text-xs muted" style="margin-top:6px">Larry is thinking...</div></div></div>';
  }

  if (_larryMoveError) {
    return '<div class="card"><div class="card-header">Larry\'s Move</div>' +
      '<div style="padding:12px" role="alert">' +
      '<p class="text-sm">' + esc(_larryMoveError) + '</p>' +
      larryMoveFallbackHtml() +
      '<button class="btn btn-primary" style="min-height:44px;margin-top:8px" ' +
      'onclick="requestLarryMove(true)">Try again</button></div></div>';
  }

  var cache = larryMoveCache();
  if (!cache || !cache.result) return renderLarryMoveButton();
  var m = cache.result;
  var stale = larryMoveIsStale();

  // The whole answer collapses to its header and headline once read, so it
  // does not push the roster down the page for the rest of the day.
  var collapsed = isSectionCollapsed('larryMoveCard');
  var html = '<div class="card">';
  html += '<button type="button" class="card-header larry-move-toggle" ' +
    'aria-expanded="' + (collapsed ? 'false' : 'true') + '" ' +
    'onclick="toggleLarryMoveCard()">' +
    '<span>Larry\'s Move' +
    (stale ? ' <span class="text-xs muted">(data changed)</span>' : '') + '</span>' +
    '<span class="larry-move-chevron" aria-hidden="true">' + (collapsed ? '\u25B8' : '\u25BE') + '</span></button>';
  if (collapsed) {
    html += '<div style="padding:4px 12px 12px;cursor:pointer" onclick="toggleLarryMoveCard()">' +
      '<p class="larry-move-headline-collapsed">' + esc(m.headline) + '</p></div></div>';
    return html;
  }
  html += '<div style="padding:12px">';

  html += '<p style="font-size:1rem;font-weight:600;margin:0 0 10px">' + esc(m.headline) + '</p>';

  if (!m.noMove && m.actions && m.actions.length) {
    html += '<div class="larry-move-actions">';
    m.actions.forEach(function(a, i) {
      var icon = LARRY_MOVE_ICONS[a.type] || '\u{1F4A1}';
      var detailId = 'larry-move-detail-' + i;
      html += '<div class="larry-move-action">';
      html += '<button type="button" class="larry-move-row" style="min-height:44px" ' +
        'aria-expanded="false" aria-controls="' + detailId + '" ' +
        'onclick="toggleLarryMoveDetail(this, \'' + detailId + '\')">';
      html += '<span class="larry-move-icon">' + icon + '</span>';
      html += '<span class="larry-move-text"><strong>' + esc(a.action) + '</strong>';
      html += '<span class="text-xs muted">' + esc(a.reason) + '</span></span>';
      html += '<span class="larry-move-chevron">\u{203A}</span>';
      html += '</button>';
      html += '<div class="larry-move-detail" id="' + detailId + '" hidden>' +
        esc(a.detail || '') + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  // "Why" collapses by default and remembers its state.
  var whyCollapsed = isSectionCollapsed('larryMoveWhy');
  html += '<div style="margin-top:10px">';
  html += '<button type="button" class="btn btn-sm btn-secondary" style="min-height:44px" ' +
    'aria-expanded="' + (whyCollapsed ? 'false' : 'true') + '" ' +
    'onclick="toggleSection(\'larryMoveWhy\');renderLarryMoveCard()">' +
    (whyCollapsed ? 'Why?' : 'Hide why') + '</button>';
  if (!whyCollapsed) {
    var mr = m.matchupRead || {};
    html += '<div style="margin-top:10px;font-size:0.85rem">';
    html += '<p>' + esc(mr.summary || '') + '</p>';
    if (mr.winning && mr.winning.length) {
      html += '<p><strong>Winning:</strong> ' + esc(mr.winning.join(', ')) + '</p>';
    }
    if (mr.close && mr.close.length) {
      html += '<p><strong>Close:</strong> ' + esc(mr.close.join(', ')) + '</p>';
    }
    if (mr.losing && mr.losing.length) {
      html += '<p><strong>Losing:</strong> ' + esc(mr.losing.join(', ')) + '</p>';
    }
    if (m.risks && m.risks.length) {
      html += '<p><strong>Risks</strong></p><ul>';
      m.risks.forEach(function(r) { html += '<li>' + esc(r) + '</li>'; });
      html += '</ul>';
    }
    if (m.wouldChangeIf && m.wouldChangeIf.length) {
      html += '<p><strong>What would change this</strong></p><ul>';
      m.wouldChangeIf.forEach(function(r) { html += '<li>' + esc(r) + '</li>'; });
      html += '</ul>';
    }
    var du = m.dataUsed || {};
    if (du.acquisitions) {
      html += '<p class="text-xs muted">Acquisitions: ' + esc(du.acquisitions) + '</p>';
    }
    html += '<p class="text-xs muted">Confidence: ' + esc(m.confidence || 'medium') + '</p>';
    html += '</div>';
  }
  html += '</div>';

  html += '<div class="text-xs muted" style="margin-top:10px;display:flex;' +
    'align-items:center;gap:8px;flex-wrap:wrap">';
  html += '<span>Based on sync at ' +
    esc(cache.syncedAt ? new Date(cache.syncedAt).toLocaleTimeString() : 'unknown') + '</span>';
  html += '<button class="btn btn-sm btn-secondary" style="min-height:44px" ' +
    'onclick="requestLarryMove(true)">Refresh</button>';
  html += '</div>';

  html += '</div></div>';
  return html;
}

// Collapse or expand the answer card without rebuilding the whole tab
// (toggleSection re-renders everything and loses scroll position).
function toggleLarryMoveCard() {
  S.prefs.collapsedSections = S.prefs.collapsedSections || {};
  S.prefs.collapsedSections.larryMoveCard = !S.prefs.collapsedSections.larryMoveCard;
  autosave();
  renderLarryMoveCard();
}

function toggleLarryMoveDetail(btn, id) {
  var el = document.getElementById(id);
  if (!el) return;
  var open = !el.hidden;
  el.hidden = open;
  btn.setAttribute('aria-expanded', open ? 'false' : 'true');
}

// When the AI call fails, the engine's own top suggestions are still worth
// showing: they are computed locally and never depend on the network.
function larryMoveFallbackHtml() {
  var recs;
  try {
    recs = Engines.generateRecommendations(S.myTeam.players || [], S.allPlayers || []);
  } catch (e) {
    return '';
  }
  var list = [];
  var seen = {};
  (Array.isArray(recs) ? recs : []).forEach(function(r) {
    if (list.length >= 2 || !r || !r.player || seen[r.player.id]) return;
    seen[r.player.id] = true;
    list.push('Add ' + (r.player.name || '') + (r.dropPlayer ? ', drop ' + (r.dropPlayer.name || '') : ''));
  });
  if (!list.length) return '';
  return '<div class="text-xs muted" style="margin-top:6px">Meanwhile, Larry\'s numbers suggest:</div>' +
    '<ul class="text-sm" style="margin:4px 0 0 18px">' +
    list.map(function(s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
}

// The call to action at the top of the Roster tab. A full-width button
// with a label, because the old 20px logo was not recognisable as one.
function renderLarryMoveButton() {
  var stale = larryMoveIsStale();
  return '<button id="larry-move-btn" type="button" class="larry-move-cta' +
    (stale ? ' pulse-once' : '') + '" onclick="requestLarryMove(false)" ' +
    'aria-label="Get Larry\'s Move: what to do today to win this matchup">' +
    '<span class="larry-move-cta-icon">' + getLarryAvatar(36) + '</span>' +
    '<span class="larry-move-cta-text"><strong>Get Larry\'s Move</strong>' +
    '<span>What to do today to win this matchup</span></span>' +
    '<span class="larry-move-cta-arrow">\u203A</span></button>';
}
