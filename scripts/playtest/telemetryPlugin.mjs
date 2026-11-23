import fs from 'node:fs';
import path from 'node:path';

const STALE_ACTIVE_MS = 10 * 60 * 1000;

function emptyStore() {
  return {
    games: {},
    batches: {},
    tickets: [],
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function effectiveStatus(game, now) {
  if (game.status === 'active' && now - (game.updatedAt || game.startedAt || 0) > STALE_ACTIVE_MS) {
    return 'abandoned';
  }
  return game.status || 'lobby';
}

function avg(arr) {
  if (!arr.length) return 0;
  return Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2));
}

function pct(num, den) {
  if (!den) return 0;
  return Number(((num / den) * 100).toFixed(1));
}

function aggregateBucket(gamesList, now) {
  let activeGames = 0;
  let lobbyGames = 0;
  let wins = 0;
  let losses = 0;
  let abandoned = 0;

  const completed = [];
  const byPartySize = {};
  const byHero = {};
  const byBoss = {};
  const byMonster = {};
  const byTheme = {};
  const heroPlays = {
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
  const heroPlaysBySuit = { brawn: 0, grit: 0, zip: 0, spark: 0, wild: 0 };
  const desperationByTier = { messy: 0, neutral: 0, miracle: 0 };

  for (const g of gamesList) {
    const st = effectiveStatus(g, now);
    if (st === 'active') activeGames += 1;
    else if (st === 'lobby') lobbyGames += 1;
    else if (st === 'won') {
      wins += 1;
      completed.push(g);
    } else if (st === 'lost') {
      losses += 1;
      completed.push(g);
    } else if (st === 'abandoned') {
      abandoned += 1;
    }

    if (st !== 'won' && st !== 'lost') continue;

    const pKey = `${g.heroCount || 0}P`;
    if (!byPartySize[pKey]) byPartySize[pKey] = { played: 0, won: 0, lost: 0, turns: [], desp: [], downed: [] };
    byPartySize[pKey].played += 1;
    if (st === 'won') byPartySize[pKey].won += 1;
    else byPartySize[pKey].lost += 1;
    byPartySize[pKey].turns.push(g.explorationTurns || 0);
    byPartySize[pKey].desp.push(g.desperationFlips || 0);
    byPartySize[pKey].downed.push(g.heroDownedCount || 0);

    if (g.bossId) {
      if (!byBoss[g.bossId]) byBoss[g.bossId] = { played: 0, won: 0, lost: 0, defeated: 0 };
      byBoss[g.bossId].played += 1;
      if (st === 'won') byBoss[g.bossId].won += 1;
      else byBoss[g.bossId].lost += 1;
      if (g.bossDefeated) byBoss[g.bossId].defeated += 1;
    }

    if (g.themeId) {
      if (!byTheme[g.themeId]) byTheme[g.themeId] = { played: 0, won: 0, lost: 0 };
      byTheme[g.themeId].played += 1;
      if (st === 'won') byTheme[g.themeId].won += 1;
      else byTheme[g.themeId].lost += 1;
    }

    for (const h of Object.values(g.heroesFinal || {})) {
      const hid = h.heroId;
      if (!hid) continue;
      if (!byHero[hid]) {
        byHero[hid] = { name: h.name, played: 0, won: 0, lost: 0, timesDowned: 0, totalFinalHp: 0 };
      }
      byHero[hid].played += 1;
      if (st === 'won') byHero[hid].won += 1;
      else byHero[hid].lost += 1;
      byHero[hid].timesDowned += h.timesDowned || (h.downed ? 1 : 0);
      byHero[hid].totalFinalHp += h.finalHp || 0;
    }

    for (const c of g.clashHistory || []) {
      if (!c.monsterId) continue;
      if (!byMonster[c.monsterId]) {
        byMonster[c.monsterId] = {
          name: c.monsterName,
          isBoss: Boolean(c.isBoss),
          fights: 0,
          won: 0,
          lost: 0,
          fled: 0,
          exchanges: [],
        };
      }
      const m = byMonster[c.monsterId];
      m.fights += 1;
      if (c.outcome === 'won') m.won += 1;
      else if (c.outcome === 'lost') m.lost += 1;
      else m.fled += 1;
      m.exchanges.push(c.exchanges || 0);
    }

    for (const k of Object.keys(heroPlays)) {
      heroPlays[k] += g.heroPlays?.[k] || 0;
    }
    for (const k of Object.keys(heroPlaysBySuit)) {
      heroPlaysBySuit[k] += g.heroPlaysBySuit?.[k] || 0;
    }
    for (const k of Object.keys(desperationByTier)) {
      desperationByTier[k] += g.desperationByTier?.[k] || 0;
    }
  }

  const totalCompleted = wins + losses;
  const allClashes = completed.flatMap((g) => g.clashHistory || []);
  const avgClashLength = avg(allClashes.map((c) => c.exchanges || 0));
  const avgDesperationPerFloor = avg(completed.map((g) => g.desperationFlips || 0));
  const avgDownedPerFloor = avg(completed.map((g) => g.heroDownedCount || 0));
  const hoard6PlusCount = completed.filter((g) => g.hoarded6Plus).length;
  const bossDefeatCount = completed.filter((g) => g.bossDefeated).length;

  for (const [k, v] of Object.entries(byPartySize)) {
    byPartySize[k] = {
      played: v.played,
      won: v.won,
      lost: v.lost,
      winRatePct: pct(v.won, v.played),
      avgTurns: avg(v.turns),
      avgDesp: avg(v.desp),
      avgDowned: avg(v.downed),
    };
  }
  for (const [k, v] of Object.entries(byHero)) {
    byHero[k] = {
      ...v,
      winRatePct: pct(v.won, v.played),
      avgFinalHp: v.played ? Number((v.totalFinalHp / v.played).toFixed(2)) : 0,
    };
  }
  for (const [k, v] of Object.entries(byMonster)) {
    byMonster[k] = {
      name: v.name,
      isBoss: v.isBoss,
      fights: v.fights,
      won: v.won,
      lost: v.lost,
      fled: v.fled,
      heroWinPct: pct(v.won, v.fights),
      avgExchanges: avg(v.exchanges),
    };
  }

  return {
    activeGames,
    lobbyGames,
    totalCompleted,
    totalStarted: gamesList.length,
    wins,
    losses,
    abandoned,
    winRatePct: pct(wins, totalCompleted),
    avgTurns: avg(completed.map((g) => g.explorationTurns || 0)),
    avgDurationSec: avg(completed.map((g) => g.durationSec || 0)),
    avgClashLength,
    avgDesperationPerFloor,
    avgDownedPerFloor,
    hoard6PlusPct: pct(hoard6PlusCount, totalCompleted),
    bossDefeatRatePct: pct(bossDefeatCount, totalCompleted),
    byPartySize,
    byHero,
    byBoss,
    byMonster,
    byTheme,
    heroPlays,
    heroPlaysBySuit,
    desperationByTier,
    checklistTargets: {
      skirmishLength: { actual: avgClashLength, target: '3–5 exchanges', ok: avgClashLength >= 3 && avgClashLength <= 5 },
      desperationPerFloor: { actual: avgDesperationPerFloor, target: '1–3 flips', ok: avgDesperationPerFloor >= 1 && avgDesperationPerFloor <= 3 },
      downedPerFloor: { actual: avgDownedPerFloor, target: '0–2 knocks', ok: avgDownedPerFloor <= 2 },
      hoard6PlusPct: { actual: pct(hoard6PlusCount, totalCompleted), target: '>0% (tension)', ok: hoard6PlusCount > 0 },
    },
  };
}

export function playtestTelemetryPlugin() {
  const dataDir = path.resolve(process.cwd(), '.playtest-data');
  const filePath = path.join(dataDir, 'telemetry.json');

  let store = emptyStore();
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        store = {
          games: parsed.games || {},
          batches: parsed.batches || {},
          tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
        };
      }
    }
  } catch {
    store = emptyStore();
  }

  function persist() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  return {
    name: 'cbc-playtest-telemetry',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlObj = new URL(req.url || '/', 'http://localhost');
        const pathname = urlObj.pathname;

        if (!pathname.startsWith('/api/telemetry/')) {
          return next();
        }

        try {
          if (req.method === 'GET' && pathname === '/api/telemetry/summary') {
            const now = Date.now();
            const allGames = Object.values(store.games).map((g) => ({
              ...g,
              effectiveStatus: effectiveStatus(g, now),
            }));
            const uiGames = allGames.filter((g) => g.source !== 'headless-sim');
            const simGames = allGames.filter((g) => g.source === 'headless-sim');

            const activeList = allGames
              .filter((g) => g.effectiveStatus === 'active' || g.effectiveStatus === 'lobby')
              .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

            const recentGames = allGames
              .filter((g) => g.effectiveStatus !== 'active' && g.effectiveStatus !== 'lobby')
              .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
              .slice(0, 50);

            const ticketsVirtual = store.tickets.filter((t) => t.category === 'virtual');
            const ticketsRules = store.tickets.filter((t) => t.category === 'rules');

            return sendJson(res, 200, {
              updatedAt: now,
              overall: aggregateBucket(allGames, now),
              ui: aggregateBucket(uiGames, now),
              sim: aggregateBucket(simGames, now),
              activeList,
              recentGames,
              batches: Object.values(store.batches).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
              tickets: {
                virtual: ticketsVirtual,
                rules: ticketsRules,
              },
            });
          }

          if (req.method === 'POST' && pathname === '/api/telemetry/game') {
            const body = await readJsonBody(req);
            if (!body?.gameId) return sendJson(res, 400, { error: 'gameId required' });
            store.games[body.gameId] = body;
            persist();
            return sendJson(res, 200, { ok: true, gameId: body.gameId });
          }

          if (req.method === 'POST' && pathname === '/api/telemetry/batch') {
            const body = await readJsonBody(req);
            if (!body?.batchId) return sendJson(res, 400, { error: 'batchId required' });
            store.batches[body.batchId] = {
              ...body,
              updatedAt: Date.now(),
            };
            persist();
            return sendJson(res, 200, { ok: true, batchId: body.batchId });
          }

          if (req.method === 'POST' && pathname === '/api/telemetry/ticket') {
            const body = await readJsonBody(req);
            if (!body?.title || !body?.category) {
              return sendJson(res, 400, { error: 'category and title required' });
            }
            const ticket = {
              id: body.id || `raw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              category: body.category,
              severity: body.severity || 'medium',
              area: body.area || 'general',
              title: body.title,
              summary: body.summary || '',
              repro: body.repro || '',
              evidence: body.evidence || '',
              reporter: body.reporter || 'unknown',
              createdAt: body.createdAt || Date.now(),
            };
            const idx = store.tickets.findIndex((t) => t.id === ticket.id);
            if (idx >= 0) store.tickets[idx] = ticket;
            else store.tickets.push(ticket);
            persist();
            return sendJson(res, 200, { ok: true, id: ticket.id });
          }

          if (req.method === 'POST' && pathname === '/api/telemetry/tickets-replace') {
            const body = await readJsonBody(req);
            if (!Array.isArray(body?.tickets)) {
              return sendJson(res, 400, { error: 'tickets array required' });
            }
            store.tickets = body.tickets;
            persist();
            return sendJson(res, 200, { ok: true, count: store.tickets.length });
          }

          if (req.method === 'POST' && pathname === '/api/telemetry/reset') {
            const sourceFilter = urlObj.searchParams.get('source');
            if (sourceFilter) {
              for (const [k, g] of Object.entries(store.games)) {
                if (g.source === sourceFilter) delete store.games[k];
              }
            } else {
              store = emptyStore();
            }
            persist();
            return sendJson(res, 200, { ok: true });
          }

          return sendJson(res, 404, { error: 'Not found' });
        } catch (err) {
          return sendJson(res, 500, { error: err.message || String(err) });
        }
      });
    },
  };
}
