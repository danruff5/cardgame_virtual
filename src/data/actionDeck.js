import { CATALOG } from './catalog.js';
import { SUIT_IDS } from './suits.js';

/**
 * Shared Action Deck & Cramp! deck derived from canonical cards.json.
 */
function makeInstanceId(parts) {
  return parts.join('-');
}

export function buildActionDeckCatalog() {
  const cards = [];
  const rankDist = CATALOG.actionDeck.rankDistribution;
  const specials = CATALOG.actionDeck.specials;
  const wildDef = CATALOG.actionDeck.wild;

  for (const suit of SUIT_IDS) {
    for (const [rankStr, info] of Object.entries(rankDist)) {
      const rank = Number(rankStr);
      const copies = Number(info.copies);
      for (let n = 1; n <= copies; n += 1) {
        cards.push({
          id: makeInstanceId(['A', suit, `r${rank}`, n]),
          type: 'rank',
          suit,
          rank,
          name: `${suit[0].toUpperCase()}${suit.slice(1)} ${rank}`,
        });
      }
    }
    for (const special of specials) {
      cards.push({
        id: makeInstanceId(['A', suit, special.kind]),
        type: 'special',
        suit,
        kind: special.kind,
        name: special.name,
      });
    }
  }
  for (let n = 1; n <= Number(wildDef.copies); n += 1) {
    cards.push({
      id: makeInstanceId(['A', 'wild', n]),
      type: 'wild',
      suit: 'wild',
      kind: 'wild',
      name: wildDef.name,
    });
  }
  return cards;
}

export function buildCrampDeck() {
  const crampDef = CATALOG.actionDeck.cramp;
  return Array.from({ length: Number(crampDef.copies) }, (_, i) => ({
    id: `C-${String(i + 1).padStart(2, '0')}`,
    type: 'cramp',
    name: crampDef.name,
    rule: crampDef.rule,
  }));
}

export const ACTION_DECK_SIZE = buildActionDeckCatalog().length;
export const CRAMP_DECK_SIZE = Number(CATALOG.actionDeck.cramp.copies);
