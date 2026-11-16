/**
 * Physical unit system for the Living World Simulation energy economy (Phase 2.2.1b / P0).
 *
 * Two independent quantities:
 *   - MU (Mass Units)   — material mass of tissue, plant biomass, food, carrion, eggs.
 *   - EU (Energy Units) — chemical energy stores, metabolic costs, heat.
 *
 * All accounting is performed on *quanta*: non-negative integers stored in float64
 * (`number`, exact up to 2^53 - 1) for per-account values, and in exact wide accumulators /
 * BigInt for world totals. Integer arithmetic is exact and associative, so balances are
 * verified with strict equality and are independent of summation order.
 *
 * Mass never converts into energy implicitly and energy never creates mass: the only bridge
 * between the two is an explicit energy density (EU per MU) of a biomass pool.
 */

import {
  MAX_SAFE_BIG,
  divCeilBig,
  divFloorBig,
  divHalfEvenBig,
  float64Bits,
} from './detMath';

const LOCAL_MAX_SAFE_INT = Number.MAX_SAFE_INTEGER;
const CARRION_SAFE_MASS_LIMIT = 300_239_975_158_033; // floor(MAX_SAFE_INT / 30)

export class UnitsError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'UnitsError';
  }
}

/**
 * Quantization scales confirmed against Revision 3 (Phase 2.2.1b Final Architecture):
 *   - 1 MU = 1_000_000 qMU
 *   - 1 EU = 1_000_000 qEU
 */
export const MU_QUANTA_PER_UNIT = 1_000_000;
export const EU_QUANTA_PER_UNIT = 1_000_000;
export const SCALES_CONFIRMED_AGAINST_REVISION_3 = true;

export const MU_QUANTA_PER_UNIT_BIG = BigInt(MU_QUANTA_PER_UNIT);
export const EU_QUANTA_PER_UNIT_BIG = BigInt(EU_QUANTA_PER_UNIT);

/** Parts-per-million denominator used for dimensionless fractions (efficiencies, shares). */
export const PPM = 1_000_000;

/** Largest quantum count representable exactly in a float64 account slot. */
export const MAX_QUANTA = LOCAL_MAX_SAFE_INT;

/** Mass in quanta (non-negative safe integer). */
export type MassQ = number;
/** Energy in quanta (non-negative safe integer). */
export type EnergyQ = number;

export type RoundingMode = 'floor' | 'ceil' | 'half-even';

function decimalDigitsOfScale(scale: number, label: string): number {
  if (!Number.isSafeInteger(scale) || scale < 1) {
    throw new UnitsError(`${label} must be a positive safe integer, received: ${scale}`);
  }
  let digits = 0;
  let s = scale;
  while (s > 1) {
    if (s % 10 !== 0) {
      throw new UnitsError(`${label} must be a power of ten, received: ${scale}`);
    }
    s /= 10;
    digits++;
  }
  return digits;
}

export const MU_DECIMALS = decimalDigitsOfScale(MU_QUANTA_PER_UNIT, 'MU_QUANTA_PER_UNIT');
export const EU_DECIMALS = decimalDigitsOfScale(EU_QUANTA_PER_UNIT, 'EU_QUANTA_PER_UNIT');

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validates a quantum amount: non-negative safe integer (rejects NaN, fractions, negatives, Infinity). */
export function assertQuanta(q: number, label = 'quanta'): number {
  if (!Number.isSafeInteger(q) || q < 0) {
    throw new UnitsError(`${label} must be a non-negative safe integer quantum count, received: ${q}`);
  }
  return q;
}

export function isQuanta(q: unknown): q is number {
  return typeof q === 'number' && Number.isSafeInteger(q) && q >= 0;
}

export function assertNonNegativeBig(b: bigint, label = 'value'): bigint {
  if (typeof b !== 'bigint' || b < 0n) {
    throw new UnitsError(`${label} must be a non-negative bigint, received: ${String(b)}`);
  }
  return b;
}

export function quantaToBig(q: number, label = 'quanta'): bigint {
  return BigInt(assertQuanta(q, label));
}

/** Converts a BigInt quantum count into a float64 account value, throwing when out of range. */
export function bigToQuanta(b: bigint, label = 'quanta'): number {
  assertNonNegativeBig(b, label);
  if (b > MAX_SAFE_BIG) {
    throw new UnitsError(`${label} overflow: ${b} exceeds 2^53 - 1 quanta`);
  }
  return Number(b);
}

function roundDivBig(n: bigint, d: bigint, mode: RoundingMode): bigint {
  switch (mode) {
    case 'floor':
      return divFloorBig(n, d);
    case 'ceil':
      return divCeilBig(n, d);
    case 'half-even':
      return divHalfEvenBig(n, d);
    default:
      throw new UnitsError(`Unknown rounding mode: ${String(mode)}`);
  }
}

// ---------------------------------------------------------------------------
// Unit <-> quanta conversion
// ---------------------------------------------------------------------------

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

/**
 * Exact decimal-string -> quanta conversion (e.g. `"113.328"` -> `113328000` at scale 10^6).
 * With `mode === 'exact'` (default) inputs carrying more fractional digits than the scale
 * resolves throw instead of being rounded silently.
 */
export function decimalToQuanta(
  text: string,
  scale: number,
  mode: RoundingMode | 'exact' = 'exact'
): number {
  const digits = decimalDigitsOfScale(scale, 'scale');
  if (typeof text !== 'string') {
    throw new UnitsError(`Decimal amount must be a string, received: ${String(text)}`);
  }
  const match = DECIMAL_RE.exec(text);
  if (!match) {
    throw new UnitsError(`Invalid non-negative decimal amount: "${text}"`);
  }
  const fracText = match[2] ?? '';
  // Exact rational value: numerator / 10^fracDigits
  const pow = 10n ** BigInt(fracText.length);
  const numerator = BigInt(match[1] + fracText) * BigInt(scale);
  let q: bigint;
  if (numerator % pow === 0n) {
    q = numerator / pow;
  } else if (mode === 'exact') {
    throw new UnitsError(
      `Decimal amount "${text}" is finer than one quantum (${digits} decimals); pass a rounding mode`
    );
  } else {
    q = roundDivBig(numerator, pow, mode);
  }
  return bigToQuanta(q, `decimal amount "${text}"`);
}

