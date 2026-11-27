/**
 * First-run coachmarks: spotlight steps + short tooltips.
 * Seen tours persist in localStorage; Help reopens any tour.
 */

const STORAGE_KEY = 'cbc-coach-seen';
const VERSION = 1;

/** @typedef {{ id: string, selector: string, title: string, body: string, place?: 'top'|'bottom'|'left'|'right' }} CoachStep */
/** @typedef {{ id: string, label: string, when: (ctx: object) => boolean, steps: CoachStep[] }} CoachTour */

/** @type {CoachTour[]} */
export const COACH_TOURS = [
  {
    id: 'host-join',
    label: 'Host & join',
    when: (ctx) => ctx.screen === 'lobby-shell',
    steps: [
      {
        id: 'name',
        selector: '#name',
        title: 'Your name',
        body: 'Shown on the player list. Saved on this device.',
        place: 'bottom',
      },
      {
        id: 'host',
        selector: '#btn-host',
        title: 'Host as Dealer',
        body: 'One device runs the table. Share the room code or link next.',
        place: 'bottom',
      },
      {
        id: 'join',
        selector: '#btn-join',
        title: 'Join as Hero',
        body: 'Enter a friend’s code (or open their link) while their dealer tab stays open.',
        place: 'top',
      },
    ],
  },
  {
    id: 'pick-hero',
    label: 'Lobby & heroes',
    when: (ctx) => ctx.screen === 'lobby-game',
    steps: [
      {
        id: 'share',
        selector: '#btn-copy',
        title: 'Invite friends',
        body: 'Copy the join link or read out the room code.',
        place: 'bottom',
      },
      {
        id: 'heroes',
        selector: '[data-coach="hero-picks"]',
        title: 'Pick a hero',
        body: 'Choose an archetype. Dealers can assign seats; heroes pick for themselves.',
        place: 'left',
      },
      {
        id: 'start',
        selector: '#btn-start, [data-coach="waiting-start"]',
        title: 'Start Floor 1',
        body: 'Dealer starts when everyone is ready. Layout & theme can be set first.',
        place: 'top',
      },
    ],
  },
  {
    id: 'explore',
    label: 'Exploration',
    when: (ctx) => ctx.screen === 'table' && ctx.phase === 'exploring',
    steps: [
      {
        id: 'map',
        selector: '[data-coach="map"]',
        title: 'Move on the map',
        body: 'On your turn, tap a connected room. Face-down tiles flip when you enter.',
        place: 'right',
      },
      {
        id: 'actions',
        selector: '[data-coach="actions-left"]',
        title: 'Exploration actions',
        body: 'Each turn you get a few actions — move, loot, rest, then End turn.',
        place: 'bottom',
      },
      {
        id: 'hero-panel',
        selector: '[data-coach="side-panel"]',
        title: 'Your gear & hand',
        body: 'Party status, HP, gear, and Action cards live here.',
        place: 'left',
      },
    ],
  },
  {
    id: 'clash',
    label: 'Clash & Chain',
    when: (ctx) => ctx.screen === 'table' && ctx.phase === 'clash',
    steps: [
      {
        id: 'clash-panel',
        // Target the pile stage inside the modal — not the full-screen backdrop
        // (full-screen targets push the tip off-screen and block the table).
        selector: '[data-coach="clash-pile"], [data-coach="clash"]',
        title: 'Clash time!',
        body: 'Match Suit or Rank on the pile. Highlighted cards are legal plays.',
        place: 'bottom',
      },
      {
        id: 'desperation',
        selector: '#btn-clash-desperation, [data-coach="clash-wait"]',
        title: 'Stuck?',
        body: 'No legal play? Flip Desperation — or Stretch to ditch Cramp! cards.',
        place: 'top',
      },
    ],
  },
  {
    id: 'dealer-tools',
    label: 'Dealer tools',
    when: (ctx) => ctx.screen === 'table' && ctx.isDealer && ctx.phase !== 'lobby',
    steps: [
      {
        id: 'tools',
        selector: '[data-coach="dealer-tools"]',
        title: 'Dealer toolkit',
        body: 'Draw Twists, unlock stairs, or end the floor when the crawl wraps.',
        place: 'bottom',
      },
      {
        id: 'twist',
        selector: '#btn-draw-twist',
        title: 'Twists',
        body: 'Draw & play Twist cards to keep the basement chaotic (you’re the rules authority).',
        place: 'bottom',
      },
    ],
  },
];

