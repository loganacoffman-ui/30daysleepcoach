import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import type { User } from "@supabase/supabase-js";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "../design/theme";
import type { SleepProfile } from "../onboarding/types";
import {
  createCoachConversation,
  loadCoachHomeState,
  loadCoachConversation,
  listCoachConversations,
  resolveCoachToolCall,
  sendCoachMessage,
} from "./coachRepository";
import type { CoachConversationSummary, CoachHomeState, CoachMessage } from "./coachRepository";

const HISTORY_SWIPE_ACTIVATION_DISTANCE = 18;
const HISTORY_SWIPE_OPEN_DISTANCE = 96;

const personalizedGreeting = (state: CoachHomeState | null) => {
  if (!state) return "Your coach will connect the dots as your sleep context builds.";
  if (typeof state.sleepScore === "number") {
    const source = state.sleepSource === "manual" ? "self-reported " : "";
    const energy = typeof state.feeling === "number" ? ` You checked in at ${Math.round(state.feeling)}/100 energy.` : "";
    return `Last night’s ${source}sleep score was ${Math.round(state.sleepScore)}.${energy}`;
  }
  if (state.hasCheckedInToday && typeof state.feeling === "number") {
    return `Your wearable missed last night, but you checked in at ${Math.round(state.feeling)}/100 energy.`;
  }
  return "Add last night’s sleep data to unlock today’s personalized context.";
};

const plainCoachText = (text: string) =>
  text
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .trim();

const StreamingText = ({
  animate,
  style,
  text,
}: {
  animate: boolean;
  style: StyleProp<TextStyle>;
  text: string;
}) => {
  const clean = plainCoachText(text);
  const [visibleText, setVisibleText] = useState(animate ? "" : clean);

  useEffect(() => {
    if (!animate) {
      setVisibleText(clean);
      return;
    }
    const words = clean.split(/\s+/).filter(Boolean);
    let visibleWords = 0;
    setVisibleText("");
    const timer = setInterval(() => {
      visibleWords += 1;
      setVisibleText(words.slice(0, visibleWords).join(" "));
      if (visibleWords >= words.length) clearInterval(timer);
    }, 32);
    return () => clearInterval(timer);
  }, [animate, clean]);

  return <Text style={style}>{animate ? visibleText : clean}</Text>;
};

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
  const isUser = message.role === "user";
  const toolCall = message.toolCall;
  const proposalExpired = toolCall
    ? toolCall.status === "expired" ||
      (toolCall.status === "pending" && new Date(toolCall.expiresAt) <= new Date())
    : false;
  return (
    <View style={[styles.messageRow, isUser && styles.userMessageRow]}>
      <View style={[styles.message, isUser ? styles.userMessage : styles.coachMessage]}>
        {!isUser && <Text style={styles.coachLabel}>COACH</Text>}
        {!isUser && message.pending && !message.content ? (
          <ActivityIndicator color={colors.accent} size="small" />
        ) : (
          <StreamingText
            animate={animate && !isUser}
            style={[styles.messageText, isUser && styles.userMessageText]}
            text={message.content}
          />
        )}
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
      </View>
    </View>
  );
};

