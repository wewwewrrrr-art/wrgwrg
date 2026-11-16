/**
 * Deterministic Seeded PRNG for the Living World Simulation (`src/sim/`).
 *
 * Uses SplitMix32 for seed mixing and Mulberry32 for fast 32-bit state
 * progression. Never touches global `Math.random()`, ensuring full
 * reproducibility across headless experiments, worker threads, and UI runs.
 */

export type SeedInput = number | string;

/**
 * Hashes an arbitrary numeric or string seed into a non-zero unsigned 32-bit integer.
 */
export function normalizeSeed(seed: SeedInput): number {
  let h = 2166136261 >>> 0;

  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) {
      throw new RangeError(`Seed number must be finite, received: ${seed}`);
    }
    const intVal = Math.trunc(seed) | 0;
    const fracVal = Math.trunc((seed - Math.trunc(seed)) * 0x100000000) | 0;
    h ^= intVal >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= fracVal >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  } else {
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }

  // Final SplitMix avalanche
  h = (h + 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;

  return h === 0 ? 0x6d2b79f5 : h;
}

/**
 * Derives an independent 32-bit seed from a parent seed and a stream label.
 */
export function deriveSeed(baseSeed: SeedInput, label: string | number): number {
  const root = normalizeSeed(baseSeed);
  const tag = normalizeSeed(typeof label === 'number' ? label : `stream:${label}`);
  let mixed = (root ^ Math.imul(tag, 0x9e3779b1)) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35) >>> 0;
  mixed = (mixed ^ (mixed >>> 16)) >>> 0;
  return mixed === 0 ? 0xa5a5a5a5 : mixed;
}

export class SeededRng {
  public readonly initialSeed: number;
  private state: number;

  constructor(seed: SeedInput) {
    this.initialSeed = normalizeSeed(seed);
    this.state = this.initialSeed;
  }

