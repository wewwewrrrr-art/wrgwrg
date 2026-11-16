import { safeAdd } from '../detMath';
import { AccountKind, AccountKindId } from '../energyAccounts';
import { EnergyLedger, ExternalWithdrawal } from '../energyLedger';
import { EnergyTransaction } from '../energyTransaction';
import { EntityEnergyStore } from '../stagedStore';
import {
  EnergyQ,
  MassQ,
  RHO_DETRITUS,
  RHO_PLANT,
  assertQuanta,
  energyOfMass,
  planCarrionConsumption,
  resolveContention,
  scaleByRatio,
} from '../units';
import { EnergyPool, EnergyPoolId, WorldEnergyGrid } from '../worldEnergyGrid';
import {
  ExtendedFeedingPlan,
  computeReserveHeadroomMassQ,
  planProportionalPreyBite,
  stageFeeding,
  stagePreyPredation,
} from './trophicNutrition';
import { TrophicProfile } from './trophicProfile';

export type FoodSourcePoolKind = 'plant' | 'carrion' | 'detritus' | 'prey';

export class NonConservingFoodProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonConservingFoodProviderError';
  }
}

export class FoodSourceReservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FoodSourceReservationError';
  }
}

export interface FoodResourceInfo {
  readonly poolKind: FoodSourcePoolKind;
  readonly cellIndex: number;
  readonly massQ: MassQ;
  readonly energyQ: EnergyQ;
  readonly isPhysicallyClosed: boolean;
}

export interface FoodReservation {
  readonly reservationId: string;
  readonly sourceId: string;
  readonly consumerId: number;
  readonly poolKind: FoodSourcePoolKind;
  readonly cellIndex: number;
  readonly reservedMassQ: MassQ;
  readonly reservedEnergyQ: EnergyQ;
  readonly tick: number;
}

/**
 * Transactional food-source contract (Phase 2.2.1b / P2).
 *
 * Separates inspection, lock/reservation, external pull/commit, and rollback so that
 * `EnergyTransaction.commit()` never invokes callbacks or external IO.
 */
export interface TransactionalFoodSource {
  readonly sourceId: string;
  readonly poolKind: FoodSourcePoolKind;
  readonly isPhysicallyClosed: boolean;

  inspect(cellIndex: number, tx?: EnergyTransaction): FoodResourceInfo;
  reserve(
    consumerId: number,
    cellIndex: number,
    requestedMassQ: MassQ,
    tick: number,
    tx?: EnergyTransaction
  ): FoodReservation;
  commitReservation(reservation: FoodReservation): ExternalWithdrawal;
  abortReservation(reservation: FoodReservation): void;
}

export interface ConservationCheckTarget {
  readonly isPhysicallyClosed?: boolean;
  readonly conservationMode?: string;
}

/**
 * Enforces P2 conservation policy: when `strictConservation` is true (default), rejects any legacy
 * non-conserving external `FoodProvider` with `NonConservingFoodProviderError`.
 */
export function assertPhysicallyClosedFoodProvider(
  provider: ConservationCheckTarget,
  strictConservation = true
): void {
  if (!strictConservation) return;
  if (!provider || provider.isPhysicallyClosed !== true) {
    throw new NonConservingFoodProviderError(
      `Food provider rejected in strict conservation mode (isPhysicallyClosed=${String(provider?.isPhysicallyClosed)}, mode=${String(provider?.conservationMode ?? 'unknown')})`
    );
  }
}

interface PendingReservationRecord {
  readonly reservation: FoodReservation;
  status: 'PENDING' | 'COMMITTED' | 'ABORTED';
}

function accountKindForGridPool(poolKind: 'plant' | 'carrion' | 'detritus'): {
  kind: AccountKindId;
  pool: EnergyPoolId;
} {
  switch (poolKind) {
    case 'plant':
      return { kind: AccountKind.CELL_PLANT, pool: EnergyPool.PLANT };
    case 'carrion':
      return { kind: AccountKind.CELL_CARRION, pool: EnergyPool.CARRION };
    case 'detritus':
      return { kind: AccountKind.CELL_DETRITUS, pool: EnergyPool.DETRITUS };
  }
}

/**
 * In-engine `TransactionalFoodSource` backed by a `WorldEnergyGrid` pool (`plant`, `carrion`, or `detritus`).
 * Tracks active reservations cleanly while delegating actual balance mutation to `EnergyTransaction`.
 */
export class GridPoolFoodSource implements TransactionalFoodSource {
  public readonly sourceId: string;
  public readonly poolKind: 'plant' | 'carrion' | 'detritus';
  public readonly isPhysicallyClosed = true;

