# Larry: Netlify functions, chat and engines

Moved out of CLAUDE.md in November 2026. The rules that must never break are still in CLAUDE.md's Do NOT list; this file holds the detail and the history behind them.

## Netlify functions

- `espn-proxy.js` -- ESPN API CORS proxy
- `larry-chat.mjs` -- Chat. Builds the system prompt **server-side**; the client sends structured context only. Every ESPN-sourced string is sanitized into a delimited `<data>` block labelled untrusted, because team names are written by other managers in the league. Origin allowlist, per-IP rate limit, payload caps.
  - **Functions v2 and streamed, because a buffered answer does not fit in 10 seconds.** Every real question used to die at 9.6s and come back as a 500 saying "Chat is unavailable right now." Measured on the live site: a streamed response delivers all 31 lines of a 30-second probe unbuffered and closes at 29.4s, first byte ~350ms, so the 10s kill applies to buffered responses only. The function caps itself at 25s. See `docs/CHAT_TIMEOUT_SPEC.md`.
  - **`claude-sonnet-5` thinks unless you tell it not to, and thinking shares `max_tokens` with the answer.** Omitting `thinking` runs adaptive thinking at effort `high`, and `display` defaults to `"omitted"`, so the old function spent its 9 seconds on reasoning that came back as empty blocks. It now sends `thinking: {type: 'adaptive', display: 'summarized'}` so the reasoning is visible progress instead of a blank wait, and `MAX_TOKENS` is 4000 so thinking and the answer both fit. Do not drop that to 1500; a question that reasons for a while would have nothing left to answer with.
  - **Frames are newline-delimited JSON**: `{"t":"..."}` answer text, `{"k":"..."}` thinking text, `{"done":true}`, `{"error":"..."}` where `"cut short"` means the cap fired and the partial answer is usable. Answer and thinking are separate keys on purpose: the client renders thinking and throws it away, and must never store it as something Larry said.
  - A timeout is a **504** with "Larry took too long on that one. Tap retry.", not a 500. The status is chosen before the first frame goes out, which is why the function waits for the first event from Claude before committing to a 200.
- `larry-plan.mjs` -- Game Plan. Same trust model, forced `report_plan`, NDJSON `{"plan":...}`, model from `ANTHROPIC_PLAN_MODEL` then `ANTHROPIC_MODEL`.
- `larry-move.mjs` -- Larry's Move. Same trust model, plus a forced `report_move` tool and server-side validation of the result before the client renders it. Streams NDJSON (see below).

Chat reads the model from `process.env.ANTHROPIC_MODEL` (default `claude-sonnet-5`). Larry's Move reads `process.env.ANTHROPIC_MOVE_MODEL`, then `ANTHROPIC_MODEL`, then `claude-sonnet-5`; on a 404 it falls back to `ANTHROPIC_MODEL`. **Both stream** (Functions v2, `.mjs`): Netlify kills a BUFFERED response at 10s, which is what broke Move (8.5 to 9.3s timeouts on the chat model) and chat (9.6s). A streamed response survives past 29s on this site. Move streams `{"p":n}` progress lines and then one `{"move":...}` line, because its card is structured and has nothing useful to show half-written; chat streams text. Both stop themselves at 25s (`ANTHROPIC_STREAM_CAP_MS`). Never pin a model id in code: `claude-sonnet-4-20250514` was hardcoded here and silently 404'd for months after it retired, and `claude-haiku-5-5` was retired under Move in October 2026.


### Limits on the Claude-backed functions

All four (`larry-chat`, `larry-move`, `larry-plan`, `recommend-explain`) refuse browser requests from origins they do not serve (the live site, its `*--larrybball.netlify.app` deploy previews, and localhost are allowed) and apply two caps per caller IP:

- **Per minute**, in memory (`RATE_LIMIT_MAX`): chat 20, Move 10, Plan 6, explain 10. Resets when a container is recycled.
- **Per day**, in Netlify Blobs (`netlify/shared/daily-cap.mjs`): chat 600, Move 120, Plan 30, explain 100 requests, by Central-time day. A chat question costs one request plus one per lookup. Override any cap with `LARRY_DAILY_CAP_<FUNCTION>` (for example `LARRY_DAILY_CAP_LARRY_CHAT=300`) without a deploy. It fails open if Blobs is unreachable; the hard backstop for cost is the monthly spend limit on the Anthropic key.

Chat also caps what one question sends to Claude: the request body at 160 KB, and the app's tool answers across all rounds at 64 KB (`TOOL_RESULTS_BUDGET_CHARS`), trimming the oldest rounds first.

## Analysis engines (js/engines.js)

All engines live in the `Engines` IIFE module.

