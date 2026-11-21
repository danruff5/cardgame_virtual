import {
  getHero,
  getGear,
  THEMES,
  BOSSES,
  bossHp,
  STORIES,
  gearByTier,
} from '../data/index.js';
import {
  createHeroRuntime,
  buildFloorMap,
  prepareFloorDecks,
  pickRandomTheme,
  pickRandomBoss,
  entranceTile,
  tileAt,
  adjacentOrthogonal,
  tilesConnect,
  appendLog,
  publicStateFor,
} from './state.js';
import {
  isLegalPlay,
  isCramp,
  isWild,
  isSpecial,
  classifyPlay,
  applyLeadCard,
  afterPlayUpdateActive,
  heroHasLegalPlay,
  pickMonsterPlay,
  weaponStrike,
} from './clash.js';

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
        next.layoutMode = action.layoutMode === 'fixed' ? 'fixed' : 'random';
        next.decks = prepareFloorDecks();
        next.storyStack = [];
        next.pending = null;
        // Deal 1 starting Twist to dealer (max 3)
        if (next.decks.twists.length) {
          next.decks.twistHand.push(next.decks.twists.shift());
        }
        next.map = buildFloorMap(next.layoutMode);
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
        next.floor = { bossDefeated: false, stairsUnlocked: false, shinyKey: false };
        const theme = THEMES.find((t) => t.id === next.themeId);
        const boss = BOSSES.find((b) => b.id === next.bossId);
        const stairsDist = next.map.stairsDistance ?? '?';
        appendLog(
          next,
          `Floor 1 begins! Theme: ${theme.name}. Boss waiting: ${boss.name} (${bossHp(next.bossId, heroes.length)} HP).`,
        );
        appendLog(
          next,
          next.layoutMode === 'random'
            ? `Map auto-randomized (${next.map.tiles.length} rooms, stairs ${stairsDist} steps from entrance).`
            : `Map uses fixed snake layout (manual-style placeholder) — stairs ${stairsDist} steps away.`,
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
        if (!tilesConnect(from, to)) return fail(next, 'Doorways do not align');
        if (next.pending) return fail(next, 'Resolve the pending room prompt first');

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
            beginEventPrompt(next, heroPid, to);
          } else if (to.kind === 'story') {
            beginStoryOrMerchant(next, heroPid, to);
          } else if (to.kind === 'stairs') {
            to.cleared = true;
            if (to.locked || !next.floor?.stairsUnlocked) {
              appendLog(next, `Stairs are locked — defeat the Floor Boss (or Dealer unlocks via key/stunt).`);
            }
          } else {
            to.cleared = true;
          }
        } else {
          appendLog(next, `${playerName} moves to ${to.name}.`);
        }

        // Unlocked Stairway Down: stepping on ends the floor (rulebook §5).
        if (
          next.phase === 'exploring' &&
          to.kind === 'stairs' &&
          next.floor?.stairsUnlocked &&
          !to.locked
        ) {
          finishFloor(next, `${playerName} takes the Spiral Slide / Stairway Down!`);
          break;
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

      case 'clash-play': {
        if (next.phase !== 'clash' || !next.clash) return fail(next, 'No active clash');
        const clash = next.clash;
        if (clash.whoseTurn !== 'hero') return fail(next, 'Not hero combat turn');
        const heroPid = clash.heroPlayerId;
        if (actor.role !== 'dealer' && actorId !== heroPid) return fail(next, 'Not your clash');
        const hero = next.heroes[heroPid];
        if (clash.heroDazed) {
          clash.heroDazed = false;
          appendLog(next, `${hero.name} is Dazed and misses this turn!`);
          clash.whoseTurn = 'monster';
          clash.needsDraw = false;
          break;
        }
        // Mandatory turn draw once
        if (clash.needsDraw) {
          drawAction(next, hero);
          clash.needsDraw = false;
        }
        const card = hero.hand.find((c) => c.id === action.cardId);
        if (!card) return fail(next, 'Card not in hand');
        if (isCramp(card)) return fail(next, 'Cannot play Cramp! onto Clash Pile');
        if (!isLegalPlay(card, clash)) return fail(next, 'Illegal play (need matching Suit or Rank)');

        hero.hand = hero.hand.filter((c) => c.id !== card.id);
        const outcome = resolveHeroCardPlay(next, hero, card, action.wildSuit);
        if (outcome === 'again') {
          // Daze! — hero plays again
          clash.needsDraw = false;
          clash.whoseTurn = 'hero';
        } else {
          clash.whoseTurn = 'monster';
          clash.needsDraw = false;
        }
        if (clash.monsterHp <= 0) {
          endClashVictory(next);
        }
        break;
      }

      case 'clash-clear-cramp': {
        if (next.phase !== 'clash' || !next.clash) return fail(next, 'No active clash');
        const clash = next.clash;
        if (clash.whoseTurn !== 'hero') return fail(next, 'Not hero combat turn');
        const hero = next.heroes[clash.heroPlayerId];
        if (actor.role !== 'dealer' && actorId !== clash.heroPlayerId) return fail(next, 'Not your clash');
        if (clash.needsDraw) {
          drawAction(next, hero);
          clash.needsDraw = false;
        }
        const cramps = hero.hand.filter((c) => isCramp(c)).slice(0, 2);
        if (!cramps.length) return fail(next, 'No Cramp! cards to stretch');
        const ids = new Set(cramps.map((c) => c.id));
        hero.hand = hero.hand.filter((c) => !ids.has(c.id));
        appendLog(next, `${hero.name} stretches — discards ${cramps.length} Cramp!`);
        clash.whoseTurn = 'monster';
        break;
      }

      case 'clash-desperation': {
        if (next.phase !== 'clash' || !next.clash) return fail(next, 'No active clash');
        const clash = next.clash;
        if (clash.whoseTurn !== 'hero') return fail(next, 'Not hero combat turn');
        const hero = next.heroes[clash.heroPlayerId];
        if (actor.role !== 'dealer' && actorId !== clash.heroPlayerId) return fail(next, 'Not your clash');
        if (clash.needsDraw) {
          drawAction(next, hero);
          clash.needsDraw = false;
        }
        // Allow desperation even with legal cards (hoarding) — per rules
        resolveDesperation(next, hero);
        clash.whoseTurn = 'monster';
        if (clash.monsterHp <= 0) endClashVictory(next);
        if (hero.hp <= 0) knockDownHero(next, hero);
        break;
      }

      case 'clash-monster-turn': {
        if (actor.role !== 'dealer') return fail(next, 'Dealer only');
        if (next.phase !== 'clash' || !next.clash) return fail(next, 'No active clash');
        const clash = next.clash;
        if (clash.whoseTurn !== 'monster') return fail(next, 'Not monster turn');
        const hero = next.heroes[clash.heroPlayerId];
        if (clash.monsterDazed) {
          clash.monsterDazed = false;
          appendLog(next, `${clash.monsterName} is Dazed and misses!`);
          clash.whoseTurn = 'hero';
          clash.needsDraw = true;
          break;
        }
        // Monster draws 1
        if (next.decks.action.length) {
          clash.monsterHand.push(next.decks.action.shift());
        }
        const pick = pickMonsterPlay(clash.monsterHand, clash);
        if (!pick) {
          appendLog(next, `${clash.monsterName} Fumbles! (no legal play) — draws to recover.`);
          if (next.decks.action.length) clash.monsterHand.push(next.decks.action.shift());
        } else {
          clash.monsterHand = clash.monsterHand.filter((c) => c.id !== pick.id);
          resolveMonsterCardPlay(next, hero, pick);
        }
        if (hero.hp <= 0) {
          knockDownHero(next, hero);
        } else if (clash.monsterHp <= 0) {
          endClashVictory(next);
        } else {
          clash.whoseTurn = 'hero';
          clash.needsDraw = true;
        }
        break;
      }

      case 'resolve-clash-stub': {
        // Dealer override (win/flee) still available
        if (actor.role !== 'dealer') return fail(next, 'Dealer only');
        if (next.phase !== 'clash' || !next.clash) return fail(next, 'No active clash');
        const hero = next.heroes[next.clash.heroPlayerId];
        if (action.result === 'win') {
          appendLog(next, `Dealer resolves: ${next.clash.monsterName} goes POOF!`);
          endClashVictory(next);
        } else if (action.result === 'flee') {
          appendLog(next, `${hero.name} slips away from ${next.clash.monsterName} (flee).`);
          cleanupClash(next, { victory: false });
        } else {
          return fail(next, 'Unknown clash result');
        }
        break;
      }

      case 'unlock-stairs': {
        // Dealer adjudicates 5+ Zip/Brawn key stunt, or recovers after a missed boss-win flag.
        if (actor.role !== 'dealer') return fail(next, 'Dealer only');
        if (next.phase === 'lobby' || next.phase === 'victory') {
          return fail(next, 'No active floor');
        }
        unlockStairs(next, action.reason || 'Dealer unlocks the stairs (key / 5+ stunt).');
        break;
      }

      case 'end-floor': {
        if (actor.role !== 'dealer') return fail(next, 'Dealer only');
        if (next.phase === 'lobby') return fail(next, 'Floor not started');
        if (next.phase === 'victory') return fail(next, 'Floor already ended');
        if (next.clash) {
          next.clash = null;
        }
        if (!next.floor?.stairsUnlocked) {
          unlockStairs(next, 'Dealer ends the floor and unlocks the stairs.');
        }
        finishFloor(next, action.message || 'Dealer calls the floor — celebrate or prep Floor 2!');
        break;
      }

      case 'dealer-log': {
        if (actor.role !== 'dealer') return fail(next, 'Dealer only');
        appendLog(next, `Dealer: ${String(action.message || '').slice(0, 120)}`);
        break;
      }

      case 'interact': {
        if (next.phase !== 'exploring') return fail(next, 'Not exploring');
        if (next.pending) return fail(next, 'Resolve the pending prompt first');
        const heroPid = resolveHeroActor(next, actor, action.playerId);
        if (!heroPid) return fail(next, 'Not a hero');
        if (next.turnOrder[next.activeHeroIndex] !== heroPid && actor.role !== 'dealer') {
          return fail(next, 'Not your turn');
        }
        if (next.explorationActionsLeft < 1) return fail(next, 'No exploration actions left');
        const hero = next.heroes[heroPid];
        if (hero.downed && action.subtype !== 'revive') return fail(next, 'DOWNED heroes cannot interact');
        const tile = next.map.tiles.find((t) => t.key === hero.roomKey);
        if (!tile?.faceUp) return fail(next, 'Must be in a face-up room');
        const playerName = next.players.find((p) => p.id === heroPid)?.name || 'Hero';

        if (action.subtype === 'vault') {
          if (tile.kind !== 'vault') return fail(next, 'Not in a vault');
          if (tile.looted) return fail(next, 'Vault already emptied');
          const drawn = drawLoot(next, 2);
          if (drawn.length < 1) return fail(next, 'Loot deck empty');
          next.explorationActionsLeft -= 1;
          next.pending = {
            kind: 'vault',
            heroPlayerId: heroPid,
            tileKey: tile.key,
            options: drawn,
          };
          appendLog(next, `${playerName} rummages the vault — pick 1 of ${drawn.length} loot cards.`);
          break;
        }

        if (action.subtype === 'shrine') {
          if (tile.kind !== 'shrine') return fail(next, 'Not at the Sanctuary');
          if (hero.shrineUsedThisFloor) return fail(next, 'Already rested at Sanctuary this floor');
          next.explorationActionsLeft -= 1;
          hero.shrineUsedThisFloor = true;
          hero.hp = Math.min(hero.maxHp, hero.hp + 3);
          appendLog(next, `${playerName} rests at the Cozy Cocoa Sanctuary (+3 HP → ${hero.hp}).`);
          maybeEndExplore(next);
          break;
        }

        if (action.subtype === 'revive') {
          if (tile.kind !== 'shrine') return fail(next, 'Revive ally at Sanctuary');
          const targetId = action.targetPlayerId;
          const ally = next.heroes[targetId];
          if (!ally?.downed) return fail(next, 'Target must be DOWNED in this room');
          if (ally.roomKey !== tile.key) return fail(next, 'Ally must share your room');
          if (hero.shrineUsedThisFloor && heroPid === targetId) {
            return fail(next, 'Already used Sanctuary this floor');
          }
          // Free revive per R-03 / rulebook §3 — costs the Interact action
          next.explorationActionsLeft -= 1;
          hero.shrineUsedThisFloor = true;
          ally.downed = false;
          ally.hp = 5;
          ally.hand = [];
          for (let i = 0; i < 4; i += 1) drawAction(next, ally);
          appendLog(next, `${playerName} revives ${ally.name} at the Sanctuary (5 HP + 4 cards).`);
          maybeEndExplore(next);
          break;
        }

        if (action.subtype === 'merchant') {
          if (!tile.merchant) return fail(next, 'No merchant here');
          next.explorationActionsLeft -= 1;
          // Bundle deal: discard 1 belt consumable → draw 2 loot keep 1
          const beltIdx = Number(action.beltIndex);
          if (!Number.isInteger(beltIdx) || !hero.belt?.[beltIdx]) {
            return fail(next, 'Pick a belt item to trade');
          }
          const traded = hero.belt.splice(beltIdx, 1)[0];
          const drawn = drawLoot(next, 2);
          if (!drawn.length) {
            hero.belt.push(traded);
            return fail(next, 'Loot deck empty');
          }
          next.pending = {
            kind: 'vault',
            heroPlayerId: heroPid,
            tileKey: tile.key,
            options: drawn,
            tradedName: traded.name,
          };
          appendLog(
            next,
            `${playerName} trades ${traded.name} with ${tile.merchant.name} — pick 1 loot.`,
          );
          break;
        }

        if (action.subtype === 'hallway') {
          if (tile.kind !== 'hallway') return fail(next, 'Not in a hallway');
          if (tile.hallwayEchoUsed) return fail(next, 'Echo stunt already used here');
          next.explorationActionsLeft -= 1;
          tile.hallwayEchoUsed = true;
          // Auto-success proxy for 4+ Spark/Zip (digital table — dealer can narrate fail via log)
          drawAction(next, hero);
          appendLog(next, `${playerName} echoes down the hallway — draws 1 Action card.`);
          maybeEndExplore(next);
          break;
        }

        if (action.subtype === 'use-consumable') {
          const beltIdx = Number(action.beltIndex);
          const item = hero.belt?.[beltIdx];
          if (!item) return fail(next, 'No belt item');
          const def = getGear(item.id || item.gearId);
          if (!def) return fail(next, 'Unknown consumable');
          if (def.type === 'heal') {
            hero.belt.splice(beltIdx, 1);
            hero.hp = Math.min(hero.maxHp, hero.hp + (def.heal || 4));
            appendLog(next, `${playerName} sips ${def.name} (+${def.heal || 4} HP → ${hero.hp}).`);
            break;
          }
          if (def.type === 'revive') {
            const targetId = action.targetPlayerId || heroPid;
            const ally = next.heroes[targetId];
            if (!ally?.downed || ally.roomKey !== hero.roomKey) {
              return fail(next, 'Need a DOWNED ally in your room');
            }
            next.explorationActionsLeft -= 1;
            hero.belt.splice(beltIdx, 1);
            ally.downed = false;
            ally.hp = 4;
            ally.hand = [];
            for (let i = 0; i < 4; i += 1) drawAction(next, ally);
            appendLog(next, `${playerName} uses ${def.name} — ${ally.name} wakes at 4 HP.`);
            maybeEndExplore(next);
            break;
          }
          return fail(next, 'That belt item is not usable here');
        }

        return fail(next, `Unknown interact ${action.subtype}`);
      }

      case 'resolve-pending': {
        if (!next.pending) return fail(next, 'Nothing pending');
        const pending = next.pending;
        const heroPid = pending.heroPlayerId;
        const hero = next.heroes[heroPid];
        if (!hero) return fail(next, 'Missing hero');
        if (actor.role !== 'dealer' && actorId !== heroPid) return fail(next, 'Not your prompt');

        if (pending.kind === 'vault') {
          const keep = Number(action.keepIndex);
          if (!Number.isInteger(keep) || keep < 0 || keep >= pending.options.length) {
            return fail(next, 'Pick a loot card to keep');
          }
          const kept = pending.options[keep];
          for (let i = 0; i < pending.options.length; i += 1) {
            if (i === keep) continue;
            next.decks.lootDiscard = next.decks.lootDiscard || [];
            next.decks.lootDiscard.push(pending.options[i]);
          }
          grantLootToHero(next, hero, kept);
          const tile = next.map.tiles.find((t) => t.key === pending.tileKey);
          if (tile?.kind === 'vault') tile.looted = true;
          next.pending = null;
          appendLog(next, `${hero.name} keeps ${kept.name}.`);
          maybeEndExplore(next);
          break;
        }

        if (pending.kind === 'event') {
          const choice = String(action.choice || 'a').toLowerCase();
          applyEventChoice(next, hero, pending.event, choice);
          const tile = next.map.tiles.find((t) => t.key === pending.tileKey);
          if (tile) {
            tile.cleared = true;
            tile.eventResolved = true;
          }
          next.pending = null;
          maybeEndExplore(next);
          break;
        }

        if (pending.kind === 'story') {
          const choice = String(action.choice || 'a').toLowerCase();
          applyStoryChoice(next, hero, pending.story, choice, pending.tileKey);
          next.pending = null;
          maybeEndExplore(next);
          break;
        }

        return fail(next, `Unknown pending ${pending.kind}`);
      }

      case 'play-twist': {
        if (actor.role !== 'dealer') return fail(next, 'Dealer only');
        const twistId = action.twistId;
        const hand = next.decks.twistHand || [];
        const idx = hand.findIndex((t) => t.id === twistId);
        if (idx < 0) return fail(next, 'Twist not in hand');
        const twist = hand.splice(idx, 1)[0];
        applyTwist(next, twist, action);
        break;
      }

      case 'draw-twist': {
        if (actor.role !== 'dealer') return fail(next, 'Dealer only');
        drawTwist(next, action.reason || 'Dealer draws a Twist');
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
  let trait = '';
  let lootText = '';

  if (tile.kind === 'boss') {
    const boss = BOSSES.find((b) => b.id === state.bossId) || BOSSES[0];
    const heroCount = Object.keys(state.heroes).length;
    monsterName = boss.name;
    monsterHp = bossHp(boss.id, heroCount);
    cunning = boss.cunning;
    baseDmg = boss.baseDmg;
    monsterId = boss.id;
    trait = boss.trait;
    lootText = boss.reward || '';
  } else if (state.decks.monsters.length) {
    const m = state.decks.monsters.shift();
    monsterName = m.name;
    monsterHp = m.hp;
    cunning = m.cunning;
    baseDmg = m.baseDmg;
    monsterId = m.id;
    trait = m.trait;
    lootText = m.loot || '';
  }

  const hero = state.heroes[heroPlayerId];
  hero.perkUsedThisClash = false;
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
    trait,
    lootText,
    monsterHand,
    isBoss: tile.kind === 'boss',
    activeSuit: null,
    activeRank: null,
    pile: [],
    topCard: null,
    whoseTurn: 'hero',
    needsDraw: false,
    heroDazed: false,
    monsterDazed: false,
    ignoredFirstHit: false,
    note: 'Monster leads — then play matching Suit or Rank (or Wild / Desperation).',
  };

  // Monster leads (telegraph)
  if (monsterHand.length) {
    const lead = monsterHand.shift();
    state.clash.monsterHand = monsterHand;
    applyLeadCard(state.clash, lead);
    appendLog(
      state,
      `Clash! ${hero.name} vs ${monsterName} (${monsterHp} HP). ${monsterName} leads ${cardLabel(lead)}.`,
    );
  } else {
    appendLog(state, `Clash! ${hero.name} vs ${monsterName} (${monsterHp} HP).`);
  }
  state.clash.whoseTurn = 'hero';
  state.clash.needsDraw = true;
}

