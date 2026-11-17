import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { SeededRng } from '../prng';
import { WorldCellPatch, WorldGrid } from '../worldGrid';
import {
  ANATOMY_IDX,
  ANATOMY_LOCUS_COUNT,
  ANATOMY_RANGES,
  OrganismAnatomyState,
  createFounderAnatomy,
  expressAnatomy,
  getSpeciesBaselineAnatomy,
  inheritOrganismAnatomy,
} from './anatomy';
import { BiologySimulation, BiologyStepPhase } from './biologySimulation';
import {
  computePopulationGeneticSummary,
  evaluateReproductiveCompatibility,
  measureReproductiveIsolation,
} from './evolution';
import { createIndividualGenome } from './genome';
import { Organism, createOrganism } from './organism';
import { SpeciationEngine, resolveEvolutionConfig } from './speciation';
import { RAPTOR_SPECIES, SpeciesDefinition, SpeciesRegistry } from './species';

// =================================================================================================
// Shared helpers
// =================================================================================================

const SCHEMA = RAPTOR_SPECIES.genomeSchema;
const L = (id: string) => SCHEMA.getIndex(id);

/** Raptor with a short life cycle and an elevated (but symmetric) mutation process. */
const FAST: SpeciesDefinition = {
  ...RAPTOR_SPECIES,
  lifecycle: { ...RAPTOR_SPECIES.lifecycle, incubationTicks: 4, juvenileTicks: 10, elderAgeTicks: 70, maxLifespanTicks: 100 },
  reproduction: { ...RAPTOR_SPECIES.reproduction, cooldownTicks: 6 },
  mutation: { ...RAPTOR_SPECIES.mutation, baseRate: 0.12, stepScale: 0.12 },
};

function registryOf(...species: SpeciesDefinition[]): SpeciesRegistry {
  const reg = new SpeciesRegistry();
  for (const sp of species) reg.register(sp);
  return reg;
}

function flatGrid(width: number, height: number, seed: string, patch: WorldCellPatch = {}): WorldGrid {
  const grid = WorldGrid.generate({ width, height, seed });
  for (let i = 0; i < grid.cellCount; i++) {
    grid.setCellByIndex(i, { elevation: 0.5, temperature: 24, moisture: 0.56, ...patch });
  }
  return grid;
}

const GAP_FROM = 11;
const GAP_TO = 16;

/**
 * Two islands separated by a deep-water strait (x 11..16). `west`/`east` are the island climates.
 * Cold islands are moist so that they stay forested (food) instead of turning into tundra.
 */
function islandsGrid(seed: string, westTemp: number, eastTemp: number): WorldGrid {
  const grid = flatGrid(28, 10, seed);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 28; x++) {
      if (x >= GAP_FROM && x <= GAP_TO) grid.setCell(x, y, { terrain: 'deep-water' });
      else {
        const t = x < GAP_FROM ? westTemp : eastTemp;
        grid.setCell(x, y, t < 7 ? { temperature: t, moisture: 0.64 } : { temperature: t });
      }
    }
  }
  return grid;
}

/** A land bridge forms across the strait (a world event; biology itself never edits the grid). */
function openBridge(grid: WorldGrid, y0: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = GAP_FROM; x <= GAP_TO; x++) grid.setCell(x, y, { terrain: 'lowland', elevation: 0.5, temperature: 24, moisture: 0.56 });
  }
}

function islandSim(
  seed: string,
  westTemp: number,
  eastTemp: number,
  evolution: boolean | Record<string, unknown>,
  onPhase?: (ctx: { tick: number; phase: BiologyStepPhase }) => void
): { sim: BiologySimulation; grid: WorldGrid } {
  const grid = islandsGrid(`${seed}-grid`, westTemp, eastTemp);
  const sim = new BiologySimulation({
    grid,
    seed,
    speciesRegistry: registryOf(FAST),
    recordHistory: false,
    statsInterval: 1_000_000,
    spatial: true,
    evolution: evolution as never,
    onPhase,
  });
  sim.spawnFounderPopulation('raptor', 80, { center: { x: 5, y: 5, radius: 4 } });
  sim.spawnFounderPopulation('raptor', 80, { center: { x: 22, y: 5, radius: 4 } });
  return { sim, grid };
}

function allOrganisms(sim: BiologySimulation): Organism[] {
  return sim.speciesRegistry.list().flatMap((sp) => [...sim.getOrganisms(sp.id)]);
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : NaN;
}

function assertExact(sim: BiologySimulation, label: string): void {
  const audit = sim.assertEnergyAudit();
  assert.equal(audit.massResidualQ, 0n, `${label}: mass residual`);
  assert.equal(audit.energyResidualQ, 0n, `${label}: energy residual`);
}

function fingerprint(sim: BiologySimulation): string {
  const h = crypto.createHash('sha256');
  h.update(`tick=${sim.tick};species=${sim.speciesRegistry.list().map((s) => s.id).join(',')};`);
  for (const o of allOrganisms(sim).sort((a, b) => a.id - b.id)) {
    h.update(`${o.id},${o.speciesId},${o.stage},${o.ageTicks},${o.x},${o.y},${o.health},${o.energy},${o.generation};`);
    h.update(Buffer.from(o.genome.maternalAlleles.buffer));
    h.update(Buffer.from(o.genome.paternalAlleles.buffer));
    if (o.anatomy) {
      h.update(Buffer.from(o.anatomy.maternal.buffer));
      h.update(Buffer.from(o.anatomy.paternal.buffer));
      h.update(Buffer.from(o.anatomy.dominance.buffer));
    }
    h.update(JSON.stringify(o.ancestry ?? null));
    h.update(JSON.stringify(sim.getOrganismMassAndEnergy(o.id)));
  }
  const big = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
  h.update(JSON.stringify(sim.getEnergyAudit(), big));
  h.update(JSON.stringify(sim.streams.snapshotStates()));
  h.update(JSON.stringify(sim.evolutionStats));
  h.update(JSON.stringify(sim.getSpeciationTrackers()));
  h.update(JSON.stringify(sim.phylogeny ? sim.phylogeny.toSnapshot() : null));
  return h.digest('hex');
}

