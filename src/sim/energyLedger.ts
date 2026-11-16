/**
 * EnergyLedger — exact double-entry accounting of mass (MU) and energy (EU) for the whole
 * biosphere (Phase 2.2.1b / P1).
 *
 * The world is an OPEN energy system and a CLOSED mass system:
 *   - energy enters from SUN (and GENESIS / external providers) and leaves as HEAT;
 *   - mass only circulates between biotic stores, escrow and the single finite global pool of
 *     abiotic matter (`globalAbioticMassQ`); it enters only through GENESIS or external providers.
 *
 * Invariants (Revision 3 confirmed, exact integer equality, zero tolerance):
 *   I1  per transaction: delta(mass stock incl. ABIOTIC + ESCROW) == GENESIS
 *   I2  per transaction: delta(energy stock incl. ESCROW) == SUN + GENESIS - HEAT
 *   I3  every stock value is a non-negative safe integer; ABIOTIC never goes negative
 *   I4  SUN is source-only, HEAT is sink-only, ABIOTIC carries no energy, SUN/HEAT carry no mass,
 *       and (when `strictStoichiometry` is enabled) all pools hold exact 3 / 3 / 5 / 30 EU/MU
 *   I5  atomicity & determinism: every transaction executes atomically (all-or-nothing) and
 *       reproducibly, and cumulative `audit()` confirms actual stocks match total inflows - outflows
 * I1-I4 are enforced by `EnergyTransaction` (posting validation + PREPARE); I5 by transaction
 * atomicity and `audit()`.
 */

import {
  AccountKind,
  ACCOUNT_KIND_NAMES,
  EnergyPosting,
  MassPosting,
  POSTING_REASON_COUNT,
  PostingReasonId,
  AccountKindId,
  isValidPostingReason,
} from './energyAccounts';
import {
  Acc,
  EnergyInvariantError,
  EnergyTransaction,
  EnergyTransactionStateError,
  LEDGER_ACCUMULATOR_COUNT,
  LedgerState,
} from './energyTransaction';
import { StagedStore } from './stagedStore';
import { MAX_SAFE_INT } from './detMath';
import { ExactAccumulators, assertNonNegativeBig, assertQuanta } from './units';

export interface EnergyLedgerConfig {
  /** Initial size of the single global abiotic matter pool, in mass quanta. */
  readonly initialAbioticMassQ: bigint;
  /** Number of escrow slots for external resource providers (default: 4). */
  readonly escrowSlots?: number;
  /** Initial capacity of each staged posting buffer; grows by doubling while staging (default: 1024). */
  readonly postingCapacity?: number;
  /** Capacity of each committed-posting journal ring; 0 disables journaling (default: 0). */
  readonly journalCapacity?: number;
  /** When true, PREPARE enforces Revision 3 densities (3 / 3 / 5 / 30 EU/MU) on dirty accounts (default: false). */
  readonly strictStoichiometry?: boolean;
}

export interface ExternalWithdrawal {
  readonly massQ: number;
  readonly energyQ: number;
}

export interface EnergyLedgerAudit {
  readonly ok: boolean;
  /** Actual mass held by all stores + ABIOTIC + ESCROW, recomputed from the buffers. */
  readonly actualMassQ: bigint;
  /** Mass that should exist: GENESIS + external inflow. */
  readonly expectedMassQ: bigint;
  /** actual - expected (must be 0). */
  readonly massResidualQ: bigint;
  readonly actualEnergyQ: bigint;
  /** Energy that should exist: GENESIS + external inflow + SUN - HEAT. */
  readonly expectedEnergyQ: bigint;
  /** actual - expected (must be 0). */
  readonly energyResidualQ: bigint;
  readonly committedTxCount: number;
}

export interface ReasonFlow {
  readonly massQ: bigint;
  readonly energyQ: bigint;
}

export const DEFAULT_ESCROW_SLOTS = 4;
export const DEFAULT_POSTING_CAPACITY = 1024;
/** Number of per-reason accumulator arrays (tx mass, tx energy, cumulative mass, cumulative energy). */
export const LEDGER_REASON_ARRAY_COUNT = 4;
/** Number of per-slot escrow accumulator arrays (committed/staged x mass/energy). */
export const LEDGER_ESCROW_ARRAY_COUNT = 4;

