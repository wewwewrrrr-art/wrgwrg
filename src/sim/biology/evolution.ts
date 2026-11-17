import {
  ANATOMY_IDX,
  ANATOMY_LOCUS_COUNT,
  ANATOMY_RANGES,
  OrganismAnatomyState,
  deriveSpeciesAnatomyBaseline,
  ensureOrganismAnatomy,
} from './anatomy';
import { GenomeSchema } from './genome';
import { Organism } from './organism';
import { PhylogenyTracker } from './phylogeny';
import { SpeciesDefinition } from './species';

export interface OrganismAncestry {
  readonly primarySpeciesId: string;
  readonly secondarySpeciesId: string | null;
  readonly admixtureRatio: number; // 0 = unmixed, 0.5 = F1 hybrid, 0.25 = BC1, etc.
  readonly hybridFertility: number; // [0, 1]
}

export interface ReproductiveCompatibilityResult {
  readonly compatible: boolean;
  readonly geneticDistance: number;
  readonly ecologicalDistance: number;
  readonly preZygoticCompatibility: number;
  readonly postZygoticViability: number;
  readonly offspringHybridFertility: number;
  readonly parentFertilityMultiplier: number;
  readonly isInterspecific: boolean;
  readonly isBackcross: boolean;
  readonly offspringPrimarySpeciesId: string;
  readonly offspringSecondarySpeciesId: string | null;
  readonly offspringAdmixtureRatio: number;
}

export interface PopulationGeneticSummary {
  readonly count: number;
  readonly meanCoreAlleles: Float64Array;
  readonly coreAlleleVariance: Float64Array;
  readonly meanAnatomyAlleles: Float64Array;
  readonly anatomyAlleleVariance: Float64Array;
  readonly heterozygosity: number;
  readonly meanDiversity: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Checks whether two species belong to the same compatible evolutionary clade or share
 * closely related pre-registered founder biology (same schema, compatible diet & baseline).
 */
export function areSpeciesCladeCompatible(
  spA: SpeciesDefinition,
  spB: SpeciesDefinition,
  phylogeny?: PhylogenyTracker
): boolean {
  if (spA.id === spB.id) return true;
  if (spA.genomeSchema.id !== spB.genomeSchema.id) return false;

  if (phylogeny) {
    const hop = phylogeny.getCladeHopDistance(spA.id, spB.id);
    if (Number.isFinite(hop)) {
      return hop <= 6;
    }
  }

  // Compatible pre-registered sister species must share compatible trophic guilds & thermal regime
  const sameOrCompatibleDiet =
    spA.diet === spB.diet ||
    (spA.diet === 'omnivore' && spB.diet === 'herbivore') ||
    (spB.diet === 'omnivore' && spA.diet === 'herbivore');
  if (!sameOrCompatibleDiet) return false;

  if (Math.abs(spA.physiology.optimalTemperatureC - spB.physiology.optimalTemperatureC) > 10) {
    return false;
  }

  // Baseline genetic divergence must stay within interbreeding threshold (< 0.36)
  let sumSq = 0;
  let loci = 0;
  for (const def of spA.genomeSchema.loci) {
    const r = spA.traitRanges[def.id] ?? def.defaultRange;
    const span = Math.max(1e-6, r.max - r.min);
    const aVal = spA.traitBaselines[def.id] ?? 1.0;
    const bVal = spB.traitBaselines[def.id] ?? 1.0;
    const d = (aVal - bVal) / span;
    sumSq += d * d;
    loci++;
  }
  const baseA = deriveSpeciesAnatomyBaseline(spA);
  const baseB = deriveSpeciesAnatomyBaseline(spB);
  for (let i = 0; i < ANATOMY_LOCUS_COUNT; i++) {
    const r = ANATOMY_RANGES[i];
    const d = (baseA[i] - baseB[i]) / (r.max - r.min);
    sumSq += d * d;
    loci++;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, loci));
  return rms <= 0.36;
}

/**
 * Computes normalized heritable genetic distance across both core loci and anatomy loci.
 */
