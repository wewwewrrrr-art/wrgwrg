import { divHalfEvenBig } from '../detMath';
import { MU_QUANTA_PER_UNIT, PPM, euToQ, fractionToPpm, muToQ, numberToQuanta } from '../units';

export const TROPHIC_TYPES = [
  'herbivore',
  'carnivore',
  'omnivore',
  'scavenger',
  'detritivore',
] as const;

export type TrophicType = (typeof TROPHIC_TYPES)[number];

export interface TrophicDietWeights {
  readonly plant: number;
  readonly prey: number;
  readonly carrion: number;
  readonly detritus: number;
}

export interface NormalizedDietWeightsPpm {
  readonly plantPpm: number;
  readonly preyPpm: number;
  readonly carrionPpm: number;
  readonly detritusPpm: number;
}

/**
 * Typed trophic parameterization for a biological species (Revision 3 / Phase 2.2.1b P2).
 *
 * Each of the 10 physiological parameters controls an orthogonal aspect of feeding, allocation,
 * metabolism or reproduction with zero double-counting:
 *   1. `adultStructuralMassMU`         target adult structural mass (MU)
 *   2. `maxReserveToStructuralRatio`   maximum reserve mass cap relative to current structure
 *   3. `absorptionEfficiency`          gut absorption fraction of ingested food energy in (0, 1]
 *   4. `assimilationEfficiency`        post-absorption retention (1 - SDA fraction) in (0, 1]
 *   5. `growthEfficiency`              reserve-to-structure synthesis efficiency in (0, 1]
 *   6. `structuralAllocationFraction`  share of current reserve eligible for growth per step in [0, 1]
 *   7. `basalMetabolicFactor`          Kleiber resting basal multiplier (>= 0)
 *   8. `thermoregulationFactor`        thermal-stress metabolic multiplier (>= 0)
 *   9. `activityCostFactor`            locomotion/activity metabolic multiplier (>= 0)
 *  10. `reproductiveEfficiency`        maternal-reserve to offspring-structure efficiency in (0, 1]
 */
export interface TrophicProfile {
  readonly feedingType: TrophicType;
  readonly dietWeights: TrophicDietWeights;
  readonly adultStructuralMassMU: number;
  readonly maxReserveToStructuralRatio: number;
  readonly absorptionEfficiency: number;
  readonly assimilationEfficiency: number;
  readonly growthEfficiency: number;
  readonly structuralAllocationFraction: number;
  readonly basalMetabolicFactor: number;
  readonly thermoregulationFactor: number;
  readonly activityCostFactor: number;
  readonly reproductiveEfficiency: number;
  /**
   * Adaptive diet (optional, Phase 2.4.2; used only when the simulation runs with `adaptiveDiet`):
   * how far each food may replace missing preferred food. Omitted foods take the defaults of the
   * feeding type (`defaultDietFlexibility`). `dietWeights` stay the preferred composition.
   */
  readonly dietFlexibility?: Partial<Readonly<Record<keyof TrophicDietWeights, DietFlexibilityRule>>>;
}

/**
 * One food in the adaptive diet: `maxShare` is the largest fraction of the tick's energy need this
 * food may cover (>= its preferred share means it can take over missing food; 0 = not edible for
 * this species), `extraDigestibility` scales the absorption of food eaten beyond the preferred
 * composition (a scavenger digests detritus worse than carrion). Live prey additionally requires
 * a hunting species (preferred prey share > 0): the rule cannot make a scavenger a hunter.
 */
export interface DietFlexibilityRule {
  readonly maxShare: number;
  readonly extraDigestibility: number;
}

const NO_FOOD: DietFlexibilityRule = Object.freeze({ maxShare: 0, extraDigestibility: 1 });

/**
 * Feeding-type defaults of the adaptive diet. They keep the specialisations: herbivores eat only
 * plants, carnivores substitute live prey and carrion for each other, scavengers can fall back on
 * detritus (poorly digested) but cannot hunt, detritivores can take some carrion, omnivores are broad.
 */
