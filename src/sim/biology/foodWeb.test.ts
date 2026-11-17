import assert from 'node:assert/strict';
import test from 'node:test';
import { SeededRng } from '../prng';
import { WorldGrid } from '../worldGrid';
import { EnergyPool } from '../worldEnergyGrid';
import { BiologySimulation, BiologyStepPhase } from './biologySimulation';
import { createIndividualGenome } from './genome';
import { RAPTOR_SPECIES, SpeciesDefinition, SpeciesRegistry } from './species';
import { deriveDefaultTrophicProfile, resolveDietFlexibility } from './trophicProfile';

// =================================================================================================
// Helpers: the P5 guild species
// =================================================================================================

function makeSpecies(id: string, diet: SpeciesDefinition['diet'], opts: Record<string, unknown> = {}): SpeciesDefinition {
  const o = opts as { bodySize?: number; speed?: number; physiology?: object; dietWeights?: object; trophic?: object };
  const base: SpeciesDefinition = {
    ...RAPTOR_SPECIES,
    id,
    name: id,
    diet,
    traitBaselines: { ...RAPTOR_SPECIES.traitBaselines, bodySize: o.bodySize ?? 1.0, speed: o.speed ?? 1.0 },
    physiology: { ...RAPTOR_SPECIES.physiology, ...(o.physiology ?? {}) },
  };
  if (!o.dietWeights && !o.trophic) return base;
  return { ...base, trophicProfile: { ...deriveDefaultTrophicProfile(base), ...(o.dietWeights ? { dietWeights: o.dietWeights } : {}), ...(o.trophic ?? {}) } as never };
}
const GRAZER = makeSpecies('grazer', 'herbivore', { bodySize: 0.6, speed: 1.0 });
const HUNTER = makeSpecies('hunter', 'carnivore', {
  bodySize: 1.0,
  speed: 1.4,
  dietWeights: { plant: 0, prey: 0.5, carrion: 0.5, detritus: 0 },
  trophic: { basalMetabolicFactor: 0.16, activityCostFactor: 0.045, thermoregulationFactor: 0.07 },
  physiology: { maxForageIntakePerTick: 0.4 },
});
const CLEANER = makeSpecies('cleaner', 'scavenger', { bodySize: 0.7, speed: 1.1 });
const DIGGER = makeSpecies('digger', 'detritivore', { bodySize: 0.5, speed: 0.8 });

function registry(...species: SpeciesDefinition[]): SpeciesRegistry {
  const reg = new SpeciesRegistry();
  for (const sp of species) reg.register(sp);
  return reg;
}

function flatGrid(width: number, height: number, seed: string): WorldGrid {
  const grid = WorldGrid.generate({ width, height, seed });
  for (let i = 0; i < grid.cellCount; i++) grid.setCellByIndex(i, { elevation: 0.5, temperature: 22, moisture: 0.56 });
  return grid;
}

type Extra = Partial<ConstructorParameters<typeof BiologySimulation>[0]>;
function world(species: SpeciesDefinition[], seed: string, adaptive: boolean, extra: Extra = {}, size: [number, number] = [12, 8]): BiologySimulation {
  return new BiologySimulation({
    grid: flatGrid(size[0], size[1], `${seed}-grid`),
    seed,
    speciesRegistry: registry(...species),
    recordHistory: false,
    statsInterval: 1e9,
    spatial: true,
    backgroundPreyCapacityScale: 0,
    strictConservation: true,
    ...(adaptive ? { adaptiveDiet: true } : {}),
    ...extra,
  });
}

function spawnAt(sim: BiologySimulation, sp: SpeciesDefinition, x: number, y: number, energy: number, sex: 'female' | 'male' = 'female') {
  const genome = createIndividualGenome(sp.genomeSchema, sp.traitBaselines, sp.traitRanges, 0, new SeededRng(`g-${sp.id}`));
  return sim.spawnOrganism({ speciesId: sp.id, x, y, sex, genome, stage: 'adult', ageTicks: 60, energy });
}

