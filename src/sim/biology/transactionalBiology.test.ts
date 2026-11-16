import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { AccountKind } from '../energyAccounts';
import { EnergyLedger } from '../energyLedger';
import { EntityEnergyStore } from '../stagedStore';
import { SeededRng } from '../prng';
import { RHO_DETRITUS, RHO_PLANT, energyOfMass, muToQ } from '../units';
import { EnergyPool, WorldEnergyGrid } from '../worldEnergyGrid';
import { WorldGrid } from '../worldGrid';
import {
  BiologySimulation,
  BiologyStepPhase,
} from './biologySimulation';
import { createIndividualGenome } from './genome';
import { Organism, OrganismDeathEvent } from './organism';
import { PopulationManager } from './population';
import { FoodEnvironmentContext, FoodProvider } from './foodProvider';
import { RAPTOR_SPECIES, SpeciesDefinition, SpeciesRegistry } from './species';
import {
  ExternalEscrowFoodSource,
  NonConservingFoodProviderError,
} from './transactionalFoodSource';
import { TrophicType } from './trophicProfile';

function makeBaselineGenome(species: SpeciesDefinition) {
  return createIndividualGenome(
    species.genomeSchema,
    species.traitBaselines,
    species.traitRanges,
    0,
    new SeededRng('test-genome')
  );
}

function makeGuildSpecies(
  id: string,
  diet: TrophicType,
  dietWeights: { plant: number; prey: number; carrion: number; detritus: number },
  adultStructuralMassMU = 4.0
): SpeciesDefinition {
  return {
    ...RAPTOR_SPECIES,
    id,
    name: id,
    diet,
    reproduction: {
      ...RAPTOR_SPECIES.reproduction,
      cooldownTicks: 10,
      clutchSizeMin: 1,
      clutchSizeMax: 2,
    },
    trophicProfile: {
      feedingType: diet,
      dietWeights,
      adultStructuralMassMU,
      maxReserveToStructuralRatio: 0.4,
      absorptionEfficiency: 0.85,
      assimilationEfficiency: 0.85,
      growthEfficiency: 0.65,
      structuralAllocationFraction: 0.12,
      basalMetabolicFactor: 0.04,
      thermoregulationFactor: 0.015,
      activityCostFactor: 0.02,
      reproductiveEfficiency: 0.72,
    },
  };
}

function makeAllGuildRegistry(): SpeciesRegistry {
  const reg = new SpeciesRegistry();
  reg.register(
    makeGuildSpecies('herbivore', 'herbivore', { plant: 1, prey: 0, carrion: 0, detritus: 0 }, 2.2)
  );
  reg.register(
    makeGuildSpecies('carnivore', 'carnivore', { plant: 0, prey: 1, carrion: 0, detritus: 0 }, 4.5)
  );
  reg.register(
    makeGuildSpecies('omnivore', 'omnivore', { plant: 0.5, prey: 0.3, carrion: 0.1, detritus: 0.1 }, 3.5)
  );
  reg.register(
    makeGuildSpecies('scavenger', 'scavenger', { plant: 0, prey: 0.2, carrion: 0.8, detritus: 0 }, 3.0)
  );
  reg.register(
    makeGuildSpecies(
      'detritivore',
      'detritivore',
      { plant: 0, prey: 0, carrion: 0.2, detritus: 0.8 },
      1.8
    )
  );
  return reg;
}

function snapshotOrganismState(org: Organism) {
  return {
    id: org.id,
    speciesId: org.speciesId,
    alive: org.alive,
    stage: org.stage,
    ageTicks: org.ageTicks,
    reproductionCooldown: org.reproductionCooldown,
    health: org.health,
    energy: org.energy,
    offspringCount: org.offspringCount,
    cellIndex: org.cellIndex,
  };
}

function snapshotWorldGridBuffers(grid: WorldGrid) {
  return {
    elevation: grid.elevation.slice(),
    temperature: grid.temperature.slice(),
    moisture: grid.moisture.slice(),
    terrainCode: grid.terrainCode.slice(),
    biomeCode: grid.biomeCode.slice(),
  };
}

