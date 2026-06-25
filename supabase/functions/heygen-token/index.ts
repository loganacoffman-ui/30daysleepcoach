import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = ['https://30daysleepcoach.com', 'https://www.30daysleepcoach.com', 'http://localhost:8000'];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const matched = ALLOWED_ORIGINS.find(o => origin === o || origin.endsWith('.netlify.app'));
  const allowOrigin = matched ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });
}

function mustEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = mustEnv('SUPABASE_URL');
    const serviceRoleKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY');
    const heygenApiKey = mustEnv('HEYGEN_API_KEY');

    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return jsonResponse(req, { error: 'Missing authorization' }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData.user) return jsonResponse(req, { error: 'Invalid token' }, 401);

    // Parse optional avatar_id from request body
    let reqAvatarId: string | undefined;
    try {
      const body = await req.json();
      reqAvatarId = body?.avatar_id;
    } catch { /* no body or invalid JSON — use defaults */ }

    // Public sandbox avatar from LiveAvatar docs — used when no custom avatar is configured
    const SANDBOX_AVATAR_ID = '65f9e3c9-d48b-4118-b73a-4ae2e3cbb8f0';
    const avatarId = reqAvatarId || Deno.env.get('LIVEAVATAR_AVATAR_ID') || SANDBOX_AVATAR_ID;
    const isSandbox = avatarId === SANDBOX_AVATAR_ID;

    const sessionBody: Record<string, unknown> = {
      mode: 'LITE',
      avatar_id: avatarId,
      is_sandbox: isSandbox,
    };

    const tokenRes = await fetch('https://api.liveavatar.com/v1/sessions/token', {
      method: 'POST',
      headers: {
        'X-API-KEY': heygenApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sessionBody),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '');
      return jsonResponse(req, { error: 'LiveAvatar token creation failed: ' + tokenRes.status, detail: errText }, 502);
    }

    const tokenData = await tokenRes.json();
    const sessionToken = tokenData.data?.session_token || '';
    const sessionId = tokenData.data?.session_id || '';
    return jsonResponse(req, { token: sessionToken, session_id: sessionId });
  } catch (error) {
    return jsonResponse(req, { error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
