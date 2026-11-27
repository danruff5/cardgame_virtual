import {
  ASSET,
  SUIT_META,
  HERO_ART,
  ROOM_ART,
  ROOM_BACK,
  ACTION_BACK,
  GEAR_ART,
  MONSTER_ART,
  SPECIAL_ICONS,
} from '../data/artMeta.js';
import { getGear } from '../data/gear.js';
import { getHero } from '../data/heroes.js';
import { getRoom } from '../data/rooms.js';
import { MONSTERS, BOSSES } from '../data/monsters.js';

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fallbackSvg(color, glyphPath, badgeText = '') {
  return `<svg viewBox="0 0 24 24" fill="${color}" stroke="#3B312B" stroke-width="1.3" stroke-linejoin="round">
    <path d="${glyphPath || SUIT_META.wild.glyph}"/>
    ${badgeText ? `<text x="12" y="15" text-anchor="middle" font-size="7" font-weight="900" fill="#FFF" stroke="none">${esc(badgeText)}</text>` : ''}
  </svg>`;
}

function iconTag(iconFile, color, glyph) {
  const src = ASSET.icons(iconFile);
  return `<span class="corner-icon-wrap">
    <img class="layer-icon" src="${src}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'">
    <span class="icon-fallback" style="display:none">${fallbackSvg(color, glyph)}</span>
  </span>`;
}

function frameImg(file) {
  return `<img class="layer-frame" src="${ASSET.frames(file)}" alt="" onerror="this.style.display='none'">`;
}

function artImg(file) {
  return `<img class="layer-art" src="${ASSET.art(file)}" alt="" onerror="this.style.display='none'">`;
}

