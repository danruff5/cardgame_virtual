import './style.css';
import './ui/cards.css';
import './ui/coachmarks.css';
import { PeerRoom, readRoomFromUrl, buildJoinUrl } from './net/peerRoom.js';
import { dataInventory, HEROES, THEMES, BOSSES, SUITS } from './data/index.js';
import { adjacentOrthogonal, tilesConnect } from './game/state.js';
import {
  renderActionCard,
  renderHeroCard,
  renderGearChip,
  renderRoomTile,
  renderMonsterCard,
} from './ui/cardView.js';
import { ASSET, SUIT_META } from './data/artMeta.js';
import { isLegalPlay, isCramp, heroHasLegalPlay } from './game/clash.js';
import {
  bindCoachMenu,
  renderCoachUi,
  setCoachChangeHandler,
  syncCoachAfterRender,
} from './ui/coachmarks.js';

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
  } else if (session.state.phase === 'lobby') {
    app.innerHTML = renderLobbyGame();
    wireLobbyGame();
  } else {
    app.innerHTML = renderTable();
    wireTable();
  }
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
            ${state.phase !== 'victory' ? `<span class="pill" data-coach="actions-left">Actions left: <strong>${state.explorationActionsLeft}</strong></span>` : ''}
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
        ${renderPending(state, isDealer, meId)}
        ${renderRoomActions(state, isDealer, meId)}
        ${
          state.phase === 'clash' && state.clash ? renderClashPanel(state, isDealer, meId) : ''
        }
        <div class="row">
          ${
            (isDealer || meId === activeId) && state.phase === 'exploring' && !state.pending
              ? `<button type="button" id="btn-end-turn">End turn</button>`
              : ''
          }
        </div>
      </section>
      <section class="panel stack" data-coach="side-panel">
        <h2>${isDealer ? 'Dealer tools' : 'Your hero'}</h2>
        ${isDealer ? renderDealerTools(state) : ''}
        ${renderHeroPanels(state, meId, isDealer)}
        <h3>Log</h3>
        <div class="log">${state.log.map((l) => `<div>${escapeHtml(l)}</div>`).join('')}</div>
      </section>
    </div>
  `;
}

function clashPlayOptionsFor(hero, clash) {
  const opts = {};
  if (hero?.perk?.id === 'big-swing' && !hero.perkUsedThisClash) opts.bigSwing = true;
  if (hero?.perk?.id === 'improvised-zap' && !hero.perkUsedThisClash) opts.defensiveSparkAsAny = true;
  if (hero?.offhand?.id === 'G-17' && !hero.offhand.tapped) opts.forceParry = true;
  return opts;
}

function renderClashPanel(state, isDealer, meId) {
  const clash = state.clash;
  const hero = state.heroes[clash.heroPlayerId];
  const isMyClash = meId === clash.heroPlayerId;
  const canPlay = clash.whoseTurn === 'hero' && (isMyClash || isDealer);
  const canMonster = isDealer && clash.whoseTurn === 'monster';
  const activeColor = SUIT_META[clash.activeSuit]?.color || '#888';
  const fighterHand = hero?.hand || [];
  const showHand = isMyClash || isDealer;
  const playOpts = clashPlayOptionsFor(hero, clash);
  const fighters = (clash.fighters || [clash.heroPlayerId])
    .map((pid) => state.heroes[pid]?.name || pid)
    .join(', ');
  const confettiIdx = (hero?.belt || []).findIndex((b) => b.id === 'G-29');
  const hasCookie = hero?.offhand?.id === 'G-17' && !hero.offhand.tapped;

  return `
    <div class="panel clash-panel" data-coach="clash" style="box-shadow:none;border-color:rgba(217,72,59,0.45)">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <h3>${clash.isBoss ? 'Boss Clash' : 'Clash & Chain'}</h3>
          <p class="muted" style="margin:0">${escapeHtml(clash.note || '')}</p>
          ${
            clash.isBoss
              ? `<p class="muted" style="margin:0.25rem 0 0">Fighters: ${escapeHtml(fighters)} · Boss acts every ${clash.bossEvery || 1} hero turn(s)</p>`
              : ''
          }
        </div>
        <div class="pill" style="border-color:${activeColor}">
          Active: <strong style="color:${activeColor}">${escapeHtml(clash.activeSuit || '—')} ${clash.activeRank ?? ''}</strong>
          · Turn: <strong>${clash.whoseTurn === 'hero' ? escapeHtml(hero?.name || 'Hero') : escapeHtml(clash.monsterName)}</strong>
        </div>
      </div>
      <div class="vcard-row" style="margin:0.65rem 0;align-items:stretch">
        ${renderMonsterCard(clash.monsterId, {
          size: 'table',
          hp: clash.monsterHp,
          maxHp: clash.monsterMaxHp,
          isBoss: clash.isBoss,
        })}
        <div class="stack" style="min-width:120px">
          <div class="muted">Clash pile</div>
          ${
            clash.topCard
              ? renderActionCard(clash.topCard, { size: 'hand' })
              : '<span class="muted">Empty</span>'
          }
          <div class="pill">HP ${clash.monsterHp}/${clash.monsterMaxHp}</div>
          ${clash.trait ? `<p class="muted" style="max-width:14rem;font-size:0.8rem">${escapeHtml(clash.trait)}</p>` : ''}
        </div>
        ${renderHeroCard(hero?.heroId, { size: 'hand', downed: hero?.downed })}
      </div>
      ${
        showHand
          ? `<div>
              <h3>Combat hand ${clash.needsDraw && canPlay ? '<span class="muted">(will draw 1 on play)</span>' : ''}</h3>
              ${
                hero?.perk && !hero.perkUsedThisClash
                  ? `<p class="muted" style="margin:0 0 0.35rem">Perk ready: ${escapeHtml(hero.perk.name)} — ${escapeHtml(hero.perk.text)}</p>`
                  : ''
              }
              <div class="vcard-row hand">
                ${fighterHand
                  .map((c) => {
                    const legal =
                      canPlay &&
                      (isLegalPlay(c, clash) ||
                        isLegalPlay(c, clash, { bigSwing: playOpts.bigSwing && c.suit === 'brawn' }) ||
                        isLegalPlay(c, clash, {
                          defensiveSparkAsAny: playOpts.defensiveSparkAsAny && c.suit === 'spark',
                        }) ||
                        (hasCookie && isLegalPlay(c, clash, { forceParry: true })));
                    const cramp = isCramp(c);
                    return `<button type="button" class="clash-card-btn ${legal ? 'legal' : ''} ${cramp ? 'is-cramp' : ''}"
                      data-clash-card="${escapeAttr(c.id)}"
                      ${legal ? '' : 'disabled'}
                      title="${legal ? 'Play onto Clash Pile' : cramp ? 'Cramp! — use Stretch instead' : 'Illegal vs active Suit/Rank'}">
                      ${renderActionCard(c, { size: 'hand' })}
                    </button>`;
                  })
                  .join('') || '<span class="muted">Empty hand</span>'}
              </div>
            </div>`
          : `<p class="muted">${escapeHtml(hero?.name || 'Hero')}'s hand is private.</p>`
      }
      <div class="row" style="margin-top:0.6rem;flex-wrap:wrap">
        ${
          canPlay
            ? `
          <button type="button" id="btn-clash-desperation">Flip Desperation</button>
          <button type="button" id="btn-clash-cramp" ${fighterHand.some((c) => isCramp(c)) ? '' : 'disabled'}>Stretch (discard ≤2 Cramp!)</button>
          ${
            hasCookie
              ? `<label class="muted" style="display:inline-flex;gap:0.35rem;align-items:center">
                  <input type="checkbox" id="chk-cookie-parry" /> Tap Cookie-Tin as Parry
                </label>`
              : ''
          }
          ${
            confettiIdx >= 0
              ? `<button type="button" data-clash-belt="${confettiIdx}" data-belt-mode="daze">Confetti Bomb — Daze</button>
                 <button type="button" data-clash-belt="${confettiIdx}" data-belt-mode="flee">Confetti Bomb — Flee</button>`
              : ''
          }
          ${!heroHasLegalPlay(hero, clash, playOpts) && !(hasCookie && fighterHand.some((c) => !isCramp(c))) ? '<span class="muted">No legal plays — Desperation recommended.</span>' : ''}
        `
            : ''
        }
        ${
          canMonster
            ? `<button class="primary" type="button" id="btn-clash-monster">Resolve monster turn</button>
               <span class="muted">Monster hand: ${clash.monsterHand?.length ?? 0} cards</span>`
            : ''
        }
        ${
          isDealer
            ? `<button type="button" id="btn-clash-win">Force POOF!</button>
               <button type="button" id="btn-clash-flee">Force flee</button>`
            : ''
        }
        ${
          !canPlay && !canMonster && clash.whoseTurn === 'monster'
            ? `<p class="muted" data-coach="clash-wait">Waiting for dealer to resolve the monster turn…</p>`
            : ''
        }
        ${
          !canPlay && clash.whoseTurn === 'hero' && !isMyClash
            ? `<p class="muted" data-coach="clash-wait">Waiting for ${escapeHtml(hero?.name || 'hero')} to play…</p>`
            : ''
        }
      </div>
    </div>
  `;
}

function barrierBetween(state, a, b) {
  return (state.map.barriers || []).some(
    (bar) =>
      (bar.aKey === a.key && bar.bKey === b.key) ||
      (bar.aKey === b.key && bar.bKey === a.key),
  );
}

function renderMap(state, isDealer, meId) {
  const activeId = state.turnOrder[state.activeHeroIndex];
  const activeHero = state.heroes[activeId];
  const from = state.map.tiles.find((t) => t.key === activeHero?.roomKey);
  // During boss clash, any conscious hero not yet in the fight can move into the boss room.
  const myHero = state.heroes[meId];
  const canJoinBoss =
    state.phase === 'clash' &&
    state.clash?.isBoss &&
    myHero &&
    !myHero.downed &&
    !(state.clash.fighters || []).includes(meId);
  const dealerJoinIds = isDealer
    ? Object.entries(state.heroes)
        .filter(
          ([pid, h]) =>
            !h.downed && !(state.clash?.fighters || []).includes(pid),
        )
        .map(([pid]) => pid)
    : [];

  const canMove =
    (state.phase === 'exploring' &&
      state.explorationActionsLeft > 0 &&
      (isDealer || meId === activeId)) ||
    canJoinBoss ||
    (isDealer && state.phase === 'clash' && state.clash?.isBoss && dealerJoinIds.length);

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

      let moverFrom = from;
      let movable = false;
      if (state.phase === 'exploring' && canMove && moverFrom) {
        movable =
          adjacentOrthogonal(moverFrom, tile) &&
          tilesConnect(moverFrom, tile) &&
          !barrierBetween(state, moverFrom, tile) &&
          !state.clash &&
          !state.pending;
      } else if (state.phase === 'clash' && state.clash?.isBoss && tile.key === state.clash.roomKey) {
        if (canJoinBoss && myHero) {
          const myTile = state.map.tiles.find((t) => t.key === myHero.roomKey);
          movable =
            myTile &&
            adjacentOrthogonal(myTile, tile) &&
            tilesConnect(myTile, tile) &&
            !barrierBetween(state, myTile, tile);
        } else if (isDealer && dealerJoinIds.length) {
          // Dealer can click boss room to join the active puppetable hero nearest
          movable = true;
        }
      }

      let label = tile.faceUp ? shortRoomLabel(tile) : '???';
      if (tile.kind === 'stairs' && tile.faceUp) {
        label = tile.locked || !state.floor?.stairsUnlocked ? 'Stairs 🔒' : 'Stairs ✓';
      }
      if (tile.lurkingMonster) label = `${label} 👹`;
      const jammed = (state.map.barriers || []).some(
        (b) => b.aKey === tile.key || b.bKey === tile.key,
      );
      if (jammed && tile.faceUp) label = `${label} 🚪`;
      const stairsClass =
        tile.kind === 'stairs' && tile.faceUp
          ? state.floor?.stairsUnlocked && !tile.locked
            ? 'stairs-open'
            : 'stairs-locked'
          : '';
      cells.push(`
        <button type="button" class="map-cell with-art ${tile.faceUp ? 'face-up' : 'face-down'} ${tile.kind} ${stairsClass} ${movable ? 'clickable' : ''}"
          ${movable ? `data-move-x="${tile.x}" data-move-y="${tile.y}"` : 'disabled'}
          title="${escapeAttr(
            tile.faceUp
              ? tile.kind === 'stairs'
                ? state.floor?.stairsUnlocked
                  ? 'Unlocked — step here to finish the floor'
                  : 'Locked until Floor Boss is defeated (or Dealer unlocks)'
                : tile.lurkingMonster
                  ? `Lurking: ${tile.lurkingMonster.name}`
                  : tile.rule || tile.name
              : 'Face-down room',
          )}">
          ${renderRoomTile(tile, { size: 'mini', stairsUnlocked: state.floor?.stairsUnlocked })}
          <span class="map-label">${escapeHtml(label)}</span>
          ${pawns}
        </button>`);
    }
  }
  const jamNote =
    (state.map.barriers || []).length > 0
      ? `<p class="muted">Sticky Door Jam active (${state.map.barriers.length}) — pry with a Brawn 3+ Stunt.</p>`
      : '';
  return `${jamNote}<div class="map-grid" data-coach="map" style="grid-template-columns:repeat(${state.map.width}, auto)">${cells.join('')}</div>`;
}

function shortRoomLabel(tile) {
  const map = {
    entrance: 'Entrance',
    stairs: 'Stairs',
    shrine: 'Shrine',
    monster: 'Lair',
    boss: 'Boss',
    vault: 'Vault',
    trap: 'Trap',
    story: 'Story',
    hallway: 'Hall',
  };
  return map[tile.kind] || tile.name;
}

function renderDealerTools(state) {
  const stairsOpen = Boolean(state.floor?.stairsUnlocked);
  return `
    <div class="stack" data-coach="dealer-tools">
      <p class="muted">You are the authority host. Local stub seats can be moved with the map (dealer puppets the active turn).</p>
      <div class="inventory">
        Decks — action ${state.decks.actionCount ?? '—'} · loot ${state.decks.lootCount ?? '—'} ·
        events ${state.decks.eventsCount ?? '—'} · story/merchant ${state.decks.storyMerchantCount ?? '—'} ·
        monsters ${state.decks.monstersCount ?? '—'} · twists ${state.decks.twistsCount ?? '—'}
      </div>
      <p class="muted" style="margin:0">Layout: ${state.layoutMode || 'random'} · Story stack: ${(state.storyStack || []).length}</p>
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
              : `<div class="card-chip"><strong>${escapeHtml(t.name)}</strong><br/><span class="muted">${escapeHtml(t.effect || '')}</span>
                  <div class="row" style="margin-top:0.35rem">
                    <button type="button" data-play-twist="${escapeAttr(t.id)}">Play</button>
                  </div>
                </div>`,
          )
          .join('') || '<span class="muted">None</span>'}
      </div>
      <button type="button" id="btn-draw-twist">Draw Twist</button>
    </div>
  `;
}

function renderPending(state, isDealer, meId) {
  const pending = state.pending;
  if (!pending) return '';
  const mine = isDealer || pending.heroPlayerId === meId;
  if (pending.kind === 'vault') {
    return `
      <div class="panel" style="box-shadow:none;border-color:rgba(196,154,74,0.55)">
        <h3>Vault / trade — keep 1</h3>
        <p class="muted">Draw 2, keep 1 (rulebook §3). Excess belt slots auto-trim to 2.</p>
        <div class="row">
          ${(pending.options || [])
            .map(
              (opt, i) => `
            <button type="button" class="primary" data-keep-loot="${i}" ${mine ? '' : 'disabled'}>
              Keep ${escapeHtml(opt.name)}
            </button>`,
            )
            .join('')}
        </div>
      </div>`;
  }
  if (pending.kind === 'event') {
    const ev = pending.event;
    return `
      <div class="panel" style="box-shadow:none;border-color:rgba(180,90,90,0.45)">
        <h3>${escapeHtml(ev.title)}</h3>
        <p>${escapeHtml(ev.prompt)}</p>
        <ul>${(ev.choices || []).map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
        <div class="row">
          <button type="button" class="primary" data-event-choice="a" ${mine ? '' : 'disabled'}>Choice A</button>
          <button type="button" data-event-choice="b" ${mine ? '' : 'disabled'}>Choice B</button>
          <button type="button" data-event-choice="improvise" ${mine ? '' : 'disabled'}>Improvise</button>
        </div>
      </div>`;
  }
  if (pending.kind === 'story') {
    const st = pending.story;
    return `
      <div class="panel" style="box-shadow:none;border-color:rgba(120,140,200,0.45)">
        <h3>${escapeHtml(st.name)}</h3>
        <p>${escapeHtml(st.scene || '')}</p>
        <ul>${(st.choices || []).map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
        <div class="row">
          <button type="button" class="primary" data-story-choice="a" ${mine ? '' : 'disabled'}>Choice A</button>
          <button type="button" data-story-choice="b" ${mine ? '' : 'disabled'}>Choice B</button>
          <button type="button" data-story-choice="improvise" ${mine ? '' : 'disabled'}>Improvise</button>
        </div>
      </div>`;
  }
  return '';
}

function renderRoomActions(state, isDealer, meId) {
  if (state.phase !== 'exploring' || state.pending) return '';
  const activeId = state.turnOrder[state.activeHeroIndex];
  const canAct = isDealer || meId === activeId;
  if (!canAct || state.explorationActionsLeft < 1) return '';
  const hero = state.heroes[activeId];
  if (!hero || hero.downed) {
    // Still allow shrine revive by active hero? DOWNED can't act — dealer puppets ally
  }
  const tile = state.map.tiles.find((t) => t.key === hero?.roomKey);
  if (!tile?.faceUp) return '';
  const buttons = [];
  if (tile.kind === 'vault' && !tile.looted) {
    buttons.push(`<button type="button" id="btn-vault">Loot vault (1 Action)</button>`);
  }
  if (tile.kind === 'shrine') {
    if (!hero.shrineUsedThisFloor && !hero.downed) {
      buttons.push(`<button type="button" id="btn-shrine">Rest +3 HP (1 Action)</button>`);
    }
    const downedHere = Object.entries(state.heroes).filter(
      ([, h]) => h.downed && h.roomKey === tile.key,
    );
    for (const [pid, h] of downedHere) {
      buttons.push(
        `<button type="button" data-revive="${escapeAttr(pid)}">Revive ${escapeHtml(h.name)} (1 Action)</button>`,
      );
    }
  }
  if (tile.merchant) {
    buttons.push(
      `<button type="button" id="btn-merchant" title="${escapeAttr(tile.merchant.greeting || '')}">Trade with ${escapeHtml(tile.merchant.name)}</button>`,
    );
  }
  if (tile.kind === 'hallway' && !tile.hallwayEchoUsed) {
    buttons.push(`<button type="button" id="btn-hallway">Echo stunt — draw 1 (1 Action)</button>`);
  }
  const beltHeal = (hero.belt || []).findIndex((b) => {
    const g = b.id;
    return g === 'G-27' || g === 'G-28';
  });
  if (beltHeal >= 0) {
    buttons.push(`<button type="button" data-use-belt="${beltHeal}">Drink Fizz Potion (free)</button>`);
  }
  const downedAllies = Object.entries(state.heroes).filter(
    ([pid, h]) => h.downed && h.roomKey === tile.key && pid !== activeId,
  );
  if (!hero.downed) {
    buttons.push(`<button type="button" id="btn-stunt">Improvise Stunt (1 Action)</button>`);
  }
  if (!hero.downed && downedAllies.length && state.explorationActionsLeft >= 2) {
    for (const [pid, h] of downedAllies) {
      buttons.push(
        `<button type="button" data-carry="${escapeAttr(pid)}">Carry ${escapeHtml(h.name)} (2 Actions)</button>`,
      );
    }
  }
  if (!buttons.length) return '';
  return `<div class="row" style="flex-wrap:wrap">${buttons.join('')}</div>`;
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
          <div class="hero-pick-card">
            ${renderHeroCard(hero.heroId, { size: 'hand', downed: hero.downed })}
            <div>
              <div class="row" style="justify-content:space-between">
                <strong>${escapeHtml(hero.name)}</strong>
                <span class="pill">HP ${hero.hp}/${hero.maxHp}${hero.downed ? ' · DOWNED' : ''}</span>
              </div>
              <div class="muted">${escapeHtml(player?.name || pid)} · ${escapeHtml(hero.perk?.name || '')}</div>
              <div class="vcard-row" style="margin:0.45rem 0">
                ${hero.weapon ? renderGearChip(hero.weapon.id) : ''}
                ${hero.offhand ? renderGearChip(hero.offhand.id) : ''}
                ${hero.armor ? renderGearChip(hero.armor.id) : ''}
                ${(hero.belt || []).map((b) => renderGearChip(b.id)).join('')}
              </div>
            </div>
          </div>
          <h3 style="margin-top:0.5rem">Hand</h3>
          <div class="vcard-row hand">
            ${hand.map((c) => renderActionCard(c, { size: 'hand' })).join('') || '<span class="muted">Empty hand</span>'}
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
      const meId = session.meta?.playerId;
      // Boss join: prefer the clicking hero's own pawn if not already fighting
      if (state.phase === 'clash' && state.clash?.isBoss) {
        let joiner = meId;
        if (isDealer) {
          joiner =
            Object.keys(state.heroes).find(
              (pid) =>
                !state.heroes[pid].downed &&
                !(state.clash.fighters || []).includes(pid) &&
                state.heroes[pid].roomKey !== state.clash.roomKey,
            ) || meId;
        }
        room.dispatch({ type: 'move', x, y, playerId: joiner });
        return;
      }
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
  document.getElementById('btn-clash-win')?.addEventListener('click', () => {
    room.dispatch({ type: 'resolve-clash-stub', result: 'win' });
  });
  document.getElementById('btn-clash-flee')?.addEventListener('click', () => {
    room.dispatch({ type: 'resolve-clash-stub', result: 'flee' });
  });
  document.getElementById('btn-clash-monster')?.addEventListener('click', () => {
    room.dispatch({ type: 'clash-monster-turn' });
  });
  document.getElementById('btn-clash-desperation')?.addEventListener('click', () => {
    room.dispatch({ type: 'clash-desperation' });
  });
  document.getElementById('btn-clash-cramp')?.addEventListener('click', () => {
    room.dispatch({ type: 'clash-clear-cramp' });
  });
  document.querySelectorAll('[data-clash-card]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cardId = btn.getAttribute('data-clash-card');
      const clash = session.state.clash;
      const action = { type: 'clash-play', cardId };
      const hero = clash && session.state.heroes[clash.heroPlayerId];
      const card = hero?.hand?.find((c) => c.id === cardId);
      if (card?.type === 'wild' || card?.kind === 'wild') {
        action.wildSuit = hero?.preferredSuit || 'brawn';
      }
      if (document.getElementById('chk-cookie-parry')?.checked) {
        action.forceParry = true;
      }
      if (hero?.perk?.id === 'big-swing' && !hero.perkUsedThisClash && card?.suit === 'brawn') {
        action.useBigSwing = true;
      }
      if (hero?.perk?.id === 'improvised-zap' && !hero.perkUsedThisClash && card?.suit === 'spark') {
        action.useZap = true;
      }
      room.dispatch(action);
    });
  });
  document.querySelectorAll('[data-clash-belt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      room.dispatch({
        type: 'clash-use-belt',
        beltIndex: Number(btn.getAttribute('data-clash-belt')),
        mode: btn.getAttribute('data-belt-mode') || 'daze',
      });
    });
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
  document.getElementById('btn-draw-twist')?.addEventListener('click', () => {
    room.dispatch({ type: 'draw-twist', reason: 'Dealer draws Twist' });
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
      room.dispatch({
        type: 'resolve-pending',
        choice: btn.getAttribute('data-event-choice'),
      });
    });
  });
  document.querySelectorAll('[data-story-choice]').forEach((btn) => {
    btn.addEventListener('click', () => {
      room.dispatch({
        type: 'resolve-pending',
        choice: btn.getAttribute('data-story-choice'),
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
    const hero = session.state.heroes[activeId];
    if (!hero?.belt?.length) {
      session.error = 'Need a belt consumable to trade (digital proxy for merchant deal).';
      render();
      return;
    }
    room.dispatch(withPlayer({ type: 'interact', subtype: 'merchant', beltIndex: 0 }));
  });
  document.querySelectorAll('[data-use-belt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      room.dispatch(
        withPlayer({
          type: 'interact',
          subtype: 'use-consumable',
          beltIndex: Number(btn.getAttribute('data-use-belt')),
        }),
      );
    });
  });
  document.getElementById('btn-stunt')?.addEventListener('click', () => {
    const suit = window.prompt('Stunt suit (brawn/grit/zip/spark)?', 'zip') || 'zip';
    const target = Number(window.prompt('Target number (3 easy / 4 tricky / 5 heroic)?', '4')) || 4;
    const purpose =
      window.prompt('Purpose: generic / peek / unlock-stairs / pry / bribe / hallway?', 'generic') ||
      'generic';
    room.dispatch(
      withPlayer({
        type: 'stunt',
        suit: suit.toLowerCase(),
        target,
        purpose,
        reroll: true,
      }),
    );
  });
  document.querySelectorAll('[data-carry]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetPlayerId = btn.getAttribute('data-carry');
      const xy = window.prompt('Carry to tile as x,y (e.g. 1,0)');
      if (!xy) return;
      const [x, y] = xy.split(',').map((n) => Number(n.trim()));
      if (!Number.isInteger(x) || !Number.isInteger(y)) return;
      room.dispatch(withPlayer({ type: 'carry', targetPlayerId, x, y }));
    });
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
