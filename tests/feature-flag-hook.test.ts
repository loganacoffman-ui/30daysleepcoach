import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from '../mobile/node_modules/react';
import { act, create, type ReactTestRenderer } from '../mobile/node_modules/react-test-renderer';
import { useFeatureFlag } from '../mobile/featureFlags/useFeatureFlag';
import { getFeatureFlag } from '../mobile/featureFlags/client';

const { appState, remove } = vi.hoisted(() => ({
  appState: { listener: (_state: string) => {} }, remove: vi.fn(),
}));
vi.mock('../mobile/featureFlags/client', () => ({ getFeatureFlag: vi.fn() }));
vi.mock('../mobile/node_modules/react-native', () => ({
  AppState: { addEventListener: (_event: string, listener: (state: string) => void) => {
    appState.listener = listener;
    return { remove };
  } },
}));

let screen: ReactTestRenderer;
let result: { value: boolean; loading: boolean };
function Consumer({ userId }: { userId?: string }) {
  result = useFeatureFlag('toggle', false, userId);
  return null;
}

beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => screen?.unmount());
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

it('renders a default while loading and reevaluates on foreground', async () => {
  let resolve!: (value: boolean) => void;
  vi.mocked(getFeatureFlag).mockReturnValueOnce(new Promise(r => { resolve = r; }));
  await act(async () => { screen = create(createElement(Consumer, { userId: 'a' })); });
  expect(result).toEqual({ value: false, loading: true });
  await act(async () => resolve(true));
  expect(result).toEqual({ value: true, loading: false });
  vi.mocked(getFeatureFlag).mockResolvedValue(false);
  await act(async () => appState.listener('background'));
  expect(getFeatureFlag).toHaveBeenCalledTimes(1);
  await act(async () => appState.listener('active'));
  expect(result).toEqual({ value: false, loading: false });
});

it('discards pending results for an old account and clears its value on sign-out', async () => {
  let resolveOld!: (value: boolean) => void;
  let resolveSignedOut!: (value: boolean) => void;
  vi.mocked(getFeatureFlag)
    .mockReturnValueOnce(new Promise(r => { resolveOld = r; }))
    .mockResolvedValueOnce(true)
    .mockReturnValueOnce(new Promise(r => { resolveSignedOut = r; }));
  await act(async () => { screen = create(createElement(Consumer, { userId: 'a' })); });
  await act(async () => screen.update(createElement(Consumer, { userId: 'b' })));
  expect(result).toEqual({ value: true, loading: false });
  await act(async () => resolveOld(false));
  expect(result).toEqual({ value: true, loading: false });
  await act(async () => screen.update(createElement(Consumer, {})));
  expect(result).toEqual({ value: false, loading: true });
  await act(async () => resolveSignedOut(false));
  expect(result).toEqual({ value: false, loading: false });
  await act(async () => screen.unmount());
  expect(remove).toHaveBeenCalledTimes(3);
});
