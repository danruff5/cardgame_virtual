import { THEMES, BOSSES, SUITS, getGear } from '../data/index.js';
import { adjacentOrthogonal, tilesConnect } from '../game/state.js';
import { bossGather } from '../game/boss.js';
import {
  renderActionCard,
  renderHeroCard,
  renderGearChip,
  renderRoomTile,
  renderMonsterCard,
  hoverTipHtml,
} from './cardView.js';
import { formatCombatLogLine } from './clashModal.js';

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escAttr(s) {
  return esc(s).replaceAll("'", '&#39;');
}

function shortRoomLabel(tile) {
  if (!tile) return '—';
  const map = {
    entrance: 'Entrance',
    stairs: 'Stairs',
    shrine: 'Shrine',
    monster: 'Lair',
    boss: 'Boss',
    vault: 'Vault',
    trap: 'Trap',
    merchant: 'Merchant',
    hallway: 'Hall',
  };
  return map[tile.kind] || tile.name;
}

/**
 * Pick which Hero sits in the right-rail focus slot.
 * Heroes default to themselves; the Dealer follows the active turn Hero.
 * Clicking any card in the Party Switcher overrides the focus until reset.
 */
export function resolveFocusedHeroId(state, { isDealer = false, meId = null, inspectedHeroId = null } = {}) {
  const heroes = state?.heroes || {};
  if (inspectedHeroId && heroes[inspectedHeroId]) return inspectedHeroId;
  const activeId = state?.turnOrder?.[state?.activeHeroIndex];
  if (!isDealer && meId && heroes[meId]) return meId;
  if (activeId && heroes[activeId]) return activeId;
  return Object.keys(heroes)[0] || null;
}

function hpMeter({ label, hp, maxHp, kind = 'hero' }) {
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100))) : 0;
  return `
    <div class="table-hp ${escAttr(kind)}">
      <div class="table-hp-label">
        <span>${esc(label)}</span>
        <strong>${hp}/${maxHp}</strong>
      </div>
      <div class="table-hp-track">
        <div class="table-hp-fill" style="width:${pct}%"></div>
      </div>
    </div>`;
}

function barrierBetween(state, a, b) {
  return (state.map?.barriers || []).some(
    (bar) =>
      (bar.aKey === a.key && bar.bKey === b.key) ||
      (bar.aKey === b.key && bar.bKey === a.key),
  );
}

function jammedDirs(state, tile, byKey) {
  const dirs = [];
  for (const b of state.map?.barriers || []) {
    const otherKey = b.aKey === tile.key ? b.bKey : b.bKey === tile.key ? b.aKey : null;
    if (!otherKey) continue;
    const other = byKey.get(otherKey);
    if (!other) continue;
    const dx = other.x - tile.x;
    const dy = other.y - tile.y;
    if (dx === 0 && dy === -1) dirs.push('n');
    else if (dx === 1 && dy === 0) dirs.push('e');
    else if (dx === 0 && dy === 1) dirs.push('s');
    else if (dx === -1 && dy === 0) dirs.push('w');
  }
  return dirs;
}

function renderDealerBar(state) {
  const stairsOpen = Boolean(state.floor?.stairsUnlocked);
  const victory = state.phase === 'victory';
  const decks = state.decks || {};
  const twists = decks.twistHand || [];
  const twistHtml = twists.length
    ? twists
        .map((t) =>
          t.hidden
            ? `<div class="dealer-twist-chip is-hidden"><span>Twist</span></div>`
            : `<div class="dealer-twist-chip">
                <span class="dealer-twist-name">${esc(t.name)}</span>
                <button type="button" class="dealer-twist-play" data-play-twist="${escAttr(t.id)}">Play</button>
                ${hoverTipHtml(t.name, t.effect || '', '')}
              </div>`,
        )
        .join('')
    : '<span class="muted dealer-empty-twist">No Twists held</span>';

  return `
    <div class="dealer-bar" data-coach="dealer-tools">
      <div class="dealer-bar-group dealer-twists">
        <button type="button" id="btn-draw-twist">Draw Twist</button>
        <div class="dealer-twist-tray">${twistHtml}</div>
      </div>
      <div class="dealer-bar-group dealer-controls">
        <button type="button" id="btn-unlock-stairs" ${stairsOpen || victory ? 'disabled' : ''}>Unlock Stairs</button>
        <button class="primary" type="button" id="btn-end-floor" ${victory ? 'disabled' : ''}>End Floor</button>
        <span class="dealer-decks" title="Remaining deck counts">
          Act ${decks.actionCount ?? '—'} · Loot ${decks.lootCount ?? '—'} · Evt ${decks.eventsCount ?? '—'} · Mon ${decks.monstersCount ?? '—'} · Merch ${decks.merchantsCount ?? '—'} · ${esc(state.layoutMode || 'random')}
        </span>
      </div>
    </div>`;
}

