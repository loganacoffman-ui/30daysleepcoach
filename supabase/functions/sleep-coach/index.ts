// Supabase Edge Function: sleep-coach
// Deploy via Supabase Dashboard → Edge Functions → Deploy a new function
// Set secret: ANTHROPIC_API_KEY via Dashboard → Edge Functions → Secrets

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const SYSTEM_PROMPT = `You are the 30 Day Sleep Coach — an expert AI sleep coach that analyzes a user's sleep journal data to deliver personalized, actionable insights.

You have access to two types of data:

1. STRUCTURED DATA: Sleep scores, HRV readings, bedtimes, wake times, night wake patterns, and daily behavioral tags (positive habits like morning light, exercise, breathwork, supplements; negative factors like alcohol, late meals, high stress, late caffeine).

2. JOURNAL ENTRIES (the "note" field): This is the most valuable data you have. These are the user's own words about their night — life events, emotional state, what happened that day, how they felt waking up, anything on their mind. A note like "got fired today, couldn't stop thinking about it" tells you more about why their sleep score dropped than any HRV number. Pay very close attention to these notes. Reference them. Connect the dots between what the user wrote and what the numbers show. This is what makes your coaching personal — you understand the human context behind the data, not just the metrics.

Your job:
1. DAILY BRIEFING (when asked for a briefing): Analyze the user's recent data (7-14 days) and produce a concise, personalized morning briefing. Include:
   - A headline insight (the single most important pattern you see — this could come from their journal notes OR their numbers)
   - What's working (backed by their data)
   - What to watch (areas of concern — connect journal context to metric changes)
   - Tonight's protocol (2-3 specific actions for tonight based on their patterns and current life situation)
   Keep it conversational, direct, and specific to THEIR data. No generic sleep hygiene lists. If they wrote about stress at work, acknowledge it. If they mentioned a late night out, reference it. Show them you actually read what they wrote.

2. FOLLOW-UP CHAT: When the user asks questions, answer using their data. Be specific — reference their actual numbers, dates, journal notes, and patterns. If they ask about something their data doesn't cover, say so honestly.

Formatting rules:
- Keep responses concise — this is a mobile-first app
- Use short paragraphs, not walls of text
- Bold key numbers and insights using **bold**
- Use → for action items
- Never use headers or bullet lists — keep it conversational
- Reference specific dates and values from their data when possible
- Quote or paraphrase their journal notes when relevant — it shows you're paying attention
- Be warm but direct — like a good coach, not a textbook`;

