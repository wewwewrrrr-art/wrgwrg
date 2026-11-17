import { TERRAIN_TYPES, TerrainType } from '../worldGrid';
import { TrophicType } from './trophicProfile';

/**
 * Species-level spatial physiology (`src/sim/biology/spatialProfile.ts`).
 *
 * Describes HOW a species moves and senses, never WHAT it decides: decisions are produced by the
 * behavior controller from these parameters, the individual's expressed phenotype, its current
 * physiological state and what it currently perceives or remembers.
 */

export type LocomotionMode = 'terrestrial' | 'amphibious' | 'aquatic';

export const LOCOMOTION_MODES: readonly LocomotionMode[] = ['terrestrial', 'amphibious', 'aquatic'];

/** Movement cost multiplier per terrain; `0` (or any non-positive / non-finite value) = impassable. */
export type TerrainCostTable = Readonly<Record<TerrainType, number>>;

export interface SpatialSpeciesProfile {
  readonly locomotion: LocomotionMode;
  /** Movement points gained per tick by an individual whose expressed `speed` trait equals 1.0. */
  readonly cellsPerTick: number;
  /** Speed multiplier of the sprint gait used while fleeing or charging prey (>= 1). */
  readonly sprintMultiplier: number;
  /** Perception radius in cells for an individual whose expressed `perception` trait equals 1.0. */
  readonly perceptionRangeCells: number;
  /**
   * Locomotion energy per unit of path cost, expressed as a multiple of the species'
   * `activityCostFactor * bodyMassMU` (the same scale the trophic system uses for activity).
   */
  readonly walkCostPerCell: number;
  /** Energy multiplier of the sprint gait relative to walking (>= 1). */
  readonly sprintCostMultiplier: number;
  /** Energy of one capture attempt / evasion burst, in the same unit as `walkCostPerCell`. */
  readonly strikeCostCells: number;
  /** Scales how strongly perceived predators drive flight (0 = fearless). */
  readonly fearSensitivity: number;
  /** [0, 1] tendency to join conspecifics that are already migrating. */
  readonly sociality: number;
  /** [0, 1] resistance against leaving the current home range. */
  readonly siteFidelity: number;
  /** Nominal length of one migration leg in cells for an individual of endurance 1.0. */
  readonly migrationLegCells: number;
  /** Mean conspecifics per perceived cell tolerated before crowding builds dispersal pressure. */
  readonly crowdingTolerance: number;
  /** Hydration lost per tick in [0, 1]; `0` disables thirst for the species (e.g. aquatic). */
  readonly thirstPerTick: number;
  /** Land cells whose moisture is at least this value provide drinkable surface water. */
  readonly waterMoistureThreshold: number;
  /** Per-terrain movement cost; unlisted terrains fall back to the locomotion mode defaults. */
  readonly terrainCost?: Partial<Record<TerrainType, number>>;
}

const DEFAULT_TERRAIN_COST: Record<LocomotionMode, TerrainCostTable> = {
  terrestrial: {
    'deep-water': 0,
    'shallow-water': 0,
    shore: 1.15,
    lowland: 1.0,
    hills: 1.6,
    mountain: 3.0,
    peak: 0,
  },
  amphibious: {
    'deep-water': 0,
    'shallow-water': 1.2,
    shore: 1.0,
    lowland: 1.3,
    hills: 2.2,
    mountain: 0,
    peak: 0,
  },
  aquatic: {
    'deep-water': 1.0,
    'shallow-water': 1.1,
    shore: 0,
    lowland: 0,
    hills: 0,
    mountain: 0,
    peak: 0,
  },
};

const BASE_PROFILE: SpatialSpeciesProfile = Object.freeze({
  locomotion: 'terrestrial',
  cellsPerTick: 1.0,
  sprintMultiplier: 1.7,
  perceptionRangeCells: 3.0,
  walkCostPerCell: 0.5,
  sprintCostMultiplier: 2.5,
  strikeCostCells: 2.0,
  fearSensitivity: 1.0,
  sociality: 0.5,
  siteFidelity: 0.5,
  migrationLegCells: 12,
  crowdingTolerance: 3,
  thirstPerTick: 0.05,
  waterMoistureThreshold: 0.5,
});

