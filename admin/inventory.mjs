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
    && (scenario.feedback ? Number(user.feedback_count) >= scenario.checkinCount : Number(user.feedback_count) === 0);
}
export function filterInventory(users, scenario, filters) {
  return users.filter(user => user.email.toLowerCase().includes(filters.search.trim().toLowerCase())
    && (filters.confirmation === 'all' || user.email_confirmed === (filters.confirmation === 'confirmed'))
    && (filters.onboarding === 'all' || user.onboarding_complete === (filters.onboarding === 'complete'))
    && (!filters.matchesOnly || matchesState(user, scenario)))
    .sort((a, b) => Number(matchesState(b, scenario)) - Number(matchesState(a, scenario)));
}
