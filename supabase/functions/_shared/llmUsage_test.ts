import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createMeteredAnthropicFetch, type UsageRow, usageFeature } from "./llmUsage.ts";
import { interpretCheckinReply } from "./checkinReply.ts";

const message = (usage: Record<string, unknown> = { input_tokens: 100, output_tokens: 20 }) => ({
  id: "msg_test", model: "claude-sonnet-4-6", type: "message", stop_reason: "end_turn",
  content: [{ type: "text", text: "private response" }], usage,
});
const sse = (event: unknown) => `event: ignored\r\ndata: ${JSON.stringify(event)}\r\n\r\n`;
const start = (usage?: Record<string, unknown>) => ({ type: "message_start", message: message(usage) });
const delta = (output: number) => ({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: output } });
const stop = { type: "message_stop" };

function harness(fetcher: typeof fetch, write?: (row: UsageRow) => Promise<void>) {
  const rows: UsageRow[] = [];
  const tasks: Promise<void>[] = [];
  const logs: UsageRow[] = [];
  const metered = createMeteredAnthropicFetch({
    userId: "verified-user", bucket: "chat", operation: "coach_chat", fetcher,
    write: write ?? ((row) => { rows.push(structuredClone(row)); return Promise.resolve(); }),
    waitUntil: (task) => { tasks.push(task); }, log: (row) => { logs.push(row); },
  });
  const call = (stream = false, extra = {}) => metered("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": "secret-key" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", stream, messages: [{ role: "user", content: "private prompt" }], ...extra }),
  });
  return { rows, logs, tasks, metered, call, finish: () => Promise.all(tasks) };
}

function streamResponse(text: string) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      // Force framing, CRLF, and multibyte characters to cross chunk boundaries.
      controller.enqueue(bytes.slice(offset, offset + 7));
      offset += 7;
    },
  }), { headers: { "request-id": "req_stream", "content-type": "text/event-stream" } });
}

Deno.test("non-stream usage is saved before app parsing and preserves the response", async () => {
  const payload = message();
  const h = harness(() => Promise.resolve(Response.json(payload, { headers: { "request-id": "req_test" } })));
  assertEquals(await (await h.call()).json(), payload);
  const [pending, final] = h.rows;
  assertEquals(pending.status, "pending");
  assertEquals(pending.id, final.id);
  assertEquals(final.user_id, "verified-user");
  assertEquals(final.provider_request_id, "req_test");
  assertEquals(final.provider_message_id, "msg_test");
  assertEquals(final.usage_status, "complete");
  assertEquals(final.input_tokens, 100);
  assertEquals(final.output_tokens, 20);
  assertEquals(final.cache_read_input_tokens, 0);
  assertEquals(final.input_usd_per_million, 3);
  assertEquals(final.output_usd_per_million, 15);
  assert(!JSON.stringify(h.rows).includes("private"));
  assert(!JSON.stringify(h.rows).includes("secret-key"));
});

Deno.test("retries are separate charged attempts grouped under one server request", async () => {
  const h = harness(() => Promise.resolve(Response.json(message())));
  await h.call(); await h.call();
  assert(h.rows[1].id !== h.rows[3].id);
  assertEquals(h.rows[1].request_id, h.rows[3].request_id);
  assertEquals([h.rows[1].attempt_index, h.rows[3].attempt_index], [1, 2]);
  const other = harness(() => Promise.resolve(Response.json(message())));
  await other.call();
  assert(h.rows[1].request_id !== other.rows[1].request_id);
});

Deno.test("stream usage merges cumulative deltas and survives caller cancellation", async () => {
  const raw = sse(start({ input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 500,
    cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 100 } })) +
    sse({ type: "ping" }) + sse({ type: "content_block_delta", delta: { text: "🌙 private" } }) +
    sse(delta(7)) + sse(delta(25)) + sse(stop);
  const h = harness(() => Promise.resolve(streamResponse(raw)));
  const response = await h.call(true);
  const cancellation = response.body!.cancel();
  await h.finish(); await cancellation;
  const final = h.rows.at(-1)!;
  assertEquals(final.status, "completed");
  assertEquals(final.usage_status, "complete");
  assertEquals(final.output_tokens, 25); // not 1+7+25
  assertEquals(final.cache_read_input_tokens, 500);
  assertEquals(final.cache_creation_5m_input_tokens, 200);
  assertEquals(final.cache_creation_1h_input_tokens, 100);
  assertEquals(final.cache_write_1h_usd_per_million, 6);
  assertEquals(final.provider_request_id, "req_stream");
  assert(!JSON.stringify(final).includes("private"));
});

Deno.test("stream bytes are passed through unchanged", async () => {
  const raw = sse(start()) + sse(delta(20)) + sse(stop);
  const h = harness(() => Promise.resolve(streamResponse(raw)));
  assertEquals(await (await h.call(true)).text(), raw);
  await h.finish();
});

Deno.test("truncated and malformed streams retain partial counts, not a complete bill", async () => {
  for (const raw of [sse(start()) + sse(delta(7)), sse(start()) + "data: invalid\n\n" + sse(delta(7)) + sse(stop),
    sse(start()) + sse(stop), sse(start()) + sse(delta(7)) + 'data: {"type":"message_stop"}']) {
    const h = harness(() => Promise.resolve(streamResponse(raw)));
    await (await h.call(true)).text(); await h.finish();
    assertEquals(h.rows.at(-1)!.status, "incomplete");
    assertEquals(h.rows.at(-1)!.usage_status, "partial");
  }
});

