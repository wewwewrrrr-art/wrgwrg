/**
 * Reference scenarios of the energy economy, executed through the real
 * EnergyLedger / EnergyTransaction / WorldEnergyGrid stack and checked for ZERO residual in
 * exact quanta.
 *
 * Scenarios 1-8 preserve the original P1 baseline parameters for regression continuity; Scenarios
 * R3-1..R3-4 exercise `strictStoichiometry: true` against confirmed Revision 3 densities
 * (`PLANT = 3`, `DETRITUS = 3`, `STRUCT = 5`, `RESERVE = 30 EU/MU`).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { detExp, detPow075 } from './detMath';
import { AccountKind, AccountKindId, PostingReason } from './energyAccounts';
import { EnergyLedger } from './energyLedger';
import { EnergyInvariantError, EnergyRuleError, EnergyTransaction } from './energyTransaction';
import { SeededRng } from './prng';
import { EntityEnergyStore, InsufficientBalanceError } from './stagedStore';
import {
  RHO_DETRITUS,
  applyPpm,
  energyDensity,
  energyOfMass,
  euToQ,
  formatEU,
  formatMU,
  fractionToPpm,
  hasExactDensity,
  isValidCarrionMix,
  massForEnergy,
  parseEU,
  parseMU,
  planCarrionConsumption,
  planCarrionDecomposition,
  planFeedingAllocation,
  planReserveMetabolism,
  qToMU,
  resolveContention,
  scaleByRatio,
} from './units';
import { EnergyPool, WorldEnergyGrid } from './worldEnergyGrid';

const K = AccountKind;
const R = PostingReason;

// Design example densities (EU per MU)
const RHO_PLANT = energyDensity(3);
const RHO_STRUCT = energyDensity(5);
const RHO_RESERVE = energyDensity(30);

const MU = (text: string): number => parseMU(text);
const EU = (text: string): number => parseEU(text);

function createWorld(abioticMU = '1000') {
  const grid = new WorldEnergyGrid({ width: 4, height: 1 });
  const organisms = new EntityEnergyStore(8);
  const ledger = new EnergyLedger({ initialAbioticMassQ: BigInt(MU(abioticMU)), journalCapacity: 256 });
  ledger.registerStore(grid);
  ledger.registerStore(organisms);
  return { grid, organisms, ledger };
}
type World = ReturnType<typeof createWorld>;

function spawn(tx: EnergyTransaction, slot: number, structMU: string, reserveMU: string): void {
  const s = MU(structMU);
  const r = MU(reserveMU);
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.ORGANISM_STRUCT, slot, s, energyOfMass(s, RHO_STRUCT));
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.ORGANISM_RESERVE, slot, r, energyOfMass(r, RHO_RESERVE));
}

function seedPlants(tx: EnergyTransaction, cell: number, massMU: string): void {
  const m = MU(massMU);
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, cell, m, energyOfMass(m, RHO_PLANT));
}

function genesis(world: World, build: (tx: EnergyTransaction) => void): void {
  const tx = world.ledger.begin(0, { genesis: true });
  build(tx);
  tx.prepare();
  tx.commit();
}

function commitTick(world: World, tick: number, build: (tx: EnergyTransaction) => void): void {
  const tx = world.ledger.begin(tick);
  try {
    build(tx);
    tx.prepare();
    tx.commit();
  } catch (error) {
    tx.abort();
    throw error;
  }
}

interface Totals {
  mass: bigint;
  energy: bigint;
  abiotic: bigint;
  sun: bigint;
  heat: bigint;
}

function totals(world: World): Totals {
  const audit = world.ledger.assertAudit();
  return {
    mass: audit.actualMassQ,
    energy: audit.actualEnergyQ,
    abiotic: world.ledger.globalAbioticMassQ,
    sun: world.ledger.sunEnergyInQ,
    heat: world.ledger.heatEnergyOutQ,
  };
}

/** Zero-residual check of both balances between two snapshots. */
function assertBalanced(before: Totals, after: Totals): void {
  // Energy (open system): delta stock == SUN in - HEAT out
  assert.equal(after.energy - before.energy, after.sun - before.sun - (after.heat - before.heat), 'energy residual must be 0 quanta');
  // Mass (closed system, finite abiotic pool included): delta == 0
  assert.equal(after.mass - before.mass, 0n, 'mass residual must be 0 quanta');
}

// --- Process helpers: exact integer arithmetic only -------------------------------------------

interface FeedingResult {
  depositMassQ: number;
  depositEnergyQ: number;
  egestaMassQ: number;
  egestaEnergyQ: number;
  heatQ: number;
  abioticMassQ: number;
}

/**
 * An organism eats `massQ` / `energyQ` of food from a pool: assimilated energy is stored as
 * reserve tissue, the unassimilated part becomes detritus, the heat increment of feeding and the
 * sub-quantum rounding dust are dissipated, and the remaining matter returns to the abiotic pool.
 */
