import { describe, expect, it } from 'vitest';
import { createEmptyState, applyAction } from './helpers.js';
import { HEROES, DESPERATION, MONSTERS } from '../src/data/index.js';
import { gearRuntimeFromId } from '../src/game/state.js';

function clashWithDesperation(cardId, { heroHp = 10, monsterId = 'MON-01', weaponId = null } = {}) {
  const dealerId = 'dealer-1';
  let state = createEmptyState('TEST', dealerId, 'Dealer');
  state.players.push({ id: 'h1', name: 'Hero', role: 'hero', heroId: HEROES[0].id, connected: true });
  state = applyAction(state, { type: 'pick-hero', playerId: 'h1', heroId: HEROES[0].id }, 'h1').state;
  state = applyAction(state, { type: 'start-floor', layoutMode: 'fixed' }, dealerId).state;

  const hero = state.heroes.h1;
  hero.hp = heroHp;
  if (weaponId) hero.weapon = gearRuntimeFromId(weaponId);

  const mon = MONSTERS.find((m) => m.id === monsterId) || MONSTERS[0];
  const despCard = DESPERATION.find((d) => d.id === cardId);
  state.decks.desperation = [{ ...despCard }];
  state.phase = 'clash';
  state.clash = {
    roomKey: hero.roomKey,
    heroPlayerId: 'h1',
    fighters: ['h1'],
    fighterIndex: 0,
    turnOrderDir: 1,
    heroTurnsSinceBoss: 0,
    bossEvery: 1,
    monsterId: mon.id,
    monsterName: mon.name,
    monsterHp: 8,
    monsterMaxHp: 8,
    baseDmg: mon.baseDmg,
    cunning: mon.cunning,
    trait: mon.trait,
    traitId: mon.traitId,
    lootText: mon.loot,
    monsterHand: [],
    isBoss: false,
    activeSuit: 'brawn',
    activeRank: 4,
    pile: [],
    topCard: null,
    whoseTurn: 'hero',
    needsDraw: false,
    heroDazed: false,
    monsterDazed: false,
    ignoredFirstHit: false,
    usedDesperation: false,
    negateNextMonsterHit: false,
    pendingKoboldSwings: 0,
    twinRank: null,
  };
  return { state, dealerId };
}

