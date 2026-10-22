import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from '../mobile/node_modules/react';
import { act, create, type ReactTestRenderer } from '../mobile/node_modules/react-test-renderer';
import CoachChatScreen from '../mobile/coach/CoachChatScreen';
import * as repository from '../mobile/coach/coachRepository';

vi.mock('../mobile/node_modules/react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
  FlatList: 'FlatList', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', TextInput: 'TextInput',
  Platform: { OS: 'ios' }, StyleSheet: { create: (styles: unknown) => styles },
  Keyboard: { dismiss: vi.fn() }, useWindowDimensions: () => ({ width: 400 }),
  PanResponder: { create: () => ({ panHandlers: {} }) },
  Easing: { in: vi.fn(), out: vi.fn(), cubic: vi.fn() },
  Animated: { View: 'View', Value: class { setValue() {} stopAnimation() {} }, timing: vi.fn(),
    parallel: () => ({ start: (done?: () => void) => done?.() }) },
}));
vi.mock('../mobile/node_modules/react-native-safe-area-context', () => ({ SafeAreaView: 'View' }));
vi.mock('../mobile/cache/screenCache', () => ({ screenCache: { read: async () => null, write: async () => undefined } }));
vi.mock('../mobile/coach/greetingRepository', () => ({ loadContextGreeting: async () => null, claimContextGreeting: vi.fn() }));
vi.mock('../mobile/coach/coachRepository', () => ({
  localDate: () => '2026-10-22', dailyConversationDate: () => null,
  loadCoachHomeState: vi.fn(), listCoachConversations: async () => [],
  getOrCreateDailyConversation: vi.fn(), loadCoachConversation: vi.fn(),
  saveCheckinTranscript: vi.fn(), sendCoachMessage: vi.fn(), createCoachConversation: vi.fn(), resolveCoachToolCall: vi.fn(),
}));
vi.mock('../mobile/today/TodayScreen', () => ({ default: 'TodayScreen' }));
vi.mock('../mobile/design/Skeleton', () => ({ Skeleton: 'Skeleton' }));
vi.mock('../mobile/coach/ChatBubble', () => ({ default: 'ChatBubble' }));
vi.mock('../mobile/coach/ChatComposer', () => ({ default: 'ChatComposer' }));
vi.mock('../mobile/coach/JumpToLatest', () => ({ default: 'JumpToLatest' }));
const scroll = vi.hoisted(() => ({ scrollProps: {}, scrollToLatest: vi.fn(), reset: vi.fn(), showLatest: false }));
vi.mock('../mobile/coach/useChatScroll', () => ({ useChatScroll: () => scroll }));
let screen: ReactTestRenderer;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const headerButton = () => screen.root.findAllByType('Pressable' as any).find(button =>
  button.findAllByType('Text' as any).some(text => text.props.children === 'Your day'))!;
const day = () => screen.root.findByType('TodayScreen' as any);
beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(repository.loadCoachHomeState).mockReturnValue(new Promise(() => {}));
});
afterEach(async () => { await act(async () => screen?.unmount()); delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT; });
const mount = async () => act(async () => {
  screen = create(createElement(CoachChatScreen, { user: { id: 'u' }, profile: { displayName: 'Alex' }, repository: {} } as any));
});

it('opens check-in immediately while home, conversation creation and history are still pending', async () => {
  const conversation = deferred<string>();
  const history = deferred<any[]>();
  vi.mocked(repository.getOrCreateDailyConversation).mockReturnValue(conversation.promise);
  vi.mocked(repository.loadCoachConversation).mockReturnValue(history.promise);
  await mount();
  expect(headerButton().props.disabled).toBe(false);
  await act(async () => headerButton().props.onPress());
  expect(day().props.chat.disabled).toBe(true);
  expect(repository.loadCoachConversation).not.toHaveBeenCalled();
  await act(async () => conversation.resolve('daily'));
  const mountedDay = day();
  await act(async () => history.resolve([{ id: 'old', content: 'Earlier', role: 'assistant' }]));
  expect(day()).toBe(mountedDay);
  expect(day().props.chat.disabled).toBe(false);
  expect(day().props.chat.messages[0].id).toBe('old');
});

it('finishing waits for transcript storage but not the history refresh', async () => {
  vi.mocked(repository.getOrCreateDailyConversation).mockResolvedValue('daily');
  vi.mocked(repository.loadCoachConversation).mockResolvedValue([]);
  await mount();
  await act(async () => headerButton().props.onPress());
  const stored = deferred<boolean>();
  vi.mocked(repository.saveCheckinTranscript).mockReturnValue(stored.promise);
  vi.mocked(repository.loadCoachConversation).mockReturnValue(new Promise(() => {}));
  let complete = false;
  let saving!: Promise<void>;
  await act(async () => { saving = day().props.chat.onCheckinComplete([{ role: 'user', content: 'Rested' }]).then(() => { complete = true; }); });
  expect(complete).toBe(false);
  await act(async () => { stored.resolve(true); await saving; });
  expect(complete).toBe(true);
});

it('shows the full returned reply without waiting for character animation or history refresh', async () => {
  vi.mocked(repository.getOrCreateDailyConversation).mockResolvedValue('daily');
  vi.mocked(repository.loadCoachConversation).mockResolvedValue([]);
  await mount();
  await act(async () => headerButton().props.onPress());
  const content = 'A complete coaching response. '.repeat(100);
  vi.mocked(repository.sendCoachMessage).mockImplementation(async (_user, _profile, _id, _content, delta) => {
    delta?.(content);
    return { id: 'reply', role: 'assistant', content, createdAt: 'now' };
  });
  await act(async () => { expect(await day().props.chat.onSend('Help me wind down')).toBe(true); });
  expect(day().props.chat.sending).toBe(false);
  expect(day().props.chat.messages.at(-1).content).toBe(content);
});

it('does not let a slow reopen erase a reply that was sent and completed meanwhile', async () => {
  vi.mocked(repository.getOrCreateDailyConversation).mockResolvedValue('daily');
  vi.mocked(repository.loadCoachConversation).mockResolvedValue([{ id: 'old', role: 'assistant', content: 'Earlier', createdAt: 'then' }]);
  await mount();
  await act(async () => headerButton().props.onPress());
  const home = screen.root.findAllByType('Pressable' as any).find(button =>
    button.findAllByType('Text' as any).some(text => text.props.children === '← Coach home'))!;
  await act(async () => home.props.onPress());
  const stale = deferred<any[]>();
  vi.mocked(repository.loadCoachConversation).mockReturnValue(stale.promise);
  await act(async () => headerButton().props.onPress());
  expect(day().props.chat.disabled).toBe(false);
  expect(day().props.chat.messages[0].content).toBe('Earlier');
  vi.mocked(repository.sendCoachMessage).mockResolvedValue({ id: 'new', role: 'assistant', content: 'New reply', createdAt: 'now' });
  await act(async () => day().props.chat.onSend('A follow-up'));
  await act(async () => stale.resolve([{ id: 'old', role: 'assistant', content: 'Earlier' }]));
  expect(day().props.chat.messages.at(-1).content).toBe('New reply');
});