test('P3: Closed multi-species ecosystem (all 5 guilds, predation, carrion, detritus, 0-org recycling) keeps strict 0n residuals', () => {
  const grid = WorldGrid.generate({ width: 14, height: 10, seed: 'p3-all-guilds' });
  const reg = makeAllGuildRegistry();
  const sim = new BiologySimulation({
    grid,
    seed: 'p3-all-guilds-sim',
    speciesRegistry: reg,
    strictConservation: true,
    recordHistory: true,
  });

  sim.assertPhysicallyClosed();
  assert.equal(sim.conservationMode, 'strict');
  assert.equal(sim.ledger.strictStoichiometry, true);

  // Pick a guaranteed land cell so live carnivore predation on herbivore triggers in-cell
  let landX = -1;
  let landY = -1;
  for (let y = 0; y < grid.height && landX === -1; y++) {
    for (let x = 0; x < grid.width; x++) {
      const t = grid.getTerrain(x, y);
      if (t !== 'deep-water' && t !== 'shallow-water') {
        landX = x;
        landY = y;
        break;
      }
    }
  }
  assert.ok(landX >= 0, 'Expected at least one habitable land cell');

  // Spawn hungry carnivore + well-fed herbivore in the exact same cell for live predation
  sim.spawnOrganism({
    speciesId: 'herbivore',
    x: landX,
    y: landY,
    sex: 'female',
    stage: 'adult',
    energy: 0.9,
    genome: makeBaselineGenome(reg.get('herbivore')),
  });
  sim.spawnOrganism({
    speciesId: 'carnivore',
    x: landX,
    y: landY,
    sex: 'male',
    stage: 'adult',
    energy: 0.4,
    genome: makeBaselineGenome(reg.get('carnivore')),
  });

  for (const sp of ['herbivore', 'carnivore', 'omnivore', 'scavenger', 'detritivore']) {
    sim.spawnFounderPopulation(sp, 18);
  }

  let sawDeathEvent = false;
  let sawBirth = false;
  sim.onDeath((ev) => {
    sawDeathEvent = true;
    assert.ok(Object.isFrozen(ev));
  });

  for (let t = 0; t < 80; t++) {
    sim.step();
    const audit = sim.assertEnergyAudit();
    assert.equal(audit.massResidualQ, 0n);
    assert.equal(audit.energyResidualQ, 0n);
    for (const sp of ['herbivore', 'omnivore']) {
      if (sim.getStats(sp).birthsTotal > 0) sawBirth = true;
    }
  }
  assert.ok(sawBirth, 'Expected closed ecosystem births');

  // Kill all remaining organisms cleanly, then step 25 ticks at 0 alive organisms to verify
  // photosynthesis & carrion/detritus decomposition still run and conserve exact stoichiometry
  for (const sp of ['herbivore', 'carnivore', 'omnivore', 'scavenger', 'detritivore']) {
    for (const org of [...sim.getOrganisms(sp)]) {
      sim.killOrganism(sp, org.id, 'injury');
    }
    assert.equal(sim.getOrganisms(sp).length, 0);
  }
  assert.ok(sawDeathEvent);

  const carrionBefore = sim.energyView.totals().massQ[EnergyPool.CARRION];
  assert.ok(carrionBefore > 0n, 'Deaths must deposit carrion biomass on WorldEnergyGrid');

  sim.stepMany(25);
  const carrionAfter = sim.energyView.totals().massQ[EnergyPool.CARRION];
  assert.ok(carrionAfter < carrionBefore, 'Carrion must continue decomposing at 0 alive organisms');

  const finalAudit = sim.assertEnergyAudit();
  assert.equal(finalAudit.massResidualQ, 0n);
  assert.equal(finalAudit.energyResidualQ, 0n);
});

