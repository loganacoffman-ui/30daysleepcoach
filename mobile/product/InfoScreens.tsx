import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';

import { colors, layout } from '../design/theme';
import AppleHealthIntegration from '../healthkit/AppleHealthIntegration';
import {
  cancelDailyCheckInReminder,
  getDailyCheckInReminderState,
  saveDailyCheckInReminderTime,
  scheduleDailyCheckInReminder,
} from '../notifications';
import { supabase } from '../supabase';
import type { SleepProfile, SleepSource } from '../onboarding/types';
import OuraIntegration from '../oura/OuraIntegration';
import { savePreferredSleepSource } from '../sleep/sourcePreference';
import type { MorningFeeling } from '../today/feeling';
import { feelingLabel, normalizeMorningFeeling } from '../today/feeling';

const concernLabels: Record<string,string> = { falling_asleep:'Falling asleep', night_waking:'Waking during the night', early_waking:'Waking too early', unrefreshed:'Waking refreshed', irregular_schedule:'A steadier schedule' };

export function ProgressScreen({ user }: { user: User }) {
  const [rows,setRows]=useState<{checkin_date:string;morningFeeling:MorningFeeling}[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
  const [commitments,setCommitments]=useState<{behavior_date:string;behavior:string;status:string}[]>([]);
  const [experimentsOpen,setExperimentsOpen]=useState(false);
  const [feelingsOpen,setFeelingsOpen]=useState(false);
  const load=useCallback(async()=>{setLoading(true);setError('');const [result, commitmentResult]=await Promise.all([supabase.from('daily_checkins').select('checkin_date, morning_feeling, feeling').eq('user_id',user.id).order('checkin_date',{ascending:false}).limit(60),supabase.from('behavior_commitments').select('behavior_date, behavior, status').eq('user_id',user.id).order('behavior_date',{ascending:false}).limit(30)]);if(result.error)setError(result.error.message);else setRows((result.data??[]).flatMap(row=>{const morningFeeling=normalizeMorningFeeling(row.morning_feeling,row.feeling);return morningFeeling?[{checkin_date:row.checkin_date,morningFeeling}]:[];}));if(commitmentResult.error)setError(commitmentResult.error.message);else setCommitments(commitmentResult.data ?? []);setLoading(false);},[user.id]);
  useEffect(()=>{void load();},[load]);
  const recentRows=rows.slice(0,7);
  const commonFeeling=recentRows.length?mostCommonFeeling(recentRows.map(row=>row.morningFeeling)):null;
  const tried=commitments.filter(item=>item.status!=='committed').length;
  const earliestDate=rows.length?[...rows].sort((a,b)=>a.checkin_date.localeCompare(b.checkin_date))[0].checkin_date:localISODate();
  const completedDates=new Set(rows.map(row=>row.checkin_date));
  const journeyDates=Array.from({length:30},(_,index)=>addDays(earliestDate,index));

  return <ScrollView contentContainerStyle={s.content}>
    <Text style={s.eyebrow}>PROGRESS</Text>
    <Text style={s.title}>Your sleep, in context</Text>
    <Text style={s.copy}>Thirty days of small signals become a useful story.</Text>
    {loading?<ActivityIndicator color={colors.accent}/>:<>
      <View style={s.quickStats}>
        <ProgressStat color={colors.accent} label={`${rows.length} check-ins recorded`}/>
        <ProgressStat color={colors.success} label={commonFeeling?`${feelingLabel(commonFeeling)} most often · past 7 days`:'Reported feeling will appear after your first check-in'}/>
        <ProgressStat color={colors.accentSoft} label={`${tried} experiments tracked`}/>
      </View>

      <View style={s.journeySection}>
        <View style={s.journeyHeader}><Text style={s.cardEyebrow}>YOUR 30-DAY JOURNEY</Text><Text style={s.journeyCount}>{Math.min(rows.length,30)} of 30</Text></View>
        <View style={s.journeyGrid}>{journeyDates.map((date,index)=><View accessibilityLabel={`Day ${index+1}${completedDates.has(date)?', check-in complete':', no check-in'}`} key={date} style={[s.journeySquare,completedDates.has(date)&&s.journeySquareComplete,date>localISODate()&&s.journeySquareFuture]}/>)}</View>
      </View>

      <ProgressDropdown label="RECENT EXPERIMENTS" onPress={()=>setExperimentsOpen(value=>!value)} open={experimentsOpen}>
        {commitments.length===0?<Text style={s.dropdownEmpty}>Your experiments will appear here.</Text>:commitments.map(item=><View key={item.behavior_date} style={s.experimentRow}><View style={s.experimentCopy}><Text style={s.experimentDate}>{formatProgressDate(item.behavior_date)}</Text><Text style={s.experimentBehavior}>{item.behavior}</Text></View><Text style={[s.experimentStatus,item.status==='completed'&&s.statusComplete,item.status==='partial'&&s.statusPartial]}>{item.status==='committed'?'Tonight':item.status==='completed'?'Done':item.status==='partial'?'Partly':'Skipped'}</Text></View>)}
      </ProgressDropdown>

      <ProgressDropdown label="REPORTED FEELING" onPress={()=>setFeelingsOpen(value=>!value)} open={feelingsOpen}>
        {rows.length===0?<Text style={s.dropdownEmpty}>Complete your first morning check-in and it will appear here.</Text>:rows.map(row=><View key={row.checkin_date} style={s.feelingHistoryRow}><Text style={s.rowDate}>{formatProgressDate(row.checkin_date)}</Text><Text style={s.rowValue}>{feelingLabel(row.morningFeeling)}</Text></View>)}
      </ProgressDropdown>
    </>}
    {!!error&&<Text style={s.error}>{error}</Text>}
  </ScrollView>;
}

function ProgressStat({color,label}:{color:string;label:string}){return <View style={s.progressStat}><View style={[s.progressStatDot,{backgroundColor:color}]}/><Text style={s.progressStatText}>{label}</Text></View>}
function ProgressDropdown({children,label,onPress,open}:{children:ReactNode;label:string;onPress:()=>void;open:boolean}){return <View style={s.dropdown}><Pressable accessibilityRole="button" accessibilityState={{expanded:open}} onPress={onPress} style={s.dropdownHeader}><Text style={s.dropdownLabel}>{label}</Text><Text style={s.dropdownChevron}>{open?'⌃':'⌄'}</Text></Pressable>{open&&<View style={s.dropdownBody}>{children}</View>}</View>}
function localISODate(){const date=new Date();return`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function addDays(date:string,count:number){const value=new Date(`${date}T12:00:00`);value.setDate(value.getDate()+count);return`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;}
function mostCommonFeeling(values:MorningFeeling[]){return values.reduce((best,value)=>values.filter(item=>item===value).length>values.filter(item=>item===best).length?value:best);}
function formatProgressDate(date:string){return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(new Date(`${date}T12:00:00`));}

export function SettingsScreen({ user, profile, busy, onSignOut, onDeleteAccount }: { user:User;profile:SleepProfile;busy:boolean;onSignOut:()=>void;onDeleteAccount:()=>void }) {
  const fallbackReminderTime = getFallbackReminderTime(profile);
  const [reminderEnabled,setReminderEnabled]=useState(false);
  const [reminderTime,setReminderTime]=useState(fallbackReminderTime);
  const [reminderLoading,setReminderLoading]=useState(true);
  const [reminderBusy,setReminderBusy]=useState(false);
  const [reminderError,setReminderError]=useState('');
  const [preferredSource,setPreferredSource]=useState<SleepSource|null>(profile.preferredSleepSource);
  const [sourceBusy,setSourceBusy]=useState(false);
  const [sourceError,setSourceError]=useState('');

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

  const savePreferredSource=async(source:SleepSource)=>{
    if(sourceBusy)return;
    setSourceBusy(true);
    setSourceError('');
    try{
      await savePreferredSleepSource(user.id,source);
      setPreferredSource(source);
    }catch(error){
      setSourceError(error instanceof Error?error.message:'Your preferred source could not be saved.');
    }finally{
      setSourceBusy(false);
    }
  };

  return <ScrollView contentContainerStyle={s.content}>
    <Text style={s.eyebrow}>SETTINGS</Text>
    <Text style={s.title}>{profile.displayName||'Your profile'}</Text>
    <Text style={s.copy}>{user.email}</Text>
    <View style={s.card}>
      <Text style={s.cardEyebrow}>SLEEP PROFILE</Text>
      <Setting label="Primary focus" value={concernLabels[profile.primaryConcern]}/>
      <Setting label="Usual bedtime" value={profile.typicalBedtime||'Not set'}/>
      <Setting label="Usual wake time" value={profile.typicalWakeTime||'Not set'}/>
      <Setting label="Timezone" value={profile.timezone}/>
    </View>
    <View style={s.card}>
      <Text style={s.cardEyebrow}>REMINDERS</Text>
      <View style={s.notificationRow}>
        <View style={s.notificationCopy}>
          <Text style={s.notificationTitle}>Daily check-in</Text>
          <Text style={s.notificationDescription}>A reminder after waking to record how last night went.</Text>
        </View>
        {reminderLoading?<ActivityIndicator color={colors.accent}/>:<Switch accessibilityLabel="Daily check-in reminder" disabled={reminderBusy} onValueChange={(enabled)=>{void toggleReminder(enabled);}} trackColor={{false:colors.borderStrong,true:colors.accentSoft}} thumbColor={reminderEnabled?colors.accent:colors.textMuted} value={reminderEnabled}/>}
      </View>
      <View style={s.reminderControls}>
        <Pressable accessibilityLabel="Move reminder 15 minutes earlier" disabled={reminderBusy} onPress={()=>{void adjustReminderTime(-1);}} style={s.timeAdjustButton}><Text style={s.timeAdjustText}>−</Text></Pressable>
        <Text style={s.reminderTime}>{formatReminderTime(reminderTime)}</Text>
        <Pressable accessibilityLabel="Move reminder 15 minutes later" disabled={reminderBusy} onPress={()=>{void adjustReminderTime(1);}} style={s.timeAdjustButton}><Text style={s.timeAdjustText}>+</Text></Pressable>
      </View>
      {!!reminderError&&<Text style={s.notificationError}>{reminderError}</Text>}
    </View>
    {Platform.OS==='ios'&&<View style={s.card}>
      <Text style={s.cardEyebrow}>INTEGRATIONS</Text>
      <Text style={s.cardTitle}>Apple Health</Text>
      <AppleHealthIntegration
        onConnected={()=>setPreferredSource(current=>current??'apple_health')}
        onDisabled={()=>setPreferredSource(current=>current==='apple_health'?null:current)}
        user={user}
      />
    </View>}
    <View style={s.card}>
      <Text style={s.cardEyebrow}>INTEGRATIONS</Text>
      <Text style={s.cardTitle}>Oura connection</Text>
      <OuraIntegration />
    </View>
    {Platform.OS==='ios'&&<View style={s.card}>
      <Text style={s.cardEyebrow}>PREFERRED SLEEP SOURCE</Text>
      <Text style={s.cardCopy}>We use your preferred source when both integrations have a score, then fall back to the other source.</Text>
      <View style={s.sourceButtons}>
        {([
          ['apple_health','Apple Health'],
          ['oura','Oura'],
        ] as const).map(([source,label])=><Pressable
          accessibilityRole="button"
          accessibilityState={{selected:preferredSource===source}}
          disabled={sourceBusy}
          key={source}
          onPress={()=>void savePreferredSource(source)}
          style={[s.sourceButton,preferredSource===source&&s.sourceButtonSelected]}
        ><Text style={[s.sourceButtonText,preferredSource===source&&s.sourceButtonTextSelected]}>{label}</Text></Pressable>)}
      </View>
      {!!sourceError&&<Text style={s.notificationError}>{sourceError}</Text>}
    </View>}
    <Pressable onPress={()=>void Linking.openURL('https://30daysleepcoach.com/privacy.html')} style={s.button}><Text style={s.buttonText}>Privacy policy</Text></Pressable>
    <Pressable disabled={busy} onPress={onSignOut} style={s.button}><Text style={s.buttonText}>Sign out</Text></Pressable>
    <Pressable disabled={busy} onPress={onDeleteAccount} style={[s.button,s.dangerButton]}><Text style={s.dangerText}>Delete account</Text></Pressable>
  </ScrollView>;
}

function getNotificationError(error:unknown){return error instanceof Error?error.message:'We could not update your reminder. Please try again.';}
function getFallbackReminderTime(profile:SleepProfile){if(/^([01]\d|2[0-3]):[0-5]\d$/.test(profile.reminderTime))return profile.reminderTime;const wakeMatch=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(profile.typicalWakeTime);if(!wakeMatch)return'07:30';return minutesToClock(Number(wakeMatch[1])*60+Number(wakeMatch[2])+30);}
function shiftReminderTime(clock:string,change:number){const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock);const minutes=match?Number(match[1])*60+Number(match[2]):7*60+30;return minutesToClock(minutes+change);}
function minutesToClock(minutes:number){const normalized=((minutes%(24*60))+24*60)%(24*60);return`${String(Math.floor(normalized/60)).padStart(2,'0')}:${String(normalized%60).padStart(2,'0')}`;}
function formatReminderTime(clock:string){const[hours,minutes]=clock.split(':').map(Number);const suffix=hours>=12?'PM':'AM';return`${hours%12||12}:${String(minutes).padStart(2,'0')} ${suffix}`;}
function Setting({label,value}:{label:string;value:string}){return <View style={s.setting}><Text style={s.settingLabel}>{label}</Text><Text style={s.settingValue}>{value}</Text></View>}
function Empty({title,copy}:{title:string;copy:string}){return <View style={s.card}><Text style={s.cardTitle}>{title}</Text><Text style={s.cardCopy}>{copy}</Text></View>}
const s=StyleSheet.create({content:{backgroundColor:colors.canvas,flexGrow:1,padding:20,paddingBottom:48,paddingTop:64},eyebrow:{color:colors.accentSoft,fontSize:12,fontWeight:'800',letterSpacing:1.8,marginBottom:8},title:{color:colors.text,fontSize:30,fontWeight:'800',letterSpacing:-.8},copy:{color:colors.textMuted,fontSize:15,lineHeight:22,marginBottom:24,marginTop:8},heroCard:{backgroundColor:colors.surfaceAccent,borderColor:colors.borderSelected,borderRadius:24,borderWidth:1,marginBottom:14,padding:22},heroEyebrow:{color:colors.accent,fontSize:11,fontWeight:'800',letterSpacing:1.3,marginBottom:8},heroTitle:{color:colors.text,fontSize:22,fontWeight:'800',lineHeight:28},heroLabel:{color:colors.accent,fontSize:10,fontWeight:'800',letterSpacing:1.1,marginTop:20},heroCopy:{color:colors.text,fontSize:15,fontWeight:'600',lineHeight:22,marginTop:7},metric:{color:colors.accent,fontSize:46,fontWeight:'800'},metricLabel:{color:colors.textMuted,fontSize:15,fontWeight:'700'},secondaryMetric:{color:colors.text,fontSize:16,fontWeight:'800',marginTop:18},card:{backgroundColor:colors.surface,borderColor:colors.border,borderRadius:22,borderWidth:1,marginBottom:14,padding:20},cardEyebrow:{color:colors.accentSoft,fontSize:11,fontWeight:'800',letterSpacing:1.3,marginBottom:8},cardTitle:{color:colors.text,fontSize:20,fontWeight:'800'},cardCopy:{color:colors.textMuted,fontSize:14,lineHeight:21,marginTop:8},coachNote:{backgroundColor:colors.surfaceAccent,borderRadius:12,color:colors.accent,fontSize:13,lineHeight:19,marginTop:14,padding:12},experimentRow:{alignItems:'flex-start',borderTopColor:colors.border,borderTopWidth:1,flexDirection:'row',gap:10,paddingVertical:13},experimentCopy:{flex:1},experimentDate:{color:colors.textSubtle,fontSize:10,fontWeight:'700'},experimentBehavior:{color:colors.text,fontSize:13,fontWeight:'700',lineHeight:18,marginTop:3},experimentStatus:{backgroundColor:colors.surfaceRaised,borderRadius:10,color:colors.textMuted,fontSize:10,fontWeight:'800',overflow:'hidden',paddingHorizontal:8,paddingVertical:5},statusComplete:{backgroundColor:colors.successSurface,color:colors.success},statusPartial:{backgroundColor:colors.warningSurface,color:colors.accent},row:{backgroundColor:colors.surface,borderBottomColor:colors.border,borderBottomWidth:1,flexDirection:'row',justifyContent:'space-between',padding:16},rowDate:{color:colors.textMuted,fontWeight:'700'},rowValue:{color:colors.accent,fontWeight:'800'},error:{color:colors.danger,marginTop:12},disclaimer:{color:colors.textSubtle,fontSize:12,lineHeight:18,marginTop:12,textAlign:'center'},setting:{borderBottomColor:colors.border,borderBottomWidth:1,paddingVertical:13},settingLabel:{color:colors.textSubtle,fontSize:12},settingValue:{color:colors.text,fontSize:15,fontWeight:'700',marginTop:3},notificationRow:{alignItems:'center',flexDirection:'row',gap:16},notificationCopy:{flex:1},notificationTitle:{color:colors.text,fontSize:17,fontWeight:'800'},notificationDescription:{color:colors.textMuted,fontSize:13,lineHeight:19,marginTop:4},reminderControls:{alignItems:'center',backgroundColor:colors.surfaceMuted,borderRadius:16,flexDirection:'row',justifyContent:'space-between',marginTop:18,padding:8},timeAdjustButton:{alignItems:'center',backgroundColor:colors.surfaceRaised,borderRadius:12,height:42,justifyContent:'center',width:46},timeAdjustText:{color:colors.accent,fontSize:25,fontWeight:'600'},reminderTime:{color:colors.text,fontSize:20,fontWeight:'800'},notificationError:{color:colors.danger,fontSize:13,lineHeight:18,marginTop:12},sourceButtons:{flexDirection:'row',gap:8,marginTop:16},sourceButton:{alignItems:'center',backgroundColor:colors.surfaceMuted,borderColor:colors.border,borderRadius:13,borderWidth:1,flex:1,padding:12},sourceButtonSelected:{backgroundColor:colors.surfaceAccent,borderColor:colors.accent},sourceButtonText:{color:colors.textMuted,fontSize:13,fontWeight:'800'},sourceButtonTextSelected:{color:colors.accent},button:{alignItems:'center',backgroundColor:colors.surface,borderColor:colors.borderStrong,borderRadius:16,borderWidth:1,marginTop:10,padding:16},buttonText:{color:colors.text,fontSize:15,fontWeight:'800'},dangerButton:{borderColor:colors.danger},dangerText:{color:colors.danger,fontSize:15,fontWeight:'800'},quickStats:{gap:10,marginBottom:26,paddingHorizontal:3},progressStat:{alignItems:'center',flexDirection:'row',gap:9},progressStatDot:{borderRadius:5,height:8,width:8},progressStatText:{color:colors.textMuted,fontSize:13,fontWeight:'700'},journeySection:{marginBottom:22,paddingHorizontal:3},journeyHeader:{alignItems:'center',flexDirection:'row',justifyContent:'space-between'},journeyCount:{color:colors.textSubtle,fontSize:11,fontWeight:'700'},journeyGrid:{flexDirection:'row',flexWrap:'wrap',gap:7,marginTop:10,maxWidth:300},journeySquare:{backgroundColor:colors.surfaceRaised,borderColor:colors.border,borderRadius:4,borderWidth:1,height:22,width:22},journeySquareComplete:{backgroundColor:'#8bc8e8',borderColor:'#a8daf2'},journeySquareFuture:{opacity:.42},dropdown:{borderBottomColor:colors.border,borderBottomWidth:1},dropdownHeader:{alignItems:'center',flexDirection:'row',justifyContent:'space-between',minHeight:58,paddingHorizontal:3},dropdownLabel:{color:colors.text,fontSize:13,fontWeight:'800',letterSpacing:.8},dropdownChevron:{color:colors.textMuted,fontSize:22},dropdownBody:{paddingBottom:10},dropdownEmpty:{color:colors.textSubtle,fontSize:13,lineHeight:19,paddingVertical:12},feelingHistoryRow:{borderTopColor:colors.border,borderTopWidth:1,flexDirection:'row',justifyContent:'space-between',paddingVertical:14}});
Object.assign(s.content, { paddingTop: layout.screenTopPadding });