describe('Desperation Deck D-01..D-20 (virtual_02)', () => {
  it('D-01..D-03 Banana-Peel Lunge deals 1 dmg to monster, 1 to hero, rank 1', () => {
    for (const id of ['D-01', 'D-02', 'D-03']) {
      const { state } = clashWithDesperation(id);
      const r = applyAction(state, { type: 'clash-desperation', dealerSuit: 'zip' }, 'h1');
      expect(r.ok).toBe(true);
      expect(r.state.clash.monsterHp).toBe(7);
      expect(r.state.heroes.h1.hp).toBe(9);
      expect(r.state.clash.activeSuit).toBe('zip');
      expect(r.state.clash.activeRank).toBe(1);
    }
  });

  it('D-04..D-05 Dropped the Sword deals 2 dmg to hero and draws a Twist', () => {
    for (const id of ['D-04', 'D-05']) {
      const { state } = clashWithDesperation(id);
      const twistsBefore = state.decks.twistHand.length;
      const r = applyAction(state, { type: 'clash-desperation' }, 'h1');
      expect(r.ok).toBe(true);
      expect(r.state.heroes.h1.hp).toBe(8);
      expect(r.state.clash.monsterHp).toBe(8);
      expect(r.state.decks.twistHand.length).toBe(twistsBefore + 1);
    }
  });

  it('D-06..D-07 Giant Sneeze gives 1 Cramp, monster +2 cards, rank 2', () => {
    for (const id of ['D-06', 'D-07']) {
      const { state } = clashWithDesperation(id);
      const r = applyAction(state, { type: 'clash-desperation', dealerSuit: 'spark' }, 'h1');
      expect(r.ok).toBe(true);
      expect(r.state.heroes.h1.hand.some((c) => c.type === 'cramp')).toBe(true);
      expect(r.state.clash.monsterHand.length).toBe(2);
      expect(r.state.clash.activeRank).toBe(2);
    }
  });

  it('D-08..D-09 Tangled Shoelaces discards 1 existing card BEFORE adding 1 Cramp (never discards the new Cramp)', () => {
    for (const id of ['D-08', 'D-09']) {
      for (let iter = 0; iter < 20; iter += 1) {
        const { state } = clashWithDesperation(id);
        const beforeCount = state.heroes.h1.hand.length;
        const r = applyAction(state, { type: 'clash-desperation' }, 'h1');
        expect(r.ok).toBe(true);
        const crampCount = r.state.heroes.h1.hand.filter((c) => c.type === 'cramp').length;
        expect(crampCount).toBe(1);
        expect(r.state.heroes.h1.hand).toHaveLength(beforeCount); // -1 existing + 1 Cramp
        expect(r.state.clash.monsterHp).toBe(8);
      }

      // 1-card-hand edge case: that 1 card is discarded and replaced by 1 Cramp!
      const { state: oneCardState } = clashWithDesperation(id);
      oneCardState.heroes.h1.hand = [oneCardState.heroes.h1.hand[0]];
      const rOne = applyAction(oneCardState, { type: 'clash-desperation' }, 'h1');
      expect(rOne.ok).toBe(true);
      expect(rOne.state.heroes.h1.hand).toHaveLength(1);
      expect(rOne.state.heroes.h1.hand[0].type).toBe('cramp');
    }
  });

  it('D-10..D-11 Wardrobe Malfunction taps shield/armor and deals 1 dmg to monster', () => {
    for (const id of ['D-10', 'D-11']) {
      const { state } = clashWithDesperation(id);
      const r = applyAction(state, { type: 'clash-desperation' }, 'h1');
      expect(r.ok).toBe(true);
      expect(r.state.heroes.h1.offhand.tapped).toBe(true);
      expect(r.state.clash.monsterHp).toBe(7);
      expect(r.state.clash.activeRank).toBe(2);
    }
  });

  it('D-12 Boo-Boo Backfire hurts hero 2, heals monster 1, sets Spark 3', () => {
    const { state } = clashWithDesperation('D-12');
    state.clash.monsterHp = 5;
    const r = applyAction(state, { type: 'clash-desperation' }, 'h1');
    expect(r.ok).toBe(true);
    expect(r.state.heroes.h1.hp).toBe(8);
    expect(r.state.clash.monsterHp).toBe(6);
    expect(r.state.clash.activeSuit).toBe('spark');
    expect(r.state.clash.activeRank).toBe(3);
  });

  it('D-13 Brave Backward Sprint swaps 2 unflipped rooms or draws twist', () => {
    const { state } = clashWithDesperation('D-13');
    const r = applyAction(state, { type: 'clash-desperation', swapRooms: true }, 'h1');
    expect(r.ok).toBe(true);
    expect(r.state.clash.monsterHp).toBe(8);
    expect(r.state.heroes.h1.hp).toBe(10);
    expect(r.state.log.some((l) => l.includes('swaps 2 unflipped rooms'))).toBe(true);
  });

  it('D-14..D-15 Lucky Elbow Poke deals 1 dmg and hero picks suit', () => {
    for (const id of ['D-14', 'D-15']) {
      const { state } = clashWithDesperation(id);
      const r = applyAction(state, { type: 'clash-desperation', chosenSuit: 'grit' }, 'h1');
      expect(r.ok).toBe(true);
      expect(r.state.clash.monsterHp).toBe(7);
      expect(r.state.heroes.h1.hp).toBe(10);
      expect(r.state.clash.activeSuit).toBe('grit');
      expect(r.state.clash.activeRank).toBe(1);
    }
  });

  it('D-16..D-17 Quick Snack Break heals 1 HP and draws 1 Action card', () => {
    for (const id of ['D-16', 'D-17']) {
      const { state } = clashWithDesperation(id, { heroHp: 7 });
      const handBefore = state.heroes.h1.hand.length;
      const r = applyAction(state, { type: 'clash-desperation' }, 'h1');
      expect(r.ok).toBe(true);
      expect(r.state.heroes.h1.hp).toBe(8);
      expect(r.state.heroes.h1.hand.length).toBe(handBefore + 1);
    }
  });

  it('D-18 Panicked Duck sets negateNextMonsterHit without hurting hero', () => {
    const { state } = clashWithDesperation('D-18');
    const r = applyAction(state, { type: 'clash-desperation', chosenSuit: 'zip' }, 'h1');
    expect(r.ok).toBe(true);
    expect(r.state.heroes.h1.hp).toBe(10);
    expect(r.state.clash.negateNextMonsterHit).toBe(true);
    expect(r.state.clash.activeRank).toBe(2);
  });

  it('D-19 Accidental Mega-Crit deals Weapon Strike + 2 Dmg ignoring Armor', () => {
    const { state } = clashWithDesperation('D-19', { monsterId: 'MON-02', weaponId: 'G-21' }); // strike 3 + 2 = 5
    const r = applyAction(state, { type: 'clash-desperation' }, 'h1');
    expect(r.ok).toBe(true);
    expect(r.state.clash.monsterHp).toBe(3); // 8 - 5
    expect(r.state.heroes.h1.hp).toBe(10);
  });

  it('D-20 Wait, What is in My Pocket deals 1 dmg and grants a Belt Consumable', () => {
    const { state } = clashWithDesperation('D-20');
    state.heroes.h1.belt = [];
    const r = applyAction(state, { type: 'clash-desperation' }, 'h1');
    expect(r.ok).toBe(true);
    expect(r.state.clash.monsterHp).toBe(7);
    expect(r.state.heroes.h1.belt.length).toBe(1);
  });
});
