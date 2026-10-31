// ============================================================
// LARRY CHAT TOOLS
// ============================================================
//
// The chat model asks for these by name (the schemas live server-side in
// netlify/functions/larry-chat.mjs, CHAT_TOOLS) and the app answers them
// here, in the browser, from the same state and engines the screens use.
// That is what makes chat "as smart as the app": it is not a second copy of
// the logic, it is the app's own logic, called on demand.
//
// Every tool returns a plain object; ChatTools.run serialises it. Numbers
// are rounded so the model reads 5.2, not 5.2083333. Internal scores
// (DURANT, z) are never returned: players are described by Larry rank and
// their stats, which is all the user ever sees.
//
// League data (team and player names) is written by other managers and is
// untrusted. The server tells the model so; nothing here interprets it.

var ChatTools = (function() {
  var MAX_LIST = 25;

  function r1(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v * 10) / 10 : null; }

  function catAbbrs() { return getOrderedCategories().map(function(c) { return c.abbr; }); }

  function roundStats(obj, keys) {
    if (!obj) return null;
    var out = {};
    keys.forEach(function(k) { if (obj[k] !== undefined && obj[k] !== null) out[k] = r1(obj[k]); });
    return out;
  }

  // Lowercase, accents stripped (Doncic matches Don\u010di\u0107), punctuation
  // dropped, so "deaaron fox" and "De'Aaron Fox" match.
  function norm(s) {
    var t = String(s || '');
    if (t.normalize) t = t.normalize('NFD');
    return t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  }

  // Find players by name: exact, then starts-with, then contains, then last
  // name. Returns all matches at the first level that has any.
  function findPlayers(name) {
    var q = norm(name);
    if (!q) return [];
    var all = S.allPlayers || [];
    var levels = [
      function(n) { return n === q; },
      function(n) { return n.indexOf(q) === 0; },
      function(n) { return n.indexOf(q) >= 0; },
      function(n) { var parts = n.split(' '); return parts[parts.length - 1] === q; }
    ];
    for (var i = 0; i < levels.length; i++) {
      var hit = all.filter(function(p) { return levels[i](norm(p.name)); });
      if (hit.length) return hit;
    }
    return [];
  }

  function onePlayer(name) {
    var hits = findPlayers(name);
    if (!hits.length) return { error: 'No player in this league\'s pool matches "' + name + '".' };
    if (hits.length > 1) {
      var exact = hits.filter(function(p) { return norm(p.name) === norm(name); });
      if (exact.length === 1) return { player: exact[0] };
      return { error: 'Several players match "' + name + '"', candidates: hits.slice(0, 8).map(function(p) { return p.name; }) };
    }
    return { player: hits[0] };
  }

  function ownerName(p) {
    if (!(p.onTeamId > 0)) return 'Free agent';
    if (S.myTeam && p.onTeamId === S.myTeam.teamId) return 'You (' + (S.myTeam.name || 'your team') + ')';
    var t = (S.teams || []).find(function(x) { return x.teamId === p.onTeamId; });
    return t ? t.name : 'Rostered';
  }

  function rankOf(p) { return p && !p.noEvidence && p.durantRank ? p.durantRank : null; }

  function windowEnd() {
    var w = getMatchupWindow() || {};
    return w.endStr || localDateStr(new Date());
  }

  // A player's games as day labels with opponent, from fromStr to toStr.
  function gameList(p, fromStr, toStr) {
    var live = Engines.enrichPlayer(p) || p;
    return ((live && live.schedule) || []).filter(function(g) {
      return g && g.date && g.date >= fromStr && g.date <= toStr;
    }).map(function(g) {
      return shortDayLabel(g.date) + ' ' + (g.isHome ? 'vs ' : '@ ') + (g.opponent || '?') +
        (g.timeLocal ? ' ' + g.timeLocal : '');
    });
  }

  function addDays(dateStr, n) {
    var parts = dateStr.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + n);
    return localDateStr(d);
  }

  // Short line for lists: rank, stats, games the reader can use.
  function playerBrief(p, opts) {
    opts = opts || {};
    var live = Engines.enrichPlayer(p) || p;
    var keys = catAbbrs();
    var todayStr = localDateStr(new Date());
    var from = opts.freeAgent ? pickupStartDateStr() : todayStr;
    var out = {
      name: live.name,
      team: live.nbaTeam,
      pos: live.positions || [],
      status: live.injuryStatus || 'ACTIVE',
      larryRank: rankOf(live),
      perGame: roundStats(blendedPerGame(live), keys),
      gamesThisMatchup: gameList(live, from, windowEnd())
    };
    if (p.slot || p.slotId !== undefined) out.slot = p.slot || null;
    if (opts.owner) out.owner = ownerName(live);
    if (opts.owned) out.ownedPct = r1(live.percentOwned || 0);
    if (opts.recent) out.last7 = roundStats(ESPNSync.getPerGameStats(live, 'last7'), keys.concat(['MIN']));
    return out;
  }

  function resolveTeam(name) {
    var teams = S.teams || [];
    var q = norm(name);
    if (!q || q === 'me' || q === 'my team' || q === 'mine' || q === 'you') {
      return teams.find(function(t) { return t.teamId === S.myTeam.teamId; }) || null;
    }
    if (q === 'opponent' || q === 'opp' || q === 'my opponent') {
      return teams.find(function(t) { return t.teamId === S.matchup.opponentTeamId; }) || null;
    }
    return teams.find(function(t) { return norm(t.name) === q || norm(t.abbrev) === q; }) ||
      teams.find(function(t) { return norm(t.name).indexOf(q) >= 0; }) ||
      teams.find(function(t) { return norm(t.owner || '').indexOf(q) >= 0; }) || null;
  }

  // Per-game category totals for every roster (IR excluded) and each team's
  // league rank in each category. The same numbers the Trade Center uses.
  function leagueCategoryTable() {
    var cats = getOrderedCategories();
    var rows = (S.teams || []).map(function(t) {
      var tot = {};
      cats.forEach(function(c) { tot[c.abbr] = 0; });
      (t.players || []).forEach(function(stub) {
        if (stub.slotId === 13) return;
        var r = blendedPerGame(Engines.enrichPlayer(stub) || stub);
        cats.forEach(function(c) { tot[c.abbr] += r[c.abbr] || 0; });
      });
      return { teamId: t.teamId, totals: tot };
    });
    var ranks = {};
    rows.forEach(function(row) {
      ranks[row.teamId] = {};
      cats.forEach(function(c) {
        var better = rows.filter(function(o) {
          return c.isNegative ? o.totals[c.abbr] < row.totals[c.abbr] : o.totals[c.abbr] > row.totals[c.abbr];
        }).length;
        ranks[row.teamId][c.abbr] = better + 1;
      });
    });
    var byId = {};
    rows.forEach(function(row) { byId[row.teamId] = { totals: roundStats(row.totals, cats.map(function(c) { return c.abbr; })), ranks: ranks[row.teamId] }; });
    return byId;
  }

  // ---------- the tools ----------

  var TOOLS = {};

  TOOLS.get_player = function(input) {
    var found = onePlayer(input.name);
    if (found.error) return found;
    var p = found.player;
    Engines.ensureDURANT(S.allPlayers || []);
    var keys = catAbbrs();
    var withMin = keys.concat(['MIN']);
    var todayStr = localDateStr(new Date());
    var splits = {};
    ['season', 'last30', 'last15', 'last7'].forEach(function(sp) {
      var st = ESPNSync.getPerGameStats(p, sp);
      if (st) {
        splits[sp] = roundStats(st, withMin);
        splits[sp].games = ESPNSync.splitGP(p, sp);
      }
    });
    var free = !(p.onTeamId > 0);
    return {
      name: p.name,
      nbaTeam: p.nbaTeam,
      positions: p.positions || [],
      status: p.injuryStatus || 'ACTIVE',
      owner: ownerName(p),
      larryRank: rankOf(p),
      ownedPct: r1(p.percentOwned || 0),
      trend: p.trend || 'steady',
      expectedPerGame: roundStats(blendedPerGame(p), keys),
      actualPerGame: splits,
      gamesRestOfMatchup: gameList(p, free ? pickupStartDateStr() : todayStr, windowEnd()),
      next7Days: gameList(p, todayStr, addDays(todayStr, 6)),
      gamesLeftThisSeason: p.gamesRemainingROS || null,
      note: free ? 'Free agent: gamesRestOfMatchup starts on the first day a pickup made now can play.' : undefined
    };
  };

  TOOLS.get_player_news = function(input) {
    var found = onePlayer(input.name);
    if (found.error) return Promise.resolve(found);
    var p = found.player;
    return fetch(ESPN_NEWS_API + p.id).then(function(r) {
      if (!r.ok) throw new Error('ESPN news returned ' + r.status);
      return r.json();
    }).then(function(data) {
      var items = parseNewsFeed(data).slice(0, 5).map(function(n) {
        return { headline: n.headline, story: String(n.story || '').slice(0, 600), published: n.published, source: n.source };
      });
      return { name: p.name, status: p.injuryStatus || 'ACTIVE', news: items };
    }, function(e) {
      return { name: p.name, error: 'News unavailable: ' + (e && e.message ? e.message : 'failed') };
    });
  };

  TOOLS.search_free_agents = function(input) {
    Engines.ensureDURANT(S.allPlayers || []);
    var keys = catAbbrs();
    var limit = Math.min(Number(input.limit) || 10, MAX_LIST);
    var pickFrom = pickupStartDateStr();
    var end = windowEnd();
    var day = input.plays_on ? resolveDay(input.plays_on) : null;
    if (input.plays_on && !day) return { error: 'Could not read the day "' + input.plays_on + '". Use YYYY-MM-DD or a weekday name.' };
    var list = (S.allPlayers || []).filter(function(p) {
      if (p.onTeamId > 0) return false;
      if (!input.include_injured && !Engines.isValidAddCandidate(p)) return false;
      if (input.position && (p.positions || []).indexOf(String(input.position).toUpperCase()) < 0) return false;
      var live = Engines.enrichPlayer(p) || p;
      var dates = (live.schedule || []).map(function(g) { return g.date; });
      if (day && dates.indexOf(day) < 0) return false;
      if (input.min_games_this_matchup) {
        var usable = dates.filter(function(d) { return d >= pickFrom && d <= end; }).length;
        if (usable < Number(input.min_games_this_matchup)) return false;
      }
      return true;
    });
    var sortBy = String(input.sort_by || 'rank').toUpperCase();
    if (keys.indexOf(sortBy) >= 0) {
      list.sort(function(a, b) { return (blendedPerGame(b)[sortBy] || 0) - (blendedPerGame(a)[sortBy] || 0); });
    } else {
      list.sort(byDurantRank);
    }
    var note = 'Pickups made now first count on ' + shortDayLabel(pickFrom) + '.';
    if (day && day < pickFrom) note += ' ' + shortDayLabel(day) + ' is before that, so none of these can play for you that day.';
    return {
      pickupsCountFrom: shortDayLabel(pickFrom),
      note: note,
      results: list.slice(0, limit).map(function(p) {
        return playerBrief(p, { freeAgent: true, owned: true, recent: true });
      })
    };
  };

  // "Sunday", "sun", "tomorrow", "today" or YYYY-MM-DD to a date string
  // within the next 7 days.
  function resolveDay(text) {
    var t = String(text || '').trim().toLowerCase();
    var todayStr = localDateStr(new Date());
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    if (t === 'today' || t === 'tonight') return todayStr;
    if (t === 'tomorrow') return addDays(todayStr, 1);
    var names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    var idx = names.indexOf(t.slice(0, 3));
    if (idx < 0) return null;
    for (var i = 0; i < 7; i++) {
      var d = addDays(todayStr, i);
      var parts = d.split('-');
      if (new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getDay() === idx) return d;
    }
    return null;
  }

  TOOLS.get_team = function(input) {
    var t = resolveTeam(input.team);
    if (!t) return { error: 'No team matches "' + input.team + '".', teams: (S.teams || []).map(function(x) { return x.name; }) };
    Engines.ensureDURANT(S.allPlayers || []);
    var table = leagueCategoryTable();
    var isMe = t.teamId === S.myTeam.teamId;
    return {
      name: t.name,
      isYou: isMe,
      record: t.record ? t.record.wins + '-' + t.record.losses + '-' + t.record.ties : null,
      playoffSeed: t.playoffSeed || null,
      categoryPerGameTotals: table[t.teamId] ? table[t.teamId].totals : null,
      categoryLeagueRanks: table[t.teamId] ? table[t.teamId].ranks : null,
      roster: (t.players || []).map(function(stub) {
        var b = playerBrief(Object.assign({}, Engines.enrichPlayer(stub) || stub, { slot: stub.slot, slotId: stub.slotId }), {});
        b.slot = stub.slot || (stub.slotId === 13 ? 'IR' : (stub.slotId === 12 ? 'BE' : null));
        return b;
      })
    };
  };

  TOOLS.get_matchup = function(input) {
    var cats = getOrderedCategories();
    var mp = S.league.currentMatchupPeriod;
    var t = input && input.team ? resolveTeam(input.team) : resolveTeam('me');
    if (!t) return { error: 'No team matches "' + input.team + '".' };
    var game = (S.league.schedule || []).find(function(m) {
      return m.matchupPeriodId === mp && ((m.home && m.home.teamId === t.teamId) || (m.away && m.away.teamId === t.teamId));
    });
    if (!game) return { error: 'No matchup found for ' + t.name + ' this period.' };
    var mine = game.home && game.home.teamId === t.teamId ? game.home : game.away;
    var theirs = mine === game.home ? game.away : game.home;
    var opp = theirs ? (S.teams || []).find(function(x) { return x.teamId === theirs.teamId; }) : null;
    function full(list) {
      return (list || []).map(function(stub) {
        var f = Engines.enrichPlayer(stub);
        return f && f !== stub ? Object.assign({}, f, { slotId: stub.slotId }) : stub;
      });
    }
    var projMine = projectRestOfMatchup(full(t.players));
    var projOpp = projectRestOfMatchup(full(opp ? opp.players : []));
    var win = getMatchupWindow() || {};
    var isMe = t.teamId === S.myTeam.teamId;
    var strat = isMe ? (S.matchup.strategy || {}) : {};
    var rows = cats.map(function(c) {
      var now = (mine.cats || {})[c.abbr] || 0;
      var oppNow = theirs && theirs.cats ? (theirs.cats[c.abbr] || 0) : 0;
      var row = {
        cat: c.abbr,
        now: r1(now), oppNow: r1(oppNow),
        projectedFinal: r1(now + (projMine.totals[c.abbr] || 0)),
        oppProjectedFinal: r1(oppNow + (projOpp.totals[c.abbr] || 0))
      };
      if (strat.winProb && strat.winProb[c.abbr] !== undefined) row.winPct = Math.round(strat.winProb[c.abbr] * 100);
      return row;
    });
    return {
      matchupPeriod: mp,
      team: t.name,
      opponent: opp ? opp.name : null,
      window: { start: win.startStr ? shortDayLabel(win.startStr) : null, end: win.endStr ? shortDayLabel(win.endStr) : null, daysLeft: win.daysLeft },
      usableGamesLeft: { team: projMine.games, opponent: projOpp.games },
      categories: rows,
      note: 'Projected finals add each side\'s best healthy players with games, up to the starting slots each day. Win % is only computed for your own matchup.'
    };
  };

  TOOLS.get_day_schedule = function(input) {
    var day = resolveDay(input.date || 'today');
    if (!day) return { error: 'Could not read the day "' + input.date + '".' };
    var oppTeam = (S.teams || []).find(function(x) { return x.teamId === S.matchup.opponentTeamId; });
    function who(list) {
      return (list || []).map(function(stub) { return Engines.enrichPlayer(stub) || stub; }).filter(function(p) {
        return (p.schedule || []).some(function(g) { return g.date === day; });
      }).map(function(p) {
        var g = p.schedule.find(function(x) { return x.date === day; });
        return p.name + ' (' + (g.isHome ? 'vs ' : '@ ') + (g.opponent || '?') + (g.timeLocal ? ' ' + g.timeLocal : '') +
          ', ' + (p.injuryStatus || 'ACTIVE') + ')';
      });
    }
    var nbaTeams = [];
    Object.keys(S.scheduleLookup || {}).forEach(function(tid) {
      if ((S.scheduleLookup[tid] || []).some(function(g) { return g.date === day; })) nbaTeams.push(ESPN_TEAM_MAP[tid] || tid);
    });
    var pickFrom = pickupStartDateStr();
    return {
      day: shortDayLabel(day),
      nbaTeamsPlaying: nbaTeams,
      yourPlayersPlaying: who(S.myTeam.players),
      opponentPlayersPlaying: who(oppTeam ? oppTeam.players : []),
      canStillAddForThisDay: day >= pickFrom,
      pickupsCountFrom: shortDayLabel(pickFrom)
    };
  };

  TOOLS.analyze_trade = function(input) {
    function ids(names) {
      var out = [], errors = [];
      (names || []).slice(0, 3).forEach(function(n) {
        var f = onePlayer(n);
        if (f.error) errors.push(f); else out.push(f.player.id);
      });
      return { ids: out, errors: errors };
    }
    var give = ids(input.give), get = ids(input.get);
    if (give.errors.length || get.errors.length) return { error: 'Could not identify every player.', details: give.errors.concat(get.errors) };
    var t = tradeAnalysisData(give.ids, get.ids);
    if (t.error) return t;
    return {
      verdict: t.verdict.label,
      explanation: t.lines,
      youGive: t.give.map(function(p) { return p.name + ' (Larry rank ' + (rankOf(p) || '--') + ')'; }),
      youGet: t.get.map(function(p) { return p.name + ' (Larry rank ' + (rankOf(p) || '--') + ', ' + ownerName(p) + ')'; }),
      yourCategories: t.cats.map(function(c) {
        var m = t.impact.mine[c.abbr];
        return { cat: c.abbr, perGameBefore: r1(m.before), perGameAfter: r1(m.after), leagueRankBefore: m.rankBefore, leagueRankAfter: m.rankAfter };
      })
    };
  };

  TOOLS.get_standings = function() {
    var table = leagueCategoryTable();
    var teams = (S.teams || []).slice().sort(function(a, b) {
      return (a.playoffSeed || 99) - (b.playoffSeed || 99);
    });
    return {
      playoffTeams: S.league.playoffTeams || null,
      teams: teams.map(function(t) {
        return {
          name: t.name,
          isYou: t.teamId === S.myTeam.teamId,
          seed: t.playoffSeed || null,
          record: t.record ? t.record.wins + '-' + t.record.losses + '-' + t.record.ties : null,
          categoryLeagueRanks: table[t.teamId] ? table[t.teamId].ranks : null
        };
      })
    };
  };

  TOOLS.get_league_week = function(input) {
    var cats = getOrderedCategories();
    var mp = Number(input && input.matchup_period) || S.league.currentMatchupPeriod;
    var games = (S.league.schedule || []).filter(function(m) { return m.matchupPeriodId === mp && m.home && m.away; });
    var totw = computeTeamOfWeek(S.league.schedule, mp, cats);
    return {
      matchupPeriod: mp,
      matchups: games.map(function(m) {
        var r = m.home.cats && m.away.cats ? totwCompare(cats, m.home.cats, m.away.cats) : null;
        return {
          home: teamNameFor(m.home.teamId), away: teamNameFor(m.away.teamId),
          homeCategories: m.home.cats ? roundStats(m.home.cats, cats.map(function(c) { return c.abbr; })) : null,
          awayCategories: m.away.cats ? roundStats(m.away.cats, cats.map(function(c) { return c.abbr; })) : null,
          score: r ? r.w + '-' + r.l + (r.t ? '-' + r.t : '') + ' (home first)' : 'not started'
        };
      }),
      teamOfTheWeek: totw && totw.winners.length ? totw.winners.map(function(w) {
        return { team: teamNameFor(w.teamId), recordVsOtherWinners: w.record.w + '-' + w.record.l + (w.record.t ? '-' + w.record.t : '') };
      }) : null
    };
  };

  TOOLS.get_rankings = function(input) {
    Engines.ensureDURANT(S.allPlayers || []);
    var limit = Math.min(Number(input && input.limit) || 15, MAX_LIST);
    var list = (S.allPlayers || []).filter(function(p) {
      if (input && input.available_only && p.onTeamId > 0) return false;
      if (input && input.position && (p.positions || []).indexOf(String(input.position).toUpperCase()) < 0) return false;
      return rankOf(p);
    }).sort(byDurantRank);
    return { players: list.slice(0, limit).map(function(p) { return playerBrief(p, { owner: true }); }) };
  };

  TOOLS.get_last_night = function(input) {
    var day = input && input.date ? resolveDayPast(input.date) : addDays(localDateStr(new Date()), -1);
    if (!day) return { error: 'Could not read the day "' + input.date + '".' };
    return new Promise(function(resolve) {
      var tries = 0;
      function check() {
        var st = Reports.day(day, null);
        if (st.status === 'ready') {
          var cats = getOrderedCategories();
          var ranked = Reports.scoreLines(st.data.players, cats).slice(0, 5);
          var leaders = {};
          cats.forEach(function(c) {
            leaders[c.abbr] = Reports.leaders(st.data.players, c.abbr, 3, c.isNegative).map(function(x) {
              return x.n + ' ' + Math.round(x.v) + ' (' + reportOwner(x.id) + ')';
            });
          });
          resolve({
            day: shortDayLabel(day),
            complete: st.data.complete,
            bestLines: ranked.map(function(x) { return x.n + ': ' + statLine(x.s, cats, 1) + ' (' + reportOwner(x.id) + ')'; }),
            categoryLeaders: leaders
          });
        } else if (st.status === 'error' || tries++ > 40) {
          resolve({ error: 'Box scores unavailable for ' + shortDayLabel(day) + '.' });
        } else {
          setTimeout(check, 250);
        }
      }
      check();
    });
  };

  function resolveDayPast(text) {
    var t = String(text || '').trim().toLowerCase();
    var todayStr = localDateStr(new Date());
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    if (t === 'yesterday' || t === 'last night') return addDays(todayStr, -1);
    if (t === 'today' || t === 'tonight') return todayStr;
    var names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    var idx = names.indexOf(t.slice(0, 3));
    if (idx < 0) return null;
    for (var i = 1; i <= 7; i++) {
      var d = addDays(todayStr, -i);
      var parts = d.split('-');
      if (new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getDay() === idx) return d;
    }
    return null;
  }

  // Run one tool call. Always resolves (never rejects) to a string, so one
  // failing tool becomes an error the model can read rather than a dead chat.
  function run(name, input) {
    var fn = TOOLS[name];
    if (!fn) return Promise.resolve(JSON.stringify({ error: 'Unknown tool ' + name }));
    var out;
    try {
      out = fn(input || {});
    } catch (e) {
      return Promise.resolve(JSON.stringify({ error: 'Tool failed: ' + (e && e.message ? e.message : 'unknown') }));
    }
    return Promise.resolve(out).then(function(v) {
      var text = JSON.stringify(v);
      return text.length > 12000 ? text.slice(0, 12000) + '...(truncated)' : text;
    }, function(e) {
      return JSON.stringify({ error: 'Tool failed: ' + (e && e.message ? e.message : 'unknown') });
    });
  }

  // Shown while a tool runs, so the wait reads as progress.
  var LABELS = {
    get_player: 'Looking up a player',
    get_player_news: 'Reading player news',
    search_free_agents: 'Searching free agents',
    get_team: 'Pulling a roster',
    get_matchup: 'Checking the matchup',
    get_day_schedule: 'Checking the schedule',
    analyze_trade: 'Running the trade analyzer',
    get_standings: 'Checking standings',
    get_league_week: 'Checking every matchup',
    get_rankings: 'Checking Larry\'s rankings',
    get_last_night: 'Reading box scores'
  };

  return {
    run: run,
    label: function(name) { return LABELS[name] || 'Checking the app'; },
    names: Object.keys(TOOLS),
    _internal: { findPlayers: findPlayers, resolveDay: resolveDay, norm: norm }
  };
})();
