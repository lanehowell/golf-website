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

// The Gemini model used for coach + round review + hole analysis.
// Gemini 3.1 Flash Lite has 500 RPD on this account's free tier
// (vs 20 RPD on 2.5 Flash / 2.5 Flash Lite). Same API shape, so
// no other code changes needed.
//
// Fallback options if 500 RPD isn't enough:
//   - 'gemma-3-27b-it' (or similar Gemma) — 1500 RPD, different
//     model family with looser structured-output behavior
//   - swap back to 'gemini-2.5-flash' for stronger reasoning at
//     20 RPD on this account
const GEMINI_MODEL = 'gemini-3.1-flash-lite';

// ─────────────────────────────────────────────────────────────────────
// PROMPT
// The system prompt sets the coach persona + output format. The user
// prompt is a structured stats summary built from the client payload.
// ─────────────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are a golf coach analyzing a player's recent performance data to recommend practice drills.

Your output MUST follow this exact markdown structure:

## Diagnosis
ONE sentence (two at most, only if a club callout is required). Name the player's biggest weakness within the requested scope and LEAD WITH THE SPECIFIC NUMBER from the data. No preamble like "Overall," "Looking at your data," "In summary," "It seems," or restating the scope. Example: "Your 6-10 ft putts make at 38%, well below Tour ~70%."

## Practice plan
Numbered list of 3-5 drills, each formatted as:

**1. Drill name** — 1-sentence description of what to do.
- Where: range / putting green / chipping area / course
- Duration: e.g., 20 minutes
- Success criteria: a concrete, measurable target (e.g., "make 8 of 10 from 6 ft")

## Quick win
One drill the player can do in 15 minutes today to make a noticeable difference. One sentence.

Rules:
- PLAYER REQUEST OVERRIDE: If the user prompt opens with a "## PLAYER REQUEST (PRIMARY TOPIC)" block, that topic is a hard constraint. The Diagnosis MUST be about THAT topic. At least one drill MUST directly target it. Do not substitute another weakness from the stats — even if the stats suggest a bigger leak elsewhere. Use the stats only to find the specific failure mode within the requested topic. If the request names a specific club (e.g., "Driver", "7-iron"), anchor on THAT club's row in CLUB BAG — do not pivot to a different club in the same scope.
- Be CONCRETE. "Make 7 out of 10 putts from 6 feet" beats "improve short putting".
- Reference the player's specific weak numbers in the Diagnosis.
- Order drills by impact — the one that addresses their worst weakness goes first.
- Do not invent stats the player didn't provide.
- Do not recommend drills outside golf practice (e.g., no gym work).
- Keep total response under 400 words.
- When the data includes per-distance, per-lie, or per-club breakdowns, reference specific buckets in the Diagnosis (e.g., "your 10-20 ft putt make rate of 22% is well below the Tour average of ~40%").
- CLUB CALLOUTS: when a club row in CLUB BAG has a "Note:" sub-line, that club has a flagged anomaly (dispersion bias or low clean-contact rate). You MUST (a) name that club by name in the Diagnosis, and (b) include at least one drill in the Practice plan specifically targeting that anomaly. Dispersion bias → an alignment / setup / face-control drill (e.g., gate drill with tees, alignment sticks, mirror work). Low clean contact → a contact-quality drill (e.g., impact bag, foot-powder face check, half-swing tempo work). Apply the HANDEDNESS rule below when describing miss shape (a right miss is a push/fade for a right-hander, a pull/hook for a left-hander).
- When RECENT FORM shows a clear trend (↓ or ↑), call out whether the player is regressing or improving in the Diagnosis.
- HANDEDNESS: The PLAYER PROFILE section at the top of the data block lists the golfer's handedness. ALL direction-based advice (fades, draws, miss patterns, target lines, club face angles) MUST be relative to that handedness. For a LEFT-HANDED player, a fade moves the ball LEFT (not right) and a draw moves it RIGHT (not left) — the opposite of right-handed terminology. Never assume right-handed. Never recommend "hit a fade to counteract a left miss" to a left-handed player; that advice goes the wrong way.`;

// Scope configurations — each adds a focus instruction to the base
// system prompt + tells the client which fields to emphasize.
// 'full' = no extra constraints; the others narrow what drills are
// allowed so the response stays on-topic for what the player asked.
const SCOPE_CONFIG = {
  full: {
    label: 'full practice plan',
    extraRules: '',
  },
  putting: {
    label: 'putting-focused plan',
    extraRules: `- SCOPE: This is a PUTTING-only plan. Every drill must be done on a putting green or putting mat.
- Lead the Diagnosis with putting-specific numbers (make %, 3-putt rate, lag putting, putts per GIR).
- Do not recommend full-swing, chipping, bunker, or course-management work.`,
  },
  'short-game': {
    label: 'short-game plan',
    extraRules: `- SCOPE: This is a SHORT-GAME plan (inside 50 yards). Every drill must focus on chipping, pitching, or bunker play.
- Lead the Diagnosis with scrambling, sand-save, and approach-proximity numbers.
- Do not recommend putting-only or full-swing drills.`,
  },
  approach: {
    label: 'approach-shot plan',
    extraRules: `- SCOPE: This is an APPROACH-SHOT plan (50+ yard full swings into greens). Drills must be range-based or course-based.
- Lead the Diagnosis with GIR%, approach proximity by distance/lie, and approach SG.
- Do not recommend putting, chipping, or driver-specific drills.`,
  },
  tee: {
    label: 'tee-shot plan',
    extraRules: `- SCOPE: This is a TEE-SHOT plan (driver + long clubs off the tee). Drills must be range or course based.
- Lead the Diagnosis with fairway %, miss-pattern, and SG off the tee.
- Do not recommend approach, short-game, or putting drills.`,
  },
  range: {
    label: 'range-session plan',
    extraRules: `- SCOPE: This is a RANGE-SESSION plan. Every drill MUST be doable at a standard driving range — no putting green, no chipping/bunker green, no on-course work.
- Cover the player's full-swing weaknesses (driving, approach, wedges into a range green if available).
- Do not recommend any putting or short-game drills that require a real green.`,
  },
};

