import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCOUNT_KIND_COUNT,
  AccountKind,
  POSTING_REASON_COUNT,
  PostingReason,
  checkEnergyRoute,
  checkMassRoute,
} from './energyAccounts';
import { EnergyLedger } from './energyLedger';
import {
  EnergyInvariantError,
  EnergyRuleError,
  EnergyTransactionStateError,
} from './energyTransaction';
import { SeededRng } from './prng';
import { EntityEnergyStore, InsufficientBalanceError, StagedChannelStore, StagedStore } from './stagedStore';
import { ExactAccumulators, MAX_QUANTA, UnitsError } from './units';
import { ENERGY_POOL_COUNT, EnergyPool, WorldEnergyGrid } from './worldEnergyGrid';

const K = AccountKind;
const R = PostingReason;

function createWorld(options: { abiotic?: bigint; journal?: number; cells?: number; entities?: number } = {}) {
  const grid = new WorldEnergyGrid({ width: options.cells ?? 8, height: 1 });
  const entities = new EntityEnergyStore(options.entities ?? 8);
  const ledger = new EnergyLedger({
    initialAbioticMassQ: options.abiotic ?? 1_000_000n,
    journalCapacity: options.journal ?? 0,
    postingCapacity: 4,
  });
  ledger.registerStore(grid);
  ledger.registerStore(entities);
  return { grid, entities, ledger };
}

/** Seeds plants in cell 0 and one organism in slot 0 through a genesis transaction. */
function seed(world: ReturnType<typeof createWorld>): void {
  const tx = world.ledger.begin(0, { genesis: true });
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, 0, 1000, 3000);
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.ORGANISM_STRUCT, 0, 40, 200);
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.ORGANISM_RESERVE, 0, 4, 120);
  tx.prepare();
  tx.commit();
}

function digest(world: ReturnType<typeof createWorld>): string {
  const parts: string[] = [];
  const buf = new Float64Array(world.grid.cellCount);
  for (let pool = 0; pool < ENERGY_POOL_COUNT; pool++) {
    world.grid.copyCommittedMass(pool as 0 | 1 | 2, buf);
    parts.push(buf.join(','));
    world.grid.copyCommittedEnergy(pool as 0 | 1 | 2, buf);
    parts.push(buf.join(','));
  }
  for (let s = 0; s < world.entities.capacity; s++) {
    parts.push(
      `${world.entities.structMassQ(s)}/${world.entities.structEnergyQ(s)}/${world.entities.reserveMassQ(s)}/${world.entities.reserveEnergyQ(s)}`
    );
  }
  const l = world.ledger;
  parts.push(
    `${l.globalAbioticMassQ}|${l.sunEnergyInQ}|${l.heatEnergyOutQ}|${l.genesisMassQ}|${l.genesisEnergyQ}|${l.committedTxCount}|${l.abortedTxCount}`
  );
  return parts.join(';');
}

test('energyAccounts: routing table enforces directionality for every reason and account kind (I4)', () => {
  for (let reason = 0; reason < POSTING_REASON_COUNT; reason++) {
    for (let a = 0; a < ACCOUNT_KIND_COUNT; a++) {
      for (let b = 0; b < ACCOUNT_KIND_COUNT; b++) {
        const e = checkEnergyRoute(reason, a, b);
        const m = checkMassRoute(reason, a, b);
        // Energy can never originate in HEAT or arrive in SUN/GENESIS, and never touches ABIOTIC.
        if (a === K.HEAT || b === K.SUN || b === K.GENESIS || a === K.ABIOTIC || b === K.ABIOTIC) {
          assert.notEqual(e, null, `energy ${reason}: ${a}->${b} must be rejected`);
        }
        // Mass never touches SUN/HEAT and never arrives in GENESIS.
        if (a === K.SUN || b === K.SUN || a === K.HEAT || b === K.HEAT || b === K.GENESIS) {
          assert.notEqual(m, null, `mass ${reason}: ${a}->${b} must be rejected`);
        }
        // The external provider boundary is unreachable from postings.
        if (a === K.EXTERNAL_PROVIDER || b === K.EXTERNAL_PROVIDER) {
          assert.notEqual(e, null);
          assert.notEqual(m, null);
        }
        // SUN and GENESIS as energy sources exist only for their own reasons.
        if (a === K.SUN && e === null) assert.equal(reason, R.PHOTOSYNTHESIS);
        if (a === K.GENESIS && e === null) assert.equal(reason, R.GENESIS);
        if (a === K.GENESIS && m === null) assert.equal(reason, R.GENESIS);
      }
    }
  }
  // Starvation rule: metabolism can never be paid from structural tissue.
  assert.notEqual(checkEnergyRoute(R.METABOLISM, K.ORGANISM_STRUCT, K.HEAT), null);
  assert.notEqual(checkMassRoute(R.METABOLISM, K.ORGANISM_STRUCT, K.ABIOTIC), null);
  assert.equal(checkEnergyRoute(R.METABOLISM, K.ORGANISM_RESERVE, K.HEAT), null);
  // Death moves structure AND reserve to carrion.
  assert.equal(checkEnergyRoute(R.DEATH, K.ORGANISM_STRUCT, K.CELL_CARRION), null);
  assert.equal(checkMassRoute(R.DEATH, K.ORGANISM_RESERVE, K.CELL_CARRION), null);
  assert.notEqual(checkEnergyRoute(99, K.SUN, K.CELL_PLANT), null);
  assert.notEqual(checkMassRoute(R.GROWTH, 99, K.ABIOTIC), null);
});

