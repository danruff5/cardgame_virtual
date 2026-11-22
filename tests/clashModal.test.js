import { describe, expect, it } from 'vitest';
import { formatCombatLogLine, consumeClashFx, renderClashModal } from '../src/ui/clashModal.js';
import { COACH_TOURS } from '../src/ui/coachmarks.js';

describe('formatCombatLogLine', () => {
  it('escapes plain text', () => {
    expect(formatCombatLogLine('Hello <b>x</b>')).toBe('Hello &lt;b&gt;x&lt;/b&gt;');
  });

  it('wraps suit/rank and specials with hover mentions', () => {
    const html = formatCombatLogLine('Clean Strike with brawn 4 — 2 Dmg. Plays Daze! (zip).');
    expect(html).toContain('log-card-mention');
    expect(html).toContain('brawn 4');
    expect(html).toContain('Daze! (zip)');
    expect(html).toContain('card-hover-tip');
    expect(html).toContain('tip-rules');
  });

  it('wraps Heroic Wild! and Cramp!', () => {
    const html = formatCombatLogLine('Heroic Wild! then Cramp!');
    expect(html.match(/log-card-mention/g)?.length).toBe(2);
  });
});

describe('consumeClashFx', () => {
  it('emits deltas only after a baseline snapshot', () => {
    const session = {};
    const state = {
      clash: {
        heroPlayerId: 'p1',
        monsterHp: 5,
        topCard: { id: 'c1' },
        pile: [{ id: 'c1' }],
      },
      heroes: { p1: { hp: 10 } },
    };
    const first = consumeClashFx(session, state);
    expect(first.heroDelta).toBe(0);
    expect(first.monsterDelta).toBe(0);
    expect(first.pileAnim).toBe(false);

    state.heroes.p1.hp = 8;
    state.clash.monsterHp = 3;
    state.clash.topCard = { id: 'c2' };
    state.clash.pile.push({ id: 'c2' });
    const second = consumeClashFx(session, state);
    expect(second.heroDelta).toBe(-2);
    expect(second.monsterDelta).toBe(-2);
    expect(second.pileAnim).toBe(true);
    expect(second.hitFlash).toBe(true);
  });

  it('resets when clash ends', () => {
    const session = { clashFx: { prevHeroHp: 9, prevMonsterHp: 2, prevTopId: 'x', prevPileLen: 1 } };
    const cleared = consumeClashFx(session, { clash: null, heroes: {} });
    expect(cleared.heroDelta).toBe(0);
    expect(session.clashFx.prevHeroHp).toBeNull();
  });
});

function sampleClashState() {
  return {
    phase: 'clash',
    log: ['Clash begins vs Dust Bunny'],
    heroes: {
      p1: {
        name: 'Pip',
        heroId: 'H-01',
        hp: 8,
        maxHp: 10,
        hand: [
          { id: 'a1', type: 'rank', suit: 'brawn', rank: 3, name: 'brawn 3' },
          { id: 'a2', type: 'rank', suit: 'grit', rank: 2, name: 'grit 2' },
        ],
      },
    },
    clash: {
      heroPlayerId: 'p1',
      monsterId: 'MON-01',
      monsterName: 'Dust Bunny',
      monsterHp: 4,
      monsterMaxHp: 5,
      monsterHand: [{ id: 'm1' }, { id: 'm2' }],
      topCard: { id: 't1', type: 'rank', suit: 'brawn', rank: 2, name: 'brawn 2' },
      pile: [{ id: 't1', type: 'rank', suit: 'brawn', rank: 2, name: 'brawn 2' }],
      activeSuit: 'brawn',
      activeRank: 2,
      whoseTurn: 'hero',
      needsDraw: true,
      baseDmg: 1,
      trait: 'Fluffy: no special.',
      note: 'Room clash',
      isBoss: false,
    },
  };
}

describe('renderClashModal layout hooks', () => {
  it('exposes scroll body, pile coach target, and hand zone for dealer', () => {
    const html = renderClashModal(sampleClashState(), true, 'dealer', {});
    expect(html).toContain('clash-modal-body');
    expect(html).toContain('data-coach="clash-pile"');
    expect(html).toContain('clash-zone-hand');
    expect(html).toContain('clash-zone-monster');
    expect(html).toContain('data-clash-card="a1"');
    expect(html).toContain('btn-clash-win');
    expect(html).toContain('btn-clash-desperation');
  });

  it('shows private hand for non-fighter hero view', () => {
    const html = renderClashModal(sampleClashState(), false, 'p2', {});
    expect(html).toContain("hand is private");
    expect(html).not.toContain('data-clash-card="a1"');
  });

  it('shows playable hand for the fighting hero', () => {
    const html = renderClashModal(sampleClashState(), false, 'p1', {});
    expect(html).toContain('data-clash-card="a1"');
    expect(html).toContain('btn-clash-desperation');
    expect(html).not.toContain('btn-clash-win');
  });
});

describe('clash coachmark selectors', () => {
  it('targets the pile stage, not the full-screen backdrop', () => {
    const clashTour = COACH_TOURS.find((t) => t.id === 'clash');
    expect(clashTour).toBeTruthy();
    expect(clashTour.steps[0].selector).toContain('clash-pile');
    expect(clashTour.steps[0].place).toBe('bottom');
  });
});
