import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_SAFE_INT } from './detMath';
import { SeededRng } from './prng';
import {
  EU_DECIMALS,
  EU_QUANTA_PER_UNIT,
  ExactAccumulators,
  MAX_QUANTA,
  MU_DECIMALS,
  MU_QUANTA_PER_UNIT,
  PPM,
  RHO_DETRITUS,
  RHO_PLANT,
  RHO_RESERVE,
  RHO_STRUCT,
  SCALES_CONFIRMED_AGAINST_REVISION_3,
  UnitsError,
  applyPpm,
  assertNonNegativeBig,
  assertPpm,
  assertQuanta,
  bigToQuanta,
  decimalToQuanta,
  energyDensity,
  energyOfMass,
  euToQ,
  formatEU,
  formatMU,
  fractionToPpm,
  hasExactDensity,
  isQuanta,
  isValidCarrionMix,
  massForEnergy,
  muToQ,
  numberToQuanta,
  parseEU,
  parseMU,
  planCarrionConsumption,
  planCarrionDecomposition,
  planFeedingAllocation,
  planReserveMetabolism,
  qToEU,
  qToMU,
  quantaToBig,
  resolveContention,
  scaleByRatio,
  splitCarrionMass,
  sumQuanta,
  sumQuantaInto,
} from './units';

const MU = MU_QUANTA_PER_UNIT;
const EU = EU_QUANTA_PER_UNIT;

test('units: scales are positive powers of ten and confirmed against Revision 3', () => {
  assert.ok(Number.isSafeInteger(MU) && MU >= 1);
  assert.ok(Number.isSafeInteger(EU) && EU >= 1);
  assert.equal(10 ** MU_DECIMALS, MU);
  assert.equal(10 ** EU_DECIMALS, EU);
  assert.equal(MAX_QUANTA, MAX_SAFE_INT);
  assert.equal(MU, 1_000_000);
  assert.equal(EU, 1_000_000);
  assert.equal(SCALES_CONFIRMED_AGAINST_REVISION_3, true);
  assert.deepEqual([RHO_PLANT.num, RHO_DETRITUS.num, RHO_STRUCT.num, RHO_RESERVE.num], [3, 3, 5, 30]);
});

test('units: assertQuanta / isQuanta reject every non-quantum value', () => {
  assert.equal(assertQuanta(0), 0);
  assert.equal(assertQuanta(MAX_QUANTA), MAX_QUANTA);
  for (const bad of [-1, -0.5, 0.5, NaN, Infinity, -Infinity, 2 ** 53, 1e300]) {
    assert.throws(() => assertQuanta(bad), UnitsError);
    assert.equal(isQuanta(bad), false);
  }
  assert.equal(isQuanta('5'), false);
  assert.equal(isQuanta(5n), false);
  assert.equal(isQuanta(5), true);
});

test('units: BigInt <-> quanta conversions are exact and range checked', () => {
  assert.equal(quantaToBig(MAX_QUANTA), 9007199254740991n);
  assert.equal(bigToQuanta(9007199254740991n), MAX_QUANTA);
  assert.equal(bigToQuanta(0n), 0);
  assert.throws(() => bigToQuanta(9007199254740992n), UnitsError);
  assert.throws(() => bigToQuanta(-1n), UnitsError);
  assert.throws(() => quantaToBig(1.5), UnitsError);
  assert.throws(() => assertNonNegativeBig(-1n), UnitsError);
  assert.throws(() => assertNonNegativeBig(1 as unknown as bigint), UnitsError);
});