test('EnergyLedger: configuration, store registration, and initial abiotic pool', () => {
  assert.throws(() => new EnergyLedger({ initialAbioticMassQ: -1n }), UnitsError);
  assert.throws(() => new EnergyLedger({ initialAbioticMassQ: 5 as unknown as bigint }), UnitsError);
  assert.throws(() => new EnergyLedger({ initialAbioticMassQ: 0n, escrowSlots: 0 }), RangeError);
  assert.throws(() => new EnergyLedger({ initialAbioticMassQ: 0n, postingCapacity: 0 }), RangeError);
  assert.throws(() => new EnergyLedger({ initialAbioticMassQ: 0n, journalCapacity: -1 }), RangeError);

  const huge = 10n ** 24n; // far beyond 2^53: the global pool is a wide exact value
  const ledger = new EnergyLedger({ initialAbioticMassQ: huge });
  assert.equal(ledger.globalAbioticMassQ, huge);
  assert.equal(typeof ledger.globalAbioticMassQ, 'bigint');
  assert.equal(ledger.genesisMassQ, huge);
  assert.equal(ledger.audit().ok, true);
  assert.equal(ledger.lastCommittedTick, -1);

  const grid = new WorldEnergyGrid({ width: 2, height: 2 });
  ledger.registerStore(grid);
  assert.throws(() => ledger.registerStore(grid), /already registered/);
  assert.throws(() => ledger.registerStore(new WorldEnergyGrid({ width: 2, height: 2 })), /already has a registered store/);
  assert.throws(() => ledger.registerStore({} as StagedStore), TypeError);

  // A store that already holds unrecorded matter cannot be attached.
  const other = new EnergyLedger({ initialAbioticMassQ: 0n });
  const dirtyStore = new EntityEnergyStore(2);
  (dirtyStore as unknown as { store: StagedChannelStore }).store.credit(0, 0, 5);
  assert.throws(() => other.registerStore(dirtyStore), /staged changes/);
  (dirtyStore as unknown as { store: StagedChannelStore }).store.commit(1);
  assert.throws(() => other.registerStore(dirtyStore), /must be empty/);

  // Posting to an account kind without a store is rejected.
  const tx = ledger.begin(0, { genesis: true });
  assert.throws(() => tx.postMass(R.GENESIS, K.GENESIS, 0, K.ORGANISM_STRUCT, 0, 1), /No store is registered/);
  tx.abort();
  assert.throws(() => ledger.registerStore(new EntityEnergyStore(2)), /before the first transaction/);
});

test('EnergyTransaction: state machine PREPARE / COMMIT / ABORT and protection against repeated commit', () => {
  const world = createWorld();
  const { ledger, grid } = world;
  seed(world);

  const tx = ledger.begin(1);
  assert.equal(tx.state, 'ACTIVE');
  assert.equal(ledger.activeTransaction, tx);
  assert.throws(() => ledger.begin(1), EnergyTransactionStateError, 'only one open transaction');
  assert.throws(() => tx.commit(), /expected PREPARED/, 'COMMIT without PREPARE is refused');
  assert.equal(tx.state, 'ACTIVE');

  tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 5, 15);
  tx.prepare();
  assert.equal(tx.state, 'PREPARED');
  assert.throws(() => tx.prepare(), EnergyTransactionStateError);
  assert.throws(
    () => tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 5, 15),
    EnergyTransactionStateError,
    'a prepared transaction is sealed'
  );
  assert.equal(grid.getMassQ(EnergyPool.DETRITUS, 0), 0);

  tx.commit();
  assert.equal(tx.state, 'COMMITTED');
  assert.equal(grid.getMassQ(EnergyPool.DETRITUS, 0), 5);
  assert.equal(ledger.activeTransaction, null);
  assert.equal(ledger.committedTxCount, 2);
  assert.equal(ledger.lastCommittedTick, 1);
  assert.equal(ledger.lastCommittedTxId, tx.id);

  // Repeated commit / abort / posting on the finished handle changes nothing.
  const before = digest(world);
  assert.throws(() => tx.commit(), /COMMITTED, expected PREPARED/);
  assert.throws(() => tx.abort(), /already COMMITTED/);
  assert.throws(() => tx.postMass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 1), EnergyTransactionStateError);
  assert.throws(() => tx.getMassPostings(), EnergyTransactionStateError);
  assert.equal(digest(world), before);

  // A stale committed handle cannot commit the NEXT transaction either.
  const next = ledger.begin(2);
  next.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 7, 21);
  next.prepare();
  assert.throws(() => tx.commit(), EnergyTransactionStateError);
  assert.equal(grid.getMassQ(EnergyPool.DETRITUS, 0), 5);
  next.abort();
  assert.equal(next.state, 'ABORTED');
  next.abort(); // idempotent
  assert.throws(() => next.commit(), /ABORTED, expected PREPARED/);
  assert.throws(() => next.prepare(), EnergyTransactionStateError);
  assert.equal(digest(world).replace(/\|\d+$/, ''), before.replace(/\|\d+$/, ''), 'abort leaves committed state untouched');
  assert.equal(ledger.abortedTxCount, 1);

  // Ticks are validated and never move backwards.
  assert.throws(() => ledger.begin(0), /older than the last committed tick/);
  for (const bad of [-1, 1.5, NaN, 2 ** 32]) {
    assert.throws(() => ledger.begin(bad), RangeError);
  }
  const sameTick = ledger.begin(1);
  sameTick.prepare();
  sameTick.commit();
  ledger.assertAudit();
});

