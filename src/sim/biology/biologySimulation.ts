import { safeAdd } from '../detMath';
import { AccountKind, PostingReason } from '../energyAccounts';
import { EnergyLedger, EnergyLedgerAudit } from '../energyLedger';
import { EnergyTransaction } from '../energyTransaction';
import { RngStreams, SeedInput, SeededRng } from '../prng';
import { EntityEnergyStore } from '../stagedStore';
import {
  EnergyQ,
  MassQ,
  PPM,
  RHO_DETRITUS,
  RHO_PLANT,
  RHO_RESERVE,
  RHO_STRUCT,
  applyPpm,
  energyOfMass,
  euToQ,
  euToQFloorFast,
  euToQHalfEvenFast,
  fractionToPpm,
  fractionToPpmFloorFast,
  fractionToPpmHalfEvenFast,
  massForEnergy,
  muToQ,
  qToMU,
  resolveContention,
  scaleByRatio,
} from '../units';
import { EnergyPool, EnergyPoolId, WorldEnergyGrid, WorldEnergyReadView } from '../worldEnergyGrid';
import { TerrainType, WorldBiomeId, WorldGrid } from '../worldGrid';
import {
  DeterministicPreyFoodProvider,
  FoodEnvironmentContext,
  FoodProvider,
} from './foodProvider';
import {
  DiploidGenome,
  GenomeSchema,
  PhenotypeProfile,
  TraitId,
  computePhenotype,
  createHaploidGamete,
} from './genome';
import {
  PhysiologyLocusIndices,
  getPhysiologyIndices,
  processOrganismDeath,
} from './lifecycle';
import {
  CompiledMutationPlan,
  MutationConfig,
  MutationRecord,
  compileMutationPlan,
  mutateGenomeWithPlan,
  mutateGenomeWithPlanCount,
  validateMutationConfig,
} from './mutation';
import {
  DeathCause,
  LifeStage,
  Organism,
  OrganismDeathEvent,
  OrganismDeathListener,
  Sex,
  computeDevelopmentalScale,
  createFounderOrganism,
  createOrganism,
  refreshOrganismPhenotype,
} from './organism';
import {
  AnatomyPerformance,
  computeAnatomyPerformanceInto,
  computeRelativeAnatomyPerformanceInto,
  createAnatomyPerformance,
  getRelativeAnatomyPhysiology,
  getSpeciesBaselineAnatomy,
  inheritOrganismAnatomy,
} from './anatomy';
import {
  ReproductiveCompatibilityResult,
  areSpeciesCladeCompatible,
  computeSexualAttractiveness,
  evaluateReproductiveCompatibility,
} from './evolution';
import { PhylogenyTracker } from './phylogeny';
import {
  EvolutionConfig,
  ResolvedEvolutionConfig,
  SpeciationEngine,
  StagedClusterTrackerUpdate,
  StagedSpeciationProposal,
  resolveEvolutionConfig,
} from './speciation';
import { PopulationManager, PopulationStats, validateDeathCauseStrict } from './population';
import {
  SpeciesDefinition,
  SpeciesRegistry,
  createDefaultSpeciesRegistry,
  validateSpeciesDefinition,
} from './species';
import {
  GeneticProfileOptions,
  PopulationGeneticProfile,
  SubpopulationGeneticAnalysis,
  SubpopulationGeneticOptions,
  computeGeneticProfile,
  computeSubpopulationGeneticAnalysis,
} from './geneticDiversity';
import {
  OrganismSpatialState,
  SpatialBehaviorConfig,
  SpatialBehaviorSystem,
  SpatialTickView,
  Subpopulation,
  computeSubpopulations,
} from './spatialBehavior';
import {
  CompetitiveConsumerRequest,
  NonConservingFoodProviderError,
  TransactionalFoodSource,
  assertPhysicallyClosedFoodProvider,
  stageCompetitiveTransactionalForaging,
} from './transactionalFoodSource';
import {
  CachedProfileQuanta,
  MutableFeedingPlanOut,
  MutableReproductionProvisioningOut,
  MutableReserveMetabolismOut,
  computeFeedingPlanFast,
  computeMaxReserveMassQ,
  computeProfileQuanta,
  computeTargetStructMassQ,
  computeTotalMetabolicDemandFast,
  stageCarrionDecomposition,
  stageCarrionDecompositionFast,
  stageCarrionScavenge,
  stageCarrionScavengeFast,
  stageDeathToCarrion,
  stageDeathToCarrionFast,
  stageDetritusDecomposition,
  stageDetritusDecompositionFast,
  stageFeeding,
  stageFeedingFast,
  stageMetabolism,
  stageMetabolismFast,
  stagePreyPredation,
  stagePreyPredationFast,
  stageReproductionProvisioning,
  stageReproductionProvisioningFast,
  stageSomaticGrowth,
  stageSomaticGrowthFast,
} from './trophicNutrition';
import {
  NormalizedDietWeightsPpm,
  TrophicProfile,
  dietWeightsToPpm,
} from './trophicProfile';

const LOCAL_MAX_SAFE_INT = Number.MAX_SAFE_INTEGER;
const LOCAL_PPM = PPM;
const PLANT_SAFE_MASS_LIMIT = 3_002_399_751_580_330; // floor(MAX_SAFE_INT / 3)
const RESERVE_SAFE_MASS_LIMIT = 300_239_975_158_033; // floor(MAX_SAFE_INT / 30)

// Local bindings for cross-module functions/constants to avoid CJS exports getter dispatch in hot loops
const _safeAdd = safeAdd;
const _energyOfMass = energyOfMass;
const _euToQFloorFast = euToQFloorFast;
const _euToQHalfEvenFast = euToQHalfEvenFast;
const _fractionToPpmFloorFast = fractionToPpmFloorFast;
const _fractionToPpmHalfEvenFast = fractionToPpmHalfEvenFast;
const _qToMU = qToMU;
const _resolveContention = resolveContention;
const _scaleByRatio = scaleByRatio;
const _RHO_PLANT = RHO_PLANT;
const _RHO_DETRITUS = RHO_DETRITUS;
const _RHO_RESERVE = RHO_RESERVE;
const _computePhenotype = computePhenotype;
const _createHaploidGamete = createHaploidGamete;
const _mutateGenomeWithPlan = mutateGenomeWithPlan;
const _mutateGenomeWithPlanCount = mutateGenomeWithPlanCount;
const _processOrganismDeath = processOrganismDeath;
const _computeTotalMetabolicDemandFast = computeTotalMetabolicDemandFast;
const _computeFeedingPlanFast = computeFeedingPlanFast;
const _stageFeedingFast = stageFeedingFast;
const _stageCarrionScavengeFast = stageCarrionScavengeFast;
const _stagePreyPredationFast = stagePreyPredationFast;
const _stageSomaticGrowthFast = stageSomaticGrowthFast;
const _stageReproductionProvisioningFast = stageReproductionProvisioningFast;
const _stageDeathToCarrionFast = stageDeathToCarrionFast;
const _stageCarrionDecompositionFast = stageCarrionDecompositionFast;
const _stageDetritusDecompositionFast = stageDetritusDecompositionFast;
const _stageMetabolismFast = stageMetabolismFast;

const AK_ABIOTIC = AccountKind.ABIOTIC;
const AK_SUN = AccountKind.SUN;
const AK_HEAT = AccountKind.HEAT;
const AK_CELL_PLANT = AccountKind.CELL_PLANT;
const AK_CELL_CARRION = AccountKind.CELL_CARRION;
const AK_CELL_DETRITUS = AccountKind.CELL_DETRITUS;
const AK_ORGANISM_STRUCT = AccountKind.ORGANISM_STRUCT;
const AK_ORGANISM_RESERVE = AccountKind.ORGANISM_RESERVE;

const PR_PHOTOSYNTHESIS = PostingReason.PHOTOSYNTHESIS;
const PR_METABOLISM = PostingReason.METABOLISM;

function expressTraitF32(
  gMat: Float32Array,
  gPat: Float32Array,
  gDom: Float32Array,
  modKinds: Uint8Array,
  idx: number,
  modPhys: number,
  modNeur: number,
  modOther: number
): number {
  const a = gMat[idx];
  const b = gPat[idx];
  const low = a <= b ? a : b;
  const high = a <= b ? b : a;
  const genVal = low + (high - low) * gDom[idx];
  const k = modKinds[idx];
  const mod = k === 0 ? modPhys : k === 1 ? modNeur : modOther;
  return Math.fround(genVal * mod);
}

const POOL_PLANT = EnergyPool.PLANT;
const POOL_CARRION = EnergyPool.CARRION;
const POOL_DETRITUS = EnergyPool.DETRITUS;

const STAGE_EGG = 0;
const STAGE_JUVENILE = 1;
const STAGE_ADULT = 2;
const STAGE_ELDER = 3;
const STAGE_NAMES: readonly LifeStage[] = ['egg', 'juvenile', 'adult', 'elder'];

const FLAG_FEMALE = 1 << 0;
const FLAG_HEALED = 1 << 1;
const FLAG_DIED = 1 << 2;
const FLAG_TOUCHED_PRED = 1 << 3;
const FLAG_ELIGIBLE = 1 << 4;

// Exact MOORE_OFFSETS order from worldGrid.ts for chooseNestCell RNG parity
const MOORE_DX = new Int8Array([0, 1, 1, 1, 0, -1, -1, -1]);
const MOORE_DY = new Int8Array([-1, -1, 0, 1, 1, 1, 0, -1]);

export const DEFAULT_MAX_HISTORY_ENTRIES = 1000;
export const DEFAULT_MAX_DEATH_EVENT_HISTORY = 1000;

const LEGACY_FOOD_ESCROW_SLOT = 0;
const EXTERNAL_PLANT_ESCROW_SLOT = 1;
const EXTERNAL_PREY_ESCROW_SLOT = 2;
const EXTERNAL_CARRION_ESCROW_SLOT = 3;
const EXTERNAL_DETRITUS_ESCROW_SLOT = 4;

export type BiologyConservationMode = 'strict' | 'legacy-external-escrow';

export type BiologyStepPhase =
  | 'GATHER'
  | 'RESOLVE'
  | 'PRE_ALLOCATE'
  | 'PREPARE'
  | 'COMMIT'
  | 'POST_COMMIT';

export interface BiologyPhaseHookContext {
  readonly tick: number;
  readonly phase: BiologyStepPhase;
  readonly tx?: EnergyTransaction;
}

export interface BiologySimulationConfig {
  readonly grid: WorldGrid;
  readonly seed?: SeedInput;
  readonly foodProvider?: FoodProvider;
  readonly speciesRegistry?: SpeciesRegistry;
  /** Enforce strict closed physical conservation (defaults to true unless an unclosed legacy FoodProvider is supplied explicitly). */
  readonly strictConservation?: boolean;
  /** Optional initial abiotic matter pool size in MU (defaults to proportional finite world pool). */
  readonly initialAbioticMassMU?: number;
  /** Optional external/pre-built WorldEnergyGrid. */
  readonly worldEnergyGrid?: WorldEnergyGrid;
  /** Optional external/pre-built EntityEnergyStore. */
  readonly entityStore?: EntityEnergyStore;
  /** Optional external/pre-built EnergyLedger (must enable strictStoichiometry in strict mode). */
  readonly energyLedger?: EnergyLedger;
  /** Optional override for first organism entity slot offset (defaults after background prey slots). */
  readonly organismSlotOffset?: number;
  /** Optional external transactional food sources per pool kind (checked for physical closure). */
  readonly transactionalFoodSources?: {
    readonly plant?: TransactionalFoodSource;
    readonly prey?: TransactionalFoodSource;
    readonly carrion?: TransactionalFoodSource;
    readonly detritus?: TransactionalFoodSource;
  };
  /**
   * Capacity scale of the built-in conservative background prey pool (default: 3.5).
   * `0` removes background prey entirely, so prey-eating species depend on live prey and carrion.
   * Only applies when the simulation creates its own strict-mode prey provider.
   */
  readonly backgroundPreyCapacityScale?: number;
  /** Per-tick photosynthetic replenishment rate of cell plant deficit in [0, 1] (default: 0.28). */
  readonly plantPhotosynthesisRate?: number;
  /** Carrying capacity scale for primary plant production (default: 1.0). */
  readonly plantCarryingCapacityScale?: number;
  /** Per-tick fractional decay of cell carrion into ABIOTIC + HEAT in [0, 1] (default: 0.15). */
  readonly carrionDecompositionRate?: number;
  /** Per-tick fractional decay of cell detritus into ABIOTIC + HEAT in [0, 1] (default: 0.08). */
  readonly detritusDecompositionRate?: number;
  /** Optional lifecycle phase hook for fault-injection testing and observability. */
  readonly onPhase?: (context: BiologyPhaseHookContext) => void;
  /** Keep a bounded history of per-tick PopulationStats snapshots (default: true) */
  readonly recordHistory?: boolean;
  /** Maximum number of PopulationStats snapshots retained in history (default: 1000; 0 disables retention) */
  readonly maxHistoryEntries?: number;
  /** Interval in ticks between statistics computation and history snapshots (default: 1) */
  readonly statsInterval?: number;
  /** Maximum number of recent OrganismDeathEvent entries retained internally (default: 1000; 0 disables retention) */
  readonly maxDeathEventHistory?: number;
  /** Maximum number of recent onDeath listener error records retained internally (default: 1000; 0 disables retention) */
  readonly maxDeathListenerErrors?: number;
  /** Optional diagnostic callback invoked whenever an `onDeath` listener throws */
  readonly onDeathListenerError?: (record: DeathListenerError) => void;
  /** Record individual mutation events during reproduction (default: false for speed, enable for inspection) */
  readonly trackMutationEvents?: boolean;
  /** Optional override for species mutation configuration */
  readonly mutationConfigOverride?: MutationConfig;
  /** Optional wrapX for local egg nesting neighbor search (default: false) */
  readonly wrapX?: boolean;
  /**
   * Enables autonomous spatial behavior (perception, movement, pursuit, flight, hydration and
   * migration) inside the atomic tick. `true` uses defaults. Requires strict conservation, the
   * built-in grid pools and the finite map (`wrapX` must stay false). Default: disabled, which
   * keeps every pre-existing code path bit-identical.
   */
  readonly spatial?: SpatialBehaviorConfig | boolean;
  /**
   * Enables evolution inside the atomic tick (`true` = defaults, see `EvolutionConfig`):
   *   - heritable anatomy acts on physiology (thermal tolerance, metabolic upkeep), relative to
   *     the species baseline anatomy;
   *   - mates are accepted through the reproductive compatibility model (assortative mate
   *     recognition, zygote viability, hybrid fertility; optional sister-species hybridization);
   *   - isolated, diverged, reproductively isolated subpopulations found new species;
   *   - a phylogeny of lineages, speciations, hybridizations and extinctions is kept.
   * Default: disabled. Anatomy inheritance and mutation run in every mode.
   */
  readonly evolution?: EvolutionConfig | boolean;
}

export interface EvolutionTickStats {
  /** Committed ticks with evolution enabled. */
  ticks: number;
  /** Mate candidates evaluated with the compatibility model. */
  mateEvaluations: number;
  /** Candidates refused by mate recognition (pre-zygotic). */
  mateRejections: number;
  /** Zygotes formed that were not viable (post-zygotic; die as eggs). */
  inviableZygotes: number;
  /** Offspring of matings between different species. */
  hybridOffspring: number;
  /** Committed speciation events. */
  speciations: number;
  /** Speciation checks performed. */
  speciationChecks: number;
}

interface StagedSpeciation {
  readonly proposal: StagedSpeciationProposal;
  readonly population: PopulationManager;
  readonly memberIds: Set<number>;
}

/** Upper bound of mate candidates a female evaluates per breeding attempt (evolution mode). */
const MAX_MATE_CANDIDATES = 6;
/** Upper bound of organisms inspected while looking for candidates (evolution mode). */
const MAX_MATE_SCAN = 48;

/**
 * Evolutionary physiology: activity-demand units charged per trait unit of sensory (perception)
 * and oxidative (endurance) capacity above the species norm - the coefficient the existing model
 * already uses for neural tissue (intelligence).
 */
const TISSUE_UPKEEP_PER_TRAIT_UNIT = 0.1;

/** Structural allocation fraction scaled by the growth capacity of the metabolism (ppm, <= 1e6). */
function scaledAllocPpm(allocPpm: number, growthScale: number): number {
  if (growthScale === 1) return allocPpm;
  const v = Math.round(allocPpm * growthScale);
  return v < 0 ? 0 : v > 1_000_000 ? 1_000_000 : v;
}

export interface SpawnFounderOptions {
  readonly stage?: Exclude<LifeStage, 'dead'>;
  readonly center?: { readonly x: number; readonly y: number; readonly radius?: number };
  readonly filterCell?: (x: number, y: number, terrain: TerrainType, biome: WorldBiomeId) => boolean;
}

export interface SpawnManualOrganismOptions {
  readonly speciesId: string;
  readonly x: number;
  readonly y: number;
  readonly sex: Sex;
  readonly genome: DiploidGenome;
  readonly stage?: Exclude<LifeStage, 'dead'>;
  readonly ageTicks?: number;
  readonly health?: number;
  readonly energy?: number;
  readonly generation?: number;
}

export interface BiologyTickSummary {
  readonly tick: number;
  readonly statsBySpecies: Readonly<Record<string, PopulationStats>>;
}

export interface TrackedMutationEvent {
  readonly tick: number;
  readonly speciesId: string;
  readonly organismId: number;
  readonly records: readonly MutationRecord[];
}

export interface DeathListenerError {
  readonly tick: number;
  readonly organismId: number;
  readonly speciesId: string;
  readonly cause: DeathCause;
  readonly listenerIndex: number;
  readonly error: unknown;
}

const BIOME_PLANT_CAPACITY_MU: Record<WorldBiomeId, number> = {
  ocean: 0,
  'coastal-wetland': 110,
  'tropical-forest': 150,
  'temperate-forest': 130,
  savanna: 120,
  shrubland: 80,
  desert: 18,
  tundra: 30,
  'alpine-rock': 10,
  'snow-cap': 4,
};

const DEFAULT_CONSERVATIVE_PREY_CAPACITY_SCALE = 3.5;

const MAX_ERROR_SNAPSHOT_DEPTH = 3;

/**
 * Builds an independent, frozen diagnostic snapshot of a thrown value without mutating
 * or freezing the original external Error/object reference.
 */
function createDiagnosticErrorSnapshot(
  value: unknown,
  depth = 0,
  seen?: WeakSet<object>
): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return value;
  }
  if (typeof value === 'function') {
    return `[Function${value.name ? `: ${value.name}` : ''}]`;
  }
  if (value instanceof Error) {
    let message = '';
    try {
      message = typeof value.message === 'string' ? value.message : String(value.message ?? '');
    } catch {
      message = '[Unreadable error message]';
    }
    const snapshot = new Error(message);
    try {
      snapshot.name = typeof value.name === 'string' ? value.name : 'Error';
    } catch {
      snapshot.name = 'Error';
    }
    snapshot.message = message;
    try {
      if (typeof value.stack === 'string') {
        snapshot.stack = value.stack;
      }
    } catch {
      // Ignore unreadable stack getters
    }

    const nextSeen = seen ?? new WeakSet<object>();
    if (!nextSeen.has(value)) {
      nextSeen.add(value);
      if (depth < MAX_ERROR_SNAPSHOT_DEPTH) {
        try {
          if ('cause' in value && value.cause !== undefined) {
            Object.defineProperty(snapshot, 'cause', {
              value: createDiagnosticErrorSnapshot(value.cause, depth + 1, nextSeen),
              enumerable: false,
              writable: false,
              configurable: false,
            });
          }
        } catch {
          // Ignore unreadable cause getters
        }
        try {
          for (const key of Object.keys(value)) {
            if (key === 'name' || key === 'message' || key === 'stack' || key === 'cause') {
              continue;
            }
            const propVal = (value as unknown as Record<string, unknown>)[key];
            Object.defineProperty(snapshot, key, {
              value: createDiagnosticErrorSnapshot(propVal, depth + 1, nextSeen),
              enumerable: true,
              writable: false,
              configurable: false,
            });
          }
        } catch {
          // Ignore unreadable enumerable custom properties
        }
      }
    }
    return Object.freeze(snapshot);
  }

  if (depth >= MAX_ERROR_SNAPSHOT_DEPTH) {
    return Object.freeze({ summary: '[MaxDepth]' });
  }
  const nextSeen = seen ?? new WeakSet<object>();
  if (nextSeen.has(value)) {
    return '[Circular]';
  }
  nextSeen.add(value);

  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      try {
        items.push(createDiagnosticErrorSnapshot(value[i], depth + 1, nextSeen));
      } catch {
        items.push('[Unreadable]');
      }
    }
    return Object.freeze(items);
  }

  const copy: Record<string, unknown> = {};
  try {
    for (const key of Object.keys(value)) {
      try {
        const propVal = (value as Record<string, unknown>)[key];
        Object.defineProperty(copy, key, {
          value: createDiagnosticErrorSnapshot(propVal, depth + 1, nextSeen),
          enumerable: true,
          writable: false,
          configurable: false,
        });
      } catch {
        // Ignore throwing getters on arbitrary thrown objects
      }
    }
  } catch {
    return Object.freeze({ summary: '[Unreadable object]' });
  }
  return Object.freeze(copy);
}

interface SpeciesRuntimeCache {
  readonly species: SpeciesDefinition;
  readonly schema: GenomeSchema;
  readonly locusCount: number;
  readonly profile: TrophicProfile;
  readonly pq: CachedProfileQuanta;
  readonly dietPpm: NormalizedDietWeightsPpm;
  readonly effAbsorptionAssimPpm: number;
  readonly idx: PhysiologyLocusIndices;
  readonly baseStrength: number;
  readonly baseSpeed: number;
  readonly baseEndurance: number;
  readonly basePerception: number;
  readonly baseIntelligence: number;
  readonly baseHeatTolerance: number;
  readonly baseColdTolerance: number;
  readonly baseMetabolismEfficiency: number;
  readonly baseEnvironmentalAdaptability: number;
  readonly basalFactor: number;
  readonly thermoFactor: number;
  readonly activityFactor: number;
  readonly optTemp: number;
  readonly halfWidth: number;
  readonly thermalDamagePerTick: number;
  readonly starvationDamagePerTick: number;
  readonly healingPerTick: number;
  readonly maxForageIntakePerTick: number;
  readonly eggIncubationCostPerTick: number;
  readonly incubationTicks: number;
  readonly juvenileTicks: number;
  readonly maturityAge: number;
  readonly elderAgeTicks: number;
  readonly maxLifespanTicks: number;
  readonly hatchlingPhysicalScale: number;
  readonly tpy: number;
  readonly incubationBio: number;
  readonly maturityBio: number;
  readonly juvenileBioSpan: number;
  readonly elderBio: number;
  readonly minBioStep: number;
  readonly elderLifeFloor: number;
  readonly cooldownTicks: number;
  readonly elderCooldown: number;
  readonly minEnergyToReproduce: number;
  readonly minHealthToReproduce: number;
  readonly clutchSizeMin: number;
  readonly clutchSizeMax: number;
  readonly femaleProbability: number;
  readonly elderFertilityMultiplier: number;
  readonly eggStructMassQ: MassQ;
  readonly eggMaxReserveMassQ: MassQ;
  readonly eggReserveMassQ: MassQ;
  readonly eggActualInitNorm: number;
  readonly mutationPlan: CompiledMutationPlan;
  /** Effective mutation process of the species (also governs anatomy loci). */
  readonly mutationConfig: MutationConfig;
  /** Anatomy performance of the species baseline anatomy (reference for relative effects). */
  readonly anatomyBaselinePerf: AnatomyPerformance;
  readonly scratchPhenotype: PhenotypeProfile;
}

function stageToCode(stage: LifeStage): number {
  if (stage === 'egg') return STAGE_EGG;
  if (stage === 'juvenile') return STAGE_JUVENILE;
  if (stage === 'adult') return STAGE_ADULT;
  return STAGE_ELDER;
}

function applyPpmFloorFast(q: number, ppm: number): number {
  const p = q * ppm;
  return p <= LOCAL_MAX_SAFE_INT ? (p - (p % LOCAL_PPM)) / LOCAL_PPM : applyPpm(q, ppm, 'floor');
}

function massForPlantEnergyCeil(e: number): number {
  const r = e % 3;
  return r === 0 ? e / 3 : (e - r) / 3 + 1;
}

function massForReserveEnergyCeil(e: number): number {
  const r = e % 30;
  return r === 0 ? e / 30 : (e - r) / 30 + 1;
}

function massForCarrionEnergyCeil(e: number): number {
  const r = e % 15;
  return r === 0 ? e / 15 : (e - r) / 15 + 1;
}

function sortInt32IndicesByFloat64Key(
  indices: Int32Array,
  keys: Float64Array,
  left: number,
  right: number
): void {
  while (left < right) {
    if (right - left <= 16) {
      for (let i = left + 1; i <= right; i++) {
        const idx = indices[i];
        const key = keys[idx];
        let j = i - 1;
        while (j >= left && keys[indices[j]] > key) {
          indices[j + 1] = indices[j];
          j--;
        }
        indices[j + 1] = idx;
      }
      return;
    }
    const mid = (left + right) >>> 1;
    const pivot = keys[indices[mid]];
    let i = left;
    let j = right;
    while (i <= j) {
      while (keys[indices[i]] < pivot) i++;
      while (keys[indices[j]] > pivot) j--;
      if (i <= j) {
        const tmp = indices[i];
        indices[i] = indices[j];
        indices[j] = tmp;
        i++;
        j--;
      }
    }
    if (j - left < right - i) {
      if (left < j) sortInt32IndicesByFloat64Key(indices, keys, left, j);
      left = i;
    } else {
      if (i < right) sortInt32IndicesByFloat64Key(indices, keys, i, right);
      right = j;
    }
  }
}

function sortOrScanDirtyCells(
  dirtyCount: number,
  cellCount: number,
  cellHead: Int32Array,
  dirtyCells: Uint32Array
): void {
  if (dirtyCount <= 1) return;
  if (dirtyCount > (cellCount >>> 3)) {
    let idx = 0;
    for (let c = 0; c < cellCount; c++) {
      if (cellHead[c] !== -1) {
        dirtyCells[idx++] = c;
      }
    }
  } else {
    dirtyCells.subarray(0, dirtyCount).sort();
  }
}

function hasAnyExternalFoodSource(config: BiologySimulationConfig): boolean {
  const src = config.transactionalFoodSources;
  return Boolean(src && (src.plant || src.prey || src.carrion || src.detritus));
}

/**
 * Main deterministic coordinator for biological simulation (Phase 2.2.1b P3).
 *
 * Executes every tick on an atomic transactional pipeline:
 *   GATHER -> RESOLVE -> PREPARE -> COMMIT / ABORT -> POST_COMMIT
 *
 * Strictly read-only toward `WorldGrid` TypedArray buffers (reads environment via
 * `WorldGrid` accessors and never writes directly to `grid.*` arrays).
 */
export class BiologySimulation {
  public readonly grid: WorldGrid;
  public readonly foodProvider: FoodProvider;
  public readonly speciesRegistry: SpeciesRegistry;
  public readonly streams: RngStreams;
  public readonly energyGrid: WorldEnergyGrid;
  public readonly entityStore: EntityEnergyStore;
  public readonly ledger: EnergyLedger;
  public readonly energyView: WorldEnergyReadView;
  public readonly strictConservation: boolean;
  public readonly conservationMode: BiologyConservationMode;
  public readonly isPhysicallyClosed: boolean;

  private readonly externalPlantSource?: TransactionalFoodSource;
  private readonly externalPreySource?: TransactionalFoodSource;
  private readonly externalCarrionSource?: TransactionalFoodSource;
  private readonly externalDetritusSource?: TransactionalFoodSource;
  private readonly hasConservativePreyProvider: boolean;
  private readonly backgroundPreyCapacityScale: number;

  private readonly plantPhotosynthesisRatePpm: number;
  private readonly carrionDecompositionRatePpm: number;
  private readonly detritusDecompositionRatePpm: number;
  private readonly plantCapacityQ: Float64Array;
  private readonly landCellIndices: Uint32Array;
  private readonly onPhase?: (context: BiologyPhaseHookContext) => void;

  private readonly populations = new Map<string, PopulationManager>();
  private readonly history: BiologyTickSummary[] = [];
  private readonly deathEvents: OrganismDeathEvent[] = [];
  private deathEventHead = 0;
  private readonly deathListeners = new Set<OrganismDeathListener>();
  private readonly deathListenerErrors: DeathListenerError[] = [];
  private deathListenerErrorHead = 0;
  private totalDeathListenerErrors = 0;
  private readonly trackedMutations: TrackedMutationEvent[] = [];
  private readonly recordHistory: boolean;
  private readonly maxHistoryEntries: number;
  private readonly statsInterval: number;
  private readonly maxDeathEventHistory: number;
  private readonly maxDeathListenerErrors: number;
  private readonly onDeathListenerError?: (record: DeathListenerError) => void;
  private readonly trackMutationEvents: boolean;
  private readonly mutationConfigOverride?: MutationConfig;
  private readonly wrapX: boolean;
  /** Autonomous spatial behavior system, or `null` when spatial behavior is disabled. */
  public readonly spatial: SpatialBehaviorSystem | null;
  /** Resolved evolution settings, or `null` when evolution is disabled. */
  public readonly evolution: ResolvedEvolutionConfig | null;
  /** Lineage history (evolution mode); mutated only after COMMIT. */
  public readonly phylogeny: PhylogenyTracker | null;
  /** Cumulative evolution counters (evolution mode), updated only after COMMIT. */
  public readonly evolutionStats: EvolutionTickStats = {
    ticks: 0,
    mateEvaluations: 0,
    mateRejections: 0,
    inviableZygotes: 0,
    hybridOffspring: 0,
    speciations: 0,
    speciationChecks: 0,
  };
  private readonly speciationEngine: SpeciationEngine | null;
  private readonly anatomyPhysiology: boolean;
  /** Evolutionary physiology model (see `EvolutionConfig.enablePhysiologicalTradeOffs`). */
  private readonly physioTradeOffs: boolean;
  private readonly anatomyPerfScratch: AnatomyPerformance = createAnatomyPerformance();
  private cladeCompatMatrix = new Uint8Array(0);
  private readonly stagedProposals: StagedSpeciationProposal[] = [];
  private readonly stagedTrackerUpdates: StagedClusterTrackerUpdate[] = [];
  private readonly stagedSpeciations: StagedSpeciation[] = [];
  private stagedSpeciationCheck = false;
  private mateCompat: ReproductiveCompatibilityResult | null = null;
  private readonly mateCandidateScratch = new Int32Array(MAX_MATE_CANDIDATES + 2);
  private t_mateEvaluations = 0;
  private t_mateRejections = 0;
  private t_inviableZygotes = 0;
  private t_hybridOffspring = 0;
  private eggFatherSpeciesIdx = new Int32Array(64);
  private eggHybridViability = new Float32Array(64);
  private eggHybridFertility = new Float32Array(64);
  private eggHybridBackcross = new Uint8Array(64);
  private readonly spatialView: SpatialTickView | null;
  private spatialFallbackPlant: Float64Array | null = null;
  private spatialFallbackCarrion: Float64Array | null = null;
  private spatialFallbackDetritus: Float64Array | null = null;
  private spatialFallbackPreyStruct: Float64Array | null = null;
  private spatialFallbackPreyReserve: Float64Array | null = null;

  // Transactional entity slot management
  private readonly organismSlotBase: number;
  private nextFreshOrganismSlot: number;
  private readonly freeOrganismSlots: number[] = [];
  private readonly organismIdToSlot = new Map<number, number>();
  private slotCarryCreditQ: Float64Array;
  private slotMaxReserveMassQ: Float64Array;
  private slotLastSyncedEnergy: Float64Array;

  // Per-species runtime caches & reusable scratch phenotype buffers
  private readonly dietPpmCache = new Map<string, NormalizedDietWeightsPpm>();
  private readonly scratchPhenotypeBySchema = new Map<string, PhenotypeProfile>();
  private speciesCacheList: SpeciesRuntimeCache[] = [];
  private speciesPreyMatrix = new Uint8Array(0);
  private readonly useDirectEntityStore: boolean;
  private readonly useDirectEnergyGrid: boolean;

  private isStepping = false;
  private isPostCommit = false;
  private killDepth = 0;
  private readonly pendingCompactPops = new Set<PopulationManager>();

