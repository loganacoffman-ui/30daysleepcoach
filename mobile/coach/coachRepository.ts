import type { User } from '@supabase/supabase-js';
import { fetch as expoFetch } from 'expo/fetch';

import { syncAppleHealthForDate } from '../healthkit/appleHealth';
import type { SleepProfile } from '../onboarding/types';
import {
  isUnavailableSleepSchemaError,
  loadPreferredSleepSource,
} from '../sleep/sourcePreference';
import { resolveWearableSleepHistory } from '../sleep/sourceSelection';
import type { WearableSleep } from '../sleep/sourceSelection';
import { supabase, supabasePublicKey, supabaseUrl } from '../supabase';
import type { MorningFeeling } from '../today/feeling';
import { normalizeMorningFeeling } from '../today/feeling';

export type DailyCoaching = { pattern: string; meaning: string; action: string; why: string; generatedAt: string };
export type CoachToolCallStatus = 'pending' | 'completed' | 'cancelled' | 'failed' | 'expired';
export type CoachToolCall = {
  id: string;
  name: string;
  status: CoachToolCallStatus;
  requiresConfirmation: boolean;
  expiresAt: string;
  proposal: {
    previousExperiment: string;
    replacementExperiment: string;
    userReason: string;
    coachRationale: string;
  };
};
export type CoachMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  pending?: boolean;
  toolCall?: CoachToolCall;
};
export type CoachConversationSummary = { id: string; title: string; updatedAt: string };
export type CoachExperience = {
  conversationId: string;
  messages: CoachMessage[];
  dailyCoaching: DailyCoaching | null;
  hasCheckedInToday: boolean;
  hasWearableData: boolean;
};
export type CoachHomeState = {
  hasCheckedInToday: boolean;
  morningFeeling: MorningFeeling | null;
  sleepScore: number | null;
  previousSleepScore: number | null;
  sleepSource: 'apple_health' | 'oura' | 'manual' | 'missing';
  suspectedFactor: string | null;
};

type CoachContext = {
  date: string;
  profile: { primary_concern: string; typical_bedtime: string; typical_wake_time: string; timezone: string };
  subjective_checkins: unknown[];
  experiment_adherence: unknown[];
  wearable_sleep: WearableSleep[];
};

export const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const daysAgo = (count: number) => {
  const date = new Date();
  date.setDate(date.getDate() - count);
  return localDate(date);
};

const loadWearableSleep = async (user: User, dayCount: number): Promise<WearableSleep[]> => {
  await syncAppleHealthForDate(user.id).catch(() => undefined);
  const [appleResult, preferredSleepSource, ouraResult] = await Promise.all([
    supabase
      .from('sleep_nights')
      .select('sleep_date, sleep_score, score_version, total_sleep_minutes')
      .eq('user_id', user.id)
      .eq('provider', 'apple_health')
      .gte('sleep_date', daysAgo(dayCount))
      .order('sleep_date', { ascending: false }),
    loadPreferredSleepSource(user.id),
    supabase.functions.invoke<{ data?: Array<{ day: string; score?: number }> }>('oura-proxy', {
      body: { endpoint: 'daily_sleep', start_date: daysAgo(dayCount), end_date: localDate() },
    }),
  ]);
  if (appleResult.error && !isUnavailableSleepSchemaError(appleResult.error)) {
    throw appleResult.error;
  }

  const rows: WearableSleep[] = (appleResult.data ?? [])
    .filter(row => typeof row.sleep_score === 'number')
    .map(row => ({
      day: row.sleep_date,
      score: row.sleep_score as number,
      source: 'apple_health',
      scoreVersion: row.score_version,
      totalSleepMinutes: row.total_sleep_minutes,
    }));
  if (!ouraResult.error) {
    for (const row of ouraResult.data?.data ?? []) {
      if (typeof row.day === 'string' && typeof row.score === 'number') {
        rows.push({ day: row.day, score: row.score, source: 'oura' });
      }
    }
  }
  return resolveWearableSleepHistory(
    rows,
    preferredSleepSource,
  );
};