function renderBossGatherBar(state, isDealer, meId) {
  const gather = bossGather(state);
  if (!gather.waiting) return '';
  const names = gather.heroIds.map((pid) => state.heroes[pid]?.name || pid);
  const inside = gather.heroIds.includes(meId);
  const canStart = !state.pending && gather.heroIds.length > 0 && (isDealer || inside);
  const count = gather.heroIds.length;
  let hint = '';
  if (!count) {
    hint = 'Move a Hero into the chamber to start.';
  } else if (!isDealer && !inside) {
    hint = 'Move into the Boss Chamber to start, or join later next door.';
  } else if (state.pending) {
    hint = 'Resolve the room prompt first.';
  }
  return `
    <div class="boss-gather-bar" data-coach="boss-gather">
      <div class="boss-gather-mini">
        ${renderMonsterCard(gather.boss.id, { size: 'mini', isBoss: true })}
      </div>
      <div class="boss-gather-meta">
        <strong>${esc(gather.boss.name)} waits</strong>
        <span class="muted">
          In chamber: <strong>${count ? esc(names.join(', ')) : 'none'}</strong> · ${gather.projectedHp} HP (+3/extra Hero)
        </span>
        ${hint ? `<span class="muted boss-gather-hint">${esc(hint)}</span>` : ''}
      </div>
      <button class="primary" type="button" id="btn-boss-start" ${canStart ? '' : 'disabled'}>
        Start Boss fight${count ? ` (${count})` : ''}
      </button>
    </div>`;
}

