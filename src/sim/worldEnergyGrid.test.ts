import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountKind, PostingReason } from './energyAccounts';
import { EnergyLedger } from './energyLedger';
import { SeededRng } from './prng';
import { EnergyStoreError, EntityEnergyStore, StagedChannelStore } from './stagedStore';
import {
  MAX_QUANTA,
  MU_QUANTA_PER_UNIT,
  planCarrionConsumption,
  planCarrionDecomposition,
} from './units';
import {
  ENERGY_POOL_COUNT,
  EnergyPool,
  WORLD_ENERGY_CHANNEL_COUNT,
  WORLD_ENERGY_GRID_BYTES_PER_CELL,
  WorldEnergyGrid,
} from './worldEnergyGrid';

const K = AccountKind;
const R = PostingReason;

function createWorld(width: number, height: number, abiotic = 10n ** 15n) {
  const grid = new WorldEnergyGrid({ width, height });
  const ledger = new EnergyLedger({ initialAbioticMassQ: abiotic });
  ledger.registerStore(grid);
  return { grid, ledger };
}

/** Reads all six committed channels into plain arrays. */
function snapshotChannels(grid: WorldEnergyGrid): Float64Array[] {
  const out: Float64Array[] = [];
  for (let pool = 0; pool < ENERGY_POOL_COUNT; pool++) {
    const m = new Float64Array(grid.cellCount);
    const e = new Float64Array(grid.cellCount);
    grid.copyCommittedMass(pool as 0 | 1 | 2, m);
    grid.copyCommittedEnergy(pool as 0 | 1 | 2, e);
    out.push(m, e);
  }
  return out;
}

function assertBitIdentical(actual: Float64Array[], expected: Float64Array[], label: string): void {
  assert.equal(actual.length, expected.length);
  for (let c = 0; c < actual.length; c++) {
    assert.equal(
      Buffer.compare(Buffer.from(actual[c].buffer), Buffer.from(expected[c].buffer)),
      0,
      `${label}: channel ${c} differs`
    );
  }
}

function internalStore(grid: WorldEnergyGrid): {
  front: Float64Array[];
  back: Float64Array[];
  dirtyList: Uint32Array;
  dirtyFlag: Uint8Array;
} {
  return (grid as unknown as { store: never }).store;
}

test('WorldEnergyGrid: construction, spatial addressing, and wrapX', () => {
  const grid = new WorldEnergyGrid({ width: 7, height: 5 });
  assert.equal(grid.cellCount, 35);
  assert.equal(grid.toIndex(0, 0), 0);
  assert.equal(grid.toIndex(6, 4), 34);
  assert.equal(grid.toIndex(3, 2), 17);
  assert.deepEqual(grid.fromIndex(17), { x: 3, y: 2 });
  for (let i = 0; i < grid.cellCount; i++) {
    const { x, y } = grid.fromIndex(i);
    assert.equal(grid.toIndex(x, y), i);
  }
  for (const [x, y] of [[-1, 0], [7, 0], [0, -1], [0, 5], [1.5, 0], [NaN, 0]]) {
    assert.equal(grid.toIndex(x, y), -1);
  }
  assert.throws(() => grid.fromIndex(35), EnergyStoreError);
  assert.throws(() => grid.fromIndex(-1), EnergyStoreError);
  assert.throws(() => grid.getMassQ(EnergyPool.PLANT, 35), EnergyStoreError);
  assert.throws(() => grid.getMassQ(3 as never, 0), EnergyStoreError);

  const wrapped = new WorldEnergyGrid({ width: 7, height: 5, wrapX: true });
  assert.equal(wrapped.toIndex(-1, 0), 6);
  assert.equal(wrapped.toIndex(7, 1), 7);
  assert.equal(wrapped.toIndex(15, 4), 29);
  assert.equal(wrapped.toIndex(0, 5), -1);

  for (const [w, h] of [[0, 1], [1, 0], [-1, 1], [1.5, 2], [NaN, 2]]) {
    assert.throws(() => new WorldEnergyGrid({ width: w, height: h }), EnergyStoreError);
  }
});

