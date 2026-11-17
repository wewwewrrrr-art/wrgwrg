import assert from 'node:assert/strict';
import test from 'node:test';
import { WorldGrid } from '../worldGrid';
import { EnergyPool } from '../worldEnergyGrid';
import { BiologySimulation, BiologyStepPhase } from './biologySimulation';
import { RAPTOR_SPECIES, SpeciesDefinition, SpeciesRegistry } from './species';
import { VegetationConfig } from './vegetation';

// =================================================================================================
// Helpers
// =================================================================================================

const GRAZER: SpeciesDefinition = {
  ...RAPTOR_SPECIES,
  id: 'grazer',
  name: 'grazer',
  diet: 'herbivore',
  traitBaselines: { ...RAPTOR_SPECIES.traitBaselines, bodySize: 0.6, speed: 1.0 },
};

function registry(...species: SpeciesDefinition[]): SpeciesRegistry {
  const reg = new SpeciesRegistry();
  for (const sp of species.length ? species : [GRAZER]) reg.register(sp);
  return reg;
}

function flatGrid(width: number, height: number, seed: string, temperature = 18, moisture = 0.62): WorldGrid {
  const grid = WorldGrid.generate({ width, height, seed });
  for (let i = 0; i < grid.cellCount; i++) grid.setCellByIndex(i, { elevation: 0.5, temperature, moisture });
  return grid;
}

function vegSim(
  grid: WorldGrid,
  seed: string,
  vegetation: VegetationConfig | boolean = true,
  extra: Partial<ConstructorParameters<typeof BiologySimulation>[0]> = {}
): BiologySimulation {
  return new BiologySimulation({
    grid,
    seed,
    speciesRegistry: registry(GRAZER),
    recordHistory: false,
    statsInterval: 1e9,
    spatial: true,
    backgroundPreyCapacityScale: 0,
    vegetation,
    ...extra,
  });
}

/** Exact checks: plant partition == ledger CELL_PLANT pools, and the global energy/mass balance. */
function assertConserved(sim: BiologySimulation, label: string): void {
  const bad = sim.vegetation!.audit((c) => sim.energyGrid.getMassQ(EnergyPool.PLANT, c));
  assert.equal(bad, -1, `${label}: plant partition differs from the ledger in cell ${bad}`);
  for (let c = 0; c < sim.grid.cellCount; c++) {
    assert.equal(sim.energyGrid.getEnergyQ(EnergyPool.PLANT, c), 3 * sim.energyGrid.getMassQ(EnergyPool.PLANT, c), `${label}: plant stoichiometry`);
  }
  const audit = sim.assertEnergyAudit();
  assert.equal(audit.massResidualQ, 0n, `${label}: mass residual`);
  assert.equal(audit.energyResidualQ, 0n, `${label}: energy residual`);
}

function herbMass(sim: BiologySimulation, speciesId = 'meadow-grass'): number {
  return sim.vegetation!.speciesTotals()[speciesId].herbMassMU;
}

function sumPool(sim: BiologySimulation, pool: number): number {
  let m = 0;
  for (let c = 0; c < sim.grid.cellCount; c++) m += sim.energyGrid.getMassQ(pool as never, c);
  return m;
}

// =================================================================================================
// Life cycle: seed -> germination -> growth -> maturity -> reproduction -> dispersal
// =================================================================================================

