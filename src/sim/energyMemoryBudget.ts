/**
 * Exact memory budget of the energy infrastructure (Phase 2.2.1b / P1).
 *
 * `typedArrayBytes` figures are EXACT: they are computed from the same layout constants the
 * classes allocate with, and the test-suite asserts them against the real `byteLength` of live
 * instances. `estimatedJsOverheadBytes` is an ESTIMATE of engine-dependent object headers and is
 * reported separately; it is not a profiling result.
 */

import { POSTING_REASON_COUNT } from './energyAccounts';
import {
  DEFAULT_ESCROW_SLOTS,
  DEFAULT_POSTING_CAPACITY,
  LEDGER_ESCROW_ARRAY_COUNT,
  LEDGER_REASON_ARRAY_COUNT,
} from './energyLedger';
import {
  LEDGER_ACCUMULATOR_COUNT,
  POSTING_BUFFER_BYTES_PER_ENTRY,
  POSTING_JOURNAL_BYTES_PER_ENTRY,
} from './energyTransaction';
import { ENTITY_CHANNEL_COUNT, EntityEnergyStore } from './stagedStore';
import { WORLD_ENERGY_CHANNEL_COUNT, WorldEnergyGrid } from './worldEnergyGrid';

export interface EnergyMemoryBudgetInput {
  readonly cellCount: number;
  readonly entityCapacity: number;
  readonly escrowSlots?: number;
  readonly postingCapacity?: number;
  readonly journalCapacity?: number;
}

export interface EnergyMemoryBudget {
  readonly input: Required<EnergyMemoryBudgetInput>;
  /** Exact bytes: committed (front) grid channels. */
  readonly gridFrontBytes: number;
  /** Exact bytes: staging (back) grid channels. */
  readonly gridBackBytes: number;
  /** Exact bytes: dirty flags, dirty list, cell versions, channel descriptors. */
  readonly gridTrackingBytes: number;
  readonly gridTotalBytes: number;
  readonly gridBytesPerCell: number;
  readonly entityFrontBytes: number;
  readonly entityBackBytes: number;
  readonly entityTrackingBytes: number;
  readonly entityTotalBytes: number;
  readonly entityBytesPerEntity: number;
  /** Exact bytes: scratch + cumulative exact accumulators (the allocation-free BigInt replacement). */
  readonly ledgerAccumulatorBytes: number;
  /** Exact bytes: staged posting buffers of the open transaction (mass + energy). */
  readonly postingBufferBytes: number;
  /** Exact bytes: committed posting journal rings (mass + energy). */
  readonly journalBytes: number;
  readonly ledgerTotalBytes: number;
  /** Exact total of all TypedArray buffers. */
  readonly typedArrayBytes: number;
  /** Number of TypedArray objects backing the figures above. */
  readonly typedArrayObjectCount: number;
  /** ESTIMATE of JS object overhead (headers of TypedArrays/ArrayBuffers and owner objects). */
  readonly estimatedJsOverheadBytes: number;
  /** Persistent BigInt objects held by the infrastructure (none: totals live in Float64 limbs). */
  readonly persistentBigIntCount: number;
}

/** Rough per-TypedArray engine overhead (object + ArrayBuffer headers). ESTIMATE, engine dependent. */
export const ESTIMATED_BYTES_PER_TYPED_ARRAY_OBJECT = 160;
/** Rough overhead of the handful of owning class instances and small JS arrays. ESTIMATE. */
export const ESTIMATED_FIXED_OBJECT_OVERHEAD_BYTES = 4096;

function assertCount(value: number, label: string, min: number): number {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`${label} must be an integer >= ${min}, received: ${value}`);
  }
  return value;
}

export function computeEnergyMemoryBudget(input: EnergyMemoryBudgetInput): EnergyMemoryBudget {
  const cellCount = assertCount(input.cellCount, 'cellCount', 1);
  const entityCapacity = assertCount(input.entityCapacity, 'entityCapacity', 0);
  const escrowSlots = assertCount(input.escrowSlots ?? DEFAULT_ESCROW_SLOTS, 'escrowSlots', 1);
  const postingCapacity = assertCount(input.postingCapacity ?? DEFAULT_POSTING_CAPACITY, 'postingCapacity', 1);
  const journalCapacity = assertCount(input.journalCapacity ?? 0, 'journalCapacity', 0);

  const gridFrontBytes = WORLD_ENERGY_CHANNEL_COUNT * cellCount * 8;
  const gridBackBytes = gridFrontBytes;
  const gridTotalBytes = WorldEnergyGrid.estimateBytes(cellCount);
  const gridTrackingBytes = gridTotalBytes - gridFrontBytes - gridBackBytes;

  const entityFrontBytes = ENTITY_CHANNEL_COUNT * entityCapacity * 8;
  const entityBackBytes = entityFrontBytes;
  const entityTotalBytes = entityCapacity > 0 ? EntityEnergyStore.estimateBytes(entityCapacity) : 0;
  const entityTrackingBytes = entityTotalBytes - entityFrontBytes - entityBackBytes;

  // Each exact accumulator is two Float64 limbs (16 bytes).
  const ledgerAccumulatorBytes =
    (LEDGER_ACCUMULATOR_COUNT +
      LEDGER_REASON_ARRAY_COUNT * POSTING_REASON_COUNT +
      LEDGER_ESCROW_ARRAY_COUNT * escrowSlots) *
    16;
  const postingBufferBytes = 2 * postingCapacity * POSTING_BUFFER_BYTES_PER_ENTRY;
  const journalBytes = 2 * journalCapacity * POSTING_JOURNAL_BYTES_PER_ENTRY;
  const ledgerTotalBytes = ledgerAccumulatorBytes + postingBufferBytes + journalBytes;

  const typedArrayBytes = gridTotalBytes + entityTotalBytes + ledgerTotalBytes;

  const storeArrays = (channels: number): number => channels * 2 + 4;
  const typedArrayObjectCount =
    storeArrays(WORLD_ENERGY_CHANNEL_COUNT) +
    (entityCapacity > 0 ? storeArrays(ENTITY_CHANNEL_COUNT) : 0) +
    (1 + LEDGER_REASON_ARRAY_COUNT + LEDGER_ESCROW_ARRAY_COUNT) * 2 + // accumulator limb arrays
    2 * 6 + // two posting buffers
    (journalCapacity > 0 ? 2 * 9 : 0);

  return Object.freeze({
    input: Object.freeze({ cellCount, entityCapacity, escrowSlots, postingCapacity, journalCapacity }),
    gridFrontBytes,
    gridBackBytes,
    gridTrackingBytes,
    gridTotalBytes,
    gridBytesPerCell: gridTotalBytes / cellCount,
    entityFrontBytes,
    entityBackBytes,
    entityTrackingBytes,
    entityTotalBytes,
    entityBytesPerEntity: entityCapacity > 0 ? entityTotalBytes / entityCapacity : 0,
    ledgerAccumulatorBytes,
    postingBufferBytes,
    journalBytes,
    ledgerTotalBytes,
    typedArrayBytes,
    typedArrayObjectCount,
    estimatedJsOverheadBytes:
      typedArrayObjectCount * ESTIMATED_BYTES_PER_TYPED_ARRAY_OBJECT + ESTIMATED_FIXED_OBJECT_OVERHEAD_BYTES,
    persistentBigIntCount: 0,
  });
}