function drawAction(state, hero) {
  reshuffleActionIfNeeded(state);
  if (state.decks.action.length) {
    const c = state.decks.action.shift();
    hero.hand.push(c);
    return c;
  }
  return null;
}

function reshuffleActionIfNeeded(state) {
  if (state.decks.action.length) return;
  if (!state.decks.actionDiscard?.length) return;
  state.decks.action = state.decks.actionDiscard.splice(0);
  // simple shuffle
  for (let i = state.decks.action.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.decks.action[i], state.decks.action[j]] = [state.decks.action[j], state.decks.action[i]];
  }
  appendLog(state, 'Action Deck reshuffled from discard.');
}

function cardLabel(card) {
  if (!card) return '?';
  if (isWild(card)) return 'Heroic Wild!';
  if (isSpecial(card)) return `${card.name} (${card.suit})`;
  if (isCramp(card)) return 'Cramp!';
  return `${card.suit} ${card.rank}`;
}

function resolveHeroCardPlay(state, hero, card, wildSuit) {
  const clash = state.clash;
  let again = false;

  if (isSpecial(card)) {
    afterPlayUpdateActive(clash, card);
    if (card.kind === 'daze') {
      clash.monsterDazed = true;
      appendLog(state, `${hero.name} plays Daze! — ${clash.monsterName} will miss next turn. ${hero.name} plays again!`);
      again = true;
    } else if (card.kind === 'bounce') {
      clash.monsterHp = Math.max(0, clash.monsterHp - 1);
      appendLog(state, `${hero.name} Bounce Back! — reflects 1 Dmg (${clash.monsterName} at ${clash.monsterHp} HP).`);
    } else if (card.kind === 'tuckered') {
      clash.monsterHp = Math.max(0, clash.monsterHp - 2);
      appendLog(state, `${hero.name} Tuckered Out! (+2) — ${clash.monsterName} takes 2 direct Dmg (${clash.monsterHp} HP).`);
    }
  } else {
    const kind = classifyPlay(card, clash);
    afterPlayUpdateActive(clash, card, wildSuit);
    if (isWild(card) || kind === 'clean') {
      let dmg = weaponStrike(hero);
      if (hero.weapon?.strikeBonusSuit && card.suit === hero.weapon.strikeBonusSuit) dmg += 1;
      if (isWild(card)) {
        clash.activeSuit = wildSuit || hero.preferredSuit || 'brawn';
        appendLog(state, `${hero.name} Heroic Wild! — Strike ${dmg}. New suit: ${clash.activeSuit}.`);
      } else {
        appendLog(state, `${hero.name} Clean Strike with ${cardLabel(card)} — ${dmg} Dmg!`);
      }
      clash.monsterHp = Math.max(0, clash.monsterHp - dmg);
    } else if (kind === 'parry') {
      appendLog(state, `${hero.name} PARRIES with ${cardLabel(card)}! Suit → ${card.suit}.`);
      if (hero.perk?.id === 'excuse-me-no' && !hero.perkUsedThisClash) {
        hero.hp = Math.min(hero.maxHp, hero.hp + 1);
        hero.perkUsedThisClash = true;
        appendLog(state, `${hero.name} perk Excuse Me, No — heal 1 HP (${hero.hp}).`);
      }
    } else {
      clash.monsterHp = Math.max(0, clash.monsterHp - 1);
      appendLog(state, `${hero.name} Guards with ${cardLabel(card)} — 1 chip Dmg (${clash.monsterName} at ${clash.monsterHp}).`);
    }
  }

  discardToAction(state, card);
  return again ? 'again' : 'done';
}

