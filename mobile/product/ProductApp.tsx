import { useEffect, useMemo, useState } from 'react';
import { AppState, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { subscribeToDailyCheckInNotifications } from '../notificationNavigation';
import { syncDailyCheckInReminder } from '../notifications';

import { colors } from '../design/theme';
import { syncAppleHealthForDate } from '../healthkit/appleHealth';
import type { SleepProfile } from '../onboarding/types';
import type { SleepProfileDraft } from '../onboarding/profileFields';
import { createSupabaseTodayRepository } from '../today/supabaseTodayRepository';
import CoachChatScreen from '../coach/CoachChatScreen';
import { invalidateCoachContext } from '../coach/coachRepository';
import { SettingsScreen } from './InfoScreens';
import ProgressScreen from '../progress/ProgressScreen';
import { supabase } from '../supabase';

const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
};

type Tab='progress'|'coach'|'settings';
const tabs:{key:Tab;icon:string;label:string}[]=[{key:'coach',icon:'✦',label:'Coach'},{key:'progress',icon:'↗',label:'Progress'},{key:'settings',icon:'○',label:'Settings'}];

export default function ProductApp({session,profile,busy,onSignOut,onDeleteAccount,onProfileSaved}:{session:Session;profile:SleepProfile;onProfileSaved:(draft:SleepProfileDraft)=>void;busy:boolean;onSignOut:()=>void;onDeleteAccount:()=>void}){
  const [tab,setTab]=useState<Tab>('coach');
  // Each tab is mounted the first time it is opened and then kept, so switching
  // tabs preserves scroll position, open sections, and loaded data instead of
  // rebuilding the screen. Settings and Progress stay unmounted until visited so
  // launch still pays for the Coach tab only.
  const [visited,setVisited]=useState<Record<Tab,boolean>>({coach:true,progress:false,settings:false});
  const selectTab=(next:Tab)=>{
    if(next!=='coach')Keyboard.dismiss();
    setVisited(current=>current[next]?current:{...current,[next]:true});
    setTab(next);
  };
  const [refreshKey,setRefreshKey]=useState(0);
  const [dailyViewRequest,setDailyViewRequest]=useState(0);
  const repository=useMemo(()=>createSupabaseTodayRepository(session.user,profile.displayName,profile.primaryConcern),[session.user,profile.displayName,profile.primaryConcern]);
  useEffect(()=>{
    void supabase.from('app_open_days').upsert(
      {user_id:session.user.id,opened_date:localDate()},
      {onConflict:'user_id,opened_date',ignoreDuplicates:true},
    );
  },[session.user.id]);
  useEffect(()=>subscribeToDailyCheckInNotifications(()=>{
    setTab('coach');
    setRefreshKey(value=>value+1);
    setDailyViewRequest(value=>value+1);
  }),[]);
  useEffect(()=>{
    if(Platform.OS==='web')return;
    const sync=(devicePushToken?:Notifications.DevicePushToken)=>{void syncDailyCheckInReminder(session.user.id,profile.reminderTime || '07:30',devicePushToken,profile.timezone)
      .catch(error=>console.warn('Daily reminder registration could not be refreshed',error));};
    sync();
    const appState=AppState.addEventListener('change',state=>{if(state==='active')sync();});
    const pushToken=Notifications.addPushTokenListener(sync);
    return()=>{appState.remove();pushToken.remove();};
  },[session.user.id,profile.reminderTime,profile.timezone]);
  useEffect(()=>{
    // A synced night is new evidence for the coach, so the shared context window
    // has to be dropped before the screens below refresh against it.
    const sync=()=>{void syncAppleHealthForDate(session.user.id).then(r=>{if(r.status==='synced'){invalidateCoachContext(session.user.id);setRefreshKey(k=>k+1);}}).catch(()=>undefined);};
    sync();
    const subscription=AppState.addEventListener('change',state=>{if(state==='active')sync();});
    return()=>subscription.remove();
  },[session.user.id]);
  return (
    <View style={styles.screen}>
      <View style={styles.body}>
        {visited.progress && <View style={tab === 'progress' ? styles.pane : styles.hiddenPane}>
          <ProgressScreen active={tab === 'progress'} profile={profile} refreshRequest={refreshKey} user={session.user} />
        </View>}
        <View style={tab === 'coach' ? styles.pane : styles.hiddenPane}>
          <CoachChatScreen dailyViewRequest={dailyViewRequest} refreshRequest={refreshKey} profile={profile} repository={repository} user={session.user} />
        </View>
        {visited.settings && <View style={tab === 'settings' ? styles.pane : styles.hiddenPane}>
          <SettingsScreen onProfileSaved={draft=>{invalidateCoachContext(session.user.id);onProfileSaved(draft);setRefreshKey(value=>value+1);}} busy={busy} onDeleteAccount={onDeleteAccount} onSignOut={onSignOut} profile={profile} user={session.user} />
        </View>}
      </View>
      <View style={styles.tabs}>
        {tabs.map(item => <Pressable accessibilityRole="tab" accessibilityState={{selected:tab===item.key}} key={item.key} onPress={()=>selectTab(item.key)} style={styles.tab}><Text style={[styles.icon,tab===item.key&&styles.selected]}>{item.icon}</Text><Text style={[styles.label,tab===item.key&&styles.selected]}>{item.label}</Text></Pressable>)}
      </View>
      <StatusBar style="light" />
    </View>
  );
}
const styles=StyleSheet.create({screen:{backgroundColor:colors.canvas,flex:1},body:{flex:1},pane:{flex:1},hiddenPane:{display:'none'},tabs:{backgroundColor:colors.surfaceMuted,borderTopColor:colors.border,borderTopWidth:1,flexDirection:'row',paddingBottom:20,paddingTop:9},tab:{alignItems:'center',flex:1},icon:{color:colors.textFaint,fontSize:19,fontWeight:'800',height:22,lineHeight:22,textAlign:'center'},label:{color:colors.textSubtle,fontSize:10,fontWeight:'700',lineHeight:12,marginTop:3},selected:{color:colors.accent}});
