import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DET_EXP_MAX,
  DET_EXP_MIN,
  DetMathError,
  MAX_SAFE_INT,
  absBig,
  clampBig,
  detExp,
  detLn,
  detLogistic,
  detPow,
  detPow075,
  detSqrt,
  divCeilBig,
  divFloorBig,
  divHalfEvenBig,
  float64Bits,
  float64Hex,
  floorToSafeInt,
  isqrtBig,
  maxBig,
  minBig,
  mulDivCeilBig,
  mulDivFloorBig,
  mulDivHalfEvenBig,
  pow2Int,
  safeAdd,
  safeMul,
  safeMulDivCeil,
  safeMulDivFloor,
  safeMulDivHalfEven,
  safeSub,
} from './detMath';
import { SeededRng } from './prng';

// --- High-precision reference (pure BigInt fixed point, independent of Math.exp) ---------------

const FP_DIGITS = 60n;
const FP = 10n ** FP_DIGITS;

/** Exact rational value of a finite double as numerator / 2^shift (shift >= 0). */
function doubleToRational(x: number): { num: bigint; shift: bigint } {
  const bits = float64Bits(Math.abs(x));
  const expField = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  const mant = expField === 0 ? frac : frac | (1n << 52n);
  const exp2 = (expField === 0 ? 1 : expField) - 1075;
  const sign = x < 0 ? -1n : 1n;
  if (exp2 >= 0) return { num: sign * (mant << BigInt(exp2)), shift: 0n };
  return { num: sign * mant, shift: BigInt(-exp2) };
}

function doubleToFixed(x: number): bigint {
  const { num, shift } = doubleToRational(x);
  return (num * FP) >> shift;
}

/** exp(x) in fixed point via Taylor series on the exact value of the double `x` (|x| <= ~40). */
function expFixed(x: number): bigint {
  const xf = doubleToFixed(x);
  let term = FP;
  let sum = FP;
  for (let n = 1n; n < 400n; n++) {
    term = (term * xf) / (FP * n);
    if (term === 0n) break;
    sum += term;
  }
  return sum;
}

/** |a - b| / b as a float, computed in BigInt to avoid cancellation. */
function relErr(valueFixed: bigint, refFixed: bigint): number {
  const diff = absBig(valueFixed - refFixed);
  return Number((diff * 10n ** 30n) / absBig(refFixed)) / 1e30;
}

const ULP = 2 ** -52;

test('detMath: exact BigInt floor/ceil/half-even division for all sign combinations', () => {
  assert.equal(divFloorBig(7n, 2n), 3n);
  assert.equal(divFloorBig(-7n, 2n), -4n);
  assert.equal(divFloorBig(-8n, 2n), -4n);
  assert.equal(divCeilBig(7n, 2n), 4n);
  assert.equal(divCeilBig(-7n, 2n), -3n);
  assert.equal(divCeilBig(8n, 2n), 4n);
  // ties to even
  assert.equal(divHalfEvenBig(5n, 2n), 2n);
  assert.equal(divHalfEvenBig(7n, 2n), 4n);
  assert.equal(divHalfEvenBig(-5n, 2n), -2n);
  assert.equal(divHalfEvenBig(-7n, 2n), -4n);
  assert.equal(divHalfEvenBig(10n, 4n), 2n);
  assert.equal(divHalfEvenBig(14n, 4n), 4n);
  assert.equal(divHalfEvenBig(11n, 4n), 3n);
  assert.equal(divHalfEvenBig(9n, 4n), 2n);
  for (const fn of [divFloorBig, divCeilBig, divHalfEvenBig]) {
    assert.throws(() => fn(1n, 0n), DetMathError);
    assert.throws(() => fn(1n, -3n), DetMathError);
  }
});

