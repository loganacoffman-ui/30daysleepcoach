// Cache only the stable instructions. User evidence stays outside this prefix,
// so edits never require waiting for a provider cache to expire.
export function cachedSystemPrompt(instructions: string, context = "") {
  return [
    { type: "text" as const, text: instructions, cache_control: { type: "ephemeral" as const } },
    ...(context ? [{ type: "text" as const, text: context }] : []),
  ];
}
