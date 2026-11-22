import { roomsForRecipe, DEFAULT_FLOOR_RECIPE_IDS } from '../data/index.js';

const DIRS = [
  { name: 'N', dx: 0, dy: -1, opposite: 'S' },
  { name: 'E', dx: 1, dy: 0, opposite: 'W' },
  { name: 'S', dx: 0, dy: 1, opposite: 'N' },
  { name: 'W', dx: -1, dy: 0, opposite: 'E' },
];

/** Rotate doorway labels 90° clockwise `times` times (0–3). */
export function rotateDoorways(doorways, times = 0) {
  const order = ['N', 'E', 'S', 'W'];
  const t = ((times % 4) + 4) % 4;
  return doorways.map((d) => order[(order.indexOf(d) + t) % 4]);
}

export function doorwaysFace(doorways, rotation, dirName) {
  return rotateDoorways(doorways, rotation).includes(dirName);
}

/**
 * True when two placed tiles share an edge and both doorways open toward each other.
 * (Floor 1 tiles are all N/E/S/W, so any rotation works; keep the check for rule fidelity.)
 */
export function tilesConnect(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
  const dir = DIRS.find((d) => d.dx === dx && d.dy === dy);
  if (!dir) return false;
  const aDoors = a.doorways || ['N', 'E', 'S', 'W'];
  const bDoors = b.doorways || ['N', 'E', 'S', 'W'];
  const aRot = a.rotation || 0;
  const bRot = b.rotation || 0;
  return doorwaysFace(aDoors, aRot, dir.name) && doorwaysFace(bDoors, bRot, dir.opposite);
}

function keyOf(x, y) {
  return `t-${x}-${y}`;
}

function makeTile(room, x, y, rotation = 0) {
  const faceUp = Boolean(room.startFaceUp);
  return {
    key: keyOf(x, y),
    x,
    y,
    roomId: room.id,
    kind: room.kind,
    name: room.name,
    rule: room.rule,
    doorways: [...(room.doorways || ['N', 'E', 'S', 'W'])],
    rotation,
    faceUp,
    cleared: faceUp,
    looted: false,
    locked: room.kind === 'stairs',
    shrineUsedBy: [],
    hallwayEchoUsed: false,
    merchant: null,
    eventResolved: false,
  };
}

function normalizeBounds(tiles) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tiles) {
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x);
    maxY = Math.max(maxY, t.y);
  }
  for (const t of tiles) {
    t.x -= minX;
    t.y -= minY;
    t.key = keyOf(t.x, t.y);
  }
  return { tiles, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function bfsDist(tiles, fromKey, toKey) {
  const byKey = new Map(tiles.map((t) => [t.key, t]));
  const start = byKey.get(fromKey);
  const goal = byKey.get(toKey);
  if (!start || !goal) return Infinity;
  const q = [{ key: fromKey, d: 0 }];
  const seen = new Set([fromKey]);
  while (q.length) {
    const cur = q.shift();
    if (cur.key === toKey) return cur.d;
    const tile = byKey.get(cur.key);
    for (const dir of DIRS) {
      const n = byKey.get(keyOf(tile.x + dir.dx, tile.y + dir.dy));
      if (!n || seen.has(n.key)) continue;
      if (!tilesConnect(tile, n)) continue;
      seen.add(n.key);
      q.push({ key: n.key, d: cur.d + 1 });
    }
  }
  return Infinity;
}

function occupiedSet(tiles) {
  return new Set(tiles.map((t) => `${t.x},${t.y}`));
}

function frontierSlots(tiles) {
  const occ = occupiedSet(tiles);
  const slots = [];
  for (const t of tiles) {
    for (const dir of DIRS) {
      const x = t.x + dir.dx;
      const y = t.y + dir.dy;
      const k = `${x},${y}`;
      if (occ.has(k)) continue;
      slots.push({ x, y, from: t, dir });
    }
  }
  // unique by coord
  const seen = new Set();
  return slots.filter((s) => {
    const k = `${s.x},${s.y}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Build a connected orthogonal layout for the Floor 1 recipe (rulebook §2).
 * Stairs (R-02) are placed at graph distance ≥ minStairsDist from entrance.
 */
export function buildRandomFloorMap(recipeIds = DEFAULT_FLOOR_RECIPE_IDS, options = {}) {
  const {
    rng = Math.random,
    minStairsDist = 3,
    maxAttempts = 40,
  } = options;

  let last = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const rooms = roomsForRecipe(recipeIds);
    const entrance = rooms.find((r) => r.kind === 'entrance');
    const stairs = rooms.find((r) => r.kind === 'stairs');
    const others = rooms.filter((r) => r.kind !== 'entrance' && r.kind !== 'stairs');
    shuffleInPlace(others, rng);

    if (!entrance || !stairs) throw new Error('Recipe missing entrance or stairs');

    const tiles = [makeTile(entrance, 0, 0, 0)];
    const queue = [...others, stairs];

    let failed = false;
    while (queue.length) {
      const room = queue.shift();
      const slots = frontierSlots(tiles);
      if (!slots.length) {
        failed = true;
        break;
      }
      shuffleInPlace(slots, rng);
      let placed = false;
      for (const slot of slots) {
        // All Floor 1 rooms have 4 doorways — any rotation aligns; pick random for art/state.
        const rotation = Math.floor(rng() * 4);
        const candidate = makeTile(room, slot.x, slot.y, rotation);
        if (!tilesConnect(slot.from, candidate)) continue;
        tiles.push(candidate);
        placed = true;
        break;
      }
      if (!placed) {
        failed = true;
        break;
      }
    }
    if (failed) continue;

    const map = normalizeBounds(tiles);
    const ent = map.tiles.find((t) => t.kind === 'entrance');
    const st = map.tiles.find((t) => t.kind === 'stairs');
    const dist = bfsDist(map.tiles, ent.key, st.key);
    last = { ...map, stairsDistance: dist };
    if (dist >= minStairsDist) return last;
  }

  // Fallback: fixed snake layout (deterministic connectivity) if RNG fails distance.
  return buildFixedSnakeMap(recipeIds);
}

/** Deterministic connected 4×4 snake — dealer “manual/fixed” fallback. */
export function buildFixedSnakeMap(recipeIds = DEFAULT_FLOOR_RECIPE_IDS) {
  const rooms = roomsForRecipe(recipeIds);
  const entrance = rooms.find((r) => r.kind === 'entrance');
  const stairs = rooms.find((r) => r.kind === 'stairs');
  const middle = rooms.filter((r) => r.kind !== 'entrance' && r.kind !== 'stairs');
  // Entrance first, stairs near the far end of the snake (≥3 steps).
  const ordered = [entrance, ...middle.slice(0, -1), stairs, ...middle.slice(-1)].filter(Boolean);
  const slots = [
    [0, 0], [1, 0], [2, 0], [3, 0],
    [3, 1], [2, 1], [1, 1], [0, 1],
    [0, 2], [1, 2], [2, 2], [3, 2],
    [3, 3], [2, 3],
  ];
  const tiles = ordered.map((room, i) => {
    const [x, y] = slots[i];
    return makeTile(room, x, y, 0);
  });
  const ent = tiles.find((t) => t.kind === 'entrance');
  const st = tiles.find((t) => t.kind === 'stairs');
  return {
    tiles,
    width: 4,
    height: 4,
    stairsDistance: bfsDist(tiles, ent.key, st.key),
  };
}
