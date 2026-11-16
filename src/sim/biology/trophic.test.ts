import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountKind, PostingReason } from '../energyAccounts';
import { EnergyLedger } from '../energyLedger';
import { EntityEnergyStore } from '../stagedStore';
import {
  PPM,
  RHO_DETRITUS,
  RHO_PLANT,
  RHO_RESERVE,
  RHO_STRUCT,
  energyOfMass,
  muToQ,
} from '../units';
import { EnergyPool, WorldEnergyGrid } from '../worldEnergyGrid';
import { WorldGrid } from '../worldGrid';
import {
  DeterministicPreyFoodProvider,
} from './foodProvider';
import {
  RAPTOR_SPECIES,
  SpeciesDefinition,
  SpeciesRegistry,
  createDefaultSpeciesRegistry,
} from './species';
import {
  ExternalEscrowFoodSource,
  GridPoolFoodSource,
  NonConservingFoodProviderError,
  assertPhysicallyClosedFoodProvider,
  stageCompetitiveTransactionalForaging,
} from './transactionalFoodSource';
import {
  computeBiteMassForHeadroom,
  computeFeedingPlan,
  computeMaxReserveMassQ,
  computeMetabolicDemandBreakdownQ,
  computeReserveHeadroomMassQ,
  computeTargetStructMassQ,
  stageCarrionDecomposition,
  stageCarrionScavenge,
  stageDeathToCarrion,
  stageDetritusDecomposition,
  stageFeeding,
  stageMetabolism,
  stagePreyPredation,
  stageReproductionProvisioning,
  stageSomaticGrowth,
} from './trophicNutrition';
import {
  TROPHIC_TYPES,
  TrophicProfile,
  dietWeightsToPpm,
  normalizeDietWeights,
  validateTrophicProfile,
} from './trophicProfile';

function makeProfile(overrides: Partial<TrophicProfile> = {}): TrophicProfile {
  const feedingType = overrides.feedingType ?? 'omnivore';
  const defaultWeights =
    feedingType === 'herbivore'
      ? { plant: 1, prey: 0, carrion: 0, detritus: 0 }
      : feedingType === 'carnivore'
        ? { plant: 0, prey: 0.9, carrion: 0.1, detritus: 0 }
        : feedingType === 'scavenger'
          ? { plant: 0, prey: 0, carrion: 0.8, detritus: 0.2 }
          : feedingType === 'detritivore'
            ? { plant: 0, prey: 0, carrion: 0.1, detritus: 0.9 }
            : { plant: 0.5, prey: 0.4, carrion: 0.1, detritus: 0 };

  return Object.freeze({
    feedingType,
    dietWeights: overrides.dietWeights ?? defaultWeights,
    adultStructuralMassMU: 10,
    maxReserveToStructuralRatio: 1.5,
    absorptionEfficiency: 0.8,
    assimilationEfficiency: 0.8,
    growthEfficiency: 0.7,
    structuralAllocationFraction: 0.25,
    basalMetabolicFactor: 1.0,
    thermoregulationFactor: 0.4,
    activityCostFactor: 0.3,
    reproductiveEfficiency: 0.75,
    ...overrides,
  });
}

function createStrictEconomy(cellCount = 8, entityCount = 16, abioticMassMU = 10000) {
  const ledger = new EnergyLedger({
    initialAbioticMassQ: BigInt(muToQ(abioticMassMU)),
    escrowSlots: 8,
    journalCapacity: 1024,
    strictStoichiometry: true,
  });
  const grid = new WorldEnergyGrid({ width: cellCount, height: 1 });
  const entities = new EntityEnergyStore(entityCount);
  ledger.registerStore(grid);
  ledger.registerStore(entities);
  return { ledger, grid, entities };
}

