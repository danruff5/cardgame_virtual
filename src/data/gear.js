import { CATALOG } from './catalog.js';

/** Gear & consumables G-01..G-30 derived from canonical cards.json. */
export const GEAR = CATALOG.gear.map((g) => ({
  id: g.id,
  name: g.name,
  slot: g.slot,
  tier: g.tier,
  type: g.type,
  strike: g.strike,
  strikeBonusSuit: g.strikeBonusSuit,
  tapBlock: g.tapBlock,
  parryReflect: g.parryReflect,
  ignoreRanks: g.ignoreRanks ? [...g.ignoreRanks] : undefined,
  gritIgnoresArmor: g.gritIgnoresArmor,
  heal: g.heal,
  soloHeal: g.soloHeal,
  reviveHp: g.reviveHp,
  reviveCards: g.reviveCards,
  rule: g.rule,
  flavor: g.flavor,
}));

export function getGear(id) {
  return GEAR.find((g) => g.id === id) ?? null;
}

export function gearByTier(tier) {
  return GEAR.filter((g) => g.tier === tier);
}

/** Floor 1 loot pool: Tier 1 dungeon loot + belt consumables (rulebook §2). */
export function buildFloor1LootDeck() {
  const tier1 = gearByTier(1);
  const belt = GEAR.filter((g) => g.tier === 'belt' && g.type !== 'solo-charm');
  const pool = [...tier1, ...belt];
  return pool.map((g) => ({
    id: `${g.id}-${Math.random().toString(36).slice(2, 7)}`,
    gearId: g.id,
    name: g.name,
    slot: g.slot,
    tier: g.tier,
    type: g.type || null,
    rule: g.rule,
    flavor: g.flavor,
  }));
}