test('EnergyTransaction: postings are validated before staging and a rejected posting stages nothing', () => {
  const world = createWorld();
  const { ledger, grid, entities } = world;
  seed(world);
  const tx = ledger.begin(1);
  const stagedBefore = () =>
    `${grid.getStagedMassQ(EnergyPool.PLANT, 0)}/${grid.getStagedEnergyQ(EnergyPool.PLANT, 0)}/${tx.stagedMassQ(K.ABIOTIC, 0)}/${tx.massPostingCount}/${tx.energyPostingCount}`;
  const base = stagedBefore();

  // Invalid numbers
  for (const bad of [-1, 0.5, NaN, Infinity, -Infinity, 2 ** 53]) {
    assert.throws(() => tx.postMass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, bad), UnitsError);
    assert.throws(() => tx.postEnergy(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, bad), UnitsError);
  }
  // Creating resources from nothing
  assert.throws(() => tx.postMass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, 0, 1), /only available to genesis transactions/);
  assert.throws(() => tx.postEnergy(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, 0, 1), /only available to genesis transactions/);
  assert.throws(() => tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, 0, 1, 1), EnergyRuleError);
  assert.throws(() => tx.postEnergy(R.PHOTOSYNTHESIS, K.HEAT, 0, K.CELL_PLANT, 0, 1), /HEAT is a sink/);
  assert.throws(() => tx.postEnergy(R.INGESTION, K.SUN, 0, K.ORGANISM_RESERVE, 0, 1), EnergyRuleError);
  assert.throws(() => tx.postMass(R.PHOTOSYNTHESIS, K.SUN, 0, K.CELL_PLANT, 0, 1), /carry no mass/);
  assert.throws(() => tx.postEnergy(R.PLANT_RESPIRATION, K.CELL_PLANT, 0, K.ABIOTIC, 0, 1), /no chemical energy/);
  assert.throws(() => tx.postMass(R.EGESTION, K.EXTERNAL_PROVIDER, 0, K.CELL_DETRITUS, 0, 1), EnergyRuleError);
  // Structure is never burned for metabolism
  assert.throws(() => tx.postEnergy(R.METABOLISM, K.ORGANISM_STRUCT, 0, K.HEAT, 0, 1), EnergyRuleError);
  // Same account, bad ids, unknown reason
  assert.throws(() => tx.postMass(R.REPRODUCTION, K.ORGANISM_RESERVE, 0, K.ORGANISM_RESERVE, 0, 1), /same account/);
  assert.throws(() => tx.postMass(R.PHOTOSYNTHESIS, K.ABIOTIC, 1, K.CELL_PLANT, 0, 1), /single global account/);
  assert.throws(() => tx.postEnergy(R.PHOTOSYNTHESIS, K.SUN, 3, K.CELL_PLANT, 0, 1), /single global account/);
  assert.throws(() => tx.postEnergy(R.PLANT_RESPIRATION, K.CELL_PLANT, 0, K.HEAT, 2, 1), /single global account/);
  assert.throws(() => tx.postMass(R.PLANT_TURNOVER, K.CELL_PLANT, -1, K.CELL_DETRITUS, 0, 1), EnergyRuleError);
  assert.throws(() => tx.postMass(R.PLANT_TURNOVER, K.CELL_PLANT, 0.5, K.CELL_DETRITUS, 0, 1), EnergyRuleError);
  assert.throws(() => tx.postMass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 99, 1), RangeError);
  assert.throws(() => tx.postMass(77 as never, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 1), EnergyRuleError);
  // Overdrafts (negative stocks) on every kind of source
  assert.throws(() => tx.postMass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 1001), InsufficientBalanceError);
  assert.throws(() => tx.postEnergy(R.METABOLISM, K.ORGANISM_RESERVE, 0, K.HEAT, 0, 121), InsufficientBalanceError);
  assert.throws(() => tx.postMass(R.PHOTOSYNTHESIS, K.ABIOTIC, 0, K.CELL_PLANT, 0, 1_000_001), InsufficientBalanceError);
  assert.throws(() => tx.postMass(R.INGESTION, K.ESCROW, 0, K.ORGANISM_RESERVE, 0, 1), InsufficientBalanceError);
  assert.throws(() => tx.postEnergy(R.INGESTION, K.ESCROW, 99, K.ORGANISM_RESERVE, 0, 1), /Escrow slot out of range/);
  // transferBiomass validates the energy leg before staging the mass leg
  assert.throws(
    () => tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 10, 3001),
    InsufficientBalanceError
  );
  assert.throws(() => tx.transferBiomass(R.DEATH, K.ORGANISM_STRUCT, 0, K.CELL_CARRION, 99, 1, 1), RangeError);

  assert.equal(stagedBefore(), base, 'no rejected posting may leave a trace in staging');
  assert.equal(grid.dirtyCellCount, 0);
  assert.equal(entities.stagedDirtyCount, 0);
  assert.equal(tx.state, 'ACTIVE', 'the transaction stays usable after rejected postings');

  // Zero-amount postings are accepted and ignored
  tx.postMass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 0);
  tx.postEnergy(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 0);
  assert.equal(tx.massPostingCount + tx.energyPostingCount, 0);

  // Sequential debits see the staged balance: no double spending inside one transaction
  tx.postMass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 600);
  assert.throws(() => tx.postMass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 600), InsufficientBalanceError);
  tx.postMass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 400);
  assert.equal(tx.stagedMassQ(K.CELL_PLANT, 0), 0);
  assert.equal(tx.stagedMassQ(K.CELL_DETRITUS, 0), 1000);
  tx.abort();
  ledger.assertAudit();
});

