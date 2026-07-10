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

// ElevenLabs "Sarah" voice — calm, warm, clear
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const supabaseUrl = mustEnv('SUPABASE_URL');
    const serviceRoleKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY');
    const elevenLabsKey = mustEnv('ELEVENLABS_API_KEY');

    // Auth check
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return jsonErr(corsHeaders, 'Missing authorization', 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData.user) return jsonErr(corsHeaders, 'Invalid token', 401);

    const body = await req.json();
    const text: string = body.text || '';
    if (!text.trim()) return jsonErr(corsHeaders, 'Missing text', 400);

    const voiceId: string = body.voice_id || DEFAULT_VOICE_ID;
    const voiceSettings = body.voice_settings || { stability: 0.45, similarity_boost: 0.8, style: 0.1 };

    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': elevenLabsKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: voiceSettings,
      }),
    });

    if (!ttsRes.ok) {
      const errText = await ttsRes.text().catch(() => '');
      return jsonErr(corsHeaders, `ElevenLabs TTS error ${ttsRes.status}: ${errText}`, 502);
    }

    // Stream the audio bytes back
    return new Response(ttsRes.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return jsonErr(corsHeaders, error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

function mustEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function jsonErr(corsHeaders: Record<string, string>, message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
