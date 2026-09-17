import type { CoachHomeState } from './coachRepository';

export function coachHomeExperience(state: CoachHomeState | null, displayName: string) {
  const name = displayName.trim().split(/\s+/)[0];
  const firstCheckin = state?.checkinCount === 0;
  // Stay useful without history, including while context loads or is unavailable.
  const gettingStarted = !state || state.checkinCount < 3;
  const checkedIn = state?.hasCheckedInToday === true;

  return {
    title: firstCheckin
      ? name ? `Welcome, ${name}.` : 'Welcome to your sleep coach.'
      : checkedIn ? 'You’ve checked in. Nicely done.'
      : name ? `Hi, ${name}.` : 'Let’s take it one night at a time.',
    introduction: firstCheckin
      ? 'You’re all set. Start with a quick check-in about last night, then we’ll take the next small step together.'
      : null,
    checkinEyebrow: checkedIn ? '✓ CHECK-IN COMPLETE' : firstCheckin ? 'START HERE' : 'YOUR NEXT STEP',
    checkinDescription: checkedIn
      ? 'Your check-in is saved. Explore your coach’s guidance for tonight.'
      : 'Share how you slept and how you feel. No wearable needed.',
    prompts: gettingStarted
      ? ['How do these 30 days work?', 'Help me get started with tonight’s experiment', 'What should I pay attention to this week?']
      : ['How is my sleep trending?', 'Help me prepare for tonight', 'What’s working?'],
  };
}