export function computeIndividualGeneticDistance(
  orgA: Organism,
  spA: SpeciesDefinition,
  orgB: Organism,
  spB: SpeciesDefinition
): number {
  const schema = spA.genomeSchema;
  const matA = orgA.genome.maternalAlleles;
  const patA = orgA.genome.paternalAlleles;
  const matB = orgB.genome.maternalAlleles;
  const patB = orgB.genome.paternalAlleles;

  const sharedLoci = Math.min(matA.length, matB.length, schema.locusCount);
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < sharedLoci; i++) {
    const def = schema.loci[i];
    const r = spA.traitRanges[def.id] ?? def.defaultRange;
    const span = Math.max(1e-6, r.max - r.min);
    const meanA = (matA[i] + patA[i]) * 0.5;
    const meanB = (matB[i] + patB[i]) * 0.5;
    const diff = (meanA - meanB) / span;
    sumSq += diff * diff;
    count++;
  }

  const anatA = orgA.anatomy?.expressed;
  const anatB = orgB.anatomy?.expressed;
  if (anatA && anatB) {
    for (let i = 0; i < ANATOMY_LOCUS_COUNT; i++) {
      const r = ANATOMY_RANGES[i];
      const diff = (anatA[i] - anatB[i]) / (r.max - r.min);
      sumSq += diff * diff;
      count++;
    }
  }

  // Baseline divergence offset when two distinct species have shifted physiology/optimalTemp
  const tempDiff = Math.abs(spA.physiology.optimalTemperatureC - spB.physiology.optimalTemperatureC) / 40;
  sumSq += tempDiff * tempDiff;
  count++;

  return Math.sqrt(sumSq / Math.max(1, count));
}

/**
 * Computes ecological/morphological divergence affecting pre-zygotic mate recognition.
 */
export function computeEcologicalMorphDistance(
  orgA: Organism,
  spA: SpeciesDefinition,
  orgB: Organism,
  spB: SpeciesDefinition
): number {
  const exA = orgA.phenotype.expressed;
  const exB = orgB.phenotype.expressed;

  // Core ecological traits: bodySize (0), heatTol (6), coldTol (7)
  const dSize = (exA[0] ?? 1) - (exB[0] ?? 1);
  const dHeat = (exA[6] ?? 1) - (exB[6] ?? 1);
  const dCold = (exA[7] ?? 1) - (exB[7] ?? 1);
  let sumSq = dSize * dSize + 0.5 * dHeat * dHeat + 0.5 * dCold * dCold;
  let terms = 2.0;

  const anA = ensureOrganismAnatomy(orgA, spA);
  const anB = ensureOrganismAnatomy(orgB, spB);
  const dAq = anA.expressed[ANATOMY_IDX.AQUATIC_AFFINITY] - anB.expressed[ANATOMY_IDX.AQUATIC_AFFINITY];
  const dInt = anA.expressed[ANATOMY_IDX.INTEGUMENT_THICKNESS] - anB.expressed[ANATOMY_IDX.INTEGUMENT_THICKNESS];
  const dHerb = anA.expressed[ANATOMY_IDX.HERBIVORY_APPARATUS] - anB.expressed[ANATOMY_IDX.HERBIVORY_APPARATUS];
  const dCarn = anA.expressed[ANATOMY_IDX.CARNIVORY_APPARATUS] - anB.expressed[ANATOMY_IDX.CARNIVORY_APPARATUS];
  const dArmor = anA.expressed[ANATOMY_IDX.ARMOR_PROTECTION] - anB.expressed[ANATOMY_IDX.ARMOR_PROTECTION];

  sumSq += 1.5 * dAq * dAq + 0.6 * dInt * dInt + dHerb * dHerb + dCarn * dCarn + 0.6 * dArmor * dArmor;
  terms += 4.3;

  const dOptT = (spA.physiology.optimalTemperatureC - spB.physiology.optimalTemperatureC) / 25;
  sumSq += dOptT * dOptT;
  terms += 1.0;

  return Math.sqrt(sumSq / terms);
}

