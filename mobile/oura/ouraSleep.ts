import { createAsyncMemo } from '../cache/asyncMemo';
import { supabase } from '../supabase';

type OuraSleepDay = { day: string; score?: number };
const memo = createAsyncMemo<{ data?: OuraSleepDay[] }>(60_000);
const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const invalidateOuraSleep = () => memo.invalidate('');

// Home, check-in, chat context and Progress share one date window. Separate
// 1/7/14/35-day requests used to bypass both client and server request caches.
export async function loadOuraSleep(userId: string, date = dateKey(new Date())) {
  try {
    const data = await memo.run(`${userId}:${date}`, async () => {
      const start = new Date(`${date}T12:00:00`);
      start.setDate(start.getDate() - 35);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const result = await supabase.functions.invoke<{ data?: OuraSleepDay[] }>('oura-proxy', {
          body: { endpoint: 'daily_sleep', start_date: dateKey(start), end_date: date },
          signal: controller.signal,
        });
        if (result.error) throw result.error;
        return result.data ?? { data: [] };
      } finally { clearTimeout(timeout); }
    });
    return { data, error: null };
  } catch (error) {
    // Wearable outages leave manual check-in available; failed reads may retry.
    return { data: null, error };
  }
}