test('WorldEnergyGrid: memory guard and exact byte accounting', () => {
  const grid = new WorldEnergyGrid({ width: 160, height: 90 });
  assert.equal(grid.typedArrayBytes(), WorldEnergyGrid.estimateBytes(14400));
  assert.equal(
    WorldEnergyGrid.estimateBytes(14400),
    14400 * WORLD_ENERGY_GRID_BYTES_PER_CELL + WORLD_ENERGY_CHANNEL_COUNT
  );
  assert.equal(WORLD_ENERGY_GRID_BYTES_PER_CELL, 105);
  assert.throws(
    () => new WorldEnergyGrid({ width: 1000, height: 1000, maxMemoryBytes: 1024 * 1024 }),
    /above the 1048576 byte budget/
  );
  assert.throws(() => new WorldEnergyGrid({ width: 70000, height: 70000 }), EnergyStoreError);
  assert.throws(() => new WorldEnergyGrid({ width: 2, height: 2, maxMemoryBytes: 0 }), EnergyStoreError);
  // Just inside the budget is accepted
  const bytes = WorldEnergyGrid.estimateBytes(100);
  assert.equal(new WorldEnergyGrid({ width: 10, height: 10, maxMemoryBytes: bytes }).cellCount, 100);
  assert.throws(() => new WorldEnergyGrid({ width: 10, height: 10, maxMemoryBytes: bytes - 1 }), EnergyStoreError);
});

test('WorldEnergyGrid: staged writes are invisible until COMMIT and dirtyCells are tracked exactly', () => {
  const { grid, ledger } = createWorld(4, 4);
  const tx = ledger.begin(0, { genesis: true });
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, 5, 1000, 3000);
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, 9, 10, 30);
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, 5, 1, 3);

  assert.equal(grid.getMassQ(EnergyPool.PLANT, 5), 0, 'committed view must not see staged data');
  assert.equal(grid.getStagedMassQ(EnergyPool.PLANT, 5), 1001);
  assert.equal(grid.getStagedEnergyQ(EnergyPool.PLANT, 5), 3003);
  assert.equal(grid.dirtyCellCount, 2);
  assert.equal(grid.isCellDirty(5), true);
  assert.equal(grid.isCellDirty(6), false);
  const dirty = new Uint32Array(16);
  assert.equal(grid.copyDirtyCells(dirty), 2);
  assert.deepEqual(Array.from(dirty.subarray(0, 2)), [5, 9], 'dirty list keeps first-touch order without duplicates');
  assert.throws(() => grid.clone(), /staged changes are pending/);

  tx.prepare();
  assert.equal(grid.getMassQ(EnergyPool.PLANT, 5), 0, 'PREPARE must not publish');
  tx.commit();
  assert.equal(grid.getMassQ(EnergyPool.PLANT, 5), 1001);
  assert.equal(grid.getEnergyQ(EnergyPool.PLANT, 9), 30);
  assert.equal(grid.dirtyCellCount, 0);
  assert.equal(grid.version, 1);
  assert.equal(grid.cellVersion(5), 1);
  assert.equal(grid.cellVersion(6), 0);
  assert.equal(grid.isSynchronized(), true);
  assert.equal(grid.swapCount, 1);
});

test('WorldEnergyGrid double buffering: untouched cells never revert to stale values across many flips', () => {
  const { grid, ledger } = createWorld(8, 8);
  // Tick 0: cell 3 gets a value and is then never touched again.
  let tx = ledger.begin(0, { genesis: true });
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, 3, 777, 2331);
  tx.prepare();
  tx.commit();

  // Tick 1: only cell 10 changes. A naive swap would now expose the pre-tick-0 buffer for cell 3.
  tx = ledger.begin(1, { genesis: true });
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, 10, 5, 15);
  tx.prepare();
  tx.commit();
  assert.equal(grid.getMassQ(EnergyPool.PLANT, 3), 777);
  assert.equal(grid.getEnergyQ(EnergyPool.PLANT, 3), 2331);

  // Ticks 2..41: alternate dirty sets so both physical buffers serve as front many times.
  for (let t = 2; t < 42; t++) {
    tx = ledger.begin(t, { genesis: true });
    const cell = t % 2 === 0 ? 20 : 30;
    tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, cell, 1, 3);
    tx.prepare();
    tx.commit();
    assert.equal(grid.getMassQ(EnergyPool.PLANT, 3), 777, `cell 3 mass after tick ${t}`);
    assert.equal(grid.getEnergyQ(EnergyPool.PLANT, 3), 2331, `cell 3 energy after tick ${t}`);
    assert.equal(grid.getMassQ(EnergyPool.PLANT, 10), 5, `cell 10 after tick ${t}`);
    assert.equal(grid.cellVersion(3), 1);
    assert.equal(grid.isSynchronized(), true);
  }
  assert.equal(grid.getMassQ(EnergyPool.PLANT, 20), 20);
  assert.equal(grid.getMassQ(EnergyPool.PLANT, 30), 20);
  assert.equal(grid.swapCount, 42);
  // Both physical buffers hold the same committed data at the tick boundary.
  const s = internalStore(grid);
  for (let c = 0; c < WORLD_ENERGY_CHANNEL_COUNT; c++) {
    assert.deepEqual(s.front[c], s.back[c]);
  }
  ledger.assertAudit();
});

