import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Only use a service-role client: authenticated users cannot forge model choices,
// provider evidence, or generation ownership in this table.
export async function readServerCache<T>(
  admin: SupabaseClient,
  userId: string,
  key: string,
): Promise<{ value: T; expiresAt: number } | null> {
  const { data, error } = await admin.from("coach_runtime_cache").select("value, expires_at")
    .eq("user_id", userId).eq("cache_key", key).abortSignal(AbortSignal.timeout(1500)).maybeSingle();
  if (error) throw error;
  if (!data || Date.parse(data.expires_at) <= Date.now()) return null;
  return { value: data.value as T, expiresAt: Date.parse(data.expires_at) };
}

export async function writeServerCache(
  admin: SupabaseClient,
  userId: string,
  key: string,
  value: unknown,
  expiresAt: number,
) {
  const { error } = await admin.from("coach_runtime_cache").upsert({
    user_id: userId,
    cache_key: key,
    value,
    expires_at: new Date(expiresAt).toISOString(),
  }, { onConflict: "user_id,cache_key" }).abortSignal(AbortSignal.timeout(1500));
  if (error) throw error;
}

export type GenerationLease = { joined: boolean; assertOwned(): Promise<void> };

export async function withGenerationLease<T>(
  admin: SupabaseClient | null,
  userId: string,
  key: string,
  work: (lease: GenerationLease) => Promise<T>,
): Promise<T> {
  if (!admin) return work({ joined: false, assertOwned: () => Promise.resolve() });
  const owner = crypto.randomUUID();
  const deadline = Date.now() + 45_000;
  let joined = false;
  let delay = 250;
  while (true) {
    const { data, error } = await admin.rpc("claim_coach_generation", {
      p_user_id: userId,
      p_key: key,
      p_owner: owner,
    }).abortSignal(AbortSignal.timeout(1500));
    if (error) throw error; // Coordination failure must not launch duplicate inference.
    if (data === true) break;
    joined = true;
    if (Date.now() >= deadline) {
      throw new Error("Coaching is still being generated. Please try again shortly.");
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 1000);
  }
  try {
    return await work({
      joined,
      assertOwned: async () => {
        const { data, error } = await admin.from("coach_generation_leases").select("owner, expires_at")
          .eq("user_id", userId).eq("cache_key", key).eq("owner", owner).abortSignal(
            AbortSignal.timeout(1500),
          ).maybeSingle();
        // Leave enough time for the two bounded publication writes (5s each).
        if (error || !data || Date.parse(data.expires_at) <= Date.now() + 15_000) {
          throw new Error("Coaching generation lease expired");
        }
      },
    });
  } finally {
    // A late worker can never release a replacement worker's lease.
    try {
      const { error } = await admin.from("coach_generation_leases").delete().eq("user_id", userId)
        .eq("cache_key", key).eq("owner", owner).abortSignal(AbortSignal.timeout(1500));
      if (error) console.warn("Coaching lease cleanup failed");
    } catch {
      console.warn("Coaching lease cleanup failed");
    }
  }
}