/** Parses an exact decimal MU string into mass quanta. */
export function parseMU(text: string, mode: RoundingMode | 'exact' = 'exact'): MassQ {
  return decimalToQuanta(text, MU_QUANTA_PER_UNIT, mode);
}

/** Parses an exact decimal EU string into energy quanta. */
export function parseEU(text: string, mode: RoundingMode | 'exact' = 'exact'): EnergyQ {
  return decimalToQuanta(text, EU_QUANTA_PER_UNIT, mode);
}

/**
 * Converts a float64 amount of units into quanta by rounding the *exact* rational value of the
 * double (`mantissa * 2^exponent * scale`) with the requested mode. No float multiplication is
 * involved, so there is no double rounding. Rejects NaN, negatives, Infinity, and overflow.
 */
export function numberToQuanta(x: number, scale: number, mode: RoundingMode = 'half-even'): number {
  if (!Number.isSafeInteger(scale) || scale < 1) {
    throw new UnitsError(`scale must be a positive safe integer, received: ${scale}`);
  }
  if (typeof x !== 'number' || !(x >= 0) || x === Infinity) {
    throw new UnitsError(`Unit amount must be finite and >= 0, received: ${x}`);
  }
  if (x === 0) return 0;
  if (x > LOCAL_MAX_SAFE_INT) {
    throw new UnitsError(`Unit amount overflow: ${x} * ${scale} exceeds 2^53 - 1 quanta`);
  }
  const prod = x * scale;
  if (Number.isSafeInteger(x) && prod <= LOCAL_MAX_SAFE_INT) {
    return prod;
  }
  if (prod <= 1_000_000_000) {
    const base = Math.floor(prod);
    const frac = prod - base;
    if (mode === 'half-even') {
      if (frac < 0.4999) return base;
      if (frac > 0.5001) return base + 1;
    } else if (frac > 1e-4 && frac < 0.9999) {
      return mode === 'floor' ? base : base + 1;
    }
  }
  const bits = float64Bits(x);
  const expField = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & 0xfffffffffffffn;
  // value = mantissa * 2^exp2
  const mantissa = expField === 0 ? fraction : fraction | (1n << 52n);
  const exp2 = (expField === 0 ? 1 : expField) - 1075;
  const numerator = mantissa * BigInt(scale);
  const q =
    exp2 >= 0 ? numerator << BigInt(exp2) : roundDivBig(numerator, 1n << BigInt(-exp2), mode);
  if (q > MAX_SAFE_BIG) {
    throw new UnitsError(`Unit amount overflow: ${x} * ${scale} exceeds 2^53 - 1 quanta`);
  }
  return Number(q);
}

export function muToQ(mu: number, mode: RoundingMode = 'half-even'): MassQ {
  return numberToQuanta(mu, MU_QUANTA_PER_UNIT, mode);
}

export function euToQ(eu: number, mode: RoundingMode = 'half-even'): EnergyQ {
  return numberToQuanta(eu, EU_QUANTA_PER_UNIT, mode);
}

/** Lossy display conversion quanta -> MU (never feed the result back into accounting). */
export function qToMU(q: MassQ): number {
  return assertQuanta(q, 'massQ') / MU_QUANTA_PER_UNIT;
}

/** Lossy display conversion quanta -> EU (never feed the result back into accounting). */
export function qToEU(q: EnergyQ): number {
  return assertQuanta(q, 'energyQ') / EU_QUANTA_PER_UNIT;
}

function formatScaled(q: bigint, scale: bigint, digits: number): string {
  const negative = q < 0n;
  const abs = negative ? -q : q;
  const whole = abs / scale;
  const frac = abs % scale;
  const body = digits === 0 ? whole.toString() : `${whole}.${frac.toString().padStart(digits, '0')}`;
  return negative ? `-${body}` : body;
}

/** Exact decimal rendering of mass quanta (accepts wide BigInt totals and signed residuals). */
export function formatMU(q: number | bigint): string {
  const big = typeof q === 'bigint' ? q : quantaToBig(q, 'massQ');
  return formatScaled(big, MU_QUANTA_PER_UNIT_BIG, MU_DECIMALS);
}

/** Exact decimal rendering of energy quanta (accepts wide BigInt totals and signed residuals). */
export function formatEU(q: number | bigint): string {
  const big = typeof q === 'bigint' ? q : quantaToBig(q, 'energyQ');
  return formatScaled(big, EU_QUANTA_PER_UNIT_BIG, EU_DECIMALS);
}

// ---------------------------------------------------------------------------
// Exact scaling of quanta
// ---------------------------------------------------------------------------

/**
 * Exact `round(q * num / den)` on quanta with explicit rounding mode and overflow protection.
 * `num` >= 0 and `den` > 0 must be safe integers.
 */
export function scaleByRatio(q: number, num: number, den: number, mode: RoundingMode = 'floor'): number {
  if (!Number.isSafeInteger(q) || q < 0) {
    throw new UnitsError(`quanta must be a non-negative safe integer quantum count, received: ${q}`);
  }
  if (!Number.isSafeInteger(num) || num < 0) {
    throw new UnitsError(`ratio numerator must be a non-negative safe integer, received: ${num}`);
  }
  if (!Number.isSafeInteger(den) || den <= 0) {
    throw new UnitsError(`ratio denominator must be a positive safe integer, received: ${den}`);
  }
  if (mode !== 'floor' && mode !== 'ceil' && mode !== 'half-even') {
    throw new UnitsError(`Unknown rounding mode: ${String(mode)}`);
  }
  const p = q * num;
  if (p <= LOCAL_MAX_SAFE_INT) {
    // Exact fast path: p is an exact integer and `%` is exact.
    const r = p % den;
    const base = (p - r) / den;
    if (r === 0 || mode === 'floor') return base;
    if (mode === 'ceil') return base + 1;
    // half-even: compare 2r with den without overflow (r < den <= 2^53 - 1)
    const rest = den - r;
    if (r < rest) return base;
    if (r > rest) return base + 1;
    return base % 2 === 0 ? base : base + 1;
  }
  const result = roundDivBig(BigInt(q) * BigInt(num), BigInt(den), mode);
  if (result > MAX_SAFE_BIG) {
    throw new UnitsError(`scaleByRatio overflow: ${q} * ${num} / ${den} exceeds 2^53 - 1 quanta`);
  }
  return Number(result);
}

