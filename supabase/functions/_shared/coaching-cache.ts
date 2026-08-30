export const DAILY_COACH_PROMPT_VERSION = "native-daily-v5-healthkit";

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

export async function dailyCoachSourceFingerprint(
  coachContext: unknown,
): Promise<string> {
  const canonical = JSON.stringify(
    stableValue(dailyCoachSourceSnapshot(coachContext)),
  );
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
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

export function isDailyCoachCacheFresh(
  existing: { prompt_version?: unknown; source_context?: unknown } | null,
  sourceFingerprint: string,
): boolean {
  if (!existing || existing.prompt_version !== DAILY_COACH_PROMPT_VERSION) {
    return false;
  }
  const sourceContext = existing.source_context &&
      typeof existing.source_context === "object"
    ? existing.source_context as JsonObject
    : {};
  return sourceContext.source_fingerprint === sourceFingerprint;
}
