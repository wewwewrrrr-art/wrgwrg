import { ANATOMY_LOCUS_COUNT, ANATOMY_LOCUS_NAMES, ANATOMY_RANGES } from './anatomy';
import type { Organism } from './organism';
import type { Subpopulation } from './spatialBehavior';
import type { SpeciesDefinition } from './species';

/**
 * Population genetic diversity and between-group differentiation (`geneticDiversity.ts`).
 *
 * Read-only measurement layer over the genome model that actually exists:
 *   - core genome: per locus two continuous allele values (`maternalAlleles`, `paternalAlleles`)
 *     and a heritable expression blend weight (`dominance`); the inherited trait value is
 *     `phenotype.geneticExpression`, computed by `computePhenotype`;
 *   - anatomy genome (optional per organism): the same diploid layout in `organism.anatomy`
 *     with its inherited expression in `anatomy.expressed`.
 *
 * Alleles are continuous quantities, not discrete allele types, so there are no allele
 * frequencies, allele counts or expected heterozygosity here. Diversity is expressed through
 * variances of trait and allele values and through how the two allele copies of an individual
 * relate to each other.
 *
 * All statistics are computed on demand in a single pass per population (Welford updates in
 * ascending organism id order), without pairwise comparisons between individuals and without
 * copying genomes. Nothing in this module writes to organisms or to simulation state.
 * Organisms that do not carry an anatomy state are excluded from anatomy statistics; no anatomy
 * alleles are synthesized for them.
 */

export type GeneticLocusSource = 'core' | 'anatomy';

export interface GeneticLocusStatistics {
  readonly traitId: string;
  readonly source: GeneticLocusSource;
  /** Individuals contributing to this locus. */
  readonly count: number;
  /** Species trait range used for normalization. */
  readonly rangeMin: number;
  readonly rangeMax: number;
  /** Mean inherited trait value (dominance-weighted expression of the two alleles). */
  readonly mean: number;
  /** Population variance of the inherited trait value (census, divisor `count`). */
  readonly variance: number;
  readonly stdDev: number;
  /** `stdDev / (rangeMax - rangeMin)`: comparable across loci with different units. */
  readonly normalizedStdDev: number;
  /** `stdDev / |mean|` (`NaN` when the mean is 0). */
  readonly coefficientOfVariation: number;
  readonly min: number;
  readonly max: number;
  /** Mean over all `2 * count` allele copies (gene-pool mean). */
  readonly alleleMean: number;
  /** Variance over all `2 * count` allele copies (gene-pool variance). */
  readonly alleleVariance: number;
  /** Mean of `((maternal - paternal) / 2)^2`: allele spread inside individuals. */
  readonly withinIndividualAlleleVariance: number;
  /** Variance of individual allele means `(maternal + paternal) / 2` across individuals. */
  readonly betweenIndividualAlleleVariance: number;
  /**
   * Correlation of the two allele copies within individuals,
   * `(between - within) / alleleVariance` (identity: `alleleVariance = within + between`).
   * About 0 when allele copies combine independently, 1 when both copies are always equal
   * (inbreeding-like), negative when copies are more different than chance. Quantitative
   * analogue of F_IS; `NaN` when the locus has no allelic variance.
   */
  readonly alleleCorrelation: number;
  /** Mean `|maternal - paternal| / range span` (same definition as `PopulationStats`). */
  readonly meanNormalizedAlleleDivergence: number;
  readonly dominanceMean: number;
  readonly dominanceStdDev: number;
}

export interface GeneticDiversitySummary {
  readonly locusCount: number;
  /** Individuals contributing (core: all analysed, anatomy: anatomy carriers). */
  readonly count: number;
  readonly meanNormalizedStdDev: number;
  readonly meanNormalizedAlleleStdDev: number;
  readonly meanNormalizedAlleleDivergence: number;
  /** Mean of `alleleCorrelation` over loci where it is defined (`NaN` if none). */
  readonly meanAlleleCorrelation: number;
  /** Loci whose gene pool holds more than one allele value. */
  readonly polymorphicLoci: number;
}

