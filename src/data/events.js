import { CATALOG } from './catalog.js';

/** Events and merchants derived from canonical cards.json. */
export const EVENTS = CATALOG.events.map((e) => ({
  id: e.id,
  title: e.title,
  subtype: e.subtype,
  prompt: e.prompt,
  choices: [...e.choices],
}));

export const MERCHANTS = CATALOG.merchants.map((m) => ({
  id: m.id,
  name: m.name,
  greeting: m.greeting,
  deals: [...m.deals],
}));

export const STORIES = [
  {
    id: 'S-01A',
    part: 1,
    chain: 1,
    name: 'Clumsy Blacksmith Pip (Part I)',
    scene: 'Young blacksmith Pip accidentally welded his tongs to an anvil and needs spare scrap metal!',
    choices: [
      'A) Help Pip: Give 1 spare/equipped Weapon or Armor → tuck S-01B (Helped).',
      'B) Pilfer His Lunchbox: Grab 1 Tier 1 Loot → tuck S-01B (Grumpy!).',
    ],
    callbackId: 'S-01B',
  },
  {
    id: 'S-01B',
    part: 2,
    chain: 1,
    name: "Master Pip's Turbo Forge (Part II)",
    scene: "Pip's forge is roaring on Floor 2! He immediately spots your party.",
    choices: [
      'If Helped: reforge Weapon (+1 Strike) OR gift 1 free Tier 2–3 Weapon.',
      'If Pilfered: fight 6 HP Clanky Helper Bot (2 Dmg) before looting!',
    ],
  },
  {
    id: 'S-02A',
    part: 1,
    chain: 2,
    name: 'Upside-Down Mapmaker Barnacle (Part I)',
    scene: 'Explorer Barnacle tripped holding his giant map upside down and sprained an ankle!',
    choices: [
      'A) Patch Him Up: Discard 1 Consumable OR 4+ Grit/Zip Stunt → tuck S-02B.',
      'B) Laugh & Keep Moving: Take 1 Action draw, no Part II callback.',
    ],
    callbackId: 'S-02B',
  },
  {
    id: 'S-02B',
    part: 2,
    chain: 2,
    name: "Navigator Barnacle's Shortcut (Part II)",
    scene: 'Barnacle greets you on Floor 2 with his map right-side up at last!',
    choices: [
      'Reward: peek at any 3 face-down Square Rooms AND draw 1 free Belt Relic/Consumable.',
    ],
  },
  {
    id: 'S-03A',
    part: 1,
    chain: 3,
    name: 'Sir Reginald the Posh Badger (Part I)',
    scene: 'A dapper badger in a tiny top hat politely requests a small picnic contribution!',
    choices: [
      'A) Share Kindly: Give 1 Consumable OR discard 2 matching-Suit Action cards → tuck S-03B (Friend).',
      'B) Rude Shoo: Snatch 1 Action card → tuck S-03B (Snubbed).',
    ],
    callbackId: 'S-03B',
  },
  {
    id: 'S-03B',
    part: 2,
    chain: 3,
    name: "Sir Reginald's Fancy Trunk (Part II)",
    scene: 'Sir Reginald pops open his brass-bound steamer trunk on Floor 2!',
    choices: [
      'If Shared: Draw 3 Loot (incl. Tier 2–3) and keep 2.',
      'If Snubbed: lose 1 Belt item (or take 2 Dmg) unless calmed with 5+ Spark apology Stunt.',
    ],
  },
];
