import { deriveSeed, normalizeSeed, SeedInput } from '../prng';
import { WORLD_BIOME_IDS, WorldGrid } from '../worldGrid';
import { ANATOMY_IDX, getRelativeAnatomyPhysiology, getSpeciesBaselineAnatomy } from './anatomy';

// Anatomy effects on locomotion, capture and thermal choice. They are applied as ratios /
// differences against the species baseline anatomy (see getSpeciesBaselineAnatomy), so the species'
// calibrated behaviour holds for an average member and heritable deviations change performance.
function anatomyLandSpeed(an: Float32Array): number {
  return (0.76 + 0.22 * an[ANATOMY_IDX.LIMB_LENGTH] + 0.05 * (an[ANATOMY_IDX.TAIL_LENGTH] - 1)) * (1 - 0.18 * an[ANATOMY_IDX.ARMOR_PROTECTION]);
}
function anatomyWaterPace(an: Float32Array): number {
  return 0.72 + 0.55 * an[ANATOMY_IDX.AQUATIC_AFFINITY];
}
function anatomyHillPace(an: Float32Array): number {
  return (0.82 + 0.4 * an[ANATOMY_IDX.CLIMBING_AFFINITY]) * (1 - 0.14 * an[ANATOMY_IDX.ARMOR_PROTECTION]);
}
function anatomyAttack(an: Float32Array): number {
  return 0.78 + 0.16 * an[ANATOMY_IDX.HEAD_SIZE] + 0.14 * an[ANATOMY_IDX.CARNIVORY_APPARATUS];
}
function anatomyDefense(an: Float32Array): number {
  return 1 + 0.65 * an[ANATOMY_IDX.ARMOR_PROTECTION] + 0.14 * an[ANATOMY_IDX.TORSO_ROBUSTNESS];
}
function anatomyColdShift(an: Float32Array): number {
  return (an[ANATOMY_IDX.INTEGUMENT_THICKNESS] - 1.0) * 6.0 + (an[ANATOMY_IDX.TORSO_ROBUSTNESS] - 1.0) * 3.0;
}
function anatomyHeatShift(an: Float32Array): number {
  return -(an[ANATOMY_IDX.INTEGUMENT_THICKNESS] - 1.0) * 4.8 - Math.max(0, an[ANATOMY_IDX.TORSO_ROBUSTNESS] - 1.0) * 2.0;
}
import { getPhysiologyIndices } from './lifecycle';
import type { Organism } from './organism';
import type { SpeciesDefinition } from './species';
import {
  NAV_DX,
  NAV_DY,
  PATH_FOUND,
  PATH_PARTIAL,
  PATH_UNREACHABLE,
  SpatialNavigator,
  SpatialNavigatorOptions,
  directionOf,
  octileDistance,
} from './spatialNavigation';
import {
  SpatialSpeciesProfile,
  buildTerrainCostByCode,
  resolveSpatialSpeciesProfile,
} from './spatialProfile';
import type { TrophicProfile } from './trophicProfile';

/**
 * Autonomous spatial behavior for individual organisms (`src/sim/biology/spatialBehavior.ts`).
 *
 * Responsibilities: bounded perception, compact per-individual memory, utility-based action
 * selection, movement on the finite map, pursuit / flight / capture attempts, hydration, and
 * individual + group migration.
 *
 * Transactional contract with `BiologySimulation.step()`:
 *   - `beginTick`  : index committed positions (read-only).
 *   - `attemptCapture` (RESOLVE): decides whether a predator's strike on co-located prey lands.
 *   - `planTick`   (RESOLVE): every organism perceives, decides and plans ONE tick of movement.
 *     All results are written to STAGED buffers (`n_*`), never to organisms or committed state.
 *   - `commitTick` (after the energy transaction committed): staged state becomes current and
 *     `org.x / org.y / org.cellIndex` are updated. This method cannot throw.
 *   - `endTick`    : clears per-tick scratch. After an ABORT nothing staged is ever applied, so
 *     coordinates, memory, fatigue and hydration remain exactly as before the failed tick.
 *
 * Randomness is a counter-based hash of (seed, tick, organism id, purpose): it carries no mutable
 * state, so a retried tick reproduces the same decisions and no RNG stream needs restoring.
 * Nothing here reads a camera, a frame clock or any rendering state.
 */

export const BEHAVIOR_REST = 0;
export const BEHAVIOR_FORAGE = 1;
export const BEHAVIOR_SEEK_FOOD = 2;
export const BEHAVIOR_HUNT = 3;
export const BEHAVIOR_FLEE = 4;
export const BEHAVIOR_SEEK_WATER = 5;
export const BEHAVIOR_SEEK_MATE = 6;
export const BEHAVIOR_SEEK_COMFORT = 7;
export const BEHAVIOR_EXPLORE = 8;
export const BEHAVIOR_MIGRATE = 9;
export const BEHAVIOR_COUNT = 10;

export const BEHAVIOR_NAMES: readonly string[] = Object.freeze([
  'rest',
  'forage',
  'seek-food',
  'hunt',
  'flee',
  'seek-water',
  'seek-mate',
  'seek-comfort',
  'explore',
  'migrate',
]);

export const MEMORY_NONE = 0;
export const MEMORY_FOOD = 1;
export const MEMORY_WATER = 2;
export const MEMORY_DANGER = 3;
/** A place that was visited or evaluated and found empty or unreachable. */
export const MEMORY_BARREN = 4;
export const MEMORY_KIND_NAMES: readonly string[] = Object.freeze(['none', 'food', 'water', 'danger', 'barren']);

/** Fixed number of remembered places per individual. */
export const MEMORY_SLOTS = 6;
/** Per-kind share of the fixed memory (sums to MEMORY_SLOTS) so one kind cannot evict the others. */
const MEMORY_QUOTA = new Uint8Array([0, 2, 1, 1, 2]);
/** Fixed number of stored route waypoints per individual. */
export const WAYPOINT_SLOTS = 8;

// Must mirror the private draft encodings of BiologySimulation.
const STAGE_EGG = 0;
const STAGE_JUVENILE = 1;
const STAGE_ELDER = 3;
const FLAG_FEMALE = 1 << 0;
const FLAG_DIED = 1 << 2;
const FLAG_ELIGIBLE = 1 << 4;

const SALT_TEMPERAMENT = 0x51ed270b;
const SALT_CAPTURE = 0x2545f491;
const SALT_PREYCHOICE = 0x6a09e667;
const SALT_INJURY = 0x3c6ef373;
const SALT_EXPLORE = 0x7f4a7c15;
const SALT_FLEE = 0x1b873593;
const SALT_FOLLOW = 0x68e31da4;
const SALT_DIRECTION = 0x3c6ef372;

/** Per (cell, species) counters: [0] all non-egg, [1] receptive females, [2] receptive males, [3] hunting. */
const COUNT_STRIDE = 4;

const RHO_PLANT_EU = 3;
const RHO_DETRITUS_EU = 3;
const RHO_CARRION_EU = 15;
const RHO_STRUCT_EU = 5;
const RHO_RESERVE_EU = 30;

export interface SpatialHydrationConfig {
  /** Enables thirst, drinking and dehydration (default: true). */
  readonly enabled?: boolean;
  /** Hydration regained per tick while standing on a cell with drinkable water (default 0.6). */
  readonly drinkPerTick?: number;
  /** Health lost per tick while hydration is zero (default 0.05). */
  readonly dehydrationDamagePerTick?: number;
  /** Speed multiplier while hydration is zero (default 0.75). */
  readonly dehydratedSpeedFactor?: number;
}

export interface SpatialExertionConfig {
  /**
   * Health lost per tick when the whole locomotion cost of the previous tick exceeded the
   * animal's energy reserve (scaled by the unpaid fraction). Default 0.04.
   */
  readonly exhaustionDamagePerTick?: number;
  /** Speed multiplier of an animal whose reserve cannot pay for a single step (default 0.5). */
  readonly exhaustedSpeedFactor?: number;
}

export interface SpatialBehaviorConfig {
  /** Content individuals re-run full perception every N ticks; urgent states think every tick (default 2). */
  readonly thinkInterval?: number;
  /** Hard upper bound of any perception radius in cells (default 6). */
  readonly maxPerceptionRadius?: number;
  /** Hard upper bound of cells moved by one individual in one tick (default 4). */
  readonly maxStepsPerTick?: number;
  /** Remembered places older than this many ticks are ignored (default 60). */
  readonly memoryTtlTicks?: number;
  /** Interval in ticks between checks for external terrain / obstacle edits (default 8; 0 disables). */
  readonly navRevalidateInterval?: number;
  /** Cells whose thermal stress for an individual exceeds this are never entered voluntarily (default 1.0). */
  readonly lethalThermalStress?: number;
  readonly navigation?: SpatialNavigatorOptions;
  readonly hydration?: SpatialHydrationConfig;
  readonly exertion?: SpatialExertionConfig;
  /** Per-species overrides of the spatial physiology profile, keyed by species id. */
  readonly speciesProfiles?: Readonly<Record<string, Partial<SpatialSpeciesProfile>>>;
}

/**
 * Read-only window onto the per-tick draft buffers of `BiologySimulation`.
 * Refreshed by the simulation every tick; the behavior system never writes to these arrays.
 */
export interface SpatialTickView {
  tick: number;
  draftCount: number;
  order: Int32Array;
  org: Organism[];
  orgId: Float64Array;
  slot: Int32Array;
  cell: Uint32Array;
  speciesIdx: Uint16Array;
  flags: Uint8Array;
  nextStage: Uint8Array;
  nextEnergy: Float64Array;
  nextHealth: Float64Array;
  structMassQ: Float64Array;
  reserveMassQ: Float64Array;
  reqPlantQ: Float64Array;
  reqPreyQ: Float64Array;
  reqCarrionQ: Float64Array;
  reqDetritusQ: Float64Array;
  grantPlantQ: Float64Array;
  grantPreyQ: Float64Array;
  grantCarrionQ: Float64Array;
  grantDetritusQ: Float64Array;
  speciesCount: number;
  preyMatrix: Uint8Array;
  plantMass: Float64Array;
  carrionMass: Float64Array;
  detritusMass: Float64Array;
  /** Per-cell background prey pool (entity slots `[0, cellCount)`), or `null` when absent. */
  bgPreyStruct: Float64Array | null;
  bgPreyReserve: Float64Array | null;
}

export interface SpatialSpeciesSource {
  readonly species: SpeciesDefinition;
  readonly profile: TrophicProfile;
}

interface SpeciesSpatialRuntime {
  readonly species: SpeciesDefinition;
  readonly profile: SpatialSpeciesProfile;
  readonly navClass: number;
  readonly dPlant: number;
  /** Food perception weights (= diet weights, or the adaptive-diet acceptability of each food). */
  readonly fPlant: number;
  readonly fCarrion: number;
  readonly fDetritus: number;
  readonly dPrey: number;
  readonly dCarrion: number;
  readonly dDetritus: number;
  readonly hasPreyDiet: boolean;
  readonly iBodySize: number;
  readonly iStrength: number;
  readonly iSpeed: number;
  readonly iEndurance: number;
  readonly iPerception: number;
  readonly iHeatTol: number;
  readonly iColdTol: number;
  readonly iAdapt: number;
  readonly iMetEff: number;
  readonly baseBodySize: number;
  readonly baseStrength: number;
  readonly baseSpeed: number;
  readonly baseEndurance: number;
  readonly basePerception: number;
  readonly baseHeatTol: number;
  readonly baseColdTol: number;
  readonly baseAdapt: number;
  readonly baseMetEff: number;
  readonly optTemp: number;
  readonly halfWidth: number;
  readonly activityFactor: number;
  readonly adultMassMU: number;
  readonly maxReserveRatio: number;
  readonly maxForageIntake: number;
  readonly preferredBiome: Uint8Array;
  readonly amphibiousDrinker: boolean;
  /** Anatomy effect values of the species baseline anatomy (reference for relative effects). */
  readonly anLand0: number;
  readonly anWater0: number;
  readonly anHill0: number;
  readonly anAttack0: number;
  readonly anDefense0: number;
  readonly anCold0: number;
  readonly anHeat0: number;
}

export interface SpatialStats {
  /** Committed ticks processed by the behavior system. */
  ticks: number;
  /** Individual cell changes (one organism leaving its cell in one tick counts once). */
  moves: number;
  /** Total path cost travelled (terrain-weighted cells). */
  pathCost: number;
  /** Total locomotion + strike energy demanded from reserves (EU quanta); paid via the ledger. */
  locomotionEnergyQ: number;
  /** Full perception scans performed. */
  scans: number;
  huntAttempts: number;
  huntSuccesses: number;
  /** Failed attacks that injured the predator (adaptive food webs only). */
  huntInjuries: number;
  migrationsStarted: number;
  migrationsSettled: number;
  drinks: number;
  pathRequests: number;
  pathNodesExpanded: number;
  /** Number of living, non-egg individuals in each behavior state after the last committed tick. */
  behaviorCounts: number[];
}

export interface OrganismSpatialState {
  readonly slot: number;
  readonly behavior: number;
  readonly behaviorName: string;
  readonly heading: number;
  readonly goalCell: number;
  readonly targetId: number;
  readonly fatigue: number;
  readonly hydration: number;
  readonly exhaustion: number;
  readonly wanderlust: number;
  readonly moveCredit: number;
  readonly homeCell: number;
  readonly natalCell: number;
  readonly pathCostTravelled: number;
  readonly migrations: number;
  readonly migrating: boolean;
  readonly memory: readonly { kind: string; cell: number; tick: number; value: number }[];
}

export interface Subpopulation {
  readonly size: number;
  readonly cellCount: number;
  readonly centroidX: number;
  readonly centroidY: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  /** Navigation component of the cluster for the species' mobility class (-1 if unknown). */
  readonly navComponent: number;
  /** Mean inherited genetic expression per locus (foundation for divergence measurements). */
  readonly meanGeneticExpression: number[];
  readonly organismIds: number[];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function growF32(old: Float32Array, n: number) {
  const next = new Float32Array(n);
  next.set(old);
  return next;
}
function growF64(old: Float64Array, n: number) {
  const next = new Float64Array(n);
  next.set(old);
  return next;
}
function growI32(old: Int32Array, n: number, fill = 0) {
  const next = new Int32Array(n);
  if (fill !== 0) next.fill(fill);
  next.set(old);
  return next;
}
function growU32(old: Uint32Array, n: number) {
  const next = new Uint32Array(n);
  next.set(old);
  return next;
}
function growU16(old: Uint16Array, n: number) {
  const next = new Uint16Array(n);
  next.set(old);
  return next;
}
function growU8(old: Uint8Array, n: number) {
  const next = new Uint8Array(n);
  next.set(old);
  return next;
}
function growI8(old: Int8Array, n: number, fill = 0) {
  const next = new Int8Array(n);
  if (fill !== 0) next.fill(fill);
  next.set(old);
  return next;
}

export class SpatialBehaviorSystem {
  public readonly grid: WorldGrid;
  public readonly thinkInterval: number;
  public readonly maxPerceptionRadius: number;
  public readonly maxStepsPerTick: number;
  public readonly memoryTtlTicks: number;
  public readonly navRevalidateInterval: number;
  public readonly lethalThermalStress: number;
  public readonly hydrationEnabled: boolean;
  public readonly drinkPerTick: number;
  public readonly dehydrationDamagePerTick: number;
  public readonly dehydratedSpeedFactor: number;
  public readonly exhaustionDamagePerTick: number;
  public readonly exhaustedSpeedFactor: number;
  public readonly stats: SpatialStats;

  private readonly width: number;
  private readonly height: number;
  private readonly cellCount: number;
  private readonly seed: number;
  /** Entity slot of local index 0: every per-slot array is indexed by `entitySlot - slotBase`. */
  private readonly slotBase: number;
  private readonly navOptions: SpatialNavigatorOptions;
  private readonly profileOverrides: Readonly<Record<string, Partial<SpatialSpeciesProfile>>>;

