import { SUIT_IDS } from './suits.js';

/**
 * Shared Action Deck — exact 68 cards from action_and_desperation_decks_f070.md
 * Per suit: ranks 1×3, 2×3, 3×3, 4×2, 5×1, 6×1, Daze!, Bounce Back!, Tuckered Out! (+2)
 * Plus 4 Heroic Wild!
 */

const RANK_COPIES = { 1: 3, 2: 3, 3: 3, 4: 2, 5: 1, 6: 1 };
const SPECIALS = [
  { kind: 'daze', name: 'Daze!' },
  { kind: 'bounce', name: 'Bounce Back!' },
  { kind: 'tuckered', name: 'Tuckered Out! (+2)' },
];

function makeInstanceId(parts) {
  return parts.join('-');
}

/** Build a fresh ordered catalog of all 68 action card definitions (unique instance ids). */
export function buildActionDeckCatalog() {
  const cards = [];
  for (const suit of SUIT_IDS) {
    for (const [rankStr, copies] of Object.entries(RANK_COPIES)) {
      const rank = Number(rankStr);
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
    for (const special of SPECIALS) {
      cards.push({
        id: makeInstanceId(['A', suit, special.kind]),
        type: 'special',
        suit,
        kind: special.kind,
        name: special.name,
      });
    }
  }
  for (let n = 1; n <= 4; n += 1) {
    cards.push({
      id: makeInstanceId(['A', 'wild', n]),
      type: 'wild',
      suit: 'wild',
      kind: 'wild',
      name: 'Heroic Wild!',
    });
  }
  return cards;
}

/** Exactly 12 Cramp! fatigue cards. */
export function buildCrampDeck() {
  return Array.from({ length: 12 }, (_, i) => ({
    id: `C-${String(i + 1).padStart(2, '0')}`,
    type: 'cramp',
    name: 'Cramp!',
    rule: 'Unplayable on Clash Pile. Discard up to 2 Cramp! instead of playing. All clear at end of combat.',
  }));
}

export const ACTION_DECK_SIZE = 68;
export const CRAMP_DECK_SIZE = 12;
