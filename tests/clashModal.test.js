import { describe, expect, it } from 'vitest';
import { formatCombatLogLine, consumeClashFx } from '../src/ui/clashModal.js';

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
