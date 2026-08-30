import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DAILY_COACH_PROMPT_VERSION,
  dailyCoachSourceFingerprint,
  isDailyCoachCacheFresh,
  latestWearableSummary,
  hasWearableSleepForDate,
} from "./coaching-cache.ts";

Deno.test("wearable readiness requires a scored row for the requested day", () => {
  const context = {
    wearable_sleep: [
      { day: "2026-08-27", score: 88, source: "apple_health" },
      { day: "2026-08-28" },
    ],
  };
  assertEquals(hasWearableSleepForDate(context, "2026-08-27"), true);
  assertEquals(hasWearableSleepForDate(context, "2026-08-28"), false);
  assertEquals(hasWearableSleepForDate(context, "2026-08-29"), false);
});

const context = {
  date: "2026-08-27",
  profile: { primary_concern: "unrefreshed" },
  subjective_checkins: [{ checkin_date: "2026-08-27", feeling: 72 }],
  experiment_adherence: [{ behavior_date: "2026-08-26", status: "completed" }],
  wearable_sleep: [{ day: "2026-08-26", score: 79, source: "oura" }],
};

Deno.test("daily coach fingerprint is stable across object key order", async () => {
  const reordered = {
    wearable_sleep: [{ source: "oura", score: 79, day: "2026-08-26" }],
    experiment_adherence: [{
      status: "completed",
      behavior_date: "2026-08-26",
    }],
    subjective_checkins: [{ feeling: 72, checkin_date: "2026-08-27" }],
    profile: { primary_concern: "unrefreshed" },
    date: "2026-08-27",
  };
  assertEquals(
    await dailyCoachSourceFingerprint(context),
    await dailyCoachSourceFingerprint(reordered),
  );
});

Deno.test("new or corrected wearable data invalidates daily coaching", async () => {
  const original = await dailyCoachSourceFingerprint(context);
  const corrected = await dailyCoachSourceFingerprint({
    ...context,
    wearable_sleep: [{ day: "2026-08-26", score: 88, source: "apple_health" }],
  });
  const newer = await dailyCoachSourceFingerprint({
    ...context,
    wearable_sleep: [
      { day: "2026-08-27", score: 88, source: "apple_health" },
      { day: "2026-08-26", score: 79, source: "oura" },
    ],
  });
  assertNotEquals(original, corrected);
  assertNotEquals(original, newer);
});

Deno.test("cache hits only for the current prompt and unchanged source", async () => {
  const fingerprint = await dailyCoachSourceFingerprint(context);
  assertEquals(
    isDailyCoachCacheFresh({
      prompt_version: DAILY_COACH_PROMPT_VERSION,
      source_context: { source_fingerprint: fingerprint },
    }, fingerprint),
    true,
  );
  assertEquals(
    isDailyCoachCacheFresh({
      prompt_version: DAILY_COACH_PROMPT_VERSION,
      source_context: { source_fingerprint: "sha256:stale" },
    }, fingerprint),
    false,
  );
  assertEquals(
    isDailyCoachCacheFresh({
      prompt_version: "native-daily-v3-concise-weekly",
      source_context: { source_fingerprint: fingerprint },
    }, fingerprint),
    false,
  );
});

Deno.test("latest wearable summary selects the newest available day", () => {
  assertEquals(
    latestWearableSummary({
      wearable_sleep: [
        { day: "2026-08-25", score: 79, source: "oura" },
        { day: "2026-08-26", score: 88, source: "apple_health" },
      ],
    }),
    { day: "2026-08-26", score: 88, source: "apple_health" },
  );
});