test('P3: 1000-tick closed ecosystem stability with strict stoichiometry and zero WorldGrid mutation', () => {
  const grid = WorldGrid.generate({ width: 12, height: 10, seed: 'p3-1000-ticks' });
  const gridBefore = snapshotWorldGridBuffers(grid);

  const sim = new BiologySimulation({
    grid,
    seed: 'p3-1000-sim',
    strictConservation: true,
    recordHistory: false,
  });
  sim.spawnFounderPopulation('raptor', 24);

  for (let t = 0; t < 1000; t++) {
    sim.step();
    if (t % 50 === 49) {
      const audit = sim.assertEnergyAudit();
      assert.equal(audit.massResidualQ, 0n);
      assert.equal(audit.energyResidualQ, 0n);
    }
  }
  const endAudit = sim.assertEnergyAudit();
  assert.equal(endAudit.massResidualQ, 0n);
  assert.equal(endAudit.energyResidualQ, 0n);
  assert.equal(sim.tick, 1000);
  assert.ok(sim.getStats('raptor').birthsTotal > 0, 'Expected multi-generation births over 1000 ticks');

  const gridAfter = snapshotWorldGridBuffers(grid);
  assert.deepEqual(gridAfter.elevation, gridBefore.elevation);
  assert.deepEqual(gridAfter.temperature, gridBefore.temperature);
  assert.deepEqual(gridAfter.moisture, gridBefore.moisture);
  assert.deepEqual(gridAfter.terrainCode, gridBefore.terrainCode);
  assert.deepEqual(gridAfter.biomeCode, gridBefore.biomeCode);
});

test('P3: Strict ledger & NonConservingFoodProviderError enforcement (never silently downgrades)', () => {
  const grid = WorldGrid.generate({ width: 8, height: 8, seed: 'p3-strict-reject' });
  const fakeProvider: FoodProvider = {
    isPhysicallyClosed: false,
    getAvailablePrey: (_env: FoodEnvironmentContext) => 1.0,
    consumePrey: (_env: FoodEnvironmentContext, requested: number) => requested,
  };

  assert.throws(
    () =>
      new BiologySimulation({
        grid,
        seed: 'strict-reject-1',
        foodProvider: fakeProvider,
        strictConservation: true,
      }),
    NonConservingFoodProviderError
  );

  // Even without strictConservation: true, passing energyLedger/worldEnergyGrid/entityStore requires closed foodProvider
  const customLedger = new EnergyLedger({
    initialAbioticMassQ: 1_000_000_000n,
    strictStoichiometry: true,
  });
  assert.throws(
    () =>
      new BiologySimulation({
        grid,
        seed: 'strict-reject-2',
        foodProvider: fakeProvider,
        energyLedger: customLedger,
      }),
    NonConservingFoodProviderError
  );

  // Non-strict ledger is rejected in strict conservation mode
  const nonStrictLedger = new EnergyLedger({
    initialAbioticMassQ: 1_000_000_000n,
    strictStoichiometry: false,
  });
  assert.throws(
    () =>
      new BiologySimulation({
        grid,
        seed: 'strict-reject-3',
        energyLedger: nonStrictLedger,
        strictConservation: true,
      }),
    NonConservingFoodProviderError
  );

  // Non-closed transactionalFoodSources are rejected
  assert.throws(
    () =>
      new BiologySimulation({
        grid,
        seed: 'strict-reject-4',
        transactionalFoodSources: {
          plant: {
            sourceId: 'bad',
            poolKind: 'plant',
            isPhysicallyClosed: false,
            inspect: () => ({
              poolKind: 'plant',
              cellIndex: 0,
              massQ: 0,
              energyQ: 0,
              isPhysicallyClosed: false,
            }),
            reserve: () => {
              throw new Error('unused');
            },
            commitReservation: () => ({ massQ: 0, energyQ: 0 }),
            abortReservation: () => {},
          },
        },
      }),
    NonConservingFoodProviderError
  );
});

