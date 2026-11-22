import { describe, expect, it } from 'vitest';
import {
  clashFighters,
  clashSeats,
  snapClash,
  diffClashMoves,
  openingDealMoves,
  clashOutcome,
  closingClashState,
} from '../src/ui/clashMoves.js';

const card = (id, extra = {}) => ({ id, type: 'rank', suit: 'brawn', rank: 2, ...extra });

function tableState({ fighters = ['p1'], turn = 'hero', turnHero = fighters[0] } = {}) {
  const heroes = {};
  for (const pid of ['p1', 'p2', 'p3', 'p4']) {
    heroes[pid] = {
      name: `Hero ${pid}`,
      hp: 10,
      maxHp: 10,
      downed: false,
      hand: [card(`${pid}-a`), card(`${pid}-b`)],
    };
  }
  return {
    phase: 'clash',
    heroes,
    map: { tiles: [{ key: '2,1', kind: 'boss', cleared: false }] },
    clash: {
      roomKey: '2,1',
      monsterId: 'B-01',
      monsterName: 'Sir Clanks-a-Lot',
      heroPlayerId: turnHero,
      fighters,
      whoseTurn: turn,
      monsterHp: 9,
      monsterHand: [card('m1'), card('m2')],
      pile: [card('t1')],
      topCard: card('t1'),
    },
  };
}

describe('clashFighters', () => {
  it('falls back to the turn hero for solo clashes', () => {
    expect(clashFighters({ heroPlayerId: 'p1' })).toEqual(['p1']);
    expect(clashFighters({ heroPlayerId: 'p1', fighters: ['p1', 'p2'] })).toEqual(['p1', 'p2']);
    expect(clashFighters(null)).toEqual([]);
  });
});

describe('clashSeats', () => {
  it('puts a fighting hero at the bottom of their own screen, even off-turn', () => {
    const state = tableState({ fighters: ['p1', 'p2', 'p3'], turnHero: 'p1' });
    const seats = clashSeats(state, false, 'p2');
    expect(seats.mainId).toBe('p2');
    expect(seats.left).toEqual(['p3']);
    expect(seats.right).toEqual(['p1']);
  });

  it('gives the dealer whoever holds the hero turn', () => {
    const state = tableState({ fighters: ['p1', 'p2', 'p3'], turnHero: 'p3' });
    const seats = clashSeats(state, true, 'dealer');
    expect(seats.mainId).toBe('p3');
    expect([...seats.left, ...seats.right].sort()).toEqual(['p1', 'p2']);
  });

  it('seats spectators like the dealer and splits four fighters across both rails', () => {
    const state = tableState({ fighters: ['p1', 'p2', 'p3', 'p4'], turnHero: 'p1' });
    const seats = clashSeats(state, false, 'someone-else');
    expect(seats.mainId).toBe('p1');
    expect(seats.left).toEqual(['p2', 'p4']);
    expect(seats.right).toEqual(['p3']);
  });

  it('has empty rails in a solo clash', () => {
    const seats = clashSeats(tableState(), false, 'p1');
    expect(seats).toMatchObject({ mainId: 'p1', left: [], right: [] });
  });
});

