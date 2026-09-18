import bundledTimeZones from './timeZones.json';
import type { PrimaryConcern, SleepProfile } from './types';

export const concernLabels: Record<PrimaryConcern, string> = {
  falling_asleep: 'Falling asleep',
  night_waking: 'Waking during the night',
  early_waking: 'Waking too early',
  unrefreshed: 'Waking refreshed',
  irregular_schedule: 'A steadier schedule',
};

export type SleepProfileDraft = Pick<SleepProfile, 'primaryConcern' | 'typicalBedtime' | 'typicalWakeTime' | 'timezone'>;

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch { return false; }
}

export function detectTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(zone) ? zone : 'UTC';
  } catch { return 'UTC'; }
}

export function restoreOnboardingTimeZone(savedChoice: unknown, profileZone: unknown): string {
  if (isValidTimeZone(savedChoice)) return savedChoice;
  // Older unfinished profiles have the database default, not a user-selected UTC.
  if (profileZone !== 'UTC' && isValidTimeZone(profileZone)) return profileZone;
  return detectTimeZone();
}

export function timeZoneOptions(current: string, device: string): string[] {
  // Bundled IANA names also support runtimes without Intl.supportedValuesOf.
  return [...new Set(['UTC', current, device, ...bundledTimeZones])]
    .filter(isValidTimeZone).sort();
}

export const timeZoneLabel = (zone: string) => zone.replace(/_/g, ' ').replace(/\//g, ' / ');

export const isValidClock = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function validateSleepProfile(draft: SleepProfileDraft): string | null {
  if (!Object.prototype.hasOwnProperty.call(concernLabels, draft.primaryConcern)) return 'Choose a primary focus.';
  if (!isValidClock(draft.typicalBedtime)) return 'Enter bedtime in 24-hour format, such as 23:00.';
  if (!isValidClock(draft.typicalWakeTime)) return 'Enter wake time in 24-hour format, such as 07:30.';
  if (draft.typicalBedtime === draft.typicalWakeTime) return 'Choose different bedtime and wake times.';
  if (!isValidTimeZone(draft.timezone)) return 'Choose a valid time zone.';
  return null;
}

export function shiftClock(clock: string, minutes: number): string {
  if (!isValidClock(clock)) return clock;
  const [hour, minute] = clock.split(':').map(Number);
  const total = ((hour * 60 + minute + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
