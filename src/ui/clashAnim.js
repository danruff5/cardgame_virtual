import { renderCardBack } from './cardView.js';

/**
 * Card flights for the clash table.
 *
 * The table is re-rendered from state on every action, so motion is done FLIP-style:
 * capture where every tagged card (`data-fly="c:<cardId>"`) and zone (`data-fly="z:<name>"`)
 * was, re-render, then animate each card from its old spot (or from the deck / a hand)
 * to its new one. Cards that left the table get a short-lived ghost flying to the discard.
 *
 * `data-fly` elements must not carry CSS transforms of their own.
 */

const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_THROW = 'cubic-bezier(0.3, 0.9, 0.35, 1)';

export function prefersReducedMotion() {
  return Boolean(
    typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
}

function canAnimate() {
  return (
    typeof document !== 'undefined' &&
    typeof Element !== 'undefined' &&
    typeof Element.prototype.animate === 'function' &&
    !prefersReducedMotion()
  );
}

/** Where every tagged card / zone currently is on screen. Call right before re-rendering. */
export function captureFly(root) {
  const seen = new Map();
  if (!root) return seen;
  root.querySelectorAll('[data-fly]').forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const key = el.dataset.fly;
    seen.set(key, {
      rect,
      back: el.hasAttribute('data-fly-back'),
      html: key.startsWith('c:') ? el.innerHTML : null,
    });
  });
  return seen;
}

