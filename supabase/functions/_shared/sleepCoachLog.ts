/** Structured logs for Supabase sleep-coach (filter on service + event in dashboard). */

export function logSleepCoach(
  event: string,
  fields: Record<string, unknown>,
  level: "log" | "error" | "warn" = "error",
) {
  const line = JSON.stringify({
    service: "sleep-coach",
    event,
    ts: new Date().toISOString(),
    ...fields,
  });
  if (level === "log") console.log(line);
  else if (level === "warn") console.warn(line);
  else console.error(line);
}

/** Safe provider error details for logs (no prompts or API keys). */
export async function anthropicHttpErrorFields(
  response: Response,
): Promise<Record<string, unknown>> {
  const body = await response.text();
  let provider_error_type: string | null = null;
  let provider_error_message: string | null = null;
  try {
    const parsed = JSON.parse(body) as {
      error?: { type?: string; message?: string };
    };
    if (typeof parsed?.error?.type === "string") {
      provider_error_type = parsed.error.type;
    }
    if (typeof parsed?.error?.message === "string") {
      provider_error_message = parsed.error.message;
    }
  } catch {
    // Non-JSON error bodies are kept in response_preview only.
  }
  const previewLimit = 800;
  return {
    http_status: response.status,
    provider_request_id: response.headers.get("request-id"),
    provider_error_type,
    provider_error_message,
    response_preview: body.length > previewLimit
      ? `${body.slice(0, previewLimit)}…`
      : body,
  };
}
