import { describe, expect, it } from 'vitest';
import {
  applyAction,
  startExploringFloor,
  ensureHeroInKind,
  placeHeroOn,
} from './helpers.js';
import { tilesConnect } from '../src/game/mapLayout.js';
import { MERCHANTS, EVENTS, STORIES } from '../src/data/index.js';
import { createEmptyState, gearRuntimeFromId } from '../src/game/state.js';

describe('start-floor bootstrap', () => {
  it('deals 4 action cards, 2 exploration actions, and places heroes on entrance', () => {
    const { state, heroPlayerId } = startExploringFloor({ layoutMode: 'fixed' });
    expect(state.phase).toBe('exploring');
    expect(state.explorationActionsLeft).toBe(2);
    expect(state.map.tiles).toHaveLength(14);
    const hero = state.heroes[heroPlayerId];
    expect(hero.hand).toHaveLength(4);
    expect(hero.hp).toBe(10);
    expect(hero.shrineUsedThisFloor).toBe(false);
    const entrance = state.map.tiles.find((t) => t.kind === 'entrance');
    expect(hero.roomKey).toBe(entrance.key);
    expect(state.floor.stairsUnlocked).toBe(false);
  });
});

describe('exploration move & room reveal', () => {
  it('moves orthogonally into an adjacent connected room and spends 1 action', () => {
    const { state, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const hero = state.heroes[heroPlayerId];
    const from = state.map.tiles.find((t) => t.key === hero.roomKey);
    const neighbor = state.map.tiles.find(
      (t) => t.key !== from.key && tilesConnect(from, t),
    );
    expect(neighbor).toBeTruthy();

    const r = applyAction(
      state,
      { type: 'move', x: neighbor.x, y: neighbor.y, playerId: heroPlayerId },
      dealerId,
    );
    expect(r.ok).toBe(true);
    expect(r.state.heroes[heroPlayerId].roomKey).toBe(neighbor.key);
    expect(r.state.map.tiles.find((t) => t.key === neighbor.key).faceUp).toBe(true);
  });

  it('rejects diagonal and non-adjacent moves', () => {
    const { state, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const from = state.map.tiles.find((t) => t.key === state.heroes[heroPlayerId].roomKey);
    const r = applyAction(
      state,
      { type: 'move', x: from.x + 1, y: from.y + 1, playerId: heroPlayerId },
      dealerId,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/orthogonally/i);
  });

  it('revealing a monster lair starts clash and zeroes remaining exploration actions', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    // Put hero on a face-up cleared tile adjacent to a face-down monster
    const monster = base.map.tiles.find((t) => t.kind === 'monster');
    const adj = base.map.tiles.find(
      (t) => t.key !== monster.key && tilesConnect(monster, t),
    );
    let state = placeHeroOn(base, heroPlayerId, adj.key);
    // Ensure monster still face-down for reveal
    const m = state.map.tiles.find((t) => t.key === monster.key);
    m.faceUp = false;
    m.cleared = false;
    state.explorationActionsLeft = 2;
    state.phase = 'exploring';
    state.clash = null;

    const r = applyAction(
      state,
      { type: 'move', x: monster.x, y: monster.y, playerId: heroPlayerId },
      dealerId,
    );
    expect(r.ok).toBe(true);
    expect(r.state.phase).toBe('clash');
    expect(r.state.clash).toBeTruthy();
    expect(r.state.clash.heroPlayerId).toBe(heroPlayerId);
    expect(r.state.explorationActionsLeft).toBe(0);
    expect(r.state.map.tiles.find((t) => t.key === monster.key).faceUp).toBe(true);
  });

  it('revealing a trap opens an event pending prompt', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const trap = base.map.tiles.find((t) => t.kind === 'trap');
    const adj = base.map.tiles.find((t) => t.key !== trap.key && tilesConnect(trap, t));
    let state = placeHeroOn(base, heroPlayerId, adj.key);
    const t = state.map.tiles.find((t) => t.key === trap.key);
    t.faceUp = false;
    t.cleared = false;
    t.eventResolved = false;
    state.explorationActionsLeft = 2;

    const r = applyAction(
      state,
      { type: 'move', x: trap.x, y: trap.y, playerId: heroPlayerId },
      dealerId,
    );
    expect(r.ok).toBe(true);
    expect(r.state.pending?.kind).toBe('event');
    expect(r.state.pending.event).toBeTruthy();
  });

  it('revealing vault/shrine marks cleared without starting clash', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    for (const kind of ['vault', 'shrine']) {
      const tile = base.map.tiles.find((t) => t.kind === kind);
      const adj = base.map.tiles.find((t) => t.key !== tile.key && tilesConnect(tile, t));
      let state = placeHeroOn(base, heroPlayerId, adj.key);
      const target = state.map.tiles.find((t) => t.key === tile.key);
      target.faceUp = false;
      target.cleared = false;
      state.explorationActionsLeft = 2;
      state.phase = 'exploring';
      state.clash = null;
      state.pending = null;

      const r = applyAction(
        state,
        { type: 'move', x: tile.x, y: tile.y, playerId: heroPlayerId },
        dealerId,
      );
      expect(r.ok).toBe(true);
      expect(r.state.phase).toBe('exploring');
      expect(r.state.clash).toBeNull();
      const revealed = r.state.map.tiles.find((t) => t.key === tile.key);
      expect(revealed.faceUp).toBe(true);
      expect(revealed.cleared).toBe(true);
    }
  });
});