  private readonly grid: WorldEnergyGrid;
  private readonly accountKind: AccountKindId;
  private readonly poolId: EnergyPoolId;
  private readonly reservations = new Map<string, PendingReservationRecord>();
  private readonly cellReservedMass = new Map<number, MassQ>();
  private readonly cellReservedEnergy = new Map<number, EnergyQ>();
  private nextResSeq = 1;

  constructor(grid: WorldEnergyGrid, poolKind: 'plant' | 'carrion' | 'detritus', sourceId?: string) {
    this.grid = grid;
    this.poolKind = poolKind;
    this.sourceId = sourceId ?? `grid-${poolKind}`;
    const mapped = accountKindForGridPool(poolKind);
    this.accountKind = mapped.kind;
    this.poolId = mapped.pool;
  }

  private assertCell(cellIndex: number): void {
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= this.grid.cellCount) {
      throw new RangeError(`Cell index out of bounds [0, ${this.grid.cellCount}): ${cellIndex}`);
    }
  }

  private readBaseMassEnergy(cellIndex: number, tx?: EnergyTransaction): { massQ: MassQ; energyQ: EnergyQ } {
    if (tx && (tx.state === 'ACTIVE' || tx.state === 'PREPARED')) {
      return {
        massQ: Number(tx.stagedMassQ(this.accountKind, cellIndex)),
        energyQ: Number(tx.stagedEnergyQ(this.accountKind, cellIndex)),
      };
    }
    return {
      massQ: this.grid.getMassQ(this.poolId, cellIndex),
      energyQ: this.grid.getEnergyQ(this.poolId, cellIndex),
    };
  }

  inspect(cellIndex: number, tx?: EnergyTransaction): FoodResourceInfo {
    this.assertCell(cellIndex);
    const base = this.readBaseMassEnergy(cellIndex, tx);
    const lockedMass = this.cellReservedMass.get(cellIndex) ?? 0;
    const lockedEnergy = this.cellReservedEnergy.get(cellIndex) ?? 0;
    return Object.freeze({
      poolKind: this.poolKind,
      cellIndex,
      massQ: base.massQ > lockedMass ? base.massQ - lockedMass : 0,
      energyQ: base.energyQ > lockedEnergy ? base.energyQ - lockedEnergy : 0,
      isPhysicallyClosed: true,
    });
  }

  reserve(
    consumerId: number,
    cellIndex: number,
    requestedMassQ: MassQ,
    tick: number,
    tx?: EnergyTransaction
  ): FoodReservation {
    this.assertCell(cellIndex);
    if (!Number.isSafeInteger(consumerId) || consumerId < 0) {
      throw new RangeError(`consumerId must be a non-negative safe integer, received: ${consumerId}`);
    }
    assertQuanta(requestedMassQ, 'requestedMassQ');
    if (!Number.isSafeInteger(tick) || tick < 0) {
      throw new RangeError(`tick must be a non-negative integer, received: ${tick}`);
    }

    const avail = this.inspect(cellIndex, tx);
    const grantedMassQ = Math.min(requestedMassQ, avail.massQ);
    let grantedEnergyQ = 0;
    if (grantedMassQ > 0) {
      if (this.poolKind === 'plant') {
        grantedEnergyQ = energyOfMass(grantedMassQ, RHO_PLANT);
      } else if (this.poolKind === 'detritus') {
        grantedEnergyQ = energyOfMass(grantedMassQ, RHO_DETRITUS);
      } else {
        grantedEnergyQ = planCarrionConsumption(avail.massQ, avail.energyQ, grantedMassQ).totalEnergyQ;
      }
    }

    const reservation: FoodReservation = Object.freeze({
      reservationId: `${this.sourceId}#${this.nextResSeq++}`,
      sourceId: this.sourceId,
      consumerId,
      poolKind: this.poolKind,
      cellIndex,
      reservedMassQ: grantedMassQ,
      reservedEnergyQ: grantedEnergyQ,
      tick,
    });

    this.reservations.set(reservation.reservationId, { reservation, status: 'PENDING' });
    this.cellReservedMass.set(cellIndex, (this.cellReservedMass.get(cellIndex) ?? 0) + grantedMassQ);
    this.cellReservedEnergy.set(cellIndex, (this.cellReservedEnergy.get(cellIndex) ?? 0) + grantedEnergyQ);
    return reservation;
  }

  private releaseLock(res: FoodReservation): void {
    const nextMass = (this.cellReservedMass.get(res.cellIndex) ?? 0) - res.reservedMassQ;
    const nextEnergy = (this.cellReservedEnergy.get(res.cellIndex) ?? 0) - res.reservedEnergyQ;
    if (nextMass <= 0) this.cellReservedMass.delete(res.cellIndex);
    else this.cellReservedMass.set(res.cellIndex, nextMass);
    if (nextEnergy <= 0) this.cellReservedEnergy.delete(res.cellIndex);
    else this.cellReservedEnergy.set(res.cellIndex, nextEnergy);
  }

  commitReservation(reservation: FoodReservation): ExternalWithdrawal {
    const rec = this.reservations.get(reservation.reservationId);
    if (!rec) {
      throw new FoodSourceReservationError(`Unknown reservation: ${reservation.reservationId}`);
    }
    if (rec.status !== 'PENDING') {
      throw new FoodSourceReservationError(
        `Reservation ${reservation.reservationId} is ${rec.status}, expected PENDING`
      );
    }
    rec.status = 'COMMITTED';
    this.releaseLock(reservation);
    return Object.freeze({
      massQ: reservation.reservedMassQ,
      energyQ: reservation.reservedEnergyQ,
    });
  }

  abortReservation(reservation: FoodReservation): void {
    const rec = this.reservations.get(reservation.reservationId);
    if (!rec) {
      throw new FoodSourceReservationError(`Unknown reservation: ${reservation.reservationId}`);
    }
    if (rec.status === 'ABORTED') return;
    if (rec.status === 'COMMITTED') {
      throw new FoodSourceReservationError(
        `Cannot abort already committed reservation: ${reservation.reservationId}`
      );
    }
    rec.status = 'ABORTED';
    this.releaseLock(reservation);
  }
}