export interface PopulationGeneticProfile {
  readonly speciesId: string;
  readonly schemaId: string;
  readonly tick: number;
  readonly includesEggs: boolean;
  /** All living organisms passed in (before the egg filter). */
  readonly livingCount: number;
  /** Organisms included in the statistics. */
  readonly count: number;
  /** Living eggs among `livingCount`. */
  readonly eggCount: number;
  /** Included organisms that carry an anatomy genome. */
  readonly anatomyCarrierCount: number;
  /** Core loci in genome-schema order. */
  readonly coreLoci: readonly GeneticLocusStatistics[];
  /** Anatomy loci in `ANATOMY_LOCUS_NAMES` order (count 0 when nobody carries anatomy). */
  readonly anatomyLoci: readonly GeneticLocusStatistics[];
  readonly coreDiversity: GeneticDiversitySummary;
  /** `null` when no included organism carries an anatomy genome. */
  readonly anatomyDiversity: GeneticDiversitySummary | null;
}

export interface GeneticProfileOptions {
  /** Include living eggs (default: true, matching `PopulationStats.totalAlive`). */
  readonly includeEggs?: boolean;
  /** Tick stamped on the result (default: 0). */
  readonly tick?: number;
}

export interface GeneticLocusDifference {
  readonly traitId: string;
  readonly source: GeneticLocusSource;
  readonly countA: number;
  readonly countB: number;
  readonly meanA: number;
  readonly meanB: number;
  /** `meanB - meanA` of the inherited trait value. */
  readonly meanDifference: number;
  /** `|meanDifference| / range span`. */
  readonly normalizedDifference: number;
  /** `alleleMeanB - alleleMeanA` (gene-pool means, independent of dominance). */
  readonly alleleMeanDifference: number;
  /**
   * `meanDifference / pooled within-group standard deviation` (sample-pooled, Cohen's d).
   * `NaN` with fewer than 3 individuals in total; `+-Infinity` when both groups are
   * monomorphic at different values.
   */
  readonly standardizedDifference: number;
  /**
   * Share of trait variance that lies between the two groups, from an unbalanced one-way
   * ANOVA variance-component estimate, in `[0, 1]` (Q_ST-like on inherited trait values).
   * `NaN` when it cannot be estimated (fewer than 3 individuals in total).
   */
  readonly differentiation: number;
}

export interface GeneticDifferenceSummary {
  readonly locusCount: number;
  readonly meanNormalizedDifference: number;
  readonly maxNormalizedDifference: number;
  readonly maxNormalizedDifferenceTraitId: string | null;
  readonly meanDifferentiation: number;
  readonly maxDifferentiation: number;
  readonly maxDifferentiationTraitId: string | null;
}

export interface GeneticProfileComparison {
  readonly speciesIdA: string;
  readonly speciesIdB: string;
  readonly countA: number;
  readonly countB: number;
  readonly coreLoci: readonly GeneticLocusDifference[];
  /** Empty when either side has no anatomy carriers. */
  readonly anatomyLoci: readonly GeneticLocusDifference[];
  readonly core: GeneticDifferenceSummary;
  readonly anatomy: GeneticDifferenceSummary | null;
}

export interface GeneticLocusDifferentiation {
  readonly traitId: string;
  readonly source: GeneticLocusSource;
  /** Groups with at least one contributing individual. */
  readonly groupCount: number;
  /** Between-group variance share in `[0, 1]` (k-group ANOVA estimate); `NaN` if not estimable. */
  readonly differentiation: number;
  /** `(max group mean - min group mean) / range span`. */
  readonly normalizedMeanRange: number;
}

export interface AmongGroupDifferentiation {
  readonly groupCount: number;
  readonly coreLoci: readonly GeneticLocusDifferentiation[];
  readonly anatomyLoci: readonly GeneticLocusDifferentiation[];
  readonly meanCoreDifferentiation: number;
  readonly meanAnatomyDifferentiation: number;
}

export interface SubpopulationGeneticGroup {
  /** Index into the analysed groups (largest group first). */
  readonly index: number;
  readonly size: number;
  readonly cellCount: number;
  readonly centroidX: number;
  readonly centroidY: number;
  /** Navigation component of the group (-1 when unknown). */
  readonly navComponent: number;
  readonly profile: PopulationGeneticProfile;
}

export interface SubpopulationGeneticPair {
  readonly groupA: number;
  readonly groupB: number;
  /** Chebyshev distance between group centroids in cells. */
  readonly centroidDistance: number;
  /**
   * Both groups lie in the same navigation component. `false` means no walkable connection
   * exists between them for the species (geographic barrier); `null` when unknown.
   */
  readonly sameNavComponent: boolean | null;
  readonly comparison: GeneticProfileComparison;
}

