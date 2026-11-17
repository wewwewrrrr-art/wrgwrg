import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { AccountKind, PostingReason } from '../energyAccounts';
import { EnergyLedger } from '../energyLedger';
import { EnergyInvariantError, EnergyRuleError, UnitsError } from '../energyTransaction';
import { SeededRng } from '../prng';
import { EntityEnergyStore } from '../stagedStore';
import {
  RHO_DETRITUS,
  RHO_PLANT,
  RHO_RESERVE,
  RHO_STRUCT,
  energyOfMass,
  hasExactDensity,
  isValidCarrionMix,
  muToQ,
  planCarrionConsumption,
} from '../units';
import { EnergyPool, WorldEnergyGrid } from '../worldEnergyGrid';
import { WorldGrid } from '../worldGrid';
import { BiologySimulation, BiologyStepPhase } from './biologySimulation';
import { createIndividualGenome } from './genome';
import { Organism } from './organism';
import { RAPTOR_SPECIES, SpeciesDefinition, SpeciesRegistry } from './species';
import { ExternalEscrowFoodSource } from './transactionalFoodSource';
import {
  MutableFeedingPlanOut,
  MutableReproductionProvisioningOut,
  MutableReserveMetabolismOut,
  computeFeedingPlan,
  computeFeedingPlanFast,
  computeTotalMetabolicDemandFast,
  computeTotalMetabolicDemandQ,
  planCarrionConsumptionFast,
  stageCarrionDecomposition,
  stageCarrionDecompositionFast,
  stageCarrionScavenge,
  stageCarrionScavengeFast,
  stageDeathToCarrion,
  stageDeathToCarrionFast,
  stageDetritusDecomposition,
  stageDetritusDecompositionFast,
  stageFeeding,
  stageFeedingFast,
  stageMetabolism,
  stageMetabolismFast,
  stagePreyPredation,
  stagePreyPredationFast,
  stageReproductionProvisioning,
  stageReproductionProvisioningFast,
  stageSomaticGrowth,
  stageSomaticGrowthFast,
} from './trophicNutrition';
import { TrophicType } from './trophicProfile';

function makeSpecies(
  id: string,
  diet: TrophicType,
  weights: { plant: number; prey: number; carrion: number; detritus: number },
  adultMassMU: number,
  opts?: {
    optTemp?: number;
    halfWidth?: number;
    incubation?: number;
    juvenile?: number;
    elder?: number;
    lifespan?: number;
    cooldown?: number;
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
      incubationTicks: opts?.incubation ?? 3,
      juvenileTicks: opts?.juvenile ?? 6,
      elderAgeTicks: opts?.elder ?? 50,
      maxLifespanTicks: opts?.lifespan ?? 80,
    },
    reproduction: {
      ...RAPTOR_SPECIES.reproduction,
      cooldownTicks: opts?.cooldown ?? 3,
      minEnergyToReproduce: opts?.minEnergy ?? 0.35,
      clutchSizeMin: opts?.clutchMin ?? 1,
      clutchSizeMax: opts?.clutchMax ?? 2,
    },
    physiology: {
      ...RAPTOR_SPECIES.physiology,
      optimalTemperatureC: opts?.optTemp ?? RAPTOR_SPECIES.physiology.optimalTemperatureC,
      baseThermalHalfWidthC: opts?.halfWidth ?? RAPTOR_SPECIES.physiology.baseThermalHalfWidthC,
      baseMetabolicCostPerTick: 0.025,
      maxForageIntakePerTick: 0.18,
    },
    trophicProfile: {
      feedingType: diet,
      dietWeights: weights,
      adultStructuralMassMU: adultMassMU,
      maxReserveToStructuralRatio: 0.7,
      absorptionEfficiency: 0.84,
      assimilationEfficiency: 0.84,
      growthEfficiency: 0.68,
      structuralAllocationFraction: 0.18,
      basalMetabolicFactor: opts?.basal ?? 0.032,
      thermoregulationFactor: 0.015,
      activityCostFactor: 0.018,
      reproductiveEfficiency: 0.75,
    },
  };
}

function makeAllGuildRegistry(includeRaptor = true): SpeciesRegistry {
  const reg = new SpeciesRegistry();
  if (includeRaptor) {
    reg.register(RAPTOR_SPECIES);
  }
  reg.register(
    makeSpecies('herbivore', 'herbivore', { plant: 1, prey: 0, carrion: 0, detritus: 0 }, 2.0)
  );
  reg.register(
    makeSpecies('carnivore', 'carnivore', { plant: 0, prey: 0.85, carrion: 0.15, detritus: 0 }, 4.2)
  );
  reg.register(
    makeSpecies('omnivore', 'omnivore', { plant: 0.5, prey: 0.3, carrion: 0.1, detritus: 0.1 }, 3.0)
  );
  reg.register(
    makeSpecies('scavenger', 'scavenger', { plant: 0, prey: 0.15, carrion: 0.85, detritus: 0 }, 2.6)
  );
  reg.register(
    makeSpecies('detritivore', 'detritivore', { plant: 0, prey: 0, carrion: 0.15, detritus: 0.85 }, 1.6)
  );
  return reg;
}

