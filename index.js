// ─────────────────────────────────────────────────────────────
  // Program configuration
  // ─────────────────────────────────────────────────────────────
  // Schedule: Monday / Wednesday / Friday
  // JS weekday numbers: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const SCHEDULE = {
    1: { dayId: 'day1', panelId: 'panel-day1', title: 'Power & <em>Rotation</em>', number: '01', sub: 'Cable rotational work. Posterior chain. The heaviest day for swing speed.', minutes: '~45', exercises: 8, supersets: 2, focus: 'POWER DAY' },
    3: { dayId: 'day2', panelId: 'panel-day2', title: 'Strength & <em>Stability</em>', number: '02', sub: 'Compound strength movements. Builds the structural foundation.', minutes: '~50', exercises: 8, supersets: 2, focus: 'STRENGTH DAY' },
    5: { dayId: 'day3', panelId: 'panel-day3', title: 'Lower Body & <em>Hip Power</em>', number: '03', sub: 'Hip-focused. Leg press loads the lower body without spinal compression.', minutes: '~45', exercises: 7, supersets: 1, focus: 'HIP DAY' }
  };

  const WEEK = [
    { letter: 'MON', dow: 1 },
    { letter: 'TUE', dow: 2 },
    { letter: 'WED', dow: 3 },
    { letter: 'THU', dow: 4 },
    { letter: 'FRI', dow: 5 },
    { letter: 'SAT', dow: 6 },
    { letter: 'SUN', dow: 0 }
  ];

  // ─────────────────────────────────────────────────────────────
  // Course catalog (bundled with the app)
  // ─────────────────────────────────────────────────────────────
  // For now this is a single hand-curated entry. Eventually grows to a
  // larger curated set; user-added courses are deferred (see notes on
  // multiplayer scorecard interaction). The data shape:
  //   id, name, location
  //   holes[]:  { number, par, handicap (stroke index 1-18) }
  //   tees[]:   { name, color, yardages[18], totalYards, rating, slope }
  // Pars are course-level (don't change by tee). Yardages are per-tee.
  // Course rating + slope per tee are USGA-published numbers, used later
  // for net handicap calculation.
  const COURSES = [
    {
      id: 'mesquite-gc',
      name: 'Mesquite Golf Club',
      location: 'Mesquite, TX',
      holes: [
        { number: 1,  par: 4, handicap: 12 },
        { number: 2,  par: 4, handicap: 14 },
        { number: 3,  par: 5, handicap: 10 },
        { number: 4,  par: 3, handicap: 18 },
        { number: 5,  par: 4, handicap: 6  },
        { number: 6,  par: 3, handicap: 2  },
        { number: 7,  par: 5, handicap: 8  },
        { number: 8,  par: 4, handicap: 16 },
        { number: 9,  par: 4, handicap: 4  },
        { number: 10, par: 4, handicap: 17 },
        { number: 11, par: 5, handicap: 11 },
        { number: 12, par: 3, handicap: 13 },
        { number: 13, par: 4, handicap: 3  },
        { number: 14, par: 4, handicap: 15 },
        { number: 15, par: 3, handicap: 7  },
        { number: 16, par: 5, handicap: 1  },
        { number: 17, par: 3, handicap: 9  },
        { number: 18, par: 4, handicap: 5  }
      ],
      tees: [
        {
          name: 'Black',
          color: '#0d0d0d',
          yardages: [393, 442, 529, 184, 400, 220, 532, 404, 402, 399, 520, 217, 414, 401, 184, 560, 237, 447],
          totalYards: 6885,
          rating: 74.2,
          slope: 128
        },
        {
          name: 'Gold',
          color: '#c9a23a',
          yardages: [369, 427, 489, 174, 379, 179, 514, 389, 385, 376, 504, 187, 401, 356, 171, 543, 217, 374],
          totalYards: 6434,
          rating: 71.8,
          slope: 127
        },
        {
          name: 'Blue',
          color: '#1e63d1',
          yardages: [334, 383, 472, 156, 363, 160, 483, 359, 358, 356, 465, 159, 363, 320, 156, 480, 201, 345],
          totalYards: 5913,
          rating: 68.7,
          slope: 119
        },
        {
          name: 'White',
          color: '#f5f0e6',
          yardages: [255, 330, 450, 131, 335, 132, 429, 311, 302, 314, 409, 111, 259, 248, 131, 408, 144, 289],
          totalYards: 4988,
          rating: 65.1,
          slope: 112
        }
      ]
    }
  ];

  // Helper: look up a course by id
  function getCourse(courseId) {
    return COURSES.find(c => c.id === courseId) || null;
  }

  // ─────────────────────────────────────────────────────────────
  // Find today's or next scheduled workout
  // ─────────────────────────────────────────────────────────────
  // Build a map of weekday → array of workout configs from prefs.
  // Falls back to the static SCHEDULE if no override is set for a weekday.
  // The shape returned mirrors what callers expect: each weekday entry is
  // an array of workout objects (possibly empty for rest days).
  function getEffectiveScheduleByWeekday() {
    const result = {};
    for (let weekday = 0; weekday < 7; weekday++) {
      const overrideIds = prefs.scheduleOverride[weekday];
      if (overrideIds && overrideIds.length > 0) {
        // Convert dayIds to workout configs by looking them up in SCHEDULE
        const workouts = overrideIds.map(id => {
          for (const dow of Object.keys(SCHEDULE)) {
            if (SCHEDULE[dow].dayId === id) return SCHEDULE[dow];
          }
          return null;
        }).filter(Boolean);
        result[weekday] = workouts;
      } else {
        result[weekday] = []; // explicit rest day
      }
    }
    return result;
  }

  function resolveToday() {
    const today = new Date().getDay();
    const schedule = getEffectiveScheduleByWeekday();
    if (schedule[today].length > 0) {
      return {
        isToday: true,
        dow: today,
        workout: schedule[today][0],
        allWorkouts: schedule[today]  // surface the full list for callers that want it
      };
    }
    // Rest day — find next scheduled workout
    for (let i = 1; i <= 7; i++) {
      const nextDow = (today + i) % 7;
      if (schedule[nextDow].length > 0) {
        return {
          isToday: false,
          dow: nextDow,
          workout: schedule[nextDow][0],
          allWorkouts: schedule[nextDow]
        };
      }
    }
    return null; // truly empty schedule
  }

  function weekdayName(dow) {
    return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dow];
  }

  // ─────────────────────────────────────────────────────────────
  // Render the Today card
  // ─────────────────────────────────────────────────────────────
  function renderTodayCard() {
    const resolution = resolveToday();
    const mount = document.getElementById('today-card-mount');
    if (!mount) return;
    if (!resolution) {
      // No workouts scheduled at all — show a fallback explaining this and
      // pointing to settings so the user can re-add days.
      const todayName = weekdayName(new Date().getDay());
      const swapSection = renderSwapSection(null);
      mount.innerHTML = `
        <div class="today-card rest" data-bg-num="—">
          <div class="today-eyebrow">Today · ${todayName}</div>
          <h2 class="today-title">No <em>Schedule</em> Set</h2>
          <p class="today-sub">You haven't set any workout days. Open Settings to assign Day 1, 2, and 3 to days of the week — or pick a workout below to do today.</p>
          <div class="today-actions">
            <button class="today-btn today-btn-primary" onclick="showPanel('profile', null)">Open Profile →</button>
            <button class="today-btn today-btn-ghost" onclick="showPanel('stretch', null)">Daily Stretch</button>
          </div>
          ${swapSection}
        </div>`;
      return;
    }
    const { isToday, dow, workout } = resolution;
    const todayName = weekdayName(new Date().getDay());
    const scheduledName = weekdayName(dow);
    // Build the swap section once, shared across both card variants.
    const swapSection = renderSwapSection(isToday ? workout.dayId : null);

    if (isToday) {
      // If there are 2+ workouts scheduled today, surface the others as a hint.
      const others = (resolution.allWorkouts || []).slice(1);
      const otherNote = others.length > 0
        ? `<div class="today-eyebrow" style="color: var(--text-muted); margin-top: var(--space-3);">Also scheduled today: ${others.map(w => `Day ${w.number}`).join(', ')}</div>`
        : '';
      mount.innerHTML = `
        <div class="today-card" data-bg-num="${workout.number}">
          <div class="today-eyebrow">Today · ${todayName}</div>
          <h2 class="today-title">Day ${workout.number} — ${workout.title}</h2>
          <p class="today-sub">${workout.sub}</p>
          ${otherNote}
          <div class="today-actions">
            <button class="today-btn today-btn-primary" onclick="startWorkout('${workout.dayId}')">Start Workout →</button>
            <button class="today-btn today-btn-ghost" onclick="showPanel('${workout.dayId}', null)">Preview</button>
          </div>
          ${swapSection}
          <div class="today-stats">
            <div class="today-stat"><span class="today-stat-value">${workout.exercises}</span><span class="today-stat-label">Exercises</span></div>
            <div class="today-stat"><span class="today-stat-value">${workout.minutes}</span><span class="today-stat-label">Minutes</span></div>
            <div class="today-stat"><span class="today-stat-value">${workout.focus}</span><span class="today-stat-label">Session Focus</span></div>
          </div>
        </div>`;
    } else {
      mount.innerHTML = `
        <div class="today-card rest" data-bg-num="—">
          <div class="today-eyebrow">Today · ${todayName} · Rest Day</div>
          <h2 class="today-title">Rest Day — Play <em>Golf</em></h2>
          <p class="today-sub">No lifting today. Get 18 in if you can, and do the Daily Stretch routine. Next workout: <strong>Day ${workout.number} — ${stripHtml(workout.title)}</strong> on ${scheduledName}.</p>
          <div class="today-actions">
            <button class="today-btn today-btn-primary" onclick="showPanel('stretch', null)">Daily Stretch →</button>
            <button class="today-btn today-btn-ghost" onclick="showPanel('${workout.dayId}', null)">Preview ${scheduledName}'s Workout</button>
          </div>
          ${swapSection}
          <div class="today-stats">
            <div class="today-stat"><span class="today-stat-value">${scheduledName}</span><span class="today-stat-label">Next Workout</span></div>
            <div class="today-stat"><span class="today-stat-value">8–10</span><span class="today-stat-label">Min Stretch</span></div>
            <div class="today-stat"><span class="today-stat-value">${workout.focus}</span><span class="today-stat-label">Up Next</span></div>
          </div>
        </div>`;
    }
  }

  // Quick-swap section: collapsed link that expands to show three workout
  // day options. Lets the user start a different workout than the scheduled
  // one — useful when you miss a day, want to swap, or want to squeeze in
  // a workout on a rest day. The `scheduledDayId` param (nullable) gets a
  // subtle "current" marker so users know which one is today's default.
  function renderSwapSection(scheduledDayId) {
    // Build one option per day from the SCHEDULE config
    const options = [];
    for (const dow of Object.keys(SCHEDULE)) {
      const w = SCHEDULE[dow];
      const isCurrent = w.dayId === scheduledDayId;
      options.push(`
        <button class="swap-option-btn${isCurrent ? ' current' : ''}" onclick="event.stopPropagation(); startWorkout('${w.dayId}')">
          <span class="swap-option-num">Day ${w.number}${isCurrent ? ' · Today' : ''}</span>
          <span class="swap-option-name">${stripHtml(w.title)}</span>
        </button>`);
    }
    return `
      <div class="swap-wrap">
        <button class="swap-toggle" onclick="toggleSwap(this)" aria-expanded="false">
          <span class="swap-caret">▼</span>
          <span>Choose a different workout</span>
        </button>
        <div class="swap-options"><div class="swap-options-inner">
          ${options.join('')}
        </div></div>
      </div>`;
  }

  // Toggle the swap section. Attached to the header button via onclick.
  function toggleSwap(btn) {
    const wrap = btn.closest('.swap-wrap');
    if (!wrap) return;
    const opening = !wrap.classList.contains('open');
    wrap.classList.toggle('open', opening);
    btn.setAttribute('aria-expanded', String(opening));
  }

  function stripHtml(str) {
    const div = document.createElement('div');
    div.innerHTML = str;
    return div.textContent || '';
  }

  // ─────────────────────────────────────────────────────────────
  // Render the week strip
  // ─────────────────────────────────────────────────────────────
  function renderWeekStrip() {
    const today = new Date().getDay();
    const strip = document.getElementById('week-strip');
    if (!strip) return;
    const effective = getEffectiveScheduleByWeekday();
    strip.innerHTML = WEEK.map(d => {
      const workouts = effective[d.dow] || [];
      const isWorkout = workouts.length > 0;
      const isToday = d.dow === today;
      const classes = ['week-day'];
      if (isWorkout) classes.push('workout');
      if (isToday) classes.push('today');
      let label;
      if (isWorkout) {
        // Multiple workouts: list all numbers (e.g. "Day 1+3")
        label = workouts.length > 1
          ? `Day ${workouts.map(w => w.number).join('+')}`
          : `Day ${workouts[0].number}`;
      } else {
        label = 'Rest';
      }
      return `
        <div class="${classes.join(' ')}">
          <div class="week-day-name">${d.letter}</div>
          <div class="week-day-dot"></div>
          <div class="week-day-label">${label}</div>
        </div>`;
    }).join('');
  }

  // ─────────────────────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────────────────────
  // Track previous panel so Back link knows where to return.
  // Only updated when the user navigates between top-level panels — not
  // when programmatically restoring state.
  let previousPanelId = null;
  let currentPanelId = 'today';

  // Track mobile mode dynamically via matchMedia so JS can make layout-aware
  // decisions (scroll math, transitions) without duplicating the media query.
  const mobileMQ = window.matchMedia('(max-width: 768px)');
  function isMobileMode() { return mobileMQ.matches; }

  // Map panel id → mobile topbar title shown at the top of the screen.
  // Falls back to a generic label for day panels, which get their workout
  // number filled in dynamically.
  function mobilePanelTitle(id) {
    if (id === 'today')          return 'Today';
    if (id === 'stretch')        return 'Daily Stretch';
    if (id === 'library')        return 'Library';
    if (id === 'history')        return 'History';
    if (id === 'play')           return 'Play';
    if (id === 'social')         return 'Social';
    if (id === 'profile')        return 'Profile';
    if (id === 'courses')        return 'Courses';
    if (id === 'course-detail')  return 'Course';
    if (id === 'round')          return 'Round';
    if (id === 'round-summary')  return 'Round Summary';
    if (id === 'day1')           return 'Day 1';
    if (id === 'day2')           return 'Day 2';
    if (id === 'day3')           return 'Day 3';
    return '';
  }

  // Which top-level tab should appear "active" in the bottom nav?
  // All training-related panels (today, stretch, library, history, dayN)
  // light up the Train tab. Play/Social/Profile are their own destinations.
  // Courses + course-detail + round + round-summary are sub-pages of Play.
  function mobileActiveTab(id) {
    if (id === 'play' || id === 'courses' || id === 'course-detail' ||
        id === 'round' || id === 'round-summary') return 'play';
    if (id === 'social')  return 'social';
    if (id === 'profile') return 'profile';
    return 'train';
  }

  // Determine slide direction: forward (right-to-left) for top-level tab
  // taps and rest → workout drilldowns; reverse for back-button + up-out.
  // A simple ordered list defines the visual hierarchy for deciding direction.
  // Train sub-pages come first (today is the Train landing), then the other
  // top-level tabs in left-to-right nav order. Play sub-pages slot after Play.
  const PANEL_ORDER = ['today', 'stretch', 'library', 'history', 'day1', 'day2', 'day3', 'play', 'courses', 'course-detail', 'round', 'round-summary', 'social', 'profile'];
  function slideDirection(fromId, toId) {
    const fromIdx = PANEL_ORDER.indexOf(fromId);
    const toIdx = PANEL_ORDER.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return 'right';
    return toIdx >= fromIdx ? 'right' : 'left';
  }

  function showPanel(id, btn, opts) {
    opts = opts || {};
    const prevId = currentPanelId;

    // If leaving the Profile panel with unsaved schedule changes, confirm.
    // Skip the prompt if the user is just re-tapping the same panel.
    if (prevId === 'profile' && id !== 'profile' && hasPendingScheduleChanges()) {
      const ok = confirm('You have unsaved schedule changes. Leave without saving?');
      if (!ok) return;
      // User chose to leave — discard the pending edits silently
      resetPendingSchedule();
    }

    // Update history: only track moves between *different* panels
    if (id !== currentPanelId) {
      previousPanelId = currentPanelId;
      currentPanelId = id;
    }

    document.querySelectorAll('.panel').forEach(p => {
      p.classList.remove('active', 'slide-in-right', 'slide-in-left');
    });
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
    const target = document.getElementById('panel-' + id);
    if (target) {
      target.classList.add('active');
      // Slide animation on mobile only; desktop stays instant
      if (isMobileMode() && prevId && prevId !== id) {
        const dir = opts.direction || slideDirection(prevId, id);
        target.classList.add(dir === 'left' ? 'slide-in-left' : 'slide-in-right');
      }
    }
    if (btn) {
      btn.classList.add('active');
    } else {
      const inferred = inferNavTab(id);
      if (inferred) inferred.classList.add('active');
    }

    // Mobile: update the top title bar, bottom nav highlight, data attribute
    // that controls back-button visibility.
    document.body.dataset.currentPanel = id;
    const titleEl = document.getElementById('mobile-topbar-title');
    if (titleEl) titleEl.textContent = mobilePanelTitle(id);
    syncMobileBottomNav(id);

    // Panel-specific renders: refresh content for panels that need fresh
    // state when shown. Static panels skip this.
    if (id === 'courses') renderCoursesList();
    if (id === 'course-detail') renderCourseDetail();
    if (id === 'round') renderRound();
    if (id === 'round-summary') renderRoundSummary();
    if (id === 'play') renderPlayLanding();

    // Scroll behavior — hero has been removed everywhere, so we just scroll
    // to the top on every panel switch. The sticky nav stays pinned at the
    // top regardless of scroll position.
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  }

  // Update which bottom-nav pill is active, based on the panel we're showing
  function syncMobileBottomNav(panelId) {
    const activeKey = mobileActiveTab(panelId);
    const items = {
      train:   document.getElementById('mnav-train'),
      play:    document.getElementById('mnav-play'),
      social:  document.getElementById('mnav-social'),
      profile: document.getElementById('mnav-profile')
    };
    Object.entries(items).forEach(([key, el]) => {
      if (!el) return;
      el.classList.toggle('active', key === activeKey);
      el.setAttribute('aria-selected', String(key === activeKey));
    });
  }

  // Map panel → which desktop nav tab should light up when you're on it.
  // All training-related panels light up the Train tab; Play/Social/Profile
  // each own their own tab. Mirrors mobileActiveTab().
  function inferNavTab(panelId) {
    if (panelId === 'play' || panelId === 'courses' || panelId === 'course-detail' ||
        panelId === 'round' || panelId === 'round-summary') {
      return document.getElementById('nav-play');
    }
    if (panelId === 'social')  return document.getElementById('nav-social');
    if (panelId === 'profile') return document.getElementById('nav-profile');
    // Everything else — today/stretch/library/history/dayN — is a Train sub-page.
    return document.getElementById('nav-train');
  }

  // Logical parent of each sub-page — where the back button should go,
  // independent of how the user actually got there. This avoids the
  // common "back ping-pongs between two pages" bug that happens when
  // back is just "previous panel."
  const PANEL_PARENTS = {
    // Train sub-pages all return to the Train landing
    stretch:         'today',
    library:         'today',
    history:         'today',
    day1:            'today',
    day2:            'today',
    day3:            'today',
    // Play sub-pages
    courses:         'play',
    'course-detail': 'courses',
    // Live round is an immersive mode; back exits to the main Play screen.
    round:           'play',
    // Summary is a terminal screen — back goes to Play landing, not the
    // (now-completed) round screen which has no state to show anymore.
    'round-summary': 'play',
    // Profile/Social currently have no sub-pages
  };

  // Back button on any sub-page. Uses the logical parent map first, then
  // falls back to the most recent previous panel, then to Today.
  function goBack() {
    const target = PANEL_PARENTS[currentPanelId] || previousPanelId || 'today';
    // Force left-slide direction so the mobile transition mirrors the
    // forward navigation that got us here, regardless of panel order.
    showPanel(target, null, { direction: 'left' });
  }

  function startWorkout(dayId) {
    beginSession(dayId);
  }

  function toggleEx(card) {
    // In session mode on the active day, tapping the card doesn't toggle cues —
    // the collapsible detail is hidden and the Log button handles logging.
    if (session.active && card.closest('.panel.session-day')) return;
    card.classList.toggle('open');
  }

  // Info button — always toggles the cue drawer, used in session mode where
  // tapping the card as a whole is reserved for set logging.
  function toggleInfo(btn) {
    const card = btn.closest('.ex-card');
    if (card) card.classList.toggle('open');
  }

  // ═════════════════════════════════════════════════════════════
  // WORKOUT SESSION
  // ═════════════════════════════════════════════════════════════
  const session = {
    active: false,
    docId: null,             // Firestore doc id for this session (set when started)
    dayId: null,             // 'day1' | 'day2' | 'day3'
    startTime: null,         // ms timestamp
    timerInterval: null,
    logs: {},                // exerciseKey -> { sets: [{weight, reps, notes}, ...], done: bool }
    currentExerciseKey: null // while modal is open
  };

  // Build a stable key for an exercise card (uses the exercise name)
  function exerciseKey(card) {
    const name = card.querySelector('.ex-name')?.textContent?.trim() || '';
    return name;
  }

  // Parse the rep scheme to decide set structure.
  // Returns: { count: number, perSide: bool, timed: bool, label: string }
  function parseRx(card) {
    const setsText = card.querySelector('.ex-sets')?.textContent?.trim() || '';
    const restText = card.querySelector('.ex-rest')?.textContent?.trim() || '';

    // Timed exercise (e.g. "5 min", "2×40s")
    if (/\d+\s*min\b/i.test(setsText) || /\b\d+s\b/.test(setsText)) {
      // Still has set count for farmer's carry etc (e.g. "2×40s")
      const multi = setsText.match(/^(\d+)×/);
      if (multi) {
        return { count: parseInt(multi[1], 10), perSide: false, timed: true, label: setsText };
      }
      return { count: 1, perSide: false, timed: true, label: setsText };
    }

    // "3×8" or "3×8" — setsText like "3×8"
    const m = setsText.match(/(\d+)\s*[×x]\s*(\d+)/);
    const setCount = m ? parseInt(m[1], 10) : 1;
    const perSide = /each\s*side|each\s*leg/i.test(restText);
    return { count: setCount, perSide, timed: false, label: setsText };
  }

  function beginSession(dayId) {
    if (session.active) {
      if (!confirm('A workout is already in progress. Start a new one?')) return;
      clearInterval(session.timerInterval);
    }
    session.active = true;
    session.dayId = dayId;
    session.startTime = Date.now();
    session.logs = {};
    // Stable Firestore doc id for the lifetime of this session. Same id is
    // used for in-progress writes and the final completed record so they
    // overwrite cleanly. Format mirrors completed: dateKey_dayId_startTime.
    const d = new Date(session.startTime);
    const pad = (n) => String(n).padStart(2, '0');
    const dateKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    session.docId = `${dateKey}_${dayId}_${session.startTime}`;
    document.body.classList.add('session-active');

    // Set banner title
    const title = getDayTitle(dayId);
    document.getElementById('session-title').textContent = title;

    // Mark the active day panel and its progress bar
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('session-day'));
    const dayPanel = document.getElementById('panel-' + dayId);
    if (dayPanel) dayPanel.classList.add('session-day');
    document.querySelectorAll('.session-progress').forEach(p => p.removeAttribute('data-active-day'));
    const progressEl = document.getElementById('progress-' + dayId);
    if (progressEl) progressEl.setAttribute('data-active-day', 'true');

    // Reset all ex-card visual state on the active day
    if (dayPanel) {
      dayPanel.querySelectorAll('.ex-card').forEach(c => {
        c.classList.remove('done', 'open');
        const logBtn = c.querySelector('.ex-log-btn');
        if (logBtn) logBtn.classList.remove('has-logs');
      });
    }

    updateProgress();
    startTimer();
    recalcBannerHeight();
    // Persist the brand-new session so it's resumable on refresh
    autoSaveSession();
    // Jump into the workout view
    showPanel(dayId, null);
  }

  async function endSession() {
    if (!session.active) return;

    // Before we snapshot, walk every ex-card on the active day's panel and
    // make sure each one has an entry in session.logs. Exercises the user
    // never touched get marked skipped — this way history shows a complete
    // picture of every exercise from every workout.
    const dayPanel = document.getElementById('panel-' + session.dayId);
    if (dayPanel) {
      dayPanel.querySelectorAll('.ex-card').forEach(card => {
        const name = exerciseKey(card);
        if (!session.logs[name]) {
          session.logs[name] = { sets: [], done: false, skipped: true };
        } else {
          // Make sure existing entries have an explicit skipped:false so
          // older data doesn't accidentally render as skipped later.
          session.logs[name].skipped = false;
        }
      });
    }

    // Check if there's anything worth saving (any logged set OR any done check).
    // Skipped-only sessions still count as saveable — the whole point is to
    // track program adherence including when you bailed on everything.
    const hasAnyData = Object.values(session.logs).some(entry =>
      entry.done ||
      (Array.isArray(entry.sets) && entry.sets.some(s => s && (s.weight || s.reps || s.notes)))
    );

    let confirmMsg;
    if (currentUser && hasAnyData) {
      confirmMsg = 'End this workout? Your session will be saved.';
    } else if (currentUser && !hasAnyData) {
      confirmMsg = 'End this workout? Nothing was logged — all exercises will be marked skipped.';
    } else if (!currentUser && hasAnyData) {
      confirmMsg = 'End this workout? You\'re not signed in, so logs won\'t be saved.';
    } else {
      confirmMsg = 'End this workout?';
    }
    if (!confirm(confirmMsg)) return;

    // Capture the snapshot before we clear state, so saving can run after.
    const snapshot = {
      docId: session.docId,
      dayId: session.dayId,
      startTime: session.startTime,
      logs: JSON.parse(JSON.stringify(session.logs))
    };

    // Show saving state on the End button. We now save even when hasAnyData
    // is false — a "skipped entire workout" record is still useful data.
    const endBtn = document.querySelector('.session-banner-btn.end');
    if (endBtn && currentUser) endBtn.classList.add('saving');

    try {
      if (currentUser) {
        const saved = await saveSessionToFirestore(snapshot);
        if (saved) {
          // Prepend to local cache so the just-saved session is immediately
          // visible in History without a round-trip. Filter is a safety
          // measure — with unique per-session IDs it should never match.
          recentSessions = [
            { id: saved.docId, ...saved },
            ...recentSessions.filter(s => s.id !== saved.docId)
          ].slice(0, 30);
          renderHistory(); // refresh the panel if the user navigates to it
          showToast('Workout saved');
        }
      }
    } catch (err) {
      console.error('Failed to save session:', err);
      showToast('Save failed — see console', true);
      // Still proceed with clearing local state. If the user wants to retry
      // they'd have to re-enter everything anyway; leaving the session "active"
      // risks them double-saving. Tradeoff.
    } finally {
      if (endBtn) endBtn.classList.remove('saving');
    }

    // Clear local session state
    clearInterval(session.timerInterval);
    session.active = false;
    session.docId = null;
    session.dayId = null;
    session.startTime = null;
    session.logs = {};
    document.body.classList.remove('session-active');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('session-day'));
    document.querySelectorAll('.ex-card').forEach(c => {
      c.classList.remove('done');
      const logBtn = c.querySelector('.ex-log-btn');
      if (logBtn) logBtn.classList.remove('has-logs');
    });
    showPanel('today', null);
  }

  function resumeSession() {
    if (!session.active) return;
    showPanel(session.dayId, null);
  }

  // Make the full in-progress banners clickable so tapping anywhere on the
  // bar resumes the underlying activity. Button clicks keep their own action.
  function onBannerClick(event, resumeFn) {
    if (event.target.closest('.session-banner-btn')) return;
    resumeFn();
  }

  function getDayTitle(dayId) {
    const panel = document.getElementById('panel-' + dayId);
    if (!panel) return 'Workout';
    const num = dayId.replace('day', '');
    const h2 = panel.querySelector('.panel-head h2');
    const title = h2 ? h2.textContent.trim() : 'Workout';
    return `Day ${num} — ${title}`;
  }

  // ─────────────────────────────────────────────────────────────
  // Timer
  // ─────────────────────────────────────────────────────────────
  function startTimer() {
    const update = () => {
      const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
      const h = Math.floor(elapsed / 3600);
      const m = Math.floor((elapsed % 3600) / 60);
      const s = elapsed % 60;
      const pad = n => String(n).padStart(2, '0');
      const text = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
      const el = document.getElementById('session-timer');
      if (el) el.textContent = text;
    };
    update();
    session.timerInterval = setInterval(update, 1000);
  }

  // Banner height drives the nav's sticky offset — recompute when banner appears
  function recalcBannerHeight() {
    const banner = document.getElementById('session-banner');
    if (!banner) return;
    // Read actual rendered height after display toggle
    requestAnimationFrame(() => {
      const h = banner.offsetHeight;
      document.documentElement.style.setProperty('--session-banner-height', `${h}px`);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Mark exercise done (checkbox)
  // ─────────────────────────────────────────────────────────────
  function toggleDone(btn) {
    const card = btn.closest('.ex-card');
    if (!card) return;
    card.classList.toggle('done');
    const key = exerciseKey(card);
    if (!session.logs[key]) session.logs[key] = { sets: [], done: false };
    session.logs[key].done = card.classList.contains('done');
    updateProgress();
    autoSaveSession();
  }

  // ─────────────────────────────────────────────────────────────
  // Log modal
  // ─────────────────────────────────────────────────────────────
  function openLog(btn) {
    const card = btn.closest('.ex-card');
    if (!card) return;
    const key = exerciseKey(card);
    const rx = parseRx(card);
    const target = card.querySelector('.ex-target')?.textContent?.trim() || '';

    session.currentExerciseKey = key;

    document.getElementById('modal-title-text').textContent = key;
    document.getElementById('modal-sub').textContent = `${rx.label} · ${target}`;
    document.getElementById('modal-eyebrow').textContent = rx.timed ? 'Record Session' : 'Log Sets';

    // Build set rows
    const body = document.getElementById('modal-body');
    body.innerHTML = '';
    const existing = session.logs[key]?.sets || [];
    // Pull last-session data if we have it cached from Firestore
    const lastData = findLastSetsFor(key);

    const renderSet = (setIndex, groupLabel) => {
      const row = document.createElement('div');
      row.className = 'set-row';
      row.dataset.setIndex = setIndex;

      const num = document.createElement('div');
      num.className = 'set-row-num';
      num.textContent = groupLabel ? `${groupLabel.charAt(0)}${setIndex + 1}` : `Set ${setIndex + 1}`;
      row.appendChild(num);

      const weightField = document.createElement('div');
      weightField.className = 'set-field';
      weightField.innerHTML = `
        <span class="set-field-label">${rx.timed ? 'Time / Dist' : `Weight (${prefs.units})`}</span>
        <input class="set-input" type="${rx.timed ? 'text' : 'number'}" inputmode="${rx.timed ? 'text' : 'decimal'}" step="any" data-field="weight" value="${existing[setIndex]?.weight ?? ''}" />
      `;
      row.appendChild(weightField);

      const repsField = document.createElement('div');
      repsField.className = 'set-field';
      repsField.innerHTML = `
        <span class="set-field-label">${rx.timed ? 'Duration' : 'Reps'}</span>
        <input class="set-input" type="${rx.timed ? 'text' : 'number'}" inputmode="${rx.timed ? 'text' : 'numeric'}" data-field="reps" value="${existing[setIndex]?.reps ?? ''}" />
      `;
      row.appendChild(repsField);

      // Last-time hint for this specific set — only show if we have the data
      // and this isn't the first-ever entry for this exercise
      if (lastData && lastData.sets[setIndex]) {
        const last = lastData.sets[setIndex];
        if (last && (last.weight || last.reps)) {
          const hint = document.createElement('div');
          hint.className = 'set-hint';
          const w = last.weight || '—';
          const r = last.reps || '—';
          hint.innerHTML = `Last time · <em>${w}</em> × <em>${r}</em>`;
          row.appendChild(hint);
        }
      }

      const notes = document.createElement('div');
      notes.className = 'set-notes';
      notes.innerHTML = `<textarea class="set-notes-input" data-field="notes" rows="1" placeholder="Optional note — form cue, how it felt…">${existing[setIndex]?.notes ?? ''}</textarea>`;
      row.appendChild(notes);

      return row;
    };

    if (rx.perSide) {
      // Left group
      const leftLabel = document.createElement('div');
      leftLabel.className = 'set-group-label';
      leftLabel.textContent = 'Left Side';
      body.appendChild(leftLabel);
      for (let i = 0; i < rx.count; i++) {
        body.appendChild(renderSet(i, 'L'));
      }
      // Right group (continues the index)
      const rightLabel = document.createElement('div');
      rightLabel.className = 'set-group-label';
      rightLabel.textContent = 'Right Side';
      body.appendChild(rightLabel);
      for (let i = 0; i < rx.count; i++) {
        body.appendChild(renderSet(rx.count + i, 'R'));
      }
    } else {
      for (let i = 0; i < rx.count; i++) {
        body.appendChild(renderSet(i));
      }
    }

    document.getElementById('log-modal').classList.add('open');
    // Focus first input after a tick so the modal is painted
    setTimeout(() => body.querySelector('input, textarea')?.focus(), 50);
  }

  function closeLog() {
    document.getElementById('log-modal').classList.remove('open');
    session.currentExerciseKey = null;
    // If we were editing a past session, clear the editing context and
    // restore session.logs to empty (since no live session was active).
    if (editingContext) {
      editingContext = null;
      if (!session.active) session.logs = {};
    }
  }

  function saveLog() {
    const key = session.currentExerciseKey;
    if (!key) { closeLog(); return; }
    const rows = document.querySelectorAll('#modal-body .set-row');
    const sets = [];
    rows.forEach(row => {
      const idx = parseInt(row.dataset.setIndex, 10);
      const weight = row.querySelector('[data-field="weight"]').value.trim();
      const reps = row.querySelector('[data-field="reps"]').value.trim();
      const notes = row.querySelector('[data-field="notes"]').value.trim();
      sets[idx] = { weight, reps, notes };
    });

    // If we're editing a past session, save to Firestore instead of mutating
    // the live in-memory session.
    if (editingContext) {
      saveHistoricalEdit(sets);
      return;
    }

    // Live session path (unchanged): update in-memory logs and the log button tint.
    if (!session.logs[key]) session.logs[key] = { sets: [], done: false };
    session.logs[key].sets = sets;

    const hasData = sets.some(s => s && (s.weight || s.reps || s.notes));
    const panel = document.getElementById('panel-' + session.dayId);
    if (panel) {
      panel.querySelectorAll('.ex-card').forEach(card => {
        if (exerciseKey(card) === key) {
          const btn = card.querySelector('.ex-log-btn');
          if (btn) btn.classList.toggle('has-logs', hasData);
        }
      });
    }
    autoSaveSession();
    closeLog();
  }

  // Persist edits to a past session document.
  async function saveHistoricalEdit(sets) {
    const ctx = editingContext;
    if (!ctx || !currentUser || !window.fb) {
      closeLog();
      return;
    }
    try {
      // Start from the session we loaded; modify just this exercise's sets.
      const sess = findSessionById(ctx.sessionId) || ctx.sessionDoc;
      const updatedExercises = { ...(sess.exercises || {}) };
      const existing = updatedExercises[ctx.exerciseName] || { sets: [], done: false };
      updatedExercises[ctx.exerciseName] = {
        ...existing,
        sets
      };
      const payload = {
        dayId: sess.dayId,
        dateKey: sess.dateKey,
        startTime: sess.startTime,
        endTime: sess.endTime,
        durationSeconds: sess.durationSeconds,
        exercises: updatedExercises
      };
      const path = `users/${currentUser.uid}/sessions/${ctx.sessionId}`;
      await window.fb.setDoc(path, payload);

      // Update the local cache
      const idx = recentSessions.findIndex(s => s.id === ctx.sessionId);
      if (idx !== -1) {
        recentSessions[idx] = { id: ctx.sessionId, ...payload };
      }
      renderHistory();
      reopenCard(ctx.sessionId);
      showToast('Exercise updated');
    } catch (err) {
      console.error('Failed to save edit:', err);
      showToast('Save failed — see console', true);
    } finally {
      closeLog();
    }
  }

  // Escape closes the modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('log-modal').classList.contains('open')) {
      closeLog();
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Progress bar
  // ─────────────────────────────────────────────────────────────
  function updateProgress() {
    if (!session.active || !session.dayId) return;
    const panel = document.getElementById('panel-' + session.dayId);
    if (!panel) return;
    const total = panel.querySelectorAll('.ex-card').length;
    const done = panel.querySelectorAll('.ex-card.done').length;
    const progressEl = document.getElementById('progress-' + session.dayId);
    if (!progressEl) return;
    progressEl.querySelector('.progress-done').textContent = done;
    progressEl.querySelector('.progress-total').textContent = total;
    progressEl.querySelector('.session-progress-fill').style.width =
      total > 0 ? `${(done / total) * 100}%` : '0%';
  }

  // ═════════════════════════════════════════════════════════════
  // AUTH
  // ═════════════════════════════════════════════════════════════
  // State — synced from the Firebase module script via custom events.
  let currentUser = null;

  // Triggered by the sign-in CTAs on Profile, Settings, and History panels
  // for signed-out users. Just launches the Google sign-in flow; when
  // signed-in users need account actions they visit the Profile tab.
  function handleAuthClick(event) {
    if (!window.fb) {
      alert('Firebase is still loading. Give it a second and try again.');
      return;
    }
    if (currentUser) {
      // Already signed in — no-op. Sign-out lives in the Profile panel.
      return;
    }
    window.fb.signIn().catch(err => {
      console.error('Sign in failed:', err);
      if (err.code === 'auth/popup-blocked') {
        alert('Popup was blocked. Allow popups for this site and try again.');
      } else if (err.code === 'auth/unauthorized-domain') {
        alert('This domain isn\'t authorized in Firebase. Add it in Firebase Console → Authentication → Settings → Authorized domains.');
      } else if (err.code === 'auth/popup-closed-by-user') {
        // User canceled — stay quiet.
      } else {
        alert('Sign in failed: ' + (err.message || err.code));
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Auth state UI sync
  // ─────────────────────────────────────────────────────────────
  // Kept the name for compatibility with existing callers. Originally
  // updated the desktop auth chip (now removed) plus the mobile nav avatar;
  // now just delegates to the mobile avatar renderer since that's the only
  // remaining auth-state surface that needs imperative updates.
  function renderAuthChip() {
    renderMobileNavAvatar();
  }

  // ─────────────────────────────────────────────────────────────
  // Mobile navigation
  // ─────────────────────────────────────────────────────────────

  function mobileNavTap(panelId, btn) {
    // The 'train' tab is a virtual destination — it routes to the Today
    // panel which is the Train landing. (Today/Stretch/Library/etc. are
    // all sub-pages of Train conceptually.)
    let targetPanelId = panelId;
    if (panelId === 'train') targetPanelId = 'today';

    // If already on this destination (or any panel that maps to the same
    // Train tab), scroll to top instead of re-navigating.
    if (currentPanelId === targetPanelId) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    // Special case: tapping Train while on any Train sub-page (history,
    // settings, dayN, stretch, library) — navigate back to the Train
    // landing (today) rather than no-op.
    if (panelId === 'train' && mobileActiveTab(currentPanelId) === 'train') {
      showPanel('today', null);
      return;
    }
    showPanel(targetPanelId, null);
  }

  function renderMobileNavAvatar() {
    const slot = document.getElementById('mobile-navavatar');
    const navItem = document.getElementById('mnav-profile');
    if (!slot || !navItem) return;
    if (currentUser) {
      navItem.classList.add('signed-in');
      const fullName = currentUser.displayName || currentUser.email || '';
      const initial = (fullName || '?').trim().charAt(0).toUpperCase();
      slot.innerHTML = currentUser.photoURL
        ? `<img src="${currentUser.photoURL}" alt="" referrerpolicy="no-referrer" />`
        : `<span>${initial}</span>`;
    } else {
      navItem.classList.remove('signed-in');
      slot.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4"/>
          <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/>
        </svg>`;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Legacy mobile account sheet functions (openMobileAccount, etc.) have
  // been removed — their functionality moved to the Profile tab in the
  // bottom nav. Profile is now a dedicated panel, not a modal/sheet.
  // ─────────────────────────────────────────────────────────────

  window.addEventListener('fb-auth-changed', (e) => {
    currentUser = e.detail;
    renderAuthChip();
  });

  // Render once on load — chip shows "Sign in" until the auth state resolves.
  renderAuthChip();

  // ═════════════════════════════════════════════════════════════
  // FIRESTORE SYNC
  // ═════════════════════════════════════════════════════════════
  // Cache of recent sessions loaded from Firestore. Keyed by session id
  // ("YYYY-MM-DD_dayN"), used for the "last time" hints in the log modal.
  // Populated after sign-in via loadRecentSessions().
  let recentSessions = [];

  // ═════════════════════════════════════════════════════════════
  // USER PREFERENCES
  // ═════════════════════════════════════════════════════════════
  // Single doc stored at users/{uid}/preferences/main. The default is the
  // built-in M/W/F schedule and lb units, so signed-out or first-time users
  // see exactly the original behavior.
  const DEFAULT_PREFS = {
    // Map of weekday (0=Sun, 1=Mon, ..., 6=Sat) → array of dayIds. Multiple
    // dayIds per weekday means multiple workouts that day. Empty/missing
    // weekdays are rest days. Default mirrors the original SCHEDULE.
    scheduleOverride: { 1: ['day1'], 3: ['day2'], 5: ['day3'] },
    units: 'lb'  // 'lb' | 'kg'
  };
  let prefs = JSON.parse(JSON.stringify(DEFAULT_PREFS));
  // Local working copy of the schedule that the user can edit without
  // immediately persisting. Cell taps mutate this; a "Save" / "Discard" bar
  // appears when it diverges from prefs.scheduleOverride. The Today card,
  // week strip, and resolveToday() all continue to read from prefs (saved),
  // so the live app behavior only changes once the user explicitly commits.
  let pendingScheduleOverride = JSON.parse(JSON.stringify(prefs.scheduleOverride));

  // Compare pending vs saved — true if the user has edits that haven't
  // been persisted. Stable JSON.stringify works because keys are integers
  // (weekday numbers) and arrays preserve insertion order semantics for our
  // purposes (assignment toggles append/filter, never reorder).
  function hasPendingScheduleChanges() {
    return JSON.stringify(pendingScheduleOverride) !== JSON.stringify(prefs.scheduleOverride);
  }

  // Reset pending to match saved. Called after a successful save, after
  // the user discards, and whenever prefs are reloaded from Firestore.
  function resetPendingSchedule() {
    pendingScheduleOverride = JSON.parse(JSON.stringify(prefs.scheduleOverride));
  }

  async function loadPreferences() {
    if (!currentUser || !window.fb) {
      prefs = JSON.parse(JSON.stringify(DEFAULT_PREFS));
      resetPendingSchedule();
      return;
    }
    try {
      const path = `users/${currentUser.uid}/preferences/main`;
      const data = await window.fb.getDoc(path);
      if (data) {
        // Merge with defaults so missing fields fall back to known-good values.
        prefs = {
          ...JSON.parse(JSON.stringify(DEFAULT_PREFS)),
          ...data,
          scheduleOverride: data.scheduleOverride || DEFAULT_PREFS.scheduleOverride
        };
      } else {
        prefs = JSON.parse(JSON.stringify(DEFAULT_PREFS));
      }
    } catch (err) {
      console.error('Failed to load preferences:', err);
      prefs = JSON.parse(JSON.stringify(DEFAULT_PREFS));
    }
    resetPendingSchedule();
  }

  async function savePreferences() {
    if (!currentUser || !window.fb) return false;
    try {
      const path = `users/${currentUser.uid}/preferences/main`;
      await window.fb.setDoc(path, prefs);
      return true;
    } catch (err) {
      console.error('Failed to save preferences:', err);
      showToast('Settings save failed — see console', true);
      return false;
    }
  }

  function todayKey() {
    // YYYY-MM-DD in local timezone (not UTC — want consistent with user's day)
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function showToast(message, isError) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove('show'), 2800);
  }

  // Save a completed session to Firestore. Returns a promise; caller handles
  // UI (disabling the End button etc). Silently no-ops when signed out.
  async function saveSessionToFirestore(sessionSnapshot) {
    if (!currentUser || !window.fb) return null;
    const uid = currentUser.uid;
    const dateKey = todayKey();
    const endTime = Date.now();
    // Stable doc id — start time + day. Lets us reuse the same doc if the
    // session was previously auto-saved as in-progress (and we're now
    // completing it). If there was no prior in-progress doc, this still
    // works as a unique id.
    const docId = sessionSnapshot.docId || `${dateKey}_${sessionSnapshot.dayId}_${sessionSnapshot.startTime}`;
    const path = `users/${uid}/sessions/${docId}`;
    const payload = {
      dayId: sessionSnapshot.dayId,
      dateKey,
      startTime: sessionSnapshot.startTime,
      endTime,
      durationSeconds: Math.floor((endTime - sessionSnapshot.startTime) / 1000),
      exercises: sessionSnapshot.logs,
      status: 'completed'
    };
    await window.fb.setDoc(path, payload);
    return { docId, ...payload };
  }

  // Pull the 30 most recent session documents on sign-in. Small limit because
  // we only need them for the "last time" hints in the log modal — not a full
  // history feed. If the user has been training for a while, 30 sessions is
  // ~10 weeks of data, which comfortably covers every exercise in the program.
  async function loadRecentSessions() {
    if (!currentUser || !window.fb) {
      recentSessions = [];
      return;
    }
    try {
      const uid = currentUser.uid;
      const path = `users/${uid}/sessions`;
      const all = await window.fb.listDocs(path, {
        orderBy: 'startTime',
        orderDir: 'desc',
        limit: 30
      });
      // Filter: only show completed sessions in history. Legacy docs without
      // a status field are treated as completed (they predate this feature).
      recentSessions = all.filter(s => !s.status || s.status === 'completed');
    } catch (err) {
      console.error('Failed to load session history:', err);
      recentSessions = [];
    }
  }

  // ─────────────────────────────────────────────────────────────
  // In-progress session persistence — survives page refresh
  // ─────────────────────────────────────────────────────────────
  // Loads any in-progress workout from Firestore on auth-change. If found,
  // restores the in-memory session object so the user can resume seamlessly.

  async function loadInProgressSession() {
    if (!currentUser || !window.fb) return null;
    try {
      const uid = currentUser.uid;
      const all = await window.fb.listDocs(`users/${uid}/sessions`, {
        orderBy: 'startTime',
        orderDir: 'desc',
        limit: 5  // small — there should never be more than one in-progress
      });
      return all.find(s => s.status === 'in-progress') || null;
    } catch (err) {
      console.error('Failed to load in-progress session:', err);
      return null;
    }
  }

  // Restore an in-progress session into the live `session` object + UI.
  // Mirrors what beginSession does, minus the setDoc (the doc already exists).
  function restoreInProgressSession(doc) {
    if (!doc) return;
    if (session.timerInterval) clearInterval(session.timerInterval);
    session.active = true;
    session.docId = doc.id;
    session.dayId = doc.dayId;
    session.startTime = doc.startTime;
    session.logs = doc.exercises || {};
    document.body.classList.add('session-active');

    // Set banner title
    const titleEl = document.getElementById('session-title');
    if (titleEl) titleEl.textContent = getDayTitle(doc.dayId);

    // Mark the active day panel + progress bar
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('session-day'));
    const dayPanel = document.getElementById('panel-' + doc.dayId);
    if (dayPanel) dayPanel.classList.add('session-day');
    document.querySelectorAll('.session-progress').forEach(p => p.removeAttribute('data-active-day'));
    const progressEl = document.getElementById('progress-' + doc.dayId);
    if (progressEl) progressEl.setAttribute('data-active-day', 'true');

    // Reflect set/done state on the cards
    if (dayPanel) {
      dayPanel.querySelectorAll('.ex-card').forEach(card => {
        const name = exerciseKey(card);
        const entry = session.logs[name];
        card.classList.remove('done', 'open');
        if (entry?.done) card.classList.add('done');
        const btn = card.querySelector('.ex-log-btn');
        if (btn) {
          const hasData = Array.isArray(entry?.sets) && entry.sets.some(s => s && (s.weight || s.reps || s.notes));
          btn.classList.toggle('has-logs', !!hasData);
        }
      });
    }

    updateProgress();
    startTimer();
    recalcBannerHeight();
  }

  // Auto-save the current session to Firestore as in-progress. Fired after
  // every meaningful state change (set logged, exercise marked done).
  // Silent on success; logs on failure. Uses the same docId for the entire
  // life of the session so ending it overwrites the same record.
  async function autoSaveSession() {
    if (!currentUser || !window.fb) return;
    if (!session.active || !session.docId) return;
    const uid = currentUser.uid;
    const path = `users/${uid}/sessions/${session.docId}`;
    const dateKey = (() => {
      const d = new Date(session.startTime);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    })();
    const payload = {
      dayId: session.dayId,
      dateKey,
      startTime: session.startTime,
      endTime: null,
      durationSeconds: 0,
      exercises: session.logs,
      status: 'in-progress'
    };
    try {
      await window.fb.setDoc(path, payload);
    } catch (err) {
      console.error('Failed to auto-save session:', err);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Round persistence — auto-save in-progress, list completed rounds
  // ─────────────────────────────────────────────────────────────
  // Cache of recent completed rounds, used to populate Recent Rounds on
  // the Play landing. Loaded on auth-change like sessions are.
  let recentRounds = [];

  async function loadRecentRounds() {
    if (!currentUser || !window.fb) {
      recentRounds = [];
      return;
    }
    try {
      const uid = currentUser.uid;
      const path = `users/${uid}/rounds`;
      // Load all rounds, sort by endTime desc. We'll filter in memory:
      // completed rounds for the Recent list, in-progress for resume detection.
      recentRounds = await window.fb.listDocs(path, {
        orderBy: 'startTime',
        orderDir: 'desc',
        limit: 30
      });
    } catch (err) {
      console.error('Failed to load round history:', err);
      recentRounds = [];
    }
  }

  // Find a single in-progress round, if one exists. Used for resume detection
  // on app load so the user can pick up where they left off.
  function findInProgressRound() {
    return recentRounds.find(r => r.status === 'in-progress') || null;
  }

  // Generate a Firestore document id for a new round. Format mirrors sessions:
  // YYYY-MM-DD_courseId_startMs. Stable, sortable, descriptive.
  function newRoundId(courseId, startMs) {
    const d = new Date(startMs);
    const pad = (n) => String(n).padStart(2, '0');
    const dateKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return `${dateKey}_${courseId}_${startMs}`;
  }

  // Auto-save the current round to Firestore. Called after each hole entry.
  // Silent — no toast on success since this fires often; only logs on error.
  async function autoSaveRound() {
    if (!currentUser || !window.fb) return;
    if (!roundState.courseId || !roundState.docId) return;
    const course = getCourse(roundState.courseId);
    if (!course) return;
    const totals = computeRoundTotals();
    const payload = {
      courseId: roundState.courseId,
      courseName: course.name,
      teeName: roundState.teeName,
      startTime: roundState.started,
      endTime: null,
      dateKey: roundState.dateKey,
      status: 'in-progress',
      currentHoleIndex: roundState.holeIndex,
      scores: roundState.scores,
      totals
    };
    try {
      const path = `users/${currentUser.uid}/rounds/${roundState.docId}`;
      await window.fb.setDoc(path, payload);
      // Update the local cache so resume detection sees the latest state
      const existing = recentRounds.findIndex(r => r.id === roundState.docId);
      const cached = { id: roundState.docId, ...payload };
      if (existing >= 0) recentRounds[existing] = cached;
      else recentRounds.unshift(cached);
      // Keep the global banner in sync with the latest progress
      updateRoundBanner();
    } catch (err) {
      console.error('Failed to auto-save round:', err);
    }
  }

  // Compute running totals for the round — strokes, putts, holes played, vs par.
  function computeRoundTotals() {
    const course = getCourse(roundState.courseId);
    if (!course) return { strokes: 0, putts: 0, holesPlayed: 0, vsPar: 0 };
    const playedHoles = Object.keys(roundState.scores).map(Number);
    let strokes = 0, putts = 0, parTotal = 0;
    for (const hn of playedHoles) {
      const e = roundState.scores[hn];
      if (!e) continue;
      strokes += e.strokes || 0;
      putts += e.putts || 0;
      const hd = course.holes.find(h => h.number === hn);
      if (hd) parTotal += hd.par;
    }
    return {
      strokes,
      putts,
      holesPlayed: playedHoles.length,
      vsPar: strokes - parTotal
    };
  }

  // Find the most recent logged set data for a given exercise name, searching
  // the cached recent sessions. Returns null if never seen. Used to populate
  // the "last time: 185 × 8" hints in the log modal.
  function findLastSetsFor(exerciseName) {
    if (!recentSessions || recentSessions.length === 0) return null;
    for (const session of recentSessions) {
      const ex = session.exercises?.[exerciseName];
      if (ex && Array.isArray(ex.sets) && ex.sets.some(s => s && (s.weight || s.reps))) {
        return { sets: ex.sets, dateKey: session.dateKey };
      }
    }
    return null;
  }

  // When sign-in completes, load preferences AND recent history into cache.
  window.addEventListener('fb-auth-changed', async (e) => {
    if (e.detail) {
      // Signed in — load their data in parallel for snappier startup.
      // loadInProgressSession runs alongside so if a workout was left
      // running (browser closed, refresh mid-session) we restore it.
      const [, , , inProgressSession] = await Promise.all([
        loadPreferences(),
        loadRecentSessions(),
        loadRecentRounds(),
        loadInProgressSession()
      ]);
      if (inProgressSession) {
        restoreInProgressSession(inProgressSession);
      }
    } else {
      // Signed out — clear caches and revert to default prefs
      recentSessions = [];
      recentRounds = [];
      prefs = JSON.parse(JSON.stringify(DEFAULT_PREFS));
    }
    // Re-render any panels affected by these changes
    renderHistory();
    renderPreferencePanels();
    renderTodayCard();
    renderWeekStrip();
    renderPlayLanding();
  });

  // ─────────────────────────────────────────────────────────────
  // Render the History panel
  // ─────────────────────────────────────────────────────────────
  // Called when the panel is shown and whenever recentSessions changes.
  // Produces three possible states:
  //   1. Signed out → prompt to sign in
  //   2. Signed in but no sessions yet → empty state
  //   3. Signed in with sessions → list of accordion cards
  function renderHistory() {
    const mount = document.getElementById('history-mount');
    if (!mount) return;

    if (!currentUser) {
      mount.innerHTML = `
        <div class="history-empty">
          <div class="history-empty-title">Sign in to see your history</div>
          <div class="history-empty-sub">Your completed workouts sync across devices once you sign in. Nothing to see here until then.</div>
          <button class="btn-cta" onclick="handleAuthClick(event)">Sign in with Google</button>
        </div>`;
      return;
    }

    if (!recentSessions || recentSessions.length === 0) {
      mount.innerHTML = `
        <div class="history-empty">
          <div class="history-empty-title">No completed sessions yet</div>
          <div class="history-empty-sub">Finish a workout and it'll show up here automatically.</div>
          <button class="btn-cta" onclick="showPanel('today', null)">Go to Today</button>
        </div>`;
      return;
    }

    // Render a card per session, most recent first. recentSessions is already
    // sorted desc by endTime from loadRecentSessions().
    const cards = recentSessions.map(session => renderHistoryCard(session)).join('');
    mount.innerHTML = `<div class="history-list">${cards}</div>`;
  }

  // ─────────────────────────────────────────────────────────────
  // Render the Settings panel
  // ─────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────
  // Render the Profile panel
  // ─────────────────────────────────────────────────────────────
  // Profile is what the avatar/account-menu used to be — but as a full
  // panel rather than a dropdown/sheet. For now its content is identical
  // to Settings (account info + schedule + units + appearance). Once the
  // restructure progresses, Settings panel goes away entirely and Profile
  // becomes the canonical home for these.
  function renderProfile() {
    const mount = document.getElementById('profile-mount');
    if (!mount) return;

    if (!currentUser) {
      mount.innerHTML = `
        <div class="settings-signin-cta">
          <div class="settings-signin-cta-title">Sign in to view your profile</div>
          <div class="settings-signin-cta-sub">Your account, training schedule, and preferences sync across devices once you're signed in.</div>
          <button class="btn-cta" onclick="handleAuthClick(event)">Sign in with Google</button>
        </div>`;
      return;
    }

    mount.innerHTML = `
      ${renderAccountSection()}
      ${renderScheduleSection()}
      ${renderUnitsSection()}
      ${renderAppearanceSection()}
    `;
  }

  // ─────────────────────────────────────────────────────────────
  // Courses (list view + detail view)
  // ─────────────────────────────────────────────────────────────
  // Tracks which tee box is selected on the course detail screen.
  // Keyed by course id so each course remembers its last-viewed tee
  // independently. Defaults to the first tee in the course's tees[] array.
  const courseDetailState = { selectedTeeByCourse: {} };

  // Update the count shown on the Play landing's "Browse Courses" link.
  function updatePlayCoursesCount() {
    const el = document.getElementById('play-courses-count');
    if (!el) return;
    const n = COURSES.length;
    el.textContent = n === 1 ? '1 course available' : `${n} courses available`;
  }

  function renderCoursesList() {
    const mount = document.getElementById('courses-list-mount');
    if (!mount) return;
    if (COURSES.length === 0) {
      mount.innerHTML = `
        <div class="play-empty">
          <div class="play-empty-title">No courses yet</div>
          <div class="play-empty-sub">Courses will be added soon.</div>
        </div>`;
      return;
    }
    const cards = COURSES.map(c => {
      const totalPar = c.holes.reduce((sum, h) => sum + h.par, 0);
      const teeCount = c.tees.length;
      return `
        <button class="course-card" onclick="openCourseDetail('${c.id}')">
          <div class="course-card-head">
            <div class="course-card-name">${escapeHtml(c.name)}</div>
            <div class="course-card-arrow" aria-hidden="true">→</div>
          </div>
          <div class="course-card-meta">${escapeHtml(c.location)}</div>
          <div class="course-card-stats">
            <span><strong>${c.holes.length}</strong> Holes</span>
            <span><strong>Par ${totalPar}</strong></span>
            <span><strong>${teeCount}</strong> Tee${teeCount === 1 ? '' : 's'}</span>
          </div>
        </button>`;
    }).join('');
    mount.innerHTML = `<div class="course-list">${cards}</div>`;
  }

  function openCourseDetail(courseId) {
    courseDetailState.activeCourseId = courseId;
    showPanel('course-detail', null);
  }

  function renderCourseDetail() {
    const mount = document.getElementById('course-detail-mount');
    if (!mount) return;
    const courseId = courseDetailState.activeCourseId;
    const course = courseId ? getCourse(courseId) : null;
    if (!course) {
      mount.innerHTML = `
        <div class="panel-head">
          <span class="accent-line"></span>
          <h2>Course not found</h2>
          <p class="panel-desc">Pick a course from the list.</p>
        </div>`;
      return;
    }
    // Default selected tee for this course = first tee unless user picked one
    if (!courseDetailState.selectedTeeByCourse[courseId]) {
      courseDetailState.selectedTeeByCourse[courseId] = course.tees[0].name;
    }
    const selectedTeeName = courseDetailState.selectedTeeByCourse[courseId];
    const tee = course.tees.find(t => t.name === selectedTeeName) || course.tees[0];

    const totalPar = course.holes.reduce((sum, h) => sum + h.par, 0);
    const frontPar = course.holes.slice(0, 9).reduce((s, h) => s + h.par, 0);
    const backPar  = course.holes.slice(9).reduce((s, h) => s + h.par, 0);
    const frontYards = tee.yardages.slice(0, 9).reduce((s, y) => s + y, 0);
    const backYards  = tee.yardages.slice(9).reduce((s, y) => s + y, 0);

    // Tee box selector — color-coded segmented control
    const teeButtons = course.tees.map(t => {
      const active = t.name === selectedTeeName;
      // Choose a contrasting text color for the swatch (light tees get dark text)
      const lightTee = ['White', 'Gold', 'Yellow', 'Red'].includes(t.name);
      return `
        <button class="tee-btn${active ? ' active' : ''}" onclick="selectTee('${course.id}', '${t.name}')">
          <span class="tee-btn-swatch" style="background:${t.color};border-color:${t.color}"></span>
          <span class="tee-btn-name">${escapeHtml(t.name)}</span>
          <span class="tee-btn-yards">${t.totalYards.toLocaleString()} yd</span>
        </button>`;
    }).join('');

    // Hole-by-hole rows. We render front 9 and back 9 as separate sub-tables
    // so subtotals can sit between them naturally.
    const holeRow = (h) => `
      <tr>
        <td class="hole-num">${h.number}</td>
        <td class="hole-yards">${tee.yardages[h.number - 1].toLocaleString()}</td>
        <td class="hole-par">${h.par}</td>
        <td class="hole-hcp">${h.handicap}</td>
      </tr>`;
    const frontRows = course.holes.slice(0, 9).map(holeRow).join('');
    const backRows  = course.holes.slice(9).map(holeRow).join('');

    mount.innerHTML = `
      <div class="course-detail-head">
        <div class="course-detail-eyebrow">Course Catalog</div>
        <h2 class="course-detail-title">${escapeHtml(course.name)}</h2>
        <p class="course-detail-meta">${escapeHtml(course.location)}</p>
      </div>

      <div class="course-detail-section-label">Tee Box</div>
      <div class="tee-selector">${teeButtons}</div>
      <div class="tee-info">
        <div class="tee-info-stat"><span class="tee-info-value">${tee.totalYards.toLocaleString()}</span><span class="tee-info-label">Yards</span></div>
        <div class="tee-info-stat"><span class="tee-info-value">${tee.rating ?? '—'}</span><span class="tee-info-label">Rating</span></div>
        <div class="tee-info-stat"><span class="tee-info-value">${tee.slope ?? '—'}</span><span class="tee-info-label">Slope</span></div>
        <div class="tee-info-stat"><span class="tee-info-value">${totalPar}</span><span class="tee-info-label">Par</span></div>
      </div>

      <div class="course-detail-section-label">Hole by Hole</div>
      <div class="scorecard">
        <div class="scorecard-side">
          <div class="scorecard-side-label">Front 9</div>
          <table class="scorecard-table">
            <thead>
              <tr><th>Hole</th><th>Yards</th><th>Par</th><th>HCP</th></tr>
            </thead>
            <tbody>${frontRows}</tbody>
            <tfoot>
              <tr><td>Out</td><td>${frontYards.toLocaleString()}</td><td>${frontPar}</td><td></td></tr>
            </tfoot>
          </table>
        </div>
        <div class="scorecard-side">
          <div class="scorecard-side-label">Back 9</div>
          <table class="scorecard-table">
            <thead>
              <tr><th>Hole</th><th>Yards</th><th>Par</th><th>HCP</th></tr>
            </thead>
            <tbody>${backRows}</tbody>
            <tfoot>
              <tr><td>In</td><td>${backYards.toLocaleString()}</td><td>${backPar}</td><td></td></tr>
            </tfoot>
          </table>
        </div>
      </div>
      <div class="scorecard-total">
        <span>Total</span>
        <span>${tee.totalYards.toLocaleString()} yd · Par ${totalPar}</span>
      </div>

      <div class="course-detail-actions">
        <button class="course-detail-cta" onclick="startRoundFromCourse('${course.id}', '${tee.name}')">Start a Round Here →</button>
      </div>
    `;
  }

  function selectTee(courseId, teeName) {
    courseDetailState.selectedTeeByCourse[courseId] = teeName;
    renderCourseDetail();
  }

  // ─────────────────────────────────────────────────────────────
  // Round entry (single-hole sketch — Phase 2 stub)
  // ─────────────────────────────────────────────────────────────
  // For now this is a UI mockup showing one hole's entry experience.
  // No persistence, no hole-to-hole navigation. Validates the design
  // before we wire it up properly.
  // Round state — what's currently in progress (or null fields if no round active).
  // docId is the Firestore doc id once persistence kicks in. dateKey is YYYY-MM-DD
  // in local time, for sorting and display. scores is { holeNumber: {strokes,putts} }.
  const roundState = {
    docId: null,
    courseId: null,
    teeName: null,
    holeIndex: 0,           // 0-based for arrays; display as +1
    scores: {},             // { holeNumber: { strokes, putts } }
    started: null,
    dateKey: null
  };

  function isRoundActive() {
    return !!(roundState.courseId && roundState.docId);
  }

  // Begin a new round from Course Detail's "Start a Round Here" button.
  // Creates a new Firestore doc immediately so resume detection works
  // even if the user navigates away before logging hole 1.
  async function startRoundFromCourse(courseId, teeName) {
    const course = getCourse(courseId);
    if (!course) return;
    // Block starting a second round if one's already in progress
    if (isRoundActive()) {
      const cont = confirm('You have a round in progress. Discard it and start a new one?');
      if (!cont) {
        showPanel('round', null);
        return;
      }
      await abandonCurrentRound();
    }
    const startMs = Date.now();
    const d = new Date(startMs);
    const pad = (n) => String(n).padStart(2, '0');
    roundState.dateKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    roundState.docId = newRoundId(courseId, startMs);
    roundState.courseId = courseId;
    roundState.teeName = teeName;
    roundState.holeIndex = 0;
    roundState.scores = {};
    roundState.started = startMs;
    // Initial save so an in-progress doc exists for resume detection
    await autoSaveRound();
    showPanel('round', null);
  }

  // Resume an in-progress round (called from the resume prompt or auto-detect).
  function resumeRound(roundDoc) {
    if (!roundDoc) return;
    roundState.docId = roundDoc.id;
    roundState.courseId = roundDoc.courseId;
    roundState.teeName = roundDoc.teeName;
    roundState.holeIndex = roundDoc.currentHoleIndex || 0;
    roundState.scores = roundDoc.scores || {};
    roundState.started = roundDoc.startTime;
    roundState.dateKey = roundDoc.dateKey;
    showPanel('round', null);
  }

  function currentRoundSnapshot() {
    if (!isRoundActive()) return null;
    return {
      id: roundState.docId,
      courseId: roundState.courseId,
      teeName: roundState.teeName,
      currentHoleIndex: roundState.holeIndex || 0,
      scores: roundState.scores || {},
      startTime: roundState.started,
      dateKey: roundState.dateKey
    };
  }

  // Reset roundState in memory (does not delete from Firestore).
  function clearRoundState() {
    roundState.docId = null;
    roundState.courseId = null;
    roundState.teeName = null;
    roundState.holeIndex = 0;
    roundState.scores = {};
    roundState.started = null;
    roundState.dateKey = null;
  }

  // Discard the current round entirely — delete from Firestore + clear local state.
  async function abandonCurrentRound() {
    if (!isRoundActive()) return;
    const docId = roundState.docId;
    clearRoundState();
    if (currentUser && window.fb) {
      try {
        await window.fb.deleteDoc(`users/${currentUser.uid}/rounds/${docId}`);
        recentRounds = recentRounds.filter(r => r.id !== docId);
      } catch (err) {
        console.error('Failed to delete abandoned round:', err);
      }
    }
    updateRoundBanner();
    renderPlayLanding();
  }

  // Finish the current round — flip status to completed, write final totals.
  async function completeCurrentRound() {
    if (!isRoundActive()) return false;
    const course = getCourse(roundState.courseId);
    if (!course) return false;
    const totals = computeRoundTotals();
    const endMs = Date.now();
    const payload = {
      courseId: roundState.courseId,
      courseName: course.name,
      teeName: roundState.teeName,
      startTime: roundState.started,
      endTime: endMs,
      dateKey: roundState.dateKey,
      status: 'completed',
      currentHoleIndex: roundState.holeIndex,
      scores: roundState.scores,
      totals
    };
    if (currentUser && window.fb) {
      try {
        const path = `users/${currentUser.uid}/rounds/${roundState.docId}`;
        await window.fb.setDoc(path, payload);
        // Update cache
        const idx = recentRounds.findIndex(r => r.id === roundState.docId);
        const cached = { id: roundState.docId, ...payload };
        if (idx >= 0) recentRounds[idx] = cached;
        else recentRounds.unshift(cached);
      } catch (err) {
        console.error('Failed to complete round:', err);
        showToast('Save failed — see console', true);
        return false;
      }
    }
    updateRoundBanner();
    return true;
  }

  function renderRound() {
    const mount = document.getElementById('round-mount');
    if (!mount) return;

    const course = getCourse(roundState.courseId);
    if (!course) {
      mount.innerHTML = `
        <div class="panel-head">
          <span class="accent-line"></span>
          <h2>No round in progress</h2>
          <p class="panel-desc">Pick a course from Play to start a round.</p>
        </div>
        <button class="course-detail-cta" onclick="showPanel('play', null)">Go to Play →</button>`;
      return;
    }
    const tee = course.tees.find(t => t.name === roundState.teeName) || course.tees[0];
    const hole = course.holes[roundState.holeIndex];
    const holeNum = hole.number;
    const yards = tee.yardages[roundState.holeIndex];

    // Read the user's current entry for this hole, defaulting strokes=par, putts=2
    const entry = roundState.scores[holeNum] || { strokes: hole.par, putts: 2 };
    const strokes = entry.strokes;
    const putts = entry.putts;

    // Score-vs-par classification for the strokes card color
    const diff = strokes - hole.par;
    let scoreClass = 'par';
    let scoreLabel = 'Par';
    if (diff <= -2)      { scoreClass = 'eagle';   scoreLabel = diff === -2 ? 'Eagle' : 'Albatross'; }
    else if (diff === -1){ scoreClass = 'birdie';  scoreLabel = 'Birdie'; }
    else if (diff === 0) { scoreClass = 'par';     scoreLabel = 'Par'; }
    else if (diff === 1) { scoreClass = 'bogey';   scoreLabel = 'Bogey'; }
    else if (diff === 2) { scoreClass = 'doublebogey'; scoreLabel = 'Double'; }
    else                 { scoreClass = 'over';    scoreLabel = `+${diff}`; }

    // Running totals through the holes the user has entered so far
    const playedHoles = Object.keys(roundState.scores).map(Number).sort((a,b) => a-b);
    const totalStrokes = playedHoles.reduce((s, h) => s + roundState.scores[h].strokes, 0);
    const totalPar = playedHoles.reduce((s, h) => {
      const hd = course.holes.find(x => x.number === h);
      return s + (hd ? hd.par : 0);
    }, 0);
    const vsPar = totalStrokes - totalPar;
    const vsParStr = vsPar === 0 ? 'E' : (vsPar > 0 ? `+${vsPar}` : `${vsPar}`);
    const throughCount = playedHoles.length;

    mount.innerHTML = `
      <!-- Status strip — always-visible context -->
      <div class="round-status">
        <div class="round-status-side">
          <div class="round-status-eyebrow">${escapeHtml(course.name)} · ${escapeHtml(tee.name)}</div>
          <div class="round-status-meta">Hole ${holeNum} of ${course.holes.length}</div>
        </div>
        <div class="round-status-side round-status-right">
          <div class="round-status-eyebrow">Through ${throughCount}</div>
          <div class="round-status-score">${totalStrokes} <span>(${vsParStr})</span></div>
        </div>
      </div>

      <!-- Hole header -->
      <div class="round-hole-head">
        <div class="round-hole-num">Hole ${holeNum}</div>
        <div class="round-hole-meta">
          <span><strong>Par ${hole.par}</strong></span>
          <span>${yards.toLocaleString()} yards</span>
          <span>HCP ${hole.handicap}</span>
        </div>
      </div>

      <!-- Strokes stepper — primary action, biggest visual element -->
      <div class="round-section-label">Strokes</div>
      <div class="round-stepper round-stepper-primary score-${scoreClass}">
        <button class="round-stepper-btn" onclick="adjustStrokes(-1)" aria-label="Decrease strokes">−</button>
        <div class="round-stepper-display">
          <div class="round-stepper-value">${strokes}</div>
          <div class="round-stepper-tag">${scoreLabel}</div>
        </div>
        <button class="round-stepper-btn" onclick="adjustStrokes(1)" aria-label="Increase strokes">+</button>
      </div>

      <!-- Putts stepper — secondary, smaller -->
      <div class="round-section-label">Putts</div>
      <div class="round-stepper round-stepper-secondary">
        <button class="round-stepper-btn" onclick="adjustPutts(-1)" aria-label="Decrease putts">−</button>
        <div class="round-stepper-display">
          <div class="round-stepper-value">${putts}</div>
        </div>
        <button class="round-stepper-btn" onclick="adjustPutts(1)" aria-label="Increase putts">+</button>
      </div>

      <!-- Action footer -->
      <div class="round-actions">
        <button class="round-btn round-btn-primary" onclick="saveAndNext()">
          ${roundState.holeIndex < course.holes.length - 1 ? 'Save & Next →' : 'Save & Finish →'}
        </button>
        <div class="round-actions-secondary">
          <button class="round-btn-link" onclick="goPreviousHole()" ${roundState.holeIndex === 0 ? 'disabled' : ''}>← Previous Hole</button>
          <button class="round-btn-link round-btn-end" onclick="endRoundEarly()">End Round Early</button>
        </div>
      </div>
    `;
  }

  // Stepper actions — clamp to sensible ranges (1-15 strokes, 0-10 putts).
  // Putts can't exceed strokes (you can't 3-putt a hole-in-one).
  function adjustStrokes(delta) {
    const course = getCourse(roundState.courseId);
    if (!course) return;
    const hole = course.holes[roundState.holeIndex];
    const entry = roundState.scores[hole.number] || { strokes: hole.par, putts: 2 };
    let next = entry.strokes + delta;
    if (next < 1) next = 1;
    if (next > 15) next = 15;
    entry.strokes = next;
    if (entry.putts > entry.strokes) entry.putts = entry.strokes;
    roundState.scores[hole.number] = entry;
    renderRound();
  }
  function adjustPutts(delta) {
    const course = getCourse(roundState.courseId);
    if (!course) return;
    const hole = course.holes[roundState.holeIndex];
    const entry = roundState.scores[hole.number] || { strokes: hole.par, putts: 2 };
    let next = entry.putts + delta;
    if (next < 0) next = 0;
    if (next > entry.strokes) next = entry.strokes;
    if (next > 10) next = 10;
    entry.putts = next;
    roundState.scores[hole.number] = entry;
    renderRound();
  }

  // Save the current hole + advance, OR finish the round on hole 18.
  // Auto-saves to Firestore after each hole so the round is resumable.
  async function saveAndNext() {
    const course = getCourse(roundState.courseId);
    if (!course) return;
    const hole = course.holes[roundState.holeIndex];
    // Default the entry to par/2 if user didn't touch the steppers
    if (!roundState.scores[hole.number]) {
      roundState.scores[hole.number] = { strokes: hole.par, putts: 2 };
    }

    if (roundState.holeIndex < course.holes.length - 1) {
      // Advance to next hole, persist the in-progress state silently
      roundState.holeIndex += 1;
      renderRound();
      autoSaveRound(); // fire-and-forget; render doesn't wait on network
    } else {
      // Final hole — flip to completed, navigate to summary
      const ok = await completeCurrentRound();
      if (!ok) return;
      const finishedRoundId = roundState.docId;
      clearRoundState();
      renderPlayLanding();
      // Navigate to the summary, passing the just-completed round id
      openRoundSummary(finishedRoundId);
    }
  }
  function goPreviousHole() {
    if (roundState.holeIndex > 0) {
      roundState.holeIndex -= 1;
      renderRound();
    }
  }
  // End the round early — flip to completed if any holes were played,
  // or delete entirely if zero holes had scores entered.
  async function endRoundEarly() {
    const activeRound = currentRoundSnapshot();
    if (!activeRound) return;
    const playedCount = Object.keys(activeRound.scores || {}).length;
    if (playedCount === 0) {
      if (!confirm('End this round? No scores have been entered, so nothing will be saved.')) return;
      await abandonCurrentRound();
      showPanel('play', null);
      return;
    }
    const msg = `End this round after ${playedCount} hole${playedCount === 1 ? '' : 's'}? It will be saved to your history.`;
    if (!confirm(msg)) return;
    const ok = await completeCurrentRound();
    if (!ok) return;
    const finishedRoundId = roundState.docId;
    clearRoundState();
    renderPlayLanding();
    openRoundSummary(finishedRoundId);
  }

  // Round summary navigation. We track which round to show via state, similar
  // to the courseDetail pattern, since the panel itself is data-driven.
  const roundSummaryState = { roundId: null };
  function openRoundSummary(roundId) {
    roundSummaryState.roundId = roundId;
    showPanel('round-summary', null);
  }

  // ─────────────────────────────────────────────────────────────
  // Play landing — dynamic content (resume banner, stats, recent rounds)
  // ─────────────────────────────────────────────────────────────
  function renderPlayHeroCard() {
    const titleEl = document.getElementById('play-hero-title');
    const subEl = document.getElementById('play-hero-sub');
    const primaryBtn = document.getElementById('play-hero-primary-btn');
    if (!titleEl || !subEl || !primaryBtn) return;

    const inProgress = findInProgressRound();
    if (!inProgress) {
      titleEl.innerHTML = 'Start a <em>Round</em>';
      subEl.textContent = `Track your scores and putts hole by hole. Save the round to your history when you're done.`;
      primaryBtn.textContent = 'Start a Round →';
      primaryBtn.onclick = () => showPanel('courses', null);
      return;
    }

    const course = getCourse(inProgress.courseId);
    const courseName = course ? course.name : (inProgress.courseName || 'Round');
    const teeName = inProgress.teeName ? ` · ${inProgress.teeName}` : '';
    const holesPlayed = (inProgress.totals && inProgress.totals.holesPlayed) || 0;
    const totalHoles = course ? course.holes.length : 18;

    titleEl.innerHTML = 'Continue <em>Round</em>';
    subEl.textContent = `${courseName}${teeName} · ${holesPlayed}/${totalHoles} holes played`;
    primaryBtn.textContent = 'Continue Round →';
    primaryBtn.onclick = () => resumeActiveRound();
  }

  function renderPlayLanding() {
    renderPlayHeroCard();
    renderResumeBanner();
    renderPlayStats();
    renderRecentRounds();
  }

  // Round banner — global top bar mirroring the workout session banner.
  // Toggled via body.round-active. Visible from any panel, not just Play.
  // Also clears the (now-deleted) in-Play resume mount in case any older
  // markup remains so we don't double up.
  function renderResumeBanner() {
    const mount = document.getElementById('play-resume-mount');
    if (mount) mount.innerHTML = '';
    updateRoundBanner();
  }

  // Show or hide the global round banner based on whether an in-progress
  // round exists. Reads from recentRounds (Firestore-backed cache) so it
  // works on cold load + after auth + after every save.
  function updateRoundBanner() {
    const banner = document.getElementById('round-banner');
    const titleEl = document.getElementById('round-banner-title');
    const progressEl = document.getElementById('round-banner-progress');
    if (!banner || !titleEl || !progressEl) return;

    const inProgress = findInProgressRound();
    if (!inProgress) {
      document.body.classList.remove('round-active');
      return;
    }
    const course = getCourse(inProgress.courseId);
    const courseName = course ? course.name : (inProgress.courseName || 'Round');
    const teeName = inProgress.teeName || '';
    const holesPlayed = (inProgress.totals && inProgress.totals.holesPlayed) || 0;
    const totalHoles = course ? course.holes.length : 18;
    titleEl.textContent = teeName ? `${courseName} · ${teeName}` : courseName;
    progressEl.textContent = `${holesPlayed}/${totalHoles}`;
    document.body.classList.add('round-active');
  }

  // Resume the active in-progress round from the banner button.
  function resumeActiveRound() {
    const inProgress = findInProgressRound();
    if (!inProgress) {
      showToast('No round to resume', true);
      document.body.classList.remove('round-active');
      return;
    }
    resumeRound(inProgress);
  }

  // Wire full-banner click behavior for workout + round banners.
  const workoutBanner = document.getElementById('session-banner');
  if (workoutBanner) {
    workoutBanner.addEventListener('click', (event) => onBannerClick(event, resumeSession));
  }
  const roundBanner = document.getElementById('round-banner');
  if (roundBanner) {
    roundBanner.addEventListener('click', (event) => onBannerClick(event, resumeActiveRound));
  }

  // End the active round from the banner button with the same confirmation
  // flow used in the round screen's "End Round Early" action.
  async function endActiveRoundFromBanner() {
    const inProgress = findInProgressRound();
    if (!inProgress) {
      document.body.classList.remove('round-active');
      return;
    }
    // If we're already in the live round, prefer in-memory state so any
    // unsaved hole edits in this view are included in the confirmation count.
    const activeRound = currentRoundSnapshot();
    if (activeRound && activeRound.id === inProgress.id) {
      await endRoundEarly();
      return;
    }

    // Not currently on the round view: hydrate state from cached doc so the
    // standard end flow can run without first navigating to the round screen.
    roundState.docId = inProgress.id;
    roundState.courseId = inProgress.courseId;
    roundState.teeName = inProgress.teeName;
    roundState.holeIndex = inProgress.currentHoleIndex || 0;
    roundState.scores = inProgress.scores || {};
    roundState.started = inProgress.startTime;
    roundState.dateKey = inProgress.dateKey;
    await endRoundEarly();
  }

  // Resume by id — used elsewhere (e.g. older deep-link callers).
  function resumeRoundById(roundId) {
    const round = recentRounds.find(r => r.id === roundId);
    if (!round) {
      showToast('Round not found', true);
      return;
    }
    resumeRound(round);
  }

  // Discard an in-progress round (kept for compatibility with any older
  // callers; the canonical "end" path now goes through endActiveRoundFromBanner
  // → round screen → End Round Early).
  async function discardInProgressRound(roundId) {
    if (!confirm('Discard this in-progress round? It will be deleted permanently.')) return;
    if (currentUser && window.fb) {
      try {
        await window.fb.deleteDoc(`users/${currentUser.uid}/rounds/${roundId}`);
        recentRounds = recentRounds.filter(r => r.id !== roundId);
      } catch (err) {
        console.error('Failed to delete round:', err);
        showToast('Delete failed — see console', true);
        return;
      }
    }
    if (roundState.docId === roundId) clearRoundState();
    renderPlayLanding();
  }

  // Stats strip: renders 4 cards based on completed rounds.
  // Em-dash for empty; real numbers once data exists.
  function renderPlayStats() {
    const mount = document.getElementById('play-stats-mount');
    if (!mount) return;
    const completed = recentRounds.filter(r => r.status === 'completed');
    const roundsPlayed = completed.length;

    let avgScore = '—';
    let bestRound = '—';
    if (roundsPlayed > 0) {
      // Only count full 18s for "best round" so a 9-hole "ended early" round
      // doesn't beat your best 18 with strokes alone.
      const fullRounds = completed.filter(r => (r.totals?.holesPlayed || 0) >= 18);
      if (fullRounds.length > 0) {
        const totalStrokes = fullRounds.reduce((s, r) => s + (r.totals?.strokes || 0), 0);
        avgScore = Math.round(totalStrokes / fullRounds.length);
        const best = fullRounds.reduce((b, r) => {
          const s = r.totals?.strokes || Infinity;
          return s < b ? s : b;
        }, Infinity);
        if (best !== Infinity) bestRound = best;
      }
    }

    mount.innerHTML = `
      <div class="play-stats">
        <div class="play-stat">
          <span class="play-stat-value">—</span>
          <span class="play-stat-label">Handicap</span>
        </div>
        <div class="play-stat">
          <span class="play-stat-value">${avgScore}</span>
          <span class="play-stat-label">Avg Score</span>
        </div>
        <div class="play-stat">
          <span class="play-stat-value">${roundsPlayed}</span>
          <span class="play-stat-label">Rounds Played</span>
        </div>
        <div class="play-stat">
          <span class="play-stat-value">${bestRound}</span>
          <span class="play-stat-label">Best Round</span>
        </div>
      </div>`;
  }

  // Recent rounds: empty state if no completed rounds, otherwise a list of
  // up to 3 cards (most recent first) with a "View all" footer.
  function renderRecentRounds() {
    const mount = document.getElementById('play-rounds-mount');
    if (!mount) return;
    const completed = recentRounds.filter(r => r.status === 'completed');
    if (completed.length === 0) {
      mount.innerHTML = `
        <div class="play-empty">
          <div class="play-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 21V3"/>
              <path d="M5 4l11 2-3 4 3 4-11 2"/>
            </svg>
          </div>
          <div class="play-empty-title">No rounds yet</div>
          <div class="play-empty-sub">Your rounds will appear here once you start tracking. Tap "Start a Round" above to begin.</div>
        </div>`;
      return;
    }
    const sorted = completed.slice().sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
    const top = sorted.slice(0, 3);
    const cards = top.map(r => {
      const dateStr = formatRoundDate(r.startTime);
      const score = r.totals?.strokes ?? '—';
      const vsPar = r.totals?.vsPar;
      const vsParStr = vsPar === undefined || vsPar === null ? '' :
        (vsPar === 0 ? 'E' : (vsPar > 0 ? `+${vsPar}` : `${vsPar}`));
      const partial = (r.totals?.holesPlayed || 0) < 18 ? ` · ${r.totals.holesPlayed} holes` : '';
      return `
        <button class="round-card" onclick="openRoundSummary('${r.id}')">
          <div class="round-card-head">
            <div class="round-card-course">${escapeHtml(r.courseName || 'Round')}</div>
            <div class="round-card-arrow">→</div>
          </div>
          <div class="round-card-meta">${escapeHtml(dateStr)} · ${escapeHtml(r.teeName || '')}${partial}</div>
          <div class="round-card-score-row">
            <div class="round-card-score">${score}</div>
            ${vsParStr ? `<div class="round-card-vspar">${vsParStr}</div>` : ''}
          </div>
        </button>`;
    }).join('');
    mount.innerHTML = `<div class="round-list">${cards}</div>`;
  }

  // Friendly date formatting for round cards: "Wed · April 17"
  function formatRoundDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${days[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()}`;
  }

  // ─────────────────────────────────────────────────────────────
  // Round summary panel
  // ─────────────────────────────────────────────────────────────
  function renderRoundSummary() {
    const mount = document.getElementById('round-summary-mount');
    if (!mount) return;
    const roundId = roundSummaryState.roundId;
    const round = roundId ? recentRounds.find(r => r.id === roundId) : null;
    if (!round) {
      mount.innerHTML = `
        <div class="panel-head">
          <span class="accent-line"></span>
          <h2>Round not found</h2>
          <p class="panel-desc">It may have been deleted or not yet loaded.</p>
        </div>
        <button class="course-detail-cta" onclick="showPanel('play', null)">Back to Play →</button>`;
      return;
    }

    const course = getCourse(round.courseId);
    const totalStrokes = round.totals?.strokes ?? 0;
    const totalPutts = round.totals?.putts ?? 0;
    const vsPar = round.totals?.vsPar ?? 0;
    const holesPlayed = round.totals?.holesPlayed ?? 0;
    const vsParStr = vsPar === 0 ? 'Even' : (vsPar > 0 ? `+${vsPar}` : `${vsPar}`);
    const dateStr = formatRoundDate(round.startTime);

    // Hole-by-hole breakdown if we have course data
    let holeRows = '';
    if (course && round.scores) {
      const playedHoleNums = Object.keys(round.scores).map(Number).sort((a, b) => a - b);
      holeRows = playedHoleNums.map(hn => {
        const hd = course.holes.find(h => h.number === hn);
        const e = round.scores[hn];
        if (!hd || !e) return '';
        const diff = e.strokes - hd.par;
        let cls = 'par';
        if (diff <= -1) cls = 'birdie';
        else if (diff === 0) cls = 'par';
        else if (diff === 1) cls = 'bogey';
        else cls = 'over';
        return `
          <tr class="rs-hole-${cls}">
            <td>${hn}</td>
            <td>${hd.par}</td>
            <td><strong>${e.strokes}</strong></td>
            <td>${e.putts ?? '—'}</td>
          </tr>`;
      }).join('');
    }

    mount.innerHTML = `
      <div class="round-summary-head">
        <div class="round-summary-eyebrow">${holesPlayed >= 18 ? 'Round Complete' : `${holesPlayed}-Hole Round`}</div>
        <h2 class="round-summary-title">${escapeHtml(round.courseName || 'Round')}</h2>
        <div class="round-summary-meta">${escapeHtml(dateStr)} · ${escapeHtml(round.teeName || '')}</div>
      </div>

      <div class="round-summary-totals">
        <div class="round-summary-stat round-summary-stat-primary">
          <div class="round-summary-stat-value">${totalStrokes}</div>
          <div class="round-summary-stat-label">Strokes</div>
        </div>
        <div class="round-summary-stat">
          <div class="round-summary-stat-value">${vsParStr}</div>
          <div class="round-summary-stat-label">vs Par</div>
        </div>
        <div class="round-summary-stat">
          <div class="round-summary-stat-value">${totalPutts}</div>
          <div class="round-summary-stat-label">Putts</div>
        </div>
        <div class="round-summary-stat">
          <div class="round-summary-stat-value">${holesPlayed}</div>
          <div class="round-summary-stat-label">Holes</div>
        </div>
      </div>

      ${holeRows ? `
        <div class="round-summary-section-label">Hole by Hole</div>
        <div class="round-summary-table-wrap">
          <table class="round-summary-table">
            <thead>
              <tr><th>Hole</th><th>Par</th><th>Score</th><th>Putts</th></tr>
            </thead>
            <tbody>${holeRows}</tbody>
          </table>
        </div>
      ` : ''}

      <div class="round-summary-actions">
        <button class="course-detail-cta" onclick="showPanel('play', null)">Back to Play →</button>
        <button class="round-summary-delete" onclick="promptDeleteRound('${round.id}')">Delete this round</button>
      </div>
    `;
  }

  // Round deletion confirm modal state.
  let pendingRoundDeleteId = null;

  function promptDeleteRound(roundId) {
    pendingRoundDeleteId = roundId;
    const modal = document.getElementById('round-delete-modal');
    if (!modal) return;
    modal.classList.add('open');
    const confirmBtn = document.getElementById('round-delete-confirm-btn');
    if (confirmBtn) confirmBtn.focus();
  }

  function closeRoundDeleteModal() {
    pendingRoundDeleteId = null;
    const modal = document.getElementById('round-delete-modal');
    if (!modal) return;
    modal.classList.remove('open');
  }

  async function confirmRoundDelete() {
    if (!pendingRoundDeleteId) {
      closeRoundDeleteModal();
      return;
    }
    const roundId = pendingRoundDeleteId;
    closeRoundDeleteModal();
    await deleteRoundFromSummary(roundId);
  }

  // Delete a completed round from the summary screen. After deletion,
  // navigate back to Play landing — there's no round left to summarize.
  async function deleteRoundFromSummary(roundId) {
    if (currentUser && window.fb) {
      try {
        await window.fb.deleteDoc(`users/${currentUser.uid}/rounds/${roundId}`);
        recentRounds = recentRounds.filter(r => r.id !== roundId);
      } catch (err) {
        console.error('Failed to delete round:', err);
        showToast('Delete failed — see console', true);
        return;
      }
    }
    roundSummaryState.roundId = null;
    showToast('Round deleted');
    renderPlayLanding();
    showPanel('play', null);
  }

  // Schedule section: a grid of [workout-row × weekday-column] toggles
  function renderScheduleSection() {
    const weekdayShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const workouts = [
      { dayId: 'day1', label: 'Day 1 — Power & Rotation' },
      { dayId: 'day2', label: 'Day 2 — Strength & Stability' },
      { dayId: 'day3', label: 'Day 3 — Lower Body & Hip Power' }
    ];

    // Header row with weekday labels (desktop layout uses an empty leading cell)
    const headerRow = `
      <div class="schedule-header schedule-header-spacer"></div>
      ${weekdayShort.map(d => `<div class="schedule-header">${d}</div>`).join('')}
    `;

    // One row per workout: label cell + 7 day cells. Cells reflect the
    // *pending* draft so the user sees their edits immediately.
    const rows = workouts.map(w => {
      const cells = [...Array(7).keys()].map(weekday => {
        const assignedHere = (pendingScheduleOverride[weekday] || []).includes(w.dayId);
        const shared = (pendingScheduleOverride[weekday] || []).length > 1 && assignedHere;
        const cls = ['schedule-cell'];
        if (assignedHere) cls.push('assigned');
        if (shared) cls.push('shared');
        return `<button class="${cls.join(' ')}" onclick="toggleScheduleCell('${w.dayId}', ${weekday})" aria-label="Toggle ${w.dayId} on ${weekdayShort[weekday]}"></button>`;
      }).join('');
      return `<div class="schedule-row-label">${w.label}</div>${cells}`;
    }).join('');

    const pending = hasPendingScheduleChanges();
    const saveBar = pending ? `
      <div class="schedule-savebar" role="region" aria-label="Unsaved changes">
        <span class="schedule-savebar-msg">You have unsaved changes</span>
        <div class="schedule-savebar-actions">
          <button class="schedule-savebar-btn ghost" onclick="discardScheduleChanges()">Discard</button>
          <button class="schedule-savebar-btn primary" onclick="saveScheduleChanges()">Save</button>
        </div>
      </div>` : '';

    return `
      <div class="settings-section">
        <div class="settings-section-title">Schedule</div>
        <div class="settings-section-desc">Choose which weekdays each workout falls on. Tap a cell to toggle. You can assign the same workout to multiple days, or stack two workouts on the same day.</div>
        <div class="schedule-grid">
          ${headerRow}
          ${rows}
        </div>
        <div class="schedule-summary">${renderScheduleSummary()}</div>
        ${saveBar}
      </div>`;
  }

  // Human-readable summary of the schedule. Reads from pending so the user
  // sees what their edits would look like as soon as they tap a cell.
  function renderScheduleSummary() {
    const weekdayShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const workoutDays = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      const ids = pendingScheduleOverride[weekday] || [];
      if (ids.length > 0) {
        const labels = ids.map(id => `Day ${id.replace('day', '')}`);
        workoutDays.push(`${weekdayShort[weekday]} → ${labels.join(' + ')}`);
      }
    }
    const heading = hasPendingScheduleChanges() ? 'Preview' : 'Active';
    if (workoutDays.length === 0) {
      return `<strong>${heading}</strong> No workouts scheduled — every day is a rest day.`;
    }
    return `<strong>${heading}</strong> ${workoutDays.join(' · ')}`;
  }

  function renderUnitsSection() {
    return `
      <div class="settings-section">
        <div class="settings-section-title">Units</div>
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">Weight units</div>
            <div class="settings-row-sub">Affects log entries going forward. Existing logs aren't converted.</div>
          </div>
          <div class="seg-control">
            <button class="${prefs.units === 'lb' ? 'active' : ''}" onclick="setUnits('lb')">Lbs</button>
            <button class="${prefs.units === 'kg' ? 'active' : ''}" onclick="setUnits('kg')">Kg</button>
          </div>
        </div>
      </div>`;
  }

  function renderAppearanceSection() {
    return `
      <div class="settings-section">
        <div class="settings-section-title">Appearance</div>
        <div class="settings-row disabled">
          <div class="settings-row-info">
            <div class="settings-row-label">Dark mode</div>
            <div class="settings-row-sub">Coming in a future update.</div>
          </div>
          <span class="badge-soon">Soon</span>
        </div>
      </div>`;
  }

  function renderAccountSection() {
    const fullName = currentUser.displayName || '';
    const email = currentUser.email || '';
    const initial = (fullName || email || '?').trim().charAt(0).toUpperCase();
    const avatarInner = currentUser.photoURL
      ? `<img src="${currentUser.photoURL}" alt="" referrerpolicy="no-referrer" />`
      : initial;
    return `
      <div class="settings-section">
        <div class="settings-section-title">Account</div>
        <div class="settings-account-card">
          <div class="settings-account-avatar">${avatarInner}</div>
          <div class="settings-account-info">
            <div class="settings-account-name">${escapeHtml(fullName || 'Signed in')}</div>
            <div class="settings-account-email">${escapeHtml(email)}</div>
          </div>
          <button class="settings-signout-btn" onclick="handleSettingsSignOut()">Sign out</button>
        </div>
      </div>`;
  }

  // ─────────────────────────────────────────────────────────────
  // Settings actions
  // ─────────────────────────────────────────────────────────────
  // After any state change to prefs/pendingScheduleOverride, re-render the
  // Profile panel so the UI reflects the new state.
  function renderPreferencePanels() {
    renderProfile();
  }

  function toggleScheduleCell(dayId, weekday) {
    // Mutate the *pending* draft — saved prefs are untouched until the
    // user explicitly taps Save. This way the Today card and week strip
    // keep showing the live (saved) schedule until the user commits.
    const current = pendingScheduleOverride[weekday] || [];
    const idx = current.indexOf(dayId);
    const next = idx === -1 ? [...current, dayId] : current.filter(d => d !== dayId);
    if (next.length === 0) {
      delete pendingScheduleOverride[weekday];
    } else {
      pendingScheduleOverride[weekday] = next;
    }
    // Re-render only the settings panel — Today card / week strip don't
    // change until the user commits.
    renderPreferencePanels();
  }

  // Commit pending schedule changes to saved prefs and push to Firestore.
  async function saveScheduleChanges() {
    if (!hasPendingScheduleChanges()) return;
    prefs.scheduleOverride = JSON.parse(JSON.stringify(pendingScheduleOverride));
    renderPreferencePanels();
    renderTodayCard();
    renderWeekStrip();
    const ok = await savePreferences();
    if (ok) showToast('Schedule saved');
  }

  // Discard pending changes — revert to whatever's in saved prefs.
  function discardScheduleChanges() {
    if (!hasPendingScheduleChanges()) return;
    if (!confirm('Discard your unsaved schedule changes?')) return;
    resetPendingSchedule();
    renderPreferencePanels();
  }

  async function setUnits(unit) {
    if (prefs.units === unit) return;
    prefs.units = unit;
    renderPreferencePanels();
    await savePreferences();
  }

  function handleSettingsSignOut() {
    if (!window.fb || !currentUser) return;
    if (!confirm(`Sign out of ${currentUser.displayName || currentUser.email || 'this account'}?`)) return;
    window.fb.signOut().catch(err => {
      console.error('Sign out failed:', err);
      alert('Sign out failed. See console.');
    });
  }

  // Build one card's HTML for a single session document.
  function renderHistoryCard(session) {
    const dateLabel = formatHistoryDate(session.dateKey, session.endTime);
    const dayTitle = dayIdToTitle(session.dayId);
    const durationMin = session.durationSeconds ? Math.round(session.durationSeconds / 60) : null;
    const exercises = session.exercises || {};
    const exNames = Object.keys(exercises);
    const totalCount = exNames.length;
    // Completed = done OR has any logged sets. Skipped is the inverse.
    const completedCount = exNames.filter(name => {
      const ex = exercises[name];
      if (!ex) return false;
      if (ex.done) return true;
      const sets = Array.isArray(ex.sets) ? ex.sets : [];
      return sets.some(s => s && (s.weight || s.reps || s.notes));
    }).length;
    const skippedCount = totalCount - completedCount;
    const metaParts = [];
    if (durationMin) metaParts.push(`${durationMin} min`);
    metaParts.push(`${completedCount} done${skippedCount > 0 ? ` · ${skippedCount} skipped` : ''}`);
    const meta = metaParts.join(' · ');
    const sessionId = escapeAttr(session.id || '');
    const locked = session.active === true;

    const exerciseRows = exNames.length === 0
      ? '<div class="history-no-sets">No exercises were logged for this session.</div>'
      : exNames.map(name => renderHistoryExercise(name, exercises[name], sessionId, locked)).join('');

    // Session-level delete sits in a small header inside the detail area —
    // subtle but reachable, doesn't clutter the collapsed card list.
    const detailInner = `
      <div class="history-detail-head">
        <span class="history-detail-meta">Session Details</span>
        <button class="history-session-delete" onclick="event.stopPropagation(); deleteHistorySession('${sessionId}')" aria-label="Delete entire session">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/>
          </svg>
          Delete
        </button>
      </div>
      ${exerciseRows}`;

    return `
      <div class="history-card" data-session-id="${sessionId}" onclick="toggleHistoryCard(this)">
        <div class="history-card-head">
          <div class="history-card-date">${dateLabel}</div>
          <div class="history-card-title">
            <div class="history-card-title-main">${escapeHtml(dayTitle)}</div>
            <div class="history-card-meta">${escapeHtml(meta)}</div>
          </div>
          <div class="history-card-progress"><em>${completedCount}</em> / ${totalCount}</div>
          <div class="history-card-chevron">▼</div>
        </div>
        <div class="history-detail-wrap"><div class="history-detail"><div class="history-detail-inner">
          ${detailInner}
        </div></div></div>
      </div>`;
  }

  // Render one exercise inside the expanded detail of a history card.
  function renderHistoryExercise(name, data, sessionId, locked) {
    const sets = Array.isArray(data?.sets) ? data.sets : [];
    const loggedSets = sets
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s && (s.weight || s.reps || s.notes));
    // An exercise is "skipped" if explicitly flagged OR if it has no logged
    // sets AND wasn't marked done. The explicit flag covers new sessions
    // saved after this change; the fallback covers older sessions that
    // predate the skipped field so they display correctly too.
    const explicitSkip = data?.skipped === true;
    const implicitSkip = !data?.done && loggedSets.length === 0;
    const isSkipped = explicitSkip || implicitSkip;

    let setsHtml;
    if (loggedSets.length === 0) {
      setsHtml = '<div class="history-no-sets">No sets logged for this exercise.</div>';
    } else {
      setsHtml = '<div class="history-sets">' + loggedSets.map(({ s, i }) => {
        const label = `${i + 1}`;
        const weight = s.weight ? escapeHtml(s.weight) : '—';
        const reps = s.reps ? escapeHtml(s.reps) : '—';
        const notes = s.notes ? `<div class="history-set-notes">${escapeHtml(s.notes)}</div>` : '';
        return `
          <div class="history-set-row">
            <div class="history-set-label">Set ${label}</div>
            <div class="history-set-data"><em>${weight}</em> × <em>${reps}</em></div>
            ${notes}
          </div>`;
      }).join('') + '</div>';
    }

    const encName = encodeURIComponent(name);
    const classes = ['history-ex', 'editable'];
    if (isSkipped) classes.push('skipped');
    if (locked) classes.push('locked');

    const skipTag = isSkipped ? '<span class="history-ex-skip-tag">Skipped</span>' : '';

    return `
      <div class="${classes.join(' ')}" onclick="event.stopPropagation(); editHistoryExercise('${sessionId}', '${encName}')">
        <div class="history-ex-head">
          <div class="history-ex-name">${escapeHtml(name)}</div>
          ${skipTag}
          <span class="history-ex-edit-hint">Edit</span>
          <button class="history-ex-delete" onclick="event.stopPropagation(); deleteHistoryExercise('${sessionId}', '${encName}')" aria-label="Remove this exercise from the session"></button>
        </div>
        ${setsHtml}
      </div>`;
  }

  function toggleHistoryCard(card) {
    card.classList.toggle('open');
  }

  // ─────────────────────────────────────────────────────────────
  // Editing and deleting past sessions
  // ─────────────────────────────────────────────────────────────
  // When editing a past session, the log modal needs to know two things:
  //   - Which session doc we're editing (sessionId)
  //   - Which exercise within that session (exerciseName)
  // When these are set, saveLog() writes back to Firestore instead of the
  // in-memory live session.
  let editingContext = null;

  function findSessionById(sessionId) {
    return recentSessions.find(s => s.id === sessionId);
  }

  // Locate the ex-card element in the program that matches this exercise name.
  // We need it so openLog() can parse the rep scheme, identify the rep rx,
  // and build the same modal it would for a live session.
  function findCardByName(exerciseName) {
    const cards = document.querySelectorAll('.ex-card');
    for (const card of cards) {
      if (exerciseKey(card) === exerciseName) return card;
    }
    return null;
  }

  function editHistoryExercise(sessionId, encName) {
    if (session.active) {
      showToast('Finish your current workout before editing history', true);
      return;
    }
    const name = decodeURIComponent(encName);
    const sess = findSessionById(sessionId);
    if (!sess) {
      showToast('Session not found', true);
      return;
    }
    const card = findCardByName(name);
    if (!card) {
      showToast('Exercise not found in program', true);
      return;
    }

    // Stash the context so saveLog() knows this is a historical edit
    editingContext = {
      sessionId,
      exerciseName: name,
      sessionDoc: sess
    };

    // Temporarily splice the stored data into session.logs so openLog()
    // pre-fills the modal with it. openLog reads from session.logs[key].sets.
    // We restore session.logs afterward (it was {} since no live session).
    const existingExercise = sess.exercises?.[name];
    session.logs = {
      [name]: {
        sets: existingExercise?.sets ? JSON.parse(JSON.stringify(existingExercise.sets)) : [],
        done: !!existingExercise?.done
      }
    };
    session.currentExerciseKey = name;
    // Build a synthetic "Log" button and pass it to openLog so it can find
    // the card and scrape the rep scheme.
    const fakeBtn = card.querySelector('.ex-log-btn') || card;
    openLog(fakeBtn);

    // Override the modal's eyebrow to signal this is historical, not a live log.
    const eyebrow = document.getElementById('modal-eyebrow');
    if (eyebrow) {
      const dateLabel = formatHistoryDate(sess.dateKey, sess.endTime);
      eyebrow.textContent = `Edit · ${dateLabel}`;
    }
  }

  async function deleteHistoryExercise(sessionId, encName) {
    if (session.active) {
      showToast('Finish your current workout before editing history', true);
      return;
    }
    const name = decodeURIComponent(encName);
    const sess = findSessionById(sessionId);
    if (!sess) return;
    if (!confirm(`Remove "${name}" from this session?`)) return;

    try {
      // Build updated exercises map without this one
      const updatedExercises = { ...(sess.exercises || {}) };
      delete updatedExercises[name];

      if (!currentUser || !window.fb) {
        showToast('Not signed in', true);
        return;
      }
      const path = `users/${currentUser.uid}/sessions/${sessionId}`;
      // Write the full session back with the exercise removed
      const payload = {
        dayId: sess.dayId,
        dateKey: sess.dateKey,
        startTime: sess.startTime,
        endTime: sess.endTime,
        durationSeconds: sess.durationSeconds,
        exercises: updatedExercises
      };
      await window.fb.setDoc(path, payload);

      // Update local cache
      const idx = recentSessions.findIndex(s => s.id === sessionId);
      if (idx !== -1) {
        recentSessions[idx] = { id: sessionId, ...payload };
      }
      renderHistory();
      // After re-render the card is collapsed — re-open the one the user was in
      reopenCard(sessionId);
      showToast('Exercise removed');
    } catch (err) {
      console.error('Failed to remove exercise:', err);
      showToast('Remove failed — see console', true);
    }
  }

  async function deleteHistorySession(sessionId) {
    if (session.active) {
      showToast('Finish your current workout before editing history', true);
      return;
    }
    const sess = findSessionById(sessionId);
    if (!sess) return;
    const dateLabel = formatHistoryDate(sess.dateKey, sess.endTime);
    const dayTitle = dayIdToTitle(sess.dayId);
    if (!confirm(`Delete this entire session?\n\n${dateLabel} — ${dayTitle}\n\nThis cannot be undone.`)) return;

    try {
      if (!currentUser || !window.fb) {
        showToast('Not signed in', true);
        return;
      }
      const path = `users/${currentUser.uid}/sessions/${sessionId}`;
      await window.fb.deleteDoc(path);
      recentSessions = recentSessions.filter(s => s.id !== sessionId);
      renderHistory();
      showToast('Session deleted');
    } catch (err) {
      console.error('Failed to delete session:', err);
      showToast('Delete failed — see console', true);
    }
  }

  // After a re-render, if the user had a card expanded, put it back.
  function reopenCard(sessionId) {
    requestAnimationFrame(() => {
      const card = document.querySelector(`.history-card[data-session-id="${CSS.escape(sessionId)}"]`);
      if (card) card.classList.add('open');
    });
  }

  // "Wed · April 17" — short human-friendly label. Falls back to endTime if
  // dateKey is missing (older records shouldn't be, but defense).
  function formatHistoryDate(dateKey, endTimeMs) {
    let date;
    if (dateKey) {
      // dateKey is YYYY-MM-DD in local time. Appending T00:00 keeps it local.
      date = new Date(dateKey + 'T00:00');
    } else if (endTimeMs) {
      date = new Date(endTimeMs);
    } else {
      return '—';
    }
    const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return `${weekdays[date.getDay()]} · ${months[date.getMonth()]} ${date.getDate()}`;
  }

  // Map stored dayId to a human title. Uses the SCHEDULE config we already
  // keep around for the Today card, reused here.
  function dayIdToTitle(dayId) {
    for (const key of Object.keys(SCHEDULE)) {
      const s = SCHEDULE[key];
      if (s.dayId === dayId) {
        const num = s.number;
        return `Day ${num} — ${stripHtml(s.title)}`;
      }
    }
    return dayId || 'Workout';
  }

  // Safe HTML escaping — user-generated notes could theoretically contain
  // HTML; we render them as text in all cases.
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function escapeAttr(str) {
    return escapeHtml(str);
  }

  // ─────────────────────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────────────────────
  renderTodayCard();
  renderWeekStrip();
  renderHistory();
  renderPreferencePanels();
  renderPlayLanding();
  updatePlayCoursesCount();
  // Seed mobile shell state based on the initial active panel ("today")
  document.body.dataset.currentPanel = currentPanelId || 'today';
  const initialTitle = document.getElementById('mobile-topbar-title');
  if (initialTitle) initialTitle.textContent = mobilePanelTitle(currentPanelId || 'today');
  syncMobileBottomNav(currentPanelId || 'today');
  renderMobileNavAvatar();
