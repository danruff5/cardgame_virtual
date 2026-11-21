/** Gear & consumables G-01..G-30 from heroes_and_gear_c9b4.md */
export const GEAR = [
  // Tier 0 starters
  { id: 'G-01', name: 'Slightly Bent Shortsword', slot: 'weapon', tier: 0, strike: 2, rule: 'Clean Strike: Deal 2 Dmg.', flavor: 'Curves nicely around corners!' },
  { id: 'G-02', name: 'Pot-Lid Buckler', slot: 'offhand', tier: 0, tapBlock: 1, rule: '[TAP] (90°): Block 1 Dmg once per clash.', flavor: "Smells faintly of Tuesday's stew." },
  { id: 'G-03', name: 'Cozy Quilted Tunic', slot: 'armor', tier: 0, ignoreRanks: [1], rule: 'Passive: Ignore damage from Monster Rank 1 cards.', flavor: 'Basically a wearable blanket.' },
  { id: 'G-04', name: 'Heavy Rolling Pin', slot: 'weapon', tier: 0, strike: 2, rule: 'Clean Strike: Deal 2 Dmg.', flavor: 'Good for pastry and pesky skeletons.' },
  { id: 'G-05', name: 'Trash-Bin Lid Shield', slot: 'offhand', tier: 0, tapBlock: 1, rule: '[TAP] (90°): Block 1 Dmg once per clash.', flavor: 'Makes a satisfying BONG sound.' },
  { id: 'G-06', name: 'Padded Sofa-Cushion Vest', slot: 'armor', tier: 0, ignoreRanks: [1], rule: 'Passive: Ignore damage from Monster Rank 1 cards.', flavor: 'Extra lumbar support in tight spots.' },
  { id: 'G-07', name: 'Butter-Knife Shiv', slot: 'weapon', tier: 0, strike: 1, strikeBonusSuit: 'zip', rule: 'Clean Strike: Deal 1 Dmg (+1 Dmg if Zip/Yellow card).', flavor: 'Spreads jam AND justice.' },
  { id: 'G-08', name: 'Checkered Picnic Scarf', slot: 'offhand', tier: 0, rule: 'Once/Floor: Gain +1 to any Stunt roll.', flavor: 'Never leave camp without napkins.' },
  { id: 'G-09', name: 'Patchwork Hoodie', slot: 'armor', tier: 0, ignoreRanks: [1], rule: 'Passive: Ignore damage from Monster Rank 1 cards.', flavor: 'Has six hidden snack pockets.' },
  { id: 'G-10', name: 'Sparkly Twig Wand', slot: 'weapon', tier: 0, strike: 1, strikeBonusSuit: 'spark', rule: 'Clean Strike: Deal 1 Dmg (+1 Dmg if Spark/Purple card).', flavor: 'Found behind the bakery!' },
  { id: 'G-11', name: 'Lucky Pocket Kaleidoscope', slot: 'offhand', tier: 0, rule: 'Once/Floor: Reroll 1 failed Stunt 1d6.', flavor: 'Ooh, pretty triangles!' },
  { id: 'G-12', name: 'Star-Pajama Robes', slot: 'armor', tier: 0, ignoreRanks: [1], rule: 'Passive: Ignore damage from Monster Rank 1 cards.', flavor: 'Maximum comfort, questionable dignity.' },
  // Tier 1
  { id: 'G-13', name: 'Twin Butter-Knives of Speed', slot: 'weapon', tier: 1, strike: 1, rule: 'Clean Strike: Deal 1 Dmg. You may play up to 2 matching-Rank cards in one turn (each hits!).', flavor: 'Double-sided breakfast fury!' },
  { id: 'G-14', name: 'Barn-Door Tower Shield', slot: 'offhand', tier: 1, tapBlock: 2, rule: 'Parries reflect 1 Dmg back; [TAP]: Block 2 Dmg.', flavor: 'Yes, it still has the brass doorknob.' },
  { id: 'G-15', name: 'Clinky Chainmail', slot: 'armor', tier: 1, ignoreRanks: [1, 2], rule: 'Passive: Ignore damage from Monster Rank 1–2 cards.', flavor: "Can't hear you sneaking over the jingle!" },
  { id: 'G-16', name: 'Comically Large Mallet', slot: 'weapon', tier: 1, strike: 2, gritIgnoresArmor: true, rule: 'Clean Strike: Deal 2 Dmg. All Grit (Blue) strikes ignore Monster Armor!', flavor: 'BONK!' },
  { id: 'G-17', name: 'Cookie-Tin Aegis', slot: 'offhand', tier: 1, rule: '[TAP]: Treat any 1 played card from your hand as an exact Parry!', flavor: "Wait—there's sewing needles inside!" },
  { id: 'G-18', name: 'Bouncy Rubber Boots', slot: 'armor', tier: 1, rule: 'Passive: Ignore 1 trap damage per Trap Room; +1 on all Zip Stunts.', flavor: 'Boing! Straight over the puddle.' },
  // Tier 2–3
  { id: 'G-19', name: 'Boom-Hammer of Boops', slot: 'weapon', tier: 2, strike: 2, gritIgnoresArmor: true, rule: 'Clean Strike: 2 Dmg; Grit ignores Armor. Trigger: Blue 4 auto-Daze!s the Monster.', flavor: 'Ring-a-ding-dong right between the eyes.' },
  { id: 'G-20', name: 'Sneaky Blanket of Vanishing', slot: 'armor', tier: 2, ignoreRanks: [1, 2], rule: 'Ignore Rank 1–2 hits. Trigger: Yellow 1 or 2 lets you tiptoe out of combat.', flavor: "If you can't see them, they can't see you." },
  { id: 'G-21', name: 'Overly Dramatic Greatsword', slot: 'weapon', tier: 2, strike: 3, rule: 'Clean Strike: 3 Dmg. Red 5 or 6 adds 1 Cramp!. Trigger: any Daze! deals +2 bonk Dmg.', flavor: 'Requires a wind machine to unsheathe properly.' },
  { id: 'G-22', name: 'Fizz-Pop Spellblade', slot: 'weapon', tier: 2, strike: 2, rule: 'Clean Strike: 2 Dmg. Trigger: Purple Bounce Back! heals 2 HP plus reflect.', flavor: 'Tastes like grape soda when swung!' },
  { id: 'G-23', name: 'Snack-Pocket Plate', slot: 'armor', tier: 2, ignoreRanks: [1, 2], rule: 'Ignore Rank 1–2 hits. Trigger: Red 3 heals 1 HP mid-fight.', flavor: 'Emergency pretzel compartment right in the chestplate.' },
  { id: 'G-24', name: 'Tick-Tock Pocket Lantern', slot: 'belt', tier: 2, rule: 'Passive Relic: Whenever you play Tuckered Out! (+2), immediately draw 1 Action Card.', flavor: 'Wait—we still have time for second breakfast!' },
  // Belt consumables
  { id: 'G-25', name: 'Wakey-Wakey Smelling Salts', slot: 'belt', tier: 'belt', type: 'revive', rule: '1 Exploration Action: Wake 1 DOWNED Hero in your room to 4 HP; they draw 4 fresh Action cards.', flavor: 'Smells like toasted marshmallows and mint!' },
  { id: 'G-26', name: 'Wakey-Wakey Smelling Salts', slot: 'belt', tier: 'belt', type: 'revive', rule: '1 Exploration Action: Wake 1 DOWNED Hero in your room to 4 HP; they draw 4 fresh Action cards.', flavor: 'Guaranteed to perk up any snoozing knight!' },
  { id: 'G-27', name: 'Strawberry Fizz Potion', slot: 'belt', tier: 'belt', type: 'heal', heal: 4, rule: 'Anytime (Free): Restore +4 HP (up to Max 10).', flavor: 'Shake gently before opening!' },
  { id: 'G-28', name: 'Strawberry Fizz Potion', slot: 'belt', tier: 'belt', type: 'heal', heal: 4, rule: 'Anytime (Free): Restore +4 HP (up to Max 10).', flavor: 'Now with extra silly straws!' },
  { id: 'G-29', name: 'Confetti Smoke Bomb', slot: 'belt', tier: 'belt', type: 'escape', rule: 'Combat Turn (Free): Automatically Daze! the Monster OR safely slip back into an adjacent cleared room.', flavor: "POOF! Happy birthday—I'm gone!" },
  { id: 'G-30', name: 'Second Wind Snack Charm', slot: 'belt', tier: 'belt', type: 'solo-charm', rule: '1v1 Hard Mode / Once per Floor: When hitting 0 HP, auto-revive at 4 HP and keep your entire hand.', flavor: 'Emergency cinnamon muffin saves the day!' },
];

export function getGear(id) {
  return GEAR.find((g) => g.id === id) ?? null;
}

export function gearByTier(tier) {
  return GEAR.filter((g) => g.tier === tier);
}
