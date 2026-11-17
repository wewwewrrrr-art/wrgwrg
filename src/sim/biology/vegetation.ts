/**
 * Autonomous plant life (Phase 2.4.1).
 *
 * Two coupled levels of vegetation on top of the existing per-cell `CELL_PLANT` energy pools:
 *
 * - Mass vegetation (herbs, grasses, aquatic algae): aggregated standing biomass per cell and
 *   species with logistic growth on the cell's carrying capacity, shading, water and temperature
 *   limitation, litter, respiration, seed production, germination and grazing.
 * - Individual woody plants (shrubs, trees): persistent ids, age, biomass, height, health,
 *   heritable traits (diploid genome of the existing genetics), growth, ageing, reproduction,
 *   death; never aggregated or replaced.
 *
 * Energy contract: ALL plant biomass (herbs + woody individuals) lives in the existing per-cell
 * `CELL_PLANT` accounts. This module keeps an exact partition of each cell's plant mass by
 * component (`audit` checks sum(components) == ledger mass, energy is 3 EU per MU) and only uses
 * existing posting routes:
 *   growth           PHOTOSYNTHESIS      ABIOTIC (mass) + SUN (energy) -> CELL_PLANT
 *   respiration      PLANT_RESPIRATION   CELL_PLANT -> ABIOTIC (mass) + HEAT (energy)
 *   litter / death   PLANT_TURNOVER      CELL_PLANT -> CELL_DETRITUS
 *   seed investment  PLANT_TURNOVER      CELL_PLANT -> CELL_DETRITUS (parent cell)
 *   grazing          INGESTION/...       through the animals' existing feeding (edible part only)
 * The ledger has no plant->plant route between cells, so the seed bank is an aggregated density
 * of viable seeds without mass: the parent pays the seed biomass (turnover), the seedling fixes
 * its first biomass by photosynthesis in the cell where it germinates.
 *
 * Transactionality: `plan` (RESOLVE) writes only staged buffers, `stagePostings` / `stageConsumption`
 * (PREPARE) post to the open transaction and update staged buffers, `commit` (after the ledger
 * commit) publishes them; an ABORT simply drops the staged buffers. All randomness comes from one
 * RNG stream that the simulation snapshots and restores with its other streams.
 */

import { SeededRng } from '../prng';
import { WorldGrid } from '../worldGrid';
import { EnergyTransaction } from '../energyTransaction';
import { AccountKind, PostingReason } from '../energyAccounts';
import { MU_QUANTA_PER_UNIT } from '../units';
import {
  DiploidGenome,
  GeneDefinition,
  GenomeSchema,
  TraitRange,
  createHaploidGamete,
  createIndividualGenome,
  expressDiploidLocus,
} from './genome';
import { CompiledMutationPlan, MutationConfig, compileMutationPlan, mutateGenomeWithPlan } from './mutation';

// =================================================================================================
// Species
// =================================================================================================

export type PlantGrowthForm = 'herb' | 'aquatic' | 'shrub' | 'tree';

export interface PlantSpeciesDefinition {
  readonly id: string;
  readonly name: string;
  readonly form: PlantGrowthForm;
  /** Temperature of maximal growth (degC) and half-width of the growth window (degC). */
  readonly optimalTemperatureC: number;
  readonly temperatureToleranceC: number;
  /** Effective soil moisture below which growth stops and at which it becomes unlimited. */
  readonly moistureMin: number;
  readonly moistureOpt: number;
  /** Maximal gross production per tick per unit leaf mass (woody) or biomass (herbs) in full light. */
  readonly maxProductionRate: number;
  /** 0 = sun plant, 1 = deep-shade plant (higher efficiency at low light, lower maximal rate). */
  readonly shadeTolerance: number;
  /** Maintenance respiration per tick: of leaf/herb biomass, and of woody tissue. */
  readonly leafRespirationRate: number;
  readonly woodRespirationRate: number;
  /** Leaf (herb) litter fraction per tick. */
  readonly litterRate: number;
  /** Woody: maximal individual biomass; herbs: share of the cell carrying capacity reachable. */
  readonly maxBiomassMU: number;
  readonly maxHeightM: number;
  /** Woody: crown area at maximal size as a fraction of one cell. */
  readonly crownAreaMax: number;
  /** Woody: leaf share of biomass for seedlings and for full-size plants. */
  readonly leafFractionYoung: number;
  readonly leafFractionMature: number;
  /** Life cycle (woody): age and size at maturity, onset of senescence, typical maximal age. */
  readonly maturityAgeTicks: number;
  readonly maturityBiomassFraction: number;
  readonly senescenceAgeTicks: number;
  readonly maxAgeTicks: number;
  readonly backgroundMortality: number;
  /** Fraction of net (woody) or gross (herb) production invested in seeds once mature. */
  readonly reproductiveAllocation: number;
  readonly seedMassMU: number;
  /** Mean dispersal distance (cells) and share of seeds carried far (up to 4x). */
  readonly dispersalRadiusCells: number;
  readonly longDispersalFraction: number;
  /** Seed bank viability loss per tick and germination probability per seed per tick (ideal site). */
  readonly seedDecayRate: number;
  readonly germinationRate: number;
  /** Biomass of a fresh seedling (fixed by photosynthesis at germination). */
  readonly seedlingMassMU: number;
  /** Fraction of the standing (herb) / reachable leaf (woody) biomass animals can eat. */
  readonly edibleFraction: number;
  /** Heritable trait baselines (woody only; see PLANT_GENOME_SCHEMA). */
  readonly traitBaselines?: Readonly<Record<string, number>>;
}

export const PLANT_GENE_DEFINITIONS: readonly GeneDefinition[] = [
  { id: 'vigor', label: 'Growth vigor', defaultRange: { min: 0.6, max: 1.4 }, defaultDominance: 0.5, mutationRateMultiplier: 1, mutationScaleMultiplier: 1 },
  { id: 'shadeAdaptation', label: 'Shade adaptation', defaultRange: { min: -0.3, max: 0.3 }, defaultDominance: 0.5, mutationRateMultiplier: 1, mutationScaleMultiplier: 1 },
  { id: 'droughtAdaptation', label: 'Drought adaptation', defaultRange: { min: -0.2, max: 0.2 }, defaultDominance: 0.5, mutationRateMultiplier: 1, mutationScaleMultiplier: 1 },
  { id: 'coldAdaptation', label: 'Cold adaptation (degC)', defaultRange: { min: -6, max: 6 }, defaultDominance: 0.5, mutationRateMultiplier: 1, mutationScaleMultiplier: 1 },
];
/** Diploid genome of woody plants, built on the existing genome machinery (schema, gametes, mutation). */
export const PLANT_GENOME_SCHEMA = new GenomeSchema('plant-core', PLANT_GENE_DEFINITIONS);
const G_VIGOR = 0;
const G_SHADE = 1;
const G_DROUGHT = 2;
const G_COLD = 3;
const PLANT_LOCI = PLANT_GENOME_SCHEMA.locusCount;
const PLANT_DEFAULT_TRAITS: Readonly<Record<string, number>> = { vigor: 1, shadeAdaptation: 0, droughtAdaptation: 0, coldAdaptation: 0 };
const PLANT_TRAIT_RANGES: Readonly<Record<string, TraitRange>> = Object.fromEntries(
  PLANT_GENE_DEFINITIONS.map((d) => [d.id, d.defaultRange])
);