function hashTypedArray(arr: ArrayBufferView): string {
  return crypto
    .createHash('sha256')
    .update(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength))
    .digest('hex');
}

function hashAllWorldGridBuffers(grid: WorldGrid) {
  return {
    temperature: hashTypedArray(grid.temperature),
    moisture: hashTypedArray(grid.moisture),
    terrainCode: hashTypedArray(grid.terrainCode),
    biomeCode: hashTypedArray(grid.biomeCode),
    waterDepth: hashTypedArray(grid.waterDepth),
    elevation: hashTypedArray(grid.elevation),
    biomass: hashTypedArray(grid.biomass),
  };
}

function fullSimulationDigest(sim: BiologySimulation, speciesIds: readonly string[]) {
  const orgsBySpecies: Record<string, unknown[]> = {};
  for (const sId of speciesIds) {
    orgsBySpecies[sId] = [...sim.getOrganisms(sId)]
      .sort((a, b) => a.id - b.id)
      .map((o) => {
      const massEnergy = sim.getOrganismMassAndEnergy(o.id);
      return {
        id: o.id,
        speciesId: o.speciesId,
        sex: o.sex,
        generation: o.generation,
        parentAId: o.parentAId,
        parentBId: o.parentBId,
        birthTick: o.birthTick,
        x: o.x,
        y: o.y,
        cellIndex: o.cellIndex,
        ageTicks: o.ageTicks,
        stage: o.stage,
        health: o.health,
        energy: o.energy,
        alive: o.alive,
        deathTick: o.deathTick,
        deathCause: o.deathCause,
        cooldown: o.reproductionCooldown,
        offspringCount: o.offspringCount,
        mutations: o.mutationsReceived,
        massEnergy,
        carryCreditQ: sim.getOrganismCarryCreditQ(o.id),
        mat: Array.from(o.genome.maternalAlleles),
        pat: Array.from(o.genome.paternalAlleles),
        dom: Array.from(o.genome.dominance),
        genExpr: Array.from(o.phenotype.geneticExpression),
        expr: Array.from(o.phenotype.expressed),
      };
    });
  }

  const eg = sim.energyGrid;
  const audit = sim.assertEnergyAudit();
  return {
    tick: sim.tick,
    rng: sim.streams.snapshotStates(),
    audit: {
      actualMassQ: audit.actualMassQ.toString(),
      actualEnergyQ: audit.actualEnergyQ.toString(),
      massResidualQ: audit.massResidualQ.toString(),
      energyResidualQ: audit.energyResidualQ.toString(),
      committedTxCount: audit.committedTxCount,
      abiotic: sim.ledger.globalAbioticMassQ.toString(),
      sun: sim.ledger.sunEnergyInQ.toString(),
      heat: sim.ledger.heatEnergyOutQ.toString(),
    },
    gridTotals: {
      massQ: Array.from(eg.totals().massQ, String),
      energyQ: Array.from(eg.totals().energyQ, String),
    },
    orgsBySpecies,
  };
}

function firstLandCell(grid: WorldGrid): { x: number; y: number; cellIndex: number } {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const t = grid.getTerrain(x, y);
      if (t !== 'deep-water' && t !== 'shallow-water') {
        return { x, y, cellIndex: grid.toIndex(x, y) };
      }
    }
  }
  throw new Error('No land cell found in grid');
}

function assertAllCellsAndSlotsStoichiometric(sim: BiologySimulation): void {
  sim.ledger.assertStoichiometry();
  const eg = sim.energyGrid;
  for (let c = 0; c < eg.cellCount; c++) {
    const pm = eg.getMassQ(EnergyPool.PLANT, c);
    const pe = eg.getEnergyQ(EnergyPool.PLANT, c);
    assert.equal(hasExactDensity(pm, pe, RHO_PLANT), true, `cell ${c} PLANT density mismatch`);

    const dm = eg.getMassQ(EnergyPool.DETRITUS, c);
    const de = eg.getEnergyQ(EnergyPool.DETRITUS, c);
    assert.equal(hasExactDensity(dm, de, RHO_DETRITUS), true, `cell ${c} DETRITUS density mismatch`);

    const cm = eg.getMassQ(EnergyPool.CARRION, c);
    const ce = eg.getEnergyQ(EnergyPool.CARRION, c);
    assert.equal(isValidCarrionMix(cm, ce), true, `cell ${c} CARRION mix mismatch`);
  }
  const es = sim.entityStore;
  for (let slot = 0; slot < es.capacity; slot++) {
    const sm = es.structMassQ(slot);
    const se = es.structEnergyQ(slot);
    const rm = es.reserveMassQ(slot);
    const re = es.reserveEnergyQ(slot);
    assert.equal(hasExactDensity(sm, se, RHO_STRUCT), true, `slot ${slot} STRUCT density mismatch`);
    assert.equal(hasExactDensity(rm, re, RHO_RESERVE), true, `slot ${slot} RESERVE density mismatch`);
  }
}

