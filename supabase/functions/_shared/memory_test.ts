import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createMemoryProvider, Mem0MemoryProvider } from "./memory.ts";

Deno.test("createMemoryProvider: disables memory without an API key", async () => {
  const provider = createMemoryProvider(undefined);

  assertEquals(provider.name, "disabled");
  assertEquals(
    await provider.search({ userId: "user-1", query: "sleep goals" }),
    [],
  );
});

Deno.test("Mem0MemoryProvider: translates neutral search input to Mem0 v3", async () => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};
  let authorization = "";
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = input.toString();
    requestBody = JSON.parse(String(init?.body));
    authorization = new Headers(init?.headers).get("Authorization") ?? "";
    return Promise.resolve(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "memory-1",
              memory: "User sleeps better after morning light.",
              score: 0.82,
            },
            { id: "memory-2", memory: "" },
          ],
        }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;
  const provider = new Mem0MemoryProvider(
    "secret-key",
    "https://mem0.test",
    fetcher,
  );

  const memories = await provider.search({
    userId: "verified-user",
    query: "What has helped this user sleep?",
    limit: 4,
  });

  assertEquals(requestUrl, "https://mem0.test/v3/memories/search/");
  assertEquals(authorization, "Token secret-key");
  assertEquals(requestBody, {
    query: "What has helped this user sleep?",
    filters: { user_id: "verified-user" },
    top_k: 4,
    rerank: true,
  });
  assertEquals(memories, [{
    id: "memory-1",
    content: "User sleeps better after morning light.",
    score: 0.82,
    metadata: undefined,
  }]);
});

Deno.test("Mem0MemoryProvider: sends conversations with temporal context", async () => {
  let requestBody: Record<string, unknown> = {};
  const fetcher = ((_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return Promise.resolve(
      new Response(
        JSON.stringify({ event_id: "event-1", status: "PENDING" }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;
  const provider = new Mem0MemoryProvider(
    "secret-key",
    "https://mem0.test",
    fetcher,
  );

  await provider.save({
    userId: "verified-user",
    messages: [
      { role: "user", content: "Late caffeine disrupted my sleep." },
      { role: "assistant", content: "Avoid caffeine after lunch tonight." },
    ],
    metadata: { mode: "chat" },
    observedAt: "2026-08-25T20:00:00.000Z",
  });

  assertEquals(requestBody.user_id, "verified-user");
  assertEquals(requestBody.messages, [
    { role: "user", content: "Late caffeine disrupted my sleep." },
    { role: "assistant", content: "Avoid caffeine after lunch tonight." },
  ]);
  assertEquals(requestBody.metadata, { mode: "chat" });
  assertEquals(requestBody.observation_datetime, "2026-08-25T20:00:00.000Z");
  assertEquals(requestBody.temporal_reasoning, true);
  assertEquals(typeof requestBody.custom_instructions, "string");
});

Deno.test("Mem0MemoryProvider: deletes memories using the verified user scope", async () => {
  let requestUrl = "";
  let requestMethod = "";
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = input.toString();
    requestMethod = init?.method ?? "";
    return Promise.resolve(
      new Response(
        JSON.stringify({ message: "Memories deleted successfully!" }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;
  const provider = new Mem0MemoryProvider(
    "secret-key",
    "https://mem0.test",
    fetcher,
  );

  await provider.deleteUser("user/with spaces");

  assertEquals(
    requestUrl,
    "https://mem0.test/v1/memories/?user_id=user%2Fwith%20spaces",
  );
  assertEquals(requestMethod, "DELETE");
});