export interface ExternalEscrowFoodSourceConfig {
  readonly sourceId?: string;
  readonly poolKind?: FoodSourcePoolKind;
  readonly cellCount: number;
  readonly initialCellMassQ?: readonly MassQ[];
  readonly initialCellEnergyQ?: readonly EnergyQ[];
  /** Optional fault hook invoked inside `commitReservation` (for rollback/atomicity tests). */
  readonly beforeCommit?: (reservation: FoodReservation) => void;
}

/**
 * Physically closed external quantized food inventory that integrates with `EnergyLedger` via
 * `ESCROW` deposits before `PREPARE`.
 *
 * Guarantees exact mass/energy conservation across:
 *   `remainingInventory + pendingReserved + committedWithdrawn == initialTotal`.
 */
export class ExternalEscrowFoodSource implements TransactionalFoodSource {
  public readonly sourceId: string;
  public readonly poolKind: FoodSourcePoolKind;
  public readonly isPhysicallyClosed = true;
  public readonly cellCount: number;

  private readonly freeMass: Float64Array;
  private readonly freeEnergy: Float64Array;
  private readonly reservations = new Map<string, PendingReservationRecord>();
  private readonly beforeCommitHook?: (reservation: FoodReservation) => void;
  private nextResSeq = 1;

  public readonly initialTotalMassQ: bigint;
  public readonly initialTotalEnergyQ: bigint;
  private committedWithdrawnMass = 0n;
  private committedWithdrawnEnergy = 0n;
  private pendingReservedMass = 0n;
  private pendingReservedEnergy = 0n;

  constructor(config: ExternalEscrowFoodSourceConfig) {
    if (!Number.isSafeInteger(config.cellCount) || config.cellCount < 1) {
      throw new RangeError(`cellCount must be a positive integer, received: ${config.cellCount}`);
    }
    this.cellCount = config.cellCount;
    this.sourceId = config.sourceId ?? 'external-escrow-food';
    this.poolKind = config.poolKind ?? 'prey';
    this.freeMass = new Float64Array(config.cellCount);
    this.freeEnergy = new Float64Array(config.cellCount);
    this.beforeCommitHook = config.beforeCommit;

    let initM = 0n;
    let initE = 0n;
    for (let i = 0; i < config.cellCount; i++) {
      const m = config.initialCellMassQ?.[i] ?? 0;
      const e = config.initialCellEnergyQ?.[i] ?? 0;
      assertQuanta(m, `initialCellMassQ[${i}]`);
      assertQuanta(e, `initialCellEnergyQ[${i}]`);
      this.freeMass[i] = m;
      this.freeEnergy[i] = e;
      initM += BigInt(m);
      initE += BigInt(e);
    }
    this.initialTotalMassQ = initM;
    this.initialTotalEnergyQ = initE;
  }

