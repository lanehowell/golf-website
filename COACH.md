# AI Coach — Feature Reference

**Purpose:** Surface personalized practice drills + post-round feedback + per-hole analysis using Google Gemini, gated through a Firebase Cloud Function proxy. This doc covers architecture, file map, prompt structure, persistence, and how to extend.

For project-wide context see `ARCHITECTURE.md`. For deploy commands see `DEPLOY.md`. For the next-session kickoff prompt see `HANDOFF.md`.

---

## 1. What it is, where it shows up

The Coach has three surfaces:

| Surface | Where | What it does |
|---|---|---|
| **Practice Coach** | Practice tab, thin bar at top → bottom sheet | Generates a personalized practice plan based on your filtered round stats. Scope picker (Full / Putting / Short game / Approach / Tee / Range session) + optional custom focus. Persists plans in Firestore as a history. |
| **Round Review** | Round Summary panel, between SG block and scramble attribution | Reviews a single completed round (what worked / what cost you / one drill). Manual button by default; optional auto-generate on round completion via `prefs.autoCoachReview`. Persisted on the round doc at `round.aiReview`. |
| **Per-hole "Why this hole?"** | Hole drill-down sheet, between SG bars and shot list | Focused 2-paragraph + 1-drill writeup on a single hole. Not persisted (cheap to regenerate). |

All three are auth-gated. All three respect the player's handedness from `prefs.handedness` (a lefty's fade goes LEFT — the prompt rules call this out by name).

---

## 2. Architecture

```
   Browser (index.html)                Firebase                Gemini
   ─────────────────────                ────────                ──────
   buildCoachPayload()
   buildRoundReviewPayload()    ─────►  Cloud Function   ─────►  REST API
   buildHoleAnalysisPayload()           (Node 22, ESM)            (Flash-Lite)
                                        - auth check
                                        - whitelist payload
   ◄─────────────────────────────       - build prompt
   renderPracticeCoach()                - callGemini()
   renderRoundReviewSection()
   renderHoleAnalysisBlock()           - returns text
                                        + generatedAt
                                        + statsBlock
   ───────────► Firestore  ◄───────
   (coachPlans, rounds.aiReview)
```

**Key design choices**
- The Cloud Function builds the prompt from the client-supplied stats payload. The client never sees the system prompt — that's the server's source of truth. This means prompt iteration doesn't require a client deploy.
- The function returns the rendered stats block alongside the recommendation so the client can show "what was sent to coach" (the data-sent toggle) without duplicating the formatter.
- Plans persist in `users/{uid}/coachPlans/{id}`. Round reviews persist on the round doc itself (`round.aiReview`) — no new subcollection. Per-hole analyses don't persist.
- Three callables instead of one with a mode flag, because payload shapes differ enough that conditional rendering inside one function gets ugly.

---

## 3. Cloud Functions — `functions/index.js`

Single file, three exports, ~700 lines. Node 22, ESM (`"type": "module"`).

### 3.1 Configuration

```js
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });
```

- **API key** is a Firebase Secret (`firebase functions:secrets:set GEMINI_API_KEY`). Never goes to the client.
- **Region** must match the client's `getFunctions(app, 'us-central1')` call in `index.html` around the module script.
- **Model** chosen for highest free-tier RPD on this account (500/day on Gemini 3.1 Flash Lite vs 20/day on 2.5 Flash / 2.5 Flash Lite). Swap to `gemini-2.5-flash` for stronger reasoning at lower limits.

### 3.2 The three callables

| Callable | Input | Output | Max tokens | Persists? |
|---|---|---|---|---|
| `getCoachRecommendation` | `{ stats, scope, customFocus }` | Practice plan markdown | 2048 | client → Firestore `coachPlans` |
| `getRoundReview` | `{ playerProfile, round, sg }` | Round review markdown | 1024 | client → `round.aiReview` |
| `getHoleAnalysis` | `{ playerProfile, hole, holeSG }` | Hole analysis markdown | 512 | no |

All three:
- Reject unauthenticated callers (`request.auth.uid` required)
- Whitelist payload fields (never echo raw client objects to the model)
- Disable Gemini 2.5+ thinking (`thinkingConfig: { thinkingBudget: 0 }`) — thinking tokens were eating the output budget on structured tasks that don't need chain-of-thought
- Share `callGemini(systemPrompt, userPrompt, apiKey, opts)` with `opts.maxOutputTokens` for per-call tuning

### 3.3 Prompt structure