test('units: exact decimal parsing has no float artefacts and refuses silent sub-quantum rounding', () => {
  assert.equal(parseMU('0'), 0);
  assert.equal(parseMU('1'), MU);
  assert.equal(parseEU('113.328'), 113328 * (EU / 1000));
  assert.equal(parseMU('0.29'), 29 * (MU / 100)); // 0.29 * 1e6 in floats is 289999.99999999994
  assert.equal(parseMU('1.1'), 11 * (MU / 10));
  assert.equal(parseMU('007.50'), 75 * (MU / 10));
  assert.equal(decimalToQuanta('12.345', 1000), 12345);
  assert.equal(decimalToQuanta('12.3450000', 1000), 12345, 'trailing zeros beyond resolution are exact');
  assert.throws(() => decimalToQuanta('12.3456', 1000), UnitsError);
  assert.equal(decimalToQuanta('12.3456', 1000, 'floor'), 12345);
  assert.equal(decimalToQuanta('12.3451', 1000, 'ceil'), 12346);
  assert.equal(decimalToQuanta('12.3455', 1000, 'half-even'), 12346);
  assert.equal(decimalToQuanta('12.3445', 1000, 'half-even'), 12344);
  assert.equal(decimalToQuanta('12.34451', 1000, 'half-even'), 12345);
  assert.equal(decimalToQuanta('9007199254740991', 1), MAX_QUANTA);
  assert.throws(() => decimalToQuanta('9007199254740992', 1), UnitsError);
  for (const bad of ['', '-1', '+1', '1e3', '1.', '.5', ' 1', '1,5', 'NaN', 'Infinity']) {
    assert.throws(() => parseMU(bad), UnitsError, `"${bad}" must be rejected`);
  }
  assert.throws(() => parseMU(5 as unknown as string), UnitsError);
  assert.throws(() => decimalToQuanta('1', 300), UnitsError, 'scale must be a power of ten');
});

test('units: numberToQuanta rounds the exact value of the double with explicit modes', () => {
  assert.equal(muToQ(0), 0);
  assert.equal(muToQ(1), MU);
  assert.equal(euToQ(2.5), 25 * (EU / 10));
  // The double nearest to 0.29 is slightly BELOW 0.29: floor and nearest differ by design.
  assert.equal(numberToQuanta(0.29, 1_000_000, 'floor'), 289999);
  assert.equal(numberToQuanta(0.29, 1_000_000, 'half-even'), 290000);
  assert.equal(numberToQuanta(0.29, 1_000_000, 'ceil'), 290000);
  // Exact ties
  assert.equal(numberToQuanta(0.5, 1, 'half-even'), 0);
  assert.equal(numberToQuanta(1.5, 1, 'half-even'), 2);
  assert.equal(numberToQuanta(2.5, 1, 'half-even'), 2);
  assert.equal(numberToQuanta(2.5, 1, 'floor'), 2);
  assert.equal(numberToQuanta(2.5, 1, 'ceil'), 3);
  // Subnormal and tiny values
  assert.equal(numberToQuanta(5e-324, 1_000_000, 'floor'), 0);
  assert.equal(numberToQuanta(5e-324, 1_000_000, 'ceil'), 1);
  assert.equal(numberToQuanta(1e-7, 1_000_000, 'half-even'), 0);
  // Large exact integers
  assert.equal(numberToQuanta(9007199254, 1_000_000, 'floor'), 9007199254000000);
  assert.throws(() => numberToQuanta(9007199255, 1_000_000), UnitsError);
  assert.throws(() => numberToQuanta(1e300, 1_000_000), UnitsError);
  for (const bad of [NaN, -1, -1e-300, Infinity, -Infinity]) {
    assert.throws(() => muToQ(bad), UnitsError);
    assert.throws(() => euToQ(bad), UnitsError);
  }
  assert.throws(() => numberToQuanta(1, 0), UnitsError);
  assert.throws(() => numberToQuanta(1, 1.5), UnitsError);

  // Cross-check against exact rational arithmetic on random doubles
  const rng = new SeededRng('units-number-to-quanta');
  for (let i = 0; i < 3000; i++) {
    const x = rng.range(0, 5000);
    const f = numberToQuanta(x, 1_000_000, 'floor');
    const c = numberToQuanta(x, 1_000_000, 'ceil');
    const h = numberToQuanta(x, 1_000_000, 'half-even');
    assert.ok(c === f || c === f + 1);
    assert.ok(h === f || h === c);
    assert.ok(f / 1e6 <= x && x <= c / 1e6);
  }
});