  private assertCell(cellIndex: number): void {
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= this.cellCount) {
      throw new RangeError(`Cell index out of bounds [0, ${this.cellCount}): ${cellIndex}`);
    }
  }

  inspect(cellIndex: number, _tx?: EnergyTransaction): FoodResourceInfo {
    this.assertCell(cellIndex);
    return Object.freeze({
      poolKind: this.poolKind,
      cellIndex,
      massQ: this.freeMass[cellIndex],
      energyQ: this.freeEnergy[cellIndex],
      isPhysicallyClosed: true,
    });
  }

  reserve(
    consumerId: number,
    cellIndex: number,
    requestedMassQ: MassQ,
    tick: number,
    _tx?: EnergyTransaction
  ): FoodReservation {
    this.assertCell(cellIndex);
    if (!Number.isSafeInteger(consumerId) || consumerId < 0) {
      throw new RangeError(`consumerId must be a non-negative safe integer, received: ${consumerId}`);
    }
    assertQuanta(requestedMassQ, 'requestedMassQ');
    if (!Number.isSafeInteger(tick) || tick < 0) {
      throw new RangeError(`tick must be a non-negative integer, received: ${tick}`);
    }

    const availMass = this.freeMass[cellIndex];
    const availEnergy = this.freeEnergy[cellIndex];
    const takeMass = Math.min(requestedMassQ, availMass);
    let takeEnergy = 0;
    if (takeMass > 0) {
      if (this.poolKind === 'plant') {
        takeEnergy = energyOfMass(takeMass, RHO_PLANT);
      } else if (this.poolKind === 'detritus') {
        takeEnergy = energyOfMass(takeMass, RHO_DETRITUS);
      } else {
        takeEnergy = scaleByRatio(availEnergy, takeMass, availMass, 'floor');
      }
      this.freeMass[cellIndex] = availMass - takeMass;
      this.freeEnergy[cellIndex] = availEnergy - takeEnergy;
      this.pendingReservedMass += BigInt(takeMass);
      this.pendingReservedEnergy += BigInt(takeEnergy);
    }

    const reservation: FoodReservation = Object.freeze({
      reservationId: `${this.sourceId}#${this.nextResSeq++}`,
      sourceId: this.sourceId,
      consumerId,
      poolKind: this.poolKind,
      cellIndex,
      reservedMassQ: takeMass,
      reservedEnergyQ: takeEnergy,
      tick,
    });
    this.reservations.set(reservation.reservationId, { reservation, status: 'PENDING' });
    return reservation;
  }

  commitReservation(reservation: FoodReservation): ExternalWithdrawal {
    const rec = this.reservations.get(reservation.reservationId);
    if (!rec) {
      throw new FoodSourceReservationError(`Unknown reservation: ${reservation.reservationId}`);
    }
    if (rec.status !== 'PENDING') {
      throw new FoodSourceReservationError(
        `Reservation ${reservation.reservationId} is ${rec.status}, expected PENDING`
      );
    }
    if (this.beforeCommitHook) {
      this.beforeCommitHook(reservation);
    }
    rec.status = 'COMMITTED';
    this.pendingReservedMass -= BigInt(reservation.reservedMassQ);
    this.pendingReservedEnergy -= BigInt(reservation.reservedEnergyQ);
    this.committedWithdrawnMass += BigInt(reservation.reservedMassQ);
    this.committedWithdrawnEnergy += BigInt(reservation.reservedEnergyQ);
    return Object.freeze({
      massQ: reservation.reservedMassQ,
      energyQ: reservation.reservedEnergyQ,
    });
  }

  abortReservation(reservation: FoodReservation): void {
    const rec = this.reservations.get(reservation.reservationId);
    if (!rec) {
      throw new FoodSourceReservationError(`Unknown reservation: ${reservation.reservationId}`);
    }
    if (rec.status === 'ABORTED') return;
    if (rec.status === 'COMMITTED') {
      throw new FoodSourceReservationError(
        `Cannot abort already committed reservation: ${reservation.reservationId}`
      );
    }
    rec.status = 'ABORTED';
    this.pendingReservedMass -= BigInt(reservation.reservedMassQ);
    this.pendingReservedEnergy -= BigInt(reservation.reservedEnergyQ);
    this.freeMass[reservation.cellIndex] += reservation.reservedMassQ;
    this.freeEnergy[reservation.cellIndex] += reservation.reservedEnergyQ;
  }

  /** Total uncommitted free stock + pending reserved + committed withdrawals must match initial inventory. */
  auditInventory(): {
    readonly ok: boolean;
    readonly freeMassQ: bigint;
    readonly freeEnergyQ: bigint;
    readonly pendingMassQ: bigint;
    readonly pendingEnergyQ: bigint;
    readonly withdrawnMassQ: bigint;
    readonly withdrawnEnergyQ: bigint;
  } {
    let freeM = 0n;
    let freeE = 0n;
    for (let i = 0; i < this.cellCount; i++) {
      freeM += BigInt(this.freeMass[i]);
      freeE += BigInt(this.freeEnergy[i]);
    }
    const ok =
      freeM + this.pendingReservedMass + this.committedWithdrawnMass === this.initialTotalMassQ &&
      freeE + this.pendingReservedEnergy + this.committedWithdrawnEnergy === this.initialTotalEnergyQ;
    return Object.freeze({
      ok,
      freeMassQ: freeM,
      freeEnergyQ: freeE,
      pendingMassQ: this.pendingReservedMass,
      pendingEnergyQ: this.pendingReservedEnergy,
      withdrawnMassQ: this.committedWithdrawnMass,
      withdrawnEnergyQ: this.committedWithdrawnEnergy,
    });
  }
}