const DIET_OVERRIDES: Record<TrophicType, Partial<SpatialSpeciesProfile>> = {
  herbivore: { fearSensitivity: 1.2, sociality: 0.75, siteFidelity: 0.45, crowdingTolerance: 4 },
  carnivore: {
    fearSensitivity: 0.6,
    sociality: 0.3,
    siteFidelity: 0.55,
    perceptionRangeCells: 4.0,
    crowdingTolerance: 2,
  },
  omnivore: { fearSensitivity: 0.85, sociality: 0.5, siteFidelity: 0.5, crowdingTolerance: 3 },
  scavenger: {
    fearSensitivity: 0.8,
    sociality: 0.35,
    siteFidelity: 0.3,
    perceptionRangeCells: 4.5,
    crowdingTolerance: 3,
  },
  detritivore: {
    fearSensitivity: 1.0,
    sociality: 0.4,
    siteFidelity: 0.7,
    cellsPerTick: 0.7,
    perceptionRangeCells: 2.0,
    crowdingTolerance: 6,
  },
};

function assertFiniteIn(value: number, min: number, max: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${label} must be a finite number in [${min}, ${max}], received: ${value}`);
  }
}

export function validateSpatialSpeciesProfile(profile: SpatialSpeciesProfile, label = 'spatialProfile'): void {
  if (!LOCOMOTION_MODES.includes(profile.locomotion)) {
    throw new RangeError(`${label}.locomotion invalid: ${String(profile.locomotion)}`);
  }
  assertFiniteIn(profile.cellsPerTick, 0, 16, `${label}.cellsPerTick`);
  assertFiniteIn(profile.sprintMultiplier, 1, 8, `${label}.sprintMultiplier`);
  assertFiniteIn(profile.perceptionRangeCells, 0, 64, `${label}.perceptionRangeCells`);
  assertFiniteIn(profile.walkCostPerCell, 0, 1000, `${label}.walkCostPerCell`);
  assertFiniteIn(profile.sprintCostMultiplier, 1, 100, `${label}.sprintCostMultiplier`);
  assertFiniteIn(profile.strikeCostCells, 0, 1000, `${label}.strikeCostCells`);
  assertFiniteIn(profile.fearSensitivity, 0, 10, `${label}.fearSensitivity`);
  assertFiniteIn(profile.sociality, 0, 1, `${label}.sociality`);
  assertFiniteIn(profile.siteFidelity, 0, 1, `${label}.siteFidelity`);
  assertFiniteIn(profile.migrationLegCells, 1, 4096, `${label}.migrationLegCells`);
  assertFiniteIn(profile.crowdingTolerance, 0, 65535, `${label}.crowdingTolerance`);
  assertFiniteIn(profile.thirstPerTick, 0, 1, `${label}.thirstPerTick`);
  assertFiniteIn(profile.waterMoistureThreshold, 0, 1, `${label}.waterMoistureThreshold`);
  if (profile.terrainCost) {
    for (const key of Object.keys(profile.terrainCost)) {
      if (!(TERRAIN_TYPES as readonly string[]).includes(key)) {
        throw new RangeError(`${label}.terrainCost has unknown terrain "${key}"`);
      }
      const v = profile.terrainCost[key as TerrainType];
      if (typeof v !== 'number' || Number.isNaN(v)) {
        throw new RangeError(`${label}.terrainCost.${key} must be a number, received: ${String(v)}`);
      }
    }
  }
}

/**
 * Resolves the effective spatial profile of a species: mode defaults <- diet defaults <-
 * species-declared values <- simulation-level overrides (later sources win).
 */
export function resolveSpatialSpeciesProfile(
  diet: TrophicType,
  declared?: Partial<SpatialSpeciesProfile>,
  override?: Partial<SpatialSpeciesProfile>,
  label = 'spatialProfile'
): SpatialSpeciesProfile {
  const merged: SpatialSpeciesProfile = {
    ...BASE_PROFILE,
    ...DIET_OVERRIDES[diet],
    ...(declared ?? {}),
    ...(override ?? {}),
  };
  const terrainCost =
    declared?.terrainCost || override?.terrainCost
      ? { ...(declared?.terrainCost ?? {}), ...(override?.terrainCost ?? {}) }
      : undefined;
  const resolved: SpatialSpeciesProfile = Object.freeze({
    ...merged,
    thirstPerTick: merged.locomotion === 'aquatic' ? 0 : merged.thirstPerTick,
    terrainCost,
  });
  validateSpatialSpeciesProfile(resolved, label);
  return resolved;
}

/** Dense per-terrain-code movement cost for a resolved profile (`0` = impassable). */
export function buildTerrainCostByCode(profile: SpatialSpeciesProfile): Float32Array {
  const base = DEFAULT_TERRAIN_COST[profile.locomotion];
  const out = new Float32Array(TERRAIN_TYPES.length);
  for (let i = 0; i < TERRAIN_TYPES.length; i++) {
    const terrain = TERRAIN_TYPES[i];
    const raw = profile.terrainCost?.[terrain] ?? base[terrain];
    out[i] = Number.isFinite(raw) && raw > 0 ? raw : 0;
  }
  return out;
}
