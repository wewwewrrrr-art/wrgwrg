/**
 * WorldEnergyGrid — per-cell mass and energy pools of the biosphere (Phase 2.2.1b / P1).
 *
 * Independent source of truth for energy-economy data. It deliberately does NOT import or write
 * to `WorldGrid` (terrain/climate): `WorldGrid.biomass` is a normalised Float32 field and cannot
 * hold exact quanta. Each cell owns three pools (plant, carrion, detritus), each with a mass and
 * an energy channel, stored in double-buffered Float64 arrays of exact integer quanta.
 *
 * All mutation goes through `EnergyTransaction` postings (staging -> PREPARE -> COMMIT/ABORT).
 * Consumers such as the UI use `createReadView()`, which exposes values and copies but never
 * the underlying buffers.
 */

import { AccountKind, AccountKindId, ACCOUNT_KIND_NAMES } from './energyAccounts';
import { EnergyStoreError, StagedChannelStore, StagedStore } from './stagedStore';
import {
  CarrionFractions,
  ExactAccumulators,
  RHO_DETRITUS,
  RHO_PLANT,
  hasExactDensity,
  isValidCarrionMix,
  splitCarrionMass,
  sumQuanta,
} from './units';

const AK_PLANT = AccountKind.CELL_PLANT;
const AK_CARRION = AccountKind.CELL_CARRION;
const AK_DETRITUS = AccountKind.CELL_DETRITUS;
const PLANT_SAFE_MASS_LIMIT = 3_002_399_751_580_330; // floor(MAX_SAFE_INT / 3)
const CARRION_SAFE_MASS_LIMIT = 300_239_975_158_033; // floor(MAX_SAFE_INT / 30)

export const EnergyPool = Object.freeze({
  PLANT: 0,
  CARRION: 1,
  DETRITUS: 2,
} as const);

export type EnergyPoolId = (typeof EnergyPool)[keyof typeof EnergyPool];

export const ENERGY_POOL_COUNT = 3;
export const ENERGY_POOL_NAMES: readonly string[] = Object.freeze(['PLANT', 'CARRION', 'DETRITUS']);

/** Channel layout: pool * 2 (+1 for energy). */
export const WORLD_ENERGY_CHANNEL_COUNT = ENERGY_POOL_COUNT * 2;

const CHANNEL_IS_ENERGY: readonly boolean[] = [false, true, false, true, false, true];

/**
 * Exact TypedArray bytes per cell: 6 Float64 channels x 2 buffers (96) + dirty flag (1)
 * + dirty list entry (4) + cell version (4).
 */
export const WORLD_ENERGY_GRID_BYTES_PER_CELL = WORLD_ENERGY_CHANNEL_COUNT * 8 * 2 + 1 + 4 + 4;

export const DEFAULT_MAX_ENERGY_GRID_MEMORY_BYTES = 256 * 1024 * 1024;

export interface WorldEnergyGridConfig {
  readonly width: number;
  readonly height: number;
  /** Horizontal wrap-around for coordinate addressing (default: false). */
  readonly wrapX?: boolean;
  /** Maximum permitted TypedArray footprint (default: 256 MiB). */
  readonly maxMemoryBytes?: number;
  readonly storeId?: string;
}

export interface WorldEnergyCellSnapshot {
  readonly cellIndex: number;
  readonly x: number;
  readonly y: number;
  readonly version: number;
  readonly plantMassQ: number;
  readonly plantEnergyQ: number;
  readonly carrionMassQ: number;
  readonly carrionEnergyQ: number;
  readonly detritusMassQ: number;
  readonly detritusEnergyQ: number;
}

export interface WorldEnergyTotals {
  readonly massQ: readonly bigint[];
  readonly energyQ: readonly bigint[];
  readonly totalMassQ: bigint;
  readonly totalEnergyQ: bigint;
}

/**
 * Read-only access to committed energy data for UI and diagnostics. Lives outside
 * `src/sim/biology/`; exposes no buffer references and no mutating method.
 */
export interface WorldEnergyReadView {
  readonly width: number;
  readonly height: number;
  readonly cellCount: number;
  /** Commit version of the grid; changes whenever any cell is committed. */
  version(): number;
  toIndex(x: number, y: number): number;
  massQ(pool: EnergyPoolId, cellIndex: number): number;
  energyQ(pool: EnergyPoolId, cellIndex: number): number;
  cellVersion(cellIndex: number): number;
  cell(cellIndex: number): WorldEnergyCellSnapshot;
  /** Copies one committed channel into a caller-owned buffer of at least `cellCount` elements. */
  copyMass(pool: EnergyPoolId, target: Float64Array): void;
  copyEnergy(pool: EnergyPoolId, target: Float64Array): void;
  totals(): WorldEnergyTotals;
}

