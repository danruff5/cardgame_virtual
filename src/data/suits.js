import { CATALOG } from './catalog.js';

/** Combat suits derived from canonical cards.json. */
export const SUITS = Object.fromEntries(
  Object.entries(CATALOG.suits).map(([key, s]) => [
    key,
    { id: s.id, name: s.name, color: s.color, hex: s.hex || s.color },
  ]),
);

export const SUIT_IDS = ['brawn', 'grit', 'zip', 'spark'];
