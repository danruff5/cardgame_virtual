import { BOSSES, bossHp } from '../data/index.js';
import { adjacentOrthogonal, tilesConnect } from './state.js';

/**
 * Boss Chamber gathering rules — pure helpers shared by the authority reducer and the UI.
 *
 * Revealing / entering the Boss Chamber never starts combat. The fight begins only when
 * the Dealer or a Hero standing in the chamber calls it; everyone conscious in the room
 * then fights together. Late arrivals may still pile in from an adjacent room.
 */

function no(error) {
  return { ok: false, error };
}

export function bossTile(state) {
  return state?.map?.tiles?.find((t) => t.kind === 'boss') || null;
}

export function doorwayJammed(state, a, b) {
  return (state?.map?.barriers || []).some(
    (bar) =>
      (bar.aKey === a.key && bar.bKey === b.key) ||
      (bar.aKey === b.key && bar.bKey === a.key),
  );
}

/** Conscious heroes standing in a room, in seating (turn) order. */
export function consciousHeroesInRoom(state, roomKey) {
  const order = state?.turnOrder?.length ? state.turnOrder : Object.keys(state?.heroes || {});
  return order.filter((pid) => {
    const h = state.heroes?.[pid];
    return h && !h.downed && h.roomKey === roomKey;
  });
}

/**
 * Snapshot of the pre-fight Boss Chamber: is the boss revealed and waiting, who is inside,
 * and what HP it would start with if the fight were called right now.
 */
export function bossGather(state) {
  const tile = bossTile(state);
  const boss = BOSSES.find((b) => b.id === state?.bossId) || BOSSES[0];
  const waiting = Boolean(
    tile && tile.faceUp && !tile.cleared && state?.phase === 'exploring' && !state?.clash,
  );
  const heroIds = tile ? consciousHeroesInRoom(state, tile.key) : [];
  return {
    tile,
    boss,
    waiting,
    heroIds,
    projectedHp: bossHp(boss.id, Math.max(1, heroIds.length), state?.floorNumber || 1),
  };
}

/**
 * Who may call the Boss fight, and who fights.
 * - Dealer: any time at least one conscious Hero is in the chamber.
 * - Hero: only while standing in the chamber themselves.
 * Fighters are every conscious Hero in the chamber, in seating order starting with the lead.
 */
export function bossStartCheck(state, actor, playerId = null) {
  if (state?.phase !== 'exploring' || state.clash) return no('Not exploring');
  if (state.pending) return no('Resolve the pending room prompt first');
  const { tile, heroIds } = bossGather(state);
  if (!tile || !tile.faceUp) return no('The Boss Chamber has not been found yet');
  if (tile.cleared) return no('The Floor Boss is already defeated');
  if (!heroIds.length) return no('A conscious Hero must be standing in the Boss Chamber');

  let leadId = null;
  if (actor?.role === 'dealer') {
    const activeId = state.turnOrder?.[state.activeHeroIndex];
    if (playerId && heroIds.includes(playerId)) leadId = playerId;
    else if (heroIds.includes(activeId)) leadId = activeId;
    else [leadId] = heroIds;
  } else if (actor?.role === 'hero') {
    if (!heroIds.includes(actor.id)) return no('Step into the Boss Chamber before calling the fight');
    leadId = actor.id;
  } else {
    return no('Only the Dealer or a Hero can start the Boss fight');
  }

  const at = heroIds.indexOf(leadId);
  const fighterIds = [...heroIds.slice(at), ...heroIds.slice(0, at)];
  return { ok: true, tile, leadId, fighterIds };
}

/**
 * Mid-fight join: a conscious Hero not yet fighting who is already in the Boss Chamber,
 * or one doorway away from it (the join is their move into the room).
 */
export function bossJoinCheck(state, playerId) {
  const clash = state?.clash;
  if (state?.phase !== 'clash' || !clash?.isBoss) return no('No active Boss clash');
  const hero = state.heroes?.[playerId];
  if (!hero) return no('Not a hero');
  if (hero.downed) return no('DOWNED heroes cannot join');
  if ((clash.fighters || []).includes(playerId)) return no('Already in the Boss clash');
  if (hero.roomKey === clash.roomKey) return { ok: true, needsMove: false };
  const from = state.map.tiles.find((t) => t.key === hero.roomKey);
  const to = state.map.tiles.find((t) => t.key === clash.roomKey);
  if (!from || !to) return no('Invalid tile');
  if (!adjacentOrthogonal(from, to) || !tilesConnect(from, to)) {
    return no('Too far away — only Heroes next to the Boss Chamber can pile in');
  }
  if (doorwayJammed(state, from, to)) {
    return no('Sticky Door Jam blocks the way into the Boss Chamber');
  }
  return { ok: true, needsMove: true };
}