/** @type {{ tourId: string|null, stepIndex: number }} */
let active = { tourId: null, stepIndex: 0 };

/** @type {(() => void)|null} */
let onChange = null;

/** Prevent ResizeObserver → notify → rebuild → observe loops. */
let painting = false;
let positionRaf = 0;

let resizeObserver = null;
let repositionHandler = null;

/** Last paint signature so we can reposition without full rebuild when possible. */
let lastPaintKey = '';

export function setCoachChangeHandler(fn) {
  onChange = fn;
}

function readSeen() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { v: VERSION, tours: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { v: VERSION, tours: {} };
    return { v: VERSION, tours: parsed.tours && typeof parsed.tours === 'object' ? parsed.tours : {} };
  } catch {
    return { v: VERSION, tours: {} };
  }
}

function writeSeen(seen) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: VERSION, tours: seen.tours }));
  } catch {
    /* private mode / quota */
  }
}

export function isTourSeen(tourId) {
  return Boolean(readSeen().tours[tourId]);
}

export function markTourSeen(tourId) {
  const seen = readSeen();
  seen.tours[tourId] = Date.now();
  writeSeen(seen);
}

export function clearAllCoachSeen() {
  writeSeen({ v: VERSION, tours: {} });
}

export function markAllToursSeen() {
  const seen = readSeen();
  const now = Date.now();
  for (const t of COACH_TOURS) {
    seen.tours[t.id] = now;
  }
  writeSeen(seen);
  stopTour({ markSeen: true });
}

export function getActiveTour() {
  if (!active.tourId) return null;
  return COACH_TOURS.find((t) => t.id === active.tourId) || null;
}

export function getActiveStep() {
  const tour = getActiveTour();
  if (!tour) return null;
  return tour.steps[active.stepIndex] || null;
}

export function isCoachActive() {
  return Boolean(active.tourId);
}

export function startTour(tourId, { force = false } = {}) {
  const tour = COACH_TOURS.find((t) => t.id === tourId);
  if (!tour) return false;
  if (!force && isTourSeen(tourId)) return false;
  const first = findNextAvailableStep(tour, 0);
  if (first < 0) return false;
  active = { tourId, stepIndex: first };
  notify();
  return true;
}

export function stopTour({ markSeen = true } = {}) {
  if (active.tourId && markSeen) markTourSeen(active.tourId);
  active = { tourId: null, stepIndex: 0 };
  teardownPositioning();
  lastPaintKey = '';
  notify();
}

export function nextCoachStep() {
  const tour = getActiveTour();
  if (!tour) return;
  const next = findNextAvailableStep(tour, active.stepIndex + 1);
  if (next < 0) {
    stopTour({ markSeen: true });
    return;
  }
  active.stepIndex = next;
  notify();
}

export function prevCoachStep() {
  const tour = getActiveTour();
  if (!tour) return;
  const prev = findPrevAvailableStep(tour, active.stepIndex - 1);
  if (prev < 0) return;
  active.stepIndex = prev;
  notify();
}

function findNextAvailableStep(tour, from) {
  for (let i = from; i < tour.steps.length; i += 1) {
    if (document.querySelector(tour.steps[i].selector)) return i;
  }
  return -1;
}

function findPrevAvailableStep(tour, from) {
  for (let i = from; i >= 0; i -= 1) {
    if (document.querySelector(tour.steps[i].selector)) return i;
  }
  return -1;
}

function notify() {
  if (painting) return;
  onChange?.();
}

/**
 * After each app render: auto-start the first unseen matching tour,
 * or refresh spotlight if a tour is mid-flight.
 */
export function syncCoachAfterRender(ctx) {
  if (active.tourId) {
    const tour = getActiveTour();
    if (!tour || !tour.when(ctx)) {
      stopTour({ markSeen: true });
    } else {
      const el = document.querySelector(getActiveStep()?.selector || '');
      if (!el) {
        const next = findNextAvailableStep(tour, active.stepIndex);
        if (next < 0) stopTour({ markSeen: true });
        else if (next !== active.stepIndex) {
          active.stepIndex = next;
        }
      }
      return;
    }
  }

  for (const tour of COACH_TOURS) {
    if (!tour.when(ctx)) continue;
    if (isTourSeen(tour.id)) continue;
    requestAnimationFrame(() => {
      if (!active.tourId) startTour(tour.id);
    });
    break;
  }
}