/**
 * Evaluates sexual attractiveness & condition vigor for pre-zygotic sexual selection.
 * Healthy, energetic, well-proportioned mates score higher in bounded mate choice.
 */
export function computeSexualAttractiveness(org: Organism, species: SpeciesDefinition): number {
  const ex = org.phenotype.expressed;
  const speed = ex[2] ?? 1.0;
  const endurance = ex[3] ?? 1.0;
  const anat = org.anatomy;
  const tailDisplay = anat ? anat.expressed[ANATOMY_IDX.TAIL_LENGTH] : 1.0;
  const viability = anat ? anat.viability : 1.0;
  const condition = 0.55 * org.health + 0.45 * org.energy;
  const vigor = 0.45 + 0.25 * Math.min(1.5, speed) + 0.15 * Math.min(1.5, endurance) + 0.15 * Math.min(1.4, tailDisplay);
  const tempAdaptBonus = species.traitBaselines.bodySize ? 1.0 : 1.0;
  return Math.max(0.25, Math.min(1.8, condition * vigor * viability * tempAdaptBonus));
}

/**
 * Computes full pre-zygotic and post-zygotic compatibility between mother (orgA) and father (orgB),
 * handling pure conspecifics, F1 interspecific hybridization, hybrid reduced fertility/sterility,
 * and fertile backcrossing restoring gene flow.
 */