test('P5 Regression (Defect #1): Fault on COMMIT boundary aborts cleanly and POST_COMMIT fault never rewinds RngStreams', () => {
  const grid = WorldGrid.generate({ width: 10, height: 10, seed: 'p5-commit-boundary' });

  // Build control simulation with identical seed
  const runControl = (): ReturnType<typeof fullSimulationDigest>[] => {
    const ctrl = new BiologySimulation({
      grid,
      seed: 'p5-commit-boundary-sim',
      strictConservation: true,
    });
    ctrl.spawnFounderPopulation('raptor', 20);
    ctrl.step();
    const d1 = fullSimulationDigest(ctrl, ['raptor']);
    ctrl.step();
    const d2 = fullSimulationDigest(ctrl, ['raptor']);
    return [d1, d2];
  };
  const [ctrlTick1, ctrlTick2] = runControl();

  // Case A: Throw INSIDE onPhase({ phase: 'COMMIT' }) BEFORE tx.commit()
  let failOnCommitBoundary = true;
  const simPreCommit = new BiologySimulation({
    grid,
    seed: 'p5-commit-boundary-sim',
    strictConservation: true,
    onPhase: ({ phase }) => {
      if (phase === 'COMMIT' && failOnCommitBoundary) {
        throw new Error('Injected fault on boundary before COMMIT');
      }
    },
  });
  simPreCommit.spawnFounderPopulation('raptor', 20);

  const preDigest = fullSimulationDigest(simPreCommit, ['raptor']);
  assert.throws(() => simPreCommit.step(), /Injected fault on boundary before COMMIT/);

  // Transaction must be ABORTED (never stuck PREPARED) and RNG untouched
  assert.equal(simPreCommit.ledger.activeTransaction, null);
  assert.equal(simPreCommit.ledger.abortedTxCount, 1);
  assert.equal(simPreCommit.tick, 0);
  assert.equal(simPreCommit.entityStore.isSynchronized(), true);
  assert.equal(simPreCommit.energyGrid.isSynchronized(), true);
  assert.deepEqual(simPreCommit.streams.snapshotStates(), preDigest.rng);

  // Recovery step must match fault-free tick 1 bit-for-bit
  failOnCommitBoundary = false;
  simPreCommit.step();
  assert.deepEqual(fullSimulationDigest(simPreCommit, ['raptor']), ctrlTick1);

  // Case B: Throw INSIDE onPhase({ phase: 'POST_COMMIT' }) AFTER tx.commit()
  let failOnPostCommit = true;
  const simPostCommit = new BiologySimulation({
    grid,
    seed: 'p5-commit-boundary-sim',
    strictConservation: true,
    onPhase: ({ phase }) => {
      if (phase === 'POST_COMMIT' && failOnPostCommit) {
        throw new Error('Injected fault inside POST_COMMIT');
      }
    },
  });
  simPostCommit.spawnFounderPopulation('raptor', 20);

  assert.throws(() => simPostCommit.step(), /Injected fault inside POST_COMMIT/);
  // Tick 1 MUST stay committed AND RngStreams must NOT be rewound to tick 0!
  assert.equal(simPostCommit.ledger.activeTransaction, null);
  assert.equal(simPostCommit.tick, 1);
  assert.deepEqual(fullSimulationDigest(simPostCommit, ['raptor']), ctrlTick1);

  // Tick 2 must stay bit-identical to fault-free control tick 2
  failOnPostCommit = false;
  simPostCommit.step();
  assert.deepEqual(fullSimulationDigest(simPostCommit, ['raptor']), ctrlTick2);
});

