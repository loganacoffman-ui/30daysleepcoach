export const DAILY_COACH_PROMPT_VERSION = "native-daily-v6-experiment-loop";
export const SLEEP_PROFILE_PROMPT_VERSION = "native-profile-v1-evolving";

type JsonObject = Record<string, unknown>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;

  return Object.keys(value as JsonObject).sort().reduce<JsonObject>(
    (result, key) => {
      const next = (value as JsonObject)[key];
      if (next !== undefined) result[key] = stableValue(next);
      return result;
    },
    {},
  );
}

export function dailyCoachSourceSnapshot(coachContext: unknown): JsonObject {
  const context = coachContext && typeof coachContext === "object"
    ? coachContext as JsonObject
    : {};
  return {
    date: context.date ?? null,
    profile: context.profile ?? null,
    subjective_checkins: Array.isArray(context.subjective_checkins)
      ? context.subjective_checkins
      : [],
    experiment_adherence: Array.isArray(context.experiment_adherence)
      ? context.experiment_adherence
      : [],
    wearable_sleep: Array.isArray(context.wearable_sleep)
      ? context.wearable_sleep
      : Array.isArray(context.oura_sleep)
      ? context.oura_sleep
      : [],
  };
}

async function fingerprint(snapshot: JsonObject): Promise<string> {
  const canonical = JSON.stringify(stableValue(snapshot));
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

export function dailyCoachSourceFingerprint(
  coachContext: unknown,
): Promise<string> {
  const snapshot = dailyCoachSourceSnapshot(coachContext);
  // Today's commitment is an output of generation, not adherence evidence.
  // Including it would make saving the recommendation invalidate itself.
  snapshot.experiment_adherence = (snapshot.experiment_adherence as unknown[])
    .filter((item) => {
      if (!item || typeof item !== "object") return false;
      const date = (item as JsonObject).behavior_date;
      return typeof date === "string" && typeof snapshot.date === "string" &&
        date < snapshot.date;
    });
  return fingerprint(snapshot);
}

// The evolving profile describes the user rather than a single day, so a new
// calendar date alone must not make it stale. Only the check-ins, experiments,
// wearable nights, and intake profile behind it do.
export function sleepProfileSourceSnapshot(coachContext: unknown): JsonObject {
  const { date: _date, ...rest } = dailyCoachSourceSnapshot(coachContext);
  return rest;
}

export function sleepProfileSourceFingerprint(
  coachContext: unknown,
): Promise<string> {
  return fingerprint(sleepProfileSourceSnapshot(coachContext));
}

// Mobile builds in the field reject a profile whose summary is empty once
// trimmed, and throw rather than degrade. Normalizing in one place keeps a
// blank-but-present summary from being stored, matched, or returned as an answer.
export function coachSummaryText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isSleepProfileCacheFresh(
  existing: {
    prompt_version?: unknown;
    source_fingerprint?: unknown;
    summary?: unknown;
  } | null,
  sourceFingerprint: string,
): boolean {
  if (!existing || !coachSummaryText(existing.summary)) return false;
  return existing.prompt_version === SLEEP_PROFILE_PROMPT_VERSION &&
    existing.source_fingerprint === sourceFingerprint;
}

// Every shipped client reads `status` plus `summary` and ignores the rest, so
// each success path is built here and none can answer with a different shape.
export function sleepProfileResponseBody(
  summary: unknown,
  generatedAt: unknown,
  cached: boolean,
): { status: "ok"; summary: string; generated_at: string | null; cached: boolean } {
  return {
    status: "ok",
    summary: coachSummaryText(summary),
    generated_at: typeof generatedAt === "string" ? generatedAt : null,
    cached,
  };
}

// The daily artifact has one wire shape for both the reused row and a freshly
// generated one. Shipped clients read exactly these five fields off
// `recommendation`, so they are projected here rather than at each return.
export function dailyCoachRecommendationBody(
  row: {
    pattern?: unknown;
    meaning?: unknown;
    action?: unknown;
    why?: unknown;
    generated_at?: unknown;
  },
): {
  pattern: string;
  meaning: string;
  action: string;
  why: string;
  generated_at: string | null;
} {
  const text = (value: unknown) => typeof value === "string" ? value : "";
  return {
    pattern: text(row.pattern),
    meaning: text(row.meaning),
    action: text(row.action),
    why: text(row.why),
    generated_at: typeof row.generated_at === "string" ? row.generated_at : null,
  };
}

export function latestWearableSummary(coachContext: unknown): {
  day: string | null;
  score: number | null;
  source: string | null;
} {
  const context = coachContext && typeof coachContext === "object"
    ? coachContext as JsonObject
    : {};
  const rows = Array.isArray(context.wearable_sleep)
    ? context.wearable_sleep
    : Array.isArray(context.oura_sleep)
    ? context.oura_sleep
    : [];
  const latest = rows
    .filter((row): row is JsonObject =>
      Boolean(
        row && typeof row === "object" &&
          typeof (row as JsonObject).day === "string",
      )
    )
    .sort((a, b) => String(b.day).localeCompare(String(a.day)))[0];
  return {
    day: typeof latest?.day === "string" ? latest.day : null,
    score: typeof latest?.score === "number" ? latest.score : null,
    source: typeof latest?.source === "string" ? latest.source : null,
  };
}

export function hasWearableSleepForDate(
  coachContext: unknown,
  date: string,
): boolean {
  const context = coachContext && typeof coachContext === "object"
    ? coachContext as JsonObject
    : {};
  const rows = Array.isArray(context.wearable_sleep)
    ? context.wearable_sleep
    : Array.isArray(context.oura_sleep)
    ? context.oura_sleep
    : [];
  return rows.some((row) => {
    if (!row || typeof row !== "object") return false;
    const sleep = row as JsonObject;
    return sleep.day === date && typeof sleep.score === "number";
  });
}

// Reuse the daily artifact only while the evidence behind it is unchanged.
export function isDailyCoachCacheReusable(
  existing: { prompt_version?: unknown; action?: unknown; source_context?: unknown } | null,
  sourceFingerprint: string,
): boolean {
  if (!existing || !coachSummaryText(existing.action)) {
    return false;
  }
  const source = existing.source_context;
  return existing.prompt_version === DAILY_COACH_PROMPT_VERSION &&
    !!source && typeof source === "object" &&
    (source as JsonObject).source_fingerprint === sourceFingerprint;
}