test('TrophicProfile: supports all 5 trophic types, validates 10 parameters, and normalizes diet weights to exact PPM', () => {
  for (const guild of TROPHIC_TYPES) {
    const p = makeProfile({ feedingType: guild });
    assert.doesNotThrow(() => validateTrophicProfile(p, guild));
  }

  // Normalization & exact PPM sum invariant
  const norm = normalizeDietWeights({ plant: 3, prey: 2, carrion: 1, detritus: 0 });
  assert.ok(Math.abs(norm.plant + norm.prey + norm.carrion + norm.detritus - 1) < 1e-12);
  const ppm = dietWeightsToPpm({ plant: 1, prey: 1, carrion: 1, detritus: 0 });
  assert.equal(ppm.plantPpm + ppm.preyPpm + ppm.carrionPpm + ppm.detritusPpm, PPM);

  // Invalid bounds on each parameter
  assert.throws(() => validateTrophicProfile(makeProfile({ adultStructuralMassMU: 0 })), RangeError);
  assert.throws(() => validateTrophicProfile(makeProfile({ adultStructuralMassMU: -1 })), RangeError);
  assert.throws(() => validateTrophicProfile(makeProfile({ maxReserveToStructuralRatio: 0 })), RangeError);
  assert.throws(() => validateTrophicProfile(makeProfile({ absorptionEfficiency: 0 })), RangeError);
  assert.throws(() => validateTrophicProfile(makeProfile({ absorptionEfficiency: 1.1 })), RangeError);
  assert.throws(() => validateTrophicProfile(makeProfile({ assimilationEfficiency: 0 })), RangeError);
  assert.throws(() => validateTrophicProfile(makeProfile({ growthEfficiency: 0 })), RangeError);
  assert.throws(() => validateTrophicProfile(makeProfile({ structuralAllocationFraction: -0.01 })), RangeError);
  assert.throws(() => validateTrophicProfile(makeProfile({ structuralAllocationFraction: 1.01 })), RangeError);
  assert.throws(() => validateTrophicProfile(makeProfile({ basalMetabolicFactor: -0.1 })), RangeError);
  assert.throws(() => validateTrophicProfile(makeProfile({ thermoregulationFactor: Number.NaN })), RangeError);
  assert.throws(() => validateTrophicProfile(makeProfile({ activityCostFactor: Infinity })), RangeError);
  assert.throws(() => validateTrophicProfile(makeProfile({ reproductiveEfficiency: 0 })), RangeError);

  // Guild diet consistency checks
  assert.throws(
    () =>
      validateTrophicProfile(
        makeProfile({
          feedingType: 'herbivore',
          dietWeights: { plant: 0.9, prey: 0.1, carrion: 0, detritus: 0 },
        })
      ),
    RangeError
  );
  assert.throws(
    () =>
      validateTrophicProfile(
        makeProfile({
          feedingType: 'carnivore',
          dietWeights: { plant: 0.2, prey: 0.8, carrion: 0, detritus: 0 },
        })
      ),
    RangeError
  );
  assert.throws(
    () =>
      validateTrophicProfile(
        makeProfile({
          feedingType: 'scavenger',
          dietWeights: { plant: 0.5, prey: 0, carrion: 0.5, detritus: 0 },
        })
      ),
    RangeError
  );
  assert.throws(
    () =>
      validateTrophicProfile(
        makeProfile({
          feedingType: 'detritivore',
          dietWeights: { plant: 0, prey: 0.2, carrion: 0, detritus: 0.8 },
        })
      ),
    RangeError
  );
  assert.throws(
    () =>
      validateTrophicProfile(
        makeProfile({
          feedingType: 'omnivore',
          dietWeights: { plant: 1, prey: 0, carrion: 0, detritus: 0 },
        })
      ),
    RangeError
  );
});

test('SpeciesRegistry: legacy RAPTOR_SPECIES adapter works cleanly and explicit trophic profiles are validated', () => {
  assert.equal(RAPTOR_SPECIES.trophicProfile, undefined);
  const registry = createDefaultSpeciesRegistry();
  const raptorProfile = registry.getTrophicProfile('raptor');
  assert.equal(raptorProfile.feedingType, 'carnivore');
  assert.doesNotThrow(() => validateTrophicProfile(raptorProfile, 'carnivore'));

  // Register custom scavenger species with explicit trophicProfile
  const vulture: SpeciesDefinition = {
    ...RAPTOR_SPECIES,
    id: 'vulture',
    name: 'Vulture',
    diet: 'scavenger',
    trophicProfile: makeProfile({ feedingType: 'scavenger' }),
  };
  registry.register(vulture);
  assert.equal(registry.getTrophicProfile('vulture').feedingType, 'scavenger');

  // Mismatched species diet vs trophicProfile fails validation at registration
  const mismatched: SpeciesDefinition = {
    ...RAPTOR_SPECIES,
    id: 'bad-species',
    name: 'Bad',
    diet: 'herbivore',
    trophicProfile: makeProfile({ feedingType: 'carnivore' }),
  };
  const reg2 = new SpeciesRegistry();
  assert.throws(() => reg2.register(mismatched), RangeError);
});

