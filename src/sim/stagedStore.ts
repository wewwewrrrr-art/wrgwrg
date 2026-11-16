/**
 * Double-buffered account storage for the energy economy (Phase 2.2.1b / P1).
 *
 * `StagedStore` is the INTERNAL commit contract of energy transactions. Only in-engine stores
 * implement it; user callbacks and external providers never do. A store must guarantee:
 *   - `check*` methods validate and throw WITHOUT mutating anything;
 *   - `apply*`, `commitStaged` and `abortStaged` never throw, never allocate, and never call
 *     code outside the store;
 *   - committed (front) data changes only inside `commitStaged`.
 * This is what lets `EnergyTransaction.commit()` be atomic: once PREPARE has succeeded there is
 * no operation left that can fail.
 *
 * Buffer discipline (the fix for stale double-buffer data):
 *   INVARIANT S1 — outside the dirty set, `back[slot] === front[slot]` for every channel.
 *   Writes go to `back` and add the slot to the dirty set. COMMIT flips front/back in O(1) and
 *   then immediately copies the freshly committed dirty slots into the new back buffer, so S1
 *   holds again before COMMIT returns. ABORT restores dirty slots of `back` from `front`.
 *   Slots that were not touched are therefore identical in both buffers at every tick boundary
 *   and can never fall back to values from two ticks ago.
 */

import { AccountKind, AccountKindId, ACCOUNT_KIND_NAMES } from './energyAccounts';
import { ExactAccumulators, RHO_RESERVE, RHO_STRUCT, hasExactDensity } from './units';

const LOCAL_MAX_SAFE_INT = Number.MAX_SAFE_INTEGER;
const AK_ORGANISM_STRUCT = AccountKind.ORGANISM_STRUCT;
const AK_ORGANISM_RESERVE = AccountKind.ORGANISM_RESERVE;
const STRUCT_SAFE_MASS_LIMIT = 1_801_439_850_948_198; // floor(MAX_SAFE_INT / 5)
const RESERVE_SAFE_MASS_LIMIT = 300_239_975_158_033; // floor(MAX_SAFE_INT / 30)

export class EnergyStoreError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'EnergyStoreError';
  }
}

export class InsufficientBalanceError extends EnergyStoreError {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientBalanceError';
  }
}

export abstract class StagedStore {
  abstract readonly storeId: string;
  abstract readonly ownedKinds: readonly AccountKindId[];

  /** Throws when the staged balance of the account cannot cover `q`; never mutates. */
  abstract checkDebit(kind: AccountKindId, id: number, energy: boolean, q: number): void;
  /** Throws when crediting `q` is impossible (bad id, overflow); never mutates. */
  abstract checkCredit(kind: AccountKindId, id: number, energy: boolean, q: number): void;
  /** Applies a previously checked debit to the staging buffer. Must not throw. */
  abstract applyDebit(kind: AccountKindId, id: number, energy: boolean, q: number): void;
  /** Applies a previously checked credit to the staging buffer. Must not throw. */
  abstract applyCredit(kind: AccountKindId, id: number, energy: boolean, q: number): void;

  abstract stagedBalance(kind: AccountKindId, id: number, energy: boolean): number;
  abstract committedBalance(kind: AccountKindId, id: number, energy: boolean): number;

  abstract readonly stagedDirtyCount: number;
  /** Throws when any staged value is not a non-negative safe integer (invariant I3). */
  abstract validateStaged(): void;
  /** Adds the exact positive/negative parts of (staged - committed) to four accumulators. */
  abstract accumulateStagedDelta(
    acc: ExactAccumulators,
    massPos: number,
    massNeg: number,
    energyPos: number,
    energyNeg: number
  ): void;
  /** Adds the exact committed totals of the store to two accumulators. */
  abstract accumulateCommittedTotals(acc: ExactAccumulators, massIdx: number, energyIdx: number): void;

  /** Publishes staged data. Must not throw, allocate, or call external code. */
  abstract commitStaged(version: number): void;
  /** Discards staged data. Must not throw, allocate, or call external code. */
  abstract abortStaged(): void;