test('detMath: mulDiv BigInt variants are exact far beyond 2^64 and satisfy floor <= half-even <= ceil', () => {
  const a = 2n ** 200n + 12345678901234567890n;
  const b = 3n ** 90n;
  const d = 10n ** 37n + 7n;
  const f = mulDivFloorBig(a, b, d);
  const c = mulDivCeilBig(a, b, d);
  const h = mulDivHalfEvenBig(a, b, d);
  assert.ok(f * d <= a * b && (f + 1n) * d > a * b);
  assert.equal(c, f + 1n);
  assert.ok(h === f || h === c);
  assert.equal(mulDivFloorBig(10n, 3n, 5n), 6n);
  assert.equal(mulDivCeilBig(10n, 3n, 4n), 8n);
  assert.equal(minBig(3n, -1n), -1n);
  assert.equal(maxBig(3n, -1n), 3n);
  assert.equal(absBig(-5n), 5n);
  assert.equal(clampBig(15n, 0n, 10n), 10n);
  assert.equal(clampBig(-1n, 0n, 10n), 0n);
  assert.throws(() => clampBig(1n, 5n, 4n), DetMathError);
});

test('detMath: isqrtBig returns the exact integer square root including huge and boundary values', () => {
  for (let n = 0n; n < 300n; n++) {
    const r = isqrtBig(n);
    assert.ok(r * r <= n && (r + 1n) * (r + 1n) > n, `isqrt(${n})`);
  }
  const big = 10n ** 61n + 12345n;
  const r = isqrtBig(big);
  assert.ok(r * r <= big && (r + 1n) * (r + 1n) > big);
  assert.equal(isqrtBig((2n ** 100n) ** 2n), 2n ** 100n);
  assert.equal(isqrtBig((2n ** 100n) ** 2n - 1n), 2n ** 100n - 1n);
  assert.throws(() => isqrtBig(-1n), DetMathError);
});

test('detMath: safe integer add/sub/mul never overflow silently and reject invalid inputs', () => {
  assert.equal(safeAdd(MAX_SAFE_INT - 1, 1), MAX_SAFE_INT);
  assert.throws(() => safeAdd(MAX_SAFE_INT, 1), DetMathError);
  assert.equal(safeSub(5, 5), 0);
  assert.throws(() => safeSub(5, 6), DetMathError);
  assert.equal(safeMul(94906265, 94906265), 9007199136250225);
  assert.throws(() => safeMul(94906266, 94906266), DetMathError);
  assert.throws(() => safeMul(2 ** 27, 2 ** 26), DetMathError); // exactly 2^53
  assert.equal(safeMul(0, MAX_SAFE_INT), 0);
  for (const bad of [NaN, Infinity, -1, 1.5, 2 ** 53]) {
    assert.throws(() => safeAdd(bad, 1), DetMathError);
    assert.throws(() => safeSub(bad, 0), DetMathError);
    assert.throws(() => safeMul(1, bad), DetMathError);
  }
});

test('detMath: safeMulDiv floor/ceil/half-even match exact BigInt results on fast and wide paths', () => {
  const rng = new SeededRng('detmath-muldiv');
  for (let i = 0; i < 4000; i++) {
    const wide = i % 2 === 0;
    const wideInt = (): number => rng.nextInt(0, 2 ** 21 - 1) * 2 ** 32 + rng.nextInt(0, 2 ** 32 - 1);
    const a = wide ? wideInt() : rng.nextInt(0, 2 ** 26);
    const den = wide ? Math.min(MAX_SAFE_INT, wideInt() + 1) : rng.nextInt(1, 2 ** 26);
    const num = wide ? Math.min(den, rng.nextInt(0, 2 ** 20)) : rng.nextInt(0, 2 ** 26);
    const exactN = BigInt(a) * BigInt(num);
    const d = BigInt(den);
    assert.equal(BigInt(safeMulDivFloor(a, num, den)), exactN / d);
    assert.equal(BigInt(safeMulDivCeil(a, num, den)), divCeilBig(exactN, d));
    assert.equal(BigInt(safeMulDivHalfEven(a, num, den)), divHalfEvenBig(exactN, d));
  }
  // Classic float trap: floor((2^53 - 1) * 1 / 1) and near-integer quotients
  assert.equal(safeMulDivFloor(MAX_SAFE_INT, 1, 1), MAX_SAFE_INT);
  assert.equal(safeMulDivFloor(MAX_SAFE_INT, MAX_SAFE_INT, MAX_SAFE_INT), MAX_SAFE_INT);
  assert.equal(safeMulDivFloor(9007199254740990, 3, 9007199254740991), 2);
  assert.throws(() => safeMulDivFloor(MAX_SAFE_INT, 2, 1), DetMathError);
  assert.throws(() => safeMulDivCeil(MAX_SAFE_INT, MAX_SAFE_INT, 1), DetMathError);
  assert.throws(() => safeMulDivFloor(1, 1, 0), DetMathError);
  assert.throws(() => safeMulDivFloor(1, -1, 1), DetMathError);
  assert.throws(() => safeMulDivHalfEven(1.5, 1, 1), DetMathError);
});

