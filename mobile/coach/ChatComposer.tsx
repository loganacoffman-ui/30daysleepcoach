import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../design/theme';

export default function ChatComposer({ value, onChangeText, onSend, disabled = false, sending = false, placeholder = 'Ask your coach…', error }: {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  disabled?: boolean;
  sending?: boolean;
  placeholder?: string;
  error?: string;
}) {
  const cannotSend = disabled || sending || !value.trim();
  return (
    <View style={styles.area}>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="Message your sleep coach"
          autoCorrect
          editable={!disabled && !sending}
          maxLength={4000}
          multiline
          onChangeText={onChangeText}
          onSubmitEditing={onSend}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          value={value}
        />
        <Pressable accessibilityLabel="Send message" accessibilityRole="button" accessibilityState={{ disabled: cannotSend }} disabled={cannotSend} onPress={onSend} style={[styles.send, cannotSend && styles.disabled]}>
          {sending ? <ActivityIndicator color={colors.ink} size="small" /> : <Text style={styles.arrow}>↑</Text>}
        </Pressable>
      </View>
      <Text style={styles.disclaimer}>Behavioral coaching, not medical advice.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  area: { backgroundColor: colors.canvas, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  composer: { alignItems: 'flex-end', backgroundColor: colors.surface, borderColor: colors.borderStrong, borderRadius: 24, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: 52, padding: 6, paddingLeft: 17 },
  input: { color: colors.text, flex: 1, fontSize: 16, lineHeight: 22, maxHeight: 110, minHeight: 38, paddingVertical: 8 },
  send: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  disabled: { opacity: 0.35 },
  arrow: { color: colors.ink, fontSize: 24, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  disclaimer: { color: colors.textFaint, fontSize: 10, marginTop: 7, textAlign: 'center' },
});