test('P5 Atomicity: Consecutive multi-phase fault injections and ExternalEscrowFoodSource stay lossless & bit-identical to control', () => {
  const grid = WorldGrid.generate({ width: 10, height: 10, seed: 'p5-consecutive-faults' });
  const cell = firstLandCell(grid);

  const initialMass = new Array<number>(grid.cellCount).fill(0);
  const initialEnergy = new Array<number>(grid.cellCount).fill(0);
  initialMass[cell.cellIndex] = muToQ(15);
  initialEnergy[cell.cellIndex] = energyOfMass(initialMass[cell.cellIndex], RHO_PLANT);

  // Fault-free reference simulation
  const ctrlReg = makeAllGuildRegistry(false);
  const ctrlExt = new ExternalEscrowFoodSource({
    sourceId: 'ext-ctrl',
    poolKind: 'plant',
    cellCount: grid.cellCount,
    initialCellMassQ: initialMass,
    initialCellEnergyQ: initialEnergy,
  });
  const ctrlSim = new BiologySimulation({
    grid,
    seed: 'p5-consec-sim',
    speciesRegistry: ctrlReg,
    transactionalFoodSources: { plant: ctrlExt },
    strictConservation: true,
  });
  ctrlSim.spawnOrganism({
    speciesId: 'herbivore',
    x: cell.x,
    y: cell.y,
    sex: 'female',
    stage: 'adult',
    energy: 0.45,
    genome: createIndividualGenome(
      ctrlReg.get('herbivore').genomeSchema,
      ctrlReg.get('herbivore').traitBaselines,
      ctrlReg.get('herbivore').traitRanges,
      0,
      new SeededRng('g1')
    ),
  });
  ctrlSim.stepMany(3);
  const ctrlDigest3 = fullSimulationDigest(ctrlSim, ['herbivore']);

  // Fault-injected simulation: inject 5 consecutive faults across GATHER, RESOLVE, PRE_ALLOCATE, PREPARE, COMMIT boundary
  const faultSequence: Array<BiologyStepPhase | null> = [
    'GATHER',
    'RESOLVE',
    'PRE_ALLOCATE',
    'PREPARE',
    'COMMIT',
    null,
    'PREPARE',
    null,
    null,
  ];
  let stepCall = 0;

  const testReg = makeAllGuildRegistry(false);
  const testExt = new ExternalEscrowFoodSource({
    sourceId: 'ext-test',
    poolKind: 'plant',
    cellCount: grid.cellCount,
    initialCellMassQ: initialMass,
    initialCellEnergyQ: initialEnergy,
  });
  const testSim = new BiologySimulation({
    grid,
    seed: 'p5-consec-sim',
    speciesRegistry: testReg,
    transactionalFoodSources: { plant: testExt },
    strictConservation: true,
    onPhase: ({ phase }) => {
      const target = faultSequence[stepCall];
      if (target === phase) {
        throw new Error(`Fault at stepCall=${stepCall} phase=${phase}`);
      }
    },
  });
  testSim.spawnOrganism({
    speciesId: 'herbivore',
    x: cell.x,
    y: cell.y,
    sex: 'female',
    stage: 'adult',
    energy: 0.45,
    genome: createIndividualGenome(
      testReg.get('herbivore').genomeSchema,
      testReg.get('herbivore').traitBaselines,
      testReg.get('herbivore').traitRanges,
      0,
      new SeededRng('g1')
    ),
  });

  for (; stepCall < faultSequence.length; stepCall++) {
    if (faultSequence[stepCall] !== null) {
      const prevDigest = fullSimulationDigest(testSim, ['herbivore']);
      assert.throws(() => testSim.step(), /Fault at stepCall=/);
      assert.equal(testSim.ledger.activeTransaction, null);
      assert.equal(testSim.entityStore.isSynchronized(), true);
      assert.equal(testSim.energyGrid.isSynchronized(), true);
      assert.equal(testSim.tick, prevDigest.tick);
      assert.deepEqual(testSim.streams.snapshotStates(), prevDigest.rng);
      assert.equal(testExt.auditInventory().ok, true);
      const auditMid = testSim.assertEnergyAudit();
      assert.equal(auditMid.massResidualQ, 0n);
      assert.equal(auditMid.energyResidualQ, 0n);
    } else {
      testSim.step();
    }
  }

  assert.equal(testSim.tick, 3);
  assert.deepEqual(fullSimulationDigest(testSim, ['herbivore']), ctrlDigest3);
  assert.deepEqual(testExt.auditInventory(), ctrlExt.auditInventory());
});

