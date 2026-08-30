import { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';

import { colors } from '../design/theme';
import { syncAppleHealthForDate } from '../healthkit/appleHealth';
import type { SleepProfile } from '../onboarding/types';
import TodayScreen from '../today/TodayScreen';
import { createSupabaseTodayRepository } from '../today/supabaseTodayRepository';
import CoachChatScreen from '../coach/CoachChatScreen';
import { ProgressScreen, SettingsScreen } from './InfoScreens';
import { supabase } from '../supabase';

const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
};

type Tab='today'|'progress'|'coach'|'settings';
const tabs:{key:Tab;icon:string;label:string}[]=[{key:'coach',icon:'✦',label:'Coach'},{key:'today',icon:'☾',label:'Today'},{key:'progress',icon:'↗',label:'Progress'},{key:'settings',icon:'○',label:'Settings'}];

export default function ProductApp({session,profile,busy,onSignOut,onDeleteAccount}:{session:Session;profile:SleepProfile;busy:boolean;onSignOut:()=>void;onDeleteAccount:()=>void}){
  const [tab,setTab]=useState<Tab>('coach');
  const [refreshKey,setRefreshKey]=useState(0);
  const repository=useMemo(()=>createSupabaseTodayRepository(session.user,profile.displayName,profile.primaryConcern),[session.user,profile.displayName,profile.primaryConcern]);
  useEffect(()=>{
    void supabase.from('app_open_days').upsert(
      {user_id:session.user.id,opened_date:localDate()},
      {onConflict:'user_id,opened_date',ignoreDuplicates:true},
    );
  },[session.user.id]);
  useEffect(()=>{
    const sync=()=>{void syncAppleHealthForDate(session.user.id).then(()=>setRefreshKey(k=>k+1)).catch(()=>undefined);};
    sync();
    const subscription=AppState.addEventListener('change',state=>{if(state==='active')sync();});
    return()=>subscription.remove();
  },[session.user.id]);
  return (
    <View style={styles.screen}>
      <View style={styles.body}>
        {tab === 'today' && <TodayScreen key={refreshKey} profile={profile} repository={repository} user={session.user} />}
        {tab === 'progress' && <ProgressScreen user={session.user} />}
        {tab === 'coach' && <CoachChatScreen key={refreshKey} profile={profile} user={session.user} />}
        {tab === 'settings' && <SettingsScreen busy={busy} onDeleteAccount={onDeleteAccount} onSignOut={onSignOut} profile={profile} user={session.user} />}
      </View>
      <View style={styles.tabs}>
        {tabs.map(item => <Pressable accessibilityRole="tab" accessibilityState={{selected:tab===item.key}} key={item.key} onPress={()=>setTab(item.key)} style={styles.tab}><Text style={[styles.icon,tab===item.key&&styles.selected]}>{item.icon}</Text><Text style={[styles.label,tab===item.key&&styles.selected]}>{item.label}</Text></Pressable>)}
      </View>
      <StatusBar style="light" />
    </View>
  );
}
const styles=StyleSheet.create({screen:{backgroundColor:colors.canvas,flex:1},body:{flex:1},tabs:{backgroundColor:colors.surfaceMuted,borderTopColor:colors.border,borderTopWidth:1,flexDirection:'row',paddingBottom:20,paddingTop:9},tab:{alignItems:'center',flex:1},icon:{color:colors.textFaint,fontSize:19,fontWeight:'800'},label:{color:colors.textSubtle,fontSize:10,fontWeight:'700',marginTop:3},selected:{color:colors.accent}});
