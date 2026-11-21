import { describe, expect, it } from 'vitest';
import {
  isCramp,
  isWild,
  isSpecial,
  isLegalPlay,
  classifyPlay,
  applyLeadCard,
  afterPlayUpdateActive,
  heroHasLegalPlay,
  pickMonsterPlay,
  weaponStrike,
} from '../src/game/clash.js';

const rank = (suit, n, id = `${suit}-${n}`) => ({
  id,
  type: 'rank',
  suit,
  rank: n,
  name: `${suit} ${n}`,
});

const special = (kind, suit, id = `${kind}-${suit}`) => ({
  id,
  type: 'special',
  kind,
  suit,
  name: kind,
});

const wild = (id = 'wild-1') => ({ id, type: 'wild', kind: 'wild', name: 'Heroic Wild!' });
const cramp = (id = 'cramp-1') => ({ id, type: 'cramp', name: 'Cramp!' });

describe('clash card type helpers', () => {
  it('detects cramp, wild, and special cards', () => {
    expect(isCramp(cramp())).toBe(true);
    expect(isCramp(rank('brawn', 3))).toBe(false);
    expect(isWild(wild())).toBe(true);
    expect(isWild({ kind: 'wild', type: 'rank' })).toBe(true);
    expect(isSpecial(special('daze', 'zip'))).toBe(true);
    expect(isSpecial(rank('zip', 2))).toBe(false);
  });

  it('reads weapon strike from equipped gear or fallback', () => {
    expect(weaponStrike({ weapon: { strike: 3 } })).toBe(3);
    expect(weaponStrike({ weapon: {} })).toBe(2); // missing strike → default 2
    expect(weaponStrike({})).toBe(1); // no weapon at all
  });
});

describe('isLegalPlay — suit / rank matching (rulebook §4)', () => {
  it('allows any non-cramp card when opening (no active suit/rank)', () => {
    const clash = { activeSuit: null, activeRank: null };
    expect(isLegalPlay(rank('brawn', 1), clash)).toBe(true);
    expect(isLegalPlay(wild(), clash)).toBe(true);
    expect(isLegalPlay(special('bounce', 'grit'), clash)).toBe(true);
    expect(isLegalPlay(cramp(), clash)).toBe(false);
    expect(isLegalPlay(null, clash)).toBe(false);
  });

  it('allows matching suit or matching rank', () => {
    const clash = { activeSuit: 'brawn', activeRank: 4 };
    expect(isLegalPlay(rank('brawn', 2), clash)).toBe(true);
    expect(isLegalPlay(rank('brawn', 6), clash)).toBe(true);
    expect(isLegalPlay(rank('zip', 4), clash)).toBe(true); // parry path
    expect(isLegalPlay(rank('zip', 3), clash)).toBe(false);
    expect(isLegalPlay(rank('spark', 5), clash)).toBe(false);
  });

  it('always allows Heroic Wild!', () => {
    const clash = { activeSuit: 'grit', activeRank: 6 };
    expect(isLegalPlay(wild(), clash)).toBe(true);
  });

  it('allows specials on matching suit or matching special kind on pile', () => {
    const clashSuit = { activeSuit: 'spark', activeRank: 3, topCard: rank('spark', 3) };
    expect(isLegalPlay(special('daze', 'spark'), clashSuit)).toBe(true);
    expect(isLegalPlay(special('daze', 'brawn'), clashSuit)).toBe(false);

    const clashSpecial = {
      activeSuit: 'brawn',
      activeRank: 3,
      topCard: special('daze', 'brawn'),
    };
    expect(isLegalPlay(special('daze', 'zip'), clashSpecial)).toBe(true);
    expect(isLegalPlay(special('bounce', 'zip'), clashSpecial)).toBe(false);
  });

  it('supports Fizzlewig defensive Spark-as-any when flagged', () => {
    const clash = { activeSuit: 'brawn', activeRank: 5 };
    expect(isLegalPlay(rank('spark', 2), clash)).toBe(false);
    expect(isLegalPlay(rank('spark', 2), clash, { defensiveSparkAsAny: true })).toBe(true);
  });
});

