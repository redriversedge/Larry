// ============================================================
// LARRY v3.0 -- CHAT MODULE
// AI chat with Larry the basketball owl
// ============================================================

var _chatHistory = [];
var _chatSending = false;
var _chatError = '';

function renderChat(container) {
  var html = '<div class="chat-container">';

  // Header
  html += '<div class="chat-header">';
  html += '<div class="larry-chat-avatar small">' + getLarryAvatar(20) + '</div>';
  html += '<div class="chat-title">Larry AI</div>';
  html += '<button class="btn btn-sm" style="min-height:44px" aria-label="Clear chat" ' +
    'onclick="clearChat()" title="Clear chat">\u{1F5D1}</button>';
  html += '</div>';

  // Messages
  html += '<div class="chat-messages" id="chat-messages">';
  html += chatMessagesHtml();
  html += '</div>';

  // Input area
  html += '<div class="chat-input-area">';
  html += '<input type="text" class="chat-input" id="chat-input" aria-label="Ask Larry a question" placeholder="Ask Larry..." ';
  html += 'onkeydown="if(event.key===\'Enter\')sendChat()">';
  html += '<button class="chat-send-btn" style="min-height:44px" aria-label="Send" onclick="sendChat()" ' + (_chatSending ? 'disabled' : '') + '>\u{27A4}</button>';
  html += '</div>';

  html += '</div>';
  container.innerHTML = html;
  scrollChatToBottom();
}

// Only the message list. Re-rendering the whole tab replaced the input
// element, which on mobile closes the keyboard mid-conversation.
function renderChatMessages() {
  var msgs = document.getElementById('chat-messages');
  if (!msgs) { render(); return; }
  msgs.innerHTML = chatMessagesHtml();
  var sendBtn = document.querySelector('.chat-send-btn');
  if (sendBtn) sendBtn.disabled = _chatSending;
  scrollChatToBottom();
}