test('TrophicNutrition: all 10 TrophicProfile parameters act orthogonally without double counting', () => {
  // 1. adultStructuralMassMU
  const smallAdult = computeTargetStructMassQ(makeProfile({ adultStructuralMassMU: 5 }));
  const largeAdult = computeTargetStructMassQ(makeProfile({ adultStructuralMassMU: 15 }));
  assert.equal(smallAdult, muToQ(5));
  assert.equal(largeAdult, muToQ(15));

  // 2. maxReserveToStructuralRatio
  const sMass = muToQ(10);
  const lowCap = computeMaxReserveMassQ(sMass, makeProfile({ maxReserveToStructuralRatio: 0.5 }));
  const highCap = computeMaxReserveMassQ(sMass, makeProfile({ maxReserveToStructuralRatio: 2.0 }));
  assert.equal(lowCap, muToQ(5));
  assert.equal(highCap, muToQ(20));
  assert.equal(computeReserveHeadroomMassQ(sMass, muToQ(4), makeProfile({ maxReserveToStructuralRatio: 0.5 })), muToQ(1));
  assert.equal(computeReserveHeadroomMassQ(sMass, muToQ(6), makeProfile({ maxReserveToStructuralRatio: 0.5 })), 0);

  // 3. absorptionEfficiency vs 4. assimilationEfficiency (strictly orthogonal: abs controls detritus egestion, assim controls SDA heat)
  const foodM = muToQ(10);
  const foodE = energyOfMass(foodM, RHO_PLANT);
  const basePlan = computeFeedingPlan(foodM, foodE, makeProfile({ absorptionEfficiency: 0.6, assimilationEfficiency: 0.8 }));
  const higherAbsPlan = computeFeedingPlan(foodM, foodE, makeProfile({ absorptionEfficiency: 0.9, assimilationEfficiency: 0.8 }));
  const higherAssimPlan = computeFeedingPlan(foodM, foodE, makeProfile({ absorptionEfficiency: 0.6, assimilationEfficiency: 0.95 }));

  assert.ok(higherAbsPlan.egestaMassQ < basePlan.egestaMassQ, 'Higher absorption must decrease detritus egestion');
  assert.equal(higherAssimPlan.egestaMassQ, basePlan.egestaMassQ, 'Assimilation must NOT alter gut egestion (no double counting)');
  assert.equal(higherAssimPlan.egestaEnergyQ, basePlan.egestaEnergyQ);
  assert.ok(higherAssimPlan.sdaHeatQ < basePlan.sdaHeatQ, 'Higher assimilation must strictly reduce SDA heat loss');
  assert.ok(higherAssimPlan.depositEnergyQ >= basePlan.depositEnergyQ);

  // 5 & 6. growthEfficiency & structuralAllocationFraction
  const runGrowthCase = (growthEfficiency: number, structuralAllocationFraction: number) => {
    const { ledger, entities } = createStrictEconomy(2, 4, 1000);
    const gTx = ledger.begin(0, { genesis: true });
    gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_STRUCT, 0, muToQ(2), energyOfMass(muToQ(2), RHO_STRUCT));
    gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_RESERVE, 0, muToQ(4), energyOfMass(muToQ(4), RHO_RESERVE));
    gTx.prepare();
    gTx.commit();

    const tx = ledger.begin(1);
    const plan = stageSomaticGrowth(
      tx,
      0,
      entities.structMassQ(0),
      entities.reserveMassQ(0),
      Number(ledger.globalAbioticMassQ),
      makeProfile({ adultStructuralMassMU: 50, growthEfficiency, structuralAllocationFraction })
    );
    tx.prepare();
    tx.commit();
    ledger.assertAudit();
    ledger.assertStoichiometry();
    return plan;
  };
  const gBase = runGrowthCase(0.5, 0.2);
  const gHigherEff = runGrowthCase(0.9, 0.2);
  const gHigherAlloc = runGrowthCase(0.5, 0.5);
  assert.ok(gHigherEff.structGainMassQ > gBase.structGainMassQ);
  assert.ok(gHigherEff.heatQ < gBase.heatQ || gHigherEff.structGainMassQ > gBase.structGainMassQ);
  assert.ok(gHigherAlloc.burnReserveMassQ > gBase.burnReserveMassQ);
  assert.ok(gHigherAlloc.structGainMassQ > gBase.structGainMassQ);

  // 7, 8, 9. basalMetabolicFactor, thermoregulationFactor, activityCostFactor
  const mBase = computeMetabolicDemandBreakdownQ(
    makeProfile({ basalMetabolicFactor: 1.0, thermoregulationFactor: 0.4, activityCostFactor: 0.3 }),
    muToQ(10),
    muToQ(6),
    2.0,
    1.5
  );
  const mHighBasal = computeMetabolicDemandBreakdownQ(
    makeProfile({ basalMetabolicFactor: 2.0, thermoregulationFactor: 0.4, activityCostFactor: 0.3 }),
    muToQ(10),
    muToQ(6),
    2.0,
    1.5
  );
  assert.ok(mHighBasal.basalDemandQ > mBase.basalDemandQ);
  assert.equal(mHighBasal.thermoregulationDemandQ, mBase.thermoregulationDemandQ);
  assert.equal(mHighBasal.activityDemandQ, mBase.activityDemandQ);

  const mHighThermo = computeMetabolicDemandBreakdownQ(
    makeProfile({ basalMetabolicFactor: 1.0, thermoregulationFactor: 1.2, activityCostFactor: 0.3 }),
    muToQ(10),
    muToQ(6),
    2.0,
    1.5
  );
  assert.equal(mHighThermo.basalDemandQ, mBase.basalDemandQ);
  assert.ok(mHighThermo.thermoregulationDemandQ > mBase.thermoregulationDemandQ);
  assert.equal(mHighThermo.activityDemandQ, mBase.activityDemandQ);

  const mHighActivity = computeMetabolicDemandBreakdownQ(
    makeProfile({ basalMetabolicFactor: 1.0, thermoregulationFactor: 0.4, activityCostFactor: 1.0 }),
    muToQ(10),
    muToQ(6),
    2.0,
    1.5
  );
  assert.equal(mHighActivity.basalDemandQ, mBase.basalDemandQ);
  assert.equal(mHighActivity.thermoregulationDemandQ, mBase.thermoregulationDemandQ);
  assert.ok(mHighActivity.activityDemandQ > mBase.activityDemandQ);

  const mAtRestZeroStress = computeMetabolicDemandBreakdownQ(
    makeProfile({ basalMetabolicFactor: 1.0, thermoregulationFactor: 5.0, activityCostFactor: 5.0 }),
    muToQ(10),
    muToQ(6),
    0,
    0
  );
  assert.equal(mAtRestZeroStress.thermoregulationDemandQ, 0);
  assert.equal(mAtRestZeroStress.activityDemandQ, 0);

  // 10. reproductiveEfficiency
  const runReproCase = (reproductiveEfficiency: number) => {
    const { ledger, entities } = createStrictEconomy(2, 4, 1000);
    const gTx = ledger.begin(0, { genesis: true });
    gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_STRUCT, 0, muToQ(10), energyOfMass(muToQ(10), RHO_STRUCT));
    gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_RESERVE, 0, muToQ(12), energyOfMass(muToQ(12), RHO_RESERVE));
    gTx.prepare();
    gTx.commit();

    const tx = ledger.begin(1);
    const res = stageReproductionProvisioning(
      tx,
      0,
      1,
      entities.reserveMassQ(0),
      Number(ledger.globalAbioticMassQ),
      muToQ(2),
      muToQ(1),
      makeProfile({ reproductiveEfficiency })
    );
    tx.prepare();
    tx.commit();
    ledger.assertAudit();
    ledger.assertStoichiometry();
    return res;
  };
  const rLow = runReproCase(0.5);
  const rHigh = runReproCase(0.9);
  assert.equal(rLow.provisioned, true);
  assert.equal(rHigh.provisioned, true);
  assert.ok(rHigh.burnReserveMassQ < rLow.burnReserveMassQ);
  assert.ok(rHigh.heatQ < rLow.heatQ);
});

