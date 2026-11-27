import './style.css';
import './ui/cards.css';
import './ui/coachmarks.css';
import './ui/clash.css';
import './ui/table.css';
import { PeerRoom, readRoomFromUrl, buildJoinUrl } from './net/peerRoom.js';
import { dataInventory, HEROES, THEMES, BOSSES, SUITS } from './data/index.js';
import { renderHeroCard } from './ui/cardView.js';
import { ASSET } from './data/artMeta.js';
import {
  bindCoachMenu,
  renderCoachUi,
  setCoachChangeHandler,
  syncCoachAfterRender,
} from './ui/coachmarks.js';
import { syncClashModal, wireTableLogHovers } from './ui/clashModal.js';
import { initCardTipPortal, hideCardTip } from './ui/cardTipPortal.js';
import { renderTable } from './ui/tableView.js';
import { mountMonitorView } from './ui/monitorView.js';

document.documentElement.style.setProperty(
  '--bg-art',
  `url(${ASSET.ui('bg-basement.webp')})`,
);

const app = document.querySelector('#app');

const session = {
  room: null,
  state: null,
  meta: null,
  status: 'Ready.',
  error: '',
  name: localStorage.getItem('cbc-name') || '',
  joining: false,
  coachMenuOpen: false,
  inspectedHeroId: null,
  lastActiveHeroId: null,
  carryingTargetId: null,
  lastPhase: null,
  lastFloorNumber: null,
};

function coachContext() {
  if (!session.state) return { screen: 'lobby-shell', phase: null, isDealer: false };
  if (session.state.phase === 'lobby') {
    return { screen: 'lobby-game', phase: 'lobby', isDealer: Boolean(session.meta?.isHost) };
  }
  return {
    screen: 'table',
    phase: session.state.phase,
    isDealer: Boolean(session.meta?.isHost),
  };
}

function paintCoach() {
  renderCoachUi({
    context: coachContext(),
    menuOpen: session.coachMenuOpen,
  });
}

bindCoachMenu({
  getMenuOpen: () => session.coachMenuOpen,
  setMenuOpen: (open) => {
    session.coachMenuOpen = open;
    paintCoach();
  },
  getContext: () => coachContext(),
});

setCoachChangeHandler(() => {
  paintCoach();
});

const room = new PeerRoom({
  onState: (state, meta) => {
    const prevPhase = session.lastPhase;
    const prevFloor = session.lastFloorNumber;
    session.state = state;
    session.meta = meta;
    session.lastPhase = state?.phase || null;
    session.lastFloorNumber = state?.floorNumber || null;
    if (
      state?.phase &&
      state.phase !== 'lobby' &&
      (prevPhase === 'lobby' ||
        prevPhase === null ||
        prevFloor !== (state.floorNumber || 1) ||
        /in lobby|share code or link|joining|^Floor \d+ active\.$/i.test(session.status || ''))
    ) {
      session.status = `Floor ${state.floorNumber || 1} active.`;
    }
    session.error = '';
    session.carryingTargetId = null;
    render();
  },
  onStatus: (msg) => {
    session.status = msg;
    render();
  },
  onError: (msg) => {
    session.error = msg;
    render();
  },
});

session.room = room;

if (typeof window !== 'undefined') {
  window.__CBC_STATE__ = () => ({
    state: session.state,
    meta: session.meta,
    status: session.status,
    error: session.error,
  });
}

const isMonitorMode =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).get('monitor') === '1' ||
    window.location.hash === '#monitor');

const pendingRoom = readRoomFromUrl();
if (typeof document !== 'undefined') {
  initCardTipPortal();
}
if (isMonitorMode) {
  mountMonitorView(app);
} else {
  render();
}

