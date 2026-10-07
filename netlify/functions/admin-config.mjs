// Public browser configuration only. Never return a service-role/secret key or
// serialize the environment; these two explicitly selected values are public.
export default function adminConfig(request) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), { status: 405, headers: { ...headers, Allow: 'GET' } });
  }
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    const url = new URL(process.env.SUPABASE_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey ?? '')) throw new Error('Invalid public config');
    return new Response(JSON.stringify({ url: url.origin, publishableKey }), { headers });
  } catch {
    return new Response(JSON.stringify({ error: 'Admin sign-in is not configured. Set the public Supabase environment variables in Netlify.' }), { status: 503, headers });
  }
}