test('EnergyTransaction: staged posting buffers grow while ACTIVE and report immutable postings', () => {
  const world = createWorld();
  seed(world);
  const { ledger } = world;
  assert.equal(ledger.postingCapacity, 4);
  const tx = ledger.begin(1);
  for (let i = 0; i < 100; i++) {
    tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 1, 3);
  }
  assert.equal(tx.massPostingCount, 100);
  assert.equal(ledger.postingCapacity, 128);
  const postings = tx.getMassPostings();
  assert.equal(postings.length, 100);
  assert.deepEqual(postings[99], {
    txId: tx.id, tick: 1, seq: 99, reason: R.PLANT_TURNOVER,
    srcKind: K.CELL_PLANT, srcId: 0, dstKind: K.CELL_DETRITUS, dstId: 0, massQ: 1,
  });
  assert.ok(Object.isFrozen(postings[0]));
  assert.equal(tx.getEnergyPostings()[0].energyQ, 3);
  tx.prepare();
  tx.commit();
  assert.equal(ledger.cumulativeFlow(R.PLANT_TURNOVER).massQ, 100n);
  assert.equal(ledger.cumulativeFlow(R.PLANT_TURNOVER).energyQ, 300n);
  assert.equal(ledger.lastTransactionFlow(R.PLANT_TURNOVER).massQ, 100n);
  assert.equal(ledger.typedArrayBytes() > 0, true);
});

test('Invariants I1/I2: every committed transaction conserves energy and mass exactly (open energy, closed mass)', () => {
  const world = createWorld({ abiotic: 500_000n });
  const { ledger, grid, entities } = world;
  seed(world);
  const massBefore = ledger.audit().actualMassQ;
  const energyBefore = ledger.audit().actualEnergyQ;

  const tx = ledger.begin(1);
  // Photosynthesis: energy from SUN, matter from the finite abiotic pool
  tx.postEnergy(R.PHOTOSYNTHESIS, K.SUN, 0, K.CELL_PLANT, 0, 600);
  tx.postMass(R.PHOTOSYNTHESIS, K.ABIOTIC, 0, K.CELL_PLANT, 0, 200);
  // Respiration: energy to HEAT, matter back to abiotic
  tx.postEnergy(R.PLANT_RESPIRATION, K.CELL_PLANT, 0, K.HEAT, 0, 90);
  tx.postMass(R.PLANT_RESPIRATION, K.CELL_PLANT, 0, K.ABIOTIC, 0, 30);
  // Metabolism of the organism
  tx.postEnergy(R.METABOLISM, K.ORGANISM_RESERVE, 0, K.HEAT, 0, 30);
  tx.postMass(R.METABOLISM, K.ORGANISM_RESERVE, 0, K.ABIOTIC, 0, 1);
  tx.prepare();
  tx.commit();

  const audit = ledger.assertAudit();
  // I2: mass is closed — total unchanged, only redistributed
  assert.equal(audit.actualMassQ, massBefore);
  assert.equal(ledger.globalAbioticMassQ, 500_000n - 200n + 30n + 1n);
  // I1: energy changed by exactly SUN - HEAT
  assert.equal(audit.actualEnergyQ - energyBefore, 600n - 120n);
  assert.equal(ledger.sunEnergyInQ, 600n);
  assert.equal(ledger.heatEnergyOutQ, 120n);
  assert.equal(audit.massResidualQ, 0n);
  assert.equal(audit.energyResidualQ, 0n);
  assert.equal(grid.getEnergyQ(EnergyPool.PLANT, 0), 3000 + 600 - 90);
  assert.equal(entities.reserveEnergyQ(0), 90);

  // The finite abiotic pool limits growth: it cannot be overdrawn (no matter from nothing)
  const tx2 = ledger.begin(2);
  assert.throws(
    () => tx2.postMass(R.PHOTOSYNTHESIS, K.ABIOTIC, 0, K.CELL_PLANT, 0, 499_832),
    InsufficientBalanceError
  );
  tx2.postMass(R.PHOTOSYNTHESIS, K.ABIOTIC, 0, K.CELL_PLANT, 0, 499_831);
  tx2.prepare();
  tx2.commit();
  assert.equal(ledger.globalAbioticMassQ, 0n);
  assert.equal(ledger.assertAudit().actualMassQ, massBefore);
});

test('Invariant I1/I2/I3 at PREPARE: out-of-band staging writes are detected, aborted, and never committed', () => {
  const world = createWorld();
  const { ledger, grid, entities } = world;
  seed(world);
  const committed = digest(world);
  const gridStore = (grid as unknown as { store: StagedChannelStore }).store;
  const entityStore = (entities as unknown as { store: StagedChannelStore }).store;

  // Energy minted directly in the staging buffer -> I2 (energy conservation)
  let tx = ledger.begin(1);
  tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 5, 15);
  gridStore.credit(1, 3, 500);
  assert.throws(() => tx.prepare(), (e: unknown) => e instanceof EnergyInvariantError && e.invariant === 'I2');
  assert.equal(tx.state, 'ABORTED', 'failed PREPARE aborts automatically');
  assert.equal(ledger.activeTransaction, null);
  assert.equal(digest(world).replace(/\|\d+$/, ''), committed.replace(/\|\d+$/, ''));
  assert.equal(grid.isSynchronized(), true);
  assert.throws(() => tx.commit(), EnergyTransactionStateError);

  // Mass destroyed directly in the staging buffer -> I1 (mass conservation)
  tx = ledger.begin(1);
  entityStore.debit(0, 0, 7);
  assert.throws(() => tx.prepare(), (e: unknown) => e instanceof EnergyInvariantError && e.invariant === 'I1');
  assert.equal(entities.structMassQ(0), 40);
  assert.equal(entities.isSynchronized(), true);

  // Negative / fractional / non-finite staged values -> I3
  for (const corrupt of [-3, 0.5, NaN, Infinity]) {
    tx = ledger.begin(1);
    gridStore.credit(0, 2, 0); // mark dirty
    (gridStore as unknown as { back: Float64Array[] }).back[0][2] = corrupt;
    assert.throws(() => tx.prepare(), /not a valid quantum count/);
    assert.equal(tx.state, 'ABORTED');
    assert.equal(grid.getStagedMassQ(EnergyPool.PLANT, 2), 0, 'abort repaired the staging buffer');
  }

  assert.equal(digest(world).replace(/\|\d+$/, ''), committed.replace(/\|\d+$/, ''));
  ledger.assertAudit();
  // And the world still works
  tx = ledger.begin(1);
  tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 5, 15);
  tx.prepare();
  tx.commit();
  ledger.assertAudit();
});