test('P5 Regression (Defect #2): All 6 post*Fast helpers reject invalid/NaN/negative/float quanta with zero partial mutation', () => {
  const eg = new WorldEnergyGrid({ width: 2, height: 1 });
  const es = new EntityEnergyStore(4);
  const ledger = new EnergyLedger({ initialAbioticMassQ: 1_000_000n, strictStoichiometry: true });
  ledger.registerStore(eg);
  ledger.registerStore(es);

  const gtx = ledger.begin(0, { genesis: true });
  gtx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.CELL_PLANT, 0, 500, 1500);
  gtx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_STRUCT, 0, 100, 500);
  gtx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_RESERVE, 0, 100, 3000);
  gtx.prepare();
  gtx.commit();

  const badInputs = [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1];
  const tx = ledger.begin(1);

  for (const bad of badInputs) {
    const pBefore = eg.getStagedMassQ(EnergyPool.PLANT, 0);
    const oStructBefore = es.stagedBalance(AccountKind.ORGANISM_STRUCT, 0, false);
    const oResBefore = es.stagedBalance(AccountKind.ORGANISM_RESERVE, 0, false);
    const carBefore = eg.getStagedMassQ(EnergyPool.CARRION, 0);

    assert.throws(
      () => tx.postConsumePairFast(PostingReason.METABOLISM, AccountKind.ORGANISM_RESERVE, 0, 10, bad),
      UnitsError
    );
    assert.throws(
      () => tx.postConsumePairFast(PostingReason.METABOLISM, AccountKind.ORGANISM_RESERVE, 0, bad, 30),
      UnitsError
    );
    assert.throws(
      () => tx.postPhotosynthesisPairFast(PostingReason.PHOTOSYNTHESIS, AccountKind.CELL_PLANT, 0, 10, bad),
      UnitsError
    );
    assert.throws(
      () => tx.postFeedingFast(AccountKind.CELL_PLANT, 0, 0, 0, 2, 60, 1, 3, 1, bad),
      UnitsError
    );
    assert.throws(
      () => tx.postSomaticGrowthFast(0, 5, bad, 1, 0, 0),
      UnitsError
    );
    assert.throws(
      () => tx.postSomaticGrowthFast(0, bad, 0, 1, 0, 0),
      UnitsError
    );
    assert.throws(
      () => tx.postReproductionProvisioningFast(0, 1, 50, 30, bad, 1, 10, 0, 0),
      UnitsError
    );
    assert.throws(
      () => tx.postDeathToCarrionFast(0, 0, 10, bad, 5, 150),
      UnitsError
    );
    assert.throws(
      () => tx.postDeathToCarrionFast(0, 0, bad, 50, 5, 150),
      UnitsError
    );

    // Zero partial buffer mutations allowed after any rejected call!
    assert.equal(eg.getStagedMassQ(EnergyPool.PLANT, 0), pBefore);
    assert.equal(es.stagedBalance(AccountKind.ORGANISM_STRUCT, 0, false), oStructBefore);
    assert.equal(es.stagedBalance(AccountKind.ORGANISM_RESERVE, 0, false), oResBefore);
    assert.equal(eg.getStagedMassQ(EnergyPool.CARRION, 0), carBefore);
  }

  // Invalid self-transfer and non-active routes must still reject like regular post methods
  assert.throws(
    () => tx.postReproductionProvisioningFast(0, 0, 5, 30, 5, 1, 1, 0, 0),
    EnergyRuleError
  );
  tx.abort();
  ledger.assertAudit();
});

