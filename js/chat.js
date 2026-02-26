// ============================================================
// LARRY v2 -- CHAT MODULE
// Full Claude API integration via serverless proxy
// No preprogrammed responses -- every question goes to Claude
// ============================================================

var LarryChat = (function() {

  var PROXY_URL = '/.netlify/functions/larry-chat';
  var isTyping = false;

  // --- BUILD CONTEXT FOR LARRY ---
  function buildContext() {
    var ctx = {};

    // League info
    ctx.leagueName = S.league.name;
    ctx.scoringType = S.league.scoringType;
    ctx.categories = S.league.categories.map(function(c) { return c.abbr; });
    ctx.teamCount = S.league.teamCount;

    // User's team
    ctx.teamName = S.myTeam.name;
    ctx.record = S.myTeam.record.wins + '-' + S.myTeam.record.losses + '-' + S.myTeam.record.ties;

    // Standing
    var standings = S.teams.slice().sort(function(a, b) {
      var aPct = a.record.wins / Math.max(a.record.wins + a.record.losses, 1);
      var bPct = b.record.wins / Math.max(b.record.wins + b.record.losses, 1);
      return bPct - aPct;
    });
    var myIdx = standings.findIndex(function(t) { return t.teamId === S.myTeam.teamId; });
    if (myIdx >= 0) ctx.standing = ordinal(myIdx + 1) + ' of ' + S.league.teamCount;

    // Category league ranks
    ctx.categoryRanks = {};
    S.league.categories.forEach(function(cat) {
      var teamTotals = S.teams.map(function(t) {
        var total = 0;
        t.players.forEach(function(p) {
          var v = p.stats && p.stats.season ? p.stats.season[cat.abbr] : 0;
          total += (v || 0);
        });
        return { teamId: t.teamId, total: total };
      });
      teamTotals.sort(function(a, b) {
        return cat.isNegative ? (a.total - b.total) : (b.total - a.total);
      });
      var rank = teamTotals.findIndex(function(t) { return t.teamId === S.myTeam.teamId; });
      ctx.categoryRanks[cat.abbr] = rank >= 0 ? rank + 1 : null;
    });

    // Current matchup
    ctx.matchup = {
      opponent: S.matchup.opponentName,
      record: S.matchup.myRecord.wins + '-' + S.matchup.myRecord.losses + '-' + S.matchup.myRecord.ties,
      daysRemaining: S.matchup.daysRemaining,
      categories: []
    };
    S.league.categories.forEach(function(cat) {
      var my = S.matchup.myScores[cat.abbr] || 0;
      var opp = S.matchup.oppScores[cat.abbr] || 0;
      var winning = cat.isNegative ? (my < opp) : (my > opp);
      var status = my === opp ? 'TIED' : (winning ? 'WINNING' : 'LOSING');
      ctx.matchup.categories.push({ cat: cat.abbr, my: fmt(my, 1), opp: fmt(opp, 1), status: status });
    });

    // Roster with stats + z-scores
    ctx.roster = S.myTeam.players.map(function(p) {
      var statLine = '';
      S.league.categories.forEach(function(cat) {
        var val = p.stats.season ? p.stats.season[cat.abbr] : null;
        if (val !== null && val !== undefined) statLine += cat.abbr + ':' + fmt(val, 1) + ' ';
      });
      var zLine = '';
      if (p.zScores) {
        zLine = 'z:' + fmt(p.zScores.total || 0, 2);
      }
      return {
        name: p.name,
        pos: p.positions.join('/'),
        team: p.nbaTeam,
        slot: p.slot,
        status: p.status,
        stats: statLine.trim(),
        zScore: zLine,
        gamesRemaining: p.gamesRemaining
      };
    });

    // Top 15 free agents by z-score
    try {
      var fas = (S.allPlayers || [])
        .filter(function(p) { return !p.onTeamId && p.zScores && p.zScores.total; })
        .sort(function(a, b) { return (b.zScores.total || 0) - (a.zScores.total || 0); })
        .slice(0, 15)
        .map(function(p) {
          return { name: p.name, pos: p.positions.join('/'), team: p.nbaTeam, z: fmt(p.zScores.total, 2) };
        });
      ctx.topFreeAgents = fas;
    } catch(e) { ctx.topFreeAgents = []; }

    // Injuries
    ctx.injuries = S.myTeam.players
      .filter(function(p) { return p.status !== 'ACTIVE' && p.status !== 'HEALTHY'; })
      .map(function(p) { return { name: p.name, status: p.status + (p.injuryNote ? ' - ' + p.injuryNote : '') }; });

    return ctx;
  }

  // --- QUICK ASK PRESETS ---
  var QUICK_ASKS = [
    { label: '\uD83C\uDFAF Who should I start?', msg: 'Based on my current matchup and games remaining this week, who should I start and who should I bench? Give me the optimal lineup.' },
    { label: '\uD83D\uDCC9 Drop suggestions?', msg: 'Who is the weakest player on my roster right now? Who should I consider dropping and why?' },
    { label: '\uD83D\uDD04 Trade targets?', msg: 'Based on my category strengths and weaknesses, what type of players should I be targeting in trades? Name specific players on other teams.' },
    { label: '\u2694\uFE0F Am I winning?', msg: 'Break down my current matchup category by category. Where am I strong, where am I weak, and what moves can I make to win more categories?' },
    { label: '\uD83C\uDD93 Best pickup?', msg: 'Who are the best free agents available right now for my team? Consider my category needs and upcoming schedule.' },
    { label: '\uD83E\uDDE0 Punt strategy', msg: 'Looking at my roster construction, am I naturally punting any categories? Should I lean into a punt strategy, and if so, which categories and what moves should I make?' }
  ];

  // --- SEND MESSAGE TO LARRY ---
  async function sendMessage(userMessage) {
    if (isTyping) return;
    isTyping = true;

    // Add user message to history
    S.chatHistory.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    });
    autosave();

    // Show typing indicator
    renderChatMessages();
    showTyping(true);

    try {
      // Build messages array for API
      var messages = S.chatHistory
        .filter(function(m) { return m.role === 'user' || m.role === 'assistant'; })
        .map(function(m) { return { role: m.role, content: m.content }; });

      var response = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages,
          context: buildContext()
        })
      });

      if (!response.ok) {
        var errData = await response.json().catch(function() { return { error: 'Unknown error' }; });
        var errMsg = errData.error || 'API returned ' + response.status;
        // Specific error guidance
        if (response.status === 401 || errMsg.indexOf('api_key') >= 0) {
          throw new Error('API key issue. Set ANTHROPIC_API_KEY in Netlify environment variables (Site Settings > Environment Variables).');
        } else if (response.status === 429) {
          throw new Error('Rate limited. Wait a minute and try again.');
        } else if (response.status === 502 || response.status === 503) {
          throw new Error('Netlify function error. Check that larry-chat.js is deployed correctly.');
        }
        throw new Error(errMsg);
      }

      var data = await response.json();
      var larryResponse = data.response || 'Sorry, I couldn\'t process that. Try again.';

      S.chatHistory.push({
        role: 'assistant',
        content: larryResponse,
        timestamp: new Date().toISOString()
      });
      autosave();

    } catch (e) {
      console.error('Larry chat error:', e);
      S.chatHistory.push({
        role: 'assistant',
        content: '\u26A0\uFE0F ' + e.message,
        timestamp: new Date().toISOString()
      });
      autosave();
    }

    isTyping = false;
    showTyping(false);
    renderChatMessages();
  }

  // --- RENDER CHAT MESSAGES ---
  function renderChatMessages() {
    var container = document.getElementById('chat-messages');
    if (!container) return;

    if (S.chatHistory.length === 0) {
      var quickHtml = '<div class="quick-asks">';
      QUICK_ASKS.forEach(function(q) {
        quickHtml += '<button class="quick-ask-btn" onclick="sendQuickAsk(\'' + q.msg.replace(/'/g, "\\'") + '\')">' + q.label + '</button>';
      });
      quickHtml += '</div>';

      container.innerHTML = '<div class="chat-welcome">' +
        '<div class="larry-avatar">' + getLarryAvatar(64) + '</div>' +
        '<h3>Hey, I\'m Larry.</h3>' +
        '<p>PhD statistician, 20-year college basketball coach, and your fantasy basketball analyst. Ask me anything about your team, matchups, trades, or strategy.</p>' +
        '<p class="muted">I have full access to your league data, so ask specific questions and I\'ll give you specific answers with real numbers.</p>' +
        quickHtml +
        '</div>';
      return;
    }

    var html = '';
    S.chatHistory.forEach(function(msg) {
      if (msg.role === 'user') {
        html += '<div class="chat-msg user"><div class="msg-bubble">' + esc(msg.content) + '</div></div>';
      } else {
        html += '<div class="chat-msg assistant">';
        html += '<div class="larry-chat-avatar">' + getLarryAvatar(28) + '</div>';
        html += '<div class="msg-bubble">' + formatMarkdown(msg.content) + '</div>';
        html += '</div>';
      }
    });

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
  }

  // --- TYPING INDICATOR ---
  function showTyping(show) {
    var el = document.getElementById('typing-indicator');
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  // --- FORMAT MARKDOWN (BASIC) ---
  function formatMarkdown(text) {
    if (!text) return '';
    return esc(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  // --- CLEAR CHAT ---
  function clearChat() {
    S.chatHistory = [];
    autosave();
    renderChatMessages();
  }

  // --- UTILITY ---
  function ordinal(n) {
    var s = ['th','st','nd','rd'];
    var v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  return {
    sendMessage: sendMessage,
    renderChatMessages: renderChatMessages,
    clearChat: clearChat,
    buildContext: buildContext,
    isTyping: function() { return isTyping; }
  };
})();

// Global quick-ask handler
function sendQuickAsk(msg) {
  var input = document.getElementById('chat-input');
  if (input) input.value = msg;
  LarryChat.sendMessage(msg);
}