function renderMap(state, isDealer, meId, activeCarryId = null, carryingHero = null) {
  const activeId = state.turnOrder?.[state.activeHeroIndex];
  const activeHero = state.heroes?.[activeId];
  const from = state.map.tiles.find((t) => t.key === activeHero?.roomKey);
  const canMove =
    state.phase === 'exploring' &&
    state.explorationActionsLeft > 0 &&
    (isDealer || meId === activeId);

  const byKey = new Map(state.map.tiles.map((t) => [t.key, t]));
  const width = state.map.width || 1;
  const height = state.map.height || 1;
  const cells = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tile = byKey.get(`t-${x}-${y}`);
      if (!tile) {
        cells.push(`<div class="map-cell map-empty" style="visibility:hidden"></div>`);
        continue;
      }

      const pawns = Object.entries(state.heroes || {})
        .filter(([, h]) => h.roomKey === tile.key)
        .map(([pid, h]) => {
          const color = SUITS[h.preferredSuit]?.color || '#ccc';
          const playerName = state.players?.find((p) => p.id === pid)?.name || h.name;
          const initial = (h.name || '?').trim().charAt(0).toUpperCase();
          return `<span class="pawn ${pid === activeId ? 'is-active-pawn' : ''} ${h.downed ? 'is-downed-pawn' : ''}" style="background:${color}" title="${escAttr(`${h.name} (${playerName})${h.downed ? ' · DOWNED' : ''}`)}">${esc(initial)}</span>`;
        })
        .join('');

      const adjReachable = Boolean(
        from &&
          adjacentOrthogonal(from, tile) &&
          tilesConnect(from, tile) &&
          !barrierBetween(state, from, tile) &&
          !state.clash &&
          !state.pending,
      );
      const moveCost =
        activeHero?.perk?.id === 'shortcut-tiptoe' &&
        tile.faceUp &&
        tile.cleared &&
        !['monster', 'boss', 'trap'].includes(tile.kind)
          ? 0.5
          : 1;
      const carryable = Boolean(activeCarryId && adjReachable);
      const movable = Boolean(
        !activeCarryId &&
          canMove &&
          adjReachable &&
          (state.explorationActionsLeft ?? 0) >= moveCost,
      );
      const interactive = carryable || movable;

      let label = tile.faceUp ? shortRoomLabel(tile) : '???';
      if (tile.kind === 'stairs' && tile.faceUp) {
        label = tile.locked || !state.floor?.stairsUnlocked ? 'Stairs 🔒' : 'Stairs ✓';
      }
      if (tile.kind === 'boss' && tile.faceUp && !tile.cleared) label = 'Boss ⚔';
      if (tile.lurkingMonster) label = `${label} 👹`;

      const jams = jammedDirs(state, tile, byKey);
      const jamHtml = jams
        .map(
          (dir) =>
            `<span class="door-jam door-jam-${dir}" title="Sticky Door Jam — pry with Brawn 3+"></span>`,
        )
        .join('');

      const stairsClass =
        tile.kind === 'stairs' && tile.faceUp
          ? state.floor?.stairsUnlocked && !tile.locked
            ? 'stairs-open'
            : 'stairs-locked'
          : '';
      const currentClass = tile.key === activeHero?.roomKey ? 'is-current' : '';
      const targetClass = carryable ? 'is-carry-target clickable' : movable ? 'clickable' : '';
      const targetAttrs = carryable
        ? `data-carry-x="${tile.x}" data-carry-y="${tile.y}"`
        : movable
          ? `data-move-x="${tile.x}" data-move-y="${tile.y}"`
          : 'disabled';
      const titleText = carryable
        ? `Carry ${carryingHero?.name || 'ally'} here (2 Actions)`
        : tile.faceUp
          ? tile.kind === 'stairs'
            ? state.floor?.stairsUnlocked
              ? 'Unlocked — step here to finish the floor'
              : 'Locked until Floor Boss is defeated (or Dealer unlocks)'
            : tile.lurkingMonster
              ? `Lurking: ${tile.lurkingMonster.name}`
              : tile.rule || tile.name
          : 'Face-down room';

      cells.push(`
        <button type="button"
          class="map-cell with-art ${tile.faceUp ? 'face-up' : 'face-down'} ${tile.kind} ${stairsClass} ${currentClass} ${targetClass}"
          data-row="${y}"
          data-col="${x}"
          ${x === width - 1 ? 'data-col-last="true"' : ''}
          ${interactive ? targetAttrs : 'disabled'}
          title="${escAttr(titleText)}">
          ${renderRoomTile(tile, { size: 'mini', stairsUnlocked: state.floor?.stairsUnlocked })}
          ${jamHtml}
          <span class="map-label">${escapeHtml(label)}</span>
          ${pawns ? `<span class="pawn-row">${pawns}</span>` : ''}
        </button>`);
    }
  }

  return `
    <div class="map-grid"
      data-coach="map"
      style="--map-cols:${width};--map-rows:${height};grid-template-columns:repeat(${width}, var(--tile-size))">
      ${cells.join('')}
    </div>`;
}

function escapeHtml(s) {
  return esc(s);
}

function renderPendingOverlay(state, isDealer, meId) {
  const pending = state.pending;
  if (!pending) return '';
  const mine = isDealer || pending.heroPlayerId === meId;
  const targetHero = state.heroes?.[pending.heroPlayerId];

  if (pending.kind === 'vault') {
    const optionsHtml = (pending.options || [])
      .map((opt, i) => {
        const gid = opt.gearId || opt.id;
        const gearDef = getGear(gid);
        const ruleText = gearDef?.rule || opt.rule || '';
        return `
          <div class="vault-option">
            <div class="vault-option-card">${renderGearChip(gid, { size: 'hand' })}</div>
            <div class="vault-option-info">
              <strong>${esc(opt.name)}</strong>
              ${ruleText ? `<span class="muted">${esc(ruleText)}</span>` : ''}
              <button type="button" class="primary" data-keep-loot="${i}" ${mine ? '' : 'disabled'}>
                Keep ${esc(opt.name)}
              </button>
            </div>
          </div>`;
      })
      .join('');
    return `
      <div class="table-prompt-overlay" role="dialog" aria-label="Vault loot choice">
        <div class="table-prompt-card is-vault">
          <div class="table-prompt-head">
            <h3>Vault / Trade — keep 1</h3>
            <span class="muted">${esc(targetHero?.name || 'Hero')} · Draw 2, keep 1 (belt trims to 2)</span>
          </div>
          <div class="vault-options">${optionsHtml}</div>
          ${!mine ? '<p class="muted table-prompt-wait">Waiting for the active Hero to pick loot…</p>' : ''}
        </div>
      </div>`;
  }

  if (pending.kind === 'event') {
    const ev = pending.event;
    return `
      <div class="table-prompt-overlay" role="dialog" aria-label="${escAttr(ev.title)}">
        <div class="table-prompt-card is-event">
          <div class="table-prompt-head">
            <h3>${esc(ev.title)}</h3>
            <span class="muted">${esc(targetHero?.name || 'Hero')}</span>
          </div>
          <p class="table-prompt-copy">${esc(ev.prompt)}</p>
          <ul class="table-prompt-choices">
            ${(ev.choices || []).map((c) => `<li>${esc(c)}</li>`).join('')}
          </ul>
          <div class="table-prompt-actions">
            <button type="button" class="primary" data-event-choice="a" ${mine ? '' : 'disabled'}>Choice A</button>
            <button type="button" data-event-choice="b" ${mine ? '' : 'disabled'}>Choice B</button>
          </div>
          ${!mine ? '<p class="muted table-prompt-wait">Waiting for the active Hero to choose…</p>' : ''}
        </div>
      </div>`;
  }

  return '';
}

