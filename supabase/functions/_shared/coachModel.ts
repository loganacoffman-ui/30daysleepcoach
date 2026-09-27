import * as configcat from "npm:@configcat/sdk@1/deno";

export const DEFAULT_COACH_MODEL = "claude-sonnet-4-6";
export const SONNET_5_MODEL = "claude-sonnet-5";
export const SONNET_5_FLAG_KEY = "useSonnet5";

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
      console.error("Invalid CONFIGCAT_SDK_KEY; using default coach model", error);
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
  if (!client) return DEFAULT_COACH_MODEL;
  try {
    const useSonnet5 = await client.getValueAsync(SONNET_5_FLAG_KEY, false, {
      identifier: user.id,
      email: user.email,
    });
    return useSonnet5 ? SONNET_5_MODEL : DEFAULT_COACH_MODEL;
  } catch (error) {
    console.error("ConfigCat evaluation failed; using default coach model", error);
    return DEFAULT_COACH_MODEL;
  }
}