function buildSystemPrompt(scope) {
  const cfg = SCOPE_CONFIG[scope] || SCOPE_CONFIG.full;
  if (!cfg.extraRules) return BASE_SYSTEM_PROMPT;
  return `${BASE_SYSTEM_PROMPT}\n\nScope rules:\n${cfg.extraRules}`;
}

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

  // Lead with the player profile so handedness/etc. frame everything
  // that follows. Defensive default to 'right' since that's by far
  // the majority case and matches the client's own default.
  const profile = payload.playerProfile || {};
  const handedness = profile.handedness === 'left' ? 'left' : 'right';
  lines.push('## PLAYER PROFILE');
  lines.push(`- Handedness: ${handedness}-handed`);
  if (handedness === 'left') {
    lines.push('- IMPORTANT: ball-flight terminology is mirrored. For this player, a fade goes LEFT and a draw goes RIGHT.');
  }
  lines.push('');

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

  // RECENT FORM — recent N rounds vs lifetime deltas. Polarity-aware
  // so the model doesn't have to guess: ↓ = lower number recently;
  // we append "(recent better)" / "(recent worse)" based on the
  // metric's natural direction (lower-is-better for score / putts;
  // higher-is-better for fairways / greens).
  if (payload.recentTrend && typeof payload.recentTrend === 'object') {
    const rt = payload.recentTrend;
    const fmtDelta = (delta, opts) => {
      if (typeof delta !== 'number' || !Number.isFinite(delta)) return null;
      const lowerIsBetter = !!opts?.lowerIsBetter;
      const isPct = !!opts?.isPct;
      const digits = opts?.digits ?? 1;
      const flat = Math.abs(delta) < (opts?.flatBand ?? 0.05);
      const arrow = flat ? '→' : (delta > 0 ? '↑' : '↓');
      const tag = flat
        ? 'flat'
        : ((delta < 0) === lowerIsBetter ? 'recent better' : 'recent worse');
      const mag = isPct
        ? `${Math.abs(delta).toFixed(0)}%`
        : Math.abs(delta).toFixed(digits);
      return flat ? `${arrow} flat` : `${arrow} ${mag} (${tag})`;
    };
    const rows = [];
    const score = fmtDelta(rt.scoreDelta, { lowerIsBetter: true });
    const fir = fmtDelta(rt.firDelta, { lowerIsBetter: false, isPct: true, flatBand: 1 });
    const gir = fmtDelta(rt.girDelta, { lowerIsBetter: false, isPct: true, flatBand: 1 });
    const pph = fmtDelta(rt.puttsPerHoleDelta, { lowerIsBetter: true, digits: 2, flatBand: 0.02 });
    if (score) rows.push(`- Score: ${score}`);
    if (fir) rows.push(`- Fairways: ${fir}`);
    if (gir) rows.push(`- Greens: ${gir}`);
    if (pph) rows.push(`- Putts/hole: ${pph}`);
    if (rows.length > 0) {
      lines.push('');
      lines.push(`## RECENT FORM (last ${rt.n ?? '?'} rounds vs lifetime)`);
      for (const r of rows) lines.push(r);
    }
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

  // APPROACH BY DISTANCE — median proximity per yardage band. Drives
  // recommendations like "your 150–200 yd shots are landing 42 ft
  // from the pin, prioritize that bucket on the range."
  if (payload.approachDetail?.byDistance?.length > 0) {
    lines.push('');
    lines.push('## APPROACH PROXIMITY BY DISTANCE (median feet from pin)');
    for (const b of payload.approachDetail.byDistance) {
      const med = (typeof b.medianProximityFt === 'number') ? `${Math.round(b.medianProximityFt)} ft median` : 'no median';
      const gir = (typeof b.girPct === 'number') ? `${Math.round(b.girPct)}% GIR` : '';
      lines.push(`- ${b.label}: ${med}, ${b.shots} shot${b.shots === 1 ? '' : 's'}${gir ? `, ${gir}` : ''}`);
    }
  }

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

  // PUTTING BY DISTANCE — make % per bucket. Lets the coach call
  // out specific weak zones ("your 5-10 ft is the leak").
  if (payload.puttingDetail?.byDistanceBucket?.length > 0) {
    lines.push('');
    lines.push('## PUTTING BY DISTANCE');
    for (const b of payload.puttingDetail.byDistanceBucket) {
      const pctStr = (typeof b.makePct === 'number') ? `${Math.round(b.makePct)}%` : '—';
      lines.push(`- ${b.label}: ${pctStr} (${b.made} of ${b.attempts})`);
    }
  }

  // 3-PUTT RATE BY FIRST-PUTT DISTANCE — pairs naturally with
  // lag-putting numbers in the PUTTING section above.
  if (payload.puttingDetail?.threePuttRateByFirstPuttBucket?.length > 0) {
    lines.push('');
    lines.push('## 3-PUTT RATE BY FIRST-PUTT DISTANCE');
    for (const b of payload.puttingDetail.threePuttRateByFirstPuttBucket) {
      const pctStr = (typeof b.pct === 'number') ? `${Math.round(b.pct)}%` : '—';
      lines.push(`- ${b.label}: ${pctStr} (${b.threePutts} of ${b.holes} hole${b.holes === 1 ? '' : 's'})`);
    }
  }

  // CLUB BAG — per-club aggregates from range + on-course logged
  // shots. Top clubs by sample size, with avg carry, GPS distance,
  // and L/S/R dispersion split. Drives club-specific advice like
  // "your 7i carries 12 yd shorter than expected."
  if (Array.isArray(payload.clubData) && payload.clubData.length > 0) {
    lines.push('');
    lines.push('## CLUB BAG (range + on-course shots, top by sample size)');
    for (const c of payload.clubData) {
      const distParts = [];
      if (typeof c.carryAvg === 'number' && c.carryAvg > 0) distParts.push(`${c.carryAvg} yd avg carry`);
      else if (typeof c.gpsAvg === 'number' && c.gpsAvg > 0) distParts.push(`${c.gpsAvg} yd avg on course`);
      const distStr = distParts.length > 0 ? distParts.join(' · ') : 'no distance data';
      let dispStr = '';
      if (typeof c.dispStraightPct === 'number') {
        dispStr = ` · ${c.dispLeftPct ?? 0}% L / ${c.dispStraightPct}% S / ${c.dispRightPct ?? 0}% R`;
      }
      const contactStr = (typeof c.contactCleanPct === 'number')
        ? ` · ${c.contactCleanPct}% clean`
        : '';
      lines.push(`- ${c.club}: ${distStr} (${c.shots} shot${c.shots === 1 ? '' : 's'})${dispStr}${contactStr}`);
      // Anomaly note line — only present when the client flagged
      // something (dispersion bias, low contact). Indented so it
      // reads as a sub-bullet under the club row. The CLUB CALLOUTS
      // rule in BASE_SYSTEM_PROMPT mandates that any club with a
      // Note line gets named in the Diagnosis with a targeted drill.
      if (Array.isArray(c.anomalies) && c.anomalies.length > 0) {
        const notes = c.anomalies
          .map(a => (a && typeof a.promptNote === 'string') ? a.promptNote : null)
          .filter(s => s && s.length > 0)
          .join('. ');
        if (notes) lines.push(`    Note: ${notes}.`);
      }
    }
  }

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
async function callGemini(systemPrompt, userPrompt, apiKey, opts) {
  opts = opts || {};
  const maxOutputTokens = typeof opts.maxOutputTokens === 'number'
    ? opts.maxOutputTokens : 2048;
  const temperature = typeof opts.temperature === 'number'
    ? opts.temperature : 0.6;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      { role: 'user', parts: [{ text: userPrompt }] },
    ],
    generationConfig: {
      temperature,
      // Default 2048 is plenty for the structured Coach response;
      // smaller callables (per-hole analysis) pass 512 to save tokens.
      // We hit 1024 truncation in practice when thinking tokens
      // (below) were enabled by default.
      maxOutputTokens,
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
    // Scope + custom focus. Both optional. Scope must be one of the
    // known keys (defensive — refuse unknown values rather than fall
    // through silently).
    const rawScope = String(request.data?.scope || 'full').toLowerCase();
    const scope = SCOPE_CONFIG[rawScope] ? rawScope : 'full';
    const customFocusRaw = typeof request.data?.customFocus === 'string'
      ? request.data.customFocus.trim()
      : '';
    // Cap user-supplied text so a giant paste can't blow our prompt
    // budget or pad the context. 240 chars is enough for "I have a
    // tournament Saturday at Riverside — emphasize tee shots on long
    // par 4s." and similar.
    const customFocus = customFocusRaw.slice(0, 240);

    // Book-end the custom focus at TOP and BOTTOM of the user prompt
    // when present. Putting it only at the end (after a long stats
    // block) made the model drift — it would pick whatever weakness
    // the data suggested and ignore the player's explicit request.
    // Two surfaces + strong language keep it sticky.
    let userPrompt = '';
    if (customFocus) {
      userPrompt += `## PLAYER REQUEST (PRIMARY TOPIC)\n`;
      userPrompt += `The player specifically asked: "${customFocus}"\n`;
      userPrompt += `This is the primary subject of the plan. The Diagnosis MUST address THIS topic. At least one drill MUST target it. Do not substitute another weakness from the stats below — even if the stats suggest a different leak, the player asked about this one. Use the stats to find the SPECIFIC failure mode within the requested topic.\n\n`;
    }
    userPrompt += buildStatsBlock(payload);
    userPrompt += `\n\nRequested scope: ${SCOPE_CONFIG[scope].label}.`;
    if (customFocus) {
      userPrompt += `\n\nREMINDER: the player specifically asked about "${customFocus}". Stay on that topic. Do not pivot to a different weakness from the stats. If the requested topic is "Driver" or a specific club, anchor the Diagnosis on that club's row in CLUB BAG — not on a different long club.`;
    }

    const systemPrompt = buildSystemPrompt(scope);
    const apiKey = GEMINI_API_KEY.value();
    const text = await callGemini(systemPrompt, userPrompt, apiKey);
    return {
      recommendation: text,
      model: GEMINI_MODEL,
      generatedAt: new Date().toISOString(),
      scope,
      customFocus,
      // Return the rendered stats block so the client can show
      // "what was sent to Gemini" without duplicating the formatter.
      statsBlock: userPrompt,
    };
  }
);

