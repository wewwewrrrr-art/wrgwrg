/**
 * Deterministic mathematics for the Living World Simulation (`src/sim/`), Phase 2.2.1b / P0.
 *
 * Reproducibility contract
 * ------------------------
 * Every function in this module is built exclusively from operations whose results are
 * fully specified by IEEE-754 / ECMAScript and therefore bit-identical on every conforming
 * engine and CPU:
 *   - `+`, `-`, `*`, `/` on float64 (correctly rounded, round-half-to-even),
 *   - `Math.sqrt` (correctly rounded), `Math.floor`, `Math.round`, `Math.abs`, `%`,
 *   - BigInt arithmetic (exact),
 *   - `DataView` bit access with explicit endianness.
 *
 * `Math.exp`, `Math.log`, `Math.pow`, `Math.sin`, ... are implementation-approximated in
 * ECMAScript and are intentionally NOT used here. No function touches `Math.random()` or the
 * simulation PRNG streams.
 */

export class DetMathError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'DetMathError';
  }
}

export const MAX_SAFE_INT = Number.MAX_SAFE_INTEGER; // 2^53 - 1
export const MAX_SAFE_BIG = BigInt(Number.MAX_SAFE_INTEGER);

// ---------------------------------------------------------------------------
// Exact BigInt arithmetic
// ---------------------------------------------------------------------------

function assertPositiveDivisor(d: bigint): void {
  if (d <= 0n) {
    throw new DetMathError(`Divisor must be > 0, received: ${d}`);
  }
}

/** Exact floor division (rounds toward -Infinity) for any sign of `a`; `d` must be > 0. */
export function divFloorBig(a: bigint, d: bigint): bigint {
  assertPositiveDivisor(d);
  const q = a / d; // truncates toward zero
  return a % d < 0n ? q - 1n : q;
}

/** Exact ceiling division (rounds toward +Infinity) for any sign of `a`; `d` must be > 0. */
export function divCeilBig(a: bigint, d: bigint): bigint {
  assertPositiveDivisor(d);
  const q = a / d;
  return a % d > 0n ? q + 1n : q;
}

/** Exact division rounded to nearest, ties to even (banker's rounding); `d` must be > 0. */
export function divHalfEvenBig(a: bigint, d: bigint): bigint {
  const q = divFloorBig(a, d);
  const r = a - q * d; // 0 <= r < d
  const twice = r * 2n;
  if (twice < d) return q;
  if (twice > d) return q + 1n;
  return (q & 1n) === 0n ? q : q + 1n;
}

/** Exact `floor(a * b / d)` without intermediate overflow. */
export function mulDivFloorBig(a: bigint, b: bigint, d: bigint): bigint {
  return divFloorBig(a * b, d);
}

/** Exact `ceil(a * b / d)` without intermediate overflow. */
export function mulDivCeilBig(a: bigint, b: bigint, d: bigint): bigint {
  return divCeilBig(a * b, d);
}

/** Exact `round-half-even(a * b / d)` without intermediate overflow. */
export function mulDivHalfEvenBig(a: bigint, b: bigint, d: bigint): bigint {
  return divHalfEvenBig(a * b, d);
}

export function absBig(a: bigint): bigint {
  return a < 0n ? -a : a;
}

export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function clampBig(value: bigint, lo: bigint, hi: bigint): bigint {
  if (hi < lo) {
    throw new DetMathError(`clampBig bounds invalid: [${lo}, ${hi}]`);
  }
  return value < lo ? lo : value > hi ? hi : value;
}

