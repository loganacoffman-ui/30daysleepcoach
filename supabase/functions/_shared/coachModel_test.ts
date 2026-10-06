import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { DEFAULT_COACH_MODEL, resolveCoachModel, SONNET_5_5_MODEL, SONNET_5_FLAG_KEY } from './coachModel.ts';

const user = { id: 'user-1', email: 'sleeper@example.com' };

Deno.test('coach model follows the useSonnet5 flag for the requesting user', async () => {
  const seen: unknown[] = [];
  const flags = (value: boolean) => () => ({
    getValueAsync: (key: string, fallback: unknown, flagUser?: unknown) => {
      seen.push([key, fallback, flagUser]);
      return Promise.resolve(value);
    },
  }) as any;
  assertEquals(await resolveCoachModel(user, flags(true)), SONNET_5_5_MODEL);
  assertEquals(await resolveCoachModel(user, flags(false)), DEFAULT_COACH_MODEL);
  assertEquals(seen[0], [SONNET_5_FLAG_KEY, false, { identifier: 'user-1', email: 'sleeper@example.com' }]);
});

Deno.test('coach model falls back to the default without ConfigCat or when evaluation fails', async () => {
  assertEquals(await resolveCoachModel(user, () => null), DEFAULT_COACH_MODEL);
  const failing = () => ({ getValueAsync: () => Promise.reject(new Error('offline')) }) as any;
  assertEquals(await resolveCoachModel(user, failing), DEFAULT_COACH_MODEL);
});
