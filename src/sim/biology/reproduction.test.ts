import assert from 'node:assert/strict';
import test from 'node:test';
import { RngStreams, SeededRng } from '../prng';
import { WorldGrid } from '../worldGrid';
import { createDiploidGenome } from './genome';
import { createOrganism } from './organism';
import { PopulationManager } from './population';
import { areCompatibleMates, canOrganismReproduce, reproducePair } from './reproduction';
import { RAPTOR_SPECIES } from './species';

test('Reproduction & Population: enforces breeding conditions, creates mutated diploid eggs, and updates stats', () => {
  const grid = WorldGrid.generate({ width: 10, height: 10, seed: 88 });
  const pop = new PopulationManager(RAPTOR_SPECIES, grid);
  const streams = new RngStreams('repro-test', [
    'genetics',
    'mutation',
    'reproduction',
  ]);

  const gFemale = createDiploidGenome(
    RAPTOR_SPECIES.genomeSchema,
    [0.8, 0.9, 1.0, 1.1, 1.2, 0.8, 0.7, 0.5, 0.9, 0.8],
    [1.3, 1.4, 1.5, 1.3, 1.5, 1.1, 1.2, 0.9, 1.2, 1.1],
    RAPTOR_SPECIES.traitRanges
  );
  const gMale = createDiploidGenome(
    RAPTOR_SPECIES.genomeSchema,
    [0.9, 1.0, 1.2, 0.9, 1.1, 0.9, 0.8, 0.6, 1.0, 0.7],
    [1.4, 1.3, 1.6, 1.5, 1.4, 1.2, 1.3, 1.0, 1.3, 1.2],
    RAPTOR_SPECIES.traitRanges
  );

  const cellIdx = grid.toIndex(4, 4);
  const female = createOrganism({
    id: 1,
    species: RAPTOR_SPECIES,
    sex: 'female',
    x: 4,
    y: 4,
    cellIndex: cellIdx,
    birthTick: 0,
    generation: 0,
    parentAId: null,
    parentBId: null,
    genome: gFemale,
    stage: 'adult',
    energy: 0.9,
    health: 1.0,
  });
  const male = createOrganism({
    id: 2,
    species: RAPTOR_SPECIES,
    sex: 'male',
    x: 4,
    y: 4,
    cellIndex: cellIdx,
    birthTick: 0,
    generation: 0,
    parentAId: null,
    parentBId: null,
    genome: gMale,
    stage: 'adult',
    energy: 0.9,
    health: 1.0,
  });
  const juvenile = createOrganism({
    id: 3,
    species: RAPTOR_SPECIES,
    sex: 'male',
    x: 4,
    y: 4,
    cellIndex: cellIdx,
    birthTick: 0,
    generation: 0,
    parentAId: null,
    parentBId: null,
    genome: gMale,
    stage: 'juvenile',
    energy: 0.95,
    health: 1.0,
  });

  assert.equal(canOrganismReproduce(female, RAPTOR_SPECIES), true);
  assert.equal(canOrganismReproduce(juvenile, RAPTOR_SPECIES), false);
  assert.equal(areCompatibleMates(female, male, RAPTOR_SPECIES), true);
  assert.equal(areCompatibleMates(female, juvenile, RAPTOR_SPECIES), false);

  pop.addOrganism(female, true);
  pop.addOrganism(male, true);
  pop.addOrganism(juvenile, true);

  let nextId = 4;
  const res = reproducePair({
    parentA: female,
    parentB: male,
    species: RAPTOR_SPECIES,
    tick: 1,
    spawnX: 4,
    spawnY: 4,
    spawnCellIndex: cellIdx,
    nextOrganismId: () => nextId++,
    geneticsRng: streams.get('genetics'),
    mutationRng: streams.get('mutation'),
    reproductionRng: streams.get('reproduction'),
    mutationConfigOverride: { baseRate: 0.4, stepScale: 0.1, directionalBias: -0.25 },
    collectMutationRecords: true,
  });

  assert.ok(
    res.offspring.length >= RAPTOR_SPECIES.reproduction.clutchSizeMin &&
      res.offspring.length <= RAPTOR_SPECIES.reproduction.clutchSizeMax
  );
  assert.ok(female.reproductionCooldown > 0);
  assert.ok(male.reproductionCooldown > 0);
  assert.equal(canOrganismReproduce(female, RAPTOR_SPECIES), false);
  assert.ok(res.mutationRecords.length > 0, 'Expected recorded point mutations at baseRate=0.4');

  for (const child of res.offspring) {
    assert.equal(child.stage, 'egg');
    assert.equal(child.generation, 1);
    assert.equal(child.parentAId, female.id);
    assert.equal(child.parentBId, male.id);
    pop.addOrganism(child, true);
  }

  const stats = pop.computeStats(1);
  assert.equal(stats.totalAlive, 3 + res.offspring.length);
  assert.equal(stats.birthsTotal, 3 + res.offspring.length);
  assert.equal(stats.maxGeneration, 1);
  assert.equal(stats.stageCounts.egg, res.offspring.length);
  assert.equal(stats.stageCounts.adult, 2);
  assert.equal(stats.stageCounts.juvenile, 1);
  assert.ok(stats.geneticDiversity.meanHeterozygosity > 0);
  assert.ok(stats.geneticDiversity.meanNormalizedAlleleDivergence > 0);
});