/** Example plant strategies used by default (parameters, not scripted outcomes). */
export const MEADOW_GRASS: PlantSpeciesDefinition = {
  id: 'meadow-grass', name: 'Meadow grass', form: 'herb',
  optimalTemperatureC: 22, temperatureToleranceC: 19, moistureMin: 0.22, moistureOpt: 0.55,
  maxProductionRate: 0.9, shadeTolerance: 0.15, leafRespirationRate: 0.05, woodRespirationRate: 0, litterRate: 0.04,
  maxBiomassMU: 1, maxHeightM: 0.6, crownAreaMax: 0, leafFractionYoung: 1, leafFractionMature: 1,
  maturityAgeTicks: 0, maturityBiomassFraction: 0, senescenceAgeTicks: 0, maxAgeTicks: 0, backgroundMortality: 0,
  reproductiveAllocation: 0.05, seedMassMU: 0.002, dispersalRadiusCells: 1, longDispersalFraction: 0.03,
  seedDecayRate: 0.02, germinationRate: 0.03, seedlingMassMU: 0.004,
  // the basal meristems and below-ground reserves (~40 %) cannot be grazed: grasses regrow from them
  edibleFraction: 0.6,
};
export const TUNDRA_SEDGE: PlantSpeciesDefinition = {
  ...MEADOW_GRASS, id: 'tundra-sedge', name: 'Tundra sedge',
  optimalTemperatureC: 6, temperatureToleranceC: 17, moistureMin: 0.18, moistureOpt: 0.5,
  maxProductionRate: 0.45, leafRespirationRate: 0.03, litterRate: 0.025, shadeTolerance: 0.25,
};
export const ALGAE: PlantSpeciesDefinition = {
  ...MEADOW_GRASS, id: 'algae', name: 'Algae', form: 'aquatic',
  optimalTemperatureC: 20, temperatureToleranceC: 20, moistureMin: 0, moistureOpt: 0,
  maxProductionRate: 0.8, leafRespirationRate: 0.06, litterRate: 0.05, shadeTolerance: 0.3,
  reproductiveAllocation: 0.03, dispersalRadiusCells: 1, longDispersalFraction: 0.05, seedDecayRate: 0.05,
  germinationRate: 0.05, seedlingMassMU: 0.003, edibleFraction: 0.7,
};
export const DESERT_SHRUB: PlantSpeciesDefinition = {
  id: 'desert-shrub', name: 'Desert shrub', form: 'shrub',
  optimalTemperatureC: 30, temperatureToleranceC: 20, moistureMin: 0.02, moistureOpt: 0.22,
  maxProductionRate: 0.09, shadeTolerance: 0.2, leafRespirationRate: 0.012, woodRespirationRate: 0.001, litterRate: 0.008,
  maxBiomassMU: 14, maxHeightM: 1.6, crownAreaMax: 0.18, leafFractionYoung: 0.55, leafFractionMature: 0.18,
  maturityAgeTicks: 70, maturityBiomassFraction: 0.35, senescenceAgeTicks: 700, maxAgeTicks: 1100, backgroundMortality: 0.0003,
  reproductiveAllocation: 0.3, seedMassMU: 0.01, dispersalRadiusCells: 2, longDispersalFraction: 0.05,
  seedDecayRate: 0.006, germinationRate: 0.02, seedlingMassMU: 0.03, edibleFraction: 0.6,
};
export const PIONEER_TREE: PlantSpeciesDefinition = {
  id: 'pioneer-tree', name: 'Pioneer birch', form: 'tree',
  optimalTemperatureC: 16, temperatureToleranceC: 19, moistureMin: 0.3, moistureOpt: 0.6,
  maxProductionRate: 0.17, shadeTolerance: 0.1, leafRespirationRate: 0.02, woodRespirationRate: 0.0018, litterRate: 0.02,
  maxBiomassMU: 45, maxHeightM: 16, crownAreaMax: 0.3, leafFractionYoung: 0.6, leafFractionMature: 0.1,
  maturityAgeTicks: 50, maturityBiomassFraction: 0.25, senescenceAgeTicks: 300, maxAgeTicks: 520, backgroundMortality: 0.0006,
  reproductiveAllocation: 0.35, seedMassMU: 0.002, dispersalRadiusCells: 4, longDispersalFraction: 0.08,
  seedDecayRate: 0.03, germinationRate: 0.015, seedlingMassMU: 0.03, edibleFraction: 0.8,
};
export const BROADLEAF_TREE: PlantSpeciesDefinition = {
  id: 'broadleaf-tree', name: 'Broadleaf oak', form: 'tree',
  optimalTemperatureC: 19, temperatureToleranceC: 17, moistureMin: 0.35, moistureOpt: 0.65,
  maxProductionRate: 0.12, shadeTolerance: 0.7, leafRespirationRate: 0.016, woodRespirationRate: 0.0012, litterRate: 0.016,
  maxBiomassMU: 90, maxHeightM: 26, crownAreaMax: 0.4, leafFractionYoung: 0.55, leafFractionMature: 0.08,
  maturityAgeTicks: 140, maturityBiomassFraction: 0.3, senescenceAgeTicks: 900, maxAgeTicks: 1500, backgroundMortality: 0.0003,
  reproductiveAllocation: 0.25, seedMassMU: 0.03, dispersalRadiusCells: 2, longDispersalFraction: 0.04,
  seedDecayRate: 0.01, germinationRate: 0.02, seedlingMassMU: 0.05, edibleFraction: 0.8,
};
export const BOREAL_CONIFER: PlantSpeciesDefinition = {
  ...BROADLEAF_TREE, id: 'boreal-conifer', name: 'Boreal spruce',
  optimalTemperatureC: 6, temperatureToleranceC: 18, moistureMin: 0.28, moistureOpt: 0.55,
  maxProductionRate: 0.09, shadeTolerance: 0.6, leafRespirationRate: 0.012, woodRespirationRate: 0.001, litterRate: 0.008,
  maxBiomassMU: 70, maxHeightM: 22, crownAreaMax: 0.3, leafFractionMature: 0.1,
  maturityAgeTicks: 160, senescenceAgeTicks: 1000, maxAgeTicks: 1700, dispersalRadiusCells: 3,
};

export const DEFAULT_PLANT_SPECIES: readonly PlantSpeciesDefinition[] = [
  MEADOW_GRASS, TUNDRA_SEDGE, ALGAE, DESERT_SHRUB, PIONEER_TREE, BROADLEAF_TREE, BOREAL_CONIFER,
];

export interface VegetationConfig {
  /** Plant species (default: DEFAULT_PLANT_SPECIES). */
  readonly species?: readonly PlantSpeciesDefinition[];
  /** Fraction of each cell's herb capacity filled with suitable herbs at genesis (default 0.7). */
  readonly initialHerbCover?: number;
  /** Viable seeds per cell and suitable species in the initial seed bank (default 0.5). */
  readonly initialSeedDensity?: number;
  /** Ticks between updates of one woody individual (default 4; growth integrates the elapsed ticks). */
  readonly woodyUpdateInterval?: number;
  /** Maximum woody recruits per tick (bounded object creation, default 4000). */
  readonly maxRecruitsPerTick?: number;
  /** Plant mutation (woody genome); default baseRate 0.02, stepScale 0.05. */
  readonly mutation?: MutationConfig;
  /** Death records kept for history queries (default 5000, oldest dropped first). */
  readonly maxDeathRecords?: number;
  /** Aquatic producer carrying capacity per water cell, MU (shallow water; deep water 30 %). */
  readonly aquaticCapacityMU?: number;
}

// =================================================================================================
// Public read models
// =================================================================================================

export type PlantStage = 'seedling' | 'juvenile' | 'mature' | 'senescent';
export type PlantDeathCause = 'senescence' | 'carbon-starvation' | 'climate' | 'herbivory' | 'background';

export interface PlantSnapshot {
  readonly id: number;
  readonly speciesId: string;
  readonly x: number;
  readonly y: number;
  readonly cellIndex: number;
  readonly birthTick: number;
  readonly ageTicks: number;
  readonly stage: PlantStage;
  readonly biomassMU: number;
  readonly leafMassMU: number;
  readonly heightM: number;
  readonly crownArea: number;
  readonly health: number;
  readonly peakBiomassMU: number;
  readonly motherId: number | null;
  readonly fatherId: number | null;
  readonly generation: number;
  readonly traits: Readonly<Record<string, number>>;
}

export interface PlantDeathRecord {
  readonly id: number;
  readonly speciesId: string;
  readonly cellIndex: number;
  readonly birthTick: number;
  readonly deathTick: number;
  readonly cause: PlantDeathCause;
  readonly peakBiomassMU: number;
  readonly generation: number;
}

export interface VegetationCellSummary {
  readonly cellIndex: number;
  readonly herbMassMU: Readonly<Record<string, number>>;
  readonly woodyIds: readonly number[];
  readonly woodyMassMU: number;
  readonly seedBank: Readonly<Record<string, number>>;
  readonly canopyLeafAreaIndex: number;
  readonly crownCover: number;
  readonly groundLight: number;
  readonly totalPlantMassQ: number;
}

export interface VegetationTickStats {
  grossProductionQ: number;
  respirationQ: number;
  turnoverQ: number;
  consumedQ: number;
  recruits: number;
  woodyDeaths: number;
  herbGerminationQ: number;
  seedsProduced: number;
  seedsGerminated: number;
}

export interface VegetationTotals {
  births: number;
  deaths: number;
  deathsByCause: Record<PlantDeathCause, number>;
  grossProductionQ: number;
  consumedQ: number;
}

// =================================================================================================
// Runtime constants
// =================================================================================================

const Q = MU_QUANTA_PER_UNIT;
/** Light extinction coefficient of the canopy (Beer-Lambert). */
const K_EXT = 0.5;
/** Leaf area per MU of leaf (cell-area units): ~4 LAI for a closed forest of a few large trees. */
const SLA_WOODY = 0.21;
const SLA_HERB = 0.025;
/** Water competition: effective moisture shrinks with the transpiring leaf area of the cell. */
const WATER_COMPETITION = 0.06;
/** Animals reach leaves up to this height. */
const BROWSE_HEIGHT_M = 2.5;
/** Herb stands below this biomass die out (local extinction). */
const HERB_MIN_Q = Math.round(0.002 * Q);
/**
 * Ground space a woody individual occupies even as a seedling (fraction of a cell): bounds the
 * number of individuals per cell (~20) and makes dense stands block new establishment.
 */
const MIN_FOOTPRINT = 0.05;
/** Lethal climate: beyond 1.3 tolerance widths from the optimum. */
const LETHAL_WIDTH = 1.3;
const STAGE_SEEDLING = 0;
const STAGE_JUVENILE = 1;
const STAGE_MATURE = 2;
const STAGE_SENESCENT = 3;
const STAGE_NAMES: readonly PlantStage[] = ['seedling', 'juvenile', 'mature', 'senescent'];
const DEATH_CAUSES: readonly PlantDeathCause[] = ['senescence', 'carbon-starvation', 'climate', 'herbivory', 'background'];

