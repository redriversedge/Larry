// netlify/shared/app-tools.mjs
//
// The app tools Larry chat and Larry's Move can call. They RUN in the
// browser (js/chat-tools.js), against the same state and engines the
// screens use; the functions only offer them to the model, forward the
// model's calls to the client, and pass the client's answers back. No
// league data lives server-side.
//
// Shared here so both functions offer the same contract. Not under
// netlify/functions, so Netlify does not deploy it as a function.

export const MAX_TOOL_RESULT_CHARS = 12500;
export const CHAT_TOOLS = [
  {
    name: 'get_player',
    description: "One player in full: NBA team, positions, injury status, fantasy owner, Larry rank, expected per-game rates, actual per-game stats for the season and last 30/15/7 days with games played, his games for the rest of this matchup and the next 7 days (dates, opponents, tip times), and games left this season. For a free agent, rest-of-matchup games start on the first day a pickup made now can play.",
    input_schema: { type: 'object', properties: { name: { type: 'string', description: 'Player name, full or partial.' } }, required: ['name'] },
  },
  {
    name: 'get_player_news',
    description: 'Latest ESPN and RotoWire news for one player: injuries, minutes, role changes.',
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'search_free_agents',
    description: "Search this league's free agents (OUT, SUSPENSION and IR excluded unless include_injured). Filter by position, by a day they play, or by usable games left this matchup; sort by Larry rank or by one category. Each result lists Larry rank, expected per-game rates, last-7 per-game, owned %, and the games a pickup made now can use this matchup.",
    input_schema: {
      type: 'object',
      properties: {
        plays_on: { type: 'string', description: "A day: 'today', 'tomorrow', a weekday name like 'Sunday', or YYYY-MM-DD." },
        position: { type: 'string', enum: ['PG', 'SG', 'SF', 'PF', 'C'] },
        sort_by: { type: 'string', description: "'rank' (default) or a category abbreviation such as REB." },
        min_games_this_matchup: { type: 'integer', description: 'Only players with at least this many usable games left this matchup.' },
        include_injured: { type: 'boolean' },
        limit: { type: 'integer', description: 'Up to 25. Default 10.' },
      },
    },
  },
  {
    name: 'get_team',
    description: "Any fantasy team in the league: record, playoff seed, roster with lineup slot, injury, Larry rank, expected per-game rates and games left this matchup, plus the team's per-game category totals and league rank in each category. Use 'me' for the manager's team and 'opponent' for this week's opponent.",
    input_schema: { type: 'object', properties: { team: { type: 'string', description: "'me', 'opponent', or a team name." } }, required: ['team'] },
  },
  {
    name: 'get_matchup',
    description: "A team's current head-to-head matchup: live category totals for both sides, projected final totals, win % per category (the manager's own matchup only), usable games left for each side, and the matchup window. Defaults to the manager's matchup.",
    input_schema: { type: 'object', properties: { team: { type: 'string', description: "Optional: 'me' (default), 'opponent', or a team name." } } },
  },
  {
    name: 'get_day_schedule',
    description: "Who plays on a given day: the manager's players and the opponent's players with opponents, tip times and status, every NBA team in action, and whether a pickup made now can still play that day.",
    input_schema: { type: 'object', properties: { date: { type: 'string', description: "'today', 'tomorrow', a weekday name, or YYYY-MM-DD." } }, required: ['date'] },
  },
  {
    name: 'analyze_trade',
    description: "Run the app's trade analyzer, up to 3 players a side: a verdict (Take it / Lean yes / Toss-up / Lean no / Pass), the reasons, and the manager's per-game category totals and league rank in each category before and after.",
    input_schema: {
      type: 'object',
      properties: {
        give: { type: 'array', items: { type: 'string' }, description: "Players the manager gives, by name." },
        get: { type: 'array', items: { type: 'string' }, description: 'Players the manager gets, by name.' },
      },
      required: ['give', 'get'],
    },
  },
  {
    name: 'get_standings',
    description: 'League standings: every team with seed, record, and league rank in each category.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_league_week',
    description: "Every matchup in the league for a matchup period (default: this one): each side's category totals, the score, and Team of the Week (each matchup winner played against every other winner).",
    input_schema: { type: 'object', properties: { matchup_period: { type: 'integer' } } },
  },
  {
    name: 'get_rankings',
    description: "Larry's player rankings: the top players overall, optionally only free agents or one position, with owner, Larry rank, expected per-game rates and games left this matchup.",
    input_schema: {
      type: 'object',
      properties: {
        available_only: { type: 'boolean' },
        position: { type: 'string', enum: ['PG', 'SG', 'SF', 'PF', 'C'] },
        limit: { type: 'integer', description: 'Up to 25. Default 15.' },
      },
    },
  },
  {
    name: 'get_last_night',
    description: "Box-score highlights for a past night (default last night): the five best all-around lines and the top three in each category, each with their fantasy owner.",
    input_schema: { type: 'object', properties: { date: { type: 'string', description: "'yesterday' (default), a weekday name, or YYYY-MM-DD." } } },
  },
];
export const TOOL_NAMES = CHAT_TOOLS.map((t) => t.name);

