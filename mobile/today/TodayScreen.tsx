import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type GestureResponderEvent,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { User } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { loadDailyCoaching } from '../coach/coachRepository';
import { colors, layout } from '../design/theme';
import type { SleepProfile } from '../onboarding/types';
import { mockTodayRepository } from './mockTodayRepository';
import ChatComposer from '../coach/ChatComposer';
import { interpretTypedCheckinReply } from './checkinReplyRepository';
import { answerCheckin, appendCheckinReply, checkinChoices, checkinDraft, initialCheckin, startCheckin, type CheckinConversation } from './checkinConversation';
import type {
  TodayRepository,
  TodaySnapshot,
} from './types';

type TodayScreenProps = {
  embedded?: boolean;
  onChat?: (message: string) => void;
  repository?: TodayRepository;
  profile?: SleepProfile;
  user?: User;
};

const formatLongDate = (date: string) => {
  const parsed = new Date(`${date}T12:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(parsed);
};

const clampSleepScore = (score: number) => Math.max(0, Math.min(100, Math.round(score)));

const SleepScoreSlider = ({ disabled = false, onChange, source, value }: {
  disabled?: boolean;
  onChange?: (score: number) => void;
  source?: 'Apple Health' | 'Oura' | 'Manual';
  value: number | null;
}) => {
  const [trackWidth, setTrackWidth] = useState(0);
  const trackLeft = useRef(0);
  const trackRef = useRef<View>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const displayValue = value ?? 50;
  const updateFromPageX = (pageX: number) => {
    if (disabled || !onChange || trackWidth <= 0) return;
    const nextScore = clampSleepScore(((pageX - trackLeft.current) / trackWidth) * 100);
    if (nextScore !== valueRef.current) {
      valueRef.current = nextScore;
      onChange(nextScore);
    }
  };
  const measureTrack = (pageX?: number) => {
    trackRef.current?.measureInWindow((x, _y, width) => {
      trackLeft.current = x;
      if (width > 0) setTrackWidth(width);
      if (pageX !== undefined && width > 0 && onChange && !disabled) {
        const nextScore = clampSleepScore(((pageX - x) / width) * 100);
        if (nextScore !== valueRef.current) {
          valueRef.current = nextScore;
          onChange(nextScore);
        }
      }
    });
  };
  const beginDrag = (event: GestureResponderEvent) => {
    measureTrack(event.nativeEvent.pageX);
  };
  const adjust = (amount: number) => onChange?.(clampSleepScore((value ?? 50) + amount));

  return (
    <View style={styles.sleepScoreControl}>
      <View style={styles.sleepScoreHeading}>
        <View>
          <Text style={styles.sleepScoreLabel}>SLEEP SCORE</Text>
          {source && <Text style={styles.sleepScoreSource}>{source}</Text>}
        </View>
        <Text style={styles.sleepScoreValue}>{value ?? '—'}</Text>
      </View>
      <View
        ref={trackRef}
        accessible
        accessibilityActions={disabled ? undefined : [{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityLabel="Sleep score"
        accessibilityRole="adjustable"
        accessibilityValue={{ min: 0, max: 100, now: value ?? undefined, text: value === null ? 'Not selected' : `${value} out of 100` }}
        onAccessibilityAction={(event) => adjust(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
        onLayout={(event: LayoutChangeEvent) => {
          setTrackWidth(event.nativeEvent.layout.width);
          measureTrack();
        }}
        onMoveShouldSetResponder={() => !disabled}
        onResponderGrant={beginDrag}
        onResponderMove={(event) => updateFromPageX(event.nativeEvent.pageX)}
        onResponderRelease={(event) => updateFromPageX(event.nativeEvent.pageX)}
        onResponderTerminate={() => measureTrack()}
        // Keep an active slider drag; the parent history swipe must not steal it.
        onResponderTerminationRequest={() => false}
        onStartShouldSetResponder={() => !disabled}
        style={styles.sleepScoreTrackTouch}
      >
        <View style={styles.sleepScoreTrack}>
          <View style={[styles.sleepScoreTrackFill, { width: `${displayValue}%` }]} />
          <View style={[styles.sleepScoreThumb, { left: `${displayValue}%` }, value === null && styles.sleepScoreThumbUnset]} />
        </View>
      </View>
      {!disabled && <View style={styles.sleepScoreScale}><Text style={styles.sleepScoreScaleText}>0</Text><Text style={styles.sleepScoreScaleText}>100</Text></View>}
    </View>
  );
};

const timeGreeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
};

const plainCoachText = (text: string) =>
  text.replace(/\*\*/g, '').replace(/__/g, '').replace(/`/g, '').trim();

const DailyReport = ({ action, cacheKey, meaning, pattern }: {
  action: string;
  cacheKey: string;
  meaning: string;
  pattern: string;
}) => {
  const report = `${plainCoachText(pattern)}\n\n${plainCoachText(meaning)}\n\nTonight: ${plainCoachText(action)}`;
  const [visible, setVisible] = useState('');

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    void AsyncStorage.getItem(cacheKey).then(seen => {
      if (!active) return;
      if (seen) {
        setVisible(report);
        return;
      }
      void AsyncStorage.setItem(cacheKey, 'seen');
      const words = report.split(/(\s+)/);
      let count = 0;
      setVisible('');
      timer = setInterval(() => {
        count += 1;
        setVisible(words.slice(0, count).join(''));
        if (count >= words.length && timer) clearInterval(timer);
      }, 28);
    });
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [cacheKey, report]);

  return <Text style={styles.dailyReportText}>{visible}</Text>;
};

