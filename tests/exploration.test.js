import { describe, expect, it } from 'vitest';
import {
  applyAction,
  startExploringFloor,
  ensureHeroInKind,
  placeHeroOn,
} from './helpers.js';
import { tilesConnect } from '../src/game/mapLayout.js';
import { MERCHANTS } from '../src/data/index.js';

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