function eat(
  tx: EnergyTransaction,
  srcKind: AccountKindId,
  srcId: number,
  eaterSlot: number,
  detritusCell: number,
  massQ: number,
  energyQ: number,
  assimilationPpm: number,
  sdaPpm: number
): FeedingResult {
  const assimilated = applyPpm(energyQ, assimilationPpm);
  const egestaEnergyQ = energyQ - assimilated;
  const sda = applyPpm(assimilated, sdaPpm);
  const depositable = assimilated - sda;
  const depositMassQ = massForEnergy(depositable, RHO_RESERVE, 'floor');
  const depositEnergyQ = energyOfMass(depositMassQ, RHO_RESERVE);
  const heatQ = sda + (depositable - depositEnergyQ);
  const egestaMassQ = massQ - applyPpm(massQ, assimilationPpm);
  const abioticMassQ = massQ - depositMassQ - egestaMassQ;
  tx.transferBiomass(R.INGESTION, srcKind, srcId, K.ORGANISM_RESERVE, eaterSlot, depositMassQ, depositEnergyQ);
  tx.transferBiomass(R.EGESTION, srcKind, srcId, K.CELL_DETRITUS, detritusCell, egestaMassQ, egestaEnergyQ);
  tx.postEnergy(R.SDA, srcKind, srcId, K.HEAT, 0, heatQ);
  tx.postMass(R.SDA, srcKind, srcId, K.ABIOTIC, 0, abioticMassQ);
  assert.equal(depositEnergyQ + egestaEnergyQ + heatQ, energyQ);
  assert.equal(depositMassQ + egestaMassQ + abioticMassQ, massQ);
  return { depositMassQ, depositEnergyQ, egestaMassQ, egestaEnergyQ, heatQ, abioticMassQ };
}

/**
 * Pays a metabolic demand from the reserve ONLY. Returns the unpaid deficit, which the biology
 * layer converts into health loss; structural tissue is never touched.
 */
function payMetabolism(world: World, tx: EnergyTransaction, slot: number, demandQ: number): number {
  const available = world.organisms.stagedBalance(K.ORGANISM_RESERVE, slot, true);
  const reserveMass = world.organisms.stagedBalance(K.ORGANISM_RESERVE, slot, false);
  const paid = Math.min(demandQ, available);
  // Burn whole reserve-tissue quanta; when the reserve is exhausted its last matter goes too.
  const massQ = paid === available ? reserveMass : massForEnergy(paid, RHO_RESERVE, 'floor');
  tx.postEnergy(R.METABOLISM, K.ORGANISM_RESERVE, slot, K.HEAT, 0, paid);
  tx.postMass(R.METABOLISM, K.ORGANISM_RESERVE, slot, K.ABIOTIC, 0, massQ);
  return demandQ - paid;
}

function die(world: World, tx: EnergyTransaction, slot: number, cell: number): { massQ: number; energyQ: number } {
  const o = world.organisms;
  const sm = o.stagedBalance(K.ORGANISM_STRUCT, slot, false);
  const se = o.stagedBalance(K.ORGANISM_STRUCT, slot, true);
  const rm = o.stagedBalance(K.ORGANISM_RESERVE, slot, false);
  const re = o.stagedBalance(K.ORGANISM_RESERVE, slot, true);
  tx.transferBiomass(R.DEATH, K.ORGANISM_STRUCT, slot, K.CELL_CARRION, cell, sm, se);
  tx.transferBiomass(R.DEATH, K.ORGANISM_RESERVE, slot, K.CELL_CARRION, cell, rm, re);
  return { massQ: sm + rm, energyQ: se + re };
}

function photosynthesis(world: World, tx: EnergyTransaction, cell: number): { gppQ: number; heatQ: number; growthMassQ: number } {
  const plantMass = world.grid.getStagedMassQ(EnergyPool.PLANT, cell);
  const plantEnergy = world.grid.getStagedEnergyQ(EnergyPool.PLANT, cell);
  const incident = EU('20000');
  // Canopy light interception 1 - exp(-k * M / Mref), k = 1, Mref = 2000 MU (deterministic exp)
  const absorbedPpm = fractionToPpm(1 - detExp(-qToMU(plantMass) / 2000), 'floor');
  let gppQ = applyPpm(incident, absorbedPpm);
  gppQ = applyPpm(gppQ, 20_000); // 2 % photosynthetic efficiency
  gppQ = applyPpm(gppQ, 900_000); // temperature factor 0.9
  gppQ = applyPpm(gppQ, 800_000); // moisture factor 0.8
  const maintenance = applyPpm(plantEnergy, 10_000); // 1 % of stored energy per tick
  const growthRespiration = applyPpm(gppQ - maintenance, 250_000);
  const npp = gppQ - maintenance - growthRespiration;
  const growthMassQ = massForEnergy(npp, RHO_PLANT, 'floor');
  const heatQ = gppQ - energyOfMass(growthMassQ, RHO_PLANT);
  tx.postEnergy(R.PHOTOSYNTHESIS, K.SUN, 0, K.CELL_PLANT, cell, gppQ);
  tx.postMass(R.PHOTOSYNTHESIS, K.ABIOTIC, 0, K.CELL_PLANT, cell, growthMassQ);
  tx.postEnergy(R.PLANT_RESPIRATION, K.CELL_PLANT, cell, K.HEAT, 0, heatQ);
  // Litterfall: 0.5 % of the standing biomass at the start of the tick
  const litterMass = applyPpm(plantMass, 5_000);
  tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, cell, K.CELL_DETRITUS, cell, litterMass, energyOfMass(litterMass, RHO_PLANT));
  return { gppQ, heatQ, growthMassQ };
}