/** Validates a parts-per-million fraction in [0, PPM]. */
export function assertPpm(ppm: number, label = 'ppm'): number {
  if (!Number.isSafeInteger(ppm) || ppm < 0 || ppm > PPM) {
    throw new UnitsError(`${label} must be an integer in [0, ${PPM}], received: ${ppm}`);
  }
  return ppm;
}

/** Exact `q * ppm / 1e6` for a fraction in [0, 1]; the result never exceeds `q`. */
export function applyPpm(q: number, ppm: number, mode: RoundingMode = 'floor'): number {
  assertPpm(ppm);
  return scaleByRatio(q, ppm, PPM, mode);
}

/** Converts a float fraction in [0, 1] into integer ppm using exact rounding of the double. */
export function fractionToPpm(fraction: number, mode: RoundingMode = 'half-even'): number {
  if (typeof fraction !== 'number' || !(fraction >= 0) || fraction > 1) {
    throw new UnitsError(`fraction must be in [0, 1], received: ${fraction}`);
  }
  return numberToQuanta(fraction, PPM, mode);
}

/**
 * Energy density of a biomass pool as an exact rational number of EU per MU.
 * Both parts must be positive safe integers (e.g. `{ num: 15, den: 2 }` = 7.5 EU/MU).
 */
export interface EnergyDensity {
  readonly num: number;
  readonly den: number;
}

export function energyDensity(num: number, den = 1): EnergyDensity {
  if (!Number.isSafeInteger(num) || num <= 0 || !Number.isSafeInteger(den) || den <= 0) {
    throw new UnitsError(`Energy density must be a positive rational, received: ${num}/${den}`);
  }
  return Object.freeze({ num, den });
}

function assertDensity(d: EnergyDensity): void {
  if (
    !d ||
    !Number.isSafeInteger(d.num) ||
    d.num <= 0 ||
    !Number.isSafeInteger(d.den) ||
    d.den <= 0
  ) {
    throw new UnitsError('Energy density must have positive safe-integer num and den');
  }
}

/** Chemical energy (quanta) carried by `massQ` of biomass at `density` EU/MU. */
export function energyOfMass(massQ: MassQ, density: EnergyDensity, mode: RoundingMode = 'floor'): EnergyQ {
  if (!Number.isSafeInteger(massQ) || massQ < 0) {
    throw new UnitsError(`massQ must be a non-negative safe integer quantum count, received: ${massQ}`);
  }
  if (
    !density ||
    !Number.isSafeInteger(density.num) ||
    density.num <= 0 ||
    !Number.isSafeInteger(density.den) ||
    density.den <= 0
  ) {
    throw new UnitsError('Energy density must have positive safe-integer num and den');
  }
  const dNum = density.num;
  const dDen = density.den;
  const p = massQ * dNum;
  if (p <= LOCAL_MAX_SAFE_INT) {
    if (dDen === 1) return p;
    const r = p % dDen;
    const base = (p - r) / dDen;
    if (r === 0 || mode === 'floor') return base;
    if (mode === 'ceil') return base + 1;
    if (mode === 'half-even') {
      const rest = dDen - r;
      if (r < rest) return base;
      if (r > rest) return base + 1;
      return base % 2 === 0 ? base : base + 1;
    }
    throw new UnitsError(`Unknown rounding mode: ${String(mode)}`);
  }
  const n = BigInt(massQ) * BigInt(dNum) * EU_QUANTA_PER_UNIT_BIG;
  const d = BigInt(dDen) * MU_QUANTA_PER_UNIT_BIG;
  return bigToQuanta(roundDivBig(n, d, mode), 'energyOfMass result');
}

/** Biomass (quanta) that carries `energyQ` of chemical energy at `density` EU/MU. */
export function massForEnergy(energyQ: EnergyQ, density: EnergyDensity, mode: RoundingMode = 'floor'): MassQ {
  if (!Number.isSafeInteger(energyQ) || energyQ < 0) {
    throw new UnitsError(`energyQ must be a non-negative safe integer quantum count, received: ${energyQ}`);
  }
  if (
    !density ||
    !Number.isSafeInteger(density.num) ||
    density.num <= 0 ||
    !Number.isSafeInteger(density.den) ||
    density.den <= 0
  ) {
    throw new UnitsError('Energy density must have positive safe-integer num and den');
  }
  const dNum = density.num;
  const dDen = density.den;
  const p = energyQ * dDen;
  if (p <= LOCAL_MAX_SAFE_INT) {
    const r = p % dNum;
    const base = (p - r) / dNum;
    if (r === 0 || mode === 'floor') return base;
    if (mode === 'ceil') return base + 1;
    if (mode === 'half-even') {
      const rest = dNum - r;
      if (r < rest) return base;
      if (r > rest) return base + 1;
      return base % 2 === 0 ? base : base + 1;
    }
    throw new UnitsError(`Unknown rounding mode: ${String(mode)}`);
  }
  const n = BigInt(energyQ) * BigInt(dDen) * MU_QUANTA_PER_UNIT_BIG;
  const d = BigInt(dNum) * EU_QUANTA_PER_UNIT_BIG;
  return bigToQuanta(roundDivBig(n, d, mode), 'massForEnergy result');
}

// ---------------------------------------------------------------------------
// Confirmed Revision 3 canonical pool densities and exact stoichiometry (FIX 2)
// ---------------------------------------------------------------------------

/** Canonical biomass energy densities (EU per MU) from Revision 3. */
export const RHO_PLANT: EnergyDensity = energyDensity(3);
export const RHO_DETRITUS: EnergyDensity = energyDensity(3);
export const RHO_STRUCT: EnergyDensity = energyDensity(5);
export const RHO_RESERVE: EnergyDensity = energyDensity(30);