test('Vegetation life cycle: germination on suitable ground, growth, maturity, seed production and dispersal', () => {
  const grid = flatGrid(24, 8, 'veg-life');
  for (let y = 0; y < 8; y++) for (let x = 18; x < 24; x++) grid.setCell(x, y, { temperature: -35 }); // frozen strip
  const sim = vegSim(grid, 'veg-life', { initialHerbCover: 0, initialSeedDensity: 0 });
  sim.seedPlants('pioneer-tree', 3, 4, 0, 30);
  sim.seedPlants('pioneer-tree', 21, 4, 0, 30);
  sim.seedPlants('meadow-grass', 3, 4, 0, 30);
  const veg = sim.vegetation!;
  assert.equal(veg.livingWoodyCount, 0, 'bare land at the start');

  let first: number | undefined;
  for (let t = 0; t < 150 && first === undefined; t++) {
    sim.step();
    first = veg.livingPlantIds()[0];
  }
  assert.ok(first !== undefined, 'seeds germinate');
  const p0 = veg.getPlant(first!)!;
  assert.equal(p0.speciesId, 'pioneer-tree');
  assert.equal(p0.cellIndex, 4 * 24 + 3, 'it germinated where its seeds were');
  assert.equal(p0.motherId, null, 'seed-bank founders have no known parent');
  assert.ok(herbMass(sim) > 0, 'herb seeds establish a stand');

  sim.stepMany(120);
  const p1 = veg.getPlant(first!);
  if (p1) {
    assert.ok(p1.biomassMU > p0.biomassMU * 10, `growth ${p0.biomassMU} -> ${p1.biomassMU}`);
    assert.ok(p1.heightM > p0.heightM);
  }
  // frozen ground: no plant ever establishes there
  const frozen = (id: number) => (veg.getPlant(id)!.x >= 18);
  assert.equal(veg.livingPlantIds().filter(frozen).length, 0, 'no establishment in a lethal climate');

  // Maturity, seeds and offspring away from the source
  let offspring = 0;
  let farthest = 0;
  for (let t = 0; t < 500 && (offspring === 0 || farthest < 2); t++) {
    offspring = 0;
    sim.step();
    for (const p of veg.getPlants('pioneer-tree', sim.tick)) {
      if (p.motherId !== null) offspring++;
      farthest = Math.max(farthest, Math.abs(p.x - 3));
    }
  }
  assert.ok(veg.getPlants(undefined, sim.tick).some((p) => p.stage === 'mature') || offspring > 0, 'plants reach reproductive maturity');
  assert.ok(offspring > 0, 'mature plants produce offspring with a known mother');
  assert.ok(farthest >= 2, `seeds disperse away from the parent (${farthest} cells)`);
  const seedsAway = veg.getCell(4 * 24 + 8).seedBank['pioneer-tree'];
  assert.ok(seedsAway >= 0);
  assert.equal(veg.livingPlantIds().filter(frozen).length, 0);
  assertConserved(sim, 'life cycle');
});

test('Vegetation dispersal: seeds spread with distance, never onto unsuitable surface; empty land is colonised gradually', () => {
  const grid = flatGrid(30, 6, 'veg-front');
  for (let y = 0; y < 6; y++) grid.setCell(15, y, { terrain: 'deep-water' }); // a water channel
  const sim = vegSim(grid, 'veg-front', { initialHerbCover: 0, initialSeedDensity: 0 });
  sim.seedPlants('meadow-grass', 1, 3, 1, 40);
  const veg = sim.vegetation!;
  const occupiedUpTo = () => {
    let mx = -1;
    for (let c = 0; c < grid.cellCount; c++) if (veg.getCell(c).herbMassMU['meadow-grass'] > 0.05) mx = Math.max(mx, c % 30);
    return mx;
  };
  const fronts: number[] = [];
  for (let k = 0; k < 8; k++) {
    sim.stepMany(20);
    fronts.push(occupiedUpTo());
  }
  for (let k = 1; k < fronts.length; k++) {
    assert.ok(fronts[k] >= fronts[k - 1], 'the front never jumps back');
    assert.ok(fronts[k] - fronts[k - 1] <= 6, `colonisation is gradual (${fronts.join(',')})`);
  }
  assert.ok(fronts[0] < 8, `no instant meadow (front ${fronts[0]} after 20 ticks)`);
  assert.ok(fronts[fronts.length - 1] > fronts[0] + 4, `the front advances (${fronts.join(',')})`);
  for (let y = 0; y < 6; y++) {
    const c = y * 30 + 15;
    assert.equal(veg.getCell(c).herbMassMU['meadow-grass'], 0, 'no grass in water');
    assert.equal(veg.getCell(c).seedBank['meadow-grass'], 0, 'seeds falling into water are lost');
  }
  assertConserved(sim, 'dispersal');
});

// =================================================================================================
// Competition
// =================================================================================================