function poolOfKind(kind: AccountKindId): EnergyPoolId {
  if (kind === AK_PLANT) return 0;
  if (kind === AK_CARRION) return 1;
  if (kind === AK_DETRITUS) return 2;
  throw new EnergyStoreError(
    `WorldEnergyGrid does not own account kind ${ACCOUNT_KIND_NAMES[kind] ?? kind}`
  );
}

export class WorldEnergyGrid extends StagedStore {
  public readonly storeId: string;
  public readonly ownedKinds: readonly AccountKindId[] = Object.freeze([
    AccountKind.CELL_PLANT,
    AccountKind.CELL_CARRION,
    AccountKind.CELL_DETRITUS,
  ]);
  public readonly width: number;
  public readonly height: number;
  public readonly cellCount: number;
  public readonly wrapX: boolean;
  public readonly maxMemoryBytes: number;

  private readonly store: StagedChannelStore;
  private versionValue = 0;

  constructor(config: WorldEnergyGridConfig) {
    super();
    const maxMemoryBytes = config.maxMemoryBytes ?? DEFAULT_MAX_ENERGY_GRID_MEMORY_BYTES;
    WorldEnergyGrid.assertSafeDimensions(config.width, config.height, maxMemoryBytes);
    this.width = config.width;
    this.height = config.height;
    this.cellCount = config.width * config.height;
    this.wrapX = config.wrapX ?? false;
    this.maxMemoryBytes = maxMemoryBytes;
    this.storeId = config.storeId ?? 'world-energy-grid';
    this.store = new StagedChannelStore(CHANNEL_IS_ENERGY, this.cellCount);
  }

  /** Exact TypedArray footprint of a grid with `cellCount` cells. */
  static estimateBytes(cellCount: number): number {
    return StagedChannelStore.bytesFor(WORLD_ENERGY_CHANNEL_COUNT, cellCount);
  }

