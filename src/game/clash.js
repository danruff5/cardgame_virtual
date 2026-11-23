import { getHero } from '../data/heroes.js';

/**
 * Clash & Chain helpers — suit/rank matching from rulebook §4.
 * Dealer machine remains authority; this module is pure logic.
 */

function defaultBigSwingBonus() {
  return Number(getHero('H-01')?.perk?.rankBonus ?? 2);
}

export function isCramp(card) {
  return card?.type === 'cramp';
}

export function isWild(card) {
  return card?.type === 'wild' || card?.kind === 'wild';
}

export function isSpecial(card) {
  return card?.type === 'special';
}

export function weaponStrike(hero) {
  const w = hero?.weapon;
  if (!w) return 1;
  return Number(w.strike ?? hero.weaponStrike ?? 2);
}

/** Attach strike from gear catalog onto runtime weapon when starting floor / clash. */
export function strikeForGearId(gearId, getGear) {
  const g = getGear?.(gearId);
  return g?.strike ?? 1;
}

/**
 * Effective rank for monster Zip +1 (MON-01 Unpaid Overtime).
 */
export function effectiveMonsterRank(card, clash) {
  if (!card || card.rank == null) return card?.rank ?? null;
  let rank = Number(card.rank);
  if (clash?.traitId === 'unpaid-overtime' && card.suit === 'zip') rank += 1;
  return rank;
}

/**
 * Legal to play onto clash pile given active suit/rank.
 * Opening lead (no active): any non-cramp card.
 *
 * Options:
 * - defensiveSparkAsAny: Fizzlewig Improvised Zap (Spark as any suit @ Rank 2)
 * - bigSwing: Sir Bumbles +1 Rank on a Brawn card for this play
 * - forceParry: Cookie-Tin Aegis [TAP] — any card counts as exact Parry
 */
export function isLegalPlay(card, clash, options = {}) {
  const {
    defensiveSparkAsAny = false,
    bigSwing = false,
    forceParry = false,
  } = options;
  if (!card || isCramp(card)) return false;
  if (!clash?.activeSuit && clash?.activeRank == null) return true;
  if (forceParry) return true;
  if (isWild(card)) return true;

  const activeSuit = clash.activeSuit;
  const activeRank = clash.activeRank;

  if (isSpecial(card)) {
    if (card.suit === activeSuit) return true;
    if (clash.topCard?.type === 'special' && clash.topCard?.kind === card.kind) return true;
    return false;
  }

  if (card.suit === activeSuit) return true;
  if (card.rank != null && Number(card.rank) === Number(activeRank)) return true;

  // Big Swing: Brawn card with +rankBonus rank may match active rank for Parry legality
  if (bigSwing && card.suit === 'brawn' && card.rank != null) {
    const bonus = Number(options.bigSwingBonus ?? defaultBigSwingBonus());
    if (Number(card.rank) + bonus === Number(activeRank)) return true;
  }

  // Fizzlewig defensive: Spark as any suit at Rank 2
  if (defensiveSparkAsAny && card.suit === 'spark') return true;

  return false;
}

export function classifyPlay(card, clash, options = {}) {
  const { bigSwing = false, forceParry = false, defensiveSparkAsAny = false } = options;
  if (forceParry) return 'parry';
  if (isWild(card)) return 'clean';
  if (isSpecial(card)) return 'special';

  const activeSuit = clash.activeSuit;
  const activeRank = Number(clash.activeRank);
  let rank = Number(card.rank);
  if (bigSwing && card.suit === 'brawn') {
    rank += Number(options.bigSwingBonus ?? defaultBigSwingBonus());
  }

  if (defensiveSparkAsAny && card.suit === 'spark' && card.suit !== activeSuit) {
    // Counts as Rank 2 vs active — classify vs activeRank
    const zapRank = 2;
    if (zapRank === activeRank) return 'parry';
    if (zapRank > activeRank) return 'clean';
    return 'guard';
  }

  if (card.suit === activeSuit && rank > activeRank) return 'clean';
  if (rank === activeRank) return 'parry';
  if (card.suit === activeSuit && rank < activeRank) return 'guard';
  return 'guard';
}

export function applyLeadCard(clash, card) {
  clash.topCard = card;
  if (isWild(card)) {
    clash.activeSuit = clash.activeSuit || 'brawn';
    clash.activeRank = 6;
  } else if (isSpecial(card)) {
    clash.activeSuit = card.suit;
    clash.activeRank = clash.activeRank ?? 3;
  } else {
    clash.activeSuit = card.suit;
    clash.activeRank = effectiveMonsterRank(card, clash) ?? card.rank;
  }
  clash.pile = clash.pile || [];
  clash.pile.push(card);
}

export function afterPlayUpdateActive(clash, card, chosenSuit = null, options = {}) {
  clash.topCard = card;
  clash.pile = clash.pile || [];
  clash.pile.push(card);
  if (isWild(card)) {
    clash.activeSuit = chosenSuit || clash.activeSuit || 'brawn';
    clash.activeRank = 6;
    return;
  }
  if (isSpecial(card)) {
    clash.activeSuit = card.suit;
    clash.activeRank = clash.activeRank ?? 3;
    return;
  }
  if (options.defensiveSparkAsAny && card.suit === 'spark') {
    clash.activeSuit = clash.activeSuit; // stay? Rule: defensive match — switch to Spark Rank 2
    clash.activeSuit = 'spark';
    clash.activeRank = 2;
    return;
  }
  let rank = card.rank;
  if (options.bigSwing && card.suit === 'brawn') {
    const bonus = Number(options.bigSwingBonus ?? defaultBigSwingBonus());
    rank = Math.min(6, Number(card.rank) + bonus);
  }
  clash.activeSuit = card.suit;
  clash.activeRank = rank;
}

export function heroHasLegalPlay(hero, clash, options = {}) {
  return (hero.hand || []).some((c) => isLegalPlay(c, clash, options));
}

export function pickMonsterPlay(monsterHand, clash) {
  const legal = monsterHand.filter((c) => isLegalPlay(c, clash));
  if (!legal.length) return null;
  const scored = legal.map((c) => {
    let score = 0;
    if (isWild(c) || isSpecial(c)) score = 5;
    else {
      // Classify using effective monster rank for Zip overtime
      const synthetic = {
        ...clash,
        // compare as if card had effective rank when matching suit
      };
      const kind = classifyPlay(
        clash.traitId === 'unpaid-overtime' && c.suit === 'zip' && c.rank != null
          ? { ...c, rank: Number(c.rank) + 1 }
          : c,
        synthetic,
      );
      score = kind === 'clean' ? 4 : kind === 'parry' ? 3 : 1;
    }
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].c;
}

/** Spark +1 theme (T-03) bonus damage helper. */
export function themeSparkBonus(themeId, card) {
  if (themeId === 'T-03' && card?.suit === 'spark') return 1;
  return 0;
}