test('Vegetation competition: tall plants shade small ones and grass, closed stands block establishment', () => {
  const grid = flatGrid(8, 2, 'veg-light');
  const sim = vegSim(grid, 'veg-light', { initialHerbCover: 0.7, initialSeedDensity: 0 });
  const veg = sim.vegetation!;
  // cell (1,0): a closed canopy of large broadleaf trees; cell (5,0): open ground
  sim.spawnPlantPopulation('broadleaf-tree', 3, { center: { x: 1, y: 0, radius: 0 }, sizeFraction: 1, ageTicks: 300 });
  const [shaded] = sim.spawnPlantPopulation('pioneer-tree', 1, { center: { x: 1, y: 0, radius: 0 }, sizeFraction: 0.002 });
  const [open] = sim.spawnPlantPopulation('pioneer-tree', 1, { center: { x: 5, y: 0, radius: 0 }, sizeFraction: 0.002 });
  const m0 = { shaded: veg.getPlant(shaded)!.biomassMU, open: veg.getPlant(open)!.biomassMU };
  const canopyCell = veg.getCell(1);
  assert.ok(canopyCell.groundLight < 0.35, `closed canopy (ground light ${canopyCell.groundLight.toFixed(2)})`);
  sim.stepMany(80);
  const growth = (id: number, m: number) => (veg.getPlant(id)?.biomassMU ?? 0) / m;
  assert.ok(growth(open, m0.open) > 2 * growth(shaded, m0.shaded), 'a sun plant grows far better in the open than under a canopy');
  const herbsShaded = veg.getCell(1).herbMassMU['meadow-grass'];
  const herbsOpen = veg.getCell(5).herbMassMU['meadow-grass'];
  assert.ok(herbsOpen > 2 * herbsShaded, `grass is suppressed under trees (${herbsShaded.toFixed(1)} vs ${herbsOpen.toFixed(1)} MU)`);

  // Establishment: identical seed rain into the closed stand and a cell without any tree
  assert.equal(veg.getCell(7).woodyIds.length, 0);
  sim.seedPlants('pioneer-tree', 1, 0, 0, 50);
  sim.seedPlants('pioneer-tree', 7, 0, 0, 50);
  const before = new Set(veg.livingPlantIds());
  sim.stepMany(60);
  const recruits = veg.getPlants('pioneer-tree', sim.tick).filter((p) => !before.has(p.id));
  const inShade = recruits.filter((p) => p.cellIndex === 1).length;
  const inOpen = recruits.filter((p) => p.cellIndex === 7).length;
  assert.equal(inShade, 0, 'sun plants cannot establish under a closed canopy');
  assert.ok(inOpen > 0, 'they do in the open');
  // and a cell never holds more individuals than its ground space allows
  for (let c = 0; c < grid.cellCount; c++) assert.ok(veg.getCell(c).woodyIds.length <= 20);
  assertConserved(sim, 'competition');
});

test('Vegetation climate: temperature and moisture favour different strategies', () => {
  const run = (label: string, temperature: number, moisture: number) => {
    const sim = vegSim(flatGrid(10, 6, `veg-clim-${label}`, temperature, moisture), `veg-clim-${label}`, { initialSeedDensity: 0 });
    for (const sp of ['broadleaf-tree', 'desert-shrub', 'boreal-conifer']) sim.spawnPlantPopulation(sp, 25, { sizeFraction: 0.15, ageTicks: 30 });
    const veg = sim.vegetation!;
    const m0 = veg.speciesTotals();
    const h0 = { grass: herbMass(sim), sedge: herbMass(sim, 'tundra-sedge') };
    sim.stepMany(300);
    assertConserved(sim, label);
    const m1 = veg.speciesTotals();
    const ratio = (sp: string) => m1[sp].woodyMassMU / Math.max(1e-9, m0[sp].woodyMassMU);
    return { tree: ratio('broadleaf-tree'), shrub: ratio('desert-shrub'), conifer: ratio('boreal-conifer'), grass: herbMass(sim), sedge: herbMass(sim, 'tundra-sedge'), h0 };
  };
  const temperate = run('temperate', 18, 0.68);
  const dry = run('dry', 30, 0.1);
  const cold = run('cold', 0, 0.55);
  // each strategy does best where its biology fits; growth is compared between climates for one
  // species and between species within one climate where they start from comparable sizes
  assert.ok(temperate.tree > 1.5 && temperate.tree > dry.tree && temperate.tree > cold.tree, `the broadleaf tree thrives in the temperate moist climate (${temperate.tree.toFixed(2)})`);
  assert.ok(dry.shrub > dry.tree && dry.shrub > 1, `dry: the drought-tolerant shrub grows, the tree does not (${dry.shrub.toFixed(2)} vs ${dry.tree.toFixed(2)})`);
  assert.ok(dry.tree < 1, 'the moist-site tree declines in drought');
  assert.ok(dry.shrub / temperate.shrub > dry.tree / temperate.tree, 'drought costs the shrub less than the tree');
  assert.ok(cold.conifer > cold.tree && cold.conifer > 1, `cold: the conifer wins (${cold.conifer.toFixed(2)} vs ${cold.tree.toFixed(2)})`);
  assert.ok(dry.grass < 0.3 * temperate.grass, 'drought shrinks the grass');
  assert.ok(cold.sedge > cold.grass, 'the cold-climate sedge dominates the cold herb layer');
});

