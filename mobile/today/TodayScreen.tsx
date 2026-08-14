import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { mockTodayRepository } from './mockTodayRepository';
import type {
  DailyCheckinDraft,
  SuspectedFactorKey,
  TodayRepository,
  TodaySnapshot,
} from './types';

type TodayScreenProps = {
  repository?: TodayRepository;
};

type FeelingOption = {
  score: number;
  icon: string;
  label: string;
};

type FactorOption = {
  key: SuspectedFactorKey;
  label: string;
};

const feelingOptions: FeelingOption[] = [
  { score: 20, icon: '1', label: 'Drained' },
  { score: 40, icon: '2', label: 'Tired' },
  { score: 60, icon: '3', label: 'Okay' },
  { score: 80, icon: '4', label: 'Good' },
  { score: 100, icon: '5', label: 'Great' },
];

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

const feelingLabel = (score: number) =>
  feelingOptions.find((option) => option.score === score)?.label ?? 'Checked in';

export default function TodayScreen({ repository = mockTodayRepository }: TodayScreenProps) {
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feeling, setFeeling] = useState<number | null>(null);
  const [suspectedFactor, setSuspectedFactor] = useState<SuspectedFactorKey | undefined>();
  const [note, setNote] = useState('');

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

  const canSubmit = feeling !== null && !saving;
  const selectedFeeling = useMemo(
    () => feelingOptions.find((option) => option.score === feeling),
    [feeling],
  );

  const submitCheckin = async () => {
    if (feeling === null || !snapshot) {
      return;
    }

    setSaving(true);
    setError('');

    const draft: DailyCheckinDraft = {
      feeling,
      suspectedFactor,
      note,
    };

    try {
      const checkin = await repository.saveCheckin(draft);
      setSnapshot({ ...snapshot, checkin });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Your check-in was not saved.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centeredState}>
        <View style={styles.moonMark}>
          <Text style={styles.moonMarkText}>☾</Text>
        </View>
        <ActivityIndicator color="#5b50d6" size="large" />
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
              {snapshot.greetingName ? `Morning, ${snapshot.greetingName}` : 'Good morning'}
            </Text>
            <Text style={styles.date}>{formatLongDate(snapshot.date)}</Text>
          </View>
          <View style={styles.dayBadge}>
            <Text style={styles.dayBadgeNumber}>1</Text>
            <Text style={styles.dayBadgeLabel}>DAY</Text>
          </View>
        </View>

        {snapshot.checkin ? (
          <View style={styles.completedCard}>
            <View style={styles.completedIcon}>
              <Text style={styles.completedIconText}>✓</Text>
            </View>
            <Text style={styles.completedEyebrow}>CHECK-IN COMPLETE</Text>
            <Text style={styles.completedTitle}>
              You’re feeling {feelingLabel(snapshot.checkin.feeling).toLowerCase()} today.
            </Text>
            <Text style={styles.completedCopy}>
              That’s enough for this morning. We’ll use this signal to keep your coaching grounded
              in how you actually feel.
            </Text>
          </View>
        ) : (
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
                const selected = feeling === option.score;
                return (
                  <Pressable
                    accessibilityLabel={`${option.label}, ${option.icon} out of 5`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={option.score}
                    onPress={() => setFeeling(option.score)}
                    style={({ pressed }) => [
                      styles.feelingButton,
                      selected && styles.feelingButtonSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.feelingNumber, selected && styles.feelingNumberSelected]}>
                      {option.icon}
                    </Text>
                    <Text style={[styles.feelingText, selected && styles.feelingTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {feeling !== null && (
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
                  placeholderTextColor="#8d899d"
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
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {selectedFeeling ? `Check in feeling ${selectedFeeling.label.toLowerCase()}` : 'Choose how you feel'}
                </Text>
              )}
            </Pressable>
          </View>
        )}

        <View style={styles.commitmentCard}>
          <View style={styles.commitmentTopRow}>
            <Text style={styles.commitmentEyebrow}>TONIGHT’S FOCUS</Text>
            <View style={styles.statusPill}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>{snapshot.commitment ? 'Committed' : 'Coming next'}</Text>
            </View>
          </View>

          {snapshot.commitment ? (
            <>
              <Text style={styles.commitmentTitle}>{snapshot.commitment.behavior}</Text>
              {!!snapshot.commitment.why && (
                <Text style={styles.commitmentWhy}>{snapshot.commitment.why}</Text>
              )}
              <View style={styles.coachNote}>
                <Text style={styles.coachMark}>☾</Text>
                <Text style={styles.coachNoteText}>
                  Don’t chase a perfect night. Just protect this one small experiment.
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.commitmentTitle}>Your first sleep experiment is almost ready.</Text>
              <Text style={styles.commitmentWhy}>
                Finish your morning check-in and your coach will choose one small action for tonight.
              </Text>
            </>
          )}
        </View>

        <Text style={styles.prototypeNote}>
          Local prototype data only. Supabase persistence will connect after the shared schema lands.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#f5f3f8',
    flex: 1,
  },
  content: {
    paddingBottom: 48,
    paddingHorizontal: 20,
    paddingTop: 64,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  eyebrow: {
    color: '#665bd2',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.8,
    marginBottom: 8,
  },
  title: {
    color: '#24212d',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  date: {
    color: '#716d7d',
    fontSize: 15,
    marginTop: 5,
  },
  dayBadge: {
    alignItems: 'center',
    backgroundColor: '#ebe7fb',
    borderRadius: 18,
    minWidth: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dayBadgeNumber: {
    color: '#5449bf',
    fontSize: 20,
    fontWeight: '800',
  },
  dayBadgeLabel: {
    color: '#7168be',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  checkinCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e8e4ec',
    borderRadius: 26,
    borderWidth: 1,
    padding: 20,
    shadowColor: '#332b52',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
  },
  sectionHeadingRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  sectionEyebrow: {
    color: '#746acb',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  sectionTitle: {
    color: '#292631',
    fontSize: 23,
    fontWeight: '800',
  },
  optionalLabel: {
    backgroundColor: '#f1eff7',
    borderRadius: 12,
    color: '#767183',
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
    backgroundColor: '#f7f5f9',
    borderColor: '#eeebf1',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    minHeight: 72,
    paddingHorizontal: 2,
    paddingVertical: 10,
  },
  feelingButtonSelected: {
    backgroundColor: '#5b50d6',
    borderColor: '#5b50d6',
  },
  feelingNumber: {
    color: '#5d5967',
    fontSize: 18,
    fontWeight: '800',
  },
  feelingNumberSelected: {
    color: '#ffffff',
  },
  feelingText: {
    color: '#75717f',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 6,
  },
  feelingTextSelected: {
    color: '#ffffff',
  },
  prompt: {
    color: '#34303c',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 24,
  },
  promptHint: {
    color: '#85808e',
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
    backgroundColor: '#f7f5f9',
    borderColor: '#e8e4ec',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipSelected: {
    backgroundColor: '#ece9ff',
    borderColor: '#6c60da',
  },
  chipText: {
    color: '#625e6a',
    fontSize: 13,
    fontWeight: '700',
  },
  chipTextSelected: {
    color: '#4f44bc',
  },
  noteInput: {
    backgroundColor: '#f8f7fa',
    borderColor: '#e8e4ec',
    borderRadius: 16,
    borderWidth: 1,
    color: '#2f2b36',
    fontSize: 15,
    lineHeight: 21,
    marginTop: 12,
    minHeight: 96,
    padding: 14,
  },
  characterCount: {
    color: '#9792a0',
    fontSize: 11,
    marginTop: 5,
    textAlign: 'right',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#5b50d6',
    borderRadius: 17,
    justifyContent: 'center',
    marginTop: 22,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  primaryButtonDisabled: {
    backgroundColor: '#d7d3df',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  inlineError: {
    color: '#b42318',
    fontSize: 13,
    marginTop: 16,
    textAlign: 'center',
  },
  commitmentCard: {
    backgroundColor: '#29243f',
    borderRadius: 26,
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
    color: '#bdb4ff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  statusPill: {
    alignItems: 'center',
    backgroundColor: '#3b3555',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusDot: {
    backgroundColor: '#a99cff',
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  statusText: {
    color: '#ded9ff',
    fontSize: 10,
    fontWeight: '700',
  },
  commitmentTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.35,
    lineHeight: 29,
  },
  commitmentWhy: {
    color: '#c9c4d8',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 12,
  },
  coachNote: {
    alignItems: 'center',
    borderTopColor: '#45405b',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
    paddingTop: 16,
  },
  coachMark: {
    color: '#bdb4ff',
    fontSize: 23,
  },
  coachNoteText: {
    color: '#aaa4bc',
    flex: 1,
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  completedCard: {
    alignItems: 'center',
    backgroundColor: '#efecff',
    borderColor: '#ded8ff',
    borderRadius: 26,
    borderWidth: 1,
    padding: 24,
  },
  completedIcon: {
    alignItems: 'center',
    backgroundColor: '#5b50d6',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    marginBottom: 16,
    width: 48,
  },
  completedIconText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '800',
  },
  completedEyebrow: {
    color: '#6257c9',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  completedTitle: {
    color: '#2f2a43',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 8,
    textAlign: 'center',
  },
  completedCopy: {
    color: '#6d6780',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
    textAlign: 'center',
  },
  centeredState: {
    alignItems: 'center',
    backgroundColor: '#f5f3f8',
    flex: 1,
    justifyContent: 'center',
    padding: 32,
  },
  moonMark: {
    alignItems: 'center',
    backgroundColor: '#ece8ff',
    borderRadius: 30,
    height: 60,
    justifyContent: 'center',
    marginBottom: 20,
    width: 60,
  },
  moonMarkText: {
    color: '#5b50d6',
    fontSize: 32,
  },
  stateEyebrow: {
    color: '#665bd2',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  stateTitle: {
    color: '#2c2933',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 14,
    textAlign: 'center',
  },
  stateCopy: {
    color: '#76717f',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    maxWidth: 320,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#5b50d6',
    borderRadius: 16,
    marginTop: 22,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  prototypeNote: {
    color: '#918c9b',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 16,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.78,
  },
});
