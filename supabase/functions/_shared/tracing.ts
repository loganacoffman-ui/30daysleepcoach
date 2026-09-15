// Braintrust tracing for the coach's Anthropic calls.
// In production: supabase secrets set BRAINTRUST_API_KEY=...
// Imported from esm.sh rather than npm: the npm package ships ~23MB of optional
// `bt` CLI binaries that push the deployed function past Supabase's size limit.
// edge-light is the build meant for this runtime.
import {
  initLogger,
  NOOP_SPAN,
  type Span,
} from "https://esm.sh/braintrust@3.32.0/edge-light";

// Without a key, tracing stays off and the coach behaves exactly as before.
const apiKey = (() => {
  try {
    return Deno.env.get("BRAINTRUST_API_KEY");
  } catch {
    return undefined;
  }
})();

const logger = apiKey
  ? initLogger({ projectName: "30-day-sleep-coach", apiKey })
  : null;

/**
 * An Anthropic Messages request. The conversation is logged as the span input
 * when `messages` is present, otherwise the whole payload is.
 */
type AnthropicRequest = {
  model?: string;
  max_tokens?: number;
  system?: unknown;
  messages?: unknown;
  tools?: unknown;
  tool_choice?: unknown;
  [key: string]: unknown;
};

/**
 * Anthropic carries the system prompt outside `messages`, so it has to be
 * folded back in as a leading system turn for Braintrust to render it.
 */
function spanInput(request: AnthropicRequest): unknown {
  if (!Array.isArray(request.messages)) return request;
  return typeof request.system === "string"
    ? [{ role: "system", content: request.system }, ...request.messages]
    : request.messages;
}

/**
 * Open an LLM span for an Anthropic Messages request. Streaming callers hold the
 * span open until they have assembled the full reply.
 */
export function startAnthropicSpan(
  name: string,
  request: AnthropicRequest,
): Span {
  return logger?.startSpan({
    name,
    type: "llm",
    event: {
      input: spanInput(request),
      metadata: {
        model: request.model,
        max_tokens: request.max_tokens,
        tools: request.tools,
        tool_choice: request.tool_choice,
      },
    },
  }) ?? NOOP_SPAN;
}

/** Close a span and flush, since the edge runtime stops once a response returns. */
export async function endAnthropicSpan(
  span: Span,
  output: unknown,
): Promise<void> {
  span.log({ output });
  span.end();
  try {
    await logger?.flush();
  } catch (error) {
    // Tracing must never take the coach down with it.
    console.error("Braintrust flush failed", error);
  }
}

/** Trace a non-streaming Anthropic call, logging whatever `call` resolves to. */
export async function tracedAnthropic<T>(
  name: string,
  request: AnthropicRequest,
  call: () => Promise<T>,
): Promise<T> {
  const span = startAnthropicSpan(name, request);
  let output: unknown = null;
  try {
    const result = await call();
    output = result;
    return result;
  } finally {
    await endAnthropicSpan(span, output);
  }
}
