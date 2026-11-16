/**
 * EnergyTransaction — atomic unit of change of the energy economy (Phase 2.2.1b / P1).
 *
 * Lifecycle:  ACTIVE --prepare()--> PREPARED --commit()--> COMMITTED
 *                 \________________abort()________________/-> ABORTED
 *
 *   ACTIVE    Postings are validated one by one and applied to STAGING buffers only.
 *             Committed state is untouched; anything may still throw.
 *   PREPARE   Independent verification of invariants I1-I4 on the staged result. A failure
 *             aborts the transaction automatically and throws. Success seals the transaction.
 *   COMMIT    Publishes the staged result: buffer flips, accumulator copies, counters. It runs
 *             only pre-validated, non-throwing, allocation-free operations on in-engine stores
 *             and never invokes user callbacks or external providers.
 *   ABORT     Restores staging from committed state. Legal from ACTIVE or PREPARED.
 *
 * External resources (the future TransactionalFoodSource of P2) are never touched during
 * COMMIT. They are pulled before PREPARE into ledger-held ESCROW accounts, which are durable:
 * if the transaction later aborts, the withdrawn amount stays in escrow and is neither lost nor
 * duplicated.
 */

import {
  AccountKind,
  AccountKindId,
  ACCOUNT_KIND_COUNT,
  ACCOUNT_KIND_NAMES,
  EnergyPosting,
  MassPosting,
  POSTING_REASON_COUNT,
  PostingReasonId,
  checkEnergyRoute,
  checkMassRoute,
  isEnergyRouteAllowedFast,
  isMassRouteAllowedFast,
} from './energyAccounts';
import { InsufficientBalanceError, StagedStore } from './stagedStore';
import { ExactAccumulators, UnitsError } from './units';

const AK_SUN = AccountKind.SUN;
const AK_HEAT = AccountKind.HEAT;
const AK_GENESIS = AccountKind.GENESIS;
const AK_ABIOTIC = AccountKind.ABIOTIC;
const AK_ESCROW = AccountKind.ESCROW;
const PR_COUNT = POSTING_REASON_COUNT;
const LOCAL_MAX_SAFE_INT = Number.MAX_SAFE_INTEGER;

const LOCAL_MASS_ROUTE_LUT = new Uint8Array(4096);
const LOCAL_ENERGY_ROUTE_LUT = new Uint8Array(4096);
for (let r = 0; r < PR_COUNT; r++) {
  for (let s = 0; s < ACCOUNT_KIND_COUNT; s++) {
    for (let d = 0; d < ACCOUNT_KIND_COUNT; d++) {
      const idx = (r << 8) | (s << 4) | d;
      if (isMassRouteAllowedFast(r, s, d)) LOCAL_MASS_ROUTE_LUT[idx] = 1;
      if (isEnergyRouteAllowedFast(r, s, d)) LOCAL_ENERGY_ROUTE_LUT[idx] = 1;
    }
  }
}

export class EnergyTransactionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnergyTransactionStateError';
  }
}

/** A posting violates a routing rule (directionality, reason table, genesis restriction). */
export class EnergyRuleError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'EnergyRuleError';
  }
}

/** A conservation or validity invariant (I1-I5) does not hold. */
export class EnergyInvariantError extends Error {
  public readonly invariant: string;
  constructor(invariant: string, message: string) {
    super(`${invariant}: ${message}`);
    this.name = 'EnergyInvariantError';
    this.invariant = invariant;
  }
}

export type EnergyTransactionState = 'ACTIVE' | 'PREPARED' | 'COMMITTED' | 'ABORTED';

/** Bytes per staged posting: reason(1) + srcKind(1) + dstKind(1) + srcId(4) + dstId(4) + amount(8). */
export const POSTING_BUFFER_BYTES_PER_ENTRY = 19;
/** Bytes per journal entry: staged posting (19) + tick(4) + txId(4) + seq(4). */
export const POSTING_JOURNAL_BYTES_PER_ENTRY = 31;

/** Growable SoA buffer of the postings of the transaction currently being staged. */
export class PostingBuffer {
  reason: Uint8Array;
  srcKind: Uint8Array;
  dstKind: Uint8Array;
  srcId: Uint32Array;
  dstId: Uint32Array;
  amount: Float64Array;
  count = 0;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError(`Posting capacity must be a positive integer, received: ${capacity}`);
    }
    this.reason = new Uint8Array(capacity);
    this.srcKind = new Uint8Array(capacity);
    this.dstKind = new Uint8Array(capacity);
    this.srcId = new Uint32Array(capacity);
    this.dstId = new Uint32Array(capacity);
    this.amount = new Float64Array(capacity);
  }

  get capacity(): number {
    return this.reason.length;
  }

  typedArrayBytes(): number {
    return this.capacity * POSTING_BUFFER_BYTES_PER_ENTRY;
  }

  /** Guarantees room for one more posting. May allocate; only called while ACTIVE. */
  ensureRoom(): void {
    if (this.count < this.capacity) return;
    const next = this.capacity * 2;
    const grow = <T extends Uint8Array | Uint32Array | Float64Array>(old: T, fresh: T): T => {
      fresh.set(old as never);
      return fresh;
    };
    this.reason = grow(this.reason, new Uint8Array(next));
    this.srcKind = grow(this.srcKind, new Uint8Array(next));
    this.dstKind = grow(this.dstKind, new Uint8Array(next));
    this.srcId = grow(this.srcId, new Uint32Array(next));
    this.dstId = grow(this.dstId, new Uint32Array(next));
    this.amount = grow(this.amount, new Float64Array(next));
  }

  push(reason: number, srcKind: number, srcId: number, dstKind: number, dstId: number, q: number): void {
    const i = this.count++;
    this.reason[i] = reason;
    this.srcKind[i] = srcKind;
    this.dstKind[i] = dstKind;
    this.srcId[i] = srcId;
    this.dstId[i] = dstId;
    this.amount[i] = q;
  }
}

