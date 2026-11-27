import { describe, expect, it } from 'vitest';
import {
  createEmptyState,
  applyAction,
  startExploringFloor,
  ensureHeroInKind,
} from './helpers.js';
import { publicStateFor, adjacentOrthogonal, tilesConnect, gearRuntimeFromId } from '../src/game/state.js';
import { HEROES, GEAR, EVENTS } from '../src/data/index.js';
import { renderTable, resolveFocusedHeroId } from '../src/ui/tableView.js';

function twoHeroState() {
  const dealerId = 'dealer-1';
  let state = createEmptyState('ROOM', dealerId, 'Dealer');
  state.players.push(
    { id: 'h1', name: 'Robin', role: 'hero', heroId: null, connected: true, isLocalStub: false },
    { id: 'h2', name: 'Sam', role: 'hero', heroId: null, connected: true, isLocalStub: false },
  );
  state = applyAction(state, { type: 'pick-hero', playerId: 'h1', heroId: HEROES[0].id }, 'h1').state;
  state = applyAction(state, { type: 'pick-hero', playerId: 'h2', heroId: HEROES[1].id }, 'h2').state;
  state = applyAction(state, { type: 'start-floor', layoutMode: 'fixed' }, dealerId).state;
  return { state, dealerId };
}

describe('resolveFocusedHeroId', () => {
  it('defaults to meId for a hero viewer when no inspected hero is set', () => {
    const { state } = twoHeroState();
    expect(resolveFocusedHeroId(state, { isDealer: false, meId: 'h2', inspectedHeroId: null })).toBe('h2');
  });

  it('defaults to the active turn hero for the dealer when inspectedHeroId is unset or invalid', () => {
    const { state } = twoHeroState();
    expect(resolveFocusedHeroId(state, { isDealer: true, meId: 'dealer-1', inspectedHeroId: null })).toBe('h1');
    expect(
      resolveFocusedHeroId(state, { isDealer: true, meId: 'dealer-1', inspectedHeroId: 'unknown' }),
    ).toBe('h1');
  });

  it('honors a valid inspectedHeroId from the party switcher', () => {
    const { state } = twoHeroState();
    expect(resolveFocusedHeroId(state, { isDealer: false, meId: 'h1', inspectedHeroId: 'h2' })).toBe('h2');
    expect(resolveFocusedHeroId(state, { isDealer: true, meId: 'dealer-1', inspectedHeroId: 'h2' })).toBe('h2');
  });
});