describe('classifyPlay — Clean / Parry / Guard', () => {
  const clash = { activeSuit: 'brawn', activeRank: 4 };

  it('classifies higher same-suit as clean strike', () => {
    expect(classifyPlay(rank('brawn', 5), clash)).toBe('clean');
    expect(classifyPlay(rank('brawn', 6), clash)).toBe('clean');
  });

  it('classifies exact rank (any suit) as parry', () => {
    expect(classifyPlay(rank('brawn', 4), clash)).toBe('parry');
    expect(classifyPlay(rank('zip', 4), clash)).toBe('parry');
  });

  it('classifies lower same-suit as guard', () => {
    expect(classifyPlay(rank('brawn', 2), clash)).toBe('guard');
    expect(classifyPlay(rank('brawn', 1), clash)).toBe('guard');
  });

  it('treats wild as clean for outcome routing', () => {
    expect(classifyPlay(wild(), clash)).toBe('clean');
  });

  it('labels specials as special', () => {
    expect(classifyPlay(special('tuckered', 'brawn'), clash)).toBe('special');
  });
});

describe('applyLeadCard / afterPlayUpdateActive', () => {
  it('sets active suit/rank from a rank lead', () => {
    const clash = { pile: [] };
    applyLeadCard(clash, rank('zip', 3));
    expect(clash.activeSuit).toBe('zip');
    expect(clash.activeRank).toBe(3);
    expect(clash.pile).toHaveLength(1);
    expect(clash.topCard.suit).toBe('zip');
  });

  it('wild lead defaults suit to brawn and rank 6', () => {
    const clash = { pile: [] };
    applyLeadCard(clash, wild());
    expect(clash.activeSuit).toBe('brawn');
    expect(clash.activeRank).toBe(6);
  });

  it('special lead sets suit and default rank pressure', () => {
    const clash = { pile: [] };
    applyLeadCard(clash, special('bounce', 'grit'));
    expect(clash.activeSuit).toBe('grit');
    expect(clash.activeRank).toBe(3);
  });

  it('afterPlay updates active to played card (parry switches suit)', () => {
    const clash = { activeSuit: 'brawn', activeRank: 4, pile: [] };
    const kind = afterPlayUpdateActive(clash, rank('zip', 4));
    expect(kind).toBe('parry');
    expect(clash.activeSuit).toBe('zip');
    expect(clash.activeRank).toBe(4);
  });

  it('afterPlay on wild sets chosen suit and rank 6', () => {
    const clash = { activeSuit: 'brawn', activeRank: 2, pile: [] };
    afterPlayUpdateActive(clash, wild(), 'spark');
    expect(clash.activeSuit).toBe('spark');
    expect(clash.activeRank).toBe(6);
  });
});

describe('hand helpers', () => {
  it('heroHasLegalPlay scans hand', () => {
    const clash = { activeSuit: 'brawn', activeRank: 4 };
    expect(
      heroHasLegalPlay({ hand: [rank('zip', 2), cramp()] }, clash),
    ).toBe(false);
    expect(
      heroHasLegalPlay({ hand: [rank('zip', 2), rank('grit', 4)] }, clash),
    ).toBe(true);
  });

  it('pickMonsterPlay prefers clean over parry over guard', () => {
    const clash = { activeSuit: 'brawn', activeRank: 3 };
    const hand = [rank('brawn', 1, 'g'), rank('zip', 3, 'p'), rank('brawn', 5, 'c')];
    expect(pickMonsterPlay(hand, clash).id).toBe('c');
  });

  it('pickMonsterPlay returns null when no legal cards', () => {
    const clash = { activeSuit: 'brawn', activeRank: 3 };
    expect(pickMonsterPlay([rank('zip', 1), cramp()], clash)).toBeNull();
  });
});
