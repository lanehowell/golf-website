# Golf App — Architecture Reference

**Purpose of this document:** Give a fresh reader (human or LLM) enough context to make informed changes to this app without having to re-derive architecture from scratch. If you're starting a new chat with Claude, upload this file to the project and Claude will be able to dive straight into work.

**App identity:** A golf practice + rounds tracking + social PWA. Single user ("Lane") is the primary operator. Dallas-based lefty, ~5 handicap. iOS Safari PWA is the primary target; the app works on desktop and other mobile browsers as a secondary concern.

**Project context:** Firebase project `golf-site-525a9`. Two test accounts used for group round testing. The main file lives at `golf-training-plan.html` and is ~72,000 lines.

---

## 1. File Layout

The app is TWO files of code plus some assets:

- **`golf-training-plan.html`** — the main file. ~72,000 lines. Contains all HTML, all JavaScript, and the app-specific CSS.
- **`design-system.css`** — external stylesheet (~960 lines). Holds the design tokens: color palette, fonts (Playfair Display, DM Sans, DM Mono), spacing scale, semantic aliases (`--text-primary`, `--bg-surface`, etc.), radius scale, shadow scale, and the `html.dark` overrides that flip tokens for dark mode. Also contains theme palette overrides (`[data-theme]`) for the orange/cobalt/burgundy accent system. Linked via `<link rel="stylesheet" href="design-system.css">` near the top of the HTML.
- **`firestore.rules`** — Firestore security rules (~280 lines).

The HTML file contains, in order:

1. **Pre-paint script** (lines ~7–25) — reads `theme` from localStorage and applies the `.dark` class to `<html>` synchronously before CSS loads, to prevent FOUC on dark-mode users.
2. **Link to external `design-system.css`** (line ~26) — this sheet provides ALL the design tokens (CSS custom properties) that the rest of the app references.
3. **Inline app-specific `<style>` block** (~line 37, roughly 18,000 lines). Component styles that USE the tokens from design-system.css. The division is: design-system.css = tokens, inline style = components. Light/dark mode is handled by design-system.css overriding tokens under `html.dark`; individual component rules don't need to know about theme.
4. **External Google Identity Services script** loaded for iOS standalone PWA sign-in fallback.
5. **HTML body** — all panels defined statically in markup (~lines 19,080–19,800), each as a `<section class="panel" id="panel-X">`. Panels are shown/hidden via `.active` class (one at a time).
6. **Firebase module script** (line ~19,801) — ES module that imports Firebase SDK and wraps every Firestore/Auth call into `window.fb.*` helpers. This is the ONE place that knows about Firebase APIs. All app code calls `window.fb.something(...)`.
7. **Main app script** (line ~20,571 onward, ~24,000 lines) — classic `<script>` tag containing every state object, render function, action handler, and helper.

**Why mostly-one-file:** Originally shipped as a single HTML to avoid build tooling. Has stayed that way because it works and the scale hasn't forced a split. The design-system.css was split out because it's shared infrastructure — the tokens might be reused across other projects. Everything else lives in `golf-training-plan.html`.

All of this lives at `/home/claude/golf/` during development (`golf-training-plan.html`, `design-system.css`, `firestore.rules`); the main file gets copied to `/mnt/user-data/outputs/golf-training-plan.html` to ship.

---

## 2. Core Philosophy & Conventions

**State is global, UI is pure.** Every render function reads from a handful of top-level state variables (`prefs`, `roundState`, `groupRoundState`, `recentRounds`, `friendsList`, `groupRoundInvites`, `myGroupRounds`, `dockState`, etc.) and produces HTML. When state changes, you call the relevant `renderX()` function to regenerate that panel's innerHTML. No virtual DOM, no framework.

**Panels, not routes.** Navigation is `showPanel(id, btn?, opts?)` which toggles `.active` classes. Only one panel is visible at a time. `currentPanelId` tracks which one. No URL routing — the app is stateful.

**Save-via-Firestore.** Most writes go directly to Firestore. For frequently-changing state (round scores), there's an autosave debounce. Critical writes (start round, finish round, accept invite) are awaited and surface errors. localStorage is used only for two things: theme (for pre-paint), and the user's per-round "which hole am I on" cursor.

**Mobile-first, iOS-first.** The layout is designed for portrait phone screens. Bottom sheets rather than modals. Haptics via `navigator.vibrate` (noop on iOS Safari but kept for Android). Tap targets sized for thumbs.

**Functions are mostly 5–50 lines, comment-heavy.** Comments are the primary form of documentation. If you're adding new code, match the style — explain WHY, not just what. A lot of hairy edge cases (PWA redirect auth, race conditions, snapshot-during-save) have already been solved and the comments explain how. Respect existing comment density.

**There is no test suite.** The only automated validation run during development is `node --check` on the inlined JavaScript (via a Python harness that extracts the biggest `<script>` block and pipes it to Node). This catches syntax errors. Behavioral correctness is tested by actually running the app.

---

## 3. Data Model

### 3.1 User preferences (`prefs`)

Stored at `users/{uid}/preferences/main`. Held in memory as `prefs` object, defaults in `DEFAULT_PREFS`. Shape includes:

- `scheduleOverride` — `{ weekdayNumber: ['dayId', ...] }` for which workout days are scheduled. `0`=Sunday.
- `units` — `'lb' | 'kg'`. Also drives yards/meters.
- `theme` — `'light' | 'dark'`. Mirrored to localStorage for pre-paint.
- `palette` — `'orange' | 'cobalt' | 'burgundy'`. Drives `--color-accent-*` via `[data-theme="cobalt|burgundy"]` attribute on the document root. Default = orange (the original brand color; the var stays unprefixed to avoid breakage). All component CSS uses `var(--color-accent-*)` so palette switching is theme-wide. See §5.14 for the theme system in detail.
- `bag` — array of `{ id, name, type, distance }`. User's clubs.
- `bagAutoUpdate` — whether to auto-update bag distances from range session data.
- `handedness` — `'right' | 'left'`. Used by Pre-Shot tool for direction flipping.
- `toolsConfig` — `null` (= use catalog defaults) OR an array of `[{ id, visible }, ...]` controlling which dock tools appear in the round tools sheet and in what order. Forward-compat: tools added to the catalog after the user saved a config get appended to the end as visible. Edited via Profile → Your Game → In-round tools.
- `username`, `usernameDisplay`, `displayNameOverride`, `location`, `profileVisibility`, `usernameChangedAt` — social identity.

`savePreferences()` persists the whole object. `prefsLoaded` gate prevents overwriting Firestore data with defaults during a page-load race.

### 3.2 Rounds (solo)

**Path:** `users/{uid}/rounds/{roundId}`. Owner-only per rules.

**In-memory state** (`roundState`):
```
{
  docId, courseId, teeName,
  format,          // 'standard' | 'scramble' | 'bestBall' | 'altShot' | 'casual'
  holeIndex,       // 0-based
  scores,          // { holeNumber: { strokes, putts, puttList, firstPuttFeet, fir, gir, ... } }
  shots,           // { holeNumber: [shot, ...] }
  started,         // ms timestamp
  dateKey,         // YYYY-MM-DD
  weather,         // { tempF, windMph, windDirDeg, conditions, ... } — captured at round start
  stats,           // optional: { gir: bool, fir: bool, firMissDir, girMissDir, ... }
  _holeSlideDirection,  // transient: 'forward' | 'back' | null for hole-card cross-fade
  _bumpStrokes, _bumpPutts, _bumpTotal, _bumpTristate  // transient animation flags
}
```

Round is auto-saved on score change via `autoSaveRound()` with debounce. Pin position changes ALSO trigger autoSaveRound so pin data rides with the round doc. `completeCurrentRound()` finalizes (sets status='completed', computes totals, snapshots pins from localStorage onto the doc, computes bestType for friend feed badges) and writes to personal rounds + public mirror if applicable.

**Status values:** `in-progress` | `completed` | `abandoned` | `quickScore`.

**Persisted-only fields (NOT in roundState, written by completion handlers):**
- `endTime`, `status`, `totals`, `bestType` ('global' | 'course' | null — denormalized for friend feed)
- `pins` — `{ [holeNumber]: { lat, lng } }` — user-placed pin positions snapshotted at completion. Used by replays.
- For group round snapshots: `groupRoundId`, `groupPlayerUids`, `groupOthers` (denormalized other-player display info)

### 3.3 Shots (per-hole)

Each shot: `{ id, club, distance, distanceFeet, proximityFt, startLie, intent?, mishit?, result?, startLat, startLng, endLat, endLng, actualYards, targetLat?, targetLng?, lateralOffset?, alongShot?, endedInTrouble?, afterDrop?, penaltyKind? }`

- `distance` — **yards-to-target** at log time (NOT ball flight). For round shots this is `haversine(startLat/Lng, target-or-pin)`. For range shots this is the user-entered actual distance hit (different semantics, same field name — historical baggage). NEVER display this for round shots; it's an internal-only metric used by `classifyRoundShot` (chip/approach split at `dist <= 30`) and `inferShotIntent` (chip auto-detect at `<= 40`).
- `actualYards` — ball flight: `haversine(startLat/Lng, endLat/Lng)`. THIS is what users mean by "I hit a 280-yard drive." Always use this for any "distance hit" display. Strict mode: em dash if missing rather than falling back to `distance` (which would be misleading).
- `distanceFeet` — for putts only (legacy field, replaced by puttList)
- `proximityFt` — manual entry for chip distance to pin after shot
- `startLie` — one of `SHOT_START_LIES`: tee, fairway, rough, sand, recovery, fringe, green
- `intent` — auto-inferred but user-overridable: full swing, punch, layup, pitch, chip, recovery, putt
- `mishit` — defaults to `clean`; options in `SHOT_MISHITS` (thin, fat, toe, heel, slice, hook, push, pull, etc.)
- `result` — 9-way compass (on/short/long/left/right + 4 diagonals) OR a lie outcome (fairway/rough/sand/recovery/fringe/green) OR `'penalty'` (ball ended in hazard / OB / unplayable; triggers the drop flow)
- **GPS data** (set when shot logged via GPS view): `startLat/Lng`, `endLat/Lng`, `actualYards` (haversine of start→end). Without these, the shot can't appear in replay or contribute to dispersion stats.
- **Aim point** (set when shot logged with a target): `targetLat/Lng`, `lateralOffset` (perpendicular yards from start→target line, signed for L/R), `alongShot` (parallel yards, signed for short/long). Used for dispersion overlay + miss vector charts.
- **Penalty / hazard flags** (added when a shot is part of a hazard drop sequence):
  - `endedInTrouble` — boolean. This shot's ball ended in a hazard or was lost. Renders red on map + replay + hole history. Source of truth for the trouble visual (NOT `result === 'penalty'`, though the two are kept in sync by `saveShotDraft`).
  - `afterDrop` — boolean. This shot's `startLat/Lng` is a drop position, not the previous shot's end. Chain propagation skips this boundary.
  - `penaltyKind` — `'drop-new'` (lateral drop) or `'stroke-distance'` (back to original spot). Drives the action button label during the flow + replay caption flavor. Mechanically the two kinds are identical.

