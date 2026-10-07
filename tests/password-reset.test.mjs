import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { recoveryAuthOptions, readRecoveryLink, requestReset, createPasswordRecovery } from '../reset-password/auth.mjs';

function setup(token = 'email-token') {
  const auth = {
    verifyOtp: vi.fn(async () => ({ data: { session: { access_token: 'recovery-session' } }, error: null })),
    updateUser: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })),
  };
  return { auth, save: createPasswordRecovery(auth, token) };
}

describe('web password recovery', () => {
  it('isolates recovery from saved web/admin sessions and automatic URL sign-in', () => {
    expect(recoveryAuthOptions).toMatchObject({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sleepcoach-password-recovery' });
  });
  it('opens email links in any browser without a PKCE verifier and removes credentials from history', () => {
    const replace = vi.fn();
    expect(readRecoveryLink('https://30daysleepcoach.com/reset-password/#token_hash=email-token&type=recovery', replace)).toBe('email-token');
    expect(replace).toHaveBeenCalledWith('/reset-password/');
    expect(readRecoveryLink('https://30daysleepcoach.com/reset-password/', replace)).toBeNull();
  });
  it.each(['#token_hash=token&type=signup', '#token_hash=&type=recovery', '#error=access_denied&error_description=untrusted', '?code=pkce-code', '#access_token=token&refresh_token=token&type=recovery'])('rejects unsupported or invalid links %s', suffix => {
    const replace = vi.fn();
    expect(() => readRecoveryLink(`https://30daysleepcoach.com/reset-password/${suffix}`, replace)).toThrow('invalid or has expired');
    expect(replace).toHaveBeenCalledWith('/reset-password/');
  });
  it('sends reset requests to the current web origin and trims the email', async () => {
    const h = setup();
    await requestReset(h.auth, ' person@example.com ', 'https://30daysleepcoach.com');
    expect(h.auth.resetPasswordForEmail).toHaveBeenCalledWith('person@example.com', { redirectTo: 'https://30daysleepcoach.com/reset-password/' });
  });
  it('handles rate limits and hides provider error details', async () => {
    const h = setup();
    h.auth.resetPasswordForEmail.mockResolvedValue({ error: { status: 429 } });
    await expect(requestReset(h.auth, 'test@example.com', 'https://30daysleepcoach.com')).rejects.toThrow('wait a minute');
    h.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'provider details' } });
    await expect(requestReset(h.auth, 'test@example.com', 'https://30daysleepcoach.com')).rejects.toThrow('couldn’t send');
  });
  it('does not redeem a token on page load or for invalid input', async () => {
    const h = setup();
    expect(h.auth.verifyOtp).not.toHaveBeenCalled();
    await expect(h.save('short', 'short')).rejects.toThrow('8 characters');
    await expect(h.save('long-password', 'different-password')).rejects.toThrow('don’t match');
    expect(h.auth.verifyOtp).not.toHaveBeenCalled();
    expect(h.auth.updateUser).not.toHaveBeenCalled();
  });
  it('requires a recovery token even if the browser has another session', async () => {
    const h = setup(null);
    await expect(h.save('new-password', 'new-password')).rejects.toThrow('invalid or has expired');
    expect(h.auth.updateUser).not.toHaveBeenCalled();
  });
  it('verifies before updating and closes only the recovery session after success', async () => {
    const h = setup();
    await h.save('new-password', 'new-password');
    expect(h.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'email-token', type: 'recovery' });
    expect(h.auth.updateUser).toHaveBeenCalledWith({ password: 'new-password' });
    expect(h.auth.verifyOtp.mock.invocationCallOrder[0]).toBeLessThan(h.auth.updateUser.mock.invocationCallOrder[0]);
    expect(h.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    await expect(h.save('other-password', 'other-password')).rejects.toThrow('invalid or has expired');
    expect(h.auth.updateUser).toHaveBeenCalledOnce();
  });
  it.each([{ error: { status: 403 } }, { data: { session: null }, error: null }])('never changes passwords when verification fails', async response => {
    const h = setup();
    h.auth.verifyOtp.mockResolvedValue(response);
    await expect(h.save('new-password', 'new-password')).rejects.toThrow('invalid or has expired');
    expect(h.auth.updateUser).not.toHaveBeenCalled();
  });
  it('allows retry after network trouble without falsely expiring a token', async () => {
    const h = setup();
    h.auth.verifyOtp.mockResolvedValueOnce({ error: { name: 'AuthRetryableFetchError' } });
    await expect(h.save('new-password', 'new-password')).rejects.toThrow('Check your connection');
    await h.save('new-password', 'new-password');
    expect(h.auth.updateUser).toHaveBeenCalledOnce();
  });
  it.each([['weak_password', 'stronger password'], ['same_password', 'different from']])('retains the verified session after %s so the single-use link can be retried', async (code, message) => {
    const h = setup();
    h.auth.updateUser.mockResolvedValueOnce({ error: { code } });
    await expect(h.save('new-password', 'new-password')).rejects.toThrow(message);
    await h.save('better-password', 'better-password');
    expect(h.auth.verifyOtp).toHaveBeenCalledOnce();
    expect(h.auth.updateUser).toHaveBeenCalledTimes(2);
  });
  it('prevents concurrent token redemption and password writes', async () => {
    const h = setup();
    let finish;
    h.auth.verifyOtp.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = h.save('new-password', 'new-password');
    await expect(h.save('other-password', 'other-password')).rejects.toThrow('already being updated');
    finish({ data: { session: {} } });
    await pending;
    expect(h.auth.updateUser).toHaveBeenCalledOnce();
  });
  it('does not report a password failure when cleanup fails after it was saved', async () => {
    const h = setup();
    h.auth.signOut.mockRejectedValue(new Error('offline'));
    await expect(h.save('new-password', 'new-password')).resolves.toBeUndefined();
  });
  it('uses email button and fallback links understood by the page', () => {
    const html = readFileSync(new URL('../supabase/templates/reset-password.html', import.meta.url), 'utf8');
    const links = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    expect(links).toHaveLength(2);
    for (const link of links) {
      const rendered = link.replace('{{ .TokenHash }}', 'test-token').replaceAll('&amp;', '&');
      expect(readRecoveryLink(rendered, vi.fn())).toBe('test-token');
    }
  });
});
