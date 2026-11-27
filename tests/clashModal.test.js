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

function bossClashState() {
  const state = sampleClashState();
  const hand = (pid) => [
    { id: `${pid}-1`, type: 'rank', suit: 'zip', rank: 4, name: 'zip 4' },
    { id: `${pid}-2`, type: 'rank', suit: 'spark', rank: 1, name: 'spark 1' },
  ];
  state.players = [
    { id: 'p1', name: 'Robin' },
    { id: 'p2', name: 'Sam' },
    { id: 'p3', name: 'Kit' },
    { id: 'p4', name: 'Jo' },
  ];
  state.heroes.p2 = { name: 'Bumbles', heroId: 'H-02', hp: 10, maxHp: 10, hand: hand('p2') };
  state.heroes.p3 = { name: 'Brick', heroId: 'H-03', hp: 7, maxHp: 10, hand: hand('p3') };
  state.heroes.p4 = { name: 'Fizz', heroId: 'H-04', hp: 10, maxHp: 10, roomKey: '2,1', hand: hand('p4') };
  state.map = { tiles: [{ key: '2,1', x: 2, y: 1, kind: 'boss', faceUp: true, cleared: false }], barriers: [] };
  Object.assign(state.clash, {
    isBoss: true,
    roomKey: '2,1',
    monsterId: 'B-01',
    monsterName: 'Sir Clanks-a-Lot',
    fighters: ['p1', 'p2', 'p3'],
    bossEvery: 2,
  });
  return state;
}

function railHtml(html, side) {
  const start = html.indexOf(`clash-side clash-side-${side}`);
  if (start < 0) return '';
  const ends = ['clash-actions', 'clash-zone-hero', 'clash-col-center']
    .map((marker) => html.indexOf(marker, start))
    .filter((i) => i > start);
  return html.slice(start, Math.min(...ends));
}

describe('renderClashModal co-op table', () => {
  it('keeps a fighting hero at the bottom with partners face-up on both rails', () => {
    const html = renderClashModal(bossClashState(), false, 'p2', {});
    const handZone = html.slice(html.indexOf('clash-zone-hand'), html.indexOf('clash-col-right'));
    expect(handZone).toContain('Your hand');
    expect(handZone).toContain('data-fly="c:p2-1"');
    expect(handZone).toContain('disabled');

    expect(railHtml(html, 'left')).toContain('data-ally="p3"');
    expect(railHtml(html, 'right')).toContain('data-ally="p1"');
    expect(railHtml(html, 'right')).toContain('data-fly="c:a1"');
    expect(railHtml(html, 'right')).not.toContain('data-fly-back');
    expect(railHtml(html, 'right')).toContain('Playing');
    expect(html).toContain('data-coach="clash-wait"');
  });

  it('gives the dealer the turn hero at the bottom and everyone else on the rails', () => {
    const html = renderClashModal(bossClashState(), true, 'dealer', {});
    expect(html).toContain('data-clash-card="a1"');
    expect(html).toContain('data-ally="p2"');
    expect(html).toContain('data-ally="p3"');
    expect(html).not.toContain('data-ally="p1"');
    expect(html).toContain('Pip &amp; Bumbles &amp; Brick');
    expect(html).toContain('Acts every 2 hero turn(s)');
  });

  it('tags the table zones the card flights use', () => {
    const html = renderClashModal(bossClashState(), true, 'dealer', {});
    for (const zone of ['deck', 'discard', 'desp', 'pile', 'monster-hand', 'seat:p1', 'seat:p2', 'seat:p3']) {
      expect(html).toContain(`data-fly="z:${zone}"`);
    }
    expect(html).toContain('data-fly="c:m1" data-fly-back');
    expect(html).toContain('data-fly="c:t1"');
  });

  it('offers the dealer a pile-in button for a Hero waiting in the chamber', () => {
    const html = renderClashModal(bossClashState(), true, 'dealer', {});
    expect(html).toContain('data-clash-join="p4"');
    expect(html).toContain('Bring in Fizz');
  });

  it('lets a nearby Hero join from their own screen and keeps hands private until then', () => {
    const html = renderClashModal(bossClashState(), false, 'p4', {});
    expect(html).toContain('data-clash-join="p4"');
    expect(html).toContain('Join the fight');
    expect(html).toContain('hand is private');
    expect(html).not.toContain('data-clash-card=');
  });

  it('shows the turn banner once per hand-off and the result on the closing frame', () => {
    const live = renderClashModal(bossClashState(), true, 'dealer', { turnChanged: true });
    expect(live).toContain('clash-turn-banner');
    expect(renderClashModal(bossClashState(), true, 'dealer', {})).not.toContain('clash-turn-banner');

    const closing = renderClashModal(bossClashState(), true, 'dealer', { closing: 'victory', turnChanged: true });
    expect(closing).toContain('outcome-victory');
    expect(closing).toContain('POOF!');
    expect(closing).not.toContain('clash-turn-banner');
    expect(closing).not.toContain('btn-clash-win');
    expect(closing).not.toContain('data-clash-join');
  });
});

