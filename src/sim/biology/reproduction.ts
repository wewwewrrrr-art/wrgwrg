import { SeededRng } from '../prng';
import { createHaploidGamete } from './genome';
import { MutationConfig, MutationRecord, mutateGenome, validateMutationConfig } from './mutation';
import { Organism, Sex, createOrganism } from './organism';
import { SpeciesDefinition } from './species';

export interface ReproductionRequest {
  readonly parentA: Organism;
  readonly parentB: Organism;
  readonly species: SpeciesDefinition;
  readonly tick: number;
  readonly spawnX: number;
  readonly spawnY: number;
  readonly spawnCellIndex: number;
  readonly nextOrganismId: () => number;
  readonly geneticsRng: SeededRng;
  readonly mutationRng: SeededRng;
  readonly reproductionRng: SeededRng;
  readonly mutationConfigOverride?: MutationConfig;
  readonly collectMutationRecords?: boolean;
  readonly skipMutationValidation?: boolean;
}

export interface ReproductionResult {
  readonly offspring: Organism[];
  readonly mutationRecords: MutationRecord[];
  readonly mutationRecordsByOffspring: MutationRecord[][];
}

const EMPTY_OFFSPRING: Organism[] = Object.freeze([]) as unknown as Organism[];
const EMPTY_RECORDS: MutationRecord[] = Object.freeze([]) as unknown as MutationRecord[];
const EMPTY_RECORDS_BY_OFFSPRING: MutationRecord[][] = Object.freeze([]) as unknown as MutationRecord[][];

export function canOrganismReproduce(organism: Organism, species: SpeciesDefinition): boolean {
  if (!organism.alive) return false;
  if (organism.stage !== 'adult' && organism.stage !== 'elder') return false;
  if (organism.reproductionCooldown > 0) return false;
  const cfg = species.reproduction;
  if (organism.energy < cfg.minEnergyToReproduce) return false;
  if (organism.health < cfg.minHealthToReproduce) return false;
  return true;
}

export function areCompatibleMates(
  a: Organism,
  b: Organism,
  species: SpeciesDefinition
): boolean {
  if (a.id === b.id) return false;
  if (a.speciesId !== species.id || b.speciesId !== species.id) return false;
  if (a.sex === b.sex) return false;
  return canOrganismReproduce(a, species) && canOrganismReproduce(b, species);
}

export interface ReproductionDraft {
  readonly status: 'ok' | 'elder-miss' | 'zero-clutch';
  readonly parentACooldown: number;
  readonly parentBCooldown: number;
  readonly parentAEnergy: number;
  readonly parentBEnergy: number;
  readonly clutchSize: number;
  readonly offspring: Organism[];
  readonly mutationRecords: MutationRecord[];
  readonly mutationRecordsByOffspring: MutationRecord[][];
}

export interface PlanReproductionOptions {
  /** Skip checking live `parentA/parentB` fields when caller already evaluated projected post-lifecycle state. */
  readonly skipEligibilityCheck?: boolean;
  /** Projected life stage of parentA after current tick aging (defaults to `parentA.stage`). */
  readonly parentAStage?: Organism['stage'];
  /** Projected life stage of parentB after current tick aging (defaults to `parentB.stage`). */
  readonly parentBStage?: Organism['stage'];
  /** Projected energy of parentA before reproduction (defaults to `parentA.energy`). */
  readonly parentAEnergy?: number;
  /** Projected energy of parentB before reproduction (defaults to `parentB.energy`). */
  readonly parentBEnergy?: number;
  /** Projected cooldown of parentA before reproduction (defaults to `parentA.reproductionCooldown`). */
  readonly parentACooldown?: number;
  /** Projected cooldown of parentB before reproduction (defaults to `parentB.reproductionCooldown`). */
  readonly parentBCurrentCooldown?: number;
  /** Override initial normalized egg energy (defaults to `species.reproduction.eggInitialEnergy`). */
  readonly eggInitialEnergy?: number;
}

/**
 * Pure non-mutating planner for sexual diploid reproduction.
 * Does NOT mutate `parentA` or `parentB` (`reproductionCooldown`, `energy`, `offspringCount`);
 * caller applies the returned draft exclusively during atomic `COMMIT`.
 */