export interface SubpopulationGeneticAnalysis {
  readonly speciesId: string;
  readonly tick: number;
  readonly linkDistance: number;
  readonly minGroupSize: number;
  readonly livingCount: number;
  /** All spatial groups found, including those too small to analyse. */
  readonly spatialGroupCount: number;
  readonly groups: readonly SubpopulationGeneticGroup[];
  /** Living organisms in groups that were not analysed (too small or beyond `maxGroups`). */
  readonly unanalysedCount: number;
  readonly amongGroups: AmongGroupDifferentiation | null;
  /** All pairs `groupA < groupB` of analysed groups, in index order. */
  readonly pairs: readonly SubpopulationGeneticPair[];
}

export interface SubpopulationGeneticOptions extends GeneticProfileOptions {
  /** Organisms in groups smaller than this are not analysed (default 5, min 1). */
  readonly minGroupSize?: number;
  /** At most this many groups (largest first) are analysed (default 12, min 1). */
  readonly maxGroups?: number;
}

/**
 * Single-pass accumulator over one diploid locus block (Welford updates).
 * Buffers are reused across `reset()` calls; no per-organism allocation.
 */
class LocusBlockAccumulator {
  readonly locusCount: number;
  count = 0;
  private readonly gMean: Float64Array;
  private readonly gM2: Float64Array;
  private readonly gMin: Float64Array;
  private readonly gMax: Float64Array;
  private readonly aMean: Float64Array;
  private readonly aM2: Float64Array;
  private readonly mMean: Float64Array;
  private readonly mM2: Float64Array;
  private readonly wSum: Float64Array;
  private readonly dSum: Float64Array;
  private readonly hMean: Float64Array;
  private readonly hM2: Float64Array;

  constructor(locusCount: number) {
    this.locusCount = locusCount;
    this.gMean = new Float64Array(locusCount);
    this.gM2 = new Float64Array(locusCount);
    this.gMin = new Float64Array(locusCount);
    this.gMax = new Float64Array(locusCount);
    this.aMean = new Float64Array(locusCount);
    this.aM2 = new Float64Array(locusCount);
    this.mMean = new Float64Array(locusCount);
    this.mM2 = new Float64Array(locusCount);
    this.wSum = new Float64Array(locusCount);
    this.dSum = new Float64Array(locusCount);
    this.hMean = new Float64Array(locusCount);
    this.hM2 = new Float64Array(locusCount);
  }

  add(gen: Float32Array, mat: Float32Array, pat: Float32Array, dom: Float32Array): void {
    const n = ++this.count;
    const invN = 1 / n;
    const inv2N = 1 / (2 * n);
    const inv2NMinus1 = 1 / (2 * n - 1);
    const L = this.locusCount;
    const gMean = this.gMean;
    const gM2 = this.gM2;
    const gMin = this.gMin;
    const gMax = this.gMax;
    const aMean = this.aMean;
    const aM2 = this.aM2;
    const mMean = this.mMean;
    const mM2 = this.mM2;
    const wSum = this.wSum;
    const dSum = this.dSum;
    const hMean = this.hMean;
    const hM2 = this.hM2;
    for (let l = 0; l < L; l++) {
      const g = gen[l];
      let delta = g - gMean[l];
      gMean[l] += delta * invN;
      gM2[l] += delta * (g - gMean[l]);
      if (n === 1) {
        gMin[l] = g;
        gMax[l] = g;
      } else {
        if (g < gMin[l]) gMin[l] = g;
        if (g > gMax[l]) gMax[l] = g;
      }

      const a = mat[l];
      const b = pat[l];
      // Gene-pool stream: two allele observations per individual (counts 2n-1 and 2n)
      delta = a - aMean[l];
      aMean[l] += delta * inv2NMinus1;
      aM2[l] += delta * (a - aMean[l]);
      delta = b - aMean[l];
      aMean[l] += delta * inv2N;
      aM2[l] += delta * (b - aMean[l]);

      const m = (a + b) * 0.5;
      delta = m - mMean[l];
      mMean[l] += delta * invN;
      mM2[l] += delta * (m - mMean[l]);

      const half = (a - b) * 0.5;
      wSum[l] += half * half;
      dSum[l] += a >= b ? a - b : b - a;

      const h = dom[l];
      delta = h - hMean[l];
      hMean[l] += delta * invN;
      hM2[l] += delta * (h - hMean[l]);
    }
  }