function assertExact(sim: BiologySimulation, label: string): void {
  const audit = sim.assertEnergyAudit();
  assert.equal(audit.massResidualQ, 0n, `${label}: mass residual`);
  assert.equal(audit.energyResidualQ, 0n, `${label}: energy residual`);
  for (let c = 0; c < sim.grid.cellCount; c++) {
    for (const p of [EnergyPool.PLANT, EnergyPool.CARRION, EnergyPool.DETRITUS]) {
      assert.ok(sim.energyGrid.getMassQ(p, c) >= 0 && sim.energyGrid.getEnergyQ(p, c) >= 0, `${label}: no negative pool`);
    }
  }
}

const big = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
function fingerprint(sim: BiologySimulation): string {
  const orgs = sim.speciesRegistry.list().flatMap((s) => [...sim.getOrganisms(s.id)]).sort((a, b) => a.id - b.id);
  return [
    sim.tick,
    JSON.stringify(sim.getEnergyAudit(), big),
    JSON.stringify(sim.streams.snapshotStates()),
    orgs.map((o) => `${o.id}:${o.speciesId}:${o.x}:${o.y}:${o.energy}:${o.health}:${o.stage}`).join(','),
  ].join('#');
}

// =================================================================================================
// Contract, compatibility
// =================================================================================================

test('Food web: feeding-type rules keep the specialisations; adaptiveDiet off is bit-identical to the P2 model', () => {
  const fx = (sp: SpeciesDefinition) => resolveDietFlexibility(deriveDefaultTrophicProfile(sp));
  assert.deepEqual([fx(GRAZER).prey.maxShare, fx(GRAZER).carrion.maxShare, fx(GRAZER).detritus.maxShare], [0, 0, 0], 'herbivores eat only plants');
  assert.equal(fx(CLEANER).prey.maxShare, 0, 'scavengers do not hunt');
  assert.equal(fx(CLEANER).plant.maxShare, 0);
  assert.ok(fx(CLEANER).detritus.maxShare > 0 && fx(CLEANER).detritus.extraDigestibility < 1, 'scavengers fall back on poorly digested detritus');
  assert.equal(fx(DIGGER).plant.maxShare, 0);
  assert.equal(fx(HUNTER).plant.maxShare, 0, 'carnivores do not eat plants');

  for (const spatial of [true, false]) {
    const mk = (adaptive: boolean | undefined) => {
      const sim = new BiologySimulation({
        grid: WorldGrid.generate({ width: 24, height: 16, seed: 'fw-compat' }),
        seed: 'fw-compat',
        speciesRegistry: registry(GRAZER, HUNTER, CLEANER, DIGGER),
        recordHistory: false,
        spatial,
        backgroundPreyCapacityScale: 0,
        ...(adaptive === undefined ? {} : { adaptiveDiet: adaptive }),
      });
      sim.spawnFounderPopulation('grazer', 120);
      sim.spawnFounderPopulation('hunter', 12);
      sim.spawnFounderPopulation('cleaner', 10);
      sim.spawnFounderPopulation('digger', 20);
      sim.stepMany(80);
      return fingerprint(sim);
    };
    assert.equal(mk(false), mk(undefined), `spatial=${spatial}: adaptiveDiet false changes nothing`);
  }
});

// =================================================================================================
// Adaptive feeding
// =================================================================================================

