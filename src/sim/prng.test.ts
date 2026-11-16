import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { RngStreams, SeededRng, deriveSeed, normalizeSeed } from './prng';

test('PRNG: same numeric or string seed yields identical sequence across all methods', () => {
  const a = new SeededRng(123456);
  const b = new SeededRng(123456);
  const sA = new SeededRng('jurassic-epoch-1');
  const sB = new SeededRng('jurassic-epoch-1');

  for (let i = 0; i < 200; i++) {
    assert.equal(a.nextUint32(), b.nextUint32());
    assert.equal(a.nextFloat(), b.nextFloat());
    assert.equal(a.range(-25, 42.5), b.range(-25, 42.5));
    assert.equal(a.nextInt(-10, 10), b.nextInt(-10, 10));
    assert.equal(a.chance(0.37), b.chance(0.37));
    assert.equal(a.gaussian(15, 3), b.gaussian(15, 3));

    assert.equal(sA.nextFloat(), sB.nextFloat());
  }
});

test('PRNG: different seeds produce distinct sequences', () => {
  const r1 = new SeededRng(1);
  const r2 = new SeededRng(2);
  const r3 = new SeededRng('alpha');
  const r4 = new SeededRng('beta');

  const seq1 = Array.from({ length: 16 }, () => r1.nextUint32());
  const seq2 = Array.from({ length: 16 }, () => r2.nextUint32());
  const seq3 = Array.from({ length: 16 }, () => r3.nextUint32());
  const seq4 = Array.from({ length: 16 }, () => r4.nextUint32());

  assert.notDeepEqual(seq1, seq2);
  assert.notDeepEqual(seq3, seq4);
  assert.notDeepEqual(seq1, seq3);
});

test('PRNG: bounds, integer inclusivity, chance edge cases, and statistical sanity', () => {
  const rng = new SeededRng(9001);
  const intSeen = new Set<number>();
  let trueHits = 0;
  const trials = 4000;

  for (let i = 0; i < trials; i++) {
    const f = rng.nextFloat();
    assert.ok(Number.isFinite(f) && f >= 0 && f < 1, `float out of [0,1): ${f}`);

    const r = rng.range(-5, 5);
    assert.ok(Number.isFinite(r) && r >= -5 && r < 5, `range out of [-5,5): ${r}`);

    const n = rng.nextInt(3, 7);
    assert.ok(Number.isInteger(n) && n >= 3 && n <= 7, `int out of [3,7]: ${n}`);
    intSeen.add(n);

    assert.equal(rng.chance(0), false);
    assert.equal(rng.chance(-0.5), false);
    assert.equal(rng.chance(1), true);
    assert.equal(rng.chance(1.5), true);

    if (rng.chance(0.25)) trueHits++;
  }

  assert.deepEqual([...intSeen].sort((x, y) => x - y), [3, 4, 5, 6, 7]);
  const ratio = trueHits / trials;
  assert.ok(ratio > 0.2 && ratio < 0.3, `Expected ~0.25 chance ratio, got ${ratio}`);
});

test('PRNG: independent child streams (fork & RngStreams) are isolated from sibling consumption', () => {
  const baseA = new SeededRng(4242);
  const climateA = baseA.fork('climate');
  const geneticsA = baseA.fork('genetics');

  // Heavily consume climateA before reading geneticsA
  for (let i = 0; i < 10000; i++) {
    climateA.nextFloat();
    baseA.nextFloat();
  }

  const baseB = new SeededRng(4242);
  const geneticsB = baseB.fork('genetics');
  const climateB = baseB.fork('climate');

  for (let i = 0; i < 64; i++) {
    assert.equal(geneticsA.nextUint32(), geneticsB.nextUint32());
  }
  assert.notEqual(deriveSeed(4242, 'climate'), deriveSeed(4242, 'genetics'));
  assert.notEqual(climateB.nextUint32(), geneticsB.nextUint32());

  const streams1 = new RngStreams('world-seed', ['world', 'climate', 'fauna']);
  const streams2 = new RngStreams('world-seed', ['world', 'climate', 'fauna']);

  for (let i = 0; i < 500; i++) streams1.get('world').nextFloat();
  for (let i = 0; i < 50; i++) {
    assert.equal(streams1.get('fauna').nextFloat(), streams2.get('fauna').nextFloat());
  }
});