function resolveMonsterCardPlay(state, hero, card) {
  const clash = state.clash;
  if (isSpecial(card)) {
    afterPlayUpdateActive(clash, card);
    if (card.kind === 'daze') {
      clash.heroDazed = true;
      appendLog(state, `${clash.monsterName} plays Daze! — ${hero.name} will miss next turn.`);
    } else if (card.kind === 'bounce') {
      hurtHero(state, hero, 1, card);
      appendLog(state, `${clash.monsterName} Bounce Back!`);
    } else if (card.kind === 'tuckered') {
      addCramp(state, hero, 2);
      appendLog(state, `${clash.monsterName} Tuckered Out! — ${hero.name} gains 2 Cramp!`);
    }
  } else {
    const kind = classifyPlay(card, clash);
    afterPlayUpdateActive(clash, card);
    if (isWild(card) || kind === 'clean') {
      hurtHero(state, hero, clash.baseDmg, card);
      appendLog(state, `${clash.monsterName} hits with ${cardLabel(card)} for ${clash.baseDmg}! (${hero.name} ${hero.hp} HP)`);
    } else if (kind === 'parry') {
      appendLog(state, `${clash.monsterName} Parries with ${cardLabel(card)}.`);
    } else {
      hurtHero(state, hero, 1, card);
      appendLog(state, `${clash.monsterName} glancing hit (1). ${hero.name} at ${hero.hp} HP.`);
    }
  }
  discardToAction(state, card);
}

