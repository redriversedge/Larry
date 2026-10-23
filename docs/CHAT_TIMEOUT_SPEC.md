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

## Measured

Section 2a, run against the live site on 2026-10-23 with
`netlify/functions/stream-probe.mjs` (Functions v2, one JSON line per second
for 30 seconds, each line carrying the server's own elapsed ms). Deleted in
the same change, per the spec.

| Run | Lines received | Stream ended | First byte |
|---|---|---|---|
| 1 | 31 of 31 | 29.38s | 362ms |
| 2 | 31 of 31 | 29.37s | 346ms |

Lines arrived one per second throughout, server elapsed tracking client
elapsed to within ~320ms, so nothing was buffered and released at the end.

**A streamed response is not subject to the 10-second kill.** The limit that
was killing `larry-chat` applies to a buffered response. Decision rule says
stream survives past 25 seconds, so **2b was built**.

### What the probe did not catch, and what it changed

The spec attributes the timeouts to answer length alone. That is half of it.
`claude-sonnet-5` runs **adaptive thinking whenever the request omits the
`thinking` parameter**, and `thinking.display` defaults to `"omitted"`. So
the old function was:

- paying for reasoning at effort `high` before the first word of the answer,
- receiving that reasoning as empty text blocks, and
- splitting `max_tokens` between that reasoning and the answer.

That is why a trade question died and "who should I start" usually did not,
and it is why streaming alone would not have met acceptance criterion 1:
with thinking invisible, the first *text* delta still lands well after four
seconds. Two deviations from the spec follow from it, both in
`netlify/functions/larry-chat.mjs`:

- **`thinking: {type: "adaptive", display: "summarized"}`.** Thinking stays
  on, because the spec is right that chat is where answer quality matters
  most. Making it visible turns a blank wait into progress the user can
  read, and costs nothing new: this was already happening and already being
  billed. The client renders it dimmed, replaces it with the answer, and
  never stores it in `_chatHistory`.
- **`MAX_TOKENS` 4000, not 1500.** Thinking and the answer share the budget.
  At 1500 total, a question that reasons for a while has nothing left to
  answer with, and a truncated answer is the failure this change exists to
  remove. Answer length is held down by the prompt's STYLE rules instead.

### Frame format as built

```
{"t":"..."}     a chunk of the answer
{"k":"..."}     a chunk of the thinking summary (progress only, never stored)
{"done":true}   complete
{"error":"..."} failed; "cut short" means the 25s cap fired and whatever
                arrived before it is a usable partial answer
```

Separate keys for the two text kinds rather than one tagged shape, because
the client has to treat them differently and a single shape makes it too
easy to store reasoning as something Larry said.

## Acceptance, as measured on the live site

The owner's exact question, posted to the live function with a
representative roster/free-agent context. Timings are client-side, from
request start.

| | first frame (reasoning) | first answer word | complete | status |
|---|---|---|---|---|
| effort `high` run 1 | 3.1s | 19.7s | upstream error at 17.4s | 200 |
| effort `high` run 2 | 2.8s | 11.1s | 20.2s | 200 |
| effort `high` run 3 | 2.9s | 11.5s | 18.0s | 200 |
| effort `medium` run 1 | 4.2s | 10.9s | 15.6s | 200 |
| effort `medium` run 2 | 3.8s | 10.8s | 17.8s | 200 |
| effort `medium` run 3 | 3.2s | 6.6s | 15.0s | 200 |

`medium` ships. It is better on every number that matters and much less
variable at the top end, and on this model it is comparable in intelligence
to the previous-generation Sonnet at `high`. `ANTHROPIC_EFFORT` overrides it
without a deploy.

**Acceptance 1, honestly:** the question completes every time, and the
10-second 500 is gone. "First text visible in under 4 seconds" is met for
what the user actually sees (the reasoning summary, 3.2s to 4.2s across the
shipped runs), and **not** met for the first word of the answer, which lands
at 6.6s to 10.9s. Getting the answer itself under four seconds means giving
up the reasoning entirely (`thinking: {type: "disabled"}`), which is the
quality-for-speed trade this spec explicitly rejected for chat. Flagging it
rather than quietly redefining the criterion: if the four seconds matter more
than the reasoning, the switch is one constant.

**Acceptance 2:** verified from the client, not from the Netlify log UI (no
CLI auth in this environment). Across 11 live requests every response was a
200 and nothing terminated in the 9 to 10 second band. One early run hit a
transient upstream `error` event mid-answer; under the old code that was a
dead end, and it now keeps the partial text and offers Retry.