test('Invariant I5: audit recomputes stocks from the buffers and detects any change outside transactions', () => {
  const world = createWorld();
  const { ledger, grid, entities } = world;
  seed(world);
  assert.equal(ledger.audit().ok, true);
  const gridInternals = (grid as unknown as { store: { front: Float64Array[]; back: Float64Array[] } }).store;
  const entityInternals = (entities as unknown as { store: { front: Float64Array[]; back: Float64Array[] } }).store;

  gridInternals.front[1][0] += 11; // energy from nothing
  let report = ledger.audit();
  assert.equal(report.ok, false);
  assert.equal(report.energyResidualQ, 11n);
  assert.equal(report.massResidualQ, 0n);
  assert.throws(() => ledger.assertAudit(), (e: unknown) => e instanceof EnergyInvariantError && e.invariant === 'I5');
  gridInternals.front[1][0] -= 11;

  entityInternals.front[0][0] -= 4; // mass silently lost
  report = ledger.audit();
  assert.equal(report.ok, false);
  assert.equal(report.massResidualQ, -4n);
  entityInternals.front[0][0] += 4;
  assert.equal(ledger.assertAudit().ok, true);

  // Cumulative identity over many ticks: stock == genesis + sun - heat, every tick
  for (let tick = 1; tick <= 50; tick++) {
    const tx = ledger.begin(tick);
    tx.postEnergy(R.PHOTOSYNTHESIS, K.SUN, 0, K.CELL_PLANT, 0, 30);
    tx.postMass(R.PHOTOSYNTHESIS, K.ABIOTIC, 0, K.CELL_PLANT, 0, 10);
    tx.postEnergy(R.PLANT_RESPIRATION, K.CELL_PLANT, 0, K.HEAT, 0, 12);
    tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 2, 6);
    tx.prepare();
    tx.commit();
    const a = ledger.assertAudit();
    assert.equal(a.actualEnergyQ, 3320n + BigInt(tick) * 18n);
    assert.equal(a.actualMassQ, 1_000_000n + 1044n);
  }
  assert.equal(ledger.committedTxCount, 51);
});

test('Atomicity: an error in the middle of a tick leaves the world bit-identical; retry succeeds', () => {
  const world = createWorld({ cells: 16, entities: 16 });
  const { ledger } = world;
  let tx = ledger.begin(0, { genesis: true });
  for (let i = 0; i < 16; i++) {
    tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, i, 1000, 3000);
    tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.ORGANISM_RESERVE, i, 4, 120);
  }
  tx.prepare();
  tx.commit();
  const before = digest(world);

  const runTick = (failAt: number): void => {
    const t = ledger.begin(1);
    try {
      for (let i = 0; i < 16; i++) {
        if (i === failAt) throw new Error('artificial mid-tick failure');
        t.transferBiomass(R.INGESTION, K.CELL_PLANT, i, K.ORGANISM_RESERVE, i, 10, 30);
        t.postEnergy(R.METABOLISM, K.ORGANISM_RESERVE, i, K.HEAT, 0, 12);
      }
      t.prepare();
      t.commit();
    } catch (error) {
      t.abort();
      throw error;
    }
  };

  for (const failAt of [0, 1, 7, 15]) {
    assert.throws(() => runTick(failAt), /artificial mid-tick failure/);
    assert.equal(digest(world).replace(/\|\d+$/, ''), before.replace(/\|\d+$/, ''), `torn state after failure at ${failAt}`);
    assert.equal(ledger.lastCommittedTick, 0, 'tick counter must not advance on failure');
    assert.equal(world.grid.isSynchronized() && world.entities.isSynchronized(), true);
    ledger.assertAudit();
  }
  runTick(-1);
  assert.equal(ledger.lastCommittedTick, 1);
  assert.equal(world.entities.reserveEnergyQ(15), 120 + 30 - 12);
  assert.equal(ledger.heatEnergyOutQ, 16n * 12n);
  ledger.assertAudit();
});