// =================================================================================================
// Ageing, death, decomposition; identity
// =================================================================================================

test('Vegetation ageing: old trees die of senescence, their matter returns to the soil, history is kept', () => {
  const sim = vegSim(flatGrid(10, 4, 'veg-age'), 'veg-age', { initialSeedDensity: 0, initialHerbCover: 0 });
  const veg = sim.vegetation!;
  const ids = sim.spawnPlantPopulation('pioneer-tree', 30, { sizeFraction: 0.9, ageTicks: 480 });
  const detritus0 = sumPool(sim, EnergyPool.DETRITUS);
  const plant0 = sumPool(sim, EnergyPool.PLANT);
  for (let t = 0; t < 400 && ids.some((id) => veg.getPlant(id)); t++) sim.step();
  const dead = veg.getDeathRecords().filter((d) => ids.includes(d.id));
  assert.ok(dead.length >= 25, `${dead.length} of 30 old trees died`);
  assert.ok(dead.filter((d) => d.cause === 'senescence').length >= dead.length * 0.6, 'mostly of old age');
  for (const d of dead) {
    assert.equal(veg.getPlant(d.id), undefined, 'a dead plant leaves the living set');
    assert.ok(d.peakBiomassMU > 0 && d.deathTick > d.birthTick);
  }
  assert.ok(sumPool(sim, EnergyPool.DETRITUS) > detritus0, 'dead wood became detritus');
  // generation turnover: the old trees left offspring that replace them
  const young = veg.getPlants('pioneer-tree', sim.tick).filter((p) => p.motherId !== null && ids.includes(p.motherId));
  assert.ok(young.length > 0, 'a new generation grows from the seeds of the old trees');
  assert.ok(plant0 > 0);
  // detritus then decomposes back into abiotic matter (existing decomposition)
  const det = sumPool(sim, EnergyPool.DETRITUS);
  sim.stepMany(80);
  assert.ok(sumPool(sim, EnergyPool.DETRITUS) < det, 'litter decomposes');
  assertConserved(sim, 'ageing');
});

test('Vegetation identity: individual plants keep their id, species, place and history; ids are never reused', () => {
  const sim = vegSim(flatGrid(12, 8, 'veg-id'), 'veg-id');
  const veg = sim.vegetation!;
  sim.spawnPlantPopulation('broadleaf-tree', 20, { sizeFraction: 0.4, ageTicks: 50 });
  const seen = new Map<number, { species: string; cell: number; birth: number }>();
  const everDead = new Set<number>();
  for (let t = 0; t < 300; t++) {
    sim.step();
    const living = new Set(veg.livingPlantIds());
    for (const [id] of seen) if (!living.has(id)) everDead.add(id);
    for (const id of living) {
      assert.ok(!everDead.has(id), `id ${id} reappeared after death`);
      const p = veg.getPlant(id)!;
      const s = seen.get(id);
      if (s) {
        assert.equal(p.speciesId, s.species);
        assert.equal(p.cellIndex, s.cell);
        assert.equal(p.birthTick, s.birth);
      } else seen.set(id, { species: p.speciesId, cell: p.cellIndex, birth: p.birthTick });
    }
  }
  const ids = [...seen.keys()];
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length > 20, 'new individuals were born');
  assertConserved(sim, 'identity');
});

// =================================================================================================
// Herbivores
// =================================================================================================