function grow(tx: EnergyTransaction, slot: number, targetSlot: number, structMassQ: number, efficiencyNum: number, efficiencyDen: number, reason: 8 | 9): { heatQ: number; reserveMassQ: number } {
  const structEnergy = energyOfMass(structMassQ, RHO_STRUCT);
  const cost = scaleByRatio(structEnergy, efficiencyDen, efficiencyNum, 'ceil');
  const reserveMassQ = massForEnergy(cost, RHO_RESERVE, 'ceil');
  const reserveEnergy = energyOfMass(reserveMassQ, RHO_RESERVE);
  const heatQ = reserveEnergy - structEnergy;
  tx.postEnergy(reason, K.ORGANISM_RESERVE, slot, K.ORGANISM_STRUCT, targetSlot, structEnergy);
  tx.postEnergy(reason, K.ORGANISM_RESERVE, slot, K.HEAT, 0, heatQ);
  tx.postMass(reason, K.ORGANISM_RESERVE, slot, K.ABIOTIC, 0, reserveMassQ);
  tx.postMass(reason, K.ABIOTIC, 0, K.ORGANISM_STRUCT, targetSlot, structMassQ);
  return { heatQ, reserveMassQ };
}

// ------------------------------------------------------------------------------------------------

test('Scenario 1 — a plant fixes solar energy and builds biomass from abiotic matter', () => {
  const world = createWorld();
  genesis(world, (tx) => seedPlants(tx, 0, '1000'));
  const before = totals(world);
  let result!: ReturnType<typeof photosynthesis>;
  commitTick(world, 1, (tx) => {
    result = photosynthesis(world, tx, 0);
  });
  const after = totals(world);

  assert.equal(result.gppQ, EU('113.319072'), 'GPP');
  assert.equal(result.growthMassQ, MU('20.829768'), 'new biomass');
  assert.equal(result.heatQ, EU('50.829768'), 'respiration heat');
  assert.equal(world.grid.getMassQ(EnergyPool.PLANT, 0), MU('1015.829768'));
  assert.equal(world.grid.getEnergyQ(EnergyPool.PLANT, 0), EU('3047.489304'));
  // Energy density of the pool is preserved exactly
  assert.equal(world.grid.getEnergyQ(EnergyPool.PLANT, 0), energyOfMass(world.grid.getMassQ(EnergyPool.PLANT, 0), RHO_PLANT));
  assert.equal(world.grid.getMassQ(EnergyPool.DETRITUS, 0), MU('5'));
  assert.equal(world.grid.getEnergyQ(EnergyPool.DETRITUS, 0), EU('15'));
  // Photosynthesis creates no matter: growth came out of the finite abiotic pool
  assert.equal(before.abiotic - after.abiotic, BigInt(MU('20.829768')));
  assert.equal(after.sun - before.sun, BigInt(EU('113.319072')));
  assertBalanced(before, after);

  // With an exhausted abiotic pool the same growth is impossible and the tick aborts cleanly
  const starved = createWorld('10');
  genesis(starved, (tx) => seedPlants(tx, 0, '1000'));
  const snapshot = totals(starved);
  assert.throws(() => commitTick(starved, 1, (tx) => photosynthesis(starved, tx, 0)), InsufficientBalanceError);
  assert.deepEqual(totals(starved), snapshot);
  assert.equal(starved.grid.getMassQ(EnergyPool.PLANT, 0), MU('1000'));
});

test('Scenario 2 — a herbivore eats plants: assimilation, egesta, heat, and returned matter', () => {
  const world = createWorld();
  genesis(world, (tx) => {
    seedPlants(tx, 0, '1000');
    spawn(tx, 0, '40', '4');
  });
  const before = totals(world);
  let fed!: FeedingResult;
  commitTick(world, 1, (tx) => {
    const bite = MU('50');
    fed = eat(tx, K.CELL_PLANT, 0, 0, 0, bite, energyOfMass(bite, RHO_PLANT), 500_000, 100_000);
  });
  const after = totals(world);

  assert.equal(fed.depositMassQ, MU('2.25'));
  assert.equal(fed.depositEnergyQ, EU('67.5'));
  assert.equal(fed.egestaMassQ, MU('25'));
  assert.equal(fed.egestaEnergyQ, EU('75'));
  assert.equal(fed.heatQ, EU('7.5'));
  assert.equal(fed.abioticMassQ, MU('22.75'));
  assert.equal(world.grid.getMassQ(EnergyPool.PLANT, 0), MU('950'));
  assert.equal(world.grid.getEnergyQ(EnergyPool.PLANT, 0), EU('2850'));
  assert.equal(world.organisms.reserveMassQ(0), MU('6.25'));
  assert.equal(world.organisms.reserveEnergyQ(0), EU('187.5'));
  assert.equal(world.organisms.structMassQ(0), MU('40'), 'structure untouched by feeding');
  assert.equal(world.grid.getMassQ(EnergyPool.DETRITUS, 0), MU('25'));
  assert.equal(after.heat - before.heat, BigInt(EU('7.5')));
  assert.equal(after.abiotic - before.abiotic, BigInt(MU('22.75')));
  assertBalanced(before, after);
});