function renderRoomActions(state, isDealer, meId, activeCarryId = null, carryingHero = null) {
  if (state.phase !== 'exploring' || state.pending) return '';
  const activeId = state.turnOrder?.[state.activeHeroIndex];
  const canAct = isDealer || meId === activeId;
  if (!canAct) return '';

  const hero = state.heroes?.[activeId];
  const tile = state.map.tiles.find((t) => t.key === hero?.roomKey);
  const buttons = [];

  if (hero?.downed) {
    buttons.push(
      `<p class="muted table-downed-note">${esc(hero.name)} is DOWNED — end turn so an ally can carry or revive you.</p>`,
    );
  } else if (activeCarryId && carryingHero) {
    buttons.push(
      `<button type="button" id="btn-cancel-carry-tray">Cancel carry (${esc(carryingHero.name)})</button>`,
    );
  } else {
    if (tile?.faceUp && state.explorationActionsLeft >= 1) {
      if (tile.kind === 'vault' && !tile.looted) {
        buttons.push(`<button type="button" class="primary" id="btn-vault">Loot vault (1 Action)</button>`);
      }
      if (tile.kind === 'shrine') {
        if (!hero.shrineUsedThisFloor) {
          buttons.push(`<button type="button" class="primary" id="btn-shrine">Rest +3 HP (1 Action)</button>`);
        }
        const downedHere = Object.entries(state.heroes || {}).filter(
          ([, h]) => h.downed && h.roomKey === tile.key,
        );
        for (const [pid, h] of downedHere) {
          buttons.push(
            `<button type="button" class="primary" data-revive="${escAttr(pid)}">Revive ${esc(h.name)} (1 Action)</button>`,
          );
        }
      }
      if (tile.merchant) {
        buttons.push(
          `<button type="button" id="btn-merchant" title="${escAttr(tile.merchant.greeting || '')}">Trade with ${esc(tile.merchant.name)}</button>`,
        );
      }
      if (tile.kind === 'hallway' && !tile.hallwayEchoUsed) {
        buttons.push(`<button type="button" id="btn-hallway">Echo — draw 1 (1 Action)</button>`);
      }
      const jammedHere = (state.map?.barriers || []).some(
        (b) => b.aKey === tile.key || b.bKey === tile.key,
      );
      if (jammedHere) {
        buttons.push(`<button type="button" id="btn-pry-jam">Pry Door Jam (Brawn 3+ · 1 Action)</button>`);
      }
      const downedAllies = Object.entries(state.heroes || {}).filter(
        ([pid, h]) => h.downed && h.roomKey === tile.key && pid !== activeId,
      );
      if (downedAllies.length) {
        const saltsIdx = (hero?.belt || []).findIndex((b) => {
          const g = b.gearId || b.id;
          return g === 'G-25' || g === 'G-26';
        });
        if (saltsIdx >= 0) {
          for (const [pid, h] of downedAllies) {
            buttons.push(
              `<button type="button" class="primary" data-use-belt="${saltsIdx}" data-belt-target="${escAttr(pid)}">Revive ${esc(h.name)} with Smelling Salts (1 Action)</button>`,
            );
          }
        }
        if (state.explorationActionsLeft >= 2) {
          for (const [pid, h] of downedAllies) {
            buttons.push(
              `<button type="button" data-carry="${escAttr(pid)}">Carry ${esc(h.name)} (2 Actions)</button>`,
            );
          }
        }
      }
    }
    const beltHeal = (hero?.belt || []).findIndex((b) => {
      const g = b.gearId || b.id;
      return g === 'G-27' || g === 'G-28';
    });
    if (beltHeal >= 0) {
      const atFull = (hero.hp ?? 0) >= (hero.maxHp ?? 10);
      buttons.push(
        `<button type="button" data-use-belt="${beltHeal}" ${atFull ? 'disabled title="Already at full HP"' : ''}>Drink Fizz Potion (+4 HP · free)</button>`,
      );
    }
  }

  buttons.push(`<button type="button" id="btn-end-turn">End turn</button>`);
  return buttons.join('');
}

