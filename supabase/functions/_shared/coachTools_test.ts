import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  EXPERIMENT_CHANGE_TOOL,
  getTextContent,
  getToolUse,
  toPublicCoachToolCall,
  validateCoachToolInput,
} from "./coachTools.ts";

Deno.test("coach tools find tool use without losing text blocks", () => {
  const content = [
    { type: "text" as const, text: "I have an alternative." },
    {
      type: "tool_use" as const,
      id: "toolu_123",
      name: EXPERIMENT_CHANGE_TOOL,
      input: {
        replacement_experiment: "Read for ten minutes.",
        user_reason: "Screens are needed for work.",
        coach_rationale: "Reading creates a lower-stimulation transition.",
      },
    },
  ];
  assertEquals(getTextContent(content), "I have an alternative.");
  assertEquals(getToolUse(content)?.id, "toolu_123");
});

Deno.test("coach tools validate experiment proposal input", () => {
  assertEquals(
    validateCoachToolInput(EXPERIMENT_CHANGE_TOOL, {
      replacement_experiment: "  Read for ten minutes. ",
      user_reason: " Screens are needed for work. ",
      coach_rationale: " A shorter transition is more realistic. ",
    }),
    {
      replacement_experiment: "Read for ten minutes.",
      user_reason: "Screens are needed for work.",
      coach_rationale: "A shorter transition is more realistic.",
    },
  );
});

Deno.test("coach tools reject unsupported tools and invented empty reasons", () => {
  assertThrows(() => validateCoachToolInput("unknown", {}));
  assertThrows(() =>
    validateCoachToolInput(EXPERIMENT_CHANGE_TOOL, {
      replacement_experiment: "Read for ten minutes.",
      user_reason: " ",
      coach_rationale: "A shorter transition is more realistic.",
    })
  );
});

Deno.test("coach tools expose only confirmation-safe proposal fields", () => {
  assertEquals(
    toPublicCoachToolCall({
      id: "call-1",
      tool_name: EXPERIMENT_CHANGE_TOOL,
      status: "pending",
      input: {
        behavior_commitment_id: "commitment-1",
        behavior_date: "2026-08-26",
        previous_experiment: "Stop screens 30 minutes before bed.",
        replacement_experiment: "Dim the lights for ten minutes.",
        user_reason: "I need my phone for an evening call.",
        coach_rationale: "Dimming the environment still lowers stimulation.",
      },
      output: null,
      requires_confirmation: true,
      expires_at: "2026-08-27T12:00:00.000Z",
    }),
    {
      id: "call-1",
      name: EXPERIMENT_CHANGE_TOOL,
      status: "pending",
      requiresConfirmation: true,
      expiresAt: "2026-08-27T12:00:00.000Z",
      proposal: {
        previousExperiment: "Stop screens 30 minutes before bed.",
        replacementExperiment: "Dim the lights for ten minutes.",
        userReason: "I need my phone for an evening call.",
        coachRationale: "Dimming the environment still lowers stimulation.",
      },
    },
  );
});
