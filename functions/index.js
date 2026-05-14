// Cloud Functions for the golf app's AI coach feature.
//
// The client posts a structured snapshot of the player's recent stats.
// This function adds a system prompt and forwards the request to the
// Google Gemini API. The API key never leaves the server.
//
// Auth: only signed-in users can call this function (enforced by the
// `onCall` callable contract — request.auth is required).
//
// Configuration: the Gemini API key is stored as a Firebase secret
// named GEMINI_API_KEY. Set with:
//   firebase functions:secrets:set GEMINI_API_KEY
//
// Deploy: `firebase deploy --only functions`

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';

// us-central1 is the default region and matches most Firebase setups.
// Change here if your other Firebase services are in a different region.
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

// The Gemini model used for coach recommendations. Flash is fast +
// has generous free-tier limits (15 RPM, 1500/day). Swap to
// 'gemini-2.5-pro' for deeper reasoning at the cost of tighter limits.
const GEMINI_MODEL = 'gemini-2.5-flash';

// ─────────────────────────────────────────────────────────────────────
// PROMPT
// The system prompt sets the coach persona + output format. The user
// prompt is a structured stats summary built from the client payload.
// ─────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a golf coach analyzing a player's recent performance data to recommend practice drills.

Your output MUST follow this exact markdown structure:

## Diagnosis
One or two sentences identifying the player's biggest weakness based on the data. Reference specific numbers.

## Practice plan
Numbered list of 3-5 drills, each formatted as:

**1. Drill name** — 1-sentence description of what to do.
- Where: range / putting green / chipping area / course
- Duration: e.g., 20 minutes
- Success criteria: a concrete, measurable target (e.g., "make 8 of 10 from 6 ft")

## Quick win
One drill the player can do in 15 minutes today to make a noticeable difference. One sentence.