test('WorldEnergyGrid double buffering: random multi-tick run is bit-identical to a single-buffer reference model', () => {
  const width = 24;
  const height = 16;
  const { grid, ledger } = createWorld(width, height);
  const n = grid.cellCount;
  const rng = new SeededRng('double-buffer-reference');
  // Reference model: one plain array per channel, updated only when a tick really commits.
  const ref: Float64Array[] = [];
  for (let c = 0; c < WORLD_ENERGY_CHANNEL_COUNT; c++) ref.push(new Float64Array(n));
  const lastChangedTick = new Int32Array(n).fill(-1);
  let commits = 0;
  let aborts = 0;
  const dirtySizes = new Set<number>();

  for (let tick = 0; tick < 300; tick++) {
    const tx = ledger.begin(tick, { genesis: true });
    const pending: Float64Array[] = ref.map((a) => Float64Array.from(a));
    const touched = new Set<number>();
    const mode = tick % 10;
    // Different dirty-set shapes: empty, single cell, repeated hits on one cell, sparse, full grid.
    // After tick 100 the lower half of the grid is left completely alone for 200 ticks.
    const quietPhase = tick > 100;
    const full = mode === 9 && !quietPhase;
    const ops = mode === 0 ? 0 : mode === 1 ? 1 : mode === 2 ? 12 : full ? n : rng.nextInt(2, 60);
    for (let k = 0; k < ops; k++) {
      const cell = mode === 2 ? n - 7 : full ? k : rng.nextInt(quietPhase ? n / 2 : 0, n - 1);
      const kind = full ? 0 : rng.nextInt(0, 3);
      if (kind === 0) {
        const m = rng.nextInt(1, 5000);
        tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, cell, m, m * 3);
        pending[0][cell] += m;
        pending[1][cell] += m * 3;
        touched.add(cell);
      } else if (kind === 1) {
        const m = Math.floor(pending[0][cell] / 3);
        if (m > 0) {
          tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, cell, K.CELL_DETRITUS, cell, m, m * 3);
          pending[0][cell] -= m;
          pending[1][cell] -= m * 3;
          pending[4][cell] += m;
          pending[5][cell] += m * 3;
          touched.add(cell);
        }
      } else if (kind === 2) {
        const m = Math.floor(pending[4][cell] / 2);
        const e = Math.floor(pending[5][cell] / 2);
        if (m > 0 || e > 0) {
          tx.postMass(R.DECOMPOSITION, K.CELL_DETRITUS, cell, K.ABIOTIC, 0, m);
          tx.postEnergy(R.DECOMPOSITION, K.CELL_DETRITUS, cell, K.HEAT, 0, e);
          pending[4][cell] -= m;
          pending[5][cell] -= e;
          touched.add(cell);
        }
      } else {
        const m = rng.nextInt(1, 100);
        tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_CARRION, cell, m, m * 7);
        pending[2][cell] += m;
        pending[3][cell] += m * 7;
        touched.add(cell);
      }
    }
    dirtySizes.add(grid.dirtyCellCount);
    assert.equal(grid.dirtyCellCount, touched.size);

    if (rng.chance(0.25)) {
      tx.abort();
      aborts++;
    } else {
      tx.prepare();
      tx.commit();
      commits++;
      for (let c = 0; c < ref.length; c++) ref[c].set(pending[c]);
      for (const cell of touched) lastChangedTick[cell] = tick;
    }

    assertBitIdentical(snapshotChannels(grid), ref, `after tick ${tick}`);
    assert.equal(grid.isSynchronized(), true, `buffers out of sync after tick ${tick}`);
    assert.equal(grid.dirtyCellCount, 0);
  }

  assert.ok(commits > 150 && aborts > 30);
  assert.ok(dirtySizes.has(0) && dirtySizes.has(1) && dirtySizes.has(n), 'empty, single and full dirty sets were exercised');
  // Some cells stayed untouched for a long time and still hold exactly their reference value.
  let longIdle = 0;
  for (let cell = 0; cell < n; cell++) {
    if (lastChangedTick[cell] >= 0 && lastChangedTick[cell] <= 100) longIdle++;
  }
  assert.ok(longIdle >= n / 2, 'run must include cells idle for 199+ consecutive ticks');
  const audit = ledger.assertAudit();
  assert.equal(audit.massResidualQ, 0n);
  assert.equal(audit.energyResidualQ, 0n);
});

