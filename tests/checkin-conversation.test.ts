import { describe, expect, it } from 'vitest';
import { answerCheckin, appendCheckinReply, checkinChoices, checkinDraft, checkinNote, initialCheckin, MAX_CHECKIN_NOTE_LENGTH, remainingCheckinCharacters, startCheckin } from '../mobile/today/checkinConversation';
import { readFileSync } from 'node:fs';
import type { CheckinInterpretation } from '../mobile/today/checkinReplyContract';

const understood = (answer: string | null, finish = false): CheckinInterpretation => ({ addressed: true, answer, finish, clarification: null });
const clarify = (question: string): CheckinInterpretation => ({ addressed: false, answer: null, finish: false, clarification: question });

describe('conversational mobile check-in', () => {
  it('keeps chat questions behind the sleep-data step', () => {
    expect(checkinChoices(initialCheckin.step)).toEqual([]);
    expect(answerCheckin(initialCheckin, 'tired')).toBe(initialCheckin);
    expect(checkinDraft(initialCheckin)).toBeNull();
  });

  it('advances inline choices immediately and keeps the experiment identity', () => {
    const start = startCheckin('Read before bed', 'experiment-1');
    expect(start.step).toBe('adherence');
    expect(start.turns).toHaveLength(1);
    const feeling = answerCheckin(start, 'Partly', 'partial');
    expect(feeling.adherence).toBe('partial');
    expect(feeling.commitmentId).toBe('experiment-1');
    expect(feeling.step).toBe('feeling');
    expect(startCheckin().step).toBe('feeling');
  });

  it('advances Skipped it when the LLM identifies the answer, without repeating the question', () => {
    const state = answerCheckin(startCheckin('Take a five-minute walk'), 'Skipped it', undefined, understood('skipped'));
    expect(state.adherence).toBe('skipped');
    expect(state.step).toBe('feeling');
    expect(state.turns.at(-1)?.content).toBe('How are you feeling this morning?');
    expect(state.turns[1].content).toBe('Skipped it');
  });

  it('uses contextual model interpretation even for replies the former keyword parser rejected', () => {
    const state = answerCheckin(startCheckin(), 'Not as tired as yesterday, pretty refreshed actually', undefined, understood('rested'));
    expect(state.morningFeeling).toBe('rested');
    expect(state.step).toBe('factor');
  });

  it('never classifies typed text locally when model interpretation is missing or invalid', () => {
    const state = startCheckin();
    expect(() => answerCheckin(state, 'Tired')).toThrow();
    expect(() => answerCheckin(state, 'Tired', undefined, understood('completed'))).toThrow();
    expect(state.turns).toHaveLength(1);
  });

  it('accepts rich answers outside the factor categories and preserves long notes', () => {
    let state = answerCheckin(startCheckin(), 'Rested', 'rested');
    state = answerCheckin(state, 'The baby was sick and I stayed up with her.', undefined, understood(null));
    expect(state.step).toBe('details');
    expect(state.suspectedFactor).toBeUndefined();
    const detail = 'Here is more context about my night. '.repeat(80);
    state = answerCheckin(state, detail, undefined, understood(null));
    state = answerCheckin(state, 'And one last thing.', undefined, understood(null));
    const draft = checkinDraft(state, 0)!;
    expect(draft.note).toContain(detail.trim());
    expect(draft.note).toContain('The baby was sick and I stayed up with her.');
    expect(draft.note).toContain('And one last thing.');
    expect(draft.manualSleepScore).toBe(0);
  });

  it('uses one model-written clarification only when the answer is not understood', () => {
    const question = 'How did you feel when you woke up today?';
    const state = answerCheckin(startCheckin(), 'My partner was exhausted yesterday', undefined, clarify(question));
    expect(state.step).toBe('feeling');
    expect(state.morningFeeling).toBeUndefined();
    expect(state.turns.at(-1)?.content).toBe(question);
    expect(state.turns[1].content).toBe('My partner was exhausted yesterday');
  });

  it('keeps detail submitted alongside an explicit choice', () => {
    const state = answerCheckin(startCheckin(), 'Tired. I had a long night.', 'tired');
    expect(state.morningFeeling).toBe('tired');
    expect(state.turns[1].content).toBe('Tired. I had a long night.');
    expect(checkinDraft(state)).toBeNull();
  });

  it('uses model finish intent and keeps unsent detail when Finish is tapped', () => {
    const state = answerCheckin(answerCheckin(startCheckin(), 'Great', 'great'), 'Not sure', 'unknown');
    const continuing = answerCheckin(state, 'I was done with work late.', undefined, understood(null));
    expect(continuing.turns.at(-1)?.role).toBe('assistant');
    const done = answerCheckin(continuing, 'That about covers it for today', undefined, understood(null, true));
    expect(done.turns.at(-1)?.role).toBe('user');
    const finished = appendCheckinReply(done, 'One last detail in the composer');
    expect(checkinDraft(finished)?.note).toContain('One last detail in the composer');
    expect(checkinDraft(finished)?.morningFeeling).toBe('great');
  });

  it('saves only user prose in the journal and retains coach questions separately', () => {
    let state = answerCheckin(startCheckin(), 'My partner was tired', undefined, clarify('How did you feel yourself?'));
    state = answerCheckin(state, 'I felt rested.', 'rested');
    state = answerCheckin(state, 'The room was cool.', undefined, understood('temperature'));
    expect(checkinDraft(state)?.note).toBe('My partner was tired\n\nI felt rested.\n\nThe room was cool.');
    expect(state.turns.some(turn => turn.role === 'assistant' && turn.content === 'How did you feel yourself?')).toBe(true);
  });

  it('enforces the aggregate note limit including separators without truncating or changing prior replies', () => {
    const state = { ...startCheckin(), step: 'details' as const, morningFeeling: 'rested' as const, turns: [] };
    const full = appendCheckinReply(state, 'x'.repeat(MAX_CHECKIN_NOTE_LENGTH));
    expect(checkinDraft(full)?.note?.length).toBe(MAX_CHECKIN_NOTE_LENGTH);
    expect(remainingCheckinCharacters(full)).toBe(0);
    expect(() => appendCheckinReply(full, 'One more thought')).toThrow('20,000 characters');
    expect(checkinNote(full)).toBe('x'.repeat(MAX_CHECKIN_NOTE_LENGTH));
    const almostFull = appendCheckinReply(state, 'x'.repeat(MAX_CHECKIN_NOTE_LENGTH - 2));
    expect(() => appendCheckinReply(almostFull, 'y')).toThrow('20,000 characters');
    expect(checkinDraft(full)?.morningFeeling).toBe('rested'); // Finishing without more text still works.
  });

  it('uses Unicode character counts matching PostgreSQL and the migration limit', () => {
    const migration = readFileSync(new URL('../supabase/migrations/20260909013346_conversational_checkin_notes.sql', import.meta.url), 'utf8');
    expect(Number(migration.match(/char_length\(note\) <= (\d+)/)?.[1])).toBe(MAX_CHECKIN_NOTE_LENGTH);
    const state = { ...startCheckin(), step: 'details' as const, morningFeeling: 'rested' as const, turns: [] };
    const full = appendCheckinReply(state, '🌙'.repeat(MAX_CHECKIN_NOTE_LENGTH));
    expect([...checkinDraft(full)!.note!]).toHaveLength(MAX_CHECKIN_NOTE_LENGTH);
    expect(() => appendCheckinReply(full, '🌙')).toThrow();
  });
});
