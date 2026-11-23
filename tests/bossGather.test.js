import { describe, expect, it } from 'vitest';
import { applyAction, startExploringFloor, placeHeroOn } from './helpers.js';
import { tilesConnect, publicStateFor } from '../src/game/state.js';
import { bossGather, bossStartCheck, bossJoinCheck } from '../src/game/boss.js';
import { bossHp, HEROES } from '../src/data/index.js';

/** Fixed-layout floor with `count` heroes (ids hero-1..hero-N), all on the entrance. */
function startParty(count = 2) {
  const { state: base, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
  const state = structuredClone(base);
  const ids = ['hero-1'];
  for (let i = 2; i <= count; i += 1) {
    const id = `hero-${i}`;
    ids.push(id);
    state.players.push({
      id,
      name: `Ally ${i}`,
      role: 'hero',
      heroId: HEROES[i - 1].id,
      connected: true,
      isLocalStub: false,
    });
    state.heroes[id] = structuredClone(state.heroes['hero-1']);
    state.heroes[id].name = `Ally ${i}`;
    state.heroes[id].heroId = HEROES[i - 1].id;
    state.heroes[id].hand = state.decks.action.splice(0, 4);
  }
  state.turnOrder = ids;
  state.activeHeroIndex = 0;
  state.explorationActionsLeft = 2;
  return { state, dealerId, ids };
}

function bossAndNeighbor(state) {
  const boss = state.map.tiles.find((t) => t.kind === 'boss');
  const adj = state.map.tiles.find((t) => t.key !== boss.key && tilesConnect(boss, t));
  return { boss, adj };
}

/** Hero stands next to a face-down Boss Chamber, with actions to spend. */
function nextToHiddenBoss(base, heroPlayerId) {
  const { boss, adj } = bossAndNeighbor(base);
  const state = placeHeroOn(base, heroPlayerId, adj.key);
  const tile = state.map.tiles.find((t) => t.key === boss.key);
  tile.faceUp = false;
  tile.cleared = false;
  state.phase = 'exploring';
  state.clash = null;
  state.pending = null;
  state.explorationActionsLeft = 2;
  state.activeHeroIndex = state.turnOrder.indexOf(heroPlayerId);
  return { state, boss: tile };
}

/** Boss Chamber revealed (not cleared) with the given heroes standing inside. */
function gatheredInBossRoom(base, heroIds) {
  const state = structuredClone(base);
  const boss = state.map.tiles.find((t) => t.kind === 'boss');
  boss.faceUp = true;
  boss.cleared = false;
  for (const id of heroIds) state.heroes[id].roomKey = boss.key;
  state.phase = 'exploring';
  state.clash = null;
  state.pending = null;
  return { state, boss };
}

describe('Boss Chamber does not auto-trigger', () => {
  it('revealing the boss room keeps exploring and leaves the remaining action', () => {
    const { state: base, dealerId, ids } = startParty(2);
    const { state, boss } = nextToHiddenBoss(base, ids[0]);

    const r = applyAction(state, { type: 'move', x: boss.x, y: boss.y, playerId: ids[0] }, dealerId);
    expect(r.ok).toBe(true);
    expect(r.state.phase).toBe('exploring');
    expect(r.state.clash).toBeNull();
    expect(r.state.explorationActionsLeft).toBe(1);
    expect(r.state.heroes[ids[0]].roomKey).toBe(boss.key);
    const tile = r.state.map.tiles.find((t) => t.key === boss.key);
    expect(tile.faceUp).toBe(true);
    expect(tile.cleared).toBe(false);
    expect(r.state.log.some((l) => /waits/i.test(l))).toBe(true);
    expect(bossGather(r.state).waiting).toBe(true);
  });

  it('re-entering a revealed, uncleared boss room does not start a clash either', () => {
    const { state: base, dealerId, ids } = startParty(2);
    const { state, boss } = nextToHiddenBoss(base, ids[0]);
    state.map.tiles.find((t) => t.key === boss.key).faceUp = true;

    const r = applyAction(state, { type: 'move', x: boss.x, y: boss.y, playerId: ids[0] }, dealerId);
    expect(r.ok).toBe(true);
    expect(r.state.phase).toBe('exploring');
    expect(r.state.clash).toBeNull();
  });

  it('heroes can walk back out of the Boss Chamber and keep exploring', () => {
    const { state: base, dealerId, ids } = startParty(2);
    const { boss, adj } = bossAndNeighbor(base);
    const { state } = gatheredInBossRoom(base, [ids[0]]);
    state.map.tiles.find((t) => t.key === adj.key).faceUp = true;
    state.map.tiles.find((t) => t.key === adj.key).cleared = true;
    state.explorationActionsLeft = 2;

    const r = applyAction(state, { type: 'move', x: adj.x, y: adj.y, playerId: ids[0] }, dealerId);
    expect(r.ok).toBe(true);
    expect(r.state.phase).toBe('exploring');
    expect(r.state.heroes[ids[0]].roomKey).toBe(adj.key);
    expect(r.state.map.tiles.find((t) => t.key === boss.key).cleared).toBe(false);
  });

  it('carrying a downed ally into the boss room does not start a clash', () => {
    const { state: base, dealerId, ids } = startParty(2);
    const { state, boss } = nextToHiddenBoss(base, ids[0]);
    state.heroes[ids[1]].roomKey = state.heroes[ids[0]].roomKey;
    state.heroes[ids[1]].downed = true;
    state.heroes[ids[1]].hp = 0;

    const r = applyAction(
      state,
      { type: 'carry', targetPlayerId: ids[1], x: boss.x, y: boss.y, playerId: ids[0] },
      dealerId,
    );
    expect(r.ok).toBe(true);
    expect(r.state.clash).toBeNull();
    expect(r.state.phase).toBe('exploring');
  });

  it('monster lairs still start a clash immediately', () => {
    const { state: base, dealerId, ids } = startParty(2);
    const lair = base.map.tiles.find((t) => t.kind === 'monster');
    const adj = base.map.tiles.find((t) => t.key !== lair.key && tilesConnect(lair, t));
    const state = placeHeroOn(base, ids[0], adj.key);
    state.explorationActionsLeft = 2;

    const r = applyAction(state, { type: 'move', x: lair.x, y: lair.y, playerId: ids[0] }, dealerId);
    expect(r.ok).toBe(true);
    expect(r.state.phase).toBe('clash');
    expect(r.state.clash.isBoss).toBe(false);
  });
});

describe('start-boss-clash', () => {
  it('is rejected until the Boss Chamber has been found', () => {
    const { state, dealerId } = startParty(2);
    const r = applyAction(state, { type: 'start-boss-clash' }, dealerId);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not been found/i);
  });

  it('is rejected when nobody conscious is standing in the chamber', () => {
    const { state: base, dealerId } = startParty(2);
    const { state } = gatheredInBossRoom(base, []);
    const r = applyAction(state, { type: 'start-boss-clash' }, dealerId);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/standing in the Boss Chamber/i);
  });

  it('a hero outside the chamber cannot call the fight; one inside can, off-turn', () => {
    const { state: base, ids } = startParty(2);
    const { state } = gatheredInBossRoom(base, [ids[1]]);
    state.activeHeroIndex = 0; // hero-1's exploration turn

    const outside = applyAction(state, { type: 'start-boss-clash' }, ids[0]);
    expect(outside.ok).toBe(false);
    expect(outside.error).toMatch(/Step into the Boss Chamber/i);

    const inside = applyAction(state, { type: 'start-boss-clash' }, ids[1]);
    expect(inside.ok).toBe(true);
    expect(inside.state.phase).toBe('clash');
    expect(inside.state.clash.heroPlayerId).toBe(ids[1]);
    expect(inside.state.clash.fighters).toEqual([ids[1]]);
  });

  it('is blocked while a room prompt is pending', () => {
    const { state: base, dealerId, ids } = startParty(2);
    const { state } = gatheredInBossRoom(base, [ids[0]]);
    state.pending = { kind: 'event', heroPlayerId: ids[0], tileKey: 'x', event: { id: 'E-00' } };
    const r = applyAction(state, { type: 'start-boss-clash' }, dealerId);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/pending/i);
  });

  it('pulls in every conscious hero in the chamber and scales HP +4 per extra fighter', () => {
    const { state: base, dealerId, ids } = startParty(3);
    const { state } = gatheredInBossRoom(base, [ids[0], ids[1]]);
    state.heroes[ids[1]].hand = []; // arrives empty-handed → topped up to 5

    const r = applyAction(state, { type: 'start-boss-clash' }, dealerId);
    expect(r.ok).toBe(true);
    const clash = r.state.clash;
    expect(clash.isBoss).toBe(true);
    expect(clash.fighters).toEqual([ids[0], ids[1]]);
    expect(clash.heroPlayerId).toBe(ids[0]);
    expect(clash.monsterMaxHp).toBe(bossHp(state.bossId, 2));
    expect(clash.monsterMaxHp).toBe(14);
    expect(clash.monsterHp).toBe(14);
    expect(clash.bossEvery).toBe(2);
    expect(clash.whoseTurn).toBe('hero');
    expect(r.state.heroes[ids[1]].hand).toHaveLength(5);
    expect(r.state.explorationActionsLeft).toBe(0);
  });

  it('skips downed heroes lying in the chamber', () => {
    const { state: base, dealerId, ids } = startParty(3);
    const { state } = gatheredInBossRoom(base, [ids[0], ids[1]]);
    state.heroes[ids[1]].downed = true;
    state.heroes[ids[1]].hp = 0;

    const r = applyAction(state, { type: 'start-boss-clash' }, dealerId);
    expect(r.ok).toBe(true);
    expect(r.state.clash.fighters).toEqual([ids[0]]);
    expect(r.state.clash.monsterMaxHp).toBe(10);
    expect(r.state.clash.bossEvery).toBe(1);
  });

  it('seats fighters in turn order starting with whoever called it', () => {
    const { state: base, ids } = startParty(3);
    const { state } = gatheredInBossRoom(base, ids);
    const check = bossStartCheck(state, { id: ids[1], role: 'hero' });
    expect(check.ok).toBe(true);
    expect(check.leadId).toBe(ids[1]);
    expect(check.fighterIds).toEqual([ids[1], ids[2], ids[0]]);
  });

  it('a solo fight in a multi-hero party starts at base HP (1v1 cadence)', () => {
    const { state: base, ids } = startParty(3);
    const { state } = gatheredInBossRoom(base, [ids[2]]);
    const r = applyAction(state, { type: 'start-boss-clash' }, ids[2]);
    expect(r.ok).toBe(true);
    expect(r.state.clash.monsterMaxHp).toBe(10);
    expect(r.state.clash.bossEvery).toBe(1);
  });
});

