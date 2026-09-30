import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { endAnthropicSpan } from './tracing.ts';

const fakeSpan = () => {
  const logged: unknown[] = [];
  let ended = false;
  const span = { log: (event: unknown) => logged.push(event), end: () => { ended = true; } } as any;
  return { span, logged, ended: () => ended };
};

Deno.test('spans record why a generation ended and how its tokens were spent', async () => {
  const { span, logged, ended } = fakeSpan();
  const usage = {
    input_tokens: 13426, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    output_tokens_details: { thinking_tokens: 800 },
  };
  await endAnthropicSpan(span, '', { stop_reason: 'max_tokens', usage });
  assertEquals(logged, [{
    output: '',
    metadata: { stop_reason: 'max_tokens', usage },
    metrics: {
      prompt_tokens: 13426, completion_tokens: 800, tokens: 14226,
      prompt_cached_tokens: 0, prompt_cache_creation_tokens: 0, completion_reasoning_tokens: 800,
    },
  }]);
  assertEquals(ended(), true);
});

Deno.test('spans without a provider response log no invented metrics', async () => {
  const { span, logged } = fakeSpan();
  await endAnthropicSpan(span, null);
  assertEquals(logged, [{ output: null, metadata: { stop_reason: null, usage: null }, metrics: {} }]);
});
