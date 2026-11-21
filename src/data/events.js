/** Events, merchants, stories from dungeon_floor1_2d5d.md */
export const EVENTS = [
  {
    id: 'E-01',
    title: 'Slippery Banana-Peel Hallway',
    subtype: 'trap',
    prompt: 'Someone tossed an entire crate of bright yellow banana peels across the tiles! Your boots start sliding like ice skates.',
    choices: [
      'A) Zip 3+ Stunt to surf gracefully across & draw 1 Action card.',
      'B) Wipe out heroically — take 2 Dmg & gain 1 Cramp!.',
      'Or Improvise...',
    ],
  },
  {
    id: 'E-02',
    title: 'Wobbly Loose Floorboards',
    subtype: 'trap',
    prompt: 'Every second stone tile wobbles like a seesaw above a shallow puddle of sticky mud!',
    choices: [
      'A) Grit 4+ Stunt to balance across cleanly.',
      'B) Splat! Take 1 Dmg and your next room move costs 2 Actions.',
      'Or Improvise...',
    ],
  },
  {
    id: 'E-03',
    title: 'Complimenting Magic Mirror',
    subtype: 'curious',
    prompt: 'A gilded mirror beams happily: "My goodness, what splendid hair you have today!"',
    choices: [
      'A) Pose proudly! Heal +2 HP and draw 1 Action card.',
      'B) Polish the glass (Spark 3+): peek at 1 face-down Room card.',
      'Or Improvise...',
    ],
  },
  {
    id: 'E-04',
    title: 'Bubbling Soda-Potion Bench',
    subtype: 'curious',
    prompt: 'Bottles of fizzy berry, lemon, and grape potions bubble beside a sticky handwritten recipe!',
    choices: [
      'A) Sip safely: heal +2 HP (no roll needed).',
      'B) Mix two colors (Spark 4+): success = draw 1 Belt Consumable; fail = 1 Dmg + Dealer Twist.',
      'Or Improvise...',
    ],
  },
  {
    id: 'E-05',
    title: 'Singing Locked Treasure Chest',
    subtype: 'curious',
    prompt: 'A brass padlock on a bouncy wooden chest is humming an off-key opera ballad!',
    choices: [
      'A) Zip or Brawn 4+ Stunt: pop it open for 1 Tier 1 Loot!',
      'B) Hum along awkwardly and leave it alone (Dealer draws 1 Twist).',
      'Or Improvise...',
    ],
  },
  {
    id: 'E-06',
    title: 'Ticklish Gargoyle Statue',
    subtype: 'trap',
    prompt: 'A stone gargoyle blocks the archway, grinning suspiciously while holding a tiny brass bell.',
    choices: [
      'A) Tickle its chin (Zip 3+): it giggles aside and drops 1 Action card!',
      'B) Try sneaking past (Grit 4+): fail = rings loudly & Dealer draws 1 Twist.',
      'Or Improvise...',
    ],
  },
];

export const MERCHANTS = [
  {
    id: 'M-01',
    name: 'Barnaby the Bargain Goblin',
    greeting: 'A cheerful goblin in a patched vest rolls out a velvet blanket covered in mismatched spoons and shields!',
    deals: [
      'Trade Gear: Discard 1 equipped or spare Gear to draw 2 Tier 1 Loot and keep 1.',
      'Bundle Deal: Trade 2 Belt Consumables for 1 Tier 1 Loot.',
      'Or Improvise: Zip/Spark 4+ haggle for 1 free Action draw (once/Hero).',
    ],
  },
  {
    id: 'M-02',
    name: "Granny Fizz's Portable Potion Cart",
    greeting: 'A sweet badger-granny wheels up a kettle cart smelling of cinnamon and fizzy berries!',
    deals: [
      'Brew Swap: Trade 1 spare Gear or Consumable for Strawberry Fizz Potion or Wakey-Wakey Smelling Salts.',
      'Card Trade: Discard 2 Grit/Spark Action cards to heal +3 HP.',
      'Or Improvise...',
    ],
  },
];

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
      'Or Improvise...',
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
      'Or Improvise...',
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
      'Or Improvise...',
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