  private tickCount = 0;
  private nextId = 1;

  // Reusable environment & phenotype context objects to avoid per-organism allocations in hot loops
  private readonly reusableEnv: {
    cellIndex: number;
    x: number;
    y: number;
    terrain: TerrainType;
    biome: WorldBiomeId;
    temperature: number;
    moisture: number;
    tick: number;
  } = {
    cellIndex: 0,
    x: 0,
    y: 0,
    terrain: 'lowland',
    biome: 'savanna',
    temperature: 20,
    moisture: 0.5,
    tick: 0,
  };
  private readonly reusablePhenContext = {
    physicalMaturityScale: 1,
    neuralMaturityScale: 1,
    senescencePhysicalScale: 0,
    conditionScale: 1,
  };
  private readonly reusableExternalDelta = { massQ: 0, energyQ: 0 };
  private readonly reusableExternalProvider = () => this.reusableExternalDelta;
  private readonly feedScratch: MutableFeedingPlanOut = {
    depositMassQ: 0,
    depositEnergyQ: 0,
    egestaMassQ: 0,
    egestaEnergyQ: 0,
    abioticMassQ: 0,
    heatQ: 0,
  };
  private readonly metabScratch: MutableReserveMetabolismOut = {
    burnMassQ: 0,
    burnEnergyQ: 0,
    nextCarryCreditQ: 0,
    deficitQ: 0,
  };
  private readonly reproScratch: MutableReproductionProvisioningOut = {
    provisioned: false,
    childStructMassQ: 0,
    childStructEnergyQ: 0,
    childReserveMassQ: 0,
    childReserveEnergyQ: 0,
    burnReserveMassQ: 0,
    burnReserveEnergyQ: 0,
    abioticInMassQ: 0,
    abioticOutMassQ: 0,
    heatQ: 0,
  };

  // Resolve contention scratch
  private resolveScratchDemands = new Float64Array(64);
  private resolveScratchOrgIds = new Float64Array(64);
  private resolveScratchGrants = new Float64Array(64);
  private resolveScratchDraftIdx = new Int32Array(64);

  // SoA draft arrays (growable, reused across ticks, references cleared in finally)
  private draftCap = 0;
  private draftOrg: Organism[] = [];
  private draftPop: PopulationManager[] = [];
  private draftDeathCause: (DeathCause | null)[] = [];
  private draftSlot = new Int32Array(0);
  private draftCellIndex = new Uint32Array(0);
  private draftOrgId = new Float64Array(0);
  private draftSpeciesIdx = new Uint16Array(0);
  private draftNextAgeTicks = new Int32Array(0);
  private draftNextStage = new Uint8Array(0);
  private draftNextCooldown = new Int32Array(0);
  private draftFlags = new Uint8Array(0);
  private draftKillerId = new Float64Array(0);
  private draftOffspringDelta = new Uint32Array(0);
  private draftStructMassQ = new Float64Array(0);
  private draftReserveMassQ = new Float64Array(0);
  private draftMaxReserveMassQ = new Float64Array(0);
  private draftCarryCreditQ = new Float64Array(0);
  private draftExternalDeltaQ = new Float64Array(0);
  private draftMetabolicDemandQ = new Float64Array(0);
  private draftHealingDemandQ = new Float64Array(0);
  private draftBurnMassQ = new Float64Array(0);
  private draftPostMetabResQ = new Float64Array(0);
  private draftPostMetabCarryQ = new Float64Array(0);
  private draftReqPlantQ = new Float64Array(0);
  private draftReqPreyQ = new Float64Array(0);
  private draftReqCarrionQ = new Float64Array(0);
  private draftReqDetritusQ = new Float64Array(0);
  private draftReqLegacyNorm = new Float64Array(0);
  private draftGrantPlantQ = new Float64Array(0);
  private draftGrantPreyQ = new Float64Array(0);
  private draftGrantCarrionQ = new Float64Array(0);
  private draftGrantDetritusQ = new Float64Array(0);
  private draftNextEnergy = new Float64Array(0);
  private draftNextHealth = new Float64Array(0);
  private draftGrowthTargetStructQ = new Float64Array(0);
  private draftDevPhys = new Float64Array(0);
  private draftDevNeural = new Float64Array(0);
  private draftDevSenesc = new Float64Array(0);
  private draftThermalStress = new Float64Array(0);
  private draftEndurance = new Float64Array(0);
  private draftGrowthScale = new Float64Array(0);
  private draftRecoveryScale = new Float64Array(0);
  private draftCanonicalOrder = new Int32Array(0);

  // Per-cell contention intrusive linked lists
  private readonly plantCellHead: Int32Array;
  private readonly plantDirtyCells: Uint32Array;
  private plantNextDraft = new Int32Array(0);
  private readonly carrionCellHead: Int32Array;
  private readonly carrionDirtyCells: Uint32Array;
  private carrionNextDraft = new Int32Array(0);
  private readonly detritusCellHead: Int32Array;
  private readonly detritusDirtyCells: Uint32Array;
  private detritusNextDraft = new Int32Array(0);
  private readonly preyCellHead: Int32Array;
  private readonly preyDirtyCells: Uint32Array;
  private preyNextDraft = new Int32Array(0);
  private readonly aliveCellHead: Int32Array;
  private readonly aliveDirtyCells: Uint32Array;
  private aliveNextDraft = new Int32Array(0);
  private bgPreyScratchDraftIdx = new Int32Array(64);
  private preyRemStructQ = new Float64Array(0);
  private preyRemReserveQ = new Float64Array(0);
  private preyRemTouched = new Uint8Array(0);
  private preyRemTouchedList = new Int32Array(64);

  // Predation bite SoA buffers
  private predBiteCap = 64;
  private predBitePredDraft = new Int32Array(64);
  private predBitePreyDraft = new Int32Array(64);
  private predBiteMassQ = new Float64Array(64);

  // Photosynthesis & newly-died cell scratch
  private readonly photoCellIdx: Uint32Array;
  private readonly photoGainMassQ: Float64Array;
  private readonly photoGainEnergyQ: Float64Array;
  private readonly projectedPlantCellMass: Float64Array;
  private readonly newlyDiedCellFlags: Uint8Array;
  private readonly newlyDiedCellList: Uint32Array;

  // Reproduction & Egg SoA scratch
  private activeIdxToDraftIdx = new Int32Array(0);
  private rpCap = 64;
  private rpFemaleDraft = new Int32Array(64);
  private rpMaleDraft = new Int32Array(64);
  private rpStatus = new Uint8Array(64);
  private rpFemaleCd = new Int32Array(64);
  private rpMaleCd = new Int32Array(64);
  private rpFatherMatingDemandQ = new Float64Array(64);
  private rpEggStart = new Int32Array(64);
  private rpEggCount = new Uint16Array(64);

  private eggCap = 64;
  private eggOrg: Organism[] = [];
  private eggSpeciesIdx = new Uint16Array(64);
  private eggDraftSlot = new Int32Array(64);
  private eggIsReused = new Uint8Array(64);
  private eggProvisioned = new Uint8Array(64);
  private eggMutationRecords: (readonly MutationRecord[] | undefined)[] = [];
  private slotPlanSlots = new Int32Array(64);
  private slotPlanReused = new Uint8Array(64);

  // Reusable per-tick species scratch buffers & mate cursor
  private stepSpeciesCap = 0;
  private stepTouchedPops: PopulationManager[] = [];
  private stepPopBySpeciesIdx: Array<PopulationManager | null> = [];
  private stepSpeciesDraftStart = new Int32Array(0);
  private stepSpeciesDraftEnd = new Int32Array(0);
  private stepSpeciesWasCanonical = new Uint8Array(0);
  private stepSpeciesActiveMapOffsets = new Int32Array(0);
  private stepUnsortedIdToDraftMaps: Array<Map<number, number> | null> = [];
  private stepSpeciesEligibleCounts = new Int32Array(0);
  private stepSpeciesEggStart = new Int32Array(0);
  private stepSpeciesEggCount = new Int32Array(0);
  private stepCommittedDeathEvents: OrganismDeathEvent[] = [];

  private readonly mateCellCursor: Int32Array;
  private readonly mateCellTouched: Uint32Array;
  private mateTouchedCount = 0;

  // Active tick counters (for clean modular phases & guaranteed finally cleanup)
  private curDraftCount = 0;
  private curEggPlanCount = 0;
  private curReproPlanCount = 0;
  private curPredBiteCount = 0;
  private curPlantDirtyCount = 0;
  private curCarrionDirtyCount = 0;
  private curDetritusDirtyCount = 0;
  private curPreyDirtyCount = 0;
  private curAliveDirtyCount = 0;
  private curPhotoCount = 0;
  private curPreyRemTouchedCount = 0;
  private curNewlyDiedCellCount = 0;
  private curDiedCount = 0;
  private curGloballySorted = true;
  private curPrevGlobalId = -1;

  constructor(config: BiologySimulationConfig) {
    this.grid = config.grid;
    this.wrapX = config.wrapX ?? false;
    this.onPhase = config.onPhase;
    const seed = config.seed ?? config.grid.seed;

    this.streams = new RngStreams(seed, [
      'biology:spawning',
      'biology:founderGenetics',
      'biology:genetics',
      'biology:mutation',
      'biology:reproduction',
      'biology:lifecycle',
      // Anatomy inheritance & mutation: separate stream so core-genome draws stay unchanged
      'biology:anatomy',
      // Mate acceptance & zygote viability under the reproductive compatibility model
      'biology:mating',
    ]);

    this.speciesRegistry = config.speciesRegistry ?? createDefaultSpeciesRegistry();
    for (const sp of this.speciesRegistry.list()) {
      validateSpeciesDefinition(sp);
    }

    const hasExplicitEconomyConfig =
      config.strictConservation === true ||
      config.energyLedger !== undefined ||
      config.worldEnergyGrid !== undefined ||
      config.entityStore !== undefined ||
      config.transactionalFoodSources !== undefined;

    if (config.foodProvider !== undefined) {
      if (hasExplicitEconomyConfig || config.foodProvider.isPhysicallyClosed === true) {
        assertPhysicallyClosedFoodProvider(config.foodProvider, true);
        this.strictConservation = true;
        this.conservationMode = 'strict';
      } else {
        this.strictConservation = false;
        this.conservationMode = 'legacy-external-escrow';
      }
    } else {
      this.strictConservation = config.strictConservation ?? true;
      this.conservationMode = this.strictConservation ? 'strict' : 'legacy-external-escrow';
    }

    // Validate optional external TransactionalFoodSources
    if (config.transactionalFoodSources) {
      const { plant, prey, carrion, detritus } = config.transactionalFoodSources;
      if (plant) {
        assertPhysicallyClosedFoodProvider(plant, true);
        this.externalPlantSource = plant;
      }
      if (prey) {
        assertPhysicallyClosedFoodProvider(prey, true);
        this.externalPreySource = prey;
      }
      if (carrion) {
        assertPhysicallyClosedFoodProvider(carrion, true);
        this.externalCarrionSource = carrion;
      }
      if (detritus) {
        assertPhysicallyClosedFoodProvider(detritus, true);
        this.externalDetritusSource = detritus;
      }
    }

    const bgPreyScale = config.backgroundPreyCapacityScale ?? DEFAULT_CONSERVATIVE_PREY_CAPACITY_SCALE;
    if (!Number.isFinite(bgPreyScale) || bgPreyScale < 0) {
      throw new RangeError(`backgroundPreyCapacityScale must be finite and >= 0, received: ${bgPreyScale}`);
    }
    this.backgroundPreyCapacityScale = bgPreyScale;

    // Validate decomposition & photosynthesis rates
    const photoRate = config.plantPhotosynthesisRate ?? 0.28;
    const plantCapScale = config.plantCarryingCapacityScale ?? 1.0;
    const carrionRate = config.carrionDecompositionRate ?? 0.15;
    const detritusRate = config.detritusDecompositionRate ?? 0.08;
    if (!Number.isFinite(photoRate) || photoRate < 0 || photoRate > 1) {
      throw new RangeError(`plantPhotosynthesisRate must be in [0, 1], received: ${photoRate}`);
    }
    if (!Number.isFinite(plantCapScale) || plantCapScale < 0) {
      throw new RangeError(`plantCarryingCapacityScale must be >= 0, received: ${plantCapScale}`);
    }
    if (!Number.isFinite(carrionRate) || carrionRate < 0 || carrionRate > 1) {
      throw new RangeError(`carrionDecompositionRate must be in [0, 1], received: ${carrionRate}`);
    }
    if (!Number.isFinite(detritusRate) || detritusRate < 0 || detritusRate > 1) {
      throw new RangeError(`detritusDecompositionRate must be in [0, 1], received: ${detritusRate}`);
    }
    this.plantPhotosynthesisRatePpm = fractionToPpm(photoRate, 'half-even');
    this.carrionDecompositionRatePpm = fractionToPpm(carrionRate, 'half-even');
    this.detritusDecompositionRatePpm = fractionToPpm(detritusRate, 'half-even');

    // Compute per-cell plant carrying capacities from read-only WorldGrid
    this.plantCapacityQ = new Float64Array(config.grid.cellCount);
    const landCells: number[] = [];
    for (let i = 0; i < config.grid.cellCount; i++) {
      const cell = config.grid.getCellByIndex(i);
      if (cell.terrain === 'deep-water' || cell.terrain === 'shallow-water') {
        this.plantCapacityQ[i] = 0;
        continue;
      }
      landCells.push(i);
      if (this.conservationMode === 'strict' && plantCapScale > 0) {
        const baseMU = BIOME_PLANT_CAPACITY_MU[cell.biome] ?? 10;
        const moistureBoost = 0.65 + 0.7 * Math.min(1, Math.max(0, cell.moisture));
        this.plantCapacityQ[i] = muToQ(baseMU * plantCapScale * moistureBoost, 'half-even');
      }
    }
    this.landCellIndices = Uint32Array.from(landCells);

    // Build or attach Energy economy stores + EnergyLedger
    const defaultAbioticMU = config.initialAbioticMassMU ?? Math.max(100_000, landCells.length * 400);
    if (!Number.isFinite(defaultAbioticMU) || defaultAbioticMU < 0) {
      throw new RangeError(`initialAbioticMassMU must be finite and >= 0, received: ${defaultAbioticMU}`);
    }
    const defaultAbioticQ = BigInt(muToQ(defaultAbioticMU, 'half-even'));

    this.energyGrid =
      config.worldEnergyGrid ??
      new WorldEnergyGrid({
        width: config.grid.width,
        height: config.grid.height,
        wrapX: this.effectiveWrapX,
      });
    if (this.energyGrid.cellCount !== config.grid.cellCount) {
      throw new RangeError(
        `worldEnergyGrid.cellCount (${this.energyGrid.cellCount}) must match grid.cellCount (${config.grid.cellCount})`
      );
    }

    const usesDefaultConservativePrey =
      config.foodProvider === undefined && this.conservationMode === 'strict';
    const preyReserveSlots =
      config.organismSlotOffset ??
      (usesDefaultConservativePrey || config.foodProvider?.isPhysicallyClosed === true
        ? config.grid.cellCount
        : 0);

    const initialEntityCap = Math.max(preyReserveSlots + 512, 1024);
    this.entityStore = config.entityStore ?? new EntityEnergyStore(initialEntityCap);
    if (this.entityStore.capacity < preyReserveSlots) {
      this.entityStore.ensureCapacity(preyReserveSlots + 512);
    }

    this.organismSlotBase = preyReserveSlots;
    this.nextFreshOrganismSlot = preyReserveSlots;
    this.slotCarryCreditQ = new Float64Array(this.entityStore.capacity);
    this.slotMaxReserveMassQ = new Float64Array(this.entityStore.capacity);
    this.slotLastSyncedEnergy = new Float64Array(this.entityStore.capacity);

    const callerProvidedLedger = config.energyLedger !== undefined;
    this.ledger =
      config.energyLedger ??
      new EnergyLedger({
        initialAbioticMassQ: defaultAbioticQ,
        escrowSlots: 8,
        postingCapacity: Math.max(4096, Math.min(131072, landCells.length * 4)),
        strictStoichiometry: true,
      });

    if (this.strictConservation && !this.ledger.strictStoichiometry) {
      throw new NonConservingFoodProviderError(
        'Strict conservation mode requires EnergyLedger with strictStoichiometry: true'
      );
    }

    // Register stores on ledger if not already registered
    if (!callerProvidedLedger || (this.ledger.committedTxCount === 0 && !this.ledger.activeTransaction)) {
      this.tryRegisterStoreIfUnregistered(this.energyGrid);
      this.tryRegisterStoreIfUnregistered(this.entityStore);
    }

    if (config.foodProvider !== undefined) {
      this.foodProvider = config.foodProvider;
      this.hasConservativePreyProvider = config.foodProvider.isPhysicallyClosed === true;
    } else if (this.conservationMode === 'strict') {
      const conservativeFood = new DeterministicPreyFoodProvider(config.grid, {
        seed,
        capacityScale: bgPreyScale,
        regenerationRate: 0.5,
        conservative: {
          ledger: this.ledger,
          energyGrid: this.energyGrid,
          preyStore: this.entityStore,
          preySlotOffset: 0,
          plantDonorShare: 0.88,
        },
      });
      this.foodProvider = conservativeFood;
      this.hasConservativePreyProvider = true;
    } else {
      this.foodProvider = new DeterministicPreyFoodProvider(config.grid, { seed });
      this.hasConservativePreyProvider = false;
    }

    this.isPhysicallyClosed =
      this.conservationMode === 'strict' &&
      (this.foodProvider.isPhysicallyClosed === true || this.hasConservativePreyProvider);

    // Seed initial closed-world primary biomass + conservative prey via GENESIS if starting clean
    if (
      this.conservationMode === 'strict' &&
      config.worldEnergyGrid === undefined &&
      config.energyLedger === undefined &&
      landCells.length > 0
    ) {
      this.seedInitialEcosystemGenesis(
        this.hasConservativePreyProvider && this.foodProvider instanceof DeterministicPreyFoodProvider
          ? this.foodProvider
          : null
      );
    }

    this.energyView = this.energyGrid.createReadView();

    // Validation & diagnostic config
    this.recordHistory = config.recordHistory ?? true;
    const maxHistoryEntries = config.maxHistoryEntries ?? DEFAULT_MAX_HISTORY_ENTRIES;
    if (!Number.isInteger(maxHistoryEntries) || maxHistoryEntries < 0) {
      throw new RangeError(
        `maxHistoryEntries must be a non-negative integer, received: ${maxHistoryEntries}`
      );
    }
    this.maxHistoryEntries = maxHistoryEntries;

    const statsInterval = config.statsInterval ?? 1;
    if (!Number.isInteger(statsInterval) || statsInterval < 1) {
      throw new RangeError(`statsInterval must be an integer >= 1, received: ${statsInterval}`);
    }
    this.statsInterval = statsInterval;

    const maxDeathEventHistory = config.maxDeathEventHistory ?? DEFAULT_MAX_DEATH_EVENT_HISTORY;
    if (!Number.isInteger(maxDeathEventHistory) || maxDeathEventHistory < 0) {
      throw new RangeError(
        `maxDeathEventHistory must be a non-negative integer, received: ${maxDeathEventHistory}`
      );
    }
    this.maxDeathEventHistory = maxDeathEventHistory;

    const maxDeathListenerErrors =
      config.maxDeathListenerErrors ?? DEFAULT_MAX_DEATH_EVENT_HISTORY;
    if (!Number.isInteger(maxDeathListenerErrors) || maxDeathListenerErrors < 0) {
      throw new RangeError(
        `maxDeathListenerErrors must be a non-negative integer, received: ${maxDeathListenerErrors}`
      );
    }
    this.maxDeathListenerErrors = maxDeathListenerErrors;
    this.onDeathListenerError = config.onDeathListenerError;

    this.trackMutationEvents = config.trackMutationEvents ?? false;
    if (config.mutationConfigOverride) {
      validateMutationConfig(config.mutationConfigOverride);
    }
    this.mutationConfigOverride = config.mutationConfigOverride;

    this.useDirectEntityStore =
      !callerProvidedLedger || config.entityStore === this.entityStore;
    this.useDirectEnergyGrid =
      !callerProvidedLedger || config.worldEnergyGrid === this.energyGrid;

    const cc = config.grid.cellCount;
    this.plantCellHead = new Int32Array(cc);
    this.plantCellHead.fill(-1);
    this.plantDirtyCells = new Uint32Array(cc);
    this.carrionCellHead = new Int32Array(cc);
    this.carrionCellHead.fill(-1);
    this.carrionDirtyCells = new Uint32Array(cc);
    this.detritusCellHead = new Int32Array(cc);
    this.detritusCellHead.fill(-1);
    this.detritusDirtyCells = new Uint32Array(cc);
    this.preyCellHead = new Int32Array(cc);
    this.preyCellHead.fill(-1);
    this.preyDirtyCells = new Uint32Array(cc);
    this.aliveCellHead = new Int32Array(cc);
    this.aliveCellHead.fill(-1);
    this.aliveDirtyCells = new Uint32Array(cc);

    this.photoCellIdx = new Uint32Array(this.landCellIndices.length);
    this.photoGainMassQ = new Float64Array(this.landCellIndices.length);
    this.photoGainEnergyQ = new Float64Array(this.landCellIndices.length);
    this.projectedPlantCellMass = new Float64Array(cc);
    this.projectedPlantCellMass.fill(-1);
    this.newlyDiedCellFlags = new Uint8Array(cc);
    this.newlyDiedCellList = new Uint32Array(cc);
    this.mateCellCursor = new Int32Array(cc);
    this.mateCellCursor.fill(-2);
    this.mateCellTouched = new Uint32Array(cc);

    // Optional autonomous spatial behavior (isolated in spatialBehavior.ts / spatialNavigation.ts)
    const spatialCfg = config.spatial;
    if (spatialCfg !== undefined && spatialCfg !== false) {
      if (this.conservationMode !== 'strict') {
        throw new RangeError(
          'Spatial behavior requires strict conservation mode (movement energy is paid through the EnergyLedger)'
        );
      }
      if (hasAnyExternalFoodSource(config)) {
        throw new RangeError(
          'Spatial behavior requires the built-in grid resource pools; external transactionalFoodSources are not supported'
        );
      }
      if (this.wrapX) {
        throw new RangeError(
          'Spatial behavior uses the approved finite geography: wrapX must be false (no crossing between map edges)'
        );
      }
      this.spatial = new SpatialBehaviorSystem(
        config.grid,
        seed,
        spatialCfg === true ? {} : spatialCfg,
        this.organismSlotBase
      );
      this.spatial.ensureCapacity(this.entityStore.capacity);
      const emptyF64 = new Float64Array(0);
      this.spatialView = {
        tick: 0,
        draftCount: 0,
        order: this.draftCanonicalOrder,
        org: this.draftOrg,
        orgId: this.draftOrgId,
        slot: this.draftSlot,
        cell: this.draftCellIndex,
        speciesIdx: this.draftSpeciesIdx,
        flags: this.draftFlags,
        nextStage: this.draftNextStage,
        nextEnergy: this.draftNextEnergy,
        nextHealth: this.draftNextHealth,
        structMassQ: this.draftStructMassQ,
        reserveMassQ: this.draftPostMetabResQ,
        reqPlantQ: this.draftReqPlantQ,
        reqPreyQ: this.draftReqPreyQ,
        reqCarrionQ: this.draftReqCarrionQ,
        reqDetritusQ: this.draftReqDetritusQ,
        grantPlantQ: this.draftGrantPlantQ,
        grantPreyQ: this.draftGrantPreyQ,
        grantCarrionQ: this.draftGrantCarrionQ,
        grantDetritusQ: this.draftGrantDetritusQ,
        speciesCount: 0,
        preyMatrix: this.speciesPreyMatrix,
        plantMass: emptyF64,
        carrionMass: emptyF64,
        detritusMass: emptyF64,
        bgPreyStruct: null,
        bgPreyReserve: null,
      };
    } else {
      this.spatial = null;
      this.spatialView = null;
    }

    // Optional evolution (inheritance-driven selection, reproductive isolation, speciation)
    const evoCfg = config.evolution;
    const resolvedEvolution =
      evoCfg !== undefined && evoCfg !== false ? resolveEvolutionConfig(evoCfg === true ? {} : evoCfg) : null;
    if (resolvedEvolution !== null && resolvedEvolution.enabled) {
      this.evolution = resolvedEvolution;
      this.phylogeny = new PhylogenyTracker(this.speciesRegistry.list());
      this.speciationEngine = new SpeciationEngine(config.grid, resolvedEvolution);
      this.anatomyPhysiology = resolvedEvolution.enableAnatomyEvolution;
      this.physioTradeOffs = resolvedEvolution.enablePhysiologicalTradeOffs;
    } else {
      this.evolution = null;
      this.phylogeny = null;
      this.speciationEngine = null;
      this.anatomyPhysiology = false;
      this.physioTradeOffs = false;
    }
    this.spatial?.setPhysiologyModel(this.physioTradeOffs);
  }

