export const EXPERIMENT_CHANGE_TOOL = "sleep_experiment_propose_change";

export type CoachToolStatus =
  | "pending"
  | "completed"
  | "cancelled"
  | "failed"
  | "expired";

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export type CoachToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    additionalProperties: false;
    properties: Record<string, {
      type: "string";
      description: string;
      minLength: number;
      maxLength: number;
    }>;
    required: string[];
  };
};

export type ExperimentChangeModelInput = {
  replacement_experiment: string;
  user_reason: string;
  coach_rationale: string;
};

export type ExperimentChangeInput = ExperimentChangeModelInput & {
  behavior_commitment_id: string;
  behavior_date: string;
  previous_experiment: string;
};

export type CoachToolCallRecord = {
  id: string;
  tool_name: string;
  status: CoachToolStatus;
  input: unknown;
  output?: unknown;
  requires_confirmation: boolean;
  expires_at: string;
};

export type PublicCoachToolCall = {
  id: string;
  name: string;
  status: CoachToolStatus;
  requiresConfirmation: boolean;
  expiresAt: string;
  proposal: {
    previousExperiment: string;
    replacementExperiment: string;
    userReason: string;
    coachRationale: string;
  };
};

export const COACH_TOOL_DEFINITIONS: CoachToolDefinition[] = [
  {
    name: EXPERIMENT_CHANGE_TOOL,
    description:
      "Propose a replacement for tonight's active, incomplete sleep experiment. Use this only when the user explicitly asks to modify, change, overhaul, replace, or pick a different experiment for tonight and has explained why the current experiment does not work for them. Choose one small, concrete behavioral experiment using your sleep-coaching expertise, the user's stated reason, and their current sleep context. This tool only creates a proposal; it never applies the change, and the user must confirm before execution. Do not call it for past, completed, or future experiments, and ask for the user's reason first if they have not supplied one.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        replacement_experiment: {
          type: "string",
          description:
            "One specific, feasible behavioral experiment for tonight, written as a direct action. It must account for why the current experiment is a poor fit.",
          minLength: 1,
          maxLength: 300,
        },
        user_reason: {
          type: "string",
          description:
            "A concise, faithful paraphrase of the user's explanation for rejecting or changing the current experiment. Do not invent a reason.",
          minLength: 1,
          maxLength: 500,
        },
        coach_rationale: {
          type: "string",
          description:
            "A concise sleep-coaching rationale for why the replacement is a better fit tonight, grounded in the user's reason and available context without making a diagnosis.",
          minLength: 1,
          maxLength: 500,
        },
      },
      required: [
        "replacement_experiment",
        "user_reason",
        "coach_rationale",
      ],
    },
  },
];

const requiredString = (
  value: Record<string, unknown>,
  key: string,
  maxLength: number,
): string => {
  const result = typeof value[key] === "string" ? value[key].trim() : "";
  if (!result || result.length > maxLength) {
    throw new Error(`Invalid ${key} supplied to coach tool`);
  }
  return result;
};

export const getToolUse = (
  content: AnthropicContentBlock[],
): Extract<AnthropicContentBlock, { type: "tool_use" }> | null =>
  (content.find((block) => block.type === "tool_use") as
    | Extract<AnthropicContentBlock, { type: "tool_use" }>
    | undefined) ?? null;

export const getTextContent = (content: AnthropicContentBlock[]): string =>
  content
    .filter((
      block,
    ): block is Extract<AnthropicContentBlock, { type: "text" }> =>
      block.type === "text"
    )
    .map((block) => block.text)
    .join("\n")
    .trim();

export const validateCoachToolInput = (
  name: string,
  input: unknown,
): ExperimentChangeModelInput => {
  if (name !== EXPERIMENT_CHANGE_TOOL) {
    throw new Error(`Unsupported coach tool: ${name}`);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Coach tool input must be an object");
  }
  const value = input as Record<string, unknown>;
  return {
    replacement_experiment: requiredString(
      value,
      "replacement_experiment",
      300,
    ),
    user_reason: requiredString(value, "user_reason", 500),
    coach_rationale: requiredString(value, "coach_rationale", 500),
  };
};

export const toPublicCoachToolCall = (
  record: CoachToolCallRecord,
): PublicCoachToolCall => {
  if (
    !record.input || typeof record.input !== "object" ||
    Array.isArray(record.input)
  ) {
    throw new Error("Stored coach tool input is invalid");
  }
  const input = record.input as Record<string, unknown>;
  return {
    id: record.id,
    name: record.tool_name,
    status: record.status,
    requiresConfirmation: record.requires_confirmation,
    expiresAt: record.expires_at,
    proposal: {
      previousExperiment: requiredString(input, "previous_experiment", 12_000),
      replacementExperiment: requiredString(
        input,
        "replacement_experiment",
        300,
      ),
      userReason: requiredString(input, "user_reason", 500),
      coachRationale: requiredString(input, "coach_rationale", 500),
    },
  };
};

export const experimentProposalText = (
  input: ExperimentChangeInput,
): string =>
  `I can replace tonight's experiment with: ${input.replacement_experiment} ${input.coach_rationale} Confirm the change when you're ready.`;

export const experimentCompletionText = (replacement: string): string =>
  `Done — tonight's experiment is now: ${replacement}`;

export const experimentCancellationText = (): string =>
  "No change made. Tonight's current experiment is still in place.";
