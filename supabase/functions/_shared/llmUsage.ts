// Meter actual Messages API attempts, independently of application parsing/caching.
// Never pass a user-supplied user ID or a JWT-scoped database writer here.
export type UsageBucket = "chat" | "daily_checkin" | "sleep_profile" | "greeting";
type JsonObject = Record<string, unknown>;
export type UsageRow = JsonObject & { id: string; user_id: string };

export function usageFeature(mode: unknown, hasCacheKey: boolean): {
  bucket: UsageBucket;
  operation: string;
} {
  switch (mode) {
    case "coach_greeting": return { bucket: "greeting", operation: mode };
    case "sleep_profile": return { bucket: "sleep_profile", operation: mode };
    case "daily_coach":
    case "checkin_reply":
    case "recommendation": return { bucket: "daily_checkin", operation: mode };
    case "coach_chat": return { bucket: "chat", operation: mode };
    default: return hasCacheKey
      ? { bucket: "daily_checkin", operation: "briefing" }
      : { bucket: "chat", operation: "chat" };
  }
}

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject : {};
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// Exact model allowlist: never silently apply Sonnet prices to a new model.
// https://platform.claude.com/docs/en/about-claude/pricing (verified 2026-09-25).
// Snapshot these rates on the event; future price changes must not rewrite history.
function pricing(model: string | null, request: JsonObject, usage: JsonObject) {
  const unsupported = model !== "claude-sonnet-4-6" ||
    (request.inference_geo != null && request.inference_geo !== "global") ||
    (request.speed != null && request.speed !== "standard") ||
    (usage.service_tier != null && usage.service_tier !== "standard") ||
    Object.values(object(usage.server_tool_use)).some((value) => value !== 0);
  if (unsupported) return {
    pricing_version: null,
    input_usd_per_million: null, output_usd_per_million: null,
    cache_read_usd_per_million: null,
    cache_write_5m_usd_per_million: null, cache_write_1h_usd_per_million: null,
  };
  return {
    pricing_version: "anthropic-standard-2026-09-25",
    input_usd_per_million: 3, output_usd_per_million: 15,
    cache_read_usd_per_million: 0.30,
    cache_write_5m_usd_per_million: 3.75, cache_write_1h_usd_per_million: 6,
  };
}

class UsageObservation {
  raw: JsonObject = {};
  model: string | null = null;
  messageId: string | null = null;
  stopReason: string | null = null;
  sawStart = false;
  sawFinalOutput = false;
  sawStop = false;
  malformed = false;
  errorType: string | null = null;

  merge(value: unknown) {
    const next = object(value);
    this.raw = {
      ...this.raw, ...next,
      ...(next.cache_creation ? {
        cache_creation: { ...object(this.raw.cache_creation), ...object(next.cache_creation) },
      } : {}),
    };
  }

  message(value: unknown) {
    const message = object(value);
    this.model = string(message.model);
    this.messageId = string(message.id);
    this.stopReason = string(message.stop_reason);
    this.merge(message.usage);
  }

  event(data: string) {
    if (data === "[DONE]") return;
    let event: JsonObject;
    try { event = object(JSON.parse(data)); } catch { this.malformed = true; return; }
    if (event.type === "message_start") {
      this.sawStart = true;
      this.message(event.message);
    } else if (event.type === "message_delta") {
      // Anthropic deltas contain cumulative counts, NOT increments.
      this.merge(event.usage);
      if (count(object(event.usage).output_tokens) !== null) this.sawFinalOutput = true;
      this.stopReason = string(object(event.delta).stop_reason) ?? this.stopReason;
    } else if (event.type === "message_stop") {
      this.sawStop = true;
    } else if (event.type === "error") {
      this.errorType = string(object(event.error).type) ?? "provider_stream_error";
    }
  }