export function planReproductionPair(
  req: ReproductionRequest,
  options: PlanReproductionOptions = {}
): ReproductionDraft {
  const {
    parentA,
    parentB,
    species,
    tick,
    spawnX,
    spawnY,
    spawnCellIndex,
    nextOrganismId,
    geneticsRng,
    mutationRng,
    reproductionRng,
    mutationConfigOverride,
    collectMutationRecords = false,
    skipMutationValidation = false,
  } = req;

  if (!options.skipEligibilityCheck && !areCompatibleMates(parentA, parentB, species)) {
    throw new RangeError(
      `Organisms ${parentA.id} and ${parentB.id} are not eligible/compatible mates for species "${species.id}"`
    );
  }

  const stageA = options.parentAStage ?? parentA.stage;
  const stageB = options.parentBStage ?? parentB.stage;
  const energyA = options.parentAEnergy ?? parentA.energy;
  const energyB = options.parentBEnergy ?? parentB.energy;
  const cooldownA = options.parentACooldown ?? parentA.reproductionCooldown;
  const cooldownB = options.parentBCurrentCooldown ?? parentB.reproductionCooldown;

  const rep = species.reproduction;
  const schema = species.genomeSchema;
  const mutationCfg = mutationConfigOverride ?? species.mutation;

  // Elder fertility taper check: apply retry cooldown ONLY to elder parent(s) in the draft
  if (
    (stageA === 'elder' || stageB === 'elder') &&
    !reproductionRng.chance(rep.elderFertilityMultiplier)
  ) {
    const elderCooldown = Math.max(2, Math.floor(rep.cooldownTicks * 0.25));
    return {
      status: 'elder-miss',
      parentACooldown: stageA === 'elder' ? elderCooldown : cooldownA,
      parentBCooldown: stageB === 'elder' ? elderCooldown : cooldownB,
      parentAEnergy: energyA,
      parentBEnergy: energyB,
      clutchSize: 0,
      offspring: EMPTY_OFFSPRING,
      mutationRecords: EMPTY_RECORDS,
      mutationRecordsByOffspring: EMPTY_RECORDS_BY_OFFSPRING,
    };
  }

  if (!skipMutationValidation) {
    validateMutationConfig(mutationCfg);
  }

  const clutchSize =
    rep.clutchSizeMin === rep.clutchSizeMax
      ? rep.clutchSizeMin
      : reproductionRng.nextInt(rep.clutchSizeMin, rep.clutchSizeMax);

  const nextEnergyA = Math.max(0, energyA - rep.parentEnergyCost);
  const nextEnergyB = Math.max(0, energyB - rep.parentEnergyCost);

  if (clutchSize <= 0) {
    return {
      status: 'zero-clutch',
      parentACooldown: rep.cooldownTicks,
      parentBCooldown: rep.cooldownTicks,
      parentAEnergy: nextEnergyA,
      parentBEnergy: nextEnergyB,
      clutchSize: 0,
      offspring: EMPTY_OFFSPRING,
      mutationRecords: EMPTY_RECORDS,
      mutationRecordsByOffspring: EMPTY_RECORDS_BY_OFFSPRING,
    };
  }

  const offspring: Organism[] = [];
  const mutationRecords: MutationRecord[] = collectMutationRecords ? [] : EMPTY_RECORDS;
  const mutationRecordsByOffspring: MutationRecord[][] = collectMutationRecords ? [] : EMPTY_RECORDS_BY_OFFSPRING;
  const childGeneration = Math.max(parentA.generation, parentB.generation) + 1;
  const eggEnergy = options.eggInitialEnergy ?? rep.eggInitialEnergy;

  for (let c = 0; c < clutchSize; c++) {
    const maternalGamete = createHaploidGamete(parentA.genome, schema, geneticsRng);
    const paternalGamete = createHaploidGamete(parentB.genome, schema, geneticsRng);
    const dominance = new Float32Array(schema.locusCount);
    for (let i = 0; i < schema.locusCount; i++) {
      const dA = parentA.genome.dominance[i];
      const dB = parentB.genome.dominance[i];
      dominance[i] = dA === dB ? dA : geneticsRng.chance(0.5) ? dA : dB;
    }

    const childGenome = {
      schemaId: schema.id,
      maternalAlleles: maternalGamete,
      paternalAlleles: paternalGamete,
      dominance,
    };

    const mutOutcome = mutateGenome(
      childGenome,
      schema,
      species.traitRanges,
      mutationCfg,
      mutationRng,
      collectMutationRecords,
      true
    );
    if (collectMutationRecords) {
      mutationRecordsByOffspring.push(mutOutcome.records);
      if (mutOutcome.records.length > 0) {
        mutationRecords.push(...mutOutcome.records);
      }
    }

    const sex: Sex = reproductionRng.chance(rep.femaleProbability) ? 'female' : 'male';
    const child = createOrganism({
      id: nextOrganismId(),
      species,
      sex,
      x: spawnX,
      y: spawnY,
      cellIndex: spawnCellIndex,
      birthTick: tick,
      generation: childGeneration,
      parentAId: parentA.id,
      parentBId: parentB.id,
      genome: childGenome,
      stage: 'egg',
      ageTicks: 0,
      health: 1.0,
      energy: eggEnergy,
      mutationsReceived: mutOutcome.mutationCount,
    });

    offspring.push(child);
  }

  return {
    status: 'ok',
    parentACooldown: rep.cooldownTicks,
    parentBCooldown: rep.cooldownTicks,
    parentAEnergy: nextEnergyA,
    parentBEnergy: nextEnergyB,
    clutchSize,
    offspring,
    mutationRecords,
    mutationRecordsByOffspring,
  };
}

/**
 * Executes sexual diploid reproduction between two compatible parents:
 * - forms independent haploid gametes from each parent via locus assortment
 * - segregates locus expression weights discretely from parents (avoiding blending collapse)
 * - applies configurable point mutations via `mutationRng`
 * - creates individual offspring in the `'egg'` stage with distinct sex and generation
 */
export function reproducePair(req: ReproductionRequest): ReproductionResult {
  const draft = planReproductionPair(req);
  const { parentA, parentB } = req;

  parentA.reproductionCooldown = draft.parentACooldown;
  parentB.reproductionCooldown = draft.parentBCooldown;
  parentA.energy = draft.parentAEnergy;
  parentB.energy = draft.parentBEnergy;
  if (draft.offspring.length > 0) {
    parentA.offspringCount += draft.offspring.length;
    parentB.offspringCount += draft.offspring.length;
  }

  return {
    offspring: draft.offspring,
    mutationRecords: draft.mutationRecords,
    mutationRecordsByOffspring: draft.mutationRecordsByOffspring,
  };
}
