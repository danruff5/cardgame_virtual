import { createEmptyState, createHeroRuntime, buildFixedSnakeMap } from '../src/game/state.js';
import { prepareFloorDecks } from '../src/game/state.js';
import { applyAction } from '../src/game/authority.js';
import { HEROES } from '../src/data/index.js';

/** Seeded PRNG for deterministic layout tests. */
export function mulberry32(seed) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Minimal exploring floor with fixed snake map + one hero ready to act.
 * Uses real decks so vault/shrine/clash paths have cards.
 */
export function startExploringFloor({
  heroId = HEROES[0].id,
  layoutMode = 'fixed',
  dealerId = 'dealer-1',
  heroPlayerId = 'hero-1',
} = {}) {
  let state = createEmptyState('TEST', dealerId, 'Dealer');
  state.players.push({
    id: heroPlayerId,
    name: 'Test Hero',
    role: 'hero',
    heroId: null,
    connected: true,
    isLocalStub: true,
  });

  let r = applyAction(state, { type: 'pick-hero', playerId: heroPlayerId, heroId }, dealerId);
  if (!r.ok) throw new Error(r.error);
  state = r.state;

  r = applyAction(state, { type: 'start-floor', layoutMode }, dealerId);
  if (!r.ok) throw new Error(r.error);
  return { state: r.state, dealerId, heroPlayerId };
}

/** Place hero on a given tile key without spending actions. */
export function placeHeroOn(state, heroPlayerId, tileKey) {
  const next = structuredClone(state);
  next.heroes[heroPlayerId].roomKey = tileKey;
  const tile = next.map.tiles.find((t) => t.key === tileKey);
  if (tile) {
    tile.faceUp = true;
    tile.cleared = true;
  }
  return next;
}

/** Face-up a tile of a given kind adjacent to current hero room when possible; else teleport. */
export function ensureHeroInKind(state, heroPlayerId, kind) {
  const next = structuredClone(state);
  const tile = next.map.tiles.find((t) => t.kind === kind);
  if (!tile) throw new Error(`No tile kind ${kind}`);
  tile.faceUp = true;
  if (kind !== 'stairs') tile.cleared = true;
  next.heroes[heroPlayerId].roomKey = tile.key;
  next.phase = 'exploring';
  next.clash = null;
  next.pending = null;
  next.explorationActionsLeft = 2;
  next.activeHeroIndex = next.turnOrder.indexOf(heroPlayerId);
  if (next.activeHeroIndex < 0) next.activeHeroIndex = 0;
  return { state: next, tile };
}

export { createEmptyState, createHeroRuntime, buildFixedSnakeMap, prepareFloorDecks, applyAction };
