import {
  HEROES,
  getGear,
  buildActionDeckCatalog,
  buildCrampDeck,
  DESPERATION,
  roomsForRecipe,
  DEFAULT_FLOOR_RECIPE_IDS,
  THEMES,
  TWISTS,
  MONSTERS,
  BOSSES,
} from '../data/index.js';
import { shuffle, uid } from './util.js';

/**
 * Public state shared to all peers. Dealer machine is authority.
 * Hands stay on host; clients receive publicView via stripPrivateHands.
 */
export function createEmptyState(roomCode, hostPlayerId, hostName) {
  return {
    version: 1,
    roomCode,
    phase: 'lobby', // lobby | exploring | clash | victory
    log: [`Room ${roomCode} opened. Waiting for heroes…`],
    themeId: null,
    bossId: null,
    floor: {
      bossDefeated: false,
      stairsUnlocked: false,
      shinyKey: false,
    },
    players: [
      {
        id: hostPlayerId,
        name: hostName || 'Dealer',
        role: 'dealer',
        heroId: null,
        connected: true,
        isLocalStub: false,
      },
    ],
    turnOrder: [], // player ids of heroes in clockwise order
    activeHeroIndex: 0,
    explorationActionsLeft: 2,
    map: {
      // Simple stub map: linear/cross of recipe tiles placed on a grid by dealer later
      tiles: [], // { key, x, y, roomId, faceUp, cleared, looted }
      width: 0,
      height: 0,
    },
    decks: {
      action: [],
      actionDiscard: [],
      desperation: [],
      cramp: [],
      monsters: [],
      twists: [],
      twistHand: [],
    },
    heroes: {}, // playerId -> hero runtime
    clash: null,
    storyStack: [], // Part II callback ids
  };
}

export function createHeroRuntime(heroId, soloHardMode = false) {
  const def = HEROES.find((h) => h.id === heroId);
  if (!def) throw new Error(`Unknown hero ${heroId}`);
  const loadout = def.starterGear.map((gid) => {
    const g = getGear(gid);
    return { id: gid, name: g.name, slot: g.slot, tapped: false };
  });
  const belt = [];
  if (soloHardMode) {
    const charm = getGear('G-30');
    belt.push({ id: 'G-30', name: charm.name, slot: 'belt' });
  }
  return {
    heroId,
    name: def.name,
    title: def.title,
    maxHp: def.maxHp,
    hp: def.maxHp,
    downed: false,
    preferredSuit: def.preferredSuit,
    perk: def.perk,
    weapon: loadout.find((g) => g.slot === 'weapon') || null,
    offhand: loadout.find((g) => g.slot === 'offhand') || null,
    armor: loadout.find((g) => g.slot === 'armor') || null,
    belt,
    hand: [], // action card instances (private)
    roomKey: null,
    explorationUsedThisTurn: 0,
  };
}

/** Place default 14-tile recipe in a simple connected rectangle stub. */
export function buildStubMap(recipeIds = DEFAULT_FLOOR_RECIPE_IDS) {
  const rooms = roomsForRecipe(recipeIds);
  // Layout: 4×4 with two empty corners — place in snake order for connectivity.
  const slots = [
    [0, 0], [1, 0], [2, 0], [3, 0],
    [3, 1], [2, 1], [1, 1], [0, 1],
    [0, 2], [1, 2], [2, 2], [3, 2],
    [3, 3], [2, 3],
  ];
  const tiles = rooms.map((room, i) => {
    const [x, y] = slots[i];
    const faceUp = Boolean(room.startFaceUp);
    return {
      key: `t-${x}-${y}`,
      x,
      y,
      roomId: room.id,
      kind: room.kind,
      name: room.name,
      rule: room.rule,
      faceUp,
      cleared: faceUp,
      looted: false,
      locked: room.kind === 'stairs',
    };
  });
  return { tiles, width: 4, height: 4 };
}

export function prepareFloorDecks() {
  return {
    action: shuffle(buildActionDeckCatalog()),
    actionDiscard: [],
    desperation: shuffle(DESPERATION.map((d) => ({ ...d }))),
    cramp: shuffle(buildCrampDeck()),
    monsters: shuffle(MONSTERS.map((m) => ({ ...m }))),
    twists: shuffle(TWISTS.map((t) => ({ ...t }))),
    twistHand: [],
  };
}

export function pickRandomTheme() {
  return THEMES[Math.floor(Math.random() * THEMES.length)].id;
}

export function pickRandomBoss() {
  return BOSSES[Math.floor(Math.random() * BOSSES.length)].id;
}

/**
 * Strip private info for a viewer.
 * Dealer (host machine) gets full authority state for tools + local stubs.
 * Heroes get deck counts only; other players' hands are face-down.
 */
export function publicStateFor(state, viewerPlayerId) {
  const copy = structuredClone(state);
  const viewer = copy.players.find((p) => p.id === viewerPlayerId);
  const isDealer = viewer?.role === 'dealer';

  if (isDealer) {
    // Counts for UI + keep full decks for host authority tools
    copy.decks = {
      ...copy.decks,
      actionCount: copy.decks.action.length,
      actionDiscardCount: copy.decks.actionDiscard.length,
      desperationCount: copy.decks.desperation.length,
      crampCount: copy.decks.cramp.length,
      monstersCount: copy.decks.monsters.length,
      twistsCount: copy.decks.twists.length,
    };
    return copy;
  }

  if (copy.decks) {
    copy.decks = {
      actionCount: copy.decks.action.length,
      actionDiscardCount: copy.decks.actionDiscard.length,
      desperationCount: copy.decks.desperation.length,
      crampCount: copy.decks.cramp.length,
      monstersCount: copy.decks.monsters.length,
      twistsCount: copy.decks.twists.length,
      twistHand: copy.decks.twistHand.map((t) => ({ id: t.id, hidden: true })),
    };
  }
  for (const [pid, hero] of Object.entries(copy.heroes || {})) {
    if (pid !== viewerPlayerId) {
      hero.hand = hero.hand.map((c) => ({ id: c.id, hidden: true, type: c.type }));
    }
  }
  if (copy.clash?.monsterHand) {
    copy.clash.monsterHand = copy.clash.monsterHand.map((c) => ({ id: c.id, hidden: true }));
  }
  return copy;
}

export function entranceTile(state) {
  return state.map.tiles.find((t) => t.kind === 'entrance') || state.map.tiles[0] || null;
}

export function tileAt(state, x, y) {
  return state.map.tiles.find((t) => t.x === x && t.y === y) || null;
}

export function adjacentOrthogonal(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

export function appendLog(state, line) {
  state.log = [`${line}`, ...state.log].slice(0, 40);
}

export function nextPlayerId(nameHint = 'player') {
  return uid(nameHint);
}