  fields(finished: boolean, request: JsonObject) {
    const hasUsage = Object.keys(this.raw).length > 0;
    const input = count(this.raw.input_tokens);
    const output = count(this.raw.output_tokens);
    const read = count(this.raw.cache_read_input_tokens ?? (hasUsage ? 0 : null));
    const created = count(this.raw.cache_creation_input_tokens ?? (hasUsage ? 0 : null));
    const breakdown = object(this.raw.cache_creation);
    // Do not guess a TTL for a nonzero cache write without its breakdown.
    const five = count(breakdown.ephemeral_5m_input_tokens ?? (created === 0 ? 0 : null));
    const hour = count(breakdown.ephemeral_1h_input_tokens ?? (created === 0 ? 0 : null));
    const complete = finished && !this.malformed && input !== null && output !== null &&
      read !== null && created !== null;
    return {
      response_model: this.model, provider_message_id: this.messageId,
      stop_reason: this.stopReason, raw_usage: this.raw,
      usage_status: complete ? "complete" : hasUsage ? "partial" : "unavailable",
      input_tokens: input, output_tokens: output,
      cache_read_input_tokens: read, cache_creation_input_tokens: created,
      cache_creation_5m_input_tokens: five,
      cache_creation_1h_input_tokens: hour,
      ...pricing(this.model, request, this.raw),
    };
  }
}

// Handles arbitrary UTF-8 chunk boundaries, LF/CRLF, and multi-line SSE data.
async function observeStream(body: ReadableStream<Uint8Array>, observation: UsageObservation) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  const line = (value: string) => {
    const clean = value.endsWith("\r") ? value.slice(0, -1) : value;
    if (clean === "") {
      if (data.length) observation.event(data.join("\n"));
      data = [];
    } else if (clean.startsWith("data:")) {
      data.push(clean.slice(5).replace(/^ /, ""));
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1) {
        line(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
      if (done) break;
    }
    // An unterminated event is not a confirmed message_stop.
    if (buffer || data.length) observation.malformed = true;
  } finally {
    reader.releaseLock();
  }
}

type MeterOptions = {
  userId: string;
  bucket: UsageBucket;
  operation: string;
  // Must upsert by id, use a service-role client, and impose a bounded timeout.
  write: (row: UsageRow) => Promise<void>;
  waitUntil: (task: Promise<void>) => void;
  fetcher?: typeof fetch;
  log?: (row: UsageRow) => void;
};

export function createMeteredAnthropicFetch(options: MeterOptions): typeof fetch {
  const fetcher = options.fetcher ?? fetch;
  const requestId = crypto.randomUUID();
  let attempt = 0;
  const save = async (row: UsageRow) => {
    for (let retry = 0; retry < 2; retry++) {
      try { await options.write(row); return; } catch { /* Retry the same event ID. */ }
    }
    // Metadata only, suitable for repair; never log prompts, responses or keys.
    (options.log ?? ((row) => console.error("llm_usage_write_failed", JSON.stringify(row))))(row);
  };

  return async (input, init) => {
    // This wrapper is intentionally limited to our JSON Messages API calls.
    const request = object(JSON.parse(String(init?.body)));
    const row: UsageRow = {
      id: crypto.randomUUID(), user_id: options.userId,
      request_id: requestId, attempt_index: ++attempt,
      bucket: options.bucket, operation: options.operation, provider: "anthropic",
      requested_model: string(request.model) ?? "unknown",
      started_at: new Date().toISOString(), status: "pending", usage_status: "unavailable",
    };
    // Persist intent before inference: worker termination leaves a visible pending row.
    await save(row);
    const observation = new UsageObservation();
    const finish = async (status: string, complete: boolean, errorType: string | null = null) => {
      await save({
        ...row, ...observation.fields(complete, request),
        status, error_type: errorType, finished_at: new Date().toISOString(),
      });
    };
    let response: Response;
    try {
      response = await fetcher(input, init);
    } catch (error) {
      await finish("network_error", false, error instanceof Error ? error.name : "network_error");
      throw error;
    }
    row.http_status = response.status;
    row.provider_request_id = response.headers.get("request-id");
    if (!response.ok) {
      await finish("http_error", false, "provider_http_error");
      return response;
    }
    if (request.stream === true && response.body) {
      const [client, observer] = response.body.tee();
      // An independent reader survives client cancellation. Register immediately,
      // before handing the response back to the chat or legacy SSE handler.
      options.waitUntil((async () => {
        try {
          await observeStream(observer, observation);
          const complete = observation.sawStart && observation.sawFinalOutput &&
            observation.sawStop && !observation.malformed && !observation.errorType;
          await finish(observation.errorType ? "stream_error" : complete ? "completed" : "incomplete",
            complete, observation.errorType);
        } catch {
          await finish("stream_error", false, "stream_read_error");
        }
      })());
      return new Response(client, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    }
    try {
      observation.message(await response.clone().json());
      await finish("completed", request.stream !== true);
    } catch {
      await finish("incomplete", false, "invalid_provider_response");
    }
    return response;
  };
}
