import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchSharedBrowser, buildAppUrl, dismissCoachmarkIfAny } from './browser-util.mjs';

const PORT = Number(process.env.HERO_DRIVER_PORT || 5176);
const APP_BASE = process.env.APP_BASE_URL || 'http://localhost:5173';

let browser = null;
const sessions = new Map();

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

async function createPageSession(sessionId, viewport = { width: 1440, height: 900 }) {
  if (sessions.has(sessionId)) {
    const old = sessions.get(sessionId);
    await old.context.close().catch(() => {});
    sessions.delete(sessionId);
  }
  const b = await getBrowser();
  const context = await b.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message || String(err));
  });
  const entry = { sessionId, context, page, consoleErrors, pageErrors };
  sessions.set(sessionId, entry);
  return entry;
}

async function safeClick(page, selector) {
  try {
    await page.click(selector, { timeout: 5000 });
  } catch (err) {
    if (/not stable|intercepts pointer/i.test(err?.message || '')) {
      await page.click(selector, { force: true, timeout: 5000 });
    } else {
      throw err;
    }
  }
}

async function extractSnapshot(entry) {
  const { page, consoleErrors, pageErrors } = entry;
  const dom = await page.evaluate(() => {
    const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    const cbc = window.__CBC_STATE__?.();
    const st = cbc?.state;

    const statusBar = text(document.querySelector('.status-bar'));
    const errorText = text(document.querySelector('.status-bar .error'));
    const coachEl = document.querySelector('.coach-tip');
    const coachmarkVisible = Boolean(coachEl && coachEl.offsetParent !== null);
    const coachmarkText = coachmarkVisible ? text(coachEl) : '';

    // Map tiles from DOM
    const map = [];
    document.querySelectorAll('.map-cell[data-row]').forEach((el) => {
      const x = Number(el.getAttribute('data-col'));
      const y = Number(el.getAttribute('data-row'));
      const label = text(el.querySelector('.map-label'));
      const faceUp = el.classList.contains('face-up');
      const clickable = !el.disabled && el.hasAttribute('data-move-x');
      const carryTarget = !el.disabled && el.hasAttribute('data-carry-x');
      const hasJammedDoor = Boolean(el.querySelector('.door-jam'));
      const pawns = Array.from(el.querySelectorAll('.pawn')).map((p) => p.getAttribute('title') || text(p));
      const kindClass = ['entrance', 'stairs', 'shrine', 'monster', 'boss', 'vault', 'trap', 'merchant', 'hallway'].find((k) =>
        el.classList.contains(k),
      );
      map.push({ x, y, label, faceUp, kind: kindClass || 'unknown', clickable, carryTarget, hasJammedDoor, pawns });
    });

    // Room actions
    const roomActions = [];
    document
      .querySelectorAll(
        '#btn-vault, #btn-shrine, #btn-hallway, #btn-merchant, #btn-pry-jam, #btn-end-turn, #btn-boss-start, [data-revive], [data-carry], [data-use-belt], [data-clash-join]',
      )
      .forEach((btn) => {
        if (btn.disabled) return;
        let selector = '';
        if (btn.id) selector = `#${btn.id}`;
        else if (btn.hasAttribute('data-revive')) selector = `[data-revive="${btn.getAttribute('data-revive')}"]`;
        else if (btn.hasAttribute('data-carry')) selector = `[data-carry="${btn.getAttribute('data-carry')}"]`;
        else if (btn.hasAttribute('data-use-belt')) {
          selector = `[data-use-belt="${btn.getAttribute('data-use-belt')}"]`;
        } else if (btn.hasAttribute('data-clash-join')) {
          selector = `[data-clash-join="${btn.getAttribute('data-clash-join')}"]`;
        }
        roomActions.push({ selector, label: text(btn) });
      });

    // Pending modal
    let pendingModal = null;
    const promptEl = document.querySelector('.table-prompt-card');
    if (promptEl) {
      const choices = [];
      promptEl.querySelectorAll('[data-keep-loot], [data-event-choice]').forEach((b) => {
        if (b.disabled) return;
        const selector = b.hasAttribute('data-keep-loot')
          ? `[data-keep-loot="${b.getAttribute('data-keep-loot')}"]`
          : `[data-event-choice="${b.getAttribute('data-event-choice')}"]`;
        choices.push({ selector, label: text(b) });
      });
      pendingModal = {
        kind: promptEl.classList.contains('is-vault') ? 'vault' : 'event',
        title: text(promptEl.querySelector('h3')),
        choices,
      };
    }

    // Clash modal
    let clashModal = null;
    const clashEl = document.querySelector('.clash-modal-shell, .clash-table');
    if (clashEl && clashEl.offsetParent !== null) {
      const legalCards = [];
      let illegalCardsCount = 0;
      let crampCount = 0;
      document.querySelectorAll('[data-clash-card]').forEach((b) => {
        if (b.classList.contains('is-cramp')) crampCount += 1;
        if (b.disabled) {
          illegalCardsCount += 1;
        } else {
          legalCards.push({
            id: b.getAttribute('data-clash-card'),
            label: text(b.querySelector('.card-title')) || b.getAttribute('data-clash-card'),
            selector: `[data-clash-card="${b.getAttribute('data-clash-card')}"]`,
          });
        }
      });
      const buttons = [];
      document
        .querySelectorAll(
          '#btn-clash-desperation, #btn-clash-cramp, #btn-clash-monster, #btn-clash-end-twin, #btn-clash-win, #btn-clash-flee, [data-clash-belt], [data-clash-join]',
        )
        .forEach((b) => {
          let selector = b.id ? `#${b.id}` : '';
          if (!selector && b.hasAttribute('data-clash-belt')) {
            selector = `[data-clash-belt="${b.getAttribute('data-clash-belt')}"][data-belt-mode="${b.getAttribute('data-belt-mode')}"]`;
          } else if (!selector && b.hasAttribute('data-clash-join')) {
            selector = `[data-clash-join="${b.getAttribute('data-clash-join')}"]`;
          }
          buttons.push({ selector, label: text(b), disabled: Boolean(b.disabled) });
        });
      const logTop = Array.from(document.querySelectorAll('.clash-log div, .clash-log li'))
        .slice(0, 5)
        .map((el) => text(el));

      clashModal = {
        visible: true,
        monsterName: st?.clash?.monsterName || '',
        monsterHp: st?.clash?.monsterHp ?? null,
        monsterMaxHp: st?.clash?.monsterMaxHp ?? null,
        isBoss: Boolean(st?.clash?.isBoss),
        heroName: st?.heroes?.[st?.clash?.heroPlayerId]?.name || '',
        heroHp: st?.heroes?.[st?.clash?.heroPlayerId]?.hp ?? null,
        activeSuit: st?.clash?.activeSuit || null,
        activeRank: st?.clash?.activeRank ?? null,
        whoseTurn: st?.clash?.whoseTurn || null,
        legalCards,
        illegalCardsCount,
        crampCount,
        buttons,
        logTop,
      };
    }

    const bossBar = document.querySelector('.boss-gather-bar');
    const bossGather = bossBar
      ? {
          visible: true,
          text: text(bossBar),
          canStart: !document.querySelector('#btn-boss-start')?.disabled,
        }
      : { visible: false };

    const brokenImages = Array.from(document.querySelectorAll('img')).filter(
      (img) => img.complete && img.naturalWidth === 0 && img.style.display !== 'none',
    ).length;
    const overflowX = document.documentElement.scrollWidth > window.innerWidth + 2;

    const heroesSummary = Object.entries(st?.heroes || {}).map(([pid, h]) => ({
      pid,
      heroId: h.heroId,
      name: h.name,
      hp: h.hp,
      maxHp: h.maxHp,
      downed: h.downed,
      handCount: (h.hand || []).length,
      belt: (h.belt || []).map((b) => b.name),
    }));

    return {
      url: window.location.href,
      phase: st?.phase || (document.querySelector('#btn-host') ? 'lobby-shell' : 'unknown'),
      role: cbc?.meta?.role || null,
      meId: cbc?.meta?.playerId || null,
      roomCode: cbc?.meta?.roomCode || st?.roomCode || null,
      activeHeroId: st?.turnOrder?.[st?.activeHeroIndex] || null,
      actionsLeft: st?.explorationActionsLeft ?? null,
      stairsUnlocked: Boolean(st?.floor?.stairsUnlocked),
      bossDefeated: Boolean(st?.floor?.bossDefeated),
      statusBar,
      errorText,
      coachmarkVisible,
      coachmarkText,
      bossGather,
      heroes: heroesSummary,
      map,
      roomActions,
      pendingModal,
      clashModal,
      recentLog: (st?.log || []).slice(0, 8),
      brokenImages,
      overflowX,
    };
  });

  return {
    ...dom,
    uiAudit: {
      consoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
      brokenImages: dom.brokenImages,
      overflowX: dom.overflowX,
    },
  };
}