/** Fixed-capacity ring of committed postings (optional audit journal). */
export class PostingJournal {
  public readonly capacity: number;
  private readonly reason: Uint8Array;
  private readonly srcKind: Uint8Array;
  private readonly dstKind: Uint8Array;
  private readonly srcId: Uint32Array;
  private readonly dstId: Uint32Array;
  private readonly amount: Float64Array;
  private readonly tick: Uint32Array;
  private readonly txId: Uint32Array;
  private readonly seq: Uint32Array;
  /** Sparse epoch transitions (epoch = floor(txId / 2^32)) to avoid 32-bit truncation without extra TypedArray bytes. */
  private readonly txEpochs: Array<{ startTotal: number; epoch: number }> = [];
  private lastEpoch = 0;
  private head = 0;
  private sizeValue = 0;
  private totalValue = 0;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError(`Journal capacity must be a positive integer, received: ${capacity}`);
    }
    this.capacity = capacity;
    this.reason = new Uint8Array(capacity);
    this.srcKind = new Uint8Array(capacity);
    this.dstKind = new Uint8Array(capacity);
    this.srcId = new Uint32Array(capacity);
    this.dstId = new Uint32Array(capacity);
    this.amount = new Float64Array(capacity);
    this.tick = new Uint32Array(capacity);
    this.txId = new Uint32Array(capacity);
    this.seq = new Uint32Array(capacity);
  }

  get size(): number {
    return this.sizeValue;
  }

  /** Total number of postings ever appended (including overwritten ones). */
  get totalAppended(): number {
    return this.totalValue;
  }

  typedArrayBytes(): number {
    return this.capacity * POSTING_JOURNAL_BYTES_PER_ENTRY;
  }

  /** Appends all postings of a committed transaction. Zero-allocation while txId < 2^32. */
  appendAll(buffer: PostingBuffer, tick: number, txId: number): void {
    const n = buffer.count;
    if (n === 0) return;
    if (txId >= 0x1_0000_0000) {
      const epoch = Math.floor(txId / 0x1_0000_0000);
      if (epoch !== this.lastEpoch) {
        this.txEpochs.push({ startTotal: this.totalValue, epoch });
        this.lastEpoch = epoch;
      }
    }
    const txLo = txId >>> 0;
    const cap = this.capacity;
    for (let i = 0; i < n; i++) {
      const at = this.head;
      this.reason[at] = buffer.reason[i];
      this.srcKind[at] = buffer.srcKind[i];
      this.dstKind[at] = buffer.dstKind[i];
      this.srcId[at] = buffer.srcId[i];
      this.dstId[at] = buffer.dstId[i];
      this.amount[at] = buffer.amount[i];
      this.tick[at] = tick;
      this.txId[at] = txLo;
      this.seq[at] = i;
      this.head = at + 1 === cap ? 0 : at + 1;
    }
    this.sizeValue = this.sizeValue + n > cap ? cap : this.sizeValue + n;
    this.totalValue += n;
    if (this.txEpochs.length > 1) {
      const oldestTotal = this.totalValue - this.sizeValue;
      while (this.txEpochs.length > 1 && this.txEpochs[1].startTotal <= oldestTotal) {
        this.txEpochs.shift();
      }
    }
  }

  /** Visits retained postings in chronological order. */
  forEach(
    visitor: (
      txId: number,
      tick: number,
      seq: number,
      reason: number,
      srcKind: number,
      srcId: number,
      dstKind: number,
      dstId: number,
      amount: number
    ) => void
  ): void {
    const start = this.sizeValue < this.capacity ? 0 : this.head;
    const oldestTotal = this.totalValue - this.sizeValue;
    const epochs = this.txEpochs;
    let epIdx = 0;
    let epoch = 0;
    while (epIdx < epochs.length && epochs[epIdx].startTotal <= oldestTotal) {
      epoch = epochs[epIdx].epoch;
      epIdx++;
    }
    for (let k = 0; k < this.sizeValue; k++) {
      const totalPos = oldestTotal + k;
      while (epIdx < epochs.length && epochs[epIdx].startTotal <= totalPos) {
        epoch = epochs[epIdx].epoch;
        epIdx++;
      }
      const i = (start + k) % this.capacity;
      const fullTxId = epoch === 0 ? this.txId[i] : epoch * 0x1_0000_0000 + this.txId[i];
      visitor(
        fullTxId,
        this.tick[i],
        this.seq[i],
        this.reason[i],
        this.srcKind[i],
        this.srcId[i],
        this.dstKind[i],
        this.dstId[i],
        this.amount[i]
      );
    }
  }
}

/** Indices into `LedgerState.acc`. */
export const Acc = Object.freeze({
  ABIOTIC_COMMITTED: 0,
  ABIOTIC_STAGED: 1,
  CUM_SUN: 2,
  CUM_HEAT: 3,
  CUM_GENESIS_MASS: 4,
  CUM_GENESIS_ENERGY: 5,
  CUM_EXTERNAL_MASS: 6,
  CUM_EXTERNAL_ENERGY: 7,
  TX_SUN: 8,
  TX_HEAT: 9,
  TX_GENESIS_MASS: 10,
  TX_GENESIS_ENERGY: 11,
  DELTA_MASS_POS: 12,
  DELTA_MASS_NEG: 13,
  DELTA_ENERGY_POS: 14,
  DELTA_ENERGY_NEG: 15,
  LHS: 16,
  RHS: 17,
  AUDIT_MASS: 18,
  AUDIT_ENERGY: 19,
  CHECK_SUN: 20,
  CHECK_HEAT: 21,
  CHECK_GENESIS_MASS: 22,
  CHECK_GENESIS_ENERGY: 23,
} as const);

