import * as configcat from "npm:@configcat/sdk@1/deno";
import { logSleepCoach } from "./sleepCoachLog.ts";

export const DEFAULT_COACH_MODEL = "claude-sonnet-4-6";
/** Reserved for future rollout; metering rates remain in llmUsage.ts. */
export const SONNET_5_MODEL = "claude-sonnet-5";
export const SONNET_5_5_MODEL = "claude-sonnet-5-5";
export const SONNET_5_FLAG_KEY = "useSonnet5";

// Sonnet 5 thinks unless told otherwise, and max_tokens caps thinking plus reply
// text, so short coaching budgets end before any text. Both models accept this.
export const COACH_THINKING = { type: "disabled" } as const;

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
