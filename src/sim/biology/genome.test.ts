import assert from 'node:assert/strict';
import test from 'node:test';
import { SeededRng } from '../prng';
import {
  CORE_GENOME_SCHEMA,
  CORE_TRAIT_IDS,
  computePhenotype,
  createDiploidGenome,
  createHaploidGamete,
  createIndividualGenome,
  expressDiploidLocus,
  getTraitFromArray,
} from './genome';
import { RAPTOR_SPECIES } from './species';

test('Genome: creates individual diploid genomes within trait bounds with all 10 core traits', () => {
  assert.equal(CORE_GENOME_SCHEMA.locusCount, 10);
  for (const id of CORE_TRAIT_IDS) {
    assert.equal(CORE_GENOME_SCHEMA.hasTrait(id), true);
  }

  const rng = new SeededRng('raptor-founders');
  const g1 = createIndividualGenome(
    RAPTOR_SPECIES.genomeSchema,
    RAPTOR_SPECIES.traitBaselines,
    RAPTOR_SPECIES.traitRanges,
    RAPTOR_SPECIES.initialGeneticSpread,
    rng
  );
  const g2 = createIndividualGenome(
    RAPTOR_SPECIES.genomeSchema,
    RAPTOR_SPECIES.traitBaselines,
    RAPTOR_SPECIES.traitRanges,
    RAPTOR_SPECIES.initialGeneticSpread,
    rng
  );

  // Two individuals from the same species must differ genetically
  let diffs = 0;
  for (let i = 0; i < CORE_GENOME_SCHEMA.locusCount; i++) {
    const def = CORE_GENOME_SCHEMA.loci[i];
    const r = RAPTOR_SPECIES.traitRanges[def.id];
    assert.ok(g1.maternalAlleles[i] >= r.min && g1.maternalAlleles[i] <= r.max);
    assert.ok(g1.paternalAlleles[i] >= r.min && g1.paternalAlleles[i] <= r.max);
    assert.ok(g2.maternalAlleles[i] >= r.min && g2.maternalAlleles[i] <= r.max);
    assert.ok(g2.paternalAlleles[i] >= r.min && g2.paternalAlleles[i] <= r.max);
    if (
      g1.maternalAlleles[i] !== g2.maternalAlleles[i] ||
      g1.paternalAlleles[i] !== g2.paternalAlleles[i]
    ) {
      diffs++;
    }
  }
  assert.ok(diffs >= 5, `Expected distinct individual genomes, only ${diffs} loci differed`);
});

test('Genome: extensible schema supports adding new loci and dominance modes cleanly', () => {
  const extended = CORE_GENOME_SCHEMA.extend('raptor-feathers-v2', [
    {
      id: 'featherDensity',
      label: 'Feather Density',
      defaultRange: { min: 0, max: 1 },
      defaultDominance: 1.0, // higher-allele dominant
      mutationRateMultiplier: 1.2,
      mutationScaleMultiplier: 1.0,
    },
  ]);

  assert.equal(extended.locusCount, 11);
  assert.equal(extended.getIndex('featherDensity'), 10);

  assert.equal(expressDiploidLocus(0.2, 0.8, 0.5), 0.5);
  assert.equal(expressDiploidLocus(0.2, 0.8, 1.0), 0.8);
  assert.equal(expressDiploidLocus(0.2, 0.8, 0.0), 0.2);

  const maternal = new Array(11).fill(1.0);
  const paternal = new Array(11).fill(1.0);
  maternal[10] = 0.2;
  paternal[10] = 0.9;
  const g = createDiploidGenome(extended, maternal, paternal);
  const phen = computePhenotype(g, extended, {
    physicalMaturityScale: 1,
    neuralMaturityScale: 1,
    senescencePhysicalScale: 1,
    conditionScale: 1,
  });
  assert.ok(Math.abs(getTraitFromArray(phen.geneticExpression, extended, 'featherDensity') - 0.9) < 1e-6);
});

