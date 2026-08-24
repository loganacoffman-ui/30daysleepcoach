import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { User } from '@supabase/supabase-js';

import { getStarterExperiment } from '../coaching/experiments';
import { colors } from '../design/theme';
import type { SleepProfile } from '../onboarding/types';
import { loadDailyCoaching } from './coachRepository';
import type { DailyCoaching } from './coachRepository';

const concernLabels: Record<string,string> = { falling_asleep:'Falling asleep with less effort', night_waking:'Sleeping more continuously', early_waking:'Extending sleep through the morning', unrefreshed:'Waking more restored', irregular_schedule:'Building a steadier rhythm' };

const Section = ({ label, text, animation, action = false }: { label: string; text: string; animation: Animated.Value; action?: boolean }) => (
  <Animated.View style={{ opacity: animation, transform: [{ translateY: animation.interpolate({ inputRange:[0,1], outputRange:[18,0] }) }] }}>
    <Text style={styles.sectionLabel}>{label}</Text>
    <Text style={[styles.sectionText, action && styles.actionText]}>{text}</Text>
  </Animated.View>
);

export default function CoachScreen({ user, profile }: { user: User; profile: SleepProfile }) {
  const starter = useMemo(() => getStarterExperiment(profile.primaryConcern), [profile.primaryConcern]);
  const [coaching, setCoaching] = useState<DailyCoaching | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const animations = useRef(Array.from({ length: 6 }, () => new Animated.Value(0))).current;

  const reveal = () => {
    animations.forEach(value => value.setValue(0));
    Animated.stagger(260, animations.map(value => Animated.timing(value, { duration:780, easing:Easing.out(Easing.cubic), toValue:1, useNativeDriver:true }))).start();
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await loadDailyCoaching(user, profile);
      setCoaching(result);
      requestAnimationFrame(reveal);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Your coach is taking a moment.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [user.id, profile.primaryConcern]);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Animated.View style={{ opacity: animations[0] }}>
        <Text style={styles.eyebrow}>TODAY’S COACHING</Text>
        <View style={styles.focusRow}><View style={styles.focusLine} /><View><Text style={styles.focusLabel}>YOUR STARTING FOCUS</Text><Text style={styles.focusText}>{concernLabels[profile.primaryConcern]}</Text></View></View>
      </Animated.View>

      {loading && <View style={styles.loading}><ActivityIndicator color={colors.accent} /><Text style={styles.loadingText}>Reading your recent signals…</Text></View>}

      {!loading && coaching && <View style={styles.coaching}>
        <Section animation={animations[1]} label="WHAT I’M NOTICING" text={coaching.pattern} />
        <Section animation={animations[2]} label="WHAT IT MAY MEAN" text={coaching.meaning} />
        <Section action animation={animations[3]} label="TONIGHT’S ONE MOVE" text={coaching.action} />
        <Section animation={animations[4]} label="WHY THIS, NOW" text={coaching.why} />
        <Animated.View style={{opacity:animations[5]}}><Text style={styles.timestamp}>Prepared for today · Reopens without regenerating</Text><Text style={styles.disclaimer}>Educational coaching only—not medical advice, diagnosis, or treatment.</Text></Animated.View>
      </View>}

      {!loading && !coaching && <View style={styles.fallback}>
        <Text style={styles.sectionLabel}>TONIGHT’S ONE MOVE</Text><Text style={styles.actionText}>{starter.behavior}</Text><Text style={styles.sectionText}>{starter.why}</Text>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Try your coach again</Text></Pressable>
      </View>}
    </ScrollView>
  );
}

const styles=StyleSheet.create({actionText:{color:colors.text,fontSize:28,fontWeight:'700',letterSpacing:-.7,lineHeight:37},coaching:{gap:34,marginTop:42},content:{backgroundColor:colors.canvas,flexGrow:1,paddingBottom:56,paddingHorizontal:26,paddingTop:64},disclaimer:{color:colors.textFaint,fontSize:11,lineHeight:17,marginTop:16},error:{color:colors.danger,fontSize:13,lineHeight:19,marginTop:18},eyebrow:{color:colors.accentSoft,fontSize:11,fontWeight:'800',letterSpacing:1.8},fallback:{backgroundColor:colors.surface, borderColor:colors.border, borderRadius:22, borderWidth:1, marginTop:42, padding:22},focusLabel:{color:colors.textSubtle,fontSize:10,fontWeight:'800',letterSpacing:1.2},focusLine:{backgroundColor:colors.accent,borderRadius:2,height:38,width:3},focusRow:{alignItems:'center',backgroundColor:colors.surface,borderColor:colors.border,borderRadius:18,borderWidth:1,flexDirection:'row',gap:13,marginTop:22,padding:16},focusText:{color:colors.text,fontSize:16,fontWeight:'700',marginTop:4},loading:{alignItems:'center',gap:14,marginTop:100},loadingText:{color:colors.textSubtle,fontSize:14},retry:{alignSelf:'flex-start',borderBottomColor:colors.accent,borderBottomWidth:1,marginTop:24,paddingBottom:3},retryText:{color:colors.accent,fontSize:14,fontWeight:'700'},sectionLabel:{color:colors.accentSoft,fontSize:10,fontWeight:'800',letterSpacing:1.45,marginBottom:11},sectionText:{color:colors.textMuted,fontSize:18,lineHeight:29},timestamp:{color:colors.textSubtle,fontSize:11},
});
