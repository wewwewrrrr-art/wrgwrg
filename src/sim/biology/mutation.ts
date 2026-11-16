import { SeededRng } from '../prng';
import {
  DiploidGenome,
  GenomeSchema,
  TraitId,
  TraitRange,
  clampTraitValue,
} from './genome';

export interface LocusMutationOverride {
  /** Multiplier on `baseRate` for this specific gene locus (must be >= 0) */
  readonly rateMultiplier?: number;
  /** Multiplier on `stepScale` for this specific gene locus (must be >= 0) */
  readonly scaleMultiplier?: number;
}

export interface MutationConfig {
  /**
   * Probability per allele copy per inheritance event that a point mutation occurs,
   * in [0, 1]. For a diploid genome of L loci, expected mutations per offspring = 2 * L * baseRate.
   */
  readonly baseRate: number;
  /**
   * Relative magnitude of mutation step as a fraction of the trait's allowed range `(max - min)`.
   * E.g. 0.08 means standard deviation of ~8% of trait span.
   */
  readonly stepScale: number;
  /**
   * Mean directional bias in units of `stepScale * span`.
   * Defaults to `0.0` (symmetric normal mutations around the parental allele) so
   * mutation itself does not impose artificial drift; fitness is determined strictly
   * by environment and survival/reproduction outcomes. Can still be overridden explicitly
   * per species or experiment.
   */
  readonly directionalBias?: number;
  /** Per-locus multipliers allowing distinct mutation rates & effect sizes per gene */
  readonly locusOverrides?: Readonly<Partial<Record<TraitId, LocusMutationOverride>>>;
}