test('PRNG: pick, weightedPick, shuffled, state snapshot/restore, and clone', () => {
  const rng = new SeededRng('snapshot-test');
  const items = ['a', 'b', 'c', 'd'] as const;
  const picked = rng.pick(items);
  assert.ok(items.includes(picked));

  const wPicked = rng.weightedPick(['rare', 'common'], [0, 10]);
  assert.equal(wPicked, 'common');

  const shuffled = rng.shuffled([1, 2, 3, 4, 5, 6]);
  assert.equal(shuffled.length, 6);
  assert.deepEqual([...shuffled].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6]);

  const savedState = rng.getState();
  const cloned = rng.clone();
  const expected = Array.from({ length: 20 }, () => rng.nextUint32());

  const restored = new SeededRng(999);
  restored.setState(savedState);
  assert.deepEqual(
    Array.from({ length: 20 }, () => restored.nextUint32()),
    expected
  );
  assert.deepEqual(
    Array.from({ length: 20 }, () => cloned.nextUint32()),
    expected
  );

  const streams = new RngStreams(77, ['a', 'b']);
  streams.get('a').nextFloat();
  const snap = streams.snapshotStates();
  const nextVals = [streams.get('a').nextUint32(), streams.get('b').nextUint32()];
  streams.restoreStates(snap);
  assert.deepEqual([streams.get('a').nextUint32(), streams.get('b').nextUint32()], nextVals);
});