  private nav!: SpatialNavigator;
  private navTableKeys: string[] = [];
  private species: SpeciesSpatialRuntime[] = [];
  private speciesSources: readonly SpatialSpeciesSource[] = [];
  private speciesCount = 0;
  /** threatWeight[q * S + me] > 0 when species q hunts species me. */
  private threatWeight = new Float32Array(0);
  /** huntable[me * S + q] = 1 when species me hunts species q. */
  private huntable = new Uint8Array(0);

  private capacity = 0;

  // ---- committed per-slot state -------------------------------------------------------------
  private slotOrgId = new Float64Array(0);
  private behavior = new Uint8Array(0);
  private heading = new Int8Array(0);
  private moveCredit = new Float32Array(0);
  private fatigue = new Float32Array(0);
  private hydration = new Float32Array(0);
  /** Fraction of last tick's locomotion energy the reserve could not pay (0 = fully paid). */
  private exhaustion = new Float32Array(0);
  private goalCell = new Int32Array(0);
  private targetId = new Float64Array(0);
  private targetSlot = new Int32Array(0);
  private wanderlust = new Float32Array(0);
  private hungerStreak = new Uint16Array(0);
  private modeTicks = new Uint16Array(0);
  private prevCell = new Int32Array(0);
  private stuck = new Uint8Array(0);
  private homeCell = new Int32Array(0);
  private natalCell = new Int32Array(0);
  private travelled = new Float32Array(0);
  private migrations = new Uint16Array(0);
  /** 1 while the individual is in a migration episode (survives detours to drink, feed or flee). */
  private migrating = new Uint8Array(0);
  private wpCount = new Uint8Array(0);
  private wpIdx = new Uint8Array(0);
  private wpEpoch = new Uint32Array(0);
  private waypoints = new Int32Array(0);
  private memCell = new Int32Array(0);
  private memKind = new Uint8Array(0);
  private memTick = new Int32Array(0);
  private memValue = new Float32Array(0);

  // ---- staged per-slot state (written by planTick, applied by commitTick) ---------------------
  private n_planned = new Uint8Array(0);
  private n_cell = new Int32Array(0);
  private n_behavior = new Uint8Array(0);
  private n_heading = new Int8Array(0);
  private n_moveCredit = new Float32Array(0);
  private n_fatigue = new Float32Array(0);
  private n_hydration = new Float32Array(0);
  private n_exhaustion = new Float32Array(0);
  private n_goalCell = new Int32Array(0);
  private n_targetId = new Float64Array(0);
  private n_targetSlot = new Int32Array(0);
  private n_wanderlust = new Float32Array(0);
  private n_hungerStreak = new Uint16Array(0);
  private n_modeTicks = new Uint16Array(0);
  private n_prevCell = new Int32Array(0);
  private n_stuck = new Uint8Array(0);
  private n_homeCell = new Int32Array(0);
  private n_travelAdd = new Float32Array(0);
  private n_migrated = new Uint8Array(0);
  private n_migrating = new Uint8Array(0);
  private n_wpCount = new Uint8Array(0);
  private n_wpIdx = new Uint8Array(0);
  private n_wpNew = new Uint8Array(0);
  private n_waypoints = new Int32Array(0);
  private n_demandQ = new Float64Array(0);

  // ---- per-tick per-slot scratch --------------------------------------------------------------
  private slotToDraft = new Int32Array(0);
  private x_attacked = new Uint8Array(0);
  private x_extraDemandQ = new Float64Array(0);
  private x_fatigueAdd = new Float32Array(0);

  // ---- staged memory journal ------------------------------------------------------------------
  private jCount = 0;
  private jSlot = new Int32Array(256);
  private jCell = new Int32Array(256);
  private jKind = new Uint8Array(256);
  private jValue = new Float32Array(256);

  // ---- per-tick per-cell indices --------------------------------------------------------------
  private readonly occHead: Int32Array;
  private occNext = new Int32Array(0);
  private readonly occTouched: Uint32Array;
  private occTouchedCount = 0;
  private counts = new Uint16Array(0);
  private countsBuilt = false;
  // Per-species per-cell fields, rebuilt at most once per tick and shared by every individual
  // of the species (so perception costs one read per cell instead of re-deriving the value).
  /** Summed predator weight threatening species `s` in a cell (valid only for occupied cells). */
  private threatField: Float32Array[] = [];
  /** Like `threatField`, but counting only predators that are actively hunting (occupied cells only). */
  private alarmField: Float32Array[] = [];
  /** 1 when a cell holds at least one organism species `s` may hunt (valid only for occupied cells). */
  private preyMask: Uint8Array[] = [];
  /** Usable food energy (EU quanta) of a cell for species `s`; lazily filled per tick. */
  private foodField: Float32Array[] = [];
  private foodFieldTick: Int32Array = new Int32Array(0);
  /** 1 when a cell offers drinkable water to species `s`; lazily filled per tick. */
  private waterMask: Uint8Array[] = [];
  private waterMaskTick: Int32Array = new Int32Array(0);
  private readonly presentScratch = new Int32Array(64);

  // ---- per-tick counters (applied at commit) --------------------------------------------------
  private t_attempts = 0;
  private t_successes = 0;
  private t_injuries = 0;
  private t_migStart = 0;
  private t_migSettle = 0;
  private t_drinks = 0;
  private t_moved = 0;
  private t_pathCost = 0;
  private t_demandQ = 0;
  private t_scans = 0;
  private readonly t_behavior = new Int32Array(BEHAVIOR_COUNT);
  private tickOpen = false;

  // ---- scan scratch ---------------------------------------------------------------------------
  private sc_bestFoodCell = -1;
  private sc_bestFoodScore = 0;
  private sc_bestFoodValue = 0;
  /** Immediate threat (hunting predators within three cells, any predator within one). */
  private sc_threatNear = 0;
  private sc_threatX = 0;
  private sc_threatY = 0;
  private sc_threatCell = -1;
  private sc_preyCell = -1;
  private sc_preyCell2 = -1;
  private sc_preyCell3 = -1;
  private sc_preyDist = 0;
  private sc_preyDist2 = 0;
  private sc_preyDist3 = 0;
  private sc_waterCell = -1;
  private sc_mateCell = -1;
  private sc_mateDist = 0;
  private sc_comfortCell = -1;
  private sc_consp = 0;
  private sc_cellsSeen = 0;
  private readonly secFood = new Float64Array(8);
  private readonly secConsp = new Float64Array(8);
  private readonly secThreat = new Float64Array(8);
  private readonly secStress = new Float64Array(8);
  private readonly secCells = new Float64Array(8);

  // ---- movement scratch -----------------------------------------------------------------------
  private mv_cost = 0;
  private mv_prev = -1;
  private mv_heading = -1;
  private mv_points = 0;
  /** True when the last move stopped only because the next step cost more points than were left. */
  private mv_pending = false;
  private mv_unreachable = false;
  private mv_stuck = 0;
  private w_wpCount = 0;
  private w_wpIdx = 0;
  private w_wpNew = false;
  private readonly w_waypoints = new Int32Array(WAYPOINT_SLOTS);

  private view!: SpatialTickView;