export const loadCoachHomeState = async (user: User): Promise<CoachHomeState> => {
  const [checkinResult, wearableSleep] = await Promise.all([
    supabase
      .from('daily_checkins')
      .select('checkin_date, morning_feeling, feeling, manual_sleep_score, manual_sleep_submitted_at, suspected_factor, note')
      .eq('user_id', user.id)
      .order('checkin_date', { ascending: false })
      .limit(7),
    loadWearableSleep(user, 7),
  ]);
  if (checkinResult.error) throw checkinResult.error;
  const checkins = checkinResult.data ?? [];
  const todayCheckin = checkins.find(item => item.checkin_date === localDate()) ?? null;
  const currentWearable = wearableSleep.find(item => item.day === localDate()) ?? null;
  const manualScore = typeof todayCheckin?.manual_sleep_score === 'number' && todayCheckin.manual_sleep_submitted_at
    ? todayCheckin.manual_sleep_score
    : null;
  return {
    hasCheckedInToday: Boolean(todayCheckin),
    morningFeeling: normalizeMorningFeeling(todayCheckin?.morning_feeling, todayCheckin?.feeling),
    sleepScore: currentWearable?.score ?? manualScore,
    previousSleepScore: currentWearable
      ? wearableSleep.find(item => item.day < currentWearable.day)?.score ?? null
      : wearableSleep[0]?.score ?? null,
    sleepSource: currentWearable?.source ?? (manualScore !== null ? 'manual' : 'missing'),
    suspectedFactor: typeof todayCheckin?.suspected_factor === 'string'
      ? todayCheckin.suspected_factor
      : null,
  };
};

const createRequestId = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
  const random = Math.floor(Math.random() * 16);
  return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
});

type StoredCoachMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

type StoredCoachToolCall = {
  id: string;
  tool_name: string;
  status: CoachToolCallStatus;
  input: Record<string, unknown>;
  requires_confirmation: boolean;
  expires_at: string;
};

const storedToolCallToCoachToolCall = (toolCall: StoredCoachToolCall): CoachToolCall | null => {
  const previousExperiment = toolCall.input.previous_experiment;
  const replacementExperiment = toolCall.input.replacement_experiment;
  const userReason = toolCall.input.user_reason;
  const coachRationale = toolCall.input.coach_rationale;
  if (
    typeof previousExperiment !== 'string'
    || typeof replacementExperiment !== 'string'
    || typeof userReason !== 'string'
    || typeof coachRationale !== 'string'
  ) return null;
  return {
    id: toolCall.id,
    name: toolCall.tool_name,
    status: toolCall.status,
    requiresConfirmation: toolCall.requires_confirmation,
    expiresAt: toolCall.expires_at,
    proposal: { previousExperiment, replacementExperiment, userReason, coachRationale },
  };
};

const mapCoachMessages = (messages: StoredCoachMessage[], toolCalls: StoredCoachToolCall[]): CoachMessage[] => {
  const callsById = new Map(
    toolCalls
      .map(storedToolCallToCoachToolCall)
      .filter((toolCall): toolCall is CoachToolCall => toolCall !== null)
      .map(toolCall => [toolCall.id, toolCall]),
  );
  return messages.map(message => {
    const toolCallId = message.metadata?.tool_action ? undefined : message.metadata?.tool_call_id;
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.created_at,
      toolCall: typeof toolCallId === 'string' ? callsById.get(toolCallId) : undefined,
    };
  });
};

