import { SeededRng } from '../prng';
import {
  DiploidGenome,
  PhenotypeProfile,
  TraitId,
  computePhenotype,
  createIndividualGenome,
  genomeToSnapshot,
  getTraitFromArray,
  traitArrayToRecord,
} from './genome';
import { SpeciesDefinition, ticksToBiologicalYears } from './species';

export type Sex = 'female' | 'male';

export type LifeStage = 'egg' | 'juvenile' | 'adult' | 'elder' | 'dead';

export const CORE_DEATH_CAUSES = [
  'none',
  'old-age',
  'starvation',
  'thermal-stress',
  'incubation-failure',
  'predation',
  'injury',
  'disease',
] as const;

export type CoreDeathCause = (typeof CORE_DEATH_CAUSES)[number];

/**
 * Extensible death cause identifier preserving compatibility with all built-in causes
 * while allowing future ecological death causes (`predation`, `injury`, `disease`, etc.)
 * without modifying a closed type union.
 */
export type DeathCause = CoreDeathCause | (string & {});

export function assertValidDeathCause(cause: DeathCause): DeathCause {
  if (typeof cause !== 'string' || !cause.trim()) {
    throw new RangeError(`DeathCause must be a non-empty string, received: "${cause}"`);
  }
  return cause;
}

export interface OrganismDeathEvent {
  readonly organismId: number;
  readonly speciesId: string;
  readonly cause: DeathCause;
  readonly tick: number;
  readonly killerId: number | null;
  readonly cellIndex: number;
  readonly x: number;
  readonly y: number;
  readonly stageAtDeath: Exclude<LifeStage, 'dead'>;
}

export type OrganismDeathListener = (event: OrganismDeathEvent) => void;

export interface Organism {
  readonly id: number;
  readonly speciesId: string;
  readonly sex: Sex;
  readonly generation: number;
  readonly parentAId: number | null;
  readonly parentBId: number | null;
  readonly birthTick: number;
  /** Immutable inherited diploid genotype */
  readonly genome: DiploidGenome;
  /** Recomputed expressed phenotype (strictly separate from genotype) */
  phenotype: PhenotypeProfile;

  x: number;
  y: number;
  cellIndex: number;

  ageTicks: number;
  stage: LifeStage;
  health: number;
  energy: number;
  alive: boolean;
  deathTick: number | null;
  deathCause: DeathCause;

  reproductionCooldown: number;
  offspringCount: number;
  mutationsReceived: number;
}

export interface CreateOrganismParams {
  readonly id: number;
  readonly species: SpeciesDefinition;
  readonly sex: Sex;
  readonly x: number;
  readonly y: number;
  readonly cellIndex: number;
  readonly birthTick: number;
  readonly generation: number;
  readonly parentAId: number | null;
  readonly parentBId: number | null;
  readonly genome: DiploidGenome;
  readonly stage: Exclude<LifeStage, 'dead'>;
  readonly ageTicks?: number;
  readonly health?: number;
  readonly energy?: number;
  readonly reproductionCooldown?: number;
  readonly mutationsReceived?: number;
  readonly skipInitialPhenotype?: boolean;
}

export function getOrganismBiologicalAgeYears(
  organism: Organism,
  species: SpeciesDefinition
): number {
  return ticksToBiologicalYears(organism.ageTicks, species);
}

export interface DevelopmentalScaleTarget {
  physicalMaturityScale: number;
  neuralMaturityScale: number;
  senescencePhysicalScale: number;
}

