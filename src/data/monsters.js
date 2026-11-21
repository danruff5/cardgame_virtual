/** Floor 1 monsters & bosses from dungeon_floor1_2d5d.md */
export const MONSTERS = [
  { id: 'MON-01', name: 'Sneaky Goblin Intern', hp: 3, cunning: 4, baseDmg: 1, trait: 'Unpaid Overtime: Zip cards played by this Monster count as +1 Rank.', loot: 'Draw 1 Action card', flavor: 'Just trying to finish his basement shift before 5 PM!' },
  { id: 'MON-02', name: 'Clattery Skeleton Bouncer', hp: 5, cunning: 3, baseDmg: 2, trait: 'Rattle Armor: Ignores the first 1 damage taken in this clash.', loot: 'Draw 1 Consumable', flavor: "Sorry pal, your boots aren't on the VIP list." },
  { id: 'MON-03', name: 'Grumpy Mushroom Lump', hp: 6, cunning: 3, baseDmg: 2, trait: 'Grumpy Spores: Hitting with Brawn puffs 1 Cramp! into your hand.', loot: 'Draw 1 Tier 1 Loot', flavor: 'WHO WOKE ME UP FROM MY NAP?!' },
  { id: 'MON-04', name: 'Wobbly Gelatin Cube', hp: 4, cunning: 4, baseDmg: 2, trait: 'Lime Jiggle: +1 Dmg if the Hero flipped a Desperation card this clash.', loot: 'Draw 1 Consumable', flavor: 'Smells suspiciously like key-lime pudding!' },
  { id: 'MON-05', name: 'Napping Mimic Ottoman', hp: 5, cunning: 4, baseDmg: 1, trait: 'Cozy Nap: Any Spark card played heals this Monster 1 HP instead of hurting it.', loot: 'Draw 1 Tier 1 Loot', flavor: 'Thought it was a comfy footstool—until it yawned with teeth!' },
  { id: 'MON-06', name: 'Shiny-Obsessed Rust Beetle', hp: 4, cunning: 3, baseDmg: 1, trait: "Button Nibbler: On hit, tap the Hero's Armor (or +1 Dmg if none/already tapped).", loot: 'Draw 1 Action card', flavor: 'Ooh, shiny belt buckles! Nom nom!' },
  { id: 'MON-07', name: 'Hangry Tunnel Troll', hp: 7, cunning: 3, baseDmg: 2, trait: 'Big Appetite: Rank 5–6 attacks deal +1 Dmg. (Can be bribed with Consumable via 4+ Spark Stunt!)', loot: 'Draw 1 Tier 1 Loot', flavor: 'Not evil—just skipped lunch!' },
  { id: 'MON-08', name: 'Three Kobolds in a Trenchcoat', hp: 4, cunning: 4, baseDmg: 1, trait: 'Three-Way Team: When anyone plays Daze!, this Monster gets two free 1 Dmg swings next turn instead of missing.', loot: 'Draw 1 Tier 1 Loot', flavor: 'Hello yes, I am definitely one regular tall gentleman.' },
];

export const BOSSES = [
  {
    id: 'B-01',
    name: 'Sir Clanks-a-Lot',
    title: 'the Over-Armored Warden',
    baseHp: 12,
    hpPerExtraHero: 3,
    cunning: 4,
    baseDmg: 2,
    trait: 'Way Too Much Metal: All Brawn Rank 1–2 attacks bounce (0 Dmg) unless Armor-pierced!',
    reward: '1 Tier 2–3 Boss Loot per Hero + Shiny Basement Key',
    flavor: 'CLANK-CLANK-SQUEAK! Wait, where did I drop my oil can?',
  },
  {
    id: 'B-02',
    name: 'Baron Von Boo',
    title: 'the Dramatic Basement Ghost',
    baseHp: 12,
    hpPerExtraHero: 3,
    cunning: 4,
    baseDmg: 2,
    trait: 'Theatrical Encore: Whenever any Hero resolves a Desperation Card, heal 1 HP!',
    reward: '1 Tier 2–3 Boss Loot per Hero + Shiny Basement Key',
    flavor: 'BEHOLD MY SPOOKINESS! ...Wait, is my cape tangled?',
  },
];

export function bossHp(bossId, heroCount) {
  const boss = BOSSES.find((b) => b.id === bossId);
  if (!boss) return 0;
  const extras = Math.max(0, heroCount - 1);
  return boss.baseHp + boss.hpPerExtraHero * extras;
}