test('WorldEnergyGrid: COMMIT reuses the same two physical buffers per channel (no reallocation)', () => {
  const { grid, ledger } = createWorld(16, 16);
  const s = internalStore(grid);
  const initial = new Set<Float64Array>([...s.front, ...s.back]);
  const dirtyList = s.dirtyList;
  const dirtyFlag = s.dirtyFlag;
  assert.equal(initial.size, WORLD_ENERGY_CHANNEL_COUNT * 2);
  const frontIdentityByTick: Float64Array[] = [];
  for (let tick = 0; tick < 50; tick++) {
    const tx = ledger.begin(tick, { genesis: true });
    tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, tick % 256, 10, 30);
    tx.prepare();
    tx.commit();
    const now = internalStore(grid);
    for (const buf of [...now.front, ...now.back]) {
      assert.ok(initial.has(buf), 'commit must never introduce a new buffer object');
    }
    assert.equal(now.dirtyList, dirtyList);
    assert.equal(now.dirtyFlag, dirtyFlag);
    frontIdentityByTick.push(now.front[0]);
  }
  // The physical buffer serving as front alternates on every flip.
  for (let i = 1; i < frontIdentityByTick.length; i++) {
    assert.notEqual(frontIdentityByTick[i], frontIdentityByTick[i - 1]);
  }
  assert.equal(frontIdentityByTick[2], frontIdentityByTick[0]);
});

test('WorldEnergyGrid: ABORT restores staging exactly, including after PREPARE', () => {
  const { grid, ledger } = createWorld(6, 6);
  let tx = ledger.begin(0, { genesis: true });
  for (let cell = 0; cell < 36; cell++) {
    tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, cell, 100 + cell, 300 + cell * 3);
  }
  tx.prepare();
  tx.commit();
  const before = snapshotChannels(grid);
  const abioticBefore = ledger.globalAbioticMassQ;

  tx = ledger.begin(1);
  tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 4, K.CELL_DETRITUS, 4, 50, 150);
  tx.postMass(R.PLANT_RESPIRATION, K.CELL_PLANT, 7, K.ABIOTIC, 0, 20);
  tx.postEnergy(R.PLANT_RESPIRATION, K.CELL_PLANT, 7, K.HEAT, 0, 60);
  assert.equal(grid.getStagedMassQ(EnergyPool.PLANT, 4), 54);
  tx.abort();
  assertBitIdentical(snapshotChannels(grid), before, 'after abort from ACTIVE');
  assert.equal(grid.getStagedMassQ(EnergyPool.PLANT, 4), 104, 'staging buffer restored');
  assert.equal(grid.getStagedMassQ(EnergyPool.DETRITUS, 4), 0);
  assert.equal(grid.dirtyCellCount, 0);
  assert.equal(grid.isSynchronized(), true);
  assert.equal(ledger.globalAbioticMassQ, abioticBefore);

  tx = ledger.begin(1);
  tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 4, K.CELL_DETRITUS, 4, 50, 150);
  tx.prepare();
  tx.abort();
  assertBitIdentical(snapshotChannels(grid), before, 'after abort from PREPARED');
  assert.equal(grid.isSynchronized(), true);
  assert.equal(grid.version, 1, 'aborted transactions do not advance the grid version');
  assert.equal(grid.swapCount, 1);
  ledger.assertAudit();

  // The world is fully usable afterwards
  tx = ledger.begin(1);
  tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 4, K.CELL_DETRITUS, 4, 50, 150);
  tx.prepare();
  tx.commit();
  assert.equal(grid.getMassQ(EnergyPool.DETRITUS, 4), 50);
  ledger.assertAudit();
});