describe('consumeClashFx co-op', () => {
  it('tracks HP per fighter so a turn hand-off never fakes damage', () => {
    const session = {};
    const state = bossClashState();
    consumeClashFx(session, state);

    state.clash.heroPlayerId = 'p3';
    const handOff = consumeClashFx(session, state);
    expect(handOff.heroDelta).toBe(0);
    expect(handOff.turnChanged).toBe(true);
    expect(handOff.hitFlash).toBe(false);

    state.heroes.p2.hp = 8;
    const hit = consumeClashFx(session, state);
    expect(hit.heroDeltas).toMatchObject({ p1: 0, p2: -2, p3: 0 });
    expect(hit.hitFlash).toBe(true);
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

describe('clash modal items & twin knives UI', () => {
  it('renders Drink Fizz Potion in clash actions when hero holds G-27/G-28', () => {
    const s = sampleClashState();
    s.heroes.p1.belt = [{ id: 'G-27', name: 'Strawberry Fizz Potion' }];
    const html = renderClashModal(s, false, 'p1', {});
    expect(html).toContain('data-clash-belt="0"');
    expect(html).toContain('data-belt-mode="heal"');
  });

  it('restricts legal cards to twinRank and shows Done with Twin Knives button', () => {
    const s = sampleClashState();
    s.clash.twinRank = 3;
    s.clash.activeSuit = 'brawn';
    s.clash.activeRank = 3;
    s.heroes.p1.hand = [
      { id: 'c3', type: 'rank', suit: 'zip', rank: 3, name: 'zip 3' },
      { id: 'cb', type: 'rank', suit: 'brawn', rank: 5, name: 'brawn 5' },
    ];
    const html = renderClashModal(s, false, 'p1', {});
    expect(html).toContain('id="btn-clash-end-twin"');
    expect(html).toMatch(/data-clash-card="c3"[^>]*>/);
    const cbIdx = html.indexOf('data-clash-card="cb"');
    expect(cbIdx).toBeGreaterThan(-1);
    const cbBtn = html.slice(cbIdx - 80, cbIdx + 80);
    expect(cbBtn).toContain('disabled');
  });

  it('logs special card suits accurately in hover tooltips and disables cards when heroDazed (virtual_07)', () => {
    const html = formatCombatLogLine('Sir Clanks-a-Lot plays Daze! (spark) — Pip will miss next turn.');
    expect(html).toContain('Daze! (spark)');
    expect(html).toContain('Play on SPARK or another Daze!');

    const s = sampleClashState();
    s.clash.heroDazed = true;
    const modalHtml = renderClashModal(s, false, 'p1', {});
    expect(modalHtml).toContain('id="btn-clash-dazed-skip"');
    const cardIdx = modalHtml.indexOf('data-clash-card="a1"');
    const cardBtn = modalHtml.slice(cardIdx - 80, cardIdx + 120);
    expect(cardBtn).toContain('disabled');
  });
});
