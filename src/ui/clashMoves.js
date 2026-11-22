/**
 * Pure helpers for the clash table: who sits where, and what moved between two states.
 * No DOM here — clashAnim.js turns the move list into card flights.
 */

export function clashFighters(clash) {
  if (!clash) return [];
  return clash.fighters?.length ? [...clash.fighters] : [clash.heroPlayerId];
}

/**
 * Seat plan for one viewer.
 * - A fighting hero always sits at the bottom of their own screen.
 * - The dealer (and spectators) get whoever holds the hero turn at the bottom.
 * - Other fighters alternate to the left / right rails, in seating order after the main seat.
 */
export function clashSeats(state, isDealer, meId) {
  const clash = state?.clash;
  const fighters = clashFighters(clash);
  if (!fighters.length) return { mainId: null, left: [], right: [], fighters };
  const viewerFights = !isDealer && fighters.includes(meId);
  const mainId = viewerFights ? meId : clash.heroPlayerId;
  const at = Math.max(0, fighters.indexOf(mainId));
  const others = [...fighters.slice(at + 1), ...fighters.slice(0, at)].filter((id) => id !== mainId);
  const left = [];
  const right = [];
  others.forEach((id, i) => (i % 2 === 0 ? left : right).push(id));
  return { mainId, left, right, fighters };
}

/** Minimal, id-only picture of a clash for diffing. */
export function snapClash(state) {
  const clash = state?.clash;
  if (!clash) return null;
  const fighters = clashFighters(clash);
  const hands = {};
  for (const pid of fighters) {
    hands[pid] = (state.heroes?.[pid]?.hand || []).map((c) => c.id);
  }
  return {
    key: `${clash.roomKey ?? ''}|${clash.monsterId ?? clash.monsterName ?? ''}`,
    fighters,
    hands,
    monsterHand: (clash.monsterHand || []).map((c) => c.id),
    pile: (clash.pile || []).map((c) => c.id),
    whoseTurn: clash.whoseTurn,
    heroPlayerId: clash.heroPlayerId,
    desperationId: clash.lastDesperation?.id ?? null,
  };
}

function locate(snap) {
  const where = new Map();
  for (const [pid, ids] of Object.entries(snap.hands)) {
    for (const id of ids) where.set(id, `hand:${pid}`);
  }
  for (const id of snap.monsterHand) where.set(id, 'monster');
  for (const id of snap.pile) where.set(id, 'pile');
  return where;
}

/**
 * What happened between two snapshots of the same clash, as table moves:
 *   { type: 'play', cardId, from: 'monster' | 'hand:<pid>' }   card onto the pile
 *   { type: 'draw', cardId, to: 'monster' | 'hand:<pid>' }     card off a deck
 *   { type: 'discard', cardId, from }                          card leaves the table
 *   { type: 'desperation', cardId }                            Desperation flip
 *   { type: 'join', heroId }                                   hero piles into a Boss clash
 *   { type: 'turn', who: 'hero' | 'monster', heroId }          turn hand-off (always last)
 */
export function diffClashMoves(prev, next) {
  if (!prev || !next || prev.key !== next.key) return [];
  const moves = [];
  const before = locate(prev);
  const after = locate(next);

  for (const [cardId, to] of after) {
    const from = before.get(cardId);
    if (from === to) continue;
    if (to === 'pile') {
      // A card drawn and played in the same action never showed up in a hand.
      const source =
        from || (prev.whoseTurn === 'monster' ? 'monster' : `hand:${prev.heroPlayerId}`);
      moves.push({ type: 'play', cardId, from: source });
    } else if (!from) {
      moves.push({ type: 'draw', cardId, to });
    } else {
      moves.push({ type: 'pass', cardId, from, to });
    }
  }
  for (const [cardId, from] of before) {
    if (after.has(cardId) || from === 'pile') continue;
    moves.push({ type: 'discard', cardId, from });
  }

  if (next.desperationId && next.desperationId !== prev.desperationId) {
    moves.push({ type: 'desperation', cardId: next.desperationId });
  }
  for (const heroId of next.fighters) {
    if (!prev.fighters.includes(heroId)) moves.push({ type: 'join', heroId });
  }
  if (prev.whoseTurn !== next.whoseTurn || prev.heroPlayerId !== next.heroPlayerId) {
    moves.push({ type: 'turn', who: next.whoseTurn, heroId: next.heroPlayerId });
  }
  return moves;
}

/** Opening deal: every starting card comes off the deck, and the monster leads onto the pile. */
export function openingDealMoves(snap) {
  if (!snap) return [];
  const moves = [];
  for (const cardId of snap.monsterHand) moves.push({ type: 'draw', cardId, to: 'monster' });
  for (const [pid, ids] of Object.entries(snap.hands)) {
    for (const cardId of ids) moves.push({ type: 'draw', cardId, to: `hand:${pid}` });
  }
  for (const cardId of snap.pile) moves.push({ type: 'play', cardId, from: 'monster' });
  return moves;
}

/**
 * How a clash that just disappeared from state ended.
 * 'victory' | 'downed' | 'flee' | 'ended' (floor called / left the table).
 */
export function clashOutcome(prevState, nextState) {
  const clash = prevState?.clash;
  if (!clash) return 'ended';
  if (!nextState || nextState.phase === 'victory' || nextState.phase === 'lobby') return 'ended';
  const prevTile = prevState.map?.tiles?.find((t) => t.key === clash.roomKey);
  const nextTile = nextState.map?.tiles?.find((t) => t.key === clash.roomKey);
  if (nextTile?.cleared && !prevTile?.cleared) return 'victory';
  const fell = clashFighters(clash).some(
    (pid) => nextState.heroes?.[pid]?.downed && !prevState.heroes?.[pid]?.downed,
  );
  return fell ? 'downed' : 'flee';
}

/**
 * The last frame of a finished clash: the previous table, patched with what we know of the
 * result (final HP, the finishing card on the pile) so the outro animates from the truth.
 */
export function closingClashState(prevState, nextState, outcome) {
  const view = structuredClone(prevState);
  const clash = view.clash;
  if (!clash) return view;
  if (outcome === 'victory') clash.monsterHp = 0;

  for (const pid of clashFighters(clash)) {
    const was = view.heroes?.[pid];
    const now = nextState?.heroes?.[pid];
    if (!was || !now) continue;
    was.hp = now.hp;
    was.downed = now.downed;

    if (pid !== clash.heroPlayerId || clash.whoseTurn !== 'hero') continue;
    const kept = new Set((now.hand || []).map((c) => c.id));
    const spent = was.hand.filter((c) => !kept.has(c.id) && c.type !== 'cramp' && !c.hidden);
    if (outcome === 'victory' && spent.length === 1) {
      const [finisher] = spent;
      was.hand = was.hand.filter((c) => c.id !== finisher.id);
      clash.pile = [...(clash.pile || []), finisher];
      clash.topCard = finisher;
    }
  }
  return view;
}
