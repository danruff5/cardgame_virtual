import { describe, expect, it } from 'vitest';
import {
  rotateDoorways,
  doorwaysFace,
  tilesConnect,
  buildRandomFloorMap,
  buildFixedSnakeMap,
} from '../src/game/mapLayout.js';
import { DEFAULT_FLOOR_RECIPE_IDS } from '../src/data/rooms.js';
import { mulberry32 } from './helpers.js';

const DIRS = [
  { name: 'N', dx: 0, dy: -1, opposite: 'S' },
  { name: 'E', dx: 1, dy: 0, opposite: 'W' },
  { name: 'S', dx: 0, dy: 1, opposite: 'N' },
  { name: 'W', dx: -1, dy: 0, opposite: 'E' },
];

function assertConnected(tiles) {
  const byKey = new Map(tiles.map((t) => [t.key, t]));
  const start = tiles[0];
  const seen = new Set([start.key]);
  const q = [start.key];
  while (q.length) {
    const key = q.shift();
    const tile = byKey.get(key);
    for (const dir of DIRS) {
      const n = tiles.find((t) => t.x === tile.x + dir.dx && t.y === tile.y + dir.dy);
      if (!n || seen.has(n.key)) continue;
      if (!tilesConnect(tile, n)) continue;
      seen.add(n.key);
      q.push(n.key);
    }
  }
  expect(seen.size).toBe(tiles.length);
}

describe('doorway rotation helpers', () => {
  it('rotates doorways 90° clockwise', () => {
    expect(rotateDoorways(['N', 'E'], 1)).toEqual(['E', 'S']);
    expect(rotateDoorways(['N', 'E', 'S', 'W'], 2)).toEqual(['S', 'W', 'N', 'E']);
    expect(rotateDoorways(['N'], 4)).toEqual(['N']);
    expect(rotateDoorways(['E'], -1)).toEqual(['N']);
  });

  it('doorwaysFace respects rotation', () => {
    expect(doorwaysFace(['N'], 0, 'N')).toBe(true);
    expect(doorwaysFace(['N'], 1, 'E')).toBe(true);
    expect(doorwaysFace(['N'], 1, 'N')).toBe(false);
  });
});

describe('tilesConnect', () => {
  it('requires orthogonal adjacency and mutual doorways', () => {
    const a = { x: 0, y: 0, doorways: ['N', 'E', 'S', 'W'], rotation: 0 };
    const b = { x: 1, y: 0, doorways: ['N', 'E', 'S', 'W'], rotation: 0 };
    const far = { x: 2, y: 0, doorways: ['N', 'E', 'S', 'W'], rotation: 0 };
    const diag = { x: 1, y: 1, doorways: ['N', 'E', 'S', 'W'], rotation: 0 };
    expect(tilesConnect(a, b)).toBe(true);
    expect(tilesConnect(a, far)).toBe(false);
    expect(tilesConnect(a, diag)).toBe(false);
  });
});

describe('layout constraints (rulebook §2)', () => {
  it('default recipe has 14 tiles with required kinds', () => {
    expect(DEFAULT_FLOOR_RECIPE_IDS).toHaveLength(14);
    const map = buildFixedSnakeMap();
    expect(map.tiles).toHaveLength(14);
    const kinds = map.tiles.map((t) => t.kind);
    expect(kinds.filter((k) => k === 'entrance')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'stairs')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'boss')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'monster')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'vault')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'shrine')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'trap')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'merchant')).toHaveLength(1);
  });

  it('fixed snake is connected and stairs are ≥3 steps from entrance', () => {
    const map = buildFixedSnakeMap();
    assertConnected(map.tiles);
    expect(map.stairsDistance).toBeGreaterThanOrEqual(3);
    const entrance = map.tiles.find((t) => t.kind === 'entrance');
    const stairs = map.tiles.find((t) => t.kind === 'stairs');
    expect(entrance.faceUp).toBe(true);
    expect(entrance.cleared).toBe(true);
    expect(stairs.locked).toBe(true);
    expect(stairs.faceUp).toBe(false);
  });

  it('random layout is connected with stairs distance ≥ minStairsDist', () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const map = buildRandomFloorMap(DEFAULT_FLOOR_RECIPE_IDS, {
        rng: mulberry32(seed * 97),
        minStairsDist: 3,
        maxAttempts: 50,
      });
      expect(map.tiles).toHaveLength(14);
      assertConnected(map.tiles);
      expect(map.stairsDistance).toBeGreaterThanOrEqual(3);
      const keys = new Set(map.tiles.map((t) => t.key));
      expect(keys.size).toBe(14);
      const coords = new Set(map.tiles.map((t) => `${t.x},${t.y}`));
      expect(coords.size).toBe(14);
    }
  });

  it('unique keys after normalizeBounds (no overlapping cells)', () => {
    const map = buildRandomFloorMap(DEFAULT_FLOOR_RECIPE_IDS, {
      rng: mulberry32(42),
      minStairsDist: 3,
    });
    expect(Math.min(...map.tiles.map((t) => t.x))).toBe(0);
    expect(Math.min(...map.tiles.map((t) => t.y))).toBe(0);
  });
});
