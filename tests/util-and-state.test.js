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
    state.decks.merchants = [{ id: 'M-01' }];

    const view = publicStateFor(state, 'h1');
    expect(view.heroes.h1.hand[0].suit).toBe('brawn');
    expect(view.heroes.h2.hand[0].hidden).toBe(true);
    expect(view.heroes.h2.hand[0].suit).toBeUndefined();
    expect(view.decks.actionCount).toBe(2);
    expect(view.decks.action).toBeUndefined();
    expect(view.decks.merchantsCount).toBe(1);
    expect(view.decks.storyMerchantCount).toBeUndefined();
    expect(view.storyStack).toBeUndefined();
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
    expect(inv.merchants).toBe(2);
    expect(inv.stories).toBe(6);
  });

  it('keeps publicStateFor under 12 KB even with 4 heroes and 40-card clash pile (virtual_01)', () => {
    const state = createEmptyState('BIG', 'dealer-1', 'Dealer');
    for (let i = 0; i < 4; i += 1) {
      const pid = `h${i + 1}`;
      state.players.push({ id: pid, name: `Hero ${i + 1}`, role: 'hero', heroId: HEROES[i].id, connected: true });
      state.heroes[pid] = createHeroRuntime(HEROES[i].id);
      state.heroes[pid].hand = Array.from({ length: 8 }, (_, k) => ({
        id: `${pid}-c${k}`,
        type: 'rank',
        suit: 'brawn',
        rank: 3,
        name: 'brawn 3',
        rule: 'Verbose rule text that should be stripped',
        flavor: 'Verbose flavor text that should be stripped',
      }));
    }
    state.map.tiles = Array.from({ length: 14 }, (_, idx) => ({
      key: `t-${idx}-0`,
      x: idx,
      y: 0,
      roomId: 'R-04',
      kind: 'monster',
      name: 'Monster Lair',
      faceUp: true,
      cleared: false,
      rule: 'Very long static rule string repeated on every tile',
      flavor: 'Very long static flavor string repeated on every tile',
    }));
    state.log = Array.from({ length: 40 }, (_, i) => `Log entry ${i}: something verbose happened in the dungeon!`);
    state.clash = {
      roomKey: 't-0-0',
      heroPlayerId: 'h1',
      fighters: ['h1', 'h2', 'h3', 'h4'],
      monsterId: 'B-01',
      monsterName: 'Sir Clanks-a-Lot',
      monsterHp: 12,
      monsterMaxHp: 21,
      monsterHand: [{ id: 'm1' }, { id: 'm2' }],
      pile: Array.from({ length: 40 }, (_, i) => ({
        id: `pile-${i}`,
        type: 'rank',
        suit: 'grit',
        rank: (i % 6) + 1,
        name: `grit ${(i % 6) + 1}`,
      })),
      topCard: { id: 'pile-39', type: 'rank', suit: 'grit', rank: 4, name: 'grit 4' },
    };

    const view = publicStateFor(state, 'h1');
    const jsonSize = JSON.stringify(view).length;
    expect(jsonSize).toBeLessThan(12000);
    expect(view.clash.pile).toHaveLength(6);
    expect(view.clash.pileCount).toBe(40);
    expect(view.log).toHaveLength(20);
    expect(view.map.tiles[0].rule).toBeUndefined();
  });
});