export function toursForContext(ctx) {
  return COACH_TOURS.filter((t) => t.when(ctx));
}

export function listAllTours() {
  return COACH_TOURS.map((t) => ({
    id: t.id,
    label: t.label,
    seen: isTourSeen(t.id),
  }));
}

function teardownPositioning() {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (repositionHandler) {
    window.removeEventListener('resize', repositionHandler);
    window.removeEventListener('scroll', repositionHandler, true);
    repositionHandler = null;
  }
  if (positionRaf) {
    cancelAnimationFrame(positionRaf);
    positionRaf = 0;
  }
}

function ensureHost() {
  let host = document.getElementById('coach-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'coach-root';
    document.body.appendChild(host);
  }
  return host;
}

function scheduleReposition() {
  if (positionRaf) return;
  positionRaf = requestAnimationFrame(() => {
    positionRaf = 0;
    updateSpotlightPositions();
  });
}

function updateSpotlightPositions() {
  const tour = getActiveTour();
  const step = getActiveStep();
  const target = step ? document.querySelector(step.selector) : null;
  const hole = document.querySelector('.coach-hole');
  const tip = document.querySelector('.coach-tip');
  if (!tour || !step || !target || !hole) return;

  const rect = target.getBoundingClientRect();
  const holeBox = holeBoxForTarget(rect);
  hole.style.top = `${holeBox.top}px`;
  hole.style.left = `${holeBox.left}px`;
  hole.style.width = `${holeBox.width}px`;
  hole.style.height = `${holeBox.height}px`;

  if (tip) {
    const tipPos = placeTip(rect, step.place || 'bottom', tip);
    tip.style.top = `${tipPos.top}px`;
    tip.style.left = `${tipPos.left}px`;
    tip.style.maxWidth = `${tipPos.maxWidth}px`;
  }
}

/** Keep spotlight hole inside the viewport (never full-bleed off edges). */
function holeBoxForTarget(rect) {
  const pad = 8;
  const margin = 8;
  const left = clamp(rect.left - pad, margin, window.innerWidth - margin - 40);
  const top = clamp(rect.top - pad, margin, window.innerHeight - margin - 40);
  const width = Math.min(window.innerWidth - left - margin, Math.max(40, rect.width + pad * 2));
  const height = Math.min(window.innerHeight - top - margin, Math.max(40, rect.height + pad * 2));
  return { top, left, width, height };
}

function setupPositioning(target) {
  teardownPositioning();
  if (!target) return;
  repositionHandler = () => scheduleReposition();
  window.addEventListener('resize', repositionHandler);
  window.addEventListener('scroll', repositionHandler, true);
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => scheduleReposition());
    resizeObserver.observe(target);
  }
}

/** Menu open state lives with the session in main.js; callbacks set here. */
let menuHandlers = {
  getMenuOpen: () => false,
  setMenuOpen: () => {},
  getContext: () => ({ screen: 'lobby-shell' }),
};

export function bindCoachMenu(handlers) {
  menuHandlers = { ...menuHandlers, ...handlers };
}