function gearSlot(item, label, extraTag = '') {
  if (!item) return '';
  const gid = item.gearId || item.id;
  const statusTag = extraTag || (item.tapped ? 'tapped' : '');
  const fullLabel = statusTag ? `${label} · ${statusTag}` : label;
  const isSpent = Boolean(item.tapped || extraTag === 'used');
  return `
    <div class="table-gear ${isSpent ? 'is-tapped' : ''}">
      ${renderGearChip(gid, { size: 'mini' })}
      <span class="table-gear-tag">${esc(fullLabel)}</span>
    </div>`;
}

function renderPartySwitcher(state, activeId, focusedId, byTile) {
  const order = state.turnOrder?.length ? state.turnOrder : Object.keys(state.heroes || {});
  return order
    .map((pid) => {
      const hero = state.heroes?.[pid];
      if (!hero) return '';
      const isFocused = pid === focusedId;
      const isTurn = pid === activeId;
      const suitColor = SUITS[hero.preferredSuit]?.color || '#ccc';
      const tile = byTile.get(hero.roomKey);
      const hp = hero.hp ?? 0;
      const maxHp = hero.maxHp ?? 10;
      const pct = maxHp > 0 ? Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100))) : 0;

      return `
        <button type="button"
          class="party-card ${isFocused ? 'is-selected' : ''} ${isTurn ? 'is-turn' : ''} ${hero.downed ? 'is-downed' : ''}"
          data-inspect-hero="${escAttr(pid)}"
          aria-pressed="${isFocused ? 'true' : 'false'}">
          <span class="party-card-top">
            <span class="party-suit-dot" style="background:${suitColor}"></span>
            <strong class="party-hero-name">${esc(hero.name)}</strong>
            ${isTurn ? '<span class="party-badge is-live">Turn</span>' : ''}
            ${hero.downed ? '<span class="party-badge is-down">Down</span>' : ''}
          </span>
          <span class="party-hp-track">
            <span class="party-hp-fill" style="width:${pct}%"></span>
          </span>
          <span class="party-card-meta">
            <span>${hp}/${maxHp} HP</span>
            <span>${esc(shortRoomLabel(tile))}</span>
            <span>${hero.hand?.length ?? 0}🃏</span>
          </span>
        </button>`;
    })
    .join('');
}

