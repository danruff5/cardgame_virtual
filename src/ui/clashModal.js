import {
  renderActionCard,
  renderCardBack,
  renderHeroCard,
  renderMonsterCard,
  renderGearChip,
  renderCompositorCard,
  tipDataForActionCard,
  renderCardMention,
} from './cardView.js';
import { ASSET, SUIT_META } from '../data/artMeta.js';
import { RULES } from '../data/index.js';
import { DESPERATION } from '../data/desperation.js';
import { isLegalPlay, isCramp, isSpecial, isWild, heroHasLegalPlay } from '../game/clash.js';
import { bossJoinCheck } from '../game/boss.js';
import {
  clashFighters,
  clashSeats,
  snapClash,
  diffClashMoves,
  openingDealMoves,
  clashOutcome,
  closingClashState,
} from './clashMoves.js';
import { captureFly, playFly, playCleanupSweep, prefersReducedMotion } from './clashAnim.js';

const NO_FX = {
  heroDelta: 0,
  heroDeltas: {},
  monsterDelta: 0,
  pileAnim: false,
  hitFlash: false,
  turnChanged: false,
};

/**
 * Diff HP / pile / turn against the last paint so flash, float and banner classes fire
 * once per change. HP is tracked per fighter so a turn hand-off never fakes a delta.
 */
export function consumeClashFx(session, state) {
  const clash = state?.clash;
  const fx = session.clashFx || (session.clashFx = {});
  if (!clash) {
    fx.prevHeroHp = null;
    fx.prevHps = null;
    fx.prevMonsterHp = null;
    fx.prevTopId = null;
    fx.prevPileLen = null;
    fx.prevTurn = null;
    return { ...NO_FX };
  }
  const prevHps = fx.prevHps || {};
  const hps = {};
  const heroDeltas = {};
  for (const pid of clashFighters(clash)) {
    const hp = state.heroes?.[pid]?.hp ?? 0;
    hps[pid] = hp;
    heroDeltas[pid] = prevHps[pid] != null ? hp - prevHps[pid] : 0;
  }
  const monHp = clash.monsterHp;
  const topId = clash.topCard?.id ?? null;
  const pileLen = clash.pile?.length ?? 0;
  const turn = `${clash.whoseTurn}:${clash.heroPlayerId}`;

  const heroDelta = heroDeltas[clash.heroPlayerId] ?? 0;
  const monsterDelta = fx.prevMonsterHp != null ? monHp - fx.prevMonsterHp : 0;
  const pileAnim =
    (fx.prevTopId != null && topId !== fx.prevTopId) ||
    (fx.prevPileLen != null && pileLen > fx.prevPileLen);
  const turnChanged = fx.prevTurn != null && fx.prevTurn !== turn;

  fx.prevHps = hps;
  fx.prevHeroHp = hps[clash.heroPlayerId] ?? 0;
  fx.prevMonsterHp = monHp;
  fx.prevTopId = topId;
  fx.prevPileLen = pileLen;
  fx.prevTurn = turn;

  return {
    heroDelta,
    heroDeltas,
    monsterDelta,
    pileAnim,
    turnChanged,
    hitFlash: monsterDelta < 0 || Object.values(heroDeltas).some((d) => d < 0),
  };
}

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

function tipForSuitRank(suit, rank) {
  return tipDataForActionCard({ type: 'rank', suit, rank, name: `${suit} ${rank}` });
}

function tipForKnownLabel(raw) {
  const text = String(raw || '').trim();
  const lower = text.toLowerCase();

  if (/^heroic wild!?$/i.test(text)) return tipDataForActionCard({ type: 'wild', kind: 'wild' });
  if (/^cramp!?$/i.test(text)) return tipDataForActionCard({ type: 'cramp' });

  const specialMatch = text.match(/^(daze!?|bounce back!?|tuckered out!?)\s*(?:\((brawn|grit|zip|spark)\))?$/i);
  if (specialMatch) {
    const kindRaw = specialMatch[1].toLowerCase();
    const kind = kindRaw.startsWith('daze')
      ? 'daze'
      : kindRaw.startsWith('bounce')
        ? 'bounce'
        : 'tuckered';
    const suit = (specialMatch[2] || 'brawn').toLowerCase();
    const names = { daze: 'Daze!', bounce: 'Bounce Back!', tuckered: 'Tuckered Out!' };
    return tipDataForActionCard({ type: 'special', kind, suit, name: names[kind] });
  }

  const rankMatch = text.match(/^(brawn|grit|zip|spark)\s+([1-6])$/i);
  if (rankMatch) return tipForSuitRank(rankMatch[1].toLowerCase(), Number(rankMatch[2]));

  const desp = DESPERATION.find((d) => d.title.toLowerCase() === lower);
  if (desp) {
    return { title: desp.title, rules: `${desp.outcome} ${desp.reset}`, flavor: desp.flavor };
  }

  return null;
}

