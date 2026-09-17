import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  AppState,
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

import { screenCache } from '../cache/screenCache';
import { loadDailyCoaching, type CoachMessage, type DailyCoaching } from '../coach/coachRepository';
import { Skeleton, SkeletonLines } from '../design/Skeleton';
import { colors, layout } from '../design/theme';
import type { SleepProfile } from '../onboarding/types';
import { mockTodayRepository } from './mockTodayRepository';
import ChatBubble, { plainCoachText } from '../coach/ChatBubble';
import ChatComposer from '../coach/ChatComposer';
import JumpToLatest from '../coach/JumpToLatest';
import { useChatScroll } from '../coach/useChatScroll';
import { interpretTypedCheckinReply } from './checkinReplyRepository';
import { checkinDraftStorage, checkinStorageKey, localCheckinDate } from './checkinDraftStorage';
import {
  clampSleepScore,
  dragIsHorizontal,
  scoreForTouch,
  trackLeftFromTouch,
} from './sleepScoreGesture';
import { answerCheckin, appendCheckinReply, checkinChoices, checkinDraft, initialCheckin, remainingCheckinCharacters, startCheckin, type CheckinConversation, type CheckinTurn } from './checkinConversation';
import type {
  TodayRepository,
  TodaySnapshot,
} from './types';