// ═════════════════════════════════════════════════════════════════════
// ROUND REVIEW — getRoundReview
// Reviews a single completed round. Returns a short markdown writeup:
// what went well, what cost strokes, and one drill to fix the worst
// issue. Different prompt + payload shape from the practice plan
// callable — this one is per-round, not aggregate.
// ═════════════════════════════════════════════════════════════════════

const ROUND_REVIEW_SYSTEM_PROMPT = `You are a golf coach reviewing one specific round the player just played. Your job is to surface what was strong, what cost them strokes, and one drill to fix the worst issue.

Your output MUST follow this exact markdown structure:

## How you played
1-2 sentence overview referencing the actual score vs par and the round's biggest theme (e.g., "Solid 78 +6 — putting carried you, approach hurt you").

## What worked
- Bullet 1: a strength the data shows. Reference a specific hole/number.
- Bullet 2: another strength.
(2-3 bullets total, max.)

## What cost you strokes
- Bullet 1: the biggest issue. Reference specific holes or a pattern.
- Bullet 2: another issue.
(2-3 bullets total, max.)

## Drill to fix it
**One drill** — 1-sentence description, where to do it, duration, success criteria.

Rules:
- Reference REAL numbers from the data (specific holes, SG values, putts).
- Don't invent stats the data doesn't show.
- Be specific and direct — no platitudes.
- Total response under 350 words.
- HANDEDNESS: ball-flight terminology is RELATIVE to the player's handedness in PLAYER PROFILE. For a left-handed player, a fade goes LEFT (not right) and a draw goes RIGHT (not left). Never assume right-handed.`;