export function evaluateReproductiveCompatibility(
  mother: Organism,
  motherSpecies: SpeciesDefinition,
  father: Organism,
  fatherSpecies: SpeciesDefinition,
  isCladeCompatible: boolean
): ReproductiveCompatibilityResult {
  const sameSpecies = motherSpecies.id === fatherSpecies.id;
  if (!sameSpecies && !isCladeCompatible) {
    return {
      compatible: false,
      geneticDistance: 1,
      ecologicalDistance: 1,
      preZygoticCompatibility: 0,
      postZygoticViability: 0,
      offspringHybridFertility: 0,
      parentFertilityMultiplier: 0,
      isInterspecific: true,
      isBackcross: false,
      offspringPrimarySpeciesId: motherSpecies.id,
      offspringSecondarySpeciesId: fatherSpecies.id,
      offspringAdmixtureRatio: 0.5,
    };
  }

  const genDist = computeIndividualGeneticDistance(mother, motherSpecies, father, fatherSpecies);
  const ecoDist = computeEcologicalMorphDistance(mother, motherSpecies, father, fatherSpecies);

  const mAnc = mother.ancestry;
  const fAnc = father.ancestry;
  const mFert = mAnc ? mAnc.hybridFertility : 1.0;
  const fFert = fAnc ? fAnc.hybridFertility : 1.0;
  const parentFertilityMultiplier = clamp01(mFert * fFert);

  // Pre-zygotic mate recognition (assortative ecological/morphological preference)
  let preZygotic = sameSpecies
    ? Math.exp(-1.8 * ecoDist * ecoDist)
    : 0.58 * Math.exp(-3.2 * ecoDist * ecoDist);
  if (!sameSpecies && ecoDist > 0.62) {
    preZygotic = 0;
  }
  preZygotic = clamp01(preZygotic);

  // Post-zygotic Dobzhansky-Muller incompatibility curve
  let postViability = 1.0;
  let baseOffspringFertility = 1.0;
  if (genDist > 0.14) {
    if (genDist >= 0.52) {
      postViability = 0;
      baseOffspringFertility = 0;
    } else {
      const t = (genDist - 0.14) / (0.52 - 0.14);
      postViability = clamp01(1.0 - 0.72 * t * t);
      baseOffspringFertility = clamp01(1.0 - 1.15 * Math.pow(t, 1.35));
    }
  }

  // Interspecific crosses always carry at least mild hybrid fitness drag compared to pure conspecifics
  if (!sameSpecies) {
    postViability = Math.min(postViability, 0.88);
    baseOffspringFertility = Math.min(baseOffspringFertility, 0.82);
  }

  const mAdmix = mAnc?.admixtureRatio ?? 0;
  const fAdmix = fAnc?.admixtureRatio ?? 0;

  let isBackcross = false;
  let offspringPrimary = motherSpecies.id;
  let offspringSecondary: string | null = null;
  let offspringAdmixture = 0;
  let offspringFertility = baseOffspringFertility;

  if (sameSpecies) {
    if (mAdmix > 0.02 || fAdmix > 0.02) {
      // Hybrid x hybrid or backcross within recipient species
      offspringAdmixture = (mAdmix + fAdmix) * 0.5;
      offspringSecondary = mAnc?.secondarySpeciesId ?? fAnc?.secondarySpeciesId ?? null;
      if ((mAdmix > 0.05 && fAdmix < 0.05) || (fAdmix > 0.05 && mAdmix < 0.05)) {
        isBackcross = true;
        // Backcross toward pure parental population partially restores fertility
        offspringFertility = clamp01(Math.max(baseOffspringFertility, 0.62 + 0.38 * (1 - offspringAdmixture)));
      } else {
        offspringFertility = clamp01(Math.max(baseOffspringFertility, (mFert + fFert) * 0.5));
      }
    }
  } else {
    // Check if one parent is an F1/admixed hybrid backcrossing with a pure parental species
    const mSharesFather =
      mAnc !== undefined &&
      (mAnc.primarySpeciesId === fatherSpecies.id || mAnc.secondarySpeciesId === fatherSpecies.id);
    const fSharesMother =
      fAnc !== undefined &&
      (fAnc.primarySpeciesId === motherSpecies.id || fAnc.secondarySpeciesId === motherSpecies.id);

    if ((mAdmix > 0.05 && mSharesFather && fAdmix < 0.05) || (fAdmix > 0.05 && fSharesMother && mAdmix < 0.05)) {
      isBackcross = true;
      const pureSpeciesId = fAdmix < 0.05 ? fatherSpecies.id : motherSpecies.id;
      const otherSpeciesId = pureSpeciesId === fatherSpecies.id ? motherSpecies.id : fatherSpecies.id;
      const hybridAdmix = fAdmix < 0.05 ? mAdmix : fAdmix;
      offspringPrimary = pureSpeciesId;
      offspringSecondary = otherSpeciesId;
      offspringAdmixture = hybridAdmix * 0.5;
      offspringFertility = clamp01(Math.max(baseOffspringFertility, 0.58 + 0.42 * (1 - offspringAdmixture)));
    } else {
      // Primary F1 hybridization: offspring join maternal population with 0.5 admixture
      offspringPrimary = motherSpecies.id;
      offspringSecondary = fatherSpecies.id;
      offspringAdmixture = 0.5;
      offspringFertility = baseOffspringFertility;
    }
  }

  const compatible =
    preZygotic > 0.01 &&
    postViability > 0.01 &&
    parentFertilityMultiplier > 0.01;

  return {
    compatible,
    geneticDistance: genDist,
    ecologicalDistance: ecoDist,
    preZygoticCompatibility: preZygotic,
    postZygoticViability: postViability,
    offspringHybridFertility: offspringFertility,
    parentFertilityMultiplier,
    isInterspecific: !sameSpecies,
    isBackcross,
    offspringPrimarySpeciesId: offspringPrimary,
    offspringSecondarySpeciesId: offspringSecondary,
    offspringAdmixtureRatio: offspringAdmixture,
  };
}

/**
 * Computes population genetic diversity, mean allele frequencies, and variance (for drift,
 * bottleneck/founder effects, and selection tracking).
 */
