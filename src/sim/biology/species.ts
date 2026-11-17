import { WorldBiomeId } from '../worldGrid';
import {
  CORE_GENOME_SCHEMA,
  CORE_TRAIT_IDS,
  CoreTraitId,
  GenomeSchema,
  TraitId,
  TraitRange,
} from './genome';
import { MutationConfig, validateMutationConfig } from './mutation';
import type { SpatialSpeciesProfile } from './spatialProfile';
import {
  TrophicProfile,
  TrophicType,
  isTrophicType,
  resolveSpeciesTrophicProfile,
  validateTrophicProfile,
} from './trophicProfile';

export type DietType = TrophicType;

/**
 * Authoritative world-wide simulation biological time scale.
 * One tick is an abstract discrete simulation step (NOT a literal Earth calendar day),
 * calibrated at `50` ticks per biological year across all species in the world.
 */
export const WORLD_TICKS_PER_BIOLOGICAL_YEAR = 50;
export const WORLD_TICK_UNIT_LABEL =
  '1 tick = 1 abstract simulation step (50 ticks = 1 biological year)';

export interface SpeciesTimeScale {
  /** Authoritative world conversion: simulation ticks per 1 biological year (must equal WORLD_TICKS_PER_BIOLOGICAL_YEAR = 50) */
  readonly ticksPerBiologicalYear: number;
  readonly tickUnitLabel: string;
}

export interface SpeciesLifecycleConfig {
  /** Ticks spent in egg incubation before hatching (for Raptor: 10 ticks = 0.20 bio-years) */
  readonly incubationTicks: number;
  /** Ticks spent as juvenile after hatching before reaching sexual maturity (for Raptor: 22 ticks = 0.44 bio-years; maturity at 0.64 bio-years) */
  readonly juvenileTicks: number;
  /** Age in ticks from laying when senescence begins (for Raptor: 130 ticks = 2.60 bio-years) */
  readonly elderAgeTicks: number;
  /** Baseline maximum lifespan in ticks (for Raptor: 185 ticks = 3.70 bio-years, modulated modestly by endurance/metabolism) */
  readonly maxLifespanTicks: number;
  /** Relative physical body scale at hatching in (0, 1], ramping up to 1.0 at maturity */
  readonly hatchlingPhysicalScale: number;
}

export interface SpeciesReproductionConfig {
  /** Minimum ticks after reproduction before organism can breed again */
  readonly cooldownTicks: number;
  /** Minimum normalized energy [0, 1] required for an adult to breed */
  readonly minEnergyToReproduce: number;
  /** Minimum normalized health [0, 1] required for an adult to breed */
  readonly minHealthToReproduce: number;
  /** Energy cost deducted from each parent upon reproduction */
  readonly parentEnergyCost: number;
  /** Minimum eggs/offspring per breeding event */
  readonly clutchSizeMin: number;
  /** Maximum eggs/offspring per breeding event */
  readonly clutchSizeMax: number;
  /** Initial energy reserve inside freshly laid egg (used during incubation) */
  readonly eggInitialEnergy: number;
  /** Probability [0, 1] of offspring being female */
  readonly femaleProbability: number;
  /** Relative fertility multiplier once organism enters elder stage in [0, 1] */
  readonly elderFertilityMultiplier: number;
}

export interface SpeciesPhysiologyConfig {
  /** Baseline energy consumed per tick for an organism of trait scale 1.0 */
  readonly baseMetabolicCostPerTick: number;
  /** Passive energy loss per tick while incubating in egg */
  readonly eggIncubationCostPerTick: number;
  /** Preferred ambient temperature in °C */
  readonly optimalTemperatureC: number;
  /** Half-width of comfortable temperature band around optimalTemperatureC before tolerances apply */
  readonly baseThermalHalfWidthC: number;
  /** Health damage per tick per unit of normalized thermal stress */
  readonly thermalDamagePerTick: number;
  /** Health damage per tick when energy drops to 0 */
  readonly starvationDamagePerTick: number;
  /** Natural health regeneration per tick when well-fed and thermally comfortable */
  readonly healingPerTick: number;
  /** Base prey energy intake capacity per tick when foraging */
  readonly maxForageIntakePerTick: number;
}