test('P5 Fast vs Slow Equivalence: stage*Fast and compute*Fast produce bit-identical state to slow reference helpers', () => {
  const setupPair = () => {
    const mk = () => {
      const eg = new WorldEnergyGrid({ width: 4, height: 1 });
      const es = new EntityEnergyStore(16);
      const ledger = new EnergyLedger({ initialAbioticMassQ: 5_000_000_000n, strictStoichiometry: true });
      ledger.registerStore(eg);
      ledger.registerStore(es);
      const g = ledger.begin(0, { genesis: true });
      g.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.CELL_PLANT, 0, 500_000, 1_500_000);
      g.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.CELL_DETRITUS, 1, 200_000, 600_000);
      g.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_STRUCT, 0, 1_000_000, 5_000_000);
      g.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_RESERVE, 0, 200_000, 6_000_000);
      g.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_STRUCT, 1, 800_000, 4_000_000);
      g.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_RESERVE, 1, 100_000, 3_000_000);
      g.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_STRUCT, 2, 400_000, 2_000_000);
      g.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_RESERVE, 2, 50_000, 1_500_000);
      g.prepare();
      g.commit();
      return { eg, es, ledger };
    };
    return { slow: mk(), fast: mk() };
  };

  const { slow, fast } = setupPair();
  const profile = makeSpecies('equiv-sp', 'omnivore', { plant: 0.2, prey: 0.5, carrion: 0.2, detritus: 0.1 }, 4.0).trophicProfile!;

  // Compare metabolic demand calculation
  assert.equal(
    computeTotalMetabolicDemandFast(
      profile.basalMetabolicFactor,
      profile.thermoregulationFactor,
      profile.activityCostFactor,
      1_000_000,
      200_000,
      0.35,
      1.7
    ),
    computeTotalMetabolicDemandQ(profile, 1_000_000, 200_000, 0.35, 1.7)
  );

  // Compare feeding plans across edge cases (0, small, headroom-capped, zero-headroom)
  const feedScratch: MutableFeedingPlanOut = {
    depositMassQ: 0,
    depositEnergyQ: 0,
    egestaMassQ: 0,
    egestaEnergyQ: 0,
    abioticMassQ: 0,
    heatQ: 0,
  };
  for (const [m, e, h] of [
    [0, 0, 1000],
    [1000, 3000, 0],
    [1000, 3000, 10],
    [12345, 37035, 50000],
  ]) {
    const slowPlan = computeFeedingPlan(m, e, profile, h);
    computeFeedingPlanFast(m, e, 840_000, 840_000, 160_000, h, feedScratch);
    assert.deepEqual(feedScratch, {
      depositMassQ: slowPlan.depositMassQ,
      depositEnergyQ: slowPlan.depositEnergyQ,
      egestaMassQ: slowPlan.egestaMassQ,
      egestaEnergyQ: slowPlan.egestaEnergyQ,
      abioticMassQ: slowPlan.abioticMassQ,
      heatQ: slowPlan.heatQ,
    });
  }

  // Run matching transactions: slow path vs fast path
  const txS = slow.ledger.begin(1);
  const txF = fast.ledger.begin(1);

  const metabS = stageMetabolism(txS, 0, slow.es.stagedBalance(AccountKind.ORGANISM_RESERVE, 0, false), 175, 10);
  const metabF: MutableReserveMetabolismOut = { burnMassQ: 0, burnEnergyQ: 0, nextCarryCreditQ: 0, deficitQ: 0 };
  stageMetabolismFast(txF, 0, fast.es.stagedBalance(AccountKind.ORGANISM_RESERVE, 0, false), 175, 10, metabF);
  assert.deepEqual(metabF, metabS);

  // Feeding from plant -> organism 0, plus CELL_DETRITUS self-egestion edge case
  stageFeeding(txS, AccountKind.CELL_PLANT, 0, 0, 0, 20_000, 60_000, profile, 100_000);
  stageFeedingFast(txF, AccountKind.CELL_PLANT, 0, 0, 0, 20_000, 60_000, 840_000, 840_000, 160_000, 100_000, feedScratch);

  stageFeeding(txS, AccountKind.CELL_DETRITUS, 1, 0, 1, 15_000, 45_000, profile, 100_000);
  stageFeedingFast(txF, AccountKind.CELL_DETRITUS, 1, 0, 1, 15_000, 45_000, 840_000, 840_000, 160_000, 100_000, feedScratch);

  // Predation of slot 2 by slot 0
  stagePreyPredation(txS, 2, 0, 0, 5_000, profile, 100_000);
  stagePreyPredationFast(
    txF,
    2,
    fast.es.stagedBalance(AccountKind.ORGANISM_STRUCT, 2, false),
    fast.es.stagedBalance(AccountKind.ORGANISM_RESERVE, 2, false),
    0,
    0,
    5_000,
    840_000,
    840_000,
    160_000,
    100_000,
    feedScratch
  );

  // Somatic growth of slot 1 (maturityScale = 1 -> targetStructMassQ = 4_000_000)
  const growS = stageSomaticGrowth(
    txS,
    1,
    slow.es.stagedBalance(AccountKind.ORGANISM_STRUCT, 1, false),
    slow.es.stagedBalance(AccountKind.ORGANISM_RESERVE, 1, false),
    Number(txS.stagedMassQ(AccountKind.ABIOTIC, 0)),
    profile,
    1
  );
  const growF = stageSomaticGrowthFast(
    txF,
    1,
    fast.es.stagedBalance(AccountKind.ORGANISM_STRUCT, 1, false),
    fast.es.stagedBalance(AccountKind.ORGANISM_RESERVE, 1, false),
    txF.stagedAbioticMassQFast(),
    growS.targetStructMassQ,
    180_000,
    680_000
  );
  assert.equal(growF, growS.structGainMassQ);

  // Reproduction provisioning slot 0 -> egg slot 3
  const reproS = stageReproductionProvisioning(
    txS,
    0,
    3,
    slow.es.stagedBalance(AccountKind.ORGANISM_RESERVE, 0, false),
    Number(txS.stagedMassQ(AccountKind.ABIOTIC, 0)),
    50_000,
    20_000,
    profile
  );
  const reproScratch: MutableReproductionProvisioningOut = {
    provisioned: false,
    childStructMassQ: 0,
    childStructEnergyQ: 0,
    childReserveMassQ: 0,
    childReserveEnergyQ: 0,
    burnReserveMassQ: 0,
    burnReserveEnergyQ: 0,
    abioticInMassQ: 0,
    abioticOutMassQ: 0,
    heatQ: 0,
  };
  const okF = stageReproductionProvisioningFast(
    txF,
    0,
    3,
    fast.es.stagedBalance(AccountKind.ORGANISM_RESERVE, 0, false),
    txF.stagedAbioticMassQFast(),
    50_000,
    20_000,
    750_000,
    reproScratch
  );
  assert.equal(okF, reproS.provisioned);

  // Death of slot 2 -> carrion cell 2, scavenge, carrion decomposition, detritus decomposition
  stageDeathToCarrion(
    txS,
    2,
    2,
    slow.es.stagedBalance(AccountKind.ORGANISM_STRUCT, 2, false),
    slow.es.stagedBalance(AccountKind.ORGANISM_RESERVE, 2, false)
  );
  stageDeathToCarrionFast(
    txF,
    2,
    2,
    fast.es.stagedBalance(AccountKind.ORGANISM_STRUCT, 2, false),
    fast.es.stagedBalance(AccountKind.ORGANISM_RESERVE, 2, false)
  );

  const cmS = slow.eg.getStagedMassQ(EnergyPool.CARRION, 2);
  const ceS = slow.eg.getStagedEnergyQ(EnergyPool.CARRION, 2);
  const cmF = fast.eg.getStagedMassQ(EnergyPool.CARRION, 2);
  const ceF = fast.eg.getStagedEnergyQ(EnergyPool.CARRION, 2);
  assert.equal(cmF, cmS);
  assert.equal(ceF, ceS);
  const slowBite = planCarrionConsumption(cmS, ceS, 12_345);
  const fastBite = { structMassQ: 0, structEnergyQ: 0, reserveMassQ: 0, reserveEnergyQ: 0, totalMassQ: 0, totalEnergyQ: 0 };
  planCarrionConsumptionFast(cmF, ceF, 12_345, fastBite);
  assert.deepEqual(fastBite, slowBite);

  stageCarrionScavenge(txS, 2, 1, 2, 12_345, profile, 100_000);
  stageCarrionScavengeFast(txF, 2, cmF, ceF, 1, 2, 12_345, 840_000, 840_000, 160_000, 100_000, feedScratch);

  stageCarrionDecomposition(txS, 2, 150_000);
  stageCarrionDecompositionFast(
    txF,
    2,
    fast.eg.getStagedMassQ(EnergyPool.CARRION, 2),
    fast.eg.getStagedEnergyQ(EnergyPool.CARRION, 2),
    150_000
  );

  stageDetritusDecomposition(txS, 1, 80_000);
  stageDetritusDecompositionFast(txF, 1, fast.eg.getStagedMassQ(EnergyPool.DETRITUS, 1), 80_000);

  txS.prepare();
  txS.commit();
  txF.prepare();
  txF.commit();

  assert.deepEqual(fast.ledger.assertAudit(), slow.ledger.assertAudit());
  for (let slot = 0; slot < 4; slot++) {
    assert.equal(fast.es.structMassQ(slot), slow.es.structMassQ(slot));
    assert.equal(fast.es.structEnergyQ(slot), slow.es.structEnergyQ(slot));
    assert.equal(fast.es.reserveMassQ(slot), slow.es.reserveMassQ(slot));
    assert.equal(fast.es.reserveEnergyQ(slot), slow.es.reserveEnergyQ(slot));
  }
  for (let cell = 0; cell < 4; cell++) {
    assert.equal(fast.eg.getMassQ(EnergyPool.PLANT, cell), slow.eg.getMassQ(EnergyPool.PLANT, cell));
    assert.equal(fast.eg.getEnergyQ(EnergyPool.PLANT, cell), slow.eg.getEnergyQ(EnergyPool.PLANT, cell));
    assert.equal(fast.eg.getMassQ(EnergyPool.CARRION, cell), slow.eg.getMassQ(EnergyPool.CARRION, cell));
    assert.equal(fast.eg.getEnergyQ(EnergyPool.CARRION, cell), slow.eg.getEnergyQ(EnergyPool.CARRION, cell));
    assert.equal(fast.eg.getMassQ(EnergyPool.DETRITUS, cell), slow.eg.getMassQ(EnergyPool.DETRITUS, cell));
    assert.equal(fast.eg.getEnergyQ(EnergyPool.DETRITUS, cell), slow.eg.getEnergyQ(EnergyPool.DETRITUS, cell));
  }
});

