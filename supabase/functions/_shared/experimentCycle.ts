export const EXPERIMENT_TARGET_NIGHTS = 3;

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

const legacyGenericExperiments = new Set([
  "keep your bedroom cool, dark, and quiet tonight.",
]);

const validHistory = (history: ExperimentAdherence[]) => history
  .filter((item): item is { behavior: string; behavior_date: string; status: string } =>
    typeof item.behavior === "string" &&
    typeof item.behavior_date === "string" &&
    typeof item.status === "string"
  )
  .sort((a, b) => b.behavior_date.localeCompare(a.behavior_date));

export const consecutiveExperimentNights = (
  behavior: string,
  history: ExperimentAdherence[],
): number => {
  const target = normalize(behavior);
  let count = 0;
  for (const item of validHistory(history)) {
    if (normalize(item.behavior) !== target) break;
    if (item.status === "completed" || item.status === "partial") count += 1;
  }
  return count;
};

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
  const prior = validHistory(history);
  const latest = prior[0];
  const proposed = proposedBehavior.trim();

  if (currentBehavior) {
    const current = currentBehavior.trim();
    const staleLegacy = legacyGenericExperiments.has(normalize(current));
    const completedRun = consecutiveExperimentNights(current, prior) >= EXPERIMENT_TARGET_NIGHTS;
    if (!staleLegacy && !completedRun) {
      return {
        behavior: current,
        why: "Keeping this steady for a few nights gives your coach a cleaner signal to learn from.",
        phase: "continue",
      };
    }
  }

  if (
    latest &&
    latest.status !== "skipped" &&
    !legacyGenericExperiments.has(normalize(latest.behavior))
  ) {
    const completedNights = consecutiveExperimentNights(latest.behavior, prior);
    if (completedNights < EXPERIMENT_TARGET_NIGHTS) {
      return {
        behavior: latest.behavior,
        why: "Repeating this for three nights helps separate a real pattern from one unusually good or bad night.",
        phase: "continue",
      };
    }
  }

  return { behavior: proposed, why: proposedWhy.trim(), phase: "new" };
};
