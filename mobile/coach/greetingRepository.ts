import { supabase } from '../supabase';
import { screenCache } from '../cache/screenCache';
import { createAsyncMemo } from '../cache/asyncMemo';

type Greeting = { text: string; fingerprint: string; expires_at: string };
const memo = createAsyncMemo<Greeting | null>(5 * 60_000);
const revisions = new Map<string, number>();
export const invalidateGreeting = (userId: string) => {
  revisions.set(userId, (revisions.get(userId) ?? 0) + 1);
  memo.invalidate(`${userId}:`);
};

// Separate from home loading: timeout/failure leaves ordinary home copy intact.
export async function loadContextGreeting(userId: string): Promise<Greeting | null> {
  const revision = revisions.get(userId) ?? 0;
  const result = await memo.run(`${userId}:greeting`, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    try {
      const { data, error } = await supabase.functions.invoke('sleep-coach', {
        body: { mode: 'coach_greeting' }, signal: controller.signal,
      });
      const greeting = data?.greeting;
      if (error || data?.user_id !== userId || !greeting || typeof greeting.text !== 'string' || greeting.text.length > 220
        || typeof greeting.fingerprint !== 'string' || Date.parse(greeting.expires_at) <= Date.now()
        || !Number.isFinite(Date.parse(greeting.expires_at))) return null;
      return greeting as Greeting;
    } catch { return null; }
    finally { clearTimeout(timeout); }
  });
  return revision === (revisions.get(userId) ?? 0) && result && Date.parse(result.expires_at) > Date.now() ? result : null;
}

let claimQueue: Promise<unknown> = Promise.resolve();
export async function claimContextGreeting(userId: string, fingerprint: string, date: string): Promise<boolean> {
  const claim = claimQueue.then(async () => {
  const prior = await screenCache.read<{ date: string; fingerprint: string }>(userId, 'greeting-seen', 1);
  if (prior?.value.date === date && prior.value.fingerprint === fingerprint) return false;
  await screenCache.write(userId, 'greeting-seen', 1, { date, fingerprint });
  return true;
  });
  claimQueue = claim.catch(() => undefined);
  return claim;
}
