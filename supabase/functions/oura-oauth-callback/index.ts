import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const fallbackRedirect = 'https://30daysleepcoach.com/';
  let redirectTo = fallbackRedirect;

  try {
    const supabaseUrl = mustEnv('SUPABASE_URL');
    const serviceRoleKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY');
    const clientId = mustEnv('OURA_CLIENT_ID');
    const clientSecret = mustEnv('OURA_CLIENT_SECRET');
    const redirectUri = Deno.env.get('OURA_REDIRECT_URI') || `${supabaseUrl}/functions/v1/oura-oauth-callback`;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const url = new URL(req.url);
    const state = url.searchParams.get('state') || '';

    const stateResult = await supabase
      .from('oura_oauth_states')
      .select('*')
      .eq('state', state)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (stateResult.error || !stateResult.data) {
      return redirectWithStatus(fallbackRedirect, 'oura_error', 'invalid_state');
    }

    redirectTo = stateResult.data.redirect_to;
    await supabase.from('oura_oauth_states').delete().eq('state', state);

    const deniedError = url.searchParams.get('error');
    if (deniedError) {
      return redirectWithStatus(redirectTo, 'oura_error', deniedError);
    }

    const code = url.searchParams.get('code');
    if (!code) {
      return redirectWithStatus(redirectTo, 'oura_error', 'missing_code');
    }

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const tokenRes = await fetch('https://api.ouraring.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    });

    if (!tokenRes.ok) {
      return redirectWithStatus(redirectTo, 'oura_error', `token_exchange_${tokenRes.status}`);
    }

    const tokenJson = await tokenRes.json();
    const expiresIn = Number(tokenJson.expires_in || 0);
    const expiresAt = new Date(Date.now() + Math.max(0, expiresIn - 60) * 1000).toISOString();

    const { error: upsertError } = await supabase
      .from('oura_connections')
      .upsert({
        user_id: stateResult.data.user_id,
        access_token: tokenJson.access_token,
        refresh_token: tokenJson.refresh_token,
        token_type: tokenJson.token_type || 'bearer',
        scope: tokenJson.scope || url.searchParams.get('scope') || null,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (upsertError) {
      return redirectWithStatus(redirectTo, 'oura_error', 'connection_save_failed');
    }

    return redirectWithStatus(redirectTo, 'oura', 'connected');
  } catch (error) {
    console.error('Oura OAuth callback error:', error);
    return redirectWithStatus(redirectTo, 'oura_error', 'server_error');
  }
});

function redirectWithStatus(redirectTo: string, key: string, value: string) {
  const url = new URL(redirectTo);
  url.searchParams.set(key, value);
  return Response.redirect(url.toString(), 302);
}

function mustEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
