import { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';

import { colors } from '../design/theme';
import { syncAppleHealthForDate } from '../healthkit/appleHealth';
import type { SleepProfile } from '../onboarding/types';
import { createSupabaseTodayRepository } from '../today/supabaseTodayRepository';
import CoachChatScreen from '../coach/CoachChatScreen';
import { SettingsScreen } from './InfoScreens';
import ProgressScreen from '../progress/ProgressScreen';
import { supabase } from '../supabase';

const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
};

type Tab='progress'|'coach'|'settings';
const tabs:{key:Tab;icon:string;label:string}[]=[{key:'coach',icon:'✦',label:'Coach'},{key:'progress',icon:'↗',label:'Progress'},{key:'settings',icon:'○',label:'Settings'}];

export default function ProductApp({session,profile,busy,onSignOut,onDeleteAccount}:{session:Session;profile:SleepProfile;busy:boolean;onSignOut:()=>void;onDeleteAccount:()=>void}){
  const [tab,setTab]=useState<Tab>('coach');
  const [refreshKey,setRefreshKey]=useState(0);
  const [dailyViewRequest,setDailyViewRequest]=useState(0);
  const [coachHomeRequest,setCoachHomeRequest]=useState(0);
  const repository=useMemo(()=>createSupabaseTodayRepository(session.user,profile.displayName,profile.primaryConcern),[session.user,profile.displayName,profile.primaryConcern]);
  useEffect(()=>{
    void supabase.from('app_open_days').upsert(
      {user_id:session.user.id,opened_date:localDate()},
      {onConflict:'user_id,opened_date',ignoreDuplicates:true},
    );
  },[session.user.id]);
  useEffect(()=>{
    const openNotification=(response:Notifications.NotificationResponse|null)=>{
      if(response?.notification.request.content.data?.destination==='today'){
        setTab('coach');
        setDailyViewRequest(value=>value+1);
      }
    };
    void Notifications.getLastNotificationResponseAsync().then(openNotification);
    const subscription=Notifications.addNotificationResponseReceivedListener(openNotification);
    return()=>subscription.remove();
  },[]);
  useEffect(()=>{
    const sync=()=>{void syncAppleHealthForDate(session.user.id).then(r=>{if(r.status==='synced')setRefreshKey(k=>k+1);}).catch(()=>undefined);};
    sync();
    const subscription=AppState.addEventListener('change',state=>{if(state==='active')sync();});
    return()=>subscription.remove();
  },[session.user.id]);
  return (
    <View style={styles.screen}>
      <View style={styles.body}>
        {tab === 'progress' && <ProgressScreen profile={profile} user={session.user} />}
        {tab === 'coach' && <CoachChatScreen dailyViewRequest={dailyViewRequest} homeRequest={coachHomeRequest} key={refreshKey} profile={profile} repository={repository} user={session.user} />}
        {tab === 'settings' && <SettingsScreen busy={busy} onDeleteAccount={onDeleteAccount} onSignOut={onSignOut} profile={profile} user={session.user} />}
      </View>
      <View style={styles.tabs}>
        {tabs.map(item => <Pressable accessibilityRole="tab" accessibilityState={{selected:tab===item.key}} key={item.key} onPress={()=>{setTab(item.key);if(item.key==='coach')setCoachHomeRequest(value=>value+1);}} style={styles.tab}><Text style={[styles.icon,tab===item.key&&styles.selected]}>{item.icon}</Text><Text style={[styles.label,tab===item.key&&styles.selected]}>{item.label}</Text></Pressable>)}
      </View>
      <StatusBar style="light" />
    </View>
  );
}
const styles=StyleSheet.create({screen:{backgroundColor:colors.canvas,flex:1},body:{flex:1},tabs:{backgroundColor:colors.surfaceMuted,borderTopColor:colors.border,borderTopWidth:1,flexDirection:'row',paddingBottom:20,paddingTop:9},tab:{alignItems:'center',flex:1},icon:{color:colors.textFaint,fontSize:19,fontWeight:'800',height:22,lineHeight:22,textAlign:'center'},label:{color:colors.textSubtle,fontSize:10,fontWeight:'700',lineHeight:12,marginTop:3},selected:{color:colors.accent}});
