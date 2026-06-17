// Shared helpers extracted from edge functions for testability.

/** Throw if env var is missing. */
export function mustEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

/** Build a JSON Response with CORS headers. */
export function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

/** Redirect with a query-string status param. */
export function redirectWithStatus(
  redirectTo: string,
  key: string,
  value: string,
): Response {
  const url = new URL(redirectTo);
  url.searchParams.set(key, value);
  return Response.redirect(url.toString(), 302);
}

/** Validate and sanitize a redirect URL. */
export function sanitizeRedirect(value: unknown): string {
  const fallback = 'https://30daysleepcoach.com/';
  if (typeof value !== 'string') return fallback;

  try {
    const url = new URL(value);
    if (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '30daysleepcoach.com' ||
      url.hostname.endsWith('.netlify.app')
    ) {
      return url.toString();
    }
  } catch (_error) {
    return fallback;
  }

  return fallback;
}

/** Set of allowed Oura API endpoints. */
export const ALLOWED_ENDPOINTS = new Set([
  'daily_stress',
  'daily_sleep',
  'sleep',
  'heartrate',
]);