test('Food web: a scavenger without carrion falls back on detritus (worse digested); never on plants or prey', () => {
  const run = (adaptive: boolean) => {
    // a vegetated world: litter keeps the detritus pools stocked, but nothing dies to give carrion
    const sim = world([CLEANER, GRAZER], 'fw-scav', adaptive, { vegetation: true });
    sim.stepMany(150);
    const ids = [0, 1, 2, 3, 4, 5].map((i) => spawnAt(sim, CLEANER, 2 + (i % 3), 2 + (i % 2), 0.3).id);
    let substituted = 0;
    let plantOrPrey = 0;
    let aliveTicks = 0;
    for (let t = 0; t < 200; t++) {
      sim.step();
      for (const id of ids) aliveTicks += sim.getOrganismById('cleaner', id) ? 1 + sim.getOrganismById('cleaner', id)!.energy : 0;
      if (adaptive) {
        substituted += sim.adaptiveDietStats.substitutedDetritusQ;
        plantOrPrey += sim.adaptiveDietStats.substitutedPlantQ;
      }
    }
    assertExact(sim, `scavenger ${adaptive}`);
    return { substituted, plantOrPrey, aliveTicks };
  };
  const p2 = run(false);
  const ad = run(true);
  assert.ok(ad.substituted > 0, 'detritus replaces the missing carrion');
  assert.equal(ad.plantOrPrey, 0, 'a scavenger never eats plants');
  // detritus is poor food for a scavenger (3 EU/MU at 60 % digestibility): it delays starvation, it
  // does not turn the scavenger into a detritivore
  assert.ok(ad.aliveTicks > p2.aliveTicks * 1.02, `the fallback prolongs survival and condition (${p2.aliveTicks.toFixed(1)} -> ${ad.aliveTicks.toFixed(1)})`);
});

test('Food web: substituted food is digested worse - the same gut volume yields less energy', () => {
  // Hungry scavengers on detritus, no carrion. P2 eats only its preferred 15 % detritus share; the
  // adaptive diet fills the rest of the gut (up to the 60 % cap) with detritus digested at 0.6. A
  // control species whose detritus is digested at 1.0 shows what the same volume would have given.
  const ingested = (adaptive: boolean, digestibility?: number) => {
    const sp: SpeciesDefinition = digestibility === undefined
      ? CLEANER
      : { ...CLEANER, trophicProfile: { ...deriveDefaultTrophicProfile(CLEANER), dietFlexibility: { detritus: { maxShare: 0.6, extraDigestibility: digestibility } } } as never };
    const sim = world([sp, GRAZER], 'fw-eff', adaptive);
    for (let i = 0; i < 4; i++) spawnAt(sim, sp, 2 + i, 2, 0.2);
    const ing0 = sim.ledger.cumulativeFlow(4 as never).energyQ;
    sim.step();
    assertExact(sim, `digestibility ${adaptive} ${digestibility}`);
    return Number(sim.ledger.cumulativeFlow(4 as never).energyQ - ing0);
  };
  const p2 = ingested(false);
  const poor = ingested(true);
  const full = ingested(true, 1);
  const dig = resolveDietFlexibility(deriveDefaultTrophicProfile(CLEANER)).detritus.extraDigestibility;
  assert.ok(full > 1.5 * p2, `a scavenger without carrion fills its gut with detritus (${p2} -> ${full})`);
  const ratio = (poor - p2) / (full - p2);
  assert.ok(Math.abs(ratio - dig) < 0.05, `the substituted volume yields its digestibility share of energy (${ratio.toFixed(3)} vs ${dig})`);
});

test('Food web: a hunter eats an available carcass instead of hunting; without carrion it can live on prey alone', () => {
  const run = (adaptive: boolean, carcass: boolean) => {
    const sim = world([HUNTER, GRAZER], `fw-hunt-${carcass}`, adaptive, {}, [10, 6]);
    const h = spawnAt(sim, HUNTER, 4, 3, 0.35);
    for (let i = 0; i < 8; i++) spawnAt(sim, GRAZER, 3 + (i % 3), 2 + (i % 3), 0.8, i % 2 ? 'male' : 'female');
    if (carcass) {
      // three grazers die in the hunter's cell (a world event): their bodies become carrion
      for (let i = 0; i < 3; i++) sim.killOrganism('grazer', spawnAt(sim, GRAZER, 4, 3, 0.8).id, 'injury');
    }
    let attempts = 0;
    let avoided = 0;
    const s0 = sim.spatial!.stats.huntAttempts;
    for (let t = 0; t < 12; t++) {
      sim.step();
      if (adaptive) avoided += sim.adaptiveDietStats.preyAvoidedQ;
    }
    attempts = sim.spatial!.stats.huntAttempts - s0;
    assertExact(sim, `hunt ${adaptive} ${carcass}`);
    return { attempts, avoided, energy: sim.getOrganismById('hunter', h.id)?.energy ?? 0 };
  };
  const p2Carcass = run(false, true);
  const adCarcass = run(true, true);
  assert.ok(adCarcass.avoided > 0, 'the prey share is covered from the carcass');
  assert.ok(adCarcass.attempts < p2Carcass.attempts, `fewer attacks with food at hand (${p2Carcass.attempts} -> ${adCarcass.attempts})`);
  const adNoCarcass = run(true, false);
  assert.ok(adNoCarcass.attempts > 0, 'without carrion it hunts');
});