  /**
   * Advances state and returns an unsigned 32-bit integer in [0, 0xFFFFFFFF].
   */
  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /**
   * Returns a uniform floating-point number in [0, 1).
   */
  nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }

  /**
   * Returns a uniform floating-point number in [min, max).
   */
  range(min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new RangeError(`range bounds must be finite: [${min}, ${max}]`);
    }
    if (max < min) {
      throw new RangeError(`range max (${max}) must be >= min (${min})`);
    }
    if (max === min) return min;

    const t = this.nextFloat();
    const span = max - min;
    if (Number.isFinite(span)) {
      return min + t * span;
    }

    // Half-scaled interpolation avoids (max - min) overflow when min < 0 < max spans > Number.MAX_VALUE
    const halfMin = min * 0.5;
    const halfMax = max * 0.5;
    const result = (halfMin + t * (halfMax - halfMin)) * 2;
    return Number.isFinite(result) ? result : result > 0 ? max : min;
  }

  /**
   * Returns an unbiased uniform integer in [min, max] (inclusive).
   * Uses 32-bit rejection sampling over the 32-bit Mulberry32 generator.
   * Range span is computed exactly via BigInt and must not exceed 2^32 values;
   * unsafe integers and spans > 2^32 throw RangeError.
   */
  nextInt(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
      throw new RangeError(`nextInt bounds must be safe integers: [${min}, ${max}]`);
    }
    if (max < min) {
      throw new RangeError(`nextInt max (${max}) must be >= min (${min})`);
    }
    if (max === min) return min;

    const MAX_UINT32_SPAN = 0x100000000n;
    const spanBig = BigInt(max) - BigInt(min) + 1n;
    if (spanBig > MAX_UINT32_SPAN) {
      throw new RangeError(
        `nextInt range span (${spanBig.toString()}) exceeds maximum 32-bit PRNG span (4294967296 / 2^32) for bounds [${min}, ${max}]`
      );
    }

    if (spanBig === MAX_UINT32_SPAN) {
      return min + this.nextUint32();
    }

    const span = Number(spanBig);
    const limit = 0x100000000 - (0x100000000 % span);
    let r = this.nextUint32();
    while (r >= limit) {
      r = this.nextUint32();
    }
    return min + (r % span);
  }

  /**
   * Probabilistic Bernoulli trial: returns true with probability `p` in [0, 1].
   * Clamps finite probabilities outside [0, 1] (`<= 0` -> false, `>= 1` -> true).
   * Throws RangeError on non-finite values (`NaN`, `±Infinity`).
   */
  chance(probability: number): boolean {
    if (!Number.isFinite(probability)) {
      throw new RangeError(`chance probability must be finite, received: ${probability}`);
    }
    if (probability <= 0) return false;
    if (probability >= 1) return true;
    return this.nextFloat() < probability;
  }

  /**
   * Returns a normally distributed float using Box-Muller transform.
   *
   * @param mean Finite distribution mean (default: 0).
   * @param stdDev Finite non-negative standard deviation (default: 1). Negative values throw RangeError.
   * @throws {RangeError} When `mean` or `stdDev` is non-finite, or when `stdDev < 0`.
   */
  gaussian(mean = 0, stdDev = 1): number {
    if (!Number.isFinite(mean) || !Number.isFinite(stdDev)) {
      throw new RangeError(`gaussian parameters must be finite: mean=${mean}, stdDev=${stdDev}`);
    }
    if (stdDev < 0) {
      throw new RangeError(`gaussian stdDev must be >= 0, received: ${stdDev}`);
    }
    const u1 = Math.max(1e-12, this.nextFloat());
    const u2 = this.nextFloat();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z0 * stdDev;
  }

  /**
   * Picks one element uniformly from a non-empty array.
   */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('Cannot pick from an empty array');
    }
    return items[this.nextInt(0, items.length - 1)];
  }

  /**
   * Picks one element proportionally to non-negative weights.
   * Elements with weight === 0 are strictly excluded even on boundary draws (nextFloat() === 0).
   * Automatically rescales weights when raw sum would overflow IEEE-754 float64.
   */
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0 || items.length !== weights.length) {
      throw new RangeError('items and weights must be non-empty and equal in length');
    }
    let total = 0;
    let maxWeight = 0;
    let lastPositiveIndex = -1;

    for (let i = 0; i < weights.length; i++) {
      const w = weights[i];
      if (!Number.isFinite(w) || w < 0) {
        throw new RangeError(`Invalid weight at index ${i}: ${w}`);
      }
      if (w > 0) {
        lastPositiveIndex = i;
        if (w > maxWeight) maxWeight = w;
      }
      total += w;
    }

    if (lastPositiveIndex < 0 || maxWeight <= 0) {
      throw new RangeError('Total weight must be > 0');
    }

    // Prevent overflow to Infinity when large weights (e.g. Number.MAX_VALUE) are summed
    let scale = 1;
    if (!Number.isFinite(total)) {
      scale = 1 / maxWeight;
      total = 0;
      for (let i = 0; i <= lastPositiveIndex; i++) {
        if (weights[i] > 0) {
          total += weights[i] * scale;
        }
      }
    }

    let threshold = this.nextFloat() * total;
    for (let i = 0; i < lastPositiveIndex; i++) {
      const rawW = weights[i];
      if (rawW <= 0) continue;
      const w = scale === 1 ? rawW : rawW * scale;
      if (threshold < w) return items[i];
      threshold -= w;
    }
    return items[lastPositiveIndex];
  }

  /**
   * Returns a deterministically shuffled copy of the input array (Fisher-Yates).
   */
  shuffled<T>(items: readonly T[]): T[] {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  /**
   * Creates an independent child PRNG stream scoped to `label`.
   * Advancing the child stream never mutates the parent stream's internal state,
   * and vice versa (aside from being deterministically derived from `initialSeed`
   * + `label` or current state if `fromCurrentState` is true).
   */
  fork(label: string | number, fromCurrentState = false): SeededRng {
    const base = fromCurrentState ? this.state : this.initialSeed;
    return new SeededRng(deriveSeed(base, label));
  }

  /**
   * Captures the exact internal 32-bit state for deterministic snapshots/replays.
   */
  getState(): number {
    return this.state >>> 0;
  }

  /**
   * Restores the exact internal unsigned 32-bit state in [0, 0xFFFFFFFF].
   */
  setState(state: number): void {
    if (!Number.isInteger(state) || state < 0 || state > 0xffffffff) {
      throw new RangeError(`RNG state must be an integer in [0, 0xffffffff], received: ${state}`);
    }
    this.state = state >>> 0;
  }

  /**
   * Clones the PRNG preserving its exact current sequence position.
   */
  clone(): SeededRng {
    const copy = new SeededRng(this.initialSeed);
    copy.setState(this.getState());
    return copy;
  }
}

/**
 * Convenience container for named independent subsystem RNG streams
 * derived deterministically from one experiment root seed.
 */
export class RngStreams {
  public readonly rootSeed: number;
  private readonly streams = new Map<string, SeededRng>();

  constructor(seed: SeedInput, streamNames: readonly string[] = []) {
    this.rootSeed = normalizeSeed(seed);
    for (const name of streamNames) {
      this.get(name);
    }
  }

  get(name: string): SeededRng {
    let stream = this.streams.get(name);
    if (!stream) {
      stream = new SeededRng(deriveSeed(this.rootSeed, name));
      this.streams.set(name, stream);
    }
    return stream;
  }

  has(name: string): boolean {
    return this.streams.has(name);
  }

  names(): string[] {
    return Array.from(this.streams.keys());
  }

  snapshotStates(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, rng] of this.streams.entries()) {
      out[k] = rng.getState();
    }
    return out;
  }

  restoreStates(states: Readonly<Record<string, number>>): void {
    for (const [k, state] of Object.entries(states)) {
      this.get(k).setState(state);
    }
  }
}
