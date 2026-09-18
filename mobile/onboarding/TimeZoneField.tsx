import { useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../design/theme';
import { detectTimeZone, timeZoneLabel, timeZoneOptions } from './profileFields';

export default function TimeZoneField({ value, onChange, disabled = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const deviceZone = detectTimeZone();
  const options = useMemo(() => timeZoneOptions(value, deviceZone), [value, deviceZone]);
  const search = query.trim().replace(/[\s_/]+/g, ' ').toLowerCase();
  const matches = options.filter(zone => zone.replace(/[\s_/]+/g, ' ').toLowerCase().includes(search));
  const choose = (zone: string) => { onChange(zone); setOpen(false); };

  return <View style={s.field}>
    <Text style={s.label}>Time zone</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`Time zone: ${timeZoneLabel(value)}. Change time zone`} disabled={disabled} onPress={() => { setQuery(''); setOpen(true); }} style={s.control}>
      <Text style={s.value}>{timeZoneLabel(value)}</Text><Text style={s.link}>Change</Text>
    </Pressable>
    <Text style={s.hint}>{value === deviceZone ? 'Matches your device’s time zone.' : 'Your selected time zone.'}</Text>
    <Modal animationType="slide" onRequestClose={() => setOpen(false)} visible={open}>
      <SafeAreaView style={s.modal}>
        <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.header}><Text style={s.title}>Time zone</Text><Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={s.close}><Text style={s.link}>Done</Text></Pressable></View>
          <TextInput accessibilityLabel="Search time zones" autoCapitalize="none" autoCorrect={false} onChangeText={setQuery} placeholder="Search city or region" placeholderTextColor={colors.textFaint} style={s.search} value={query}/>
          <Pressable accessibilityRole="button" onPress={() => choose(deviceZone)} style={s.device}><Text style={s.link}>Use device time zone</Text><Text style={s.hint}>{timeZoneLabel(deviceZone)}</Text></Pressable>
          <FlatList data={matches} keyboardShouldPersistTaps="handled" keyExtractor={zone => zone} renderItem={({ item }) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: value === item }} onPress={() => choose(item)} style={[s.option, value === item && s.selected]}><Text style={s.value}>{timeZoneLabel(item)}</Text>{value === item && <Text style={s.link}>✓</Text>}</Pressable>} ListEmptyComponent={<Text style={s.hint}>No matching time zones. Try a nearby major city.</Text>}/>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  </View>;
}

const s = StyleSheet.create({
  field: { marginVertical: 16 }, label: { color: colors.textSubtle, fontSize: 13, marginBottom: 8 },
  control: { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  value: { color: colors.text, fontSize: 16, flex: 1, flexShrink: 1 }, link: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  hint: { color: colors.textSubtle, fontSize: 13, lineHeight: 19, marginTop: 6 }, modal: { backgroundColor: colors.canvas, flex: 1, padding: 20 }, fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }, title: { color: colors.text, fontSize: 26, fontWeight: '800' }, close: { padding: 12, minHeight: 44 },
  search: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 }, device: { paddingVertical: 16 },
  option: { padding: 16, minHeight: 52, borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row', gap: 12 }, selected: { backgroundColor: colors.surfaceAccent },
});