test('units: formatting is exact, round-trips through parsing, and display conversion is lossy-only', () => {
  const q = parseMU('1234.000001', 'floor');
  assert.equal(parseMU(formatMU(q)), q);
  assert.equal(formatEU(0), `0.${'0'.repeat(EU_DECIMALS)}`);
  assert.equal(parseEU(formatEU(MAX_QUANTA)), MAX_QUANTA);
  assert.equal(formatMU(-5n * BigInt(MU)), `-5.${'0'.repeat(MU_DECIMALS)}`);
  assert.equal(formatEU(10n ** 30n), `${10n ** 30n / BigInt(EU)}.${'0'.repeat(EU_DECIMALS)}`);
  assert.equal(qToMU(MU * 3), 3);
  assert.equal(qToEU(EU / 2), 0.5);
  assert.throws(() => qToMU(-1), UnitsError);
  const rng = new SeededRng('units-format');
  for (let i = 0; i < 500; i++) {
    const v = rng.nextInt(0, 2 ** 21 - 1) * 2 ** 32 + rng.nextInt(0, 2 ** 32 - 1);
    assert.equal(parseMU(formatMU(v)), v);
    assert.equal(parseEU(formatEU(v)), v);
  }
});

test('units: scaleByRatio / applyPpm are exact in all rounding modes with overflow protection', () => {
  assert.equal(scaleByRatio(10, 1, 3, 'floor'), 3);
  assert.equal(scaleByRatio(10, 1, 3, 'ceil'), 4);
  assert.equal(scaleByRatio(10, 1, 3, 'half-even'), 3);
  assert.equal(scaleByRatio(5, 1, 2, 'half-even'), 2);
  assert.equal(scaleByRatio(7, 1, 2, 'half-even'), 4);
  assert.equal(scaleByRatio(0, 5, 7), 0);
  assert.equal(scaleByRatio(MAX_QUANTA, MAX_QUANTA, MAX_QUANTA), MAX_QUANTA);
  assert.equal(scaleByRatio(MAX_QUANTA, 1, MAX_QUANTA, 'ceil'), 1);
  assert.throws(() => scaleByRatio(MAX_QUANTA, 2, 1), UnitsError);
  assert.throws(() => scaleByRatio(1, 1, 0), UnitsError);
  assert.throws(() => scaleByRatio(1, -1, 1), RangeError);
  assert.throws(() => scaleByRatio(1.5, 1, 1), UnitsError);
  assert.throws(() => scaleByRatio(1, 1, 1, 'up' as never), UnitsError);

  const rng = new SeededRng('units-scale');
  for (let i = 0; i < 4000; i++) {
    const wide = i % 2 === 1;
    const q = wide ? rng.nextInt(0, 2 ** 21 - 1) * 2 ** 32 + rng.nextInt(0, 2 ** 32 - 1) : rng.nextInt(0, 2 ** 24);
    const den = rng.nextInt(1, 2 ** 28);
    const num = rng.nextInt(0, den);
    const n = BigInt(q) * BigInt(num);
    const d = BigInt(den);
    const fl = n / d;
    const rem = n % d;
    assert.equal(BigInt(scaleByRatio(q, num, den, 'floor')), fl);
    assert.equal(BigInt(scaleByRatio(q, num, den, 'ceil')), rem === 0n ? fl : fl + 1n);
    const he = rem * 2n < d ? fl : rem * 2n > d ? fl + 1n : fl % 2n === 0n ? fl : fl + 1n;
    assert.equal(BigInt(scaleByRatio(q, num, den, 'half-even')), he);
  }

  assert.equal(applyPpm(150 * EU, 500_000), 75 * EU);
  assert.equal(applyPpm(3, 333_333), 0);
  assert.equal(applyPpm(3, 333_333, 'ceil'), 1);
  assert.equal(applyPpm(MAX_QUANTA, PPM), MAX_QUANTA);
  assert.equal(applyPpm(MAX_QUANTA, 0), 0);
  assert.throws(() => applyPpm(1, PPM + 1), UnitsError);
  assert.throws(() => assertPpm(-1), UnitsError);
  assert.throws(() => assertPpm(0.5), UnitsError);
  // A fraction split never creates or destroys quanta
  for (let i = 0; i < 1000; i++) {
    const q = rng.nextInt(0, 2 ** 31);
    const ppm = rng.nextInt(0, PPM);
    const part = applyPpm(q, ppm);
    assert.ok(part <= q);
    assert.equal(part + (q - part), q);
  }
  assert.equal(fractionToPpm(0.5), 500_000);
  assert.equal(fractionToPpm(0.29), 290_000);
  assert.equal(fractionToPpm(1), PPM);
  assert.throws(() => fractionToPpm(1.0000001), UnitsError);
  assert.throws(() => fractionToPpm(NaN), UnitsError);
});