test('Scenario 3 — a predator kills and eats a herbivore; the remains become carrion', () => {
  const world = createWorld();
  genesis(world, (tx) => {
    spawn(tx, 0, '16', '1'); // predator
    spawn(tx, 1, '36', '4'); // prey: 40 MU, 300 EU
  });
  const before = totals(world);
  let fed!: FeedingResult;
  commitTick(world, 1, (tx) => {
    const body = die(world, tx, 1, 2);
    assert.equal(body.massQ, MU('40'));
    assert.equal(body.energyQ, EU('300'));
    const bite = MU('12');
    const biteEnergy = scaleByRatio(body.energyQ, bite, body.massQ, 'floor');
    fed = eat(tx, K.CELL_CARRION, 2, 0, 2, bite, biteEnergy, 800_000, 100_000);
  });
  const after = totals(world);

  assert.equal(fed.depositMassQ, MU('2.16'));
  assert.equal(fed.depositEnergyQ, EU('64.8'));
  assert.equal(fed.egestaMassQ, MU('2.4'));
  assert.equal(fed.egestaEnergyQ, EU('18'));
  assert.equal(fed.heatQ, EU('7.2'));
  assert.equal(fed.abioticMassQ, MU('7.44'));
  // Prey accounts are empty: nothing of the body vanished
  assert.equal(world.organisms.structMassQ(1) + world.organisms.reserveMassQ(1), 0);
  assert.equal(world.organisms.structEnergyQ(1) + world.organisms.reserveEnergyQ(1), 0);
  assert.equal(world.organisms.reserveMassQ(0), MU('3.16'));
  assert.equal(world.organisms.reserveEnergyQ(0), EU('94.8'));
  assert.equal(world.grid.getMassQ(EnergyPool.CARRION, 2), MU('28'));
  assert.equal(world.grid.getEnergyQ(EnergyPool.CARRION, 2), EU('210'));
  assertBalanced(before, after);
});

test('Scenario 4 — metabolism is paid from the reserve; starvation never burns structural mass', () => {
  const world = createWorld();
  genesis(world, (tx) => {
    spawn(tx, 0, '14', '2'); // well fed: 16 MU, 130 EU
    spawn(tx, 1, '14', '0.2'); // starving: reserve holds only 6 EU
  });
  // Kleiber-type demand: b0 * M^0.75 * activity, with M = 16 MU -> 8, b0 = 1 EU, activity 1.5
  const demand = euToQ(detPow075(16) * 1.5);
  assert.equal(demand, EU('12'));

  const before = totals(world);
  let deficitFed = -1;
  let deficitStarving = -1;
  commitTick(world, 1, (tx) => {
    deficitFed = payMetabolism(world, tx, 0, demand);
    deficitStarving = payMetabolism(world, tx, 1, demand);
    // The approved rule is enforced by the ledger itself, not only by the caller:
    assert.throws(() => tx.postEnergy(R.METABOLISM, K.ORGANISM_STRUCT, 1, K.HEAT, 0, 1), EnergyRuleError);
    assert.throws(() => tx.postMass(R.METABOLISM, K.ORGANISM_STRUCT, 1, K.ABIOTIC, 0, 1), EnergyRuleError);
  });
  const after = totals(world);

  assert.equal(deficitFed, 0);
  assert.equal(world.organisms.reserveMassQ(0), MU('1.6'));
  assert.equal(world.organisms.reserveEnergyQ(0), EU('118') - EU('70'));
  // Starving organism: reserve emptied, 6 EU of demand remain unpaid -> health loss upstream
  assert.equal(deficitStarving, EU('6'));
  assert.equal(world.organisms.reserveMassQ(1), 0);
  assert.equal(world.organisms.reserveEnergyQ(1), 0);
  assert.equal(world.organisms.structMassQ(1), MU('14'), 'structural mass is not burned');
  assert.equal(world.organisms.structEnergyQ(1), EU('70'), 'structural energy is not released');
  // Only energy that really existed was dissipated: 12 + 6, not 12 + 12
  assert.equal(after.heat - before.heat, BigInt(EU('18')));
  assertBalanced(before, after);

  // A further tick with an empty reserve dissipates nothing at all
  const mid = totals(world);
  commitTick(world, 2, (tx) => {
    assert.equal(payMetabolism(world, tx, 1, demand), demand);
  });
  const end = totals(world);
  assert.equal(end.heat, mid.heat);
  assert.equal(world.organisms.structMassQ(1), MU('14'));
  assertBalanced(mid, end);
});

test('Scenario 5 — growth converts reserve energy into structure and draws matter from the abiotic pool', () => {
  const world = createWorld();
  genesis(world, (tx) => spawn(tx, 0, '4', '0.8'));
  const before = totals(world);
  let result!: ReturnType<typeof grow>;
  commitTick(world, 1, (tx) => {
    result = grow(tx, 0, 0, MU('0.45'), 3, 4, R.GROWTH); // growth efficiency 0.75
  });
  const after = totals(world);

  assert.equal(result.reserveMassQ, MU('0.1'));
  assert.equal(result.heatQ, EU('0.75'));
  assert.equal(world.organisms.structMassQ(0), MU('4.45'));
  assert.equal(world.organisms.structEnergyQ(0), EU('22.25'));
  assert.equal(world.organisms.reserveMassQ(0), MU('0.7'));
  assert.equal(world.organisms.reserveEnergyQ(0), EU('21'));
  // Tissue densities are preserved exactly
  assert.equal(world.organisms.structEnergyQ(0), energyOfMass(world.organisms.structMassQ(0), RHO_STRUCT));
  assert.equal(world.organisms.reserveEnergyQ(0), energyOfMass(world.organisms.reserveMassQ(0), RHO_RESERVE));
  // Energy did not create mass: net 0.35 MU left the abiotic pool
  assert.equal(before.abiotic - after.abiotic, BigInt(MU('0.35')));
  assertBalanced(before, after);

  // Growth is limited by the finite abiotic pool
  const poor = createWorld('0.2');
  genesis(poor, (tx) => spawn(tx, 0, '4', '0.8'));
  assert.throws(() => commitTick(poor, 1, (tx) => grow(tx, 0, 0, MU('0.45'), 3, 4, R.GROWTH)), InsufficientBalanceError);
  assert.equal(poor.organisms.structMassQ(0), MU('4'));
  assert.equal(poor.organisms.reserveMassQ(0), MU('0.8'));
  poor.ledger.assertAudit();
});

