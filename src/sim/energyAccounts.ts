/**
 * Account kinds, posting reasons and posting records of the energy economy (Phase 2.2.1b / P1).
 *
 * The ledger is double-entry: every posting moves a non-negative amount from exactly one
 * source account to exactly one destination account. Mass (MU quanta) and energy (EU quanta)
 * are posted separately (`MassPosting` / `EnergyPosting`) and balanced separately.
 */

export const AccountKind = Object.freeze({
  /** External energy source (sunlight fixed by photosynthesis). Energy only, source only. */
  SUN: 0,
  /** External energy sink (dissipated heat). Energy only, sink only. */
  HEAT: 1,
  /** World initialisation source for mass and energy. Source only, genesis transactions only. */
  GENESIS: 2,
  /** Single finite global pool of abiotic matter (CO2, water, minerals). Mass only. */
  ABIOTIC: 3,
  /** Ledger-held stock of resources already withdrawn from external providers (id = escrow slot). */
  ESCROW: 4,
  /** External provider boundary. Never appears in transaction postings; only feeds ESCROW. */
  EXTERNAL_PROVIDER: 5,
  /** Per-cell plant biomass pool (id = cell index). */
  CELL_PLANT: 6,
  /** Per-cell carrion pool (id = cell index). */
  CELL_CARRION: 7,
  /** Per-cell detritus / excreta pool (id = cell index). */
  CELL_DETRITUS: 8,
  /** Structural tissue of an organism (id = entity slot). */
  ORGANISM_STRUCT: 9,
  /** Energy reserve tissue of an organism (id = entity slot). */
  ORGANISM_RESERVE: 10,
} as const);

export type AccountKindId = (typeof AccountKind)[keyof typeof AccountKind];

export const ACCOUNT_KIND_COUNT = 11;

export const ACCOUNT_KIND_NAMES: readonly string[] = Object.freeze([
  'SUN',
  'HEAT',
  'GENESIS',
  'ABIOTIC',
  'ESCROW',
  'EXTERNAL_PROVIDER',
  'CELL_PLANT',
  'CELL_CARRION',
  'CELL_DETRITUS',
  'ORGANISM_STRUCT',
  'ORGANISM_RESERVE',
]);

export const PostingReason = Object.freeze({
  GENESIS: 0,
  PHOTOSYNTHESIS: 1,
  PLANT_RESPIRATION: 2,
  PLANT_TURNOVER: 3,
  INGESTION: 4,
  EGESTION: 5,
  /** Heat increment of feeding (specific dynamic action). */
  SDA: 6,
  /** Basal metabolism, activity, thermoregulation: paid from the reserve only. */
  METABOLISM: 7,
  GROWTH: 8,
  REPRODUCTION: 9,
  DEATH: 10,
  DECOMPOSITION: 11,
} as const);

export type PostingReasonId = (typeof PostingReason)[keyof typeof PostingReason];

export const POSTING_REASON_COUNT = 12;

export const POSTING_REASON_NAMES: readonly string[] = Object.freeze([
  'GENESIS',
  'PHOTOSYNTHESIS',
  'PLANT_RESPIRATION',
  'PLANT_TURNOVER',
  'INGESTION',
  'EGESTION',
  'SDA',
  'METABOLISM',
  'GROWTH',
  'REPRODUCTION',
  'DEATH',
  'DECOMPOSITION',
]);

/** Immutable read model of one mass movement. */
export interface MassPosting {
  readonly txId: number;
  readonly tick: number;
  readonly seq: number;
  readonly reason: PostingReasonId;
  readonly srcKind: AccountKindId;
  readonly srcId: number;
  readonly dstKind: AccountKindId;
  readonly dstId: number;
  readonly massQ: number;
}

/** Immutable read model of one energy movement. */
export interface EnergyPosting {
  readonly txId: number;
  readonly tick: number;
  readonly seq: number;
  readonly reason: PostingReasonId;
  readonly srcKind: AccountKindId;
  readonly srcId: number;
  readonly dstKind: AccountKindId;
  readonly dstId: number;
  readonly energyQ: number;
}

const bit = (kind: number): number => 1 << kind;

const K = AccountKind;
const CELLS = bit(K.CELL_PLANT) | bit(K.CELL_CARRION) | bit(K.CELL_DETRITUS);
const ORGANISM = bit(K.ORGANISM_STRUCT) | bit(K.ORGANISM_RESERVE);
const FOOD = CELLS | ORGANISM | bit(K.ESCROW);
const DEAD_MATTER = bit(K.CELL_CARRION) | bit(K.CELL_DETRITUS);