  /**
   * @param slotBase First entity slot that can hold an organism. Lower slots (e.g. the per-cell
   *   background prey pools) never get spatial state, so no memory is spent on them.
   */
  constructor(grid: WorldGrid, seed: SeedInput, config: SpatialBehaviorConfig = {}, slotBase = 0) {
    if (!Number.isInteger(slotBase) || slotBase < 0) {
      throw new RangeError(`slotBase must be a non-negative integer, received: ${slotBase}`);
    }
    this.slotBase = slotBase;
    this.grid = grid;
    this.width = grid.width;
    this.height = grid.height;
    this.cellCount = grid.cellCount;
    this.seed = deriveSeed(normalizeSeed(seed), 'biology:behavior');

    this.thinkInterval = config.thinkInterval ?? 2;
    this.maxPerceptionRadius = config.maxPerceptionRadius ?? 6;
    this.maxStepsPerTick = config.maxStepsPerTick ?? 4;
    this.memoryTtlTicks = config.memoryTtlTicks ?? 60;
    this.navRevalidateInterval = config.navRevalidateInterval ?? 8;
    this.lethalThermalStress = config.lethalThermalStress ?? 1.0;
    const hyd = config.hydration ?? {};
    this.hydrationEnabled = hyd.enabled ?? true;
    this.drinkPerTick = hyd.drinkPerTick ?? 0.6;
    this.dehydrationDamagePerTick = hyd.dehydrationDamagePerTick ?? 0.05;
    this.dehydratedSpeedFactor = hyd.dehydratedSpeedFactor ?? 0.75;
    this.exhaustionDamagePerTick = config.exertion?.exhaustionDamagePerTick ?? 0.04;
    this.exhaustedSpeedFactor = config.exertion?.exhaustedSpeedFactor ?? 0.5;

    const intChecks: readonly [string, number, number, number][] = [
      ['thinkInterval', this.thinkInterval, 1, 1024],
      ['maxPerceptionRadius', this.maxPerceptionRadius, 0, 32],
      ['maxStepsPerTick', this.maxStepsPerTick, 1, 32],
      ['memoryTtlTicks', this.memoryTtlTicks, 1, 1_000_000],
      ['navRevalidateInterval', this.navRevalidateInterval, 0, 1_000_000],
    ];
    for (const [name, value, min, max] of intChecks) {
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(`spatial.${name} must be an integer in [${min}, ${max}], received: ${value}`);
      }
    }
    const numChecks: readonly [string, number, number, number][] = [
      ['lethalThermalStress', this.lethalThermalStress, 0, 100],
      ['hydration.drinkPerTick', this.drinkPerTick, 0, 1],
      ['hydration.dehydrationDamagePerTick', this.dehydrationDamagePerTick, 0, 1],
      ['hydration.dehydratedSpeedFactor', this.dehydratedSpeedFactor, 0, 1],
      ['exertion.exhaustionDamagePerTick', this.exhaustionDamagePerTick, 0, 1],
      ['exertion.exhaustedSpeedFactor', this.exhaustedSpeedFactor, 0, 1],
    ];
    for (const [name, value, min, max] of numChecks) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        throw new RangeError(`spatial.${name} must be a finite number in [${min}, ${max}], received: ${value}`);
      }
    }

    this.navOptions = config.navigation ?? {};
    this.profileOverrides = config.speciesProfiles ?? {};

    this.occHead = new Int32Array(this.cellCount);
    this.occHead.fill(-1);
    this.occTouched = new Uint32Array(this.cellCount);

    this.stats = {
      ticks: 0,
      moves: 0,
      pathCost: 0,
      locomotionEnergyQ: 0,
      scans: 0,
      huntAttempts: 0,
      huntSuccesses: 0,
      huntInjuries: 0,
      migrationsStarted: 0,
      migrationsSettled: 0,
      drinks: 0,
      pathRequests: 0,
      pathNodesExpanded: 0,
      behaviorCounts: new Array<number>(BEHAVIOR_COUNT).fill(0),
    };
  }

  // =============================================================================================
  // Species runtime & navigation classes
  // =============================================================================================

  /**
   * (Re)builds per-species spatial runtime data. Cheap no-op when the species list is unchanged.
   * `preyMatrix[p * S + v] = 1` means species `p` may prey on species `v` (trophic rule of the sim).
   */
  configureSpecies(sources: readonly SpatialSpeciesSource[], preyMatrix: Uint8Array): void {
    let same = sources.length === this.speciesSources.length;
    if (same) {
      for (let i = 0; i < sources.length; i++) {
        if (sources[i].species !== this.speciesSources[i].species) {
          same = false;
          break;
        }
      }
    }
    if (same && this.nav) return;

    const S = sources.length;
    const tables: Float32Array[] = [];
    const keys: string[] = [];
    const runtimes: SpeciesSpatialRuntime[] = [];
    for (let s = 0; s < S; s++) {
      const sp = sources[s].species;
      const tp = sources[s].profile;
      const profile = resolveSpatialSpeciesProfile(
        tp.feedingType,
        sp.spatial,
        this.profileOverrides[sp.id],
        `species "${sp.id}" spatial profile`
      );
      const table = buildTerrainCostByCode(profile);
      const key = Array.from(table).join(',');
      let cls = keys.indexOf(key);
      if (cls === -1) {
        cls = keys.length;
        keys.push(key);
        tables.push(table);
      }
      const idx = getPhysiologyIndices(sp.genomeSchema);
      const base = sp.traitBaselines;
      const dw = tp.dietWeights;
      const dSum = dw.plant + dw.prey + dw.carrion + dw.detritus;
      const preferred = new Uint8Array(WORLD_BIOME_IDS.length);
      for (let b = 0; b < WORLD_BIOME_IDS.length; b++) {
        preferred[b] = sp.preferredBiomes.includes(WORLD_BIOME_IDS[b]) ? 1 : 0;
      }
      runtimes.push({
        species: sp,
        profile,
        navClass: cls,
        dPlant: dSum > 0 ? dw.plant / dSum : 0,
        ...(() => {
          const fw = this.foodPerception !== null ? this.foodPerception(tp) : dw;
          return {
            fPlant: dSum > 0 ? fw.plant / dSum : 0,
            fCarrion: dSum > 0 ? fw.carrion / dSum : 0,
            fDetritus: dSum > 0 ? fw.detritus / dSum : 0,
          };
        })(),
        dPrey: dSum > 0 ? dw.prey / dSum : 0,
        dCarrion: dSum > 0 ? dw.carrion / dSum : 0,
        dDetritus: dSum > 0 ? dw.detritus / dSum : 0,
        hasPreyDiet: dw.prey > 0,
        iBodySize: idx.bodySize,
        iStrength: idx.strength,
        iSpeed: idx.speed,
        iEndurance: idx.endurance,
        iPerception: idx.perception,
        iHeatTol: idx.heatTolerance,
        iColdTol: idx.coldTolerance,
        iAdapt: idx.environmentalAdaptability,
        iMetEff: idx.metabolismEfficiency,
        baseBodySize: base.bodySize ?? 1.0,
        baseStrength: base.strength ?? 1.0,
        baseSpeed: base.speed ?? 1.0,
        baseEndurance: base.endurance ?? 1.0,
        basePerception: base.perception ?? 1.0,
        baseHeatTol: base.heatTolerance ?? 1.0,
        baseColdTol: base.coldTolerance ?? 1.0,
        baseAdapt: base.environmentalAdaptability ?? 0.9,
        baseMetEff: base.metabolismEfficiency ?? 1.0,
        optTemp: sp.physiology.optimalTemperatureC,
        halfWidth: sp.physiology.baseThermalHalfWidthC,
        activityFactor: tp.activityCostFactor,
        adultMassMU: tp.adultStructuralMassMU,
        maxReserveRatio: tp.maxReserveToStructuralRatio,
        maxForageIntake: sp.physiology.maxForageIntakePerTick,
        preferredBiome: preferred,
        amphibiousDrinker: profile.locomotion === 'amphibious',
        ...(() => {
          const b = getSpeciesBaselineAnatomy(sp).expressed;
          return {
            anLand0: anatomyLandSpeed(b),
            anWater0: anatomyWaterPace(b),
            anHill0: anatomyHillPace(b),
            anAttack0: anatomyAttack(b),
            anDefense0: anatomyDefense(b),
            anCold0: anatomyColdShift(b),
            anHeat0: anatomyHeatShift(b),
          };
        })(),
      });
    }

    const threat = new Float32Array(S * S);
    const hunt = new Uint8Array(S * S);
    for (let p = 0; p < S; p++) {
      if (!runtimes[p].hasPreyDiet) continue;
      for (let v = 0; v < S; v++) {
        if (preyMatrix[p * S + v] === 0) continue;
        hunt[p * S + v] = 1;
        // Bigger and more carnivorous predators are perceived as more dangerous
        const ratio = runtimes[p].adultMassMU / Math.max(1e-6, runtimes[v].adultMassMU);
        threat[p * S + v] = (ratio < 0.3 ? 0.3 : ratio > 2 ? 2 : ratio) * (0.4 + 0.6 * runtimes[p].dPrey);
      }
    }

    const sameTables =
      this.nav !== undefined &&
      keys.length === this.navTableKeys.length &&
      keys.every((k, i) => k === this.navTableKeys[i]);
    if (!sameTables) {
      const prevEpoch = this.nav ? this.nav.epoch : 0;
      this.nav = new SpatialNavigator(this.grid, tables, this.navOptions);
      // Keep epochs monotonic so routes stored against a previous navigator are never trusted
      this.nav.epoch += prevEpoch;
      this.navTableKeys = keys;
    }

    this.species = runtimes;
    this.speciesSources = sources.slice();
    this.speciesCount = S;
    this.threatWeight = threat;
    this.huntable = hunt;
    this.counts = new Uint16Array(this.cellCount * S * COUNT_STRIDE);
    this.countsBuilt = false;
    this.threatField = [];
    this.alarmField = [];
    this.preyMask = [];
    this.foodField = [];
    this.waterMask = [];
    for (let i = 0; i < S; i++) {
      this.threatField.push(new Float32Array(this.cellCount));
      this.alarmField.push(new Float32Array(this.cellCount));
      this.preyMask.push(new Uint8Array(this.cellCount));
      this.foodField.push(new Float32Array(this.cellCount));
      this.waterMask.push(new Uint8Array(this.cellCount));
    }
    this.foodFieldTick = new Int32Array(S).fill(-1);
    this.waterMaskTick = new Int32Array(S).fill(-1);
  }

  get navigator(): SpatialNavigator {
    return this.nav;
  }

  getSpeciesProfile(speciesIdx: number): SpatialSpeciesProfile {
    return this.species[speciesIdx].profile;
  }

  getNavClass(speciesIdx: number): number {
    return this.species[speciesIdx].navClass;
  }

  /** True when `cell` can be occupied by members of species index `speciesIdx`. */
  isHabitableCell(speciesIdx: number, cell: number): boolean {
    return this.nav.isPassable(this.species[speciesIdx].navClass, cell);
  }

  /** Forces re-derivation of navigation data after external terrain / obstacle edits. */
  refreshNavigation(): boolean {
    return this.nav.refreshIfChanged();
  }

  // =============================================================================================
  // Slot lifecycle
  // =============================================================================================

  /** Ensures spatial state exists for entity slots `[slotBase, entitySlotCount)`. */
  ensureCapacity(entitySlotCount: number): void {
    const n = entitySlotCount - this.slotBase;
    if (n <= this.capacity) return;
    let cap = Math.max(64, this.capacity);
    while (cap < n) cap *= 2;
    this.capacity = cap;

    this.slotOrgId = growF64(this.slotOrgId, cap);
    this.behavior = growU8(this.behavior, cap);
    this.heading = growI8(this.heading, cap, -1);
    this.moveCredit = growF32(this.moveCredit, cap);
    this.fatigue = growF32(this.fatigue, cap);
    this.hydration = growF32(this.hydration, cap);
    this.exhaustion = growF32(this.exhaustion, cap);
    this.goalCell = growI32(this.goalCell, cap, -1);
    this.targetId = growF64(this.targetId, cap);
    this.targetSlot = growI32(this.targetSlot, cap, -1);
    this.wanderlust = growF32(this.wanderlust, cap);
    this.hungerStreak = growU16(this.hungerStreak, cap);
    this.modeTicks = growU16(this.modeTicks, cap);
    this.prevCell = growI32(this.prevCell, cap, -1);
    this.stuck = growU8(this.stuck, cap);
    this.homeCell = growI32(this.homeCell, cap, -1);
    this.natalCell = growI32(this.natalCell, cap, -1);
    this.travelled = growF32(this.travelled, cap);
    this.migrations = growU16(this.migrations, cap);
    this.migrating = growU8(this.migrating, cap);
    this.wpCount = growU8(this.wpCount, cap);
    this.wpIdx = growU8(this.wpIdx, cap);
    this.wpEpoch = growU32(this.wpEpoch, cap);
    this.waypoints = growI32(this.waypoints, cap * WAYPOINT_SLOTS);
    this.memCell = growI32(this.memCell, cap * MEMORY_SLOTS);
    this.memKind = growU8(this.memKind, cap * MEMORY_SLOTS);
    this.memTick = growI32(this.memTick, cap * MEMORY_SLOTS);
    this.memValue = growF32(this.memValue, cap * MEMORY_SLOTS);

    this.n_planned = growU8(this.n_planned, cap);
    this.n_cell = growI32(this.n_cell, cap);
    this.n_behavior = growU8(this.n_behavior, cap);
    this.n_heading = growI8(this.n_heading, cap);
    this.n_moveCredit = growF32(this.n_moveCredit, cap);
    this.n_fatigue = growF32(this.n_fatigue, cap);
    this.n_hydration = growF32(this.n_hydration, cap);
    this.n_exhaustion = growF32(this.n_exhaustion, cap);
    this.n_goalCell = growI32(this.n_goalCell, cap);
    this.n_targetId = growF64(this.n_targetId, cap);
    this.n_targetSlot = growI32(this.n_targetSlot, cap);
    this.n_wanderlust = growF32(this.n_wanderlust, cap);
    this.n_hungerStreak = growU16(this.n_hungerStreak, cap);
    this.n_modeTicks = growU16(this.n_modeTicks, cap);
    this.n_prevCell = growI32(this.n_prevCell, cap);
    this.n_stuck = growU8(this.n_stuck, cap);
    this.n_homeCell = growI32(this.n_homeCell, cap);
    this.n_travelAdd = growF32(this.n_travelAdd, cap);
    this.n_migrated = growU8(this.n_migrated, cap);
    this.n_migrating = growU8(this.n_migrating, cap);
    this.n_wpCount = growU8(this.n_wpCount, cap);
    this.n_wpIdx = growU8(this.n_wpIdx, cap);
    this.n_wpNew = growU8(this.n_wpNew, cap);
    this.n_waypoints = growI32(this.n_waypoints, cap * WAYPOINT_SLOTS);
    this.n_demandQ = growF64(this.n_demandQ, cap);

    this.slotToDraft = growI32(this.slotToDraft, cap, -1);
    this.x_attacked = growU8(this.x_attacked, cap);
    this.x_extraDemandQ = growF64(this.x_extraDemandQ, cap);
    this.x_fatigueAdd = growF32(this.x_fatigueAdd, cap);
    this.x_injury = growF32(this.x_injury, cap);
  }

  /**
   * Initializes the spatial state of a newly introduced or newly laid organism. Never throws.
   *
   * When `parentSlot` is given (offspring), the newborn starts with its mother's still-valid
   * knowledge of water and food places (natal imprinting): previously acquired information handed
   * on, instead of a blank individual that cannot know where the nearest water is.
   */
  initSlot(entitySlot: number, organismId: number, cell: number, tick = 0, parentEntitySlot = -1): void {
    const slot = entitySlot - this.slotBase;
    const parentSlot = parentEntitySlot >= this.slotBase ? parentEntitySlot - this.slotBase : -1;
    if (slot < 0) return;
    if (slot >= this.capacity) this.ensureCapacity(entitySlot + 1);
    this.slotOrgId[slot] = organismId;
    this.behavior[slot] = BEHAVIOR_REST;
    this.heading[slot] = -1;
    this.moveCredit[slot] = 0;
    this.fatigue[slot] = 0;
    this.hydration[slot] = 1;
    this.exhaustion[slot] = 0;
    this.goalCell[slot] = -1;
    this.targetId[slot] = 0;
    this.targetSlot[slot] = -1;
    this.wanderlust[slot] = 0;
    this.hungerStreak[slot] = 0;
    this.modeTicks[slot] = 0;
    this.prevCell[slot] = -1;
    this.stuck[slot] = 0;
    this.homeCell[slot] = cell;
    this.natalCell[slot] = cell;
    this.travelled[slot] = 0;
    this.migrations[slot] = 0;
    this.migrating[slot] = 0;
    this.wpCount[slot] = 0;
    this.wpIdx[slot] = 0;
    this.wpEpoch[slot] = 0;
    const mBase = slot * MEMORY_SLOTS;
    for (let m = 0; m < MEMORY_SLOTS; m++) {
      this.memKind[mBase + m] = MEMORY_NONE;
      this.memCell[mBase + m] = -1;
      this.memTick[mBase + m] = 0;
      this.memValue[mBase + m] = 0;
    }
    if (parentSlot >= 0 && parentSlot < this.capacity && parentSlot !== slot && this.slotOrgId[parentSlot] !== 0) {
      const pBase = parentSlot * MEMORY_SLOTS;
      let write = 0;
      for (let m = 0; m < MEMORY_SLOTS; m++) {
        const kind = this.memKind[pBase + m];
        if (kind !== MEMORY_WATER && kind !== MEMORY_FOOD) continue;
        if (tick - this.memTick[pBase + m] > this.memoryTtlTicks) continue;
        this.memKind[mBase + write] = kind;
        this.memCell[mBase + write] = this.memCell[pBase + m];
        this.memTick[mBase + write] = tick;
        this.memValue[mBase + write] = this.memValue[pBase + m];
        write++;
      }
    }
    this.n_planned[slot] = 0;
    this.n_demandQ[slot] = 0;
  }

  releaseSlot(entitySlot: number): void {
    const slot = entitySlot - this.slotBase;
    if (slot >= 0 && slot < this.capacity) {
      this.slotOrgId[slot] = 0;
      this.n_planned[slot] = 0;
      this.n_demandQ[slot] = 0;
    }
  }

  // =============================================================================================
  // Deterministic stateless randomness
  // =============================================================================================

  private rand01(tick: number, id: number, salt: number): number {
    let h = (this.seed ^ Math.imul(tick | 0, 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ (id >>> 0), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ ((id / 4294967296) >>> 0) ^ salt, 0xc2b2ae35) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d) >>> 0;
    h ^= h >>> 12;
    h = Math.imul(h, 0x297a2d39) >>> 0;
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  // =============================================================================================
  // Tick protocol
  // =============================================================================================

  /** Indexes committed positions of every living organism. Pure read of `view`. */
  beginTick(view: SpatialTickView): void {
    this.view = view;
    this.tickOpen = true;
    this.jCount = 0;
    this.t_attempts = 0;
    this.t_successes = 0;
    this.t_injuries = 0;
    this.t_migStart = 0;
    this.t_migSettle = 0;
    this.t_drinks = 0;
    this.t_moved = 0;
    this.t_pathCost = 0;
    this.t_demandQ = 0;
    this.t_scans = 0;
    this.t_behavior.fill(0);
    this.countsBuilt = false;

    const n = view.draftCount;
    if (this.occNext.length < n) {
      let cap = Math.max(256, this.occNext.length);
      while (cap < n) cap *= 2;
      this.occNext = new Int32Array(cap);
    }
    const order = view.order;
    const cellArr = view.cell;
    const slotArr = view.slot;
    const occHead = this.occHead;
    const occNext = this.occNext;
    const touched = this.occTouched;
    const slotToDraft = this.slotToDraft;
    const slotBase = this.slotBase;
    let touchedCount = 0;
    // Reverse canonical order so each cell list is traversed in ascending organism id
    for (let ci = n - 1; ci >= 0; ci--) {
      const d = order[ci];
      const c = cellArr[d];
      const head = occHead[c];
      if (head === -1) touched[touchedCount++] = c;
      occNext[d] = head;
      occHead[c] = d;
      slotToDraft[slotArr[d] - slotBase] = d;
    }
    this.occTouchedCount = touchedCount;
  }

  /** Per-cell, per-species head counts of living non-egg organisms (after this tick's mortality). */
  private buildCounts(): void {
    const view = this.view;
    const S = this.speciesCount;
    const counts = this.counts;
    const n = view.draftCount;
    const flags = view.flags;
    const stage = view.nextStage;
    const cellArr = view.cell;
    const spArr = view.speciesIdx;
    const slotArr = view.slot;
    const slotBase = this.slotBase;
    const behavior = this.behavior;
    for (let d = 0; d < n; d++) {
      const f = flags[d];
      if ((f & FLAG_DIED) !== 0 || stage[d] === STAGE_EGG) continue;
      const base = (cellArr[d] * S + spArr[d]) * COUNT_STRIDE;
      if (counts[base] < 65535) counts[base]++;
      if ((f & FLAG_ELIGIBLE) !== 0) {
        const k = base + ((f & FLAG_FEMALE) !== 0 ? 1 : 2);
        if (counts[k] < 65535) counts[k]++;
      }
      if (behavior[slotArr[d] - slotBase] === BEHAVIOR_HUNT && counts[base + 3] < 65535) counts[base + 3]++;
    }

    // Derive, for every occupied cell, what each species perceives there as threat and as prey
    const touched = this.occTouched;
    const touchedCount = this.occTouchedCount;
    const threatW = this.threatWeight;
    const huntable = this.huntable;
    const threatField = this.threatField;
    const alarmField = this.alarmField;
    const preyMask = this.preyMask;
    const present = this.presentScratch;
    const maxPresent = present.length;
    for (let i = 0; i < touchedCount; i++) {
      const c = touched[i];
      const base = c * S * COUNT_STRIDE;
      let np = 0;
      for (let q = 0; q < S && np < maxPresent; q++) {
        if (counts[base + q * COUNT_STRIDE] > 0) present[np++] = q;
      }
      for (let me = 0; me < S; me++) {
        let threat = 0;
        let alarm = 0;
        let prey = 0;
        for (let k = 0; k < np; k++) {
          const q = present[k];
          const tw = threatW[q * S + me];
          if (tw > 0) {
            threat += tw * counts[base + q * COUNT_STRIDE];
            alarm += tw * counts[base + q * COUNT_STRIDE + 3];
          }
          if (huntable[me * S + q] === 1) prey = 1;
        }
        threatField[me][c] = threat;
        alarmField[me][c] = alarm;
        preyMask[me][c] = prey;
      }
    }
    this.countsBuilt = true;
  }

  /** Food energy field of species `sp` for this tick (computed once, on first use). */
  private ensureFoodField(sp: number, tick: number): Float32Array {
    const field = this.foodField[sp];
    if (this.foodFieldTick[sp] === tick) return field;
    this.foodFieldTick[sp] = tick;
    const rt = this.species[sp];
    const view = this.view;
    const n = this.cellCount;
    const comp = this.nav.component[rt.navClass];
    const plant = view.plantMass;
    const detritus = view.detritusMass;
    const carrion = view.carrionMass;
    const bgS = view.bgPreyStruct;
    const bgR = view.bgPreyReserve;
    const kPlant = rt.fPlant * RHO_PLANT_EU;
    const kDet = rt.fDetritus * RHO_DETRITUS_EU;
    const kCar = rt.fCarrion * RHO_CARRION_EU;
    const kPreyS = bgS !== null ? rt.dPrey * RHO_STRUCT_EU : 0;
    const kPreyR = bgS !== null ? rt.dPrey * RHO_RESERVE_EU : 0;
    for (let c = 0; c < n; c++) {
      if (comp[c] < 0) {
        field[c] = 0;
        continue;
      }
      let v = 0;
      if (kPlant > 0) v += plant[c] * kPlant;
      if (kDet > 0) v += detritus[c] * kDet;
      if (kCar > 0) v += carrion[c] * kCar;
      if (kPreyR > 0) v += bgS![c] * kPreyS + bgR![c] * kPreyR;
      field[c] = v;
    }
    return field;
  }

  /** Drinkable-water mask of species `sp` for this tick (computed once, on first use). */
  private ensureWaterMask(sp: number, tick: number): Uint8Array {
    const mask = this.waterMask[sp];
    if (this.waterMaskTick[sp] === tick) return mask;
    this.waterMaskTick[sp] = tick;
    const rt = this.species[sp];
    const n = this.cellCount;
    for (let c = 0; c < n; c++) mask[c] = this.hasWater(c, rt) ? 1 : 0;
    return mask;
  }

  private trait(ex: Float32Array, idx: number, fallback: number): number {
    return idx >= 0 ? ex[idx] : fallback;
  }

  /** Evolutionary physiology model of the owning simulation (see `setPhysiologyModel`). */
  private physiologyModel = false;

  // ---- adaptive food webs (Phase 2.4.2) -----------------------------------------------------------
  private foodPerception: ((tp: TrophicProfile) => { plant: number; prey: number; carrion: number; detritus: number }) | null = null;
  private preySelection: 'capture' | 'profitability' = 'capture';
  private huntingInjuries = false;
  private x_injury = new Float32Array(0);

  /**
   * Adaptive diet: animals perceive every food their profile lets them eat, weighted by how much of
   * their need it may cover and how well they digest it (instead of the fixed diet composition).
   * Forces a rebuild of the species runtimes on the next tick.
   */
  setFoodPerception(fn: ((tp: TrophicProfile) => { plant: number; prey: number; carrion: number; detritus: number }) | null): void {
    this.foodPerception = fn;
    this.speciesSources = [];
  }

  /** Prey choice: 'capture' (most catchable, P5) or 'profitability' (expected gain, cost and risk). */
  setPreySelection(mode: 'capture' | 'profitability', injuries: boolean): void {
    this.preySelection = mode;
    this.huntingInjuries = injuries;
  }

  /** Health the occupant of `slot` lost this tick in a failed attack on dangerous prey. */
  injuryDamage(entitySlot: number): number {
    const slot = entitySlot - this.slotBase;
    return slot < this.x_injury.length ? this.x_injury[slot] : 0;
  }

  /**
   * Expected value of attacking `vd` for predator `pd`, from what the predator can perceive:
   * capture probability x food energy it can use (its remaining appetite; a carrion eater also
   * values the carcass it can return to), minus the energy of the chase and strike, discounted by
   * the risk of injury from a large, defended victim (a hungry predator accepts more risk). A
   * bounded individual misjudgement keeps the choice from always being optimal.
   */
  private preyValue(pd: number, vd: number, cellDist: number, opportunistic: boolean): number {
    const view = this.view;
    const rp = this.species[view.speciesIdx[pd]];
    const rv = this.species[view.speciesIdx[vd]];
    const p = this.captureProbability(pd, vd, cellDist, opportunistic);
    const vS = view.structMassQ[vd];
    const vR = view.reserveMassQ[vd];
    const preyE = vS * 5 + vR * 30;
    const needM = view.reqPreyQ[pd] - view.grantPreyQ[pd];
    const needE = needM > 0 ? needM * 30 : 0;
    const eaten = preyE < needE ? preyE : needE;
    const gain = eaten + (rp.dCarrion > 0 ? 0.25 * (preyE - eaten) : 0);
    const pMass = view.structMassQ[pd] + view.reserveMassQ[pd];
    const chase =
      rp.activityFactor * (pMass / 1_000_000) * rp.profile.walkCostPerCell *
      (cellDist * rp.profile.sprintCostMultiplier + rp.profile.strikeCostCells) * 1_000_000;
    const danger = this.preyDanger(vd, rv, pMass);
    const hunger = 1 - clamp01(view.nextEnergy[pd]);
    const riskAversion = 0.6 * (1 - hunger);
    const value = (p * gain - chase) * (1 - riskAversion * (1 - p) * (danger < 1 ? danger : 1));
    return value * (0.85 + 0.3 * this.rand01(view.tick, view.orgId[pd] * 7919 + view.orgId[vd], SALT_PREYCHOICE));
  }

  /** How dangerous a victim is to a predator of mass `pMass`: relative size x anatomical defence. */
  private preyDanger(vd: number, rv: SpeciesSpatialRuntime, pMass: number): number {
    const view = this.view;
    const vMass = view.structMassQ[vd] + view.reserveMassQ[vd];
    const vAn = view.org[vd].anatomy?.expressed;
    const def = vAn ? anatomyDefense(vAn) / rv.anDefense0 : 1;
    const d = (vMass / (pMass > 1 ? pMass : 1)) * def - 0.6;
    return d < 0 ? 0 : d > 2 ? 2 : d;
  }

  /**
   * Enables the evolutionary physiology model: thermal choice uses the same anatomy-derived
   * envelope as the physiology, fatigue recovery follows the aerobic (BMR) capacity, and burst
   * speed follows the efficiency-power trade-off of the metabolism.
   */
  setPhysiologyModel(enabled: boolean): void {
    this.physiologyModel = enabled;
  }

  /** Burst power of an individual relative to its species norm (efficiency-power trade-off). */
  private burstPower(org: Organism, rt: SpeciesSpatialRuntime): number {
    if (!this.physiologyModel || rt.iMetEff < 0) return 1;
    const m = org.phenotype.geneticExpression[rt.iMetEff];
    const eff = 0.55 + 0.45 * m;
    const eff0 = 0.55 + 0.45 * rt.baseMetEff;
    return Math.sqrt((eff0 > 0.45 ? eff0 : 0.45) / (eff > 0.45 ? eff : 0.45));
  }

  private isVictim(predSpecies: number, cand: number): boolean {
    const view = this.view;
    if ((view.flags[cand] & FLAG_DIED) !== 0 || view.nextStage[cand] === STAGE_EGG) return false;
    return this.huntable[predSpecies * this.speciesCount + view.speciesIdx[cand]] === 1;
  }

  /**
   * Probability in [0.02, 0.97] that predator draft `pd` seizes prey draft `vd`, from relative
   * sprint speed, body mass ratio, prey condition / age / awareness, predator condition and
   * fatigue, strike distance, opportunism and cover at the prey's cell.
   */
  private captureProbability(pd: number, vd: number, cellDist: number, opportunistic: boolean): number {
    const view = this.view;
    const rp = this.species[view.speciesIdx[pd]];
    const rv = this.species[view.speciesIdx[vd]];
    const po = view.org[pd];
    const vo = view.org[vd];
    const pe = po.phenotype.expressed;
    const ve = vo.phenotype.expressed;
    const pSlot = view.slot[pd] - this.slotBase;
    const vSlot = view.slot[vd] - this.slotBase;

    const pFat = clamp01(this.fatigue[pSlot] + this.x_fatigueAdd[pSlot]);
    const vFat = clamp01(this.fatigue[vSlot] + this.x_fatigueAdd[vSlot]);
    const pAn = po.anatomy?.expressed;
    const vAn = vo.anatomy?.expressed;
    const pAnSpeed = pAn ? anatomyLandSpeed(pAn) / rp.anLand0 : 1;
    const vAnSpeed = vAn ? anatomyLandSpeed(vAn) / rv.anLand0 : 1;
    const pSpeed =
      this.trait(pe, rp.iSpeed, rp.baseSpeed) * pAnSpeed * rp.profile.cellsPerTick * rp.profile.sprintMultiplier * (1 - 0.5 * pFat) *
      this.burstPower(po, rp);
    const vSpeed =
      this.trait(ve, rv.iSpeed, rv.baseSpeed) * vAnSpeed * rv.profile.cellsPerTick * rv.profile.sprintMultiplier * (1 - 0.5 * vFat) *
      this.burstPower(vo, rv);
    let speedTerm = 0.5 + 0.55 * (pSpeed / (vSpeed > 1e-3 ? vSpeed : 1e-3) - 1);
    speedTerm = speedTerm < 0.08 ? 0.08 : speedTerm > 0.95 ? 0.95 : speedTerm;

    const pMass = view.structMassQ[pd] + view.reserveMassQ[pd];
    const vMass = view.structMassQ[vd] + view.reserveMassQ[vd];
    const ratio = pMass / (vMass > 1 ? vMass : 1);
    const sizeTerm = ratio >= 1.2 ? 1 : ratio <= 0.3 ? 0.15 : 0.15 + (0.85 * (ratio - 0.3)) / 0.9;

    const vStage = view.nextStage[vd];
    const vulnerability =
      1 +
      0.5 * (1 - clamp01(vo.health)) +
      0.25 * (1 - clamp01(vo.energy)) +
      (vStage === STAGE_JUVENILE ? 0.3 : vStage === STAGE_ELDER ? 0.15 : 0);
    const vBehavior = this.behavior[vSlot];
    const awareness = vBehavior === BEHAVIOR_FLEE ? 0.8 : vBehavior === BEHAVIOR_REST ? 1.15 : 1;
    const condition = 0.6 + 0.4 * clamp01(po.health);
    let strength =
      1 + 0.15 * (this.trait(pe, rp.iStrength, rp.baseStrength) - this.trait(ve, rv.iStrength, rv.baseStrength));
    strength = strength < 0.7 ? 0.7 : strength > 1.3 ? 1.3 : strength;
    const biome = this.grid.biomeCode[view.cell[vd]];
    // tropical-forest = 2, temperate-forest = 3: dense cover favors the prey
    const cover = biome === 2 || biome === 3 ? 0.85 : 1;

    const pAttackScale = pAn ? anatomyAttack(pAn) / rp.anAttack0 : 1;
    const vDefenseScale = vAn ? anatomyDefense(vAn) / rv.anDefense0 : 1;

    const p =
      (speedTerm *
        sizeTerm *
        vulnerability *
        awareness *
        condition *
        strength *
        pAttackScale *
        (cellDist === 0 ? 1 : 0.7) *
        (opportunistic ? 0.6 : 1) *
        cover) /
      vDefenseScale;
    return p < 0.02 ? 0.02 : p > 0.97 ? 0.97 : p;
  }

  /**
   * RESOLVE-phase capture attempt for predator draft `pd`.
   *
   * A strike is only possible against the pursued target when it stands in the same or a legally
   * adjacent cell, or opportunistically against prey sharing the predator's cell. Returns the prey
   * draft index when the strike lands, `-1` otherwise. Success is NOT guaranteed by choosing a
   * target; both sides pay an energy and fatigue cost for every attempt.
   */
  attemptCapture(pd: number): number {
    const view = this.view;
    if (view.nextStage[pd] === STAGE_EGG) return -1;
    const S = this.speciesCount;
    const sp = view.speciesIdx[pd];
    const rt = this.species[sp];
    if (!rt.hasPreyDiet) return -1;
    const pSlot = view.slot[pd] - this.slotBase;
    const pCell = view.cell[pd];
    const w = this.width;
    const py = (pCell / w) | 0;
    const px = pCell - py * w;

    let vd = -1;
    let dist = 0;
    let opportunistic = false;

    const tId = this.targetId[pSlot];
    const tSlot = this.targetSlot[pSlot];
    if (tId > 0 && tSlot >= 0 && this.slotOrgId[tSlot] === tId) {
      const cand = this.slotToDraft[tSlot];
      if (cand >= 0 && view.orgId[cand] === tId && this.isVictim(sp, cand)) {
        const vCell = view.cell[cand];
        if (vCell === pCell) {
          vd = cand;
        } else {
          const vy = (vCell / w) | 0;
          const vx = vCell - vy * w;
          const dx = vx - px;
          const dy = vy - py;
          if (dx >= -1 && dx <= 1 && dy >= -1 && dy <= 1) {
            if (this.nav.canStep(rt.navClass, pCell, directionOf(dx, dy)) === vCell) {
              vd = cand;
              dist = 1;
            }
          }
        }
      }
    }

    if (vd === -1) {
      // Opportunism: the most catchable prey sharing this cell (bounded scan, ascending id)
      let best = -1;
      let bestP = 0;
      let examined = 0;
      for (let cand = this.occHead[pCell]; cand !== -1 && examined < 16; cand = this.occNext[cand]) {
        if (cand === pd) continue;
        if (this.huntable[sp * S + view.speciesIdx[cand]] === 0) continue;
        examined++;
        if (!this.isVictim(sp, cand)) continue;
        const p = this.preySelection === 'profitability' ? this.preyValue(pd, cand, 0, true) : this.captureProbability(pd, cand, 0, true);
        if (best === -1 || p > bestP) {
          bestP = p;
          best = cand;
        }
      }
      if (best === -1) return -1;
      vd = best;
      opportunistic = true;
    }

    const p = this.captureProbability(pd, vd, dist, opportunistic);
    const vSlot = view.slot[vd] - this.slotBase;
    const rv = this.species[view.speciesIdx[vd]];

    // Both animals burn a burst of energy and tire, whatever the outcome
    const pMassMU = (view.structMassQ[pd] + view.reserveMassQ[pd]) / 1_000_000;
    const vMassMU = (view.structMassQ[vd] + view.reserveMassQ[vd]) / 1_000_000;
    this.x_extraDemandQ[pSlot] += Math.round(
      rt.activityFactor * pMassMU * rt.profile.walkCostPerCell * rt.profile.strikeCostCells * 1_000_000
    );
    this.x_extraDemandQ[vSlot] += Math.round(
      rv.activityFactor * vMassMU * rv.profile.walkCostPerCell * rv.profile.strikeCostCells * 0.6 * 1_000_000
    );
    this.x_fatigueAdd[pSlot] += 0.1;
    this.x_fatigueAdd[vSlot] += 0.08;
    this.x_attacked[vSlot] = 1;
    this.t_attempts++;

    if (this.rand01(view.tick, view.orgId[pd], SALT_CAPTURE) < p) {
      this.t_successes++;
      return vd;
    }
    if (this.huntingInjuries) {
      // a failed attack on a large, defended victim can hurt the attacker
      const danger = this.preyDanger(vd, rv, view.structMassQ[pd] + view.reserveMassQ[pd]);
      if (danger > 0) {
        const inj = 0.05 * danger * (0.5 + 0.5 * this.rand01(view.tick, view.orgId[pd], SALT_INJURY));
        const total = this.x_injury[pSlot] + inj;
        this.x_injury[pSlot] = total < 0.25 ? total : 0.25;
        this.t_injuries++;
      }
    }
    return -1;
  }

  /** Health lost this tick by the occupant of `slot` because it is fully dehydrated. */
  dehydrationDamage(entitySlot: number): number {
    return this.hydrationEnabled && this.hydration[entitySlot - this.slotBase] <= 0
      ? this.dehydrationDamagePerTick
      : 0;
  }

  /**
   * Health lost this tick by the occupant of `slot` because it moved on energy it did not have:
   * exertion beyond the reserve is paid with body condition instead of being free.
   */
  exhaustionDamage(entitySlot: number): number {
    return this.exhaustion[entitySlot - this.slotBase] * this.exhaustionDamagePerTick;
  }

  /** Locomotion + strike energy (EU quanta) staged for the occupant of `slot` this tick. */
  stagedDemandQ(entitySlot: number): number {
    const slot = entitySlot - this.slotBase;
    return this.n_planned[slot] === 1 ? this.n_demandQ[slot] : this.x_extraDemandQ[slot];
  }

  // ---------------------------------------------------------------------------------------------
  // Memory
  // ---------------------------------------------------------------------------------------------

  private remember(slot: number, kind: number, cell: number, value: number): void {
    if (this.jCount >= this.jSlot.length) {
      const cap = this.jSlot.length * 2;
      this.jSlot = growI32(this.jSlot, cap);
      this.jCell = growI32(this.jCell, cap);
      this.jKind = growU8(this.jKind, cap);
      this.jValue = growF32(this.jValue, cap);
    }
    const j = this.jCount++;
    this.jSlot[j] = slot;
    this.jCell[j] = cell;
    this.jKind[j] = kind;
    this.jValue[j] = value;
  }

  /**
   * Applies one journal entry. An entry for the same cell is overwritten; otherwise the kind fills
   * an empty slot while under its quota, and replaces its own oldest entry once the quota is used.
   */
  private applyMemory(slot: number, kind: number, cell: number, value: number, tick: number): void {
    const base = slot * MEMORY_SLOTS;
    let target = -1;
    let empty = -1;
    let sameKind = 0;
    let oldestSame = -1;
    let oldestSameTick = Infinity;
    let oldestAny = base;
    let oldestAnyTick = Infinity;
    for (let m = 0; m < MEMORY_SLOTS; m++) {
      const i = base + m;
      const k = this.memKind[i];
      if (k === MEMORY_NONE) {
        if (empty === -1) empty = i;
        continue;
      }
      if (this.memCell[i] === cell) {
        target = i;
        break;
      }
      const t = this.memTick[i];
      if (k === kind) {
        sameKind++;
        if (t < oldestSameTick) {
          oldestSameTick = t;
          oldestSame = i;
        }
      }
      if (t < oldestAnyTick) {
        oldestAnyTick = t;
        oldestAny = i;
      }
    }
    if (target === -1) {
      if (sameKind >= MEMORY_QUOTA[kind] && oldestSame !== -1) target = oldestSame;
      else if (empty !== -1) target = empty;
      else target = oldestAny;
    }
    this.memKind[target] = kind;
    this.memCell[target] = cell;
    this.memTick[target] = tick;
    this.memValue[target] = value;
  }

  /** Best still-valid remembered cell of `kind` reachable from `cell`, or -1. */
  private recall(slot: number, kind: number, cell: number, comp: Int32Array, tick: number): number {
    const base = slot * MEMORY_SLOTS;
    const w = this.width;
    const cy = (cell / w) | 0;
    const cx = cell - cy * w;
    const myComp = comp[cell];
    let best = -1;
    let bestScore = -Infinity;
    for (let m = 0; m < MEMORY_SLOTS; m++) {
      const i = base + m;
      if (this.memKind[i] !== kind) continue;
      if (tick - this.memTick[i] > this.memoryTtlTicks) continue;
      const mc = this.memCell[i];
      if (mc === cell || mc < 0 || comp[mc] !== myComp) continue;
      const my = (mc / w) | 0;
      const mx = mc - my * w;
      const dx = mx - cx;
      const dy = my - cy;
      const dist = (dx < 0 ? -dx : dx) > (dy < 0 ? -dy : dy) ? (dx < 0 ? -dx : dx) : dy < 0 ? -dy : dy;
      const score = this.memValue[i] / (1 + 0.2 * dist);
      if (score > bestScore) {
        bestScore = score;
        best = mc;
      }
    }
    return best;
  }

  private remembers(slot: number, kind: number, cell: number, tick: number): boolean {
    const base = slot * MEMORY_SLOTS;
    for (let m = 0; m < MEMORY_SLOTS; m++) {
      const i = base + m;
      if (this.memKind[i] === kind && this.memCell[i] === cell && tick - this.memTick[i] <= this.memoryTtlTicks) {
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------------------------
  // Perception
  // ---------------------------------------------------------------------------------------------

  private hasWater(cell: number, rt: SpeciesSpatialRuntime): boolean {
    const grid = this.grid;
    const terr = grid.terrainCode[cell];
    if (terr > 1) {
      return grid.moisture[cell] >= rt.profile.waterMoistureThreshold || grid.waterDepth[cell] > 0;
    }
    return rt.amphibiousDrinker && terr === 1;
  }

  /**
   * Bounded perception: inspects only the cells within Chebyshev radius `R` of the organism,
   * clipped to the finite map. Results are written to the `sc_*` scratch fields.
   */
  private scan(
    sp: number,
    rt: SpeciesSpatialRuntime,
    cell: number,
    R: number,
    needQ: number,
    upper: number,
    lower: number,
    tLo: number,
    tHi: number,
    stressHere: number,
    wantWater: boolean,
    femaleSeeker: boolean,
    seekMate: boolean,
    tick: number
  ): void {
    const S = this.speciesCount;
    const w = this.width;
    const h = this.height;
    const cy = (cell / w) | 0;
    const cx = cell - cy * w;
    const x0 = cx - R < 0 ? 0 : cx - R;
    const x1 = cx + R >= w ? w - 1 : cx + R;
    const y0 = cy - R < 0 ? 0 : cy - R;
    const y1 = cy + R >= h ? h - 1 : cy + R;

    const comp = this.nav.component[rt.navClass];
    const myComp = comp[cell];
    const temps = this.grid.temperature;
    const occHead = this.occHead;
    const counts = this.counts;
    const threatF = this.threatField[sp];
    const preyM = this.preyMask[sp];
    const hunts = rt.hasPreyDiet;
    const alarmF = this.alarmField[sp];
    const conspOffset = sp * COUNT_STRIDE;
    const mateOffset = conspOffset + (femaleSeeker ? 2 : 1);
    const stride = S * COUNT_STRIDE;
    const food = needQ > 0 ? this.ensureFoodField(sp, tick) : null;
    const water = wantWater ? this.ensureWaterMask(sp, tick) : null;
    const valueCap = needQ * 4;
    const invR1 = 1 / (R + 1);

    let bestFoodCell = -1;
    let bestFoodScore = 0;
    let bestFoodValue = 0;
    let threatNear = 0;
    let threatX = 0;
    let threatY = 0;
    let threatCell = -1;
    let threatCellDist = 1e9;
    let preyCell = -1;
    let preyDist = 1e9;
    let preyCell2 = -1;
    let preyDist2 = 1e9;
    let preyCell3 = -1;
    let preyDist3 = 1e9;
    let waterCell = -1;
    let waterDist = 1e9;
    let mateCell = -1;
    let mateDist = 1e9;
    let comfortCell = -1;
    let comfortStress = stressHere;
    let comfortDist = 1e9;
    let consp = 0;

    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      const ady = dy < 0 ? -dy : dy;
      const row = y * w;
      for (let x = x0; x <= x1; x++) {
        const c = row + x;
        const dx = x - cx;
        const adx = dx < 0 ? -dx : dx;
        const dist = adx > ady ? adx : ady;

        let conspHere = 0;
        let threatHere = 0;
        if (occHead[c] !== -1) {
          const base = c * stride;
          conspHere = counts[base + conspOffset];
          if (conspHere > 0) {
            consp += conspHere;
            if (seekMate && dist < mateDist && counts[base + mateOffset] > 0) {
              // the seeker itself is not of the opposite sex, so any hit is another individual
              mateDist = dist;
              mateCell = c;
            }
          }
          const tf = threatF[c];
          if (tf > 0) {
            threatHere = tf * (1 - dist * invR1);
            // Flight is provoked by predators that are hunting within three cells and by any
            // predator sharing the animal's own cell; calm predators at a distance are tolerated.
            if (dist <= 3) {
              threatNear += alarmF[c] * (1 - dist * 0.25);
              if (dist === 0) threatNear += 0.5 * tf;
            }
            if (dist > 0) {
              const inv = threatHere / dist;
              threatX += dx * inv;
              threatY += dy * inv;
            }
            if (dist < threatCellDist) {
              threatCellDist = dist;
              threatCell = c;
            }
          }
          if (hunts && preyM[c] === 1 && comp[c] === myComp) {
            // keep the three nearest prey cells (profitability choice weighs them against distance)
            if (dist < preyDist) {
              preyDist3 = preyDist2; preyCell3 = preyCell2;
              preyDist2 = preyDist; preyCell2 = preyCell;
              preyDist = dist; preyCell = c;
            } else if (dist < preyDist2) {
              preyDist3 = preyDist2; preyCell3 = preyCell2;
              preyDist2 = dist; preyCell2 = c;
            } else if (dist < preyDist3) {
              preyDist3 = dist; preyCell3 = c;
            }
          }
        }

        if (dist === 0 || comp[c] !== myComp) continue;
        const t = temps[c];
        if (t < tLo || t > tHi) continue;

        const st = t > upper ? (t - upper) / 10 : t < lower ? (lower - t) / 10 : 0;
        if (stressHere > 0) {
          if (st < comfortStress || (st === comfortStress && st < stressHere && dist < comfortDist)) {
            comfortStress = st;
            comfortDist = dist;
            comfortCell = c;
          }
        }

        if (water !== null && dist < waterDist && water[c] === 1 && st <= stressHere) {
          waterDist = dist;
          waterCell = c;
        }

        if (food !== null && threatHere === 0) {
          const value = food[c];
          if (value > 0) {
            const capped = value < valueCap ? value : valueCap;
            // Rich, near, uncrowded and thermally safe cells score highest
            const score = capped / needQ / (1 + 0.5 * conspHere) / (1 + 0.35 * dist) / (1 + 3 * st);
            if (score > bestFoodScore) {
              bestFoodScore = score;
              bestFoodCell = c;
              bestFoodValue = capped / needQ;
            }
          }
        }
      }
    }

    this.sc_bestFoodCell = bestFoodCell;
    this.sc_bestFoodScore = bestFoodScore;
    this.sc_bestFoodValue = bestFoodValue;
    this.sc_threatNear = threatNear;
    this.sc_threatX = threatX;
    this.sc_threatY = threatY;
    this.sc_threatCell = threatCell;
    this.sc_preyCell = preyCell;
    this.sc_preyCell2 = preyCell2;
    this.sc_preyCell3 = preyCell3;
    this.sc_preyDist = preyDist;
    this.sc_preyDist2 = preyDist2;
    this.sc_preyDist3 = preyDist3;
    this.sc_waterCell = waterCell;
    this.sc_mateCell = mateCell;
    this.sc_mateDist = mateDist;
    this.sc_comfortCell = comfortCell;
    this.sc_consp = consp;
    this.sc_cellsSeen = (x1 - x0 + 1) * (y1 - y0 + 1);
  }

  private threatCountAt(cell: number, sp: number): number {
    return this.occHead[cell] === -1 ? 0 : this.threatField[sp][cell];
  }

  /** Most catchable valid prey individual standing in `cell` for predator draft `pd` (or -1). */
  private lastPickValue = 0;

  private pickPreyInCell(pd: number, sp: number, cell: number, cellDist = 0): number {
    let best = -1;
    let bestP = 0;
    let examined = 0;
    const profit = this.preySelection === 'profitability';
    for (let cand = this.occHead[cell]; cand !== -1 && examined < 24; cand = this.occNext[cand]) {
      if (cand === pd) continue;
      examined++;
      if (!this.isVictim(sp, cand)) continue;
      const p = profit ? this.preyValue(pd, cand, cellDist, false) : this.captureProbability(pd, cand, 0, false);
      if (profit ? best === -1 || p > bestP : p > bestP) {
        bestP = p;
        best = cand;
      }
    }
    this.lastPickValue = bestP;
    return best;
  }

  // ---------------------------------------------------------------------------------------------
  // Movement primitives
  // ---------------------------------------------------------------------------------------------

  /**
   * Walks toward `goal` with up to `points` movement points: follows a stored route when one
   * exists, otherwise steps straight, and only asks the navigator for a (budgeted) route when the
   * straight line is blocked. Returns the reached cell; details are left in the `mv_*` / `w_*` scratch.
   */
  private moveToward(cls: number, from: number, goal: number, points: number, tLo: number, tHi: number): number {
    const nav = this.nav;
    const w = this.width;
    const temps = this.grid.temperature;
    const wps = this.w_waypoints;
    const maxSteps = this.maxStepsPerTick;
    const minCost = nav.minCost[cls];
    let cur = from;
    let prev = this.mv_prev;
    let cost = 0;
    let heading = this.mv_heading;
    let planTried = false;
    this.mv_pending = false;
    let steps = 0;
    let guard = 0;

    while (steps < maxSteps && cur !== goal && guard++ < maxSteps + 4) {
      let target = goal;
      if (this.w_wpCount > 0) {
        while (this.w_wpIdx < this.w_wpCount && wps[this.w_wpIdx] === cur) this.w_wpIdx++;
        if (this.w_wpIdx >= this.w_wpCount) {
          this.w_wpCount = 0; // stored route exhausted short of the goal: plan the next stretch
        } else {
          target = wps[this.w_wpIdx];
        }
      }
      const cyy = (cur / w) | 0;
      const cxx = cur - cyy * w;
      const tyy = (target / w) | 0;
      const txx = target - tyy * w;
      const sx = txx > cxx ? 1 : txx < cxx ? -1 : 0;
      const sy = tyy > cyy ? 1 : tyy < cyy ? -1 : 0;
      let dir = directionOf(sx, sy);
      let dest = dir >= 0 ? nav.canStep(cls, cur, dir) : -1;
      if (dest !== -1) {
        const t = temps[dest];
        if (t < tLo || t > tHi) dest = -1;
      }
      if (this.w_wpCount === 0 && dest !== -1) {
        // Free steering (no planned route, straight step possible): among the three forward steps
        // - each strictly closer to the target - take the one with the lowest step cost plus
        // remaining distance, so cheap ground is preferred over a straight line across slow
        // terrain. A blocked straight step is never papered over here: it triggers planning below.
        let bestCost = nav.stepCostOf(cls, dest, dir) + minCost * octileDistance(txx - cxx - NAV_DX[dir], tyy - cyy - NAV_DY[dir]);
        for (let turn = -1; turn <= 1; turn += 2) {
          const d2 = (dir + turn + 8) & 7;
          const alt = nav.canStep(cls, cur, d2);
          if (alt === -1) continue;
          const t = temps[alt];
          if (t < tLo || t > tHi) continue;
          const c2 = nav.stepCostOf(cls, alt, d2) + minCost * octileDistance(txx - cxx - NAV_DX[d2], tyy - cyy - NAV_DY[d2]);
          if (c2 < bestCost) {
            bestCost = c2;
            dest = alt;
            dir = d2;
          }
        }
      }
      if (dest === -1) {
        this.w_wpCount = 0; // route (if any) is broken
        if (!planTried) {
          planTried = true;
          const status = nav.findPath(cls, cur, goal, tLo, tHi, wps, 0, WAYPOINT_SLOTS);
          if (status === PATH_FOUND || status === PATH_PARTIAL) {
            this.w_wpCount = nav.lastWaypointCount;
            this.w_wpIdx = 0;
            this.w_wpNew = true;
            this.mv_stuck = 0;
            continue;
          }
          if (status === PATH_UNREACHABLE) {
            this.mv_unreachable = true;
            break;
          }
          // PATH_DEFERRED: planning budget spent this tick - improvise one sidestep
        }
        dest = nav.stepToward(cls, cur, goal, prev, tLo, tHi);
        if (dest === -1) break;
        this.mv_stuck++;
        const dyy = (dest / w) | 0;
        dir = directionOf(dest - dyy * w - cxx, dyy - cyy);
      }
      const c = nav.stepCostOf(cls, dest, dir);
      if (points < c) {
        this.mv_pending = true; // keep the unspent points: progress toward this (costlier) step
        break;
      }
      points -= c;
      cost += c;
      prev = cur;
      cur = dest;
      heading = dir;
      steps++;
    }
    this.mv_cost = cost;
    this.mv_prev = prev;
    this.mv_heading = heading;
    this.mv_points = points;
    return cur;
  }

  /** Flight: each step maximizes separation from the perceived threat direction. */
  private moveFlee(
    cls: number,
    sp: number,
    from: number,
    awayX: number,
    awayY: number,
    points: number,
    tLo: number,
    tHi: number,
    tick: number,
    id: number
  ): number {
    const nav = this.nav;
    const temps = this.grid.temperature;
    const maxSteps = this.maxStepsPerTick;
    let cur = from;
    let prev = this.mv_prev;
    let cost = 0;
    let heading = this.mv_heading;
    this.mv_pending = false;
    const len = Math.sqrt(awayX * awayX + awayY * awayY);
    const ax = len > 1e-6 ? awayX / len : 0;
    const ay = len > 1e-6 ? awayY / len : 0;

    for (let step = 0; step < maxSteps; step++) {
      let best = -1;
      let bestDir = -1;
      let bestScore = -0.25;
      for (let d = 0; d < 8; d++) {
        const dest = nav.canStep(cls, cur, d);
        if (dest === -1) continue;
        const t = temps[dest];
        if (t < tLo || t > tHi) continue;
        const inv = (d & 1) === 1 ? Math.SQRT1_2 : 1;
        let score = (NAV_DX[d] * ax + NAV_DY[d] * ay) * inv;
        if (this.threatCountAt(dest, sp) > 0) score -= 1.5;
        if (dest === prev) score -= 0.4;
        score -= 0.05 * nav.stepCost[cls][dest];
        score += 0.2 * this.rand01(tick, id, SALT_FLEE + step * 8 + d);
        if (score > bestScore) {
          bestScore = score;
          best = dest;
          bestDir = d;
        }
      }
      if (best === -1) break;
      const c = nav.stepCostOf(cls, best, bestDir);
      if (points < c) {
        this.mv_pending = true;
        break;
      }
      points -= c;
      cost += c;
      prev = cur;
      cur = best;
      heading = bestDir;
    }
    this.mv_cost = cost;
    this.mv_prev = prev;
    this.mv_heading = heading;
    this.mv_points = points;
    return cur;
  }

  /**
   * Local search: correlated random walk with heading persistence (area-restricted search),
   * biased toward the species' habitat, away from thermal stress and, when thirst drives the
   * search, up the local humidity gradient.
   */
  private moveExplore(
    cls: number,
    rt: SpeciesSpatialRuntime,
    from: number,
    points: number,
    tLo: number,
    tHi: number,
    upper: number,
    lower: number,
    seekMoisture: boolean,
    tick: number,
    id: number
  ): number {
    const nav = this.nav;
    const temps = this.grid.temperature;
    const biomes = this.grid.biomeCode;
    const moist = this.grid.moisture;
    const noise = seekMoisture ? 0.35 : 0.9;
    const maxSteps = this.maxStepsPerTick;
    let cur = from;
    let prev = this.mv_prev;
    let cost = 0;
    let heading = this.mv_heading;
    this.mv_pending = false;

    for (let step = 0; step < maxSteps; step++) {
      let best = -1;
      let bestDir = -1;
      let bestScore = -Infinity;
      for (let d = 0; d < 8; d++) {
        const dest = nav.canStep(cls, cur, d);
        if (dest === -1) continue;
        const t = temps[dest];
        if (t < tLo || t > tHi) continue;
        let score = noise * this.rand01(tick, id, SALT_EXPLORE + step * 8 + d);
        // A thirsty animal follows the humidity gradient it can sense from where it stands
        if (seekMoisture) score += 14 * (moist[dest] - moist[cur]);
        if (heading >= 0) {
          let turn = d - heading;
          if (turn < 0) turn = -turn;
          if (turn > 4) turn = 8 - turn;
          score += turn === 0 ? 0.8 : turn === 1 ? 0.5 : turn === 2 ? 0 : turn === 3 ? -0.5 : -0.9;
        }
        if (dest === prev) score -= 0.8;
        if (rt.preferredBiome[biomes[dest]] === 1) score += 0.2;
        score -= 1.5 * (t > upper ? (t - upper) / 10 : t < lower ? (lower - t) / 10 : 0);
        score -= 0.1 * nav.stepCost[cls][dest];
        if (score > bestScore) {
          bestScore = score;
          best = dest;
          bestDir = d;
        }
      }
      if (best === -1) break;
      const c = nav.stepCostOf(cls, best, bestDir);
      if (points < c) {
        this.mv_pending = true;
        break;
      }
      points -= c;
      cost += c;
      prev = cur;
      cur = best;
      heading = bestDir;
    }
    this.mv_cost = cost;
    this.mv_prev = prev;
    this.mv_heading = heading;
    this.mv_points = points;
    return cur;
  }

  // ---------------------------------------------------------------------------------------------
  // Migration
  // ---------------------------------------------------------------------------------------------

  /**
   * Chooses the destination of one migration leg using ONLY local knowledge: what lies within the
   * perception window, remembered danger, the current heading and nearby migrating conspecifics.
   * Returns a reachable goal cell or -1.
   */
  private chooseMigrationGoal(
    d: number,
    slot: number,
    sp: number,
    rt: SpeciesSpatialRuntime,
    cell: number,
    R: number,
    needQ: number,
    upper: number,
    lower: number,
    tLo: number,
    tHi: number,
    legCells: number,
    tick: number,
    id: number
  ): number {
    const view = this.view;
    const S = this.speciesCount;
    const w = this.width;
    const h = this.height;
    const cls = rt.navClass;
    const cost = this.nav.stepCost[cls];
    const comp = this.nav.component[cls];
    const myComp = comp[cell];

    // 1. Group migration: join a conspecific in the same cell that is already under way
    if (rt.profile.sociality > 0) {
      let examined = 0;
      for (let o = this.occHead[cell]; o !== -1 && examined < 12; o = this.occNext[o]) {
        if (o === d || view.speciesIdx[o] !== sp || (view.flags[o] & FLAG_DIED) !== 0) continue;
        examined++;
        const oSlot = view.slot[o] - this.slotBase;
        const g = this.goalCell[oSlot];
        if (this.behavior[oSlot] === BEHAVIOR_MIGRATE && g >= 0 && g !== cell && comp[g] === myComp) {
          if (this.rand01(tick, id, SALT_FOLLOW) < rt.profile.sociality) return g;
          break;
        }
      }
    }

    // 2. Sector summary of the perceived window
    const secFood = this.secFood;
    const secConsp = this.secConsp;
    const secThreat = this.secThreat;
    const secStress = this.secStress;
    const secCells = this.secCells;
    secFood.fill(0);
    secConsp.fill(0);
    secThreat.fill(0);
    secStress.fill(0);
    secCells.fill(0);
    const cy = (cell / w) | 0;
    const cx = cell - cy * w;
    const x0 = cx - R < 0 ? 0 : cx - R;
    const x1 = cx + R >= w ? w - 1 : cx + R;
    const y0 = cy - R < 0 ? 0 : cy - R;
    const y1 = cy + R >= h ? h - 1 : cy + R;
    const temps = this.grid.temperature;
    const counts = this.counts;
    const valueCap = needQ * 4;
    const food = needQ > 0 ? this.ensureFoodField(sp, tick) : null;
    const threatF = this.threatField[sp];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx === 0 && dy === 0) continue;
        const adx = dx < 0 ? -dx : dx;
        const ady = dy < 0 ? -dy : dy;
        const sx = adx * 2 < ady ? 0 : dx > 0 ? 1 : -1;
        const sy = ady * 2 < adx ? 0 : dy > 0 ? 1 : -1;
        const sec = directionOf(sx, sy);
        const c = y * w + x;
        secCells[sec]++;
        if (this.occHead[c] !== -1) {
          secConsp[sec] += counts[(c * S + sp) * COUNT_STRIDE];
          secThreat[sec] += threatF[c];
        }
        if (cost[c] > 0 && comp[c] === myComp) {
          const v = food !== null ? food[c] : 0;
          secFood[sec] += v < valueCap ? v : valueCap;
          const t = temps[c];
          secStress[sec] += t > upper ? (t - upper) / 10 : t < lower ? (lower - t) / 10 : 0;
        }
      }
    }
    let maxFood = 0;
    let maxConsp = 0;
    for (let s = 0; s < 8; s++) {
      const n = secCells[s] > 0 ? secCells[s] : 1;
      secFood[s] /= n;
      secConsp[s] /= n;
      secStress[s] /= n;
      if (secFood[s] > maxFood) maxFood = secFood[s];
      if (secConsp[s] > maxConsp) maxConsp = secConsp[s];
    }

    // 3. Score the eight headings; each must lead to a reachable cell inside the finite map
    const heading = this.heading[slot];
    const mBase = slot * MEMORY_SLOTS;
    let bestGoal = -1;
    let bestScore = -Infinity;
    for (let dir = 0; dir < 8; dir++) {
      const ddx = NAV_DX[dir];
      const ddy = NAV_DY[dir];
      let far = -1;
      let farK = 0;
      for (let k = 1; k <= legCells; k++) {
        const x = cx + ddx * k;
        const y = cy + ddy * k;
        if (x < 0 || x >= w || y < 0 || y >= h) break;
        const c = y * w + x;
        if (cost[c] > 0 && comp[c] === myComp) {
          const t = temps[c];
          if (t >= tLo && t <= tHi) {
            far = c;
            farK = k;
          }
        }
      }
      if (far === -1 || farK < 3) continue;
      let score = 0.6 * (farK / legCells);
      if (maxFood > 0) score += 0.8 * (secFood[dir] / maxFood);
      if (maxConsp > 0) score -= 0.5 * (secConsp[dir] / maxConsp);
      if (secThreat[dir] > 0) score -= 0.8;
      score -= 1.2 * (secStress[dir] > 1.5 ? 1.5 : secStress[dir]);
      if (heading >= 0) {
        let turn = dir - heading;
        if (turn < 0) turn = -turn;
        if (turn > 4) turn = 8 - turn;
        score += turn === 0 ? 0.3 : turn === 1 ? 0.15 : turn === 4 ? -0.3 : 0;
      }
      for (let m = 0; m < MEMORY_SLOTS; m++) {
        const i = mBase + m;
        const kind = this.memKind[i];
        if (kind !== MEMORY_DANGER && kind !== MEMORY_BARREN) continue;
        if (tick - this.memTick[i] > this.memoryTtlTicks) continue;
        const mc = this.memCell[i];
        const my = (mc / w) | 0;
        const mdx = mc - my * w - cx;
        const mdy = my - cy;
        if (mdx === 0 && mdy === 0) continue;
        const amx = mdx < 0 ? -mdx : mdx;
        const amy = mdy < 0 ? -mdy : mdy;
        const msx = amx * 2 < amy ? 0 : mdx > 0 ? 1 : -1;
        const msy = amy * 2 < amx ? 0 : mdy > 0 ? 1 : -1;
        if (directionOf(msx, msy) === dir) score -= kind === MEMORY_DANGER ? 0.6 : 0.3;
      }
      score += 0.5 * this.rand01(tick, id, SALT_DIRECTION + dir);
      if (score > bestScore) {
        bestScore = score;
        bestGoal = far;
      }
    }
    return bestGoal;
  }

  // ---------------------------------------------------------------------------------------------
  // Planning
  // ---------------------------------------------------------------------------------------------

  /**
   * RESOLVE-phase planning of one tick of behavior and movement for every living, non-egg
   * organism, in canonical ascending-id order. Writes STAGED state only.
   */
  planTick(): void {
    const view = this.view;
    const tick = view.tick;
    if (this.navRevalidateInterval > 0 && tick % this.navRevalidateInterval === 0) {
      this.nav.refreshIfChanged();
    }
    this.nav.beginTick();
    this.buildCounts();

    const n = view.draftCount;
    const order = view.order;
    const flags = view.flags;
    const stage = view.nextStage;
    for (let ci = 0; ci < n; ci++) {
      const d = order[ci];
      const f = flags[d];
      if ((f & FLAG_DIED) !== 0 || stage[d] === STAGE_EGG) continue;
      this.planOrganism(d, f, tick);
    }
  }

  private planOrganism(d: number, flags: number, tick: number): void {
    const view = this.view;
    const slot = view.slot[d] - this.slotBase;
    const sp = view.speciesIdx[d];
    const rt = this.species[sp];
    const prof = rt.profile;
    const cls = rt.navClass;
    const org = view.org[d];
    const id = view.orgId[d];
    const cell = view.cell[d];
    const ex = org.phenotype.expressed;
    const w = this.width;

    const speedT = this.trait(ex, rt.iSpeed, rt.baseSpeed);
    const percT = this.trait(ex, rt.iPerception, rt.basePerception);
    let endurT = this.trait(ex, rt.iEndurance, rt.baseEndurance);
    if (endurT < 0.2) endurT = 0.2;
    const sizeT = this.trait(ex, rt.iBodySize, rt.baseBodySize);

    const E = clamp01(view.nextEnergy[d]);
    const structQ = view.structMassQ[d];
    const reserveQ = view.reserveMassQ[d];
    const massMU = (structQ + reserveQ) / 1_000_000;

    // ---- thermal envelope of this individual ---------------------------------------------------
    const heatTol = this.trait(ex, rt.iHeatTol, rt.baseHeatTol);
    const coldTol = this.trait(ex, rt.iColdTol, rt.baseColdTol);
    const adapt = this.trait(ex, rt.iAdapt, rt.baseAdapt);
    const an = org.anatomy?.expressed;
    // With the physiology model the decision envelope is the physiological one (incl. metabolic heat)
    const phys = this.physiologyModel && org.anatomy !== undefined ? getRelativeAnatomyPhysiology(org.anatomy, rt.species) : null;
    const coldShift = phys !== null ? phys.coldOffsetC : an ? anatomyColdShift(an) - rt.anCold0 : 0;
    const heatShift = phys !== null ? phys.heatOffsetC : an ? anatomyHeatShift(an) - rt.anHeat0 : 0;
    const recovery = phys !== null ? phys.recoveryScale : 1;
    const upper = rt.optTemp + rt.halfWidth + heatTol * 7.5 + adapt * 3.5 + heatShift;
    const lower = rt.optTemp - rt.halfWidth - coldTol * 8.0 - adapt * 3.5 - coldShift;
    const tHere = this.grid.temperature[cell];
    const stressHere = tHere > upper ? (tHere - upper) / 10 : tHere < lower ? (lower - tHere) / 10 : 0;
    let tHi = upper + 10 * this.lethalThermalStress;
    let tLo = lower - 10 * this.lethalThermalStress;
    // Already somewhere deadly: allow moving through cells that are no worse than this one
    if (tHere > tHi) tHi = tHere;
    if (tHere < tLo) tLo = tHere;

    // ---- hydration -----------------------------------------------------------------------------
    const thirsty = this.hydrationEnabled && prof.thirstPerTick > 0;
    let hyd = this.hydration[slot];
    let atWater = false;
    let thirstRate = 1;
    if (thirsty) {
      atWater = this.hasWater(cell, rt);
      const heat = tHere > rt.optTemp ? (tHere - rt.optTemp) / 25 : 0;
      thirstRate = prof.thirstPerTick * (1 + heat);
      if (atWater) {
        if (hyd < 0.999) this.t_drinks++;
        hyd += this.drinkPerTick;
        if (hyd > 1) hyd = 1;
      } else {
        hyd -= thirstRate;
        if (hyd < 0) hyd = 0;
      }
    } else {
      hyd = 1;
    }

    // ---- feeding outcome of this tick (what the current cell actually yielded) -----------------
    const reqE =
      view.reqPlantQ[d] * RHO_PLANT_EU +
      view.reqDetritusQ[d] * RHO_DETRITUS_EU +
      view.reqCarrionQ[d] * RHO_CARRION_EU +
      view.reqPreyQ[d] * RHO_RESERVE_EU;
    const grantE =
      view.grantPlantQ[d] * RHO_PLANT_EU +
      view.grantDetritusQ[d] * RHO_DETRITUS_EU +
      view.grantCarrionQ[d] * RHO_CARRION_EU +
      view.grantPreyQ[d] * RHO_RESERVE_EU;
    const satisfaction = reqE > 0 ? (grantE < reqE ? grantE / reqE : 1) : 1;
    const fedWell = reqE <= 0 || satisfaction >= 0.7;
    const hunger = 1 - E;
    // One tick of appetite, in EU quanta: scale for judging how rich a cell is
    const needQ = structQ * rt.maxReserveRatio * RHO_RESERVE_EU * rt.maxForageIntake;

    // ---- previous state ------------------------------------------------------------------------
    const prevBehavior = this.behavior[slot];
    let goal = this.goalCell[slot];
    let tgtId = this.targetId[slot];
    let tgtSlot = this.targetSlot[slot];
    let wl = this.wanderlust[slot];
    let streak = this.hungerStreak[slot];
    let modeTicks = this.modeTicks[slot];
    let home = this.homeCell[slot];
    let stuck = this.stuck[slot];
    let migrating = this.migrating[slot] === 1;
    const attacked = this.x_attacked[slot] === 1;
    let fat = this.fatigue[slot] + this.x_fatigueAdd[slot];
    if (fat > 1) fat = 1;
    const eligible = (flags & FLAG_ELIGIBLE) !== 0;
    const arrived = goal !== -1 && goal === cell;

    this.w_wpNew = false;
    if (this.wpEpoch[slot] === this.nav.epoch && this.wpCount[slot] > 0) {
      this.w_wpCount = this.wpCount[slot];
      this.w_wpIdx = this.wpIdx[slot];
      const base = slot * WAYPOINT_SLOTS;
      for (let i = 0; i < this.w_wpCount; i++) this.w_waypoints[i] = this.waypoints[base + i];
    } else {
      this.w_wpCount = 0;
      this.w_wpIdx = 0;
    }

    // Walking pace this individual can currently sustain (movement points per tick)
    const terr = this.grid.terrainCode[cell];
    let anPaceMul = 1;
    if (an) {
      if (terr <= 1) {
        anPaceMul = anatomyWaterPace(an) / rt.anWater0;
      } else if (terr >= 4) {
        anPaceMul = anatomyHillPace(an) / rt.anHill0;
      } else {
        anPaceMul = anatomyLandSpeed(an) / rt.anLand0;
      }
    }
    const paceEstimate =
      prof.cellsPerTick * speedT * anPaceMul * Math.sqrt(Math.sqrt(sizeT > 0.05 ? sizeT : 0.05)) * (1 - 0.5 * fat);

    let behavior = prevBehavior;
    let fleeX = 0;
    let fleeY = 0;
    let migrationStarted = false;
    let exploreForWater = thirsty && !atWater && hyd < 0.5;

    const urgent =
      attacked ||
      arrived ||
      prevBehavior === BEHAVIOR_FLEE ||
      prevBehavior === BEHAVIOR_HUNT ||
      stressHere > 0 ||
      (!fedWell && E < 0.6) ||
      (thirsty && !atWater && hyd < 0.6) ||
      (goal === -1 && prevBehavior !== BEHAVIOR_REST && prevBehavior !== BEHAVIOR_FORAGE);
    const think = urgent || (tick + id) % this.thinkInterval === 0;

    if (think) {
      let R = Math.round(prof.perceptionRangeCells * percT);
      if (R > this.maxPerceptionRadius) R = this.maxPerceptionRadius;
      // Even an immature or weakened individual senses its immediate surroundings
      const minR = prof.perceptionRangeCells >= 2 ? 2 : prof.perceptionRangeCells > 0 ? 1 : 0;
      if (R < minR) R = minR;
      const wantWater = thirsty && !atWater;
      const femaleSeeker = (flags & FLAG_FEMALE) !== 0;
      this.t_scans++;
      this.scan(sp, rt, cell, R, needQ, upper, lower, tLo, tHi, stressHere, wantWater, femaleSeeker, eligible, tick);

      const comp = this.nav.component[cls];

      // ---- memory formation -------------------------------------------------------------------
      if (this.sc_bestFoodCell !== -1 && this.sc_bestFoodValue >= 1) {
        this.remember(slot, MEMORY_FOOD, this.sc_bestFoodCell, this.sc_bestFoodValue);
      }
      if (atWater) this.remember(slot, MEMORY_WATER, cell, 1);
      else if (wantWater && this.sc_waterCell !== -1) this.remember(slot, MEMORY_WATER, this.sc_waterCell, 1);
      if (attacked) {
        this.remember(slot, MEMORY_DANGER, cell, 2);
      } else if (this.sc_threatNear > 0 && this.sc_threatCell !== -1) {
        this.remember(slot, MEMORY_DANGER, this.sc_threatCell, this.sc_threatNear);
      }
      if (reqE > 0 && satisfaction < 0.3 && this.remembers(slot, MEMORY_FOOD, cell, tick)) {
        this.remember(slot, MEMORY_BARREN, cell, 0);
      }

      const hereScore = reqE > 0 ? satisfaction * 4 : 4;
      const betterElsewhere = this.sc_bestFoodCell !== -1 && this.sc_bestFoodScore > hereScore * 1.25;
      const memFood = !fedWell && this.sc_bestFoodCell === -1 ? this.recall(slot, MEMORY_FOOD, cell, comp, tick) : -1;
      const memWater =
        wantWater && this.sc_waterCell === -1 ? this.recall(slot, MEMORY_WATER, cell, comp, tick) : -1;
      const waterGoal = this.sc_waterCell !== -1 ? this.sc_waterCell : memWater;

      // ---- hunting target ----------------------------------------------------------------------
      let preyDraft = -1;
      if (rt.hasPreyDiet && !fedWell && E < 0.9) {
        if (tgtId > 0 && tgtSlot >= 0 && this.slotOrgId[tgtSlot] === tgtId) {
          const cand = this.slotToDraft[tgtSlot];
          if (cand >= 0 && view.orgId[cand] === tgtId && this.isVictim(sp, cand)) {
            const vc = view.cell[cand];
            const vy = (vc / w) | 0;
            const ddx = vc - vy * w - (cell - ((cell / w) | 0) * w);
            const ddy = vy - ((cell / w) | 0);
            const dist = (ddx < 0 ? -ddx : ddx) > (ddy < 0 ? -ddy : ddy) ? (ddx < 0 ? -ddx : ddx) : ddy < 0 ? -ddy : ddy;
            if (dist <= R + 1 && comp[vc] === comp[cell]) preyDraft = cand;
          }
        }
        if (preyDraft === -1 && this.sc_preyCell !== -1) {
          if (this.preySelection === 'profitability') {
            // weigh the prey of the three nearest prey cells by expected gain, chase cost and risk
            let bestV = -Infinity;
            const cells = [this.sc_preyCell, this.sc_preyCell2, this.sc_preyCell3];
            const dists = [this.sc_preyDist, this.sc_preyDist2, this.sc_preyDist3];
            for (let k = 0; k < 3; k++) {
              if (cells[k] === -1) continue;
              const c = this.pickPreyInCell(d, sp, cells[k], dists[k]);
              if (c === -1) continue;
              const v = this.lastPickValue;
              if (v > bestV) {
                bestV = v;
                preyDraft = c;
              }
            }
            // a well-fed predator does not bother with prey that is not worth the effort
            if (preyDraft !== -1 && bestV <= 0 && E > 0.4) preyDraft = -1;
          } else {
            preyDraft = this.pickPreyInCell(d, sp, this.sc_preyCell);
          }
        }
      }

      // ---- pressure to leave the area (accumulates over consecutive decisions) -----------------
      if (!fedWell && E < 0.5) {
        if (streak < 65535) streak++;
      } else if (fedWell) {
        streak = 0;
      }
      const crowd = this.sc_cellsSeen > 0 ? this.sc_consp / this.sc_cellsSeen : 0;
      let pressure = 0;
      // Hunger only pushes an animal away when it neither sees better food nor has prey in sight
      if (!fedWell && E < 0.45 && !betterElsewhere && preyDraft === -1) pressure += 0.06 + 0.015 * (streak < 10 ? streak : 10);
      if (stressHere > 0 && this.sc_comfortCell === -1) pressure += 0.12 * (stressHere > 1 ? 2 : stressHere * 2);
      if (attacked || this.sc_threatNear > 0) pressure += 0.05;
      if (crowd > prof.crowdingTolerance && prof.crowdingTolerance > 0) {
        const excess = crowd / prof.crowdingTolerance - 1;
        pressure += 0.04 * (excess > 3 ? 3 : excess);
      }
      if (wantWater && hyd < 0.4 && waterGoal === -1) pressure += 0.08;
      if (eligible && this.sc_mateCell === -1) pressure += 0.01;
      if (pressure > 0) wl += pressure;
      else wl -= E >= 0.6 ? 0.06 : 0.03;
      wl = wl < 0 ? 0 : wl > 2 ? 2 : wl;

      // ---- a migrant settles when the place it has reached is good ---------------------------
      let settled = false;
      if (migrating) {
        const fedHere = (reqE > 0 && satisfaction >= 0.7) || E >= 0.8;
        const waterOk = !thirsty || atWater || hyd > 0.5 || waterGoal !== -1;
        if (
          cell !== home &&
          fedHere &&
          waterOk &&
          this.sc_threatNear === 0 &&
          stressHere === 0 &&
          crowd <= prof.crowdingTolerance
        ) {
          settled = true;
          migrating = false;
          wl *= 0.25;
          home = cell;
          if (prevBehavior === BEHAVIOR_MIGRATE) goal = -1;
          this.t_migSettle++;
        } else if (wl < 0.1) {
          migrating = false; // the urge faded without finding a better place
        }
      }

      // ---- utilities: the strongest drive wins; the previous activity has inertia -------------
      const tendency =
        (0.6 + 0.25 * endurT + 0.15 * speedT) *
        (0.7 + 0.6 * this.rand01(0, id, SALT_TEMPERAMENT)) *
        (1.25 - 0.5 * prof.siteFidelity);
      const inertia = 0.08;
      let best = BEHAVIOR_REST;
      let bestU = 0.05 + (fat > 0.6 ? 0.15 + fat * 0.8 : 0) + (prevBehavior === BEHAVIOR_REST ? inertia : 0);

      // Flight is triggered by predators that are close; distant ones only make the area less
      // attractive. Acute thirst or starvation makes an animal accept more risk.
      let fear = this.sc_threatNear * prof.fearSensitivity;
      if (attacked && fear < 1.3) fear = 1.3;
      if (fear > 0) {
        let u = 0.3 + (fear > 1.3 ? 1.3 : fear);
        const dryNeed = thirsty ? (1 - hyd) * (1 - hyd) : 0;
        const foodNeed = hunger > 0.7 ? (hunger - 0.7) / 0.3 : 0;
        if (!attacked) u *= 1 - 0.45 * (dryNeed > foodNeed ? dryNeed : foodNeed);
        if (prevBehavior === BEHAVIOR_FLEE) u += inertia;
        if (u > bestU) {
          bestU = u;
          best = BEHAVIOR_FLEE;
        }
      }
      if (reqE > 0 && grantE > 0) {
        const u = 0.2 + 0.5 * hunger * satisfaction + (prevBehavior === BEHAVIOR_FORAGE ? inertia : 0);
        if (u > bestU) {
          bestU = u;
          best = BEHAVIOR_FORAGE;
        }
      }
      let foodGoal = -1;
      if (!fedWell) {
        if (betterElsewhere) foodGoal = this.sc_bestFoodCell;
        else if (memFood !== -1) foodGoal = memFood;
        if (foodGoal !== -1) {
          const u =
            (betterElsewhere ? 0.25 + 0.8 * hunger * (1 - 0.5 * satisfaction) : 0.2 + 0.6 * hunger) +
            (prevBehavior === BEHAVIOR_SEEK_FOOD ? inertia : 0);
          if (u > bestU) {
            bestU = u;
            best = BEHAVIOR_SEEK_FOOD;
          }
        }
      }
      if (preyDraft !== -1) {
        const catchP = this.captureProbability(d, preyDraft, 0, false);
        const u = (0.3 + 0.8 * hunger) * (0.5 + 0.5 * catchP) + (prevBehavior === BEHAVIOR_HUNT ? inertia : 0);
        if (u > bestU) {
          bestU = u;
          best = BEHAVIOR_HUNT;
        }
      }
      if (wantWater && hyd < 0.9 && waterGoal !== -1) {
        // Anticipation: how many ticks of water are left versus how long the walk to the known
        // water takes at this animal's own pace. The trip starts while there is still slack.
        const gy = (waterGoal / w) | 0;
        const cyy = (cell / w) | 0;
        const ddx = waterGoal - gy * w - (cell - cyy * w);
        const ddy = gy - cyy;
        const dist = (ddx < 0 ? -ddx : ddx) > (ddy < 0 ? -ddy : ddy) ? (ddx < 0 ? -ddx : ddx) : ddy < 0 ? -ddy : ddy;
        const travelTicks = (dist * 1.3) / (paceEstimate > 0.15 ? paceEstimate : 0.15);
        const slack = hyd / thirstRate - travelTicks;
        const urgency = slack <= 1 ? 1 : slack >= 9 ? 0 : 1 - (slack - 1) / 8;
        if (urgency > 0) {
          const u = 0.25 + 1.25 * urgency + (prevBehavior === BEHAVIOR_SEEK_WATER ? inertia : 0);
          if (u > bestU) {
            bestU = u;
            best = BEHAVIOR_SEEK_WATER;
          }
        }
      }
      if (stressHere > 0 && this.sc_comfortCell !== -1) {
        const u = 0.4 + (stressHere > 0.66 ? 1 : stressHere * 1.5) + (prevBehavior === BEHAVIOR_SEEK_COMFORT ? inertia : 0);
        if (u > bestU) {
          bestU = u;
          best = BEHAVIOR_SEEK_COMFORT;
        }
      }
      if (eligible && this.sc_mateCell !== -1 && this.sc_mateDist > 1) {
        const u = 0.3 + 0.2 * E + (prevBehavior === BEHAVIOR_SEEK_MATE ? inertia : 0);
        if (u > bestU) {
          bestU = u;
          best = BEHAVIOR_SEEK_MATE;
        }
      }
      const lostForFood = !fedWell && E < 0.75 && foodGoal === -1 && preyDraft === -1;
      const lostForWater = wantWater && hyd < 0.5 && waterGoal === -1;
      if (lostForFood || lostForWater) {
        const dry = 1 - hyd;
        const uFood = lostForFood ? 0.22 + 0.5 * hunger : 0;
        const uWater = lostForWater ? 0.25 + 1.3 * dry * dry : 0;
        exploreForWater = uWater >= uFood && lostForWater;
        const u = (uWater > uFood ? uWater : uFood) + (prevBehavior === BEHAVIOR_EXPLORE ? inertia : 0);
        if (u > bestU) {
          bestU = u;
          best = BEHAVIOR_EXPLORE;
        }
      }
      if (!settled) {
        // Bounded so that acute needs (flight, severe thirst) always override the urge to travel
        let u = wl * tendency - 0.35;
        if (u > 1.2) u = 1.2;
        if (prevBehavior === BEHAVIOR_MIGRATE && goal !== -1 && !arrived) u += 0.15;
        if (u > bestU) {
          bestU = u;
          best = BEHAVIOR_MIGRATE;
        }
      }

      // ---- turn the chosen activity into a concrete goal --------------------------------------
      let newGoal = -1;
      tgtId = 0;
      tgtSlot = -1;
      if (best === BEHAVIOR_FLEE) {
        fleeX = -this.sc_threatX;
        fleeY = -this.sc_threatY;
      } else if (best === BEHAVIOR_SEEK_FOOD) {
        // Commitment: keep walking to the food already chosen while it is still there, instead of
        // re-targeting every tick (which would also throw away the planned route)
        if (
          prevBehavior === BEHAVIOR_SEEK_FOOD &&
          goal !== -1 &&
          !arrived &&
          this.ensureFoodField(sp, tick)[goal] > 0 &&
          this.threatCountAt(goal, sp) === 0
        ) {
          newGoal = goal;
        } else {
          newGoal = foodGoal;
        }
      } else if (best === BEHAVIOR_HUNT) {
        tgtId = view.orgId[preyDraft];
        tgtSlot = view.slot[preyDraft] - this.slotBase;
        newGoal = view.cell[preyDraft];
      } else if (best === BEHAVIOR_SEEK_WATER) {
        newGoal = prevBehavior === BEHAVIOR_SEEK_WATER && goal !== -1 && !arrived ? goal : waterGoal;
      } else if (best === BEHAVIOR_SEEK_COMFORT) {
        newGoal = this.sc_comfortCell;
      } else if (best === BEHAVIOR_SEEK_MATE) {
        newGoal = this.sc_mateCell;
      } else if (best === BEHAVIOR_MIGRATE) {
        if (prevBehavior === BEHAVIOR_MIGRATE && goal !== -1 && !arrived) {
          newGoal = goal;
        } else {
          const leg = Math.max(4, Math.round(prof.migrationLegCells * (0.6 + 0.4 * endurT)));
          newGoal = this.chooseMigrationGoal(d, slot, sp, rt, cell, R, needQ, upper, lower, tLo, tHi, leg, tick, id);
          if (newGoal === -1) {
            // Nowhere to go from here (e.g. a small island): keep searching locally instead
            best = BEHAVIOR_EXPLORE;
            wl *= 0.6;
          } else if (!migrating) {
            migrationStarted = true;
            migrating = true;
          }
        }
      }
      if (newGoal !== goal) {
        this.w_wpCount = 0;
        stuck = 0;
      }
      goal = newGoal;
      if (best !== prevBehavior) modeTicks = 0;
      behavior = best;
    } else if (goal === -1 && behavior !== BEHAVIOR_REST && behavior !== BEHAVIOR_FORAGE) {
      behavior = BEHAVIOR_REST;
    }

    // ---- movement ----------------------------------------------------------------------------
    let sprint = false;
    let wantsMove = false;
    if (behavior === BEHAVIOR_FLEE) {
      sprint = fat < 0.85;
      wantsMove = true;
    } else if (behavior === BEHAVIOR_HUNT) {
      wantsMove = goal !== -1 && goal !== cell;
      if (wantsMove && fat < 0.85) {
        const gy = (goal / w) | 0;
        const cyy = (cell / w) | 0;
        const ddx = goal - gy * w - (cell - cyy * w);
        const ddy = gy - cyy;
        sprint = ddx >= -3 && ddx <= 3 && ddy >= -3 && ddy <= 3;
      }
    } else if (behavior === BEHAVIOR_EXPLORE) {
      wantsMove = true;
    } else if (behavior !== BEHAVIOR_REST && behavior !== BEHAVIOR_FORAGE) {
      wantsMove = goal !== -1 && goal !== cell;
    }

    let newCell: number = cell;
    let credit = 0;
    let unitQ = 0;
    let exhaustion = 0;
    this.mv_cost = 0;
    this.mv_prev = this.prevCell[slot];
    this.mv_heading = this.heading[slot];
    this.mv_unreachable = false;
    this.mv_stuck = stuck;
    let demandQ = this.x_extraDemandQ[slot];

    if (wantsMove) {
      let speedPts = paceEstimate;
      if (thirsty && hyd <= 0) speedPts *= this.dehydratedSpeedFactor;
      if (sprint) speedPts *= prof.sprintMultiplier * this.burstPower(org, rt);
      let points = this.moveCredit[slot] + speedPts;
      // Energy of one unit of path cost, EU quanta. Movement is never free: it is paid from the
      // reserve, and an animal too depleted to pay for a step can only crawl - the unpaid part of
      // its effort then costs health next tick (exhaustion) instead of energy it does not have.
      unitQ = rt.activityFactor * massMU * prof.walkCostPerCell * (sprint ? prof.sprintCostMultiplier : 1) * 1_000_000;
      if (reserveQ * RHO_RESERVE_EU < unitQ) {
        points = this.moveCredit[slot] + speedPts * this.exhaustedSpeedFactor;
      }
      if (behavior === BEHAVIOR_FLEE) {
        newCell = this.moveFlee(cls, sp, cell, fleeX, fleeY, points, tLo, tHi, tick, id);
      } else if (behavior === BEHAVIOR_EXPLORE) {
        newCell = this.moveExplore(cls, rt, cell, points, tLo, tHi, upper, lower, exploreForWater, tick, id);
      } else {
        this.mv_points = points;
        newCell = this.moveToward(cls, cell, goal, points, tLo, tHi);
      }
      // Unspent points carry over only as progress toward a step that was too costly this tick
      credit = this.mv_pending ? this.mv_points : 0;
      if (this.mv_cost > 0) {
        const moveQ = Math.round(unitQ * this.mv_cost);
        demandQ += moveQ;
        const availableQ = reserveQ * RHO_RESERVE_EU;
        if (moveQ > availableQ) exhaustion = (moveQ - availableQ) / moveQ;
        this.t_pathCost += this.mv_cost;
        if (newCell !== cell) this.t_moved++;
      }
      stuck = this.mv_stuck;
      if (this.mv_unreachable || stuck >= 6) {
        // Give the goal up and remember it as a dead end so it is not chosen again
        if (goal !== -1) this.remember(slot, MEMORY_BARREN, goal, 0);
        goal = -1;
        tgtId = 0;
        tgtSlot = -1;
        this.w_wpCount = 0;
        stuck = 0;
        if (behavior === BEHAVIOR_MIGRATE) wl *= 0.7;
      }
    }

    // ---- fatigue -----------------------------------------------------------------------------
    if (this.mv_cost > 0) {
      fat += ((sprint ? 0.09 : 0.008) * this.mv_cost) / endurT - 0.03 * endurT * recovery;
    } else {
      fat -= 0.14 * endurT * recovery;
    }
    fat = fat < 0 ? 0 : fat > 1 ? 1 : fat;

    if (migrationStarted) this.t_migStart++;
    this.t_behavior[behavior]++;

    // ---- stage -------------------------------------------------------------------------------
    this.n_planned[slot] = 1;
    this.n_cell[slot] = newCell;
    this.n_behavior[slot] = behavior;
    this.n_heading[slot] = this.mv_heading;
    this.n_moveCredit[slot] = credit;
    this.n_fatigue[slot] = fat;
    this.n_hydration[slot] = hyd;
    this.n_exhaustion[slot] = exhaustion;
    this.n_goalCell[slot] = goal;
    this.n_targetId[slot] = tgtId;
    this.n_targetSlot[slot] = tgtSlot;
    this.n_wanderlust[slot] = wl;
    this.n_hungerStreak[slot] = streak;
    this.n_modeTicks[slot] = modeTicks < 65535 ? modeTicks + 1 : modeTicks;
    this.n_prevCell[slot] = this.mv_prev;
    this.n_stuck[slot] = stuck;
    this.n_homeCell[slot] = home;
    this.n_travelAdd[slot] = this.mv_cost;
    this.n_migrated[slot] = migrationStarted ? 1 : 0;
    this.n_migrating[slot] = migrating ? 1 : 0;
    this.n_wpCount[slot] = this.w_wpCount;
    this.n_wpIdx[slot] = this.w_wpIdx;
    this.n_wpNew[slot] = this.w_wpNew ? 1 : 0;
    if (this.w_wpNew) {
      const base = slot * WAYPOINT_SLOTS;
      for (let i = 0; i < this.w_wpCount; i++) this.n_waypoints[base + i] = this.w_waypoints[i];
    }
    this.n_demandQ[slot] = demandQ;
    this.t_demandQ += demandQ;
  }

  /**
   * Makes the staged plan current. Called strictly AFTER the energy transaction committed and
   * therefore must not throw: it only copies typed-array values and updates organism coordinates.
   * Returns the number of organisms whose cell changed.
   */
  commitTick(): number {
    const view = this.view;
    const n = view.draftCount;
    const flags = view.flags;
    const slotArr = view.slot;
    const orgArr = view.org;
    const w = this.width;
    const epoch = this.nav.epoch;
    const slotBase = this.slotBase;
    let movedCount = 0;

    for (let d = 0; d < n; d++) {
      if ((flags[d] & FLAG_DIED) !== 0) continue;
      const slot = slotArr[d] - slotBase;
      if (this.n_planned[slot] !== 1) continue;
      const nc = this.n_cell[slot];
      const org = orgArr[d];
      if (nc !== org.cellIndex) {
        const y = (nc / w) | 0;
        org.x = nc - y * w;
        org.y = y;
        org.cellIndex = nc;
        movedCount++;
      }
      this.behavior[slot] = this.n_behavior[slot];
      this.heading[slot] = this.n_heading[slot];
      this.moveCredit[slot] = this.n_moveCredit[slot];
      this.fatigue[slot] = this.n_fatigue[slot];
      this.hydration[slot] = this.n_hydration[slot];
      this.exhaustion[slot] = this.n_exhaustion[slot];
      this.goalCell[slot] = this.n_goalCell[slot];
      this.targetId[slot] = this.n_targetId[slot];
      this.targetSlot[slot] = this.n_targetSlot[slot];
      this.wanderlust[slot] = this.n_wanderlust[slot];
      this.hungerStreak[slot] = this.n_hungerStreak[slot];
      this.modeTicks[slot] = this.n_modeTicks[slot];
      this.prevCell[slot] = this.n_prevCell[slot];
      this.stuck[slot] = this.n_stuck[slot];
      this.homeCell[slot] = this.n_homeCell[slot];
      this.travelled[slot] += this.n_travelAdd[slot];
      if (this.n_migrated[slot] === 1 && this.migrations[slot] < 65535) this.migrations[slot]++;
      this.migrating[slot] = this.n_migrating[slot];
      this.wpCount[slot] = this.n_wpCount[slot];
      this.wpIdx[slot] = this.n_wpIdx[slot];
      if (this.n_wpNew[slot] === 1) {
        const base = slot * WAYPOINT_SLOTS;
        const cnt = this.n_wpCount[slot];
        for (let i = 0; i < cnt; i++) this.waypoints[base + i] = this.n_waypoints[base + i];
        this.wpEpoch[slot] = epoch;
      }
    }

    const tick = view.tick;
    for (let j = 0; j < this.jCount; j++) {
      this.applyMemory(this.jSlot[j], this.jKind[j], this.jCell[j], this.jValue[j], tick);
    }

    const st = this.stats;
    st.ticks++;
    st.moves += this.t_moved;
    st.pathCost += this.t_pathCost;
    st.locomotionEnergyQ += this.t_demandQ;
    st.scans += this.t_scans;
    st.huntAttempts += this.t_attempts;
    st.huntSuccesses += this.t_successes;
    st.huntInjuries += this.t_injuries;
    st.migrationsStarted += this.t_migStart;
    st.migrationsSettled += this.t_migSettle;
    st.drinks += this.t_drinks;
    st.pathRequests += this.nav.tickStats.requests;
    st.pathNodesExpanded += this.nav.tickStats.nodesExpanded;
    for (let b = 0; b < BEHAVIOR_COUNT; b++) st.behaviorCounts[b] = this.t_behavior[b];
    return movedCount;
  }

  /**
   * Clears every per-tick scratch structure. Runs after COMMIT and after ABORT alike; after an
   * abort it is the only thing that happens, so no staged value ever reaches committed state.
   */
  endTick(): void {
    if (!this.tickOpen) return;
    this.tickOpen = false;
    const view = this.view;
    const n = view.draftCount;
    const slotArr = view.slot;
    const slotBase = this.slotBase;
    for (let d = 0; d < n; d++) {
      const slot = slotArr[d] - slotBase;
      this.slotToDraft[slot] = -1;
      this.x_attacked[slot] = 0;
      this.x_extraDemandQ[slot] = 0;
      this.x_fatigueAdd[slot] = 0;
      this.x_injury[slot] = 0;
      this.n_planned[slot] = 0;
      this.n_demandQ[slot] = 0;
    }
    const occHead = this.occHead;
    const touched = this.occTouched;
    const S = this.speciesCount;
    const stride = S * COUNT_STRIDE;
    const clearCounts = this.countsBuilt;
    for (let i = 0; i < this.occTouchedCount; i++) {
      const c = touched[i];
      occHead[c] = -1;
      if (clearCounts) {
        const base = c * stride;
        for (let k = 0; k < stride; k++) this.counts[base + k] = 0;
      }
    }
    this.occTouchedCount = 0;
    this.countsBuilt = false;
    this.jCount = 0;
  }

  // =============================================================================================
  // Inspection (never used by the simulation itself)
  // =============================================================================================

  describeSlot(entitySlot: number): OrganismSpatialState | undefined {
    const slot = entitySlot - this.slotBase;
    if (slot < 0 || slot >= this.capacity || this.slotOrgId[slot] === 0) return undefined;
    const memory: { kind: string; cell: number; tick: number; value: number }[] = [];
    const base = slot * MEMORY_SLOTS;
    for (let m = 0; m < MEMORY_SLOTS; m++) {
      const kind = this.memKind[base + m];
      if (kind === MEMORY_NONE) continue;
      memory.push({
        kind: MEMORY_KIND_NAMES[kind],
        cell: this.memCell[base + m],
        tick: this.memTick[base + m],
        value: this.memValue[base + m],
      });
    }
    return Object.freeze({
      slot: entitySlot,
      behavior: this.behavior[slot],
      behaviorName: BEHAVIOR_NAMES[this.behavior[slot]],
      heading: this.heading[slot],
      goalCell: this.goalCell[slot],
      targetId: this.targetId[slot],
      fatigue: this.fatigue[slot],
      hydration: this.hydration[slot],
      exhaustion: this.exhaustion[slot],
      wanderlust: this.wanderlust[slot],
      moveCredit: this.moveCredit[slot],
      homeCell: this.homeCell[slot],
      natalCell: this.natalCell[slot],
      pathCostTravelled: this.travelled[slot],
      migrations: this.migrations[slot],
      migrating: this.migrating[slot] === 1,
      memory,
    });
  }

  /**
   * Exact bytes held by per-organism spatial state (committed + staged + per-tick scratch) for the
   * current slot capacity, measured from the live typed arrays.
   */
  estimateStateBytes(): number {
    const cap = this.capacity;
    if (cap === 0) return 0;
    let bytes = 0;
    for (const value of Object.values(this) as unknown[]) {
      if (!ArrayBuffer.isView(value) || value === this.occHead || value === this.occTouched) continue;
      const view = value as unknown as { length: number; byteLength: number };
      if (view.length === cap || view.length === cap * WAYPOINT_SLOTS || view.length === cap * MEMORY_SLOTS) {
        bytes += view.byteLength;
      }
    }
    return bytes;
  }
}

