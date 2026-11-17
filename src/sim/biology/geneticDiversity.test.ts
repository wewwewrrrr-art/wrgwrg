import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { SeededRng } from '../prng';
import { WorldCellPatch, WorldGrid } from '../worldGrid';
import { ANATOMY_LOCUS_COUNT } from './anatomy';
import { BiologySimulation } from './biologySimulation';
import { computePopulationGeneticSummary } from './evolution';
import { DiploidGenome, createDiploidGenome, createIndividualGenome } from './genome';
import {
  GeneticLocusStatistics,
  PopulationGeneticProfile,
  compareGeneticProfiles,
  computeAmongGroupDifferentiation,
  computeGeneticProfile,
} from './geneticDiversity';
import { Organism, Sex } from './organism';
import { RAPTOR_SPECIES, SpeciesDefinition, SpeciesRegistry } from './species';

// =================================================================================================
// Helpers
// =================================================================================================

const SCHEMA = RAPTOR_SPECIES.genomeSchema;
const LOCI = SCHEMA.loci.map((d) => d.id);
const idx = (traitId: string) => SCHEMA.getIndex(traitId);

/** Uniform warm, moist lowland; regions can then be reshaped with `paint`. */
function makeFlatGrid(width: number, height: number, seed: string): WorldGrid {
  const grid = WorldGrid.generate({ width, height, seed });
  for (let i = 0; i < grid.cellCount; i++) {
    grid.setCellByIndex(i, { elevation: 0.5, temperature: 24, moisture: 0.56 });
  }
  return grid;
}

function paint(grid: WorldGrid, x0: number, y0: number, x1: number, y1: number, patch: WorldCellPatch): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid.setCell(x, y, patch);
}

/** Genome at species baselines with explicit allele pairs (and blend weights) for chosen loci. */
function genomeWith(
  pairs: Readonly<Record<string, readonly [number, number]>>,
  dominance: Readonly<Record<string, number>> = {}
): DiploidGenome {
  const mat = LOCI.map((id) => pairs[id]?.[0] ?? RAPTOR_SPECIES.traitBaselines[id]);
  const pat = LOCI.map((id) => pairs[id]?.[1] ?? RAPTOR_SPECIES.traitBaselines[id]);
  const dom = SCHEMA.loci.map((d) => dominance[d.id] ?? d.defaultDominance);
  return createDiploidGenome(SCHEMA, mat, pat, RAPTOR_SPECIES.traitRanges, dom);
}

/** Random founder-like genome around shifted baselines (same RNG stream => same random draws). */
function shiftedGenome(rng: SeededRng, shifts: Readonly<Record<string, number>>, spread = 0.12): DiploidGenome {
  const baselines: Record<string, number> = { ...RAPTOR_SPECIES.traitBaselines };
  for (const [id, delta] of Object.entries(shifts)) baselines[id] += delta;
  return createIndividualGenome(SCHEMA, baselines, RAPTOR_SPECIES.traitRanges, spread, rng);
}

function makeSim(grid: WorldGrid, seed: string, spatial = false, registry?: SpeciesRegistry): BiologySimulation {
  return new BiologySimulation({ grid, seed, strictConservation: true, recordHistory: false, spatial, speciesRegistry: registry });
}

function spawnAt(sim: BiologySimulation, x: number, y: number, genome: DiploidGenome, sex: Sex = 'female', stage: 'egg' | 'adult' = 'adult'): Organism {
  return sim.spawnOrganism({ speciesId: 'raptor', x, y, sex, stage, energy: 0.9, health: 1, genome });
}

function locus(profile: PopulationGeneticProfile, traitId: string): GeneticLocusStatistics {
  const s = profile.coreLoci.find((l) => l.traitId === traitId);
  assert.ok(s, `locus ${traitId} must be present`);
  return s;
}

