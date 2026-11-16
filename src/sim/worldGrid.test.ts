import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  MAX_TEMPERATURE_C,
  MIN_TEMPERATURE_C,
  TERRAIN_TYPES,
  WORLD_BIOME_IDS,
  WorldGrid,
  classifyTerrain,
  classifyWorldBiome,
  isTerrainBiomeCompatible,
} from './worldGrid';

test('WorldGrid: deterministic generation by seed and distinct maps for different seeds', () => {
  const g1 = WorldGrid.generate({ width: 64, height: 36, seed: 'pangaea-42' });
  const g2 = WorldGrid.generate({ width: 64, height: 36, seed: 'pangaea-42' });
  const g3 = WorldGrid.generate({ width: 64, height: 36, seed: 'pangaea-43' });

  assert.equal(g1.width, 64);
  assert.equal(g1.height, 36);
  assert.equal(g1.cellCount, 64 * 36);

  assert.deepEqual(g1.elevation, g2.elevation);
  assert.deepEqual(g1.terrainCode, g2.terrainCode);
  assert.deepEqual(g1.temperature, g2.temperature);
  assert.deepEqual(g1.moisture, g2.moisture);
  assert.deepEqual(g1.biomeCode, g2.biomeCode);
  assert.deepEqual(g1.waterDepth, g2.waterDepth);
  assert.deepEqual(g1.biomass, g2.biomass);

  let diffCount = 0;
  for (let i = 0; i < g1.cellCount; i++) {
    if (g1.elevation[i] !== g3.elevation[i]) diffCount++;
  }
  assert.ok(diffCount > g1.cellCount * 0.5, 'Different seeds must produce different elevation maps');
});

test('WorldGrid: all generated cells satisfy strict finite value & range invariants', () => {
  const grid = WorldGrid.generate({ width: 120, height: 70, seed: 2026 });
  const terrainSet = new Set<string>(TERRAIN_TYPES);
  const biomeSet = new Set<string>(WORLD_BIOME_IDS);

  for (let i = 0; i < grid.cellCount; i++) {
    const cell = grid.getCellByIndex(i);
    assert.ok(Number.isFinite(cell.elevation) && cell.elevation >= 0 && cell.elevation <= 1);
    assert.ok(
      Number.isFinite(cell.temperature) &&
        cell.temperature >= MIN_TEMPERATURE_C &&
        cell.temperature <= MAX_TEMPERATURE_C
    );
    assert.ok(Number.isFinite(cell.moisture) && cell.moisture >= 0 && cell.moisture <= 1);
    assert.ok(Number.isFinite(cell.waterDepth) && cell.waterDepth >= 0 && cell.waterDepth <= 1);
    assert.ok(Number.isFinite(cell.biomass) && cell.biomass >= 0 && cell.biomass <= 1);
    assert.equal(cell.hasWater, cell.waterDepth > 0);
    assert.ok(terrainSet.has(cell.terrain), `Unexpected terrain: ${cell.terrain}`);
    assert.ok(biomeSet.has(cell.biome), `Unexpected biome: ${cell.biome}`);
    if (cell.hasWater) {
      assert.equal(cell.biomass, 0, 'Water cells must have 0 terrestrial biomass at generation');
    }
  }

  const stats = grid.getStats();
  assert.ok(stats.waterCells > 0, 'Generated world should contain water cells');
  assert.ok(stats.landCells > 0, 'Generated world should contain land cells');
  assert.ok(stats.totalBiomass > 0, 'Generated world should contain plant biomass');
  const activeBiomes = Object.values(stats.biomeCounts).filter((c) => c > 0).length;
  assert.ok(activeBiomes >= 4, `Expected >= 4 distinct biomes on 120x70 map, got ${activeBiomes}`);
});