export default function TodayScreen({ embedded = false, onChat, profile, repository = mockTodayRepository, user }: TodayScreenProps) {
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conversation, setConversation] = useState<CheckinConversation>(initialCheckin);
  const [input, setInput] = useState('');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [sleepReviewed, setSleepReviewed] = useState(false);
  const savingRef = useRef(false);
  const interpretingRef = useRef(false);
  const [interpreting, setInterpreting] = useState(false);
  const replyRequestRef = useRef(0);
  useEffect(() => () => { replyRequestRef.current += 1; }, []);
  const scrollRef = useRef<ScrollView>(null);
  const [manualSleepFallback, setManualSleepFallback] = useState(false);
  const [manualSleepScore, setManualSleepScore] = useState<number | null>(null);
  const [manualSleepSaving, setManualSleepSaving] = useState(false);
  const [dailyCoaching, setDailyCoaching] = useState<{
    pattern: string;
    meaning: string;
    action: string;
    generatedAt: string;
  } | null>(null);

  const loadToday = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const nextSnapshot = await repository.loadToday();
      setSnapshot(nextSnapshot);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Today could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  useEffect(() => {
    if (!user || !profile || !snapshot?.checkin || snapshot.sleepData.status === 'missing') {
      setDailyCoaching(null);
      return;
    }
    let active = true;
    void loadDailyCoaching(user, profile)
      .then(async coaching => {
        if (!active) return;
        setDailyCoaching(coaching);
        const refreshed = await repository.loadToday();
        if (active) setSnapshot(refreshed);
      })
      .catch(() => {
        if (active) setDailyCoaching(null);
      });
    return () => {
      active = false;
    };
  }, [profile, snapshot?.checkin?.completedAt, snapshot?.sleepData.status, snapshot?.sleepData.score, user]);

  const draftKey = snapshot ? `sleep-coach:checkin-draft:${user?.id ?? 'demo'}:${snapshot.date}` : null;
  useEffect(() => {
    if (!draftKey) return;
    let active = true;
    setDraftLoaded(false);
    setSleepReviewed(false);
    setConversation(initialCheckin);
    setInput('');
    void AsyncStorage.getItem(draftKey).then(value => {
      if (!active || !value) return;
      const draft = JSON.parse(value);
      if (draft.conversation && Array.isArray(draft.conversation.turns)) {
        setConversation(draft.conversation);
        setInput(snapshot?.checkin ? '' : draft.input ?? '');
        setManualSleepScore(draft.manualSleepScore ?? null);
        setManualSleepFallback(draft.manualSleepFallback ?? false);
      }
    }).catch(() => undefined).finally(() => {
      if (active) setDraftLoaded(true);
    });
    return () => { active = false; };
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey || !draftLoaded) return;
    // Keep the conversation available when today's check-in is reopened.
    if (snapshot?.checkin && conversation.turns.length === 0) return;
    void AsyncStorage.setItem(draftKey, JSON.stringify({ conversation, input: snapshot?.checkin ? '' : input, manualSleepScore, manualSleepFallback })).catch(() => undefined);
  }, [draftKey, draftLoaded, conversation, input, manualSleepScore, manualSleepFallback, snapshot?.checkin]);

  useEffect(() => {
    if (conversation.step !== 'sleep' && (sleepReviewed || snapshot?.checkin)) {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }, [conversation.turns.length, conversation.step, sleepReviewed, snapshot?.checkin?.completedAt]);

  const sleepContextReady = !!snapshot && (snapshot.sleepData.status !== 'missing' ||
    (manualSleepFallback && manualSleepScore !== null));

  const reply = async (text: string, choice?: string) => {
    if (!text.trim() || savingRef.current || interpretingRef.current) return;
    if (snapshot?.checkin) {
      onChat?.(text.trim());
      setInput('');
      return;
    }
    if (!sleepReviewed || conversation.step === 'sleep' || !sleepContextReady) return;
    setError('');
    if (choice) {
      setConversation(current => current.step === conversation.step ? answerCheckin(current, text, choice) : current);
      setInput('');
      return;
    }
    interpretingRef.current = true;
    setInterpreting(true);
    const request = ++replyRequestRef.current;
    try {
      const interpretation = await interpretTypedCheckinReply(conversation, text.trim());
      if (request !== replyRequestRef.current) return;
      const next = answerCheckin(conversation, text, undefined, interpretation);
      setConversation(next);
      setInput('');
      if (interpretation.finish) await submitCheckin('', next);
    } catch (replyError) {
      if (request === replyRequestRef.current) {
        setError(replyError instanceof Error ? replyError.message : 'Your reply is still here. Please try sending again.');
      }
    } finally {
      if (request === replyRequestRef.current) {
        interpretingRef.current = false;
        setInterpreting(false);
      }
    }
  };

  const submitCheckin = async (finalText = input, baseConversation = conversation) => {
    if (!snapshot || !sleepContextReady || savingRef.current) return;
    // Include an unsent composer draft when the user taps Finish.
    const finalConversation = appendCheckinReply(baseConversation, finalText);
    const draft = checkinDraft(finalConversation, snapshot.sleepData.status === 'missing'
      ? manualSleepScore ?? undefined : undefined);
    if (!draft) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    setConversation(finalConversation);
    setInput('');
    try {
      if (snapshot.previousCommitment && snapshot.previousCommitment.id === finalConversation.commitmentId && finalConversation.adherence) {
        await repository.updateCommitmentStatus(snapshot.previousCommitment.id, finalConversation.adherence);
      }
      const checkin = await repository.saveCheckin(draft);
      setSnapshot({
        ...snapshot,
        checkin,
        previousCommitment: finalConversation.adherence ? null : snapshot.previousCommitment,
        sleepData: typeof draft.manualSleepScore === 'number'
          ? { status: 'manual', score: draft.manualSleepScore, source: 'manual' }
          : snapshot.sleepData,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Your check-in was not saved. Please try finishing again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const saveManualSleep = async () => {
    if (manualSleepScore === null || !snapshot?.checkin) return;
    setManualSleepSaving(true);
    setError('');
    try {
      await repository.saveManualSleepScore(manualSleepScore);
      setSnapshot(await repository.loadToday());
      setManualSleepFallback(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Your manual sleep score was not saved.');
    } finally {
      setManualSleepSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centeredState}>
        <View style={styles.moonMark}>
          <Text style={styles.moonMarkText}>☾</Text>
        </View>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.stateTitle}>Preparing today</Text>
        <Text style={styles.stateCopy}>Pulling together your check-in and tonight’s focus.</Text>
      </View>
    );
  }

  if (!snapshot) {
    return (
      <View style={styles.centeredState}>
        <Text style={styles.stateEyebrow}>TODAY</Text>
        <Text style={styles.stateTitle}>We couldn’t load your day</Text>
        <Text style={styles.stateCopy}>{error || 'Check your connection and try again.'}</Text>
        <Pressable onPress={() => void loadToday()} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={!embedded && Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, embedded && styles.embeddedContent]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!embedded && <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>TODAY</Text>
            <Text style={styles.title}>
              {snapshot.greetingName
                ? `${timeGreeting()}, ${snapshot.greetingName}`
                : timeGreeting()}
            </Text>
            <Text style={styles.date}>{formatLongDate(snapshot.date)}</Text>
          </View>
          <View style={styles.dayBadge}>
            <Text style={styles.dayBadgeNumber}>{snapshot.dayNumber}</Text>
            <Text style={styles.dayBadgeLabel}>DAY</Text>
          </View>
        </View>}

        {embedded && (
          <View style={styles.embeddedHeading}>
            <View>
              <Text style={styles.eyebrow}>YOUR DAY</Text>
              <Text style={styles.date}>{formatLongDate(snapshot.date)}</Text>
            </View>
            <View style={styles.dayBadge}>
              <Text style={styles.dayBadgeNumber}>{snapshot.dayNumber}</Text>
              <Text style={styles.dayBadgeLabel}>DAY</Text>
            </View>
          </View>
        )}

        {snapshot.checkin && snapshot.dayNumber <= 7 && (
          <View style={styles.planProgress}>
            <View style={styles.planProgressHeader}>
              <Text style={styles.planProgressTitle}>YOUR 7-DAY START</Text>
              <Text style={styles.planProgressCount}>{snapshot.dayNumber} of 7</Text>
            </View>
            <View style={styles.planDots}>
              {Array.from({ length: 7 }, (_, index) => (
                <View key={index} style={[styles.planDot, index < snapshot.dayNumber && styles.planDotActive]} />
              ))}
            </View>
          </View>
        )}

        {snapshot.sleepData.status === 'missing' && (!sleepReviewed || snapshot.checkin) && (
          <View style={styles.sleepDataCard}>
            <Text style={styles.sectionEyebrow}>LAST NIGHT'S SLEEP</Text>
            <Text style={styles.sleepDataTitle}>We couldn't find wearable data yet.</Text>
            <Text style={styles.sleepDataCopy}>
              Try syncing once more, or add a sleep score manually if your wearable didn't record the night.
            </Text>
            <View style={styles.sleepDataActions}>
              <Pressable onPress={() => void loadToday()} style={styles.sleepDataSecondaryButton}>
                <Text style={styles.sleepDataSecondaryText}>Try syncing again</Text>
              </Pressable>
              <Pressable
                onPress={() => setManualSleepFallback(true)}
                style={styles.sleepDataPrimaryButton}
              >
                <Text style={styles.sleepDataPrimaryText}>Add manually</Text>
              </Pressable>
            </View>
            {manualSleepFallback && (
              <View style={styles.manualSleepArea}>
                <Text style={styles.prompt}>How would you score last night's sleep?</Text>
                <Text style={styles.promptHint}>Slide to your best estimate from 0–100.</Text>
                <SleepScoreSlider onChange={setManualSleepScore} value={manualSleepScore} />
                {snapshot.checkin && (
                  <Pressable
                    disabled={manualSleepScore === null || manualSleepSaving}
                    onPress={() => void saveManualSleep()}
                    style={[
                      styles.primaryButton,
                      manualSleepScore === null && styles.primaryButtonDisabled,
                    ]}
                  >
                    {manualSleepSaving
                      ? <ActivityIndicator color={colors.ink} />
                      : <Text style={styles.primaryButtonText}>Save manual sleep score</Text>}
                  </Pressable>
                )}
              </View>
            )}
          </View>
        )}

        {snapshot.sleepData.status !== 'missing' && (!sleepReviewed || snapshot.checkin) && (
          <View style={styles.dailyReport}>
            <SleepScoreSlider
              disabled
              source={snapshot.sleepData.status === 'wearable'
                ? snapshot.sleepData.source === 'apple_health' ? 'Apple Health' : 'Oura'
                : 'Manual'}
              value={snapshot.sleepData.score ?? null}
            />
            {snapshot.checkin && (
              <View style={styles.checkinCompleteRow}>
                <Text style={styles.checkinCompleteMark}>✓</Text>
                <Text style={styles.checkinCompleteText}>Check-in complete</Text>
              </View>
            )}

          </View>
        )}

        {snapshot.checkin && snapshot.commitment && (
          <View style={styles.commitmentCard}>
            <View style={styles.commitmentTopRow}>
              <Text style={styles.commitmentEyebrow}>TODAY’S EXPERIMENT</Text>
              <View style={styles.statusPill}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>
                  NIGHT {snapshot.commitment.runDay ?? 1} OF {snapshot.commitment.runLength ?? 3}
                </Text>
              </View>
            </View>
            <Text style={styles.commitmentTitle}>{snapshot.commitment.behavior}</Text>
            {!!snapshot.commitment.why && (
              <>
                <Text style={styles.commitmentWhyLabel}>WHY THIS, NOW</Text>
                <Text style={styles.commitmentWhy}>{snapshot.commitment.why}</Text>
              </>
            )}
            <View style={styles.coachNote}><Text style={styles.coachMark}>✦</Text><Text style={styles.coachNoteText}>Keep the behavior steady; your check-ins help Coach learn whether it actually moves your sleep.</Text></View>
          </View>
        )}

        {!snapshot.checkin && !sleepReviewed && (
          <Pressable
            accessibilityRole="button"
            disabled={!sleepContextReady || !draftLoaded}
            onPress={() => {
              if (conversation.step === 'sleep') setConversation(startCheckin(snapshot.previousCommitment?.behavior, snapshot.previousCommitment?.id));
              setSleepReviewed(true);
            }}
            style={[styles.primaryButton, (!sleepContextReady || !draftLoaded) && styles.primaryButtonDisabled]}
          >
            <Text style={styles.primaryButtonText}>Continue check-in</Text>
          </Pressable>
        )}

        {conversation.step !== 'sleep' && (sleepReviewed || snapshot.checkin) && (
          <View style={styles.conversation}>
            {!snapshot.checkin && <Text style={styles.promptHint}>Sleep score {snapshot.sleepData.score ?? manualSleepScore} · {snapshot.sleepData.source === 'apple_health' ? 'Apple Health' : snapshot.sleepData.source === 'oura' ? 'Oura' : 'Manual'}</Text>}
            {conversation.turns.map((turn, index) => (
              <View key={index} style={[styles.chatTurn, turn.role === 'user' && styles.userTurn]}>
                {turn.role === 'assistant' && <Text style={styles.chatCoachLabel}>COACH</Text>}
                <Text style={styles.chatText}>{turn.content}</Text>
              </View>
            ))}
            {interpreting && <View style={styles.reportLoadingRow} accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.accent} size="small" />
              <Text style={styles.reportLoadingText}>Reading your reply…</Text>
            </View>}
            {!snapshot.checkin && (
              <View style={styles.chipRow}>
                {checkinChoices(conversation.step).map(option => (
                  <Pressable
                    accessibilityRole="button"
                    disabled={saving || interpreting}
                    key={option.value}
                    onPress={() => void reply(input.trim() ? `${option.label}. ${input.trim()}` : option.label, option.value)}
                    style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                  >
                    <Text style={styles.chipText}>{option.label}</Text>
                  </Pressable>
                ))}
                {conversation.step === 'details' && (
                  <Pressable accessibilityRole="button" disabled={saving || interpreting} onPress={() => void submitCheckin()} style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                    {saving ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.chipText}>{error ? 'Try finishing again' : 'Finish check-in'}</Text>}
                  </Pressable>
                )}
              </View>
            )}
            {snapshot.checkin && <Text style={styles.promptHint}>Your check-in is saved. You can keep talking with your coach below.</Text>}
          </View>
        )}

        <View style={styles.dailyReport}>
            {dailyCoaching && user && (
              <DailyReport
                action={dailyCoaching.action}
                cacheKey={`sleep-coach:daily-report-seen:${user.id}:${snapshot.date}:${dailyCoaching.generatedAt}`}
                meaning={dailyCoaching.meaning}
                pattern={dailyCoaching.pattern}
              />
            )}
            {snapshot.checkin && snapshot.sleepData.status !== 'missing' && !dailyCoaching && (
              <View style={styles.reportLoadingRow}>
                <ActivityIndicator color={colors.accent} size="small" />
                <Text style={styles.reportLoadingText}>Preparing today’s coaching…</Text>
              </View>
            )}
        </View>
      </ScrollView>
      <ChatComposer
        value={input}
        onChangeText={setInput}
        onSend={() => void reply(input)}
        sending={saving || interpreting}
        disabled={!draftLoaded || (!snapshot.checkin && (!sleepReviewed || !sleepContextReady)) || (!!snapshot.checkin && !onChat)}
        placeholder={snapshot.checkin ? 'Ask your coach…' : !sleepReviewed ? 'Start with your sleep score above' : conversation.step === 'details' ? 'Share anything else…' : 'Reply or add more detail…'}
        error={error}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  conversation: { gap: 18, paddingTop: 18 },
  chatTurn: { alignSelf: 'flex-start', maxWidth: '94%', paddingVertical: 6 },
  userTurn: { alignSelf: 'flex-end', backgroundColor: colors.surfaceRaised, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 12 },
  chatCoachLabel: { color: colors.accent, fontSize: 9, fontWeight: '800', letterSpacing: 1.4, marginBottom: 8 },
  chatText: { color: colors.text, fontSize: 16, lineHeight: 25 },
  screen: {
    backgroundColor: colors.canvas,
    flex: 1,
  },
  content: {
    paddingBottom: 48,
    paddingHorizontal: 20,
    paddingTop: layout.screenTopPadding,
  },
  embeddedContent: { paddingTop: 8 },
  embeddedHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  eyebrow: {
    color: colors.accentSoft,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.8,
    marginBottom: 8,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  date: {
    color: colors.textMuted,
    fontSize: 15,
    marginTop: 5,
  },
  dailyGreeting: { marginBottom: 24, paddingRight: 8 },
  dailyGreetingLabel: { color: colors.text, fontWeight: '800' },
  dailyGreetingText: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 9,
  },
  dailyReport: {
    marginBottom: 24,
    paddingHorizontal: 4,
  },
  dailyReportText: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 26,
    marginTop: 20,
  },
  checkinCompleteRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 9,
  },
  checkinCompleteMark: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '900',
  },
  checkinCompleteText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  reportLoadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    marginTop: 20,
  },
  reportLoadingText: {
    color: colors.textSubtle,
    fontSize: 13,
  },
  dayBadge: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAccent,
    borderRadius: 18,
    minWidth: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dayBadgeNumber: {
    color: colors.accent,
    fontSize: 20,
    fontWeight: '800',
  },
  dayBadgeLabel: {
    color: colors.accentSoft,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  planProgress: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 18,
    padding: 14,
  },
  planProgressHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  planProgressTitle: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  planProgressCount: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
  },
  planDots: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 11,
  },
  planDot: {
    backgroundColor: colors.border,
    borderRadius: 4,
    flex: 1,
    height: 6,
  },
  planDotActive: {
    backgroundColor: colors.accent,
  },
  sleepDataCard: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSelected,
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 18,
    padding: 18,
  },
  sleepDataTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
  },
  sleepDataCopy: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 7,
  },
  sleepDataActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  sleepDataSecondaryButton: {
    alignItems: 'center',
    borderColor: colors.borderStrong,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 11,
  },
  sleepDataSecondaryText: { color: colors.textMuted, fontSize: 12, fontWeight: '800' },
  sleepDataPrimaryButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 14,
    flex: 1,
    paddingVertical: 11,
  },
  sleepDataPrimaryText: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  manualSleepArea: { marginTop: 4 },
  sleepDataReadyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  sleepDataReadyText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  sectionEyebrow: {
    color: colors.accentSoft,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  feelingNumber: {
    color: colors.textMuted,
    fontSize: 18,
    fontWeight: '800',
  },
  feelingNumberSelected: {
    color: colors.ink,
  },
  sleepScoreControl: {
    marginTop: 18,
  },
  sleepScoreHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sleepScoreLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  sleepScoreSource: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 3,
  },
  sleepScoreValue: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '800',
  },
  sleepScoreTrackTouch: {
    justifyContent: 'center',
    minHeight: 44,
  },
  sleepScoreTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 4,
    height: 6,
    position: 'relative',
  },
  sleepScoreTrackFill: {
    backgroundColor: colors.accent,
    borderRadius: 4,
    height: 6,
  },
  sleepScoreThumb: {
    backgroundColor: colors.accent,
    borderColor: colors.canvas,
    borderRadius: 12,
    borderWidth: 3,
    height: 24,
    marginLeft: -12,
    marginTop: -12,
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    top: '50%',
    width: 24,
  },
  sleepScoreThumbUnset: {
    opacity: 0.45,
  },
  sleepScoreScale: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -4,
  },
  sleepScoreScaleText: {
    color: colors.textSubtle,
    fontSize: 10,
    fontWeight: '700',
  },
  prompt: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 24,
  },
  promptHint: {
    color: colors.textSubtle,
    fontSize: 12,
    marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  chip: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 17,
    justifyContent: 'center',
    marginTop: 22,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  primaryButtonDisabled: {
    backgroundColor: colors.borderStrong,
  },
  primaryButtonText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  commitmentCard: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSelected,
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 18,
    overflow: 'hidden',
    padding: 20,
  },
  commitmentTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  commitmentEyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  statusPill: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAccent,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusDot: {
    backgroundColor: colors.accent,
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  statusText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  commitmentTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.35,
    lineHeight: 29,
  },
  commitmentWhy: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 12,
  },
  commitmentWhyLabel: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 18,
  },
  coachNote: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
    paddingTop: 16,
  },
  coachMark: {
    color: colors.accent,
    fontSize: 23,
  },
  coachNoteText: {
    color: colors.textSubtle,
    flex: 1,
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  completedCard: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAccent,
    borderColor: colors.borderStrong,
    borderRadius: 26,
    borderWidth: 1,
    padding: 24,
  },
  completedIcon: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    marginBottom: 16,
    width: 48,
  },
  completedIconText: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '800',
  },
  completedEyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  completedTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginTop: 8,
    textAlign: 'center',
  },
  completedCopy: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
    textAlign: 'center',
  },
  centeredState: {
    alignItems: 'center',
    backgroundColor: colors.canvas,
    flex: 1,
    justifyContent: 'center',
    padding: 32,
  },
  moonMark: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAccent,
    borderRadius: 30,
    height: 60,
    justifyContent: 'center',
    marginBottom: 20,
    width: 60,
  },
  moonMarkText: {
    color: colors.accentSoft,
    fontSize: 32,
  },
  stateEyebrow: {
    color: colors.accentSoft,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  stateTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    marginTop: 14,
    textAlign: 'center',
  },
  stateCopy: {
    color: colors.textSubtle,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    maxWidth: 320,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    marginTop: 22,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  retryButtonText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.78,
  },
});