test('P3 Zero Torn Ticks: ABORT fault injection across GATHER, RESOLVE, PRE_ALLOCATE, and PREPARE restores exact pre-tick state including elder cooldowns', () => {
  const phases: BiologyStepPhase[] = ['GATHER', 'RESOLVE', 'PRE_ALLOCATE', 'PREPARE'];

  for (const faultPhase of phases) {
    let shouldFail = true;
    const grid = WorldGrid.generate({ width: 10, height: 10, seed: `p3-fault-${faultPhase}` });
    const sim = new BiologySimulation({
      grid,
      seed: `p3-fault-sim-${faultPhase}`,
      strictConservation: true,
      onPhase: ({ phase }) => {
        if (shouldFail && phase === faultPhase) {
          throw new Error(`Injected fault at ${faultPhase}`);
        }
      },
    });

    // Pick land cell and spawn both adult and elder breeding pairs so elder-miss / repro cooldown is exercised
    let landX = 0;
    let landY = 0;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const t = grid.getTerrain(x, y);
        if (t !== 'deep-water' && t !== 'shallow-water') {
          landX = x;
          landY = y;
          break;
        }
      }
    }

    sim.spawnOrganism({
      speciesId: 'raptor',
      x: landX,
      y: landY,
      sex: 'female',
      stage: 'elder',
      ageTicks: RAPTOR_SPECIES.lifecycle.elderAgeTicks + 2,
      energy: 0.95,
      health: 1,
      genome: makeBaselineGenome(RAPTOR_SPECIES),
    });
    sim.spawnOrganism({
      speciesId: 'raptor',
      x: landX,
      y: landY,
      sex: 'male',
      stage: 'elder',
      ageTicks: RAPTOR_SPECIES.lifecycle.elderAgeTicks + 2,
      energy: 0.95,
      health: 1,
      genome: makeBaselineGenome(RAPTOR_SPECIES),
    });
    sim.spawnFounderPopulation('raptor', 16);

    // Advance 1 clean tick before injecting fault
    shouldFail = false;
    sim.step();

    const tickBefore = sim.tick;
    const orgsBefore = sim.getOrganisms('raptor').map(snapshotOrganismState);
    const rngBefore = sim.streams.snapshotStates();
    const abioticBefore = sim.ledger.globalAbioticMassQ;
    const plantMassBefore = sim.energyView.totals().massQ[EnergyPool.PLANT];
    const detritusMassBefore = sim.energyView.totals().massQ[EnergyPool.DETRITUS];
    const slotMassBefore = orgsBefore.map((o) => sim.getOrganismMassAndEnergy(o.id));
    const committedTxBefore = sim.ledger.committedTxCount;
    const abortedTxBefore = sim.ledger.abortedTxCount;

    shouldFail = true;
    assert.throws(() => sim.step(), new RegExp(`Injected fault at ${faultPhase}`));

    assert.equal(sim.tick, tickBefore, `${faultPhase}: tickCount must remain unchanged`);
    assert.deepEqual(
      sim.getOrganisms('raptor').map(snapshotOrganismState),
      orgsBefore,
      `${faultPhase}: organisms (including elder reproductionCooldown & age) must not mutate`
    );
    assert.deepEqual(
      sim.streams.snapshotStates(),
      rngBefore,
      `${faultPhase}: RngStreams must roll back cleanly`
    );
    assert.equal(sim.energyView.totals().massQ[EnergyPool.PLANT], plantMassBefore);
    assert.equal(sim.energyView.totals().massQ[EnergyPool.DETRITUS], detritusMassBefore);
    assert.deepEqual(
      orgsBefore.map((o) => sim.getOrganismMassAndEnergy(o.id)),
      slotMassBefore
    );
    assert.equal(sim.ledger.committedTxCount, committedTxBefore);
    if (faultPhase === 'PREPARE') {
      assert.equal(sim.ledger.abortedTxCount, abortedTxBefore + 1);
    }
    assert.equal(sim.ledger.activeTransaction, null);
    assert.equal(sim.entityStore.isSynchronized(), true);
    assert.equal(sim.energyGrid.isSynchronized(), true);
    const auditAfterAbort = sim.assertEnergyAudit();
    assert.equal(auditAfterAbort.massResidualQ, 0n);
    assert.equal(auditAfterAbort.energyResidualQ, 0n);
    assert.equal(sim.ledger.globalAbioticMassQ, abioticBefore);

    // Disable fault and verify clean retry produces exact deterministic recovery
    shouldFail = false;
    const summary = sim.step();
    assert.equal(summary.tick, tickBefore + 1);
    const retryAudit = sim.assertEnergyAudit();
    assert.equal(retryAudit.massResidualQ, 0n);
    assert.equal(retryAudit.energyResidualQ, 0n);
  }
});

