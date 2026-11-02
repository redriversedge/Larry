// ============================================================
// GAME PLAN (Matchup tab) and PICKUP TARGETS (Players tab)
// ============================================================
//
// The Game Plan is the week: an overview of the matchup, the games edge,
// where each category stands, and when and how to use pickups. It
// rewrites itself once a day (the first time the Matchup tab opens that
// day) and on Refresh, and each version knows what happened since the
// last one: it compares the roster, pickups used and scores against a
// snapshot taken when the last version was written.
//
// The numbers (games per day, win odds, pickups left, targets) are the
// app's own and are computed here. Only the reading of them, the plan
// itself, comes from the model (netlify/functions/larry-plan.mjs). Larry's
// Move and chat are both given the current plan, so Move is today's step
// of it.
//
// Pickup targets are computed here too, never by the model: each pickup
// step in the plan names categories and days, and the top target for it is
// the best unrostered player for those, by the same numbers.

var GamePlan = (function() {
  var _loading = false;
  var _error = '';
  var _status = '';
  var _autoTried = {};       // matchupPeriod + date -> true, one auto attempt a day
  var _intentForm = false;
  var _targetMode = 'week';  // week | season | all
  var _targetShow = 5;
  var _targetOpen = {};

  // ---------- storage ----------
  function store() {
    if (!S.gamePlan || typeof S.gamePlan !== 'object') S.gamePlan = {};
    return S.gamePlan;
  }
  function mp() { return Number(S.league && S.league.currentMatchupPeriod) || 0; }
  function current() {
    var g = store();
    return g.mp === mp() && g.plan ? g : null;
  }
  function intents() {
    S.gamePlanIntents = S.gamePlanIntents || {};
    var list = S.gamePlanIntents[mp()];
    return Array.isArray(list) ? list : [];
  }
  function setIntents(list) {
    S.gamePlanIntents = S.gamePlanIntents || {};
    S.gamePlanIntents[mp()] = list;
    // Only this matchup's and the next one's are worth keeping.
    Object.keys(S.gamePlanIntents).forEach(function(k) {
      if (Number(k) < mp()) delete S.gamePlanIntents[k];
    });
    autosave();
  }

  // ---------- small helpers ----------
  function addDays(dateStr, n) {
    var p = dateStr.split('-');
    return localDateStr(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n));
  }
  function datesBetween(a, b) {
    var out = [];
    var d = a;
    while (d && b && d <= b && out.length < 21) { out.push(d); d = addDays(d, 1); }
    return out;
  }
  function weekday(dateStr) {
    var p = dateStr.split('-');
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay()];
  }
  function full(stub) {
    var f = Engines.enrichPlayer(stub);
    return f && f !== stub ? Object.assign({}, f, { slotId: stub.slotId, slot: stub.slot }) : stub;
  }
  function out(p) { return /^(OUT|SUSPENSION|INJURY_RESERVE|IR)$/i.test(String(p.injuryStatus || '')); }
  function playsOn(p, d) { return ((p.schedule || []).some(function(g) { return g && g.date === d; })); }
  function slots() {
    return ((S.league && S.league.rosterSlots) || []).reduce(function(n, x) {
      return n + (x && x.slotId < 12 ? x.count || 0 : 0);
    }, 0) || 10;
  }
  function oppTeam() {
    return (S.teams || []).find(function(t) { return t.teamId === S.matchup.opponentTeamId; }) || null;
  }
  // Games that can fill a starting slot on one day: healthy, not on IR,
  // with a game, capped at the starting slots.
  function usableOn(players, d) {
    var n = players.filter(function(p) { return p.slotId !== 13 && !out(p) && playsOn(p, d); }).length;
    return Math.min(n, slots());
  }
  function r1(v) { return Math.round((Number(v) || 0) * 10) / 10; }

  // Per-category scale: the average per-game rate of Larry's top 150, so
  // one block and eight points weigh about the same when ranking targets.
  var _scale = null, _scaleAt = null;
  function catScale() {
    var stamp = S.espn && S.espn.lastSync;
    if (_scale && _scaleAt === stamp) return _scale;
    var cats = getOrderedCategories();
    var top = (S.allPlayers || []).filter(function(p) { return !p.noEvidence && p.durantRank && p.durantRank <= 150; });
    var sc = {};
    cats.forEach(function(c) {
      var sum = 0;
      top.forEach(function(p) { sum += blendedPerGame(p)[c.abbr] || 0; });
      sc[c.abbr] = top.length && sum > 0 ? sum / top.length : 1;
    });
    _scale = sc; _scaleAt = stamp;
    return sc;
  }

  // ---------- the facts ----------
  function facts() {
    var cats = getOrderedCategories();
    var win = getMatchupWindow() || {};
    var today = localDateStr(new Date());
    var mine = (S.myTeam.players || []).map(full);
    var opp = oppTeam();
    var theirs = opp ? (opp.players || []).map(full) : [];
    var days = datesBetween(win.startStr, win.endStr).map(function(d) {
      return { date: d, day: weekday(d), you: usableOn(mine, d), them: usableOn(theirs, d), past: d < today, today: d === today };
    });
    var strat = (S.matchup && S.matchup.strategy) || {};
    var proj = strat.projected || { mine: {}, theirs: {} };
    var catRows = cats.map(function(c) {
      return {
        cat: c.abbr,
        now: r1((S.matchup.myScores || {})[c.abbr]),
        oppNow: r1((S.matchup.oppScores || {})[c.abbr]),
        projected: r1(proj.mine && proj.mine[c.abbr]),
        oppProjected: r1(proj.theirs && proj.theirs[c.abbr]),
        winPct: strat.winProb && strat.winProb[c.abbr] !== undefined ? Math.round(strat.winProb[c.abbr] * 100) : null
      };
    });
    var leading = 0, trailing = 0;
    catRows.forEach(function(r) { if (r.now > r.oppNow) leading++; else if (r.now < r.oppNow) trailing++; });
    var dayOf = days.filter(function(d) { return d.date <= today; }).length;
    return {
      today: today,
      opponent: (opp && opp.name) || S.matchup.opponentName || 'your opponent',
      start: win.startStr, end: win.endStr,
      dayOf: dayOf, totalDays: days.length,
      days: days,
      gamesLeft: { you: matchupGamesLeft(S.myTeam.players || []), them: matchupGamesLeft(opp ? opp.players || [] : []) },
      gamesTotal: {
        you: days.reduce(function(a, d) { return a + d.you; }, 0),
        them: days.reduce(function(a, d) { return a + d.them; }, 0)
      },
      categories: catRows,
      record: { leading: leading, trailing: trailing },
      pickups: pickupAllowance(),
      phase: matchupPhase(),
      oppInjuries: theirs.filter(function(p) { return String(p.injuryStatus || 'ACTIVE').toUpperCase() !== 'ACTIVE'; })
        .map(function(p) { return p.name + ' (' + Engines.normalizeInjuryStatus(p.injuryStatus) + ')'; })
    };
  }

  // What the roster, pickups and scores looked like when this version was
  // written, so the next version can say what happened.
  function snapshot() {
    var opp = oppTeam();
    var oppStatus = {};
    (opp ? opp.players || [] : []).forEach(function(stub) {
      var p = full(stub);
      oppStatus[p.id] = { name: p.name, status: Engines.normalizeInjuryStatus(p.injuryStatus) };
    });
    return {
      at: new Date().toISOString(),
      roster: (S.myTeam.players || []).map(function(p) { return p.id; }),
      pickupsUsed: pickupAllowance().used,
      myScores: Object.assign({}, S.matchup.myScores || {}),
      oppScores: Object.assign({}, S.matchup.oppScores || {}),
      oppStatus: oppStatus
    };
  }

  function nameOf(id) {
    var p = (S.allPlayers || []).find(function(x) { return x.id === id; });
    return p ? p.name : 'a player';
  }

  // Plain facts about what changed since the last version. The model turns
  // these into the "Since ..." box; it never has to guess what you did.
  function sinceLast(prev) {
    if (!prev || !prev.snapshot) return [];
    var snap = prev.snapshot;
    var outList = [];
    var nowIds = (S.myTeam.players || []).map(function(p) { return p.id; });
    var added = nowIds.filter(function(id) { return snap.roster.indexOf(id) < 0; });
    var dropped = snap.roster.filter(function(id) { return nowIds.indexOf(id) < 0; });
    if (added.length) outList.push('You added ' + added.map(nameOf).join(', ') + '.');
    if (dropped.length) outList.push('You dropped ' + dropped.map(nameOf).join(', ') + '.');
    var used = pickupAllowance().used - (snap.pickupsUsed || 0);
    if (used > 0 && !added.length) outList.push('You used ' + used + ' pickup' + (used > 1 ? 's' : '') + '.');
    if (!added.length && !dropped.length && used <= 0) outList.push('No roster moves since the last plan.');
    getOrderedCategories().forEach(function(c) {
      var was = (snap.myScores[c.abbr] || 0) - (snap.oppScores[c.abbr] || 0);
      var now = ((S.matchup.myScores || {})[c.abbr] || 0) - ((S.matchup.oppScores || {})[c.abbr] || 0);
      if (Math.round(was) !== Math.round(now)) {
        outList.push(c.abbr + ' margin went from ' + (was >= 0 ? '+' : '') + r1(was) + ' to ' + (now >= 0 ? '+' : '') + r1(now) + '.');
      }
    });
    var opp = oppTeam();
    (opp ? opp.players || [] : []).forEach(function(stub) {
      var p = full(stub);
      var before = snap.oppStatus && snap.oppStatus[p.id];
      var nowSt = Engines.normalizeInjuryStatus(p.injuryStatus);
      if (before && before.status !== nowSt) outList.push('Their ' + p.name + ' went from ' + before.status + ' to ' + nowSt + '.');
    });
    var steps = (prev.plan && prev.plan.pickupSteps) || [];
    steps.forEach(function(s) {
      if (s.status === 'planned' && s.date && s.date < localDateStr(new Date()) && !added.length) {
        outList.push('The planned "' + s.title + '" pickup (' + s.when + ') was not made.');
      }
    });
    return outList.slice(0, 10);
  }

  // ---------- pickup targets ----------
  function needCats(plan) {
    var cats = getOrderedCategories().map(function(c) { return c.abbr; });
    var need = [];
    var steps = (plan && plan.pickupSteps) || [];
    steps.forEach(function(s) {
      if (s.status === 'planned' || s.status === 'changed') {
        (s.needCats || []).forEach(function(c) { if (need.indexOf(c) < 0 && cats.indexOf(c) >= 0) need.push(c); });
      }
    });
    if (need.length) return need;
    var strat = (S.matchup && S.matchup.strategy) || {};
    cats.forEach(function(c) {
      var wp = strat.winProb && strat.winProb[c];
      if (wp !== undefined && wp >= 0.15 && wp <= 0.85) need.push(c);
    });
    return need.length ? need : cats;
  }

  // The first day a waiver player could play for you: the day his claim
  // processes, or the first pickup day if that is later.
  function availableFrom(p) {
    var from = pickupStartDateStr();
    if (p.poolStatus === 'WAIVERS' && p.waiverClearsAt) {
      var c = localDateStr(new Date(p.waiverClearsAt));
      if (c > from) return c;
    }
    return from;
  }

  function targetInfo(p, need, endStr) {
    var cats = getOrderedCategories();
    var sc = catScale();
    var rate = blendedPerGame(p);
    var from = availableFrom(p);
    var pickFrom = pickupStartDateStr();
    var sched = (p.schedule || []).filter(function(g) { return g && g.date >= pickFrom && g.date <= endStr; }).map(function(g) { return g.date; });
    var usable = sched.filter(function(d) { return d >= from; });
    var lost = sched.filter(function(d) { return d < from; });
    var perGameFit = 0;
    cats.forEach(function(c) { perGameFit += (rate[c.abbr] || 0) / sc[c.abbr] * (need.indexOf(c.abbr) >= 0 ? 1 : 0.15); });
    // The categories he actually moves: his best two among the needs.
    var helps = need.slice().sort(function(a, b) { return (rate[b] || 0) / sc[b] - (rate[a] || 0) / sc[a]; })
      .filter(function(c) { return (rate[c] || 0) / sc[c] >= 0.9; }).slice(0, 2);
    var season = ESPNSync.getPerGameStats(p, 'season') || {};
    var last7 = ESPNSync.getPerGameStats(p, 'last7') || {};
    var notes = [];
    if (p.trend === 'hot') notes.push('hot last 7');
    if (season.MIN && last7.MIN && last7.MIN >= season.MIN * 1.15) notes.push('minutes up');
    return {
      p: p, usable: usable, lost: lost, helps: helps, notes: notes,
      gain: helps.map(function(c) { return { cat: c, total: r1((rate[c] || 0) * usable.length) }; }),
      weekScore: perGameFit * usable.length + perGameFit * 0.25,
      onWaivers: p.poolStatus === 'WAIVERS'
    };
  }

  function targets(mode, plan) {
    Engines.ensureDURANT(S.allPlayers || []);
    var win = getMatchupWindow() || {};
    var endStr = win.endStr || localDateStr(new Date());
    var need = needCats(plan);
    var pool = (S.allPlayers || []).filter(function(p) { return !(p.onTeamId > 0); });
    if (mode === 'all') {
      return pool.slice().sort(byDurantRank).map(function(p) { return targetInfo(p, need, endStr); });
    }
    pool = pool.filter(function(p) { return Engines.isValidAddCandidate(p); });
    if (mode === 'season') {
      return pool.filter(function(p) { return !p.noEvidence && p.durantRank; }).sort(byDurantRank).slice(0, 60)
        .map(function(p) { return targetInfo(p, need, endStr); });
    }
    return pool.map(function(p) { return targetInfo(p, need, endStr); })
      .filter(function(t) { return t.usable.length > 0; })
      .sort(function(a, b) { return b.weekScore - a.weekScore; }).slice(0, 60);
  }

  // The best target for each planned pickup step, each player used once.
  function stepTargets(plan) {
    var steps = (plan && plan.pickupSteps) || [];
    var win = getMatchupWindow() || {};
    var endStr = win.endStr || localDateStr(new Date());
    var pool = (S.allPlayers || []).filter(function(p) { return !(p.onTeamId > 0) && Engines.isValidAddCandidate(p); });
    var used = {};
    return steps.map(function(s) {
      if (s.status === 'done' || s.status === 'skipped') return null;
      var need = (s.needCats && s.needCats.length) ? s.needCats : needCats(plan);
      var days = Array.isArray(s.forDays) ? s.forDays : [];
      var best = null;
      pool.forEach(function(p) {
        if (used[p.id]) return;
        var t = targetInfo(p, need, endStr);
        var score = t.weekScore;
        if (days.length) {
          var hit = t.usable.filter(function(d) { return days.indexOf(d) >= 0; }).length;
          if (!hit) return;
          score = score * (0.5 + hit / days.length);
        }
        if (!best || score > best.score) best = { t: t, score: score };
      });
      if (best) used[best.t.p.id] = true;
      return best ? best.t : null;
    });
  }

  // ---------- request ----------
  function payload(prev) {
    var f = facts();
    var plan = prev && prev.plan;
    var top = targets('week', plan).slice(0, 12).map(function(t) {
      return {
        name: t.p.name, team: t.p.nbaTeam, rank: (!t.p.noEvidence && t.p.durantRank) ? t.p.durantRank : null,
        plays: t.usable.map(shortDayLabel), helps: t.helps, onWaivers: t.onWaivers,
        perGame: (function() { var r = blendedPerGame(t.p); var o = {}; Object.keys(r).forEach(function(k) { o[k] = r1(r[k]); }); return o; })()
      };
    });
    var roster = (S.myTeam.players || []).map(full).map(function(p) {
      var win = getMatchupWindow() || {};
      return {
        name: p.name, rank: (!p.noEvidence && p.durantRank) ? p.durantRank : null,
        status: Engines.normalizeInjuryStatus(p.injuryStatus), slot: p.slot || '',
        plays: gameDatesBetween(p, f.today, win.endStr || f.today).map(shortDayLabel)
      };
    });
    var opp = oppTeam();
    var oppRoster = (opp ? opp.players || [] : []).map(full).map(function(p) {
      var win = getMatchupWindow() || {};
      return {
        name: p.name, status: Engines.normalizeInjuryStatus(p.injuryStatus),
        plays: gameDatesBetween(p, f.today, win.endStr || f.today).map(shortDayLabel)
      };
    });
    return {
      kind: 'larry-plan',
      league: { categories: getOrderedCategories().map(function(c) { return c.abbr; }), coreRank: 75 },
      facts: Object.assign({}, f, { days: f.days.map(function(d) {
        return { date: d.date, label: shortDayLabel(d.date), you: d.you, them: d.them, past: d.past };
      }) }),
      intents: intents().map(function(i) { return i.text; }),
      previous: plan ? {
        headline: plan.headline,
        generatedAt: prev.generatedAt,
        pickupSteps: (plan.pickupSteps || []).map(function(s) { return { when: s.when, date: s.date, title: s.title, status: s.status }; })
      } : null,
      sinceLast: sinceLast(prev),
      targets: top,
      myRoster: roster,
      oppRoster: oppRoster
    };
  }

  function generate(force) {
    if (_loading) return;
    if (!(S.myTeam && S.myTeam.players && S.myTeam.players.length)) return;
    var prev = store().mp === mp() ? store() : null;
    var body;
    try { body = payload(prev); } catch (e) { _error = 'Could not read the matchup: ' + e.message; repaint(); return; }
    _loading = true; _error = ''; _status = 'Larry is reading the matchup...';
    repaint();
    fetch('/.netlify/functions/larry-plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function(res) {
      return res.text().then(function(text) {
        var plan = null, err = '';
        String(text || '').split('\n').forEach(function(line) {
          if (!line.trim()) return;
          var o; try { o = JSON.parse(line); } catch (e) { return; }
          if (o && o.plan) plan = o.plan;
          if (o && o.error && !plan) err = String(o.error);
        });
        if (!res.ok && !plan) {
          var j = null; try { j = JSON.parse(text); } catch (e) { j = null; }
          throw new Error(res.status === 504 ? 'Larry took too long. Tap Refresh.' : ((j && j.error) || err || 'Plan unavailable right now.'));
        }
        if (!plan) throw new Error(err || 'Larry did not return a plan. Tap Refresh.');
        var g = store();
        var history = Array.isArray(g.history) && g.mp === mp() ? g.history : [];
        if (g.mp === mp() && g.plan) history = [{ generatedAt: g.generatedAt, headline: g.plan.headline }].concat(history).slice(0, 10);
        S.gamePlan = {
          mp: mp(), plan: plan, generatedAt: new Date().toISOString(), dateLocal: localDateStr(new Date()),
          snapshot: snapshot(), history: history
        };
        autosave();
      });
    }).catch(function(e) {
      _error = e.message || 'Plan unavailable right now.';
    }).then(function() {
      _loading = false; _status = '';
      repaint();
    });
  }

  function repaint() {
    var el = document.getElementById('game-plan');
    if (el) el.innerHTML = html();
  }

  // Once a day, the first time the plan is looked at.
  function maybeAuto() {
    if (_loading || !(S.espn && S.espn.connected)) return;
    var key = mp() + '|' + localDateStr(new Date());
    var c = current();
    if (c && c.dateLocal === localDateStr(new Date())) return;
    if (_autoTried[key]) return;
    _autoTried[key] = true;
    setTimeout(function() { generate(false); }, 50);
  }

  // ---------- intents ----------
  function addIntent(text) {
    text = String(text || '').trim().slice(0, 140);
    if (!text) return;
    var list = intents().slice();
    list.push({ id: Date.now(), text: text });
    setIntents(list.slice(-6));
    _intentForm = false;
    repaint();
  }
  function removeIntent(id) {
    setIntents(intents().filter(function(i) { return i.id !== id; }));
    repaint();
  }
  function saveIntentForm() {
    var kind = (document.getElementById('gp-intent-kind') || {}).value;
    var val = (document.getElementById('gp-intent-value') || {}).value;
    var free = (document.getElementById('gp-intent-text') || {}).value;
    if (kind === 'punt' && val) addIntent('Punt ' + val + ' this week');
    else if (kind === 'save' && val) addIntent('Save a pickup for ' + val);
    else if (kind === 'keep' && val) addIntent('Do not drop ' + val);
    else if (free) addIntent(free);
  }
  function intentKindChanged() {
    var kind = (document.getElementById('gp-intent-kind') || {}).value;
    var sel = document.getElementById('gp-intent-value');
    var txt = document.getElementById('gp-intent-text');
    if (!sel || !txt) return;
    var opts = [];
    if (kind === 'punt') opts = getOrderedCategories().map(function(c) { return c.abbr; });
    else if (kind === 'save') {
      var f = facts();
      opts = f.days.filter(function(d) { return !d.past; }).map(function(d) { return shortDayLabel(d.date); });
    } else if (kind === 'keep') {
      opts = (S.myTeam.players || []).map(full).map(function(p) { return p.name; });
    }
    sel.innerHTML = opts.map(function(o) { return '<option>' + esc(o) + '</option>'; }).join('');
    sel.style.display = opts.length ? '' : 'none';
    txt.style.display = kind === 'other' ? '' : 'none';
  }

  // ---------- render: Game Plan ----------
  var LABEL_COLOR = {
    'Bank it': '#22c55e', 'Hold': '#22c55e', 'Fight for it': '#f59e0b', 'Chase': '#7fb0ff',
    'Chase late': '#7fb0ff', 'Uphill': '#ef4444', 'Let it go': '#8a8aa8'
  };

  function html() {
    var c = current();
    var f = facts();
    var plan = c && c.plan;
    var h = '';
    h += '<div class="gp-head"><div><div class="gp-title">Game Plan</div>' +
      '<div class="gp-sub">vs ' + esc(f.opponent) + ' &middot; day ' + f.dayOf + ' of ' + f.totalDays +
      (f.dayOf > 0 ? ' &middot; you lead ' + f.record.leading + ' to ' + f.record.trailing : '') + '</div></div>' +
      '<button class="gp-btn" onclick="GamePlan.refresh()" ' + (_loading ? 'disabled' : '') + ' aria-label="Refresh the plan">' +
      (_loading ? 'Writing...' : 'Refresh') + '</button></div>';

    if (_loading && !plan) {
      return h + '<div class="gp-card gp-center"><div class="typing-dots"><span>.</span><span>.</span><span>.</span></div>' +
        '<div class="text-xs muted" style="margin-top:6px">' + esc(_status) + '</div></div>' + factsCards(f, null);
    }
    if (_error) {
      h += '<div class="gp-card" style="border-color:#5a2a2a"><div class="text-sm">' + esc(_error) + '</div></div>';
    }

    // One-line plan + your calls.
    h += '<div class="gp-card">';
    h += '<div class="gp-kicker">This week, in one line' + (c ? ' &middot; updated ' + esc(new Date(c.generatedAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })) : '') + '</div>';
    h += '<div class="gp-headline">' + esc(plan ? plan.headline : 'No plan yet. Tap Refresh to have Larry write one.') + '</div>';
    h += '<div class="gp-chips">';
    intents().forEach(function(i) {
      h += '<span class="gp-intent">Your call: ' + esc(i.text) +
        ' <button aria-label="Remove" onclick="GamePlan.removeIntent(' + i.id + ')">\u2716</button></span>';
    });
    h += '<button class="gp-add-intent" onclick="GamePlan.toggleIntentForm()">+ Tell Larry your plan</button>';
    h += '</div>';
    if (_intentForm) {
      h += '<div class="gp-intent-form">' +
        '<select id="gp-intent-kind" class="filter-select" onchange="GamePlan.intentKindChanged()" aria-label="What kind of call">' +
        '<option value="punt">Punt a category</option><option value="save">Save a pickup for a day</option>' +
        '<option value="keep">Don\'t drop a player</option><option value="other">Something else</option></select>' +
        '<select id="gp-intent-value" class="filter-select" aria-label="Which one"></select>' +
        '<input id="gp-intent-text" class="filter-search" style="display:none" placeholder="In your words..." aria-label="Your call">' +
        '<div style="display:flex;gap:8px"><button class="btn btn-sm btn-primary" style="min-height:40px" onclick="GamePlan.saveIntentForm()">Save</button>' +
        '<button class="btn btn-sm btn-secondary" style="min-height:40px" onclick="GamePlan.toggleIntentForm()">Cancel</button></div>' +
        '<div class="text-xs muted">Larry follows these in the plan, Larry\'s Move and chat. They apply to this matchup.</div></div>';
    }
    h += '</div>';

    // Since last time.
    if (plan && plan.sinceLast && plan.sinceLast.length) {
      h += '<div class="gp-card gp-since"><div class="gp-h">Since the last plan</div>';
      plan.sinceLast.forEach(function(s) {
        var col = s.kind === 'done' ? '#22c55e' : (s.kind === 'missed' ? '#ef4444' : '#f59e0b');
        var lab = s.kind === 'done' ? 'Done' : (s.kind === 'missed' ? 'Missed' : 'Changed');
        h += '<div class="gp-since-row"><span style="color:' + col + '">' + lab + '</span><span>' + esc(s.text) + '</span></div>';
      });
      h += '</div>';
    }

    h += factsCards(f, plan);
    return h;
  }

  function factsCards(f, plan) {
    var h = '';
    var cats = getOrderedCategories();
    // Games.
    var past = f.dayOf > 1;
    var youN = past ? f.gamesLeft.you : f.gamesTotal.you;
    var themN = past ? f.gamesLeft.them : f.gamesTotal.them;
    var edge = youN - themN;
    h += '<div class="gp-card"><div class="gp-row"><div class="gp-h">' + (past ? 'Games left' : 'Games advantage') + '</div>' +
      '<div class="gp-edge" style="color:' + (edge > 0 ? '#22c55e' : (edge < 0 ? '#ef4444' : '#a0a0bf')) + '">' +
      (edge > 0 ? '+' + edge + ' for you' : (edge < 0 ? edge + ' against you' : 'even')) + '</div></div>';
    h += '<div class="gp-two"><div class="gp-stat"><div class="gp-num">' + youN + '</div><div class="gp-lbl">your usable games' + (past ? ' left' : '') + '</div></div>' +
      '<div class="gp-stat"><div class="gp-num">' + themN + '</div><div class="gp-lbl">theirs</div></div></div>';
    var stepsByDate = {};
    ((plan && plan.pickupSteps) || []).forEach(function(s) {
      if (s.date) stepsByDate[s.date] = s.status === 'done' ? 'done' : 'add';
    });
    h += '<div class="gp-strip" style="grid-template-columns:44px repeat(' + f.days.length + ',minmax(0,1fr))"><div></div>';
    f.days.forEach(function(d) { h += '<div class="' + (d.today ? 'gp-today' : (d.past ? 'gp-past' : 'gp-dim')) + '">' + esc(d.day) + '</div>'; });
    h += '<div class="gp-rowlbl">You</div>';
    f.days.forEach(function(d) { h += '<div class="' + (d.past && !d.today ? 'gp-past' : (d.you > d.them ? 'gp-win' : '')) + '">' + d.you + '</div>'; });
    h += '<div class="gp-rowlbl">Them</div>';
    f.days.forEach(function(d) { h += '<div class="' + (d.past && !d.today ? 'gp-past' : (d.them > d.you ? 'gp-lose' : '')) + '">' + d.them + '</div>'; });
    h += '<div class="gp-rowlbl">Add</div>';
    f.days.forEach(function(d) {
      var m = stepsByDate[d.date];
      h += '<div class="' + (m === 'done' ? 'gp-win' : 'gp-add') + '">' + (m === 'done' ? '\u2713' : (m ? '+' : '')) + '</div>';
    });
    h += '</div>';
    if (plan && plan.gamesNote) h += '<div class="gp-note">' + esc(plan.gamesNote) + '</div>';
    h += '</div>';

    // Categories (collapsible).
    var catCollapsed = isSectionCollapsed('gpCats');
    h += '<div class="gp-card"><button class="gp-collapse" onclick="toggleSection(\'gpCats\');GamePlan.repaint()" aria-expanded="' + !catCollapsed + '">' +
      '<span class="gp-h">' + (f.dayOf > 1 ? 'Where it stands' : 'Category outlook') + '</span><span class="text-xs muted">' + (catCollapsed ? 'Show' : 'Hide') + '</span></button>';
    if (!catCollapsed) {
      f.categories.forEach(function(r) {
        var cat = cats.find(function(x) { return x.abbr === r.cat; }) || {};
        var lab = plan && plan.categories ? (plan.categories.find(function(x) { return x.cat === r.cat; }) || {}).label : '';
        var margin = r1(r.now - r.oppNow);
        var right = (f.dayOf > 1 ? (margin >= 0 ? '+' : '') + margin + (lab ? ', ' : '') : '') + (lab || '');
        h += '<div class="gp-catrow"><span style="color:' + (cat.color || '#fff') + ';font-weight:800">' + r.cat + '</span>' +
          '<div class="gp-bar"><div style="width:' + (r.winPct === null ? 0 : r.winPct) + '%;background:' + (cat.color || '#3b82f6') + '"></div></div>' +
          '<span style="font-weight:700">' + (r.winPct === null ? '--' : r.winPct + '%') + '</span>' +
          '<span style="color:' + (LABEL_COLOR[lab] || '#a0a0bf') + '">' + esc(right) + '</span></div>';
      });
      if (plan && plan.categoriesNote) h += '<div class="gp-note">' + esc(plan.categoriesNote) + '</div>';
    }
    h += '</div>';

    // Pickup plan.
    if (plan) {
      var tg = stepTargets(plan);
      h += '<div class="gp-card"><div class="gp-row"><div class="gp-h">Pickup plan</div><div class="text-xs muted">' +
        (f.pickups.limit >= 0 ? f.pickups.left + ' left this matchup' : 'no pickup limit') + '</div></div>';
      if (!(plan.pickupSteps || []).length) h += '<div class="gp-note">No pickups planned.</div>';
      (plan.pickupSteps || []).forEach(function(s, i) {
        var done = s.status === 'done' || s.status === 'skipped';
        var t = tg[i];
        h += '<div class="gp-step' + (done ? ' gp-step-done' : '') + (s.status === 'changed' ? ' gp-step-next' : '') + '">' +
          '<div class="gp-when" style="color:' + (s.status === 'done' ? '#22c55e' : '#7fb0ff') + '">' + esc(s.when) + (s.status === 'done' ? ' \u2713' : '') + '</div><div class="gp-step-body">' +
          '<div style="font-weight:700">' + (s.status === 'changed' ? 'Changed: ' : '') + esc(s.title) + '</div>' +
          (s.detail ? '<div class="muted">' + esc(s.detail) + '</div>' : '') +
          (t && !done ? '<div class="muted">Top target: <a href="#" onclick="openPlayerPopup(' + t.p.id + ');return false" style="font-weight:700">' + esc(t.p.name) + '</a>' +
            (t.onWaivers ? ' <span style="color:#f59e0b">(waivers)</span>' : '') + '</div>' : '') +
          (s.waitNote && !done ? '<div style="color:#f59e0b">' + esc(s.waitNote) + '</div>' : '') +
          (!done ? '<a href="#" class="text-xs" style="font-weight:700" onclick="GamePlan.openTargets();return false">See all targets in Players</a>' : '') +
          '</div></div>';
      });
      h += '</div>';

      // Day by day (collapsible, collapsed by default).
      if ((plan.days || []).length) {
        var dayOpen = S.prefs && S.prefs.collapsedSections && S.prefs.collapsedSections.gpDays === false;
        h += '<div class="gp-card"><button class="gp-collapse" onclick="GamePlan.toggleDays()" aria-expanded="' + dayOpen + '">' +
          '<span class="gp-h">Day by day</span><span class="text-xs muted">' + (dayOpen ? 'Hide' : 'Show') + '</span></button>';
        if (dayOpen) {
          plan.days.forEach(function(d) {
            h += '<div class="gp-day"><strong>' + esc(d.date ? weekday(d.date) : '') + '</strong> <span class="muted">' + esc(d.note) + '</span></div>';
          });
        } else {
          h += '<div class="text-xs muted">What to watch each night, who sits, and when lineups need a swap.</div>';
        }
        h += '</div>';
      }

      if (plan.theirSide) {
        var theirCollapsed = isSectionCollapsed('gpTheirs');
        h += '<div class="gp-card"><button class="gp-collapse" onclick="toggleSection(\'gpTheirs\');GamePlan.repaint()" aria-expanded="' + !theirCollapsed + '">' +
          '<span class="gp-h">Their side</span><span class="text-xs muted">' + (theirCollapsed ? 'Show' : 'Hide') + '</span></button>';
        if (!theirCollapsed) h += '<div class="gp-note">' + esc(plan.theirSide) + '</div>';
        h += '</div>';
      }

      h += '<button class="gp-ask" onclick="GamePlan.askLarry()">Ask Larry about this plan</button>';
      var c = current();
      h += '<div class="gp-foot">Rewrites itself each morning. Larry\'s Move on the Roster tab is today\'s step of this plan.' +
        (c ? ' Read your roster ' + esc(new Date(c.generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })) + '.' : '') + '</div>';
    }
    return h;
  }

  function render() {
    maybeAuto();
    return '<div id="game-plan" class="game-plan">' + html() + '</div>';
  }

  function toggleDays() {
    S.prefs = S.prefs || {};
    S.prefs.collapsedSections = S.prefs.collapsedSections || {};
    S.prefs.collapsedSections.gpDays = S.prefs.collapsedSections.gpDays === false ? true : false;
    autosave();
    repaint();
  }

  function askLarry() {
    var idx = TABS.findIndex(function(t) { return t.id === 'larry'; });
    if (idx >= 0) switchTab(idx);
    setTimeout(function() {
      var input = document.getElementById('chat-input');
      if (input) { input.value = 'About this week\'s Game Plan: '; input.focus(); }
    }, 60);
  }

  function openTargets() {
    var idx = TABS.findIndex(function(t) { return t.id === 'players'; });
    _targetMode = 'week';
    if (typeof setPlayersMode === 'function') _playersMode = 'targets';
    if (idx >= 0) switchTab(idx);
  }

  // A compact summary for Larry's Move and chat, so both follow the plan.
  function summary() {
    var c = current();
    var out = { intents: intents().map(function(i) { return i.text; }) };
    if (c && c.plan) {
      out.headline = c.plan.headline;
      out.steps = (c.plan.pickupSteps || []).map(function(s) {
        return { when: s.when, date: s.date, title: s.title, status: s.status, needCats: s.needCats || [] };
      });
      out.writtenAt = c.generatedAt;
    }
    return out;
  }

  // ---------- render: Players tab Targets ----------
  function setTargetMode(m) { _targetMode = m; _targetShow = 5; _targetOpen = {}; render2(); }
  function toggleTarget(id) { _targetOpen[id] = !_targetOpen[id]; render2(); }
  function moreTargets() { _targetShow += 10; render2(); }
  function render2() {
    var el = document.getElementById('targets-page');
    if (el) el.innerHTML = targetsHtml();
  }

  function espnAddUrl(p) {
    var lid = S.espn && S.espn.leagueId ? encodeURIComponent(S.espn.leagueId) : '';
    return 'https://fantasy.espn.com/basketball/players/add?leagueId=' + lid + '&playerId=' + encodeURIComponent(p.id);
  }

  function targetsHtml() {
    var c = current();
    var plan = c && c.plan;
    var list = targets(_targetMode, plan);
    var need = needCats(plan);
    var tg = plan ? stepTargets(plan) : [];
    var fits = {};
    tg.forEach(function(t, i) { if (t) fits[t.p.id] = plan.pickupSteps[i]; });
    var cats = getOrderedCategories();
    var colorOf = function(abbr) { var c2 = cats.find(function(x) { return x.abbr === abbr; }); return c2 ? c2.color : '#a0a0bf'; };

    var h = '<div class="filter-chips" role="group" aria-label="Which targets" style="margin-bottom:8px">';
    [['week', 'This week'], ['season', 'Stash for the season'], ['all', 'Free agents']].forEach(function(m) {
      h += '<button class="chip' + (_targetMode === m[0] ? ' active' : '') + '" style="min-height:36px" onclick="GamePlan.setTargetMode(\'' + m[0] + '\')">' + m[1] + '</button>';
    });
    h += '</div>';
    if (_targetMode === 'week') {
      h += '<div class="gp-need"><span class="muted">Need:</span>';
      need.forEach(function(n) { h += '<span class="gp-needchip" style="color:' + colorOf(n) + '">' + esc(n) + '</span>'; });
      h += '<span class="muted">' + (plan ? 'from this week\'s Game Plan' : 'categories still in play') + '</span></div>';
    } else if (_targetMode === 'season') {
      h += '<div class="text-xs muted" style="margin-bottom:8px">Ranked for the rest of the season. Rising minutes and hot streaks are noted.</div>';
    } else {
      h += '<div class="text-xs muted" style="margin-bottom:8px">Every unrostered player, by Larry rank. Injured players included.</div>';
    }
    if (!list.length) return h + '<div class="empty-state"><p>No targets right now. Sync to refresh.</p></div>';

    list.slice(0, _targetShow).forEach(function(t, i) {
      var p = t.p;
      var open = !!_targetOpen[p.id];
      var rank = (!p.noEvidence && p.durantRank) ? '#' + p.durantRank : '--';
      var status = t.onWaivers
        ? '<span style="color:#f59e0b">Waivers' + (p.waiverClearsAt ? ', clears ' + esc(weekday(localDateStr(new Date(p.waiverClearsAt)))) : '') + '</span>'
        : (out(p) ? '<span style="color:#ef4444">' + esc(Engines.normalizeInjuryStatus(p.injuryStatus)) + '</span>' : '<span style="color:#22c55e">Free agent</span>');
      var sub = (t.helps.length ? t.helps.join(', ') + ' &middot; ' : '') + t.usable.length + ' game' + (t.usable.length === 1 ? '' : 's') + ' &middot; ' + status +
        (t.notes.length ? ' &middot; <span style="color:#22c55e">\u2191 ' + esc(t.notes[0]) + '</span>' : '');
      h += '<div class="gp-target' + (open ? ' gp-target-open' : '') + '">';
      h += '<button class="gp-target-head" aria-expanded="' + open + '" onclick="GamePlan.toggleTarget(' + p.id + ')">' +
        '<span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span class="gp-target-name">' + (i + 1) + '. ' + esc(p.name) +
        ' <span class="gp-target-meta">' + esc(formatPositions(p.eligibleSlots)) + ' &middot; ' + esc(p.nbaTeam) + ' &middot; ' + rank + '</span>' +
        rosterTagHtml(p) + '</span><span class="gp-target-sub">' + sub + '</span></span>' +
        '<span class="muted">' + (open ? '\u25B2' : '\u25BC') + '</span></button>';
      if (open) {
        var r = blendedPerGame(p);
        h += '<div class="gp-target-stats">' + cats.map(function(c2) { return r1(r[c2.abbr]) + ' ' + c2.abbr; }).join(', ') + ' per game' +
          (t.notes.length ? ' &middot; <span style="color:#22c55e">' + esc(t.notes.join(', ')) + '</span>' : '') + '</div>';
        if (t.usable.length || t.lost.length) {
          h += '<div class="gp-days">';
          t.lost.forEach(function(d) { h += '<span class="gp-daychip gp-lostday">' + esc(weekday(d)) + '</span>'; });
          t.usable.forEach(function(d) { h += '<span class="gp-daychip">' + esc(weekday(d)) + '</span>'; });
          if (t.lost.length) h += '<span class="muted text-xs">' + t.lost.length + ' lost to waivers</span>';
          h += '</div>';
        }
        var why = '';
        var step = fits[p.id];
        if (step) why = 'Matches the ' + step.when + ' pickup: ' + step.title + '.';
        if (t.gain.length && t.usable.length) {
          why += (why ? ' ' : '') + 'About ' + t.gain.map(function(g) { return '+' + g.total + ' ' + g.cat; }).join(', ') + ' for the rest of the matchup.';
        }
        if (t.onWaivers) why += (why ? ' ' : '') + 'A claim, not an instant add.';
        if (why) h += '<div class="gp-note">' + esc(why) + '</div>';
        if (step) h += '<span class="gp-fit">Fits: ' + esc(step.when) + ' pickup</span>';
        var watching = S.watchlist && S.watchlist.indexOf(p.id) >= 0;
        h += '<div class="gp-target-actions">' +
          '<button class="btn btn-sm btn-secondary" onclick="toggleWatchlist(' + p.id + ');GamePlan.render2()" aria-label="Watch ' + esc(p.name) + '">' + (watching ? '\u2B50 Watching' : '\u2606 Watch') + '</button>' +
          '<button class="btn btn-sm btn-secondary" onclick="openPlayerPopup(' + p.id + ')">Player card</button>' +
          '<a class="btn btn-sm btn-primary gp-espn" href="' + esc(espnAddUrl(p)) + '" target="_blank" rel="noopener">Add on ESPN</a></div>';
      }
      h += '</div>';
    });
    if (list.length > _targetShow) {
      h += '<button class="btn btn-secondary btn-full" style="min-height:44px;margin-top:4px" onclick="GamePlan.moreTargets()">Show 10 more</button>';
    }
    return h;
  }

  function renderTargetsPage() {
    return '<div id="targets-page">' + targetsHtml() + '</div>';
  }

  return {
    render: render, repaint: repaint, refresh: function() { generate(true); },
    removeIntent: removeIntent, toggleIntentForm: function() { _intentForm = !_intentForm; repaint(); if (_intentForm) setTimeout(intentKindChanged, 0); },
    saveIntentForm: saveIntentForm, intentKindChanged: intentKindChanged,
    toggleDays: toggleDays, askLarry: askLarry, openTargets: openTargets, summary: summary,
    renderTargetsPage: renderTargetsPage, setTargetMode: setTargetMode, toggleTarget: toggleTarget,
    moreTargets: moreTargets, render2: render2,
    _internal: { facts: facts, sinceLast: sinceLast, targets: targets, stepTargets: stepTargets, needCats: needCats, payload: payload, snapshot: snapshot }
  };
})();