/**
 * Build the user prompt body for a round review. Whitelists the round
 * fields we send — never echoes the raw round doc to the model.
 * payload: { playerProfile, round, sg }
 *   - playerProfile: { handedness }
 *   - round: { scorecard, totals, format, dateKey, courseName, ... }
 *   - sg: pre-computed SG object from computeRoundSG (perShot etc.)
 */
function buildRoundReviewBlock(payload) {
  const lines = [];
  const profile = payload.playerProfile || {};
  const handedness = profile.handedness === 'left' ? 'left' : 'right';
  lines.push('## PLAYER PROFILE');
  lines.push(`- Handedness: ${handedness}-handed`);
  if (handedness === 'left') {
    lines.push('- IMPORTANT: ball-flight terminology is mirrored. For this player, a fade goes LEFT and a draw goes RIGHT.');
  }
  lines.push('');

  const round = payload.round || {};
  // Renamed from `sg` to `sgData` to avoid shadowing the module-scope
  // `sg()` formatter function defined near the top of this file.
  const sgData = payload.sg || null;

  lines.push('## ROUND SUMMARY');
  lines.push(`- Course: ${round.courseName || 'unknown'}`);
  lines.push(`- Date: ${round.dateKey || '?'}`);
  lines.push(`- Format: ${round.format || 'standard'}`);
  if (round.totals) {
    const t = round.totals;
    const parts = [];
    if (typeof t.strokes === 'number') parts.push(`${t.strokes} strokes`);
    if (typeof t.vsPar === 'number') {
      const vp = t.vsPar === 0 ? 'E' : (t.vsPar > 0 ? `+${t.vsPar}` : String(t.vsPar));
      parts.push(`${vp} vs par`);
    }
    if (typeof t.holesPlayed === 'number') parts.push(`${t.holesPlayed} holes`);
    if (parts.length) lines.push(`- Score: ${parts.join(' · ')}`);
    if (typeof t.putts === 'number' && typeof t.holesPlayed === 'number' && t.holesPlayed > 0) {
      lines.push(`- Putts: ${t.putts} (${(t.putts / t.holesPlayed).toFixed(2)}/hole)`);
    }
    if (typeof t.firHit === 'number' && typeof t.firEligible === 'number' && t.firEligible > 0) {
      lines.push(`- Fairways: ${t.firHit} of ${t.firEligible} (${Math.round((t.firHit / t.firEligible) * 100)}%)`);
    }
    if (typeof t.girHit === 'number' && typeof t.girEligible === 'number' && t.girEligible > 0) {
      lines.push(`- Greens in reg: ${t.girHit} of ${t.girEligible} (${Math.round((t.girHit / t.girEligible) * 100)}%)`);
    }
  }

  // Per-hole scoring summary (highlights the swings)
  if (Array.isArray(round.scorecard) && round.scorecard.length > 0) {
    lines.push('');
    lines.push('## PER-HOLE SCORING');
    for (const h of round.scorecard) {
      if (!h) continue;
      const vsPar = (typeof h.strokes === 'number' && typeof h.par === 'number') ? h.strokes - h.par : null;
      const vsStr = vsPar == null ? '' : (vsPar === 0 ? 'E' : (vsPar > 0 ? ` +${vsPar}` : ` ${vsPar}`));
      const flags = [];
      if (h.fir === true) flags.push('FIR');
      if (h.fir === false) flags.push('FIR-miss');
      if (h.gir === true) flags.push('GIR');
      if (h.gir === false) flags.push('GIR-miss');
      if (typeof h.putts === 'number') flags.push(`${h.putts}p`);
      if (typeof h.penalties === 'number' && h.penalties > 0) flags.push(`+${h.penalties}pen`);
      lines.push(`- H${h.number} (P${h.par || '?'}): ${h.strokes ?? '—'}${vsStr}${flags.length ? ` · ${flags.join(', ')}` : ''}`);
    }
  }

  // Strokes gained totals + per-category breakdown.
  if (sgData && sgData.totals) {
    lines.push('');
    lines.push('## STROKES GAINED (this round)');
    lines.push(`- Total: ${formatSG(sgData.totals.total)}`);
    lines.push(`- Off tee: ${formatSG(sgData.totals.tee)} · Approach: ${formatSG(sgData.totals.approach)} · Around: ${formatSG(sgData.totals.around)} · Putting: ${formatSG(sgData.totals.putt)}`);
    if (sgData.coverage && typeof sgData.coverage.holesAnalyzed === 'number') {
      lines.push(`- Coverage: ${sgData.coverage.holesAnalyzed} of ${sgData.coverage.holesTotal} holes have SG data`);
    }
  }

  // Top-3 worst holes by SG within this round (the stroke leakers
  // specific to THIS round; different from the lifetime ranking the
  // practice plan uses).
  if (sgData && Array.isArray(sgData.perShot)) {
    const byHole = new Map();
    for (const c of sgData.perShot) {
      if (!c || typeof c.holeNumber !== 'number' || typeof c.sg !== 'number') continue;
      const cur = byHole.get(c.holeNumber) || { sgTotal: 0, byCat: {} };
      cur.sgTotal += c.sg;
      cur.byCat[c.category] = (cur.byCat[c.category] || 0) + c.sg;
      byHole.set(c.holeNumber, cur);
    }
    const rows = Array.from(byHole.entries())
      .map(([hn, v]) => ({ hn, ...v }))
      .filter(r => r.sgTotal < 0)
      .sort((a, b) => a.sgTotal - b.sgTotal)
      .slice(0, 3);
    if (rows.length > 0) {
      lines.push('');
      lines.push('## WORST HOLES (this round, by SG)');
      for (const r of rows) {
        const catParts = Object.entries(r.byCat)
          .filter(([, v]) => Math.abs(v) >= 0.1)
          .sort((a, b) => a[1] - b[1])
          .map(([k, v]) => `${k} ${formatSG(v)}`);
        lines.push(`- H${r.hn}: total ${formatSG(r.sgTotal)}${catParts.length ? ` (${catParts.join(', ')})` : ''}`);
      }
    }
  }

  // Penalty list — specific shots that cost a stroke. Helps the model
  // call out "you hit it OB on 14" style insights.
  if (Array.isArray(round.penaltyShots) && round.penaltyShots.length > 0) {
    lines.push('');
    lines.push('## PENALTY SHOTS');
    for (const p of round.penaltyShots.slice(0, 8)) {
      const parts = [`H${p.holeNumber}`];
      if (p.club) parts.push(p.club);
      if (p.kind) parts.push(p.kind);
      lines.push(`- ${parts.join(' · ')}`);
    }
  }

  return lines.join('\n');
}

