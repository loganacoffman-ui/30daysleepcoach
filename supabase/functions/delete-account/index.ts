import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createMemoryProvider } from "../_shared/memory.ts";

const ALLOWED_ORIGINS = [
  "https://30daysleepcoach.com",
  "https://www.30daysleepcoach.com",
  "http://localhost:8000",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(req),
      "Content-Type": "application/json",
    },
  });
}

function mustEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");

    if (!jwt) {
      return jsonResponse(req, { error: "Missing Supabase session" }, 401);
    }

    const admin = createClient(
      mustEnv("SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: userData, error: userError } = await admin.auth.getUser(jwt);

    if (userError || !userData.user) {
      return jsonResponse(req, { error: "Invalid Supabase session" }, 401);
    }

    // Remove provider-held coaching memories before deleting the auth identity;
    // otherwise a failed external deletion would leave no authenticated way to retry.
    const memoryProvider = createMemoryProvider(mustEnv("MEM0_API_KEY"));
    await memoryProvider.deleteUser(userData.user.id);

    const { error: deleteError } = await admin.auth.admin.deleteUser(
      userData.user.id,
    );

    if (deleteError) {
      return jsonResponse(req, {
        error: "Account deletion could not be completed",
      }, 500);
    }

    return jsonResponse(req, { deleted: true });
  } catch (error) {
    console.error("delete-account failed", error);
    return jsonResponse(req, {
      error: "Account deletion could not be completed",
    }, 500);
  }
});