export function defaultDietFlexibility(type: TrophicType): Readonly<Record<keyof TrophicDietWeights, DietFlexibilityRule>> {
  const r = (maxShare: number, extraDigestibility: number): DietFlexibilityRule => Object.freeze({ maxShare, extraDigestibility });
  switch (type) {
    case 'herbivore':
      return Object.freeze({ plant: r(1, 1), prey: NO_FOOD, carrion: NO_FOOD, detritus: NO_FOOD });
    case 'carnivore':
      return Object.freeze({ plant: NO_FOOD, prey: r(1, 1), carrion: r(1, 1), detritus: NO_FOOD });
    case 'scavenger':
      return Object.freeze({ plant: NO_FOOD, prey: NO_FOOD, carrion: r(1, 1), detritus: r(0.6, 0.6) });
    case 'detritivore':
      return Object.freeze({ plant: NO_FOOD, prey: NO_FOOD, carrion: r(0.5, 0.8), detritus: r(1, 1) });
    case 'omnivore':
    default:
      return Object.freeze({ plant: r(1, 0.9), prey: r(1, 1), carrion: r(1, 0.9), detritus: r(0.3, 0.6) });
  }
}

/** Effective adaptive-diet rules of a profile (explicit rules over feeding-type defaults). */
export function resolveDietFlexibility(profile: TrophicProfile): Readonly<Record<keyof TrophicDietWeights, DietFlexibilityRule>> {
  const base = defaultDietFlexibility(profile.feedingType);
  const o = profile.dietFlexibility;
  if (!o) return base;
  return Object.freeze({
    plant: o.plant ?? base.plant,
    prey: o.prey ?? base.prey,
    carrion: o.carrion ?? base.carrion,
    detritus: o.detritus ?? base.detritus,
  });
}

/** Minimal legacy species contract consumed by `deriveDefaultTrophicProfile`. */
export interface LegacyTrophicSource {
  readonly id: string;
  readonly diet: TrophicType;
  readonly traitBaselines: Readonly<Record<string, number>>;
  readonly physiology: {
    readonly baseMetabolicCostPerTick: number;
    readonly maxForageIntakePerTick: number;
  };
  readonly reproduction: {
    readonly parentEnergyCost: number;
    readonly eggInitialEnergy: number;
  };
  readonly trophicProfile?: TrophicProfile;
}

const DIET_SUM_TOLERANCE = 1e-6;
const RESOURCE_COUNT_KEYS: readonly (keyof TrophicDietWeights)[] = ['plant', 'prey', 'carrion', 'detritus'];

export function isTrophicType(value: unknown): value is TrophicType {
  return typeof value === 'string' && (TROPHIC_TYPES as readonly string[]).includes(value);
}

function assertPositiveFinite(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be finite and > 0, received: ${value}`);
  }
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and >= 0, received: ${value}`);
  }
}

function assertHalfOpenUnit(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new RangeError(`${label} must be in (0, 1], received: ${value}`);
  }
}