// Local SG formatter — duplicates client behavior so the prompt is
// consistent ("+1.2" / "-0.4" / "0.0").
function formatSG(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  const r = Math.round(v * 10) / 10;
  if (r === 0) return '0.0';
  return r > 0 ? `+${r.toFixed(1)}` : r.toFixed(1);
}

export const getRoundReview = onCall(
  { secrets: [GEMINI_API_KEY], timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in to get a round review.');
    }
    const payload = request.data || {};
    if (!payload.round || typeof payload.round !== 'object') {
      throw new HttpsError('invalid-argument', 'Missing round data.');
    }
    // Sample-size gate: don't review rounds with no scoring or only
    // a couple holes — model can't say anything useful.
    const holesPlayed = payload.round?.totals?.holesPlayed ?? 0;
    if (holesPlayed < 3) {
      throw new HttpsError('failed-precondition', 'Need at least 3 holes of data to review the round.');
    }
    const userPrompt = buildRoundReviewBlock(payload);
    const apiKey = GEMINI_API_KEY.value();
    // 1024 tokens — round review is shorter than a full practice plan.
    const text = await callGemini(ROUND_REVIEW_SYSTEM_PROMPT, userPrompt, apiKey, { maxOutputTokens: 1024 });
    return {
      recommendation: text,
      model: GEMINI_MODEL,
      generatedAt: new Date().toISOString(),
      scope: 'round-review',
      statsBlock: userPrompt,
    };
  }
);

