import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { OnboardingDraft, PrimaryConcern } from './types';

type Props = { initialName?: string; onComplete: (draft: OnboardingDraft) => Promise<void> };

const concerns: { key: PrimaryConcern; label: string; detail: string }[] = [
  { key: 'falling_asleep', label: 'Falling asleep', detail: 'My mind or body will not settle.' },
  { key: 'staying_asleep', label: 'Staying asleep', detail: 'I wake during the night.' },
  { key: 'waking_tired', label: 'Waking refreshed', detail: 'I sleep, but still feel depleted.' },
  { key: 'schedule', label: 'A steadier schedule', detail: 'My timing changes too much.' },
  { key: 'stress', label: 'Stress and recovery', detail: 'Stress follows me into the night.' },
];

export default function OnboardingScreen({ initialName = '', onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState(initialName);
  const [primaryConcern, setPrimaryConcern] = useState<PrimaryConcern | null>(null);
  const [bedtime, setBedtime] = useState('22:30');
  const [wakeTime, setWakeTime] = useState('06:30');
  const [goal, setGoal] = useState('');
  const [safetyConcern, setSafetyConcern] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canContinue = step !== 1 || primaryConcern !== null;
  const finish = async () => {
    if (!primaryConcern) return;
    setBusy(true); setError('');
    try {
      await onComplete({ displayName, primaryConcern, typicalBedtime: bedtime, typicalWakeTime: wakeTime, goal, safetyConcern, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : typeof cause === 'object' && cause && 'message' in cause && typeof cause.message === 'string'
            ? cause.message
            : 'We could not save your profile.';
      console.error('Onboarding profile save failed', cause);
      setError(message);
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>30 DAY SLEEP COACH</Text>
        <Text style={styles.progress}>STEP {step + 1} OF 4</Text>
        {step === 0 && <View><Text style={styles.title}>Let’s make this personal.</Text><Text style={styles.copy}>We’ll use a few basics to shape your daily coaching.</Text><Text style={styles.label}>What should we call you?</Text><TextInput autoFocus onChangeText={setDisplayName} placeholder="First name" placeholderTextColor="#8d899d" style={styles.input} value={displayName} /></View>}
        {step === 1 && <View><Text style={styles.title}>What would you most like to improve?</Text><Text style={styles.copy}>Choose the one that feels most important right now.</Text>{concerns.map((item) => <Pressable key={item.key} onPress={() => setPrimaryConcern(item.key)} style={[styles.choice, primaryConcern === item.key && styles.choiceSelected]}><Text style={[styles.choiceTitle, primaryConcern === item.key && styles.choiceTitleSelected]}>{item.label}</Text><Text style={styles.choiceDetail}>{item.detail}</Text></Pressable>)}</View>}
        {step === 2 && <View><Text style={styles.title}>Your usual rhythm</Text><Text style={styles.copy}>Approximate times are perfect. You can enter 10:30 PM or 22:30.</Text><Text style={styles.label}>Typical bedtime</Text><TextInput keyboardType="numbers-and-punctuation" onChangeText={setBedtime} style={styles.input} value={bedtime} /><Text style={styles.label}>Typical wake time</Text><TextInput keyboardType="numbers-and-punctuation" onChangeText={setWakeTime} style={styles.input} value={wakeTime} /><Text style={styles.label}>What would better sleep help you do?</Text><TextInput multiline onChangeText={setGoal} placeholder="More energy, calmer mornings…" placeholderTextColor="#8d899d" style={[styles.input, styles.textarea]} value={goal} /></View>}
        {step === 3 && <View><Text style={styles.title}>One important check</Text><Text style={styles.copy}>This app provides educational coaching, not medical care.</Text><Pressable onPress={() => setSafetyConcern(!safetyConcern)} style={[styles.choice, safetyConcern && styles.choiceSelected]}><Text style={[styles.choiceTitle, safetyConcern && styles.choiceTitleSelected]}>{safetyConcern ? '✓ ' : ''}I have concerning symptoms</Text><Text style={styles.choiceDetail}>For example: gasping or choking during sleep, dangerous daytime sleepiness, or another urgent concern.</Text></Pressable>{safetyConcern && <View style={styles.notice}><Text style={styles.noticeText}>Please talk with a qualified healthcare professional. Seek urgent help if you may be in immediate danger.</Text></View>}<Text style={styles.summary}>You’ll start with one small daily check-in and one focused experiment at a time.</Text></View>}
        {!!error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.actions}>{step > 0 && <Pressable disabled={busy} onPress={() => setStep(step - 1)} style={styles.back}><Text style={styles.backText}>Back</Text></Pressable>}<Pressable disabled={!canContinue || busy} onPress={() => step === 3 ? void finish() : setStep(step + 1)} style={[styles.next, (!canContinue || busy) && styles.disabled]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.nextText}>{step === 3 ? 'Start my plan' : 'Continue'}</Text>}</Pressable></View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({ screen:{flex:1,backgroundColor:'#fafafa'},content:{padding:24,paddingBottom:48,paddingTop:64},brand:{color:'#4f7cff',fontSize:12,fontWeight:'800',letterSpacing:1.8},progress:{color:'#85808e',fontSize:11,fontWeight:'700',marginBottom:20,marginTop:28},title:{color:'#24212d',fontSize:32,fontWeight:'800',letterSpacing:-.8,lineHeight:38},copy:{color:'#716d7d',fontSize:16,lineHeight:24,marginBottom:26,marginTop:10},label:{color:'#34303c',fontSize:14,fontWeight:'700',marginBottom:8},input:{backgroundColor:'#fff',borderColor:'#e4e0e8',borderRadius:16,borderWidth:1,color:'#24212d',fontSize:17,marginBottom:20,padding:16},textarea:{minHeight:92,textAlignVertical:'top'},choice:{backgroundColor:'#fff',borderColor:'#e4e0e8',borderRadius:18,borderWidth:1,marginBottom:10,padding:16},choiceSelected:{backgroundColor:'#f0f4ff',borderColor:'#4f7cff'},choiceTitle:{color:'#34303c',fontSize:16,fontWeight:'800'},choiceTitleSelected:{color:'#3d6ae8'},choiceDetail:{color:'#777280',fontSize:13,lineHeight:19,marginTop:4},notice:{backgroundColor:'#fff3df',borderRadius:14,marginTop:8,padding:14},noticeText:{color:'#705126',fontSize:13,lineHeight:19},summary:{color:'#5e5968',fontSize:15,lineHeight:23,marginTop:24},actions:{flexDirection:'row',gap:12,marginTop:28},back:{alignItems:'center',borderColor:'#dcd7e2',borderRadius:16,borderWidth:1,justifyContent:'center',paddingHorizontal:22},backText:{color:'#514d59',fontSize:16,fontWeight:'700'},next:{alignItems:'center',backgroundColor:'#4f7cff',borderRadius:16,flex:1,justifyContent:'center',minHeight:54},nextText:{color:'#fff',fontSize:16,fontWeight:'800'},disabled:{opacity:.45},error:{color:'#a53434',fontSize:13,marginTop:16} });
