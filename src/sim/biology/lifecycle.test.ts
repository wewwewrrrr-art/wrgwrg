import assert from 'node:assert/strict';
import test from 'node:test';
import { SeededRng } from '../prng';
import { WorldGrid } from '../worldGrid';
import { DeterministicPreyFoodProvider, FoodEnvironmentContext } from './foodProvider';
import { CORE_GENOME_SCHEMA, createIndividualGenome } from './genome';
import {
  processOrganismDeath,
  stepOrganismAgeAndStage,
  stepOrganismDeath,
  stepOrganismForaging,
  stepOrganismHealth,
  stepOrganismLifecycle,
  stepOrganismPhenotype,
  stepOrganismPhysiology,
} from './lifecycle';
import { OrganismDeathEvent, createOrganism, getOrganismPhenotypeTrait } from './organism';
import { RAPTOR_SPECIES } from './species';

test('Lifecycle: progresses cleanly from egg -> incubation -> hatchling juvenile -> adult -> elder -> natural death', () => {
  const grid = WorldGrid.generate({ width: 12, height: 10, seed: 501 });
  const food = new DeterministicPreyFoodProvider(grid, { seed: 501, regenerationRate: 1.0 });
  food.setUniformPrey(grid, 2.0, 2.0);

  const genRng = new SeededRng(501);
  const lifeRng = new SeededRng(502);

  // Pick a land cell
  let landIdx = -1;
  for (let i = 0; i < grid.cellCount; i++) {
    const c = grid.getCellByIndex(i);
    if (c.terrain !== 'deep-water' && c.terrain !== 'shallow-water') {
      landIdx = i;
      break;
    }
  }
  assert.ok(landIdx >= 0);
  const { x, y } = grid.fromIndex(landIdx);

  const genome = createIndividualGenome(
    RAPTOR_SPECIES.genomeSchema,
    RAPTOR_SPECIES.traitBaselines,
    RAPTOR_SPECIES.traitRanges,
    0, // exact baseline
    genRng
  );
  const org = createOrganism({
    id: 1,
    species: RAPTOR_SPECIES,
    sex: 'female',
    x,
    y,
    cellIndex: landIdx,
    birthTick: 0,
    generation: 0,
    parentAId: null,
    parentBId: null,
    genome,
    stage: 'egg',
    energy: RAPTOR_SPECIES.reproduction.eggInitialEnergy,
  });

  const env: FoodEnvironmentContext = {
    cellIndex: landIdx,
    x,
    y,
    terrain: 'lowland',
    biome: 'savanna',
    temperature: RAPTOR_SPECIES.physiology.optimalTemperatureC,
    moisture: 0.5,
    tick: 0,
  };

  assert.equal(org.stage, 'egg');
  const eggSize = getOrganismPhenotypeTrait(org, RAPTOR_SPECIES, 'bodySize');

  let hatchedAt = -1;
  let maturedAt = -1;
  let elderAt = -1;
  let diedAt = -1;

  for (let t = 1; t <= 300; t++) {
    food.stepTick(t);
    const res = stepOrganismLifecycle(
      org,
      RAPTOR_SPECIES,
      { ...env, tick: t },
      food,
      lifeRng,
      t
    );
    const currentStage: string = org.stage;
    if (res.hatched) hatchedAt = t;
    if (res.matured) maturedAt = t;
    if (currentStage === 'elder' && elderAt === -1) elderAt = t;
    if (res.died) {
      diedAt = t;
      assert.equal(org.deathCause, 'old-age');
      break;
    }
  }

  assert.equal(hatchedAt, RAPTOR_SPECIES.lifecycle.incubationTicks);
  assert.equal(
    maturedAt,
    RAPTOR_SPECIES.lifecycle.incubationTicks + RAPTOR_SPECIES.lifecycle.juvenileTicks
  );
  assert.equal(elderAt, RAPTOR_SPECIES.lifecycle.elderAgeTicks);
  assert.ok(diedAt >= RAPTOR_SPECIES.lifecycle.elderAgeTicks && diedAt <= 260);
  assert.equal(org.alive, false);
  assert.equal(org.stage, 'dead');

  // Genotype never mutated during aging, while egg phenotype was smaller than baseline
  assert.ok(eggSize < RAPTOR_SPECIES.traitBaselines.bodySize * 0.5);
  assert.equal(
    org.phenotype.geneticExpression[CORE_GENOME_SCHEMA.getIndex('bodySize')],
    RAPTOR_SPECIES.traitBaselines.bodySize
  );
});