interface PlantRuntime {
  readonly def: PlantSpeciesDefinition;
  readonly index: number;
  readonly woody: boolean;
  readonly aquatic: boolean;
  /** Index among aggregated species (herbs + aquatic) or -1. */
  readonly herbIndex: number;
  readonly maxMassQ: number;
  readonly seedlingMassQ: number;
  readonly kernelOffsets: Int32Array; // dx, dy pairs
  readonly kernelWeights: Float64Array;
  readonly lightHalf: number;
  readonly sunPenalty: number;
  /** Minimal ground light for establishment (sun plants need gaps, shade plants do not). */
  readonly germinationLightMin: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Light response normalised to 1 in full light; shade plants saturate earlier, sun plants later. */
function lightResponse(light: number, shadeTolerance: number): number {
  const half = 0.05 + 0.6 * (1 - clamp01(shadeTolerance));
  return (light * (1 + half)) / (light + half);
}

function temperatureResponse(t: number, opt: number, tol: number): number {
  const d = (t - opt) / tol;
  const g = 1 - d * d;
  return g > 0 ? g : 0;
}

function moistureResponse(m: number, mMin: number, mOpt: number): number {
  if (mOpt <= mMin) return m >= mMin ? 1 : 0;
  return clamp01((m - mMin) / (mOpt - mMin));
}


/** Deterministic uniform in [0, 1) from three integers (avalanche hash). */
function unitHash(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul((c | 0) + 0x632be5ab, 0xc2b2ae3d);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Site response from pre-evaluated cell environment (same as VegetationSystem.siteResponse). */
function siteFast(r: PlantRuntime, water: boolean, temp: number, moist: number, terrainFactor: number): number {
  if (r.aquatic !== water) return 0;
  const def = r.def;
  const gT = temperatureResponse(temp, def.optimalTemperatureC, def.temperatureToleranceC);
  if (gT <= 0) return 0;
  if (r.aquatic) return gT;
  return gT * moistureResponse(moist, def.moistureMin, def.moistureOpt) * terrainFactor;
}

// =================================================================================================
// VegetationSystem
// =================================================================================================

export class VegetationSystem {
  readonly species: readonly PlantSpeciesDefinition[];
  readonly woodyUpdateInterval: number;
  private readonly rt: PlantRuntime[];
  private readonly herbSpecies: PlantRuntime[];
  private readonly grid: WorldGrid;
  private readonly width: number;
  private readonly height: number;
  private readonly cellCount: number;
  private readonly herbCount: number;
  private readonly speciesCount: number;
  /** Herb carrying capacity per land cell (Q, the simulation's biome x moisture capacity). */
  private readonly herbCapQ: Float64Array;
  private readonly aquaticCapQ: number;
  private readonly maxRecruitsPerTick: number;
  private readonly mutationPlan: CompiledMutationPlan;
  private readonly maxDeathRecords: number;
  private readonly initialHerbCover: number;
  private readonly initialSeedDensity: number;

  // --- committed state --------------------------------------------------------------------------
  private herbMass: Float64Array; // [cell * H + h] Q
  private seedBank: Float32Array; // [cell * S + s] seeds
  private cap = 0;
  private wId = new Float64Array(0);
  private wSpecies = new Uint8Array(0);
  private wCell = new Int32Array(0);
  private wBirth = new Int32Array(0);
  private wMass = new Float64Array(0); // Q
  private wHealth = new Float32Array(0);
  private wPeak = new Float64Array(0);
  private wMother = new Float64Array(0);
  private wFather = new Float64Array(0);
  private wGeneration = new Int32Array(0);
  private wAlive = new Uint8Array(0);
  private wNext = new Int32Array(0);
  private wGenMat = new Float32Array(0);
  private wGenPat = new Float32Array(0);
  private readonly cellHead: Int32Array;
  private readonly freeSlots: number[] = [];
  private slotHigh = 0;
  private liveWoody = 0;
  private nextPlantId = 1;
  private readonly idToSlot = new Map<number, number>();
  /** Bounded death history (ring buffer, oldest overwritten first). */
  private readonly deathLog: PlantDeathRecord[] = [];
  private deathLogStart = 0;
  readonly totals: VegetationTotals = {
    births: 0,
    deaths: 0,
    deathsByCause: { senescence: 0, 'carbon-starvation': 0, climate: 0, herbivory: 0, background: 0 },
    grossProductionQ: 0,
    consumedQ: 0,
  };
  lastTickStats: VegetationTickStats = VegetationSystem.emptyStats();

  // --- staged state (one tick) -------------------------------------------------------------------
  private herbNext: Float64Array;
  private seedNext: Float32Array;
  private stagedTick = -1;
  private stamp = new Int32Array(0);
  private tMass = new Float64Array(0);
  private tHealth = new Float32Array(0);
  private tDeathCause = new Int8Array(0); // -1 alive, else index into DEATH_CAUSES
  private readonly touched: number[] = [];
  private readonly recruits: {
    species: number;
    cell: number;
    massQ: number;
    mother: number;
    father: number;
    generation: number;
    genMat: Float32Array;
    genPat: Float32Array;
  }[] = [];
  /** Per-cell ledger deltas of this tick (Q) and the list of cells with any posting. */
  readonly cellGainQ: Float64Array;
  readonly cellRespQ: Float64Array;
  readonly cellTurnoverQ: Float64Array;
  private readonly postCells: number[] = [];
  private readonly postMark: Uint8Array;
  /** Edible plant mass per cell after this tick's growth (what animals may eat this tick). */
  readonly edibleQ: Float64Array;
  private stats: VegetationTickStats = VegetationSystem.emptyStats();
  private planned = false;

  // --- scratch ------------------------------------------------------------------------------------
  /** Geometry cache of the committed mass (recomputed only when the mass changes). */
  private sLeaf = new Float64Array(0);
  private sHeight = new Float64Array(0);
  private sLA = new Float64Array(0);
  private sCrown = new Float64Array(0);
  private readonly cellLAI: Float64Array;
  private readonly cellCover: Float64Array;
  private readonly cellHerbLAI: Float64Array;
  private readonly seedSource: Float32Array; // [cell * S + s] seeds produced this tick
  private readonly seedSourceCells: number[] = [];
  private readonly seedSourceMark: Uint8Array;
  private readonly gameteA = new Float32Array(PLANT_LOCI);
  private readonly gameteB = new Float32Array(PLANT_LOCI);

  constructor(grid: WorldGrid, herbCapacityQ: Float64Array, config: VegetationConfig = {}) {
    const species = config.species ?? DEFAULT_PLANT_SPECIES;
    if (species.length === 0 || species.length > 64) throw new RangeError('vegetation needs 1..64 plant species');
    const ids = new Set<string>();
    for (const sp of species) {
      if (ids.has(sp.id)) throw new RangeError(`duplicate plant species id ${sp.id}`);
      ids.add(sp.id);
      validatePlantSpecies(sp);
    }
    this.species = species;
    this.grid = grid;
    this.width = grid.width;
    this.height = grid.height;
    this.cellCount = grid.cellCount;
    const interval = config.woodyUpdateInterval ?? 4;
    if (!Number.isInteger(interval) || interval < 1 || interval > 64) throw new RangeError('woodyUpdateInterval must be an integer in [1, 64]');
    this.woodyUpdateInterval = interval;
    this.maxRecruitsPerTick = Math.max(0, Math.floor(config.maxRecruitsPerTick ?? 4000));
    this.maxDeathRecords = Math.max(0, Math.floor(config.maxDeathRecords ?? 5000));
    this.initialHerbCover = clamp01(config.initialHerbCover ?? 0.7);
    this.initialSeedDensity = Math.max(0, config.initialSeedDensity ?? 0.5);
    this.mutationPlan = compileMutationPlan(PLANT_GENOME_SCHEMA, PLANT_TRAIT_RANGES, config.mutation ?? { baseRate: 0.02, stepScale: 0.05 });

    let herbIdx = 0;
    this.rt = species.map((def, index) => {
      const woody = def.form === 'shrub' || def.form === 'tree';
      const r = Math.max(1, def.dispersalRadiusCells);
      const offs: number[] = [];
      const wts: number[] = [];
      let wsum = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > r + 0.5) continue;
          const w = Math.exp(-d / Math.max(0.5, def.dispersalRadiusCells * 0.6));
          offs.push(dx, dy);
          wts.push(w);
          wsum += w;
        }
      }
      return {
        def,
        index,
        woody,
        aquatic: def.form === 'aquatic',
        herbIndex: woody ? -1 : herbIdx++,
        maxMassQ: Math.round(def.maxBiomassMU * Q),
        seedlingMassQ: Math.max(1, Math.round(def.seedlingMassMU * Q)),
        kernelOffsets: Int32Array.from(offs),
        kernelWeights: Float64Array.from(wts.map((w) => w / wsum)),
        lightHalf: 0.05 + 0.6 * (1 - clamp01(def.shadeTolerance)),
        sunPenalty: 1 - 0.3 * clamp01(def.shadeTolerance),
        germinationLightMin: 0.6 * Math.pow(1 - clamp01(def.shadeTolerance), 1.5),
      };
    });
    this.herbSpecies = this.rt.filter((r) => !r.woody);
    this.herbCount = this.herbSpecies.length;
    this.speciesCount = species.length;

