import { describe, expect, it } from 'vitest';
import { dueReminderDate } from '../supabase/functions/_shared/push-reminder';

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