/** Wrap suit/rank / special / wild / desperation titles with hover tips. */
export function formatCombatLogLine(line) {
  const raw = String(line ?? '');
  const pattern =
    /Heroic Wild!|Cramp!|(?:Daze!|Bounce Back!|Tuckered Out!)(?:\s*\((?:brawn|grit|zip|spark)\))?|(?:brawn|grit|zip|spark)\s+[1-6]|Banana-Peel Lunge|Dropped the Sword!|Giant Sneeze!|Tangled Shoelaces|Wardrobe Malfunction|Boo-Boo Backfire|Brave Backward Sprint|Lucky Elbow Poke|Quick Snack Break|Panicked Duck|Accidental Mega-Crit!|Wait, What's in My Pocket\?/gi;

  let out = '';
  let last = 0;
  let m;
  const re = new RegExp(pattern.source, 'gi');
  while ((m = re.exec(raw)) !== null) {
    out += esc(raw.slice(last, m.index));
    const tip = tipForKnownLabel(m[0]);
    out += tip ? renderCardMention(m[0], tip) : esc(m[0]);
    last = m.index + m[0].length;
  }
  out += esc(raw.slice(last));
  return out;
}

export function clashPlayOptionsFor(hero) {
  const opts = {};
  if (hero?.perk?.id === 'big-swing' && !hero.perkUsedThisClash) opts.bigSwing = true;
  if (hero?.perk?.id === 'improvised-zap' && !hero.perkUsedThisClash) opts.defensiveSparkAsAny = true;
  if (hero?.offhand?.id === 'G-17' && !hero.offhand.tapped) opts.forceParry = true;
  return opts;
}

function cardIsLegal(c, clash, playOpts, hasCookie) {
  if (clash?.heroDazed) return false;
  if (clash?.twinRank != null) {
    return Boolean(c && !isCramp(c) && !isSpecial(c) && !isWild(c) && Number(c.rank) === clash.twinRank);
  }
  return (
    isLegalPlay(c, clash) ||
    isLegalPlay(c, clash, { bigSwing: playOpts.bigSwing && c.suit === 'brawn' }) ||
    isLegalPlay(c, clash, {
      defensiveSparkAsAny: playOpts.defensiveSparkAsAny && c.suit === 'spark',
    }) ||
    (hasCookie && isLegalPlay(c, clash, { forceParry: true }))
  );
}

function hpMeter({ label, hp, maxHp, delta = 0, kind }) {
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100))) : 0;
  const deltaClass = delta < 0 ? 'hp-delta-down' : delta > 0 ? 'hp-delta-up' : '';
  const flashClass = delta < 0 ? 'hp-flash-hurt' : delta > 0 ? 'hp-flash-heal' : '';
  const deltaHtml =
    delta !== 0
      ? `<span class="hp-float ${deltaClass}">${delta > 0 ? '+' : ''}${delta}</span>`
      : '';
  return `
    <div class="clash-hp ${kind} ${flashClass}" data-hp-kind="${escAttr(kind)}">
      <div class="clash-hp-label">
        <span>${esc(label)}</span>
        <strong>${hp}/${maxHp}</strong>
      </div>
      <div class="clash-hp-track">
        <div class="clash-hp-fill" style="width:${pct}%"></div>
      </div>
      ${deltaHtml}
    </div>`;
}

/** One card on the table, tagged so clashAnim can fly it between renders. */
function flyCard(card, { size = 'hand' } = {}) {
  const back = !card || card.hidden;
  const tag = card?.id != null ? `data-fly="c:${escAttr(card.id)}"` : '';
  return `<span class="clash-fly" ${tag} ${back ? 'data-fly-back' : ''}>${renderActionCard(card, { size })}</span>`;
}

function stackCount(n) {
  return n == null ? '' : `<span class="clash-stack-count" aria-label="${n} cards">${n}</span>`;
}

function monsterHandFan(clash) {
  const hand = clash.monsterHand || [];
  if (!hand.length) {
    return `<div class="clash-monster-hand empty" data-fly="z:monster-hand"><span class="muted">No cards</span></div>`;
  }
  const backs = hand
    .map((c) => `<div class="clash-back-slot">${flyCard({ id: c.id, hidden: true }, { size: 'mini' })}</div>`)
    .join('');
  return `
    <div class="clash-monster-hand" data-fly="z:monster-hand" title="${hand.length} cards in monster hand">
      <div class="clash-back-fan">${backs}</div>
      ${stackCount(hand.length)}
    </div>`;
}

/** Stable little tilt per card so the pile looks tossed, not stacked by a machine. */
function tiltFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return (h % 19) - 9;
}

function pileStack(clash) {
  const pile = clash.pile?.length ? clash.pile : clash.topCard ? [clash.topCard] : [];
  if (!pile.length) {
    return `<div class="clash-pile" data-fly="z:pile"><div class="clash-pile-empty muted">Clash pile</div></div>`;
  }
  const shown = pile.slice(-4);
  const cards = shown
    .map((c, i) => {
      const top = i === shown.length - 1;
      const tilt = top ? Math.round(tiltFor(c.id) / 3) : tiltFor(c.id);
      return `<div class="clash-pile-card ${top ? 'is-top' : ''}" style="--tilt:${tilt}deg">${flyCard(c)}</div>`;
    })
    .join('');
  return `<div class="clash-pile" data-fly="z:pile">${cards}</div>`;
}