test('Problem A: external providers run only before PREPARE; escrow makes withdrawals durable and COMMIT callback-free', () => {
  const world = createWorld();
  const { ledger, entities } = world;
  seed(world);

  // A provider that mutates its own stock on every call and crashes on the third call.
  let providerStock = 100;
  let calls = 0;
  const flakyPull = () => {
    calls++;
    if (calls === 3) throw new Error('transient food provider crash');
    providerStock -= 10;
    return { massQ: 10, energyQ: 70 };
  };

  let tx = ledger.begin(1);
  ledger.importExternal(0, flakyPull);
  ledger.importExternal(0, flakyPull);
  tx.transferBiomass(R.INGESTION, K.ESCROW, 0, K.ORGANISM_RESERVE, 0, 10, 70);
  assert.throws(() => ledger.importExternal(0, flakyPull), /transient food provider crash/);
  tx.abort();

  // Nothing was lost and nothing was duplicated: what left the provider sits in escrow.
  assert.equal(providerStock, 80);
  assert.equal(ledger.escrowMassQ(0), 20n);
  assert.equal(ledger.escrowEnergyQ(0), 140n);
  assert.equal(ledger.externalMassInQ, 20n);
  assert.equal(ledger.externalEnergyInQ, 140n);
  assert.equal(entities.reserveMassQ(0), 4, 'aborted ingestion did not reach the organism');
  ledger.assertAudit();

  // Retry: the escrowed food is used first, no second withdrawal is needed.
  tx = ledger.begin(1);
  tx.transferBiomass(R.INGESTION, K.ESCROW, 0, K.ORGANISM_RESERVE, 0, 20, 140);
  assert.throws(
    () => tx.transferBiomass(R.INGESTION, K.ESCROW, 0, K.ORGANISM_RESERVE, 0, 1, 1),
    InsufficientBalanceError
  );
  tx.prepare();
  // Sealed: no external code and no deposits between PREPARE and COMMIT.
  let lateCalls = 0;
  assert.throws(
    () => ledger.importExternal(0, () => { lateCalls++; return { massQ: 1, energyQ: 1 }; }),
    /while a transaction is PREPARED/
  );
  assert.throws(() => ledger.depositEscrow(0, 1, 1), /while a transaction is PREPARED/);
  assert.equal(lateCalls, 0, 'the provider must not even be invoked');
  const callsBeforeCommit = calls;
  tx.commit();
  assert.equal(calls, callsBeforeCommit, 'COMMIT performs no external calls');
  assert.equal(entities.reserveMassQ(0), 24);
  assert.equal(entities.reserveEnergyQ(0), 260);
  assert.equal(ledger.escrowMassQ(0), 0n);
  ledger.assertAudit();

  // Invalid provider results are rejected without recording anything.
  for (const bad of [null, 5, { massQ: -1, energyQ: 0 }, { massQ: 1.5, energyQ: 0 }, { massQ: 1, energyQ: NaN }, { massQ: 1 }]) {
    assert.throws(() => ledger.importExternal(1, () => bad as never), RangeError);
  }
  assert.equal(ledger.escrowMassQ(1), 0n);
  assert.throws(() => ledger.importExternal(99, flakyPull), RangeError);
  assert.throws(() => ledger.depositEscrow(0, -1, 0), UnitsError);
  assert.equal(ledger.externalMassInQ, 20n);

  // The commit contract is internal: only StagedStore subclasses can take part in a transaction.
  assert.throws(
    () => new EnergyLedger({ initialAbioticMassQ: 0n }).registerStore({ commitStaged() {} } as unknown as StagedStore),
    TypeError
  );
});

test('Ledger poisoning: a store that violates the no-throw COMMIT contract freezes the ledger', () => {
  class BrokenStore extends StagedStore {
    readonly storeId = 'broken';
    readonly ownedKinds = [K.CELL_PLANT] as const;
    stagedDirtyCount = 0;
    checkDebit(): void {}
    checkCredit(): void {}
    applyDebit(): void {}
    applyCredit(): void {}
    stagedBalance(): number { return 0; }
    committedBalance(): number { return 0; }
    validateStaged(): void {}
    accumulateStagedDelta(): void {}
    accumulateCommittedTotals(_acc: ExactAccumulators): void {}
    commitStaged(): void { throw new Error('contract violation'); }
    abortStaged(): void {}
    typedArrayBytes(): number { return 0; }
  }
  const ledger = new EnergyLedger({ initialAbioticMassQ: 0n });
  ledger.registerStore(new BrokenStore());
  const tx = ledger.begin(0);
  tx.prepare();
  assert.throws(() => tx.commit(), /contract violation/);
  assert.equal(ledger.isPoisoned, true);
  assert.equal(ledger.audit().ok, false);
  assert.throws(() => ledger.begin(1), (e: unknown) => e instanceof EnergyInvariantError);
  assert.throws(() => ledger.depositEscrow(0, 1, 1), EnergyInvariantError);
});

test('Journal: committed MassPosting / EnergyPosting records are retained in order, bounded, and replayable', () => {
  const world = createWorld({ journal: 8 });
  const { ledger } = world;
  seed(world);
  assert.equal(ledger.journalCapacity, 8);
  assert.equal(ledger.getMassJournal().length, 3);
  assert.equal(ledger.getEnergyJournal().length, 3);

  // Aborted transactions never reach the journal
  let tx = ledger.begin(1);
  tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 9, 27);
  tx.abort();
  assert.equal(ledger.getMassJournal().length, 3);

  tx = ledger.begin(1);
  tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 5, 15);
  tx.postEnergy(R.PLANT_RESPIRATION, K.CELL_PLANT, 0, K.HEAT, 0, 4);
  tx.prepare();
  tx.commit();
  const mass = ledger.getMassJournal();
  const energy = ledger.getEnergyJournal();
  assert.equal(mass.length, 4);
  assert.equal(energy.length, 5);
  assert.deepEqual(mass[3], {
    txId: tx.id, tick: 1, seq: 0, reason: R.PLANT_TURNOVER,
    srcKind: K.CELL_PLANT, srcId: 0, dstKind: K.CELL_DETRITUS, dstId: 0, massQ: 5,
  });
  assert.equal(energy[4].dstKind, K.HEAT);
  assert.equal(energy[4].energyQ, 4);
  assert.ok(Object.isFrozen(mass[0]));

  // Replaying the energy journal reproduces the committed stocks exactly
  const balance = new Map<string, bigint>();
  let sun = 0n;
  let heat = 0n;
  let genesis = 0n;
  for (const p of energy) {
    const q = BigInt(p.energyQ);
    if (p.srcKind === K.GENESIS) genesis += q;
    else if (p.srcKind === K.SUN) sun += q;
    else balance.set(`${p.srcKind}:${p.srcId}`, (balance.get(`${p.srcKind}:${p.srcId}`) ?? 0n) - q);
    if (p.dstKind === K.HEAT) heat += q;
    else balance.set(`${p.dstKind}:${p.dstId}`, (balance.get(`${p.dstKind}:${p.dstId}`) ?? 0n) + q);
    for (const v of balance.values()) assert.ok(v >= 0n, 'no account goes negative during replay');
  }
  assert.equal(balance.get(`${K.CELL_PLANT}:0`), BigInt(world.grid.getEnergyQ(EnergyPool.PLANT, 0)));
  assert.equal(balance.get(`${K.CELL_DETRITUS}:0`), 15n);
  let stock = 0n;
  for (const v of balance.values()) stock += v;
  assert.equal(stock, genesis + sun - heat);
  assert.equal(stock, ledger.audit().actualEnergyQ);

  // Ring overflow keeps the newest entries in chronological order
  for (let tick = 2; tick < 12; tick++) {
    tx = ledger.begin(tick);
    tx.postMass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, tick);
    tx.prepare();
    tx.commit();
  }
  const ring = ledger.getMassJournal();
  assert.equal(ring.length, 8);
  assert.deepEqual(ring.map((p) => p.massQ), [4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(ring.map((p) => p.tick), [4, 5, 6, 7, 8, 9, 10, 11]);
});