/** Checks whether `(massQ, energyQ)` matches `energyQ === energyOfMass(massQ, density)` exactly. */
export function hasExactDensity(massQ: MassQ, energyQ: EnergyQ, density: EnergyDensity): boolean {
  assertQuanta(massQ, 'massQ');
  assertQuanta(energyQ, 'energyQ');
  assertDensity(density);
  if (
    massQ * density.num <= LOCAL_MAX_SAFE_INT &&
    energyQ * density.den <= LOCAL_MAX_SAFE_INT
  ) {
    return energyQ * density.den === massQ * density.num;
  }
  return (
    BigInt(energyQ) * BigInt(density.den) * MU_QUANTA_PER_UNIT_BIG ===
    BigInt(massQ) * BigInt(density.num) * EU_QUANTA_PER_UNIT_BIG
  );
}

export interface CarrionFractions {
  readonly structMassQ: MassQ;
  readonly structEnergyQ: EnergyQ;
  readonly reserveMassQ: MassQ;
  readonly reserveEnergyQ: EnergyQ;
}

export interface MutableCarrionFractions {
  structMassQ: MassQ;
  structEnergyQ: EnergyQ;
  reserveMassQ: MassQ;
  reserveEnergyQ: EnergyQ;
}

/** Allocation-free carrion decomposition into a caller-supplied output object. */
export function splitCarrionMassInto(
  massQ: MassQ,
  energyQ: EnergyQ,
  out: MutableCarrionFractions
): void {
  if (!Number.isSafeInteger(massQ) || massQ < 0) {
    throw new UnitsError(`carrion massQ must be a non-negative safe integer quantum count, received: ${massQ}`);
  }
  if (!Number.isSafeInteger(energyQ) || energyQ < 0) {
    throw new UnitsError(`carrion energyQ must be a non-negative safe integer quantum count, received: ${energyQ}`);
  }
  if (massQ <= CARRION_SAFE_MASS_LIMIT) {
    const minE = massQ * 5;
    const maxE = massQ * 30;
    if (energyQ < minE || energyQ > maxE) {
      throw new UnitsError(
        `Carrion energy ${energyQ} is outside physical tissue bounds [${minE}, ${maxE}] for mass ${massQ}`
      );
    }
    const diff = energyQ - minE;
    if (diff % 25 !== 0) {
      throw new UnitsError(
        `Carrion pool (${massQ} qMU, ${energyQ} qEU) is not an exact integer mixture of STRUCT (5) and RESERVE (30)`
      );
    }
    const reserveMassQ = diff / 25;
    const structMassQ = massQ - reserveMassQ;
    out.structMassQ = structMassQ;
    out.structEnergyQ = structMassQ * 5;
    out.reserveMassQ = reserveMassQ;
    out.reserveEnergyQ = reserveMassQ * 30;
    return;
  }
  const mBig = BigInt(massQ);
  const eBig = BigInt(energyQ);
  const minE = mBig * 5n;
  const maxE = mBig * 30n;
  if (eBig < minE || eBig > maxE) {
    throw new UnitsError(
      `Carrion energy ${energyQ} is outside physical tissue bounds [${minE}, ${maxE}] for mass ${massQ}`
    );
  }
  const diffNum = eBig * MU_QUANTA_PER_UNIT_BIG - mBig * 5n * EU_QUANTA_PER_UNIT_BIG;
  const step = 25n * EU_QUANTA_PER_UNIT_BIG;
  if (diffNum < 0n || diffNum % step !== 0n) {
    throw new UnitsError(
      `Carrion pool (${massQ} qMU, ${energyQ} qEU) is not an exact integer mixture of STRUCT (5) and RESERVE (30)`
    );
  }
  const reserveMassQ = bigToQuanta(diffNum / step, 'carrion reserveMassQ');
  const structMassQ = massQ - reserveMassQ;
  out.structMassQ = structMassQ;
  out.structEnergyQ = energyOfMass(structMassQ, RHO_STRUCT);
  out.reserveMassQ = reserveMassQ;
  out.reserveEnergyQ = energyOfMass(reserveMassQ, RHO_RESERVE);
}

const _carrionScratch: MutableCarrionFractions = {
  structMassQ: 0,
  structEnergyQ: 0,
  reserveMassQ: 0,
  reserveEnergyQ: 0,
};

/**
 * Recovers the exact structural (`5 EU/MU`) and reserve (`30 EU/MU`) integer tissue fractions
 * of a `CELL_CARRION` pool from its aggregate `(massQ, energyQ)`.
 *
 * Because `RHO_STRUCT = 5` and `RHO_RESERVE = 30` are linearly independent, a carrion pool
 * formed exclusively from dead organism structure and reserve uniquely satisfies:
 *   E * MU_SCALE - 5 * M * EU_SCALE = 25 * reserveMassQ * EU_SCALE.
 */
export function splitCarrionMass(massQ: MassQ, energyQ: EnergyQ): CarrionFractions {
  splitCarrionMassInto(massQ, energyQ, _carrionScratch);
  return Object.freeze({
    structMassQ: _carrionScratch.structMassQ,
    structEnergyQ: _carrionScratch.structEnergyQ,
    reserveMassQ: _carrionScratch.reserveMassQ,
    reserveEnergyQ: _carrionScratch.reserveEnergyQ,
  });
}

export function isValidCarrionMix(massQ: MassQ, energyQ: EnergyQ): boolean {
  if (!Number.isSafeInteger(massQ) || massQ < 0 || !Number.isSafeInteger(energyQ) || energyQ < 0) {
    return false;
  }
  if (massQ <= CARRION_SAFE_MASS_LIMIT) {
    const minE = massQ * 5;
    const maxE = massQ * 30;
    return energyQ >= minE && energyQ <= maxE && (energyQ - minE) % 25 === 0;
  }
  const mBig = BigInt(massQ);
  const eBig = BigInt(energyQ);
  const diffNum = eBig * MU_QUANTA_PER_UNIT_BIG - mBig * 5n * EU_QUANTA_PER_UNIT_BIG;
  const maxDiff = mBig * 25n * EU_QUANTA_PER_UNIT_BIG;
  const step = 25n * EU_QUANTA_PER_UNIT_BIG;
  return diffNum >= 0n && diffNum <= maxDiff && diffNum % step === 0n;
}

