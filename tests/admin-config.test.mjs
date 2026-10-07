import { afterEach, describe, expect, it, vi } from 'vitest';
import adminConfig from '../netlify/functions/admin-config.mjs';
import { loadAdminConfig } from '../admin/config.mjs';
afterEach(() => vi.unstubAllEnvs());
const configure = key => {
  vi.stubEnv('SUPABASE_URL', 'https://test-project.supabase.co');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', key);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'must-not-be-returned');
};
describe('public admin configuration', () => {
  it('serves only the configured public values', async () => {
    configure('sb_publishable_test_value');
    const response = adminConfig(new Request('https://app.test/.netlify/functions/admin-config'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ url: 'https://test-project.supabase.co', publishableKey: 'sb_publishable_test_value' });
  });
  it.each(['sb_secret_private', 'eyJ-service-role-jwt', ''])('fails closed for non-publishable key %s', async key => {
    configure(key);
    const response = adminConfig(new Request('https://app.test'));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('must-not-be-returned');
  });
  it('rejects insecure URLs and non-read requests', () => {
    configure('sb_publishable_test');
    vi.stubEnv('SUPABASE_URL', 'http://insecure.test');
    expect(adminConfig(new Request('https://app.test')).status).toBe(503);
    expect(adminConfig(new Request('https://app.test', { method: 'POST' })).status).toBe(405);
  });
  it('loads config from a same-origin endpoint without a hardcoded fallback', async () => {
    const fetcher = vi.fn(async () => Response.json({ url: 'https://test-project.supabase.co', publishableKey: 'sb_publishable_test' }));
    expect(await loadAdminConfig(fetcher)).toEqual({ url: 'https://test-project.supabase.co', publishableKey: 'sb_publishable_test' });
    expect(fetcher).toHaveBeenCalledWith('/.netlify/functions/admin-config', { cache: 'no-store' });
  });
  it.each([new Response('', { status: 503 }), new Response('<html>'), Response.json({ url: 'https://project.supabase.co', publishableKey: 'sb_secret_private' })])('handles unavailable or unsafe config', async response => {
    await expect(loadAdminConfig(async () => response)).rejects.toThrow('configuration is unavailable');
  });
});