test('Vegetation and herbivores: only leaves and herbs are eaten, grazing reduces and kills plants, the stand recovers', () => {
  const grid = flatGrid(16, 10, 'veg-graze', 20, 0.6);
  const sim = vegSim(grid, 'veg-graze');
  const veg = sim.vegetation!;
  const [bigTree] = sim.spawnPlantPopulation('broadleaf-tree', 1, { center: { x: 8, y: 5, radius: 0 }, sizeFraction: 1, ageTicks: 400 });
  const woodOf = (id: number) => {
    const p = veg.getPlant(id);
    return p ? p.biomassMU - p.leafMassMU : NaN;
  };
  sim.stepMany(30);
  const herb0 = herbMass(sim);
  const wood0 = woodOf(bigTree);
  sim.spawnFounderPopulation('grazer', 260);
  let eaten = 0;
  let minHerb = herb0;
  for (let t = 0; t < 160; t++) {
    sim.step();
    eaten += veg.lastTickStats.consumedQ;
    minHerb = Math.min(minHerb, herbMass(sim));
    assertConserved(sim, `grazing tick ${t}`);
  }
  assert.ok(eaten > 0, 'herbivores eat plant biomass');
  assert.ok(minHerb < 0.6 * herb0, `grazing depletes the herb layer (${herb0.toFixed(0)} -> ${minHerb.toFixed(0)} MU)`);
  assert.ok(veg.totals.deathsByCause.herbivory + veg.totals.deathsByCause['carbon-starvation'] > 0, 'browsing kills young woody plants');
  const tree = veg.getPlant(bigTree);
  if (tree) assert.ok(woodOf(bigTree) >= wood0 * 0.95, 'the wood of a large tree is never eaten');

  // Grazers removed: the vegetation regrows from what is left and from seeds
  for (const o of [...sim.getOrganisms('grazer')]) sim.killOrganism('grazer', o.id, 'injury');
  const low = herbMass(sim);
  sim.stepMany(200);
  assert.ok(herbMass(sim) > low + 0.5 * (herb0 - low), `the herb layer recovers towards its ungrazed level (${low.toFixed(0)} -> ${herbMass(sim).toFixed(0)}, ungrazed ${herb0.toFixed(0)} MU)`);
  assertConserved(sim, 'recovery');
});

// =================================================================================================
// Conservation, determinism, ABORT
// =================================================================================================

test('Vegetation conservation: no matter or energy from nothing; growth stops when abiotic matter is exhausted', () => {
  const sim = vegSim(flatGrid(10, 8, 'veg-cons'), 'veg-cons');
  sim.spawnPlantPopulation('pioneer-tree', 30, { sizeFraction: 0.3 });
  sim.spawnFounderPopulation('grazer', 40);
  const mass0 = sim.getEnergyAudit().actualMassQ;
  for (let t = 0; t < 150; t++) {
    sim.step();
    assertConserved(sim, `tick ${t}`);
  }
  assert.equal(sim.getEnergyAudit().actualMassQ, mass0, 'total mass constant');

  // A world whose abiotic pool is used up cannot grow plants
  const starved = vegSim(flatGrid(10, 8, 'veg-cons'), 'veg-cons', true, { initialAbioticMassMU: 0 });
  const plant0 = sumPool(starved, EnergyPool.PLANT);
  starved.step();
  assert.equal(starved.vegetation!.lastTickStats.grossProductionQ, 0, 'no photosynthetic uptake without abiotic matter');
  assert.ok(sumPool(starved, EnergyPool.PLANT) <= plant0);
  starved.stepMany(20);
  assertConserved(starved, 'abiotic exhausted');
});

