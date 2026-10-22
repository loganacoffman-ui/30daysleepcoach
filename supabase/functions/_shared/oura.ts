import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { readServerCache, withGenerationLease, writeServerCache } from "./serverCache.ts";
import { coalesce } from "./greeting.ts";

export const OURA_ENDPOINTS = new Set(["daily_stress", "daily_sleep", "sleep", "heartrate"]);
type Connection = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  updated_at: string;
  scope: string | null;
};
type OuraResult = { status: number; body: unknown; snapshot?: CachedOura };
type CachedOura = { connectionVersion: string; body: unknown };
export const ouraCacheKey = (endpoint: string, start: string, end: string) =>
  `oura:${endpoint}:${start}:${end}`;

export function validOuraRange(endpoint: string, start: unknown, end: unknown): start is string {
  const valid = (value: unknown) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return OURA_ENDPOINTS.has(endpoint) && valid(start) && valid(end) && String(start) <= String(end);
}

async function connectionFor(admin: SupabaseClient, userId: string): Promise<Connection | null> {
  const { data, error } = await admin.from("oura_connections")
    .select("access_token, refresh_token, expires_at, updated_at, scope").eq("user_id", userId)
    .abortSignal(AbortSignal.timeout(3000)).maybeSingle();
  if (error) throw new Error("Oura connection lookup unavailable");
  return data;
}

async function refreshConnection(
  admin: SupabaseClient,
  userId: string,
  fetcher: typeof fetch,
): Promise<Connection | null> {
  return withGenerationLease(admin, userId, "oura-refresh", async (lease) => {
    const connection = await connectionFor(admin, userId);
    if (!connection || Date.parse(connection.expires_at) > Date.now() + 120_000) return connection;
    const response = await fetcher("https://api.ouraring.com/oauth/token", {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: connection.refresh_token,
        client_id: Deno.env.get("OURA_CLIENT_ID")!,
        client_secret: Deno.env.get("OURA_CLIENT_SECRET")!,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Oura refresh failed: ${response.status}`);
    }
    const token = await response.json();
    if (
      typeof token.access_token !== "string" || typeof token.refresh_token !== "string" ||
      !Number.isFinite(Number(token.expires_in)) || Number(token.expires_in) <= 0
    ) throw new Error("Invalid Oura token response");
    await lease.assertOwned();
    const next = {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      token_type: token.token_type || "bearer",
      scope: token.scope || connection.scope,
      expires_at: new Date(Date.now() + Math.max(0, Number(token.expires_in) - 60) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    };
    // Do not resurrect a disconnected account or overwrite a newly connected one.
    const { data, error } = await admin.from("oura_connections").update(next).eq("user_id", userId)
      .eq("updated_at", connection.updated_at).select(
        "access_token, refresh_token, expires_at, updated_at, scope",
      )
      .abortSignal(AbortSignal.timeout(3000)).maybeSingle();
    if (error) throw new Error("Oura token persistence failed");
    return data ?? await connectionFor(admin, userId);
  });
}

// For stored OAuth credentials, userId must come from verifiedUser, never from
// a request body. Personal tokens bypass all database/cache access.
export async function fetchOura(
  admin: SupabaseClient | null,
  userId: string,
  endpoint: string,
  start: string,
  end: string,
  token?: string,
  fetcher: typeof fetch = fetch,
): Promise<OuraResult> {
  if (!validOuraRange(endpoint, start, end)) {
    return { status: 400, body: { error: "Invalid Oura date range or endpoint" } };
  }
  if (!token && !admin) throw new Error("Oura service client unavailable");
  let connection = token ? null : await connectionFor(admin!, userId);
  if (!token && !connection) return { status: 401, body: { error: "No Oura connection found" } };
  const key = ouraCacheKey(endpoint, start, end);
  const cacheable = !token && endpoint === "daily_sleep";
  if (cacheable) {
    try {
      const hit = await readServerCache<CachedOura>(admin!, userId, key);
      if (hit && hit.value.connectionVersion === connection!.updated_at) {
        return { status: 200, body: hit.value.body, snapshot: hit.value };
      }
    } catch {
      console.warn("Oura cache read unavailable");
    }
  }
  const work = async (): Promise<OuraResult> => {
    if (!token && Date.parse(connection!.expires_at) <= Date.now() + 120_000) {
      connection = await refreshConnection(admin!, userId, fetcher);
      if (!connection) return { status: 401, body: { error: "No Oura connection found" } };
    }
    const url = new URL(`https://api.ouraring.com/v2/usercollection/${endpoint}`);
    url.searchParams.set("start_date", start);
    url.searchParams.set("end_date", end);
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${token || connection!.access_token}` },
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: "Invalid Oura response" };
    }
    if (
      cacheable && response.ok && body && typeof body === "object" &&
      Array.isArray((body as { data?: unknown }).data)
    ) {
      try {
        await writeServerCache(
          admin!,
          userId,
          key,
          { connectionVersion: connection!.updated_at, body },
          Date.now() + 60_000,
        );
      } catch {
        console.warn("Oura cache write unavailable");
      }
    }
    return {
      status: response.status,
      body,
      ...(cacheable && response.ok ? { snapshot: { connectionVersion: connection!.updated_at, body } } : {}),
    };
  };
  // Never coalesce caller-supplied tokens with stored OAuth connections.
  return token ? work() : coalesce(`${userId}:${key}:${connection!.updated_at}`, work).promise;
}
