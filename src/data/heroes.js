import { CATALOG } from './catalog.js';

/** Heroes H-01..H-04 derived from canonical cards.json. */
export const HEROES = CATALOG.heroes.map((h) => ({
  id: h.id,
  name: h.name,
  title: h.title,
  maxHp: h.maxHp,
  preferredSuit: h.preferredSuit,
  perk: { ...h.perk },
  starterGear: [...h.starterGear],
  flavor: h.flavor,
}));

export function getHero(id) {
  return HEROES.find((h) => h.id === id) ?? null;
}