test('WorldGrid: configurable sizes, coordinate validation, and cell read/write mutations', () => {
  assert.throws(() => WorldGrid.generate({ width: 0, height: 10 }), RangeError);
  assert.throws(() => WorldGrid.generate({ width: 10, height: -2 }), RangeError);
  assert.throws(() => WorldGrid.generate({ width: 10.5, height: 10 }), RangeError);
  assert.throws(() => WorldGrid.generate({ width: Number.NaN, height: 10 }), RangeError);

  const grid = WorldGrid.generate({ width: 16, height: 12, seed: 7 });

  // Boundary & coordinate checks
  assert.equal(grid.isInBounds(0, 0), true);
  assert.equal(grid.isInBounds(15, 11), true);
  assert.equal(grid.isInBounds(-1, 0), false);
  assert.equal(grid.isInBounds(16, 0), false);
  assert.equal(grid.isInBounds(0, 12), false);
  assert.equal(grid.isInBounds(1.5, 2), false);
  assert.equal(grid.isInBounds(Number.NaN, 2), false);

  assert.equal(grid.toIndex(3, 2), 2 * 16 + 3);
  assert.equal(grid.toIndex(-1, 2), -1);
  assert.deepEqual(grid.fromIndex(2 * 16 + 3), { x: 3, y: 2 });
  assert.deepEqual(grid.clampCoords(-5, 99), { x: 0, y: 11 });

  assert.equal(grid.getCell(-1, 0), null);
  assert.equal(grid.getCell(16, 5), null);
  assert.equal(grid.setCell(-1, 0, { biomass: 0.5 }), false);

  // Mutate valid cell and verify clamping
  const ok = grid.setCell(4, 5, {
    elevation: 1.8, // clamps to 1
    terrain: 'mountain',
    temperature: -120, // clamps to MIN_TEMPERATURE_C
    moisture: -0.4, // clamps to 0
    biome: 'snow-cap',
    hasWater: false,
    biomass: 0.42,
  });
  assert.equal(ok, true);

  const updated = grid.getCell(4, 5)!;
  assert.equal(updated.elevation, 1);
  assert.equal(updated.terrain, 'mountain');
  assert.equal(updated.temperature, MIN_TEMPERATURE_C);
  assert.equal(updated.moisture, 0);
  assert.equal(updated.biome, 'snow-cap');
  assert.equal(updated.hasWater, false);
  assert.equal(updated.waterDepth, 0);
  assert.equal(updated.biomass, Math.fround(0.42));

  // Toggling waterDepth / hasWater
  assert.equal(grid.setCell(4, 5, { hasWater: true }), true);
  assert.equal(grid.hasWater(4, 5), true);
  assert.ok(grid.getCell(4, 5)!.waterDepth > 0);
  assert.equal(grid.getTerrain(4, 5), 'mountain');
  assert.equal(grid.getBiome(4, 5), 'snow-cap');
});

test('WorldGrid: neighbors handle interior, edge, corner, 1x1, wrapX, and out-of-bounds correctly', () => {
  const grid = WorldGrid.generate({ width: 10, height: 8, seed: 11 });

  // Corner (0, 0)
  assert.deepEqual(
    grid.getNeighbors(0, 0).map((n) => `${n.direction}:${n.cell.x},${n.cell.y}`),
    ['E:1,0', 'S:0,1']
  );
  assert.deepEqual(
    grid.getNeighbors(0, 0, { includeDiagonals: true }).map((n) => n.direction),
    ['E', 'SE', 'S']
  );

  // Bottom-right corner (9, 7)
  assert.deepEqual(
    grid.getNeighbors(9, 7).map((n) => n.direction),
    ['N', 'W']
  );
  assert.deepEqual(
    grid.getNeighbors(9, 7, { includeDiagonals: true }).map((n) => n.direction),
    ['N', 'W', 'NW']
  );

  // Top edge (5, 0)
  assert.equal(grid.getNeighbors(5, 0).length, 3);
  assert.equal(grid.getNeighbors(5, 0, { includeDiagonals: true }).length, 5);

  // Interior (5, 4)
  assert.equal(grid.getNeighbors(5, 4).length, 4);
  assert.equal(grid.getNeighbors(5, 4, { includeDiagonals: true }).length, 8);

  // Horizontal wrapping on x = 0 wraps W to x = 9
  const wrapped = grid.getNeighbors(0, 4, { wrapX: true });
  assert.equal(wrapped.length, 4);
  assert.equal(wrapped.find((n) => n.direction === 'W')?.cell.x, 9);

  // Zero-allocation visitor matches getNeighbors count
  let visited = 0;
  grid.forEachNeighbor(5, 4, () => {
    visited++;
  }, { includeDiagonals: true });
  assert.equal(visited, 8);

  // Out-of-bounds origin returns empty
  assert.deepEqual(grid.getNeighbors(-1, 0), []);
  let oobVisited = 0;
  grid.forEachNeighbor(10, 0, () => {
    oobVisited++;
  });
  assert.equal(oobVisited, 0);

  // Degenerate 1x1 map boundary
  const tiny = WorldGrid.generate({ width: 1, height: 1, seed: 5 });
  assert.equal(tiny.getNeighbors(0, 0).length, 0);
  assert.equal(tiny.getNeighbors(0, 0, { includeDiagonals: true }).length, 0);
  assert.ok(tiny.getCell(0, 0) !== null);
});