  toStatistics(
    traitIds: readonly string[],
    rangeMin: ArrayLike<number>,
    rangeMax: ArrayLike<number>,
    source: GeneticLocusSource
  ): GeneticLocusStatistics[] {
    const n = this.count;
    const out: GeneticLocusStatistics[] = new Array(this.locusCount);
    for (let l = 0; l < this.locusCount; l++) {
      const span = rangeMax[l] - rangeMin[l];
      const invSpan = span > 0 ? 1 / span : 0;
      if (n === 0) {
        out[l] = Object.freeze({
          traitId: traitIds[l],
          source,
          count: 0,
          rangeMin: rangeMin[l],
          rangeMax: rangeMax[l],
          mean: NaN,
          variance: NaN,
          stdDev: NaN,
          normalizedStdDev: NaN,
          coefficientOfVariation: NaN,
          min: NaN,
          max: NaN,
          alleleMean: NaN,
          alleleVariance: NaN,
          withinIndividualAlleleVariance: NaN,
          betweenIndividualAlleleVariance: NaN,
          alleleCorrelation: NaN,
          meanNormalizedAlleleDivergence: NaN,
          dominanceMean: NaN,
          dominanceStdDev: NaN,
        });
        continue;
      }
      const mean = this.gMean[l];
      const variance = Math.max(0, this.gM2[l] / n);
      const stdDev = Math.sqrt(variance);
      const alleleVariance = Math.max(0, this.aM2[l] / (2 * n));
      const within = this.wSum[l] / n;
      const between = Math.max(0, this.mM2[l] / n);
      let correlation = NaN;
      if (alleleVariance > 0) {
        correlation = (between - within) / alleleVariance;
        correlation = correlation < -1 ? -1 : correlation > 1 ? 1 : correlation;
      }
      out[l] = Object.freeze({
        traitId: traitIds[l],
        source,
        count: n,
        rangeMin: rangeMin[l],
        rangeMax: rangeMax[l],
        mean,
        variance,
        stdDev,
        normalizedStdDev: stdDev * invSpan,
        coefficientOfVariation: mean !== 0 ? stdDev / Math.abs(mean) : NaN,
        min: this.gMin[l],
        max: this.gMax[l],
        alleleMean: this.aMean[l],
        alleleVariance,
        withinIndividualAlleleVariance: within,
        betweenIndividualAlleleVariance: between,
        alleleCorrelation: correlation,
        meanNormalizedAlleleDivergence: (this.dSum[l] / n) * invSpan,
        dominanceMean: this.hMean[l],
        dominanceStdDev: Math.sqrt(Math.max(0, this.hM2[l] / n)),
      });
    }
    return out;
  }
}

function summarizeDiversity(loci: readonly GeneticLocusStatistics[], count: number): GeneticDiversitySummary {
  const L = loci.length;
  if (count === 0 || L === 0) {
    return Object.freeze({
      locusCount: L,
      count,
      meanNormalizedStdDev: NaN,
      meanNormalizedAlleleStdDev: NaN,
      meanNormalizedAlleleDivergence: NaN,
      meanAlleleCorrelation: NaN,
      polymorphicLoci: 0,
    });
  }
  let sStd = 0;
  let sAllele = 0;
  let sDiv = 0;
  let sCorr = 0;
  let nCorr = 0;
  let polymorphic = 0;
  for (let l = 0; l < L; l++) {
    const s = loci[l];
    const span = s.rangeMax - s.rangeMin;
    const invSpan = span > 0 ? 1 / span : 0;
    sStd += s.normalizedStdDev;
    sAllele += Math.sqrt(s.alleleVariance) * invSpan;
    sDiv += s.meanNormalizedAlleleDivergence;
    if (!Number.isNaN(s.alleleCorrelation)) {
      sCorr += s.alleleCorrelation;
      nCorr++;
    }
    if (s.alleleVariance > 0) polymorphic++;
  }
  return Object.freeze({
    locusCount: L,
    count,
    meanNormalizedStdDev: sStd / L,
    meanNormalizedAlleleStdDev: sAllele / L,
    meanNormalizedAlleleDivergence: sDiv / L,
    meanAlleleCorrelation: nCorr > 0 ? sCorr / nCorr : NaN,
    polymorphicLoci: polymorphic,
  });
}