test('Lifecycle: starvation and thermal stress mortality + prey provider does not use WorldGrid biomass', () => {
  const grid = WorldGrid.generate({ width: 10, height: 8, seed: 300 });
  const food = new DeterministicPreyFoodProvider(grid, { regenerationRate: 0 });
  // Zero prey everywhere even though WorldGrid land cells have plant biomass > 0
  food.setUniformPrey(grid, 0, 0);

  let landIdx = -1;
  for (let i = 0; i < grid.cellCount; i++) {
    const c = grid.getCellByIndex(i);
    if (c.terrain !== 'deep-water' && c.terrain !== 'shallow-water' && c.biomass > 0.1) {
      landIdx = i;
      break;
    }
  }
  assert.ok(landIdx >= 0, 'Expected land cell with vegetation biomass > 0.1');
  const { x, y } = grid.fromIndex(landIdx);

  const genome = createIndividualGenome(
    RAPTOR_SPECIES.genomeSchema,
    RAPTOR_SPECIES.traitBaselines,
    RAPTOR_SPECIES.traitRanges,
    0,
    new SeededRng(300)
  );
  const hungry = createOrganism({
    id: 10,
    species: RAPTOR_SPECIES,
    sex: 'male',
    x,
    y,
    cellIndex: landIdx,
    birthTick: 0,
    generation: 0,
    parentAId: null,
    parentBId: null,
    genome,
    stage: 'adult',
    energy: 0.25,
    health: 1.0,
  });

  const lifeRng = new SeededRng(301);
  const biomassBefore = grid.biomass[landIdx];

  for (let t = 1; t <= 80; t++) {
    const res = stepOrganismLifecycle(
      hungry,
      RAPTOR_SPECIES,
      {
        cellIndex: landIdx,
        x,
        y,
        terrain: 'lowland',
        biome: 'savanna',
        temperature: 24,
        moisture: 0.5,
        tick: t,
      },
      food,
      lifeRng,
      t
    );
    if (res.died) break;
  }

  assert.equal(hungry.alive, false);
  assert.equal(hungry.deathCause, 'starvation');
  assert.equal(grid.biomass[landIdx], biomassBefore, 'Predator starvation must not consume WorldGrid plant biomass');
});