/** Exact integer square root: largest `r` with `r * r <= n`. */
export function isqrtBig(n: bigint): bigint {
  if (n < 0n) {
    throw new DetMathError(`isqrtBig requires n >= 0, received: ${n}`);
  }
  if (n < 2n) return n;
  // Newton iteration starting from a power of two >= sqrt(n)
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

// ---------------------------------------------------------------------------
// Exact safe-integer arithmetic in the float64 domain
// ---------------------------------------------------------------------------

export function isSafeNonNegativeInt(x: number): boolean {
  return Number.isSafeInteger(x) && x >= 0;
}

export function assertSafeNonNegativeInt(x: number, label: string): number {
  if (!Number.isSafeInteger(x) || x < 0) {
    throw new DetMathError(`${label} must be a non-negative safe integer, received: ${x}`);
  }
  return x;
}

/** Exact `a + b`; throws instead of silently leaving the safe-integer range. */
export function safeAdd(a: number, b: number): number {
  assertSafeNonNegativeInt(a, 'safeAdd a');
  assertSafeNonNegativeInt(b, 'safeAdd b');
  const s = a + b;
  if (s > MAX_SAFE_INT) {
    throw new DetMathError(`safeAdd overflow: ${a} + ${b} exceeds 2^53 - 1`);
  }
  return s;
}

/** Exact `a - b`; throws when the result would be negative. */
export function safeSub(a: number, b: number): number {
  assertSafeNonNegativeInt(a, 'safeSub a');
  assertSafeNonNegativeInt(b, 'safeSub b');
  if (b > a) {
    throw new DetMathError(`safeSub underflow: ${a} - ${b} would be negative`);
  }
  return a - b;
}

/** Exact `a * b`; throws instead of silently leaving the safe-integer range. */
export function safeMul(a: number, b: number): number {
  assertSafeNonNegativeInt(a, 'safeMul a');
  assertSafeNonNegativeInt(b, 'safeMul b');
  // If the true product is <= 2^53 - 1 the float product is exact; if it is >= 2^53 the
  // rounded float product is also >= 2^53, so this comparison never misses an overflow.
  const p = a * b;
  if (p > MAX_SAFE_INT) {
    throw new DetMathError(`safeMul overflow: ${a} * ${b} exceeds 2^53 - 1`);
  }
  return p;
}

function bigResultToSafe(q: bigint, what: string): number {
  if (q > MAX_SAFE_BIG) {
    throw new DetMathError(`${what} overflow: result ${q} exceeds 2^53 - 1`);
  }
  return Number(q);
}

function assertMulDivArgs(a: number, num: number, den: number, what: string): void {
  assertSafeNonNegativeInt(a, `${what} a`);
  assertSafeNonNegativeInt(num, `${what} num`);
  if (!Number.isSafeInteger(den) || den <= 0) {
    throw new DetMathError(`${what} den must be a positive safe integer, received: ${den}`);
  }
}

/** Exact `floor(a * num / den)` for non-negative safe integers (BigInt fallback on wide products). */
export function safeMulDivFloor(a: number, num: number, den: number): number {
  assertMulDivArgs(a, num, den, 'safeMulDivFloor');
  const p = a * num;
  if (p <= MAX_SAFE_INT) {
    // `%` is exact (fmod), p - r is an exact multiple of den, so the division is exact.
    return (p - (p % den)) / den;
  }
  return bigResultToSafe(BigInt(a) * BigInt(num) / BigInt(den), 'safeMulDivFloor');
}

/** Exact `ceil(a * num / den)` for non-negative safe integers. */
export function safeMulDivCeil(a: number, num: number, den: number): number {
  assertMulDivArgs(a, num, den, 'safeMulDivCeil');
  const p = a * num;
  if (p <= MAX_SAFE_INT) {
    const r = p % den;
    const q = (p - r) / den;
    return r === 0 ? q : q + 1; // q + 1 <= p <= 2^53 - 1 whenever r > 0
  }
  return bigResultToSafe(
    divCeilBig(BigInt(a) * BigInt(num), BigInt(den)),
    'safeMulDivCeil'
  );
}

/** Exact `round-half-even(a * num / den)` for non-negative safe integers. */
export function safeMulDivHalfEven(a: number, num: number, den: number): number {
  assertMulDivArgs(a, num, den, 'safeMulDivHalfEven');
  return bigResultToSafe(
    divHalfEvenBig(BigInt(a) * BigInt(num), BigInt(den)),
    'safeMulDivHalfEven'
  );
}

/**
 * Validated float -> integer choke point: `floor(x)` for finite `0 <= x <= 2^53 - 1`.
 * Rejects NaN, negative values, and Infinity instead of propagating them.
 */
export function floorToSafeInt(x: number, label = 'value'): number {
  if (!(x >= 0) || x > MAX_SAFE_INT) {
    throw new DetMathError(`${label} must be finite and in [0, 2^53 - 1], received: ${x}`);
  }
  return Math.floor(x);
}

// ---------------------------------------------------------------------------
// Float64 bit access
// ---------------------------------------------------------------------------

const scratchView = new DataView(new ArrayBuffer(8));

/** Returns the raw IEEE-754 bits of `x` as an unsigned 64-bit BigInt. */
export function float64Bits(x: number): bigint {
  scratchView.setFloat64(0, x, false);
  return scratchView.getBigUint64(0, false);
}

/** Hex representation of the IEEE-754 bits of `x` (16 lowercase hex digits). */
export function float64Hex(x: number): string {
  return float64Bits(x).toString(16).padStart(16, '0');
}

/** Exact powers of two 2^k for k in [-1074, 1023], built only with exact doublings/halvings. */
const POW2_MIN = -1074;
const POW2_MAX = 1023;
const POW2 = new Float64Array(POW2_MAX - POW2_MIN + 1);
{
  let v = 1;
  for (let k = 0; k <= POW2_MAX; k++) {
    POW2[k - POW2_MIN] = v;
    v *= 2;
  }
  v = 1;
  for (let k = 0; k >= POW2_MIN; k--) {
    POW2[k - POW2_MIN] = v;
    v *= 0.5;
  }
}

/** Exact `2^k` for integer `k` in [-1074, 1023]. */
export function pow2Int(k: number): number {
  if (!Number.isInteger(k) || k < POW2_MIN || k > POW2_MAX) {
    throw new DetMathError(`pow2Int exponent must be an integer in [-1074, 1023], received: ${k}`);
  }
  return POW2[k - POW2_MIN];
}

// ---------------------------------------------------------------------------
// detExp / detLn / detPow
// ---------------------------------------------------------------------------

/** High part of ln(2) with 21 trailing zero mantissa bits, so `k * LN2_HI` is exact for |k| < 2^11. */
const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700;

/** Largest argument for which exp(x) is finite in float64. */
export const DET_EXP_MAX = 709.782712893384;
/** Arguments below this value underflow to exactly 0. */
export const DET_EXP_MIN = -745.2;

/**
 * Deterministic natural exponential.
 *
 * Contract:
 * - Input must be a number; `NaN` and arguments above `DET_EXP_MAX` (including `+Infinity`)
 *   throw `DetMathError` (no silent overflow to Infinity).
 * - Arguments below `DET_EXP_MIN` (including `-Infinity`) return exactly `0`.
 * - `detExp(0) === 1` exactly; the function is non-decreasing over its domain samples.
 * - Result is bit-identical on every IEEE-754 conforming engine (basic operations only).
 * - Accuracy: relative error below 4 ulp (~9e-16) versus the true value over the normal range.
 *
 * Algorithm: x = k*ln2 + r with |r| <= ln2/2 (two-part Cody-Waite reduction), degree-13
 * Taylor polynomial in Horner form with exact-division coefficients, exact scaling by 2^k.
 */
export function detExp(x: number): number {
  if (typeof x !== 'number' || x !== x) {
    throw new DetMathError(`detExp argument must be a number, received: ${x}`);
  }
  if (x > DET_EXP_MAX) {
    throw new DetMathError(`detExp overflow: argument ${x} exceeds ${DET_EXP_MAX}`);
  }
  if (x < DET_EXP_MIN) {
    return 0;
  }
  if (x === 0) {
    return 1;
  }

  const k = Math.round(x * INV_LN2);
  const r = x - k * LN2_HI - k * LN2_LO;

  // exp(r) = 1 + r(1 + r/2(1 + r/3(... (1 + r/13))))
  let p = 1 + r / 13;
  p = 1 + (r / 12) * p;
  p = 1 + (r / 11) * p;
  p = 1 + (r / 10) * p;
  p = 1 + (r / 9) * p;
  p = 1 + (r / 8) * p;
  p = 1 + (r / 7) * p;
  p = 1 + (r / 6) * p;
  p = 1 + (r / 5) * p;
  p = 1 + (r / 4) * p;
  p = 1 + (r / 3) * p;
  p = 1 + (r / 2) * p;
  p = 1 + r * p;

  // Two-step exact scaling keeps the intermediate normal; at most one rounding (subnormal results).
  const k1 = Math.floor(k / 2);
  const k2 = k - k1;
  const result = p * POW2[k1 - POW2_MIN] * POW2[k2 - POW2_MIN];
  if (result === Infinity) {
    throw new DetMathError(`detExp overflow: argument ${x}`);
  }
  return result;
}

const SQRT2 = 1.4142135623730951;

/**
 * Deterministic natural logarithm for finite `x > 0` (throws `DetMathError` otherwise).
 * Bit-identical across engines; relative error below ~4 ulp.
 *
 * Algorithm: x = m * 2^e with m in [sqrt(1/2), sqrt(2)), ln(m) = 2*atanh((m-1)/(m+1)).
 */
export function detLn(x: number): number {
  if (typeof x !== 'number' || !(x > 0) || x === Infinity) {
    throw new DetMathError(`detLn argument must be finite and > 0, received: ${x}`);
  }
  if (x === 1) return 0;

  let e = 0;
  let v = x;
  if (v < 2.2250738585072014e-308) {
    // Subnormal: scale exactly into the normal range first
    v *= POW2[54 - POW2_MIN];
    e = -54;
  }
  scratchView.setFloat64(0, v, false);
  const hiWord = scratchView.getUint32(0, false);
  e += ((hiWord >>> 20) & 0x7ff) - 1023;
  // Force exponent field to 1023 => mantissa m in [1, 2)
  scratchView.setUint32(0, (hiWord & 0x000fffff) | 0x3ff00000, false);
  let m = scratchView.getFloat64(0, false);
  if (m > SQRT2) {
    m *= 0.5; // exact
    e += 1;
  }

  const s = (m - 1) / (m + 1);
  const z = s * s;
  // atanh series: s * (1 + z/3 + z^2/5 + ... + z^11/23), |s| <= 0.1716
  let t = 1 / 23;
  t = 1 / 21 + z * t;
  t = 1 / 19 + z * t;
  t = 1 / 17 + z * t;
  t = 1 / 15 + z * t;
  t = 1 / 13 + z * t;
  t = 1 / 11 + z * t;
  t = 1 / 9 + z * t;
  t = 1 / 7 + z * t;
  t = 1 / 5 + z * t;
  t = 1 / 3 + z * t;
  t = 1 + z * t;
  const lnM = 2 * s * t;
  return e * LN2_HI + (lnM + e * LN2_LO);
}

/**
 * Deterministic power `base^exponent` for `base >= 0` computed as `detExp(exponent * detLn(base))`.
 * Accuracy degrades with |exponent * ln(base)| (relative error ~ |y ln b| * 2^-52 plus a few ulp);
 * intended for moderate arguments such as Q10 temperature factors. Throws on negative bases,
 * non-finite arguments, `0^negative`, and overflow.
 */
export function detPow(base: number, exponent: number): number {
  if (typeof base !== 'number' || typeof exponent !== 'number' || !Number.isFinite(base) || !Number.isFinite(exponent)) {
    throw new DetMathError(`detPow arguments must be finite numbers, received: (${base}, ${exponent})`);
  }
  if (base < 0) {
    throw new DetMathError(`detPow base must be >= 0, received: ${base}`);
  }
  if (exponent === 0) return 1;
  if (base === 0) {
    if (exponent < 0) {
      throw new DetMathError('detPow: 0 raised to a negative exponent');
    }
    return 0;
  }
  if (base === 1) return 1;
  return detExp(exponent * detLn(base));
}

/** Correctly rounded square root with validation (`Math.sqrt` is exactly specified by IEEE-754). */
export function detSqrt(x: number): number {
  if (typeof x !== 'number' || !(x >= 0) || x === Infinity) {
    throw new DetMathError(`detSqrt argument must be finite and >= 0, received: ${x}`);
  }
  return Math.sqrt(x);
}

/**
 * Deterministic `x^0.75` (allometric metabolic scaling) as `sqrt(x) * sqrt(sqrt(x))`:
 * two correctly rounded square roots and one multiplication.
 */
export function detPow075(x: number): number {
  const s = detSqrt(x);
  return s * Math.sqrt(s);
}

/** Deterministic logistic function `1 / (1 + e^-x)`; saturates to exactly 0 / 1 for huge |x|. */
export function detLogistic(x: number): number {
  if (typeof x !== 'number' || x !== x) {
    throw new DetMathError(`detLogistic argument must be a number, received: ${x}`);
  }
  if (x >= 0) {
    return 1 / (1 + detExp(-x));
  }
  const ex = detExp(x);
  return ex / (1 + ex);
}