interface SpeciesLocusLayout {
  readonly coreIds: readonly string[];
  readonly coreMin: Float64Array;
  readonly coreMax: Float64Array;
  readonly anatomyIds: readonly string[];
  readonly anatomyMin: Float64Array;
  readonly anatomyMax: Float64Array;
}

const layoutCache = new WeakMap<SpeciesDefinition, SpeciesLocusLayout>();

/** Locus ids and normalization ranges, using the same range rule as `PopulationManager`. */
function getLocusLayout(species: SpeciesDefinition): SpeciesLocusLayout {
  let layout = layoutCache.get(species);
  if (layout) return layout;
  const schema = species.genomeSchema;
  const L = schema.locusCount;
  const coreIds: string[] = new Array(L);
  const coreMin = new Float64Array(L);
  const coreMax = new Float64Array(L);
  for (let l = 0; l < L; l++) {
    const def = schema.loci[l];
    const range = species.traitRanges[def.id] ?? def.defaultRange;
    coreIds[l] = def.id;
    coreMin[l] = range.min;
    coreMax[l] = range.max;
  }
  const anatomyMin = new Float64Array(ANATOMY_LOCUS_COUNT);
  const anatomyMax = new Float64Array(ANATOMY_LOCUS_COUNT);
  for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) {
    anatomyMin[a] = ANATOMY_RANGES[a].min;
    anatomyMax[a] = ANATOMY_RANGES[a].max;
  }
  layout = Object.freeze({
    coreIds: Object.freeze(coreIds),
    coreMin,
    coreMax,
    anatomyIds: ANATOMY_LOCUS_NAMES,
    anatomyMin,
    anatomyMax,
  });
  layoutCache.set(species, layout);
  return layout;
}

/**
 * Computes the genetic profile of `organisms` (all of `species`) in one pass.
 *
 * Organisms are visited in ascending id order so the floating-point result does not depend on
 * the order of the input array. Dead organisms are skipped. Throws when an organism belongs to a
 * different species or genome schema.
 */
export function computeGeneticProfile(
  species: SpeciesDefinition,
  organisms: readonly Organism[],
  options: GeneticProfileOptions = {}
): PopulationGeneticProfile {
  const includeEggs = options.includeEggs ?? true;
  const tick = options.tick ?? 0;
  const schema = species.genomeSchema;
  const L = schema.locusCount;
  const layout = getLocusLayout(species);
  const core = new LocusBlockAccumulator(L);
  const anatomy = new LocusBlockAccumulator(ANATOMY_LOCUS_COUNT);

  // Ascending-id visiting order without copying when the input is already ordered
  const len = organisms.length;
  let order: Int32Array | null = null;
  let prevId = -Infinity;
  for (let i = 0; i < len; i++) {
    const id = organisms[i].id;
    if (id < prevId) {
      order = new Int32Array(len);
      for (let k = 0; k < len; k++) order[k] = k;
      order.sort((x, y) => organisms[x].id - organisms[y].id);
      break;
    }
    prevId = id;
  }

  let livingCount = 0;
  let eggCount = 0;
  let lastId = -Infinity;
  for (let k = 0; k < len; k++) {
    const org = organisms[order === null ? k : order[k]];
    if (!org.alive) continue;
    if (org.speciesId !== species.id) {
      throw new RangeError(
        `computeGeneticProfile: organism ${org.id} belongs to "${org.speciesId}", expected "${species.id}"`
      );
    }
    if (org.id === lastId) {
      throw new RangeError(`computeGeneticProfile: organism ${org.id} appears more than once`);
    }
    lastId = org.id;
    const genome = org.genome;
    if (genome.schemaId !== schema.id || genome.maternalAlleles.length !== L || org.phenotype.geneticExpression.length !== L) {
      throw new RangeError(
        `computeGeneticProfile: organism ${org.id} genome does not match schema "${schema.id}"`
      );
    }
    livingCount++;
    const isEgg = org.stage === 'egg';
    if (isEgg) eggCount++;
    if (isEgg && !includeEggs) continue;

    core.add(org.phenotype.geneticExpression, genome.maternalAlleles, genome.paternalAlleles, genome.dominance);
    const anat = org.anatomy;
    if (anat !== undefined) {
      anatomy.add(anat.expressed, anat.maternal, anat.paternal, anat.dominance);
    }
  }

  const coreLoci = core.toStatistics(layout.coreIds, layout.coreMin, layout.coreMax, 'core');
  const anatomyLoci = anatomy.toStatistics(layout.anatomyIds, layout.anatomyMin, layout.anatomyMax, 'anatomy');
  return Object.freeze({
    speciesId: species.id,
    schemaId: schema.id,
    tick,
    includesEggs: includeEggs,
    livingCount,
    count: core.count,
    eggCount,
    anatomyCarrierCount: anatomy.count,
    coreLoci: Object.freeze(coreLoci),
    anatomyLoci: Object.freeze(anatomyLoci),
    coreDiversity: summarizeDiversity(coreLoci, core.count),
    anatomyDiversity: anatomy.count > 0 ? summarizeDiversity(anatomyLoci, anatomy.count) : null,
  });
}

