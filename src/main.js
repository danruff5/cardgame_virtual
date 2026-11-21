import './style.css';
import { PeerRoom, readRoomFromUrl, buildJoinUrl } from './net/peerRoom.js';
import { dataInventory, HEROES, THEMES, BOSSES, SUITS } from './data/index.js';
import { adjacentOrthogonal } from './game/state.js';

const app = document.querySelector('#app');

const session = {
  room: null,
  state: null,
  meta: null,
  status: 'Ready.',
  error: '',
  name: localStorage.getItem('cbc-name') || '',
  joining: false,
};

const room = new PeerRoom({
  onState: (state, meta) => {
    session.state = state;
    session.meta = meta;
    session.error = '';
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

const pendingRoom = readRoomFromUrl();
render();

function render() {
  if (!session.state) {
    app.innerHTML = renderLobbyShell();
    wireLobby();
    return;
  }
  if (session.state.phase === 'lobby') {
    app.innerHTML = renderLobbyGame();
    wireLobbyGame();
    return;
  }
  app.innerHTML = renderTable();
  wireTable();
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
          events ${inv.events} · merchants ${inv.merchants} · stories ${inv.stories} · themes ${inv.themes} · twists ${inv.twists}
        </div>
        <p class="muted">MVP: lobby sync + exploration stub + clash placeholder. Full Clash &amp; Chain combat UI is next.</p>
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
            : `<p class="muted">Waiting for the dealer to start the floor…</p>`
        }
      </section>
      <section class="panel stack">
        <h2>Pick a hero</h2>
        <p>Four archetypes from the catalog. Dealer assigns local seats; remote heroes pick for themselves.</p>
        <div class="stack">
          ${HEROES.map((h) => {
            const taken = state.players.find((p) => p.heroId === h.id);
            const mine = me?.heroId === h.id;
            return `
              <div class="panel" style="padding:0.7rem;box-shadow:none">
                <strong style="color:${SUITS[h.preferredSuit]?.color || 'inherit'}">${escapeHtml(h.name)}</strong>
                <span class="muted"> ${escapeHtml(h.title)}</span>
                <p style="margin:0.35rem 0;font-size:0.88rem">${escapeHtml(h.perk.name)} — ${escapeHtml(h.perk.text)}</p>
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
    room.dispatch({ type: 'start-floor' });
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

function renderTable() {
  const state = session.state;
  const isDealer = session.meta?.isHost;
  const meId = session.meta?.playerId;
  const myHero = state.heroes[meId];
  const activeId = state.turnOrder[state.activeHeroIndex];
  const activePlayer = state.players.find((p) => p.id === activeId);
  const theme = THEMES.find((t) => t.id === state.themeId);
  const boss = BOSSES.find((b) => b.id === state.bossId);

  return `
    ${brand()}
    ${statusBar()}
    <div class="game-layout">
      <section class="panel stack">
        <div class="row" style="justify-content:space-between">
          <div>
            <h2>Floor 1 map</h2>
            <p class="muted" style="margin:0">${escapeHtml(theme?.name || 'Theme')} · Boss: ${escapeHtml(boss?.name || '?')} · Phase: <strong>${escapeHtml(state.phase)}</strong></p>
          </div>
          <div class="row">
            <span class="pill">Stairs: <strong>${state.floor?.stairsUnlocked ? 'UNLOCKED' : 'locked'}</strong></span>
            ${state.phase !== 'victory' ? `<span class="pill">Actions left: <strong>${state.explorationActionsLeft}</strong></span>` : ''}
          </div>
        </div>
        ${
          state.phase === 'victory'
            ? `<div class="panel" style="box-shadow:none;border-color:rgba(111,158,122,0.55)">
                <h3>Floor 1 complete!</h3>
                <p>The Spiral Slide is open. Celebrate the ~30-minute checkpoint, or prep Floor 2 later.</p>
              </div>`
            : `<p>Active: <strong>${escapeHtml(activePlayer?.name || '—')}</strong>${state.phase === 'clash' ? ' · in clash!' : ''}${
                state.floor?.stairsUnlocked
                  ? ' · Move onto the <strong>Stairway Down</strong> to finish.'
                  : ''
              }</p>`
        }
        ${renderMap(state, isDealer, meId)}
        ${
          state.phase === 'clash' && state.clash
            ? `
          <div class="panel" style="box-shadow:none;border-color:rgba(217,72,59,0.35)">
            <h3>${state.clash.isBoss ? 'Boss clash stub' : 'Clash stub'}</h3>
            <p><strong>${escapeHtml(state.clash.monsterName)}</strong> — HP ${state.clash.monsterHp}/${state.clash.monsterMaxHp} · Base ${state.clash.baseDmg} · Cunning ${state.clash.cunning}</p>
            <p class="muted">${escapeHtml(state.clash.note)}</p>
            ${
              isDealer
                ? `<div class="row">
                    <button class="primary" type="button" id="btn-clash-win">Resolve: Hero wins (POOF!)</button>
                    <button type="button" id="btn-clash-flee">Resolve: Flee</button>
                  </div>`
                : `<p class="muted">Waiting on dealer to resolve this stub clash…</p>`
            }
          </div>`
            : ''
        }
        <div class="row">
          ${
            (isDealer || meId === activeId) && state.phase === 'exploring'
              ? `<button type="button" id="btn-end-turn">End turn</button>`
              : ''
          }
        </div>
      </section>
      <section class="panel stack">
        <h2>${isDealer ? 'Dealer tools' : 'Your hero'}</h2>
        ${isDealer ? renderDealerTools(state) : ''}
        ${renderHeroPanels(state, meId, isDealer)}
        <h3>Log</h3>
        <div class="log">${state.log.map((l) => `<div>${escapeHtml(l)}</div>`).join('')}</div>
      </section>
    </div>
  `;
}

function renderMap(state, isDealer, meId) {
  const activeId = state.turnOrder[state.activeHeroIndex];
  const activeHero = state.heroes[activeId];
  const from = state.map.tiles.find((t) => t.key === activeHero?.roomKey);
  const canMove =
    state.phase === 'exploring' &&
    state.explorationActionsLeft > 0 &&
    (isDealer || meId === activeId);

  const byKey = new Map(state.map.tiles.map((t) => [t.key, t]));
  const cells = [];
  for (let y = 0; y < state.map.height; y += 1) {
    for (let x = 0; x < state.map.width; x += 1) {
      const tile = byKey.get(`t-${x}-${y}`);
      if (!tile) {
        cells.push(`<div class="map-cell" style="visibility:hidden"></div>`);
        continue;
      }
      const pawns = Object.entries(state.heroes)
        .filter(([, h]) => h.roomKey === tile.key)
        .map(([pid], i) => {
          const color = SUITS[state.heroes[pid].preferredSuit]?.color || '#ccc';
          return `<span class="pawn" style="left:${6 + i * 14}px;background:${color}" title="${escapeAttr(state.players.find((p) => p.id === pid)?.name || '')}"></span>`;
        })
        .join('');
      const movable =
        canMove && from && adjacentOrthogonal(from, tile) && !state.clash;
      let label = tile.faceUp ? tile.name : '???';
      if (tile.kind === 'stairs' && tile.faceUp) {
        label = tile.locked || !state.floor?.stairsUnlocked ? 'Stairs 🔒' : 'Stairs ✓';
      }
      const stairsClass =
        tile.kind === 'stairs' && tile.faceUp
          ? state.floor?.stairsUnlocked && !tile.locked
            ? 'stairs-open'
            : 'stairs-locked'
          : '';
      cells.push(`
        <button type="button" class="map-cell ${tile.faceUp ? 'face-up' : 'face-down'} ${tile.kind} ${stairsClass} ${movable ? 'clickable' : ''}"
          ${movable ? `data-move-x="${tile.x}" data-move-y="${tile.y}"` : 'disabled'}
          title="${escapeAttr(
            tile.faceUp
              ? tile.kind === 'stairs'
                ? state.floor?.stairsUnlocked
                  ? 'Unlocked — step here to finish the floor'
                  : 'Locked until Floor Boss is defeated (or Dealer unlocks)'
                : tile.rule || tile.name
              : 'Face-down room',
          )}">
          <span>${escapeHtml(label)}</span>
          ${pawns}
        </button>`);
    }
  }
  return `<div class="map-grid" style="grid-template-columns:repeat(${state.map.width}, auto)">${cells.join('')}</div>`;
}

function renderDealerTools(state) {
  const stairsOpen = Boolean(state.floor?.stairsUnlocked);
  return `
    <div class="stack">
      <p class="muted">You are the authority host. Local stub seats can be moved with the map (dealer puppets the active turn).</p>
      <div class="inventory">
        Decks — action ${state.decks.actionCount ?? '—'} · desperation ${state.decks.desperationCount ?? '—'} ·
        monsters ${state.decks.monstersCount ?? '—'} · twists ${state.decks.twistsCount ?? '—'}
      </div>
      <h3>Floor progress</h3>
      <p class="muted" style="margin:0">Boss defeated: ${state.floor?.bossDefeated ? 'yes' : 'no'} · Stairs: ${stairsOpen ? 'unlocked' : 'locked'} · Key: ${state.floor?.shinyKey ? 'yes' : 'no'}</p>
      <div class="row">
        <button type="button" id="btn-unlock-stairs" ${stairsOpen || state.phase === 'victory' ? 'disabled' : ''}>Unlock stairs (key / 5+ stunt)</button>
        <button class="primary" type="button" id="btn-end-floor" ${state.phase === 'victory' ? 'disabled' : ''}>End floor / victory</button>
      </div>
      <p class="muted">Boss <strong>Resolve: Hero wins</strong> also unlocks stairs. Heroes then move onto the Stairway Down — or use <strong>End floor</strong> to wrap up.</p>
      <div class="field">
        <label for="dealer-note">Narrate / note</label>
        <input id="dealer-note" maxlength="120" placeholder="The cocoa smells suspicious…" />
      </div>
      <button type="button" id="btn-dealer-log">Push to log</button>
      <h3>Twist hand</h3>
      <div class="hand">
        ${(state.decks.twistHand || [])
          .map((t) =>
            t.hidden
              ? `<div class="card-chip hidden">Twist</div>`
              : `<div class="card-chip"><strong>${escapeHtml(t.name)}</strong><br/><span class="muted">${escapeHtml(t.effect || '')}</span></div>`,
          )
          .join('') || '<span class="muted">None</span>'}
      </div>
    </div>
  `;
}

function renderHeroPanels(state, meId, isDealer) {
  const entries = Object.entries(state.heroes);
  return entries
    .map(([pid, hero]) => {
      const player = state.players.find((p) => p.id === pid);
      const showHand = pid === meId || (isDealer && player?.isLocalStub);
      const hand = showHand
        ? hero.hand
        : hero.hand.map((c) => ({ ...c, hidden: true }));
      return `
        <div class="panel" style="box-shadow:none;padding:0.7rem">
          <div class="row" style="justify-content:space-between">
            <strong>${escapeHtml(hero.name)}</strong>
            <span class="pill">HP ${hero.hp}/${hero.maxHp}${hero.downed ? ' · DOWNED' : ''}</span>
          </div>
          <div class="muted">${escapeHtml(player?.name || pid)} · ${escapeHtml(hero.perk?.name || '')}</div>
          <div class="gear-row" style="margin:0.4rem 0">
            ${hero.weapon ? `<span>◄ ${escapeHtml(hero.weapon.name)}</span>` : ''}
            ${hero.offhand ? `<span>► ${escapeHtml(hero.offhand.name)}</span>` : ''}
            ${hero.armor ? `<span>▼ ${escapeHtml(hero.armor.name)}</span>` : ''}
            ${(hero.belt || []).map((b) => `<span>Belt: ${escapeHtml(b.name)}</span>`).join('')}
          </div>
          <div class="hand">
            ${hand
              .map((c) => {
                if (c.hidden) return `<div class="card-chip hidden">🂠</div>`;
                const suitClass = c.suit || c.type || '';
                return `<div class="card-chip ${suitClass}"><strong>${escapeHtml(c.name || c.title || c.id)}</strong></div>`;
              })
              .join('') || '<span class="muted">Empty hand</span>'}
          </div>
        </div>`;
    })
    .join('');
}

function wireTable() {
  document.querySelectorAll('[data-move-x]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const x = Number(btn.getAttribute('data-move-x'));
      const y = Number(btn.getAttribute('data-move-y'));
      const state = session.state;
      const activeId = state.turnOrder[state.activeHeroIndex];
      const isDealer = session.meta?.isHost;
      if (isDealer && activeId !== session.meta.playerId) {
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
  document.getElementById('btn-clash-win')?.addEventListener('click', () => {
    room.dispatch({ type: 'resolve-clash-stub', result: 'win' });
  });
  document.getElementById('btn-clash-flee')?.addEventListener('click', () => {
    room.dispatch({ type: 'resolve-clash-stub', result: 'flee' });
  });
  document.getElementById('btn-dealer-log')?.addEventListener('click', () => {
    const message = document.getElementById('dealer-note')?.value?.trim();
    if (message) room.dispatch({ type: 'dealer-log', message });
  });
  document.getElementById('btn-unlock-stairs')?.addEventListener('click', () => {
    room.dispatch({ type: 'unlock-stairs', reason: 'Dealer unlocks stairs (Shiny Key / 5+ Zip or Brawn stunt).' });
  });
  document.getElementById('btn-end-floor')?.addEventListener('click', () => {
    room.dispatch({ type: 'end-floor', message: 'Dealer ends Floor 1 — victory!' });
  });
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