  static assertSafeDimensions(width: number, height: number, maxMemoryBytes: number): void {
    if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
      throw new EnergyStoreError(
        `WorldEnergyGrid dimensions must be positive integers, received: ${width} x ${height}`
      );
    }
    if (!Number.isFinite(maxMemoryBytes) || maxMemoryBytes <= 0) {
      throw new EnergyStoreError(`maxMemoryBytes must be finite and > 0, received: ${maxMemoryBytes}`);
    }
    const cells = width * height;
    if (!Number.isSafeInteger(cells) || cells > 0xffffffff) {
      throw new EnergyStoreError(`WorldEnergyGrid cell count ${width} x ${height} exceeds 2^32 - 1`);
    }
    const bytes = WorldEnergyGrid.estimateBytes(cells);
    if (bytes > maxMemoryBytes) {
      throw new EnergyStoreError(
        `WorldEnergyGrid ${width} x ${height} needs ${bytes} bytes, above the ${maxMemoryBytes} byte budget`
      );
    }
  }

  // --- Spatial addressing ------------------------------------------------------------------

  /** Flat cell index of `(x, y)`, or `-1` when out of bounds (x wraps when `wrapX`). */
  toIndex(x: number, y: number): number {
    if (!Number.isInteger(x) || !Number.isInteger(y) || y < 0 || y >= this.height) return -1;
    let cx = x;
    if (this.wrapX) {
      cx = ((x % this.width) + this.width) % this.width;
    } else if (x < 0 || x >= this.width) {
      return -1;
    }
    return y * this.width + cx;
  }

  fromIndex(cellIndex: number): { x: number; y: number } {
    this.store.assertSlot(cellIndex, 'cell index');
    return { x: cellIndex % this.width, y: Math.floor(cellIndex / this.width) };
  }

  private static assertPool(pool: number): void {
    if (!Number.isInteger(pool) || pool < 0 || pool >= ENERGY_POOL_COUNT) {
      throw new EnergyStoreError(`Unknown energy pool: ${pool}`);
    }
  }

  // --- Committed (front) reads ---------------------------------------------------------------

  getMassQ(pool: EnergyPoolId, cellIndex: number): number {
    WorldEnergyGrid.assertPool(pool);
    return this.store.read(pool * 2, cellIndex);
  }

  getEnergyQ(pool: EnergyPoolId, cellIndex: number): number {
    WorldEnergyGrid.assertPool(pool);
    return this.store.read(pool * 2 + 1, cellIndex);
  }

  // --- Staged (back) reads -------------------------------------------------------------------

  getStagedMassQ(pool: EnergyPoolId, cellIndex: number): number {
    WorldEnergyGrid.assertPool(pool);
    return this.store.readStaged(pool * 2, cellIndex);
  }

  getStagedEnergyQ(pool: EnergyPoolId, cellIndex: number): number {
    WorldEnergyGrid.assertPool(pool);
    return this.store.readStaged(pool * 2 + 1, cellIndex);
  }

  /** Fast unchecked scalar staged mass read for validated simulation callers. */
  getStagedMassUnsafe(pool: EnergyPoolId, cellIndex: number): number {
    return this.store.readStagedUnsafe(pool * 2, cellIndex);
  }

  /** Fast unchecked scalar staged energy read for validated simulation callers. */
  getStagedEnergyUnsafe(pool: EnergyPoolId, cellIndex: number): number {
    return this.store.readStagedUnsafe(pool * 2 + 1, cellIndex);
  }

  /** Commit version of the whole grid (0 before the first commit that touched it). */
  get version(): number {
    return this.versionValue;
  }

  /** Version of the last commit that changed `cellIndex` (0 when never changed). */
  cellVersion(cellIndex: number): number {
    return this.store.slotVersionOf(cellIndex);
  }

  /** Number of cells with staged, not yet committed changes. */
  get dirtyCellCount(): number {
    return this.store.dirtyCount;
  }

  get stagedDirtyCount(): number {
    return this.store.dirtyCount;
  }

  isCellDirty(cellIndex: number): boolean {
    return this.store.isDirty(cellIndex);
  }

  /** Copies the indices of dirty cells into `target`; returns the number written. */
  copyDirtyCells(target: Uint32Array): number {
    return this.store.copyDirtySlots(target);
  }

  /** Number of front/back flips performed so far. */
  get swapCount(): number {
    return this.store.swapCount;
  }

  /** Full verification that non-dirty cells are bit-identical in both buffers. */
  isSynchronized(): boolean {
    return this.store.isSynchronized();
  }

  cellSnapshot(cellIndex: number): WorldEnergyCellSnapshot {
    const { x, y } = this.fromIndex(cellIndex);
    return Object.freeze({
      cellIndex,
      x,
      y,
      version: this.store.slotVersionOf(cellIndex),
      plantMassQ: this.store.read(0, cellIndex),
      plantEnergyQ: this.store.read(1, cellIndex),
      carrionMassQ: this.store.read(2, cellIndex),
      carrionEnergyQ: this.store.read(3, cellIndex),
      detritusMassQ: this.store.read(4, cellIndex),
      detritusEnergyQ: this.store.read(5, cellIndex),
    });
  }

  /** Committed structural (`5 EU/MU`) and reserve (`30 EU/MU`) tissue fractions in `CELL_CARRION`. */
  carrionFractions(cellIndex: number): CarrionFractions {
    return splitCarrionMass(this.getMassQ(EnergyPool.CARRION, cellIndex), this.getEnergyQ(EnergyPool.CARRION, cellIndex));
  }

  /** Staged structural (`5 EU/MU`) and reserve (`30 EU/MU`) tissue fractions in `CELL_CARRION`. */
  stagedCarrionFractions(cellIndex: number): CarrionFractions {
    return splitCarrionMass(
      this.getStagedMassQ(EnergyPool.CARRION, cellIndex),
      this.getStagedEnergyQ(EnergyPool.CARRION, cellIndex)
    );
  }

  copyCommittedMass(pool: EnergyPoolId, target: Float64Array): void {
    WorldEnergyGrid.assertPool(pool);
    this.store.copyCommittedChannel(pool * 2, target);
  }

  copyCommittedEnergy(pool: EnergyPoolId, target: Float64Array): void {
    WorldEnergyGrid.assertPool(pool);
    this.store.copyCommittedChannel(pool * 2 + 1, target);
  }

  /** Exact committed totals per pool (allocates; intended for diagnostics and UI). */
  totals(): WorldEnergyTotals {
    const scratch = new Float64Array(this.cellCount);
    const massQ: bigint[] = [];
    const energyQ: bigint[] = [];
    let totalMassQ = 0n;
    let totalEnergyQ = 0n;
    for (let pool = 0; pool < ENERGY_POOL_COUNT; pool++) {
      this.store.copyCommittedChannel(pool * 2, scratch);
      const m = sumQuanta(scratch);
      this.store.copyCommittedChannel(pool * 2 + 1, scratch);
      const e = sumQuanta(scratch);
      massQ.push(m);
      energyQ.push(e);
      totalMassQ += m;
      totalEnergyQ += e;
    }
    return Object.freeze({
      massQ: Object.freeze(massQ),
      energyQ: Object.freeze(energyQ),
      totalMassQ,
      totalEnergyQ,
    });
  }

  /**
   * Creates a frozen read-only adapter. It holds no buffer reference, so it stays valid across
   * front/back flips and offers no path to mutate energy state.
   */
  createReadView(): WorldEnergyReadView {
    const grid = this;
    const view: WorldEnergyReadView = {
      width: grid.width,
      height: grid.height,
      cellCount: grid.cellCount,
      version: () => grid.versionValue,
      toIndex: (x, y) => grid.toIndex(x, y),
      massQ: (pool, cellIndex) => grid.getMassQ(pool, cellIndex),
      energyQ: (pool, cellIndex) => grid.getEnergyQ(pool, cellIndex),
      cellVersion: (cellIndex) => grid.cellVersion(cellIndex),
      cell: (cellIndex) => grid.cellSnapshot(cellIndex),
      copyMass: (pool, target) => grid.copyCommittedMass(pool, target),
      copyEnergy: (pool, target) => grid.copyCommittedEnergy(pool, target),
      totals: () => grid.totals(),
    };
    return Object.freeze(view);
  }

  /**
   * Deep copy of the committed state as an independent, unregistered grid. Throws while a
   * transaction has staged changes, so a clone can never capture half-applied data.
   */
  clone(): WorldEnergyGrid {
    this.store.assertClean('clone WorldEnergyGrid');
    const copy = new WorldEnergyGrid({
      width: this.width,
      height: this.height,
      wrapX: this.wrapX,
      maxMemoryBytes: this.maxMemoryBytes,
      storeId: this.storeId,
    });
    (copy as unknown as { store: StagedChannelStore }).store = this.store.cloneCommitted();
    copy.versionValue = this.versionValue;
    return copy;
  }

  // --- StagedStore contract ------------------------------------------------------------------

  checkDebit(kind: AccountKindId, id: number, energy: boolean, q: number): void {
    const ch = poolOfKind(kind) * 2 + (energy ? 1 : 0);
    const back = this.store.backBuffers()[ch];
    if ((id >>> 0) === id && id < back.length && back[id] >= q) return;
    this.store.checkDebit(ch, id, q, ACCOUNT_KIND_NAMES[kind]);
  }

  checkCredit(kind: AccountKindId, id: number, energy: boolean, q: number): void {
    const ch = poolOfKind(kind) * 2 + (energy ? 1 : 0);
    const back = this.store.backBuffers()[ch];
    if ((id >>> 0) === id && id < back.length && back[id] + q <= Number.MAX_SAFE_INTEGER) return;
    this.store.checkCredit(ch, id, q, ACCOUNT_KIND_NAMES[kind]);
  }

  applyDebit(kind: AccountKindId, id: number, energy: boolean, q: number): void {
    this.store.debit(poolOfKind(kind) * 2 + (energy ? 1 : 0), id, q);
  }

  applyCredit(kind: AccountKindId, id: number, energy: boolean, q: number): void {
    this.store.credit(poolOfKind(kind) * 2 + (energy ? 1 : 0), id, q);
  }

  stagedBalance(kind: AccountKindId, id: number, energy: boolean): number {
    return this.store.readStaged(poolOfKind(kind) * 2 + (energy ? 1 : 0), id);
  }

  committedBalance(kind: AccountKindId, id: number, energy: boolean): number {
    return this.store.read(poolOfKind(kind) * 2 + (energy ? 1 : 0), id);
  }

  validateStaged(): void {
    this.store.validateStaged(this.storeId);
  }

  /** Verifies Revision 3 densities on dirty cells: PLANT=3, DETRITUS=3, CARRION=5/30 mix. */
  validateStagedStoichiometry(): void {
    const n = this.store.dirtyCountValue;
    if (n === 0) return;
    const dirty = this.store.dirtyList;
    const bufs = this.store.back;
    const pmArr = bufs[0];
    const peArr = bufs[1];
    const cmArr = bufs[2];
    const ceArr = bufs[3];
    const dmArr = bufs[4];
    const deArr = bufs[5];
    for (let i = 0; i < n; i++) {
      const cell = dirty[i];
      const pm = pmArr[cell];
      const pe = peArr[cell];
      if (pm <= PLANT_SAFE_MASS_LIMIT) {
        if (pe !== pm * 3) {
          throw new EnergyStoreError(
            `${this.storeId}: CELL_PLANT[${cell}] density drift (${pe} qEU / ${pm} qMU != 3 EU/MU)`
          );
        }
      } else if (!hasExactDensity(pm, pe, RHO_PLANT)) {
        throw new EnergyStoreError(
          `${this.storeId}: CELL_PLANT[${cell}] density drift (${pe} qEU / ${pm} qMU != 3 EU/MU)`
        );
      }
      const cm = cmArr[cell];
      const ce = ceArr[cell];
      if (cm <= CARRION_SAFE_MASS_LIMIT) {
        const minE = cm * 5;
        if (ce < minE || ce > cm * 30 || (ce - minE) % 25 !== 0) {
          throw new EnergyStoreError(
            `${this.storeId}: CELL_CARRION[${cell}] invalid (5, 30) mixture (${ce} qEU / ${cm} qMU)`
          );
        }
      } else if (!isValidCarrionMix(cm, ce)) {
        throw new EnergyStoreError(
          `${this.storeId}: CELL_CARRION[${cell}] invalid (5, 30) mixture (${ce} qEU / ${cm} qMU)`
        );
      }
      const dm = dmArr[cell];
      const de = deArr[cell];
      if (dm <= PLANT_SAFE_MASS_LIMIT) {
        if (de !== dm * 3) {
          throw new EnergyStoreError(
            `${this.storeId}: CELL_DETRITUS[${cell}] density drift (${de} qEU / ${dm} qMU != 3 EU/MU)`
          );
        }
      } else if (!hasExactDensity(dm, de, RHO_DETRITUS)) {
        throw new EnergyStoreError(
          `${this.storeId}: CELL_DETRITUS[${cell}] density drift (${de} qEU / ${dm} qMU != 3 EU/MU)`
        );
      }
    }
  }

  /** Verifies Revision 3 densities on all committed cells. */
  validateCommittedStoichiometry(): void {
    const cap = this.cellCount;
    const bufs = this.store.frontBuffers();
    const pmArr = bufs[0];
    const peArr = bufs[1];
    const cmArr = bufs[2];
    const ceArr = bufs[3];
    const dmArr = bufs[4];
    const deArr = bufs[5];
    for (let cell = 0; cell < cap; cell++) {
      const pm = pmArr[cell];
      const pe = peArr[cell];
      if (pm <= PLANT_SAFE_MASS_LIMIT) {
        if (pe !== pm * 3) {
          throw new EnergyStoreError(
            `${this.storeId}: CELL_PLANT[${cell}] density drift (${pe} qEU / ${pm} qMU != 3 EU/MU)`
          );
        }
      } else if (!hasExactDensity(pm, pe, RHO_PLANT)) {
        throw new EnergyStoreError(
          `${this.storeId}: CELL_PLANT[${cell}] density drift (${pe} qEU / ${pm} qMU != 3 EU/MU)`
        );
      }
      const cm = cmArr[cell];
      const ce = ceArr[cell];
      if (cm <= CARRION_SAFE_MASS_LIMIT) {
        const minE = cm * 5;
        if (ce < minE || ce > cm * 30 || (ce - minE) % 25 !== 0) {
          throw new EnergyStoreError(
            `${this.storeId}: CELL_CARRION[${cell}] invalid (5, 30) mixture (${ce} qEU / ${cm} qMU)`
          );
        }
      } else if (!isValidCarrionMix(cm, ce)) {
        throw new EnergyStoreError(
          `${this.storeId}: CELL_CARRION[${cell}] invalid (5, 30) mixture (${ce} qEU / ${cm} qMU)`
        );
      }
      const dm = dmArr[cell];
      const de = deArr[cell];
      if (dm <= PLANT_SAFE_MASS_LIMIT) {
        if (de !== dm * 3) {
          throw new EnergyStoreError(
            `${this.storeId}: CELL_DETRITUS[${cell}] density drift (${de} qEU / ${dm} qMU != 3 EU/MU)`
          );
        }
      } else if (!hasExactDensity(dm, de, RHO_DETRITUS)) {
        throw new EnergyStoreError(
          `${this.storeId}: CELL_DETRITUS[${cell}] density drift (${de} qEU / ${dm} qMU != 3 EU/MU)`
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
    if (this.store.dirtyCount > 0) {
      this.versionValue = version;
    }
    this.store.commit(version);
  }

  abortStaged(): void {
    this.store.abort();
  }

  /** @internal Exposes underlying channel store for direct validated transaction staging. */
  _getChannelStore(): StagedChannelStore {
    return this.store;
  }

  typedArrayBytes(): number {
    return this.store.typedArrayBytes();
  }

  typedArrayCount(): number {
    return this.store.typedArrayCount();
  }
}
