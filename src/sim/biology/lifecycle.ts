import { SeededRng } from '../prng';
import { FoodEnvironmentContext, FoodProvider } from './foodProvider';
import { GenomeSchema } from './genome';
import {
  DeathCause,
  Organism,
  OrganismDeathEvent,
  OrganismDeathListener,
  refreshOrganismPhenotype,
} from './organism';
import { validateDeathCauseStrict } from './population';
import { SpeciesDefinition, ticksToBiologicalYears } from './species';

export interface LifecycleStageTransition {
  readonly hatched: boolean;
  readonly matured: boolean;
}

export interface LifecycleStepResult {
  readonly hatched: boolean;
  readonly matured: boolean;
  readonly died: boolean;
  readonly deathCause: DeathCause;
}

export interface LifecycleStepOptions {
  readonly onDeath?: OrganismDeathListener;
}

export interface PhysiologyLocusIndices {
  readonly bodySize: number;
  readonly strength: number;
  readonly speed: number;
  readonly endurance: number;
  readonly perception: number;
  readonly intelligence: number;
  readonly heatTolerance: number;
  readonly coldTolerance: number;
  readonly metabolismEfficiency: number;
  readonly environmentalAdaptability: number;
}

const locusIndexCache = new WeakMap<GenomeSchema, PhysiologyLocusIndices>();

export function getPhysiologyIndices(schema: GenomeSchema): PhysiologyLocusIndices {
  let cached = locusIndexCache.get(schema);
  if (!cached) {
    cached = {
      bodySize: schema.tryGetIndex('bodySize'),
      strength: schema.tryGetIndex('strength'),
      speed: schema.tryGetIndex('speed'),
      endurance: schema.tryGetIndex('endurance'),
      perception: schema.tryGetIndex('perception'),
      intelligence: schema.tryGetIndex('intelligence'),
      heatTolerance: schema.tryGetIndex('heatTolerance'),
      coldTolerance: schema.tryGetIndex('coldTolerance'),
      metabolismEfficiency: schema.tryGetIndex('metabolismEfficiency'),
      environmentalAdaptability: schema.tryGetIndex('environmentalAdaptability'),
    };
    locusIndexCache.set(schema, cached);
  }
  return cached;
}

function readTraitOrDefault(values: Float32Array, index: number, fallback: number): number {
  return index >= 0 ? values[index] : fallback;
}

/**
 * Pure thermal stress calculation against an expressed trait array (safe for GATHER previews).
 */
export function computeThermalStressFromExpressed(
  ambientTemperatureC: number,
  expressed: Float32Array,
  species: SpeciesDefinition
): number {
  const idx = getPhysiologyIndices(species.genomeSchema);
  const heatTol = readTraitOrDefault(expressed, idx.heatTolerance, species.traitBaselines.heatTolerance ?? 1.0);
  const coldTol = readTraitOrDefault(expressed, idx.coldTolerance, species.traitBaselines.coldTolerance ?? 1.0);
  const adapt = readTraitOrDefault(
    expressed,
    idx.environmentalAdaptability,
    species.traitBaselines.environmentalAdaptability ?? 0.9
  );

  const { optimalTemperatureC, baseThermalHalfWidthC } = species.physiology;
  const upperLimit = optimalTemperatureC + baseThermalHalfWidthC + heatTol * 7.5 + adapt * 3.5;
  const lowerLimit = optimalTemperatureC - baseThermalHalfWidthC - coldTol * 8.0 - adapt * 3.5;

  if (ambientTemperatureC > upperLimit) {
    return (ambientTemperatureC - upperLimit) / 10;
  }
  if (ambientTemperatureC < lowerLimit) {
    return (lowerLimit - ambientTemperatureC) / 10;
  }
  return 0;
}

/**
 * Evaluates ambient thermal stress (>= 0; 0 means inside comfortable range)
 * based on species optimal temperature and expressed genetic tolerances.
 */
export function computeThermalStress(
  ambientTemperatureC: number,
  organism: Organism,
  species: SpeciesDefinition
): number {
  return computeThermalStressFromExpressed(ambientTemperatureC, organism.phenotype.expressed, species);
}

