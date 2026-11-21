/**
 * Smoke-test Floor 1 rules wiring (no browser).
 * Run: node scripts/smoke-rules.mjs
 */
import { createEmptyState, nextPlayerId } from '../src/game/state.js';
import { applyAction } from '../src/game/authority.js';
import { isLegalPlay, classifyPlay } from '../src/game/clash.js';
import { DESPERATION, MONSTERS, BOSSES } from '../src/data/index.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const dealerId = nextPlayerId('dealer');
let state = createEmptyState('TEST', dealerId, 'Dealer');

let r = applyAction(state, { type: 'add-local-hero', name: 'Hero A' }, dealerId);
assert(r.ok, r.error);
state = r.state;
const heroA = state.players.find((p) => p.isLocalStub).id;

r = applyAction(state, { type: 'add-local-hero', name: 'Hero B' }, dealerId);
assert(r.ok, r.error);
state = r.state;
const heroB = state.players.filter((p) => p.isLocalStub).map((p) => p.id)[1];

r = applyAction(state, { type: 'pick-hero', playerId: heroA, heroId: 'H-01' }, dealerId);
assert(r.ok, r.error);
state = r.state;
r = applyAction(state, { type: 'pick-hero', playerId: heroB, heroId: 'H-03' }, dealerId);
assert(r.ok, r.error);
state = r.state;

r = applyAction(state, { type: 'set-theme', themeId: 'T-03' }, dealerId);
assert(r.ok, r.error);
state = r.state;
r = applyAction(state, { type: 'set-boss', bossId: 'B-01' }, dealerId);
assert(r.ok, r.error);
state = r.state;

r = applyAction(state, { type: 'start-floor', layoutMode: 'fixed' }, dealerId);
assert(r.ok, `start-floor: ${r.error}`);
state = r.state;
assert(state.phase === 'exploring', 'phase exploring');
assert(state.map.tiles.length === 14, `14 tiles got ${state.map.tiles.length}`);
assert(state.decks.loot.length > 0, 'loot deck');
assert(state.decks.events.length === 6, 'events');
assert(state.decks.twistHand.length === 1, 'starting twist');
assert(state.heroes[heroA].weapon?.strike === 2, 'Bumbles sword strike');
assert(state.heroes[heroB].perk?.id === 'shortcut-tiptoe', 'Pip perk');

// Pip tip-toe: move to adjacent cleared? entrance only cleared at start.
const entrance = state.map.tiles.find((t) => t.kind === 'entrance');
const adj = state.map.tiles.find(
  (t) => Math.abs(t.x - entrance.x) + Math.abs(t.y - entrance.y) === 1,
);
assert(adj, 'adjacent tile');

// Force vault interact after moving somehow — find vault and teleport for unit check
const vault = state.map.tiles.find((t) => t.kind === 'vault');
vault.faceUp = true;
vault.cleared = true;
state.heroes[heroA].roomKey = vault.key;
state.turnOrder = [heroA, heroB];
state.activeHeroIndex = 0;
state.explorationActionsLeft = 2;

r = applyAction(state, { type: 'interact', subtype: 'vault', playerId: heroA }, dealerId);
assert(r.ok, `vault: ${r.error}`);
state = r.state;
assert(state.pending?.kind === 'vault', 'vault pending');
assert(state.pending.options.length >= 1, 'loot options');
r = applyAction(state, { type: 'resolve-pending', keepIndex: 0 }, dealerId);
assert(r.ok, `keep loot: ${r.error}`);
state = r.state;

// Desperation card ids complete
assert(DESPERATION.length === 20, '20 desperation');
assert(MONSTERS.every((m) => m.traitId), 'monster traitIds');
assert(BOSSES.every((b) => b.traitId), 'boss traitIds');

// Clash legality + Big Swing
const clash = {
  activeSuit: 'brawn',
  activeRank: 3,
  traitId: 'unpaid-overtime',
};
assert(isLegalPlay({ type: 'rank', suit: 'brawn', rank: 2 }, clash), 'lower brawn legal');
assert(
  classifyPlay({ type: 'rank', suit: 'brawn', rank: 2 }, clash, { bigSwing: true }) === 'parry' ||
    classifyPlay({ type: 'rank', suit: 'brawn', rank: 2 }, clash, { bigSwing: true }) === 'clean' ||
    classifyPlay({ type: 'rank', suit: 'brawn', rank: 2 }, clash, { bigSwing: true }) === 'guard',
  'big swing classifies',
);
assert(
  classifyPlay({ type: 'rank', suit: 'brawn', rank: 2 }, clash, { bigSwing: true }) === 'parry',
  'big swing 2+1 = parry vs 3',
);

// Start a monster clash via action
const lair = state.map.tiles.find((t) => t.kind === 'monster' && !t.faceUp);
assert(lair, 'monster lair');
// Place hero adjacent and move in
const lairAdj = state.map.tiles.find(
  (t) =>
    t.faceUp &&
    Math.abs(t.x - lair.x) + Math.abs(t.y - lair.y) === 1,
);
if (lairAdj) {
  state.heroes[heroA].roomKey = lairAdj.key;
  state.phase = 'exploring';
  state.clash = null;
  state.pending = null;
  state.turnOrder = [heroA, heroB];
  state.activeHeroIndex = 0;
  state.explorationActionsLeft = 2;
  r = applyAction(state, { type: 'move', x: lair.x, y: lair.y, playerId: heroA }, dealerId);
  assert(r.ok, `move into lair: ${r.error}`);
  state = r.state;
  assert(state.phase === 'clash', 'entered clash');
  assert(state.clash.traitId, `trait wired: ${state.clash.trait}`);
  assert(state.clash.fighters.length === 1, 'one fighter');

  // Desperation
  r = applyAction(state, { type: 'clash-desperation' }, dealerId);
  assert(r.ok, `desperation: ${r.error}`);
  state = r.state;
}

// Stunt
if (state.phase === 'exploring' || state.phase === 'clash') {
  // end clash if needed
  if (state.clash) {
    r = applyAction(state, { type: 'resolve-clash-stub', result: 'flee' }, dealerId);
    state = r.state;
  }
}
state.phase = 'exploring';
state.pending = null;
state.explorationActionsLeft = 2;
state.activeHeroIndex = 0;
state.turnOrder = [heroA, heroB];
r = applyAction(
  state,
  { type: 'stunt', playerId: heroA, suit: 'zip', target: 3, purpose: 'peek' },
  dealerId,
);
assert(r.ok, `stunt: ${r.error}`);
state = r.state;

// Twist sticky door
if (state.decks.twistHand.length === 0 && state.decks.twists.length) {
  state.decks.twistHand.push(state.decks.twists.find((t) => /Sticky/i.test(t.name)) || state.decks.twists[0]);
}
const sticky = state.decks.twistHand.find((t) => /Sticky/i.test(t.name));
if (sticky) {
  r = applyAction(state, { type: 'play-twist', twistId: sticky.id }, dealerId);
  assert(r.ok, `sticky twist: ${r.error}`);
  state = r.state;
  assert((state.map.barriers || []).length >= 1, 'barrier placed');
}

// Finish floor heal
r = applyAction(state, { type: 'end-floor' }, dealerId);
assert(r.ok, `end-floor: ${r.error}`);
state = r.state;
assert(state.phase === 'victory', 'victory');
assert(state.heroes[heroA].hp >= 1, 'hero alive-ish');

console.log('smoke-rules: OK');
