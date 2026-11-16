import { SeedInput, SeededRng, deriveSeed, normalizeSeed } from './prng';

/**
 * Base Living World Map Data Structure (`src/sim/worldGrid.ts`).
 *
 * Uses a Structure-of-Arrays (SoA) TypedArray layout for cache-friendly,
 * scalable access across thousands of simulation ticks, while exposing clean
 * cell-level getters/setters, neighbor queries, boundary handling, and
 * extensible scalar layers for future climate and ecology modules.
 */

export const TERRAIN_TYPES = [
  'deep-water',
  'shallow-water',
  'shore',
  'lowland',
  'hills',
  'mountain',
  'peak',
] as const;

export type TerrainType = (typeof TERRAIN_TYPES)[number];

export const WORLD_BIOME_IDS = [
  'ocean',
  'coastal-wetland',
  'tropical-forest',
  'temperate-forest',
  'savanna',
  'shrubland',
  'desert',
  'tundra',
  'alpine-rock',
  'snow-cap',
] as const;

export type WorldBiomeId = (typeof WORLD_BIOME_IDS)[number];

export type CardinalDirection = 'N' | 'E' | 'S' | 'W';
export type CompassDirection = CardinalDirection | 'NE' | 'SE' | 'SW' | 'NW';

export interface WorldCell {
  readonly x: number;
  readonly y: number;
  readonly index: number;
  /** Normalized elevation in [0, 1] */
  readonly elevation: number;
  readonly terrain: TerrainType;
  /** Surface temperature in degrees Celsius, clamped to [-50, 60] */
  readonly temperature: number;
  /** Normalized moisture in [0, 1] */
  readonly moisture: number;
  readonly biome: WorldBiomeId;
  readonly hasWater: boolean;
  /** Water depth in [0, 1] (0 for dry land) */
  readonly waterDepth: number;
  /** Normalized plant biomass in [0, 1] */
  readonly biomass: number;
}

export interface WorldCellPatch {
  elevation?: number;
  terrain?: TerrainType;
  temperature?: number;
  moisture?: number;
  biome?: WorldBiomeId;
  hasWater?: boolean;
  waterDepth?: number;
  biomass?: number;
}

export interface WorldCellNeighbor {
  readonly direction: CompassDirection;
  readonly cell: WorldCell;
}

export interface NeighborQueryOptions {
  /** Include diagonal neighbors (Moore 8-neighborhood). Defaults to false (4-way). */
  includeDiagonals?: boolean;
  /** Wrap horizontally across x = 0 <-> width - 1. Defaults to false. */
  wrapX?: boolean;
}

export interface WorldGridConfig {
  /** Map width in cells (default: 160) */
  width?: number;
  /** Map height in cells (default: 90) */
  height?: number;
  /** Deterministic world seed (default: 1) */
  seed?: SeedInput;
  /** Sea level threshold in [0.1, 0.8] (default: 0.36) */
  seaLevel?: number;
  /** Global base temperature offset in °C (default: 0) */
  temperatureOffset?: number;
  /** Global moisture multiplier (default: 1) */
  moistureScale?: number;
  /**
   * Maximum permitted memory footprint in bytes for primary buffers.
   * Defaults to DEFAULT_MAX_GRID_MEMORY_BYTES (256 MiB).
   */
  maxMemoryBytes?: number;
}

export interface WorldGridStats {
  readonly width: number;
  readonly height: number;
  readonly cellCount: number;
  readonly waterCells: number;
  readonly landCells: number;
  readonly minElevation: number;
  readonly maxElevation: number;
  readonly minTemperature: number;
  readonly maxTemperature: number;
  readonly avgTemperature: number;
  readonly avgMoisture: number;
  readonly totalBiomass: number;
  readonly avgBiomass: number;
  readonly biomeCounts: Record<WorldBiomeId, number>;
}

export const MIN_TEMPERATURE_C = -50;
export const MAX_TEMPERATURE_C = 60;
/**
 * Exact byte footprint per cell across the 7 primary SoA TypedArrays:
 * elevation(4) + terrainCode(1) + temperature(4) + moisture(4) +
 * biomeCode(1) + waterDepth(4) + biomass(4) = 22 bytes/cell.
 */
export const WORLD_GRID_BYTES_PER_CELL = 22;
/** Default 256 MiB primary buffer budget (~12.2M cells) leaving headroom for JS heap, layers & agents. */
export const DEFAULT_MAX_GRID_MEMORY_BYTES = 256 * 1024 * 1024;
/** Maximum safe 32-bit TypedArray element count */
export const MAX_GRID_CELL_COUNT = 0xffffffff;

