import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createEmptyState,
  applyAction,
  startExploringFloor,
  ensureHeroInKind,
  placeHeroOn,
} from './helpers.js';
import { gearRuntimeFromId, tilesConnect } from '../src/game/state.js';
import { isLegalPlay, classifyPlay } from '../src/game/clash.js';
import {
  RULES,
  HEROES,
  GEAR,
  MONSTERS,
  BOSSES,
  DESPERATION,
  bossHp,
  getGear,
} from '../src/data/index.js';

describe('Shared canonical cards.json integration', () => {
  it('exposes RULES constants and matches canonical d:/Projects/cardgame/data/cards.json when present', () => {
    expect(RULES).toBeTruthy();
    expect(RULES.combatHandTopUp).toBe(5);
    expect(RULES.bossBaseHp).toBe(10);
    expect(RULES.bossHpPerExtraHero).toBe(4);
    expect(RULES.smellingSaltsSoloHeal).toBe(3);
    expect(RULES.shrineReviveConsumesPersonalRest).toBe(false);
    expect(RULES.stairsGroupShrineSweep).toBe(true);
    expect(RULES.theatricalEncoreMessyOnly).toBe(true);
    expect(RULES.theatricalEncoreMaxPerRound).toBe(1);

    const localCardsPath = path.resolve(process.cwd(), 'src/data/cards.json');
    expect(fs.existsSync(localCardsPath)).toBe(true);

    const canonicalPath = 'd:/Projects/cardgame/data/cards.json';
    if (fs.existsSync(canonicalPath)) {
      const a = JSON.parse(fs.readFileSync(localCardsPath, 'utf8'));
      const b = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
      expect(a).toEqual(b);
    }
  });
});

describe('rules_01 — Monster HP trim & Baron Von Boo Theatrical Encore cap', () => {
  it('trims Floor 1 standard Monster HPs by 1 with a 3 HP floor', () => {
    const byId = Object.fromEntries(MONSTERS.map((m) => [m.id, m.hp]));
    expect(byId).toEqual({
      'MON-01': 3,
      'MON-02': 4,
      'MON-03': 5,
      'MON-04': 3,
      'MON-05': 4,
      'MON-06': 3,
      'MON-07': 6,
      'MON-08': 3,
    });
  });

  it('heals Baron Von Boo (+1 HP) only on Messy Desperation and at most once per round', () => {
    const dealerId = 'dealer-1';
    let state = createEmptyState('BOO', dealerId, 'Dealer');
    state.players.push(
      { id: 'h1', name: 'Robin', role: 'hero', heroId: 'H-01', connected: true },
      { id: 'h2', name: 'Sam', role: 'hero', heroId: 'H-02', connected: true },
    );
    state = applyAction(state, { type: 'pick-hero', playerId: 'h1', heroId: 'H-01' }, 'h1').state;
    state = applyAction(state, { type: 'pick-hero', playerId: 'h2', heroId: 'H-02' }, 'h2').state;
    state = applyAction(state, { type: 'set-boss', bossId: 'B-02' }, dealerId).state;
    state = applyAction(state, { type: 'start-floor', layoutMode: 'fixed' }, dealerId).state;

    const bossTile = state.map.tiles.find((t) => t.kind === 'boss');
    bossTile.faceUp = true;
    bossTile.cleared = false;
    state.heroes.h1.roomKey = bossTile.key;
    state.heroes.h2.roomKey = bossTile.key;

    state = applyAction(state, { type: 'start-boss-clash' }, dealerId).state;
    state.clash.monsterHp = 8; // room to heal below 14 max

    const neutralCard = DESPERATION.find((d) => d.id === 'D-16'); // Quick Snack Break (neutral, 0 monster dmg)
    const messyA = DESPERATION.find((d) => d.id === 'D-04'); // Dropped the Sword! (messy, 0 monster dmg)
    const messyB = DESPERATION.find((d) => d.id === 'D-05'); // Dropped the Sword! (messy, 0 monster dmg)
    const messyC = DESPERATION.find((d) => d.id === 'D-06'); // Giant Sneeze! (messy, 0 monster dmg)

    // 1) Neutral Desperation must NOT trigger Theatrical Encore
    state.decks.desperation = [{ ...neutralCard }, { ...messyA }, { ...messyB }, { ...messyC }];
    let r = applyAction(state, { type: 'clash-desperation' }, 'h1');
    expect(r.ok).toBe(true);
    expect(r.state.clash.monsterHp).toBe(8);

    // 2) h2 flips Messy Desperation -> Baron heals +1 HP (8 -> 9)
    r = applyAction(r.state, { type: 'clash-desperation' }, 'h2');
    expect(r.ok).toBe(true);
    expect(r.state.clash.monsterHp).toBe(9);
    expect(r.state.clash.whoseTurn).toBe('monster');

    // Simulate another messy flip in the same round before monster turn resets it
    const sameRound = structuredClone(r.state);
    sameRound.clash.whoseTurn = 'hero';
    sameRound.clash.heroPlayerId = 'h1';
    const rCap = applyAction(sameRound, { type: 'clash-desperation' }, 'h1');
    expect(rCap.ok).toBe(true);
    expect(rCap.state.clash.monsterHp).toBe(9); // Capped at once per round!

    // 3) After Baron takes his Boss turn, the once-per-round cap resets
    r.state.clash.monsterHand = [];
    r.state.decks.action = [];
    const afterBoss = applyAction(r.state, { type: 'clash-monster-turn' }, dealerId);
    expect(afterBoss.ok).toBe(true);
    const activeHeroId = afterBoss.state.clash.heroPlayerId;
    const nextRound = applyAction(afterBoss.state, { type: 'clash-desperation' }, activeHeroId);
    expect(nextRound.ok).toBe(true);
    expect(nextRound.state.clash.monsterHp).toBe(10); // Healed again in new round!
  });
});