/**
 * Between-group share of variance for one locus from group sufficient statistics
 * (unbalanced one-way ANOVA variance components; population variances as input).
 * Groups with `count === 0` are ignored. Returns `NaN` when not estimable.
 */
function varianceComponentShare(counts: ArrayLike<number>, means: ArrayLike<number>, variances: ArrayLike<number>): number {
  let N = 0;
  let k = 0;
  let sumNMean = 0;
  let sumN2 = 0;
  for (let i = 0; i < counts.length; i++) {
    const n = counts[i];
    if (n <= 0) continue;
    N += n;
    k++;
    sumNMean += n * means[i];
    sumN2 += n * n;
  }
  if (k < 2 || N - k < 1) return NaN;
  const grand = sumNMean / N;
  let ssb = 0;
  let ssw = 0;
  for (let i = 0; i < counts.length; i++) {
    const n = counts[i];
    if (n <= 0) continue;
    const d = means[i] - grand;
    ssb += n * d * d;
    ssw += n * variances[i];
  }
  const msb = ssb / (k - 1);
  const msw = ssw / (N - k);
  const n0 = (N - sumN2 / N) / (k - 1);
  const between = n0 > 0 ? Math.max(0, (msb - msw) / n0) : 0;
  const total = between + msw;
  return total > 0 ? between / total : 0;
}

function compareLocus(a: GeneticLocusStatistics, b: GeneticLocusStatistics): GeneticLocusDifference {
  const nA = a.count;
  const nB = b.count;
  const span = a.rangeMax - a.rangeMin;
  const invSpan = span > 0 ? 1 / span : 0;
  const diff = nA > 0 && nB > 0 ? b.mean - a.mean : NaN;
  let standardized = NaN;
  if (nA > 0 && nB > 0 && nA + nB > 2) {
    const pooled = (nA * a.variance + nB * b.variance) / (nA + nB - 2);
    if (pooled > 0) standardized = diff / Math.sqrt(pooled);
    else standardized = diff === 0 ? 0 : diff > 0 ? Infinity : -Infinity;
  }
  return Object.freeze({
    traitId: a.traitId,
    source: a.source,
    countA: nA,
    countB: nB,
    meanA: a.mean,
    meanB: b.mean,
    meanDifference: diff,
    normalizedDifference: Math.abs(diff) * invSpan,
    alleleMeanDifference: nA > 0 && nB > 0 ? b.alleleMean - a.alleleMean : NaN,
    standardizedDifference: standardized,
    differentiation: varianceComponentShare([nA, nB], [a.mean, b.mean], [a.variance, b.variance]),
  });
}