export class EnergyLedger {
  private readonly state: LedgerState;

  constructor(config: EnergyLedgerConfig) {
    assertNonNegativeBig(config.initialAbioticMassQ, 'initialAbioticMassQ');
    const escrowSlots = config.escrowSlots ?? DEFAULT_ESCROW_SLOTS;
    const postingCapacity = config.postingCapacity ?? DEFAULT_POSTING_CAPACITY;
    const journalCapacity = config.journalCapacity ?? 0;
    if (!Number.isSafeInteger(escrowSlots) || escrowSlots < 1 || escrowSlots > 65536) {
      throw new RangeError(`escrowSlots must be an integer in [1, 65536], received: ${escrowSlots}`);
    }
    if (!Number.isSafeInteger(postingCapacity) || postingCapacity < 1) {
      throw new RangeError(`postingCapacity must be a positive integer, received: ${postingCapacity}`);
    }
    if (!Number.isSafeInteger(journalCapacity) || journalCapacity < 0) {
      throw new RangeError(`journalCapacity must be a non-negative integer, received: ${journalCapacity}`);
    }
    this.state = new LedgerState(
      escrowSlots,
      postingCapacity,
      journalCapacity,
      config.strictStoichiometry === true
    );
    const acc = this.state.acc;
    acc.setBigInt(Acc.ABIOTIC_COMMITTED, config.initialAbioticMassQ);
    acc.setBigInt(Acc.ABIOTIC_STAGED, config.initialAbioticMassQ);
    // The initial abiotic pool is world-genesis matter.
    acc.setBigInt(Acc.CUM_GENESIS_MASS, config.initialAbioticMassQ);
  }

  // --- Setup -----------------------------------------------------------------------------------

  /**
   * Registers an in-engine store as the owner of its account kinds. Must happen before the first
   * transaction; the store must be empty so that everything it will ever hold enters through
   * recorded postings.
   */
  registerStore(store: StagedStore): void {
    const L = this.state;
    this.assertUsable();
    if (!(store instanceof StagedStore)) {
      throw new TypeError('registerStore requires a StagedStore instance');
    }
    if (L.active !== null || L.nextTxId !== 1) {
      throw new EnergyTransactionStateError('Stores must be registered before the first transaction');
    }
    if (L.stores.includes(store)) {
      throw new RangeError(`Store "${store.storeId}" is already registered`);
    }
    for (const kind of store.ownedKinds) {
      if (L.storeByKind[kind] !== null) {
        throw new RangeError(`Account kind ${ACCOUNT_KIND_NAMES[kind]} already has a registered store`);
      }
    }
    if (store.stagedDirtyCount !== 0) {
      throw new RangeError(`Store "${store.storeId}" has staged changes and cannot be registered`);
    }
    const probe = new ExactAccumulators(2);
    store.accumulateCommittedTotals(probe, 0, 1);
    if (!probe.isZero(0) || !probe.isZero(1)) {
      throw new RangeError(`Store "${store.storeId}" must be empty when registered`);
    }
    for (const kind of store.ownedKinds) {
      L.storeByKind[kind] = store;
    }
    L.stores.push(store);
  }

  private assertUsable(): void {
    if (this.state.poisoned !== null) {
      throw new EnergyInvariantError(
        'I5',
        'ledger is poisoned by a failed COMMIT and refuses further work'
      );
    }
  }

  // --- Transactions ------------------------------------------------------------------------------