describe('vault interact (rulebook §3)', () => {
  it('draws 2 loot, keep 1, marks vault looted', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const { state, tile } = ensureHeroInKind(base, heroPlayerId, 'vault');
    tile.looted = false;
    expect(state.decks.loot.length).toBeGreaterThanOrEqual(2);

    let r = applyAction(
      state,
      { type: 'interact', subtype: 'vault', playerId: heroPlayerId },
      dealerId,
    );
    expect(r.ok).toBe(true);
    expect(r.state.pending?.kind).toBe('vault');
    expect(r.state.pending.options).toHaveLength(2);
    expect(r.state.explorationActionsLeft).toBe(1);

    const keepName = r.state.pending.options[0].name;
    r = applyAction(r.state, { type: 'resolve-pending', keepIndex: 0 }, dealerId);
    expect(r.ok).toBe(true);
    expect(r.state.pending).toBeNull();
    expect(r.state.map.tiles.find((t) => t.key === tile.key).looted).toBe(true);
    expect(r.state.log.some((line) => line.includes(keepName))).toBe(true);
  });

  it('rejects a second loot on the same vault', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const { state, tile } = ensureHeroInKind(base, heroPlayerId, 'vault');
    tile.looted = true;
    const r = applyAction(
      state,
      { type: 'interact', subtype: 'vault', playerId: heroPlayerId },
      dealerId,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already emptied/i);
  });
});