export const LEDGER_ACCUMULATOR_COUNT = 24;

const ACC_ABIOTIC_COMMITTED = Acc.ABIOTIC_COMMITTED;
const ACC_ABIOTIC_STAGED = Acc.ABIOTIC_STAGED;
const ACC_CUM_SUN = Acc.CUM_SUN;
const ACC_CUM_HEAT = Acc.CUM_HEAT;
const ACC_CUM_GENESIS_MASS = Acc.CUM_GENESIS_MASS;
const ACC_CUM_GENESIS_ENERGY = Acc.CUM_GENESIS_ENERGY;
const ACC_TX_SUN = Acc.TX_SUN;
const ACC_TX_HEAT = Acc.TX_HEAT;
const ACC_TX_GENESIS_MASS = Acc.TX_GENESIS_MASS;
const ACC_TX_GENESIS_ENERGY = Acc.TX_GENESIS_ENERGY;
const ACC_DELTA_MASS_POS = Acc.DELTA_MASS_POS;
const ACC_DELTA_MASS_NEG = Acc.DELTA_MASS_NEG;
const ACC_DELTA_ENERGY_POS = Acc.DELTA_ENERGY_POS;
const ACC_DELTA_ENERGY_NEG = Acc.DELTA_ENERGY_NEG;
const ACC_LHS = Acc.LHS;
const ACC_RHS = Acc.RHS;
const ACC_CHECK_SUN = Acc.CHECK_SUN;
const ACC_CHECK_HEAT = Acc.CHECK_HEAT;
const ACC_CHECK_GENESIS_MASS = Acc.CHECK_GENESIS_MASS;
const ACC_CHECK_GENESIS_ENERGY = Acc.CHECK_GENESIS_ENERGY;

/**
 * Shared mutable state of one ledger. Owned by `EnergyLedger`; `EnergyTransaction` operates on
 * it directly. Not part of the public API.
 */
export class LedgerState {
  readonly stores: StagedStore[] = [];
  readonly storeByKind: Array<StagedStore | null> = new Array<StagedStore | null>(ACCOUNT_KIND_COUNT).fill(null);
  readonly acc = new ExactAccumulators(LEDGER_ACCUMULATOR_COUNT);
  readonly escrowSlots: number;
  readonly escrowCommittedMass: ExactAccumulators;
  readonly escrowCommittedEnergy: ExactAccumulators;
  readonly escrowStagedMass: ExactAccumulators;
  readonly escrowStagedEnergy: ExactAccumulators;
  readonly reasonTxMass = new ExactAccumulators(PR_COUNT);
  readonly reasonTxEnergy = new ExactAccumulators(PR_COUNT);
  readonly reasonCumMass = new ExactAccumulators(PR_COUNT);
  readonly reasonCumEnergy = new ExactAccumulators(PR_COUNT);
  readonly massBuffer: PostingBuffer;
  readonly energyBuffer: PostingBuffer;
  readonly massJournal: PostingJournal | null;
  readonly energyJournal: PostingJournal | null;
  readonly strictStoichiometry: boolean;

  active: EnergyTransaction | null = null;
  poisoned: unknown = null;
  nextTxId = 1;
  committedTxCount = 0;
  abortedTxCount = 0;
  lastCommittedTick = -1;
  lastCommittedTxId = 0;

  constructor(
    escrowSlots: number,
    postingCapacity: number,
    journalCapacity: number,
    strictStoichiometry = false
  ) {
    this.escrowSlots = escrowSlots;
    this.escrowCommittedMass = new ExactAccumulators(escrowSlots);
    this.escrowCommittedEnergy = new ExactAccumulators(escrowSlots);
    this.escrowStagedMass = new ExactAccumulators(escrowSlots);
    this.escrowStagedEnergy = new ExactAccumulators(escrowSlots);
    this.massBuffer = new PostingBuffer(postingCapacity);
    this.energyBuffer = new PostingBuffer(postingCapacity);
    this.massJournal = journalCapacity > 0 ? new PostingJournal(journalCapacity) : null;
    this.energyJournal = journalCapacity > 0 ? new PostingJournal(journalCapacity) : null;
    this.strictStoichiometry = strictStoichiometry;
  }
}

function assertAccountId(id: number, label: string): void {
  if ((id >>> 0) !== id) {
    throw new EnergyRuleError(`${label} must be an integer in [0, 2^32 - 1], received: ${id}`);
  }
}

export class EnergyTransaction {
  public readonly id: number;
  public readonly tick: number;
  /** Genesis transactions may draw mass and energy from the GENESIS source (world setup). */
  public readonly genesis: boolean;
  private stateValue: EnergyTransactionState = 'ACTIVE';
  private readonly ledger: LedgerState;

  /** @internal Use `EnergyLedger.begin()`. */
  constructor(ledger: LedgerState, id: number, tick: number, genesis: boolean) {
    this.ledger = ledger;
    this.id = id;
    this.tick = tick;
    this.genesis = genesis;
  }

  get state(): EnergyTransactionState {
    return this.stateValue;
  }

  get massPostingCount(): number {
    return this.stateValue === 'ACTIVE' || this.stateValue === 'PREPARED' ? this.ledger.massBuffer.count : 0;
  }

  get energyPostingCount(): number {
    return this.stateValue === 'ACTIVE' || this.stateValue === 'PREPARED' ? this.ledger.energyBuffer.count : 0;
  }