test('P5 Determinism, Permutations, Multi-Generation Lifecycle & 7-Buffer WorldGrid SHA-256 Integrity', () => {
  const grid = WorldGrid.generate({ width: 14, height: 12, seed: 'p5-determinism-world' });
  const hashesBefore = hashAllWorldGridBuffers(grid);

  const runVariant = (opts: {
    statsInterval: number;
    recordHistory: boolean;
    interleavedReads: boolean;
    reverseOrderInCell: boolean;
  }) => {
    const reg = makeAllGuildRegistry(true);
    const sim = new BiologySimulation({
      grid,
      seed: 'p5-determinism-sim',
      speciesRegistry: reg,
      strictConservation: true,
      statsInterval: opts.statsInterval,
      recordHistory: opts.recordHistory,
      trackMutationEvents: opts.interleavedReads,
      mutationConfigOverride: { baseRate: 0.25, stepScale: 0.08, directionalBias: 0.0 },
    });

    const speciesOrder = ['raptor', 'herbivore', 'carnivore', 'omnivore', 'scavenger', 'detritivore'];
    if (opts.reverseOrderInCell) {
      // Spawn per-species founders in same order so RNG matches, plus test PopulationManager unsorted array permutation
      for (const sId of speciesOrder) {
        sim.spawnFounderPopulation(sId, 16);
      }
      const pops = (sim as unknown as { populations: Map<string, { active: Organism[] }> }).populations;
      for (const sId of speciesOrder) {
        const pop = pops.get(sId);
        if (pop && pop.active.length > 2) {
          // Reverse internal active array order while preserving exact organism IDs
          pop.active.reverse();
        }
      }
    } else {
      for (const sId of speciesOrder) {
        sim.spawnFounderPopulation(sId, 16);
      }
    }

    for (let t = 0; t < 60; t++) {
      sim.step();
      if (opts.interleavedReads) {
        for (const sId of speciesOrder) {
          sim.getStats(sId);
          sim.getOrganisms(sId);
        }
        sim.getEnergyAudit();
        sim.getHistory();
        sim.getTrackedMutations();
      }
      if (t % 10 === 9) {
        assertAllCellsAndSlotsStoichiometric(sim);
      }
    }

    const digest = fullSimulationDigest(sim, speciesOrder);
    return { sim, digest };
  };

  const baseline = runVariant({ statsInterval: 1, recordHistory: true, interleavedReads: true, reverseOrderInCell: false });
  const quiet = runVariant({ statsInterval: 15, recordHistory: false, interleavedReads: false, reverseOrderInCell: false });
  const permuted = runVariant({ statsInterval: 1, recordHistory: false, interleavedReads: false, reverseOrderInCell: true });

  assert.deepEqual(quiet.digest, baseline.digest, 'Diagnostic reads / statsInterval / recordHistory must never alter state');
  assert.deepEqual(permuted.digest, baseline.digest, 'In-memory active array order permutation must produce bit-identical state');

  // Verify >= 2 generations + aging/births/deaths/mutations/all guilds active
  let maxGen = 0;
  let totalBirths = 0;
  let totalDeaths = 0;
  for (const sId of ['raptor', 'herbivore', 'carnivore', 'omnivore', 'scavenger', 'detritivore']) {
    const st = baseline.sim.getStats(sId);
    if (st.maxGeneration > maxGen) maxGen = st.maxGeneration;
    totalBirths += st.birthsTotal;
    totalDeaths += st.deathsTotal;
  }
  assert.ok(maxGen >= 2, `Expected >= 2 generations, got maxGeneration=${maxGen}`);
  assert.ok(totalBirths > 0 && totalDeaths > 0, `Expected births (${totalBirths}) and deaths (${totalDeaths})`);
  assert.ok(baseline.sim.getTrackedMutations().length > 0, 'Expected real genetic mutations over multi-generation run');

  // Verify all 7 WorldGrid TypedArray buffers are bit-identical after simulation
  const hashesAfter = hashAllWorldGridBuffers(grid);
  assert.deepEqual(hashesAfter, hashesBefore, 'WorldGrid 7 buffers must remain strictly immutable');
});

