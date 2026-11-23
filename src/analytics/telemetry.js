import { isCramp, isSpecial, isWild, classifyPlay } from '../game/clash.js';
import { getGear } from '../data/index.js';

function emptyPlayCounts() {
  return {
    clean: 0,
    parry: 0,
    guard: 0,
    wild: 0,
    daze: 0,
    bounce: 0,
    tuckered: 0,
    crampClear: 0,
    desperation: 0,
  };
}

function emptySuitCounts() {
  return { brawn: 0, grit: 0, zip: 0, spark: 0, wild: 0 };
}

function emptyMonsterPlayCounts() {
  return { hit: 0, glancing: 0, parry: 0, fumble: 0, special: 0 };
}

function emptyRoomKindCounts() {
  return {
    monster: 0,
    boss: 0,
    vault: 0,
    trap: 0,
    merchant: 0,
    shrine: 0,
    hallway: 0,
    stairs: 0,
  };
}

export function createInitialGameRecord({
  gameId,
  roomCode,
  source = 'ui-playtest',
  batchId = null,
  testerLabel = null,
  now = Date.now(),
} = {}) {
  return {
    gameId: gameId || `${roomCode || 'GAME'}-${now}`,
    roomCode: roomCode || '—',
    source,
    batchId,
    testerLabel,
    startedAt: now,
    updatedAt: now,
    endedAt: null,
    durationSec: 0,
    status: 'lobby', // lobby | active | won | lost | abandoned
    phase: 'lobby',
    layoutMode: 'random',
    themeId: null,
    bossId: null,
    heroCount: 0,
    heroIds: [],
    playerNames: [],

    explorationTurns: 0,
    roomsTotal: 0,
    roomsRevealed: 0,
    roomsCleared: 0,
    roomsByKindRevealed: emptyRoomKindCounts(),
    bossFoundAtTurn: null,
    bossDefeated: false,
    stairsUnlocked: false,
    vaultsLooted: 0,
    shrinesUsed: 0,
    merchantsUsed: 0,
    hallwayStunts: 0,
    eventsResolved: 0,
    eventChoices: { a: 0, b: 0 },
    stuntsAttempted: 0,
    stuntsSucceeded: 0,
    stuntsFailed: 0,
    carriesPerformed: 0,
    barriersPried: 0,
    twistsDrawn: 0,
    twistsPlayed: 0,
    twistsPlayedById: {},

    clashesTotal: 0,
    clashesWon: 0,
    clashesFled: 0,
    clashesLost: 0,
    bossClashes: 0,
    bossMaxFightersJoined: 0,
    bossVictory: false,
    clashHistory: [],
    totalExchanges: 0,
    avgClashLength: 0,

    heroPlays: emptyPlayCounts(),
    heroPlaysBySuit: emptySuitCounts(),
    monsterPlays: emptyMonsterPlayCounts(),

    desperationFlips: 0,
    desperationByTier: { messy: 0, neutral: 0, miracle: 0 },
    desperationByCard: {},

    crampsAdded: 0,
    crampsCleared: 0,
    damageToMonsters: 0,
    damageToHeroes: 0,
    healingDone: 0,

    heroDownedCount: 0,
    secondWindTriggers: 0,
    revivesPerformed: 0,
    maxHandSizeObserved: 0,
    hoarded6Plus: false,

    gearAcquired: [],
    consumablesUsed: 0,
    perksTriggered: 0,
    heroesFinal: {},

    actionCount: 0,
    rejectedActionCount: 0,
    rejectedErrors: [],
    _activeClash: null,
  };
}

function countCramps(hand) {
  return (hand || []).filter((c) => isCramp(c)).length;
}

function sumHeroHp(state) {
  return Object.values(state?.heroes || {}).reduce((acc, h) => acc + (h.hp || 0), 0);
}