test('detMath: floorToSafeInt is a strict validation choke point', () => {
  assert.equal(floorToSafeInt(0), 0);
  assert.equal(floorToSafeInt(12.999), 12);
  assert.equal(floorToSafeInt(MAX_SAFE_INT), MAX_SAFE_INT);
  for (const bad of [NaN, -0.0001, -1, Infinity, -Infinity, 2 ** 53]) {
    assert.throws(() => floorToSafeInt(bad), DetMathError);
  }
});

test('detMath: pow2Int is exact over the whole float64 exponent range', () => {
  assert.equal(pow2Int(0), 1);
  assert.equal(pow2Int(10), 1024);
  assert.equal(pow2Int(-1), 0.5);
  assert.equal(pow2Int(1023), 8.98846567431158e307);
  assert.equal(pow2Int(-1074), 5e-324);
  assert.equal(pow2Int(-1022), 2.2250738585072014e-308);
  for (let k = -1073; k <= 1023; k++) {
    assert.equal(pow2Int(k) / pow2Int(k - 1), 2);
  }
  assert.throws(() => pow2Int(1024), DetMathError);
  assert.throws(() => pow2Int(-1075), DetMathError);
  assert.throws(() => pow2Int(0.5), DetMathError);
});

test('detExp: exact identities, domain boundaries, and overflow protection', () => {
  assert.equal(detExp(0), 1);
  assert.equal(detExp(-0), 1);
  assert.equal(detExp(-Infinity), 0);
  assert.equal(detExp(DET_EXP_MIN - 1e-9), 0);
  assert.equal(detExp(-1000), 0);
  assert.ok(detExp(DET_EXP_MAX) > 1.79e308 && Number.isFinite(detExp(DET_EXP_MAX)));
  assert.ok(detExp(-745) > 0, 'smallest subnormal results are still positive');
  assert.throws(() => detExp(DET_EXP_MAX + 1e-9), DetMathError);
  assert.throws(() => detExp(710), DetMathError);
  assert.throws(() => detExp(Infinity), DetMathError);
  assert.throws(() => detExp(NaN), DetMathError);
  assert.throws(() => detExp('1' as unknown as number), DetMathError);
});

test('detExp: relative error stays below 4 ulp against a 60-digit BigInt reference', () => {
  const rng = new SeededRng('detexp-accuracy');
  let worst = 0;
  const samples: number[] = [1, -1, 0.5, -0.5, 1e-10, -1e-10, 1e-300, 0.34657359027997264, -0.34657359027997264, 30, -30, Math.LN2, 10, -10];
  for (let i = 0; i < 1500; i++) samples.push(rng.range(-35, 35));
  for (let i = 0; i < 300; i++) samples.push(rng.range(-1, 1) * 1e-3);
  for (const x of samples) {
    const got = detExp(x);
    const err = relErr(doubleToFixed(got), expFixed(x));
    if (err > worst) worst = err;
    assert.ok(err <= 4 * ULP, `detExp(${x}) relative error ${err} exceeds 4 ulp`);
  }
  assert.ok(worst > 0, 'reference comparison must be non-trivial');
});