  /** Optional Revision 3 stoichiometric check on dirty staged slots (throws EnergyStoreError on drift). */
  validateStagedStoichiometry?(): void;
  /** Optional Revision 3 stoichiometric check on all committed slots (throws EnergyStoreError on drift). */
  validateCommittedStoichiometry?(): void;

  /** Exact number of bytes held in TypedArray buffers. */
  abstract typedArrayBytes(): number;
}

/**
 * Dense `channelCount x capacity` matrix of quantum values with front/back buffers,
 * per-slot dirty tracking and per-slot commit versions.
 */
export class StagedChannelStore {
  public readonly channelCount: number;
  private capacityValue: number;
  private readonly channelIsEnergy: Uint8Array;

  private front: Float64Array[];
  private back: Float64Array[];
  private dirtyFlag: Uint8Array;
  private dirtyList: Uint32Array;
  private dirtyCountValue = 0;
  private slotVersion: Uint32Array;
  private swapCountValue = 0;

  constructor(channelIsEnergy: readonly boolean[], capacity: number) {
    if (channelIsEnergy.length < 1) {
      throw new EnergyStoreError('StagedChannelStore needs at least one channel');
    }
    StagedChannelStore.assertCapacity(capacity);
    this.channelCount = channelIsEnergy.length;
    this.capacityValue = capacity;
    this.channelIsEnergy = Uint8Array.from(channelIsEnergy, (e) => (e ? 1 : 0));
    this.front = [];
    this.back = [];
    for (let c = 0; c < this.channelCount; c++) {
      this.front.push(new Float64Array(capacity));
      this.back.push(new Float64Array(capacity));
    }
    this.dirtyFlag = new Uint8Array(capacity);
    this.dirtyList = new Uint32Array(capacity);
    this.slotVersion = new Uint32Array(capacity);
  }