export interface CarrionBitePlan {
  readonly structMassQ: MassQ;
  readonly structEnergyQ: EnergyQ;
  readonly reserveMassQ: MassQ;
  readonly reserveEnergyQ: EnergyQ;
  readonly totalMassQ: MassQ;
  readonly totalEnergyQ: EnergyQ;
}

/**
 * Selects an exact proportional bite of `biteMassQ` from mixed `CELL_CARRION` while keeping the
 * remaining carrion an exact integer mixture of `STRUCT (5)` and `RESERVE (30)` tissues.
 */
export function planCarrionConsumption(
  carrionMassQ: MassQ,
  carrionEnergyQ: EnergyQ,
  biteMassQ: MassQ,
  mode: RoundingMode = 'half-even'
): CarrionBitePlan {
  assertQuanta(biteMassQ, 'biteMassQ');
  const fractions = splitCarrionMass(carrionMassQ, carrionEnergyQ);
  if (biteMassQ > carrionMassQ) {
    throw new UnitsError(`Cannot consume ${biteMassQ} qMU from carrion holding ${carrionMassQ} qMU`);
  }
  if (biteMassQ === 0) {
    return Object.freeze({
      structMassQ: 0,
      structEnergyQ: 0,
      reserveMassQ: 0,
      reserveEnergyQ: 0,
      totalMassQ: 0,
      totalEnergyQ: 0,
    });
  }
  let takeReserve = scaleByRatio(fractions.reserveMassQ, biteMassQ, carrionMassQ, mode);
  const minReserve = biteMassQ > fractions.structMassQ ? biteMassQ - fractions.structMassQ : 0;
  const maxReserve = Math.min(biteMassQ, fractions.reserveMassQ);
  if (takeReserve < minReserve) takeReserve = minReserve;
  if (takeReserve > maxReserve) takeReserve = maxReserve;
  const takeStruct = biteMassQ - takeReserve;
  const structEnergyQ = energyOfMass(takeStruct, RHO_STRUCT);
  const reserveEnergyQ = energyOfMass(takeReserve, RHO_RESERVE);
  return Object.freeze({
    structMassQ: takeStruct,
    structEnergyQ,
    reserveMassQ: takeReserve,
    reserveEnergyQ,
    totalMassQ: takeStruct + takeReserve,
    totalEnergyQ: structEnergyQ + reserveEnergyQ,
  });
}

/**
 * Decomposes `STRUCT (5)` and `RESERVE (30)` fractions of mixed `CELL_CARRION` independently by
 * `ratePpm`, guaranteeing the remaining pool preserves exact `(5, 30)` integer stoichiometry.
 */
export function planCarrionDecomposition(
  carrionMassQ: MassQ,
  carrionEnergyQ: EnergyQ,
  ratePpm: number,
  mode: RoundingMode = 'floor'
): CarrionBitePlan {
  assertPpm(ratePpm, 'decomposition ratePpm');
  const fractions = splitCarrionMass(carrionMassQ, carrionEnergyQ);
  const structMassQ = applyPpm(fractions.structMassQ, ratePpm, mode);
  const reserveMassQ = applyPpm(fractions.reserveMassQ, ratePpm, mode);
  const structEnergyQ = energyOfMass(structMassQ, RHO_STRUCT);
  const reserveEnergyQ = energyOfMass(reserveMassQ, RHO_RESERVE);
  return Object.freeze({
    structMassQ,
    structEnergyQ,
    reserveMassQ,
    reserveEnergyQ,
    totalMassQ: structMassQ + reserveMassQ,
    totalEnergyQ: structEnergyQ + reserveEnergyQ,
  });
}

export interface FeedingAllocationPlan {
  readonly depositMassQ: MassQ;
  readonly depositEnergyQ: EnergyQ;
  readonly egestaMassQ: MassQ;
  readonly egestaEnergyQ: EnergyQ;
  readonly abioticMassQ: MassQ;
  readonly heatQ: EnergyQ;
}

/**
 * Partitions ingested food `(foodMassQ, foodEnergyQ)` into:
 *   - `ORGANISM_RESERVE` at exact `30 EU/MU`,
 *   - `CELL_DETRITUS` at exact `3 EU/MU` (never inheriting carrion or reserve densities),
 *   - `ABIOTIC` returned matter, and
 *   - `HEAT` (SDA + sub-quantum rounding dust + excess unassimilated energy if clamped by mass).
 * Sums equal `foodMassQ` and `foodEnergyQ` with zero quantum residual.
 */
export function planFeedingAllocation(
  foodMassQ: MassQ,
  foodEnergyQ: EnergyQ,
  assimilationPpm: number,
  sdaPpm: number
): FeedingAllocationPlan {
  assertQuanta(foodMassQ, 'foodMassQ');
  assertQuanta(foodEnergyQ, 'foodEnergyQ');
  assertPpm(assimilationPpm, 'assimilationPpm');
  assertPpm(sdaPpm, 'sdaPpm');

  const assimilated = applyPpm(foodEnergyQ, assimilationPpm, 'floor');
  const unassimilatedEnergy = foodEnergyQ - assimilated;
  const sda = applyPpm(assimilated, sdaPpm, 'floor');
  const depositable = assimilated - sda;

  const depositMassQ = Math.min(foodMassQ, massForEnergy(depositable, RHO_RESERVE, 'floor'));
  const depositEnergyQ = energyOfMass(depositMassQ, RHO_RESERVE);

  const remainingMassQ = foodMassQ - depositMassQ;
  const egestaMassQ = Math.min(remainingMassQ, massForEnergy(unassimilatedEnergy, RHO_DETRITUS, 'floor'));
  const egestaEnergyQ = energyOfMass(egestaMassQ, RHO_DETRITUS);

  const abioticMassQ = foodMassQ - depositMassQ - egestaMassQ;
  const heatQ = foodEnergyQ - depositEnergyQ - egestaEnergyQ;

  return Object.freeze({
    depositMassQ,
    depositEnergyQ,
    egestaMassQ,
    egestaEnergyQ,
    abioticMassQ,
    heatQ,
  });
}