const TERRAIN_TO_CODE = new Map<TerrainType, number>(
  TERRAIN_TYPES.map((t, i) => [t, i])
);
const BIOME_TO_CODE = new Map<WorldBiomeId, number>(
  WORLD_BIOME_IDS.map((b, i) => [b, i])
);

const CARDINAL_OFFSETS: readonly { dir: CardinalDirection; dx: number; dy: number }[] = [
  { dir: 'N', dx: 0, dy: -1 },
  { dir: 'E', dx: 1, dy: 0 },
  { dir: 'S', dx: 0, dy: 1 },
  { dir: 'W', dx: -1, dy: 0 },
];

const MOORE_OFFSETS: readonly { dir: CompassDirection; dx: number; dy: number }[] = [
  { dir: 'N', dx: 0, dy: -1 },
  { dir: 'NE', dx: 1, dy: -1 },
  { dir: 'E', dx: 1, dy: 0 },
  { dir: 'SE', dx: 1, dy: 1 },
  { dir: 'S', dx: 0, dy: 1 },
  { dir: 'SW', dx: -1, dy: 1 },
  { dir: 'W', dx: -1, dy: 0 },
  { dir: 'NW', dx: -1, dy: -1 },
];

function clampField(name: string, v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) {
    throw new RangeError(`Invalid ${name}: expected finite number, received ${v}`);
  }
  return v < min ? min : v > max ? max : v;
}