test('WorldGrid: extensible scalar layers and deep clone isolation', () => {
  const grid = WorldGrid.generate({ width: 12, height: 10, seed: 99 });
  const fertility = grid.ensureLayer('fertility', 0.75);
  assert.equal(fertility.length, grid.cellCount);
  assert.equal(fertility[0], 0.75);
  assert.equal(grid.hasLayer('fertility'), true);
  assert.deepEqual(grid.listLayerNames(), ['fertility']);

  const idx = grid.toIndex(3, 4);
  fertility[idx] = 0.25;

  const cloned = grid.clone();
  cloned.setCell(3, 4, { biomass: 0.99 });
  cloned.getLayer('fertility')![idx] = 0.9;

  assert.notEqual(grid.getCell(3, 4)!.biomass, 0.99);
  assert.equal(grid.getLayer('fertility')![idx], 0.25);
});

test('WorldGrid: never calls Math.random()', () => {
  const origRandom = Math.random;
  Math.random = () => {
    throw new Error('Math.random() must not be called');
  };
  try {
    const g = WorldGrid.generate({ width: 32, height: 18, seed: 'isolated' });
    assert.equal(g.cellCount, 32 * 18);
  } finally {
    Math.random = origRandom;
  }

  const rawSrc = fs.readFileSync(path.resolve('src/sim/worldGrid.ts'), 'utf8');
  const codeOnly = rawSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.equal(/\bMath\.random\s*\(/.test(codeOnly), false, 'worldGrid.ts must never call Math.random()');
});

test('WorldGrid: setCell and setCellByIndex keep terrain, waterDepth, hasWater, and biome consistent', () => {
  const grid = WorldGrid.generate({ width: 32, height: 18, seed: 42 });

  // Locate an ocean cell and elevate it to an arid peak
  let oceanIdx = -1;
  for (let i = 0; i < grid.cellCount; i++) {
    if (grid.waterDepth[i] > 0 && grid.biomeCode[i] === 0) {
      oceanIdx = i;
      break;
    }
  }
  assert.ok(oceanIdx >= 0, 'Test map must have at least one ocean cell');
  const { x: ox, y: oy } = grid.fromIndex(oceanIdx);

  assert.equal(grid.setCell(ox, oy, { elevation: 0.95, temperature: 30, moisture: 0.1, biomass: 0.33 }), true);
  const peakCell = grid.getCell(ox, oy)!;
  assert.equal(peakCell.terrain, 'peak');
  assert.equal(peakCell.hasWater, false);
  assert.equal(peakCell.waterDepth, 0);
  assert.equal(peakCell.biome, 'alpine-rock');
  assert.equal(peakCell.biomass, Math.fround(0.33));

  // Drop elevation below sea level -> becomes ocean with positive waterDepth & unchanged biomass
  assert.equal(grid.setCell(ox, oy, { elevation: 0.1 }), true);
  const seaCell = grid.getCell(ox, oy)!;
  assert.equal(seaCell.terrain, 'deep-water');
  assert.equal(seaCell.hasWater, true);
  assert.ok(seaCell.waterDepth > 0);
  assert.equal(seaCell.biome, 'ocean');
  assert.equal(seaCell.biomass, Math.fround(0.33));

  // Bring to lowland & vary temperature/moisture -> desert vs tropical forest
  grid.setCell(ox, oy, { elevation: 0.5, temperature: 32, moisture: 0.1 });
  assert.equal(grid.getCell(ox, oy)!.terrain, 'lowland');
  assert.equal(grid.getCell(ox, oy)!.hasWater, false);
  assert.equal(grid.getCell(ox, oy)!.biome, 'desert');

  grid.setCell(ox, oy, { temperature: 28, moisture: 0.85 });
  assert.equal(grid.getCell(ox, oy)!.biome, 'tropical-forest');

  // Freshwater wetland when hasWater=true on lowland
  grid.setCell(ox, oy, { hasWater: true });
  assert.equal(grid.getCell(ox, oy)!.hasWater, true);
  assert.ok(grid.getCell(ox, oy)!.waterDepth > 0);
  assert.equal(grid.getCell(ox, oy)!.biome, 'coastal-wetland');

  // Explicit user overrides take priority over auto-derived fields
  grid.setCell(ox, oy, { elevation: 0.95, biome: 'savanna', hasWater: false });
  const overridden = grid.getCell(ox, oy)!;
  assert.equal(overridden.terrain, 'peak');
  assert.equal(overridden.biome, 'savanna');
  assert.equal(overridden.hasWater, false);

  // setCellByIndex behaves identically to setCell
  const cloned = grid.clone();
  const patch = { elevation: 0.55, temperature: 3, moisture: 0.35 };
  assert.equal(grid.setCell(1, 1, patch), true);
  cloned.setCellByIndex(cloned.toIndex(1, 1), patch);
  assert.deepEqual(grid.getCell(1, 1), cloned.getCell(1, 1));

  // Mutually contradictory hasWater + waterDepth rejected atomically before partial mutation
  const snapshotBefore = grid.getCell(1, 1)!;
  assert.throws(() => grid.setCell(1, 1, { temperature: 45, hasWater: false, waterDepth: 0.5 }), RangeError);
  assert.throws(() => grid.setCell(1, 1, { temperature: 45, hasWater: true, waterDepth: 0 }), RangeError);
  assert.deepEqual(grid.getCell(1, 1), snapshotBefore);
});

test('WorldGrid: memory budget, dimension overflow protection, and precomputed noise reproducibility', async () => {
  const { default: crypto } = await import('node:crypto');

  // Exact overflow and excessive memory rejection (must fail fast without OOM)
  assert.throws(() => WorldGrid.generate({ width: 100000, height: 100000, seed: 1 }), RangeError);
  assert.throws(() => WorldGrid.generate({ width: 1e9, height: 1e9, seed: 1 }), RangeError);
  assert.throws(() => WorldGrid.estimateMemoryBytes(1e9, 1e9), RangeError);

  // Custom tight memory budget prevents layer/clone expansion beyond budget
  const tight = WorldGrid.generate({ width: 100, height: 100, seed: 1, maxMemoryBytes: 250000 });
  assert.throws(() => tight.ensureLayer('extra1'), RangeError);
  assert.equal(tight.hasLayer('extra1'), false);

  // Verify bitwise-identical output matches pre-optimization baseline SHA-256 hashes
  const hashGrid = (g: WorldGrid) => {
    const h = crypto.createHash('sha256');
    h.update(Buffer.from(g.elevation.buffer));
    h.update(Buffer.from(g.terrainCode.buffer));
    h.update(Buffer.from(g.temperature.buffer));
    h.update(Buffer.from(g.moisture.buffer));
    h.update(Buffer.from(g.biomeCode.buffer));
    h.update(Buffer.from(g.waterDepth.buffer));
    h.update(Buffer.from(g.biomass.buffer));
    return h.digest('hex');
  };

  assert.equal(
    hashGrid(WorldGrid.generate({ width: 64, height: 36, seed: 'pangaea-42' })),
    '2759dd3d19892ecf01241dfe6d2f1009a60b022457563b57de73eb27817abb68'
  );
  assert.equal(
    hashGrid(WorldGrid.generate({ width: 160, height: 90, seed: 12345 })),
    '9f65353a125ad96e4ba0d6c72bef991a96dc2eeb2cb64ab22bb4f72e03d3b858'
  );
});

test('WorldGrid: rejects NaN and +/-Infinity across all numeric inputs and preserves cell atomicity', () => {
  const nonFinite = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  for (const bad of nonFinite) {
    assert.throws(() => WorldGrid.generate({ width: bad, height: 10 }), RangeError);
    assert.throws(() => WorldGrid.generate({ width: 10, height: bad }), RangeError);
    assert.throws(() => WorldGrid.generate({ width: 16, height: 9, seaLevel: bad }), RangeError);
    assert.throws(() => WorldGrid.generate({ width: 16, height: 9, temperatureOffset: bad }), RangeError);
    assert.throws(() => WorldGrid.generate({ width: 16, height: 9, moistureScale: bad }), RangeError);
    assert.throws(() => WorldGrid.generate({ width: 16, height: 9, maxMemoryBytes: bad }), RangeError);
    assert.throws(() => WorldGrid.generate({ width: 16, height: 9, seed: bad }), RangeError);
  }

  const grid = WorldGrid.generate({ width: 16, height: 12, seed: 123 });
  assert.throws(() => grid.ensureLayer('tempLayer', Number.NaN), RangeError);
  assert.throws(() => grid.ensureLayer('tempLayer', Number.POSITIVE_INFINITY), RangeError);
  assert.throws(() => grid.clampCoords(Number.NaN, 1), RangeError);
  assert.throws(() => grid.clampCoords(1, Number.NEGATIVE_INFINITY), RangeError);

  // Establish clean known baseline state for cell (3, 4)
  assert.equal(
    grid.setCell(3, 4, {
      elevation: 0.52,
      terrain: 'lowland',
      temperature: 18,
      moisture: 0.45,
      hasWater: false,
      biomass: 0.4,
    }),
    true
  );
  const idx = grid.toIndex(3, 4);
  const before = grid.getCell(3, 4)!;

  // Every numeric patch field with NaN/Infinity must throw AND leave all other fields untouched (atomic)
  const badPatches = [
    { elevation: Number.NaN, temperature: 40, moisture: 0.9, biomass: 0.95 },
    { elevation: Number.POSITIVE_INFINITY, terrain: 'peak' as const, biomass: 0.1 },
    { elevation: Number.NEGATIVE_INFINITY, hasWater: true },
    { temperature: Number.NaN, elevation: 0.9, biomass: 0.8 },
    { temperature: Number.POSITIVE_INFINITY, moisture: 0.1 },
    { temperature: Number.NEGATIVE_INFINITY, biomass: 0.2 },
    { moisture: Number.NaN, elevation: 0.8, temperature: -10 },
    { moisture: Number.POSITIVE_INFINITY, biomass: 0.99 },
    { moisture: Number.NEGATIVE_INFINITY, terrain: 'hills' as const },
    { waterDepth: Number.NaN, elevation: 0.8, biomass: 0.9 },
    { waterDepth: Number.POSITIVE_INFINITY, temperature: 30 },
    { waterDepth: Number.NEGATIVE_INFINITY, moisture: 0.8 },
    { biomass: Number.NaN, elevation: 0.9, temperature: -20, moisture: 0.1 },
    { biomass: Number.POSITIVE_INFINITY, terrain: 'peak' as const },
    { biomass: Number.NEGATIVE_INFINITY, hasWater: true },
  ];

  for (const patch of badPatches) {
    assert.throws(() => grid.setCell(3, 4, patch), RangeError);
    assert.throws(() => grid.setCellByIndex(idx, patch), RangeError);
    assert.deepEqual(grid.getCell(3, 4), before);
  }
});

test('WorldGrid: prevents contradictory water, terrain, and ocean biome states atomically', () => {
  const grid = WorldGrid.generate({ width: 20, height: 14, seed: 77 });

  // Prepare a land cell (2, 2) and a water cell (4, 4)
  grid.setCell(2, 2, {
    elevation: 0.55,
    terrain: 'lowland',
    temperature: 20,
    moisture: 0.5,
    hasWater: false,
    biomass: 0.6,
  });
  grid.setCell(4, 4, {
    elevation: 0.15,
    terrain: 'deep-water',
    temperature: 14,
    moisture: 0.9,
    waterDepth: 0.6,
    biomass: 0,
  });

  const landSnap = grid.getCell(2, 2)!;
  const waterSnap = grid.getCell(4, 4)!;

  // Contradictory patches on land cell must reject and preserve state
  const landConflicts = [
    { terrain: 'deep-water' as const, hasWater: false, biomass: 0.9 },
    { terrain: 'shallow-water' as const, waterDepth: 0, temperature: 35 },
    { terrain: 'deep-water' as const, hasWater: false, waterDepth: 0 },
    { elevation: 0.1, hasWater: false, biomass: 0.1 },
    { elevation: 0.25, waterDepth: 0, moisture: 0.9 },
    { biome: 'ocean' as const, hasWater: false },
    { terrain: 'lowland' as const, biome: 'ocean' as const, waterDepth: 0 },
  ];
  for (const patch of landConflicts) {
    assert.throws(() => grid.setCell(2, 2, patch), RangeError);
    assert.deepEqual(grid.getCell(2, 2), landSnap);
  }

  // Attempting to drain water on an existing water-terrain cell without changing terrain/elevation must reject
  const waterConflicts = [
    { hasWater: false, biomass: 0.5 },
    { waterDepth: 0, temperature: 30 },
    { terrain: 'shallow-water' as const, hasWater: false },
    { terrain: 'deep-water' as const, waterDepth: 0 },
  ];
  for (const patch of waterConflicts) {
    assert.throws(() => grid.setCell(4, 4, patch), RangeError);
    assert.deepEqual(grid.getCell(4, 4), waterSnap);
  }

  // Valid terrain transitions maintain full water & biome consistency
  assert.equal(grid.setCell(2, 2, { terrain: 'shallow-water' }), true);
  assert.equal(grid.getCell(2, 2)!.hasWater, true);
  assert.ok(grid.getCell(2, 2)!.waterDepth > 0);
  assert.equal(grid.getCell(2, 2)!.biome, 'ocean');

  assert.equal(grid.setCell(4, 4, { terrain: 'lowland', temperature: 30, moisture: 0.1 }), true);
  assert.equal(grid.getCell(4, 4)!.hasWater, false);
  assert.equal(grid.getCell(4, 4)!.waterDepth, 0);
  assert.equal(grid.getCell(4, 4)!.biome, 'desert');
});

test('WorldGrid: Phase 1.2 — rejects incompatible terrain/biome pairs atomically in setCell and setCellByIndex', () => {
  const grid = WorldGrid.generate({ width: 16, height: 12, seed: 808 });

  // Prepare one clean land cell (2, 2) and one clean water cell (5, 5)
  assert.equal(
    grid.setCell(2, 2, {
      elevation: 0.55,
      terrain: 'lowland',
      temperature: 22,
      moisture: 0.4,
      hasWater: false,
      biomass: 0.35,
    }),
    true
  );
  assert.equal(
    grid.setCell(5, 5, {
      elevation: 0.12,
      terrain: 'deep-water',
      temperature: 16,
      moisture: 0.9,
      waterDepth: 0.65,
      biomass: 0,
    }),
    true
  );

  const landIdx = grid.toIndex(2, 2);
  const waterIdx = grid.toIndex(5, 5);
  const landSnap = grid.getCell(2, 2)!;
  const waterSnap = grid.getCell(5, 5)!;

  // All incompatible patches (including extra valid fields to verify atomicity before TypedArray writes)
  const incompatibleLandPatches = [
    { terrain: 'deep-water' as const, biome: 'desert' as const, temperature: 40, biomass: 0.9 },
    { terrain: 'shallow-water' as const, biome: 'desert' as const, moisture: 0.1 },
    { terrain: 'shallow-water' as const, biome: 'coastal-wetland' as const, temperature: 18 },
    { elevation: 0.05, biome: 'tropical-forest' as const, biomass: 0.8 },
    { terrain: 'lowland' as const, hasWater: true, biome: 'ocean' as const, temperature: 10 },
    { terrain: 'shore' as const, hasWater: true, biome: 'ocean' as const },
    { terrain: 'hills' as const, hasWater: true, biome: 'ocean' as const },
    { terrain: 'mountain' as const, hasWater: true, biome: 'ocean' as const },
    { terrain: 'peak' as const, hasWater: true, biome: 'ocean' as const },
    { hasWater: true, biome: 'ocean' as const, biomass: 0.1 },
  ];

  for (const patch of incompatibleLandPatches) {
    assert.throws(() => grid.setCell(2, 2, patch), RangeError);
    assert.deepEqual(grid.getCell(2, 2), landSnap);
    assert.throws(() => grid.setCellByIndex(landIdx, patch), RangeError);
    assert.deepEqual(grid.getCellByIndex(landIdx), landSnap);
  }

  const incompatibleWaterPatches = [
    { biome: 'desert' as const, temperature: 45, biomass: 0.2 },
    { biome: 'coastal-wetland' as const },
    { terrain: 'shallow-water' as const, biome: 'tundra' as const },
    { terrain: 'lowland' as const, biome: 'ocean' as const },
  ];

  for (const patch of incompatibleWaterPatches) {
    assert.throws(() => grid.setCell(5, 5, patch), RangeError);
    assert.deepEqual(grid.getCell(5, 5), waterSnap);
    assert.throws(() => grid.setCellByIndex(waterIdx, patch), RangeError);
    assert.deepEqual(grid.getCellByIndex(waterIdx), waterSnap);
  }

  // Valid terrain/biome pairs (including freshwater land with non-ocean biome & explicit land overrides)
  assert.equal(isTerrainBiomeCompatible('deep-water', 'ocean'), true);
  assert.equal(isTerrainBiomeCompatible('shallow-water', 'ocean'), true);
  assert.equal(isTerrainBiomeCompatible('deep-water', 'desert'), false);
  assert.equal(isTerrainBiomeCompatible('lowland', 'ocean'), false);

  assert.equal(grid.setCell(2, 2, { terrain: 'lowland', hasWater: true, biome: 'coastal-wetland' }), true);
  assert.equal(grid.getCell(2, 2)!.biome, 'coastal-wetland');
  assert.equal(grid.getCell(2, 2)!.hasWater, true);

  assert.equal(grid.setCell(2, 2, { terrain: 'shore', biome: 'desert', hasWater: false }), true);
  assert.equal(grid.getCell(2, 2)!.biome, 'desert');

  assert.equal(grid.setCell(2, 2, { terrain: 'peak', biome: 'snow-cap', hasWater: false }), true);
  assert.equal(grid.getCell(2, 2)!.biome, 'snow-cap');

  assert.equal(grid.setCell(5, 5, { terrain: 'shallow-water', biome: 'ocean' }), true);
  assert.equal(grid.getCell(5, 5)!.biome, 'ocean');
  assert.equal(grid.getCell(5, 5)!.hasWater, true);
});

test('WorldGrid: Phase 1.2 — exported classifiers reject NaN/Infinity and layer/clone handle allocation failure cleanly', () => {
  const badNumbers = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const bad of badNumbers) {
    assert.throws(() => classifyTerrain(bad, 0.36), RangeError);
    assert.throws(() => classifyTerrain(0.5, bad), RangeError);
    assert.throws(() => classifyWorldBiome('lowland', bad, 0.5, false), RangeError);
    assert.throws(() => classifyWorldBiome('lowland', 20, bad, false), RangeError);
  }
  assert.throws(() => classifyWorldBiome('invalid-terrain' as never, 20, 0.5, false), RangeError);
  assert.throws(() => classifyWorldBiome('lowland', 20, 0.5, 'true' as never), RangeError);

  // Correctness across all terrain bands and biome categories
  assert.equal(classifyTerrain(0.1, 0.36), 'deep-water');
  assert.equal(classifyTerrain(0.25, 0.36), 'shallow-water');
  assert.equal(classifyTerrain(0.38, 0.36), 'shore');
  assert.equal(classifyTerrain(0.5, 0.36), 'lowland');
  assert.equal(classifyTerrain(0.7, 0.36), 'hills');
  assert.equal(classifyTerrain(0.82, 0.36), 'mountain');
  assert.equal(classifyTerrain(0.95, 0.36), 'peak');

  assert.equal(classifyWorldBiome('deep-water', 20, 0.5, true), 'ocean');
  assert.equal(classifyWorldBiome('shallow-water', 20, 0.5, true), 'ocean');
  assert.equal(classifyWorldBiome('peak', -5, 0.2, false), 'snow-cap');
  assert.equal(classifyWorldBiome('peak', 10, 0.2, false), 'alpine-rock');
  assert.equal(classifyWorldBiome('mountain', -5, 0.2, false), 'snow-cap');
  assert.equal(classifyWorldBiome('mountain', 5, 0.2, false), 'alpine-rock');
  assert.equal(classifyWorldBiome('lowland', 20, 0.5, true), 'coastal-wetland');
  assert.equal(classifyWorldBiome('shore', 20, 0.6, false), 'coastal-wetland');
  assert.equal(classifyWorldBiome('lowland', -3, 0.3, false), 'tundra');
  assert.equal(classifyWorldBiome('lowland', 4, 0.7, false), 'temperate-forest');
  assert.equal(classifyWorldBiome('lowland', 28, 0.1, false), 'desert');
  assert.equal(classifyWorldBiome('lowland', 28, 0.35, false), 'shrubland');
  assert.equal(classifyWorldBiome('lowland', 28, 0.55, false), 'savanna');
  assert.equal(classifyWorldBiome('lowland', 28, 0.8, false), 'tropical-forest');

  // Verify ensureLayer and clone wrap underlying Float32Array allocation failures in contextual RangeError
  const grid = WorldGrid.generate({ width: 8, height: 6, seed: 55 });
  grid.ensureLayer('existing', 0.5);

  const OrigFloat32Array = globalThis.Float32Array;
  let failAlloc = true;
  const MockFloat32Array = function (this: unknown, ...args: unknown[]) {
    if (failAlloc && args.length === 1 && typeof args[0] === 'number' && args[0] === grid.cellCount) {
      throw new Error('simulated OOM');
    }
    return Reflect.construct(OrigFloat32Array, args);
  } as unknown as Float32ArrayConstructor;

  globalThis.Float32Array = MockFloat32Array;
  try {
    assert.throws(
      () => grid.ensureLayer('fertility', 0.2),
      (err: unknown) => err instanceof RangeError && err.message.includes('fertility')
    );
    assert.equal(grid.hasLayer('fertility'), false);

    failAlloc = false;
    const okGrid = grid.clone();
    assert.equal(okGrid.getLayer('existing')![0], 0.5);

    // Fail only the custom layer clone allocation while allowing primary buffers
    let count = 0;
    globalThis.Float32Array = function (...args: unknown[]) {
      if (args.length === 1 && typeof args[0] === 'number' && args[0] === grid.cellCount) {
        count++;
        // Primary constructor allocates 5 Float32Arrays; 6th is the cloned custom layer
        if (count === 6) {
          throw new Error('simulated clone layer OOM');
        }
      }
      return Reflect.construct(OrigFloat32Array, args);
    } as unknown as Float32ArrayConstructor;

    assert.throws(
      () => grid.clone(),
      (err: unknown) => err instanceof RangeError && err.message.includes('existing')
    );
  } finally {
    globalThis.Float32Array = OrigFloat32Array;
  }
});



