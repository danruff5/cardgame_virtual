import { describe, it, expect } from 'vitest';
import { createTelemetryTracker } from '../src/analytics/telemetry.js';
import { startExploringFloor, applyAction, ensureHeroInKind } from './helpers.js';
import { isCramp, isLegalPlay } from '../src/game/clash.js';

describe('telemetry observer', () => {
  it('tracks a solo floor win with clashes, plays, loot, and victory status', () => {
    const sent = [];
    const tracker = createTelemetryTracker({
      roomCode: 'TWIN',
      source: 'headless-sim',
      batchId: 'unit-test',
      sendFn: (payload) => sent.push(payload),
    });

    const { state: s0, dealerId, heroPlayerId } = startExploringFloor({
      heroId: 'H-01',
      layoutMode: 'fixed',
    });
    tracker.onState(null, s0, { type: 'start-floor' });
    expect(tracker.snapshot().status).toBe('active');
    expect(tracker.snapshot().heroCount).toBe(1);

    // Move to boss room & start boss clash
    const { state: sBoss, tile: bossTile } = ensureHeroInKind(s0, heroPlayerId, 'boss');
    bossTile.cleared = false;
    tracker.onState(s0, sBoss, { type: 'move' });

    let r = applyAction(sBoss, { type: 'start-boss-clash' }, dealerId);
    expect(r.ok).toBe(true);
    tracker.onState(sBoss, r.state, { type: 'start-boss-clash' });
    let cur = r.state;
    expect(tracker.snapshot().bossClashes).toBe(1);

    // Play a card or desperation, then win via dealer stub to exercise end-to-end
    const hero = cur.heroes[heroPlayerId];
    const legal = hero.hand.find((c) => !isCramp(c) && isLegalPlay(c, cur.clash));
    const act = legal
      ? { type: 'clash-play', cardId: legal.id }
      : { type: 'clash-desperation' };
    r = applyAction(cur, act, heroPlayerId);
    expect(r.ok).toBe(true);
    tracker.onState(cur, r.state, act);
    cur = r.state;

    if (cur.phase === 'clash') {
      r = applyAction(cur, { type: 'resolve-clash-stub', result: 'win' }, dealerId);
      expect(r.ok).toBe(true);
      tracker.onState(cur, r.state, { type: 'resolve-clash-stub', result: 'win' });
      cur = r.state;
    }

    expect(cur.floor.stairsUnlocked).toBe(true);
    r = applyAction(cur, { type: 'end-floor' }, dealerId);
    expect(r.ok).toBe(true);
    tracker.onState(cur, r.state, { type: 'end-floor' });

    const snap = tracker.snapshot();
    expect(snap.status).toBe('won');
    expect(snap.bossDefeated).toBe(true);
    expect(snap.clashesWon).toBe(1);
    expect(snap.totalExchanges).toBeGreaterThanOrEqual(1);
    expect(sent.length).toBeGreaterThanOrEqual(4);
  });

  it('detects party wipe loss without mutating game state', () => {
    const tracker = createTelemetryTracker({
      roomCode: 'WIPE',
      source: 'headless-sim',
      sendFn: () => {},
    });
    const { state: s0 } = startExploringFloor({ heroId: 'H-02', layoutMode: 'fixed' });
    tracker.onState(null, s0, { type: 'start-floor' });

    const s1 = structuredClone(s0);
    s1.heroes['hero-1'].hp = 0;
    s1.heroes['hero-1'].downed = true;

    tracker.onState(s0, s1, { type: 'clash-monster-turn' });
    const snap = tracker.snapshot();
    expect(snap.status).toBe('lost');
    expect(snap.heroDownedCount).toBe(1);
    // Observation-only: s1.phase was not mutated
    expect(s1.phase).toBe('exploring');
  });

  it('tracks multi-floor progression (stays active after Floor 1 in 2F run, wins on Floor 2)', () => {
    const tracker = createTelemetryTracker({
      roomCode: 'FLR2',
      source: 'headless-sim',
      targetFloors: 2,
      sendFn: () => {},
    });
    const { state: s0, dealerId } = startExploringFloor({ heroId: 'H-01', layoutMode: 'fixed' });
    tracker.onState(null, s0, { type: 'start-floor' });

    // Finish Floor 1
    let r = applyAction(s0, { type: 'end-floor' }, dealerId);
    expect(r.ok).toBe(true);
    tracker.onState(s0, r.state, { type: 'end-floor' });
    expect(tracker.snapshot().status).toBe('active');
    expect(tracker.snapshot().floorsCleared).toBe(1);
    expect(tracker.snapshot().floorHistory).toHaveLength(1);

    // Descend to Floor 2
    const prevVictory = r.state;
    r = applyAction(prevVictory, { type: 'descend-floor' }, dealerId);
    expect(r.ok).toBe(true);
    tracker.onState(prevVictory, r.state, { type: 'descend-floor' });
    expect(tracker.snapshot().currentFloor).toBe(2);
    expect(tracker.snapshot().status).toBe('active');

    // Finish Floor 2 -> now overall status is won!
    const f2Explore = r.state;
    r = applyAction(f2Explore, { type: 'end-floor' }, dealerId);
    expect(r.ok).toBe(true);
    tracker.onState(f2Explore, r.state, { type: 'end-floor' });
    const snap = tracker.snapshot();
    expect(snap.status).toBe('won');
    expect(snap.floorsCleared).toBe(2);
    expect(snap.maxFloorReached).toBe(2);
    expect(snap.floorHistory).toHaveLength(2);
  });
});
