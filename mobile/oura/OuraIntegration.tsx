import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '../supabase';

const redirectTo = 'thirtydaysleepcoach://oura/callback';

type OuraStatus = {
  connected: boolean;
  scope?: string | null;
  updated_at?: string;
};

type DailySleep = {
  day: string;
  score?: number;
};

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export default function OuraIntegration() {
  const [status, setStatus] = useState<OuraStatus>({ connected: false });
  const [latestSleep, setLatestSleep] = useState<DailySleep | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    const { data, error: statusError } = await supabase.functions.invoke<OuraStatus>('oura-oauth-status');
    if (statusError) throw statusError;
    const nextStatus = data ?? { connected: false };
    setStatus(nextStatus);
    return nextStatus;
  }, []);

  const syncLatestSleep = useCallback(async () => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 7);
    const { data, error: proxyError } = await supabase.functions.invoke<{ data?: DailySleep[] }>('oura-proxy', {
      body: { endpoint: 'daily_sleep', start_date: dateKey(start), end_date: dateKey(end) },
    });
    if (proxyError) throw proxyError;
    const rows = data?.data ?? [];
    setLatestSleep(rows.slice().sort((a, b) => b.day.localeCompare(a.day))[0] ?? null);
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const nextStatus = await loadStatus();
      if (nextStatus.connected) await syncLatestSleep();
      else setLatestSleep(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Oura could not be refreshed.');
    } finally {
      setBusy(false);
    }
  }, [loadStatus, syncLatestSleep]);

  useEffect(() => { void refresh(); }, [refresh]);

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const { data, error: startError } = await supabase.functions.invoke<{ authorizeUrl?: string }>('oura-oauth-start', {
        body: { redirect_to: redirectTo },
      });
      if (startError || !data?.authorizeUrl) throw startError ?? new Error('Oura did not return an authorization URL.');
      const result = await WebBrowser.openAuthSessionAsync(data.authorizeUrl, redirectTo);
      if (result.type === 'success') {
        const url = new URL(result.url);
        if (url.searchParams.get('oura_error')) throw new Error(`Oura connection failed: ${url.searchParams.get('oura_error')}`);
        await refresh();
      }
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Oura could not be connected.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError('');
    try {
      const { error: disconnectError } = await supabase.functions.invoke('oura-oauth-disconnect');
      if (disconnectError) throw disconnectError;
      setStatus({ connected: false });
      setLatestSleep(null);
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'Oura could not be disconnected.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <View style={styles.statusRow}>
        <View style={[styles.dot, status.connected && styles.dotConnected]} />
        <Text style={styles.status}>{status.connected ? 'Connected' : 'Not connected'}</Text>
      </View>
      <Text style={styles.copy}>
        {status.connected
          ? latestSleep
            ? `Latest sleep score: ${latestSleep.score ?? '—'} (${latestSleep.day})`
            : 'Connected. Pull down your latest sleep data when it is available.'
          : 'Connect Oura to securely import sleep and recovery signals. Your Oura credentials stay on the server.'}
      </Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {busy ? <ActivityIndicator color="#4f7cff" style={styles.loader} /> : (
        <View style={styles.actions}>
          <Pressable onPress={status.connected ? () => void refresh() : () => void connect()} style={styles.primaryButton}>
            <Text style={styles.primaryText}>{status.connected ? 'Refresh Oura data' : 'Connect Oura'}</Text>
          </Pressable>
          {status.connected && <Pressable onPress={() => void disconnect()} style={styles.secondaryButton}><Text style={styles.secondaryText}>Disconnect</Text></Pressable>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  actions:{gap:8,marginTop:14},copy:{color:'#716d7d',fontSize:14,lineHeight:21,marginTop:8},dot:{backgroundColor:'#aaa5af',borderRadius:5,height:10,width:10},dotConnected:{backgroundColor:'#35a265'},error:{color:'#a53434',fontSize:13,lineHeight:18,marginTop:10},loader:{alignSelf:'flex-start',marginTop:14},primaryButton:{alignItems:'center',backgroundColor:'#4f7cff',borderRadius:13,padding:13},primaryText:{color:'#fff',fontSize:14,fontWeight:'800'},secondaryButton:{alignItems:'center',borderColor:'#ded9e3',borderRadius:13,borderWidth:1,padding:12},secondaryText:{color:'#5f5967',fontSize:14,fontWeight:'800'},status:{color:'#34303c',fontSize:14,fontWeight:'800'},statusRow:{alignItems:'center',flexDirection:'row',gap:8},
});