test('Scenario 6 — reproduction: the mother provisions an egg; nothing is created from nothing', () => {
  const world = createWorld();
  genesis(world, (tx) => spawn(tx, 0, '16', '3.5'));
  const before = totals(world);
  commitTick(world, 1, (tx) => {
    // Yolk: direct transfer of reserve tissue, no loss
    const yolk = MU('0.08');
    tx.transferBiomass(R.REPRODUCTION, K.ORGANISM_RESERVE, 0, K.ORGANISM_RESERVE, 1, yolk, energyOfMass(yolk, RHO_RESERVE));
    // Egg structure: synthesised with efficiency 0.8
    const built = grow(tx, 0, 1, MU('0.72'), 4, 5, R.REPRODUCTION);
    assert.equal(built.heatQ, EU('0.9'));
    assert.equal(built.reserveMassQ, MU('0.15'));
  });
  const after = totals(world);

  assert.equal(world.organisms.reserveMassQ(0), MU('3.27'));
  assert.equal(world.organisms.reserveEnergyQ(0), EU('98.1'));
  assert.equal(world.organisms.structMassQ(0), MU('16'));
  // Egg: 0.8 MU, 6 EU
  assert.equal(world.organisms.structMassQ(1), MU('0.72'));
  assert.equal(world.organisms.structEnergyQ(1), EU('3.6'));
  assert.equal(world.organisms.reserveMassQ(1), MU('0.08'));
  assert.equal(world.organisms.reserveEnergyQ(1), EU('2.4'));
  // Mother lost exactly egg energy + overhead
  assert.equal(EU('105') - world.organisms.reserveEnergyQ(0), EU('6') + EU('0.9'));
  assert.equal(after.heat - before.heat, BigInt(EU('0.9')));
  assert.equal(before.abiotic - after.abiotic, BigInt(MU('0.57')));
  assertBalanced(before, after);

  // A mother without sufficient reserve cannot produce the egg; the attempt leaves no trace
  const weak = createWorld();
  genesis(weak, (tx) => spawn(tx, 0, '16', '0.1'));
  const snapshot = totals(weak);
  assert.throws(
    () =>
      commitTick(weak, 1, (tx) => {
        const yolk = MU('0.08');
        tx.transferBiomass(R.REPRODUCTION, K.ORGANISM_RESERVE, 0, K.ORGANISM_RESERVE, 1, yolk, energyOfMass(yolk, RHO_RESERVE));
        grow(tx, 0, 1, MU('0.72'), 4, 5, R.REPRODUCTION);
      }),
    InsufficientBalanceError
  );
  assert.deepEqual(totals(weak), snapshot);
  assert.equal(weak.organisms.reserveMassQ(1), 0, 'no partial egg');
});

test('Scenario 7 — death: structure and remaining reserve become carrion available to others', () => {
  const world = createWorld();
  genesis(world, (tx) => {
    spawn(tx, 0, '14', '2'); // dies: 16 MU, 130 EU
    spawn(tx, 1, '10', '1'); // scavenger
  });
  const before = totals(world);
  commitTick(world, 1, (tx) => {
    const body = die(world, tx, 0, 3);
    assert.equal(body.massQ, MU('16'));
    assert.equal(body.energyQ, EU('130'));
  });
  const dead = totals(world);
  assert.equal(world.organisms.structMassQ(0), 0);
  assert.equal(world.organisms.reserveMassQ(0), 0);
  assert.equal(world.grid.getMassQ(EnergyPool.CARRION, 3), MU('16'));
  assert.equal(world.grid.getEnergyQ(EnergyPool.CARRION, 3), EU('130'));
  assert.equal(dead.heat, before.heat, 'dying dissipates nothing by itself');
  assertBalanced(before, dead);

  let fed!: FeedingResult;
  commitTick(world, 2, (tx) => {
    // Scavenger takes 4 MU with the proportional share of energy
    const bite = MU('4');
    const carrionMass = world.grid.getStagedMassQ(EnergyPool.CARRION, 3);
    const carrionEnergy = world.grid.getStagedEnergyQ(EnergyPool.CARRION, 3);
    fed = eat(tx, K.CELL_CARRION, 3, 1, 3, bite, scaleByRatio(carrionEnergy, bite, carrionMass, 'floor'), 800_000, 100_000);
    // Then 10 % of what is left decomposes
    const restMass = world.grid.getStagedMassQ(EnergyPool.CARRION, 3);
    const restEnergy = world.grid.getStagedEnergyQ(EnergyPool.CARRION, 3);
    tx.postMass(R.DECOMPOSITION, K.CELL_CARRION, 3, K.ABIOTIC, 0, applyPpm(restMass, 100_000));
    tx.postEnergy(R.DECOMPOSITION, K.CELL_CARRION, 3, K.HEAT, 0, applyPpm(restEnergy, 100_000));
  });
  const after = totals(world);
  assert.equal(fed.depositEnergyQ, EU('23.4'));
  assert.equal(fed.depositMassQ, MU('0.78'));
  assert.equal(fed.egestaEnergyQ, EU('6.5'));
  assert.equal(fed.heatQ, EU('2.6'));
  assert.equal(world.grid.getMassQ(EnergyPool.CARRION, 3), MU('10.8'));
  assert.equal(world.grid.getEnergyQ(EnergyPool.CARRION, 3), EU('87.75'));
  assert.equal(world.organisms.reserveEnergyQ(1), EU('53.4'));
  assert.equal(after.heat - dead.heat, BigInt(EU('2.6')) + BigInt(EU('9.75')));
  assertBalanced(dead, after);
});