// ═════════════════════════════════════════════════════════════════════
// HOLE ANALYSIS — getHoleAnalysis
// Focused 2-paragraph + 1-drill writeup on a single hole. Triggered
// from the per-hole drill-down sheet. Compact prompt, compact output.
// ═════════════════════════════════════════════════════════════════════

const HOLE_ANALYSIS_SYSTEM_PROMPT = `You are a golf coach analyzing a single hole from the player's round.

Your output MUST follow this exact markdown structure:

## What happened
2-3 sentences explaining what the shot-by-shot data shows. Reference specific shots (e.g., "the approach from 145 left you 38 ft").

## Quick drill
**Drill name** — 1-sentence description, where, duration, success criteria.

Rules:
- Reference actual numbers from the shot data.
- Don't invent stats the data doesn't show.
- Total response under 150 words.
- HANDEDNESS: ball-flight terminology is RELATIVE to the player's handedness. For a left-handed player, a fade goes LEFT (not right) and a draw goes RIGHT (not left).`;

function buildHoleAnalysisBlock(payload) {
  const lines = [];
  const profile = payload.playerProfile || {};
  const handedness = profile.handedness === 'left' ? 'left' : 'right';
  lines.push(`Player: ${handedness}-handed`);
  if (handedness === 'left') {
    lines.push('IMPORTANT: ball-flight terminology is mirrored for this player.');
  }
  lines.push('');

  const hole = payload.hole || {};
  lines.push('## HOLE INFO');
  lines.push(`- Hole ${hole.number ?? '?'} (Par ${hole.par ?? '?'})`);
  if (typeof hole.yardage === 'number') lines.push(`- Yardage: ${hole.yardage}`);
  if (typeof hole.strokes === 'number') {
    const vp = (typeof hole.par === 'number') ? hole.strokes - hole.par : null;
    const vpStr = vp == null ? '' : ` (${vp === 0 ? 'E' : (vp > 0 ? `+${vp}` : String(vp))})`;
    lines.push(`- Score: ${hole.strokes}${vpStr}`);
  }
  if (typeof hole.putts === 'number') lines.push(`- Putts: ${hole.putts}`);
  if (hole.fir === true) lines.push('- Hit the fairway');
  else if (hole.fir === false) lines.push(`- Missed fairway${hole.firMiss ? ` (${hole.firMiss})` : ''}`);
  if (hole.gir === true) lines.push('- Hit the green in regulation');
  else if (hole.gir === false) lines.push(`- Missed green${hole.girMiss ? ` (${hole.girMiss})` : ''}`);

  // Shot-by-shot breakdown.
  if (Array.isArray(hole.shots) && hole.shots.length > 0) {
    lines.push('');
    lines.push('## SHOT-BY-SHOT');
    hole.shots.forEach((s, i) => {
      const parts = [`Shot ${i + 1}`];
      if (s.club) parts.push(s.club);
      if (typeof s.distance === 'number') parts.push(`${s.distance} yd target`);
      if (typeof s.actualYards === 'number') parts.push(`${Math.round(s.actualYards)} yd traveled`);
      if (s.startLie) parts.push(`from ${s.startLie}`);
      if (typeof s.proximityFt === 'number') parts.push(`${Math.round(s.proximityFt)} ft to pin after`);
      if (typeof s.sg === 'number') parts.push(`SG ${formatSG(s.sg)}`);
      if (s.category) parts.push(`(${s.category})`);
      if (s.endedInTrouble) parts.push('PENALTY');
      lines.push(`- ${parts.join(' · ')}`);
    });
  }

  // Per-category SG for this hole, if computed.
  if (payload.holeSG && typeof payload.holeSG === 'object') {
    const h = payload.holeSG;
    lines.push('');
    lines.push('## STROKES GAINED (this hole)');
    const parts = [];
    if (typeof h.tee === 'number') parts.push(`Tee ${formatSG(h.tee)}`);
    if (typeof h.approach === 'number') parts.push(`Approach ${formatSG(h.approach)}`);
    if (typeof h.around === 'number') parts.push(`Around ${formatSG(h.around)}`);
    if (typeof h.putt === 'number') parts.push(`Putt ${formatSG(h.putt)}`);
    if (parts.length) lines.push(`- ${parts.join(' · ')}`);
    if (typeof h.total === 'number') lines.push(`- Total: ${formatSG(h.total)}`);
  }

  return lines.join('\n');
}