function scrollChatToBottom() {
  var msgs = document.getElementById('chat-messages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

function clearChat() {
  _chatHistory = [];
  _chatError = '';
  render();
}

function chatMessagesHtml() {
  var html = '';

  if (!_chatHistory.length) {
    // Welcome + quick asks
    html += '<div class="chat-bubble assistant">';
    html += '<div class="chat-avatar">' + getLarryAvatar(16) + ' Larry</div>';
    html += 'Hey! I\'m Larry, your fantasy basketball analyst. Ask me anything about your team, matchup, or the waiver wire.';
    html += '</div>';

    html += '<div class="quick-asks">';
    var quickAsks = [
      { label: '\u{1F3AF} Who should I start?', q: 'Who should I start this week?' },
      { label: '\u{1F4A1} Drop suggestions', q: 'Who should I consider dropping from my roster?' },
      { label: '\u{1F4CA} Matchup analysis', q: 'Analyze my current matchup and tell me my strengths and weaknesses.' },
      { label: '\u{1F50D} Waiver targets', q: 'Who are the best players available on the waiver wire right now?' },
      { label: '\u{1F4C8} Trade targets', q: 'What trade targets should I be looking at to improve my team?' },
      { label: '\u{1F52E} Playoff outlook', q: 'What are my playoff chances and what do I need to do to improve them?' }
    ];
    quickAsks.forEach(function(qa) {
      html += '<button class="quick-ask-btn" onclick="sendChat(\'' + qa.q.replace(/'/g, "\\'") + '\')">' + qa.label + '</button>';
    });
    html += '</div>';
  } else {
    _chatHistory.forEach(function(msg) {
      html += '<div class="chat-bubble ' + msg.role + '">';
      if (msg.role === 'assistant') {
        html += '<div class="chat-avatar">' + getLarryAvatar(16) + ' Larry</div>';
      }
      html += formatChatMessage(msg.content);
      html += '</div>';
    });
  }

  if (_chatSending) {
    html += '<div class="chat-bubble assistant"><div class="chat-avatar">' + getLarryAvatar(16) + ' Larry</div>';
    html += '<div class="typing-dots"><span>.</span><span>.</span><span>.</span></div></div>';
  }

  // Errors render here rather than being pushed into _chatHistory, so they
  // are never replayed to the model as if Larry had said them.
  if (_chatError) {
    html += '<div class="chat-bubble assistant" role="alert" style="border-left:3px solid var(--accent-red,#ef4444)">';
    html += '<div class="chat-avatar">' + getLarryAvatar(16) + ' Larry</div>';
    html += esc(_chatError);
    html += '<div style="margin-top:8px"><button class="btn btn-sm btn-secondary" ' +
      'style="min-height:44px" onclick="dismissChatError()">Dismiss</button></div>';
    html += '</div>';
  }

  return html;
}

function dismissChatError() {
  _chatError = '';
  renderChatMessages();
}

function formatChatMessage(text) {
  if (!text) return '';
  // Basic markdown-like formatting
  return esc(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

// Build STRUCTURED context for the server to render.
//
// This used to return a pre-formatted prompt string that the client also
// wrapped in a full system prompt and shipped to the function, which then
// forwarded it to Claude verbatim. That made the endpoint an open LLM proxy
// and put raw ESPN text (team names written by other managers) directly
// into the prompt. The client now sends only typed fields; the function
// sanitizes them and does all the prompt construction.
function buildChatContext() {
  // A sync clears durantComputedAt and only render paths recompute, so
  // opening chat first after a sync used to send every durantRank and
  // durantScore as undefined. Cheap when already current.
  Engines.ensureDURANT(S.allPlayers || []);

  var cats = getOrderedCategories();
  var rec = S.myTeam.record || { wins: 0, losses: 0, ties: 0 };
  var strat = S.matchup.strategy || {};

  function playerPayload(p) {
    return {
      name: p.name,
      pos: p.positions || [],
      team: p.nbaTeam,
      injury: p.injuryStatus,
      // The rank, not the internal score: the model quotes what it is
      // given, and "value 12.3" means nothing to the reader.
      rank: (!p.noEvidence && p.durantRank) ? p.durantRank : undefined,
      gamesLeft: p.gamesRemaining || 0,
      owned: p.percentOwned || 0
    };
  }

  // .slice() so building chat context does not reorder the real roster.
  var myPlayers = (S.myTeam.players || []).slice();
  myPlayers.sort(byDurantRank);

  // Reuse the engine's own filter so chat and the Roster tiles agree about
  // who is addable, rather than chat keeping a separate list of statuses.
  var freeAgents = (S.allPlayers || []).filter(function(p) {
    return p.onTeamId === 0 && Engines.isValidAddCandidate(p);
  });
  freeAgents.sort(byDurantRank);

  var matchupCats = cats.map(function(cat) {
    return {
      cat: cat.abbr,
      my: (S.matchup.myScores || {})[cat.abbr] || 0,
      opp: (S.matchup.oppScores || {})[cat.abbr] || 0,
      winProb: strat.winProb ? strat.winProb[cat.abbr] : undefined
    };
  });

  // Hand over the engine's actual add/drop output so Larry and the Roster
  // tiles cannot contradict each other.
  var engineRecs = [];
  try {
    var recs = Engines.generateRecommendations(S.myTeam.players || [], S.allPlayers || []);
    engineRecs = recs.slice(0, 5).map(function(r) {
      return { action: r.action, improvement: r.improvement || 0 };
    });
  } catch (e) {
    engineRecs = [];
  }

  return {
    leagueName: S.league.name,
    scoringType: S.league.scoringType,
    teamCount: S.league.teamCount,
    categories: cats.map(function(c) { return c.abbr; }),
    teamName: S.myTeam.name,
    record: rec.wins + '-' + rec.losses + '-' + rec.ties,
    matchup: {
      opponent: S.matchup.opponentName,
      daysLeft: (getMatchupDates() || {}).daysLeft || 0,
      categories: matchupCats
    },
    strategy: {
      targets: strat.targets || [],
      locks: strat.locks || [],
      punts: strat.punts || []
    },
    roster: myPlayers.map(playerPayload),
    freeAgents: freeAgents.slice(0, 15).map(playerPayload),
    recommendations: engineRecs
  };
}

async function sendChat(presetMsg) {
  var input = document.getElementById('chat-input');
  var message = presetMsg || (input ? input.value.trim() : '');
  if (!message || _chatSending) return;

  if (input) input.value = '';
  _chatHistory.push({ role: 'user', content: message });
  _chatSending = true;
  _chatError = '';
  // Message list only, so the input keeps focus and the mobile keyboard
  // stays open while Larry is thinking.
  renderChatMessages();

  try {
    var messages = [];
    _chatHistory.forEach(function(msg) {
      messages.push({ role: msg.role, content: msg.content });
    });

    // No `system` field. The function builds the prompt; see the comment at
    // the top of netlify/functions/larry-chat.js.
    var response = await fetch('/.netlify/functions/larry-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: buildChatContext(),
        messages: messages
      })
    });

    if (!response.ok) {
      var detail = '';
      try {
        var errJson = await response.json();
        detail = errJson && errJson.error ? errJson.error : '';
      } catch (parseErr) {
        detail = '';
      }
      throw new Error(detail || ('Chat API error ' + response.status));
    }

    var data = await response.json();
    var reply = data.content || data.reply || 'Sorry, I had trouble processing that. Try again?';

    _chatHistory.push({ role: 'assistant', content: reply });
    _chatError = '';
  } catch (e) {
    console.error('Chat error:', e);
    // Show the error in the UI, do NOT push it into _chatHistory. Error
    // text in the history gets replayed to the model as a real assistant
    // turn on every subsequent message, which both wastes tokens and
    // teaches it that apologising about API keys is a normal reply.
    _chatError = e.message || 'Something went wrong.';
  }

  _chatSending = false;
  renderChatMessages();
}
