import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationResponse } from '../mobile/node_modules/expo-notifications';
const mock = vi.hoisted(() => ({ listen: vi.fn(), last: vi.fn(), clear: vi.fn(), remove: vi.fn() }));
vi.mock('../mobile/node_modules/expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'tap', addNotificationResponseReceivedListener: mock.listen,
  getLastNotificationResponse: mock.last, clearLastNotificationResponse: mock.clear,
}));
vi.mock('../mobile/node_modules/react-native', () => ({ Platform: { OS: 'ios' } }));
import { subscribeToDailyCheckInNotifications } from '../mobile/notificationNavigation';

const response = (data = { kind: 'daily-check-in', destination: 'today' }, id = 'one', date = 1) => ({
  actionIdentifier: 'tap', notification: { date, request: { identifier: id, content: { data } } },
}) as NotificationResponse;
let listener: (response: NotificationResponse) => void;
beforeEach(() => {
  vi.clearAllMocks();
  mock.last.mockReturnValue(null);
  mock.listen.mockImplementation(callback => { listener = callback; return { remove: mock.remove }; });
});

describe('notification navigation to Your Day', () => {
  it('opens the daily view from a cold launch and consumes the response', () => {
    mock.last.mockReturnValue(response());
    const open = vi.fn();
    subscribeToDailyCheckInNotifications(open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(mock.clear).toHaveBeenCalledTimes(1);
    expect(mock.listen.mock.invocationCallOrder[0]).toBeLessThan(mock.last.mock.invocationCallOrder[0]);
  });
  it('opens from an already-running app, deduplicates cold/listener delivery, and accepts later taps', () => {
    const open = vi.fn();
    mock.last.mockReturnValue(response());
    const dispose = subscribeToDailyCheckInNotifications(open);
    listener(response());
    expect(open).toHaveBeenCalledTimes(1);
    listener(response(undefined, 'two'));
    listener(response(undefined, 'two', 2));
    expect(open).toHaveBeenCalledTimes(3);
    dispose(); expect(mock.remove).toHaveBeenCalledTimes(1);
  });
  it('ignores unrelated notifications and non-tap actions', () => {
    const open = vi.fn(); subscribeToDailyCheckInNotifications(open);
    listener(response({ kind: 'other', destination: 'other' }));
    listener({ ...response(), actionIdentifier: 'dismiss' });
    expect(open).not.toHaveBeenCalled();
    expect(mock.clear).not.toHaveBeenCalled();
  });
  it('supports the existing today payload as well as daily-check-in kind', () => {
    const open = vi.fn(); subscribeToDailyCheckInNotifications(open);
    listener(response({ kind: 'notification-test', destination: 'today' }));
    listener(response({ kind: 'daily-check-in', destination: '' }, 'two'));
    expect(open).toHaveBeenCalledTimes(2);
  });
});
