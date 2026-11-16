import { SeededRng } from '../prng';

/**
 * Core heritable genetic trait identifiers shared across all biological species.
 * The schema architecture allows species or future modules to append additional
 * loci dynamically without altering core inheritance or mutation algorithms.
 */
export const CORE_TRAIT_IDS = [
  'bodySize',
  'strength',
  'speed',
  'endurance',
  'perception',
  'intelligence',
  'heatTolerance',
  'coldTolerance',
  'metabolismEfficiency',
  'environmentalAdaptability',
] as const;

export type CoreTraitId = (typeof CORE_TRAIT_IDS)[number];
export type TraitId = CoreTraitId | (string & {});

export interface TraitRange {
  readonly min: number;
  readonly max: number;
}

export interface GeneDefinition {
  readonly id: TraitId;
  readonly label: string;
  readonly defaultRange: TraitRange;
  /**
   * Locus expression blend weight in `[0, 1]` used to interpolate between the
   * lower and higher quantitative allele values `(min, max)` at a diploid locus:
   * - `0.5`: additive codominant midpoint `(a + b) / 2` (default)
   * - `1.0`: higher-value allele expression `max(a, b)`
   * - `0.0`: lower-value allele expression `min(a, b)`
   * Note: this is a quantitative locus-level blend weight, not classical allele-specific dominance.
   */
  readonly defaultDominance: number;
  readonly mutationRateMultiplier: number;
  readonly mutationScaleMultiplier: number;
}

export const CORE_GENE_DEFINITIONS: readonly GeneDefinition[] = [
  {
    id: 'bodySize',
    label: 'Body Size',
    defaultRange: { min: 0.1, max: 3.0 },
    defaultDominance: 0.5,
    mutationRateMultiplier: 1.0,
    mutationScaleMultiplier: 1.0,
  },
  {
    id: 'strength',
    label: 'Physical Strength',
    defaultRange: { min: 0.05, max: 3.0 },
    defaultDominance: 0.5,
    mutationRateMultiplier: 1.0,
    mutationScaleMultiplier: 1.0,
  },
  {
    id: 'speed',
    label: 'Movement Speed',
    defaultRange: { min: 0.05, max: 3.0 },
    defaultDominance: 0.5,
    mutationRateMultiplier: 1.0,
    mutationScaleMultiplier: 1.0,
  },
  {
    id: 'endurance',
    label: 'Endurance',
    defaultRange: { min: 0.05, max: 3.0 },
    defaultDominance: 0.5,
    mutationRateMultiplier: 1.0,
    mutationScaleMultiplier: 1.0,
  },
  {
    id: 'perception',
    label: 'Vision & Perception',
    defaultRange: { min: 0.05, max: 3.0 },
    defaultDominance: 0.5,
    mutationRateMultiplier: 1.0,
    mutationScaleMultiplier: 1.0,
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    defaultRange: { min: 0.01, max: 3.0 },
    defaultDominance: 0.5,
    mutationRateMultiplier: 0.9,
    mutationScaleMultiplier: 0.9,
  },
  {
    id: 'heatTolerance',
    label: 'Heat Tolerance',
    defaultRange: { min: 0.0, max: 2.5 },
    defaultDominance: 0.5,
    mutationRateMultiplier: 1.0,
    mutationScaleMultiplier: 1.0,
  },
  {
    id: 'coldTolerance',
    label: 'Cold Tolerance',
    defaultRange: { min: 0.0, max: 2.5 },
    defaultDominance: 0.5,
    mutationRateMultiplier: 1.0,
    mutationScaleMultiplier: 1.0,
  },
  {
    id: 'metabolismEfficiency',
    label: 'Metabolic Efficiency',
    defaultRange: { min: 0.1, max: 2.5 },
    defaultDominance: 0.5,
    mutationRateMultiplier: 1.0,
    mutationScaleMultiplier: 1.0,
  },
  {
    id: 'environmentalAdaptability',
    label: 'Environmental Adaptability',
    defaultRange: { min: 0.0, max: 2.5 },
    defaultDominance: 0.5,
    mutationRateMultiplier: 1.0,
    mutationScaleMultiplier: 1.0,
  },
];

export class GenomeSchema {
  public readonly id: string;
  public readonly loci: readonly GeneDefinition[];
  public readonly locusCount: number;
  /** 0 = physical, 1 = neural, 2 = tolerance/metabolic (precomputed for allocation-free computePhenotype) */
  public readonly traitModKind: Uint8Array;
  private readonly indexById = new Map<string, number>();