export default function CoachChatScreen({
  user,
  profile,
}: {
  user: User;
  profile: SleepProfile;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [conversations, setConversations] = useState<CoachConversationSummary[]>([]);
  const [homeState, setHomeState] = useState<CoachHomeState | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [revealingMessageId, setRevealingMessageId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [resolvingToolCallId, setResolvingToolCallId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const listRef = useRef<FlatList<CoachMessage>>(null);

  const refreshHistory = useCallback(async () => {
    const history = await listCoachConversations(user);
    setConversations(history);
  }, [user]);

  const openHistory = useCallback(() => {
    setDrawerOpen(true);
    void refreshHistory().catch(() => undefined);
  }, [refreshHistory]);

  const historySwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          !drawerOpen &&
          gesture.dx >= HISTORY_SWIPE_ACTIVATION_DISTANCE &&
          gesture.dx > Math.abs(gesture.dy) * 1.25,
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx >= HISTORY_SWIPE_OPEN_DISTANCE) openHistory();
        },
      }),
    [drawerOpen, openHistory],
  );

  useEffect(() => {
    void refreshHistory().catch(() => undefined);
    void loadCoachHomeState(user).then(setHomeState).catch(() => setHomeState(null));
  }, [user.id]);

  const beginConversation = async (firstMessage: string) => {
    const id = await createCoachConversation(user, firstMessage);
    setConversationId(id);
    return id;
  };

  const startNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setInput("");
    setError("");
    setRevealingMessageId(null);
    setDrawerOpen(false);
  };

  const openConversation = async (conversation: CoachConversationSummary) => {
    setBusyAction(true);
    setError("");
    try {
      const loadedMessages = await loadCoachConversation(user, conversation.id);
      setConversationId(conversation.id);
      setMessages(loadedMessages);
      setDrawerOpen(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "That conversation could not be loaded.");
    } finally {
      setBusyAction(false);
    }
  };

  const scrollToLatest = () => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  const send = async (suggested?: string) => {
    const content = (suggested ?? input).trim();
    if (!content || sending || busyAction) return;

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
      await refreshHistory();
      scrollToLatest();
    } catch (sendError) {
      setMessages(current => current
        .filter(message => message.id !== streamingId)
        .map(message => message.id === optimistic.id ? { ...message, pending: false } : message));
      setError(sendError instanceof Error ? sendError.message : "Your coach could not respond.");
    } finally {
      clearInterval(revealTimer);
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

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View pointerEvents="none" style={styles.ambient}>
        <View style={styles.ambientViolet} />
      </View>
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
            <Pressable accessibilityRole="button" onPress={startNewChat} style={styles.newButton}>
              <Text style={styles.newButtonText}>＋ New chat</Text>
            </Pressable>
          </View>

          {!conversationId && messages.length === 0 ? (
            <View style={styles.newChat}>
              <Text style={styles.newChatTitle}>What would you like to explore?</Text>
              <Text style={styles.personalizedNote}>{personalizedGreeting(homeState)}</Text>
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
                ) : null
              }
              contentContainerStyle={[
                styles.messages,
                messages.length === 0 && styles.emptyMessages,
              ]}
              data={messages}
              keyExtractor={message => message.id}
              ref={listRef}
              renderItem={({ item }) => (
                <Message
                  animate={item.id === revealingMessageId}
                  message={item}
                  onResolveToolCall={(toolCallId, action) => void handleToolCall(toolCallId, action)}
                  resolving={resolvingToolCallId === item.toolCall?.id}
                />
              )}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>

        <View style={styles.composerArea}>
          {!!error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.composer}>
              <TextInput
                accessibilityLabel="Ask your sleep coach"
                autoCorrect
                editable={!sending && !busyAction && !resolvingToolCallId}
                maxLength={4000}
                multiline
                onChangeText={setInput}
                onSubmitEditing={() => void send()}
                placeholder="Ask your coach…"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                value={input}
              />
              <Pressable
                accessibilityLabel="Send message"
                disabled={!input.trim() || sending || busyAction || !!resolvingToolCallId}
                onPress={() => void send()}
                style={[
                  styles.send,
                  (!input.trim() || sending || busyAction || !!resolvingToolCallId) && styles.sendDisabled,
                ]}
              >
                {sending ? (
                  <ActivityIndicator color={colors.ink} size="small" />
                ) : (
                  <Text style={styles.sendText}>↑</Text>
                )}
              </Pressable>
          </View>
          <Text style={styles.disclaimer}>Behavioral coaching, not medical advice.</Text>
        </View>
      </KeyboardAvoidingView>
      {drawerOpen && (
        <View style={styles.drawerLayer}>
          <Pressable
            accessibilityLabel="Close chat history"
            onPress={() => setDrawerOpen(false)}
            style={styles.drawerBackdrop}
          />
          <View style={styles.drawer}>
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>Conversations</Text>
              <Pressable onPress={() => setDrawerOpen(false)}>
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
                  <Text numberOfLines={2} style={styles.conversationTitle}>{item.title}</Text>
                </Pressable>
              )}
            />
          </View>
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
    backgroundColor: "#4b426e",
    borderRadius: 220,
    height: 440,
    opacity: 0.16,
    position: "absolute",
    right: -250,
    top: -220,
    width: 440,
  },
  coachLabel: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  coachMessage: { maxWidth: "94%", paddingVertical: 6 },
  compactGreeting: { paddingHorizontal: 4 },
  compactGreetingText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  composer: {
    alignItems: "flex-end",
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 52,
    padding: 6,
    paddingLeft: 17,
  },
  composerArea: {
    backgroundColor: colors.canvas,
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
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
  disclaimer: {
    color: colors.textFaint,
    fontSize: 10,
    marginTop: 7,
    textAlign: "center",
  },
  emptyMessages: { flexGrow: 1 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  eyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  header: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 12,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 110,
    minHeight: 38,
    paddingBottom: 8,
    paddingTop: 8,
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
  message: { maxWidth: "84%" },
  messageRow: { alignItems: "flex-start", flexDirection: "row", marginBottom: 18 },
  messages: { paddingBottom: 20, paddingHorizontal: 18, paddingTop: 12 },
  messageText: { color: colors.text, fontSize: 16, lineHeight: 24 },
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
    fontWeight: "700",
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  personalizedNote: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
  },
  suggestions: { gap: 8, marginTop: "auto", paddingTop: 48 },
  swipeArea: { flex: 1 },
  suggestion: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
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
    width: "82%",
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
  conversationTitle: { color: colors.textMuted, fontSize: 14, lineHeight: 19 },
  resumeAction: {
    alignItems: "center",
    backgroundColor: colors.surfaceAccent,
    borderColor: colors.borderSelected,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 68,
    padding: 14,
  },
  resumeArrow: { color: colors.accent, fontSize: 17, fontWeight: "700" },
  resumeCopy: { flex: 1, marginLeft: 11 },
  resumeDescription: { color: colors.textSubtle, fontSize: 10, marginTop: 3 },
  resumeDot: {
    backgroundColor: colors.success,
    borderRadius: 5,
    height: 8,
    width: 8,
  },
  resumeLabel: { color: colors.accentSoft, fontSize: 14, fontWeight: "700" },
  screen: { backgroundColor: colors.canvas, flex: 1, overflow: "hidden" },
  send: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  sendDisabled: { backgroundColor: colors.surfaceAccent },
  sendText: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: "600",
    lineHeight: 24,
  },
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
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: -0.7,
    marginTop: 1,
  },
  userMessage: {
    backgroundColor: colors.accent,
    borderRadius: 20,
    borderTopRightRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  userMessageRow: { justifyContent: "flex-end" },
  userMessageText: { color: colors.ink },
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
