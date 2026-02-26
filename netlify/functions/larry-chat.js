// netlify/functions/larry-chat.js
// Proxies requests to Anthropic Claude API
// API key stays server-side, never exposed to client

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

    // API key from environment variable (set in Netlify dashboard)
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured. Add it in Netlify site settings > Environment variables.' })
      };
    }

    // Build Larry's system prompt
    const systemPrompt = buildSystemPrompt(context || {});

    const payload = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: messages.slice(-20) // Last 20 messages for context window management
    });

    const data = await callClaude(apiKey, payload);
    const parsed = JSON.parse(data);

    // Extract text content
    let responseText = '';
    if (parsed.content) {
      parsed.content.forEach(function(block) {
        if (block.type === 'text') responseText += block.text;
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ response: responseText })
    };

  } catch (error) {
    console.error('Larry chat error:', error.message);
    return {
      statusCode: error.statusCode || 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

function buildSystemPrompt(ctx) {
  let prompt = `You are Larry, an AI fantasy basketball analyst. You are named after the Larry O'Brien Championship Trophy.

PERSONA: You're a PhD statistician specializing in sports analytics who breaks down statistical concepts in simple terms that basketball players understand. You also coached college basketball for 20 years, so you get into the nitty-gritty of basketball strategy, player tendencies, matchup dynamics, and the real-world context behind the numbers. Think Josh Lloyd's honesty and directness — you give real opinions with real reasoning, not hedge-everything wishy-washy advice.

RULES:
- Give clear, opinionated recommendations backed by specific numbers
- Reference the user's actual data, not generic advice
- Explain statistical concepts simply when they come up
- Factor in game schedule, matchup context, recent trends, and category needs proportionally — the way a real statistician would weight inputs in a model
- When making start/sit, trade, or add/drop recommendations, always explain WHY with specific numbers
- Be direct and honest. If a player is bad, say so. If a trade is lopsided, say so.
- Keep responses focused and actionable. No filler.`;

  // Inject league context
  if (ctx.leagueName) {
    prompt += `\n\nLEAGUE: ${ctx.leagueName}`;
    prompt += `\nFORMAT: ${ctx.scoringType || 'H2H Categories'}`;
    prompt += `\nCATEGORIES: ${(ctx.categories || []).join(', ')}`;
    prompt += `\nTEAMS: ${ctx.teamCount || 0}`;
  }

  // User's team
  if (ctx.teamName) {
    prompt += `\n\nUSER'S TEAM: ${ctx.teamName}`;
    prompt += `\nRECORD: ${ctx.record || ''}`;
    if (ctx.standing) prompt += `\nSTANDING: ${ctx.standing}`;
  }

  // Current matchup
  if (ctx.matchup) {
    prompt += `\n\nCURRENT MATCHUP vs ${ctx.matchup.opponent}:`;
    prompt += `\nScore: ${ctx.matchup.record || ''}`;
    if (ctx.matchup.categories) {
      prompt += '\nCategory breakdown:';
      ctx.matchup.categories.forEach(function(c) {
        prompt += `\n  ${c.cat}: ${c.my} vs ${c.opp} (${c.status})`;
      });
    }
    if (ctx.matchup.daysRemaining) prompt += `\nDays remaining: ${ctx.matchup.daysRemaining}`;
  }

  // Roster
  if (ctx.roster && ctx.roster.length > 0) {
    prompt += '\n\nROSTER:';
    ctx.roster.forEach(function(p) {
      prompt += `\n  ${p.name} (${p.pos}, ${p.team}, ${p.slot}) — ${p.status}`;
      if (p.stats) prompt += ` | Season: ${p.stats}`;
      if (p.gamesRemaining !== undefined) prompt += ` | Games remaining this matchup: ${p.gamesRemaining}`;
    });
  }

  // Injury report
  if (ctx.injuries && ctx.injuries.length > 0) {
    prompt += '\n\nINJURIES:';
    ctx.injuries.forEach(function(inj) {
      prompt += `\n  ${inj.name}: ${inj.status}`;
    });
  }

  return prompt;
}

function callClaude(apiKey, payload) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
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
          const err = new Error(`Claude API returned ${res.statusCode}: ${body.substring(0, 200)}`);
          err.statusCode = res.statusCode;
          reject(err);
        } else {
          resolve(body);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Claude API request timed out'));
    });
    req.write(payload);
    req.end();
  });
}