describe('sanctuary shrine', () => {
  it('heals +3 HP once per hero per floor', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    let { state } = ensureHeroInKind(base, heroPlayerId, 'shrine');
    state.heroes[heroPlayerId].hp = 5;

    let r = applyAction(
      state,
      { type: 'interact', subtype: 'shrine', playerId: heroPlayerId },
      dealerId,
    );
    expect(r.ok).toBe(true);
    expect(r.state.heroes[heroPlayerId].hp).toBe(8);
    expect(r.state.heroes[heroPlayerId].shrineUsedThisFloor).toBe(true);

    // Reset actions to attempt second rest
    r.state.explorationActionsLeft = 2;
    r.state.phase = 'exploring';
    r = applyAction(
      r.state,
      { type: 'interact', subtype: 'shrine', playerId: heroPlayerId },
      dealerId,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Already rested/i);
  });

  it('revives a DOWNED ally in the shrine room to 5 HP + 4 cards', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    // Add second hero seat mid-floor by cloning runtime onto a stub id
    let { state, tile } = ensureHeroInKind(base, heroPlayerId, 'shrine');
    const allyId = 'hero-ally';
    state.players.push({
      id: allyId,
      name: 'Ally',
      role: 'hero',
      heroId: state.players.find((p) => p.id === heroPlayerId).heroId,
      connected: true,
      isLocalStub: true,
    });
    state.heroes[allyId] = structuredClone(state.heroes[heroPlayerId]);
    state.heroes[allyId].name = 'Ally';
    state.heroes[allyId].downed = true;
    state.heroes[allyId].hp = 0;
    state.heroes[allyId].hand = [];
    state.heroes[allyId].roomKey = tile.key;
    state.heroes[allyId].shrineUsedThisFloor = false;
    state.heroes[heroPlayerId].shrineUsedThisFloor = false;
    state.turnOrder = [heroPlayerId, allyId];
    state.activeHeroIndex = 0;
    state.explorationActionsLeft = 2;

    const r = applyAction(
      state,
      {
        type: 'interact',
        subtype: 'revive',
        playerId: heroPlayerId,
        targetPlayerId: allyId,
      },
      dealerId,
    );
    expect(r.ok).toBe(true);
    const ally = r.state.heroes[allyId];
    expect(ally.downed).toBe(false);
    expect(ally.hp).toBe(5);
    expect(ally.hand).toHaveLength(4);
  });
});

describe('stairs unlock & floor descent', () => {
  it('locked stairs do not end the floor on reveal/step', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const stairs = base.map.tiles.find((t) => t.kind === 'stairs');
    const adj = base.map.tiles.find((t) => t.key !== stairs.key && tilesConnect(stairs, t));
    let state = placeHeroOn(base, heroPlayerId, adj.key);
    const st = state.map.tiles.find((t) => t.key === stairs.key);
    st.faceUp = false;
    st.locked = true;
    state.floor.stairsUnlocked = false;
    state.explorationActionsLeft = 2;

    const r = applyAction(
      state,
      { type: 'move', x: stairs.x, y: stairs.y, playerId: heroPlayerId },
      dealerId,
    );
    expect(r.ok).toBe(true);
    expect(r.state.phase).toBe('exploring');
    expect(r.state.floor.stairsUnlocked).toBe(false);
  });

  it('dealer unlock-stairs opens stair tiles and sets shiny key', () => {
    const { state, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const r = applyAction(state, { type: 'unlock-stairs', reason: 'test key' }, dealerId);
    expect(r.ok).toBe(true);
    expect(r.state.floor.stairsUnlocked).toBe(true);
    expect(r.state.floor.shinyKey).toBe(true);
    const stairs = r.state.map.tiles.find((t) => t.kind === 'stairs');
    expect(stairs.locked).toBe(false);
    expect(stairs.faceUp).toBe(true);
  });

  it('stepping on unlocked stairs finishes the floor with +3 heal checkpoint', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    let { state, tile } = ensureHeroInKind(base, heroPlayerId, 'stairs');
    // Put hero adjacent then unlock and step
    const adj = state.map.tiles.find((t) => t.key !== tile.key && tilesConnect(tile, t));
    state = placeHeroOn(state, heroPlayerId, adj.key);
    state.heroes[heroPlayerId].hp = 6;
    let r = applyAction(state, { type: 'unlock-stairs' }, dealerId);
    state = r.state;
    const stairs = state.map.tiles.find((t) => t.kind === 'stairs');
    state.explorationActionsLeft = 2;
    state.phase = 'exploring';
    state.activeHeroIndex = state.turnOrder.indexOf(heroPlayerId);

    r = applyAction(
      state,
      { type: 'move', x: stairs.x, y: stairs.y, playerId: heroPlayerId },
      dealerId,
    );
    expect(r.ok).toBe(true);
    expect(r.state.phase).toBe('victory');
    expect(r.state.heroes[heroPlayerId].hp).toBe(9); // 6 + 3
  });

  it('boss clash victory unlocks stairs', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const { state } = ensureHeroInKind(base, heroPlayerId, 'boss');
    state.map.tiles.find((t) => t.kind === 'boss').cleared = false;

    let r = applyAction(state, { type: 'start-boss-clash' }, dealerId);
    expect(r.ok).toBe(true);
    expect(r.state.phase).toBe('clash');
    expect(r.state.clash.isBoss).toBe(true);

    r = applyAction(r.state, { type: 'resolve-clash-stub', result: 'win' }, dealerId);
    expect(r.ok).toBe(true);
    expect(r.state.floor.stairsUnlocked).toBe(true);
    expect(r.state.map.tiles.find((t) => t.kind === 'stairs').locked).toBe(false);
  });
});