test('detExp: agrees with the platform Math.exp within 2 ulp-level tolerance over the full range', () => {
  const rng = new SeededRng('detexp-range');
  for (let i = 0; i < 5000; i++) {
    const x = rng.range(-700, 709);
    const got = detExp(x);
    const ref = Math.exp(x);
    assert.ok(Math.abs(got - ref) <= 1e-15 * ref, `detExp(${x}) = ${got}, Math.exp = ${ref}`);
  }
});

test('detExp: monotonic non-decreasing across dense samples and reduction boundaries', () => {
  let prev = detExp(-40);
  for (let i = 1; i <= 80000; i++) {
    const x = -40 + i * 0.001;
    const v = detExp(x);
    assert.ok(v >= prev, `detExp not monotonic at ${x}`);
    prev = v;
  }
  // Around k * ln2 / 2 boundaries with adjacent doubles
  for (let k = -20; k <= 20; k++) {
    const b = (k + 0.5) * Math.LN2;
    const eps = Math.abs(b) * 2 ** -52 || 2 ** -60;
    let p = detExp(b - 8 * eps);
    for (let j = -7; j <= 8; j++) {
      const v = detExp(b + j * eps);
      assert.ok(v >= p, `detExp not monotonic near reduction boundary k=${k}`);
      p = v;
    }
  }
});

test('detExp/detLn: pinned IEEE-754 bit patterns guard cross-engine determinism', () => {
  const pinned: Array<[string, number, string]> = [
    ['exp(1)', detExp(1), '4005bf0a8b14576a'],
    ['exp(-1)', detExp(-1), '3fd78b56362cef38'],
    ['exp(0.5)', detExp(0.5), '3ffa61298e1e069c'],
    ['exp(-0.5)', detExp(-0.5), '3fe368b2fc6f960a'],
    ['exp(10)', detExp(10), '40d5829dcf950560'],
    ['exp(-20)', detExp(-20), '3e21b48655f37267'],
    ['exp(100)', detExp(100), '48f3494a9b171bf5'],
    ['exp(709)', detExp(709), '7fdd422d2be5dc9b'],
    ['exp(-745)', detExp(-745), '0000000000000001'],
    ['ln(2)', detLn(2), '3fe62e42fefa39ef'],
    ['ln(10)', detLn(10), '40026bb1bbb55516'],
    ['ln(0.1)', detLn(0.1), 'c0026bb1bbb55515'],
    ['ln(3)', detLn(3), '3ff193ea7aad030b'],
    ['ln(1e-310)', detLn(1e-310), 'c0864e69394d9508'],
  ];
  for (const [label, value, hex] of pinned) {
    assert.equal(float64Hex(value), hex, `${label} bit pattern`);
  }
});

test('detLn: domain validation, exact identities, and accuracy against the BigInt exp reference', () => {
  assert.equal(detLn(1), 0);
  for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
    assert.throws(() => detLn(bad), DetMathError);
  }
  // Exactly representable multiples of ln2 at powers of two
  assert.equal(detLn(2), Math.LN2);
  assert.equal(detLn(0.5), -Math.LN2);
  assert.equal(detLn(1024), 10 * detLn(2));

  const rng = new SeededRng('detln-accuracy');
  const samples: number[] = [2, 3, 10, 0.1, 1.0000001, 0.9999999, 1.4142135623730951, 1.4142135623730954, 0.7071067811865476];
  for (let i = 0; i < 1200; i++) samples.push(detExp(rng.range(-30, 30)));
  for (const x of samples) {
    const y = detLn(x);
    // exp(y) must reproduce x: |exp(y) - x| / x ~= |error(y)|
    const err = relErr(expFixed(y), doubleToFixed(x));
    const bound = 4 * ULP * Math.max(Math.abs(y), 2 ** -40);
    assert.ok(err <= bound, `detLn(${x}) = ${y}: implied abs error ${err} > ${bound}`);
  }
  for (let i = 0; i < 3000; i++) {
    const x = detExp(rng.range(-700, 700));
    const got = detLn(x);
    const ref = Math.log(x);
    assert.ok(Math.abs(got - ref) <= 1e-15 * Math.max(1, Math.abs(ref)), `detLn(${x})`);
  }
  // Subnormal inputs
  assert.ok(Math.abs(detLn(5e-324) - Math.log(5e-324)) < 1e-12);
  assert.ok(Math.abs(detLn(Number.MAX_VALUE) - Math.log(Number.MAX_VALUE)) < 1e-12);
});

