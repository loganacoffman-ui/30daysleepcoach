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
    const elevenLabsKey = mustEnv('ELEVENLABS_API_KEY');

    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return jsonResponse(req, { error: 'Missing authorization' }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData.user) return jsonResponse(req, { error: 'Invalid token' }, 401);

    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return jsonResponse(req, { error: 'Expected multipart/form-data' }, 400);
    }

    const formData = await req.formData();
    const audioFile = formData.get('audio');
    if (!audioFile || !(audioFile instanceof File)) {
      return jsonResponse(req, { error: 'Missing audio file' }, 400);
    }

    const elevenLabsForm = new FormData();
    elevenLabsForm.append('file', audioFile, audioFile.name || 'recording.webm');
    elevenLabsForm.append('model_id', 'scribe_v1');

    const transcribeRes = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': elevenLabsKey },
      body: elevenLabsForm,
    });

    if (!transcribeRes.ok) {
      const errText = await transcribeRes.text().catch(() => '');
      return jsonResponse(req, { error: 'Transcription failed: ' + transcribeRes.status, detail: errText }, 502);
    }

    const result = await transcribeRes.json();
    return jsonResponse(req, { transcript: result.text ?? '' });
  } catch (error) {
    return jsonResponse(req, { error: error instanceof Error ? error.message : 'Unknown transcription error' }, 500);
  }
});

function mustEnv(name: string): string {
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