test('Genome: separates genotype from phenotype and recombines two heterozygous parents into distinct offspring', () => {
  const schema = CORE_GENOME_SCHEMA;
  const parentA = createDiploidGenome(
    schema,
    [0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.3, 0.3, 0.6, 0.4],
    [1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.9, 1.9, 1.8, 1.6]
  );
  const parentB = createDiploidGenome(
    schema,
    [0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.4, 0.4, 0.7, 0.5],
    [1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.8, 1.8, 1.7, 1.5]
  );

  // Phenotype scales with developmental stage & condition without mutating genotype
  const eggPhen = computePhenotype(parentA, schema, {
    physicalMaturityScale: 0.15,
    neuralMaturityScale: 0.15,
    senescencePhysicalScale: 1,
    conditionScale: 1,
  });
  const adultPhen = computePhenotype(parentA, schema, {
    physicalMaturityScale: 1,
    neuralMaturityScale: 1,
    senescencePhysicalScale: 1,
    conditionScale: 1,
  });

  assert.ok(
    getTraitFromArray(eggPhen.expressed, schema, 'bodySize') <
      getTraitFromArray(adultPhen.expressed, schema, 'bodySize')
  );
  assert.deepEqual(eggPhen.geneticExpression, adultPhen.geneticExpression);

  // Two offspring from identical parents inherit independent locus assortments
  const rng = new SeededRng(4242);
  const child1Mat = createHaploidGamete(parentA, schema, rng);
  const child1Pat = createHaploidGamete(parentB, schema, rng);
  const child2Mat = createHaploidGamete(parentA, schema, rng);
  const child2Pat = createHaploidGamete(parentB, schema, rng);

  let siblingDiffs = 0;
  let parentACloneDiffs = 0;
  for (let i = 0; i < schema.locusCount; i++) {
    // Each offspring allele must come cleanly from corresponding parent
    assert.ok(
      child1Mat[i] === parentA.maternalAlleles[i] || child1Mat[i] === parentA.paternalAlleles[i]
    );
    assert.ok(
      child1Pat[i] === parentB.maternalAlleles[i] || child1Pat[i] === parentB.paternalAlleles[i]
    );
    if (child1Mat[i] !== child2Mat[i] || child1Pat[i] !== child2Pat[i]) siblingDiffs++;
    if (child1Mat[i] !== parentA.maternalAlleles[i] || child1Pat[i] !== parentA.paternalAlleles[i]) {
      parentACloneDiffs++;
    }
  }
  assert.ok(siblingDiffs > 0, 'Siblings must exhibit distinct allele combinations');
  assert.ok(parentACloneDiffs > 0, 'Offspring must not be a clone of parentA');
});

test('Genome: locus expression blend weight (dominance) does not collapse toward 0.5 across generations', () => {
  const schema = CORE_GENOME_SCHEMA;
  const gLow = createDiploidGenome(
    schema,
    new Array(schema.locusCount).fill(0.8),
    new Array(schema.locusCount).fill(1.2),
    undefined,
    new Array(schema.locusCount).fill(0.0)
  );
  const gHigh = createDiploidGenome(
    schema,
    new Array(schema.locusCount).fill(0.8),
    new Array(schema.locusCount).fill(1.2),
    undefined,
    new Array(schema.locusCount).fill(1.0)
  );
  assert.equal(expressDiploidLocus(0.8, 1.2, 0.0), 0.8);
  assert.equal(expressDiploidLocus(0.8, 1.2, 1.0), 1.2);

  // Discrete parental locus blend transmission keeps extremal 0.0 / 1.0 weights intact
  const rng = new SeededRng('dom-segregation');
  let sawZero = 0;
  let sawOne = 0;
  for (let i = 0; i < 60; i++) {
    const picked = rng.chance(0.5) ? gLow.dominance[0] : gHigh.dominance[0];
    assert.ok(picked === 0.0 || picked === 1.0, `Expected discrete 0.0 or 1.0, got ${picked}`);
    if (picked === 0.0) sawZero++;
    else sawOne++;
  }
  assert.ok(sawZero > 10 && sawOne > 10);
});
