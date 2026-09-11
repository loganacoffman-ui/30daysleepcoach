type Reminder = {
  timezone: string;
  reminder_time: string;
  last_sent_local_date: string | null;
};

// Return the reminder's local date, including when the next cron tick is after
// midnight. Looking back in real minutes also handles timezone/DST boundaries.
export function dueReminderDate(device: Reminder, now: Date): string | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: device.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    for (let minutesAgo = 0; minutesAgo < 15; minutesAgo++) {
      const parts = formatter.formatToParts(new Date(now.getTime() - minutesAgo * 60_000));
      const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
      if (`${part("hour")}:${part("minute")}` !== device.reminder_time.slice(0, 5)) continue;
      const date = `${part("year")}-${part("month")}-${part("day")}`;
      return device.last_sent_local_date === date ? null : date;
    }
  } catch {
    // Ignore invalid device timezones rather than failing the whole dispatch.
  }
  return null;
}
