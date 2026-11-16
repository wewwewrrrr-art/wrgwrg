import assert from 'node:assert/strict';
import test from 'node:test';
import { PostingBuffer } from '../energyTransaction';
import { EnergyPool } from '../worldEnergyGrid';
import { WorldGrid } from '../worldGrid';
import {
  BiologySimulation,
  RAPTOR_SPECIES,
  SpeciesDefinition,
  SpeciesRegistry,
} from './index';

function makeP4Species(
  id: string,
  diet: SpeciesDefinition['diet'],
  weights: { plant: number; prey: number; carrion: number; detritus: number },
  massMU: number,
  opts?: {
    cooldown?: number;
    incubation?: number;
    juvenile?: number;
    lifespan?: number;
    elder?: number;
    clutchMin?: number;
    clutchMax?: number;
    minEnergy?: number;
    basal?: number;
  }
): SpeciesDefinition {
  return {
    ...RAPTOR_SPECIES,
    id,
    name: id,
    diet,
    lifecycle: {
      ...RAPTOR_SPECIES.lifecycle,
      incubationTicks: opts?.incubation ?? 4,
      juvenileTicks: opts?.juvenile ?? 8,
      elderAgeTicks: opts?.elder ?? 80,
      maxLifespanTicks: opts?.lifespan ?? 120,
    },
    reproduction: {
      ...RAPTOR_SPECIES.reproduction,
      cooldownTicks: opts?.cooldown ?? 4,
      minEnergyToReproduce: opts?.minEnergy ?? 0.4,
      clutchSizeMin: opts?.clutchMin ?? 1,
      clutchSizeMax: opts?.clutchMax ?? 2,
    },
    physiology: {
      ...RAPTOR_SPECIES.physiology,
      baseMetabolicCostPerTick: 0.025,
      maxForageIntakePerTick: 0.16,
    },
    trophicProfile: {
      feedingType: diet,
      dietWeights: weights,
      adultStructuralMassMU: massMU,
      maxReserveToStructuralRatio: 0.7,
      absorptionEfficiency: 0.82,
      assimilationEfficiency: 0.82,
      growthEfficiency: 0.68,
      structuralAllocationFraction: 0.18,
      basalMetabolicFactor: opts?.basal ?? 0.035,
      thermoregulationFactor: 0.015,
      activityCostFactor: 0.018,
      reproductiveEfficiency: 0.75,
    },
  };
}

test('P4 Optimization: 15,000-organism multi-guild simulation preserves 0n stoichiometry residuals', () => {
  const grid = WorldGrid.generate({ width: 64, height: 64, seed: 'p4-test-15k' });
  const reg = new SpeciesRegistry();
  reg.register(makeP4Species('herbivore', 'herbivore', { plant: 1, prey: 0, carrion: 0, detritus: 0 }, 2.0));
  reg.register(makeP4Species('carnivore', 'carnivore', { plant: 0, prey: 0.85, carrion: 0.15, detritus: 0 }, 4.0));
  reg.register(makeP4Species('omnivore', 'omnivore', { plant: 0.5, prey: 0.3, carrion: 0.1, detritus: 0.1 }, 3.0));
  reg.register(makeP4Species('scavenger', 'scavenger', { plant: 0, prey: 0.15, carrion: 0.85, detritus: 0 }, 2.5));
  reg.register(makeP4Species('detritivore', 'detritivore', { plant: 0, prey: 0, carrion: 0.15, detritus: 0.85 }, 1.6));

  const sim = new BiologySimulation({
    grid,
    seed: 'p4-test-15k-sim',
    speciesRegistry: reg,
    strictConservation: true,
    statsInterval: 1,
  });

  sim.spawnFounderPopulation('herbivore', 3000);
  sim.spawnFounderPopulation('carnivore', 3000);
  sim.spawnFounderPopulation('omnivore', 3000);
  sim.spawnFounderPopulation('scavenger', 3000);
  sim.spawnFounderPopulation('detritivore', 3000);

  let totalBirths = 0;
  let totalDeaths = 0;
  for (let t = 0; t < 5; t++) {
    const summary = sim.step();
    for (const sId of ['herbivore', 'carnivore', 'omnivore', 'scavenger', 'detritivore']) {
      totalBirths += summary.statsBySpecies[sId].birthsThisTick;
      totalDeaths += summary.statsBySpecies[sId].deathsThisTick;
    }
    const audit = sim.assertEnergyAudit();
    assert.equal(audit.massResidualQ, 0n);
    assert.equal(audit.energyResidualQ, 0n);
  }

  assert.ok(totalBirths + totalDeaths > 0, 'Expected real lifecycle activity during 15k stress run');
});