function render() {
  hideCardTip();
  const isTable = Boolean(session.state && session.state.phase !== 'lobby');
  document.body.classList.toggle('table-active', isTable);
  if (!session.state) {
    session.inspectedHeroId = null;
    session.lastActiveHeroId = null;
    session.carryingTargetId = null;
    app.innerHTML = renderLobbyShell();
    wireLobby();
  } else if (session.state.phase === 'lobby') {
    session.inspectedHeroId = null;
    session.lastActiveHeroId = null;
    session.carryingTargetId = null;
    app.innerHTML = renderLobbyGame();
    wireLobbyGame();
  } else {
    const activeId = session.state.turnOrder?.[session.state.activeHeroIndex] || null;
    if (session.meta?.isHost && activeId !== session.lastActiveHeroId) {
      session.inspectedHeroId = null;
    }
    if (activeId !== session.lastActiveHeroId) {
      session.carryingTargetId = null;
    }
    session.lastActiveHeroId = activeId;
    app.innerHTML = renderTable(session.state, {
      isDealer: Boolean(session.meta?.isHost),
      meId: session.meta?.playerId,
      roomCode: session.meta?.roomCode || session.state.roomCode,
      role: session.meta?.role || '—',
      status: session.status,
      error: session.error,
      inspectedHeroId: session.inspectedHeroId,
      carryingTargetId: session.carryingTargetId,
    });
    wireTable();
  }
  syncClashModal({
    session,
    room,
    state: session.state,
    isDealer: Boolean(session.meta?.isHost),
    meId: session.meta?.playerId,
  });
  syncCoachAfterRender(coachContext());
  paintCoach();
}

function brand() {
  return `
    <header class="hero-brand">
      <h1>Cozy Basement Crawl</h1>
      <p class="tagline">Dealer-host multiplayer crawl — PeerJS WebRTC, no custom backend. Heroes explore square rooms; the dealer machine is the rules authority.</p>
    </header>
  `;
}

function statusBar() {
  const code = session.meta?.roomCode || session.state?.roomCode || '—';
  const role = session.meta?.role || '—';
  return `
    <div class="status-bar">
      <span class="pill">Room <strong>${escapeHtml(code)}</strong></span>
      <span class="pill">You: <strong>${escapeHtml(role)}</strong></span>
      <span>${escapeHtml(session.status)}</span>
      <a class="monitor-link-pill" href="?monitor=1" target="_blank" rel="noopener">Monitor</a>
      ${session.error ? `<span class="error">${escapeHtml(session.error)}</span>` : ''}
    </div>
  `;
}

function renderLobbyShell() {
  const inv = dataInventory();
  return `
    ${brand()}
    <div class="lobby-grid">
      <section class="panel stack">
        <h2>Open a table</h2>
        <p>Host as the Dealer on this device. Friends join with the room code (or link). Your browser talks peer-to-peer via the free PeerJS cloud broker.</p>
        <div class="field">
          <label for="name">Your display name</label>
          <input id="name" maxlength="24" value="${escapeAttr(session.name)}" placeholder="Dealer Dani" />
        </div>
        <div class="row">
          <button class="primary" id="btn-host" type="button" ${session.joining ? 'disabled' : ''}>Host as Dealer</button>
        </div>
        <hr style="border:0;border-top:1px solid var(--line);margin:0.4rem 0" />
        <h3>Join a room</h3>
        <p class="muted">After a successful join you should see the shared <strong>Lobby</strong> (player list + hero picks) — not this screen.</p>
        <div class="field">
          <label for="join-code">Room code</label>
          <input id="join-code" maxlength="8" value="${escapeAttr(pendingRoom || '')}" placeholder="e.g. K7MP" ${session.joining ? 'disabled' : ''} />
        </div>
        <div class="row">
          <button id="btn-join" type="button" ${session.joining ? 'disabled' : ''}>${session.joining ? 'Joining…' : 'Join as Hero'}</button>
        </div>
      </section>
      <section class="panel stack">
        <h2>Encoded game data</h2>
        <p>Static modules ported from the design docs (Floor 1).</p>
        <div class="inventory">
          heroes ${inv.heroes} · gear ${inv.gear} · action ${inv.actionDeck} · desperation ${inv.desperation}<br/>
          cramp ${inv.cramp} · rooms ${inv.rooms} (recipe ${inv.defaultFloorTiles}) · monsters ${inv.monsters} · bosses ${inv.bosses}<br/>
          events ${inv.events} · merchants ${inv.merchants} · themes ${inv.themes} · twists ${inv.twists}
        </div>
        <p class="muted">Lobby + exploration + Clash &amp; Chain combat (match Suit/Rank, Desperation, dealer monster turns). Art from the print-and-play compositor.</p>
      </section>
    </div>
  `;
}