test('P5 Boundary & Thermal Chaos Stress: extreme temperatures, scarcity, tiny reserves, extinction/recovery keep I1-I5 with 0n residuals', () => {
  for (const [label, tempOffset] of [
    ['extreme-cold', -55],
    ['extreme-heat', 45],
  ] as const) {
    const grid = WorldGrid.generate({
      width: 10,
      height: 10,
      seed: `p5-${label}`,
      temperatureOffset: tempOffset,
      moistureScale: 0.4,
    });
    const sim = new BiologySimulation({
      grid,
      seed: `p5-sim-${label}`,
      strictConservation: true,
      initialAbioticMassMU: 5_000,
      plantCarryingCapacityScale: 0.35,
    });
    sim.spawnFounderPopulation('raptor', 35, { stage: 'adult' });

    for (let t = 0; t < 40; t++) {
      sim.step();
      const audit = sim.assertEnergyAudit();
      assert.equal(audit.massResidualQ, 0n, `${label} tick ${t + 1}: non-zero mass residual`);
      assert.equal(audit.energyResidualQ, 0n, `${label} tick ${t + 1}: non-zero energy residual`);
    }

    // Re-seed if extinct and keep ticking (tests extinction -> 0-org abiotic cycling -> re-colonization slot reuse)
    if (sim.getStats('raptor').totalAlive === 0) {
      sim.spawnFounderPopulation('raptor', 10, { stage: 'juvenile' });
    }
    sim.stepMany(15);
    assertAllCellsAndSlotsStoichiometric(sim);
    const finalAudit = sim.assertEnergyAudit();
    assert.equal(finalAudit.massResidualQ, 0n);
    assert.equal(finalAudit.energyResidualQ, 0n);
  }
});
