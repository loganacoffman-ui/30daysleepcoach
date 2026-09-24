import { expect, it } from 'vitest';
import { parseDailyDecision } from '../supabase/functions/_shared/dailyDecision';
const current = {behavior:'Read one page.',status:'committed'};
const answer = (decision='replace',action='Put the phone out of reach.') => JSON.stringify({decision,fit:{obstacle:'Scrolling',preserved_need:'',time_budget_seconds:null,duration_seconds:null},reason:'User reports scrolling delays sleep.',pattern:'You reported tiredness.',meaning:'The bedtime routine is difficult.',action,why:'You want to stop scrolling.'});
it('accepts model decisions without substituting the previous action',()=>{
 for(const decision of ['simplify','replace','clarify']) expect(parseDailyDecision(answer(decision),current)?.action).toBe('Put the phone out of reach.');
 expect(parseDailyDecision(answer('continue',current.behavior),current)?.decision).toBe('continue');
});
it('rejects malformed or contradictory decisions instead of silently retaining stale advice',()=>{
 for(const raw of ['invalid','null','[]',answer('invented'),answer('continue')]) expect(parseDailyDecision(raw,current)).toBeNull();
 expect(parseDailyDecision(answer('simplify'),null)).toBeNull();
});

it('requires one complete structured result, rejecting truncated or unexpected tool calls',async()=>{
 const {dailyDecisionOutput}=await import('../supabase/functions/_shared/dailyDecision');
 const block={type:'tool_use',name:'submit_daily_coaching',input:JSON.parse(answer())};
 expect(dailyDecisionOutput({stop_reason:'tool_use',content:[block]})).toBe(answer());
 expect(dailyDecisionOutput({stop_reason:'max_tokens',content:[block]})).toBeNull();
 expect(dailyDecisionOutput({stop_reason:'tool_use',content:[block,block]})).toBeNull();
 expect(dailyDecisionOutput({stop_reason:'tool_use',content:[{...block,name:'other'}]})).toBeNull();
});

it('rejects missing or excessive duration and renders a bounded activity without choosing it',async()=>{
 const {boundedDailyAction}=await import('../supabase/functions/_shared/dailyDecision');
 const value={...JSON.parse(answer()),action:'Listen to familiar music.',fit:{obstacle:'Too little wind-down time',preserved_need:'',time_budget_seconds:60,duration_seconds:60}};
 const parsed=parseDailyDecision(JSON.stringify(value),current)!;
 expect(boundedDailyAction(parsed)).toBe('Listen to familiar music. Stop after 1 minute.');
 for(const duration of [null,61,0,-1])expect(parseDailyDecision(JSON.stringify({...value,fit:{...value.fit,duration_seconds:duration}}),current)).toBeNull();
 expect(boundedDailyAction({...value,decision:'continue',action:current.behavior})).toBe(current.behavior);
});
