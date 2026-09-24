export type DailyDecisionKind = 'continue' | 'simplify' | 'replace' | 'clarify';
export type DailyDecision = {
  decision: DailyDecisionKind;
  fit: { obstacle: string; preserved_need: string; time_budget_seconds: number | null; duration_seconds: number | null };
  reason: string;
  pattern: string;
  meaning: string;
  action: string;
  why: string;
};
export type CurrentExperiment = { id?: string; behavior: string; status: string; updated_at?: string };

// Validate a model's decision, never choose a behavior on its behalf.
export function parseDailyDecision(text: string | null, current: CurrentExperiment | null): DailyDecision | null {
  if (!text) return null;
  let value: Record<string, unknown>;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!['continue', 'simplify', 'replace', 'clarify'].includes(String(value.decision))) return null;
  for (const key of ['reason', 'pattern', 'meaning', 'action', 'why']) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 500) return null;
    value[key] = (value[key] as string).trim();
  }
  const result = value as DailyDecision;
  const fit=result.fit;
  if (!fit || typeof fit !== 'object' || typeof fit.obstacle !== 'string' || typeof fit.preserved_need !== 'string') return null;
  for (const n of [fit.time_budget_seconds,fit.duration_seconds]) if(n!==null && (!Number.isInteger(n)||n<=0||n>86400)) return null;
  if (result.decision!=='clarify' && fit.time_budget_seconds!==null
    && (fit.duration_seconds===null || fit.duration_seconds>fit.time_budget_seconds)) return null;
  if ([result.pattern, result.meaning, result.action, result.why].join(' ').split(/\s+/).length > 90) return null;
  // An explicit "continue" must refer to the saved behavior, not disguise a change.
  if (result.decision === 'continue' && current && result.action !== current.behavior) return null;
  if (result.decision === 'simplify' && !current) return null;
  if (boundedDailyAction(result).length > 500) return null;
  return result;
}

export function boundedDailyAction(decision: DailyDecision): string {
  if(decision.decision==='clarify'||decision.decision==='continue'||decision.fit.time_budget_seconds===null) return decision.action;
  const seconds=decision.fit.duration_seconds!;
  const duration=seconds%60===0 ? `${seconds/60} minute${seconds===60?'':'s'}` : `${seconds} seconds`;
  return `${decision.action.replace(/[.!]$/, '')}. Stop after ${duration}.`;
}

export const DAILY_DECISION_INSTRUCTIONS = `Submit one submit_daily_coaching tool call with these fields:
{"decision":"continue|simplify|replace|clarify","reason":"brief evidence-based explanation of the choice","pattern":"one short sentence","meaning":"one short sentence","action":"one feasible behavior OR one essential clarifying question","why":"one short sentence grounded in relevant current context"}.
First identify the exact reported obstacle and any need that must remain possible in fit. Name the actual behavior to change, not a neighboring problem. Extract an explicit time budget in seconds, or null if none is stated; never invent a budget. When there is a budget, supply duration_seconds at or below it. For a new timed action, name the activity without a duration: the app appends an explicit stop time, so it cannot silently run past the limit. Choose an activity that can usefully stop at that time. The action must directly address fit.obstacle while preserving fit.preserved_need. Before submitting, check the mechanism: if the person followed the action exactly, would the reported obstacle still be just as easy to encounter? If so, revise the action to change that obstacle directly. Do not assume a trigger or cause the person has not reported, and do not claim that changing a nearby issue solves the stated problem. Distinguish removing an external cue from changing a self-initiated habit: removing cues alone leaves voluntary access unchanged. For unwanted repeated behavior, consider feasible friction or boundaries on that behavior while preserving required abilities. Do not assume external cues caused the behavior. Describe uncertain benefits as a small experiment, not a guaranteed outcome.
Target 60 words total for the four visible sentences; never exceed 90. Keep reason to one sentence under 30 words: a factual audit summary, not a reasoning transcript.
Choose the decision using judgment, not keywords, a fixed number of nights, or a preset action for a type of person:
- continue: the current experiment still fits and is useful or deserves a fair trial. With a current_daily_experiment, copy its behavior exactly as action. Unrelated life changes alone do not require a new experiment.
- simplify: preserve the useful intent but reduce burden to fit the person's current constraints.
- replace: the prior behavior no longer fits, was unhelpful, or another approach better addresses current needs. Also use this when choosing an initial experiment.
- clarify: one missing fact materially changes what is feasible or safe. Ask one short question as action; do not invent a schedule or prescribe an experiment until answered. Do not ask questions just to defer a decision you have enough information to make.
Recent corrections override outdated circumstances. A saved experiment is evidence, not a requirement to keep unsuitable advice. Reported benefit favors continuity; infeasibility or harm favors adaptation. Do not equate a resolved event with ongoing stress or new free time.
A completed, partial or skipped record describes what actually happened; it is never rewritten. You can still recommend a different next step. Do not ask the user to repeat a completed task as though it had not happened.
The system will publish your action without substituting a previous behavior. Base it on current reports, constraints, preferences, relevant history and uncertainty. Mention only context necessary to explain the recommendation.`;

export const DAILY_DECISION_TOOL = {
  name: 'submit_daily_coaching',
  description: 'Submit the selected coaching decision and concise card. This formats a recommendation; it does not execute external actions.',
  input_schema: {
    type: 'object', additionalProperties: false,
    required: ['decision','fit','reason','pattern','meaning','action','why'],
    properties: {
      decision: {type:'string',enum:['continue','simplify','replace','clarify']},
      fit: {type:'object',additionalProperties:false,required:['obstacle','preserved_need','time_budget_seconds','duration_seconds'],properties:{
        obstacle:{type:'string',description:'The specific user-reported behavior or practical obstacle this action must directly change. Do not substitute an adjacent problem.'},
        preserved_need:{type:'string',description:'A required ability, obligation or preference that the action must preserve; empty if none is stated.'},
        time_budget_seconds:{type:['integer','null'],description:'Explicit available time in seconds; null when not stated.'},
        duration_seconds:{type:['integer','null'],description:'Planned activity duration, within the explicit budget; null only without a budget or for clarification.'},
      }},
      reason: {type:'string',maxLength:500,description:'One short sentence, under 30 words, stating the reported evidence for this decision. Do not infer causes from a score.'},
      pattern: {type:'string',maxLength:500,description:'One short factual sentence.'},
      meaning: {type:'string',maxLength:500,description:'One short sentence acknowledging what the evidence can and cannot tell us.'},
      action: {type:'string',maxLength:500,description:'One concise feasible behavior or essential question. Copy the current behavior exactly when continuing it.'},
      why: {type:'string',maxLength:500,description:'One short sentence citing the relevant user-reported constraint or outcome.'},
    },
  },
};
// One structured decision; deliberation trials did not justify their added latency.
export const dailyDecisionToolChoice = {type:'tool',name:'submit_daily_coaching',disable_parallel_tool_use:true};
export const DAILY_DECISION_GENERATION = {max_tokens:1200};
export function dailyDecisionOutput(response: {content?: Array<{type:string;name?:string;input?:unknown}>;stop_reason?:string}): string | null {
  if (response.stop_reason !== 'tool_use') return null;
  const calls=response.content?.filter(block=>block.type==='tool_use') ?? [];
  return calls.length===1 && calls[0].name===DAILY_DECISION_TOOL.name ? JSON.stringify(calls[0].input) : null;
}
