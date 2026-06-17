import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = mustEnv('SUPABASE_URL');
    const serviceRoleKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY');
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return jsonResponse({ error: 'Missing Supabase session' }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData.user) return jsonResponse({ error: 'Invalid Supabase session' }, 401);

    const { data: connection } = await supabase
      .from('oura_connections')
      .select('access_token')
      .eq('user_id', userData.user.id)
      .maybeSingle();

    await supabase.from('oura_connections').delete().eq('user_id', userData.user.id);

    if (connection?.access_token) {
      try {
        const revokeUrl = new URL('https://api.ouraring.com/oauth/revoke');
        revokeUrl.searchParams.set('access_token', connection.access_token);
        await fetch(revokeUrl);
      } catch (_error) {
        // Local deletion is the important part; revocation failure should not block disconnect.
      }
    }

    return jsonResponse({ disconnected: true });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown Oura disconnect error' }, 500);
  }
});

function mustEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