function hurtHero(state, hero, amount, card) {
  let dmg = amount;
  const rank = card?.rank != null ? Number(card.rank) : null;
  if (rank != null && hero.armor?.ignoreRanks?.includes(rank)) {
    appendLog(state, `${hero.name}'s armor ignores Rank ${rank} damage!`);
    return;
  }
  if (hero.offhand?.tapBlock && !hero.offhand.tapped) {
    // Auto-tap optional: only if dealer/hero would tap — MVP auto-blocks 1 once
    const block = Math.min(dmg, hero.offhand.tapBlock || 1);
    dmg -= block;
    hero.offhand.tapped = true;
    appendLog(state, `${hero.name} taps ${hero.offhand.name} — blocks ${block}.`);
  }
  hero.hp = Math.max(0, hero.hp - Math.max(0, dmg));
}

function addCramp(state, hero, n) {
  for (let i = 0; i < n; i += 1) {
    if (state.decks.cramp.length) {
      hero.hand.push(state.decks.cramp.shift());
    } else {
      hero.hand.push({
        id: `C-temp-${Math.random().toString(36).slice(2, 6)}`,
        type: 'cramp',
        name: 'Cramp!',
      });
    }
  }
}

function resolveDesperation(state, hero) {
  const clash = state.clash;
  if (!state.decks.desperation.length) {
    appendLog(state, 'Desperation deck empty!');
    return;
  }
  const card = state.decks.desperation.shift();
  clash.lastDesperation = card;
  appendLog(state, `${hero.name} flips Desperation: ${card.title}!`);
  // Simplified outcomes by tier
  if (card.tier === 'messy') {
    if (/Banana/i.test(card.title)) {
      clash.monsterHp = Math.max(0, clash.monsterHp - 1);
      hero.hp = Math.max(0, hero.hp - 1);
    } else if (/Dropped/i.test(card.title)) {
      hero.hp = Math.max(0, hero.hp - 2);
    } else if (/Sneeze/i.test(card.title)) {
      addCramp(state, hero, 1);
      for (let i = 0; i < 2 && state.decks.action.length; i += 1) {
        clash.monsterHand.push(state.decks.action.shift());
      }
    } else if (/Shoelaces/i.test(card.title)) {
      addCramp(state, hero, 1);
      if (hero.hand.length) {
        const i = Math.floor(Math.random() * hero.hand.length);
        discardToAction(state, hero.hand.splice(i, 1)[0]);
      }
    } else if (/Backfire/i.test(card.title)) {
      hero.hp = Math.max(0, hero.hp - 2);
      clash.monsterHp = Math.min(clash.monsterMaxHp, clash.monsterHp + 1);
      clash.activeSuit = 'spark';
      clash.activeRank = 3;
    } else {
      hero.hp = Math.max(0, hero.hp - 1);
    }
    clash.activeRank = 1;
  } else if (card.tier === 'neutral') {
    if (/Elbow/i.test(card.title)) {
      clash.monsterHp = Math.max(0, clash.monsterHp - 1);
    } else if (/Snack/i.test(card.title)) {
      hero.hp = Math.min(hero.maxHp, hero.hp + 1);
      drawAction(state, hero);
    }
    clash.activeRank = /Duck/i.test(card.title) ? 2 : 1;
  } else {
    // miracle
    if (/Mega-Crit/i.test(card.title)) {
      const dmg = weaponStrike(hero) + 2;
      clash.monsterHp = Math.max(0, clash.monsterHp - dmg);
      appendLog(state, `Accidental Mega-Crit for ${dmg}!`);
    } else {
      clash.monsterHp = Math.max(0, clash.monsterHp - 1);
    }
    clash.activeRank = 1;
  }
  appendLog(state, `Desperation resolved — ${clash.monsterName} ${clash.monsterHp} HP, ${hero.name} ${hero.hp} HP.`);
}

