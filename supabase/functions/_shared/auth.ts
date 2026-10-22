import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

let verifier: SupabaseClient | undefined;
export function authVerifier(): SupabaseClient {
  // A worker-wide client retains the SDK's JWKS cache. Never set a caller's
  // Authorization header or session on this shared client.
  return verifier ??= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(5000)])
            : AbortSignal.timeout(5000),
        }),
    },
  });
}

export async function verifiedUser(
  req: Request,
  client = authVerifier(),
): Promise<{ id: string; email?: string } | null> {
  const header = req.headers.get("Authorization");
  if (!header || !/^Bearer\s+\S+$/i.test(header)) return null;
  const jwt = header.replace(/^Bearer\s+/i, "");
  const { data, error } = await client.auth.getClaims(jwt);
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== "string" || claims.role !== "authenticated") return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : undefined };
}