test('PRNG: throws on invalid bounds and does not use Math.random()', () => {
  assert.throws(() => normalizeSeed(Number.NaN), RangeError);
  assert.throws(() => normalizeSeed(Number.POSITIVE_INFINITY), RangeError);

  const rng = new SeededRng(1);
  assert.throws(() => rng.range(10, 5), RangeError);
  assert.throws(() => rng.nextInt(5, 2), RangeError);
  assert.throws(() => rng.nextInt(1.5, 4), RangeError);
  assert.throws(() => rng.pick([]), RangeError);
  assert.throws(() => rng.weightedPick(['x'], [0]), RangeError);
  assert.throws(() => rng.weightedPick(['x'], [-1]), RangeError);

  const origRandom = Math.random;
  Math.random = () => {
    throw new Error('Math.random() must not be called');
  };
  try {
    const isolated = new SeededRng('no-global-random');
    isolated.nextFloat();
    isolated.nextInt(1, 10);
    isolated.chance(0.5);
    isolated.gaussian();
    isolated.fork('sub').nextUint32();
  } finally {
    Math.random = origRandom;
  }

  const rawSrc = fs.readFileSync(path.resolve('src/sim/prng.ts'), 'utf8');
  const codeOnly = rawSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.equal(/\bMath\.random\s*\(/.test(codeOnly), false, 'prng.ts must never call Math.random()');
});

test('PRNG: weightedPick strictly excludes zero weights on boundary draws and handles MAX_VALUE overflow', () => {
  const rng = new SeededRng(100);

  // Force boundary nextUint32() === 0 (nextFloat() === 0) and 0xffffffff (nextFloat() ~ 1)
  const items = ['zeroHead', 'a', 'zeroMid', 'b', 'zeroTail'] as const;
  const weights = [0, 3, 0, 7, 0];

  (rng as unknown as { nextUint32: () => number }).nextUint32 = () => 0;
  assert.equal(rng.weightedPick(items, weights), 'a');
  assert.equal(rng.weightedPick(['z0', 'z1', 'only'], [0, 0, 5]), 'only');

  (rng as unknown as { nextUint32: () => number }).nextUint32 = () => 0xffffffff;
  assert.equal(rng.weightedPick(items, weights), 'b');
  assert.equal(rng.weightedPick(['only', 'z0', 'z1'], [5, 0, 0]), 'only');

  // Extreme weights exceeding Number.MAX_VALUE when summed
  const bigRng = new SeededRng(555);
  const bigCounts = { a: 0, b: 0, z: 0 };
  for (let i = 0; i < 4000; i++) {
    const pick = bigRng.weightedPick(['a', 'b', 'z'], [Number.MAX_VALUE, Number.MAX_VALUE, 0]);
    bigCounts[pick as keyof typeof bigCounts]++;
  }
  assert.equal(bigCounts.z, 0, 'Zero weight must never be chosen alongside MAX_VALUE weights');
  assert.ok(bigCounts.a > 1800 && bigCounts.a < 2200, `Expected ~50% a, got ${bigCounts.a}`);
  assert.ok(bigCounts.b > 1800 && bigCounts.b < 2200, `Expected ~50% b, got ${bigCounts.b}`);

  // Invalid weights rejected cleanly
  assert.throws(() => bigRng.weightedPick(['a'], [Number.POSITIVE_INFINITY]), RangeError);
  assert.throws(() => bigRng.weightedPick(['a'], [Number.NaN]), RangeError);
  assert.throws(() => bigRng.weightedPick(['a', 'b'], [0, 0]), RangeError);
});

test('PRNG: nextInt unbiased rejection sampling, <=2^32 spans, >2^32 rejection, negative/invalid bounds, and uniformity', () => {
  const rng = new SeededRng(777);

  // Exact 2^32 spans across signed, unsigned, and safe-integer extremes
  const full32Signed = rng.nextInt(-2147483648, 2147483647);
  assert.ok(Number.isSafeInteger(full32Signed) && full32Signed >= -2147483648 && full32Signed <= 2147483647);

  const full32Unsigned = rng.nextInt(0, 0xffffffff);
  assert.ok(Number.isSafeInteger(full32Unsigned) && full32Unsigned >= 0 && full32Unsigned <= 0xffffffff);

  const full32Shifted = rng.nextInt(10, 10 + 0xffffffff);
  assert.ok(Number.isSafeInteger(full32Shifted) && full32Shifted >= 10 && full32Shifted <= 10 + 0xffffffff);

  const full32NearMaxSafe = rng.nextInt(Number.MAX_SAFE_INTEGER - 0xffffffff, Number.MAX_SAFE_INTEGER);
  assert.ok(
    Number.isSafeInteger(full32NearMaxSafe) &&
      full32NearMaxSafe >= Number.MAX_SAFE_INTEGER - 0xffffffff &&
      full32NearMaxSafe <= Number.MAX_SAFE_INTEGER
  );

  const full32NearMinSafe = rng.nextInt(Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER + 0xffffffff);
  assert.ok(
    Number.isSafeInteger(full32NearMinSafe) &&
      full32NearMinSafe >= Number.MIN_SAFE_INTEGER &&
      full32NearMinSafe <= Number.MIN_SAFE_INTEGER + 0xffffffff
  );

  // Spans > 2^32 must be rejected cleanly with RangeError
  assert.throws(() => rng.nextInt(0, 0x100000000), RangeError);
  assert.throws(() => rng.nextInt(-1, 0xffffffff), RangeError);
  assert.throws(() => rng.nextInt(-2147483648, 2147483648), RangeError);
  assert.throws(() => rng.nextInt(0, Number.MAX_SAFE_INTEGER), RangeError);
  assert.throws(() => rng.nextInt(-5_000_000_000, 5_000_000_000), RangeError);
  assert.throws(() => rng.nextInt(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), RangeError);

  // Negative ranges and inclusivity
  const negSeen = new Set<number>();
  for (let i = 0; i < 400; i++) {
    const v = rng.nextInt(-5, -1);
    assert.ok(Number.isInteger(v) && v >= -5 && v <= -1);
    negSeen.add(v);
  }
  assert.deepEqual([...negSeen].sort((a, b) => a - b), [-5, -4, -3, -2, -1]);
  assert.equal(rng.nextInt(-42, -42), -42);

  // Invalid numeric bounds rejected cleanly
  assert.throws(() => rng.nextInt(Number.NaN, 5), RangeError);
  assert.throws(() => rng.nextInt(0, Number.NaN), RangeError);
  assert.throws(() => rng.nextInt(Number.NEGATIVE_INFINITY, 0), RangeError);
  assert.throws(() => rng.nextInt(0, Number.POSITIVE_INFINITY), RangeError);
  assert.throws(() => rng.nextInt(1.5, 5), RangeError);
  assert.throws(() => rng.nextInt(0, 2.25), RangeError);
  assert.throws(() => rng.nextInt(5, 2), RangeError);
  assert.throws(() => rng.nextInt(0, Number.MAX_SAFE_INTEGER + 1), RangeError);
  assert.throws(() => rng.nextInt(Number.MIN_SAFE_INTEGER - 1, 0), RangeError);

  // Statistical uniformity check on non-power-of-two span (span = 6) over 120,000 trials
  const trials = 120000;
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < trials; i++) {
    counts[rng.nextInt(1, 6) - 1]++;
  }
  const expected = trials / 6;
  let chiSquared = 0;
  for (const c of counts) {
    chiSquared += ((c - expected) * (c - expected)) / expected;
  }
  // 5 degrees of freedom: critical value at p=0.001 is 20.515
  assert.ok(chiSquared < 20.5, `Chi-squared ${chiSquared.toFixed(2)} suggests distribution bias`);
});

