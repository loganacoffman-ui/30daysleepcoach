import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getClient, getValueAsync, storage } = vi.hoisted(() => ({
  getClient: vi.fn(),
  getValueAsync: vi.fn(),
  storage: { getItem: vi.fn(), setItem: vi.fn() },
}));
vi.mock('../mobile/node_modules/@configcat/sdk/lib/esm/browser/index.js', () => ({
  getClient, PollingMode: { LazyLoad: 1 },
}));
vi.mock('../mobile/node_modules/@react-native-async-storage/async-storage', () => ({
  default: storage,
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv('EXPO_PUBLIC_CONFIGCAT_SDK_KEY', 'test-sdk-key');
  getClient.mockReturnValue({ getValueAsync });
});
afterEach(() => vi.unstubAllEnvs());

describe('mobile feature flags', () => {
  it.each([undefined, '', '   '])('uses defaults without creating a client for key %s', async sdkKey => {
    vi.stubEnv('EXPO_PUBLIC_CONFIGCAT_SDK_KEY', sdkKey);
    const { getFeatureFlag } = await import('../mobile/featureFlags/client');
    expect(await getFeatureFlag('toggle', false)).toBe(false);
    expect(await getFeatureFlag('copy', 'Original')).toBe('Original');
    expect(await getFeatureFlag('limit', 3)).toBe(3);
    expect(getClient).not.toHaveBeenCalled();
  });

  it('shares a lazy-loading client and persists config separately from other app storage', async () => {
    const { getConfigCatClient, getFeatureFlag } = await import('../mobile/featureFlags/client');
    getConfigCatClient();
    expect(getValueAsync).not.toHaveBeenCalled();
    getValueAsync.mockResolvedValue(true);
    expect(await getFeatureFlag('toggle', false)).toBe(true);
    await getFeatureFlag('other', false);
    expect(getClient).toHaveBeenCalledTimes(1);
    expect(getClient).toHaveBeenCalledWith('test-sdk-key', 1, expect.objectContaining({
      cacheTimeToLiveSeconds: 60, requestTimeoutMs: 5000,
    }));
    const { cache } = getClient.mock.calls[0][2];
    storage.getItem.mockResolvedValue('cached-config');
    expect(await cache.get('sdk-hash')).toBe('cached-config');
    await cache.set('sdk-hash', 'new-config');
    expect(storage.getItem).toHaveBeenCalledWith('configcat:sdk-hash');
    expect(storage.setItem).toHaveBeenCalledWith('configcat:sdk-hash', 'new-config');
  });

  it('passes only the requested account ID and never retains targeting after sign-out', async () => {
    const { getFeatureFlag } = await import('../mobile/featureFlags/client');
    getValueAsync.mockResolvedValue(false);
    await getFeatureFlag('toggle', false, 'account-a');
    await getFeatureFlag('toggle', false, 'account-b');
    await getFeatureFlag('toggle', false);
    expect(getValueAsync.mock.calls).toEqual([
      ['toggle', false, { identifier: 'account-a' }],
      ['toggle', false, { identifier: 'account-b' }],
      ['toggle', false, undefined],
    ]);
  });

  it('returns the default when evaluation rejects', async () => {
    const { getFeatureFlag } = await import('../mobile/featureFlags/client');
    getValueAsync.mockRejectedValue(new Error('Unavailable'));
    expect(await getFeatureFlag('toggle', false)).toBe(false);
  });

  it('survives an invalid SDK key without logging the key or repeatedly initializing', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    getClient.mockImplementation(() => { throw new Error('Invalid test-sdk-key'); });
    const { getFeatureFlag } = await import('../mobile/featureFlags/client');
    expect(await getFeatureFlag('toggle', false)).toBe(false);
    expect(await getFeatureFlag('toggle', true)).toBe(true);
    expect(getClient).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      'ConfigCat could not initialize. Feature flags will use their defaults.',
    );
    warning.mockRestore();
  });
});
