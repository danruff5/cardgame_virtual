/**
 * Top-layer floating portal for card hover tooltips.
 * Mounts #card-tip-layer directly on document.body (z-index: 9500) so tooltips
 * are never covered by modal backdrops/blur or clipped inside scrollable containers.
 */

const TRIGGER_SELECTOR =
  '.log-card-mention, .vcard, .map-tile-wrap, .dealer-twist-chip, .belt-item-row, .clash-card-btn';

let bound = false;
let activeTrigger = null;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Compute viewport-clamped fixed coordinates for a tooltip anchored to `anchorRect`.
 */
export function computeTipPosition(anchorRect, tipSize, viewport, { margin = 8, gap = 10 } = {}) {
  const vw = viewport?.width || 1280;
  const vh = viewport?.height || 720;
  const w = Math.min(tipSize?.width || 240, Math.max(40, vw - margin * 2));
  const h = Math.min(tipSize?.height || 100, Math.max(40, vh - margin * 2));

  const maxLeft = Math.max(margin, vw - w - margin);
  const maxTop = Math.max(margin, vh - h - margin);

  let left = clamp(anchorRect.left + anchorRect.width / 2 - w / 2, margin, maxLeft);
  let top = anchorRect.top - h - gap;

  if (top < margin) {
    const belowTop = anchorRect.bottom + gap;
    if (belowTop + h <= vh - margin) {
      top = belowTop;
    } else {
      const leftSide = anchorRect.left - w - gap;
      const rightSide = anchorRect.right + gap;
      const sideTop = clamp(anchorRect.top, margin, maxTop);
      if (leftSide >= margin) {
        left = leftSide;
        top = sideTop;
      } else if (rightSide + w <= vw - margin) {
        left = rightSide;
        top = sideTop;
      } else {
        top = clamp(belowTop, margin, maxTop);
        const box = { left, top, right: left + w, bottom: top + h };
        if (rectsOverlap(box, anchorRect) && anchorRect.top - h - gap >= margin) {
          top = anchorRect.top - h - gap;
        }
      }
    }
  }

  return {
    left: Math.round(clamp(left, margin, maxLeft)),
    top: Math.round(clamp(top, margin, maxTop)),
  };
}

function ensurePortalEl() {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById('card-tip-layer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'card-tip-layer';
    el.className = 'card-hover-tip is-portal';
    el.setAttribute('role', 'tooltip');
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  return el;
}

function findTipSource(target) {
  if (!target || typeof target.closest !== 'function') return null;
  const triggerEl = target.closest(TRIGGER_SELECTOR);
  if (!triggerEl) return null;

  let tipEl = null;
  if (triggerEl.classList.contains('clash-card-btn')) {
    tipEl = triggerEl.querySelector('.vcard > .card-hover-tip, .card-hover-tip');
  } else {
    tipEl = Array.from(triggerEl.children || []).find((c) => c.classList?.contains('card-hover-tip')) || null;
  }
  if (!tipEl || !tipEl.innerHTML.trim()) return null;
  return { triggerEl, tipEl };
}

function showTipFor(triggerEl, tipEl) {
  const portal = ensurePortalEl();
  if (!portal) return;
  activeTrigger = triggerEl;
  portal.innerHTML = tipEl.innerHTML;
  portal.classList.add('is-open');
  portal.setAttribute('aria-hidden', 'false');

  const anchorRect = triggerEl.getBoundingClientRect();
  const tipRect = portal.getBoundingClientRect();
  const pos = computeTipPosition(
    anchorRect,
    { width: tipRect.width, height: tipRect.height },
    { width: window.innerWidth, height: window.innerHeight },
  );
  portal.style.left = `${pos.left}px`;
  portal.style.top = `${pos.top}px`;
}

export function hideCardTip() {
  activeTrigger = null;
  if (typeof document === 'undefined') return;
  const portal = document.getElementById('card-tip-layer');
  if (!portal) return;
  portal.classList.remove('is-open');
  portal.setAttribute('aria-hidden', 'true');
}

export function initCardTipPortal() {
  if (typeof document === 'undefined') return;
  document.body.classList.add('has-tip-portal');
  ensurePortalEl();
  if (bound) return;
  bound = true;

  document.addEventListener('pointerover', (e) => {
    const found = findTipSource(e.target);
    if (!found) {
      if (activeTrigger) hideCardTip();
      return;
    }
    if (found.triggerEl === activeTrigger && document.getElementById('card-tip-layer')?.classList.contains('is-open')) {
      return;
    }
    showTipFor(found.triggerEl, found.tipEl);
  });

  document.addEventListener('pointerout', (e) => {
    if (!activeTrigger) return;
    if (e.relatedTarget && activeTrigger.contains(e.relatedTarget)) return;
    const next = findTipSource(e.relatedTarget);
    if (next) {
      showTipFor(next.triggerEl, next.tipEl);
      return;
    }
    hideCardTip();
  });

  document.addEventListener('focusin', (e) => {
    const found = findTipSource(e.target);
    if (found) showTipFor(found.triggerEl, found.tipEl);
  });

  document.addEventListener('focusout', (e) => {
    if (!activeTrigger) return;
    if (e.relatedTarget && activeTrigger.contains(e.relatedTarget)) return;
    hideCardTip();
  });

  document.addEventListener('pointerdown', () => hideCardTip());
  window.addEventListener('scroll', () => hideCardTip(), true);
  window.addEventListener('resize', () => hideCardTip());
  window.addEventListener('blur', () => hideCardTip());
}