test('TimeScale & SpeciesRegistry: enforces unified 50 ticks/bio-year, biological age conversion, custom schemas, and parameter validation', async () => {
  const {
    GenomeSchema,
    CORE_GENE_DEFINITIONS,
  } = await import('./genome');
  const {
    describeOrganism,
    getOrganismBiologicalAgeYears,
  } = await import('./organism');
  const {
    SpeciesRegistry,
    WORLD_TICKS_PER_BIOLOGICAL_YEAR,
    biologicalYearsToTicks,
    ticksToBiologicalYears,
  } = await import('./species');

  assert.equal(WORLD_TICKS_PER_BIOLOGICAL_YEAR, 50);
  assert.equal(RAPTOR_SPECIES.timeScale.ticksPerBiologicalYear, 50);
  assert.equal(ticksToBiologicalYears(50, RAPTOR_SPECIES), 1);
  assert.equal(biologicalYearsToTicks(2.6, RAPTOR_SPECIES), 130);

  const grid = WorldGrid.generate({ width: 6, height: 6, seed: 71 });
  const genome = createIndividualGenome(
    RAPTOR_SPECIES.genomeSchema,
    RAPTOR_SPECIES.traitBaselines,
    RAPTOR_SPECIES.traitRanges,
    0,
    new SeededRng(71)
  );
  const org = createOrganism({
    id: 50,
    species: RAPTOR_SPECIES,
    sex: 'female',
    x: 1,
    y: 1,
    cellIndex: grid.toIndex(1, 1),
    birthTick: 0,
    generation: 0,
    parentAId: null,
    parentBId: null,
    genome,
    stage: 'elder',
    ageTicks: 150,
  });
  assert.equal(getOrganismBiologicalAgeYears(org, RAPTOR_SPECIES), 3.0);
  assert.equal(describeOrganism(org, RAPTOR_SPECIES).ageBioYears, 3.0);

  const registry = new SpeciesRegistry();
  registry.register(RAPTOR_SPECIES);

  // Reject mismatched world time scale (e.g. legacy 100 ticks/bio-year)
  assert.throws(
    () =>
      registry.register({
        ...RAPTOR_SPECIES,
        id: 'bad-timescale',
        timeScale: { ticksPerBiologicalYear: 100, tickUnitLabel: 'bad' },
      }),
    RangeError
  );

  // Reject negative lifecycle/reproduction/time parameters and invalid clutch ranges
  assert.throws(
    () =>
      registry.register({
        ...RAPTOR_SPECIES,
        id: 'bad-lifecycle-neg',
        lifecycle: { ...RAPTOR_SPECIES.lifecycle, incubationTicks: -1 },
      }),
    RangeError
  );
  assert.throws(
    () =>
      registry.register({
        ...RAPTOR_SPECIES,
        id: 'bad-lifecycle-order',
        lifecycle: { ...RAPTOR_SPECIES.lifecycle, elderAgeTicks: 20 },
      }),
    RangeError
  );
  assert.throws(
    () =>
      registry.register({
        ...RAPTOR_SPECIES,
        id: 'bad-clutch',
        reproduction: { ...RAPTOR_SPECIES.reproduction, clutchSizeMin: 4, clutchSizeMax: 2 },
      }),
    RangeError
  );
  assert.throws(
    () =>
      registry.register({
        ...RAPTOR_SPECIES,
        id: 'bad-range',
        traitRanges: { ...RAPTOR_SPECIES.traitRanges, speed: { min: 2.0, max: 1.0 } },
      }),
    RangeError
  );

  // Reject schema missing required physiological locus AT REGISTRATION TIME
  const reducedSchema = new GenomeSchema('missing-strength', [CORE_GENE_DEFINITIONS[0]]);
  assert.throws(
    () =>
      registry.register({
        ...RAPTOR_SPECIES,
        id: 'missing-trait-species',
        genomeSchema: reducedSchema,
      }),
    RangeError
  );

  // Accept extended schema via GenomeSchema.extend AND accept custom reduced schema with explicit requiredTraits contract
  const extendedSchema = CORE_GENOME_SCHEMA.extend('raptor-plus', [
    {
      id: 'camouflage',
      label: 'Camouflage',
      defaultRange: { min: 0, max: 1 },
      defaultDominance: 0.5,
      mutationRateMultiplier: 1.0,
      mutationScaleMultiplier: 1.0,
    },
  ]);
  registry.register({
    ...RAPTOR_SPECIES,
    id: 'camo-raptor',
    genomeSchema: extendedSchema,
    traitBaselines: { ...RAPTOR_SPECIES.traitBaselines, camouflage: 0.5 },
    traitRanges: { ...RAPTOR_SPECIES.traitRanges, camouflage: { min: 0, max: 1 } },
  });
  assert.equal(registry.has('camo-raptor'), true);

  const minimalCustom = {
    ...RAPTOR_SPECIES,
    id: 'minimal-custom',
    genomeSchema: reducedSchema,
    requiredTraits: ['bodySize'],
    traitBaselines: { bodySize: 1.0 },
    traitRanges: { bodySize: { min: 0.4, max: 2.0 } },
  };
  registry.register(minimalCustom);
  const customOrg = createOrganism({
    id: 51,
    species: minimalCustom,
    sex: 'male',
    x: 1,
    y: 1,
    cellIndex: grid.toIndex(1, 1),
    birthTick: 0,
    generation: 0,
    parentAId: null,
    parentBId: null,
    genome: createIndividualGenome(reducedSchema, minimalCustom.traitBaselines, minimalCustom.traitRanges, 0, new SeededRng(5)),
    stage: 'adult',
  });
  const food = new DeterministicPreyFoodProvider(grid);
  const stepRes = stepOrganismLifecycle(
    customOrg,
    minimalCustom,
    { cellIndex: 0, x: 0, y: 0, terrain: 'lowland', biome: 'savanna', temperature: 24, moisture: 0.5, tick: 1 },
    food,
    new SeededRng(9),
    1
  );
  assert.equal(stepRes.died, false);
});

