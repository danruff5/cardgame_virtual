import { CATALOG } from './catalog.js';

/** Suit / frame / icon / art paths derived from canonical cards.json. */
export const SUIT_META = Object.fromEntries(
  Object.entries(CATALOG.suits).map(([key, s]) => [
    key,
    {
      label: s.label,
      color: s.color,
      frame: s.frame,
      icon: s.icon,
      art: s.art,
      glyph: s.glyph,
    },
  ]),
);

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
  ...Object.fromEntries(
    CATALOG.heroes.map((h) => [h.id, { art: h.art, frame: h.frame || 'frame_hero.png' }]),
  ),
  downed: {
    art: CATALOG.heroDownedBack.art,
    frame: CATALOG.heroDownedBack.frame || 'frame_hero.png',
  },
};

export const ROOM_ART = Object.fromEntries(
  CATALOG.rooms.map((r) => [r.virtualKind || r.kind, r.art]),
);

export const ROOM_BACK = CATALOG.backs.roomSquare;
export const ACTION_BACK = CATALOG.backs.action;

export const GEAR_ART = Object.fromEntries(CATALOG.gear.map((g) => [g.id, g.art]));

export const MONSTER_ART = {
  ...Object.fromEntries(CATALOG.monsters.map((m) => [m.id, m.art])),
  ...Object.fromEntries(CATALOG.bosses.map((b) => [b.id, b.art])),
};

export const SPECIAL_ICONS = { ...CATALOG.specialIcons };