test('Vegetation determinism and ABORT: same seed same world; a failed tick leaves plants and ledger untouched', () => {
  const make = (onPhase?: (ctx: { tick: number; phase: BiologyStepPhase }) => void) => {
    const sim = vegSim(flatGrid(12, 8, 'veg-det'), 'veg-det', true, { onPhase });
    sim.spawnPlantPopulation('broadleaf-tree', 20, { sizeFraction: 0.3 });
    sim.spawnPlantPopulation('pioneer-tree', 20, { sizeFraction: 0.3 });
    sim.spawnFounderPopulation('grazer', 60);
    return sim;
  };
  const fp = (sim: BiologySimulation) => {
    const big = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
    return [sim.tick, sim.vegetation!.digest(), JSON.stringify(sim.getEnergyAudit(), big), JSON.stringify(sim.streams.snapshotStates()), sim.getOrganisms('grazer').map((o) => `${o.id}:${o.x}:${o.y}:${o.energy}`).join(',')].join('#');
  };
  const a = make();
  const b = make();
  a.stepMany(120);
  b.stepMany(120);
  assert.equal(fp(a), fp(b), 'deterministic');

  let fault: BiologyStepPhase | null = null;
  const sim = make(({ phase }) => {
    if (fault !== null && phase === fault) throw new Error(`fault at ${phase}`);
  });
  const ref = make();
  sim.stepMany(60);
  ref.stepMany(61);
  const before = fp(sim);
  for (const phase of ['GATHER', 'RESOLVE', 'PRE_ALLOCATE', 'PREPARE', 'COMMIT'] as BiologyStepPhase[]) {
    fault = phase;
    assert.throws(() => sim.step(), new RegExp(`fault at ${phase}`));
    assert.equal(fp(sim), before, `${phase}: nothing changed`);
    assertConserved(sim, `${phase} abort`);
  }
  fault = null;
  sim.step();
  assert.equal(fp(sim), fp(ref), 'the retried tick equals the undisturbed one (no double growth)');
});

// =================================================================================================
// Compatibility: spatial biology, evolution, aquatic producers, disabled mode
// =================================================================================================

test('Vegetation compatibility: spatial grazers live on plants, evolution mode runs, plant traits are inherited', () => {
  const sim = vegSim(flatGrid(16, 10, 'veg-evo'), 'veg-evo', true, { evolution: true });
  const veg = sim.vegetation!;
  sim.spawnPlantPopulation('pioneer-tree', 40, { sizeFraction: 0.5, ageTicks: 80 });
  sim.spawnFounderPopulation('grazer', 80);
  let births = 0;
  for (let t = 0; t < 400; t++) {
    sim.step();
    births = sim.getStats('grazer').birthsTotal;
  }
  assert.ok(sim.getOrganisms('grazer').length > 0 && births > 0, 'herbivores feed on the plants and reproduce');
  assert.ok(sim.evolutionStats.speciationChecks > 0, 'the evolution machinery runs alongside');
  const kids = veg.getPlants('pioneer-tree', sim.tick).filter((p) => p.motherId !== null);
  assert.ok(kids.length > 5, 'plants reproduce sexually');
  for (const k of kids) {
    assert.ok(k.generation >= 1);
    for (const v of Object.values(k.traits)) assert.ok(Number.isFinite(v));
  }
  assertConserved(sim, 'evolution');
});

test('Vegetation aquatic producers: algae grow in warm shallow water, less in deep water, never on land', () => {
  const grid = flatGrid(12, 4, 'veg-aqua', 20, 0.6);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) grid.setCell(x, y, { terrain: 'shallow-water' });
    for (let x = 4; x < 8; x++) grid.setCell(x, y, { terrain: 'deep-water' });
  }
  const sim = vegSim(grid, 'veg-aqua', { initialHerbCover: 0.05, initialSeedDensity: 0 });
  const veg = sim.vegetation!;
  const algae = (x0: number, x1: number) => {
    let m = 0;
    for (let y = 0; y < 4; y++) for (let x = x0; x < x1; x++) m += veg.getCell(y * 12 + x).herbMassMU['algae'];
    return m;
  };
  const s0 = algae(0, 4);
  sim.stepMany(150);
  assert.ok(algae(0, 4) > 3 * s0, 'algae grow in shallow water');
  assert.ok(algae(0, 4) > 2 * algae(4, 8), 'deep water is less productive');
  assert.equal(algae(8, 12), 0, 'no algae on land');
  assertConserved(sim, 'aquatic');
});

