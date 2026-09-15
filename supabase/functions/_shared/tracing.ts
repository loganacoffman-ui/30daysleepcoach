// Braintrust tracing for the coach's Anthropic calls.
// In production: supabase secrets set BRAINTRUST_API_KEY=...
import { initLogger, NOOP_SPAN, type Span } from "npm:braintrust@3.32.0";

// Without a key, tracing stays off and the coach behaves exactly as before.
const apiKey = (() => {
  try {
    return Deno.env.get("BRAINTRUST_API_KEY");
  } catch {
    return undefined;
  }
})();

const logger = apiKey ? initLogger({ projectName: "My Project", apiKey }) : null;

/**
 * An Anthropic Messages request. `messages` is logged as the span input when
 * present, otherwise the whole payload is.
 */
type AnthropicRequest = {
  model?: string;
  max_tokens?: number;
  messages?: unknown;
  [key: string]: unknown;
};

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
      input: request.messages ?? request,
      metadata: { model: request.model, max_tokens: request.max_tokens },
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
