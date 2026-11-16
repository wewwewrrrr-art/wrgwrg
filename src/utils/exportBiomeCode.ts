import type { BiomeWorldState } from '../engine/biomeSimulation';
import {
  BIOME_HEIGHT,
  BIOME_WIDTH,
  BiomeDefinition,
  BiomePlacement,
  GRID_COLS,
  GRID_ROWS,
  TILE_SIZE,
  TopDownTileType,
  buildBiomeTileGrid,
} from '../models/biomes';

export const BIOME_TILE_LEGEND: readonly TopDownTileType[] = [
  'deepWater',
  'midWater',
  'shallowWater',
  'shore',
  'grass',
  'path',
  'accentBiome',
  'rock',
  'snow',
] as const;

const TILE_INDEX_BY_TYPE = new Map<TopDownTileType, number>(
  BIOME_TILE_LEGEND.map((t, idx) => [t, idx])
);

export function encodeBiomeTileGridRle(tileMap: readonly TopDownTileType[]): string {
  if (tileMap.length === 0) return '';
  const tokens: string[] = [];
  let current = TILE_INDEX_BY_TYPE.get(tileMap[0]) ?? 0;
  let run = 0;

  for (let i = 0; i < tileMap.length; i++) {
    const idx = TILE_INDEX_BY_TYPE.get(tileMap[i]) ?? 0;
    if (idx === current) {
      run++;
    } else {
      tokens.push(`${run}:${current}`);
      current = idx;
      run = 1;
    }
  }
  if (run > 0) tokens.push(`${run}:${current}`);
  return tokens.join(',');
}

export function decodeBiomeTileGridRle(rle: string, length = GRID_COLS * GRID_ROWS): TopDownTileType[] {
  const out = new Array<TopDownTileType>(length).fill('deepWater');
  if (!rle) return out;
  let cursor = 0;
  const parts = rle.split(',');
  for (let i = 0; i < parts.length; i++) {
    const tok = parts[i];
    const sep = tok.indexOf(':');
    if (sep === -1) continue;
    const count = parseInt(tok.slice(0, sep), 10);
    const idx = parseInt(tok.slice(sep + 1), 10);
    const tile = BIOME_TILE_LEGEND[idx] ?? 'deepWater';
    for (let k = 0; k < count && cursor < length; k++) {
      out[cursor++] = tile;
    }
  }
  return out;
}

export function encodeUint8Rle(arr: Uint8Array): string {
  if (arr.length === 0) return '';
  const tokens: string[] = [];
  let current = arr[0];
  let run = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === current) {
      run++;
    } else {
      tokens.push(`${run}:${current}`);
      current = arr[i];
      run = 1;
    }
  }
  if (run > 0) tokens.push(`${run}:${current}`);
  return tokens.join(',');
}