/**
 * In-engine `TransactionalFoodSource` wrapping `EntityEnergyStore` live prey slots (`preySlotOffset + cellIndex`).
 */
export class EntityPreyFoodSource implements TransactionalFoodSource {
  public readonly sourceId: string;
  public readonly poolKind = 'prey' as const;
  public readonly isPhysicallyClosed = true;
  public readonly cellCount: number;
  public readonly preySlotOffset: number;

  private readonly store: EntityEnergyStore;
  private readonly reservations = new Map<string, PendingReservationRecord>();
  private readonly cellReservedMass = new Map<number, MassQ>();
  private readonly cellReservedEnergy = new Map<number, EnergyQ>();
  private nextResSeq = 1;

  constructor(
    store: EntityEnergyStore,
    cellCount: number,
    preySlotOffset = 0,
    sourceId = 'entity-prey-store'
  ) {
    if (!Number.isSafeInteger(cellCount) || cellCount < 1) {
      throw new RangeError(`cellCount must be positive integer, received: ${cellCount}`);
    }
    if (!Number.isSafeInteger(preySlotOffset) || preySlotOffset < 0 || preySlotOffset + cellCount > store.capacity) {
      throw new RangeError(
        `Prey slots [${preySlotOffset}..${preySlotOffset + cellCount - 1}] exceed EntityEnergyStore capacity (${store.capacity})`
      );
    }
    this.store = store;
    this.cellCount = cellCount;
    this.preySlotOffset = preySlotOffset;
    this.sourceId = sourceId;
  }