// Earlier rounds of THIS question: the model's tool calls (passed back
// exactly, thinking signatures included, as the API requires) and the app's
// answers. Anything else in the shape is dropped. Returns null when the
// shape is unusable.
export function normalizeAppToolTurns(turns, maxRounds, allowedNames) {
  if (turns === undefined || turns === null) return [];
  if (!Array.isArray(turns) || turns.length > maxRounds) return null;
  const out = [];
  for (const turn of turns) {
    if (!turn || typeof turn !== 'object' || !Array.isArray(turn.assistant) || !Array.isArray(turn.results)) return null;
    const blocks = [];
    const ids = [];
    for (const b of turn.assistant.slice(0, 20)) {
      if (!b || typeof b !== 'object') return null;
      if (b.type === 'text' && typeof b.text === 'string') {
        if (b.text) blocks.push({ type: 'text', text: b.text.slice(0, 4000) });
      } else if (b.type === 'thinking' && typeof b.thinking === 'string' && typeof b.signature === 'string') {
        blocks.push({ type: 'thinking', thinking: b.thinking, signature: b.signature });
      } else if (b.type === 'redacted_thinking' && typeof b.data === 'string') {
        blocks.push({ type: 'redacted_thinking', data: b.data });
      } else if (b.type === 'tool_use' && typeof b.id === 'string' && allowedNames.indexOf(b.name) >= 0 &&
          b.input && typeof b.input === 'object' && !Array.isArray(b.input)) {
        blocks.push({ type: 'tool_use', id: b.id.slice(0, 100), name: b.name, input: b.input });
        ids.push(b.id.slice(0, 100));
      } else {
        return null;
      }
    }
    if (!ids.length) return null;
    // Every tool call needs exactly one result, in order.
    const byId = {};
    for (const r of turn.results.slice(0, 20)) {
      if (r && typeof r === 'object' && typeof r.tool_use_id === 'string' && typeof r.content === 'string') {
        byId[r.tool_use_id] = r.content.slice(0, MAX_TOOL_RESULT_CHARS);
      }
    }
    const results = ids.map((id) => ({
      type: 'tool_result',
      tool_use_id: id,
      content: byId[id] !== undefined ? byId[id] : '{"error":"The app did not answer this call."}',
    }));
    out.push({ assistant: blocks, results: results });
  }
  return out;
}

// Caps the total size of the app's answers across every tool round of one
// question, trimming the OLDEST rounds first so the newest lookup (the one
// Larry is about to read) stays whole for as long as possible. Every round's
// assistant blocks are left alone: thinking blocks carry signatures and must
// go back exactly as they came. This is what keeps a five-lookup question
// from sending Claude hundreds of KB of tool output, which used to be the
// single biggest cost per request.
export function trimToolResults(turns, budgetChars) {
  if (!Array.isArray(turns) || !turns.length) return turns;
  let total = 0;
  for (const t of turns) for (const r of t.results) total += r.content.length;
  if (total <= budgetChars) return turns;
  let over = total - budgetChars;
  const note = '...(trimmed to fit)';
  for (const t of turns) {
    for (const r of t.results) {
      if (over <= 0) return turns;
      const keep = Math.max(0, r.content.length - over);
      if (keep >= r.content.length) continue;
      over -= r.content.length - keep;
      r.content = keep > 200 ? r.content.slice(0, keep) + note : '{"note":"Earlier lookup dropped to fit the request."}';
    }
  }
  return turns;
}