  constructor(id: string, loci: readonly GeneDefinition[]) {
    if (!id.trim()) {
      throw new RangeError('GenomeSchema id must be non-empty');
    }
    if (loci.length === 0) {
      throw new RangeError('GenomeSchema must contain at least one gene locus');
    }
    const modKinds = new Uint8Array(loci.length);
    for (let i = 0; i < loci.length; i++) {
      const def = loci[i];
      if (!def.id.trim()) {
        throw new RangeError(`Gene locus at index ${i} must have a non-empty id`);
      }
      if (this.indexById.has(def.id)) {
        throw new RangeError(`Duplicate gene locus id in schema "${id}": ${def.id}`);
      }
      if (
        !Number.isFinite(def.defaultRange.min) ||
        !Number.isFinite(def.defaultRange.max) ||
        def.defaultRange.max < def.defaultRange.min
      ) {
        throw new RangeError(`Invalid defaultRange for gene "${def.id}"`);
      }
      if (!Number.isFinite(def.defaultDominance) || def.defaultDominance < 0 || def.defaultDominance > 1) {
        throw new RangeError(`Invalid defaultDominance for gene "${def.id}": ${def.defaultDominance}`);
      }
      this.indexById.set(def.id, i);
      const idStr = def.id;
      if (idStr === 'bodySize' || idStr === 'strength' || idStr === 'speed' || idStr === 'endurance') {
        modKinds[i] = 0;
      } else if (idStr === 'perception' || idStr === 'intelligence') {
        modKinds[i] = 1;
      } else {
        modKinds[i] = 2;
      }
    }
    this.id = id;
    this.loci = loci.slice();
    this.locusCount = loci.length;
    this.traitModKind = modKinds;
  }

  getIndex(traitId: TraitId): number {
    const idx = this.indexById.get(traitId);
    if (idx === undefined) {
      throw new RangeError(`Unknown trait id "${traitId}" in schema "${this.id}"`);
    }
    return idx;
  }

  tryGetIndex(traitId: TraitId): number {
    return this.indexById.get(traitId) ?? -1;
  }

  hasTrait(traitId: TraitId): boolean {
    return this.indexById.has(traitId);
  }

  /**
   * Produces a new schema extending this schema with additional gene loci.
   */
  extend(newSchemaId: string, extraLoci: readonly GeneDefinition[]): GenomeSchema {
    return new GenomeSchema(newSchemaId, [...this.loci, ...extraLoci]);
  }
}

export const CORE_GENOME_SCHEMA = new GenomeSchema('core-v1', CORE_GENE_DEFINITIONS);

/**
 * Pure diploid genotype storing two inherited allele copies per locus
 * (`maternalAlleles` and `paternalAlleles`) plus heritable locus expression
 * blend weights (`dominance`). Strictly separate from expressed phenotype values.
 */
export interface DiploidGenome {
  readonly schemaId: string;
  readonly maternalAlleles: Float32Array;
  readonly paternalAlleles: Float32Array;
  readonly dominance: Float32Array;
}

/**
 * Expressed biological phenotype computed from genotype, developmental stage,
 * and current physiological condition. Does not mutate the inherited genotype.
 */
export interface PhenotypeProfile {
  readonly schemaId: string;
  /** Genetic baseline expression from diploid alleles before ontogenetic/condition scaling */
  readonly geneticExpression: Float32Array;
  /** Actual currently manifested organism traits */
  readonly expressed: Float32Array;
}