function anatomyOf(values: ArrayLike<number>, dominance = 0.5): OrganismAnatomyState {
  const maternal = Float32Array.from(values);
  const paternal = Float32Array.from(values);
  const dom = new Float32Array(ANATOMY_LOCUS_COUNT).fill(dominance);
  const { expressed, locomotionMode, viability } = expressAnatomy(maternal, paternal, dom);
  return { maternal, paternal, dominance: dom, expressed, locomotionMode, viability };
}

// =================================================================================================
// PART I. Genetics of the anatomy genome
// =================================================================================================

test('Anatomy genetics: Mendelian recombination, contract-conform mutation, bounds and unchanged parents', () => {
  const rng = new SeededRng('anat-unit');
  const mother = createFounderAnatomy(RAPTOR_SPECIES, 1, createIndividualGenome(SCHEMA, RAPTOR_SPECIES.traitBaselines, RAPTOR_SPECIES.traitRanges, 0.12, rng));
  const father = createFounderAnatomy(RAPTOR_SPECIES, 2, createIndividualGenome(SCHEMA, RAPTOR_SPECIES.traitBaselines, RAPTOR_SPECIES.traitRanges, 0.12, rng));
  const snapshot = (a: OrganismAnatomyState) => [Array.from(a.maternal), Array.from(a.paternal), Array.from(a.dominance), Array.from(a.expressed)];
  const motherBefore = snapshot(mother);
  const fatherBefore = snapshot(father);

  // (a) No mutation: every child allele is one of the parent's two copies, about half from each
  const noMut = { ...RAPTOR_SPECIES.mutation, baseRate: 0 };
  let fromMaternalCopy = 0;
  let total = 0;
  const childRng = new SeededRng('anat-children');
  for (let c = 0; c < 400; c++) {
    const { anatomy, anatomyMutations } = inheritOrganismAnatomy(mother, father, noMut, childRng);
    assert.equal(anatomyMutations, 0);
    for (let i = 0; i < ANATOMY_LOCUS_COUNT; i++) {
      assert.ok(anatomy.maternal[i] === mother.maternal[i] || anatomy.maternal[i] === mother.paternal[i], 'maternal copy from the mother');
      assert.ok(anatomy.paternal[i] === father.maternal[i] || anatomy.paternal[i] === father.paternal[i], 'paternal copy from the father');
      if (mother.maternal[i] !== mother.paternal[i]) {
        total++;
        if (anatomy.maternal[i] === mother.maternal[i]) fromMaternalCopy++;
      }
    }
  }
  const share = fromMaternalCopy / total;
  assert.ok(share > 0.45 && share < 0.55, `independent assortment ~50/50, got ${share.toFixed(3)}`);

  // (b) Mutation follows MutationConfig: baseRate per allele copy, symmetric normal steps of
  //     stepScale * range, capped per step, always inside the locus range
  const allMut = { ...RAPTOR_SPECIES.mutation, baseRate: 1, stepScale: 0.05, directionalBias: 0 };
  const deltas: number[] = [];
  const mutRng = new SeededRng('anat-mutation');
  const flat = anatomyOf(Array.from(getSpeciesBaselineAnatomy(RAPTOR_SPECIES).maternal));
  for (let c = 0; c < 300; c++) {
    const { anatomy, anatomyMutations } = inheritOrganismAnatomy(flat, flat, allMut, mutRng);
    assert.equal(anatomyMutations, 2 * ANATOMY_LOCUS_COUNT, 'rate 1 mutates every allele copy');
    for (let i = 0; i < ANATOMY_LOCUS_COUNT; i++) {
      const r = ANATOMY_RANGES[i];
      for (const v of [anatomy.maternal[i], anatomy.paternal[i]]) {
        assert.ok(v >= r.min && v <= r.max, 'mutated allele stays in range');
        const d = v - flat.maternal[i];
        assert.ok(Math.abs(d) <= 0.0651, `single mutation step is capped (|${d}|)`);
        if (i === ANATOMY_IDX.LIMB_LENGTH) deltas.push(d / (r.max - r.min));
      }
    }
  }
  const m = mean(deltas);
  const sd = Math.sqrt(mean(deltas.map((d) => (d - m) * (d - m))));
  assert.ok(Math.abs(m) < 0.006, `mutation has no direction (mean step ${m})`);
  assert.ok(sd > 0.035 && sd < 0.058, `step spread ~ stepScale (0.05) of the range, got ${sd.toFixed(4)}`);
  // Mutation count scales with the rate
  const halfRng = new SeededRng('anat-half');
  let muts = 0;
  for (let c = 0; c < 400; c++) muts += inheritOrganismAnatomy(flat, flat, { ...allMut, baseRate: 0.25 }, halfRng).anatomyMutations;
  close(muts / (400 * 2 * ANATOMY_LOCUS_COUNT), 0.25, 0.02, 'per-copy mutation probability');

  // (c) Determinism and untouched parents
  const r1 = inheritOrganismAnatomy(mother, father, RAPTOR_SPECIES.mutation, new SeededRng('same'));
  const r2 = inheritOrganismAnatomy(mother, father, RAPTOR_SPECIES.mutation, new SeededRng('same'));
  assert.deepEqual(snapshot(r1.anatomy), snapshot(r2.anatomy));
  assert.deepEqual(snapshot(mother), motherBefore, 'mother unchanged');
  assert.deepEqual(snapshot(father), fatherBefore, 'father unchanged');
});