  preySlotForCell(cellIndex: number): number {
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= this.cellCount) {
      throw new RangeError(`Cell index out of bounds [0, ${this.cellCount}): ${cellIndex}`);
    }
    return this.preySlotOffset + cellIndex;
  }

  private readBaseMassEnergy(cellIndex: number, tx?: EnergyTransaction): {
    structMassQ: MassQ;
    reserveMassQ: MassQ;
    massQ: MassQ;
    energyQ: EnergyQ;
  } {
    const slot = this.preySlotForCell(cellIndex);
    if (tx && (tx.state === 'ACTIVE' || tx.state === 'PREPARED')) {
      const sm = Number(tx.stagedMassQ(AccountKind.ORGANISM_STRUCT, slot));
      const se = Number(tx.stagedEnergyQ(AccountKind.ORGANISM_STRUCT, slot));
      const rm = Number(tx.stagedMassQ(AccountKind.ORGANISM_RESERVE, slot));
      const re = Number(tx.stagedEnergyQ(AccountKind.ORGANISM_RESERVE, slot));
      return { structMassQ: sm, reserveMassQ: rm, massQ: safeAdd(sm, rm), energyQ: safeAdd(se, re) };
    }
    const sm = this.store.structMassQ(slot);
    const se = this.store.structEnergyQ(slot);
    const rm = this.store.reserveMassQ(slot);
    const re = this.store.reserveEnergyQ(slot);
    return { structMassQ: sm, reserveMassQ: rm, massQ: safeAdd(sm, rm), energyQ: safeAdd(se, re) };
  }

  inspect(cellIndex: number, tx?: EnergyTransaction): FoodResourceInfo {
    const base = this.readBaseMassEnergy(cellIndex, tx);
    const lockedMass = this.cellReservedMass.get(cellIndex) ?? 0;
    const lockedEnergy = this.cellReservedEnergy.get(cellIndex) ?? 0;
    return Object.freeze({
      poolKind: 'prey',
      cellIndex,
      massQ: base.massQ > lockedMass ? base.massQ - lockedMass : 0,
      energyQ: base.energyQ > lockedEnergy ? base.energyQ - lockedEnergy : 0,
      isPhysicallyClosed: true,
    });
  }

  reserve(
    consumerId: number,
    cellIndex: number,
    requestedMassQ: MassQ,
    tick: number,
    tx?: EnergyTransaction
  ): FoodReservation {
    if (!Number.isSafeInteger(consumerId) || consumerId < 0) {
      throw new RangeError(`consumerId must be non-negative safe integer, received: ${consumerId}`);
    }
    assertQuanta(requestedMassQ, 'requestedMassQ');
    if (!Number.isSafeInteger(tick) || tick < 0) {
      throw new RangeError(`tick must be non-negative integer, received: ${tick}`);
    }

    const base = this.readBaseMassEnergy(cellIndex, tx);
    const lockedMass = this.cellReservedMass.get(cellIndex) ?? 0;
    const availMass = base.massQ > lockedMass ? base.massQ - lockedMass : 0;
    const takeMass = Math.min(requestedMassQ, availMass);
    const bite =
      takeMass > 0
        ? planProportionalPreyBite(base.structMassQ, base.reserveMassQ, takeMass)
        : { totalEnergyQ: 0 };

    const reservation: FoodReservation = Object.freeze({
      reservationId: `${this.sourceId}#${this.nextResSeq++}`,
      sourceId: this.sourceId,
      consumerId,
      poolKind: 'prey',
      cellIndex,
      reservedMassQ: takeMass,
      reservedEnergyQ: bite.totalEnergyQ,
      tick,
    });
    this.reservations.set(reservation.reservationId, { reservation, status: 'PENDING' });
    this.cellReservedMass.set(cellIndex, lockedMass + takeMass);
    this.cellReservedEnergy.set(cellIndex, (this.cellReservedEnergy.get(cellIndex) ?? 0) + bite.totalEnergyQ);
    return reservation;
  }

  private releaseLock(res: FoodReservation): void {
    const nextMass = (this.cellReservedMass.get(res.cellIndex) ?? 0) - res.reservedMassQ;
    const nextEnergy = (this.cellReservedEnergy.get(res.cellIndex) ?? 0) - res.reservedEnergyQ;
    if (nextMass <= 0) this.cellReservedMass.delete(res.cellIndex);
    else this.cellReservedMass.set(res.cellIndex, nextMass);
    if (nextEnergy <= 0) this.cellReservedEnergy.delete(res.cellIndex);
    else this.cellReservedEnergy.set(res.cellIndex, nextEnergy);
  }

  commitReservation(reservation: FoodReservation): ExternalWithdrawal {
    const rec = this.reservations.get(reservation.reservationId);
    if (!rec) {
      throw new FoodSourceReservationError(`Unknown reservation: ${reservation.reservationId}`);
    }
    if (rec.status !== 'PENDING') {
      throw new FoodSourceReservationError(
        `Reservation ${reservation.reservationId} is ${rec.status}, expected PENDING`
      );
    }
    rec.status = 'COMMITTED';
    this.releaseLock(reservation);
    return Object.freeze({
      massQ: reservation.reservedMassQ,
      energyQ: reservation.reservedEnergyQ,
    });
  }

  abortReservation(reservation: FoodReservation): void {
    const rec = this.reservations.get(reservation.reservationId);
    if (!rec) {
      throw new FoodSourceReservationError(`Unknown reservation: ${reservation.reservationId}`);
    }
    if (rec.status === 'ABORTED') return;
    if (rec.status === 'COMMITTED') {
      throw new FoodSourceReservationError(
        `Cannot abort already committed reservation: ${reservation.reservationId}`
      );
    }
    rec.status = 'ABORTED';
    this.releaseLock(reservation);
  }
}

export interface CompetitiveConsumerRequest {
  readonly organismId: number;
  readonly entitySlot: number;
  readonly cellIndex: number;
  readonly detritusCellIndex?: number;
  readonly requestedMassQ: MassQ;
  readonly profile: TrophicProfile;
  /** Escrow slot used only when pulling from an `ExternalEscrowFoodSource`. */
  readonly escrowSlot?: number;
}