test('Scenario 8 — heat dissipation: the whole food web in one open system closes with zero residual', () => {
  const world = createWorld('100000');
  genesis(world, (tx) => {
    seedPlants(tx, 0, '1000');
    spawn(tx, 0, '40', '4'); // herbivore
    spawn(tx, 1, '16', '1'); // predator
    spawn(tx, 2, '36', '4'); // prey
    spawn(tx, 3, '14', '2'); // metabolising adult
    spawn(tx, 4, '4', '0.8'); // juvenile
    spawn(tx, 5, '16', '3.5'); // mother (egg goes to slot 6)
    spawn(tx, 7, '14', '2'); // dies of old age
  });
  const before = totals(world);

  commitTick(world, 1, (tx) => {
    photosynthesis(world, tx, 0);
    const bite = MU('50');
    eat(tx, K.CELL_PLANT, 0, 0, 0, bite, energyOfMass(bite, RHO_PLANT), 500_000, 100_000);
    const prey = die(world, tx, 2, 1);
    eat(tx, K.CELL_CARRION, 1, 1, 1, MU('12'), scaleByRatio(prey.energyQ, MU('12'), prey.massQ), 800_000, 100_000);
    assert.equal(payMetabolism(world, tx, 3, EU('12')), 0);
    grow(tx, 4, 4, MU('0.45'), 3, 4, R.GROWTH);
    tx.transferBiomass(R.REPRODUCTION, K.ORGANISM_RESERVE, 5, K.ORGANISM_RESERVE, 6, MU('0.08'), EU('2.4'));
    grow(tx, 5, 6, MU('0.72'), 4, 5, R.REPRODUCTION);
    die(world, tx, 7, 3);
    tx.postMass(R.DECOMPOSITION, K.CELL_CARRION, 3, K.ABIOTIC, 0, MU('1.6'));
    tx.postEnergy(R.DECOMPOSITION, K.CELL_CARRION, 3, K.HEAT, 0, EU('13'));
  });
  const after = totals(world);

  const sunIn = after.sun - before.sun;
  const heatOut = after.heat - before.heat;
  assert.equal(sunIn, BigInt(EU('113.319072')));
  // plant respiration 50.829768 + SDA 7.5 + 7.2 + metabolism 12 + growth 0.75 + reproduction 0.9 + decomposition 13
  assert.equal(heatOut, BigInt(EU('92.179768')));
  assert.equal(after.energy - before.energy, sunIn - heatOut);
  assert.equal(formatEU(after.energy - before.energy), '21.139304');
  assertBalanced(before, after);

  // Heat by cause adds up to the total and is recorded only as a sink
  const L = world.ledger;
  const byReason =
    L.cumulativeFlow(R.PLANT_RESPIRATION).energyQ +
    L.cumulativeFlow(R.SDA).energyQ +
    L.cumulativeFlow(R.METABOLISM).energyQ +
    L.cumulativeFlow(R.DECOMPOSITION).energyQ;
  const growthHeat = L.getEnergyJournal()
    .filter((p) => p.dstKind === K.HEAT && (p.reason === R.GROWTH || p.reason === R.REPRODUCTION))
    .reduce((sum, p) => sum + BigInt(p.energyQ), 0n);
  assert.equal(byReason + growthHeat, heatOut);
  assert.equal(L.getEnergyJournal().some((p) => p.srcKind === K.HEAT), false, 'heat never flows back');
  assert.equal(L.getMassJournal().some((p) => p.srcKind === K.HEAT || p.dstKind === K.HEAT), false, 'heat carries no mass');

  // Mass is merely redistributed between biota and the finite abiotic pool
  assert.equal(after.mass, before.mass);
  // -20.829768 (photosynthesis) + 22.75 + 7.44 (feeding) + 0.4 (metabolism) - 0.35 (growth) - 0.57 (egg) + 1.6 (decomposition)
  assert.equal(formatMU(after.abiotic - before.abiotic), '10.440232');

  // Long run: 200 further ticks of an open system still close exactly, every tick
  for (let tick = 2; tick <= 201; tick++) {
    const start = totals(world);
    commitTick(world, tick, (tx) => {
      photosynthesis(world, tx, 0);
      const available = world.grid.getStagedMassQ(EnergyPool.PLANT, 0);
      const bite = Math.min(MU('30'), applyPpm(available, 20_000));
      eat(tx, K.CELL_PLANT, 0, 0, 0, bite, energyOfMass(bite, RHO_PLANT), 500_000, 100_000);
      payMetabolism(world, tx, 0, EU('30'));
      payMetabolism(world, tx, 3, EU('12'));
      for (const pool of [K.CELL_DETRITUS, K.CELL_CARRION] as const) {
        for (let cell = 0; cell < 4; cell++) {
          const m = world.grid.stagedBalance(pool, cell, false);
          const e = world.grid.stagedBalance(pool, cell, true);
          tx.postMass(R.DECOMPOSITION, pool, cell, K.ABIOTIC, 0, applyPpm(m, 100_000));
          tx.postEnergy(R.DECOMPOSITION, pool, cell, K.HEAT, 0, applyPpm(e, 100_000));
        }
      }
    });
    assertBalanced(start, totals(world));
  }
  const final = world.ledger.assertAudit();
  assert.equal(final.massResidualQ, 0n);
  assert.equal(final.energyResidualQ, 0n);
  assert.equal(final.actualMassQ, before.mass, 'total matter of the world is unchanged after 201 ticks');
  assert.equal(final.committedTxCount, 202);
  assert.ok(world.ledger.heatEnergyOutQ > 0n && world.ledger.sunEnergyInQ > world.ledger.heatEnergyOutQ - BigInt(EU('5000')));
  assert.equal(world.organisms.structMassQ(3), MU('14'), 'starving adult kept its structure for 200 ticks');
  assert.equal(world.grid.isSynchronized() && world.organisms.isSynchronized(), true);
});