async function runSmartAutoSteps(entry, { steps = 15, autoModals = false } = {}) {
  const trace = [];
  let stopReason = 'steps-completed';

  for (let i = 0; i < steps; i += 1) {
    if (entry.consoleErrors.length || entry.pageErrors.length) {
      stopReason = 'browser-error';
      break;
    }

    const snap = await extractSnapshot(entry);
    const myHero = snap.heroes.find((h) => h.pid === snap.meId);

    if (snap.phase === 'victory') {
      stopReason = 'victory';
      break;
    }
    if (myHero?.downed && snap.heroes.every((h) => h.downed)) {
      stopReason = 'all-downed';
      break;
    }

    // Pending modal
    if (snap.pendingModal) {
      if (!autoModals) {
        stopReason = `pending-${snap.pendingModal.kind}`;
        break;
      }
      const choice = snap.pendingModal.choices[0];
      if (!choice) {
        stopReason = 'pending-waiting';
        break;
      }
      await entry.page.click(choice.selector);
      trace.push(`modal:${choice.label}`);
      await entry.page.waitForTimeout(260);
      continue;
    }

    // Clash modal
    if (snap.clashModal) {
      const cm = snap.clashModal;
      if (cm.isBoss && i === 0) {
        stopReason = 'boss-clash-active';
        break;
      }
      if (cm.whoseTurn !== 'hero') {
        await entry.page.waitForTimeout(350);
        continue;
      }
      const isMyTurn = snap.role === 'dealer' || cm.heroName === myHero?.name;
      if (!isMyTurn) {
        await entry.page.waitForTimeout(350);
        continue;
      }

      // Heal if low HP and Fizz Potion available
      const healBtn = cm.buttons.find((b) => !b.disabled && b.selector.includes('data-belt-mode="heal"'));
      if (healBtn && (myHero?.hp ?? 10) <= 5) {
        await entry.page.click(healBtn.selector);
        trace.push(`clash:heal`);
        await entry.page.waitForTimeout(260);
        continue;
      }

      if (cm.legalCards.length > 0) {
        const pick = cm.legalCards[0];
        await safeClick(entry.page, pick.selector);
        trace.push(`clash:play:${pick.label}`);
        await entry.page.waitForTimeout(280);
        continue;
      }

      const stretchBtn = cm.buttons.find((b) => b.selector === '#btn-clash-cramp' && !b.disabled);
      if (stretchBtn && cm.crampCount > 0) {
        await entry.page.click('#btn-clash-cramp');
        trace.push('clash:stretch-cramp');
        await entry.page.waitForTimeout(280);
        continue;
      }

      const despBtn = cm.buttons.find((b) => b.selector === '#btn-clash-desperation' && !b.disabled);
      if (despBtn) {
        await entry.page.click('#btn-clash-desperation');
        trace.push('clash:desperation');
        await entry.page.waitForTimeout(280);
        continue;
      }

      const endTwin = cm.buttons.find((b) => b.selector === '#btn-clash-end-twin' && !b.disabled);
      if (endTwin) {
        await entry.page.click('#btn-clash-end-twin');
        trace.push('clash:end-twin');
        await entry.page.waitForTimeout(280);
        continue;
      }

      await entry.page.waitForTimeout(300);
      continue;
    }

    // Exploration phase
    if (snap.phase === 'exploring') {
      if (snap.bossGather?.visible && snap.bossGather.canStart) {
        stopReason = 'boss-gather-ready';
        break;
      }

      const isMyExploreTurn = snap.role === 'dealer' || snap.activeHeroId === snap.meId;
      if (!isMyExploreTurn) {
        await entry.page.waitForTimeout(350);
        continue;
      }

      if (myHero?.downed) {
        const endBtn = snap.roomActions.find((a) => a.selector === '#btn-end-turn');
        if (endBtn) {
          await entry.page.click('#btn-end-turn');
          trace.push('explore:downed-end-turn');
          await entry.page.waitForTimeout(250);
          continue;
        }
        stopReason = 'hero-downed';
        break;
      }

      // Use room actions if available
      const vaultAct = snap.roomActions.find((a) => a.selector === '#btn-vault');
      if (vaultAct) {
        await entry.page.click('#btn-vault');
        trace.push('explore:vault');
        await entry.page.waitForTimeout(260);
        continue;
      }
      const shrineAct = snap.roomActions.find((a) => a.selector === '#btn-shrine');
      if (shrineAct && (myHero?.hp ?? 10) <= 7) {
        await entry.page.click('#btn-shrine');
        trace.push('explore:shrine');
        await entry.page.waitForTimeout(260);
        continue;
      }

      // Move: prefer unlocked stairs, else unrevealed room, else any clickable
      const clickable = snap.map.filter((m) => m.clickable);
      if (clickable.length > 0) {
        const target =
          (snap.stairsUnlocked && clickable.find((m) => m.kind === 'stairs')) ||
          clickable.find((m) => !m.faceUp) ||
          clickable[Math.floor(Math.random() * clickable.length)];
        await entry.page.click(`[data-move-x="${target.x}"][data-move-y="${target.y}"]`);
        trace.push(`explore:move(${target.x},${target.y}:${target.label})`);
        await entry.page.waitForTimeout(280);
        continue;
      }

      const pryAct = snap.roomActions.find((a) => a.selector === '#btn-pry-jam');
      if (pryAct) {
        await entry.page.click('#btn-pry-jam');
        trace.push('explore:pry-jam');
        await entry.page.waitForTimeout(260);
        continue;
      }

      const endAct = snap.roomActions.find((a) => a.selector === '#btn-end-turn');
      if (endAct) {
        await entry.page.click('#btn-end-turn');
        trace.push('explore:end-turn');
        await entry.page.waitForTimeout(260);
        continue;
      }
    }

    await entry.page.waitForTimeout(300);
  }

  const finalSnapshot = await extractSnapshot(entry);
  return { stopReason, stepsExecuted: trace.length, trace, snapshot: finalSnapshot };
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url || '/', `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  try {
    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, { ok: true, activeSessions: sessions.size });
    }

    if (req.method === 'POST' && pathname === '/join') {
      const { sessionId, roomCode, name = 'Hero', heroId = 'H-01', keepCoach = false, waitStart = true } =
        await readJson(req);
      const entry = await createPageSession(sessionId);
      const url = buildAppUrl({ baseUrl: APP_BASE, roomCode });
      await entry.page.goto(url, { waitUntil: 'domcontentloaded' });
      if (!keepCoach) await dismissCoachmarkIfAny(entry.page);

      await entry.page.fill('#name', name);
      await entry.page.fill('#join-code', roomCode);
      await entry.page.click('#btn-join');

      const pickSelector = `[data-pick="${heroId}"]`;
      await entry.page.waitForSelector(pickSelector, { timeout: 15000 });
      if (!keepCoach) await dismissCoachmarkIfAny(entry.page);
      await entry.page.click(pickSelector);

      if (waitStart) {
        await entry.page.waitForFunction(
          () => {
            const st = window.__CBC_STATE__?.()?.state;
            return st && st.phase !== 'lobby';
          },
          { timeout: 20000 },
        );
      }
      if (!keepCoach) {
        await entry.page.waitForTimeout(150);
        await dismissCoachmarkIfAny(entry.page);
      }
      return sendJson(res, 200, await extractSnapshot(entry));
    }

    if (req.method === 'POST' && pathname === '/host') {
      const { sessionId, name = 'Dealer', batchId = null, tester = null, monitor = false, viewport = { width: 1440, height: 900 } } =
        await readJson(req);
      const entry = await createPageSession(sessionId, viewport);
      const url = buildAppUrl({ baseUrl: APP_BASE, batchId, source: 'ui-playtest', tester, monitor });
      await entry.page.goto(url, { waitUntil: 'domcontentloaded' });
      if (!monitor) {
        await entry.page.fill('#name', name);
        await entry.page.click('#btn-host');
        await entry.page.waitForSelector('#join-url', { timeout: 15000 });
      } else {
        await entry.page.waitForSelector('.monitor-shell', { timeout: 10000 });
      }
      return sendJson(res, 200, await extractSnapshot(entry));
    }

    if (req.method === 'POST' && pathname === '/state') {
      const { sessionId } = await readJson(req);
      const entry = sessions.get(sessionId);
      if (!entry) return sendJson(res, 404, { error: 'Session not found' });
      return sendJson(res, 200, await extractSnapshot(entry));
    }

    if (req.method === 'POST' && pathname === '/act') {
      const { sessionId, selector, value, select } = await readJson(req);
      const entry = sessions.get(sessionId);
      if (!entry) return sendJson(res, 404, { error: 'Session not found' });
      if (value != null) {
        await entry.page.fill(selector, String(value));
      } else if (select != null) {
        await entry.page.selectOption(selector, String(select));
      } else {
        await safeClick(entry.page, selector);
      }
      await entry.page.waitForTimeout(260);
      return sendJson(res, 200, await extractSnapshot(entry));
    }

    if (req.method === 'POST' && pathname === '/auto-step') {
      const { sessionId, steps = 15, autoModals = false } = await readJson(req);
      const entry = sessions.get(sessionId);
      if (!entry) return sendJson(res, 404, { error: 'Session not found' });
      const result = await runSmartAutoSteps(entry, { steps: Number(steps), autoModals: Boolean(autoModals) });
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && pathname === '/screenshot') {
      const { sessionId, outPath, width, height } = await readJson(req);
      const entry = sessions.get(sessionId);
      if (!entry) return sendJson(res, 404, { error: 'Session not found' });
      if (width && height) {
        await entry.page.setViewportSize({ width: Number(width), height: Number(height) });
        await entry.page.waitForTimeout(150);
      }
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      await entry.page.screenshot({ path: outPath, fullPage: false });
      return sendJson(res, 200, { ok: true, outPath });
    }

    if (req.method === 'POST' && pathname === '/audit') {
      const { sessionId } = await readJson(req);
      const entry = sessions.get(sessionId);
      if (!entry) return sendJson(res, 404, { error: 'Session not found' });
      const audit = await entry.page.evaluate(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const overflowX = document.documentElement.scrollWidth > vw + 2;
        const brokenImages = Array.from(document.querySelectorAll('img'))
          .filter((img) => img.complete && img.naturalWidth === 0 && img.style.display !== 'none')
          .map((img) => img.getAttribute('src'));
        const clippedButtons = [];
        document.querySelectorAll('button').forEach((b) => {
          if (b.offsetParent === null) return;
          const r = b.getBoundingClientRect();
          if (r.right > vw + 2 || r.left < -2) {
            clippedButtons.push({ text: b.textContent.trim().slice(0, 40), left: r.left, right: r.right, vw });
          }
        });
        return { viewport: { vw, vh }, overflowX, brokenImages, clippedButtons };
      });
      return sendJson(res, 200, {
        ...audit,
        consoleErrors: [...entry.consoleErrors],
        pageErrors: [...entry.pageErrors],
      });
    }

    if (req.method === 'POST' && pathname === '/close') {
      const { sessionId } = await readJson(req);
      const entry = sessions.get(sessionId);
      if (!entry) return sendJson(res, 404, { error: 'Session not found' });
      const summary = {
        closed: sessionId,
        consoleErrors: [...entry.consoleErrors],
        pageErrors: [...entry.pageErrors],
      };
      await entry.context.close().catch(() => {});
      sessions.delete(sessionId);
      return sendJson(res, 200, summary);
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || String(err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`HERO_DRIVER_READY port=${PORT}`);
});
