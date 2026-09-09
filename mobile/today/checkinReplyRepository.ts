import { supabase } from '../supabase';
import { parseCheckinInterpretation, type CheckinInterpretation } from './checkinReplyContract';
import type { CheckinConversation } from './checkinConversation';

export async function interpretTypedCheckinReply(state: CheckinConversation, message: string): Promise<CheckinInterpretation> {
  if (state.step === 'sleep') throw new Error('Start with your sleep score.');
  // Keep the original experiment question and recent conversation in context.
  // Full, unabridged replies remain in the check-in draft and saved note.
  const turns = state.turns.length > 20 ? [state.turns[0], ...state.turns.slice(-19)] : state.turns;
  try {
    const { data, error } = await supabase.functions.invoke('sleep-coach', {
      body: { mode: 'checkin_reply', checkinReply: {
        step: state.step, message,
        turns: turns.map(turn => ({ ...turn, content: turn.content.slice(0, 4000) })),
      } },
    });
    if (error || !data?.interpretation) throw new Error('Missing interpretation');
    return parseCheckinInterpretation(state.step, data.interpretation);
  } catch {
    throw new Error('Your coach couldn’t read that reply right now. It’s still here—try sending again.');
  }
}