  /**
   * Opens the next transaction. Only one transaction can be open at a time; `tick` must be a
   * non-negative integer that never moves backwards.
   */
  begin(tick: number, options: { genesis?: boolean } = {}): EnergyTransaction {
    const L = this.state;
    this.assertUsable();
    if (L.active !== null) {
      throw new EnergyTransactionStateError(
        `Transaction ${L.active.id} is still ${L.active.state}; commit or abort it first`
      );
    }
    if (!Number.isSafeInteger(tick) || tick < 0 || tick > 0xffffffff) {
      throw new RangeError(`tick must be an integer in [0, 2^32 - 1], received: ${tick}`);
    }
    if (tick < L.lastCommittedTick) {
      throw new EnergyTransactionStateError(
        `tick ${tick} is older than the last committed tick ${L.lastCommittedTick}`
      );
    }
    if (L.nextTxId > MAX_SAFE_INT) {
      throw new EnergyTransactionStateError(
        `Transaction id exhausted safe integer range: ${L.nextTxId}`
      );
    }
    const acc = L.acc;
    acc.reset(Acc.TX_SUN);
    acc.reset(Acc.TX_HEAT);
    acc.reset(Acc.TX_GENESIS_MASS);
    acc.reset(Acc.TX_GENESIS_ENERGY);
    L.reasonTxMass.resetAll();
    L.reasonTxEnergy.resetAll();
    L.massBuffer.count = 0;
    L.energyBuffer.count = 0;
    const tx = new EnergyTransaction(L, L.nextTxId++, tick, options.genesis === true);
    L.active = tx;
    return tx;
  }

  get activeTransaction(): EnergyTransaction | null {
    return this.state.active;
  }

  get isPoisoned(): boolean {
    return this.state.poisoned !== null;
  }

  get strictStoichiometry(): boolean {
    return this.state.strictStoichiometry;
  }

  get committedTxCount(): number {
    return this.state.committedTxCount;
  }

  get abortedTxCount(): number {
    return this.state.abortedTxCount;
  }

  /** Tick of the last committed transaction, or -1 before the first commit. */
  get lastCommittedTick(): number {
    return this.state.lastCommittedTick;
  }

  get lastCommittedTxId(): number {
    return this.state.lastCommittedTxId;
  }

  // --- External resources (escrow) ---------------------------------------------------------------

  get escrowSlots(): number {
    return this.state.escrowSlots;
  }