export interface SpeciesDefinition {
  readonly id: string;
  readonly name: string;
  readonly diet: DietType;
  readonly preferredBiomes: readonly WorldBiomeId[];
  readonly genomeSchema: GenomeSchema;
  /**
   * Explicit contract of loci required by this species' physiology module.
   * Defaults to `CORE_TRAIT_IDS` when omitted.
   */
  readonly requiredTraits?: readonly TraitId[];
  readonly traitBaselines: Readonly<Record<CoreTraitId | string, number>>;
  readonly traitRanges: Readonly<Record<CoreTraitId | string, TraitRange>>;
  /** Standard deviation of initial population traits expressed as fraction of trait range span */
  readonly initialGeneticSpread: number;
  readonly timeScale: SpeciesTimeScale;
  readonly lifecycle: SpeciesLifecycleConfig;
  readonly reproduction: SpeciesReproductionConfig;
  readonly physiology: SpeciesPhysiologyConfig;
  readonly mutation: MutationConfig;
  /** Optional explicit Revision 3 trophic parameters; falls back to legacy adapter when omitted. */
  readonly trophicProfile?: TrophicProfile;
  /**
   * Optional spatial physiology (locomotion mode, speed, perception range, terrain costs, ...).
   * Only consulted when the simulation runs with spatial behavior enabled; omitted fields fall
   * back to diet-derived defaults.
   */
  readonly spatial?: Partial<SpatialSpeciesProfile>;
}

/**
 * Converts simulation ticks to biological years using the species' authoritative `ticksPerBiologicalYear`.
 */
export function ticksToBiologicalYears(ticks: number, species: SpeciesDefinition): number {
  const tpy = species.timeScale.ticksPerBiologicalYear;
  if (!Number.isFinite(tpy) || tpy <= 0) {
    throw new RangeError(`Invalid ticksPerBiologicalYear for species "${species.id}": ${tpy}`);
  }
  return ticks / tpy;
}

/**
 * Converts biological years into simulation ticks using the species' authoritative `ticksPerBiologicalYear`.
 */
export function biologicalYearsToTicks(biologicalYears: number, species: SpeciesDefinition): number {
  const tpy = species.timeScale.ticksPerBiologicalYear;
  if (!Number.isFinite(tpy) || tpy <= 0) {
    throw new RangeError(`Invalid ticksPerBiologicalYear for species "${species.id}": ${tpy}`);
  }
  return biologicalYears * tpy;
}

/**
 * First concrete biological species: Raptor (agile warm-climate predator).
 * Built purely atop the generic SpeciesDefinition + CORE_GENOME_SCHEMA architecture.
 *
 * Lifecycle alignment at 50 ticks = 1 biological year:
 * - Incubation: 10 ticks (0.20 bio-years)
 * - Juvenile:   22 ticks (0.44 bio-years; sexual maturity at 32 ticks = 0.64 bio-years)
 * - Elder onset: 130 ticks (2.60 bio-years)
 * - Max lifespan: 185 ticks (3.70 bio-years baseline)
 */
