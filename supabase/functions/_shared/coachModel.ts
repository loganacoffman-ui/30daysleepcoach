import * as configcat from "npm:@configcat/sdk@1/deno";
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { readServerCache, writeServerCache } from './serverCache.ts';
import { coalesce } from './greeting.ts';
import { logSleepCoach } from "./sleepCoachLog.ts";

export const DEFAULT_COACH_MODEL = "claude-sonnet-4-6";
/** Reserved for future rollout; metering rates remain in llmUsage.ts. */
export const SONNET_5_MODEL = "claude-sonnet-5";
export const SONNET_5_5_MODEL = "claude-sonnet-5-5";
export const SONNET_5_FLAG_KEY = "useSonnet5";

// Sonnet 5 thinks unless told otherwise, and max_tokens caps thinking plus reply
// text, so short coaching budgets end before any text.
export const COACH_THINKING = { type: "disabled" } as const;
export const COACH_THINKING_BETWEEN_TOOLS = { type: "between_tools" } as const;

/** https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide */
export function coachThinkingForModel(model: string): typeof COACH_THINKING | typeof COACH_THINKING_BETWEEN_TOOLS {
  return model === SONNET_5_5_MODEL ? COACH_THINKING_BETWEEN_TOOLS : COACH_THINKING;
}

type FlagClient = Pick<configcat.IConfigCatClient, "getValueAsync">;
type FlagUser = { id: string; email?: string };

let sharedClient: FlagClient | null | undefined;

// Lazy loading avoids background poll timers in short-lived edge isolates.
function configCatClient(): FlagClient | null {
  if (sharedClient === undefined) {
    const sdkKey = Deno.env.get("CONFIGCAT_SDK_KEY");
    try {
      sharedClient = sdkKey
        ? configcat.getClient(sdkKey, configcat.PollingMode.LazyLoad, {
          cacheTimeToLiveSeconds: 60,
          requestTimeoutMs: 1500,
        })
        : null;
    } catch (error) {
      logSleepCoach("coach_model_configcat_init_failed", {
        reason: "invalid_sdk_key",
        fallback_model: DEFAULT_COACH_MODEL,
        error: error instanceof Error ? error.message : String(error),
      });
      sharedClient = null;
    }
  }
  return sharedClient;
}

// Flag values are evaluated inside the SDK; user attributes are not sent to ConfigCat.
export async function resolveCoachModel(
  user: FlagUser,
  flags: () => FlagClient | null = configCatClient,
): Promise<string> {
  const client = flags();
  if (!client) {
    logSleepCoach("coach_model_resolved", {
      user_id: user.id,
      reason: "configcat_unconfigured",
      flag: SONNET_5_FLAG_KEY,
      model: DEFAULT_COACH_MODEL,
    }, "log");
    return DEFAULT_COACH_MODEL;
  }
  try {
    const useSonnet5 = await client.getValueAsync(SONNET_5_FLAG_KEY, false, {
      identifier: user.id,
      email: user.email,
    });
    const model = useSonnet5 ? SONNET_5_5_MODEL : DEFAULT_COACH_MODEL;
    logSleepCoach("coach_model_resolved", {
      user_id: user.id,
      reason: useSonnet5 ? "flag_on" : "flag_off",
      flag: SONNET_5_FLAG_KEY,
      model,
    }, "log");
    return model;
  } catch (error) {
    logSleepCoach("coach_model_resolved", {
      user_id: user.id,
      reason: "configcat_eval_failed",
      flag: SONNET_5_FLAG_KEY,
      model: DEFAULT_COACH_MODEL,
      error: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_COACH_MODEL;
  }
}


export const MODEL_FLAG_TTL_MS = 60 * 60 * 1000;
const modelCache = new Map<string, { model: string; expiresAt: number }>();
const MODEL_CACHE_KEY = 'model-flag:useSonnet5:v1';
function rememberModel(userId: string, model: string, expiresAt: number) {
  if (!modelCache.has(userId) && modelCache.size >= 1000) modelCache.delete(modelCache.keys().next().value!);
  modelCache.set(userId, { model, expiresAt });
}
export async function cachedCoachModel(user: FlagUser, admin: SupabaseClient | null,
  resolve: () => Promise<string> = () => resolveCoachModel(user), now = Date.now()): Promise<string> {
  const hit = modelCache.get(user.id);
  if (hit && hit.expiresAt > now) return hit.model;
  // Bound memory in long-lived workers. Entries expire at their original deadline,
  // never one hour after a cache read.
  for (const [key, value] of modelCache) if (value.expiresAt <= now) modelCache.delete(key);
  return coalesce(`model:${user.id}`, async () => {
    if (admin) {
      try {
        const saved = await readServerCache<{ model: string }>(admin, user.id, MODEL_CACHE_KEY);
        if (saved && [DEFAULT_COACH_MODEL, SONNET_5_5_MODEL].includes(saved.value.model)) {
          rememberModel(user.id, saved.value.model, saved.expiresAt);
          return saved.value.model;
        }
      } catch { console.warn('Model cache read unavailable'); }
    }
    const model = await resolve();
    const expiresAt = now + MODEL_FLAG_TTL_MS;
    rememberModel(user.id, model, expiresAt);
    if (admin) {
      try { await writeServerCache(admin, user.id, MODEL_CACHE_KEY, { model }, expiresAt); }
      catch { console.warn('Model cache write unavailable'); }
    }
    return model;
  }).promise;
}