test('P3 Zero Torn Ticks: EntityEnergyStore capacity budget failure in PRE_ALLOCATE rolls back without partial mutation', () => {
  const grid = WorldGrid.generate({ width: 8, height: 8, seed: 'p3-oom' });
  const tightStore = new EntityEnergyStore(80, {
    maxMemoryBytes: EntityEnergyStore.estimateBytes(85), // allows initial 80, rejects growth above 85
  });
  const sim = new BiologySimulation({
    grid,
    seed: 'p3-oom-sim',
    entityStore: tightStore,
    organismSlotOffset: grid.cellCount, // uses 64 prey slots -> 16 entity slots left
    strictConservation: true,
  });

  let landX = 0;
  let landY = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const t = grid.getTerrain(x, y);
      if (t !== 'deep-water' && t !== 'shallow-water') {
        landX = x;
        landY = y;
        break;
      }
    }
  }

  // Spawn 12 co-located adult breeders (fills slots 64..75, leaving 4 free slots <= 6 pairs)
  const genome = makeBaselineGenome(RAPTOR_SPECIES);
  for (let i = 0; i < 12; i++) {
    sim.spawnOrganism({
      speciesId: 'raptor',
      x: landX,
      y: landY,
      sex: i % 2 === 0 ? 'female' : 'male',
      stage: 'adult',
      energy: 0.95,
      health: 1,
      genome,
    });
  }
  const tickBefore = sim.tick;
  const orgsBefore = sim.getOrganisms('raptor').map(snapshotOrganismState);
  const rngBefore = sim.streams.snapshotStates();

  // Breeding 6 pairs spawns > 4 eggs -> ensureEntityCapacity exceeds tightStore maxMemoryBytes
  let threw = false;
  try {
    sim.step();
  } catch (err) {
    threw = true;
    assert.match(String(err), /budget|capacity/i);
  }
  assert.ok(threw, 'Expected EntityEnergyStore budget error when breeding exceeds capacity limit');
  assert.equal(sim.tick, tickBefore);
  assert.deepEqual(sim.getOrganisms('raptor').map(snapshotOrganismState), orgsBefore);
  assert.deepEqual(sim.streams.snapshotStates(), rngBefore);
  assert.equal(sim.ledger.activeTransaction, null);
  assert.equal(sim.entityStore.isSynchronized(), true);
  assert.equal(sim.assertEnergyAudit().massResidualQ, 0n);
});