export function clampTraitValue(value: number, range: TraitRange): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Trait value must be finite, received: ${value}`);
  }
  return value < range.min ? range.min : value > range.max ? range.max : value;
}

/**
 * Resolves a diploid quantitative allele pair `(a, b)` into an expressed genetic value
 * using locus expression blend weight `h` in `[0, 1]` between `min(a, b)` and `max(a, b)`.
 * At `h = 0.5`, this equals exact additive codominance `(a + b) * 0.5`.
 */
export function expressDiploidLocus(alleleA: number, alleleB: number, dominance = 0.5): number {
  const low = alleleA <= alleleB ? alleleA : alleleB;
  const high = alleleA <= alleleB ? alleleB : alleleA;
  return low + (high - low) * dominance;
}

export function createDiploidGenome(
  schema: GenomeSchema,
  maternal: ArrayLike<number>,
  paternal: ArrayLike<number>,
  ranges?: Readonly<Record<string, TraitRange>>,
  dominanceOverrides?: ArrayLike<number>
): DiploidGenome {
  const n = schema.locusCount;
  if (maternal.length !== n || paternal.length !== n) {
    throw new RangeError(
      `Allele array length mismatch for schema "${schema.id}": expected ${n}, got (${maternal.length}, ${paternal.length})`
    );
  }
  const maternalAlleles = new Float32Array(n);
  const paternalAlleles = new Float32Array(n);
  const dominance = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const def = schema.loci[i];
    const range = ranges?.[def.id] ?? def.defaultRange;
    maternalAlleles[i] = clampTraitValue(maternal[i], range);
    paternalAlleles[i] = clampTraitValue(paternal[i], range);
    const dom = dominanceOverrides ? dominanceOverrides[i] : def.defaultDominance;
    if (!Number.isFinite(dom) || dom < 0 || dom > 1) {
      throw new RangeError(`Invalid dominance at locus ${def.id}: ${dom}`);
    }
    dominance[i] = dom;
  }

  return {
    schemaId: schema.id,
    maternalAlleles,
    paternalAlleles,
    dominance,
  };
}

export function createIndividualGenome(
  schema: GenomeSchema,
  baselines: Readonly<Record<string, number>>,
  ranges: Readonly<Record<string, TraitRange>>,
  initialSpread: number,
  rng: SeededRng
): DiploidGenome {
  if (!Number.isFinite(initialSpread) || initialSpread < 0) {
    throw new RangeError(`initialSpread must be finite and >= 0, received: ${initialSpread}`);
  }
  const n = schema.locusCount;
  const maternalAlleles = new Float32Array(n);
  const paternalAlleles = new Float32Array(n);
  const dominance = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const def = schema.loci[i];
    const range = ranges[def.id] ?? def.defaultRange;
    const base = baselines[def.id] ?? (range.min + range.max) * 0.5;
    const span = range.max - range.min;
    const stdDev = span * initialSpread;

    const a = stdDev > 0 ? rng.gaussian(base, stdDev) : base;
    const b = stdDev > 0 ? rng.gaussian(base, stdDev) : base;

    maternalAlleles[i] = clampTraitValue(a, range);
    paternalAlleles[i] = clampTraitValue(b, range);
    dominance[i] = def.defaultDominance;
  }

  return {
    schemaId: schema.id,
    maternalAlleles,
    paternalAlleles,
    dominance,
  };
}

export function cloneGenome(genome: DiploidGenome): DiploidGenome {
  return {
    schemaId: genome.schemaId,
    maternalAlleles: new Float32Array(genome.maternalAlleles),
    paternalAlleles: new Float32Array(genome.paternalAlleles),
    dominance: new Float32Array(genome.dominance),
  };
}

/**
 * Generates a haploid gamete from a diploid parent via independent assortment
 * across every locus (`50%` maternal copy, `50%` paternal copy per locus).
 */
export function createHaploidGamete(
  parentGenome: DiploidGenome,
  schema: GenomeSchema,
  rng: SeededRng,
  targetOut?: Float32Array
): Float32Array {
  const n = schema.locusCount;
  const gamete = targetOut ?? new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gamete[i] = rng.chance(0.5)
      ? parentGenome.maternalAlleles[i]
      : parentGenome.paternalAlleles[i];
  }
  return gamete;
}

export interface PhenotypeDevelopmentContext {
  /** Developmental physical scale factor in (0, 1.05] (eggs ~0.15, juveniles ramp 0.35..1.0, adults 1.0) */
  readonly physicalMaturityScale: number;
  /** Cognitive/sensory maturity factor in (0, 1.0] */
  readonly neuralMaturityScale: number;
  /** Senescence multiplier on physical traits (1.0 in prime adult, slightly lower in late elder) */
  readonly senescencePhysicalScale: number;
  /** Current physiological condition multiplier from health/energy in [0.4, 1.0] */
  readonly conditionScale: number;
}

/**
 * Computes expressed phenotype from diploid genotype without mutating the genotype.
 */
export function computePhenotype(
  genome: DiploidGenome,
  schema: GenomeSchema,
  ctx: PhenotypeDevelopmentContext,
  target?: PhenotypeProfile
): PhenotypeProfile {
  const n = schema.locusCount;
  const geneticExpression = target?.geneticExpression ?? new Float32Array(n);
  const expressed = target?.expressed ?? new Float32Array(n);
  const maternal = genome.maternalAlleles;
  const paternal = genome.paternalAlleles;
  const dom = genome.dominance;
  const modKinds = schema.traitModKind;

  const physScale = ctx.physicalMaturityScale;
  const condScale = ctx.conditionScale;
  const modPhys = physScale * ctx.senescencePhysicalScale * condScale;
  const modNeur = ctx.neuralMaturityScale * (0.75 + 0.25 * condScale);
  const modOther = (0.65 + 0.35 * physScale) * (0.85 + 0.15 * condScale);

  for (let i = 0; i < n; i++) {
    const a = maternal[i];
    const b = paternal[i];
    const low = a <= b ? a : b;
    const high = a <= b ? b : a;
    const genVal = low + (high - low) * dom[i];
    geneticExpression[i] = genVal;
    const kind = modKinds[i];
    const mod = kind === 0 ? modPhys : kind === 1 ? modNeur : modOther;
    expressed[i] = genVal * mod;
  }

  if (target) {
    return target;
  }
  return {
    schemaId: schema.id,
    geneticExpression,
    expressed,
  };
}

export function getTraitFromArray(
  values: Float32Array,
  schema: GenomeSchema,
  traitId: TraitId
): number {
  return values[schema.getIndex(traitId)];
}

export function traitArrayToRecord(
  values: Float32Array,
  schema: GenomeSchema
): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < schema.locusCount; i++) {
    out[schema.loci[i].id] = values[i];
  }
  return out;
}

export function genomeToSnapshot(
  genome: DiploidGenome,
  schema: GenomeSchema
): Record<string, { maternal: number; paternal: number; dominance: number; midpoint: number }> {
  const out: Record<string, { maternal: number; paternal: number; dominance: number; midpoint: number }> = {};
  for (let i = 0; i < schema.locusCount; i++) {
    const m = genome.maternalAlleles[i];
    const p = genome.paternalAlleles[i];
    const d = genome.dominance[i];
    out[schema.loci[i].id] = {
      maternal: m,
      paternal: p,
      dominance: d,
      midpoint: expressDiploidLocus(m, p, d),
    };
  }
  return out;
}