test('Reproduction & Diversity: failed elder fertility check does not penalize healthy adult mate, preserves dominance diversity, and normalizes allele divergence', () => {
  const grid = WorldGrid.generate({ width: 10, height: 10, seed: 202 });
  const cellIdx = grid.toIndex(3, 3);
  const streams = new RngStreams('elder-fix', ['genetics', 'mutation', 'reproduction']);

  // Create genome with extremal dominance weights [0.0, 1.0, ...]
  const domA = new Array(10).fill(0.0);
  const domB = new Array(10).fill(1.0);
  const gA = createDiploidGenome(
    RAPTOR_SPECIES.genomeSchema,
    [0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.5, 0.5, 0.7, 0.5],
    [1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.5, 1.5, 1.4, 1.5],
    RAPTOR_SPECIES.traitRanges,
    domA
  );
  const gB = createDiploidGenome(
    RAPTOR_SPECIES.genomeSchema,
    [0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.6, 0.6, 0.8, 0.6],
    [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.6, 1.6, 1.5, 1.6],
    RAPTOR_SPECIES.traitRanges,
    domB
  );

  const elderFemale = createOrganism({
    id: 1, species: RAPTOR_SPECIES, sex: 'female', x: 3, y: 3, cellIndex: cellIdx,
    birthTick: 0, generation: 0, parentAId: null, parentBId: null, genome: gA, stage: 'elder', energy: 0.9, health: 1.0,
  });
  const primeMale = createOrganism({
    id: 2, species: RAPTOR_SPECIES, sex: 'male', x: 3, y: 3, cellIndex: cellIdx,
    birthTick: 0, generation: 0, parentAId: null, parentBId: null, genome: gB, stage: 'adult', energy: 0.9, health: 1.0,
  });
  const primeFemale = createOrganism({
    id: 3, species: RAPTOR_SPECIES, sex: 'female', x: 3, y: 3, cellIndex: cellIdx,
    birthTick: 0, generation: 0, parentAId: null, parentBId: null, genome: gA, stage: 'adult', energy: 0.9, health: 1.0,
  });

  // Deterministically find a seed whose very next chance(0.35) is false
  let failSeed = 1;
  while (new SeededRng(failSeed).chance(RAPTOR_SPECIES.reproduction.elderFertilityMultiplier)) {
    failSeed++;
  }

  let nextId = 10;
  const failedAttempt = reproducePair({
    parentA: elderFemale,
    parentB: primeMale,
    species: RAPTOR_SPECIES,
    tick: 1,
    spawnX: 3,
    spawnY: 3,
    spawnCellIndex: cellIdx,
    nextOrganismId: () => nextId++,
    geneticsRng: streams.get('genetics'),
    mutationRng: streams.get('mutation'),
    reproductionRng: new SeededRng(failSeed),
  });

  assert.equal(failedAttempt.offspring.length, 0);
  assert.ok(elderFemale.reproductionCooldown > 0, 'Elder female should receive retry cooldown');
  assert.equal(primeMale.reproductionCooldown, 0, 'Healthy prime male must NOT be penalized');
  assert.equal(canOrganismReproduce(primeMale, RAPTOR_SPECIES), true);

  // Prime female can still mate with that prime male in the very same tick
  const primeMating = reproducePair({
    parentA: primeFemale,
    parentB: primeMale,
    species: RAPTOR_SPECIES,
    tick: 1,
    spawnX: 3,
    spawnY: 3,
    spawnCellIndex: cellIdx,
    nextOrganismId: () => nextId++,
    geneticsRng: streams.get('genetics'),
    mutationRng: streams.get('mutation'),
    reproductionRng: streams.get('reproduction'),
    mutationConfigOverride: { baseRate: 0, stepScale: 0 },
  });
  assert.ok(primeMating.offspring.length >= 1);
  // Offspring dominance weights preserve extremal 0.0 / 1.0 values rather than averaging to 0.5
  for (const child of primeMating.offspring) {
    for (let i = 0; i < 10; i++) {
      const d = child.genome.dominance[i];
      assert.ok(d === 0.0 || d === 1.0, `Expected preserved dominance 0.0 or 1.0, got ${d}`);
    }
  }

  // Normalized allele divergence invariance across differently scaled traits
  const popBody = new PopulationManager(RAPTOR_SPECIES, grid);
  const popHeat = new PopulationManager(RAPTOR_SPECIES, grid);
  const bSpan = RAPTOR_SPECIES.traitRanges.bodySize.max - RAPTOR_SPECIES.traitRanges.bodySize.min;
  const hSpan = RAPTOR_SPECIES.traitRanges.heatTolerance.max - RAPTOR_SPECIES.traitRanges.heatTolerance.min;

  const matB = new Array(10).fill(1.0);
  const patB = new Array(10).fill(1.0);
  matB[0] = RAPTOR_SPECIES.traitRanges.bodySize.min;
  patB[0] = RAPTOR_SPECIES.traitRanges.bodySize.min + 0.5 * bSpan;

  const matH = new Array(10).fill(1.0);
  const patH = new Array(10).fill(1.0);
  matH[6] = RAPTOR_SPECIES.traitRanges.heatTolerance.min;
  patH[6] = RAPTOR_SPECIES.traitRanges.heatTolerance.min + 0.5 * hSpan;

  popBody.addOrganism(createOrganism({
    id: 100, species: RAPTOR_SPECIES, sex: 'female', x: 0, y: 0, cellIndex: 0,
    birthTick: 0, generation: 0, parentAId: null, parentBId: null,
    genome: createDiploidGenome(RAPTOR_SPECIES.genomeSchema, matB, patB, RAPTOR_SPECIES.traitRanges),
    stage: 'adult',
  }), 'introduced');
  popHeat.addOrganism(createOrganism({
    id: 101, species: RAPTOR_SPECIES, sex: 'female', x: 0, y: 0, cellIndex: 0,
    birthTick: 0, generation: 0, parentAId: null, parentBId: null,
    genome: createDiploidGenome(RAPTOR_SPECIES.genomeSchema, matH, patH, RAPTOR_SPECIES.traitRanges),
    stage: 'adult',
  }), 'introduced');

  const divBody = popBody.computeStats(0).geneticDiversity.meanNormalizedAlleleDivergence;
  const divHeat = popHeat.computeStats(0).geneticDiversity.meanNormalizedAlleleDivergence;
  assert.ok(Math.abs(divBody - 0.05) < 1e-5, `Expected 0.5 / 10 = 0.05, got ${divBody}`);
  assert.ok(Math.abs(divBody - divHeat) < 1e-5, `Normalized divergence must be scale-invariant (${divBody} vs ${divHeat})`);
});