export interface ReserveMetabolismPlan {
  readonly burnMassQ: MassQ;
  readonly burnEnergyQ: EnergyQ;
  readonly nextCarryCreditQ: EnergyQ;
  readonly deficitQ: EnergyQ;
}

/**
 * Computes a stoichiometrically exact `ORGANISM_RESERVE` burn for metabolic `demandQ` (qEU):
 *   - Always burns whole `qMU` quanta so `burnEnergyQ === 30 * burnMassQ` (no density drift).
 *   - Accepts an optional `carryCreditQ` (excess qEU prepaid when a previous whole `qMU` covered a
 *     sub-30-qEU demand) so repeated sub-quantum ticks consume `~1 qMU / 30 qEU` accurately
 *     without 30x overburning or false starvation.
 */
export function planReserveMetabolism(
  availableReserveMassQ: MassQ,
  demandQ: EnergyQ,
  carryCreditQ: EnergyQ = 0
): ReserveMetabolismPlan {
  assertQuanta(availableReserveMassQ, 'availableReserveMassQ');
  assertQuanta(demandQ, 'demandQ');
  assertQuanta(carryCreditQ, 'carryCreditQ');

  if (demandQ <= carryCreditQ) {
    return Object.freeze({
      burnMassQ: 0,
      burnEnergyQ: 0,
      nextCarryCreditQ: carryCreditQ - demandQ,
      deficitQ: 0,
    });
  }
  const netDemandQ = demandQ - carryCreditQ;
  const neededMassQ = massForEnergy(netDemandQ, RHO_RESERVE, 'ceil');
  const burnMassQ = Math.min(availableReserveMassQ, neededMassQ);
  const burnEnergyQ = energyOfMass(burnMassQ, RHO_RESERVE);
  if (burnEnergyQ >= netDemandQ) {
    return Object.freeze({
      burnMassQ,
      burnEnergyQ,
      nextCarryCreditQ: burnEnergyQ - netDemandQ,
      deficitQ: 0,
    });
  }
  return Object.freeze({
    burnMassQ,
    burnEnergyQ,
    nextCarryCreditQ: 0,
    deficitQ: netDemandQ - burnEnergyQ,
  });
}

// ---------------------------------------------------------------------------
// Exact wide accumulators (allocation-free alternative to BigInt running totals)
// ---------------------------------------------------------------------------

const LIMB = 281474976710656; // 2^48
const LIMB_BIG = 1n << 48n;
/** Exclusive upper bound of one accumulator: 2^48 * 2^53. */
const ACC_LIMIT_BIG = LIMB_BIG * (1n << 53n);

/**
 * Fixed-size array of exact non-negative integer accumulators, each holding values in
 * [0, 2^101) as two float64 limbs (`hi * 2^48 + lo`). Additions, subtractions, comparisons
 * and copies allocate nothing, which lets transaction COMMIT update world totals without
 * creating BigInt objects. `toBigInt()` is the (allocating) read-side view.
 */
export class ExactAccumulators {
  public readonly length: number;
  private readonly hi: Float64Array;
  private readonly lo: Float64Array;

  constructor(length: number) {
    if (!Number.isSafeInteger(length) || length < 1) {
      throw new UnitsError(`ExactAccumulators length must be a positive integer, received: ${length}`);
    }
    this.length = length;
    this.hi = new Float64Array(length);
    this.lo = new Float64Array(length);
  }

  /** Exact TypedArray footprint in bytes. */
  get byteLength(): number {
    return this.hi.byteLength + this.lo.byteLength;
  }

  private checkIndex(i: number): void {
    if (!(i >= 0 && i < this.length) || (i | 0) !== i) {
      throw new UnitsError(`Accumulator index out of range: ${i}`);
    }
  }

  reset(i: number): void {
    this.checkIndex(i);
    this.hi[i] = 0;
    this.lo[i] = 0;
  }

  resetAll(): void {
    this.hi.fill(0);
    this.lo.fill(0);
  }

  isZero(i: number): boolean {
    this.checkIndex(i);
    return this.hi[i] === 0 && this.lo[i] === 0;
  }

  /** Adds a non-negative safe integer. */
  add(i: number, v: number): void {
    this.checkIndex(i);
    if (!(v >= 0 && v <= LOCAL_MAX_SAFE_INT && Math.floor(v) === v)) {
      throw new UnitsError(`Accumulator add requires a non-negative safe integer, received: ${v}`);
    }
    this.addFast(i, v);
  }

  /** @internal Unchecked add when caller already validated index and non-negative safe integer `v`. */
  addFast(i: number, v: number): void {
    const vHi = v < LIMB ? 0 : Math.floor(v / LIMB);
    const vLo = vHi === 0 ? v : v - vHi * LIMB;
    let lo = this.lo[i] + vLo;
    let hi = this.hi[i] + vHi;
    if (lo >= LIMB) {
      lo -= LIMB;
      hi += 1;
    }
    if (hi > LOCAL_MAX_SAFE_INT) {
      throw new UnitsError('Accumulator overflow (>= 2^101)');
    }
    this.hi[i] = hi;
    this.lo[i] = lo;
  }

  /** Fast non-allocating read as safe number when value <= 2^53 - 1, else null. */
  toSafeInt(i: number): number | null {
    const hi = this.hi[i];
    if (hi === 0) return this.lo[i];
    if (hi < 32) return hi * LIMB + this.lo[i];
    return null;
  }

  /** True when accumulator `i` holds at least `v`. */
  gte(i: number, v: number): boolean {
    this.checkIndex(i);
    if (!(v >= 0 && v <= LOCAL_MAX_SAFE_INT && Math.floor(v) === v)) {
      throw new UnitsError(`Accumulator compare requires a non-negative safe integer, received: ${v}`);
    }
    if (v < LIMB) {
      const hi = this.hi[i];
      return hi > 0 || this.lo[i] >= v;
    }
    const vHi = Math.floor(v / LIMB);
    const hi = this.hi[i];
    return hi > vHi || (hi === vHi && this.lo[i] >= v - vHi * LIMB);
  }