function wireLobby() {
  const nameEl = document.getElementById('name');
  nameEl?.addEventListener('change', () => {
    session.name = nameEl.value.trim();
    localStorage.setItem('cbc-name', session.name);
  });
  document.getElementById('btn-host')?.addEventListener('click', async () => {
    session.name = (nameEl?.value || 'Dealer').trim();
    localStorage.setItem('cbc-name', session.name);
    try {
      const info = await room.host({ name: session.name });
      history.replaceState({}, '', buildJoinUrl(info.roomCode));
    } catch (err) {
      session.error = err.message || String(err);
      render();
    }
  });
  document.getElementById('btn-join')?.addEventListener('click', async () => {
    if (session.joining || session.state) return;
    session.name = (nameEl?.value || 'Hero').trim();
    localStorage.setItem('cbc-name', session.name);
    const code = document.getElementById('join-code')?.value.trim();
    session.joining = true;
    session.status = 'Joining…';
    session.error = '';
    render();
    try {
      await room.join({ roomCode: code, name: session.name });
      history.replaceState({}, '', buildJoinUrl(String(code).toUpperCase()));
      session.joining = false;
      session.status = `In lobby for room ${String(code).toUpperCase()}.`;
      render();
    } catch (err) {
      session.error = err.message || String(err);
      session.status = 'Join failed — keep the dealer tab open, then try again.';
      session.joining = false;
      try {
        room.destroy();
      } catch {
        /* ignore */
      }
      render();
    }
  });
}