test('Food web: many animals competing for one limited carcass never get more than exists; result is deterministic', () => {
  const run = () => {
    const sim = world([CLEANER, GRAZER], 'fw-contend', true, {}, [6, 4]);
    const victims = [0, 1].map(() => spawnAt(sim, GRAZER, 2, 2, 0.5).id);
    for (const v of victims) sim.killOrganism('grazer', v, 'injury');
    const cell = 2 * 6 + 2;
    const carrion0 = sim.energyGrid.getMassQ(EnergyPool.CARRION, cell);
    for (let i = 0; i < 14; i++) spawnAt(sim, CLEANER, 2, 2, 0.05, i % 2 ? 'male' : 'female');
    sim.step();
    const eaten = carrion0 - sim.energyGrid.getMassQ(EnergyPool.CARRION, cell);
    assertExact(sim, 'contention');
    return { eaten, carrion0, fp: fingerprint(sim) };
  };
  const a = run();
  const b = run();
  assert.ok(a.eaten > 0 && a.eaten <= a.carrion0, 'the carcass is shared, not duplicated');
  assert.equal(a.fp, b.fp, 'deterministic allocation');
});

// =================================================================================================
// Prey choice and injuries
// =================================================================================================

test('Food web: predators choose prey by expected gain and risk - small slow prey is no longer the default target', () => {
  // Same encounter situation: hunters among a mixed herd of small slow detritivores and grazers
  const run = (mode: 'capture' | 'profitability', seed: string) => {
    const sim = new BiologySimulation({
      grid: flatGrid(14, 10, `fw-choice-${seed}`),
      seed,
      speciesRegistry: registry(HUNTER, GRAZER, DIGGER),
      recordHistory: false,
      statsInterval: 1e9,
      spatial: true,
      backgroundPreyCapacityScale: 0,
      adaptiveDiet: { preySelection: mode },
    });
    sim.spawnFounderPopulation('grazer', 150);
    sim.spawnFounderPopulation('digger', 150);
    sim.spawnFounderPopulation('hunter', 20);
    sim.stepMany(60);
    const g = sim.getStats('grazer').deathsByCause.predation ?? 0;
    const d = sim.getStats('digger').deathsByCause.predation ?? 0;
    assertExact(sim, mode);
    return { grazerKills: g, diggerKills: d, injuries: sim.spatial!.stats.huntInjuries };
  };
  let capDigShare = 0;
  let profDigShare = 0;
  let profDiggerKills = 0;
  for (const seed of ['c1', 'c2', 'c3']) {
    const c = run('capture', seed);
    const p = run('profitability', seed);
    capDigShare += c.diggerKills / Math.max(1, c.diggerKills + c.grazerKills);
    profDigShare += p.diggerKills / Math.max(1, p.diggerKills + p.grazerKills);
    profDiggerKills += p.diggerKills;
  }
  assert.ok(profDigShare < capDigShare, `share of detritivores among kills falls (${(capDigShare / 3).toFixed(2)} -> ${(profDigShare / 3).toFixed(2)})`);
  assert.ok(profDiggerKills > 0, 'small prey is not protected absolutely');
});

test('Food web: failed attacks on large defended prey can injure the predator (adaptive mode only)', () => {
  const big = makeSpecies('aurochs', 'herbivore', { bodySize: 2.0, speed: 0.9 });
  const run = (adaptive: boolean) => {
    const sim = world([HUNTER, big], 'fw-injury', adaptive, {}, [8, 6]);
    for (let i = 0; i < 6; i++) spawnAt(sim, HUNTER, 3, 3, 0.2, i % 2 ? 'male' : 'female');
    for (let i = 0; i < 12; i++) spawnAt(sim, big, 3 + (i % 2), 3, 0.9, i % 2 ? 'male' : 'female');
    sim.stepMany(30);
    assertExact(sim, `injury ${adaptive}`);
    return sim.spatial!.stats.huntInjuries;
  };
  assert.equal(run(false), 0, 'no injuries in the P5 model');
  assert.ok(run(true) > 0, 'dangerous prey hurts failed attackers');
});

