import fs from 'node:fs';
import path from 'node:path';
import { createEmptyState, adjacentOrthogonal, tilesConnect } from '../../src/game/state.js';
import { applyAction } from '../../src/game/authority.js';
import { isLegalPlay, isCramp, isSpecial, isWild, classifyPlay } from '../../src/game/clash.js';
import { bossGather, bossJoinCheck } from '../../src/game/boss.js';
import { HEROES, BOSSES, THEMES } from '../../src/data/index.js';
import { createTelemetryTracker } from '../../src/analytics/telemetry.js';

function parseArgs(argv) {
  const opts = { count: 100, telemetry: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--count' && argv[i + 1]) {
      opts.count = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--telemetry' && argv[i + 1]) {
      opts.telemetry = argv[i + 1];
      i += 1;
    }
  }
  return opts;
}

function barrierBetween(state, a, b) {
  return (state.map?.barriers || []).some(
    (bar) =>
      (bar.aKey === a.key && bar.bKey === b.key) ||
      (bar.aKey === b.key && bar.bKey === a.key),
  );
}

function bfsNextStep(state, fromKey, targetPredicate) {
  const byKey = new Map(state.map.tiles.map((t) => [t.key, t]));
  const start = byKey.get(fromKey);
  if (!start) return null;
  const queue = [{ tile: start, firstStep: null }];
  const visited = new Set([start.key]);
  while (queue.length) {
    const { tile, firstStep } = queue.shift();
    if (tile.key !== start.key && targetPredicate(tile)) {
      return firstStep || tile;
    }
    for (const cand of state.map.tiles) {
      if (visited.has(cand.key)) continue;
      if (!adjacentOrthogonal(tile, cand) || !tilesConnect(tile, cand)) continue;
      if (barrierBetween(state, tile, cand)) continue;
      visited.add(cand.key);
      queue.push({ tile: cand, firstStep: firstStep || cand });
    }
  }
  return null;
}