test('All 5 trophic guilds execute strict-stoichiometry lifecycle under EnergyLedger with 0n residual', () => {
  const { ledger, grid, entities } = createStrictEconomy(6, 12, 10000);

  // Genesis: seed plant (cells 0, 4), detritus (cell 1), prey organism (slot 1), and 5 guild consumers (slots 2..6)
  const gTx = ledger.begin(0, { genesis: true });
  gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.CELL_PLANT, 0, muToQ(100), energyOfMass(muToQ(100), RHO_PLANT));
  gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.CELL_PLANT, 4, muToQ(100), energyOfMass(muToQ(100), RHO_PLANT));
  gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.CELL_DETRITUS, 1, muToQ(100), energyOfMass(muToQ(100), RHO_DETRITUS));
  // Live prey in slot 1 + victim to die into carrion in cell 2 (slot 7)
  for (const slot of [1, 2, 3, 4, 5, 6, 7]) {
    gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_STRUCT, slot, muToQ(10), energyOfMass(muToQ(10), RHO_STRUCT));
    gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_RESERVE, slot, muToQ(2), energyOfMass(muToQ(2), RHO_RESERVE));
  }
  gTx.prepare();
  gTx.commit();

  const tx1 = ledger.begin(1);
  // Death -> mixed CELL_CARRION in cell 2
  stageDeathToCarrion(tx1, 7, 2, Number(tx1.stagedMassQ(AccountKind.ORGANISM_STRUCT, 7)), Number(tx1.stagedMassQ(AccountKind.ORGANISM_RESERVE, 7)));

  // 1. Herbivore feeds from CELL_PLANT[0]
  const herbPlan = stageFeeding(
    tx1,
    AccountKind.CELL_PLANT,
    0,
    2,
    0,
    muToQ(20),
    energyOfMass(muToQ(20), RHO_PLANT),
    makeProfile({ feedingType: 'herbivore' })
  );
  assert.ok(herbPlan.depositMassQ > 0);
  assert.ok(herbPlan.egestaMassQ > 0);

  // 2. Detritivore feeds from CELL_DETRITUS[1]
  const detPlan = stageFeeding(
    tx1,
    AccountKind.CELL_DETRITUS,
    1,
    3,
    1,
    muToQ(20),
    energyOfMass(muToQ(20), RHO_DETRITUS),
    makeProfile({ feedingType: 'detritivore' })
  );
  assert.ok(detPlan.depositMassQ > 0);

  // 3. Scavenger scavenges partial bite from CELL_CARRION[2], then remaining carrion partially decomposes
  const scavOut = stageCarrionScavenge(
    tx1,
    2,
    4,
    2,
    muToQ(4.321),
    makeProfile({ feedingType: 'scavenger' })
  );
  assert.equal(scavOut.bite.totalMassQ, muToQ(4.321));
  const decompOut = stageCarrionDecomposition(tx1, 2, 250_000);
  assert.ok(decompOut.decomposedMassQ > 0);
  const detDecompOut = stageDetritusDecomposition(tx1, 1, 100_000);
  assert.ok(detDecompOut.decomposedMassQ > 0);

  // 4. Carnivore eats live prey organism in slot 1
  const carnOut = stagePreyPredation(tx1, 1, 5, 3, muToQ(5), makeProfile({ feedingType: 'carnivore' }));
  assert.equal(carnOut.bite.totalMassQ, muToQ(5));

  // 5. Omnivore eats plant from cell 4 + carrion from cell 2
  const omniPlant = stageFeeding(
    tx1,
    AccountKind.CELL_PLANT,
    4,
    6,
    4,
    muToQ(10),
    energyOfMass(muToQ(10), RHO_PLANT),
    makeProfile({ feedingType: 'omnivore' })
  );
  const omniScav = stageCarrionScavenge(tx1, 2, 6, 4, muToQ(2), makeProfile({ feedingType: 'omnivore' }));
  assert.ok(omniPlant.depositMassQ > 0 && omniScav.feeding.depositMassQ > 0);

  tx1.prepare();
  tx1.commit();

  const audit = ledger.assertAudit();
  assert.equal(audit.massResidualQ, 0n);
  assert.equal(audit.energyResidualQ, 0n);
  assert.doesNotThrow(() => ledger.assertStoichiometry());
  assert.ok(grid.getMassQ(EnergyPool.CARRION, 2) > 0);
  assert.ok(entities.reserveMassQ(2) > muToQ(2));
  assert.ok(entities.reserveMassQ(5) > muToQ(2));
});