// =================================================================================================
// Spatial ecology, vegetation, evolution, ABORT
// =================================================================================================

test('Food web: animals perceive the foods they may eat (food field of the existing spatial perception)', () => {
  const weights = (adaptive: boolean) => {
    const sim = world([CLEANER, HUNTER, GRAZER], 'fw-perc', adaptive);
    spawnAt(sim, CLEANER, 2, 2, 0.5);
    sim.step();
    const rts = (sim.spatial as unknown as { species: { species: SpeciesDefinition; fPlant: number; fCarrion: number; fDetritus: number; dPrey: number }[] }).species;
    const of = (id: string) => rts.find((r) => r.species.id === id)!;
    return { cleaner: of('cleaner'), hunter: of('hunter'), grazer: of('grazer') };
  };
  const p2 = weights(false);
  const ad = weights(true);
  assert.ok(ad.cleaner.fDetritus > p2.cleaner.fDetritus, 'a scavenger notices detritus it can fall back on');
  assert.ok(ad.hunter.fCarrion > p2.hunter.fCarrion, 'a carnivore values carcasses as full food');
  assert.equal(ad.hunter.dPrey, p2.hunter.dPrey, 'how threatening a predator looks is unchanged');
  assert.equal(ad.grazer.fCarrion, 0, 'a herbivore never perceives carrion as food');
  assert.equal(ad.grazer.fPlant, p2.grazer.fPlant);
});

test('Food web: works with vegetation (only edible plants eaten, exact partition) and with spatial: false', () => {
  const sim = new BiologySimulation({
    grid: WorldGrid.generate({ width: 20, height: 14, seed: 'fw-veg' }),
    seed: 'fw-veg',
    speciesRegistry: registry(GRAZER, HUNTER, CLEANER, DIGGER),
    recordHistory: false,
    statsInterval: 1e9,
    spatial: true,
    backgroundPreyCapacityScale: 0,
    adaptiveDiet: true,
    vegetation: true,
  });
  sim.spawnPlantPopulation('pioneer-tree', 40, { sizeFraction: 0.5, ageTicks: 100 });
  sim.spawnFounderPopulation('grazer', 120);
  sim.spawnFounderPopulation('hunter', 10);
  sim.spawnFounderPopulation('cleaner', 10);
  sim.spawnFounderPopulation('digger', 20);
  for (let t = 0; t < 200; t++) {
    sim.step();
    if (t % 50 === 49) {
      assert.equal(sim.vegetation!.audit((c) => sim.energyGrid.getMassQ(EnergyPool.PLANT, c)), -1, 'plant partition exact');
      assertExact(sim, `veg t${t}`);
    }
  }
  const flat = new BiologySimulation({
    grid: WorldGrid.generate({ width: 20, height: 14, seed: 'fw-flat' }),
    seed: 'fw-flat',
    speciesRegistry: registry(GRAZER, HUNTER, CLEANER, DIGGER),
    recordHistory: false,
    statsInterval: 1e9,
    spatial: false,
    backgroundPreyCapacityScale: 0,
    adaptiveDiet: true,
  });
  flat.spawnFounderPopulation('grazer', 150);
  flat.spawnFounderPopulation('hunter', 15);
  flat.spawnFounderPopulation('cleaner', 15);
  flat.spawnFounderPopulation('digger', 30);
  let subst = 0;
  for (let t = 0; t < 150; t++) {
    flat.step();
    subst += flat.adaptiveDietStats.substitutedDetritusQ + flat.adaptiveDietStats.substitutedCarrionQ;
  }
  assert.ok(subst > 0, 'substitution also works without spatial behaviour');
  assertExact(flat, 'non-spatial');
});

