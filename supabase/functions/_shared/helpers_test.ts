import {
  assertEquals,
  assertThrows,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  sanitizeRedirect,
  redirectWithStatus,
  jsonResponse,
  ALLOWED_ENDPOINTS,
} from './helpers.ts';

// ── sanitizeRedirect ────────────────────────────────

Deno.test('sanitizeRedirect: returns fallback for non-string input', () => {
  assertEquals(sanitizeRedirect(null), 'https://30daysleepcoach.com/');
  assertEquals(sanitizeRedirect(undefined), 'https://30daysleepcoach.com/');
  assertEquals(sanitizeRedirect(42), 'https://30daysleepcoach.com/');
  assertEquals(sanitizeRedirect({}), 'https://30daysleepcoach.com/');
});

Deno.test('sanitizeRedirect: returns fallback for invalid URL string', () => {
  assertEquals(sanitizeRedirect('not-a-url'), 'https://30daysleepcoach.com/');
});

Deno.test('sanitizeRedirect: allows 30daysleepcoach.com', () => {
  assertEquals(
    sanitizeRedirect('https://30daysleepcoach.com/dashboard'),
    'https://30daysleepcoach.com/dashboard',
  );
});

Deno.test('sanitizeRedirect: allows localhost', () => {
  assertEquals(
    sanitizeRedirect('http://localhost:8000/'),
    'http://localhost:8000/',
  );
});

Deno.test('sanitizeRedirect: allows 127.0.0.1', () => {
  assertEquals(
    sanitizeRedirect('http://127.0.0.1:3000/'),
    'http://127.0.0.1:3000/',
  );
});

Deno.test('sanitizeRedirect: allows *.netlify.app', () => {
  assertEquals(
    sanitizeRedirect('https://my-preview--30day.netlify.app/'),
    'https://my-preview--30day.netlify.app/',
  );
});

Deno.test('sanitizeRedirect: rejects arbitrary domains', () => {
  assertEquals(sanitizeRedirect('https://evil.com/steal'), 'https://30daysleepcoach.com/');
  assertEquals(sanitizeRedirect('https://google.com'), 'https://30daysleepcoach.com/');
});

Deno.test('sanitizeRedirect: rejects javascript: protocol', () => {
  assertEquals(sanitizeRedirect('javascript:alert(1)'), 'https://30daysleepcoach.com/');
});

// ── redirectWithStatus ──────────────────────────────

Deno.test('redirectWithStatus: builds redirect with query param', () => {
  const res = redirectWithStatus('https://30daysleepcoach.com/', 'oura', 'connected');
  assertEquals(res.status, 302);
  const location = res.headers.get('location');
  assertEquals(location, 'https://30daysleepcoach.com/?oura=connected');
});

Deno.test('redirectWithStatus: preserves existing query params', () => {
  const res = redirectWithStatus('https://30daysleepcoach.com/?foo=bar', 'key', 'val');
  const location = res.headers.get('location');
  assertEquals(location, 'https://30daysleepcoach.com/?foo=bar&key=val');
});

// ── jsonResponse ────────────────────────────────────

Deno.test('jsonResponse: returns JSON with correct status and CORS', async () => {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  const res = jsonResponse({ ok: true }, 200, cors);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Content-Type'), 'application/json');
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  const body = await res.json();
  assertEquals(body, { ok: true });
});

Deno.test('jsonResponse: sets custom status', async () => {
  const res = jsonResponse({ error: 'not found' }, 404, {});
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, 'not found');
});

// ── ALLOWED_ENDPOINTS ───────────────────────────────

Deno.test('ALLOWED_ENDPOINTS contains expected values', () => {
  assertEquals(ALLOWED_ENDPOINTS.has('daily_stress'), true);
  assertEquals(ALLOWED_ENDPOINTS.has('daily_sleep'), true);
  assertEquals(ALLOWED_ENDPOINTS.has('sleep'), true);
  assertEquals(ALLOWED_ENDPOINTS.has('heartrate'), true);
});

Deno.test('ALLOWED_ENDPOINTS rejects unknown endpoints', () => {
  assertEquals(ALLOWED_ENDPOINTS.has('daily_activity'), false);
  assertEquals(ALLOWED_ENDPOINTS.has('workout'), false);
  assertEquals(ALLOWED_ENDPOINTS.has(''), false);
});
