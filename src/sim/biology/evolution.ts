import {
  ANATOMY_IDX,
  ANATOMY_LOCUS_COUNT,
  ANATOMY_RANGES,
  OrganismAnatomyState,
  deriveSpeciesAnatomyBaseline,
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

  // Anatomy terms only when both organisms actually carry an anatomy genome (never synthesized)
  const anA = orgA.anatomy;
  const anB = orgB.anatomy;
  if (anA !== undefined && anB !== undefined) {
    const dAq = anA.expressed[ANATOMY_IDX.AQUATIC_AFFINITY] - anB.expressed[ANATOMY_IDX.AQUATIC_AFFINITY];
    const dInt = anA.expressed[ANATOMY_IDX.INTEGUMENT_THICKNESS] - anB.expressed[ANATOMY_IDX.INTEGUMENT_THICKNESS];
    const dHerb = anA.expressed[ANATOMY_IDX.HERBIVORY_APPARATUS] - anB.expressed[ANATOMY_IDX.HERBIVORY_APPARATUS];
    const dCarn = anA.expressed[ANATOMY_IDX.CARNIVORY_APPARATUS] - anB.expressed[ANATOMY_IDX.CARNIVORY_APPARATUS];
    const dArmor = anA.expressed[ANATOMY_IDX.ARMOR_PROTECTION] - anB.expressed[ANATOMY_IDX.ARMOR_PROTECTION];
    sumSq += 1.5 * dAq * dAq + 0.6 * dInt * dInt + dHerb * dHerb + dCarn * dCarn + 0.6 * dArmor * dArmor;
    terms += 4.3;
  }

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
  let anatN = 0;
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
    // Read-only: anatomy statistics cover organisms that carry an anatomy genome
    const anat = org.anatomy;
    if (anat !== undefined) {
      anatN++;
      for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) {
        meanAnat[a] += (anat.maternal[a] + anat.paternal[a]) * 0.5;
      }
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
  const invAnatN = anatN > 0 ? 1 / anatN : 0;
  for (let l = 0; l < locusCount; l++) meanCore[l] *= invN;
  for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) meanAnat[a] *= invAnatN;

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
    varAnat[a] *= invAnatN;
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

export interface ReproductiveIsolationMeasurement {
  /** Sampled matings between the two groups (both directions). */
  readonly crossPairs: number;
  /** Sampled matings inside each group (reference). */
  readonly withinPairs: number;
  /** Mean expected fertile offspring factor of cross-group matings: pre * post * fertility. */
  readonly crossSuccess: number;
  readonly withinSuccess: number;
  /** `1 - crossSuccess / withinSuccess` in [0, 1]; `NaN` when not measurable (no mature pairs). */
  readonly isolation: number;
  /** Isolation from mate recognition alone: `1 - meanPre(cross) / meanPre(within)`. */
  readonly prezygoticIsolation: number;
  /** Isolation from zygote viability and hybrid fertility: `1 - meanPost(cross) / meanPost(within)`. */
  readonly postzygoticIsolation: number;
}

function matureByOrder(group: readonly Organism[], sex: 'female' | 'male'): Organism[] {
  const out: Organism[] = [];
  for (const o of group) {
    if (o.alive && o.sex === sex && (o.stage === 'adult' || o.stage === 'elder')) out.push(o);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

/**
 * Measures how well two groups of organisms could still reproduce with each other if they met,
 * using exactly the compatibility model that governs real matings in the simulation
 * (`evaluateReproductiveCompatibility`: assortative mate recognition, Dobzhansky-Muller zygote
 * viability, hybrid fertility). Spatial separation is deliberately NOT part of the measure: two
 * groups that merely live apart but are fully compatible measure as 0.
 *
 * Deterministic and RNG-free: mature females of one group are paired with mature males of the
 * other at evenly spread positions (ascending id order), at most `maxPairs` per direction.
 */
export function measureReproductiveIsolation(
  groupA: readonly Organism[],
  speciesA: SpeciesDefinition,
  groupB: readonly Organism[],
  speciesB: SpeciesDefinition,
  cladeCompatible = true,
  maxPairs = 24
): ReproductiveIsolationMeasurement {
  const fA = matureByOrder(groupA, 'female');
  const mA = matureByOrder(groupA, 'male');
  const fB = matureByOrder(groupB, 'female');
  const mB = matureByOrder(groupB, 'male');

  let crossN = 0;
  let crossS = 0;
  let crossPre = 0;
  let crossPost = 0;
  let withinN = 0;
  let withinS = 0;
  let withinPre = 0;
  let withinPost = 0;

  const sample = (
    females: readonly Organism[],
    fSp: SpeciesDefinition,
    males: readonly Organism[],
    mSp: SpeciesDefinition,
    cross: boolean
  ): void => {
    const nf = females.length;
    const nm = males.length;
    if (nf === 0 || nm === 0) return;
    const k = Math.min(maxPairs, Math.max(nf, nm));
    for (let i = 0; i < k; i++) {
      const f = females[Math.floor((i * nf) / k)];
      // golden-ratio stride decorrelates the male choice from the female choice
      const m = males[Math.floor(((i * 0.6180339887498949 + 0.5) % 1) * nm)];
      const c = evaluateReproductiveCompatibility(f, fSp, m, mSp, cladeCompatible);
      const pre = c.compatible ? c.preZygoticCompatibility * c.parentFertilityMultiplier : 0;
      const post = c.compatible ? c.postZygoticViability * c.offspringHybridFertility : 0;
      if (cross) {
        crossN++;
        crossS += pre * post;
        crossPre += pre;
        crossPost += post;
      } else {
        withinN++;
        withinS += pre * post;
        withinPre += pre;
        withinPost += post;
      }
    }
  };
  sample(fA, speciesA, mB, speciesB, true);
  sample(fB, speciesB, mA, speciesA, true);
  sample(fA, speciesA, mA, speciesA, false);
  sample(fB, speciesB, mB, speciesB, false);

  const ratioIso = (cross: number, cn: number, within: number, wn: number): number => {
    if (cn === 0 || wn === 0) return NaN;
    const w = within / wn;
    if (w <= 0) return NaN;
    return clamp01(1 - cross / cn / w);
  };
  return {
    crossPairs: crossN,
    withinPairs: withinN,
    crossSuccess: crossN > 0 ? crossS / crossN : NaN,
    withinSuccess: withinN > 0 ? withinS / withinN : NaN,
    isolation: ratioIso(crossS, crossN, withinS, withinN),
    prezygoticIsolation: ratioIso(crossPre, crossN, withinPre, withinN),
    postzygoticIsolation: ratioIso(crossPost, crossN, withinPost, withinN),
  };
}
