import { getHero, getGear, THEMES, BOSSES, bossHp } from '../data/index.js';
import {
  createHeroRuntime,
  buildStubMap,
  prepareFloorDecks,
  pickRandomTheme,
  pickRandomBoss,
  entranceTile,
  tileAt,
  adjacentOrthogonal,
  appendLog,
  publicStateFor,
} from './state.js';

/**
 * Dealer-authoritative reducer. Returns { ok, error?, state }.
 * Mutates a clone; caller replaces state.
 */
export function applyAction(state, action, actorId) {
  const next = structuredClone(state);
  const actor = next.players.find((p) => p.id === actorId);
  if (!actor) return fail(next, 'Unknown actor');

  try {
    switch (action.type) {
      case 'set-name':
        actor.name = String(action.name || actor.name).slice(0, 24);
        appendLog(next, `${actor.name} updated their name.`);
        break;

      case 'join-as-hero': {
        if (next.phase !== 'lobby') return fail(next, 'Game already started');
        if (actor.role === 'dealer') return fail(next, 'Dealer cannot join as hero');
        actor.role = 'hero';
        actor.connected = true;
        appendLog(next, `${actor.name} joined as a Hero.`);
        break;
      }

      case 'add-local-hero': {
        if (actor.role !== 'dealer') return fail(next, 'Only dealer can add local stubs');
        if (next.phase !== 'lobby') return fail(next, 'Game already started');
        if (next.players.filter((p) => p.role === 'hero').length >= 4) {
          return fail(next, 'Max 4 heroes');
        }
        const stubId = `local-${Math.random().toString(36).slice(2, 7)}`;
        next.players.push({
          id: stubId,
          name: action.name || `Local Hero ${next.players.length}`,
          role: 'hero',
          heroId: null,
          connected: true,
          isLocalStub: true,
        });
        appendLog(next, `Dealer added local hero seat: ${action.name || stubId}.`);
        break;
      }

      case 'pick-hero': {
        if (next.phase !== 'lobby') return fail(next, 'Heroes locked after start');
        const targetId = action.playerId || actorId;
        const target = next.players.find((p) => p.id === targetId);
        if (!target || target.role !== 'hero') return fail(next, 'Not a hero seat');
        // Dealer may assign local stubs; heroes assign themselves
        if (actor.role !== 'dealer' && actorId !== targetId) {
          return fail(next, 'Cannot pick for another player');
        }
        const heroDef = getHero(action.heroId);
        if (!heroDef) return fail(next, 'Unknown hero');
        if (next.players.some((p) => p.heroId === action.heroId && p.id !== targetId)) {
          return fail(next, 'Hero already taken');
        }
        target.heroId = action.heroId;
        appendLog(next, `${target.name} chose ${heroDef.name}.`);
        break;
      }

      case 'set-theme': {
        if (actor.role !== 'dealer') return fail(next, 'Dealer only');
        if (!THEMES.some((t) => t.id === action.themeId)) return fail(next, 'Bad theme');
        next.themeId = action.themeId;
        appendLog(next, `Theme set: ${THEMES.find((t) => t.id === action.themeId).name}`);
        break;
      }

      case 'set-boss': {
        if (actor.role !== 'dealer') return fail(next, 'Dealer only');
        if (!BOSSES.some((b) => b.id === action.bossId)) return fail(next, 'Bad boss');
        next.bossId = action.bossId;
        appendLog(next, `Boss set: ${BOSSES.find((b) => b.id === action.bossId).name}`);
        break;
      }

      case 'start-floor': {
        if (actor.role !== 'dealer') return fail(next, 'Dealer only');
        if (next.phase !== 'lobby') return fail(next, 'Already started');
        const heroes = next.players.filter((p) => p.role === 'hero');
        if (heroes.length < 1) return fail(next, 'Need at least 1 hero');
        if (heroes.some((h) => !h.heroId)) return fail(next, 'Every hero must pick a character');

        next.themeId = next.themeId || pickRandomTheme();
        next.bossId = next.bossId || pickRandomBoss();
        next.decks = prepareFloorDecks();
        // Deal 1 starting Twist to dealer (max 3)
        if (next.decks.twists.length) {
          next.decks.twistHand.push(next.decks.twists.shift());
        }
        next.map = buildStubMap();
        const entrance = entranceTile(next);
        const solo = heroes.length === 1;
        next.heroes = {};
        for (const h of heroes) {
          next.heroes[h.id] = createHeroRuntime(h.heroId, solo);
          next.heroes[h.id].roomKey = entrance.key;
          // Deal 4 action cards
          for (let i = 0; i < 4; i += 1) {
            if (next.decks.action.length) {
              next.heroes[h.id].hand.push(next.decks.action.shift());
            }
          }
        }
        next.turnOrder = heroes.map((h) => h.id);
        next.activeHeroIndex = 0;
        next.explorationActionsLeft = 2;
        next.phase = 'exploring';
        const theme = THEMES.find((t) => t.id === next.themeId);
        const boss = BOSSES.find((b) => b.id === next.bossId);
        appendLog(
          next,
          `Floor 1 begins! Theme: ${theme.name}. Boss waiting: ${boss.name} (${bossHp(next.bossId, heroes.length)} HP).`,
        );
        appendLog(next, `${heroes[0].name}'s turn — 2 Exploration Actions.`);
        break;
      }

      case 'move': {
        if (next.phase !== 'exploring') return fail(next, 'Not exploring');
        const heroPid = resolveHeroActor(next, actor, action.playerId);
        if (!heroPid) return fail(next, 'Not your turn / not a hero');
        if (next.turnOrder[next.activeHeroIndex] !== heroPid && actor.role !== 'dealer') {
          return fail(next, 'Not this hero\'s turn');
        }
        if (actor.role === 'dealer' && action.playerId) {
          // dealer may puppet local stubs or help
        } else if (actor.role !== 'dealer' && heroPid !== actorId) {
          return fail(next, 'Not your hero');
        }
        if (next.explorationActionsLeft < 1) return fail(next, 'No exploration actions left');

        const hero = next.heroes[heroPid];
        if (hero.downed) return fail(next, 'DOWNED heroes cannot move');
        const from = next.map.tiles.find((t) => t.key === hero.roomKey);
        const to = tileAt(next, action.x, action.y);
        if (!from || !to) return fail(next, 'Invalid tile');
        if (!adjacentOrthogonal(from, to)) return fail(next, 'Must move orthogonally 1 room');

        hero.roomKey = to.key;
        next.explorationActionsLeft -= 1;
        const playerName = next.players.find((p) => p.id === heroPid).name;

        if (!to.faceUp) {
          to.faceUp = true;
          appendLog(next, `${playerName} reveals ${to.name}!`);
          if (to.kind === 'monster' || to.kind === 'boss') {
            // Movement stops; remaining actions lost
            next.explorationActionsLeft = 0;
            startClashStub(next, heroPid, to);
          } else if (to.kind === 'trap') {
            appendLog(next, `Trap room! (Event resolution stub — Dealer narrates E-deck.)`);
          } else if (to.kind === 'story') {
            appendLog(next, `Story / Cart room! (Merchant/Story stub — Dealer draws.)`);
          } else {
            to.cleared = true;
          }
        } else {
          appendLog(next, `${playerName} moves to ${to.name}.`);
        }

        if (next.phase === 'exploring' && next.explorationActionsLeft <= 0 && !next.clash) {
          endHeroExplorationTurn(next);
        }
        break;
      }

      case 'end-turn': {
        if (next.phase !== 'exploring') return fail(next, 'Not exploring');
        const heroPid = resolveHeroActor(next, actor, action.playerId);
        if (!heroPid) return fail(next, 'Not a hero');
        if (next.turnOrder[next.activeHeroIndex] !== heroPid && actor.role !== 'dealer') {
          return fail(next, 'Not your turn');
        }
        endHeroExplorationTurn(next);
        break;
      }

      case 'resolve-clash-stub': {
        // Minimal: dealer marks monster poof / flee for architecture demo
        if (actor.role !== 'dealer') return fail(next, 'Dealer only');
        if (next.phase !== 'clash' || !next.clash) return fail(next, 'No active clash');
        const hero = next.heroes[next.clash.heroPlayerId];
        const tile = next.map.tiles.find((t) => t.key === next.clash.roomKey);
        if (action.result === 'win') {
          appendLog(next, `${next.clash.monsterName} goes POOF! ${hero.name} wins the clash.`);
          if (tile) {
            tile.cleared = true;
          }
          // Clear cramps from hand
          hero.hand = hero.hand.filter((c) => c.type !== 'cramp');
          next.clash = null;
          next.phase = 'exploring';
          next.explorationActionsLeft = 0;
          endHeroExplorationTurn(next);
        } else if (action.result === 'flee') {
          appendLog(next, `${hero.name} slips away from ${next.clash.monsterName} (stub flee).`);
          next.clash = null;
          next.phase = 'exploring';
          next.explorationActionsLeft = 0;
          endHeroExplorationTurn(next);
        } else {
          return fail(next, 'Unknown clash result');
        }
        break;
      }

      case 'dealer-log': {
        if (actor.role !== 'dealer') return fail(next, 'Dealer only');
        appendLog(next, `Dealer: ${String(action.message || '').slice(0, 120)}`);
        break;
      }

      case 'mark-connected': {
        actor.connected = Boolean(action.connected);
        break;
      }

      default:
        return fail(next, `Unknown action ${action.type}`);
    }
  } catch (err) {
    return fail(state, err.message || String(err));
  }

  next.version = (state.version || 0) + 1;
  return { ok: true, state: next };
}