function center(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function hasMoved(a, b) {
  return (
    Math.abs(a.left - b.left) > 1.5 ||
    Math.abs(a.top - b.top) > 1.5 ||
    Math.abs(a.width - b.width) > 1.5
  );
}

/** Transform that makes a box at `to` look like it sits at `from` (transform-origin: center). */
function offsetTransform(from, to) {
  const a = center(from);
  const b = center(to);
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  return `translate(${(a.x - b.x).toFixed(1)}px, ${(a.y - b.y).toFixed(1)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
}

/**
 * Zones (deck, a hand, a seat) are wider than one card. Start a flight from a card-shaped
 * box in the middle of the zone so the card is never stretched to the zone's outline.
 */
function cardBoxIn(zoneRect, cardRect) {
  if (!zoneRect || !cardRect?.width || !cardRect?.height) return zoneRect;
  const aspect = cardRect.height / cardRect.width;
  const height = Math.min(zoneRect.height, zoneRect.width * aspect, cardRect.height);
  const width = height / aspect;
  const mid = center(zoneRect);
  return { left: mid.x - width / 2, top: mid.y - height / 2, width, height };
}

function lift(el, anim) {
  const prevZ = el.style.zIndex;
  el.style.zIndex = '70';
  const settle = () => {
    el.style.zIndex = prevZ;
    el.style.backfaceVisibility = '';
  };
  anim.finished.then(settle, settle);
}

function spawnGhost(layer, rect, html, className = '') {
  const ghost = document.createElement('div');
  ghost.className = `clash-fly-ghost ${className}`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.innerHTML = html;
  layer.appendChild(ghost);
  return ghost;
}

/**
 * Fly `el` from `from` to where it now sits.
 * - flip: it left as a card back and arrives face-up (deck draw, monster play).
 * - slam: it lands on the pile with a little overshoot.
 */
function glide(
  layer,
  el,
  from,
  { delay = 0, duration = 420, flip = false, slam = false, spin = 0, fromZone = false } = {},
) {
  const to = el.getBoundingClientRect();
  if (!to.width || !to.height) return;
  const start = offsetTransform(fromZone ? cardBoxIn(from, to) : from, to);
  const timing = { duration, delay, easing: slam ? EASE_THROW : EASE_OUT, fill: 'backwards' };
  const rest = 'translate(0px, 0px) scale(1, 1)';

  if (flip) {
    el.style.backfaceVisibility = 'hidden';
    lift(
      el,
      el.animate(
        [
          { transform: `${start} rotateY(180deg)` },
          { transform: `${rest} rotateY(0deg)` },
        ],
        timing,
      ),
    );
    const ghost = spawnGhost(layer, to, renderCardBack({ kind: 'action', size: 'hand' }), 'is-back');
    const done = () => ghost.remove();
    ghost
      .animate(
        [
          { transform: `${start} rotateY(0deg)` },
          { transform: `${rest} rotateY(-180deg)` },
        ],
        timing,
      )
      .finished.then(done, done);
    return;
  }

  const frames = slam
    ? [
        { transform: `${start} rotate(${spin}deg)` },
        { transform: 'translate(0px, 0px) scale(1.09, 1.09) rotate(0deg)', offset: 0.78 },
        { transform: `${rest} rotate(0deg)` },
      ]
    : [{ transform: start }, { transform: rest }];
  lift(el, el.animate(frames, timing));
}

/** A card that left the table: its old face drifts to the discard pile and fades. */
function discardGhost(layer, prev, target, delay) {
  const ghost = spawnGhost(layer, prev.rect, prev.html);
  const a = center(prev.rect);
  const b = target ? center(target) : { x: a.x, y: a.y - 40 };
  const done = () => ghost.remove();
  ghost
    .animate(
      [
        { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', opacity: 1 },
        {
          transform: `translate(${(b.x - a.x).toFixed(1)}px, ${(b.y - a.y).toFixed(1)}px) scale(0.45) rotate(-14deg)`,
          opacity: 0,
        },
      ],
      { duration: 480, delay, easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)', fill: 'backwards' },
    )
    .finished.then(done, done);
}

/**
 * Animate the freshly rendered table.
 * @param {HTMLElement} layer   clash layer root (ghosts are appended here)
 * @param {Map} before          captureFly() result from before the re-render (or null)
 * @param {Array} moves         diffClashMoves() / openingDealMoves() output
 * @param {{ baseDelay?: number }} opts
 */
export function playFly(layer, before, moves = [], { baseDelay = 0 } = {}) {
  if (!canAnimate() || !layer) return;
  const seenBefore = before || new Map();
  const now = new Map();
  layer.querySelectorAll('[data-fly]').forEach((el) => now.set(el.dataset.fly, el));

  const zone = (name) =>
    now.get(`z:${name}`)?.getBoundingClientRect() || seenBefore.get(`z:${name}`)?.rect || null;
  const moveFor = new Map(moves.filter((m) => m.cardId).map((m) => [m.cardId, m]));
  const handZone = (where) =>
    where === 'monster' ? zone('monster-hand') : zone(`seat:${String(where).replace('hand:', '')}`);

  let dealt = 0;
  for (const [key, el] of now) {
    if (!key.startsWith('c:')) continue;
    const move = moveFor.get(key.slice(2));
    const prev = seenBefore.get(key);
    const arrivesFaceUp = !el.hasAttribute('data-fly-back');

    if (prev) {
      const to = el.getBoundingClientRect();
      if (!hasMoved(prev.rect, to)) continue;
      const played = move?.type === 'play';
      glide(layer, el, prev.rect, {
        delay: baseDelay,
        duration: played ? 520 : 360,
        slam: played && !(prev.back && arrivesFaceUp),
        flip: prev.back && arrivesFaceUp,
        spin: played ? -10 : 0,
      });
      continue;
    }
    if (!move) continue;

    if (move.type === 'draw') {
      const from = zone('deck');
      if (!from) continue;
      glide(layer, el, from, {
        delay: baseDelay + dealt * 85,
        duration: 460,
        flip: arrivesFaceUp,
        fromZone: true,
      });
      dealt += 1;
    } else if (move.type === 'play') {
      const from = handZone(move.from) || zone('deck');
      if (!from) continue;
      glide(layer, el, from, {
        delay: baseDelay + dealt * 85,
        duration: 540,
        flip: arrivesFaceUp && move.from === 'monster',
        slam: move.from !== 'monster',
        spin: 8,
        fromZone: true,
      });
      dealt += 1;
    }
  }

  let tossed = 0;
  const discard = zone('discard');
  for (const [key, prev] of seenBefore) {
    if (!key.startsWith('c:') || now.has(key) || !prev.html) continue;
    discardGhost(layer, prev, discard, baseDelay + tossed * 70);
    tossed += 1;
  }
}

/**
 * Cleanup: sweep the pile and the monster's hand into the discard.
 * Returns how long the sweep takes (ms) so the caller can time the modal's exit.
 */
export function playCleanupSweep(layer, { delay = 0 } = {}) {
  if (!canAnimate() || !layer) return 0;
  const discard = layer.querySelector('[data-fly="z:discard"]')?.getBoundingClientRect();
  if (!discard) return 0;
  const target = center(discard);
  const cards = layer.querySelectorAll(
    '.clash-pile [data-fly^="c:"], .clash-monster-hand [data-fly^="c:"], .is-downed-seat [data-fly^="c:"]',
  );
  let i = 0;
  cards.forEach((el) => {
    const from = center(el.getBoundingClientRect());
    el.style.zIndex = '70';
    el.animate(
      [
        { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', opacity: 1 },
        {
          transform: `translate(${(target.x - from.x).toFixed(1)}px, ${(target.y - from.y).toFixed(1)}px) scale(0.5) rotate(${i % 2 ? 16 : -16}deg)`,
          opacity: 0,
        },
      ],
      {
        duration: 420,
        delay: delay + i * 55,
        easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)',
        fill: 'both',
      },
    );
    i += 1;
  });
  return i ? delay + 420 + (i - 1) * 55 : 0;
}