export const getHoleAnalysis = onCall(
  { secrets: [GEMINI_API_KEY], timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in to ask about this hole.');
    }
    const payload = request.data || {};
    if (!payload.hole || typeof payload.hole !== 'object') {
      throw new HttpsError('invalid-argument', 'Missing hole data.');
    }
    const userPrompt = buildHoleAnalysisBlock(payload);
    const apiKey = GEMINI_API_KEY.value();
    // 512 tokens — hole analysis is very short.
    const text = await callGemini(HOLE_ANALYSIS_SYSTEM_PROMPT, userPrompt, apiKey, { maxOutputTokens: 512 });
    return {
      analysis: text,
      model: GEMINI_MODEL,
      generatedAt: new Date().toISOString(),
      statsBlock: userPrompt,
    };
  }
);

// ═════════════════════════════════════════════════════════════════════
// RANGE SESSION DEBRIEF — getRangeSessionDebrief
// Reviews one completed range session. Returns short markdown:
// how the session went, what worked, what slipped, one takeaway.
// Compares per-club performance against the player's lifetime baseline
// so the model can flag improvement / regression in concrete terms.
// ═════════════════════════════════════════════════════════════════════

const RANGE_DEBRIEF_SYSTEM_PROMPT = `You are a golf coach reviewing one range session the player just finished. Your job is to surface what worked, what slipped, and one thing to carry forward.

Your output MUST follow this exact markdown structure:

## How the session went
ONE sentence (two at most). Reference the total shot count and the most notable club or pattern.

## What worked
- Bullet 1: a club or pattern that performed well. Reference specific numbers (e.g., "7-iron full-swing avg of 165y, up from 160y lifetime").
- Bullet 2 if there is a clear second win. (At most two bullets.)

## What slipped
- Bullet 1: a club or pattern that regressed or showed concerning dispersion / contact. Reference specific numbers.
- Bullet 2 if there is a clear second issue. (At most two bullets.)

## One thing to carry forward
A single concrete takeaway for next session or the next round. ONE sentence.

Rules:
- Reference REAL numbers from the data — full-swing avg, dispersion (either "yards from aim line" or L/S/R %), clean-contact %, vs-lifetime deltas.
- DISPERSION SHAPES: per-club rows describe dispersion in ONE of two ways depending on how the shots were logged. Use whichever the row gives you; never invent the other.
  (a) GPS shots — "avg Xy from aim line, leans Y left/right of aim" (signed yards). Magnitude is RELATIVE TO THE CLUB. Examples: 4y avg from aim is tight for a driver but wide for a wedge; 12y avg from aim is great for a driver but a disaster for a wedge. Judge per club.
  (b) Manual chips — L/S/R bucket percentages. Coarser; use the same per-club judgment.
- "Lifetime" baselines come from the player's full range + on-course history. Use them as the reference point for improvement / regression.
- Do not invent stats the data does not show.
- Be specific and direct — no platitudes ("good effort", "keep practicing").
- No preamble. Lead with the most important pattern.
- Total response under 280 words.
- HANDEDNESS: ball-flight terminology is RELATIVE to the player's handedness. For a LEFT-handed player, a fade moves the ball LEFT (not right) and a draw moves it RIGHT (not left). A "leans right of aim" miss for a left-hander is a pull or hook; for a right-hander it's a push or fade. Never assume right-handed.`;

/**
 * Build the user prompt body for a range session debrief. Whitelists
 * the session fields we send — never echoes raw shot rows to the
 * model. payload: { playerProfile, session, byClub, patternAnalysis? }
 *   - playerProfile: { handedness }
 *   - session: { dateKey, durationMin, count, avg, max, clubCount, targetedCount? }
 *   - byClub: array of per-club summaries (see _computeSessionPerClubStats
 *     in index.html for the source shape)
 *   - patternAnalysis: optional text snippet from the client's
 *     analyzeDispersion run on this session's targeted shots
 */