// ------------------------------------------------------------------------------------------------
// Revision 3 Strict Stoichiometry Scenarios (3 / 3 / 5 / 30 EU/MU)
// ------------------------------------------------------------------------------------------------

function createStrictWorld(abioticMU = '10000') {
  const grid = new WorldEnergyGrid({ width: 4, height: 1 });
  const organisms = new EntityEnergyStore(16);
  const ledger = new EnergyLedger({
    initialAbioticMassQ: BigInt(MU(abioticMU)),
    journalCapacity: 256,
    strictStoichiometry: true,
  });
  ledger.registerStore(grid);
  ledger.registerStore(organisms);
  return { grid, organisms, ledger };
}

test('Scenario R3-1 — strictStoichiometry enforces 3 / 3 / 5 / 30 EU/MU and rolls back drift as I4', () => {
  const world = createStrictWorld();
  assert.equal(world.ledger.strictStoichiometry, true);
  genesis(world, (tx) => {
    seedPlants(tx, 0, '100');
    spawn(tx, 0, '10', '2');
  });
  world.ledger.assertStoichiometry();

  // Bad PLANT density (3.5 instead of 3) is caught by PREPARE and rolled back cleanly
  const badPlantTx = world.ledger.begin(1);
  badPlantTx.postEnergy(R.PHOTOSYNTHESIS, K.SUN, 0, K.CELL_PLANT, 0, 7);
  badPlantTx.postMass(R.PHOTOSYNTHESIS, K.ABIOTIC, 0, K.CELL_PLANT, 0, 2);
  assert.throws(() => badPlantTx.prepare(), (e: unknown) => e instanceof EnergyInvariantError && e.invariant === 'I4');
  assert.equal(badPlantTx.state, 'ABORTED');
  assert.equal(world.grid.getMassQ(EnergyPool.PLANT, 0), MU('100'));

  // Bad DETRITUS density from carrion (egesta taking reserve's 30 EU/MU instead of 3 EU/MU) is caught by I4
  const badDetritusTx = world.ledger.begin(1);
  badDetritusTx.transferBiomass(R.EGESTION, K.ORGANISM_RESERVE, 0, K.CELL_DETRITUS, 0, 10, 300);
  assert.throws(
    () => badDetritusTx.prepare(),
    (e: unknown) => e instanceof EnergyInvariantError && e.invariant === 'I4'
  );
  assert.equal(badDetritusTx.state, 'ABORTED');
  world.ledger.assertStoichiometry();
  world.ledger.assertAudit();
});

test('Scenario R3-2 — mixed carrion scavenging and decomposition keep 3 EU/MU detritus & (5, 30) carrion under strict mode', () => {
  const world = createStrictWorld();
  genesis(world, (tx) => {
    spawn(tx, 0, '10', '2'); // scavenger
    spawn(tx, 1, '14', '2'); // body 1 -> 16 MU, 130 EU
    spawn(tx, 2, '6', '1');  // body 2 -> 7 MU, 60 EU
  });
  const start = totals(world);

  commitTick(world, 1, (tx) => {
    die(world, tx, 1, 1);
    die(world, tx, 2, 1);
  });
  assert.deepEqual(world.grid.carrionFractions(1), {
    structMassQ: MU('20'),
    structEnergyQ: EU('100'),
    reserveMassQ: MU('3'),
    reserveEnergyQ: EU('90'),
  });

  commitTick(world, 2, (tx) => {
    const cm = world.grid.getStagedMassQ(EnergyPool.CARRION, 1);
    const ce = world.grid.getStagedEnergyQ(EnergyPool.CARRION, 1);
    const bite = planCarrionConsumption(cm, ce, MU('5'));
    const fed = planFeedingAllocation(bite.totalMassQ, bite.totalEnergyQ, 800_000, 100_000);
    assert.equal(hasExactDensity(fed.depositMassQ, fed.depositEnergyQ, RHO_RESERVE), true);
    assert.equal(hasExactDensity(fed.egestaMassQ, fed.egestaEnergyQ, RHO_DETRITUS), true);

    tx.transferBiomass(R.INGESTION, K.CELL_CARRION, 1, K.ORGANISM_RESERVE, 0, fed.depositMassQ, fed.depositEnergyQ);
    tx.transferBiomass(R.EGESTION, K.CELL_CARRION, 1, K.CELL_DETRITUS, 1, fed.egestaMassQ, fed.egestaEnergyQ);
    tx.postMass(R.SDA, K.CELL_CARRION, 1, K.ABIOTIC, 0, fed.abioticMassQ);
    tx.postEnergy(R.SDA, K.CELL_CARRION, 1, K.HEAT, 0, fed.heatQ);

    const restM = world.grid.getStagedMassQ(EnergyPool.CARRION, 1);
    const restE = world.grid.getStagedEnergyQ(EnergyPool.CARRION, 1);
    const dec = planCarrionDecomposition(restM, restE, 100_000);
    tx.postMass(R.DECOMPOSITION, K.CELL_CARRION, 1, K.ABIOTIC, 0, dec.totalMassQ);
    tx.postEnergy(R.DECOMPOSITION, K.CELL_CARRION, 1, K.HEAT, 0, dec.totalEnergyQ);
  });

  const detM = world.grid.getMassQ(EnergyPool.DETRITUS, 1);
  const detE = world.grid.getEnergyQ(EnergyPool.DETRITUS, 1);
  assert.ok(detM > 0 && hasExactDensity(detM, detE, RHO_DETRITUS), 'detritus after scavenging must stay 3 EU/MU');
  assert.equal(
    isValidCarrionMix(world.grid.getMassQ(EnergyPool.CARRION, 1), world.grid.getEnergyQ(EnergyPool.CARRION, 1)),
    true
  );
  world.ledger.assertStoichiometry();
  assertBalanced(start, totals(world));
});