  /** Subtracts a non-negative safe integer; throws when the result would be negative. */
  sub(i: number, v: number): void {
    if (!this.gte(i, v)) {
      throw new UnitsError(`Accumulator underflow: cannot subtract ${v}`);
    }
    const vHi = v < LIMB ? 0 : Math.floor(v / LIMB);
    let lo = this.lo[i] - (vHi === 0 ? v : v - vHi * LIMB);
    let hi = this.hi[i] - vHi;
    if (lo < 0) {
      lo += LIMB;
      hi -= 1;
    }
    this.hi[i] = hi;
    this.lo[i] = lo;
  }

  /** `this[i] += other[j]` */
  addFrom(i: number, other: ExactAccumulators, j: number): void {
    this.checkIndex(i);
    other.checkIndex(j);
    let lo = this.lo[i] + other.lo[j];
    let hi = this.hi[i] + other.hi[j];
    if (lo >= LIMB) {
      lo -= LIMB;
      hi += 1;
    }
    if (hi > LOCAL_MAX_SAFE_INT) {
      throw new UnitsError('Accumulator overflow (>= 2^101)');
    }
    this.hi[i] = hi;
    this.lo[i] = lo;
  }

  /** `this[i] = other[j]` */
  copyFrom(i: number, other: ExactAccumulators, j: number): void {
    this.checkIndex(i);
    other.checkIndex(j);
    this.hi[i] = other.hi[j];
    this.lo[i] = other.lo[j];
  }

  equalsAt(i: number, other: ExactAccumulators, j: number): boolean {
    this.checkIndex(i);
    other.checkIndex(j);
    return this.hi[i] === other.hi[j] && this.lo[i] === other.lo[j];
  }

  toBigInt(i: number): bigint {
    this.checkIndex(i);
    return BigInt(this.hi[i]) * LIMB_BIG + BigInt(this.lo[i]);
  }

  setBigInt(i: number, value: bigint): void {
    this.checkIndex(i);
    assertNonNegativeBig(value, 'accumulator value');
    if (value >= ACC_LIMIT_BIG) {
      throw new UnitsError('Accumulator overflow (>= 2^101)');
    }
    this.hi[i] = Number(value / LIMB_BIG);
    this.lo[i] = Number(value % LIMB_BIG);
  }
}

/**
 * Exactly sums the first `count` quantum values of `values` into accumulator `index`
 * (the accumulator is NOT reset first). Order-independent by construction.
 */
export function sumQuantaInto(
  values: Float64Array,
  count: number,
  acc: ExactAccumulators,
  index: number
): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > values.length) {
    throw new UnitsError(`sumQuantaInto count out of range: ${count}`);
  }
  const HALF = 4503599627370496; // 2^52
  let partial = 0;
  for (let i = 0; i < count; i++) {
    const v = values[i];
    if (!(v >= 0) || v > LOCAL_MAX_SAFE_INT || Math.floor(v) !== v) {
      throw new UnitsError(`Non-quantum value at index ${i}: ${v}`);
    }
    if (v >= HALF) {
      acc.add(index, v);
      continue;
    }
    partial += v; // partial < 2^52 and v < 2^52 => exact
    if (partial >= HALF) {
      acc.add(index, partial);
      partial = 0;
    }
  }
  if (partial > 0) {
    acc.add(index, partial);
  }
}

/** Exact BigInt sum of the first `count` quantum values (allocating convenience wrapper). */
export function sumQuanta(values: Float64Array, count = values.length): bigint {
  const acc = new ExactAccumulators(1);
  sumQuantaInto(values, count, acc, 0);
  return acc.toBigInt(0);
}

// Module-level scratch buffers for allocation-free Largest Remainder tie-breaking in resolveContention
let _rcCap = 64;
let _rcIdx = new Int32Array(_rcCap);
let _rcId = new Float64Array(_rcCap);
let _rcRem = new Float64Array(_rcCap);

function ensureRcCap(n: number): void {
  if (n <= _rcCap) return;
  let next = _rcCap * 2;
  while (next < n) next *= 2;
  _rcCap = next;
  _rcIdx = new Int32Array(next);
  _rcId = new Float64Array(next);
  _rcRem = new Float64Array(next);
}

function sortRcRange(lo: number, hi: number): void {
  if (hi - lo <= 16) {
    for (let i = lo + 1; i <= hi; i++) {
      const idx = _rcIdx[i];
      const id = _rcId[i];
      const rem = _rcRem[i];
      let j = i - 1;
      while (j >= lo) {
        const jRem = _rcRem[j];
        if (jRem > rem || (jRem === rem && _rcId[j] < id)) break;
        _rcIdx[j + 1] = _rcIdx[j];
        _rcId[j + 1] = _rcId[j];
        _rcRem[j + 1] = jRem;
        j--;
      }
      _rcIdx[j + 1] = idx;
      _rcId[j + 1] = id;
      _rcRem[j + 1] = rem;
    }
    return;
  }
  const mid = (lo + hi) >>> 1;
  const pRem = _rcRem[mid];
  const pId = _rcId[mid];
  let i = lo;
  let j = hi;
  while (i <= j) {
    while (_rcRem[i] > pRem || (_rcRem[i] === pRem && _rcId[i] < pId)) i++;
    while (_rcRem[j] < pRem || (_rcRem[j] === pRem && _rcId[j] > pId)) j--;
    if (i <= j) {
      const tIdx = _rcIdx[i];
      _rcIdx[i] = _rcIdx[j];
      _rcIdx[j] = tIdx;
      const tId = _rcId[i];
      _rcId[i] = _rcId[j];
      _rcId[j] = tId;
      const tRem = _rcRem[i];
      _rcRem[i] = _rcRem[j];
      _rcRem[j] = tRem;
      i++;
      j--;
    }
  }
  if (lo < j) sortRcRange(lo, j);
  if (i < hi) sortRcRange(i, hi);
}