test('PRNG: Mulberry32 output sequence remains deterministic and reproducible for known seeds', () => {
  const numRng = new SeededRng(123456);
  const strRng = new SeededRng('jurassic-epoch-1');
  assert.deepEqual(
    Array.from({ length: 5 }, () => numRng.nextUint32()),
    [3595275563, 2392090315, 2520511799, 1571533581, 751031238]
  );
  assert.deepEqual(
    Array.from({ length: 5 }, () => strRng.nextUint32()),
    [621727199, 1355653453, 1729007263, 1307063219, 3743981931]
  );
});

test('PRNG: Phase 1.2 hardening — extreme range overflow, gaussian/chance validation, and strict setState bounds', () => {
  // 1. Extreme finite range bounds must never overflow (max - min) to Infinity
  const extremeRng = new SeededRng(202611);
  for (let i = 0; i < 1000; i++) {
    const vFull = extremeRng.range(-Number.MAX_VALUE, Number.MAX_VALUE);
    assert.ok(Number.isFinite(vFull), `Expected finite result, got ${vFull}`);
    assert.ok(vFull >= -Number.MAX_VALUE && vFull < Number.MAX_VALUE);

    const vAsymHigh = extremeRng.range(-1e293, Number.MAX_VALUE);
    assert.ok(Number.isFinite(vAsymHigh) && vAsymHigh >= -1e293 && vAsymHigh < Number.MAX_VALUE);

    const vAsymLow = extremeRng.range(-Number.MAX_VALUE, 1e293);
    assert.ok(Number.isFinite(vAsymLow) && vAsymLow >= -Number.MAX_VALUE && vAsymLow < 1e293);
  }

  // Exact boundary draws (0 and 0xffffffff) on (-MAX_VALUE, MAX_VALUE)
  const minDrawRng = new SeededRng(1);
  (minDrawRng as unknown as { nextUint32: () => number }).nextUint32 = () => 0;
  assert.equal(minDrawRng.range(-Number.MAX_VALUE, Number.MAX_VALUE), -Number.MAX_VALUE);

  const maxDrawRng = new SeededRng(1);
  (maxDrawRng as unknown as { nextUint32: () => number }).nextUint32 = () => 0xffffffff;
  const maxDrawVal = maxDrawRng.range(-Number.MAX_VALUE, Number.MAX_VALUE);
  assert.ok(Number.isFinite(maxDrawVal) && maxDrawVal > 0 && maxDrawVal < Number.MAX_VALUE);

  // Equal and invalid range bounds
  assert.equal(extremeRng.range(-Number.MAX_VALUE, -Number.MAX_VALUE), -Number.MAX_VALUE);
  assert.equal(extremeRng.range(Number.MAX_VALUE, Number.MAX_VALUE), Number.MAX_VALUE);
  assert.throws(() => extremeRng.range(Number.NaN, 1), RangeError);
  assert.throws(() => extremeRng.range(0, Number.POSITIVE_INFINITY), RangeError);
  assert.throws(() => extremeRng.range(Number.NEGATIVE_INFINITY, 0), RangeError);

  // 2. chance() strictly rejects NaN and +/-Infinity while preserving finite semantics
  assert.equal(extremeRng.chance(-Number.MAX_VALUE), false);
  assert.equal(extremeRng.chance(-0), false);
  assert.equal(extremeRng.chance(0), false);
  assert.equal(extremeRng.chance(1), true);
  assert.equal(extremeRng.chance(Number.MAX_VALUE), true);
  assert.throws(() => extremeRng.chance(Number.NaN), RangeError);
  assert.throws(() => extremeRng.chance(Number.POSITIVE_INFINITY), RangeError);
  assert.throws(() => extremeRng.chance(Number.NEGATIVE_INFINITY), RangeError);

  // 3. gaussian() validates finite mean & non-negative finite stdDev
  assert.equal(extremeRng.gaussian(42.5, 0), 42.5);
  assert.throws(() => extremeRng.gaussian(Number.NaN, 1), RangeError);
  assert.throws(() => extremeRng.gaussian(Number.POSITIVE_INFINITY, 1), RangeError);
  assert.throws(() => extremeRng.gaussian(Number.NEGATIVE_INFINITY, 1), RangeError);
  assert.throws(() => extremeRng.gaussian(0, Number.NaN), RangeError);
  assert.throws(() => extremeRng.gaussian(0, Number.POSITIVE_INFINITY), RangeError);
  assert.throws(() => extremeRng.gaussian(0, Number.NEGATIVE_INFINITY), RangeError);
  assert.throws(() => extremeRng.gaussian(0, -1), RangeError);
  assert.throws(() => extremeRng.gaussian(0, -0.0001), RangeError);

  // 4. setState() strictly accepts [0, 0xffffffff] integers and never wraps out-of-range values
  const stateRng = new SeededRng(333);
  stateRng.setState(0);
  assert.equal(stateRng.getState(), 0);
  stateRng.setState(0xffffffff);
  assert.equal(stateRng.getState(), 0xffffffff);
  assert.throws(() => stateRng.setState(-1), RangeError);
  assert.throws(() => stateRng.setState(-2147483648), RangeError);
  assert.throws(() => stateRng.setState(0x100000000), RangeError);
  assert.throws(() => stateRng.setState(Number.MAX_SAFE_INTEGER), RangeError);
  assert.throws(() => stateRng.setState(1.5), RangeError);
  assert.throws(() => stateRng.setState(Number.NaN), RangeError);
  assert.throws(() => stateRng.setState(Number.POSITIVE_INFINITY), RangeError);
  assert.throws(() => stateRng.setState(Number.NEGATIVE_INFINITY), RangeError);

  // clone() continues working seamlessly across high-bit internal states
  const cloneRng = new SeededRng(123456);
  for (let i = 0; i < 20; i++) {
    cloneRng.nextUint32();
    const cloned = cloneRng.clone();
    assert.equal(cloned.nextUint32(), cloneRng.nextUint32());
  }
});