Rules:
- Be CONCRETE. "Make 7 out of 10 putts from 6 feet" beats "improve short putting".
- Reference the player's specific weak numbers in the Diagnosis.
- Order drills by impact — the one that addresses their worst weakness goes first.
- Do not invent stats the player didn't provide.
- Do not recommend drills outside golf practice (e.g., no gym work).
- Keep total response under 400 words.`;

/**
 * Format a number for display, or return '—' for null/NaN.
 */
function n(v, digits = 1) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}
function pct(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return `${Math.round(v)}%`;
}
function sg(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  if (Math.abs(v) < 0.05) return '0.0';
  return v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
}

/**
 * Build a structured stats summary from the client payload.
 * Whitelists the fields we send to Gemini — never echoes the raw
 * client object to the model.
 */
function buildStatsBlock(payload) {
  const lines = [];
  const meta = payload.sample || {};
  lines.push(`Sample: ${meta.rounds ?? '?'} round(s) over ${meta.timeFilter || 'all-time'}${meta.courseName ? ` at ${meta.courseName}` : ''}.`);
  lines.push('');

  const sc = payload.scoring || {};
  lines.push('## SCORING');
  lines.push(`- Average score: ${n(sc.avgScore, 1)} (${sg(sc.avgVsPar)} vs par)`);
  if (sc.birdieRate != null) lines.push(`- Birdie+ rate: ${pct(sc.birdieRate)}`);
  if (sc.bogeyRate != null) lines.push(`- Bogey+ rate: ${pct(sc.bogeyRate)}`);
  if (sc.parBreakdown) {
    const pb = sc.parBreakdown;
    const parts = [];
    if (pb[3]?.avg != null) parts.push(`P3 ${n(pb[3].avg, 2)}`);
    if (pb[4]?.avg != null) parts.push(`P4 ${n(pb[4].avg, 2)}`);
    if (pb[5]?.avg != null) parts.push(`P5 ${n(pb[5].avg, 2)}`);
    if (parts.length) lines.push(`- By par avg strokes: ${parts.join(' · ')}`);
  }

  lines.push('');
  lines.push('## OFF THE TEE');
  const drv = payload.driving || {};
  lines.push(`- Fairways hit: ${pct(drv.firPct)}`);
  if (drv.dominantMissDir) lines.push(`- Dominant tee-shot miss: ${drv.dominantMissDir}`);

  lines.push('');
  lines.push('## APPROACH');
  const app = payload.approach || {};
  lines.push(`- GIR: ${pct(app.girPct)}`);
  if (app.proxFromFairway != null) lines.push(`- Approach proximity from fairway (median): ${n(app.proxFromFairway, 1)} ft`);
  if (app.proxFromRough != null) lines.push(`- Approach proximity from rough (median): ${n(app.proxFromRough, 1)} ft`);
  if (app.dominantMissDir) lines.push(`- Dominant green-miss direction: ${app.dominantMissDir}`);

  lines.push('');
  lines.push('## SHORT GAME');
  const sg2 = payload.shortGame || {};
  if (sg2.scramblingPct != null) lines.push(`- Scrambling: ${pct(sg2.scramblingPct)}`);
  if (sg2.sandSavePct != null) lines.push(`- Sand save: ${pct(sg2.sandSavePct)} (${sg2.sandSaveAttempts ?? '?'} attempts)`);
  if (sg2.byLie) {
    const bl = sg2.byLie;
    const parts = [];
    if (bl.fromFairway?.pct != null) parts.push(`fwy ${pct(bl.fromFairway.pct)}`);
    if (bl.fromRough?.pct != null) parts.push(`rough ${pct(bl.fromRough.pct)}`);
    if (bl.fromSand?.pct != null) parts.push(`sand ${pct(bl.fromSand.pct)}`);
    if (parts.length) lines.push(`- Scrambling by lie: ${parts.join(' · ')}`);
  }

  lines.push('');
  lines.push('## PUTTING');
  const p = payload.putting || {};
  if (p.puttsPerHole != null) lines.push(`- Putts per hole: ${n(p.puttsPerHole, 2)}`);
  if (p.threePuttRate != null) lines.push(`- 3-putt rate: ${pct(p.threePuttRate)}`);
  if (p.makeInside3 != null) lines.push(`- Make % inside 3 ft: ${pct(p.makeInside3)}`);
  if (p.makeFrom6 != null) lines.push(`- Make % from 6 ft: ${pct(p.makeFrom6)} (Tour ~70%)`);
  if (p.makeFrom10 != null) lines.push(`- Make % from 10 ft: ${pct(p.makeFrom10)}`);
  if (p.lagAvgFirstPuttFeet != null) lines.push(`- Avg first putt distance: ${n(p.lagAvgFirstPuttFeet, 1)} ft`);
  if (p.lagOver20ftDistTo2nd != null) lines.push(`- After 20ft+ first putt, avg distance left: ${n(p.lagOver20ftDistTo2nd, 1)} ft`);

  if (payload.sg) {
    lines.push('');
    lines.push('## STROKES GAINED (vs Tour baseline, per round)');
    const s = payload.sg;
    lines.push(`- Total: ${sg(s.total)}`);
    lines.push(`- Off tee: ${sg(s.tee)}  ·  Approach: ${sg(s.approach)}  ·  Around green: ${sg(s.around)}  ·  Putting: ${sg(s.putt)}`);
  }

  if (Array.isArray(payload.worstHoles) && payload.worstHoles.length > 0) {
    lines.push('');
    lines.push('## STROKE-LEAKING HOLES (where you historically lose the most)');
    for (const h of payload.worstHoles.slice(0, 5)) {
      lines.push(`- ${h.courseName} hole ${h.holeNumber}${h.par ? ` (Par ${h.par})` : ''}: ${sg(h.avgSG)}/round avg over ${h.attempts} attempts`);
    }
  }

  return lines.join('\n');
}

/**
 * Call the Gemini REST API with the given prompt.
 * Returns the text response or throws an HttpsError.
 */
async function callGemini(systemPrompt, userPrompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      { role: 'user', parts: [{ text: userPrompt }] },
    ],
    generationConfig: {
      temperature: 0.6,
      // 2048 is plenty for the structured "Diagnosis + 3-5 drills +
      // Quick win" output the system prompt asks for. We hit 1024
      // truncation in practice when thinking tokens (below) were
      // enabled by default.
      maxOutputTokens: 2048,
      topP: 0.9,
      // Disable Gemini 2.5's built-in thinking. The output is a
      // structured response from pre-aggregated stats — there's no
      // chain-of-thought reasoning to do, and thinking tokens were
      // eating most of the output budget, leaving truncated drills.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new HttpsError('internal', `Gemini API request failed: ${err.message}`);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    if (resp.status === 429) {
      throw new HttpsError('resource-exhausted', 'Gemini API rate limit hit. Try again in a moment.');
    }
    throw new HttpsError('internal', `Gemini API returned ${resp.status}: ${text.slice(0, 500)}`);
  }
  const data = await resp.json();
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) {
    // Common failure modes: safety block, finishReason === 'OTHER'.
    const reason = candidate?.finishReason || 'unknown';
    throw new HttpsError('internal', `Gemini API returned no content (finishReason: ${reason}).`);
  }
  // Surface truncation explicitly so the caller can decide to retry
  // with a larger budget instead of silently shipping half a response.
  if (candidate?.finishReason === 'MAX_TOKENS') {
    console.warn('Gemini response truncated at MAX_TOKENS — consider raising maxOutputTokens.');
  }
  return text;
}

export const getCoachRecommendation = onCall(
  { secrets: [GEMINI_API_KEY], timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in to get coach recommendations.');
    }
    const payload = request.data?.stats;
    if (!payload || typeof payload !== 'object') {
      throw new HttpsError('invalid-argument', 'Missing or invalid stats payload.');
    }
    // Sample-size gate — refuse to coach on too little data.
    const rounds = payload?.sample?.rounds ?? 0;
    if (rounds < 3) {
      throw new HttpsError('failed-precondition', 'Need at least 3 completed rounds to generate recommendations.');
    }
    const userPrompt = buildStatsBlock(payload);
    const apiKey = GEMINI_API_KEY.value();
    const text = await callGemini(SYSTEM_PROMPT, userPrompt, apiKey);
    return {
      recommendation: text,
      model: GEMINI_MODEL,
      generatedAt: new Date().toISOString(),
    };
  }
);