/**
 * Splits a limited `available` amount between `count` competing demands deterministically:
 *   - if total demand <= available, every claimant receives its full demand;
 *   - when `organismIds` is provided and total demand > available, uses deterministic Largest
 *     Remainder (Hamilton) allocation: each claimant receives `floor(demand_i * available / total)`,
 *     and the exact integer remainder `available - sum(base)` is awarded (+1 quantum each) by
 *     largest fractional remainder `(demand_i * available) % total` with ties broken strictly by
 *     ascending `organismId`. Zero quanta are lost and permuting inputs yields identical grants
 *     per `organismId`.
 *   - when `organismIds` is omitted (legacy 4-argument form), only the order-independent floor
 *     share is granted so behaviour remains invariant without IDs.
 */
export function resolveContention(
  demands: ArrayLike<number>,
  count: number,
  available: number,
  grants: { [index: number]: number; readonly length: number },
  organismIds?: ArrayLike<number>
): number {
  if (!Number.isSafeInteger(available) || available < 0) {
    throw new UnitsError(`available must be a non-negative safe integer quantum count, received: ${available}`);
  }
  if (!Number.isSafeInteger(count) || count < 0 || count > demands.length || count > grants.length) {
    throw new UnitsError(`resolveContention count out of range: ${count}`);
  }
  if (organismIds !== undefined && count > organismIds.length) {
    throw new UnitsError(`resolveContention organismIds length ${organismIds.length} < count ${count}`);
  }

  let totalBig = 0n;
  let total = 0;
  let wide = false;
  let strictlyAscending = true;
  let prevId = -1;
  for (let i = 0; i < count; i++) {
    const d = demands[i];
    if (!Number.isSafeInteger(d) || d < 0) {
      throw new UnitsError(`demand[${i}] must be a non-negative safe integer quantum count, received: ${d}`);
    }
    if (organismIds !== undefined) {
      const id = organismIds[i];
      if (!Number.isSafeInteger(id) || id < 0) {
        throw new UnitsError(`organismId[${i}] must be a non-negative safe integer, received: ${id}`);
      }
      if (id <= prevId) strictlyAscending = false;
      prevId = id;
    }
    if (!wide) {
      total += d;
      if (total > LOCAL_MAX_SAFE_INT) {
        wide = true;
        totalBig = 0n;
        for (let j = 0; j <= i; j++) totalBig += BigInt(demands[j]);
      }
    } else {
      totalBig += BigInt(d);
    }
  }

  if (organismIds !== undefined && !strictlyAscending && count > 1) {
    const seen = new Set<number>();
    for (let i = 0; i < count; i++) {
      const id = organismIds[i];
      if (seen.has(id)) {
        throw new UnitsError(`resolveContention duplicate organismId: ${id}`);
      }
      seen.add(id);
    }
  }

  if (!wide && total <= available) {
    for (let i = 0; i < count; i++) grants[i] = demands[i];
    return total;
  }
  if (wide && totalBig <= BigInt(available)) {
    for (let i = 0; i < count; i++) grants[i] = demands[i];
    return Number(totalBig);
  }

  let granted = 0;
  if (organismIds === undefined) {
    if (!wide) {
      for (let i = 0; i < count; i++) {
        const g = scaleByRatio(demands[i], available, total, 'floor');
        grants[i] = g;
        granted += g;
      }
      return granted;
    }
    const availBig = BigInt(available);
    for (let i = 0; i < count; i++) {
      const g = Number((BigInt(demands[i]) * availBig) / totalBig);
      grants[i] = g;
      granted += g;
    }
    return granted;
  }

  // Fast allocation-free Largest Remainder when all demands fit in safe integers
  if (!wide) {
    ensureRcCap(count);
    let rcCount = 0;
    let needsBigFallback = false;
    for (let i = 0; i < count; i++) {
      const d = demands[i];
      const pFloat = d * available;
      if (pFloat > LOCAL_MAX_SAFE_INT) {
        needsBigFallback = true;
        break;
      }
      const remNum = pFloat % total;
      const g = (pFloat - remNum) / total;
      grants[i] = g;
      granted += g;
      if (remNum > 0) {
        _rcIdx[rcCount] = i;
        _rcId[rcCount] = organismIds[i];
        _rcRem[rcCount] = remNum;
        rcCount++;
      }
    }
    if (!needsBigFallback) {
      const leftover = available - granted;
      if (leftover > 0 && rcCount > 0) {
        if (rcCount > 1) sortRcRange(0, rcCount - 1);
        const toGive = leftover < rcCount ? leftover : rcCount;
        for (let k = 0; k < toGive; k++) {
          grants[_rcIdx[k]] += 1;
          granted += 1;
        }
      }
      return granted;
    }
    granted = 0;
  }

  // Wide BigInt fallback
  if (!wide) totalBig = BigInt(total);
  const availBig = BigInt(available);
  const rems: Array<{ idx: number; id: number; remBig: bigint; remNum: number }> = [];
  for (let i = 0; i < count; i++) {
    const d = demands[i];
    let g: number;
    let remNum = 0;
    let remBig = 0n;
    const pFloat = d * available;
    if (!wide && pFloat <= LOCAL_MAX_SAFE_INT) {
      remNum = pFloat % total;
      g = (pFloat - remNum) / total;
    } else {
      const prod = BigInt(d) * availBig;
      g = Number(prod / totalBig);
      remBig = prod % totalBig;
    }
    grants[i] = g;
    granted += g;
    if (remNum > 0 || remBig > 0n) {
      rems.push({ idx: i, id: organismIds[i], remBig: remNum > 0 ? BigInt(remNum) : remBig, remNum });
    }
  }

  const leftover = available - granted;
  if (leftover > 0 && rems.length > 0) {
    rems.sort((a, b) => {
      if (a.remNum > 0 && b.remNum > 0) {
        if (b.remNum !== a.remNum) return b.remNum - a.remNum;
      } else if (a.remBig !== b.remBig) {
        return b.remBig > a.remBig ? 1 : -1;
      }
      return a.id - b.id;
    });
    const toGive = Math.min(leftover, rems.length);
    for (let k = 0; k < toGive; k++) {
      grants[rems[k].idx] += 1;
      granted += 1;
    }
  }
  return granted;
}

