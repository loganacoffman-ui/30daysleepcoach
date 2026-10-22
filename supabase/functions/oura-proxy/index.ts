import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifiedUser } from '../_shared/auth.ts';
import { fetchOura } from '../_shared/oura.ts';
import { requestTiming } from '../_shared/performance.ts';

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  const timing = requestTiming('oura-proxy');
  try {
    const { endpoint, start_date, end_date, oura_token } = await req.json();
    const personalToken = typeof oura_token === 'string' && oura_token ? oura_token : undefined;
    // Preserve the web client's personal-token path. It never reads stored OAuth
    // credentials or the user cache; Oura authenticates the supplied token.
    if (personalToken) {
      const result = await timing.measure('oura', () => fetchOura(null, '', endpoint, start_date, end_date, personalToken));
      timing.finish(String(result.status));
      return jsonResponse(req, result.body, result.status);
    }
    const user = await timing.measure('auth', () => verifiedUser(req));
    if (!user) return jsonResponse(req, { error: 'Authentication required' }, 401);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await timing.measure('oura', () => fetchOura(admin, user.id, endpoint, start_date, end_date));
    timing.finish(String(result.status));
    return jsonResponse(req, result.body, result.status);
  } catch {
    timing.finish('error');
    return jsonResponse(req, { error: 'Oura is temporarily unavailable' }, 502);
  }
});

function jsonResponse(req: Request, body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });
}
