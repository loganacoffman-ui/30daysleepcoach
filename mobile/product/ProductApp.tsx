import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';

import type { SleepProfile } from '../onboarding/types';
import TodayScreen from '../today/TodayScreen';
import { createSupabaseTodayRepository } from '../today/supabaseTodayRepository';
import { CoachScreen, ProgressScreen, SettingsScreen } from './InfoScreens';

type Tab='today'|'progress'|'coach'|'settings';
const tabs:{key:Tab;icon:string;label:string}[]=[{key:'today',icon:'☾',label:'Today'},{key:'progress',icon:'↗',label:'Progress'},{key:'coach',icon:'✦',label:'Coach'},{key:'settings',icon:'○',label:'Settings'}];

export default function ProductApp({session,profile,busy,onSignOut,onDeleteAccount}:{session:Session;profile:SleepProfile;busy:boolean;onSignOut:()=>void;onDeleteAccount:()=>void}){
  const [tab,setTab]=useState<Tab>('today');
  const repository=useMemo(()=>createSupabaseTodayRepository(session.user,profile.displayName,profile.primaryConcern),[session.user,profile.displayName,profile.primaryConcern]);
  return (
    <View style={styles.screen}>
      <View style={styles.body}>
        {tab === 'today' && <TodayScreen repository={repository} />}
        {tab === 'progress' && <ProgressScreen user={session.user} />}
        {tab === 'coach' && <CoachScreen profile={profile} />}
        {tab === 'settings' && <SettingsScreen busy={busy} onDeleteAccount={onDeleteAccount} onSignOut={onSignOut} profile={profile} user={session.user} />}
      </View>
      <View style={styles.tabs}>
        {tabs.map(item => <Pressable accessibilityRole="tab" accessibilityState={{selected:tab===item.key}} key={item.key} onPress={()=>setTab(item.key)} style={styles.tab}><Text style={[styles.icon,tab===item.key&&styles.selected]}>{item.icon}</Text><Text style={[styles.label,tab===item.key&&styles.selected]}>{item.label}</Text></Pressable>)}
      </View>
      <StatusBar style="dark" />
    </View>
  );
}
const styles=StyleSheet.create({screen:{backgroundColor:'#fafafa',flex:1},body:{flex:1},tabs:{backgroundColor:'#fff',borderTopColor:'#e7e3ea',borderTopWidth:1,flexDirection:'row',paddingBottom:20,paddingTop:9},tab:{alignItems:'center',flex:1},icon:{color:'#8c8793',fontSize:19,fontWeight:'800'},label:{color:'#8c8793',fontSize:10,fontWeight:'700',marginTop:3},selected:{color:'#3d6ae8'}});