test('units: energy density is the only MU <-> EU bridge and conversions are exact rationals', () => {
  const plant = energyDensity(3);
  const mixed = energyDensity(15, 2); // 7.5 EU/MU
  assert.equal(energyOfMass(50 * MU, plant), 150 * EU);
  assert.equal(massForEnergy(150 * EU, plant), 50 * MU);
  assert.equal(energyOfMass(12 * MU, mixed), 90 * EU);
  assert.equal(massForEnergy(90 * EU, mixed), 12 * MU);
  assert.equal(energyOfMass(0, plant), 0);
  // Rounding direction is explicit
  assert.equal(massForEnergy(1, energyDensity(3), 'floor'), Math.floor(MU / (3 * EU)));
  assert.equal(massForEnergy(10, energyDensity(3), 'floor'), Math.floor((10 * MU) / (3 * EU)));
  assert.equal(massForEnergy(10, energyDensity(3), 'ceil'), Math.ceil((10 * MU) / (3 * EU)));
  // floor conversion never yields more energy than the mass actually carries
  const rng = new SeededRng('units-density');
  for (let i = 0; i < 1000; i++) {
    const e = rng.nextInt(0, 2 ** 31);
    const d = energyDensity(rng.nextInt(1, 40), rng.nextInt(1, 7));
    const m = massForEnergy(e, d, 'floor');
    assert.ok(energyOfMass(m, d, 'floor') <= e);
    assert.ok(energyOfMass(massForEnergy(e, d, 'ceil'), d, 'ceil') >= e);
  }
  assert.throws(() => energyOfMass(MAX_QUANTA, energyDensity(MAX_QUANTA)), UnitsError);
  assert.throws(() => energyDensity(0), UnitsError);
  assert.throws(() => energyDensity(1, 0), UnitsError);
  assert.throws(() => energyDensity(1.5), UnitsError);
  assert.throws(() => energyOfMass(1, { num: -1, den: 1 }), UnitsError);
  assert.throws(() => massForEnergy(-1, plant), UnitsError);
});

test('units: ExactAccumulators stay exact far beyond 2^53 and guard underflow/overflow', () => {
  const acc = new ExactAccumulators(4);
  assert.equal(acc.byteLength, 4 * 16);
  let expected = 0n;
  const rng = new SeededRng('units-acc');
  for (let i = 0; i < 20000; i++) {
    const v = i % 3 === 0 ? MAX_QUANTA : rng.nextInt(0, 2 ** 21 - 1) * 2 ** 32 + rng.nextInt(0, 2 ** 32 - 1);
    acc.add(0, v);
    expected += BigInt(v);
  }
  assert.equal(acc.toBigInt(0), expected);
  assert.ok(expected > 2n ** 64n);

  // Subtraction with borrow and comparison
  for (let i = 0; i < 5000; i++) {
    const v = rng.nextInt(0, 2 ** 21 - 1) * 2 ** 32 + rng.nextInt(0, 2 ** 32 - 1);
    assert.ok(acc.gte(0, v));
    acc.sub(0, v);
    expected -= BigInt(v);
  }
  assert.equal(acc.toBigInt(0), expected);

  acc.setBigInt(1, 5n);
  assert.equal(acc.gte(1, 5), true);
  assert.equal(acc.gte(1, 6), false);
  assert.throws(() => acc.sub(1, 6), UnitsError);
  assert.equal(acc.toBigInt(1), 5n, 'failed subtraction must not modify the accumulator');
  acc.sub(1, 5);
  assert.equal(acc.isZero(1), true);

  // Borrow across the limb boundary
  acc.setBigInt(2, 2n ** 48n);
  acc.sub(2, 1);
  assert.equal(acc.toBigInt(2), 2n ** 48n - 1n);
  acc.add(2, 1);
  assert.equal(acc.toBigInt(2), 2n ** 48n);

  // addFrom / copyFrom / equalsAt
  acc.copyFrom(3, acc, 0);
  assert.ok(acc.equalsAt(3, acc, 0));
  acc.addFrom(3, acc, 2);
  assert.equal(acc.toBigInt(3), expected + 2n ** 48n);
  assert.equal(acc.equalsAt(3, acc, 0), false);

  // Round trip of extreme values
  const top = 2n ** 101n - 1n;
  acc.setBigInt(1, top);
  assert.equal(acc.toBigInt(1), top);
  assert.throws(() => acc.add(1, 1), UnitsError);
  assert.throws(() => acc.setBigInt(1, top + 1n), UnitsError);
  assert.throws(() => acc.setBigInt(1, -1n), UnitsError);
  for (const bad of [-1, 0.5, NaN, Infinity, 2 ** 53]) {
    assert.throws(() => acc.add(0, bad), UnitsError);
    assert.throws(() => acc.gte(0, bad), UnitsError);
  }
  assert.throws(() => acc.add(4, 1), UnitsError);
  assert.throws(() => acc.add(-1, 1), UnitsError);
  assert.throws(() => new ExactAccumulators(0), UnitsError);
  acc.resetAll();
  assert.equal(acc.toBigInt(0), 0n);
});

