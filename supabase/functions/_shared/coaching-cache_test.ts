import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  coachSummaryText,
  DAILY_COACH_PROMPT_VERSION,
  dailyCoachRecommendationBody,
  dailyCoachSourceFingerprint,
  isDailyCoachCacheReusable,
  isSleepProfileCacheFresh,
  latestWearableSummary,
  hasWearableSleepForDate,
  SLEEP_PROFILE_PROMPT_VERSION,
  sleepProfileResponseBody,
  sleepProfileSourceFingerprint,
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

const cachedRecommendation = async (sources: unknown) => ({
  prompt_version: DAILY_COACH_PROMPT_VERSION,
  source_context: { source_fingerprint: await dailyCoachSourceFingerprint(sources) },
  pattern: "Your sleep score was 79",
  meaning: "Keep watching your recovery",
  action: "Dim the lights an hour before bed",
  why: "Give yourself time to wind down",
  generated_at: "2026-08-27T08:00:00.000Z",
});

Deno.test("unchanged sources reuse the stored daily recommendation", async () => {
  const stored = await cachedRecommendation(context);
  assertEquals(isDailyCoachCacheReusable(stored, await dailyCoachSourceFingerprint(context)), true);
  const fingerprint = await dailyCoachSourceFingerprint(context);
  for (const invalid of [
    null,
    { ...stored, prompt_version: "old" },
    { ...stored, action: "   " },
    { ...stored, source_context: null },
    { ...stored, source_context: {} },
    { ...stored, source_context: "invalid" },
  ]) {
    assertEquals(isDailyCoachCacheReusable(invalid, fingerprint), false);
  }
});

for (const [name, wearable_sleep] of Object.entries({
  newer: [{ day: "2026-08-27", score: 88, source: "oura" }, ...context.wearable_sleep],
  corrected: [{ day: "2026-08-26", score: 88, source: "oura" }],
})) {
  Deno.test(`${name} Oura data invalidates once, then reuses the refreshed row`, async () => {
    let stored = await cachedRecommendation(context);
    const updated = { ...context, wearable_sleep };
    const fingerprint = await dailyCoachSourceFingerprint(updated);
    let generations = 0;
    for (let request = 0; request < 3; request++) {
      if (!isDailyCoachCacheReusable(stored, fingerprint)) {
        generations++;
        stored = await cachedRecommendation(updated);
      }
      assertEquals(Object.keys(dailyCoachRecommendationBody(stored)), [
        "pattern", "meaning", "action", "why", "generated_at",
      ]);
    }
    assertEquals(generations, 1);
    assertEquals(latestWearableSummary(updated).score, 88);
  });
}

Deno.test("manual, qualitative, profile, and prior adherence changes invalidate coaching", async () => {
  const stored = await cachedRecommendation(context);
  for (const changes of [
    { subjective_checkins: [{ ...context.subjective_checkins[0], manual_sleep_score: 63, manual_sleep_submitted_at: "2026-08-27T10:00:00Z" }] },
    { subjective_checkins: [{ ...context.subjective_checkins[0], feeling: 40 }] },
    { subjective_checkins: [{ ...context.subjective_checkins[0], suspected_factor: "stress", note: "Woke anxious" }] },
    { profile: { primary_concern: "falling_asleep" } },
    { experiment_adherence: [{ ...context.experiment_adherence[0], status: "skipped" }] },
  ]) {
    assertEquals(isDailyCoachCacheReusable(stored, await dailyCoachSourceFingerprint({ ...context, ...changes })), false);
  }
});

Deno.test("saving today's experiment does not invalidate its own coaching", async () => {
  const stored = await cachedRecommendation(context);
  const afterSave = {
    ...context,
    experiment_adherence: [
      { behavior_date: context.date, behavior: stored.action, status: "committed" },
      ...context.experiment_adherence,
    ],
  };
  assertEquals(isDailyCoachCacheReusable(stored, await dailyCoachSourceFingerprint(afterSave)), true);
  // The evolving profile still includes the current experiment.
  assertNotEquals(await sleepProfileSourceFingerprint(context), await sleepProfileSourceFingerprint(afterSave));
});

Deno.test("the sleep profile stays cached across days until its evidence changes", async () => {
  const fingerprint = await sleepProfileSourceFingerprint(context);
  assertEquals(
    await sleepProfileSourceFingerprint({ ...context, date: "2026-09-14" }),
    fingerprint,
  );
  assertNotEquals(
    await sleepProfileSourceFingerprint({
      ...context,
      subjective_checkins: [
        { checkin_date: "2026-08-28", feeling: 61 },
        ...context.subjective_checkins,
      ],
    }),
    fingerprint,
  );
  const summary = "You sleep better on the nights you wind down earlier.";
  assertEquals(
    isSleepProfileCacheFresh({
      summary,
      source_fingerprint: fingerprint,
      prompt_version: SLEEP_PROFILE_PROMPT_VERSION,
    }, fingerprint),
    true,
  );
  assertEquals(
    isSleepProfileCacheFresh({
      summary,
      source_fingerprint: "sha256:stale",
      prompt_version: SLEEP_PROFILE_PROMPT_VERSION,
    }, fingerprint),
    false,
  );
  assertEquals(
    isSleepProfileCacheFresh({
      summary: "",
      source_fingerprint: fingerprint,
      prompt_version: SLEEP_PROFILE_PROMPT_VERSION,
    }, fingerprint),
    false,
  );
  assertEquals(
    isSleepProfileCacheFresh({
      summary,
      source_fingerprint: fingerprint,
      prompt_version: "native-profile-v0",
    }, fingerprint),
    false,
  );
});

// The function deploys ahead of the App Store, so every shipped build keeps
// calling it. Those builds read `recommendation.{pattern,meaning,action,why,
// generated_at}` and `summary`, and throw rather than degrade when a field is
// missing or blank. These tests fail if a response ever stops carrying them.
Deno.test("the daily artifact keeps one wire shape for reused and fresh rows", () => {
  const row = {
    pattern: "You wake earlier after late meals",
    meaning: "Digestion is fragmenting your second half of the night",
    action: "Finish dinner three hours before bed",
    why: "It gives digestion time to settle",
    generated_at: "2026-09-16T13:04:00.000Z",
  };
  assertEquals(dailyCoachRecommendationBody(row), row);
  // Columns the clients never read stay out of the response.
  const storedRow = { ...row, prompt_version: "x", source_context: {} };
  assertEquals(dailyCoachRecommendationBody(storedRow), row);
  // A row missing optional prose still answers with every field present.
  assertEquals(dailyCoachRecommendationBody({ action: row.action }), {
    pattern: "",
    meaning: "",
    action: row.action,
    why: "",
    generated_at: null,
  });
});

Deno.test("a sleep profile response always carries a usable summary", () => {
  assertEquals(
    sleepProfileResponseBody("  You settle faster on wind-down nights. ", "2026-09-16T13:04:00.000Z", true),
    {
      status: "ok",
      summary: "You settle faster on wind-down nights.",
      generated_at: "2026-09-16T13:04:00.000Z",
      cached: true,
    },
  );
  assertEquals(sleepProfileResponseBody("A picture is forming.", null, false).generated_at, null);
  // Whitespace is not a summary, and a stored blank must not pass as a cache hit
  // that a client without a regenerate button could never recover from.
  assertEquals(coachSummaryText("   "), "");
  assertEquals(coachSummaryText(undefined), "");
  assertEquals(
    isSleepProfileCacheFresh({
      summary: "   ",
      source_fingerprint: "sha256:same",
      prompt_version: SLEEP_PROFILE_PROMPT_VERSION,
    }, "sha256:same"),
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