  private requireActive(operation: string): void {
    if (this.stateValue !== 'ACTIVE') {
      throw new EnergyTransactionStateError(
        `Cannot ${operation}: transaction ${this.id} is ${this.stateValue}, expected ACTIVE`
      );
    }
    if (this.ledger.active !== this) {
      throw new EnergyTransactionStateError(`Transaction ${this.id} is not the ledger's open transaction`);
    }
  }

  private storeFor(kind: AccountKindId): StagedStore {
    const store = this.ledger.storeByKind[kind];
    if (!store) {
      throw new EnergyRuleError(`No store is registered for account kind ${ACCOUNT_KIND_NAMES[kind]}`);
    }
    return store;
  }

  private static assertSingleton(kind: AccountKindId, id: number): void {
    if (id !== 0) {
      throw new EnergyRuleError(`${ACCOUNT_KIND_NAMES[kind]} is a single global account; id must be 0, received: ${id}`);
    }
  }

  private assertEscrowSlot(slot: number): void {
    if (slot >= this.ledger.escrowSlots) {
      throw new EnergyRuleError(`Escrow slot out of range [0, ${this.ledger.escrowSlots}): ${slot}`);
    }
  }

  /**
   * Stages a mass movement of `massQ` quanta from one account to another.
   * Validates everything first; on any error nothing is staged and the transaction stays ACTIVE.
   * Zero-amount postings are ignored.
   */
  postMass(
    reason: PostingReasonId,
    srcKind: AccountKindId,
    srcId: number,
    dstKind: AccountKindId,
    dstId: number,
    massQ: number
  ): void {
    const L = this.ledger;
    if (this.stateValue !== 'ACTIVE' || L.active !== this) {
      this.requireActive('post mass');
    }
    if (!(massQ >= 0 && massQ <= LOCAL_MAX_SAFE_INT && Math.floor(massQ) === massQ)) {
      throw new UnitsError(`massQ must be a non-negative safe integer quantum count, received: ${massQ}`);
    }
    if (
      ((reason | srcKind | dstKind) >>> 4) !== 0 ||
      LOCAL_MASS_ROUTE_LUT[(reason << 8) | (srcKind << 4) | dstKind] !== 1
    ) {
      throw new EnergyRuleError(`Mass posting rejected: ${checkMassRoute(reason, srcKind, dstKind)}`);
    }
    if ((srcId >>> 0) !== srcId) assertAccountId(srcId, 'srcId');
    if ((dstId >>> 0) !== dstId) assertAccountId(dstId, 'dstId');
    if (srcKind === dstKind && srcId === dstId) {
      throw new EnergyRuleError('Mass posting rejected: source and destination are the same account');
    }
    let srcStore: StagedStore | null = null;
    let dstStore: StagedStore | null = null;

    // --- validate source ---
    if (srcKind === AK_GENESIS) {
      if (!this.genesis) {
        throw new EnergyRuleError('Mass posting rejected: GENESIS is only available to genesis transactions');
      }
      if (srcId !== 0) EnergyTransaction.assertSingleton(srcKind, srcId);
    } else if (srcKind === AK_ABIOTIC) {
      if (srcId !== 0) EnergyTransaction.assertSingleton(srcKind, srcId);
      if (!L.acc.gte(ACC_ABIOTIC_STAGED, massQ)) {
        throw new InsufficientBalanceError(
          `ABIOTIC pool holds ${L.acc.toBigInt(ACC_ABIOTIC_STAGED)} quanta, cannot debit ${massQ}`
        );
      }
    } else if (srcKind === AK_ESCROW) {
      this.assertEscrowSlot(srcId);
      if (!L.escrowStagedMass.gte(srcId, massQ)) {
        throw new InsufficientBalanceError(`ESCROW[${srcId}] mass cannot cover ${massQ} quanta`);
      }
    } else {
      srcStore = L.storeByKind[srcKind] ?? this.storeFor(srcKind);
      srcStore.checkDebit(srcKind, srcId, false, massQ);
    }
    // --- validate destination ---
    if (dstKind === AK_ABIOTIC) {
      if (dstId !== 0) EnergyTransaction.assertSingleton(dstKind, dstId);
    } else {
      dstStore = L.storeByKind[dstKind] ?? this.storeFor(dstKind);
      dstStore.checkCredit(dstKind, dstId, false, massQ);
    }
    if (massQ === 0) return;
    L.massBuffer.ensureRoom();

    // --- apply (cannot fail) ---
    if (srcKind === AK_GENESIS) L.acc.addFast(ACC_TX_GENESIS_MASS, massQ);
    else if (srcKind === AK_ABIOTIC) L.acc.sub(ACC_ABIOTIC_STAGED, massQ);
    else if (srcKind === AK_ESCROW) L.escrowStagedMass.sub(srcId, massQ);
    else (srcStore as StagedStore).applyDebit(srcKind, srcId, false, massQ);

    if (dstKind === AK_ABIOTIC) L.acc.addFast(ACC_ABIOTIC_STAGED, massQ);
    else (dstStore as StagedStore).applyCredit(dstKind, dstId, false, massQ);

    L.massBuffer.push(reason, srcKind, srcId, dstKind, dstId, massQ);
    L.reasonTxMass.addFast(reason, massQ);
  }