test('units: sumQuanta is exact, order independent, and rejects corrupted buffers (large arrays)', () => {
  const n = 250_000;
  const values = new Float64Array(n);
  const rng = new SeededRng('units-sum');
  let expected = 0n;
  for (let i = 0; i < n; i++) {
    const v = i % 1000 === 0 ? MAX_QUANTA : rng.nextInt(0, 2 ** 32 - 1) * 1024 + rng.nextInt(0, 1023);
    values[i] = v;
    expected += BigInt(v);
  }
  assert.equal(sumQuanta(values), expected);
  assert.ok(expected > BigInt(MAX_QUANTA) * 200n);

  const reversed = Float64Array.from(values).reverse();
  assert.equal(sumQuanta(reversed), expected);
  const shuffled = Float64Array.from(rng.shuffled(Array.from(values.subarray(0, 20000))));
  assert.equal(sumQuanta(shuffled), sumQuanta(values, 20000));

  const acc = new ExactAccumulators(2);
  acc.add(1, 7);
  sumQuantaInto(values, 10, acc, 1);
  assert.equal(acc.toBigInt(1), sumQuanta(values, 10) + 7n);

  for (const bad of [NaN, -1, 0.5, Infinity, 2 ** 53]) {
    const corrupt = new Float64Array([1, 2, bad, 4]);
    assert.throws(() => sumQuanta(corrupt), UnitsError);
  }
  assert.throws(() => sumQuanta(values, n + 1), UnitsError);
});

