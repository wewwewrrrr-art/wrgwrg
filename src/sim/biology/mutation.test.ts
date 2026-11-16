import assert from 'node:assert/strict';
import test from 'node:test';
import { SeededRng } from '../prng';
import {
  CORE_GENOME_SCHEMA,
  cloneGenome,
  createDiploidGenome,
  createHaploidGamete,
  createIndividualGenome,
} from './genome';
import { mutateGenome, validateMutationConfig } from './mutation';
import { RAPTOR_SPECIES } from './species';

test('Mutation: produces both positive and negative changes with majority non-beneficial, bounded by species ranges', () => {
  const baseGenome = createDiploidGenome(
    CORE_GENOME_SCHEMA,
    new Array(CORE_GENOME_SCHEMA.locusCount).fill(1.1),
    new Array(CORE_GENOME_SCHEMA.locusCount).fill(1.1),
    RAPTOR_SPECIES.traitRanges
  );

  const rng = new SeededRng('mutation-balance-check');
  let positive = 0;
  let negative = 0;

  for (let trial = 0; trial < 300; trial++) {
    const g = cloneGenome(baseGenome);
    const outcome = mutateGenome(
      g,
      CORE_GENOME_SCHEMA,
      RAPTOR_SPECIES.traitRanges,
      { baseRate: 0.25, stepScale: 0.08, directionalBias: -0.25 },
      rng,
      true
    );
    for (const rec of outcome.records) {
      const range = RAPTOR_SPECIES.traitRanges[rec.traitId];
      assert.ok(rec.after >= range.min && rec.after <= range.max);
      if (rec.delta > 0) positive++;
      else if (rec.delta < 0) negative++;
    }
  }

  assert.ok(positive > 200, `Expected substantial positive mutations, got ${positive}`);
  assert.ok(negative > positive, `Expected majority non-beneficial mutations (neg=${negative}, pos=${positive})`);
});

test('Mutation: deterministic under identical Seed, respects locus overrides and config validation', () => {
  const baseGenome = createDiploidGenome(
    CORE_GENOME_SCHEMA,
    new Array(CORE_GENOME_SCHEMA.locusCount).fill(1.0),
    new Array(CORE_GENOME_SCHEMA.locusCount).fill(1.0),
    RAPTOR_SPECIES.traitRanges
  );

  const cfg = {
    baseRate: 0.2,
    stepScale: 0.1,
    directionalBias: -0.25,
    locusOverrides: {
      speed: { rateMultiplier: 5.0, scaleMultiplier: 1.5 }, // rate = 1.0 (always mutates)
      intelligence: { rateMultiplier: 0.0, scaleMultiplier: 0.0 }, // never mutates
    },
  };

  const gA = cloneGenome(baseGenome);
  const gB = cloneGenome(baseGenome);
  const resA = mutateGenome(gA, CORE_GENOME_SCHEMA, RAPTOR_SPECIES.traitRanges, cfg, new SeededRng(999), true);
  const resB = mutateGenome(gB, CORE_GENOME_SCHEMA, RAPTOR_SPECIES.traitRanges, cfg, new SeededRng(999), true);

  assert.deepEqual(gA.maternalAlleles, gB.maternalAlleles);
  assert.deepEqual(gA.paternalAlleles, gB.paternalAlleles);
  assert.deepEqual(resA.records, resB.records);

  const speedIdx = CORE_GENOME_SCHEMA.getIndex('speed');
  const intelIdx = CORE_GENOME_SCHEMA.getIndex('intelligence');
  assert.equal(gA.maternalAlleles[intelIdx], 1.0);
  assert.equal(gA.paternalAlleles[intelIdx], 1.0);
  assert.ok(
    gA.maternalAlleles[speedIdx] !== 1.0 || gA.paternalAlleles[speedIdx] !== 1.0,
    'Overridden high-rate speed locus should mutate'
  );

  assert.throws(() => validateMutationConfig({ baseRate: -0.1, stepScale: 0.05 }), RangeError);
  assert.throws(() => validateMutationConfig({ baseRate: 1.5, stepScale: 0.05 }), RangeError);
  assert.throws(() => validateMutationConfig({ baseRate: 0.1, stepScale: Number.NaN }), RangeError);
});

