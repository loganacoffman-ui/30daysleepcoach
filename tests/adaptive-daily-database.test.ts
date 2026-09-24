import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const alice='00000000-0000-4000-8000-000000000001',bob='00000000-0000-4000-8000-000000000002';
const date='2026-09-23';
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role authenticated; create role anon; create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,public to authenticated; grant execute on function auth.uid() to authenticated;
 insert into auth.users values ('${alice}'),('${bob}');`);
 for(const file of ['20260811120000_add_behavior_commitments.sql','20260824090000_create_coach_recommendations.sql','20260924090000_publish_adaptive_daily_coaching.sql']) await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
 await db.exec('grant select,insert,update,delete on public.behavior_commitments,public.coach_recommendations to authenticated');
},30000);
afterAll(async()=>{await db?.close()});
beforeEach(async()=>{
 await db.exec('reset role; truncate public.daily_coaching_decisions,public.coach_recommendations,public.behavior_commitments');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[alice]);
 await db.exec('set role authenticated');
});
const row=async()=> (await db.query<any>('select id,behavior,status,updated_at from behavior_commitments where behavior_date=$1',[date])).rows[0]??null;
const seed=async(status='committed')=>{await db.query('insert into behavior_commitments(user_id,behavior_date,behavior,status) values ($1,$2,$3,$4)',[alice,date,'Wear glasses before daytime sleep.',status]);return row()};
const record=(kind='replace',action='Leave work email outside the bedroom.')=>({pattern:'Recorded sleep',meaning:'Your work schedule changed.',action,why:'You now work days.',generated_at:'2026-09-23T22:00:00Z',prompt_version:'test',source_context:{decision:{kind,reason:'Current correction makes daytime-sleep advice unsuitable.'}}});
const publish=async(expected:any,rec=record(),at:string|null=null)=> (await db.query<any>('select publish_daily_coaching($1,$2::jsonb,$3,$4::jsonb) as result',[date,JSON.stringify(expected),at,JSON.stringify(rec)])).rows[0].result;
it('atomically replaces an incomplete action and records the previous behavior',async()=>{
 const before=await seed();const saved=await publish(before);
 expect(saved.status).toBe('ok');expect(saved.recommendation.action).toBe(record().action);
 expect((await row()).behavior).toBe(record().action);
 const audit=(await db.query<any>('select * from daily_coaching_decisions')).rows[0];
 expect(audit.previous_experiment.behavior).toBe(before.behavior);
 expect(audit.action).toBe(record().action);
});
it.each(['completed','partial','skipped'])('preserves %s history while publishing new guidance',async status=>{
 const before=await seed(status);expect((await publish(before)).status).toBe('ok');
 expect(await row()).toEqual(before);
 expect((await db.query<any>('select action from coach_recommendations')).rows[0].action).toBe(record().action);
});
it('stores a clarification without converting it into a committed experiment',async()=>{
 expect((await publish(null,record('clarify','When is your next sleep opportunity?'))).status).toBe('ok');
 expect(await row()).toBeNull();
});
it('does not overwrite an action edited after generation began',async()=>{
 const before=await seed();await db.query('update behavior_commitments set behavior=$1',['New user choice']);
 expect((await publish(before)).status).toBe('experiment_changed');
 expect((await db.query('select * from coach_recommendations')).rows).toHaveLength(0);
});
it('does not overwrite a newer publication with an older generation',async()=>{
 await publish(null);const current=await row();
 expect((await publish(current,record('replace','Another action'))).status).toBe('coaching_changed');
 expect((await row()).behavior).toBe(record().action);
});
it('does not let continue conceal a behavior change',async()=>{
 const before=await seed();await expect(publish(before,record('continue'))).rejects.toThrow('Continue');
 expect(await row()).toEqual(before);
});
it('uses authenticated identity and prevents reading another account’s decisions',async()=>{
 const before=await seed();await publish(before);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[bob]);
 expect((await db.query('select * from daily_coaching_decisions')).rows).toHaveLength(0);
 expect((await publish(before)).status).toBe('experiment_changed');
 const malicious={...record(),user_id:alice};expect((await publish(null,malicious)).status).toBe('ok');
 expect((await db.query<any>('select user_id from coach_recommendations')).rows[0].user_id).toBe(bob);
});
it('rolls back both recommendation and behavior if the audit insert fails',async()=>{
 const before=await seed();
 await db.exec(`reset role; create function reject_decision_test() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable'; end $$;
 create trigger reject_decision_test before insert on daily_coaching_decisions for each row execute function reject_decision_test(); set role authenticated;`);
 try { await expect(publish(before)).rejects.toThrow('audit unavailable');expect(await row()).toEqual(before);expect((await db.query('select * from coach_recommendations')).rows).toHaveLength(0); }
 finally { await db.exec('reset role; drop trigger reject_decision_test on daily_coaching_decisions; drop function reject_decision_test(); set role authenticated;'); }
});

// Replays real model outputs through the shipped parser and actual PostgreSQL
// publication function. This proves propagation, not semantic coaching quality.
const recorded=JSON.parse(readFileSync(new URL('../evals/adaptive-decision/results/2026-09-23T22-35-39.716Z/results.json',import.meta.url),'utf8'));
const fixtures=JSON.parse(readFileSync(new URL('../evals/adaptive-decision/cases.json',import.meta.url),'utf8'));
it.each(recorded)('preserves live decision $case_id through database publication',async sample=>{
 const {parseDailyDecision}=await import('../supabase/functions/_shared/dailyDecision');
 const fixture=fixtures.find((c:any)=>c.id===sample.case_id);
 if(fixture.current)await db.query('insert into behavior_commitments(user_id,behavior_date,behavior,status) values($1,$2,$3,$4)',[alice,date,fixture.current.behavior,'committed']);
 const before=await row();const parsed=parseDailyDecision(sample.output,before)!;expect(parsed).not.toBeNull();
 const rec={...record(parsed.decision,parsed.action),pattern:sample.displayed.pattern,meaning:parsed.meaning,why:parsed.why,source_context:{decision:{kind:parsed.decision,reason:parsed.reason}}};
 const result=await publish(before,rec);
 expect(result.status).toBe('ok');expect(result.recommendation.action).toBe(parsed.action);
 if(parsed.decision==='clarify')expect(await row()).toEqual(before);
 else expect((await row()).behavior).toBe(parsed.action);
});
