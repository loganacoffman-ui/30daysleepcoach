import { afterEach, describe, expect, it, vi } from "vitest";
import { coachAdmin } from "./helpers/coachAdmin";
import {
  readServerCache,
  withGenerationLease,
  writeServerCache,
} from "../supabase/functions/_shared/serverCache";
import {
  cachedCoachModel,
  DEFAULT_COACH_MODEL,
  MODEL_FLAG_TTL_MS,
  SONNET_5_5_MODEL,
} from "../supabase/functions/_shared/coachModel";
import { fetchOura } from "../supabase/functions/_shared/oura";
import { verifiedUser } from "../supabase/functions/_shared/auth";
import { cachedSystemPrompt } from "../supabase/functions/_shared/promptCache";
import { interpretDirectCheckinReply } from "../supabase/functions/_shared/checkinReply";
import { Mem0MemoryProvider } from "../supabase/functions/_shared/memory";
import { createMeteredAnthropicFetch } from "../supabase/functions/_shared/llmUsage";

vi.mock("npm:@configcat/sdk@1/deno", () => ({}));
vi.mock("jsr:@supabase/supabase-js@2", () => ({ createClient: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("verified identity", () => {
  it("passes the token to signature verification and does not decode/trust the request body", async () => {
    const getClaims = vi.fn(async () => ({
      data: { claims: { sub: "alice", role: "authenticated", email: "a@example.com" } },
      error: null,
    }));
    const client = { auth: { getClaims } } as any;
    const request = new Request("https://test", {
      method: "POST",
      headers: { Authorization: "Bearer signed-token" },
      body: '{"user_id":"mallory"}',
    });
    expect(await verifiedUser(request, client)).toEqual({ id: "alice", email: "a@example.com" });
    expect(getClaims).toHaveBeenCalledWith("signed-token");
    for (
      const result of [{ data: null, error: new Error("invalid signature") }, {
        data: { claims: { sub: "alice", role: "service_role" } },
        error: null,
      }, { data: { claims: { role: "authenticated" } }, error: null }]
    ) {
      getClaims.mockResolvedValueOnce(result as any);
      expect(await verifiedUser(request, client)).toBeNull();
    }
    expect(await verifiedUser(new Request("https://test"), client)).toBeNull();
    expect(getClaims).toHaveBeenCalledTimes(4);
  });
});

describe("server-owned cache", () => {
  it("isolates users and expires entries at the stored deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
    const admin = coachAdmin() as any;
    await writeServerCache(admin, "alice", "key", { value: 1 }, Date.now() + 1000);
    expect((await readServerCache(admin, "alice", "key"))?.value).toEqual({ value: 1 });
    expect(await readServerCache(admin, "bob", "key")).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(await readServerCache(admin, "alice", "key")).toBeNull();
  });

  it("uses one-hour model decisions without extending TTL on hits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
    const admin = coachAdmin() as any;
    const resolve = vi.fn(async () => SONNET_5_5_MODEL);
    const user = { id: "ttl-user" };
    expect(await cachedCoachModel(user, admin, resolve)).toBe(SONNET_5_5_MODEL);
    vi.advanceTimersByTime(MODEL_FLAG_TTL_MS - 1);
    expect(await cachedCoachModel(user, admin, resolve)).toBe(SONNET_5_5_MODEL);
    expect(resolve).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    resolve.mockResolvedValueOnce(DEFAULT_COACH_MODEL);
    expect(await cachedCoachModel(user, admin, resolve)).toBe(DEFAULT_COACH_MODEL);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(await cachedCoachModel({ id: "different-user" }, admin, resolve)).toBe(SONNET_5_5_MODEL);
    expect(resolve).toHaveBeenCalledTimes(3);
  });

  it("loads a shared model cache on a cold worker path", async () => {
    const admin = coachAdmin() as any;
    await writeServerCache(
      admin,
      "cold-user",
      "model-flag:useSonnet5:v1",
      { model: SONNET_5_5_MODEL },
      Date.now() + 60_000,
    );
    const resolve = vi.fn(async () => DEFAULT_COACH_MODEL);
    expect(await cachedCoachModel({ id: "cold-user" }, admin, resolve)).toBe(SONNET_5_5_MODEL);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("cross-worker generation coordination", () => {
  it("serializes duplicate work so the waiter can reuse the first persisted result", async () => {
    vi.useFakeTimers();
    const admin = coachAdmin() as any;
    const gate = deferred<void>();
    const entered = deferred<void>();
    let generations = 0;
    let stored: string | null = null;
    const first = withGenerationLease(admin, "alice", "daily", async (lease) => {
      entered.resolve();
      generations++;
      await gate.promise;
      await lease.assertOwned();
      stored = "answer";
      return stored;
    });
    await entered.promise;
    const second = withGenerationLease(admin, "alice", "daily", async (lease) => {
      expect(lease.joined).toBe(true);
      if (!stored) generations++;
      return stored;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(generations).toBe(1);
    gate.resolve();
    await first;
    await vi.advanceTimersByTimeAsync(1000);
    expect(await second).toBe("answer");
    expect(generations).toBe(1);
  });

  it("rejects an expired owner and never deletes its replacement lease", async () => {
    const admin = coachAdmin() as any;
    await expect(withGenerationLease(admin, "alice", "daily", async (lease) => {
      admin.rows("coach_generation_leases")[0].owner = "replacement";
      await lease.assertOwned();
    })).rejects.toThrow("lease expired");
    expect(admin.rows("coach_generation_leases")[0].owner).toBe("replacement");
  });

  it("releases on errors and fails closed when lease acquisition is unavailable", async () => {
    const admin = coachAdmin() as any;
    await expect(withGenerationLease(admin, "alice", "daily", async () => {
      throw new Error("provider");
    })).rejects.toThrow("provider");
    expect(admin.rows("coach_generation_leases")).toHaveLength(0);
    const work = vi.fn();
    admin.rpc = () => ({ abortSignal: async () => ({ error: new Error("database") }) });
    await expect(withGenerationLease(admin, "alice", "daily", work)).rejects.toThrow("database");
    expect(work).not.toHaveBeenCalled();
  });
});

describe("Oura evidence", () => {
  const connect = (admin: any, user_id = "alice") =>
    admin.rows("oura_connections").push({
      user_id,
      access_token: `${user_id}-token`,
      refresh_token: "refresh",
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      updated_at: "v1",
      scope: "daily",
    });
  const request = (admin: any, fetcher: any, user = "alice") =>
    fetchOura(admin, user, "daily_sleep", "2026-10-09", "2026-10-22", undefined, fetcher);

  it("does not call a provider for disconnected users", async () => {
    const fetcher = vi.fn();
    expect((await request(coachAdmin(), fetcher)).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reuses successful data for 60 seconds and invalidates on connection replacement/disconnect", async () => {
    vi.useFakeTimers();
    const admin = coachAdmin();
    connect(admin);
    const fetcher = vi.fn(async () => Response.json({ data: [{ day: "2026-10-22", score: 80 }] }));
    expect((await request(admin, fetcher)).status).toBe(200);
    expect((await request(admin, fetcher)).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60000);
    await request(admin, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    admin.rows("oura_connections")[0].updated_at = "v2";
    await request(admin, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
    admin.tables.set("oura_connections", []);
    expect((await request(admin, fetcher)).status).toBe(401);
    expect((await request(admin, fetcher, "bob")).status).toBe(401);
  });

  it("does not cache provider errors or use OAuth cache for a caller-supplied token", async () => {
    const admin = coachAdmin();
    connect(admin);
    const fetcher = vi.fn(async () => Response.json({ error: "rate limit" }, { status: 429 }));
    await request(admin, fetcher);
    await request(admin, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(admin.rows("coach_runtime_cache")).toHaveLength(0);
    fetcher.mockImplementation(async () => Response.json({ data: [] }));
    await request(admin, fetcher);
    await fetchOura(
      admin as any,
      "alice",
      "daily_sleep",
      "2026-10-09",
      "2026-10-22",
      "personal-token",
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect((fetcher.mock.calls.at(-1) as any)[1].headers.Authorization).toBe("Bearer personal-token");
    expect(
      (await fetchOura(null, "", "daily_sleep", "2026-10-09", "2026-10-22", "personal-token", fetcher))
        .status,
    ).toBe(200);
    await expect(fetchOura(null, "", "daily_sleep", "2026-10-09", "2026-10-22")).rejects.toThrow(
      "service client unavailable",
    );
  });

  it("refreshes once and persists the new connection before reading provider data", async () => {
    vi.stubGlobal("Deno", { env: { get: () => "test-client-credential" } });
    const admin = coachAdmin();
    connect(admin);
    admin.rows("oura_connections")[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/oauth/token")) {
        return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
      }
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer new-access");
      return Response.json({ data: [] });
    });
    expect((await request(admin, fetcher)).status).toBe(200);
    expect((await request(admin, fetcher)).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(admin.rows("oura_connections")[0].refresh_token).toBe("new-refresh");
    expect(admin.rows("coach_generation_leases")).toHaveLength(0);
  });
});

it("only exact categorical replies bypass inference; nuanced answers still need interpretation", () => {
  const request = {
    step: "feeling" as const,
    message: " Rested! ",
    turns: [{ role: "assistant" as const, content: "How do you feel?" }],
  };
  expect(interpretDirectCheckinReply(request)?.answer).toBe("rested");
  for (
    const message of [
      "not rested",
      "my partner feels rested",
      "rested yesterday",
      "great, except I am exhausted",
    ]
  ) {
    expect(interpretDirectCheckinReply({ ...request, message })).toBeNull();
  }
  expect(interpretDirectCheckinReply({ ...request, step: "factor", message: "noise" })).toBeNull();
});

it("keeps changing user evidence outside the cached instruction prefix", () => {
  const a = cachedSystemPrompt("instructions", "old report");
  const b = cachedSystemPrompt("instructions", "corrected report");
  expect(a[0]).toEqual(b[0]);
  expect(a[1]).not.toEqual(b[1]);
  expect(a[1]).not.toHaveProperty("cache_control");
});

it("keeps the memory timeout active until the body has been read", async () => {
  vi.useFakeTimers();
  let aborted = false;
  const fetcher = vi.fn(async (_url, init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          init.signal.addEventListener("abort", () => {
            aborted = true;
            controller.error(new Error("body timeout"));
          });
        },
      }),
    )
  );
  const provider = new Mem0MemoryProvider("key", "https://test", fetcher as any);
  const result = provider.search({ userId: "alice", query: "goals" });
  const rejected = expect(result).rejects.toThrow("body timeout");
  await vi.advanceTimersByTimeAsync(3500);
  await rejected;
  expect(aborted).toBe(true);
});

it("returns inference while final accounting is blocked, but keeps the durable pending record", async () => {
  const finalWrite = deferred<void>();
  const tasks: Promise<void>[] = [];
  const statuses: string[] = [];
  const metered = createMeteredAnthropicFetch({
    userId: "alice",
    bucket: "chat",
    operation: "chat",
    requestId: "server-request",
    waitUntil: (task) => {
      tasks.push(task);
    },
    write: async (row) => {
      statuses.push(String(row.status));
      expect(row.request_id).toBe("server-request");
      if (row.status !== "pending") await finalWrite.promise;
    },
    fetcher: async () => {
      expect(statuses).toEqual(["pending"]);
      return Response.json({
        id: "message",
        content: [{ type: "text", text: "Answer" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    },
  });
  const response = await metered("https://test", {
    body: JSON.stringify({ model: DEFAULT_COACH_MODEL, stream: false }),
  });
  expect((await response.json()).content[0].text).toBe("Answer");
  expect(statuses).toEqual(["pending", "completed"]);
  expect(tasks).toHaveLength(1);
  finalWrite.resolve();
  await Promise.all(tasks);
});

it("ends a trace without waiting for the exporter and retains its flush task", async () => {
  const flush = deferred<void>();
  const tasks: Promise<unknown>[] = [];
  vi.stubGlobal("Deno", { env: { get: () => "test-key" } });
  vi.stubGlobal("EdgeRuntime", {
    waitUntil: (task: Promise<unknown>) => {
      tasks.push(task);
    },
  });
  vi.doMock(
    "https://cdn.jsdelivr.net/npm/braintrust@3.32.0/edge-light/+esm",
    () => ({ initLogger: () => ({ flush: () => flush.promise }), NOOP_SPAN: {} }),
  );
  const { endAnthropicSpan } = await import("../supabase/functions/_shared/tracing");
  const span = { log: vi.fn(), end: vi.fn() };
  await endAnthropicSpan(span as any, "answer");
  expect(span.end).toHaveBeenCalledOnce();
  expect(tasks).toHaveLength(1);
  flush.resolve();
  await Promise.all(tasks);
});
