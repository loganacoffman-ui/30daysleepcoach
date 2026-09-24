import {readFileSync,mkdirSync,writeFileSync,cpSync,rmSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ADAPTIVE_DAILY_SYSTEM_PROMPT} from '../../supabase/functions/_shared/dailyCoachingPrompt.ts';
import {buildDailyCoachingMessage,groundedDailyPattern} from '../../supabase/functions/_shared/dailyCoachingContext.ts';
import {parseDailyDecision,boundedDailyAction,DAILY_DECISION_GENERATION,DAILY_DECISION_TOOL,dailyDecisionToolChoice} from '../../supabase/functions/_shared/dailyDecision.ts';
const root=fileURLToPath(new URL('../../',import.meta.url));
const arg=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const model=arg('--model','claude-sonnet-4-6');
if(!['claude-sonnet-4-6','claude-opus-4-6'].includes(model))throw Error('Unsupported evaluation model');
const allCases=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url),'utf8'));
const selected=arg('--cases','').split(',').filter(Boolean);
const cases=selected.length?allCases.filter(c=>selected.includes(c.id)):allCases;
const repetitions=Number(arg('--repeat','1'));
if(!Number.isInteger(repetitions)||repetitions<1||repetitions>3)throw Error('Repeat must be 1–3');
const hash=s=>createHash('sha256').update(s).digest('hex');
const payload={model,generation:DAILY_DECISION_GENERATION,tool:DAILY_DECISION_TOOL,tool_choice:dailyDecisionToolChoice,system:ADAPTIVE_DAILY_SYSTEM_PROMPT,cases:cases.map(c=>({...c,message:buildDailyCoachingMessage(c.context,c.current)}))};
const manifest={tool_schema_sha256:hash(JSON.stringify(DAILY_DECISION_TOOL)),model,generation:DAILY_DECISION_GENERATION,repetitions,cases:cases.map(c=>c.id),prompt_sha256:hash(payload.system),dataset_sha256:hash(JSON.stringify(cases)),message_sha256:hash(JSON.stringify(payload.cases.map(c=>c.message)))};
if(!process.argv.includes('--execute')) {console.log(JSON.stringify({...manifest,status:'dry run; no model calls'},null,2));process.exit(0)}
const run=new Date().toISOString().replaceAll(':','-');
const out=fileURLToPath(new URL(`./results/${run}/`,import.meta.url));mkdirSync(out,{recursive:true});
writeFileSync(`${out}/manifest.json`,JSON.stringify({...manifest,run,transport:'fixed synthetic cases through temporary protected function'},null,2));
writeFileSync(`${out}/prompt.txt`,payload.system);
writeFileSync(`${out}/cases.json`,JSON.stringify(cases,null,2));
writeFileSync(`${out}/requests.json`,JSON.stringify(payload.cases.map(c=>({id:c.id,message:c.message})),null,2));
const name=`adaptive-eval-${Date.now()}`;
const temp=`/private/tmp/${name}`;mkdirSync(`${temp}/supabase/functions/${name}`,{recursive:true});
const token=randomBytes(32).toString('hex'),digest=hash(token),expiry=Date.now()+30*60*1000;
writeFileSync(`${temp}/supabase/functions/${name}/data.json`,JSON.stringify(payload));
cpSync(`${root}/supabase/functions/_shared/dailyDecision.ts`,`${temp}/supabase/functions/${name}/dailyDecision.ts`);
writeFileSync(`${temp}/supabase/functions/${name}/index.ts`, `import {parseDailyDecision,dailyDecisionOutput} from './dailyDecision.ts';
import data from './data.json' with {type:'json'};
const digest=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 if(Date.now()>${expiry}||await digest(req.headers.get('x-eval-token')??'')!=='${digest}')return new Response('Unauthorized',{status:401});
 let body;try{body=await req.json()}catch{return new Response('Invalid JSON',{status:400})}
 const c=data.cases.find(c=>c.id===body.case_id);if(!c)return new Response('Unknown fixed case',{status:400});
 const start=Date.now();
 const generate=async(message:string)=>{
 const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',signal:AbortSignal.timeout(55000),headers:{'content-type':'application/json','anthropic-version':'2023-06-01','x-api-key':Deno.env.get('ANTHROPIC_API_KEY')!},body:JSON.stringify({model:data.model,...data.generation,system:data.system,tools:[data.tool],tool_choice:data.tool_choice,messages:[{role:'user',content:message}]})});
 if(!response.ok)throw Error('Provider request failed');return await response.json();};
 const attempts=[];let r;
 for(let attempt=0;attempt<2;attempt++){
  r=await generate(c.message);
  attempts.push({output:dailyDecisionOutput(r),usage:r.usage,stop_reason:r.stop_reason});
  if(parseDailyDecision(dailyDecisionOutput(r),c.current))break;
 }
 return Response.json({case_id:c.id,model:r.model,usage:r.usage,attempts,stop_reason:r.stop_reason,latency_ms:Date.now()-start,output:dailyDecisionOutput(r)});
});`);
const cli=(args)=>execFileSync('supabase',args,{cwd:temp,encoding:'utf8',stdio:['ignore','pipe','pipe']});
let deployAttempted=false;const results=[];
try {
 deployAttempted=true;cli(['functions','deploy',name,'--project-ref','qfnouotdhfltgvjhfbld','--no-verify-jwt','--use-api']);
 const url=`https://qfnouotdhfltgvjhfbld.supabase.co/functions/v1/${name}`;
 const forbidden=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});if(forbidden.status!==401)throw Error('Unauthorized request not rejected');
 for(let sample=1;sample<=repetitions;sample++) for(const c of cases){
  const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-eval-token':token},body:JSON.stringify({case_id:c.id}),signal:AbortSignal.timeout(120000)});
  if(!res.ok)throw Error(`Fixed case ${c.id} failed: HTTP ${res.status}`);
  const raw=await res.json();const parsed=parseDailyDecision(raw.output,c.current);
  const result={...raw,sample,split:c.split,expected:c.expected,rubric:c.rubric,parsed,displayed:parsed?{...parsed,action:boundedDailyAction(parsed),pattern:groundedDailyPattern(c.context)??parsed.pattern}:null,decision_check:!!parsed&&(c.expected==='adapt'?['simplify','replace'].includes(parsed.decision):parsed.decision===c.expected)};
  results.push(result);writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));
  console.log(`${c.id}: ${parsed?.decision??'INVALID'} (${result.decision_check?'decision category fits':'needs review'})`);
 }
} finally {
 if(deployAttempted){
  try{cli(['functions','delete',name,'--project-ref','qfnouotdhfltgvjhfbld','--yes']);writeFileSync(`${out}/cleanup.json`,JSON.stringify({temporary_function:name,deleted:true}));console.log('Temporary test function removed');}
  catch {writeFileSync(`${out}/cleanup.json`,JSON.stringify({temporary_function:name,deleted:false}));throw Error(`Cleanup failed; remove temporary function ${name}`)}
 }
 rmSync(temp,{recursive:true,force:true});
 console.log(`Evidence: ${out}`);
}
if(results.length!==cases.length*repetitions||results.some(r=>!r.decision_check))process.exitCode=1;
