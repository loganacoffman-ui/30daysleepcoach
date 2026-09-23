import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from '../mobile/node_modules/react';
import { act, create, type ReactTestRenderer } from '../mobile/node_modules/react-test-renderer';
import TodayScreen from '../mobile/today/TodayScreen';
import { loadDailyCoaching } from '../mobile/coach/coachRepository';
import { checkinDraftStorage } from '../mobile/today/checkinDraftStorage';
import type { TodayRepository, TodaySnapshot } from '../mobile/today/types';

// Exercise the real screen state/effects with native rendering and I/O stubbed.
vi.mock('../mobile/node_modules/react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
  Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
  Platform: { OS: 'ios' }, StyleSheet: { create: (styles: unknown) => styles },
  AppState: { addEventListener: () => ({ remove: vi.fn() }) },
}));
vi.mock('../mobile/node_modules/@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => 'seen', setItem: async () => undefined },
}));
vi.mock('../mobile/cache/screenCache', () => ({
  screenCache: { read: async () => null, write: async () => undefined },
}));
vi.mock('../mobile/coach/coachRepository', () => ({ loadDailyCoaching: vi.fn() }));
vi.mock('../mobile/today/checkinReplyRepository', () => ({ interpretTypedCheckinReply: vi.fn() }));
vi.mock('../mobile/today/checkinDraftStorage', () => ({
  checkinStorageKey: (user: string, date: string) => `${user}:${date}`,
  localCheckinDate: () => '2026-09-23',
  checkinDraftStorage: { load: vi.fn(), save: async () => undefined },
}));
vi.mock('../mobile/design/Skeleton', () => ({ Skeleton: 'Skeleton', SkeletonLines: 'SkeletonLines' }));
vi.mock('../mobile/coach/ChatBubble', () => ({ default: 'ChatBubble', plainCoachText: (text: string) => text }));
vi.mock('../mobile/coach/ChatComposer', () => ({ default: 'ChatComposer' }));
vi.mock('../mobile/coach/JumpToLatest', () => ({ default: 'JumpToLatest' }));
vi.mock('../mobile/coach/useChatScroll', () => ({
  useChatScroll: () => ({ scrollProps: {}, scrollToLatest: vi.fn(), showLatest: false }),
}));

const user = { id: 'user' } as Parameters<typeof loadDailyCoaching>[0];
const profile = {} as Parameters<typeof loadDailyCoaching>[1];
const checkin = { id: 'checkin', checkinDate: '2026-09-23', morningFeeling: 'okay' as const, completedAt: '2026-09-23T16:00:23Z' };
const coaching = { pattern: 'A pattern', meaning: 'A meaning', action: 'Dim lights', why: 'Wind down', generatedAt: '2026-09-23T16:00:30Z' };
let screen: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => screen?.unmount());
  screen = undefined;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

async function openReadyCheckin(sleepData: TodaySnapshot['sleepData'], onCheckinComplete?: () => Promise<void>) {
  let snapshot: TodaySnapshot = {
    date: '2026-09-23', dayNumber: 3, checkin: null, sleepData,
    dailyCoaching: null, commitment: null, previousCommitment: null,
  };
  vi.mocked(checkinDraftStorage.load).mockResolvedValue({
    conversation: { step: 'details', morningFeeling: 'okay', turns: [{ role: 'user', content: 'A quiet evening.' }] },
    input: '', manualSleepScore: sleepData.status === 'manual' ? sleepData.score : null,
    manualSleepFallback: sleepData.status === 'manual',
    sleepReviewed: true, reviewedSleepData: sleepData,
  });
  const repository: TodayRepository = {
    loadToday: vi.fn(async () => snapshot),
    saveCheckin: vi.fn(async () => { snapshot = { ...snapshot, checkin }; return checkin; }),
    updateCommitmentStatus: vi.fn(), saveManualSleepScore: vi.fn(), clearManualSleepScore: vi.fn(),
  };
  await act(async () => {
    screen = create(createElement(TodayScreen, { user, profile, repository,
      chat: onCheckinComplete ? { onCheckinComplete, messages: [], renderMessage: () => null,
        onSend: async () => true, sending: false, disabled: false, error: '' } : undefined,
    }));
  });
  const finish = () => screen!.root.findAllByType('Pressable' as any)
    .find(button => button.findAllByType('Text' as any)
      .some(text => ['Finish check-in', 'Try finishing again'].includes(text.props.children)))!;
  return {
    repository,
    finish,
    publishReport: () => { snapshot = { ...snapshot, checkin, dailyCoaching: coaching,
      commitment: { id: 'experiment', behaviorDate: snapshot.date, behavior: coaching.action, status: 'committed' } }; },
  };
}

