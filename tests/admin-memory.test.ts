import { describe, expect, it, vi } from 'vitest';
import { Mem0MemoryProvider } from '../supabase/functions/_shared/memory';

describe('synthetic Mem0 writes', () => {
  it('uses the real user scope, skips inference, and returns the asynchronous receipt', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _request?: RequestInit) => new Response(JSON.stringify({ event_id: 'evt-1', status: 'PENDING' })));
    const provider = new Mem0MemoryProvider('key', 'https://mem0.test', fetcher);
    expect(await provider.seedFacts('verified-user', ['I prefer reading.', 'I stop coffee at noon.'], { synthetic: true })).toEqual({ eventId: 'evt-1' });
    expect(fetcher.mock.calls[0][0]).toBe('https://mem0.test/v3/memories/add/');
    const request = fetcher.mock.calls[0][1]!;
    expect(JSON.parse(String(request.body))).toEqual({ user_id: 'verified-user', infer: false, messages: [{ role: 'user', content: 'I prefer reading.' }, { role: 'user', content: 'I stop coffee at noon.' }], metadata: { synthetic: true } });
    expect(new Headers(request.headers).get('Authorization')).toBe('Token key');
  });
  it('rejects a missing receipt or an explicitly failed event', async () => {
    for (const payload of [{}, { event_id: 'evt-1', status: 'FAILED' }]) {
      const provider = new Mem0MemoryProvider('key', 'https://mem0.test', async () => new Response(JSON.stringify(payload)));
      await expect(provider.seedFacts('verified-user', ['Fact'], {})).rejects.toThrow('did not acknowledge');
    }
  });
  it('propagates provider rejection instead of reporting a successful seed', async () => {
    const provider = new Mem0MemoryProvider('key', 'https://mem0.test', async () => new Response('unavailable', { status: 503 }));
    await expect(provider.seedFacts('verified-user', ['Fact'], {})).rejects.toThrow('503');
  });
});