function buildRangeDebriefBlock(payload) {
  const lines = [];
  const profile = payload.playerProfile || {};
  const handedness = profile.handedness === 'left' ? 'left' : 'right';
  lines.push('## PLAYER PROFILE');
  lines.push(`- Handedness: ${handedness}-handed`);
  if (handedness === 'left') {
    lines.push('- IMPORTANT: ball-flight terminology is mirrored. For this player, a fade goes LEFT and a draw goes RIGHT.');
  }
  lines.push('');

  const s = payload.session || {};
  lines.push('## SESSION SUMMARY');
  if (s.dateKey) lines.push(`- Date: ${s.dateKey}`);
  if (typeof s.durationMin === 'number' && s.durationMin > 0) lines.push(`- Duration: ${s.durationMin} min`);
  if (typeof s.count === 'number') lines.push(`- Total shots: ${s.count}${typeof s.clubCount === 'number' ? ` across ${s.clubCount} club${s.clubCount === 1 ? '' : 's'}` : ''}`);
  if (typeof s.avg === 'number' && s.avg > 0) lines.push(`- Overall avg distance: ${s.avg} yd`);
  if (typeof s.targetedCount === 'number' && s.targetedCount > 0) lines.push(`- Targeted (GPS) shots: ${s.targetedCount}`);

  // Per-club table — session stats with lifetime deltas inline so the
  // model can see improvement / regression without doing math itself.
  if (Array.isArray(payload.byClub) && payload.byClub.length > 0) {
    lines.push('');
    lines.push('## PER-CLUB (this session vs lifetime baseline)');
    for (const c of payload.byClub) {
      const parts = [];
      parts.push(`${c.shots} shot${c.shots === 1 ? '' : 's'}`);
      // Full-swing average + lifetime delta
      if (typeof c.avg100 === 'number' && c.avg100 > 0) {
        const lifetime = (typeof c.lifetimeAvg === 'number' && c.lifetimeAvg > 0) ? c.lifetimeAvg : null;
        const delta = lifetime != null ? c.avg100 - lifetime : null;
        const deltaStr = delta != null
          ? ` (lifetime ${lifetime}, ${delta > 0 ? '+' : ''}${delta})`
          : '';
        parts.push(`full-swing avg ${c.avg100}y${deltaStr}`);
      }
      // Dispersion — TWO possible shapes depending on how the shots
      // were logged. GPS shots have actual yards-from-aim data
      // (preferred — magnitude is honest per club). Manual UI shots
      // fall back to coarse L/S/R bucket percentages.
      if (typeof c.avgAbsLateralYd === 'number') {
        // GPS lateral: pass through raw numbers + bias interpretation.
        // The model judges "tight" vs "wide" relative to the club
        // (4y avg is tight for a driver, wide for a wedge).
        const biasNote = (typeof c.avgLateralYd === 'number' && Math.abs(c.avgLateralYd) >= 1)
          ? (c.avgLateralYd > 0
              ? `leans ${Math.abs(c.avgLateralYd).toFixed(1)}y right of aim`
              : `leans ${Math.abs(c.avgLateralYd).toFixed(1)}y left of aim`)
          : 'no consistent side bias';
        const lifeStr = (typeof c.lifetimeAvgAbsLateralYd === 'number')
          ? ` (lifetime ${c.lifetimeAvgAbsLateralYd}y)`
          : '';
        parts.push(`avg ${c.avgAbsLateralYd}y from aim line${lifeStr}, ${biasNote}`);
        if (typeof c.maxAbsLateralYd === 'number' && c.maxAbsLateralYd > 0) {
          parts.push(`worst miss ${c.maxAbsLateralYd}y off aim`);
        }
      } else if (typeof c.dispStraightPct === 'number') {
        // Simple-UI L/S/R bucket fallback.
        const lifeStr = (typeof c.lifetimeDispStraightPct === 'number')
          ? ` (lifetime straight ${c.lifetimeDispStraightPct}%)`
          : '';
        parts.push(`${c.dispLeftPct ?? 0}% L / ${c.dispStraightPct}% S / ${c.dispRightPct ?? 0}% R${lifeStr}`);
      }
      // Contact — session clean% + lifetime clean%
      if (typeof c.contactCleanPct === 'number') {
        const lifeStr = (typeof c.lifetimeContactCleanPct === 'number')
          ? ` (lifetime ${c.lifetimeContactCleanPct}%)`
          : '';
        parts.push(`${c.contactCleanPct}% clean contact${lifeStr}`);
      }
      // Swing% mix — only mention if non-trivially mixed (some
      // throttled-back swings present alongside full swings)
      if (c.swingMix) {
        const sub = [];
        if (c.swingMix[100]) sub.push(`${c.swingMix[100]}@100%`);
        if (c.swingMix[75]) sub.push(`${c.swingMix[75]}@75%`);
        if (c.swingMix[50]) sub.push(`${c.swingMix[50]}@50%`);
        if (sub.length > 1) parts.push(`swing mix ${sub.join(' / ')}`);
      }
      lines.push(`- ${c.club}: ${parts.join(' · ')}`);
    }
  }

  if (typeof payload.patternAnalysis === 'string' && payload.patternAnalysis.trim().length > 0) {
    lines.push('');
    lines.push('## SHOT PATTERN ANALYSIS (from targeted-shot scatter)');
    lines.push(payload.patternAnalysis.trim());
  }

  return lines.join('\n');
}

export const getRangeSessionDebrief = onCall(
  { secrets: [GEMINI_API_KEY], timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in to get a session debrief.');
    }
    const payload = request.data || {};
    if (!payload.session || typeof payload.session !== 'object') {
      throw new HttpsError('invalid-argument', 'Missing session data.');
    }
    // Refuse to debrief trivially small sessions — the model can't say
    // anything useful from a handful of shots.
    const shotCount = payload.session?.count ?? 0;
    if (shotCount < 10) {
      throw new HttpsError('failed-precondition', 'Need at least 10 logged shots to debrief a session.');
    }
    const userPrompt = buildRangeDebriefBlock(payload);
    const apiKey = GEMINI_API_KEY.value();
    // 768 tokens — debrief target is ~280 words. Some headroom for the
    // structured-output overhead vs the practice plan's 2048.
    const text = await callGemini(RANGE_DEBRIEF_SYSTEM_PROMPT, userPrompt, apiKey, { maxOutputTokens: 768 });
    return {
      recommendation: text,
      model: GEMINI_MODEL,
      generatedAt: new Date().toISOString(),
      scope: 'range-debrief',
      statsBlock: userPrompt,
    };
  }
);