/**
 * Pure foraging power multiplier from expressed traits.
 */
export function computeForagePowerFromExpressed(
  expressed: Float32Array,
  species: SpeciesDefinition
): number {
  const idx = getPhysiologyIndices(species.genomeSchema);
  const strength = readTraitOrDefault(expressed, idx.strength, species.traitBaselines.strength ?? 1.0);
  const speed = readTraitOrDefault(expressed, idx.speed, species.traitBaselines.speed ?? 1.0);
  const perception = readTraitOrDefault(expressed, idx.perception, species.traitBaselines.perception ?? 1.0);
  const intelligence = readTraitOrDefault(expressed, idx.intelligence, species.traitBaselines.intelligence ?? 1.0);
  return 0.45 + 0.22 * speed + 0.18 * perception + 0.1 * strength + 0.08 * intelligence;
}

/**
 * Pure activity scale factor from expressed physiological & metabolic efficiency traits.
 */
export function computeActivityLevelFromExpressed(
  expressed: Float32Array,
  stage: Organism['stage'],
  species: SpeciesDefinition
): number {
  if (stage === 'egg' || stage === 'dead') return 0;
  const idx = getPhysiologyIndices(species.genomeSchema);
  const speed = readTraitOrDefault(expressed, idx.speed, species.traitBaselines.speed ?? 1.0);
  const strength = readTraitOrDefault(expressed, idx.strength, species.traitBaselines.strength ?? 1.0);
  const intelligence = readTraitOrDefault(expressed, idx.intelligence, species.traitBaselines.intelligence ?? 1.0);
  const metEff = readTraitOrDefault(
    expressed,
    idx.metabolismEfficiency,
    species.traitBaselines.metabolismEfficiency ?? 1.0
  );
  const traitDemand = 0.45 + 0.30 * speed + 0.15 * strength + 0.10 * intelligence;
  const effScale = Math.max(0.45, 0.55 + 0.45 * metEff);
  return Math.max(0, (3.8 * traitDemand) / effScale);
}

/**
 * Extracts expressed endurance trait (with baseline fallback) for allocation-free hot loops.
 */
export function getEnduranceFromExpressed(
  expressed: Float32Array,
  species: SpeciesDefinition
): number {
  const idx = getPhysiologyIndices(species.genomeSchema);
  return readTraitOrDefault(expressed, idx.endurance, species.traitBaselines.endurance ?? 1.0);
}

/**
 * Pure health transition evaluation using pre-extracted `endurance` scalar (zero TypedArray retention).
 */
export function evaluateHealthTransitionFromEndurance(
  currentHealth: number,
  postEnergy: number,
  stage: Organism['stage'],
  thermalStress: number,
  endurance: number,
  species: SpeciesDefinition
): { readonly nextHealth: number; readonly healed: boolean } {
  const phys = species.physiology;
  if (stage === 'egg') {
    let h = currentHealth;
    if (thermalStress > 0) {
      h = Math.max(0, h - thermalStress * phys.thermalDamagePerTick * 1.15);
    }
    if (postEnergy <= 0) {
      h = Math.max(0, h - phys.starvationDamagePerTick);
    }
    return { nextHealth: h, healed: false };
  }

  let healthDelta = 0;
  let healed = false;
  if (thermalStress > 0) {
    healthDelta -= thermalStress * phys.thermalDamagePerTick;
  }
  if (postEnergy <= 0) {
    const starvationMitigation = Math.max(0.65, 1.15 - 0.15 * endurance);
    healthDelta -= phys.starvationDamagePerTick * starvationMitigation;
  } else if (thermalStress === 0 && postEnergy >= 0.45 && currentHealth < 1.0) {
    healthDelta += phys.healingPerTick * (0.75 + 0.25 * endurance);
    healed = true;
  }
  return {
    nextHealth: Math.min(1.0, Math.max(0, currentHealth + healthDelta)),
    healed,
  };
}

