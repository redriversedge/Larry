// netlify/functions/larry-chat.js
// Proxies requests to Anthropic Claude API
const https = require('https');

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { messages, context } = body;

    if (!messages || !Array.isArray(messages)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Messages array required' }) };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured. Add it in Netlify site settings > Environment variables.' }) };
    }

    const systemPrompt = buildSystemPrompt(context || {});

    const payload = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: messages.slice(-20)
    });

    const data = await callClaude(apiKey, payload);
    const parsed = JSON.parse(data);

    let responseText = '';
    if (parsed.content) {
      parsed.content.forEach(function(block) {
        if (block.type === 'text') responseText += block.text;
      });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ response: responseText }) };

  } catch (error) {
    console.error('Larry chat error:', error.message);
    return { statusCode: error.statusCode || 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};

function buildSystemPrompt(ctx) {
  let prompt = `You are Larry, an AI fantasy basketball analyst named after the Larry O'Brien Championship Trophy.

PERSONA: PhD statistician + 20-year college basketball coach + 15-time fantasy champion. Think Josh Lloyd's honesty and directness. Give real opinions with specific numbers, not hedge-everything advice. Be concise and actionable.

RULES:
- Always explain WHY with specific numbers
- Reference z-scores, DURANT rankings, and category impact
- Consider games remaining and schedule when making recommendations
- For start/sit: factor in opponent, back-to-backs, rest days
- For trades: analyze category impact both ways
- For pickups: match to team needs, not just overall value`;

  if (ctx.leagueName) {
    prompt += '\n\nLEAGUE: ' + ctx.leagueName + ' (' + (ctx.scoringType || 'H2H') + ', ' + (ctx.teamCount || '?') + ' teams)';
    prompt += '\nCategories: ' + (ctx.categories || []).join(', ');
  }

  if (ctx.teamName) {
    prompt += '\n\nUSER TEAM: ' + ctx.teamName;
    prompt += '\nRecord: ' + (ctx.record || '?');
    if (ctx.standing) prompt += ' | Standing: ' + ctx.standing;
  }

  if (ctx.categoryRanks) {
    prompt += '\nCategory League Ranks: ';
    Object.keys(ctx.categoryRanks).forEach(function(cat) {
      prompt += cat + '=#' + ctx.categoryRanks[cat] + ' ';
    });
  }

  if (ctx.matchup) {
    prompt += '\n\nCURRENT MATCHUP vs ' + (ctx.matchup.opponent || '?');
    prompt += ' | Score: ' + (ctx.matchup.record || '?') + ' | Days left: ' + (ctx.matchup.daysRemaining || '?');
    if (ctx.matchup.categories) {
      ctx.matchup.categories.forEach(function(c) {
        prompt += '\n  ' + c.cat + ': ' + c.my + ' vs ' + c.opp + ' (' + c.status + ')';
      });
    }
  }

  if (ctx.roster && ctx.roster.length) {
    prompt += '\n\nROSTER:';
    ctx.roster.forEach(function(p) {
      prompt += '\n  ' + p.name + ' (' + p.pos + ', ' + p.team + ') ' + p.slot;
      if (p.stats) prompt += ' | ' + p.stats;
      if (p.zScore) prompt += ' | z:' + p.zScore;
    });
  }

  if (ctx.topFreeAgents && ctx.topFreeAgents.length) {
    prompt += '\n\nTOP FREE AGENTS:';
    ctx.topFreeAgents.forEach(function(p) {
      prompt += '\n  ' + p.name + ' (' + p.pos + ', ' + p.team + ') z:' + p.zScore + ' own:' + p.owned + '%';
    });
  }

  return prompt;
}

function callClaude(apiKey, payload) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.anthropic.com', port: 443,
      path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          const err = new Error('Claude API returned ' + res.statusCode + ': ' + body.substring(0, 200));
          err.statusCode = res.statusCode;
          reject(err);
        } else { resolve(body); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Claude API timed out')); });
    req.write(payload);
    req.end();
  });
}