test('Quantization boundaries: sub-quantum metabolism carryCreditQ avoids 30x overburn, and scarcity leaves struct intact', () => {
  const { ledger, entities } = createStrictEconomy(2, 2, 1000);
  const initialReserveQ = 500;
  const gTx = ledger.begin(0, { genesis: true });
  gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_STRUCT, 0, 1000, energyOfMass(1000, RHO_STRUCT));
  gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_RESERVE, 0, initialReserveQ, energyOfMass(initialReserveQ, RHO_RESERVE));
  gTx.prepare();
  gTx.commit();

  // Burn 7 qEU per tick for 300 ticks = 2100 qEU total = exact 70 qMU (without carryCredit it would burn 300 qMU!)
  let carry = 0;
  let totalDeficit = 0;
  for (let tick = 1; tick <= 300; tick++) {
    const tx = ledger.begin(tick);
    const plan = stageMetabolism(tx, 0, entities.reserveMassQ(0), 7, carry);
    carry = plan.nextCarryCreditQ;
    totalDeficit += plan.deficitQ;
    tx.prepare();
    tx.commit();
  }
  assert.equal(totalDeficit, 0);
  assert.equal(carry, 0);
  assert.equal(initialReserveQ - entities.reserveMassQ(0), 70);

  // Scarcity starvation: exhaust remaining reserve (430 * 30 = 12900 qEU) and verify ORGANISM_STRUCT is never burnt
  const starveTx = ledger.begin(301);
  const starvePlan = stageMetabolism(starveTx, 0, entities.reserveMassQ(0), 20_000, 0);
  assert.equal(starvePlan.burnMassQ, 430);
  assert.equal(starvePlan.deficitQ, 20_000 - 430 * 30);
  starveTx.prepare();
  starveTx.commit();

  assert.equal(entities.reserveMassQ(0), 0);
  assert.equal(entities.structMassQ(0), 1000, 'ORGANISM_STRUCT must NEVER be burned for metabolism');
  ledger.assertAudit();
  ledger.assertStoichiometry();
});

test('TransactionalFoodSource: GridPoolFoodSource contention is order-invariant across consumer permutations', () => {
  const runWithOrder = (order: number[]) => {
    const { ledger, grid, entities } = createStrictEconomy(4, 8, 5000);
    const gTx = ledger.begin(0, { genesis: true });
    // Scarce plant stock (17 qMU total for 3 competing consumers wanting 10 each -> Hamilton split!)
    gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.CELL_PLANT, 0, 17_000_000, energyOfMass(17_000_000, RHO_PLANT));
    for (const slot of [0, 1, 2]) {
      gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_STRUCT, slot, 10_000_000, energyOfMass(10_000_000, RHO_STRUCT));
    }
    gTx.prepare();
    gTx.commit();

    const plantSource = new GridPoolFoodSource(grid, 'plant');
    const herbProfile = makeProfile({ feedingType: 'herbivore' });

    const requests = order.map((id) => ({
      organismId: id,
      entitySlot: id - 100,
      cellIndex: 0,
      requestedMassQ: id === 100 ? 10_000_001 : 10_000_000,
      profile: herbProfile,
    }));

    const tx = ledger.begin(1);
    const outcomes = stageCompetitiveTransactionalForaging(ledger, tx, plantSource, entities, requests, 1);
    tx.prepare();
    tx.commit();
    ledger.assertAudit();
    ledger.assertStoichiometry();

    return {
      outcomes,
      reserves: [0, 1, 2].map((s) => entities.reserveMassQ(s)),
      plantLeft: grid.getMassQ(EnergyPool.PLANT, 0),
    };
  };

  const a = runWithOrder([100, 101, 102]);
  const b = runWithOrder([102, 100, 101]);
  assert.deepEqual(a, b);
  assert.equal(a.plantLeft, 0);
});

