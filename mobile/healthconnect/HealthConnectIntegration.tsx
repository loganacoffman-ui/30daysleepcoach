import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { User } from '@supabase/supabase-js';
import { colors } from '../design/theme';
import { invalidateCoachContext } from '../coach/coachRepository';
import { markCheckinSaved } from '../cache/checkinRevision';
import { connectHealthConnect, disableHealthConnect, isHealthConnectEnabled, manageHealthConnectPermissions, syncHealthConnectForDate } from './healthConnect';

export default function HealthConnectIntegration({ user, onConnected, onDisabled }: {
  user: User; onConnected?: () => void; onDisabled?: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [needsPermission, setNeedsPermission] = useState(false);
  useEffect(() => { let active = true; void isHealthConnectEnabled(user.id)
    .then(value => { if (active) setEnabled(value); })
    .catch(() => { if (active) setMessage('Connection status could not be loaded. Try connecting again.'); });
    return () => { active = false; };
  }, [user.id]);
  const refreshViews = useCallback(() => { invalidateCoachContext(user.id); markCheckinSaved(); }, [user.id]);
  const sync = async () => {
    setBusy(true); setMessage('');
    try {
      const result = !enabled || needsPermission ? await connectHealthConnect(user.id) : await syncHealthConnectForDate(user.id);
      setEnabled(await isHealthConnectEnabled(user.id));
      setNeedsPermission(result.status === 'denied');
      if (result.status === 'synced' || result.status === 'no_data') {
        onConnected?.(); refreshViews();
        setMessage(result.status === 'no_data'
          ? 'No detailed sleep was available for today. Sync your Pixel Watch in Google Health, allow it to write Sleep to Health Connect, then refresh. You can check in manually meanwhile.'
          : result.night.sleepScore === null
            ? `${result.night.totalSleepMinutes} minutes synced. There are not enough detailed sleep stages for a Sleep Coach score; you can enter your own score.`
            : `Today’s Sleep Coach score: ${result.night.sleepScore}. ${result.night.totalSleepMinutes} minutes of sleep synced.`);
      } else if (result.status === 'denied') setMessage('Sleep access is off. Allow Sleep in Health Connect permissions, then reconnect.');
      else if (result.status === 'unavailable') setMessage('Health Connect is unavailable or needs an update. Check Android system updates and Health Connect in Settings.');
      else setMessage('Connect Health Connect to begin syncing.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Sleep could not be synced. Please try again.'); }
    finally { setBusy(false); }
  };
  const disconnect = () => Alert.alert('Disable Health Connect sync?',
    'This removes imported Health Connect sleep metrics from Sleep Coach. Your data in Google Health and Health Connect stays unchanged.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Disable and remove data', style: 'destructive', onPress: () => {
        setBusy(true);
        void disableHealthConnect(user.id).then(() => {
          setEnabled(false); setNeedsPermission(false); setMessage('Sync disabled and imported metrics removed.'); refreshViews(); onDisabled?.();
        }).catch(() => setMessage('Sync stopped, but cloud data removal could not finish. Check your connection and tap Disable sync again.'))
          .finally(() => setBusy(false));
      } },
    ]);
  return <View>
    <Text style={s.status}>{enabled ? 'Sync enabled' : 'Not connected'}</Text>
    <Text style={s.copy}>Connect Google Health / Fitbit to Health Connect and allow it to share Sleep. Then allow Sleep Coach to read your sleep.</Text>
    <Text style={s.copy}>We read sleep stages and upload normalized sleep metrics to your Sleep Coach account for coaching and progress. Our Sleep Coach score may differ from Google Health’s score. We never write to Health Connect.</Text>
    <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://30daysleepcoach.com/privacy.html')}><Text style={s.link}>Privacy policy</Text></Pressable>
    {!!message && <Text accessibilityLiveRegion="polite" style={s.copy}>{message}</Text>}
    {busy ? <ActivityIndicator color={colors.accent} style={s.loader}/> : <View style={s.actions}>
      <Pressable accessibilityRole="button" onPress={() => void sync()} style={s.primary}><Text style={s.primaryText}>{needsPermission ? 'Reconnect Health Connect' : enabled ? 'Refresh sleep' : 'Connect Health Connect'}</Text></Pressable>
      {enabled && <Pressable accessibilityRole="button" onPress={disconnect} style={s.secondary}><Text style={s.copy}>Disable sync</Text></Pressable>}
      <Pressable accessibilityRole="button" onPress={() => { try { manageHealthConnectPermissions(); } catch { setMessage('Open Android Settings and search for Health Connect.'); } }}><Text style={s.link}>Open Health Connect settings</Text></Pressable>
    </View>}
  </View>;
}
const s = StyleSheet.create({
  status: { color: colors.text, fontWeight: '800', marginTop: 8 },
  copy: { color: colors.textMuted, fontSize: 14, lineHeight: 21, marginTop: 8 },
  link: { color: colors.accent, paddingVertical: 10, fontWeight: '700' },
  actions: { gap: 8, marginTop: 12 }, loader: { marginTop: 12 },
  primary: { backgroundColor: colors.accent, padding: 13, borderRadius: 13, alignItems: 'center' },
  primaryText: { color: colors.ink, fontWeight: '800' },
  secondary: { alignItems: 'center', padding: 5, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 13 },
});