test('Scenario R3-3 — repeated sub-quantum reserve metabolism keeps exact 30 EU/MU without 30x overburn or false starvation', () => {
  const world = createStrictWorld();
  genesis(world, (tx) => {
    spawn(tx, 0, '4', '0.000100'); // 100 qMU reserve = 3000 qEU
  });
  const start = totals(world);
  let carry = 0;
  let totalDeficit = 0;

  // 100 ticks x 1 qEU + 100 ticks x 13 qEU = 1400 qEU (< 3000 qEU available)
  for (let tick = 1; tick <= 200; tick++) {
    const demandQ = tick <= 100 ? 1 : 13;
    commitTick(world, tick, (tx) => {
      const availM = world.organisms.stagedBalance(K.ORGANISM_RESERVE, 0, false);
      const step = planReserveMetabolism(availM, demandQ, carry);
      carry = step.nextCarryCreditQ;
      totalDeficit += step.deficitQ;
      tx.postMass(R.METABOLISM, K.ORGANISM_RESERVE, 0, K.ABIOTIC, 0, step.burnMassQ);
      tx.postEnergy(R.METABOLISM, K.ORGANISM_RESERVE, 0, K.HEAT, 0, step.burnEnergyQ);
    });
    // Every tick holds exact 30 EU/MU on ORGANISM_RESERVE (enforced by strictStoichiometry)
    assert.equal(
      hasExactDensity(world.organisms.reserveMassQ(0), world.organisms.reserveEnergyQ(0), RHO_RESERVE),
      true
    );
  }
  assert.equal(totalDeficit, 0);
  // Paid 1400 qEU via ceil(1400/30) = 47 qMU = 1410 qEU (10 qEU carry prepaid toward next quantum)
  assert.equal(world.organisms.reserveMassQ(0), 100 - 47);
  assert.equal(world.organisms.reserveEnergyQ(0), (100 - 47) * 30);
  assert.equal(carry, 10);
  world.ledger.assertStoichiometry();
  assertBalanced(start, totals(world));
});

test('Scenario R3-4 — strict world with contention resolution is deterministic across identical seeds and permutations', () => {
  const simulate = (seedText: string, shuffleOrder: boolean): string => {
    const world = createStrictWorld();
    const rng = new SeededRng(seedText);
    const organismIds = [101, 205, 309, 412];
    genesis(world, (tx) => {
      seedPlants(tx, 0, '0.000500'); // 500 qMU plants @ 3 EU/MU
      for (let slot = 0; slot < organismIds.length; slot++) {
        spawn(tx, slot, '2', '0.001000');
      }
    });

    for (let tick = 1; tick <= 20; tick++) {
      commitTick(world, tick, (tx) => {
        const order = shuffleOrder ? rng.shuffled([0, 1, 2, 3]) : [0, 1, 2, 3];
        const demands = order.map(() => 60);
        const ids = order.map((slot) => organismIds[slot]);
        const availPlant = world.grid.getStagedMassQ(EnergyPool.PLANT, 0);
        const grants = new Float64Array(order.length);
        resolveContention(demands, order.length, availPlant, grants, ids);
        for (let k = 0; k < order.length; k++) {
          const slot = order[k];
          const biteM = grants[k];
          if (biteM === 0) continue;
          const fed = planFeedingAllocation(biteM, energyOfMass(biteM, RHO_PLANT), 500_000, 100_000);
          tx.transferBiomass(R.INGESTION, K.CELL_PLANT, 0, K.ORGANISM_RESERVE, slot, fed.depositMassQ, fed.depositEnergyQ);
          tx.transferBiomass(R.EGESTION, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, fed.egestaMassQ, fed.egestaEnergyQ);
          tx.postMass(R.SDA, K.CELL_PLANT, 0, K.ABIOTIC, 0, fed.abioticMassQ);
          tx.postEnergy(R.SDA, K.CELL_PLANT, 0, K.HEAT, 0, fed.heatQ);
        }
      });
    }
    world.ledger.assertStoichiometry();
    world.ledger.assertAudit();
    return organismIds.map((_, slot) => `${world.organisms.reserveMassQ(slot)}:${world.organisms.reserveEnergyQ(slot)}`).join(',');
  };

  const canonicalA = simulate('r3-strict-seed', false);
  const canonicalB = simulate('r3-strict-seed', false);
  const permutedA = simulate('r3-strict-seed', true);
  assert.equal(canonicalA, canonicalB);
  assert.equal(permutedA, canonicalA);
});
