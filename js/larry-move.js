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
    gamesToday: !!p.gamesToday,
    gameToday: p.gameToday ? {
      opp: p.gameToday.opponent,
      home: !!p.gameToday.isHome,
      timeLocal: p.gameToday.time || ''
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

function larryMovePerGame(p) {
  var cats = getOrderedCategories();
  var season = (p.stats && p.stats.season) || {};
  var pg = {};
  cats.forEach(function(cat) {
    var v = season[cat.abbr];
    pg[cat.abbr] = typeof v === 'number' && isFinite(v) ? Math.round(v * 10) / 10 : 0;
  });
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

function buildLarryMovePayload() {
  // Same reason as buildChatContext: a sync clears the rank cache and only
  // render paths recompute it, so tapping the Move button first after a
  // sync sent undefined ranks.
  Engines.ensureDURANT(S.allPlayers || []);

  var cats = getOrderedCategories();
  var myPlayers = (S.myTeam.players || []).slice();
  var strat = (S.matchup && S.matchup.strategy) || {};
  var dates = getMatchupDates() || {};

  var oppTeam = null;
  for (var i = 0; i < (S.teams || []).length; i++) {
    if (S.teams[i].teamId === S.matchup.opponentTeamId) { oppTeam = S.teams[i]; break; }
  }

  var freeAgents = (S.allPlayers || []).filter(function(p) {
    return p.onTeamId === 0 && Engines.isValidAddCandidate(p);
  });
  freeAgents.sort(function(a, b) { return durantKey(b.durantScore) - durantKey(a.durantScore); });

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
      daysLeft: dates.daysLeft || 0,
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

  // One automatic retry. The call sits close to Netlify's 10s synchronous
  // ceiling, so an occasional timeout is expected rather than a real
  // failure, and the retry usually lands (the server caches by payloadHash,
  // so a retry after a slow success is free).
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
    autosave();
  }).catch(function(e) {
    _larryMoveError = e.message || 'Something went wrong.';
  }).then(function() {
    _larryMoveLoading = false;
    renderLarryMoveCard();
  });
}

function postLarryMove(payload, retriesLeft) {
  return fetch('/.netlify/functions/larry-move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(res) {
    return res.json().catch(function() { return null; }).then(function(data) {
      if (res.ok) return data;
      // 504 is our own timeout, 502/500 a transient upstream failure. Those
      // are worth one more attempt; a 400 or 429 is not.
      var retryable = res.status === 504 || res.status === 502 || res.status === 500;
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
      '<button class="btn btn-sm btn-primary" style="min-height:44px" ' +
      'onclick="requestLarryMove(true)">Retry</button></div></div>';
  }

  var cache = larryMoveCache();
  if (!cache || !cache.result) return '';
  var m = cache.result;
  var stale = larryMoveIsStale();

  var html = '<div class="card">';
  html += '<div class="card-header">Larry\'s Move' +
    (stale ? ' <span class="text-xs muted">(data changed)</span>' : '') + '</div>';
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

function toggleLarryMoveDetail(btn, id) {
  var el = document.getElementById(id);
  if (!el) return;
  var open = !el.hidden;
  el.hidden = open;
  btn.setAttribute('aria-expanded', open ? 'false' : 'true');
}

// The button that lives in the Roster header.
function renderLarryMoveButton() {
  var stale = larryMoveIsStale();
  return '<button id="larry-move-btn" class="header-btn' + (stale ? ' pulse-once' : '') + '" ' +
    'style="min-height:44px;min-width:44px" aria-label="Ask Larry for today\'s move" ' +
    'title="Ask Larry for today\'s move" onclick="requestLarryMove(false)">' +
    getLarryAvatar(20) + '</button>';
}
