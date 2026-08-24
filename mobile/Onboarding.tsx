import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';

import type { PrimaryConcern } from './onboarding/types';
import { supabase } from './supabase';

const INTAKE_VERSION = 1;
const TIMELINE_START_MINUTES = 20 * 60;
const TIMELINE_DURATION_MINUTES = 16 * 60;
const MINIMUM_SLEEP_WINDOW_MINUTES = 4 * 60;
const SNAP_MINUTES = 15;

type Step = 'intro' | 'concern' | 'window' | 'followup' | 'results' | 'reminder';
type ConcernKey = PrimaryConcern;

type IntakeAnswers = {
  current_step?: Step | 'complete';
  primary_concern?: ConcernKey;
  typical_bedtime?: string;
  typical_wake_time?: string;
  schedule_varies?: boolean;
  time_in_bed_minutes?: number;
  follow_up_key?: string;
  follow_up_answer?: string;
  reminder_time?: string;
  first_experiment?: string;
};

type ConcernOption = {
  key: ConcernKey;
  label: string;
  icon: string;
};

type FollowUp = {
  key: string;
  question: string;
  options: Array<{ key: string; label: string }>;
};

type OnboardingProps = {
  session: Session;
  onComplete: () => void | Promise<void>;
};

const concernOptions: ConcernOption[] = [
  {
    key: 'falling_asleep',
    label: 'Takes me forever to fall asleep',
    icon: '☾',
  },
  {
    key: 'night_waking',
    label: 'I wake up during the night',
    icon: '≈',
  },
  {
    key: 'early_waking',
    label: "I wake up too early and can't get back to sleep",
    icon: '↗',
  },
  {
    key: 'unrefreshed',
    label: 'I sleep, but wake up exhausted',
    icon: '◌',
  },
  {
    key: 'irregular_schedule',
    label: 'My schedule is all over the place',
    icon: '↝',
  },
];

const validSteps = new Set<Step>([
  'intro',
  'concern',
  'window',
  'followup',
  'results',
  'reminder',
]);

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const snap = (value: number) => Math.round(value / SNAP_MINUTES) * SNAP_MINUTES;

