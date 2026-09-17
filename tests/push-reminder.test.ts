import { describe, expect, it, vi } from 'vitest';
import { dueReminderDate, pendingReminders } from '../supabase/functions/_shared/push-reminder';

const device = { timezone: 'UTC', reminder_time: '08:07:00', last_sent_local_date: null };

describe('15-minute push reminder dispatch', () => {
  it('picks up reminders between cron ticks without sending early or replaying old ones', () => {
    expect(dueReminderDate(device, new Date('2026-09-11T08:00:00Z'))).toBeNull();
    expect(dueReminderDate(device, new Date('2026-09-11T08:15:05Z'))).toBe('2026-09-11');
    expect(dueReminderDate(device, new Date('2026-09-11T08:30:00Z'))).toBeNull();
  });

  it('includes the current and previous 14 minutes, but excludes the prior window', () => {
    const now = new Date('2026-09-11T08:15:00Z');
    expect(dueReminderDate({ ...device, reminder_time: '08:15' }, now)).toBe('2026-09-11');
    expect(dueReminderDate({ ...device, reminder_time: '08:01' }, now)).toBe('2026-09-11');
    expect(dueReminderDate({ ...device, reminder_time: '08:00' }, now)).toBeNull();
  });

  it('uses the reminder date across midnight and suppresses an already sent reminder', () => {
    const late = { ...device, reminder_time: '23:53' };
    const now = new Date('2026-09-12T00:00:00Z');
    expect(dueReminderDate(late, now)).toBe('2026-09-11');
    expect(dueReminderDate({ ...late, last_sent_local_date: '2026-09-11' }, now)).toBeNull();
    expect(dueReminderDate({ ...late, last_sent_local_date: '2026-09-10' }, now)).toBe('2026-09-11');
  });

  it('respects fractional timezone offsets', () => {
    expect(dueReminderDate({ ...device, timezone: 'Asia/Kathmandu' }, new Date('2026-09-11T02:30:00Z'))).toBe('2026-09-11');
  });

  it('does not resend during the repeated DST hour', () => {
    const dst = { ...device, timezone: 'America/Los_Angeles', reminder_time: '01:07' };
    expect(dueReminderDate(dst, new Date('2026-11-01T08:15:00Z'))).toBe('2026-11-01');
    expect(dueReminderDate({ ...dst, last_sent_local_date: '2026-11-01' }, new Date('2026-11-01T09:15:00Z'))).toBeNull();
  });

  it('ignores an invalid timezone', () => {
    expect(dueReminderDate({ ...device, timezone: 'invalid' }, new Date('2026-09-11T08:15:00Z'))).toBeNull();
  });
});


describe('completed check-in suppression', () => {
  const due = { ...device, user_id: 'user', id: 'phone' };
  const now = new Date('2026-09-11T08:15:00Z');

  it('skips all devices for a completed account and still sends for incomplete accounts', async () => {
    const completed = vi.fn(async (userId: string) => userId === 'user');
    const other = { ...due, user_id: 'other', id: 'other-phone' };
    expect(await pendingReminders([due, { ...due, id: 'tablet' }, other], now, completed)).toEqual([other]);
    expect(completed).toHaveBeenCalledWith('user', '2026-09-11');
  });

  it('checks the reminder date across local midnight, not the UTC or dispatch date', async () => {
    const completed = vi.fn(async () => true);
    expect(await pendingReminders([{ ...due, timezone: 'America/Los_Angeles', reminder_time: '23:53' }], new Date('2026-09-12T07:00:00Z'), completed)).toEqual([]);
    expect(completed).toHaveBeenCalledWith('user', '2026-09-11');
  });

  it('continues reminders when only a previous day is complete', async () => {
    const completed = vi.fn(async (_userId: string, date: string) => date === '2026-09-10');
    expect(await pendingReminders([due], now, completed)).toEqual([due]);
  });

  it('does not query check-ins before the scheduled time or after today was sent', async () => {
    const completed = vi.fn(async () => false);
    expect(await pendingReminders([due], new Date('2026-09-11T08:00:00Z'), completed)).toEqual([]);
    expect(await pendingReminders([{ ...due, last_sent_local_date: '2026-09-11' }], now, completed)).toEqual([]);
    expect(completed).not.toHaveBeenCalled();
  });

  it('does not authorize delivery when completion cannot be checked', async () => {
    await expect(pendingReminders([due], now, async () => { throw new Error('Database unavailable'); })).rejects.toThrow('Database unavailable');
  });
});
