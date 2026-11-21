/**
 * Clash & Chain helpers — suit/rank matching from rulebook §4.
 * Dealer machine remains authority; this module is pure logic.
 */

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
  // Strike values encoded on starter gear names via data; use strike from catalog if present on runtime
  return Number(w.strike ?? hero.weaponStrike ?? 2);
}

/** Attach strike from gear catalog onto runtime weapon when starting floor / clash. */
export function strikeForGearId(gearId, getGear) {
  const g = getGear?.(gearId);
  return g?.strike ?? 1;
}

/**
 * Legal to play onto clash pile given active suit/rank.
 * Opening lead (no active): any non-cramp card.
 */
export function isLegalPlay(card, clash, { defensiveSparkAsAny = false } = {}) {
  if (!card || isCramp(card)) return false;
  if (!clash?.activeSuit && clash?.activeRank == null) return true;
  if (isWild(card)) return true;

  const activeSuit = clash.activeSuit;
  const activeRank = clash.activeRank;

  if (isSpecial(card)) {
    // Specials: matching Suit OR matching same special kind on pile
    if (card.suit === activeSuit) return true;
    if (clash.topCard?.type === 'special' && clash.topCard?.kind === card.kind) return true;
    return false;
  }

  // Rank cards
  if (card.suit === activeSuit) return true;
  if (card.rank != null && Number(card.rank) === Number(activeRank)) return true;

  // Fizzlewig defensive: Spark as any suit at Rank 2 — caller sets flag when perk used
  if (defensiveSparkAsAny && card.suit === 'spark') return true;

  return false;
}

export function classifyPlay(card, clash) {
  if (isWild(card)) return 'clean';
  if (isSpecial(card)) return 'special';

  const activeSuit = clash.activeSuit;
  const activeRank = Number(clash.activeRank);
  const rank = Number(card.rank);

  if (card.suit === activeSuit && rank > activeRank) return 'clean';
  if (rank === activeRank) return 'parry';
  if (card.suit === activeSuit && rank < activeRank) return 'guard';
  if (card.suit === activeSuit && rank === activeRank) return 'parry';
  // Exact rank on different suit already caught; suit match lower = guard
  return 'guard';
}

export function applyLeadCard(clash, card) {
  clash.topCard = card;
  if (isWild(card)) {
    // Wild on lead: keep previous or require suit pick — default brawn if none
    clash.activeSuit = clash.activeSuit || 'brawn';
    clash.activeRank = 6;
  } else if (isSpecial(card)) {
    clash.activeSuit = card.suit;
    clash.activeRank = clash.activeRank ?? 3;
  } else {
    clash.activeSuit = card.suit;
    clash.activeRank = card.rank;
  }
  clash.pile = clash.pile || [];
  clash.pile.push(card);
}

export function afterPlayUpdateActive(clash, card, chosenSuit = null) {
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
    // keep rank-ish pressure
    clash.activeRank = clash.activeRank ?? 3;
    return;
  }
  const kind = classifyPlay(card, {
    activeSuit: clash.activeSuit,
    activeRank: clash.activeRank,
  });
  // After play, active becomes the played card (parry/clean/guard all switch to played card's suit/rank per typical flow)
  // Rule: Parry switches Active Suit to played card; Clean Strike keeps beating — we set to played card
  clash.activeSuit = card.suit;
  clash.activeRank = card.rank;
  return kind;
}

export function heroHasLegalPlay(hero, clash) {
  return (hero.hand || []).some((c) => isLegalPlay(c, clash));
}

export function pickMonsterPlay(monsterHand, clash) {
  const legal = monsterHand.filter((c) => isLegalPlay(c, clash));
  if (!legal.length) return null;
  // Prefer clean strikes, then parries, then anything
  const scored = legal.map((c) => {
    let score = 0;
    if (isWild(c) || isSpecial(c)) score = 5;
    else {
      const kind = classifyPlay(c, clash);
      score = kind === 'clean' ? 4 : kind === 'parry' ? 3 : 1;
    }
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].c;
}