test('detPow / detSqrt / detPow075 / detLogistic: identities, validation, and accuracy', () => {
  assert.equal(detPow(5, 0), 1);
  assert.equal(detPow(0, 3), 0);
  assert.equal(detPow(1, 1e9), 1);
  assert.throws(() => detPow(0, -1), DetMathError);
  assert.throws(() => detPow(-2, 2), DetMathError);
  assert.throws(() => detPow(NaN, 2), DetMathError);
  assert.throws(() => detPow(2, Infinity), DetMathError);
  assert.throws(() => detPow(10, 400), DetMathError);
  const rng = new SeededRng('detpow');
  for (let i = 0; i < 2000; i++) {
    const b = rng.range(0.1, 10);
    const y = rng.range(-8, 8);
    const got = detPow(b, y);
    const ref = Math.pow(b, y);
    assert.ok(Math.abs(got - ref) <= 1e-13 * ref, `detPow(${b}, ${y})`);
  }
  // Q10-style factor: 2^((T - 20) / 10)
  assert.ok(Math.abs(detPow(2, 1) - 2) <= 4 * ULP * 2);
  assert.ok(Math.abs(detPow(2.5, -0.7) - Math.pow(2.5, -0.7)) < 1e-15);

  assert.equal(detSqrt(16), 4);
  assert.equal(detSqrt(0), 0);
  assert.throws(() => detSqrt(-1), DetMathError);
  assert.throws(() => detSqrt(NaN), DetMathError);
  assert.throws(() => detSqrt(Infinity), DetMathError);

  assert.equal(detPow075(16), 8);
  assert.equal(detPow075(81), 27);
  assert.equal(detPow075(0), 0);
  assert.equal(detPow075(1), 1);
  assert.equal(detPow075(10000), 1000);
  for (let i = 0; i < 500; i++) {
    const m = rng.range(1e-6, 1e6);
    assert.ok(Math.abs(detPow075(m) - Math.pow(m, 0.75)) <= 1e-14 * Math.pow(m, 0.75));
  }
  assert.throws(() => detPow075(-1), DetMathError);

  assert.equal(detLogistic(0), 0.5);
  assert.equal(detLogistic(1000), 1);
  assert.equal(detLogistic(-1000), 0);
  assert.equal(detLogistic(Infinity), 1);
  assert.equal(detLogistic(-Infinity), 0);
  assert.throws(() => detLogistic(NaN), DetMathError);
  for (let i = 0; i < 500; i++) {
    const x = rng.range(-30, 30);
    const s = detLogistic(x) + detLogistic(-x);
    assert.ok(Math.abs(s - 1) <= 4 * ULP, `logistic symmetry at ${x}`);
    assert.ok(detLogistic(x) >= 0 && detLogistic(x) <= 1);
  }
});

test('detMath: repeated evaluation is bit-identical and never consumes or perturbs PRNG state', () => {
  const rng = new SeededRng('detmath-prng-isolation');
  const control = new SeededRng('detmath-prng-isolation');
  const xs: number[] = [];
  for (let i = 0; i < 200; i++) {
    xs.push(rng.range(-50, 50));
    control.range(-50, 50);
  }
  const stateBefore = rng.getState();
  const first = xs.map((x) => float64Hex(detExp(x)) + float64Hex(detLn(Math.abs(x) + 1e-9)) + float64Hex(detPow075(Math.abs(x))));
  const second = xs.map((x) => float64Hex(detExp(x)) + float64Hex(detLn(Math.abs(x) + 1e-9)) + float64Hex(detPow075(Math.abs(x))));
  assert.deepEqual(first, second);
  assert.equal(rng.getState(), stateBefore);
  assert.equal(rng.nextUint32(), control.nextUint32());
});
