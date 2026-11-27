export { CATALOG, RULES } from './catalog.js';
export { SUITS, SUIT_IDS } from './suits.js';
export { HEROES, getHero } from './heroes.js';
export { GEAR, getGear, gearByTier, buildFloor1LootDeck } from './gear.js';
export {
  buildActionDeckCatalog,
  buildCrampDeck,
  ACTION_DECK_SIZE,
  CRAMP_DECK_SIZE,
} from './actionDeck.js';
export { DESPERATION, DESPERATION_SIZE } from './desperation.js';
export {
  ROOMS,
  DEFAULT_FLOOR_RECIPE_IDS,
  getRoom,
  roomsForRecipe,
} from './rooms.js';
export { MONSTERS, BOSSES, bossHp } from './monsters.js';
export { EVENTS, MERCHANTS, STORIES } from './events.js';
export { THEMES, TWISTS } from './themes.js';

import { HEROES } from './heroes.js';
import { GEAR } from './gear.js';
import { buildActionDeckCatalog, buildCrampDeck } from './actionDeck.js';
import { DESPERATION } from './desperation.js';
import { ROOMS, DEFAULT_FLOOR_RECIPE_IDS } from './rooms.js';
import { MONSTERS, BOSSES } from './monsters.js';
import { EVENTS, MERCHANTS, STORIES } from './events.js';
import { THEMES, TWISTS } from './themes.js';

/** Sanity counts matching design docs (for README / debug panel). */
export function dataInventory() {
  return {
    heroes: HEROES.length,
    gear: GEAR.length,
    actionDeck: buildActionDeckCatalog().length,
    cramp: buildCrampDeck().length,
    desperation: DESPERATION.length,
    rooms: ROOMS.length,
    defaultFloorTiles: DEFAULT_FLOOR_RECIPE_IDS.length,
    monsters: MONSTERS.length,
    bosses: BOSSES.length,
    events: EVENTS.length,
    merchants: MERCHANTS.length,
    stories: STORIES.length,
    themes: THEMES.length,
    twists: TWISTS.length,
  };
}