    const n = this.cellCount;
    this.herbCapQ = new Float64Array(n);
    this.aquaticCapQ = Math.round(Math.max(0, config.aquaticCapacityMU ?? 60) * Q);
    for (let i = 0; i < n; i++) this.herbCapQ[i] = herbCapacityQ[i] ?? 0;
    this.herbMass = new Float64Array(n * this.herbCount);
    this.herbNext = new Float64Array(n * this.herbCount);
    this.seedBank = new Float32Array(n * this.speciesCount);
    this.seedNext = new Float32Array(n * this.speciesCount);
    this.cellHead = new Int32Array(n).fill(-1);
    this.cellGainQ = new Float64Array(n);
    this.cellRespQ = new Float64Array(n);
    this.cellTurnoverQ = new Float64Array(n);
    this.postMark = new Uint8Array(n);
    this.edibleQ = new Float64Array(n);
    this.cellLAI = new Float64Array(n);
    this.cellCover = new Float64Array(n);
    this.cellHerbLAI = new Float64Array(n);
    this.seedSource = new Float32Array(n * this.speciesCount);
    this.seedSourceMark = new Uint8Array(n);
    this.ensureCapacity(256);
  }

  static emptyStats(): VegetationTickStats {
    return { grossProductionQ: 0, respirationQ: 0, turnoverQ: 0, consumedQ: 0, recruits: 0, woodyDeaths: 0, herbGerminationQ: 0, seedsProduced: 0, seedsGerminated: 0 };
  }

  // ===============================================================================================
  // Environment
  // ===============================================================================================

  private effectiveMoisture(cell: number): number {
    const g = this.grid;
    const base = g.moisture[cell] + (g.waterDepth[cell] > 0 ? 0.15 : 0);
    const lai = this.cellLAI[cell] + this.cellHerbLAI[cell];
    return clamp01(base) / (1 + WATER_COMPETITION * lai);
  }

  /** Live terrain reads (the world grid may change between ticks). */
  private isWaterCell(cell: number): boolean {
    return this.grid.terrainCode[cell] <= 1;
  }

  private terrainFactor(cell: number): number {
    const t = this.grid.terrainCode[cell];
    return t === 6 ? 0.15 : t === 5 ? 0.55 : t === 4 ? 0.85 : 1;
  }

  /** Herb (land) or aquatic-producer (water: shallow full, deep 30 %) carrying capacity, Q. */
  private capacityQ(cell: number): number {
    const t = this.grid.terrainCode[cell];
    if (t <= 1) return t === 1 ? this.aquaticCapQ : Math.round(this.aquaticCapQ * 0.3);
    return this.herbCapQ[cell];
  }

  /** Suitability of a cell for a species in [0, 1] (temperature x moisture x terrain). */
  private siteResponse(r: PlantRuntime, cell: number, tempShift = 0, droughtShift = 0): number {
    const water = this.isWaterCell(cell);
    if (r.aquatic !== water) return 0;
    const def = r.def;
    const t = this.grid.temperature[cell];
    const gT = temperatureResponse(t, def.optimalTemperatureC - tempShift, def.temperatureToleranceC);
    if (gT <= 0) return 0;
    if (r.aquatic) return gT;
    const gM = moistureResponse(this.effectiveMoisture(cell), def.moistureMin - droughtShift, def.moistureOpt - droughtShift);
    return gT * gM * this.terrainFactor(cell);
  }

  private isLethalClimate(r: PlantRuntime, cell: number, tempShift: number): boolean {
    const t = this.grid.temperature[cell];
    return Math.abs(t - (r.def.optimalTemperatureC - tempShift)) > LETHAL_WIDTH * r.def.temperatureToleranceC;
  }

  // ===============================================================================================
  // Woody storage
  // ===============================================================================================

  private ensureCapacity(need: number): void {
    if (need <= this.cap) return;
    let c = Math.max(256, this.cap);
    while (c < need) c *= 2;
    const g64 = (a: Float64Array) => { const b = new Float64Array(c); b.set(a); return b; };
    const g32 = (a: Float32Array, m = 1) => { const b = new Float32Array(c * m); b.set(a); return b; };
    const gi32 = (a: Int32Array) => { const b = new Int32Array(c); b.set(a); return b; };
    const gu8 = (a: Uint8Array) => { const b = new Uint8Array(c); b.set(a); return b; };
    this.wId = g64(this.wId);
    this.wSpecies = gu8(this.wSpecies);
    this.wCell = gi32(this.wCell);
    this.wBirth = gi32(this.wBirth);
    this.wMass = g64(this.wMass);
    this.wHealth = g32(this.wHealth);
    this.wPeak = g64(this.wPeak);
    this.wMother = g64(this.wMother);
    this.wFather = g64(this.wFather);
    this.wGeneration = gi32(this.wGeneration);
    this.wAlive = gu8(this.wAlive);
    this.wNext = gi32(this.wNext);
    this.wGenMat = g32(this.wGenMat, PLANT_LOCI);
    this.wGenPat = g32(this.wGenPat, PLANT_LOCI);
    const st = new Int32Array(c).fill(-1);
    st.set(this.stamp);
    this.stamp = st;
    this.tMass = g64(this.tMass);
    this.tHealth = g32(this.tHealth);
    const dc = new Int8Array(c).fill(-1);
    dc.set(this.tDeathCause);
    this.tDeathCause = dc;
    this.sLeaf = g64(this.sLeaf);
    this.sHeight = g64(this.sHeight);
    this.sLA = g64(this.sLA);
    this.sCrown = g64(this.sCrown);
    this.cap = c;
  }

  private gene(slot: number, locus: number): number {
    return expressDiploidLocus(this.wGenMat[slot * PLANT_LOCI + locus], this.wGenPat[slot * PLANT_LOCI + locus], 0.5);
  }

  private leafFraction(r: PlantRuntime, massQ: number): number {
    const def = r.def;
    const rel = r.maxMassQ > 0 ? Math.min(1, massQ / r.maxMassQ) : 1;
    return def.leafFractionYoung + (def.leafFractionMature - def.leafFractionYoung) * Math.sqrt(rel);
  }

  private heightOf(r: PlantRuntime, massQ: number): number {
    return r.def.maxHeightM * Math.pow(Math.min(1, massQ / r.maxMassQ), 0.4);
  }

  private refreshGeometry(slot: number): void {
    const r = this.rt[this.wSpecies[slot]];
    const m = this.wMass[slot];
    const leaf = m * this.leafFraction(r, m);
    this.sLeaf[slot] = leaf;
    this.sHeight[slot] = this.heightOf(r, m);
    this.sLA[slot] = (leaf / Q) * SLA_WOODY;
    this.sCrown[slot] = this.crownOf(r, m);
  }

  private crownOf(r: PlantRuntime, massQ: number): number {
    const c = r.def.crownAreaMax * Math.pow(Math.min(1, massQ / r.maxMassQ), 0.66);
    return c > MIN_FOOTPRINT ? c : MIN_FOOTPRINT;
  }

  /** Staged-or-committed mass of a woody slot within the current tick. */
  private massNow(slot: number): number {
    return this.stamp[slot] === this.stagedTick ? this.tMass[slot] : this.wMass[slot];
  }

  private touch(slot: number): void {
    if (this.stamp[slot] !== this.stagedTick) {
      this.stamp[slot] = this.stagedTick;
      this.tMass[slot] = this.wMass[slot];
      this.tHealth[slot] = this.wHealth[slot];
      this.tDeathCause[slot] = -1;
      this.touched.push(slot);
    }
  }

  private markPost(cell: number): void {
    if (this.postMark[cell] === 0) {
      this.postMark[cell] = 1;
      this.postCells.push(cell);
    }
  }

  private addSeeds(species: number, cell: number, seeds: number): void {
    if (!(seeds > 0)) return;
    this.seedSource[cell * this.speciesCount + species] += seeds;
    if (this.seedSourceMark[cell] === 0) {
      this.seedSourceMark[cell] = 1;
      this.seedSourceCells.push(cell);
    }
  }

  // ===============================================================================================
  // Genesis / setup (outside ticks)
  // ===============================================================================================

  /**
   * Initial herb biomass per cell for the genesis transaction (replaces the plain 70 % fill of the
   * plant pool): the cover is shared among the herb species in proportion to their site response.
   * Also fills the initial seed bank. Must be called once before the first tick.
   */
  initializeGenesis(): Float64Array {
    const out = new Float64Array(this.cellCount);
    const H = this.herbCount;
    const S = this.speciesCount;
    for (let c = 0; c < this.cellCount; c++) {
      const capQ = this.capacityQ(c);
      let wsum = 0;
      const w = new Float64Array(H);
      for (let h = 0; h < H; h++) {
        w[h] = this.siteResponse(this.herbSpecies[h], c);
        wsum += w[h];
      }
      if (wsum > 0 && capQ > 0 && this.initialHerbCover > 0) {
        const totalQ = Math.floor(capQ * this.initialHerbCover);
        for (let h = 0; h < H; h++) {
          const m = Math.floor((totalQ * w[h]) / wsum);
          this.herbMass[c * H + h] = m;
          out[c] += m;
        }
      }
      if (this.initialSeedDensity > 0) {
        for (let s = 0; s < S; s++) {
          if (this.siteResponse(this.rt[s], c) > 0) this.seedBank[c * S + s] = this.initialSeedDensity;
        }
      }
    }
    return out;
  }

  /** Adds viable seeds (no biomass) to cells within `radius` of (x, y); e.g. an initial seed source. */
  addSeedSource(speciesId: string, x: number, y: number, radius: number, seedsPerCell: number): number {
    const s = this.speciesIndex(speciesId);
    let cells = 0;
    for (let yy = Math.max(0, y - radius); yy <= Math.min(this.height - 1, y + radius); yy++) {
      for (let xx = Math.max(0, x - radius); xx <= Math.min(this.width - 1, x + radius); xx++) {
        if ((xx - x) * (xx - x) + (yy - y) * (yy - y) > radius * radius) continue;
        const c = yy * this.width + xx;
        if (this.isWaterCell(c) !== this.rt[s].aquatic) continue;
        this.seedBank[c * this.speciesCount + s] += seedsPerCell;
        cells++;
      }
    }
    return cells;
  }

  /**
   * Plans woody founders (genesis): returns the cells and masses the caller must fund from GENESIS
   * into CELL_PLANT; `commitFounders` then registers them. Founder genomes follow the species
   * baseline with standing variation.
   */
  planFounders(
    speciesId: string,
    cells: readonly number[],
    sizeFraction: number,
    rng: SeededRng
  ): { cell: number; massQ: number; genome: DiploidGenome }[] {
    const s = this.speciesIndex(speciesId);
    const r = this.rt[s];
    if (!r.woody) throw new RangeError(`${speciesId} is not a woody species`);
    const base = { ...PLANT_DEFAULT_TRAITS, ...(r.def.traitBaselines ?? {}) };
    return cells.map((cell) => ({
      cell,
      massQ: Math.max(r.seedlingMassQ, Math.round(r.maxMassQ * clamp01(sizeFraction) * (0.75 + 0.5 * rng.nextFloat()))),
      genome: createIndividualGenome(PLANT_GENOME_SCHEMA, base, PLANT_TRAIT_RANGES, 0.15, rng),
    }));
  }

  commitFounders(speciesId: string, founders: readonly { cell: number; massQ: number; genome: DiploidGenome }[], tick: number, ageTicks: number): number[] {
    const s = this.speciesIndex(speciesId);
    const ids: number[] = [];
    for (const f of founders) {
      ids.push(this.insertWoody(s, f.cell, f.massQ, tick - ageTicks, -1, -1, 0, f.genome.maternalAlleles, f.genome.paternalAlleles));
    }
    return ids;
  }

  private insertWoody(
    s: number, cell: number, massQ: number, birthTick: number, mother: number, father: number, generation: number,
    genMat: Float32Array, genPat: Float32Array
  ): number {
    let slot: number;
    if (this.freeSlots.length > 0) slot = this.freeSlots.pop()!;
    else {
      slot = this.slotHigh++;
      this.ensureCapacity(this.slotHigh);
    }
    const id = this.nextPlantId++;
    this.wId[slot] = id;
    this.wSpecies[slot] = s;
    this.wCell[slot] = cell;
    this.wBirth[slot] = birthTick;
    this.wMass[slot] = massQ;
    this.wHealth[slot] = 1;
    this.wPeak[slot] = massQ;
    this.wMother[slot] = mother;
    this.wFather[slot] = father;
    this.wGeneration[slot] = generation;
    this.wAlive[slot] = 1;
    this.wGenMat.set(genMat.subarray(0, PLANT_LOCI), slot * PLANT_LOCI);
    this.wGenPat.set(genPat.subarray(0, PLANT_LOCI), slot * PLANT_LOCI);
    this.wNext[slot] = this.cellHead[cell];
    this.cellHead[cell] = slot;
    this.stamp[slot] = -1;
    this.refreshGeometry(slot);
    this.idToSlot.set(id, slot);
    this.liveWoody++;
    this.totals.births++;
    return id;
  }

  private removeWoody(slot: number): void {
    const cell = this.wCell[slot];
    let prev = -1;
    for (let cur = this.cellHead[cell]; cur !== -1; cur = this.wNext[cur]) {
      if (cur === slot) {
        if (prev === -1) this.cellHead[cell] = this.wNext[cur];
        else this.wNext[prev] = this.wNext[cur];
        break;
      }
      prev = cur;
    }
    this.wAlive[slot] = 0;
    this.idToSlot.delete(this.wId[slot]);
    this.freeSlots.push(slot);
    this.liveWoody--;
  }

  speciesIndex(speciesId: string): number {
    const s = this.species.findIndex((sp) => sp.id === speciesId);
    if (s < 0) throw new RangeError(`unknown plant species ${speciesId}`);
    return s;
  }

  // ===============================================================================================
  // RESOLVE: plan the tick (staged only)
  // ===============================================================================================

  /**
   * Plans one tick from the committed state into staged buffers: herb growth and germination,
   * woody growth/ageing/reproduction/death, seed dispersal and seed-bank dynamics, and the edible
   * mass animals may eat this tick. `abioticAvailableQ` bounds the total photosynthetic uptake.
   */
  plan(tick: number, rng: SeededRng, abioticAvailableQ: number): void {
    this.stagedTick = tick;
    this.touched.length = 0;
    this.recruits.length = 0;
    for (const c of this.postCells) {
      this.postMark[c] = 0;
      this.cellGainQ[c] = 0;
      this.cellRespQ[c] = 0;
      this.cellTurnoverQ[c] = 0;
    }
    this.postCells.length = 0;
    for (const c of this.seedSourceCells) {
      this.seedSourceMark[c] = 0;
      this.seedSource.fill(0, c * this.speciesCount, (c + 1) * this.speciesCount);
    }
    this.seedSourceCells.length = 0;
    const st = (this.stats = VegetationSystem.emptyStats());
    let abiotic = abioticAvailableQ > 0 ? abioticAvailableQ : 0;
    const gainCap = (wantQ: number): number => {
      const g = wantQ < abiotic ? wantQ : abiotic;
      abiotic -= g;
      return g;
    };

    const n = this.cellCount;
    const H = this.herbCount;
    const S = this.speciesCount;

    // 1. Canopy of the committed woody plants: leaf area, heights, crown cover per cell
    this.cellLAI.fill(0);
    this.cellCover.fill(0);
    for (let slot = 0; slot < this.slotHigh; slot++) {
      if (this.wAlive[slot] === 0) continue;
      const cell = this.wCell[slot];
      this.cellLAI[cell] += this.sLA[slot];
      this.cellCover[cell] += this.sCrown[slot];
    }
    const herbMass = this.herbMass;
    for (let c = 0; c < n; c++) {
      let hm = 0;
      for (let h = 0; h < H; h++) hm += herbMass[c * H + h];
      this.cellHerbLAI[c] = (hm / Q) * SLA_HERB;
    }

    // 2. Herbs (every cell, every tick) and the seed bank (decay, germination)
    const herbNext = this.herbNext;
    const seedNext = this.seedNext;
    const seedBank = this.seedBank;
    let recruitBudget = this.maxRecruitsPerTick;
    const rotate = n > 0 ? (tick * 7919) % n : 0;
    for (let k = 0; k < n; k++) {
      const c = k + rotate < n ? k + rotate : k + rotate - n;
      const capQ = this.capacityQ(c);
      const groundLight = Math.exp(-K_EXT * this.cellLAI[c]);
      let herbTotal = 0;
      for (let h = 0; h < H; h++) herbTotal += herbMass[c * H + h];
      const space = capQ > 0 ? Math.max(0, 1 - herbTotal / capQ) : 0;
      let gain = 0;
      let resp = 0;
      let turn = 0;
      // cell environment, evaluated once per cell
      const water = this.isWaterCell(c);
      const temp = this.grid.temperature[c];
      const moist = this.effectiveMoisture(c);
      const tf = this.terrainFactor(c);
      for (let h = 0; h < H; h++) {
        const r = this.herbSpecies[h];
        const def = r.def;
        const idx = c * H + h;
        const B = herbMass[idx];
        const s = r.index;
        const sIdx0 = c * S + s;
        if (B === 0 && seedBank[sIdx0] === 0) {
          // nothing of this species here: nothing can change this tick
          herbNext[idx] = 0;
          seedNext[sIdx0] = 0;
          continue;
        }
        const site = siteFast(r, water, temp, moist, tf);
        const light = lightResponse(groundLight, def.shadeTolerance) * r.sunPenalty;
        let next = B;
        if (B > 0) {
          const grossWant = Math.floor(def.maxProductionRate * B * site * light * space);
          const gross = gainCap(grossWant > 0 ? grossWant : 0);
          let rs = Math.floor(def.leafRespirationRate * B);
          let lt = Math.floor(def.litterRate * B);
          if (site <= 0 && this.isLethalClimate(r, c, 0)) lt += Math.floor(0.08 * B);
          const seedQ = Math.floor(def.reproductiveAllocation * gross);
          if (seedQ > 0) {
            const seeds = seedQ / (def.seedMassMU * Q);
            this.addSeeds(s, c, seeds);
            st.seedsProduced += seeds;
          }
          next = B + gross - rs - lt - seedQ;
          if (next < HERB_MIN_Q) {
            // stand collapses: what is left becomes litter
            lt += next > 0 ? next : 0;
            next = 0;
            if (rs + lt > B + gross - seedQ) rs = B + gross - seedQ - lt;
          }
          gain += gross;
          resp += rs;
          turn += lt + seedQ;
        }
        // Germination from the seed bank into the stand (seedling biomass by photosynthesis)
        const sIdx = c * S + s;
        let seeds = seedBank[sIdx] * (1 - def.seedDecayRate);
        if (seeds > 1e-6 && site > 0 && space > 0) {
          const p = def.germinationRate * site * light * space;
          const germ = seeds * (p < 1 ? p : 1);
          const wantQ = Math.floor(germ * r.seedlingMassQ);
          const g = gainCap(wantQ);
          if (g > 0) {
            next += g;
            gain += g;
            seeds -= g / r.seedlingMassQ;
            st.herbGerminationQ += g;
            st.seedsGerminated += g / r.seedlingMassQ;
          }
        }
        seedNext[sIdx] = seeds > 1e-6 ? seeds : 0;
        herbNext[idx] = next;
      }
      // woody seed banks: decay and recruitment
      for (let s = 0; s < S; s++) {
        const r = this.rt[s];
        if (!r.woody) continue;
        const sIdx = c * S + s;
        if (seedBank[sIdx] === 0) {
          seedNext[sIdx] = 0;
          continue;
        }
        let seeds = seedBank[sIdx] * (1 - r.def.seedDecayRate);
        if (seeds > 1e-6 && recruitBudget > 0) {
          const site = siteFast(r, water, temp, moist, tf);
          if (site > 0) {
            // establishment needs free ground for a seedling and enough light at the ground: sun
            // plants cannot establish under a closed canopy, shade plants can
            const openCrown = this.cellCover[c] + MIN_FOOTPRINT <= 1 ? 1 - this.cellCover[c] : 0;
            const lightMin = r.germinationLightMin;
            const light = groundLight > lightMin ? lightResponse(groundLight, r.def.shadeTolerance) * ((groundLight - lightMin) / (1 - lightMin)) : 0;
            const herbCompetition = capQ > 0 ? 1 - 0.6 * Math.min(1, herbTotal / capQ) : 1;
            const p = r.def.germinationRate * site * light * openCrown * herbCompetition;
            const expected = seeds * p;
            if (expected > 0) {
              let nRec = Math.floor(expected);
              // Bernoulli draw from a deterministic hash of (tick, cell, species): no stream advance
              // per seed-bank cell, identical for identical seeds
              if (unitHash(tick, c, s) < expected - nRec) nRec++;
              if (nRec > 1) nRec = 1; // at most one establishment per species, cell and tick
              if (nRec > 0) {
                const g = gainCap(r.seedlingMassQ);
                if (g === r.seedlingMassQ) {
                  this.stageRecruit(s, c, g, rng);
                  gain += g;
                  seeds = Math.max(0, seeds - 1);
                  recruitBudget--;
                  st.recruits++;
                  st.seedsGerminated++;
                }
              }
            }
          }
        }
        seedNext[sIdx] = seeds > 1e-6 ? seeds : 0;
      }
      if (gain > 0 || resp > 0 || turn > 0) {
        this.cellGainQ[c] += gain;
        this.cellRespQ[c] += resp;
        this.cellTurnoverQ[c] += turn;
        this.markPost(c);
      }
    }

    // 3. Woody individuals due for an update this tick (staggered: every `interval` ticks each)
    const interval = this.woodyUpdateInterval;
    for (let cell = 0; cell < n; cell++) {
      const head = this.cellHead[cell];
      if (head === -1) continue;
      const effMoist = this.effectiveMoisture(cell);
      for (let slot = head; slot !== -1; slot = this.wNext[slot]) {
        const id = this.wId[slot];
        if ((id + tick) % interval !== 0) continue;
        this.updateWoody(slot, cell, tick, interval, effMoist, rng, gainCap);
      }
    }

    // 4. Seed dispersal of this tick's seed production into the (staged) seed bank
    for (const c of this.seedSourceCells) {
      const cy = (c / this.width) | 0;
      const cx = c - cy * this.width;
      for (let s = 0; s < S; s++) {
        const seeds = this.seedSource[c * S + s];
        if (!(seeds > 0)) continue;
        const r = this.rt[s];
        const offs = r.kernelOffsets;
        const wts = r.kernelWeights;
        const local = seeds * (1 - r.def.longDispersalFraction);
        for (let k = 0; k < wts.length; k++) {
          const x = cx + offs[2 * k];
          const y = cy + offs[2 * k + 1];
          if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
          const t = y * this.width + x;
          if (this.isWaterCell(t) !== r.aquatic) continue; // lost on unsuitable surface
          seedNext[t * S + s] += local * wts[k];
        }
        const far = seeds * r.def.longDispersalFraction;
        if (far > 0) {
          // long-distance landing cell from a deterministic hash of (tick, source cell, species)
          const R = Math.max(2, Math.round(4 * r.def.dispersalRadiusCells));
          const x = cx + Math.round((unitHash(tick, c, s + 101) * 2 - 1) * R);
          const y = cy + Math.round((unitHash(tick, c, s + 211) * 2 - 1) * R);
          if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
            const t = y * this.width + x;
            if (this.isWaterCell(t) === r.aquatic) seedNext[t * S + s] += far;
          }
        }
      }
    }

    // 5. Edible biomass after this tick's growth (herbs + reachable leaves of woody plants)
    const edible = this.edibleQ;
    for (let c = 0; c < n; c++) {
      let e = 0;
      for (let h = 0; h < H; h++) e += Math.floor(herbNext[c * H + h] * this.herbSpecies[h].def.edibleFraction);
      for (let slot = this.cellHead[c]; slot !== -1; slot = this.wNext[slot]) {
        e += this.reachableLeafQ(slot);
      }
      edible[c] = e;
    }
    for (const r of this.recruits) edible[r.cell] += Math.floor(r.massQ * this.rt[r.species].def.edibleFraction);

    for (const c of this.postCells) {
      st.grossProductionQ += this.cellGainQ[c];
      st.respirationQ += this.cellRespQ[c];
      st.turnoverQ += this.cellTurnoverQ[c];
    }
    this.planned = true;
  }

  private reachableLeafQ(slot: number): number {
    const staged = this.stamp[slot] === this.stagedTick;
    if (staged && this.tDeathCause[slot] >= 0) return 0;
    const r = this.rt[this.wSpecies[slot]];
    const m = staged ? this.tMass[slot] : this.wMass[slot];
    // committed geometry is cached; only plants changed this tick are re-measured
    const leaf = staged ? m * this.leafFraction(r, m) : this.sLeaf[slot];
    const h = staged ? this.heightOf(r, m) : this.sHeight[slot];
    const reach = h <= BROWSE_HEIGHT_M ? 1 : BROWSE_HEIGHT_M / h;
    // never browse below the seedling's own minimum: a plant cannot be eaten past its stem
    const maxTake = m - r.seedlingMassQ * 0.25;
    const e = Math.floor(leaf * reach * r.def.edibleFraction);
    return e < maxTake ? (e > 0 ? e : 0) : maxTake > 0 ? Math.floor(maxTake) : 0;
  }

  private updateWoody(
    slot: number, cell: number, tick: number, dt: number, effMoist: number, rng: SeededRng,
    gainCap: (q: number) => number
  ): void {
    const r = this.rt[this.wSpecies[slot]];
    const def = r.def;
    const m = this.wMass[slot];
    const vigor = this.gene(slot, G_VIGOR);
    const shadeAdj = this.gene(slot, G_SHADE);
    const droughtAdj = this.gene(slot, G_DROUGHT);
    const coldAdj = this.gene(slot, G_COLD);
    // light from taller neighbours in the same cell (Beer-Lambert on their leaf area)
    let laAbove = 0;
    const myH = this.sHeight[slot];
    const myId = this.wId[slot];
    for (let o = this.cellHead[cell]; o !== -1; o = this.wNext[o]) {
      if (o === slot) continue;
      const h = this.sHeight[o];
      if (h > myH || (h === myH && this.wId[o] < myId)) laAbove += this.sLA[o];
    }
    const light = Math.exp(-K_EXT * laAbove);
    const shadeTol = clamp01(def.shadeTolerance + shadeAdj);
    const gT = temperatureResponse(this.grid.temperature[cell], def.optimalTemperatureC - coldAdj, def.temperatureToleranceC);
    const gM = moistureResponse(effMoist, def.moistureMin - droughtAdj, def.moistureOpt - droughtAdj);
    const health = this.wHealth[slot];
    // trade-offs: vigour costs respiration, shade and drought adaptation cost maximal production,
    // a shifted thermal optimum is worse in the old climate
    const pmax = def.maxProductionRate * vigor * (1 - 0.3 * shadeTol) * (1 - 0.8 * Math.max(0, droughtAdj));
    const leaf = this.sLeaf[slot];
    let grossWant = Math.floor(pmax * leaf * lightResponse(light, shadeTol) * gT * gM * this.terrainFactor(cell) * Math.sqrt(health) * dt);
    const resp = Math.floor((def.leafRespirationRate * leaf + def.woodRespirationRate * (m - leaf)) * Math.sqrt(vigor) * dt);
    const litter = Math.floor(def.litterRate * leaf * dt);
    // cannot grow past the individual's maximal size
    const room = r.maxMassQ - m + resp + litter;
    if (grossWant > room) grossWant = room > 0 ? room : 0;
    const gross = gainCap(grossWant);
    const net = gross - resp - litter;
    const age = tick - this.wBirth[slot];
    const mature = age >= def.maturityAgeTicks && m >= def.maturityBiomassFraction * r.maxMassQ;
    let seedQ = 0;
    if (mature && net > 0) {
      seedQ = Math.floor(def.reproductiveAllocation * net);
      const seeds = seedQ / (def.seedMassMU * Q);
      this.addSeeds(r.index, cell, seeds);
      this.stats.seedsProduced += seeds;
    }
    let next = m + gross - resp - litter - seedQ;
    let respPost = resp;
    let turnPost = litter + seedQ;
    if (next < 0) {
      // respiration cannot exceed what the plant has: the deficit is a carbon-starvation death
      respPost = m + gross - litter - seedQ;
      if (respPost < 0) {
        turnPost = m + gross;
        respPost = 0;
      }
      next = 0;
    }
    // health: carbon balance and climate
    let hNew = health;
    const lethal = this.isLethalClimate(r, cell, coldAdj) || (gM <= 0 && effMoist < def.moistureMin - droughtAdj - 0.1);
    if (lethal) hNew -= 0.05 * dt;
    else if (net < 0) hNew -= 0.03 * dt * Math.min(1, -net / Math.max(1, leaf));
    else hNew += 0.02 * dt;
    if (hNew > 1) hNew = 1;
    // mortality hazard
    let hazard = def.backgroundMortality + (1 - (hNew > 0 ? hNew : 0)) * 0.01;
    if (age > def.senescenceAgeTicks) {
      const x = (age - def.senescenceAgeTicks) / Math.max(1, def.maxAgeTicks - def.senescenceAgeTicks);
      hazard += 0.006 * x * x;
    }
    const pDie = 1 - Math.pow(1 - Math.min(1, hazard), dt);
    let cause = -1;
    if (next <= r.seedlingMassQ * 0.25 || hNew <= 0) cause = lethal ? 2 : this.wHealth[slot] < 1 && this.lastBrowseHit(slot) ? 3 : 1;
    else if (age > def.maxAgeTicks * 1.4) cause = 0;
    else if (rng.nextFloat() < pDie) cause = age > def.senescenceAgeTicks ? 0 : lethal ? 2 : 4;

    this.touch(slot);
    if (cause >= 0) {
      // the whole plant returns to the soil as litter
      turnPost += next;
      next = 0;
      this.tDeathCause[slot] = cause;
    }
    this.tMass[slot] = next;
    this.tHealth[slot] = hNew > 0 ? hNew : 0;
    this.cellGainQ[cell] += gross;
    this.cellRespQ[cell] += respPost;
    this.cellTurnoverQ[cell] += turnPost;
    this.markPost(cell);
  }

  /** Damage memory: health below 1 caused by browsing marks a herbivory death (best effort). */
  private browseMark = new Uint8Array(0);
  private lastBrowseHit(slot: number): boolean {
    return slot < this.browseMark.length && this.browseMark[slot] === 1;
  }

  private stageRecruit(s: number, cell: number, massQ: number, rng: SeededRng): void {
    const r = this.rt[s];
    // Parentage: a mature conspecific within dispersal range (weighted by size and distance) is the
    // seed parent; the pollen parent is a mature conspecific near it (or the mother itself).
    const mother = this.pickParent(s, cell, r.def.dispersalRadiusCells * 2 + 1, -1, rng);
    let genMat: Float32Array;
    let genPat: Float32Array;
    let motherId = -1;
    let fatherId = -1;
    let generation = 0;
    if (mother >= 0) {
      const father = this.pickParent(s, this.wCell[mother], 3, mother, rng);
      const pSlot = father >= 0 ? father : mother;
      motherId = this.wId[mother];
      fatherId = this.wId[pSlot];
      generation = Math.max(this.wGeneration[mother], this.wGeneration[pSlot]) + 1;
      createHaploidGamete(this.genomeView(mother), PLANT_GENOME_SCHEMA, rng, this.gameteA);
      createHaploidGamete(this.genomeView(pSlot), PLANT_GENOME_SCHEMA, rng, this.gameteB);
      genMat = Float32Array.from(this.gameteA);
      genPat = Float32Array.from(this.gameteB);
      const g: DiploidGenome = { schemaId: PLANT_GENOME_SCHEMA.id, maternalAlleles: genMat, paternalAlleles: genPat, dominance: new Float32Array(PLANT_LOCI).fill(0.5) };
      mutateGenomeWithPlan(g, this.mutationPlan, rng);
    } else {
      // seed from the bank whose parents are gone: standing variation around the species norm
      const base = { ...PLANT_DEFAULT_TRAITS, ...(r.def.traitBaselines ?? {}) };
      const g = createIndividualGenome(PLANT_GENOME_SCHEMA, base, PLANT_TRAIT_RANGES, 0.15, rng);
      genMat = g.maternalAlleles;
      genPat = g.paternalAlleles;
    }
    this.recruits.push({ species: s, cell, massQ, mother: motherId, father: fatherId, generation, genMat, genPat });
  }

  private genomeView(slot: number): DiploidGenome {
    return {
      schemaId: PLANT_GENOME_SCHEMA.id,
      maternalAlleles: this.wGenMat.subarray(slot * PLANT_LOCI, (slot + 1) * PLANT_LOCI),
      paternalAlleles: this.wGenPat.subarray(slot * PLANT_LOCI, (slot + 1) * PLANT_LOCI),
      dominance: new Float32Array(PLANT_LOCI).fill(0.5),
    };
  }

  private pickParent(s: number, cell: number, radius: number, exclude: number, rng: SeededRng): number {
    const cy = (cell / this.width) | 0;
    const cx = cell - cy * this.width;
    const r = this.rt[s];
    let total = 0;
    const cand: number[] = [];
    const wts: number[] = [];
    for (let y = Math.max(0, cy - radius); y <= Math.min(this.height - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(this.width - 1, cx + radius); x++) {
        const c = y * this.width + x;
        for (let o = this.cellHead[c]; o !== -1; o = this.wNext[o]) {
          if (o === exclude || this.wSpecies[o] !== s) continue;
          const m = this.wMass[o];
          if (m < r.def.maturityBiomassFraction * r.maxMassQ) continue;
          const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
          const w = (m / Q) * Math.exp(-d / Math.max(0.5, r.def.dispersalRadiusCells));
          cand.push(o);
          wts.push(w);
          total += w;
        }
      }
    }
    if (total <= 0) return -1;
    let u = rng.nextFloat() * total;
    for (let i = 0; i < cand.length; i++) {
      u -= wts[i];
      if (u <= 0) return cand[i];
    }
    return cand[cand.length - 1];
  }

  // ===============================================================================================
  // PREPARE: ledger postings and grazing
  // ===============================================================================================

  /** Posts this tick's plant production, respiration and turnover (existing routes only). */
  stagePostings(tx: EnergyTransaction): void {
    if (!this.planned) return;
    for (const c of this.postCells) {
      const g = this.cellGainQ[c];
      if (g > 0) tx.postPhotosynthesisPairFast(PostingReason.PHOTOSYNTHESIS, AccountKind.CELL_PLANT, c, g, g * 3);
      const rs = this.cellRespQ[c];
      if (rs > 0) tx.postConsumePairFast(PostingReason.PLANT_RESPIRATION, AccountKind.CELL_PLANT, c, rs, rs * 3);
      const t = this.cellTurnoverQ[c];
      if (t > 0) tx.transferBiomass(PostingReason.PLANT_TURNOVER, AccountKind.CELL_PLANT, c, AccountKind.CELL_DETRITUS, c, t, t * 3);
    }
  }

  /**
   * Distributes what animals ate (edible mass at plan time minus `edibleRemainingQ`) over the
   * edible components of each cell in proportion to their edible mass: herbs lose standing
   * biomass, woody plants lose leaves and health. Staged only.
   */
  stageConsumption(edibleRemainingQ: Float64Array): void {
    if (!this.planned) return;
    const n = this.cellCount;
    const H = this.herbCount;
    if (this.browseMark.length < this.cap) this.browseMark = new Uint8Array(this.cap);
    let consumedTotal = 0;
    for (let c = 0; c < n; c++) {
      const eaten = this.edibleQ[c] - edibleRemainingQ[c];
      if (eaten <= 0) continue;
      consumedTotal += eaten;
      const total = this.edibleQ[c];
      let left = eaten;
      // herbs
      for (let h = 0; h < H && left > 0; h++) {
        const idx = c * H + h;
        const e = Math.floor(this.herbNext[idx] * this.herbSpecies[h].def.edibleFraction);
        if (e <= 0) continue;
        let take = Math.floor((eaten * e) / total);
        if (take > e) take = e;
        if (take > left) take = left;
        this.herbNext[idx] -= take;
        left -= take;
      }
      // woody leaves (committed and recruits of this tick are separate; recruits are tiny)
      for (let slot = this.cellHead[c]; slot !== -1 && left > 0; slot = this.wNext[slot]) {
        const e = this.reachableLeafQ(slot);
        if (e <= 0) continue;
        let take = Math.floor((eaten * e) / total);
        if (take > e) take = e;
        if (take > left) take = left;
        if (take <= 0) continue;
        this.touch(slot);
        const r = this.rt[this.wSpecies[slot]];
        const m = this.tMass[slot];
        const leaf = m * this.leafFraction(r, m);
        this.tMass[slot] = m - take;
        this.tHealth[slot] = Math.max(0, this.tHealth[slot] - 0.6 * (leaf > 0 ? take / leaf : 1));
        this.browseMark[slot] = 1;
        left -= take;
      }
      for (const rec of this.recruits) {
        if (left <= 0) break;
        if (rec.cell !== c) continue;
        const e = Math.floor(rec.massQ * this.rt[rec.species].def.edibleFraction);
        const take = Math.min(e, left);
        rec.massQ -= take;
        left -= take;
      }
      // rounding remainder: from whichever component still has edible mass (deterministic order)
      for (let h = 0; h < H && left > 0; h++) {
        const idx = c * H + h;
        const e = Math.floor(this.herbNext[idx] * this.herbSpecies[h].def.edibleFraction);
        const take = Math.min(e, left);
        this.herbNext[idx] -= take;
        left -= take;
      }
      for (let slot = this.cellHead[c]; slot !== -1 && left > 0; slot = this.wNext[slot]) {
        const e = this.reachableLeafQ(slot);
        const take = Math.min(e, left);
        if (take <= 0) continue;
        this.touch(slot);
        this.tMass[slot] -= take;
        left -= take;
      }
      if (left > 0) throw new Error(`vegetation: ${left} Q eaten beyond the edible mass of cell ${c}`);
    }
    this.stats.consumedQ = consumedTotal;
  }

  // ===============================================================================================
  // COMMIT / ABORT
  // ===============================================================================================

  commit(tick: number): void {
    if (!this.planned) return;
    const swapH = this.herbMass;
    this.herbMass = this.herbNext;
    this.herbNext = swapH;
    const swapS = this.seedBank;
    this.seedBank = this.seedNext;
    this.seedNext = swapS;
    let deaths = 0;
    for (const slot of this.touched) {
      const cause = this.tDeathCause[slot];
      this.wMass[slot] = this.tMass[slot];
      this.wHealth[slot] = this.tHealth[slot];
      if (this.tMass[slot] > this.wPeak[slot]) this.wPeak[slot] = this.tMass[slot];
      if (cause < 0) this.refreshGeometry(slot);
      if (cause >= 0) {
        const causeName = DEATH_CAUSES[cause];
        this.totals.deaths++;
        this.totals.deathsByCause[causeName]++;
        deaths++;
        if (this.maxDeathRecords > 0) {
          const rec: PlantDeathRecord = {
            id: this.wId[slot],
            speciesId: this.species[this.wSpecies[slot]].id,
            cellIndex: this.wCell[slot],
            birthTick: this.wBirth[slot],
            deathTick: tick,
            cause: causeName,
            peakBiomassMU: this.wPeak[slot] / Q,
            generation: this.wGeneration[slot],
          };
          if (this.deathLog.length < this.maxDeathRecords) this.deathLog.push(rec);
          else {
            this.deathLog[this.deathLogStart] = rec;
            this.deathLogStart = (this.deathLogStart + 1) % this.maxDeathRecords;
          }
        }
        this.removeWoody(slot);
      }
      this.stamp[slot] = -1;
      if (slot < this.browseMark.length && cause < 0 && this.tHealth[slot] >= 1) this.browseMark[slot] = 0;
    }
    for (const rec of this.recruits) {
      this.insertWoody(rec.species, rec.cell, rec.massQ, tick, rec.mother, rec.father, rec.generation, rec.genMat, rec.genPat);
    }
    this.stats.woodyDeaths = deaths;
    this.totals.grossProductionQ += this.stats.grossProductionQ;
    this.totals.consumedQ += this.stats.consumedQ;
    this.lastTickStats = this.stats;
    this.endTick();
  }

  /** Drops staged state (ABORT or end of tick). */
  endTick(): void {
    for (const slot of this.touched) this.stamp[slot] = -1;
    this.touched.length = 0;
    this.recruits.length = 0;
    this.planned = false;
    this.stagedTick = -1;
  }

  // ===============================================================================================
  // Queries (read-only)
  // ===============================================================================================

  get livingWoodyCount(): number {
    return this.liveWoody;
  }

  /** Plant mass of a cell according to the partition (must equal the ledger's CELL_PLANT mass). */
  cellPlantMassQ(cell: number): number {
    let m = 0;
    for (let h = 0; h < this.herbCount; h++) m += this.herbMass[cell * this.herbCount + h];
    for (let slot = this.cellHead[cell]; slot !== -1; slot = this.wNext[slot]) m += this.wMass[slot];
    return m;
  }

  /** Exact partition check against the ledger pools; returns the first mismatching cell or -1. */
  audit(plantMassOfCell: (cell: number) => number): number {
    for (let c = 0; c < this.cellCount; c++) {
      if (this.cellPlantMassQ(c) !== plantMassOfCell(c)) return c;
    }
    return -1;
  }

  getPlant(id: number): PlantSnapshot | undefined {
    const slot = this.idToSlot.get(id);
    if (slot === undefined) return undefined;
    return this.snapshotSlot(slot, -1);
  }

  getPlants(speciesId?: string, tick = -1): PlantSnapshot[] {
    const s = speciesId === undefined ? -1 : this.speciesIndex(speciesId);
    const out: PlantSnapshot[] = [];
    for (let slot = 0; slot < this.slotHigh; slot++) {
      if (this.wAlive[slot] === 0) continue;
      if (s >= 0 && this.wSpecies[slot] !== s) continue;
      out.push(this.snapshotSlot(slot, tick));
    }
    return out.sort((a, b) => a.id - b.id);
  }

  /** Living woody plant ids (ascending). */
  livingPlantIds(): number[] {
    return [...this.idToSlot.keys()].sort((a, b) => a - b);
  }

  /** Recorded deaths, oldest first. */
  getDeathRecords(): readonly PlantDeathRecord[] {
    if (this.deathLogStart === 0) return this.deathLog.slice();
    return [...this.deathLog.slice(this.deathLogStart), ...this.deathLog.slice(0, this.deathLogStart)];
  }

  private currentTickHint = 0;
  setTickHint(tick: number): void {
    this.currentTickHint = tick;
  }

  private snapshotSlot(slot: number, tick: number): PlantSnapshot {
    const r = this.rt[this.wSpecies[slot]];
    const m = this.wMass[slot];
    const t = tick >= 0 ? tick : this.currentTickHint;
    const age = t - this.wBirth[slot];
    const def = r.def;
    let stage = STAGE_SEEDLING;
    if (age > def.senescenceAgeTicks) stage = STAGE_SENESCENT;
    else if (age >= def.maturityAgeTicks && m >= def.maturityBiomassFraction * r.maxMassQ) stage = STAGE_MATURE;
    else if (m > r.seedlingMassQ * 4) stage = STAGE_JUVENILE;
    const traits: Record<string, number> = {};
    for (let l = 0; l < PLANT_LOCI; l++) traits[PLANT_GENE_DEFINITIONS[l].id] = this.gene(slot, l);
    const cell = this.wCell[slot];
    return Object.freeze({
      id: this.wId[slot],
      speciesId: def.id,
      x: cell % this.width,
      y: (cell / this.width) | 0,
      cellIndex: cell,
      birthTick: this.wBirth[slot],
      ageTicks: age,
      stage: STAGE_NAMES[stage],
      biomassMU: m / Q,
      leafMassMU: (m * this.leafFraction(r, m)) / Q,
      heightM: this.heightOf(r, m),
      crownArea: this.crownOf(r, m),
      health: this.wHealth[slot],
      peakBiomassMU: this.wPeak[slot] / Q,
      motherId: this.wMother[slot] >= 0 ? this.wMother[slot] : null,
      fatherId: this.wFather[slot] >= 0 ? this.wFather[slot] : null,
      generation: this.wGeneration[slot],
      traits: Object.freeze(traits),
    });
  }

  getCell(cell: number): VegetationCellSummary {
    const H = this.herbCount;
    const S = this.speciesCount;
    const herb: Record<string, number> = {};
    for (let h = 0; h < H; h++) herb[this.herbSpecies[h].def.id] = this.herbMass[cell * H + h] / Q;
    const seeds: Record<string, number> = {};
    for (let s = 0; s < S; s++) seeds[this.species[s].id] = this.seedBank[cell * S + s];
    const ids: number[] = [];
    let wm = 0;
    let lai = 0;
    let cover = 0;
    for (let slot = this.cellHead[cell]; slot !== -1; slot = this.wNext[slot]) {
      const r = this.rt[this.wSpecies[slot]];
      const m = this.wMass[slot];
      ids.push(this.wId[slot]);
      wm += m;
      lai += ((m * this.leafFraction(r, m)) / Q) * SLA_WOODY;
      cover += this.crownOf(r, m);
    }
    ids.sort((a, b) => a - b);
    return Object.freeze({
      cellIndex: cell,
      herbMassMU: Object.freeze(herb),
      woodyIds: Object.freeze(ids),
      woodyMassMU: wm / Q,
      seedBank: Object.freeze(seeds),
      canopyLeafAreaIndex: lai,
      crownCover: cover,
      groundLight: Math.exp(-K_EXT * lai),
      totalPlantMassQ: this.cellPlantMassQ(cell),
    });
  }

  /** Totals per species: herb biomass (MU), woody count and biomass (MU), seed bank (seeds). */
  speciesTotals(): Record<string, { herbMassMU: number; woodyCount: number; woodyMassMU: number; seeds: number }> {
    const out: Record<string, { herbMassMU: number; woodyCount: number; woodyMassMU: number; seeds: number }> = {};
    for (const sp of this.species) out[sp.id] = { herbMassMU: 0, woodyCount: 0, woodyMassMU: 0, seeds: 0 };
    const H = this.herbCount;
    const S = this.speciesCount;
    for (let c = 0; c < this.cellCount; c++) {
      for (let h = 0; h < H; h++) out[this.herbSpecies[h].def.id].herbMassMU += this.herbMass[c * H + h] / Q;
      for (let s = 0; s < S; s++) out[this.species[s].id].seeds += this.seedBank[c * S + s];
    }
    for (let slot = 0; slot < this.slotHigh; slot++) {
      if (this.wAlive[slot] === 0) continue;
      const o = out[this.species[this.wSpecies[slot]].id];
      o.woodyCount++;
      o.woodyMassMU += this.wMass[slot] / Q;
    }
    return out;
  }

  /** Deterministic digest input of the whole committed plant state. */
  digest(): string {
    const parts: string[] = [`n${this.nextPlantId}`];
    let hs = 0;
    for (let i = 0; i < this.herbMass.length; i++) hs = (hs * 31 + this.herbMass[i]) % 1_000_000_007;
    let ss = 0;
    for (let i = 0; i < this.seedBank.length; i++) ss = (ss * 31 + Math.round(this.seedBank[i] * 1e4)) % 1_000_000_007;
    parts.push(`h${hs}`, `s${ss}`);
    for (const id of this.livingPlantIds()) {
      const slot = this.idToSlot.get(id)!;
      parts.push(`${id}:${this.wSpecies[slot]}:${this.wCell[slot]}:${this.wMass[slot]}:${this.wHealth[slot]}:${this.wBirth[slot]}`);
    }
    return parts.join('|');
  }

  /** Approximate heap bytes of the vegetation state. */
  estimateStateBytes(): number {
    return (
      this.herbMass.byteLength * 2 + this.seedBank.byteLength * 2 + this.cap * (8 * 8 + 4 * 6 + 2 + PLANT_LOCI * 8) +
      this.cellCount * (8 * 8 + 4 + 2) + this.idToSlot.size * 40
    );
  }
}