interface ReasonRule {
  readonly energySrc: number;
  readonly energyDst: number;
  readonly massSrc: number;
  readonly massDst: number;
}

/**
 * Allowed (source, destination) account kinds per posting reason, as bit masks.
 *
 * Notable consequences encoded here:
 * - `METABOLISM` may debit only `ORGANISM_RESERVE`: structural tissue is never burned to pay
 *   for metabolism (an energy shortfall is handled by the caller as health loss, not by a posting).
 * - `ORGANISM_STRUCT` leaves an organism only when it is eaten (INGESTION/EGESTION/SDA) or dies
 *   (DEATH -> CELL_CARRION).
 */
const RULES: readonly ReasonRule[] = Object.freeze([
  // GENESIS
  {
    energySrc: bit(K.GENESIS),
    energyDst: CELLS | ORGANISM,
    massSrc: bit(K.GENESIS),
    massDst: CELLS | ORGANISM | bit(K.ABIOTIC),
  },
  // PHOTOSYNTHESIS
  {
    energySrc: bit(K.SUN),
    energyDst: bit(K.CELL_PLANT),
    massSrc: bit(K.ABIOTIC),
    massDst: bit(K.CELL_PLANT),
  },
  // PLANT_RESPIRATION
  {
    energySrc: bit(K.CELL_PLANT),
    energyDst: bit(K.HEAT),
    massSrc: bit(K.CELL_PLANT),
    massDst: bit(K.ABIOTIC),
  },
  // PLANT_TURNOVER
  {
    energySrc: bit(K.CELL_PLANT),
    energyDst: bit(K.CELL_DETRITUS),
    massSrc: bit(K.CELL_PLANT),
    massDst: bit(K.CELL_DETRITUS),
  },
  // INGESTION
  {
    energySrc: FOOD,
    energyDst: bit(K.ORGANISM_RESERVE),
    massSrc: FOOD,
    massDst: bit(K.ORGANISM_RESERVE),
  },
  // EGESTION
  {
    energySrc: FOOD,
    energyDst: bit(K.CELL_DETRITUS),
    massSrc: FOOD,
    massDst: bit(K.CELL_DETRITUS) | bit(K.ABIOTIC),
  },
  // SDA
  {
    energySrc: FOOD,
    energyDst: bit(K.HEAT),
    massSrc: FOOD,
    massDst: bit(K.ABIOTIC),
  },
  // METABOLISM
  {
    energySrc: bit(K.ORGANISM_RESERVE),
    energyDst: bit(K.HEAT),
    massSrc: bit(K.ORGANISM_RESERVE),
    massDst: bit(K.ABIOTIC),
  },
  // GROWTH
  {
    energySrc: bit(K.ORGANISM_RESERVE),
    energyDst: bit(K.ORGANISM_STRUCT) | bit(K.HEAT),
    massSrc: bit(K.ORGANISM_RESERVE) | bit(K.ABIOTIC),
    massDst: bit(K.ORGANISM_STRUCT) | bit(K.ABIOTIC),
  },
  // REPRODUCTION
  {
    energySrc: bit(K.ORGANISM_RESERVE),
    energyDst: ORGANISM | bit(K.HEAT),
    massSrc: bit(K.ORGANISM_RESERVE) | bit(K.ABIOTIC),
    massDst: ORGANISM | bit(K.ABIOTIC),
  },
  // DEATH
  {
    energySrc: ORGANISM,
    energyDst: bit(K.CELL_CARRION),
    massSrc: ORGANISM,
    massDst: bit(K.CELL_CARRION),
  },
  // DECOMPOSITION
  {
    energySrc: DEAD_MATTER,
    energyDst: bit(K.HEAT),
    massSrc: DEAD_MATTER,
    massDst: bit(K.ABIOTIC),
  },
]);

export function isValidAccountKind(kind: number): kind is AccountKindId {
  return Number.isInteger(kind) && kind >= 0 && kind < ACCOUNT_KIND_COUNT;
}

export function isValidPostingReason(reason: number): reason is PostingReasonId {
  return Number.isInteger(reason) && reason >= 0 && reason < POSTING_REASON_COUNT;
}

/**
 * Returns `null` when the (reason, src, dst) combination is permitted for an energy posting,
 * otherwise a human-readable description of the violated rule.
 */