**Chain invariant: shot N's end == shot N+1's start, EXCEPT when shot N+1.afterDrop.** They represent the same physical event (where the ball landed = where the next shot starts from) — the ball didn't move between shots. Enforced in `saveShotDraft` by unconditional propagation: when a shot is saved, its end coords are written to the next shot's start coords (and the next shot's `actualYards` + miss vector are recomputed). Same for start → previous shot's end. Repair runs every save, not just when boundaries moved, so existing chains broken by pre-fix edits get healed on next save. Without this invariant, editing a shot's end leaves the next shot pointing at a stale position — yellow line in replay draws from the wrong place, next shot's measured distance is wrong. **Drop boundaries are intentionally broken**: when shot N+1.afterDrop is true, neither propagation direction touches the boundary (the ball moved from shot N's end to the drop area without a swing, so syncing would corrupt the drop).

Stored per hole under `roundState.shots[holeNumber]` (solo) or `me.shots` on the player entry in `groupRoundState.doc.players[]` (group). Branching happens in `getShotsForHole` / `ensureShotsForHole` so consumers are mode-agnostic.

Shot editing is done via a bottom sheet (`shotEditState`, opened by `openShotEditSheet(holeNumber, shotId?)`). The sheet's preview map shows live distance readouts beneath it (shot length + remaining-to-pin) that update on drag, via `computeShotEditDistances` and `updateShotEditDistanceCaption`.

**Putts** are tracked separately from shots. Each putt is an entry in `entry.puttList[]` on the score record: `{ distanceFt, made, loggedAt }`. Logged via the putt-log modal (`openPuttLogModal` → `savePuttFromModal`). The legacy `entry.putts` (count) and `entry.firstPuttFeet` are derived from puttList via `syncLegacyPuttFields()`. SG: Putting reads from puttList directly when present; falls back to synthesizing a puttList from legacy fields when puttList is empty (see SG section §4.18).

**Penalty strokes** are tracked on the score entry as `entry.penalties` (count). Each `endedInTrouble` shot has a corresponding +1 penalty stroke that comes IMMEDIATELY AFTER the shot in the stroke sequence. Drives the stroke total + scorecard penalty dot + shot pin stroke labels. See §4.20 for the full hazard drops feature documentation.

**LANDMINE — the puttList whitelist trap:** `getOrInitHoleEntry` (and historically `grUpdateFirstPuttFeet`) rebuild the score entry from a fixed whitelist of fields. Any field not in the whitelist gets silently dropped on every score-sheet interaction (stepper, toggle, Save & Next). `puttList` was missing from the whitelist for a long time, so users who faithfully used Log Putt would have their data destroyed the moment they touched the score sheet. This caused SG to exclude every hole on the round for `stroke-mismatch` — `trackedCount = gpsShots + 0` instead of `gpsShots + putts`. Fix: explicitly preserve `puttList` (and any future per-hole arrays) through entry rebuilds via `Array.isArray(stored?.puttList) ? stored.puttList : undefined`, then `delete entry.puttList` if undefined to keep Firestore writes clean. ANY new array/object field added to the score entry needs the same treatment.

### 3.4 Group rounds

**Path:** `groupRounds/{groupRoundId}`. Top-level (not under users) because multiple users read/write.

**Doc shape:**
```
{
  id, organizerUid, courseId, courseName, teeName,
  status,              // 'lobby' | 'in-progress' | 'completed' | 'abandoned'
  startTime,           // ms timestamp of lobby creation
  playerUids,          // array of uids — used by rules for membership checks
  players: [           // array, one entry per player
    {
      uid, username, usernameDisplay, displayName, photoURL,
      tee, handicapIndex,
      status,          // 'active' | 'finished'
      joinedAt, leftAtHole,
      finishedAt?,     // set when they complete
      scores,          // same shape as solo
      shots            // same shape as solo
    }
  ]
}
```

**In-memory state** (`groupRoundState`):
```
{
  docId, doc, unsubscribe,
  yourHoleIndex,  // YOUR cursor — independent of other players
  viewMode,       // 'one-hole' | 'scorecard'
  _holeSlideDirection, _bumpStrokes, _bumpPutts, _bumpTotal, _bumpTristate,
  _livePulseUids  // Set<uid> — cleared after render — drives the "friend scored" glow
}
```

**Critical finishing behavior:** `completeMyGroupRound` does NOT remove the player from the array. It sets their `status = 'finished'` and `finishedAt = now`. This way their totals stay visible on the leaderboard for other players to see. Also writes a mirror to `groupRounds/{id}/results/{uid}` for post-finish leaderboard access.

**Invites:** `users/{recipientUid}/groupRoundInvites/{groupRoundId}` — per-user inbox. Sender writes directly (allowed by rules if they're a friend + organizer). Recipient deletes on accept/decline.

**Rules gate writes by membership:** `request.auth.uid in resource.data.playerUids` OR they have a pending invite for this round (covers the joining-via-invite case).

### 3.5 Social graph

- `users/{uid}/friends/{otherUid}` — owner-only reads; owner-writes OR handshake-writes from a friend who has a pending request from you in their own inbox. Bidirectional (both sides hold records).
- `users/{uid}/friendRequests/{senderUid}` — inbox. Sender creates, recipient reads + deletes on accept/decline.
- `usernames/{lowercaseName}` — global uniqueness index. Write-once (can't update), owner-delete. Reserved when a user sets a username.
- `publicProfiles/{uid}` — profile card visible to any authenticated user. Owner-writes. Sub-collection `rounds/{roundId}` holds a mirror of completed rounds the user chose to make public.

**`commentCount` field on `publicProfiles/{uid}/rounds/{id}` has a special non-owner-update rule:** friends can increment/decrement by exactly 1 via the rules diff check. This is how the post-a-comment flow denormalizes the count onto the round doc without needing a Cloud Function.

### 3.6 Practice sessions

**Path:** `users/{uid}/practiceSessions/{sessionId}`. Owner-only. Unified model for range sessions, short game sessions, and course practice sessions, differentiated by a `type` field. Each session has shots/sets recorded inline.

### 3.7 Courses

Currently **hardcoded in a `COURSES` constant** in the script. Each course: `{ id, name, location, lat, lng, tees: [{ name, yardages[], rating, slope }], holes: [{ number, par, strokeIndex, yards }], teeBoxes? }`. User can edit courses via the Courses panel. Long-term plan is API-backed courses (see section 8.2).

**GPS coordinates** are added to course data via two crowdsourcing flows:
- **Greens** — user-contributed via "Pin greens" sheet (`openPinGreensSheet(courseId)`). Stored two ways: shared pins on the course doc itself (visible to everyone), and per-user pins on `users/{uid}/courseHoleOverrides/{courseId}` (private). `getCourse(id)` merges shared + user-specific into runtime `holes[].greenLat / greenLng`.
- **Tees** — user-contributed via "Pin tees" sheet (`openPinTeesSheet(courseId)`). Stored on course `teeBoxes[holeNumber][teeName]` (or `_default` for one-pin-per-hole). Read via `getTeePosition(courseOrId, holeNum, teeName)`.

Without green coords, the GPS view + replay + Strokes Gained all silently degrade. Most user flows show an inline prompt to pin greens for the active course if they're missing.

---

## 4. Subsystems (Major Features)

The app has more subsystems than you might expect. Below is the full inventory. For each, I note the primary state object, entry point function, panels, and Firestore storage.

### 4.1 Home / Today

Dashboard panel. Renders today's card (workout / stretch / rest day based on schedule), week strip, and jump-to-tools grid. Entry: `renderTodayCard` + `renderWeekStrip`. Also hosts the home invite banner (`round-invite-banner-mount`) and signin banner.

### 4.2 Workout system

Structured strength workouts. Panels: `panel-library`, `panel-routines`, `panel-routine-builder`, `panel-workout` (active session). Uses built-in `EXERCISES` catalog + user-uploaded custom exercises at `users/{uid}/customExercises`. User-built workout templates stored at `users/{uid}/routines`. Historical workout sets stored at `users/{uid}/sessions`. NOT synced to public/social.

### 4.3 Stretching

Daily stretch routine. Panel: `panel-stretch`. Simpler than workout — just a fixed routine with timer.

### 4.4 Practice sessions — three variants

**Range sessions** (`panel-range-session`) — log shots at the driving range, per club. Powers bag distance suggestions.

**Short game sessions** (`panel-shortgame-session`) — short-distance practice drills (pitching, chipping, putting). Setup panel + session panel + history.

**Course practice sessions** (`panel-course-practice-session`) — a structured practice round with goals/constraints ("every hole, hit 2 shots from fairway, count better result"). Setup panel has sliders for gimme threshold, which tees, etc.

All three write to `users/{uid}/practiceSessions/{id}` differentiated by `type`.

### 4.5 Solo round (the main "I'm playing golf" flow)

**Panels:** `panel-courses` (pick) → `panel-course-detail` → `panel-round` (active round) → `panel-round-summary`.

**Active round UI** — one hole at a time with strokes/putts steppers + optional stats (GIR/FIR with miss direction tristates). Also accessible: scorecard view, shot tracking, round dock for tools.

**Key actions:**
- `startRoundFromCourse(courseId, teeName)` — creates the round doc
- `saveAndNext()` — commits current hole + advances, triggers cross-fade
- `goPreviousHole()` — back one hole
- `completeCurrentRound()` — finalizes, writes history, syncs public mirror if visible
- `autoSaveRound()` — debounced autosave on score changes

**Hole picker:** a bottom sheet with a 3×6 grid of holes, opened via the tappable "Hole N of 18" pill at the top. Grid tiles color-coded by score (eagle/birdie/par/bogey/over) with played-borders and current-fill. Jumps use smart slide direction.

### 4.6 Group round ("Play Together")

Shared multi-player round. Heaviest subsystem.

**Lifecycle:**
1. **Organizer creates** via `createGroupRoundFromCourse` — makes a `groupRounds/{id}` doc with status=`lobby`, organizer is sole player.
2. **Organizer invites friends** via `inviteFriendToGroupRound(friendUid)` — writes to `users/{them}/groupRoundInvites/{roundId}`. Tracked client-side in `__groupRoundInvitesSent` Map (uid → timestamp, 90s TTL to recover from declines).
3. **Invitee accepts** via `acceptGroupRoundInvite` → adds themselves to `players[]` and `playerUids`. Rules allow this because they have a valid invite.
4. **Organizer starts** via `startGroupRoundFromLobby` — status → `in-progress`, all clients auto-navigate into the round panel.
5. **Each player plays independently** — their own hole cursor, scores, shots. Writes go through `saveMyGroupScoresNow` (debounced) which updates their entry in the `players[]` array.
6. **Player finishes** via `completeMyGroupRound` — sets `status='finished'` on their player entry (does NOT remove), writes `groupRounds/{id}/results/{uid}` mirror, writes personal history card at `users/{uid}/rounds/{id}` with deterministic id.
7. **All players finished** → someone flips the group round `status` to `completed` (not strictly enforced — the round stays alive while anyone's still playing).

**Subscription:** `groupRoundState.unsubscribe` holds a live Firestore `onSnapshot` listener. Every snapshot calls `handleGroupRoundSnapshot(freshDoc)` which reconciles against local state.

**Critical race protections in `handleGroupRoundSnapshot`:**
- If the user has a pending OR in-flight score write, preserve their local `me.scores` + `me.shots` to avoid stale-server overwrite of uncommitted edits
- Detect being kicked (no longer in `playerUids`) and tear down cleanly
- Detect new strokes-total from other players and populate `_livePulseUids` set for the pulse animation
- Reconcile `__groupRoundInvitesSent` tracker — if a uid now appears in `players[]`, they accepted, remove from tracker

**Invite tracker TTL fix:** `__groupRoundInvitesSent` is a `Map<uid, timestampMs>` with 90s TTL. This exists because we can't observe decline events directly (the invite lives in the recipient's private inbox). After 90s an invite is presumed declined/ignored and the UI re-enables the Invite button. `isInviteStillSent(uid)` helper does the check + self-cleans expired entries.

**Re-invite after finish:** `playerUidsSet` built for the friends-list gate FILTERS OUT `status === 'finished'` players. Otherwise a finished player would show "Joined" in the invite-friends list and be un-invitable. Two build sites: lobby (`renderGroupLobby`) and Manage Players sheet.

### 4.7 Quick Score

A bare-bones scorecard mode for when the user just wants to log totals without hole-by-hole detail. Panel: `panel-quick-score`. Creates the same round doc shape but fills scores only at the summary level.

### 4.8 Round history & summary

**Panels:** `panel-rounds` (list), `panel-round-summary` (single round detail).

History list is `renderHistory` / `renderRoundsPage`. Summary is `renderRoundSummary` — for group rounds it includes a leaderboard via `renderRoundSummaryLeaderboard`. Summary has edit-score and manage-players affordances.

### 4.9 My Stats

Panel: `panel-my-stats`. Three fully-independent data views:
- **Shot Accuracy** — from shot tracking data: club + distance performance
- **Ball Striking** — from GIR/FIR stats
- **Scoring** — from strokes data (averages, vs par, best/worst)

Each section renders only if the data exists. They're INDEPENDENT — no reconciliation between GIR miss direction and shot-level result. Each dataset stands alone.

### 4.10 Social

**Panel:** `panel-social`. Contains:
- Incoming friend requests
- Incoming group round invites (visible invite cards here too)
- Friends list
- Search (by username prefix or name tokens)
- Feed (friends' recent public rounds + comment counts)

Friend-request flow is handshake-based per rules. Friend-deletion is unilateral on either side.

### 4.11 User Profile (view another user)

**Panel:** `panel-user-profile`. Shows someone else's public profile + their public rounds feed. Has "add friend" affordance if not already friends.

### 4.12 Public Round view

**Panel:** `panel-public-round`. Shared view of a friend's round. Can comment (friends of owner + owner). Comments stored at `publicProfiles/{ownerUid}/rounds/{roundId}/comments/{commentId}`.

### 4.13 Profile (your own settings)

**Panel:** `panel-profile`. Composed of sections (in render order): Account, Public Profile, My Bag, Your Game (handedness), Schedule, Units, Appearance. Each section is its own render function.

### 4.14 My Bag (clubs)

**Panel:** `panel-bag`. Sub-page off profile. List of user's clubs with typical distances. Auto-update toggle syncs from range session averages. Built-in template for "add typical bag" on first visit.

### 4.15 GPS View (in-round satellite map)

**Mount:** `#round-gps-mount` (body-level). Opened via `openRoundGpsPanel()` (action button on round panel). Holds a Mapbox GL satellite map + overlay UI for the active hole.

**State:** `roundGpsState` — large object holding map instance, current hole index/number/par/yards, green coords, tee coords, user's smoothed GPS position (`smoothLat/Lng`), watch interval ID, target reticle state (`targetActive`, `targetLat/Lng`, `committedTarget`), pin positions (`pinPositions[holeNumber]`), per-tool layer state (dispersion overlay, target lines, target labels, shot markers, etc.), and the current `mode` (`'planning'` when no GPS fix yet, `'playing'` once fix lands).

**Hole switching:** `transitionRoundGpsToHole(holeIndex)` — fades current overlays, calls `clearRoundGpsTarget()` and `clearCommittedTarget()` mid-transition, flyTo with the tee→green bearing, then `dropAfterFly()` re-creates target reticle + tee/green markers + shot tracking for the new hole. CRITICAL: target button visibility is guarded by `roundGpsState.suppressTargetBtnVisibility` during the transition so the brief target-cleared interval doesn't visually blink the button.

**Shot tracking:** Tap "Log shot" (the round action button while GPS is open) → captures user's current smoothed GPS as the shot's end position, infers start position from previous shot's end (or tee for first shot), computes lateral/along miss vector against the committed target (or pin if no target). Shot record includes startLat/Lng + endLat/Lng + actualYards.

**Distance readouts** all flow through `getEffectivePinLatLng()` (returns custom pin if set, else green center). Sites: info bar (top-of-screen), target readout (bottom-of-screen carry/remaining), target lines on map. Changing the pin updates all of these atomically via `refreshDistanceReadouts()`.

**Target reticle:** A draggable Mapbox marker (`roundGpsState.targetMarker`). Drag updates `targetLat/Lng` in real time, redraws the from→target and target→pin lines via `updateRoundGpsTargetLines()`. "Set as target" button commits the reticle's current position as `committedTarget`, which then becomes the aim point for the next-logged shot.

**Plays-like distance:** `getRoundGpsPlaysLikeAdjustments(fromLat, fromLng, toLat, toLng, baseYards)` computes elevation change (via Mapbox terrain DEM source) + wind component (via cached weather data) and returns `{ plays, breakdown }`. Used in info bar + target readout when a target is set.

### 4.16 Pin Placement

**Mount:** `#pin-modal-mount` (body-level). Opened via `openPinPlacementModal()` (the flag button on the GPS view's left side, OR by tapping the locked pin marker on the map).

**Why a modal:** Dragging a pin directly on the main map is fiddly (finger covers pin, accidental moves during play). The modal provides a focused green view at zoom 19 with a STATIONARY centered pin overlay + pannable map. User pans the map below to position; pin's visible base stays at dead center of the modal's viewport. Set Pin commits the map's current center as the lat/lng. The committed pin appears on the main map in a LOCKED (non-draggable) state to prevent accidental moves. Tap the locked pin to re-open the modal.

**State:** `pinModalState = { open, holeNumber, map, draftLat, draftLng, rafId }`. The pin overlay is a CSS-positioned SVG (NOT a Mapbox marker) — it stays put while the map pans. Map's `move` listener tracks the current center as `draftLat/Lng`.

**Persistence:** Pins are saved to localStorage (`roundPins:{roundId}`) on every set/clear AND trigger an autoSaveRound that writes them onto the round doc. Survives page refresh, app close, device sleep. Cleared from localStorage on round completion (canonical copy now lives on the round doc). The full data flow:
- During round: localStorage + round doc (Firestore)
- At completion: snapshot from localStorage to `round.pins`, then clear localStorage
- In replay: read from `round.pins` and render as a flag pin

**Bearing matching:** Modal map initializes with `bearing: mainMap.getBearing()` so the orientation matches the main map view (avoids loading "upside down" if hole runs south).

### 4.17 Round Replay

**Mount:** `#round-replay-mount` (body-level). Opened via `openReplay(roundId, opts?)` from a round summary. `opts.initialHole` and `opts.initialShotId` deep-link to a specific hole + shot — used by the round summary's per-shot rows (`openReplayAtShot(roundId, holeNumber, shotId)`). Full-screen Mapbox map + playback controls + hole nav.

**State:** `replayState = { open, round, map, currentHoleIndex, currentShotIndex, holesPlayed, playing, animationFrame, shotEndMarkers, shotEndLayers, drawnShotLines, teeMarker, greenMarker, flagPinLayers, isPublic, publicAuthorUid, ... }`.

**Hole rendering:** `loadReplayHole(idx, { autoPlay, initialShotIndex })` clears overlays, frames the camera to the hole's tee→green bounds, then `renderReplayStaticMarkers` adds tee marker, green marker, and (if `round.pins[holeNum]` exists) a flag pin via a Mapbox SYMBOL LAYER (not a DOM marker — see war stories about marker drift). `initialShotIndex` jumps to a specific shot via `replayJumpToShot` after the hole settles.

**Shot animation:** `replayPlay()` advances through shots. Each shot animates a curved bezier path from start to end position via rAF, with a small "ball" at the head of the curve. After the animation completes, a numbered pin pops at the end position. User can tap pins to open shot-edit (live editing of historical shot data — same shot edit sheet as live rounds, with `shotEditState.roundId` set to the historical round id).

**Jump-to-shot layer-order landmine:** `replayJumpToShot` redraws shots 0..targetIdx in a loop. Each iteration adds a line then a pin. Each pin is `moveLayer`d to the top — but the next iteration adds a new line on top of *everything*, burying the older pins. Fix: after the loop, walk `replayState.shotEndLayers` and re-promote each pin's layers to top in stored order. Animated playback doesn't have this bug because there's only one shot in flight at a time.

**Curved paths:** Compute control point perpendicular to the start→end line at midpoint, with curvature proportional to shot distance — gives drives a high arc, putts a flat line.

**Public replays:** `openPublicReplay(authorUid, roundId)` reads from `publicProfiles/{uid}/rounds/{id}` instead of the user's private rounds. Hydrates `replayState.round` from the public mirror. Shot fields included on the public side controlled by `PUBLIC_SHOT_FIELDS` whitelist in `sanitizeShotsForPublic` (currently `id, club, distance, distanceActual, actualYards, startLat, startLng, endLat, endLng, startLie, intent, result, targetLat, targetLng, lateralOffset, alongShot, pushPull` — `mishit` is intentionally stripped as too self-critical to share). Existing public-mirrored rounds need a re-sync via `syncAllRoundsToPublic` after any change to the whitelist.

### 4.18 Strokes Gained

The truth-teller analytic. For each shot: `SG = ExpectedStrokes(before) - ExpectedStrokes(after) - 1`. Sum across all shots, bucketed into four categories (Off the Tee, Approach, Around the Green, Putting). Positive = better than PGA Tour baseline; negative = worse.

**Baselines:** `SG_BASELINE_TEE / FAIRWAY / ROUGH / SAND / RECOVERY / GREEN` constants — sampled lookup tables (Broadie's published PGA Tour data, smoothed). Linear interpolation via `interpolateBaseline(table, distance)`. Green table is in feet; others in yards.

**Lookup:** `expectedStrokes(lie, yards)` for non-putts (handles fringe→fairway, bunker→sand fallbacks, and unknown lies → fairway as conservative default). `expectedStrokesPutt(feet)` for putts.

**Categorization:** `categorizeShotForSG({ startLie, isFirstShotOnHole, holePar, distFromPin })` returns `'tee' | 'approach' | 'around' | 'putt'` per Broadie's standard scheme. Par 3 tee shots count as Approach. ≤30 yards from pin (not on green) counts as Around the Green.

**Round aggregation:** `computeRoundSG(round, course)` walks each hole's shots in order, derives before/after states using GPS positions + green coords as pin proxy, handles the putting branch via `puttList`. Returns `{ totals: { tee, approach, around, putt, total }, perShot: [...], coverage: { holesAnalyzed, holesTotal, excludedHoles: [...] } }`. Excludes holes with: missing green coords, no shot data, or stroke-count mismatch.

**Stroke counting:** `trackedCount = shots + puttList + penalties`. Penalty strokes (`entry.penalties`) count toward eligibility — without that addition, holes with hazard drops would be excluded as `stroke-mismatch` because the +1 penalty stroke isn't represented as a shot record.

**Putt synthesis from legacy fields:** When `entry.puttList` is empty but `entry.putts > 0` (user logged putts via the simple view, not via the GPS Log Putt flow), the SG path synthesizes a puttList of length `entry.putts`. First entry carries `entry.firstPuttFeet`; remaining entries have `distanceFt: null`. The per-putt loop tolerates missing distances on non-first putts (contributes `sg: 0` for those — neutral, not invalid). This unblocks holes where the user only logged via simple view from being excluded as `putt-data-incomplete`.

**Green coord resolution (priority chain):**
1. `course.holes[i].greenLat/Lng` — populated by `getCourse()` merging from `course.greenCoords` (crowd-sourced via the standalone Pin Greens tool, written to the shared course doc)
2. `round.pins[holeNumber]` — per-hole pin positions placed during play (in-round pin tool), snapshotted onto the round doc at completion. Same physical reference (where the flag was that day) so it works fine for SG distance calc.

Without (2) as fallback, a fresh course with no Pin-Greens-yet would silently exclude every hole even if the player diligently placed pins during play. The fallback is the difference between "0 of 18" and a working SG breakdown.

**Exclusion reason landmines worth knowing:**
- `'no-green-coord'` — both fallbacks failed. Course has no shared greens AND round has no pins. Nothing to do but pin greens or play without SG.
- `'no-shot-data'` — `shotsForHole.length === 0 && puttList.length === 0`. User didn't track this hole.
- `'stroke-mismatch'` — `trackedCount` (shots + putts + penalties) doesn't equal `entry.strokes`. Common causes that are now RESOLVED: puttList whitelist trap (see §3.3), penalty strokes not counted (penalties now in trackedCount), simple-view putt entries excluded (puttList synthesized from legacy fields). Remaining causes: missed GPS shot logs, manual stroke adjustments without corresponding shots.
- `'putt-data-incomplete'` — first putt has no distance, OR an intermediate putt's data caused a parse failure. First-putt distance is REQUIRED for SG (anchors all the math); subsequent putts can have null distance and contribute `sg: 0`.

**Debug helper:** `window.debugSG(roundId?)` dumps coverage breakdown + per-hole stroke accounting to the console. Columns: `gpsShots`, `puttList` (raw), `legacyPutts` (entry.putts fallback), `effPutts` (what SG actually uses), `penalties`, `trouble` (count of endedInTrouble shots), `afterDrop` (count of afterDrop shots), `reportedStrokes`, `tracked` (= shots + effPutts + penalties), `gap` (= reportedStrokes - tracked; 0 means eligible). First diagnostic to run when SG shows 0 of N or fewer holes than expected.

**Multi-round aggregate:** `computeAggregateSG(rounds)` averages per-category SG across rounds (filtered by `roundCountsForStats(round)` so scrambles don't pollute). Requires ≥9 holes analyzed per round to count, since SG is volatile at small samples.

**UI:** `renderSGBlock(sg)` renders the round-summary block — 4 horizontal diverging bars (centered on zero, orange right=positive, red left=negative), header phrase ("Lost X.X strokes vs Tour"), insight line identifying the worst category, coverage footer. Empty state for rounds with <9 analyzed holes.

**Why green-center is fine as a pin proxy:** Broadie's baselines are smoothed averages over thousands of shots with thousands of pin positions. Pin-position offset shifts expected strokes by ~0.05 strokes per shot — basically noise across a round.

### 4.19 Dispersion Overlay

**Activation:** Toggleable via the round dock's Dispersion tool. State on `roundGpsState.dispersionOverlay = { active, clubKey, fillSourceId, fillLayerId, outlineLayerId }`.

**Math:** For the selected club, project the user's historical shot dispersion (lateralOffset + alongShot from past shots with that club) as an ellipse. Center anchored to: committed target → reticle → effective pin (custom pin or green center) → map center (in priority order). Sized at the 70th percentile of historical |lateralOffset| and |alongShot| for the club. Oriented along the start→anchor bearing.

**Implementation:** Mapbox geojson polygon (sampled at 64 points around the ellipse). Updates on: toggle on/off, club switch, reticle drag, pin move, hole change. Uses rAF coalescing (`__dispersionRafId`) so rapid drag events don't thrash. Cached per club via `__dispersionCache` so toggling clubs is instant.

**UI:** `renderDispersionScatter(shots, opts)` draws a per-shot scatter plot (also used in Club Data + round summary). Categories selectable (All / Drive / Approach / Short). Outliers clipped to chart edge. Dashed 70% ellipse overlaid when ≥5 shots.

### 4.20 Hazard Drops / Penalty Strokes

When a player hits into a hazard (water, OB, lost ball), three things need to be captured: (1) where the ball ended up or entered the hazard, (2) the +1 penalty stroke, (3) where the next swing starts from (drop area for lateral relief, original spot for stroke + distance).

**Two flows reach the same outcome.** Both write `endedInTrouble: true` on the trouble shot, increment `entry.penalties`, capture a drop position, then create the next shot with `afterDrop: true` and `startLat/Lng` = drop position.

**Proactive flow** (declare BEFORE walking up, kicked off from Tools → Penalty):
1. User taps Tools → Penalty (entry in `DOCK_TOOLS` catalog with `gpsOnly: true, isAction: true`)
2. `openPenaltyModal()` shows bottom sheet with two options: "Drop somewhere new" / "Stroke and distance" (mechanically identical; just affects label flavor)
3. `confirmPenalty(kind)` sets `roundGpsState.penaltyMode = 'awaiting-trouble'`, `penaltyKind = kind`, shows banner
4. User walks to where ball entered, taps Log shot → shot logs normally + `handlePostTroubleShotLogged()` flags `endedInTrouble`, bumps penalty count, advances state to `'awaiting-drop'`
5. Action button label flips to "Drop here" / "Re-hit here" (`getRoundGpsLogButtonMode()` returns `'drop'`)
6. User walks to drop area, taps action button → `captureDropPosition()` stores user position in `pendingDropLat/Lng`, advances to `'pending-shot-after-drop'`, action button flips back to "Log shot"
7. User hits drop shot, walks, taps Log shot → `logShotAtCurrentPosition()` detects `isAfterDrop`, overrides start to `pendingDrop`, sets `afterDrop: true`, clears penalty state

**Retroactive flow** (mark via edit sheet, fits the typical "log then classify" cadence):
1. User logs the trouble shot normally (just walks + taps Log shot)
2. In the shot edit sheet's lie picker, tap "Penalty" (red-tinted button)
3. Save → `saveShotDraft()` detects the penalty transition (now-penalty / no-longer-penalty), reconciles `entry.penalties` and `endedInTrouble` flag idempotently
4. If conditions allow (GPS view open, edited shot is most recent on hole, no flow already in progress), automatically transitions to `'awaiting-drop'` and shows the banner — same drop-capture flow as proactive from step 5
5. If conditions DON'T allow (e.g., user retroactively classifies an old shot as penalty after the hole already played out), data updates silently without triggering drop flow — the chain has already played out

**State machine** (`roundGpsState.penaltyMode`):
- `null` — normal logging, no flow active
- `'awaiting-trouble'` — modal confirmed, next Log shot tap captures trouble end
- `'awaiting-drop'` — trouble logged, next action-button tap captures drop start
- `'pending-shot-after-drop'` — drop captured, next Log shot creates the after-drop shot

State resets on: GPS panel close, hole change. Cancellation via banner X (`cancelPenaltyFlow()`) does graceful rollback if mid-flow (decrements penalty count + clears endedInTrouble flag if already applied).

**Visual treatment:**
- In-round map: trouble pins red via Mapbox `case` expression on `endedInTrouble` property; shot-trail line broken into multi-segment `LineString` features at afterDrop boundaries (visual gap conveys "ball moved without a swing")
- Replay: trouble pins red + trouble lines red (same color resolution); chain breaks correct by construction since each shot draws its own line
- Hole History: heatmap mode uses `case` expression; reel mode uses color override
- Shot list (Track Shots tool): "Penalty" pill in red (`shot-row-result-penalty` class); a "↳ Drop" or "↳ Re-hit (stroke + distance)" divider row appears before any afterDrop shot
- Scorecards: small red dot in the corner of the score cell for any hole with `entry.penalties > 0` (`.rs-sc-penalty-dot` for round summary, `.dock-sc-penalty-dot` for in-round dock)
- Shot pin labels everywhere use `getShotStrokeNumber(shots, idx)` rather than array index, accounting for penalty strokes that come between shots (so a drop swing after a tee-into-water shows "3" not "2")

**Reconciliation banner math:** The "1 shot not logged" banner uses `expectedShots = strokes - putts - penalties`. Without subtracting penalties, holes with hazard drops would falsely flag as missing a logged shot.

**Public mirror:** `endedInTrouble`, `afterDrop`, `penaltyKind` are in `PUBLIC_SHOT_FIELDS` whitelist. Friends viewing public replays see the same red pins + chain breaks. Existing public-mirrored rounds need a re-sync via `syncAllRoundsToPublic` after the whitelist changed.

**Group rounds:** Penalty flow works for group rounds end-to-end with no special-case code. `ensureEntryForHole` and `ensureShotsForHole` route to `me.scores` / `me.shots` automatically when group round is active. `getOrInitGroupHoleEntry` mutates entries in place (no whitelist trap). `completeMyGroupRound` spreads `me.scores` and `me.shots` verbatim into the personal snapshot, carrying penalty flags + counts.

**Function map:**
- `openPenaltyModal()`, `closePenaltyModal()`, `confirmPenalty(kind)`, `cancelPenaltyFlow()` — modal + state machine
- `updatePenaltyBanner()` — refresh banner text/visibility based on current mode
- `handlePostTroubleShotLogged(shot)` — applies endedInTrouble + penalty bump after trouble shot logged
- `captureDropPosition()` — stores user position as drop start, advances state
- `getShotStrokeNumber(shots, shotIndex)` — converts array index to actual stroke number (accounts for preceding endedInTrouble shots)

### 4.21 Hole History (per-hole shots across rounds)

A view that overlays every shot the user has logged on a single hole across all completed rounds at that course. Two modes share the same map: heatmap (all shots from all rounds drawn together) and reel (sequential animation, oldest round → newest, one round at a time).

**Entry point:** Subtle accent-colored hole number with chevron on hole rows in course detail view (only appears for holes with logged history).

**State:** `holeHistoryState = { open, courseId, holeNumber, course, rounds, map, mode, layers, markers, reelTimers, reelActive, reelRoundIndex }`. Mounted body-level at `#hole-history-mount` to escape panel transforms.

**Functions:**
- `openHoleHistory(courseId, holeNumber)` — entry; gathers eligible rounds, mounts overlay
- `closeHoleHistory()` — teardown
- `gatherRoundsForHole(courseId, holeNumber)` — filters to completed rounds at this course with shots on this hole; returns sorted array
- `holeHistoryColorForRound(roundEntry, par)` — derives the per-round color from score-vs-par (eagle/birdie green, par cream, bogey amber, double+ red)
- `drawRoundShotsAsLayer(roundEntry, roundIdx, color, opacity)` — heatmap renderer; adds line + pin layers for one round's shots, with `endedInTrouble` overriding to red via Mapbox `case` expression
- `drawSingleShotLayer(shot, color, ...)` — reel mode renderer; same logic but one shot at a time, color-overridden for trouble shots

Hole nav (prev/next), mode toggle, caption ("5 rounds · scores 4–7 · avg 4.6"). Tap a shot circle → `jumpToRoundReplay(roundId)` opens that round's full replay deep-linked to the hole.

---

## 5. Cross-Cutting Systems

### 5.1 Round Dock (the tools sheet)

When in a round (`panel-round` or `panel-group-round`), a persistent bottom-dock button opens the Tools sheet. Tools (in catalog order, but user can hide/reorder via Profile → Your Game — see §5.15):

1. **Scorecard** — `renderDockScorecard` — full 18-hole grid + totals (with penalty dots on relevant cells)
2. **Track Shots** — `renderShotsTool` — current hole's shots + add/edit (with penalty pills + drop dividers)
3. **GPS** — opens the in-round satellite view (a panel takeover, not an inline surface). Toggleable: tap when GPS is open returns to simple view.
4. **Weather** — `renderDockWeather` — course conditions with wind + temp
5. **Pre-Shot** — `renderPreShotTool` — 17 situation-based tips (lie/wind/elevation/conditions), directions flip for left-handed users
6. **Club Caddie** — `renderCaddie` — club suggestion for a distance + wind
7. **My Bag** — `renderDockBag` — compact bag view
8. **Dispersion** (gpsOnly + isToggle) — toggleable map overlay; only listed while GPS is open
9. **Penalty** (gpsOnly + isAction) — opens the penalty modal; only listed while GPS is open

Dispatch: `DOCK_TOOLS` array + `selectTool(id)` handler that branches on `isAction`/`isToggle`/normal-tool. Normal tools render inline via `renderToolSurface(toolId)`. State: `dockState.activeTool` + tool-specific substate (e.g. `dockState.caddie.targetDistance`).

Tool catalog flags:
- `gpsOnly: true` — hidden from the list when GPS view is closed (filter in `renderToolsList`)
- `isAction: true` — tap closes sheet + runs an action (modal, etc.) instead of swapping the surface
- `isToggle: true` — shows ON/OFF state instead of a chevron; tap flips state without opening a surface

### 5.2 Sync indicator

Floating pill above the round action bar, showing save state.

States: `idle` (hidden), `saving` (pulse), `saved` (green, auto-fades 1.4s), `error` (tappable to retry).

Shared `syncState` machine: `{ state, pending, savedTimer }` with refcount. `syncBeginSave()` / `syncEndSave(ok)` wrap both solo `autoSaveRound` AND group `saveMyGroupScoresNow`. `applySyncIndicator()` re-runs after dock renders + panel renders to survive re-renders. `syncRetry()` routes to active mode's save path.

### 5.3 Hole transition cross-fade

`animateHoleTransitionOut(direction)` clones the current `.round-card` before re-render, positions it `fixed` at the viewport rect, and plays an exit animation (`round-card-slide-exit-forward` / `-back`, 420ms, 72px travel, scale 0.94→1). New card enters simultaneously with `ease-out`, old card exits with `ease-in`.

Wired into: `saveAndNext`, `goPreviousHole`, `grSaveAndNext`, `grGoPreviousHole`, `holePickerJumpTo`. Respects `prefers-reduced-motion`.

### 5.4 Haptics

`haptic('light' | 'medium' | 'heavy' | 'success')` — wraps `navigator.vibrate` with fixed durations. iOS noops (no Vibration API). Respects reduce-motion. Wired on: stepper +/-, tristate set (medium), Save & Next (medium).

### 5.5 Spring animations on interactions

Transient flags consumed by render:
- `_bumpStrokes`, `_bumpPutts` — triggers `.is-bump` class + `stepper-bump` keyframes (cubic-bezier with overshoot)
- `_bumpTotal` — triggers `.is-changed` class + `score-total-flash` keyframes (scale + orange tint)
- `_bumpTristate` — `${statKey}-${btn}` — triggers tristate button spring on newly-active

Each flag is set on the action, consumed on the next render (`renderX` reads then deletes). Clamped-adjust (stepper pressed at boundary) returns early — no haptic, no bump.

### 5.6 Live player pulse (group round)

In `handleGroupRoundSnapshot`, BEFORE assigning `mergedDoc`, compare each other-player's total strokes vs previous. Changed uids go into `groupRoundState._livePulseUids`. Playing With tile renders with `is-live-pulse` class (900ms glow + number scale/tint). Set is cleared after the render `.map()` completes.

### 5.7 Invite banner with slide-down

Two mounts, same renderer:
- `round-invite-banner-mount` (home, above Today card)
- `play-round-invite-banner-mount` (Play screen, at top)

`renderRoundInviteBanner(mountId)` — each mount tracked in `__inviteBannerState` Map so we know if the banner is TRANSITIONING (first appear or collapse) vs just updating content. Slot wrapper `.invite-banner-slot` animates `max-height: 0 → 240px` + opacity + translateY, which causes content below to shift down smoothly as the slot expands.

On collapse: add `.is-collapsing`, remove `.is-open`, wait 360ms (transition duration), clear `innerHTML`.

Invite toast is SUPPRESSED when user is on `home | play | social` (panels with visible invite UI). On any other panel (stretch, profile, practice etc.) the toast still fires as the primary arrival signal.

### 5.8 Bottom sheets (pattern)

Many UI interactions use bottom sheets rather than centered modals. Pattern: a mount `<div id="X-mount"></div>` in the body (not inside a panel) + a state object `{ open: false }` + a render function that returns empty when closed. Drag-to-close via `attachBottomSheetDrag(element, onClose)` which listens for touchmove events and animates a swipe-down dismissal.

Used for: hole picker, manage players, shot edit, finish sheet, recovery sheet, player scorecard, edit score, summary group scorecard.

### 5.9 Toasts

`showToast(message, isError?, opts?)` — brief message pill. Options: `duration` (default 3000ms), `onTap` (callback if the toast itself is tapped, e.g. navigate).

### 5.10 Confirm dialogs

`confirmDialog({ eyebrow, title, message, confirmText, cancelText, destructive? })` — returns a Promise<boolean>. Used for destructive actions like "abandon round," "remove player," "delete exercise."

### 5.11 Round Format Flag

Every round has a `format` field: `'standard' | 'scramble' | 'bestBall' | 'altShot' | 'casual'`. `ROUND_FORMATS` catalog defines each with a `countsForStats` flag (only `standard` counts true). The single predicate `roundCountsForStats(round)` is the chokepoint — used by:

- `iterateTrackedShots` (so non-standard shots don't pollute Club Data, dispersion, etc.)
- `computeRoundSG` callsites (SG only meaningful for standard rounds)
- `computeRoundBaselines` (course-history baselines)
- `computeRoundDifferential` (handicap)
- `computeMyBestRounds` / `computeBestTypeForRound` (best-round badges skip non-standard)
- Various render-stat callsites (`renderMyStatsPage`, `renderPlayStats`)

When adding stat code, ALWAYS gate by `roundCountsForStats(round)` if the stat should reflect "real" play. Never check `round.format === 'standard'` directly — use the predicate.

UI: format badge appears in round summary meta line for non-standard rounds. Edit link opens `openFormatEditor()` bottom sheet for retroactive change. Format pill on round history cards.

### 5.12 Weather Snapshot

When a round starts, `attachLiveWeatherToRound()` captures temp/wind/conditions from Open-Meteo and writes them to `roundState.weather`. Persisted on every save thereafter so the snapshot rides with the round.

Carries forward through `completeCurrentRound` and `completeMyGroupRound` (group rounds capture weather at lobby creation, then replicate to each player's personal snapshot at completion).

Used for: future "conditions played in" insights, plays-like distance wind component, replay context. Old rounds (pre-feature) just have no weather field — handled gracefully everywhere.

### 5.13 Best Round Denormalization

The "Best Round" badge on friend feeds is computed at completion time (not on render) via `computeBestTypeForRound(candidate, fullHistory)`. Returns `'global' | 'course' | null` — written to `round.bestType`.

Why denormalized: friends viewing your feed don't have access to your full round history (rules forbid), so they can't compute it themselves. The denormalized field on the public round mirror is the only way they can show the badge.

When a new best is set, `findDisplacedBestRounds` identifies any prior best rounds that no longer hold the title; `reconcileDisplacedBestRounds` rewrites their `bestType` field. All four completion handlers wire this in: `completeCurrentRound`, `completeMyGroupRound`, `saveQuickScoreRound`, `setRoundFormatAndClose` (since changing format can shift best-status). When changing format mid-history, mutate `round.format + round.bestType` locally FIRST for snappy UI, then setDoc, then revert on error.

### 5.14 Theme palette system

User can pick an accent color: `'orange'` (default, original brand), `'cobalt'` (cool blue), `'burgundy'` (deep red). Stored in `prefs.palette`.

**How it works:** `design-system.css` defines a base set of `--color-orange-*` variables and a default accent chain (`--color-accent`, `--color-accent-light`, `--color-accent-dark`, `--color-accent-pale`, `--color-accent-darker`) that maps to the orange family. Then `[data-theme="cobalt"]` and `[data-theme="burgundy"]` blocks override the accent chain only. The `data-theme` attribute is set on the document root (`<html>`) by `applyPalette(palette)`.

**Component CSS uses ONLY the accent vars**, never the orange-* family directly. Exception: the design-system.css file itself (where the orange family is defined) and the default theme accent chain. ~860 occurrences of `var(--color-orange-*)` in the original code were migrated to `var(--color-accent-*)` so palette switching works app-wide. ~123 hardcoded `rgba(232, 93, 4, X)` literals were migrated to `color-mix(in srgb, var(--color-accent) Y%, transparent)` for theme-aware translucent overlays.

**Mapbox layers** can't read CSS vars directly — they use the `resolveCssColor('--color-accent', '#E85D04')` helper which reads computed style and falls back to the hex if the var isn't resolvable. Active accent color via `activeAccentColor()`. Trouble shots use `resolveCssColor('--color-danger', '#E8744A')` to keep red regardless of palette (semantic meaning preserved).

**Pre-paint init:** A small inline script at the top of the HTML reads palette from localStorage and applies the data-theme attribute synchronously, mirroring the dark-mode pre-paint trick. Without this, palette flashes on every load.

**Where edited:** Profile → Appearance → palette picker. `setPalette(name)` calls `applyPalette(name)` then saves the pref.

**LANDMINE — adding new accent-tinted CSS:** When adding new CSS that should follow the active palette, use `var(--color-accent)` (or `--color-accent-light`, etc.) NOT `var(--color-orange-700)`. When adding translucent overlays, use `color-mix(in srgb, var(--color-accent) X%, transparent)` NOT a hardcoded rgba. The orange-family vars exist to support the orange palette internally; component-level code shouldn't reference them.

### 5.15 Tools customization

`prefs.toolsConfig` controls which dock tools appear in the round tools sheet and in what order. Shape: `null` (= use catalog defaults from `DOCK_TOOLS`) OR an array of `[{ id, visible }, ...]`.

`getEffectiveDockTools()` merges catalog with user config:
- Tools in user config rendered in user-specified order (filtered by `visible !== false`)
- Tools in catalog but not in user config get appended to the end as visible (forward-compat: when new tools ship, existing users see them automatically)
- Falls back to catalog if config somehow yielded an empty list (defensive)

**Edited via:** Profile → Your Game → In-round tools. Editor sheet shows each tool with up/down reorder buttons + Shown/Hidden pill. At-least-one-visible enforced. Reset to defaults option. Button-based reorder (not drag) for mobile reliability.

**Why button-reorder, not drag-and-drop:** Mobile drag-and-drop has reliability issues (gesture conflicts with scroll, no consistent OS-level affordance). Discrete up/down buttons work in every viewport with zero ambiguity.

---

## 6. Firestore Rules Mental Model

See `firestore.rules` for the full spec. Summary:

**Private by default.** Anything under `users/{uid}/*` is owner-only unless explicitly carved out.

**Friend-system carve-outs:**
- Anyone can CREATE a friend request in another user's inbox (the request id must equal sender's uid = anti-spoofing).
- Accepting a request writes to both `users/A/friends/B` and `users/B/friends/A`. The non-owner write (A writing to B's friends) is allowed only if `users/A/friendRequests/B` exists — i.e. B had to have sent you a request first.

**Usernames:**
- Readable by any authed user (for uniqueness checks).
- Write-once — you can't update a username doc. To change, you delete + create a new one.
- Owner-delete only.

**Public profiles:**
- Readable by any authed user.
- Owner-write for everything except the `commentCount` field on a mirrored round, which can be updated by friends (±1 only, diff check enforces this).

**Group round invites:**
- Recipient reads + deletes own inbox.
- Sender creates (must be friend + write own `fromUid`).
- Sender can also delete (cancel).
- No updates.

**Group rounds:**
- Read: current player, OR pending-invite holder, OR has-a-results-doc (post-finish leaderboard access).
- Create: organizer only; must include self; status must start `lobby`.
- Update: player OR pending-invite holder (covers join flow).
- Delete: never.

**Group round results (subcollection):**
- Read: anyone who was ever in the round (via playerUids OR own results doc).
- Write: only the uid whose doc it is.

---

## 7. Things That Were Hard (War Stories)

These are landmines future-you will step on. Reading these saves time.

**Group round finishing doesn't remove the player.** Previous version used `removeGroupRoundPlayer`. Now it's `updateGroupRoundPlayer(uid, { status: 'finished', finishedAt: endMs })`. This preserves leaderboard visibility. Anywhere that builds "who's currently playing" MUST filter by `status !== 'finished'`. Two known sites: `playerUidsSet` in lobby + manage-players. If you add a third, remember to filter.

**Invite decline isn't observable.** We can't read the recipient's inbox, so we can't see when they delete an invite via decline. TTL fallback (90s) in `__groupRoundInvitesSent`. Don't try to "fix" this by reading their inbox — it's a rules violation.

**Snapshot-during-save race.** If you're writing scores and a Firestore snapshot arrives in the middle, you'd clobber your uncommitted local edits with stale server data. `handleGroupRoundSnapshot` has a guard using `__groupRoundSaveTimer` (debounce pending) and `__groupRoundSaveInFlight` (write in flight) flags — if either is set AND we're still in the round per the fresh doc, preserve local `me.scores` and `me.shots`. Don't mess with this.

**`playerUids` vs `players[]`.** `playerUids` is a scalar array used for rules checks (`request.auth.uid in resource.data.playerUids`). `players[]` is the full objects. Both must be kept in sync. `addGroupRoundPlayer` handles both atomically via a transaction.

**Deterministic personal round id on group completion.** When a player finishes a group round, their personal round at `users/{uid}/rounds/{id}` uses a deterministic id like `gr_{groupRoundId}` so re-finishing (after rejoin-finish cycle) overwrites the prior history card instead of duplicating.

**Pre-paint theme script.** DO NOT remove the inline theme-init script at the top of the file. Without it, dark-mode users see a white flash on every load. This is why `theme` is also in localStorage — so we can apply it BEFORE Firestore loads prefs.

**iOS PWA redirect auth breaks.** Firebase's default redirect auth doesn't return properly to a standalone iOS PWA window. We fall back to Google Identity Services (the GIS script loaded in the head) which does in-page auth via iframe and hands back an ID token, which we then exchange with `signInWithCredential`.

**Username cooldown.** Once a username is set, there's a 7-day cooldown before it can be changed (`usernameChangedAt` stamp). Prevents churn on the globally-unique `usernames/{name}` collection.

**Shot display vs storage.** Shots are stored per-hole in `roundState.shots[holeNumber]` for solo rounds but in `me.shots` (on the player entry) for group rounds. Helpers (`getShotsForHole`, `ensureShotsForHole`, `saveShotDraft`) branch internally so consumers are mode-agnostic. Always use the helpers.

**Three-dataset independence rule for stats.** Shot Accuracy (from shots), Ball Striking (from GIR/FIR), Scoring (from strokes) are FULLY INDEPENDENT. Don't reconcile them. A shot result saying "right" and a GIR miss direction of "left" can coexist — they're different things.

**Pre-feature rounds have no shots.** Don't assume `roundState.shots` exists. Always check. Stats view gates every dataset on data presence.

**`fb` wrapper is the single Firebase boundary.** Never call Firestore/Auth APIs directly from app code. Always go through `window.fb.*`. If you need a new operation, add a method to the wrapper first. This keeps the app testable and lets us swap providers later if needed.

**Mapbox DOM markers drift.** When you create a `new mapboxgl.Marker({ element: ... })` in this codebase, the marker shifts relative to map features as the user zooms/pans. Documented across multiple subsystems. Workarounds:
- For STATIC visuals (a flag at a point), use a Mapbox LAYER instead — circle, line, fill, or symbol layer. Layers are part of Mapbox's coordinate system and stay perfectly rooted.
- For DRAGGABLE visuals where you need the DOM API, accept the drift OR use the hybrid pattern (invisible DOM marker for hit detection + a circle layer for the visible dot).
- If you must use a DOM marker for visual reasons (e.g. an icon you want screen-anchored), wrap the SVG/content in an inner `<div>` and put any CSS animations or transforms on the WRAPPER. Mapbox uses the outer element's `transform` property to position the marker — any CSS transform on the outer element clobbers positioning and the marker ends up at map origin (top-left, off-screen).

**Replay flag pin uses a symbol layer, not a DOM marker.** Combines drift-immunity (it's a layer) with screen-anchored sizing (icons render at fixed pixel sizes). Pattern: SVG → Blob → Image → `map.addImage(id, img)` → symbol layer with `icon-image: id`. Image registration is async via `img.onload`. Image is registered once per map session.

**`getEffectivePinLatLng()` is the source of truth for "where the pin is."** Returns user-placed pin if set for the current hole, else green center. ALL distance readouts + dispersion anchor + miss-vector calc use this — never reach directly for `roundGpsState.greenLat`. New stat code that needs a "target" should follow the same priority chain: committed target → reticle → effective pin → green center.

**Pin position is session-scoped during the round, snapshotted at completion.** Lives in localStorage during the round (`roundPins:{roundId}`), in `roundGpsState.pinPositions` while the GPS panel is open, and on `round.pins` after completion. Don't try to put pin info on the round doc DURING the round expecting it to persist forever — it gets cleared from localStorage at completion. The completion handler reads from localStorage one last time and writes the canonical copy onto the round doc.

**SG uses green-center as a pin proxy.** Even when a user-placed pin exists, SG calc uses `greenLat/Lng` (not `getEffectivePinLatLng`). This is intentional — Broadie's baselines are smoothed averages over many pin positions, and pin-position offset shifts SG by ~0.05 strokes per shot (basically noise). Don't "fix" this by switching SG to use the effective pin — the apparent precision gain is illusory and you'd waste time.

**`roundCountsForStats(round)` predicate gates everything stats-related.** Scrambles, best-balls, casual rounds — don't pollute stats. New code that touches Club Data, dispersion, SG, baselines, handicap differential, or best-round computation MUST gate by this predicate. Never check `round.format === 'standard'` directly.

**Hole transition button blink (set-target).** During hole transition, the target gets cleared at the start (button hides), flyTo runs (~800ms), then a new target drops at the end (button shows). Without a guard, this looks like a hard hide/show blink. `roundGpsState.suppressTargetBtnVisibility` flag stops `refreshRoundGpsTargetBtn` from toggling visibility during the transition, then a final explicit refresh in `dropAfterFly` syncs to the post-transition state. Don't remove this guard.

**Scroll-lock background bug (color-glitch-after-tools-menu).** Body uses `position: fixed` for scroll-lock when GPS/replay/tools sheet is open. This exposes the html-root element which had no background-color → iOS Safari painted default cooler-grey. Fixed by adding `background-color: var(--bg-page)` to the html rule in design-system.css. Works in dark mode since `--bg-page` flips.

**Dynamic Island morph experiment failed (modal expanded panel).** Tried morphing dispersion chip → expanded panel via single DOM element with CSS transitions on width/height/border-radius + content layer cross-fade. Failed: width:max-content with absolute-positioned children resolved to 0, chip invisible. Reverted to chip + bottom-sheet pattern. Lesson: avoid clever single-element morphs; use distinct elements for distinct visual states.

**Mapbox `addImage` requires the map to be loaded.** `map.isStyleLoaded()` check before adding sources/layers/images. Defer with `map.once('load', ...)` if not yet loaded. This bites in the replay where the first hole renders BEFORE the map's load event has fired.

**`<source>` and `<layer>` ID collisions across hole switches.** When re-rendering for a new hole, defensively `removeLayer` and `removeSource` before `addLayer`/`addSource`. Mapbox throws "source already exists" otherwise. Pattern: try/catch around each removal, then add fresh.

**Shot `distance` field has dual semantics depending on shot source.** For range shots, `distance` is the user-entered actual distance hit. For round shots logged via GPS, `distance` is yards-to-target at log time (DIFFERENT thing). Range shots also have a parallel `distanceActual` field; reads use `distanceActual ?? distance` for range to handle both old and new entries. Round shots have a parallel `actualYards` field that IS ball flight. Display rule: round shots show `actualYards` only (em dash if missing); never fall back to `distance` for round shots — that's misleading. Anywhere you're showing "this shot was Xy" for a round shot, it must be `actualYards`. The internal-only `distance` powers `classifyRoundShot` (chip vs approach split) and `inferShotIntent` (auto-chip detection); not displayed. Future cleanup: rename round-shot `distance` to `yardsToTarget` to make the trap impossible. Big refactor, deferred.

**Shot chain invariant: shot N's end == shot N+1's start.** `saveShotDraft` propagates unconditionally on save: writes shot's end to next.startLat/Lng and recomputes next.actualYards + miss vector. Same for start → previous.endLat/Lng. Repair-on-save fixes any de-chained shots from edits made before propagation existed. Without this, editing a shot's end leaves the next shot pointing at a stale position; replay yellow line draws wrong, next shot's measured distance is wrong.

**puttList whitelist trap (silent data destruction).** `getOrInitHoleEntry` rebuilds the score entry from a fixed whitelist of fields. Any field not on the list gets dropped on every score-sheet interaction. `puttList` was missing for a long time; users who used Log Putt would have it silently destroyed on the next score-sheet stepper or Save & Next, breaking SG entirely (every hole excluded for stroke-mismatch). Fix: explicitly preserve `puttList` through the rebuild via `Array.isArray(stored?.puttList) ? stored.puttList : undefined`, then `delete entry.puttList` if undefined to avoid Firestore explicit-undefined writes. **Any new array/object field on the score entry needs the same treatment.** Audit when adding new score-entry fields.

**Jump-to-shot replay layer order (older pins buried under newer lines).** `replayJumpToShot` loops shots 0..targetIdx, adding line + pin each iteration. Each pin is `moveLayer`d to top after add — but the next iteration's line lands on top of all existing layers, burying the older pins. Fix: after the loop, walk `replayState.shotEndLayers` in order and re-promote each pin's layers to top. The animated playback path doesn't have this bug because shots flow in one at a time and the user never sees an intermediate buried state.

**openReplay deep-link wiring trap.** `openReplay(roundId, opts)` accepts `initialHole` and `initialShotId`. The state was being set correctly (`replayState.currentHoleIndex = startHoleIdx`) but then `loadReplayHole(0, ...)` was called with a hardcoded 0, throwing the state away. AND `loadReplayHole` itself unconditionally resets `currentShotIndex = 0` regardless of what was set before calling. Two-stage fix: (1) pass `startHoleIdx` to `loadReplayHole`. (2) extend `loadReplayHole` to accept `initialShotIndex` option that calls `replayJumpToShot` after the hole's static markers render. ANY future "deep-link to a specific point in replay" feature needs to go through this option, not pre-set state.

**Chain invariant exception: afterDrop boundaries.** The chain invariant (shot N.end == shot N+1.start) holds for normal play but is INTENTIONALLY broken at hazard drops. When a shot is `afterDrop: true`, its `startLat/Lng` is the drop position, not the previous shot's end. Chain propagation in `saveShotDraft` skips this boundary in BOTH directions: end → next is skipped if next.afterDrop, start → prev is skipped if this.afterDrop. Without those guards, the next save would silently rewrite the drop position to the previous shot's end, destroying the player's actual drop location. When adding new propagation logic, check both flags.

**Reconciliation banner must subtract penalties.** The "1 shot not logged" banner uses `expectedShots = strokes - putts - penalties`. Penalty strokes are real but they're not GPS shot records — same accounting category as putts. Without the penalties subtraction, every hole with a hazard drop would falsely flag as missing a shot. Easy gotcha to introduce in any code that derives "expected GPS shot count from total strokes."

**Simple-view putt entries require synthesis for SG.** When user enters putts via simple view (sets `entry.putts` + `entry.firstPuttFeet` directly, not via the GPS Log Putt flow), `entry.puttList` stays empty. SG reads from `puttList`. Without synthesis, those holes silently fail eligibility. Fix in `computeRoundSG`: when puttList is empty but `entry.putts > 0`, build a synthetic puttList of length `entry.putts` (first entry has firstPuttFeet, rest have null distance). The per-putt SG loop then tolerates null distance on non-first putts (contributes `sg: 0`). First putt distance is REQUIRED — without it the hole is excluded as `putt-data-incomplete`.

**Penalty count-via-shot vs count-via-stepper drift.** `entry.penalties` can be incremented two ways: (1) the hazard drops flow auto-bumps it when a shot is marked `endedInTrouble`, (2) the user manually steppers it from the score sheet for penalties without per-shot context. There's no enforcement that `entry.penalties` equals `count of endedInTrouble shots`. This is intentional — manual stepper bumps don't have positional context to attribute to shots. But it means: shot pin stroke labels (`getShotStrokeNumber`) only reflect the auto-bumped penalties; manual stepper bumps don't shift labels. Score totals are still correct (read entry.penalties), just the per-shot label alignment is approximate when manual bumps exist.

**Palette migration — orange-* vars are internal-only.** `--color-orange-*` family is defined in design-system.css to support the orange palette. Component-level CSS must use `--color-accent-*` instead so palette switching works. New CSS that uses `var(--color-orange-700)` will look correct in orange palette but stay orange in cobalt/burgundy mode (since the override blocks only redefine `--color-accent-*`). Same trap with hardcoded `rgba(232, 93, 4, X)` — use `color-mix(in srgb, var(--color-accent) Y%, transparent)` instead.

**Mapbox color expressions need theme-aware resolution.** Mapbox layers can't read CSS vars directly. Use `resolveCssColor(varName, fallbackHex)` which reads computed style and falls back to the hex if the var isn't resolvable. For accent-tinted layers, use `resolveCssColor('--color-accent', '#E85D04')`. For trouble shots / dangers, use `resolveCssColor('--color-danger', '#E8744A')` — danger stays red across palettes since the semantic meaning matters more than the brand color.

---

## 8. Planned / Deferred Work

### 8.1 Offline resilience (declined for pre-field-test)

Round writes could be queued in IndexedDB when offline and flushed on reconnect. Discussed and intentionally deferred — adds complexity that could backfire pre-test. Revisit after real-world round usage surfaces the need.

### 8.2 Course data from golfcourseapi.com

User has a free-tier API key. API returns: club name, address, lat/lng, up to 8 tee sets (Black/Gold/Silver/Ruby × female/male) with rating/slope/bogey + per-hole `{par, yardage, handicap}`. Stable integer course id. NO GPS coordinates for greens/tees/hazards — green/tee coords still come from in-app crowdsourcing (pin greens/tees flows).

Working explorer sandbox at `/mnt/user-data/outputs/golfcourseapi-explorer.html` for future experimentation. Confirmed: base URL `https://api.golfcourseapi.com`, auth header `Authorization: Key YOUR_KEY` (NOT Bearer), response wraps in `{course: {...}}`.

Three-phase rollout plan:
1. **Cloud Function proxy + "Find my course" import flow.** User searches by name, picks result, backend imports course into shared `publicCourses/{id}` Firestore cache (pay per course once globally).
2. **"Near me" geo search** using course lat/lng.
3. **Re-sync existing manual courses** against API versions.

Par differs across tees in API data (longer par-5s become par-4s from forward tees). Current app model has par at hole level, would need reconciliation. Recommendation: take the "back tee" par as canonical for the hole; minor discrepancies from forward tees are probably negligible for this app's purposes.

**Coverage gap:** API is community-sourced; not every course has tee data populated. E.g. Pine Dunes in Frankston TX exists in the API but has no tees. Need a Manual Add Course UI as fallback for these holes-in-coverage. Would let user enter per-hole par/handicap, per-tee yardages/rating/slope, name + location + coords. Same shape as seed entries. Reuse existing API preview UI patterns.

### 8.3 Strokes Gained Phase 4 (My Stats aggregate view)

Round-summary SG block is shipped. The aggregate view in My Stats (your average SG per category over a rolling window of recent rounds) is the next phase. `computeAggregateSG(rounds)` is built and ready; just needs the UI block in `renderMyStatsPage`. Highest-leverage SG addition since it's where the prescriptive value lives ("you've lost 1.8 strokes/round on approaches over your last 10 rounds → practice approaches").

### 8.4 Strokes Gained — hole-by-hole drill-down

Tappable section in round summary: "View hole-by-hole SG." Shows per-hole breakdown so user can spot "I bogeyed hole 7 because of one disaster shot, not slow bleed." Per-shot details are already computed in `computeRoundSG().perShot`.

### 8.5 Round insights "what happened today"

Narrative summary screen for completed rounds. Synthesizes existing data into a story: "You hit 11/14 fairways but lost 2.4 strokes on approaches — the misses were short more than they were left/right." Doesn't need new data; uses comparisons against the user's own history (`computeRoundBaselines` already exists).

### 8.6 Per-shot weather adjustments

Round doc now persists `weather` snapshot. Future use: adjust shot distances for "neutral conditions" (subtract tailwind/headwind contribution from actualYards). Enables a "What I'd hit in calm air" toggle in My Bag. Needs careful math (wind angle relative to shot bearing).

### 8.7 Course heat map

For repeat-played courses, overlay shot end positions across all rounds played there. Visual feedback on "where do I tend to miss" per hole. Could anchor practice ("I always miss right on hole 5 — set up an alignment drill"). Note: §4.21 Hole History is the per-hole version of this; a course-wide heatmap is the natural extension.

### 8.8 Per-club distance histograms in My Bag

Distance histograms are SHIPPED inside Club Data detail page (range carry distribution + GPS distribution). My Bag still uses single-number averages. Could surface the histogram inline in My Bag for a richer at-a-glance view of club consistency.

### 8.9 GPS Range Session — Phase B (HIGH PRIORITY)

Phase A scaffold is shipped: body-level overlay, map fills viewport, tap-on-map logs shot via `projectShotOntoTargetLine`, placeholder Dallas range for testing. Cycle-tap pickers temporary. Phase B is what makes it actually useful:

1. **Range entity** — `users/{uid}/ranges/{id}` private collection. Each range = `{ tee: {lat,lng}, targets: [{ id, distance, label, lat, lng }] }`. Persistent so user doesn't re-set up every session.
2. **Distance-aided ring setup UX** — Adding a target: user enters target distance (e.g. 150y), app draws a ring at that radius from the tee, user taps on the ring to commit direction. Distance is guaranteed by construction; only direction is user's call.
3. **Bottom-sheet pickers** to replace temp cycle-tap interactions.
4. **Re-use dispersion scatter/ellipse infra** for session results visualization.

### 8.10 Hazard drops — secondary improvements

Feature is functionally complete (§4.20). Worth adding when convenient:

- **Stats policy decisions:** Should `afterDrop` shots be included in club distance averages? In dispersion charts? Currently they ARE (the swing was real, the data is real), but they're flagged so we can filter later if data shows they pollute averages.
- **Edit sheet kind picker:** The retroactive flow defaults `penaltyKind: 'drop-new'`. No UI to pick stroke + distance retroactively. Mechanically the two are identical so it's cosmetic only — replay caption flavor.
- **Clear-drop button:** Once user taps "Drop here," there's no way to undo without canceling the whole flow. A small "Reset drop" affordance would let them re-tap if they captured the wrong spot.
- **Per-shot SG attribution for penalty strokes:** Currently penalty strokes count toward stroke totals + eligibility but don't show up as a distinct SG row. Could add a synthetic "penalty" line item in `holeContributions` so per-shot SG drill-down shows where the strokes were lost.

### 8.11 Nice-to-haves post-field-test

- Live toast notifications for friend round events ("Lane birdied hole 6!")
- Presence indicator (green dot for active in-round players)
- Round recap animation on finish
- Net/handicap scoring on leaderboard
- Pre/post round notes (free text on the round doc)
- Format selector at round start (currently retroactive only via round summary edit)
- Stats page transparency: "X of Y rounds counted toward stats" (showing how scrambles excluded)
- Improve scramble mode (currently stroke-play-style; group scramble needs format-specific UI)
- Set Tee friction fix (button mode picker doesn't surface manual override when far from default tee)

---

## 9. Common Tasks — How-To

### Adding a new preference

1. Add to `DEFAULT_PREFS` with a comment explaining what it does.
2. Add a render section in Profile (pick existing section or add new — `renderGameSection()` is the template for simple toggle prefs).
3. Add an action function (`setX(val)`) that validates, mutates `prefs`, calls `savePreferences()`, and re-renders.
4. If the pref affects multiple UI places, update each renderer to read it.

### Adding a new dock tool

1. Add entry to `DOCK_TOOLS` array (id, label, icon).
2. Add description to `DESCRIPTIONS` map in `renderToolsList` (shown as subtext on the tool row).
3. Add a render function (`renderX()`).
4. Add dispatch to `renderToolSurface(toolId)`.
5. Add CSS styling scoped with a unique prefix (like `.preshot-`).

### Adding a new panel

1. Add `<section class="panel" id="panel-X"></section>` in the HTML body section.
2. Register any render dispatch in `showPanel` if the panel needs setup on nav.
3. If mounted in the bottom-nav, add a nav button.
4. Render function should populate `innerHTML` of the section (or of a mount `<div>` inside).

### Adding a new Firestore collection

1. Add rules in `firestore.rules` first (security-first, always). Think hard about: who can read, who can create, who can update, who can delete.
2. Add `window.fb.*` methods that wrap the reads/writes.
3. Build client code on top of those methods.
4. Test in a Firestore emulator or sandbox first.

### Debugging a group round issue

1. Open two test accounts in two browser profiles.
2. Check `groupRoundState.doc` in console for each player — it's the cached snapshot.
3. Check the `groupRounds/{id}` doc in Firebase console directly for ground truth.
4. Check the results subcollection at `groupRounds/{id}/results/` for finished-player mirrors.
5. Watch browser network tab for `onSnapshot` firings (they appear as streamed responses).

---

## 10. File/Function Index (quick lookup)

Partial list of frequently-relevant entry points, with approximate line numbers in `golf-training-plan.html` (subject to drift as the file evolves; these are accurate as of late April 2026 — file is ~72,000 lines).

**State:**
- `DEFAULT_PREFS` — ~31,710
- `roundState` — ~36,524
- `groupRoundState` — ~36,627
- `dockState` — ~40,403
- `DOCK_TOOLS` catalog — ~40,418
- `SHOT_RESULTS` constant (lie outcomes incl. `'penalty'`) — ~40,533
- `shotEditState` — ~41,518
- `replayState` — ~59,074
- `roundGpsState` (incl. penalty state machine fields) — ~64,429
- `holeHistoryState` — search; mounted at `#hole-history-mount`

**Firebase wrapper:**
- `window.fb = {...}` — search; contains many methods (auth, CRUD, friends, group rounds, invites, subscriptions). Single boundary for Firestore/Auth.

**Core flows:**
- `showPanel` — ~30,423
- `startRoundFromCourse` — ~36,776
- `saveAndNext` — ~45,013
- `goPreviousHole` — ~45,104
- `completeCurrentRound` — ~39,871
- `autoSaveRound` — ~35,636
- `clearRoundState` — search; clears in-memory state AND wipes localStorage pins for the round

**Group round flows:**
- `createGroupRoundFromCourse` — ~36,980
- `startGroupRoundFromLobby` — ~37,396
- `saveMyGroupScoresNow` — ~38,077
- `completeMyGroupRound` — ~38,883
- `handleGroupRoundSnapshot` — ~48,800

**GPS view (in-round):**
- `openRoundGpsPanel` — ~64,591
- `loadRoundGpsHoleAndRender` — ~64,619 (hole change resets penalty state)
- `transitionRoundGpsToHole` — ~64,711
- `getEffectivePinLatLng` — search; returns user pin or green center
- `refreshDistanceReadouts` — re-renders all distance UI when pin moves
- Dispersion overlay — search for `updateDispersionOverlay` and `getDispersionAnchor`

**Hazard drops / penalty (§4.20):**
- Penalty state machine fields on `roundGpsState`: `penaltyMode`, `penaltyKind`, `pendingDropLat/Lng`
- `openPenaltyModal` — ~69,105
- `closePenaltyModal`, `confirmPenalty(kind)`, `cancelPenaltyFlow`, `updatePenaltyBanner` — sibling functions
- `handlePostTroubleShotLogged(shot)` — flag + bump penalty count after trouble shot logged
- `captureDropPosition` — ~69,256; stores user pos as drop, advances state
- `getShotStrokeNumber(shots, shotIndex)` — ~40,643; converts array index → stroke number (counts preceding endedInTrouble shots)
- `logShotAtCurrentPosition` — handles after-drop start override + post-trouble dispatch
- `saveShotDraft` penalty reconciliation — checks for penalty transition + maybe triggers drop flow
- Banner in DOM at `#round-gps-penalty-banner`; modal mount at `#penalty-modal-mount`

**Pin placement:**
- `openPinPlacementModal` — ~66,606
- `commitPinFromModal`, `removePinFromModal`, `closePinPlacementModal` — sibling functions
- `placePinAtPosition` — drops the locked pin marker on the main GPS map
- Persistence helpers: `savePinsForRound`, `loadPinsForRound`, `readPinsForRoundId`, `clearPinsForRound`

**Round Replay:**
- `openReplay(roundId, opts?)` — ~59,094; opts: `{ initialHole, initialShotId }` for deep-linking
- `openReplayAtShot(roundId, holeNumber, shotId)` — convenience wrapper; round summary per-shot rows call this
- `openPublicReplay(authorUid, roundId)` — public mirror version; reads from `publicProfiles`
- `loadReplayHole(idx, opts?)` — ~60,626; opts: `{ autoPlay, initialShotIndex }` for jump-on-load
- `replayJumpToShot(targetIdx)` — ~60,970; instant scrub; redraws shots 0..targetIdx
- `renderReplayStaticMarkers` — adds tee/green/flag-pin markers; flag pin uses symbol layer
- `replayPlay`, `replayPause`, `replayStep`, `cancelReplayAnimation`
- `addReplayShotEndMarker` — pin renderer; trouble shots get red fill + white text via `endedInTrouble` flag
- `animateReplayShot` / `drawReplayShotInstantly` — line renderers; trouble shots get red line

**Hole History (§4.21):**
- `openHoleHistory(courseId, holeNumber)` — ~59,372; entry
- `closeHoleHistory` — teardown
- `gatherRoundsForHole`, `holeHistoryColorForRound` — data shaping
- `drawRoundShotsAsLayer` (heatmap) / `drawSingleShotLayer` (reel) — render; both honor `endedInTrouble` for red

**Shot edit:**
- `openShotEditSheet(holeNumber, shotId?)` — ~41,701; opens edit sheet for round or replay shot
- `saveShotDraft` — ~42,335; saves edits, propagates boundary coords (chain invariant repair, with afterDrop guard), reconciles penalty transition
- `computeShotEditDistances` / `updateShotEditDistanceCaption` — live readouts on edit map (shot length + remaining)

**Strokes Gained:**
- `computeRoundSG` — ~51,158; main aggregator. Green-coord priority: `course.holes[i].greenLat` (from `course.greenCoords`), fall back to `round.pins[hn]`. trackedCount includes penalties. Synthesizes puttList from legacy fields when puttList is empty.
- `window.debugSG(roundId?)` — ~51,458; console diagnostic; columns: gpsShots, puttList, legacyPutts, effPutts, penalties, trouble, afterDrop, reportedStrokes, tracked, gap
- `renderSGBlock` — ~51,780; round-summary UI
- Baseline tables: `SG_BASELINE_TEE / FAIRWAY / ROUGH / SAND / RECOVERY / GREEN`
- `expectedStrokes(lie, yards)`, `expectedStrokesPutt(feet)`, `interpolateBaseline(table, distance)`
- `categorizeShotForSG({ ... })`, `computeShotSGFromStates(beforeES, afterES)`
- `computeAggregateSG(rounds)` — multi-round aggregate (built but UI not wired yet — see 8.3)

**Round format:**
- `ROUND_FORMATS` constant + `roundCountsForStats(round)` predicate — chokepoint for stats filtering
- `getRoundFormat(round)`, `getRoundFormatLabel(round)`
- `openFormatEditor`, `setRoundFormatAndClose` — retroactive editing

**Theme palette (§5.14):**
- `applyPalette()` — ~32,030; reads `prefs.palette`, sets `data-theme` attribute on `<html>`
- `setPalette(name)` — ~32,048; called from Profile palette picker
- `resolveCssColor(varName, fallbackHex)` — search; reads computed style; used by Mapbox layers + scatter charts for theme-aware colors
- `activeAccentColor()` — search; returns the current active accent color
- Pre-paint init script at top of HTML reads palette from localStorage (synchronous, before CSS loads)

**Tools customization (§5.15):**
- `prefs.toolsConfig` — null OR `[{id, visible}, ...]`
- `getEffectiveDockTools()` — ~40,445; merges catalog with user config; forward-compat
- Edited via Profile → Your Game → In-round tools (search for `renderToolsEditorSheet` / `openToolsEditor`)

**Sync indicator:**
- `syncBeginSave` / `syncEndSave` / `applySyncIndicator` / `syncRetry` — search

**Render dispatchers:**
- `renderPlayLanding` — ~48,753
- `renderTodayCard` — ~30,103
- `renderGroupLobby` — ~37,147
- `renderGroupRoundPanel` — ~39,543
- `renderRound` — ~40,164
- `renderRoundDock` — ~41,244
- `renderToolSurface` — ~41,489
- `renderHistory` — ~36,004
- `renderProfile` — ~36,045
- `renderSocial` — ~52,509
- `renderRoundSummary` — ~58,099
- `renderRoundInviteBanner(mountId)` — ~29,987

**Pre-Shot tool data:**
- `PRESHOT_TIPS` constant — near `renderPreShotTool` — array of `{ category, items: [{ situation, tip, dirFlip }] }`. Edit items here to tweak tip content.

---

## 11. Style & Voice Conventions

- **Comments over abstraction.** If you're tempted to DRY up something, ask first whether a good comment at the duplication site would serve readers better. Often yes.
- **Function names are verbs-for-actions, `renderX` for UI.** `saveAndNext`, `completeCurrentRound`, `renderGroupLobby`, etc.
- **Error handling is humane.** Use `showToast(msg, true)` for recoverable user-facing errors. Log to console for developer diagnostics. Don't throw to users.
- **CSS is BEM-ish.** `.preshot-header`, `.preshot-item`, `.preshot-situation` — block-element names scoped with a unique prefix per feature.
- **Responsive = portrait-phone-first.** Test at ~375px width. Desktop is a bonus.
- **Dark mode via CSS custom properties.** Don't hardcode colors in component CSS. Use `var(--text-primary)` etc. and let `html.dark` overrides handle the rest.

---

*Last updated: 2026-04-29. Keep this living — when you land a change that affects the architecture (new subsystem, new data shape, new race condition solved), add a note here so the next reader benefits.*