test('P3 Escrow Durability: external TransactionalFoodSource failure leaves ESCROW intact and retries cleanly without loss or duplication', () => {
  const grid = WorldGrid.generate({ width: 6, height: 6, seed: 'p3-escrow' });
  let landX = 0;
  let landY = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const t = grid.getTerrain(x, y);
      if (t !== 'deep-water' && t !== 'shallow-water') {
        landX = x;
        landY = y;
        break;
      }
    }
  }
  const cellIndex = grid.toIndex(landX, landY);
  const initialCellMass = new Array<number>(grid.cellCount).fill(0);
  const initialCellEnergy = new Array<number>(grid.cellCount).fill(0);
  const stockM = muToQ(20);
  initialCellMass[cellIndex] = stockM;
  initialCellEnergy[cellIndex] = energyOfMass(stockM, RHO_PLANT);

  let pullAttempts = 0;
  let failOnPrepareAfterPull = true;

  const extPlant = new ExternalEscrowFoodSource({
    sourceId: 'ext-plant',
    poolKind: 'plant',
    cellCount: grid.cellCount,
    initialCellMassQ: initialCellMass,
    initialCellEnergyQ: initialCellEnergy,
    beforeCommit: () => {
      pullAttempts += 1;
    },
  });

  const sim = new BiologySimulation({
    grid,
    seed: 'p3-escrow-sim',
    strictConservation: true,
    transactionalFoodSources: { plant: extPlant },
    onPhase: ({ phase }) => {
      if (failOnPrepareAfterPull && phase === 'PREPARE') {
        throw new Error('Abort after external escrow import');
      }
    },
  });

  const herbRegistry = makeAllGuildRegistry();
  const herbSim = new BiologySimulation({
    grid,
    seed: 'p3-escrow-herb',
    speciesRegistry: herbRegistry,
    strictConservation: true,
    transactionalFoodSources: { plant: extPlant },
    onPhase: ({ phase }) => {
      if (failOnPrepareAfterPull && phase === 'PREPARE') {
        throw new Error('Abort after external escrow import');
      }
    },
  });
  void sim;

  herbSim.spawnOrganism({
    speciesId: 'herbivore',
    x: landX,
    y: landY,
    sex: 'female',
    stage: 'adult',
    energy: 0.5,
    genome: makeBaselineGenome(herbRegistry.get('herbivore')),
  });

  assert.throws(() => herbSim.step(), /Abort after external escrow import/);
  assert.ok(pullAttempts > 0, 'External pull occurred before PREPARE abort');
  assert.equal(herbSim.tick, 0);

  // External stock pulled before abort must sit safely in ledger ESCROW (not lost or duplicated)
  const extAuditMid = extPlant.auditInventory();
  assert.equal(extAuditMid.ok, true);
  assert.ok(extAuditMid.withdrawnMassQ > 0n);
  const ledgerMid = herbSim.assertEnergyAudit();
  assert.equal(herbSim.ledger.escrowMassQ(1), extAuditMid.withdrawnMassQ);
  assert.equal(ledgerMid.massResidualQ, 0n);
  assert.equal(ledgerMid.energyResidualQ, 0n);

  const pullsBeforeRetry = pullAttempts;
  failOnPrepareAfterPull = false;
  herbSim.step();
  assert.equal(herbSim.tick, 1);

  const extAuditEnd = extPlant.auditInventory();
  assert.equal(extAuditEnd.ok, true);
  assert.equal(
    pullAttempts,
    pullsBeforeRetry,
    'Retry tick must reuse durable ESCROW balance without pulling duplicate external biomass'
  );
  const ledgerEnd = herbSim.assertEnergyAudit();
  assert.equal(ledgerEnd.massResidualQ, 0n);
  assert.equal(ledgerEnd.energyResidualQ, 0n);
});

test('P3 POST_COMMIT isolation: throwing onDeath listener does not roll back physics and allows subsequent listeners', () => {
  const grid = WorldGrid.generate({ width: 8, height: 8, seed: 'p3-postcommit' });
  const sim = new BiologySimulation({
    grid,
    seed: 'p3-postcommit-sim',
    strictConservation: true,
  });

  let landX = 0;
  let landY = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const t = grid.getTerrain(x, y);
      if (t !== 'deep-water' && t !== 'shallow-water') {
        landX = x;
        landY = y;
        break;
      }
    }
  }

  // Organism at max lifespan so it dies naturally during COMMIT/POST_COMMIT
  sim.spawnOrganism({
    speciesId: 'raptor',
    x: landX,
    y: landY,
    sex: 'female',
    stage: 'elder',
    ageTicks: RAPTOR_SPECIES.lifecycle.maxLifespanTicks + 10,
    health: 0.05,
    energy: 0.5,
    genome: makeBaselineGenome(RAPTOR_SPECIES),
  });

  const receivedEvents: OrganismDeathEvent[] = [];
  sim.onDeath(() => {
    throw new Error('POST_COMMIT listener failure');
  });
  sim.onDeath((ev) => {
    receivedEvents.push(ev);
  });

  const summary = sim.step();
  assert.equal(summary.tick, 1);
  assert.equal(sim.tick, 1);
  assert.equal(sim.getOrganisms('raptor').length, 0);
  assert.equal(receivedEvents.length, 1);
  assert.equal(sim.getTotalDeathListenerErrors(), 1);
  assert.equal(sim.assertEnergyAudit().massResidualQ, 0n);
  assert.equal(sim.energyView.totals().massQ[EnergyPool.CARRION] > 0n, true);
});