/**
 * Pure health transition evaluation without mutating `organism`.
 * Returns `{ nextHealth, healed }` where `healed` indicates active tissue repair occurred.
 */
export function evaluateHealthTransition(
  currentHealth: number,
  postEnergy: number,
  stage: Organism['stage'],
  thermalStress: number,
  expressed: Float32Array,
  species: SpeciesDefinition
): { readonly nextHealth: number; readonly healed: boolean } {
  return evaluateHealthTransitionFromEndurance(
    currentHealth,
    postEnergy,
    stage,
    thermalStress,
    getEnduranceFromExpressed(expressed, species),
    species
  );
}

/**
 * Pure mortality evaluation without mutating `organism`.
 */
export function evaluateOrganismMortality(
  organism: Organism,
  nextAgeTicks: number,
  nextStage: Organism['stage'],
  nextHealth: number,
  nextEnergy: number,
  thermalStress: number,
  lifecycleRng: SeededRng,
  species: SpeciesDefinition
): DeathCause | null {
  if (nextStage === 'egg') {
    if (nextHealth <= 0) {
      return thermalStress > 0.25 ? 'thermal-stress' : 'incubation-failure';
    }
    return null;
  }

  if (nextHealth <= 0) {
    if (nextEnergy <= 0 && thermalStress <= 0.15) return 'starvation';
    if (thermalStress > 0.15) return 'thermal-stress';
    return 'starvation';
  }

  if (nextStage === 'elder') {
    const maxLife = computeEffectiveLifespan(organism, species);
    if (nextAgeTicks >= maxLife) {
      return 'old-age';
    }
    const elderAgeTicks = species.lifecycle.elderAgeTicks;
    const bioAge = ticksToBiologicalYears(nextAgeTicks, species);
    const elderBio = ticksToBiologicalYears(elderAgeTicks, species);
    const maxBio = ticksToBiologicalYears(maxLife, species);
    const minBioStep = 1 / species.timeScale.ticksPerBiologicalYear;
    const elderProgress = (bioAge - elderBio) / Math.max(minBioStep, maxBio - elderBio);
    const hazard = Math.min(0.35, 0.015 + elderProgress * elderProgress * 0.16);
    if (lifecycleRng.chance(hazard)) {
      return 'old-age';
    }
  }

  return null;
}

/**
 * Pure preview of chronological age, reproduction cooldown, and life-stage transitions.
 */
export function previewOrganismAgeAndStage(
  ageTicks: number,
  stage: Organism['stage'],
  reproductionCooldown: number,
  species: SpeciesDefinition
): {
  readonly nextAgeTicks: number;
  readonly nextStage: Organism['stage'];
  readonly nextCooldown: number;
  readonly hatched: boolean;
  readonly matured: boolean;
} {
  const nextAgeTicks = ageTicks + 1;
  const nextCooldown = reproductionCooldown > 0 ? reproductionCooldown - 1 : 0;
  const { incubationTicks, juvenileTicks, elderAgeTicks } = species.lifecycle;
  const maturityAge = incubationTicks + juvenileTicks;

  if (stage === 'egg' && nextAgeTicks >= incubationTicks) {
    return { nextAgeTicks, nextStage: 'juvenile', nextCooldown, hatched: true, matured: false };
  }
  if (stage === 'juvenile' && nextAgeTicks >= maturityAge) {
    return { nextAgeTicks, nextStage: 'adult', nextCooldown, hatched: false, matured: true };
  }
  if (stage === 'adult' && nextAgeTicks >= elderAgeTicks) {
    return { nextAgeTicks, nextStage: 'elder', nextCooldown, hatched: false, matured: false };
  }
  return { nextAgeTicks, nextStage: stage, nextCooldown, hatched: false, matured: false };
}

/**
 * Computes effective maximum lifespan in ticks modulated modestly by endurance & metabolism.
 */