it.each([
  { status: 'wearable', score: 79, source: 'apple_health' },
  { status: 'manual', score: 62, source: 'manual' },
] as const)('generates once after finishing with $source sleep, without a screen reload', async sleepData => {
  const { repository, finish, publishReport } = await openReadyCheckin(sleepData);
  expect(loadDailyCoaching).not.toHaveBeenCalled();
  let finishSaving!: () => void;
  vi.mocked(repository.saveCheckin).mockImplementationOnce(() => new Promise(resolve => {
    finishSaving = () => resolve(checkin);
  }));
  let finishGenerating!: () => void;
  vi.mocked(loadDailyCoaching).mockImplementationOnce(() => new Promise(resolve => {
    finishGenerating = () => { publishReport(); resolve(coaching); };
  }));

  await act(async () => finish().props.onPress());
  expect(repository.saveCheckin).toHaveBeenCalledOnce();
  expect(loadDailyCoaching).not.toHaveBeenCalled();
  await act(async () => finishSaving());

  expect(loadDailyCoaching).toHaveBeenCalledExactlyOnceWith(user, profile, { freshSources: true });
  // Generation begins from the successful save, before any repository reload.
  expect(repository.loadToday).toHaveBeenCalledTimes(1);
  await act(async () => finishGenerating());
  expect(repository.loadToday).toHaveBeenCalledTimes(2);
  expect(loadDailyCoaching).toHaveBeenCalledTimes(1);
  expect(screen!.root.findAllByType('Text' as any).some(text =>
    typeof text.props.children === 'string' && text.props.children.includes('Tonight: Dim lights'))).toBe(true);
});

it('does not generate when saving fails, and generates after a successful retry', async () => {
  const { repository, finish, publishReport } = await openReadyCheckin({ status: 'wearable', score: 79, source: 'oura' });
  vi.mocked(repository.saveCheckin).mockRejectedValueOnce(new Error('Save unavailable'));
  vi.mocked(loadDailyCoaching).mockImplementation(async () => { publishReport(); return coaching; });
  await act(async () => finish().props.onPress());
  expect(loadDailyCoaching).not.toHaveBeenCalled();
  expect(screen!.root.findByType('ChatComposer' as any).props.error).toBe('Save unavailable');
  await act(async () => finish().props.onPress());
  expect(repository.saveCheckin).toHaveBeenCalledTimes(2);
  expect(loadDailyCoaching).toHaveBeenCalledExactlyOnceWith(user, profile, { freshSources: true });
});

it('waits for the transcript so the check-in cannot change context mid-generation', async () => {
  let finishTranscript!: () => void;
  const onCheckinComplete = vi.fn(() => new Promise<void>(resolve => { finishTranscript = resolve; }));
  const { finish, publishReport } = await openReadyCheckin({ status: 'wearable', score: 79, source: 'oura' }, onCheckinComplete);
  vi.mocked(loadDailyCoaching).mockImplementation(async () => { publishReport(); return coaching; });
  await act(async () => finish().props.onPress());
  expect(onCheckinComplete).toHaveBeenCalledOnce();
  expect(loadDailyCoaching).not.toHaveBeenCalled();
  await act(async () => finishTranscript());
  expect(loadDailyCoaching).toHaveBeenCalledOnce();
});

it('still generates from the saved check-in if its transcript fails', async () => {
  const { finish, publishReport } = await openReadyCheckin({ status: 'wearable', score: 79, source: 'oura' }, async () => { throw new Error('Transcript unavailable'); });
  vi.mocked(loadDailyCoaching).mockImplementation(async () => { publishReport(); return coaching; });
  await act(async () => finish().props.onPress());
  expect(loadDailyCoaching).toHaveBeenCalledOnce();
  expect(screen!.root.findByType('ChatComposer' as any).props.error).toBeFalsy();
});

it('retries with cache reuse, while an explicit Rewrite remains a forced generation', async () => {
  const { finish, publishReport } = await openReadyCheckin({ status: 'wearable', score: 79, source: 'oura' });
  vi.mocked(loadDailyCoaching).mockRejectedValueOnce(new Error('Connection lost'));
  await act(async () => finish().props.onPress());
  const retry = screen!.root.findAllByType('Pressable' as any).find(button =>
    button.findAllByType('Text' as any).some(text => [text.props.children].flat().join('').includes('Tap to try again.')))!;
  vi.mocked(loadDailyCoaching).mockImplementation(async () => { publishReport(); return coaching; });
  await act(async () => retry.props.onPress());
  expect(vi.mocked(loadDailyCoaching).mock.calls[1][2]).toEqual({ freshSources: true, refresh: false });
  const rewrite = screen!.root.findByProps({ accessibilityLabel: 'Rewrite today’s coaching' });
  await act(async () => rewrite.props.onPress());
  expect(vi.mocked(loadDailyCoaching).mock.calls[2][2]).toEqual({ freshSources: true, refresh: true });
});