/**
 * Partitions organisms into spatially separated groups: two occupied cells belong to the same
 * subpopulation when a chain of occupied cells links them with Chebyshev gaps of at most
 * `linkDistance`. This is the measurement foundation for geographic isolation and genetic
 * divergence; it performs no speciation.
 */
export function computeSubpopulations(
  organisms: readonly Organism[],
  gridWidth: number,
  gridHeight: number,
  linkDistance: number,
  navComponent?: Int32Array
): Subpopulation[] {
  if (!Number.isInteger(linkDistance) || linkDistance < 1) {
    throw new RangeError(`linkDistance must be a positive integer, received: ${linkDistance}`);
  }
  const cellToNode = new Map<number, number>();
  const nodeCell: number[] = [];
  const parent: number[] = [];
  for (const org of organisms) {
    if (!org.alive) continue;
    if (!cellToNode.has(org.cellIndex)) {
      cellToNode.set(org.cellIndex, nodeCell.length);
      parent.push(nodeCell.length);
      nodeCell.push(org.cellIndex);
    }
  }
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  for (let i = 0; i < nodeCell.length; i++) {
    const c = nodeCell[i];
    const cy = Math.floor(c / gridWidth);
    const cx = c - cy * gridWidth;
    for (let dy = -linkDistance; dy <= linkDistance; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= gridHeight) continue;
      for (let dx = -linkDistance; dx <= linkDistance; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= gridWidth) continue;
        const other = cellToNode.get(y * gridWidth + x);
        if (other === undefined) continue;
        const ra = find(i);
        const rb = find(other);
        if (ra !== rb) parent[ra > rb ? ra : rb] = ra > rb ? rb : ra;
      }
    }
  }

  interface Acc {
    size: number;
    cells: Set<number>;
    sumX: number;
    sumY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    sums: number[];
    ids: number[];
    firstCell: number;
  }
  const groups = new Map<number, Acc>();
  for (const org of organisms) {
    if (!org.alive) continue;
    const root = find(cellToNode.get(org.cellIndex)!);
    let acc = groups.get(root);
    if (!acc) {
      acc = {
        size: 0,
        cells: new Set<number>(),
        sumX: 0,
        sumY: 0,
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
        sums: new Array<number>(org.phenotype.geneticExpression.length).fill(0),
        ids: [],
        firstCell: nodeCell[root],
      };
      groups.set(root, acc);
    }
    acc.size++;
    acc.cells.add(org.cellIndex);
    acc.sumX += org.x;
    acc.sumY += org.y;
    if (org.x < acc.minX) acc.minX = org.x;
    if (org.x > acc.maxX) acc.maxX = org.x;
    if (org.y < acc.minY) acc.minY = org.y;
    if (org.y > acc.maxY) acc.maxY = org.y;
    const gen = org.phenotype.geneticExpression;
    for (let l = 0; l < acc.sums.length && l < gen.length; l++) acc.sums[l] += gen[l];
    acc.ids.push(org.id);
  }

  const out: (Subpopulation & { readonly firstCell: number })[] = [];
  for (const acc of groups.values()) {
    acc.ids.sort((a, b) => a - b);
    out.push({
      size: acc.size,
      cellCount: acc.cells.size,
      centroidX: acc.sumX / acc.size,
      centroidY: acc.sumY / acc.size,
      minX: acc.minX,
      maxX: acc.maxX,
      minY: acc.minY,
      maxY: acc.maxY,
      navComponent: navComponent ? navComponent[acc.firstCell] : -1,
      meanGeneticExpression: acc.sums.map((v) => v / acc.size),
      organismIds: acc.ids,
      firstCell: acc.firstCell,
    });
  }
  out.sort((a, b) => b.size - a.size || a.firstCell - b.firstCell);
  return out.map(({ firstCell: _firstCell, ...rest }) => rest);
}