function renderFocusedHero(state, focusedId, activeId, isDealer, meId) {
  const hero = state.heroes?.[focusedId];
  if (!hero) return '';
  const player = state.players?.find((p) => p.id === focusedId);
  const isTurn = focusedId === activeId && state.phase !== 'victory';
  const isMine = focusedId === meId;
  const showHand = isMine || isDealer;
  const hand = hero.hand || [];
  const handLabel = isMine ? 'Your hand' : `${hero.name}'s hand`;

  const offhandGid = hero.offhand ? hero.offhand.gearId || hero.offhand.id : null;
  const offhandExtra =
    (offhandGid === 'G-08' && hero.stuntGearUsed?.scarf) ||
    (offhandGid === 'G-11' && hero.stuntGearUsed?.kaleidoscope)
      ? 'used'
      : hero.offhand?.tapped
        ? 'tapped'
        : '';

  const gearSlots = [
    gearSlot(hero.weapon, 'Weapon'),
    gearSlot(hero.offhand, 'Off-hand', offhandExtra),
    gearSlot(hero.armor, 'Armour'),
  ].join('');

  const perkStatus =
    hero.perk?.id === 'shortcut-tiptoe'
      ? 'Passive'
      : hero.perkUsedThisClash
        ? 'Used'
        : 'Ready';
  const perkBadgeClass =
    hero.perk?.id === 'shortcut-tiptoe'
      ? 'is-passive'
      : hero.perkUsedThisClash
        ? 'is-used'
        : 'is-ready';

  const abilityHtml = hero.perk
    ? `
      <div class="table-ability-box">
        <div class="table-ability-head">
          <span class="table-ability-name">Ability: ${esc(hero.perk.name)}</span>
          <span class="table-ability-badge ${perkBadgeClass}">${perkStatus}</span>
        </div>
        <p class="table-ability-text">${esc(hero.perk.text)}</p>
      </div>`
    : '';

  const belt = hero.belt || [];
  const canControlBelt = isDealer || focusedId === meId;
  const canHealNow =
    state.phase === 'exploring' &&
    !state.pending &&
    !hero.downed &&
    (hero.hp ?? 0) < (hero.maxHp ?? 10);
  const canReviveExplore =
    focusedId === activeId &&
    state.phase === 'exploring' &&
    !state.pending &&
    !hero.downed &&
    (state.explorationActionsLeft ?? 0) >= 1;
  const downedInSameRoom = Object.entries(state.heroes || {}).filter(
    ([pid, h]) => pid !== focusedId && h.downed && h.roomKey === hero.roomKey,
  );
  const anyDownedAlly = Object.entries(state.heroes || {}).some(
    ([pid, h]) => pid !== focusedId && h.downed,
  );

  const beltIconFor = (gid) => {
    if (gid === 'G-27' || gid === 'G-28') return '🧪';
    if (gid === 'G-25' || gid === 'G-26') return '⚡';
    if (gid === 'G-29') return '🎉';
    if (gid === 'G-24') return '🏮';
    if (gid === 'G-30') return '💫';
    return '🎒';
  };

  const beltRows = belt
    .map((b, i) => {
      const gid = b.gearId || b.id;
      const def = getGear(gid);
      const name = def?.name || b.name || gid;
      const rule = def?.rule || b.rule || '';
      const flavor = def?.flavor || '';
      let actionHtml = '';

      if (gid === 'G-27' || gid === 'G-28') {
        if (canControlBelt) {
          const healNote = hero.downed
            ? '<span class="belt-status-chip">Downed</span>'
            : (hero.hp ?? 0) >= (hero.maxHp ?? 10)
              ? '<span class="belt-status-chip">Full HP</span>'
              : '';
          actionHtml = `${healNote}<button type="button" class="belt-use-btn" data-use-belt="${i}" data-belt-owner="${escAttr(focusedId)}" ${canHealNow ? '' : 'disabled'}>Drink (+4 HP)</button>`;
        } else {
          actionHtml = `<span class="belt-status-chip">+4 HP (free)</span>`;
        }
      } else if (gid === 'G-25' || gid === 'G-26') {
        if (canControlBelt && canReviveExplore && downedInSameRoom.length) {
          actionHtml = downedInSameRoom
            .map(
              ([allyPid, ally]) =>
                `<button type="button" class="belt-use-btn primary" data-use-belt="${i}" data-belt-target="${escAttr(allyPid)}" data-belt-owner="${escAttr(focusedId)}">Revive ${esc(ally.name)} (1 Act)</button>`,
            )
            .join('');
        } else {
          const msg = anyDownedAlly ? 'Move to downed ally' : 'Revives downed ally';
          actionHtml = `<span class="belt-status-chip">${msg}</span>`;
        }
      } else if (gid === 'G-29') {
        actionHtml = `<span class="belt-status-chip">Use in Clash (free)</span>`;
      } else if (gid === 'G-24') {
        actionHtml = `<span class="belt-status-chip">Passive relic</span>`;
      } else if (gid === 'G-30') {
        actionHtml = `<span class="belt-status-chip">Auto-revive (1/floor)</span>`;
      } else if (def?.rule) {
        actionHtml = `<span class="belt-status-chip">${esc(def.slot === 'relic' ? 'Passive relic' : 'Consumable')}</span>`;
      }

      return `
        <div class="belt-item-row">
          <div class="belt-item-info">
            <span class="belt-item-icon">${beltIconFor(gid)}</span>
            <span class="belt-item-name">${esc(name)}</span>
          </div>
          <div class="belt-item-actions">${actionHtml}</div>
          ${hoverTipHtml(name, rule, flavor)}
        </div>`;
    })
    .join('');

  const beltZoneHtml = `
    <div class="table-belt-zone">
      <div class="table-zone-label">
        <span>Belt Items</span>
        <span class="muted">(${belt.length}/2)</span>
      </div>
      ${belt.length ? `<div class="belt-item-list">${beltRows}</div>` : `<span class="muted belt-empty">No belt items (0/2 slots)</span>`}
    </div>`;

  const handCards = hand.length
    ? hand
        .map((c) => {
          const card = showHand ? c : { ...c, hidden: true };
          return `<div class="table-hand-slot">${renderActionCard(card, { size: 'hand' })}</div>`;
        })
        .join('')
    : '<span class="muted">Empty hand</span>';

  return `
    <section class="hero-focus-zone ${isTurn ? 'is-turn' : ''}">
      <div class="table-seat-row">
        <div class="table-seat-info">
          <div class="table-zone-label">
            <span>${isMine ? 'You' : 'Inspecting'}${isTurn ? ' · Active' : ''}</span>
            ${player?.name && player.name !== hero.name ? `<span class="muted">(${esc(player.name)})</span>` : ''}
          </div>
          ${hpMeter({ label: hero.name, hp: hero.hp ?? 0, maxHp: hero.maxHp ?? 10 })}
          ${hero.downed ? '<div class="table-seat-chips"><span class="table-chip is-warn">Downed</span></div>' : ''}
          ${gearSlots ? `<div class="table-gear-row">${gearSlots}</div>` : ''}
        </div>
        <div class="table-seat-card">
          ${renderHeroCard(hero.heroId, { size: 'hand', downed: hero.downed })}
        </div>
      </div>

      ${abilityHtml}
      ${beltZoneHtml}

      <div class="table-hand-zone">
        <div class="table-zone-label">
          <span>${esc(handLabel)}</span>
          <span class="muted">· ${hand.length} card${hand.length === 1 ? '' : 's'}${!showHand ? ' · private' : ''}</span>
        </div>
        <div class="table-hand-fan">${handCards}</div>
      </div>
    </section>`;
}