test('Lifecycle stages: decomposed 6-stage pipeline matches stepOrganismLifecycle bit-for-bit', () => {
  const gridA = WorldGrid.generate({ width: 10, height: 10, seed: 'stage-split' });
  const gridB = WorldGrid.generate({ width: 10, height: 10, seed: 'stage-split' });
  const foodA = new DeterministicPreyFoodProvider(gridA, { seed: 'fp', regenerationRate: 0.35 });
  const foodB = new DeterministicPreyFoodProvider(gridB, { seed: 'fp', regenerationRate: 0.35 });
  foodA.setUniformPrey(gridA, 0.9, 0.9);
  foodB.setUniformPrey(gridB, 0.9, 0.9);

  let landIdx = -1;
  for (let i = 0; i < gridA.cellCount; i++) {
    const c = gridA.getCellByIndex(i);
    if (c.terrain !== 'deep-water' && c.terrain !== 'shallow-water') {
      landIdx = i;
      break;
    }
  }
  assert.ok(landIdx >= 0);
  const { x, y } = gridA.fromIndex(landIdx);

  const genomeA = createIndividualGenome(
    RAPTOR_SPECIES.genomeSchema,
    RAPTOR_SPECIES.traitBaselines,
    RAPTOR_SPECIES.traitRanges,
    0.2,
    new SeededRng(42)
  );
  const genomeB = createIndividualGenome(
    RAPTOR_SPECIES.genomeSchema,
    RAPTOR_SPECIES.traitBaselines,
    RAPTOR_SPECIES.traitRanges,
    0.2,
    new SeededRng(42)
  );

  const orgComposite = createOrganism({
    id: 1,
    species: RAPTOR_SPECIES,
    sex: 'female',
    x,
    y,
    cellIndex: landIdx,
    birthTick: 0,
    generation: 0,
    parentAId: null,
    parentBId: null,
    genome: genomeA,
    stage: 'egg',
  });
  const orgManual = createOrganism({
    id: 1,
    species: RAPTOR_SPECIES,
    sex: 'female',
    x,
    y,
    cellIndex: landIdx,
    birthTick: 0,
    generation: 0,
    parentAId: null,
    parentBId: null,
    genome: genomeB,
    stage: 'egg',
  });

  const rngComposite = new SeededRng(777);
  const rngManual = new SeededRng(777);
  const compositeEvents: OrganismDeathEvent[] = [];
  const manualEvents: OrganismDeathEvent[] = [];

  for (let t = 1; t <= 280; t++) {
    foodA.stepTick(t);
    foodB.stepTick(t);
    const env: FoodEnvironmentContext = {
      cellIndex: landIdx,
      x,
      y,
      terrain: 'lowland',
      biome: 'savanna',
      temperature: t % 40 < 10 ? 41 : 25,
      moisture: 0.5,
      tick: t,
    };

    const resA = stepOrganismLifecycle(orgComposite, RAPTOR_SPECIES, env, foodA, rngComposite, t, {
      onDeath: (ev) => compositeEvents.push(ev),
    });

    const stageRes = stepOrganismAgeAndStage(orgManual, RAPTOR_SPECIES);
    stepOrganismPhenotype(orgManual, RAPTOR_SPECIES);
    const thermalStress = stepOrganismPhysiology(orgManual, RAPTOR_SPECIES, env);
    if (orgManual.stage !== 'egg') {
      stepOrganismForaging(orgManual, RAPTOR_SPECIES, env, foodB);
    }
    stepOrganismHealth(orgManual, RAPTOR_SPECIES, thermalStress);
    const deathB = stepOrganismDeath(orgManual, RAPTOR_SPECIES, thermalStress, rngManual, t, (ev) =>
      manualEvents.push(ev)
    );

    assert.equal(resA.hatched, stageRes.hatched);
    assert.equal(resA.matured, stageRes.matured);
    assert.equal(resA.died, deathB !== null);
    assert.equal(orgComposite.ageTicks, orgManual.ageTicks);
    assert.equal(orgComposite.stage, orgManual.stage);
    assert.equal(orgComposite.energy, orgManual.energy);
    assert.equal(orgComposite.health, orgManual.health);
    assert.equal(orgComposite.alive, orgManual.alive);
    assert.equal(orgComposite.deathCause, orgManual.deathCause);
    assert.deepEqual(orgComposite.phenotype.expressed, orgManual.phenotype.expressed);

    if (resA.died) break;
  }

  assert.equal(compositeEvents.length, 1);
  assert.deepEqual(compositeEvents, manualEvents);
  assert.equal(rngComposite.getState(), rngManual.getState());
});

