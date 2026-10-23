# Larry chat: stop timing out

Written 2026-10-23. The owner asked "If Demin, Green and Watson turn out to be busts, who should I pick up or package and try to trade for?" and got "Chat is unavailable right now."

## 1. What is wrong (measured)

Netlify request logs for `/.netlify/functions/larry-chat`, Oct 22 to 23: both requests returned **500 after 9.6 and 9.7 seconds**. Neither got an answer.

**Cause.** `larry-chat.js` asks the chat model (`ANTHROPIC_MODEL`, default `claude-sonnet-5`) for up to `MAX_TOKENS = 2048` in a single non-streamed call, aborts its own request at 9s (`req.setTimeout(9000)`), and Netlify kills the function at 10s.
- **Questions that need a real answer don't fit.** A trade or pickup question gets a long, reasoned reply, and generating it takes longer than 9 seconds.
- **The timeout is invisible to the user.** The abort error has no `statusCode`, so the catch block returns a **500** and the generic "Chat is unavailable right now." The user cannot tell a timeout from an outage, and the client has no reason to retry.

This is the same failure Larry's Move had on Oct 21 (every request timed out at 8.5 to 9.3s). Move was fixed by moving to a faster model with a smaller answer. Chat should not take that route: chat is where answer quality matters most, and its answers are legitimately long.

## 2. The fix: stream the answer

Stream Claude's reply through the function to the client, so text starts appearing within a couple of seconds and the answer is no longer bound by a 10-second buffered response.

### 2a. First, prove the platform allows it (do this before anything else)

Netlify's documentation is inconsistent about time limits for streamed responses, and the site's own experience (10s kills, on the Pro plan) is the only reliable data. So measure it:
1. Add a throwaway function, `netlify/functions/stream-probe.mjs`, in the Functions v2 format (`export default async (req) => new Response(readableStream, ...)`). It writes one line per second for 30 seconds, then closes.
2. Deploy it, then call it from the browser on the live site and record how many lines arrive and when the stream ends.
3. **Delete the probe** in the same PR once measured. Record the result (lines received, seconds elapsed) in this file under a "Measured" heading.

**Decision rule:**
- **Stream survives past 25 seconds:** build 2b (streaming).
- **Stream is cut at about 10 seconds:** build 2c (background job) instead.

### 2b. Streaming build (preferred)
- **Convert `larry-chat.js` to a Functions v2 handler.** Keep every safeguard exactly as it is: origin allowlist, per-IP rate limit, body and message caps, the server-built system prompt, and the sanitized, delimited `<data>` block. Only the transport changes.
- **Call the Messages API with `stream: true`.** Forward text deltas to the client as they arrive. A simple newline-delimited JSON stream is fine: `{"t":"text"}` per delta, then `{"done":true}`, or `{"error":"..."}` on failure.
- **Use Node 22's built-in `fetch` and web streams.** No new runtime dependencies (package.json stays devDeps-only).
- **Raise `MAX_TOKENS` to 1500 and drop the 9s abort.** Replace the abort with an overall cap of 25 seconds; if the cap is hit, send whatever has arrived plus an `{"error":"cut short"}` line, so the user gets a partial answer instead of nothing.
- **Client (`js/chat.js`):**
  - Read the stream with `response.body.getReader()` and render the assistant bubble as text arrives (re-render the bubble only, never the input, per the mobile keyboard rule).
  - Push the reply into `_chatHistory` only when the stream finishes. A cut-short answer is pushed with a short "(answer was cut short)" note.
  - Keep the rule that error text is never pushed into history.

### 2c. Background build (only if 2a shows streams are cut at 10s)
- Split into `larry-chat.js` (validates, builds the prompt, starts the job, returns `202 {jobId}`) and `larry-chat-background.js` (calls Claude, stores the result).
- Store the result in Netlify Blobs, keyed by jobId, deleted after first read or after 10 minutes. This needs `@netlify/blobs`; that is the one allowed exception to "no runtime deps", and the exception must be noted in CLAUDE.md.
- The client polls `larry-chat.js?job=<id>` every 1.5s for up to 60s, showing the typing indicator.

### 2d. Either way
- **Make the timeout visible.** Return **504** with "Larry took too long on that one. Tap retry." for a timeout, and keep the generic message only for real upstream failures. Show a **Retry** button on any chat error that resends the last user message.
- **Log the cause in the function** (timeout vs. upstream status), without the request body.
- **Do not change the model.** It stays `ANTHROPIC_MODEL`.

## 3. Acceptance

1. **The owner's question works.** On the live site, the exact question in the header, asked three times, completes every time, with the first text visible in under 4 seconds (2b) or the full answer in under 30 seconds (2c).
2. **Netlify logs are clean.** No `larry-chat` request ends at 9 to 10 seconds with a 500 during that test.
3. **Every security test still passes.** All existing `larry-chat` tests (origin, rate limit, payload caps, sanitization, prompt built server-side, client `system` ignored) still pass. Add tests for:
   - stream framing: deltas, done and error lines;
   - the partial-answer path when the cap is hit;
   - 504 on timeout;
   - error text never entering `_chatHistory`.
4. **No regressions.** `node --check js/*.js`, `npm test` and `npx tsc --noEmit` pass, ASCII only, `CACHE_VERSION` bumped, shipped through `dev` to `main`.
5. **Report what was measured.** Report which path was built (2b or 2c) and the probe numbers that decided it.
