import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { anthropicHttpErrorFields } from './sleepCoachLog.ts';

Deno.test('anthropicHttpErrorFields parses provider error JSON', async () => {
  const response = new Response(JSON.stringify({
    error: { type: 'invalid_request_error', message: 'model: claude-sonnet-5-5' },
  }), { status: 400, headers: { 'request-id': 'req_test' } });
  assertEquals(await anthropicHttpErrorFields(response), {
    http_status: 400,
    provider_request_id: 'req_test',
    provider_error_type: 'invalid_request_error',
    provider_error_message: 'model: claude-sonnet-5-5',
    response_preview: '{"error":{"type":"invalid_request_error","message":"model: claude-sonnet-5-5"}}',
  });
});