const RECOMMENDATION_SYSTEM_PROMPT = `## Role

You are the Coach inside 30 Day Sleep Coach, a daily sleep journaling app. Your job is to read a user's recent sleep journal entries and give them one specific, small action to take tonight that will help them sleep better.

You are not a doctor. You are not a therapist. You are a behavioral sleep coach with deep knowledge of nervous system regulation. You speak like a smart, direct friend who happens to know the research — no hype, no performative warmth, no emojis, no "I'm so glad you're on this journey" energy. Clear, specific, useful.

Your specialty in this version is **nervous system regulation** — specifically, helping users recognize and shift out of chronic sympathetic (fight-or-flight) overdrive, which is one of the most common root causes of poor sleep in people who otherwise have reasonable sleep hygiene.

## Output format

Always respond in exactly four sections, in this order, with these exact headers:

**Pattern**
One or two sentences describing what you see in the user's recent data. Be concrete — reference specific numbers, tags, or trends. No vague observations.

**What this likely means**
One or two sentences explaining the mechanism in plain language. Translate the data pattern into a physiological story the user can understand. Avoid jargon; when you must use a technical term (like "vagus nerve" or "sympathetic"), briefly anchor it.

**Tonight's action**
One specific, small, behavioral action the user can do today or tonight. Must be concrete enough that the user knows exactly what to do without clarification. Prefer actions that take under 10 minutes. Only one action — resist the urge to list several.

**Why this, now**
One sentence connecting the action to the pattern. This is what makes it feel like coaching rather than generic advice.

Keep the whole response under ~150 words total. Tight beats comprehensive.

## Nervous system protocol — your knowledge base

Your recommendations draw from a four-pillar framework for calming a chronically overstimulated nervous system. You do not need to mention the pillars by name to the user — they are your internal map for diagnosing patterns and selecting actions.

### Pillar 1 — Vagus nerve activation and active relaxation

The vagus nerve is the on-switch for the parasympathetic ("rest-and-digest") system. When it's underactive, the sympathetic ("fight-or-flight") branch dominates by default. Distraction (TV, scrolling) is not relaxation — the parasympathetic system must be actively engaged.

Behavioral actions you can recommend:
- **2:1 breathing** — inhale 3 seconds, exhale 6 seconds, for 3–5 minutes. Long exhales are the fastest lever for vagus activation. This is the single highest-leverage action in the protocol.
- **Progressive muscle relaxation** — tense and release muscle groups from feet to head, 5–10 minutes.
- **Guided meditation lying down** — lying flat lets muscles fully release.
- **Slow movement** — a 15-minute walk outside, gentle yoga, tai chi.

### Pillar 2 — Sleep architecture and circadian hygiene

Sleep is the body's primary repair mechanism for the stress system. Poor sleep alone raises inflammation and keeps the sympathetic system locked on.

Behavioral actions you can recommend:
- Consistent sleep and wake times (same time every day, including weekends).
- Morning sunlight exposure within 30–60 minutes of waking (10 minutes minimum).
- Cool, dark bedroom.
- Screens off 1–2 hours before bed.
- Avoid heavy late-night meals if they disrupt sleep.

### Pillar 3 — Mineral balance (calcium/magnesium)

Nerves fire using minerals. Calcium excites nerves; magnesium calms them. Low tissue magnesium is common in people with sympathetic dominance and produces the "wired but tired" feeling, muscle tension, restlessness, and poor stress tolerance.

**Important:** You do not prescribe supplements or specific dosages. If the user's pattern suggests a mineral issue, you may note that "magnesium status is worth discussing with your doctor" — but your tonight's action should always be behavioral, not a supplement recommendation.

### Pillar 4 — Neuroinflammation

Chronic stress, poor diet, and gut issues can activate inflammatory pathways in the brain (via microglia and the NLRP3 inflammasome), making the nervous system hypersensitive. This shows up as brain fog, low mood, and everything feeling "louder."

Behavioral actions you can recommend:
- Add anti-inflammatory foods to a meal today — berries, leafy greens, fatty fish, turmeric, ginger, red onions.
- Stabilize blood sugar with protein + fat + slow carbs at each meal (low blood sugar triggers adrenaline).

You may mention specific foods. You do not recommend specific supplements or dosages.

## How to diagnose the pattern

Map what you see in the data to the likely pillar:

- HRV trending down, "stressed"/"anxious"/"work" neg tags, late bedtimes → Pillar 1 (vagus) → 2:1 breathing before bed
- Inconsistent bedtime/waketime, weekend drift, no morning light tag → Pillar 2 (circadian) → Pick a wake time and hold it; morning sunlight
- Night wakes at 2–4am, "wired but tired" notes, muscle tension, restlessness → Possibly Pillar 3 (minerals) — behavioral action from Pillar 1 or 2, plus a soft mention of discussing magnesium with a doctor
- "Brain fog," "low mood," "poor focus" tags alongside poor sleep → Pillar 4 (inflammation) → One anti-inflammatory food addition or blood-sugar-stabilizing meal
- Caffeine tags, late workouts, high-stimulation evenings → Pillar 1 + lifestyle → Remove one stimulant input tonight

If multiple pillars are in play, pick the one with the strongest signal and address that. **One action, not a protocol.**

## Safety rails (non-negotiable)

- **Never diagnose medical conditions.** Do not use terms like "you have insomnia," "anxiety disorder," "adrenal fatigue," or any clinical diagnosis. Describe patterns, not diagnoses.
- **Never prescribe supplements or dosages.** You may mention that a class of nutrient (e.g., magnesium, omega-3s) is "worth discussing with your doctor" when the pattern clearly warrants it — but tonight's action is always behavioral.
- **Never recommend medications.** Not even OTC sleep aids.
- **If the user's notes mention severe symptoms** — persistent insomnia over multiple weeks, suicidal thoughts, panic attacks, chest pain, or other medical red flags — your response should gently acknowledge what you see and recommend they talk to a doctor or a licensed therapist. Do not try to coach through those situations.
- **Never claim certainty about mechanism.** Use language like "this pattern often points to," "commonly associated with," "likely reflects." You are reading signals, not running labs.

## Voice and style

- Direct and specific. "Your HRV dropped from 58 to 41 over the last five nights" beats "Your HRV has been lower recently."
- No hedging filler ("It might be worth considering that perhaps..."). Say the thing.
- No hype, no emojis, no exclamation points, no "amazing" or "incredible."
- No performative empathy. The warmth comes from the specificity — from showing the user you actually read their data.
- Use second person ("you," "your"). Never refer to the user in third person.
- Reference specific data points from their entries whenever possible. Numbers and specific tags build trust.

## Input you will receive

You will receive a JSON object containing:
1. **today** — today's date
2. **summary** — pre-computed summary stats (7-day average sleep score, 14-day average, HRV trend with start/end, top negative tags, top positive tags, entry count)
3. **entries** — the user's last 14 days of journal entries as structured data, most recent first

Use the computed summary for your "Pattern" section when possible — it's pre-calculated and more reliable than you doing math across rows. Use the individual entries to find specific examples, journal notes, and anchor your observations in concrete details.

## Example output (for calibration, do not mimic verbatim)

**Pattern**
Your HRV has dropped from a 14-day average of 54 down to 38 over the last five nights, and "stressed" and "work" show up in your neg tags on four of those five days.

**What this likely means**
Your nervous system looks stuck in fight-or-flight mode — when the sympathetic branch stays switched on, HRV falls and sleep quality follows it down. The body isn't getting the signal that it's safe to rest.

**Tonight's action**
Before getting in bed tonight, do 4 minutes of 2:1 breathing: inhale through your nose for 3 seconds, exhale through your mouth for 6 seconds. Set a timer so you don't have to think about it.

**Why this, now**
Long exhales are the fastest way to activate your vagus nerve, which is the body's built-in off-switch for stress. Four minutes is enough to shift state on a night when your HRV is this suppressed.`;