function discardToAction(state, card) {
  if (!card || isCramp(card)) return;
  state.decks.actionDiscard = state.decks.actionDiscard || [];
  state.decks.actionDiscard.push(card);
}

function knockDownHero(state, hero) {
  hero.hp = 0;
  hero.downed = true;
  // Discard entire hand
  for (const c of hero.hand) discardToAction(state, c);
  hero.hand = [];
  appendLog(state, `${hero.name} is DOWNED! Hand discarded.`);
  cleanupClash(state, { victory: false, downed: true });
}

function endClashVictory(state) {
  const clash = state.clash;
  const hero = state.heroes[clash.heroPlayerId];
  appendLog(state, `${clash.monsterName} goes POOF! ${hero.name} wins the clash.`);
  grantClashLoot(state, hero, clash);
  cleanupClash(state, { victory: true, wasBoss: clash.isBoss });
}

function grantClashLoot(state, hero, clash) {
  if (clash.isBoss) {
    const bossLoot = gearByTier(2);
    if (bossLoot.length) {
      const pick = bossLoot[Math.floor(Math.random() * bossLoot.length)];
      grantLootToHero(state, hero, {
        id: `${pick.id}-boss`,
        gearId: pick.id,
        name: pick.name,
        slot: pick.slot,
        tier: pick.tier,
      });
      appendLog(state, `${hero.name} claims boss loot: ${pick.name}!`);
    }
    return;
  }
  const lootText = clash.lootText || '';
  if (/Consumable/i.test(lootText)) {
    const item = drawLoot(state, 1).find((c) => c.slot === 'belt') || drawLoot(state, 1)[0];
    if (item) {
      grantLootToHero(state, hero, item);
      appendLog(state, `${hero.name} loots ${item.name}.`);
    }
  } else if (/Tier 1|Loot/i.test(lootText)) {
    const item = drawLoot(state, 1)[0];
    if (item) {
      grantLootToHero(state, hero, item);
      appendLog(state, `${hero.name} loots ${item.name}.`);
    }
  } else if (/Action/i.test(lootText)) {
    drawAction(state, hero);
    appendLog(state, `${hero.name} loots 1 Action card.`);
  }
}