describe('rules_02 — Pre-clash Combat Hand top-up to 5 Action cards', () => {
  it('tops up hands below 5 to 5 cards on clash start while keeping 6+ hoarded cards', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const lair = base.map.tiles.find((t) => t.kind === 'monster');
    const adj = base.map.tiles.find((t) => t.key !== lair.key && tilesConnect(lair, t));
    const state = placeHeroOn(base, heroPlayerId, adj.key);
    state.heroes[heroPlayerId].hand = state.heroes[heroPlayerId].hand.slice(0, 2); // only 2 cards
    state.explorationActionsLeft = 2;

    const r = applyAction(state, { type: 'move', x: lair.x, y: lair.y, playerId: heroPlayerId }, dealerId);
    expect(r.ok).toBe(true);
    expect(r.state.heroes[heroPlayerId].hand).toHaveLength(5);

    // Hoarder with 7 cards keeps all 7
    const hoardState = placeHeroOn(base, heroPlayerId, adj.key);
    while (hoardState.heroes[heroPlayerId].hand.length < 7) {
      hoardState.heroes[heroPlayerId].hand.push(hoardState.decks.action.shift());
    }
    const lair2 = hoardState.map.tiles.find((t) => t.key === lair.key);
    lair2.faceUp = false;
    lair2.cleared = false;
    hoardState.explorationActionsLeft = 2;
    const rHoard = applyAction(
      hoardState,
      { type: 'move', x: lair2.x, y: lair2.y, playerId: heroPlayerId },
      dealerId,
    );
    expect(rHoard.ok).toBe(true);
    expect(rHoard.state.heroes[heroPlayerId].hand).toHaveLength(7);
  });
});

