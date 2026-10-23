// ============================================================
// LARRY v3.0 -- CHAT MODULE
// AI chat with Larry the basketball owl
// ============================================================

var _chatHistory = [];
var _chatSending = false;
var _chatError = '';
// The answer being streamed right now: { think: '', text: '' }, or null.
// Nothing here is in _chatHistory yet; it lands there when the stream ends.
var _chatStream = null;
// Whether the current error is worth a Retry button. A timeout is; a 400 is
// not, because the same request will fail the same way.
var _chatCanRetry = false;

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

  // The live bubble. Built once per request; the deltas patch the two spans
  // inside it rather than re-rendering the list, so the message area does
  // not flicker and the input is never touched (mobile keyboard rule).
  if (_chatSending) {
    html += '<div class="chat-bubble assistant"><div class="chat-avatar">' + getLarryAvatar(16) + ' Larry</div>';
    html += '<div id="chat-stream-think" class="chat-thinking">' + chatThinkingHtml() + '</div>';
    html += '<div id="chat-stream-text">' + chatStreamTextHtml() + '</div>';
    html += '</div>';
  }

  // Errors render here rather than being pushed into _chatHistory, so they
  // are never replayed to the model as if Larry had said them.
  if (_chatError) {
    html += '<div class="chat-bubble assistant" role="alert" style="border-left:3px solid var(--accent-red,#ef4444)">';
    html += '<div class="chat-avatar">' + getLarryAvatar(16) + ' Larry</div>';
    html += esc(_chatError);
    html += '<div style="margin-top:8px">';
    if (_chatCanRetry) {
      html += '<button class="btn btn-sm" style="min-height:44px;margin-right:8px" ' +
        'onclick="retryChat()">Retry</button>';
    }
    html += '<button class="btn btn-sm btn-secondary" ' +
      'style="min-height:44px" onclick="dismissChatError()">Dismiss</button>';
    html += '</div></div>';
  }

  return html;
}

// Thinking text is progress, not an answer. It is shown while the request
// is open, replaced by the answer, and never stored: pushing it into
// _chatHistory would replay the model's own reasoning back to it as
// something Larry had said out loud.
function chatThinkingHtml() {
  if (!_chatStream || !_chatStream.think) {
    return '<div class="typing-dots"><span>.</span><span>.</span><span>.</span></div>';
  }
  return '<span class="muted text-xs">' + esc(_chatStream.think) + '</span>';
}

function chatStreamTextHtml() {
  if (!_chatStream || !_chatStream.text) return '';
  return formatChatMessage(_chatStream.text);
}

// Patch the live bubble in place. getElementById rather than a re-render so
// the input element is never replaced mid-answer.
function paintChatStream() {
  var think = document.getElementById('chat-stream-think');
  var text = document.getElementById('chat-stream-text');
  if (!think || !text) { renderChatMessages(); return; }
  // Once the answer starts, the reasoning has served its purpose.
  think.innerHTML = (_chatStream && _chatStream.text) ? '' : chatThinkingHtml();
  text.innerHTML = chatStreamTextHtml();
  scrollChatToBottom();
}

function dismissChatError() {
  _chatError = '';
  _chatCanRetry = false;
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
  await runChatRequest();
}

// Resend the question already sitting at the end of _chatHistory. The user
// turn is a real turn and stays put; only the failed answer is retried, so
// a retry must not push the question again.
async function retryChat() {
  if (_chatSending) return;
  var last = _chatHistory.length ? _chatHistory[_chatHistory.length - 1] : null;
  if (!last || last.role !== 'user') return;
  await runChatRequest();
}

async function runChatRequest() {
  _chatSending = true;
  _chatError = '';
  _chatCanRetry = false;
  _chatStream = { think: '', text: '' };
  // Message list only, so the input keeps focus and the mobile keyboard
  // stays open while Larry is thinking.
  renderChatMessages();

  var cutShort = false;

  try {
    var messages = [];
    _chatHistory.forEach(function(msg) {
      messages.push({ role: msg.role, content: msg.content });
    });

    // No `system` field. The function builds the prompt; see the comment at
    // the top of netlify/functions/larry-chat.mjs.
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
      // 504 is a timeout and 502/429 are upstream hiccups: all three are
      // worth another go. A 4xx from our own validation is not.
      _chatCanRetry = response.status === 504 || response.status === 502 ||
        response.status === 500 || response.status === 429;
      throw new Error(detail || ('Chat API error ' + response.status));
    }

    // Newline-delimited JSON, one frame per line. See the framing comment in
    // netlify/functions/larry-chat.mjs.
    if (!response.body || typeof response.body.getReader !== 'function') {
      throw new Error('This browser cannot stream the reply. Try reloading.');
    }
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var streamError = '';

    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var nl = buffer.indexOf('\n');
      while (nl >= 0) {
        var line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          var evt = null;
          try { evt = JSON.parse(line); } catch (badLine) { evt = null; }
          if (evt) {
            if (typeof evt.t === 'string') {
              _chatStream.text += evt.t;
              paintChatStream();
            } else if (typeof evt.k === 'string') {
              _chatStream.think += evt.k;
              paintChatStream();
            } else if (evt.error === 'cut short') {
              cutShort = true;
            } else if (typeof evt.error === 'string') {
              streamError = evt.error;
            }
          }
        }
        nl = buffer.indexOf('\n');
      }
    }

    if (streamError) {
      _chatCanRetry = true;
      throw new Error(streamError);
    }

    var reply = _chatStream.text;
    if (cutShort) {
      // A partial answer is worth keeping; the note tells the reader why it
      // stops where it does, and tells the model the same thing if they
      // carry on asking questions.
      _chatCanRetry = true;
      // Plain text, not markdown: formatChatMessage only renders ** and
      // newlines, so underscores would show up as underscores.
      reply = reply ? reply + '\n\n(answer was cut short)' : '';
      if (!reply) {
        throw new Error('Larry took too long on that one. Tap retry.');
      }
    }
    if (!reply) {
      _chatCanRetry = true;
      throw new Error('Larry did not manage an answer. Tap retry.');
    }

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

  _chatStream = null;
  _chatSending = false;
  renderChatMessages();
}