function cleanupClash(state, { victory, wasBoss, downed } = {}) {
  const clash = state.clash;
  if (!clash) return;
  const hero = state.heroes[clash.heroPlayerId];
  const tile = state.map.tiles.find((t) => t.key === clash.roomKey);
  // Clear cramps
  hero.hand = hero.hand.filter((c) => !isCramp(c));
  // Untap gear
  if (hero.offhand) hero.offhand.tapped = false;
  if (hero.armor) hero.armor.tapped = false;
  if (victory && tile) tile.cleared = true;
  const bossWin = Boolean(wasBoss ?? clash.isBoss) && victory;
  state.clash = null;
  state.phase = 'exploring';
  if (bossWin) {
    unlockStairs(state, 'Floor Boss defeated — Shiny Basement Key found!');
  }
  if (!downed) {
    state.explorationActionsLeft = 0;
    endHeroExplorationTurn(state);
  } else {
    state.explorationActionsLeft = 0;
    endHeroExplorationTurn(state);
  }
}

function unlockStairs(state, reason) {
  if (!state.floor) {
    state.floor = { bossDefeated: false, stairsUnlocked: false, shinyKey: false };
  }
  state.floor.bossDefeated = true;
  state.floor.stairsUnlocked = true;
  state.floor.shinyKey = true;
  for (const tile of state.map.tiles) {
    if (tile.kind === 'stairs') {
      tile.locked = false;
      tile.faceUp = true;
      tile.cleared = true;
    }
  }
  appendLog(state, reason);
  appendLog(state, 'Stairway Down is unlocked! Move a conscious Hero onto the stairs to finish the floor.');
}

function finishFloor(state, reason) {
  state.phase = 'victory';
  state.clash = null;
  state.explorationActionsLeft = 0;
  state.pending = null;
  for (const hero of Object.values(state.heroes)) {
    if (hero.downed) continue;
    hero.hp = Math.min(hero.maxHp, hero.hp + 3);
    hero.hand = hero.hand.filter((c) => !isCramp(c));
  }
  appendLog(state, reason);
  appendLog(
    state,
    `Floor 1 complete! Conscious Heroes heal +3 HP (checkpoint). Story stack for Floor 2: ${state.storyStack.length} callback(s).`,
  );
}