function fail(state, error) {
  return { ok: false, error, state };
}

function resolveHeroActor(state, actor, playerId) {
  if (actor.role === 'hero') return actor.id;
  if (actor.role === 'dealer' && playerId) return playerId;
  if (actor.role === 'dealer') return state.turnOrder[state.activeHeroIndex];
  return null;
}

function startClashStub(state, heroPlayerId, tile) {
  state.phase = 'clash';
  let monsterName = 'Mystery Critter';
  let monsterHp = 4;
  let cunning = 3;
  let baseDmg = 1;
  let monsterId = null;

  if (tile.kind === 'boss') {
    const boss = BOSSES.find((b) => b.id === state.bossId) || BOSSES[0];
    const heroCount = Object.keys(state.heroes).length;
    monsterName = boss.name;
    monsterHp = bossHp(boss.id, heroCount);
    cunning = boss.cunning;
    baseDmg = boss.baseDmg;
    monsterId = boss.id;
  } else if (state.decks.monsters.length) {
    const m = state.decks.monsters.shift();
    monsterName = m.name;
    monsterHp = m.hp;
    cunning = m.cunning;
    baseDmg = m.baseDmg;
    monsterId = m.id;
  }

  const hero = state.heroes[heroPlayerId];
  // Top up hand to 4
  while (hero.hand.filter((c) => c.type !== 'cramp').length < 4 && state.decks.action.length) {
    hero.hand.push(state.decks.action.shift());
  }

  const monsterHand = [];
  for (let i = 0; i < cunning && state.decks.action.length; i += 1) {
    monsterHand.push(state.decks.action.shift());
  }

  state.clash = {
    roomKey: tile.key,
    heroPlayerId,
    monsterId,
    monsterName,
    monsterHp,
    monsterMaxHp: monsterHp,
    baseDmg,
    cunning,
    monsterHand,
    activeSuit: null,
    activeRank: null,
    note: 'Clash stub — full card matching UI comes later. Dealer can Resolve Win / Flee.',
  };
  appendLog(state, `Clash! ${hero.name} vs ${monsterName} (${monsterHp} HP, Cunning ${cunning}).`);
}

function endHeroExplorationTurn(state) {
  if (!state.turnOrder.length) return;
  state.activeHeroIndex = (state.activeHeroIndex + 1) % state.turnOrder.length;
  state.explorationActionsLeft = 2;
  const nextId = state.turnOrder[state.activeHeroIndex];
  const p = state.players.find((x) => x.id === nextId);
  appendLog(state, `${p?.name || 'Hero'}'s turn — 2 Exploration Actions.`);
}

export function viewForPlayer(state, playerId) {
  return publicStateFor(state, playerId);
}

export function gearLabel(id) {
  return getGear(id)?.name || id;
}