function pickBestCard(hero, clash) {
  const hand = hero.hand || [];
  const opts = {};
  if (hero.perk?.id === 'big-swing' && !hero.perkUsedThisClash) opts.bigSwing = true;
  if (hero.perk?.id === 'improvised-zap' && !hero.perkUsedThisClash) opts.defensiveSparkAsAny = true;

  if (clash.twinRank != null) {
    return hand.find((c) => !isCramp(c) && !isSpecial(c) && !isWild(c) && Number(c.rank) === clash.twinRank) || null;
  }

  const legal = hand.filter(
    (c) =>
      isLegalPlay(c, clash) ||
      (opts.bigSwing && c.suit === 'brawn' && isLegalPlay(c, clash, { bigSwing: true })) ||
      (opts.defensiveSparkAsAny && c.suit === 'spark' && isLegalPlay(c, clash, { defensiveSparkAsAny: true })),
  );
  if (!legal.length) return null;

  const scored = legal.map((c) => {
    let score = 0;
    if (isSpecial(c)) score = 6;
    else if (isWild(c)) score = 3;
    else {
      const k = classifyPlay(c, clash);
      score = k === 'clean' ? 5 : k === 'parry' ? 4 : 2;
    }
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].c;
}

function runSingleSim(index, partySize) {
  const roomCode = `SIM${String(index + 1).padStart(3, '0')}`;
  const dealerId = 'dealer-sim';
  const theme = THEMES[index % THEMES.length];
  const boss = BOSSES[index % BOSSES.length];

  const tracker = createTelemetryTracker({
    roomCode,
    source: 'headless-sim',
    batchId: 'headless-100',
    testerLabel: `sim-${partySize}p`,
    sendFn: () => {},
  });

  let state = createEmptyState(roomCode, dealerId, 'SimDealer');
  const dispatch = (action, actorId = dealerId) => {
    const prev = state;
    const res = applyAction(state, action, actorId);
    if (res.ok) {
      state = res.state;
      tracker.onState(prev, state, action);
    } else {
      tracker.onRejected(action, res.error);
    }
    return res;
  };

  for (let p = 0; p < partySize; p += 1) {
    const pid = `hero-${p + 1}`;
    const heroDef = HEROES[(index + p) % HEROES.length];
    state.players.push({
      id: pid,
      name: `SimHero${p + 1}`,
      role: 'hero',
      heroId: null,
      connected: true,
      isLocalStub: true,
    });
    dispatch({ type: 'pick-hero', playerId: pid, heroId: heroDef.id }, dealerId);
  }

  dispatch({ type: 'set-theme', themeId: theme.id }, dealerId);
  dispatch({ type: 'set-boss', bossId: boss.id }, dealerId);
  dispatch({ type: 'start-floor', layoutMode: 'random' }, dealerId);

  let steps = 0;
  let anomaly = null;

  while (steps < 450) {
    steps += 1;
    if (state.phase === 'victory') break;
    const heroesList = Object.values(state.heroes);
    if (heroesList.length && heroesList.every((h) => h.downed)) break;

    if (state.pending) {
      const r = dispatch(
        state.pending.kind === 'vault'
          ? { type: 'resolve-pending', keepIndex: 0 }
          : { type: 'resolve-pending', choice: index % 2 === 0 ? 'a' : 'b' },
        dealerId,
      );
      if (!r.ok) {
        anomaly = `pending-fail: ${r.error}`;
        break;
      }
      continue;
    }

    if (state.phase === 'clash' && state.clash) {
      const clash = state.clash;
      if (clash.whoseTurn === 'monster') {
        const r = dispatch({ type: 'clash-monster-turn' }, dealerId);
        if (!r.ok) {
          anomaly = `monster-turn-fail: ${r.error}`;
          break;
        }
        continue;
      }

      // Check if an adjacent ally can pile into Boss clash
      if (clash.isBoss) {
        const joiner = state.turnOrder.find((pid) => bossJoinCheck(state, pid).ok);
        if (joiner) {
          dispatch({ type: 'join-boss-clash', playerId: joiner }, joiner);
          continue;
        }
      }

      const pid = clash.heroPlayerId;
      const hero = state.heroes[pid];

      // Drink heal potion if low HP
      const healIdx = (hero.belt || []).findIndex((b) => b.type === 'heal' || b.id === 'G-27' || b.id === 'G-28');
      if (healIdx >= 0 && hero.hp <= 5) {
        dispatch({ type: 'clash-use-belt', beltIndex: healIdx }, pid);
        continue;
      }

      const card = pickBestCard(hero, clash);
      if (card) {
        const act = { type: 'clash-play', cardId: card.id };
        if (isWild(card)) act.wildSuit = hero.preferredSuit || 'brawn';
        const r = dispatch(act, pid);
        if (!r.ok) {
          anomaly = `clash-play-fail: ${r.error}`;
          break;
        }
        continue;
      }

      if (clash.twinRank != null) {
        dispatch({ type: 'clash-end-twin' }, pid);
        continue;
      }

      if (hero.hand.some((c) => isCramp(c))) {
        dispatch({ type: 'clash-clear-cramp' }, pid);
        continue;
      }

      const r = dispatch({ type: 'clash-desperation' }, pid);
      if (!r.ok) {
        anomaly = `desperation-fail: ${r.error}`;
        break;
      }
      continue;
    }

    if (state.phase === 'exploring') {
      const activeId = state.turnOrder[state.activeHeroIndex];
      const hero = state.heroes[activeId];
      const tile = state.map.tiles.find((t) => t.key === hero.roomKey);

      if (hero.downed) {
        dispatch({ type: 'end-turn', playerId: activeId }, activeId);
        continue;
      }

      // Check revive in same room
      const downedMate = state.turnOrder.find(
        (pid) => pid !== activeId && state.heroes[pid]?.downed && state.heroes[pid].roomKey === hero.roomKey,
      );
      if (downedMate && hero.belt?.some((b) => b.type === 'revive' || b.id === 'G-25' || b.id === 'G-26')) {
        dispatch({ type: 'interact', subtype: 'revive', targetPlayerId: downedMate }, activeId);
        continue;
      }
      if (downedMate && tile?.kind === 'shrine') {
        dispatch({ type: 'interact', subtype: 'shrine' }, activeId);
        continue;
      }

      // Room interactions
      if (tile?.kind === 'vault' && !tile.looted) {
        dispatch({ type: 'interact', subtype: 'vault' }, activeId);
        continue;
      }
      if (tile?.kind === 'shrine' && !hero.shrineUsedThisFloor && hero.hp <= 7) {
        dispatch({ type: 'interact', subtype: 'shrine' }, activeId);
        continue;
      }

      // Boss gather: if boss tile is waiting and this hero is inside, wait for allies or start
      const gather = bossGather(state);
      if (gather.waiting && gather.heroIds.includes(activeId)) {
        const consciousCount = Object.values(state.heroes).filter((h) => !h.downed).length;
        if (gather.heroIds.length >= consciousCount || steps > 180) {
          dispatch({ type: 'start-boss-clash' }, dealerId);
          continue;
        }
        // Stay inside Boss Chamber while waiting for allies
        dispatch({ type: 'end-turn', playerId: activeId }, activeId);
        continue;
      }

      // Occasional Dealer Twist
      if (state.decks.twistHand.length > 0 && steps % 17 === 0) {
        dispatch({ type: 'play-twist', twistId: state.decks.twistHand[0].id }, dealerId);
        continue;
      }

      // Choose navigation target
      let nextTile = null;
      if (state.floor?.stairsUnlocked) {
        nextTile = bfsNextStep(state, hero.roomKey, (t) => t.kind === 'stairs');
      } else if (gather.waiting && !gather.heroIds.includes(activeId)) {
        nextTile = bfsNextStep(state, hero.roomKey, (t) => t.kind === 'boss');
        if (!nextTile && gather.heroIds.length > 0 && steps > 180) {
          dispatch({ type: 'start-boss-clash' }, dealerId);
          continue;
        }
      } else {
        nextTile = bfsNextStep(state, hero.roomKey, (t) => !t.faceUp);
        if (!nextTile) {
          nextTile = bfsNextStep(state, hero.roomKey, (t) => t.kind === 'vault' && !t.looted);
        }
      }

      if (nextTile) {
        const r = dispatch({ type: 'move', x: nextTile.x, y: nextTile.y }, activeId);
        if (!r.ok) {
          dispatch({ type: 'end-turn', playerId: activeId }, activeId);
        }
        continue;
      }

      // If blocked by barrier, try pry
      const adjBarrier = state.map.tiles.find(
        (t) => adjacentOrthogonal(tile, t) && tilesConnect(tile, t) && barrierBetween(state, tile, t),
      );
      if (adjBarrier) {
        dispatch({ type: 'stunt', suit: 'brawn', target: 3, purpose: 'pry', reroll: true }, activeId);
        continue;
      }

      dispatch({ type: 'end-turn', playerId: activeId }, activeId);
    }
  }

  const snap = tracker.snapshot();
  if (steps >= 450 && snap.status === 'active') {
    snap.status = 'abandoned';
    anomaly = anomaly || 'max-steps-450-reached';
  }
  return { record: snap, anomaly };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const count = opts.count || 100;
  const partyCycle = [1, 2, 3, 4];
  const records = [];
  const anomalies = [];

  for (let i = 0; i < count; i += 1) {
    const partySize = partyCycle[i % partyCycle.length];
    const { record, anomaly } = runSingleSim(i, partySize);
    records.push(record);
    if (anomaly) anomalies.push({ gameId: record.gameId, partySize, anomaly });

    if (opts.telemetry) {
      await fetch(opts.telemetry, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      }).catch(() => {});
    }
  }

  const summary = {
    count: records.length,
    won: records.filter((r) => r.status === 'won').length,
    lost: records.filter((r) => r.status === 'lost').length,
    abandoned: records.filter((r) => r.status === 'abandoned').length,
    byPartySize: {},
    anomalies,
  };
  for (const p of partyCycle) {
    const sub = records.filter((r) => r.heroCount === p);
    const w = sub.filter((r) => r.status === 'won').length;
    const l = sub.filter((r) => r.status === 'lost').length;
    summary.byPartySize[`${p}P`] = {
      played: sub.length,
      won: w,
      lost: l,
      winRatePct: sub.length ? Number(((w / sub.length) * 100).toFixed(1)) : 0,
      avgTurns: Number((sub.reduce((s, r) => s + r.explorationTurns, 0) / (sub.length || 1)).toFixed(2)),
      avgClashLength: Number((sub.reduce((s, r) => s + r.avgClashLength, 0) / (sub.length || 1)).toFixed(2)),
      avgDesperation: Number((sub.reduce((s, r) => s + r.desperationFlips, 0) / (sub.length || 1)).toFixed(2)),
      avgDowned: Number((sub.reduce((s, r) => s + r.heroDownedCount, 0) / (sub.length || 1)).toFixed(2)),
    };
  }

  const outDir = path.resolve(process.cwd(), '.playtest-data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'headless-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