const minutesToClock = (minutes: number) => {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const clockToMinutes = (clock: string | undefined) => {
  if (!clock) {
    return null;
  }

  const [hours, minutes] = clock.slice(0, 5).split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
};

const clockToTimelineMinutes = (clock: string | undefined) => {
  const clockMinutes = clockToMinutes(clock);
  if (clockMinutes === null) {
    return null;
  }

  return (clockMinutes - TIMELINE_START_MINUTES + 24 * 60) % (24 * 60);
};

const formatClock = (clock: string | undefined) => {
  const totalMinutes = clockToMinutes(clock);
  if (totalMinutes === null) {
    return '';
  }

  const hour = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${suffix}`;
};

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

const localISODate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

const getFollowUp = (concern: ConcernKey | undefined): FollowUp => {
  if (concern === 'falling_asleep') {
    return {
      key: 'sleep_latency',
      question: "Once you're in bed, how long until you fall asleep?",
      options: [
        { key: 'under_30', label: 'Under 30 min' },
        { key: '30_to_60', label: '30–60 min' },
        { key: 'over_60', label: 'Over an hour' },
      ],
    };
  }

  if (concern === 'night_waking' || concern === 'early_waking') {
    return {
      key: 'wake_duration',
      question: "Once you're awake, how long until you're back asleep?",
      options: [
        { key: 'under_30', label: 'Under 30 min' },
        { key: '30_to_60', label: '30–60 min' },
        { key: 'over_60', label: 'Over an hour' },
      ],
    };
  }

  return {
    key: 'bed_behavior',
    question: "What's your bed usually like?",
    options: [
      { key: 'scrolling_in_bed', label: 'Scrolling or watching until I doze off' },
      { key: 'trying_to_sleep', label: 'Lying there trying to sleep' },
      { key: 'varies', label: 'Honestly, it varies' },
    ],
  };
};

const getFirstExperiment = (answers: IntakeAnswers) => {
  const bedtime = formatClock(answers.typical_bedtime);
  const wakeTime = formatClock(answers.typical_wake_time);

  if (answers.primary_concern === 'falling_asleep') {
    if (answers.follow_up_answer === 'under_30') {
      return `Protect the runway: screens off and lights dim 45 minutes before your ${bedtime} bedtime.`;
    }

    return "The 20-minute rule: if you're awake past 20 minutes, get up and do something boring in dim light. Return only when sleepy.";
  }

  if (
    answers.primary_concern === 'night_waking' ||
    answers.primary_concern === 'early_waking'
  ) {
    return `Same wake-up, every day: keep your ${wakeTime} wake time even after a rough night.`;
  }

  if (answers.follow_up_answer === 'scrolling_in_bed') {
    return 'Bed is for sleep only: move scrolling to a chair; bed means lights out.';
  }

  return `Anchor your morning: fixed wake time at ${wakeTime}, even weekends.`;
};

const getSummary = (answers: IntakeAnswers) => {
  const duration = formatDuration(answers.time_in_bed_minutes ?? 0);
  const bedtime = formatClock(answers.typical_bedtime);
  const wakeTime = formatClock(answers.typical_wake_time);
  const qualifier = answers.schedule_varies ? 'roughly ' : '';

  const concernSummary: Record<ConcernKey, string> = {
    falling_asleep: 'The struggle is falling asleep once the lights are off.',
    night_waking: 'Staying asleep is the part that needs attention.',
    early_waking: 'Early waking is cutting the night short.',
    unrefreshed: 'You are getting time in bed, but not waking restored.',
    irregular_schedule: 'An inconsistent schedule is making sleep harder to predict.',
  };

  return [
    `You're in bed ${qualifier}${duration}, ${bedtime} to ${wakeTime}.`,
    answers.primary_concern
      ? concernSummary[answers.primary_concern]
      : 'We will use your check-ins to refine this starting point.',
  ];
};