export function computeEffectiveLifespan(organism: Organism, species: SpeciesDefinition): number {
  const idx = getPhysiologyIndices(species.genomeSchema);
  const gen = organism.phenotype.geneticExpression;
  const endurance = readTraitOrDefault(gen, idx.endurance, species.traitBaselines.endurance ?? 1.0);
  const metEff = readTraitOrDefault(gen, idx.metabolismEfficiency, species.traitBaselines.metabolismEfficiency ?? 1.0);
  const base = species.lifecycle.maxLifespanTicks;
  const modifier = 0.8 + 0.14 * endurance + 0.08 * metEff;
  return Math.max(species.lifecycle.elderAgeTicks + 5, Math.round(base * modifier));
}

function advanceAgeAndStageInternal(organism: Organism, species: SpeciesDefinition): number {
  organism.ageTicks += 1;
  if (organism.reproductionCooldown > 0) {
    organism.reproductionCooldown -= 1;
  }

  const { incubationTicks, juvenileTicks, elderAgeTicks } = species.lifecycle;
  const maturityAge = incubationTicks + juvenileTicks;

  if (organism.stage === 'egg' && organism.ageTicks >= incubationTicks) {
    organism.stage = 'juvenile';
    return 1; // hatched
  }
  if (organism.stage === 'juvenile' && organism.ageTicks >= maturityAge) {
    organism.stage = 'adult';
    return 2; // matured
  }
  if (organism.stage === 'adult' && organism.ageTicks >= elderAgeTicks) {
    organism.stage = 'elder';
  }
  return 0;
}

/**
 * Stage 1: Advances organism chronological age, reproduction cooldown, and life-stage transitions.
 */
export function stepOrganismAgeAndStage(
  organism: Organism,
  species: SpeciesDefinition
): LifecycleStageTransition {
  if (!organism.alive) {
    return { hatched: false, matured: false };
  }
  const flags = advanceAgeAndStageInternal(organism, species);
  return {
    hatched: flags === 1,
    matured: flags === 2,
  };
}

/**
 * Stage 2: Recomputes ontogenetic & condition-modulated phenotype without altering inherited genotype.
 */
export function stepOrganismPhenotype(organism: Organism, species: SpeciesDefinition): void {
  if (!organism.alive) return;
  refreshOrganismPhenotype(organism, species);
}

/**
 * Stage 3: Evaluates ambient thermal stress and applies baseline/thermoregulatory metabolic expenditure.
 * Returns normalized ambient thermal stress (>= 0) for downstream health/mortality stages.
 */
export function stepOrganismPhysiology(
  organism: Organism,
  species: SpeciesDefinition,
  env: FoodEnvironmentContext
): number {
  if (!organism.alive) {
    return 0;
  }
  const thermalStress = computeThermalStress(env.temperature, organism, species);
  const phys = species.physiology;

  if (organism.stage === 'egg') {
    const eggCost = phys.eggIncubationCostPerTick + thermalStress * 0.015;
    organism.energy = Math.max(0, organism.energy - eggCost);
    return thermalStress;
  }

  const idx = getPhysiologyIndices(species.genomeSchema);
  const exp = organism.phenotype.expressed;
  const bodySize = readTraitOrDefault(exp, idx.bodySize, species.traitBaselines.bodySize ?? 1.0);
  const strength = readTraitOrDefault(exp, idx.strength, species.traitBaselines.strength ?? 1.0);
  const speed = readTraitOrDefault(exp, idx.speed, species.traitBaselines.speed ?? 1.0);
  const intelligence = readTraitOrDefault(exp, idx.intelligence, species.traitBaselines.intelligence ?? 1.0);
  const metEff = readTraitOrDefault(
    exp,
    idx.metabolismEfficiency,
    species.traitBaselines.metabolismEfficiency ?? 1.0
  );

  const demandScale = 0.45 + 0.35 * bodySize + 0.12 * speed + 0.08 * strength + 0.05 * intelligence;
  const effScale = Math.max(0.45, 0.55 + 0.45 * metEff);
  const metabolicCost = phys.baseMetabolicCostPerTick * (demandScale / effScale) + thermalStress * 0.016;

  organism.energy -= metabolicCost;
  if (organism.energy < 0) organism.energy = 0;

  return thermalStress;
}