  private static assertCapacity(capacity: number): void {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 0xffffffff) {
      throw new EnergyStoreError(`Store capacity must be an integer in [1, 2^32 - 1], received: ${capacity}`);
    }
  }

  /** Exact TypedArray bytes for a store of the given shape. */
  static bytesFor(channelCount: number, capacity: number): number {
    // front + back Float64 channels, dirty flag (1), dirty list (4), slot version (4), channel kinds
    return channelCount * capacity * 8 * 2 + capacity * (1 + 4 + 4) + channelCount;
  }

  get capacity(): number {
    return this.capacityValue;
  }

  get dirtyCount(): number {
    return this.dirtyCountValue;
  }

  /** Number of front/back flips performed so far. */
  get swapCount(): number {
    return this.swapCountValue;
  }

  typedArrayBytes(): number {
    let bytes =
      this.dirtyFlag.byteLength +
      this.dirtyList.byteLength +
      this.slotVersion.byteLength +
      this.channelIsEnergy.byteLength;
    for (let c = 0; c < this.channelCount; c++) {
      bytes += this.front[c].byteLength + this.back[c].byteLength;
    }
    return bytes;
  }

  /** Number of TypedArray objects owned by this store (for JS-overhead estimates). */
  typedArrayCount(): number {
    return this.channelCount * 2 + 4;
  }

  private assertChannel(channel: number): void {
    if ((channel >>> 0) !== channel || channel >= this.channelCount) {
      throw new EnergyStoreError(`Channel out of range: ${channel}`);
    }
  }

  assertSlot(slot: number, label = 'slot'): void {
    if ((slot >>> 0) !== slot || slot >= this.capacityValue) {
      throw new EnergyStoreError(`${label} out of range [0, ${this.capacityValue}): ${slot}`);
    }
  }

  /** Committed value. */
  read(channel: number, slot: number): number {
    this.assertChannel(channel);
    this.assertSlot(slot);
    return this.front[channel][slot];
  }

  /** Staged (in-transaction) value. */
  readStaged(channel: number, slot: number): number {
    this.assertChannel(channel);
    this.assertSlot(slot);
    return this.back[channel][slot];
  }

  /** Unchecked staged read for validated in-engine callers. */
  readStagedUnsafe(channel: number, slot: number): number {
    return this.back[channel][slot];
  }

  /** @internal Raw buffer references for sibling store validation. */
  dirtyListBuffer(): Uint32Array {
    return this.dirtyList;
  }

  /** @internal Raw back channel arrays for sibling store validation. */
  backBuffers(): readonly Float64Array[] {
    return this.back;
  }

  /** @internal Raw front channel arrays for sibling store validation. */
  frontBuffers(): readonly Float64Array[] {
    return this.front;
  }

  isDirty(slot: number): boolean {
    this.assertSlot(slot);
    return this.dirtyFlag[slot] === 1;
  }

  /** Copies the current dirty slot indices into `target`; returns how many were written. */
  copyDirtySlots(target: Uint32Array): number {
    const n = Math.min(target.length, this.dirtyCountValue);
    for (let i = 0; i < n; i++) target[i] = this.dirtyList[i];
    return n;
  }

  /** Visits every dirty slot in first-touch order without allocating. */
  forEachDirtySlot(visitor: (slot: number) => void): void {
    for (let i = 0; i < this.dirtyCountValue; i++) {
      visitor(this.dirtyList[i]);
    }
  }

  slotVersionOf(slot: number): number {
    this.assertSlot(slot);
    return this.slotVersion[slot];
  }

  checkDebit(channel: number, slot: number, q: number, label: string): void {
    if ((channel >>> 0) !== channel || channel >= this.channelCount) {
      throw new EnergyStoreError(`Channel out of range: ${channel}`);
    }
    if ((slot >>> 0) !== slot || slot >= this.capacityValue) {
      throw new EnergyStoreError(`${label} id out of range [0, ${this.capacityValue}): ${slot}`);
    }
    const have = this.back[channel][slot];
    if (have < q) {
      throw new InsufficientBalanceError(
        `${label}[${slot}] holds ${have} quanta, cannot debit ${q}`
      );
    }
  }

  checkCredit(channel: number, slot: number, q: number, label: string): void {
    if ((channel >>> 0) !== channel || channel >= this.channelCount) {
      throw new EnergyStoreError(`Channel out of range: ${channel}`);
    }
    if ((slot >>> 0) !== slot || slot >= this.capacityValue) {
      throw new EnergyStoreError(`${label} id out of range [0, ${this.capacityValue}): ${slot}`);
    }
    if (this.back[channel][slot] + q > LOCAL_MAX_SAFE_INT) {
      throw new EnergyStoreError(`${label}[${slot}] would exceed 2^53 - 1 quanta`);
    }
  }

  private markDirty(slot: number): void {
    if (this.dirtyFlag[slot] === 0) {
      this.dirtyFlag[slot] = 1;
      this.dirtyList[this.dirtyCountValue++] = slot;
    }
  }

  /** Unchecked staged debit (caller has run `checkDebit`). */
  debit(channel: number, slot: number, q: number): void {
    if (this.dirtyFlag[slot] === 0) {
      this.dirtyFlag[slot] = 1;
      this.dirtyList[this.dirtyCountValue++] = slot;
    }
    this.back[channel][slot] -= q;
  }

  /** Unchecked staged credit (caller has run `checkCredit`). */
  credit(channel: number, slot: number, q: number): void {
    if (this.dirtyFlag[slot] === 0) {
      this.dirtyFlag[slot] = 1;
      this.dirtyList[this.dirtyCountValue++] = slot;
    }
    this.back[channel][slot] += q;
  }

  validateStaged(label: string): void {
    const n = this.dirtyCountValue;
    const dirty = this.dirtyList;
    for (let c = 0; c < this.channelCount; c++) {
      const back = this.back[c];
      for (let i = 0; i < n; i++) {
        const slot = dirty[i];
        const v = back[slot];
        if (!(v >= 0) || v > LOCAL_MAX_SAFE_INT || Math.floor(v) !== v) {
          throw new EnergyStoreError(
            `${label}: staged value of channel ${c} slot ${slot} is not a valid quantum count: ${v}`
          );
        }
      }
    }
  }

  accumulateStagedDelta(
    acc: ExactAccumulators,
    massPos: number,
    massNeg: number,
    energyPos: number,
    energyNeg: number
  ): void {
    const n = this.dirtyCountValue;
    if (n === 0) return;
    const dirty = this.dirtyList;
    for (let c = 0; c < this.channelCount; c++) {
      const isEnergy = this.channelIsEnergy[c] === 1;
      const pos = isEnergy ? energyPos : massPos;
      const neg = isEnergy ? energyNeg : massNeg;
      const front = this.front[c];
      const back = this.back[c];
      for (let i = 0; i < n; i++) {
        const slot = dirty[i];
        const d = back[slot] - front[slot];
        if (d > 0) acc.addFast(pos, d);
        else if (d < 0) acc.addFast(neg, -d);
      }
    }
  }

  accumulateCommittedTotals(acc: ExactAccumulators, massIdx: number, energyIdx: number): void {
    for (let c = 0; c < this.channelCount; c++) {
      const idx = this.channelIsEnergy[c] === 1 ? energyIdx : massIdx;
      const front = this.front[c];
      for (let s = 0; s < this.capacityValue; s++) {
        acc.add(idx, front[s]);
      }
    }
  }

  /**
   * Publishes staged values: O(1) front/back flip, then re-synchronisation of the new back
   * buffer for exactly the dirty slots. No allocation, cannot throw.
   */
  commit(version: number): void {
    const n = this.dirtyCountValue;
    if (n === 0) return;
    const newFront = this.back;
    const newBack = this.front;
    this.front = newFront;
    this.back = newBack;
    this.swapCountValue++;

    const v = version >>> 0;
    if (n === this.capacityValue) {
      for (let c = 0; c < this.channelCount; c++) {
        newBack[c].set(newFront[c]);
      }
      this.slotVersion.fill(v);
      this.dirtyFlag.fill(0);
    } else {
      for (let c = 0; c < this.channelCount; c++) {
        const src = newFront[c];
        const dst = newBack[c];
        for (let i = 0; i < n; i++) {
          const slot = this.dirtyList[i];
          dst[slot] = src[slot];
        }
      }
      for (let i = 0; i < n; i++) {
        const slot = this.dirtyList[i];
        this.slotVersion[slot] = v;
        this.dirtyFlag[slot] = 0;
      }
    }
    this.dirtyCountValue = 0;
  }

  /** Discards staged values by restoring dirty slots from the committed buffer. */
  abort(): void {
    const n = this.dirtyCountValue;
    for (let c = 0; c < this.channelCount; c++) {
      const src = this.front[c];
      const dst = this.back[c];
      for (let i = 0; i < n; i++) {
        const slot = this.dirtyList[i];
        dst[slot] = src[slot];
      }
    }
    for (let i = 0; i < n; i++) {
      this.dirtyFlag[this.dirtyList[i]] = 0;
    }
    this.dirtyCountValue = 0;
  }

  /**
   * Full O(channels x capacity) verification of invariant S1: every non-dirty slot is
   * bit-identical in both buffers. Intended for tests and audits.
   */
  isSynchronized(): boolean {
    for (let c = 0; c < this.channelCount; c++) {
      const front = this.front[c];
      const back = this.back[c];
      for (let s = 0; s < this.capacityValue; s++) {
        if (this.dirtyFlag[s] === 0 && !Object.is(front[s], back[s])) return false;
      }
    }
    return true;
  }

  /** Copies one committed channel into a caller-owned buffer. */
  copyCommittedChannel(channel: number, target: Float64Array): void {
    this.assertChannel(channel);
    if (target.length < this.capacityValue) {
      throw new EnergyStoreError(
        `Target buffer too small: ${target.length} < ${this.capacityValue}`
      );
    }
    target.set(this.front[channel]);
  }

  /** Independent deep copy of the committed state (requires no staged changes). */
  cloneCommitted(): StagedChannelStore {
    this.assertClean('clone');
    const flags: boolean[] = [];
    for (let c = 0; c < this.channelCount; c++) flags.push(this.channelIsEnergy[c] === 1);
    const copy = new StagedChannelStore(flags, this.capacityValue);
    for (let c = 0; c < this.channelCount; c++) {
      copy.front[c].set(this.front[c]);
      copy.back[c].set(this.front[c]);
    }
    copy.slotVersion.set(this.slotVersion);
    return copy;
  }

  assertClean(operation: string): void {
    if (this.dirtyCountValue !== 0) {
      throw new EnergyStoreError(`Cannot ${operation} while staged changes are pending`);
    }
  }

  /** Grows capacity (never shrinks). Only legal between transactions; preserves all data. */
  grow(newCapacity: number): void {
    this.assertClean('grow');
    StagedChannelStore.assertCapacity(newCapacity);
    if (newCapacity <= this.capacityValue) return;
    const oldCapacity = this.capacityValue;
    for (let c = 0; c < this.channelCount; c++) {
      const f = new Float64Array(newCapacity);
      f.set(this.front[c]);
      const b = new Float64Array(newCapacity);
      b.set(this.front[c]);
      this.front[c] = f;
      this.back[c] = b;
    }
    this.dirtyFlag = new Uint8Array(newCapacity);
    this.dirtyList = new Uint32Array(newCapacity);
    const versions = new Uint32Array(newCapacity);
    versions.set(this.slotVersion.subarray(0, oldCapacity));
    this.slotVersion = versions;
    this.capacityValue = newCapacity;
  }
}