test('TransactionalFoodSource + ExternalEscrowFoodSource: failure rollback, no-callback COMMIT, and idempotent escrow reuse without duplication', () => {
  // Part A: Mid-transaction external failure rolls back cleanly without changing inventory or ledger
  {
    const { ledger, entities } = createStrictEconomy(2, 4, 5000);
    const gTx = ledger.begin(0, { genesis: true });
    gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_STRUCT, 0, muToQ(5), energyOfMass(muToQ(5), RHO_STRUCT));
    gTx.prepare();
    gTx.commit();

    const external = new ExternalEscrowFoodSource({
      cellCount: 2,
      initialCellMassQ: [muToQ(20), 0],
      initialCellEnergyQ: [energyOfMass(muToQ(20), RHO_PLANT), 0],
      beforeCommit: () => {
        throw new Error('simulated external IO failure');
      },
    });

    const tx = ledger.begin(1);
    assert.throws(
      () =>
        stageCompetitiveTransactionalForaging(
          ledger,
          tx,
          external,
          entities,
          [
            {
              organismId: 1,
              entitySlot: 0,
              cellIndex: 0,
              requestedMassQ: muToQ(10),
              profile: makeProfile({ feedingType: 'carnivore' }),
              escrowSlot: 0,
            },
          ],
          1
        ),
      /simulated external IO failure/
    );
    tx.abort();
    assert.equal(external.auditInventory().ok, true);
    assert.equal(external.auditInventory().freeMassQ, BigInt(muToQ(20)));
    assert.equal(external.auditInventory().pendingMassQ, 0n);
    assert.equal(ledger.escrowMassQ(0), 0n);
    ledger.assertAudit();
  }

  // Part B: Escrow survives PREPARE failure -> retry reuses ESCROW without duplicating external withdrawal,
  // and zero callbacks fire during COMMIT
  {
    const { ledger, entities } = createStrictEconomy(2, 4, 5000);
    const gTx = ledger.begin(0, { genesis: true });
    gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_STRUCT, 0, muToQ(10), energyOfMass(muToQ(10), RHO_STRUCT));
    gTx.prepare();
    gTx.commit();

    let hookCalls = 0;
    const external = new ExternalEscrowFoodSource({
      cellCount: 2,
      initialCellMassQ: [muToQ(20), 0],
      initialCellEnergyQ: [energyOfMass(muToQ(20), RHO_PLANT), 0],
      beforeCommit: () => {
        hookCalls++;
      },
    });

    // Attempt 1: pulls 8 MU into ESCROW[0], consumes into entity 0, then corrupted/invalid debit triggers abort
    const tx1 = ledger.begin(1);
    const out1 = stageCompetitiveTransactionalForaging(
      ledger,
      tx1,
      external,
      entities,
      [
        {
          organismId: 1,
          entitySlot: 0,
          cellIndex: 0,
          requestedMassQ: muToQ(8),
          profile: makeProfile({ feedingType: 'carnivore' }),
          escrowSlot: 0,
        },
      ],
      1
    );
    assert.equal(out1[0].pulledExternalMassQ, muToQ(8));
    assert.equal(out1[0].consumedFromEscrowMassQ, 0);
    assert.equal(hookCalls, 1);

    // Abort tx1 before commit -> entity gains nothing, but external withdrawal stays durably in ESCROW[0]
    tx1.abort();
    assert.equal(entities.reserveMassQ(0), 0);
    assert.equal(ledger.escrowMassQ(0), BigInt(muToQ(8)));
    assert.equal(external.auditInventory().freeMassQ, BigInt(muToQ(12)));

    // Attempt 2: Retry for same 8 MU -> MUST consume exclusively from ESCROW[0] with 0 new external withdrawal!
    const tx2 = ledger.begin(1);
    const out2 = stageCompetitiveTransactionalForaging(
      ledger,
      tx2,
      external,
      entities,
      [
        {
          organismId: 1,
          entitySlot: 0,
          cellIndex: 0,
          requestedMassQ: muToQ(8),
          profile: makeProfile({ feedingType: 'carnivore' }),
          escrowSlot: 0,
        },
      ],
      1
    );
    assert.equal(out2[0].consumedFromEscrowMassQ, muToQ(8));
    assert.equal(out2[0].pulledExternalMassQ, 0);
    assert.equal(hookCalls, 1, 'Retry must NOT re-withdraw already escrowed mass');

    tx2.prepare();
    const hooksBeforeCommit = hookCalls;
    tx2.commit();
    assert.equal(hookCalls, hooksBeforeCommit, 'COMMIT must never invoke external callbacks');

    assert.equal(ledger.escrowMassQ(0), 0n);
    assert.equal(external.auditInventory().ok, true);
    assert.equal(external.auditInventory().withdrawnMassQ, BigInt(muToQ(8)));
    assert.equal(external.auditInventory().freeMassQ, BigInt(muToQ(12)));
    assert.ok(entities.reserveMassQ(0) > 0);
    ledger.assertAudit();
    ledger.assertStoichiometry();
  }
});

