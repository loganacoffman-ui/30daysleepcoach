import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getClient,
  PollingMode,
  type IConfigCatClient,
  type SettingTypeOf,
} from '@configcat/sdk/browser';

export type FeatureFlagValue = boolean | string | number;

let client: IConfigCatClient | null | undefined;

/** One client for the app, with no network requests until a flag is evaluated. */
export function getConfigCatClient(): IConfigCatClient | null {
  if (client !== undefined) return client;

  const sdkKey = process.env.EXPO_PUBLIC_CONFIGCAT_SDK_KEY?.trim();
  if (!sdkKey) return (client = null);

  try {
    client = getClient(sdkKey, PollingMode.LazyLoad, {
      cacheTimeToLiveSeconds: 60,
      requestTimeoutMs: 5000,
      cache: {
        get: (key) => AsyncStorage.getItem(`configcat:${key}`),
        set: (key, value) => AsyncStorage.setItem(`configcat:${key}`, value),
      },
    });
  } catch {
    // Invalid configuration must not prevent the app from launching.
    console.warn('ConfigCat could not initialize. Feature flags will use their defaults.');
    client = null;
  }

  return client;
}

/** Pass an opaque account ID for targeting; omit it for untargeted flags. */
export async function getFeatureFlag<T extends FeatureFlagValue>(
  key: string,
  defaultValue: T,
  userId?: string,
): Promise<SettingTypeOf<T>> {
  try {
    const configCat = getConfigCatClient();
    if (configCat) {
      return await configCat.getValueAsync(
        key,
        defaultValue,
        userId ? { identifier: userId } : undefined,
      );
    }
  } catch {
    // The SDK normally handles fetch/evaluation failures itself; keep callers safe too.
  }
  return defaultValue as SettingTypeOf<T>;
}