export function renderCoachUi({ context, menuOpen }) {
  painting = true;
  try {
    const host = ensureHost();
    const tour = getActiveTour();
    const step = getActiveStep();
    const target = step ? document.querySelector(step.selector) : null;
    const paintKey = `${active.tourId || ''}:${active.stepIndex}:${menuOpen ? 1 : 0}:${target ? 1 : 0}`;

    // Same step already painted — only refresh positions (avoids observer thrash).
    if (paintKey === lastPaintKey && host.querySelector('#coach-help')) {
      updateSpotlightPositions();
      return;
    }
    lastPaintKey = paintKey;

    const helpBtn = `
    <button type="button" class="coach-help-btn" id="coach-help" title="Help & tips" aria-label="Help and tips">?</button>
  `;

    let spotlight = '';
    let tip = '';
    if (tour && step && target) {
      const rect = target.getBoundingClientRect();
      const holeBox = holeBoxForTarget(rect);
      spotlight = `
      <div class="coach-catcher" id="coach-backdrop" aria-hidden="true"></div>
      <div class="coach-hole" style="top:${holeBox.top}px;left:${holeBox.left}px;width:${holeBox.width}px;height:${holeBox.height}px"></div>
    `;
      const tipPos = placeTip(rect, step.place || 'bottom');
      const stepNum = availableStepNumber(tour, active.stepIndex);
      const stepTotal = countAvailableSteps(tour);
      tip = `
      <div class="coach-tip" role="dialog" aria-labelledby="coach-tip-title"
        style="top:${tipPos.top}px;left:${tipPos.left}px;max-width:${tipPos.maxWidth}px">
        <div class="coach-tip-kicker">Tip ${stepNum} / ${stepTotal} · ${escapeHtml(tour.label)}</div>
        <h3 id="coach-tip-title">${escapeHtml(step.title)}</h3>
        <p>${escapeHtml(step.body)}</p>
        <div class="coach-tip-actions">
          <div class="row" style="margin:0;gap:0.35rem">
            <button type="button" class="ghost" id="coach-skip">Skip</button>
            <button type="button" class="ghost" id="coach-skip-all">Skip all tips</button>
          </div>
          <div class="row" style="margin:0">
            <button type="button" id="coach-prev" ${stepNum <= 1 ? 'disabled' : ''}>Back</button>
            <button type="button" class="primary" id="coach-next">${stepNum >= stepTotal ? 'Got it' : 'Next'}</button>
          </div>
        </div>
      </div>
    `;
    }

    let menu = '';
    if (menuOpen) {
      const items = COACH_TOURS.map((t) => {
        const available = t.when(context);
        const seen = isTourSeen(t.id);
        return `
        <button type="button" class="coach-menu-item" data-coach-replay="${escapeAttr(t.id)}"
          ${available ? '' : 'disabled'}
          title="${available ? '' : 'Not on this screen'}">
          <span>${escapeHtml(t.label)}</span>
          <span class="muted">${seen ? 'replay' : 'new'}${available ? '' : ' · later'}</span>
        </button>`;
      }).join('');
      menu = `
      <div class="coach-menu" role="menu" aria-label="Help topics">
        <div class="coach-menu-head">
          <strong>Quick tips</strong>
          <button type="button" class="ghost" id="coach-menu-close" aria-label="Close">✕</button>
        </div>
        <p class="muted" style="margin:0 0 0.5rem;font-size:0.82rem">Short spotlights — not a rulebook. First visit auto-plays once.</p>
        ${items}
        <button type="button" class="ghost coach-menu-reset" id="coach-reset-seen">Show tips again next time</button>
      </div>
    `;
    }

    host.innerHTML = `${helpBtn}${menu}${spotlight}${tip}`;
    wireCoachDom();
    if (tour && step && target) {
      setupPositioning(target);
      // Second pass with measured tip height so it never clips off-screen.
      updateSpotlightPositions();
    } else teardownPositioning();
  } finally {
    painting = false;
  }
}

function availableStepNumber(tour, index) {
  let n = 0;
  for (let i = 0; i <= index; i += 1) {
    if (document.querySelector(tour.steps[i].selector)) n += 1;
  }
  return Math.max(1, n);
}

function countAvailableSteps(tour) {
  return tour.steps.filter((s) => document.querySelector(s.selector)).length;
}

/**
 * Position tip fully inside the viewport. Uses measured tip height when available.
 * Oversized targets (near full-screen modals) get a safe lower-center placement.
 */