describe('joining a Boss clash that is underway', () => {
  function soloBossClash() {
    const { state: base, dealerId, ids } = startParty(3);
    const { boss, adj } = bossAndNeighbor(base);
    const gathered = gatheredInBossRoom(base, [ids[0]]).state;
    gathered.heroes[ids[1]].roomKey = adj.key; // next door
    const far = gathered.map.tiles.find(
      (t) => t.key !== boss.key && t.key !== adj.key && !tilesConnect(boss, t),
    );
    gathered.heroes[ids[2]].roomKey = far.key; // across the map
    const r = applyAction(gathered, { type: 'start-boss-clash' }, dealerId);
    expect(r.ok).toBe(true);
    return { state: r.state, dealerId, ids, boss };
  }

  it('a hero next door piles in: +4 max/current HP and co-op cadence', () => {
    const { state, ids, boss } = soloBossClash();
    expect(state.clash.monsterMaxHp).toBe(10);

    const r = applyAction(state, { type: 'join-boss-clash' }, ids[1]);
    expect(r.ok).toBe(true);
    expect(r.state.clash.fighters).toEqual([ids[0], ids[1]]);
    expect(r.state.clash.monsterMaxHp).toBe(14);
    expect(r.state.clash.monsterHp).toBe(14);
    expect(r.state.clash.bossEvery).toBe(2);
    expect(r.state.heroes[ids[1]].roomKey).toBe(boss.key);
  });

  it('the dealer can bring a specific hero in; the legacy move-join still works', () => {
    const { state, dealerId, ids, boss } = soloBossClash();
    const viaDealer = applyAction(state, { type: 'join-boss-clash', playerId: ids[1] }, dealerId);
    expect(viaDealer.ok).toBe(true);
    expect(viaDealer.state.clash.fighters).toContain(ids[1]);

    const viaMove = applyAction(state, { type: 'move', x: boss.x, y: boss.y }, ids[1]);
    expect(viaMove.ok).toBe(true);
    expect(viaMove.state.clash.fighters).toContain(ids[1]);
    expect(viaMove.state.clash.monsterMaxHp).toBe(14);
  });

  it('rejects heroes who are too far, downed, or already fighting', () => {
    const { state, ids } = soloBossClash();
    expect(bossJoinCheck(state, ids[2]).ok).toBe(false);
    expect(applyAction(state, { type: 'join-boss-clash' }, ids[2]).error).toMatch(/too far/i);
    expect(applyAction(state, { type: 'join-boss-clash' }, ids[0]).error).toMatch(/already/i);

    const downed = structuredClone(state);
    downed.heroes[ids[1]].downed = true;
    expect(applyAction(downed, { type: 'join-boss-clash' }, ids[1]).error).toMatch(/DOWNED/);
  });

  it('is rejected outside a Boss clash', () => {
    const { state, ids } = startParty(2);
    const r = applyAction(state, { type: 'join-boss-clash' }, ids[1]);
    expect(r.ok).toBe(false);
  });

  it('fleeing leaves the boss uncleared and waiting to be called again', () => {
    const { state, dealerId } = soloBossClash();
    const r = applyAction(state, { type: 'resolve-clash-stub', result: 'flee' }, dealerId);
    expect(r.ok).toBe(true);
    expect(r.state.phase).toBe('exploring');
    expect(bossGather(r.state).waiting).toBe(true);
    expect(applyAction(r.state, { type: 'start-boss-clash' }, dealerId).ok).toBe(true);
  });
});