test('DeterministicPreyFoodProvider: conservative mode rejects unbacked prey creation, draws from plant/detritus donors cleanly, and rejects non-conserving providers in strict mode', () => {
  const world = WorldGrid.generate({ width: 4, height: 2, seed: 'p2-prey-test' });
  // Ensure cell 0 is land with high capacity
  world.setCellByIndex(0, {
    terrain: 'lowland',
    biome: 'savanna',
    temperature: 25,
    hasWater: false,
  });

  // 1. Legacy mode flags non-closure explicitly and is rejected in strict conservation mode
  const legacyProvider = new DeterministicPreyFoodProvider(world);
  assert.equal(legacyProvider.conservationMode, 'legacy-non-conserving');
  assert.equal(legacyProvider.isPhysicallyClosed, false);
  assert.throws(
    () => assertPhysicallyClosedFoodProvider(legacyProvider, true),
    NonConservingFoodProviderError
  );

  // 2. Conservative mode: 0 donor pools -> 0 regeneration (zero ex-nihilo creation)
  const ledger = new EnergyLedger({
    initialAbioticMassQ: BigInt(muToQ(10000)),
    escrowSlots: 4,
    journalCapacity: 512,
    strictStoichiometry: true,
  });
  const energyGrid = new WorldEnergyGrid({ width: 4, height: 2 });
  const preyStore = new EntityEnergyStore(world.cellCount + 4);
  ledger.registerStore(energyGrid);
  ledger.registerStore(preyStore);

  const conservativePrey = new DeterministicPreyFoodProvider(world, {
    regenerationRate: 0.5,
    capacityScale: 2.0,
    conservative: {
      ledger,
      energyGrid,
      preyStore,
      preySlotOffset: 0,
      plantDonorShare: 0.75,
    },
  });
  assert.equal(conservativePrey.conservationMode, 'conservative');
  assert.equal(conservativePrey.isPhysicallyClosed, true);
  assert.doesNotThrow(() => assertPhysicallyClosedFoodProvider(conservativePrey, true));

  // Reject unsafe non-transactional calls in conservative mode
  const dummyCtx = {
    cellIndex: 0,
    x: 0,
    y: 0,
    terrain: 'lowland' as const,
    biome: 'savanna' as const,
    temperature: 25,
    moisture: 0.5,
    tick: 1,
  };
  assert.throws(() => conservativePrey.consumePrey(dummyCtx, 1), NonConservingFoodProviderError);
  assert.throws(() => conservativePrey.stepTick(1), NonConservingFoodProviderError);
  assert.throws(() => conservativePrey.setCellPrey(0, 5, 5), NonConservingFoodProviderError);

  // Step with EMPTY donor pools -> zero prey regenerated
  const txEmpty = ledger.begin(1);
  const gainedWhenEmpty = conservativePrey.stepTickConservative(txEmpty, 1);
  txEmpty.prepare();
  txEmpty.commit();
  assert.equal(gainedWhenEmpty, 0);
  assert.equal(conservativePrey.getAvailablePreyMassQ(0), 0);

  // Seed plant + detritus donors on cell 0 (100 MU each) & carnivore in slot world.cellCount
  const carnivoreSlot = world.cellCount;
  const gTx = ledger.begin(2, { genesis: true });
  gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.CELL_PLANT, 0, muToQ(100), energyOfMass(muToQ(100), RHO_PLANT));
  gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.CELL_DETRITUS, 0, muToQ(100), energyOfMass(muToQ(100), RHO_DETRITUS));
  gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_STRUCT, carnivoreSlot, muToQ(10), energyOfMass(muToQ(10), RHO_STRUCT));
  gTx.prepare();
  gTx.commit();

  const plantBefore = energyGrid.getMassQ(EnergyPool.PLANT, 0);
  const txRegen = ledger.begin(3);
  const gained = conservativePrey.stepTickConservative(txRegen, 3);
  txRegen.prepare();
  txRegen.commit();

  assert.ok(gained > 0, 'Prey must regenerate when donor plant/detritus pools exist');
  assert.ok(energyGrid.getMassQ(EnergyPool.PLANT, 0) < plantBefore, 'Donor plant pool must decrease');
  assert.equal(conservativePrey.getAvailablePreyMassQ(0), gained);

  // Carnivore consumes conservative prey via TransactionalFoodSource
  const preySource = conservativePrey.createTransactionalFoodSource();
  const txHunt = ledger.begin(4);
  const huntOutcomes = stageCompetitiveTransactionalForaging(
    ledger,
    txHunt,
    preySource,
    preyStore,
    [
      {
        organismId: 500,
        entitySlot: carnivoreSlot,
        cellIndex: 0,
        requestedMassQ: Math.floor(gained / 2),
        profile: makeProfile({ feedingType: 'carnivore' }),
      },
    ],
    4
  );
  txHunt.prepare();
  txHunt.commit();

  assert.ok(huntOutcomes[0].feedingPlan.depositMassQ > 0);
  assert.ok(preyStore.reserveMassQ(carnivoreSlot) > 0);
  const audit = ledger.assertAudit();
  assert.equal(audit.massResidualQ, 0n);
  assert.equal(audit.energyResidualQ, 0n);
  assert.doesNotThrow(() => ledger.assertStoichiometry());
});