export function checkEnergyRoute(reason: number, srcKind: number, dstKind: number): string | null {
  if (!isValidPostingReason(reason)) return `unknown posting reason ${reason}`;
  if (!isValidAccountKind(srcKind) || !isValidAccountKind(dstKind)) return 'unknown account kind';
  // Universal directionality rules (invariant I4)
  if (srcKind === K.HEAT) return 'HEAT is a sink and can never be an energy source';
  if (dstKind === K.SUN) return 'SUN is a source and can never receive energy';
  if (dstKind === K.GENESIS) return 'GENESIS can never receive energy';
  if (srcKind === K.ABIOTIC || dstKind === K.ABIOTIC) return 'ABIOTIC matter carries no chemical energy';
  if (srcKind === K.EXTERNAL_PROVIDER || dstKind === K.EXTERNAL_PROVIDER) {
    return 'EXTERNAL_PROVIDER can only be reached through escrow deposits';
  }
  const rule = RULES[reason];
  if ((rule.energySrc & bit(srcKind)) === 0) {
    return `${ACCOUNT_KIND_NAMES[srcKind]} is not a permitted energy source for ${POSTING_REASON_NAMES[reason]}`;
  }
  if ((rule.energyDst & bit(dstKind)) === 0) {
    return `${ACCOUNT_KIND_NAMES[dstKind]} is not a permitted energy destination for ${POSTING_REASON_NAMES[reason]}`;
  }
  return null;
}

/**
 * Returns `null` when the (reason, src, dst) combination is permitted for a mass posting,
 * otherwise a human-readable description of the violated rule.
 */
export function checkMassRoute(reason: number, srcKind: number, dstKind: number): string | null {
  if (!isValidPostingReason(reason)) return `unknown posting reason ${reason}`;
  if (!isValidAccountKind(srcKind) || !isValidAccountKind(dstKind)) return 'unknown account kind';
  if (srcKind === K.SUN || dstKind === K.SUN || srcKind === K.HEAT || dstKind === K.HEAT) {
    return 'SUN and HEAT are energy-only accounts and carry no mass';
  }
  if (dstKind === K.GENESIS) return 'GENESIS can never receive mass';
  if (srcKind === K.EXTERNAL_PROVIDER || dstKind === K.EXTERNAL_PROVIDER) {
    return 'EXTERNAL_PROVIDER can only be reached through escrow deposits';
  }
  const rule = RULES[reason];
  if ((rule.massSrc & bit(srcKind)) === 0) {
    return `${ACCOUNT_KIND_NAMES[srcKind]} is not a permitted mass source for ${POSTING_REASON_NAMES[reason]}`;
  }
  if ((rule.massDst & bit(dstKind)) === 0) {
    return `${ACCOUNT_KIND_NAMES[dstKind]} is not a permitted mass destination for ${POSTING_REASON_NAMES[reason]}`;
  }
  return null;
}

// Precomputed 4096-entry lookup tables indexed by (reason << 8) | (srcKind << 4) | dstKind.
// Any out-of-range reason/kind >= 16 fails the `((r | s | d) >>> 4) === 0` guard; entries 12..15 / 11..15 remain 0.
const ENERGY_ROUTE_LUT = new Uint8Array(4096);
const MASS_ROUTE_LUT = new Uint8Array(4096);
for (let r = 0; r < POSTING_REASON_COUNT; r++) {
  for (let s = 0; s < ACCOUNT_KIND_COUNT; s++) {
    for (let d = 0; d < ACCOUNT_KIND_COUNT; d++) {
      const idx = (r << 8) | (s << 4) | d;
      if (checkEnergyRoute(r, s, d) === null) ENERGY_ROUTE_LUT[idx] = 1;
      if (checkMassRoute(r, s, d) === null) MASS_ROUTE_LUT[idx] = 1;
    }
  }
}

export function isEnergyRouteAllowedFast(reason: number, srcKind: number, dstKind: number): boolean {
  return (
    ((reason | srcKind | dstKind) >>> 4) === 0 &&
    ENERGY_ROUTE_LUT[(reason << 8) | (srcKind << 4) | dstKind] === 1
  );
}

export function isMassRouteAllowedFast(reason: number, srcKind: number, dstKind: number): boolean {
  return (
    ((reason | srcKind | dstKind) >>> 4) === 0 &&
    MASS_ROUTE_LUT[(reason << 8) | (srcKind << 4) | dstKind] === 1
  );
}