Deno.test("SSE provider errors retain observed usage", async () => {
  const h = harness(() => Promise.resolve(streamResponse(sse(start()) +
    sse({ type: "error", error: { type: "overloaded_error", message: "do not retain" } }))));
  await (await h.call(true)).text(); await h.finish();
  assertEquals(h.rows.at(-1)!.status, "stream_error");
  assertEquals(h.rows.at(-1)!.error_type, "overloaded_error");
  assertEquals(h.rows.at(-1)!.usage_status, "partial");
});

Deno.test("transport failure is rethrown and recorded without sensitive error text", async () => {
  const h = harness(() => Promise.reject(new TypeError("private URL")));
  await assertRejects(() => h.call(), TypeError);
  assertEquals(h.rows.at(-1)!.status, "network_error");
  assertEquals(h.rows.at(-1)!.usage_status, "unavailable");
  assertEquals(h.rows.at(-1)!.input_tokens, null);
  assert(!JSON.stringify(h.rows).includes("private URL"));
});

Deno.test("HTTP errors and missing usage are unknown cost rather than zero", async () => {
  const h = harness(() => Promise.resolve(new Response("error", { status: 429 })));
  assertEquals((await h.call()).status, 429);
  assertEquals(h.rows.at(-1)!.status, "http_error");
  assertEquals(h.rows.at(-1)!.input_tokens, null);
  const missing = harness(() => Promise.resolve(Response.json({ content: [] })));
  await missing.call();
  assertEquals(missing.rows.at(-1)!.usage_status, "unavailable");
  assertEquals(missing.rows.at(-1)!.pricing_version, null);
});

Deno.test("invalid JSON does not change the provider response", async () => {
  const h = harness(() => Promise.resolve(new Response("broken JSON")));
  assertEquals(await (await h.call()).text(), "broken JSON");
  assertEquals(h.rows.at(-1)!.status, "incomplete");
});

Deno.test("invalid counts and unknown cache TTL cannot be silently priced", async () => {
  for (const input_tokens of [-1, 1.5, "100", Number.MAX_SAFE_INTEGER + 1]) {
    const h = harness(() => Promise.resolve(Response.json(message({ input_tokens, output_tokens: 1 }))));
    await h.call();
    assertEquals(h.rows.at(-1)!.usage_status, "partial");
    assertEquals(h.rows.at(-1)!.input_tokens, null);
  }
  const h = harness(() => Promise.resolve(Response.json(message({ input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 500 }))));
  await h.call();
  assertEquals(h.rows.at(-1)!.cache_creation_input_tokens, 500);
  assertEquals(h.rows.at(-1)!.cache_creation_5m_input_tokens, null);
  assertEquals(h.rows.at(-1)!.cache_creation_1h_input_tokens, null);
});

Deno.test("unknown models and unsupported pricing modes keep usage but no guessed rates", async () => {
  for (const payload of [{ ...message(), model: "future-model" },
    message({ input_tokens: 1, output_tokens: 2, service_tier: "priority" }),
    message({ input_tokens: 1, output_tokens: 2, server_tool_use: { web_search_requests: 1 } })]) {
    const h = harness(() => Promise.resolve(Response.json(payload)));
    await h.call();
    assertEquals(h.rows.at(-1)!.usage_status, "complete");
    assertEquals(h.rows.at(-1)!.pricing_version, null);
  }
  const h = harness(() => Promise.resolve(Response.json(message())));
  await h.call(false, { inference_geo: "us" });
  assertEquals(h.rows.at(-1)!.pricing_version, null);
});

Deno.test("database retries reuse the row ID; failures do not gate inference", async () => {
  const writes: UsageRow[] = [];
  let providerCalls = 0;
  const h = harness(() => { providerCalls++; return Promise.resolve(Response.json(message())); }, (row) => {
    writes.push(row); return Promise.reject(new Error("database unavailable"));
  });
  assertEquals((await h.call()).status, 200);
  assertEquals(providerCalls, 1);
  assertEquals(writes.length, 4);
  assertEquals(new Set(writes.map((row) => row.id)).size, 1);
  assertEquals(h.logs.length, 2);
  assertEquals(h.logs.at(-1)!.usage_status, "complete");
  assert(!JSON.stringify(h.logs).includes("private"));
});

Deno.test("successful retry of a failed final write records only one event", async () => {
  let calls = 0;
  const db = new Map<string, UsageRow>();
  const h = harness(() => Promise.resolve(Response.json(message())), (row) => {
    calls++;
    db.set(row.id, row); // Simulate committed write whose response was lost.
    return calls === 2 ? Promise.reject(new Error("lost response")) : Promise.resolve();
  });
  await h.call();
  assertEquals(calls, 3);
  assertEquals(db.size, 1);
  assertEquals([...db.values()][0].usage_status, "complete");
  assertEquals(h.logs, []);
});

Deno.test("check-in inference is charged even when the application rejects the result", async () => {
  const h = harness(() => Promise.resolve(Response.json(message())));
  await assertRejects(() => interpretCheckinReply({ step: "feeling", message: "fine",
    turns: [{ role: "assistant", content: "How are you feeling?" }] }, "key", h.metered));
  assertEquals(h.rows.at(-1)!.usage_status, "complete");
});

Deno.test("all operations map to the agreed buckets", () => {
  for (const mode of ["checkin_reply", "daily_coach", "recommendation"]) {
    assertEquals(usageFeature(mode, false), { bucket: "daily_checkin", operation: mode });
  }
  assertEquals(usageFeature("coach_chat", true), { bucket: "chat", operation: "coach_chat" });
  assertEquals(usageFeature("coach_greeting", false), { bucket: "greeting", operation: "coach_greeting" });
  assertEquals(usageFeature("sleep_profile", false), { bucket: "sleep_profile", operation: "sleep_profile" });
  assertEquals(usageFeature(undefined, true), { bucket: "daily_checkin", operation: "briefing" });
  assertEquals(usageFeature("unrecognized", false), { bucket: "chat", operation: "chat" });
});
