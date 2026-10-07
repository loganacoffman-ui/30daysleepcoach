export function adminAuthOptions(storage) {
  return {
    storageKey: 'sleepcoach-admin-session', storage, persistSession: true,
    flowType: 'pkce', detectSessionInUrl: false,
  };
}

export async function signInAdminWithGoogle(auth, origin) {
  const { error } = await auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: new URL('/admin/', origin).href,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw new Error('Google sign-in could not start. Please try again or contact the administrator.');
}

// Authentication is only the first step. The provided authorize function must
// complete the server's current-role/session check before the workspace opens.
export async function restoreAdminSession(auth, href, replaceUrl, authorize) {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const code = url.searchParams.get('code');
  const oauthError = url.searchParams.has('error') || url.searchParams.has('error_code')
    || hash.has('error') || hash.has('error_code');
  const implicitToken = hash.has('access_token') || hash.has('refresh_token');
  const callback = url.searchParams.has('code') || oauthError || implicitToken;
  if (callback) {
    // Remove credentials/errors before awaiting any network calls. Never display
    // the provider's untrusted error_description or leave codes in history.
    replaceUrl('/admin/');
  }
  try {
    if (oauthError) throw new Error('Google sign-in was cancelled or could not finish. Please try again.');
    if (implicitToken || (url.searchParams.has('code') && !code)) throw new Error('Please start Google sign-in again from this admin page.');
    if (code) {
      const { error } = await auth.exchangeCodeForSession(code);
      if (error) throw new Error('Google sign-in expired or could not be verified. Please try again in the same browser tab.');
    }
    const { data, error } = await auth.getSession();
    if (error) throw new Error('Your admin session could not be restored. Please sign in again.');
    if (!data.session) {
      if (callback) throw new Error('Google sign-in did not return a session. Please try again.');
      return false;
    }
    await authorize();
    return true;
  } catch (error) {
    // Only the separate admin session is revoked, never the regular app session.
    await auth.signOut({ scope: 'local' });
    throw error;
  }
}