describe('rules_03 — Boss HP 10 + 4*(Heroes-1) & Sir Bumbles Big Swing +2 Rank', () => {
  it('computes Boss HP as 10 / 14 / 18 / 22 for 1-4 Heroes', () => {
    expect(bossHp('B-01', 1)).toBe(10);
    expect(bossHp('B-01', 2)).toBe(14);
    expect(bossHp('B-01', 3)).toBe(18);
    expect(bossHp('B-01', 4)).toBe(22);
    expect(bossHp('B-02', 1)).toBe(10);
    expect(bossHp('B-02', 3)).toBe(18);
  });

  it('gives Sir Bumbles +2 Rank on Big Swing for Clean Strikes and off-suit Parries', () => {
    const bumbles = HEROES.find((h) => h.id === 'H-01');
    expect(bumbles.perk.rankBonus).toBe(2);

    const clash = { activeSuit: 'brawn', activeRank: 3 };
    // Brawn 2 + 2 = 4 > 3 -> Clean Strike!
    expect(classifyPlay({ type: 'rank', suit: 'brawn', rank: 2 }, clash, { bigSwing: true })).toBe('clean');

    const offSuitClash = { activeSuit: 'grit', activeRank: 3 };
    // Brawn 1 + 2 = 3 -> legal exact-Rank Parry against Grit 3!
    expect(isLegalPlay({ type: 'rank', suit: 'brawn', rank: 1 }, offSuitClash, { bigSwing: true })).toBe(true);
    expect(classifyPlay({ type: 'rank', suit: 'brawn', rank: 1 }, offSuitClash, { bigSwing: true })).toBe('parry');
  });
});

describe('rules_04 — Sanctuary Shrine revive does not consume rescuer Personal Rest', () => {
  it('lets rescuer revive a DOWNED ally (1 Action) and still take their own +3 HP Rest (1 Action)', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const { state, tile } = ensureHeroInKind(base, heroPlayerId, 'shrine');
    const allyId = 'hero-ally';
    state.players.push({
      id: allyId,
      name: 'Pip',
      role: 'hero',
      heroId: 'H-03',
      connected: true,
      isLocalStub: true,
    });
    state.heroes[allyId] = structuredClone(state.heroes[heroPlayerId]);
    state.heroes[allyId].heroId = 'H-03';
    state.heroes[allyId].name = 'Pip Squeak';
    state.heroes[allyId].downed = true;
    state.heroes[allyId].hp = 0;
    state.heroes[allyId].hand = [];
    state.heroes[allyId].roomKey = tile.key;

    state.heroes[heroPlayerId].hp = 5;
    state.heroes[heroPlayerId].shrineUsedThisFloor = false;
    state.turnOrder = [heroPlayerId, allyId];
    state.activeHeroIndex = 0;
    state.explorationActionsLeft = 2;

    // Action 1: Revive Pip at Shrine
    const r1 = applyAction(
      state,
      { type: 'interact', subtype: 'revive', playerId: heroPlayerId, targetPlayerId: allyId },
      dealerId,
    );
    expect(r1.ok).toBe(true);
    expect(r1.state.heroes[allyId].downed).toBe(false);
    expect(r1.state.heroes[allyId].hp).toBe(5);
    expect(r1.state.heroes[heroPlayerId].shrineUsedThisFloor).toBe(false);
    expect(r1.state.explorationActionsLeft).toBe(1);

    // Action 2: Rescuer takes their own Personal Rest (+3 HP)
    const r2 = applyAction(
      r1.state,
      { type: 'interact', subtype: 'shrine', playerId: heroPlayerId },
      dealerId,
    );
    expect(r2.ok).toBe(true);
    expect(r2.state.heroes[heroPlayerId].hp).toBe(8);
    expect(r2.state.heroes[heroPlayerId].shrineUsedThisFloor).toBe(true);
  });
});