export interface CompetitiveConsumerOutcome {
  readonly organismId: number;
  readonly grantedMassQ: MassQ;
  readonly feedingPlan: ExtendedFeedingPlan;
  readonly consumedFromEscrowMassQ: MassQ;
  readonly pulledExternalMassQ: MassQ;
}

function accountKindFromPool(poolKind: FoodSourcePoolKind): AccountKindId {
  switch (poolKind) {
    case 'plant':
      return AccountKind.CELL_PLANT;
    case 'carrion':
      return AccountKind.CELL_CARRION;
    case 'detritus':
      return AccountKind.CELL_DETRITUS;
    case 'prey':
      return AccountKind.ESCROW;
  }
}

/**
 * Executes competitive multi-consumer feeding against a `TransactionalFoodSource`:
 *   1. Sorts consumers canonically by ascending `organismId` (permutation invariance).
 *   2. Resolves cell contention deterministically via P0 `resolveContention(..., organismIds)`.
 *   3. When feeding from an external escrow source, consumes ALREADY-ESCROWED stock in `ESCROW[slot]`
 *      first and withdraws only the remaining shortfall into escrow BEFORE `tx.prepare()` (so an
 *      aborted transaction never loses or duplicates external withdrawals on retry).
 *   4. Stages all postings into `tx` while ACTIVE (zero external callbacks inside `COMMIT`).
 */
