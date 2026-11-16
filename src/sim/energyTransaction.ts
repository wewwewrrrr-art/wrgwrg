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
  PostingReason,
  PostingReasonId,
  checkEnergyRoute,
  checkMassRoute,
  isEnergyRouteAllowedFast,
  isMassRouteAllowedFast,
} from './energyAccounts';
import { InsufficientBalanceError, StagedChannelStore, StagedStore } from './stagedStore';
import { ExactAccumulators, UnitsError } from './units';

const AK_SUN = AccountKind.SUN;
const AK_HEAT = AccountKind.HEAT;
const AK_GENESIS = AccountKind.GENESIS;
const AK_ABIOTIC = AccountKind.ABIOTIC;
const AK_ESCROW = AccountKind.ESCROW;
const AK_CELL_PLANT = AccountKind.CELL_PLANT;
const AK_CELL_CARRION = AccountKind.CELL_CARRION;
const AK_CELL_DETRITUS = AccountKind.CELL_DETRITUS;
const AK_ORGANISM_STRUCT = AccountKind.ORGANISM_STRUCT;
const AK_ORGANISM_RESERVE = AccountKind.ORGANISM_RESERVE;
const PR_INGESTION = PostingReason.INGESTION;
const PR_EGESTION = PostingReason.EGESTION;
const PR_SDA = PostingReason.SDA;
const PR_GROWTH = PostingReason.GROWTH;
const PR_REPRODUCTION = PostingReason.REPRODUCTION;
const PR_DEATH = PostingReason.DEATH;
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

  /** Guarantees room for `extra` more postings. May allocate; only called while ACTIVE. */
  ensureRoom(extra = 1): void {
    const needed = this.count + extra;
    if (needed <= this.capacity) return;
    let next = this.capacity * 2;
    while (next < needed) next *= 2;
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
  readonly fastStoreByKind: Array<StagedChannelStore | null> = new Array<StagedChannelStore | null>(ACCOUNT_KIND_COUNT).fill(null);
  readonly fastChannelBaseByKind = new Int8Array(ACCOUNT_KIND_COUNT).fill(-1);
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

    const fastSrc = L.fastStoreByKind[srcKind];
    const fastDst = L.fastStoreByKind[dstKind];
    let srcStore: StagedStore | null = null;
    let dstStore: StagedStore | null = null;
    let srcBack: Float64Array | null = null;
    let dstBack: Float64Array | null = null;

    // --- validate source ---
    if (fastSrc !== null) {
      const ch = L.fastChannelBaseByKind[srcKind];
      srcBack = fastSrc.back[ch];
      if (srcId >= srcBack.length || srcBack[srcId] < massQ) {
        fastSrc.checkDebit(ch, srcId, massQ, ACCOUNT_KIND_NAMES[srcKind]);
      }
    } else if (srcKind === AK_GENESIS) {
      if (!this.genesis) {
        throw new EnergyRuleError('Mass posting rejected: GENESIS is only available to genesis transactions');
      }
      if (srcId !== 0) EnergyTransaction.assertSingleton(srcKind, srcId);
    } else if (srcKind === AK_ABIOTIC) {
      if (srcId !== 0) EnergyTransaction.assertSingleton(srcKind, srcId);
      if (!L.acc.gteFast(ACC_ABIOTIC_STAGED, massQ)) {
        throw new InsufficientBalanceError(
          `ABIOTIC pool holds ${L.acc.toBigInt(ACC_ABIOTIC_STAGED)} quanta, cannot debit ${massQ}`
        );
      }
    } else if (srcKind === AK_ESCROW) {
      this.assertEscrowSlot(srcId);
      if (!L.escrowStagedMass.gteFast(srcId, massQ)) {
        throw new InsufficientBalanceError(`ESCROW[${srcId}] mass cannot cover ${massQ} quanta`);
      }
    } else {
      srcStore = L.storeByKind[srcKind] ?? this.storeFor(srcKind);
      srcStore.checkDebit(srcKind, srcId, false, massQ);
    }

    // --- validate destination ---
    if (fastDst !== null) {
      const ch = L.fastChannelBaseByKind[dstKind];
      dstBack = fastDst.back[ch];
      if (dstId >= dstBack.length || dstBack[dstId] + massQ > LOCAL_MAX_SAFE_INT) {
        fastDst.checkCredit(ch, dstId, massQ, ACCOUNT_KIND_NAMES[dstKind]);
      }
    } else if (dstKind === AK_ABIOTIC) {
      if (dstId !== 0) EnergyTransaction.assertSingleton(dstKind, dstId);
    } else {
      dstStore = L.storeByKind[dstKind] ?? this.storeFor(dstKind);
      dstStore.checkCredit(dstKind, dstId, false, massQ);
    }

    if (massQ === 0) return;
    const mb = L.massBuffer;
    if (mb.count >= mb.reason.length) mb.ensureRoom();

    // --- apply (cannot fail) ---
    if (fastSrc !== null) {
      if (fastSrc.dirtyFlag[srcId] === 0) {
        fastSrc.dirtyFlag[srcId] = 1;
        fastSrc.dirtyList[fastSrc.dirtyCountValue++] = srcId;
      }
      (srcBack as Float64Array)[srcId] -= massQ;
    } else if (srcKind === AK_GENESIS) L.acc.addFast(ACC_TX_GENESIS_MASS, massQ);
    else if (srcKind === AK_ABIOTIC) L.acc.subFast(ACC_ABIOTIC_STAGED, massQ);
    else if (srcKind === AK_ESCROW) L.escrowStagedMass.subFast(srcId, massQ);
    else (srcStore as StagedStore).applyDebit(srcKind, srcId, false, massQ);

    if (fastDst !== null) {
      if (fastDst.dirtyFlag[dstId] === 0) {
        fastDst.dirtyFlag[dstId] = 1;
        fastDst.dirtyList[fastDst.dirtyCountValue++] = dstId;
      }
      (dstBack as Float64Array)[dstId] += massQ;
    } else if (dstKind === AK_ABIOTIC) L.acc.addFast(ACC_ABIOTIC_STAGED, massQ);
    else (dstStore as StagedStore).applyCredit(dstKind, dstId, false, massQ);

    const idx = mb.count++;
    mb.reason[idx] = reason;
    mb.srcKind[idx] = srcKind;
    mb.dstKind[idx] = dstKind;
    mb.srcId[idx] = srcId;
    mb.dstId[idx] = dstId;
    mb.amount[idx] = massQ;
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

    const fastSrc = L.fastStoreByKind[srcKind];
    const fastDst = L.fastStoreByKind[dstKind];
    let srcStore: StagedStore | null = null;
    let dstStore: StagedStore | null = null;
    let srcBack: Float64Array | null = null;
    let dstBack: Float64Array | null = null;

    if (fastSrc !== null) {
      const ch = L.fastChannelBaseByKind[srcKind] + 1;
      srcBack = fastSrc.back[ch];
      if (srcId >= srcBack.length || srcBack[srcId] < energyQ) {
        fastSrc.checkDebit(ch, srcId, energyQ, ACCOUNT_KIND_NAMES[srcKind]);
      }
    } else if (srcKind === AK_GENESIS) {
      if (!this.genesis) {
        throw new EnergyRuleError('Energy posting rejected: GENESIS is only available to genesis transactions');
      }
      if (srcId !== 0) EnergyTransaction.assertSingleton(srcKind, srcId);
    } else if (srcKind === AK_SUN) {
      if (srcId !== 0) EnergyTransaction.assertSingleton(srcKind, srcId);
    } else if (srcKind === AK_ESCROW) {
      this.assertEscrowSlot(srcId);
      if (!L.escrowStagedEnergy.gteFast(srcId, energyQ)) {
        throw new InsufficientBalanceError(`ESCROW[${srcId}] energy cannot cover ${energyQ} quanta`);
      }
    } else {
      srcStore = L.storeByKind[srcKind] ?? this.storeFor(srcKind);
      srcStore.checkDebit(srcKind, srcId, true, energyQ);
    }

    if (fastDst !== null) {
      const ch = L.fastChannelBaseByKind[dstKind] + 1;
      dstBack = fastDst.back[ch];
      if (dstId >= dstBack.length || dstBack[dstId] + energyQ > LOCAL_MAX_SAFE_INT) {
        fastDst.checkCredit(ch, dstId, energyQ, ACCOUNT_KIND_NAMES[dstKind]);
      }
    } else if (dstKind === AK_HEAT) {
      if (dstId !== 0) EnergyTransaction.assertSingleton(dstKind, dstId);
    } else {
      dstStore = L.storeByKind[dstKind] ?? this.storeFor(dstKind);
      dstStore.checkCredit(dstKind, dstId, true, energyQ);
    }

    if (energyQ === 0) return;
    const eb = L.energyBuffer;
    if (eb.count >= eb.reason.length) eb.ensureRoom();

    if (fastSrc !== null) {
      if (fastSrc.dirtyFlag[srcId] === 0) {
        fastSrc.dirtyFlag[srcId] = 1;
        fastSrc.dirtyList[fastSrc.dirtyCountValue++] = srcId;
      }
      (srcBack as Float64Array)[srcId] -= energyQ;
    } else if (srcKind === AK_GENESIS) L.acc.addFast(ACC_TX_GENESIS_ENERGY, energyQ);
    else if (srcKind === AK_SUN) L.acc.addFast(ACC_TX_SUN, energyQ);
    else if (srcKind === AK_ESCROW) L.escrowStagedEnergy.subFast(srcId, energyQ);
    else (srcStore as StagedStore).applyDebit(srcKind, srcId, true, energyQ);

    if (fastDst !== null) {
      if (fastDst.dirtyFlag[dstId] === 0) {
        fastDst.dirtyFlag[dstId] = 1;
        fastDst.dirtyList[fastDst.dirtyCountValue++] = dstId;
      }
      (dstBack as Float64Array)[dstId] += energyQ;
    } else if (dstKind === AK_HEAT) L.acc.addFast(ACC_TX_HEAT, energyQ);
    else (dstStore as StagedStore).applyCredit(dstKind, dstId, true, energyQ);

    const idx = eb.count++;
    eb.reason[idx] = reason;
    eb.srcKind[idx] = srcKind;
    eb.dstKind[idx] = dstKind;
    eb.srcId[idx] = srcId;
    eb.dstId[idx] = dstId;
    eb.amount[idx] = energyQ;
    L.reasonTxEnergy.addFast(reason, energyQ);
  }

  /**
   * @internal Atomically validates and stages `(srcKind, srcId)` mass -> `ABIOTIC` and energy -> `HEAT`.
   * Produces bit-identical buffer/accumulator state as sequential `postMass` + `postEnergy` with single check/dirty mark.
   */
  postConsumePairFast(
    reason: PostingReasonId,
    srcKind: AccountKindId,
    srcId: number,
    massQ: number,
    energyQ: number
  ): void {
    const L = this.ledger;
    const fastSrc = L.fastStoreByKind[srcKind];
    if (
      fastSrc === null ||
      this.stateValue !== 'ACTIVE' ||
      L.active !== this ||
      massQ <= 0 ||
      energyQ <= 0 ||
      ((reason | srcKind) >>> 4) !== 0 ||
      LOCAL_MASS_ROUTE_LUT[(reason << 8) | (srcKind << 4) | AK_ABIOTIC] !== 1 ||
      LOCAL_ENERGY_ROUTE_LUT[(reason << 8) | (srcKind << 4) | AK_HEAT] !== 1 ||
      (srcId >>> 0) !== srcId ||
      massQ > LOCAL_MAX_SAFE_INT ||
      energyQ > LOCAL_MAX_SAFE_INT ||
      Math.floor(massQ) !== massQ ||
      Math.floor(energyQ) !== energyQ
    ) {
      if (massQ > 0) this.postMass(reason, srcKind, srcId, AK_ABIOTIC, 0, massQ);
      if (energyQ > 0) this.postEnergy(reason, srcKind, srcId, AK_HEAT, 0, energyQ);
      return;
    }

    const ch = L.fastChannelBaseByKind[srcKind];
    const srcBackM = fastSrc.back[ch];
    const srcBackE = fastSrc.back[ch + 1];
    if (srcId >= srcBackM.length || srcBackM[srcId] < massQ) {
      fastSrc.checkDebit(ch, srcId, massQ, ACCOUNT_KIND_NAMES[srcKind]);
    }
    if (srcBackE[srcId] < energyQ) {
      fastSrc.checkDebit(ch + 1, srcId, energyQ, ACCOUNT_KIND_NAMES[srcKind]);
    }

    const mb = L.massBuffer;
    const eb = L.energyBuffer;
    if (mb.count >= mb.reason.length) mb.ensureRoom();
    if (eb.count >= eb.reason.length) eb.ensureRoom();

    if (fastSrc.dirtyFlag[srcId] === 0) {
      fastSrc.dirtyFlag[srcId] = 1;
      fastSrc.dirtyList[fastSrc.dirtyCountValue++] = srcId;
    }
    srcBackM[srcId] -= massQ;
    srcBackE[srcId] -= energyQ;

    const acc = L.acc;
    acc.addFast(ACC_ABIOTIC_STAGED, massQ);
    acc.addFast(ACC_TX_HEAT, energyQ);

    const mi = mb.count++;
    mb.reason[mi] = reason;
    mb.srcKind[mi] = srcKind;
    mb.dstKind[mi] = AK_ABIOTIC;
    mb.srcId[mi] = srcId;
    mb.dstId[mi] = 0;
    mb.amount[mi] = massQ;
    L.reasonTxMass.addFast(reason, massQ);

    const ei = eb.count++;
    eb.reason[ei] = reason;
    eb.srcKind[ei] = srcKind;
    eb.dstKind[ei] = AK_HEAT;
    eb.srcId[ei] = srcId;
    eb.dstId[ei] = 0;
    eb.amount[ei] = energyQ;
    L.reasonTxEnergy.addFast(reason, energyQ);
  }

  /**
   * @internal Atomically validates and stages photosynthesis/assimilation pair:
   * `ABIOTIC -> dstKind[dstId]` (massQ) and `SUN -> dstKind[dstId]` (energyQ).
   */
  postPhotosynthesisPairFast(
    reason: PostingReasonId,
    dstKind: AccountKindId,
    dstId: number,
    massQ: number,
    energyQ: number
  ): void {
    const L = this.ledger;
    const fastDst = L.fastStoreByKind[dstKind];
    if (
      fastDst === null ||
      this.stateValue !== 'ACTIVE' ||
      L.active !== this ||
      massQ <= 0 ||
      energyQ <= 0 ||
      ((reason | dstKind) >>> 4) !== 0 ||
      LOCAL_MASS_ROUTE_LUT[(reason << 8) | (AK_ABIOTIC << 4) | dstKind] !== 1 ||
      LOCAL_ENERGY_ROUTE_LUT[(reason << 8) | (AK_SUN << 4) | dstKind] !== 1 ||
      (dstId >>> 0) !== dstId ||
      massQ > LOCAL_MAX_SAFE_INT ||
      energyQ > LOCAL_MAX_SAFE_INT ||
      Math.floor(massQ) !== massQ ||
      Math.floor(energyQ) !== energyQ ||
      !L.acc.gteFast(ACC_ABIOTIC_STAGED, massQ)
    ) {
      if (massQ > 0) this.postMass(reason, AK_ABIOTIC, 0, dstKind, dstId, massQ);
      if (energyQ > 0) this.postEnergy(reason, AK_SUN, 0, dstKind, dstId, energyQ);
      return;
    }

    const ch = L.fastChannelBaseByKind[dstKind];
    const dstBackM = fastDst.back[ch];
    const dstBackE = fastDst.back[ch + 1];
    if (dstId >= dstBackM.length || dstBackM[dstId] + massQ > LOCAL_MAX_SAFE_INT) {
      fastDst.checkCredit(ch, dstId, massQ, ACCOUNT_KIND_NAMES[dstKind]);
    }
    if (dstBackE[dstId] + energyQ > LOCAL_MAX_SAFE_INT) {
      fastDst.checkCredit(ch + 1, dstId, energyQ, ACCOUNT_KIND_NAMES[dstKind]);
    }

    const mb = L.massBuffer;
    const eb = L.energyBuffer;
    if (mb.count >= mb.reason.length) mb.ensureRoom();
    if (eb.count >= eb.reason.length) eb.ensureRoom();

    L.acc.subFast(ACC_ABIOTIC_STAGED, massQ);
    L.acc.addFast(ACC_TX_SUN, energyQ);

    if (fastDst.dirtyFlag[dstId] === 0) {
      fastDst.dirtyFlag[dstId] = 1;
      fastDst.dirtyList[fastDst.dirtyCountValue++] = dstId;
    }
    dstBackM[dstId] += massQ;
    dstBackE[dstId] += energyQ;

    const mi = mb.count++;
    mb.reason[mi] = reason;
    mb.srcKind[mi] = AK_ABIOTIC;
    mb.dstKind[mi] = dstKind;
    mb.srcId[mi] = 0;
    mb.dstId[mi] = dstId;
    mb.amount[mi] = massQ;
    L.reasonTxMass.addFast(reason, massQ);

    const ei = eb.count++;
    eb.reason[ei] = reason;
    eb.srcKind[ei] = AK_SUN;
    eb.dstKind[ei] = dstKind;
    eb.srcId[ei] = 0;
    eb.dstId[ei] = dstId;
    eb.amount[ei] = energyQ;
    L.reasonTxEnergy.addFast(reason, energyQ);
  }

  /** @internal Fuses feeding legs (INGESTION + optional EGESTION + SDA) for fast-store sources. */
  postFeedingFast(
    srcKind: AccountKindId,
    srcId: number,
    eaterSlot: number,
    detritusCellIndex: number,
    depositMassQ: number,
    depositEnergyQ: number,
    egestaMassQ: number,
    egestaEnergyQ: number,
    abioticMassQ: number,
    heatQ: number
  ): void {
    const L = this.ledger;
    const fastSrc = L.fastStoreByKind[srcKind];
    const fastOrg = L.fastStoreByKind[AK_ORGANISM_RESERVE];
    const fastDet = L.fastStoreByKind[AK_CELL_DETRITUS];
    const doIng = depositMassQ > 0 || depositEnergyQ > 0;
    const doEg =
      (egestaMassQ > 0 || egestaEnergyQ > 0) &&
      !(srcKind === AK_CELL_DETRITUS && srcId === detritusCellIndex);
    if (
      fastSrc === null ||
      fastOrg === null ||
      fastDet === null ||
      this.stateValue !== 'ACTIVE' ||
      L.active !== this ||
      (srcId >>> 0) !== srcId ||
      (eaterSlot >>> 0) !== eaterSlot ||
      (detritusCellIndex >>> 0) !== detritusCellIndex ||
      !(depositMassQ >= 0 && depositMassQ <= LOCAL_MAX_SAFE_INT && Math.floor(depositMassQ) === depositMassQ) ||
      !(depositEnergyQ >= 0 && depositEnergyQ <= LOCAL_MAX_SAFE_INT && Math.floor(depositEnergyQ) === depositEnergyQ) ||
      !(egestaMassQ >= 0 && egestaMassQ <= LOCAL_MAX_SAFE_INT && Math.floor(egestaMassQ) === egestaMassQ) ||
      !(egestaEnergyQ >= 0 && egestaEnergyQ <= LOCAL_MAX_SAFE_INT && Math.floor(egestaEnergyQ) === egestaEnergyQ) ||
      !(abioticMassQ >= 0 && abioticMassQ <= LOCAL_MAX_SAFE_INT && Math.floor(abioticMassQ) === abioticMassQ) ||
      !(heatQ >= 0 && heatQ <= LOCAL_MAX_SAFE_INT && Math.floor(heatQ) === heatQ) ||
      (srcKind !== AK_CELL_PLANT && srcKind !== AK_CELL_CARRION && srcKind !== AK_CELL_DETRITUS)
    ) {
      if (doIng) this.transferBiomass(PR_INGESTION, srcKind, srcId, AK_ORGANISM_RESERVE, eaterSlot, depositMassQ, depositEnergyQ);
      if (doEg) this.transferBiomass(PR_EGESTION, srcKind, srcId, AK_CELL_DETRITUS, detritusCellIndex, egestaMassQ, egestaEnergyQ);
      if (abioticMassQ > 0) this.postMass(PR_SDA, srcKind, srcId, AK_ABIOTIC, 0, abioticMassQ);
      if (heatQ > 0) this.postEnergy(PR_SDA, srcKind, srcId, AK_HEAT, 0, heatQ);
      return;
    }

    const totalSrcDebitM = (doIng ? depositMassQ : 0) + (doEg ? egestaMassQ : 0) + abioticMassQ;
    const totalSrcDebitE = (doIng ? depositEnergyQ : 0) + (doEg ? egestaEnergyQ : 0) + heatQ;
    const sCh = L.fastChannelBaseByKind[srcKind];
    const srcBackM = fastSrc.back[sCh];
    const srcBackE = fastSrc.back[sCh + 1];
    if (srcId >= srcBackM.length || srcBackM[srcId] < totalSrcDebitM) {
      fastSrc.checkDebit(sCh, srcId, totalSrcDebitM, ACCOUNT_KIND_NAMES[srcKind]);
    }
    if (srcBackE[srcId] < totalSrcDebitE) {
      fastSrc.checkDebit(sCh + 1, srcId, totalSrcDebitE, ACCOUNT_KIND_NAMES[srcKind]);
    }

    const orgCh = L.fastChannelBaseByKind[AK_ORGANISM_RESERVE];
    const orgBackM = fastOrg.back[orgCh];
    const orgBackE = fastOrg.back[orgCh + 1];
    if (doIng) {
      if (eaterSlot >= orgBackM.length || orgBackM[eaterSlot] + depositMassQ > LOCAL_MAX_SAFE_INT) {
        fastOrg.checkCredit(orgCh, eaterSlot, depositMassQ, ACCOUNT_KIND_NAMES[AK_ORGANISM_RESERVE]);
      }
      if (orgBackE[eaterSlot] + depositEnergyQ > LOCAL_MAX_SAFE_INT) {
        fastOrg.checkCredit(orgCh + 1, eaterSlot, depositEnergyQ, ACCOUNT_KIND_NAMES[AK_ORGANISM_RESERVE]);
      }
    }

    let detBackM: Float64Array | null = null;
    let detBackE: Float64Array | null = null;
    if (doEg) {
      const detCh = L.fastChannelBaseByKind[AK_CELL_DETRITUS];
      detBackM = fastDet.back[detCh];
      detBackE = fastDet.back[detCh + 1];
      if (detritusCellIndex >= detBackM.length || detBackM[detritusCellIndex] + egestaMassQ > LOCAL_MAX_SAFE_INT) {
        fastDet.checkCredit(detCh, detritusCellIndex, egestaMassQ, ACCOUNT_KIND_NAMES[AK_CELL_DETRITUS]);
      }
      if (detBackE[detritusCellIndex] + egestaEnergyQ > LOCAL_MAX_SAFE_INT) {
        fastDet.checkCredit(detCh + 1, detritusCellIndex, egestaEnergyQ, ACCOUNT_KIND_NAMES[AK_CELL_DETRITUS]);
      }
    }

    const mb = L.massBuffer;
    const eb = L.energyBuffer;
    if (mb.count + 3 > mb.reason.length) mb.ensureRoom(3);
    if (eb.count + 3 > eb.reason.length) eb.ensureRoom(3);

    if (totalSrcDebitM > 0 || totalSrcDebitE > 0) {
      if (fastSrc.dirtyFlag[srcId] === 0) {
        fastSrc.dirtyFlag[srcId] = 1;
        fastSrc.dirtyList[fastSrc.dirtyCountValue++] = srcId;
      }
      srcBackM[srcId] -= totalSrcDebitM;
      srcBackE[srcId] -= totalSrcDebitE;
    }

    if (doIng) {
      if (fastOrg.dirtyFlag[eaterSlot] === 0) {
        fastOrg.dirtyFlag[eaterSlot] = 1;
        fastOrg.dirtyList[fastOrg.dirtyCountValue++] = eaterSlot;
      }
      if (depositMassQ > 0) {
        orgBackM[eaterSlot] += depositMassQ;
        const mi = mb.count++;
        mb.reason[mi] = PR_INGESTION;
        mb.srcKind[mi] = srcKind;
        mb.dstKind[mi] = AK_ORGANISM_RESERVE;
        mb.srcId[mi] = srcId;
        mb.dstId[mi] = eaterSlot;
        mb.amount[mi] = depositMassQ;
        L.reasonTxMass.addFast(PR_INGESTION, depositMassQ);
      }
      if (depositEnergyQ > 0) {
        orgBackE[eaterSlot] += depositEnergyQ;
        const ei = eb.count++;
        eb.reason[ei] = PR_INGESTION;
        eb.srcKind[ei] = srcKind;
        eb.dstKind[ei] = AK_ORGANISM_RESERVE;
        eb.srcId[ei] = srcId;
        eb.dstId[ei] = eaterSlot;
        eb.amount[ei] = depositEnergyQ;
        L.reasonTxEnergy.addFast(PR_INGESTION, depositEnergyQ);
      }
    }

    if (doEg && detBackM !== null && detBackE !== null) {
      if (fastDet.dirtyFlag[detritusCellIndex] === 0) {
        fastDet.dirtyFlag[detritusCellIndex] = 1;
        fastDet.dirtyList[fastDet.dirtyCountValue++] = detritusCellIndex;
      }
      if (egestaMassQ > 0) {
        detBackM[detritusCellIndex] += egestaMassQ;
        const mi = mb.count++;
        mb.reason[mi] = PR_EGESTION;
        mb.srcKind[mi] = srcKind;
        mb.dstKind[mi] = AK_CELL_DETRITUS;
        mb.srcId[mi] = srcId;
        mb.dstId[mi] = detritusCellIndex;
        mb.amount[mi] = egestaMassQ;
        L.reasonTxMass.addFast(PR_EGESTION, egestaMassQ);
      }
      if (egestaEnergyQ > 0) {
        detBackE[detritusCellIndex] += egestaEnergyQ;
        const ei = eb.count++;
        eb.reason[ei] = PR_EGESTION;
        eb.srcKind[ei] = srcKind;
        eb.dstKind[ei] = AK_CELL_DETRITUS;
        eb.srcId[ei] = srcId;
        eb.dstId[ei] = detritusCellIndex;
        eb.amount[ei] = egestaEnergyQ;
        L.reasonTxEnergy.addFast(PR_EGESTION, egestaEnergyQ);
      }
    }

    if (abioticMassQ > 0) {
      L.acc.addFast(ACC_ABIOTIC_STAGED, abioticMassQ);
      const mi = mb.count++;
      mb.reason[mi] = PR_SDA;
      mb.srcKind[mi] = srcKind;
      mb.dstKind[mi] = AK_ABIOTIC;
      mb.srcId[mi] = srcId;
      mb.dstId[mi] = 0;
      mb.amount[mi] = abioticMassQ;
      L.reasonTxMass.addFast(PR_SDA, abioticMassQ);
    }
    if (heatQ > 0) {
      L.acc.addFast(ACC_TX_HEAT, heatQ);
      const ei = eb.count++;
      eb.reason[ei] = PR_SDA;
      eb.srcKind[ei] = srcKind;
      eb.dstKind[ei] = AK_HEAT;
      eb.srcId[ei] = srcId;
      eb.dstId[ei] = 0;
      eb.amount[ei] = heatQ;
      L.reasonTxEnergy.addFast(PR_SDA, heatQ);
    }
  }

  /** @internal Fuses somatic growth postings for one organism slot cleanly. */
  postSomaticGrowthFast(
    organismSlot: number,
    structGainEnergyQ: number,
    heatQ: number,
    directReserveToStruct: number,
    abioticInMassQ: number,
    abioticOutMassQ: number
  ): void {
    const L = this.ledger;
    const fastOrg = L.fastStoreByKind[AK_ORGANISM_RESERVE];
    if (
      fastOrg === null ||
      this.stateValue !== 'ACTIVE' ||
      L.active !== this ||
      (organismSlot >>> 0) !== organismSlot ||
      structGainEnergyQ <= 0 ||
      abioticInMassQ > 0 && !L.acc.gteFast(ACC_ABIOTIC_STAGED, abioticInMassQ)
    ) {
      this.postEnergy(PR_GROWTH, AK_ORGANISM_RESERVE, organismSlot, AK_ORGANISM_STRUCT, organismSlot, structGainEnergyQ);
      if (heatQ > 0) this.postEnergy(PR_GROWTH, AK_ORGANISM_RESERVE, organismSlot, AK_HEAT, 0, heatQ);
      if (directReserveToStruct > 0) this.postMass(PR_GROWTH, AK_ORGANISM_RESERVE, organismSlot, AK_ORGANISM_STRUCT, organismSlot, directReserveToStruct);
      if (abioticInMassQ > 0) this.postMass(PR_GROWTH, AK_ABIOTIC, 0, AK_ORGANISM_STRUCT, organismSlot, abioticInMassQ);
      if (abioticOutMassQ > 0) this.postMass(PR_GROWTH, AK_ORGANISM_RESERVE, organismSlot, AK_ABIOTIC, 0, abioticOutMassQ);
      return;
    }

    const sCh = L.fastChannelBaseByKind[AK_ORGANISM_STRUCT];
    const rCh = L.fastChannelBaseByKind[AK_ORGANISM_RESERVE];
    const sBackM = fastOrg.back[sCh];
    const sBackE = fastOrg.back[sCh + 1];
    const rBackM = fastOrg.back[rCh];
    const rBackE = fastOrg.back[rCh + 1];

    const resDebitM = directReserveToStruct + abioticOutMassQ;
    const resDebitE = structGainEnergyQ + heatQ;
    const structCreditM = directReserveToStruct + abioticInMassQ;
    if (organismSlot >= rBackM.length || rBackM[organismSlot] < resDebitM) {
      fastOrg.checkDebit(rCh, organismSlot, resDebitM, ACCOUNT_KIND_NAMES[AK_ORGANISM_RESERVE]);
    }
    if (rBackE[organismSlot] < resDebitE) {
      fastOrg.checkDebit(rCh + 1, organismSlot, resDebitE, ACCOUNT_KIND_NAMES[AK_ORGANISM_RESERVE]);
    }
    if (sBackM[organismSlot] + structCreditM > LOCAL_MAX_SAFE_INT) {
      fastOrg.checkCredit(sCh, organismSlot, structCreditM, ACCOUNT_KIND_NAMES[AK_ORGANISM_STRUCT]);
    }
    if (sBackE[organismSlot] + structGainEnergyQ > LOCAL_MAX_SAFE_INT) {
      fastOrg.checkCredit(sCh + 1, organismSlot, structGainEnergyQ, ACCOUNT_KIND_NAMES[AK_ORGANISM_STRUCT]);
    }

    const mb = L.massBuffer;
    const eb = L.energyBuffer;
    if (mb.count + 3 > mb.reason.length) mb.ensureRoom(3);
    if (eb.count + 2 > eb.reason.length) eb.ensureRoom(2);

    if (fastOrg.dirtyFlag[organismSlot] === 0) {
      fastOrg.dirtyFlag[organismSlot] = 1;
      fastOrg.dirtyList[fastOrg.dirtyCountValue++] = organismSlot;
    }
    rBackM[organismSlot] -= resDebitM;
    rBackE[organismSlot] -= resDebitE;
    sBackM[organismSlot] += structCreditM;
    sBackE[organismSlot] += structGainEnergyQ;
    if (abioticInMassQ > 0) L.acc.subFast(ACC_ABIOTIC_STAGED, abioticInMassQ);
    if (abioticOutMassQ > 0) L.acc.addFast(ACC_ABIOTIC_STAGED, abioticOutMassQ);
    if (heatQ > 0) L.acc.addFast(ACC_TX_HEAT, heatQ);

    let ei = eb.count++;
    eb.reason[ei] = PR_GROWTH;
    eb.srcKind[ei] = AK_ORGANISM_RESERVE;
    eb.dstKind[ei] = AK_ORGANISM_STRUCT;
    eb.srcId[ei] = organismSlot;
    eb.dstId[ei] = organismSlot;
    eb.amount[ei] = structGainEnergyQ;
    L.reasonTxEnergy.addFast(PR_GROWTH, structGainEnergyQ);

    if (heatQ > 0) {
      ei = eb.count++;
      eb.reason[ei] = PR_GROWTH;
      eb.srcKind[ei] = AK_ORGANISM_RESERVE;
      eb.dstKind[ei] = AK_HEAT;
      eb.srcId[ei] = organismSlot;
      eb.dstId[ei] = 0;
      eb.amount[ei] = heatQ;
      L.reasonTxEnergy.addFast(PR_GROWTH, heatQ);
    }

    if (directReserveToStruct > 0) {
      const mi = mb.count++;
      mb.reason[mi] = PR_GROWTH;
      mb.srcKind[mi] = AK_ORGANISM_RESERVE;
      mb.dstKind[mi] = AK_ORGANISM_STRUCT;
      mb.srcId[mi] = organismSlot;
      mb.dstId[mi] = organismSlot;
      mb.amount[mi] = directReserveToStruct;
      L.reasonTxMass.addFast(PR_GROWTH, directReserveToStruct);
    }
    if (abioticInMassQ > 0) {
      const mi = mb.count++;
      mb.reason[mi] = PR_GROWTH;
      mb.srcKind[mi] = AK_ABIOTIC;
      mb.dstKind[mi] = AK_ORGANISM_STRUCT;
      mb.srcId[mi] = 0;
      mb.dstId[mi] = organismSlot;
      mb.amount[mi] = abioticInMassQ;
      L.reasonTxMass.addFast(PR_GROWTH, abioticInMassQ);
    }
    if (abioticOutMassQ > 0) {
      const mi = mb.count++;
      mb.reason[mi] = PR_GROWTH;
      mb.srcKind[mi] = AK_ORGANISM_RESERVE;
      mb.dstKind[mi] = AK_ABIOTIC;
      mb.srcId[mi] = organismSlot;
      mb.dstId[mi] = 0;
      mb.amount[mi] = abioticOutMassQ;
      L.reasonTxMass.addFast(PR_GROWTH, abioticOutMassQ);
    }
  }

  /** @internal Fuses reproduction provisioning postings between motherSlot and childSlot. */
  postReproductionProvisioningFast(
    motherSlot: number,
    childSlot: number,
    childStructEnergyQ: number,
    childReserveEnergyQ: number,
    heatQ: number,
    desiredOffspringReserveMassQ: number,
    directReserveToStruct: number,
    abioticInMassQ: number,
    abioticOutMassQ: number
  ): void {
    const L = this.ledger;
    const fastOrg = L.fastStoreByKind[AK_ORGANISM_RESERVE];
    if (
      fastOrg === null ||
      this.stateValue !== 'ACTIVE' ||
      L.active !== this ||
      (motherSlot >>> 0) !== motherSlot ||
      (childSlot >>> 0) !== childSlot ||
      motherSlot === childSlot ||
      (abioticInMassQ > 0 && !L.acc.gteFast(ACC_ABIOTIC_STAGED, abioticInMassQ))
    ) {
      if (childStructEnergyQ > 0) this.postEnergy(PR_REPRODUCTION, AK_ORGANISM_RESERVE, motherSlot, AK_ORGANISM_STRUCT, childSlot, childStructEnergyQ);
      if (childReserveEnergyQ > 0) this.postEnergy(PR_REPRODUCTION, AK_ORGANISM_RESERVE, motherSlot, AK_ORGANISM_RESERVE, childSlot, childReserveEnergyQ);
      if (heatQ > 0) this.postEnergy(PR_REPRODUCTION, AK_ORGANISM_RESERVE, motherSlot, AK_HEAT, 0, heatQ);
      if (desiredOffspringReserveMassQ > 0) this.postMass(PR_REPRODUCTION, AK_ORGANISM_RESERVE, motherSlot, AK_ORGANISM_RESERVE, childSlot, desiredOffspringReserveMassQ);
      if (directReserveToStruct > 0) this.postMass(PR_REPRODUCTION, AK_ORGANISM_RESERVE, motherSlot, AK_ORGANISM_STRUCT, childSlot, directReserveToStruct);
      if (abioticInMassQ > 0) this.postMass(PR_REPRODUCTION, AK_ABIOTIC, 0, AK_ORGANISM_STRUCT, childSlot, abioticInMassQ);
      if (abioticOutMassQ > 0) this.postMass(PR_REPRODUCTION, AK_ORGANISM_RESERVE, motherSlot, AK_ABIOTIC, 0, abioticOutMassQ);
      return;
    }

    const sCh = L.fastChannelBaseByKind[AK_ORGANISM_STRUCT];
    const rCh = L.fastChannelBaseByKind[AK_ORGANISM_RESERVE];
    const sBackM = fastOrg.back[sCh];
    const sBackE = fastOrg.back[sCh + 1];
    const rBackM = fastOrg.back[rCh];
    const rBackE = fastOrg.back[rCh + 1];

    const motherDebitM = desiredOffspringReserveMassQ + directReserveToStruct + abioticOutMassQ;
    const motherDebitE = childStructEnergyQ + childReserveEnergyQ + heatQ;
    const childStructCreditM = directReserveToStruct + abioticInMassQ;
    if (motherSlot >= rBackM.length || rBackM[motherSlot] < motherDebitM) {
      fastOrg.checkDebit(rCh, motherSlot, motherDebitM, ACCOUNT_KIND_NAMES[AK_ORGANISM_RESERVE]);
    }
    if (rBackE[motherSlot] < motherDebitE) {
      fastOrg.checkDebit(rCh + 1, motherSlot, motherDebitE, ACCOUNT_KIND_NAMES[AK_ORGANISM_RESERVE]);
    }
    if (childSlot >= sBackM.length || sBackM[childSlot] + childStructCreditM > LOCAL_MAX_SAFE_INT) {
      fastOrg.checkCredit(sCh, childSlot, childStructCreditM, ACCOUNT_KIND_NAMES[AK_ORGANISM_STRUCT]);
    }
    if (sBackE[childSlot] + childStructEnergyQ > LOCAL_MAX_SAFE_INT) {
      fastOrg.checkCredit(sCh + 1, childSlot, childStructEnergyQ, ACCOUNT_KIND_NAMES[AK_ORGANISM_STRUCT]);
    }
    if (rBackM[childSlot] + desiredOffspringReserveMassQ > LOCAL_MAX_SAFE_INT) {
      fastOrg.checkCredit(rCh, childSlot, desiredOffspringReserveMassQ, ACCOUNT_KIND_NAMES[AK_ORGANISM_RESERVE]);
    }
    if (rBackE[childSlot] + childReserveEnergyQ > LOCAL_MAX_SAFE_INT) {
      fastOrg.checkCredit(rCh + 1, childSlot, childReserveEnergyQ, ACCOUNT_KIND_NAMES[AK_ORGANISM_RESERVE]);
    }

    const mb = L.massBuffer;
    const eb = L.energyBuffer;
    if (mb.count + 4 > mb.reason.length) mb.ensureRoom(4);
    if (eb.count + 3 > eb.reason.length) eb.ensureRoom(3);

    if (fastOrg.dirtyFlag[motherSlot] === 0) {
      fastOrg.dirtyFlag[motherSlot] = 1;
      fastOrg.dirtyList[fastOrg.dirtyCountValue++] = motherSlot;
    }
    if (fastOrg.dirtyFlag[childSlot] === 0) {
      fastOrg.dirtyFlag[childSlot] = 1;
      fastOrg.dirtyList[fastOrg.dirtyCountValue++] = childSlot;
    }
    rBackM[motherSlot] -= motherDebitM;
    rBackE[motherSlot] -= motherDebitE;
    sBackM[childSlot] += childStructCreditM;
    sBackE[childSlot] += childStructEnergyQ;
    rBackM[childSlot] += desiredOffspringReserveMassQ;
    rBackE[childSlot] += childReserveEnergyQ;
    if (abioticInMassQ > 0) L.acc.subFast(ACC_ABIOTIC_STAGED, abioticInMassQ);
    if (abioticOutMassQ > 0) L.acc.addFast(ACC_ABIOTIC_STAGED, abioticOutMassQ);
    if (heatQ > 0) L.acc.addFast(ACC_TX_HEAT, heatQ);

    if (childStructEnergyQ > 0) {
      const ei = eb.count++;
      eb.reason[ei] = PR_REPRODUCTION;
      eb.srcKind[ei] = AK_ORGANISM_RESERVE;
      eb.dstKind[ei] = AK_ORGANISM_STRUCT;
      eb.srcId[ei] = motherSlot;
      eb.dstId[ei] = childSlot;
      eb.amount[ei] = childStructEnergyQ;
      L.reasonTxEnergy.addFast(PR_REPRODUCTION, childStructEnergyQ);
    }
    if (childReserveEnergyQ > 0) {
      const ei = eb.count++;
      eb.reason[ei] = PR_REPRODUCTION;
      eb.srcKind[ei] = AK_ORGANISM_RESERVE;
      eb.dstKind[ei] = AK_ORGANISM_RESERVE;
      eb.srcId[ei] = motherSlot;
      eb.dstId[ei] = childSlot;
      eb.amount[ei] = childReserveEnergyQ;
      L.reasonTxEnergy.addFast(PR_REPRODUCTION, childReserveEnergyQ);
    }
    if (heatQ > 0) {
      const ei = eb.count++;
      eb.reason[ei] = PR_REPRODUCTION;
      eb.srcKind[ei] = AK_ORGANISM_RESERVE;
      eb.dstKind[ei] = AK_HEAT;
      eb.srcId[ei] = motherSlot;
      eb.dstId[ei] = 0;
      eb.amount[ei] = heatQ;
      L.reasonTxEnergy.addFast(PR_REPRODUCTION, heatQ);
    }

    if (desiredOffspringReserveMassQ > 0) {
      const mi = mb.count++;
      mb.reason[mi] = PR_REPRODUCTION;
      mb.srcKind[mi] = AK_ORGANISM_RESERVE;
      mb.dstKind[mi] = AK_ORGANISM_RESERVE;
      mb.srcId[mi] = motherSlot;
      mb.dstId[mi] = childSlot;
      mb.amount[mi] = desiredOffspringReserveMassQ;
      L.reasonTxMass.addFast(PR_REPRODUCTION, desiredOffspringReserveMassQ);
    }
    if (directReserveToStruct > 0) {
      const mi = mb.count++;
      mb.reason[mi] = PR_REPRODUCTION;
      mb.srcKind[mi] = AK_ORGANISM_RESERVE;
      mb.dstKind[mi] = AK_ORGANISM_STRUCT;
      mb.srcId[mi] = motherSlot;
      mb.dstId[mi] = childSlot;
      mb.amount[mi] = directReserveToStruct;
      L.reasonTxMass.addFast(PR_REPRODUCTION, directReserveToStruct);
    }
    if (abioticInMassQ > 0) {
      const mi = mb.count++;
      mb.reason[mi] = PR_REPRODUCTION;
      mb.srcKind[mi] = AK_ABIOTIC;
      mb.dstKind[mi] = AK_ORGANISM_STRUCT;
      mb.srcId[mi] = 0;
      mb.dstId[mi] = childSlot;
      mb.amount[mi] = abioticInMassQ;
      L.reasonTxMass.addFast(PR_REPRODUCTION, abioticInMassQ);
    }
    if (abioticOutMassQ > 0) {
      const mi = mb.count++;
      mb.reason[mi] = PR_REPRODUCTION;
      mb.srcKind[mi] = AK_ORGANISM_RESERVE;
      mb.dstKind[mi] = AK_ABIOTIC;
      mb.srcId[mi] = motherSlot;
      mb.dstId[mi] = 0;
      mb.amount[mi] = abioticOutMassQ;
      L.reasonTxMass.addFast(PR_REPRODUCTION, abioticOutMassQ);
    }
  }

  /** @internal Fuses STRUCT + RESERVE -> CELL_CARRION death transfers into a single store pass. */
  postDeathToCarrionFast(
    organismSlot: number,
    cellIndex: number,
    structMassQ: number,
    structEnergyQ: number,
    reserveMassQ: number,
    reserveEnergyQ: number
  ): void {
    if (structMassQ === 0 && reserveMassQ === 0) return;
    const L = this.ledger;
    const fastOrg = L.fastStoreByKind[AK_ORGANISM_STRUCT];
    const fastCar = L.fastStoreByKind[AK_CELL_CARRION];
    if (
      fastOrg === null ||
      fastCar === null ||
      this.stateValue !== 'ACTIVE' ||
      L.active !== this ||
      (organismSlot >>> 0) !== organismSlot ||
      (cellIndex >>> 0) !== cellIndex ||
      structMassQ < 0 ||
      reserveMassQ < 0
    ) {
      if (structMassQ > 0) this.transferBiomass(PR_DEATH, AK_ORGANISM_STRUCT, organismSlot, AK_CELL_CARRION, cellIndex, structMassQ, structEnergyQ);
      if (reserveMassQ > 0) this.transferBiomass(PR_DEATH, AK_ORGANISM_RESERVE, organismSlot, AK_CELL_CARRION, cellIndex, reserveMassQ, reserveEnergyQ);
      return;
    }

    const sCh = L.fastChannelBaseByKind[AK_ORGANISM_STRUCT];
    const rCh = L.fastChannelBaseByKind[AK_ORGANISM_RESERVE];
    const cCh = L.fastChannelBaseByKind[AK_CELL_CARRION];
    const sBackM = fastOrg.back[sCh];
    const sBackE = fastOrg.back[sCh + 1];
    const rBackM = fastOrg.back[rCh];
    const rBackE = fastOrg.back[rCh + 1];
    const cBackM = fastCar.back[cCh];
    const cBackE = fastCar.back[cCh + 1];

    if (organismSlot >= sBackM.length || sBackM[organismSlot] < structMassQ) {
      fastOrg.checkDebit(sCh, organismSlot, structMassQ, ACCOUNT_KIND_NAMES[AK_ORGANISM_STRUCT]);
    }
    if (sBackE[organismSlot] < structEnergyQ) {
      fastOrg.checkDebit(sCh + 1, organismSlot, structEnergyQ, ACCOUNT_KIND_NAMES[AK_ORGANISM_STRUCT]);
    }
    if (rBackM[organismSlot] < reserveMassQ) {
      fastOrg.checkDebit(rCh, organismSlot, reserveMassQ, ACCOUNT_KIND_NAMES[AK_ORGANISM_RESERVE]);
    }
    if (rBackE[organismSlot] < reserveEnergyQ) {
      fastOrg.checkDebit(rCh + 1, organismSlot, reserveEnergyQ, ACCOUNT_KIND_NAMES[AK_ORGANISM_RESERVE]);
    }
    const totM = structMassQ + reserveMassQ;
    const totE = structEnergyQ + reserveEnergyQ;
    if (cellIndex >= cBackM.length || cBackM[cellIndex] + totM > LOCAL_MAX_SAFE_INT) {
      fastCar.checkCredit(cCh, cellIndex, totM, ACCOUNT_KIND_NAMES[AK_CELL_CARRION]);
    }
    if (cBackE[cellIndex] + totE > LOCAL_MAX_SAFE_INT) {
      fastCar.checkCredit(cCh + 1, cellIndex, totE, ACCOUNT_KIND_NAMES[AK_CELL_CARRION]);
    }

    const mb = L.massBuffer;
    const eb = L.energyBuffer;
    if (mb.count + 2 > mb.reason.length) mb.ensureRoom(2);
    if (eb.count + 2 > eb.reason.length) eb.ensureRoom(2);

    if (fastOrg.dirtyFlag[organismSlot] === 0) {
      fastOrg.dirtyFlag[organismSlot] = 1;
      fastOrg.dirtyList[fastOrg.dirtyCountValue++] = organismSlot;
    }
    if (fastCar.dirtyFlag[cellIndex] === 0) {
      fastCar.dirtyFlag[cellIndex] = 1;
      fastCar.dirtyList[fastCar.dirtyCountValue++] = cellIndex;
    }

    if (structMassQ > 0) {
      sBackM[organismSlot] -= structMassQ;
      cBackM[cellIndex] += structMassQ;
      const mi = mb.count++;
      mb.reason[mi] = PR_DEATH;
      mb.srcKind[mi] = AK_ORGANISM_STRUCT;
      mb.dstKind[mi] = AK_CELL_CARRION;
      mb.srcId[mi] = organismSlot;
      mb.dstId[mi] = cellIndex;
      mb.amount[mi] = structMassQ;
      L.reasonTxMass.addFast(PR_DEATH, structMassQ);
    }
    if (structEnergyQ > 0) {
      sBackE[organismSlot] -= structEnergyQ;
      cBackE[cellIndex] += structEnergyQ;
      const ei = eb.count++;
      eb.reason[ei] = PR_DEATH;
      eb.srcKind[ei] = AK_ORGANISM_STRUCT;
      eb.dstKind[ei] = AK_CELL_CARRION;
      eb.srcId[ei] = organismSlot;
      eb.dstId[ei] = cellIndex;
      eb.amount[ei] = structEnergyQ;
      L.reasonTxEnergy.addFast(PR_DEATH, structEnergyQ);
    }
    if (reserveMassQ > 0) {
      rBackM[organismSlot] -= reserveMassQ;
      cBackM[cellIndex] += reserveMassQ;
      const mi = mb.count++;
      mb.reason[mi] = PR_DEATH;
      mb.srcKind[mi] = AK_ORGANISM_RESERVE;
      mb.dstKind[mi] = AK_CELL_CARRION;
      mb.srcId[mi] = organismSlot;
      mb.dstId[mi] = cellIndex;
      mb.amount[mi] = reserveMassQ;
      L.reasonTxMass.addFast(PR_DEATH, reserveMassQ);
    }
    if (reserveEnergyQ > 0) {
      rBackE[organismSlot] -= reserveEnergyQ;
      cBackE[cellIndex] += reserveEnergyQ;
      const ei = eb.count++;
      eb.reason[ei] = PR_DEATH;
      eb.srcKind[ei] = AK_ORGANISM_RESERVE;
      eb.dstKind[ei] = AK_CELL_CARRION;
      eb.srcId[ei] = organismSlot;
      eb.dstId[ei] = cellIndex;
      eb.amount[ei] = reserveEnergyQ;
      L.reasonTxEnergy.addFast(PR_DEATH, reserveEnergyQ);
    }
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

    const fastSrc = L.fastStoreByKind[srcKind];
    const fastDst = L.fastStoreByKind[dstKind];
    let srcStore: StagedStore | null = null;
    let dstStore: StagedStore | null = null;
    let srcBackM: Float64Array | null = null;
    let srcBackE: Float64Array | null = null;
    let dstBackM: Float64Array | null = null;
    let dstBackE: Float64Array | null = null;

    // --- Validate source for both mass and energy legs ---
    if (fastSrc !== null) {
      const sCh = L.fastChannelBaseByKind[srcKind];
      srcBackM = fastSrc.back[sCh];
      srcBackE = fastSrc.back[sCh + 1];
      if (srcId >= srcBackM.length || srcBackM[srcId] < massQ) {
        fastSrc.checkDebit(sCh, srcId, massQ, ACCOUNT_KIND_NAMES[srcKind]);
      }
      if (srcBackE[srcId] < energyQ) {
        fastSrc.checkDebit(sCh + 1, srcId, energyQ, ACCOUNT_KIND_NAMES[srcKind]);
      }
    } else if (srcKind === AK_GENESIS) {
      if (!this.genesis) {
        throw new EnergyRuleError('Biomass transfer rejected: GENESIS is only available to genesis transactions');
      }
      if (srcId !== 0) EnergyTransaction.assertSingleton(srcKind, srcId);
    } else if (srcKind === AK_ESCROW) {
      this.assertEscrowSlot(srcId);
      if (!L.escrowStagedMass.gteFast(srcId, massQ)) {
        throw new InsufficientBalanceError(`ESCROW[${srcId}] mass cannot cover ${massQ} quanta`);
      }
      if (!L.escrowStagedEnergy.gteFast(srcId, energyQ)) {
        throw new InsufficientBalanceError(`ESCROW[${srcId}] energy cannot cover ${energyQ} quanta`);
      }
    } else {
      srcStore = L.storeByKind[srcKind] ?? this.storeFor(srcKind);
      srcStore.checkDebit(srcKind, srcId, false, massQ);
      srcStore.checkDebit(srcKind, srcId, true, energyQ);
    }

    // --- Validate destination for both mass and energy legs ---
    if (fastDst !== null) {
      const dCh = L.fastChannelBaseByKind[dstKind];
      dstBackM = fastDst.back[dCh];
      dstBackE = fastDst.back[dCh + 1];
      if (dstId >= dstBackM.length || dstBackM[dstId] + massQ > LOCAL_MAX_SAFE_INT) {
        fastDst.checkCredit(dCh, dstId, massQ, ACCOUNT_KIND_NAMES[dstKind]);
      }
      if (dstBackE[dstId] + energyQ > LOCAL_MAX_SAFE_INT) {
        fastDst.checkCredit(dCh + 1, dstId, energyQ, ACCOUNT_KIND_NAMES[dstKind]);
      }
    } else {
      dstStore = L.storeByKind[dstKind] ?? this.storeFor(dstKind);
      dstStore.checkCredit(dstKind, dstId, false, massQ);
      dstStore.checkCredit(dstKind, dstId, true, energyQ);
    }

    if (massQ === 0 && energyQ === 0) return;

    // --- Pre-reserve BOTH posting buffers before any state mutation ---
    const mb = L.massBuffer;
    const eb = L.energyBuffer;
    if (massQ > 0) mb.ensureRoom();
    if (energyQ > 0) eb.ensureRoom();

    // --- Apply atomically (cannot fail) ---
    if (fastSrc !== null) {
      if (fastSrc.dirtyFlag[srcId] === 0) {
        fastSrc.dirtyFlag[srcId] = 1;
        fastSrc.dirtyList[fastSrc.dirtyCountValue++] = srcId;
      }
      if (massQ > 0) (srcBackM as Float64Array)[srcId] -= massQ;
      if (energyQ > 0) (srcBackE as Float64Array)[srcId] -= energyQ;
    } else {
      if (massQ > 0) {
        if (srcKind === AK_GENESIS) L.acc.addFast(ACC_TX_GENESIS_MASS, massQ);
        else if (srcKind === AK_ESCROW) L.escrowStagedMass.subFast(srcId, massQ);
        else (srcStore as StagedStore).applyDebit(srcKind, srcId, false, massQ);
      }
      if (energyQ > 0) {
        if (srcKind === AK_GENESIS) L.acc.addFast(ACC_TX_GENESIS_ENERGY, energyQ);
        else if (srcKind === AK_ESCROW) L.escrowStagedEnergy.subFast(srcId, energyQ);
        else (srcStore as StagedStore).applyDebit(srcKind, srcId, true, energyQ);
      }
    }

    if (fastDst !== null) {
      if (fastDst.dirtyFlag[dstId] === 0) {
        fastDst.dirtyFlag[dstId] = 1;
        fastDst.dirtyList[fastDst.dirtyCountValue++] = dstId;
      }
      if (massQ > 0) (dstBackM as Float64Array)[dstId] += massQ;
      if (energyQ > 0) (dstBackE as Float64Array)[dstId] += energyQ;
    } else {
      if (massQ > 0) (dstStore as StagedStore).applyCredit(dstKind, dstId, false, massQ);
      if (energyQ > 0) (dstStore as StagedStore).applyCredit(dstKind, dstId, true, energyQ);
    }

    if (massQ > 0) {
      const mi = mb.count++;
      mb.reason[mi] = reason;
      mb.srcKind[mi] = srcKind;
      mb.dstKind[mi] = dstKind;
      mb.srcId[mi] = srcId;
      mb.dstId[mi] = dstId;
      mb.amount[mi] = massQ;
      L.reasonTxMass.addFast(reason, massQ);
    }

    if (energyQ > 0) {
      const ei = eb.count++;
      eb.reason[ei] = reason;
      eb.srcKind[ei] = srcKind;
      eb.dstKind[ei] = dstKind;
      eb.srcId[ei] = srcId;
      eb.dstId[ei] = dstId;
      eb.amount[ei] = energyQ;
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
    const PARTIAL_LIMIT = 35_184_372_088_832; // 2^45
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
    let genMassSum = 0;
    for (let i = 0; i < mbCount; i++) {
      const r = mbReason[i];
      const sk = mbSrcKind[i];
      const dk = mbDstKind[i];
      if (((r | sk | dk) >>> 4) !== 0 || LOCAL_MASS_ROUTE_LUT[(r << 8) | (sk << 4) | dk] !== 1) {
        throw new EnergyInvariantError('I4', `mass posting #${i}: ${checkMassRoute(r, sk, dk)}`);
      }
      if (sk === AK_GENESIS) {
        if (!this.genesis) throw new EnergyInvariantError('I4', `mass posting #${i} draws from GENESIS`);
        const v = mbAmount[i];
        if (v >= PARTIAL_LIMIT) acc.addFast(ACC_CHECK_GENESIS_MASS, v);
        else {
          genMassSum += v;
          if (genMassSum >= PARTIAL_LIMIT) {
            acc.addFast(ACC_CHECK_GENESIS_MASS, genMassSum);
            genMassSum = 0;
          }
        }
      }
    }
    if (genMassSum > 0) acc.addFast(ACC_CHECK_GENESIS_MASS, genMassSum);

    const eb = L.energyBuffer;
    const ebReason = eb.reason;
    const ebSrcKind = eb.srcKind;
    const ebDstKind = eb.dstKind;
    const ebAmount = eb.amount;
    const ebCount = eb.count;
    let sunSum = 0;
    let heatSum = 0;
    let genEnergySum = 0;
    for (let i = 0; i < ebCount; i++) {
      const r = ebReason[i];
      const sk = ebSrcKind[i];
      const dk = ebDstKind[i];
      if (((r | sk | dk) >>> 4) !== 0 || LOCAL_ENERGY_ROUTE_LUT[(r << 8) | (sk << 4) | dk] !== 1) {
        throw new EnergyInvariantError('I4', `energy posting #${i}: ${checkEnergyRoute(r, sk, dk)}`);
      }
      if (sk === AK_GENESIS) {
        if (!this.genesis) throw new EnergyInvariantError('I4', `energy posting #${i} draws from GENESIS`);
        const v = ebAmount[i];
        if (v >= PARTIAL_LIMIT) acc.addFast(ACC_CHECK_GENESIS_ENERGY, v);
        else {
          genEnergySum += v;
          if (genEnergySum >= PARTIAL_LIMIT) {
            acc.addFast(ACC_CHECK_GENESIS_ENERGY, genEnergySum);
            genEnergySum = 0;
          }
        }
      } else if (sk === AK_SUN) {
        const v = ebAmount[i];
        if (v >= PARTIAL_LIMIT) acc.addFast(ACC_CHECK_SUN, v);
        else {
          sunSum += v;
          if (sunSum >= PARTIAL_LIMIT) {
            acc.addFast(ACC_CHECK_SUN, sunSum);
            sunSum = 0;
          }
        }
      }
      if (dk === AK_HEAT) {
        const v = ebAmount[i];
        if (v >= PARTIAL_LIMIT) acc.addFast(ACC_CHECK_HEAT, v);
        else {
          heatSum += v;
          if (heatSum >= PARTIAL_LIMIT) {
            acc.addFast(ACC_CHECK_HEAT, heatSum);
            heatSum = 0;
          }
        }
      }
    }
    if (genEnergySum > 0) acc.addFast(ACC_CHECK_GENESIS_ENERGY, genEnergySum);
    if (sunSum > 0) acc.addFast(ACC_CHECK_SUN, sunSum);
    if (heatSum > 0) acc.addFast(ACC_CHECK_HEAT, heatSum);
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
