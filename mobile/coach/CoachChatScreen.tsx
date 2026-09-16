import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { User } from "@supabase/supabase-js";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, layout } from "../design/theme";
import { horizontalDragClaimed } from "../gestures";
import type { SleepProfile } from "../onboarding/types";
import ChatBubble from "./ChatBubble";
import ChatComposer from "./ChatComposer";
import TodayScreen from "../today/TodayScreen";
import { feelingLabel } from "../today/feeling";
import type { TodayRepository } from "../today/types";
import {
  createCoachConversation,
  dailyConversationDate,
  getOrCreateDailyConversation,
  loadCoachHomeState,
  loadCoachConversation,
  localDate,
  listCoachConversations,
  resolveCoachToolCall,
  saveCheckinTranscript,
  sendCoachMessage,
} from "./coachRepository";
import type {
  CheckinTranscriptTurn,
  CoachConversationSummary,
  CoachHomeState,
  CoachMessage,
} from "./coachRepository";

const HISTORY_SWIPE_ACTIVATION_DISTANCE = 18;
const HISTORY_SWIPE_OPEN_DISTANCE = 96;
const HISTORY_DRAWER_WIDTH_RATIO = 0.82;
const HISTORY_DRAWER_OPEN_DURATION = 260;
const HISTORY_DRAWER_CLOSE_DURATION = 200;

const personalizedGreeting = (state: CoachHomeState | null) => {
  if (!state) return "Your coach will connect the dots as your sleep context builds.";
  if (typeof state.sleepScore === "number") {
    const source = state.sleepSource === "manual"
      ? "self-reported "
      : state.sleepSource === "apple_health"
        ? "Apple Health-derived "
        : state.sleepSource === "oura"
          ? "Oura "
          : "";
    const energy = state.morningFeeling ? ` You said you feel ${feelingLabel(state.morningFeeling).toLowerCase()} this morning.` : "";
    return `Last night’s ${source}sleep score was ${Math.round(state.sleepScore)}.${energy}`;
  }
  if (state.hasCheckedInToday && state.morningFeeling) {
    return `Your wearable missed last night, but you said you feel ${feelingLabel(state.morningFeeling).toLowerCase()} this morning.`;
  }
  return "Add last night’s sleep data to unlock today’s personalized context.";
};

const dailyDateLabel = (date: string) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
    .format(new Date(`${date}T12:00:00`));

