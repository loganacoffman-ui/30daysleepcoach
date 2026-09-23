export type ExperimentAdherence = {
  behavior?: unknown;
  behavior_date?: unknown;
  status?: unknown;
};

export type DailyExperimentChoice = {
  behavior: string;
  why: string;
  phase: "continue" | "new";
};

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

export const chooseDailyExperiment = ({
  currentBehavior,
  history,
  proposedBehavior,
  proposedWhy,
}: {
  currentBehavior?: string | null;
  history: ExperimentAdherence[];
  proposedBehavior: string;
  proposedWhy: string;
}): DailyExperimentChoice => {
  const proposed = proposedBehavior.trim();
  // Today's saved experiment (including reported outcomes) is never silently
  // replaced by regeneration. Explicit changes go through the Coach tool flow.
  if (currentBehavior?.trim()) {
    const current = currentBehavior.trim();
    return {
      behavior: current,
      why: normalize(current) === normalize(proposed)
        ? proposedWhy.trim()
        : "Today's saved experiment stays unchanged; ask your coach if you need to change it.",
      phase: "continue",
    };
  }
  // Yesterday's action is evidence for the model, not a mandatory override.
  // The prompt weighs feasibility and reported outcomes, not a fixed night count.
  const latest = history.filter(item => typeof item.behavior === "string" && typeof item.behavior_date === "string")
    .sort((a, b) => String(b.behavior_date).localeCompare(String(a.behavior_date)))[0];
  return {
    behavior: proposed,
    why: proposedWhy.trim(),
    phase: typeof latest?.behavior === "string" && normalize(latest.behavior) === normalize(proposed) ? "continue" : "new",
  };
};
