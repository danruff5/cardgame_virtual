import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchSharedBrowser, buildAppUrl, dismissCoachmarkIfAny } from './browser-util.mjs';

const PORT = Number(process.env.DEALER_MANAGER_PORT || 5175);
const APP_BASE = process.env.APP_BASE_URL || 'http://localhost:5173';
const BATCH_DIR = path.resolve(process.cwd(), '.playtest-data', 'batches');

let browser = null;
const rooms = new Map();
let totalRoomsCreated = 0;

function readJson(req) {
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

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await launchSharedBrowser();
  }
  return browser;
}

async function createDealerRoom({
  expectedHeroes = 1,
  themeId = null,
  bossId = null,
  layoutMode = 'random',
  batchId = 'manual',
  testerLabel = '',
  playTwists = true,
  autoStart = true,
} = {}) {
  const b = await getBrowser();
  const context = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message || String(err));
  });

  const url = buildAppUrl({
    baseUrl: APP_BASE,
    batchId,
    source: 'ui-playtest',
    tester: testerLabel || null,
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await dismissCoachmarkIfAny(page);

  await page.fill('#name', 'Dealer Bot');
  await page.click('#btn-host');
  await page.waitForSelector('#join-url', { timeout: 15000 });

  const joinUrl = await page.inputValue('#join-url');
  const parsed = new URL(joinUrl);
  const roomCode = parsed.searchParams.get('room');
  if (!roomCode) throw new Error('Failed to extract roomCode from #join-url');

  totalRoomsCreated += 1;
  const entry = {
    roomCode,
    joinUrl,
    batchId,
    testerLabel,
    expectedHeroes: Number(expectedHeroes || 1),
    themeId,
    bossId,
    layoutMode,
    playTwists,
    autoStart,
    context,
    page,
    consoleErrors,
    pageErrors,
    started: false,
    ended: false,
    outcome: null,
    lastActiveAt: Date.now(),
    lastTwistTurn: -4,
    timer: null,
    cleanupTimer: null,
    closed: false,
  };

  rooms.set(roomCode, entry);

  entry.timer = setInterval(() => {
    tickRoom(entry).catch((err) => {
      entry.pageErrors.push(`dealer-tick: ${err.message || err}`);
    });
  }, 450);

  return {
    roomCode,
    joinUrl,
    batchId,
    expectedHeroes: entry.expectedHeroes,
    themeId,
    bossId,
    layoutMode,
  };
}

async function tickRoom(entry) {
  if (entry.closed || entry.ended) return;
  const { page } = entry;
  await dismissCoachmarkIfAny(page);

  const snapshot = await page.evaluate(() => {
    const cbc = window.__CBC_STATE__?.();
    const st = cbc?.state;
    if (!st) return null;
    const heroes = (st.players || []).filter((p) => p.role === 'hero');
    const allPicked = heroes.length > 0 && heroes.every((h) => Boolean(h.heroId));
    const allDowned =
      Object.values(st.heroes || {}).length > 0 &&
      Object.values(st.heroes || {}).every((h) => h.downed);
    return {
      phase: st.phase,
      version: st.version,
      heroPlayersCount: heroes.length,
      allPicked,
      allDowned,
      whoseTurn: st.clash?.whoseTurn || null,
      twistCount: st.decks?.twistHand?.length || 0,
      hasPending: Boolean(st.pending),
      activeHeroIndex: st.activeHeroIndex,
    };
  });

  if (!snapshot) return;

  if (snapshot.phase === 'lobby' && entry.autoStart && !entry.started) {
    if (snapshot.heroPlayersCount >= entry.expectedHeroes && snapshot.allPicked) {
      entry.started = true;
      if (entry.layoutMode) {
        await page.selectOption('#layout-mode', entry.layoutMode).catch(() => {});
      }
      if (entry.themeId) {
        await page.selectOption('#theme', entry.themeId).catch(() => {});
      }
      if (entry.bossId) {
        await page.selectOption('#boss', entry.bossId).catch(() => {});
      }
      await page.click('#btn-start');
      entry.lastActiveAt = Date.now();
    }
    return;
  }

  if (snapshot.phase === 'victory' || snapshot.allDowned) {
    entry.ended = true;
    entry.outcome = snapshot.phase === 'victory' ? 'won' : 'lost';
    clearInterval(entry.timer);
    entry.cleanupTimer = setTimeout(() => closeRoom(entry.roomCode).catch(() => {}), 30000);
    return;
  }

  // Monster turn in clash
  if (snapshot.phase === 'clash' && snapshot.whoseTurn === 'monster') {
    const monsterBtn = page.locator('#btn-clash-monster');
    if (await monsterBtn.isVisible({ timeout: 100 }).catch(() => false)) {
      if (await monsterBtn.isEnabled().catch(() => false)) {
        await monsterBtn.click().catch(() => {});
        entry.lastActiveAt = Date.now();
        return;
      }
    }
  }

  // Occasional playful twist
  if (
    entry.playTwists &&
    snapshot.phase === 'exploring' &&
    !snapshot.hasPending &&
    snapshot.twistCount > 0 &&
    (snapshot.version || 0) - entry.lastTwistTurn >= 8
  ) {
    const twistBtn = page.locator('.dealer-twist-play').first();
    if (await twistBtn.isVisible({ timeout: 80 }).catch(() => false)) {
      if (await twistBtn.isEnabled().catch(() => false)) {
        entry.lastTwistTurn = snapshot.version || 0;
        await twistBtn.click().catch(() => {});
        entry.lastActiveAt = Date.now();
      }
    }
  }

  // 12-minute inactivity timeout
  if (Date.now() - entry.lastActiveAt > 12 * 60 * 1000) {
    entry.ended = true;
    entry.outcome = 'timeout';
    clearInterval(entry.timer);
    await closeRoom(entry.roomCode);
  }
}

async function closeRoom(roomCode) {
  const entry = rooms.get(roomCode);
  if (!entry) return false;
  entry.closed = true;
  if (entry.timer) clearInterval(entry.timer);
  if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer);
  await entry.context.close().catch(() => {});
  rooms.delete(roomCode);
  return true;
}

