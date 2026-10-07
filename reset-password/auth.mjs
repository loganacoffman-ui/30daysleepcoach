export const recoveryAuthOptions = {
  storageKey: 'sleepcoach-password-recovery',
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};

export const invalidLinkMessage = 'This reset link is invalid or has expired. Request a new link below.';

// Keep the email token in memory only and remove it from browser history.
export function readRecoveryLink(href, replaceUrl) {
  const url = new URL(href);
  if (!url.hash && !url.search) return null;
  replaceUrl(url.pathname);
  const params = new URLSearchParams(url.hash.slice(1));
  const token = params.get('token_hash');
  if (url.search || params.get('type') !== 'recovery' || !token || params.has('error')) {
    throw new Error(invalidLinkMessage);
  }
  return token;
}

export async function requestReset(auth, email, origin) {
  const { error } = await auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${origin}/reset-password/`,
  });
  if (error) {
    if (error.status === 429) throw new Error('Please wait a minute before requesting another link.');
    throw new Error('We couldn’t send the reset link. Please try again shortly.');
  }
}

export function createPasswordRecovery(auth, token) {
  let verified = false;
  let finished = false;
  let busy = false;
  return async function savePassword(password, confirmation) {
    if (busy) throw new Error('Your password is already being updated.');
    if (finished || !token) throw new Error(invalidLinkMessage);
    if (password.length < 8) throw new Error('Use at least 8 characters for your new password.');
    if (password !== confirmation) throw new Error('Your passwords don’t match. Please try again.');
    busy = true;
    try {
      // Redeem only on submission so email link previews do not consume the token.
      if (!verified) {
        const { data, error } = await auth.verifyOtp({ token_hash: token, type: 'recovery' });
        if (error || !data?.session) {
          if (error?.status >= 500 || error?.name === 'AuthRetryableFetchError') {
            throw new Error('Couldn’t verify the link. Check your connection and try again.');
          }
          throw new Error(invalidLinkMessage);
        }
        verified = true;
      }
      const { error } = await auth.updateUser({ password });
      if (error) {
        if (error.code === 'same_password') throw new Error('Choose a password different from your current password.');
        if (error.code === 'weak_password') throw new Error('Choose a stronger password. Try a longer, unique passphrase with mixed characters.');
        if (error.status === 401 || error.code === 'session_not_found' || error.code === 'session_expired') {
          throw new Error(invalidLinkMessage);
        }
        throw new Error('Couldn’t save your password. Please try again.');
      }
      finished = true;
      // Only end this isolated recovery session; no app session is stored here.
      try { await auth.signOut({ scope: 'local' }); } catch { /* Password already saved. */ }
    } finally {
      busy = false;
    }
  };
}