const loadCoachContext = async (user: User, profile: SleepProfile): Promise<CoachContext> => {
  const [checkinsResult, commitmentsResult, wearableSleep] = await Promise.all([
    supabase.from('daily_checkins').select('checkin_date, morning_feeling, feeling, manual_sleep_score, manual_sleep_submitted_at, suspected_factor, note, completed_at').eq('user_id', user.id).order('checkin_date', { ascending: false }).limit(14),
    supabase.from('behavior_commitments').select('behavior_date, behavior, status').eq('user_id', user.id).order('behavior_date', { ascending: false }).limit(14),
    loadWearableSleep(user, 14),
  ]);
  if (checkinsResult.error) throw checkinsResult.error;
  if (commitmentsResult.error) throw commitmentsResult.error;
  return {
    date: localDate(),
    profile: {
      primary_concern: profile.primaryConcern,
      typical_bedtime: profile.typicalBedtime,
      typical_wake_time: profile.typicalWakeTime,
      timezone: profile.timezone,
    },
    subjective_checkins: (checkinsResult.data ?? []).map(({ feeling, morning_feeling, ...checkin }) => ({
      ...checkin,
      morning_feeling: normalizeMorningFeeling(morning_feeling, feeling),
    })),
    experiment_adherence: commitmentsResult.data ?? [],
    wearable_sleep: wearableSleep,
  };
};

const ensureConversation = async (user: User) => {
  const existing = await supabase.from('coach_conversations').select('id').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id as string;
  const created = await supabase.from('coach_conversations').insert({ user_id: user.id, title: 'Sleep coaching' }).select('id').single();
  if (created.error || !created.data) throw created.error ?? new Error('Could not start your coaching conversation.');
  return created.data.id as string;
};

export const createCoachConversation = async (user: User, firstMessage?: string) => {
  const title = firstMessage?.trim().replace(/\s+/g, ' ').slice(0, 72) || `Sleep coaching ${localDate()}`;
  const created = await supabase
    .from('coach_conversations')
    .insert({ user_id: user.id, title })
    .select('id')
    .single();
  if (created.error || !created.data) {
    throw created.error ?? new Error('Could not start your coaching conversation.');
  }
  return created.data.id as string;
};