export function stageCompetitiveTransactionalForaging(
  ledger: EnergyLedger,
  tx: EnergyTransaction,
  source: TransactionalFoodSource,
  entityStore: EntityEnergyStore,
  requests: readonly CompetitiveConsumerRequest[],
  tick: number
): CompetitiveConsumerOutcome[] {
  assertPhysicallyClosedFoodProvider(source, true);
  if (requests.length === 0) return [];

  // Group canonically sorted by ascending organismId -> guarantees order-invariant processing
  const sorted = [...requests].sort((a, b) => a.organismId - b.organismId);
  const byCell = new Map<number, CompetitiveConsumerRequest[]>();
  for (const req of sorted) {
    assertQuanta(req.requestedMassQ, 'requestedMassQ');
    const list = byCell.get(req.cellIndex);
    if (list) list.push(req);
    else byCell.set(req.cellIndex, [req]);
  }

  const cells = Array.from(byCell.keys()).sort((a, b) => a - b);
  const outcomesByOrgId = new Map<number, CompetitiveConsumerOutcome>();
  const pendingReservations: FoodReservation[] = [];

  try {
    for (const cellIndex of cells) {
      const group = byCell.get(cellIndex)!;
      const count = group.length;
      const demands = new Float64Array(count);
      const orgIds = new Float64Array(count);
      const grants = new Float64Array(count);

      for (let i = 0; i < count; i++) {
        const req = group[i];
        const structM = Number(tx.stagedMassQ(AccountKind.ORGANISM_STRUCT, req.entitySlot));
        const resM = Number(tx.stagedMassQ(AccountKind.ORGANISM_RESERVE, req.entitySlot));
        const headroom = computeReserveHeadroomMassQ(structM, resM, req.profile);
        demands[i] = headroom === 0 ? 0 : req.requestedMassQ;
        orgIds[i] = req.organismId;
      }

      const info = source.inspect(cellIndex, tx);
      let effectiveAvailMass = info.massQ;

      // External transactional sources combine any pre-existing idempotent escrow balance + free external stock
      const isExternalSource =
        !(source instanceof GridPoolFoodSource) && !(source instanceof EntityPreyFoodSource);
      if (isExternalSource) {
        const seenSlots = new Set<number>();
        let preEscrowedMass = 0;
        for (const req of group) {
          const slot = req.escrowSlot ?? 0;
          if (!seenSlots.has(slot)) {
            seenSlots.add(slot);
            preEscrowedMass += Number(tx.stagedMassQ(AccountKind.ESCROW, slot));
          }
        }
        effectiveAvailMass = safeAdd(effectiveAvailMass, preEscrowedMass);
      }

      resolveContention(demands, count, effectiveAvailMass, grants, orgIds);

      for (let i = 0; i < count; i++) {
        const req = group[i];
        const grantMass = grants[i];
        const detritusCell = req.detritusCellIndex ?? cellIndex;
        const structM = Number(tx.stagedMassQ(AccountKind.ORGANISM_STRUCT, req.entitySlot));
        const resM = Number(tx.stagedMassQ(AccountKind.ORGANISM_RESERVE, req.entitySlot));
        const headroom = computeReserveHeadroomMassQ(structM, resM, req.profile);

        if (grantMass === 0) {
          outcomesByOrgId.set(
            req.organismId,
            Object.freeze({
              organismId: req.organismId,
              grantedMassQ: 0,
              feedingPlan: computeZeroFeedingPlan(),
              consumedFromEscrowMassQ: 0,
              pulledExternalMassQ: 0,
            })
          );
          continue;
        }

        if (isExternalSource) {
          const escrowSlot = req.escrowSlot ?? 0;
          const existingEscrowM = Number(tx.stagedMassQ(AccountKind.ESCROW, escrowSlot));
          const useEscrowM = Math.min(grantMass, existingEscrowM);
          const pullNeededM = grantMass - useEscrowM;

          let pulledM = 0;
          if (pullNeededM > 0) {
            const reservation = source.reserve(req.organismId, cellIndex, pullNeededM, tick, tx);
            pendingReservations.push(reservation);
            const pulled = ledger.importExternal(escrowSlot, () => {
              const withdrawn = source.commitReservation(reservation);
              const idx = pendingReservations.indexOf(reservation);
              if (idx !== -1) pendingReservations.splice(idx, 1);
              return withdrawn;
            });
            pulledM = pulled.massQ;
          }

          const totalAvailableM = safeAdd(existingEscrowM, 0); // ledger.importExternal already updated staged escrow
          const actualConsumeM = Math.min(grantMass, Number(tx.stagedMassQ(AccountKind.ESCROW, escrowSlot)));
          const totalEscrowE = Number(tx.stagedEnergyQ(AccountKind.ESCROW, escrowSlot));
          const totalEscrowM = Number(tx.stagedMassQ(AccountKind.ESCROW, escrowSlot));
          const consumeE =
            actualConsumeM === totalEscrowM
              ? totalEscrowE
              : scaleByRatio(totalEscrowE, actualConsumeM, totalEscrowM, 'floor');
          void totalAvailableM;

          const feedingPlan = stageFeeding(
            tx,
            AccountKind.ESCROW,
            escrowSlot,
            req.entitySlot,
            detritusCell,
            actualConsumeM,
            consumeE,
            req.profile,
            headroom
          );

          outcomesByOrgId.set(
            req.organismId,
            Object.freeze({
              organismId: req.organismId,
              grantedMassQ: actualConsumeM,
              feedingPlan,
              consumedFromEscrowMassQ: useEscrowM,
              pulledExternalMassQ: pulledM,
            })
          );
          continue;
        }

        // In-engine sources (GridPoolFoodSource or EntityPreyFoodSource)
        const reservation = source.reserve(req.organismId, cellIndex, grantMass, tick, tx);
        pendingReservations.push(reservation);

        let feedingPlan: ExtendedFeedingPlan;
        if (source instanceof EntityPreyFoodSource) {
          const res = stagePreyPredation(
            tx,
            source.preySlotForCell(cellIndex),
            req.entitySlot,
            detritusCell,
            reservation.reservedMassQ,
            req.profile,
            headroom
          );
          feedingPlan = res.feeding;
        } else {
          const srcKind = accountKindFromPool(source.poolKind);
          feedingPlan = stageFeeding(
            tx,
            srcKind,
            cellIndex,
            req.entitySlot,
            detritusCell,
            reservation.reservedMassQ,
            reservation.reservedEnergyQ,
            req.profile,
            headroom
          );
        }

        source.commitReservation(reservation);
        const idx = pendingReservations.indexOf(reservation);
        if (idx !== -1) pendingReservations.splice(idx, 1);

        outcomesByOrgId.set(
          req.organismId,
          Object.freeze({
            organismId: req.organismId,
            grantedMassQ: reservation.reservedMassQ,
            feedingPlan,
            consumedFromEscrowMassQ: 0,
            pulledExternalMassQ: 0,
          })
        );
      }
    }
  } catch (err) {
    // Roll back any un-finalized reservations on failure
    for (const res of pendingReservations) {
      try {
        source.abortReservation(res);
      } catch {
        // Already settled
      }
    }
    throw err;
  }

  void entityStore;
  return sorted.map((req) => outcomesByOrgId.get(req.organismId)!);
}

function computeZeroFeedingPlan(): ExtendedFeedingPlan {
  return Object.freeze({
    depositMassQ: 0,
    depositEnergyQ: 0,
    egestaMassQ: 0,
    egestaEnergyQ: 0,
    abioticMassQ: 0,
    heatQ: 0,
    absorptionPpm: 0,
    assimilationPpm: 0,
    sdaHeatQ: 0,
    clampedByHeadroom: false,
  });
}
