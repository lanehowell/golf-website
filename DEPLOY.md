# Deploy & Setup

Cheat sheet for getting the app running and pushing changes.

---

## Project basics

- **Firebase project**: `golf-site-525a9` (pinned in `.firebaserc`)
- **Region**: `us-central1` (set in `firebase.json` is implicit; explicit in `functions/index.js` via `setGlobalOptions`)
- **GitHub remote**: `https://github.com/lanehowell/golf-website.git`
- **Functions runtime**: Node 22 (set in `functions/package.json`)

---

## First-time setup (new machine)

```powershell
# 1. Install Firebase CLI globally
npm install -g firebase-tools

# 2. Sign into the Firebase account
firebase login

# 3. Pull the repo
git clone https://github.com/lanehowell/golf-website.git
cd golf-website

# 4. Install function dependencies
cd functions
npm install
cd ..

# 5. Set the Gemini API key as a Firebase secret
#    (only needed once per project)
firebase functions:secrets:set GEMINI_API_KEY
# Paste the API key from https://aistudio.google.com/app/apikey
```

---

## Running locally

The site is a static SPA — any local server works.

```powershell
# Pick a port; Python is the simplest if it's already installed.
python -m http.server 8000
# Then open http://localhost:8000/ in a browser
```

Firebase Auth needs a real Firebase project (config is hardcoded in `index.html`), so you'll be signing into the production project even when running locally. Don't generate dozens of test rounds; they all hit your real Firestore.

---

## Deploys

### Deploy Cloud Functions

```powershell
firebase deploy --only functions
```

When to redeploy:
- Changed any prompt in `functions/index.js`
- Added/removed/renamed a callable
- Bumped a model name
- Changed `maxOutputTokens` / `temperature` / `thinkingBudget`
- Updated `functions/package.json` deps

First deploy of a new function may take a few minutes (cold-start build). Subsequent deploys are ~30-60s.

### Deploy Firestore rules

```powershell
firebase deploy --only firestore:rules
```

**⚠️ The deployed rules become whatever's in `firestore.rules` — there's no merge.** Earlier in this project, a deploy of an incomplete file silently removed `swingThoughts`, `journalEntries`, and `admins` rules from production. Sanity check the local file lists all expected match blocks before deploying.

### Deploy both at once

```powershell
firebase deploy --only functions,firestore:rules
```

### Deploy hosting

If/when hosting moves to Firebase Hosting (not currently set up — the site is hosted elsewhere):

```powershell
# Would require adding "hosting" to firebase.json first
firebase deploy --only hosting
```

For now, deployment of the static site goes through whatever Git-based pipeline serves `index.html`.

---

## Gotchas

- **Blaze plan required for Cloud Functions outbound HTTPS.** The Gemini API is an external HTTPS call, which Spark (free) plan blocks. The project is on Blaze; Firebase will prompt you to enable billing on a fresh project. No charge unless you exceed free-tier quotas.
- **Secrets are per-environment.** `firebase functions:secrets:set` writes to the deployed project. If you ever spin up a staging project, you need to set the secret there separately.
- **Don't commit `.firebaserc` aliasing other projects.** The single-project setup keeps it simple.
- **Pre-deploy lint:** `firebase.json` has `"predeploy": []` (empty). If you ever add lint/test there, deploys block on those.
- **Cold-start latency** on Cloud Functions can hit 2-3 seconds for the first call after a quiet period. The user-facing loading state (`coachState.loading`) absorbs this gracefully.

---

## Pushing to GitHub

The repo is private and the `main` branch is the source of truth.

```powershell
git status                 # see what changed
git add <files>            # stage specific files (avoid `git add .` to keep node_modules out)
git commit -m "..."        # see commit history for style
git push origin main       # push to GitHub
```

Force-push to main is blocked by Claude Code's auto-mode classifier (good — it's destructive). If you genuinely need to force-push, run the command yourself:

```powershell
git push --force-with-lease origin main
```

The `.gitignore` excludes `.claude/`, `node_modules/`, `*.log`, `.env*`, and Firebase deploy cache (`.firebase/`).

---

## Quick smoke test after a deploy

1. Hard reload the page (`Ctrl+Shift+R` to bust caches)
2. Practice tab → tap Coach bar → bottom sheet opens → tap Generate → plan renders
3. Round Summary on a completed round → "Get AI review of this round" → review renders + persists
4. Hole drill-down → "Why this hole?" → analysis renders in-place, sheet doesn't close

If any of those fail with `Missing or insufficient permissions`, the Firestore rules deploy probably dropped a rule. Check the local `firestore.rules` against what the failing operation needs.

If they fail with `db is not defined`, you wrote a Firestore call in non-module code without going through `window.fb.*`. See `COACH.md` §4.5.

---

## API key rotation

```powershell
firebase functions:secrets:set GEMINI_API_KEY
# Paste new key when prompted
firebase deploy --only functions
# The function picks up the new secret on its next cold start
```

To verify a function has the right secret bound:

```powershell
firebase functions:secrets:access GEMINI_API_KEY
```

---

## Useful one-liners

```powershell
# Tail function logs (last 100 lines, then live)
firebase functions:log --only getCoachRecommendation --lines 100

# Test a callable from the CLI (replace UID)
# (rarely needed; the browser is the easier surface)

# Re-run an existing failing deployment with verbose output
firebase deploy --only functions --debug
```
