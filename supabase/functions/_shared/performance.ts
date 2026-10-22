// Metadata only: never include prompts, tokens, user reports, or provider bodies.
export function requestTiming(service: string) {
  const requestId = crypto.randomUUID();
  const started = performance.now();
  const emit = (stage: string, ms: number, outcome: string) =>
    console.log(JSON.stringify({
      service,
      event: "request_timing",
      request_id: requestId,
      stage,
      duration_ms: Math.round(ms),
      outcome,
    }));
  return {
    requestId,
    async measure<T>(stage: string, work: () => PromiseLike<T>): Promise<T> {
      const start = performance.now();
      try {
        const value = await work();
        emit(stage, performance.now() - start, "ok");
        return value;
      } catch (error) {
        emit(stage, performance.now() - start, "error");
        throw error;
      }
    },
    finish(outcome: string) {
      emit("response_ready", performance.now() - started, outcome);
    },
  };
}

export type RequestTiming = ReturnType<typeof requestTiming>;

export function timedDatabaseFetch(timing: RequestTiming): typeof fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const table = url.pathname.startsWith("/rest/v1/") ? url.pathname.slice("/rest/v1/".length) : "api";
    return timing.measure(
      `db.${init?.method ?? "GET"}.${table}`,
      () =>
        fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(5000)])
            : AbortSignal.timeout(5000),
        }),
    );
  };
}

export function backgroundTask(task: Promise<unknown>): void {
  const handled = task.catch(() => console.warn("Background task failed"));
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(task: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime) runtime.waitUntil(handled);
  else void handled;
}
