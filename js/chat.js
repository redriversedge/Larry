// ============================================================
// LARRY v3.0 -- CHAT MODULE
// AI chat with Larry the basketball owl
// ============================================================

var _chatHistory = [];
var _chatSending = false;

function renderChat(container) {
  var html = '<div class="chat-container">';

  // Header
  html += '<div class="chat-header">';
  html += '<div class="larry-chat-avatar small">' + getLarryAvatar(20) + '</div>';
  html += '<div class="chat-title">Larry AI</div>';
  html += '<button class="btn btn-sm" onclick="_chatHistory=[];render()" title="Clear chat">\u{1F5D1}</button>';
  html += '</div>';

  // Messages
  html += '<div class="chat-messages" id="chat-messages">';

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

  html += '</div>';

  // Input area
  html += '<div class="chat-input-area">';
  html += '<input type="text" class="chat-input" id="chat-input" placeholder="Ask Larry..." ';
  html += 'onkeydown="if(event.key===\'Enter\')sendChat()">';
  html += '<button class="chat-send-btn" onclick="sendChat()" ' + (_chatSending ? 'disabled' : '') + '>\u{27A4}</button>';
  html += '</div>';

  html += '</div>';
  container.innerHTML = html;

  // Scroll to bottom
  var msgs = document.getElementById('chat-messages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

function formatChatMessage(text) {
  if (!text) return '';
  // Basic markdown-like formatting
  return esc(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function buildChatContext() {
  var cats = getOrderedCategories();
  var context = 'LEAGUE: ' + S.league.name + ' (' + S.league.scoringType + ', ' + S.league.teamCount + ' teams)\n';
  context += 'CATEGORIES: ' + cats.map(function(c){return c.abbr;}).join(', ') + '\n';

  // My team
  var rec = S.myTeam.record || {wins:0,losses:0,ties:0};
  context += 'MY TEAM: ' + S.myTeam.name + ' (' + rec.wins + '-' + rec.losses + '-' + rec.ties + ')\n';

  // Matchup
  var mr = S.matchup.myRecord || {wins:0,losses:0,ties:0};
  context += 'MATCHUP: vs ' + S.matchup.opponentName + ' (' + mr.wins + '-' + mr.losses + '-' + mr.ties + ')\n';

  // Category ranks
  if (cats.length && S.teams.length) {
    context += 'MY CAT RANKS: ';
    cats.forEach(function(cat) {
      context += cat.abbr + ' #' + Engines.getTeamCatRank(cat.abbr) + ', ';
    });
    context += '\n';
  }

  // Roster with z-scores
  var myPlayers = S.myTeam.players || [];
  if (myPlayers.length) {
    context += 'ROSTER:\n';
    myPlayers.sort(function(a,b) { return (b.durantScore||0) - (a.durantScore||0); });
    myPlayers.forEach(function(p) {
      context += '  ' + p.name + ' (' + p.positions.join('/') + ', ' + p.nbaTeam + ', DURANT: ' + fmt(p.durantScore||0,1) + ', Z: ' + fmt(p.zScores?p.zScores.total:0,2) + ', Slot: ' + p.slot + ')\n';
    });
  }

  // Top free agents
  var freeAgents = (S.allPlayers || []).filter(function(p) { return p.onTeamId === 0; });
  freeAgents.sort(function(a,b) { return (b.durantScore||0) - (a.durantScore||0); });
  if (freeAgents.length) {
    context += 'TOP FREE AGENTS:\n';
    freeAgents.slice(0, 10).forEach(function(p) {
      context += '  ' + p.name + ' (' + p.positions.join('/') + ', ' + p.nbaTeam + ', DURANT: ' + fmt(p.durantScore||0,1) + ', Own: ' + fmt(p.ownership,0) + '%)\n';
    });
  }

  return context;
}

async function sendChat(presetMsg) {
  var input = document.getElementById('chat-input');
  var message = presetMsg || (input ? input.value.trim() : '');
  if (!message || _chatSending) return;

  if (input) input.value = '';
  _chatHistory.push({ role: 'user', content: message });
  _chatSending = true;
  render();

  try {
    var context = buildChatContext();
    var systemPrompt = 'You are Larry, an expert fantasy basketball analyst owl. You are helping a manager in a ' + S.league.scoringType + ' league with ' + S.league.teamCount + ' teams. Be specific, data-driven, and actionable. Reference actual player names, stats, and z-scores from the context. Keep responses concise but thorough. Use ** for emphasis on key points.\n\nCURRENT DATA:\n' + context;

    var messages = [];
    _chatHistory.forEach(function(msg) {
      messages.push({ role: msg.role, content: msg.content });
    });

    var response = await fetch('/.netlify/functions/larry-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: systemPrompt,
        messages: messages
      })
    });

    if (!response.ok) {
      var errBody = await response.text();
      throw new Error('Chat API error ' + response.status + ': ' + errBody);
    }

    var data = await response.json();
    var reply = data.content || data.reply || 'Sorry, I had trouble processing that. Try again?';

    _chatHistory.push({ role: 'assistant', content: reply });
  } catch(e) {
    console.error('Chat error:', e);
    _chatHistory.push({
      role: 'assistant',
      content: 'Sorry, I hit an error: ' + e.message + '. Make sure the ANTHROPIC_API_KEY is set in your Netlify environment variables.'
    });
  }

  _chatSending = false;
  render();
}