function clamp(v: number, min: number, max: number): number {
  return clampField('value', v, min, max);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Pure integer coordinate hash returning [0, 1) deterministically for 2D noise.
 */
function hashCoords2D(seed: number, ix: number, iy: number): number {
  let h = (seed ^ Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function valueNoise2D(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);

  const v00 = hashCoords2D(seed, x0, y0);
  const v10 = hashCoords2D(seed, x0 + 1, y0);
  const v01 = hashCoords2D(seed, x0, y0 + 1);
  const v11 = hashCoords2D(seed, x0 + 1, y0 + 1);

  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
}

function precomputeOctaveSeeds(seed: number, octaves: number): Uint32Array {
  const seeds = new Uint32Array(octaves);
  for (let o = 0; o < octaves; o++) {
    seeds[o] = deriveSeed(seed, `oct:${o}`);
  }
  return seeds;
}

function fbmNoise2DPrecomputed(
  octaveSeeds: Uint32Array,
  x: number,
  y: number,
  lacunarity = 2.0,
  gain = 0.5
): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let maxAmp = 0;

  for (let o = 0; o < octaveSeeds.length; o++) {
    sum += valueNoise2D(octaveSeeds[o], x * freq, y * freq) * amp;
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }

  return maxAmp > 0 ? sum / maxAmp : 0;
}

export function isWaterTerrain(terrain: TerrainType): boolean {
  return terrain === 'deep-water' || terrain === 'shallow-water';
}

/**
 * Checks whether a terrain type and biome id form a physically consistent pair:
 * - water terrains ('deep-water', 'shallow-water') only support the 'ocean' biome;
 * - land terrains ('shore', 'lowland', 'hills', 'mountain', 'peak') support any terrestrial biome,
 *   never 'ocean' (freshwater on land uses terrestrial/wetland biomes).
 */
export function isTerrainBiomeCompatible(
  terrain: TerrainType,
  biome: WorldBiomeId
): boolean {
  if (!TERRAIN_TO_CODE.has(terrain) || !BIOME_TO_CODE.has(biome)) {
    return false;
  }
  if (isWaterTerrain(terrain)) {
    return biome === 'ocean';
  }
  return biome !== 'ocean';
}

export function classifyTerrain(elevation: number, seaLevel: number): TerrainType {
  if (!Number.isFinite(elevation) || !Number.isFinite(seaLevel)) {
    throw new RangeError(
      `classifyTerrain requires finite elevation and seaLevel, received: (${elevation}, ${seaLevel})`
    );
  }
  if (elevation < seaLevel * 0.55) return 'deep-water';
  if (elevation < seaLevel) return 'shallow-water';
  if (elevation < seaLevel + 0.045) return 'shore';
  if (elevation < 0.62) return 'lowland';
  if (elevation < 0.77) return 'hills';
  if (elevation < 0.89) return 'mountain';
  return 'peak';
}

export function classifyWorldBiome(
  terrain: TerrainType,
  temperature: number,
  moisture: number,
  hasWater: boolean
): WorldBiomeId {
  if (!TERRAIN_TO_CODE.has(terrain)) {
    throw new RangeError(`Unknown terrain type: ${String(terrain)}`);
  }
  if (!Number.isFinite(temperature) || !Number.isFinite(moisture)) {
    throw new RangeError(
      `classifyWorldBiome requires finite temperature and moisture, received: (${temperature}, ${moisture})`
    );
  }
  if (typeof hasWater !== 'boolean') {
    throw new RangeError(`classifyWorldBiome requires boolean hasWater, received: ${String(hasWater)}`);
  }
  if (terrain === 'deep-water' || terrain === 'shallow-water') {
    return 'ocean';
  }
  if (terrain === 'peak') {
    return temperature <= 4 ? 'snow-cap' : 'alpine-rock';
  }
  if (terrain === 'mountain') {
    return temperature <= -2 ? 'snow-cap' : 'alpine-rock';
  }
  if (hasWater || (terrain === 'shore' && moisture >= 0.55)) {
    return 'coastal-wetland';
  }
  if (temperature < 1) {
    return moisture > 0.6 && terrain !== 'shore' ? 'snow-cap' : 'tundra';
  }
  if (temperature < 7) {
    return moisture >= 0.58 ? 'temperate-forest' : 'tundra';
  }
  if (temperature >= 22) {
    if (moisture < 0.28) return 'desert';
    if (moisture < 0.48) return 'shrubland';
    if (moisture < 0.66) return 'savanna';
    return 'tropical-forest';
  }
  // Temperate band (7..22 °C)
  if (moisture < 0.24) return 'desert';
  if (moisture < 0.44) return 'shrubland';
  if (moisture < 0.62) return 'savanna';
  return 'temperate-forest';
}

export class WorldGrid {
  public readonly width: number;
  public readonly height: number;
  public readonly cellCount: number;
  public readonly seed: number;
  public readonly seaLevel: number;

  /** Primary SoA buffers */
  public readonly elevation: Float32Array;
  public readonly terrainCode: Uint8Array;
  public readonly temperature: Float32Array;
  public readonly moisture: Float32Array;
  public readonly biomeCode: Uint8Array;
  public readonly waterDepth: Float32Array;
  public readonly biomass: Float32Array;

  /** Extensible custom scalar layers for upcoming climate & ecology systems */
  private readonly customLayers = new Map<string, Float32Array>();

  private readonly maxMemoryBytes: number;

  private constructor(
    width: number,
    height: number,
    seed: number,
    seaLevel: number,
    maxMemoryBytes = DEFAULT_MAX_GRID_MEMORY_BYTES
  ) {
    WorldGrid.assertSafeDimensions(width, height, 0, maxMemoryBytes);
    this.width = width;
    this.height = height;
    this.cellCount = width * height;
    this.seed = seed;
    this.seaLevel = seaLevel;
    this.maxMemoryBytes = maxMemoryBytes;

    try {
      this.elevation = new Float32Array(this.cellCount);
      this.terrainCode = new Uint8Array(this.cellCount);
      this.temperature = new Float32Array(this.cellCount);
      this.moisture = new Float32Array(this.cellCount);
      this.biomeCode = new Uint8Array(this.cellCount);
      this.waterDepth = new Float32Array(this.cellCount);
      this.biomass = new Float32Array(this.cellCount);
    } catch (err) {
      throw new RangeError(
        `Failed to allocate WorldGrid buffers for ${width}x${height} (${this.cellCount} cells): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  /**
   * Computes exact byte usage of primary buffers plus optional Float32 custom layers.
   */
  static estimateMemoryBytes(
    width: number,
    height: number,
    extraFloat32Layers = 0
  ): number {
    if (!Number.isInteger(width) || width < 1) {
      throw new RangeError(`WorldGrid width must be a positive integer, got: ${width}`);
    }
    if (!Number.isInteger(height) || height < 1) {
      throw new RangeError(`WorldGrid height must be a positive integer, got: ${height}`);
    }
    if (!Number.isInteger(extraFloat32Layers) || extraFloat32Layers < 0) {
      throw new RangeError(`extraFloat32Layers must be a non-negative integer, got: ${extraFloat32Layers}`);
    }
    const cellCount = width * height;
    if (!Number.isSafeInteger(cellCount) || cellCount > MAX_GRID_CELL_COUNT) {
      throw new RangeError(
        `WorldGrid dimensions ${width}x${height} overflow safe cell count limits`
      );
    }
    const bytesPerCell = WORLD_GRID_BYTES_PER_CELL + extraFloat32Layers * 4;
    const totalBytes = cellCount * bytesPerCell;
    if (!Number.isSafeInteger(totalBytes)) {
      throw new RangeError(
        `WorldGrid memory estimate for ${width}x${height} exceeds safe integer bounds`
      );
    }
    return totalBytes;
  }

  private static assertSafeDimensions(
    width: number,
    height: number,
    extraFloat32Layers: number,
    maxMemoryBytes: number
  ): void {
    if (!Number.isFinite(maxMemoryBytes) || maxMemoryBytes <= 0) {
      throw new RangeError(`maxMemoryBytes must be a positive finite number, got: ${maxMemoryBytes}`);
    }
    const totalBytes = WorldGrid.estimateMemoryBytes(width, height, extraFloat32Layers);
    if (totalBytes > maxMemoryBytes) {
      const mibNeeded = (totalBytes / (1024 * 1024)).toFixed(2);
      const mibLimit = (maxMemoryBytes / (1024 * 1024)).toFixed(2);
      throw new RangeError(
        `WorldGrid ${width}x${height} (${width * height} cells) requires ${mibNeeded} MiB, exceeding safe memory budget of ${mibLimit} MiB`
      );
    }
  }

  /**
   * Deterministically generates a new WorldGrid from `config`.
   */
  static generate(config: WorldGridConfig = {}): WorldGrid {
    const width = config.width ?? 160;
    const height = config.height ?? 90;
    const maxMemoryBytes = config.maxMemoryBytes ?? DEFAULT_MAX_GRID_MEMORY_BYTES;

    WorldGrid.assertSafeDimensions(width, height, 0, maxMemoryBytes);

    const seaLevel = clampField('seaLevel', config.seaLevel ?? 0.36, 0.1, 0.8);
    const tempOffset = clampField('temperatureOffset', config.temperatureOffset ?? 0, -30, 30);
    const moistureScale = clampField('moistureScale', config.moistureScale ?? 1, 0.1, 2.5);
    const seed = normalizeSeed(config.seed ?? 1);

    const grid = new WorldGrid(width, height, seed, seaLevel, maxMemoryBytes);

    const rng = new SeededRng(seed);
    const elevRng = rng.fork('worldgen:elevation');
    const moistRng = rng.fork('worldgen:moisture');
    const tempRng = rng.fork('worldgen:temperature');
    const bioRng = rng.fork('worldgen:biomass');

    const elevSeed = elevRng.nextUint32();
    const ridgeSeed = elevRng.nextUint32();
    const moistSeed = moistRng.nextUint32();
    const tempNoiseSeed = tempRng.nextUint32();

    // Precompute octave seeds once per generation call to avoid per-cell string allocations
    const elevOctaves = precomputeOctaveSeeds(elevSeed, 4);
    const ridgeOctaves = precomputeOctaveSeeds(ridgeSeed, 3);
    const tempOctaves = precomputeOctaveSeeds(tempNoiseSeed, 2);
    const moistOctaves = precomputeOctaveSeeds(moistSeed, 4);

    const offsetX = elevRng.range(-500, 500);
    const offsetY = elevRng.range(-500, 500);
    const moistOffX = moistRng.range(-500, 500);
    const moistOffY = moistRng.range(-500, 500);

    // Frequency scaled gently so small maps still exhibit multi-biome variation
    // while large maps retain broad geographic regions.
    const spanX = Math.max(width, 24);
    const spanY = Math.max(height, 16);

    for (let y = 0; y < height; y++) {
      const ny = height > 1 ? y / (height - 1) : 0.5;
      // Symmetric equator temperature curve: warmest at middle latitude (ny = 0.5), cooler near poles
      const equatorFactor = 1 - Math.abs(ny * 2 - 1);

      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const nx = width > 1 ? x / (width - 1) : 0.5;

        const sampleX = offsetX + (x / spanX) * 4.2;
        const sampleY = offsetY + (y / spanY) * 4.2;

        const baseElev = fbmNoise2DPrecomputed(elevOctaves, sampleX, sampleY);
        const ridge = 1 - Math.abs(fbmNoise2DPrecomputed(ridgeOctaves, sampleX * 1.45, sampleY * 1.45) * 2 - 1);
        // Subtle coastal falloff near top/bottom/side edges to encourage multi-biome land basins + sea borders
        const edgeDist = Math.min(nx, 1 - nx, ny, 1 - ny);
        const edgeDrop = edgeDist < 0.08 ? (0.08 - edgeDist) * 1.6 : 0;

        const elevation = clamp(baseElev * 0.72 + ridge * 0.34 - edgeDrop, 0, 1);
        const terrain = classifyTerrain(elevation, seaLevel);

        const isSea = elevation < seaLevel;
        const rawWaterDepth = isSea ? clamp((seaLevel - elevation) / seaLevel, 0.02, 1) : 0;

        // Temperature: latitude gradient + altitude lapse rate + local variation
        const altAboveSea = Math.max(0, elevation - seaLevel);
        const tempJitter = (fbmNoise2DPrecomputed(tempOctaves, sampleX * 0.9, sampleY * 0.9) - 0.5) * 8;
        const rawTemp = -6 + equatorFactor * 36 - altAboveSea * 38 + tempJitter + tempOffset;
        const temperature = clamp(rawTemp, MIN_TEMPERATURE_C, MAX_TEMPERATURE_C);

        // Moisture: multi-octave noise boosted slightly near sea level and damped on high peaks
        const mRaw = fbmNoise2DPrecomputed(
          moistOctaves,
          moistOffX + (x / spanX) * 3.8,
          moistOffY + (y / spanY) * 3.8
        );
        const coastalBonus = isSea ? 0.25 : Math.max(0, 0.14 - altAboveSea * 0.35);
        const moisture = clamp((mRaw * 0.88 + coastalBonus) * moistureScale, 0, 1);

        const hasWater = rawWaterDepth > 0;
        const biome = classifyWorldBiome(terrain, temperature, moisture, hasWater);

        // Initial plant biomass driven by biome suitability + deterministic micro-jitter
        let baseBiomass = 0;
        if (!hasWater) {
          switch (biome) {
            case 'tropical-forest':
              baseBiomass = 0.78 + moisture * 0.18;
              break;
            case 'temperate-forest':
              baseBiomass = 0.62 + moisture * 0.2;
              break;
            case 'coastal-wetland':
              baseBiomass = 0.52 + moisture * 0.25;
              break;
            case 'savanna':
              baseBiomass = 0.35 + moisture * 0.22;
              break;
            case 'shrubland':
              baseBiomass = 0.2 + moisture * 0.18;
              break;
            case 'tundra':
              baseBiomass = 0.1 + moisture * 0.08;
              break;
            case 'desert':
              baseBiomass = 0.03 + moisture * 0.06;
              break;
            case 'alpine-rock':
              baseBiomass = 0.04;
              break;
            case 'snow-cap':
            case 'ocean':
              baseBiomass = 0;
              break;
          }
          baseBiomass += bioRng.range(-0.04, 0.04);
        }

        grid.elevation[idx] = elevation;
        grid.terrainCode[idx] = TERRAIN_TO_CODE.get(terrain)!;
        grid.temperature[idx] = temperature;
        grid.moisture[idx] = moisture;
        grid.biomeCode[idx] = BIOME_TO_CODE.get(biome)!;
        grid.waterDepth[idx] = rawWaterDepth;
        grid.biomass[idx] = clamp(baseBiomass, 0, 1);
      }
    }

    return grid;
  }

  /**
   * Returns true iff `(x, y)` are integer coordinates within `[0, width) × [0, height)`.
   */
  isInBounds(x: number, y: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      x < this.width &&
      y >= 0 &&
      y < this.height
    );
  }

  /**
   * Converts `(x, y)` to flat buffer index, or `-1` if out of bounds.
   */
  toIndex(x: number, y: number): number {
    if (!this.isInBounds(x, y)) return -1;
    return y * this.width + x;
  }

  /**
   * Converts a flat cell index `[0, cellCount)` back to `{ x, y }`.
   */
  fromIndex(index: number): { x: number; y: number } {
    if (!Number.isInteger(index) || index < 0 || index >= this.cellCount) {
      throw new RangeError(`Cell index out of bounds: ${index}`);
    }
    const y = Math.floor(index / this.width);
    const x = index - y * this.width;
    return { x, y };
  }

  /**
   * Clamps integer coordinates onto valid map bounds.
   */
  clampCoords(x: number, y: number): { x: number; y: number } {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError(`clampCoords requires finite coordinates, received: (${x}, ${y})`);
    }
    const cx = Math.max(0, Math.min(this.width - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(this.height - 1, Math.round(y)));
    return { x: cx, y: cy };
  }

  /**
   * Reads a snapshot of cell `(x, y)`, or `null` if out of bounds.
   */
  getCell(x: number, y: number): WorldCell | null {
    const idx = this.toIndex(x, y);
    if (idx < 0) return null;
    return this.getCellByIndex(idx);
  }

  /**
   * Reads a snapshot of cell by flat index.
   */
  getCellByIndex(index: number): WorldCell {
    const { x, y } = this.fromIndex(index);
    const waterDepth = this.waterDepth[index];
    return {
      x,
      y,
      index,
      elevation: this.elevation[index],
      terrain: TERRAIN_TYPES[this.terrainCode[index]],
      temperature: this.temperature[index],
      moisture: this.moisture[index],
      biome: WORLD_BIOME_IDS[this.biomeCode[index]],
      hasWater: waterDepth > 0,
      waterDepth,
      biomass: this.biomass[index],
    };
  }

  /**
   * Updates one or more fields of cell `(x, y)` with cascading consistency:
   * 1. Explicit fields in `patch` take priority.
   * 2. Dependent fields recalculate automatically when not explicitly overridden:
   *    - `elevation` -> `terrain`, sea `waterDepth`/`hasWater`
   *    - `terrain` (between land/water) -> `waterDepth`/`hasWater`
   *    - `terrain`, `temperature`, `moisture`, `hasWater` -> `biome`
   *    - `biomass` remains independent.
   * 3. Mutually contradictory `hasWater` and `waterDepth` in the same patch throw RangeError.
   * Returns `false` if `(x, y)` is out of bounds.
   */
  setCell(x: number, y: number, patch: WorldCellPatch): boolean {
    const idx = this.toIndex(x, y);
    if (idx < 0) return false;
    this.setCellByIndex(idx, patch);
    return true;
  }

  /**
   * Updates one or more fields of cell `index` using identical priority & consistency
   * rules as `setCell`. Validates all fields before mutating buffers.
   */
  setCellByIndex(index: number, patch: WorldCellPatch): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.cellCount) {
      throw new RangeError(`Cell index out of bounds: ${index}`);
    }

    // 1. Pre-validate every provided field atomically before computing or writing anything
    const nextElevation =
      patch.elevation !== undefined
        ? clampField('elevation', patch.elevation, 0, 1)
        : this.elevation[index];
    const elevationChanged =
      patch.elevation !== undefined && nextElevation !== this.elevation[index];

    let explicitTerrainCode: number | undefined;
    if (patch.terrain !== undefined) {
      explicitTerrainCode = TERRAIN_TO_CODE.get(patch.terrain);
      if (explicitTerrainCode === undefined) {
        throw new RangeError(`Unknown terrain type: ${patch.terrain}`);
      }
    }

    const nextTemperature =
      patch.temperature !== undefined
        ? clampField('temperature', patch.temperature, MIN_TEMPERATURE_C, MAX_TEMPERATURE_C)
        : this.temperature[index];
    const tempChanged =
      patch.temperature !== undefined && nextTemperature !== this.temperature[index];

    const nextMoisture =
      patch.moisture !== undefined
        ? clampField('moisture', patch.moisture, 0, 1)
        : this.moisture[index];
    const moistChanged =
      patch.moisture !== undefined && nextMoisture !== this.moisture[index];

    let explicitBiomeCode: number | undefined;
    if (patch.biome !== undefined) {
      explicitBiomeCode = BIOME_TO_CODE.get(patch.biome);
      if (explicitBiomeCode === undefined) {
        throw new RangeError(`Unknown biome id: ${patch.biome}`);
      }
    }

    if (patch.hasWater !== undefined && typeof patch.hasWater !== 'boolean') {
      throw new RangeError(`Invalid hasWater: expected boolean, received ${String(patch.hasWater)}`);
    }

    let validatedDepth: number | undefined;
    if (patch.waterDepth !== undefined) {
      validatedDepth = clampField('waterDepth', patch.waterDepth, 0, 1);
      if (patch.hasWater === false && validatedDepth > 0) {
        throw new RangeError('Conflicting patch: hasWater=false cannot be combined with waterDepth > 0');
      }
      if (patch.hasWater === true && validatedDepth === 0) {
        throw new RangeError('Conflicting patch: hasWater=true cannot be combined with waterDepth=0');
      }
    }

    const nextBiomass =
      patch.biomass !== undefined
        ? clampField('biomass', patch.biomass, 0, 1)
        : this.biomass[index];

    // 2. Resolve terrain (explicit > auto from elevation > existing)
    const prevTerrain = TERRAIN_TYPES[this.terrainCode[index]];
    const nextTerrain: TerrainType =
      patch.terrain !== undefined
        ? patch.terrain
        : patch.elevation !== undefined
          ? classifyTerrain(nextElevation, this.seaLevel)
          : prevTerrain;
    const terrainChanged = nextTerrain !== prevTerrain;
    const nextTerrainCode = explicitTerrainCode ?? TERRAIN_TO_CODE.get(nextTerrain)!;

    // 3. Resolve waterDepth & hasWater and reject contradictory water-terrain states
    const prevWaterDepth = this.waterDepth[index];
    const prevIsWaterTerrain = isWaterTerrain(prevTerrain);
    const nextIsWaterTerrain = isWaterTerrain(nextTerrain);

    if (nextIsWaterTerrain && (patch.hasWater === false || validatedDepth === 0)) {
      throw new RangeError(
        `Conflicting patch: terrain "${nextTerrain}" requires water (hasWater=true and waterDepth > 0)`
      );
    }

    let nextWaterDepth = prevWaterDepth;
    if (validatedDepth !== undefined) {
      nextWaterDepth = validatedDepth;
    } else if (patch.hasWater !== undefined) {
      if (!patch.hasWater) {
        nextWaterDepth = 0;
      } else if (nextWaterDepth <= 0) {
        nextWaterDepth = nextTerrain === 'deep-water' ? 0.65 : 0.25;
      }
    } else if (patch.elevation !== undefined && patch.terrain === undefined) {
      // Elevation drives sea depth automatically unless terrain/water was explicitly overridden
      nextWaterDepth =
        nextElevation < this.seaLevel
          ? clampField('waterDepth', (this.seaLevel - nextElevation) / this.seaLevel, 0.02, 1)
          : 0;
    } else if (patch.terrain !== undefined) {
      if (nextIsWaterTerrain && nextWaterDepth <= 0) {
        nextWaterDepth = nextTerrain === 'deep-water' ? 0.65 : 0.25;
      } else if (!nextIsWaterTerrain && prevIsWaterTerrain) {
        nextWaterDepth = 0;
      }
    }

    const nextHasWater = nextWaterDepth > 0;
    const waterChanged = nextWaterDepth !== prevWaterDepth || nextHasWater !== (prevWaterDepth > 0);

    // 4. Resolve biome (explicit > auto when any dependency changes > existing) & enforce terrain-biome-water invariants
    let nextBiomeCode = this.biomeCode[index];
    if (explicitBiomeCode !== undefined) {
      if (patch.biome === 'ocean' && !nextHasWater) {
        throw new RangeError(
          'Conflicting patch: biome "ocean" requires water (hasWater=true and waterDepth > 0)'
        );
      }
      if (!isTerrainBiomeCompatible(nextTerrain, patch.biome!)) {
        throw new RangeError(
          `Conflicting patch: terrain "${nextTerrain}" is incompatible with biome "${patch.biome}"`
        );
      }
      nextBiomeCode = explicitBiomeCode;
    } else if (
      elevationChanged ||
      terrainChanged ||
      tempChanged ||
      moistChanged ||
      waterChanged ||
      patch.elevation !== undefined ||
      patch.terrain !== undefined
    ) {
      const autoBiome = classifyWorldBiome(nextTerrain, nextTemperature, nextMoisture, nextHasWater);
      nextBiomeCode = BIOME_TO_CODE.get(autoBiome)!;
    } else {
      const currentBiome = WORLD_BIOME_IDS[nextBiomeCode];
      if (!isTerrainBiomeCompatible(nextTerrain, currentBiome) || (currentBiome === 'ocean' && !nextHasWater)) {
        const autoBiome = classifyWorldBiome(nextTerrain, nextTemperature, nextMoisture, nextHasWater);
        nextBiomeCode = BIOME_TO_CODE.get(autoBiome)!;
      }
    }

    // 5. Commit validated SoA mutations
    this.elevation[index] = nextElevation;
    this.terrainCode[index] = nextTerrainCode;
    this.temperature[index] = nextTemperature;
    this.moisture[index] = nextMoisture;
    this.biomeCode[index] = nextBiomeCode;
    this.waterDepth[index] = nextWaterDepth;
    this.biomass[index] = nextBiomass;
  }

  /**
   * Zero-allocation scalar accessors for hot simulation loops.
   */
  getTerrain(x: number, y: number): TerrainType | null {
    const idx = this.toIndex(x, y);
    return idx < 0 ? null : TERRAIN_TYPES[this.terrainCode[idx]];
  }

  getBiome(x: number, y: number): WorldBiomeId | null {
    const idx = this.toIndex(x, y);
    return idx < 0 ? null : WORLD_BIOME_IDS[this.biomeCode[idx]];
  }

  hasWater(x: number, y: number): boolean {
    const idx = this.toIndex(x, y);
    return idx >= 0 && this.waterDepth[idx] > 0;
  }

  /**
   * Returns neighboring cells of `(x, y)` respecting map boundaries
   * (or wrapping horizontally if `wrapX: true`).
   */
  getNeighbors(
    x: number,
    y: number,
    options: NeighborQueryOptions = {}
  ): WorldCellNeighbor[] {
    if (!this.isInBounds(x, y)) return [];

    const offsets = options.includeDiagonals ? MOORE_OFFSETS : CARDINAL_OFFSETS;
    const wrapX = options.wrapX === true;
    const out: WorldCellNeighbor[] = [];

    for (let i = 0; i < offsets.length; i++) {
      const off = offsets[i];
      let nx = x + off.dx;
      const ny = y + off.dy;
      if (ny < 0 || ny >= this.height) continue;

      if (wrapX) {
        nx = ((nx % this.width) + this.width) % this.width;
      } else if (nx < 0 || nx >= this.width) {
        continue;
      }

      const idx = ny * this.width + nx;
      out.push({
        direction: off.dir,
        cell: this.getCellByIndex(idx),
      });
    }

    return out;
  }

  /**
   * Zero-allocation neighbor iterator for future climate diffusion, fire spread,
   * and agent movement rules.
   */
  forEachNeighbor(
    x: number,
    y: number,
    visitor: (neighborIndex: number, nx: number, ny: number, direction: CompassDirection) => void,
    options: NeighborQueryOptions = {}
  ): void {
    if (!this.isInBounds(x, y)) return;

    const offsets = options.includeDiagonals ? MOORE_OFFSETS : CARDINAL_OFFSETS;
    const wrapX = options.wrapX === true;

    for (let i = 0; i < offsets.length; i++) {
      const off = offsets[i];
      let nx = x + off.dx;
      const ny = y + off.dy;
      if (ny < 0 || ny >= this.height) continue;

      if (wrapX) {
        nx = ((nx % this.width) + this.width) % this.width;
      } else if (nx < 0 || nx >= this.width) {
        continue;
      }

      visitor(ny * this.width + nx, nx, ny, off.dir);
    }
  }

  /**
   * Registers or retrieves an extensible per-cell Float32 layer
   * (e.g. 'fertility', 'fireIntensity', 'windX', 'soilWater') for future modules.
   */
  ensureLayer(name: string, initialValue = 0): Float32Array {
    if (!name.trim()) {
      throw new RangeError('Layer name must be non-empty');
    }
    if (!Number.isFinite(initialValue)) {
      throw new RangeError(`Layer initialValue must be finite: ${initialValue}`);
    }
    let layer = this.customLayers.get(name);
    if (!layer) {
      WorldGrid.assertSafeDimensions(
        this.width,
        this.height,
        this.customLayers.size + 1,
        this.maxMemoryBytes
      );
      try {
        layer = new Float32Array(this.cellCount);
      } catch (err) {
        throw new RangeError(
          `Failed to allocate WorldGrid layer "${name}" (${this.cellCount} cells): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      if (initialValue !== 0) {
        layer.fill(initialValue);
      }
      this.customLayers.set(name, layer);
    }
    return layer;
  }

  getLayer(name: string): Float32Array | undefined {
    return this.customLayers.get(name);
  }

  hasLayer(name: string): boolean {
    return this.customLayers.has(name);
  }

  listLayerNames(): string[] {
    return Array.from(this.customLayers.keys());
  }

  /**
   * Deep-copies the grid including all primary and custom scalar layers.
   */
  clone(): WorldGrid {
    WorldGrid.assertSafeDimensions(
      this.width,
      this.height,
      this.customLayers.size,
      this.maxMemoryBytes
    );
    const copy = new WorldGrid(this.width, this.height, this.seed, this.seaLevel, this.maxMemoryBytes);
    copy.elevation.set(this.elevation);
    copy.terrainCode.set(this.terrainCode);
    copy.temperature.set(this.temperature);
    copy.moisture.set(this.moisture);
    copy.biomeCode.set(this.biomeCode);
    copy.waterDepth.set(this.waterDepth);
    copy.biomass.set(this.biomass);
    for (const [name, buf] of this.customLayers.entries()) {
      let clonedLayer: Float32Array;
      try {
        clonedLayer = new Float32Array(this.cellCount);
      } catch (err) {
        throw new RangeError(
          `Failed to allocate cloned WorldGrid layer "${name}" (${this.cellCount} cells): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      clonedLayer.set(buf);
      copy.customLayers.set(name, clonedLayer);
    }
    return copy;
  }

  /**
   * Computes aggregate statistics across all cells for verification and telemetry.
   */
  getStats(): WorldGridStats {
    const biomeCounts = {} as Record<WorldBiomeId, number>;
    for (const b of WORLD_BIOME_IDS) {
      biomeCounts[b] = 0;
    }

    let waterCells = 0;
    let minElevation = Infinity;
    let maxElevation = -Infinity;
    let minTemperature = Infinity;
    let maxTemperature = -Infinity;
    let sumTemperature = 0;
    let sumMoisture = 0;
    let totalBiomass = 0;

    for (let i = 0; i < this.cellCount; i++) {
      const e = this.elevation[i];
      const t = this.temperature[i];
      const m = this.moisture[i];
      const w = this.waterDepth[i];
      const bio = this.biomass[i];
      const biome = WORLD_BIOME_IDS[this.biomeCode[i]];

      if (w > 0) waterCells++;
      if (e < minElevation) minElevation = e;
      if (e > maxElevation) maxElevation = e;
      if (t < minTemperature) minTemperature = t;
      if (t > maxTemperature) maxTemperature = t;
      sumTemperature += t;
      sumMoisture += m;
      totalBiomass += bio;
      biomeCounts[biome]++;
    }

    return {
      width: this.width,
      height: this.height,
      cellCount: this.cellCount,
      waterCells,
      landCells: this.cellCount - waterCells,
      minElevation,
      maxElevation,
      minTemperature,
      maxTemperature,
      avgTemperature: sumTemperature / this.cellCount,
      avgMoisture: sumMoisture / this.cellCount,
      totalBiomass,
      avgBiomass: totalBiomass / this.cellCount,
      biomeCounts,
    };
  }
}