test('WorldEnergyGrid: clone is deep and independent; read view is frozen, read-only, and never stale', () => {
  const { grid, ledger } = createWorld(5, 4);
  const view = grid.createReadView();
  assert.ok(Object.isFrozen(view));
  assert.equal(view.cellCount, 20);
  assert.equal(view.version(), 0);

  let tx = ledger.begin(0, { genesis: true });
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, 7, 400, 1200);
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_CARRION, 8, 16, 130);
  tx.prepare();
  tx.commit();

  // The same view object reflects every later commit (it holds no buffer reference).
  assert.equal(view.version(), 1);
  assert.equal(view.massQ(EnergyPool.PLANT, 7), 400);
  assert.equal(view.energyQ(EnergyPool.CARRION, view.toIndex(3, 1)), 130);
  assert.equal(view.cellVersion(7), 1);
  const cell = view.cell(7);
  assert.ok(Object.isFrozen(cell));
  assert.deepEqual(cell, {
    cellIndex: 7, x: 2, y: 1, version: 1,
    plantMassQ: 400, plantEnergyQ: 1200,
    carrionMassQ: 0, carrionEnergyQ: 0, detritusMassQ: 0, detritusEnergyQ: 0,
  });
  assert.throws(() => {
    (cell as { plantMassQ: number }).plantMassQ = 1;
  }, TypeError);
  assert.throws(() => {
    (view as unknown as { massQ: unknown }).massQ = () => 0;
  }, TypeError);
  for (const key of Object.keys(view)) {
    const value = (view as unknown as Record<string, unknown>)[key];
    assert.ok(!ArrayBuffer.isView(value), `read view must not expose buffer "${key}"`);
  }

  // Copies handed to the UI are detached from engine state.
  const copy = new Float64Array(20);
  view.copyMass(EnergyPool.PLANT, copy);
  copy[7] = 999999;
  assert.equal(grid.getMassQ(EnergyPool.PLANT, 7), 400);
  assert.throws(() => view.copyMass(EnergyPool.PLANT, new Float64Array(19)), EnergyStoreError);
  const totals = view.totals();
  assert.equal(totals.massQ[EnergyPool.PLANT], 400n);
  assert.equal(totals.energyQ[EnergyPool.CARRION], 130n);
  assert.equal(totals.totalMassQ, 416n);
  assert.equal(totals.totalEnergyQ, 1330n);

  // Staged data never leaks through the view
  tx = ledger.begin(1);
  tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 7, K.CELL_DETRITUS, 7, 100, 300);
  assert.equal(view.massQ(EnergyPool.PLANT, 7), 400);
  assert.equal(view.massQ(EnergyPool.DETRITUS, 7), 0);
  tx.abort();

  const clone = grid.clone();
  assert.notEqual(clone, grid);
  assertBitIdentical(snapshotChannels(clone), snapshotChannels(grid), 'clone');
  assert.equal(clone.version, grid.version);
  assert.equal(clone.cellVersion(7), 1);
  assert.equal(clone.isSynchronized(), true);

  tx = ledger.begin(1);
  tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, 7, K.CELL_DETRITUS, 7, 100, 300);
  tx.prepare();
  tx.commit();
  assert.equal(grid.getMassQ(EnergyPool.PLANT, 7), 300);
  assert.equal(clone.getMassQ(EnergyPool.PLANT, 7), 400, 'clone is unaffected by later commits');
  assert.equal(clone.getMassQ(EnergyPool.DETRITUS, 7), 0);
});

test('WorldEnergyGrid: per-account overflow and insufficient balance are rejected before staging', () => {
  const { grid, ledger } = createWorld(2, 2);
  let tx = ledger.begin(0, { genesis: true });
  tx.postMass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, 0, MAX_QUANTA);
  assert.throws(() => tx.postMass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, 0, 1), /would exceed 2\^53 - 1/);
  assert.equal(grid.getStagedMassQ(EnergyPool.PLANT, 0), MAX_QUANTA);
  assert.throws(() => tx.postMass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, 4, 1), EnergyStoreError);
  tx.prepare();
  tx.commit();
  tx = ledger.begin(1);
  assert.throws(
    () => tx.postMass(R.PLANT_TURNOVER, K.CELL_PLANT, 1, K.CELL_DETRITUS, 1, 1),
    /holds 0 quanta, cannot debit 1/
  );
  assert.equal(grid.dirtyCellCount, 0, 'a rejected posting must not dirty any cell');
  tx.abort();
  ledger.assertAudit();
});