export const listCoachConversations = async (user: User): Promise<CoachConversationSummary[]> => {
  const result = await supabase
    .from('coach_conversations')
    .select('id, title, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(40);
  if (result.error) throw result.error;
  return (result.data ?? []).map(conversation => ({
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updated_at,
  }));
};

export const loadCoachConversation = async (user: User, conversationId: string): Promise<CoachMessage[]> => {
  const conversation = await supabase
    .from('coach_conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (conversation.error) throw conversation.error;
  if (!conversation.data) throw new Error('That coaching conversation is no longer available.');

  const [messagesResult, toolCallsResult] = await Promise.all([supabase
    .from('coach_messages')
    .select('id, role, content, created_at, metadata')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(60), supabase
    .from('coach_tool_calls')
    .select('id, tool_name, status, input, requires_confirmation, expires_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })]);
  if (messagesResult.error) throw messagesResult.error;
  if (toolCallsResult.error) throw toolCallsResult.error;
  return mapCoachMessages(
    (messagesResult.data ?? []) as StoredCoachMessage[],
    (toolCallsResult.data ?? []) as StoredCoachToolCall[],
  );
};

export const loadDailyCoaching = async (user: User, profile: SleepProfile, context?: CoachContext): Promise<DailyCoaching> => {
  const coachContext = context ?? await loadCoachContext(user, profile);
  const { data, error } = await supabase.functions.invoke<{
    status?: string;
    recommendation?: { pattern: string; meaning: string; action: string; why: string; generated_at: string };
  }>('sleep-coach', { body: { mode: 'daily_coach', cacheKey: `daily_coach_${localDate()}`, coachContext } });
  if (error || data?.status !== 'ok' || !data.recommendation) throw error ?? new Error('Your daily coaching could not be generated.');
  return {
    pattern: data.recommendation.pattern,
    meaning: data.recommendation.meaning,
    action: data.recommendation.action,
    why: data.recommendation.why,
    generatedAt: data.recommendation.generated_at,
  };
};

export const loadSleepProfileSummary = async (user: User, profile: SleepProfile): Promise<string> => {
  const { data, error } = await supabase.functions.invoke<{ status?: string; summary?: string }>('sleep-coach', {
    body: { mode: 'sleep_profile', coachContext: await loadCoachContext(user, profile) },
  });
  if (error || data?.status !== 'ok' || !data.summary?.trim()) {
    throw error ?? new Error('Your sleep profile could not be refreshed.');
  }
  return data.summary.trim();
};

export const loadCoachExperience = async (user: User, profile: SleepProfile): Promise<CoachExperience> => {
  const [conversationId, context] = await Promise.all([ensureConversation(user), loadCoachContext(user, profile)]);
  const messagesResult = await supabase.from('coach_messages').select('id, role, content, created_at').eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(100);
  if (messagesResult.error) throw messagesResult.error;
  let dailyCoaching: DailyCoaching | null = null;
  try { dailyCoaching = await loadDailyCoaching(user, profile, context); } catch { /* Chat remains useful if today's artifact is unavailable. */ }
  return {
    conversationId,
    messages: (messagesResult.data ?? []).map(message => ({ id: message.id, role: message.role as CoachMessage['role'], content: message.content, createdAt: message.created_at })),
    dailyCoaching,
    hasCheckedInToday: context.subjective_checkins.some(checkin => typeof checkin === 'object' && checkin !== null && 'checkin_date' in checkin && checkin.checkin_date === localDate()),
    hasWearableData: context.wearable_sleep.length > 0,
  };
};

export const sendCoachMessage = async (
  user: User,
  profile: SleepProfile,
  conversationId: string,
  content: string,
  onDelta?: (delta: string) => void,
): Promise<CoachMessage> => {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('Ask your coach a question first.');
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) throw sessionError ?? new Error('Please sign in again.');
  const response = await expoFetch(`${supabaseUrl}/functions/v1/sleep-coach`, {
    method: 'POST',
    headers: {
      apikey: supabasePublicKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mode: 'coach_chat', conversationId, message: trimmed,
      clientRequestId: createRequestId(), coachContext: await loadCoachContext(user, profile),
    }),
  });
  if (!response.ok) throw new Error((await response.text()) || 'Your coach could not respond.');
  if (!response.body) throw new Error('Your coach returned no response stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  type CompletedMessage = { id: string; role: 'assistant'; content: string; created_at: string };
  let completed: { message: CompletedMessage; toolCall?: CoachToolCall | null } | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as
        | { type: 'delta'; text: string }
        | { type: 'done'; message: CompletedMessage; toolCall?: CoachToolCall | null }
        | { type: 'error'; message: string };
      if (event.type === 'delta' && event.text) onDelta?.(event.text);
      if (event.type === 'done' && event.message) completed = { message: event.message, toolCall: event.toolCall };
      if (event.type === 'error') throw new Error(event.message || 'The coach stream ended unexpectedly.');
    }
  }
  if (!completed) throw new Error('The coach response was not saved.');
  return {
    id: completed.message.id,
    role: 'assistant',
    content: completed.message.content,
    createdAt: completed.message.created_at,
    toolCall: completed.toolCall ?? undefined,
  };
};

export const resolveCoachToolCall = async (
  conversationId: string,
  toolCallId: string,
  action: 'confirm' | 'cancel',
): Promise<{ messages: CoachMessage[]; toolCall: CoachToolCall }> => {
  const { data, error } = await supabase.functions.invoke<{
    status?: string;
    messages?: Array<{ id: string; role: 'user' | 'assistant'; content: string; created_at: string }>;
    toolCall?: CoachToolCall;
  }>('sleep-coach', {
    body: { mode: 'coach_tool_action', conversationId, toolCallId, action },
  });
  if (error || data?.status !== 'ok' || !data.messages || !data.toolCall) {
    throw error ?? new Error('The experiment change could not be updated. Please try again.');
  }
  return {
    messages: data.messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.created_at,
    })),
    toolCall: data.toolCall,
  };
};
