import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "@supabase/supabase-js";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "../design/theme";
import type { SleepProfile } from "../onboarding/types";
import {
  createCoachConversation,
  loadCoachHomeState,
  loadCoachConversation,
  loadDailyCoaching,
  localDate,
  sendCoachMessage,
} from "./coachRepository";
import type { CoachHomeState, CoachMessage, DailyCoaching } from "./coachRepository";

type ViewMode = "launcher" | "chat";
type SessionMarker = { conversationId: string; date: string };

const sessionKey = (userId: string) => `sleep-coach:active-conversation:${userId}`;

const greetingFor = (name: string) => {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = name.trim().split(/\s+/)[0];
  return firstName ? `${greeting}, ${firstName}.` : `${greeting}.`;
};

const plainCoachText = (text: string) =>
  text
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .trim();

const shortCoachSentence = (text: string, maxLength = 150) => {
  const clean = plainCoachText(text).replace(/\s+/g, " ");
  const firstSentence = clean.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? clean;
  if (firstSentence.length <= maxLength) return firstSentence;
  const shortened = firstSentence.slice(0, maxLength);
  const wordBoundary = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, wordBoundary > 80 ? wordBoundary : maxLength).trim()}…`;
};

const feelingPhrase = (score: number) => {
  if (score <= 20) return "drained";
  if (score <= 40) return "tired";
  if (score <= 60) return "okay";
  if (score <= 80) return "good";
  return "great";
};

const focusPhrase = (action: string) => {
  const sentence = shortCoachSentence(action).replace(/[.!?]+$/, "");
  return sentence ? `${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}` : "one small step";
};

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

  return <Text style={style}>{visibleText}</Text>;
};

const readMarker = async (userId: string): Promise<SessionMarker | null> => {
  const raw = await AsyncStorage.getItem(sessionKey(userId));
  if (!raw) return null;
  try {
    const marker = JSON.parse(raw) as SessionMarker;
    if (marker.date === localDate() && marker.conversationId) return marker;
  } catch {
    // Ignore malformed local state. The server-side conversation remains intact.
  }
  await AsyncStorage.removeItem(sessionKey(userId));
  return null;
};

const LauncherAction = ({
  icon,
  label,
  description,
  onPress,
  disabled,
}: {
  icon: string;
  label: string;
  description: string;
  onPress: () => void;
  disabled?: boolean;
}) => (
  <Pressable
    accessibilityRole="button"
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [
      styles.launcherAction,
      pressed && styles.launcherActionPressed,
      disabled && styles.disabled,
    ]}
  >
    <View style={styles.launcherIcon}>
      <Text style={styles.launcherIconText}>{icon}</Text>
    </View>
    <View style={styles.launcherActionCopy}>
      <Text style={styles.launcherActionLabel}>{label}</Text>
      <Text style={styles.launcherActionDescription}>{description}</Text>
    </View>
    <Text style={styles.launcherArrow}>›</Text>
  </Pressable>
);

const Message = ({ animate, message }: { animate: boolean; message: CoachMessage }) => {
  const isUser = message.role === "user";
  return (
    <View style={[styles.messageRow, isUser && styles.userMessageRow]}>
      <View style={[styles.message, isUser ? styles.userMessage : styles.coachMessage]}>
        {!isUser && <Text style={styles.coachLabel}>COACH</Text>}
        <StreamingText
          animate={animate && !isUser}
          style={[styles.messageText, isUser && styles.userMessageText]}
          text={message.content}
        />
      </View>
    </View>
  );
};

const WelcomeBrief = ({
  brief,
  homeState,
  name,
}: {
  brief: DailyCoaching;
  homeState: CoachHomeState | null;
  name: string;
}) => (
  <View style={styles.compactGreeting}>
    <Text style={styles.welcomeGreeting}>{greetingFor(name)}</Text>
    <Text style={styles.compactGreetingText}>
      {homeState?.sleepScore !== null && homeState?.sleepScore !== undefined
        ? `Your sleep score was ${Math.round(homeState.sleepScore)} last night. `
        : ""}
      {homeState?.feeling !== null && homeState?.feeling !== undefined
        ? `You’re feeling ${feelingPhrase(homeState.feeling)} today. `
        : ""}
      Tonight we’ll focus on {focusPhrase(brief.action)}.
    </Text>
  </View>
);

export default function CoachChatScreen({
  user,
  profile,
}: {
  user: User;
  profile: SleepProfile;
}) {
  const [mode, setMode] = useState<ViewMode>("launcher");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [resumeConversationId, setResumeConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [welcomeBrief, setWelcomeBrief] = useState<DailyCoaching | null>(null);
  const [welcomeLoading, setWelcomeLoading] = useState(true);
  const [homeState, setHomeState] = useState<CoachHomeState | null>(null);
  const [revealingMessageId, setRevealingMessageId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<FlatList<CoachMessage>>(null);

  useEffect(() => {
    let active = true;
    void readMarker(user.id).then(marker => {
      if (active) setResumeConversationId(marker?.conversationId ?? null);
    });
    void loadCoachHomeState(user)
      .then(nextHomeState => {
        if (active) setHomeState(nextHomeState);
      })
      .catch(() => {
        if (active) setHomeState(null);
      });
    setWelcomeLoading(true);
    void loadDailyCoaching(user, profile)
      .then(brief => {
        if (active) setWelcomeBrief(brief);
      })
      .catch(() => {
        // The launcher remains useful when today's cached coaching is unavailable.
      })
      .finally(() => {
        if (active) setWelcomeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user.id, profile.primaryConcern]);

  const rememberConversation = async (id: string) => {
    const marker: SessionMarker = { conversationId: id, date: localDate() };
    setResumeConversationId(id);
    await AsyncStorage.setItem(sessionKey(user.id), JSON.stringify(marker));
  };

  const beginConversation = async () => {
    const id = await createCoachConversation(user);
    setConversationId(id);
    await rememberConversation(id);
    return id;
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

    setMode("chat");
    setInput("");
    setError("");
    setSending(true);
    setMessages(current => [...current, optimistic]);
    scrollToLatest();

    try {
      const id = conversationId ?? await beginConversation();
      const response = await sendCoachMessage(user, profile, id, content);
      setRevealingMessageId(response.id);
      setMessages(current => [
        ...current.map(message =>
          message.id === optimistic.id ? { ...message, pending: false } : message,
        ),
        response,
      ]);
      await rememberConversation(id);
      scrollToLatest();
    } catch (sendError) {
      setMessages(current => current.filter(message => message.id !== optimistic.id));
      setInput(content);
      setError(sendError instanceof Error ? sendError.message : "Your coach could not respond.");
    } finally {
      setSending(false);
    }
  };

  const resumeConversation = async () => {
    if (!resumeConversationId || busyAction || sending) return;
    setBusyAction(true);
    setError("");
    try {
      const loadedMessages = await loadCoachConversation(user, resumeConversationId);
      if (loadedMessages.length === 0) {
        await AsyncStorage.removeItem(sessionKey(user.id));
        setResumeConversationId(null);
        throw new Error("There isn’t an active conversation to reopen yet.");
      }
      setConversationId(resumeConversationId);
      setMessages(loadedMessages);
      setRevealingMessageId(null);
      setMode("chat");
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : "Your conversation could not load.");
    } finally {
      setBusyAction(false);
    }
  };

  const returnToCoachHome = () => {
    setMode("launcher");
    setConversationId(null);
    setMessages([]);
    setRevealingMessageId(null);
    setInput("");
    setError("");
  };

  const renderLauncher = () => (
    <ScrollView contentContainerStyle={styles.launcher} showsVerticalScrollIndicator={false}>
      {welcomeBrief ? (
        <WelcomeBrief
          brief={welcomeBrief}
          homeState={homeState}
          name={profile.displayName}
        />
      ) : (
        <View style={styles.welcomeFallback}>
          <Text style={styles.welcomeGreeting}>{greetingFor(profile.displayName)}</Text>
          {welcomeLoading ? (
            <View style={styles.welcomeLoadingRow}>
              <ActivityIndicator color={colors.accent} size="small" />
              <Text style={styles.welcomeLoadingText}>Looking at what matters today…</Text>
            </View>
          ) : (
            <Text style={styles.welcomePattern}>
              Ask your coach anything, or choose a place to begin.
            </Text>
          )}
        </View>
      )}

      <View style={styles.launcherActions}>
        {!!resumeConversationId && (
          <Pressable
            accessibilityRole="button"
            disabled={busyAction}
            onPress={() => void resumeConversation()}
            style={styles.resumeAction}
          >
            <View style={styles.resumeDot} />
            <View style={styles.resumeCopy}>
              <Text style={styles.resumeLabel}>Continue your conversation</Text>
              <Text style={styles.resumeDescription}>Reopen today’s active coaching thread</Text>
            </View>
            {busyAction ? (
              <ActivityIndicator color={colors.accent} size="small" />
            ) : (
              <Text style={styles.resumeArrow}>↗</Text>
            )}
          </Pressable>
        )}

        <LauncherAction
          description={homeState?.hasCheckedInToday ? "See what Coach noticed" : "Log how last night felt"}
          disabled={busyAction}
          icon="☾"
          label={homeState?.hasCheckedInToday ? "Review morning check-in" : "Morning check-in"}
          onPress={() => void send(
            homeState?.hasCheckedInToday
              ? "Review my completed morning check-in from today."
              : "Help me with today’s morning check-in.",
          )}
        />
        <LauncherAction
          description="See today’s personalized focus"
          disabled={busyAction}
          icon="✦"
          label="Your daily brief"
          onPress={() => void send("Give me my daily sleep brief.")}
        />
        <LauncherAction
          description="Ask Coach to interpret your patterns"
          disabled={busyAction}
          icon="↗"
          label="What does my data say?"
          onPress={() => void send("What does my recent sleep data indicate?")}
        />
      </View>
      {!!error && <Text style={styles.launcherError}>{error}</Text>}
    </ScrollView>
  );

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
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>30 DAY SLEEP COACH</Text>
            <Text style={styles.title}>Coach</Text>
          </View>
          {mode === "chat" ? (
            <Pressable accessibilityRole="button" onPress={returnToCoachHome} style={styles.newButton}>
              <Text style={styles.newButtonText}>‹ Coach home</Text>
            </Pressable>
          ) : (
            <View style={styles.status}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>Learning with you</Text>
            </View>
          )}
        </View>

        {mode === "launcher" ? (
          renderLauncher()
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
              <Message animate={item.id === revealingMessageId} message={item} />
            )}
            showsVerticalScrollIndicator={false}
          />
        )}

        <View style={styles.composerArea}>
          {!!error && mode === "chat" && <Text style={styles.error}>{error}</Text>}
          <View style={styles.composer}>
            <TextInput
              accessibilityLabel="Ask your sleep coach"
              editable={!sending && !busyAction}
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
              disabled={!input.trim() || sending || busyAction}
              onPress={() => void send()}
              style={[
                styles.send,
                (!input.trim() || sending || busyAction) && styles.sendDisabled,
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
  keyboard: { flex: 1 },
  launcher: {
    flexGrow: 1,
    justifyContent: "center",
    paddingBottom: 22,
    paddingHorizontal: 20,
    paddingTop: 12,
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