test('Lifecycle death handling: supports future causes, killerId, validation, and single-registration idempotency', () => {
  const grid = WorldGrid.generate({ width: 6, height: 6, seed: 'death-events' });
  const genome = createIndividualGenome(
    RAPTOR_SPECIES.genomeSchema,
    RAPTOR_SPECIES.traitBaselines,
    RAPTOR_SPECIES.traitRanges,
    0,
    new SeededRng(12)
  );
  const prey = createOrganism({
    id: 99,
    species: RAPTOR_SPECIES,
    sex: 'male',
    x: 2,
    y: 3,
    cellIndex: grid.toIndex(2, 3),
    birthTick: 1,
    generation: 1,
    parentAId: 1,
    parentBId: 2,
    genome,
    stage: 'juvenile',
  });

  assert.throws(() => processOrganismDeath(prey, 15, ''), RangeError);
  assert.throws(() => processOrganismDeath(prey, 15, '   '), RangeError);
  assert.equal(prey.alive, true);

  const emitted: OrganismDeathEvent[] = [];
  const evt1 = processOrganismDeath(prey, 20, 'predation', 44, (ev) => emitted.push(ev));
  assert.ok(evt1 !== null);
  assert.equal(evt1.organismId, 99);
  assert.equal(evt1.speciesId, 'raptor');
  assert.equal(evt1.cause, 'predation');
  assert.equal(evt1.tick, 20);
  assert.equal(evt1.killerId, 44);
  assert.equal(evt1.stageAtDeath, 'juvenile');
  assert.equal(prey.alive, false);
  assert.equal(prey.stage, 'dead');
  assert.equal(prey.deathTick, 20);
  assert.equal(prey.deathCause, 'predation');

  // Re-invoking death on already-dead organism must be a no-op with zero duplicate events
  const evt2 = processOrganismDeath(prey, 21, 'disease', 77, (ev) => emitted.push(ev));
  assert.equal(evt2, null);
  assert.equal(emitted.length, 1);

  // Extensible future ecological causes work without modifying closed enums
  const other = createOrganism({
    id: 100,
    species: RAPTOR_SPECIES,
    sex: 'female',
    x: 1,
    y: 1,
    cellIndex: grid.toIndex(1, 1),
    birthTick: 1,
    generation: 1,
    parentAId: null,
    parentBId: null,
    genome,
    stage: 'adult',
  });
  const evtInjury = processOrganismDeath(other, 25, 'injury', null);
  assert.equal(evtInjury?.cause, 'injury');

  const third = createOrganism({
    id: 101,
    species: RAPTOR_SPECIES,
    sex: 'female',
    x: 1,
    y: 1,
    cellIndex: grid.toIndex(1, 1),
    birthTick: 1,
    generation: 1,
    parentAId: null,
    parentBId: null,
    genome,
    stage: 'adult',
  });
  const evtDisease = processOrganismDeath(third, 26, 'disease');
  assert.equal(evtDisease?.cause, 'disease');

  const fourth = createOrganism({
    id: 102,
    species: RAPTOR_SPECIES,
    sex: 'male',
    x: 1,
    y: 1,
    cellIndex: grid.toIndex(1, 1),
    birthTick: 1,
    generation: 1,
    parentAId: null,
    parentBId: null,
    genome,
    stage: 'adult',
  });
  const evtCustom = processOrganismDeath(fourth, 27, 'parasitic-blight');
  assert.equal(evtCustom?.cause, 'parasitic-blight');

  // Reject leading/trailing whitespace in DeathCause without mutating living organism
  const fifth = createOrganism({
    id: 103,
    species: RAPTOR_SPECIES,
    sex: 'male',
    x: 1,
    y: 1,
    cellIndex: grid.toIndex(1, 1),
    birthTick: 1,
    generation: 1,
    parentAId: null,
    parentBId: null,
    genome,
    stage: 'adult',
  });
  assert.throws(() => processOrganismDeath(fifth, 28, ' predation'), RangeError);
  assert.throws(() => processOrganismDeath(fifth, 28, 'predation '), RangeError);
  assert.throws(() => processOrganismDeath(fifth, 28, '\tpredation\n'), RangeError);
  assert.equal(fifth.alive, true);
  assert.equal(fifth.stage, 'adult');
});