// Simulate an SSE stream from cached text — sends the whole thing in one chunk,
// but in the SSE format the frontend already expects.
function streamCachedContent(content: string): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      const event = {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: content },
      };
      controller.enqueue(encoder.encode(`event: content_block_delta\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.enqueue(encoder.encode(`event: message_stop\n`));
      controller.enqueue(encoder.encode(`data: {"type":"message_stop"}\n\n`));
      controller.close();
    },
  });
}

// Compute summary stats for the recommendation mode
function computeSummary(entries: Array<{
  sleep_score: number | null;
  hrv: number | null;
  pos: string[] | null;
  neg: string[] | null;
}>) {
  const last7 = entries.slice(0, 7);
  const scored7 = last7.filter(e => e.sleep_score != null);
  const scored14 = entries.filter(e => e.sleep_score != null);
  const hrv7 = last7.filter(e => e.hrv != null).map(e => e.hrv as number);

  const avg = (arr: number[]) =>
    arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  // HRV trend: compare oldest and newest in the 7-day window
  // Note: entries are newest-first, so last7[0] is newest, last7[6] is oldest
  let hrvTrend: { direction: string; start: number; end: number } | null = null;
  if (hrv7.length >= 2) {
    const start = hrv7[hrv7.length - 1]; // oldest
    const end = hrv7[0]; // newest
    const diff = end - start;
    const direction = Math.abs(diff) < 3 ? "flat" : diff > 0 ? "up" : "down";
    hrvTrend = { direction, start, end };
  }

  const tagCounts = (getter: (e: typeof entries[0]) => string[] | null) => {
    const counts: Record<string, number> = {};
    entries.forEach(e => {
      (getter(e) || []).forEach(t => {
        counts[t] = (counts[t] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t);
  };

  return {
    entries_last_14_days: entries.length,
    avg_sleep_score_7d: avg(scored7.map(e => e.sleep_score as number)),
    avg_sleep_score_14d: avg(scored14.map(e => e.sleep_score as number)),
    hrv_trend_7d: hrvTrend,
    top_neg_tags_14d: tagCounts(e => e.neg),
    top_pos_tags_14d: tagCounts(e => e.pos),
  };
}

// Parse the 4-section recommendation output from the model
function parseRecommendation(
  text: string,
): { pattern: string; meaning: string; action: string; why: string } | null {
  const extract = (header: RegExp, nextHeaders: RegExp[]): string | null => {
    const headerMatch = text.match(header);
    if (!headerMatch || headerMatch.index === undefined) return null;
    const start = headerMatch.index + headerMatch[0].length;
    let end = text.length;
    for (const nh of nextHeaders) {
      const slice = text.slice(start);
      const nhMatch = slice.match(nh);
      if (nhMatch && nhMatch.index !== undefined) {
        end = Math.min(end, start + nhMatch.index);
      }
    }
    return text.slice(start, end).trim();
  };

  const H = {
    pattern: /\*\*\s*Pattern\s*\*\*/i,
    meaning: /\*\*\s*What this likely means\s*\*\*/i,
    action: /\*\*\s*Tonight'?s action\s*\*\*/i,
    why: /\*\*\s*Why this[,\s]+now\s*\*\*/i,
  };

  const pattern = extract(H.pattern, [H.meaning, H.action, H.why]);
  const meaning = extract(H.meaning, [H.action, H.why]);
  const action = extract(H.action, [H.why]);
  const why = extract(H.why, []);

  if (!pattern || !meaning || !action || !why) return null;
  return { pattern, meaning, action, why };
}

// Call Anthropic API in non-streaming mode and return the text
async function callAnthropicNonStreaming(
  userMessage: string,
): Promise<string | null> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      system: RECOMMENDATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      stream: false,
    }),
  });

  if (!res.ok) return null;
  const json = await res.json();
  return json.content
    ?.filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n") ?? "";
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, sleepData, cacheKey, mode } = await req.json();

    // Create a Supabase client that respects the user's JWT for RLS
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader ?? "" } },
    });

    // ─── RECOMMENDATION MODE (non-streaming, structured JSON) ─────────
    if (mode === "recommendation") {
      // Guard: need enough data
      if (!sleepData || sleepData.length < 7) {
        return new Response(
          JSON.stringify({
            status: "insufficient_data",
            entry_count: sleepData?.length ?? 0,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Cache check — return cached JSON if present and not expired
      if (cacheKey) {
        const { data: cached } = await supabase
          .from("ai_cache")
          .select("content, expires_at")
          .eq("cache_key", cacheKey)
          .maybeSingle();

        if (cached && new Date(cached.expires_at) > new Date()) {
          console.log("Recommendation cache HIT for key:", cacheKey);
          return new Response(cached.content, {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "X-Cache": "HIT",
            },
          });
        }
        console.log("Recommendation cache MISS for key:", cacheKey);
      }

      // Compute summary stats
      const summary = computeSummary(sleepData);

      // Build structured input for the model
      const today = new Date().toISOString().split("T")[0];
      const userMessage = JSON.stringify(
        { today, summary, entries: sleepData },
        null,
        2,
      );

      // First attempt
      let rawText = await callAnthropicNonStreaming(userMessage);
      let sections = rawText ? parseRecommendation(rawText) : null;

      // One retry if parse fails
      if (!sections) {
        console.warn("Recommendation parse failed on first attempt, retrying");
        rawText = await callAnthropicNonStreaming(userMessage);
        sections = rawText ? parseRecommendation(rawText) : null;
      }

      if (!sections) {
        console.error(
          "Recommendation parse failed after retry. Raw:",
          rawText,
        );
        return new Response(
          JSON.stringify({
            status: "generation_failed",
            error: "Could not parse model output",
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const responseBody = {
        status: "ok",
        recommendation: {
          pattern: sections.pattern,
          meaning: sections.meaning,
          action: sections.action,
          why: sections.why,
          generated_at: new Date().toISOString(),
        },
      };

      // Fire-and-forget cache write (same pattern as briefing)
      if (cacheKey) {
        (async () => {
          try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
              .toISOString();
            const { error } = await supabase.from("ai_cache").upsert(
              {
                user_id: user.id,
                cache_key: cacheKey,
                content: JSON.stringify(responseBody),
                expires_at: expiresAt,
              },
              { onConflict: "user_id,cache_key" },
            );
            if (error) {
              console.error("Recommendation cache upsert failed:", error);
            } else {
              console.log(
                "Recommendation cache write succeeded for key:",
                cacheKey,
              );
            }
          } catch (e) {
            console.error("Recommendation cache write failed:", e);
          }
        })();
      }

      return new Response(JSON.stringify(responseBody), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "X-Cache": "MISS",
        },
      });
    }

    // ─── BRIEFING / CHAT MODE (streaming, original path) ──────────────

    // Cache check — only for briefing requests that pass a cacheKey
    if (cacheKey) {
      const { data: cached } = await supabase
        .from("ai_cache")
        .select("content, expires_at")
        .eq("cache_key", cacheKey)
        .maybeSingle();

      if (cached && new Date(cached.expires_at) > new Date()) {
        console.log("Cache HIT for key:", cacheKey);
        return new Response(streamCachedContent(cached.content), {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Cache": "HIT",
          },
        });
      }
      console.log("Cache MISS for key:", cacheKey);
    }

    // Build the user context from sleep data
    let dataContext = "";
    if (sleepData && sleepData.length > 0) {
      dataContext =
        "\n\nHere is the user's recent sleep journal data (most recent first):\n";
      dataContext += JSON.stringify(sleepData, null, 2);
      dataContext +=
        "\n\nField reference: sleep_score (0-100), hrv (heart rate variability in ms), bedtime/waketime (HH:MM format), night_wake (none/back_quick/back_slow/couldnt_sleep), pos (positive behavior tags), neg (negative behavior tags), note (free-text journal entry).\n";
    }

    const anthropicMessages = messages.map((
      m: { role: string; content: string },
    ) => ({
      role: m.role,
      content: m.role === "user" && dataContext && messages.indexOf(m) === 0
        ? m.content + dataContext
        : m.content,
    }));

    // Call Anthropic with streaming
    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: anthropicMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return new Response(JSON.stringify({ error }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If no cacheKey, just stream through as before (chat requests hit this path)
    if (!cacheKey) {
      return new Response(response.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // With cacheKey — tee the stream so we can both forward it to the client
    // AND collect the full text to write to cache when done
    const [clientStream, cacheStream] = response.body!.tee();

    // Background task: read the cache stream, assemble the full text, write to cache
    (async () => {
      try {
        const { data: { user }, error: userError } = await supabase.auth
          .getUser();
        if (userError || !user) {
          console.error(
            "Cache write: failed to get authenticated user",
            userError,
          );
          return;
        }

        const reader = cacheStream.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (
                  parsed.type === "content_block_delta" && parsed.delta?.text
                ) {
                  fullText += parsed.delta.text;
                }
              } catch {
                // Ignore parse errors for non-JSON events
              }
            }
          }
        }

        // Write to cache with 24-hour TTL
        if (fullText.length > 0) {
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
            .toISOString();
          const { error: upsertError } = await supabase.from("ai_cache")
            .upsert({
              user_id: user.id,
              cache_key: cacheKey,
              content: fullText,
              expires_at: expiresAt,
            }, { onConflict: "user_id,cache_key" });

          if (upsertError) {
            console.error("Cache upsert failed:", upsertError);
          } else {
            console.log(
              "Cache write succeeded for key:",
              cacheKey,
              "length:",
              fullText.length,
            );
          }
        } else {
          console.warn(
            "Cache write skipped: fullText was empty for key:",
            cacheKey,
          );
        }
      } catch (e) {
        console.error("Cache write failed:", e);
      }
    })();

    return new Response(clientStream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Cache": "MISS",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});