function desperationCard(card) {
  const art =
    card.tier === 'miracle'
      ? 'art_desp_miracle.png'
      : card.tier === 'neutral'
        ? 'art_desp_scrappy.png'
        : 'art_desp_mishap.png';
  return renderCompositorCard({
    id: card.id,
    title: card.title,
    badge: String(card.tier || '').toUpperCase(),
    accent: '#D96B27',
    frame: 'frame_desperation.png',
    art,
    icon: 'icon_tuck_arrow.png',
    glyph: SUIT_META.wild.glyph,
    tipRules: `${card.outcome || ''} ${card.reset || ''}`.trim(),
    tipFlavor: card.flavor,
    size: 'mini',
    compact: true,
    extraClass: 'card-desperation',
  });
}

function desperationBack() {
  return `<div class="vcard card-back size-mini clash-desp-back" title="Desperation Deck">
    <img class="layer-frame" src="${ASSET.frames('back_desperation.png')}" alt="" onerror="this.style.display='none'">
    <div class="card-content">
      <div class="card-back-inner">
        <div style="color:#FFE4A3;font-size:8px">DESPERATION</div>
      </div>
    </div>
  </div>`;
}

function gearSlot(item, label) {
  if (!item) return '';
  return `<div class="clash-gear ${item.tapped ? 'is-tapped' : ''}">
    ${renderGearChip(item.id, { size: 'mini' })}
    <span class="clash-gear-tag">${esc(label)}${item.tapped ? ' · tapped' : ''}</span>
  </div>`;
}

function heroGear(hero) {
  const slots = [
    gearSlot(hero?.weapon, 'Weapon'),
    gearSlot(hero?.offhand, 'Off-hand'),
    gearSlot(hero?.armor, 'Armour'),
    ...(hero?.belt || []).map((b) => gearSlot(b, 'Belt')),
  ].join('');
  return slots ? `<div class="clash-gear-row">${slots}</div>` : '';
}

/** Co-op partner on a side rail: small portrait, HP, and their hand (face-up when shared). */
function allySeat(state, pid, { isTurn, delta, joined, closing }) {
  const hero = state.heroes?.[pid];
  if (!hero) return '';
  const player = state.players?.find((p) => p.id === pid);
  const hand = hero.hand || [];
  const cards = hand
    .map((c) => `<div class="clash-mini">${flyCard(c, { size: 'mini' })}</div>`)
    .join('');
  return `
    <div class="clash-ally ${isTurn ? 'is-turn' : ''} ${joined ? 'is-joining' : ''} ${hero.downed && closing ? 'is-downed-seat' : ''}"
      data-ally="${escAttr(pid)}">
      <div class="clash-ally-head">
        <div class="clash-ally-portrait ${delta < 0 ? 'is-hit' : ''}">${renderHeroCard(hero.heroId, { size: 'mini', downed: hero.downed })}</div>
        <div class="clash-ally-info">
          <div class="clash-ally-name">
            <strong>${esc(hero.name)}</strong>
            ${isTurn ? '<span class="clash-chip is-live">Playing</span>' : ''}
          </div>
          ${player?.name && player.name !== hero.name ? `<span class="muted clash-ally-player">${esc(player.name)}</span>` : ''}
          ${hpMeter({ label: 'HP', hp: hero.hp ?? 0, maxHp: hero.maxHp ?? 10, delta, kind: 'hero' })}
        </div>
      </div>
      <div class="clash-ally-hand" data-fly="z:seat:${escAttr(pid)}" title="${hand.length} cards">
        ${cards || '<span class="muted">Empty hand</span>'}
      </div>
    </div>`;
}

const OUTCOME_TEXT = {
  victory: (clash) => ({ title: 'POOF!', sub: `${clash.monsterName} is defeated` }),
  flee: () => ({ title: 'Slipped away!', sub: 'The clash is over — for now' }),
  downed: () => ({ title: 'DOWNED!', sub: 'The clash is lost' }),
  ended: () => ({ title: 'Clash over', sub: '' }),
};

/**
 * Full-screen clash modal — a card table.
 *
 *   log / left partners | monster hand (top)   | monster card + stats
 *                       | deck · PILE · desp.  | right partners
 *   actions             | hero hand (bottom)   | hero card + gear
 *
 * A fighting hero always sees their own hand at the bottom; the dealer (and spectators)
 * see whoever holds the hero turn there. Other fighters sit small on the side rails.
 */
