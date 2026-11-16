import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEarthquakeAt, createBiomeSimState } from './biomeSimulation';
import { ALL_RACE_BUILDINGS, MEDIEVAL_TOWN_HALL } from './proceduralRaceBuildings';
import { ALL_MODELS } from '../models';
import { BIOMES, GRID_COLS, GRID_ROWS, buildBiomeTileGrid } from '../models/biomes';
import {
  decodeBiomeTileGridRle,
  encodeBiomeTileGridRle,
  generateBiomeJson,
  generateStandaloneBiomeTs,
} from '../utils/exportBiomeCode';
import { generateModelJson, generateStandaloneModelTs } from '../utils/exportModelCode';

test('Biome tile grid RLE roundtrip is 100% lossless for Forest Citadel and all 5 biomes', () => {
  for (const biome of BIOMES) {
    const grid = buildBiomeTileGrid(biome.id);
    assert.equal(grid.length, GRID_COLS * GRID_ROWS);
    const rle = encodeBiomeTileGridRle(grid);
    assert.ok(rle.length > 20, `${biome.id} RLE should be non-empty`);
    const decoded = decodeBiomeTileGridRle(rle, grid.length);
    assert.deepEqual(decoded, grid, `${biome.id} tile map must roundtrip identically`);
  }
});

test('generateStandaloneBiomeTs exports self-contained TypeScript module for Forest Citadel & all biomes', () => {
  const forestCitadel = BIOMES.find((b) => b.id === 'forest-citadel');
  assert.ok(forestCitadel, 'forest-citadel biome must exist');

  for (const biome of BIOMES) {
    const ts = generateStandaloneBiomeTs(biome);
    assert.ok(ts.includes(`STANDALONE 2D BIOME MODULE: ${biome.name} (${biome.id})`));
    assert.ok(ts.includes('export const BIOME_META ='));
    assert.ok(ts.includes('export const BIOME_PLACEMENTS:'));
    assert.ok(ts.includes('export const TILE_GRID_RLE ='));
    assert.ok(ts.includes('export function classifyProceduralTile(tx: number, ty: number)'));
    assert.ok(ts.includes('export function renderBiomeBackdrop(useProceduralTerrain = false)'));
    assert.ok(ts.includes('export function renderToCanvas('));
    assert.ok(
      !ts.includes("= 'undefined'") && !ts.includes(': undefined,') && !ts.includes('BIOME_META = undefined'),
      `${biome.id} TS export must not contain leaked undefined values`
    );
  }

  const fcTs = generateStandaloneBiomeTs(forestCitadel);
  assert.ok(fcTs.includes('Лесная Цитадель'));
  assert.ok(fcTs.includes('citadel-keep'));
});

test('generateBiomeJson preserves canonical template and live sandbox mutations (earthquakes)', () => {
  const forestCitadel = BIOMES.find((b) => b.id === 'forest-citadel')!;
  const canonicalJson = JSON.parse(generateBiomeJson(forestCitadel));
  assert.equal(canonicalJson.schema, 'kostyanaya-kuznya.biome.v1');
  assert.equal(canonicalJson.id, 'forest-citadel');
  assert.equal(canonicalJson.snapshotSource, 'canonical-template');
  assert.equal(canonicalJson.crackMapRle, null);
  assert.equal(canonicalJson.placements.length, forestCitadel.placements.length);
  assert.equal(decodeBiomeTileGridRle(canonicalJson.tileGridRle).length, GRID_COLS * GRID_ROWS);

  const modelMap = new Map(ALL_MODELS.map((m) => [m.id, m]));
  const sim = createBiomeSimState(forestCitadel, modelMap);
  applyEarthquakeAt(sim, forestCitadel, 300, 175);

  const liveJson = JSON.parse(generateBiomeJson(forestCitadel, sim));
  assert.equal(liveJson.snapshotSource, 'live-sandbox');
  assert.equal(liveJson.stats.quakeCount, 1);
  assert.ok(typeof liveJson.crackMapRle === 'string' && liveJson.crackMapRle.length > 0);
});

test('Race buildings and MEDIEVAL_TOWN_HALL export valid standalone TypeScript & JSON code', () => {
  const watchtree = ALL_RACE_BUILDINGS.find((b) => b.id === 'antler-watchtree');
  assert.ok(watchtree, 'antler-watchtree must exist');

  for (const b of [MEDIEVAL_TOWN_HALL, watchtree]) {
    const ts = generateStandaloneModelTs(b, { kingdomId: 'original', buildingState: 'ready' });
    assert.ok(ts.includes(`STANDALONE PIXEL MODEL MODULE: ${b.name} (${b.id})`));
    assert.ok(ts.includes('export function renderModelFrame('));

    const json = JSON.parse(generateModelJson(b, { kingdomId: 'original', buildingState: 'ready' }));
    assert.equal(json.id, b.id);
    assert.equal(json.frames.length, b.frameCount);
    assert.ok(json.frames[0].opaquePixels > 500);
  }
});
