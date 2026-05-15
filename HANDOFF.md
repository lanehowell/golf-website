# Handoff — Pick up where we left off

This file is the kickoff for the next agent chat working on this project. Copy the "Starter prompt" section below into the new chat verbatim — it gives the agent enough context to dive into work without re-deriving everything.

---

## Where we are right now

Last session built the AI Coach feature end-to-end (Practice tab + post-round review + per-hole drill-down), wired it through Firebase Cloud Functions to Gemini, and persisted plans/reviews to Firestore. It also redesigned the My Stats panel into 7 tabs with deep-dive aggregators and custom SVG charts.

What's stable and working:
- AI Coach bar + bottom sheet on Practice tab (scope picker, focus input, weakness snapshot tiles, full plan, history, "Show data sent to coach")
- Round Review section on Round Summary (manual button + optional auto-generate toggle in Profile)
- "Why this hole?" button in the hole drill-down sheet
- My Stats: Overview / Putting / Situational / Scoring / Trends / Clubs / Strokes Gained tabs with charts
- Plans persist at `users/{uid}/coachPlans/{id}`; round reviews on `round.aiReview`

What's deployed:
- Cloud Functions `getCoachRecommendation`, `getRoundReview`, `getHoleAnalysis` (using `gemini-3.1-flash-lite`, 500 RPD on free tier)
- Firestore rules with `coachPlans`, plus restored `swingThoughts` / `journalEntries` / `admins` rules

Known design decisions worth remembering:
- The Coach lives in a bottom sheet, not as inline content on the Practice tab. The Practice page surfaces a thin "insight bar" that opens the sheet on tap. Other Practice content (modes, sessions, journal, swing thoughts) lives below.
- Practice Modes are deliberately compact, rigid flows. A "Coach Session" mode that walks through drills was discussed but punted to v2 — too much restructure for v1.
- The Cloud Function builds the prompts from a whitelisted payload. The client never sees the system prompt. This means prompt tweaks don't need a client deploy.

---

## Open threads / things the next session could pick up

Pick whichever feels most valuable:

### 1. **Coach Session mode** (the big one)
A new Practice mode that walks the player through the current AI plan's drills one at a time. Holds your hand: shows the drill, sets a timer, prompts you for completion, moves to the next. Closes the loop from "read the plan" → "do the work" that the current UI doesn't bridge. Probably warrants its own design pass.

### 2. **Plan caching by stats fingerprint**
With 500 RPD on the current model, regenerating the same plan twice in a row burns two requests. Was implemented mid-session, then removed. Could come back: hash the payload, skip the API call if the hash matches the cached plan and the user explicitly asks for "no change since last time."

### 3. **Quality testing on Gemini 3.1 Flash Lite**
The model swap was done for quota headroom. If practice-plan output feels noticeably weaker than what 2.5 Flash produced, route just `getCoachRecommendation` to a stronger model (2.5 Flash, 20 RPD) and keep the others on Flash Lite. Single-string-per-callable change.

### 4. **Trends tab depth**
Currently shows recent-vs-lifetime deltas + a single putts/hole line chart. Easy adds: scoring / FIR% / GIR% as toggleable series in the same chart, by-month aggregation, per-club performance over time.

### 5. **Onboarding nudge**
First-time Practice tab visit with no plan ever generated: pulse the Coach bar / show a one-time tooltip pointing at it.

### 6. **More CSS cleanup**
The `.stats-mb-*` rules near line 18170 of `index.html` are dead (removed in the recent cleanup pass — see the comment in `renderMyStatsPage`). Safe to delete on a future polish pass. Same for any other still-orphaned classes from prior layouts.

### 7. **Per-club drill recommendations**
The Coach payload includes `clubData` (per-club carry + dispersion), but recommendations rarely call out specific clubs. Sharpen the system prompt to reference clubs when their dispersion or distance gaps are anomalous.

---

## Files to point a new agent at

In rough reading order:
1. **`ARCHITECTURE.md`** — project-wide context, conventions, data model, subsystem index
2. **`COACH.md`** — AI Coach feature deep-dive (this session's main work)
3. **`DEPLOY.md`** — deploy commands, gotchas, API key rotation
4. **`HANDOFF.md`** (this file) — open threads
5. **`firestore.rules`** — security model
6. **`functions/index.js`** — Cloud Function source (~700 lines)
7. **`index.html`** — everything else (~94k lines; use grep liberally)

---

## Starter prompt for the next chat

Copy from here:

```
I'm continuing work on a golf practice/rounds tracking PWA hosted at https://github.com/lanehowell/golf-website. The previous session built out the AI Coach feature (Practice tab bar+sheet, round review on round summary, per-hole "Why this hole?") and redesigned the My Stats panel into 7 tabs.

Before suggesting any work, please read these docs in order:
1. ARCHITECTURE.md — project conventions + data model
2. COACH.md — AI Coach feature (most recent major work)
3. DEPLOY.md — deploy commands + gotchas
4. HANDOFF.md — open threads + next-step suggestions

A few things to keep in mind:
- I'm left-handed; a fade goes LEFT for me, a draw goes RIGHT. The Coach prompt has explicit handedness rules.
- The main file is index.html (~94k lines). Use grep/Glob, don't try to read it linearly.
- Firestore writes from non-module code must go through window.fb.* (db/doc/updateDoc are module-scoped). See COACH.md §4.5.
- When deploying firestore.rules, the deployed rules become whatever's in the local file — there's no merge. Don't trim rules accidentally.
- Cloud Function uses Gemini 3.1 Flash Lite (500 RPD free tier). If output quality feels weak, the model name is one constant in functions/index.js.
- Bottom sheets re-rendering during use need to skip the `.opening` class on re-renders (see the `sheetAnimatedIn` flag pattern). This bug bit us multiple times.

When you're ready, ask me what to work on. HANDOFF.md has a list of open threads to pick from. The most valuable one is probably the "Coach Session" mode — a new Practice mode that walks the player through the active plan's drills one at a time, since the current UI doesn't bridge "read the plan" → "do the work."
```

End of starter prompt.

---

## How this session used the plan file pattern

We used `C:\Users\Lane Howell\.claude\plans\ok-i-really-want-quizzical-puzzle.md` repeatedly as the scratchpad — entering plan mode, drafting a focused plan, getting approval, executing, then either replacing or appending for the next sub-task. If you want to continue that pattern, just keep using the same file.
