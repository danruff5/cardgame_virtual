import { CATALOG } from './catalog.js';

/** Square Room Deck R-01..R-20 derived from canonical cards.json (with mechanics-only virtual projection). */
export const ROOMS = CATALOG.rooms.map((r) => ({
  id: r.id,
  name: r.virtualName || r.name,
  kind: r.virtualKind || r.kind,
  copies: r.copies,
  doorways: [...r.doorways],
  ...(r.startFaceUp ? { startFaceUp: true } : {}),
  rule: r.virtualRule || r.rule,
  flavor: r.flavor,
}));

export const DEFAULT_FLOOR_RECIPE_IDS = [...CATALOG.defaultFloorRecipeIds];

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
