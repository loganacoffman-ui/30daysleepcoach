import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { User } from "@supabase/supabase-js";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "../design/theme";
import type { SleepProfile } from "../onboarding/types";
import { loadCoachExperience, sendCoachMessage } from "./coachRepository";
import type {
  CoachExperience,
  CoachMessage,
  DailyCoaching,
} from "./coachRepository";

const ink = colors.text;
const muted = colors.textSubtle;
const border = colors.border;
const accent = colors.accent;
const soft = colors.surfaceMuted;

const TodayCoaching = ({
  coaching,
  onClose,
}: {
  coaching: DailyCoaching;
  onClose: () => void;
}) => (
  <Modal
    animationType="slide"
    onRequestClose={onClose}
    presentationStyle="pageSheet"
    visible
  >
    <SafeAreaView style={styles.coachingSheet}>
      <View style={styles.sheetHeader}>
        <View>
          <Text style={styles.sheetEyebrow}>TODAY’S COACHING</Text>
          <Text style={styles.sheetTitle}>One useful focus for tonight</Text>
        </View>
        <Pressable
          accessibilityLabel="Close today's coaching"
          hitSlop={12}
          onPress={onClose}
        >
          <Text style={styles.close}>×</Text>
        </Pressable>
      </View>
      <FlatList
        contentContainerStyle={styles.sheetContent}
        data={
          [
            ["WHAT I’M NOTICING", coaching.pattern],
            ["WHAT IT MAY MEAN", coaching.meaning],
            ["TONIGHT’S ONE MOVE", coaching.action],
            ["WHY THIS, NOW", coaching.why],
          ] as Array<[string, string]>
        }
        keyExtractor={(item) => item[0]}
        renderItem={({ item, index }) => (
          <View style={styles.coachingSection}>
            <Text style={styles.coachingLabel}>{item[0]}</Text>
            <Text
              style={[
                styles.coachingText,
                index === 2 && styles.coachingAction,
              ]}
            >
              {item[1]}
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  </Modal>
);

const Bubble = ({ message }: { message: CoachMessage }) => {
  const isUser = message.role === "user";
  return (
    <View style={[styles.messageRow, isUser && styles.userMessageRow]}>
      {!isUser && (
        <View style={styles.coachMark}>
          <Text style={styles.coachMarkText}>✦</Text>
        </View>
      )}
      <View
        style={[styles.bubble, isUser ? styles.userBubble : styles.coachBubble]}
      >
        <Text style={[styles.messageText, isUser && styles.userMessageText]}>
          {message.content}
        </Text>
      </View>
    </View>
  );
};

export default function CoachScreen({
  user,
  profile,
}: {
  user: User;
  profile: SleepProfile;
}) {
  const [experience, setExperience] = useState<CoachExperience | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showCoaching, setShowCoaching] = useState(false);
  const listRef = useRef<FlatList<CoachMessage>>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await loadCoachExperience(user, profile);
      setExperience(result);
      setMessages(result.messages);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Your coach could not load.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [user.id, profile.primaryConcern]);

  const suggestions = useMemo(() => {
    if (!experience?.hasCheckedInToday)
      return [
        "What should I notice in today’s check-in?",
        "What are we learning about my sleep?",
        "What should I focus on tonight?",
      ];
    if (experience.hasOuraData)
      return [
        "What does my data indicate?",
        "Why did my sleep change?",
        "What should I focus on tonight?",
      ];
    return [
      "Review today’s journal",
      "What patterns are emerging?",
      "What should I focus on tonight?",
    ];
  }, [experience?.hasCheckedInToday, experience?.hasOuraData]);

  const send = async (suggested?: string) => {
    const content = (suggested ?? input).trim();
    if (!content || sending || !experience) return;
    const optimistic: CoachMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setInput("");
    setError("");
    setSending(true);
    setMessages((current) => [...current, optimistic]);
    requestAnimationFrame(() =>
      listRef.current?.scrollToEnd({ animated: true }),
    );
    try {
      const response = await sendCoachMessage(
        user,
        profile,
        experience.conversationId,
        content,
      );
      setMessages((current) => [
        ...current.map((message) =>
          message.id === optimistic.id
            ? { ...message, pending: false }
            : message,
        ),
        response,
      ]);
      requestAnimationFrame(() =>
        listRef.current?.scrollToEnd({ animated: true }),
      );
    } catch (sendError) {
      setMessages((current) =>
        current.filter((message) => message.id !== optimistic.id),
      );
      setInput(content);
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Your coach could not respond.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View pointerEvents="none" style={styles.ambient}>
        <View style={styles.ambientViolet} />
        <View style={styles.ambientBlue} />
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
          <View style={styles.online}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText}>Learning with you</Text>
          </View>
        </View>

        {experience?.dailyCoaching && (
          <Pressable
            accessibilityHint="Opens your complete coaching insight"
            onPress={() => setShowCoaching(true)}
            style={styles.todayCard}
          >
            <View style={styles.todayIcon}>
              <Text style={styles.todayIconText}>✦</Text>
            </View>
            <View style={styles.todayCopy}>
              <Text style={styles.todayLabel}>TODAY’S COACHING</Text>
              <Text numberOfLines={1} style={styles.todayText}>
                {experience.dailyCoaching.action}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={accent} />
            <Text style={styles.loadingText}>
              Bringing your coaching context together…
            </Text>
          </View>
        ) : (
          <FlatList
            ListEmptyComponent={
              <View style={styles.welcome}>
                <Text style={styles.welcomeTitle}>
                  Ask me anything about your sleep.
                </Text>
                <Text style={styles.welcomeBody}>
                  I’ll use your check-ins, journal, connected data, goals, and
                  what we learn together over time.
                </Text>
              </View>
            }
            contentContainerStyle={[
              styles.messages,
              messages.length === 0 && styles.emptyMessages,
            ]}
            data={messages}
            keyExtractor={(message) => message.id}
            onContentSizeChange={() =>
              messages.length > 0 &&
              listRef.current?.scrollToEnd({ animated: false })
            }
            ref={listRef}
            renderItem={({ item }) => <Bubble message={item} />}
            showsVerticalScrollIndicator={false}
          />
        )}

        {!loading && (
          <View style={styles.composerArea}>
            {messages.length === 0 && (
              <FlatList
                contentContainerStyle={styles.suggestions}
                data={suggestions}
                horizontal
                keyExtractor={(item) => item}
                renderItem={({ item }) => (
                  <Pressable
                    disabled={sending}
                    onPress={() => void send(item)}
                    style={styles.suggestion}
                  >
                    <Text style={styles.suggestionText}>{item}</Text>
                  </Pressable>
                )}
                showsHorizontalScrollIndicator={false}
              />
            )}
            {!!error && (
              <View style={styles.errorRow}>
                <Text style={styles.error}>{error}</Text>
                <Pressable onPress={() => void load()}>
                  <Text style={styles.retry}>Reload</Text>
                </Pressable>
              </View>
            )}
            <View style={styles.composer}>
              <TextInput
                accessibilityLabel="Ask your sleep coach"
                editable={!sending}
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
                disabled={!input.trim() || sending}
                onPress={() => void send()}
                style={[
                  styles.send,
                  (!input.trim() || sending) && styles.sendDisabled,
                ]}
              >
                {sending ? (
                  <ActivityIndicator color={colors.ink} size="small" />
                ) : (
                  <Text style={styles.sendText}>↑</Text>
                )}
              </Pressable>
            </View>
            <Text style={styles.disclaimer}>
              Your coach offers behavioral guidance, not medical diagnosis or
              treatment.
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>
      {showCoaching && experience?.dailyCoaching && (
        <TodayCoaching
          coaching={experience.dailyCoaching}
          onClose={() => setShowCoaching(false)}
        />
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
  ambientBlue: {
    backgroundColor: "#20313d",
    borderRadius: 150,
    height: 300,
    left: -170,
    opacity: 0.16,
    position: "absolute",
    top: 250,
    width: 300,
  },
  ambientViolet: {
    backgroundColor: "#4b426e",
    borderRadius: 190,
    height: 380,
    opacity: 0.2,
    position: "absolute",
    right: -210,
    top: -160,
    width: 380,
  },
  bubble: {
    borderRadius: 20,
    maxWidth: "84%",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  center: { alignItems: "center", flex: 1, gap: 12, justifyContent: "center" },
  chevron: { color: muted, fontSize: 28, fontWeight: "300" },
  close: { color: ink, fontSize: 32, fontWeight: "300", lineHeight: 34 },
  coachBubble: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderTopLeftRadius: 6,
    borderWidth: 1,
  },
  coachMark: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 14,
    height: 28,
    justifyContent: "center",
    marginRight: 8,
    marginTop: 2,
    width: 28,
  },
  coachMarkText: { color: colors.ink, fontSize: 12 },
  coachingAction: {
    color: ink,
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  coachingLabel: {
    color: accent,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.3,
    marginBottom: 10,
  },
  coachingSection: { marginBottom: 32 },
  coachingSheet: { backgroundColor: colors.canvas, flex: 1 },
  coachingText: { color: colors.textMuted, fontSize: 17, lineHeight: 27 },
  composer: {
    alignItems: "flex-end",
    backgroundColor: colors.surface,
    borderColor: border,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 50,
    padding: 5,
    paddingLeft: 16,
  },
  composerArea: {
    backgroundColor: colors.canvas,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  disclaimer: {
    color: colors.textFaint,
    fontSize: 10,
    marginTop: 7,
    textAlign: "center",
  },
  emptyMessages: { flexGrow: 1 },
  error: { color: colors.danger, flex: 1, fontSize: 12, lineHeight: 17 },
  errorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginBottom: 8,
  },
  eyebrow: {
    color: accent,
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
    color: ink,
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 110,
    minHeight: 38,
    paddingBottom: 8,
    paddingTop: 8,
  },
  keyboard: { flex: 1 },
  loadingText: { color: muted, fontSize: 13 },
  messageRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    marginBottom: 14,
  },
  messageText: { color: ink, fontSize: 16, lineHeight: 23 },
  messages: { paddingBottom: 18, paddingHorizontal: 18, paddingTop: 12 },
  online: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    paddingBottom: 4,
  },
  onlineDot: {
    backgroundColor: colors.success,
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  onlineText: { color: muted, fontSize: 11 },
  retry: { color: accent, fontSize: 12, fontWeight: "800" },
  screen: { backgroundColor: colors.canvas, flex: 1, overflow: "hidden" },
  send: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 19,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  sendDisabled: { backgroundColor: colors.surfaceAccent },
  sendText: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: "600",
    lineHeight: 24,
  },
  sheetContent: { padding: 24 },
  sheetEyebrow: {
    color: accent,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  sheetHeader: {
    alignItems: "flex-start",
    borderBottomColor: border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 22,
  },
  sheetTitle: {
    color: ink,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.4,
    marginTop: 5,
  },
  suggestion: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
    borderRadius: 18,
    borderWidth: 1,
    marginRight: 8,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  suggestions: { paddingBottom: 10 },
  suggestionText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  title: {
    color: ink,
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: -0.7,
    marginTop: 1,
  },
  todayCard: {
    alignItems: "center",
    backgroundColor: soft,
    borderColor: colors.borderSelected,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: 4,
    marginHorizontal: 18,
    padding: 13,
  },
  todayCopy: { flex: 1, marginHorizontal: 11 },
  todayIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceAccent,
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  todayIconText: { color: accent, fontSize: 13 },
  todayLabel: {
    color: accent,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  todayText: { color: ink, fontSize: 14, fontWeight: "600", marginTop: 3 },
  userBubble: { backgroundColor: colors.accent, borderTopRightRadius: 6 },
  userMessageRow: { justifyContent: "flex-end" },
  userMessageText: { color: colors.ink },
  welcome: { paddingHorizontal: 24 },
  welcomeBody: { color: muted, fontSize: 16, lineHeight: 25, marginTop: 11 },
  welcomeTitle: {
    color: ink,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.6,
    lineHeight: 35,
  },
});