function assertClosedUnit(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be in [0, 1], received: ${value}`);
  }
}

/**
 * Normalizes non-negative diet weights so their sum equals `1.0`.
 * Rejects NaN, negatives, Infinity, and all-zero vectors.
 */
export function normalizeDietWeights(weights: TrophicDietWeights, label = 'dietWeights'): TrophicDietWeights {
  if (!weights || typeof weights !== 'object') {
    throw new RangeError(`${label} must be an object`);
  }
  const { plant, prey, carrion, detritus } = weights;
  assertNonNegativeFinite(plant, `${label}.plant`);
  assertNonNegativeFinite(prey, `${label}.prey`);
  assertNonNegativeFinite(carrion, `${label}.carrion`);
  assertNonNegativeFinite(detritus, `${label}.detritus`);

  const sum = plant + prey + carrion + detritus;
  if (!Number.isFinite(sum) || sum <= 0) {
    throw new RangeError(`${label} must have a strictly positive sum, received: ${sum}`);
  }

  return Object.freeze({
    plant: plant / sum,
    prey: prey / sum,
    carrion: carrion / sum,
    detritus: detritus / sum,
  });
}

/**
 * Converts normalized `TrophicDietWeights` into exact integer PPM shares whose sum is strictly `PPM`
 * (`1_000_000`) via deterministic largest-remainder (Hamilton) allocation with canonical key tie-breaking.
 */
export function dietWeightsToPpm(weights: TrophicDietWeights, label = 'dietWeights'): NormalizedDietWeightsPpm {
  const norm = normalizeDietWeights(weights, label);
  const raw = RESOURCE_COUNT_KEYS.map((k) => numberToQuanta(norm[k], PPM, 'half-even'));
  const totalRaw = raw[0] + raw[1] + raw[2] + raw[3];
  const entries = RESOURCE_COUNT_KEYS.map((key, idx) => {
    const num = BigInt(raw[idx]) * BigInt(PPM);
    const den = BigInt(totalRaw);
    const exact = divHalfEvenBig(num, den);
    const floorVal = num / den;
    const rem = num % den;
    return { key, idx, exact, floorVal, rem };
  });

  const base = entries.map((e) => Number(e.floorVal));
  let missing = PPM - (base[0] + base[1] + base[2] + base[3]);
  if (missing > 0) {
    const sorted = entries
      .filter((e) => e.rem > 0n)
      .sort((a, b) => {
        if (b.rem !== a.rem) return b.rem > a.rem ? 1 : -1;
        return a.idx - b.idx;
      });
    for (let i = 0; i < missing && i < sorted.length; i++) {
      base[sorted[i].idx] += 1;
    }
  } else if (missing < 0) {
    const sorted = entries
      .filter((e) => base[e.idx] > 0)
      .sort((a, b) => {
        if (a.rem !== b.rem) return a.rem > b.rem ? 1 : -1;
        return b.idx - a.idx;
      });
    for (let i = 0; i < -missing && i < sorted.length; i++) {
      base[sorted[i].idx] -= 1;
    }
  }

  return Object.freeze({
    plantPpm: base[0],
    preyPpm: base[1],
    carrionPpm: base[2],
    detritusPpm: base[3],
  });
}

/**
 * Validates `dietWeights`: all weights in [0, 1], already normalized to sum == 1 (within `1e-6`),
 * and consistent with `feedingType`.
 */
export function validateDietWeights(
  weights: TrophicDietWeights,
  feedingType: TrophicType,
  label = 'dietWeights'
): void {
  if (!isTrophicType(feedingType)) {
    throw new RangeError(`Invalid feedingType: ${String(feedingType)}`);
  }
  if (!weights || typeof weights !== 'object') {
    throw new RangeError(`${label} must be an object`);
  }
  assertClosedUnit(weights.plant, `${label}.plant`);
  assertClosedUnit(weights.prey, `${label}.prey`);
  assertClosedUnit(weights.carrion, `${label}.carrion`);
  assertClosedUnit(weights.detritus, `${label}.detritus`);

  const sum = weights.plant + weights.prey + weights.carrion + weights.detritus;
  if (!Number.isFinite(sum) || Math.abs(sum - 1) > DIET_SUM_TOLERANCE) {
    throw new RangeError(`${label} must be normalized to sum == 1, received sum: ${sum}`);
  }

  switch (feedingType) {
    case 'herbivore':
      if (weights.plant <= 0 || weights.prey > 0 || weights.carrion > 0 || weights.detritus > 0) {
        throw new RangeError(
          `${label} for herbivore must have plant > 0 and zero prey/carrion/detritus weights`
        );
      }
      break;
    case 'carnivore':
      if (weights.prey <= 0 || weights.plant > 0 || weights.detritus > 0) {
        throw new RangeError(
          `${label} for carnivore must have prey > 0 and zero plant/detritus weights`
        );
      }
      break;
    case 'omnivore': {
      const activePools = RESOURCE_COUNT_KEYS.reduce((acc, k) => acc + (weights[k] > 0 ? 1 : 0), 0);
      if (activePools < 2) {
        throw new RangeError(
          `${label} for omnivore must have at least 2 positive resource weights`
        );
      }
      break;
    }
    case 'scavenger':
      if (weights.carrion <= 0 || weights.plant > 0 || weights.prey > weights.carrion) {
        throw new RangeError(
          `${label} for scavenger must have carrion > 0, plant == 0, and carrion >= prey`
        );
      }
      break;
    case 'detritivore':
      if (weights.detritus <= 0 || weights.plant > 0 || weights.prey > 0) {
        throw new RangeError(
          `${label} for detritivore must have detritus > 0 and zero plant/prey weights`
        );
      }
      break;
  }
}

/**
 * Validates all 10 parameters, dietWeights, and optional feedingType contract on a `TrophicProfile`.
 */
export function validateTrophicProfile(
  profile: TrophicProfile,
  expectedFeedingType?: TrophicType,
  label = 'trophicProfile'
): void {
  if (!profile || typeof profile !== 'object') {
    throw new RangeError(`${label} must be an object`);
  }
  if (!isTrophicType(profile.feedingType)) {
    throw new RangeError(`${label}.feedingType invalid: ${String(profile.feedingType)}`);
  }
  if (expectedFeedingType !== undefined && profile.feedingType !== expectedFeedingType) {
    throw new RangeError(
      `${label}.feedingType (${profile.feedingType}) must match species diet (${expectedFeedingType})`
    );
  }

  validateDietWeights(profile.dietWeights, profile.feedingType, `${label}.dietWeights`);

  assertPositiveFinite(profile.adultStructuralMassMU, `${label}.adultStructuralMassMU`);
  const structQ = muToQ(profile.adultStructuralMassMU, 'half-even');
  if (structQ < 1) {
    throw new RangeError(
      `${label}.adultStructuralMassMU must quantize to >= 1 qMU (min ${1 / MU_QUANTA_PER_UNIT} MU)`
    );
  }

  assertPositiveFinite(profile.maxReserveToStructuralRatio, `${label}.maxReserveToStructuralRatio`);
  // Ensure reserve-to-structural ratio stays representable as finite scaled PPM integer
  numberToQuanta(profile.maxReserveToStructuralRatio, PPM, 'half-even');

  assertHalfOpenUnit(profile.absorptionEfficiency, `${label}.absorptionEfficiency`);
  assertHalfOpenUnit(profile.assimilationEfficiency, `${label}.assimilationEfficiency`);
  assertHalfOpenUnit(profile.growthEfficiency, `${label}.growthEfficiency`);
  assertClosedUnit(profile.structuralAllocationFraction, `${label}.structuralAllocationFraction`);

  // Verify unit-interval fractions quantize cleanly to PPM
  fractionToPpm(profile.absorptionEfficiency, 'half-even');
  fractionToPpm(profile.assimilationEfficiency, 'half-even');
  fractionToPpm(profile.growthEfficiency, 'half-even');
  fractionToPpm(profile.structuralAllocationFraction, 'half-even');

  if (profile.dietFlexibility !== undefined) {
    for (const k of RESOURCE_COUNT_KEYS) {
      const rule = profile.dietFlexibility[k];
      if (rule === undefined) continue;
      assertClosedUnit(rule.maxShare, `${label}.dietFlexibility.${k}.maxShare`);
      assertHalfOpenUnit(rule.extraDigestibility, `${label}.dietFlexibility.${k}.extraDigestibility`);
    }
  }

  assertNonNegativeFinite(profile.basalMetabolicFactor, `${label}.basalMetabolicFactor`);
  assertNonNegativeFinite(profile.thermoregulationFactor, `${label}.thermoregulationFactor`);
  assertNonNegativeFinite(profile.activityCostFactor, `${label}.activityCostFactor`);

  // Ensure metabolic factors can scale cleanly into EU quanta
  euToQ(profile.basalMetabolicFactor, 'half-even');
  euToQ(profile.thermoregulationFactor, 'half-even');
  euToQ(profile.activityCostFactor, 'half-even');

  assertHalfOpenUnit(profile.reproductiveEfficiency, `${label}.reproductiveEfficiency`);
  fractionToPpm(profile.reproductiveEfficiency, 'half-even');
}

function defaultDietWeightsFor(feedingType: TrophicType): TrophicDietWeights {
  switch (feedingType) {
    case 'herbivore':
      return Object.freeze({ plant: 1, prey: 0, carrion: 0, detritus: 0 });
    case 'carnivore':
      return Object.freeze({ plant: 0, prey: 0.9, carrion: 0.1, detritus: 0 });
    case 'omnivore':
      return Object.freeze({ plant: 0.5, prey: 0.4, carrion: 0.1, detritus: 0 });
    case 'scavenger':
      return Object.freeze({ plant: 0, prey: 0, carrion: 0.85, detritus: 0.15 });
    case 'detritivore':
      return Object.freeze({ plant: 0, prey: 0, carrion: 0.1, detritus: 0.9 });
  }
}

function defaultEfficienciesFor(feedingType: TrophicType): {
  absorption: number;
  assimilation: number;
  growth: number;
  structuralAllocation: number;
  maxReserveRatio: number;
  reproductive: number;
} {
  switch (feedingType) {
    case 'carnivore':
      return {
        absorption: 0.85,
        assimilation: 0.82,
        growth: 0.72,
        structuralAllocation: 0.25,
        maxReserveRatio: 1.5,
        reproductive: 0.78,
      };
    case 'herbivore':
      return {
        absorption: 0.58,
        assimilation: 0.78,
        growth: 0.68,
        structuralAllocation: 0.22,
        maxReserveRatio: 1.8,
        reproductive: 0.75,
      };
    case 'omnivore':
      return {
        absorption: 0.72,
        assimilation: 0.8,
        growth: 0.7,
        structuralAllocation: 0.24,
        maxReserveRatio: 1.65,
        reproductive: 0.76,
      };
    case 'scavenger':
      return {
        absorption: 0.78,
        assimilation: 0.8,
        growth: 0.66,
        structuralAllocation: 0.2,
        maxReserveRatio: 2.0,
        reproductive: 0.74,
      };
    case 'detritivore':
      return {
        absorption: 0.45,
        assimilation: 0.74,
        growth: 0.65,
        structuralAllocation: 0.2,
        maxReserveRatio: 1.4,
        reproductive: 0.72,
      };
  }
}

/**
 * Deterministic backward-compatibility adapter that builds a validated `TrophicProfile` for legacy
 * `SpeciesDefinition` objects (including `RAPTOR_SPECIES`) that omit an explicit `trophicProfile`.
 */
export function deriveDefaultTrophicProfile(species: LegacyTrophicSource): TrophicProfile {
  if (!isTrophicType(species.diet)) {
    throw new RangeError(`Species "${species.id}" has invalid diet: ${String(species.diet)}`);
  }
  const bodySize = Math.max(0.05, species.traitBaselines.bodySize ?? 1.0);
  const metEff = Math.max(0.25, species.traitBaselines.metabolismEfficiency ?? 1.0);
  const eff = defaultEfficienciesFor(species.diet);

  // Calibrate MU mass from bodySize baseline (bodySize=1.0 -> 10 MU structural adult mass)
  const adultStructuralMassMU = Number((bodySize * 10).toFixed(6));
  // Calibrate resting metabolic factor from legacy per-tick cost scaled to body mass^0.75
  const baseCost = Math.max(0.001, species.physiology.baseMetabolicCostPerTick);
  const basalMetabolicFactor = Number(((baseCost * 12) / metEff).toFixed(6));
  const thermoregulationFactor = Number((basalMetabolicFactor * 0.45).toFixed(6));
  const activityCostFactor = Number((basalMetabolicFactor * 0.3).toFixed(6));

  const profile: TrophicProfile = Object.freeze({
    feedingType: species.diet,
    dietWeights: defaultDietWeightsFor(species.diet),
    adultStructuralMassMU,
    maxReserveToStructuralRatio: eff.maxReserveRatio,
    absorptionEfficiency: eff.absorption,
    assimilationEfficiency: eff.assimilation,
    growthEfficiency: eff.growth,
    structuralAllocationFraction: eff.structuralAllocation,
    basalMetabolicFactor,
    thermoregulationFactor,
    activityCostFactor,
    reproductiveEfficiency: eff.reproductive,
  });

  validateTrophicProfile(profile, species.diet, `species "${species.id}" derived trophicProfile`);
  return profile;
}

/**
 * Resolves the authoritative `TrophicProfile` for any `SpeciesDefinition`: returns its explicit
 * `trophicProfile` (after validation) or falls back deterministically via `deriveDefaultTrophicProfile`.
 */
export function resolveSpeciesTrophicProfile(species: LegacyTrophicSource): TrophicProfile {
  if (species.trophicProfile !== undefined) {
    validateTrophicProfile(
      species.trophicProfile,
      species.diet,
      `species "${species.id}" trophicProfile`
    );
    return species.trophicProfile;
  }
  return deriveDefaultTrophicProfile(species);
}