test('Determinism: identical seeds give bit-identical worlds and ledgers; different seeds diverge', () => {
  const run = (seedText: string): string => {
    const world = createWorld({ cells: 32, entities: 32, abiotic: 10n ** 12n });
    const { ledger } = world;
    const rng = new SeededRng(seedText);
    let tx = ledger.begin(0, { genesis: true });
    for (let i = 0; i < 32; i++) {
      const m = rng.nextInt(500, 5000);
      tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, i, m, m * 3);
      tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.ORGANISM_STRUCT, i, 40, 200);
      tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.ORGANISM_RESERVE, i, 4, 120);
    }
    tx.prepare();
    tx.commit();
    for (let tick = 1; tick <= 120; tick++) {
      tx = ledger.begin(tick);
      for (let i = 0; i < 32; i++) {
        const gpp = rng.nextInt(0, 90);
        tx.postEnergy(R.PHOTOSYNTHESIS, K.SUN, 0, K.CELL_PLANT, i, gpp * 3);
        tx.postMass(R.PHOTOSYNTHESIS, K.ABIOTIC, 0, K.CELL_PLANT, i, gpp);
        const bite = Math.min(rng.nextInt(0, 60), world.grid.getStagedMassQ(EnergyPool.PLANT, i));
        tx.transferBiomass(R.INGESTION, K.CELL_PLANT, i, K.ORGANISM_RESERVE, i, bite, bite * 3);
        const cost = Math.min(rng.nextInt(0, 40), world.entities.stagedBalance(K.ORGANISM_RESERVE, i, true));
        tx.postEnergy(R.METABOLISM, K.ORGANISM_RESERVE, i, K.HEAT, 0, cost);
      }
      if (rng.chance(0.2)) {
        tx.abort();
      } else {
        tx.prepare();
        tx.commit();
      }
    }
    ledger.assertAudit();
    return digest(world);
  };
  const a = run('energy-determinism');
  const b = run('energy-determinism');
  const c = run('energy-determinism-other');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('Wide totals: world sums beyond 2^53 quanta stay exact through transactions and audit', () => {
  const grid = new WorldEnergyGrid({ width: 64, height: 1 });
  const ledger = new EnergyLedger({ initialAbioticMassQ: 2n ** 80n });
  ledger.registerStore(grid);
  let tx = ledger.begin(0, { genesis: true });
  for (let i = 0; i < 64; i++) {
    tx.postMass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, i, MAX_QUANTA);
    tx.postEnergy(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, i, MAX_QUANTA - i);
  }
  tx.prepare();
  tx.commit();
  let audit = ledger.assertAudit();
  assert.equal(audit.actualMassQ, 2n ** 80n + 64n * BigInt(MAX_QUANTA));
  assert.equal(audit.actualEnergyQ, 64n * BigInt(MAX_QUANTA) - 2016n);
  assert.ok(audit.actualEnergyQ > 2n ** 58n);

  tx = ledger.begin(1);
  for (let i = 0; i < 64; i++) {
    tx.postMass(R.PLANT_RESPIRATION, K.CELL_PLANT, i, K.ABIOTIC, 0, MAX_QUANTA);
    tx.postEnergy(R.PLANT_RESPIRATION, K.CELL_PLANT, i, K.HEAT, 0, MAX_QUANTA - i);
  }
  tx.prepare();
  tx.commit();
  audit = ledger.assertAudit();
  assert.equal(ledger.globalAbioticMassQ, 2n ** 80n + 64n * BigInt(MAX_QUANTA));
  assert.equal(ledger.heatEnergyOutQ, 64n * BigInt(MAX_QUANTA) - 2016n);
  assert.equal(audit.actualEnergyQ, 0n);
  assert.equal(grid.totals().totalMassQ, 0n);
});