  /**
   * Stages an energy movement of `energyQ` quanta from one account to another.
   * Validates everything first; on any error nothing is staged and the transaction stays ACTIVE.
   * Zero-amount postings are ignored.
   */
  postEnergy(
    reason: PostingReasonId,
    srcKind: AccountKindId,
    srcId: number,
    dstKind: AccountKindId,
    dstId: number,
    energyQ: number
  ): void {
    const L = this.ledger;
    if (this.stateValue !== 'ACTIVE' || L.active !== this) {
      this.requireActive('post energy');
    }
    if (!(energyQ >= 0 && energyQ <= LOCAL_MAX_SAFE_INT && Math.floor(energyQ) === energyQ)) {
      throw new UnitsError(`energyQ must be a non-negative safe integer quantum count, received: ${energyQ}`);
    }
    if (
      ((reason | srcKind | dstKind) >>> 4) !== 0 ||
      LOCAL_ENERGY_ROUTE_LUT[(reason << 8) | (srcKind << 4) | dstKind] !== 1
    ) {
      throw new EnergyRuleError(`Energy posting rejected: ${checkEnergyRoute(reason, srcKind, dstKind)}`);
    }
    if ((srcId >>> 0) !== srcId) assertAccountId(srcId, 'srcId');
    if ((dstId >>> 0) !== dstId) assertAccountId(dstId, 'dstId');
    if (srcKind === dstKind && srcId === dstId) {
      throw new EnergyRuleError('Energy posting rejected: source and destination are the same account');
    }
    let srcStore: StagedStore | null = null;
    let dstStore: StagedStore | null = null;

    if (srcKind === AK_GENESIS) {
      if (!this.genesis) {
        throw new EnergyRuleError('Energy posting rejected: GENESIS is only available to genesis transactions');
      }
      if (srcId !== 0) EnergyTransaction.assertSingleton(srcKind, srcId);
    } else if (srcKind === AK_SUN) {
      if (srcId !== 0) EnergyTransaction.assertSingleton(srcKind, srcId);
    } else if (srcKind === AK_ESCROW) {
      this.assertEscrowSlot(srcId);
      if (!L.escrowStagedEnergy.gte(srcId, energyQ)) {
        throw new InsufficientBalanceError(`ESCROW[${srcId}] energy cannot cover ${energyQ} quanta`);
      }
    } else {
      srcStore = L.storeByKind[srcKind] ?? this.storeFor(srcKind);
      srcStore.checkDebit(srcKind, srcId, true, energyQ);
    }
    if (dstKind === AK_HEAT) {
      if (dstId !== 0) EnergyTransaction.assertSingleton(dstKind, dstId);
    } else {
      dstStore = L.storeByKind[dstKind] ?? this.storeFor(dstKind);
      dstStore.checkCredit(dstKind, dstId, true, energyQ);
    }
    if (energyQ === 0) return;
    L.energyBuffer.ensureRoom();

    if (srcKind === AK_GENESIS) L.acc.addFast(ACC_TX_GENESIS_ENERGY, energyQ);
    else if (srcKind === AK_SUN) L.acc.addFast(ACC_TX_SUN, energyQ);
    else if (srcKind === AK_ESCROW) L.escrowStagedEnergy.sub(srcId, energyQ);
    else (srcStore as StagedStore).applyDebit(srcKind, srcId, true, energyQ);

    if (dstKind === AK_HEAT) L.acc.addFast(ACC_TX_HEAT, energyQ);
    else (dstStore as StagedStore).applyCredit(dstKind, dstId, true, energyQ);

    L.energyBuffer.push(reason, srcKind, srcId, dstKind, dstId, energyQ);
    L.reasonTxEnergy.addFast(reason, energyQ);
  }

  /**
   * Stages a biomass transfer: the same route carries `massQ` and the chemical energy `energyQ`
   * it contains. Both legs AND buffer capacity are validated/reserved before either leg mutates
   * anything, so any failure (including buffer growth OOM) leaves zero staged side effects.
   */
  transferBiomass(
    reason: PostingReasonId,
    srcKind: AccountKindId,
    srcId: number,
    dstKind: AccountKindId,
    dstId: number,
    massQ: number,
    energyQ: number
  ): void {
    const L = this.ledger;
    if (this.stateValue !== 'ACTIVE' || L.active !== this) {
      this.requireActive('transfer biomass');
    }
    if (!(massQ >= 0 && massQ <= LOCAL_MAX_SAFE_INT && Math.floor(massQ) === massQ)) {
      throw new UnitsError(`massQ must be a non-negative safe integer quantum count, received: ${massQ}`);
    }
    if (!(energyQ >= 0 && energyQ <= LOCAL_MAX_SAFE_INT && Math.floor(energyQ) === energyQ)) {
      throw new UnitsError(`energyQ must be a non-negative safe integer quantum count, received: ${energyQ}`);
    }
    if (
      ((reason | srcKind | dstKind) >>> 4) !== 0 ||
      LOCAL_MASS_ROUTE_LUT[(reason << 8) | (srcKind << 4) | dstKind] !== 1
    ) {
      throw new EnergyRuleError(`Mass posting rejected: ${checkMassRoute(reason, srcKind, dstKind)}`);
    }
    if (LOCAL_ENERGY_ROUTE_LUT[(reason << 8) | (srcKind << 4) | dstKind] !== 1) {
      throw new EnergyRuleError(`Energy posting rejected: ${checkEnergyRoute(reason, srcKind, dstKind)}`);
    }
    if ((srcId >>> 0) !== srcId) assertAccountId(srcId, 'srcId');
    if ((dstId >>> 0) !== dstId) assertAccountId(dstId, 'dstId');
    if (srcKind === dstKind && srcId === dstId) {
      throw new EnergyRuleError('Biomass transfer rejected: source and destination are the same account');
    }

    let srcStore: StagedStore | null = null;
    let dstStore: StagedStore | null = null;

    // --- Validate source for both mass and energy legs ---
    if (srcKind === AK_GENESIS) {
      if (!this.genesis) {
        throw new EnergyRuleError('Biomass transfer rejected: GENESIS is only available to genesis transactions');
      }
      if (srcId !== 0) EnergyTransaction.assertSingleton(srcKind, srcId);
    } else if (srcKind === AK_ESCROW) {
      this.assertEscrowSlot(srcId);
      if (!L.escrowStagedMass.gte(srcId, massQ)) {
        throw new InsufficientBalanceError(`ESCROW[${srcId}] mass cannot cover ${massQ} quanta`);
      }
      if (!L.escrowStagedEnergy.gte(srcId, energyQ)) {
        throw new InsufficientBalanceError(`ESCROW[${srcId}] energy cannot cover ${energyQ} quanta`);
      }
    } else {
      srcStore = L.storeByKind[srcKind] ?? this.storeFor(srcKind);
      srcStore.checkDebit(srcKind, srcId, false, massQ);
      srcStore.checkDebit(srcKind, srcId, true, energyQ);
    }

    // --- Validate destination for both mass and energy legs ---
    dstStore = L.storeByKind[dstKind] ?? this.storeFor(dstKind);
    dstStore.checkCredit(dstKind, dstId, false, massQ);
    dstStore.checkCredit(dstKind, dstId, true, energyQ);

    // --- Pre-reserve BOTH posting buffers before any state mutation ---
    if (massQ > 0) L.massBuffer.ensureRoom();
    if (energyQ > 0) L.energyBuffer.ensureRoom();

    // --- Apply atomically (cannot fail) ---
    if (massQ > 0) {
      if (srcKind === AK_GENESIS) L.acc.addFast(ACC_TX_GENESIS_MASS, massQ);
      else if (srcKind === AK_ESCROW) L.escrowStagedMass.sub(srcId, massQ);
      else (srcStore as StagedStore).applyDebit(srcKind, srcId, false, massQ);

      dstStore.applyCredit(dstKind, dstId, false, massQ);
      L.massBuffer.push(reason, srcKind, srcId, dstKind, dstId, massQ);
      L.reasonTxMass.addFast(reason, massQ);
    }

    if (energyQ > 0) {
      if (srcKind === AK_GENESIS) L.acc.addFast(ACC_TX_GENESIS_ENERGY, energyQ);
      else if (srcKind === AK_ESCROW) L.escrowStagedEnergy.sub(srcId, energyQ);
      else (srcStore as StagedStore).applyDebit(srcKind, srcId, true, energyQ);

      dstStore.applyCredit(dstKind, dstId, true, energyQ);
      L.energyBuffer.push(reason, srcKind, srcId, dstKind, dstId, energyQ);
      L.reasonTxEnergy.addFast(reason, energyQ);
    }
  }

