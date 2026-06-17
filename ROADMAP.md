# 30 Day Sleep Coach Roadmap

Living operating doc for the product and engineering priorities. Check this at the start of each Codex session and update it at the end when priorities or facts change.

## Strategic Shift

30 Day Sleep Coach is evolving from an AI-assisted sleep journal into a premium, voice-powered Recovery Audit for high performers.

The product should help ambitious, health-conscious users answer:

> What is actually hurting my sleep, energy, and recovery, what should I test next, and what can I stop worrying about?

The category is not just sleep coaching. The category is recovery intelligence.

## Core Principle

Optimize briefly. Live normally.

The product should reduce cognitive load, not create a permanent quantified-self chore. The experience should feel like:

> Send us your data. Tell us what is going on. We will identify what matters, ignore what does not, and give you a simple recovery playbook.

## Positioning

### Current

30 Day Sleep Coach: AI-powered sleep journaling and behavior-change coaching.

### Target

The 30-Day Recovery Audit: a concierge diagnostic for high performers who feel tired, stressed, sleep-fragmented, or under-recovered despite using wearables, supplements, and wellness tools.

### Possible Taglines

- Your Oura/Whoop tells you what happened. We help you figure out why.
- Stop guessing. Find your recovery bottleneck.
- A done-for-you recovery diagnostic for high performers.
- Health optimization without turning your life into homework.

## Target Customer

Beachhead segment: high-agency recovery strugglers.

These users already use or are open to Oura, Whoop, Apple Watch, Garmin, Eight Sleep, Strava, CGM, bloodwork, supplements, fitness routines, coaching, or wellness tools, but still struggle with poor sleep quality, early waking, low energy, stress, low HRV, burnout, brain fog, inconsistent performance, or confusion about what actually works.

Core customer quote:

> I have all this data, but I still do not know what to do.

## Updated Offer

### The 30-Day Recovery Audit

A concierge health optimization diagnostic for high performers who feel tired, stressed, or under-recovered.

Promise:

- Identify the top 1-3 factors most likely hurting sleep, energy, and recovery.
- Recommend a personalized experiment protocol.
- Produce causal clarity, prioritization, and a simple recovery playbook.
- Escalate appropriately when medical, CBT-I, therapy, bloodwork, CGM, or sleep study support may be warranted.

Do not promise:

- Cure insomnia.
- Guarantee perfect sleep.
- Increase deep sleep by a specific amount.
- Replace medical care.
- Diagnose medical conditions.

## Product Flow

### Step 1 - Voice-Led Intake

Replace the feeling of a form-heavy app with a voice-powered concierge intake.

The first version can be a guided intake that captures:

- Primary goal.
- Main symptoms.
- Current sleep issues.
- Energy patterns.
- Stress and workload.
- Training and exercise.
- Diet style.
- Caffeine, alcohol, and THC.
- Supplements and medications.
- Wearables used.
- Bloodwork or CGM availability.
- Prior experiments.
- Health concerns and red flags.
- Willingness to test behavior changes.

Goal: form the first set of hypotheses, not collect everything.

### Step 2 - Data Upload Checklist

Users upload what already exists.

Possible sources:

- Oura, Whoop, Apple Health, Garmin, Eight Sleep, or Strava screenshots/exports.
- Screen Time screenshots.
- Bloodwork PDF.
- CGM report.
- Supplement list.
- Diet notes.
- Current sleep, morning, and evening routine.

Early version can be manual. Do not prioritize API integrations until the concierge workflow proves demand.

### Step 3 - 7-Day Recovery Baseline

The first software milestone should establish a user's baseline over 7 days.

Oura should automatically populate the objective layer:

- Sleep score.
- HRV.
- Bedtime and wake time.
- Sleep duration.
- Readiness or recovery score.
- Stress and recovery minutes.

The user should add the subjective layer with a voice-powered or tap-first daily check-in.

Daily check-in target: 30 seconds.

Morning check-in:

- Sleep quality: 1-10.
- Energy: 1-10.
- Mood: 1-10.
- Stress/rumination: 1-10.
- Focus: 1-10.
- Soreness or training load: 1-10.
- Main suspected factor from yesterday: late meal, alcohol, caffeine, hard workout, screens, work stress, travel, illness, no idea, or other.

Optional evening check-in:

- Caffeine after noon?
- Alcohol?
- Late/heavy meal?
- Hard workout after 5 p.m.?
- Screens after 9:30 p.m.?
- Meaningful social contact?

This should feel like helping the system confirm or reject hypotheses, not journaling.

After 7 days, the app should generate a baseline snapshot:

- Sleep baseline.
- HRV/recovery baseline.
- Stress/load baseline.
- Energy and mood baseline.
- Likely recovery bottleneck.
- Confidence level.
- First 7-day experiment.

### Step 4 - Recovery Baseline Report

After intake and initial data review, produce a concise report:

1. Primary recovery complaint.
2. Current data snapshot.
3. Top suspected bottlenecks.
4. What appears high signal.
5. What appears low signal/noise.
6. Red flags or escalation suggestions.
7. First experiment recommendation.
8. Metrics to monitor.
9. Expected timeline.
10. Next review point.

Example bottleneck categories:

- Stress/rumination-driven sleep disruption.
- Circadian inconsistency.
- Late meal/glucose instability.
- Alcohol or THC disruption.
- Overtraining/under-recovery.
- Screen/dopamine overstimulation.
- Caffeine timing.
- Low social connection/emotional recovery.
- Medical/lab-related issue.
- Sleep apnea risk.
- Mood/anxiety/depression-related sleep disruption.

### Step 5 - Weekly Experiment Loop

Each week should focus on one primary experiment.

Each experiment includes:

- Hypothesis.
- Behavior change.
- Duration.
- Metrics tracked.
- Success criteria.
- Next decision.

Example experiments:

- Fixed wake time plus morning light.
- No caffeine after noon.
- No late meals within 3 hours of bed.
- No alcohol for 14 days.
- Reduce hard evening training.
- Screen cutoff after 9:30 p.m.
- CGM experiment.
- Earlier dinner plus higher protein.
- Evening nervous system downshift.
- More social connection/recovery.
- CBT-I protocol.
- Sleep study escalation.
- Bloodwork follow-up.

### Step 6 - Final Recovery Playbook

Final deliverable:

1. Top recovery bottlenecks.
2. Highest-leverage behaviors.
3. Biggest avoidances.
4. Likely HRV killers.
5. Likely sleep disruptors.
6. Likely energy builders.
7. What to stop worrying about.
8. 30-day maintenance plan.
9. Escalation plan if symptoms continue.
10. Optional next experiments.

Emotional outcome:

> I finally know what matters and what to do next.

## Product Roadmap

### Phase 1 - Manual Concierge MVP

Goal: validate that people will pay for a done-for-you recovery diagnostic before overbuilding software.

Build:

- Landing page copy for the Recovery Audit.
- Voice-led intake or intake script.
- Data upload checklist.
- Recovery Baseline Report template.
- Lightweight check-in form.
- Experiment tracker.
- Final Recovery Playbook template.
- Manual analysis workflow.

Do not build yet:

- Full mobile app.
- Complex AI agent.
- Full wearable sync.
- Automated food logging.
- Continuous optimization engine.
- Generic habit library.

Pricing:

- Beta: $299-$499 for first 5-10 users.
- Premium concierge: $750-$1,500 after validation.
- Executive tier later: $2,000+ with deeper review, labs/CGM coordination, and expert escalation.

### Phase 2 - Run The Product On Logan

Use Logan as the first case study before selling.

Create:

- Logan Recovery Intake.
- Logan Data Upload Folder.
- Logan Recovery Baseline Report.
- Logan 14-Day Experiment Plan.
- Logan Final Recovery Playbook.

Goal: identify whether sleep quality is most affected by stress, loneliness, rumination, screens, training load, diet/glucose, caffeine, alcohol, circadian rhythm, or a medical issue.

### Phase 3 - Beta Customer Validation

Recruit 5-10 beta users manually.

Ideal beta users:

- Already use Oura, Whoop, Apple Watch, Garmin, or similar.
- Feel tired, stressed, or under-recovered.
- Have tried generic wellness advice.
- Are willing to upload data.
- Are willing to complete lightweight check-ins.
- Are willing to pay.
- Are comfortable giving feedback.

Validation questions:

- Will people pay for this?
- Which pain is most acute: sleep, energy, stress, recovery, burnout, glucose, or performance?
- What data do users already have?
- What data are they willing to provide?
- What feels too burdensome?
- Which report insights feel most valuable?
- Do they prefer async report, live call, voice concierge, or a mix?
- Does the audit produce behavior change?
- Would they refer a friend?
- Would they buy ongoing support?

