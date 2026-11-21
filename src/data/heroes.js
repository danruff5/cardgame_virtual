/** Heroes H-01..H-04 from heroes_and_gear_c9b4.md */
export const HEROES = [
  {
    id: 'H-01',
    name: 'Sir Bumbles',
    title: 'the Enthusiastic Knight',
    maxHp: 10,
    preferredSuit: 'brawn',
    perk: {
      id: 'big-swing',
      name: 'Big Swing',
      text: 'Once per clash, add +1 Rank to any Red (Brawn) card you play.',
    },
    starterGear: ['G-01', 'G-02', 'G-03'],
    flavor: 'Nobody told him the armor helmet visor is stuck upside down.',
  },
  {
    id: 'H-02',
    name: 'Barnaby Brickwall',
    title: 'the Polite Sentinel',
    maxHp: 10,
    preferredSuit: 'grit',
    perk: {
      id: 'excuse-me-no',
      name: 'Excuse Me, No',
      text: 'Once per clash, scoring an exact-Rank Parry immediately heals 1 HP.',
    },
    starterGear: ['G-04', 'G-05', 'G-06'],
    flavor: 'Apologizes politely every time a goblin bounces off his shield.',
  },
  {
    id: 'H-03',
    name: 'Pip Squeak',
    title: 'the Snack-Powered Rogue',
    maxHp: 10,
    preferredSuit: 'zip',
    perk: {
      id: 'shortcut-tiptoe',
      name: 'Shortcut Tiptoe',
      text: 'Moving through already face-up cleared rooms costs half an Action (move 2 revealed empty rooms for 1 Action).',
    },
    starterGear: ['G-07', 'G-08', 'G-09'],
    flavor: 'Never explores a basement without pocket crackers.',
  },
  {
    id: 'H-04',
    name: 'Fizzlewig',
    title: 'the Sparkly Apprentice',
    maxHp: 10,
    preferredSuit: 'spark',
    perk: {
      id: 'improvised-zap',
      name: 'Improvised Zap',
      text: 'Once per clash, play any Purple (Spark) card as matching any Suit defensively (counts as Rank 2).',
    },
    starterGear: ['G-10', 'G-11', 'G-12'],
    flavor: "Still hasn't finished wizard school, mostly casts glitter.",
  },
];

export function getHero(id) {
  return HEROES.find((h) => h.id === id) ?? null;
}