/** Channels of `EntityEnergyStore`. */
export const EntityChannel = Object.freeze({
  STRUCT_MASS: 0,
  STRUCT_ENERGY: 1,
  RESERVE_MASS: 2,
  RESERVE_ENERGY: 3,
} as const);

export const ENTITY_CHANNEL_COUNT = 4;

const ENTITY_CHANNEL_IS_ENERGY: readonly boolean[] = [false, true, false, true];

/**
 * Double-buffered structural/reserve mass and energy accounts for up to `capacity` entities
 * (organisms). Slot allocation and the organism-id -> slot mapping belong to the future biology
 * integration; this store only provides exact, transactional account storage.
 */
export class EntityEnergyStore extends StagedStore {
  public readonly storeId: string;
  public readonly ownedKinds: readonly AccountKindId[] = Object.freeze([
    AccountKind.ORGANISM_STRUCT,
    AccountKind.ORGANISM_RESERVE,
  ]);
  public readonly maxMemoryBytes: number;
  private readonly store: StagedChannelStore;

  constructor(capacity: number, options: { storeId?: string; maxMemoryBytes?: number } = {}) {
    super();
    this.storeId = options.storeId ?? 'entity-energy';
    this.maxMemoryBytes = options.maxMemoryBytes ?? 512 * 1024 * 1024;
    EntityEnergyStore.assertBudget(capacity, this.maxMemoryBytes);
    this.store = new StagedChannelStore(ENTITY_CHANNEL_IS_ENERGY, capacity);
  }