function endHeroExplorationTurn(state) {
  if (!state.turnOrder.length) return;
  if (state.pending) return;
  state.activeHeroIndex = (state.activeHeroIndex + 1) % state.turnOrder.length;
  state.explorationActionsLeft = 2;
  const nextId = state.turnOrder[state.activeHeroIndex];
  const p = state.players.find((x) => x.id === nextId);
  appendLog(state, `${p?.name || 'Hero'}'s turn — 2 Exploration Actions.`);
}

function maybeEndExplore(state) {
  if (state.phase === 'exploring' && state.explorationActionsLeft <= 0 && !state.clash && !state.pending) {
    endHeroExplorationTurn(state);
  }
}

function drawLoot(state, n) {
  const out = [];
  state.decks.loot = state.decks.loot || [];
  for (let i = 0; i < n; i += 1) {
    if (!state.decks.loot.length && state.decks.lootDiscard?.length) {
      state.decks.loot = state.decks.lootDiscard.splice(0).sort(() => Math.random() - 0.5);
    }
    if (state.decks.loot.length) out.push(state.decks.loot.shift());
  }
  return out;
}

function grantLootToHero(state, hero, loot) {
  const gearId = loot.gearId || loot.id?.split('-')[0];
  const def = getGear(gearId) || loot;
  const slot = def.slot || loot.slot;
  const item = {
    id: gearId,
    name: def.name || loot.name,
    slot,
    tapped: false,
    strike: def.strike,
    strikeBonusSuit: def.strikeBonusSuit,
    tapBlock: def.tapBlock,
    ignoreRanks: def.ignoreRanks,
  };
  if (slot === 'weapon') hero.weapon = item;
  else if (slot === 'offhand') hero.offhand = item;
  else if (slot === 'armor') hero.armor = item;
  else if (slot === 'belt') {
    hero.belt = hero.belt || [];
    hero.belt.push(item);
    while (hero.belt.length > 2) {
      const dropped = hero.belt.shift();
      appendLog(state, `${hero.name}'s belt is full — drops ${dropped.name}.`);
    }
  }
}

function beginEventPrompt(state, heroPlayerId, tile) {
  const event = state.decks.events?.length
    ? state.decks.events.shift()
    : {
        id: 'E-00',
        title: 'Mysterious Draft',
        prompt: 'The room feels empty. Dealer narrates.',
        choices: ['A) Shrug and move on.', 'B) Peek nervously.', 'Or Improvise...'],
      };
  state.pending = {
    kind: 'event',
    heroPlayerId,
    tileKey: tile.key,
    event,
  };
  appendLog(state, `Event: ${event.title} — choose A, B, or improvise.`);
}

function beginStoryOrMerchant(state, heroPlayerId, tile) {
  // Part II callbacks are for Floor 2+; still honor a non-empty storyStack if present.
  if (state.storyStack?.length) {
    const callbackId = state.storyStack.shift();
    const story = STORIES.find((s) => s.id === callbackId);
    if (story) {
      state.pending = { kind: 'story', heroPlayerId, tileKey: tile.key, story };
      tile.cleared = true;
      appendLog(state, `Story Callback: ${story.name}`);
      return;
    }
  }
  const card = state.decks.storyMerchant?.length ? state.decks.storyMerchant.shift() : null;
  if (!card) {
    tile.cleared = true;
    appendLog(state, 'Story/Cart room — deck empty. Safe to linger.');
    return;
  }
  if (card.cardKind === 'merchant') {
    tile.merchant = { id: card.id, name: card.name, greeting: card.greeting, deals: card.deals };
    tile.cleared = true;
    appendLog(state, `${card.name} sets up shop here! ${card.greeting}`);
    return;
  }
  tile.cleared = true;
  state.pending = { kind: 'story', heroPlayerId, tileKey: tile.key, story: card };
  appendLog(state, `Story: ${card.name}`);
}

function applyEventChoice(state, hero, event, choice) {
  const id = event.id;
  appendLog(state, `${hero.name} picks ${choice.toUpperCase()} on ${event.title}.`);
  if (choice === 'improvise' || choice === 'c') {
    drawTwist(state, 'Improvise — Dealer Twist');
    return;
  }
  // Structured outcomes from dungeon_floor1_2d5d.md (simplified digital adjudication)
  if (id === 'E-01') {
    if (choice === 'a') drawAction(state, hero);
    else {
      hero.hp = Math.max(0, hero.hp - 2);
      addCramp(state, hero, 1);
    }
  } else if (id === 'E-02') {
    if (choice !== 'a') {
      hero.hp = Math.max(0, hero.hp - 1);
      state.explorationActionsLeft = Math.max(0, state.explorationActionsLeft - 1);
      appendLog(state, 'Splat! Next move is sticky (lost 1 leftover action as proxy).');
    }
  } else if (id === 'E-03') {
    if (choice === 'a') {
      hero.hp = Math.min(hero.maxHp, hero.hp + 2);
      drawAction(state, hero);
    } else {
      const hidden = state.map.tiles.find((t) => !t.faceUp);
      if (hidden) appendLog(state, `Mirror peek: a face-down room is ${hidden.name} (${hidden.kind}).`);
    }
  } else if (id === 'E-04') {
    if (choice === 'a') hero.hp = Math.min(hero.maxHp, hero.hp + 2);
    else {
      const item = drawLoot(state, 1)[0];
      if (item) grantLootToHero(state, hero, item);
      else {
        hero.hp = Math.max(0, hero.hp - 1);
        drawTwist(state, 'Soda mix mishap');
      }
    }
  } else if (id === 'E-05') {
    if (choice === 'a') {
      const item = drawLoot(state, 1)[0];
      if (item) grantLootToHero(state, hero, item);
    } else drawTwist(state, 'Awkward humming');
  } else if (id === 'E-06') {
    if (choice === 'a') drawAction(state, hero);
    else drawTwist(state, 'Gargoyle bell rings');
  }
  if (hero.hp <= 0) {
    hero.hp = 0;
    hero.downed = true;
    appendLog(state, `${hero.name} collapses from the hazard!`);
  }
}