export function validatePlantSpecies(sp: PlantSpeciesDefinition): void {
  const nonNeg: (keyof PlantSpeciesDefinition)[] = [
    'temperatureToleranceC', 'maxProductionRate', 'leafRespirationRate', 'woodRespirationRate', 'litterRate', 'maxBiomassMU',
    'maxHeightM', 'crownAreaMax', 'maturityAgeTicks', 'senescenceAgeTicks', 'maxAgeTicks', 'backgroundMortality',
    'reproductiveAllocation', 'seedMassMU', 'dispersalRadiusCells', 'longDispersalFraction', 'seedDecayRate',
    'germinationRate', 'seedlingMassMU', 'edibleFraction',
  ];
  for (const k of nonNeg) {
    const v = sp[k] as number;
    if (!Number.isFinite(v) || v < 0) throw new RangeError(`plant species ${sp.id}: ${String(k)} must be finite and >= 0`);
  }
  if (!(sp.temperatureToleranceC > 0)) throw new RangeError(`plant species ${sp.id}: temperatureToleranceC must be > 0`);
  if (!(sp.seedMassMU > 0) || !(sp.seedlingMassMU > 0)) throw new RangeError(`plant species ${sp.id}: seed and seedling mass must be > 0`);
  for (const k of ['shadeTolerance', 'reproductiveAllocation', 'longDispersalFraction', 'seedDecayRate', 'germinationRate', 'edibleFraction', 'leafFractionYoung', 'leafFractionMature', 'maturityBiomassFraction'] as const) {
    const v = sp[k];
    if (!(v >= 0 && v <= 1)) throw new RangeError(`plant species ${sp.id}: ${k} must be in [0, 1]`);
  }
  const woody = sp.form === 'shrub' || sp.form === 'tree';
  if (woody && (!(sp.maxBiomassMU > 0) || !(sp.maxHeightM > 0))) throw new RangeError(`plant species ${sp.id}: woody plants need size`);
}