function getBiomeProceduralFormulaSnippet(biomeId: BiomeDefinition['id']): string {
  switch (biomeId) {
    case 'forest-citadel':
      return `export function classifyProceduralTile(tx: number, ty: number): TopDownTileType {
  const u = tx / GRID_COLS;
  const v = ty / GRID_ROWS;
  const n = fbm2d(101, tx * 0.085, ty * 0.085);
  const fine = fbm2d(149, tx * 0.24, ty * 0.24) * 0.35;
  const core = islandCore(u, v, 0.51, 0.43, 0.46, 0.38);
  const islet = 1 - Math.hypot((u - 0.83) / 0.1, (v - 0.83) / 0.09);
  const elev = Math.max(core, islet * 0.65) * 10 + (n + fine) * 4.8;

  if (elev <= -2.1) return 'deepWater';
  if (elev <= -0.9) return 'midWater';
  if (elev <= 0.1) return 'shallowWater';
  if (elev <= 1.15) return 'shore';

  const mtn = (1 - Math.hypot((u - 0.22) / 0.14, (v - 0.28) / 0.19)) * 10 + (n + fine) * 4.2;
  if (mtn > 5.0) return 'snow';
  if (mtn > 2.9) return 'rock';

  const pathY = 38 + Math.sin(tx * 0.055) * 3.8 + n * 2.5;
  const branchX = 104 + Math.cos(ty * 0.11) * 3;
  if (
    (tx > 42 && tx < 130 && Math.abs(ty - pathY) < 1.3) ||
    (ty > pathY && ty < 60 && Math.abs(tx - branchX) < 1.4)
  ) {
    return 'path';
  }

  const autumnZone = 1 - Math.hypot((u - 0.77) / 0.22, (v - 0.45) / 0.28) + (n + fine) * 0.48;
  return autumnZone > 0.34 ? 'accentBiome' : 'grass';
}`;
    case 'volcanic-forge':
      return `export function classifyProceduralTile(tx: number, ty: number): TopDownTileType {
  const u = tx / GRID_COLS;
  const v = ty / GRID_ROWS;
  const n = fbm2d(202, tx * 0.09, ty * 0.09);
  const fine = fbm2d(257, tx * 0.24, ty * 0.24) * 0.35;
  const core = islandCore(u, v, 0.51, 0.43, 0.46, 0.38);
  const craterHole = (1 - Math.hypot((u - 0.88) / 0.13, (v - 0.14) / 0.13)) * 9;
  const elev = core * 10 - Math.max(0, craterHole) + (n + fine) * 4.8;

  if (elev <= -2.0) return 'deepWater';
  if (elev <= -0.8) return 'midWater';
  if (elev <= 0.1) return 'shallowWater';
  if (elev <= 1.1) return 'shore';

  const ridge = (1 - Math.hypot((u - 0.19) / 0.11, (v - 0.32) / 0.22)) * 10 + (n + fine) * 4.2;
  if (ridge > 5.8) return 'snow';
  if (ridge > 3.6) return 'rock';

  const pathY = 39 + Math.cos(tx * 0.06) * 3.5 + n * 2.5;
  if (tx > 38 && tx < 132 && Math.abs(ty - pathY) < 1.3) return 'path';

  const clockworkZone = 1 - Math.hypot((u - 0.36) / 0.17, (v - 0.52) / 0.2) + (n + fine) * 0.45;
  return clockworkZone > 0.35 ? 'accentBiome' : 'grass';
}`;
    case 'frozen-fjord':
      return `export function classifyProceduralTile(tx: number, ty: number): TopDownTileType {
  const u = tx / GRID_COLS;
  const v = ty / GRID_ROWS;
  const n = fbm2d(303, tx * 0.085, ty * 0.085);
  const fine = fbm2d(353, tx * 0.24, ty * 0.24) * 0.35;
  const core = islandCore(u, v, 0.51, 0.42, 0.46, 0.37);
  const southInlet = (1 - Math.hypot((u - 0.5) / 0.28, (v - 0.86) / 0.16)) * 6;
  const elev = core * 10 - Math.max(0, southInlet) + (n + fine) * 4.8;

  if (elev <= -2.2) return 'deepWater';
  if (elev <= -0.9) return 'midWater';
  if (elev <= 0.1) return 'shallowWater';
  if (elev <= 1.1) return 'shore';

  const mtn = (1 - Math.hypot((u - 0.21) / 0.14, (v - 0.26) / 0.19)) * 10 + (n + fine) * 4.2;
  if (mtn > 4.9) return 'snow';
  if (mtn > 2.8) return 'rock';

  const crystal = 1 - Math.hypot((u - 0.36) / 0.17, (v - 0.53) / 0.18) + (n + fine) * 0.45;
  if (crystal > 0.33) return 'accentBiome';

  const pathY = 38 + Math.sin(tx * 0.055) * 3.5 + n * 2.5;
  return tx > 42 && tx < 130 && Math.abs(ty - pathY) < 1.3 ? 'path' : 'grass';
}`;
    case 'blighted-swamp':
      return `export function classifyProceduralTile(tx: number, ty: number): TopDownTileType {
  const u = tx / GRID_COLS;
  const v = ty / GRID_ROWS;
  const n = fbm2d(404, tx * 0.09, ty * 0.09);
  const fine = fbm2d(461, tx * 0.24, ty * 0.24) * 0.35;
  const core = islandCore(u, v, 0.51, 0.43, 0.46, 0.37);
  const bogChannel = (1 - Math.hypot((u - 0.52) / 0.34, (v - 0.86) / 0.15)) * 7;
  const elev = core * 10 - Math.max(0, bogChannel) + (n + fine) * 4.8;

  if (elev <= -2.1) return 'deepWater';
  if (elev <= -0.9) return 'midWater';
  if (elev <= 0.1) return 'shallowWater';
  if (elev <= 1.1) return 'shore';

  const ridge = (1 - Math.hypot((u - 0.84) / 0.1, (v - 0.22) / 0.14)) * 10 + (n + fine) * 4.0;
  if (ridge > 4.2) return 'rock';

  const mushroomZone = 1 - Math.hypot((u - 0.65) / 0.21, (v - 0.49) / 0.22) + (n + fine) * 0.48;
  if (mushroomZone > 0.34) return 'accentBiome';

  const pathY = 39 + Math.sin(tx * 0.06) * 3.5 + n * 2.5;
  return tx > 38 && tx < 134 && Math.abs(ty - pathY) < 1.3 ? 'path' : 'grass';
}`;
    case 'coastal-oasis':
    default:
      return `export function classifyProceduralTile(tx: number, ty: number): TopDownTileType {
  const u = tx / GRID_COLS;
  const v = ty / GRID_ROWS;
  const n = fbm2d(505, tx * 0.085, ty * 0.085);
  const fine = fbm2d(563, tx * 0.24, ty * 0.24) * 0.35;
  const core = islandCore(u, v, 0.54, 0.43, 0.44, 0.37);
  const topLeftLagoon = (1 - Math.hypot((u - 0.12) / 0.2, (v - 0.24) / 0.24)) * 8.5;
  const elev = core * 10 - Math.max(0, topLeftLagoon) + (n + fine) * 4.8;

  if (elev <= -2.1) return 'deepWater';
  if (elev <= -0.9) return 'midWater';
  if (elev <= 0.1) return 'shallowWater';
  if (elev <= 1.65) return 'shore';

  const savannaCorner = 1 - Math.hypot((u - 0.78) / 0.22, (v - 0.28) / 0.22) + (n + fine) * 0.45;
  if (savannaCorner > 0.34) return 'accentBiome';

  const pathY = 39 + Math.sin(tx * 0.06) * 3 + n * 2;
  return tx > 46 && tx < 128 && Math.abs(ty - pathY) < 1.3 ? 'path' : 'grass';
}`;
  }
}