type TodayScreenProps = {
  embedded?: boolean;
  refreshRequest?: number;
  chat?: {
    messages: CoachMessage[];
    renderMessage: (message: CoachMessage) => ReactNode;
    onCheckinComplete?: (turns: CheckinTurn[]) => void | Promise<void>;
    onSend: (message: string) => Promise<boolean>;
    sending: boolean;
    disabled: boolean;
    error: string;
  };
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

const TODAY_CACHE_NAME = 'today-snapshot';
// Bump when TodaySnapshot changes shape so a released build never renders a
// cached entry it can no longer read.
const TODAY_CACHE_VERSION = 2;

const SleepScoreSlider = ({ disabled = false, onChange, source, value }: {
  disabled?: boolean;
  onChange?: (score: number) => void;
  source?: 'Apple Health' | 'Oura' | 'Manual';
  value: number | null;
}) => {
  const trackRef = useRef<View>(null);
  // Where the track sits in window coordinates. `left` is recovered from the
  // touch that starts each drag as pageX - locationX, so the first move already
  // maps to the right score instead of being scored against a measurement that
  // has not come back yet — which is what pinned the score to an edge.
  const geometry = useRef({ left: 0, width: 0 });
  const drag = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  // The score under the finger. Kept here so dragging re-renders this control
  // instead of the whole day; the parent hears the result once, on release.
  const [dragScore, setDragScore] = useState<number | null>(null);
  const shown = dragScore ?? value;
  const displayValue = shown ?? 50;

  const scoreAt = (pageX: number) => scoreForTouch(geometry.current, pageX);

  const trackTo = (pageX: number) => {
    const next = scoreAt(pageX);
    if (next !== null) setDragScore(next);
  };

  const settle = (score: number | null) => {
    drag.current = null;
    setDragScore(null);
    if (score !== null && score !== value) onChange?.(score);
  };

  const beginDrag = (event: GestureResponderEvent) => {
    const { locationX, pageX, pageY } = event.nativeEvent;
    drag.current = { startX: pageX, startY: pageY, x: pageX, y: pageY };
    // The bar and thumb are not touch targets, so the touch landed on the view
    // held in trackRef and locationX is an offset inside it.
    const left = trackLeftFromTouch({ locationX, pageX, width: geometry.current.width });
    if (left !== null) {
      geometry.current.left = left;
      trackTo(pageX);
      return;
    }
    trackRef.current?.measureInWindow((x, _y, measuredWidth) => {
      if (measuredWidth <= 0) return;
      geometry.current = { left: x, width: measuredWidth };
      // The drag can already be over by the time this lands.
      if (drag.current) trackTo(pageX);
    });
  };

  const dragTravel = (event: GestureResponderEvent) => {
    const start = drag.current;
    if (!start) return null;
    const { pageX, pageY } = event.nativeEvent;
    return {
      x: Math.abs((Number.isFinite(pageX) ? pageX : start.x) - start.startX),
      y: Math.abs((Number.isFinite(pageY) ? pageY : start.y) - start.startY),
    };
  };

  const adjust = (amount: number) => {
    const next = clampSleepScore((shown ?? 50) + amount);
    setDragScore(null);
    if (next !== value) onChange?.(next);
  };

  return (
    <View style={styles.sleepScoreControl}>
      <View style={styles.sleepScoreHeading}>
        <View>
          <Text style={styles.sleepScoreLabel}>SLEEP SCORE</Text>
          {source && <Text style={styles.sleepScoreSource}>{source}</Text>}
        </View>
        <Text style={styles.sleepScoreValue}>{shown ?? '—'}</Text>
      </View>
      <View
        ref={trackRef}
        accessible
        accessibilityActions={disabled ? undefined : [{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityLabel="Sleep score"
        accessibilityRole="adjustable"
        accessibilityValue={{ min: 0, max: 100, now: shown ?? undefined, text: shown === null ? 'Not selected' : `${shown} out of 100` }}
        onAccessibilityAction={(event) => adjust(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
        onLayout={(event: LayoutChangeEvent) => {
          geometry.current.width = event.nativeEvent.layout.width;
          trackRef.current?.measureInWindow((x, _y, width) => {
            if (width > 0) geometry.current = { left: x, width };
          });
        }}
        onResponderGrant={beginDrag}
        onResponderMove={(event) => {
          const { pageX, pageY } = event.nativeEvent;
          if (drag.current) {
            drag.current.x = pageX;
            drag.current.y = pageY;
          }
          trackTo(pageX);
        }}
        onResponderRelease={(event) => settle(scoreAt(event.nativeEvent.pageX) ?? dragScore)}
        // Scoring is itself a sideways drag, so the coach history swipe must not
        // take one over once it has a horizontal direction. A downward drag is
        // the scroll view's, and is handed over. Refusing every hand-off is what
        // used to leave the screen unable to scroll.
        onResponderTerminationRequest={(event) => !dragIsHorizontal(dragTravel(event))}
        onResponderTerminate={(event) => {
          // Keep a score the finger had genuinely dragged to; discard where a
          // touch that turned into a scroll happened to land.
          settle(dragIsHorizontal(dragTravel(event)) ? dragScore : null);
        }}
        onStartShouldSetResponder={() => !disabled}
        style={styles.sleepScoreTrackTouch}
      >
        <View pointerEvents="none" style={styles.sleepScoreTrack}>
          <View style={[styles.sleepScoreTrackFill, { width: `${displayValue}%` }]} />
          <View style={[styles.sleepScoreThumb, { left: `${displayValue}%` }, shown === null && styles.sleepScoreThumbUnset]} />
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

  return <Text selectable style={styles.dailyReportText}>{visible}</Text>;
};

export default function TodayScreen({ embedded = false, chat, profile, refreshRequest, repository = mockTodayRepository, user }: TodayScreenProps) {
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  // Read by background refreshes, which need what is on screen right now rather
  // than the snapshot captured when the refresh started.
  const snapshotRef = useRef<TodaySnapshot | null>(null);
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conversation, setConversation] = useState<CheckinConversation>(initialCheckin);
  const [input, setInput] = useState('');
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  const [draftLoadAttempt, setDraftLoadAttempt] = useState(0);
  const [continuing, setContinuing] = useState(false);
  const [reviewedSleepData, setReviewedSleepData] = useState<TodaySnapshot['sleepData'] | null>(null);
  const [sleepReviewed, setSleepReviewed] = useState(false);
  const savingRef = useRef(false);
  const interpretingRef = useRef(false);
  const [interpreting, setInterpreting] = useState(false);
  const replyRequestRef = useRef(0);
  useEffect(() => () => { replyRequestRef.current += 1; }, []);
  const scrollRef = useRef<ScrollView>(null);
  const { scrollProps, scrollToLatest, showLatest } = useChatScroll({
    scrollTo: (y, animated) => scrollRef.current?.scrollTo({ y, animated }),
    scrollToEnd: animated => scrollRef.current?.scrollToEnd({ animated }),
    initiallyFollowing: false,
  });
  const [manualSleepFallback, setManualSleepFallback] = useState(false);
  const [manualSleepScore, setManualSleepScore] = useState<number | null>(null);
  const [manualSleepSaving, setManualSleepSaving] = useState(false);
  const [coachingBusy, setCoachingBusy] = useState(false);
  const [coachingError, setCoachingError] = useState('');

  const draftOwner = user?.id ?? 'demo';
  const dailyCoaching = snapshot?.dailyCoaching ?? null;

  const loadToday = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) {
      setError('');
      setLoading(true);
    }
    try {
      const nextSnapshot = await repository.loadToday();
      // Today's coaching is a fixed artifact once written, so a refresh that has
      // not yet observed it must never clear what is already on screen — nor
      // store a day without it, which the next launch would try to fill.
      const shown = snapshotRef.current;
      const merged = nextSnapshot.dailyCoaching || !shown?.dailyCoaching || shown.date !== nextSnapshot.date
        ? nextSnapshot
        : { ...nextSnapshot, dailyCoaching: shown.dailyCoaching };
      setSnapshot(merged);
      void screenCache.write(draftOwner, TODAY_CACHE_NAME, TODAY_CACHE_VERSION, merged).catch(() => undefined);
    } catch (loadError) {
      // A background refresh leaves the visible day alone; only a load with
      // nothing to show reports the failure.
      if (!silent) setError(loadError instanceof Error ? loadError.message : 'Today could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [draftOwner, repository]);

  // Last night's day renders from storage first, so reopening Your Day shows the
  // same content it had rather than a spinner while the request is in flight.
  useEffect(() => {
    let active = true;
    void screenCache.read<TodaySnapshot>(draftOwner, TODAY_CACHE_NAME, TODAY_CACHE_VERSION)
      .then(entry => {
        if (!active || !entry || entry.value?.date !== localCheckinDate()) return;
        setSnapshot(current => current ?? entry.value);
        setLoading(false);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [draftOwner]);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  const handledRefreshRequest = useRef(refreshRequest);
  useEffect(() => {
    if (refreshRequest === handledRefreshRequest.current) return;
    handledRefreshRequest.current = refreshRequest;
    void loadToday({ silent: true });
  }, [loadToday, refreshRequest]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && snapshot?.date !== localCheckinDate()) void loadToday();
    });
    return () => subscription.remove();
  }, [loadToday, snapshot?.date]);

  const applyCoaching = useCallback((coaching: DailyCoaching) => {
    setSnapshot(current => (current ? {
      ...current,
      dailyCoaching: {
        pattern: coaching.pattern,
        meaning: coaching.meaning,
        action: coaching.action,
        generatedAt: coaching.generatedAt,
      },
    } : current));
    // Generating coaching also commits tonight's experiment, so pick that up
    // without disturbing the report the user is already reading.
    void loadToday({ silent: true });
  }, [loadToday]);

  // Non-null only while the day has earned coaching but has none stored yet.
  // Once the report exists this is null, so no later visit can regenerate it.
  const pendingCoachingFor = snapshot && !snapshot.dailyCoaching && snapshot.checkin
    && snapshot.sleepData.status !== 'missing' && user && profile
    ? `${snapshot.date}:${snapshot.checkin.id}`
    : null;

  useEffect(() => {
    if (!pendingCoachingFor || !user || !profile) return;
    let active = true;
    setCoachingBusy(true);
    setCoachingError('');
    void loadDailyCoaching(user, profile)
      .then(coaching => { if (active) applyCoaching(coaching); })
      .catch(() => { if (active) setCoachingError('Today’s coaching isn’t ready yet.'); })
      .finally(() => { if (active) setCoachingBusy(false); });
    return () => { active = false; };
  }, [applyCoaching, pendingCoachingFor, profile, user]);

  const regenerateCoaching = useCallback(async () => {
    if (!user || !profile || coachingBusy) return;
    setCoachingBusy(true);
    setCoachingError('');
    try {
      applyCoaching(await loadDailyCoaching(user, profile, { refresh: true }));
    } catch {
      setCoachingError('Today’s coaching could not be rewritten. Please try again.');
    } finally {
      setCoachingBusy(false);
    }
  }, [applyCoaching, coachingBusy, profile, user]);

  const draftKey = snapshot ? checkinStorageKey(draftOwner, snapshot.date) : null;
  const draftLoaded = draftKey !== null && loadedDraftKey === draftKey;
  useEffect(() => {
    if (!draftKey || !snapshot) return;
    let active = true;
    replyRequestRef.current += 1;
    interpretingRef.current = false;
    setInterpreting(false);
    setContinuing(false);
    setLoadedDraftKey(null);
    setSleepReviewed(false);
    setReviewedSleepData(null);
    setManualSleepScore(null);
    setManualSleepFallback(false);
    setConversation(initialCheckin);
    setInput('');
    void checkinDraftStorage.load(draftOwner, snapshot.date, snapshot.sleepData).then(draft => {
      if (!active) return;
      if (draft) {
        setConversation(draft.conversation);
        setInput(snapshot.checkin ? '' : draft.input);
        setManualSleepScore(draft.manualSleepScore);
        setManualSleepFallback(draft.manualSleepFallback);
        setSleepReviewed(draft.sleepReviewed);
        setReviewedSleepData(draft.reviewedSleepData);
      }
      setLoadedDraftKey(draftKey);
    }).catch(() => {
      if (active) setError('Your saved check-in couldn’t be loaded. Please try again.');
    });
    return () => { active = false; };
  }, [draftKey, draftLoadAttempt]);

  useEffect(() => {
    if (!snapshot || !draftLoaded) return;
    // Keep only today's conversation; storage also serializes logout cleanup.
    if (snapshot.checkin && conversation.turns.length === 0) return;
    // Slider movement can produce dozens of state updates in a second. Debounce
    // draft persistence so Continue never waits behind a queue of stale scores.
    const timer = setTimeout(() => {
      void checkinDraftStorage.save(draftOwner, snapshot.date, {
        conversation, input: snapshot.checkin ? '' : input, manualSleepScore,
        manualSleepFallback, sleepReviewed, reviewedSleepData,
      }).catch(() => setError('Your latest changes couldn’t be saved on this device.'));
    }, 250);
    return () => clearTimeout(timer);
  }, [draftKey, draftLoaded, conversation, input, manualSleepScore, manualSleepFallback, sleepReviewed, reviewedSleepData, snapshot?.checkin]);

  // Today's flow renders from the device draft. The copy persisted with the
  // day's thread is the fallback once that draft is gone, such as on a second
  // device or any later day.
  const checkinMessages = chat?.messages.filter(message => message.origin === 'checkin') ?? [];
  // Today's report is rendered from the snapshot below. History includes the
  // same saved report as a message for past days, so don't display it twice here.
  const followupMessages = chat?.messages.filter(message => !message.origin) ?? [];
  const checkinTurns: CheckinTurn[] = conversation.turns.length
    ? conversation.turns
    : checkinMessages.map(message => ({ role: message.role, content: message.content }));
  // A score already reviewed today remains usable if a later wearable sync is
  // temporarily unavailable, and a score the user set for themselves stays theirs.
  // Any other newly synced score takes precedence.
  const sleepData = sleepReviewed && reviewedSleepData
    && (reviewedSleepData.status === 'manual' || snapshot?.sleepData.status === 'missing')
    ? reviewedSleepData : snapshot?.sleepData;
  const sleepContextReady = !!sleepData && (sleepData.status !== 'missing' ||
    (manualSleepFallback && manualSleepScore !== null));
  // The user is scoring the night themselves — because nothing synced, or because
  // what did sync was wrong. Either way their number is the one the day uses.
  const usingOwnScore = manualSleepFallback && manualSleepScore !== null;
  const syncedSleepLabel = snapshot?.syncedSleep
    ? snapshot.syncedSleep.source === 'apple_health' ? 'Apple Health' : 'Oura'
    : null;
  // Opens with whatever the day currently reads, so the user nudges a number
  // rather than starting from nothing.
  const startOwnScore = () => {
    setManualSleepScore(current => current ?? sleepData?.score ?? snapshot?.syncedSleep?.score ?? 50);
    setManualSleepFallback(true);
  };

  const continueCheckin = async () => {
    if (!snapshot || !sleepContextReady || !draftLoaded || continuing) return;
    const next = conversation.step === 'sleep'
      ? startCheckin(snapshot.previousCommitment?.behavior, snapshot.previousCommitment?.id) : conversation;
    const acceptedSleepData: TodaySnapshot['sleepData'] = usingOwnScore
      || snapshot.sleepData.status === 'missing'
      ? { status: 'manual', source: 'manual', score: manualSleepScore } : snapshot.sleepData;
    const request = replyRequestRef.current;
    setContinuing(true);
    setError('');
    try {
      // Persist the milestone before advancing, including the exact accepted
      // score. A tab switch or reload can immediately resume this same question.
      await checkinDraftStorage.save(draftOwner, snapshot.date, {
        conversation: next, input, manualSleepScore, manualSleepFallback,
        sleepReviewed: true, reviewedSleepData: acceptedSleepData,
      });
      if (request !== replyRequestRef.current) return;
      setConversation(next);
      setReviewedSleepData(acceptedSleepData);
      setSleepReviewed(true);
      scrollToLatest();
    } catch {
      setError('Your sleep score couldn’t be saved on this device. Please try again.');
    } finally {
      if (request === replyRequestRef.current) setContinuing(false);
    }
  };

  const reply = async (text: string, choice?: string) => {
    if (!text.trim() || savingRef.current || interpretingRef.current) return;
    if (snapshot?.checkin) {
      if (!chat || chat.sending || chat.disabled) return;
      scrollToLatest();
      // The thread keeps the message even when the reply fails, so the composer
      // clears the way it does anywhere else in the chat.
      setInput('');
      await chat.onSend(text.trim());
      return;
    }
    if (!sleepReviewed || conversation.step === 'sleep' || !sleepContextReady) return;
    setError('');
    let withReply: CheckinConversation;
    try { withReply = appendCheckinReply(conversation, text); } catch (limitError) {
      setError(limitError instanceof Error ? limitError.message : 'Please shorten this reply.');
      return;
    }
    scrollToLatest();
    if (choice) {
      setConversation(current => current.step === conversation.step ? answerCheckin(current, text, choice) : current);
      setInput('');
      return;
    }
    interpretingRef.current = true;
    setInterpreting(true);
    // The reply reads as sent while the coach interprets it, exactly like any
    // other message. A failed interpretation returns it to the composer.
    setConversation(withReply);
    setInput('');
    const request = ++replyRequestRef.current;
    try {
      const interpretation = await interpretTypedCheckinReply(conversation, text.trim());
      if (request !== replyRequestRef.current) return;
      const next = answerCheckin(conversation, text, undefined, interpretation);
      setConversation(next);
      if (interpretation.finish) await submitCheckin('', next);
    } catch (replyError) {
      if (request === replyRequestRef.current) {
        setConversation(conversation);
        setInput(current => current ? `${text}\n${current}` : text);
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
    // Include an unsent composer draft when the user taps Finish, without
    // clearing it if it exceeds the aggregate journal limit.
    let finalConversation: CheckinConversation;
    let draft;
    try {
      finalConversation = appendCheckinReply(baseConversation, finalText);
      draft = checkinDraft(finalConversation, usingOwnScore
        ? manualSleepScore ?? undefined
        : sleepData?.status === 'manual' ? sleepData.score ?? undefined : undefined);
    } catch (limitError) {
      setError(limitError instanceof Error ? limitError.message : 'Please shorten this reply.');
      return;
    }
    if (!draft) return;
    if (finalText.trim()) scrollToLatest();
    savingRef.current = true;
    setSaving(true);
    setError('');
    setConversation(finalConversation);
    if (finalText.trim()) setInput('');
    try {
      if (snapshot.previousCommitment && snapshot.previousCommitment.id === finalConversation.commitmentId && finalConversation.adherence) {
        await repository.updateCommitmentStatus(snapshot.previousCommitment.id, finalConversation.adherence);
      }
      const checkin = await repository.saveCheckin(draft);
      const saved: TodaySnapshot = {
        ...snapshot,
        checkin,
        previousCommitment: finalConversation.adherence ? null : snapshot.previousCommitment,
        sleepData: typeof draft.manualSleepScore === 'number'
          ? { status: 'manual', score: draft.manualSleepScore, source: 'manual' }
          : sleepData ?? snapshot.sleepData,
      };
      setSnapshot(saved);
      void screenCache.write(draftOwner, TODAY_CACHE_NAME, TODAY_CACHE_VERSION, saved).catch(() => undefined);
      void chat?.onCheckinComplete?.(finalConversation.turns);
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
      await loadToday({ silent: true });
      setManualSleepFallback(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Your manual sleep score was not saved.');
    } finally {
      setManualSleepSaving(false);
    }
  };

  // Hands the night back to the wearable. Only the saved score needs clearing;
  // before the check-in is submitted nothing has left the device yet.
  const useSyncedSleep = async () => {
    setError('');
    setManualSleepFallback(false);
    setManualSleepScore(null);
    if (snapshot?.sleepData.status !== 'manual' || !snapshot.checkin) return;
    setManualSleepSaving(true);
    try {
      await repository.clearManualSleepScore();
      await loadToday({ silent: true });
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : 'Your score could not be handed back to your wearable.');
    } finally {
      setManualSleepSaving(false);
    }
  };

  if (loading && !snapshot) {
    return (
      <View style={[styles.content, embedded && styles.embeddedContent]}>
        <View style={styles.embeddedHeading}>
          <View style={styles.skeletonHeadingCopy}>
            <Skeleton height={10} width={78} />
            <Skeleton height={15} style={styles.skeletonHeadingDate} width={190} />
          </View>
          <Skeleton height={52} radius={18} width={56} />
        </View>
        <View style={styles.skeletonScore}>
          <Skeleton height={11} width={92} />
          <Skeleton height={32} style={styles.skeletonScoreValue} width={62} />
          <Skeleton height={6} radius={4} style={styles.skeletonScoreTrack} />
        </View>
        <View style={styles.skeletonReport}>
          <SkeletonLines count={4} />
        </View>
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
      enabled={!embedded}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.screen}
    >
      <View style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        {...scrollProps}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
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

        {sleepData!.status === 'missing' && (!sleepReviewed || snapshot.checkin) && (
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

        {sleepData!.status !== 'missing' && (!sleepReviewed || snapshot.checkin) && (
          <View style={styles.dailyReport}>
            <SleepScoreSlider
              disabled={!manualSleepFallback}
              onChange={manualSleepFallback ? setManualSleepScore : undefined}
              source={manualSleepFallback ? 'Manual'
                : sleepData!.status === 'wearable'
                  ? sleepData!.source === 'apple_health' ? 'Apple Health' : 'Oura'
                  : 'Manual'}
              value={manualSleepFallback ? manualSleepScore : sleepData!.score ?? null}
            />
            {manualSleepFallback ? (
              <View style={styles.ownScoreArea}>
                <Text style={styles.promptHint}>
                  {syncedSleepLabel
                    ? `Your score is used for last night instead of the ${syncedSleepLabel} score of ${snapshot.syncedSleep!.score}.`
                    : 'Slide to your best estimate from 0–100.'}
                </Text>
                <View style={styles.sleepDataActions}>
                  {syncedSleepLabel && (
                    <Pressable
                      accessibilityRole="button"
                      disabled={manualSleepSaving}
                      onPress={() => void useSyncedSleep()}
                      style={styles.sleepDataSecondaryButton}
                    >
                      <Text style={styles.sleepDataSecondaryText}>Use {syncedSleepLabel} score</Text>
                    </Pressable>
                  )}
                  {snapshot.checkin && (
                    <Pressable
                      accessibilityRole="button"
                      disabled={manualSleepScore === null || manualSleepSaving}
                      onPress={() => void saveManualSleep()}
                      style={[styles.sleepDataPrimaryButton, manualSleepScore === null && styles.primaryButtonDisabled]}
                    >
                      {manualSleepSaving
                        ? <ActivityIndicator color={colors.ink} />
                        : <Text style={styles.sleepDataPrimaryText}>Save my score</Text>}
                    </Pressable>
                  )}
                </View>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={startOwnScore}
                style={({ pressed }) => [styles.ownScoreLink, pressed && styles.pressed]}
              >
                <Text style={styles.ownScoreLinkText}>
                  {sleepData!.status === 'manual' ? 'Change my score' : 'Doesn’t match your night? Score it yourself'}
                </Text>
              </Pressable>
            )}
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

        {!draftLoaded && !!error && <Pressable accessibilityRole="button" onPress={() => { setError(''); setDraftLoadAttempt(value => value + 1); }} style={styles.chip}><Text style={styles.chipText}>Retry saved check-in</Text></Pressable>}

        {!snapshot.checkin && !sleepReviewed && (
          <Pressable
            accessibilityRole="button"
            disabled={!sleepContextReady || !draftLoaded || continuing}
            onPress={() => void continueCheckin()}
            style={[styles.primaryButton, (!sleepContextReady || !draftLoaded || continuing) && styles.primaryButtonDisabled]}
          >
            {continuing ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.primaryButtonText}>Continue check-in</Text>}
          </Pressable>
        )}

        {((conversation.step !== 'sleep' && (sleepReviewed || snapshot.checkin)) || (snapshot.checkin && checkinTurns.length > 0)) && (
          <View style={styles.conversation}>
            {!snapshot.checkin && <Text style={styles.promptHint}>Sleep score {sleepData!.score ?? manualSleepScore} · {sleepData!.source === 'apple_health' ? 'Apple Health' : sleepData!.source === 'oura' ? 'Oura' : 'Manual'}</Text>}
            {checkinTurns.map((turn, index) => (
              <ChatBubble content={turn.content} key={index} role={turn.role} />
            ))}
            {interpreting && <ChatBubble role="assistant" thinking />}
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
              <>
                <DailyReport
                  action={dailyCoaching.action}
                  cacheKey={`sleep-coach:daily-report-seen:${user.id}:${snapshot.date}:${dailyCoaching.generatedAt}`}
                  meaning={dailyCoaching.meaning}
                  pattern={dailyCoaching.pattern}
                />
                {profile && (
                  <Pressable
                    accessibilityLabel="Rewrite today’s coaching"
                    accessibilityRole="button"
                    disabled={coachingBusy}
                    hitSlop={10}
                    onPress={() => void regenerateCoaching()}
                    style={({ pressed }) => [styles.regenerate, pressed && styles.pressed]}
                  >
                    {coachingBusy
                      ? <ActivityIndicator color={colors.textFaint} size="small" />
                      : <Text style={styles.regenerateIcon}>↻</Text>}
                  </Pressable>
                )}
              </>
            )}
            {!dailyCoaching && (coachingBusy || (snapshot.checkin && sleepData!.status !== 'missing')) && (
              <View style={styles.skeletonReport}>
                <SkeletonLines count={4} />
              </View>
            )}
            {!!coachingError && (
              <Pressable accessibilityRole="button" onPress={() => void regenerateCoaching()}>
                <Text style={styles.reportLoadingText}>{coachingError} Tap to try again.</Text>
              </Pressable>
            )}
        </View>
        {!!followupMessages.length && chat && (
          <View style={styles.followupMessages}>
            {followupMessages.map(message => <View key={message.id}>{chat.renderMessage(message)}</View>)}
          </View>
        )}
      </ScrollView>
      {showLatest && <JumpToLatest onPress={scrollToLatest} />}
      </View>
      <ChatComposer
        value={input}
        maxLength={snapshot.checkin ? 4000 : Math.min(4000, remainingCheckinCharacters(conversation))}
        onChangeText={setInput}
        onSend={() => void reply(input)}
        sending={saving || interpreting || !!chat?.sending}
        disabled={!draftLoaded || (!snapshot.checkin && (!sleepReviewed || !sleepContextReady)) || (!!snapshot.checkin && (!chat || chat.disabled))}
        placeholder={snapshot.checkin ? 'Ask your coach…' : !sleepReviewed ? 'Start with your sleep score above' : conversation.step === 'details' ? 'Share anything else…' : 'Reply or add more detail…'}
        error={error || chat?.error}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  followupMessages: { gap: 18, paddingTop: 18 },
  conversation: { gap: 18, paddingTop: 18 },
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
    fontWeight: '500',
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
  reportLoadingText: {
    color: colors.textSubtle,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 16,
  },
  regenerate: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    height: 30,
    justifyContent: 'center',
    marginTop: 12,
    width: 30,
  },
  regenerateIcon: {
    color: colors.textFaint,
    fontSize: 17,
    lineHeight: 20,
  },
  skeletonHeadingCopy: { gap: 8 },
  skeletonHeadingDate: { marginTop: 2 },
  skeletonReport: { gap: 9, marginTop: 22 },
  skeletonScore: { gap: 10, marginTop: 18 },
  skeletonScoreTrack: { marginTop: 8 },
  skeletonScoreValue: { alignSelf: 'flex-end' },
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
  ownScoreArea: { marginTop: 4 },
  ownScoreLink: { alignSelf: 'flex-start', marginTop: 10, paddingVertical: 4 },
  ownScoreLinkText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
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