test('Vegetation disabled: the world is bit-identical to a simulation without the option', () => {
  const mk = (vegetation?: false) =>
    new BiologySimulation({ grid: flatGrid(10, 8, 'veg-off'), seed: 'veg-off', speciesRegistry: registry(GRAZER), recordHistory: false, spatial: true, ...(vegetation === false ? { vegetation } : {}) });
  const a = mk();
  const b = mk(false);
  a.spawnFounderPopulation('grazer', 50);
  b.spawnFounderPopulation('grazer', 50);
  a.stepMany(60);
  b.stepMany(60);
  const big = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
  assert.equal(JSON.stringify(a.getEnergyAudit(), big), JSON.stringify(b.getEnergyAudit(), big));
  assert.equal(a.vegetation, null);
  assert.deepEqual(a.getOrganisms('grazer').map((o) => [o.id, o.x, o.y, o.energy]), b.getOrganisms('grazer').map((o) => [o.id, o.x, o.y, o.energy]));
});

// =================================================================================================
// Integration scenarios
// =================================================================================================

test('Scenario B (forest): growth, competition, ageing and generational turnover of trees; gaps open and close', () => {
  const sim = vegSim(flatGrid(16, 12, 'veg-forest', 18, 0.65), 'veg-forest', { initialSeedDensity: 0 });
  const veg = sim.vegetation!;
  const pioneers = sim.spawnPlantPopulation('pioneer-tree', 120, { sizeFraction: 0.6, ageTicks: 150 });
  sim.spawnPlantPopulation('broadleaf-tree', 25, { sizeFraction: 0.2, ageTicks: 40 });
  let maxGeneration = 0;
  let gapsSeen = 0;
  let maxBroadleafMass = 0;
  for (let t = 0; t < 1500; t++) {
    sim.step();
    if (t % 100 === 99) {
      for (const p of veg.getPlants(undefined, sim.tick)) maxGeneration = Math.max(maxGeneration, p.generation);
      let gaps = 0;
      for (let c = 0; c < sim.grid.cellCount; c++) if (veg.getCell(c).crownCover < 0.25) gaps++;
      gapsSeen = Math.max(gapsSeen, gaps);
      maxBroadleafMass = Math.max(maxBroadleafMass, veg.speciesTotals()['broadleaf-tree'].woodyMassMU);
      assertConserved(sim, `forest t${sim.tick}`);
    }
  }
  const founderDeaths = veg.getDeathRecords().filter((d) => pioneers.includes(d.id));
  assert.ok(founderDeaths.length > 0 || veg.totals.deathsByCause.senescence > 0, 'old trees die');
  assert.ok(veg.totals.deathsByCause.senescence > 0, 'senescence is a cause of death');
  assert.ok(veg.totals.deathsByCause['carbon-starvation'] > 0, 'suppressed trees die in the shade (self-thinning)');
  assert.ok(maxGeneration >= 2, `generations follow each other (max generation ${maxGeneration})`);
  assert.ok(gapsSeen > 0, 'dying trees open gaps');
  assert.ok(veg.speciesTotals()['broadleaf-tree'].woodyCount > 0 && maxBroadleafMass > 0, 'the shade-tolerant tree persists under the pioneer canopy');
  for (let c = 0; c < sim.grid.cellCount; c++) assert.ok(veg.getCell(c).woodyIds.length <= 20);
});

test('Scenario E (short): plants and animals together keep conservation exact; animals live on real plant production', () => {
  const grid = WorldGrid.generate({ width: 24, height: 16, seed: 'veg-e-short' });
  const sim = vegSim(grid, 'veg-e', true, { evolution: true });
  const veg = sim.vegetation!;
  sim.spawnPlantPopulation('boreal-conifer', 40, { sizeFraction: 0.5, ageTicks: 200 });
  sim.spawnPlantPopulation('pioneer-tree', 40, { sizeFraction: 0.5, ageTicks: 100 });
  sim.spawnFounderPopulation('grazer', 80);
  const mass0 = sim.getEnergyAudit().actualMassQ;
  let consumed = 0;
  for (let t = 0; t < 1200; t++) {
    sim.step();
    consumed += veg.lastTickStats.consumedQ;
    if (t % 200 === 199) assertConserved(sim, `E t${sim.tick}`);
  }
  assert.equal(sim.getEnergyAudit().actualMassQ, mass0);
  assert.ok(consumed > 0, 'herbivores fed on plants');
  assert.ok(veg.totals.grossProductionQ > consumed, 'plants produced more than was eaten');
  assert.ok(veg.livingWoodyCount > 0 && veg.totals.births > 80, 'the plant community renews itself');
});
