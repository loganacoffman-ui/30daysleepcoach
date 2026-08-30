import { useCallback, useEffect, useMemo, useState } from 'react';
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
  TextInput,
  View,
} from 'react-native';
import type { User } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { loadDailyCoaching } from '../coach/coachRepository';
import { colors, layout } from '../design/theme';
import type { SleepProfile } from '../onboarding/types';
import { mockTodayRepository } from './mockTodayRepository';
import type { MorningFeeling } from './feeling';
import { feelingOptions } from './feeling';
import type {
  DailyCheckinDraft,
  SuspectedFactorKey,
  TodayRepository,
  TodaySnapshot,
} from './types';

type TodayScreenProps = {
  repository?: TodayRepository;
  profile?: SleepProfile;
  user?: User;
};

type FactorOption = {
  key: SuspectedFactorKey;
  label: string;
};

const factorOptions: FactorOption[] = [
  { key: 'stress', label: 'Stress' },
  { key: 'late_meal', label: 'Late meal' },
  { key: 'alcohol', label: 'Alcohol' },
  { key: 'screens', label: 'Screens' },
  { key: 'temperature', label: 'Temperature' },
  { key: 'noise', label: 'Noise' },
  { key: 'unknown', label: 'Not sure' },
];

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
  const displayValue = value ?? 50;
  const updateFromTouch = (event: GestureResponderEvent) => {
    if (disabled || !onChange || trackWidth <= 0) return;
    onChange(clampSleepScore((event.nativeEvent.locationX / trackWidth) * 100));
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
        accessible
        accessibilityActions={disabled ? undefined : [{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityLabel="Sleep score"
        accessibilityRole="adjustable"
        accessibilityValue={{ min: 0, max: 100, now: value ?? undefined, text: value === null ? 'Not selected' : `${value} out of 100` }}
        onAccessibilityAction={(event) => adjust(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
        onLayout={(event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width)}
        onMoveShouldSetResponder={() => !disabled}
        onResponderGrant={updateFromTouch}
        onResponderMove={updateFromTouch}
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

export default function TodayScreen({ profile, repository = mockTodayRepository, user }: TodayScreenProps) {
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adherenceSaving, setAdherenceSaving] = useState(false);
  const [error, setError] = useState('');
  const [morningFeeling, setMorningFeeling] = useState<MorningFeeling | null>(null);
  const [manualSleepFallback, setManualSleepFallback] = useState(false);
  const [manualSleepScore, setManualSleepScore] = useState<number | null>(null);
  const [manualSleepSaving, setManualSleepSaving] = useState(false);
  const [suspectedFactor, setSuspectedFactor] = useState<SuspectedFactorKey | undefined>();
  const [note, setNote] = useState('');
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
      .then(coaching => {
        if (active) setDailyCoaching(coaching);
      })
      .catch(() => {
        if (active) setDailyCoaching(null);
      });
    return () => {
      active = false;
    };
  }, [profile, snapshot?.checkin?.completedAt, snapshot?.sleepData.status, snapshot?.sleepData.score, user]);

  const sleepContextReady = snapshot?.sleepData.status !== 'missing' ||
    (manualSleepFallback && manualSleepScore !== null);
  const canSubmit = morningFeeling !== null && sleepContextReady && !saving;
  const selectedFeeling = useMemo(
    () => feelingOptions.find((option) => option.value === morningFeeling),
    [morningFeeling],
  );

  const submitCheckin = async () => {
    if (morningFeeling === null || !snapshot) {
      return;
    }

    setSaving(true);
    setError('');

    const draft: DailyCheckinDraft = {
      morningFeeling,
      manualSleepScore: snapshot.sleepData.status === 'missing'
        ? manualSleepScore ?? undefined
        : undefined,
      suspectedFactor,
      note,
    };

    try {
      const checkin = await repository.saveCheckin(draft);
      setSnapshot({
        ...snapshot,
        checkin,
        sleepData: typeof draft.manualSleepScore === 'number'
          ? { status: 'manual', score: draft.manualSleepScore, source: 'manual' }
          : snapshot.sleepData,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Your check-in was not saved.');
    } finally {
      setSaving(false);
    }
  };

  const saveAdherence = async (status: 'completed' | 'partial' | 'skipped') => {
    if (!snapshot?.previousCommitment) return;
    setAdherenceSaving(true);
    setError('');
    try {
      await repository.updateCommitmentStatus(snapshot.previousCommitment.id, status);
      setSnapshot(await repository.loadToday());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Your response was not saved.');
    } finally {
      setAdherenceSaving(false);
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
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
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
        </View>

        {snapshot.sleepData.status === 'missing' && (
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

        {snapshot.sleepData.status !== 'missing' && (
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
            {dailyCoaching && user && (
              <DailyReport
                action={dailyCoaching.action}
                cacheKey={`sleep-coach:daily-report-seen:${user.id}:${snapshot.date}:${dailyCoaching.generatedAt}`}
                meaning={dailyCoaching.meaning}
                pattern={dailyCoaching.pattern}
              />
            )}
            {snapshot.checkin && !dailyCoaching && (
              <View style={styles.reportLoadingRow}>
                <ActivityIndicator color={colors.accent} size="small" />
                <Text style={styles.reportLoadingText}>Preparing today’s coaching…</Text>
              </View>
            )}
          </View>
        )}

        {snapshot.dayNumber < 7 && (
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

        {snapshot.previousCommitment && (
          <View style={styles.adherenceCard}>
            <Text style={styles.sectionEyebrow}>LAST NIGHT’S EXPERIMENT</Text>
            <Text style={styles.adherenceTitle}>How did it go?</Text>
            <Text style={styles.adherenceBehavior}>{snapshot.previousCommitment.behavior}</Text>
            <View style={styles.adherenceActions}>
              {([
                ['completed', 'Did it'],
                ['partial', 'Partly'],
                ['skipped', 'Not yet'],
              ] as const).map(([status, label]) => (
                <Pressable
                  disabled={adherenceSaving}
                  key={status}
                  onPress={() => void saveAdherence(status)}
                  style={({ pressed }) => [styles.adherenceButton, pressed && styles.pressed]}
                >
                  <Text style={styles.adherenceButtonText}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {!snapshot.checkin ? (
          <View style={styles.checkinCard}>
            <View style={styles.sectionHeadingRow}>
              <View>
                <Text style={styles.sectionEyebrow}>30-SECOND CHECK-IN</Text>
                <Text style={styles.sectionTitle}>How do you feel?</Text>
              </View>
              <Text style={styles.optionalLabel}>Morning</Text>
            </View>

            <View style={styles.feelingRow}>
              {feelingOptions.map((option) => {
                const selected = morningFeeling === option.value;
                return (
                  <Pressable
                    accessibilityLabel={`Feeling ${option.label.toLowerCase()}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={option.value}
                    onPress={() => setMorningFeeling(option.value)}
                    style={({ pressed }) => [
                      styles.feelingButton,
                      selected && styles.feelingButtonSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.feelingText, selected && styles.feelingTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {morningFeeling !== null && (
              <>
                <Text style={styles.prompt}>What affected last night most?</Text>
                <Text style={styles.promptHint}>Optional—choose the closest answer.</Text>
                <View style={styles.chipRow}>
                  {factorOptions.map((option) => {
                    const selected = suspectedFactor === option.key;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        key={option.key}
                        onPress={() => setSuspectedFactor(selected ? undefined : option.key)}
                        style={({ pressed }) => [
                          styles.chip,
                          selected && styles.chipSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.prompt}>Anything worth remembering?</Text>
                <TextInput
                  accessibilityLabel="Optional note about last night"
                  maxLength={280}
                  multiline
                  onChangeText={setNote}
                  placeholder="A quick note, if you want..."
                  placeholderTextColor={colors.textFaint}
                  style={styles.noteInput}
                  textAlignVertical="top"
                  value={note}
                />
                <Text style={styles.characterCount}>{note.length}/280</Text>
              </>
            )}

            {!!error && <Text style={styles.inlineError}>{error}</Text>}

            <Pressable
              accessibilityRole="button"
              disabled={!canSubmit}
              onPress={() => void submitCheckin()}
              style={({ pressed }) => [
                styles.primaryButton,
                !canSubmit && styles.primaryButtonDisabled,
                pressed && canSubmit && styles.pressed,
              ]}
            >
              {saving ? (
                <ActivityIndicator color={colors.ink} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {selectedFeeling ? `Check in feeling ${selectedFeeling.label.toLowerCase()}` : 'Choose how you feel'}
                </Text>
              )}
            </Pressable>
          </View>
        ) : null}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.canvas,
    flex: 1,
  },
  content: {
    paddingBottom: 48,
    paddingHorizontal: 20,
    paddingTop: layout.screenTopPadding,
  },
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
  checkinCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 26,
    borderWidth: 1,
    padding: 20,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
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
  adherenceCard: {
    backgroundColor: colors.surfaceAccent,
    borderColor: colors.borderSelected,
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 16,
    padding: 18,
  },
  adherenceTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: '800',
  },
  adherenceBehavior: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  adherenceActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  adherenceButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 11,
  },
  adherenceButtonText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '800',
  },
  sectionHeadingRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  sectionEyebrow: {
    color: colors.accentSoft,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 23,
    fontWeight: '800',
  },
  optionalLabel: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  feelingRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'space-between',
  },
  feelingButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 4,
    paddingVertical: 9,
  },
  feelingButtonSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  feelingNumber: {
    color: colors.textMuted,
    fontSize: 18,
    fontWeight: '800',
  },
  feelingNumberSelected: {
    color: colors.ink,
  },
  feelingText: {
    color: colors.textSubtle,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  feelingTextSelected: {
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
  chipSelected: {
    backgroundColor: colors.surfaceAccent,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  chipTextSelected: {
    color: colors.accent,
  },
  noteInput: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 12,
    minHeight: 96,
    padding: 14,
  },
  characterCount: {
    color: colors.textFaint,
    fontSize: 11,
    marginTop: 5,
    textAlign: 'right',
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
  inlineError: {
    color: colors.danger,
    fontSize: 13,
    marginTop: 16,
    textAlign: 'center',
  },
  commitmentCard: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: 26,
    borderWidth: 1,
    marginTop: 16,
    overflow: 'hidden',
    padding: 22,
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
    backgroundColor: colors.surface,
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