test('WorldEnergyGrid / EntityEnergyStore: large arrays stay exact and synchronized', () => {
  const grid = new WorldEnergyGrid({ width: 1000, height: 500 });
  const entities = new EntityEnergyStore(100_000);
  const ledger = new EnergyLedger({ initialAbioticMassQ: 0n, postingCapacity: 4096 });
  ledger.registerStore(grid);
  ledger.registerStore(entities);
  assert.equal(grid.cellCount, 500_000);

  let tx = ledger.begin(0, { genesis: true });
  let expectedMass = 0n;
  let expectedEnergy = 0n;
  for (let cell = 0; cell < grid.cellCount; cell++) {
    const m = 1_000_000_000 + cell;
    tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.CELL_PLANT, cell, m, m * 3);
    expectedMass += BigInt(m);
    expectedEnergy += BigInt(m) * 3n;
  }
  for (let slot = 0; slot < entities.capacity; slot++) {
    tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.ORGANISM_STRUCT, slot, 40_000_000 + slot, 200_000_000);
    tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.ORGANISM_RESERVE, slot, 4_000_000, 120_000_000 + slot);
    expectedMass += BigInt(44_000_000 + slot);
    expectedEnergy += BigInt(320_000_000 + slot);
  }
  assert.equal(grid.dirtyCellCount, grid.cellCount);
  tx.prepare();
  tx.commit();
  const audit = ledger.assertAudit();
  assert.equal(audit.actualMassQ, expectedMass);
  assert.equal(audit.actualEnergyQ, expectedEnergy);
  assert.equal(grid.totals().totalMassQ + 0n < expectedMass, true);
  assert.equal(grid.isSynchronized(), true);
  assert.equal(entities.isSynchronized(), true);

  // Sparse second tick on the big world: only the touched cells change, everything else is intact.
  tx = ledger.begin(1);
  for (let k = 0; k < 1000; k++) {
    const cell = k * 499;
    tx.transferBiomass(R.PLANT_TURNOVER, K.CELL_PLANT, cell, K.CELL_DETRITUS, cell, 1000, 3000);
  }
  assert.equal(grid.dirtyCellCount, 1000);
  tx.prepare();
  tx.commit();
  assert.equal(grid.getMassQ(EnergyPool.PLANT, 499), 1_000_000_000 + 499 - 1000);
  assert.equal(grid.getMassQ(EnergyPool.PLANT, 500), 1_000_000_000 + 500);
  assert.equal(grid.getMassQ(EnergyPool.PLANT, 499_999), 1_000_000_000 + 499_999);
  assert.equal(grid.isSynchronized(), true);
  assert.equal(ledger.assertAudit().actualMassQ, expectedMass);
  assert.equal(entities.reserveEnergyQ(99_999), 120_000_000 + 99_999);
});

test('StagedChannelStore / EntityEnergyStore: growth preserves data and is refused mid-transaction', () => {
  const entities = new EntityEnergyStore(4);
  const ledger = new EnergyLedger({ initialAbioticMassQ: 0n });
  ledger.registerStore(entities);
  let tx = ledger.begin(0, { genesis: true });
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.ORGANISM_STRUCT, 3, 14, 70);
  assert.throws(() => entities.ensureCapacity(8), /staged changes are pending/);
  assert.throws(() => tx.postMass(R.GENESIS, K.GENESIS, 0, K.ORGANISM_STRUCT, 4, 1), EnergyStoreError);
  tx.prepare();
  tx.commit();
  entities.ensureCapacity(10);
  assert.equal(entities.capacity, 10);
  assert.equal(entities.structMassQ(3), 14);
  assert.equal(entities.structEnergyQ(3), 70);
  assert.equal(entities.slotVersionOf(3), 1);
  assert.equal(entities.isSynchronized(), true);
  assert.equal(entities.typedArrayBytes(), EntityEnergyStore.estimateBytes(10));
  tx = ledger.begin(1, { genesis: true });
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.ORGANISM_RESERVE, 9, 2, 60);
  tx.prepare();
  tx.commit();
  assert.equal(entities.reserveMassQ(9), 2);
  ledger.assertAudit();
  assert.throws(() => new EntityEnergyStore(1000, { maxMemoryBytes: 100 }), EnergyStoreError);
  assert.throws(() => new EntityEnergyStore(0), EnergyStoreError);
  assert.throws(() => new StagedChannelStore([], 4), EnergyStoreError);
});