test('Food web: determinism and ABORT with adaptive feeding and evolution', () => {
  const make = (onPhase?: (ctx: { tick: number; phase: BiologyStepPhase }) => void) => {
    const sim = new BiologySimulation({
      grid: WorldGrid.generate({ width: 20, height: 14, seed: 'fw-abort' }),
      seed: 'fw-abort',
      speciesRegistry: registry(GRAZER, HUNTER, CLEANER, DIGGER),
      recordHistory: false,
      statsInterval: 1e9,
      spatial: true,
      backgroundPreyCapacityScale: 0,
      adaptiveDiet: true,
      evolution: true,
      onPhase,
    });
    sim.spawnFounderPopulation('grazer', 150);
    sim.spawnFounderPopulation('hunter', 15);
    sim.spawnFounderPopulation('cleaner', 15);
    sim.spawnFounderPopulation('digger', 30);
    return sim;
  };
  const a = make();
  const b = make();
  a.stepMany(100);
  b.stepMany(100);
  assert.equal(fingerprint(a), fingerprint(b), 'deterministic');
  let fault: BiologyStepPhase | null = null;
  const sim = make(({ phase }) => {
    if (fault !== null && phase === fault) throw new Error(`fault at ${phase}`);
  });
  const ref = make();
  sim.stepMany(50);
  ref.stepMany(51);
  const before = fingerprint(sim);
  for (const phase of ['GATHER', 'RESOLVE', 'PRE_ALLOCATE', 'PREPARE', 'COMMIT'] as BiologyStepPhase[]) {
    fault = phase;
    assert.throws(() => sim.step(), new RegExp(`fault at ${phase}`));
    assert.equal(fingerprint(sim), before, `${phase}: untouched`);
    assertExact(sim, `${phase} abort`);
  }
  fault = null;
  sim.step();
  assert.equal(fingerprint(sim), fingerprint(ref), 'retry equals the undisturbed tick');
});

test('Food web: natural speciation still happens with adaptive feeding (thresholds unchanged)', () => {
  const grid = WorldGrid.generate({ width: 28, height: 10, seed: 'speciate-grid' });
  for (let i = 0; i < grid.cellCount; i++) grid.setCellByIndex(i, { elevation: 0.5, temperature: 24, moisture: 0.56 });
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 28; x++) {
      if (x >= 11 && x <= 16) grid.setCell(x, y, { terrain: 'deep-water' });
      else grid.setCell(x, y, x < 11 ? { temperature: 46 } : { temperature: 3, moisture: 0.64 });
    }
  }
  const FAST: SpeciesDefinition = {
    ...RAPTOR_SPECIES,
    lifecycle: { ...RAPTOR_SPECIES.lifecycle, incubationTicks: 4, juvenileTicks: 10, elderAgeTicks: 70, maxLifespanTicks: 100 },
    reproduction: { ...RAPTOR_SPECIES.reproduction, cooldownTicks: 6 },
    mutation: { ...RAPTOR_SPECIES.mutation, baseRate: 0.12, stepScale: 0.12 },
  };
  const sim = new BiologySimulation({
    grid,
    seed: 'speciate',
    speciesRegistry: registry(FAST),
    recordHistory: false,
    statsInterval: 1e9,
    spatial: true,
    evolution: { minReproductiveIsolation: 0.15 },
    adaptiveDiet: true,
  });
  sim.spawnFounderPopulation('raptor', 80, { center: { x: 5, y: 5, radius: 4 } });
  sim.spawnFounderPopulation('raptor', 80, { center: { x: 22, y: 5, radius: 4 } });
  while (sim.evolutionStats.speciations === 0 && sim.tick < 4000) sim.step();
  assert.equal(sim.evolutionStats.speciations, 1, `a new species arose (tick ${sim.tick})`);
  const [ev] = sim.phylogeny!.getSpeciationEvents();
  assert.ok(ev.reproductiveIsolation >= 0.15);
  assert.equal(sim.phylogeny!.getNode(ev.daughterSpeciesId)!.parentIds[0], 'raptor');
  assertExact(sim, 'speciation');
});