export function computeDevelopmentalScaleInto(
  ageTicks: number,
  stage: LifeStage,
  species: SpeciesDefinition,
  out: DevelopmentalScaleTarget
): DevelopmentalScaleTarget {
  if (stage === 'egg') {
    out.physicalMaturityScale = 0.15;
    out.neuralMaturityScale = 0.15;
    out.senescencePhysicalScale = 1.0;
    return out;
  }
  const { incubationTicks, juvenileTicks, elderAgeTicks, maxLifespanTicks, hatchlingPhysicalScale } =
    species.lifecycle;

  const tpy = species.timeScale.ticksPerBiologicalYear;
  const bioAge = ageTicks / tpy;
  const incubationBio = incubationTicks / tpy;
  const maturityBio = (incubationTicks + juvenileTicks) / tpy;
  const elderBio = elderAgeTicks / tpy;
  const maxBio = maxLifespanTicks / tpy;

  if (stage === 'juvenile') {
    const juvenileBioSpan = maturityBio - incubationBio;
    const t = juvenileBioSpan > 0 ? Math.min(1, Math.max(0, (bioAge - incubationBio) / juvenileBioSpan)) : 1;
    out.physicalMaturityScale = hatchlingPhysicalScale + (1 - hatchlingPhysicalScale) * t;
    out.neuralMaturityScale = 0.45 + 0.55 * t;
    out.senescencePhysicalScale = 1.0;
    return out;
  }

  if (stage === 'elder') {
    const minStep = 1 / tpy;
    const elderBioSpan = Math.max(minStep, maxBio - elderBio);
    const t = Math.min(1, Math.max(0, (bioAge - elderBio) / elderBioSpan));
    out.physicalMaturityScale = 1.0;
    out.neuralMaturityScale = 1.0;
    out.senescencePhysicalScale = 1.0 - 0.18 * t;
    return out;
  }

  // Adult prime (gracefully handles manually spawned sub-maturity adults)
  if (bioAge < maturityBio && maturityBio > 0) {
    const t = Math.max(0, bioAge / maturityBio);
    out.physicalMaturityScale = hatchlingPhysicalScale + (1 - hatchlingPhysicalScale) * t;
    out.neuralMaturityScale = 0.45 + 0.55 * t;
    out.senescencePhysicalScale = 1.0;
    return out;
  }
  out.physicalMaturityScale = 1.0;
  out.neuralMaturityScale = 1.0;
  out.senescencePhysicalScale = 1.0;
  return out;
}

export function computeDevelopmentalScale(
  ageTicks: number,
  stage: LifeStage,
  species: SpeciesDefinition
): {
  physicalMaturityScale: number;
  neuralMaturityScale: number;
  senescencePhysicalScale: number;
} {
  const out = {
    physicalMaturityScale: 1.0,
    neuralMaturityScale: 1.0,
    senescencePhysicalScale: 1.0,
  };
  return computeDevelopmentalScaleInto(ageTicks, stage, species, out);
}

const refreshScratchContext = {
  physicalMaturityScale: 1.0,
  neuralMaturityScale: 1.0,
  senescencePhysicalScale: 1.0,
  conditionScale: 1.0,
};

export function refreshOrganismPhenotype(organism: Organism, species: SpeciesDefinition): void {
  computeDevelopmentalScaleInto(organism.ageTicks, organism.stage, species, refreshScratchContext);
  refreshScratchContext.conditionScale =
    0.45 + 0.55 * Math.min(1, Math.max(0, organism.health * 0.65 + organism.energy * 0.35));
  computePhenotype(
    organism.genome,
    species.genomeSchema,
    refreshScratchContext,
    organism.phenotype
  );
}

