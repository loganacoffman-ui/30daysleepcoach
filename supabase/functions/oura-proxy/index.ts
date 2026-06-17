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

const ALLOWED_ENDPOINTS = new Set([
  'daily_stress',
  'daily_sleep',
  'sleep',
  'heartrate',
]);

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  try {
    const { endpoint, start_date, end_date, oura_token } = await req.json();

    if (!ALLOWED_ENDPOINTS.has(endpoint)) {
      return jsonResponse(req, { error: 'Unsupported Oura endpoint' }, 400);
    }

    if (!start_date || !end_date) {
      return jsonResponse(req, { error: 'Missing endpoint date range' }, 400);
    }

    const accessToken = oura_token || await getOAuthAccessToken(req);
    if (!accessToken) {
      return jsonResponse(req, { error: 'No Oura connection found' }, 401);
    }

    const url = new URL(`https://api.ouraring.com/v2/usercollection/${endpoint}`);
    url.searchParams.set('start_date', start_date);
    url.searchParams.set('end_date', end_date);

    const ouraRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const body = await ouraRes.text();

    return new Response(body, {
      status: ouraRes.status,
      headers: {
        ...corsHeaders,
        'Content-Type': ouraRes.headers.get('content-type') || 'application/json',
      },
    });
  } catch (error) {
    return jsonResponse(req, { error: error instanceof Error ? error.message : 'Unknown Oura proxy error' }, 500);
  }
});

async function getOAuthAccessToken(req: Request) {
  const supabaseUrl = mustEnv('SUPABASE_URL');
  const serviceRoleKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt || jwt.startsWith('sb_publishable_')) return null;

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData.user) return null;

  const { data: connection, error: connectionError } = await supabase
    .from('oura_connections')
    .select('*')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (connectionError || !connection) return null;

  const expiresAt = new Date(connection.expires_at).getTime();
  if (expiresAt > Date.now() + 2 * 60 * 1000) {
    return connection.access_token;
  }

  return refreshConnection(supabase, connection);
}

async function refreshConnection(supabase: ReturnType<typeof createClient>, connection: Record<string, string>) {
  const clientId = mustEnv('OURA_CLIENT_ID');
  const clientSecret = mustEnv('OURA_CLIENT_SECRET');
  const tokenBody = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: connection.refresh_token,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const tokenRes = await fetch('https://api.ouraring.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  });

  if (!tokenRes.ok) {
    throw new Error(`Oura refresh failed: ${tokenRes.status}`);
  }

  const tokenJson = await tokenRes.json();
  const expiresIn = Number(tokenJson.expires_in || 0);
  const expiresAt = new Date(Date.now() + Math.max(0, expiresIn - 60) * 1000).toISOString();

  const { error } = await supabase
    .from('oura_connections')
    .update({
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token,
      token_type: tokenJson.token_type || 'bearer',
      scope: tokenJson.scope || connection.scope || null,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', connection.user_id);

  if (error) throw new Error(`Oura refresh save failed: ${error.message}`);

  return tokenJson.access_token;
}

function mustEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function jsonResponse(req: Request, body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(req),
      'Content-Type': 'application/json',
    },
  });
}
