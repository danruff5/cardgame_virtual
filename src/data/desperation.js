import { CATALOG } from './catalog.js';

/** Desperation Deck D-01..D-20 derived from canonical cards.json. */
export const DESPERATION = CATALOG.desperation.map((d) => ({
  id: d.id,
  title: d.title,
  tier: d.tier,
  outcome: d.outcome,
  reset: d.reset,
  flavor: d.flavor,
  art: d.art,
}));

export const DESPERATION_SIZE = DESPERATION.length;