export const RAPTOR_SPECIES: SpeciesDefinition = {
  id: 'raptor',
  name: 'Raptor',
  diet: 'carnivore',
  preferredBiomes: ['savanna', 'shrubland', 'tropical-forest', 'temperate-forest', 'coastal-wetland'],
  genomeSchema: CORE_GENOME_SCHEMA,
  requiredTraits: CORE_TRAIT_IDS,
  traitBaselines: {
    bodySize: 1.0,
    strength: 1.05,
    speed: 1.25,
    endurance: 1.1,
    perception: 1.2,
    intelligence: 0.95,
    heatTolerance: 1.0,
    coldTolerance: 0.75,
    metabolismEfficiency: 1.0,
    environmentalAdaptability: 0.9,
  },
  traitRanges: {
    bodySize: { min: 0.45, max: 2.1 },
    strength: { min: 0.4, max: 2.3 },
    speed: { min: 0.5, max: 2.5 },
    endurance: { min: 0.4, max: 2.3 },
    perception: { min: 0.45, max: 2.4 },
    intelligence: { min: 0.3, max: 2.2 },
    heatTolerance: { min: 0.1, max: 2.2 },
    coldTolerance: { min: 0.05, max: 2.1 },
    metabolismEfficiency: { min: 0.4, max: 2.0 },
    environmentalAdaptability: { min: 0.1, max: 2.0 },
  },
  initialGeneticSpread: 0.12,
  timeScale: {
    ticksPerBiologicalYear: WORLD_TICKS_PER_BIOLOGICAL_YEAR,
    tickUnitLabel: WORLD_TICK_UNIT_LABEL,
  },
  lifecycle: {
    incubationTicks: 10,
    juvenileTicks: 22,
    elderAgeTicks: 130,
    maxLifespanTicks: 185,
    hatchlingPhysicalScale: 0.35,
  },
  reproduction: {
    cooldownTicks: 16,
    minEnergyToReproduce: 0.62,
    minHealthToReproduce: 0.55,
    parentEnergyCost: 0.24,
    clutchSizeMin: 1,
    clutchSizeMax: 3,
    eggInitialEnergy: 0.72,
    femaleProbability: 0.5,
    elderFertilityMultiplier: 0.35,
  },
  physiology: {
    baseMetabolicCostPerTick: 0.036,
    eggIncubationCostPerTick: 0.024,
    optimalTemperatureC: 24,
    baseThermalHalfWidthC: 9,
    thermalDamagePerTick: 0.045,
    starvationDamagePerTick: 0.08,
    healingPerTick: 0.03,
    maxForageIntakePerTick: 0.12,
  },
  mutation: {
    baseRate: 0.045,
    stepScale: 0.08,
    directionalBias: 0.0,
    locusOverrides: {
      intelligence: { rateMultiplier: 0.8, scaleMultiplier: 0.85 },
      bodySize: { rateMultiplier: 0.9, scaleMultiplier: 0.9 },
      metabolismEfficiency: { rateMultiplier: 0.85, scaleMultiplier: 0.9 },
    },
  },
};