  private tryRegisterStoreIfUnregistered(store: WorldEnergyGrid | EntityEnergyStore): void {
    try {
      this.ledger.registerStore(store);
    } catch (err) {
      // Allow externally pre-registered stores when caller passed existing EnergyLedger
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('already registered') || msg.includes('already has a registered store')) {
        return;
      }
      throw err;
    }
  }

  private seedInitialEcosystemGenesis(conservativePrey: DeterministicPreyFoodProvider | null): void {
    const tx = this.ledger.begin(0, { genesis: true });
    try {
      for (let k = 0; k < this.landCellIndices.length; k++) {
        const idx = this.landCellIndices[k];
        const capPlantQ = this.plantCapacityQ[idx];
        const seedPlantQ = applyPpm(capPlantQ, 700_000, 'floor');
        if (seedPlantQ > 0) {
          tx.transferBiomass(
            PostingReason.GENESIS,
            AccountKind.GENESIS,
            0,
            AccountKind.CELL_PLANT,
            idx,
            seedPlantQ,
            energyOfMass(seedPlantQ, RHO_PLANT)
          );
        }
        const seedDetritusQ = Math.max(0, Math.min(muToQ(8, 'floor'), applyPpm(capPlantQ, 100_000, 'floor')));
        if (seedDetritusQ > 0) {
          tx.transferBiomass(
            PostingReason.GENESIS,
            AccountKind.GENESIS,
            0,
            AccountKind.CELL_DETRITUS,
            idx,
            seedDetritusQ,
            energyOfMass(seedDetritusQ, RHO_DETRITUS)
          );
        }
        if (conservativePrey) {
          const { x, y } = this.grid.fromIndex(idx);
          const biome = this.grid.getBiome(x, y) ?? 'savanna';
          const preyCapMU =
            DeterministicPreyFoodProvider.getBiomeBasePrey(biome) * this.backgroundPreyCapacityScale;
          const preySeedQ = preyCapMU > 0 ? muToQ(preyCapMU, 'half-even') : 0;
          if (preySeedQ > 0) {
            tx.transferBiomass(
              PostingReason.GENESIS,
              AccountKind.GENESIS,
              0,
              AccountKind.ORGANISM_RESERVE,
              idx,
              preySeedQ,
              energyOfMass(preySeedQ, RHO_RESERVE)
            );
          }
        }
      }
      tx.prepare();
      tx.commit();
    } catch (err) {
      if (tx.state === 'ACTIVE' || tx.state === 'PREPARED') {
        tx.abort();
      }
      throw err;
    }
  }

  get tick(): number {
    return this.tickCount;
  }

  assertPhysicallyClosed(): void {
    if (!this.isPhysicallyClosed) {
      throw new NonConservingFoodProviderError(
        `BiologySimulation is not physically closed (conservationMode=${this.conservationMode}, foodProvider.isPhysicallyClosed=${String(this.foodProvider.isPhysicallyClosed)})`
      );
    }
  }

  getEnergyAudit(): EnergyLedgerAudit {
    return this.ledger.audit();
  }

  assertEnergyAudit(): EnergyLedgerAudit {
    this.ledger.assertStoichiometry();
    return this.ledger.assertAudit();
  }

  getOrganismEntitySlot(organismId: number): number | undefined {
    return this.organismIdToSlot.get(organismId);
  }

  getOrganismCarryCreditQ(organismId: number): number {
    const slot = this.organismIdToSlot.get(organismId);
    return slot !== undefined ? this.slotCarryCreditQ[slot] : 0;
  }

  getOrganismMassAndEnergy(organismId: number):
    | {
        readonly structMassQ: number;
        readonly structEnergyQ: number;
        readonly reserveMassQ: number;
        readonly reserveEnergyQ: number;
      }
    | undefined {
    const slot = this.organismIdToSlot.get(organismId);
    if (slot === undefined) return undefined;
    return Object.freeze({
      structMassQ: this.entityStore.structMassQ(slot),
      structEnergyQ: this.entityStore.structEnergyQ(slot),
      reserveMassQ: this.entityStore.reserveMassQ(slot),
      reserveEnergyQ: this.entityStore.reserveEnergyQ(slot),
    });
  }

  private getOrCreatePopulation(speciesId: string): PopulationManager {
    let pop = this.populations.get(speciesId);
    if (!pop) {
      const species = this.speciesRegistry.get(speciesId);
      pop = new PopulationManager(species, this.grid);
      this.populations.set(speciesId, pop);
    }
    return pop;
  }

  private getSpeciesDietPpm(species: SpeciesDefinition): NormalizedDietWeightsPpm {
    let cached = this.dietPpmCache.get(species.id);
    if (!cached) {
      const profile = this.speciesRegistry.getTrophicProfile(species.id);
      cached = dietWeightsToPpm(profile.dietWeights);
      this.dietPpmCache.set(species.id, cached);
    }
    return cached;
  }

  private getScratchPhenotype(species: SpeciesDefinition): PhenotypeProfile {
    let cached = this.scratchPhenotypeBySchema.get(species.genomeSchema.id);
    if (!cached) {
      const n = species.genomeSchema.locusCount;
      cached = {
        schemaId: species.genomeSchema.id,
        geneticExpression: new Float32Array(n),
        expressed: new Float32Array(n),
      };
      this.scratchPhenotypeBySchema.set(species.genomeSchema.id, cached);
    }
    return cached;
  }

  private ensureEntityCapacity(minSlots: number): void {
    if (minSlots <= this.entityStore.capacity) return;
    let nextCap = Math.max(64, this.entityStore.capacity);
    while (nextCap < minSlots) {
      nextCap *= 2;
    }
    this.entityStore.ensureCapacity(nextCap);

    const growFloat = (old: Float64Array): Float64Array => {
      const next = new Float64Array(nextCap);
      next.set(old);
      return next;
    };
    this.slotCarryCreditQ = growFloat(this.slotCarryCreditQ);
    this.slotMaxReserveMassQ = growFloat(this.slotMaxReserveMassQ);
    this.slotLastSyncedEnergy = growFloat(this.slotLastSyncedEnergy);
    if (this.spatial !== null) {
      this.spatial.ensureCapacity(nextCap);
    }
  }

  private planSlotAllocations(count: number): {
    readonly slots: number[];
    readonly isReused: boolean[];
    readonly reusedPopCount: number;
    readonly freshAllocCount: number;
    readonly maxRequiredCapacity: number;
  } {
    const slots = new Array<number>(count);
    const isReused = new Array<boolean>(count);
    let freeAvail = this.freeOrganismSlots.length;
    let reusedPopCount = 0;
    let freshCursor = this.nextFreshOrganismSlot;

    for (let i = 0; i < count; i++) {
      if (freeAvail > 0) {
        freeAvail -= 1;
        slots[i] = this.freeOrganismSlots[freeAvail];
        isReused[i] = true;
        reusedPopCount += 1;
      } else {
        slots[i] = freshCursor++;
        isReused[i] = false;
      }
    }
    return {
      slots,
      isReused,
      reusedPopCount,
      freshAllocCount: freshCursor - this.nextFreshOrganismSlot,
      maxRequiredCapacity: freshCursor,
    };
  }

  private releaseOrganismSlot(organismId: number): void {
    const slot = this.organismIdToSlot.get(organismId);
    if (slot === undefined) return;
    this.organismIdToSlot.delete(organismId);
    this.slotCarryCreditQ[slot] = 0;
    this.slotMaxReserveMassQ[slot] = 0;
    this.slotLastSyncedEnergy[slot] = 0;
    if (this.spatial !== null) {
      this.spatial.releaseSlot(slot);
    }
    this.freeOrganismSlots.push(slot);
  }

  private computeInitialMassForOrganism(
    org: Organism,
    species: SpeciesDefinition
  ): { structMassQ: MassQ; reserveMassQ: MassQ; maxReserveMassQ: MassQ } {
    const profile = this.speciesRegistry.getTrophicProfile(species.id);
    const dev = computeDevelopmentalScale(org.ageTicks, org.stage, species);
    const structMassQ = computeTargetStructMassQ(profile, dev.physicalMaturityScale);
    const maxReserveMassQ = computeMaxReserveMassQ(structMassQ, profile);
    const energyFrac = Math.min(1, Math.max(0, org.energy));
    const reserveMassQ = applyPpm(maxReserveMassQ, fractionToPpm(energyFrac, 'half-even'), 'floor');
    return { structMassQ, reserveMassQ, maxReserveMassQ };
  }

  /**
   * Populates `this.reusableEnv` safely without mutating `WorldGrid` or allocating objects.
   */
  private populateEnvContext(
    x: number,
    y: number,
    cellIndex: number,
    tick: number
  ): FoodEnvironmentContext {
    const terrain = this.grid.getTerrain(x, y) ?? 'lowland';
    const biome = this.grid.getBiome(x, y) ?? 'savanna';
    this.reusableEnv.cellIndex = cellIndex;
    this.reusableEnv.x = x;
    this.reusableEnv.y = y;
    this.reusableEnv.terrain = terrain;
    this.reusableEnv.biome = biome;
    this.reusableEnv.temperature = this.grid.temperature[cellIndex];
    this.reusableEnv.moisture = this.grid.moisture[cellIndex];
    this.reusableEnv.tick = tick;
    return this.reusableEnv;
  }

  /**
   * Spawns a genetically diverse founder cohort of `count` individuals onto habitable map cells.
   * Atomically provisions all founder organisms via a `genesis: true` `EnergyTransaction` so
   * introduced biomass is explicitly recorded in `EnergyLedger`.
   */
  spawnFounderPopulation(
    speciesId: string,
    count: number,
    options: SpawnFounderOptions = {}
  ): Organism[] {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(`Founder count must be a non-negative integer, received: ${count}`);
    }
    const species = this.speciesRegistry.get(speciesId);
    const pop = this.getOrCreatePopulation(speciesId);
    if (count === 0) return [];

    const candidateIndices: number[] = [];
    const preferredIndices: number[] = [];
    const center = options.center;
    const radius = center?.radius ?? Math.max(this.grid.width, this.grid.height);
    const spatialSpeciesIdx = this.spatial !== null ? this.resolveSpatialSpeciesIndex(species) : -1;

    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < this.grid.width; x++) {
        if (center) {
          const dx = x - center.x;
          const dy = y - center.y;
          if (dx * dx + dy * dy > radius * radius) continue;
        }
        const terrain = this.grid.getTerrain(x, y)!;
        const biome = this.grid.getBiome(x, y)!;
        if (this.spatial !== null) {
          // Spatial mode: habitable means passable for the species' own locomotion (land or water)
          if (!this.spatial.isHabitableCell(spatialSpeciesIdx, y * this.grid.width + x)) continue;
        } else if (terrain === 'deep-water' || terrain === 'shallow-water') continue;
        if (options.filterCell && !options.filterCell(x, y, terrain, biome)) continue;
        const idx = this.grid.toIndex(x, y);
        candidateIndices.push(idx);
        if (species.preferredBiomes.includes(biome)) {
          preferredIndices.push(idx);
        }
      }
    }

    const pool = preferredIndices.length > 0 ? preferredIndices : candidateIndices;
    if (pool.length === 0) {
      throw new RangeError(`No habitable land cells found for species "${speciesId}"`);
    }

    const rngSnapshot = this.streams.snapshotStates();
    const nextIdBefore = this.nextId;
    const spawnRng = this.streams.get('biology:spawning');
    const founderGeneticsRng = this.streams.get('biology:founderGenetics');
    const stage = options.stage ?? 'adult';
    const spawned: Organism[] = [];
    const masses: Array<{ structMassQ: MassQ; reserveMassQ: MassQ; maxReserveMassQ: MassQ }> = [];

    let tx: EnergyTransaction | null = null;
    try {
      for (let i = 0; i < count; i++) {
        const cellIndex = pool[spawnRng.nextInt(0, pool.length - 1)];
        const { x, y } = this.grid.fromIndex(cellIndex);
        const forcedSex: Sex | undefined = i === 0 ? 'female' : i === 1 ? 'male' : undefined;
        const org = createFounderOrganism(
          this.nextId++,
          species,
          x,
          y,
          cellIndex,
          this.tickCount,
          founderGeneticsRng,
          stage,
          forcedSex
        );
        const m = this.computeInitialMassForOrganism(org, species);
        org.energy = m.maxReserveMassQ > 0 ? m.reserveMassQ / m.maxReserveMassQ : 0;
        refreshOrganismPhenotype(org, species);
        spawned.push(org);
        masses.push(m);
      }

      pop.validateBatchAdditions(spawned);
      const slotPlan = this.planSlotAllocations(count);
      this.ensureEntityCapacity(slotPlan.maxRequiredCapacity);
      pop.reserveAdditionalCapacity(count);

      tx = this.ledger.begin(this.tickCount, { genesis: true });
      for (let i = 0; i < count; i++) {
        const slot = slotPlan.slots[i];
        const m = masses[i];
        if (m.structMassQ > 0) {
          tx.transferBiomass(
            PostingReason.GENESIS,
            AccountKind.GENESIS,
            0,
            AccountKind.ORGANISM_STRUCT,
            slot,
            m.structMassQ,
            energyOfMass(m.structMassQ, RHO_STRUCT)
          );
        }
        if (m.reserveMassQ > 0) {
          tx.transferBiomass(
            PostingReason.GENESIS,
            AccountKind.GENESIS,
            0,
            AccountKind.ORGANISM_RESERVE,
            slot,
            m.reserveMassQ,
            energyOfMass(m.reserveMassQ, RHO_RESERVE)
          );
        }
      }
      tx.prepare();
      tx.commit();

      // Publish slot allocations & population membership
      this.freeOrganismSlots.length -= slotPlan.reusedPopCount;
      this.nextFreshOrganismSlot += slotPlan.freshAllocCount;
      for (let i = 0; i < count; i++) {
        const org = spawned[i];
        const slot = slotPlan.slots[i];
        const m = masses[i];
        this.organismIdToSlot.set(org.id, slot);
        this.slotCarryCreditQ[slot] = 0;
        this.slotMaxReserveMassQ[slot] = m.maxReserveMassQ;
        this.slotLastSyncedEnergy[slot] = org.energy;
        if (this.spatial !== null) {
          this.spatial.initSlot(slot, org.id, org.cellIndex);
        }
      }
      pop.addOrganismsBatch(spawned, 'introduced');
      return spawned;
    } catch (err) {
      if (tx && (tx.state === 'ACTIVE' || tx.state === 'PREPARED')) {
        tx.abort();
      }
      this.streams.restoreStates(rngSnapshot);
      this.nextId = nextIdBefore;
      throw err;
    }
  }

  /**
   * Manually places an organism with a known genome at `(x, y)` (for experiments & sandbox control).
   * Counted under `introducedTotal`, not biological `birthsTotal`, and registered via GENESIS.
   */
  spawnOrganism(opts: SpawnManualOrganismOptions): Organism {
    const cellIndex = this.grid.toIndex(opts.x, opts.y);
    if (cellIndex < 0) {
      throw new RangeError(`Spawn coordinates out of bounds: (${opts.x}, ${opts.y})`);
    }
    const terrain = this.grid.getTerrain(opts.x, opts.y);
    const species = this.speciesRegistry.get(opts.speciesId);
    if (this.spatial !== null) {
      if (!this.spatial.isHabitableCell(this.resolveSpatialSpeciesIndex(species), cellIndex)) {
        throw new RangeError(
          `Cannot spawn "${opts.speciesId}" on terrain "${terrain}" impassable for its locomotion (${opts.x}, ${opts.y})`
        );
      }
    } else if (terrain === 'deep-water' || terrain === 'shallow-water') {
      throw new RangeError(`Cannot spawn land organism on water terrain (${opts.x}, ${opts.y})`);
    }
    const pop = this.getOrCreatePopulation(opts.speciesId);
    const nextIdBefore = this.nextId;

    let tx: EnergyTransaction | null = null;
    try {
      const org = createOrganism({
        id: this.nextId++,
        species,
        sex: opts.sex,
        x: opts.x,
        y: opts.y,
        cellIndex,
        birthTick: this.tickCount,
        generation: opts.generation ?? 0,
        parentAId: null,
        parentBId: null,
        genome: opts.genome,
        stage: opts.stage ?? 'adult',
        ageTicks: opts.ageTicks,
        health: opts.health,
        energy: opts.energy,
      });
      const m = this.computeInitialMassForOrganism(org, species);
      org.energy = m.maxReserveMassQ > 0 ? m.reserveMassQ / m.maxReserveMassQ : 0;
      refreshOrganismPhenotype(org, species);

      pop.validateBatchAdditions([org]);
      const slotPlan = this.planSlotAllocations(1);
      this.ensureEntityCapacity(slotPlan.maxRequiredCapacity);
      pop.reserveAdditionalCapacity(1);

      const slot = slotPlan.slots[0];
      tx = this.ledger.begin(this.tickCount, { genesis: true });
      if (m.structMassQ > 0) {
        tx.transferBiomass(
          PostingReason.GENESIS,
          AccountKind.GENESIS,
          0,
          AccountKind.ORGANISM_STRUCT,
          slot,
          m.structMassQ,
          energyOfMass(m.structMassQ, RHO_STRUCT)
        );
      }
      if (m.reserveMassQ > 0) {
        tx.transferBiomass(
          PostingReason.GENESIS,
          AccountKind.GENESIS,
          0,
          AccountKind.ORGANISM_RESERVE,
          slot,
          m.reserveMassQ,
          energyOfMass(m.reserveMassQ, RHO_RESERVE)
        );
      }
      tx.prepare();
      tx.commit();

      this.freeOrganismSlots.length -= slotPlan.reusedPopCount;
      this.nextFreshOrganismSlot += slotPlan.freshAllocCount;
      this.organismIdToSlot.set(org.id, slot);
      this.slotCarryCreditQ[slot] = 0;
      this.slotMaxReserveMassQ[slot] = m.maxReserveMassQ;
      this.slotLastSyncedEnergy[slot] = org.energy;
      if (this.spatial !== null) {
        this.spatial.initSlot(slot, org.id, org.cellIndex);
      }
      pop.addOrganism(org, 'introduced');
      return org;
    } catch (err) {
      if (tx && (tx.state === 'ACTIVE' || tx.state === 'PREPARED')) {
        tx.abort();
      }
      this.nextId = nextIdBefore;
      throw err;
    }
  }

  /**
   * Effective wrapX flag avoiding duplicate column wraps on 1x1 and 2-wide grids.
   */
  private get effectiveWrapX(): boolean {
    return this.wrapX && this.grid.width > 2;
  }

  /**
   * Picks a local nesting cell for an offspring clutch (parent cell or passable adjacent land cell)
   * using O(1) cell counts and exact Moore neighbor order for RNG parity.
   */
  private chooseNestCell(
    parentX: number,
    parentY: number,
    parentCellIdx: number,
    cellCounts: Uint32Array,
    rng: SeededRng,
    speciesIdx: number
  ): number {
    const localCount = cellCounts[parentCellIdx];
    if (localCount < 4) {
      return parentCellIdx;
    }

    let bestIdx = parentCellIdx;
    let bestLoad = localCount;
    const width = this.grid.width;
    const height = this.grid.height;
    const terrainCode = this.grid.terrainCode;
    const wrapX = this.effectiveWrapX;

    for (let k = 0; k < 8; k++) {
      let nx = parentX + MOORE_DX[k];
      const ny = parentY + MOORE_DY[k];
      if (ny < 0 || ny >= height) continue;
      if (wrapX) {
        nx = ((nx % width) + width) % width;
      } else if (nx < 0 || nx >= width) {
        continue;
      }
      const nIdx = ny * width + nx;
      if (nIdx === parentCellIdx) continue;
      if (this.spatial !== null) {
        if (!this.spatial.isHabitableCell(speciesIdx, nIdx)) continue;
      } else if (terrainCode[nIdx] <= 1) continue; // deep-water=0, shallow-water=1
      const load = cellCounts[nIdx];
      if (load < bestLoad || (load === bestLoad && rng.chance(0.35))) {
        bestLoad = load;
        bestIdx = nIdx;
      }
    }

    return bestIdx;
  }

  private findMateDraftFast(
    seekerId: number,
    seekerX: number,
    seekerY: number,
    seekerCellIdx: number,
    cellHead: Int32Array,
    cellNext: Int32Array,
    active: readonly Organism[],
    activeToDraft: Int32Array,
    unsortedIdToDraft: Map<number, number> | null
  ): number {
    let bestDraftIdx = -1;
    let bestOrgId = Infinity;
    const draftFlags = this.draftFlags;
    const draftOrgId = this.draftOrgId;
    const reqFlags = FLAG_ELIGIBLE;
    const forbidFlags = FLAG_DIED | FLAG_FEMALE;

    let idx = cellHead[seekerCellIdx];
    while (idx !== -1) {
      const cand = active[idx];
      if (cand.alive && cand.id !== seekerId && cand.sex !== 'female') {
        const candDraftIdx =
          unsortedIdToDraft === null
            ? activeToDraft[idx]
            : (unsortedIdToDraft.get(cand.id) ?? -1);
        if (candDraftIdx !== -1) {
          const flags = draftFlags[candDraftIdx];
          if ((flags & reqFlags) !== 0 && (flags & forbidFlags) === 0) {
            const candId = draftOrgId[candDraftIdx];
            if (candId < bestOrgId) {
              bestOrgId = candId;
              bestDraftIdx = candDraftIdx;
            }
          }
        }
      }
      idx = cellNext[idx];
    }

    if (bestDraftIdx !== -1) return bestDraftIdx;

    const width = this.grid.width;
    const height = this.grid.height;
    const wrapX = this.effectiveWrapX;
    for (let k = 0; k < 8; k++) {
      let nx = seekerX + MOORE_DX[k];
      const ny = seekerY + MOORE_DY[k];
      if (ny < 0 || ny >= height) continue;
      if (wrapX) {
        nx = ((nx % width) + width) % width;
      } else if (nx < 0 || nx >= width) {
        continue;
      }
      const nIdx = ny * width + nx;
      if (nIdx === seekerCellIdx) continue;
      let nCursor = cellHead[nIdx];
      while (nCursor !== -1) {
        const cand = active[nCursor];
        if (cand.alive && cand.id !== seekerId && cand.sex !== 'female') {
          const candDraftIdx =
            unsortedIdToDraft === null
              ? activeToDraft[nCursor]
              : (unsortedIdToDraft.get(cand.id) ?? -1);
          if (candDraftIdx !== -1) {
            const flags = draftFlags[candDraftIdx];
            if ((flags & reqFlags) !== 0 && (flags & forbidFlags) === 0) {
              const candId = draftOrgId[candDraftIdx];
              if (candId < bestOrgId) {
                bestOrgId = candId;
                bestDraftIdx = candDraftIdx;
              }
            }
          }
        }
        nCursor = cellNext[nCursor];
      }
    }

    return bestDraftIdx;
  }

  private findMateDraftWithCursor(
    seekerX: number,
    seekerY: number,
    seekerCellIdx: number,
    cellHead: Int32Array,
    cellNext: Int32Array,
    active: readonly Organism[],
    activeToDraft: Int32Array
  ): number {
    const draftFlags = this.draftFlags;
    const draftOrgId = this.draftOrgId;
    const reqFlags = FLAG_ELIGIBLE;
    const forbidFlags = FLAG_DIED | FLAG_FEMALE;
    const cursor = this.mateCellCursor;
    const touched = this.mateCellTouched;

    let idx = cursor[seekerCellIdx];
    if (idx === -2) {
      touched[this.mateTouchedCount++] = seekerCellIdx;
      idx = cellHead[seekerCellIdx];
      cursor[seekerCellIdx] = idx;
    }
    while (idx !== -1) {
      const cand = active[idx];
      if (cand.alive && cand.sex !== 'female') {
        const candDraftIdx = activeToDraft[idx];
        if (candDraftIdx !== -1) {
          const flags = draftFlags[candDraftIdx];
          if ((flags & reqFlags) !== 0 && (flags & forbidFlags) === 0) {
            cursor[seekerCellIdx] = idx;
            return candDraftIdx;
          }
        }
      }
      idx = cellNext[idx];
    }
    cursor[seekerCellIdx] = -1;

    let bestDraftIdx = -1;
    let bestOrgId = Infinity;
    const width = this.grid.width;
    const height = this.grid.height;
    const wrapX = this.effectiveWrapX;
    for (let k = 0; k < 8; k++) {
      let nx = seekerX + MOORE_DX[k];
      const ny = seekerY + MOORE_DY[k];
      if (ny < 0 || ny >= height) continue;
      if (wrapX) {
        nx = ((nx % width) + width) % width;
      } else if (nx < 0 || nx >= width) {
        continue;
      }
      const nIdx = ny * width + nx;
      if (nIdx === seekerCellIdx) continue;
      let nCursor = cursor[nIdx];
      if (nCursor === -2) {
        touched[this.mateTouchedCount++] = nIdx;
        nCursor = cellHead[nIdx];
        cursor[nIdx] = nCursor;
      }
      while (nCursor !== -1) {
        const cand = active[nCursor];
        if (cand.alive && cand.sex !== 'female') {
          const candDraftIdx = activeToDraft[nCursor];
          if (candDraftIdx !== -1) {
            const flags = draftFlags[candDraftIdx];
            if ((flags & reqFlags) !== 0 && (flags & forbidFlags) === 0) {
              cursor[nIdx] = nCursor;
              const candId = draftOrgId[candDraftIdx];
              if (candId < bestOrgId) {
                bestOrgId = candId;
                bestDraftIdx = candDraftIdx;
              }
              break;
            }
          }
        }
        nCursor = cellNext[nCursor];
      }
      if (nCursor === -1) {
        cursor[nIdx] = -1;
      }
    }

    return bestDraftIdx;
  }

  /**
   * Exposes unique neighbor cells visited for a coordinate (primarily for testing tiny/wrapX grids).
   */
  getNeighborCellIndices(x: number, y: number): number[] {
    const result: number[] = [];
    const centerIdx = this.grid.toIndex(x, y);
    this.grid.forEachNeighbor(
      x,
      y,
      (nIdx) => {
        if (nIdx !== centerIdx) {
          result.push(nIdx);
        }
      },
      { includeDiagonals: true, wrapX: this.effectiveWrapX }
    );
    return result;
  }

  private readRingBuffer<T>(buffer: readonly T[], head: number): T[] {
    const len = buffer.length;
    if (len === 0) return [];
    if (head === 0) return buffer.slice();
    const out = new Array<T>(len);
    const tailLen = len - head;
    for (let i = 0; i < tailLen; i++) {
      out[i] = buffer[head + i];
    }
    for (let i = 0; i < head; i++) {
      out[tailLen + i] = buffer[i];
    }
    return out;
  }

  private recordDeathListenerError(
    event: OrganismDeathEvent,
    listenerIndex: number,
    error: unknown
  ): void {
    this.totalDeathListenerErrors += 1;
    const record: DeathListenerError = Object.freeze({
      tick: event.tick,
      organismId: event.organismId,
      speciesId: event.speciesId,
      cause: event.cause,
      listenerIndex,
      error: createDiagnosticErrorSnapshot(error),
    });
    if (this.maxDeathListenerErrors > 0) {
      if (this.deathListenerErrors.length < this.maxDeathListenerErrors) {
        this.deathListenerErrors.push(record);
      } else {
        this.deathListenerErrors[this.deathListenerErrorHead] = record;
        this.deathListenerErrorHead = (this.deathListenerErrorHead + 1) % this.maxDeathListenerErrors;
      }
    }
    if (this.onDeathListenerError) {
      try {
        this.onDeathListenerError(record);
      } catch {
        // Error reporter exceptions must never break remaining listeners or corrupt tick state
      }
    }
  }

  private dispatchDeathEvent(event: OrganismDeathEvent): void {
    const immutableEvent = Object.isFrozen(event) ? event : Object.freeze(event);
    if (this.maxDeathEventHistory > 0) {
      if (this.deathEvents.length < this.maxDeathEventHistory) {
        this.deathEvents.push(immutableEvent);
      } else {
        this.deathEvents[this.deathEventHead] = immutableEvent;
        this.deathEventHead = (this.deathEventHead + 1) % this.maxDeathEventHistory;
      }
    }
    if (this.deathListeners.size > 0) {
      const listeners = Array.from(this.deathListeners);
      for (let i = 0; i < listeners.length; i++) {
        try {
          listeners[i](immutableEvent);
        } catch (error) {
          this.recordDeathListenerError(immutableEvent, i, error);
        }
      }
    }
  }

  /**
   * Subscribes to `OrganismDeathEvent` notifications emitted in `POST_COMMIT` prior to compaction.
   */
  onDeath(listener: OrganismDeathListener): () => void {
    this.deathListeners.add(listener);
    return () => {
      this.deathListeners.delete(listener);
    };
  }

  getDeathEvents(): readonly OrganismDeathEvent[] {
    return this.readRingBuffer(this.deathEvents, this.deathEventHead);
  }

  getDeathListenerErrors(): readonly DeathListenerError[] {
    return this.readRingBuffer(this.deathListenerErrors, this.deathListenerErrorHead);
  }

  getTotalDeathListenerErrors(): number {
    return this.totalDeathListenerErrors;
  }

  clearDeathListenerErrors(): void {
    this.deathListenerErrors.length = 0;
    this.deathListenerErrorHead = 0;
  }

  /**
   * Applies an external mortality cause (`predation`, `injury`, `disease`, etc.) atomically:
   * transfers remaining `STRUCT + RESERVE` to `CELL_CARRION`, records death, dispatches frozen
   * `OrganismDeathEvent`, and compacts dead organisms when outer nesting finishes.
   */
  killOrganism(
    speciesId: string,
    organismId: number,
    cause: DeathCause,
    killerId: number | null = null
  ): OrganismDeathEvent | null {
    const validCause = validateDeathCauseStrict(cause);
    const pop = this.populations.get(speciesId);
    if (!pop) return null;
    const org = pop.getById(organismId);
    if (!org || !org.alive) return null;

    const slot = this.organismIdToSlot.get(org.id);
    if (slot !== undefined) {
      const structQ = this.entityStore.structMassQ(slot);
      const reserveQ = this.entityStore.reserveMassQ(slot);
      if (structQ > 0 || reserveQ > 0) {
        const tx = this.ledger.begin(this.tickCount);
        try {
          stageDeathToCarrion(tx, slot, org.cellIndex, structQ, reserveQ);
          tx.prepare();
          tx.commit();
        } catch (err) {
          if (tx.state === 'ACTIVE' || tx.state === 'PREPARED') {
            tx.abort();
          }
          throw err;
        }
      }
    }

    this.killDepth += 1;
    this.pendingCompactPops.add(pop);
    try {
      return processOrganismDeath(org, this.tickCount, validCause, killerId, (event) => {
        pop.recordDeath(event.cause);
        this.dispatchDeathEvent(event);
      });
    } finally {
      this.killDepth -= 1;
      if (this.killDepth === 0 && !this.isPostCommit) {
        for (const pendingPop of this.pendingCompactPops) {
          pendingPop.compactDead((deadOrg) => this.releaseOrganismSlot(deadOrg.id));
          this.pendingCompactPops.delete(pendingPop);
        }
      }
    }
  }

  private getCanonicalOrderedOrganisms(pop: PopulationManager): Organism[] {
    const raw = pop.getActiveOrganisms();
    const len = raw.length;
    if (len <= 1) return raw as Organism[];
    let sorted = true;
    let prevId = -1;
    for (let i = 0; i < len; i++) {
      const id = raw[i].id;
      if (id < prevId) {
        sorted = false;
        break;
      }
      prevId = id;
    }
    if (sorted) return raw as Organism[];
    return [...raw].sort((a, b) => a.id - b.id);
  }

  private isPreySpeciesForPredator(
    predatorProfile: TrophicProfile,
    predatorSpeciesId: string,
    candidateProfile: TrophicProfile,
    candidateSpeciesId: string
  ): boolean {
    if (candidateSpeciesId === predatorSpeciesId) return false;
    if (
      candidateProfile.feedingType === 'herbivore' ||
      candidateProfile.feedingType === 'detritivore' ||
      candidateProfile.feedingType === 'scavenger'
    ) {
      return true;
    }
    if (
      candidateProfile.feedingType === 'omnivore' &&
      predatorProfile.adultStructuralMassMU >= candidateProfile.adultStructuralMassMU * 0.9
    ) {
      return true;
    }
    return false;
  }

  private ensureSpeciesCaches(speciesList: readonly SpeciesDefinition[]): SpeciesRuntimeCache[] {
    const sCount = speciesList.length;
    let valid = this.speciesCacheList.length === sCount;
    if (valid) {
      for (let i = 0; i < sCount; i++) {
        if (this.speciesCacheList[i].species !== speciesList[i]) {
          valid = false;
          break;
        }
      }
    }
    if (valid) return this.speciesCacheList;

    const list: SpeciesRuntimeCache[] = new Array(sCount);
    for (let i = 0; i < sCount; i++) {
      const sp = speciesList[i];
      const profile = this.speciesRegistry.getTrophicProfile(sp.id);
      const pq = computeProfileQuanta(profile);
      const dietPpm = this.getSpeciesDietPpm(sp);
      const schema = sp.genomeSchema;
      const idx = getPhysiologyIndices(schema);
      const base = sp.traitBaselines;
      const phys = sp.physiology;
      const lc = sp.lifecycle;
      const rep = sp.reproduction;
      const tpy = sp.timeScale.ticksPerBiologicalYear;
      const incubationBio = lc.incubationTicks / tpy;
      const maturityBio = (lc.incubationTicks + lc.juvenileTicks) / tpy;
      const elderBio = lc.elderAgeTicks / tpy;
      const eggStructMassQ = computeTargetStructMassQ(profile, 0.15);
      const eggMaxReserveMassQ = computeMaxReserveMassQ(eggStructMassQ, profile);
      const eggReserveMassQ = Math.max(
        1,
        applyPpm(eggMaxReserveMassQ, fractionToPpm(rep.eggInitialEnergy, 'half-even'), 'floor')
      );
      const eggActualInitNorm = eggMaxReserveMassQ > 0 ? eggReserveMassQ / eggMaxReserveMassQ : 0;
      const mutCfg = this.mutationConfigOverride ?? sp.mutation;

      list[i] = {
        species: sp,
        schema,
        locusCount: schema.locusCount,
        profile,
        pq,
        dietPpm,
        effAbsorptionAssimPpm: Math.max(
          1,
          Math.round(profile.absorptionEfficiency * profile.assimilationEfficiency * LOCAL_PPM)
        ),
        idx,
        baseStrength: base.strength ?? 1.0,
        baseSpeed: base.speed ?? 1.0,
        baseEndurance: base.endurance ?? 1.0,
        basePerception: base.perception ?? 1.0,
        baseIntelligence: base.intelligence ?? 1.0,
        baseHeatTolerance: base.heatTolerance ?? 1.0,
        baseColdTolerance: base.coldTolerance ?? 1.0,
        baseMetabolismEfficiency: base.metabolismEfficiency ?? 1.0,
        baseEnvironmentalAdaptability: base.environmentalAdaptability ?? 0.9,
        basalFactor: profile.basalMetabolicFactor,
        thermoFactor: profile.thermoregulationFactor,
        activityFactor: profile.activityCostFactor,
        optTemp: phys.optimalTemperatureC,
        halfWidth: phys.baseThermalHalfWidthC,
        thermalDamagePerTick: phys.thermalDamagePerTick,
        starvationDamagePerTick: phys.starvationDamagePerTick,
        healingPerTick: phys.healingPerTick,
        maxForageIntakePerTick: phys.maxForageIntakePerTick,
        eggIncubationCostPerTick: phys.eggIncubationCostPerTick,
        incubationTicks: lc.incubationTicks,
        juvenileTicks: lc.juvenileTicks,
        maturityAge: lc.incubationTicks + lc.juvenileTicks,
        elderAgeTicks: lc.elderAgeTicks,
        maxLifespanTicks: lc.maxLifespanTicks,
        hatchlingPhysicalScale: lc.hatchlingPhysicalScale,
        tpy,
        incubationBio,
        maturityBio,
        juvenileBioSpan: maturityBio - incubationBio,
        elderBio,
        minBioStep: 1 / tpy,
        elderLifeFloor: lc.elderAgeTicks + 5,
        cooldownTicks: rep.cooldownTicks,
        elderCooldown: Math.max(2, Math.floor(rep.cooldownTicks * 0.25)),
        minEnergyToReproduce: rep.minEnergyToReproduce,
        minHealthToReproduce: rep.minHealthToReproduce,
        clutchSizeMin: rep.clutchSizeMin,
        clutchSizeMax: rep.clutchSizeMax,
        femaleProbability: rep.femaleProbability,
        elderFertilityMultiplier: rep.elderFertilityMultiplier,
        eggStructMassQ,
        eggMaxReserveMassQ,
        eggReserveMassQ,
        eggActualInitNorm,
        mutationPlan: compileMutationPlan(schema, sp.traitRanges, mutCfg),
        mutationConfig: mutCfg,
        anatomyBaselinePerf: computeAnatomyPerformanceInto(getSpeciesBaselineAnatomy(sp), createAnatomyPerformance()),
        scratchPhenotype: this.getScratchPhenotype(sp),
      };
    }

    const preyMatrix = new Uint8Array(sCount * sCount);
    for (let p = 0; p < sCount; p++) {
      for (let v = 0; v < sCount; v++) {
        preyMatrix[p * sCount + v] = this.isPreySpeciesForPredator(
          list[p].profile,
          list[p].species.id,
          list[v].profile,
          list[v].species.id
        )
          ? 1
          : 0;
      }
    }

    // Which species pairs may attempt to interbreed (evolution mode with hybridization)
    const clade = new Uint8Array(sCount * sCount);
    if (this.evolution !== null && this.evolution.enableHybridization) {
      for (let f = 0; f < sCount; f++) {
        for (let m = 0; m < sCount; m++) {
          clade[f * sCount + m] =
            f === m || areSpeciesCladeCompatible(list[f].species, list[m].species, this.phylogeny ?? undefined) ? 1 : 0;
        }
      }
    }
    this.cladeCompatMatrix = clade;

    this.speciesCacheList = list;
    this.speciesPreyMatrix = preyMatrix;
    if (this.spatial !== null) {
      this.spatial.configureSpecies(list, preyMatrix);
    }
    return list;
  }

  /** Index of `species` in the registry order used by the spatial system (spatial mode only). */
  private resolveSpatialSpeciesIndex(species: SpeciesDefinition): number {
    const list = this.speciesRegistry.list();
    this.ensureSpeciesCaches(list);
    const idx = list.indexOf(species);
    if (idx < 0) {
      throw new RangeError(`Species "${species.id}" is not registered`);
    }
    return idx;
  }

  private ensureDraftCapacity(needed: number): void {
    if (needed <= this.draftCap) return;
    let nextCap = Math.max(256, this.draftCap);
    while (nextCap < needed) nextCap *= 2;
    this.draftCap = nextCap;

    const growObj = <T>(old: T[], len: number): T[] => {
      const next = new Array<T>(len);
      for (let i = 0; i < old.length; i++) next[i] = old[i];
      return next;
    };
    const growI32 = (old: Int32Array) => {
      const next = new Int32Array(nextCap);
      next.set(old);
      return next;
    };
    const growU32 = (old: Uint32Array) => {
      const next = new Uint32Array(nextCap);
      next.set(old);
      return next;
    };
    const growU16 = (old: Uint16Array) => {
      const next = new Uint16Array(nextCap);
      next.set(old);
      return next;
    };
    const growU8 = (old: Uint8Array) => {
      const next = new Uint8Array(nextCap);
      next.set(old);
      return next;
    };
    const growF64 = (old: Float64Array) => {
      const next = new Float64Array(nextCap);
      next.set(old);
      return next;
    };

    this.draftOrg = growObj(this.draftOrg, nextCap);
    this.draftPop = growObj(this.draftPop, nextCap);
    this.draftDeathCause = growObj(this.draftDeathCause, nextCap);
    this.draftSlot = growI32(this.draftSlot);
    this.draftCellIndex = growU32(this.draftCellIndex);
    this.draftOrgId = growF64(this.draftOrgId);
    this.draftSpeciesIdx = growU16(this.draftSpeciesIdx);
    this.draftNextAgeTicks = growI32(this.draftNextAgeTicks);
    this.draftNextStage = growU8(this.draftNextStage);
    this.draftNextCooldown = growI32(this.draftNextCooldown);
    this.draftFlags = growU8(this.draftFlags);
    this.draftKillerId = growF64(this.draftKillerId);
    this.draftOffspringDelta = growU32(this.draftOffspringDelta);
    this.draftStructMassQ = growF64(this.draftStructMassQ);
    this.draftReserveMassQ = growF64(this.draftReserveMassQ);
    this.draftMaxReserveMassQ = growF64(this.draftMaxReserveMassQ);
    this.draftCarryCreditQ = growF64(this.draftCarryCreditQ);
    this.draftExternalDeltaQ = growF64(this.draftExternalDeltaQ);
    this.draftMetabolicDemandQ = growF64(this.draftMetabolicDemandQ);
    this.draftHealingDemandQ = growF64(this.draftHealingDemandQ);
    this.draftBurnMassQ = growF64(this.draftBurnMassQ);
    this.draftPostMetabResQ = growF64(this.draftPostMetabResQ);
    this.draftPostMetabCarryQ = growF64(this.draftPostMetabCarryQ);
    this.draftReqPlantQ = growF64(this.draftReqPlantQ);
    this.draftReqPreyQ = growF64(this.draftReqPreyQ);
    this.draftReqCarrionQ = growF64(this.draftReqCarrionQ);
    this.draftReqDetritusQ = growF64(this.draftReqDetritusQ);
    this.draftReqLegacyNorm = growF64(this.draftReqLegacyNorm);
    this.draftGrantPlantQ = growF64(this.draftGrantPlantQ);
    this.draftGrantPreyQ = growF64(this.draftGrantPreyQ);
    this.draftGrantCarrionQ = growF64(this.draftGrantCarrionQ);
    this.draftGrantDetritusQ = growF64(this.draftGrantDetritusQ);
    this.draftNextEnergy = growF64(this.draftNextEnergy);
    this.draftNextHealth = growF64(this.draftNextHealth);
    this.draftGrowthTargetStructQ = growF64(this.draftGrowthTargetStructQ);
    this.draftDevPhys = growF64(this.draftDevPhys);
    this.draftDevNeural = growF64(this.draftDevNeural);
    this.draftDevSenesc = growF64(this.draftDevSenesc);
    this.draftThermalStress = growF64(this.draftThermalStress);
    this.draftEndurance = growF64(this.draftEndurance);
    this.draftGrowthScale = growF64(this.draftGrowthScale);
    this.draftRecoveryScale = growF64(this.draftRecoveryScale);
    this.draftCanonicalOrder = growI32(this.draftCanonicalOrder);

    this.plantNextDraft = new Int32Array(nextCap);
    this.carrionNextDraft = new Int32Array(nextCap);
    this.detritusNextDraft = new Int32Array(nextCap);
    this.preyNextDraft = new Int32Array(nextCap);
    this.aliveNextDraft = new Int32Array(nextCap);
    this.preyRemStructQ = growF64(this.preyRemStructQ);
    this.preyRemReserveQ = growF64(this.preyRemReserveQ);
    this.preyRemTouched = growU8(this.preyRemTouched);
  }

  private ensureResolveScratch(needed: number): void {
    if (needed <= this.resolveScratchDemands.length) return;
    let cap = Math.max(64, this.resolveScratchDemands.length);
    while (cap < needed) cap *= 2;
    this.resolveScratchDemands = new Float64Array(cap);
    this.resolveScratchOrgIds = new Float64Array(cap);
    this.resolveScratchGrants = new Float64Array(cap);
    this.resolveScratchDraftIdx = new Int32Array(cap);
    this.bgPreyScratchDraftIdx = new Int32Array(cap);
  }

  private ensurePredBiteCapacity(needed: number): void {
    if (needed <= this.predBiteCap) return;
    let nextCap = Math.max(64, this.predBiteCap);
    while (nextCap < needed) nextCap *= 2;
    this.predBiteCap = nextCap;
    const nPred = new Int32Array(nextCap);
    nPred.set(this.predBitePredDraft);
    this.predBitePredDraft = nPred;
    const nPrey = new Int32Array(nextCap);
    nPrey.set(this.predBitePreyDraft);
    this.predBitePreyDraft = nPrey;
    const nMass = new Float64Array(nextCap);
    nMass.set(this.predBiteMassQ);
    this.predBiteMassQ = nMass;
  }

  private ensureReproPlanCapacity(needed: number): void {
    if (needed <= this.rpCap) return;
    let nextCap = Math.max(64, this.rpCap);
    while (nextCap < needed) nextCap *= 2;
    this.rpCap = nextCap;
    const growI = (o: Int32Array) => { const n = new Int32Array(nextCap); n.set(o); return n; };
    const growU8 = (o: Uint8Array) => { const n = new Uint8Array(nextCap); n.set(o); return n; };
    const growU16 = (o: Uint16Array) => { const n = new Uint16Array(nextCap); n.set(o); return n; };
    const growF = (o: Float64Array) => { const n = new Float64Array(nextCap); n.set(o); return n; };
    this.rpFemaleDraft = growI(this.rpFemaleDraft);
    this.rpMaleDraft = growI(this.rpMaleDraft);
    this.rpStatus = growU8(this.rpStatus);
    this.rpFemaleCd = growI(this.rpFemaleCd);
    this.rpMaleCd = growI(this.rpMaleCd);
    this.rpFatherMatingDemandQ = growF(this.rpFatherMatingDemandQ);
    this.rpEggStart = growI(this.rpEggStart);
    this.rpEggCount = growU16(this.rpEggCount);
  }

  private ensureEggPlanCapacity(needed: number): void {
    if (needed <= this.eggCap) return;
    let nextCap = Math.max(64, this.eggCap);
    while (nextCap < needed) nextCap *= 2;
    this.eggCap = nextCap;
    const nextOrg = new Array<Organism>(nextCap);
    for (let i = 0; i < this.eggOrg.length; i++) nextOrg[i] = this.eggOrg[i];
    this.eggOrg = nextOrg;
    const nextMut = new Array<readonly MutationRecord[] | undefined>(nextCap);
    for (let i = 0; i < this.eggMutationRecords.length; i++) nextMut[i] = this.eggMutationRecords[i];
    this.eggMutationRecords = nextMut;
    const growI = (o: Int32Array) => { const n = new Int32Array(nextCap); n.set(o); return n; };
    const growU8 = (o: Uint8Array) => { const n = new Uint8Array(nextCap); n.set(o); return n; };
    const growU16 = (o: Uint16Array) => { const n = new Uint16Array(nextCap); n.set(o); return n; };
    this.eggSpeciesIdx = growU16(this.eggSpeciesIdx);
    this.eggDraftSlot = growI(this.eggDraftSlot);
    this.eggIsReused = growU8(this.eggIsReused);
    this.eggProvisioned = growU8(this.eggProvisioned);
    this.eggFatherSpeciesIdx = growI(this.eggFatherSpeciesIdx);
    const growF32 = (o: Float32Array) => { const n = new Float32Array(nextCap); n.set(o); return n; };
    this.eggHybridViability = growF32(this.eggHybridViability);
    this.eggHybridFertility = growF32(this.eggHybridFertility);
    this.eggHybridBackcross = growU8(this.eggHybridBackcross);
    this.slotPlanSlots = new Int32Array(nextCap);
    this.slotPlanReused = new Uint8Array(nextCap);
  }

  private ensureStepSpeciesCapacity(sCount: number): void {
    if (sCount > this.stepSpeciesCap) {
      let nextCap = Math.max(8, this.stepSpeciesCap);
      while (nextCap < sCount) nextCap *= 2;
      this.stepSpeciesCap = nextCap;
      this.stepPopBySpeciesIdx = new Array<PopulationManager | null>(nextCap).fill(null);
      this.stepSpeciesDraftStart = new Int32Array(nextCap);
      this.stepSpeciesDraftEnd = new Int32Array(nextCap);
      this.stepSpeciesWasCanonical = new Uint8Array(nextCap);
      this.stepSpeciesActiveMapOffsets = new Int32Array(nextCap);
      this.stepUnsortedIdToDraftMaps = new Array<Map<number, number> | null>(nextCap).fill(null);
      this.stepSpeciesEligibleCounts = new Int32Array(nextCap);
      this.stepSpeciesEggStart = new Int32Array(nextCap);
      this.stepSpeciesEggCount = new Int32Array(nextCap);
    }
    this.stepTouchedPops.length = 0;
    for (let s = 0; s < sCount; s++) {
      this.stepPopBySpeciesIdx[s] = null;
      this.stepUnsortedIdToDraftMaps[s] = null;
      this.stepSpeciesEligibleCounts[s] = 0;
      this.stepSpeciesEggStart[s] = 0;
      this.stepSpeciesEggCount[s] = 0;
    }
  }

  private gatherSingleSpeciesDrafts(
    s: number,
    pop: PopulationManager,
    sc: SpeciesRuntimeCache,
    isLegacyMode: boolean,
    hasStrictFoodSources: boolean,
    legacySnapshotAvailable: Map<number, number> | null,
    targetTick: number,
    entityStructFront: Float64Array | null,
    entityReserveFront: Float64Array | null,
    activeMapOffsetRef: { value: number }
  ): void {
    const species = sc.species;
    const schema = sc.schema;
    const pq = sc.pq;
    const maxReserveRatioScaled = pq.maxReserveRatioScaled;
    const dietPpm = sc.dietPpm;
    const plantPpm = dietPpm.plantPpm;
    const preyPpm = dietPpm.preyPpm;
    const carrionPpm = dietPpm.carrionPpm;
    const detritusPpm = dietPpm.detritusPpm;
    const effAbsorptionAssimPpm = sc.effAbsorptionAssimPpm;
    const modKinds = schema.traitModKind;

    const entityStore = this.entityStore;
    const gridWidth = this.grid.width;
    const gridTemps = this.grid.temperature;
    const organismIdToSlot = this.organismIdToSlot;
    const slotCarryCreditQ = this.slotCarryCreditQ;
    const slotLastSyncedEnergy = this.slotLastSyncedEnergy;

    const draftOrg = this.draftOrg;
    const draftPop = this.draftPop;
    const draftDeathCause = this.draftDeathCause;
    const draftSlot = this.draftSlot;
    const draftCellIndex = this.draftCellIndex;
    const draftOrgId = this.draftOrgId;
    const draftSpeciesIdx = this.draftSpeciesIdx;
    const draftNextAgeTicks = this.draftNextAgeTicks;
    const draftNextStage = this.draftNextStage;
    const draftNextCooldown = this.draftNextCooldown;
    const draftFlags = this.draftFlags;
    const draftKillerId = this.draftKillerId;
    const draftOffspringDelta = this.draftOffspringDelta;
    const draftStructMassQ = this.draftStructMassQ;
    const draftReserveMassQ = this.draftReserveMassQ;
    const draftMaxReserveMassQ = this.draftMaxReserveMassQ;
    const draftCarryCreditQ = this.draftCarryCreditQ;
    const draftExternalDeltaQ = this.draftExternalDeltaQ;
    const draftMetabolicDemandQ = this.draftMetabolicDemandQ;
    const draftHealingDemandQ = this.draftHealingDemandQ;
    const draftBurnMassQ = this.draftBurnMassQ;
    const draftPostMetabResQ = this.draftPostMetabResQ;
    const draftPostMetabCarryQ = this.draftPostMetabCarryQ;
    const draftReqPlantQ = this.draftReqPlantQ;
    const draftReqPreyQ = this.draftReqPreyQ;
    const draftReqCarrionQ = this.draftReqCarrionQ;
    const draftReqDetritusQ = this.draftReqDetritusQ;
    const draftReqLegacyNorm = this.draftReqLegacyNorm;
    const draftGrantPlantQ = this.draftGrantPlantQ;
    const draftGrantPreyQ = this.draftGrantPreyQ;
    const draftGrantCarrionQ = this.draftGrantCarrionQ;
    const draftGrantDetritusQ = this.draftGrantDetritusQ;
    const draftNextEnergy = this.draftNextEnergy;
    const draftNextHealth = this.draftNextHealth;
    const draftGrowthTargetStructQ = this.draftGrowthTargetStructQ;
    const draftDevPhys = this.draftDevPhys;
    const draftDevNeural = this.draftDevNeural;
    const draftDevSenesc = this.draftDevSenesc;
    const draftThermalStress = this.draftThermalStress;
    const draftEndurance = this.draftEndurance;
    const draftCanonicalOrder = this.draftCanonicalOrder;
    const activeIdxToDraftIdx = this.activeIdxToDraftIdx;

    const rawOrgs = pop.getActiveOrganisms();
    const orderedOrgs = this.getCanonicalOrderedOrganisms(pop);
    const isPopSorted = orderedOrgs === rawOrgs;
    this.stepSpeciesWasCanonical[s] = isPopSorted ? 1 : 0;
    const mapOffset = activeMapOffsetRef.value;
    this.stepSpeciesActiveMapOffsets[s] = mapOffset;
    let unsortedMap: Map<number, number> | null = null;
    if (isPopSorted) {
      activeIdxToDraftIdx.fill(-1, mapOffset, mapOffset + rawOrgs.length);
      activeMapOffsetRef.value = mapOffset + rawOrgs.length;
    } else {
      unsortedMap = new Map<number, number>();
      this.stepUnsortedIdToDraftMaps[s] = unsortedMap;
    }

    this.stepSpeciesDraftStart[s] = this.curDraftCount;

    const incubationTicks = sc.incubationTicks;
    const maturityAge = sc.maturityAge;
    const elderAgeTicks = sc.elderAgeTicks;
    const adultMassQ = pq.adultMassQ;
    const hatchScale = sc.hatchlingPhysicalScale;
    const tpy = sc.tpy;
    const incubationBio = sc.incubationBio;
    const maturityBio = sc.maturityBio;
    const juvenileBioSpan = sc.juvenileBioSpan;
    const elderBio = sc.elderBio;
    const maxBio = sc.maxLifespanTicks / tpy;
    const minBioStep = sc.minBioStep;
    const maxForageIntake = sc.maxForageIntakePerTick;
    const eggIncubCost = sc.eggIncubationCostPerTick;
    const optTemp = sc.optTemp;
    const halfWidth = sc.halfWidth;
    const basalFactor = sc.basalFactor;
    const thermoFactor = sc.thermoFactor;
    const activityFactor = sc.activityFactor;
    const pIdx = sc.idx;
    const idxStrength = pIdx.strength;
    const idxSpeed = pIdx.speed;
    const idxEndurance = pIdx.endurance;
    const idxPerception = pIdx.perception;
    const idxIntelligence = pIdx.intelligence;
    const idxHeatTol = pIdx.heatTolerance;
    const idxColdTol = pIdx.coldTolerance;
    const idxMetEff = pIdx.metabolismEfficiency;
    const idxAdapt = pIdx.environmentalAdaptability;
    const anatomyPhysiology = this.anatomyPhysiology;
    const physioTradeOffs = this.physioTradeOffs;
    const anatomyPerf = this.anatomyPerfScratch;
    const draftGrowthScale = this.draftGrowthScale;
    const draftRecoveryScale = this.draftRecoveryScale;

    let localDraftCount = this.curDraftCount;
    let localGloballySorted = this.curGloballySorted;
    let localPrevGlobalId = this.curPrevGlobalId;

    const isStandardCoreLoci =
      schema.isCoreModPattern &&
      idxStrength === 1 &&
      idxSpeed === 2 &&
      idxEndurance === 3 &&
      idxPerception === 4 &&
      idxIntelligence === 5 &&
      idxHeatTol === 6 &&
      idxColdTol === 7 &&
      idxMetEff === 8 &&
      idxAdapt === 9;

    const ordLen = orderedOrgs.length;
    for (let i = 0; i < ordLen; i++) {
      const org = orderedOrgs[i];
      if (!org.alive) continue;

      const orgId = org.id;
      const slot = organismIdToSlot.get(orgId);
      if (slot === undefined) {
        throw new Error(`Organism ${orgId} (${species.id}) is missing an EntityEnergyStore slot`);
      }

      const dIdx = localDraftCount++;
      draftCanonicalOrder[dIdx] = dIdx;
      if (orgId < localPrevGlobalId) {
        localGloballySorted = false;
      }
      localPrevGlobalId = orgId;

      if (isPopSorted) {
        activeIdxToDraftIdx[mapOffset + i] = dIdx;
      } else {
        unsortedMap!.set(orgId, dIdx);
      }

      const cellIdx = org.cellIndex;
      const structMassQ = entityStructFront !== null ? entityStructFront[slot] : entityStore.structMassQ(slot);
      let reserveMassQ = entityReserveFront !== null ? entityReserveFront[slot] : entityStore.reserveMassQ(slot);
      const ratioProd = structMassQ * maxReserveRatioScaled;
      const maxReserveMassQ =
        ratioProd <= LOCAL_MAX_SAFE_INT
          ? (ratioProd - (ratioProd % LOCAL_PPM)) / LOCAL_PPM
          : _scaleByRatio(structMassQ, maxReserveRatioScaled, LOCAL_PPM, 'floor');
      const carryCreditQ = slotCarryCreditQ[slot];
      let externalDeltaQ = 0;

      if (isLegacyMode) {
        const lastSynced = slotLastSyncedEnergy[slot];
        if (Math.abs(org.energy - lastSynced) > 1e-9) {
          const clamped = Math.min(1, Math.max(0, org.energy));
          const desiredReserveQ = applyPpmFloorFast(
            maxReserveMassQ,
            _fractionToPpmHalfEvenFast(clamped)
          );
          externalDeltaQ = desiredReserveQ - reserveMassQ;
          reserveMassQ = desiredReserveQ;
        }
      }

      const nextAgeTicks = org.ageTicks + 1;
      const nextCooldown = org.reproductionCooldown > 0 ? org.reproductionCooldown - 1 : 0;
      let nextStageCode = stageToCode(org.stage);
      if (nextStageCode === STAGE_EGG && nextAgeTicks >= incubationTicks) {
        nextStageCode = STAGE_JUVENILE;
      } else if (nextStageCode === STAGE_JUVENILE && nextAgeTicks >= maturityAge) {
        nextStageCode = STAGE_ADULT;
      } else if (nextStageCode === STAGE_ADULT && nextAgeTicks >= elderAgeTicks) {
        nextStageCode = STAGE_ELDER;
      }

      const isEgg = nextStageCode === STAGE_EGG;
      let devPhysicalScale: number;
      let devNeuralScale: number;
      let devSenescenceScale: number;
      if (isEgg) {
        devPhysicalScale = 0.15;
        devNeuralScale = 0.15;
        devSenescenceScale = 1.0;
      } else {
        const bioAge = nextAgeTicks / tpy;
        if (nextStageCode === STAGE_JUVENILE) {
          const t = juvenileBioSpan > 0 ? Math.min(1, Math.max(0, (bioAge - incubationBio) / juvenileBioSpan)) : 1;
          devPhysicalScale = hatchScale + (1 - hatchScale) * t;
          devNeuralScale = 0.45 + 0.55 * t;
          devSenescenceScale = 1.0;
        } else if (nextStageCode === STAGE_ELDER) {
          const elderBioSpan = Math.max(minBioStep, maxBio - elderBio);
          const t = Math.min(1, Math.max(0, (bioAge - elderBio) / elderBioSpan));
          devPhysicalScale = 1.0;
          devNeuralScale = 1.0;
          devSenescenceScale = 1.0 - 0.18 * t;
        } else if (bioAge < maturityBio && maturityBio > 0) {
          const t = Math.max(0, bioAge / maturityBio);
          devPhysicalScale = hatchScale + (1 - hatchScale) * t;
          devNeuralScale = 0.45 + 0.55 * t;
          devSenescenceScale = 1.0;
        } else {
          devPhysicalScale = 1.0;
          devNeuralScale = 1.0;
          devSenescenceScale = 1.0;
        }
      }

      const currentNormEnergy = maxReserveMassQ > 0 ? reserveMassQ / maxReserveMassQ : 0;
      const condScale =
        0.45 + 0.55 * Math.min(1, Math.max(0, org.health * 0.65 + currentNormEnergy * 0.35));
      const modPhys = devPhysicalScale * devSenescenceScale * condScale;
      const modNeur = devNeuralScale * (0.75 + 0.25 * condScale);
      const modOther = (0.65 + 0.35 * devPhysicalScale) * (0.85 + 0.15 * condScale);

      const genome = org.genome;
      const gMat = genome.maternalAlleles;
      const gPat = genome.paternalAlleles;
      const gDom = genome.dominance;

      const envTemp = gridTemps[cellIdx];
      let heatTol: number;
      let coldTol: number;
      let adapt: number;
      if (isStandardCoreLoci) {
        let a = gMat[6], b = gPat[6];
        heatTol = Math.fround((a <= b ? a + (b - a) * gDom[6] : b + (a - b) * gDom[6]) * modOther);
        a = gMat[7]; b = gPat[7];
        coldTol = Math.fround((a <= b ? a + (b - a) * gDom[7] : b + (a - b) * gDom[7]) * modOther);
        a = gMat[9]; b = gPat[9];
        adapt = Math.fround((a <= b ? a + (b - a) * gDom[9] : b + (a - b) * gDom[9]) * modOther);
      } else {
        heatTol =
          idxHeatTol >= 0
            ? expressTraitF32(gMat, gPat, gDom, modKinds, idxHeatTol, modPhys, modNeur, modOther)
            : sc.baseHeatTolerance;
        coldTol =
          idxColdTol >= 0
            ? expressTraitF32(gMat, gPat, gDom, modKinds, idxColdTol, modPhys, modNeur, modOther)
            : sc.baseColdTolerance;
        adapt =
          idxAdapt >= 0
            ? expressTraitF32(gMat, gPat, gDom, modKinds, idxAdapt, modPhys, modNeur, modOther)
            : sc.baseEnvironmentalAdaptability;
      }
      let upperLimit = optTemp + halfWidth + heatTol * 7.5 + adapt * 3.5;
      let lowerLimit = optTemp - halfWidth - coldTol * 8.0 - adapt * 3.5;
      // Evolution mode: heritable anatomy shifts thermal tolerance and metabolic upkeep relative to
      // the species baseline anatomy (insulation helps in the cold and hurts in the heat, armour
      // and large heads cost energy). The energy accounting itself is unchanged.
      let anatomyMetabolicScale = 1;
      let anatomyMaintenanceScale = 1;
      let anatomyIntakeScale = 1;
      let anatomyGrowthScale = 1;
      let anatomyRecoveryScale = 1;
      if (anatomyPhysiology && org.anatomy !== undefined) {
        if (physioTradeOffs) {
          // Evolutionary physiology: tissue upkeep scales the basal term only; BMR also sets heat
          // production, food-processing capacity, growth and recovery (see AnatomyPhysiology)
          const phys = getRelativeAnatomyPhysiology(org.anatomy, species);
          upperLimit += phys.heatOffsetC;
          lowerLimit -= phys.coldOffsetC;
          anatomyMaintenanceScale = phys.maintenanceScale;
          anatomyIntakeScale = phys.intakeCapacityScale;
          anatomyGrowthScale = phys.growthScale;
          anatomyRecoveryScale = phys.recoveryScale;
        } else {
          const perf = computeRelativeAnatomyPerformanceInto(org.anatomy, sc.anatomyBaselinePerf, anatomyPerf);
          upperLimit += perf.heatOffsetC;
          lowerLimit -= perf.coldOffsetC;
          anatomyMetabolicScale = perf.metabolicScale;
        }
      }
      draftGrowthScale[dIdx] = anatomyGrowthScale;
      draftRecoveryScale[dIdx] = anatomyRecoveryScale;
      const thermalStress =
        envTemp > upperLimit
          ? (envTemp - upperLimit) / 10
          : envTemp < lowerLimit
            ? (lowerLimit - envTemp) / 10
            : 0;

      let foragePower = 0;
      let metabolicDemandQ = 0;
      let endurance = 1;
      if (isEgg) {
        const eggCostEU = eggIncubCost * (maxReserveMassQ / LOCAL_PPM) * 30 + thermalStress * 0.45;
        metabolicDemandQ = _euToQHalfEvenFast(Math.max(0, eggCostEU));
      } else {
        let strength: number;
        let speed: number;
        let perception: number;
        let intelligence: number;
        let metEff: number;
        if (isStandardCoreLoci) {
          let a = gMat[1], b = gPat[1];
          strength = Math.fround((a <= b ? a + (b - a) * gDom[1] : b + (a - b) * gDom[1]) * modPhys);
          a = gMat[2]; b = gPat[2];
          speed = Math.fround((a <= b ? a + (b - a) * gDom[2] : b + (a - b) * gDom[2]) * modPhys);
          a = gMat[3]; b = gPat[3];
          endurance = Math.fround((a <= b ? a + (b - a) * gDom[3] : b + (a - b) * gDom[3]) * modPhys);
          a = gMat[4]; b = gPat[4];
          perception = Math.fround((a <= b ? a + (b - a) * gDom[4] : b + (a - b) * gDom[4]) * modNeur);
          a = gMat[5]; b = gPat[5];
          intelligence = Math.fround((a <= b ? a + (b - a) * gDom[5] : b + (a - b) * gDom[5]) * modNeur);
          a = gMat[8]; b = gPat[8];
          metEff = Math.fround((a <= b ? a + (b - a) * gDom[8] : b + (a - b) * gDom[8]) * modOther);
        } else {
          endurance =
            idxEndurance >= 0
              ? expressTraitF32(gMat, gPat, gDom, modKinds, idxEndurance, modPhys, modNeur, modOther)
              : sc.baseEndurance;
          strength =
            idxStrength >= 0
              ? expressTraitF32(gMat, gPat, gDom, modKinds, idxStrength, modPhys, modNeur, modOther)
              : sc.baseStrength;
          speed =
            idxSpeed >= 0
              ? expressTraitF32(gMat, gPat, gDom, modKinds, idxSpeed, modPhys, modNeur, modOther)
              : sc.baseSpeed;
          perception =
            idxPerception >= 0
              ? expressTraitF32(gMat, gPat, gDom, modKinds, idxPerception, modPhys, modNeur, modOther)
              : sc.basePerception;
          intelligence =
            idxIntelligence >= 0
              ? expressTraitF32(gMat, gPat, gDom, modKinds, idxIntelligence, modPhys, modNeur, modOther)
              : sc.baseIntelligence;
          metEff =
            idxMetEff >= 0
              ? expressTraitF32(gMat, gPat, gDom, modKinds, idxMetEff, modPhys, modNeur, modOther)
              : sc.baseMetabolismEfficiency;
        }

        foragePower = 0.45 + 0.22 * speed + 0.18 * perception + 0.1 * strength + 0.08 * intelligence;
        let traitDemand = 0.45 + 0.30 * speed + 0.15 * strength + 0.10 * intelligence;
        const effScale = Math.max(0.45, 0.55 + 0.45 * metEff);
        if (physioTradeOffs) {
          // Sensory and oxidative (endurance) tissue is maintained like the neural tissue already
          // charged for intelligence; charged on the deviation from the species norm at the same
          // developmental stage, so the baseline individual pays exactly what it paid before.
          traitDemand +=
            TISSUE_UPKEEP_PER_TRAIT_UNIT * (perception - sc.basePerception * modNeur) +
            TISSUE_UPKEEP_PER_TRAIT_UNIT * (endurance - sc.baseEndurance * modPhys);
          if (traitDemand < 0.2) traitDemand = 0.2;
          // Efficiency-power trade-off: a metabolism that extracts more work per unit of fuel
          // delivers it more slowly, which limits the rate of food acquisition and burst output
          // (genetic efficiency vs the species norm; the same factor scales burst speed in spatial)
          const genMetEff = modOther > 0 ? metEff / modOther : sc.baseMetabolismEfficiency;
          const effGen = 0.55 + 0.45 * genMetEff;
          const effBase = 0.55 + 0.45 * sc.baseMetabolismEfficiency;
          foragePower *= Math.sqrt((effBase > 0.45 ? effBase : 0.45) / (effGen > 0.45 ? effGen : 0.45));
        }
        const activityLevel = Math.max(0, (3.8 * traitDemand) / effScale);
        metabolicDemandQ = _computeTotalMetabolicDemandFast(
          physioTradeOffs ? basalFactor * anatomyMaintenanceScale : basalFactor,
          thermoFactor,
          activityFactor,
          structMassQ,
          reserveMassQ,
          thermalStress,
          activityLevel
        );
        if (anatomyMetabolicScale !== 1) {
          metabolicDemandQ = Math.round(metabolicDemandQ * anatomyMetabolicScale);
        }
      }

      let metabBurnMassQ = 0;
      let metabNextCarryQ = 0;
      if (metabolicDemandQ <= carryCreditQ) {
        metabNextCarryQ = carryCreditQ - metabolicDemandQ;
      } else {
        const netDemandQ = metabolicDemandQ - carryCreditQ;
        const rem30 = netDemandQ % 30;
        const neededMassQ = rem30 === 0 ? netDemandQ / 30 : (netDemandQ - rem30) / 30 + 1;
        metabBurnMassQ = neededMassQ < reserveMassQ ? neededMassQ : reserveMassQ;
        const burnEnergyQ =
          metabBurnMassQ <= RESERVE_SAFE_MASS_LIMIT
            ? metabBurnMassQ * 30
            : _energyOfMass(metabBurnMassQ, _RHO_RESERVE);
        metabNextCarryQ = burnEnergyQ >= netDemandQ ? burnEnergyQ - netDemandQ : 0;
      }

      const postMetabReserveQ = reserveMassQ - metabBurnMassQ;
      const headroomMassQ = maxReserveMassQ > postMetabReserveQ ? maxReserveMassQ - postMetabReserveQ : 0;
      const normAfterMetab = maxReserveMassQ > 0 ? postMetabReserveQ / maxReserveMassQ : 0;

      let reqPlantMassQ = 0;
      let reqPreyMassQ = 0;
      let reqCarrionMassQ = 0;
      let reqDetritusMassQ = 0;
      let reqLegacyNormalized = 0;

      if (!isEgg && normAfterMetab < 0.96 && headroomMassQ > 0) {
        const hungerGapNorm = 1 - normAfterMetab;
        const maxIntake = maxForageIntake * foragePower * anatomyIntakeScale;
        const desiredNormGain = hungerGapNorm < maxIntake ? hungerGapNorm : maxIntake;
        if (desiredNormGain > 0) {
          reqLegacyNormalized = desiredNormGain;
          if (hasStrictFoodSources) {
            const desiredGainQ = applyPpmFloorFast(
              maxReserveMassQ,
              _fractionToPpmHalfEvenFast(desiredNormGain)
            );
            const desiredDepositMassQ = headroomMassQ < desiredGainQ ? headroomMassQ : desiredGainQ;
            if (desiredDepositMassQ > 0) {
              const neededReserveEnergyQ =
                desiredDepositMassQ <= RESERVE_SAFE_MASS_LIMIT
                  ? desiredDepositMassQ * 30
                  : _energyOfMass(desiredDepositMassQ, _RHO_RESERVE);
              const numProd = neededReserveEnergyQ * LOCAL_PPM;
              let neededGrossEnergyQ: number;
              if (numProd <= LOCAL_MAX_SAFE_INT) {
                const r = numProd % effAbsorptionAssimPpm;
                const q = (numProd - r) / effAbsorptionAssimPpm;
                neededGrossEnergyQ = r === 0 ? q : q + 1;
              } else {
                neededGrossEnergyQ = _scaleByRatio(
                  neededReserveEnergyQ,
                  LOCAL_PPM,
                  effAbsorptionAssimPpm,
                  'ceil'
                );
              }
              if (plantPpm > 0) {
                reqPlantMassQ = applyPpmFloorFast(massForPlantEnergyCeil(neededGrossEnergyQ), plantPpm);
              }
              if (preyPpm > 0) {
                reqPreyMassQ = applyPpmFloorFast(massForReserveEnergyCeil(neededGrossEnergyQ), preyPpm);
              }
              if (carrionPpm > 0) {
                reqCarrionMassQ = applyPpmFloorFast(massForCarrionEnergyCeil(neededGrossEnergyQ), carrionPpm);
              }
              if (detritusPpm > 0) {
                reqDetritusMassQ = applyPpmFloorFast(massForPlantEnergyCeil(neededGrossEnergyQ), detritusPpm);
              }
            }
          }
        }
      }

      if (legacySnapshotAvailable !== null && !isEgg && !legacySnapshotAvailable.has(cellIdx)) {
        const cy = (cellIdx / gridWidth) | 0;
        const cx = cellIdx - cy * gridWidth;
        const env = this.populateEnvContext(cx, cy, cellIdx, targetTick);
        legacySnapshotAvailable.set(cellIdx, this.foodProvider.getAvailablePrey(env));
      }

      let growthTargetStructQ = 0;
      if (!isEgg) {
        if (devPhysicalScale === 1) {
          growthTargetStructQ = adultMassQ;
        } else {
          const gt = applyPpmFloorFast(adultMassQ, _fractionToPpmHalfEvenFast(devPhysicalScale));
          growthTargetStructQ = gt > 1 ? gt : 1;
        }
      }

      draftOrg[dIdx] = org;
      draftPop[dIdx] = pop;
      draftSlot[dIdx] = slot;
      draftCellIndex[dIdx] = cellIdx;
      draftOrgId[dIdx] = orgId;
      draftSpeciesIdx[dIdx] = s;
      draftNextAgeTicks[dIdx] = nextAgeTicks;
      draftNextStage[dIdx] = nextStageCode;
      draftNextCooldown[dIdx] = nextCooldown;
      draftFlags[dIdx] = org.sex === 'female' ? FLAG_FEMALE : 0;
      draftStructMassQ[dIdx] = structMassQ;
      draftReserveMassQ[dIdx] = reserveMassQ;
      draftMaxReserveMassQ[dIdx] = maxReserveMassQ;
      draftCarryCreditQ[dIdx] = carryCreditQ;
      draftExternalDeltaQ[dIdx] = externalDeltaQ;
      draftMetabolicDemandQ[dIdx] = metabolicDemandQ;
      draftBurnMassQ[dIdx] = metabBurnMassQ;
      draftPostMetabResQ[dIdx] = postMetabReserveQ;
      draftPostMetabCarryQ[dIdx] = metabNextCarryQ;
      draftReqPlantQ[dIdx] = reqPlantMassQ;
      draftReqPreyQ[dIdx] = reqPreyMassQ;
      draftReqCarrionQ[dIdx] = reqCarrionMassQ;
      draftReqDetritusQ[dIdx] = reqDetritusMassQ;
      draftReqLegacyNorm[dIdx] = reqLegacyNormalized;
      draftNextEnergy[dIdx] = normAfterMetab;
      draftNextHealth[dIdx] = org.health;
      draftGrowthTargetStructQ[dIdx] = growthTargetStructQ;
      draftDevPhys[dIdx] = devPhysicalScale;
      draftDevNeural[dIdx] = devNeuralScale;
      draftDevSenesc[dIdx] = devSenescenceScale;
      draftThermalStress[dIdx] = thermalStress;
      draftEndurance[dIdx] = endurance;
    }

    this.curDraftCount = localDraftCount;
    this.curGloballySorted = localGloballySorted;
    this.curPrevGlobalId = localPrevGlobalId;
    this.stepSpeciesDraftEnd[s] = localDraftCount;
  }

  private runPhotosynthesisPlan(): void {
    const photoRatePpm = this.plantPhotosynthesisRatePpm;
    if (photoRatePpm <= 0) return;

    const landCells = this.landCellIndices;
    const landLen = landCells.length;
    const plantCapQ = this.plantCapacityQ;
    const projectedPlantCellMass = this.projectedPlantCellMass;
    const photoCellIdx = this.photoCellIdx;
    const photoGainMassQ = this.photoGainMassQ;
    const photoGainEnergyQ = this.photoGainEnergyQ;
    const plantFront = this.useDirectEnergyGrid
      ? this.energyGrid._getChannelStore().front[0]
      : null;
    const energyGrid = this.energyGrid;

    const remainingAbioticBig = this.ledger.globalAbioticMassQ;
    if (remainingAbioticBig <= 0n) return;

    let photoCount = 0;
    if (remainingAbioticBig <= BigInt(LOCAL_MAX_SAFE_INT)) {
      let remAbiotic = Number(remainingAbioticBig);
      for (let k = 0; k < landLen; k++) {
        if (remAbiotic <= 0) break;
        const cellIndex = landCells[k];
        const capQ = plantCapQ[cellIndex];
        if (capQ <= 0) continue;
        const curQ = plantFront !== null ? plantFront[cellIndex] : energyGrid.getMassQ(POOL_PLANT, cellIndex);
        if (curQ >= capQ) continue;
        let gainQ = applyPpmFloorFast(capQ - curQ, photoRatePpm);
        if (gainQ <= 0) continue;
        if (gainQ > remAbiotic) gainQ = remAbiotic;
        remAbiotic -= gainQ;
        projectedPlantCellMass[cellIndex] = curQ + gainQ;
        const pIdx = photoCount++;
        photoCellIdx[pIdx] = cellIndex;
        photoGainMassQ[pIdx] = gainQ;
        photoGainEnergyQ[pIdx] =
          gainQ <= PLANT_SAFE_MASS_LIMIT ? gainQ * 3 : energyOfMass(gainQ, RHO_PLANT);
      }
    } else {
      let remBig = remainingAbioticBig;
      for (let k = 0; k < landLen; k++) {
        if (remBig <= 0n) break;
        const cellIndex = landCells[k];
        const capQ = plantCapQ[cellIndex];
        if (capQ <= 0) continue;
        const curQ = plantFront !== null ? plantFront[cellIndex] : energyGrid.getMassQ(POOL_PLANT, cellIndex);
        if (curQ >= capQ) continue;
        let gainQ = applyPpmFloorFast(capQ - curQ, photoRatePpm);
        if (gainQ <= 0) continue;
        const gainBig = BigInt(gainQ);
        if (gainBig > remBig) {
          gainQ = Number(remBig);
        }
        if (gainQ <= 0) continue;
        remBig -= BigInt(gainQ);
        projectedPlantCellMass[cellIndex] = curQ + gainQ;
        const pIdx = photoCount++;
        photoCellIdx[pIdx] = cellIndex;
        photoGainMassQ[pIdx] = gainQ;
        photoGainEnergyQ[pIdx] =
          gainQ <= PLANT_SAFE_MASS_LIMIT ? gainQ * 3 : energyOfMass(gainQ, RHO_PLANT);
      }
    }
    this.curPhotoCount = photoCount;
  }

  private resolveSimplePoolContention(
    dirtyCount: number,
    dirtyCells: Uint32Array,
    cellHead: Int32Array,
    nextDraft: Int32Array,
    reqArr: Float64Array,
    grantArr: Float64Array,
    pool: EnergyPoolId,
    extSrc: TransactionalFoodSource | undefined,
    projectedPlantCellMass: Float64Array | null,
    gridFrontArr: Float64Array | null
  ): void {
    if (dirtyCount <= 0) return;
    sortOrScanDirtyCells(dirtyCount, this.grid.cellCount, cellHead, dirtyCells);
    const energyGrid = this.energyGrid;
    const draftOrgId = this.draftOrgId;

    for (let ci = 0; ci < dirtyCount; ci++) {
      const cellIdx = dirtyCells[ci];
      let avail: number;
      if (extSrc) {
        avail = extSrc.inspect(cellIdx).massQ;
      } else if (projectedPlantCellMass !== null && projectedPlantCellMass[cellIdx] >= 0) {
        avail = projectedPlantCellMass[cellIdx];
      } else if (gridFrontArr !== null) {
        avail = gridFrontArr[cellIdx];
      } else {
        avail = energyGrid.getMassQ(pool, cellIdx);
      }
      if (avail <= 0) continue;
      const first = cellHead[cellIdx];
      const second = nextDraft[first];
      if (second === -1) {
        const req = reqArr[first];
        if (req > 0) {
          grantArr[first] = req < avail ? req : avail;
        }
      } else {
        let n = 0;
        for (let cur = first; cur !== -1; cur = nextDraft[cur]) n++;
        this.ensureResolveScratch(n);
        const demands = this.resolveScratchDemands;
        const orgIds = this.resolveScratchOrgIds;
        const grants = this.resolveScratchGrants;
        const idxList = this.resolveScratchDraftIdx;
        let j = 0;
        for (let cur = first; cur !== -1; cur = nextDraft[cur]) {
          demands[j] = reqArr[cur];
          orgIds[j] = draftOrgId[cur];
          grants[j] = 0;
          idxList[j] = cur;
          j++;
        }
        _resolveContention(demands, n, avail, grants, orgIds);
        for (j = 0; j < n; j++) {
          grantArr[idxList[j]] = grants[j];
        }
      }
    }
  }

  private resolveResourceContentionPhase(
    sCount: number,
    conservativePreyProvider: DeterministicPreyFoodProvider | null
  ): void {
    const draftCount = this.curDraftCount;
    const draftCanonicalOrder = this.draftCanonicalOrder;
    const draftCellIndex = this.draftCellIndex;
    const draftOrgId = this.draftOrgId;
    const draftSpeciesIdx = this.draftSpeciesIdx;
    const draftNextStage = this.draftNextStage;
    const draftFlags = this.draftFlags;
    const draftDeathCause = this.draftDeathCause;
    const draftKillerId = this.draftKillerId;
    const draftNextHealth = this.draftNextHealth;
    const draftStructMassQ = this.draftStructMassQ;
    const draftPostMetabResQ = this.draftPostMetabResQ;
    const draftReqPlantQ = this.draftReqPlantQ;
    const draftReqCarrionQ = this.draftReqCarrionQ;
    const draftReqDetritusQ = this.draftReqDetritusQ;
    const draftReqPreyQ = this.draftReqPreyQ;
    const draftGrantPlantQ = this.draftGrantPlantQ;
    const draftGrantCarrionQ = this.draftGrantCarrionQ;
    const draftGrantDetritusQ = this.draftGrantDetritusQ;
    const draftGrantPreyQ = this.draftGrantPreyQ;

    const hasMultiSpecies = sCount > 1;
    const plantCellHead = this.plantCellHead;
    const plantDirtyCells = this.plantDirtyCells;
    const plantNextDraft = this.plantNextDraft;
    const carrionCellHead = this.carrionCellHead;
    const carrionDirtyCells = this.carrionDirtyCells;
    const carrionNextDraft = this.carrionNextDraft;
    const detritusCellHead = this.detritusCellHead;
    const detritusDirtyCells = this.detritusDirtyCells;
    const detritusNextDraft = this.detritusNextDraft;
    const preyCellHead = this.preyCellHead;
    const preyDirtyCells = this.preyDirtyCells;
    const preyNextDraft = this.preyNextDraft;
    const aliveCellHead = this.aliveCellHead;
    const aliveDirtyCells = this.aliveDirtyCells;
    const aliveNextDraft = this.aliveNextDraft;

    let plantDirtyCount = 0;
    let carrionDirtyCount = 0;
    let detritusDirtyCount = 0;
    let preyDirtyCount = 0;
    let aliveDirtyCount = 0;

    for (let ci = draftCount - 1; ci >= 0; ci--) {
      const dIdx = draftCanonicalOrder[ci];
      const cellIdx = draftCellIndex[dIdx];
      if (hasMultiSpecies) {
        const prevHead = aliveCellHead[cellIdx];
        if (prevHead === -1) aliveDirtyCells[aliveDirtyCount++] = cellIdx;
        aliveNextDraft[dIdx] = prevHead;
        aliveCellHead[cellIdx] = dIdx;
      }
      if (draftReqPlantQ[dIdx] > 0) {
        const prevHead = plantCellHead[cellIdx];
        if (prevHead === -1) plantDirtyCells[plantDirtyCount++] = cellIdx;
        plantNextDraft[dIdx] = prevHead;
        plantCellHead[cellIdx] = dIdx;
      }
      if (draftReqCarrionQ[dIdx] > 0) {
        const prevHead = carrionCellHead[cellIdx];
        if (prevHead === -1) carrionDirtyCells[carrionDirtyCount++] = cellIdx;
        carrionNextDraft[dIdx] = prevHead;
        carrionCellHead[cellIdx] = dIdx;
      }
      if (draftReqDetritusQ[dIdx] > 0) {
        const prevHead = detritusCellHead[cellIdx];
        if (prevHead === -1) detritusDirtyCells[detritusDirtyCount++] = cellIdx;
        detritusNextDraft[dIdx] = prevHead;
        detritusCellHead[cellIdx] = dIdx;
      }
      if (draftReqPreyQ[dIdx] > 0) {
        const prevHead = preyCellHead[cellIdx];
        if (prevHead === -1) preyDirtyCells[preyDirtyCount++] = cellIdx;
        preyNextDraft[dIdx] = prevHead;
        preyCellHead[cellIdx] = dIdx;
      }
    }

    this.curPlantDirtyCount = plantDirtyCount;
    this.curCarrionDirtyCount = carrionDirtyCount;
    this.curDetritusDirtyCount = detritusDirtyCount;
    this.curPreyDirtyCount = preyDirtyCount;
    this.curAliveDirtyCount = aliveDirtyCount;

    const gridFront = this.useDirectEnergyGrid ? this.energyGrid._getChannelStore().front : null;

    this.resolveSimplePoolContention(
      plantDirtyCount,
      plantDirtyCells,
      plantCellHead,
      plantNextDraft,
      draftReqPlantQ,
      draftGrantPlantQ,
      POOL_PLANT,
      this.externalPlantSource,
      this.projectedPlantCellMass,
      gridFront ? gridFront[0] : null
    );
    this.resolveSimplePoolContention(
      carrionDirtyCount,
      carrionDirtyCells,
      carrionCellHead,
      carrionNextDraft,
      draftReqCarrionQ,
      draftGrantCarrionQ,
      POOL_CARRION,
      this.externalCarrionSource,
      null,
      gridFront ? gridFront[2] : null
    );
    this.resolveSimplePoolContention(
      detritusDirtyCount,
      detritusDirtyCells,
      detritusCellHead,
      detritusNextDraft,
      draftReqDetritusQ,
      draftGrantDetritusQ,
      POOL_DETRITUS,
      this.externalDetritusSource,
      null,
      gridFront ? gridFront[4] : null
    );

    // 2c. Live prey predation & background prey pool
    // Spatial mode: a bite requires a capture attempt that actually lands (pursuit, strike range,
    // probabilistic outcome), so co-located prey is no longer consumed automatically.
    const spatialActive = this.spatial !== null;
    if (spatialActive && hasMultiSpecies && preyDirtyCount > 0) {
      this.resolveSpatialLivePredation();
    }
    let predBiteCount = this.curPredBiteCount;
    let preyRemTouchedCount = this.curPreyRemTouchedCount;
    const preyRemStructQ = this.preyRemStructQ;
    const preyRemReserveQ = this.preyRemReserveQ;
    const preyRemTouched = this.preyRemTouched;
    const preyMatrix = this.speciesPreyMatrix;
    const extPreySource = this.externalPreySource;

    if (preyDirtyCount > 0) {
      sortOrScanDirtyCells(preyDirtyCount, this.grid.cellCount, preyCellHead, preyDirtyCells);
      for (let ci = 0; ci < preyDirtyCount; ci++) {
        const cellIdx = preyDirtyCells[ci];
        const firstAlive = hasMultiSpecies && !spatialActive ? aliveCellHead[cellIdx] : -1;
        if (firstAlive !== -1 && aliveNextDraft[firstAlive] !== -1) {
          for (let pCur = preyCellHead[cellIdx]; pCur !== -1; pCur = preyNextDraft[pCur]) {
            let remReq = draftReqPreyQ[pCur];
            if (remReq <= 0) continue;
            const predSpeciesOffset = draftSpeciesIdx[pCur] * sCount;
            const predId = draftOrgId[pCur];
            for (let vCur = firstAlive; vCur !== -1 && remReq > 0; vCur = aliveNextDraft[vCur]) {
              if ((draftFlags[vCur] & FLAG_DIED) !== 0 || draftNextStage[vCur] === STAGE_EGG) continue;
              if (preyMatrix[predSpeciesOffset + draftSpeciesIdx[vCur]] === 0) continue;

              if (preyRemTouched[vCur] === 0) {
                preyRemTouched[vCur] = 1;
                if (preyRemTouchedCount >= this.preyRemTouchedList.length) {
                  const nextT = new Int32Array(this.preyRemTouchedList.length * 2);
                  nextT.set(this.preyRemTouchedList);
                  this.preyRemTouchedList = nextT;
                }
                this.preyRemTouchedList[preyRemTouchedCount++] = vCur;
                preyRemStructQ[vCur] = draftStructMassQ[vCur];
                preyRemReserveQ[vCur] = draftPostMetabResQ[vCur];
              }

              const remS = preyRemStructQ[vCur];
              const remR = preyRemReserveQ[vCur];
              const totalPreyMass = _safeAdd(remS, remR);
              if (totalPreyMass <= 0) continue;

              const biteMassQ = remReq < totalPreyMass ? remReq : totalPreyMass;
              if (biteMassQ <= 0) continue;
              const reserveBite = _scaleByRatio(remR, biteMassQ, totalPreyMass, 'half-even');
              let clampedResBite = biteMassQ < remR ? biteMassQ : remR;
              if (reserveBite < clampedResBite) clampedResBite = reserveBite > 0 ? reserveBite : 0;
              const structBite = biteMassQ - clampedResBite;

              const nextRemS = remS - structBite;
              preyRemReserveQ[vCur] = remR - clampedResBite;
              preyRemStructQ[vCur] = nextRemS;
              remReq -= biteMassQ;
              draftGrantPreyQ[pCur] += biteMassQ;
              draftFlags[vCur] |= FLAG_TOUCHED_PRED;

              const candStruct = draftStructMassQ[vCur];
              const lethal =
                nextRemS <= 0 ||
                structBite >= _scaleByRatio(candStruct, 35, 100, 'ceil') ||
                nextRemS < _scaleByRatio(candStruct, 65, 100, 'floor');

              if (lethal) {
                draftFlags[vCur] |= FLAG_DIED;
                draftDeathCause[vCur] = 'predation';
                draftKillerId[vCur] = predId;
                draftNextHealth[vCur] = 0;
              }

              if (predBiteCount >= this.predBiteCap) {
                this.ensurePredBiteCapacity(predBiteCount + 1);
              }
              this.predBitePredDraft[predBiteCount] = pCur;
              this.predBitePreyDraft[predBiteCount] = vCur;
              this.predBiteMassQ[predBiteCount] = biteMassQ;
              predBiteCount++;
            }
          }
        }

        if (extPreySource || conservativePreyProvider) {
          const avail = extPreySource
            ? extPreySource.inspect(cellIdx).massQ
            : conservativePreyProvider!.getAvailablePreyMassQ(cellIdx);
          if (avail <= 0) continue;
          let n = 0;
          for (let pCur = preyCellHead[cellIdx]; pCur !== -1; pCur = preyNextDraft[pCur]) {
            if (draftReqPreyQ[pCur] > draftGrantPreyQ[pCur]) n++;
          }
          if (n === 0) continue;
          if (n === 1) {
            for (let pCur = preyCellHead[cellIdx]; pCur !== -1; pCur = preyNextDraft[pCur]) {
              const remDemand = draftReqPreyQ[pCur] - draftGrantPreyQ[pCur];
              if (remDemand > 0) {
                draftGrantPreyQ[pCur] += remDemand < avail ? remDemand : avail;
                break;
              }
            }
          } else {
            this.ensureResolveScratch(n);
            const demands = this.resolveScratchDemands;
            const orgIds = this.resolveScratchOrgIds;
            const grants = this.resolveScratchGrants;
            const idxList = this.bgPreyScratchDraftIdx;
            let j = 0;
            for (let pCur = preyCellHead[cellIdx]; pCur !== -1; pCur = preyNextDraft[pCur]) {
              const remDemand = draftReqPreyQ[pCur] - draftGrantPreyQ[pCur];
              if (remDemand > 0) {
                demands[j] = remDemand;
                orgIds[j] = draftOrgId[pCur];
                grants[j] = 0;
                idxList[j] = pCur;
                j++;
              }
            }
            _resolveContention(demands, n, avail, grants, orgIds);
            for (j = 0; j < n; j++) {
              draftGrantPreyQ[idxList[j]] += grants[j];
            }
          }
        }
      }
    }

    this.curPredBiteCount = predBiteCount;
    this.curPreyRemTouchedCount = preyRemTouchedCount;
  }

  /**
   * Spatial-mode live predation: each hungry predator gets at most one capture attempt per tick,
   * decided by `SpatialBehaviorSystem.attemptCapture` (pursued target within strike range, or
   * opportunistic prey in the same cell). Only a successful attempt produces a bite; the bite
   * arithmetic and lethality rule are identical to the non-spatial in-cell loop.
   */
  private resolveSpatialLivePredation(): void {
    const spatial = this.spatial!;
    const draftCount = this.curDraftCount;
    const draftCanonicalOrder = this.draftCanonicalOrder;
    const draftFlags = this.draftFlags;
    const draftNextStage = this.draftNextStage;
    const draftOrgId = this.draftOrgId;
    const draftDeathCause = this.draftDeathCause;
    const draftKillerId = this.draftKillerId;
    const draftNextHealth = this.draftNextHealth;
    const draftStructMassQ = this.draftStructMassQ;
    const draftPostMetabResQ = this.draftPostMetabResQ;
    const draftReqPreyQ = this.draftReqPreyQ;
    const draftGrantPreyQ = this.draftGrantPreyQ;
    const preyRemStructQ = this.preyRemStructQ;
    const preyRemReserveQ = this.preyRemReserveQ;
    const preyRemTouched = this.preyRemTouched;

    let predBiteCount = this.curPredBiteCount;
    let preyRemTouchedCount = this.curPreyRemTouchedCount;

    for (let ci = 0; ci < draftCount; ci++) {
      const pCur = draftCanonicalOrder[ci];
      const remReq = draftReqPreyQ[pCur] - draftGrantPreyQ[pCur];
      if (remReq <= 0) continue;
      if ((draftFlags[pCur] & FLAG_DIED) !== 0 || draftNextStage[pCur] === STAGE_EGG) continue;

      const vCur = spatial.attemptCapture(pCur);
      if (vCur === -1) continue;

      if (preyRemTouched[vCur] === 0) {
        preyRemTouched[vCur] = 1;
        if (preyRemTouchedCount >= this.preyRemTouchedList.length) {
          const nextT = new Int32Array(this.preyRemTouchedList.length * 2);
          nextT.set(this.preyRemTouchedList);
          this.preyRemTouchedList = nextT;
        }
        this.preyRemTouchedList[preyRemTouchedCount++] = vCur;
        preyRemStructQ[vCur] = draftStructMassQ[vCur];
        preyRemReserveQ[vCur] = draftPostMetabResQ[vCur];
      }

      const remS = preyRemStructQ[vCur];
      const remR = preyRemReserveQ[vCur];
      const totalPreyMass = _safeAdd(remS, remR);
      if (totalPreyMass <= 0) continue;

      const biteMassQ = remReq < totalPreyMass ? remReq : totalPreyMass;
      if (biteMassQ <= 0) continue;
      const reserveBite = _scaleByRatio(remR, biteMassQ, totalPreyMass, 'half-even');
      let clampedResBite = biteMassQ < remR ? biteMassQ : remR;
      if (reserveBite < clampedResBite) clampedResBite = reserveBite > 0 ? reserveBite : 0;
      const structBite = biteMassQ - clampedResBite;

      const nextRemS = remS - structBite;
      preyRemReserveQ[vCur] = remR - clampedResBite;
      preyRemStructQ[vCur] = nextRemS;
      draftGrantPreyQ[pCur] += biteMassQ;
      draftFlags[vCur] |= FLAG_TOUCHED_PRED;

      const candStruct = draftStructMassQ[vCur];
      const lethal =
        nextRemS <= 0 ||
        structBite >= _scaleByRatio(candStruct, 35, 100, 'ceil') ||
        nextRemS < _scaleByRatio(candStruct, 65, 100, 'floor');

      if (lethal) {
        draftFlags[vCur] |= FLAG_DIED;
        draftDeathCause[vCur] = 'predation';
        draftKillerId[vCur] = draftOrgId[pCur];
        draftNextHealth[vCur] = 0;
      }

      if (predBiteCount >= this.predBiteCap) {
        this.ensurePredBiteCapacity(predBiteCount + 1);
      }
      this.predBitePredDraft[predBiteCount] = pCur;
      this.predBitePreyDraft[predBiteCount] = vCur;
      this.predBiteMassQ[predBiteCount] = biteMassQ;
      predBiteCount++;
    }

    this.curPredBiteCount = predBiteCount;
    this.curPreyRemTouchedCount = preyRemTouchedCount;
  }

  private evaluatePostFeedMortality(
    speciesCaches: SpeciesRuntimeCache[],
    isLegacyMode: boolean,
    legacySnapshotAvailable: Map<number, number> | null,
    lifecycleRng: SeededRng
  ): void {
    const draftCount = this.curDraftCount;
    const draftCanonicalOrder = this.draftCanonicalOrder;
    const draftFlags = this.draftFlags;
    const draftOrg = this.draftOrg;
    const draftDeathCause = this.draftDeathCause;
    const draftSpeciesIdx = this.draftSpeciesIdx;
    const draftMaxReserveMassQ = this.draftMaxReserveMassQ;
    const draftPostMetabResQ = this.draftPostMetabResQ;
    const draftGrantPlantQ = this.draftGrantPlantQ;
    const draftGrantDetritusQ = this.draftGrantDetritusQ;
    const draftGrantCarrionQ = this.draftGrantCarrionQ;
    const draftGrantPreyQ = this.draftGrantPreyQ;
    const draftCellIndex = this.draftCellIndex;
    const draftReqLegacyNorm = this.draftReqLegacyNorm;
    const draftNextEnergy = this.draftNextEnergy;
    const draftNextHealth = this.draftNextHealth;
    const draftNextStage = this.draftNextStage;
    const draftNextAgeTicks = this.draftNextAgeTicks;
    const draftNextCooldown = this.draftNextCooldown;
    const draftThermalStress = this.draftThermalStress;
    const draftEndurance = this.draftEndurance;
    const draftRecoveryScale = this.draftRecoveryScale;
    const draftMetabolicDemandQ = this.draftMetabolicDemandQ;
    const draftHealingDemandQ = this.draftHealingDemandQ;
    const speciesEligibleCounts = this.stepSpeciesEligibleCounts;
    const feedScratch = this.feedScratch;
    const extCarrion = this.externalCarrionSource;
    const energyGrid = this.energyGrid;
    const gridFront = this.useDirectEnergyGrid ? energyGrid._getChannelStore().front : null;
    const carrionMFront = gridFront ? gridFront[2] : null;
    const carrionEFront = gridFront ? gridFront[3] : null;
    const spatial = this.spatial;
    const draftSlot = this.draftSlot;

    let diedCount = 0;

    for (let ci = 0; ci < draftCount; ci++) {
      const dIdx = draftCanonicalOrder[ci];
      if ((draftFlags[dIdx] & FLAG_DIED) !== 0) {
        draftNextEnergy[dIdx] = 0;
        diedCount++;
        continue;
      }

      const sIdx = draftSpeciesIdx[dIdx];
      const sc = speciesCaches[sIdx];
      const pq = sc.pq;
      const maxReserveQ = draftMaxReserveMassQ[dIdx];
      const postMetabResQ = draftPostMetabResQ[dIdx];
      let headroom = maxReserveQ > postMetabResQ ? maxReserveQ - postMetabResQ : 0;
      let depositedMassQ = 0;

      const absPpm = pq.absorptionPpm;
      const assimPpm = pq.assimilationPpm;
      const sdaPpm = pq.sdaPpm;

      const gPlant = draftGrantPlantQ[dIdx];
      if (gPlant > 0 && headroom > 0) {
        const ePlant = gPlant <= PLANT_SAFE_MASS_LIMIT ? gPlant * 3 : _energyOfMass(gPlant, _RHO_PLANT);
        _computeFeedingPlanFast(gPlant, ePlant, absPpm, assimPpm, sdaPpm, headroom, feedScratch);
        depositedMassQ += feedScratch.depositMassQ;
        headroom -= feedScratch.depositMassQ;
      }

      const gDetritus = draftGrantDetritusQ[dIdx];
      if (gDetritus > 0 && headroom > 0) {
        const eDet = gDetritus <= PLANT_SAFE_MASS_LIMIT ? gDetritus * 3 : _energyOfMass(gDetritus, _RHO_DETRITUS);
        _computeFeedingPlanFast(gDetritus, eDet, absPpm, assimPpm, sdaPpm, headroom, feedScratch);
        depositedMassQ += feedScratch.depositMassQ;
        headroom -= feedScratch.depositMassQ;
      }

      const gCarrion = draftGrantCarrionQ[dIdx];
      if (gCarrion > 0) {
        const cellIdx = draftCellIndex[dIdx];
        let cm: number;
        let ce: number;
        if (extCarrion) {
          const snap = extCarrion.inspect(cellIdx);
          cm = snap.massQ;
          ce = snap.energyQ;
        } else if (carrionMFront !== null) {
          cm = carrionMFront[cellIdx];
          ce = carrionEFront![cellIdx];
        } else {
          cm = energyGrid.getMassQ(POOL_CARRION, cellIdx);
          ce = energyGrid.getEnergyQ(POOL_CARRION, cellIdx);
        }
        const estE = cm > 0 ? _scaleByRatio(ce, gCarrion, cm, 'floor') : 0;
        if (headroom > 0) {
          _computeFeedingPlanFast(gCarrion, estE, absPpm, assimPpm, sdaPpm, headroom, feedScratch);
          depositedMassQ += feedScratch.depositMassQ;
          headroom -= feedScratch.depositMassQ;
        }
      }

      const gPrey = draftGrantPreyQ[dIdx];
      if (gPrey > 0) {
        if (headroom > 0) {
          const ePrey = gPrey <= RESERVE_SAFE_MASS_LIMIT ? gPrey * 30 : _energyOfMass(gPrey, _RHO_RESERVE);
          _computeFeedingPlanFast(gPrey, ePrey, absPpm, assimPpm, sdaPpm, headroom, feedScratch);
          depositedMassQ += feedScratch.depositMassQ;
          headroom -= feedScratch.depositMassQ;
        }
      } else if (isLegacyMode && draftReqLegacyNorm[dIdx] > 0) {
        const cellIdx = draftCellIndex[dIdx];
        const availNorm = legacySnapshotAvailable?.get(cellIdx) ?? 0;
        const reqLegacy = draftReqLegacyNorm[dIdx];
        const estNormGain = reqLegacy < availNorm ? reqLegacy : availNorm;
        if (legacySnapshotAvailable && estNormGain > 0) {
          legacySnapshotAvailable.set(cellIdx, Math.max(0, availNorm - estNormGain));
        }
        const clampedGain = estNormGain < 1 ? estNormGain : 1;
        const estMass = applyPpmFloorFast(maxReserveQ, _fractionToPpmFloorFast(clampedGain));
        depositedMassQ += headroom < estMass ? headroom : estMass;
      }

      const postFeedResQ = postMetabResQ + depositedMassQ;
      draftPostMetabResQ[dIdx] = postFeedResQ;

      const nextEnergy = maxReserveQ > 0 ? postFeedResQ / maxReserveQ : 0;
      draftNextEnergy[dIdx] = nextEnergy;

      const org = draftOrg[dIdx];
      const nextStageCode = draftNextStage[dIdx];
      const nextAgeTicks = draftNextAgeTicks[dIdx];
      const tStress = draftThermalStress[dIdx];
      const endur = draftEndurance[dIdx];
      const curHealth = org.health;

      let nextHealth: number;
      let healed = false;
      let dehydrationDamage = 0;
      if (nextStageCode === STAGE_EGG) {
        let h = curHealth;
        if (tStress > 0) {
          h = Math.max(0, h - tStress * sc.thermalDamagePerTick * 1.15);
        }
        if (nextEnergy <= 0) {
          h = Math.max(0, h - sc.starvationDamagePerTick);
        }
        nextHealth = h;
      } else {
        // Spatial mode only: a fully dehydrated organism loses health and cannot heal, and effort
        // spent beyond the energy reserve (exhaustion) is paid with health
        let exhaustionDamage = 0;
        if (spatial !== null) {
          dehydrationDamage = spatial.dehydrationDamage(draftSlot[dIdx]);
          exhaustionDamage = spatial.exhaustionDamage(draftSlot[dIdx]);
        }
        let healthDelta = 0;
        if (tStress > 0) {
          healthDelta -= tStress * sc.thermalDamagePerTick;
        }
        if (nextEnergy <= 0) {
          const starvationMitigation = Math.max(0.65, 1.15 - 0.15 * endur);
          healthDelta -= sc.starvationDamagePerTick * starvationMitigation;
        } else if (
          tStress === 0 &&
          nextEnergy >= 0.45 &&
          curHealth < 1.0 &&
          dehydrationDamage === 0 &&
          exhaustionDamage === 0
        ) {
          healthDelta += sc.healingPerTick * (0.75 + 0.25 * endur) * draftRecoveryScale[dIdx];
          healed = true;
        }
        if (dehydrationDamage > 0) {
          healthDelta -= dehydrationDamage;
        }
        if (exhaustionDamage > 0) {
          healthDelta -= exhaustionDamage;
        }
        nextHealth = Math.min(1.0, Math.max(0, curHealth + healthDelta));
      }
      draftNextHealth[dIdx] = nextHealth;

      if (healed) {
        draftFlags[dIdx] |= FLAG_HEALED;
        const healCostQ = _scaleByRatio(draftMetabolicDemandQ[dIdx], 10, 100, 'floor');
        draftHealingDemandQ[dIdx] = healCostQ > 1 ? healCostQ : 1;
      }

      let deathCause: DeathCause | null = null;
      if (nextStageCode === STAGE_EGG) {
        if (nextHealth <= 0) {
          deathCause = tStress > 0.25 ? 'thermal-stress' : 'incubation-failure';
        }
      } else if (nextHealth <= 0) {
        if (nextEnergy <= 0 && tStress <= 0.15) deathCause = 'starvation';
        else if (tStress > 0.15) deathCause = 'thermal-stress';
        else if (dehydrationDamage > 0) deathCause = 'dehydration';
        else deathCause = 'starvation';
      } else if (nextStageCode === STAGE_ELDER) {
        const genArr = org.phenotype.geneticExpression;
        const pIdx = sc.idx;
        const endGen = pIdx.endurance >= 0 ? genArr[pIdx.endurance] : sc.baseEndurance;
        const metGen =
          pIdx.metabolismEfficiency >= 0 ? genArr[pIdx.metabolismEfficiency] : sc.baseMetabolismEfficiency;
        const modifier = 0.8 + 0.14 * endGen + 0.08 * metGen;
        const maxLife = Math.max(sc.elderLifeFloor, Math.round(sc.maxLifespanTicks * modifier));
        if (nextAgeTicks >= maxLife) {
          deathCause = 'old-age';
        } else {
          const bioAge = nextAgeTicks / sc.tpy;
          const maxBio = maxLife / sc.tpy;
          const elderProgress = (bioAge - sc.elderBio) / Math.max(sc.minBioStep, maxBio - sc.elderBio);
          const hazard = Math.min(0.35, 0.015 + elderProgress * elderProgress * 0.16);
          if (lifecycleRng.chance(hazard)) {
            deathCause = 'old-age';
          }
        }
      }

      if (deathCause !== null) {
        draftFlags[dIdx] |= FLAG_DIED;
        draftDeathCause[dIdx] = deathCause;
        draftNextHealth[dIdx] = 0;
        diedCount++;
      } else if (
        (nextStageCode === STAGE_ADULT || nextStageCode === STAGE_ELDER) &&
        draftNextCooldown[dIdx] === 0 &&
        nextEnergy >= sc.minEnergyToReproduce &&
        nextHealth >= sc.minHealthToReproduce
      ) {
        draftFlags[dIdx] |= FLAG_ELIGIBLE;
        speciesEligibleCounts[sIdx] += 1;
      }
    }

    this.curDiedCount = diedCount;
  }

  /**
   * Evolution-mode mate search: up to `MAX_MATE_CANDIDATES` eligible males from the female's cell
   * and its neighbours (canonical order), plus clade-compatible males of sister species sharing her
   * cell when hybridization is enabled. Each candidate is accepted with the probability given by
   * the reproductive compatibility model (mate recognition x parental fertility x, with sexual
   * selection, male condition); the first acceptance wins. Sets `this.mateCompat`.
   */
  private findMateWithCompatibility(
    fIdx: number,
    s: number,
    speciesCaches: SpeciesRuntimeCache[],
    cellHead: Int32Array,
    cellNext: Int32Array,
    active: readonly Organism[],
    activeToDraft: Int32Array | null,
    unsortedIdToDraft: Map<number, number> | null,
    matingRng: SeededRng
  ): number {
    const draftFlags = this.draftFlags;
    const draftOrg = this.draftOrg;
    const draftSpeciesIdx = this.draftSpeciesIdx;
    const female = draftOrg[fIdx];
    const femaleSp = speciesCaches[s].species;
    const seekerCell = this.draftCellIndex[fIdx];
    const width = this.grid.width;
    const height = this.grid.height;
    const wrapX = this.effectiveWrapX;
    const evo = this.evolution!;
    const candidates = this.mateCandidateScratch;
    let nCand = 0;
    let scanned = 0;

    const consider = (dIdx: number): void => {
      const flags = draftFlags[dIdx];
      if ((flags & FLAG_ELIGIBLE) === 0 || (flags & (FLAG_DIED | FLAG_FEMALE)) !== 0) return;
      candidates[nCand++] = dIdx;
    };
    const visitCell = (cell: number): void => {
      for (let idx = cellHead[cell]; idx !== -1 && nCand < MAX_MATE_CANDIDATES && scanned < MAX_MATE_SCAN; idx = cellNext[idx]) {
        scanned++;
        const cand = active[idx];
        if (!cand.alive || cand.sex === 'female' || cand.id === female.id) continue;
        const d = activeToDraft !== null ? activeToDraft[idx] : (unsortedIdToDraft?.get(cand.id) ?? -1);
        if (d !== -1) consider(d);
      }
    };
    visitCell(seekerCell);
    const fy = (seekerCell / width) | 0;
    const fx = seekerCell - fy * width;
    for (let k = 0; k < 8 && nCand < MAX_MATE_CANDIDATES && scanned < MAX_MATE_SCAN; k++) {
      let nx = fx + MOORE_DX[k];
      const ny = fy + MOORE_DY[k];
      if (ny < 0 || ny >= height) continue;
      if (wrapX) nx = ((nx % width) + width) % width;
      else if (nx < 0 || nx >= width) continue;
      const nIdx = ny * width + nx;
      if (nIdx !== seekerCell) visitCell(nIdx);
    }
    // Sister-species males in the same cell (all-species draft index of this tick)
    if (evo.enableHybridization && this.curAliveDirtyCount > 0) {
      const sCount = speciesCaches.length;
      let hetero = 0;
      for (let d = this.aliveCellHead[seekerCell]; d !== -1 && hetero < 2 && nCand < MAX_MATE_CANDIDATES + 2; d = this.aliveNextDraft[d]) {
        const sp = draftSpeciesIdx[d];
        if (sp === s || this.cladeCompatMatrix[s * sCount + sp] === 0) continue;
        if (draftOrg[d].sex === 'female') continue;
        const before = nCand;
        consider(d);
        if (nCand > before) hetero++;
      }
    }

    for (let i = 0; i < nCand; i++) {
      const mIdx = candidates[i];
      const male = draftOrg[mIdx];
      const maleSp = speciesCaches[draftSpeciesIdx[mIdx]].species;
      // Heterospecific candidates were admitted only when clade-compatible (cladeCompatMatrix)
      const compat = evaluateReproductiveCompatibility(female, femaleSp, male, maleSp, true);
      this.t_mateEvaluations++;
      let p = compat.compatible ? compat.preZygoticCompatibility * compat.parentFertilityMultiplier : 0;
      if (p > 0 && evo.enableSexualSelection) {
        const attr = computeSexualAttractiveness(male, maleSp);
        p *= Math.min(1, 0.5 + 0.5 * attr);
      }
      if (matingRng.chance(p)) {
        this.mateCompat = compat;
        return mIdx;
      }
      this.t_mateRejections++;
    }
    return -1;
  }

  private planReproductionPhase(
    sCount: number,
    speciesCaches: SpeciesRuntimeCache[],
    geneticsRng: SeededRng,
    mutationRng: SeededRng,
    reproductionRng: SeededRng,
    targetTick: number,
    plannedNextId: number
  ): number {
    let reproPlanCount = 0;
    let eggPlanCount = 0;
    const trackMut = this.trackMutationEvents;
    const anatomyRng = this.streams.get('biology:anatomy');
    const matingRng = this.streams.get('biology:mating');
    const evolutionMating = this.evolution !== null;
    const gridWidth = this.grid.width;

    const popBySpeciesIdx = this.stepPopBySpeciesIdx;
    const speciesEligibleCounts = this.stepSpeciesEligibleCounts;
    const speciesWasCanonical = this.stepSpeciesWasCanonical;
    const speciesActiveMapOffsets = this.stepSpeciesActiveMapOffsets;
    const unsortedIdToDraftMaps = this.stepUnsortedIdToDraftMaps;
    const speciesDraftStart = this.stepSpeciesDraftStart;
    const speciesDraftEnd = this.stepSpeciesDraftEnd;
    const speciesEggStart = this.stepSpeciesEggStart;
    const speciesEggCount = this.stepSpeciesEggCount;

    const draftFlags = this.draftFlags;
    const draftOrg = this.draftOrg;
    const draftOrgId = this.draftOrgId;
    const draftCellIndex = this.draftCellIndex;
    const draftNextStage = this.draftNextStage;
    const draftNextCooldown = this.draftNextCooldown;
    const draftPostMetabResQ = this.draftPostMetabResQ;
    const draftMetabolicDemandQ = this.draftMetabolicDemandQ;
    const mateCellCursor = this.mateCellCursor;
    const mateCellTouched = this.mateCellTouched;

    for (let s = 0; s < sCount; s++) {
      const pop = popBySpeciesIdx[s];
      if (!pop || speciesEligibleCounts[s] < 2) continue;

      pop.ensureSpatialIndex();
      const cellHead = pop.getSpatialIndexHead();
      const cellNext = pop.getSpatialIndexNext();
      const cellCounts = pop.getCellCountsBuffer();
      const rawActive = pop.getActiveOrganisms();
      const isCanonical = speciesWasCanonical[s] === 1;
      const activeToDraft = isCanonical
        ? this.activeIdxToDraftIdx.subarray(speciesActiveMapOffsets[s])
        : this.activeIdxToDraftIdx;
      const unsortedMap = unsortedIdToDraftMaps[s];

      const sc = speciesCaches[s];
      const species = sc.species;
      const schema = sc.schema;
      const locusCount = sc.locusCount;
      const mutPlan = sc.mutationPlan;
      const eggActualInitNorm = sc.eggActualInitNorm;
      const femaleProb = sc.femaleProbability;
      const elderFertMul = sc.elderFertilityMultiplier;
      const cooldownTicks = sc.cooldownTicks;
      const elderCooldown = sc.elderCooldown;
      const clutchMin = sc.clutchSizeMin;
      const clutchMax = sc.clutchSizeMax;

      const dStart = speciesDraftStart[s];
      const dEnd = speciesDraftEnd[s];
      speciesEggStart[s] = eggPlanCount;
      this.mateTouchedCount = 0;

      for (let fIdx = dStart; fIdx < dEnd; fIdx++) {
        const fFlags = draftFlags[fIdx];
        if ((fFlags & (FLAG_FEMALE | FLAG_ELIGIBLE)) !== (FLAG_FEMALE | FLAG_ELIGIBLE)) continue;
        if ((fFlags & FLAG_DIED) !== 0) continue;

        const female = draftOrg[fIdx];
        this.mateCompat = null;
        const mIdx = evolutionMating
          ? this.findMateWithCompatibility(
              fIdx,
              s,
              speciesCaches,
              cellHead,
              cellNext,
              rawActive,
              isCanonical ? activeToDraft : null,
              unsortedMap,
              matingRng
            )
          : isCanonical
          ? this.findMateDraftWithCursor(
              female.x,
              female.y,
              draftCellIndex[fIdx],
              cellHead,
              cellNext,
              rawActive,
              activeToDraft
            )
          : this.findMateDraftFast(
              draftOrgId[fIdx],
              female.x,
              female.y,
              draftCellIndex[fIdx],
              cellHead,
              cellNext,
              rawActive,
              activeToDraft,
              unsortedMap
            );
        if (mIdx === -1) continue;

        const male = draftOrg[mIdx];
        const compat = this.mateCompat as ReproductiveCompatibilityResult | null;
        const nestCellIdx = this.chooseNestCell(
          female.x,
          female.y,
          draftCellIndex[fIdx],
          cellCounts,
          reproductionRng,
          s
        );
        const nestY = (nestCellIdx / gridWidth) | 0;
        const nestX = nestCellIdx - nestY * gridWidth;

        const fStage = draftNextStage[fIdx];
        const mStage = draftNextStage[mIdx];

        if ((fStage === STAGE_ELDER || mStage === STAGE_ELDER) && !reproductionRng.chance(elderFertMul)) {
          draftFlags[fIdx] &= ~FLAG_ELIGIBLE;
          if (mStage === STAGE_ELDER) {
            draftFlags[mIdx] &= ~FLAG_ELIGIBLE;
          }
          if (reproPlanCount >= this.rpCap) {
            this.ensureReproPlanCapacity(reproPlanCount + 1);
          }
          const rpIdx = reproPlanCount++;
          this.rpFemaleDraft[rpIdx] = fIdx;
          this.rpMaleDraft[rpIdx] = mIdx;
          this.rpStatus[rpIdx] = 1; // elder-miss
          this.rpFemaleCd[rpIdx] = fStage === STAGE_ELDER ? elderCooldown : draftNextCooldown[fIdx];
          this.rpMaleCd[rpIdx] = mStage === STAGE_ELDER ? elderCooldown : draftNextCooldown[mIdx];
          this.rpFatherMatingDemandQ[rpIdx] = 0;
          this.rpEggStart[rpIdx] = eggPlanCount;
          this.rpEggCount[rpIdx] = 0;
          continue;
        }

        const clutchSize =
          clutchMin === clutchMax ? clutchMin : reproductionRng.nextInt(clutchMin, clutchMax);

        draftFlags[fIdx] &= ~FLAG_ELIGIBLE;
        draftFlags[mIdx] &= ~FLAG_ELIGIBLE;

        if (clutchSize <= 0) {
          if (reproPlanCount >= this.rpCap) {
            this.ensureReproPlanCapacity(reproPlanCount + 1);
          }
          const rpIdx = reproPlanCount++;
          this.rpFemaleDraft[rpIdx] = fIdx;
          this.rpMaleDraft[rpIdx] = mIdx;
          this.rpStatus[rpIdx] = 2; // zero-clutch
          this.rpFemaleCd[rpIdx] = cooldownTicks;
          this.rpMaleCd[rpIdx] = cooldownTicks;
          this.rpFatherMatingDemandQ[rpIdx] = 0;
          this.rpEggStart[rpIdx] = eggPlanCount;
          this.rpEggCount[rpIdx] = 0;
          continue;
        }

        if (eggPlanCount + clutchSize > this.eggCap) {
          this.ensureEggPlanCapacity(eggPlanCount + clutchSize);
        }

        const rpEggStartIdx = eggPlanCount;
        const childGeneration = (female.generation > male.generation ? female.generation : male.generation) + 1;
        const fDom = female.genome.dominance;
        const mDom = male.genome.dominance;

        const speciesIdStr = species.id;
        const schemaIdStr = schema.id;
        for (let c = 0; c < clutchSize; c++) {
          const maternalGamete = _createHaploidGamete(female.genome, schema, geneticsRng);
          const paternalGamete = _createHaploidGamete(male.genome, schema, geneticsRng);
          const dominance = new Float32Array(locusCount);
          if (locusCount === 10) {
            let dA = fDom[0], dB = mDom[0]; dominance[0] = dA === dB ? dA : geneticsRng.chance(0.5) ? dA : dB;
            dA = fDom[1]; dB = mDom[1]; dominance[1] = dA === dB ? dA : geneticsRng.chance(0.5) ? dA : dB;
            dA = fDom[2]; dB = mDom[2]; dominance[2] = dA === dB ? dA : geneticsRng.chance(0.5) ? dA : dB;
            dA = fDom[3]; dB = mDom[3]; dominance[3] = dA === dB ? dA : geneticsRng.chance(0.5) ? dA : dB;
            dA = fDom[4]; dB = mDom[4]; dominance[4] = dA === dB ? dA : geneticsRng.chance(0.5) ? dA : dB;
            dA = fDom[5]; dB = mDom[5]; dominance[5] = dA === dB ? dA : geneticsRng.chance(0.5) ? dA : dB;
            dA = fDom[6]; dB = mDom[6]; dominance[6] = dA === dB ? dA : geneticsRng.chance(0.5) ? dA : dB;
            dA = fDom[7]; dB = mDom[7]; dominance[7] = dA === dB ? dA : geneticsRng.chance(0.5) ? dA : dB;
            dA = fDom[8]; dB = mDom[8]; dominance[8] = dA === dB ? dA : geneticsRng.chance(0.5) ? dA : dB;
            dA = fDom[9]; dB = mDom[9]; dominance[9] = dA === dB ? dA : geneticsRng.chance(0.5) ? dA : dB;
          } else {
            for (let l = 0; l < locusCount; l++) {
              const dA = fDom[l];
              const dB = mDom[l];
              dominance[l] = dA === dB ? dA : geneticsRng.chance(0.5) ? dA : dB;
            }
          }
          const childGenome = {
            schemaId: schemaIdStr,
            maternalAlleles: maternalGamete,
            paternalAlleles: paternalGamete,
            dominance,
          };

          let mutCount: number;
          let mutRecords: readonly MutationRecord[] | undefined;
          if (trackMut) {
            const mutOutcome = _mutateGenomeWithPlan(childGenome, mutPlan, mutationRng, true);
            mutCount = mutOutcome.mutationCount;
            mutRecords = mutOutcome.records;
          } else {
            mutCount = _mutateGenomeWithPlanCount(childGenome, mutPlan, mutationRng);
            mutRecords = undefined;
          }
          const sex: Sex = reproductionRng.chance(femaleProb) ? 'female' : 'male';
          // Heritable anatomy: one allele copy from each parent per locus plus mutation, drawn from
          // the dedicated anatomy stream (restored on ABORT with all other streams). Parents are
          // only read. Without an anatomy genome in both parents none is invented for the child.
          const childAnatomy =
            female.anatomy !== undefined && male.anatomy !== undefined
              ? inheritOrganismAnatomy(female.anatomy, male.anatomy, sc.mutationConfig, anatomyRng).anatomy
              : undefined;
          const child: Organism = {
            id: plannedNextId++,
            speciesId: speciesIdStr,
            sex,
            generation: childGeneration,
            parentAId: female.id,
            parentBId: male.id,
            birthTick: targetTick,
            genome: childGenome,
            phenotype: {
              schemaId: schemaIdStr,
              geneticExpression: new Float32Array(locusCount),
              expressed: new Float32Array(locusCount),
            },
            x: nestX,
            y: nestY,
            cellIndex: nestCellIdx,
            ageTicks: 0,
            stage: 'egg',
            health: 1.0,
            energy: eggActualInitNorm,
            alive: true,
            deathTick: null,
            deathCause: 'none',
            reproductionCooldown: 0,
            offspringCount: 0,
            mutationsReceived: mutCount,
            anatomy: childAnatomy,
          };
          let fatherSpeciesIdx = -1;
          if (compat !== null) {
            // Post-zygotic barrier: an inviable zygote is still laid and provisioned (the mother's
            // investment is lost) but cannot develop and dies as an egg.
            if (compat.postZygoticViability < 1 && !matingRng.chance(compat.postZygoticViability)) {
              child.health = 0;
              this.t_inviableZygotes++;
            }
            if (compat.isInterspecific || compat.offspringAdmixtureRatio > 0 || compat.offspringHybridFertility < 1) {
              // Offspring belong to the maternal population; admixture and reduced fertility are heritable facts
              child.ancestry = {
                primarySpeciesId: speciesIdStr,
                secondarySpeciesId: compat.offspringSecondarySpeciesId,
                admixtureRatio: compat.offspringAdmixtureRatio,
                hybridFertility: compat.offspringHybridFertility,
              };
            }
            if (compat.isInterspecific) {
              fatherSpeciesIdx = this.draftSpeciesIdx[mIdx];
              this.t_hybridOffspring++;
            }
          }

          const epIdx = eggPlanCount++;
          this.eggFatherSpeciesIdx[epIdx] = fatherSpeciesIdx;
          if (fatherSpeciesIdx >= 0) {
            this.eggHybridViability[epIdx] = compat!.postZygoticViability;
            this.eggHybridFertility[epIdx] = compat!.offspringHybridFertility;
            this.eggHybridBackcross[epIdx] = compat!.isBackcross ? 1 : 0;
          }
          this.eggOrg[epIdx] = child;
          this.eggSpeciesIdx[epIdx] = s;
          this.eggDraftSlot[epIdx] = -1;
          this.eggIsReused[epIdx] = 0;
          this.eggProvisioned[epIdx] = 0;
          this.eggMutationRecords[epIdx] = mutRecords;
        }

        const malePostFeedResQ = draftPostMetabResQ[mIdx];
        const matingEuCost = _euToQFloorFast(_qToMU(malePostFeedResQ) * 5);
        const matingCap = _scaleByRatio(draftMetabolicDemandQ[mIdx], 35, 100, 'floor');
        const fatherMatingDemandQ = Math.max(0, matingEuCost < matingCap ? matingEuCost : matingCap);

        if (reproPlanCount >= this.rpCap) {
          this.ensureReproPlanCapacity(reproPlanCount + 1);
        }
        const rpIdx = reproPlanCount++;
        this.rpFemaleDraft[rpIdx] = fIdx;
        this.rpMaleDraft[rpIdx] = mIdx;
        this.rpStatus[rpIdx] = 0; // ok
        this.rpFemaleCd[rpIdx] = cooldownTicks;
        this.rpMaleCd[rpIdx] = cooldownTicks;
        this.rpFatherMatingDemandQ[rpIdx] = fatherMatingDemandQ;
        this.rpEggStart[rpIdx] = rpEggStartIdx;
        this.rpEggCount[rpIdx] = clutchSize;
      }

      const mtc = this.mateTouchedCount;
      for (let t = 0; t < mtc; t++) {
        mateCellCursor[mateCellTouched[t]] = -2;
      }
      this.mateTouchedCount = 0;
      speciesEggCount[s] = eggPlanCount - speciesEggStart[s];
    }

    this.curReproPlanCount = reproPlanCount;
    this.curEggPlanCount = eggPlanCount;
    return plannedNextId;
  }

  private stagePoolForaging(
    tx: EnergyTransaction,
    speciesCaches: SpeciesRuntimeCache[],
    targetTick: number,
    useDirectEntity: boolean,
    useDirectGrid: boolean,
    poolKind: 0 | 1 | 2, // 0=plant, 1=detritus, 2=carrion
    externalSrc: TransactionalFoodSource | undefined,
    escrowSlot: number,
    reqOrGrantArr: Float64Array,
    entityBack: readonly Float64Array[] | null,
    gridBack: readonly Float64Array[] | null
  ): void {
    const draftCount = this.curDraftCount;
    const draftCanonicalOrder = this.draftCanonicalOrder;
    const draftFlags = this.draftFlags;
    const draftSpeciesIdx = this.draftSpeciesIdx;
    const draftCellIndex = this.draftCellIndex;
    const draftSlot = this.draftSlot;
    const draftStructMassQ = this.draftStructMassQ;
    const draftMaxReserveMassQ = this.draftMaxReserveMassQ;
    const feedScratch = this.feedScratch;
    const entityStore = this.entityStore;
    const energyGrid = this.energyGrid;

    if (externalSrc) {
      const draftOrgId = this.draftOrgId;
      const reqs: CompetitiveConsumerRequest[] = [];
      for (let ci = 0; ci < draftCount; ci++) {
        const dIdx = draftCanonicalOrder[ci];
        const reqM = reqOrGrantArr[dIdx];
        if (reqM <= 0 || (draftFlags[dIdx] & FLAG_DIED) !== 0) continue;
        const sc = speciesCaches[draftSpeciesIdx[dIdx]];
        const cellIdx = draftCellIndex[dIdx];
        reqs.push({
          organismId: draftOrgId[dIdx],
          entitySlot: draftSlot[dIdx],
          cellIndex: cellIdx,
          detritusCellIndex: cellIdx,
          requestedMassQ: reqM,
          profile: sc.profile,
          escrowSlot,
        });
      }
      if (reqs.length > 0) {
        stageCompetitiveTransactionalForaging(
          this.ledger,
          tx,
          externalSrc,
          entityStore,
          reqs,
          targetTick
        );
      }
      return;
    }

    const esStructBack = entityBack ? entityBack[0] : null;
    const esResBack = entityBack ? entityBack[2] : null;
    const plantBack = gridBack ? gridBack[0] : null;
    const carrionMBack = gridBack ? gridBack[2] : null;
    const carrionEBack = gridBack ? gridBack[3] : null;
    const detritusBack = gridBack ? gridBack[4] : null;

    for (let ci = 0; ci < draftCount; ci++) {
      const dIdx = draftCanonicalOrder[ci];
      const grantM = reqOrGrantArr[dIdx];
      if (grantM <= 0 || (draftFlags[dIdx] & FLAG_DIED) !== 0) continue;

      const slot = draftSlot[dIdx];
      const stagedStructM = esStructBack !== null
        ? esStructBack[slot]
        : useDirectEntity
          ? entityStore.stagedStructMassUnsafe(slot)
          : Number(tx.stagedMassQ(AK_ORGANISM_STRUCT, slot));
      const stagedResM = esResBack !== null
        ? esResBack[slot]
        : useDirectEntity
          ? entityStore.stagedReserveMassUnsafe(slot)
          : Number(tx.stagedMassQ(AK_ORGANISM_RESERVE, slot));
      const pq = speciesCaches[draftSpeciesIdx[dIdx]].pq;
      let maxResM: number;
      if (stagedStructM === draftStructMassQ[dIdx]) {
        maxResM = draftMaxReserveMassQ[dIdx];
      } else {
        const prod = stagedStructM * pq.maxReserveRatioScaled;
        maxResM =
          prod <= LOCAL_MAX_SAFE_INT
            ? (prod - (prod % LOCAL_PPM)) / LOCAL_PPM
            : _scaleByRatio(stagedStructM, pq.maxReserveRatioScaled, LOCAL_PPM, 'floor');
      }
      const headroom = maxResM > stagedResM ? maxResM - stagedResM : 0;
      if (headroom <= 0) continue;

      const cellIdx = draftCellIndex[dIdx];
      if (poolKind === 0) {
        const availM = plantBack !== null
          ? plantBack[cellIdx]
          : useDirectGrid
            ? energyGrid.getStagedMassUnsafe(POOL_PLANT, cellIdx)
            : Number(tx.stagedMassQ(AK_CELL_PLANT, cellIdx));
        const biteM = grantM < availM ? grantM : availM;
        if (biteM > 0) {
          _stageFeedingFast(
            tx,
            AK_CELL_PLANT,
            cellIdx,
            slot,
            cellIdx,
            biteM,
            biteM <= PLANT_SAFE_MASS_LIMIT ? biteM * 3 : _energyOfMass(biteM, _RHO_PLANT),
            pq.absorptionPpm,
            pq.assimilationPpm,
            pq.sdaPpm,
            headroom,
            feedScratch
          );
        }
      } else if (poolKind === 1) {
        const availM = detritusBack !== null
          ? detritusBack[cellIdx]
          : useDirectGrid
            ? energyGrid.getStagedMassUnsafe(POOL_DETRITUS, cellIdx)
            : Number(tx.stagedMassQ(AK_CELL_DETRITUS, cellIdx));
        const biteM = grantM < availM ? grantM : availM;
        if (biteM > 0) {
          _stageFeedingFast(
            tx,
            AK_CELL_DETRITUS,
            cellIdx,
            slot,
            cellIdx,
            biteM,
            biteM <= PLANT_SAFE_MASS_LIMIT ? biteM * 3 : _energyOfMass(biteM, _RHO_DETRITUS),
            pq.absorptionPpm,
            pq.assimilationPpm,
            pq.sdaPpm,
            headroom,
            feedScratch
          );
        }
      } else {
        const carrionM = carrionMBack !== null
          ? carrionMBack[cellIdx]
          : useDirectGrid
            ? energyGrid.getStagedMassUnsafe(POOL_CARRION, cellIdx)
            : Number(tx.stagedMassQ(AK_CELL_CARRION, cellIdx));
        if (carrionM > 0) {
          const carrionE = carrionEBack !== null
            ? carrionEBack[cellIdx]
            : useDirectGrid
              ? energyGrid.getStagedEnergyUnsafe(POOL_CARRION, cellIdx)
              : Number(tx.stagedEnergyQ(AK_CELL_CARRION, cellIdx));
          _stageCarrionScavengeFast(
            tx,
            cellIdx,
            carrionM,
            carrionE,
            slot,
            cellIdx,
            grantM,
            pq.absorptionPpm,
            pq.assimilationPpm,
            pq.sdaPpm,
            headroom,
            feedScratch
          );
        }
      }
    }
  }

  private runPrepareStages(
    tx: EnergyTransaction,
    targetTick: number,
    speciesCaches: SpeciesRuntimeCache[],
    isLegacyMode: boolean,
    hasAnyExternalSource: boolean,
    conservativePreyProvider: DeterministicPreyFoodProvider | null
  ): void {
    const draftCount = this.curDraftCount;
    const draftCanonicalOrder = this.draftCanonicalOrder;
    const draftSlot = this.draftSlot;
    const draftFlags = this.draftFlags;
    const draftCellIndex = this.draftCellIndex;
    const draftSpeciesIdx = this.draftSpeciesIdx;
    const draftStructMassQ = this.draftStructMassQ;
    const draftMaxReserveMassQ = this.draftMaxReserveMassQ;
    const draftCarryCreditQ = this.draftCarryCreditQ;
    const draftExternalDeltaQ = this.draftExternalDeltaQ;
    const draftMetabolicDemandQ = this.draftMetabolicDemandQ;
    const draftHealingDemandQ = this.draftHealingDemandQ;
    const draftBurnMassQ = this.draftBurnMassQ;
    const draftPostMetabCarryQ = this.draftPostMetabCarryQ;
    const draftNextCooldown = this.draftNextCooldown;
    const draftOffspringDelta = this.draftOffspringDelta;
    const draftGrowthTargetStructQ = this.draftGrowthTargetStructQ;
    const draftNextStage = this.draftNextStage;

    const entityStore = this.entityStore;
    const energyGrid = this.energyGrid;
    const useDirectEntity = this.useDirectEntityStore;
    const useDirectGrid = this.useDirectEnergyGrid;
    const entityBack = useDirectEntity ? entityStore._getChannelStore().back : null;
    const gridBack = useDirectGrid ? energyGrid._getChannelStore().back : null;
    const esStructBack = entityBack ? entityBack[0] : null;
    const esResBack = entityBack ? entityBack[2] : null;
    const gridWidth = this.grid.width;

    // 3a. Legacy external FoodProvider tick regeneration (only in legacy mode)
    if (isLegacyMode && this.foodProvider.stepTick) {
      this.foodProvider.stepTick(targetTick);
    }

    // 3b. Photosynthesis (SUN + ABIOTIC -> CELL_PLANT)
    const photoCount = this.curPhotoCount;
    if (photoCount > 0) {
      const photoCellIdx = this.photoCellIdx;
      const photoGainMassQ = this.photoGainMassQ;
      const photoGainEnergyQ = this.photoGainEnergyQ;
      for (let i = 0; i < photoCount; i++) {
        tx.postPhotosynthesisPairFast(
          PR_PHOTOSYNTHESIS,
          AK_CELL_PLANT,
          photoCellIdx[i],
          photoGainMassQ[i],
          photoGainEnergyQ[i]
        );
      }
    }

    // 3c. Conservative prey regeneration (CELL_PLANT + CELL_DETRITUS -> preyStore slots)
    if (conservativePreyProvider) {
      conservativePreyProvider.stepTickConservative(tx, targetTick);
    }

    // 3d. Reconcile any legacy test-harness edits to `org.energy` before metabolism/feeding
    if (isLegacyMode) {
      const esResFront = entityStore._getChannelStore().front[2];
      for (let ci = 0; ci < draftCount; ci++) {
        const dIdx = draftCanonicalOrder[ci];
        const extDeltaQ = draftExternalDeltaQ[dIdx];
        const slot = draftSlot[dIdx];
        if (extDeltaQ < 0) {
          const avail = useDirectEntity ? esResFront[slot] : entityStore.reserveMassQ(slot);
          const drainM = -extDeltaQ < avail ? -extDeltaQ : avail;
          if (drainM > 0) {
            const drainE =
              drainM <= RESERVE_SAFE_MASS_LIMIT ? drainM * 30 : _energyOfMass(drainM, _RHO_RESERVE);
            tx.postConsumePairFast(PR_METABOLISM, AK_ORGANISM_RESERVE, slot, drainM, drainE);
          }
        } else if (extDeltaQ > 0) {
          const addM = extDeltaQ;
          const addE = addM <= RESERVE_SAFE_MASS_LIMIT ? addM * 30 : _energyOfMass(addM, _RHO_RESERVE);
          this.reusableExternalDelta.massQ = addM;
          this.reusableExternalDelta.energyQ = addE;
          this.ledger.importExternal(LEGACY_FOOD_ESCROW_SLOT, this.reusableExternalProvider);
          tx.transferBiomass(
            PostingReason.INGESTION,
            AccountKind.ESCROW,
            LEGACY_FOOD_ESCROW_SLOT,
            AK_ORGANISM_RESERVE,
            slot,
            addM,
            addE
          );
        }
      }
    }

    // 3e. Organism baseline & healing metabolism
    const metabScratch = this.metabScratch;
    for (let ci = 0; ci < draftCount; ci++) {
      const dIdx = draftCanonicalOrder[ci];
      const healQ = draftHealingDemandQ[dIdx];
      const extDeltaQ = draftExternalDeltaQ[dIdx];
      const slot = draftSlot[dIdx];
      if (healQ === 0 && extDeltaQ === 0) {
        const burnMassQ = draftBurnMassQ[dIdx];
        if (burnMassQ > 0) {
          const burnEnergyQ =
            burnMassQ <= RESERVE_SAFE_MASS_LIMIT
              ? burnMassQ * 30
              : _energyOfMass(burnMassQ, _RHO_RESERVE);
          tx.postConsumePairFast(PR_METABOLISM, AK_ORGANISM_RESERVE, slot, burnMassQ, burnEnergyQ);
        }
      } else {
        const stagedResM = esResBack !== null
          ? esResBack[slot]
          : useDirectEntity
            ? entityStore.stagedReserveMassUnsafe(slot)
            : Number(tx.stagedMassQ(AK_ORGANISM_RESERVE, slot));
        const totalBurnDemandQ = _safeAdd(draftMetabolicDemandQ[dIdx], healQ);
        _stageMetabolismFast(tx, slot, stagedResM, totalBurnDemandQ, draftCarryCreditQ[dIdx], metabScratch);
        draftPostMetabCarryQ[dIdx] = metabScratch.nextCarryCreditQ;
      }
    }

    // 3f. Foraging: only iterate pools that actually have requests/grants
    if (this.externalPlantSource || this.curPlantDirtyCount > 0) {
      this.stagePoolForaging(
        tx,
        speciesCaches,
        targetTick,
        useDirectEntity,
        useDirectGrid,
        0,
        this.externalPlantSource,
        EXTERNAL_PLANT_ESCROW_SLOT,
        this.externalPlantSource ? this.draftReqPlantQ : this.draftGrantPlantQ,
        entityBack,
        gridBack
      );
    }
    if (this.externalDetritusSource || this.curDetritusDirtyCount > 0) {
      this.stagePoolForaging(
        tx,
        speciesCaches,
        targetTick,
        useDirectEntity,
        useDirectGrid,
        1,
        this.externalDetritusSource,
        EXTERNAL_DETRITUS_ESCROW_SLOT,
        this.externalDetritusSource ? this.draftReqDetritusQ : this.draftGrantDetritusQ,
        entityBack,
        gridBack
      );
    }
    if (this.externalCarrionSource || this.curCarrionDirtyCount > 0) {
      this.stagePoolForaging(
        tx,
        speciesCaches,
        targetTick,
        useDirectEntity,
        useDirectGrid,
        2,
        this.externalCarrionSource,
        EXTERNAL_CARRION_ESCROW_SLOT,
        this.externalCarrionSource ? this.draftReqCarrionQ : this.draftGrantCarrionQ,
        entityBack,
        gridBack
      );
    }

    const feedScratch = this.feedScratch;
    const predBiteCount = this.curPredBiteCount;
    if (predBiteCount > 0) {
      const predBitePredDraft = this.predBitePredDraft;
      const predBitePreyDraft = this.predBitePreyDraft;
      const predBiteMassQ = this.predBiteMassQ;
      for (let i = 0; i < predBiteCount; i++) {
        const predIdx = predBitePredDraft[i];
        if ((draftFlags[predIdx] & FLAG_DIED) !== 0) continue;
        const preyIdx = predBitePreyDraft[i];
        const predSlot = draftSlot[predIdx];
        const preySlot = draftSlot[preyIdx];

        const predStructM = esStructBack !== null
          ? esStructBack[predSlot]
          : useDirectEntity
            ? entityStore.stagedStructMassUnsafe(predSlot)
            : Number(tx.stagedMassQ(AK_ORGANISM_STRUCT, predSlot));
        const predResM = esResBack !== null
          ? esResBack[predSlot]
          : useDirectEntity
            ? entityStore.stagedReserveMassUnsafe(predSlot)
            : Number(tx.stagedMassQ(AK_ORGANISM_RESERVE, predSlot));
        const pq = speciesCaches[draftSpeciesIdx[predIdx]].pq;
        let maxPredResM: number;
        if (predStructM === draftStructMassQ[predIdx]) {
          maxPredResM = draftMaxReserveMassQ[predIdx];
        } else {
          const prod = predStructM * pq.maxReserveRatioScaled;
          maxPredResM =
            prod <= LOCAL_MAX_SAFE_INT
              ? (prod - (prod % LOCAL_PPM)) / LOCAL_PPM
              : _scaleByRatio(predStructM, pq.maxReserveRatioScaled, LOCAL_PPM, 'floor');
        }
        const headroom = maxPredResM - predResM;
        if (headroom <= 0) continue;

        const preyStructM = esStructBack !== null
          ? esStructBack[preySlot]
          : useDirectEntity
            ? entityStore.stagedStructMassUnsafe(preySlot)
            : Number(tx.stagedMassQ(AK_ORGANISM_STRUCT, preySlot));
        const preyResM = esResBack !== null
          ? esResBack[preySlot]
          : useDirectEntity
            ? entityStore.stagedReserveMassUnsafe(preySlot)
            : Number(tx.stagedMassQ(AK_ORGANISM_RESERVE, preySlot));
        const preyTotalM = _safeAdd(preyStructM, preyResM);
        const biteM = predBiteMassQ[i] < preyTotalM ? predBiteMassQ[i] : preyTotalM;
        if (biteM > 0) {
          _stagePreyPredationFast(
            tx,
            preySlot,
            preyStructM,
            preyResM,
            predSlot,
            draftCellIndex[predIdx],
            biteM,
            pq.absorptionPpm,
            pq.assimilationPpm,
            pq.sdaPpm,
            headroom,
            feedScratch
          );
        }
      }
    }

    // Background prey pool or legacy FoodProvider foraging
    if (this.externalPreySource) {
      const extPrey = this.externalPreySource;
      const draftReqPreyQ = this.draftReqPreyQ;
      const draftOrgId = this.draftOrgId;
      const reqs: CompetitiveConsumerRequest[] = [];
      for (let ci = 0; ci < draftCount; ci++) {
        const dIdx = draftCanonicalOrder[ci];
        const reqM = draftReqPreyQ[dIdx];
        if (reqM <= 0 || (draftFlags[dIdx] & FLAG_DIED) !== 0) continue;
        const cellIdx = draftCellIndex[dIdx];
        reqs.push({
          organismId: draftOrgId[dIdx],
          entitySlot: draftSlot[dIdx],
          cellIndex: cellIdx,
          detritusCellIndex: cellIdx,
          requestedMassQ: reqM,
          profile: speciesCaches[draftSpeciesIdx[dIdx]].profile,
          escrowSlot: EXTERNAL_PREY_ESCROW_SLOT,
        });
      }
      if (reqs.length > 0) {
        stageCompetitiveTransactionalForaging(this.ledger, tx, extPrey, entityStore, reqs, targetTick);
      }
    } else if (conservativePreyProvider && this.curPreyDirtyCount > 0) {
      const draftGrantPreyQ = this.draftGrantPreyQ;
      for (let ci = 0; ci < draftCount; ci++) {
        const dIdx = draftCanonicalOrder[ci];
        const grantPreyM = draftGrantPreyQ[dIdx];
        if ((draftFlags[dIdx] & FLAG_DIED) !== 0 || grantPreyM <= 0) continue;

        const predSlot = draftSlot[dIdx];
        const predStructM = esStructBack !== null
          ? esStructBack[predSlot]
          : useDirectEntity
            ? entityStore.stagedStructMassUnsafe(predSlot)
            : Number(tx.stagedMassQ(AK_ORGANISM_STRUCT, predSlot));
        const predResM = esResBack !== null
          ? esResBack[predSlot]
          : useDirectEntity
            ? entityStore.stagedReserveMassUnsafe(predSlot)
            : Number(tx.stagedMassQ(AK_ORGANISM_RESERVE, predSlot));
        const pq = speciesCaches[draftSpeciesIdx[dIdx]].pq;
        let maxPredResM: number;
        if (predStructM === draftStructMassQ[dIdx]) {
          maxPredResM = draftMaxReserveMassQ[dIdx];
        } else {
          const prod = predStructM * pq.maxReserveRatioScaled;
          maxPredResM =
            prod <= LOCAL_MAX_SAFE_INT
              ? (prod - (prod % LOCAL_PPM)) / LOCAL_PPM
              : _scaleByRatio(predStructM, pq.maxReserveRatioScaled, LOCAL_PPM, 'floor');
        }
        const headroom = maxPredResM - predResM;
        if (headroom <= 0) continue;

        const cellIdx = draftCellIndex[dIdx];
        const preySlot = cellIdx; // conservative preySlotOffset === 0
        const preyStructM = esStructBack !== null
          ? esStructBack[preySlot]
          : useDirectEntity
            ? entityStore.stagedStructMassUnsafe(preySlot)
            : Number(tx.stagedMassQ(AK_ORGANISM_STRUCT, preySlot));
        const preyResM = esResBack !== null
          ? esResBack[preySlot]
          : useDirectEntity
            ? entityStore.stagedReserveMassUnsafe(preySlot)
            : Number(tx.stagedMassQ(AK_ORGANISM_RESERVE, preySlot));
        const preyTotalM = _safeAdd(preyStructM, preyResM);
        const biteM = grantPreyM < preyTotalM ? grantPreyM : preyTotalM;
        if (biteM > 0) {
          _stagePreyPredationFast(
            tx,
            preySlot,
            preyStructM,
            preyResM,
            predSlot,
            cellIdx,
            biteM,
            pq.absorptionPpm,
            pq.assimilationPpm,
            pq.sdaPpm,
            headroom,
            feedScratch
          );
        }
      }
    } else if (isLegacyMode) {
      const draftReqLegacyNorm = this.draftReqLegacyNorm;
      for (let ci = 0; ci < draftCount; ci++) {
        const dIdx = draftCanonicalOrder[ci];
        const reqNorm = draftReqLegacyNorm[dIdx];
        if ((draftFlags[dIdx] & FLAG_DIED) !== 0 || reqNorm <= 0) continue;

        const slot = draftSlot[dIdx];
        const stagedResM = esResBack !== null
          ? esResBack[slot]
          : useDirectEntity
            ? entityStore.stagedReserveMassUnsafe(slot)
            : Number(tx.stagedMassQ(AK_ORGANISM_RESERVE, slot));
        const maxResM = draftMaxReserveMassQ[dIdx];
        const headroom = maxResM > stagedResM ? maxResM - stagedResM : 0;
        if (headroom <= 0) continue;

        const cellIdx = draftCellIndex[dIdx];
        const cy = (cellIdx / gridWidth) | 0;
        const cx = cellIdx - cy * gridWidth;
        const env = this.populateEnvContext(cx, cy, cellIdx, targetTick);
        const gainedNorm = this.foodProvider.consumePrey(env, reqNorm);
        if (gainedNorm > 0) {
          const clampedGain = gainedNorm < 1 ? gainedNorm : 1;
          const rawMass = applyPpmFloorFast(maxResM, _fractionToPpmFloorFast(clampedGain));
          const depositM = headroom < rawMass ? headroom : rawMass;
          if (depositM > 0) {
            const depositE =
              depositM <= RESERVE_SAFE_MASS_LIMIT
                ? depositM * 30
                : _energyOfMass(depositM, _RHO_RESERVE);
            this.reusableExternalDelta.massQ = depositM;
            this.reusableExternalDelta.energyQ = depositE;
            this.ledger.importExternal(LEGACY_FOOD_ESCROW_SLOT, this.reusableExternalProvider);
            tx.transferBiomass(
              PostingReason.INGESTION,
              AccountKind.ESCROW,
              LEGACY_FOOD_ESCROW_SLOT,
              AK_ORGANISM_RESERVE,
              slot,
              depositM,
              depositE
            );
          }
        }
      }
    }

    // 3f'. Spatial mode: locomotion, sprint and capture-attempt energy (ORGANISM_RESERVE -> HEAT),
    // paid through the same metabolism posting as every other activity cost
    if (this.spatial !== null) {
      const spatial = this.spatial;
      for (let ci = 0; ci < draftCount; ci++) {
        const dIdx = draftCanonicalOrder[ci];
        if ((draftFlags[dIdx] & FLAG_DIED) !== 0) continue;
        const slot = draftSlot[dIdx];
        const moveDemandQ = spatial.stagedDemandQ(slot);
        if (moveDemandQ <= 0) continue;
        const stagedResM = esResBack !== null
          ? esResBack[slot]
          : useDirectEntity
            ? entityStore.stagedReserveMassUnsafe(slot)
            : Number(tx.stagedMassQ(AK_ORGANISM_RESERVE, slot));
        _stageMetabolismFast(tx, slot, stagedResM, moveDemandQ, draftPostMetabCarryQ[dIdx], metabScratch);
        draftPostMetabCarryQ[dIdx] = metabScratch.nextCarryCreditQ;
      }
    }

    // 3g. Somatic Growth
    if (draftCount > 0) {
      for (let ci = 0; ci < draftCount; ci++) {
        const dIdx = draftCanonicalOrder[ci];
        if ((draftFlags[dIdx] & FLAG_DIED) !== 0 || draftNextStage[dIdx] === STAGE_EGG) continue;
        const targetStructQ = draftGrowthTargetStructQ[dIdx];
        if ((draftFlags[dIdx] & FLAG_TOUCHED_PRED) === 0 && draftStructMassQ[dIdx] >= targetStructQ) {
          continue;
        }

        const slot = draftSlot[dIdx];
        const stagedStructM = esStructBack !== null
          ? esStructBack[slot]
          : useDirectEntity
            ? entityStore.stagedStructMassUnsafe(slot)
            : Number(tx.stagedMassQ(AK_ORGANISM_STRUCT, slot));
        if (stagedStructM >= targetStructQ) continue;
        const stagedResM = esResBack !== null
          ? esResBack[slot]
          : useDirectEntity
            ? entityStore.stagedReserveMassUnsafe(slot)
            : Number(tx.stagedMassQ(AK_ORGANISM_RESERVE, slot));
        if (stagedResM > 0) {
          const availAbiotic = tx.stagedAbioticMassQFast();
          const pq = speciesCaches[draftSpeciesIdx[dIdx]].pq;
          _stageSomaticGrowthFast(
            tx,
            slot,
            stagedStructM,
            stagedResM,
            availAbiotic,
            targetStructQ,
            this.physioTradeOffs ? scaledAllocPpm(pq.allocPpm, this.draftGrowthScale[dIdx]) : pq.allocPpm,
            pq.growthEffPpm
          );
        }
      }
    }

    // 3h. Reproduction provisioning
    const reproPlanCount = this.curReproPlanCount;
    if (reproPlanCount > 0) {
      const rpFemaleDraft = this.rpFemaleDraft;
      const rpMaleDraft = this.rpMaleDraft;
      const rpStatus = this.rpStatus;
      const rpFemaleCd = this.rpFemaleCd;
      const rpMaleCd = this.rpMaleCd;
      const rpFatherMatingDemandQ = this.rpFatherMatingDemandQ;
      const rpEggStart = this.rpEggStart;
      const rpEggCount = this.rpEggCount;
      const eggDraftSlot = this.eggDraftSlot;
      const eggProvisioned = this.eggProvisioned;
      const reproScratch = this.reproScratch;

      for (let i = 0; i < reproPlanCount; i++) {
        const fIdx = rpFemaleDraft[i];
        const mIdx = rpMaleDraft[i];
        if (((draftFlags[fIdx] | draftFlags[mIdx]) & FLAG_DIED) !== 0) continue;

        const status = rpStatus[i];
        const eCnt = rpEggCount[i];
        if (status !== 0 || eCnt === 0) {
          draftNextCooldown[fIdx] = rpFemaleCd[i];
          draftNextCooldown[mIdx] = rpMaleCd[i];
          continue;
        }

        const fSlot = draftSlot[fIdx];
        const sc = speciesCaches[draftSpeciesIdx[fIdx]];
        const eggStructMassQ = sc.eggStructMassQ;
        const eggReserveMassQ = sc.eggReserveMassQ;
        const reproEffPpm = sc.pq.reproEffPpm;
        const eStart = rpEggStart[i];
        const eEnd = eStart + eCnt;
        let provisionedCount = 0;

        for (let epIdx = eStart; epIdx < eEnd; epIdx++) {
          const motherResM = esResBack !== null
            ? esResBack[fSlot]
            : useDirectEntity
              ? entityStore.stagedReserveMassUnsafe(fSlot)
              : Number(tx.stagedMassQ(AK_ORGANISM_RESERVE, fSlot));
          const availAbiotic = tx.stagedAbioticMassQFast();
          const ok = _stageReproductionProvisioningFast(
            tx,
            fSlot,
            eggDraftSlot[epIdx],
            motherResM,
            availAbiotic,
            eggStructMassQ,
            eggReserveMassQ,
            reproEffPpm,
            reproScratch
          );
          if (ok) {
            eggProvisioned[epIdx] = 1;
            provisionedCount += 1;
          }
        }

        if (provisionedCount > 0) {
          draftNextCooldown[fIdx] = rpFemaleCd[i];
          draftNextCooldown[mIdx] = rpMaleCd[i];
          draftOffspringDelta[fIdx] += provisionedCount;
          draftOffspringDelta[mIdx] += provisionedCount;
          const fMatingQ = rpFatherMatingDemandQ[i];
          if (fMatingQ > 0) {
            const mSlot = draftSlot[mIdx];
            const maleResM = esResBack !== null
              ? esResBack[mSlot]
              : useDirectEntity
                ? entityStore.stagedReserveMassUnsafe(mSlot)
                : Number(tx.stagedMassQ(AK_ORGANISM_RESERVE, mSlot));
            _stageMetabolismFast(tx, mSlot, maleResM, fMatingQ, draftPostMetabCarryQ[mIdx], metabScratch);
            draftPostMetabCarryQ[mIdx] = metabScratch.nextCarryCreditQ;
          }
        }
      }
    }

    // 3i. Stage deaths (`stageDeathToCarrionFast` moves remaining STRUCT + RESERVE -> CELL_CARRION)
    let newlyDiedCellCount = 0;
    const newlyDiedCellFlags = this.newlyDiedCellFlags;
    const newlyDiedCellList = this.newlyDiedCellList;
    if (this.curDiedCount > 0) {
      for (let ci = 0; ci < draftCount; ci++) {
        const dIdx = draftCanonicalOrder[ci];
        if ((draftFlags[dIdx] & FLAG_DIED) === 0) continue;
        const slot = draftSlot[dIdx];
        const remStructM = esStructBack !== null
          ? esStructBack[slot]
          : useDirectEntity
            ? entityStore.stagedStructMassUnsafe(slot)
            : Number(tx.stagedMassQ(AK_ORGANISM_STRUCT, slot));
        const remResM = esResBack !== null
          ? esResBack[slot]
          : useDirectEntity
            ? entityStore.stagedReserveMassUnsafe(slot)
            : Number(tx.stagedMassQ(AK_ORGANISM_RESERVE, slot));
        if (remStructM > 0 || remResM > 0) {
          const cIdx = draftCellIndex[dIdx];
          _stageDeathToCarrionFast(tx, slot, cIdx, remStructM, remResM);
          if (newlyDiedCellFlags[cIdx] === 0) {
            newlyDiedCellFlags[cIdx] = 1;
            newlyDiedCellList[newlyDiedCellCount++] = cIdx;
          }
        }
      }
    }
    this.curNewlyDiedCellCount = newlyDiedCellCount;

    // 3j. Decomposition (`CELL_CARRION` & `CELL_DETRITUS` -> `ABIOTIC` + `HEAT`), runs even at 0 alive organisms
    const carrionRatePpm = this.carrionDecompositionRatePpm;
    const detritusRatePpm = this.detritusDecompositionRatePpm;
    if (carrionRatePpm > 0 || detritusRatePpm > 0) {
      const cellCount = this.grid.cellCount;
      const canSkipEmptyCarrion = isLegacyMode && newlyDiedCellCount === 0;
      const canSkipEmptyDetritus = isLegacyMode && !hasAnyExternalSource;

      if (!canSkipEmptyCarrion || !canSkipEmptyDetritus) {
        if (gridBack !== null) {
          const carrionMBack = gridBack[2];
          const carrionEBack = gridBack[3];
          const detritusBack = gridBack[4];
          const doCarrion = carrionRatePpm > 0;
          const doDetritus = detritusRatePpm > 0 && !canSkipEmptyDetritus;
          if (doCarrion && doDetritus) {
            for (let c = 0; c < cellCount; c++) {
              const cm = carrionMBack[c];
              if (cm > 0) {
                _stageCarrionDecompositionFast(tx, c, cm, carrionEBack[c], carrionRatePpm);
              }
              const dm = detritusBack[c];
              if (dm > 0) {
                _stageDetritusDecompositionFast(tx, c, dm, detritusRatePpm);
              }
            }
          } else {
            for (let c = 0; c < cellCount; c++) {
              if (doCarrion) {
                const cm = carrionMBack[c];
                if (cm > 0) {
                  _stageCarrionDecompositionFast(tx, c, cm, carrionEBack[c], carrionRatePpm);
                }
              }
              if (doDetritus) {
                const dm = detritusBack[c];
                if (dm > 0) {
                  _stageDetritusDecompositionFast(tx, c, dm, detritusRatePpm);
                }
              }
            }
          }
        } else {
          for (let c = 0; c < cellCount; c++) {
            if (carrionRatePpm > 0) {
              if (energyGrid.getMassQ(POOL_CARRION, c) > 0 || newlyDiedCellFlags[c] !== 0) {
                const cm = Number(tx.stagedMassQ(AK_CELL_CARRION, c));
                if (cm > 0) {
                  const ce = Number(tx.stagedEnergyQ(AK_CELL_CARRION, c));
                  _stageCarrionDecompositionFast(tx, c, cm, ce, carrionRatePpm);
                }
              }
            }
            if (detritusRatePpm > 0 && !canSkipEmptyDetritus) {
              if (energyGrid.getMassQ(POOL_DETRITUS, c) > 0 || !isLegacyMode) {
                const dm = Number(tx.stagedMassQ(AK_CELL_DETRITUS, c));
                if (dm > 0) {
                  _stageDetritusDecompositionFast(tx, c, dm, detritusRatePpm);
                }
              }
            }
          }
        }
      }
    }
  }

  private runCommitAndPostCommit(
    targetTick: number,
    plannedNextId: number,
    sCount: number,
    speciesList: readonly SpeciesDefinition[],
    speciesCaches: SpeciesRuntimeCache[],
    computeStatsForTick: boolean,
    pushToHistory: boolean
  ): BiologyTickSummary {
    const draftCount = this.curDraftCount;
    const eggPlanCount = this.curEggPlanCount;
    const entityStore = this.entityStore;
    const organismIdToSlot = this.organismIdToSlot;
    const slotCarryCreditQ = this.slotCarryCreditQ;
    const slotLastSyncedEnergy = this.slotLastSyncedEnergy;
    const slotMaxReserveMassQ = this.slotMaxReserveMassQ;
    const draftOrg = this.draftOrg;
    const draftPop = this.draftPop;
    const draftDeathCause = this.draftDeathCause;
    const draftSlot = this.draftSlot;
    const draftSpeciesIdx = this.draftSpeciesIdx;
    const draftNextAgeTicks = this.draftNextAgeTicks;
    const draftNextStage = this.draftNextStage;
    const draftNextCooldown = this.draftNextCooldown;
    const draftFlags = this.draftFlags;
    const draftKillerId = this.draftKillerId;
    const draftOffspringDelta = this.draftOffspringDelta;
    const draftStructMassQ = this.draftStructMassQ;
    const draftMaxReserveMassQ = this.draftMaxReserveMassQ;
    const draftPostMetabCarryQ = this.draftPostMetabCarryQ;
    const draftNextHealth = this.draftNextHealth;
    const draftDevPhys = this.draftDevPhys;
    const draftDevNeural = this.draftDevNeural;
    const draftDevSenesc = this.draftDevSenesc;
    const phenCtx = this.reusablePhenContext;
    const touchedPops = this.stepTouchedPops;
    const popBySpeciesIdx = this.stepPopBySpeciesIdx;

    this.tickCount = targetTick;
    this.nextId = plannedNextId;

    const committedDeathEvents = this.stepCommittedDeathEvents;
    committedDeathEvents.length = 0;
    for (let i = 0; i < touchedPops.length; i++) {
      touchedPops[i].beginTick();
    }

    const useDirectEntity = this.useDirectEntityStore;
    const esFront = useDirectEntity ? entityStore._getChannelStore().front : null;
    const esStructFront = esFront ? esFront[0] : null;
    const esResFront = esFront ? esFront[2] : null;

    const hasDeathListeners = this.deathListeners.size > 0;
    // Iterate in gather order (0..draftCount-1) to preserve committedDeathEvents emission order
    for (let dIdx = 0; dIdx < draftCount; dIdx++) {
      const org = draftOrg[dIdx];
      const pop = draftPop[dIdx];
      if ((draftFlags[dIdx] & FLAG_DIED) !== 0) {
        const killerVal = draftKillerId[dIdx];
        const cause = draftDeathCause[dIdx] ?? 'starvation';
        if (hasDeathListeners) {
          _processOrganismDeath(
            org,
            targetTick,
            cause,
            killerVal > 0 ? killerVal : null,
            (event) => {
              pop.recordDeath(event.cause);
              committedDeathEvents.push(event);
            }
          );
        } else if (org.alive) {
          org.alive = false;
          org.stage = 'dead';
          org.health = 0;
          org.deathTick = targetTick;
          org.deathCause = cause;
          pop.recordDeath(cause);
        }
        this.pendingCompactPops.add(pop);
        continue;
      }

      org.ageTicks = draftNextAgeTicks[dIdx];
      org.stage = STAGE_NAMES[draftNextStage[dIdx]];
      org.reproductionCooldown = draftNextCooldown[dIdx];
      const nextHealth = draftNextHealth[dIdx];
      org.health = nextHealth;
      const offDelta = draftOffspringDelta[dIdx];
      if (offDelta > 0) {
        org.offspringCount += offDelta;
      }

      const slot = draftSlot[dIdx];
      const sc = speciesCaches[draftSpeciesIdx[dIdx]];
      const pq = sc.pq;
      const newStructQ = esStructFront !== null ? esStructFront[slot] : entityStore.structMassQ(slot);
      const newReserveQ = esResFront !== null ? esResFront[slot] : entityStore.reserveMassQ(slot);
      let newMaxResQ: number;
      if (newStructQ === draftStructMassQ[dIdx]) {
        newMaxResQ = draftMaxReserveMassQ[dIdx];
      } else {
        const ratioProd = newStructQ * pq.maxReserveRatioScaled;
        newMaxResQ =
          ratioProd <= LOCAL_MAX_SAFE_INT
            ? (ratioProd - (ratioProd % LOCAL_PPM)) / LOCAL_PPM
            : _scaleByRatio(newStructQ, pq.maxReserveRatioScaled, LOCAL_PPM, 'floor');
      }
      const rawNorm = newMaxResQ > 0 ? newReserveQ / newMaxResQ : 0;
      const newNormEnergy = rawNorm < 1 ? rawNorm : 1;

      org.energy = newNormEnergy;
      slotCarryCreditQ[slot] = draftPostMetabCarryQ[dIdx];
      slotMaxReserveMassQ[slot] = newMaxResQ;
      slotLastSyncedEnergy[slot] = newNormEnergy;

      phenCtx.physicalMaturityScale = draftDevPhys[dIdx];
      phenCtx.neuralMaturityScale = draftDevNeural[dIdx];
      phenCtx.senescencePhysicalScale = draftDevSenesc[dIdx];
      phenCtx.conditionScale =
        0.45 + 0.55 * Math.min(1, Math.max(0, nextHealth * 0.65 + newNormEnergy * 0.35));
      _computePhenotype(org.genome, sc.schema, phenCtx, org.phenotype);
    }

    if (eggPlanCount > 0) {
      const eggOrg = this.eggOrg;
      const eggSpeciesIdx = this.eggSpeciesIdx;
      const eggDraftSlot = this.eggDraftSlot;
      const eggIsReused = this.eggIsReused;
      const eggProvisioned = this.eggProvisioned;

      let plannedReused = 0;
      let plannedFresh = 0;
      let committedEggs = 0;
      for (let i = 0; i < eggPlanCount; i++) {
        if (eggIsReused[i] !== 0) {
          plannedReused += 1;
        } else {
          plannedFresh += 1;
        }
        if (eggProvisioned[i] === 0) continue;

        committedEggs += 1;
        const sIdx = eggSpeciesIdx[i];
        const sc = speciesCaches[sIdx];
        const egg = eggOrg[i];
        const slot = eggDraftSlot[i];
        organismIdToSlot.set(egg.id, slot);
        slotCarryCreditQ[slot] = 0;
        slotMaxReserveMassQ[slot] = sc.eggMaxReserveMassQ;
        const actualResQ = esResFront !== null ? esResFront[slot] : entityStore.reserveMassQ(slot);
        const rawEggNorm = sc.eggMaxReserveMassQ > 0 ? actualResQ / sc.eggMaxReserveMassQ : 0;
        const normEggE = rawEggNorm < 1 ? rawEggNorm : 1;
        egg.energy = normEggE;
        slotLastSyncedEnergy[slot] = normEggE;
        phenCtx.physicalMaturityScale = 0.15;
        phenCtx.neuralMaturityScale = 0.15;
        phenCtx.senescencePhysicalScale = 1.0;
        phenCtx.conditionScale =
          0.45 + 0.55 * Math.min(1, Math.max(0, egg.health * 0.65 + normEggE * 0.35));
        _computePhenotype(egg.genome, sc.schema, phenCtx, egg.phenotype);
      }

      this.freeOrganismSlots.length -= plannedReused;
      this.nextFreshOrganismSlot += plannedFresh;
      if (committedEggs < eggPlanCount) {
        for (let i = 0; i < eggPlanCount; i++) {
          if (eggProvisioned[i] === 0) {
            this.freeOrganismSlots.push(eggDraftSlot[i]);
          }
        }
      }

      const speciesEggCount = this.stepSpeciesEggCount;
      const speciesEggStart = this.stepSpeciesEggStart;
      for (let s = 0; s < sCount; s++) {
        const eCnt = speciesEggCount[s];
        if (eCnt <= 0) continue;
        const eStart = speciesEggStart[s];
        popBySpeciesIdx[s]!.addPrevalidatedRange(
          eggOrg,
          eStart,
          eStart + eCnt,
          eggProvisioned,
          'birth'
        );
      }
    }

    // Spatial mode: the energy transaction is durable, so the staged movement plan becomes current
    // (positions, behavior state, memory). Pure typed-array copies; cannot throw.
    if (this.spatial !== null) {
      const movedCount = this.spatial.commitTick();
      if (movedCount > 0) {
        for (let i = 0; i < touchedPops.length; i++) {
          touchedPops[i].invalidateSpatialIndex();
        }
      }
      // Newly laid eggs get their spatial state after the mother's own state (including what she
      // learned this tick) became current, so they can inherit her knowledge of water and food.
      const eggOrg = this.eggOrg;
      const eggProvisioned = this.eggProvisioned;
      const eggDraftSlot = this.eggDraftSlot;
      for (let i = 0; i < eggPlanCount; i++) {
        if (eggProvisioned[i] === 0) continue;
        const egg = eggOrg[i];
        const motherSlot = egg.parentAId !== null ? organismIdToSlot.get(egg.parentAId) : undefined;
        this.spatial.initSlot(eggDraftSlot[i], egg.id, egg.cellIndex, targetTick, motherSlot ?? -1);
      }
    }

    // Evolution mode: register daughter species, move their founders, record lineage events.
    if (this.evolution !== null) {
      this.commitEvolution(targetTick);
    }

    // =========================================================================
    // PHASE 5: POST_COMMIT (Listeners, Diagnostics, Compaction — never rolls back physics)
    // =========================================================================
    this.isPostCommit = true;
    try {
      for (let i = 0; i < committedDeathEvents.length; i++) {
        this.dispatchDeathEvent(committedDeathEvents[i]);
      }

      if (this.trackMutationEvents && eggPlanCount > 0) {
        for (let i = 0; i < eggPlanCount; i++) {
          if (this.eggProvisioned[i] === 0) continue;
          const records = this.eggMutationRecords[i];
          if (!records || records.length === 0) continue;
          const egg = this.eggOrg[i];
          const sc = speciesCaches[this.eggSpeciesIdx[i]];
          this.trackedMutations.push({
            tick: targetTick,
            speciesId: sc.species.id,
            organismId: egg.id,
            records: records as MutationRecord[],
          });
        }
      }

      const statsBySpecies: Record<string, PopulationStats> = {};
      if (computeStatsForTick) {
        for (let s = 0; s < sCount; s++) {
          const pop = popBySpeciesIdx[s];
          if (!pop) continue;
          statsBySpecies[speciesList[s].id] = pop.computeStats(targetTick);
        }
      }

      const summary: BiologyTickSummary = {
        tick: targetTick,
        statsBySpecies,
      };
      if (pushToHistory) {
        this.history.push(summary);
        if (this.history.length > this.maxHistoryEntries) {
          this.history.shift();
        }
      }
      this.onPhase?.({ tick: targetTick, phase: 'POST_COMMIT' });
      return summary;
    } finally {
      committedDeathEvents.length = 0;
      for (const pop of this.pendingCompactPops) {
        pop.compactDead((deadOrg) => this.releaseOrganismSlot(deadOrg.id));
        pop.rebuildSpatialIndex();
      }
      this.pendingCompactPops.clear();
      this.isPostCommit = false;
      if (this.phylogeny !== null) {
        this.syncPhylogeny(targetTick);
      }
    }
  }

  /**
   * Executes one deterministic biological tick across the atomic transactional pipeline:
   *   GATHER -> RESOLVE -> PREPARE -> COMMIT / ABORT -> POST_COMMIT
   */
  private stepInternal(computeStatsForTick: boolean, pushToHistory: boolean): BiologyTickSummary {
    const rngSnapshot = this.streams.snapshotStates();
    const targetTick = this.tickCount + 1;
    let plannedNextId = this.nextId;

    const lifecycleRng = this.streams.get('biology:lifecycle');
    const geneticsRng = this.streams.get('biology:genetics');
    const mutationRng = this.streams.get('biology:mutation');
    const reproductionRng = this.streams.get('biology:reproduction');
    const speciesList = this.speciesRegistry.list();
    const sCount = speciesList.length;
    const speciesCaches = this.ensureSpeciesCaches(speciesList);

    let tx: EnergyTransaction | null = null;
    let committed = false;
    const isLegacyMode = this.conservationMode === 'legacy-external-escrow';
    const hasAnyExternalSource = Boolean(
      this.externalPlantSource ||
        this.externalPreySource ||
        this.externalCarrionSource ||
        this.externalDetritusSource
    );
    const hasStrictFoodSources = !isLegacyMode || hasAnyExternalSource;
    const legacySnapshotAvailable = isLegacyMode ? new Map<number, number>() : null;

    this.curDraftCount = 0;
    this.curEggPlanCount = 0;
    this.curReproPlanCount = 0;
    this.curPredBiteCount = 0;
    this.curPlantDirtyCount = 0;
    this.curCarrionDirtyCount = 0;
    this.curDetritusDirtyCount = 0;
    this.curPreyDirtyCount = 0;
    this.curAliveDirtyCount = 0;
    this.curPhotoCount = 0;
    this.curPreyRemTouchedCount = 0;
    this.curNewlyDiedCellCount = 0;
    this.curDiedCount = 0;
    this.curGloballySorted = true;
    this.curPrevGlobalId = -1;

    try {
      // =========================================================================
      // PHASE 1: GATHER (Pure inspection & draft preparation — zero live mutation)
      // =========================================================================
      this.onPhase?.({ tick: targetTick, phase: 'GATHER' });

      this.ensureStepSpeciesCapacity(sCount);
      const popBySpeciesIdx = this.stepPopBySpeciesIdx;
      const touchedPops = this.stepTouchedPops;

      let totalUpperOrgs = 0;
      for (let s = 0; s < sCount; s++) {
        const pop = this.populations.get(speciesList[s].id);
        if (pop) {
          popBySpeciesIdx[s] = pop;
          touchedPops.push(pop);
          totalUpperOrgs += pop.size;
        }
      }
      this.ensureDraftCapacity(totalUpperOrgs);
      if (totalUpperOrgs > 0) {
        this.draftDeathCause.fill(null, 0, totalUpperOrgs);
        this.draftKillerId.fill(0, 0, totalUpperOrgs);
        this.draftOffspringDelta.fill(0, 0, totalUpperOrgs);
        this.draftHealingDemandQ.fill(0, 0, totalUpperOrgs);
        this.draftGrantPlantQ.fill(0, 0, totalUpperOrgs);
        this.draftGrantPreyQ.fill(0, 0, totalUpperOrgs);
        this.draftGrantCarrionQ.fill(0, 0, totalUpperOrgs);
        this.draftGrantDetritusQ.fill(0, 0, totalUpperOrgs);
      }
      if (this.activeIdxToDraftIdx.length < totalUpperOrgs) {
        let nextCap = Math.max(256, this.activeIdxToDraftIdx.length);
        while (nextCap < totalUpperOrgs) nextCap *= 2;
        this.activeIdxToDraftIdx = new Int32Array(nextCap);
      }

      const esFront = this.useDirectEntityStore ? this.entityStore._getChannelStore().front : null;
      const entityStructFront = esFront ? esFront[0] : null;
      const entityReserveFront = esFront ? esFront[2] : null;
      const activeMapOffsetRef = { value: 0 };

      for (let s = 0; s < sCount; s++) {
        const pop = popBySpeciesIdx[s];
        if (!pop) continue;
        this.gatherSingleSpeciesDrafts(
          s,
          pop,
          speciesCaches[s],
          isLegacyMode,
          hasStrictFoodSources,
          legacySnapshotAvailable,
          targetTick,
          entityStructFront,
          entityReserveFront,
          activeMapOffsetRef
        );
      }

      if (!this.curGloballySorted && this.curDraftCount > 1) {
        sortInt32IndicesByFloat64Key(this.draftCanonicalOrder, this.draftOrgId, 0, this.curDraftCount - 1);
      }

      if (this.spatial !== null) {
        this.spatial.beginTick(this.prepareSpatialView(targetTick, sCount));
      }

      // =========================================================================
      // PHASE 2: RESOLVE (Deterministic conflict resolution & biological planning)
      // =========================================================================
      this.onPhase?.({ tick: targetTick, phase: 'RESOLVE' });

      if (!isLegacyMode) {
        this.runPhotosynthesisPlan();
      }

      const conservativePreyProvider =
        this.hasConservativePreyProvider && this.foodProvider instanceof DeterministicPreyFoodProvider
          ? this.foodProvider
          : null;

      this.resolveResourceContentionPhase(sCount, conservativePreyProvider);

      this.evaluatePostFeedMortality(
        speciesCaches,
        isLegacyMode,
        legacySnapshotAvailable,
        lifecycleRng
      );

      plannedNextId = this.planReproductionPhase(
        sCount,
        speciesCaches,
        geneticsRng,
        mutationRng,
        reproductionRng,
        targetTick,
        plannedNextId
      );

      // Evolution mode: periodic, read-only divergence & isolation check (staged proposals only)
      if (this.speciationEngine !== null) {
        this.stageSpeciationCheck(targetTick, sCount, speciesList, speciesCaches);
      }

      // Spatial mode: every surviving organism perceives its surroundings, chooses an activity and
      // plans this tick's movement. Results are STAGED; nothing is applied before COMMIT.
      if (this.spatial !== null) {
        this.spatial.planTick();
      }

      // =========================================================================
      // PHASE 2.5: PRE_ALLOCATE (Between transactions — zero semantic state mutated)
      // =========================================================================
      this.onPhase?.({ tick: targetTick, phase: 'PRE_ALLOCATE' });
      if (this.stagedProposals.length > 0) {
        this.preallocateSpeciations();
      }

      const eggPlanCount = this.curEggPlanCount;
      let freshCursor = this.nextFreshOrganismSlot;
      let freeAvail = this.freeOrganismSlots.length;
      if (eggPlanCount > 0) {
        const slots = this.slotPlanSlots;
        const reused = this.slotPlanReused;
        const freeSlots = this.freeOrganismSlots;
        for (let i = 0; i < eggPlanCount; i++) {
          if (freeAvail > 0) {
            freeAvail -= 1;
            slots[i] = freeSlots[freeAvail];
            reused[i] = 1;
          } else {
            slots[i] = freshCursor++;
            reused[i] = 0;
          }
          this.eggDraftSlot[i] = slots[i];
          this.eggIsReused[i] = reused[i];
        }
        this.ensureEntityCapacity(freshCursor);

        const speciesEggCount = this.stepSpeciesEggCount;
        const speciesEggStart = this.stepSpeciesEggStart;
        for (let s = 0; s < sCount; s++) {
          const eCnt = speciesEggCount[s];
          if (eCnt <= 0) continue;
          const pop = popBySpeciesIdx[s]!;
          const eStart = speciesEggStart[s];
          pop.validateBatchRange(this.eggOrg, eStart, eStart + eCnt);
          pop.reserveAdditionalCapacity(eCnt);
        }
      }

      // =========================================================================
      // PHASE 3: PREPARE (Open EnergyTransaction -> Stage all postings -> tx.prepare())
      // =========================================================================
      tx = this.ledger.begin(targetTick);
      this.runPrepareStages(
        tx,
        targetTick,
        speciesCaches,
        isLegacyMode,
        hasAnyExternalSource,
        conservativePreyProvider
      );

      this.onPhase?.({ tick: targetTick, phase: 'PREPARE', tx });
      tx.prepare();

      // =========================================================================
      // PHASE 4 & 5: COMMIT -> POST_COMMIT
      // =========================================================================
      this.onPhase?.({ tick: targetTick, phase: 'COMMIT', tx });
      tx.commit();
      committed = true;
      tx = null; // Once committed, errors inside POST_COMMIT never abort or rewind RNG
      return this.runCommitAndPostCommit(
        targetTick,
        plannedNextId,
        sCount,
        speciesList,
        speciesCaches,
        computeStatsForTick,
        pushToHistory
      );
    } catch (err) {
      // ABORT: roll back staged ledger/stores and restore RNG state only if COMMIT has not completed
      if (!committed) {
        if (tx && (tx.state === 'ACTIVE' || tx.state === 'PREPARED')) {
          tx.abort();
        }
        this.streams.restoreStates(rngSnapshot);
      }
      throw err;
    } finally {
      // Spatial mode: drop every staged decision/movement (after COMMIT they are already applied;
      // after ABORT this is what guarantees coordinates and behavior state stay untouched)
      if (this.spatial !== null) {
        this.spatial.endTick();
      }
      // Reset per-tick sparse dirty cell heads & clear GC object references
      const plantDirtyCount = this.curPlantDirtyCount;
      for (let i = 0; i < plantDirtyCount; i++) {
        this.plantCellHead[this.plantDirtyCells[i]] = -1;
      }
      const carrionDirtyCount = this.curCarrionDirtyCount;
      for (let i = 0; i < carrionDirtyCount; i++) {
        this.carrionCellHead[this.carrionDirtyCells[i]] = -1;
      }
      const detritusDirtyCount = this.curDetritusDirtyCount;
      for (let i = 0; i < detritusDirtyCount; i++) {
        this.detritusCellHead[this.detritusDirtyCells[i]] = -1;
      }
      const preyDirtyCount = this.curPreyDirtyCount;
      for (let i = 0; i < preyDirtyCount; i++) {
        this.preyCellHead[this.preyDirtyCells[i]] = -1;
      }
      const aliveDirtyCount = this.curAliveDirtyCount;
      for (let i = 0; i < aliveDirtyCount; i++) {
        this.aliveCellHead[this.aliveDirtyCells[i]] = -1;
      }
      const photoCount = this.curPhotoCount;
      for (let i = 0; i < photoCount; i++) {
        this.projectedPlantCellMass[this.photoCellIdx[i]] = -1;
      }
      const preyRemTouchedCount = this.curPreyRemTouchedCount;
      for (let i = 0; i < preyRemTouchedCount; i++) {
        this.preyRemTouched[this.preyRemTouchedList[i]] = 0;
      }
      const newlyDiedCellCount = this.curNewlyDiedCellCount;
      for (let i = 0; i < newlyDiedCellCount; i++) {
        this.newlyDiedCellFlags[this.newlyDiedCellList[i]] = 0;
      }
      const mtc = this.mateTouchedCount;
      for (let i = 0; i < mtc; i++) {
        this.mateCellCursor[this.mateCellTouched[i]] = -2;
      }
      this.mateTouchedCount = 0;
      // Staged evolution state never survives the tick (applied at COMMIT or dropped on ABORT)
      this.stagedProposals.length = 0;
      this.stagedTrackerUpdates.length = 0;
      this.stagedSpeciations.length = 0;
      this.stagedSpeciationCheck = false;
      this.mateCompat = null;
      this.t_mateEvaluations = 0;
      this.t_mateRejections = 0;
      this.t_inviableZygotes = 0;
      this.t_hybridOffspring = 0;
      const draftCount = this.curDraftCount;
      for (let i = 0; i < draftCount; i++) {
        this.draftOrg[i] = undefined as unknown as Organism;
        this.draftPop[i] = undefined as unknown as PopulationManager;
        this.draftDeathCause[i] = null;
      }
      const eggPlanCount = this.curEggPlanCount;
      for (let i = 0; i < eggPlanCount; i++) {
        this.eggOrg[i] = undefined as unknown as Organism;
        this.eggMutationRecords[i] = undefined;
      }
      this.curDraftCount = 0;
      this.curEggPlanCount = 0;
      this.curReproPlanCount = 0;
      this.curPredBiteCount = 0;
      this.curPlantDirtyCount = 0;
      this.curCarrionDirtyCount = 0;
      this.curDetritusDirtyCount = 0;
      this.curPreyDirtyCount = 0;
      this.curAliveDirtyCount = 0;
      this.curPhotoCount = 0;
      this.curPreyRemTouchedCount = 0;
      this.curNewlyDiedCellCount = 0;
      this.curDiedCount = 0;
    }
  }

  /** RESOLVE: runs the speciation engine over this tick's surviving drafts (read-only). */
  private stageSpeciationCheck(
    targetTick: number,
    sCount: number,
    speciesList: readonly SpeciesDefinition[],
    speciesCaches: SpeciesRuntimeCache[]
  ): void {
    const engine = this.speciationEngine!;
    if (targetTick % this.evolution!.evolutionCheckInterval !== 0) return;
    let navComponents: readonly Int32Array[] | null = null;
    let speciesNavClass: Int32Array | null = null;
    if (this.spatial !== null) {
      navComponents = this.spatial.navigator.component;
      speciesNavClass = new Int32Array(sCount);
      for (let i = 0; i < sCount; i++) speciesNavClass[i] = this.spatial.getNavClass(i);
    }
    const phylogeny = this.phylogeny!;
    engine.evaluateTick({
      targetTick,
      grid: this.grid,
      speciesCount: sCount,
      speciesList,
      existingSpeciesIds: new Set(speciesList.map((sp) => sp.id)),
      speciesDraftStart: this.stepSpeciesDraftStart,
      speciesDraftEnd: this.stepSpeciesDraftEnd,
      draftOrg: this.draftOrg,
      draftCellIndex: this.draftCellIndex,
      draftFlags: this.draftFlags,
      navComponents,
      speciesNavClass,
      outProposals: this.stagedProposals,
      outTrackerUpdates: this.stagedTrackerUpdates,
      rootSpeciesResolver: (id) => phylogeny.getRootSpeciesId(id),
    });
    this.stagedSpeciationCheck = true;
    void speciesCaches;
  }

  /**
   * PRE_ALLOCATE: everything that could fail for a speciation (allocation, id collisions) happens
   * here, before the energy transaction opens, so COMMIT only links prepared objects.
   */
  private preallocateSpeciations(): void {
    const draftOrg = this.draftOrg;
    for (const proposal of this.stagedProposals) {
      const daughter = proposal.daughterSpecies;
      if (this.speciesRegistry.has(daughter.id) || this.populations.has(daughter.id)) {
        throw new Error(`Speciation id collision: "${daughter.id}" already exists`);
      }
      if (this.phylogeny!.getNode(daughter.id) !== undefined) {
        throw new Error(`Speciation id collision in phylogeny: "${daughter.id}"`);
      }
      validateSpeciesDefinition(daughter);
      const memberIds = new Set<number>();
      for (const d of proposal.memberDraftIndices) memberIds.add(draftOrg[d].id);
      this.stagedSpeciations.push({
        proposal,
        population: new PopulationManager(daughter, this.grid, Math.max(64, memberIds.size * 2)),
        memberIds,
      });
    }
  }

  /**
   * COMMIT (after the energy transaction is durable): registers daughter species, moves their
   * founding members (and the eggs those members laid this tick) unchanged into the new
   * population, records phylogeny events and commits divergence trackers. Organisms keep their
   * ids, genomes, bodies and energy accounts; no organism or energy is created or destroyed.
   */
  private commitEvolution(targetTick: number): void {
    const stats = this.evolutionStats;
    stats.ticks++;
    stats.mateEvaluations += this.t_mateEvaluations;
    stats.mateRejections += this.t_mateRejections;
    stats.inviableZygotes += this.t_inviableZygotes;
    stats.hybridOffspring += this.t_hybridOffspring;
    const phylogeny = this.phylogeny!;
    const speciesList = this.speciesCacheList;

    // Interspecific births of this tick (only provisioned eggs exist)
    const eggPlanCount = this.curEggPlanCount;
    for (let i = 0; i < eggPlanCount; i++) {
      if (this.eggProvisioned[i] === 0) continue;
      const fatherIdx = this.eggFatherSpeciesIdx[i];
      if (fatherIdx < 0) continue;
      const egg = this.eggOrg[i];
      phylogeny.recordHybridization({
        tick: targetTick,
        motherSpeciesId: egg.speciesId,
        fatherSpeciesId: speciesList[fatherIdx].species.id,
        offspringSpeciesId: egg.speciesId,
        viability: this.eggHybridViability[i],
        fertility: this.eggHybridFertility[i],
        isBackcross: this.eggHybridBackcross[i] === 1,
      });
    }

    const committed: { proposal: StagedSpeciationProposal; assignedId: string }[] = [];
    for (const staged of this.stagedSpeciations) {
      const { proposal, population, memberIds } = staged;
      const daughter = proposal.daughterSpecies;
      const parentPop = this.populations.get(proposal.parentSpeciesId);
      if (!parentPop) continue;
      // Eggs laid this tick by founding mothers belong to the founding group
      for (let i = 0; i < eggPlanCount; i++) {
        if (this.eggProvisioned[i] === 0) continue;
        const egg = this.eggOrg[i];
        if (egg.speciesId === proposal.parentSpeciesId && egg.parentAId !== null && memberIds.has(egg.parentAId)) {
          memberIds.add(egg.id);
        }
      }
      // Founders survived this tick's mortality (checked in RESOLVE); register, then move them
      this.speciesRegistry.register(daughter);
      this.populations.set(daughter.id, population);
      const moved = parentPop.extractForSpeciation(memberIds);
      moved.sort((a, b) => a.id - b.id);
      for (const org of moved) org.speciesId = daughter.id;
      population.adoptFromSpeciation(moved);
      phylogeny.recordSpeciation({
        tick: targetTick,
        parentSpecies: this.speciesRegistry.get(proposal.parentSpeciesId),
        daughterSpecies: daughter,
        cause: proposal.cause,
        geneticDistance: proposal.geneticDistance,
        ecologicalDistance: proposal.ecologicalDistance,
        reproductiveIsolation: proposal.reproductiveIsolation,
        persistenceTicks: proposal.persistenceTicks,
        founderCount: moved.length,
        cellCentroid: proposal.cellCentroid,
        geneticSignature: proposal.geneticSignature,
        anatomySignature: proposal.anatomySignature,
      });
      committed.push({ proposal, assignedId: daughter.id });
      stats.speciations++;
    }
    if (this.stagedSpeciationCheck) {
      stats.speciationChecks++;
      this.speciationEngine!.commitTrackerUpdates(this.stagedTrackerUpdates, committed, targetTick);
    }
  }

  /** After compaction: population sizes, peaks and extinctions of every registered lineage. */
  private syncPhylogeny(tick: number): void {
    const phylogeny = this.phylogeny!;
    for (const sp of this.speciesRegistry.list()) {
      phylogeny.ensureFounderNode(sp, tick);
      const pop = this.populations.get(sp.id);
      phylogeny.syncPopulationState(
        sp.id,
        pop ? pop.size : 0,
        pop ? pop.getBirthsTotal() : 0,
        pop ? pop.getDeathsTotal() : 0,
        tick
      );
    }
  }

  /** Committed divergence trackers of the speciation engine (evolution mode; empty otherwise). */
  getSpeciationTrackers() {
    return this.speciationEngine ? this.speciationEngine.getTrackers() : [];
  }

  /**
   * Points the spatial system's read-only view at this tick's draft buffers and committed
   * resource pools (front buffers). Allocation-free on the direct-store fast path.
   */
  private prepareSpatialView(targetTick: number, sCount: number): SpatialTickView {
    const view = this.spatialView!;
    view.tick = targetTick;
    view.draftCount = this.curDraftCount;
    view.order = this.draftCanonicalOrder;
    view.org = this.draftOrg;
    view.orgId = this.draftOrgId;
    view.slot = this.draftSlot;
    view.cell = this.draftCellIndex;
    view.speciesIdx = this.draftSpeciesIdx;
    view.flags = this.draftFlags;
    view.nextStage = this.draftNextStage;
    view.nextEnergy = this.draftNextEnergy;
    view.nextHealth = this.draftNextHealth;
    view.structMassQ = this.draftStructMassQ;
    view.reserveMassQ = this.draftPostMetabResQ;
    view.reqPlantQ = this.draftReqPlantQ;
    view.reqPreyQ = this.draftReqPreyQ;
    view.reqCarrionQ = this.draftReqCarrionQ;
    view.reqDetritusQ = this.draftReqDetritusQ;
    view.grantPlantQ = this.draftGrantPlantQ;
    view.grantPreyQ = this.draftGrantPreyQ;
    view.grantCarrionQ = this.draftGrantCarrionQ;
    view.grantDetritusQ = this.draftGrantDetritusQ;
    view.speciesCount = sCount;
    view.preyMatrix = this.speciesPreyMatrix;

    const cc = this.grid.cellCount;
    if (this.useDirectEnergyGrid) {
      const front = this.energyGrid._getChannelStore().front;
      view.plantMass = front[0];
      view.carrionMass = front[2];
      view.detritusMass = front[4];
    } else {
      const plant = (this.spatialFallbackPlant ??= new Float64Array(cc));
      const carrion = (this.spatialFallbackCarrion ??= new Float64Array(cc));
      const detritus = (this.spatialFallbackDetritus ??= new Float64Array(cc));
      const energyGrid = this.energyGrid;
      for (let c = 0; c < cc; c++) {
        plant[c] = energyGrid.getMassQ(POOL_PLANT, c);
        carrion[c] = energyGrid.getMassQ(POOL_CARRION, c);
        detritus[c] = energyGrid.getMassQ(POOL_DETRITUS, c);
      }
      view.plantMass = plant;
      view.carrionMass = carrion;
      view.detritusMass = detritus;
    }

    const conservativePrey =
      this.hasConservativePreyProvider && this.foodProvider instanceof DeterministicPreyFoodProvider
        ? this.foodProvider
        : null;
    if (conservativePrey === null) {
      view.bgPreyStruct = null;
      view.bgPreyReserve = null;
    } else if (this.useDirectEntityStore) {
      // Conservative prey pools occupy entity slots [0, cellCount) (preySlotOffset === 0)
      const esFront = this.entityStore._getChannelStore().front;
      view.bgPreyStruct = esFront[0];
      view.bgPreyReserve = esFront[2];
    } else {
      const struct = (this.spatialFallbackPreyStruct ??= new Float64Array(cc));
      const reserve = (this.spatialFallbackPreyReserve ??= new Float64Array(cc));
      const entityStore = this.entityStore;
      for (let c = 0; c < cc; c++) {
        struct[c] = entityStore.structMassQ(c);
        reserve[c] = entityStore.reserveMassQ(c);
      }
      view.bgPreyStruct = struct;
      view.bgPreyReserve = reserve;
    }
    return view;
  }

  /** Inspection snapshot of an organism's spatial state (`undefined` when spatial mode is off). */
  getOrganismSpatialState(organismId: number): OrganismSpatialState | undefined {
    if (this.spatial === null) return undefined;
    const slot = this.organismIdToSlot.get(organismId);
    return slot === undefined ? undefined : this.spatial.describeSlot(slot);
  }

  /**
   * Number of living organisms of `speciesId` currently registered in `cellIndex` according to the
   * population's spatial index (rebuilt lazily after movement, births and deaths).
   */
  getCellPopulationCount(speciesId: string, cellIndex: number): number {
    const pop = this.populations.get(speciesId);
    return pop ? pop.getCellPopulationCount(cellIndex) : 0;
  }

  /** Visits the living organisms of `speciesId` located in `cellIndex` in ascending id order. */
  forEachOrganismInCell(
    speciesId: string,
    cellIndex: number,
    visitor: (organism: Organism) => boolean | void
  ): void {
    const pop = this.populations.get(speciesId);
    if (pop) pop.forEachInCell(cellIndex, (org) => visitor(org));
  }

  /**
   * Spatially separated groups of a species: occupied cells closer than `linkDistance` (Chebyshev)
   * belong to the same subpopulation. Measurement foundation for geographic isolation and genetic
   * divergence; works with or without spatial behavior and performs no speciation.
   */
  getSubpopulations(speciesId: string, linkDistance = 3): Subpopulation[] {
    const species = this.speciesRegistry.get(speciesId);
    let navComponent: Int32Array | undefined;
    if (this.spatial !== null) {
      const sIdx = this.resolveSpatialSpeciesIndex(species);
      const profileClass = this.spatial.navigator.component;
      navComponent = profileClass[this.spatial.getNavClass(sIdx)];
    }
    // Read-only: never creates a population entry for a species that has none yet
    const pop = this.populations.get(speciesId);
    return computeSubpopulations(
      pop ? pop.getActiveOrganisms() : [],
      this.grid.width,
      this.grid.height,
      linkDistance,
      navComponent
    );
  }

  /**
   * On-demand genetic profile of a species: count, per-locus mean and spread of inherited trait
   * values, gene-pool allele variance and its within / between individual components,
   * allele-copy correlation, allelic divergence and dominance spread, for the core genome and
   * (for organisms that carry one) the anatomy genome. One pass over the population; reads
   * organisms only and changes no simulation state. Unknown species ids throw.
   */
  getGeneticProfile(speciesId: string, options: Omit<GeneticProfileOptions, 'tick'> = {}): PopulationGeneticProfile {
    const species = this.speciesRegistry.get(speciesId);
    const pop = this.populations.get(speciesId);
    return computeGeneticProfile(species, pop ? pop.getActiveOrganisms() : [], {
      includeEggs: options.includeEggs,
      tick: this.tickCount,
    });
  }

  /**
   * On-demand genetic comparison of the spatially separated groups of a species (partition from
   * `getSubpopulations(speciesId, linkDistance)`): one profile per group, pairwise locus
   * differences and among-group differentiation. Measures divergence only; it never creates,
   * splits or merges species and changes no simulation state.
   */
  analyzeSubpopulationGenetics(
    speciesId: string,
    options: Omit<SubpopulationGeneticOptions, 'tick'> & { readonly linkDistance?: number } = {}
  ): SubpopulationGeneticAnalysis {
    const species = this.speciesRegistry.get(speciesId);
    const linkDistance = options.linkDistance ?? 3;
    const subpopulations = this.getSubpopulations(speciesId, linkDistance);
    const pop = this.populations.get(speciesId);
    return computeSubpopulationGeneticAnalysis(
      species,
      subpopulations,
      (id) => (pop ? pop.getById(id) : undefined),
      linkDistance,
      {
        includeEggs: options.includeEggs,
        minGroupSize: options.minGroupSize,
        maxGroups: options.maxGroups,
        tick: this.tickCount,
      }
    );
  }

  /**
   * Advances the biological simulation by exactly 1 deterministic tick.
   * Respects `statsInterval` when deciding whether to compute/record `PopulationStats`.
   */
  step(): BiologyTickSummary {
    if (this.isStepping) {
      throw new Error(
        'Reentrant call to BiologySimulation.step() is not allowed while a simulation step is in progress'
      );
    }
    const nextTick = this.tickCount + 1;
    const isStatsTick = nextTick % this.statsInterval === 0;
    const shouldRecord = this.recordHistory && this.maxHistoryEntries > 0 && isStatsTick;
    this.isStepping = true;
    try {
      return this.stepInternal(isStatsTick, shouldRecord);
    } finally {
      this.isStepping = false;
    }
  }

  /**
   * Advances the simulation by `ticks` deterministic steps.
   * Skips intermediate statistics aggregation on non-interval ticks (or when history recording
   * is disabled) and computes full statistics on the final tick.
   */
  stepMany(ticks: number): BiologyTickSummary {
    if (!Number.isInteger(ticks) || ticks < 1) {
      throw new RangeError(`stepMany requires a positive integer tick count, received: ${ticks}`);
    }
    if (this.isStepping) {
      throw new Error(
        'Reentrant call to BiologySimulation.stepMany() is not allowed while a simulation step is in progress'
      );
    }
    let last!: BiologyTickSummary;
    this.isStepping = true;
    try {
      for (let i = 0; i < ticks; i++) {
        const nextTick = this.tickCount + 1;
        const isStatsTick = nextTick % this.statsInterval === 0;
        const shouldRecord = this.recordHistory && this.maxHistoryEntries > 0 && isStatsTick;
        const needStats = shouldRecord || i === ticks - 1;
        last = this.stepInternal(needStats, shouldRecord);
      }
    } finally {
      this.isStepping = false;
    }
    return last;
  }

  getStats(speciesId = 'raptor'): PopulationStats {
    const pop = this.getOrCreatePopulation(speciesId);
    return pop.computeStats(this.tickCount);
  }

  getOrganisms(speciesId = 'raptor'): readonly Organism[] {
    return this.getOrCreatePopulation(speciesId).getActiveOrganisms();
  }

  getOrganismById(speciesId: string, organismId: number): Organism | undefined {
    return this.populations.get(speciesId)?.getById(organismId);
  }

  getHistory(): readonly BiologyTickSummary[] {
    return this.history;
  }

  getTrackedMutations(): readonly TrackedMutationEvent[] {
    return this.trackedMutations;
  }

  getTraitAverage(speciesId: string, traitId: TraitId): number {
    return this.getStats(speciesId).meanGenotype[traitId] ?? 0;
  }
}