describe('renderTable desktop felt layout hooks', () => {
  it('renders 3-column tabletop shell, map CSS variables, and coachmark targets', () => {
    const { state, dealerId } = twoHeroState();
    const dealerView = publicStateFor(state, dealerId);
    const html = renderTable(dealerView, {
      isDealer: true,
      meId: dealerId,
      roomCode: 'ROOM',
      role: 'dealer',
      status: 'Connected.',
      error: '',
      inspectedHeroId: null,
    });

    expect(html).toContain('table-shell game-layout');
    expect(html).toContain('has-dealer-bar');
    expect(html).toContain('table-header');
    expect(html).toContain('dealer-bar');
    expect(html).toContain('table-board');
    expect(html).toContain('table-col-left');
    expect(html).toContain('table-col-center');
    expect(html).toContain('table-col-right');
    expect(html).toContain(`--map-cols:${dealerView.map.width};--map-rows:${dealerView.map.height}`);
    expect(html).toContain('data-coach="map"');
    expect(html).toContain('data-coach="actions-left"');
    expect(html).toContain('data-coach="side-panel"');
    expect(html).toContain('data-coach="dealer-tools"');
    expect(html).toContain('id="btn-draw-twist"');
    expect(html).not.toContain('dealer-note');
    expect(html).not.toContain('btn-dealer-log');
    expect(html).not.toContain('btn-stunt');
    expect(html).not.toContain('data-story-choice');
  });

  it('omits dealer-bar for hero viewers and hides other heroes hands', () => {
    const { state } = twoHeroState();
    const heroView = publicStateFor(state, 'h1');

    const ownHtml = renderTable(heroView, {
      isDealer: false,
      meId: 'h1',
      roomCode: 'ROOM',
      role: 'hero',
      status: 'Ready.',
      error: '',
      inspectedHeroId: 'h1',
    });
    expect(ownHtml).not.toContain('has-dealer-bar');
    expect(ownHtml).not.toContain('class="dealer-bar"');
    expect(ownHtml).toContain('Your hand');

    const inspectHtml = renderTable(heroView, {
      isDealer: false,
      meId: 'h1',
      roomCode: 'ROOM',
      role: 'hero',
      status: 'Ready.',
      error: '',
      inspectedHeroId: 'h2',
    });
    expect(inspectHtml).toContain('data-inspect-hero="h1"');
    expect(inspectHtml).toContain('data-inspect-hero="h2"');
    const focusZone = inspectHtml.slice(inspectHtml.indexOf('hero-focus-zone'));
    expect(focusZone).toContain('private');
    expect(focusZone).toContain('card-back');
    expect(focusZone).not.toContain("Sir Bumbles's hand is not");
  });

  it('renders boss gather bar when boss chamber is revealed and waiting', () => {
    const { state: base, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const { state } = ensureHeroInKind(base, 'hero-1', 'boss');
    state.map.tiles.find((t) => t.kind === 'boss').cleared = false;
    const view = publicStateFor(state, dealerId);
    const html = renderTable(view, {
      isDealer: true,
      meId: dealerId,
      roomCode: 'TEST',
      role: 'dealer',
      status: 'Ready.',
      error: '',
      inspectedHeroId: null,
    });
    expect(html).toContain('boss-gather-bar');
    expect(html).toContain('data-coach="boss-gather"');
    expect(html).toContain('id="btn-boss-start"');
  });

  it('renders vault gear overlay and A/B-only event overlay inside center felt', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const vaultState = structuredClone(base);
    vaultState.pending = {
      kind: 'vault',
      heroPlayerId,
      tileKey: vaultState.map.tiles[0].key,
      options: [GEAR[3], GEAR[4]],
    };
    const vaultHtml = renderTable(publicStateFor(vaultState, dealerId), {
      isDealer: true,
      meId: dealerId,
      roomCode: 'TEST',
      role: 'dealer',
      status: 'Ready.',
      error: '',
    });
    expect(vaultHtml).toContain('table-prompt-overlay');
    expect(vaultHtml).toContain('card-gear');
    expect(vaultHtml).toContain('data-keep-loot="0"');
    expect(vaultHtml).toContain('data-keep-loot="1"');

    const eventState = structuredClone(base);
    eventState.pending = {
      kind: 'event',
      heroPlayerId,
      tileKey: eventState.map.tiles[0].key,
      event: EVENTS[0],
    };
    const eventHtml = renderTable(publicStateFor(eventState, dealerId), {
      isDealer: true,
      meId: dealerId,
      roomCode: 'TEST',
      role: 'dealer',
      status: 'Ready.',
      error: '',
    });
    expect(eventHtml).toContain('table-prompt-overlay');
    expect(eventHtml).toContain('data-event-choice="a"');
    expect(eventHtml).toContain('data-event-choice="b"');
    expect(eventHtml).not.toContain('improvise');
  });

  it('renders Pry Door Jam only when active hero tile is jammed and dims table during clash', () => {
    const { state: base, heroPlayerId, dealerId } = startExploringFloor({ layoutMode: 'fixed' });
    const heroTileKey = base.heroes[heroPlayerId].roomKey;
    const clearHtml = renderTable(publicStateFor(base, dealerId), {
      isDealer: true,
      meId: dealerId,
      roomCode: 'TEST',
      role: 'dealer',
      status: 'Ready.',
      error: '',
    });
    expect(clearHtml).not.toContain('id="btn-pry-jam"');

    const jammed = structuredClone(base);
    const adj = jammed.map.tiles.find((t) => t.key !== heroTileKey);
    jammed.map.barriers = [{ aKey: heroTileKey, bKey: adj.key }];
    const jammedHtml = renderTable(publicStateFor(jammed, dealerId), {
      isDealer: true,
      meId: dealerId,
      roomCode: 'TEST',
      role: 'dealer',
      status: 'Ready.',
      error: '',
    });
    expect(jammedHtml).toContain('id="btn-pry-jam"');

    const clashState = structuredClone(base);
    clashState.phase = 'clash';
    const clashHtml = renderTable(publicStateFor(clashState, dealerId), {
      isDealer: true,
      meId: dealerId,
      roomCode: 'TEST',
      role: 'dealer',
      status: 'Ready.',
      error: '',
    });
    expect(clashHtml).toContain('clash-dimmed');
  });
});