test('Mutation: default configuration is symmetric (directionalBias = 0.0) across >= 20,000 mutations with zero artificial drift', () => {
  assert.equal(RAPTOR_SPECIES.mutation.directionalBias, 0.0);

  const baseGenome = createDiploidGenome(
    CORE_GENOME_SCHEMA,
    new Array(CORE_GENOME_SCHEMA.locusCount).fill(1.15),
    new Array(CORE_GENOME_SCHEMA.locusCount).fill(1.15),
    RAPTOR_SPECIES.traitRanges
  );

  const rng = new SeededRng('symmetry-20k');
  let positive = 0;
  let negative = 0;
  let sumDelta = 0;
  let totalMutations = 0;

  // 25,000 trials * 20 alleles * 0.045 = ~22,500 mutations
  for (let trial = 0; trial < 25000; trial++) {
    const g = cloneGenome(baseGenome);
    const out = mutateGenome(
      g,
      CORE_GENOME_SCHEMA,
      RAPTOR_SPECIES.traitRanges,
      { baseRate: 0.045, stepScale: 0.08 },
      rng,
      true
    );
    for (const rec of out.records) {
      totalMutations++;
      sumDelta += rec.delta;
      if (rec.delta > 0) positive++;
      else if (rec.delta < 0) negative++;
    }
  }

  assert.ok(totalMutations >= 20000, `Expected >= 20000 mutations, got ${totalMutations}`);
  const posRatio = positive / (positive + negative);
  const meanDelta = sumDelta / totalMutations;
  assert.ok(posRatio > 0.485 && posRatio < 0.515, `Expected ~50/50 split, got posRatio=${posRatio.toFixed(4)}`);
  assert.ok(Math.abs(meanDelta) < 0.005, `Expected unbiased mean delta near 0, got ${meanDelta.toFixed(6)}`);
});

test('Mutation: neutral multi-generation reproduction exhibits no systematic directional trait degradation', () => {
  const rng = new SeededRng('neutral-30gen-drift');
  const popSize = 200;
  let pop = Array.from({ length: popSize }, () =>
    createIndividualGenome(
      RAPTOR_SPECIES.genomeSchema,
      RAPTOR_SPECIES.traitBaselines,
      RAPTOR_SPECIES.traitRanges,
      RAPTOR_SPECIES.initialGeneticSpread,
      rng
    )
  );

  const computeMeans = (list: typeof pop) => {
    const sums = new Float64Array(CORE_GENOME_SCHEMA.locusCount);
    for (const g of list) {
      for (let i = 0; i < sums.length; i++) {
        sums[i] += (g.maternalAlleles[i] + g.paternalAlleles[i]) * 0.5;
      }
    }
    return Array.from(sums, (s) => s / list.length);
  };

  const initialMeans = computeMeans(pop);
  for (let gen = 0; gen < 30; gen++) {
    const next: typeof pop = [];
    for (let k = 0; k < popSize; k++) {
      const pA = pop[rng.nextInt(0, popSize - 1)];
      const pB = pop[rng.nextInt(0, popSize - 1)];
      const mat = createHaploidGamete(pA, CORE_GENOME_SCHEMA, rng);
      const pat = createHaploidGamete(pB, CORE_GENOME_SCHEMA, rng);
      const child = createDiploidGenome(
        CORE_GENOME_SCHEMA,
        mat,
        pat,
        RAPTOR_SPECIES.traitRanges
      );
      mutateGenome(
        child,
        CORE_GENOME_SCHEMA,
        RAPTOR_SPECIES.traitRanges,
        RAPTOR_SPECIES.mutation,
        rng,
        false
      );
      next.push(child);
    }
    pop = next;
  }

  const finalMeans = computeMeans(pop);
  let totalNormalizedShift = 0;
  for (let i = 0; i < CORE_GENOME_SCHEMA.locusCount; i++) {
    const def = CORE_GENOME_SCHEMA.loci[i];
    const r = RAPTOR_SPECIES.traitRanges[def.id];
    const normShift = (finalMeans[i] - initialMeans[i]) / (r.max - r.min);
    totalNormalizedShift += normShift;
    assert.ok(
      Math.abs(normShift) < 0.08,
      `Neutral drift on ${def.id} stayed bounded (${normShift.toFixed(4)})`
    );
  }
  const avgNormalizedShift = totalNormalizedShift / CORE_GENOME_SCHEMA.locusCount;
  assert.ok(
    Math.abs(avgNormalizedShift) < 0.025,
    `Average normalized shift across all loci must stay centered near 0, got ${avgNormalizedShift.toFixed(4)}`
  );
});