test('Lifecycle stages: all 6 public pipeline stages are strict no-ops on dead organisms', () => {
  const grid = WorldGrid.generate({ width: 8, height: 8, seed: 'dead-guard' });
  const food = new DeterministicPreyFoodProvider(grid, { seed: 'dead-guard', regenerationRate: 0.5 });
  food.setUniformPrey(grid, 2.0, 2.0);

  const cellIndex = grid.toIndex(2, 2);
  const env: FoodEnvironmentContext = {
    cellIndex,
    x: 2,
    y: 2,
    terrain: 'lowland',
    biome: 'savanna',
    temperature: 58, // lethal heat if processed
    moisture: 0.2,
    tick: 10,
  };
  const genome = createIndividualGenome(
    RAPTOR_SPECIES.genomeSchema,
    RAPTOR_SPECIES.traitBaselines,
    RAPTOR_SPECIES.traitRanges,
    0,
    new SeededRng(33)
  );

  for (const initialStage of ['egg', 'adult'] as const) {
    const org = createOrganism({
      id: initialStage === 'egg' ? 201 : 202,
      species: RAPTOR_SPECIES,
      sex: 'female',
      x: 2,
      y: 2,
      cellIndex,
      birthTick: 1,
      generation: 1,
      parentAId: null,
      parentBId: null,
      genome,
      stage: initialStage,
      ageTicks: initialStage === 'egg' ? 2 : 140,
      health: 0.4,
      energy: 0.3,
      reproductionCooldown: 3,
    });

    const death = processOrganismDeath(org, 9, 'injury', 1);
    assert.ok(death !== null);
    // Preserve snapshot after death (health=0, stage='dead', alive=false)
    const energyBefore = org.energy;
    const ageBefore = org.ageTicks;
    const cooldownBefore = org.reproductionCooldown;
    const expressedBefore = Array.from(org.phenotype.expressed);
    const preyBefore = food.getAvailablePrey(env);

    const rng = new SeededRng(999);
    const rngStateBefore = rng.getState();
    const emitted: OrganismDeathEvent[] = [];

    assert.deepEqual(stepOrganismAgeAndStage(org, RAPTOR_SPECIES), { hatched: false, matured: false });
    stepOrganismPhenotype(org, RAPTOR_SPECIES);
    assert.equal(stepOrganismPhysiology(org, RAPTOR_SPECIES, env), 0);
    assert.equal(stepOrganismForaging(org, RAPTOR_SPECIES, env, food), 0);
    assert.equal(stepOrganismHealth(org, RAPTOR_SPECIES, 2.5), org.health);
    assert.equal(
      stepOrganismDeath(org, RAPTOR_SPECIES, 2.5, rng, 10, (ev) => emitted.push(ev)),
      null
    );

    assert.equal(org.alive, false);
    assert.equal(org.stage, 'dead');
    assert.equal(org.health, 0);
    assert.equal(org.energy, energyBefore);
    assert.equal(org.ageTicks, ageBefore);
    assert.equal(org.reproductionCooldown, cooldownBefore);
    assert.equal(org.deathTick, 9);
    assert.equal(org.deathCause, 'injury');
    assert.deepEqual(Array.from(org.phenotype.expressed), expressedBefore);
    assert.equal(food.getAvailablePrey(env), preyBefore);
    assert.equal(rng.getState(), rngStateBefore);
    assert.equal(emitted.length, 0);
  }
});