/**
 * Stage 4: Executes feeding via the decoupled `FoodProvider` and returns obtained energy units.
 */
export function stepOrganismForaging(
  organism: Organism,
  species: SpeciesDefinition,
  env: FoodEnvironmentContext,
  foodProvider: FoodProvider
): number {
  if (!organism.alive || organism.stage === 'egg') {
    return 0;
  }
  if (organism.energy >= 0.96) {
    return 0;
  }

  const idx = getPhysiologyIndices(species.genomeSchema);
  const exp = organism.phenotype.expressed;
  const strength = readTraitOrDefault(exp, idx.strength, species.traitBaselines.strength ?? 1.0);
  const speed = readTraitOrDefault(exp, idx.speed, species.traitBaselines.speed ?? 1.0);
  const perception = readTraitOrDefault(exp, idx.perception, species.traitBaselines.perception ?? 1.0);
  const intelligence = readTraitOrDefault(exp, idx.intelligence, species.traitBaselines.intelligence ?? 1.0);

  const foragePower = 0.45 + 0.22 * speed + 0.18 * perception + 0.1 * strength + 0.08 * intelligence;
  const hungerGap = 1.0 - organism.energy;
  const requested = Math.min(hungerGap, species.physiology.maxForageIntakePerTick * foragePower);
  if (requested <= 0) {
    return 0;
  }

  const gained = foodProvider.consumePrey(env, requested);
  if (gained > 0) {
    organism.energy = Math.min(1.0, organism.energy + gained);
  }
  return gained;
}

/**
 * Stage 5: Applies thermal stress damage, starvation damage, or natural healing to organism health.
 */
export function stepOrganismHealth(
  organism: Organism,
  species: SpeciesDefinition,
  thermalStress: number
): number {
  if (!organism.alive) {
    return organism.health;
  }
  const phys = species.physiology;

  if (organism.stage === 'egg') {
    if (thermalStress > 0) {
      organism.health = Math.max(0, organism.health - thermalStress * phys.thermalDamagePerTick * 1.15);
    }
    if (organism.energy <= 0) {
      organism.health = Math.max(0, organism.health - phys.starvationDamagePerTick);
    }
    return organism.health;
  }

  const idx = getPhysiologyIndices(species.genomeSchema);
  const endurance = readTraitOrDefault(
    organism.phenotype.expressed,
    idx.endurance,
    species.traitBaselines.endurance ?? 1.0
  );

  let healthDelta = 0;
  if (thermalStress > 0) {
    healthDelta -= thermalStress * phys.thermalDamagePerTick;
  }
  if (organism.energy <= 0) {
    const starvationMitigation = Math.max(0.65, 1.15 - 0.15 * endurance);
    healthDelta -= phys.starvationDamagePerTick * starvationMitigation;
  } else if (thermalStress === 0 && organism.energy >= 0.45 && organism.health < 1.0) {
    healthDelta += phys.healingPerTick * (0.75 + 0.25 * endurance);
  }

  organism.health = Math.min(1.0, Math.max(0, organism.health + healthDelta));
  return organism.health;
}

/**
 * Atomically transitions a living organism to `'dead'` and emits a single immutable `OrganismDeathEvent`.
 * Returns `null` if the organism is already dead, guaranteeing one-time death registration.
 */
export function processOrganismDeath(
  organism: Organism,
  tick: number,
  cause: DeathCause,
  killerId: number | null = null,
  onDeath?: OrganismDeathListener
): OrganismDeathEvent | null {
  if (!organism.alive) {
    return null;
  }
  const resolvedCause = validateDeathCauseStrict(cause);
  const stageAtDeath = organism.stage === 'dead' ? 'adult' : organism.stage;

  organism.alive = false;
  organism.stage = 'dead';
  organism.health = 0;
  organism.deathTick = tick;
  organism.deathCause = resolvedCause;

  const event: OrganismDeathEvent = Object.freeze({
    organismId: organism.id,
    speciesId: organism.speciesId,
    cause: resolvedCause,
    tick,
    killerId,
    cellIndex: organism.cellIndex,
    x: organism.x,
    y: organism.y,
    stageAtDeath,
  });
  if (onDeath) {
    onDeath(event);
  }
  return event;
}

