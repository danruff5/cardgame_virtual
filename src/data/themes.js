import { CATALOG } from './catalog.js';

/** Floor themes & dealer twists derived from canonical cards.json. */
export const THEMES = CATALOG.themes.map((t) => ({
  id: t.id,
  name: t.name,
  rule: t.rule,
  flavor: t.flavor,
}));

export const TWISTS = CATALOG.twists.map((t) => ({
  id: t.id,
  name: t.name,
  copies: t.copies,
  effect: t.effect,
  flavor: t.flavor,
}));