describe('click-to-carry downed hero UI', () => {
  it('shows Carry button when sharing a room with a downed ally and >= 2 actions', () => {
    const { state } = twoHeroState();
    const s = structuredClone(state);
    s.heroes.h2.downed = true;
    s.heroes.h2.hp = 0;

    const html = renderTable(publicStateFor(s, 'h1'), {
      isDealer: false,
      meId: 'h1',
      roomCode: 'ROOM',
      role: 'hero',
      status: 'Ready.',
      error: '',
    });
    expect(html).toContain('data-carry="h2"');
    expect(html).toContain('Carry Barnaby Brickwall (2 Actions)');
  });

  it('highlights only adjacent connected unjammed rooms as carry targets and hides move attributes', () => {
    const { state } = twoHeroState();
    const s = structuredClone(state);
    // Move both heroes to a tile that has multiple orthogonal connected neighbors (e.g. (1,1) in fixed 4x4)
    const centerTile = s.map.tiles.find((t) => t.x === 1 && t.y === 1);
    s.heroes.h1.roomKey = centerTile.key;
    s.heroes.h2.roomKey = centerTile.key;
    s.heroes.h2.downed = true;
    s.heroes.h2.hp = 0;

    const neighbors = s.map.tiles.filter(
      (t) => t.key !== centerTile.key && adjacentOrthogonal(centerTile, t) && tilesConnect(centerTile, t),
    );
    expect(neighbors.length).toBeGreaterThanOrEqual(2);
    const blocked = neighbors[0];
    const allowed = neighbors[1];
    s.map.barriers = [{ aKey: centerTile.key, bKey: blocked.key }];
    const farTile = s.map.tiles.find(
      (t) => t.key !== centerTile.key && !adjacentOrthogonal(centerTile, t),
    );

    const html = renderTable(publicStateFor(s, 'h1'), {
      isDealer: false,
      meId: 'h1',
      roomCode: 'ROOM',
      role: 'hero',
      status: 'Ready.',
      error: '',
      carryingTargetId: 'h2',
    });

    expect(html).toContain('carry-mode-bar');
    expect(html).toContain('id="btn-cancel-carry"');
    expect(html).toContain('Barnaby Brickwall');
    expect(html).toContain('has-carry-bar');
    expect(html).toContain('is-carry-target');
    expect(html).toContain(`data-carry-x="${allowed.x}" data-carry-y="${allowed.y}"`);
    expect(html).not.toContain(`data-carry-x="${blocked.x}" data-carry-y="${blocked.y}"`);
    expect(html).not.toContain(`data-carry-x="${farTile.x}" data-carry-y="${farTile.y}"`);
    expect(html).not.toContain('data-move-x=');
  });

  it('shows a downed note when the active hero is downed', () => {
    const { state } = twoHeroState();
    const s = structuredClone(state);
    s.heroes.h1.downed = true;
    s.heroes.h1.hp = 0;

    const html = renderTable(publicStateFor(s, 'h1'), {
      isDealer: false,
      meId: 'h1',
      roomCode: 'ROOM',
      role: 'hero',
      status: 'Ready.',
      error: '',
    });
    expect(html).toContain('table-downed-note');
    expect(html).toContain('DOWNED');
  });
});

