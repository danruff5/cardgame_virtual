/** Square Room Deck R-01..R-20 from dungeon_floor1_2d5d.md */

export const ROOMS = [
  { id: 'R-01', name: 'Doormat Entrance', kind: 'entrance', copies: 1, doorways: ['N', 'E', 'S', 'W'], startFaceUp: true, rule: 'Start Face-Up. All Heroes start here. Safe zone.', flavor: "A cheerful 'WELCOME ADVENTURERS' mat hides a squeaky floorboard." },
  { id: 'R-02', name: 'Spiral Slide / Stairway Down', kind: 'stairs', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Locked until Floor Boss defeated (or 5+ Zip/Brawn Key Stunt).', flavor: "Notice sign: 'Please tuck elbows before sliding to Floor 2!'" },
  { id: 'R-03', name: 'Cozy Cocoa Sanctuary Shrine', kind: 'shrine', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Once/Hero: Rest (1 Action) heal +3 HP, OR free revive DOWNED ally (5 HP + 4 cards).', flavor: 'Free marshmallows while supplies last.' },
  { id: 'R-04', name: 'Monster Lair', kind: 'monster', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Flip: movement ends; Dealer draws Floor 1 Monster and begins 1v1 Clash.', flavor: 'Someone definitely left muddy footprints everywhere.' },
  { id: 'R-05', name: 'Monster Lair', kind: 'monster', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Flip: movement ends; Dealer draws Floor 1 Monster and begins 1v1 Clash.', flavor: 'Someone definitely left muddy footprints everywhere.' },
  { id: 'R-06', name: 'Monster Lair', kind: 'monster', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Flip: movement ends; Dealer draws Floor 1 Monster and begins 1v1 Clash.', flavor: 'Someone definitely left muddy footprints everywhere.' },
  { id: 'R-07', name: 'Monster Lair', kind: 'monster', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Flip: movement ends; Dealer draws Floor 1 Monster and begins 1v1 Clash.', flavor: 'Someone definitely left muddy footprints everywhere.' },
  { id: 'R-08', name: 'Monster Lair', kind: 'monster', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Flip: movement ends; Dealer draws Floor 1 Monster and begins 1v1 Clash.', flavor: 'Someone definitely left muddy footprints everywhere.' },
  { id: 'R-09', name: 'Monster Lair', kind: 'monster', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Flip: movement ends; Dealer draws Floor 1 Monster and begins 1v1 Clash.', flavor: 'Someone definitely left muddy footprints everywhere.' },
  { id: 'R-10', name: 'Grand Boss Stage', kind: 'boss', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Flip: movement ends; place Floor Boss (12 HP + 3/extra Hero). Nearby Heroes may join.', flavor: 'Why is there dramatic spotlight lighting down here?' },
  { id: 'R-11', name: 'Sparkly Treasure Closet (Loot Vault)', kind: 'vault', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Spend 1 Action: draw 2 Loot, keep 1, discard 1 (then mark empty).', flavor: 'Somebody hid good stuff behind the extra mop buckets!' },
  { id: 'R-12', name: 'Sparkly Treasure Closet (Loot Vault)', kind: 'vault', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Spend 1 Action: draw 2 Loot, keep 1, discard 1 (then mark empty).', flavor: 'Somebody hid good stuff behind the extra mop buckets!' },
  { id: 'R-13', name: 'Sparkly Treasure Closet (Loot Vault)', kind: 'vault', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Spend 1 Action: draw 2 Loot, keep 1, discard 1 (then mark empty).', flavor: 'Somebody hid good stuff behind the extra mop buckets!' },
  { id: 'R-14', name: 'Sparkly Treasure Closet (Loot Vault)', kind: 'vault', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Spend 1 Action: draw 2 Loot, keep 1, discard 1 (then mark empty).', flavor: 'Somebody hid good stuff behind the extra mop buckets!' },
  { id: 'R-15', name: 'Silly Trap / Surprise Room', kind: 'trap', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Flip: draw 1 Trap / Curious Event; resolve choices or Stunt.', flavor: 'Suspiciously clean floor. Too clean...' },
  { id: 'R-16', name: 'Silly Trap / Surprise Room', kind: 'trap', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Flip: draw 1 Trap / Curious Event; resolve choices or Stunt.', flavor: 'Suspiciously clean floor. Too clean...' },
  { id: 'R-17', name: 'Story / Traveling Cart Room', kind: 'story', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Flip: play Part II Callback if stacked, else draw Story or Merchant.', flavor: 'Wait—how did a wooden wagon fit down the stairs?!' },
  { id: 'R-18', name: 'Story / Traveling Cart Room', kind: 'story', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Flip: play Part II Callback if stacked, else draw Story or Merchant.', flavor: 'Wait—how did a wooden wagon fit down the stairs?!' },
  { id: 'R-19', name: 'Echoing Hallway', kind: 'hallway', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Safe junction. Optional 1 Action: 4+ Spark/Zip Stunt for +1 Action card (once).', flavor: 'ECHO! (echo... echo...)' },
  { id: 'R-20', name: 'Echoing Hallway', kind: 'hallway', copies: 1, doorways: ['N', 'E', 'S', 'W'], rule: 'Safe junction. Optional 1 Action: 4+ Spark/Zip Stunt for +1 Action card (once).', flavor: 'ECHO! (echo... echo...)' },
];

/** Default 14-tile Floor Recipe from rulebook §2. */
export const DEFAULT_FLOOR_RECIPE_IDS = [
  'R-01', // Entrance
  'R-02', // Stairs
  'R-04', 'R-05', 'R-06', 'R-07', // 4 Monster Lairs
  'R-10', // Boss Stage
  'R-11', 'R-12', 'R-13', // 3 Vaults
  'R-15', 'R-16', // 2 Trap
  'R-17', // 1 Story/Cart
  'R-03', // Sanctuary
];

export function getRoom(id) {
  return ROOMS.find((r) => r.id === id) ?? null;
}

export function roomsForRecipe(ids = DEFAULT_FLOOR_RECIPE_IDS) {
  return ids.map((id) => {
    const room = getRoom(id);
    if (!room) throw new Error(`Unknown room id ${id}`);
    return { ...room };
  });
}