export function Onboarding({ session, onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>('intro');
  const [answers, setAnswers] = useState<IntakeAnswers>({});
  const [bedMinutes, setBedMinutes] = useState(3 * 60);
  const [wakeMinutes, setWakeMinutes] = useState(11 * 60);
  const [reminderMinutes, setReminderMinutes] = useState(7 * 60 + 30);
  const [scheduleVaries, setScheduleVaries] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const opacity = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const bedMinutesRef = useRef(bedMinutes);
  const wakeMinutesRef = useRef(wakeMinutes);
  const bedDragStart = useRef(bedMinutes);
  const wakeDragStart = useRef(wakeMinutes);

  const setBedValue = (value: number) => {
    bedMinutesRef.current = value;
    setBedMinutes(value);
  };

  const setWakeValue = (value: number) => {
    wakeMinutesRef.current = value;
    setWakeMinutes(value);
  };

  useEffect(() => {
    let mounted = true;

    const loadProfile = async () => {
      setLoading(true);
      setErrorMessage('');

      const { data, error } = await supabase
        .from('sleep_profiles')
        .select(
          'primary_concern, typical_bedtime, typical_wake_time, intake_answers, onboarding_completed_at',
        )
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (!mounted) {
        return;
      }

      if (error) {
        setErrorMessage(error.message);
        setLoading(false);
        return;
      }

      if (data?.onboarding_completed_at) {
        onComplete();
        return;
      }

      const storedAnswers =
        data?.intake_answers &&
        typeof data.intake_answers === 'object' &&
        !Array.isArray(data.intake_answers)
          ? (data.intake_answers as IntakeAnswers)
          : {};
      const restoredAnswers: IntakeAnswers = {
        ...storedAnswers,
        primary_concern:
          storedAnswers.primary_concern ??
          (data?.primary_concern as ConcernKey | undefined),
        typical_bedtime:
          storedAnswers.typical_bedtime ?? data?.typical_bedtime?.slice(0, 5),
        typical_wake_time:
          storedAnswers.typical_wake_time ?? data?.typical_wake_time?.slice(0, 5),
      };

      const restoredBedMinutes = clockToTimelineMinutes(restoredAnswers.typical_bedtime);
      const restoredWakeMinutes = clockToTimelineMinutes(restoredAnswers.typical_wake_time);
      if (
        restoredBedMinutes !== null &&
        restoredWakeMinutes !== null &&
        restoredWakeMinutes - restoredBedMinutes >= MINIMUM_SLEEP_WINDOW_MINUTES &&
        restoredWakeMinutes <= TIMELINE_DURATION_MINUTES
      ) {
        setBedValue(restoredBedMinutes);
        setWakeValue(restoredWakeMinutes);
      }

      const storedReminder = clockToMinutes(restoredAnswers.reminder_time);
      if (storedReminder !== null) {
        setReminderMinutes(storedReminder);
      } else if (restoredAnswers.typical_wake_time) {
        const storedWakeTime = clockToMinutes(restoredAnswers.typical_wake_time);
        if (storedWakeTime !== null) {
          setReminderMinutes((storedWakeTime + 30) % (24 * 60));
        }
      }

      setScheduleVaries(Boolean(restoredAnswers.schedule_varies));
      setAnswers(restoredAnswers);

      const restoredStep = restoredAnswers.current_step;
      if (restoredStep && restoredStep !== 'complete' && validSteps.has(restoredStep)) {
        setStep(restoredStep);
      }
      setLoading(false);
    };

    void loadProfile();

    return () => {
      mounted = false;
    };
  }, [onComplete, session.user.id]);

  const transitionTo = (nextStep: Step, direction = 1) =>
    new Promise<void>((resolve) => {
      Animated.parallel([
        Animated.timing(opacity, {
          duration: 120,
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          duration: 120,
          toValue: -24 * direction,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setStep(nextStep);
        scrollRef.current?.scrollTo({ animated: false, y: 0 });
        translateX.setValue(24 * direction);

        Animated.parallel([
          Animated.timing(opacity, {
            duration: 220,
            toValue: 1,
            useNativeDriver: true,
          }),
          Animated.timing(translateX, {
            duration: 220,
            toValue: 0,
            useNativeDriver: true,
          }),
        ]).start(() => resolve());
      });
    });

  const persistAnswers = async (
    nextAnswers: IntakeAnswers,
    currentStep: Step,
  ) => {
    const intakeAnswers: IntakeAnswers = {
      ...nextAnswers,
      current_step: currentStep,
    };
    setAnswers(intakeAnswers);

    const profile = {
      user_id: session.user.id,
      primary_concern: intakeAnswers.primary_concern ?? null,
      typical_bedtime: intakeAnswers.typical_bedtime
        ? `${intakeAnswers.typical_bedtime}:00`
        : null,
      typical_wake_time: intakeAnswers.typical_wake_time
        ? `${intakeAnswers.typical_wake_time}:00`
        : null,
      intake_answers: intakeAnswers,
      intake_version: INTAKE_VERSION,
    };

    const { error } = await supabase
      .from('sleep_profiles')
      .upsert(profile, { onConflict: 'user_id' });

    if (error) {
      throw error;
    }
  };

  const saveAndAdvance = async (
    nextAnswers: IntakeAnswers,
    nextStep: Step,
    direction = 1,
  ) => {
    if (saving) {
      return;
    }

    setSaving(true);
    setErrorMessage('');
    try {
      await persistAnswers(nextAnswers, nextStep);
      await transitionTo(nextStep, direction);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'We could not save that answer. Try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  const goBack = async () => {
    const previousStep: Partial<Record<Step, Step>> = {
      concern: 'intro',
      window: 'concern',
      followup: 'window',
      results: 'followup',
      reminder: 'results',
    };
    const destination = previousStep[step];
    if (!destination) {
      return;
    }

    await saveAndAdvance(answers, destination, -1);
  };

  const bedPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          bedDragStart.current = bedMinutesRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          if (!trackWidth) {
            return;
          }

          const delta = snap(
            (gesture.dx / trackWidth) * TIMELINE_DURATION_MINUTES,
          );
          setBedValue(
            clamp(
              bedDragStart.current + delta,
              0,
              wakeMinutesRef.current - MINIMUM_SLEEP_WINDOW_MINUTES,
            ),
          );
        },
      }),
    [trackWidth],
  );

  const wakePanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          wakeDragStart.current = wakeMinutesRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          if (!trackWidth) {
            return;
          }

          const delta = snap(
            (gesture.dx / trackWidth) * TIMELINE_DURATION_MINUTES,
          );
          setWakeValue(
            clamp(
              wakeDragStart.current + delta,
              bedMinutesRef.current + MINIMUM_SLEEP_WINDOW_MINUTES,
              TIMELINE_DURATION_MINUTES,
            ),
          );
        },
      }),
    [trackWidth],
  );

  const handleTrackLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  const adjustBedtime = (direction: -1 | 1) => {
    setBedValue(
      clamp(
        bedMinutesRef.current + direction * SNAP_MINUTES,
        0,
        wakeMinutesRef.current - MINIMUM_SLEEP_WINDOW_MINUTES,
      ),
    );
  };

  const adjustWakeTime = (direction: -1 | 1) => {
    setWakeValue(
      clamp(
        wakeMinutesRef.current + direction * SNAP_MINUTES,
        bedMinutesRef.current + MINIMUM_SLEEP_WINDOW_MINUTES,
        TIMELINE_DURATION_MINUTES,
      ),
    );
  };

  const continueFromWindow = () => {
    const typicalBedtime = minutesToClock(TIMELINE_START_MINUTES + bedMinutes);
    const typicalWakeTime = minutesToClock(TIMELINE_START_MINUTES + wakeMinutes);
    const wakeClockMinutes = clockToMinutes(typicalWakeTime);
    if (!answers.reminder_time && wakeClockMinutes !== null) {
      setReminderMinutes((wakeClockMinutes + 30) % (24 * 60));
    }

    void saveAndAdvance(
      {
        ...answers,
        typical_bedtime: typicalBedtime,
        typical_wake_time: typicalWakeTime,
        schedule_varies: scheduleVaries,
        time_in_bed_minutes: wakeMinutes - bedMinutes,
      },
      'followup',
    );
  };

  const completeOnboarding = async () => {
    if (saving) {
      return;
    }

    const reminderTime = minutesToClock(reminderMinutes);
    const firstExperiment = getFirstExperiment(answers);
    const completedAnswers: IntakeAnswers = {
      ...answers,
      current_step: 'complete',
      reminder_time: reminderTime,
      first_experiment: firstExperiment,
    };

    setSaving(true);
    setErrorMessage('');
    try {
      const { error } = await supabase.rpc('complete_sleep_onboarding', {
        p_behavior: firstExperiment,
        p_behavior_date: localISODate(),
        p_intake_answers: completedAnswers,
        p_intake_version: INTAKE_VERSION,
        p_primary_concern: completedAnswers.primary_concern ?? null,
        p_typical_bedtime: completedAnswers.typical_bedtime
          ? `${completedAnswers.typical_bedtime}:00`
          : null,
        p_typical_wake_time: completedAnswers.typical_wake_time
          ? `${completedAnswers.typical_wake_time}:00`
          : null,
        p_user_id: session.user.id,
      });

      if (error) {
        throw error;
      }

      setAnswers(completedAnswers);
      await onComplete();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'We could not finish setup. Your earlier answers are still saved.',
      );
      setSaving(false);
    }
  };

  const followUp = getFollowUp(answers.primary_concern);
  const timeInBed = wakeMinutes - bedMinutes;
  const bedClock = minutesToClock(TIMELINE_START_MINUTES + bedMinutes);
  const wakeClock = minutesToClock(TIMELINE_START_MINUTES + wakeMinutes);
  const firstExperiment = getFirstExperiment(answers);
  const summary = getSummary(answers);
  const bedPosition =
    trackWidth * (bedMinutes / TIMELINE_DURATION_MINUTES);
  const wakePosition =
    trackWidth * (wakeMinutes / TIMELINE_DURATION_MINUTES);

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#e8b978" size="large" />
          <Text style={styles.loadingText}>Finding your place…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const renderBackButton = () =>
    step !== 'intro' ? (
      <Pressable
        accessibilityRole="button"
        disabled={saving}
        hitSlop={12}
        onPress={() => void goBack()}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </Pressable>
    ) : (
      <View style={styles.backButtonPlaceholder} />
    );

  const renderStep = () => {
    if (step === 'intro') {
      return (
        <View style={styles.introContent}>
          <View style={styles.moonMark}>
            <Text style={styles.moonMarkText}>☾</Text>
          </View>
          <Text style={styles.eyebrow}>30 DAYS · ONE STEP AT A TIME</Text>
          <Text style={styles.displayTitle}>Let’s find your starting point.</Text>
          <Text style={styles.bodyText}>
            We’ll ask three quick questions, then suggest one small sleep experiment
            for tonight.
          </Text>
          <Text style={styles.helperText}>
            This is behavioral coaching, not a medical diagnosis. Your daily check-ins
            will help us refine what works.
          </Text>
          <PrimaryButton
            busy={saving}
            label="Get started"
            onPress={() => void saveAndAdvance(answers, 'concern')}
          />
        </View>
      );
    }

    if (step === 'concern') {
      return (
        <View>
          <QuestionHeader
            eyebrow="About your sleep"
            title="What's the biggest problem with your sleep right now?"
          />
          <View style={styles.optionList}>
            {concernOptions.map((option) => (
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                key={option.key}
                onPress={() =>
                  void saveAndAdvance(
                    {
                      ...answers,
                      primary_concern: option.key,
                      follow_up_key: undefined,
                      follow_up_answer: undefined,
                    },
                    'window',
                  )
                }
                style={({ pressed }) => [
                  styles.concernCard,
                  answers.primary_concern === option.key && styles.selectedCard,
                  pressed && styles.cardPressed,
                  saving && styles.disabled,
                ]}
              >
                <View style={styles.optionIcon}>
                  <Text style={styles.optionIconText}>{option.icon}</Text>
                </View>
                <Text style={styles.concernLabel}>{option.label}</Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </View>
        </View>
      );
    }

    if (step === 'window') {
      return (
        <View>
          <QuestionHeader eyebrow="Your window" title="When are you usually in bed?" />
          <View style={[styles.windowCard, scheduleVaries && styles.approximateCard]}>
            <View style={styles.timeLabels}>
              <View>
                <Text style={styles.timeLabel}>In bed by</Text>
                <Text style={styles.timeValue}>{formatClock(bedClock)}</Text>
              </View>
              <View style={styles.durationPill}>
                <Text style={styles.durationPillText}>
                  {formatDuration(timeInBed)} in bed
                </Text>
              </View>
              <View style={styles.alignRight}>
                <Text style={styles.timeLabel}>Up by</Text>
                <Text style={styles.timeValue}>{formatClock(wakeClock)}</Text>
              </View>
            </View>

            <View style={styles.sliderArea}>
              <View onLayout={handleTrackLayout} style={styles.sliderTrack}>
                <View style={styles.sliderRail} />
                <View
                  style={[
                    styles.sliderFill,
                    {
                      left: bedPosition,
                      width: Math.max(wakePosition - bedPosition, 0),
                    },
                  ]}
                />
                <View
                  accessibilityActions={[
                    { label: 'Move bedtime 15 minutes later', name: 'increment' },
                    { label: 'Move bedtime 15 minutes earlier', name: 'decrement' },
                  ]}
                  accessibilityLabel={`In bed by ${formatClock(bedClock)}`}
                  accessibilityRole="adjustable"
                  accessibilityValue={{ text: formatClock(bedClock) }}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === 'increment') {
                      adjustBedtime(1);
                    } else if (event.nativeEvent.actionName === 'decrement') {
                      adjustBedtime(-1);
                    }
                  }}
                  style={[styles.sliderHandle, { left: bedPosition - 22 }]}
                  {...bedPanResponder.panHandlers}
                >
                  <View style={styles.sliderHandleInner} />
                </View>
                <View
                  accessibilityActions={[
                    { label: 'Move wake time 15 minutes later', name: 'increment' },
                    { label: 'Move wake time 15 minutes earlier', name: 'decrement' },
                  ]}
                  accessibilityLabel={`Up by ${formatClock(wakeClock)}`}
                  accessibilityRole="adjustable"
                  accessibilityValue={{ text: formatClock(wakeClock) }}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === 'increment') {
                      adjustWakeTime(1);
                    } else if (event.nativeEvent.actionName === 'decrement') {
                      adjustWakeTime(-1);
                    }
                  }}
                  style={[styles.sliderHandle, { left: wakePosition - 22 }]}
                  {...wakePanResponder.panHandlers}
                >
                  <View style={styles.sliderHandleInner} />
                </View>
              </View>
              <View style={styles.tickRow}>
                {['8 PM', '12 AM', '4 AM', '8 AM', '12 PM'].map((label) => (
                  <Text key={label} style={styles.tickLabel}>
                    {label}
                  </Text>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text style={styles.switchLabel}>My schedule varies a lot</Text>
              <Text style={styles.switchHint}>We’ll treat these times as approximate.</Text>
            </View>
            <Switch
              accessibilityLabel="My schedule varies a lot"
              ios_backgroundColor="#263b49"
              onValueChange={setScheduleVaries}
              thumbColor={scheduleVaries ? '#fff7e8' : '#c0ccd3'}
              trackColor={{ false: '#263b49', true: '#a66f39' }}
              value={scheduleVaries}
            />
          </View>

          <PrimaryButton
            busy={saving}
            label="Continue"
            onPress={continueFromWindow}
          />
        </View>
      );
    }

    if (step === 'followup') {
      return (
        <View>
          <QuestionHeader eyebrow="One more thing" title={followUp.question} />
          <View style={styles.optionList}>
            {followUp.options.map((option) => (
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                key={option.key}
                onPress={() =>
                  void saveAndAdvance(
                    {
                      ...answers,
                      follow_up_key: followUp.key,
                      follow_up_answer: option.key,
                    },
                    'results',
                  )
                }
                style={({ pressed }) => [
                  styles.answerCard,
                  answers.follow_up_answer === option.key && styles.selectedCard,
                  pressed && styles.cardPressed,
                  saving && styles.disabled,
                ]}
              >
                <Text style={styles.answerLabel}>{option.label}</Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </View>
        </View>
      );
    }

    if (step === 'results') {
      return (
        <View>
          <QuestionHeader eyebrow="Where you stand" title="Your starting point" />
          <View style={styles.summaryBlock}>
            {summary.map((line) => (
              <Text key={line} style={styles.summaryText}>
                {line}
              </Text>
            ))}
          </View>

          <View style={styles.experimentCard}>
            <View style={styles.experimentIcon}>
              <Text style={styles.experimentIconText}>✦</Text>
            </View>
            <View style={styles.experimentCopy}>
              <Text style={styles.experimentTitle}>Your first experiment</Text>
              <Text style={styles.experimentText}>{firstExperiment}</Text>
            </View>
          </View>

          <Text style={styles.hypothesisText}>
            This is a starting hypothesis—not a verdict. Your check-ins will help your
            coach adjust it.
          </Text>
          <PrimaryButton
            busy={saving}
            label="Set my daily check-in"
            onPress={() =>
              void saveAndAdvance(
                { ...answers, first_experiment: firstExperiment },
                'reminder',
              )
            }
          />
        </View>
      );
    }

    return (
      <View>
        <QuestionHeader
          eyebrow="Stay on track"
          title="When should we check in?"
          subtitle="Pick a quiet moment after waking. You can change this later."
        />
        <View style={styles.reminderCard}>
          <Text style={styles.reminderLabel}>Daily check-in</Text>
          <View style={styles.reminderControls}>
            <Pressable
              accessibilityLabel="Move check-in 15 minutes earlier"
              accessibilityRole="button"
              disabled={saving}
              onPress={() =>
                setReminderMinutes((current) => (current - 15 + 24 * 60) % (24 * 60))
              }
              style={({ pressed }) => [
                styles.timeAdjustButton,
                pressed && styles.cardPressed,
              ]}
            >
              <Text style={styles.timeAdjustText}>−</Text>
            </Pressable>
            <Text style={styles.reminderTime}>
              {formatClock(minutesToClock(reminderMinutes))}
            </Text>
            <Pressable
              accessibilityLabel="Move check-in 15 minutes later"
              accessibilityRole="button"
              disabled={saving}
              onPress={() =>
                setReminderMinutes((current) => (current + 15) % (24 * 60))
              }
              style={({ pressed }) => [
                styles.timeAdjustButton,
                pressed && styles.cardPressed,
              ]}
            >
              <Text style={styles.timeAdjustText}>+</Text>
            </Pressable>
          </View>
          <Text style={styles.reminderHint}>
            We’ll ask how last night went and use that context to refine your next step.
          </Text>
        </View>
        <PrimaryButton
          busy={saving}
          label="Start my first night"
          onPress={() => void completeOnboarding()}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.shell}>
          {renderBackButton()}
          <Animated.View
            style={{
              opacity,
              transform: [{ translateX }],
            }}
          >
            {renderStep()}
          </Animated.View>
          {!!errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function QuestionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.questionHeader}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.questionTitle}>{title}</Text>
      {!!subtitle && <Text style={styles.questionSubtitle}>{subtitle}</Text>}
    </View>
  );
}

function PrimaryButton({
  busy,
  label,
  onPress,
}: {
  busy: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        pressed && styles.primaryButtonPressed,
        busy && styles.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color="#101b25" />
      ) : (
        <Text style={styles.primaryButtonText}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#07131f',
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  shell: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: 480,
    paddingBottom: 36,
    paddingHorizontal: 24,
    width: '100%',
  },
  loadingContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  loadingText: {
    color: '#9cafbd',
    fontSize: 14,
    marginTop: 14,
  },
  backButton: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: 48,
  },
  backButtonPlaceholder: {
    height: 48,
  },
  backButtonText: {
    color: '#aebbc4',
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.65,
  },
  introContent: {
    paddingTop: 48,
  },
  moonMark: {
    alignItems: 'center',
    backgroundColor: '#122736',
    borderColor: '#294151',
    borderRadius: 32,
    borderWidth: 1,
    height: 64,
    justifyContent: 'center',
    marginBottom: 32,
    width: 64,
  },
  moonMarkText: {
    color: '#e8b978',
    fontSize: 34,
    marginTop: -3,
  },
  eyebrow: {
    color: '#d29a5f',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.3,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  displayTitle: {
    color: '#f5f0e8',
    fontSize: 40,
    fontWeight: '700',
    letterSpacing: -1.2,
    lineHeight: 47,
    marginBottom: 20,
  },
  bodyText: {
    color: '#c7d0d6',
    fontSize: 18,
    lineHeight: 28,
    marginBottom: 18,
  },
  helperText: {
    color: '#8295a3',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 32,
  },
  questionHeader: {
    marginBottom: 30,
    paddingTop: 14,
  },
  questionTitle: {
    color: '#f5f0e8',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.7,
    lineHeight: 39,
  },
  questionSubtitle: {
    color: '#91a3af',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 14,
  },
  optionList: {
    gap: 12,
  },
  concernCard: {
    alignItems: 'center',
    backgroundColor: '#102330',
    borderColor: '#203a4a',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 74,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  selectedCard: {
    backgroundColor: '#173344',
    borderColor: '#ba824b',
  },
  optionIcon: {
    alignItems: 'center',
    borderColor: '#36505f',
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    marginRight: 14,
    width: 36,
  },
  optionIconText: {
    color: '#e8b978',
    fontSize: 20,
  },
  concernLabel: {
    color: '#ecedea',
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  chevron: {
    color: '#66808f',
    fontSize: 25,
    marginLeft: 10,
  },
  cardPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.99 }],
  },
  disabled: {
    opacity: 0.55,
  },
  windowCard: {
    marginTop: 4,
  },
  approximateCard: {
    opacity: 0.58,
  },
  timeLabels: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeLabel: {
    color: '#8295a3',
    fontSize: 13,
    marginBottom: 5,
  },
  timeValue: {
    color: '#f5f0e8',
    fontSize: 21,
    fontWeight: '700',
  },
  durationPill: {
    backgroundColor: '#172d3a',
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  durationPillText: {
    color: '#e8b978',
    fontSize: 12,
    fontWeight: '700',
  },
  alignRight: {
    alignItems: 'flex-end',
  },
  sliderArea: {
    marginBottom: 22,
    marginTop: 34,
  },
  sliderTrack: {
    height: 44,
    justifyContent: 'center',
  },
  sliderRail: {
    backgroundColor: '#29404e',
    borderRadius: 3,
    height: 6,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  sliderFill: {
    backgroundColor: '#d59a5d',
    borderRadius: 3,
    height: 6,
    position: 'absolute',
  },
  sliderHandle: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    width: 44,
  },
  sliderHandleInner: {
    backgroundColor: '#fff7e8',
    borderColor: '#d59a5d',
    borderRadius: 15,
    borderWidth: 5,
    height: 30,
    shadowColor: '#000000',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    width: 30,
  },
  tickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  tickLabel: {
    color: '#617684',
    fontSize: 10,
  },
  switchRow: {
    alignItems: 'center',
    backgroundColor: '#0e202c',
    borderColor: '#1e3746',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 28,
    padding: 16,
  },
  switchCopy: {
    flex: 1,
    paddingRight: 12,
  },
  switchLabel: {
    color: '#e8ebe9',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 3,
  },
  switchHint: {
    color: '#718692',
    fontSize: 12,
    lineHeight: 17,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#e8b978',
    borderRadius: 17,
    justifyContent: 'center',
    marginTop: 32,
    minHeight: 58,
    paddingHorizontal: 20,
  },
  primaryButtonPressed: {
    backgroundColor: '#dba968',
    transform: [{ scale: 0.99 }],
  },
  primaryButtonText: {
    color: '#101b25',
    fontSize: 16,
    fontWeight: '800',
  },
  answerCard: {
    alignItems: 'center',
    backgroundColor: '#102330',
    borderColor: '#203a4a',
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 64,
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  answerLabel: {
    color: '#ecedea',
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 23,
  },
  summaryBlock: {
    gap: 8,
    marginBottom: 28,
    marginTop: -6,
  },
  summaryText: {
    color: '#b8c4cb',
    fontSize: 17,
    lineHeight: 25,
  },
  experimentCard: {
    backgroundColor: '#112c32',
    borderColor: '#31504e',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 20,
  },
  experimentIcon: {
    alignItems: 'center',
    backgroundColor: '#24433f',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    marginRight: 14,
    width: 40,
  },
  experimentIconText: {
    color: '#e8b978',
    fontSize: 19,
  },
  experimentCopy: {
    flex: 1,
  },
  experimentTitle: {
    color: '#e8b978',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 9,
    textTransform: 'uppercase',
  },
  experimentText: {
    color: '#f2eee7',
    fontSize: 17,
    lineHeight: 26,
  },
  hypothesisText: {
    color: '#78909c',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 18,
  },
  reminderCard: {
    alignItems: 'center',
    backgroundColor: '#102330',
    borderColor: '#203a4a',
    borderRadius: 22,
    borderWidth: 1,
    padding: 22,
  },
  reminderLabel: {
    color: '#8295a3',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  reminderControls: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 24,
    width: '100%',
  },
  timeAdjustButton: {
    alignItems: 'center',
    backgroundColor: '#1b3544',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  timeAdjustText: {
    color: '#e8b978',
    fontSize: 28,
    fontWeight: '400',
    lineHeight: 31,
  },
  reminderTime: {
    color: '#f5f0e8',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  reminderHint: {
    color: '#8fa0aa',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  errorText: {
    color: '#ffb4a8',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 18,
    textAlign: 'center',
  },
});