function placeTip(rect, place, tipEl) {
  const margin = 12;
  const tipW = Math.min(300, window.innerWidth - margin * 2);
  const measured = tipEl?.getBoundingClientRect?.().height;
  const tipH = measured && measured > 40 ? measured : 168;
  const gap = 14;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxTop = Math.max(margin, vh - tipH - margin);
  const maxLeft = Math.max(margin, vw - tipW - margin);

  const coversViewport =
    rect.width * rect.height > vw * vh * 0.4 ||
    (rect.width > vw * 0.85 && rect.height > vh * 0.55);

  if (coversViewport) {
    return {
      top: clamp(vh - tipH - 72, margin, maxTop),
      left: clamp((vw - tipW) / 2, margin, maxLeft),
      maxWidth: tipW,
    };
  }

  let top;
  let left = clamp(rect.left + rect.width / 2 - tipW / 2, margin, maxLeft);

  const preferTop = () => {
    top = rect.top - gap - tipH;
    if (top < margin) top = rect.bottom + gap;
  };
  const preferBottom = () => {
    top = rect.bottom + gap;
    if (top + tipH > vh - margin) top = rect.top - gap - tipH;
  };

  if (place === 'top') {
    preferTop();
  } else if (place === 'left') {
    top = clamp(rect.top, margin, maxTop);
    left = rect.left - tipW - gap;
    if (left < margin) left = clamp(rect.right + gap, margin, maxLeft);
  } else if (place === 'right') {
    top = clamp(rect.top, margin, maxTop);
    left = rect.right + gap;
    if (left + tipW > vw - margin) {
      left = clamp(rect.left - tipW - gap, margin, maxLeft);
    }
  } else {
    preferBottom();
  }

  let finalTop = clamp(top, margin, maxTop);
  let finalLeft = clamp(left, margin, maxLeft);

  const handEl = typeof document !== 'undefined' ? document.querySelector('.clash-player-hand') : null;
  const handRect = handEl?.getBoundingClientRect?.();
  if (handRect && handRect.width > 0 && handRect.height > 0) {
    const overlapsHand = (t, l) =>
      l < handRect.right + 4 &&
      l + tipW > handRect.left - 4 &&
      t < handRect.bottom + 4 &&
      t + tipH > handRect.top - 4;
    if (overlapsHand(finalTop, finalLeft)) {
      const candidates = [
        { t: clamp(handRect.top - gap - tipH, margin, maxTop), l: finalLeft },
        { t: finalTop, l: clamp(handRect.left - gap - tipW, margin, maxLeft) },
        { t: finalTop, l: clamp(handRect.right + gap, margin, maxLeft) },
        { t: clamp(handRect.bottom + gap, margin, maxTop), l: finalLeft },
      ];
      const clear = candidates.find((c) => !overlapsHand(c.t, c.l));
      if (clear) {
        finalTop = clear.t;
        finalLeft = clear.l;
      }
    }
  }

  return {
    top: finalTop,
    left: finalLeft,
    maxWidth: tipW,
  };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

let targetAdvanceBound = false;

function ensureTargetAdvanceListener() {
  if (targetAdvanceBound || typeof document === 'undefined') return;
  targetAdvanceBound = true;
  document.addEventListener(
    'click',
    (e) => {
      if (!active.tourId) return;
      if (e.target?.closest?.('#coach-root')) return;
      const step = getActiveStep();
      if (!step?.selector) return;
      const targetEl = e.target?.closest?.(step.selector);
      if (targetEl) {
        queueMicrotask(() => {
          if (active.tourId) nextCoachStep();
        });
      }
    },
    true,
  );
}

function wireCoachDom() {
  ensureTargetAdvanceListener();
  document.getElementById('coach-help')?.addEventListener('click', () => {
    if (isCoachActive()) {
      stopTour({ markSeen: false });
    }
    menuHandlers.setMenuOpen(!menuHandlers.getMenuOpen());
  });
  document.getElementById('coach-menu-close')?.addEventListener('click', () => {
    menuHandlers.setMenuOpen(false);
  });
  document.getElementById('coach-reset-seen')?.addEventListener('click', () => {
    clearAllCoachSeen();
    menuHandlers.setMenuOpen(false);
    const ctx = menuHandlers.getContext();
    for (const tour of COACH_TOURS) {
      if (tour.when(ctx)) {
        startTour(tour.id, { force: true });
        break;
      }
    }
  });
  document.querySelectorAll('[data-coach-replay]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-coach-replay');
      menuHandlers.setMenuOpen(false);
      startTour(id, { force: true });
    });
  });
  document.getElementById('coach-skip')?.addEventListener('click', () => {
    stopTour({ markSeen: true });
  });
  document.getElementById('coach-skip-all')?.addEventListener('click', () => {
    markAllToursSeen();
  });
  document.getElementById('coach-next')?.addEventListener('click', () => {
    nextCoachStep();
  });
  document.getElementById('coach-prev')?.addEventListener('click', () => {
    prevCoachStep();
  });
  document.getElementById('coach-backdrop')?.addEventListener('click', () => {
    nextCoachStep();
  });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", '&#39;');
}
