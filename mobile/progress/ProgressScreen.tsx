import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { User } from '@supabase/supabase-js';

import { checkinRevision, subscribeToCheckins } from '../cache/checkinRevision';
import { screenCache } from '../cache/screenCache';
import { loadSleepProfileSummary, loadStoredDailyCoaching, type DailyCoaching } from '../coach/coachRepository';
import { plainCoachText } from '../coach/ChatBubble';
import { Skeleton, SkeletonLines } from '../design/Skeleton';
import { colors, layout } from '../design/theme';
import type { SleepProfile } from '../onboarding/types';
import { loadPreferredSleepSource } from '../sleep/sourcePreference';
import { resolveWearableSleepHistory } from '../sleep/sourceSelection';
import { supabase } from '../supabase';
import { normalizeMorningFeeling } from '../today/feeling';
import { addDays, experimentInsights, mergeSleepPoints, rankSleepSignals, rollingDeltas, sleepProfileSummary } from './progressInsights';
import type { ProgressCheckin, ProgressCommitment, SleepPoint } from './progressInsights';
import { journeyEntries, type JourneyCheckin } from './journey';

const daysAgo = (count: number) => { const date = new Date(); date.setDate(date.getDate() - count); return localDate(date); };
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateLabel = (date: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`));
const factorLabel = (value: string | null) => value ? value.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase()) : null;

const PROGRESS_CACHE_NAME = 'progress';
const PROFILE_CACHE_NAME = 'sleep-profile-summary';
// Bump either version when its cached shape changes so a released build never
// renders an entry it can no longer read.
const PROGRESS_CACHE_VERSION = 1;
const PROFILE_CACHE_VERSION = 1;
// A tab switch inside this window reuses what is on screen rather than refetching.
const PROGRESS_REFRESH_INTERVAL_MS = 120_000;

type CachedProgress = {
  checkins: ProgressCheckin[];
  commitments: ProgressCommitment[];
  wearable: SleepPoint[];
  journey: JourneyCheckin[];
};

export default function ProgressScreen({ active = true, profile, refreshRequest, user }: {
  active?: boolean;
  profile: SleepProfile;
  refreshRequest?: number;
  user: User;
}) {
  const [checkins, setCheckins] = useState<ProgressCheckin[]>([]);
  const [commitments, setCommitments] = useState<ProgressCommitment[]>([]);
  const [wearable, setWearable] = useState<SleepPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sleepScoreOpen, setSleepScoreOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [aiProfile, setAiProfile] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [journey, setJourney] = useState<JourneyCheckin[]>([]);
  const [journeyError, setJourneyError] = useState('');
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const lastLoadedAt = useRef(0);
  const profileLoadingRef = useRef(false);

  const load = useCallback(async () => {
    if (!lastLoadedAt.current) setError('');
    lastLoadedAt.current = Date.now();
    const [checkinResult, commitmentResult, appleResult, preferred, ouraResult, journeyResult] = await Promise.all([
      supabase.from('daily_checkins').select('checkin_date, morning_feeling, feeling, manual_sleep_score, suspected_factor, note').eq('user_id', user.id).order('checkin_date', { ascending: false }).limit(60),
      supabase.from('behavior_commitments').select('behavior_date, behavior, status').eq('user_id', user.id).order('behavior_date', { ascending: false }).limit(90),
      supabase.from('sleep_nights').select('sleep_date, sleep_score').eq('user_id', user.id).eq('provider', 'apple_health').gte('sleep_date', daysAgo(35)),
      loadPreferredSleepSource(user.id),
      supabase.functions.invoke<{data?: Array<{day:string;score?:number}>}>('oura-proxy', { body: { endpoint: 'daily_sleep', start_date: daysAgo(35), end_date: localDate() } }),
      supabase.from('daily_checkins').select('checkin_date, completed_at, manual_sleep_score').eq('user_id', user.id).not('completed_at', 'is', null).order('checkin_date', { ascending: true }).limit(30),
    ]);
    setJourneyError(journeyResult.error ? 'Your journey could not be loaded. Please try again.' : '');
    const nextJourney = journeyEntries(journeyResult.data ?? []);
    setJourney(nextJourney);
    if (checkinResult.error || commitmentResult.error) setError(checkinResult.error?.message ?? commitmentResult.error?.message ?? 'Progress could not be loaded.');
    else setError('');
    const normalized = (checkinResult.data ?? []).map(row => ({ checkin_date: row.checkin_date, manual_sleep_score: row.manual_sleep_score, morningFeeling: normalizeMorningFeeling(row.morning_feeling, row.feeling), note: row.note, suspected_factor: row.suspected_factor }));
    const sources: Array<{day:string;score:number;source:'apple_health'|'oura'}> = [];
    (appleResult.data ?? []).forEach(row => { if (typeof row.sleep_score === 'number') sources.push({ day: row.sleep_date, score: row.sleep_score, source: 'apple_health' }); });
    if (!ouraResult.error) (ouraResult.data?.data ?? []).forEach(row => { if (typeof row.score === 'number') sources.push({ day: row.day, score: row.score, source: 'oura' }); });
    const nextCommitments = commitmentResult.data ?? [];
    const nextWearable = resolveWearableSleepHistory(sources, preferred).map(row => ({ date: row.day, score: row.score, source: row.source }));
    setCheckins(normalized); setCommitments(nextCommitments); setWearable(nextWearable);
    setLoading(false);
    void screenCache.write(user.id, PROGRESS_CACHE_NAME, PROGRESS_CACHE_VERSION, {
      checkins: normalized, commitments: nextCommitments, wearable: nextWearable, journey: nextJourney,
    } satisfies CachedProgress).catch(() => undefined);
  }, [user.id]);

  // Last session's charts and journey paint first, so opening Progress shows the
  // page it had rather than a spinner over an empty screen.
  useEffect(() => {
    let mounted = true;
    void Promise.all([
      screenCache.read<CachedProgress>(user.id, PROGRESS_CACHE_NAME, PROGRESS_CACHE_VERSION),
      screenCache.read<string>(user.id, PROFILE_CACHE_NAME, PROFILE_CACHE_VERSION),
    ]).then(([progressEntry, profileEntry]) => {
      if (!mounted) return;
      if (progressEntry?.value) {
        const cached = progressEntry.value;
        setCheckins(current => current.length ? current : cached.checkins ?? []);
        setCommitments(current => current.length ? current : cached.commitments ?? []);
        setWearable(current => current.length ? current : cached.wearable ?? []);
        setJourney(current => current.length ? current : cached.journey ?? []);
        setLoading(false);
      }
      if (profileEntry?.value) setAiProfile(current => current ?? profileEntry.value);
    }).catch(() => undefined);
    void load();
    return () => { mounted = false; };
  }, [load, user.id]);

  // A check-in saved on the Coach tab is exactly the meaningful update this
  // screen is built from, so it marks the loaded data stale rather than waiting
  // for the throttle below to expire.
  const [checkinStamp, setCheckinStamp] = useState(checkinRevision);
  useEffect(() => subscribeToCheckins(() => setCheckinStamp(checkinRevision())), []);

  // Returning to the tab refreshes underneath the visible page, and only when
  // the data is old enough to be worth another round of requests. A bumped
  // refreshRequest means a night was just synced, so that one is never throttled.
  const handledSignals = useRef(`${refreshRequest}:${checkinStamp}`);
  useEffect(() => {
    if (!active) return;
    const signals = `${refreshRequest}:${checkinStamp}`;
    const requested = signals !== handledSignals.current;
    handledSignals.current = signals;
    if (!requested && Date.now() - lastLoadedAt.current < PROGRESS_REFRESH_INTERVAL_MS) return;
    void load();
  }, [active, checkinStamp, load, refreshRequest]);

  // The server returns its stored summary until the underlying check-ins,
  // experiments, or wearable nights change, so this is a cache read on most
  // visits and a regeneration only after the day's check-in adds something new.
  const refreshProfile = useCallback(async (options: { refresh?: boolean } = {}) => {
    if (profileLoadingRef.current) return;
    profileLoadingRef.current = true;
    setProfileLoading(true);
    setProfileError('');
    try {
      const result = await loadSleepProfileSummary(user, profile, options);
      setAiProfile(result.summary);
      void screenCache.write(user.id, PROFILE_CACHE_NAME, PROFILE_CACHE_VERSION, result.summary).catch(() => undefined);
    } catch {
      // The previous summary stays readable; only the update is reported lost.
      setProfileError('Your sleep profile could not be updated just now.');
    } finally {
      profileLoadingRef.current = false;
      setProfileLoading(false);
    }
  }, [profile, user]);

  // The evidence the summary is written from. Today's check-in, an edited answer,
  // or a newly synced night changes this, which is exactly when the profile is
  // worth rebuilding; reopening the section on unchanged data is not. The latest
  // rows carry the answers too, because a second check-in on a day that already
  // has a row would otherwise leave the counts and dates untouched.
  const latestCheckin = checkins[0];
  const latestNight = wearable[wearable.length - 1];
  const profileEvidence = [
    checkins.length,
    latestCheckin?.checkin_date ?? '',
    latestCheckin?.morningFeeling ?? '',
    latestCheckin?.manual_sleep_score ?? '',
    latestCheckin?.suspected_factor ?? '',
    latestCheckin?.note ?? '',
    wearable.length,
    latestNight?.date ?? '',
    latestNight?.score ?? '',
  ].join('|');
  const requestedEvidence = useRef<string | null>(null);
  useEffect(() => {
    if (!profileOpen || !checkins.length) return;
    if (requestedEvidence.current === profileEvidence) return;
    requestedEvidence.current = profileEvidence;
    void refreshProfile();
  }, [checkins.length, profileEvidence, profileOpen, refreshProfile]);

  const points = useMemo(() => mergeSleepPoints(checkins, wearable), [checkins, wearable]);
  const deltas = useMemo(() => rollingDeltas(points), [points]);
  const experiments = useMemo(() => experimentInsights(commitments, points), [commitments, points]);
  const recent = points.slice(-7);
  const min = Math.min(...recent.map(point => point.score), 50); const max = Math.max(...recent.map(point => point.score), 100);
  const ledger = deltas.filter(item => item.delta !== null).slice(-14).reverse();
  const rankedSignals = useMemo(() => rankSleepSignals(checkins, commitments, points), [checkins, commitments, points]);
  const visibleLedger = historyExpanded ? ledger : ledger.slice(0, 3);
  const selectedEntry = selectedDay === null ? undefined : journey[selectedDay];
  const selectedScore = selectedEntry ? points.find(point => point.date === selectedEntry.checkin_date)?.score ?? selectedEntry.manual_sleep_score : null;
  const selectedExperiment = selectedEntry ? commitments.find(item => item.behavior_date === selectedEntry.checkin_date) : undefined;
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
    {loading ? <ProgressSkeleton/> : <>
      <View style={styles.journeyCard}>
        <View style={styles.cardHeader}><View><Text style={styles.cardEyebrow}>Your 30 Day Journey</Text><Text style={styles.cardTitle}>Small steps, adding up</Text></View><Text style={styles.average}>{journeyError ? '—' : `${journey.length} of 30`}</Text></View>
        {journeyError ? <Pressable accessibilityRole="button" onPress={() => void load()}><Text style={styles.error}>{journeyError}</Text></Pressable> : <>
          <Text style={styles.sectionSubtitle}>{journey.length === 30 ? '30 check-ins complete. Keep checking in to continue learning.' : `${journey.length} of 30 check-ins · Go at your pace.`}{journey[0] ? ` Started ${dateLabel(journey[0].checkin_date)}.` : ''}</Text>
          <View style={styles.journeyGrid}>{Array.from({ length: 30 }, (_, index) => {
            const entry = journey[index];
            return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !entry, selected: selectedDay === index }} disabled={!entry} accessibilityLabel={`Check-in ${index + 1}${entry ? `, ${entry.checkin_date}, complete. Show details` : ', still to come'}`} key={index} onPress={() => setSelectedDay(current => current === index ? null : index)} style={[styles.journeySquare, entry ? styles.journeySquareComplete : styles.journeySquareFuture, selectedDay === index && { borderColor: colors.text, borderWidth: 2 }]}/>;
          })}</View>
          {selectedEntry && <View style={{ marginTop: 14 }}>
            <Text style={styles.cardTitle}>Check-in {selectedDay! + 1} · {selectedEntry.checkin_date}</Text>
            <Text style={styles.profileCopy}>{selectedScore == null ? 'Sleep score unavailable in loaded history.' : `Sleep score: ${selectedScore}`}</Text>
            <Text style={styles.profileCopy}>{selectedExperiment ? `That night’s experiment: ${selectedExperiment.behavior}` : 'No experiment available in loaded history.'}</Text>
            <CheckinCoaching key={`${user.id}:${selectedEntry.checkin_date}`} userId={user.id} date={selectedEntry.checkin_date}/>
          </View>}
        </>}
      </View>

      <Section title="SLEEP SCORE" subtitle="Past 7 days" open={sleepScoreOpen} onPress={() => setSleepScoreOpen(value => !value)}>
        <View style={styles.sectionBody}><View style={styles.scoreSummary}><Text style={styles.cardTitle}>Seven-night trend</Text><Text style={styles.average}>{recent.length ? Math.round(recent.reduce((sum, p) => sum + p.score, 0) / recent.length) : '—'} avg</Text></View>
          <View style={styles.chart}>{recent.length ? recent.map(point => <View key={point.date} style={styles.chartColumn}><View style={[styles.bar, { height: 18 + ((point.score - min) / Math.max(1, max - min)) * 72 }, point.source === 'manual' && styles.manualBar]}/><Text style={styles.chartScore}>{Math.round(point.score)}</Text><Text style={styles.chartDate}>{dateLabel(point.date).split(' ')[1]}</Text></View>) : <Text style={styles.empty}>Sleep scores will create your trend line.</Text>}</View>
          <View style={styles.legend}><View style={styles.legendDot}/><Text style={styles.legendText}>Wearable</Text><View style={[styles.legendDot, styles.manualDot]}/><Text style={styles.legendText}>Manual</Text></View>
        </View>
      </Section>

      <Section title="YOUR SLEEP PROFILE" subtitle="A picture of you, built day by day" open={profileOpen} onPress={() => setProfileOpen(value => !value)}>
        <View style={styles.profileBody}>
          <Text style={styles.profileTitle}>What your coach is learning about you</Text>
          {/* The stored summary stays on screen while a newer one is written, so
              expanding this never trades readable text for a spinner. */}
          {aiProfile
            ? <Text style={styles.profileCopy}>{aiProfile}</Text>
            : profileLoading
              ? <View style={styles.profileSkeleton}><SkeletonLines count={3}/></View>
              : <Text style={styles.profileCopy}>{sleepProfileSummary(checkins, experiments, points)}</Text>}
          <View style={styles.profileFooter}>
            {!!aiProfile && <Text style={styles.profileUpdated}>{profileLoading
              ? 'Rereading your latest sleep data, check-ins, experiments, and coaching memory…'
              : 'Updated from your latest sleep data, check-ins, experiments, and coaching memory.'}</Text>}
            <Pressable
              accessibilityLabel="Rebuild your sleep profile"
              accessibilityRole="button"
              disabled={profileLoading}
              hitSlop={10}
              onPress={() => void refreshProfile({ refresh: true })}
              style={({ pressed }) => [styles.regenerate, pressed && styles.regeneratePressed]}
            >
              {profileLoading
                ? <ActivityIndicator color={colors.textFaint} size="small"/>
                : <Text style={styles.regenerateIcon}>↻</Text>}
            </Pressable>
          </View>
          {!!profileError && <Text style={styles.error}>{profileError}</Text>}
        </View>
      </Section>

    </>}
    {!!error && <Text style={styles.error}>{error}</Text>}
  </ScrollView>;
}

function CheckinCoaching({ userId, date }: { userId: string; date: string }) {
  const [coaching, setCoaching] = useState<DailyCoaching | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    void loadStoredDailyCoaching(userId, date)
      .then(report => { if (active) setCoaching(report); })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, date, userId]);

  return <View style={{ marginTop: 18 }}>
    <Text style={styles.cardEyebrow}>COACHING ADVICE</Text>
    {loading ? <View style={styles.profileSkeleton}><SkeletonLines count={3}/></View>
      : failed ? <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)}>
        <Text style={styles.error}>Coaching advice could not be loaded. Tap to try again.</Text>
      </Pressable>
      : coaching ? <Text style={styles.profileCopy}>{plainCoachText([
        coaching.pattern, coaching.meaning, `Tonight: ${coaching.action}`, coaching.why,
      ].filter(Boolean).join('\n\n'))}</Text>
      : <Text style={styles.profileCopy}>No coaching advice was saved for this day.</Text>}
  </View>;
}

function Section({children,onPress,open,subtitle,title}:{children:React.ReactNode;onPress:()=>void;open:boolean;subtitle:string;title:string}) { return <View style={styles.section}><Pressable accessibilityRole="button" accessibilityState={{expanded:open}} onPress={onPress} style={styles.sectionHeader}><View style={styles.sectionHeading}><Text style={styles.cardEyebrow}>{title}</Text><Text style={styles.sectionSubtitle}>{subtitle}</Text></View><Text style={styles.chevron}>{open ? '⌃' : '⌄'}</Text></Pressable>{open && <View>{children}</View>}</View>; }

// The real page arrives already laid out on a first ever load: journey card,
// then the collapsed sections, so nothing jumps when the data lands.
function ProgressSkeleton() {
  return <View accessibilityLabel="Loading your progress" accessible>
    <View style={styles.journeyCard}>
      <View style={styles.cardHeader}><View style={styles.skeletonCardHeading}><Skeleton height={10} width={124}/><Skeleton height={16} width={168}/></View><Skeleton height={13} width={58}/></View>
      <Skeleton height={11} style={styles.skeletonSubtitle} width="82%"/>
      <View style={styles.journeyGrid}>{Array.from({ length: 30 }, (_, index) => <Skeleton height={22} key={index} radius={4} width={22}/>)}</View>
    </View>
    {[0, 1].map(index => <View key={index} style={styles.section}>
      <View style={styles.sectionHeader}><View style={styles.sectionHeading}><Skeleton height={10} width={index === 0 ? 92 : 138}/><Skeleton height={11} style={styles.skeletonSubtitle} width={index === 0 ? 74 : 196}/></View><Skeleton height={14} width={14}/></View>
    </View>)}
  </View>;
}

const amber = '#e0ae67';
const styles = StyleSheet.create({
  content:{paddingBottom:48,paddingHorizontal:22,paddingTop:layout.screenTopPadding},eyebrow:{color:colors.accent,fontSize:11,fontWeight:'500',letterSpacing:1.6},title:{color:colors.text,fontSize:25,fontWeight:'500',letterSpacing:-.5,lineHeight:32,marginTop:10},subtitle:{color:colors.textMuted,fontSize:15,lineHeight:24,marginBottom:24,marginTop:9},
  cardEyebrow:{color:colors.accent,fontSize:10,fontWeight:'500',letterSpacing:1.4},cardHeader:{alignItems:'flex-start',flexDirection:'row',justifyContent:'space-between'},cardTitle:{color:colors.text,fontSize:16,fontWeight:'500'},average:{color:colors.accentSoft,fontSize:13,fontWeight:'500'},scoreSummary:{alignItems:'center',flexDirection:'row',justifyContent:'space-between'},sectionBody:{borderTopColor:colors.border,borderTopWidth:1,padding:18},
  chart:{alignItems:'flex-end',flexDirection:'row',gap:7,height:134,marginTop:17},chartColumn:{alignItems:'center',flex:1,justifyContent:'flex-end'},bar:{backgroundColor:colors.accentStrong,borderRadius:6,minHeight:18,width:'72%'},manualBar:{backgroundColor:colors.accentSoft,borderColor:colors.accentStrong,borderWidth:1},chartScore:{color:colors.textMuted,fontSize:9,fontWeight:'500',marginTop:5},chartDate:{color:colors.textFaint,fontSize:9,marginTop:2},legend:{alignItems:'center',flexDirection:'row',gap:6,justifyContent:'flex-end',marginTop:12},legendDot:{backgroundColor:colors.accentStrong,borderRadius:3,height:6,width:6},manualDot:{backgroundColor:colors.accentSoft},legendText:{color:colors.textFaint,fontSize:9,marginRight:5},
  journeyCard:{backgroundColor:colors.surface,borderColor:colors.border,borderRadius:22,borderWidth:1,marginBottom:14,padding:18},journeyGrid:{flexDirection:'row',flexWrap:'wrap',gap:7,marginTop:18,maxWidth:283},journeySquare:{backgroundColor:colors.surfaceRaised,borderColor:colors.border,borderRadius:4,borderWidth:1,height:22,width:22},journeySquareComplete:{backgroundColor:colors.accentStrong,borderColor:colors.accent},journeySquareFuture:{opacity:.36},profileBody:{borderTopColor:colors.border,borderTopWidth:1,padding:18},profileTitle:{color:colors.text,fontSize:17,fontWeight:'500',lineHeight:23},profileCopy:{color:colors.textMuted,fontSize:14,lineHeight:22,marginTop:10},profileSkeleton:{marginTop:14},profileFooter:{alignItems:'flex-end',flexDirection:'row',gap:12,justifyContent:'space-between',marginTop:14},profileUpdated:{color:colors.textFaint,flex:1,fontSize:10,lineHeight:16},regenerate:{alignItems:'center',height:30,justifyContent:'center',marginBottom:-4,width:30},regeneratePressed:{opacity:.5},regenerateIcon:{color:colors.textFaint,fontSize:17,lineHeight:20},skeletonCardHeading:{gap:8},skeletonSubtitle:{marginTop:7},section:{backgroundColor:colors.surface,borderColor:colors.border,borderRadius:20,borderWidth:1,marginBottom:14,overflow:'hidden'},sectionHeader:{alignItems:'center',flexDirection:'row',padding:18},sectionHeading:{flex:1},sectionSubtitle:{color:colors.textSubtle,fontSize:11,lineHeight:17,marginTop:5},chevron:{color:colors.textMuted,fontSize:20},signalBlock:{borderTopColor:colors.border,borderTopWidth:1,padding:17},signalHeading:{color:colors.textSubtle,fontSize:9,fontWeight:'500',letterSpacing:1.2},signalEmpty:{color:colors.textMuted,fontSize:12,lineHeight:19,marginTop:12},patternRow:{borderTopColor:colors.border,borderTopWidth:1,marginTop:14,paddingTop:14},patternHeader:{alignItems:'flex-start',flexDirection:'row',gap:12,justifyContent:'space-between'},patternTitle:{color:colors.text,flex:1,fontSize:14,fontWeight:'500',lineHeight:20},patternDelta:{fontSize:14,fontWeight:'500'},patternCopy:{color:colors.textMuted,fontSize:12,lineHeight:18,marginTop:6},confidence:{color:colors.textFaint,fontSize:9,fontWeight:'500',letterSpacing:.8,marginTop:8},historyHeader:{alignItems:'center',borderTopColor:colors.border,borderTopWidth:1,flexDirection:'row',justifyContent:'space-between',paddingHorizontal:17,paddingTop:17},historyHint:{color:colors.textFaint,fontSize:10},ledgerRow:{borderTopColor:colors.border,borderTopWidth:1,flexDirection:'row',marginTop:14,padding:17,paddingTop:14},delta:{fontSize:24,fontWeight:'500',letterSpacing:-.5,minWidth:52},positive:{color:colors.accentStrong},negative:{color:amber},neutral:{color:colors.textSubtle},ledgerCopy:{flex:1},ledgerTitle:{color:colors.text,fontSize:14,fontWeight:'500'},ledgerNote:{color:colors.textMuted,fontSize:12,lineHeight:18,marginTop:4},ledgerDate:{color:colors.textFaint,fontSize:10,marginTop:7},historyButton:{alignItems:'center',borderTopColor:colors.border,borderTopWidth:1,padding:15},historyButtonText:{color:colors.accent,fontSize:11,fontWeight:'500'},empty:{color:colors.textSubtle,fontSize:13,lineHeight:20,padding:18},error:{color:colors.danger,fontSize:12,lineHeight:18,marginTop:8}
});
