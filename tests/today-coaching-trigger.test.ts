import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from '../mobile/node_modules/react';
import { act, create, type ReactTestRenderer } from '../mobile/node_modules/react-test-renderer';
import TodayScreen from '../mobile/today/TodayScreen';
import { loadDailyCoaching } from '../mobile/coach/coachRepository';
import { interpretTypedCheckinReply } from '../mobile/today/checkinReplyRepository';
import { checkinDraftStorage } from '../mobile/today/checkinDraftStorage';
import type { TodayRepository, TodaySnapshot } from '../mobile/today/types';

const checkinScroll = vi.hoisted(() => ({ scrollToLatest: vi.fn(), setLatestOffset: vi.fn() }));

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
  useChatScroll: () => ({ scrollProps: {}, ...checkinScroll, showLatest: false }),
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

async function openReadyCheckin(sleepData: TodaySnapshot['sleepData'], onCheckinComplete?: () => Promise<void>, factorStep = false) {
  let snapshot: TodaySnapshot = {
    date: '2026-09-23', dayNumber: 3, checkin: null, sleepData,
    dailyCoaching: null, commitment: null, previousCommitment: null,
  };
  vi.mocked(checkinDraftStorage.load).mockResolvedValue({
    conversation: { step: factorStep ? 'factor' : 'details', morningFeeling: 'okay', turns: [
      { role: 'user', content: 'A quiet evening.' },
      { role: 'assistant', content: factorStep ? 'What do you think affected your sleep last night?' : 'Anything else you’d like me to know?' },
    ] },
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

it('anchors the factor screen at its complete question and instructions, then clears the anchor on Next', async () => {
  await openReadyCheckin({ status: 'wearable', score: 79, source: 'oura' }, undefined, true);
  const prompt = screen!.root.findAllByType('ChatBubble' as any).find(bubble =>
    bubble.props.content === 'What do you think affected your sleep last night?')!.parent!;
  expect(prompt.findByType('Text' as any).props.children).toContain('Scroll for more choices, then tap Next.');
  await act(async () => {
    prompt.parent!.props.onLayout({ nativeEvent: { layout: { y: 320 } } });
    prompt.props.onLayout({ nativeEvent: { layout: { y: 180 } } });
  });
  expect(checkinScroll.setLatestOffset).toHaveBeenLastCalledWith(500);
  expect(checkinScroll.scrollToLatest).toHaveBeenCalled();
  await act(async () => screen!.root.findByProps({ accessibilityLabel: 'Next' }).props.onPress());
  expect(checkinScroll.setLatestOffset).toHaveBeenLastCalledWith(null);
});

it('keeps multiple choices selected until the separate Next button advances, then saves them all', async () => {
  const { repository, finish } = await openReadyCheckin({ status: 'wearable', score: 79, source: 'oura' }, undefined, true);
  const checkbox = (label: string) => screen!.root.findAllByType('Pressable' as any).find(button =>
    button.props.accessibilityRole === 'checkbox' && button.findAllByType('Text' as any)
      .some(text => [text.props.children].flat().join('').includes(label)))!;
  expect(screen!.root.findAllByType('Pressable' as any).filter(button => button.props.accessibilityRole === 'checkbox')).toHaveLength(22);
  await act(async () => checkbox('Stress').props.onPress());
  await act(async () => checkbox('Caffeine').props.onPress());
  expect(checkbox('Stress').props.accessibilityState.checked).toBe(true);
  expect(checkbox('Caffeine').props.accessibilityState.checked).toBe(true);
  expect(repository.saveCheckin).not.toHaveBeenCalled();
  expect(interpretTypedCheckinReply).not.toHaveBeenCalled();
  await act(async () => screen!.root.findByProps({ accessibilityLabel: 'Next' }).props.onPress());
  expect(screen!.root.findAllByType('Pressable' as any).filter(button => button.props.accessibilityRole === 'checkbox')).toHaveLength(0);
  await act(async () => finish().props.onPress());
  expect(repository.saveCheckin).toHaveBeenCalledWith(expect.objectContaining({ suspectedFactors: ['stress', 'caffeine'] }));
});

it('Next interprets typed detail alongside selections and preserves both after a parsing failure', async () => {
  const { repository, finish } = await openReadyCheckin({ status: 'wearable', score: 79, source: 'oura' }, undefined, true);
  const stress = screen!.root.findAllByType('Pressable' as any).find(button =>
    button.props.accessibilityRole === 'checkbox' && button.findAllByType('Text' as any)
      .some(text => [text.props.children].flat().join('') === 'Stress'))!;
  await act(async () => stress.props.onPress());
  await act(async () => screen!.root.findByType('ChatComposer' as any).props.onChangeText('Coffee late too, no alcohol'));
  vi.mocked(interpretTypedCheckinReply).mockRejectedValueOnce(new Error('Try again'));
  await act(async () => screen!.root.findByProps({ accessibilityLabel: 'Next' }).props.onPress());
  expect(screen!.root.findByType('ChatComposer' as any).props.value).toBe('Coffee late too, no alcohol');
  expect(repository.saveCheckin).not.toHaveBeenCalled();
  vi.mocked(interpretTypedCheckinReply).mockResolvedValueOnce({ addressed: true, answer: 'stress', factors: ['stress', 'caffeine'], finish: false, clarification: null });
  await act(async () => screen!.root.findByProps({ accessibilityLabel: 'Next' }).props.onPress());
  expect(interpretTypedCheckinReply).toHaveBeenLastCalledWith(expect.objectContaining({ suspectedFactors: ['stress'] }), 'Coffee late too, no alcohol');
  await act(async () => finish().props.onPress());
  expect(repository.saveCheckin).toHaveBeenCalledWith(expect.objectContaining({ suspectedFactors: ['stress', 'caffeine'], note: expect.stringContaining('Coffee late too, no alcohol') }));
});

it('Finish parses unsent detail before saving corrected factors', async () => {
  const { repository, finish } = await openReadyCheckin({ status: 'wearable', score: 79, source: 'oura' });
  await act(async () => screen!.root.findByType('ChatComposer' as any).props.onChangeText('Also the dog woke me'));
  vi.mocked(interpretTypedCheckinReply).mockResolvedValueOnce({ addressed: true, answer: null, factors: ['bed_partner'], finish: false, clarification: null });
  await act(async () => finish().props.onPress());
  expect(repository.saveCheckin).toHaveBeenCalledWith(expect.objectContaining({ suspectedFactors: ['bed_partner'], note: expect.stringContaining('Also the dog woke me') }));
});
