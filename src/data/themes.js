/** Floor themes & dealer twists from dungeon_floor1_2d5d.md */
export const THEMES = [
  {
    id: 'T-01',
    name: 'The Wobbly Shifting Maze',
    rule: 'Once per full round, at the end of a Dealer turn, the Dealer may swap any 2 unflipped Square Room tiles on the map!',
    flavor: "Didn't that hallway go left five minutes ago?",
  },
  {
    id: 'T-02',
    name: 'Goblin Flea Market',
    rule: 'All Trap / Surprise Rooms act as shady bargain stalls too — any Monster may be bribed out of fighting with 1 Gear/Consumable via a 3+ Zip/Spark Stunt!',
    flavor: "Everything's on sale—especially questionable cheese.",
  },
  {
    id: 'T-03',
    name: 'The Haunted Attic Basement',
    rule: 'All Spark (Purple) cards deal +1 Dmg (Heroes AND Monsters!), and the Sanctuary Shrine has a polite Ghost Bouncer guarding the cocoa.',
    flavor: 'Spooky cobwebs, surprisingly cozy throw pillows.',
  },
];

export const TWISTS = [
  { id: 'TW-01', name: 'Musical Rooms!', copies: 1, effect: 'Between Hero turns: Swap positions of any 2 unflipped Square Room cards.', flavor: 'Who rearranged the furniture?!' },
  { id: 'TW-02', name: 'Musical Rooms!', copies: 1, effect: 'Between Hero turns: Swap positions of any 2 unflipped Square Room cards.', flavor: 'Who rearranged the furniture?!' },
  { id: 'TW-03', name: 'Musical Rooms!', copies: 1, effect: 'Between Hero turns: Swap positions of any 2 unflipped Square Room cards.', flavor: 'Who rearranged the furniture?!' },
  { id: 'TW-04', name: 'Sticky Door Jam!', copies: 1, effect: 'Between Hero turns: Place a jammed barrier between 2 adjacent Rooms (1 Action 3+ Brawn Stunt to pry open).', flavor: 'Someone spilled super-duper jam on the hinges!' },
  { id: 'TW-05', name: 'Sticky Door Jam!', copies: 1, effect: 'Between Hero turns: Place a jammed barrier between 2 adjacent Rooms (1 Action 3+ Brawn Stunt to pry open).', flavor: 'Someone spilled super-duper jam on the hinges!' },
  { id: 'TW-06', name: 'Hall Monitor Patrol!', copies: 1, effect: 'After a Hero turn: Slide 1 unengaged revealed Monster 1 room closer to the nearest Hero.', flavor: 'NO RUNNING IN THE CORRIDORS!' },
  { id: 'TW-07', name: 'Hall Monitor Patrol!', copies: 1, effect: 'After a Hero turn: Slide 1 unengaged revealed Monster 1 room closer to the nearest Hero.', flavor: 'NO RUNNING IN THE CORRIDORS!' },
  { id: 'TW-08', name: 'Boss Espresso Shot!', copies: 1, effect: 'During combat: Active Monster gains +2 HP (up to Max) OR draws 2 Action cards.', flavor: "Double shot with whipped cream, let's GO!" },
  { id: 'TW-09', name: 'Boss Espresso Shot!', copies: 1, effect: 'During combat: Active Monster gains +2 HP (up to Max) OR draws 2 Action cards.', flavor: "Double shot with whipped cream, let's GO!" },
  { id: 'TW-10', name: 'Untied Shoelaces!', copies: 1, effect: 'When Hero enters combat or moves: Target Hero adds 1 Cramp! and loses 1 Exploration Action (min 0).', flavor: "Hey, your shoe's untied! Made ya look!" },
  { id: 'TW-11', name: 'Untied Shoelaces!', copies: 1, effect: 'When Hero enters combat or moves: Target Hero adds 1 Cramp! and loses 1 Exploration Action (min 0).', flavor: "Hey, your shoe's untied! Made ya look!" },
  { id: 'TW-12', name: 'Surprise Intern!', copies: 1, effect: 'Between Hero turns: Spawn a 3 HP Sneaky Goblin Intern (MON-01) inside any cleared empty room!', flavor: 'Hi! Where do I put these extra brooms?' },
];
