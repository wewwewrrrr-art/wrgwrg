import { SeededRng } from '../prng';
import { DiploidGenome } from './genome';
import { MutationConfig } from './mutation';
import { SpeciesDefinition } from './species';

export const ANATOMY_LOCUS_NAMES = [
  'bodyScale',
  'torsoRobustness',
  'headSize',
  'limbLength',
  'tailLength',
  'integumentThickness',
  'armorProtection',
  'aquaticAffinity',
  'climbingAffinity',
  'herbivoryApparatus',
  'carnivoryApparatus',
  'basalMetabolicRate',
] as const;

export type AnatomyLocusId = (typeof ANATOMY_LOCUS_NAMES)[number];

export const ANATOMY_LOCUS_COUNT = ANATOMY_LOCUS_NAMES.length; // 12

export const ANATOMY_IDX = {
  BODY_SCALE: 0,
  TORSO_ROBUSTNESS: 1,
  HEAD_SIZE: 2,
  LIMB_LENGTH: 3,
  TAIL_LENGTH: 4,
  INTEGUMENT_THICKNESS: 5,
  ARMOR_PROTECTION: 6,
  AQUATIC_AFFINITY: 7,
  CLIMBING_AFFINITY: 8,
  HERBIVORY_APPARATUS: 9,
  CARNIVORY_APPARATUS: 10,
  BASAL_METABOLIC_RATE: 11,
} as const;

export interface AnatomyRange {
  readonly min: number;
  readonly max: number;
}

export const ANATOMY_RANGES: readonly AnatomyRange[] = [
  { min: 0.55, max: 1.75 }, // bodyScale
  { min: 0.60, max: 1.55 }, // torsoRobustness
  { min: 0.65, max: 1.50 }, // headSize
  { min: 0.50, max: 1.60 }, // limbLength
  { min: 0.25, max: 1.50 }, // tailLength
  { min: 0.25, max: 1.75 }, // integumentThickness
  { min: 0.00, max: 1.00 }, // armorProtection
  { min: 0.00, max: 1.00 }, // aquaticAffinity
  { min: 0.00, max: 1.00 }, // climbingAffinity
  { min: 0.00, max: 1.00 }, // herbivoryApparatus
  { min: 0.00, max: 1.00 }, // carnivoryApparatus
  { min: 0.65, max: 1.50 }, // basalMetabolicRate
];

export type LocomotionMode = 'terrestrial' | 'amphibious' | 'aquatic';

export interface OrganismAnatomyState {
  readonly maternal: Float32Array;
  readonly paternal: Float32Array;
  readonly dominance: Float32Array;
  readonly expressed: Float32Array;
  locomotionMode: LocomotionMode;
  viability: number;
  /**
   * Derived-value cache of `getRelativeAnatomyPhysiology` (pure function of the immutable genome
   * and the species baseline it was computed against). Never part of the simulation state.
   */
  physiology?: AnatomyPhysiology;
  physiologySpecies?: SpeciesDefinition;
}

export interface AnatomyPerformance {
  coldOffsetC: number;
  heatOffsetC: number;
  speedScale: number;
  aquaticSpeedScale: number;
  climbingScale: number;
  defenseScale: number;
  attackScale: number;
  plantExtractScale: number;
  preyExtractScale: number;
  metabolicScale: number;
  viability: number;
}

export function createAnatomyPerformance(): AnatomyPerformance {
  return {
    coldOffsetC: 0,
    heatOffsetC: 0,
    speedScale: 1,
    aquaticSpeedScale: 1,
    climbingScale: 1,
    defenseScale: 1,
    attackScale: 1,
    plantExtractScale: 1,
    preyExtractScale: 1,
    metabolicScale: 1,
    viability: 1,
  };
}

const speciesAnatomyBaselineCache = new WeakMap<SpeciesDefinition, Float32Array>();

function clampRange(val: number, idx: number): number {
  const r = ANATOMY_RANGES[idx];
  return val < r.min ? r.min : val > r.max ? r.max : val;
}

