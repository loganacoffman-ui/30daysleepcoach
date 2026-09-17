import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../design/theme';

export default function JumpToLatest({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Scroll to latest message" onPress={onPress} style={styles.button}>
      <Text style={styles.label}>↓ Latest messages</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { position: 'absolute', bottom: 12, alignSelf: 'center', borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 18, minHeight: 44, justifyContent: 'center' },
  label: { color: colors.accent, fontSize: 13, fontWeight: '600' },
});