describe('end-turn hands off exploration', () => {
  it('restores 2 actions for the next hero', () => {
    const { state, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const r = applyAction(state, { type: 'end-turn', playerId: heroPlayerId }, dealerId);
    expect(r.ok).toBe(true);
    expect(r.state.explorationActionsLeft).toBe(2);
  });
});

describe('mechanics-only narrative cleanup', () => {
  it('revealing a merchant tile (R-17) spawns a Merchant immediately without story pending', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const merchantTile = base.map.tiles.find((t) => t.roomId === 'R-17');
    expect(merchantTile).toBeTruthy();
    expect(merchantTile.kind).toBe('merchant');
    const adj = base.map.tiles.find(
      (t) => t.key !== merchantTile.key && tilesConnect(merchantTile, t),
    );
    const state = placeHeroOn(base, heroPlayerId, adj.key);
    const target = state.map.tiles.find((t) => t.key === merchantTile.key);
    target.faceUp = false;
    target.cleared = false;
    target.merchant = null;
    state.explorationActionsLeft = 2;

    const r = applyAction(
      state,
      { type: 'move', x: merchantTile.x, y: merchantTile.y, playerId: heroPlayerId },
      dealerId,
    );
    expect(r.ok).toBe(true);
    const revealed = r.state.map.tiles.find((t) => t.key === merchantTile.key);
    expect(revealed.faceUp).toBe(true);
    expect(revealed.cleared).toBe(true);
    expect(revealed.merchant).toBeTruthy();
    expect(MERCHANTS.some((m) => m.id === revealed.merchant.id)).toBe(true);
    expect(r.state.pending).toBeNull();
  });

  it('rejects removed dealer-log action', () => {
    const { state, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const r = applyAction(state, { type: 'dealer-log', message: 'hi' }, dealerId);
    expect(r.ok).toBe(false);
  });

  it('rejects improvise choice on pending events (only A or B accepted)', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const trap = base.map.tiles.find((t) => t.kind === 'trap');
    const adj = base.map.tiles.find((t) => t.key !== trap.key && tilesConnect(trap, t));
    const state = placeHeroOn(base, heroPlayerId, adj.key);
    const t = state.map.tiles.find((tile) => tile.key === trap.key);
    t.faceUp = false;
    t.cleared = false;
    state.explorationActionsLeft = 2;

    const moved = applyAction(
      state,
      { type: 'move', x: trap.x, y: trap.y, playerId: heroPlayerId },
      dealerId,
    );
    expect(moved.ok).toBe(true);
    expect(moved.state.pending?.kind).toBe('event');

    const bad = applyAction(
      moved.state,
      { type: 'resolve-pending', choice: 'improvise' },
      dealerId,
    );
    expect(bad.ok).toBe(false);
  });
});