function assertFiniteRange(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite, received: ${value}`);
  }
}

function assertNonNegativeFinite(value: number, label: string): void {
  assertFiniteRange(value, label);
  if (value < 0) {
    throw new RangeError(`${label} must be >= 0, received: ${value}`);
  }
}

function assertUnitInterval(value: number, label: string): void {
  assertFiniteRange(value, label);
  if (value < 0 || value > 1) {
    throw new RangeError(`${label} must be in [0, 1], received: ${value}`);
  }
}

/**
 * Validates full internal consistency of a `SpeciesDefinition` at registration time
 * so invalid schemas, negative time parameters, or bad ranges fail immediately.
 */
export function validateSpeciesDefinition(species: SpeciesDefinition): void {
  if (!species.id || !species.id.trim()) {
    throw new RangeError('Species id must be non-empty');
  }
  if (!species.name || !species.name.trim()) {
    throw new RangeError(`Species "${species.id}" name must be non-empty`);
  }
  if (!isTrophicType(species.diet)) {
    throw new RangeError(`Species "${species.id}" diet must be a valid trophic type, received: ${String(species.diet)}`);
  }

  // 1. Unified world time scale
  const ts = species.timeScale;
  assertFiniteRange(ts.ticksPerBiologicalYear, `species "${species.id}" timeScale.ticksPerBiologicalYear`);
  if (ts.ticksPerBiologicalYear !== WORLD_TICKS_PER_BIOLOGICAL_YEAR) {
    throw new RangeError(
      `Species "${species.id}" must use unified world time scale (${WORLD_TICKS_PER_BIOLOGICAL_YEAR} ticks/bio-year), received: ${ts.ticksPerBiologicalYear}`
    );
  }
  if (!ts.tickUnitLabel || !ts.tickUnitLabel.trim()) {
    throw new RangeError(`Species "${species.id}" tickUnitLabel must be non-empty`);
  }

  // 2. Lifecycle stage progression & positive bounds
  const lc = species.lifecycle;
  assertNonNegativeFinite(lc.incubationTicks, `species "${species.id}" lifecycle.incubationTicks`);
  assertNonNegativeFinite(lc.juvenileTicks, `species "${species.id}" lifecycle.juvenileTicks`);
  assertNonNegativeFinite(lc.elderAgeTicks, `species "${species.id}" lifecycle.elderAgeTicks`);
  assertNonNegativeFinite(lc.maxLifespanTicks, `species "${species.id}" lifecycle.maxLifespanTicks`);
  assertFiniteRange(lc.hatchlingPhysicalScale, `species "${species.id}" lifecycle.hatchlingPhysicalScale`);
  if (lc.hatchlingPhysicalScale <= 0 || lc.hatchlingPhysicalScale > 1) {
    throw new RangeError(
      `Species "${species.id}" lifecycle.hatchlingPhysicalScale must be in (0, 1], received: ${lc.hatchlingPhysicalScale}`
    );
  }
  const maturityTicks = lc.incubationTicks + lc.juvenileTicks;
  if (maturityTicks <= 0) {
    throw new RangeError(
      `Species "${species.id}" maturity age (incubationTicks + juvenileTicks) must be > 0`
    );
  }
  if (lc.elderAgeTicks <= maturityTicks) {
    throw new RangeError(
      `Species "${species.id}" lifecycle.elderAgeTicks (${lc.elderAgeTicks}) must be > maturity age (${maturityTicks})`
    );
  }
  if (lc.maxLifespanTicks <= lc.elderAgeTicks) {
    throw new RangeError(
      `Species "${species.id}" lifecycle.maxLifespanTicks (${lc.maxLifespanTicks}) must be > elderAgeTicks (${lc.elderAgeTicks})`
    );
  }

  // 3. Reproduction bounds
  const rep = species.reproduction;
  assertNonNegativeFinite(rep.cooldownTicks, `species "${species.id}" reproduction.cooldownTicks`);
  assertUnitInterval(rep.minEnergyToReproduce, `species "${species.id}" reproduction.minEnergyToReproduce`);
  assertUnitInterval(rep.minHealthToReproduce, `species "${species.id}" reproduction.minHealthToReproduce`);
  assertUnitInterval(rep.parentEnergyCost, `species "${species.id}" reproduction.parentEnergyCost`);
  assertUnitInterval(rep.eggInitialEnergy, `species "${species.id}" reproduction.eggInitialEnergy`);
  assertUnitInterval(rep.femaleProbability, `species "${species.id}" reproduction.femaleProbability`);
  assertUnitInterval(rep.elderFertilityMultiplier, `species "${species.id}" reproduction.elderFertilityMultiplier`);
  if (!Number.isInteger(rep.clutchSizeMin) || rep.clutchSizeMin < 0) {
    throw new RangeError(
      `Species "${species.id}" reproduction.clutchSizeMin must be a non-negative integer, received: ${rep.clutchSizeMin}`
    );
  }
  if (!Number.isInteger(rep.clutchSizeMax) || rep.clutchSizeMax < rep.clutchSizeMin) {
    throw new RangeError(
      `Species "${species.id}" reproduction.clutchSizeMax (${rep.clutchSizeMax}) must be an integer >= clutchSizeMin (${rep.clutchSizeMin})`
    );
  }

  // 4. Physiology bounds
  const phys = species.physiology;
  assertNonNegativeFinite(phys.baseMetabolicCostPerTick, `species "${species.id}" physiology.baseMetabolicCostPerTick`);
  assertNonNegativeFinite(phys.eggIncubationCostPerTick, `species "${species.id}" physiology.eggIncubationCostPerTick`);
  assertFiniteRange(phys.optimalTemperatureC, `species "${species.id}" physiology.optimalTemperatureC`);
  assertFiniteRange(phys.baseThermalHalfWidthC, `species "${species.id}" physiology.baseThermalHalfWidthC`);
  if (phys.baseThermalHalfWidthC <= 0) {
    throw new RangeError(
      `Species "${species.id}" physiology.baseThermalHalfWidthC must be > 0, received: ${phys.baseThermalHalfWidthC}`
    );
  }
  assertNonNegativeFinite(phys.thermalDamagePerTick, `species "${species.id}" physiology.thermalDamagePerTick`);
  assertNonNegativeFinite(phys.starvationDamagePerTick, `species "${species.id}" physiology.starvationDamagePerTick`);
  assertNonNegativeFinite(phys.healingPerTick, `species "${species.id}" physiology.healingPerTick`);
  assertNonNegativeFinite(phys.maxForageIntakePerTick, `species "${species.id}" physiology.maxForageIntakePerTick`);

  // 5. Genome schema contract & trait ranges/baselines
  const required = species.requiredTraits ?? CORE_TRAIT_IDS;
  for (const traitId of required) {
    if (!species.genomeSchema.hasTrait(traitId)) {
      throw new RangeError(
        `Species "${species.id}" genomeSchema "${species.genomeSchema.id}" is missing required physiological trait locus "${traitId}"`
      );
    }
  }
  assertNonNegativeFinite(species.initialGeneticSpread, `species "${species.id}" initialGeneticSpread`);

  for (const def of species.genomeSchema.loci) {
    const range = species.traitRanges[def.id] ?? def.defaultRange;
    assertFiniteRange(range.min, `species "${species.id}" traitRanges.${def.id}.min`);
    assertFiniteRange(range.max, `species "${species.id}" traitRanges.${def.id}.max`);
    if (range.max < range.min) {
      throw new RangeError(
        `Species "${species.id}" traitRanges.${def.id} invalid: min (${range.min}) > max (${range.max})`
      );
    }
    const base = species.traitBaselines[def.id];
    if (base !== undefined) {
      assertFiniteRange(base, `species "${species.id}" traitBaselines.${def.id}`);
      if (base < range.min || base > range.max) {
        throw new RangeError(
          `Species "${species.id}" traitBaselines.${def.id} (${base}) outside traitRanges [${range.min}, ${range.max}]`
        );
      }
    }
  }
  for (const [traitId, range] of Object.entries(species.traitRanges)) {
    assertFiniteRange(range.min, `species "${species.id}" traitRanges.${traitId}.min`);
    assertFiniteRange(range.max, `species "${species.id}" traitRanges.${traitId}.max`);
    if (range.max < range.min) {
      throw new RangeError(
        `Species "${species.id}" traitRanges.${traitId} invalid: min (${range.min}) > max (${range.max})`
      );
    }
  }

  // 6. Mutation configuration
  validateMutationConfig(species.mutation);

  // 7. Trophic profile (if explicitly declared)
  if (species.trophicProfile !== undefined) {
    validateTrophicProfile(
      species.trophicProfile,
      species.diet,
      `species "${species.id}" trophicProfile`
    );
  }
}

export class SpeciesRegistry {
  private readonly speciesMap = new Map<string, SpeciesDefinition>();
  private readonly trophicMap = new Map<string, TrophicProfile>();
  private cachedList: SpeciesDefinition[] | null = null;

  register(species: SpeciesDefinition): void {
    validateSpeciesDefinition(species);
    const resolvedTrophic = resolveSpeciesTrophicProfile(species);
    this.speciesMap.set(species.id, species);
    this.trophicMap.set(species.id, resolvedTrophic);
    this.cachedList = null;
  }

  get(speciesId: string): SpeciesDefinition {
    const found = this.speciesMap.get(speciesId);
    if (!found) {
      throw new RangeError(`Unknown species id: ${speciesId}`);
    }
    return found;
  }

  getTrophicProfile(speciesId: string): TrophicProfile {
    const found = this.trophicMap.get(speciesId);
    if (!found) {
      throw new RangeError(`Unknown species id: ${speciesId}`);
    }
    return found;
  }

  has(speciesId: string): boolean {
    return this.speciesMap.has(speciesId);
  }

  list(): readonly SpeciesDefinition[] {
    if (!this.cachedList) {
      this.cachedList = Array.from(this.speciesMap.values());
    }
    return this.cachedList;
  }
}

export function createDefaultSpeciesRegistry(): SpeciesRegistry {
  const registry = new SpeciesRegistry();
  registry.register(RAPTOR_SPECIES);
  return registry;
}