export function computePopulationGeneticSummary(
  organisms: readonly Organism[],
  species: SpeciesDefinition
): PopulationGeneticSummary {
  const schema = species.genomeSchema;
  const locusCount = schema.locusCount;
  const meanCore = new Float64Array(locusCount);
  const varCore = new Float64Array(locusCount);
  const meanAnat = new Float64Array(ANATOMY_LOCUS_COUNT);
  const varAnat = new Float64Array(ANATOMY_LOCUS_COUNT);

  let n = 0;
  let hetSum = 0;

  for (let i = 0; i < organisms.length; i++) {
    const org = organisms[i];
    if (!org.alive) continue;
    n++;
    const mat = org.genome.maternalAlleles;
    const pat = org.genome.paternalAlleles;
    for (let l = 0; l < locusCount; l++) {
      const m = mat[l];
      const p = pat[l];
      meanCore[l] += (m + p) * 0.5;
      const r = schema.loci[l];
      const range = species.traitRanges[r.id] ?? r.defaultRange;
      const span = Math.max(1e-6, range.max - range.min);
      hetSum += Math.abs(m - p) / span;
    }
    const anat = ensureOrganismAnatomy(org, species);
    for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) {
      meanAnat[a] += (anat.maternal[a] + anat.paternal[a]) * 0.5;
    }
  }

  if (n === 0) {
    return {
      count: 0,
      meanCoreAlleles: meanCore,
      coreAlleleVariance: varCore,
      meanAnatomyAlleles: meanAnat,
      anatomyAlleleVariance: varAnat,
      heterozygosity: 0,
      meanDiversity: 0,
    };
  }

  const invN = 1 / n;
  for (let l = 0; l < locusCount; l++) meanCore[l] *= invN;
  for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) meanAnat[a] *= invN;

  let normVarSum = 0;
  for (let i = 0; i < organisms.length; i++) {
    const org = organisms[i];
    if (!org.alive) continue;
    const mat = org.genome.maternalAlleles;
    const pat = org.genome.paternalAlleles;
    for (let l = 0; l < locusCount; l++) {
      const d = (mat[l] + pat[l]) * 0.5 - meanCore[l];
      varCore[l] += d * d;
    }
    const anat = org.anatomy;
    if (anat) {
      for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) {
        const d = (anat.maternal[a] + anat.paternal[a]) * 0.5 - meanAnat[a];
        varAnat[a] += d * d;
      }
    }
  }

  for (let l = 0; l < locusCount; l++) {
    varCore[l] *= invN;
    const def = schema.loci[l];
    const range = species.traitRanges[def.id] ?? def.defaultRange;
    const span = Math.max(1e-6, range.max - range.min);
    normVarSum += Math.sqrt(varCore[l]) / span;
  }
  for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) {
    varAnat[a] *= invN;
    const r = ANATOMY_RANGES[a];
    normVarSum += Math.sqrt(varAnat[a]) / (r.max - r.min);
  }

  return {
    count: n,
    meanCoreAlleles: meanCore,
    coreAlleleVariance: varCore,
    meanAnatomyAlleles: meanAnat,
    anatomyAlleleVariance: varAnat,
    heterozygosity: hetSum / (n * Math.max(1, locusCount)),
    meanDiversity: normVarSum / (locusCount + ANATOMY_LOCUS_COUNT),
  };
}

/**
 * Computes Fst-like normalized genetic divergence between two subpopulation summaries.
 */
export function computePairwiseGeneticDivergence(
  sumA: PopulationGeneticSummary,
  sumB: PopulationGeneticSummary,
  schema: GenomeSchema,
  speciesA: SpeciesDefinition
): number {
  if (sumA.count === 0 || sumB.count === 0) return 0;
  let sqDiff = 0;
  let count = 0;
  const lc = Math.min(sumA.meanCoreAlleles.length, sumB.meanCoreAlleles.length, schema.locusCount);
  for (let l = 0; l < lc; l++) {
    const def = schema.loci[l];
    const r = speciesA.traitRanges[def.id] ?? def.defaultRange;
    const span = Math.max(1e-6, r.max - r.min);
    const d = (sumA.meanCoreAlleles[l] - sumB.meanCoreAlleles[l]) / span;
    sqDiff += d * d;
    count++;
  }
  for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) {
    const r = ANATOMY_RANGES[a];
    const d = (sumA.meanAnatomyAlleles[a] - sumB.meanAnatomyAlleles[a]) / (r.max - r.min);
    sqDiff += d * d;
    count++;
  }
  return Math.sqrt(sqDiff / Math.max(1, count));
}
