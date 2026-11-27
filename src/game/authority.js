import {
  RULES,
  getHero,
  getGear,
  THEMES,
  BOSSES,
  MONSTERS,
  STORIES,
  bossHp,
  gearByTier,
} from '../data/index.js';
import {
  createHeroRuntime,
  gearRuntimeFromId,
  buildFloorMap,
  prepareFloorDecks,
  pickRandomTheme,
  pickRandomBoss,
  pickNextUnused,
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
import { bossStartCheck, bossJoinCheck } from './boss.js';

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
        next.usedThemes = [next.themeId];
        next.usedBosses = [next.bossId];
        next.layoutMode = action.layoutMode === 'fixed' ? 'fixed' : 'random';
        next.decks = prepareFloorDecks();
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
          // Deal starting action cards
          for (let i = 0; i < (RULES.startingActionHand || 4); i += 1) {
            if (next.decks.action.length) {
              next.heroes[h.id].hand.push(next.decks.action.shift());
            }
          }
        }
        next.turnOrder = heroes.map((h) => h.id);
        next.activeHeroIndex = 0;
        next.explorationActionsLeft = RULES.explorationActionsPerTurn || 2;
        next.phase = 'exploring';
        next.floor = { bossDefeated: false, stairsUnlocked: false, shinyKey: false };
        const theme = THEMES.find((t) => t.id === next.themeId);
        const boss = BOSSES.find((b) => b.id === next.bossId);
        const stairsDist = next.map.stairsDistance ?? '?';
        appendLog(
          next,
          `Floor 1 begins! Theme: ${theme.name}. Boss waiting: ${boss.name} (${bossHp(next.bossId, 1)} HP, +${RULES.bossHpPerExtraHero} per extra Hero in the fight).`,
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

        // Surprise Intern / lurking or surviving monster on a room
        if (to.faceUp && to.lurkingMonster) {
          next.explorationActionsLeft = 0;
          const lurking = to.lurkingMonster;
          to.lurkingMonster = null;
          appendLog(next, `${playerName} engages ${lurking.name} (${lurking.hp} HP)!`);
          startClash(next, heroPid, to, lurking);
          break;
        }

        if (!to.faceUp) {
          to.faceUp = true;
          appendLog(next, `${playerName} reveals ${to.name}!`);
          if (to.kind === 'monster') {
            next.explorationActionsLeft = 0;
            startClash(next, heroPid, to);
          } else if (to.kind === 'boss') {
            announceBossWaiting(next, playerName, { revealed: true });
          } else if (to.kind === 'trap') {
            beginEventPrompt(next, heroPid, to);
          } else if (to.kind === 'merchant') {
            beginMerchantRoom(next, to);
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
          // Re-enter an uncleared lair (e.g. after flee). The Boss never auto-starts.
          if (to.kind === 'monster' && !to.cleared) {
            next.explorationActionsLeft = 0;
            startClash(next, heroPid, to);
          } else if (to.kind === 'boss' && !to.cleared) {
            announceBossWaiting(next, playerName);
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

      case 'start-boss-clash': {
        const check = bossStartCheck(next, actor, action.playerId);
        if (!check.ok) return fail(next, check.error);
        const caller =
          actor.role === 'dealer' ? 'Dealer' : next.heroes[check.leadId]?.name || actor.name;
        appendLog(
          next,
          `${caller} calls the Boss fight — ${check.fighterIds.length} Hero(es) step up!`,
        );
        next.explorationActionsLeft = 0;
        startClash(next, check.leadId, check.tile, null, { fighterIds: check.fighterIds });
        break;
      }

      case 'join-boss-clash': {
        const heroPid =
          actor.role === 'dealer' ? action.playerId : actor.role === 'hero' ? actorId : null;
        if (!heroPid) return fail(next, 'Pick a Hero to join the Boss clash');
        const check = bossJoinCheck(next, heroPid);
        if (!check.ok) return fail(next, check.error);
        next.heroes[heroPid].roomKey = next.clash.roomKey;
        joinBossClash(next, heroPid);
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
          clash.twinRank = null;
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

        if (clash.twinRank != null) {
          if (isSpecial(card) || isWild(card) || Number(card.rank) !== clash.twinRank) {
            return fail(next, `Twin Butter-Knives follow-up must match Rank ${clash.twinRank}`);
          }
          hero.hand = hero.hand.filter((c) => c.id !== card.id);
          afterPlayUpdateActive(clash, card);
          let dmg = weaponStrike(hero) + themeSparkBonus(state.themeId, card);
          if (hero.weapon?.strikeBonusSuit && card.suit === hero.weapon.strikeBonusSuit) dmg += 1;
          const gritPierces = Boolean(hero.weapon?.gritIgnoresArmor && card.suit === 'grit');
          damageMonster(next, hero, dmg, card, { ignoreArmor: gritPierces });
          appendLog(
            next,
            `${hero.name} Twin Butter-Knives 2nd Strike (${cardLabel(card)}) — ${dmg} Dmg!`,
          );
          applyHeroStrikeTriggers(next, hero, card, 'clean');
          if (
            hero.armor?.id === 'G-20' &&
            card.suit === 'zip' &&
            (Number(card.rank) === 1 || Number(card.rank) === 2)
          ) {
            discardToAction(next, card);
            clash.twinRank = null;
            appendLog(next, `Sneaky Blanket of Vanishing — ${hero.name} tip-toes out of combat!`);
            const fleeFrom = clash.roomKey;
            cleanupClash(next, { victory: false });
            relocateHeroAfterFlee(next, hero, fleeFrom);
            break;
          }
          discardToAction(next, card);
          clash.twinRank = null;
          if (next.clash && next.clash.monsterHp <= 0) {
            endClashVictory(next);
          } else {
            advanceAfterHeroTurn(next);
          }
          break;
        }

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
        } else if (
          next.clash &&
          next.clash.monsterHp > 0 &&
          hero.weapon?.id === 'G-13' &&
          card.rank != null &&
          !isSpecial(card) &&
          !isWild(card) &&
          hero.hand.some(
            (c) => !isCramp(c) && !isSpecial(c) && !isWild(c) && Number(c.rank) === Number(card.rank),
          )
        ) {
          clash.twinRank = Number(card.rank);
          clash.needsDraw = false;
          clash.whoseTurn = 'hero';
          appendLog(
            next,
            `Twin Butter-Knives ready — ${hero.name} may play another Rank ${card.rank} or finish turn.`,
          );
        } else {
          advanceAfterHeroTurn(next);
        }
        if (next.clash && next.clash.monsterHp <= 0) {
          endClashVictory(next);
        }
        break;
      }

      case 'clash-end-twin': {
        if (next.phase !== 'clash' || !next.clash) return fail(next, 'No active clash');
        const clash = next.clash;
        if (clash.whoseTurn !== 'hero') return fail(next, 'Not hero combat turn');
        if (clash.twinRank == null) return fail(next, 'No Twin Knives follow-up pending');
        if (actor.role !== 'dealer' && actorId !== clash.heroPlayerId) return fail(next, 'Not your clash');
        clash.twinRank = null;
        advanceAfterHeroTurn(next);
        break;
      }

      case 'clash-skip-dazed': {
        if (next.phase !== 'clash' || !next.clash) return fail(next, 'No active clash');
        const clash = next.clash;
        if (clash.whoseTurn !== 'hero') return fail(next, 'Not hero combat turn');
        if (!clash.heroDazed) return fail(next, 'Hero is not Dazed');
        const heroPid = clash.heroPlayerId;
        if (actor.role !== 'dealer' && actorId !== heroPid) return fail(next, 'Not your clash');
        const hero = next.heroes[heroPid];
        clash.heroDazed = false;
        clash.twinRank = null;
        appendLog(next, `${hero.name} is Dazed and misses this turn!`);
        advanceAfterHeroTurn(next, { skipped: true });
        break;
      }

      case 'clash-clear-cramp': {
        if (next.phase !== 'clash' || !next.clash) return fail(next, 'No active clash');
        const clash = next.clash;
        if (clash.whoseTurn !== 'hero') return fail(next, 'Not hero combat turn');
        const hero = next.heroes[clash.heroPlayerId];
        if (actor.role !== 'dealer' && actorId !== clash.heroPlayerId) return fail(next, 'Not your clash');
        clash.twinRank = null;
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
        clash.twinRank = null;
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
        const def = getGear(item.gearId || item.id);
        if (def?.type === 'escape') {
          // G-29 Confetti Smoke Bomb — free combat use
          hero.belt.splice(beltIdx, 1);
          if (action.mode === 'flee') {
            appendLog(next, `${hero.name} pops ${def.name} and slips away!`);
            const fleeFrom = clash.roomKey;
            cleanupClash(next, { victory: false });
            relocateHeroAfterFlee(next, hero, fleeFrom);
          } else {
            clash.monsterDazed = true;
            appendLog(next, `${hero.name} pops ${def.name} — ${clash.monsterName} is Dazed! (Free action.)`);
          }
          break;
        }
        if (def?.type === 'heal') {
          if (hero.hp >= hero.maxHp) return fail(next, 'Already at full HP');
          hero.belt.splice(beltIdx, 1);
          hero.hp = Math.min(hero.maxHp, hero.hp + (def.heal || 4));
          appendLog(next, `${hero.name} sips ${def.name} mid-clash (+${def.heal || 4} HP → ${hero.hp}).`);
          break;
        }
        if (def?.type === 'revive' && Object.keys(next.heroes).length === 1 && (def.soloHeal || RULES.smellingSaltsSoloHeal) > 0) {
          if (hero.hp >= hero.maxHp) return fail(next, 'Already at full HP');
          const soloHeal = def.soloHeal || RULES.smellingSaltsSoloHeal || 3;
          hero.belt.splice(beltIdx, 1);
          hero.hp = Math.min(hero.maxHp, hero.hp + soloHeal);
          appendLog(next, `${hero.name} takes a quick whiff of ${def.name} mid-clash (+${soloHeal} HP → ${hero.hp}).`);
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
          const fleeFrom = next.clash.roomKey;
          cleanupClash(next, { victory: false });
          relocateHeroAfterFlee(next, hero, fleeFrom);
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

      case 'descend-stairs': {
        if (next.phase !== 'exploring') return fail(next, 'Not exploring');
        if (next.pending) return fail(next, 'Resolve the pending room prompt first');
        if (!next.floor?.stairsUnlocked) return fail(next, 'Stairway Down is still locked');
        const stairsTile = next.map.tiles.find((t) => t.kind === 'stairs');
        if (!stairsTile || stairsTile.locked) return fail(next, 'Stairway Down is still locked');
        const onStairs = Object.entries(next.heroes).find(
          ([, h]) => !h.downed && h.roomKey === stairsTile.key,
        );
        if (!onStairs) return fail(next, 'A conscious Hero must reach the Stairway Down first');
        const leaderName = next.players.find((p) => p.id === onStairs[0])?.name || onStairs[1].name;
        finishFloor(next, `${leaderName} leads the Group Descent down the Spiral Slide!`);
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
        finishFloor(next, action.message || `Dealer calls Floor ${next.floorNumber || 1} — celebrate or descend deeper!`);
        break;
      }

      case 'descend-floor': {
        if (next.phase !== 'victory') return fail(next, 'Finish the current floor first');
        if (actor.role !== 'dealer' && !next.heroes[actorId]) {
          return fail(next, 'Not a player in this game');
        }
        next.floorNumber = (next.floorNumber || 1) + 1;
        if (RULES.rotateThemeAndBossPerFloor !== false) {
          if (action.themeId && THEMES.some((t) => t.id === action.themeId)) {
            next.themeId = action.themeId;
            next.usedThemes = [...new Set([...(next.usedThemes || []), next.themeId])];
          } else {
            const { id, reset } = pickNextUnused(THEMES, next.usedThemes || [next.themeId], next.themeId);
            next.themeId = id;
            next.usedThemes = reset ? [id] : [...new Set([...(next.usedThemes || []), id])];
          }
          if (action.bossId && BOSSES.some((b) => b.id === action.bossId)) {
            next.bossId = action.bossId;
            next.usedBosses = [...new Set([...(next.usedBosses || []), next.bossId])];
          } else {
            const { id, reset } = pickNextUnused(BOSSES, next.usedBosses || [next.bossId], next.bossId);
            next.bossId = id;
            next.usedBosses = reset ? [id] : [...new Set([...(next.usedBosses || []), id])];
          }
        }
        const savedStoryStack = Array.isArray(next.storyStack) ? [...next.storyStack] : [];
        next.decks = prepareFloorDecks();
        next.storyStack = savedStoryStack;
        next.pending = null;
        next.clash = null;
        if (next.decks.twists.length) {
          next.decks.twistHand.push(next.decks.twists.shift());
        }
        next.map = buildFloorMap(next.layoutMode);
        next.map.barriers = next.map.barriers || [];
        const entrance = entranceTile(next);
        for (const hero of Object.values(next.heroes || {})) {
          if (hero.downed) {
            hero.downed = false;
            hero.hp = 5;
          }
          hero.hand = (hero.hand || []).filter((c) => !isCramp(c));
          while (hero.hand.length < 4 && next.decks.action.length) {
            hero.hand.push(next.decks.action.shift());
          }
          hero.roomKey = entrance.key;
          hero.shrineUsedThisFloor = false;
          hero.secondWindUsed = false;
          hero.perkUsedThisClash = false;
          hero.stuntGearUsed = { scarf: false, kaleidoscope: false };
          if (hero.offhand) hero.offhand.tapped = false;
          if (hero.armor) hero.armor.tapped = false;
        }
        const firstConscious = next.turnOrder.findIndex((id) => !next.heroes[id]?.downed);
        next.activeHeroIndex = firstConscious >= 0 ? firstConscious : 0;
        next.explorationActionsLeft = 2;
        next.phase = 'exploring';
        next.floor = { bossDefeated: false, stairsUnlocked: false, shinyKey: false };
        const nextTheme = THEMES.find((t) => t.id === next.themeId);
        const nextBoss = BOSSES.find((b) => b.id === next.bossId);
        appendLog(
          next,
          `Descended to Floor ${next.floorNumber}! Theme: ${nextTheme?.name || next.themeId}. Boss waiting: ${nextBoss?.name || next.bossId} (${bossHp(next.bossId, 1, next.floorNumber)} base HP). (${savedStoryStack.length} Story callback(s) carried forward.)`,
        );
        break;
      }

      case 'theme-swap-rooms': {
        if (actor.role !== 'dealer') return fail(next, 'Dealer only');
        if (next.themeId !== 'T-01') return fail(next, 'Requires Theme T-01 (Wobbly Shifting Maze)');
        if (next.phase !== 'exploring') return fail(next, 'Can only swap rooms while exploring');
        const hidden = next.map.tiles.filter((t) => !t.faceUp);
        if (hidden.length < 2) return fail(next, 'Need at least 2 unflipped rooms to swap');
        const a = (action.keyA && hidden.find((t) => t.key === action.keyA)) || hidden[0];
        const b = (action.keyB && hidden.find((t) => t.key === action.keyB && t.key !== a.key)) || hidden.find((t) => t.key !== a.key);
        swapTilePositions(a, b);
        appendLog(next, `The Wobbly Shifting Maze — Dealer swaps 2 unflipped rooms!`);
        break;
      }

      case 'interact': {
        if (next.phase !== 'exploring') return fail(next, 'Not exploring');
        if (next.pending) return fail(next, 'Resolve the pending prompt first');
        const heroPid = resolveHeroActor(next, actor, action.playerId);
        if (!heroPid) return fail(next, 'Not a hero');
        const hero = next.heroes[heroPid];
        if (!hero) return fail(next, 'Missing hero');
        const playerName = next.players.find((p) => p.id === heroPid)?.name || hero.name || 'Hero';

        if (action.subtype === 'use-consumable') {
          const beltIdx = Number(action.beltIndex);
          const item = hero.belt?.[beltIdx];
          if (!item) return fail(next, 'No belt item');
          const def = getGear(item.gearId || item.id);
          if (!def) return fail(next, 'Unknown consumable');
          if (def.type === 'heal') {
            if (hero.downed) return fail(next, 'DOWNED heroes cannot drink potions');
            if (actor.role !== 'dealer' && actorId !== heroPid) {
              return fail(next, 'Cannot use another hero potion');
            }
            if (hero.hp >= hero.maxHp) return fail(next, 'Already at full HP');
            hero.belt.splice(beltIdx, 1);
            hero.hp = Math.min(hero.maxHp, hero.hp + (def.heal || 4));
            appendLog(next, `${playerName} sips ${def.name} (+${def.heal || 4} HP → ${hero.hp}).`);
            break;
          }
          if (def.type === 'revive') {
            const isSolo = Object.keys(next.heroes).length === 1;
            const soloHeal = def.soloHeal || RULES.smellingSaltsSoloHeal || 0;
            if (isSolo && soloHeal > 0 && (!action.targetPlayerId || action.targetPlayerId === heroPid)) {
              if (hero.downed) return fail(next, 'DOWNED heroes cannot use smelling salts');
              if (actor.role !== 'dealer' && actorId !== heroPid) {
                return fail(next, 'Cannot use another hero consumable');
              }
              if (hero.hp >= hero.maxHp) return fail(next, 'Already at full HP');
              hero.belt.splice(beltIdx, 1);
              hero.hp = Math.min(hero.maxHp, hero.hp + soloHeal);
              appendLog(next, `${playerName} takes a quick whiff of ${def.name} (+${soloHeal} HP → ${hero.hp}).`);
              break;
            }
            if (next.turnOrder[next.activeHeroIndex] !== heroPid && actor.role !== 'dealer') {
              return fail(next, 'Not your turn');
            }
            if (next.explorationActionsLeft < 1) return fail(next, 'No exploration actions left');
            if (hero.downed) return fail(next, 'DOWNED heroes cannot interact');
            const targetId = action.targetPlayerId || heroPid;
            const ally = next.heroes[targetId];
            if (!ally?.downed || ally.roomKey !== hero.roomKey) {
              return fail(next, 'Need a DOWNED ally in your room');
            }
            next.explorationActionsLeft -= 1;
            hero.belt.splice(beltIdx, 1);
            ally.downed = false;
            ally.hp = def.reviveHp || RULES.smellingSaltsReviveHp || 4;
            ally.hand = [];
            for (let i = 0; i < (def.reviveCards || RULES.smellingSaltsReviveCards || 4); i += 1) {
              drawAction(next, ally);
            }
            appendLog(next, `${playerName} uses ${def.name} — ${ally.name} wakes at ${ally.hp} HP.`);
            maybeEndExplore(next);
            break;
          }
          return fail(next, 'That belt item is not usable here');
        }

        if (next.turnOrder[next.activeHeroIndex] !== heroPid && actor.role !== 'dealer') {
          return fail(next, 'Not your turn');
        }
        if (next.explorationActionsLeft < 1) return fail(next, 'No exploration actions left');
        if (hero.downed && action.subtype !== 'revive') return fail(next, 'DOWNED heroes cannot interact');
        const tile = next.map.tiles.find((t) => t.key === hero.roomKey);
        if (!tile?.faceUp) return fail(next, 'Must be in a face-up room');

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
          const healAmt = RULES.shrineRestHeal || 3;
          next.explorationActionsLeft -= 1;
          hero.shrineUsedThisFloor = true;
          hero.hp = Math.min(hero.maxHp, hero.hp + healAmt);
          appendLog(next, `${playerName} rests at the Cozy Cocoa Sanctuary (+${healAmt} HP → ${hero.hp}).`);
          maybeEndExplore(next);
          break;
        }

        if (action.subtype === 'revive') {
          if (tile.kind !== 'shrine') return fail(next, 'Revive ally at Sanctuary');
          const targetId = action.targetPlayerId;
          const ally = next.heroes[targetId];
          if (!ally?.downed) return fail(next, 'Target must be DOWNED in this room');
          if (ally.roomKey !== tile.key) return fail(next, 'Ally must share your room');
          // Free Ally Rescue per R-03 / rulebook §3 (rules_04): costs 1 Action, never consumes rescuer's personal Rest
          next.explorationActionsLeft -= 1;
          if (RULES.shrineReviveConsumesPersonalRest) {
            hero.shrineUsedThisFloor = true;
          }
          ally.downed = false;
          ally.hp = RULES.shrineReviveHp || 5;
          ally.hand = [];
          const reviveCards = RULES.shrineReviveCards || 4;
          for (let i = 0; i < reviveCards; i += 1) drawAction(next, ally);
          appendLog(
            next,
            `${playerName} revives ${ally.name} at the Sanctuary (${ally.hp} HP + ${reviveCards} cards).`,
          );
          maybeEndExplore(next);
          break;
        }

        if (action.subtype === 'merchant') {
          if (!tile.merchant) return fail(next, 'No merchant here');
          const hasLegacyBelt = action.beltIndex !== undefined && action.beltIndex !== null;
          if (!action.deal && !hasLegacyBelt) {
            next.pending = {
              kind: 'merchant',
              heroPlayerId: heroPid,
              tileKey: tile.key,
              merchant: tile.merchant,
            };
            appendLog(next, `${playerName} browses ${tile.merchant.name}'s cart.`);
            break;
          }
          const res = executeMerchantDeal(next, hero, playerName, tile, action, heroPid);
          if (!res.ok) return fail(next, res.error);
          break;
        }

        if (action.subtype === 'story') {
          if (!tile.story || tile.storyResolved) return fail(next, 'No active story here');
          if (action.choice) {
            applyStoryChoice(next, hero, tile.story, action.choice, tile.key, action);
            maybeEndExplore(next);
          } else {
            next.pending = {
              kind: 'story',
              heroPlayerId: heroPid,
              tileKey: tile.key,
              story: tile.story,
            };
            appendLog(next, `${playerName} speaks with ${tile.story.name}.`);
          }
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
          const tile = next.map.tiles.find((t) => t.key === pending.tileKey);
          if (tile?.kind === 'vault') tile.looted = true;
          next.pending = null;
          grantLootToHero(next, hero, kept, heroPid);
          appendLog(next, `${hero.name} keeps ${kept.name}.`);
          maybeEndExplore(next);
          break;
        }

        if (pending.kind === 'event') {
          const choice = String(action.choice || '').toLowerCase();
          if (choice !== 'a' && choice !== 'b') {
            return fail(next, 'Choose A or B');
          }
          const tile = next.map.tiles.find((t) => t.key === pending.tileKey);
          if (tile) {
            tile.cleared = true;
            tile.eventResolved = true;
          }
          next.pending = null;
          applyEventChoice(next, hero, pending.event, choice, action, heroPid);
          maybeEndExplore(next);
          break;
        }

        if (pending.kind === 'merchant') {
          if (action.cancel) {
            next.pending = null;
            break;
          }
          const tile = next.map.tiles.find((t) => t.key === pending.tileKey);
          const playerName = next.players.find((p) => p.id === heroPid)?.name || hero.name || 'Hero';
          next.pending = null;
          const res = executeMerchantDeal(next, hero, playerName, tile, action, heroPid);
          if (!res.ok) return fail(next, res.error);
          maybeEndExplore(next);
          break;
        }

        if (pending.kind === 'story') {
          const choice = String(action.choice || 'a').toLowerCase();
          next.pending = null;
          applyStoryChoice(next, hero, pending.story, choice, pending.tileKey, action, heroPid);
          maybeEndExplore(next);
          break;
        }

        if (pending.kind === 'belt-overflow') {
          const discardIdx = Number(action.discardIndex ?? action.dropIndex);
          const pool = [...(hero.belt || []), pending.newItem];
          if (!Number.isInteger(discardIdx) || discardIdx < 0 || discardIdx >= pool.length) {
            return fail(next, 'Pick a belt item to discard');
          }
          const [dropped] = pool.splice(discardIdx, 1);
          hero.belt = pool.slice(0, 2);
          if (dropped) {
            next.decks.lootDiscard = next.decks.lootDiscard || [];
            next.decks.lootDiscard.push(dropped);
            appendLog(next, `${hero.name} discards ${dropped.name} from belt (keeps ${hero.belt.map((b) => b.name).join(' & ')}).`);
          }
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
        const check = canPlayTwist(next, hand[idx]);
        if (!check.ok) return fail(next, check.reason);
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
          if (to.kind === 'monster') {
            // Carrying into a lair still triggers clash for the carrier
            startClash(next, heroPid, to);
            break;
          }
          if (to.kind === 'boss') announceBossWaiting(next, hero.name, { revealed: true });
          else if (to.kind === 'trap') beginEventPrompt(next, heroPid, to);
          else if (to.kind === 'merchant') beginMerchantRoom(next, to);
        } else {
          appendLog(next, `${hero.name} carries ${ally.name} to ${to.name} (2 Actions).`);
          if (to.lurkingMonster) {
            next.explorationActionsLeft = 0;
            const lurking = to.lurkingMonster;
            to.lurkingMonster = null;
            startClash(next, heroPid, to, lurking);
            break;
          }
          if (to.kind === 'monster' && !to.cleared) {
            next.explorationActionsLeft = 0;
            startClash(next, heroPid, to);
            break;
          }
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

function announceBossWaiting(state, heroName, { revealed = false } = {}) {
  const boss = BOSSES.find((b) => b.id === state.bossId) || BOSSES[0];
  appendLog(
    state,
    revealed
      ? `${boss.name} looms in the Boss Chamber — but waits. Gather the party, then call "Start Boss fight" when ready.`
      : `${heroName} waits in the Boss Chamber. ${boss.name} won't fight until someone calls it.`,
  );
}

/**
 * Open a clash. Lairs start as soon as a Hero walks in; the Boss only via `start-boss-clash`,
 * which passes every conscious Hero in the chamber as `fighterIds` (lead first).
 */
function startClash(state, heroPlayerId, tile, forcedMonster = null, { fighterIds = null } = {}) {
  state.phase = 'clash';
  let monsterName = 'Mystery Critter';
  let monsterHp = 4;
  let monsterMaxHp = null;
  let cunning = 3;
  let baseDmg = 1;
  let monsterId = null;
  let trait = '';
  let traitId = null;
  let lootText = '';
  const isBoss = tile.kind === 'boss' && !forcedMonster;
  const fighters =
    isBoss && fighterIds?.length
      ? [heroPlayerId, ...fighterIds.filter((id) => id !== heroPlayerId)]
      : [heroPlayerId];

  if (forcedMonster) {
    monsterName = forcedMonster.name;
    monsterHp = forcedMonster.hp;
    monsterMaxHp = forcedMonster.maxHp ?? forcedMonster.hp;
    cunning = forcedMonster.cunning;
    baseDmg = forcedMonster.baseDmg;
    monsterId = forcedMonster.id;
    trait = forcedMonster.trait || '';
    traitId = forcedMonster.traitId || null;
    lootText = forcedMonster.loot || '';
  } else if (isBoss) {
    const boss = BOSSES.find((b) => b.id === state.bossId) || BOSSES[0];
    // Rulebook §4.4: 10 HP + 4 per extra Hero + floor scaling *in the fight*.
    // Later joiners add their +4 in joinBossClash.
    const floorNum = state.floorNumber || 1;
    monsterName = boss.name;
    monsterHp = bossHp(boss.id, fighters.length, floorNum);
    cunning = boss.cunning;
    baseDmg = boss.baseDmg + (floorNum >= 3 ? (RULES.bossBaseDmgFloor3Bonus ?? 1) : 0);
    monsterId = boss.id;
    trait = boss.trait;
    traitId = boss.traitId || null;
    lootText = boss.reward || '';
  } else if (state.decks.monsters.length) {
    const m = state.decks.monsters.shift();
    const monFloorBonus = (RULES.monsterHpPerExtraFloor ?? 1) * Math.max(0, (state.floorNumber || 1) - 1);
    monsterName = m.name;
    monsterHp = m.hp + monFloorBonus;
    cunning = m.cunning;
    baseDmg = m.baseDmg;
    monsterId = m.id;
    trait = m.trait;
    traitId = m.traitId || null;
    lootText = m.loot || '';
  }

  const topUpTarget = RULES.combatHandTopUp || 5;
  for (const fid of fighters) {
    const fighter = state.heroes[fid];
    fighter.perkUsedThisClash = false;
    while (
      fighter.hand.filter((c) => c.type !== 'cramp').length < topUpTarget &&
      state.decks.action.length
    ) {
      fighter.hand.push(state.decks.action.shift());
    }
  }

  const monsterHand = [];
  for (let i = 0; i < cunning && state.decks.action.length; i += 1) {
    monsterHand.push(state.decks.action.shift());
  }

  // Boss cadence: after every 2 hero turns in co-op; every hero turn in 1v1 Hard Mode.
  const bossEvery = isBoss && fighters.length > 1 ? 2 : 1;

  state.clash = {
    roomKey: tile.key,
    heroPlayerId,
    fighters,
    fighterIndex: 0,
    turnOrderDir: 1,
    heroTurnsSinceBoss: 0,
    bossEvery,
    monsterId,
    monsterName,
    monsterHp,
    monsterMaxHp: monsterMaxHp ?? monsterHp,
    baseDmg,
    cunning,
    trait,
    traitId,
    lootText,
    monsterHand,
    isBoss,
    enraged: false,
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
    encoreUsedThisRound: false,
    negateNextMonsterHit: false,
    pendingKoboldSwings: 0,
    twinRank: null,
    note: isBoss
      ? 'Boss clash — Heroes next to the Boss Chamber may still pile in on the same pile!'
      : 'Monster leads — then play matching Suit or Rank (or Wild / Desperation).',
  };

  const fighterNames = fighters.map((id) => state.heroes[id].name).join(' & ');
  if (monsterHand.length) {
    const lead = monsterHand.shift();
    state.clash.monsterHand = monsterHand;
    applyLeadCard(state.clash, lead);
    appendLog(
      state,
      `Clash! ${fighterNames} vs ${monsterName} (${monsterHp} HP). ${monsterName} leads ${cardLabel(lead)}.`,
    );
  } else {
    appendLog(state, `Clash! ${fighterNames} vs ${monsterName} (${monsterHp} HP).`);
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
  const topUpTarget = RULES.combatHandTopUp || 5;
  while (
    hero.hand.filter((c) => c.type !== 'cramp').length < topUpTarget &&
    state.decks.action.length
  ) {
    hero.hand.push(state.decks.action.shift());
  }
  clash.fighters.push(heroPlayerId);
  // Rescale boss HP for extra hero joining mid-fight: +bossHpPerExtraHero max & current
  const extraHp = RULES.bossHpPerExtraHero || 4;
  clash.monsterMaxHp += extraHp;
  clash.monsterHp += extraHp;
  if (!clash.enraged) {
    clash.bossEvery = clash.fighters.length > 1 ? RULES.bossTurnsPerHeroTurns || 2 : 1;
  }
  appendLog(
    state,
    `${hero.name} piles into the Boss clash! (${clash.fighters.length} Heroes; Boss ${clash.monsterHp}/${clash.monsterMaxHp} HP).`,
  );
  maybeEnrageBoss(state);
}

function buildHeroPlayOptions(hero, clash, card, action = {}) {
  const opts = {};
  if (action.forceParry && hero.offhand?.id === 'G-17' && !hero.offhand.tapped) {
    opts.forceParry = true;
  }
  if (
    action.useBigSwing !== false &&
    hero.perk?.id === 'big-swing' &&
    !hero.perkUsedThisClash &&
    card?.suit === 'brawn' &&
    card.rank != null &&
    !isSpecial(card) &&
    !isWild(card)
  ) {
    const without = isLegalPlay(card, clash);
    const withSwing = isLegalPlay(card, clash, { bigSwing: true });
    const beforeKind = classifyPlay(card, clash);
    const afterKind = classifyPlay(card, clash, { bigSwing: true });
    const upgradesOutcome =
      (beforeKind === 'guard' && (afterKind === 'parry' || afterKind === 'clean')) ||
      (beforeKind === 'parry' && afterKind === 'clean');
    if (action.useBigSwing === true || action.usePerk === true || (!without && withSwing) || upgradesOutcome) {
      opts.bigSwing = true;
    }
  }
  if (
    action.useZap !== false &&
    hero.perk?.id === 'improvised-zap' &&
    !hero.perkUsedThisClash &&
    card?.suit === 'spark' &&
    !isSpecial(card) &&
    !isWild(card)
  ) {
    if (!isLegalPlay(card, clash)) {
      opts.defensiveSparkAsAny = true;
    }
  }
  return opts;
}

function advanceAfterHeroTurn(state, { skipped = false } = {}) {
  const clash = state.clash;
  if (!clash) return;
  clash.needsDraw = false;
  clash.twinRank = null;
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
  clash.encoreUsedThisRound = false;
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
  clash.needsDraw = !clash.heroDazed;
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
    appendLog(state, `${hero.name} uses Big Swing (+${hero.perk?.rankBonus || 2} Rank on Brawn)!`);
  }
  if (playOpts.defensiveSparkAsAny) {
    hero.perkUsedThisClash = true;
    appendLog(state, `${hero.name} uses Improvised Zap (Spark as any Suit @ Rank 2)!`);
  }
  if (playOpts.forceParry && hero.offhand) {
    hero.offhand.tapped = true;
    appendLog(state, `${hero.name} taps ${hero.offhand.name} — forced Parry!`);
  }

  const gritPierces = Boolean(hero.weapon?.gritIgnoresArmor && card.suit === 'grit');

  if (isSpecial(card)) {
    afterPlayUpdateActive(clash, card);
    if (card.kind === 'daze') {
      // G-21 Dramatic Greatsword: Daze deals +2 bonk
      const swordBonus = hero.weapon?.id === 'G-21' ? 2 : 0;
      const bonus = swordBonus + themeSparkBonus(state.themeId, card);
      if (bonus) {
        damageMonster(state, hero, bonus, card, { ignoreArmor: true });
        if (swordBonus) appendLog(state, `Dramatic Greatsword bonk +${swordBonus} on Daze!`);
      }
      if (clash.traitId === 'three-way-team') {
        clash.pendingKoboldSwings = 2;
        clash.monsterDazed = false;
        appendLog(
          state,
          `${hero.name} plays Daze! (${card.suit}) — but Three Kobolds get two free swings next turn instead of missing!`,
        );
      } else {
        clash.monsterDazed = true;
        appendLog(
          state,
          `${hero.name} plays Daze! (${card.suit}) — ${clash.monsterName} will miss next turn. ${hero.name} plays again!`,
        );
      }
      again = true;
    } else if (card.kind === 'bounce') {
      damageMonster(state, hero, 1 + themeSparkBonus(state.themeId, card), card, { ignoreArmor: gritPierces });
      // G-22 Fizz-Pop: Purple Bounce heals 2
      if (hero.weapon?.id === 'G-22' && card.suit === 'spark') {
        hero.hp = Math.min(hero.maxHp, hero.hp + 2);
        appendLog(state, `Fizz-Pop Spellblade — ${hero.name} heals 2 HP (${hero.hp}).`);
      }
      if (clash.isBoss && (clash.fighters?.length || 1) > 1) {
        clash.turnOrderDir = (clash.turnOrderDir || 1) * -1;
        appendLog(state, `Bounce Back! (${card.suit}) flips Boss table turn order (${clash.turnOrderDir > 0 ? 'clockwise' : 'counter-clockwise'}).`);
      }
      appendLog(state, `${hero.name} Bounce Back! (${card.suit}) — reflects 1 Dmg (${clash.monsterName} at ${clash.monsterHp} HP).`);
    } else if (card.kind === 'tuckered') {
      damageMonster(state, hero, 2 + themeSparkBonus(state.themeId, card), card, { direct: true, ignoreArmor: gritPierces });
      appendLog(state, `${hero.name} Tuckered Out! (${card.suit}) (+2) — ${clash.monsterName} takes 2 direct Dmg (${clash.monsterHp} HP).`);
      // G-24 Tick-Tock lantern
      if (hero.belt?.some((b) => (b.gearId || b.id) === 'G-24')) {
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
      damageMonster(state, hero, dmg, card, { ignoreArmor: gritPierces });
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
        damageMonster(state, hero, 1, card, { ignoreArmor: gritPierces });
        appendLog(state, `Barn-Door Tower Shield reflects 1 Dmg!`);
      }
      applyHeroStrikeTriggers(state, hero, card, kind);
    } else {
      let chip = 1 + themeSparkBonus(state.themeId, card);
      damageMonster(state, hero, chip, card, { ignoreArmor: gritPierces });
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
    if (clash.traitId === 'three-way-team') {
      clash.pendingKoboldSwings = 2;
      clash.monsterDazed = false;
      appendLog(state, `Boom-Hammer of Boops — Blue 4 triggers Daze, but Three Kobolds queue 2 free swings!`);
    } else {
      clash.monsterDazed = true;
      appendLog(state, `Boom-Hammer of Boops — Blue 4 auto-Daze!`);
    }
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

  // MON-02 Rattle Armor: ignore first 1 damage (unless Armor-pierced)
  if (
    clash.traitId === 'rattle-armor' &&
    !clash.ignoredFirstHit &&
    dmg > 0 &&
    !opts.ignoreArmor &&
    !opts.pierce
  ) {
    clash.ignoredFirstHit = true;
    dmg -= 1;
    appendLog(state, `Rattle Armor absorbs the first 1 damage!`);
  }

  clash.monsterHp = Math.max(0, clash.monsterHp - Math.max(0, dmg));
  maybeEnrageBoss(state);
}

function maybeEnrageBoss(state) {
  const clash = state.clash;
  if (
    clash?.isBoss &&
    !clash.enraged &&
    clash.monsterHp > 0 &&
    (clash.fighters?.length || 1) >= (RULES.bossEnrageHalfHpPartyMin ?? 3) &&
    clash.monsterHp <= Math.floor(clash.monsterMaxHp / 2)
  ) {
    clash.enraged = true;
    clash.bossEvery = 1;
    appendLog(
      state,
      `Boss Enraged! ${clash.monsterName} drops to ${clash.monsterHp}/${clash.monsterMaxHp} HP and now acts after every Hero turn!`,
    );
  }
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
        appendLog(state, `${clash.monsterName} plays Daze! (${card.suit}) — Three-Way Team queues two free swings (won't miss).`);
      } else {
        clash.heroDazed = true;
        appendLog(state, `${clash.monsterName} plays Daze! (${card.suit}) — ${hero.name} will miss next turn.`);
      }
    } else if (card.kind === 'bounce') {
      let dmg = 1 + themeSparkBonus(state.themeId, card);
      hurtHero(state, hero, dmg, card);
      appendLog(state, `${clash.monsterName} Bounce Back! (${card.suit})`);
    } else if (card.kind === 'tuckered') {
      addCramp(state, hero, 2);
      appendLog(state, `${clash.monsterName} Tuckered Out! (${card.suit}) — ${hero.name} gains 2 Cramp!`);
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
  if (rank != null && hero.armor && !hero.armor.tapped && hero.armor.ignoreRanks?.includes(rank)) {
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
  const baseId = card.id?.match(/^D-\d+/)?.[0] || card.id;

  // B-02 Theatrical Encore (rules_09: any Desperation, max once per round)
  if (clash.traitId === 'theatrical-encore') {
    const tierOk = !RULES.theatricalEncoreMessyOnly || card.tier === 'messy';
    const capOk = !RULES.theatricalEncoreMaxPerRound || !clash.encoreUsedThisRound;
    if (tierOk && capOk) {
      clash.encoreUsedThisRound = true;
      const healAmt = RULES.theatricalEncoreHeal || 1;
      clash.monsterHp = Math.min(clash.monsterMaxHp, clash.monsterHp + healAmt);
      appendLog(state, `Theatrical Encore — ${clash.monsterName} heals ${healAmt} HP (${clash.monsterHp}).`);
    }
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
      if (hero.hand.length) {
        const i = Math.floor(Math.random() * hero.hand.length);
        discardToAction(state, hero.hand.splice(i, 1)[0]);
      }
      addCramp(state, hero, 1);
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
        grantLootToHero(state, hero, item, clash.heroPlayerId);
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

  maybeEnrageBoss(state);
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

function trySecondWind(state, hero) {
  const charmIdx = (hero.belt || []).findIndex((b) => (b.gearId || b.id) === 'G-30');
  if (charmIdx >= 0 && !hero.secondWindUsed) {
    hero.belt.splice(charmIdx, 1);
    hero.secondWindUsed = true;
    hero.hp = 4;
    hero.downed = false;
    appendLog(
      state,
      `${hero.name} eats the Second Wind Snack Charm — bounces back to 4 HP and keeps their hand!`,
    );
    return true;
  }
  return false;
}

function knockDownHero(state, hero) {
  // G-30 Second Wind Snack Charm — once per floor, keep hand
  if (trySecondWind(state, hero)) return;

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
  const tile = state.map.tiles.find((t) => t.key === clash.roomKey);
  // Every fighter (not just whoever held the turn) stretches out Cramp! and untaps gear.
  for (const fid of new Set([clash.heroPlayerId, ...(clash.fighters || [])])) {
    const fighter = state.heroes[fid];
    if (!fighter) continue;
    fighter.hand = fighter.hand.filter((c) => !isCramp(c));
    if (fighter.offhand) fighter.offhand.tapped = false;
    if (fighter.armor) fighter.armor.tapped = false;
  }
  if (victory && tile) {
    tile.cleared = true;
    tile.lurkingMonster = null;
  } else if (!victory && tile && !clash.isBoss && clash.monsterHp > 0) {
    tile.lurkingMonster = {
      id: clash.monsterId,
      name: clash.monsterName,
      hp: clash.monsterHp,
      maxHp: clash.monsterMaxHp,
      cunning: clash.cunning,
      baseDmg: clash.baseDmg,
      trait: clash.trait,
      traitId: clash.traitId,
      loot: clash.lootText,
    };
    tile.cleared = false;
  }
  const bossWin = Boolean(wasBoss ?? clash.isBoss) && victory;
  state.clash = null;
  state.phase = 'exploring';
  if (bossWin) {
    unlockStairs(state, 'Floor Boss defeated — Shiny Basement Key found!');
  }
  if (!victory && allHeroesDowned(state)) {
    triggerDefeat(state);
    return;
  }
  state.explorationActionsLeft = 0;
  endHeroExplorationTurn(state);
}

function allHeroesDowned(state) {
  const heroes = Object.values(state.heroes || {});
  return heroes.length > 0 && heroes.every((h) => Boolean(h.downed));
}

function triggerDefeat(state, reason = 'All Heroes are DOWNED — party wipe!') {
  state.phase = 'defeat';
  state.clash = null;
  state.explorationActionsLeft = 0;
  state.pending = null;
  appendLog(state, reason);
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

  // rules_06: Narrative Time-Skip & Free Shrine Sweep when descending unlocked Stairs
  if (RULES.stairsGroupShrineSweep) {
    const shrineTile = state.map?.tiles?.find((t) => t.kind === 'shrine');
    const shrineRevealed = Boolean(shrineTile?.faceUp);
    for (const hero of Object.values(state.heroes)) {
      if (hero.downed) {
        hero.downed = false;
        if (shrineRevealed) {
          hero.hp = RULES.shrineReviveHp || 5;
          hero.hand = [];
          for (let i = 0; i < (RULES.shrineReviveCards || 4); i += 1) drawAction(state, hero);
          appendLog(
            state,
            `Group Descent Shrine Sweep: ${hero.name} is carried to the Sanctuary Shrine (${hero.hp} HP + ${RULES.shrineReviveCards || 4} cards)!`,
          );
        } else {
          hero.hp = 1;
          appendLog(state, `Group Descent: ${hero.name} is carried to the stairs and wakes groggily at 1 HP.`);
        }
      }
      if (shrineRevealed && !hero.shrineUsedThisFloor) {
        const shrineHeal = RULES.shrineRestHeal || 3;
        hero.shrineUsedThisFloor = true;
        hero.hp = Math.min(hero.maxHp, hero.hp + shrineHeal);
        appendLog(
          state,
          `Group Descent Shrine Sweep: ${hero.name} claims their free +${shrineHeal} HP Sanctuary Rest (${hero.hp} HP).`,
        );
      }
    }
  }

  const clearHeal = RULES.floorClearHeal || 3;
  for (const hero of Object.values(state.heroes)) {
    if (hero.downed) continue;
    hero.hp = Math.min(hero.maxHp, hero.hp + clearHeal);
    hero.hand = hero.hand.filter((c) => !isCramp(c));
  }
  appendLog(state, reason);
  appendLog(state, `Floor ${state.floorNumber || 1} complete! Heroes heal +${clearHeal} HP (checkpoint).`);
}

function endHeroExplorationTurn(state) {
  if (!state.turnOrder.length) return;
  if (state.pending) return;
  if (allHeroesDowned(state)) {
    triggerDefeat(state);
    return;
  }
  const n = state.turnOrder.length;
  for (let step = 1; step <= n; step += 1) {
    const idx = (state.activeHeroIndex + step) % n;
    const nextId = state.turnOrder[idx];
    if (!state.heroes[nextId]?.downed) {
      state.activeHeroIndex = idx;
      state.explorationActionsLeft = 2;
      const p = state.players.find((x) => x.id === nextId);
      appendLog(state, `${p?.name || 'Hero'}'s turn — 2 Exploration Actions.`);
      return;
    }
  }
  triggerDefeat(state);
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

function grantLootToHero(state, hero, loot, heroPlayerId = null) {
  const gearId = loot.gearId || String(loot.id || '').split('-')[0];
  const item = gearRuntimeFromId(gearId);
  item.name = item.name || loot.name;
  const slot = item.slot || loot.slot;
  if (slot === 'weapon') hero.weapon = item;
  else if (slot === 'offhand') hero.offhand = item;
  else if (slot === 'armor') hero.armor = item;
  else if (slot === 'belt') {
    hero.belt = hero.belt || [];
    if (hero.belt.length < 2) {
      hero.belt.push(item);
    } else {
      const pid =
        heroPlayerId ||
        Object.keys(state.heroes || {}).find((k) => state.heroes[k] === hero) ||
        state.turnOrder?.[state.activeHeroIndex];
      state.pending = {
        kind: 'belt-overflow',
        heroPlayerId: pid,
        newItem: item,
        options: [...hero.belt, item],
      };
      appendLog(state, `${hero.name}'s belt is full (2/2) — choose 1 item to discard.`);
    }
  }
}

function beginEventPrompt(state, heroPlayerId, tile) {
  const event = state.decks.events?.length
    ? state.decks.events.shift()
    : {
        id: 'E-00',
        title: 'Mysterious Draft',
        prompt: 'A drafty room — pick a response.',
        choices: ['A) Shrug and move on.', 'B) Peek nervously.'],
      };
  state.pending = {
    kind: 'event',
    heroPlayerId,
    tileKey: tile.key,
    event,
  };
  appendLog(state, `Event: ${event.title} — choose A or B.`);
}

function beginMerchantRoom(state, tile) {
  const card = state.decks.merchants?.length ? state.decks.merchants.shift() : null;
  tile.cleared = true;
  if (card) {
    tile.merchant = { id: card.id, name: card.name, greeting: card.greeting, deals: card.deals };
    appendLog(state, `${card.name} sets up shop here!`);
  } else {
    appendLog(state, 'Merchant Cart room — no merchants left in deck.');
  }
  if (state.storyStack?.length) {
    const entry = state.storyStack.shift();
    const id = typeof entry === 'string' ? entry : entry.id;
    const story = STORIES.find((s) => s.id === id);
    if (story) {
      tile.story = { ...story, part1Outcome: typeof entry === 'object' ? entry.outcome : 'helped' };
      appendLog(state, `Story Callback: ${story.name}!`);
    }
  } else if (state.decks.stories?.length) {
    tile.story = state.decks.stories.shift();
    appendLog(state, `Story Encounter: ${tile.story.name}!`);
  }
}

function rollStuntCheck(state, hero, { suits = ['brawn'], target = 4, discardCardId = null, reroll = true, forcedRoll = null, forcedRoll2 = null } = {}) {
  let roll = Number.isInteger(forcedRoll) ? forcedRoll : 1 + Math.floor(Math.random() * 6);
  let autoPass = false;
  let bonus = 0;
  if (hero.offhand?.id === 'G-08' && !hero.stuntGearUsed?.scarf) {
    bonus += 1;
    hero.stuntGearUsed = { ...hero.stuntGearUsed, scarf: true };
    appendLog(state, `${hero.name} flutters the Checkered Picnic Scarf (+1 stunt).`);
  }
  if (hero.armor?.id === 'G-18' && suits.includes('zip')) {
    bonus += 1;
  }
  if (discardCardId) {
    const idx = (hero.hand || []).findIndex((c) => c.id === discardCardId);
    if (idx >= 0) {
      const discarded = hero.hand.splice(idx, 1)[0];
      if (isWild(discarded)) autoPass = true;
      else if (suits.includes(discarded.suit)) bonus += 2;
      discardToAction(state, discarded);
    }
  }
  let total = autoPass ? 99 : roll + bonus;
  let success = autoPass || total >= target;
  const suitLabel = suits.join('/');
  appendLog(
    state,
    autoPass
      ? `${hero.name} stunt (${suitLabel} ${target}+): Heroic Wild! automatic pass.`
      : `${hero.name} stunt (${suitLabel} ${target}+): rolled ${roll}${bonus ? `+${bonus}` : ''} = ${total} → ${success ? 'SUCCESS' : 'FAIL'}.`,
  );
  if (!success && hero.offhand?.id === 'G-11' && !hero.stuntGearUsed?.kaleidoscope && reroll) {
    hero.stuntGearUsed = { ...hero.stuntGearUsed, kaleidoscope: true };
    roll = Number.isInteger(forcedRoll2) ? forcedRoll2 : 1 + Math.floor(Math.random() * 6);
    total = roll + bonus;
    success = total >= target;
    appendLog(state, `Kaleidoscope reroll: ${roll}${bonus ? `+${bonus}` : ''} = ${total} → ${success ? 'SUCCESS' : 'FAIL'}.`);
  }
  return { success, total, roll };
}

function applyEventChoice(state, hero, event, choice, action = {}, heroPid = null) {
  const id = event.id;
  appendLog(state, `${hero.name} picks ${choice.toUpperCase()} on ${event.title}.`);
  const bootsIgnore = hero.armor?.id === 'G-18';
  const stuntOpts = {
    discardCardId: action.discardCardId || null,
    reroll: action.reroll !== false,
    forcedRoll: action.forcedRoll,
    forcedRoll2: action.forcedRoll2,
  };
  const applyBananaWipeout = () => {
    if (bootsIgnore) {
      appendLog(state, 'Bouncy Rubber Boots ignore 1 trap damage!');
      hero.hp = Math.max(0, hero.hp - 1);
    } else {
      hero.hp = Math.max(0, hero.hp - 2);
    }
    addCramp(state, hero, 1);
    drawTwist(state, 'Trap mishap');
  };
  const applyFloorboardSplat = () => {
    if (bootsIgnore) appendLog(state, 'Bouncy Rubber Boots ignore 1 trap damage!');
    else hero.hp = Math.max(0, hero.hp - 1);
    state.explorationActionsLeft = Math.max(0, state.explorationActionsLeft - 1);
    appendLog(state, 'Splat! Next move is sticky (lost 1 leftover action as proxy).');
    drawTwist(state, 'Trap mishap');
  };

  if (id === 'E-01') {
    if (choice === 'a') {
      const res = rollStuntCheck(state, hero, { ...stuntOpts, suits: ['zip'], target: 3 });
      if (res.success) drawAction(state, hero);
      else applyBananaWipeout();
    } else {
      applyBananaWipeout();
    }
  } else if (id === 'E-02') {
    if (choice === 'a') {
      const res = rollStuntCheck(state, hero, { ...stuntOpts, suits: ['grit'], target: 4 });
      if (!res.success) applyFloorboardSplat();
    } else {
      applyFloorboardSplat();
    }
  } else if (id === 'E-03') {
    if (choice === 'a') {
      hero.hp = Math.min(hero.maxHp, hero.hp + 2);
      drawAction(state, hero);
    } else {
      const res = rollStuntCheck(state, hero, { ...stuntOpts, suits: ['spark'], target: 3 });
      if (res.success) {
        const hidden = state.map.tiles.find((t) => !t.faceUp);
        if (hidden) appendLog(state, `Mirror peek: a face-down room is ${hidden.name} (${hidden.kind}).`);
      } else {
        drawTwist(state, 'Mirror smudge');
      }
    }
  } else if (id === 'E-04') {
    if (choice === 'a') {
      hero.hp = Math.min(hero.maxHp, hero.hp + 2);
    } else {
      const res = rollStuntCheck(state, hero, { ...stuntOpts, suits: ['spark'], target: 4 });
      if (res.success) {
        const beltIdx = (state.decks.loot || []).findIndex((c) => c.slot === 'belt');
        const item = beltIdx >= 0 ? state.decks.loot.splice(beltIdx, 1)[0] : gearRuntimeFromId('G-27');
        grantLootToHero(state, hero, item, heroPid);
        appendLog(state, `${hero.name} brews ${item.name}!`);
      } else {
        hero.hp = Math.max(0, hero.hp - 1);
        drawTwist(state, 'Soda mix mishap');
      }
    }
  } else if (id === 'E-05') {
    if (choice === 'a') {
      const res = rollStuntCheck(state, hero, { ...stuntOpts, suits: ['zip', 'brawn'], target: 4 });
      if (res.success) {
        const item = drawLoot(state, 1)[0];
        if (item) grantLootToHero(state, hero, item, heroPid);
      } else {
        drawTwist(state, 'Locked chest mishap');
      }
    } else {
      drawTwist(state, 'Awkward humming');
    }
  } else if (id === 'E-06') {
    if (choice === 'a') {
      const res = rollStuntCheck(state, hero, { ...stuntOpts, suits: ['zip'], target: 3 });
      if (res.success) drawAction(state, hero);
      else drawTwist(state, 'Gargoyle bell rings');
    } else {
      const res = rollStuntCheck(state, hero, { ...stuntOpts, suits: ['grit'], target: 4 });
      if (res.success) appendLog(state, `${hero.name} sneaks past the gargoyle quietly.`);
      else drawTwist(state, 'Gargoyle bell rings');
    }
  }
  if (hero.hp <= 0) {
    if (!trySecondWind(state, hero)) {
      hero.hp = 0;
      hero.downed = true;
      for (const c of hero.hand) discardToAction(state, c);
      hero.hand = [];
      appendLog(state, `${hero.name} collapses from the hazard!`);
      if (allHeroesDowned(state)) {
        triggerDefeat(state);
      }
    }
  }
}

function executeMerchantDeal(state, hero, playerName, tile, action, heroPid) {
  const deal = action.deal || 'trade-gear';
  if (deal === 'trade-gear') {
    let traded = null;
    const beltIdx = action.beltIndex !== undefined && action.beltIndex !== null ? Number(action.beltIndex) : -1;
    if (Number.isInteger(beltIdx) && beltIdx >= 0 && hero.belt?.[beltIdx]) {
      traded = hero.belt.splice(beltIdx, 1)[0];
    } else if (action.slot && ['weapon', 'offhand', 'armor'].includes(action.slot) && hero[action.slot]) {
      traded = hero[action.slot];
      hero[action.slot] = null;
    } else {
      return { ok: false, error: 'Pick a belt item or equipped gear to trade' };
    }
    const drawn = drawLoot(state, 2);
    if (!drawn.length) {
      if (action.slot) hero[action.slot] = traded;
      else hero.belt.push(traded);
      return { ok: false, error: 'Loot deck empty' };
    }
    state.explorationActionsLeft -= 1;
    state.pending = {
      kind: 'vault',
      heroPlayerId: heroPid,
      tileKey: tile.key,
      options: drawn,
      tradedName: traded.name,
    };
    appendLog(state, `${playerName} trades ${traded.name} with ${tile.merchant.name} — pick 1 loot.`);
    return { ok: true };
  }

  if (deal === 'bundle-deal') {
    if ((hero.belt?.length || 0) < 2) {
      return { ok: false, error: 'Need 2 Belt Consumables for Bundle Deal' };
    }
    const t1 = hero.belt.splice(0, 2);
    const tier1Idx = (state.decks.loot || []).findIndex((c) => c.slot !== 'belt');
    const item = tier1Idx >= 0 ? state.decks.loot.splice(tier1Idx, 1)[0] : drawLoot(state, 1)[0];
    if (!item) {
      hero.belt.push(...t1);
      return { ok: false, error: 'Loot deck empty' };
    }
    state.explorationActionsLeft -= 1;
    grantLootToHero(state, hero, item, heroPid);
    appendLog(state, `${playerName} trades 2 Belt items for ${item.name} with ${tile.merchant.name}!`);
    return { ok: true };
  }

  if (deal === 'brew-swap') {
    let traded = null;
    const beltIdx = action.beltIndex !== undefined && action.beltIndex !== null ? Number(action.beltIndex) : -1;
    if (Number.isInteger(beltIdx) && beltIdx >= 0 && hero.belt?.[beltIdx]) {
      traded = hero.belt.splice(beltIdx, 1)[0];
    } else if (action.slot && ['weapon', 'offhand', 'armor'].includes(action.slot) && hero[action.slot]) {
      traded = hero[action.slot];
      hero[action.slot] = null;
    } else {
      return { ok: false, error: 'Pick a Gear or Belt item for Brew Swap' };
    }
    const rewardId = action.rewardId === 'G-25' ? 'G-25' : 'G-27';
    const reward = gearRuntimeFromId(rewardId);
    state.explorationActionsLeft -= 1;
    grantLootToHero(state, hero, reward, heroPid);
    appendLog(state, `${playerName} swaps ${traded.name} for ${reward.name} with ${tile.merchant.name}!`);
    return { ok: true };
  }

  if (deal === 'card-trade') {
    const eligible = (hero.hand || []).filter((c) => !isCramp(c) && (c.suit === 'grit' || c.suit === 'spark'));
    if (eligible.length < 2) {
      return { ok: false, error: 'Need 2 Grit or Spark Action cards for Card Trade' };
    }
    const chosenIds = Array.isArray(action.cardIds) && action.cardIds.length >= 2
      ? action.cardIds.slice(0, 2)
      : eligible.slice(0, 2).map((c) => c.id);
    const idSet = new Set(chosenIds);
    const discarded = [];
    hero.hand = hero.hand.filter((c) => {
      if (idSet.has(c.id) && discarded.length < 2) {
        discarded.push(c);
        return false;
      }
      return true;
    });
    for (const c of discarded) discardToAction(state, c);
    state.explorationActionsLeft -= 1;
    hero.hp = Math.min(hero.maxHp, hero.hp + 3);
    appendLog(state, `${playerName} trades 2 Grit/Spark cards at ${tile.merchant.name} — heals +3 HP (${hero.hp}).`);
    return { ok: true };
  }

  return { ok: false, error: `Unknown merchant deal ${deal}` };
}

function applyStoryChoice(state, hero, story, choice, tileKey, action = {}, heroPid = null) {
  appendLog(state, `${hero.name} resolves ${story.name} (${choice.toUpperCase()}).`);
  const tile = state.map.tiles.find((t) => t.key === tileKey);
  if (tile) tile.storyResolved = true;
  state.storyStack = state.storyStack || [];

  if (story.id === 'S-01A') {
    if (choice === 'a') {
      if (hero.weapon) {
        appendLog(state, `${hero.name} gives ${hero.weapon.name} to Pip.`);
        hero.weapon = null;
        const starters = gearByTier(0).filter((g) => g.slot === 'weapon');
        if (starters.length) {
          const pick = starters[Math.floor(Math.random() * starters.length)];
          grantLootToHero(state, hero, { gearId: pick.id, name: pick.name, slot: pick.slot }, heroPid);
          appendLog(state, `Pip gifts a replacement starter: ${pick.name}.`);
        }
      } else if (hero.armor) {
        appendLog(state, `${hero.name} gives ${hero.armor.name} to Pip.`);
        hero.armor = null;
        const starters = gearByTier(0).filter((g) => g.slot === 'armor');
        if (starters.length) {
          const pick = starters[Math.floor(Math.random() * starters.length)];
          grantLootToHero(state, hero, { gearId: pick.id, name: pick.name, slot: pick.slot }, heroPid);
          appendLog(state, `Pip gifts a replacement starter: ${pick.name}.`);
        }
      }
      state.storyStack.push({ id: 'S-01B', outcome: 'helped' });
      appendLog(state, `Tucked S-01B onto the Next-Floor Story Stack (Helped).`);
    } else {
      const item = drawLoot(state, 1)[0];
      if (item) grantLootToHero(state, hero, item, heroPid);
      state.storyStack.push({ id: 'S-01B', outcome: 'grumpy' });
      appendLog(state, `Tucked S-01B onto the Next-Floor Story Stack (Grumpy!).`);
    }
  } else if (story.id === 'S-02A') {
    if (choice === 'a') {
      if (hero.belt?.length) {
        hero.belt.pop();
        state.storyStack.push({ id: 'S-02B', outcome: 'helped' });
        appendLog(state, `Tucked S-02B onto the Next-Floor Story Stack.`);
      } else {
        const res = rollStuntCheck(state, hero, { suits: ['grit', 'zip'], target: 4, forcedRoll: action.forcedRoll });
        if (res.success) {
          state.storyStack.push({ id: 'S-02B', outcome: 'helped' });
          appendLog(state, `Tucked S-02B onto the Next-Floor Story Stack.`);
        } else {
          drawTwist(state, 'Story stunt');
        }
      }
    } else {
      drawAction(state, hero);
    }
  } else if (story.id === 'S-03A') {
    if (choice === 'a') {
      if (hero.belt?.length) {
        hero.belt.pop();
      } else {
        let removed = 0;
        hero.hand = (hero.hand || []).filter((c) => {
          if (!isCramp(c) && removed < 2) {
            removed += 1;
            discardToAction(state, c);
            return false;
          }
          return true;
        });
      }
      state.storyStack.push({ id: 'S-03B', outcome: 'friend' });
      appendLog(state, `Tucked S-03B onto the Next-Floor Story Stack (Friend).`);
    } else {
      drawAction(state, hero);
      state.storyStack.push({ id: 'S-03B', outcome: 'snubbed' });
      appendLog(state, `Tucked S-03B onto the Next-Floor Story Stack (Snubbed).`);
    }
  } else if (story.id === 'S-01B') {
    if (story.part1Outcome === 'grumpy') {
      if (tile) {
        startClash(state, heroPid || state.turnOrder[state.activeHeroIndex], tile, {
          id: 'MON-BOT',
          name: 'Clanky Helper Bot',
          hp: 6,
          cunning: 3,
          baseDmg: 2,
          trait: 'Grumpy Forge Guard!',
          loot: 'Draw 1 Tier 1 Loot',
        });
      }
    } else if (hero.weapon) {
      hero.weapon.strike = (hero.weapon.strike || 1) + 1;
      appendLog(state, `Master Pip reforges ${hero.weapon.name} (+1 Strike Dmg permanently)!`);
    } else {
      const tier2 = gearByTier(2).filter((g) => g.slot === 'weapon');
      const pick = tier2[0];
      if (pick) grantLootToHero(state, hero, { gearId: pick.id, name: pick.name, slot: pick.slot }, heroPid);
    }
  } else if (story.id === 'S-02B') {
    const hidden = state.map.tiles.filter((t) => !t.faceUp).slice(0, 3);
    for (const h of hidden) appendLog(state, `Barnacle's map reveals: ${h.name} (${h.kind}).`);
    const beltPool = (state.decks.loot || []).filter((c) => c.slot === 'belt');
    const item = beltPool[0] || drawLoot(state, 1)[0];
    if (item) {
      state.decks.loot = (state.decks.loot || []).filter((c) => c.id !== item.id);
      grantLootToHero(state, hero, item, heroPid);
    }
  } else if (story.id === 'S-03B') {
    if (story.part1Outcome === 'snubbed') {
      if (hero.belt?.length) {
        const lost = hero.belt.pop();
        appendLog(state, `Sir Reginald confiscates ${lost.name}!`);
      } else {
        hero.hp = Math.max(0, hero.hp - 2);
        appendLog(state, `Sir Reginald tuts sternly — ${hero.name} takes 2 Dmg.`);
      }
    } else {
      const loot = drawLoot(state, 2);
      for (const item of loot) grantLootToHero(state, hero, item, heroPid);
    }
  }
}

function relocateHeroAfterFlee(state, hero, fromKey) {
  if (!hero || !fromKey) return;
  const fromTile = state.map.tiles.find((t) => t.key === fromKey);
  if (!fromTile) return;
  const candidates = state.map.tiles.filter(
    (t) =>
      t.key !== fromTile.key &&
      t.faceUp &&
      adjacentOrthogonal(fromTile, t) &&
      tilesConnect(fromTile, t) &&
      !barrierBlocks(state, fromTile, t) &&
      !t.lurkingMonster &&
      (t.cleared || !['monster', 'boss'].includes(t.kind)),
  );
  if (candidates.length) {
    const dest = candidates[0];
    hero.roomKey = dest.key;
    appendLog(state, `${hero.name} retreats to ${dest.name}.`);
  }
}

function drawTwist(state, reason) {
  state.decks.twistHand = state.decks.twistHand || [];
  const cleanReason =
    reason && !/^dealer draws (?:a )?twist$/i.test(String(reason).trim()) ? reason : '';
  if (state.decks.twistHand.length >= 3) {
    appendLog(state, `${cleanReason ? `${cleanReason} — ` : ''}Twist hand already at max (3).`);
    return;
  }
  if (!state.decks.twists?.length) {
    appendLog(state, `${cleanReason ? `${cleanReason} — ` : ''}Twist deck empty.`);
    return;
  }
  const t = state.decks.twists.shift();
  state.decks.twistHand.push(t);
  appendLog(state, `${cleanReason ? `${cleanReason}: ` : ''}Dealer draws Twist «${t.name}».`);
}

export function canPlayTwist(state, twist) {
  if (!twist) return { ok: false, reason: 'Missing Twist' };
  if (/Boss Espresso/i.test(twist.name)) {
    if (state.phase !== 'clash' || !state.clash) {
      return { ok: false, reason: 'Play during an active Clash' };
    }
  } else if (/Musical Rooms/i.test(twist.name)) {
    const hidden = (state.map?.tiles || []).filter((t) => !t.faceUp);
    if (hidden.length < 2) {
      return { ok: false, reason: 'Need at least 2 face-down rooms to swap' };
    }
  } else if (/Surprise Intern/i.test(twist.name)) {
    const candidates = (state.map?.tiles || []).filter(
      (t) => t.faceUp && t.cleared && t.kind !== 'entrance' && t.kind !== 'stairs' && !t.lurkingMonster,
    );
    if (!candidates.length) {
      return { ok: false, reason: 'No cleared empty room available' };
    }
  } else if (/Hall Monitor/i.test(twist.name)) {
    const lairs = (state.map?.tiles || []).filter(
      (t) => t.faceUp && !t.cleared && (t.kind === 'monster' || t.lurkingMonster),
    );
    if (!lairs.length) {
      return { ok: false, reason: 'No unengaged revealed monster to slide' };
    }
  }
  return { ok: true };
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
        const fleeFrom = state.clash.roomKey;
        cleanupClash(state, { victory: false });
        relocateHeroAfterFlee(state, hero, fleeFrom);
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
    appendLog(state, `${hero.name} pulls off the stunt and draws 1 Action card.`);
    drawAction(state, hero);
  }
}

export function viewForPlayer(state, playerId) {
  return publicStateFor(state, playerId);
}

export function gearLabel(id) {
  return getGear(id)?.name || id;
}