test('Boundary saturation: computeBiteMassForHeadroom, abiotic-bounded growth, and reproduction guardrails conserve exact stoichiometry', () => {
  const { ledger, grid, entities } = createStrictEconomy(2, 4, 2); // tiny abiotic pool = 2 MU

  const gTx = ledger.begin(0, { genesis: true });
  gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.CELL_PLANT, 0, muToQ(50), energyOfMass(muToQ(50), RHO_PLANT));
  gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_STRUCT, 0, muToQ(2), energyOfMass(muToQ(2), RHO_STRUCT));
  gTx.transferBiomass(PostingReason.GENESIS, AccountKind.GENESIS, 0, AccountKind.ORGANISM_RESERVE, 0, muToQ(3), energyOfMass(muToQ(3), RHO_RESERVE));
  gTx.prepare();
  gTx.commit();

  const profile = makeProfile({
    feedingType: 'herbivore',
    adultStructuralMassMU: 20,
    maxReserveToStructuralRatio: 1.5, // max reserve = 1.5 * 2 = 3 MU -> headroom = 0!
    structuralAllocationFraction: 0.5,
    growthEfficiency: 0.9,
  });

  // 1. Reserve already at cap -> headroom bite MUST be 0, and clamped feeding deposits 0
  const headroom0 = computeReserveHeadroomMassQ(entities.structMassQ(0), entities.reserveMassQ(0), profile);
  assert.equal(headroom0, 0);
  const zeroBite = computeBiteMassForHeadroom(
    grid.getMassQ(EnergyPool.PLANT, 0),
    grid.getEnergyQ(EnergyPool.PLANT, 0),
    muToQ(20),
    headroom0,
    profile,
    'plant'
  );
  assert.equal(zeroBite, 0);

  const clampedPlan = computeFeedingPlan(muToQ(10), energyOfMass(muToQ(10), RHO_PLANT), profile, headroom0);
  assert.equal(clampedPlan.depositMassQ, 0);
  assert.equal(clampedPlan.depositEnergyQ, 0);
  assert.equal(clampedPlan.clampedByHeadroom, true);
  assert.equal(clampedPlan.depositMassQ + clampedPlan.egestaMassQ + clampedPlan.abioticMassQ, muToQ(10));
  assert.equal(clampedPlan.depositEnergyQ + clampedPlan.egestaEnergyQ + clampedPlan.heatQ, energyOfMass(muToQ(10), RHO_PLANT));

  // 2. Reproduction guardrails return clean 0-posting failure when reserve or abiotic is insufficient
  const txGuard = ledger.begin(1);
  const tooBigRepro = stageReproductionProvisioning(
    txGuard,
    0,
    1,
    entities.reserveMassQ(0),
    Number(ledger.globalAbioticMassQ),
    muToQ(10), // requires > 3 MU maternal reserve -> rejected
    muToQ(1),
    profile
  );
  assert.equal(tooBigRepro.provisioned, false);
  assert.equal(tooBigRepro.reason, 'insufficient-reserve');
  assert.equal(txGuard.massPostingCount, 0);

  const noAbioticRepro = stageReproductionProvisioning(
    txGuard,
    0,
    1,
    entities.reserveMassQ(0),
    0, // zero abiotic available while trying to synthesize structural mass > reserve burnt
    muToQ(3),
    0,
    profile
  );
  assert.equal(noAbioticRepro.provisioned, false);
  assert.equal(noAbioticRepro.reason, 'insufficient-abiotic');
  assert.equal(txGuard.massPostingCount, 0);

  // 3. Abiotic-bounded somatic growth respects 2 MU abiotic ceiling and preserves 0n residual
  const growthPlan = stageSomaticGrowth(
    txGuard,
    0,
    entities.structMassQ(0),
    entities.reserveMassQ(0),
    Number(ledger.globalAbioticMassQ),
    profile,
    1
  );
  assert.ok(growthPlan.structGainMassQ > 0);
  assert.ok(growthPlan.abioticInMassQ <= Number(ledger.globalAbioticMassQ));
  txGuard.prepare();
  txGuard.commit();

  const audit = ledger.assertAudit();
  assert.equal(audit.massResidualQ, 0n);
  assert.equal(audit.energyResidualQ, 0n);
  assert.doesNotThrow(() => ledger.assertStoichiometry());
});