Each callable has its own `*_SYSTEM_PROMPT` template that pins the output structure (`## Diagnosis / ## Practice plan / ## Quick win` for the practice plan; `## How you played / ## What worked / ## What cost you / ## Drill to fix it` for the round review; `## What happened / ## Quick drill` for the hole analysis).

`BASE_SYSTEM_PROMPT` (the practice plan version) has six explicit rules:
1. Be CONCRETE ("make 7 of 10 from 6 ft" beats "improve putting")
2. Reference the player's specific weak numbers
3. Order drills by impact
4. Don't invent stats
5. No gym work
6. **Reference specific buckets** when per-distance/per-club data is present
7. **Call out trend direction** when RECENT FORM shows ↓/↑
8. **HANDEDNESS** — fades/draws are mirrored for lefties

`SCOPE_CONFIG` adds scope-specific constraints to the practice plan system prompt:
- `putting` → drills must be on a green/mat only
- `short-game` → inside 50 yards, no putting or full swings
- `approach` → 50+ yd full swings, no putting or short game
- `tee` → driver + long clubs, no approach/short/putting
- `range` → must be doable at a standard driving range (no real green)
- `full` → no extra constraints

### 3.4 Payload format helpers

In `functions/index.js`:
- `n(v, digits)` — number with N decimals, `'—'` for null/NaN
- `pct(v)` — percentage with rounded display
- `sg(v)` — SG value formatted as `+1.2` / `-0.4` / `0.0`
- `formatSG(v)` — same as `sg` but accessible from `buildRoundReviewBlock` (which shadows `sg` with a local variable)
- `buildStatsBlock(payload)` — practice plan prompt body
- `buildRoundReviewBlock(payload)` — round review prompt body
- `buildHoleAnalysisBlock(payload)` — hole analysis prompt body

The stats block format is a series of `## SECTION` headers with bullet rows. Sections are guarded — if the relevant payload field is missing or empty, the section is skipped entirely (no "Section: (empty)" noise).

---

## 4. Client — payload builders + render functions in `index.html`

### 4.1 State

`coachState` (module-scoped, near line ~57700):
```
{
  loading, recommendation, generatedAt, model, error,
  scope, customFocus,
  statsBlock,                 // rendered stats block from server response
  showPayload,                // "Show data sent to coach" toggle
  planId,                     // Firestore doc id of currently displayed plan
  history, historyLoaded, showHistory,
  sheetOpen,                  // bottom sheet visibility
  sheetAnimatedIn,            // tracks whether open animation completed
                              // (re-renders must NOT re-apply .opening)
}
```

`roundReviewState` (near line ~57730):
```
{
  loadingRoundId, errorByRoundId,
  showPayloadFor,    // Set<roundId> — which payload toggles are open
  expandedFor,       // Set<roundId> — which reviews are expanded
}
```

`holeAnalysisState` — transient state for the currently-open drill-down.

### 4.2 Payload builders

| Builder | Returns | Notes |
|---|---|---|
| `buildCoachPayload()` | Full stats snapshot (scoring, driving, approach, shortGame, putting, sg, worstHoles, puttingDetail, approachDetail, clubData, recentTrend, playerProfile) | Reads from `stats` (computeStatsAggregate), `putting`, `sit`, `aggSG`, `computeHoleSGRanking`, `computeAllClubStats`. **Drops Infinity bucket bounds** — they break the Firebase callable JSON encoder. |
| `buildCoachStatsSnapshot(payload)` | 3-4 weakest metric tiles | Each candidate has a "badness" score; top 4 after de-dup by focus hint. Tap → `applyCoachFocusHint`. |
| `buildRoundReviewPayload(round, course)` | `{ playerProfile, round, sg }` | Whitelists round fields. Calls `computeRoundSG` for the perShot list. Returns `null` if not enough holes. |
| `buildHoleAnalysisPayload(holeNumber)` | `{ playerProfile, hole, holeSG }` | Pulls from cached `holeSGDetailState`. Merges raw shot details (club, distance, etc.) onto each per-shot SG entry by position. |

### 4.3 Render functions