  /** Fast non-allocating read of staged ABIOTIC mass as safe number (clamped to MAX_SAFE_INT if > 2^53-1). */
  stagedAbioticMassQFast(): number {
    this.requireOpen('read staged balance');
    return this.ledger.acc.toSafeInt(ACC_ABIOTIC_STAGED) ?? Number.MAX_SAFE_INTEGER;
  }

  /** Staged (in-transaction) mass balance of a store-backed, ABIOTIC or ESCROW account. */
  stagedMassQ(kind: AccountKindId, id: number): number | bigint {
    this.requireOpen('read staged balance');
    if (kind === AK_ABIOTIC) return this.ledger.acc.toBigInt(ACC_ABIOTIC_STAGED);
    if (kind === AK_ESCROW) return this.ledger.escrowStagedMass.toBigInt(id);
    return this.storeFor(kind).stagedBalance(kind, id, false);
  }

  /** Staged (in-transaction) energy balance of a store-backed or ESCROW account. */
  stagedEnergyQ(kind: AccountKindId, id: number): number | bigint {
    this.requireOpen('read staged balance');
    if (kind === AK_ESCROW) return this.ledger.escrowStagedEnergy.toBigInt(id);
    return this.storeFor(kind).stagedBalance(kind, id, true);
  }

  private requireOpen(operation: string): void {
    if ((this.stateValue !== 'ACTIVE' && this.stateValue !== 'PREPARED') || this.ledger.active !== this) {
      throw new EnergyTransactionStateError(
        `Cannot ${operation}: transaction ${this.id} is ${this.stateValue}`
      );
    }
  }

  /** Postings staged so far (allocating read model for tests and diagnostics). */
  getMassPostings(): MassPosting[] {
    this.requireOpen('read postings');
    const b = this.ledger.massBuffer;
    const out: MassPosting[] = [];
    for (let i = 0; i < b.count; i++) {
      out.push(
        Object.freeze({
          txId: this.id,
          tick: this.tick,
          seq: i,
          reason: b.reason[i] as PostingReasonId,
          srcKind: b.srcKind[i] as AccountKindId,
          srcId: b.srcId[i],
          dstKind: b.dstKind[i] as AccountKindId,
          dstId: b.dstId[i],
          massQ: b.amount[i],
        })
      );
    }
    return out;
  }

  getEnergyPostings(): EnergyPosting[] {
    this.requireOpen('read postings');
    const b = this.ledger.energyBuffer;
    const out: EnergyPosting[] = [];
    for (let i = 0; i < b.count; i++) {
      out.push(
        Object.freeze({
          txId: this.id,
          tick: this.tick,
          seq: i,
          reason: b.reason[i] as PostingReasonId,
          srcKind: b.srcKind[i] as AccountKindId,
          srcId: b.srcId[i],
          dstKind: b.dstKind[i] as AccountKindId,
          dstId: b.dstId[i],
          energyQ: b.amount[i],
        })
      );
    }
    return out;
  }