function summarizeRoom(entry) {
  return {
    roomCode: entry.roomCode,
    joinUrl: entry.joinUrl,
    batchId: entry.batchId,
    testerLabel: entry.testerLabel,
    expectedHeroes: entry.expectedHeroes,
    started: entry.started,
    ended: entry.ended,
    outcome: entry.outcome,
    consoleErrors: entry.consoleErrors,
    pageErrors: entry.pageErrors,
  };
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url || '/', `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  try {
    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        activeRooms: rooms.size,
        totalRoomsCreated,
      });
    }

    if (req.method === 'GET' && pathname === '/rooms') {
      return sendJson(res, 200, {
        rooms: Array.from(rooms.values()).map(summarizeRoom),
      });
    }

    if (req.method === 'GET' && pathname.startsWith('/rooms/')) {
      const code = pathname.split('/')[2]?.toUpperCase();
      const entry = rooms.get(code);
      if (!entry) return sendJson(res, 404, { error: 'Room not found' });
      return sendJson(res, 200, summarizeRoom(entry));
    }

    if (req.method === 'POST' && pathname === '/rooms') {
      const body = await readJson(req);
      const created = await createDealerRoom(body);
      return sendJson(res, 200, created);
    }

    if (req.method === 'POST' && pathname === '/batches') {
      const body = await readJson(req);
      const batchId = body.batchId || `batch-${Date.now()}`;
      const specs = Array.isArray(body.specs) ? body.specs : [];
      const createdRooms = [];
      for (const spec of specs) {
        createdRooms.push(await createDealerRoom({ ...spec, batchId }));
      }
      fs.mkdirSync(BATCH_DIR, { recursive: true });
      const manifest = { batchId, createdAt: Date.now(), rooms: createdRooms };
      fs.writeFileSync(path.join(BATCH_DIR, `${batchId}.json`), JSON.stringify(manifest, null, 2));
      fetch(`${APP_BASE}/api/telemetry/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manifest),
      }).catch(() => {});
      return sendJson(res, 200, manifest);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/rooms/')) {
      const code = pathname.split('/')[2]?.toUpperCase();
      const ok = await closeRoom(code);
      return sendJson(res, ok ? 200 : 404, { ok });
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || String(err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`DEALER_MANAGER_READY port=${PORT}`);
});
