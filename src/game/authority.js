import {
  getHero,
  getGear,
  THEMES,
  BOSSES,
  MONSTERS,
  bossHp,
  STORIES,
  gearByTier,
} from '../data/index.js';
import {
  createHeroRuntime,
  gearRuntimeFromId,
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
  pickMonsterPlay,
  weaponStrike,
  themeSparkBonus,
  effectiveMonsterRank,
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
        next.map.barriers = next.map.barriers || [];
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
        if (next.phase !== 'exploring' && !(next.phase === 'clash' && next.clash?.isBoss)) {
          return fail(next, 'Not exploring');
        }
        const heroPid = resolveHeroActor(next, actor, action.playerId);
        if (!heroPid) return fail(next, 'Not your turn / not a hero');
        // Boss join: any conscious hero may move into the active Boss Chamber mid-clash.
        const joiningBoss =
          next.phase === 'clash' &&
          next.clash?.isBoss &&
          next.clash.roomKey;
        if (!joiningBoss) {
          if (next.turnOrder[next.activeHeroIndex] !== heroPid && actor.role !== 'dealer') {
            return fail(next, "Not this hero's turn");
          }
        }
        if (actor.role === 'dealer' && action.playerId) {
          // dealer may puppet local stubs or help
        } else if (actor.role !== 'dealer' && heroPid !== actorId) {
          return fail(next, 'Not your hero');
        }
        if (!joiningBoss && next.explorationActionsLeft < 0.5) {
          return fail(next, 'No exploration actions left');
        }

        const hero = next.heroes[heroPid];
        if (hero.downed) return fail(next, 'DOWNED heroes cannot move');
        const from = next.map.tiles.find((t) => t.key === hero.roomKey);
        const to = tileAt(next, action.x, action.y);
        if (!from || !to) return fail(next, 'Invalid tile');
        if (!adjacentOrthogonal(from, to)) return fail(next, 'Must move orthogonally 1 room');
        if (!tilesConnect(from, to)) return fail(next, 'Doorways do not align');
        if (barrierBlocks(next, from, to)) {
          return fail(next, 'Sticky Door Jam blocks this doorway — pry it with a Stunt');
        }
        if (next.pending) return fail(next, 'Resolve the pending room prompt first');

        if (joiningBoss) {
          if (to.key !== next.clash.roomKey) return fail(next, 'Can only join the active Boss Chamber');
          hero.roomKey = to.key;
          joinBossClash(next, heroPid);
          break;
        }

        // Pip Shortcut Tiptoe: face-up cleared safe rooms cost half an Action.
        const tiptoe =
          hero.perk?.id === 'shortcut-tiptoe' &&
          to.faceUp &&
          to.cleared &&
          !['monster', 'boss', 'trap'].includes(to.kind);
        const moveCost = tiptoe ? 0.5 : 1;
        if (next.explorationActionsLeft < moveCost) {
          return fail(next, 'Not enough exploration actions for that move');
        }

        hero.roomKey = to.key;
        next.explorationActionsLeft -= moveCost;
        const playerName = next.players.find((p) => p.id === heroPid).name;
        if (tiptoe) {
          appendLog(next, `${playerName} tip-toes through ${to.name} (½ Action).`);
        }

        // Surprise Intern / lurking monster on a cleared room
        if (to.faceUp && to.lurkingMonster && to.cleared) {
          next.explorationActionsLeft = 0;
          appendLog(next, `${playerName} bumps into a lurking ${to.lurkingMonster.name}!`);
          startClash(next, heroPid, to, to.lurkingMonster);
          to.lurkingMonster = null;
          break;
        }

        if (!to.faceUp) {
          to.faceUp = true;
          appendLog(next, `${playerName} reveals ${to.name}!`);
          if (to.kind === 'monster' || to.kind === 'boss') {
            next.explorationActionsLeft = 0;
            startClash(next, heroPid, to);
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
        } else if (!tiptoe) {
          appendLog(next, `${playerName} moves to ${to.name}.`);
          // Re-enter uncleared monster/boss (e.g. after flee)
          if ((to.kind === 'monster' || to.kind === 'boss') && !to.cleared) {
            next.explorationActionsLeft = 0;
            startClash(next, heroPid, to);
          }
        }

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
          advanceAfterHeroTurn(next, { skipped: true });
          break;
        }
        if (clash.needsDraw) {
          drawAction(next, hero);
          clash.needsDraw = false;
        }
        const card = hero.hand.find((c) => c.id === action.cardId);
        if (!card) return fail(next, 'Card not in hand');
        if (isCramp(card)) return fail(next, 'Cannot play Cramp! onto Clash Pile');

        const playOpts = buildHeroPlayOptions(hero, clash, card, action);
        if (!isLegalPlay(card, clash, playOpts)) {
          return fail(next, 'Illegal play (need matching Suit or Rank)');
        }

        hero.hand = hero.hand.filter((c) => c.id !== card.id);
        const outcome = resolveHeroCardPlay(next, hero, card, action.wildSuit, playOpts);
        if (outcome === 'flee') {
          // Sneaky Blanket / confetti escape already cleaned clash
          break;
        }
        if (outcome === 'again') {
          clash.needsDraw = false;
          clash.whoseTurn = 'hero';
        } else {
          advanceAfterHeroTurn(next);
        }
        if (next.clash && next.clash.monsterHp <= 0) {
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
        advanceAfterHeroTurn(next);
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
        resolveDesperation(next, hero, action);
        if (!next.clash) break;
        if (clash.monsterHp <= 0) endClashVictory(next);
        else if (hero.hp <= 0) knockDownHero(next, hero);
        else advanceAfterHeroTurn(next);
        break;
      }

      case 'clash-use-belt': {
        if (next.phase !== 'clash' || !next.clash) return fail(next, 'No active clash');
        const clash = next.clash;
        if (clash.whoseTurn !== 'hero') return fail(next, 'Not hero combat turn');
        const heroPid = clash.heroPlayerId;
        if (actor.role !== 'dealer' && actorId !== heroPid) return fail(next, 'Not your clash');
        const hero = next.heroes[heroPid];
        const beltIdx = Number(action.beltIndex);
        const item = hero.belt?.[beltIdx];
        if (!item) return fail(next, 'No belt item');
        const def = getGear(item.id);
        if (def?.type === 'escape') {
          // G-29 Confetti Smoke Bomb — free combat use
          hero.belt.splice(beltIdx, 1);
          if (action.mode === 'flee') {
            appendLog(next, `${hero.name} pops ${def.name} and slips away!`);
            cleanupClash(next, { victory: false });
          } else {
            clash.monsterDazed = true;
            appendLog(next, `${hero.name} pops ${def.name} — ${clash.monsterName} is Dazed!`);
            advanceAfterHeroTurn(next);
          }
          break;
        }
        if (def?.type === 'heal') {
          hero.belt.splice(beltIdx, 1);
          hero.hp = Math.min(hero.maxHp, hero.hp + (def.heal || 4));
          appendLog(next, `${hero.name} sips ${def.name} mid-clash (+${def.heal || 4} HP → ${hero.hp}).`);
          break;
        }
        return fail(next, 'That belt item cannot be used in clash');
      }

      case 'clash-monster-turn': {
        if (actor.role !== 'dealer') return fail(next, 'Dealer only');
        if (next.phase !== 'clash' || !next.clash) return fail(next, 'No active clash');
        const clash = next.clash;
        if (clash.whoseTurn !== 'monster') return fail(next, 'Not monster turn');
        // Kobolds three-way free swings instead of missing Daze
        if (clash.pendingKoboldSwings > 0) {
          const swings = clash.pendingKoboldSwings;
          clash.pendingKoboldSwings = 0;
          clash.monsterDazed = false;
          for (const fid of clash.fighters || [clash.heroPlayerId]) {
            const h = next.heroes[fid];
            if (!h || h.downed) continue;
            for (let i = 0; i < swings; i += 1) {
              hurtHero(next, h, 1, { rank: 1, suit: 'zip' });
              appendLog(next, `${clash.monsterName} free swing ${i + 1}/${swings} on ${h.name}!`);
              if (h.hp <= 0) knockDownHero(next, h);
              if (!next.clash) break;
            }
            break; // hit the current/first conscious fighter
          }
          if (!next.clash) break;
          beginNextHeroCombatTurn(next);
          break;
        }
        if (clash.monsterDazed) {
          clash.monsterDazed = false;
          appendLog(next, `${clash.monsterName} is Dazed and misses!`);
          beginNextHeroCombatTurn(next);
          break;
        }
        if (next.decks.action.length) {
          clash.monsterHand.push(next.decks.action.shift());
        }
        const pick = pickMonsterPlay(clash.monsterHand, clash);
        const targetHero = next.heroes[clash.heroPlayerId];
        if (!pick) {
          appendLog(next, `${clash.monsterName} Fumbles! (no legal play) — draws to recover.`);
          if (next.decks.action.length) clash.monsterHand.push(next.decks.action.shift());
        } else {
          clash.monsterHand = clash.monsterHand.filter((c) => c.id !== pick.id);
          resolveMonsterCardPlay(next, targetHero, pick);
        }
        if (!next.clash) break;
        if (targetHero.hp <= 0) {
          knockDownHero(next, targetHero);
        } else if (clash.monsterHp <= 0) {
          endClashVictory(next);
        } else {
          beginNextHeroCombatTurn(next);
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

      case 'stunt': {
        if (next.phase !== 'exploring') return fail(next, 'Not exploring');
        if (next.pending) return fail(next, 'Resolve the pending prompt first');
        const heroPid = resolveHeroActor(next, actor, action.playerId);
        if (!heroPid) return fail(next, 'Not a hero');
        if (next.turnOrder[next.activeHeroIndex] !== heroPid && actor.role !== 'dealer') {
          return fail(next, 'Not your turn');
        }
        if (next.explorationActionsLeft < 1) return fail(next, 'No exploration actions left');
        const hero = next.heroes[heroPid];
        if (hero.downed) return fail(next, 'DOWNED heroes cannot stunt');
        next.explorationActionsLeft -= 1;
        const target = Number(action.target) || 4;
        const suit = action.suit || hero.preferredSuit || 'brawn';
        let roll = 1 + Math.floor(Math.random() * 6);
        let autoPass = false;
        let bonus = 0;
        // Scarf once/floor +1
        if (hero.offhand?.id === 'G-08' && !hero.stuntGearUsed?.scarf) {
          bonus += 1;
          hero.stuntGearUsed = { ...hero.stuntGearUsed, scarf: true };
          appendLog(next, `${hero.name} flutters the Checkered Picnic Scarf (+1 stunt).`);
        }
        // Bouncy boots +1 on Zip stunts
        if (hero.armor?.id === 'G-18' && suit === 'zip') bonus += 1;
        if (action.discardCardId) {
          const idx = hero.hand.findIndex((c) => c.id === action.discardCardId);
          if (idx >= 0) {
            const discarded = hero.hand.splice(idx, 1)[0];
            if (isWild(discarded)) autoPass = true;
            else if (discarded.suit === suit) bonus += 2;
            discardToAction(next, discarded);
          }
        }
        const total = autoPass ? 99 : roll + bonus;
        const success = autoPass || total >= target;
        const playerName = next.players.find((p) => p.id === heroPid)?.name || hero.name;
        appendLog(
          next,
          autoPass
            ? `${playerName} stunt (${suit} ${target}+): Heroic Wild! automatic pass.`
            : `${playerName} stunt (${suit} ${target}+): rolled ${roll}${bonus ? `+${bonus}` : ''} = ${roll + bonus} → ${success ? 'SUCCESS' : 'FAIL'}.`,
        );
        if (!success && hero.offhand?.id === 'G-11' && !hero.stuntGearUsed?.kaleidoscope && action.reroll) {
          hero.stuntGearUsed = { ...hero.stuntGearUsed, kaleidoscope: true };
          roll = 1 + Math.floor(Math.random() * 6);
          const total2 = roll + bonus;
          const success2 = total2 >= target;
          appendLog(next, `Kaleidoscope reroll: ${roll}+${bonus} = ${total2} → ${success2 ? 'SUCCESS' : 'FAIL'}.`);
          if (success2) applyStuntSuccess(next, hero, heroPid, action);
          else {
            drawTwist(next, 'Failed stunt');
          }
        } else if (success) {
          applyStuntSuccess(next, hero, heroPid, action);
        } else {
          drawTwist(next, 'Failed stunt');
        }
        maybeEndExplore(next);
        break;
      }

      case 'carry': {
        if (next.phase !== 'exploring') return fail(next, 'Not exploring');
        if (next.pending) return fail(next, 'Resolve the pending prompt first');
        const heroPid = resolveHeroActor(next, actor, action.playerId);
        if (!heroPid) return fail(next, 'Not a hero');
        if (next.turnOrder[next.activeHeroIndex] !== heroPid && actor.role !== 'dealer') {
          return fail(next, 'Not your turn');
        }
        if (next.explorationActionsLeft < 2) return fail(next, 'Carry costs 2 Actions');
        const hero = next.heroes[heroPid];
        if (hero.downed) return fail(next, 'DOWNED heroes cannot carry');
        const ally = next.heroes[action.targetPlayerId];
        if (!ally?.downed || ally.roomKey !== hero.roomKey) {
          return fail(next, 'Need a DOWNED ally in your room');
        }
        const from = next.map.tiles.find((t) => t.key === hero.roomKey);
        const to = tileAt(next, action.x, action.y);
        if (!from || !to) return fail(next, 'Invalid tile');
        if (!adjacentOrthogonal(from, to) || !tilesConnect(from, to)) {
          return fail(next, 'Must carry 1 room through aligned doorways');
        }
        if (barrierBlocks(next, from, to)) return fail(next, 'Sticky Door Jam blocks this doorway');
        next.explorationActionsLeft -= 2;
        hero.roomKey = to.key;
        ally.roomKey = to.key;
        if (!to.faceUp) {
          to.faceUp = true;
          to.cleared = !['monster', 'boss', 'trap'].includes(to.kind);
          appendLog(next, `${hero.name} reveals ${to.name} while carrying ${ally.name}.`);
          if (to.kind === 'monster' || to.kind === 'boss') {
            // Carrying into a lair still triggers clash for the carrier
            startClash(next, heroPid, to);
            break;
          }
          if (to.kind === 'trap') beginEventPrompt(next, heroPid, to);
          else if (to.kind === 'story') beginStoryOrMerchant(next, heroPid, to);
        } else {
          appendLog(next, `${hero.name} carries ${ally.name} to ${to.name} (2 Actions).`);
        }
        maybeEndExplore(next);
        break;
      }

      case 'pry-barrier': {
        // Convenience: Brawn 3+ stunt success already handled via stunt purpose=pry
        if (actor.role !== 'dealer') return fail(next, 'Dealer only');
        const aKey = action.aKey;
        const bKey = action.bKey;
        next.map.barriers = (next.map.barriers || []).filter(
          (b) => !((b.aKey === aKey && b.bKey === bKey) || (b.aKey === bKey && b.bKey === aKey)),
        );
        appendLog(next, 'Sticky Door Jam pried open!');
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

function startClash(state, heroPlayerId, tile, forcedMonster = null) {
  state.phase = 'clash';
  let monsterName = 'Mystery Critter';
  let monsterHp = 4;
  let cunning = 3;
  let baseDmg = 1;
  let monsterId = null;
  let trait = '';
  let traitId = null;
  let lootText = '';
  const isBoss = tile.kind === 'boss' && !forcedMonster;

  if (forcedMonster) {
    monsterName = forcedMonster.name;
    monsterHp = forcedMonster.hp;
    cunning = forcedMonster.cunning;
    baseDmg = forcedMonster.baseDmg;
    monsterId = forcedMonster.id;
    trait = forcedMonster.trait || '';
    traitId = forcedMonster.traitId || null;
    lootText = forcedMonster.loot || '';
  } else if (isBoss) {
    const boss = BOSSES.find((b) => b.id === state.bossId) || BOSSES[0];
    const heroCount = Object.keys(state.heroes).length;
    monsterName = boss.name;
    monsterHp = bossHp(boss.id, heroCount);
    cunning = boss.cunning;
    baseDmg = boss.baseDmg;
    monsterId = boss.id;
    trait = boss.trait;
    traitId = boss.traitId || null;
    lootText = boss.reward || '';
  } else if (state.decks.monsters.length) {
    const m = state.decks.monsters.shift();
    monsterName = m.name;
    monsterHp = m.hp;
    cunning = m.cunning;
    baseDmg = m.baseDmg;
    monsterId = m.id;
    trait = m.trait;
    traitId = m.traitId || null;
    lootText = m.loot || '';
  }

  const hero = state.heroes[heroPlayerId];
  hero.perkUsedThisClash = false;
  while (hero.hand.filter((c) => c.type !== 'cramp').length < 4 && state.decks.action.length) {
    hero.hand.push(state.decks.action.shift());
  }

  const monsterHand = [];
  for (let i = 0; i < cunning && state.decks.action.length; i += 1) {
    monsterHand.push(state.decks.action.shift());
  }

  const heroCount = Object.keys(state.heroes).length;
  // Boss cadence: after every 2 hero turns in co-op; every hero turn in 1v1 Hard Mode.
  const bossEvery = isBoss && heroCount > 1 ? 2 : 1;

  state.clash = {
    roomKey: tile.key,
    heroPlayerId,
    fighters: [heroPlayerId],
    fighterIndex: 0,
    turnOrderDir: 1,
    heroTurnsSinceBoss: 0,
    bossEvery,
    monsterId,
    monsterName,
    monsterHp,
    monsterMaxHp: monsterHp,
    baseDmg,
    cunning,
    trait,
    traitId,
    lootText,
    monsterHand,
    isBoss,
    activeSuit: null,
    activeRank: null,
    pile: [],
    topCard: null,
    whoseTurn: 'hero',
    needsDraw: false,
    heroDazed: false,
    monsterDazed: false,
    ignoredFirstHit: false,
    usedDesperation: false,
    negateNextMonsterHit: false,
    pendingKoboldSwings: 0,
    note: isBoss
      ? 'Boss clash — nearby Heroes may move in to join the same pile!'
      : 'Monster leads — then play matching Suit or Rank (or Wild / Desperation).',
  };

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

function joinBossClash(state, heroPlayerId) {
  const clash = state.clash;
  if (!clash?.isBoss) return;
  if (clash.fighters.includes(heroPlayerId)) {
    appendLog(state, `${state.heroes[heroPlayerId].name} is already in the Boss clash.`);
    return;
  }
  const hero = state.heroes[heroPlayerId];
  hero.perkUsedThisClash = false;
  while (hero.hand.filter((c) => c.type !== 'cramp').length < 4 && state.decks.action.length) {
    hero.hand.push(state.decks.action.shift());
  }
  clash.fighters.push(heroPlayerId);
  // Rescale boss HP for extra hero joining mid-fight: +3 max & current
  clash.monsterMaxHp += 3;
  clash.monsterHp += 3;
  clash.bossEvery = clash.fighters.length > 1 ? 2 : 1;
  appendLog(
    state,
    `${hero.name} piles into the Boss clash! (${clash.fighters.length} Heroes; Boss ${clash.monsterHp}/${clash.monsterMaxHp} HP).`,
  );
}

function buildHeroPlayOptions(hero, clash, card, action = {}) {
  const opts = {};
  if (action.forceParry && hero.offhand?.id === 'G-17' && !hero.offhand.tapped) {
    opts.forceParry = true;
  }
  if (
    action.usePerk !== false &&
    hero.perk?.id === 'big-swing' &&
    !hero.perkUsedThisClash &&
    card?.suit === 'brawn' &&
    (action.useBigSwing || action.usePerk)
  ) {
    opts.bigSwing = true;
  }
  // Auto Big Swing once when playing Brawn if perk unused and play would benefit
  if (
    hero.perk?.id === 'big-swing' &&
    !hero.perkUsedThisClash &&
    card?.suit === 'brawn' &&
    !isSpecial(card) &&
    !isWild(card)
  ) {
    const without = isLegalPlay(card, clash);
    const withSwing = isLegalPlay(card, clash, { bigSwing: true });
    if (action.useBigSwing || (!without && withSwing) || action.usePerk) {
      opts.bigSwing = true;
    } else if (action.useBigSwing !== false && classifyPlay(card, clash, { bigSwing: true }) === 'clean') {
      // Prefer clean strike upgrade when already legal as guard
      if (classifyPlay(card, clash) === 'guard') opts.bigSwing = true;
    }
  }
  if (
    hero.perk?.id === 'improvised-zap' &&
    !hero.perkUsedThisClash &&
    card?.suit === 'spark' &&
    !isSpecial(card) &&
    !isWild(card)
  ) {
    const without = isLegalPlay(card, clash);
    if (!without || action.useZap) {
      opts.defensiveSparkAsAny = true;
    }
  }
  return opts;
}

function advanceAfterHeroTurn(state, { skipped = false } = {}) {
  const clash = state.clash;
  if (!clash) return;
  clash.needsDraw = false;
  const multi = clash.isBoss && (clash.fighters?.length || 1) > 1;
  if (multi) {
    clash.heroTurnsSinceBoss = (clash.heroTurnsSinceBoss || 0) + 1;
    if (clash.heroTurnsSinceBoss >= (clash.bossEvery || 2)) {
      clash.heroTurnsSinceBoss = 0;
      clash.whoseTurn = 'monster';
      return;
    }
    // Next fighter in seating order (respect Bounce Back direction)
    const dir = clash.turnOrderDir || 1;
    const n = clash.fighters.length;
    clash.fighterIndex = (clash.fighterIndex + dir + n * 10) % n;
    // Skip downed fighters
    let guards = 0;
    while (state.heroes[clash.fighters[clash.fighterIndex]]?.downed && guards < n) {
      clash.fighterIndex = (clash.fighterIndex + dir + n * 10) % n;
      guards += 1;
    }
    clash.heroPlayerId = clash.fighters[clash.fighterIndex];
    clash.whoseTurn = 'hero';
    clash.needsDraw = !skipped;
    return;
  }
  clash.whoseTurn = 'monster';
}

function beginNextHeroCombatTurn(state) {
  const clash = state.clash;
  if (!clash) return;
  const fighters = clash.fighters || [clash.heroPlayerId];
  const dir = clash.turnOrderDir || 1;
  const n = fighters.length;
  if (n > 1) {
    clash.fighterIndex = (clash.fighterIndex + dir + n * 10) % n;
    let guards = 0;
    while (state.heroes[fighters[clash.fighterIndex]]?.downed && guards < n) {
      clash.fighterIndex = (clash.fighterIndex + dir + n * 10) % n;
      guards += 1;
    }
    clash.heroPlayerId = fighters[clash.fighterIndex];
  }
  clash.whoseTurn = 'hero';
  clash.needsDraw = true;
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

function resolveHeroCardPlay(state, hero, card, wildSuit, playOpts = {}) {
  const clash = state.clash;
  let again = false;

  if (playOpts.bigSwing) {
    hero.perkUsedThisClash = true;
    appendLog(state, `${hero.name} uses Big Swing (+1 Rank on Brawn)!`);
  }
  if (playOpts.defensiveSparkAsAny) {
    hero.perkUsedThisClash = true;
    appendLog(state, `${hero.name} uses Improvised Zap (Spark as any Suit @ Rank 2)!`);
  }
  if (playOpts.forceParry && hero.offhand) {
    hero.offhand.tapped = true;
    appendLog(state, `${hero.name} taps ${hero.offhand.name} — forced Parry!`);
  }

  if (isSpecial(card)) {
    afterPlayUpdateActive(clash, card);
    if (card.kind === 'daze') {
      // G-21 Dramatic Greatsword: Daze deals +2 bonk
      let bonus = hero.weapon?.id === 'G-21' ? 2 : 0;
      bonus += themeSparkBonus(state.themeId, card);
      if (bonus) {
        damageMonster(state, hero, bonus, card, { ignoreArmor: true });
        appendLog(state, `Dramatic Greatsword bonk +${bonus} on Daze!`);
      }
      if (clash.traitId === 'three-way-team') {
        clash.pendingKoboldSwings = 2;
        clash.monsterDazed = false;
        appendLog(
          state,
          `${hero.name} plays Daze! — but Three Kobolds get two free swings next turn instead of missing!`,
        );
      } else {
        clash.monsterDazed = true;
        appendLog(
          state,
          `${hero.name} plays Daze! — ${clash.monsterName} will miss next turn. ${hero.name} plays again!`,
        );
      }
      again = true;
    } else if (card.kind === 'bounce') {
      damageMonster(state, hero, 1 + themeSparkBonus(state.themeId, card), card);
      // G-22 Fizz-Pop: Purple Bounce heals 2
      if (hero.weapon?.id === 'G-22' && card.suit === 'spark') {
        hero.hp = Math.min(hero.maxHp, hero.hp + 2);
        appendLog(state, `Fizz-Pop Spellblade — ${hero.name} heals 2 HP (${hero.hp}).`);
      }
      if (clash.isBoss && (clash.fighters?.length || 1) > 1) {
        clash.turnOrderDir = (clash.turnOrderDir || 1) * -1;
        appendLog(state, `Bounce Back! flips Boss table turn order (${clash.turnOrderDir > 0 ? 'clockwise' : 'counter-clockwise'}).`);
      }
      appendLog(state, `${hero.name} Bounce Back! — reflects 1 Dmg (${clash.monsterName} at ${clash.monsterHp} HP).`);
    } else if (card.kind === 'tuckered') {
      damageMonster(state, hero, 2 + themeSparkBonus(state.themeId, card), card, { direct: true });
      appendLog(state, `${hero.name} Tuckered Out! (+2) — ${clash.monsterName} takes 2 direct Dmg (${clash.monsterHp} HP).`);
      // G-24 Tick-Tock lantern
      if (hero.belt?.some((b) => b.id === 'G-24')) {
        drawAction(state, hero);
        appendLog(state, `Tick-Tock Pocket Lantern — draw 1 Action!`);
      }
    }
  } else {
    const kind = classifyPlay(card, clash, playOpts);
    afterPlayUpdateActive(clash, card, wildSuit, playOpts);
    if (isWild(card) || kind === 'clean') {
      let dmg = weaponStrike(hero);
      if (hero.weapon?.strikeBonusSuit && card.suit === hero.weapon.strikeBonusSuit) dmg += 1;
      dmg += themeSparkBonus(state.themeId, card);
      if (isWild(card)) {
        clash.activeSuit = wildSuit || hero.preferredSuit || 'brawn';
        appendLog(state, `${hero.name} Heroic Wild! — Strike ${dmg}. New suit: ${clash.activeSuit}.`);
      } else {
        appendLog(state, `${hero.name} Clean Strike with ${cardLabel(card)} — ${dmg} Dmg!`);
      }
      damageMonster(state, hero, dmg, card);
      applyHeroStrikeTriggers(state, hero, card, kind);
    } else if (kind === 'parry') {
      appendLog(state, `${hero.name} PARRIES with ${cardLabel(card)}! Suit → ${clash.activeSuit}.`);
      if (hero.perk?.id === 'excuse-me-no' && !hero.perkUsedThisClash) {
        hero.hp = Math.min(hero.maxHp, hero.hp + 1);
        hero.perkUsedThisClash = true;
        appendLog(state, `${hero.name} perk Excuse Me, No — heal 1 HP (${hero.hp}).`);
      }
      // G-14 Barn-Door: Parries reflect 1
      if (hero.offhand?.id === 'G-14') {
        damageMonster(state, hero, 1, card);
        appendLog(state, `Barn-Door Tower Shield reflects 1 Dmg!`);
      }
      applyHeroStrikeTriggers(state, hero, card, kind);
    } else {
      let chip = 1 + themeSparkBonus(state.themeId, card);
      damageMonster(state, hero, chip, card);
      appendLog(state, `${hero.name} Guards with ${cardLabel(card)} — ${chip} chip Dmg (${clash.monsterName} at ${clash.monsterHp}).`);
      applyHeroStrikeTriggers(state, hero, card, kind);
    }
  }

  // G-21 Red 5/6 adds Cramp
  if (hero.weapon?.id === 'G-21' && card.suit === 'brawn' && (card.rank === 5 || card.rank === 6)) {
    addCramp(state, hero, 1);
    appendLog(state, `Overly Dramatic Greatsword — ${hero.name} gains 1 Cramp!`);
  }

  // G-19 Boom-Hammer Blue 4 auto-Daze
  if (hero.weapon?.id === 'G-19' && card.suit === 'grit' && Number(card.rank) === 4) {
    clash.monsterDazed = true;
    appendLog(state, `Boom-Hammer of Boops — Blue 4 auto-Daze!`);
  }

  // G-20 Sneaky Blanket: Yellow 1 or 2 → flee
  if (
    hero.armor?.id === 'G-20' &&
    card.suit === 'zip' &&
    (Number(card.rank) === 1 || Number(card.rank) === 2)
  ) {
    discardToAction(state, card);
    appendLog(state, `Sneaky Blanket of Vanishing — ${hero.name} tip-toes out of combat!`);
    cleanupClash(state, { victory: false });
    return 'flee';
  }

  discardToAction(state, card);
  return again ? 'again' : 'done';
}

function applyHeroStrikeTriggers(state, hero, card, kind) {
  const clash = state.clash;
  if (!clash) return;
  // G-23 Snack-Pocket Plate: Red 3 heals 1
  if (hero.armor?.id === 'G-23' && card.suit === 'brawn' && Number(card.rank) === 3) {
    hero.hp = Math.min(hero.maxHp, hero.hp + 1);
    appendLog(state, `Snack-Pocket Plate — ${hero.name} heals 1 HP (${hero.hp}).`);
  }
  // MON-03 Grumpy Spores: Brawn hit → Cramp
  if (clash.traitId === 'grumpy-spores' && card.suit === 'brawn' && (kind === 'clean' || kind === 'guard')) {
    addCramp(state, hero, 1);
    appendLog(state, `Grumpy Spores! ${hero.name} gains 1 Cramp!`);
  }
}

function damageMonster(state, hero, amount, card, opts = {}) {
  const clash = state.clash;
  if (!clash) return;
  let dmg = amount;

  // MON-05 Cozy Nap: Spark heals instead of hurts
  if (clash.traitId === 'cozy-nap' && card?.suit === 'spark' && !opts.direct) {
    clash.monsterHp = Math.min(clash.monsterMaxHp, clash.monsterHp + 1);
    appendLog(state, `Cozy Nap — Spark soothes ${clash.monsterName} (+1 HP → ${clash.monsterHp}).`);
    return;
  }

  // B-01 Too Much Metal: Brawn 1–2 bounce unless armor-pierced
  if (
    clash.traitId === 'too-much-metal' &&
    card?.suit === 'brawn' &&
    (Number(card.rank) === 1 || Number(card.rank) === 2) &&
    !opts.ignoreArmor &&
    !opts.pierce
  ) {
    appendLog(state, `Way Too Much Metal — Brawn Rank ${card.rank} bounces off (0 Dmg)!`);
    return;
  }

  // MON-02 Rattle Armor: ignore first 1 damage
  if (clash.traitId === 'rattle-armor' && !clash.ignoredFirstHit && dmg > 0) {
    clash.ignoredFirstHit = true;
    dmg -= 1;
    appendLog(state, `Rattle Armor absorbs the first 1 damage!`);
  }

  clash.monsterHp = Math.max(0, clash.monsterHp - Math.max(0, dmg));
}

function resolveMonsterCardPlay(state, hero, card) {
  const clash = state.clash;
  const effRank =
    card.rank != null
      ? { ...card, rank: effectiveMonsterRank(card, clash) }
      : card;

  if (isSpecial(card)) {
    afterPlayUpdateActive(clash, card);
    if (card.kind === 'daze') {
      if (clash.traitId === 'three-way-team') {
        clash.pendingKoboldSwings = 2;
        appendLog(state, `${clash.monsterName} plays Daze! — Three-Way Team queues two free swings (won't miss).`);
      } else {
        clash.heroDazed = true;
        appendLog(state, `${clash.monsterName} plays Daze! — ${hero.name} will miss next turn.`);
      }
    } else if (card.kind === 'bounce') {
      let dmg = 1 + themeSparkBonus(state.themeId, card);
      hurtHero(state, hero, dmg, card);
      appendLog(state, `${clash.monsterName} Bounce Back!`);
    } else if (card.kind === 'tuckered') {
      addCramp(state, hero, 2);
      appendLog(state, `${clash.monsterName} Tuckered Out! — ${hero.name} gains 2 Cramp!`);
    }
  } else {
    const kind = classifyPlay(effRank, clash);
    afterPlayUpdateActive(clash, {
      ...card,
      rank: effRank.rank ?? card.rank,
    });
    if (isWild(card) || kind === 'clean') {
      let dmg = clash.baseDmg + themeSparkBonus(state.themeId, card);
      if (clash.traitId === 'lime-jiggle' && clash.usedDesperation) dmg += 1;
      if (
        clash.traitId === 'big-appetite' &&
        card.rank != null &&
        (Number(effRank.rank) >= 5)
      ) {
        dmg += 1;
      }
      hurtHero(state, hero, dmg, effRank);
      appendLog(state, `${clash.monsterName} hits with ${cardLabel(card)} for ${dmg}! (${hero.name} ${hero.hp} HP)`);
      applyMonsterHitTraits(state, hero, card);
    } else if (kind === 'parry') {
      appendLog(state, `${clash.monsterName} Parries with ${cardLabel(card)}.`);
    } else {
      let dmg = 1 + themeSparkBonus(state.themeId, card);
      if (clash.traitId === 'lime-jiggle' && clash.usedDesperation) dmg += 1;
      hurtHero(state, hero, dmg, effRank);
      appendLog(state, `${clash.monsterName} glancing hit (${dmg}). ${hero.name} at ${hero.hp} HP.`);
      applyMonsterHitTraits(state, hero, card);
    }
  }
  discardToAction(state, card);
}

function applyMonsterHitTraits(state, hero, card) {
  const clash = state.clash;
  if (!clash) return;
  // MON-06 Button Nibbler
  if (clash.traitId === 'button-nibbler') {
    if (hero.armor && !hero.armor.tapped) {
      hero.armor.tapped = true;
      appendLog(state, `Button Nibbler taps ${hero.name}'s ${hero.armor.name}!`);
    } else {
      hero.hp = Math.max(0, hero.hp - 1);
      appendLog(state, `Button Nibbler +1 Dmg (armor already tapped/none) — ${hero.name} at ${hero.hp} HP.`);
    }
  }
}

function hurtHero(state, hero, amount, card) {
  const clash = state.clash;
  if (clash?.negateNextMonsterHit) {
    clash.negateNextMonsterHit = false;
    appendLog(state, `Panicked Duck — ${hero.name} negates the hit!`);
    return;
  }
  let dmg = amount;
  const rank = card?.rank != null ? Number(card.rank) : null;
  if (rank != null && hero.armor?.ignoreRanks?.includes(rank)) {
    appendLog(state, `${hero.name}'s armor ignores Rank ${rank} damage!`);
    return;
  }
  if (hero.offhand?.tapBlock && !hero.offhand.tapped) {
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

function resolveDesperation(state, hero, action = {}) {
  const clash = state.clash;
  if (!state.decks.desperation.length) {
    appendLog(state, 'Desperation deck empty!');
    return;
  }
  const card = state.decks.desperation.shift();
  clash.lastDesperation = card;
  clash.usedDesperation = true;
  appendLog(state, `${hero.name} flips Desperation: ${card.title}! (${card.outcome})`);

  const heroSuit = action.chosenSuit || hero.preferredSuit || 'brawn';
  const dealerSuit = action.dealerSuit || ['brawn', 'grit', 'zip', 'spark'][Math.floor(Math.random() * 4)];
  const baseId = card.id?.replace(/-.*/, '') || card.id;

  // B-02 Theatrical Encore
  if (clash.traitId === 'theatrical-encore') {
    clash.monsterHp = Math.min(clash.monsterMaxHp, clash.monsterHp + 1);
    appendLog(state, `Theatrical Encore — ${clash.monsterName} heals 1 HP (${clash.monsterHp}).`);
  }

  switch (baseId) {
    case 'D-01':
    case 'D-02':
    case 'D-03': // Banana-Peel Lunge
      clash.monsterHp = Math.max(0, clash.monsterHp - 1);
      hero.hp = Math.max(0, hero.hp - 1);
      clash.activeSuit = dealerSuit;
      clash.activeRank = 1;
      drawTwist(state, 'Messy Desperation');
      break;
    case 'D-04':
    case 'D-05': // Dropped the Sword!
      hero.hp = Math.max(0, hero.hp - 2);
      clash.activeRank = 1;
      drawTwist(state, 'Dropped the Sword!');
      break;
    case 'D-06':
    case 'D-07': // Giant Sneeze!
      addCramp(state, hero, 1);
      for (let i = 0; i < 2 && state.decks.action.length; i += 1) {
        clash.monsterHand.push(state.decks.action.shift());
      }
      clash.activeSuit = dealerSuit;
      clash.activeRank = 2;
      drawTwist(state, 'Messy Desperation');
      break;
    case 'D-08':
    case 'D-09': // Tangled Shoelaces
      addCramp(state, hero, 1);
      if (hero.hand.length) {
        const i = Math.floor(Math.random() * hero.hand.length);
        discardToAction(state, hero.hand.splice(i, 1)[0]);
      }
      clash.activeRank = 1;
      drawTwist(state, 'Messy Desperation');
      break;
    case 'D-10':
    case 'D-11': { // Wardrobe Malfunction
      const tapTarget =
        (hero.offhand && !hero.offhand.tapped && hero.offhand) ||
        (hero.armor && !hero.armor.tapped && hero.armor) ||
        null;
      if (tapTarget) {
        tapTarget.tapped = true;
        appendLog(state, `Wardrobe Malfunction taps ${tapTarget.name}!`);
      } else {
        hero.hp = Math.max(0, hero.hp - 2);
        appendLog(state, 'Wardrobe Malfunction — no untapped gear; take 2 Dmg.');
      }
      clash.monsterHp = Math.max(0, clash.monsterHp - 1);
      clash.activeRank = 2;
      drawTwist(state, 'Messy Desperation');
      break;
    }
    case 'D-12': // Boo-Boo Backfire
      hero.hp = Math.max(0, hero.hp - 2);
      clash.monsterHp = Math.min(clash.monsterMaxHp, clash.monsterHp + 1);
      clash.activeSuit = 'spark';
      clash.activeRank = 3;
      drawTwist(state, 'Messy Desperation');
      break;
    case 'D-13': // Brave Backward Sprint
      clash.activeRank = 1;
      if (action.swapRooms) {
        const hidden = state.map.tiles.filter((t) => !t.faceUp);
        if (hidden.length >= 2) {
          swapTilePositions(hidden[0], hidden[1]);
          appendLog(state, 'Brave Backward Sprint — Dealer swaps 2 unflipped rooms.');
        } else {
          drawTwist(state, 'Brave Backward Sprint');
        }
      } else {
        drawTwist(state, 'Brave Backward Sprint');
      }
      break;
    case 'D-14':
    case 'D-15': // Lucky Elbow Poke
      clash.monsterHp = Math.max(0, clash.monsterHp - 1);
      clash.activeSuit = heroSuit;
      clash.activeRank = 1;
      break;
    case 'D-16':
    case 'D-17': // Quick Snack Break
      hero.hp = Math.min(hero.maxHp, hero.hp + 1);
      drawAction(state, hero);
      clash.activeRank = 1;
      break;
    case 'D-18': // Panicked Duck
      clash.negateNextMonsterHit = true;
      clash.activeSuit = heroSuit;
      clash.activeRank = 2;
      appendLog(state, 'Panicked Duck — next Monster hit negated!');
      break;
    case 'D-19': { // Accidental Mega-Crit!
      const dmg = weaponStrike(hero) + 2;
      clash.monsterHp = Math.max(0, clash.monsterHp - dmg);
      clash.activeSuit = heroSuit;
      clash.activeRank = 1;
      appendLog(state, `Accidental Mega-Crit for ${dmg} (ignores Monster Armor)!`);
      break;
    }
    case 'D-20': { // Wait, What's in My Pocket?
      clash.monsterHp = Math.max(0, clash.monsterHp - 1);
      const beltPool = (state.decks.loot || []).filter((c) => c.slot === 'belt');
      const item = beltPool.shift() || drawLoot(state, 1)[0];
      if (item) {
        // remove from loot if pulled from filter view
        state.decks.loot = (state.decks.loot || []).filter((c) => c.id !== item.id);
        grantLootToHero(state, hero, item);
        appendLog(state, `${hero.name} finds ${item.name} in a pocket!`);
      }
      clash.activeSuit = heroSuit;
      clash.activeRank = 1;
      break;
    }
    default:
      hero.hp = Math.max(0, hero.hp - 1);
      clash.activeRank = 1;
      if (card.tier === 'messy') drawTwist(state, 'Messy Desperation');
  }

  appendLog(
    state,
    `Desperation resolved — ${clash.monsterName} ${clash.monsterHp} HP, ${hero.name} ${hero.hp} HP. Active → ${clash.activeSuit || '?'} ${clash.activeRank ?? '?'}`,
  );
}

function discardToAction(state, card) {
  if (!card || isCramp(card)) return;
  state.decks.actionDiscard = state.decks.actionDiscard || [];
  state.decks.actionDiscard.push(card);
}

function knockDownHero(state, hero) {
  // G-30 Second Wind Snack Charm — once per floor, keep hand
  const charmIdx = (hero.belt || []).findIndex((b) => b.id === 'G-30');
  if (charmIdx >= 0 && !hero.secondWindUsed) {
    hero.belt.splice(charmIdx, 1);
    hero.secondWindUsed = true;
    hero.hp = 4;
    hero.downed = false;
    appendLog(
      state,
      `${hero.name} eats the Second Wind Snack Charm — bounces back to 4 HP and keeps their hand!`,
    );
    return;
  }

  hero.hp = 0;
  hero.downed = true;
  for (const c of hero.hand) discardToAction(state, c);
  hero.hand = [];
  appendLog(state, `${hero.name} is DOWNED! Hand discarded.`);

  const clash = state.clash;
  if (clash?.isBoss && (clash.fighters?.length || 1) > 1) {
    // Remove downed fighter; continue if anyone left
    clash.fighters = clash.fighters.filter((id) => {
      const h = state.heroes[id];
      return h && !h.downed;
    });
    if (clash.fighters.length) {
      clash.fighterIndex = 0;
      clash.heroPlayerId = clash.fighters[0];
      clash.whoseTurn = 'hero';
      clash.needsDraw = true;
      appendLog(state, `Boss clash continues with ${clash.fighters.length} Hero(es).`);
      return;
    }
  }
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
  const gearId = loot.gearId || String(loot.id || '').split('-')[0];
  const item = gearRuntimeFromId(gearId);
  item.name = item.name || loot.name;
  const slot = item.slot || loot.slot;
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
  const bootsIgnore = hero.armor?.id === 'G-18';
  if (id === 'E-01') {
    if (choice === 'a') drawAction(state, hero);
    else {
      if (bootsIgnore) {
        appendLog(state, 'Bouncy Rubber Boots ignore 1 trap damage!');
        hero.hp = Math.max(0, hero.hp - 1);
      } else {
        hero.hp = Math.max(0, hero.hp - 2);
      }
      addCramp(state, hero, 1);
      drawTwist(state, 'Trap mishap');
    }
  } else if (id === 'E-02') {
    if (choice !== 'a') {
      if (bootsIgnore) appendLog(state, 'Bouncy Rubber Boots ignore 1 trap damage!');
      else hero.hp = Math.max(0, hero.hp - 1);
      state.explorationActionsLeft = Math.max(0, state.explorationActionsLeft - 1);
      appendLog(state, 'Splat! Next move is sticky (lost 1 leftover action as proxy).');
      drawTwist(state, 'Trap mishap');
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
      // Help Pip: give Weapon or Armor → draw 1 replacement Tier 0 starter
      if (hero.weapon) {
        appendLog(state, `${hero.name} gives ${hero.weapon.name} to Pip.`);
        hero.weapon = null;
        const starters = gearByTier(0).filter((g) => g.slot === 'weapon');
        if (starters.length) {
          const pick = starters[Math.floor(Math.random() * starters.length)];
          grantLootToHero(state, hero, { gearId: pick.id, name: pick.name, slot: pick.slot });
          appendLog(state, `Pip gifts a replacement starter: ${pick.name}.`);
        }
      } else if (hero.armor) {
        appendLog(state, `${hero.name} gives ${hero.armor.name} to Pip.`);
        hero.armor = null;
        const starters = gearByTier(0).filter((g) => g.slot === 'armor');
        if (starters.length) {
          const pick = starters[Math.floor(Math.random() * starters.length)];
          grantLootToHero(state, hero, { gearId: pick.id, name: pick.name, slot: pick.slot });
          appendLog(state, `Pip gifts a replacement starter: ${pick.name}.`);
        }
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
      const i = Math.floor(Math.random() * hidden.length);
      let j = Math.floor(Math.random() * hidden.length);
      if (j === i) j = (j + 1) % hidden.length;
      swapTilePositions(hidden[i], hidden[j]);
      // Fix hero roomKeys if somehow on those tiles (shouldn't be face-down)
      appendLog(state, `Musical Rooms! Swapped two face-down tiles.`);
    } else {
      appendLog(state, 'Not enough face-down rooms to swap.');
    }
  } else if (/Boss Espresso/i.test(twist.name)) {
    if (state.clash) {
      if (action.espressoMode === 'cards') {
        for (let i = 0; i < 2 && state.decks.action.length; i += 1) {
          state.clash.monsterHand.push(state.decks.action.shift());
        }
        appendLog(state, `${state.clash.monsterName} guzzles espresso — draws 2 Action cards!`);
      } else {
        state.clash.monsterHp = Math.min(
          state.clash.monsterMaxHp,
          state.clash.monsterHp + 2,
        );
        appendLog(state, `${state.clash.monsterName} guzzles espresso (+2 HP → ${state.clash.monsterHp}).`);
      }
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
    const intern = MONSTERS.find((m) => m.id === 'MON-01') || MONSTERS[0];
    const candidates = state.map.tiles.filter(
      (t) => t.faceUp && t.cleared && t.kind !== 'entrance' && t.kind !== 'stairs' && !t.lurkingMonster,
    );
    if (candidates.length) {
      const room = candidates[Math.floor(Math.random() * candidates.length)];
      room.lurkingMonster = { ...intern };
      room.cleared = false;
      appendLog(
        state,
        `Surprise Intern! ${intern.name} spawns in ${room.name}. Next Hero who enters starts a clash.`,
      );
    } else {
      appendLog(state, 'Surprise Intern! No cleared empty room — Twist fizzles.');
    }
  } else if (/Sticky Door/i.test(twist.name)) {
    // Jam between two adjacent tiles (prefer involving active hero room)
    const hero = state.heroes[state.turnOrder[state.activeHeroIndex]];
    const from = state.map.tiles.find((t) => t.key === hero?.roomKey) || state.map.tiles[0];
    const neighbor = state.map.tiles.find(
      (t) => t.key !== from.key && adjacentOrthogonal(from, t) && tilesConnect(from, t),
    );
    if (neighbor) {
      state.map.barriers = state.map.barriers || [];
      state.map.barriers.push({ aKey: from.key, bKey: neighbor.key });
      appendLog(
        state,
        `Sticky Door Jam! Barrier between ${from.name} and ${neighbor.name} (pry with Brawn 3+ Stunt).`,
      );
    } else {
      appendLog(state, 'Sticky Door Jam! No adjacent doorway found — Twist fizzles.');
    }
  } else if (/Hall Monitor/i.test(twist.name)) {
    // Slide a lurking / uncleared revealed monster room marker 1 step toward nearest hero
    const lairs = state.map.tiles.filter(
      (t) => t.faceUp && !t.cleared && (t.kind === 'monster' || t.lurkingMonster),
    );
    if (!lairs.length) {
      appendLog(state, 'Hall Monitor Patrol — no unengaged revealed monsters to slide.');
      return;
    }
    const lair = lairs[0];
    const heroes = Object.values(state.heroes).filter((h) => !h.downed);
    if (!heroes.length) return;
    let nearest = null;
    let best = Infinity;
    for (const h of heroes) {
      const ht = state.map.tiles.find((t) => t.key === h.roomKey);
      if (!ht) continue;
      const d = Math.abs(ht.x - lair.x) + Math.abs(ht.y - lair.y);
      if (d < best) {
        best = d;
        nearest = ht;
      }
    }
    if (!nearest || best <= 1) {
      appendLog(state, 'Hall Monitor Patrol — monster already adjacent / nowhere to slide.');
      return;
    }
    const dx = Math.sign(nearest.x - lair.x);
    const dy = dx === 0 ? Math.sign(nearest.y - lair.y) : 0;
    const dest = tileAt(state, lair.x + dx, lair.y + dy);
    if (dest && dest.cleared && !dest.lurkingMonster) {
      dest.lurkingMonster = lair.lurkingMonster || MONSTERS.find((m) => m.id === 'MON-01');
      dest.cleared = false;
      lair.lurkingMonster = null;
      if (lair.kind === 'monster') lair.cleared = true; // vacated
      appendLog(state, `Hall Monitor Patrol! A monster slides into ${dest.name}.`);
    } else {
      appendLog(state, 'Hall Monitor Patrol — slide path blocked.');
    }
  }
}

function swapTilePositions(a, b) {
  const ax = a.x;
  const ay = a.y;
  const akey = a.key;
  a.x = b.x;
  a.y = b.y;
  a.key = b.key;
  b.x = ax;
  b.y = ay;
  b.key = akey;
}

function barrierBlocks(state, from, to) {
  const bars = state.map?.barriers || [];
  return bars.some(
    (b) =>
      (b.aKey === from.key && b.bKey === to.key) ||
      (b.aKey === to.key && b.bKey === from.key),
  );
}

function applyStuntSuccess(state, hero, heroPid, action = {}) {
  const purpose = action.purpose || 'generic';
  if (purpose === 'peek') {
    const hidden = state.map.tiles.find((t) => !t.faceUp);
    if (hidden) appendLog(state, `Stunt peek: face-down room is ${hidden.name} (${hidden.kind}).`);
    else appendLog(state, 'Stunt succeeds — nothing left to peek.');
  } else if (purpose === 'unlock-stairs') {
    unlockStairs(state, `${hero.name}'s 5+ Zip/Brawn Key Stunt unlocks the Stairway Down!`);
  } else if (purpose === 'pry') {
    const from = state.map.tiles.find((t) => t.key === hero.roomKey);
    const bars = state.map.barriers || [];
    const bar = bars.find((b) => b.aKey === from?.key || b.bKey === from?.key);
    if (bar) {
      state.map.barriers = bars.filter((b) => b !== bar);
      appendLog(state, `${hero.name} pries open a Sticky Door Jam!`);
    } else {
      appendLog(state, `${hero.name} stunt succeeds — no jam here to pry.`);
    }
  } else if (purpose === 'bribe') {
    // T-02 / Tunnel Troll bribe: flee current clash if any, else narrate
    if (state.clash) {
      const beltIdx = Number(action.beltIndex);
      if (Number.isInteger(beltIdx) && hero.belt?.[beltIdx]) {
        const paid = hero.belt.splice(beltIdx, 1)[0];
        appendLog(state, `${hero.name} bribes with ${paid.name} — clash ends peacefully.`);
        cleanupClash(state, { victory: false });
      } else {
        appendLog(state, 'Bribe stunt needs a belt consumable.');
      }
    } else {
      appendLog(state, `${hero.name} stunt succeeds (bribe/haggle).`);
      drawAction(state, hero);
    }
  } else if (purpose === 'hallway') {
    drawAction(state, hero);
    appendLog(state, `${hero.name} stunt finds a loose brick — draws 1 Action.`);
  } else {
    appendLog(state, `${hero.name} pulls off the stunt! (Dealer narrates the clever edge.)`);
    drawAction(state, hero);
  }
}

export function viewForPlayer(state, playerId) {
  return publicStateFor(state, playerId);
}

export function gearLabel(id) {
  return getGear(id)?.name || id;
}