function updateHeroSnapshots(record, state) {
  const heroes = state?.heroes || {};
  const out = {};
  for (const [pid, h] of Object.entries(heroes)) {
    const prev = record.heroesFinal?.[pid];
    const handLen = (h.hand || []).length;
    if (handLen > record.maxHandSizeObserved) record.maxHandSizeObserved = handLen;
    if (handLen >= 6) record.hoarded6Plus = true;
    const prevDowned = prev?.downed || false;
    const timesDowned = (prev?.timesDowned || 0) + (!prevDowned && h.downed ? 1 : 0);
    out[pid] = {
      heroId: h.heroId,
      name: h.name,
      finalHp: h.hp,
      maxHp: h.maxHp,
      downed: Boolean(h.downed),
      weaponId: h.weapon?.id || null,
      offhandId: h.offhand?.id || null,
      armorId: h.armor?.id || null,
      beltIds: (h.belt || []).map((b) => b.id),
      finalHandSize: handLen,
      timesDowned,
    };
  }
  record.heroesFinal = out;
}

/**
 * Pure state-transition delta computation for observation-only telemetry.
 * Never mutates prevState or nextState.
 */
export function computeStateDelta(record, prevState, nextState, action = null, now = Date.now()) {
  if (!nextState) return record;
  const r = record;
  r.updatedAt = now;
  r.durationSec = Math.max(0, Math.round((now - r.startedAt) / 1000));
  r.phase = nextState.phase || r.phase;
  r.layoutMode = nextState.layoutMode || r.layoutMode;
  r.themeId = nextState.themeId || r.themeId;
  r.bossId = nextState.bossId || r.bossId;
  r.actionCount += 1;

  const heroPlayers = (nextState.players || []).filter((p) => p.role === 'hero');
  r.playerNames = heroPlayers.map((p) => p.name);
  const heroEntries = Object.values(nextState.heroes || {});
  if (heroEntries.length) {
    r.heroCount = heroEntries.length;
    r.heroIds = heroEntries.map((h) => h.heroId);
  } else {
    r.heroCount = heroPlayers.length;
    r.heroIds = heroPlayers.map((p) => p.heroId).filter(Boolean);
  }

  // Room stats
  const tiles = nextState.map?.tiles || [];
  if (tiles.length) {
    r.roomsTotal = tiles.length;
    r.roomsRevealed = tiles.filter((t) => t.faceUp).length;
    r.roomsCleared = tiles.filter((t) => t.cleared).length;
    const byKind = emptyRoomKindCounts();
    for (const t of tiles) {
      if (t.faceUp && byKind[t.kind] != null) byKind[t.kind] += 1;
    }
    r.roomsByKindRevealed = byKind;
  }

  r.bossDefeated = Boolean(nextState.floor?.bossDefeated);
  r.stairsUnlocked = Boolean(nextState.floor?.stairsUnlocked);

  if (prevState) {
    // Exploration turn counter (works for both 1P and multi-hero)
    if (prevState.phase === 'lobby' && nextState.phase === 'exploring') {
      r.explorationTurns = Math.max(1, r.explorationTurns);
    } else if (
      prevState.phase === 'exploring' &&
      nextState.phase === 'exploring' &&
      (prevState.activeHeroIndex !== nextState.activeHeroIndex ||
        (nextState.explorationActionsLeft ?? 0) > (prevState.explorationActionsLeft ?? 0) ||
        action?.type === 'end-turn')
    ) {
      r.explorationTurns += 1;
    } else if (prevState.phase === 'clash' && nextState.phase === 'exploring') {
      r.explorationTurns += 1;
    }

    // Boss discovery turn
    if (r.bossFoundAtTurn == null) {
      const bossTile = tiles.find((t) => t.kind === 'boss' && t.faceUp);
      if (bossTile) r.bossFoundAtTurn = Math.max(1, r.explorationTurns);
    }

    // Hero downed / second wind / cramps deltas
    for (const [pid, nextHero] of Object.entries(nextState.heroes || {})) {
      const prevHero = prevState.heroes?.[pid];
      if (!prevHero) continue;
      if (!prevHero.downed && nextHero.downed) r.heroDownedCount += 1;
      if (prevHero.downed && !nextHero.downed) r.revivesPerformed += 1;
      if (!prevHero.secondWindUsed && nextHero.secondWindUsed) r.secondWindTriggers += 1;
      if (!prevHero.perkUsedThisClash && nextHero.perkUsedThisClash) r.perksTriggered += 1;

      const prevCramps = countCramps(prevHero.hand);
      const nextCramps = countCramps(nextHero.hand);
      if (nextCramps > prevCramps) r.crampsAdded += nextCramps - prevCramps;
      else if (nextCramps < prevCramps) r.crampsCleared += prevCramps - nextCramps;

      // Track newly acquired gear
      const prevIds = new Set(
        [prevHero.weapon?.id, prevHero.offhand?.id, prevHero.armor?.id, ...(prevHero.belt || []).map((b) => b.id)].filter(Boolean),
      );
      const nextGearIds = [
        nextHero.weapon?.id,
        nextHero.offhand?.id,
        nextHero.armor?.id,
        ...(nextHero.belt || []).map((b) => b.id),
      ].filter(Boolean);
      for (const gid of nextGearIds) {
        if (!prevIds.has(gid) && !r.gearAcquired.includes(gid)) {
          r.gearAcquired.push(gid);
        }
      }
    }

    // Hero HP healing / damage deltas (outside or inside clash)
    const prevHpSum = sumHeroHp(prevState);
    const nextHpSum = sumHeroHp(nextState);
    if (nextHpSum < prevHpSum) r.damageToHeroes += prevHpSum - nextHpSum;
    else if (nextHpSum > prevHpSum && nextState.phase !== 'victory') {
      r.healingDone += nextHpSum - prevHpSum;
    }

    // Twists
    const prevTwists = prevState.decks?.twistHand?.length || 0;
    const nextTwists = nextState.decks?.twistHand?.length || 0;
    if (action?.type === 'play-twist') {
      r.twistsPlayed += 1;
      const tid = action.twistId || 'unknown';
      r.twistsPlayedById[tid] = (r.twistsPlayedById[tid] || 0) + 1;
    } else if (nextTwists > prevTwists) {
      r.twistsDrawn += nextTwists - prevTwists;
    }

    // Action-specific tracking
    if (action) {
      if (action.type === 'interact') {
        if (action.subtype === 'vault') r.vaultsLooted += 1;
        else if (action.subtype === 'shrine') r.shrinesUsed += 1;
        else if (action.subtype === 'merchant') r.merchantsUsed += 1;
        else if (action.subtype === 'hallway') r.hallwayStunts += 1;
        else if (action.subtype === 'use-consumable') r.consumablesUsed += 1;
      } else if (action.type === 'resolve-pending' && prevState.pending?.kind === 'event') {
        r.eventsResolved += 1;
        if (action.choice === 'a') r.eventChoices.a += 1;
        else if (action.choice === 'b') r.eventChoices.b += 1;
      } else if (action.type === 'stunt') {
        r.stuntsAttempted += 1;
        const logTop = nextState.log?.[0] || '';
        if (/PASS|success|opened|pried|peeks|bonus/i.test(logTop)) r.stuntsSucceeded += 1;
        else if (/FAIL/i.test(logTop)) r.stuntsFailed += 1;
        if (action.purpose === 'pry') r.barriersPried += 1;
      } else if (action.type === 'carry') {
        r.carriesPerformed += 1;
      } else if (action.type === 'clash-use-belt') {
        r.consumablesUsed += 1;
      }
    }

    // Clash start
    if (!prevState.clash && nextState.clash) {
      const c = nextState.clash;
      r.clashesTotal += 1;
      if (c.isBoss) r.bossClashes += 1;
      const fCount = c.fighters?.length || 1;
      if (c.isBoss && fCount > r.bossMaxFightersJoined) {
        r.bossMaxFightersJoined = fCount;
      }
      r._activeClash = {
        monsterId: c.monsterId,
        monsterName: c.monsterName,
        isBoss: Boolean(c.isBoss),
        startHp: c.monsterMaxHp,
        exchanges: 0,
        heroTurns: 0,
        monsterTurns: 0,
        desperationFlips: 0,
        outcome: 'ongoing',
        fightersCount: fCount,
      };
    }

    // Mid-clash tracking
    if (prevState.clash && nextState.clash) {
      const pc = prevState.clash;
      const nc = nextState.clash;
      const ac = r._activeClash;
      if (ac) {
        const fCount = nc.fighters?.length || 1;
        if (nc.isBoss && fCount > r.bossMaxFightersJoined) r.bossMaxFightersJoined = fCount;
        if (fCount > ac.fightersCount) ac.fightersCount = fCount;
      }
      if (nc.monsterHp < pc.monsterHp) {
        r.damageToMonsters += pc.monsterHp - nc.monsterHp;
      }

      if (action?.type === 'clash-play') {
        const hero = prevState.heroes?.[pc.heroPlayerId];
        const card = hero?.hand?.find((c) => c.id === action.cardId);
        if (ac) {
          ac.heroTurns += 1;
          ac.exchanges += 1;
        }
        r.totalExchanges += 1;
        if (card) {
          if (isWild(card)) {
            r.heroPlays.wild += 1;
            r.heroPlaysBySuit.wild += 1;
          } else if (isSpecial(card)) {
            if (card.kind === 'daze') r.heroPlays.daze += 1;
            else if (card.kind === 'bounce') r.heroPlays.bounce += 1;
            else if (card.kind === 'tuckered') r.heroPlays.tuckered += 1;
            if (r.heroPlaysBySuit[card.suit] != null) r.heroPlaysBySuit[card.suit] += 1;
          } else {
            const kind = classifyPlay(card, pc);
            if (r.heroPlays[kind] != null) r.heroPlays[kind] += 1;
            if (r.heroPlaysBySuit[card.suit] != null) r.heroPlaysBySuit[card.suit] += 1;
          }
        }
      } else if (action?.type === 'clash-clear-cramp') {
        r.heroPlays.crampClear += 1;
        if (ac) {
          ac.heroTurns += 1;
          ac.exchanges += 1;
        }
        r.totalExchanges += 1;
      } else if (action?.type === 'clash-desperation') {
        r.heroPlays.desperation += 1;
        r.desperationFlips += 1;
        if (ac) {
          ac.heroTurns += 1;
          ac.exchanges += 1;
          ac.desperationFlips += 1;
        }
        r.totalExchanges += 1;
        const dCard = nc.lastDesperation;
        if (dCard) {
          if (r.desperationByTier[dCard.tier] != null) r.desperationByTier[dCard.tier] += 1;
          r.desperationByCard[dCard.title] = (r.desperationByCard[dCard.title] || 0) + 1;
        }
      } else if (action?.type === 'clash-monster-turn') {
        if (ac) ac.monsterTurns += 1;
        const logTop = nextState.log?.[0] || '';
        if (/Fumbles/i.test(logTop)) r.monsterPlays.fumble += 1;
        else if (/Parries/i.test(logTop)) r.monsterPlays.parry += 1;
        else if (/glancing/i.test(logTop)) r.monsterPlays.glancing += 1;
        else if (/Daze|Bounce Back|Tuckered Out/i.test(logTop)) r.monsterPlays.special += 1;
        else if (/hits with/i.test(logTop)) r.monsterPlays.hit += 1;
      }
    }

    // Clash end
    if (prevState.clash && !nextState.clash) {
      const pc = prevState.clash;
      // Check if last action killed monster or downed hero
      if (action?.type === 'clash-play' || action?.type === 'clash-desperation') {
        r.totalExchanges += 1;
        if (r._activeClash) {
          r._activeClash.heroTurns += 1;
          r._activeClash.exchanges += 1;
        }
        if (action.type === 'clash-desperation') {
          r.heroPlays.desperation += 1;
          r.desperationFlips += 1;
          if (r._activeClash) r._activeClash.desperationFlips += 1;
        } else {
          const hero = prevState.heroes?.[pc.heroPlayerId];
          const card = hero?.hand?.find((c) => c.id === action.cardId);
          if (card) {
            if (isWild(card)) {
              r.heroPlays.wild += 1;
              r.heroPlaysBySuit.wild += 1;
            } else if (isSpecial(card)) {
              if (card.kind === 'daze') r.heroPlays.daze += 1;
              else if (card.kind === 'bounce') r.heroPlays.bounce += 1;
              else if (card.kind === 'tuckered') r.heroPlays.tuckered += 1;
              if (r.heroPlaysBySuit[card.suit] != null) r.heroPlaysBySuit[card.suit] += 1;
            } else {
              const kind = classifyPlay(card, pc);
              if (r.heroPlays[kind] != null) r.heroPlays[kind] += 1;
              if (r.heroPlaysBySuit[card.suit] != null) r.heroPlaysBySuit[card.suit] += 1;
            }
          }
        }
      } else if (action?.type === 'clash-monster-turn') {
        if (r._activeClash) r._activeClash.monsterTurns += 1;
      }

      const tile = tiles.find((t) => t.key === pc.roomKey);
      const anyDowned = Object.values(nextState.heroes || {}).some(
        (h, i) => h.downed && !Object.values(prevState.heroes || {})[i]?.downed,
      );
      let outcome = 'fled';
      if (tile?.cleared) {
        outcome = 'won';
        r.clashesWon += 1;
        r.damageToMonsters += Math.max(0, pc.monsterHp || 0);
        if (pc.isBoss) r.bossVictory = true;
      } else if (anyDowned) {
        outcome = 'lost';
        r.clashesLost += 1;
      } else {
        outcome = 'fled';
        r.clashesFled += 1;
      }
      if (r._activeClash) {
        r._activeClash.outcome = outcome;
        r.clashHistory.push(r._activeClash);
        r._activeClash = null;
      }
      r.avgClashLength =
        r.clashHistory.length > 0
          ? Number(
              (
                r.clashHistory.reduce((s, c) => s + c.exchanges, 0) / r.clashHistory.length
              ).toFixed(2),
            )
          : 0;
    }
  }

  updateHeroSnapshots(r, nextState);

  // Lifecycle status (observation-only — never mutates nextState)
  const allDowned = heroEntries.length > 0 && heroEntries.every((h) => h.downed);
  if (nextState.phase === 'victory') {
    r.status = 'won';
    r.endedAt = r.endedAt || now;
  } else if (nextState.phase !== 'lobby' && allDowned) {
    r.status = 'lost';
    r.endedAt = r.endedAt || now;
  } else if (nextState.phase !== 'lobby') {
    r.status = 'active';
  } else {
    r.status = 'lobby';
  }

  return r;
}

export function serializeRecord(record) {
  const copy = { ...record };
  delete copy._activeClash;
  return copy;
}

export function createTelemetryTracker({
  roomCode,
  source = 'ui-playtest',
  batchId = null,
  testerLabel = null,
  endpoint = '/api/telemetry/game',
  sendFn = null,
} = {}) {
  const record = createInitialGameRecord({ roomCode, source, batchId, testerLabel });
  const dispatchSend =
    sendFn ||
    ((payload) => {
      if (typeof fetch !== 'function') return;
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    });

  return {
    record,
    onState(prevState, nextState, action = null) {
      computeStateDelta(record, prevState, nextState, action);
      dispatchSend(serializeRecord(record));
    },
    onRejected(action, error) {
      record.rejectedActionCount += 1;
      record.updatedAt = Date.now();
      record.rejectedErrors = [
        ...record.rejectedErrors.slice(-9),
        `${action?.type || '?'}: ${error || 'rejected'}`,
      ];
      dispatchSend(serializeRecord(record));
    },
    flush() {
      dispatchSend(serializeRecord(record));
    },
    snapshot() {
      return serializeRecord(record);
    },
  };
}
