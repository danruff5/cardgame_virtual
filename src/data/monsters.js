import { CATALOG, RULES } from './catalog.js';

/** Floor 1 monsters & bosses derived from canonical cards.json. */
export const MONSTERS = CATALOG.monsters.map((m) => ({
  id: m.id,
  name: m.name,
  hp: m.hp,
  cunning: m.cunning,
  baseDmg: m.baseDmg,
  traitId: m.traitId,
  trait: m.trait,
  loot: m.loot,
  flavor: m.flavor,
}));

export const BOSSES = CATALOG.bosses.map((b) => ({
  id: b.id,
  name: b.name,
  title: b.title,
  baseHp: b.baseHp ?? RULES.bossBaseHp,
  hpPerExtraHero: b.hpPerExtraHero ?? RULES.bossHpPerExtraHero,
  cunning: b.cunning,
  baseDmg: b.baseDmg,
  traitId: b.traitId,
  trait: b.trait,
  reward: b.reward,
  flavor: b.flavor,
}));

export function bossHp(bossId, heroCount) {
  const boss = BOSSES.find((b) => b.id === bossId);
  if (!boss) return 0;
  const extras = Math.max(0, heroCount - 1);
  return boss.baseHp + boss.hpPerExtraHero * extras;
}