| Function | Renders | Notes |
|---|---|---|
| `renderPracticeCoach()` | Coach bar (`practice-coach-bar-mount`) + Coach sheet (`coach-sheet-mount`) | Bar always renders; sheet only when `sheetOpen`. Sheet animates in via `.opening` class on first paint only — re-renders skip it (the `sheetAnimatedIn` flag). |
| `renderRoundReviewSection(round, sgResult)` | "Coach Review" section inside round summary | Reads `round.aiReview` for stored state. Collapsed by default with a Diagnosis-only summary; expand toggle reveals full markdown. |
| `renderHoleAnalysisBlock(holeNumber)` | Wrapper for the "Why this hole?" block | Returns a stable mount (`id="hole-analysis-block-mount"`). |
| `_renderHoleAnalysisInner(holeNumber)` | Inner contents (trigger / loading / result) | Painted by `_paintHoleAnalysisInner()` on state changes — avoids re-rendering the whole `hsd-sheet`, which would re-apply its `.opening` class and animate the drill-down off-screen. |

### 4.4 Generators

| Function | Flow |
|---|---|
| `generateCoachRecommendation()` | Builds payload → calls `window.fbCallCoach(...)` → updates `coachState` → saves to Firestore via `window.fb.saveCoachPlan` → re-renders |
| `generateRoundReview(roundId)` | Builds payload → calls `window.fbCallRoundReview(...)` → mirrors onto cached round + writes via `window.fb.saveRoundAIReview` → re-renders |
| `generateHoleAnalysis(holeNumber)` | Builds payload → calls `window.fbCallHoleAnalysis(...)` → updates `holeAnalysisState` → `_paintHoleAnalysisInner()` only (no full sheet re-render) |

### 4.5 Firebase SDK wiring (in module script)

```js
// Near line 34755-ish, inside the <script type="module">
window.fbCallCoach        = httpsCallable(functions, 'getCoachRecommendation');
window.fbCallRoundReview  = httpsCallable(functions, 'getRoundReview');
window.fbCallHoleAnalysis = httpsCallable(functions, 'getHoleAnalysis');

// window.fb.* additions (Firestore wrappers):
window.fb.saveCoachPlan        = async (myUid, planData) => { ... };
window.fb.getMostRecentCoachPlan = async (myUid) => { ... };
window.fb.listCoachPlans       = async (myUid, max = 10) => { ... };
window.fb.deleteCoachPlan      = async (myUid, planId) => { ... };
window.fb.saveRoundAIReview    = async (myUid, roundId, reviewData) => { ... };
```

Non-module code calls these via `window.fb.*` and `window.fbCall*`. **Never reference `db` or `doc` / `updateDoc` directly from non-module code** — they're not in scope and you'll get `ReferenceError: db is not defined`.

---

## 5. Firestore

### 5.1 Collections / fields

| Path | Shape | Notes |
|---|---|---|
| `users/{uid}/coachPlans/{id}` | `{ recommendation, generatedAt, model, scope, customFocus, statsBlock, createdAt }` | Sortable id format: `${Date.now()}-${rand}`. Listed by `createdAt desc, limit N`. |
| `users/{uid}/rounds/{id}.aiReview` | `{ recommendation, generatedAt, model, scope: 'round-review', statsBlock }` | Field on the existing round doc. Treat absence as "not generated" — older rounds won't have it. |

### 5.2 Rules

Both collections use owner-only access:
```
match /users/{userId}/coachPlans/{planId} {
  allow read, write: if request.auth != null
                     && request.auth.uid == userId;
}
```

The `rounds` rule is unchanged — already covers the new `aiReview` field.

**Trap to remember**: when you redeploy `firestore.rules`, the deployed rules become whatever's in the local file — there's no merge. Earlier in this project's history, a deploy of an incomplete rules file silently removed `swingThoughts`, `journalEntries`, and `admins` rules from production. The current rules file has them all; don't trim it.

---

## 6. UI patterns

### 6.1 Bottom sheet

The Coach sheet (`renderPracticeCoach` → `coach-sheet-mount`) and the hole drill-down sheet (`renderHoleSGDetail` → `hole-sg-detail-mount`) share an animation pattern:

1. Mount is reparented to `<body>` (`_ensureCoachSheetMount`). Otherwise `position: fixed` would be trapped by panel transforms (the panels use `transform: translateX` for slide-in routing, which creates a containing block and breaks fixed positioning).
2. Initial render outputs the sheet + backdrop with `.opening` class → both are off-screen / transparent.
3. After two `requestAnimationFrame`s, `.opening` is removed → CSS transition slides up the sheet + fades in the backdrop.
4. **Re-renders skip the `.opening` class** by checking the `sheetAnimatedIn` flag. Otherwise mid-use interactions (scope chip taps, focus input changes) would re-render the sheet with `.opening` re-applied → sheet animates off-screen while you're using it. This bug bit us multiple times — flag-and-check is the fix.
5. Close: add `.closing` class → wait 220ms → clear the mount.