  private assertEscrowSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.state.escrowSlots) {
      throw new RangeError(`Escrow slot out of range [0, ${this.state.escrowSlots}): ${slot}`);
    }
  }

  /**
   * Records resources that have ALREADY been withdrawn from an external provider. The deposit is
   * durable: it is part of committed state immediately and survives an ABORT of the open
   * transaction, so a withdrawal can never be lost or counted twice. Not allowed once the open
   * transaction is PREPARED (its verified balance is sealed).
   */
  depositEscrow(slot: number, massQ: number, energyQ: number): void {
    const L = this.state;
    this.assertUsable();
    this.assertEscrowSlot(slot);
    assertQuanta(massQ, 'massQ');
    assertQuanta(energyQ, 'energyQ');
    if (L.active !== null && L.active.state === 'PREPARED') {
      throw new EnergyTransactionStateError('Cannot deposit into escrow while a transaction is PREPARED');
    }
    L.escrowCommittedMass.add(slot, massQ);
    L.escrowStagedMass.add(slot, massQ);
    L.escrowCommittedEnergy.add(slot, energyQ);
    L.escrowStagedEnergy.add(slot, energyQ);
    L.acc.add(Acc.CUM_EXTERNAL_MASS, massQ);
    L.acc.add(Acc.CUM_EXTERNAL_ENERGY, energyQ);
  }

  /**
   * Safe boundary for external providers (the P1 contract behind the future
   * TransactionalFoodSource). `pull` is the ONLY place where external code runs; it executes
   * before PREPARE, never during COMMIT. If it throws or returns invalid amounts, nothing is
   * recorded and the error propagates; if it succeeds, the withdrawn amounts are deposited into
   * escrow atomically.
   */
  importExternal(slot: number, pull: () => ExternalWithdrawal): ExternalWithdrawal {
    this.assertUsable();
    this.assertEscrowSlot(slot);
    const L = this.state;
    if (L.active !== null && L.active.state === 'PREPARED') {
      throw new EnergyTransactionStateError('Cannot import external resources while a transaction is PREPARED');
    }
    const result = pull();
    if (result === null || typeof result !== 'object') {
      throw new RangeError('External provider must return { massQ, energyQ }');
    }
    const massQ = assertQuanta(result.massQ, 'external massQ');
    const energyQ = assertQuanta(result.energyQ, 'external energyQ');
    this.depositEscrow(slot, massQ, energyQ);
    return Object.freeze({ massQ, energyQ });
  }

  escrowMassQ(slot: number): bigint {
    this.assertEscrowSlot(slot);
    return this.state.escrowCommittedMass.toBigInt(slot);
  }

  escrowEnergyQ(slot: number): bigint {
    this.assertEscrowSlot(slot);
    return this.state.escrowCommittedEnergy.toBigInt(slot);
  }

  // --- Committed totals ----------------------------------------------------------------------------

  /** Committed size of the single finite global pool of abiotic matter. */
  get globalAbioticMassQ(): bigint {
    return this.state.acc.toBigInt(Acc.ABIOTIC_COMMITTED);
  }

  get sunEnergyInQ(): bigint {
    return this.state.acc.toBigInt(Acc.CUM_SUN);
  }

  get heatEnergyOutQ(): bigint {
    return this.state.acc.toBigInt(Acc.CUM_HEAT);
  }

  get genesisMassQ(): bigint {
    return this.state.acc.toBigInt(Acc.CUM_GENESIS_MASS);
  }

  get genesisEnergyQ(): bigint {
    return this.state.acc.toBigInt(Acc.CUM_GENESIS_ENERGY);
  }

  get externalMassInQ(): bigint {
    return this.state.acc.toBigInt(Acc.CUM_EXTERNAL_MASS);
  }

  get externalEnergyInQ(): bigint {
    return this.state.acc.toBigInt(Acc.CUM_EXTERNAL_ENERGY);
  }

  /** Cumulative committed flow booked under `reason`. */
  cumulativeFlow(reason: PostingReasonId): ReasonFlow {
    if (!isValidPostingReason(reason)) throw new RangeError(`Unknown posting reason: ${reason}`);
    return Object.freeze({
      massQ: this.state.reasonCumMass.toBigInt(reason),
      energyQ: this.state.reasonCumEnergy.toBigInt(reason),
    });
  }

  /**
   * Flow booked under `reason` by the current active transaction or the last committed
   * transaction; cleared to zero whenever a transaction is aborted.
   */
  lastTransactionFlow(reason: PostingReasonId): ReasonFlow {
    if (!isValidPostingReason(reason)) throw new RangeError(`Unknown posting reason: ${reason}`);
    return Object.freeze({
      massQ: this.state.reasonTxMass.toBigInt(reason),
      energyQ: this.state.reasonTxEnergy.toBigInt(reason),
    });
  }

  // --- I5 audit ----------------------------------------------------------------------------------------

  /**
   * Invariant I5: recomputes the actual committed stocks from every registered store (O(N)) and
   * compares them, exactly, with what the ledger says must exist. Detects any change made
   * outside the transaction path as well as double or missing application of a transaction.
   */
  audit(): EnergyLedgerAudit {
    const L = this.state;
    const acc = L.acc;
    acc.reset(Acc.AUDIT_MASS);
    acc.reset(Acc.AUDIT_ENERGY);
    for (let s = 0; s < L.stores.length; s++) {
      L.stores[s].accumulateCommittedTotals(acc, Acc.AUDIT_MASS, Acc.AUDIT_ENERGY);
    }
    acc.addFrom(Acc.AUDIT_MASS, acc, Acc.ABIOTIC_COMMITTED);
    for (let slot = 0; slot < L.escrowSlots; slot++) {
      acc.addFrom(Acc.AUDIT_MASS, L.escrowCommittedMass, slot);
      acc.addFrom(Acc.AUDIT_ENERGY, L.escrowCommittedEnergy, slot);
    }
    const actualMassQ = acc.toBigInt(Acc.AUDIT_MASS);
    const actualEnergyQ = acc.toBigInt(Acc.AUDIT_ENERGY);
    const expectedMassQ = acc.toBigInt(Acc.CUM_GENESIS_MASS) + acc.toBigInt(Acc.CUM_EXTERNAL_MASS);
    const expectedEnergyQ =
      acc.toBigInt(Acc.CUM_GENESIS_ENERGY) +
      acc.toBigInt(Acc.CUM_EXTERNAL_ENERGY) +
      acc.toBigInt(Acc.CUM_SUN) -
      acc.toBigInt(Acc.CUM_HEAT);
    const massResidualQ = actualMassQ - expectedMassQ;
    const energyResidualQ = actualEnergyQ - expectedEnergyQ;
    return Object.freeze({
      ok: massResidualQ === 0n && energyResidualQ === 0n && L.poisoned === null,
      actualMassQ,
      expectedMassQ,
      massResidualQ,
      actualEnergyQ,
      expectedEnergyQ,
      energyResidualQ,
      committedTxCount: L.committedTxCount,
    });
  }

  /** Throws `EnergyInvariantError('I5')` unless `audit()` reports a zero residual. */
  assertAudit(): EnergyLedgerAudit {
    const report = this.audit();
    if (!report.ok) {
      throw new EnergyInvariantError(
        'I5',
        `ledger audit failed: mass residual ${report.massResidualQ}, energy residual ${report.energyResidualQ} quanta`
      );
    }
    return report;
  }

  /**
   * Verifies Revision 3 stoichiometric densities (`PLANT=3`, `DETRITUS=3`, `CARRION=(5,30) mix`,
   * `ORGANISM_STRUCT=5`, `ORGANISM_RESERVE=30`) on all committed slots of registered stores.
   */
  assertStoichiometry(): void {
    const L = this.state;
    for (let s = 0; s < L.stores.length; s++) {
      const validate = L.stores[s].validateCommittedStoichiometry;
      if (validate) {
        try {
          validate.call(L.stores[s]);
        } catch (error) {
          throw new EnergyInvariantError(
            'I4',
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }
  }

  // --- Journal -------------------------------------------------------------------------------------------

  get journalCapacity(): number {
    return this.state.massJournal?.capacity ?? 0;
  }

  /** Retained committed mass postings in chronological order (empty when journaling is off). */
  getMassJournal(): MassPosting[] {
    const out: MassPosting[] = [];
    this.state.massJournal?.forEach((txId, tick, seq, reason, srcKind, srcId, dstKind, dstId, amount) => {
      out.push(
        Object.freeze({
          txId,
          tick,
          seq,
          reason: reason as PostingReasonId,
          srcKind: srcKind as AccountKindId,
          srcId,
          dstKind: dstKind as AccountKindId,
          dstId,
          massQ: amount,
        })
      );
    });
    return out;
  }

  /** Retained committed energy postings in chronological order (empty when journaling is off). */
  getEnergyJournal(): EnergyPosting[] {
    const out: EnergyPosting[] = [];
    this.state.energyJournal?.forEach((txId, tick, seq, reason, srcKind, srcId, dstKind, dstId, amount) => {
      out.push(
        Object.freeze({
          txId,
          tick,
          seq,
          reason: reason as PostingReasonId,
          srcKind: srcKind as AccountKindId,
          srcId,
          dstKind: dstKind as AccountKindId,
          dstId,
          energyQ: amount,
        })
      );
    });
    return out;
  }

  // --- Memory accounting ------------------------------------------------------------------------------------

  /** Current capacity of each staged posting buffer. */
  get postingCapacity(): number {
    return this.state.massBuffer.capacity;
  }

  /** Exact TypedArray bytes owned by the ledger itself (stores are counted separately). */
  typedArrayBytes(): number {
    const L = this.state;
    return (
      L.acc.byteLength +
      L.reasonTxMass.byteLength +
      L.reasonTxEnergy.byteLength +
      L.reasonCumMass.byteLength +
      L.reasonCumEnergy.byteLength +
      L.escrowCommittedMass.byteLength +
      L.escrowCommittedEnergy.byteLength +
      L.escrowStagedMass.byteLength +
      L.escrowStagedEnergy.byteLength +
      L.massBuffer.typedArrayBytes() +
      L.energyBuffer.typedArrayBytes() +
      (L.massJournal?.typedArrayBytes() ?? 0) +
      (L.energyJournal?.typedArrayBytes() ?? 0)
    );
  }
}

export { LEDGER_ACCUMULATOR_COUNT, POSTING_REASON_COUNT, AccountKind };
