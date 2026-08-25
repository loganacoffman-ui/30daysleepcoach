import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';

import { colors } from '../design/theme';
import {
  cancelDailyCheckInReminder,
  getDailyCheckInReminderState,
  saveDailyCheckInReminderTime,
  scheduleDailyCheckInReminder,
} from '../notifications';
import { supabase } from '../supabase';
import type { SleepProfile } from '../onboarding/types';
import OuraIntegration from '../oura/OuraIntegration';

const concernLabels: Record<string,string> = { falling_asleep:'Falling asleep', night_waking:'Waking during the night', early_waking:'Waking too early', unrefreshed:'Waking refreshed', irregular_schedule:'A steadier schedule' };

export function ProgressScreen({ user }: { user: User }) {
  const [rows,setRows]=useState<{checkin_date:string;feeling:number}[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
  const [commitments,setCommitments]=useState<{behavior_date:string;behavior:string;status:string}[]>([]);
  const load=useCallback(async()=>{setLoading(true);setError('');const [result, commitmentResult]=await Promise.all([supabase.from('daily_checkins').select('checkin_date, feeling').eq('user_id',user.id).order('checkin_date',{ascending:false}).limit(14),supabase.from('behavior_commitments').select('behavior_date, behavior, status').eq('user_id',user.id).order('behavior_date',{ascending:false}).limit(7)]);if(result.error)setError(result.error.message);else setRows(result.data ?? []);if(commitmentResult.error)setError(commitmentResult.error.message);else setCommitments(commitmentResult.data ?? []);setLoading(false);},[user.id]);
  useEffect(()=>{void load();},[load]);
  const average=rows.length?Math.round(rows.reduce((sum,row)=>sum+row.feeling,0)/rows.length):0;
  const tried=commitments.filter(item=>item.status==='completed'||item.status==='partial').length;
  return <ScrollView contentContainerStyle={s.content}><Text style={s.eyebrow}>PROGRESS</Text><Text style={s.title}>Your sleep, in context</Text><Text style={s.copy}>Trends become more useful as you check in. We’ll focus on direction—not perfect scores.</Text>{loading?<ActivityIndicator color={colors.accent}/>:<><View style={s.heroCard}><Text style={s.metric}>{rows.length}</Text><Text style={s.metricLabel}>check-ins recorded</Text>{rows.length>0&&<Text style={s.secondaryMetric}>Average feeling: {average}/100</Text>}<Text style={s.secondaryMetric}>Experiments tried: {tried}</Text></View>{commitments.length>0&&<View style={s.card}><Text style={s.cardEyebrow}>RECENT EXPERIMENTS</Text>{commitments.map(item=><View key={item.behavior_date} style={s.experimentRow}><View style={s.experimentCopy}><Text style={s.experimentDate}>{item.behavior_date}</Text><Text style={s.experimentBehavior}>{item.behavior}</Text></View><Text style={[s.experimentStatus,item.status==='completed'&&s.statusComplete,item.status==='partial'&&s.statusPartial]}>{item.status==='committed'?'Tonight':item.status==='completed'?'Done':item.status==='partial'?'Partly':'Skipped'}</Text></View>)}</View>}{rows.length===0?<Empty title="Your trend starts today" copy="Complete your first morning check-in and it will appear here."/>:rows.map(row=><View key={row.checkin_date} style={s.row}><Text style={s.rowDate}>{row.checkin_date}</Text><Text style={s.rowValue}>{row.feeling}/100</Text></View>)}</>}{!!error&&<Text style={s.error}>{error}</Text>}</ScrollView>;
}

export function SettingsScreen({ user, profile, busy, onSignOut, onDeleteAccount }: { user:User;profile:SleepProfile;busy:boolean;onSignOut:()=>void;onDeleteAccount:()=>void }) {
  const fallbackReminderTime = getFallbackReminderTime(profile);
  const [reminderEnabled,setReminderEnabled]=useState(false);
  const [reminderTime,setReminderTime]=useState(fallbackReminderTime);
  const [reminderLoading,setReminderLoading]=useState(true);
  const [reminderBusy,setReminderBusy]=useState(false);
  const [reminderError,setReminderError]=useState('');

  useEffect(()=>{
    let mounted=true;
    void getDailyCheckInReminderState(fallbackReminderTime)
      .then((state)=>{
        if (!mounted) return;
        setReminderEnabled(state.enabled);
        setReminderTime(state.clock);
      })
      .catch((error:unknown)=>{
        if (mounted) setReminderError(getNotificationError(error));
      })
      .finally(()=>{
        if (mounted) setReminderLoading(false);
      });
    return()=>{mounted=false;};
  },[fallbackReminderTime]);

  const showPermissionAlert=()=>{
    Alert.alert(
      'Notifications are off',
      'Allow notifications in Settings, then turn the reminder on again.',
      [
        {text:'Not now',style:'cancel'},
        {text:'Open Settings',onPress:()=>{void Linking.openSettings();}},
      ],
    );
  };

  const toggleReminder=async(enabled:boolean)=>{
    if(reminderBusy)return;
    setReminderBusy(true);
    setReminderError('');
    try{
      if(!enabled){
        await cancelDailyCheckInReminder();
        setReminderEnabled(false);
        return;
      }
      const result=await scheduleDailyCheckInReminder(reminderTime);
      if(result.status==='scheduled'){
        setReminderEnabled(true);
      }else if(result.status==='denied'){
        setReminderEnabled(false);
        showPermissionAlert();
      }else{
        setReminderError('Daily reminders are not available on this device.');
      }
    }catch(error){
      setReminderEnabled(false);
      setReminderError(getNotificationError(error));
    }finally{
      setReminderBusy(false);
    }
  };

  const adjustReminderTime=async(direction:number)=>{
    if(reminderBusy)return;
    const nextTime=shiftReminderTime(reminderTime,direction*15);
    setReminderTime(nextTime);
    setReminderBusy(true);
    setReminderError('');
    try{
      if(reminderEnabled){
        const result=await scheduleDailyCheckInReminder(nextTime);
        if(result.status!=='scheduled'){
          await cancelDailyCheckInReminder();
          setReminderEnabled(false);
          if(result.status==='denied')showPermissionAlert();
        }
      }else{
        await saveDailyCheckInReminderTime(nextTime);
      }
    }catch(error){
      setReminderError(getNotificationError(error));
    }finally{
      setReminderBusy(false);
    }
  };

  return <ScrollView contentContainerStyle={s.content}><Text style={s.eyebrow}>SETTINGS</Text><Text style={s.title}>{profile.displayName||'Your profile'}</Text><Text style={s.copy}>{user.email}</Text><View style={s.card}><Text style={s.cardEyebrow}>SLEEP PROFILE</Text><Setting label="Primary focus" value={concernLabels[profile.primaryConcern]}/><Setting label="Usual bedtime" value={profile.typicalBedtime||'Not set'}/><Setting label="Usual wake time" value={profile.typicalWakeTime||'Not set'}/><Setting label="Timezone" value={profile.timezone}/></View><View style={s.card}><Text style={s.cardEyebrow}>REMINDERS</Text><View style={s.notificationRow}><View style={s.notificationCopy}><Text style={s.notificationTitle}>Daily check-in</Text><Text style={s.notificationDescription}>A reminder after waking to record how last night went.</Text></View>{reminderLoading?<ActivityIndicator color={colors.accent}/>:<Switch accessibilityLabel="Daily check-in reminder" disabled={reminderBusy} onValueChange={(enabled)=>{void toggleReminder(enabled);}} trackColor={{false:colors.borderStrong,true:colors.accentSoft}} thumbColor={reminderEnabled?colors.accent:colors.textMuted} value={reminderEnabled}/>}</View><View style={s.reminderControls}><Pressable accessibilityLabel="Move reminder 15 minutes earlier" disabled={reminderBusy} onPress={()=>{void adjustReminderTime(-1);}} style={s.timeAdjustButton}><Text style={s.timeAdjustText}>−</Text></Pressable><Text style={s.reminderTime}>{formatReminderTime(reminderTime)}</Text><Pressable accessibilityLabel="Move reminder 15 minutes later" disabled={reminderBusy} onPress={()=>{void adjustReminderTime(1);}} style={s.timeAdjustButton}><Text style={s.timeAdjustText}>+</Text></Pressable></View>{!!reminderError&&<Text style={s.notificationError}>{reminderError}</Text>}</View><View style={s.card}><Text style={s.cardEyebrow}>INTEGRATIONS</Text><Text style={s.cardTitle}>Oura connection</Text><OuraIntegration /></View><Pressable onPress={()=>void Linking.openURL('https://30daysleepcoach.com/privacy.html')} style={s.button}><Text style={s.buttonText}>Privacy policy</Text></Pressable><Pressable disabled={busy} onPress={onSignOut} style={s.button}><Text style={s.buttonText}>Sign out</Text></Pressable><Pressable disabled={busy} onPress={onDeleteAccount} style={[s.button,s.dangerButton]}><Text style={s.dangerText}>Delete account</Text></Pressable></ScrollView>;
}

function getNotificationError(error:unknown){return error instanceof Error?error.message:'We could not update your reminder. Please try again.';}
function getFallbackReminderTime(profile:SleepProfile){if(/^([01]\d|2[0-3]):[0-5]\d$/.test(profile.reminderTime))return profile.reminderTime;const wakeMatch=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(profile.typicalWakeTime);if(!wakeMatch)return'07:30';return minutesToClock(Number(wakeMatch[1])*60+Number(wakeMatch[2])+30);}
function shiftReminderTime(clock:string,change:number){const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock);const minutes=match?Number(match[1])*60+Number(match[2]):7*60+30;return minutesToClock(minutes+change);}
function minutesToClock(minutes:number){const normalized=((minutes%(24*60))+24*60)%(24*60);return`${String(Math.floor(normalized/60)).padStart(2,'0')}:${String(normalized%60).padStart(2,'0')}`;}
function formatReminderTime(clock:string){const[hours,minutes]=clock.split(':').map(Number);const suffix=hours>=12?'PM':'AM';return`${hours%12||12}:${String(minutes).padStart(2,'0')} ${suffix}`;}
function Setting({label,value}:{label:string;value:string}){return <View style={s.setting}><Text style={s.settingLabel}>{label}</Text><Text style={s.settingValue}>{value}</Text></View>}
function Empty({title,copy}:{title:string;copy:string}){return <View style={s.card}><Text style={s.cardTitle}>{title}</Text><Text style={s.cardCopy}>{copy}</Text></View>}
const s=StyleSheet.create({content:{backgroundColor:colors.canvas,flexGrow:1,padding:20,paddingBottom:48,paddingTop:64},eyebrow:{color:colors.accentSoft,fontSize:12,fontWeight:'800',letterSpacing:1.8,marginBottom:8},title:{color:colors.text,fontSize:30,fontWeight:'800',letterSpacing:-.8},copy:{color:colors.textMuted,fontSize:15,lineHeight:22,marginBottom:24,marginTop:8},heroCard:{backgroundColor:colors.surfaceAccent,borderColor:colors.borderSelected,borderRadius:24,borderWidth:1,marginBottom:14,padding:22},heroEyebrow:{color:colors.accent,fontSize:11,fontWeight:'800',letterSpacing:1.3,marginBottom:8},heroTitle:{color:colors.text,fontSize:22,fontWeight:'800',lineHeight:28},heroLabel:{color:colors.accent,fontSize:10,fontWeight:'800',letterSpacing:1.1,marginTop:20},heroCopy:{color:colors.text,fontSize:15,fontWeight:'600',lineHeight:22,marginTop:7},metric:{color:colors.accent,fontSize:46,fontWeight:'800'},metricLabel:{color:colors.textMuted,fontSize:15,fontWeight:'700'},secondaryMetric:{color:colors.text,fontSize:16,fontWeight:'800',marginTop:18},card:{backgroundColor:colors.surface,borderColor:colors.border,borderRadius:22,borderWidth:1,marginBottom:14,padding:20},cardEyebrow:{color:colors.accentSoft,fontSize:11,fontWeight:'800',letterSpacing:1.3,marginBottom:8},cardTitle:{color:colors.text,fontSize:20,fontWeight:'800'},cardCopy:{color:colors.textMuted,fontSize:14,lineHeight:21,marginTop:8},coachNote:{backgroundColor:colors.surfaceAccent,borderRadius:12,color:colors.accent,fontSize:13,lineHeight:19,marginTop:14,padding:12},experimentRow:{alignItems:'flex-start',borderTopColor:colors.border,borderTopWidth:1,flexDirection:'row',gap:10,paddingVertical:13},experimentCopy:{flex:1},experimentDate:{color:colors.textSubtle,fontSize:10,fontWeight:'700'},experimentBehavior:{color:colors.text,fontSize:13,fontWeight:'700',lineHeight:18,marginTop:3},experimentStatus:{backgroundColor:colors.surfaceRaised,borderRadius:10,color:colors.textMuted,fontSize:10,fontWeight:'800',overflow:'hidden',paddingHorizontal:8,paddingVertical:5},statusComplete:{backgroundColor:colors.successSurface,color:colors.success},statusPartial:{backgroundColor:colors.warningSurface,color:colors.accent},row:{backgroundColor:colors.surface,borderBottomColor:colors.border,borderBottomWidth:1,flexDirection:'row',justifyContent:'space-between',padding:16},rowDate:{color:colors.textMuted,fontWeight:'700'},rowValue:{color:colors.accent,fontWeight:'800'},error:{color:colors.danger,marginTop:12},disclaimer:{color:colors.textSubtle,fontSize:12,lineHeight:18,marginTop:12,textAlign:'center'},setting:{borderBottomColor:colors.border,borderBottomWidth:1,paddingVertical:13},settingLabel:{color:colors.textSubtle,fontSize:12},settingValue:{color:colors.text,fontSize:15,fontWeight:'700',marginTop:3},notificationRow:{alignItems:'center',flexDirection:'row',gap:16},notificationCopy:{flex:1},notificationTitle:{color:colors.text,fontSize:17,fontWeight:'800'},notificationDescription:{color:colors.textMuted,fontSize:13,lineHeight:19,marginTop:4},reminderControls:{alignItems:'center',backgroundColor:colors.surfaceMuted,borderRadius:16,flexDirection:'row',justifyContent:'space-between',marginTop:18,padding:8},timeAdjustButton:{alignItems:'center',backgroundColor:colors.surfaceRaised,borderRadius:12,height:42,justifyContent:'center',width:46},timeAdjustText:{color:colors.accent,fontSize:25,fontWeight:'600'},reminderTime:{color:colors.text,fontSize:20,fontWeight:'800'},notificationError:{color:colors.danger,fontSize:13,lineHeight:18,marginTop:12},button:{alignItems:'center',backgroundColor:colors.surface,borderColor:colors.borderStrong,borderRadius:16,borderWidth:1,marginTop:10,padding:16},buttonText:{color:colors.text,fontSize:15,fontWeight:'800'},dangerButton:{borderColor:colors.danger},dangerText:{color:colors.danger,fontSize:15,fontWeight:'800'}});