function close(actual: number, expected: number, tol: number, label: string): void {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: expected ${expected}, got ${actual}`);
}

test('Anatomy genetics in the simulation: offspring inherit anatomy, it changes across generations, and queries change nothing', () => {
  const grid = flatGrid(20, 12, 'anat-sim');
  const noMutSpecies: SpeciesDefinition = { ...FAST, mutation: { ...FAST.mutation, baseRate: 0 } };
  const sim = new BiologySimulation({ grid, seed: 'anat-sim', speciesRegistry: registryOf(noMutSpecies), recordHistory: false, spatial: true });
  sim.spawnFounderPopulation('raptor', 60);
  const parentsSeen = new Map<number, OrganismAnatomyState>();
  for (const o of sim.getOrganisms('raptor')) parentsSeen.set(o.id, o.anatomy!);
  let checkedChildren = 0;
  for (let t = 0; t < 120; t++) {
    sim.step();
    for (const o of sim.getOrganisms('raptor')) {
      assert.ok(o.anatomy, `organism ${o.id} must carry an anatomy genome`);
      if (o.birthTick === sim.tick) {
        const mom = parentsSeen.get(o.parentAId!);
        const dad = parentsSeen.get(o.parentBId!);
        if (mom && dad) {
          for (let i = 0; i < ANATOMY_LOCUS_COUNT; i++) {
            assert.ok(o.anatomy.maternal[i] === mom.maternal[i] || o.anatomy.maternal[i] === mom.paternal[i]);
            assert.ok(o.anatomy.paternal[i] === dad.maternal[i] || o.anatomy.paternal[i] === dad.paternal[i]);
          }
          checkedChildren++;
        }
      }
      if (!parentsSeen.has(o.id)) parentsSeen.set(o.id, o.anatomy);
    }
  }
  assert.ok(checkedChildren > 100, `inheritance verified on ${checkedChildren} births`);
  assert.ok(sim.getStats('raptor').maxGeneration >= 4);
  const p = sim.getGeneticProfile('raptor');
  assert.equal(p.anatomyCarrierCount, p.count, 'anatomy statistics now cover every generation');

  // Multi-generation change: with mutation, an initially uniform gene pool accumulates variation
  const uniform: SpeciesDefinition = { ...FAST, initialGeneticSpread: 0 };
  const run = (species: SpeciesDefinition, seed: string) => {
    const s = new BiologySimulation({ grid: flatGrid(20, 12, 'anat-acc'), seed, speciesRegistry: registryOf(species), recordHistory: false, spatial: true });
    s.spawnFounderPopulation('raptor', 60);
    const start = s.getGeneticProfile('raptor');
    s.stepMany(600);
    return { start, end: s.getGeneticProfile('raptor'), gens: s.getStats('raptor').maxGeneration };
  };
  const mutating = run(uniform, 'anat-acc');
  const frozen = run({ ...uniform, mutation: { ...uniform.mutation, baseRate: 0 } }, 'anat-acc');
  const herb = ANATOMY_IDX.HERBIVORY_APPARATUS; // neutral for this carnivore
  assert.ok(mutating.gens >= 12, `many generations (${mutating.gens})`);
  assert.ok(
    mutating.end.anatomyLoci[herb].alleleVariance > 2 * mutating.start.anatomyLoci[herb].alleleVariance,
    'mutations accumulate heritable anatomical variation over generations'
  );
  assert.ok(
    mutating.end.anatomyDiversity!.meanNormalizedAlleleStdDev > frozen.end.anatomyDiversity!.meanNormalizedAlleleStdDev,
    'without mutation the anatomy gene pool can only lose variation'
  );
  assert.equal(mutating.end.coreLoci[0].alleleVariance > 0, true, 'core loci also gain variation by mutation');

  // Diagnostic queries never synthesize or alter anything
  const before = fingerprint(sim);
  const twin = new BiologySimulation({ grid: flatGrid(20, 12, 'anat-sim'), seed: 'anat-sim', speciesRegistry: registryOf(noMutSpecies), recordHistory: false, spatial: true });
  twin.spawnFounderPopulation('raptor', 60);
  twin.stepMany(120);
  assert.equal(fingerprint(twin), before);
  const orgs = sim.getOrganisms('raptor');
  for (let i = 0; i < 3; i++) {
    sim.getGeneticProfile('raptor');
    sim.analyzeSubpopulationGenetics('raptor', { minGroupSize: 2 });
    computePopulationGeneticSummary(orgs, noMutSpecies);
    measureReproductiveIsolation(orgs.slice(0, 30), noMutSpecies, orgs.slice(30), noMutSpecies);
    evaluateReproductiveCompatibility(orgs[0], noMutSpecies, orgs[1], noMutSpecies, true);
  }
  // An organism without an anatomy genome stays without one when summarized or compared
  const bare = { ...orgs[0], anatomy: undefined } as Organism;
  computePopulationGeneticSummary([bare], noMutSpecies);
  evaluateReproductiveCompatibility(bare, noMutSpecies, orgs[1], noMutSpecies, true);
  assert.equal(bare.anatomy, undefined, 'no anatomy is invented during diagnostics');
  assert.equal(fingerprint(sim), before, 'queries leave the world bit-identical');
  sim.stepMany(20);
  twin.stepMany(20);
  assert.equal(fingerprint(sim), fingerprint(twin), 'and its future unchanged');
});

// =================================================================================================
// PART II. Evolutionary mechanisms
// =================================================================================================

test('Evolution: genetic drift without selection is undirected and stronger in small populations', () => {
  // herbivoryApparatus of a carnivore has no phenotypic effect without evolution mode: neutral
  const locus = ANATOMY_IDX.HERBIVORY_APPARATUS;
  const run = (size: number, seed: string) => {
    const grid = flatGrid(size, size, `drift-${size}`);
    const sim = new BiologySimulation({ grid, seed, speciesRegistry: registryOf(FAST), recordHistory: false, statsInterval: 1e9, spatial: true });
    sim.spawnFounderPopulation('raptor', Math.round(size * size * 0.9));
    const start = sim.getGeneticProfile('raptor');
    let sizeSum = 0;
    for (let t = 0; t < 300; t++) {
      sim.step();
      sizeSum += sim.getOrganisms('raptor').length;
    }
    const end = sim.getGeneticProfile('raptor');
    return {
      delta: end.anatomyLoci[locus].alleleMean - start.anatomyLoci[locus].alleleMean,
      meanSize: sizeSum / 300,
    };
  };
  const small = [1, 2, 3, 4, 5].map((r) => run(6, `drift-small-${r}`));
  const large = [1, 2, 3, 4, 5].map((r) => run(18, `drift-large-${r}`));
  const meanAbs = (xs: { delta: number }[]) => mean(xs.map((x) => Math.abs(x.delta)));
  assert.ok(mean(small.map((s) => s.meanSize)) * 4 < mean(large.map((s) => s.meanSize)), 'the two settings differ in population size');
  assert.ok(
    meanAbs(small) > 1.5 * meanAbs(large),
    `drift must be stronger in small populations (|d| small ${meanAbs(small).toFixed(4)} vs large ${meanAbs(large).toFixed(4)})`
  );
  const signed = mean([...small, ...large].map((x) => x.delta));
  assert.ok(Math.abs(signed) < meanAbs(small), 'drift has no preferred direction');
});

test('Evolution: selection adapts isolated populations to their own climate, through survival and reproduction', () => {
  const { sim } = islandSim('adapt', 46, 3, true);
  const side = (west: boolean) => allOrganisms(sim).filter((o) => (west ? o.x < GAP_FROM : o.x > GAP_TO));
  const trait = (orgs: Organism[], id: string) => mean(orgs.map((o) => o.phenotype.geneticExpression[L(id)]));
  const hot0 = side(true);
  const cold0 = side(false);
  const start = { heatHot: trait(hot0, 'heatTolerance'), coldCold: trait(cold0, 'coldTolerance') };
  const isoStart = measureReproductiveIsolation(hot0, FAST, cold0, FAST).isolation;
  // With the evolutionary physiology model (Phase 2.3.3) divergence is slower than under the 2.3.2
  // rules (BMR no longer collapses, so the cold island needs less extra cold tolerance): 2500 ticks
  sim.stepMany(2500);
  const hot = side(true);
  const cold = side(false);
  assert.ok(hot.length > 50 && cold.length > 50, 'both populations persist');
  assert.ok(trait(hot, 'heatTolerance') > start.heatHot + 0.25, 'heat tolerance rises in the hot climate');
  assert.ok(trait(cold, 'coldTolerance') > start.coldCold + 0.25, 'cold tolerance rises in the cold climate');
  assert.ok(trait(hot, 'heatTolerance') > trait(cold, 'heatTolerance'));
  assert.ok(trait(cold, 'coldTolerance') > trait(hot, 'coldTolerance'));

  // Divergence is measured by the population-genetics layer...
  const analysis = sim.analyzeSubpopulationGenetics('raptor', { linkDistance: 4, minGroupSize: 10 });
  const pair = analysis.pairs.find((p) => (analysis.groups[p.groupA].centroidX < GAP_FROM) !== (analysis.groups[p.groupB].centroidX < GAP_FROM))!;
  assert.equal(pair.sameNavComponent, false, 'the strait is a real barrier');
  const diff = (id: string) => pair.comparison.coreLoci[L(id)].differentiation;
  const neutralDiff = pair.comparison.coreLoci.reduce((m, d) => Math.min(m, d.differentiation), 1);
  assert.ok(diff('heatTolerance') > 0.3, `heat tolerance is differentiated (${diff('heatTolerance').toFixed(3)})`);
  assert.ok(diff('coldTolerance') > 0.3, `cold tolerance is differentiated (${diff('coldTolerance').toFixed(3)})`);
  assert.ok(diff('heatTolerance') > 2 * neutralDiff && diff('coldTolerance') > 2 * neutralDiff, 'selected loci diverge more than the least diverged locus');
  assert.equal(pair.comparison.anatomyLoci.length, ANATOMY_LOCUS_COUNT, 'anatomy loci are part of the comparison');
  // ...and reproductive isolation develops from it (measured with the mating model)
  const isoEnd = measureReproductiveIsolation(hot, FAST, cold, FAST);
  assert.ok(isoStart < 0.05, `founders are fully compatible (isolation ${isoStart.toFixed(3)})`);
  assert.ok(isoEnd.isolation > 0.08 && isoEnd.isolation > isoStart + 0.05, `isolation develops (${isoEnd.isolation.toFixed(3)})`);
  assert.ok(isoEnd.prezygoticIsolation > 0 && isoEnd.postzygoticIsolation > 0, 'both mate recognition and zygote viability contribute');
  assert.equal(sim.speciesRegistry.list().length, 1, 'with default thresholds this is not yet a new species');
  assertExact(sim, 'adaptation');
});

test('Evolution: contact restores gene flow between diverged groups of one species', () => {
  const { sim, grid } = islandSim('flow', 44, 4, true);
  sim.stepMany(600);
  assert.equal(sim.analyzeSubpopulationGenetics('raptor', { linkDistance: 4 }).pairs.every((p) => p.sameNavComponent === false), true);

  // Island of origin, inherited along the maternal line ('X' = offspring of parents from both islands)
  const origin = new Map<number, 'W' | 'E' | 'X'>();
  for (const o of allOrganisms(sim)) origin.set(o.id, o.x < GAP_FROM ? 'W' : 'E');
  let crossBirths = 0;
  let sameBirths = 0;
  let crossed = false;
  const track = () => {
    for (const o of allOrganisms(sim)) {
      if (origin.has(o.id)) continue;
      const a = o.parentAId !== null ? origin.get(o.parentAId) : undefined;
      const b = o.parentBId !== null ? origin.get(o.parentBId) : undefined;
      if (a === undefined || b === undefined) continue;
      if (a !== 'X' && b !== 'X' && a !== b) {
        crossBirths++;
        origin.set(o.id, 'X');
      } else {
        if (a === b) sameBirths++;
        origin.set(o.id, a === 'X' || b === 'X' ? 'X' : a);
      }
    }
    for (const o of allOrganisms(sim)) {
      const g = origin.get(o.id);
      if ((g === 'W' && o.x > GAP_TO) || (g === 'E' && o.x < GAP_FROM)) crossed = true;
    }
  };
  for (let t = 0; t < 150; t++) {
    sim.step();
    track();
  }
  assert.equal(crossBirths, 0, 'no gene flow across the strait');
  assert.equal(crossed, false);
  assert.ok(sameBirths > 0);

  openBridge(grid, 3, 6);
  for (let t = 0; t < 400; t++) {
    sim.step();
    track();
  }
  assert.ok(crossed, 'migrants cross the new land bridge');
  assert.ok(crossBirths > 0, `gene flow resumes: ${crossBirths} offspring of parents from both islands`);
  assert.equal(sim.speciesRegistry.list().length, 1, 'contact without isolation never founds a species');
  const groups = sim.analyzeSubpopulationGenetics('raptor', { linkDistance: 4, minGroupSize: 10 });
  assert.ok(groups.groups.some((g) => g.profile.count > 0 && g.navComponent === groups.groups[0].navComponent));
  assertExact(sim, 'gene flow');
});

// =================================================================================================
// PART III. Speciation, phylogeny, hybridization, extinction, atomicity
// =================================================================================================

/** Species criterion used by the speciation scenarios: 15% measured loss of fertile offspring. */
const SPECIATION_CFG = { minReproductiveIsolation: 0.15 };

test('Speciation: no species arises from spatial separation, time or mutations alone', () => {
  // Same climate on both islands: isolated for as long as the diverging scenario below, with the
  // same species criterion, many mutations, but nothing that makes the groups incompatible
  const { sim: same } = islandSim('nospec-same', 30, 30, SPECIATION_CFG);
  // One continuous island across a climate gradient: divergent selection but free gene flow
  const grid = flatGrid(28, 10, 'nospec-cline-grid');
  for (let y = 0; y < 10; y++) for (let x = 0; x < 28; x++) {
    const t = 46 - (45 * x) / 27;
    grid.setCell(x, y, t < 7 ? { temperature: t, moisture: 0.64 } : { temperature: t });
  }
  const cline = new BiologySimulation({ grid, seed: 'nospec-cline', speciesRegistry: registryOf(FAST), recordHistory: false, statsInterval: 1e9, spatial: true, evolution: SPECIATION_CFG });
  cline.spawnFounderPopulation('raptor', 160);

  same.stepMany(2400);
  cline.stepMany(2400);
  for (const [label, sim] of [['same climate', same], ['cline', cline]] as const) {
    assert.equal(sim.speciesRegistry.list().length, 1, `${label}: no new species`);
    assert.equal(sim.evolutionStats.speciations, 0);
    assert.equal(sim.phylogeny!.getSpeciationEvents().length, 0, `${label}: no phylogeny event`);
    assert.ok(sim.evolutionStats.speciationChecks >= 90, `${label}: the engine kept checking`);
    const stats = sim.getStats('raptor');
    assert.ok(stats.birthsTotal > 2000, `${label}: many generations of births`);
    for (const t of sim.getSpeciationTrackers()) {
      assert.ok(t.reproductiveIsolation < SPECIATION_CFG.minReproductiveIsolation, `${label}: ${t.key} isolation ${t.reproductiveIsolation}`);
    }
    assertExact(sim, label);
  }
  // Separation in the same climate: groups drift apart a little, but stay fully compatible
  const W = allOrganisms(same).filter((o) => o.x < GAP_FROM);
  const E = allOrganisms(same).filter((o) => o.x > GAP_TO);
  assert.ok(measureReproductiveIsolation(W, FAST, E, FAST).isolation < 0.08);
});

interface SpeciationRun {
  sim: BiologySimulation;
  grid: WorldGrid;
  tick: number;
  eastIdsBefore: Set<number>;
  aliveBefore: number;
  fingerprintAfter: string;
}

function runToSpeciation(onPhase?: (ctx: { tick: number; phase: BiologyStepPhase }) => void, stopAtTick?: number): SpeciationRun {
  const { sim, grid } = islandSim('speciate', 46, 3, SPECIATION_CFG, onPhase);
  let eastIdsBefore = new Set<number>();
  let aliveBefore = 0;
  while (sim.evolutionStats.speciations === 0 && sim.tick < 4000 && (stopAtTick === undefined || sim.tick < stopAtTick)) {
    eastIdsBefore = new Set(allOrganisms(sim).filter((o) => o.x > GAP_TO).map((o) => o.id));
    aliveBefore = allOrganisms(sim).length;
    sim.step();
  }
  return { sim, grid, tick: sim.tick, eastIdsBefore, aliveBefore, fingerprintAfter: fingerprint(sim) };
}

let reference: SpeciationRun | null = null;

test('Speciation: diverged, reproductively isolated populations found a new species through the real cycle', () => {
  const massStart = islandSim('speciate', 46, 3, SPECIATION_CFG).sim.getEnergyAudit().actualMassQ;
  reference = runToSpeciation();
  const { sim, tick, eastIdsBefore } = reference;
  assert.equal(sim.evolutionStats.speciations, 1, 'a speciation happened');
  assert.ok(tick > 500, 'only after a long period of independent evolution');
  const ids = sim.speciesRegistry.list().map((s) => s.id);
  assert.equal(ids.length, 2);
  const daughterId = ids[1];
  assert.equal(daughterId, 'raptor_d2');
  const daughterSpecies = sim.speciesRegistry.get(daughterId);

  // The event is grounded in measured divergence and persistent reproductive isolation
  const [event] = sim.phylogeny!.getSpeciationEvents();
  assert.equal(event.tick, tick);
  assert.equal(event.parentSpeciesId, 'raptor');
  assert.equal(event.daughterSpeciesId, daughterId);
  assert.equal(event.cause, 'allopatric');
  assert.ok(event.reproductiveIsolation >= SPECIATION_CFG.minReproductiveIsolation);
  assert.ok(event.geneticDistance >= resolveEvolutionConfig().minGeneticDivergence);
  const node = sim.phylogeny!.getNode(daughterId)!;
  assert.ok(node.divergenceMetrics!.persistenceTicks >= 3 * resolveEvolutionConfig().evolutionCheckInterval, 'isolation persisted over consecutive checks');

  // Founders are the existing eastern organisms, unchanged; nothing was created or destroyed
  const daughters = sim.getOrganisms(daughterId);
  assert.ok(daughters.length >= 20);
  for (const o of daughters) {
    assert.equal(o.speciesId, daughterId);
    assert.ok(o.x > GAP_TO, 'founders come from the isolated eastern population');
    assert.ok(eastIdsBefore.has(o.id) || o.birthTick === tick, `founder ${o.id} existed before (or was laid this tick by a founder)`);
  }
  assert.ok(sim.getOrganisms('raptor').every((o) => o.x < GAP_FROM), 'the parent species keeps the western population');
  const stats = [sim.getStats('raptor'), sim.getStats(daughterId)];
  const births = stats.reduce((s, st) => s + st.birthsThisTick, 0);
  const deaths = stats.reduce((s, st) => s + st.deathsThisTick, 0);
  assert.equal(allOrganisms(sim).length, reference.aliveBefore + births - deaths, 'speciation itself creates or removes no organism');
  assert.equal(stats[0].speciationTransfersOut, stats[1].speciationTransfersIn);
  assert.equal(stats[1].introducedTotal, 0);
  assert.equal(sim.getEnergyAudit().actualMassQ, massStart, 'no matter appears');
  assertExact(sim, 'speciation tick');
  // Lineage parameters are inherited unchanged (no instantaneous transformation)
  const parentSpecies = sim.speciesRegistry.get('raptor');
  assert.deepEqual(daughterSpecies.physiology, parentSpecies.physiology);
  assert.equal(daughterSpecies.diet, parentSpecies.diet);
  assert.equal(daughterSpecies.genomeSchema, parentSpecies.genomeSchema);

  // The new species reproduces on its own; offspring belong to it
  sim.stepMany(150);
  const born = sim.getOrganisms(daughterId).filter((o) => o.birthTick > tick);
  assert.ok(born.length > 20, 'the daughter species breeds');
  for (const o of born) {
    assert.equal(o.speciesId, daughterId);
    const mother: Organism | undefined = o.parentAId !== null ? sim.getOrganismById(daughterId, o.parentAId) : undefined;
    if (mother) assert.equal(mother.speciesId, daughterId);
  }
  assert.ok(sim.getStats(daughterId).birthsTotal > 0);
  assert.equal(sim.evolutionStats.speciations, 1, 'the same event is never committed twice');
  assertExact(sim, 'after speciation');

  // Phylogeny records the history
  const parentNode = sim.phylogeny!.getNode('raptor')!;
  assert.deepEqual(parentNode.childIds, [daughterId]);
  assert.deepEqual(node.parentIds, ['raptor']);
  assert.equal(node.rootSpeciesId, 'raptor');
  assert.equal(node.divergenceTick, tick);
  assert.equal(node.status, 'active');
  assert.equal(node.geneticSignature.length, SCHEMA.locusCount);
  assert.equal(node.anatomySignature.length, ANATOMY_LOCUS_COUNT);
  assert.ok(node.geneticSignature[L('coldTolerance')] > parentNode.geneticSignature[L('coldTolerance')], 'the cold lineage signature records its adaptation');
  assert.deepEqual(sim.phylogeny!.getAncestors(daughterId).map((n) => n.speciesId), ['raptor']);
  assert.deepEqual(sim.phylogeny!.getDescendants('raptor').map((n) => n.speciesId), [daughterId]);
  assert.equal(sim.phylogeny!.getCladeHopDistance('raptor', daughterId), 1);
});

test('Speciation: sister species that meet hybridize under the compatibility model; an extinct lineage stays in history', () => {
  assert.ok(reference, 'requires the speciation scenario');
  const { sim, grid } = reference;
  const daughterId = 'raptor_d2';
  openBridge(grid, 2, 7);
  const before = { hybrids: sim.evolutionStats.hybridOffspring, rejections: sim.evolutionStats.mateRejections };
  sim.stepMany(400);
  const hybrids = sim.evolutionStats.hybridOffspring - before.hybrids;
  assert.ok(hybrids > 0, 'contact produces hybrid offspring');
  assert.ok(sim.evolutionStats.mateRejections > before.rejections, 'mate recognition refuses some partners');
  const events = sim.phylogeny!.getHybridizationEvents();
  assert.ok(events.length > 0);
  for (const e of events) {
    assert.notEqual(e.motherSpeciesId, e.fatherSpeciesId);
    assert.equal(e.offspringSpeciesId, e.motherSpeciesId, 'hybrids are raised in the maternal species');
    assert.ok(e.viability <= 0.88 && e.fertility < 1, `hybrids carry a fitness cost (v ${e.viability}, f ${e.fertility})`);
  }
  const hybridOrgs = allOrganisms(sim).filter((o) => o.ancestry && o.ancestry.admixtureRatio > 0);
  assert.ok(hybridOrgs.length > 0, 'admixed individuals live in the contact zone');
  for (const o of hybridOrgs) assert.equal(o.ancestry!.primarySpeciesId, o.speciesId, 'ancestry names the species that raised it');
  assert.ok(sim.phylogeny!.getNode('raptor')!.hybridLinks.some((l) => l.otherSpeciesId === daughterId));
  assertExact(sim, 'hybrid zone');

  // Extinction: the daughter lineage dies out (real death path), its history is kept
  for (const o of [...sim.getOrganisms(daughterId)]) sim.killOrganism(daughterId, o.id, 'injury');
  sim.step();
  const node = sim.phylogeny!.getNode(daughterId)!;
  assert.equal(node.status, 'extinct');
  assert.equal(node.extinctTick, sim.tick);
  assert.ok(node.peakPopulation > 20);
  assert.equal(sim.phylogeny!.getSpeciationEvents().length, 1, 'history of the extinct lineage is retained');
  assert.deepEqual(sim.phylogeny!.getExtinctLineages().map((n) => n.speciesId), [daughterId]);
  assert.deepEqual(sim.phylogeny!.getNode('raptor')!.childIds, [daughterId]);
  sim.stepMany(5);
  assert.equal(sim.phylogeny!.getNode(daughterId)!.status, 'extinct');
  assertExact(sim, 'after extinction');
});

test('Speciation: an error before the final COMMIT leaves no species, organisms or phylogeny events; the retry commits once', () => {
  assert.ok(reference, 'requires the speciation scenario');
  const T = reference.tick;
  let faultPhase: BiologyStepPhase | null = null;
  const run = runToSpeciation(({ tick, phase }) => {
    if (faultPhase !== null && tick === T && phase === faultPhase) throw new Error(`fault at ${phase}`);
  }, T - 1);
  const { sim } = run;
  assert.equal(sim.tick, T - 1);
  const before = fingerprint(sim);
  for (const phase of ['RESOLVE', 'PRE_ALLOCATE', 'PREPARE', 'COMMIT'] as BiologyStepPhase[]) {
    faultPhase = phase;
    assert.throws(() => sim.step(), new RegExp(`fault at ${phase}`));
    assert.equal(sim.tick, T - 1);
    assert.equal(sim.speciesRegistry.list().length, 1, `${phase}: no species registered`);
    assert.equal(sim.phylogeny!.getSpeciationEvents().length, 0, `${phase}: no phylogeny event`);
    assert.equal(sim.evolutionStats.speciations, 0);
    assert.equal(fingerprint(sim), before, `${phase}: world bit-identical after ABORT`);
    assert.equal(sim.ledger.activeTransaction, null);
    assertExact(sim, `${phase} abort`);
  }
  faultPhase = null;
  sim.step();
  assert.equal(sim.tick, T);
  assert.equal(sim.evolutionStats.speciations, 1, 'retry commits the speciation exactly once');
  assert.equal(sim.phylogeny!.getSpeciationEvents().length, 1);
  assert.equal(fingerprint(sim), reference.fingerprintAfter, 'the retried tick equals the undisturbed run');
});

test('Speciation engine: requires persistent measured isolation, a sister group and real divergence (controlled inputs)', () => {
  const grid = flatGrid(30, 6, 'engine-unit');
  const rng = new SeededRng('engine-unit');
  const make = (id: number, x: number, shift: number, sex: 'female' | 'male'): Organism => {
    const base: Record<string, number> = {};
    for (const d of SCHEMA.loci) {
      const r = RAPTOR_SPECIES.traitRanges[d.id];
      base[d.id] = Math.min(r.max, Math.max(r.min, RAPTOR_SPECIES.traitBaselines[d.id] + shift * (r.max - r.min)));
    }
    const genome = createIndividualGenome(SCHEMA, base, RAPTOR_SPECIES.traitRanges, 0.01, rng);
    return createOrganism({ id, species: RAPTOR_SPECIES, sex, x, y: 2, cellIndex: 2 * 30 + x, birthTick: 0, generation: 0, parentAId: null, parentBId: null, genome, stage: 'adult' });
  };
  const buildDrafts = (shiftEast: number, eastX = 24) => {
    const orgs: Organism[] = [];
    for (let i = 0; i < 12; i++) orgs.push(make(orgs.length + 1, 2 + (i % 4), 0, i % 2 ? 'male' : 'female'));
    for (let i = 0; i < 12; i++) orgs.push(make(orgs.length + 1, eastX + (i % 4), shiftEast, i % 2 ? 'male' : 'female'));
    return {
      draftOrg: orgs,
      draftCellIndex: Uint32Array.from(orgs.map((o) => o.cellIndex)),
      draftFlags: new Uint8Array(orgs.length),
    };
  };
  const evaluate = (engine: SpeciationEngine, tick: number, drafts: ReturnType<typeof buildDrafts>) => {
    const outProposals: never[] = [];
    const outTrackerUpdates: never[] = [];
    engine.evaluateTick({
      targetTick: tick,
      grid,
      speciesCount: 1,
      speciesList: [RAPTOR_SPECIES],
      existingSpeciesIds: new Set(['raptor']),
      speciesDraftStart: Int32Array.from([0]),
      speciesDraftEnd: Int32Array.from([drafts.draftOrg.length]),
      ...drafts,
      navComponents: null,
      speciesNavClass: null,
      outProposals,
      outTrackerUpdates,
      rootSpeciesResolver: (id) => id,
    });
    engine.commitTrackerUpdates(outTrackerUpdates, [], tick);
    return { proposals: outProposals as { daughterSpecies: SpeciesDefinition; reproductiveIsolation: number }[], updates: outTrackerUpdates as { reproductiveIsolation: number }[] };
  };
  const cfg = resolveEvolutionConfig({ evolutionCheckInterval: 1, minClusterSize: 4, minParentRemainSize: 4, requiredPersistenceChecks: 3, minReproductiveIsolation: 0.2 });

  // Separated but identical groups: isolation 0, never a species
  const sameEngine = new SpeciationEngine(grid, cfg);
  for (let t = 1; t <= 6; t++) {
    const r = evaluate(sameEngine, t, buildDrafts(0));
    assert.equal(r.proposals.length, 0);
    assert.ok(r.updates.every((u) => u.reproductiveIsolation < 0.05));
  }

  // Strongly diverged (incompatible) groups: a proposal only on the 3rd consecutive check
  const engine = new SpeciationEngine(grid, cfg);
  const diverged = buildDrafts(0.3);
  assert.equal(evaluate(engine, 1, diverged).proposals.length, 0);
  assert.equal(evaluate(engine, 2, diverged).proposals.length, 0);
  const third = evaluate(engine, 3, diverged);
  assert.equal(third.proposals.length, 1);
  assert.ok(third.proposals[0].reproductiveIsolation >= cfg.minReproductiveIsolation);
  assert.equal(third.proposals[0].daughterSpecies.diet, RAPTOR_SPECIES.diet);

  // A lapse restarts persistence: diverged, then compatible once, then diverged again
  const lapsing = new SpeciationEngine(grid, cfg);
  evaluate(lapsing, 1, diverged);
  evaluate(lapsing, 2, diverged);
  evaluate(lapsing, 3, buildDrafts(0));
  assert.equal(evaluate(lapsing, 4, diverged).proposals.length, 0);
  assert.equal(evaluate(lapsing, 5, diverged).proposals.length, 0);
  assert.equal(evaluate(lapsing, 6, diverged).proposals.length, 1);

  // No sister group (everyone diverged in one place): no anagenetic "speciation" from a baseline
  const lone = new SpeciationEngine(grid, cfg);
  const single = buildDrafts(0.3);
  for (const o of single.draftOrg.slice(0, 12)) o.alive = false;
  single.draftFlags.fill(1 << 2, 0, 12);
  for (let t = 1; t <= 5; t++) assert.equal(evaluate(lone, t, single).proposals.length, 0);

  // The isolation measure is independent of where organisms live
  const near = buildDrafts(0.3, 8);
  const far = buildDrafts(0.3, 24);
  const isoNear = measureReproductiveIsolation(near.draftOrg.slice(0, 12), RAPTOR_SPECIES, near.draftOrg.slice(12), RAPTOR_SPECIES);
  const isoFar = measureReproductiveIsolation(far.draftOrg.slice(0, 12), RAPTOR_SPECIES, far.draftOrg.slice(12), RAPTOR_SPECIES);
  assert.ok(isoNear.isolation > 0.2, `diverged groups are partly isolated (${isoNear.isolation})`);
  close(isoNear.isolation, isoFar.isolation, 0.1, 'position does not matter');
});