### Phase 4 - Productize Repeated Patterns

After 10-20 audits, identify repeated patterns.

Productizable components:

- Intake scoring.
- Voice transcript summarization.
- Archetype classification.
- Data upload parser.
- Report generator.
- Experiment recommendation engine.
- Weekly check-in logic.
- Final playbook generator.

Possible archetypes:

- The Stressed Waker.
- The Overtrained Striver.
- The Wired-but-Tired Founder.
- The Late-Night Dopamine Scroller.
- The Glucose Rollercoaster.
- The Inconsistent Circadian Sleeper.
- The Socially Depleted High Performer.
- The Biohacker With Too Much Data.
- The Medical Escalation Case.

### Phase 5 - Software Layer

Only build heavier software after manual validation.

Software should automate:

- Intake collection.
- Voice capture and summarization.
- Data upload.
- Lightweight check-ins.
- Report generation.
- Pattern detection.
- Experiment suggestions.
- Progress tracking.
- Final playbook generation.

Software should not become:

- Another dashboard.
- Another generic sleep tracker.
- A daily self-optimization chore.
- A permanent life-logging product.

## Immediate Next Steps

1. Reframe the landing page around the Recovery Audit, not sleep journaling. Done in first pass; keep refining after beta feedback.
2. Redesign the Daily Log into a 7-day Recovery Baseline workflow.
3. Auto-populate the Daily Log from Oura wherever possible so users do not manually enter wearable metrics.
4. Add a 30-second qualitative check-in for energy, mood, stress/load, focus, soreness/training load, and unusual factors.
5. Make voice input the intended direction, but start with tap inputs plus optional free-text/voice-note field if needed.
6. Create the 7-day baseline report state and lock/unlock logic.
7. Create the Recovery Baseline Report template.
8. Run the full process on Logan.
9. Package Logan's output into a case study.
10. Recruit 5 beta users.
11. Charge $299-$499.
12. Use beta feedback to decide whether this becomes a premium service, productized service, AI software product, content/lead-gen funnel, or not worth pursuing.

## Current App Work

The existing app remains useful as a prototype and infrastructure layer, but it should serve the Recovery Audit instead of becoming a generic tracking dashboard.

### Auth / Onboarding

- Email signup works after Resend DNS verification.
- Supabase Auth signup returns `200` with `confirmation_sent_at`.
- Google OAuth provider is enabled and starts the OAuth flow.
- Existing account signup UX still needs cleanup.
- Apple OAuth is lower priority than Recovery Audit validation.

### Existing Tracking App

- Manual sleep logging is implemented.
- Daily Log needs to become the 7-day baseline check-in, not a manual wearable entry form.
- History and Insights views are implemented.
- AI coach and daily briefing UI exist.
- Oura Stress tab UI exists.
- Oura data can be fetched, but it is not yet auto-populating the Daily Log baseline workflow.
- Coach empty state now clarifies that it uses 7 recent entries from the last 14 days.

### Engineering Priorities

- Keep generated Supabase temp metadata out of git.
- Add local run and deployment notes.
- Add a repeatable smoke-test checklist for onboarding, logging, Google OAuth, email signup, Oura, AI coach, and mobile.
- Consider splitting `index.html` into CSS and JavaScript files by concern after the product direction stabilizes.
- Version Supabase Edge Function source code in the repo if deployed function code only exists in the Supabase dashboard.

## Needs Confirmation

- Whether the deployed `sleep-coach` Edge Function cache lookup is live and behaving as expected.
- Whether AI caching works end to end across frontend, `ai_cache`, and the Edge Function.
- Whether the deployed `oura-proxy` Edge Function contract matches the frontend.
- Whether all production Netlify and Supabase redirect settings match the current auth flow.
- Whether Google OAuth returns users to production correctly, not only localhost.

## Notes And Principles

- Defensible moat: behavioral and longitudinal recovery intelligence, not biometric tracking alone.
- MVP discipline: validate the concierge diagnostic manually before building complex automation.
- Current top-level order: Recovery Audit positioning, 7-day Recovery Baseline workflow, Oura auto-population, voice/tap daily check-in, baseline report, Logan case study, beta users, then software automation.
- Preserve the core principle: minimal input, maximum clarity.