  /**
   * PREPARE: independently verifies the staged result against Revision 3 invariants I1-I4 and
   * seals the transaction:
   *   I1  mass:   delta(stores) + delta(ABIOTIC) + delta(ESCROW) == GENESIS inflow;
   *   I2  energy: delta(stores) + delta(ESCROW) == SUN + GENESIS inflow - HEAT outflow;
   *   I3  every staged stock value is a non-negative safe integer;
   *   I4  every posting respects source/sink directionality (re-checked from the buffer), the
   *       external-flow totals recomputed from the buffer match running totals, and (when
   *       `strictStoichiometry` is enabled) all dirty store slots satisfy 3 / 3 / 5 / 30 EU/MU.
   * The deltas are recomputed from the buffers themselves, not from the postings, so a store
   * bug or an out-of-band write to a staging buffer is detected here.
   * On failure the transaction is aborted (committed state untouched) and the error rethrown.
   */
  prepare(): void {
    this.requireActive('prepare');
    try {
      this.verifyStaged();
    } catch (error) {
      this.rollback();
      throw error;
    }
    this.stateValue = 'PREPARED';
  }

  private verifyStaged(): void {
    const L = this.ledger;
    const acc = L.acc;
    for (let s = 0; s < L.stores.length; s++) {
      L.stores[s].validateStaged();
    }
    if (L.strictStoichiometry) {
      for (let s = 0; s < L.stores.length; s++) {
        const validateStoich = L.stores[s].validateStagedStoichiometry;
        if (validateStoich) {
          try {
            validateStoich.call(L.stores[s]);
          } catch (error) {
            throw new EnergyInvariantError(
              'I4',
              error instanceof Error ? error.message : String(error)
            );
          }
        }
      }
    }

    // I4: re-derive external flows from the posting buffers.
    acc.reset(ACC_CHECK_SUN);
    acc.reset(ACC_CHECK_HEAT);
    acc.reset(ACC_CHECK_GENESIS_MASS);
    acc.reset(ACC_CHECK_GENESIS_ENERGY);
    const mb = L.massBuffer;
    const mbReason = mb.reason;
    const mbSrcKind = mb.srcKind;
    const mbDstKind = mb.dstKind;
    const mbAmount = mb.amount;
    const mbCount = mb.count;
    for (let i = 0; i < mbCount; i++) {
      const r = mbReason[i];
      const sk = mbSrcKind[i];
      const dk = mbDstKind[i];
      if (((r | sk | dk) >>> 4) !== 0 || LOCAL_MASS_ROUTE_LUT[(r << 8) | (sk << 4) | dk] !== 1) {
        throw new EnergyInvariantError('I4', `mass posting #${i}: ${checkMassRoute(r, sk, dk)}`);
      }
      if (sk === AK_GENESIS) {
        if (!this.genesis) throw new EnergyInvariantError('I4', `mass posting #${i} draws from GENESIS`);
        acc.addFast(ACC_CHECK_GENESIS_MASS, mbAmount[i]);
      }
    }
    const eb = L.energyBuffer;
    const ebReason = eb.reason;
    const ebSrcKind = eb.srcKind;
    const ebDstKind = eb.dstKind;
    const ebAmount = eb.amount;
    const ebCount = eb.count;
    for (let i = 0; i < ebCount; i++) {
      const r = ebReason[i];
      const sk = ebSrcKind[i];
      const dk = ebDstKind[i];
      if (((r | sk | dk) >>> 4) !== 0 || LOCAL_ENERGY_ROUTE_LUT[(r << 8) | (sk << 4) | dk] !== 1) {
        throw new EnergyInvariantError('I4', `energy posting #${i}: ${checkEnergyRoute(r, sk, dk)}`);
      }
      if (sk === AK_GENESIS) {
        if (!this.genesis) throw new EnergyInvariantError('I4', `energy posting #${i} draws from GENESIS`);
        acc.addFast(ACC_CHECK_GENESIS_ENERGY, ebAmount[i]);
      } else if (sk === AK_SUN) {
        acc.addFast(ACC_CHECK_SUN, ebAmount[i]);
      }
      if (dk === AK_HEAT) acc.addFast(ACC_CHECK_HEAT, ebAmount[i]);
    }
    if (
      !acc.equalsAt(ACC_CHECK_SUN, acc, ACC_TX_SUN) ||
      !acc.equalsAt(ACC_CHECK_HEAT, acc, ACC_TX_HEAT) ||
      !acc.equalsAt(ACC_CHECK_GENESIS_MASS, acc, ACC_TX_GENESIS_MASS) ||
      !acc.equalsAt(ACC_CHECK_GENESIS_ENERGY, acc, ACC_TX_GENESIS_ENERGY)
    ) {
      throw new EnergyInvariantError('I4', 'external flow totals do not match the posting buffers');
    }

    // Independent stock deltas straight from the staging buffers.
    acc.reset(ACC_DELTA_MASS_POS);
    acc.reset(ACC_DELTA_MASS_NEG);
    acc.reset(ACC_DELTA_ENERGY_POS);
    acc.reset(ACC_DELTA_ENERGY_NEG);
    for (let s = 0; s < L.stores.length; s++) {
      L.stores[s].accumulateStagedDelta(
        acc,
        ACC_DELTA_MASS_POS,
        ACC_DELTA_MASS_NEG,
        ACC_DELTA_ENERGY_POS,
        ACC_DELTA_ENERGY_NEG
      );
    }

    // I1 (mass): gains + staged ABIOTIC + staged ESCROW == losses + committed ABIOTIC + committed ESCROW + GENESIS
    acc.copyFrom(ACC_LHS, acc, ACC_DELTA_MASS_POS);
    acc.addFrom(ACC_LHS, acc, ACC_ABIOTIC_STAGED);
    acc.copyFrom(ACC_RHS, acc, ACC_DELTA_MASS_NEG);
    acc.addFrom(ACC_RHS, acc, ACC_ABIOTIC_COMMITTED);
    acc.addFrom(ACC_RHS, acc, ACC_TX_GENESIS_MASS);
    for (let slot = 0; slot < L.escrowSlots; slot++) {
      acc.addFrom(ACC_LHS, L.escrowStagedMass, slot);
      acc.addFrom(ACC_RHS, L.escrowCommittedMass, slot);
    }
    if (!acc.equalsAt(ACC_LHS, acc, ACC_RHS)) {
      throw new EnergyInvariantError(
        'I1',
        `mass is not conserved: residual ${acc.toBigInt(ACC_LHS) - acc.toBigInt(ACC_RHS)} quanta`
      );
    }

    // I2 (energy): gains + staged ESCROW + HEAT == losses + committed ESCROW + SUN + GENESIS
    acc.copyFrom(ACC_LHS, acc, ACC_DELTA_ENERGY_POS);
    acc.addFrom(ACC_LHS, acc, ACC_TX_HEAT);
    acc.copyFrom(ACC_RHS, acc, ACC_DELTA_ENERGY_NEG);
    acc.addFrom(ACC_RHS, acc, ACC_TX_SUN);
    acc.addFrom(ACC_RHS, acc, ACC_TX_GENESIS_ENERGY);
    for (let slot = 0; slot < L.escrowSlots; slot++) {
      acc.addFrom(ACC_LHS, L.escrowStagedEnergy, slot);
      acc.addFrom(ACC_RHS, L.escrowCommittedEnergy, slot);
    }
    if (!acc.equalsAt(ACC_LHS, acc, ACC_RHS)) {
      throw new EnergyInvariantError(
        'I2',
        `energy is not conserved: residual ${acc.toBigInt(ACC_LHS) - acc.toBigInt(ACC_RHS)} quanta`
      );
    }
  }