function summarizeDifferences(loci: readonly GeneticLocusDifference[]): GeneticDifferenceSummary {
  let sNorm = 0;
  let nNorm = 0;
  let maxNorm = -Infinity;
  let maxNormId: string | null = null;
  let sDiff = 0;
  let nDiff = 0;
  let maxDiff = -Infinity;
  let maxDiffId: string | null = null;
  for (const d of loci) {
    if (!Number.isNaN(d.normalizedDifference)) {
      sNorm += d.normalizedDifference;
      nNorm++;
      if (d.normalizedDifference > maxNorm) {
        maxNorm = d.normalizedDifference;
        maxNormId = d.traitId;
      }
    }
    if (!Number.isNaN(d.differentiation)) {
      sDiff += d.differentiation;
      nDiff++;
      if (d.differentiation > maxDiff) {
        maxDiff = d.differentiation;
        maxDiffId = d.traitId;
      }
    }
  }
  return Object.freeze({
    locusCount: loci.length,
    meanNormalizedDifference: nNorm > 0 ? sNorm / nNorm : NaN,
    maxNormalizedDifference: nNorm > 0 ? maxNorm : NaN,
    maxNormalizedDifferenceTraitId: maxNormId,
    meanDifferentiation: nDiff > 0 ? sDiff / nDiff : NaN,
    maxDifferentiation: nDiff > 0 ? maxDiff : NaN,
    maxDifferentiationTraitId: maxDiffId,
  });
}

/**
 * Compares two genetic profiles of the same genome schema locus by locus. Uses only the
 * per-profile sufficient statistics (count, mean, variance), never the individuals again.
 * A measured difference is a description of two gene pools, not a species boundary.
 */
export function compareGeneticProfiles(
  a: PopulationGeneticProfile,
  b: PopulationGeneticProfile
): GeneticProfileComparison {
  if (a.schemaId !== b.schemaId || a.coreLoci.length !== b.coreLoci.length) {
    throw new RangeError(
      `compareGeneticProfiles requires the same genome schema (received "${a.schemaId}" and "${b.schemaId}")`
    );
  }
  const coreLoci: GeneticLocusDifference[] = new Array(a.coreLoci.length);
  for (let l = 0; l < a.coreLoci.length; l++) {
    if (a.coreLoci[l].traitId !== b.coreLoci[l].traitId) {
      throw new RangeError(`compareGeneticProfiles: locus order mismatch at ${l}`);
    }
    coreLoci[l] = compareLocus(a.coreLoci[l], b.coreLoci[l]);
  }
  const bothAnatomy = a.anatomyCarrierCount > 0 && b.anatomyCarrierCount > 0;
  const anatomyLoci: GeneticLocusDifference[] = [];
  if (bothAnatomy) {
    for (let l = 0; l < a.anatomyLoci.length; l++) anatomyLoci.push(compareLocus(a.anatomyLoci[l], b.anatomyLoci[l]));
  }
  return Object.freeze({
    speciesIdA: a.speciesId,
    speciesIdB: b.speciesId,
    countA: a.count,
    countB: b.count,
    coreLoci: Object.freeze(coreLoci),
    anatomyLoci: Object.freeze(anatomyLoci),
    core: summarizeDifferences(coreLoci),
    anatomy: bothAnatomy ? summarizeDifferences(anatomyLoci) : null,
  });
}

function differentiateBlock(
  profiles: readonly PopulationGeneticProfile[],
  pick: (p: PopulationGeneticProfile) => readonly GeneticLocusStatistics[]
): GeneticLocusDifferentiation[] {
  const k = profiles.length;
  const L = k > 0 ? pick(profiles[0]).length : 0;
  const counts = new Float64Array(k);
  const means = new Float64Array(k);
  const variances = new Float64Array(k);
  const out: GeneticLocusDifferentiation[] = new Array(L);
  for (let l = 0; l < L; l++) {
    let groups = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let g = 0; g < k; g++) {
      const s = pick(profiles[g])[l];
      counts[g] = s.count;
      means[g] = s.count > 0 ? s.mean : 0;
      variances[g] = s.count > 0 ? s.variance : 0;
      if (s.count > 0) {
        groups++;
        if (s.mean < lo) lo = s.mean;
        if (s.mean > hi) hi = s.mean;
      }
    }
    const ref = pick(profiles[0])[l];
    const span = ref.rangeMax - ref.rangeMin;
    out[l] = Object.freeze({
      traitId: ref.traitId,
      source: ref.source,
      groupCount: groups,
      differentiation: varianceComponentShare(counts, means, variances),
      normalizedMeanRange: groups >= 2 && span > 0 ? (hi - lo) / span : groups >= 2 ? 0 : NaN,
    });
  }
  return out;
}

function meanDefined(values: readonly GeneticLocusDifferentiation[]): number {
  let s = 0;
  let n = 0;
  for (const v of values) {
    if (!Number.isNaN(v.differentiation)) {
      s += v.differentiation;
      n++;
    }
  }
  return n > 0 ? s / n : NaN;
}