### 6.2 Markdown rendering

`_coachMarkdownToHtml(md)` (around line ~58100) is a tight markdown→HTML parser that handles only the formats the Cloud Function prompts emit:
- `## headers` → `<h4 class="coach-h">`
- `**bold**` and `_italic_`
- `1.` numbered lists
- `-` / `*` bullet lists
- Plain paragraphs

Not a general-purpose parser — kept narrow because we control the input model side and don't want to widen the attack surface.

### 6.3 Summary extraction

`_coachExtractSummary(md)` pulls the Diagnosis paragraph and drill count out of a generated plan. Used by:
- The Coach bar's teaser text (first ~110 chars of Diagnosis)
- The collapsed-by-default round-review summary

---

## 7. Extending

**To add a new scope to the practice plan:**
1. Add an entry to `SCOPE_CONFIG` in `functions/index.js` with `label` + `extraRules`.
2. Add a matching entry to `COACH_SCOPES` in `index.html` (id, label, short).
3. Redeploy functions.

**To add a new callable** (e.g., for a different review surface):
1. Define a `*_SYSTEM_PROMPT` string + `build*Block(payload)` function.
2. Export an `onCall` callable that whitelists its payload, calls `callGemini`, returns `{ recommendation, model, generatedAt, statsBlock }`.
3. Wire it on the client via `httpsCallable(functions, 'callableName')` exposed on `window`.
4. Build the render path (consider in-place painting if it'll re-render inside an animated container).

**To change the model:**
- Server-side single point: `GEMINI_MODEL` constant near the top of `functions/index.js`. Single string change, redeploy.

**To add stats to the payload:**
- Client side: add the field to `buildCoachPayload` in `index.html` (~line 57550). Most data is already computed by `computeStatsAggregate`, `computePuttingStats`, `computeSituationalStats`, `computeAggregateSG`, `computeAllClubStats`, `computeHoleSGRanking` — just whitelist what you want.
- Server side: add a `## SECTION` render branch to `buildStatsBlock` in `functions/index.js`. Skip the section when the field is missing.
- Drop any `Infinity` bucket bounds before sending — JSON encoder rejects them.

---

## 8. Known limits & gotchas

- **20 RPD free tier on most Gemini models** for this account. Currently on Gemini 3.1 Flash Lite (500 RPD). Burning through the practice-plan budget is easy if you regenerate often. Plan caching by stats fingerprint is a TODO.
- **`callGemini` doesn't retry** on transient 5xx. Add a small backoff if reliability becomes an issue.
- **Auto-review on round completion** (`prefs.autoCoachReview = true`) fires once per `openRoundSummary` call after the panel paints. If the user closes the summary before the response lands, the saved review still completes and shows up next time. But the request is "wasted" from a UX perspective.
- **`computeAllClubStats()` requires `rangeSessionsHistoryLoaded`** — the Practice tab triggers the fetch on entry, so by the time the user taps Generate it's usually loaded. If they hit Generate within the first second, `clubData` may be empty / thin. Acceptable; the server's CLUB BAG section just won't render.
- **Round-review payload size** — per-shot details for 18 holes × 3-4 shots is ~60 entries. Gemini handles it fine; just don't include raw GPS coords in the whitelist.
- **`prefs.autoCoachReview` toggle** lives in Profile under "Your Game". Default off.

---

## 9. Past bugs worth remembering

- **`db is not defined`** — any new Firestore write/read from non-module code must go through `window.fb.*` (the module script wraps Firestore). The `db` instance is module-scoped and not visible to inline `<script>` code or generator/render functions.
- **Sheet animates off-screen mid-use** — re-rendering a sheet with `.opening` class still in the template makes the sheet slide off again on every interaction. The fix is `sheetAnimatedIn` flag + conditional `.opening`. Same bug pattern hit both the Coach sheet and the hole drill-down.
- **`Infinity` in JSON payload** — `Number.POSITIVE_INFINITY` (which we used as the upper bound of the top bucket in `byDistanceBucket`) is not JSON-serializable, and Firebase callable rejects the payload. Drop the bounds; keep only `label`.
- **Handedness reversal** — Gemini was telling a lefty to "hit a fade to counteract a left miss" because fade is right-pull terminology for righties. The system prompt now has an explicit handedness rule with the exact example called out.
- **Deploying `firestore.rules` removes anything not in the file.** The local file is the source of truth.
