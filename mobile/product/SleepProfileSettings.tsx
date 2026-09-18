import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { User } from '@supabase/supabase-js';
import { colors } from '../design/theme';
import { concernLabels, isValidClock, shiftClock, timeZoneLabel, validateSleepProfile, type SleepProfileDraft } from '../onboarding/profileFields';
import { saveSleepProfile } from '../onboarding/profileRepository';
import TimeZoneField from '../onboarding/TimeZoneField';
import type { PrimaryConcern, SleepProfile } from '../onboarding/types';

export default function SleepProfileSettings({ user, profile, onSaved }: {
  user: User; profile: SleepProfile; onSaved: (draft: SleepProfileDraft) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SleepProfileDraft>(profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const change = (patch: Partial<SleepProfileDraft>) => { setDraft(current => ({ ...current, ...patch })); setError(''); };
  const save = async () => {
    if (saving) return;
    const validation = validateSleepProfile(draft);
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError('');
    try {
      const updated = await saveSleepProfile(user, draft);
      onSaved(updated);
      setEditing(false);
      setSaved(true);
    } catch {
      setError('Your changes could not be saved. Check your connection and try again.');
    } finally { setSaving(false); }
  };

  return <View>
    <View style={s.header}>
      <Text style={s.eyebrow}>SLEEP PROFILE</Text>
      {!editing && <Pressable accessibilityRole="button" accessibilityLabel="Edit sleep profile" onPress={() => { setDraft(profile); setError(''); setSaved(false); setEditing(true); }} style={s.edit}><Text style={s.link}>Edit</Text></Pressable>}
    </View>
    {editing ? <>
      <Text style={s.label}>Primary focus</Text>
      <View style={s.options}>{(Object.keys(concernLabels) as PrimaryConcern[]).map(concern => <Pressable accessibilityRole="radio" accessibilityState={{ checked: draft.primaryConcern === concern }} disabled={saving} key={concern} onPress={() => change({ primaryConcern: concern })} style={[s.option, draft.primaryConcern === concern && s.selected]}><Text style={s.optionText}>{concernLabels[concern]}</Text>{draft.primaryConcern === concern && <Text style={s.link}>✓</Text>}</Pressable>)}</View>
      <ClockField disabled={saving} label="Usual bedtime" onChange={typicalBedtime => change({ typicalBedtime })} value={draft.typicalBedtime}/>
      <ClockField disabled={saving} label="Usual wake time" onChange={typicalWakeTime => change({ typicalWakeTime })} value={draft.typicalWakeTime}/>
      <TimeZoneField disabled={saving} onChange={timezone => change({ timezone })} value={draft.timezone}/>
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      <View style={s.actions}>
        <Pressable accessibilityRole="button" disabled={saving} onPress={() => { setEditing(false); setError(''); }} style={s.cancel}><Text style={s.link}>Cancel</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving, busy: saving }} disabled={saving} onPress={() => void save()} style={[s.save, saving && s.disabled]}>{saving ? <ActivityIndicator color={colors.ink}/> : <Text style={s.saveText}>Save changes</Text>}</Pressable>
      </View>
    </> : <>
      <Setting label="Primary focus" value={concernLabels[profile.primaryConcern]}/>
      <Setting label="Usual bedtime" value={profile.typicalBedtime || 'Not set'}/>
      <Setting label="Usual wake time" value={profile.typicalWakeTime || 'Not set'}/>
      <Setting label="Time zone" value={timeZoneLabel(profile.timezone)}/>
      {saved && <Text accessibilityLiveRegion="polite" style={s.success}>Sleep profile saved.</Text>}
    </>}
  </View>;
}

function Setting({ label, value }: { label: string; value: string }) {
  return <View style={s.setting}><Text style={s.label}>{label}</Text><Text style={s.value}>{value}</Text></View>;
}

function ClockField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  return <View style={s.clockField}>
    <Text style={s.label}>{label}</Text>
    <View style={s.clockRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} 15 minutes earlier`} disabled={disabled || !isValidClock(value)} onPress={() => onChange(shiftClock(value, -15))} style={s.adjust}><Text style={s.adjustText}>−</Text></Pressable>
      <TextInput accessibilityLabel={`${label}, 24-hour time`} autoCorrect={false} editable={!disabled} keyboardType="numbers-and-punctuation" maxLength={5} onChangeText={onChange} placeholder="HH:MM" placeholderTextColor={colors.textFaint} selectTextOnFocus style={s.clockInput} value={value}/>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} 15 minutes later`} disabled={disabled || !isValidClock(value)} onPress={() => onChange(shiftClock(value, 15))} style={s.adjust}><Text style={s.adjustText}>+</Text></Pressable>
    </View>
    <Text style={s.hint}>24-hour time · type a time or adjust by 15 minutes</Text>
  </View>;
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }, eyebrow: { color: colors.accentSoft, fontSize: 11, fontWeight: '800', letterSpacing: 1.3, flexShrink: 1 }, edit: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' }, link: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  label: { color: colors.textSubtle, fontSize: 13 }, value: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 4 }, setting: { borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 13 },
  options: { gap: 8, marginTop: 10, marginBottom: 4 }, option: { borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 12, padding: 13, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }, selected: { borderColor: colors.accent, backgroundColor: colors.surfaceAccent }, optionText: { color: colors.text, fontSize: 15, flex: 1 },
  clockField: { marginTop: 20 }, clockRow: { flexDirection: 'row', gap: 8, marginTop: 8 }, clockInput: { color: colors.text, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 12, fontSize: 22, textAlign: 'center', padding: 10, flex: 1, minWidth: 0 }, adjust: { alignItems: 'center', justifyContent: 'center', width: 48, minHeight: 48, borderRadius: 12, backgroundColor: colors.surfaceRaised }, adjustText: { color: colors.accent, fontSize: 24 }, hint: { color: colors.textSubtle, fontSize: 12, lineHeight: 18, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 }, cancel: { justifyContent: 'center', alignItems: 'center', minHeight: 48, padding: 12 }, save: { alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.accent, minHeight: 48, padding: 12, flex: 1 }, saveText: { color: colors.ink, fontSize: 15, fontWeight: '800' }, disabled: { opacity: 0.6 }, error: { color: colors.danger, fontSize: 14, lineHeight: 20, marginBottom: 12 }, success: { color: colors.success, fontSize: 13, marginTop: 12 },
});