export function renderClashModal(state, isDealer, meId, fx = {}) {
  const clash = state.clash;
  if (!clash) return '';

  const closing = fx.closing || null;
  const { mainId, left, right, fighters } = clashSeats(state, isDealer, meId);
  const hero = state.heroes[mainId];
  const turnHero = state.heroes[clash.heroPlayerId];
  const heroTurn = clash.whoseTurn === 'hero';
  const mainHasTurn = heroTurn && mainId === clash.heroPlayerId;
  const isMine = meId === mainId;
  const canPlay = !closing && mainHasTurn && (isMine || isDealer);
  const canMonster = !closing && isDealer && clash.whoseTurn === 'monster';
  const showHand = isMine || isDealer;
  const activeMeta = SUIT_META[clash.activeSuit] || null;
  const activeColor = activeMeta?.color || '#888';
  const fighterHand = hero?.hand || [];
  const playOpts = clashPlayOptionsFor(hero);
  const hasCookie = Boolean(playOpts.forceParry);
  const belt = hero?.belt || [];
  const confettiIdx = belt.findIndex((b) => (b.gearId || b.id) === 'G-29');
  const isSolo = Object.keys(state.heroes || {}).length === 1;
  const healItems = belt
    .map((b, i) => ({ b, i, gid: b.gearId || b.id }))
    .filter(
      (x) =>
        x.gid === 'G-27' ||
        x.gid === 'G-28' ||
        (isSolo && (x.gid === 'G-25' || x.gid === 'G-26')),
    );
  const twinPending = clash.twinRank != null;
  const fighterNames = fighters.map((pid) => state.heroes[pid]?.name || pid);
  const heroDeltas = fx.heroDeltas || {};
  const mainDelta = heroDeltas[mainId] ?? (mainId === clash.heroPlayerId ? fx.heroDelta || 0 : 0);
  const monsterDelta = fx.monsterDelta || 0;
  const joined = fx.joined || [];
  const combatLines = (state.log || [])
    .filter((l) =>
      /clash|strike|parry|guard|daze|bounce|tucker|desperation|fumble|poof|dmg|hp|cramp|wild|hits|glancing|leads|monster|downed|boss|fighter/i.test(
        l,
      ),
    )
    .slice(0, 14);

  const turnLabel = heroTurn
    ? meId === clash.heroPlayerId
      ? 'Your turn'
      : `${turnHero?.name || 'Hero'}'s turn`
    : `${clash.monsterName}'s turn`;

  // —— Actions tray (bottom-left) ——
  const extraHp = RULES.bossHpPerExtraHero || 4;
  const joinHtml = (() => {
    if (!clash.isBoss || closing) return '';
    const outsiders = Object.keys(state.heroes || {}).filter((pid) => !fighters.includes(pid));
    if (isDealer) {
      return outsiders
        .filter((pid) => bossJoinCheck(state, pid).ok)
        .map(
          (pid) =>
            `<button type="button" data-clash-join="${escAttr(pid)}">Bring in ${esc(state.heroes[pid].name)} (+${extraHp} Boss HP)</button>`,
        )
        .join('');
    }
    if (!outsiders.includes(meId)) return '';
    const check = bossJoinCheck(state, meId);
    return check.ok
      ? `<button class="primary" type="button" data-clash-join="${escAttr(meId)}">Join the fight (+${extraHp} Boss HP)</button>`
      : `<p class="muted clash-tray-note">${esc(check.error)}</p>`;
  })();

  const noLegal =
    canPlay &&
    !twinPending &&
    !heroHasLegalPlay(hero, clash, playOpts) &&
    !(hasCookie && fighterHand.some((c) => !isCramp(c)));

  const healButtonsHtml = healItems
    .map(({ i, gid }) => {
      const isSalts = gid === 'G-25' || gid === 'G-26';
      const label = isSalts
        ? `Whiff Smelling Salts (+${RULES.smellingSaltsSoloHeal || 3} HP · free)`
        : 'Drink Fizz Potion (+4 HP · free)';
      return `<button type="button" data-clash-belt="${i}" data-belt-mode="heal" ${(hero?.hp ?? 0) >= (hero?.maxHp ?? 10) ? 'disabled' : ''}>${label}</button>`;
    })
    .join('');

  const actionsHtml = `
    <div class="clash-actions">
      ${fx.error ? `<p class="clash-error" role="alert">${esc(fx.error)}</p>` : ''}
      ${
        canPlay
          ? clash.heroDazed
            ? `
        <button type="button" class="primary" id="btn-clash-dazed-skip">Dazed — Skip Turn</button>
        ${healButtonsHtml}
        <p class="muted clash-tray-note">You are Dazed and miss this combat turn.</p>
      `
            : twinPending
            ? `
        <button type="button" class="primary" id="btn-clash-end-twin">Done with Twin Knives (skip 2nd Rank ${clash.twinRank})</button>
        ${healButtonsHtml}
        <p class="muted clash-tray-note">Twin Butter-Knives: play another Rank ${clash.twinRank} card or finish turn.</p>
      `
            : `
        <button type="button" id="btn-clash-desperation" class="${noLegal ? 'primary' : ''}">Flip Desperation</button>
        <button type="button" id="btn-clash-cramp" ${fighterHand.some((c) => isCramp(c)) ? '' : 'disabled'}>Stretch (discard ≤2 Cramp!)</button>
        ${
          hasCookie
            ? `<label class="muted clash-check">
                <input type="checkbox" id="chk-cookie-parry" /> Tap Cookie-Tin as Parry
              </label>`
            : ''
        }
        ${
          confettiIdx >= 0
            ? `<button type="button" data-clash-belt="${confettiIdx}" data-belt-mode="daze">Confetti Bomb — Daze (free)</button>
               <button type="button" data-clash-belt="${confettiIdx}" data-belt-mode="flee">Confetti Bomb — Flee</button>`
            : ''
        }
        ${healButtonsHtml}
        ${noLegal ? '<p class="muted clash-tray-note">No legal plays — Desperation recommended.</p>' : ''}
      `
          : ''
      }
      ${
        !closing && heroTurn && !canPlay
          ? `<p class="muted clash-tray-note" data-coach="clash-wait">Waiting for ${esc(turnHero?.name || 'hero')} to play…</p>`
          : ''
      }
      ${joinHtml}
      ${
        isDealer && !closing
          ? `<div class="clash-dealer-row">
              <span class="clash-zone-label">Dealer</span>
              <button type="button" id="btn-clash-win">Force POOF!</button>
              <button type="button" id="btn-clash-flee">Force flee</button>
            </div>`
          : ''
      }
    </div>`;

  // —— Bottom-centre hand ——
  const handLabel = showHand
    ? isMine
      ? 'Your hand'
      : `${hero?.name || 'Hero'}'s hand`
    : `${hero?.name || 'Hero'}'s hand`;
  const handCards = fighterHand
    .map((c) => {
      if (!showHand) {
        return `<div class="clash-card-btn is-private">${flyCard({ id: c.id, hidden: true })}</div>`;
      }
      const legal = canPlay && cardIsLegal(c, clash, playOpts, hasCookie);
      const cramp = isCramp(c);
      return `<button type="button" class="clash-card-btn ${legal ? 'legal' : ''} ${cramp ? 'is-cramp' : ''}"
        data-clash-card="${escAttr(c.id)}"
        ${legal ? '' : 'disabled'}
        title="${legal ? 'Play onto Clash Pile' : cramp ? 'Cramp! — use Stretch instead' : canPlay ? 'Illegal vs active Suit/Rank' : 'Not your turn'}">
        ${flyCard(c)}
      </button>`;
    })
    .join('');
  const handHtml = `
    <div class="clash-hand-block ${mainHasTurn && !closing ? 'is-turn' : ''}">
      <div class="clash-zone-label">
        ${esc(handLabel)}
        ${clash.needsDraw && canPlay ? '<span class="muted">· draws 1 on play</span>' : ''}
        ${
          showHand && hero?.perk && !hero.perkUsedThisClash
            ? `<span class="clash-perk" title="${escAttr(hero.perk.text)}">Perk ready: ${esc(hero.perk.name)}</span>`
            : ''
        }
      </div>
      ${showHand ? '' : `<p class="muted clash-hand-private">${esc(hero?.name || 'Hero')}'s hand is private.</p>`}
      <div class="clash-player-hand ${fighterHand.length >= 7 ? 'is-crowded' : ''}" data-fly="z:seat:${escAttr(mainId)}">
        ${handCards || '<span class="muted">Empty hand</span>'}
      </div>
    </div>`;

  // —— Side rails ——
  const seat = (pid) =>
    allySeat(state, pid, {
      isTurn: heroTurn && pid === clash.heroPlayerId && !closing,
      delta: heroDeltas[pid] || 0,
      joined: joined.includes(pid),
      closing,
    });
  const leftSeats = left.map(seat).join('');
  const rightSeats = right.map(seat).join('');

  // —— Monster side (top) ——
  const monsterChips = [
    `<span class="clash-chip">Cunning ${clash.cunning ?? '?'}</span>`,
    `<span class="clash-chip">Dmg ${clash.baseDmg ?? 1}</span>`,
    clash.enraged ? '<span class="clash-chip is-warn">Enraged!</span>' : '',
    clash.monsterDazed ? '<span class="clash-chip is-warn">Dazed</span>' : '',
    clash.pendingKoboldSwings > 0
      ? `<span class="clash-chip is-warn">${clash.pendingKoboldSwings} free swings</span>`
      : '',
    clash.isBoss ? `<span class="clash-chip">Acts every ${clash.bossEvery || 1} hero turn(s)</span>` : '',
  ].join('');
  const monsterTurnHtml = canMonster
    ? `<button class="primary clash-monster-go" type="button" id="btn-clash-monster">Resolve monster turn</button>`
    : !closing && clash.whoseTurn === 'monster'
      ? `<p class="muted clash-tray-note" data-coach="clash-wait">Waiting for dealer to resolve the monster turn…</p>`
      : '';

  const heroChips = [
    clash.heroDazed && mainId === clash.heroPlayerId ? '<span class="clash-chip is-warn">Dazed</span>' : '',
    clash.negateNextMonsterHit ? '<span class="clash-chip is-good">Ducking</span>' : '',
    hero?.downed ? '<span class="clash-chip is-warn">Downed</span>' : '',
  ].join('');

  const decks = state.decks || {};
  const lastDesp = clash.lastDesperation;
  const outcome = closing ? (OUTCOME_TEXT[closing] || OUTCOME_TEXT.ended)(clash) : null;

  const backdropClasses = [
    'clash-modal-backdrop',
    fx.entering ? 'is-entering' : '',
    fx.hitFlash ? 'clash-screen-hit' : '',
    closing ? `is-closing outcome-${closing}` : '',
  ].join(' ');

  const beltOverflowHtml = (() => {
    if (closing || state.phase !== 'clash' || state.pending?.kind !== 'belt-overflow') return '';
    const pending = state.pending;
    const mine = isDealer || pending.heroPlayerId === meId;
    const targetHero = state.heroes?.[pending.heroPlayerId];
    const opts = (pending.options || [])
      .map(
        (item, i) => `
          <div class="vault-option">
            <div class="vault-option-card">${renderGearChip(item.gearId || item.id, { size: 'hand' })}</div>
            <div class="vault-option-info">
              <strong>${esc(item.name)}</strong>
              <button type="button" data-belt-discard="${i}" ${mine ? '' : 'disabled'}>Discard ${esc(item.name)}</button>
            </div>
          </div>`,
      )
      .join('');
    return `
      <div class="table-prompt-overlay is-clash-prompt" role="dialog" aria-label="Belt full">
        <div class="table-prompt-card is-vault">
          <div class="table-prompt-head">
            <h3>Belt Full (2/2) — Discard 1</h3>
            <span class="muted">${esc(targetHero?.name || 'Hero')}</span>
          </div>
          <div class="vault-options">${opts}</div>
        </div>
      </div>`;
  })();

  return `
    <div class="${backdropClasses}" role="dialog" aria-modal="true" aria-label="Clash & Chain">
      <div class="clash-modal ${clash.isBoss ? 'is-boss' : ''}">
        <header class="clash-modal-header">
          <div class="clash-title">
            <p class="clash-kicker">${clash.isBoss ? 'Floor Boss' : 'Clash & Chain'}</p>
            <h2>${esc(fighterNames.join(' & '))} <span class="clash-vs">vs</span> ${esc(clash.monsterName)}</h2>
          </div>
          <p class="muted clash-note">${esc(clash.note || '')}</p>
          <div class="clash-turn-chip ${heroTurn ? 'is-hero' : 'is-monster'} ${fx.turnChanged ? 'just-changed' : ''}">
            ${esc(turnLabel)}
          </div>
        </header>

        <div class="clash-modal-body">
          <div class="clash-table" data-turn="${heroTurn ? 'hero' : 'monster'}">
            <div class="clash-col clash-col-left">
              <aside class="clash-combat-log">
                <h3>Combat log</h3>
                <div class="log clash-log">
                  ${
                    combatLines.map((l) => `<div class="clash-log-line">${formatCombatLogLine(l)}</div>`).join('') ||
                    '<div class="muted">Combat lines appear here.</div>'
                  }
                </div>
              </aside>
              ${leftSeats ? `<div class="clash-side clash-side-left">${leftSeats}</div>` : ''}
              ${actionsHtml}
            </div>

            <div class="clash-col clash-col-center">
              <section class="clash-zone clash-zone-mhand ${!heroTurn && !closing ? 'is-turn' : ''}">
                <div class="clash-zone-label">${esc(clash.monsterName)}'s hand</div>
                ${monsterHandFan(clash)}
                ${monsterTurnHtml}
              </section>

              <section class="clash-zone clash-zone-mid">
                <div class="clash-stacks">
                  <div class="clash-stack" data-fly="z:deck" title="Action Deck">
                    ${renderCardBack({ kind: 'action', size: 'mini' })}
                    ${stackCount(decks.actionCount)}
                    <span class="clash-stack-label">Deck</span>
                  </div>
                  <div class="clash-stack" title="Action discard">
                    <div class="clash-slot" data-fly="z:discard"></div>
                    ${stackCount(decks.actionDiscardCount)}
                    <span class="clash-stack-label">Discard</span>
                  </div>
                </div>

                <div class="clash-mid-stage ${fx.pileAnim ? 'stage-pulse' : ''}" data-coach="clash-pile">
                  ${pileStack(clash)}
                  <div class="clash-active-pill" style="--active:${activeColor}">
                    <span class="muted">Active</span>
                    <strong>${esc(activeMeta?.label || clash.activeSuit || '—')} ${clash.activeRank ?? ''}</strong>
                    <span class="muted">· pile ${clash.pileCount ?? clash.pile?.length ?? 0}</span>
                  </div>
                  ${
                    fx.turnChanged && !closing
                      ? `<div class="clash-turn-banner ${heroTurn ? 'is-hero' : 'is-monster'}" aria-live="polite"><span>${esc(turnLabel)}</span></div>`
                      : ''
                  }
                </div>

                <div class="clash-stacks">
                  <div class="clash-stack" data-fly="z:desp" title="Desperation Deck">
                    ${desperationBack()}
                    ${stackCount(decks.desperationCount)}
                    <span class="clash-stack-label">Desperation</span>
                  </div>
                  ${
                    lastDesp
                      ? `<div class="clash-stack clash-last-desp ${fx.desperation ? 'just-flipped' : ''}" title="Last Desperation flipped">
                          ${desperationCard(lastDesp)}
                          <span class="clash-stack-label">Last flip</span>
                        </div>`
                      : ''
                  }
                </div>
              </section>

              <section class="clash-zone clash-zone-hand" data-coach="clash">
                ${handHtml}
              </section>
            </div>

            <div class="clash-col clash-col-right">
              <section class="clash-zone clash-zone-monster ${!heroTurn && !closing ? 'is-turn' : ''}">
                <div class="clash-seat-row">
                  <div class="clash-seat-info">
                    <div class="clash-zone-label">${clash.isBoss ? 'Floor Boss' : 'Monster'}</div>
                    ${hpMeter({
                      label: clash.monsterName,
                      hp: clash.monsterHp,
                      maxHp: clash.monsterMaxHp,
                      delta: monsterDelta,
                      kind: 'monster',
                    })}
                    <div class="clash-chips">${monsterChips}</div>
                    ${clash.trait ? `<p class="muted clash-trait">${esc(clash.trait)}</p>` : ''}
                  </div>
                  <div class="clash-seat-card ${monsterDelta < 0 ? 'is-hit' : ''}">
                    ${renderMonsterCard(clash.monsterId, {
                      size: 'hand',
                      hp: clash.monsterHp,
                      maxHp: clash.monsterMaxHp,
                      isBoss: clash.isBoss,
                    })}
                  </div>
                </div>
              </section>

              ${rightSeats ? `<div class="clash-side clash-side-right">${rightSeats}</div>` : ''}

              <section class="clash-zone clash-zone-hero ${mainHasTurn && !closing ? 'is-turn' : ''}">
                <div class="clash-seat-row">
                  <div class="clash-seat-info">
                    <div class="clash-zone-label">${isMine ? 'You' : 'Hero'}</div>
                    ${hpMeter({
                      label: hero?.name || 'Hero',
                      hp: hero?.hp ?? 0,
                      maxHp: hero?.maxHp ?? 10,
                      delta: mainDelta,
                      kind: 'hero',
                    })}
                    ${heroChips ? `<div class="clash-chips">${heroChips}</div>` : ''}
                    ${heroGear(hero)}
                  </div>
                  <div class="clash-seat-card ${mainDelta < 0 ? 'is-hit' : ''}">
                    ${renderHeroCard(hero?.heroId, { size: 'hand', downed: hero?.downed })}
                  </div>
                </div>
              </section>
            </div>

            ${
              outcome
                ? `<div class="clash-outcome-banner" role="status">
                    <strong>${esc(outcome.title)}</strong>
                    ${outcome.sub ? `<span>${esc(outcome.sub)}</span>` : ''}
                  </div>`
                : ''
            }
          </div>
        </div>
      </div>
    </div>${beltOverflowHtml}`;
}

function wireLogCardHovers(root = document) {
  root.querySelectorAll('.log-card-mention').forEach((el) => {
    const tip = el.querySelector('.card-hover-tip');
    if (!tip) return;
    el.addEventListener('mouseenter', () => {
      const r = el.getBoundingClientRect();
      tip.classList.add('tip-fixed');
      tip.style.left = `${Math.min(r.left, window.innerWidth - 260)}px`;
      tip.style.top = `${Math.min(r.bottom + 8, window.innerHeight - 120)}px`;
    });
    el.addEventListener('mouseleave', () => {
      tip.classList.remove('tip-fixed');
      tip.style.left = '';
      tip.style.top = '';
    });
  });
}

/** Keep wheel/touch scroll inside modal scrollers; never chain to the page behind. */
function wireClashScrollContainment() {
  const backdrop = document.querySelector('.clash-modal-backdrop');
  if (!backdrop) return;

  const onWheel = (e) => {
    const scroller = e.target.closest?.('.clash-log, .clash-modal-body');
    if (!scroller) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
    const delta = e.deltaY;
    if (!delta) return;
    const atTop = scroller.scrollTop <= 0;
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    if ((delta < 0 && atTop) || (delta > 0 && atBottom)) {
      e.preventDefault();
    }
  };

  const onTouchMove = (e) => {
    const scroller = e.target.closest?.('.clash-log, .clash-modal-body');
    if (!scroller) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
  };

  backdrop.addEventListener('wheel', onWheel, { passive: false });
  backdrop.addEventListener('touchmove', onTouchMove, { passive: false });
}

/**
 * Lock document scroll while clash modal is open (and restore on close).
 */
export function syncClashBodyScrollLock(open) {
  const body = document.body;
  if (open) {
    if (!body.classList.contains('clash-open')) {
      body.dataset.clashScrollY = String(window.scrollY || window.pageYOffset || 0);
      body.style.top = `-${body.dataset.clashScrollY}px`;
      body.classList.add('clash-open');
    }
  } else if (body.classList.contains('clash-open')) {
    const y = Number(body.dataset.clashScrollY || 0);
    body.classList.remove('clash-open');
    body.style.top = '';
    delete body.dataset.clashScrollY;
    window.scrollTo(0, y);
  }
}

export function wireClashModal(room, session) {
  wireClashScrollContainment();
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
  document.getElementById('btn-clash-end-twin')?.addEventListener('click', () => {
    room.dispatch({ type: 'clash-end-twin' });
  });
  document.getElementById('btn-clash-dazed-skip')?.addEventListener('click', () => {
    room.dispatch({ type: 'clash-skip-dazed' });
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
      const playOpts = clashPlayOptionsFor(hero);
      const legalWithoutCookie =
        clash?.twinRank != null ||
        isLegalPlay(card, clash) ||
        isLegalPlay(card, clash, { bigSwing: playOpts.bigSwing && card?.suit === 'brawn' }) ||
        isLegalPlay(card, clash, {
          defensiveSparkAsAny: playOpts.defensiveSparkAsAny && card?.suit === 'spark',
        });
      if (
        document.getElementById('chk-cookie-parry')?.checked ||
        (playOpts.forceParry && !legalWithoutCookie)
      ) {
        action.forceParry = true;
      }
      if (
        hero?.perk?.id === 'improvised-zap' &&
        !hero.perkUsedThisClash &&
        card?.suit === 'spark' &&
        !isLegalPlay(card, clash)
      ) {
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
  document.querySelectorAll('[data-clash-join]').forEach((btn) => {
    btn.addEventListener('click', () => {
      room.dispatch({ type: 'join-boss-clash', playerId: btn.getAttribute('data-clash-join') });
    });
  });
  document.querySelectorAll('#clash-layer [data-belt-discard]').forEach((btn) => {
    btn.addEventListener('click', () => {
      room.dispatch({
        type: 'resolve-pending',
        discardIndex: Number(btn.getAttribute('data-belt-discard')),
      });
    });
  });
  wireLogCardHovers();
}

/** Wire log hovers outside clash (side panel log). */
export function wireTableLogHovers() {
  wireLogCardHovers();
}

function clashLayer() {
  let layer = document.getElementById('clash-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'clash-layer';
    document.body.appendChild(layer);
  }
  return layer;
}

function teardownClashModal(session, layer) {
  const ctl = session.clashCtl;
  if (ctl?.timer) clearTimeout(ctl.timer);
  Object.assign(ctl, { open: false, closing: false, key: null, snap: null, view: null, timer: null });
  layer.innerHTML = '';
  consumeClashFx(session, null);
  syncClashBodyScrollLock(false);
}

/**
 * Mount / update / retire the clash modal in its own layer, outside the table markup.
 *
 * The table re-renders on every status ping; the modal only repaints when the clash itself
 * (state version, viewer, or error line) changes, so card flights are never restarted.
 * When the clash leaves state, one last frame plays the result + cleanup before it closes.
 */
export function syncClashModal({ session, room, state, isDealer, meId }) {
  const ctl =
    session.clashCtl ||
    (session.clashCtl = { open: false, closing: false, key: null, snap: null, view: null, timer: null });
  const layer = clashLayer();
  const live = Boolean(state?.phase === 'clash' && state.clash);

  if (live) {
    const snap = snapClash(state);
    const key = [state.version, meId, isDealer ? 1 : 0, session.error || ''].join('|');
    const sameClash = ctl.open && !ctl.closing && ctl.snap?.key === snap.key;
    if (sameClash && ctl.key === key) return;

    if (ctl.timer) {
      clearTimeout(ctl.timer);
      ctl.timer = null;
    }
    if (!sameClash) consumeClashFx(session, null);
    const before = sameClash ? captureFly(layer) : null;
    const fx = consumeClashFx(session, state);
    const moves = sameClash ? diffClashMoves(ctl.snap, snap) : openingDealMoves(snap);

    layer.innerHTML = renderClashModal(state, isDealer, meId, {
      ...fx,
      entering: !sameClash,
      joined: moves.filter((m) => m.type === 'join').map((m) => m.heroId),
      desperation: moves.some((m) => m.type === 'desperation'),
      error: session.error,
    });
    wireClashModal(room, session);
    playFly(layer, before, moves, { baseDelay: sameClash ? 0 : 320 });

    Object.assign(ctl, { open: true, closing: false, key, snap, view: { state, isDealer, meId } });
    syncClashBodyScrollLock(true);
    return;
  }

  if (!ctl.open || ctl.closing) return;

  const outcome = clashOutcome(ctl.view.state, state);
  if (outcome === 'ended') {
    teardownClashModal(session, layer);
    return;
  }

  // Final frame: land the last card, show the result, sweep the table, then close.
  ctl.closing = true;
  const before = captureFly(layer);
  const closingState = closingClashState(ctl.view.state, state, outcome);
  const fx = consumeClashFx(session, closingState);
  const moves = diffClashMoves(ctl.snap, snapClash(closingState)).filter((m) => m.type !== 'turn');
  layer.innerHTML = renderClashModal(closingState, ctl.view.isDealer, ctl.view.meId, {
    ...fx,
    turnChanged: false,
    closing: outcome,
  });
  wireClashScrollContainment();
  playFly(layer, before, moves);
  const sweep = playCleanupSweep(layer, { delay: 700 });
  const hold = prefersReducedMotion() ? 1100 : Math.max(1600, sweep + 400);
  ctl.timer = setTimeout(() => {
    layer.querySelector('.clash-modal-backdrop')?.classList.add('is-leaving');
    ctl.timer = setTimeout(() => teardownClashModal(session, layer), 280);
  }, hold);
}