  /**
   * COMMIT: atomically publishes the prepared result. Throws `EnergyTransactionStateError`
   * WITHOUT changing anything unless the transaction is PREPARED (this is what rejects a second
   * commit). The body performs no allocation and calls no code outside the engine stores.
   */
  commit(): void {
    if (this.stateValue !== 'PREPARED') {
      throw new EnergyTransactionStateError(
        `Cannot commit: transaction ${this.id} is ${this.stateValue}, expected PREPARED`
      );
    }
    const L = this.ledger;
    if (L.active !== this) {
      throw new EnergyTransactionStateError(`Transaction ${this.id} is not the ledger's open transaction`);
    }
    try {
      const version = L.committedTxCount + 1;
      const stores = L.stores;
      for (let s = 0; s < stores.length; s++) {
        stores[s].commitStaged(version);
      }
      const acc = L.acc;
      acc.copyFrom(ACC_ABIOTIC_COMMITTED, acc, ACC_ABIOTIC_STAGED);
      for (let slot = 0; slot < L.escrowSlots; slot++) {
        L.escrowCommittedMass.copyFrom(slot, L.escrowStagedMass, slot);
        L.escrowCommittedEnergy.copyFrom(slot, L.escrowStagedEnergy, slot);
      }
      acc.addFrom(ACC_CUM_SUN, acc, ACC_TX_SUN);
      acc.addFrom(ACC_CUM_HEAT, acc, ACC_TX_HEAT);
      acc.addFrom(ACC_CUM_GENESIS_MASS, acc, ACC_TX_GENESIS_MASS);
      acc.addFrom(ACC_CUM_GENESIS_ENERGY, acc, ACC_TX_GENESIS_ENERGY);
      for (let r = 0; r < PR_COUNT; r++) {
        L.reasonCumMass.addFrom(r, L.reasonTxMass, r);
        L.reasonCumEnergy.addFrom(r, L.reasonTxEnergy, r);
      }
      if (L.massJournal !== null) L.massJournal.appendAll(L.massBuffer, this.tick, this.id);
      if (L.energyJournal !== null) L.energyJournal.appendAll(L.energyBuffer, this.tick, this.id);
      L.committedTxCount = version;
      L.lastCommittedTick = this.tick;
      L.lastCommittedTxId = this.id;
      L.active = null;
      this.stateValue = 'COMMITTED';
    } catch (error) {
      // Unreachable by contract. If a store violates the no-throw contract the ledger can no
      // longer vouch for its state and refuses all further work.
      L.poisoned = error;
      throw error;
    }
  }

  /**
   * ABORT: discards everything staged by this transaction. Legal while ACTIVE or PREPARED,
   * idempotent once ABORTED, and an error after COMMIT.
   */
  abort(): void {
    if (this.stateValue === 'ABORTED') return;
    if (this.stateValue === 'COMMITTED') {
      throw new EnergyTransactionStateError(`Cannot abort: transaction ${this.id} is already COMMITTED`);
    }
    this.rollback();
  }

  private rollback(): void {
    const L = this.ledger;
    for (let s = 0; s < L.stores.length; s++) {
      L.stores[s].abortStaged();
    }
    L.acc.copyFrom(ACC_ABIOTIC_STAGED, L.acc, ACC_ABIOTIC_COMMITTED);
    for (let slot = 0; slot < L.escrowSlots; slot++) {
      L.escrowStagedMass.copyFrom(slot, L.escrowCommittedMass, slot);
      L.escrowStagedEnergy.copyFrom(slot, L.escrowCommittedEnergy, slot);
    }
    L.acc.reset(ACC_TX_SUN);
    L.acc.reset(ACC_TX_HEAT);
    L.acc.reset(ACC_TX_GENESIS_MASS);
    L.acc.reset(ACC_TX_GENESIS_ENERGY);
    L.reasonTxMass.resetAll();
    L.reasonTxEnergy.resetAll();
    L.massBuffer.count = 0;
    L.energyBuffer.count = 0;
    L.abortedTxCount++;
    if (L.active === this) L.active = null;
    this.stateValue = 'ABORTED';
  }
}

export { InsufficientBalanceError, UnitsError };
