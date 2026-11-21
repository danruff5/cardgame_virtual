import { describe, expect, it } from 'vitest';
import { shuffle, uid, makeRoomCode, peerIdForRoom } from '../src/game/util.js';
import { createEmptyState, publicStateFor, createHeroRuntime } from '../src/game/state.js';
import { dataInventory, HEROES } from '../src/data/index.js';
import { mulberry32 } from './helpers.js';

describe('util', () => {
  it('shuffles deterministically with a seeded rng', () => {
    const a = shuffle([1, 2, 3, 4, 5], mulberry32(1));
    const b = shuffle([1, 2, 3, 4, 5], mulberry32(1));
    expect(a).toEqual(b);
    expect(a).toHaveLength(5);
    expect(new Set(a).size).toBe(5);
  });

  it('builds room peer ids', () => {
    expect(peerIdForRoom('ab12')).toBe('cbc-AB12');
    expect(makeRoomCode()).toMatch(/^[A-Z2-9]{4}$/);
    expect(uid('x')).toMatch(/^x-/);
  });
});

describe('publicStateFor privacy', () => {
  it('hides other heroes hands from a hero viewer', () => {
    const state = createEmptyState('ROOM', 'dealer-1', 'Dealer');
    state.players.push(
      { id: 'h1', name: 'A', role: 'hero', heroId: HEROES[0].id, connected: true },
      { id: 'h2', name: 'B', role: 'hero', heroId: HEROES[1].id, connected: true },
    );
    state.heroes.h1 = createHeroRuntime(HEROES[0].id);
    state.heroes.h2 = createHeroRuntime(HEROES[1].id);
    state.heroes.h1.hand = [{ id: 'c1', type: 'rank', suit: 'brawn', rank: 3 }];
    state.heroes.h2.hand = [{ id: 'c2', type: 'rank', suit: 'zip', rank: 5 }];
    state.decks.action = [{ id: 'a1' }, { id: 'a2' }];

    const view = publicStateFor(state, 'h1');
    expect(view.heroes.h1.hand[0].suit).toBe('brawn');
    expect(view.heroes.h2.hand[0].hidden).toBe(true);
    expect(view.heroes.h2.hand[0].suit).toBeUndefined();
    expect(view.decks.actionCount).toBe(2);
    expect(view.decks.action).toBeUndefined();
  });

  it('gives dealer full decks', () => {
    const state = createEmptyState('ROOM', 'dealer-1', 'Dealer');
    state.decks.action = [{ id: 'a1' }];
    const view = publicStateFor(state, 'dealer-1');
    expect(view.decks.action).toHaveLength(1);
    expect(view.decks.actionCount).toBe(1);
  });
});

describe('data inventory vs design counts', () => {
  it('matches documented Floor 1 catalog sizes', () => {
    const inv = dataInventory();
    expect(inv.heroes).toBe(4);
    expect(inv.actionDeck).toBe(68);
    expect(inv.cramp).toBe(12);
    expect(inv.desperation).toBe(20);
    expect(inv.defaultFloorTiles).toBe(14);
    expect(inv.monsters).toBeGreaterThanOrEqual(8);
    expect(inv.bosses).toBeGreaterThanOrEqual(2);
    expect(inv.events).toBe(6);
  });
});