function applyStoryChoice(state, hero, story, choice, tileKey) {
  appendLog(state, `${hero.name} responds to ${story.name} (${choice.toUpperCase()}).`);
  const tile = state.map.tiles.find((t) => t.key === tileKey);
  if (tile) tile.storyResolved = true;

  if (story.id === 'S-01A') {
    if (choice === 'a') {
      if (hero.weapon) {
        appendLog(state, `${hero.name} gives ${hero.weapon.name} to Pip.`);
        hero.weapon = null;
      }
      if (story.callbackId) state.storyStack.push(story.callbackId);
      appendLog(state, `Tucked ${story.callbackId} onto the Next-Floor Story Stack (Helped).`);
    } else if (choice === 'b') {
      const item = drawLoot(state, 1)[0];
      if (item) grantLootToHero(state, hero, item);
      if (story.callbackId) state.storyStack.push(story.callbackId);
      appendLog(state, `Tucked ${story.callbackId} (Grumpy!).`);
    } else drawTwist(state, 'Story improvise');
  } else if (story.id === 'S-02A') {
    if (choice === 'a') {
      if (hero.belt?.length) hero.belt.pop();
      if (story.callbackId) state.storyStack.push(story.callbackId);
      appendLog(state, `Tucked ${story.callbackId} onto the Story Stack.`);
    } else if (choice === 'b') drawAction(state, hero);
    else drawTwist(state, 'Story improvise');
  } else if (story.id === 'S-03A') {
    if (choice === 'a') {
      if (hero.belt?.length) hero.belt.pop();
      else {
        // discard 2 matching suit proxy: discard 2 action cards
        hero.hand = hero.hand.filter((c, i) => i >= 2 || isCramp(c));
      }
      if (story.callbackId) state.storyStack.push(story.callbackId);
      appendLog(state, `Tucked ${story.callbackId} (Friend).`);
    } else if (choice === 'b') {
      drawAction(state, hero);
      if (story.callbackId) state.storyStack.push(story.callbackId);
      appendLog(state, `Tucked ${story.callbackId} (Snubbed).`);
    } else drawTwist(state, 'Story improvise');
  } else {
    // Part II or unknown — narrate only on Floor 1
    appendLog(state, story.scene || story.name);
  }
}

function drawTwist(state, reason) {
  state.decks.twistHand = state.decks.twistHand || [];
  if (state.decks.twistHand.length >= 3) {
    appendLog(state, `${reason} — Twist hand already at max (3).`);
    return;
  }
  if (!state.decks.twists?.length) {
    appendLog(state, `${reason} — Twist deck empty.`);
    return;
  }
  const t = state.decks.twists.shift();
  state.decks.twistHand.push(t);
  appendLog(state, `${reason}: Dealer draws Twist «${t.name}».`);
}

function applyTwist(state, twist, action = {}) {
  appendLog(state, `Dealer plays Twist: ${twist.name} — ${twist.effect}`);
  if (/Musical Rooms/i.test(twist.name)) {
    const hidden = state.map.tiles.filter((t) => !t.faceUp);
    if (hidden.length >= 2) {
      const a = hidden[0];
      const b = hidden[1];
      const ax = a.x;
      const ay = a.y;
      a.x = b.x;
      a.y = b.y;
      b.x = ax;
      b.y = ay;
      a.key = `t-${a.x}-${a.y}`;
      b.key = `t-${b.x}-${b.y}`;
      appendLog(state, `Musical Rooms! Swapped two face-down tiles.`);
    } else {
      appendLog(state, 'Not enough face-down rooms to swap.');
    }
  } else if (/Boss Espresso/i.test(twist.name)) {
    if (state.clash) {
      state.clash.monsterHp = Math.min(
        state.clash.monsterMaxHp,
        state.clash.monsterHp + 2,
      );
      appendLog(state, `${state.clash.monsterName} guzzles espresso (+2 HP → ${state.clash.monsterHp}).`);
    } else {
      appendLog(state, 'No active clash — Twist fizzles.');
    }
  } else if (/Untied Shoelaces/i.test(twist.name)) {
    const pid = action.targetPlayerId || state.turnOrder[state.activeHeroIndex];
    const hero = state.heroes[pid];
    if (hero) {
      addCramp(state, hero, 1);
      state.explorationActionsLeft = Math.max(0, state.explorationActionsLeft - 1);
      appendLog(state, `${hero.name} trips on untied laces (−1 action + Cramp!).`);
    }
  } else if (/Surprise Intern/i.test(twist.name)) {
    appendLog(state, 'Sneaky Goblin Intern spawns narratively — Dealer may start a clash in a cleared room later.');
  } else if (/Sticky Door|Hall Monitor/i.test(twist.name)) {
    appendLog(state, 'Twist noted — Dealer adjudicates the barrier/patrol at the table.');
  }
}

export function viewForPlayer(state, playerId) {
  return publicStateFor(state, playerId);
}

export function gearLabel(id) {
  return getGear(id)?.name || id;
}