describe('right-side hero abilities & belt items panel and Pip half-move UI', () => {
  it('renders full hero ability and dedicated belt items zone with inline Revive and Drink buttons', () => {
    const { state } = twoHeroState();
    const s = structuredClone(state);
    s.heroes.h1.hp = 6;
    s.heroes.h1.belt = [gearRuntimeFromId('G-25'), gearRuntimeFromId('G-27')];
    s.heroes.h2.downed = true;
    s.heroes.h2.hp = 0;
    s.explorationActionsLeft = 1;

    const html = renderTable(publicStateFor(s, 'h1'), {
      isDealer: false,
      meId: 'h1',
      roomCode: 'ROOM',
      role: 'hero',
      status: 'Ready.',
      error: '',
    });

    expect(html).toContain('table-ability-box');
    expect(html).toContain(HEROES[0].perk.text);
    expect(html).toContain('table-belt-zone');
    expect(html).toContain('Wakey-Wakey Smelling Salts');
    expect(html).toContain('Strawberry Fizz Potion');
    expect(html).toContain('data-use-belt="0"');
    expect(html).toContain('data-belt-target="h2"');
    expect(html).toContain('data-use-belt="1"');

    // Even at 0 actions left, free Fizz Potion Drink button stays usable
    s.explorationActionsLeft = 0;
    const zeroHtml = renderTable(publicStateFor(s, 'h1'), {
      isDealer: false,
      meId: 'h1',
      roomCode: 'ROOM',
      role: 'hero',
      status: 'Ready.',
      error: '',
    });
    expect(zeroHtml).toContain('data-use-belt="1"');
  });

  it('shows 0/2 empty belt message when hero carries no belt items', () => {
    const { state } = twoHeroState();
    const html = renderTable(publicStateFor(state, 'h1'), {
      isDealer: false,
      meId: 'h1',
      roomCode: 'ROOM',
      role: 'hero',
      status: 'Ready.',
      error: '',
    });
    expect(html).toContain('table-belt-zone');
    expect(html).toContain('0/2');
  });

  it('Pip Squeak with 0.5 actions left only highlights face-up cleared safe rooms as clickable', () => {
    const dealerId = 'dealer-1';
    let state = createEmptyState('ROOM', dealerId, 'Dealer');
    state.players.push({ id: 'h1', name: 'Pip', role: 'hero', heroId: 'H-03', connected: true });
    state = applyAction(state, { type: 'pick-hero', playerId: 'h1', heroId: 'H-03' }, 'h1').state;
    state = applyAction(state, { type: 'start-floor', layoutMode: 'fixed' }, dealerId).state;

    const center = state.map.tiles.find((t) => t.x === 1 && t.y === 1);
    const neighbors = state.map.tiles.filter(
      (t) => t.key !== center.key && adjacentOrthogonal(center, t) && tilesConnect(center, t),
    );
    const clearedNeighbor = neighbors[0];
    const hiddenNeighbor = neighbors[1];
    clearedNeighbor.faceUp = true;
    clearedNeighbor.cleared = true;
    clearedNeighbor.kind = 'vault';
    hiddenNeighbor.faceUp = false;
    hiddenNeighbor.cleared = false;
    state.heroes.h1.roomKey = center.key;
    state.explorationActionsLeft = 0.5;

    const html = renderTable(publicStateFor(state, 'h1'), {
      isDealer: false,
      meId: 'h1',
      roomCode: 'ROOM',
      role: 'hero',
      status: 'Ready.',
      error: '',
    });
    expect(html).toContain(`data-move-x="${clearedNeighbor.x}" data-move-y="${clearedNeighbor.y}"`);
    expect(html).not.toContain(`data-move-x="${hiddenNeighbor.x}" data-move-y="${hiddenNeighbor.y}"`);
  });
});

describe('defeat banner, disabled combat twist, and stale lobby status (virtual_04, virtual_12, virtual_13)', () => {
  it('renders Defeat banner when phase is defeat and sanitizes stale lobby status', () => {
    const { state } = twoHeroState();
    state.phase = 'defeat';
    const html = renderTable(publicStateFor(state, 'h1'), {
      isDealer: false,
      meId: 'h1',
      roomCode: 'ROOM',
      role: 'hero',
      status: 'In lobby for room ROOM.',
      error: '',
    });
    expect(html).toContain('Defeat — Party Wiped!');
    expect(html).not.toContain('In lobby for room ROOM.');
  });

  it('disables Boss Espresso Shot! in Dealer Bar outside clash', () => {
    const { state, dealerId } = twoHeroState();
    state.decks.twistHand = [
      { id: 'TW-08', name: 'Boss Espresso Shot!', effect: 'During combat: +2 HP or +2 cards.' },
    ];
    const html = renderTable(publicStateFor(state, dealerId), {
      isDealer: true,
      meId: dealerId,
      roomCode: 'ROOM',
      role: 'dealer',
      status: 'Floor 1 active.',
      error: '',
    });
    expect(html).toContain('data-play-twist="TW-08" disabled');
  });
});
