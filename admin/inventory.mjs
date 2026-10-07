export const stepLabels = {
  intro: 'Not started', concern: 'Choosing a concern', window: 'Setting sleep times',
  followup: 'Answering follow-up', results: 'Viewing results', wearable: 'Connecting a wearable',
  reminder: 'Setting a reminder', complete: 'Complete',
};
export const concernLabels = {
  falling_asleep: 'Falling asleep', night_waking: 'Waking during the night', early_waking: 'Waking too early',
  unrefreshed: 'Waking unrefreshed', irregular_schedule: 'Irregular schedule',
};
// Use current database state. The saved seed options may be stale after testing.
export function matchesState(user, scenario) {
  return user.status === 'ready' && user.manageable === true
    && user.email_confirmed === scenario.emailConfirmed
    && user.onboarding_step === scenario.onboardingStep
    && Number(user.checkin_count) === scenario.checkinCount
    && (['intro', 'concern'].includes(scenario.onboardingStep) || user.primary_concern === scenario.primaryConcern)
    && Number(user.chat_count ?? 0) === (scenario.chatCount ?? 0)
    && Number(user.message_count ?? 0) === (scenario.chatCount ?? 0) * (scenario.chatTurns ?? 3) * 2
    && Number(user.wearable_count ?? 0) === (scenario.wearableCount ?? 0)
    && Number(user.feedback_count) === expectedFeedbackCount(scenario)
    && (user.options?.memoryScenario ?? 'none') === (scenario.memoryScenario ?? 'none')
    && (user.options?.customMemories ?? '').trim() === (scenario.customMemories ?? '').trim();
}
export function filterInventory(users, scenario, filters) {
  return users.filter(user => user.email.toLowerCase().includes(filters.search.trim().toLowerCase())
    && (filters.confirmation === 'all' || user.email_confirmed === (filters.confirmation === 'confirmed'))
    && (filters.onboarding === 'all' || user.onboarding_complete === (filters.onboarding === 'complete'))
    && (!filters.matchesOnly || matchesState(user, scenario)))
    .sort((a, b) => Number(matchesState(b, scenario)) - Number(matchesState(a, scenario)));
}

export function expectedFeedbackCount(scenario) {
  if (!scenario.feedback) return 0;
  const count = scenario.checkinCount;
  const wearable = scenario.wearableCount ?? 0;
  const mode = scenario.scoreMode ?? 'manual';
  return Array.from({ length: count }, (_, i) => mode === 'manual'
    || (mode === 'mixed' && i % 2 === 0) || i >= count - wearable).filter(Boolean).length;
}
