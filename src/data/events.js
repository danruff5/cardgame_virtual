/** Events and merchants from dungeon_floor1_2d5d.md */
export const EVENTS = [
  {
    id: 'E-01',
    title: 'Slippery Banana-Peel Hallway',
    subtype: 'trap',
    prompt: 'Someone tossed an entire crate of bright yellow banana peels across the tiles! Your boots start sliding like ice skates.',
    choices: [
      'A) Zip 3+ Stunt to surf gracefully across & draw 1 Action card.',
      'B) Wipe out heroically — take 2 Dmg & gain 1 Cramp!.',
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
    ],
  },
  {
    id: 'M-02',
    name: "Granny Fizz's Portable Potion Cart",
    greeting: 'A sweet badger-granny wheels up a kettle cart smelling of cinnamon and fizzy berries!',
    deals: [
      'Brew Swap: Trade 1 spare Gear or Consumable for Strawberry Fizz Potion or Wakey-Wakey Smelling Salts.',
      'Card Trade: Discard 2 Grit/Spark Action cards to heal +3 HP.',
    ],
  },
];