export function createOrganism(params: CreateOrganismParams): Organism {
  const stage = params.stage;
  const { incubationTicks, juvenileTicks, elderAgeTicks } = params.species.lifecycle;
  let defaultAge = 0;
  if (stage === 'juvenile') defaultAge = incubationTicks;
  else if (stage === 'adult') defaultAge = incubationTicks + juvenileTicks;
  else if (stage === 'elder') defaultAge = elderAgeTicks;

  const ageTicks = params.ageTicks ?? defaultAge;
  const health = params.health ?? 1.0;
  const energy =
    params.energy ??
    (stage === 'egg' ? params.species.reproduction.eggInitialEnergy : 0.78);

  let phenotype: PhenotypeProfile;
  if (params.skipInitialPhenotype) {
    const schema = params.species.genomeSchema;
    const n = schema.locusCount;
    phenotype = {
      schemaId: schema.id,
      geneticExpression: new Float32Array(n),
      expressed: new Float32Array(n),
    };
  } else {
    computeDevelopmentalScaleInto(ageTicks, stage, params.species, refreshScratchContext);
    refreshScratchContext.conditionScale =
      0.45 + 0.55 * Math.min(1, Math.max(0, health * 0.65 + energy * 0.35));
    phenotype = computePhenotype(params.genome, params.species.genomeSchema, refreshScratchContext);
  }

  return {
    id: params.id,
    speciesId: params.species.id,
    sex: params.sex,
    generation: params.generation,
    parentAId: params.parentAId,
    parentBId: params.parentBId,
    birthTick: params.birthTick,
    genome: params.genome,
    phenotype,
    x: params.x,
    y: params.y,
    cellIndex: params.cellIndex,
    ageTicks,
    stage,
    health,
    energy,
    alive: true,
    deathTick: null,
    deathCause: 'none',
    reproductionCooldown: params.reproductionCooldown ?? 0,
    offspringCount: 0,
    mutationsReceived: params.mutationsReceived ?? 0,
  };
}

export function createFounderOrganism(
  id: number,
  species: SpeciesDefinition,
  x: number,
  y: number,
  cellIndex: number,
  birthTick: number,
  rng: SeededRng,
  stage: Exclude<LifeStage, 'dead'> = 'adult',
  sex?: Sex
): Organism {
  const genome = createIndividualGenome(
    species.genomeSchema,
    species.traitBaselines,
    species.traitRanges,
    species.initialGeneticSpread,
    rng
  );
  const resolvedSex: Sex = sex ?? (rng.chance(species.reproduction.femaleProbability) ? 'female' : 'male');

  // Slight deterministic age variation among adult founders so cohorts are realistic
  let ageTicks: number | undefined;
  if (stage === 'adult') {
    const minAdult = species.lifecycle.incubationTicks + species.lifecycle.juvenileTicks;
    const maxFounderAge = Math.max(minAdult, species.lifecycle.elderAgeTicks - 15);
    ageTicks = rng.nextInt(minAdult, maxFounderAge);
  }

  return createOrganism({
    id,
    species,
    sex: resolvedSex,
    x,
    y,
    cellIndex,
    birthTick,
    generation: 0,
    parentAId: null,
    parentBId: null,
    genome,
    stage,
    ageTicks,
  });
}

export function getOrganismGeneticTrait(
  organism: Organism,
  species: SpeciesDefinition,
  traitId: TraitId
): number {
  return getTraitFromArray(organism.phenotype.geneticExpression, species.genomeSchema, traitId);
}

export function getOrganismPhenotypeTrait(
  organism: Organism,
  species: SpeciesDefinition,
  traitId: TraitId
): number {
  return getTraitFromArray(organism.phenotype.expressed, species.genomeSchema, traitId);
}

export function describeOrganism(organism: Organism, species: SpeciesDefinition) {
  return {
    id: organism.id,
    speciesId: organism.speciesId,
    sex: organism.sex,
    generation: organism.generation,
    stage: organism.stage,
    alive: organism.alive,
    ageTicks: organism.ageTicks,
    ageBioYears: ticksToBiologicalYears(organism.ageTicks, species),
    health: organism.health,
    energy: organism.energy,
    position: { x: organism.x, y: organism.y, cellIndex: organism.cellIndex },
    parents: { a: organism.parentAId, b: organism.parentBId },
    offspringCount: organism.offspringCount,
    mutationsReceived: organism.mutationsReceived,
    deathCause: organism.deathCause,
    genotype: genomeToSnapshot(organism.genome, species.genomeSchema),
    phenotype: traitArrayToRecord(organism.phenotype.expressed, species.genomeSchema),
  };
}
