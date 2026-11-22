/** Suit / frame / icon / art paths matching print_and_play.html compositor. */
export const SUIT_META = {
  brawn: {
    label: 'BRAWN',
    color: '#D9483B',
    frame: 'frame_brawn.png',
    icon: 'icon_brawn.png',
    art: 'art_suit_brawn.png',
    glyph: 'M12 2L15 8L21 9L17 14L18 21L12 18L6 21L7 14L3 9L9 8Z',
  },
  grit: {
    label: 'GRIT',
    color: '#2F6FB8',
    frame: 'frame_grit.png',
    icon: 'icon_grit.png',
    art: 'art_suit_grit.png',
    glyph: 'M12 2L20 5V11C20 16.5 16.6 20.8 12 22C7.4 20.8 4 16.5 4 11V5L12 2Z',
  },
  zip: {
    label: 'ZIP',
    color: '#E3A723',
    frame: 'frame_zip.png',
    icon: 'icon_zip.png',
    art: 'art_suit_zip.png',
    glyph: 'M13 2L4 14H11L10 22L20 10H13L13 2Z',
  },
  spark: {
    label: 'SPARK',
    color: '#7E4BB5',
    frame: 'frame_spark.png',
    icon: 'icon_spark.png',
    art: 'art_suit_spark.png',
    glyph: 'M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5Z',
  },
  wild: {
    label: 'WILD',
    color: '#D99B26',
    frame: 'frame_wild.png',
    icon: 'icon_wild.png',
    art: 'art_wild_starburst.png',
    glyph: 'M3 18H21V20H3V18ZM4 16L6 7L10 11L12 4L14 11L18 7L20 16H4Z',
  },
};

/** Prefer optimized WebP; accept .png filenames from the print compositor. */
function webPath(folder, file) {
  const name = String(file || '').replace(/\.(png|webp|jpe?g)$/i, '');
  return `./assets/${folder}/${name}.webp`;
}

export const ASSET = {
  frames: (file) => webPath('frames', file),
  art: (file) => webPath('art', file),
  icons: (file) => webPath('icons', file),
  ui: (file) => `./assets/ui/${file}`,
};

export const HERO_ART = {
  'H-01': { art: 'art_hero_bumbles.png', frame: 'frame_hero.png' },
  'H-02': { art: 'art_hero_barnaby.png', frame: 'frame_hero.png' },
  'H-03': { art: 'art_hero_pip.png', frame: 'frame_hero.png' },
  'H-04': { art: 'art_hero_fizzlewig.png', frame: 'frame_hero.png' },
  downed: { art: 'art_hero_downed_stars.png', frame: 'frame_hero.png' },
};

export const ROOM_ART = {
  entrance: 'art_room_entrance.png',
  stairs: 'art_room_stairs.png',
  shrine: 'art_room_shrine.png',
  monster: 'art_room_lair.png',
  boss: 'art_room_boss.png',
  vault: 'art_room_vault.png',
  trap: 'art_room_trap.png',
  merchant: 'art_room_story.png',
  hallway: 'art_room_hall.png',
};

export const ROOM_BACK = 'back_room_square.png';
export const ACTION_BACK = 'back_action.png';

export const GEAR_ART = {
  'G-01': 'art_gear_starter_sword.png',
  'G-02': 'art_gear_starter_shield.png',
  'G-03': 'art_gear_starter_armor.png',
  'G-04': 'art_gear_rolling_pin.png',
  'G-05': 'art_gear_starter_shield.png',
  'G-06': 'art_gear_starter_armor.png',
  'G-07': 'art_gear_butter_knife.png',
  'G-08': 'art_gear_scarf.png',
  'G-09': 'art_gear_starter_armor.png',
  'G-10': 'art_gear_twig_wand.png',
  'G-11': 'art_gear_kaleidoscope.png',
  'G-12': 'art_gear_pajama_robes.png',
  'G-13': 'art_gear_twin_knives.png',
  'G-14': 'art_gear_barn_shield.png',
  'G-15': 'art_gear_chainmail.png',
  'G-16': 'art_gear_large_mallet.png',
  'G-17': 'art_gear_cookie_aegis.png',
  'G-18': 'art_gear_bouncy_boots.png',
  'G-19': 'art_gear_boom_hammer.png',
  'G-20': 'art_gear_sneaky_blanket.png',
  'G-21': 'art_gear_dramatic_sword.png',
  'G-22': 'art_gear_fizz_blade.png',
  'G-23': 'art_gear_snack_plate.png',
  'G-24': 'art_gear_lantern.png',
  'G-25': 'art_item_revive_salts.png',
  'G-26': 'art_item_revive_salts.png',
  'G-27': 'art_item_fizz_potion.png',
  'G-28': 'art_item_fizz_potion.png',
  'G-29': 'art_item_confetti_bomb.png',
  'G-30': 'art_item_muffin_charm.png',
};

export const MONSTER_ART = {
  'MON-01': 'art_mon_goblin_intern.png',
  'MON-02': 'art_mon_skeleton_bouncer.png',
  'MON-03': 'art_mon_mushroom_lump.png',
  'MON-04': 'art_mon_gelatin_cube.png',
  'MON-05': 'art_mon_mimic_ottoman.png',
  'MON-06': 'art_mon_rust_beetle.png',
  'MON-07': 'art_mon_tunnel_troll.png',
  'MON-08': 'art_mon_three_kobolds.png',
  'B-01': 'art_boss_sir_clanks.png',
  'B-02': 'art_boss_baron_boo.png',
};

export const SPECIAL_ICONS = {
  daze: 'icon_daze.png',
  bounce: 'icon_bounce.png',
  tuckered: 'icon_tuckered.png',
  wild: 'icon_wild.png',
  cramp: 'icon_tuckered.png',
};