function renderLobbyGame() {
  const state = session.state;
  const isDealer = session.meta?.isHost;
  const me = state.players.find((p) => p.id === session.meta?.playerId);
  const joinUrl = buildJoinUrl(state.roomCode);

  return `
    ${brand()}
    ${statusBar()}
    <div class="lobby-grid">
      <section class="panel stack">
        <h2>Lobby</h2>
        <p>Share code <strong>${escapeHtml(state.roomCode)}</strong> or link:</p>
        <div class="row">
          <input readonly value="${escapeAttr(joinUrl)}" id="join-url" />
          <button type="button" id="btn-copy">Copy link</button>
        </div>
        <h3>Players</h3>
        <ul class="player-list">
          ${state.players
            .map(
              (p) => `
            <li>
              <span>
                <strong>${escapeHtml(p.name)}</strong>
                <span class="muted"> · ${p.role}${p.isLocalStub ? ' (local)' : ''}${p.id === me?.id ? ' · you' : ''}</span>
              </span>
              <span>${p.heroId ? escapeHtml(heroName(p.heroId)) : 'picking…'}</span>
            </li>`,
            )
            .join('')}
        </ul>
        ${
          isDealer
            ? `
          <div class="row">
            <button type="button" id="btn-add-local">Add local hero seat</button>
            <button class="primary" type="button" id="btn-start">Start Floor 1</button>
          </div>
          <div class="field">
            <label for="layout-mode">Room layout</label>
            <select id="layout-mode">
              <option value="random" selected>Auto-randomize connected layout</option>
              <option value="fixed">Fixed snake layout (manual placeholder)</option>
            </select>
            <p class="muted" style="margin:0.35rem 0 0">Random places the 14-tile recipe edge-to-edge with stairs ≥3 steps from entrance (rulebook §2). Fixed keeps a deterministic map when you want a known shape.</p>
          </div>
          <div class="field">
            <label for="theme">Floor theme</label>
            <select id="theme">
              <option value="">(random on start)</option>
              ${THEMES.map((t) => `<option value="${t.id}" ${state.themeId === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="boss">Boss</label>
            <select id="boss">
              <option value="">(random on start)</option>
              ${BOSSES.map((b) => `<option value="${b.id}" ${state.bossId === b.id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}
            </select>
          </div>
        `
            : `<p class="muted" data-coach="waiting-start">Waiting for the dealer to start the floor…</p>`
        }
      </section>
      <section class="panel stack" data-coach="hero-picks">
        <h2>Pick a hero</h2>
        <p>Four archetypes from the catalog. Dealer assigns local seats; remote heroes pick for themselves.</p>
        <div class="stack">
          ${HEROES.map((h) => {
            const taken = state.players.find((p) => p.heroId === h.id);
            const mine = me?.heroId === h.id;
            return `
              <div class="panel hero-pick-card" style="padding:0.7rem;box-shadow:none">
                ${renderHeroCard(h.id, { size: 'table' })}
                <div class="stack">
                  <div>
                    <strong style="color:${SUITS[h.preferredSuit]?.color || 'inherit'}">${escapeHtml(h.name)}</strong>
                    <span class="muted"> ${escapeHtml(h.title)}</span>
                  </div>
                  <p style="margin:0;font-size:0.88rem">${escapeHtml(h.perk.name)} — ${escapeHtml(h.perk.text)}</p>
                  <div class="row">
                    ${
                      isDealer
                        ? `<select data-assign="${h.id}">
                            <option value="">Assign to…</option>
                            ${state.players
                              .filter((p) => p.role === 'hero')
                              .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
                              .join('')}
                          </select>
                          <button type="button" data-assign-btn="${h.id}" ${taken && !mine ? 'disabled' : ''}>Assign</button>`
                        : `<button type="button" data-pick="${h.id}" ${taken && !mine ? 'disabled' : ''}>${mine ? 'Selected' : taken ? 'Taken' : 'Choose'}</button>`
                    }
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>
        <h3>Table log</h3>
        <div class="log">${state.log.map((l) => `<div>${escapeHtml(l)}</div>`).join('')}</div>
      </section>
    </div>
  `;
}

function wireLobbyGame() {
  document.getElementById('btn-copy')?.addEventListener('click', async () => {
    const url = document.getElementById('join-url')?.value;
    try {
      await navigator.clipboard.writeText(url);
      session.status = 'Join link copied.';
      render();
    } catch {
      session.status = 'Copy failed — select the link manually.';
      render();
    }
  });
  document.getElementById('btn-add-local')?.addEventListener('click', () => {
    room.dispatch({ type: 'add-local-hero', name: `Local ${session.state.players.length}` });
  });
  document.getElementById('btn-start')?.addEventListener('click', () => {
    const layoutMode = document.getElementById('layout-mode')?.value || 'random';
    room.dispatch({ type: 'start-floor', layoutMode });
  });
  document.getElementById('theme')?.addEventListener('change', (e) => {
    const themeId = e.target.value;
    if (themeId) room.dispatch({ type: 'set-theme', themeId });
  });
  document.getElementById('boss')?.addEventListener('change', (e) => {
    const bossId = e.target.value;
    if (bossId) room.dispatch({ type: 'set-boss', bossId });
  });
  document.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      room.dispatch({ type: 'pick-hero', heroId: btn.getAttribute('data-pick') });
    });
  });
  document.querySelectorAll('[data-assign-btn]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const heroId = btn.getAttribute('data-assign-btn');
      const select = document.querySelector(`select[data-assign="${heroId}"]`);
      const playerId = select?.value;
      if (!playerId) {
        session.error = 'Pick a hero seat to assign.';
        render();
        return;
      }
      room.dispatch({ type: 'pick-hero', heroId, playerId });
    });
  });
}

function wireTable() {
  document.querySelectorAll('[data-inspect-hero]').forEach((btn) => {
    btn.addEventListener('click', () => {
      session.inspectedHeroId = btn.getAttribute('data-inspect-hero');
      render();
    });
  });
  document.querySelectorAll('[data-move-x]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const x = Number(btn.getAttribute('data-move-x'));
      const y = Number(btn.getAttribute('data-move-y'));
      const state = session.state;
      const activeId = state.turnOrder[state.activeHeroIndex];
      const isDealer = session.meta?.isHost;
      const meId = session.meta?.playerId;
      if (isDealer && activeId !== meId) {
        room.dispatch({ type: 'move', x, y, playerId: activeId });
      } else {
        room.dispatch({ type: 'move', x, y });
      }
    });
  });
  document.getElementById('btn-end-turn')?.addEventListener('click', () => {
    const state = session.state;
    const activeId = state.turnOrder[state.activeHeroIndex];
    if (session.meta?.isHost && activeId !== session.meta.playerId) {
      room.dispatch({ type: 'end-turn', playerId: activeId });
    } else {
      room.dispatch({ type: 'end-turn' });
    }
  });
  wireTableLogHovers();
  document.getElementById('btn-boss-start')?.addEventListener('click', () => {
    room.dispatch({ type: 'start-boss-clash' });
  });
  document.getElementById('btn-unlock-stairs')?.addEventListener('click', () => {
    room.dispatch({ type: 'unlock-stairs', reason: 'Dealer unlocks stairs (Shiny Key / 5+ Zip or Brawn stunt).' });
  });
  document.getElementById('btn-end-floor')?.addEventListener('click', () => {
    room.dispatch({
      type: 'end-floor',
      message: `Dealer ends Floor ${session.state?.floorNumber || 1} — victory!`,
    });
  });
  document.getElementById('btn-draw-twist')?.addEventListener('click', () => {
    room.dispatch({ type: 'draw-twist', reason: 'Dealer draws Twist' });
  });
  document.getElementById('btn-theme-swap')?.addEventListener('click', () => {
    room.dispatch({ type: 'theme-swap-rooms' });
  });
  document.getElementById('btn-descend-floor')?.addEventListener('click', () => {
    room.dispatch({ type: 'descend-floor' });
  });
  document.querySelectorAll('[data-play-twist]').forEach((btn) => {
    btn.addEventListener('click', () => {
      room.dispatch({ type: 'play-twist', twistId: btn.getAttribute('data-play-twist') });
    });
  });
  document.querySelectorAll('[data-keep-loot]').forEach((btn) => {
    btn.addEventListener('click', () => {
      room.dispatch({
        type: 'resolve-pending',
        keepIndex: Number(btn.getAttribute('data-keep-loot')),
      });
    });
  });
  document.querySelectorAll('[data-event-choice]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const discardCardId = document.getElementById('event-boost-card')?.value || null;
      room.dispatch({
        type: 'resolve-pending',
        choice: btn.getAttribute('data-event-choice'),
        discardCardId,
      });
    });
  });
  document.querySelectorAll('[data-merchant-deal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const deal = btn.getAttribute('data-merchant-deal');
      const beltRaw = btn.getAttribute('data-merchant-belt');
      const slot = btn.getAttribute('data-merchant-slot');
      const rewardId = btn.getAttribute('data-merchant-reward');
      const action = { type: 'resolve-pending', deal };
      if (beltRaw !== null && beltRaw !== '') action.beltIndex = Number(beltRaw);
      if (slot) action.slot = slot;
      if (rewardId) action.rewardId = rewardId;
      room.dispatch(action);
    });
  });
  document.getElementById('btn-merchant-cancel')?.addEventListener('click', () => {
    room.dispatch({ type: 'resolve-pending', cancel: true });
  });
  document.querySelectorAll('[data-story-choice]').forEach((btn) => {
    btn.addEventListener('click', () => {
      room.dispatch({
        type: 'resolve-pending',
        choice: btn.getAttribute('data-story-choice'),
      });
    });
  });
  document.querySelectorAll('[data-belt-discard]').forEach((btn) => {
    btn.addEventListener('click', () => {
      room.dispatch({
        type: 'resolve-pending',
        discardIndex: Number(btn.getAttribute('data-belt-discard')),
      });
    });
  });
  const activeId = session.state.turnOrder[session.state.activeHeroIndex];
  const puppet = session.meta?.isHost && activeId !== session.meta.playerId;
  const withPlayer = (action) =>
    puppet ? { ...action, playerId: activeId } : action;
  document.getElementById('btn-vault')?.addEventListener('click', () => {
    room.dispatch(withPlayer({ type: 'interact', subtype: 'vault' }));
  });
  document.getElementById('btn-shrine')?.addEventListener('click', () => {
    room.dispatch(withPlayer({ type: 'interact', subtype: 'shrine' }));
  });
  document.getElementById('btn-descend-stairs')?.addEventListener('click', () => {
    room.dispatch({ type: 'descend-stairs' });
  });
  document.querySelectorAll('[data-revive]').forEach((btn) => {
    btn.addEventListener('click', () => {
      room.dispatch(
        withPlayer({
          type: 'interact',
          subtype: 'revive',
          targetPlayerId: btn.getAttribute('data-revive'),
        }),
      );
    });
  });
  document.getElementById('btn-hallway')?.addEventListener('click', () => {
    room.dispatch(withPlayer({ type: 'interact', subtype: 'hallway' }));
  });
  document.getElementById('btn-merchant')?.addEventListener('click', () => {
    room.dispatch(withPlayer({ type: 'interact', subtype: 'merchant' }));
  });
  document.getElementById('btn-story')?.addEventListener('click', () => {
    room.dispatch(withPlayer({ type: 'interact', subtype: 'story' }));
  });
  document.querySelectorAll('[data-use-belt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const beltIndex = Number(btn.getAttribute('data-use-belt'));
      const targetId = btn.getAttribute('data-belt-target');
      const ownerId = btn.getAttribute('data-belt-owner');
      const action = {
        type: 'interact',
        subtype: 'use-consumable',
        beltIndex,
      };
      if (targetId) action.targetPlayerId = targetId;
      room.dispatch(
        session.meta?.isHost && ownerId
          ? { ...action, playerId: ownerId }
          : withPlayer(action),
      );
    });
  });
  document.getElementById('btn-pry-jam')?.addEventListener('click', () => {
    room.dispatch(
      withPlayer({
        type: 'stunt',
        suit: 'brawn',
        target: 3,
        purpose: 'pry',
        reroll: true,
      }),
    );
  });
  document.querySelectorAll('[data-carry]').forEach((btn) => {
    btn.addEventListener('click', () => {
      session.carryingTargetId = btn.getAttribute('data-carry');
      render();
    });
  });
  document.querySelectorAll('[data-carry-x]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetPlayerId = session.carryingTargetId;
      if (!targetPlayerId) return;
      const x = Number(btn.getAttribute('data-carry-x'));
      const y = Number(btn.getAttribute('data-carry-y'));
      session.carryingTargetId = null;
      room.dispatch(withPlayer({ type: 'carry', targetPlayerId, x, y }));
    });
  });
  const cancelCarry = () => {
    session.carryingTargetId = null;
    render();
  };
  document.getElementById('btn-cancel-carry')?.addEventListener('click', cancelCarry);
  document.getElementById('btn-cancel-carry-tray')?.addEventListener('click', cancelCarry);
}

function heroName(id) {
  return HEROES.find((h) => h.id === id)?.name || id;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", '&#39;');
}