/**
 * Stage 6: Evaluates physiological and senescence mortality conditions and processes death if triggered.
 */
export function stepOrganismDeath(
  organism: Organism,
  species: SpeciesDefinition,
  thermalStress: number,
  lifecycleRng: SeededRng,
  tick: number,
  onDeath?: OrganismDeathListener
): OrganismDeathEvent | null {
  if (!organism.alive) {
    return null;
  }

  if (organism.stage === 'egg') {
    if (organism.health <= 0) {
      return processOrganismDeath(
        organism,
        tick,
        thermalStress > 0.25 ? 'thermal-stress' : 'incubation-failure',
        null,
        onDeath
      );
    }
    return null;
  }

  if (organism.health <= 0) {
    const cause: DeathCause =
      organism.energy <= 0 && thermalStress <= 0.15
        ? 'starvation'
        : thermalStress > 0.15
          ? 'thermal-stress'
          : 'starvation';
    return processOrganismDeath(organism, tick, cause, null, onDeath);
  }

  // Natural senescence mortality in elder stage using biological years
  if (organism.stage === 'elder') {
    const maxLife = computeEffectiveLifespan(organism, species);
    if (organism.ageTicks >= maxLife) {
      return processOrganismDeath(organism, tick, 'old-age', null, onDeath);
    }
    const elderAgeTicks = species.lifecycle.elderAgeTicks;
    const bioAge = ticksToBiologicalYears(organism.ageTicks, species);
    const elderBio = ticksToBiologicalYears(elderAgeTicks, species);
    const maxBio = ticksToBiologicalYears(maxLife, species);
    const minBioStep = 1 / species.timeScale.ticksPerBiologicalYear;
    const elderProgress = (bioAge - elderBio) / Math.max(minBioStep, maxBio - elderBio);
    const hazard = Math.min(0.35, 0.015 + elderProgress * elderProgress * 0.16);
    if (lifecycleRng.chance(hazard)) {
      return processOrganismDeath(organism, tick, 'old-age', null, onDeath);
    }
  }

  return null;
}

/**
 * Advances one organism by one simulation tick across 6 decoupled stages
 * while preserving the exact historical execution order and numerical formulas:
 * 1. Age & developmental stage transitions
 * 2. Ontogenetic phenotype update
 * 3. Physiology & metabolic expenditure
 * 4. Foraging via `FoodProvider`
 * 5. Health update
 * 6. Mortality check & death event processing
 */
export function stepOrganismLifecycle(
  organism: Organism,
  species: SpeciesDefinition,
  env: FoodEnvironmentContext,
  foodProvider: FoodProvider,
  lifecycleRng: SeededRng,
  tick: number,
  options?: LifecycleStepOptions
): LifecycleStepResult {
  if (!organism.alive) {
    return { hatched: false, matured: false, died: false, deathCause: organism.deathCause };
  }

  // 1. Age & stage
  const stageFlags = advanceAgeAndStageInternal(organism, species);
  const hatched = stageFlags === 1;
  const matured = stageFlags === 2;

  // 2. Phenotype
  stepOrganismPhenotype(organism, species);

  // 3. Physiology & metabolism
  const thermalStress = stepOrganismPhysiology(organism, species, env);

  // 4. Food acquisition via FoodProvider
  if (organism.stage !== 'egg') {
    stepOrganismForaging(organism, species, env, foodProvider);
  }

  // 5. Health dynamics
  stepOrganismHealth(organism, species, thermalStress);

  // 6. Mortality evaluation & death handling
  const deathEvent = stepOrganismDeath(
    organism,
    species,
    thermalStress,
    lifecycleRng,
    tick,
    options?.onDeath
  );
  if (deathEvent !== null) {
    return { hatched, matured, died: true, deathCause: deathEvent.cause };
  }

  return { hatched, matured, died: false, deathCause: 'none' };
}