const Message = ({
  animate,
  message,
  onResolveToolCall,
  resolving,
}: {
  animate: boolean;
  message: CoachMessage;
  onResolveToolCall: (toolCallId: string, action: "confirm" | "cancel") => void;
  resolving: boolean;
}) => {
  const toolCall = message.toolCall;
  const proposalExpired = toolCall
    ? toolCall.status === "expired" ||
      (toolCall.status === "pending" && new Date(toolCall.expiresAt) <= new Date())
    : false;
  return (
    <ChatBubble
      animate={animate}
      content={message.content}
      role={message.role}
      thinking={!!message.pending && !message.content}
    >
      {toolCall && (
        <View style={styles.toolCard}>
          <Text style={styles.toolEyebrow}>PROPOSED EXPERIMENT</Text>
          <Text style={styles.toolPreviousLabel}>Replace</Text>
          <Text style={styles.toolPrevious}>{toolCall.proposal.previousExperiment}</Text>
          <Text style={styles.toolPreviousLabel}>With</Text>
          <Text style={styles.toolReplacement}>{toolCall.proposal.replacementExperiment}</Text>
          <Text style={styles.toolRationale}>{toolCall.proposal.coachRationale}</Text>
          <Text style={styles.toolReason}>Based on your reason: {toolCall.proposal.userReason}</Text>
          {toolCall.status === "pending" && !proposalExpired ? (
            <View style={styles.toolActions}>
              <Pressable
                accessibilityRole="button"
                disabled={resolving}
                onPress={() => onResolveToolCall(toolCall.id, "confirm")}
                style={[styles.toolConfirm, resolving && styles.disabled]}
              >
                {resolving ? <ActivityIndicator color={colors.ink} size="small" /> : (
                  <Text style={styles.toolConfirmText}>Change tonight</Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={resolving}
                onPress={() => onResolveToolCall(toolCall.id, "cancel")}
                style={[styles.toolCancel, resolving && styles.disabled]}
              >
                <Text style={styles.toolCancelText}>Keep current</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.toolStatus}>
              {toolCall.status === "completed" ? "Changed" : toolCall.status === "cancelled"
                ? "Not applied" : proposalExpired ? "Proposal expired" : "Unavailable"}
            </Text>
          )}
        </View>
      )}
    </ChatBubble>
  );
};

export default function CoachChatScreen({
  dailyViewRequest,
  homeRequest,
  refreshRequest,
  user,
  profile,
  repository,
}: {
  dailyViewRequest?: number;
  homeRequest?: number;
  refreshRequest?: number;
  user: User;
  profile: SleepProfile;
  repository: TodayRepository;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  // Threads already read this session reopen from here, so returning to a
  // conversation paints its history before the refresh comes back. Held in a ref
  // because reopening a thread is what renders it, not the cache growing.
  const threadCache = useRef<Record<string, CoachMessage[]>>({});
  // Tracked with its date so a session that outlives midnight opens the new
  // day's thread instead of reusing yesterday's.
  const [dailyConversation, setDailyConversation] = useState<{ id: string; date: string } | null>(null);
  const [conversations, setConversations] = useState<CoachConversationSummary[]>([]);
  const [homeState, setHomeState] = useState<CoachHomeState | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerOpenRef = useRef(false);
  const [revealingMessageId, setRevealingMessageId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [busyAction, setBusyAction] = useState(false);
  const [resolvingToolCallId, setResolvingToolCallId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dailyViewOpen, setDailyViewOpen] = useState(false);
  const [pastDailyDate, setPastDailyDate] = useState<string | null>(null);
  const listRef = useRef<FlatList<CoachMessage>>(null);
  // Identifies which thread the user asked for last, so a slow read cannot
  // deliver its messages into a conversation they have already left.
  const openRequestRef = useRef(0);
  const { width: screenWidth } = useWindowDimensions();
  const drawerWidth = screenWidth * HISTORY_DRAWER_WIDTH_RATIO;
  const drawerTranslateX = useRef(new Animated.Value(-drawerWidth)).current;
  const drawerBackdropOpacity = useRef(new Animated.Value(0)).current;

  const refreshHistory = useCallback(async () => {
    const history = await listCoachConversations(user);
    setConversations(history);
  }, [user]);

  const animateHistoryOpen = useCallback((duration: number) => {
    Animated.parallel([
      Animated.timing(drawerTranslateX, {
        duration,
        easing: Easing.out(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(drawerBackdropOpacity, {
        duration,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, [
    drawerBackdropOpacity,
    drawerTranslateX,
  ]);

  const animateHistoryClosed = useCallback((duration: number) => {
    Animated.parallel([
      Animated.timing(drawerTranslateX, {
        duration,
        easing: Easing.in(Easing.cubic),
        toValue: -drawerWidth,
        useNativeDriver: true,
      }),
      Animated.timing(drawerBackdropOpacity, {
        duration,
        easing: Easing.in(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) { drawerOpenRef.current = false; setDrawerOpen(false); }
    });
  }, [
    drawerBackdropOpacity,
    drawerTranslateX,
    drawerWidth,
  ]);

  const openHistory = useCallback(() => {
    drawerTranslateX.stopAnimation();
    drawerBackdropOpacity.stopAnimation();
    drawerTranslateX.setValue(-drawerWidth);
    drawerBackdropOpacity.setValue(0);
    drawerOpenRef.current = true;
    setDrawerOpen(true);
    void refreshHistory().catch(() => undefined);
    requestAnimationFrame(() =>
      animateHistoryOpen(HISTORY_DRAWER_OPEN_DURATION),
    );
  }, [
    animateHistoryOpen,
    drawerBackdropOpacity,
    drawerTranslateX,
    drawerWidth,
    refreshHistory,
  ]);

  const closeHistory = useCallback(() => {
    if (!drawerOpenRef.current) return;
    animateHistoryClosed(HISTORY_DRAWER_CLOSE_DURATION);
  }, [animateHistoryClosed]);

  const historySwipeResponder = useMemo(
    () =>
      PanResponder.create({
        // This capture runs before the control under the touch is given the
        // move, so a control that reads sideways drags — the sleep score slider
        // — has to be honoured by its touch-start claim rather than by asking it
        // to give the gesture up.
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          !drawerOpenRef.current &&
          !horizontalDragClaimed() &&
          gesture.dx >= HISTORY_SWIPE_ACTIVATION_DISTANCE &&
          gesture.dx > Math.abs(gesture.dy) * 1.25,
        onPanResponderGrant: () => {
          drawerTranslateX.stopAnimation();
          drawerBackdropOpacity.stopAnimation();
          drawerTranslateX.setValue(-drawerWidth);
          drawerBackdropOpacity.setValue(0);
          drawerOpenRef.current = true;
          setDrawerOpen(true);
        },
        onPanResponderMove: (_, gesture) => {
          const distance = Math.min(Math.max(gesture.dx, 0), drawerWidth);
          const progress = distance / drawerWidth;
          drawerTranslateX.setValue(-drawerWidth + distance);
          drawerBackdropOpacity.setValue(progress);
        },
        onPanResponderRelease: (_, gesture) => {
          const distance = Math.min(Math.max(gesture.dx, 0), drawerWidth);
          const progress = distance / drawerWidth;
          if (gesture.dx >= HISTORY_SWIPE_OPEN_DISTANCE) {
            const remainingDistance = drawerWidth - distance;
            const releaseVelocity = Math.max(gesture.vx, 0.4);
            const completionDuration = Math.min(
              HISTORY_DRAWER_OPEN_DURATION,
              Math.max(80, remainingDistance / releaseVelocity),
            );
            void refreshHistory().catch(() => undefined);
            animateHistoryOpen(completionDuration);
          } else {
            animateHistoryClosed(
              Math.max(80, HISTORY_DRAWER_CLOSE_DURATION * progress),
            );
          }
        },
        onPanResponderTerminate: () => animateHistoryClosed(100),
      }),
    [
      animateHistoryClosed,
      animateHistoryOpen,
      drawerBackdropOpacity,
      drawerTranslateX,
      drawerWidth,
      refreshHistory,
    ],
  );

  useEffect(() => {
    void refreshHistory().catch(() => undefined);
    void loadCoachHomeState(user).then(setHomeState).catch(() => setHomeState(null));
  }, [user.id, refreshRequest]);

  // Mirror each settled thread so reopening it never starts from an empty list.
  // Skipped mid-send so a streaming reply is only cached once it is complete.
  useEffect(() => {
    if (!conversationId || sending) return;
    threadCache.current[conversationId] = messages;
  }, [conversationId, messages, sending]);

  const beginConversation = async (firstMessage: string) => {
    const id = await createCoachConversation(user, firstMessage);
    setConversationId(id);
    return id;
  };

  const showCoachHome = useCallback(() => {
    // Any thread read still in flight belongs to the view being left.
    openRequestRef.current += 1;
    setDailyViewOpen(false);
    setPastDailyDate(null);
    setConversationId(null);
    setMessages([]);
    setInput("");
    setError("");
    setRevealingMessageId(null);
    closeHistory();
    void loadCoachHomeState(user).then(setHomeState).catch(() => undefined);
  }, [closeHistory, user]);

  const startNewChat = showCoachHome;

  const openDailyThread = useCallback(async () => {
    setError("");
    const request = ++openRequestRef.current;
    const showDaily = (id: string) => {
      setConversationId(id);
      setDailyViewOpen(true);
      setPastDailyDate(null);
      closeHistory();
    };
    // Today's thread stays in memory once opened, so coming back to Your Day is
    // immediate and the reconciling read happens behind the visible content.
    const cached = dailyConversation?.date === localDate() ? dailyConversation.id : null;
    if (cached && threadCache.current[cached]) {
      setMessages(threadCache.current[cached]);
      showDaily(cached);
      void loadCoachConversation(user, cached)
        .then(loaded => {
          // A newer open or an in-flight reply owns the thread now.
          if (request === openRequestRef.current && !sendingRef.current) setMessages(loaded);
        })
        .catch(() => undefined);
      return;
    }
    setBusyAction(true);
    try {
      const id = await getOrCreateDailyConversation(user);
      const loadedMessages = await loadCoachConversation(user, id);
      if (request !== openRequestRef.current) return;
      setDailyConversation({ id, date: localDate() });
      setMessages(loadedMessages);
      showDaily(id);
      await refreshHistory();
    } catch (loadError) {
      if (request === openRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : "Today’s coaching thread could not be opened.");
      }
    } finally {
      if (request === openRequestRef.current) setBusyAction(false);
    }
  }, [closeHistory, dailyConversation, refreshHistory, user]);

  // Both are counters bumped by the caller. Compare against the value already
  // handled so a new callback identity cannot replay the last navigation.
  const handledHomeRequest = useRef(homeRequest);
  useEffect(() => {
    if (!homeRequest || homeRequest === handledHomeRequest.current) return;
    handledHomeRequest.current = homeRequest;
    showCoachHome();
  }, [homeRequest, showCoachHome]);

  const handledDailyViewRequest = useRef(dailyViewRequest);
  useEffect(() => {
    if (!dailyViewRequest || dailyViewRequest === handledDailyViewRequest.current) return;
    handledDailyViewRequest.current = dailyViewRequest;
    void openDailyThread();
  }, [dailyViewRequest, openDailyThread]);

  // The saved check-in already lives in Supabase; a failed transcript write only
  // costs this day's thread its conversation, which the device draft still shows.
  const persistCheckinTranscript = useCallback(async (turns: CheckinTranscriptTurn[]) => {
    if (!conversationId) return;
    try {
      await saveCheckinTranscript(user, conversationId, turns);
      setMessages(await loadCoachConversation(user, conversationId));
      await refreshHistory();
    } catch { /* Keep the completed check-in view intact. */ }
  }, [conversationId, refreshHistory, user]);

  const openConversation = async (conversation: CoachConversationSummary) => {
    const dailyDate = dailyConversationDate(conversation.title);
    if (dailyDate === localDate()) return openDailyThread();
    setError("");
    const request = ++openRequestRef.current;
    // A thread read earlier this session reopens without a loading state; the
    // read below only reconciles what another device may have added.
    const cached = threadCache.current[conversation.id];
    // Cleared when there is nothing cached, so the thread being left is never
    // shown under the new title and never mirrored into the new thread's cache.
    setMessages(cached ?? []);
    setConversationId(conversation.id);
    setDailyViewOpen(false);
    setPastDailyDate(dailyDate ?? null);
    closeHistory();
    setBusyAction(!cached);
    try {
      const loaded = await loadCoachConversation(user, conversation.id);
      if (request === openRequestRef.current) setMessages(loaded);
    } catch (loadError) {
      if (!cached && request === openRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : "That conversation could not be loaded.");
      }
    } finally {
      if (request === openRequestRef.current) setBusyAction(false);
    }
  };

  const scrollToLatest = () => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  const send = async (suggested?: string): Promise<boolean> => {
    const content = (suggested ?? input).trim();
    if (!content || sendingRef.current || busyAction || resolvingToolCallId) return false;
    sendingRef.current = true;

    const optimistic: CoachMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    const streamingId = `streaming-${Date.now()}`;
    const streaming: CoachMessage = {
      id: streamingId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      pending: true,
    };

    setInput("");
    setError("");
    setSending(true);
    setMessages(current => [...current, optimistic, streaming]);
    scrollToLatest();

    let receivedText = "";
    let displayedLength = 0;
    let drainResolver: (() => void) | null = null;
    let streamFinished = false;
    const revealTimer = setInterval(() => {
      const remaining = receivedText.length - displayedLength;
      if (remaining <= 0) {
        if (streamFinished && drainResolver) {
          drainResolver();
          drainResolver = null;
        }
        return;
      }
      const step = remaining > 160 ? 5 : remaining > 80 ? 3 : remaining > 32 ? 2 : 1;
      displayedLength = Math.min(displayedLength + step, receivedText.length);
      const visible = receivedText.slice(0, displayedLength);
      setMessages(current => current.map(message => {
        if (message.id === optimistic.id) return { ...message, pending: false };
        return message.id === streamingId
          ? { ...message, content: visible, pending: false }
          : message;
      }));
      scrollToLatest();
    }, 18);

    try {
      const id = conversationId ?? await beginConversation(content);
      const response = await sendCoachMessage(user, profile, id, content, delta => {
        receivedText += delta;
      });
      streamFinished = true;
      if (displayedLength < receivedText.length) {
        await new Promise<void>(resolve => {
          drainResolver = resolve;
        });
      }
      setMessages(current => current.map(message =>
        message.id === streamingId ? response : message.id === optimistic.id
          ? { ...message, pending: false }
          : message
      ));
      await refreshHistory().catch(() => undefined);
      scrollToLatest();
      return true;
    } catch (sendError) {
      // The message itself is persisted before the reply streams, so it stays
      // in the thread; only the reply that never arrived is dropped.
      setMessages(current => current
        .filter(message => message.id !== streamingId)
        .map(message => message.id === optimistic.id ? { ...message, pending: false } : message));
      setError(sendError instanceof Error ? sendError.message : "Your coach could not respond.");
      return false;
    } finally {
      clearInterval(revealTimer);
      sendingRef.current = false;
      setSending(false);
    }
  };

  const handleToolCall = async (toolCallId: string, action: "confirm" | "cancel") => {
    if (!conversationId || resolvingToolCallId) return;
    setResolvingToolCallId(toolCallId);
    setError("");
    try {
      const result = await resolveCoachToolCall(conversationId, toolCallId, action);
      setMessages(current => [
        ...current.map(message => message.toolCall?.id === toolCallId
          ? { ...message, toolCall: result.toolCall }
          : message),
        ...result.messages,
      ]);
      await refreshHistory();
      scrollToLatest();
    } catch (toolError) {
      setError(toolError instanceof Error
        ? toolError.message
        : "The experiment change could not be updated.");
    } finally {
      setResolvingToolCallId(null);
    }
  };

  const isCoachHome = !dailyViewOpen && !conversationId && messages.length === 0;
  // While another thread is on screen the mounted Your Day reads its own history
  // from the cache, so its transcript never shows someone else's conversation.
  const dailyMessages = dailyConversation
    ? (conversationId === dailyConversation.id ? messages : threadCache.current[dailyConversation.id] ?? [])
    : [];
  const conversationLabel = (conversation: CoachConversationSummary) => {
    const dailyDate = dailyConversationDate(conversation.title);
    if (!dailyDate) return conversation.title;
    return `Your Day · ${dailyDateLabel(dailyDate)}`;
  };
  const renderMessage = (message: CoachMessage) => (
    <Message
      animate={message.id === revealingMessageId}
      message={message}
      onResolveToolCall={(toolCallId, action) => void handleToolCall(toolCallId, action)}
      resolving={resolvingToolCallId === message.toolCall?.id}
    />
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={8}
        style={styles.keyboard}
      >
        <View style={styles.swipeArea} {...historySwipeResponder.panHandlers}>
          <View style={styles.header}>
            <Pressable
              accessibilityLabel="Open chat history"
              accessibilityRole="button"
              onPress={openHistory}
              style={styles.historyButton}
            >
              <Text style={styles.historyButtonText}>☰</Text>
            </Pressable>
            <View>
              <Text style={styles.eyebrow}>30 DAY SLEEP COACH</Text>
              <Text style={styles.title}>Coach</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => {
              if (isCoachHome) void openDailyThread();
              else showCoachHome();
            }} style={styles.newButton}>
              <Text style={styles.newButtonText}>{isCoachHome ? "Your day" : "← Coach home"}</Text>
            </Pressable>
          </View>

          {/* Your Day stays mounted once opened. Its check-in, sleep score, and
              coaching report survive every trip to Coach home or another thread,
              so none of it reloads or regenerates on the way back. */}
          {dailyConversation && (
            <View style={dailyViewOpen ? styles.dailyPane : styles.hiddenPane}>
              <TodayScreen
                key={dailyConversation.id}
                embedded
                refreshRequest={refreshRequest}
                chat={{
                  messages: dailyMessages,
                  renderMessage,
                  onCheckinComplete: persistCheckinTranscript,
                  onSend: send,
                  sending,
                  disabled: busyAction || !!resolvingToolCallId,
                  error,
                }}
                profile={profile}
                repository={repository}
                user={user}
              />
            </View>
          )}

          {!dailyViewOpen && (!conversationId && messages.length === 0 ? (
            <View style={styles.newChat}>
              <Text style={styles.newChatTitle}>What would you like to explore?</Text>
              <Text style={styles.personalizedNote}>{personalizedGreeting(homeState)}</Text>
              <Pressable accessibilityRole="button" onPress={() => void openDailyThread()} style={({ pressed }) => [styles.dailyEntry, pressed && styles.suggestionPressed]}>
                <View style={styles.dailyEntryCopy}>
                  <Text style={styles.dailyEntryEyebrow}>YOUR DAY</Text>
                  <Text style={styles.dailyEntryTitle}>{homeState?.hasCheckedInToday ? "View today’s coaching" : "Complete today’s check-in"}</Text>
                </View>
                <Text style={styles.dailyEntryArrow}>›</Text>
              </Pressable>
              <View style={styles.suggestions}>
                {[
                  "How is my sleep trending?",
                  "Today’s coaching",
                  "What’s working?",
                ].map(suggestion => (
                  <Pressable
                    accessibilityRole="button"
                    key={suggestion}
                    onPress={() => void send(suggestion)}
                    style={({ pressed }) => [styles.suggestion, pressed && styles.suggestionPressed]}
                  >
                    <Text style={styles.suggestionText}>{suggestion}</Text>
                    <Text style={styles.suggestionArrow}>›</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            <FlatList
              ListEmptyComponent={
                busyAction ? (
                  <View style={styles.loading}>
                    <ActivityIndicator color={colors.accent} />
                    <Text style={styles.loadingText}>Coach is looking at your context…</Text>
                  </View>
                ) : pastDailyDate ? (
                  <View style={styles.loading}>
                    <Text style={styles.emptyThreadText}>
                      No conversation was saved for {dailyDateLabel(pastDailyDate)}. Ask your coach about that day below.
                    </Text>
                  </View>
                ) : null
              }
              contentContainerStyle={[
                styles.messages,
                messages.length === 0 && styles.emptyMessages,
              ]}
              data={messages}
              keyExtractor={message => message.id}
              ref={listRef}
              renderItem={({ item }) => renderMessage(item)}
              showsVerticalScrollIndicator={false}
            />
          ))}
        </View>

        {!dailyViewOpen && <ChatComposer
          value={input}
          onChangeText={setInput}
          onSend={() => void send()}
          disabled={busyAction || !!resolvingToolCallId}
          sending={sending}
          error={error}
        />}

      </KeyboardAvoidingView>
      {drawerOpen && (
        <View style={styles.drawerLayer}>
          <Animated.View
            style={[
              styles.drawerBackdrop,
              { opacity: drawerBackdropOpacity },
            ]}
          >
            <Pressable
              accessibilityLabel="Close chat history"
              onPress={closeHistory}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View
            style={[
              styles.drawer,
              {
                transform: [{ translateX: drawerTranslateX }],
                width: drawerWidth,
              },
            ]}
          >
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>Conversations</Text>
              <Pressable onPress={closeHistory}>
                <Text style={styles.drawerClose}>×</Text>
              </Pressable>
            </View>
            <Pressable onPress={startNewChat} style={styles.drawerNewChat}>
              <Text style={styles.drawerNewChatText}>＋ New chat</Text>
            </Pressable>
            <FlatList
              contentContainerStyle={styles.drawerList}
              data={conversations}
              keyExtractor={conversation => conversation.id}
              ListEmptyComponent={<Text style={styles.drawerEmpty}>Your conversations will appear here.</Text>}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => void openConversation(item)}
                  style={({ pressed }) => [
                    styles.conversationRow,
                    item.id === conversationId && styles.conversationRowActive,
                    pressed && styles.suggestionPressed,
                  ]}
                >
                  <View style={styles.conversationTitleRow}>
                    <Text numberOfLines={2} style={styles.conversationTitle}>{conversationLabel(item)}</Text>
                    {dailyConversationDate(item.title) && <Text style={styles.dailyBadge}>DAILY</Text>}
                  </View>
                </Pressable>
              )}
            />
          </Animated.View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  ambient: {
    bottom: 0,
    left: 0,
    overflow: "hidden",
    position: "absolute",
    right: 0,
    top: 0,
  },
  ambientViolet: {
    backgroundColor: "#C0573C",
    borderRadius: 220,
    height: 440,
    opacity: 0.16,
    position: "absolute",
    right: -250,
    top: -220,
    width: 440,
  },
  compactGreeting: { paddingHorizontal: 4 },
  compactGreetingText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  dailyBrief: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 22,
    padding: 20,
  },
  dailyFocus: {
    backgroundColor: colors.surfaceAccent,
    borderLeftColor: colors.accent,
    borderLeftWidth: 2,
    borderRadius: 14,
    marginTop: 18,
    padding: 15,
  },
  dailyFocusLabel: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  dailyFocusText: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 24,
    marginTop: 7,
  },
  dailyMeaning: {
    color: colors.accentSoft,
    fontSize: 15,
    fontStyle: "italic",
    lineHeight: 23,
    marginTop: 13,
  },
  dailyPattern: { color: colors.text, fontSize: 18, lineHeight: 27 },
  dailyWhy: { color: colors.textSubtle, fontSize: 13, lineHeight: 20, marginTop: 16 },
  disabled: { opacity: 0.55 },
  emptyMessages: { flexGrow: 1 },
  emptyThreadText: { color: colors.textSubtle, fontSize: 13, lineHeight: 20, textAlign: "center" },
  eyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: "500",
    letterSpacing: 1.4,
  },
  header: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 12,
    paddingHorizontal: 20,
    paddingTop: layout.safeAreaHeaderPadding,
  },
  historyButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  historyButtonText: { color: colors.textMuted, fontSize: 22 },
  keyboard: { flex: 1 },
  launcher: {
    flex: 1,
    paddingBottom: 22,
    paddingHorizontal: 24,
    paddingTop: 36,
  },
  launcherAction: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 72,
    padding: 14,
  },
  launcherActionCopy: { flex: 1, marginHorizontal: 13 },
  launcherActionDescription: {
    color: colors.textSubtle,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  launcherActionLabel: { color: colors.text, fontSize: 16, fontWeight: "700" },
  launcherActionPressed: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderSelected,
  },
  launcherActions: { gap: 10, marginTop: 22 },
  launcherArrow: { color: colors.textFaint, fontSize: 26, fontWeight: "300" },
  launcherError: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
    textAlign: "center",
  },
  launcherIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceAccent,
    borderRadius: 13,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  launcherIconText: { color: colors.accent, fontSize: 16, fontWeight: "800" },
  launcherIntro: { alignItems: "center", paddingHorizontal: 18 },
  launcherSubtitle: {
    color: colors.textSubtle,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 9,
    textAlign: "center",
  },
  launcherTitle: {
    color: colors.text,
    fontSize: 27,
    fontWeight: "700",
    letterSpacing: -0.7,
    lineHeight: 34,
    marginTop: 17,
    textAlign: "center",
  },
  loading: { alignItems: "center", flex: 1, gap: 12, justifyContent: "center" },
  loadingText: { color: colors.textSubtle, fontSize: 13 },
  messages: { gap: 18, paddingBottom: 20, paddingHorizontal: 18, paddingTop: 12 },
  newButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  newButtonText: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  newChat: {
    flex: 1,
    paddingBottom: 14,
    paddingHorizontal: 22,
    paddingTop: 26,
  },
  newChatTitle: {
    color: colors.text,
    fontSize: 25,
    fontWeight: "500",
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  personalizedNote: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 24,
    marginTop: 12,
  },
  dailyEntry: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: 22,
    minHeight: 76,
    paddingHorizontal: 17,
    paddingVertical: 14,
  },
  dailyEntryCopy: { flex: 1 },
  dailyEntryEyebrow: { color: colors.textSubtle, fontSize: 10, fontWeight: "500", letterSpacing: 1.3 },
  dailyEntryTitle: { color: colors.text, fontSize: 16, fontWeight: "500", marginTop: 5 },
  dailyEntryArrow: { color: colors.accent, fontSize: 28, marginLeft: 12 },
  dailyPane: { flex: 1 },
  hiddenPane: { display: "none" },
  suggestions: { gap: 8, marginTop: "auto", paddingTop: 48 },
  swipeArea: { flex: 1 },
  suggestion: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 46,
    paddingHorizontal: 2,
  },
  suggestionPressed: { opacity: 0.58 },
  suggestionText: { color: colors.textMuted, fontSize: 14 },
  suggestionArrow: { color: colors.textFaint, fontSize: 23 },
  drawerLayer: {
    bottom: 0,
    flexDirection: "row",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 20,
  },
  drawerBackdrop: { backgroundColor: "rgba(0,0,0,0.54)", flex: 1 },
  drawer: {
    backgroundColor: colors.surfaceMuted,
    bottom: 0,
    left: 0,
    paddingBottom: 24,
    paddingHorizontal: 16,
    paddingTop: 58,
    position: "absolute",
    top: 0,
  },
  drawerHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  drawerTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
  drawerClose: { color: colors.textMuted, fontSize: 30, fontWeight: "300" },
  drawerNewChat: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  drawerNewChatText: { color: colors.accent, fontSize: 14, fontWeight: "800" },
  drawerList: { gap: 4, paddingTop: 14 },
  drawerEmpty: { color: colors.textSubtle, fontSize: 13, lineHeight: 19, padding: 12 },
  conversationRow: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 13 },
  conversationRowActive: { backgroundColor: colors.surfaceAccent },
  conversationTitleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  conversationTitle: { color: colors.textMuted, flex: 1, fontSize: 14, lineHeight: 19 },
  dailyBadge: {
    backgroundColor: colors.surfaceAccent,
    borderRadius: 7,
    color: colors.accent,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.8,
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  screen: { backgroundColor: colors.canvas, flex: 1, overflow: "hidden" },
  spark: {
    alignItems: "center",
    backgroundColor: colors.surfaceAccent,
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  sparkText: { color: colors.accent, fontSize: 18 },
  status: { alignItems: "center", flexDirection: "row", gap: 6, paddingBottom: 4 },
  statusDot: {
    backgroundColor: colors.success,
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  statusText: { color: colors.textSubtle, fontSize: 11 },
  talkButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.accent,
    borderRadius: 16,
    flexDirection: "row",
    gap: 8,
    marginTop: 20,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  talkButtonArrow: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  talkButtonText: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  toolActions: { flexDirection: "row", gap: 8, marginTop: 16 },
  toolCancel: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: 13,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 12,
  },
  toolCancelText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  toolCard: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSelected,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
  },
  toolConfirm: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 13,
    flex: 1.2,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 12,
  },
  toolConfirmText: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  toolEyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.3,
    marginBottom: 12,
  },
  toolPrevious: {
    color: colors.textSubtle,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 11,
    textDecorationLine: "line-through",
  },
  toolPreviousLabel: {
    color: colors.textFaint,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  toolRationale: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 9 },
  toolReason: {
    color: colors.textSubtle,
    fontSize: 11,
    fontStyle: "italic",
    lineHeight: 17,
    marginTop: 10,
  },
  toolReplacement: { color: colors.text, fontSize: 15, fontWeight: "700", lineHeight: 21 },
  toolStatus: {
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceAccent,
    borderRadius: 10,
    color: colors.accentSoft,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 14,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "500",
    letterSpacing: -0.7,
    marginTop: 1,
  },
  welcomeBrief: {
    borderLeftColor: colors.borderSelected,
    borderLeftWidth: 2,
    paddingLeft: 18,
    paddingRight: 6,
  },
  welcomeFallback: { minHeight: 105, paddingHorizontal: 4 },
  welcomeGreeting: {
    color: colors.text,
    fontSize: 25,
    fontWeight: "700",
    letterSpacing: -0.6,
    lineHeight: 31,
  },
  welcomeLoadingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  welcomeLoadingText: { color: colors.textSubtle, fontSize: 12 },
  welcomeMeaning: {
    color: colors.accentSoft,
    fontSize: 14,
    fontStyle: "italic",
    lineHeight: 21,
    marginTop: 12,
  },
  welcomePattern: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 13,
  },
  welcomeTonight: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 16,
  },
  welcomeTonightLabel: { fontWeight: "800" },
});
