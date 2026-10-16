// ============================================================
// LARRY v3.25 -- DRAFT ROOM
// Mock drafts against AI managers built from the league's real draft
// history. See docs/DRAFT_ROOM_SPEC.md.
// ============================================================
//
// PRIVACY: profiles are league members' data. They are computed in the
// browser from a live fetch, held in localStorage, and never committed,
// never sent to the chat or Move functions.
//
// The engine work (profiles, the pick model, availability odds) lives in
// src/engine/draftProfiles.ts and src/engine/mockDraft.ts and reaches this
// file through window.LarryEngine. Everything here is presentation and
// state plumbing.

var DraftRoom = (function() {

  var MOCK_KEY = 'larry_mock_draft';
  var CATS = ['REB', 'AST', 'STL', 'BLK', 'PTS'];

  // --- Module state. Rebuilt from localStorage on each page open. ---
  var _order = null;            // teamId per overall pick
  var _ownersByTeam = null;     // teamId -> memberId, current season
  var _orderLoading = false;
  var _orderError = null;

  var _profiles = null;         // memberId -> profile
  var _seasonsUsed = [];
  var _building = false;
  var _buildProgress = '';
  var _buildError = null;

  var _board = null;            // PreparedBoard
  var _config = null;           // MockDraftConfig
  var _mock = null;             // { seed, picks }
  var _reasons = {};            // overall -> reason string

  var _search = '';
  var _searchTimer = null;
  var _sortBy = 'larry';
  var _confirmId = null;
  var _openTeamId = null;
  var _autoDraft = false;

  var _avail = null;            // AvailabilityCounts
  var _availKey = null;         // state fingerprint the counts belong to
  var _availRunning = false;
  var _availTimer = null;
  var _availSims = 0;

  // Historical ESPN ADP, from the committed data/espn-adp-history.json.
  // Reach cannot be measured without it: a finished season's ESPN ranks are
  // END-OF-SEASON ranks, not the pre-draft board. Same-origin static file,
  // so the browser can read it even though it cannot reach FantasyPros.
  var ADP_URL = '/data/espn-adp-history.json';
  var _adpHistory = null;
  var _adpState = 'idle';       // idle | loading | done

  function engine() {
    return typeof window !== 'undefined' ? window.LarryEngine : null;
  }

  function ensureAdp() {
    if (_adpState !== 'idle') return;
    if (typeof fetch !== 'function') { _adpState = 'done'; return; }
    _adpState = 'loading';
    fetch(ADP_URL)
      .then(function(resp) {
        if (!resp.ok) throw new Error('ADP history returned ' + resp.status);
        return resp.json();
      })
      .then(function(data) {
        _adpHistory = data;
        _adpState = 'done';
        // Profiles built before this arrived have no reach numbers.
        _profiles = null;
        render();
      })
      .catch(function(err) {
        // Reach is one line on a card. Losing it must not cost the mock.
        console.warn('Could not load ADP history:', err);
        _adpState = 'done';
        render();
      });
  }

  // --- Mock persistence -------------------------------------------------

  function loadMock() {
    try {
      var raw = localStorage.getItem(MOCK_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.order || !parsed.order.length) return null;
      return parsed;
    } catch (e) {
      console.warn('loadMock failed:', e);
      return null;
    }
  }

  function saveMock() {
    if (!_mock || !_order) return;
    try {
      localStorage.setItem(MOCK_KEY, JSON.stringify({
        seed: _mock.seed,
        order: _order,
        picks: _mock.picks,
        startedAt: _mock.startedAt || new Date().toISOString(),
        reasons: _reasons
      }));
    } catch (e) {
      console.warn('saveMock failed:', e);
    }
  }

  function clearMock() {
    try { localStorage.removeItem(MOCK_KEY); } catch (e) { /* ignore */ }
  }

  function newSeed() {
    return Math.floor(Math.random() * 0xffffffff) >>> 0;
  }

  // --- Setup ------------------------------------------------------------

  function myTeamId() {
    return (S.myTeam && S.myTeam.teamId) || null;
  }

  // Pull the current season's draft slots once per page open.
  function ensureOrder() {
    if (_order || _orderLoading) return;
    _orderLoading = true;
    _orderError = null;
    ESPNSync.fetchDraftOrder()
      .then(function(result) {
        _orderLoading = false;
        if (!result.order || !result.order.length) {
          _orderError = 'ESPN has not published the draft order yet.';
        } else {
          _order = result.order;
          _ownersByTeam = result.ownersByTeam;
        }
        render();
      })
      .catch(function(err) {
        _orderLoading = false;
        _orderError = err && err.message ? err.message : 'Could not read the draft order.';
        render();
      });
  }

  function ensureProfiles() {
    if (_profiles) return;
    // Building before the ADP file lands would produce profiles with no
    // reach, and they are cached, so wait for it to settle either way.
    if (_adpState !== 'done') return;
    var api = engine();
    if (!api) return;
    var history = ESPNSync.loadDraftHistory();
    if (!history) return;
    try {
      var result = api.buildDraftProfiles(history, _adpHistory || undefined);
      _profiles = result.profiles;
      _seasonsUsed = result.seasonsUsed;
    } catch (e) {
      console.warn('buildDraftProfiles failed:', e);
      _buildError = e && e.message ? e.message : 'Could not build profiles.';
    }
  }

  function buildProfiles() {
    if (_building) return;
    _building = true;
    _buildError = null;
    _buildProgress = 'Starting...';
    render();

    ESPNSync.fetchDraftHistory(function(message) {
      _buildProgress = message;
      var el = document.getElementById('draft-build-progress');
      if (el) el.textContent = message;
    })
      .then(function() {
        _building = false;
        _profiles = null;
        ensureProfiles();
        // Profiles change how the AI picks, so an in-flight mock is no
        // longer the draft it claims to be.
        resetMock(false);
        render();
      })
      .catch(function(err) {
        _building = false;
        _buildError = err && err.message ? err.message : 'Could not read the draft history.';
        render();
      });
  }

  function rebuildProfiles() {
    ESPNSync.clearDraftHistory();
    _profiles = null;
    _seasonsUsed = [];
    buildProfiles();
  }

  // Map the app's player pool onto the engine's board shape.
  function boardPlayers() {
    var players = S.allPlayers || [];
    var out = [];
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (!p || !p.id) continue;
      var rate = (p.stats && p.stats.projectedRate) || null;
      var perGame = {
        REB: rate ? (rate.REB || 0) : 0,
        AST: rate ? (rate.AST || 0) : 0,
        STL: rate ? (rate.STL || 0) : 0,
        BLK: rate ? (rate.BLK || 0) : 0,
        PTS: rate ? (rate.PTS || 0) : 0
      };
      out.push({
        playerId: p.id,
        name: p.name || '',
        posId: p.defaultPositionId || 0,
        proTeamId: p.proTeamId || 0,
        espnAdp: (typeof p.espnAdp === 'number' && p.espnAdp > 0) ? p.espnAdp : null,
        espnDraftRank: (typeof p.espnDraftRank === 'number' && p.espnDraftRank > 0) ?
          p.espnDraftRank : null,
        larryRank: (typeof p.durantRank === 'number' && p.durantRank > 0) ? p.durantRank : null,
        perGame: perGame
      });
    }
    return out;
  }

  function buildConfig() {
    var api = engine();
    if (!api || !_order) return false;

    Engines.ensureDURANT(S.allPlayers || []);

    var profileByTeam = {};
    var teamCount = (S.teams || []).length || 12;
    for (var i = 0; i < (S.teams || []).length; i++) {
      var team = S.teams[i];
      var memberId = _ownersByTeam ? _ownersByTeam[String(team.teamId)] : null;
      profileByTeam[String(team.teamId)] =
        (memberId && _profiles && _profiles[memberId]) ? _profiles[memberId] : null;
    }

    _config = {
      order: _order,
      teamCount: teamCount,
      players: boardPlayers(),
      profileByTeam: profileByTeam,
      leagueReach: _profiles ? api.leagueReachMedians(_profiles) : { early: 0, mid: 0, late: 0 }
    };
    _board = api.prepareBoard(_config);
    return true;
  }

  function ensureMock() {
    if (_mock) return;
    var saved = loadMock();
    if (saved && _order && saved.order.length === _order.length) {
      _mock = { seed: saved.seed, picks: saved.picks || [], startedAt: saved.startedAt };
      _reasons = saved.reasons || {};
      return;
    }
    resetMock(false);
  }

  function resetMock(shouldRender) {
    _mock = { seed: newSeed(), picks: [], startedAt: new Date().toISOString() };
    _reasons = {};
    _confirmId = null;
    invalidateAvail();
    saveMock();
    if (shouldRender !== false) render();
  }

  // --- Draft actions ----------------------------------------------------

  function onTheClockTeam() {
    if (!_mock || !_order) return null;
    if (_mock.picks.length >= _order.length) return null;
    return _order[_mock.picks.length];
  }

  function userOnClock() {
    return onTheClockTeam() === myTeamId();
  }

  function simOne() {
    if (!_board || !_config || !_mock) return;
    var api = engine();
    var result = api.simulateUntil(_board, _config, _mock, null, 1);
    applyResult(result);
  }

  function simToMyPick() {
    if (!_board || !_config || !_mock) return;
    var api = engine();
    var stopFor = _autoDraft ? null : myTeamId();
    var result = api.simulateUntil(_board, _config, _mock, stopFor);
    applyResult(result);
  }

  function applyResult(result) {
    _mock = { seed: result.state.seed, picks: result.state.picks, startedAt: _mock.startedAt };
    for (var i = 0; i < result.made.length; i++) {
      _reasons[String(result.made[i].pick[0])] = result.made[i].reason;
    }
    _confirmId = null;
    invalidateAvail();
    saveMock();
    render();
  }

  function draftPlayer(playerId) {
    if (!_mock || !_order || !_board) return;
    var teamId = onTheClockTeam();
    if (teamId === null || teamId === undefined) return;
    for (var i = 0; i < _mock.picks.length; i++) {
      if (_mock.picks[i][2] === playerId) return;
    }
    _mock.picks.push([_mock.picks.length + 1, teamId, playerId]);
    _reasons[String(_mock.picks.length)] = teamId === myTeamId() ? 'Your pick' : 'Manual pick';
    _confirmId = null;
    invalidateAvail();
    saveMock();

    if (_autoDraft) { simToMyPick(); return; }
    render();
  }

  // Larry's own recommendation, used by Auto-draft me.
  function autoPickForUser() {
    if (!_board || !_mock) return;
    var api = engine();
    var available = api.availableIdsFor(_board, _mock);
    var id = api.bestAvailableByLarry(_board, available);
    if (id !== null) draftPlayer(id);
  }

  function undo() {
    if (!_mock || !_mock.picks.length) return;
    delete _reasons[String(_mock.picks.length)];
    _mock.picks = _mock.picks.slice(0, -1);
    _confirmId = null;
    invalidateAvail();
    saveMock();
    render();
  }

  function restart() {
    clearMock();
    resetMock(true);
  }

  function toggleAutoDraft() {
    _autoDraft = !_autoDraft;
    render();
  }

  function setSort(mode) {
    _sortBy = mode;
    render();
  }

  function onSearch(value) {
    // Never re-render the input itself: on iOS that dismisses the keyboard.
    // Only the table body is replaced.
    if (_searchTimer) clearTimeout(_searchTimer);
    _searchTimer = setTimeout(function() {
      _search = (value || '').toLowerCase();
      refreshBoardBody();
    }, 180);
  }

  function confirmRow(playerId) {
    _confirmId = _confirmId === playerId ? null : playerId;
    refreshBoardBody();
  }

  function openTeam(teamId) {
    _openTeamId = _openTeamId === teamId ? null : teamId;
    render();
  }

  // --- Availability odds ------------------------------------------------

  function stateKey() {
    return _mock ? _mock.seed + ':' + _mock.picks.length : '';
  }

  function invalidateAvail() {
    _avail = null;
    _availKey = null;
    _availSims = 0;
    _availRunning = false;
    // Any in-flight chunk belongs to a board that no longer exists.
    if (_availTimer) { clearTimeout(_availTimer); _availTimer = null; }
  }

  function startAvail() {
    var api = engine();
    if (!api || !_board || !_config || !_mock) return;
    var me = myTeamId();
    if (!me) return;
    if (_availRunning) return;
    if (_availKey === stateKey() && _avail) return;

    var target = api.MOCK_AVAIL_SIMS;
    var chunk = api.MOCK_AVAIL_CHUNK;
    var key = stateKey();
    _avail = api.emptyAvailabilityCounts();
    _availRunning = true;
    _availSims = 0;
    var started = Date.now();

    function step() {
      if (!_availRunning || key !== stateKey()) { _availRunning = false; return; }
      api.runAvailabilitySims(_board, _config, _mock, me, _availSims, chunk, _avail);
      _availSims += chunk;

      // Budget is 1.5s on a phone. If the first chunks are slow, finish at
      // the reduced count and say so rather than freezing the page.
      var elapsed = Date.now() - started;
      var projected = _availSims > 0 ? (elapsed / _availSims) * target : 0;
      if (projected > 1500 && target > api.MOCK_AVAIL_SIMS_REDUCED) {
        target = api.MOCK_AVAIL_SIMS_REDUCED;
      }

      if (_availSims >= target || _avail.sims === 0) {
        _availRunning = false;
        _availKey = key;
        _availTimer = null;
        refreshBoardBody();
        refreshLarryPick();
        return;
      }
      _availTimer = setTimeout(step, 0);
    }

    _availTimer = setTimeout(step, 0);
  }

  function availShare(playerId) {
    if (!_avail || !_avail.sims) return null;
    var count = _avail.atNext.get(playerId);
    return (count === undefined ? 0 : count) / _avail.sims;
  }

  // Shares as a Map, for the engine's larryPickAdvice.
  function availShareMap() {
    if (!_avail || !_avail.sims) return null;
    var out = new Map();
    var sims = _avail.sims;
    _avail.atNext.forEach(function(count, playerId) {
      out.set(playerId, count / sims);
    });
    // A player who never survived has a real 0, not a missing entry.
    var available = engine().availableIdsFor(_board, _mock);
    available.forEach(function(id) {
      if (!out.has(id)) out.set(id, 0);
    });
    return out;
  }

  // The overall pick number the Avail column is measured at. Never the pick
  // on the clock: see availabilityTargets in the engine.
  function availTargetPick() {
    var api = engine();
    var me = myTeamId();
    if (!api || !me || !_order || !_mock) return null;
    var targets = api.availabilityTargets(_order, me, _mock.picks.length);
    return targets.first === null ? null : targets.first + 1;
  }

  function availSecondShare(playerId) {
    if (!_avail || !_avail.sims) return null;
    var count = _avail.atSecond.get(playerId);
    return (count === undefined ? 0 : count) / _avail.sims;
  }

  // --- Rendering helpers ------------------------------------------------

  function teamName(teamId) {
    var teams = S.teams || [];
    for (var i = 0; i < teams.length; i++) {
      if (teams[i].teamId === teamId) return teams[i].name || ('Team ' + teamId);
    }
    return 'Team ' + teamId;
  }

  function profileForTeam(teamId) {
    var memberId = _ownersByTeam ? _ownersByTeam[String(teamId)] : null;
    return (memberId && _profiles) ? (_profiles[memberId] || null) : null;
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'];
    var v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function catColor(cat) {
    return DEFAULT_CAT_COLORS[cat] || '#9ca3af';
  }

  function availableList() {
    var api = engine();
    var available = api.availableIdsFor(_board, _mock);
    var rows = [];
    for (var i = 0; i < _board.rankOrder.length; i++) {
      var id = _board.rankOrder[i];
      if (!available.has(id)) continue;
      var entry = _board.byId.get(id);
      if (!entry) continue;
      rows.push(entry);
    }
    return rows;
  }

  function sortedBoard() {
    var rows = availableList();
    if (_search) {
      rows = rows.filter(function(e) {
        return e.player.name.toLowerCase().indexOf(_search) >= 0;
      });
    }
    rows.sort(function(a, b) {
      if (_sortBy === 'espn') return a.rank - b.rank;
      // Larry rank. Null is "no evidence" and sorts below every number.
      var ra = a.player.larryRank;
      var rb = b.player.larryRank;
      if (ra === null && rb === null) return a.rank - b.rank;
      if (ra === null) return 1;
      if (rb === null) return -1;
      return ra - rb;
    });
    return rows;
  }

  // --- Render: board ----------------------------------------------------

  function boardBodyHtml() {
    var api = engine();
    var rows = sortedBoard().slice(0, 150);
    var onClock = userOnClock();
    var showAvail = !!_avail && _avail.sims > 0;
    var html = '';

    for (var i = 0; i < rows.length; i++) {
      var entry = rows[i];
      var p = entry.player;
      var pos = ESPN_POS_MAP[p.posId] || '--';
      var team = ESPN_TEAM_MAP[p.proTeamId] || '--';
      var share = showAvail && i < api.MOCK_AVAIL_TOP_N ? availShare(p.playerId) : null;

      html += '<tr data-player="' + p.playerId + '">';
      html += '<td class="stat-col">' + (p.larryRank === null ? '--' : p.larryRank) + '</td>';
      html += '<td class="stat-col">' + Math.round(entry.rank) + '</td>';
      html += '<td class="draft-name" onclick="DraftRoom.rowTap(' + p.playerId + ')">' +
        esc(p.name) + '</td>';
      html += '<td class="stat-col text-xs">' + pos + '</td>';
      html += '<td class="stat-col text-xs">' + team + '</td>';
      for (var c = 0; c < CATS.length; c++) {
        html += '<td class="stat-col">' + fmt(p.perGame[CATS[c]] || 0, 1) + '</td>';
      }
      html += '<td class="stat-col">' +
        (share === null ? '' : Math.round(share * 100) + '%') + '</td>';
      html += '</tr>';

      if (_confirmId === p.playerId && onClock) {
        html += '<tr class="draft-confirm-row"><td colspan="' + (6 + CATS.length) + '">' +
          '<div class="confirm-row">' +
          '<span class="confirm-label">Draft ' + esc(p.name) + '?</span>' +
          '<button class="btn btn-sm btn-primary" onclick="DraftRoom.draftPlayer(' +
          p.playerId + ')">Draft</button>' +
          '<button class="btn btn-sm btn-secondary" onclick="DraftRoom.confirmRow(' +
          p.playerId + ')">Cancel</button>' +
          '</div></td></tr>';
      }
    }

    if (!rows.length) {
      html = '<tr><td colspan="' + (6 + CATS.length) + '" class="muted">' +
        'No available players match that search.</td></tr>';
    }
    return html;
  }

  function refreshBoardBody() {
    var el = document.getElementById('draft-board-body');
    if (el) el.innerHTML = boardBodyHtml();
    var note = document.getElementById('draft-avail-note');
    if (note) note.innerHTML = availNoteHtml();
  }

  function availNoteHtml() {
    var api = engine();
    if (!myTeamId()) return '';
    if (_availRunning) return 'Calculating availability...';
    if (!_avail || !_avail.sims) return '';
    var reduced = _avail.sims < api.MOCK_AVAIL_SIMS;
    var target = availTargetPick();
    return (target ? 'Chance of still being on the board at pick ' + target : 'Availability') +
      ', from ' + _avail.sims + ' simulations' +
      (reduced ? ' (reduced from ' + api.MOCK_AVAIL_SIMS + ' to stay responsive)' : '') + '.';
  }

  function rowTap(playerId) {
    if (userOnClock()) { confirmRow(playerId); return; }
    if (typeof openPlayerPopup === 'function') openPlayerPopup(playerId);
  }

  // --- Render: Larry's pick --------------------------------------------

  function larryPickHtml() {
    var api = engine();
    if (!userOnClock()) return '';
    var available = api.availableIdsFor(_board, _mock);

    // The advice is "take the best player by Larry rank" most of the time,
    // but when Larry's top player is very likely to still be there next
    // turn and a slightly lower-ranked one is not, taking the scarce player
    // now gets you both.
    var advice = api.larryPickAdvice(_board, available, availShareMap());
    if (!advice || advice.recommendId === null) return '';
    var pick = _board.byId.get(advice.recommendId);
    if (!pick) return '';

    var html = '<div class="card draft-larry-pick">';
    html += '<div class="card-header"><h3>Larry\'s pick</h3></div>';
    html += '<div class="draft-pick-name">' + esc(pick.player.name) + '</div>';
    html += '<div class="text-xs muted">Larry ' +
      (pick.player.larryRank === null ? '--' : '#' + pick.player.larryRank) +
      ', ESPN #' + Math.round(pick.rank) + '</div>';

    if (advice.waitId !== null) {
      var waiting = _board.byId.get(advice.waitId);
      var nextPick = availTargetPick();
      if (waiting && nextPick) {
        html += '<div class="draft-can-wait">' + esc(waiting.player.name) + ' is ' +
          Math.round(advice.waitShare * 100) + '% likely to be there at pick ' + nextPick +
          ', so take ' + esc(pick.player.name) + ' now.</div>';
      }
    }

    html += '<button class="btn btn-primary btn-full" style="min-height:44px" ' +
      'onclick="DraftRoom.draftPlayer(' + advice.recommendId + ')">Draft ' +
      esc(pick.player.name) + '</button>';
    html += '</div>';
    return html;
  }

  function refreshLarryPick() {
    var el = document.getElementById('draft-larry-pick');
    if (el) el.innerHTML = larryPickHtml();
  }

  // --- Render: profile card --------------------------------------------

  function premiumBarsHtml(profile) {
    var html = '<div class="draft-bars">';
    // Fixed order REB, AST, STL, BLK, PTS, centred at zero.
    var max = 0.5;
    for (var i = 0; i < CATS.length; i++) {
      var cat = CATS[i];
      var p = profile.premium[cat];
      var pct = Math.min(Math.abs(p.premium) / max, 1) * 50;
      var left = p.premium >= 0 ? 50 : 50 - pct;
      html += '<div class="draft-bar-row">';
      html += '<span class="draft-bar-label" style="color:' + catColor(cat) + '">' + cat + '</span>';
      html += '<span class="draft-bar-track">';
      html += '<span class="draft-bar-zero"></span>';
      html += '<span class="draft-bar-fill" style="left:' + left + '%;width:' + pct +
        '%;background:' + catColor(cat) + '"></span>';
      html += '</span>';
      html += '<span class="draft-bar-value">' + (p.premium >= 0 ? '+' : '') +
        fmt(p.premium, 2) + '</span>';
      html += '<span class="draft-bar-strength text-xs muted">' +
        (p.strength === 'none' ? '' : esc(p.label)) + '</span>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function reachLineHtml(profile) {
    var r = profile.reach;
    if (r.median === null) return '<div class="text-xs muted">No ESPN ADP overlap.</div>';
    var text = r.label + ' (median ' + (r.median >= 0 ? '+' : '') + fmt(r.median, 0);
    if (r.mid !== null && Math.abs(r.mid) >= 12) {
      text += '; ' + (r.mid >= 0 ? '+' : '') + fmt(r.mid, 0) + ' in rounds 4 to 7';
    } else if (r.late !== null && Math.abs(r.late) >= 12) {
      text += '; ' + (r.late >= 0 ? '+' : '') + fmt(r.late, 0) + ' in rounds 8 and later';
    }
    text += ')';
    return '<div class="draft-reach">' + esc(text) + '</div>';
  }

  function profileCardHtml(teamId) {
    var profile = profileForTeam(teamId);
    var html = '<div class="card draft-profile">';
    html += '<div class="card-header"><h3>' + esc(teamName(teamId)) + '</h3></div>';

    if (!profile) {
      html += '<p class="text-xs muted">No profile for this team yet. ' +
        'Build manager profiles to see how this manager drafts.</p>';
      html += rosterHtml(teamId);
      html += '</div>';
      return html;
    }

    html += '<div class="draft-profile-name">' + esc(profile.name) + '</div>';
    html += '<div class="text-xs muted">' + profile.draftCount + ' drafts (' +
      profile.seasons[0] + ' to ' + profile.seasons[profile.seasons.length - 1] + ')' +
      (profile.smallSample ? '. Small sample' : '') + '</div>';

    html += premiumBarsHtml(profile);
    html += '<div class="draft-summary">' + esc(profile.summary) + '</div>';
    html += reachLineHtml(profile);

    if (profile.positionLean.length) {
      var leans = profile.positionLean.map(function(l) {
        return l.position + ' ' + (l.lean >= 0 ? '+' : '') + Math.round(l.lean);
      });
      html += '<div class="text-xs">Position lean: ' + esc(leans.join(', ')) + '</div>';
    }
    if (profile.teamAffinity.length) {
      var teams = profile.teamAffinity.map(function(t) {
        return (ESPN_TEAM_MAP[t.proTeamId] || t.proTeamId) + ' (' + t.count + ')';
      });
      html += '<div class="text-xs">Favours: ' + esc(teams.join(', ')) + '</div>';
    }

    html += '<details class="draft-how"><summary>How this is measured</summary>' +
      '<p class="text-xs muted">Each pick is scored against the other picks made within ' +
      'eight slots of it, so being early in the draft does not count as a preference. ' +
      'A manager\'s premium is their average over rounds 1 to 10, across every draft. ' +
      'Signals too weak to separate from chance are shown but are not used by the AI.</p>' +
      '</details>';

    html += rosterHtml(teamId);
    html += '</div>';
    return html;
  }

  // Category totals for every team, plus each total's rank in the league.
  function categoryTotals() {
    var totals = {};
    var teams = S.teams || [];
    for (var i = 0; i < teams.length; i++) {
      totals[String(teams[i].teamId)] = { REB: 0, AST: 0, STL: 0, BLK: 0, PTS: 0 };
    }
    for (var j = 0; j < _mock.picks.length; j++) {
      var pick = _mock.picks[j];
      var entry = _board.byId.get(pick[2]);
      if (!entry) continue;
      var bucket = totals[String(pick[1])];
      if (!bucket) continue;
      for (var c = 0; c < CATS.length; c++) {
        bucket[CATS[c]] += entry.player.perGame[CATS[c]] || 0;
      }
    }

    var ranks = {};
    for (var k = 0; k < CATS.length; k++) {
      var cat = CATS[k];
      var ordered = Object.keys(totals).sort(function(a, b) {
        return totals[b][cat] - totals[a][cat];
      });
      for (var r = 0; r < ordered.length; r++) {
        if (!ranks[ordered[r]]) ranks[ordered[r]] = {};
        ranks[ordered[r]][cat] = r + 1;
      }
    }
    return { totals: totals, ranks: ranks };
  }

  function rosterHtml(teamId) {
    var picks = _mock.picks.filter(function(p) { return p[1] === teamId; });
    var html = '<div class="draft-roster">';
    html += '<div class="section-title">Mock roster (' + picks.length + ')</div>';

    if (!picks.length) {
      html += '<p class="text-xs muted">No picks yet.</p></div>';
      return html;
    }

    var summary = categoryTotals();
    var totals = summary.totals[String(teamId)];
    var ranks = summary.ranks[String(teamId)] || {};

    html += '<div class="draft-cat-totals">';
    for (var c = 0; c < CATS.length; c++) {
      var cat = CATS[c];
      html += '<div class="draft-cat-total">' +
        '<div class="draft-cat-abbr" style="color:' + catColor(cat) + '">' + cat + '</div>' +
        '<div class="draft-cat-value">' + fmt(totals[cat], 1) + '</div>' +
        '<div class="text-xs muted">' + ordinal(ranks[cat] || 0) + '</div>' +
        '</div>';
    }
    html += '</div>';

    html += '<table class="data-table compact"><tbody>';
    for (var i = 0; i < picks.length; i++) {
      var entry = _board.byId.get(picks[i][2]);
      html += '<tr><td class="stat-col text-xs">' + picks[i][0] + '</td>' +
        '<td>' + esc(entry ? entry.player.name : 'Unknown') + '</td>' +
        '<td class="stat-col text-xs">' +
        (entry ? (ESPN_POS_MAP[entry.player.posId] || '--') : '--') + '</td></tr>';
    }
    html += '</tbody></table></div>';
    return html;
  }

  // --- Render: page -----------------------------------------------------

  function controlsHtml() {
    var done = _mock.picks.length >= _order.length;
    var html = '<div class="draft-controls">';
    html += '<button class="btn btn-primary" onclick="DraftRoom.simToMyPick()"' +
      (done ? ' disabled' : '') + '>Sim to my pick</button>';
    html += '<button class="btn btn-secondary" onclick="DraftRoom.simOne()"' +
      (done ? ' disabled' : '') + '>Sim 1</button>';
    html += '<button class="btn btn-secondary" onclick="DraftRoom.undo()"' +
      (_mock.picks.length ? '' : ' disabled') + '>Undo</button>';
    html += '<button class="btn btn-secondary" onclick="DraftRoom.restart()">Restart</button>';
    html += '<button class="btn ' + (_autoDraft ? 'btn-success' : 'btn-secondary') +
      '" onclick="DraftRoom.toggleAutoDraft()">Auto-draft me' +
      (_autoDraft ? ': on' : '') + '</button>';
    if (_autoDraft && userOnClock()) {
      html += '<button class="btn btn-primary" onclick="DraftRoom.autoPickForUser()">' +
        'Take Larry\'s pick</button>';
    }
    html += '</div>';
    return html;
  }

  function statusHtml() {
    var api = engine();
    var total = _order.length;
    var index = _mock.picks.length;

    if (index >= total) {
      return '<div class="draft-status"><strong>Draft complete.</strong> ' +
        total + ' picks.</div>';
    }

    var teamId = _order[index];
    var round = api.roundForIndex(index, _config.teamCount);
    var inRound = index - (round - 1) * _config.teamCount + 1;

    var html = '<div class="draft-status">';
    html += '<div><strong>Round ' + round + ', pick ' + inRound + '</strong> (' +
      ordinal(index + 1) + ' overall). On the clock: ' + esc(teamName(teamId));
    if (teamId === myTeamId()) html += ' <span class="draft-you">you</span>';
    html += '</div>';

    var me = myTeamId();
    if (me) {
      var upcoming = api.myUpcomingPicks(_order, me, index).slice(0, 6).map(function(i) {
        return i + 1;
      });
      if (upcoming.length) {
        html += '<div class="text-xs muted">Your picks: ' + upcoming.join(', ') + '</div>';
      }
    }
    html += '</div>';
    return html;
  }

  function teamsStripHtml() {
    var html = '<div class="draft-teams-strip">';
    var teams = S.teams || [];
    for (var i = 0; i < teams.length; i++) {
      var teamId = teams[i].teamId;
      var count = _mock.picks.filter(function(p) { return p[1] === teamId; }).length;
      var active = _openTeamId === teamId;
      html += '<button class="chip draft-team-chip' + (active ? ' active' : '') +
        '" onclick="DraftRoom.openTeam(' + teamId + ')">' +
        esc(teams[i].abbrev || teams[i].name || ('T' + teamId)) +
        ' <span class="muted">' + count + '</span></button>';
    }
    html += '</div>';
    if (_openTeamId !== null) html += profileCardHtml(_openTeamId);
    return html;
  }

  function tickerHtml() {
    if (!_mock.picks.length) return '';
    var recent = _mock.picks.slice(-5).reverse();
    var html = '<div class="card draft-ticker"><div class="section-title">Recent picks</div>';
    for (var i = 0; i < recent.length; i++) {
      var pick = recent[i];
      var entry = _board.byId.get(pick[2]);
      var reason = _reasons[String(pick[0])] || '';
      html += '<div class="draft-ticker-row">';
      html += '<span class="draft-ticker-pick">' + pick[0] + '</span>';
      html += '<span class="draft-ticker-team text-xs muted">' + esc(teamName(pick[1])) + '</span>';
      html += '<span class="draft-ticker-name">' + esc(entry ? entry.player.name : '?') + '</span>';
      if (reason) html += '<span class="draft-ticker-reason text-xs muted">' + esc(reason) + '</span>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function footerHtml() {
    var api = engine();
    var html = '<div class="draft-footer text-xs muted">';
    html += 'Seed ' + _mock.seed + '. ';
    if (_seasonsUsed.length) {
      html += 'Profiles from ' + _seasonsUsed.length + ' drafts (' + _seasonsUsed[0] +
        ' to ' + _seasonsUsed[_seasonsUsed.length - 1] + '). ';
    }
    if (!api.MOCK_FITTED) {
      html += 'The AI model is running on unfitted default weights. ';
    }
    html += '<a href="#" onclick="DraftRoom.rebuildProfiles();return false;">Rebuild profiles</a>';
    html += '</div>';
    return html;
  }

  function profilesBannerHtml() {
    if (_profiles) return '';
    if (_building) {
      return '<div class="card"><div class="loading">' +
        '<p id="draft-build-progress">' + esc(_buildProgress) + '</p>' +
        '<p class="text-xs muted">Reading one season at a time. This stays on your phone.</p>' +
        '</div></div>';
    }
    var html = '<div class="card draft-build-card">';
    html += '<p>The mock is running on ESPN\'s board alone. Build manager profiles to ' +
      'have the other 11 teams draft the way they actually draft.</p>';
    if (_buildError) {
      html += '<p class="error-msg">' + esc(_buildError) + '</p>';
    }
    html += '<button class="btn btn-primary btn-full" style="min-height:44px" ' +
      'onclick="DraftRoom.buildProfiles()">Build manager profiles</button>';
    html += '<p class="text-xs muted">Reads your league\'s past drafts from ESPN. ' +
      'Stored on this device only.</p>';
    html += '</div>';
    return html;
  }

  // --- In-app model check (spec s4.1) ---------------------------------
  //
  // Runs the same held-out test as tools/fit-mock-draft.ts, in the browser,
  // against the user's own history. The fit tool needs a local export the
  // owner may never produce; this needs nothing but the app.

  var _checkResult = null;
  var _checkError = null;
  var _checkRunning = false;

  function modelCheck() {
    var api = engine();
    if (!api || _checkRunning) return;
    var history = ESPNSync.loadDraftHistory();
    if (!history) {
      _checkError = 'Build manager profiles first.';
      render();
      return;
    }

    _checkRunning = true;
    _checkError = null;
    _checkResult = null;
    render();

    // Deferred so the "running" state paints before the work starts.
    setTimeout(function() {
      try {
        // The most recent completed draft, held out: profiles for it are
        // built from prior seasons only, so this is a real prediction.
        var seasons = Object.keys(history.seasons || {}).map(Number)
          .filter(function(n) { return isFinite(n); })
          .sort(function(a, b) { return a - b; });
        var testSeason = seasons.length ? seasons[seasons.length - 1] : null;
        if (!testSeason || seasons.length < 2) {
          throw new Error('Need at least two drafts of history to test on one.');
        }
        _checkResult = api.checkModel(history, testSeason, _adpHistory || undefined);
      } catch (e) {
        _checkError = e && e.message ? e.message : 'Model check failed.';
      }
      _checkRunning = false;
      render();
    }, 0);
  }

  function modelCheckHtml() {
    if (_checkRunning) {
      return '<p class="text-xs muted">Running the model check...</p>';
    }
    if (_checkError) {
      return '<p class="text-xs error-msg">' + esc(_checkError) + '</p>';
    }
    if (!_checkResult) return '';

    var r = _checkResult;
    var html = '<div class="draft-check">';
    html += '<div class="text-xs">Held-out season ' + r.season + ', ' +
      r.full.picks + ' picks.</div>';
    html += '<table class="data-table compact"><thead><tr>' +
      '<th style="text-align:left">Model</th><th class="stat-col">Log-lik</th>' +
      '<th class="stat-col">Top 1</th><th class="stat-col">Top 5</th>' +
      '</tr></thead><tbody>';
    html += '<tr><td>With profiles</td><td class="stat-col">' +
      fmt(r.full.meanLogLik, 3) + '</td><td class="stat-col">' +
      Math.round(r.full.top1 * 100) + '%</td><td class="stat-col">' +
      Math.round(r.full.top5 * 100) + '%</td></tr>';
    html += '<tr><td>Rank only</td><td class="stat-col">' +
      fmt(r.baseline.meanLogLik, 3) + '</td><td class="stat-col">' +
      Math.round(r.baseline.top1 * 100) + '%</td><td class="stat-col">' +
      Math.round(r.baseline.top5 * 100) + '%</td></tr>';
    html += '</tbody></table>';
    html += '<div class="text-xs ' + (r.beatsBaseline ? 'positive' : 'muted') + '">' +
      (r.beatsBaseline
        ? 'Profiles beat the board-only model on a season it had never seen.'
        : 'Profiles did not beat the board-only model here. The AI is still ' +
          'usable; it just is not adding anything over ESPN ADP for this league.') +
      '</div>';
    html += '</div>';
    return html;
  }

  // Rendered by the Settings page.
  function renderModelCheckCard() {
    var html = '<div class="settings-row draft-check-row">';
    html += '<div><strong>Draft model check</strong>' +
      '<div class="text-xs muted">Tests the Draft Room\'s AI against your most ' +
      'recent real draft, using profiles built only from the seasons before it.</div>';
    html += modelCheckHtml();
    html += '</div>';
    html += '<button class="btn btn-sm btn-secondary" style="min-height:44px" ' +
      'onclick="DraftRoom.modelCheck()">Run</button>';
    html += '</div>';
    return html;
  }

  function render() {
    if (typeof window.render === 'function') window.render();
  }

  // Entry point called by renderLeagueSubPage.
  function renderPage() {
    var api = engine();
    if (!api || !api.prepareBoard) {
      return '<div class="empty-state"><p>The draft engine did not load. ' +
        'Reload the app.</p></div>';
    }
    if (!S.espn || !S.espn.leagueId) {
      return '<div class="empty-state"><p>Connect your ESPN league first.</p></div>';
    }
    if (!(S.allPlayers || []).length) {
      return '<div class="empty-state"><p>No player pool yet. Sync first.</p></div>';
    }

    ensureAdp();
    ensureProfiles();
    ensureOrder();

    if (_orderLoading) {
      return '<div class="loading"><p>Reading the draft order...</p></div>';
    }
    if (!_order) {
      return '<div class="empty-state"><p>' +
        esc(_orderError || 'ESPN has not published the draft order yet.') + '</p></div>';
    }

    ensureMock();
    if (!buildConfig()) {
      return '<div class="empty-state"><p>Could not build the draft board.</p></div>';
    }

    // Odds only mean something once the user has a team and picks left.
    if (myTeamId() && _mock.picks.length < _order.length) startAvail();

    var html = '';
    html += statusHtml();
    html += controlsHtml();
    html += profilesBannerHtml();
    html += '<div id="draft-larry-pick">' + larryPickHtml() + '</div>';
    html += teamsStripHtml();

    html += '<div class="card">';
    html += '<div class="draft-board-bar">';
    html += '<div class="sort-label">Sort by</div>';
    html += '<button class="btn btn-sm ' + (_sortBy === 'larry' ? 'btn-primary' : 'btn-secondary') +
      '" onclick="DraftRoom.setSort(\'larry\')">Larry</button>';
    html += '<button class="btn btn-sm ' + (_sortBy === 'espn' ? 'btn-primary' : 'btn-secondary') +
      '" onclick="DraftRoom.setSort(\'espn\')">ESPN</button>';
    html += '<input class="form-input filter-search" type="search" placeholder="Search players" ' +
      'value="' + esc(_search) + '" oninput="DraftRoom.onSearch(this.value)">';
    html += '</div>';
    html += '<div id="draft-avail-note" class="text-xs muted">' + availNoteHtml() + '</div>';

    html += '<div class="table-scroll"><table class="data-table compact"><thead><tr>';
    html += '<th class="stat-col">Larry</th><th class="stat-col">ESPN</th>';
    html += '<th style="text-align:left;min-width:120px">Player</th>';
    html += '<th class="stat-col">Pos</th><th class="stat-col">Tm</th>';
    for (var c = 0; c < CATS.length; c++) {
      html += '<th class="stat-col" style="color:' + catColor(CATS[c]) + '">' + CATS[c] + '</th>';
    }
    // Labelled with the pick it is measured at, so "82%" cannot be
    // mistaken for "available right now".
    var target = availTargetPick();
    html += '<th class="stat-col">' +
      (target ? 'At ' + target : 'Avail') + '</th>';
    html += '</tr></thead><tbody id="draft-board-body">' + boardBodyHtml() + '</tbody></table></div>';
    html += '</div>';

    html += tickerHtml();
    html += footerHtml();
    return html;
  }

  return {
    renderPage: renderPage,
    buildProfiles: buildProfiles,
    rebuildProfiles: rebuildProfiles,
    simOne: simOne,
    simToMyPick: simToMyPick,
    draftPlayer: draftPlayer,
    autoPickForUser: autoPickForUser,
    undo: undo,
    restart: restart,
    toggleAutoDraft: toggleAutoDraft,
    setSort: setSort,
    onSearch: onSearch,
    confirmRow: confirmRow,
    rowTap: rowTap,
    openTeam: openTeam,
    modelCheck: modelCheck,
    renderModelCheckCard: renderModelCheckCard,
    MOCK_KEY: MOCK_KEY
  };
})();

// Called by renderLeagueSubPage. Wrapped so a failure shows the diagnostic
// card rather than a blank page.
function renderDraftRoom() {
  try {
    return DraftRoom.renderPage();
  } catch (e) {
    console.error('Draft Room render failed:', e);
    return '<div class="error-card"><h3>Draft Room error</h3><p>' +
      esc(e && e.message ? e.message : String(e)) + '</p>' +
      '<p class="text-xs muted">Tap Restart in the Draft Room, or clear the mock from ' +
      'Settings, and try again.</p></div>';
  }
}
