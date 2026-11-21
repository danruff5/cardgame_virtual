import {
  renderActionCard,
  renderCardBack,
  renderHeroCard,
  renderMonsterCard,
  tipDataForActionCard,
  renderCardMention,
} from './cardView.js';
import { SUIT_META } from '../data/artMeta.js';
import { DESPERATION } from '../data/desperation.js';
import { isLegalPlay, isCramp, heroHasLegalPlay } from '../game/clash.js';

/**
 * Diff HP / pile against last paint so CSS flash/arrive classes fire once per change.
 */
export function consumeClashFx(session, state) {
  const clash = state?.clash;
  const fx = session.clashFx || (session.clashFx = {});
  if (!clash) {
    fx.prevHeroHp = null;
    fx.prevMonsterHp = null;
    fx.prevTopId = null;
    fx.prevPileLen = null;
    return { heroDelta: 0, monsterDelta: 0, pileAnim: false, hitFlash: false };
  }
  const hero = state.heroes[clash.heroPlayerId];
  const heroHp = hero?.hp ?? 0;
  const monHp = clash.monsterHp;
  const topId = clash.topCard?.id ?? null;
  const pileLen = clash.pile?.length ?? 0;

  const heroDelta = fx.prevHeroHp != null ? heroHp - fx.prevHeroHp : 0;
  const monsterDelta = fx.prevMonsterHp != null ? monHp - fx.prevMonsterHp : 0;
  const pileAnim =
    (fx.prevTopId != null && topId !== fx.prevTopId) ||
    (fx.prevPileLen != null && pileLen > fx.prevPileLen);

  fx.prevHeroHp = heroHp;
  fx.prevMonsterHp = monHp;
  fx.prevTopId = topId;
  fx.prevPileLen = pileLen;

  return {
    heroDelta,
    monsterDelta,
    pileAnim,
    hitFlash: heroDelta < 0 || monsterDelta < 0,
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
  return (
    isLegalPlay(c, clash) ||
    isLegalPlay(c, clash, { bigSwing: playOpts.bigSwing && c.suit === 'brawn' }) ||
    isLegalPlay(c, clash, {
      defensiveSparkAsAny: playOpts.defensiveSparkAsAny && c.suit === 'spark',
    }) ||
    (hasCookie && isLegalPlay(c, clash, { forceParry: true }))
  );
}

function hpMeter({ label, hp, maxHp, delta, kind }) {
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

function monsterHandBacks(count) {
  const n = Math.max(0, Number(count) || 0);
  const show = Math.min(n, 5);
  if (!n) {
    return `<div class="clash-monster-hand empty"><span class="muted">No cards</span></div>`;
  }
  const backs = Array.from({ length: show }, (_, i) => {
    const offset = (i - (show - 1) / 2) * 18;
    return `<div class="clash-back-slot" style="--fan:${offset}px">${renderCardBack({ kind: 'action', size: 'mini' })}</div>`;
  }).join('');
  return `
    <div class="clash-monster-hand" title="${n} cards in monster hand">
      <div class="clash-back-fan">${backs}</div>
      <span class="clash-hand-count" aria-label="${n} cards">${n}</span>
    </div>`;
}

function pileStack(clash, pileAnim) {
  const pile = clash.pile || [];
  const under = pile.length > 1 ? pile[pile.length - 2] : null;
  return `
    <div class="clash-pile ${pileAnim ? 'pile-arrive' : ''}">
      ${under ? `<div class="clash-pile-under">${renderActionCard(under, { size: 'hand' })}</div>` : ''}
      <div class="clash-pile-top">
        ${
          clash.topCard
            ? renderActionCard(clash.topCard, { size: 'hand' })
            : `<div class="clash-pile-empty muted">Clash pile</div>`
        }
      </div>
    </div>`;
}

/**
 * Full-screen clash modal — card table layout over exploration UI.
 * Preserves co-op boss fighters / bossEvery / perk & gear play options from release/floor1.
 */
export function renderClashModal(state, isDealer, meId, fx = {}) {
  const clash = state.clash;
  if (!clash) return '';

  const hero = state.heroes[clash.heroPlayerId];
  const isMyClash = meId === clash.heroPlayerId;
  const canPlay = clash.whoseTurn === 'hero' && (isMyClash || isDealer);
  const canMonster = isDealer && clash.whoseTurn === 'monster';
  const activeMeta = SUIT_META[clash.activeSuit] || null;
  const activeColor = activeMeta?.color || '#888';
  const fighterHand = hero?.hand || [];
  const showHand = isMyClash || isDealer;
  const playOpts = clashPlayOptionsFor(hero);
  const hasCookie = Boolean(playOpts.forceParry);
  const confettiIdx = (hero?.belt || []).findIndex((b) => b.id === 'G-29');
  const fighterNames = (clash.fighters || [clash.heroPlayerId])
    .map((pid) => state.heroes[pid]?.name || pid)
    .join(', ');
  const heroDelta = fx.heroDelta || 0;
  const monsterDelta = fx.monsterDelta || 0;
  const combatLines = (state.log || [])
    .filter((l) =>
      /clash|strike|parry|guard|daze|bounce|tucker|desperation|fumble|poof|dmg|hp|cramp|wild|hits|glancing|leads|monster|downed|boss|fighter/i.test(
        l,
      ),
    )
    .slice(0, 14);

  const titleHeroes =
    clash.isBoss && (clash.fighters?.length || 1) > 1
      ? fighterNames
      : hero?.name || 'Hero';

  return `
    <div class="clash-modal-backdrop ${fx.hitFlash ? 'clash-screen-hit' : ''}" role="dialog" aria-modal="true" aria-label="Clash & Chain" data-coach="clash">
      <div class="clash-modal">
        <header class="clash-modal-header">
          <div>
            <p class="clash-kicker">${clash.isBoss ? 'Floor Boss' : 'Clash & Chain'}</p>
            <h2>${esc(titleHeroes)} vs ${esc(clash.monsterName)}</h2>
            <p class="muted clash-note">${esc(clash.note || '')}</p>
            ${
              clash.isBoss
                ? `<p class="muted" style="margin:0.25rem 0 0">Fighters: ${esc(fighterNames)} · Boss acts every ${clash.bossEvery || 1} hero turn(s)</p>`
                : ''
            }
          </div>
          <div class="clash-active-pill" style="--active:${activeColor}">
            <span class="muted">Active</span>
            <strong>${esc(activeMeta?.label || clash.activeSuit || '—')} ${clash.activeRank ?? ''}</strong>
            <span class="clash-turn-chip">${
              clash.whoseTurn === 'hero'
                ? esc(hero?.name || 'Hero')
                : esc(clash.monsterName)
            }'s turn</span>
          </div>
        </header>

        <div class="clash-table">
          <section class="clash-zone clash-zone-monster">
            <div class="clash-zone-label">Dealer / Monster hand</div>
            ${monsterHandBacks(clash.monsterHand?.length ?? 0)}
            <div class="clash-monster-row">
              ${renderMonsterCard(clash.monsterId, {
                size: 'hand',
                hp: clash.monsterHp,
                maxHp: clash.monsterMaxHp,
                isBoss: clash.isBoss,
              })}
              ${hpMeter({
                label: clash.monsterName,
                hp: clash.monsterHp,
                maxHp: clash.monsterMaxHp,
                delta: monsterDelta,
                kind: 'monster',
              })}
            </div>
            ${clash.trait ? `<p class="muted clash-trait">${esc(clash.trait)}</p>` : ''}
          </section>

          <section class="clash-zone clash-zone-mid">
            <div class="clash-mid-stage ${fx.pileAnim ? 'stage-pulse' : ''}">
              ${pileStack(clash, fx.pileAnim)}
              <div class="clash-mid-meta">
                <div class="pill" style="border-color:${activeColor}">
                  Suit/Rank pressure: <strong style="color:${activeColor}">${esc(clash.activeSuit || '—')} ${clash.activeRank ?? ''}</strong>
                </div>
                <div class="muted">Pile ${clash.pile?.length ?? 0} · Base hit ${clash.baseDmg ?? 1}</div>
              </div>
            </div>
            <div class="clash-actions row" style="flex-wrap:wrap">
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
                ${
                  !heroHasLegalPlay(hero, clash, playOpts) &&
                  !(hasCookie && fighterHand.some((c) => !isCramp(c)))
                    ? '<span class="muted">No legal plays — Desperation recommended.</span>'
                    : ''
                }
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
                  ? `<p class="muted" data-coach="clash-wait">Waiting for ${esc(hero?.name || 'hero')} to play…</p>`
                  : ''
              }
            </div>
          </section>

          <section class="clash-zone clash-zone-hero">
            <div class="clash-hero-row">
              ${renderHeroCard(hero?.heroId, { size: 'hand', downed: hero?.downed })}
              ${hpMeter({
                label: hero?.name || 'Hero',
                hp: hero?.hp ?? 0,
                maxHp: hero?.maxHp ?? 10,
                delta: heroDelta,
                kind: 'hero',
              })}
            </div>
            ${
              showHand
                ? `<div>
                    <div class="clash-zone-label">Your hand ${
                      clash.needsDraw && canPlay ? '<span class="muted">(draws 1 on play)</span>' : ''
                    }</div>
                    ${
                      hero?.perk && !hero.perkUsedThisClash
                        ? `<p class="muted" style="margin:0 0 0.35rem;text-align:center">Perk ready: ${esc(hero.perk.name)} — ${esc(hero.perk.text)}</p>`
                        : ''
                    }
                    <div class="vcard-row hand clash-player-hand">
                      ${
                        fighterHand
                          .map((c) => {
                            const legal = canPlay && cardIsLegal(c, clash, playOpts, hasCookie);
                            const cramp = isCramp(c);
                            return `<button type="button" class="clash-card-btn ${legal ? 'legal' : ''} ${cramp ? 'is-cramp' : ''}"
                              data-clash-card="${escAttr(c.id)}"
                              ${legal ? '' : 'disabled'}
                              title="${legal ? 'Play onto Clash Pile' : cramp ? 'Cramp! — use Stretch instead' : 'Illegal vs active Suit/Rank'}">
                              ${renderActionCard(c, { size: 'hand' })}
                            </button>`;
                          })
                          .join('') || '<span class="muted">Empty hand</span>'
                      }
                    </div>
                  </div>`
                : `<p class="muted">${esc(hero?.name || 'Hero')}'s hand is private.</p>`
            }
          </section>
        </div>

        <aside class="clash-combat-log">
          <h3>Combat log</h3>
          <div class="log clash-log">
            ${
              combatLines.map((l) => `<div class="clash-log-line">${formatCombatLogLine(l)}</div>`).join('') ||
              '<div class="muted">Combat lines appear here.</div>'
            }
          </div>
        </aside>
      </div>
    </div>`;
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

export function wireClashModal(room, session) {
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
  wireLogCardHovers();
}

/** Wire log hovers outside clash (side panel log). */
export function wireTableLogHovers() {
  wireLogCardHovers();
}