function resolveSnapshotData(biome: BiomeDefinition, simState?: BiomeWorldState | null) {
  const usesLive = Boolean(simState && simState.biomeId === biome.id);
  const tileMap = usesLive && simState ? simState.tileMap : buildBiomeTileGrid(biome.id);
  const activePlacements: BiomePlacement[] =
    usesLive && simState
      ? simState.entities
          .filter((e) => !e.destroyed)
          .map((e) => ({
            ...e.placement,
            x: Math.round(e.x),
            y: Math.round(e.y),
            facing: e.facing,
          }))
      : biome.placements;

  const hasTerrainEdits = Boolean(
    usesLive &&
      simState &&
      (simState.quakeCount > 0 ||
        simState.destroyedStructures > 0 ||
        simState.crackMap.some((v) => v > 0) ||
        simState.rubbleMap.some((v) => v > 0))
  );

  return {
    usesLive,
    hasTerrainEdits,
    tileMap,
    tileGridRle: encodeBiomeTileGridRle(tileMap),
    crackRle: hasTerrainEdits && simState ? encodeUint8Rle(simState.crackMap) : null,
    rubbleRle: hasTerrainEdits && simState ? encodeUint8Rle(simState.rubbleMap) : null,
    activePlacements,
    stats: usesLive && simState
      ? {
          quakeCount: simState.quakeCount,
          destroyedStructures: simState.destroyedStructures,
          creaturesSlain: simState.creaturesSlain,
          totalDamageDealt: simState.totalDamageDealt,
        }
      : {
          quakeCount: 0,
          destroyedStructures: 0,
          creaturesSlain: 0,
          totalDamageDealt: 0,
        },
  };
}