test('units: resolveContention is exact, never over-grants, and is permutation-equivariant', () => {
  const grants = new Float64Array(8);
  // Demand below supply: everybody is satisfied
  assert.equal(resolveContention([50, 30, 20], 3, 100, grants), 100);
  assert.deepEqual(Array.from(grants.subarray(0, 3)), [50, 30, 20]);
  // Reference example: 50/30/20 MU demanded, 60 MU accessible -> 30/18/12
  assert.equal(resolveContention([50 * MU, 30 * MU, 20 * MU], 3, 60 * MU, grants), 60 * MU);
  assert.deepEqual(Array.from(grants.subarray(0, 3)), [30 * MU, 18 * MU, 12 * MU]);
  // Remainder stays in the pool
  assert.equal(resolveContention([1, 1, 1], 3, 2, grants), 0);
  assert.equal(resolveContention([], 0, 5, grants), 0);
  assert.equal(resolveContention([7], 1, 0, grants), 0);

  const rng = new SeededRng('units-contention');
  for (let round = 0; round < 300; round++) {
    const count = rng.nextInt(1, 40);
    const demands: number[] = [];
    let total = 0n;
    for (let i = 0; i < count; i++) {
      const d = round % 5 === 0 ? MAX_QUANTA - rng.nextInt(0, 1000) : rng.nextInt(0, 2 ** 30);
      demands.push(d);
      total += BigInt(d);
    }
    const available = rng.nextInt(0, 2 ** 31);
    const out = new Float64Array(count);
    const granted = resolveContention(demands, count, available, out);
    let sum = 0n;
    for (let i = 0; i < count; i++) {
      assert.ok(out[i] <= demands[i]);
      const expected = total <= BigInt(available) ? BigInt(demands[i]) : (BigInt(demands[i]) * BigInt(available)) / total;
      assert.equal(BigInt(out[i]), expected);
      sum += BigInt(out[i]);
    }
    assert.equal(BigInt(granted), sum);
    assert.ok(sum <= BigInt(available) || total <= BigInt(available));

    // Permutation equivariance: shuffling claimants shuffles grants identically
    const order = rng.shuffled(demands.map((_, i) => i));
    const permuted = order.map((i) => demands[i]);
    const outPerm = new Float64Array(count);
    resolveContention(permuted, count, available, outPerm);
    for (let k = 0; k < count; k++) {
      assert.equal(outPerm[k], out[order[k]]);
    }
  }
  assert.throws(() => resolveContention([1, -1], 2, 5, grants), UnitsError);
  assert.throws(() => resolveContention([1], 1, 1.5, grants), UnitsError);
  assert.throws(() => resolveContention([1], 2, 1, grants), UnitsError);
});

test('units (FIX 6): resolveContention with organismIds distributes remainders canonically and is permutation-invariant', () => {
  // Mandatory audit case: 100 organisms x 1 qMU vs available = 99 qMU
  const count = 100;
  const demands100 = new Array<number>(count).fill(1);
  const ids100 = Array.from({ length: count }, (_, i) => (i + 1) * 10);
  const grants100 = new Float64Array(count);
  const granted99 = resolveContention(demands100, count, 99, grants100, ids100);
  assert.equal(granted99, 99, 'zero quanta lost on remainder contention');

  const expectedById = new Map<number, number>();
  let ones = 0;
  let zeros = 0;
  for (let i = 0; i < count; i++) {
    expectedById.set(ids100[i], grants100[i]);
    if (grants100[i] === 1) ones++;
    else if (grants100[i] === 0) zeros++;
    else assert.fail(`unexpected grant ${grants100[i]}`);
  }
  assert.equal(ones, 99);
  assert.equal(zeros, 1);
  // Deterministic ascending organismId tie-break gives 0 to the highest ID (1000)
  assert.equal(expectedById.get(1000), 0);

  // Permuting inputs yields the exact same grant per organismId
  const rng = new SeededRng('fix6-contention-permutation');
  for (let p = 0; p < 50; p++) {
    const order = rng.shuffled(Array.from({ length: count }, (_, i) => i));
    const permDemands = order.map((idx) => demands100[idx]);
    const permIds = order.map((idx) => ids100[idx]);
    const permGrants = new Float64Array(count);
    const totalPermGranted = resolveContention(permDemands, count, 99, permGrants, permIds);
    assert.equal(totalPermGranted, 99);
    for (let k = 0; k < count; k++) {
      assert.equal(permGrants[k], expectedById.get(permIds[k]), `perm ${p} mismatch for id=${permIds[k]}`);
    }
  }

  // General mixed-demand + wide-demand Hamilton allocation & permutation invariance
  for (let round = 0; round < 100; round++) {
    const n = rng.nextInt(2, 30);
    const baseIds = rng.shuffled(Array.from({ length: n }, (_, i) => i * 17 + 3));
    const d = Array.from({ length: n }, (_, i) =>
      round % 4 === 0 && i === 0 ? 2 ** 40 + rng.nextInt(1, 5000) : rng.nextInt(1, 500)
    );
    const sumD = d.reduce((a, b) => a + BigInt(b), 0n);
    const avail = round % 4 === 0 ? 2 ** 38 + rng.nextInt(0, 10000) : rng.nextInt(1, Number(sumD) - 1);
    const gA = new Float64Array(n);
    const gotA = resolveContention(d, n, avail, gA, baseIds);
    assert.equal(gotA, Math.min(avail, Number(sumD)));
    const mapA = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      assert.ok(gA[i] >= 0 && gA[i] <= d[i]);
      mapA.set(baseIds[i], gA[i]);
    }
    const perm = rng.shuffled(Array.from({ length: n }, (_, i) => i));
    const gB = new Float64Array(n);
    const gotB = resolveContention(
      perm.map((idx) => d[idx]),
      n,
      avail,
      gB,
      perm.map((idx) => baseIds[idx])
    );
    assert.equal(gotB, gotA);
    for (let i = 0; i < n; i++) {
      assert.equal(gB[i], mapA.get(baseIds[perm[i]]));
    }
  }

  // Duplicate / invalid organismIds rejected
  const smallOut = new Float64Array(4);
  assert.throws(() => resolveContention([1, 1], 2, 1, smallOut, [5, 5]), /duplicate organismId/);
  assert.throws(() => resolveContention([1, 1], 2, 1, smallOut, [1, -1]), UnitsError);
  assert.throws(() => resolveContention([1, 1], 2, 1, smallOut, [1]), /organismIds length/);
});