function close(actual: number, expected: number, tol: number, label: string): void {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: expected ${expected}, got ${actual}`);
}

/** Bit-exact fingerprint of the simulation state that a read-only query must never change. */
function fingerprint(sim: BiologySimulation, speciesIds: readonly string[]): string {
  const h = crypto.createHash('sha256');
  h.update(`tick=${sim.tick};`);
  for (const sp of speciesIds) {
    const orgs = [...sim.getOrganisms(sp)].sort((a, b) => a.id - b.id);
    h.update(`${sp}:${orgs.length};`);
    for (const o of orgs) {
      h.update(`${o.id},${o.stage},${o.ageTicks},${o.x},${o.y},${o.health},${o.energy},${o.reproductionCooldown},${o.anatomy ? 1 : 0};`);
      h.update(Buffer.from(o.genome.maternalAlleles.buffer));
      h.update(Buffer.from(o.genome.paternalAlleles.buffer));
      h.update(Buffer.from(o.genome.dominance.buffer));
      h.update(Buffer.from(o.phenotype.geneticExpression.buffer));
      h.update(Buffer.from(o.phenotype.expressed.buffer));
      if (o.anatomy) h.update(Buffer.from(o.anatomy.maternal.buffer));
      h.update(JSON.stringify(sim.getOrganismMassAndEnergy(o.id)));
      h.update(JSON.stringify(sim.getOrganismSpatialState(o.id) ?? null));
    }
  }
  const big = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
  h.update(JSON.stringify(sim.getEnergyAudit(), big));
  h.update(JSON.stringify(sim.streams.snapshotStates()));
  if (sim.spatial) h.update(JSON.stringify(sim.spatial.stats));
  return h.digest('hex');
}

// =================================================================================================
// 1. Mean trait values
// =================================================================================================

test('Genetics 1: mean inherited trait values, allele means and counts are computed exactly', () => {
  const grid = makeFlatGrid(12, 8, 'gen-mean');
  const sim = makeSim(grid, 'gen-mean-sim');
  // bodySize allele pairs and blend weights chosen by hand
  const specs: { pair: [number, number]; dom: number }[] = [
    { pair: [1.0, 1.2], dom: 0.5 },
    { pair: [0.8, 1.4], dom: 0.25 },
    { pair: [1.6, 1.6], dom: 0.5 },
    { pair: [0.5, 0.9], dom: 1.0 },
  ];
  specs.forEach((s, i) => spawnAt(sim, 2 + i, 3, genomeWith({ bodySize: s.pair }, { bodySize: s.dom }), i % 2 ? 'male' : 'female'));

  const f = Math.fround;
  const genotypic = specs.map(({ pair: [a, b], dom }) => {
    const lo = Math.min(f(a), f(b));
    const hi = Math.max(f(a), f(b));
    return f(lo + (hi - lo) * f(dom));
  });
  const alleles = specs.flatMap(({ pair: [a, b] }) => [f(a), f(b)]);
  const expectedMean = genotypic.reduce((s, v) => s + v, 0) / genotypic.length;
  const expectedAlleleMean = alleles.reduce((s, v) => s + v, 0) / alleles.length;

  const profile = sim.getGeneticProfile('raptor');
  assert.equal(profile.speciesId, 'raptor');
  assert.equal(profile.schemaId, SCHEMA.id);
  assert.equal(profile.livingCount, 4);
  assert.equal(profile.count, 4);
  assert.equal(profile.eggCount, 0);
  assert.equal(profile.anatomyCarrierCount, 4, 'introduced organisms carry an anatomy genome');
  assert.deepEqual(profile.coreLoci.map((l) => l.traitId), LOCI, 'core loci in genome-schema order');
  assert.equal(profile.anatomyLoci.length, ANATOMY_LOCUS_COUNT);

  const body = locus(profile, 'bodySize');
  close(body.mean, expectedMean, 1e-12, 'bodySize mean');
  close(body.alleleMean, expectedAlleleMean, 1e-12, 'bodySize allele mean');
  assert.equal(body.min, Math.min(...genotypic));
  assert.equal(body.max, Math.max(...genotypic));
  close(body.dominanceMean, (0.5 + 0.25 + 0.5 + 1.0) / 4, 1e-12, 'dominance mean');
  // Loci at baseline in every individual: no spread at all
  const speed = locus(profile, 'speed');
  close(speed.mean, f(RAPTOR_SPECIES.traitBaselines.speed), 1e-12, 'speed mean');
  assert.equal(speed.variance, 0);

  // Agreement with the existing per-tick statistics (PopulationStats)
  const stats = sim.getStats('raptor');
  for (const l of profile.coreLoci) {
    close(l.mean, stats.meanGenotype[l.traitId], 1e-9, `${l.traitId} vs PopulationStats.meanGenotype`);
    close(l.stdDev, stats.traitStdDev[l.traitId], 1e-6, `${l.traitId} vs PopulationStats.traitStdDev`);
  }

  // Anatomy loci: mean of the inherited anatomy expression of the carriers
  const orgs = sim.getOrganisms('raptor');
  for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) {
    const expected = orgs.reduce((s, o) => s + o.anatomy!.expressed[a], 0) / orgs.length;
    close(profile.anatomyLoci[a].mean, expected, 1e-12, `anatomy locus ${a}`);
  }

  // Eggs are counted as living and can be excluded explicitly
  spawnAt(sim, 8, 3, genomeWith({ bodySize: [2.0, 2.0] }), 'female', 'egg');
  const withEggs = sim.getGeneticProfile('raptor');
  const withoutEggs = sim.getGeneticProfile('raptor', { includeEggs: false });
  assert.equal(withEggs.livingCount, 5);
  assert.equal(withEggs.eggCount, 1);
  assert.equal(withEggs.count, 5);
  assert.equal(withoutEggs.livingCount, 5);
  assert.equal(withoutEggs.count, 4);
  assert.equal(withoutEggs.includesEggs, false);
  close(locus(withoutEggs, 'bodySize').mean, expectedMean, 1e-12, 'egg excluded');
  assert.ok(locus(withEggs, 'bodySize').mean > expectedMean);
});

// =================================================================================================
// 2. Genetic diversity
// =================================================================================================

test('Genetics 2: diversity measures follow the diploid allele model exactly', () => {
  const span = (id: string) => RAPTOR_SPECIES.traitRanges[id].max - RAPTOR_SPECIES.traitRanges[id].min;

  // (a) Monomorphic population: no variation anywhere
  const mono = makeSim(makeFlatGrid(10, 6, 'gen-mono'), 'gen-mono-sim');
  for (let i = 0; i < 5; i++) spawnAt(mono, 1 + i, 2, genomeWith({}), i % 2 ? 'male' : 'female');
  const pm = mono.getGeneticProfile('raptor');
  for (const l of pm.coreLoci) {
    assert.equal(l.variance, 0, `${l.traitId} variance`);
    assert.equal(l.alleleVariance, 0);
    assert.equal(l.normalizedStdDev, 0);
    assert.ok(Number.isNaN(l.alleleCorrelation), 'allele correlation is undefined without variation');
    assert.equal(l.meanNormalizedAlleleDivergence, 0);
  }
  assert.equal(pm.coreDiversity.polymorphicLoci, 0);
  assert.equal(pm.coreDiversity.meanNormalizedStdDev, 0);
  assert.ok(Number.isNaN(pm.coreDiversity.meanAlleleCorrelation));

  // (b) Every individual heterozygous (1.0 / 2.0) at `speed`: all variation lies inside individuals
  const het = makeSim(makeFlatGrid(10, 6, 'gen-het'), 'gen-het-sim');
  for (let i = 0; i < 4; i++) spawnAt(het, 1 + i, 2, genomeWith({ speed: [1.0, 2.0] }), i % 2 ? 'male' : 'female');
  const sh = locus(het.getGeneticProfile('raptor'), 'speed');
  close(sh.alleleMean, 1.5, 1e-12, 'het allele mean');
  close(sh.alleleVariance, 0.25, 1e-12, 'het allele variance');
  close(sh.withinIndividualAlleleVariance, 0.25, 1e-12, 'het within');
  close(sh.betweenIndividualAlleleVariance, 0, 1e-12, 'het between');
  close(sh.alleleCorrelation, -1, 1e-12, 'het allele correlation');
  close(sh.meanNormalizedAlleleDivergence, 1.0 / span('speed'), 1e-12, 'het divergence');
  assert.equal(sh.variance, 0, 'identical individuals have identical trait values');

  // (c) Homozygous individuals that differ from each other: all variation lies between individuals
  const hom = makeSim(makeFlatGrid(10, 6, 'gen-hom'), 'gen-hom-sim');
  for (let i = 0; i < 4; i++) spawnAt(hom, 1 + i, 2, genomeWith({ speed: i % 2 ? [2.0, 2.0] : [1.0, 1.0] }), i % 2 ? 'male' : 'female');
  const so = locus(hom.getGeneticProfile('raptor'), 'speed');
  close(so.alleleVariance, 0.25, 1e-12, 'hom allele variance');
  close(so.withinIndividualAlleleVariance, 0, 1e-12, 'hom within');
  close(so.betweenIndividualAlleleVariance, 0.25, 1e-12, 'hom between');
  close(so.alleleCorrelation, 1, 1e-12, 'hom allele correlation');
  assert.equal(so.meanNormalizedAlleleDivergence, 0);
  close(so.variance, 0.25, 1e-12, 'hom trait variance');
  close(so.coefficientOfVariation, 0.5 / 1.5, 1e-12, 'hom coefficient of variation');

  // (d) Random founders: independent allele copies, variance identity, wider founders = more diverse
  const grid = WorldGrid.generate({ width: 40, height: 30, seed: 'gen-founders' });
  const narrowSpecies: SpeciesDefinition = { ...RAPTOR_SPECIES, initialGeneticSpread: 0.03 };
  const wideSpecies: SpeciesDefinition = { ...RAPTOR_SPECIES, initialGeneticSpread: 0.15 };
  const profiles: PopulationGeneticProfile[] = [];
  for (const species of [narrowSpecies, wideSpecies]) {
    const reg = new SpeciesRegistry();
    reg.register(species);
    const sim = makeSim(grid, 'gen-founders-sim', false, reg);
    sim.spawnFounderPopulation('raptor', 3000);
    const p = sim.getGeneticProfile('raptor');
    profiles.push(p);
    for (const l of p.coreLoci) {
      close(l.alleleVariance, l.withinIndividualAlleleVariance + l.betweenIndividualAlleleVariance, 1e-9, `${l.traitId} variance identity`);
      assert.ok(Math.abs(l.alleleCorrelation) < 0.08, `${l.traitId}: founders combine alleles independently (r=${l.alleleCorrelation})`);
    }
    assert.equal(p.coreDiversity.polymorphicLoci, SCHEMA.locusCount);

    // Same definitions as the existing summaries (founders all carry anatomy, so the existing
    // function does not need to synthesize anything here)
    const stats = sim.getStats('raptor');
    close(p.coreDiversity.meanNormalizedAlleleDivergence, stats.geneticDiversity.meanNormalizedAlleleDivergence, 1e-9, 'vs PopulationStats divergence');
    const existing = computePopulationGeneticSummary(sim.getOrganisms('raptor'), species);
    assert.equal(existing.count, p.count);
    close(p.coreDiversity.meanNormalizedAlleleDivergence, existing.heterozygosity, 1e-9, 'vs evolution heterozygosity');
    for (let l = 0; l < SCHEMA.locusCount; l++) {
      close(p.coreLoci[l].alleleMean, existing.meanCoreAlleles[l], 1e-9, 'vs evolution allele mean');
      close(p.coreLoci[l].betweenIndividualAlleleVariance, existing.coreAlleleVariance[l], 1e-9, 'vs evolution allele variance');
    }
    for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) {
      close(p.anatomyLoci[a].alleleMean, existing.meanAnatomyAlleles[a], 1e-6, 'vs evolution anatomy allele mean');
    }
  }
  const [narrow, wide] = profiles;
  assert.ok(
    wide.coreDiversity.meanNormalizedStdDev > 3 * narrow.coreDiversity.meanNormalizedStdDev,
    'a founder population with five times the genetic spread must measure as clearly more diverse'
  );
  assert.ok(wide.coreDiversity.meanNormalizedAlleleDivergence > narrow.coreDiversity.meanNormalizedAlleleDivergence);
  close(locus(wide, 'speed').normalizedStdDev / locus(narrow, 'speed').normalizedStdDev, 5, 1, 'spread ratio');
});

// =================================================================================================
// 3. Differences between spatial populations
// =================================================================================================

function twoGroupSim(seed: string, shiftB: Readonly<Record<string, number>>): BiologySimulation {
  const sim = makeSim(makeFlatGrid(48, 10, 'gen-groups'), seed);
  const rngA = new SeededRng('group-A-genomes');
  const rngB = new SeededRng('group-B-genomes');
  for (let i = 0; i < 40; i++) {
    spawnAt(sim, 2 + (i % 6), 1 + Math.floor(i / 6), shiftedGenome(rngA, {}), i % 2 ? 'male' : 'female');
    spawnAt(sim, 38 + (i % 6), 1 + Math.floor(i / 6), shiftedGenome(rngB, shiftB), i % 2 ? 'male' : 'female');
  }
  return sim;
}

test('Genetics 3: diverging spatial groups of one species are detected and measured locus by locus', () => {
  // (a) Same gene pool split over two areas: no false divergence
  const same = twoGroupSim('gen-same', {}).analyzeSubpopulationGenetics('raptor');
  assert.equal(same.groups.length, 2);
  assert.equal(same.pairs.length, 1);
  const sameCmp = same.pairs[0].comparison;
  assert.ok(sameCmp.core.meanDifferentiation < 0.08, `same gene pool: mean differentiation ${sameCmp.core.meanDifferentiation}`);
  assert.ok(sameCmp.core.maxDifferentiation < 0.25, `same gene pool: max differentiation ${sameCmp.core.maxDifferentiation}`);

  // (b) The eastern group carries larger bodies and higher heat tolerance
  const sim = twoGroupSim('gen-diverged', { bodySize: 0.5, heatTolerance: 0.6 });
  const speciesBefore = sim.speciesRegistry.list().map((s) => s.id);
  const analysis = sim.analyzeSubpopulationGenetics('raptor', { linkDistance: 3, minGroupSize: 5 });
  assert.equal(analysis.livingCount, 80);
  assert.equal(analysis.spatialGroupCount, 2);
  assert.equal(analysis.groups.length, 2);
  assert.equal(analysis.unanalysedCount, 0);
  const [g0, g1] = analysis.groups;
  assert.equal(g0.size + g1.size, 80);
  const west = g0.centroidX < g1.centroidX ? g0 : g1;
  const east = west === g0 ? g1 : g0;
  assert.ok(west.centroidX < 10 && east.centroidX > 36);
  assert.equal(analysis.pairs[0].sameNavComponent, null, 'without spatial navigation the barrier status is unknown');
  assert.ok(analysis.pairs[0].centroidDistance > 30);

  const cmp = compareGeneticProfiles(west.profile, east.profile);
  const d = (id: string) => cmp.coreLoci.find((l) => l.traitId === id)!;
  for (const id of ['bodySize', 'heatTolerance']) {
    assert.ok(d(id).meanDifference > 0.35, `${id}: east must be larger (${d(id).meanDifference})`);
    assert.ok(d(id).normalizedDifference > 0.2, `${id}: normalized difference ${d(id).normalizedDifference}`);
    assert.ok(d(id).standardizedDifference > 2.5, `${id}: standardized difference ${d(id).standardizedDifference}`);
    assert.ok(d(id).differentiation > 0.6, `${id}: differentiation ${d(id).differentiation}`);
    assert.ok(d(id).alleleMeanDifference > 0.35, `${id}: gene-pool means must differ too`);
  }
  for (const id of LOCI.filter((l) => l !== 'bodySize' && l !== 'heatTolerance')) {
    assert.ok(d(id).differentiation < 0.25, `${id}: unshifted locus must stay undifferentiated (${d(id).differentiation})`);
  }
  assert.ok(['bodySize', 'heatTolerance'].includes(cmp.core.maxDifferentiationTraitId!));
  assert.ok(cmp.core.meanDifferentiation > 5 * sameCmp.core.meanDifferentiation);
  // Pairs are reported both ways consistently
  const reverse = compareGeneticProfiles(east.profile, west.profile);
  close(reverse.coreLoci[idx('bodySize')].meanDifference, -d('bodySize').meanDifference, 1e-12, 'antisymmetric difference');
  close(reverse.coreLoci[idx('bodySize')].differentiation, d('bodySize').differentiation, 1e-12, 'symmetric differentiation');
  // Among-group view agrees with the pair for two groups
  close(analysis.amongGroups!.coreLoci[idx('bodySize')].differentiation, d('bodySize').differentiation, 1e-12, 'among groups (k=2)');
  // Measurement only: no new species, every organism keeps its species
  assert.deepEqual(sim.speciesRegistry.list().map((s) => s.id), speciesBefore);
  assert.ok(sim.getOrganisms('raptor').every((o) => o.speciesId === 'raptor'));

  // (c) Gradual divergence: the measured difference grows with the actual shift
  let prevNorm = -1;
  let prevDiff = -1;
  for (const shift of [0, 0.1, 0.2, 0.4, 0.7]) {
    const a = twoGroupSim(`gen-gradual-${shift}`, { bodySize: shift }).analyzeSubpopulationGenetics('raptor');
    const l = a.pairs[0].comparison.coreLoci[idx('bodySize')];
    assert.ok(l.normalizedDifference > prevNorm, `shift ${shift}: normalized difference must grow`);
    assert.ok(l.differentiation >= prevDiff, `shift ${shift}: differentiation must not shrink`);
    prevNorm = l.normalizedDifference;
    prevDiff = l.differentiation;
  }
  assert.ok(prevDiff > 0.8);

  // (d) Three groups: among-group differentiation over all of them
  const three = makeSim(makeFlatGrid(60, 8, 'gen-three'), 'gen-three-sim');
  const rng = new SeededRng('three-genomes');
  [0, 0.3, 0.6].forEach((shift, g) => {
    for (let i = 0; i < 25; i++) spawnAt(three, 2 + g * 25 + (i % 5), 1 + Math.floor(i / 5), shiftedGenome(rng, { coldTolerance: shift }), i % 2 ? 'male' : 'female');
  });
  const t = three.analyzeSubpopulationGenetics('raptor');
  assert.equal(t.groups.length, 3);
  assert.equal(t.pairs.length, 3);
  assert.deepEqual(t.pairs.map((p) => [p.groupA, p.groupB]), [[0, 1], [0, 2], [1, 2]]);
  const cold = t.amongGroups!.coreLoci[idx('coldTolerance')];
  assert.equal(cold.groupCount, 3);
  assert.ok(cold.differentiation > 0.6, `three-group differentiation ${cold.differentiation}`);
  assert.ok(cold.normalizedMeanRange > 0.2);
  assert.ok(t.amongGroups!.coreLoci[idx('speed')].differentiation < 0.25);
});

test('Genetics 3b: geographically isolated populations keep a measurable difference across generations', () => {
  // Two islands separated by a strait: spatial behavior keeps the groups apart, they breed on their
  // own, and offspring inherit the difference through the unchanged inheritance rules.
  const grid = makeFlatGrid(34, 10, 'gen-islands');
  paint(grid, 13, 0, 20, 9, { terrain: 'deep-water' });
  const sim = makeSim(grid, 'gen-islands-sim', true);
  const rngA = new SeededRng('island-A');
  const rngB = new SeededRng('island-B');
  for (let i = 0; i < 24; i++) {
    spawnAt(sim, 2 + (i % 6), 2 + Math.floor(i / 6), shiftedGenome(rngA, {}), i % 2 ? 'male' : 'female');
    spawnAt(sim, 25 + (i % 6), 2 + Math.floor(i / 6), shiftedGenome(rngB, { bodySize: 0.5 }), i % 2 ? 'male' : 'female');
  }
  sim.stepMany(90);
  const orgs = sim.getOrganisms('raptor');
  assert.ok(orgs.every((o) => o.x <= 12 || o.x >= 21), 'nobody can be in the water');
  assert.ok(orgs.some((o) => o.generation > 0 && o.x <= 12) && orgs.some((o) => o.generation > 0 && o.x >= 21), 'both islands must breed');

  const analysis = sim.analyzeSubpopulationGenetics('raptor', { linkDistance: 3, minGroupSize: 5 });
  const westGroups = analysis.groups.filter((g) => g.centroidX <= 12);
  const eastGroups = analysis.groups.filter((g) => g.centroidX >= 21);
  assert.ok(westGroups.length >= 1 && eastGroups.length >= 1);
  const pair = analysis.pairs.find(
    (p) => westGroups.includes(analysis.groups[p.groupA]) !== westGroups.includes(analysis.groups[p.groupB])
  )!;
  assert.equal(pair.sameNavComponent, false, 'the strait is a real barrier for this species');
  const body = pair.comparison.coreLoci[idx('bodySize')];
  assert.ok(Math.abs(body.meanDifference) > 0.3, `inherited body size difference ${body.meanDifference}`);
  assert.ok(body.differentiation > 0.5, `body size differentiation ${body.differentiation}`);
  // Offspring produced by the simulation carry no anatomy genome; none is invented for them
  const p = sim.getGeneticProfile('raptor');
  const carriers = orgs.filter((o) => o.anatomy !== undefined).length;
  assert.equal(p.anatomyCarrierCount, carriers);
  assert.ok(carriers < p.count);
});

// =================================================================================================
// 4. Empty populations
// =================================================================================================

test('Genetics 4: empty, extinct and egg-only populations are handled without errors or side effects', () => {
  const reg = new SpeciesRegistry();
  reg.register(RAPTOR_SPECIES);
  reg.register({ ...RAPTOR_SPECIES, id: 'latecomer', name: 'latecomer' });
  const grid = makeFlatGrid(12, 8, 'gen-empty');
  const sim = makeSim(grid, 'gen-empty-sim', false, reg);
  spawnAt(sim, 3, 3, genomeWith({}));

  const empty = sim.getGeneticProfile('latecomer');
  assert.equal(empty.livingCount, 0);
  assert.equal(empty.count, 0);
  assert.equal(empty.anatomyCarrierCount, 0);
  assert.equal(empty.coreLoci.length, SCHEMA.locusCount, 'the locus layout is reported even when empty');
  for (const l of [...empty.coreLoci, ...empty.anatomyLoci]) {
    assert.equal(l.count, 0);
    assert.ok(Number.isNaN(l.mean) && Number.isNaN(l.variance) && Number.isNaN(l.alleleCorrelation));
  }
  assert.equal(empty.coreDiversity.count, 0);
  assert.equal(empty.coreDiversity.polymorphicLoci, 0);
  assert.ok(Number.isNaN(empty.coreDiversity.meanNormalizedStdDev));
  assert.equal(empty.anatomyDiversity, null);

  const emptyAnalysis = sim.analyzeSubpopulationGenetics('latecomer');
  assert.equal(emptyAnalysis.livingCount, 0);
  assert.equal(emptyAnalysis.spatialGroupCount, 0);
  assert.deepEqual(emptyAnalysis.groups, []);
  assert.deepEqual(emptyAnalysis.pairs, []);
  assert.equal(emptyAnalysis.amongGroups, null);
  assert.deepEqual(sim.getSubpopulations('latecomer'), []);

  // Queries must not register a population for the species
  const summary = sim.step();
  assert.deepEqual(Object.keys(summary.statsBySpecies), ['raptor'], 'no population entry may be created by a query');

  // Comparing with an empty profile yields undefined (NaN) differences, not an exception
  const cmp = compareGeneticProfiles(empty, sim.getGeneticProfile('raptor'));
  assert.ok(cmp.coreLoci.every((l) => Number.isNaN(l.meanDifference) && Number.isNaN(l.differentiation)));
  assert.equal(cmp.anatomy, null);
  assert.ok(Number.isNaN(cmp.core.meanDifferentiation));
  assert.equal(cmp.core.maxDifferentiationTraitId, null);
  const among = computeAmongGroupDifferentiation([empty, empty]);
  assert.equal(among.groupCount, 0);
  assert.ok(among.coreLoci.every((l) => Number.isNaN(l.differentiation) && Number.isNaN(l.normalizedMeanRange)));

  // A single individual: defined means, zero spread, undefined comparisons
  const single = sim.getGeneticProfile('raptor');
  assert.equal(single.count, 1);
  assert.ok(single.coreLoci.every((l) => l.variance === 0 && Number.isFinite(l.mean)));
  const selfCmp = compareGeneticProfiles(single, single);
  assert.ok(selfCmp.coreLoci.every((l) => l.meanDifference === 0 && Number.isNaN(l.differentiation)));

  // Extinction: the profile goes back to empty
  for (const o of [...sim.getOrganisms('raptor')]) sim.killOrganism('raptor', o.id, 'injury');
  const extinct = sim.getGeneticProfile('raptor');
  assert.equal(extinct.livingCount, 0);
  assert.equal(extinct.count, 0);

  // Egg-only population with eggs excluded
  spawnAt(sim, 5, 5, genomeWith({}), 'female', 'egg');
  const eggsOnly = sim.getGeneticProfile('raptor', { includeEggs: false });
  assert.equal(eggsOnly.livingCount, 1);
  assert.equal(eggsOnly.eggCount, 1);
  assert.equal(eggsOnly.count, 0);
  assert.ok(Number.isNaN(eggsOnly.coreLoci[0].mean));

  // Dead organisms passed directly are ignored; foreign organisms and unknown species are rejected
  const dead = { ...sim.getOrganisms('raptor')[0], alive: false } as Organism;
  assert.equal(computeGeneticProfile(RAPTOR_SPECIES, [dead]).count, 0);
  const foreign = { ...sim.getOrganisms('raptor')[0], speciesId: 'other' } as Organism;
  assert.throws(() => computeGeneticProfile(RAPTOR_SPECIES, [foreign]), /belongs to "other"/);
  assert.throws(() => sim.getGeneticProfile('no-such-species'), /Unknown species id/);
  assert.throws(() => sim.analyzeSubpopulationGenetics('raptor', { minGroupSize: 0 }), /minGroupSize/);
});

// =================================================================================================
// 5. Determinism
// =================================================================================================

function buildLivingSim(seed: string): BiologySimulation {
  const sim = makeSim(WorldGrid.generate({ width: 40, height: 26, seed: 'gen-living' }), seed, true);
  sim.spawnFounderPopulation('raptor', 220);
  sim.stepMany(60);
  return sim;
}

test('Genetics 5: results are deterministic, order-independent and reproducible from the seed', () => {
  const a = buildLivingSim('gen-det');
  const b = buildLivingSim('gen-det');
  const c = buildLivingSim('gen-det-other');

  const pa = a.getGeneticProfile('raptor');
  const pb = b.getGeneticProfile('raptor');
  assert.ok(pa.count > 50 && pa.count > pa.anatomyCarrierCount, 'a living, breeding population is analysed');
  assert.deepEqual(pa, pb, 'same seed => identical profile');
  assert.deepEqual(a.analyzeSubpopulationGenetics('raptor', { minGroupSize: 3 }), b.analyzeSubpopulationGenetics('raptor', { minGroupSize: 3 }));
  assert.notDeepEqual(pa, c.getGeneticProfile('raptor'), 'another seed => another gene pool');

  // Repeated queries are bit-identical
  assert.deepEqual(a.getGeneticProfile('raptor'), pa);
  assert.deepEqual(a.analyzeSubpopulationGenetics('raptor', { minGroupSize: 3 }), b.analyzeSubpopulationGenetics('raptor', { minGroupSize: 3 }));

  // Input order does not matter: organisms are visited in ascending id order
  const organisms = [...a.getOrganisms('raptor')];
  const shuffled = new SeededRng('shuffle').shuffled(organisms);
  assert.notDeepEqual(shuffled.map((o) => o.id), organisms.map((o) => o.id));
  assert.deepEqual(computeGeneticProfile(RAPTOR_SPECIES, shuffled, { tick: a.tick }), pa);
  assert.deepEqual(computeGeneticProfile(RAPTOR_SPECIES, [...organisms].reverse(), { tick: a.tick }), pa);

  // Results are immutable snapshots
  assert.ok(Object.isFrozen(pa) && Object.isFrozen(pa.coreLoci) && Object.isFrozen(pa.coreLoci[0]));
  assert.throws(() => {
    (pa.coreLoci[0] as { mean: number }).mean = 0;
  }, TypeError);
});

// =================================================================================================
// 6. Queries do not change the simulation
// =================================================================================================

test('Genetics 6: genetic queries leave the simulation state and its future bit-identical', () => {
  const queried = buildLivingSim('gen-readonly');
  const untouched = buildLivingSim('gen-readonly');
  const ids = ['raptor'];
  const before = fingerprint(queried, ids);
  assert.equal(before, fingerprint(untouched, ids));
  const anatomyBefore = queried.getOrganisms('raptor').filter((o) => o.anatomy !== undefined).length;

  for (let i = 0; i < 5; i++) {
    queried.getGeneticProfile('raptor');
    queried.getGeneticProfile('raptor', { includeEggs: false });
    for (const linkDistance of [1, 2, 3, 6]) {
      queried.analyzeSubpopulationGenetics('raptor', { linkDistance, minGroupSize: 1, maxGroups: 50 });
    }
    computeGeneticProfile(RAPTOR_SPECIES, queried.getOrganisms('raptor'));
  }
  assert.equal(fingerprint(queried, ids), before, 'querying must not change any state');
  assert.equal(
    queried.getOrganisms('raptor').filter((o) => o.anatomy !== undefined).length,
    anatomyBefore,
    'no anatomy genome may be synthesized by a query'
  );

  // ...nor the future: both worlds continue identically, with queries interleaved in one of them
  for (let t = 0; t < 30; t++) {
    queried.step();
    queried.analyzeSubpopulationGenetics('raptor');
    queried.getGeneticProfile('raptor');
    untouched.step();
  }
  assert.equal(fingerprint(queried, ids), fingerprint(untouched, ids));
  assert.deepEqual(queried.getStats('raptor'), untouched.getStats('raptor'));
});

// =================================================================================================
// Performance: single pass, linear in population size
// =================================================================================================

test('Genetics: profiles are linear-time single-pass and analyse 20 000 organisms quickly', () => {
  const grid = WorldGrid.generate({ width: 128, height: 96, seed: 'gen-load' });
  const sim = makeSim(grid, 'gen-load-sim');
  sim.spawnFounderPopulation('raptor', 20_000);
  sim.getGeneticProfile('raptor'); // warm-up
  const t0 = performance.now();
  const runs = 5;
  for (let i = 0; i < runs; i++) sim.getGeneticProfile('raptor');
  const profileMs = (performance.now() - t0) / runs;
  const t1 = performance.now();
  const analysis = sim.analyzeSubpopulationGenetics('raptor', { minGroupSize: 5, maxGroups: 12 });
  const analysisMs = performance.now() - t1;
  assert.equal(sim.getGeneticProfile('raptor').count, 20_000);
  assert.ok(analysis.groups.length >= 1 && analysis.pairs.length <= (12 * 11) / 2);
  // Generous regression guards, not performance targets
  assert.ok(profileMs < 150, `profile of 20 000 organisms took ${profileMs.toFixed(1)} ms`);
  assert.ok(analysisMs < 1500, `subpopulation analysis took ${analysisMs.toFixed(1)} ms`);
});
