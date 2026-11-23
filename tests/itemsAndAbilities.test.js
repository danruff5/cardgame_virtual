import { describe, expect, it } from 'vitest';
import { createEmptyState, createHeroRuntime, applyAction } from './helpers.js';
import { gearRuntimeFromId } from '../src/game/state.js';
import { HEROES, EVENTS, MONSTERS } from '../src/data/index.js';

function twoHeroTable() {
  const dealerId = 'dealer-1';
  let state = createEmptyState('TEST', dealerId, 'Dealer');
  state.players.push(
    { id: 'h1', name: 'Robin', role: 'hero', heroId: HEROES[0].id, connected: true },
    { id: 'h2', name: 'Sam', role: 'hero', heroId: HEROES[1].id, connected: true },
  );
  state = applyAction(state, { type: 'pick-hero', playerId: 'h1', heroId: HEROES[0].id }, 'h1').state;
  state = applyAction(state, { type: 'pick-hero', playerId: 'h2', heroId: HEROES[1].id }, 'h2').state;
  state = applyAction(state, { type: 'start-floor', layoutMode: 'fixed' }, dealerId).state;
  return { state, dealerId };
}

function makeClashState({
  heroId = 'H-01',
  weaponId = null,
  offhandId = null,
  armorId = null,
  beltIds = [],
  monsterId = 'MON-01',
  activeSuit = 'brawn',
  activeRank = 3,
  hand = [],
} = {}) {
  const dealerId = 'dealer-1';
  let state = createEmptyState('TEST', dealerId, 'Dealer');
  state.players.push({ id: 'h1', name: 'Hero', role: 'hero', heroId, connected: true });
  state = applyAction(state, { type: 'pick-hero', playerId: 'h1', heroId }, 'h1').state;
  state = applyAction(state, { type: 'start-floor', layoutMode: 'fixed' }, dealerId).state;

  const hero = state.heroes.h1;
  if (weaponId) hero.weapon = gearRuntimeFromId(weaponId);
  if (offhandId) hero.offhand = gearRuntimeFromId(offhandId);
  if (armorId) hero.armor = gearRuntimeFromId(armorId);
  hero.belt = beltIds.map((id) => gearRuntimeFromId(id));
  hero.hand = hand;
  hero.perkUsedThisClash = false;

  const mon = MONSTERS.find((m) => m.id === monsterId) || MONSTERS[0];
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
    monsterHp: mon.hp,
    monsterMaxHp: mon.hp,
    baseDmg: mon.baseDmg,
    cunning: mon.cunning,
    trait: mon.trait,
    traitId: mon.traitId,
    lootText: mon.loot,
    monsterHand: [{ id: 'mh-1', type: 'rank', suit: 'zip', rank: 2, name: 'zip 2' }],
    isBoss: false,
    activeSuit,
    activeRank,
    pile: [{ id: 'lead-1', type: 'rank', suit: activeSuit, rank: activeRank, name: `${activeSuit} ${activeRank}` }],
    topCard: { id: 'lead-1', type: 'rank', suit: activeSuit, rank: activeRank, name: `${activeSuit} ${activeRank}` },
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

describe('Wakey-Wakey Smelling Salts (G-25 / G-26)', () => {
  it('wakes a downed ally in the same room to 4 HP + 4 cards and spends 1 action', () => {
    const { state } = twoHeroTable();
    state.heroes.h1.belt = [gearRuntimeFromId('G-25')];
    state.heroes.h2.downed = true;
    state.heroes.h2.hp = 0;
    state.heroes.h2.hand = [];

    const r = applyAction(
      state,
      { type: 'interact', subtype: 'use-consumable', beltIndex: 0, targetPlayerId: 'h2' },
      'h1',
    );
    expect(r.ok).toBe(true);
    expect(r.state.heroes.h1.belt).toHaveLength(0);
    expect(r.state.heroes.h2.downed).toBe(false);
    expect(r.state.heroes.h2.hp).toBe(4);
    expect(r.state.heroes.h2.hand).toHaveLength(4);
    expect(r.state.explorationActionsLeft).toBe(1);
  });

  it('rejects waking an ally who is in a different room', () => {
    const { state } = twoHeroTable();
    state.heroes.h1.belt = [gearRuntimeFromId('G-26')];
    const otherTile = state.map.tiles.find((t) => t.key !== state.heroes.h1.roomKey);
    state.heroes.h2.roomKey = otherTile.key;
    state.heroes.h2.downed = true;
    state.heroes.h2.hp = 0;

    const r = applyAction(
      state,
      { type: 'interact', subtype: 'use-consumable', beltIndex: 0, targetPlayerId: 'h2' },
      'h1',
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/DOWNED ally in your room/i);
  });
});

describe('Strawberry Fizz Potion (G-27 / G-28) — Anytime (Free)', () => {
  it('heals +4 HP during exploration even with 0 actions left and on another hero turn', () => {
    const { state } = twoHeroTable();
    state.heroes.h2.belt = [gearRuntimeFromId('G-27')];
    state.heroes.h2.hp = 5;
    state.activeHeroIndex = 0; // h1's turn
    state.explorationActionsLeft = 0;

    const r = applyAction(
      state,
      { type: 'interact', subtype: 'use-consumable', beltIndex: 0 },
      'h2',
    );
    expect(r.ok).toBe(true);
    expect(r.state.heroes.h2.hp).toBe(9);
    expect(r.state.heroes.h2.belt).toHaveLength(0);
    expect(r.state.explorationActionsLeft).toBe(0);
  });

  it('rejects drinking at full HP and works free mid-clash', () => {
    const { state } = makeClashState({ beltIds: ['G-28'] });
    const full = applyAction(state, { type: 'clash-use-belt', beltIndex: 0, mode: 'heal' }, 'h1');
    expect(full.ok).toBe(false);

    state.heroes.h1.hp = 4;
    const mid = applyAction(state, { type: 'clash-use-belt', beltIndex: 0, mode: 'heal' }, 'h1');
    expect(mid.ok).toBe(true);
    expect(mid.state.heroes.h1.hp).toBe(8);
    expect(mid.state.heroes.h1.belt).toHaveLength(0);
    expect(mid.state.clash.whoseTurn).toBe('hero');
  });
});

describe('Confetti Smoke Bomb (G-29)', () => {
  it('dazes the monster as a free action without consuming the hero turn', () => {
    const { state } = makeClashState({ beltIds: ['G-29'] });
    const r = applyAction(state, { type: 'clash-use-belt', beltIndex: 0, mode: 'daze' }, 'h1');
    expect(r.ok).toBe(true);
    expect(r.state.clash.monsterDazed).toBe(true);
    expect(r.state.clash.whoseTurn).toBe('hero');
    expect(r.state.heroes.h1.belt).toHaveLength(0);
  });
});

describe('Gear abilities — Mallet / Boom-Hammer / Twin Knives / Armor', () => {
  it('Comically Large Mallet (G-16) Grit attacks bypass MON-02 Rattle Armor', () => {
    const { state } = makeClashState({
      weaponId: 'G-16',
      monsterId: 'MON-02', // 4 HP, rattle-armor
      activeSuit: 'grit',
      activeRank: 2,
      hand: [{ id: 'g5', type: 'rank', suit: 'grit', rank: 5, name: 'grit 5' }],
    });
    const r = applyAction(state, { type: 'clash-play', cardId: 'g5' }, 'h1');
    expect(r.ok).toBe(true);
    expect(r.state.clash.monsterHp).toBe(2); // full 2 strike damage, not absorbed
    expect(r.state.clash.ignoredFirstHit).toBe(false);
  });

  it('Boom-Hammer of Boops (G-19) Blue 4 auto-dazes normal monsters and triggers Three Kobolds swings', () => {
    const { state: s1 } = makeClashState({
      weaponId: 'G-19',
      monsterId: 'MON-03',
      activeSuit: 'grit',
      activeRank: 2,
      hand: [{ id: 'g4', type: 'rank', suit: 'grit', rank: 4, name: 'grit 4' }],
    });
    const r1 = applyAction(s1, { type: 'clash-play', cardId: 'g4' }, 'h1');
    expect(r1.ok).toBe(true);
    expect(r1.state.clash.monsterDazed).toBe(true);

    const { state: s2 } = makeClashState({
      weaponId: 'G-19',
      monsterId: 'MON-08',
      activeSuit: 'grit',
      activeRank: 2,
      hand: [{ id: 'g4', type: 'rank', suit: 'grit', rank: 4, name: 'grit 4' }],
    });
    const r2 = applyAction(s2, { type: 'clash-play', cardId: 'g4' }, 'h1');
    expect(r2.ok).toBe(true);
    expect(r2.state.clash.monsterDazed).toBe(false);
    expect(r2.state.clash.pendingKoboldSwings).toBe(2);
  });

  it('Twin Butter-Knives of Speed (G-13) allows playing a 2nd matching-Rank card or ending early', () => {
    const { state } = makeClashState({
      heroId: 'H-03',
      weaponId: 'G-13',
      monsterId: 'MON-03', // 5 HP
      activeSuit: 'zip',
      activeRank: 2,
      hand: [
        { id: 'z4', type: 'rank', suit: 'zip', rank: 4, name: 'zip 4' },
        { id: 'b4', type: 'rank', suit: 'brawn', rank: 4, name: 'brawn 4' },
      ],
    });
    const first = applyAction(state, { type: 'clash-play', cardId: 'z4' }, 'h1');
    expect(first.ok).toBe(true);
    expect(first.state.clash.monsterHp).toBe(4); // 1 strike
    expect(first.state.clash.twinRank).toBe(4);
    expect(first.state.clash.whoseTurn).toBe('hero');

    const second = applyAction(first.state, { type: 'clash-play', cardId: 'b4' }, 'h1');
    expect(second.ok).toBe(true);
    expect(second.state.clash.monsterHp).toBe(3); // +1 strike from 2nd matching-rank card
    expect(second.state.clash.twinRank).toBeNull();
    expect(second.state.clash.whoseTurn).toBe('monster');

    // Optional early end
    const skip = applyAction(first.state, { type: 'clash-end-twin' }, 'h1');
    expect(skip.ok).toBe(true);
    expect(skip.state.clash.twinRank).toBeNull();
    expect(skip.state.clash.whoseTurn).toBe('monster');
  });

  it('tapped Armor no longer ignores Rank 1-2 monster hits', () => {
    const { state, dealerId } = makeClashState({
      armorId: 'G-15', // ignoreRanks [1, 2]
      monsterId: 'MON-01',
      activeSuit: 'brawn',
      activeRank: 1,
    });
    state.heroes.h1.offhand = null;
    state.heroes.h1.armor.tapped = true;
    state.clash.whoseTurn = 'monster';
    state.clash.monsterHand = [{ id: 'mb2', type: 'rank', suit: 'brawn', rank: 2, name: 'brawn 2' }];
    state.decks.action = [];

    const r = applyAction(state, { type: 'clash-monster-turn' }, dealerId);
    expect(r.ok).toBe(true);
    expect(r.state.heroes.h1.hp).toBe(9);
  });
});

describe('Hero perks — no accidental burn on legal/special plays', () => {
  it('Big Swing (H-01) does not fire on Brawn Special or already-Clean Brawn cards, only upgrades', () => {
    const { state: sSpecial } = makeClashState({
      heroId: 'H-01',
      activeSuit: 'brawn',
      activeRank: 3,
      hand: [{ id: 'd1', type: 'special', kind: 'daze', suit: 'brawn', name: 'Daze!' }],
    });
    const rSpec = applyAction(sSpecial, { type: 'clash-play', cardId: 'd1' }, 'h1');
    expect(rSpec.ok).toBe(true);
    expect(rSpec.state.heroes.h1.perkUsedThisClash).toBe(false);

    const { state: sClean } = makeClashState({
      heroId: 'H-01',
      activeSuit: 'brawn',
      activeRank: 2,
      hand: [{ id: 'b5', type: 'rank', suit: 'brawn', rank: 5, name: 'brawn 5' }],
    });
    const rClean = applyAction(sClean, { type: 'clash-play', cardId: 'b5' }, 'h1');
    expect(rClean.ok).toBe(true);
    expect(rClean.state.heroes.h1.perkUsedThisClash).toBe(false);
    expect(rClean.state.clash.activeRank).toBe(5);

    const { state: sUpgrade } = makeClashState({
      heroId: 'H-01',
      activeSuit: 'brawn',
      activeRank: 3,
      hand: [{ id: 'b3', type: 'rank', suit: 'brawn', rank: 3, name: 'brawn 3' }],
    });
    const rUp = applyAction(sUpgrade, { type: 'clash-play', cardId: 'b3' }, 'h1');
    expect(rUp.ok).toBe(true);
    expect(rUp.state.heroes.h1.perkUsedThisClash).toBe(true);
    expect(rUp.state.clash.activeRank).toBe(5); // 3 + 2 Big Swing rank bonus
  });

  it('Improvised Zap (H-04) does not fire on legal Spark plays, only off-suit Spark plays', () => {
    const { state: sLegal } = makeClashState({
      heroId: 'H-04',
      monsterId: 'MON-03',
      activeSuit: 'spark',
      activeRank: 2,
      hand: [{ id: 'sp5', type: 'rank', suit: 'spark', rank: 5, name: 'spark 5' }],
    });
    const rLegal = applyAction(sLegal, { type: 'clash-play', cardId: 'sp5' }, 'h1');
    expect(rLegal.ok).toBe(true);
    expect(rLegal.state.heroes.h1.perkUsedThisClash).toBe(false);
    expect(rLegal.state.clash.activeRank).toBe(5);

    const { state: sOff } = makeClashState({
      heroId: 'H-04',
      activeSuit: 'brawn',
      activeRank: 3,
      hand: [{ id: 'sp4', type: 'rank', suit: 'spark', rank: 4, name: 'spark 4' }],
    });
    const rOff = applyAction(sOff, { type: 'clash-play', cardId: 'sp4' }, 'h1');
    expect(rOff.ok).toBe(true);
    expect(rOff.state.heroes.h1.perkUsedThisClash).toBe(true);
    expect(rOff.state.clash.activeSuit).toBe('spark');
    expect(rOff.state.clash.activeRank).toBe(2);
  });
});

describe('Second Wind Snack Charm (G-30) on Trap knockouts', () => {
  it('saves a hero from a lethal Trap choice B without discarding their hand', () => {
    const dealerId = 'dealer-1';
    let state = createEmptyState('TEST', dealerId, 'Dealer');
    state.players.push({ id: 'h1', name: 'Solo', role: 'hero', heroId: HEROES[0].id, connected: true });
    state = applyAction(state, { type: 'pick-hero', playerId: 'h1', heroId: HEROES[0].id }, 'h1').state;
    state = applyAction(state, { type: 'start-floor', layoutMode: 'fixed' }, dealerId).state;

    state.heroes.h1.hp = 1;
    state.pending = {
      kind: 'event',
      heroPlayerId: 'h1',
      tileKey: state.map.tiles[0].key,
      event: EVENTS[0], // E-01 B deals 2 Dmg
    };

    const r = applyAction(state, { type: 'resolve-pending', choice: 'b' }, 'h1');
    expect(r.ok).toBe(true);
    expect(r.state.heroes.h1.downed).toBe(false);
    expect(r.state.heroes.h1.hp).toBe(4);
    expect(r.state.heroes.h1.secondWindUsed).toBe(true);
    expect(r.state.heroes.h1.belt.some((b) => b.id === 'G-30')).toBe(false);
    expect(r.state.heroes.h1.hand.length).toBeGreaterThanOrEqual(4);
  });
});
