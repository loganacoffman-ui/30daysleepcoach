import {
  chooseDailyExperiment,
  consecutiveExperimentNights,
} from "./experimentCycle.ts";

Deno.test("continues a useful experiment until three attempted nights", () => {
  const history = [{ behavior: "Write tomorrow's priorities at 10:30.", behavior_date: "2026-09-02", status: "completed" }];
  const choice = chooseDailyExperiment({
    history,
    proposedBehavior: "Try four minutes of slow breathing.",
    proposedWhy: "Stress was elevated.",
  });
  if (choice.behavior !== history[0].behavior || choice.phase !== "continue") throw new Error("Expected the current experiment to continue");
});

Deno.test("advances after three attempted nights", () => {
  const behavior = "Write tomorrow's priorities at 10:30.";
  const history = [
    { behavior, behavior_date: "2026-09-02", status: "completed" },
    { behavior, behavior_date: "2026-09-01", status: "partial" },
    { behavior, behavior_date: "2026-08-31", status: "completed" },
  ];
  if (consecutiveExperimentNights(behavior, history) !== 3) throw new Error("Expected a three-night run");
  const choice = chooseDailyExperiment({ history, proposedBehavior: "Try four minutes of slow breathing.", proposedWhy: "Stress was elevated." });
  if (choice.phase !== "new") throw new Error("Expected a new experiment");
});

Deno.test("retires the legacy generic bedroom experiment", () => {
  const choice = chooseDailyExperiment({
    currentBehavior: "Keep your bedroom cool, dark, and quiet tonight.",
    history: [{
      behavior: "Keep your bedroom cool, dark, and quiet tonight.",
      behavior_date: "2026-09-02",
      status: "completed",
    }],
    proposedBehavior: "Put tomorrow's top three tasks on paper at 10:30, then leave the list outside the bedroom.",
    proposedWhy: "Work thoughts have appeared in recent check-ins.",
  });
  if (choice.phase !== "new" || choice.behavior.startsWith("Keep your bedroom")) throw new Error("Expected the generic experiment to be replaced");
});

Deno.test("does not overwrite a current user-approved experiment", () => {
  const current = "Read ten pages in a paper book at 10:30.";
  const choice = chooseDailyExperiment({ currentBehavior: current, history: [], proposedBehavior: "Try slow breathing.", proposedWhy: "Stress was elevated." });
  if (choice.behavior !== current || choice.phase !== "continue") throw new Error("Expected the current experiment to be preserved");
});