describe('diffClashMoves', () => {
  it('sees a hero play, the replacement draw, and the turn hand-off', () => {
    const before = tableState({ fighters: ['p1', 'p2'] });
    const after = structuredClone(before);
    after.heroes.p1.hand = [card('p1-b'), card('d1')];
    after.clash.pile.push(card('p1-a'));
    after.clash.heroPlayerId = 'p2';

    const moves = diffClashMoves(snapClash(before), snapClash(after));
    expect(moves).toContainEqual({ type: 'play', cardId: 'p1-a', from: 'hand:p1' });
    expect(moves).toContainEqual({ type: 'draw', cardId: 'd1', to: 'hand:p1' });
    expect(moves.at(-1)).toEqual({ type: 'turn', who: 'hero', heroId: 'p2' });
  });

  it('attributes a monster play to the monster hand', () => {
    const before = tableState({ turn: 'monster' });
    const after = structuredClone(before);
    after.clash.monsterHand = [card('m2'), card('m3')];
    after.clash.pile.push(card('m1'));
    after.clash.whoseTurn = 'hero';

    const moves = diffClashMoves(snapClash(before), snapClash(after));
    expect(moves).toContainEqual({ type: 'play', cardId: 'm1', from: 'monster' });
    expect(moves).toContainEqual({ type: 'draw', cardId: 'm3', to: 'monster' });
    expect(moves).toContainEqual({ type: 'turn', who: 'hero', heroId: 'p1' });
  });

  it('treats a card drawn and played in one action as coming from the mover', () => {
    const before = tableState({ turn: 'monster' });
    const after = structuredClone(before);
    after.clash.pile.push(card('fresh'));
    const moves = diffClashMoves(snapClash(before), snapClash(after));
    expect(moves).toContainEqual({ type: 'play', cardId: 'fresh', from: 'monster' });
  });

  it('reports discards, Desperation flips and joiners', () => {
    const before = tableState({ fighters: ['p1'] });
    const after = structuredClone(before);
    after.heroes.p1.hand = [card('p1-b')];
    after.clash.lastDesperation = { id: 'D-07' };
    after.clash.fighters = ['p1', 'p2'];

    const moves = diffClashMoves(snapClash(before), snapClash(after));
    expect(moves).toContainEqual({ type: 'discard', cardId: 'p1-a', from: 'hand:p1' });
    expect(moves).toContainEqual({ type: 'desperation', cardId: 'D-07' });
    expect(moves).toContainEqual({ type: 'join', heroId: 'p2' });
    expect(moves.filter((m) => m.type === 'draw').map((m) => m.cardId)).toEqual(['p2-a', 'p2-b']);
  });

  it('is empty when nothing changed or the clash is a different one', () => {
    const state = tableState();
    expect(diffClashMoves(snapClash(state), snapClash(state))).toEqual([]);
    const other = structuredClone(state);
    other.clash.roomKey = '9,9';
    expect(diffClashMoves(snapClash(state), snapClash(other))).toEqual([]);
    expect(diffClashMoves(null, snapClash(state))).toEqual([]);
  });
});

describe('openingDealMoves', () => {
  it('deals every starting card off the deck and leads from the monster', () => {
    const moves = openingDealMoves(snapClash(tableState({ fighters: ['p1', 'p2'] })));
    expect(moves.filter((m) => m.type === 'draw')).toHaveLength(6);
    expect(moves.at(-1)).toEqual({ type: 'play', cardId: 't1', from: 'monster' });
  });
});

describe('clashOutcome / closingClashState', () => {
  it('reads victory from the room being cleared and lands the finishing card', () => {
    const before = tableState({ fighters: ['p1', 'p2'] });
    const after = structuredClone(before);
    after.phase = 'exploring';
    after.clash = null;
    after.map.tiles[0].cleared = true;
    after.heroes.p1.hand = [card('p1-b')];

    expect(clashOutcome(before, after)).toBe('victory');
    const closing = closingClashState(before, after, 'victory');
    expect(closing.clash.monsterHp).toBe(0);
    expect(closing.clash.pile.at(-1).id).toBe('p1-a');
    expect(closing.heroes.p1.hand.map((c) => c.id)).toEqual(['p1-b']);
    expect(before.clash.pile).toHaveLength(1);
  });

  it('reads a newly DOWNED fighter as a loss and carries the final HP', () => {
    const before = tableState({ fighters: ['p1', 'p2'] });
    const after = structuredClone(before);
    after.phase = 'exploring';
    after.clash = null;
    after.heroes.p2.hp = 0;
    after.heroes.p2.downed = true;

    expect(clashOutcome(before, after)).toBe('downed');
    const closing = closingClashState(before, after, 'downed');
    expect(closing.heroes.p2).toMatchObject({ hp: 0, downed: true });
    expect(closing.clash.monsterHp).toBe(9);
  });

  it('reads anything else as a flee, and a finished floor as a plain close', () => {
    const before = tableState();
    const fled = { ...structuredClone(before), phase: 'exploring', clash: null };
    expect(clashOutcome(before, fled)).toBe('flee');
    expect(clashOutcome(before, { ...fled, phase: 'victory' })).toBe('ended');
    expect(clashOutcome({ clash: null }, fled)).toBe('ended');
  });
});