/**
 * Generates a self-contained, zero-dependency TypeScript module for a 2D biome
 * (e.g. `forest-citadel.biome.ts` for «Лесная Цитадель»), containing:
 * - Biome palette & metadata (`BIOME_META`)
 * - Entity spawn & patrol placements (`BIOME_PLACEMENTS`)
 * - Lossless 160x90 tile grid RLE (`TILE_GRID_RLE`) + procedural noise classifier (`classifyProceduralTile`)
 * - Standalone `PixelBuffer`, `renderBiomeBackdrop()`, `renderToRgbaBytes()`, `renderToCanvas()`
 */
export function generateStandaloneBiomeTs(
  biome: BiomeDefinition,
  simState?: BiomeWorldState | null
): string {
  const snap = resolveSnapshotData(biome, simState);
  const formulaCode = getBiomeProceduralFormulaSnippet(biome.id);

  const metaObj = {
    id: biome.id,
    name: biome.name,
    subtitle: biome.subtitle,
    description: biome.description,
    stageBg: biome.stageBg,
    width: BIOME_WIDTH,
    height: BIOME_HEIGHT,
    tileSize: TILE_SIZE,
    cols: GRID_COLS,
    rows: GRID_ROWS,
    palette: biome.palette,
    weatherIds: biome.weatherIds,
    snapshotSource: snap.usesLive ? 'live-sandbox' : 'canonical-template',
    stats: snap.stats,
  };

  return `/**
 * ============================================================================
 * STANDALONE 2D BIOME MODULE: ${biome.name} (${biome.id})
 * ============================================================================
 * Canvas: ${BIOME_WIDTH}x${BIOME_HEIGHT} px | Tile Grid: ${GRID_COLS}x${GRID_ROWS} (${TILE_SIZE}x${TILE_SIZE} px tiles)
 * Zero external dependencies. Drop directly into TypeScript, HTML5 Canvas, or Node.
 *
 * USAGE:
 *   const buf = renderBiomeBackdrop();
 *   const rgba = buf.toRgbaBytes(); // Uint8ClampedArray (${BIOME_WIDTH} * ${BIOME_HEIGHT} * 4)
 *   // Or in browser: renderToCanvas(canvasElement, 2);
 * ============================================================================
 */

export type TopDownTileType =
  | 'deepWater'
  | 'midWater'
  | 'shallowWater'
  | 'shore'
  | 'grass'
  | 'path'
  | 'accentBiome'
  | 'rock'
  | 'snow';

export interface BiomePlacement {
  id: string;
  modelId: string;
  x: number;
  y: number;
  layer: 'ground' | 'water' | 'air' | 'sky';
  facing?: -1 | 1;
  patrolSpan?: number;
  patrolSpanY?: number;
  patrolSpeed?: number;
  hoverBob?: number;
  phaseOffset?: number;
  unitMode?: 'walk' | 'swim';
  role: string;
}

export const BIOME_WIDTH = ${BIOME_WIDTH};
export const BIOME_HEIGHT = ${BIOME_HEIGHT};
export const TILE_SIZE = ${TILE_SIZE};
export const GRID_COLS = ${GRID_COLS};
export const GRID_ROWS = ${GRID_ROWS};

export const BIOME_META = ${JSON.stringify(metaObj, null, 2)} as const;

export const BIOME_PLACEMENTS: readonly BiomePlacement[] = ${JSON.stringify(snap.activePlacements, null, 2)};

export const TILE_LEGEND: readonly TopDownTileType[] = ${JSON.stringify(BIOME_TILE_LEGEND)};

export const TILE_GRID_RLE = '${snap.tileGridRle}';
${snap.crackRle ? `export const CRACK_MAP_RLE = '${snap.crackRle}';` : `export const CRACK_MAP_RLE: string | null = null;`}
${snap.rubbleRle ? `export const RUBBLE_MAP_RLE = '${snap.rubbleRle}';` : `export const RUBBLE_MAP_RLE: string | null = null;`}

function hash2d(seed: number, x: number, y: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function valueNoise2d(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2d(seed, xi, yi);
  const b = hash2d(seed, xi + 1, yi);
  const c = hash2d(seed, xi, yi + 1);
  const d = hash2d(seed, xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm2d(seed: number, x: number, y: number): number {
  let sum = 0;
  let amp = 0.55;
  let freq = 1;
  for (let i = 0; i < 3; i++) {
    sum += (valueNoise2d(seed + i * 31, x * freq, y * freq) - 0.5) * 2 * amp;
    freq *= 2.05;
    amp *= 0.48;
  }
  return sum;
}

function islandCore(u: number, v: number, cx = 0.51, cy = 0.44, rx = 0.46, ry = 0.38): number {
  const dx = Math.abs((u - cx) / rx);
  const dy = Math.abs((v - cy) / ry);
  return 1 - Math.pow(Math.pow(dx, 2.5) + Math.pow(dy, 2.5), 1 / 2.5);
}

${formulaCode}

export class PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly grid: (string | null)[];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.grid = new Array<string | null>(width * height).fill(null);
  }

  getPixel(x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return this.grid[y * this.width + x];
  }

  setPixel(x: number, y: number, hex: string | null): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return;
    this.grid[iy * this.width + ix] = hex ? hex.toUpperCase() : null;
  }

  fillRect(x: number, y: number, w: number, h: number, hex: string): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.setPixel(x + dx, y + dy, hex);
      }
    }
  }

  fillEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    colorOrFn: string | ((nx: number, ny: number, px: number, py: number) => string | null)
  ): void {
    const minX = Math.floor(cx - rx);
    const maxX = Math.ceil(cx + rx);
    const minY = Math.floor(cy - ry);
    const maxY = Math.ceil(cy + ry);
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const nx = (px - cx) / Math.max(0.5, rx);
        const ny = (py - cy) / Math.max(0.5, ry);
        if (nx * nx + ny * ny <= 1) {
          const hex = typeof colorOrFn === 'function' ? colorOrFn(nx, ny, px, py) : colorOrFn;
          if (hex) this.setPixel(px, py, hex);
        }
      }
    }
  }

  toRgbaBytes(): Uint8ClampedArray {
    const data = new Uint8ClampedArray(this.width * this.height * 4);
    for (let i = 0; i < this.grid.length; i++) {
      const hex = this.grid[i];
      if (!hex) continue;
      const clean = hex.replace('#', '');
      const off = i * 4;
      data[off] = parseInt(clean.slice(0, 2), 16) || 0;
      data[off + 1] = parseInt(clean.slice(2, 4), 16) || 0;
      data[off + 2] = parseInt(clean.slice(4, 6), 16) || 0;
      data[off + 3] = clean.length === 8 ? parseInt(clean.slice(6, 8), 16) : 255;
    }
    return data;
  }
}

export function decodeTileGrid(rle = TILE_GRID_RLE): TopDownTileType[] {
  const out = new Array<TopDownTileType>(GRID_COLS * GRID_ROWS).fill('deepWater');
  let cursor = 0;
  for (const tok of rle.split(',')) {
    const sep = tok.indexOf(':');
    if (sep === -1) continue;
    const count = parseInt(tok.slice(0, sep), 10);
    const idx = parseInt(tok.slice(sep + 1), 10);
    const tile = TILE_LEGEND[idx] ?? 'deepWater';
    for (let i = 0; i < count && cursor < out.length; i++) {
      out[cursor++] = tile;
    }
  }
  return out;
}

function decodeByteMap(rle: string | null): Uint8Array | null {
  if (!rle) return null;
  const out = new Uint8Array(GRID_COLS * GRID_ROWS);
  let cursor = 0;
  for (const tok of rle.split(',')) {
    const sep = tok.indexOf(':');
    if (sep === -1) continue;
    const count = parseInt(tok.slice(0, sep), 10);
    const val = parseInt(tok.slice(sep + 1), 10);
    for (let i = 0; i < count && cursor < out.length; i++) {
      out[cursor++] = val;
    }
  }
  return out;
}

export function renderBiomeBackdrop(useProceduralTerrain = false): PixelBuffer {
  const buf = new PixelBuffer(BIOME_WIDTH, BIOME_HEIGHT);
  const pal = BIOME_META.palette;
  const tileMap: TopDownTileType[] = useProceduralTerrain
    ? Array.from({ length: GRID_COLS * GRID_ROWS }, (_, idx) =>
        classifyProceduralTile(idx % GRID_COLS, Math.floor(idx / GRID_COLS))
      )
    : decodeTileGrid();
  const crackMap = useProceduralTerrain ? null : decodeByteMap(CRACK_MAP_RLE);
  const rubbleMap = useProceduralTerrain ? null : decodeByteMap(RUBBLE_MAP_RLE);

  const isLandTile = (t: TopDownTileType | undefined) =>
    t !== undefined && t !== 'deepWater' && t !== 'midWater' && t !== 'shallowWater';

  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const idx = ty * GRID_COLS + tx;
      const tileType = tileMap[idx];
      const baseColor = pal[tileType][0];
      const altColor = pal[tileType][1];
      const x0 = tx * TILE_SIZE;
      const y0 = ty * TILE_SIZE;
      buf.fillRect(x0, y0, TILE_SIZE, TILE_SIZE, baseColor);

      const h = Math.floor(hash2d(pal.seed, tx, ty) * 10000);
      if (tileType === 'shallowWater') {
        if (ty > 0 && isLandTile(tileMap[(ty - 1) * GRID_COLS + tx])) buf.fillRect(x0, y0, TILE_SIZE, 2, pal.shoreRimColor);
        if (ty < GRID_ROWS - 1 && isLandTile(tileMap[(ty + 1) * GRID_COLS + tx])) buf.fillRect(x0, y0 + TILE_SIZE - 2, TILE_SIZE, 2, pal.shoreRimColor);
        if (tx > 0 && isLandTile(tileMap[ty * GRID_COLS + (tx - 1)])) buf.fillRect(x0, y0, 2, TILE_SIZE, pal.shoreRimColor);
        if (tx < GRID_COLS - 1 && isLandTile(tileMap[ty * GRID_COLS + (tx + 1)])) buf.fillRect(x0 + TILE_SIZE - 2, y0, 2, TILE_SIZE, pal.shoreRimColor);
      } else if (tileType === 'grass' || tileType === 'accentBiome') {
        if (h % 2 === 0) buf.fillRect(x0 + (h % 3), y0 + ((h >> 2) % 3), 2, 2, altColor);
        if (h % 5 === 0) buf.setPixel(x0 + ((h >> 4) % 4), y0 + ((h >> 6) % 4), altColor);
        if (h % 23 === 0) {
          const fc = pal.flowerColors[h % pal.flowerColors.length];
          buf.setPixel(x0 + 1, y0 + 1, fc);
          buf.setPixel(x0 + 2, y0 + 2, fc);
        }
      } else if (tileType === 'shore' || tileType === 'path') {
        if (h % 3 === 0) buf.fillRect(x0 + (h % 3), y0 + ((h >> 2) % 3), 2, 2, altColor);
      } else if (tileType === 'rock') {
        if (h % 3 === 0) buf.fillRect(x0 + 1, y0 + 1, 2, 2, altColor);
        if (ty > 0 && tileMap[(ty - 1) * GRID_COLS + tx] !== 'rock' && tileMap[(ty - 1) * GRID_COLS + tx] !== 'snow') {
          buf.fillRect(x0, y0, TILE_SIZE, 1, '#9FA3AB');
        }
      } else if (tileType === 'snow') {
        if (h % 3 === 0) buf.fillRect(x0 + 1, y0 + 1, 2, 2, altColor);
      }

      if (crackMap && crackMap[idx] >= 2 && tileType === 'rock' && h % 2 === 0) {
        buf.setPixel(x0 + (h % 3), y0 + ((h >> 1) % 3), '#9A9EA6');
      }
      if (rubbleMap && rubbleMap[idx] > 0) {
        buf.fillRect(x0 + 1, y0 + 1, 2, 2, rubbleMap[idx] === 2 ? '#5D5A61' : '#7A6853');
      }
    }
  }
  return buf;
}

export function renderToRgbaBytes(useProceduralTerrain = false): Uint8ClampedArray {
  return renderBiomeBackdrop(useProceduralTerrain).toRgbaBytes();
}

export function renderToCanvas(
  canvas: HTMLCanvasElement,
  scale = 2,
  useProceduralTerrain = false
): void {
  const buf = renderBiomeBackdrop(useProceduralTerrain);
  canvas.width = buf.width * scale;
  canvas.height = buf.height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const off = document.createElement('canvas');
  off.width = buf.width;
  off.height = buf.height;
  const offCtx = off.getContext('2d');
  if (!offCtx) return;
  offCtx.putImageData(new ImageData(new Uint8ClampedArray(buf.toRgbaBytes()), buf.width, buf.height), 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
}
`;
}