function deterministicUnitHash(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

export function deriveSpeciesAnatomyBaseline(species: SpeciesDefinition): Float32Array {
  const cached = speciesAnatomyBaselineCache.get(species);
  if (cached) return cached;

  const base = new Float32Array(ANATOMY_LOCUS_COUNT);
  const tb = species.traitBaselines;
  const sp = species.spatial;
  const locomotion = sp?.locomotion ?? 'terrestrial';

  const bodySize = tb.bodySize ?? 1.0;
  const speed = tb.speed ?? 1.0;
  const strength = tb.strength ?? 1.0;
  const coldTol = tb.coldTolerance ?? 1.0;
  const heatTol = tb.heatTolerance ?? 1.0;
  const metEff = tb.metabolismEfficiency ?? 1.0;

  base[ANATOMY_IDX.BODY_SCALE] = clampRange(bodySize, ANATOMY_IDX.BODY_SCALE);
  base[ANATOMY_IDX.TORSO_ROBUSTNESS] = clampRange(0.88 + 0.12 * strength, ANATOMY_IDX.TORSO_ROBUSTNESS);
  base[ANATOMY_IDX.HEAD_SIZE] = clampRange(
    species.diet === 'carnivore' || species.diet === 'scavenger' ? 1.08 : 0.94,
    ANATOMY_IDX.HEAD_SIZE
  );
  base[ANATOMY_IDX.LIMB_LENGTH] = clampRange(0.84 + 0.16 * speed, ANATOMY_IDX.LIMB_LENGTH);
  base[ANATOMY_IDX.TAIL_LENGTH] = clampRange(
    locomotion === 'aquatic' ? 1.22 : locomotion === 'amphibious' ? 1.08 : 0.96,
    ANATOMY_IDX.TAIL_LENGTH
  );

  // Insulation reflects cold/heat balance & optimal temperature
  const tempDiff = (20 - species.physiology.optimalTemperatureC) / 35;
  const rawIntegument = 0.95 + 0.22 * (coldTol - heatTol) + tempDiff * 0.35;
  base[ANATOMY_IDX.INTEGUMENT_THICKNESS] = clampRange(rawIntegument, ANATOMY_IDX.INTEGUMENT_THICKNESS);

  base[ANATOMY_IDX.ARMOR_PROTECTION] = clampRange(
    species.diet === 'detritivore' ? 0.28 : species.diet === 'herbivore' ? 0.18 : 0.12,
    ANATOMY_IDX.ARMOR_PROTECTION
  );

  base[ANATOMY_IDX.AQUATIC_AFFINITY] = clampRange(
    locomotion === 'aquatic' ? 0.88 : locomotion === 'amphibious' ? 0.48 : 0.06,
    ANATOMY_IDX.AQUATIC_AFFINITY
  );

  const hillCost = sp?.terrainCost?.hills ?? 1.4;
  const mtnCost = sp?.terrainCost?.mountain ?? 2.2;
  const climbBase = hillCost <= 1.2 || mtnCost <= 1.8 ? 0.45 : 0.16;
  base[ANATOMY_IDX.CLIMBING_AFFINITY] = clampRange(climbBase, ANATOMY_IDX.CLIMBING_AFFINITY);

  if (species.diet === 'herbivore') {
    base[ANATOMY_IDX.HERBIVORY_APPARATUS] = 0.82;
    base[ANATOMY_IDX.CARNIVORY_APPARATUS] = 0.12;
  } else if (species.diet === 'carnivore') {
    base[ANATOMY_IDX.HERBIVORY_APPARATUS] = 0.12;
    base[ANATOMY_IDX.CARNIVORY_APPARATUS] = 0.84;
  } else if (species.diet === 'scavenger') {
    base[ANATOMY_IDX.HERBIVORY_APPARATUS] = 0.20;
    base[ANATOMY_IDX.CARNIVORY_APPARATUS] = 0.72;
  } else if (species.diet === 'detritivore') {
    base[ANATOMY_IDX.HERBIVORY_APPARATUS] = 0.62;
    base[ANATOMY_IDX.CARNIVORY_APPARATUS] = 0.26;
  } else {
    base[ANATOMY_IDX.HERBIVORY_APPARATUS] = 0.52;
    base[ANATOMY_IDX.CARNIVORY_APPARATUS] = 0.52;
  }

  base[ANATOMY_IDX.BASAL_METABOLIC_RATE] = clampRange(
    1.15 - 0.15 * metEff,
    ANATOMY_IDX.BASAL_METABOLIC_RATE
  );

  speciesAnatomyBaselineCache.set(species, base);
  return base;
}

const speciesBaselineStateCache = new WeakMap<SpeciesDefinition, OrganismAnatomyState>();

/**
 * Anatomy of an idealized individual sitting exactly on the species baseline (both allele copies
 * at the baseline value, additive expression). Species parameters (thermal optimum, trophic and
 * spatial profiles) are calibrated for this anatomy, so anatomical effects on performance are
 * applied relative to it: an average member is unaffected and selection acts on heritable
 * deviations from the species norm.
 */
export function getSpeciesBaselineAnatomy(species: SpeciesDefinition): OrganismAnatomyState {
  const cached = speciesBaselineStateCache.get(species);
  if (cached) return cached;
  const base = deriveSpeciesAnatomyBaseline(species);
  const maternal = new Float32Array(base);
  const paternal = new Float32Array(base);
  const dominance = new Float32Array(ANATOMY_LOCUS_COUNT).fill(0.5);
  const { expressed, locomotionMode, viability } = expressAnatomy(maternal, paternal, dominance);
  const state: OrganismAnatomyState = Object.freeze({ maternal, paternal, dominance, expressed, locomotionMode, viability });
  speciesBaselineStateCache.set(species, state);
  return state;
}

export function classifyLocomotionMode(aquaticAffinity: number): LocomotionMode {
  if (aquaticAffinity >= 0.68) return 'aquatic';
  if (aquaticAffinity >= 0.30) return 'amphibious';
  return 'terrestrial';
}

/**
 * Enforces structural & developmental morphospace coherence across anatomy traits.
 * Ensures gradual viable intermediates only: conflicting anatomical extremes are reconciled
 * smoothly along trade-off frontiers and scored via morphological viability in [0.45, 1.0].
 */
export function enforceMorphospaceConstraints(expressed: Float32Array): {
  locomotionMode: LocomotionMode;
  viability: number;
} {
  for (let i = 0; i < ANATOMY_LOCUS_COUNT; i++) {
    expressed[i] = clampRange(expressed[i], i);
  }

  // 1. Digestive & cranial specialization trade-off budget (no instant dual-apex chimeras)
  const herb = expressed[ANATOMY_IDX.HERBIVORY_APPARATUS];
  const carn = expressed[ANATOMY_IDX.CARNIVORY_APPARATUS];
  const trophicSum = herb + carn;
  if (trophicSum > 1.26) {
    const excess = trophicSum - 1.26;
    const hShare = herb / trophicSum;
    const cShare = carn / trophicSum;
    expressed[ANATOMY_IDX.HERBIVORY_APPARATUS] = clampRange(herb - excess * hShare, ANATOMY_IDX.HERBIVORY_APPARATUS);
    expressed[ANATOMY_IDX.CARNIVORY_APPARATUS] = clampRange(carn - excess * cShare, ANATOMY_IDX.CARNIVORY_APPARATUS);
  }

  // 2. Aquatic streamlining vs cursorial leg length trade-off
  const aq = expressed[ANATOMY_IDX.AQUATIC_AFFINITY];
  const maxCursorialLimb = 1.60 - 0.52 * Math.max(0, aq - 0.25);
  if (expressed[ANATOMY_IDX.LIMB_LENGTH] > maxCursorialLimb) {
    expressed[ANATOMY_IDX.LIMB_LENGTH] = clampRange(maxCursorialLimb, ANATOMY_IDX.LIMB_LENGTH);
  }

  // 3. Heavy dermal armor vs extreme elongated cursorial limbs trade-off
  const armor = expressed[ANATOMY_IDX.ARMOR_PROTECTION];
  const maxArmoredLimb = 1.56 - 0.42 * armor;
  if (expressed[ANATOMY_IDX.LIMB_LENGTH] > maxArmoredLimb) {
    expressed[ANATOMY_IDX.LIMB_LENGTH] = clampRange(maxArmoredLimb, ANATOMY_IDX.LIMB_LENGTH);
  }

  // 4. Developmental coherence / structural viability check
  const torso = expressed[ANATOMY_IDX.TORSO_ROBUSTNESS];
  const head = expressed[ANATOMY_IDX.HEAD_SIZE];
  const tail = expressed[ANATOMY_IDX.TAIL_LENGTH];
  const limb = expressed[ANATOMY_IDX.LIMB_LENGTH];

  let penalty = 0;
  // Disproportionate cranial load on tiny slender torso
  if (head > torso * 1.45) {
    penalty += (head - torso * 1.45) * 0.45;
  }
  // Aquatic swimmer lacking propulsive tail rudder
  if (aq > 0.65 && tail < 0.60) {
    penalty += (0.60 - tail) * (aq - 0.5) * 0.55;
  }
  // Ultra-heavy armor on frail slender torso
  if (armor > 0.65 && torso < 0.80) {
    penalty += (armor - 0.65) * (0.80 - torso) * 0.8;
  }
  // Terrestrial cursorial speedster with tiny vestigial limbs in non-aquatic form
  if (aq < 0.20 && limb < 0.58 && torso > 1.35) {
    penalty += (0.58 - limb) * 0.35;
  }

  const viability = Math.max(0.45, Math.min(1.0, 1.0 - penalty));
  return {
    locomotionMode: classifyLocomotionMode(aq),
    viability,
  };
}

export function expressAnatomy(
  maternal: Float32Array,
  paternal: Float32Array,
  dominance: Float32Array,
  outExpressed?: Float32Array
): { expressed: Float32Array; locomotionMode: LocomotionMode; viability: number } {
  const expressed = outExpressed ?? new Float32Array(ANATOMY_LOCUS_COUNT);
  for (let i = 0; i < ANATOMY_LOCUS_COUNT; i++) {
    const a = maternal[i];
    const b = paternal[i];
    const lo = a <= b ? a : b;
    const hi = a <= b ? b : a;
    expressed[i] = Math.fround(lo + (hi - lo) * dominance[i]);
  }
  const { locomotionMode, viability } = enforceMorphospaceConstraints(expressed);
  return { expressed, locomotionMode, viability };
}

/**
 * Deterministically initializes founder anatomy from species baseline, individual ID, and core
 * genome without perturbing core RNG streams (preserving pre-existing RNG stream parity tests).
 */
export function createFounderAnatomy(
  species: SpeciesDefinition,
  orgId: number,
  coreGenome: DiploidGenome
): OrganismAnatomyState {
  const baseline = deriveSpeciesAnatomyBaseline(species);
  const spread = Math.min(0.18, Math.max(0.03, species.initialGeneticSpread));
  const maternal = new Float32Array(ANATOMY_LOCUS_COUNT);
  const paternal = new Float32Array(ANATOMY_LOCUS_COUNT);
  const dominance = new Float32Array(ANATOMY_LOCUS_COUNT);

  const coreSig = Math.round((coreGenome.maternalAlleles[0] + coreGenome.paternalAlleles[0]) * 1000);
  const coreCold = coreGenome.maternalAlleles[7] ?? 1.0;
  const coreHeat = coreGenome.maternalAlleles[6] ?? 1.0;

  for (let i = 0; i < ANATOMY_LOCUS_COUNT; i++) {
    const r = ANATOMY_RANGES[i];
    const span = r.max - r.min;
    const hMat = deterministicUnitHash(orgId, i * 2 + 1, coreSig) - 0.5;
    const hPat = deterministicUnitHash(orgId, i * 2 + 2, coreSig) - 0.5;
    const hDom = deterministicUnitHash(orgId, i + 97, coreSig);

    let center = baseline[i];
    if (i === ANATOMY_IDX.BODY_SCALE) {
      center = (coreGenome.maternalAlleles[0] + coreGenome.paternalAlleles[0]) * 0.5;
    } else if (i === ANATOMY_IDX.INTEGUMENT_THICKNESS) {
      center = baseline[i] + 0.14 * (coreCold - coreHeat);
    }

    maternal[i] = clampRange(center + hMat * spread * span * 0.45, i);
    paternal[i] = clampRange(center + hPat * spread * span * 0.45, i);
    dominance[i] = 0.25 + 0.5 * hDom;
  }

  const { expressed, locomotionMode, viability } = expressAnatomy(maternal, paternal, dominance);
  return {
    maternal,
    paternal,
    dominance,
    expressed,
    locomotionMode,
    viability,
  };
}

export function cloneAnatomyState(src: OrganismAnatomyState): OrganismAnatomyState {
  const maternal = new Float32Array(src.maternal);
  const paternal = new Float32Array(src.paternal);
  const dominance = new Float32Array(src.dominance);
  const expressed = new Float32Array(src.expressed);
  return {
    maternal,
    paternal,
    dominance,
    expressed,
    locomotionMode: src.locomotionMode,
    viability: src.viability,
  };
}

/**
 * Ensures an organism has an initialized anatomy state (for manually constructed test organisms).
 */
export function ensureOrganismAnatomy(
  org: { id: number; genome: DiploidGenome; anatomy?: OrganismAnatomyState },
  species: SpeciesDefinition
): OrganismAnatomyState {
  if (!org.anatomy) {
    org.anatomy = createFounderAnatomy(species, org.id, org.genome);
  }
  return org.anatomy;
}

/** Largest heritable change one mutation may cause per anatomy locus (developmental constraint). */
function anatomyMaxMutationStep(locus: number): number {
  return locus >= ANATOMY_IDX.ARMOR_PROTECTION && locus <= ANATOMY_IDX.CARNIVORY_APPARATUS ? 0.045 : 0.065;
}

/**
 * Mendelian inheritance of the diploid anatomy genome with point mutations.
 *
 * Each parent contributes one randomly chosen allele copy per locus (independent assortment,
 * as for the core genome). Mutations follow the species' `MutationConfig` contract exactly as
 * core loci do: probability `baseRate` (times an optional per-locus `rateMultiplier`) per allele
 * copy, normal step with standard deviation `stepScale` (times `scaleMultiplier`) of the locus
 * range and mean `directionalBias` standard deviations (default 0: no direction). A single step
 * is additionally capped by a developmental limit so no mutation can jump between anatomical
 * types; results stay inside the locus range. The parents' states are only read.
 */
export function inheritOrganismAnatomy(
  motherAnatomy: OrganismAnatomyState,
  fatherAnatomy: OrganismAnatomyState,
  mutCfg: MutationConfig,
  rng: SeededRng
): { anatomy: OrganismAnatomyState; anatomyMutations: number } {
  const maternal = new Float32Array(ANATOMY_LOCUS_COUNT);
  const paternal = new Float32Array(ANATOMY_LOCUS_COUNT);
  const dominance = new Float32Array(ANATOMY_LOCUS_COUNT);

  const bias = mutCfg.directionalBias ?? 0;
  let mutCount = 0;

  for (let i = 0; i < ANATOMY_LOCUS_COUNT; i++) {
    const r = ANATOMY_RANGES[i];
    const span = r.max - r.min;
    const override = mutCfg.locusOverrides?.[ANATOMY_LOCUS_NAMES[i]];
    const rawRate = mutCfg.baseRate * (override?.rateMultiplier ?? 1);
    const rate = rawRate < 0 ? 0 : rawRate > 1 ? 1 : rawRate;
    const sigma = mutCfg.stepScale * (override?.scaleMultiplier ?? 1) * span;
    const maxStep = anatomyMaxMutationStep(i);

    let matA = rng.chance(0.5) ? motherAnatomy.maternal[i] : motherAnatomy.paternal[i];
    let patA = rng.chance(0.5) ? fatherAnatomy.maternal[i] : fatherAnatomy.paternal[i];

    if (rate > 0 && rng.chance(rate)) {
      const u = sigma > 0 ? rng.gaussian(bias * sigma, sigma) : 0;
      matA = clampRange(matA + (u < -maxStep ? -maxStep : u > maxStep ? maxStep : u), i);
      mutCount++;
    }
    if (rate > 0 && rng.chance(rate)) {
      const u = sigma > 0 ? rng.gaussian(bias * sigma, sigma) : 0;
      patA = clampRange(patA + (u < -maxStep ? -maxStep : u > maxStep ? maxStep : u), i);
      mutCount++;
    }

    maternal[i] = matA;
    paternal[i] = patA;

    const dM = motherAnatomy.dominance[i];
    const dP = fatherAnatomy.dominance[i];
    let d = dM === dP ? dM : rng.chance(0.5) ? dM : dP;
    if (rate > 0 && rng.chance(rate * 0.25)) {
      const dd = (rng.nextFloat() - 0.5) * 0.1;
      d = Math.max(0, Math.min(1, d + dd));
    }
    dominance[i] = d;
  }

  const { expressed, locomotionMode, viability } = expressAnatomy(maternal, paternal, dominance);
  return {
    anatomy: {
      maternal,
      paternal,
      dominance,
      expressed,
      locomotionMode,
      viability,
    },
    anatomyMutations: mutCount,
  };
}

/**
 * Computes physiological, biomechanical, and ecological performance multipliers in-place.
 */
export function computeAnatomyPerformanceInto(
  anatomy: OrganismAnatomyState,
  out: AnatomyPerformance
): AnatomyPerformance {
  const ex = anatomy.expressed;
  const body = ex[ANATOMY_IDX.BODY_SCALE];
  const torso = ex[ANATOMY_IDX.TORSO_ROBUSTNESS];
  const head = ex[ANATOMY_IDX.HEAD_SIZE];
  const limb = ex[ANATOMY_IDX.LIMB_LENGTH];
  const tail = ex[ANATOMY_IDX.TAIL_LENGTH];
  const integ = ex[ANATOMY_IDX.INTEGUMENT_THICKNESS];
  const armor = ex[ANATOMY_IDX.ARMOR_PROTECTION];
  const aquatic = ex[ANATOMY_IDX.AQUATIC_AFFINITY];
  const climb = ex[ANATOMY_IDX.CLIMBING_AFFINITY];
  const herb = ex[ANATOMY_IDX.HERBIVORY_APPARATUS];
  const carn = ex[ANATOMY_IDX.CARNIVORY_APPARATUS];
  const bmr = ex[ANATOMY_IDX.BASAL_METABOLIC_RATE];

  // Thermoregulation trade-off: insulation + stocky torso + BMR raise cold tolerance, but thick
  // insulation impairs heat dissipation in hot biomes.
  out.coldOffsetC = (integ - 1.0) * 6.0 + (torso - 1.0) * 3.0 + (bmr - 1.0) * 2.0;
  out.heatOffsetC = -(integ - 1.0) * 4.8 - Math.max(0, torso - 1.0) * 2.0;

  // Terrestrial speed: long limbs help, heavy armor & aquatic flipper trade-off slow land speed
  const landAquaticDrag = 1.0 - 0.28 * Math.max(0, aquatic - 0.25);
  out.speedScale =
    (0.76 + 0.22 * limb + 0.05 * (tail - 1.0)) *
    (1.0 - 0.18 * armor) *
    (1.0 - 0.06 * Math.max(0, torso - 1.0)) *
    landAquaticDrag;

  // Aquatic speed boost from aquatic specialization + tail propulsion
  out.aquaticSpeedScale = 0.55 + 0.70 * aquatic + 0.15 * (tail - 0.5);

  // Slope/mountain agility
  out.climbingScale = 0.80 + 0.45 * climb - 0.14 * armor;

  // Defense against predation capture & structural bite damage
  out.defenseScale = 1.0 + 0.72 * armor + 0.16 * torso + 0.10 * body;

  // Predation attack capability
  out.attackScale = 0.74 + 0.16 * head + 0.18 * carn + 0.06 * limb;

  // Trophic digestive efficiency
  out.plantExtractScale = 0.78 + 0.34 * herb;
  out.preyExtractScale = 0.78 + 0.34 * carn;

  // Metabolic cost multiplier (upkeep of armor, brain/head, limbs, BMR, and low viability overhead)
  const viabilityPenalty = 1.0 + Math.max(0, 1.0 - anatomy.viability) * 0.45;
  out.metabolicScale =
    bmr *
    (0.84 + 0.14 * armor + 0.07 * head + 0.06 * limb + 0.04 * Math.max(0, integ - 1.0)) *
    viabilityPenalty;

  out.viability = anatomy.viability;
  return out;
}

/**
 * Performance of `anatomy` relative to the species baseline anatomy (see
 * `getSpeciesBaselineAnatomy`): thermal offsets are differences, every scale is a ratio, so the
 * baseline individual gets offsets 0 and scales 1.
 */
export function computeRelativeAnatomyPerformanceInto(
  anatomy: OrganismAnatomyState,
  baseline: AnatomyPerformance,
  out: AnatomyPerformance
): AnatomyPerformance {
  computeAnatomyPerformanceInto(anatomy, out);
  out.coldOffsetC -= baseline.coldOffsetC;
  out.heatOffsetC -= baseline.heatOffsetC;
  out.speedScale /= baseline.speedScale;
  out.aquaticSpeedScale /= baseline.aquaticSpeedScale;
  out.climbingScale /= baseline.climbingScale;
  out.defenseScale /= baseline.defenseScale;
  out.attackScale /= baseline.attackScale;
  out.plantExtractScale /= baseline.plantExtractScale;
  out.preyExtractScale /= baseline.preyExtractScale;
  out.metabolicScale /= baseline.metabolicScale;
  return out;
}

/**
 * Normalized heritable genetic + anatomical distance in [0, 1] between two anatomy states.
 */
export function computeAnatomyDistance(a: OrganismAnatomyState, b: OrganismAnatomyState): number {
  let sumSq = 0;
  for (let i = 0; i < ANATOMY_LOCUS_COUNT; i++) {
    const r = ANATOMY_RANGES[i];
    const span = r.max - r.min;
    const meanA = (a.maternal[i] + a.paternal[i]) * 0.5;
    const meanB = (b.maternal[i] + b.paternal[i]) * 0.5;
    const d = (meanA - meanB) / span;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / ANATOMY_LOCUS_COUNT);
}

export function describeAnatomy(anatomy: OrganismAnatomyState): Readonly<Record<AnatomyLocusId, number>> & {
  readonly locomotionMode: LocomotionMode;
  readonly viability: number;
} {
  return {
    bodyScale: anatomy.expressed[0],
    torsoRobustness: anatomy.expressed[1],
    headSize: anatomy.expressed[2],
    limbLength: anatomy.expressed[3],
    tailLength: anatomy.expressed[4],
    integumentThickness: anatomy.expressed[5],
    armorProtection: anatomy.expressed[6],
    aquaticAffinity: anatomy.expressed[7],
    climbingAffinity: anatomy.expressed[8],
    herbivoryApparatus: anatomy.expressed[9],
    carnivoryApparatus: anatomy.expressed[10],
    basalMetabolicRate: anatomy.expressed[11],
    locomotionMode: anatomy.locomotionMode,
    viability: anatomy.viability,
  };
}

/**
 * Physiological consequences of the anatomy genome in the evolutionary physiology model
 * (evolution mode with `enablePhysiologicalTradeOffs`). Each link follows a causal relationship of
 * vertebrate physiology rather than a balancing penalty:
 *
 * - `maintenanceScale`: resting upkeep of tissue - basal metabolic rate times the upkeep of armour,
 *   head, limbs and insulation and the overhead of developmental mismatch. It scales the BASAL
 *   (Kleiber) term only: the cost of activity and locomotion is mechanical and does not shrink
 *   with a low resting metabolism.
 * - `coldOffsetC` / `heatOffsetC`: insulation, a stocky torso and metabolic heat production widen
 *   the tolerated range towards the cold; the same heat production and insulation are a heat load
 *   (low BMR is the classic adaptation of desert endotherms, high BMR of cold-climate ones).
 * - `intakeCapacityScale`: the maximal rate of food processing follows the mass of the metabolically
 *   active organs (gut, liver) that also set BMR (assimilation-capacity / central-limitation
 *   models); taken as sqrt(BMR).
 * - `growthScale`: somatic growth is fuelled by metabolism (ontogenetic growth model), ~BMR.
 * - `recoveryScale`: tissue repair and clearance of fatigue are aerobic processes, ~sqrt(BMR).
 *
 * Values are relative to the species baseline anatomy (`getRelativeAnatomyPhysiology`), so the
 * baseline individual has scales 1 and offsets 0 and the species calibration is unchanged.
 */
export interface AnatomyPhysiology {
  maintenanceScale: number;
  coldOffsetC: number;
  heatOffsetC: number;
  intakeCapacityScale: number;
  growthScale: number;
  recoveryScale: number;
}

/**
 * Metabolic heat production shifts the tolerated range by the same amount per unit as insulation
 * does: in the Scholander-Irving heat balance (lower critical temperature = Tb - BMR x insulation)
 * resting heat production and insulation enter symmetrically, and the same heat is a load in the
 * heat. degC per unit of BMR above the baseline.
 */
export const BMR_COLD_OFFSET_C = 6.0;
export const BMR_HEAT_OFFSET_C = 4.8;

export function createAnatomyPhysiology(): AnatomyPhysiology {
  return { maintenanceScale: 1, coldOffsetC: 0, heatOffsetC: 0, intakeCapacityScale: 1, growthScale: 1, recoveryScale: 1 };
}

/** Absolute (not baseline-relative) physiology of an anatomy, see `AnatomyPhysiology`. */
export function computeAnatomyPhysiologyInto(anatomy: OrganismAnatomyState, out: AnatomyPhysiology): AnatomyPhysiology {
  const ex = anatomy.expressed;
  const torso = ex[ANATOMY_IDX.TORSO_ROBUSTNESS];
  const head = ex[ANATOMY_IDX.HEAD_SIZE];
  const limb = ex[ANATOMY_IDX.LIMB_LENGTH];
  const integ = ex[ANATOMY_IDX.INTEGUMENT_THICKNESS];
  const armor = ex[ANATOMY_IDX.ARMOR_PROTECTION];
  const bmr = ex[ANATOMY_IDX.BASAL_METABOLIC_RATE];
  out.coldOffsetC = (integ - 1.0) * 6.0 + (torso - 1.0) * 3.0 + (bmr - 1.0) * BMR_COLD_OFFSET_C;
  out.heatOffsetC = -(integ - 1.0) * 4.8 - Math.max(0, torso - 1.0) * 2.0 - (bmr - 1.0) * BMR_HEAT_OFFSET_C;
  const viabilityPenalty = 1.0 + Math.max(0, 1.0 - anatomy.viability) * 0.45;
  out.maintenanceScale =
    bmr * (0.84 + 0.14 * armor + 0.07 * head + 0.06 * limb + 0.04 * Math.max(0, integ - 1.0)) * viabilityPenalty;
  out.intakeCapacityScale = Math.sqrt(bmr);
  out.growthScale = bmr;
  out.recoveryScale = Math.sqrt(bmr);
  return out;
}

const speciesBaselinePhysiologyCache = new WeakMap<Float32Array, AnatomyPhysiology>();

/**
 * Physiology of `anatomy` relative to the baseline anatomy of `species` (offsets are differences,
 * scales are ratios). Cached on the anatomy state: the result is a pure function of the immutable
 * genome and the species baseline, so the cache never changes what the simulation computes.
 */
export function getRelativeAnatomyPhysiology(anatomy: OrganismAnatomyState, species: SpeciesDefinition): AnatomyPhysiology {
  if (anatomy.physiology !== undefined && anatomy.physiologySpecies === species) return anatomy.physiology;
  const baseState = getSpeciesBaselineAnatomy(species);
  const baseKey = baseState.expressed;
  let base = speciesBaselinePhysiologyCache.get(baseKey);
  if (base === undefined) {
    base = Object.freeze(computeAnatomyPhysiologyInto(baseState, createAnatomyPhysiology()));
    speciesBaselinePhysiologyCache.set(baseKey, base);
  }
  const out = computeAnatomyPhysiologyInto(anatomy, createAnatomyPhysiology());
  out.coldOffsetC -= base.coldOffsetC;
  out.heatOffsetC -= base.heatOffsetC;
  out.maintenanceScale /= base.maintenanceScale;
  out.intakeCapacityScale /= base.intakeCapacityScale;
  out.growthScale /= base.growthScale;
  out.recoveryScale /= base.recoveryScale;
  if (!Object.isFrozen(anatomy)) {
    anatomy.physiology = out;
    anatomy.physiologySpecies = species;
  }
  return out;
}