test('units (FIX 2): stoichiometric densities, carrion split, feeding egesta, and sub-quantum reserve metabolism', () => {
  assert.equal(hasExactDensity(100, 300, RHO_PLANT), true);
  assert.equal(hasExactDensity(100, 301, RHO_PLANT), false);
  assert.equal(hasExactDensity(0, 0, RHO_RESERVE), true);

  // Two dead organisms: (14 MU struct @ 5 = 70 EU) + (2 MU reserve @ 30 = 60 EU) = 16 MU, 130 EU
  const fr = splitCarrionMass(16 * MU, 130 * EU);
  assert.equal(fr.structMassQ, 14 * MU);
  assert.equal(fr.reserveMassQ, 2 * MU);
  assert.equal(isValidCarrionMix(16 * MU, 130 * EU), true);
  assert.equal(isValidCarrionMix(16 * MU, 130 * EU + 1), false);

  // Bite & decomposition preserve exact (5, 30) remaining mix
  const bite = planCarrionConsumption(16 * MU, 130 * EU, 5 * MU);
  assert.equal(bite.totalMassQ, 5 * MU);
  assert.equal(isValidCarrionMix(16 * MU - bite.totalMassQ, 130 * EU - bite.totalEnergyQ), true);
  const dec = planCarrionDecomposition(16 * MU - bite.totalMassQ, 130 * EU - bite.totalEnergyQ, 100_000);
  const remM = 16 * MU - bite.totalMassQ - dec.totalMassQ;
  const remE = 130 * EU - bite.totalEnergyQ - dec.totalEnergyQ;
  assert.equal(isValidCarrionMix(remM, remE), true);

  // Eating carrion produces DETRITUS strictly at 3 EU/MU and RESERVE strictly at 30 EU/MU
  const fed = planFeedingAllocation(bite.totalMassQ, bite.totalEnergyQ, 800_000, 100_000);
  assert.equal(hasExactDensity(fed.depositMassQ, fed.depositEnergyQ, RHO_RESERVE), true);
  assert.equal(hasExactDensity(fed.egestaMassQ, fed.egestaEnergyQ, RHO_DETRITUS), true);
  assert.equal(fed.depositMassQ + fed.egestaMassQ + fed.abioticMassQ, bite.totalMassQ);
  assert.equal(fed.depositEnergyQ + fed.egestaEnergyQ + fed.heatQ, bite.totalEnergyQ);

  // Repeated sub-quantum metabolism (1 qEU/tick over 300 ticks) burns exact 10 qMU = 300 qEU
  let reserveMass = 100;
  let carry = 0;
  let totalDeficit = 0;
  for (let tick = 0; tick < 300; tick++) {
    const step = planReserveMetabolism(reserveMass, 1, carry);
    assert.equal(hasExactDensity(step.burnMassQ, step.burnEnergyQ, RHO_RESERVE), true);
    reserveMass -= step.burnMassQ;
    carry = step.nextCarryCreditQ;
    totalDeficit += step.deficitQ;
  }
  assert.equal(totalDeficit, 0);
  assert.equal(reserveMass, 90);
  assert.equal(carry, 0);
});
