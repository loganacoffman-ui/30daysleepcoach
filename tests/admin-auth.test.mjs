import { describe, it, expect, vi } from 'vitest';
import { adminAuthOptions, signInAdminWithGoogle, restoreAdminSession } from '../admin/auth.mjs';
function setup() {
  const auth = {
    signInWithOAuth: vi.fn(async () => ({ error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ error: null })),
    getSession: vi.fn(async () => ({ data: { session: { access_token: 'test-session' } }, error: null })),
    signOut: vi.fn(async () => ({})),
  };
  const authorize = vi.fn(async () => {});
  const replace = vi.fn();
  const restore = href => restoreAdminSession(auth, href, replace, authorize);
  return { auth, authorize, replace, restore };
}
describe('admin Google sign-in', () => {
  it('uses isolated storage with a PKCE verifier and explicit callback handling', () => {
    const storage = {};
    expect(adminAuthOptions(storage)).toEqual({ storageKey: 'sleepcoach-admin-session', storage, persistSession: true, flowType: 'pkce', detectSessionInUrl: false });
  });
  it('uses Google and a fixed same-origin admin callback with account selection', async () => {
    const h = setup();
    await signInAdminWithGoogle(h.auth, 'https://30daysleepcoach.com');
    expect(h.auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'https://30daysleepcoach.com/admin/', queryParams: { prompt: 'select_account' } } });
  });
  it('handles provider startup failure', async () => {
    const h = setup(); h.auth.signInWithOAuth.mockResolvedValue({ error: { message: 'raw provider failure' } });
    await expect(signInAdminWithGoogle(h.auth, 'http://localhost:8000')).rejects.toThrow('could not start');
  });
  it('cleans the callback URL before exchange and requires server authorization', async () => {
    const h = setup();
    expect(await h.restore('https://30daysleepcoach.com/admin/?code=one-time-code&next=https://untrusted.test')).toBe(true);
    expect(h.replace).toHaveBeenCalledWith('/admin/');
    expect(h.auth.exchangeCodeForSession).toHaveBeenCalledWith('one-time-code');
    expect(h.replace.mock.invocationCallOrder[0]).toBeLessThan(h.auth.exchangeCodeForSession.mock.invocationCallOrder[0]);
    expect(h.authorize).toHaveBeenCalledOnce();
  });
  it('rejects Google users without the admin role and clears only their admin session', async () => {
    const h = setup(); h.authorize.mockRejectedValue(new Error('This account does not have admin access.'));
    await expect(h.restore('https://30daysleepcoach.com/admin/?code=normal-user-code')).rejects.toThrow('does not have admin access');
    expect(h.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('rejects failed or expired exchanges before requesting inventory', async () => {
    const h = setup(); h.auth.exchangeCodeForSession.mockResolvedValue({ error: { message: 'missing verifier' } });
    await expect(h.restore('https://30daysleepcoach.com/admin/?code=expired')).rejects.toThrow('could not be verified');
    expect(h.authorize).not.toHaveBeenCalled();
  });
  it.each(['?error=access_denied&error_description=untrusted', '#error=access_denied', '#access_token=legacy&refresh_token=secret', '?code='])('rejects invalid callback %s and strips it from history', async suffix => {
    const h = setup();
    await expect(h.restore(`https://30daysleepcoach.com/admin/${suffix}`)).rejects.toThrow();
    expect(h.replace).toHaveBeenCalledWith('/admin/');
    expect(h.authorize).not.toHaveBeenCalled();
    expect(h.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it('reauthorizes returning sessions and leaves signed-out visitors at login', async () => {
    const h = setup();
    expect(await h.restore('https://30daysleepcoach.com/admin/')).toBe(true);
    expect(h.authorize).toHaveBeenCalledOnce();
    h.authorize.mockClear(); h.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    expect(await h.restore('https://30daysleepcoach.com/admin/')).toBe(false);
    expect(h.authorize).not.toHaveBeenCalled();
    expect(h.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
