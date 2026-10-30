import { afterEach, expect, it, vi } from 'vitest';
import { coachStreamDeadline } from '../supabase/functions/_shared/coachStreamDeadline';

afterEach(() => vi.useRealTimers());

it.each(['dispose', 'cancel', 'timeout', 'caller'] as const)(
  'removes the caller listener and timers on %s', (finish) => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const add = vi.spyOn(caller.signal, 'addEventListener');
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const deadline = coachStreamDeadline(caller.signal);
    const listener = add.mock.calls[0][1];
    if (finish === 'timeout') vi.advanceTimersByTime(20_000);
    else if (finish === 'caller') caller.abort();
    else deadline[finish]();
    expect(remove).toHaveBeenCalledWith('abort', listener);
    expect(vi.getTimerCount()).toBe(0);
    expect(deadline.signal.aborted).toBe(finish !== 'dispose');
    if (finish === 'dispose') {
      caller.abort();
      expect(deadline.signal.aborted).toBe(false);
    }
  },
);

it('propagates an already aborted caller without retaining timers or listeners', () => {
  vi.useFakeTimers();
  const caller = new AbortController();
  caller.abort();
  const add = vi.spyOn(caller.signal, 'addEventListener');
  const deadline = coachStreamDeadline(caller.signal);
  expect(deadline.signal.reason).toBe(caller.signal.reason);
  expect(add).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