  static estimateBytes(capacity: number): number {
    return StagedChannelStore.bytesFor(ENTITY_CHANNEL_COUNT, capacity);
  }

  private static assertBudget(capacity: number, maxMemoryBytes: number): void {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new EnergyStoreError(`Entity capacity must be a positive integer, received: ${capacity}`);
    }
    const bytes = EntityEnergyStore.estimateBytes(capacity);
    if (bytes > maxMemoryBytes) {
      throw new EnergyStoreError(
        `EntityEnergyStore for ${capacity} entities needs ${bytes} bytes, above the ${maxMemoryBytes} byte budget`
      );
    }
  }

  get capacity(): number {
    return this.store.capacity;
  }

  get stagedDirtyCount(): number {
    return this.store.dirtyCount;
  }

  get swapCount(): number {
    return this.store.swapCount;
  }

  private channel(kind: AccountKindId, energy: boolean): number {
    if (kind === AK_ORGANISM_STRUCT) {
      return energy ? 1 : 0;
    }
    if (kind === AK_ORGANISM_RESERVE) {
      return energy ? 3 : 2;
    }
    throw new EnergyStoreError(`EntityEnergyStore does not own account kind ${ACCOUNT_KIND_NAMES[kind] ?? kind}`);
  }

  checkDebit(kind: AccountKindId, id: number, energy: boolean, q: number): void {
    const ch = kind === AK_ORGANISM_STRUCT ? (energy ? 1 : 0) : kind === AK_ORGANISM_RESERVE ? (energy ? 3 : 2) : this.channel(kind, energy);
    const back = this.store.backBuffers()[ch];
    if ((id >>> 0) === id && id < back.length && back[id] >= q) return;
    this.store.checkDebit(ch, id, q, ACCOUNT_KIND_NAMES[kind]);
  }

  checkCredit(kind: AccountKindId, id: number, energy: boolean, q: number): void {
    const ch = kind === AK_ORGANISM_STRUCT ? (energy ? 1 : 0) : kind === AK_ORGANISM_RESERVE ? (energy ? 3 : 2) : this.channel(kind, energy);
    const back = this.store.backBuffers()[ch];
    if ((id >>> 0) === id && id < back.length && back[id] + q <= LOCAL_MAX_SAFE_INT) return;
    this.store.checkCredit(ch, id, q, ACCOUNT_KIND_NAMES[kind]);
  }

  applyDebit(kind: AccountKindId, id: number, energy: boolean, q: number): void {
    const ch = kind === AK_ORGANISM_STRUCT ? (energy ? 1 : 0) : kind === AK_ORGANISM_RESERVE ? (energy ? 3 : 2) : this.channel(kind, energy);
    this.store.debit(ch, id, q);
  }

  applyCredit(kind: AccountKindId, id: number, energy: boolean, q: number): void {
    const ch = kind === AK_ORGANISM_STRUCT ? (energy ? 1 : 0) : kind === AK_ORGANISM_RESERVE ? (energy ? 3 : 2) : this.channel(kind, energy);
    this.store.credit(ch, id, q);
  }

  stagedBalance(kind: AccountKindId, id: number, energy: boolean): number {
    return this.store.readStaged(this.channel(kind, energy), id);
  }

  committedBalance(kind: AccountKindId, id: number, energy: boolean): number {
    return this.store.read(this.channel(kind, energy), id);
  }

  structMassQ(slot: number): number {
    return this.store.read(0, slot);
  }

  structEnergyQ(slot: number): number {
    return this.store.read(1, slot);
  }

  reserveMassQ(slot: number): number {
    return this.store.read(2, slot);
  }

  reserveEnergyQ(slot: number): number {
    return this.store.read(3, slot);
  }

  /** Fast unchecked staged channel read for in-engine simulation loops (scalars only). */
  stagedStructMassUnsafe(slot: number): number {
    return this.store.readStagedUnsafe(0, slot);
  }

  /** Fast unchecked staged reserve mass read for in-engine simulation loops (scalars only). */
  stagedReserveMassUnsafe(slot: number): number {
    return this.store.readStagedUnsafe(2, slot);
  }

  slotVersionOf(slot: number): number {
    return this.store.slotVersionOf(slot);
  }

  validateStaged(): void {
    this.store.validateStaged(this.storeId);
  }

  /** Verifies Revision 3 densities on dirty slots: STRUCT = 5 EU/MU, RESERVE = 30 EU/MU. */
  validateStagedStoichiometry(): void {
    const n = this.store.dirtyCount;
    if (n === 0) return;
    const dirty = this.store.dirtyListBuffer();
    const bufs = this.store.backBuffers();
    const smArr = bufs[0];
    const seArr = bufs[1];
    const rmArr = bufs[2];
    const reArr = bufs[3];
    for (let i = 0; i < n; i++) {
      const slot = dirty[i];
      const sm = smArr[slot];
      const se = seArr[slot];
      if (sm <= STRUCT_SAFE_MASS_LIMIT) {
        if (se !== sm * 5) {
          throw new EnergyStoreError(
            `${this.storeId}: ORGANISM_STRUCT[${slot}] density drift (${se} qEU / ${sm} qMU != 5 EU/MU)`
          );
        }
      } else if (!hasExactDensity(sm, se, RHO_STRUCT)) {
        throw new EnergyStoreError(
          `${this.storeId}: ORGANISM_STRUCT[${slot}] density drift (${se} qEU / ${sm} qMU != 5 EU/MU)`
        );
      }
      const rm = rmArr[slot];
      const re = reArr[slot];
      if (rm <= RESERVE_SAFE_MASS_LIMIT) {
        if (re !== rm * 30) {
          throw new EnergyStoreError(
            `${this.storeId}: ORGANISM_RESERVE[${slot}] density drift (${re} qEU / ${rm} qMU != 30 EU/MU)`
          );
        }
      } else if (!hasExactDensity(rm, re, RHO_RESERVE)) {
        throw new EnergyStoreError(
          `${this.storeId}: ORGANISM_RESERVE[${slot}] density drift (${re} qEU / ${rm} qMU != 30 EU/MU)`
        );
      }
    }
  }

  /** Verifies Revision 3 densities on all committed entity slots. */
  validateCommittedStoichiometry(): void {
    const cap = this.store.capacity;
    const bufs = this.store.frontBuffers();
    const smArr = bufs[0];
    const seArr = bufs[1];
    const rmArr = bufs[2];
    const reArr = bufs[3];
    for (let slot = 0; slot < cap; slot++) {
      const sm = smArr[slot];
      const se = seArr[slot];
      if (sm <= STRUCT_SAFE_MASS_LIMIT) {
        if (se !== sm * 5) {
          throw new EnergyStoreError(
            `${this.storeId}: ORGANISM_STRUCT[${slot}] density drift (${se} qEU / ${sm} qMU != 5 EU/MU)`
          );
        }
      } else if (!hasExactDensity(sm, se, RHO_STRUCT)) {
        throw new EnergyStoreError(
          `${this.storeId}: ORGANISM_STRUCT[${slot}] density drift (${se} qEU / ${sm} qMU != 5 EU/MU)`
        );
      }
      const rm = rmArr[slot];
      const re = reArr[slot];
      if (rm <= RESERVE_SAFE_MASS_LIMIT) {
        if (re !== rm * 30) {
          throw new EnergyStoreError(
            `${this.storeId}: ORGANISM_RESERVE[${slot}] density drift (${re} qEU / ${rm} qMU != 30 EU/MU)`
          );
        }
      } else if (!hasExactDensity(rm, re, RHO_RESERVE)) {
        throw new EnergyStoreError(
          `${this.storeId}: ORGANISM_RESERVE[${slot}] density drift (${re} qEU / ${rm} qMU != 30 EU/MU)`
        );
      }
    }
  }

  accumulateStagedDelta(
    acc: ExactAccumulators,
    massPos: number,
    massNeg: number,
    energyPos: number,
    energyNeg: number
  ): void {
    this.store.accumulateStagedDelta(acc, massPos, massNeg, energyPos, energyNeg);
  }

  accumulateCommittedTotals(acc: ExactAccumulators, massIdx: number, energyIdx: number): void {
    this.store.accumulateCommittedTotals(acc, massIdx, energyIdx);
  }

  commitStaged(version: number): void {
    this.store.commit(version);
  }

  abortStaged(): void {
    this.store.abort();
  }

  isSynchronized(): boolean {
    return this.store.isSynchronized();
  }

  /** Grows the store between transactions, preserving committed data. */
  ensureCapacity(capacity: number): void {
    if (capacity <= this.store.capacity) return;
    EntityEnergyStore.assertBudget(capacity, this.maxMemoryBytes);
    this.store.grow(capacity);
  }

  typedArrayBytes(): number {
    return this.store.typedArrayBytes();
  }

  typedArrayCount(): number {
    return this.store.typedArrayCount();
  }
}
