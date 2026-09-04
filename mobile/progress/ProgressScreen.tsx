import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { User } from '@supabase/supabase-js';

import { loadSleepProfileSummary } from '../coach/coachRepository';
import { colors, layout } from '../design/theme';
import type { SleepProfile } from '../onboarding/types';
import { loadPreferredSleepSource } from '../sleep/sourcePreference';
import { resolveWearableSleepHistory } from '../sleep/sourceSelection';
import { supabase } from '../supabase';
import { feelingLabel, normalizeMorningFeeling } from '../today/feeling';
import { addDays, experimentInsights, feelingTrend, mergeSleepPoints, rollingDeltas, sleepProfileSummary, weeklyFeeling } from './progressInsights';
import type { ProgressCheckin, ProgressCommitment, SleepPoint } from './progressInsights';

const daysAgo = (count: number) => { const date = new Date(); date.setDate(date.getDate() - count); return localDate(date); };
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateLabel = (date: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`));
const factorLabel = (value: string | null) => value ? value.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase()) : null;

export default function ProgressScreen({ profile, user }: { profile: SleepProfile; user: User }) {
  const [checkins, setCheckins] = useState<ProgressCheckin[]>([]);
  const [commitments, setCommitments] = useState<ProgressCommitment[]>([]);
  const [wearable, setWearable] = useState<SleepPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feelingOpen, setFeelingOpen] = useState(false);
  const [sleepScoreOpen, setSleepScoreOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [aiProfile, setAiProfile] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const [checkinResult, commitmentResult, appleResult, preferred, ouraResult] = await Promise.all([
      supabase.from('daily_checkins').select('checkin_date, morning_feeling, feeling, manual_sleep_score, suspected_factor, note').eq('user_id', user.id).order('checkin_date', { ascending: false }).limit(60),
      supabase.from('behavior_commitments').select('behavior_date, behavior, status').eq('user_id', user.id).order('behavior_date', { ascending: false }).limit(90),
      supabase.from('sleep_nights').select('sleep_date, sleep_score').eq('user_id', user.id).eq('provider', 'apple_health').gte('sleep_date', daysAgo(35)),
      loadPreferredSleepSource(user.id),
      supabase.functions.invoke<{data?: Array<{day:string;score?:number}>}>('oura-proxy', { body: { endpoint: 'daily_sleep', start_date: daysAgo(35), end_date: localDate() } }),
    ]);
    if (checkinResult.error || commitmentResult.error) setError(checkinResult.error?.message ?? commitmentResult.error?.message ?? 'Progress could not be loaded.');
    const normalized = (checkinResult.data ?? []).map(row => ({ checkin_date: row.checkin_date, manual_sleep_score: row.manual_sleep_score, morningFeeling: normalizeMorningFeeling(row.morning_feeling, row.feeling), note: row.note, suspected_factor: row.suspected_factor }));
    const sources: Array<{day:string;score:number;source:'apple_health'|'oura'}> = [];
    (appleResult.data ?? []).forEach(row => { if (typeof row.sleep_score === 'number') sources.push({ day: row.sleep_date, score: row.sleep_score, source: 'apple_health' }); });
    if (!ouraResult.error) (ouraResult.data?.data ?? []).forEach(row => { if (typeof row.score === 'number') sources.push({ day: row.day, score: row.score, source: 'oura' }); });
    setCheckins(normalized); setCommitments(commitmentResult.data ?? []);
    setWearable(resolveWearableSleepHistory(sources, preferred).map(row => ({ date: row.day, score: row.score, source: row.source })));
    setLoading(false);
  }, [user.id]);
  useEffect(() => { void load(); }, [load]);

  const refreshProfile = useCallback(async () => {
    if (profileLoading) return;
    setProfileLoading(true);
    try { setAiProfile(await loadSleepProfileSummary(user, profile)); }
    catch { /* The evidence-based local summary remains available. */ }
    finally { setProfileLoading(false); }
  }, [profile, profileLoading, user]);

  const points = useMemo(() => mergeSleepPoints(checkins, wearable), [checkins, wearable]);
  const deltas = useMemo(() => rollingDeltas(points), [points]);
  const experiments = useMemo(() => experimentInsights(commitments, points), [commitments, points]);
  const energy = useMemo(() => feelingTrend(checkins), [checkins]);
  const weekFeeling = useMemo(() => weeklyFeeling(checkins), [checkins]);
  const recent = points.slice(-7);
  const min = Math.min(...recent.map(point => point.score), 50); const max = Math.max(...recent.map(point => point.score), 100);
  const ledger = deltas.filter(item => item.delta !== null).slice(-14).reverse();
  const completedDates = new Set(checkins.map(row => row.checkin_date));
  const earliestDate = checkins.length ? [...checkins].sort((a, b) => a.checkin_date.localeCompare(b.checkin_date))[0].checkin_date : localDate();
  const journeyDates = Array.from({ length: 30 }, (_, index) => addDays(earliestDate, index));
  const completedCount = journeyDates.filter(date => completedDates.has(date)).length;
  const signalObservation = (date: string, positive: boolean) => {
    const checkin = checkins.find(row => row.checkin_date === date);
    const factor = factorLabel(checkin?.suspected_factor ?? null);
    if (factor) return `${factor} may have contributed.`;
    const note = checkin?.note?.trim().replace(/\s+/g, ' ');
    if (note) {
      const detail = note.split(/[.!?]/)[0].slice(0, 92).replace(/^i\s+/i, '').replace(/^I\s+/, '');
      return `You mentioned ${detail.charAt(0).toLowerCase()}${detail.slice(1)}, which may have contributed.`;
    }
    const priorDate = addDays(date, -1);
    const experiment = commitments.find(item => item.behavior_date === priorDate && (item.status === 'completed' || item.status === 'partial'));
    if (experiment) return `You ${experiment.status === 'completed' ? 'completed' : 'partly completed'} “${experiment.behavior},” which may have ${positive ? 'helped' : 'affected the result differently than expected'}.`;
    return 'Your coach is watching your check-ins and experiments for a repeatable explanation.';
  };

  return <ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.eyebrow}>PROGRESS</Text><Text style={styles.title}>What we’re learning</Text><Text style={styles.subtitle}>Your signals become more useful as patterns repeat.</Text>
    {loading ? <ActivityIndicator color={colors.accent} style={styles.loader}/> : <>
      <View style={styles.journeyCard}>
        <View style={styles.cardHeader}><View><Text style={styles.cardEyebrow}>YOUR 30-DAY JOURNEY</Text><Text style={styles.cardTitle}>Small steps, adding up</Text></View><Text style={styles.average}>{completedCount} of 30</Text></View>
        <View style={styles.journeyGrid}>{journeyDates.map((date, index) => <View accessibilityLabel={`Day ${index + 1}${completedDates.has(date) ? ', check-in complete' : ', no check-in'}`} key={date} style={[styles.journeySquare, completedDates.has(date) && styles.journeySquareComplete, date > localDate() && styles.journeySquareFuture]}/>)}</View>
      </View>

      <Section title="HOW YOU’VE BEEN FEELING THIS WEEK" subtitle="Your seven-day energy pattern" open={feelingOpen} onPress={() => setFeelingOpen(value => !value)}>
        <View style={styles.sectionBody}><Text style={styles.energy}>{weekFeeling.feeling ? feelingLabel(weekFeeling.feeling) : 'Still learning'}</Text><Text style={styles.energyTrend}>{weekFeeling.count ? `Based on ${weekFeeling.count} check-in${weekFeeling.count === 1 ? '' : 's'} · ` : ''}{energy.direction === 'up' ? 'trending better' : energy.direction === 'down' ? 'trending lower' : 'holding steady'}</Text></View>
      </Section>

      <Section title="SLEEP SCORE" subtitle="Past 7 days" open={sleepScoreOpen} onPress={() => setSleepScoreOpen(value => !value)}>
        <View style={styles.sectionBody}><View style={styles.scoreSummary}><Text style={styles.cardTitle}>Seven-night trend</Text><Text style={styles.average}>{recent.length ? Math.round(recent.reduce((sum, p) => sum + p.score, 0) / recent.length) : '—'} avg</Text></View>
          <View style={styles.chart}>{recent.length ? recent.map(point => <View key={point.date} style={styles.chartColumn}><View style={[styles.bar, { height: 18 + ((point.score - min) / Math.max(1, max - min)) * 72 }, point.source === 'manual' && styles.manualBar]}/><Text style={styles.chartScore}>{Math.round(point.score)}</Text><Text style={styles.chartDate}>{dateLabel(point.date).split(' ')[1]}</Text></View>) : <Text style={styles.empty}>Sleep scores will create your trend line.</Text>}</View>
          <View style={styles.legend}><View style={styles.legendDot}/><Text style={styles.legendText}>Wearable</Text><View style={[styles.legendDot, styles.manualDot]}/><Text style={styles.legendText}>Manual</Text></View>
        </View>
      </Section>

      <Section title="YOUR SLEEP PROFILE" subtitle="A picture of you, built day by day" open={profileOpen} onPress={() => { const next = !profileOpen; setProfileOpen(next); if (next) void refreshProfile(); }}>
        <View style={styles.profileBody}>
          <Text style={styles.profileTitle}>What your coach is learning about you</Text>
          {profileLoading && !aiProfile ? <View style={styles.profileLoading}><ActivityIndicator color={colors.accent} size="small"/><Text style={styles.profileLoadingText}>Connecting your scores, notes, and memories…</Text></View> : <Text style={styles.profileCopy}>{aiProfile ?? sleepProfileSummary(checkins, experiments, points)}</Text>}
          {!!aiProfile && <Text style={styles.profileUpdated}>Updated from your latest sleep data, check-ins, experiments, and coaching memory.</Text>}
        </View>
      </Section>

      <Section title="SLEEP SIGNALS" subtitle="What changed—and what may be moving the needle" open={ledgerOpen} onPress={() => setLedgerOpen(value => !value)}>{ledger.length ? ledger.map(item => { const positive = item.delta! >= 0; return <View key={item.date} style={styles.ledgerRow}><Text style={[styles.delta, positive ? styles.positive : styles.negative]}>{positive ? '+' : '−'}{Math.abs(item.delta!)}</Text><View style={styles.ledgerCopy}><Text style={styles.ledgerTitle}>Your sleep trended {positive ? 'up' : 'down'} last night</Text><Text style={styles.ledgerNote}>{signalObservation(item.date, positive)}</Text><Text style={styles.ledgerDate}>{dateLabel(item.date)} · vs {item.comparison}</Text></View></View>; }) : <Text style={styles.empty}>{points.length === 1 ? 'Day 1 establishes your starting point. Your first signal will appear after the next sleep score.' : 'Add two sleep scores to begin your signal ledger.'}</Text>}</Section>
    </>}
    {!!error && <Text style={styles.error}>{error}</Text>}
  </ScrollView>;
}

function Section({children,onPress,open,subtitle,title}:{children:React.ReactNode;onPress:()=>void;open:boolean;subtitle:string;title:string}) { return <View style={styles.section}><Pressable accessibilityRole="button" accessibilityState={{expanded:open}} onPress={onPress} style={styles.sectionHeader}><View style={styles.sectionHeading}><Text style={styles.cardEyebrow}>{title}</Text><Text style={styles.sectionSubtitle}>{subtitle}</Text></View><Text style={styles.chevron}>{open ? '⌃' : '⌄'}</Text></Pressable>{open && <View>{children}</View>}</View>; }

const amber = '#e0ae67';
const styles = StyleSheet.create({
  content:{paddingBottom:48,paddingHorizontal:22,paddingTop:layout.screenTopPadding},eyebrow:{color:colors.accent,fontSize:11,fontWeight:'800',letterSpacing:1.6},title:{color:colors.text,fontSize:32,fontWeight:'800',letterSpacing:-.8,marginTop:10},subtitle:{color:colors.textMuted,fontSize:15,lineHeight:22,marginBottom:24,marginTop:9},loader:{marginTop:50},
  cardEyebrow:{color:colors.accent,fontSize:10,fontWeight:'800',letterSpacing:1.4},energy:{color:colors.text,fontSize:32,fontWeight:'800',letterSpacing:-.8},energyTrend:{color:colors.textMuted,fontSize:13,marginTop:7},cardHeader:{alignItems:'flex-start',flexDirection:'row',justifyContent:'space-between'},cardTitle:{color:colors.text,fontSize:16,fontWeight:'800'},average:{color:colors.accentSoft,fontSize:13,fontWeight:'700'},scoreSummary:{alignItems:'center',flexDirection:'row',justifyContent:'space-between'},sectionBody:{borderTopColor:colors.border,borderTopWidth:1,padding:18},
  chart:{alignItems:'flex-end',flexDirection:'row',gap:7,height:134,marginTop:17},chartColumn:{alignItems:'center',flex:1,justifyContent:'flex-end'},bar:{backgroundColor:colors.accentStrong,borderRadius:6,minHeight:18,width:'72%'},manualBar:{backgroundColor:colors.accentSoft,borderColor:colors.accentStrong,borderWidth:1},chartScore:{color:colors.textMuted,fontSize:9,fontWeight:'700',marginTop:5},chartDate:{color:colors.textFaint,fontSize:9,marginTop:2},legend:{alignItems:'center',flexDirection:'row',gap:6,justifyContent:'flex-end',marginTop:12},legendDot:{backgroundColor:colors.accentStrong,borderRadius:3,height:6,width:6},manualDot:{backgroundColor:colors.accentSoft},legendText:{color:colors.textFaint,fontSize:9,marginRight:5},
  journeyCard:{backgroundColor:colors.surface,borderColor:colors.border,borderRadius:22,borderWidth:1,marginBottom:14,padding:18},journeyGrid:{flexDirection:'row',flexWrap:'wrap',gap:7,marginTop:18,maxWidth:283},journeySquare:{backgroundColor:colors.surfaceRaised,borderColor:colors.border,borderRadius:4,borderWidth:1,height:22,width:22},journeySquareComplete:{backgroundColor:colors.accentStrong,borderColor:colors.accent},journeySquareFuture:{opacity:.36},profileBody:{borderTopColor:colors.border,borderTopWidth:1,padding:18},profileTitle:{color:colors.text,fontSize:17,fontWeight:'800',lineHeight:23},profileCopy:{color:colors.textMuted,fontSize:14,lineHeight:22,marginTop:10},profileLoading:{alignItems:'center',flexDirection:'row',gap:10,marginTop:14},profileLoadingText:{color:colors.textSubtle,fontSize:12},profileUpdated:{color:colors.textFaint,fontSize:10,lineHeight:16,marginTop:14},section:{backgroundColor:colors.surface,borderColor:colors.border,borderRadius:20,borderWidth:1,marginBottom:14,overflow:'hidden'},sectionHeader:{alignItems:'center',flexDirection:'row',padding:18},sectionHeading:{flex:1},sectionSubtitle:{color:colors.textSubtle,fontSize:11,lineHeight:17,marginTop:5},chevron:{color:colors.textMuted,fontSize:20},ledgerRow:{borderTopColor:colors.border,borderTopWidth:1,flexDirection:'row',padding:17},delta:{fontSize:24,fontWeight:'800',letterSpacing:-.5,minWidth:52},positive:{color:colors.accentStrong},negative:{color:amber},ledgerCopy:{flex:1},ledgerTitle:{color:colors.text,fontSize:14,fontWeight:'700'},ledgerNote:{color:colors.textMuted,fontSize:12,lineHeight:18,marginTop:4},ledgerDate:{color:colors.textFaint,fontSize:10,marginTop:7},experiment:{borderTopColor:colors.border,borderTopWidth:1,padding:17},experimentHeader:{alignItems:'flex-start',gap:10},experimentTitle:{color:colors.text,fontSize:14,fontWeight:'700',lineHeight:20},verdict:{color:colors.textSubtle,fontSize:10,fontWeight:'800',textTransform:'uppercase'},helpful:{color:colors.success},experimentMeta:{color:colors.textSubtle,fontSize:11,lineHeight:17,marginTop:8},empty:{color:colors.textSubtle,fontSize:13,lineHeight:20,padding:18},error:{color:colors.danger,fontSize:12,lineHeight:18,marginTop:8}
});
