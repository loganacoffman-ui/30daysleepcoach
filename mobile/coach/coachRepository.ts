import type { User } from '@supabase/supabase-js';

import type { SleepProfile } from '../onboarding/types';
import { supabase } from '../supabase';

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
export type CoachExperience = {
  conversationId: string;
  messages: CoachMessage[];
  dailyCoaching: DailyCoaching | null;
  hasCheckedInToday: boolean;
  hasOuraData: boolean;
};
export type CoachHomeState = {
  hasCheckedInToday: boolean;
  feeling: number | null;
  sleepScore: number | null;
};

type CoachContext = {
  date: string;
  profile: { primary_concern: string; typical_bedtime: string; typical_wake_time: string; timezone: string };
  subjective_checkins: unknown[];
  experiment_adherence: unknown[];
  oura_sleep: Array<{ day: string; score?: number }>;
};

export const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const daysAgo = (count: number) => {
  const date = new Date();
  date.setDate(date.getDate() - count);
  return localDate(date);
};

export const loadCoachHomeState = async (user: User): Promise<CoachHomeState> => {
  const [checkinResult, ouraResult] = await Promise.all([
    supabase
      .from('daily_checkins')
      .select('checkin_date, feeling')
      .eq('user_id', user.id)
      .eq('checkin_date', localDate())
      .limit(1)
      .maybeSingle(),
    supabase.functions.invoke<{ data?: Array<{ day: string; score?: number }> }>('oura-proxy', {
      body: { endpoint: 'daily_sleep', start_date: daysAgo(2), end_date: localDate() },
    }),
  ]);
  if (checkinResult.error) throw checkinResult.error;
  const latestOuraDay = ouraResult.error
    ? null
    : [...(ouraResult.data?.data ?? [])]
      .filter(item => typeof item.score === 'number' && typeof item.day === 'string')
      .sort((a, b) => b.day.localeCompare(a.day))[0] ?? null;
  return {
    hasCheckedInToday: Boolean(checkinResult.data),
    feeling: typeof checkinResult.data?.feeling === 'number' ? checkinResult.data.feeling : null,
    sleepScore: latestOuraDay?.score ?? null,
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
  ) {
    return null;
  }
  return {
    id: toolCall.id,
    name: toolCall.tool_name,
    status: toolCall.status,
    requiresConfirmation: toolCall.requires_confirmation,
    expiresAt: toolCall.expires_at,
    proposal: {
      previousExperiment,
      replacementExperiment,
      userReason,
      coachRationale,
    },
  };
};

const mapCoachMessages = (
  messages: StoredCoachMessage[],
  toolCalls: StoredCoachToolCall[],
): CoachMessage[] => {
  const callsById = new Map(
    toolCalls
      .map(storedToolCallToCoachToolCall)
      .filter((toolCall): toolCall is CoachToolCall => toolCall !== null)
      .map(toolCall => [toolCall.id, toolCall]),
  );
  return messages.map(message => {
    const toolCallId = message.metadata?.tool_action
      ? undefined
      : message.metadata?.tool_call_id;
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
  const [checkinsResult, commitmentsResult, ouraResult] = await Promise.all([
    supabase.from('daily_checkins').select('checkin_date, feeling, suspected_factor, note, completed_at').eq('user_id', user.id).order('checkin_date', { ascending: false }).limit(14),
    supabase.from('behavior_commitments').select('behavior_date, behavior, status').eq('user_id', user.id).order('behavior_date', { ascending: false }).limit(14),
    supabase.functions.invoke<{ data?: Array<{ day: string; score?: number }> }>('oura-proxy', {
      body: { endpoint: 'daily_sleep', start_date: daysAgo(14), end_date: localDate() },
    }),
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
    subjective_checkins: checkinsResult.data ?? [],
    experiment_adherence: commitmentsResult.data ?? [],
    oura_sleep: ouraResult.error ? [] : ouraResult.data?.data ?? [],
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

export const createCoachConversation = async (user: User) => {
  const created = await supabase
    .from('coach_conversations')
    .insert({ user_id: user.id, title: `Sleep coaching ${localDate()}` })
    .select('id')
    .single();
  if (created.error || !created.data) {
    throw created.error ?? new Error('Could not start your coaching conversation.');
  }
  return created.data.id as string;
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

  const [messagesResult, toolCallsResult] = await Promise.all([
    supabase
      .from('coach_messages')
      .select('id, role, content, created_at, metadata')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(60),
    supabase
      .from('coach_tool_calls')
      .select('id, tool_name, status, input, requires_confirmation, expires_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true }),
  ]);
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

export const loadCoachExperience = async (user: User, profile: SleepProfile): Promise<CoachExperience> => {
  const [conversationId, context] = await Promise.all([ensureConversation(user), loadCoachContext(user, profile)]);
  const [messagesResult, toolCallsResult] = await Promise.all([
    supabase.from('coach_messages').select('id, role, content, created_at, metadata').eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(100),
    supabase.from('coach_tool_calls').select('id, tool_name, status, input, requires_confirmation, expires_at').eq('conversation_id', conversationId).order('created_at', { ascending: true }),
  ]);
  if (messagesResult.error) throw messagesResult.error;
  if (toolCallsResult.error) throw toolCallsResult.error;
  let dailyCoaching: DailyCoaching | null = null;
  try { dailyCoaching = await loadDailyCoaching(user, profile, context); } catch { /* Chat remains useful if today's artifact is unavailable. */ }
  return {
    conversationId,
    messages: mapCoachMessages(
      (messagesResult.data ?? []) as StoredCoachMessage[],
      (toolCallsResult.data ?? []) as StoredCoachToolCall[],
    ),
    dailyCoaching,
    hasCheckedInToday: context.subjective_checkins.some(checkin => typeof checkin === 'object' && checkin !== null && 'checkin_date' in checkin && checkin.checkin_date === localDate()),
    hasOuraData: context.oura_sleep.length > 0,
  };
};

export const sendCoachMessage = async (user: User, profile: SleepProfile, conversationId: string, content: string): Promise<CoachMessage> => {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('Ask your coach a question first.');
  const { data, error } = await supabase.functions.invoke<{
    status?: string;
    message?: { id: string; role: 'assistant'; content: string; created_at: string };
    toolCall?: CoachToolCall | null;
  }>('sleep-coach', {
    body: {
      mode: 'coach_chat',
      conversationId,
      message: trimmed,
      clientRequestId: createRequestId(),
      coachContext: await loadCoachContext(user, profile),
    },
  });
  if (error || data?.status !== 'ok' || !data.message) throw error ?? new Error('Your coach could not respond. Please try again.');
  return {
    id: data.message.id,
    role: 'assistant',
    content: data.message.content,
    createdAt: data.message.created_at,
    toolCall: data.toolCall ?? undefined,
  };
};

export const resolveCoachToolCall = async (
  conversationId: string,
  toolCallId: string,
  action: 'confirm' | 'cancel',
): Promise<{ messages: CoachMessage[]; toolCall: CoachToolCall }> => {
  const { data, error } = await supabase.functions.invoke<{
    status?: string;
    messages?: Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      created_at: string;
    }>;
    toolCall?: CoachToolCall;
  }>('sleep-coach', {
    body: {
      mode: 'coach_tool_action',
      conversationId,
      toolCallId,
      action,
    },
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
