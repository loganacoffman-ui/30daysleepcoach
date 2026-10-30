// Leave time for fallback, message persistence, and usage writes before the
// Edge worker's wall-clock limit. Headers and body share the same abort signal.
export const COACH_HEADERS_TIMEOUT_MS = 20_000;
export const COACH_STREAM_TIMEOUT_MS = 60_000;

export function coachStreamDeadline() {
  const controller = new AbortController();
  const timeout = () => controller.abort(new DOMException(
    'Your coach took too long to respond. Please try again.', 'TimeoutError',
  ));
  const headersTimer = setTimeout(timeout, COACH_HEADERS_TIMEOUT_MS);
  const streamTimer = setTimeout(timeout, COACH_STREAM_TIMEOUT_MS);
  return {
    signal: controller.signal,
    headersReceived: () => clearTimeout(headersTimer),
    dispose() {
      clearTimeout(headersTimer);
      clearTimeout(streamTimer);
    },
    cancel() {
      this.dispose();
      controller.abort();
    },
  };
}