export function hoverTipHtml(title, rulesPlain, flavorPlain) {
  const rules = String(rulesPlain || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const flavor = String(flavorPlain || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!rules && !flavor) return '';
  return `<div class="card-hover-tip" role="tooltip">
    <div class="tip-title">${esc(title)}</div>
    ${rules ? `<div class="tip-rules">${esc(rules)}</div>` : ''}
    ${flavor ? `<div class="tip-flavor">${esc(flavor)}</div>` : ''}
  </div>`;
}

/** Rules + flavor for action / special / wild / cramp — shared by cards and combat-log hovers. */
export function tipDataForActionCard(card) {
  if (!card || card.hidden) {
    return {
      title: 'Face-down Action',
      rules: 'Opponent hand — face hidden.',
      flavor: '',
    };
  }
  if (card.type === 'cramp') {
    return {
      title: 'Cramp!',
      rules: 'Unplayable on Clash Pile. Instead of playing, discard up to 2 Cramp! to stretch. Clears when combat ends.',
      flavor: 'Ouch! Too many dramatic swings without stretching!',
    };
  }
  if (card.type === 'wild' || card.kind === 'wild') {
    return {
      title: 'Heroic Wild!',
      rules: 'Play on ANY card! Deal Weapon Strike damage and pick the new Active Suit.',
      flavor: 'Cue the heroic trumpet fanfare!',
    };
  }
  if (card.type === 'special') {
    const m = SUIT_META[card.suit] || SUIT_META.brawn;
    const tips = {
      daze: {
        rules: `Play on ${m.label} or another Daze!. Target misses their next turn; you play again!`,
        flavor: 'Whoa... shiny spinning stars!',
      },
      bounce: {
        rules: `Play on ${m.label} or Bounce Back!. Reflects 1 Dmg; flips Boss table turn order!`,
        flavor: 'Boing! Right back at ya!',
      },
      tuckered: {
        rules: `Play on ${m.label} or Tuckered Out!. Monster: 2 direct Dmg. Hero: draw 2 Cramp!.`,
        flavor: 'Oof, time for a quick breather...',
      },
    };
    const tip = tips[card.kind] || { rules: card.name || 'Special', flavor: '' };
    return { title: card.name || 'Special', rules: tip.rules, flavor: tip.flavor };
  }
  const m = SUIT_META[card.suit] || SUIT_META.brawn;
  return {
    title: `${m.label} ${card.rank}`,
    rules: `Play on ${m.label} OR any Rank ${card.rank}. Higher same-suit Rank = Clean Strike; exact Rank = Parry; lower same-suit = Guard.`,
    flavor: `Action Deck • ${m.label} Suit`,
  };
}

/** Inline log mention with the same dull/flavor hover tip used on compositor cards. */
export function renderCardMention(label, tip) {
  if (!tip?.rules && !tip?.flavor) return esc(label);
  return `<span class="log-card-mention">${esc(label)}${hoverTipHtml(tip.title || label, tip.rules, tip.flavor)}</span>`;
}

/**
 * Shared 4-layer card shell (same structure as print_and_play.html).
 */
export function renderCompositorCard({
  id = '',
  title,
  badge = '',
  rank = null,
  accent,
  frame,
  art,
  icon,
  glyph,
  rules = '',
  flavor = '',
  tipRules = '',
  tipFlavor = '',
  size = 'table', // mini | hand | table | square
  square = false,
  doors = false,
  compact = false,
  extraClass = '',
}) {
  const sizeClass = size === 'square' || square ? 'size-square card-square' : `size-${size}`;
  const rankBadge = rank != null
    ? `<span class="rank-big">${esc(rank)}</span>`
    : badge
      ? `<span class="badge-pill">${esc(badge)}</span>`
      : '';
  const watermark = rank != null ? `<div class="center-rank-watermark">${esc(rank)}</div>` : '';
  const doorsHtml = doors
    ? `<div class="door door-n">▲</div><div class="door door-s">▼</div><div class="door door-w">◄</div><div class="door door-e">►</div>`
    : '';
  const body = compact
    ? ''
    : `<div class="card-body ${size === 'hand' || size === 'mini' ? 'compact-only' : ''}">
        ${rules ? `<div class="rules-text">${rules}</div>` : ''}
        ${flavor ? `<div class="flavor-text">${flavor}</div>` : ''}
      </div>
      <div class="card-footer"><span>${esc(id)}</span><span>${esc(badge || '')}</span></div>`;

  const tip = hoverTipHtml(title, tipRules || rules, tipFlavor || flavor);

  return `<div class="vcard ${sizeClass} ${extraClass}" style="--accent:${accent}">
    ${frameImg(frame)}
    <div class="frame-fallback"></div>
    ${doorsHtml}
    <div class="card-content">
      <div class="card-header">
        ${iconTag(icon, accent, glyph)}
        <span class="card-title">${esc(title)}</span>
        ${rankBadge}
      </div>
      <div class="art-window">
        ${artImg(art)}
        <div class="art-fallback">${fallbackSvg(accent, glyph, rank != null ? String(rank) : '')}</div>
        ${watermark}
      </div>
      ${body}
    </div>
    ${tip}
  </div>`;
}

export function renderCardBack({ kind = 'action', size = 'hand', label = '' } = {}) {
  const isRoom = kind === 'room';
  const frame = isRoom ? ROOM_BACK : ACTION_BACK;
  const title = isRoom ? 'UNEXPLORED' : 'CLASH & CHAIN';
  const badge = isRoom ? 'ROOM' : 'ACTION';
  return `<div class="vcard card-back ${isRoom ? 'room-back size-square card-square' : `size-${size}`}" title="${esc(label || title)}">
    ${frameImg(frame)}
    <div class="card-content">
      <div class="card-back-inner">
        <div style="color:#FFE4A3;font-size:8px">${esc(badge)}</div>
        <div style="margin-top:4px">${esc(title)}</div>
      </div>
    </div>
  </div>`;
}

/** Action / special / wild / cramp hand card from runtime instance. */
export function renderActionCard(card, { size = 'hand' } = {}) {
  if (!card || card.hidden) {
    return renderCardBack({ kind: 'action', size });
  }
  const tip = tipDataForActionCard(card);
  if (card.type === 'cramp') {
    return renderCompositorCard({
      id: card.id,
      title: tip.title,
      badge: 'FATIGUE',
      accent: '#B86B82',
      frame: 'frame_cramp.png',
      art: 'art_cramp_charley_horse.png',
      icon: SPECIAL_ICONS.cramp,
      glyph: 'M5 5L19 19M19 5L5 19',
      tipRules: tip.rules,
      tipFlavor: tip.flavor,
      size,
      compact: true,
      extraClass: 'card-cramp',
    });
  }
  if (card.type === 'wild' || card.kind === 'wild') {
    const m = SUIT_META.wild;
    return renderCompositorCard({
      id: card.id,
      title: tip.title,
      badge: 'ANY',
      rank: 'W',
      accent: m.color,
      frame: m.frame,
      art: m.art,
      icon: m.icon,
      glyph: m.glyph,
      tipRules: tip.rules,
      tipFlavor: tip.flavor,
      size,
      compact: true,
    });
  }
  if (card.type === 'special') {
    const m = SUIT_META[card.suit] || SUIT_META.brawn;
    const icon =
      card.kind === 'daze'
        ? SPECIAL_ICONS.daze
        : card.kind === 'bounce'
          ? SPECIAL_ICONS.bounce
          : SPECIAL_ICONS.tuckered;
    return renderCompositorCard({
      id: card.id,
      title: tip.title,
      badge: m.label,
      rank: card.kind === 'daze' ? '★' : card.kind === 'bounce' ? '⇄' : '+2',
      accent: m.color,
      frame: m.frame,
      art: m.art,
      icon,
      glyph: m.glyph,
      tipRules: tip.rules,
      tipFlavor: tip.flavor,
      size,
      compact: true,
    });
  }
  // rank card
  const m = SUIT_META[card.suit] || SUIT_META.brawn;
  return renderCompositorCard({
    id: card.id,
    title: tip.title,
    badge: m.label,
    rank: card.rank,
    accent: m.color,
    frame: m.frame,
    art: m.art,
    icon: m.icon,
    glyph: m.glyph,
    tipRules: tip.rules,
    tipFlavor: tip.flavor,
    size,
    compact: true,
  });
}

export function renderHeroCard(heroId, { size = 'table', downed = false } = {}) {
  const hero = getHero(heroId);
  if (!hero) return '';
  const suit = SUIT_META[hero.preferredSuit] || SUIT_META.brawn;
  const art = downed ? HERO_ART.downed : HERO_ART[heroId];
  return renderCompositorCard({
    id: heroId,
    title: downed ? `${hero.name} — DOWNED!` : hero.name,
    badge: downed ? '0 HP' : 'HERO • 10 HP',
    accent: downed ? '#6A6570' : '#387A47',
    frame: art.frame,
    art: art.art,
    icon: downed ? SPECIAL_ICONS.daze : suit.icon,
    glyph: suit.glyph,
    rules: size === 'table' ? `<i>${esc(hero.title)}</i><br><b>${esc(hero.perk.name)}:</b> ${esc(hero.perk.text)}` : '',
    flavor: size === 'table' ? `"${esc(hero.flavor)}"` : '',
    tipRules: `${hero.title}. ${hero.perk.name}: ${hero.perk.text}`,
    tipFlavor: hero.flavor,
    size,
    compact: size !== 'table',
    extraClass: 'card-hero',
  });
}

export function renderGearChip(gearId, { size = 'mini' } = {}) {
  const g = getGear(gearId);
  if (!g) return '';
  const art = GEAR_ART[gearId] || 'art_gear_starter_sword.png';
  return renderCompositorCard({
    id: gearId,
    title: g.name,
    badge: typeof g.tier === 'number' ? `T${g.tier}` : String(g.tier).toUpperCase(),
    accent: '#7A5438',
    frame: 'frame_gear.png',
    art,
    icon: g.tier === 0 || g.tier === 'belt' ? 'icon_tuck_arrow.png' : 'icon_tier_star.png',
    glyph: 'M12 2L15 9L22 9L16 14L18 21L12 17L6 21L8 14L2 9L9 9Z',
    tipRules: g.rule,
    tipFlavor: g.flavor,
    size,
    compact: true,
    extraClass: 'card-gear',
  });
}

/** Map room tile — art bleeds edge-to-edge with cover crop (not letterboxed). */
export function renderRoomTile(tile, { stairsUnlocked = false } = {}) {
  if (!tile) return '';
  if (!tile.faceUp) {
    return `<div class="map-tile-wrap">
      <div class="map-tile-card room-bleed face-down-tile">
        <img class="room-art" src="${ASSET.frames(ROOM_BACK)}" alt="" />
      </div>
      ${hoverTipHtml('Unexplored room', 'Face-down Square Room — move here to flip it.', '')}
    </div>`;
  }
  const room = getRoom(tile.roomId);
  const art = ROOM_ART[tile.kind] || 'art_room_hall.png';
  const lockedStairs = tile.kind === 'stairs' && (tile.locked || !stairsUnlocked);
  const title = lockedStairs ? 'Stairs (locked)' : room?.name || tile.name;
  return `<div class="map-tile-wrap">
    <div class="map-tile-card room-bleed ${lockedStairs ? 'stairs-locked' : ''}">
      <img class="room-art" src="${ASSET.art(art)}" alt="" />
      <img class="room-frame" src="${ASSET.frames('frame_room_square.png')}" alt="" />
      <div class="door door-n">▲</div><div class="door door-s">▼</div><div class="door door-w">◄</div><div class="door door-e">►</div>
    </div>
    ${hoverTipHtml(title, room?.rule || tile.rule, room?.flavor || tile.flavor)}
  </div>`;
}

export function renderMonsterCard(monsterId, { size = 'table', hp, maxHp, isBoss = false, floorNumber = 1 } = {}) {
  const mon = MONSTERS.find((m) => m.id === monsterId) || BOSSES.find((b) => b.id === monsterId);
  if (!mon) {
    return renderCompositorCard({
      id: monsterId || '?',
      title: 'Mystery Critter',
      badge: 'MONSTER',
      accent: '#544663',
      frame: 'frame_monster.png',
      art: 'art_mon_goblin_intern.png',
      icon: 'icon_sword.png',
      glyph: SUIT_META.brawn.glyph,
      size,
      compact: size !== 'table',
    });
  }
  const art = MONSTER_ART[mon.id] || 'art_mon_goblin_intern.png';
  const boss = Boolean(isBoss || String(mon.id).startsWith('B-'));
  const hpLine =
    hp != null
      ? `<div class="stat-row" style="display:flex;justify-content:space-around;font-weight:800;margin-bottom:3px"><span>HP ${hp}${maxHp != null ? `/${maxHp}` : ''}</span><span>Cun ${mon.cunning}</span><span>Dmg ${mon.baseDmg}</span></div>`
      : `<div class="stat-row" style="display:flex;justify-content:space-around;font-weight:800;margin-bottom:3px"><span>HP ${mon.hp || mon.baseHp}</span><span>Cun ${mon.cunning}</span><span>Dmg ${mon.baseDmg}</span></div>`;
  return renderCompositorCard({
    id: mon.id,
    title: mon.name,
    badge: boss ? `FLOOR ${Math.max(1, Number(floorNumber) || 1)} BOSS` : 'MONSTER',
    accent: boss ? '#7E4BB5' : '#544663',
    frame: 'frame_monster.png',
    art,
    icon: boss ? 'icon_tier_star.png' : 'icon_sword.png',
    glyph: 'M12 2L15 9L22 9L16 14L18 21L12 17L6 21L8 14L2 9L9 9Z',
    rules: size === 'table' ? `${hpLine}${esc(mon.trait)}` : hpLine,
    flavor: size === 'table' ? `"${esc(mon.flavor)}"` : '',
    tipRules: mon.trait,
    tipFlavor: mon.flavor,
    size,
    compact: size === 'mini',
    extraClass: 'card-monster',
  });
}