test('P4 Optimization: high-churn partial-clutch reproduction & slot reuse never double-allocates slots', () => {
  const grid = WorldGrid.generate({ width: 32, height: 32, seed: 'p4-test-churn' });
  const reg = new SpeciesRegistry();
  reg.register(
    makeP4Species('r-herb', 'herbivore', { plant: 1, prey: 0, carrion: 0, detritus: 0 }, 1.8, {
      cooldown: 1,
      incubation: 2,
      juvenile: 4,
      elder: 10,
      lifespan: 14,
      clutchMin: 3,
      clutchMax: 5,
      minEnergy: 0.25,
      basal: 0.055,
    })
  );
  reg.register(
    makeP4Species('r-carn', 'carnivore', { plant: 0, prey: 0.8, carrion: 0.2, detritus: 0 }, 2.4, {
      cooldown: 1,
      incubation: 2,
      juvenile: 4,
      elder: 10,
      lifespan: 15,
      clutchMin: 2,
      clutchMax: 4,
      minEnergy: 0.25,
      basal: 0.05,
    })
  );

  const sim = new BiologySimulation({
    grid,
    seed: 'p4-test-churn-sim',
    speciesRegistry: reg,
    strictConservation: true,
    statsInterval: 1,
  });

  sim.spawnFounderPopulation('r-herb', 600);
  sim.spawnFounderPopulation('r-carn', 400);

  let totalBirths = 0;
  let totalDeaths = 0;
  for (let t = 0; t < 12; t++) {
    const summary = sim.step();
    totalBirths +=
      summary.statsBySpecies['r-herb'].birthsThisTick + summary.statsBySpecies['r-carn'].birthsThisTick;
    totalDeaths +=
      summary.statsBySpecies['r-herb'].deathsThisTick + summary.statsBySpecies['r-carn'].deathsThisTick;

    const audit = sim.assertEnergyAudit();
    assert.equal(audit.massResidualQ, 0n);
    assert.equal(audit.energyResidualQ, 0n);

    // Check slot map bijection among alive organisms
    const idToSlot = (sim as unknown as { organismIdToSlot: Map<number, number> }).organismIdToSlot;
    const seenSlots = new Set<number>();
    for (const org of [...sim.getOrganisms('r-herb'), ...sim.getOrganisms('r-carn')]) {
      const slot = idToSlot.get(org.id);
      assert.notEqual(slot, undefined, `Missing slot for alive organism ${org.id}`);
      assert.equal(seenSlots.has(slot!), false, `Duplicate slot ${slot} detected on tick ${t + 1}`);
      seenSlots.add(slot!);
    }
  }

  assert.ok(totalBirths > 50, `Expected heavy reproduction churn, got births=${totalBirths}`);
  assert.ok(totalDeaths > 50, `Expected heavy mortality churn, got deaths=${totalDeaths}`);
});

test('P4 Optimization: extinct ecosystem (0 organisms) continues abiotic-biotic fluxes with 0n residuals', () => {
  const grid = WorldGrid.generate({ width: 32, height: 32, seed: 'p4-test-extinct' });
  const reg = new SpeciesRegistry();
  reg.register(makeP4Species('herbivore', 'herbivore', { plant: 1, prey: 0, carrion: 0, detritus: 0 }, 2.0));

  const sim = new BiologySimulation({
    grid,
    seed: 'p4-test-extinct-sim',
    speciesRegistry: reg,
    strictConservation: true,
  });

  const initialPlantMass = sim.energyGrid.totals().massQ[EnergyPool.PLANT];
  for (let t = 0; t < 8; t++) {
    sim.step();
    assert.equal(sim.getStats('herbivore').totalAlive, 0);
    assert.equal(sim.getOrganisms('herbivore').length, 0);
    const audit = sim.assertEnergyAudit();
    assert.equal(audit.massResidualQ, 0n);
    assert.equal(audit.energyResidualQ, 0n);
  }
  assert.ok(sim.energyGrid.totals().massQ[EnergyPool.PLANT] >= initialPlantMass);
});

test('P4 Optimization: ABORT rollback during PREPARE preserves RNG, ledger balances, and organism state with 0n residuals', () => {
  const grid = WorldGrid.generate({ width: 16, height: 16, seed: 'p4-test-abort' });
  const reg = new SpeciesRegistry();
  reg.register(makeP4Species('herbivore', 'herbivore', { plant: 1, prey: 0, carrion: 0, detritus: 0 }, 2.0));

  let shouldAbort = true;
  const sim = new BiologySimulation({
    grid,
    seed: 'p4-test-abort-sim',
    speciesRegistry: reg,
    strictConservation: true,
    onPhase: ({ phase }) => {
      if (phase === 'PREPARE' && shouldAbort) {
        throw new Error('injected-prepare-abort');
      }
    },
  });

  sim.spawnFounderPopulation('herbivore', 40);
  shouldAbort = false;
  sim.step();

  const tickBefore = sim.tick;
  const rngBefore = sim.streams.snapshotStates();
  const auditBefore = sim.assertEnergyAudit();
  const statsBefore = sim.getStats('herbivore');
  const plantBefore = sim.energyGrid.totals().massQ[EnergyPool.PLANT];

  shouldAbort = true;
  assert.throws(() => sim.step(), /injected-prepare-abort/);

  assert.equal(sim.tick, tickBefore);
  assert.deepEqual(sim.streams.snapshotStates(), rngBefore);
  assert.deepEqual(sim.assertEnergyAudit(), auditBefore);
  assert.equal(sim.energyGrid.totals().massQ[EnergyPool.PLANT], plantBefore);
  assert.equal(sim.getStats('herbivore').totalAlive, statsBefore.totalAlive);

  // Subsequent step recovers cleanly
  shouldAbort = false;
  const recovered = sim.step();
  assert.equal(recovered.tick, tickBefore + 1);
  const auditAfter = sim.assertEnergyAudit();
  assert.equal(auditAfter.massResidualQ, 0n);
  assert.equal(auditAfter.energyResidualQ, 0n);
});

test('P4 Optimization: PostingBuffer.ensureRoom(extra) grows past boundary when count < capacity', () => {
  const buf = new PostingBuffer(4);
  for (let i = 0; i < 3; i++) {
    buf.push(1, 0, i, 1, i, 10);
  }
  assert.equal(buf.count, 3);
  assert.equal(buf.capacity, 4);

  // Calling ensureRoom(4) when 3 + 4 = 7 > 4 must grow cleanly instead of looping or under-sizing
  buf.ensureRoom(4);
  assert.ok(buf.capacity >= 7);
  for (let i = 0; i < 4; i++) {
    buf.push(1, 0, 10 + i, 1, 10 + i, 20);
  }
  assert.equal(buf.count, 7);
});