describe('rules_05 — Wakey-Wakey Smelling Salts Solo +3 HP whiff fallback', () => {
  it('allows a 1P Solo Hero to whiff G-25/G-26 as a free +3 HP heal in Exploration and Clash', () => {
    expect(getGear('G-25').soloHeal).toBe(3);
    expect(getGear('G-25').rule).toMatch(/whiff/i);
    expect(getGear('G-25').rule).not.toMatch(/drink/i);

    const { state, heroPlayerId } = startExploringFloor({ layoutMode: 'fixed' });
    state.heroes[heroPlayerId].hp = 5;
    state.heroes[heroPlayerId].belt = [gearRuntimeFromId('G-25')];
    state.explorationActionsLeft = 0; // Free action even at 0 exploration actions!

    const rExplore = applyAction(
      state,
      { type: 'interact', subtype: 'use-consumable', beltIndex: 0 },
      heroPlayerId,
    );
    expect(rExplore.ok).toBe(true);
    expect(rExplore.state.heroes[heroPlayerId].hp).toBe(8);
    expect(rExplore.state.heroes[heroPlayerId].belt).toHaveLength(0);

    // Also works mid-clash in 1P Solo as a free action
    const clashState = structuredClone(state);
    clashState.phase = 'clash';
    clashState.heroes[heroPlayerId].hp = 4;
    clashState.heroes[heroPlayerId].belt = [gearRuntimeFromId('G-26')];
    clashState.clash = {
      roomKey: clashState.heroes[heroPlayerId].roomKey,
      heroPlayerId,
      fighters: [heroPlayerId],
      monsterId: 'MON-01',
      monsterName: 'Sneaky Goblin Intern',
      monsterHp: 3,
      monsterMaxHp: 3,
      whoseTurn: 'hero',
      needsDraw: false,
      activeSuit: 'brawn',
      activeRank: 1,
      pile: [],
      monsterHand: [],
    };
    const rClash = applyAction(
      clashState,
      { type: 'clash-use-belt', beltIndex: 0, mode: 'heal' },
      heroPlayerId,
    );
    expect(rClash.ok).toBe(true);
    expect(rClash.state.heroes[heroPlayerId].hp).toBe(7);
    expect(rClash.state.clash.whoseTurn).toBe('hero');
  });
});

describe('rules_06 — Unlocked Stairs Free Group Descent & Narrative Shrine Sweep', () => {
  it('auto-revives DOWNED allies (5 HP + 4 cards) and grants unused +3 HP Shrine rest on everyone when Shrine is revealed', () => {
    const dealerId = 'dealer-1';
    let state = createEmptyState('SWEEP', dealerId, 'Dealer');
    state.players.push(
      { id: 'h1', name: 'Robin', role: 'hero', heroId: 'H-01', connected: true },
      { id: 'h2', name: 'Sam', role: 'hero', heroId: 'H-02', connected: true },
    );
    state = applyAction(state, { type: 'pick-hero', playerId: 'h1', heroId: 'H-01' }, 'h1').state;
    state = applyAction(state, { type: 'pick-hero', playerId: 'h2', heroId: 'H-02' }, 'h2').state;
    state = applyAction(state, { type: 'start-floor', layoutMode: 'fixed' }, dealerId).state;
    state = applyAction(state, { type: 'unlock-stairs' }, dealerId).state;

    // Reveal Sanctuary Shrine on the explored floor
    const shrine = state.map.tiles.find((t) => t.kind === 'shrine');
    shrine.faceUp = true;
    shrine.cleared = true;

    const stairs = state.map.tiles.find((t) => t.kind === 'stairs');
    // Put h1 already on unlocked stairs with 0 actions left -> free descend-stairs works!
    state.heroes.h1.roomKey = stairs.key;
    state.heroes.h1.hp = 4;
    state.heroes.h1.shrineUsedThisFloor = false;
    state.explorationActionsLeft = 0;

    // Put h2 DOWNED across the map, already used personal Shrine rest earlier
    state.heroes.h2.downed = true;
    state.heroes.h2.hp = 0;
    state.heroes.h2.hand = [];
    state.heroes.h2.shrineUsedThisFloor = true;

    const r = applyAction(state, { type: 'descend-stairs' }, 'h1');
    expect(r.ok).toBe(true);
    expect(r.state.phase).toBe('victory');

    // h1 had unused Shrine rest (+3 -> 7) + Floor checkpoint (+3 -> 10)
    expect(r.state.heroes.h1.hp).toBe(10);
    expect(r.state.heroes.h1.shrineUsedThisFloor).toBe(true);

    // h2 got carried to Shrine for free revive (5 HP + 4 cards), already used personal rest, + Floor checkpoint (+3 -> 8)
    expect(r.state.heroes.h2.downed).toBe(false);
    expect(r.state.heroes.h2.hp).toBe(8);
    expect(r.state.heroes.h2.hand).toHaveLength(4);
  });
});