/** Among-group differentiation over any number of profiles of one schema (k-group ANOVA per locus). */
export function computeAmongGroupDifferentiation(profiles: readonly PopulationGeneticProfile[]): AmongGroupDifferentiation {
  for (const p of profiles) {
    if (p.schemaId !== profiles[0].schemaId) {
      throw new RangeError('computeAmongGroupDifferentiation requires profiles of the same genome schema');
    }
  }
  const coreLoci = differentiateBlock(profiles, (p) => p.coreLoci);
  const anatomyLoci = differentiateBlock(profiles, (p) => p.anatomyLoci);
  return Object.freeze({
    groupCount: profiles.filter((p) => p.count > 0).length,
    coreLoci: Object.freeze(coreLoci),
    anatomyLoci: Object.freeze(anatomyLoci),
    meanCoreDifferentiation: meanDefined(coreLoci),
    meanAnatomyDifferentiation: meanDefined(anatomyLoci),
  });
}

/**
 * Genetic comparison of the spatial groups of one species.
 *
 * `subpopulations` is the partition produced by `computeSubpopulations` /
 * `BiologySimulation.getSubpopulations` (largest group first); `lookup` resolves organism ids.
 * Each analysed group gets its own one-pass profile; pairs and among-group differentiation are
 * derived from the profiles only. Cost: O(N * loci + groups^2 * loci).
 */
export function computeSubpopulationGeneticAnalysis(
  species: SpeciesDefinition,
  subpopulations: readonly Subpopulation[],
  lookup: (organismId: number) => Organism | undefined,
  linkDistance: number,
  options: SubpopulationGeneticOptions = {}
): SubpopulationGeneticAnalysis {
  const minGroupSize = options.minGroupSize ?? 5;
  const maxGroups = options.maxGroups ?? 12;
  if (!Number.isInteger(minGroupSize) || minGroupSize < 1) {
    throw new RangeError(`minGroupSize must be a positive integer, received: ${minGroupSize}`);
  }
  if (!Number.isInteger(maxGroups) || maxGroups < 1) {
    throw new RangeError(`maxGroups must be a positive integer, received: ${maxGroups}`);
  }
  const profileOptions: GeneticProfileOptions = { includeEggs: options.includeEggs, tick: options.tick };

  let livingCount = 0;
  let unanalysed = 0;
  const groups: SubpopulationGeneticGroup[] = [];
  const members: Organism[] = [];
  for (const sub of subpopulations) {
    livingCount += sub.size;
    if (groups.length >= maxGroups) {
      unanalysed += sub.size;
      continue;
    }
    members.length = 0;
    for (const id of sub.organismIds) {
      const org = lookup(id);
      if (org !== undefined) members.push(org);
    }
    const profile = computeGeneticProfile(species, members, profileOptions);
    if (profile.count < minGroupSize) {
      unanalysed += sub.size;
      continue;
    }
    groups.push(
      Object.freeze({
        index: groups.length,
        size: sub.size,
        cellCount: sub.cellCount,
        centroidX: sub.centroidX,
        centroidY: sub.centroidY,
        navComponent: sub.navComponent,
        profile,
      })
    );
  }
  members.length = 0;

  const pairs: SubpopulationGeneticPair[] = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i];
      const b = groups[j];
      pairs.push(
        Object.freeze({
          groupA: i,
          groupB: j,
          centroidDistance: Math.max(Math.abs(a.centroidX - b.centroidX), Math.abs(a.centroidY - b.centroidY)),
          sameNavComponent: a.navComponent >= 0 && b.navComponent >= 0 ? a.navComponent === b.navComponent : null,
          comparison: compareGeneticProfiles(a.profile, b.profile),
        })
      );
    }
  }

  return Object.freeze({
    speciesId: species.id,
    tick: options.tick ?? 0,
    linkDistance,
    minGroupSize,
    livingCount,
    spatialGroupCount: subpopulations.length,
    groups: Object.freeze(groups),
    unanalysedCount: unanalysed,
    amongGroups: groups.length >= 2 ? computeAmongGroupDifferentiation(groups.map((g) => g.profile)) : null,
    pairs: Object.freeze(pairs),
  });
}
