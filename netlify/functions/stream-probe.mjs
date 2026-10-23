// THROWAWAY. Delete this file once the measurement is recorded in
// docs/CHAT_TIMEOUT_SPEC.md under "Measured".
//
// Netlify's documentation is inconsistent about how long a STREAMED response
// may run. This site's own experience is the only reliable data: every
// buffered larry-chat request died at 9.6 to 9.7 seconds. So before building
// anything on top of streaming, find out whether a stream survives past that.
//
// Functions v2 (export default + Response), which is the format the real fix
// would use. Writes one JSON line per second for 30 seconds, each carrying
// the elapsed milliseconds as the server saw them, then closes. Call it and
// count the lines:
//
//   curl -N --no-buffer https://larrybball.netlify.app/.netlify/functions/stream-probe

const TOTAL_LINES = 30;
const INTERVAL_MS = 1000;

export default async () => {
  const encoder = new TextEncoder();
  const start = Date.now();

  const body = new ReadableStream({
    async start(controller) {
      try {
        for (let i = 1; i <= TOTAL_LINES; i++) {
          controller.enqueue(
            encoder.encode(JSON.stringify({ line: i, ms: Date.now() - start }) + '\n'),
          );
          if (i < TOTAL_LINES) {
            await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
          }
        }
        controller.enqueue(
          encoder.encode(JSON.stringify({ done: true, ms: Date.now() - start }) + '\n'),
        );
      } catch (e) {
        controller.enqueue(encoder.encode(JSON.stringify({ error: String(e) }) + '\n'));
      }
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      // Ask any intermediate proxy not to buffer. If the platform buffers the
      // whole response anyway, the line timings will all arrive at once and
      // that is itself the answer.
      'X-Accel-Buffering': 'no',
    },
  });
};