test('FIX 3: rollback clears lastTransactionFlow after ACTIVE and PREPARED aborts while preserving committed metadata', () => {
  const world = createWorld();
  seed(world);
  const { ledger } = world;

  // Committed tx populates lastTransactionFlow and committed markers
  const tx1 = ledger.begin(1);
  tx1.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 12, 36);
  tx1.prepare();
  tx1.commit();
  assert.deepEqual(ledger.lastTransactionFlow(R.PLANT_TURNOVER), { massQ: 12n, energyQ: 36n });
  assert.equal(ledger.lastCommittedTick, 1);
  assert.equal(ledger.lastCommittedTxId, tx1.id);

  // Aborting an ACTIVE transaction resets per-tx flow accumulators to zero and keeps committed markers
  const tx2 = ledger.begin(2);
  tx2.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 99, 297);
  assert.deepEqual(ledger.lastTransactionFlow(R.PLANT_TURNOVER), { massQ: 99n, energyQ: 297n });
  tx2.abort();
  assert.deepEqual(ledger.lastTransactionFlow(R.PLANT_TURNOVER), { massQ: 0n, energyQ: 0n });
  assert.equal(ledger.lastCommittedTick, 1);
  assert.equal(ledger.lastCommittedTxId, tx1.id);
  assert.equal(ledger.cumulativeFlow(R.PLANT_TURNOVER).massQ, 12n);

  // Aborting a PREPARED transaction also clears lastTransactionFlow
  const tx3 = ledger.begin(2);
  tx3.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 50, 150);
  tx3.prepare();
  assert.deepEqual(ledger.lastTransactionFlow(R.PLANT_TURNOVER), { massQ: 50n, energyQ: 150n });
  tx3.abort();
  assert.deepEqual(ledger.lastTransactionFlow(R.PLANT_TURNOVER), { massQ: 0n, energyQ: 0n });
  assert.equal(ledger.lastCommittedTick, 1);
  assert.equal(ledger.lastCommittedTxId, tx1.id);
  assert.equal(ledger.cumulativeFlow(R.PLANT_TURNOVER).energyQ, 36n);
  ledger.assertAudit();
});

test('FIX 4: transferBiomass validates and reserves both posting buffers before staging either leg', () => {
  const world = createWorld();
  seed(world);
  const { ledger, grid } = world;
  const state = (ledger as unknown as {
    state: { energyBuffer: { ensureRoom: () => void }; massBuffer: { count: number } };
  }).state;

  const tx = ledger.begin(1);
  const origEnsureRoom = state.energyBuffer.ensureRoom.bind(state.energyBuffer);
  state.energyBuffer.ensureRoom = () => {
    throw new Error('simulated energyBuffer allocation failure');
  };

  assert.throws(
    () => tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 25, 75),
    /simulated energyBuffer allocation failure/
  );

  // ZERO partial mutation: neither store, nor massBuffer, nor reasonTxMass changed
  assert.equal(tx.massPostingCount, 0);
  assert.equal(tx.energyPostingCount, 0);
  assert.equal(state.massBuffer.count, 0);
  assert.equal(grid.dirtyCellCount, 0);
  assert.equal(tx.stagedMassQ(K.CELL_PLANT, 0), 1000);
  assert.equal(tx.stagedEnergyQ(K.CELL_PLANT, 0), 3000);
  assert.equal(tx.stagedMassQ(K.CELL_DETRITUS, 0), 0);
  assert.deepEqual(ledger.lastTransactionFlow(R.PLANT_TURNOVER), { massQ: 0n, energyQ: 0n });

  // Restoring room lets the transaction finish cleanly
  state.energyBuffer.ensureRoom = origEnsureRoom;
  tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 25, 75);
  tx.prepare();
  tx.commit();
  assert.equal(grid.getMassQ(EnergyPool.DETRITUS, 0), 25);
  assert.equal(grid.getEnergyQ(EnergyPool.DETRITUS, 0), 75);
  ledger.assertAudit();
});

test('FIX 5: PostingJournal preserves exact txId beyond 2^32 (including ring wrap) and guards MAX_SAFE_INT', () => {
  const world = createWorld({ journal: 6 });
  seed(world);
  const { ledger } = world;
  const state = (ledger as unknown as { state: { nextTxId: number } }).state;

  state.nextTxId = 0xfffffffd; // 4294967293
  const committedIds: number[] = [];
  for (let tick = 1; tick <= 8; tick++) {
    const tx = ledger.begin(tick);
    committedIds.push(tx.id);
    tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 1, 3);
    tx.prepare();
    tx.commit();
  }
  assert.deepEqual(committedIds, [
    4294967293,
    4294967294,
    4294967295,
    4294967296,
    4294967297,
    4294967298,
    4294967299,
    4294967300,
  ]);

  // Ring capacity is 6, so it holds the last 6 transactions spanning the 2^32 epoch transition and beyond
  assert.deepEqual(
    ledger.getMassJournal().map((p) => p.txId),
    [4294967295, 4294967296, 4294967297, 4294967298, 4294967299, 4294967300]
  );
  assert.deepEqual(
    ledger.getEnergyJournal().map((p) => p.txId),
    [4294967295, 4294967296, 4294967297, 4294967298, 4294967299, 4294967300]
  );

  // Now push completely past epoch 0 into epoch 1 (no epoch 0 entries left in ring)
  for (let tick = 9; tick <= 12; tick++) {
    const tx = ledger.begin(tick);
    tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 0, K.CELL_DETRITUS, 0, 1, 3);
    tx.prepare();
    tx.commit();
  }
  assert.deepEqual(
    ledger.getMassJournal().map((p) => p.txId),
    [4294967299, 4294967300, 4294967301, 4294967302, 4294967303, 4294967304]
  );

  // Exhaustion beyond MAX_SAFE_INT fails loudly instead of silently losing precision
  state.nextTxId = MAX_QUANTA + 1;
  assert.throws(() => ledger.begin(13), EnergyTransactionStateError);
});