test('P3 Permutation Invariance & Diagnostic Isolation across statsInterval / maxHistoryEntries / trackMutationEvents', () => {
  const grid = WorldGrid.generate({ width: 12, height: 10, seed: 'p3-diag-iso' });

  const simA = new BiologySimulation({
    grid,
    seed: 'p3-diag-shared',
    strictConservation: true,
    recordHistory: true,
    statsInterval: 1,
    maxHistoryEntries: 100,
    trackMutationEvents: true,
  });
  const simB = new BiologySimulation({
    grid,
    seed: 'p3-diag-shared',
    strictConservation: true,
    recordHistory: false,
    statsInterval: 7,
    maxHistoryEntries: 0,
    trackMutationEvents: false,
  });

  simA.spawnFounderPopulation('raptor', 20);
  simB.spawnFounderPopulation('raptor', 20);

  simA.stepMany(25);
  simB.stepMany(25);

  assert.deepEqual(
    simA.getOrganisms('raptor').map(snapshotOrganismState),
    simB.getOrganisms('raptor').map(snapshotOrganismState)
  );
  assert.deepEqual(simA.streams.snapshotStates(), simB.streams.snapshotStates());
  assert.equal(
    simA.energyView.totals().massQ[EnergyPool.PLANT],
    simB.energyView.totals().massQ[EnergyPool.PLANT]
  );
  assert.equal(
    simA.energyView.totals().massQ[EnergyPool.DETRITUS],
    simB.energyView.totals().massQ[EnergyPool.DETRITUS]
  );
  simA.assertEnergyAudit();
  simB.assertEnergyAudit();
  assert.equal(simA.ledger.globalAbioticMassQ, simB.ledger.globalAbioticMassQ);
});

test('P3 Permutation Invariance: PopulationManager rejects partial invalid batch additions cleanly', () => {
  const grid = WorldGrid.generate({ width: 6, height: 6, seed: 'p3-pop-batch' });
  const pop = new PopulationManager(RAPTOR_SPECIES, grid);
  const sim = new BiologySimulation({ grid, seed: 'p3-pop-batch-sim', strictConservation: true });
  const validOrg = sim.spawnFounderPopulation('raptor', 1)[0];

  pop.addOrganismsBatch([validOrg], 'introduced');
  assert.equal(pop.size, 1);

  const duplicateBatch: Organism[] = [
    { ...validOrg, id: 999 },
    { ...validOrg, id: validOrg.id }, // duplicate ID with existing population
  ];
  assert.throws(() => pop.addOrganismsBatch(duplicateBatch, 'birth'), /Duplicate organism id/);
  assert.equal(pop.size, 1, 'Failed batch must not register organism 999');
  assert.equal(pop.getById(999), undefined);
});

test('P3 Strict-Mode Multi-Tick Performance Smoke Check (2k organisms + strict stoichiometry)', () => {
  const grid = WorldGrid.generate({ width: 64, height: 48, seed: 'p3-strict-perf' });
  const sim = new BiologySimulation({
    grid,
    seed: 'p3-strict-perf-sim',
    strictConservation: true,
    recordHistory: false,
  });
  sim.spawnFounderPopulation('raptor', 2000);
  sim.stepMany(2); // warmup

  const ticks = 5;
  const t0 = performance.now();
  sim.stepMany(ticks);
  const msPerTick = (performance.now() - t0) / ticks;

  assert.ok(msPerTick < 120, `Expected strict-mode 2k organisms < 120ms/tick, got ${msPerTick.toFixed(2)}ms`);
  const audit = sim.assertEnergyAudit();
  assert.equal(audit.massResidualQ, 0n);
  assert.equal(audit.energyResidualQ, 0n);
});

test('P3 Static Hygiene: no Math.random or direct grid TypedArray writes in src/sim/biology/*.ts', () => {
  const bioDir = path.resolve(process.cwd(), 'src/sim/biology');
  const files = fs.readdirSync(bioDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  assert.ok(files.length > 0);
  for (const file of files) {
    const src = fs.readFileSync(path.join(bioDir, file), 'utf8');
    assert.equal(src.includes('Math.random('), false, `Forbidden Math.random( found in ${file}`);
    assert.equal(
      /grid\.(elevation|temperature|moisture|terrainCode|biomeCode)\[[^\]]+\]\s*=/.test(src),
      false,
      `Forbidden direct WorldGrid TypedArray mutation found in ${file}`
    );
  }
  void AccountKind;
  void RHO_DETRITUS;
});
