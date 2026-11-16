import assert from 'node:assert/strict';
import test from 'node:test';
import { EnergyLedger } from './energyLedger';
import { computeEnergyMemoryBudget } from './energyMemoryBudget';
import { EntityEnergyStore } from './stagedStore';
import { WorldEnergyGrid } from './worldEnergyGrid';

const CELLS = 160 * 90; // default WorldGrid size

function measure(cellWidth: number, cellHeight: number, entityCapacity: number, postingCapacity: number, journalCapacity: number, escrowSlots: number) {
  const grid = new WorldEnergyGrid({ width: cellWidth, height: cellHeight });
  const entities = new EntityEnergyStore(entityCapacity);
  const ledger = new EnergyLedger({ initialAbioticMassQ: 0n, postingCapacity, journalCapacity, escrowSlots });
  return { grid, entities, ledger };
}

test('Memory budget: computed TypedArray bytes equal the real byteLength of live instances', () => {
  for (const [w, h, entities, postings, journal, escrow] of [
    [160, 90, 50_000, 1024, 0, 4],
    [160, 90, 100_000, 65_536, 4096, 8],
    [7, 3, 1, 1, 1, 1],
  ] as const) {
    const live = measure(w, h, entities, postings, journal, escrow);
    const budget = computeEnergyMemoryBudget({
      cellCount: w * h,
      entityCapacity: entities,
      postingCapacity: postings,
      journalCapacity: journal,
      escrowSlots: escrow,
    });
    assert.equal(budget.gridTotalBytes, live.grid.typedArrayBytes());
    assert.equal(budget.entityTotalBytes, live.entities.typedArrayBytes());
    assert.equal(budget.ledgerTotalBytes, live.ledger.typedArrayBytes());
    assert.equal(
      budget.typedArrayBytes,
      live.grid.typedArrayBytes() + live.entities.typedArrayBytes() + live.ledger.typedArrayBytes()
    );
    assert.equal(budget.gridFrontBytes + budget.gridBackBytes + budget.gridTrackingBytes, budget.gridTotalBytes);
    assert.equal(budget.entityFrontBytes + budget.entityBackBytes + budget.entityTrackingBytes, budget.entityTotalBytes);
    assert.equal(
      budget.typedArrayObjectCount,
      live.grid.typedArrayCount() + live.entities.typedArrayCount() + (1 + 4 + 4) * 2 + 12 + (journal > 0 ? 18 : 0)
    );
    assert.equal(budget.persistentBigIntCount, 0);
  }
});

test('Memory budget: exact figures for the default world with 50 000 and 100 000 organisms', () => {
  const b50 = computeEnergyMemoryBudget({ cellCount: CELLS, entityCapacity: 50_000 });
  const b100 = computeEnergyMemoryBudget({ cellCount: CELLS, entityCapacity: 100_000 });

  // Grid: 6 channels x 8 bytes x 2 buffers = 96, + 9 bytes tracking per cell, + 6 descriptor bytes
  assert.equal(b50.gridFrontBytes, 691_200);
  assert.equal(b50.gridBackBytes, 691_200);
  assert.equal(b50.gridTrackingBytes, 129_606);
  assert.equal(b50.gridTotalBytes, 1_512_006);
  assert.ok(Math.abs(b50.gridBytesPerCell - 105) < 0.001);

  // Entities: 4 channels x 8 bytes x 2 buffers = 64, + 9 bytes tracking per entity, + 4 descriptor bytes
  assert.equal(b50.entityTotalBytes, 3_650_004);
  assert.equal(b100.entityTotalBytes, 7_300_004);
  assert.equal(b100.entityFrontBytes, 3_200_000);
  assert.equal(b100.entityBackBytes, 3_200_000);
  assert.ok(Math.abs(b100.entityBytesPerEntity - 73) < 0.001);

  // Ledger: (24 + 4*12 + 4*4) accumulators x 16 bytes, two 1024-entry posting buffers x 19 bytes
  assert.equal(b50.ledgerAccumulatorBytes, 1408);
  assert.equal(b50.postingBufferBytes, 38_912);
  assert.equal(b50.journalBytes, 0);
  assert.equal(b50.ledgerTotalBytes, 40_320);

  assert.equal(b50.typedArrayBytes, 5_202_330);
  assert.equal(b100.typedArrayBytes, 8_852_330);
  assert.equal(b100.typedArrayBytes - b50.typedArrayBytes, 50_000 * 73);

  // JS-object overhead is an estimate, reported separately and small next to the buffers
  assert.ok(b100.estimatedJsOverheadBytes > 0 && b100.estimatedJsOverheadBytes < b100.typedArrayBytes / 100);
  assert.equal(b50.estimatedJsOverheadBytes, b100.estimatedJsOverheadBytes);
});

test('Memory budget: staging and journal growth are accounted for and inputs are validated', () => {
  const base = computeEnergyMemoryBudget({ cellCount: CELLS, entityCapacity: 100_000 });
  // One tick with 6 mass + 6 energy postings per organism needs 600k-entry staging buffers
  const heavy = computeEnergyMemoryBudget({
    cellCount: CELLS,
    entityCapacity: 100_000,
    postingCapacity: 1_048_576,
    journalCapacity: 65_536,
  });
  assert.equal(heavy.postingBufferBytes, 2 * 1_048_576 * 19);
  assert.equal(heavy.journalBytes, 2 * 65_536 * 31);
  assert.equal(heavy.typedArrayBytes - base.typedArrayBytes, heavy.postingBufferBytes + heavy.journalBytes - base.postingBufferBytes);
  const none = computeEnergyMemoryBudget({ cellCount: 1, entityCapacity: 0 });
  assert.equal(none.entityTotalBytes, 0);
  assert.equal(none.entityBytesPerEntity, 0);
  for (const bad of [0, -1, 1.5, NaN]) {
    assert.throws(() => computeEnergyMemoryBudget({ cellCount: bad, entityCapacity: 1 }), RangeError);
  }
  assert.throws(() => computeEnergyMemoryBudget({ cellCount: 1, entityCapacity: -1 }), RangeError);
  assert.throws(() => computeEnergyMemoryBudget({ cellCount: 1, entityCapacity: 1, postingCapacity: 0 }), RangeError);

  // The live ledger reports the grown staging buffers
  const ledger = new EnergyLedger({ initialAbioticMassQ: 0n, postingCapacity: 2 });
  const grid = new WorldEnergyGrid({ width: 2, height: 1 });
  ledger.registerStore(grid);
  const before = ledger.typedArrayBytes();
  const tx = ledger.begin(0, { genesis: true });
  for (let i = 0; i < 9; i++) tx.postMass(0, 2, 0, 6, 0, 1);
  tx.abort();
  assert.equal(ledger.postingCapacity, 16);
  assert.equal(ledger.typedArrayBytes() - before, (16 - 2) * 19, 'only the mass buffer grew');
});