describe('co-op clash cleanup and hand visibility', () => {
  it('every fighter drops Cramp! and untaps gear when the clash ends', () => {
    const { state: base, dealerId, ids } = startParty(2);
    const { state } = gatheredInBossRoom(base, ids);
    let r = applyAction(state, { type: 'start-boss-clash' }, dealerId);
    const mid = r.state;
    mid.heroes[ids[1]].hand.push({ id: 'C-x', type: 'cramp', name: 'Cramp!' });
    if (mid.heroes[ids[1]].armor) mid.heroes[ids[1]].armor.tapped = true;

    r = applyAction(mid, { type: 'resolve-clash-stub', result: 'win' }, dealerId);
    expect(r.ok).toBe(true);
    expect(r.state.heroes[ids[1]].hand.some((c) => c.type === 'cramp')).toBe(false);
    if (r.state.heroes[ids[1]].armor) expect(r.state.heroes[ids[1]].armor.tapped).toBe(false);
  });

  it('co-fighters see each other’s hands; spectators and non-clash views do not', () => {
    const { state: base, dealerId, ids } = startParty(3);
    const { state } = gatheredInBossRoom(base, [ids[0], ids[1]]);

    const before = publicStateFor(state, ids[0]);
    expect(before.heroes[ids[1]].hand.every((c) => c.hidden)).toBe(true);

    const r = applyAction(state, { type: 'start-boss-clash' }, dealerId);
    const fighterView = publicStateFor(r.state, ids[0]);
    expect(fighterView.heroes[ids[1]].hand.some((c) => c.hidden)).toBe(false);
    expect(fighterView.heroes[ids[2]].hand.every((c) => c.hidden)).toBe(true);
    expect(fighterView.clash.monsterHand.every((c) => c.hidden)).toBe(true);

    const spectatorView = publicStateFor(r.state, ids[2]);
    expect(spectatorView.heroes[ids[0]].hand.every((c) => c.hidden)).toBe(true);
    expect(spectatorView.heroes[ids[1]].hand.every((c) => c.hidden)).toBe(true);
  });
});