export function generateBiomeJson(
  biome: BiomeDefinition,
  simState?: BiomeWorldState | null
): string {
  const snap = resolveSnapshotData(biome, simState);
  const payload = {
    schema: 'kostyanaya-kuznya.biome.v1',
    id: biome.id,
    name: biome.name,
    subtitle: biome.subtitle,
    description: biome.description,
    stageBg: biome.stageBg,
    snapshotSource: snap.usesLive ? 'live-sandbox' : 'canonical-template',
    dimensions: {
      width: BIOME_WIDTH,
      height: BIOME_HEIGHT,
      tileSize: TILE_SIZE,
      cols: GRID_COLS,
      rows: GRID_ROWS,
    },
    palette: biome.palette,
    weatherIds: biome.weatherIds,
    stats: snap.stats,
    rleEncoding: 'count:tileTypeIndex',
    tileLegend: BIOME_TILE_LEGEND,
    tileGridRle: snap.tileGridRle,
    crackMapRle: snap.crackRle,
    rubbleMapRle: snap.rubbleRle,
    placements: snap.activePlacements,
    defaultPlacements: biome.placements,
  };
  return JSON.stringify(payload, null, 2);
}

function triggerTextDownload(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadBiomeCodeTs(
  biome: BiomeDefinition,
  simState?: BiomeWorldState | null
): void {
  const code = generateStandaloneBiomeTs(biome, simState);
  triggerTextDownload(code, `${biome.id}.biome.ts`, 'text/typescript;charset=utf-8');
}

export function downloadBiomeCodeJson(
  biome: BiomeDefinition,
  simState?: BiomeWorldState | null
): void {
  const json = generateBiomeJson(biome, simState);
  triggerTextDownload(json, `${biome.id}.biome.json`, 'application/json;charset=utf-8');
}