describe('virtual ticket regressions (04, 06, 08, 09, 10, 11, 12, 14)', () => {
  it('virtual_04: 1P downed transitions to defeat; 3P skips downed hero until all downed', () => {
    // 1P solo defeat
    const { state: s1, heroPlayerId: p1, dealerId: d1 } = startExploringFloor({ layoutMode: 'fixed' });
    s1.heroes[p1].hp = 1;
    s1.heroes[p1].belt = []; // no G-30
    s1.pending = {
      kind: 'event',
      heroPlayerId: p1,
      tileKey: s1.map.tiles[0].key,
      event: EVENTS[0], // E-01 B deals 2 dmg
    };
    const r1 = applyAction(s1, { type: 'resolve-pending', choice: 'b' }, d1);
    expect(r1.ok).toBe(true);
    expect(r1.state.phase).toBe('defeat');

    // 3P skips downed hero
    let s3 = createEmptyState('P3', 'dealer', 'Dealer');
    s3.players.push(
      { id: 'h1', name: 'H1', role: 'hero', heroId: 'H-01', connected: true },
      { id: 'h2', name: 'H2', role: 'hero', heroId: 'H-02', connected: true },
      { id: 'h3', name: 'H3', role: 'hero', heroId: 'H-03', connected: true },
    );
    s3 = applyAction(s3, { type: 'start-floor', layoutMode: 'fixed' }, 'dealer').state;
    s3.heroes.h2.downed = true;
    s3.heroes.h2.hp = 0;
    const turn = applyAction(s3, { type: 'end-turn', playerId: 'h1' }, 'dealer');
    expect(turn.ok).toBe(true);
    expect(turn.state.turnOrder[turn.state.activeHeroIndex]).toBe('h3');

    // 3P all downed -> defeat
    turn.state.heroes.h1.downed = true;
    turn.state.heroes.h3.downed = true;
    const wipe = applyAction(turn.state, { type: 'end-turn', playerId: 'h3' }, 'dealer');
    expect(wipe.ok).toBe(true);
    expect(wipe.state.phase).toBe('defeat');
  });

  it('virtual_06: Surprise Intern spawns MON-01 (3 HP) without consuming monster deck', () => {
    const { state, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const tile = state.map.tiles.find((t) => t.kind === 'vault');
    tile.faceUp = true;
    tile.cleared = true;
    const s = structuredClone(state);
    s.decks.twistHand = [{ id: 'TW-12', name: 'Surprise Intern!', effect: 'Spawn MON-01' }];
    const monstersBefore = s.decks.monsters.length;

    const tw = applyAction(s, { type: 'play-twist', twistId: 'TW-12' }, dealerId);
    expect(tw.ok).toBe(true);
    const spawnedTile = tw.state.map.tiles.find((t) => t.lurkingMonster);
    expect(spawnedTile).toBeTruthy();

    const adj = tw.state.map.tiles.find((t) => t.key !== spawnedTile.key && tilesConnect(spawnedTile, t));
    const ready = placeHeroOn(tw.state, heroPlayerId, adj.key);
    ready.explorationActionsLeft = 2;
    const mv = applyAction(ready, { type: 'move', x: spawnedTile.x, y: spawnedTile.y, playerId: heroPlayerId }, dealerId);
    expect(mv.ok).toBe(true);
    expect(mv.state.phase).toBe('clash');
    expect(mv.state.clash.monsterId).toBe('MON-01');
    expect(mv.state.clash.monsterHp).toBe(3);
    expect(mv.state.decks.monsters.length).toBe(monstersBefore);
  });

  it('virtual_08: entering a lair where an ally went downed resumes vs surviving monster HP', () => {
    let s = createEmptyState('RESCUE', 'dealer', 'Dealer');
    s.players.push(
      { id: 'h1', name: 'H1', role: 'hero', heroId: 'H-01', connected: true },
      { id: 'h2', name: 'H2', role: 'hero', heroId: 'H-02', connected: true },
    );
    s = applyAction(s, { type: 'start-floor', layoutMode: 'fixed' }, 'dealer').state;
    const lair = s.map.tiles.find((t) => t.kind === 'monster');
    const adj = s.map.tiles.find((t) => t.key !== lair.key && tilesConnect(lair, t));
    lair.faceUp = true;
    lair.cleared = false;
    s.heroes.h1.roomKey = lair.key;
    s.heroes.h2.roomKey = adj.key;
    s.phase = 'clash';
    s.clash = {
      roomKey: lair.key,
      heroPlayerId: 'h1',
      fighters: ['h1'],
      monsterId: 'MON-03',
      monsterName: 'Grumpy Mushroom Lump',
      monsterHp: 2,
      monsterMaxHp: 6,
      cunning: 3,
      baseDmg: 2,
      trait: 'Spores',
      traitId: 'grumpy-spores',
      lootText: 'Tier 1',
      monsterHand: [],
      isBoss: false,
      whoseTurn: 'hero',
      pile: [],
    };

    // Flee / down h1
    const flee = applyAction(s, { type: 'resolve-clash-stub', result: 'flee' }, 'dealer');
    expect(flee.ok).toBe(true);
    flee.state.activeHeroIndex = 1;
    flee.state.explorationActionsLeft = 2;

    const enter = applyAction(flee.state, { type: 'move', x: lair.x, y: lair.y, playerId: 'h2' }, 'dealer');
    expect(enter.ok).toBe(true);
    expect(enter.state.phase).toBe('clash');
    expect(enter.state.clash.monsterId).toBe('MON-03');
    expect(enter.state.clash.monsterHp).toBe(2);
    expect(enter.state.clash.monsterMaxHp).toBe(6);
  });

  it('virtual_09: event stunts roll 1d6 pass/fail and merchants support M-01/M-02 deals', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const s = structuredClone(base);
    s.heroes[heroPlayerId].hp = 10;
    s.pending = {
      kind: 'event',
      heroPlayerId,
      tileKey: s.map.tiles[0].key,
      event: EVENTS[0], // E-01 A is Zip 3+
    };
    const failRoll = applyAction(s, { type: 'resolve-pending', choice: 'a', forcedRoll: 1, reroll: false }, dealerId);
    expect(failRoll.ok).toBe(true);
    expect(failRoll.state.heroes[heroPlayerId].hp).toBe(8);

    const passRoll = applyAction(s, { type: 'resolve-pending', choice: 'a', forcedRoll: 5 }, dealerId);
    expect(passRoll.ok).toBe(true);
    expect(passRoll.state.heroes[heroPlayerId].hp).toBe(10);

    // Merchant M-01 Bundle Deal & M-02 Card Trade
    const { state: ms, tile: mTile } = ensureHeroInKind(base, heroPlayerId, 'merchant');
    mTile.merchant = MERCHANTS[0];
    ms.heroes[heroPlayerId].belt = [gearRuntimeFromId('G-27'), gearRuntimeFromId('G-28')];
    const bundle = applyAction(
      ms,
      { type: 'interact', subtype: 'merchant', deal: 'bundle-deal', playerId: heroPlayerId },
      dealerId,
    );
    expect(bundle.ok).toBe(true);
    expect(bundle.state.heroes[heroPlayerId].belt.length).toBeLessThanOrEqual(2);

    const { state: ms2, tile: mTile2 } = ensureHeroInKind(base, heroPlayerId, 'merchant');
    mTile2.merchant = MERCHANTS[1];
    ms2.heroes[heroPlayerId].hp = 5;
    ms2.heroes[heroPlayerId].hand = [
      { id: 'g1', type: 'rank', suit: 'grit', rank: 2 },
      { id: 's1', type: 'rank', suit: 'spark', rank: 3 },
    ];
    const cardTrade = applyAction(
      ms2,
      { type: 'interact', subtype: 'merchant', deal: 'card-trade', playerId: heroPlayerId },
      dealerId,
    );
    expect(cardTrade.ok).toBe(true);
    expect(cardTrade.state.heroes[heroPlayerId].hp).toBe(8);
    expect(cardTrade.state.heroes[heroPlayerId].hand).toHaveLength(0);
  });

  it('virtual_10: G-29 flee relocates hero, T-01 swaps rooms, and descend-floor starts Floor 2 with storyStack', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const lair = base.map.tiles.find((t) => t.kind === 'monster');
    const adj = base.map.tiles.find((t) => t.key !== lair.key && tilesConnect(lair, t));
    let s = placeHeroOn(base, heroPlayerId, adj.key);
    s.heroes[heroPlayerId].belt = [gearRuntimeFromId('G-29')];
    s.phase = 'clash';
    s.clash = {
      roomKey: lair.key,
      heroPlayerId,
      fighters: [heroPlayerId],
      monsterId: 'MON-01',
      monsterName: 'Goblin',
      monsterHp: 3,
      monsterMaxHp: 3,
      whoseTurn: 'hero',
      pile: [],
    };
    const fled = applyAction(s, { type: 'clash-use-belt', beltIndex: 0, mode: 'flee' }, heroPlayerId);
    expect(fled.ok).toBe(true);
    expect(fled.state.heroes[heroPlayerId].roomKey).toBe(adj.key);

    // T-01 swap
    fled.state.themeId = 'T-01';
    const swapped = applyAction(fled.state, { type: 'theme-swap-rooms' }, dealerId);
    expect(swapped.ok).toBe(true);

    // Story + Floor 2 descent
    swapped.state.storyStack = [{ id: 'S-01B', outcome: 'helped' }];
    swapped.state.phase = 'victory';
    const f2 = applyAction(swapped.state, { type: 'descend-floor' }, dealerId);
    expect(f2.ok).toBe(true);
    expect(f2.state.floorNumber).toBe(2);
    expect(f2.state.phase).toBe('exploring');
    expect(f2.state.map.tiles).toHaveLength(14);
    expect(f2.state.storyStack).toHaveLength(1);
    expect(STORIES).toHaveLength(6);
  });

  it('virtual_11: full belt opens belt-overflow prompt and preserves G-30 when chosen', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    base.heroes[heroPlayerId].belt = [gearRuntimeFromId('G-30'), gearRuntimeFromId('G-25')];
    base.pending = {
      kind: 'vault',
      heroPlayerId,
      tileKey: base.map.tiles[0].key,
      options: [{ id: 'G-27-1', gearId: 'G-27', name: 'Strawberry Fizz Potion', slot: 'belt' }],
    };
    const keep = applyAction(base, { type: 'resolve-pending', keepIndex: 0 }, dealerId);
    expect(keep.ok).toBe(true);
    expect(keep.state.pending?.kind).toBe('belt-overflow');
    expect(keep.state.pending.options).toHaveLength(3);

    // Discard index 1 (G-25), keeping G-30 and G-27
    const chosen = applyAction(keep.state, { type: 'resolve-pending', discardIndex: 1 }, dealerId);
    expect(chosen.ok).toBe(true);
    expect(chosen.state.pending).toBeNull();
    expect(chosen.state.heroes[heroPlayerId].belt.map((b) => b.id)).toEqual(['G-30', 'G-27']);
  });

  it('virtual_12 & virtual_14: rejects Boss Espresso outside clash and avoids duplicate Twist draw prefix', () => {
    const { state, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    state.decks.twistHand = [
      { id: 'TW-08', name: 'Boss Espresso Shot!', effect: 'During combat' },
    ];
    const bad = applyAction(state, { type: 'play-twist', twistId: 'TW-08' }, dealerId);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/active Clash/i);

    const draw = applyAction(state, { type: 'draw-twist', reason: 'Dealer draws Twist' }, dealerId);
    expect(draw.ok).toBe(true);
    expect(draw.state.log[0]).not.toMatch(/Dealer draws Twist: Dealer draws Twist/);
  });
});