1. **Z-Scores** -- Per-category z-scores for all players against league averages
2. **Monte Carlo** -- Forward-projected matchup simulation using remaining games
3. **DURANT Ranking (v2)** -- Per-game z vs a starter-quality Q-pool, shrunk and capped. No multipliers. `computeDURANT` delegates to `window.LarryEngine.computeBaseValues`; `ensureDURANT` is the entry point renders should call, which computes once per sync instead of on every tab switch.
3.5. **Availability Score** -- Multiplier based on injury status and games played consistency. Feeds `effectiveDURANT` only, never `durantScore`.
3.6. **Opportunity Boost** -- Multiplier for players on teams with injuries to key players
4. **Recommendations** -- Add/drop and streaming suggestions, matchup-adjusted via strategy weights. Filters injured players (OUT/SUSPENSION/IR). Uses 40% DURANT + 60% matchup fit blend when strategy exists.
5. **Trade Analyzer** -- Evaluate proposed trades by category impact
6. **Punt Analysis** -- Identify optimal punt builds for the roster
7. **Category Volatility** -- Measure stat consistency vs boom/bust tendency
8. **Streak Detection** -- Hot/cold streak identification from recent vs season splits
9. **ROS Projections** -- Rest-of-season projected totals
10. **Risers and Fallers** -- Trending players based on recent production changes
11. **Trade Finder** -- Auto-find mutually beneficial trades with other teams
12. **Matchup Strategy** -- Weekly strategy: classifies categories as Lock/Target/Punt using projected margin as percentage of total production. Drives recommendation weighting.

**matchupAdjustedValue()** -- Helper that scores a player's z-scores weighted by the current strategy's category weights (targets 2x, locks 0.5x, punts 0.3x). Used by Engine 4 to rank pickups and streaming options.


## Larry Chat (js/chat.js)

Chat context sent to Claude includes:
- Current matchup scores and record
- Matchup strategy (Lock/Target/Punt categories)
- Full roster with z-scores, DURANT scores, injury status, and slot
- Top 10 free agents (filtered: excludes OUT/SUSPENSION/IR players)

The chat is strategy-aware. It references target categories when discussing pickups and trades.

**Chat can ask the app** (`js/chat-tools.js`, schemas in `CHAT_TOOLS` in `larry-chat.mjs`). The snapshot above is a summary; for anything else the model calls a tool (get_player, get_player_news, search_free_agents, get_team, get_matchup, get_day_schedule, analyze_trade, get_standings, get_league_week, get_rankings, get_last_night). The function streams `{"u":name}` when a call starts and `{"tools":[...],"assistant":[...]}` instead of `{"done":true}` when the model stops to use one. The CLIENT runs the calls against `S` and the engines and re-posts with `toolTurns` (the assistant blocks verbatim, thinking signatures included, plus `{tool_use_id, content}` results). Up to 5 tool rounds; the last forces `tool_choice: none`. The function holds no league data and validates every tool turn (known tool names only, one result per call). Tool rounds never enter `_chatHistory`; only the final text does. Tools reuse the app's own functions (`tradeAnalysisData`, `projectRestOfMatchup`, `computeTeamOfWeek`, `Reports`), so chat and the screens cannot disagree. A new screen worth asking about should get a tool here too. Schemas and turn validation are in `netlify/shared/app-tools.mjs` (outside `netlify/functions` so it is not deployed as a function). **Larry's Move uses the same tools** (a subset: get_player, get_player_news, search_free_agents, get_team, get_matchup, get_day_schedule), up to 3 rounds with `tool_choice: any`, then `report_move` is forced; the client loop is `postLarryMoveRounds` in `js/larry-move.js`, and the loading card shows what it is checking.

The reply **streams**. `runChatRequest()` reads newline-delimited JSON frames (see `larry-chat.mjs` above) and patches two elements inside the live bubble, never the input, per the mobile-keyboard rule. Rules that have each broken once and are invisible when they break:
- **Nothing enters `_chatHistory` until the stream finishes.** A cut-short answer goes in with a plain-text "(answer was cut short)" note.
- **Error text never enters `_chatHistory`**, or every later request replays "Chat is unavailable right now." to the model as a real assistant turn and teaches it that apologising is a normal answer.
- **Thinking text never enters `_chatHistory` either.** It is the model's own reasoning, shown dimmed as progress and discarded when the answer starts.
- Any retryable failure (504, 502, 500, 429, or a cut-short) shows a **Retry** button. Retry resends the question already at the end of the history; it must not push the user turn again.
Pinned by `tests/functions/chatClient.test.ts` and `tests/functions/larryChatStream.test.ts`.
