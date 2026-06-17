import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = ['https://30daysleepcoach.com', 'https://www.30daysleepcoach.com', 'http://localhost:8000'];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = mustEnv('SUPABASE_URL');
    const serviceRoleKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY');
    const clientId = mustEnv('OURA_CLIENT_ID');
    const redirectUri = Deno.env.get('OURA_REDIRECT_URI') || `${supabaseUrl}/functions/v1/oura-oauth-callback`;

    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return jsonResponse(req, { error: 'Missing Supabase session' }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData.user) return jsonResponse(req, { error: 'Invalid Supabase session' }, 401);

    const { redirect_to } = await req.json().catch(() => ({}));
    const redirectTo = sanitizeRedirect(redirect_to);
    const state = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: insertError } = await supabase
      .from('oura_oauth_states')
      .insert({
        state,
        user_id: userData.user.id,
        redirect_to: redirectTo,
        expires_at: expiresAt,
      });

    if (insertError) return jsonResponse(req, { error: insertError.message }, 500);

    const authorizeUrl = new URL('https://cloud.ouraring.com/oauth/authorize');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', state);

    return jsonResponse(req, { authorizeUrl: authorizeUrl.toString() });
  } catch (error) {
    return jsonResponse(req, { error: error instanceof Error ? error.message : 'Unknown Oura OAuth start error' }, 500);
  }
});

function sanitizeRedirect(value: unknown) {
  const fallback = 'https://30daysleepcoach.com/';
  if (typeof value !== 'string') return fallback;

  try {
    const url = new URL(value);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '30daysleepcoach.com' || url.hostname.endsWith('.netlify.app')) {
      return url.toString();
    }
  } catch (_error) {
    return fallback;
  }

  return fallback;
}

function mustEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(req),
      'Content-Type': 'application/json',
    },
  });
}
