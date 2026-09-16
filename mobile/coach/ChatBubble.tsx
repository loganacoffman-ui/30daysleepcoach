import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';

import { colors } from '../design/theme';

const thinkingSteps = [
  'Reviewing your recent sleep…',
  'Comparing your experiments…',
  'Connecting your check-in notes…',
];

export const plainCoachText = (text: string) =>
  text
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .trim();

const RevealingText = ({
  animate,
  style,
  text,
}: {
  animate: boolean;
  style: StyleProp<TextStyle>;
  text: string;
}) => {
  const clean = plainCoachText(text);
  const [visibleText, setVisibleText] = useState(animate ? '' : clean);

  useEffect(() => {
    if (!animate) {
      setVisibleText(clean);
      return;
    }
    const words = clean.split(/\s+/).filter(Boolean);
    let visibleWords = 0;
    setVisibleText('');
    const timer = setInterval(() => {
      visibleWords += 1;
      setVisibleText(words.slice(0, visibleWords).join(' '));
      if (visibleWords >= words.length) clearInterval(timer);
    }, 32);
    return () => clearInterval(timer);
  }, [animate, clean]);

  return <Text style={style}>{animate ? visibleText : clean}</Text>;
};

const Thinking = () => {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep(current => (current + 1) % thinkingSteps.length), 1100);
    return () => clearInterval(timer);
  }, []);
  return (
    <View accessibilityLiveRegion="polite" style={styles.thinking}>
      <ActivityIndicator color={colors.accent} size="small" />
      <Text style={styles.thinkingText}>{thinkingSteps[step]}</Text>
    </View>
  );
};

export default function ChatBubble({
  animate = false,
  children,
  content = '',
  role,
  thinking = false,
}: {
  animate?: boolean;
  children?: ReactNode;
  content?: string;
  role: 'assistant' | 'user';
  thinking?: boolean;
}) {
  const isUser = role === 'user';
  return (
    <View style={[styles.row, isUser && styles.userRow]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.coachBubble]}>
        {!isUser && <Text style={styles.coachLabel}>COACH</Text>}
        {thinking && !isUser ? (
          <Thinking />
        ) : (
          <RevealingText
            animate={animate && !isUser}
            style={[styles.text, isUser && styles.userText]}
            text={content}
          />
        )}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '84%' },
  coachBubble: { maxWidth: '94%', paddingVertical: 6 },
  coachLabel: {
    color: colors.textSubtle,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  row: { alignItems: 'flex-start', flexDirection: 'row' },
  text: { color: colors.text, fontSize: 16, lineHeight: 26 },
  thinking: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  thinkingText: { color: colors.textSubtle, fontSize: 12 },
  userBubble: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 20,
    borderTopRightRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  userRow: { justifyContent: 'flex-end' },
  userText: { color: colors.text },
});