test('WorldEnergyGrid (FIX 2): carrionFractions and strict stoichiometry across death, scavenging, decomposition and ABORT', () => {
  const MU = MU_QUANTA_PER_UNIT;
  const grid = new WorldEnergyGrid({ width: 4, height: 1 });
  const organisms = new EntityEnergyStore(4);
  const ledger = new EnergyLedger({ initialAbioticMassQ: 10n ** 12n, strictStoichiometry: true });
  ledger.registerStore(grid);
  ledger.registerStore(organisms);

  // Spawn two organisms and kill both into cell 1
  let tx = ledger.begin(0, { genesis: true });
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.ORGANISM_STRUCT, 0, 14 * MU, 70 * MU);
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.ORGANISM_RESERVE, 0, 2 * MU, 60 * MU);
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.ORGANISM_STRUCT, 1, 6 * MU, 30 * MU);
  tx.transferBiomass(R.GENESIS, K.GENESIS, 0, K.ORGANISM_RESERVE, 1, 1 * MU, 30 * MU);
  tx.prepare();
  tx.commit();

  tx = ledger.begin(1);
  tx.transferBiomass(R.DEATH, K.ORGANISM_STRUCT, 0, K.CELL_CARRION, 1, 14 * MU, 70 * MU);
  tx.transferBiomass(R.DEATH, K.ORGANISM_RESERVE, 0, K.CELL_CARRION, 1, 2 * MU, 60 * MU);
  tx.transferBiomass(R.DEATH, K.ORGANISM_STRUCT, 1, K.CELL_CARRION, 1, 6 * MU, 30 * MU);
  tx.transferBiomass(R.DEATH, K.ORGANISM_RESERVE, 1, K.CELL_CARRION, 1, 1 * MU, 30 * MU);
  assert.deepEqual(grid.stagedCarrionFractions(1), {
    structMassQ: 20 * MU,
    structEnergyQ: 100 * MU,
    reserveMassQ: 3 * MU,
    reserveEnergyQ: 90 * MU,
  });
  tx.prepare();
  tx.commit();
  assert.deepEqual(grid.carrionFractions(1), {
    structMassQ: 20 * MU,
    structEnergyQ: 100 * MU,
    reserveMassQ: 3 * MU,
    reserveEnergyQ: 90 * MU,
  });
  ledger.assertStoichiometry();

  // Partial scavenging & decomposition followed by ABORT restores exact fractions
  tx = ledger.begin(2);
  const cm = grid.getStagedMassQ(EnergyPool.CARRION, 1);
  const ce = grid.getStagedEnergyQ(EnergyPool.CARRION, 1);
  const bite = planCarrionConsumption(cm, ce, 7 * MU + 13);
  tx.postMass(R.DECOMPOSITION, K.CELL_CARRION, 1, K.ABIOTIC, 0, bite.totalMassQ);
  tx.postEnergy(R.DECOMPOSITION, K.CELL_CARRION, 1, K.HEAT, 0, bite.totalEnergyQ);
  tx.prepare();
  tx.abort();
  assert.deepEqual(grid.carrionFractions(1), {
    structMassQ: 20 * MU,
    structEnergyQ: 100 * MU,
    reserveMassQ: 3 * MU,
    reserveEnergyQ: 90 * MU,
  });

  // Commit proportional scavenging + decomposition
  tx = ledger.begin(2);
  const dec = planCarrionDecomposition(cm, ce, 125_000);
  tx.postMass(R.DECOMPOSITION, K.CELL_CARRION, 1, K.ABIOTIC, 0, dec.totalMassQ);
  tx.postEnergy(R.DECOMPOSITION, K.CELL_CARRION, 1, K.HEAT, 0, dec.totalEnergyQ);
  tx.prepare();
  tx.commit();
  const after = grid.carrionFractions(1);
  assert.equal(after.structMassQ + after.reserveMassQ, grid.getMassQ(EnergyPool.CARRION, 1));
  assert.equal(after.structEnergyQ + after.reserveEnergyQ, grid.getEnergyQ(EnergyPool.CARRION, 1));
  ledger.assertStoichiometry();
  ledger.assertAudit();
});