export function renderTable(state, ctx = {}) {
  const {
    isDealer = false,
    meId = null,
    roomCode = state.roomCode || '—',
    role = isDealer ? 'dealer' : 'hero',
    status = '',
    error = '',
    inspectedHeroId = null,
    carryingTargetId = null,
  } = ctx;

  const activeId = state.turnOrder?.[state.activeHeroIndex];
  const activePlayer = state.players?.find((p) => p.id === activeId);
  const activeHero = state.heroes?.[activeId];
  const theme = THEMES.find((t) => t.id === state.themeId);
  const boss = BOSSES.find((b) => b.id === state.bossId);
  const byTile = new Map((state.map?.tiles || []).map((t) => [t.key, t]));
  const activeTile = byTile.get(activeHero?.roomKey);
  const gather = bossGather(state);
  const bossWaiting = Boolean(gather.waiting);
  const isVictory = state.phase === 'victory';
  const focusedId = resolveFocusedHeroId(state, { isDealer, meId, inspectedHeroId });

  const carryingHero =
    carryingTargetId &&
    state.phase === 'exploring' &&
    !state.pending &&
    state.explorationActionsLeft >= 2 &&
    (isDealer || meId === activeId) &&
    activeHero &&
    !activeHero.downed &&
    carryingTargetId !== activeId &&
    state.heroes?.[carryingTargetId]?.downed &&
    state.heroes[carryingTargetId].roomKey === activeHero.roomKey
      ? state.heroes[carryingTargetId]
      : null;
  const activeCarryId = carryingHero ? carryingTargetId : null;

  const shellClasses = [
    'table-shell',
    'game-layout',
    state.phase === 'clash' ? 'clash-dimmed' : '',
    isDealer ? 'has-dealer-bar' : '',
    bossWaiting ? 'has-boss-bar' : '',
    isVictory ? 'has-victory-bar' : '',
    activeCarryId ? 'has-carry-bar' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const turnLabel = isVictory
    ? 'Floor Complete'
    : state.phase === 'clash'
      ? 'In Clash!'
      : !isDealer && meId === activeId
        ? 'Your turn'
        : `${activePlayer?.name || activeHero?.name || 'Hero'}'s turn`;

  const turnClass = isVictory ? 'is-victory' : state.phase === 'clash' ? 'is-clash' : 'is-hero';

  const statusHtml = error
    ? `<p class="table-error-chip" role="alert">${esc(error)}</p>`
    : isVictory
      ? `<p class="table-status-note is-good">Spiral Slide reached — conscious Heroes healed +3 HP.</p>`
      : state.floor?.stairsUnlocked
        ? `<p class="table-status-note is-good">Stairs unlocked — step onto Stairway Down to finish.</p>`
        : `<p class="table-status-note muted">${esc(status)}</p>`;

  const logHtml = (state.log || [])
    .map((l) => `<div class="table-log-line">${formatCombatLogLine(l)}</div>`)
    .join('');

  const jammedHere = activeTile
    ? (state.map?.barriers || []).some((b) => b.aKey === activeTile.key || b.bKey === activeTile.key)
    : false;

  const roomCalloutHtml = activeTile?.faceUp
    ? `<div class="table-room-callout">
        <div class="table-room-head">
          <strong>${esc(activeTile.name)}</strong>
          ${jammedHere ? '<span class="table-chip is-warn">Door Jammed</span>' : ''}
        </div>
        <p class="muted">${esc(activeTile.lurkingMonster ? `Lurking: ${activeTile.lurkingMonster.name}` : activeTile.merchant ? `${activeTile.merchant.name}: ${activeTile.merchant.deals?.[0] || ''}` : activeTile.rule || '')}</p>
      </div>`
    : '';

  const actionsHtml = renderRoomActions(state, isDealer, meId, activeCarryId, carryingHero);
  const waitHtml =
    !isDealer && meId !== activeId && state.phase === 'exploring' && !state.pending
      ? `<p class="muted table-wait-note">Waiting for ${esc(activePlayer?.name || activeHero?.name || 'active hero')}…</p>`
      : '';

  const carryBannerHtml = activeCarryId
    ? `<div class="carry-mode-bar" role="status">
        <strong>Carrying ${esc(carryingHero.name)}</strong>
        <span class="muted">Click any highlighted adjacent room on the map (2 Actions).</span>
        <button type="button" id="btn-cancel-carry">Cancel</button>
      </div>`
    : '';

  const topBannerHtml = isVictory
    ? `<div class="table-victory-bar">
        <strong>Floor 1 complete!</strong>
        <span class="muted">The Spiral Slide is open — conscious Heroes healed +3 HP.</span>
      </div>`
    : `${renderBossGatherBar(state, isDealer, meId)}${carryBannerHtml}`;

  return `
    <div class="${shellClasses}">
      <header class="table-header">
        <div class="table-title">
          <p class="table-kicker">Cozy Basement Crawl · Room ${esc(roomCode)} · ${esc(role)}</p>
          <h2>Floor 1 <span class="table-sub">· ${esc(theme?.name || 'Theme')} · Boss: ${esc(boss?.name || '?')}</span></h2>
        </div>
        <div class="table-status">${statusHtml}</div>
        <div class="table-pills">
          <span class="pill ${state.floor?.stairsUnlocked ? 'is-good' : ''}">Stairs: <strong>${state.floor?.stairsUnlocked ? 'UNLOCKED' : 'locked'}</strong></span>
          ${!isVictory ? `<span class="pill" data-coach="actions-left">Actions: <strong>${state.explorationActionsLeft}</strong></span>` : ''}
          <span class="table-turn-chip ${turnClass}">${esc(turnLabel)}</span>
        </div>
      </header>

      ${isDealer ? renderDealerBar(state) : ''}

      <div class="table-board">
        <div class="table-col table-col-left">
          <aside class="table-log-box">
            <h3>Table log</h3>
            <div class="log table-log">${logHtml || '<div class="muted">Events appear here.</div>'}</div>
          </aside>
          <div class="table-actions">
            ${roomCalloutHtml}
            <div class="table-action-btns">${actionsHtml}</div>
            ${waitHtml}
          </div>
        </div>

        <div class="table-col table-col-center">
          ${topBannerHtml}
          <div class="table-map-stage ${state.pending ? 'has-prompt' : ''}">
            ${renderMap(state, isDealer, meId, activeCarryId, carryingHero)}
            ${renderPendingOverlay(state, isDealer, meId)}
          </div>
        </div>

        <div class="table-col table-col-right" data-coach="side-panel">
          <div class="party-strip" aria-label="Party heroes">
            ${renderPartySwitcher(state, activeId, focusedId, byTile)}
          </div>
          ${renderFocusedHero(state, focusedId, activeId, isDealer, meId)}
        </div>
      </div>
    </div>`;
}
