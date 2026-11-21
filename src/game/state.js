import {
  HEROES,
  getGear,
  buildActionDeckCatalog,
  buildCrampDeck,
  buildFloor1LootDeck,
  DESPERATION,
  THEMES,
  TWISTS,
  MONSTERS,
  BOSSES,
  EVENTS,
  MERCHANTS,
  STORIES,
} from '../data/index.js';
import { shuffle, uid } from './util.js';
import { buildFixedSnakeMap, buildRandomFloorMap, tilesConnect } from './mapLayout.js';

export { tilesConnect, buildRandomFloorMap, buildFixedSnakeMap };

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
      tiles: [], // { key, x, y, roomId, faceUp, cleared, looted, ... }
      width: 0,
      height: 0,
      barriers: [], // Sticky Door Jam: [{ aKey, bKey }]
    },
    decks: {
      action: [],
      actionDiscard: [],
      desperation: [],
      cramp: [],
      monsters: [],
      twists: [],
      twistHand: [],
      loot: [],
      lootDiscard: [],
      events: [],
      storyMerchant: [],
    },
    heroes: {}, // playerId -> hero runtime
    clash: null,
    storyStack: [], // Part II callback ids (tucked for Floor 2+)
    pending: null, // vault / event / story choice modal
    layoutMode: 'random', // random | fixed
  };
}

export function createHeroRuntime(heroId, soloHardMode = false) {
  const def = HEROES.find((h) => h.id === heroId);
  if (!def) throw new Error(`Unknown hero ${heroId}`);
  const loadout = def.starterGear.map((gid) => gearRuntimeFromId(gid));
  const belt = [];
  if (soloHardMode) {
    belt.push(gearRuntimeFromId('G-30'));
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
    perkUsedThisClash: false,
    shrineUsedThisFloor: false,
    secondWindUsed: false,
    stuntGearUsed: { scarf: false, kaleidoscope: false },
  };
}

/** Runtime gear instance with rule flags from catalog. */
export function gearRuntimeFromId(gid) {
  const g = getGear(gid);
  if (!g) return { id: gid, name: gid, slot: 'belt', tapped: false };
  return {
    id: gid,
    name: g.name,
    slot: g.slot,
    tapped: false,
    strike: g.strike,
    strikeBonusSuit: g.strikeBonusSuit,
    tapBlock: g.tapBlock,
    ignoreRanks: g.ignoreRanks ? [...g.ignoreRanks] : undefined,
    gritIgnoresArmor: Boolean(g.gritIgnoresArmor),
    type: g.type || null,
    heal: g.heal,
    rule: g.rule,
  };
}

/** @deprecated Prefer buildRandomFloorMap / buildFixedSnakeMap from mapLayout.js */
export function buildStubMap(recipeIds) {
  return buildFixedSnakeMap(recipeIds);
}

export function buildFloorMap(layoutMode = 'random', recipeIds) {
  if (layoutMode === 'fixed') return buildFixedSnakeMap(recipeIds);
  return buildRandomFloorMap(recipeIds);
}

export function prepareFloorDecks() {
  const partOnes = STORIES.filter((s) => s.part === 1);
  return {
    action: shuffle(buildActionDeckCatalog()),
    actionDiscard: [],
    desperation: shuffle(DESPERATION.map((d) => ({ ...d }))),
    cramp: shuffle(buildCrampDeck()),
    monsters: shuffle(MONSTERS.map((m) => ({ ...m }))),
    twists: shuffle(TWISTS.map((t) => ({ ...t }))),
    twistHand: [],
    loot: shuffle(buildFloor1LootDeck()),
    lootDiscard: [],
    events: shuffle(EVENTS.map((e) => ({ ...e }))),
    storyMerchant: shuffle([
      ...MERCHANTS.map((m) => ({ ...m, cardKind: 'merchant' })),
      ...partOnes.map((s) => ({ ...s, cardKind: 'story' })),
    ]),
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
      lootCount: copy.decks.loot?.length ?? 0,
      eventsCount: copy.decks.events?.length ?? 0,
      storyMerchantCount: copy.decks.storyMerchant?.length ?? 0,
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
      lootCount: copy.decks.loot?.length ?? 0,
      eventsCount: copy.decks.events?.length ?? 0,
      storyMerchantCount: copy.decks.storyMerchant?.length ?? 0,
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
