import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { User } from '@supabase/supabase-js';

import { colors } from '../design/theme';
import { isUnavailableSleepSchemaError } from '../sleep/sourcePreference';
import { supabase } from '../supabase';
import {
  connectAppleHealth,
  disableAppleHealth,
  isAppleHealthAvailable,
  isAppleHealthEnabled,
  syncAppleHealthForDate,
} from './appleHealth';
import { localDateKey } from './sleepAggregation';

type StoredNight = {
  sleep_score: number | null;
  sleep_date: string;
  total_sleep_minutes: number | null;
  synced_at: string;
};

export default function AppleHealthIntegration({
  onConnected,
  onDisabled,
  user,
}: {
  onConnected?: () => void;
  onDisabled?: () => void;
  user: User;
}) {
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(false);
  const [latestNight, setLatestNight] = useState<StoredNight | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');

  const loadStoredState = useCallback(async () => {
    const healthAvailable = isAppleHealthAvailable();
    setAvailable(healthAvailable);
    setEnabled(await isAppleHealthEnabled(user.id));
    if (!healthAvailable) {
      setLatestNight(null);
      return;
    }
    const { data, error } = await supabase
      .from('sleep_nights')
      .select('sleep_score, sleep_date, total_sleep_minutes, synced_at')
      .eq('user_id', user.id)
      .eq('provider', 'apple_health')
      .order('sleep_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (isUnavailableSleepSchemaError(error)) {
        setLatestNight(null);
        return;
      }
      throw error;
    }
    setLatestNight(data);
  }, [user.id]);

  useEffect(() => {
    let active = true;
    void loadStoredState()
      .catch(error => {
        if (active) setMessage(error instanceof Error ? error.message : 'Apple Health could not be loaded.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [loadStoredState]);

  const runSync = async (connect: boolean) => {
    setBusy(true);
    setMessage('');
    try {
      const result = connect
        ? await connectAppleHealth(user.id)
        : await syncAppleHealthForDate(user.id);
      if (connect && result.status !== 'unavailable') onConnected?.();
      setEnabled(result.status !== 'disabled' && result.status !== 'unavailable');
      if (result.status === 'synced') {
        setMessage(
          result.night.sleepScore === null
            ? 'Sleep synced, but there was not enough staged sleep to calculate a score.'
            : `Today’s Sleep Coach score is ${result.night.sleepScore}.`,
        );
      } else if (result.status === 'no_data') {
        setMessage('No complete sleep session was available. Refresh after Health updates, or enable Sleep access in iOS Settings if it was denied.');
      } else if (result.status === 'storage_unavailable') {
        setMessage('Apple Health is connected, but cloud sync is still being prepared. Oura or manual sleep remains available.');
      } else if (result.status === 'unavailable') {
        setMessage('Apple Health is not available on this device.');
      }
      await loadStoredState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Apple Health could not be synced.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDisable = () => {
    Alert.alert(
      'Disable Apple Health sync?',
      'This removes Apple Health sleep data saved in 30 Day Sleep Coach. Your data in Apple Health is not changed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disable and remove data',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            setMessage('');
            void disableAppleHealth(user.id)
              .then(() => {
                setEnabled(false);
                setLatestNight(null);
                setMessage('Apple Health sync is disabled.');
                onDisabled?.();
              })
              .catch(error => {
                setMessage(error instanceof Error ? error.message : 'Apple Health could not be disabled.');
              })
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  };

  if (!available && !busy) {
    return <Text style={styles.copy}>Apple Health is unavailable on this device.</Text>;
  }

  return (
    <View>
      <View style={styles.statusRow}>
        <View style={[styles.dot, enabled && styles.dotConnected]} />
        <Text style={styles.status}>{enabled ? 'Sync enabled' : 'Not connected'}</Text>
      </View>
      <Text style={styles.copy}>
        {latestNight?.sleep_date === localDateKey()
          ? typeof latestNight.sleep_score === 'number'
            ? `Today’s Sleep Coach score: ${latestNight.sleep_score}. Calculated from Apple Health sleep stages.`
            : `${latestNight.total_sleep_minutes ?? '—'} minutes synced today; a score needs detailed sleep stages.`
          : 'Read sleep stages from Apple Health to calculate a Sleep Coach score. This is not Apple’s Sleep Score.'}
      </Text>
      {!!message && <Text style={styles.message}>{message}</Text>}
      {busy ? <ActivityIndicator color={colors.accent} style={styles.loader} /> : (
        <View style={styles.actions}>
          <Pressable
            onPress={() => void runSync(!enabled)}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryText}>{enabled ? 'Refresh Apple Health' : 'Connect Apple Health'}</Text>
          </Pressable>
          {enabled && (
            <>
              <Pressable onPress={confirmDisable} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>Disable sync</Text>
              </Pressable>
              <Pressable onPress={() => void Linking.openSettings()}>
                <Text style={styles.settingsLink}>Manage permission in iOS Settings</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8, marginTop: 14 },
  copy: { color: colors.textMuted, fontSize: 14, lineHeight: 21, marginTop: 8 },
  dot: { backgroundColor: colors.textFaint, borderRadius: 5, height: 10, width: 10 },
  dotConnected: { backgroundColor: colors.success },
  loader: { alignSelf: 'flex-start', marginTop: 14 },
  message: { color: colors.textSubtle, fontSize: 13, lineHeight: 18, marginTop: 10 },
  primaryButton: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: 13, padding: 13 },
  primaryText: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  secondaryButton: { alignItems: 'center', borderColor: colors.borderStrong, borderRadius: 13, borderWidth: 1, padding: 12 },
  secondaryText: { color: colors.textMuted, fontSize: 14, fontWeight: '800' },
  settingsLink: { color: colors.accent, fontSize: 12, fontWeight: '700', paddingVertical: 6, textAlign: 'center' },
  status: { color: colors.text, fontSize: 14, fontWeight: '800' },
  statusRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
});
