import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type PushDevice = {
  id: string;
  user_id: string;
  expo_push_token: string;
  timezone: string;
  reminder_time: string;
  last_sent_local_date: string | null;
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function mustEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function localClock(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

function isDue(device: PushDevice, now: Date) {
  try {
    const local = localClock(device.timezone, now);
    return local.time === device.reminder_time.slice(0, 5) && device.last_sent_local_date !== local.date;
  } catch {
    return false;
  }
}

async function sendExpoMessages(messages: Record<string, unknown>[]) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(messages),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Expo push request failed (${response.status})`);
  return payload;
}

async function processPendingReceipts(admin: ReturnType<typeof createClient>) {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("push_notification_deliveries")
    .select("id,device_id,expo_ticket_id")
    .eq("status", "submitted")
    .not("expo_ticket_id", "is", null)
    .lte("submitted_at", cutoff)
    .limit(1000);
  if (!data?.length) return;

  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
    method: "POST",
    headers,
    body: JSON.stringify({ ids: data.map((item) => item.expo_ticket_id) }),
  });
  if (!response.ok) return;
  const payload = await response.json();
  const checkedAt = new Date().toISOString();

  for (const delivery of data) {
    const receipt = payload?.data?.[delivery.expo_ticket_id];
    if (!receipt) continue;
    const errorCode = receipt.details?.error ?? null;
    await admin.from("push_notification_deliveries").update({
      status: receipt.status,
      error_code: errorCode,
      checked_at: checkedAt,
    }).eq("id", delivery.id);
    if (errorCode === "DeviceNotRegistered") {
      await admin.from("push_notification_devices").update({
        enabled: false,
        disabled_at: checkedAt,
        updated_at: checkedAt,
      }).eq("id", delivery.device_id);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const authHeader = req.headers.get("Authorization") ?? "";
    const cronSecret = req.headers.get("x-cron-secret");
    const isCron = Boolean(cronSecret && cronSecret === Deno.env.get("PUSH_CRON_SECRET"));

    if (!isCron) {
      const jwt = authHeader.replace(/^Bearer\s+/i, "");
      const { data, error } = await admin.auth.getUser(jwt);
      if (error || !data.user) return json({ error: "Invalid Supabase session" }, 401);

      const { data: device, error: deviceError } = await admin
        .from("push_notification_devices")
        .select("expo_push_token")
        .eq("user_id", data.user.id)
        .eq("enabled", true)
        .order("last_registered_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (deviceError) throw deviceError;
      if (!device) return json({ error: "No enabled push device is registered" }, 404);

      const result = await sendExpoMessages([{
        to: device.expo_push_token,
        title: "Sleep Coach notifications are ready",
        body: "Your daily check-in reminder can reach this device.",
        sound: "default",
        data: { destination: "today", kind: "notification-test" },
      }]);
      return json({ sent: 1, result });
    }

    await processPendingReceipts(admin);

    const { data, error } = await admin
      .from("push_notification_devices")
      .select("id,user_id,expo_push_token,timezone,reminder_time,last_sent_local_date")
      .eq("enabled", true);
    if (error) throw error;

    const now = new Date();
    const clockDue = ((data ?? []) as PushDevice[]).filter((device) => isDue(device, now));
    const dueChecks = await Promise.all(clockDue.map(async (device) => {
      const localDate = localClock(device.timezone, now).date;
      const { data: checkin } = await admin
        .from("daily_checkins")
        .select("id")
        .eq("user_id", device.user_id)
        .eq("checkin_date", localDate)
        .not("completed_at", "is", null)
        .limit(1)
        .maybeSingle();
      return checkin ? null : device;
    }));
    const due = dueChecks.filter((device): device is PushDevice => device !== null);
    if (!due.length) return json({ sent: 0 });

    let sent = 0;
    for (let offset = 0; offset < due.length; offset += 100) {
      const batch = due.slice(offset, offset + 100);
      const result = await sendExpoMessages(batch.map((device) => ({
        to: device.expo_push_token,
        title: "How did you sleep?",
        body: "Take a minute to check in so your coach can refine your next step.",
        sound: "default",
        data: { destination: "today", kind: "daily-check-in" },
      })));
      const tickets = Array.isArray(result?.data) ? result.data : [];
      const deliveryRows = batch.flatMap((device, index) => {
        const ticket = tickets[index];
        return ticket?.status === "ok" && ticket.id ? [{
          device_id: device.id,
          expo_ticket_id: ticket.id,
          kind: "daily-check-in",
        }] : [];
      });
      if (deliveryRows.length) {
        await admin.from("push_notification_deliveries").insert(deliveryRows);
      }
      const deliveredIds = batch
        .filter((_, index) => tickets[index]?.status === "ok")
        .map((device) => device.id);
      const invalidTokens = batch
        .filter((_, index) => tickets[index]?.details?.error === "DeviceNotRegistered")
        .map((device) => device.id);

      if (deliveredIds.length) {
        await Promise.all(deliveredIds.map((id) => {
          const device = batch.find((item) => item.id === id)!;
          return admin.from("push_notification_devices").update({
            last_sent_local_date: localClock(device.timezone, now).date,
            updated_at: now.toISOString(),
          }).eq("id", id);
        }));
        sent += deliveredIds.length;
      }
      if (invalidTokens.length) {
        await admin.from("push_notification_devices").update({
          enabled: false,
          disabled_at: now.toISOString(),
          updated_at: now.toISOString(),
        }).in("id", invalidTokens);
      }
    }

    return json({ sent, due: due.length });
  } catch (error) {
    console.error("send-push-notifications failed", error);
    return json({ error: "Push notifications could not be sent" }, 500);
  }
});