export interface MutationRecord {
  readonly traitId: TraitId;
  readonly alleleCopy: 'maternal' | 'paternal';
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

export interface MutationOutcome {
  readonly mutationCount: number;
  readonly records: MutationRecord[];
}

export const DEFAULT_MUTATION_CONFIG: MutationConfig = {
  baseRate: 0.04,
  stepScale: 0.075,
  directionalBias: 0.0,
};

const EMPTY_MUTATION_RECORDS: MutationRecord[] = Object.freeze([]) as unknown as MutationRecord[];

export function validateMutationConfig(config: MutationConfig): void {
  if (!Number.isFinite(config.baseRate) || config.baseRate < 0 || config.baseRate > 1) {
    throw new RangeError(`MutationConfig.baseRate must be in [0, 1], received: ${config.baseRate}`);
  }
  if (!Number.isFinite(config.stepScale) || config.stepScale < 0) {
    throw new RangeError(`MutationConfig.stepScale must be finite and >= 0, received: ${config.stepScale}`);
  }
  const bias = config.directionalBias ?? 0;
  if (!Number.isFinite(bias)) {
    throw new RangeError(`MutationConfig.directionalBias must be finite, received: ${bias}`);
  }
  if (config.locusOverrides) {
    for (const [trait, ov] of Object.entries(config.locusOverrides)) {
      if (!ov) continue;
      if (ov.rateMultiplier !== undefined && (!Number.isFinite(ov.rateMultiplier) || ov.rateMultiplier < 0)) {
        throw new RangeError(`Invalid rateMultiplier for locus "${trait}": ${ov.rateMultiplier}`);
      }
      if (ov.scaleMultiplier !== undefined && (!Number.isFinite(ov.scaleMultiplier) || ov.scaleMultiplier < 0)) {
        throw new RangeError(`Invalid scaleMultiplier for locus "${trait}": ${ov.scaleMultiplier}`);
      }
    }
  }
}

/**
 * Applies deterministic, bounded point mutations to both haploid allele sets
 * of an offspring diploid genome upon inheritance.
 *
 * Uses a zero-centered normal distribution by default (`directionalBias = 0.0`,
 * `mean = directionalBias * sigma`, `stdDev = sigma`) so neither positive nor
 * negative allelic shifts are treated as inherently beneficial or harmful without
 * environmental selection.
 */
export function mutateGenome(
  genome: DiploidGenome,
  schema: GenomeSchema,
  ranges: Readonly<Record<string, TraitRange>>,
  config: MutationConfig,
  rng: SeededRng,
  collectRecords = false,
  skipValidation = false
): MutationOutcome {
  if (!skipValidation) {
    validateMutationConfig(config);
  }
  const biasFactor = config.directionalBias ?? 0;
  let mutationCount = 0;
  const records: MutationRecord[] | null = collectRecords ? [] : null;

  for (let i = 0; i < schema.locusCount; i++) {
    const def = schema.loci[i];
    const override = config.locusOverrides?.[def.id];
    const rateMul = override?.rateMultiplier ?? def.mutationRateMultiplier;
    const scaleMul = override?.scaleMultiplier ?? def.mutationScaleMultiplier;

    const effRate = Math.min(1, Math.max(0, config.baseRate * rateMul));
    if (effRate <= 0) continue;

    const range = ranges[def.id] ?? def.defaultRange;
    const span = range.max - range.min;
    const sigma = span * config.stepScale * scaleMul;
    if (sigma <= 0) continue;

    const meanDelta = biasFactor * sigma;

    // Maternal allele copy
    if (rng.chance(effRate)) {
      const before = genome.maternalAlleles[i];
      const rawDelta = rng.gaussian(meanDelta, sigma);
      const after = clampTraitValue(before + rawDelta, range);
      genome.maternalAlleles[i] = after;
      mutationCount++;
      if (records !== null) {
        records.push({
          traitId: def.id,
          alleleCopy: 'maternal',
          before,
          after,
          delta: after - before,
        });
      }
    }

    // Paternal allele copy
    if (rng.chance(effRate)) {
      const before = genome.paternalAlleles[i];
      const rawDelta = rng.gaussian(meanDelta, sigma);
      const after = clampTraitValue(before + rawDelta, range);
      genome.paternalAlleles[i] = after;
      mutationCount++;
      if (records !== null) {
        records.push({
          traitId: def.id,
          alleleCopy: 'paternal',
          before,
          after,
          delta: after - before,
        });
      }
    }
  }

  return { mutationCount, records: records ?? EMPTY_MUTATION_RECORDS };
}

export interface CompiledMutationPlan {
  readonly locusCount: number;
  readonly effRates: Float64Array;
  readonly sigmas: Float64Array;
  readonly meanDeltas: Float64Array;
  readonly minVals: Float64Array;
  readonly maxVals: Float64Array;
  readonly traitIds: readonly TraitId[];
}

export function compileMutationPlan(
  schema: GenomeSchema,
  ranges: Readonly<Record<string, TraitRange>>,
  config: MutationConfig
): CompiledMutationPlan {
  validateMutationConfig(config);
  const n = schema.locusCount;
  const effRates = new Float64Array(n);
  const sigmas = new Float64Array(n);
  const meanDeltas = new Float64Array(n);
  const minVals = new Float64Array(n);
  const maxVals = new Float64Array(n);
  const traitIds: TraitId[] = [];
  const biasFactor = config.directionalBias ?? 0;

  for (let i = 0; i < n; i++) {
    const def = schema.loci[i];
    const override = config.locusOverrides?.[def.id];
    const rateMul = override?.rateMultiplier ?? def.mutationRateMultiplier;
    const scaleMul = override?.scaleMultiplier ?? def.mutationScaleMultiplier;
    const effRate = Math.min(1, Math.max(0, config.baseRate * rateMul));
    const range = ranges[def.id] ?? def.defaultRange;
    const span = range.max - range.min;
    const sigma = span * config.stepScale * scaleMul;
    effRates[i] = effRate;
    sigmas[i] = sigma;
    meanDeltas[i] = biasFactor * sigma;
    minVals[i] = range.min;
    maxVals[i] = range.max;
    traitIds.push(def.id);
  }

  return {
    locusCount: n,
    effRates,
    sigmas,
    meanDeltas,
    minVals,
    maxVals,
    traitIds,
  };
}

export function mutateGenomeWithPlan(
  genome: DiploidGenome,
  plan: CompiledMutationPlan,
  rng: SeededRng,
  collectRecords = false
): MutationOutcome {
  const n = plan.locusCount;
  const effRates = plan.effRates;
  const sigmas = plan.sigmas;
  const meanDeltas = plan.meanDeltas;
  const minVals = plan.minVals;
  const maxVals = plan.maxVals;
  const mat = genome.maternalAlleles;
  const pat = genome.paternalAlleles;
  let mutationCount = 0;
  const records: MutationRecord[] | null = collectRecords ? [] : null;

  for (let i = 0; i < n; i++) {
    const effRate = effRates[i];
    if (effRate <= 0) continue;
    const sigma = sigmas[i];
    if (sigma <= 0) continue;
    const meanDelta = meanDeltas[i];
    const rMin = minVals[i];
    const rMax = maxVals[i];

    if (rng.chance(effRate)) {
      const before = mat[i];
      const v = before + rng.gaussian(meanDelta, sigma);
      const after = v < rMin ? rMin : v > rMax ? rMax : v;
      mat[i] = after;
      mutationCount++;
      if (records !== null) {
        records.push({
          traitId: plan.traitIds[i],
          alleleCopy: 'maternal',
          before,
          after,
          delta: after - before,
        });
      }
    }

    if (rng.chance(effRate)) {
      const before = pat[i];
      const v = before + rng.gaussian(meanDelta, sigma);
      const after = v < rMin ? rMin : v > rMax ? rMax : v;
      pat[i] = after;
      mutationCount++;
      if (records !== null) {
        records.push({
          traitId: plan.traitIds[i],
          alleleCopy: 'paternal',
          before,
          after,
          delta: after - before,
        });
      }
    }
  }

  return { mutationCount, records: records ?? EMPTY_MUTATION_RECORDS };
}

/**
 * Allocation-free variant of `mutateGenomeWithPlan(..., false)` for hot reproduction loops.
 */
export function mutateGenomeWithPlanCount(
  genome: DiploidGenome,
  plan: CompiledMutationPlan,
  rng: SeededRng
): number {
  const n = plan.locusCount;
  const effRates = plan.effRates;
  const sigmas = plan.sigmas;
  const meanDeltas = plan.meanDeltas;
  const minVals = plan.minVals;
  const maxVals = plan.maxVals;
  const mat = genome.maternalAlleles;
  const pat = genome.paternalAlleles;
  let mutationCount = 0;

  for (let i = 0; i < n; i++) {
    const effRate = effRates[i];
    if (effRate <= 0) continue;
    const sigma = sigmas[i];
    if (sigma <= 0) continue;
    const meanDelta = meanDeltas[i];
    const rMin = minVals[i];
    const rMax = maxVals[i];

    if (rng.chance(effRate)) {
      const v = mat[i] + rng.gaussian(meanDelta, sigma);
      mat[i] = v < rMin ? rMin : v > rMax ? rMax : v;
      mutationCount++;
    }
    if (rng.chance(effRate)) {
      const v = pat[i] + rng.gaussian(meanDelta, sigma);
      pat[i] = v < rMin ? rMin : v > rMax ? rMax : v;
      mutationCount++;
    }
  }

  return mutationCount;
}
