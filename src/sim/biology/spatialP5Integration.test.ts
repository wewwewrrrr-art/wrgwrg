import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { SeededRng } from '../prng';
import {
  RHO_DETRITUS,
  RHO_PLANT,
  RHO_RESERVE,
  RHO_STRUCT,
  hasExactDensity,
  isValidCarrionMix,
} from '../units';
import { EnergyPool } from '../worldEnergyGrid';
import { WorldCellPatch, WorldGrid } from '../worldGrid';
import { BiologySimulation, BiologySimulationConfig, BiologyStepPhase } from './biologySimulation';
import { createIndividualGenome } from './genome';
import { Organism, OrganismDeathEvent, Sex } from './organism';
import { RAPTOR_SPECIES, SpeciesDefinition, SpeciesRegistry } from './species';
import { BEHAVIOR_FLEE } from './spatialBehavior';
import { TrophicDietWeights, TrophicProfile, deriveDefaultTrophicProfile } from './trophicProfile';

// =================================================================================================
// Integration of P5 transactional energetics (COMMIT / POST_COMMIT semantics, strict post*Fast
// validation, I1-I5) with autonomous spatial behavior. Every test runs the two systems together.
// =================================================================================================

function makeFlatGrid(width: number, height: number, seed: string, patch: WorldCellPatch = {}): WorldGrid {
  const grid = WorldGrid.generate({ width, height, seed });
  for (let i = 0; i < grid.cellCount; i++) {
    grid.setCellByIndex(i, { elevation: 0.5, temperature: 24, moisture: 0.56, ...patch });
  }
  return grid;
}

interface SpeciesOptions {
  bodySize?: number;
  speed?: number;
  dietWeights?: TrophicDietWeights;
  trophic?: Partial<TrophicProfile>;
  physiology?: Partial<SpeciesDefinition['physiology']>;
}

function makeSpecies(id: string, diet: SpeciesDefinition['diet'], opts: SpeciesOptions = {}): SpeciesDefinition {
  const base: SpeciesDefinition = {
    ...RAPTOR_SPECIES,
    id,
    name: id,
    diet,
    traitBaselines: {
      ...RAPTOR_SPECIES.traitBaselines,
      bodySize: opts.bodySize ?? 1.0,
      speed: opts.speed ?? 1.0,
    },
    physiology: { ...RAPTOR_SPECIES.physiology, ...(opts.physiology ?? {}) },
  };
  if (!opts.dietWeights && !opts.trophic) return base;
  const derived = deriveDefaultTrophicProfile(base);
  return {
    ...base,
    trophicProfile: {
      ...derived,
      ...(opts.dietWeights ? { dietWeights: opts.dietWeights } : {}),
      ...(opts.trophic ?? {}),
    },
  };
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
const IDS = ['grazer', 'hunter', 'cleaner', 'digger'] as const;

function registryOf(...species: SpeciesDefinition[]): SpeciesRegistry {
  const reg = new SpeciesRegistry();
  for (const sp of species) reg.register(sp);
  return reg;
}

function spawn(
  sim: BiologySimulation,
  species: SpeciesDefinition,
  x: number,
  y: number,
  opts: { sex?: Sex; energy?: number; health?: number } = {}
): Organism {
  return sim.spawnOrganism({
    speciesId: species.id,
    x,
    y,
    sex: opts.sex ?? 'female',
    stage: 'adult',
    energy: opts.energy ?? 0.6,
    health: opts.health ?? 1,
    genome: createIndividualGenome(
      species.genomeSchema,
      species.traitBaselines,
      species.traitRanges,
      0,
      new SeededRng('spatial-p5-genome')
    ),
  });
}

function buildWorld(seed: string, extra: Partial<BiologySimulationConfig> = {}): BiologySimulation {
  const grid = WorldGrid.generate({ width: 36, height: 24, seed: 'spatial-p5-world' });
  const sim = new BiologySimulation({
    grid,
    seed,
    speciesRegistry: registryOf(GRAZER, HUNTER, CLEANER, DIGGER),
    strictConservation: true,
    recordHistory: false,
    spatial: true,
    backgroundPreyCapacityScale: 0,
    ...extra,
  });
  sim.spawnFounderPopulation('grazer', 160);
  sim.spawnFounderPopulation('hunter', 24, { center: { x: 18, y: 12, radius: 8 } });
  sim.spawnFounderPopulation('cleaner', 20);
  sim.spawnFounderPopulation('digger', 30);
  return sim;
}

const big = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

/** Bit-exact digest of organisms, genomes, energy stores, pools, ledger, RNG and spatial state. */
function digest(sim: BiologySimulation): string {
  const h = crypto.createHash('sha256');
  h.update(`tick=${sim.tick};`);
  for (const sp of IDS) {
    const orgs = [...sim.getOrganisms(sp)].sort((a, b) => a.id - b.id);
    h.update(`${sp}:${orgs.length};`);
    for (const o of orgs) {
      h.update(
        `${o.id},${o.sex},${o.stage},${o.ageTicks},${o.x},${o.y},${o.cellIndex},${o.health},${o.energy},` +
          `${o.reproductionCooldown},${o.offspringCount},${o.generation},${o.parentAId},${o.parentBId};`
      );
      h.update(Buffer.from(o.genome.maternalAlleles.buffer));
      h.update(Buffer.from(o.genome.paternalAlleles.buffer));
      h.update(Buffer.from(o.phenotype.expressed.buffer));
      h.update(JSON.stringify(sim.getOrganismMassAndEnergy(o.id)));
      h.update(`${sim.getOrganismCarryCreditQ(o.id)};`);
      h.update(JSON.stringify(sim.getOrganismSpatialState(o.id) ?? null));
    }
    const st = sim.getStats(sp);
    h.update(`${st.birthsTotal},${st.deathsTotal},${JSON.stringify(st.deathsByCause)};`);
  }
  h.update(JSON.stringify(sim.getEnergyAudit(), big));
  h.update(JSON.stringify(sim.energyView.totals(), big));
  h.update(`${sim.ledger.globalAbioticMassQ},${sim.ledger.sunEnergyInQ},${sim.ledger.heatEnergyOutQ};`);
  h.update(JSON.stringify(sim.streams.snapshotStates()));
  if (sim.spatial) {
    const { pathRequests: _p, pathNodesExpanded: _n, ...behavioral } = sim.spatial.stats;
    h.update(JSON.stringify(behavioral));
  }
  return h.digest('hex');
}

/** I1-I5: zero residuals, synchronized stores, no open transaction, exact 3 / 3 / 5 / 30 EU/MU. */
function assertInvariants(sim: BiologySimulation, label: string): void {
  const audit = sim.assertEnergyAudit();
  assert.equal(audit.massResidualQ, 0n, `${label}: mass residual`);
  assert.equal(audit.energyResidualQ, 0n, `${label}: energy residual`);
  assert.equal(sim.ledger.activeTransaction, null, `${label}: no transaction may stay open`);
  assert.equal(sim.entityStore.isSynchronized(), true, `${label}: entity store synchronized`);
  assert.equal(sim.energyGrid.isSynchronized(), true, `${label}: energy grid synchronized`);
  sim.ledger.assertStoichiometry();
  const eg = sim.energyGrid;
  for (let c = 0; c < eg.cellCount; c++) {
    assert.equal(
      hasExactDensity(eg.getMassQ(EnergyPool.PLANT, c), eg.getEnergyQ(EnergyPool.PLANT, c), RHO_PLANT),
      true,
      `${label}: cell ${c} PLANT density`
    );
    assert.equal(
      hasExactDensity(eg.getMassQ(EnergyPool.DETRITUS, c), eg.getEnergyQ(EnergyPool.DETRITUS, c), RHO_DETRITUS),
      true,
      `${label}: cell ${c} DETRITUS density`
    );
    assert.equal(
      isValidCarrionMix(eg.getMassQ(EnergyPool.CARRION, c), eg.getEnergyQ(EnergyPool.CARRION, c)),
      true,
      `${label}: cell ${c} CARRION mix`
    );
  }
  const es = sim.entityStore;
  for (let slot = 0; slot < es.capacity; slot++) {
    assert.equal(hasExactDensity(es.structMassQ(slot), es.structEnergyQ(slot), RHO_STRUCT), true, `${label}: slot ${slot} STRUCT`);
    assert.equal(hasExactDensity(es.reserveMassQ(slot), es.reserveEnergyQ(slot), RHO_RESERVE), true, `${label}: slot ${slot} RESERVE`);
  }
}

/** The population index must describe exactly the organisms' own coordinates. */
function assertSpatialIndexExact(sim: BiologySimulation, label: string): void {
  for (const sp of IDS) {
    const expected = new Map<number, number>();
    for (const o of sim.getOrganisms(sp)) {
      assert.equal(o.alive, true, `${label}: ${sp} active list holds only the living`);
      assert.equal(o.cellIndex, o.y * sim.grid.width + o.x, `${label}: ${sp}#${o.id} coordinates agree`);
      expected.set(o.cellIndex, (expected.get(o.cellIndex) ?? 0) + 1);
    }
    let total = 0;
    for (let c = 0; c < sim.grid.cellCount; c++) {
      const n = sim.getCellPopulationCount(sp, c);
      assert.equal(n, expected.get(c) ?? 0, `${label}: ${sp} index count in cell ${c}`);
      total += n;
    }
    assert.equal(total, sim.getOrganisms(sp).length, `${label}: ${sp} index total`);
  }
}

function totalPool(sim: BiologySimulation, pool: number): number {
  let sum = 0;
  for (let c = 0; c < sim.energyGrid.cellCount; c++) sum += sim.energyGrid.getMassQ(pool as never, c);
  return sum;
}

// -------------------------------------------------------------------------------------------------
// COMMIT boundary and POST_COMMIT semantics with spatial behavior
// -------------------------------------------------------------------------------------------------

test('Spatial x P5: a fault on the COMMIT boundary aborts the prepared transaction and leaves spatial state untouched', () => {
  let armed = false;
  const sim = buildWorld('commit-boundary', {
    onPhase: ({ phase, tx }) => {
      if (armed && phase === 'COMMIT') {
        assert.equal(tx?.state, 'PREPARED', 'the COMMIT hook must observe a prepared, not yet durable transaction');
        throw new Error('Injected COMMIT boundary fault');
      }
    },
  });
  const control = buildWorld('commit-boundary');
  sim.stepMany(15);
  control.stepMany(15);
  assert.ok(sim.spatial!.stats.moves > 0);

  const before = digest(sim);
  const abortedBefore = sim.ledger.abortedTxCount;
  const committedBefore = sim.ledger.committedTxCount;
  armed = true;
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.throws(() => sim.step(), /Injected COMMIT boundary fault/);
    assert.equal(sim.ledger.activeTransaction, null, 'the transaction must never stay PREPARED');
    assert.equal(sim.ledger.abortedTxCount, abortedBefore + attempt);
    assert.equal(sim.ledger.committedTxCount, committedBefore);
    assert.equal(sim.tick, 15);
    assert.equal(digest(sim), before, 'energy, RNG, coordinates and behavior state must be bit-identical');
    assertSpatialIndexExact(sim, `commit fault attempt ${attempt}`);
  }
  assertInvariants(sim, 'after COMMIT boundary faults');

  armed = false;
  sim.stepMany(10);
  control.stepMany(10);
  assert.equal(digest(sim), digest(control), 'the world must continue exactly like a fault-free twin');
});

test('Spatial x P5: a POST_COMMIT fault keeps the committed tick, the applied movement and the RNG position', () => {
  for (const mode of ['phase-hook', 'death-listener'] as const) {
    let armed = false;
    let hookFaults = 0;
    const sim = buildWorld('post-commit', {
      onPhase: ({ phase }) => {
        if (mode === 'phase-hook' && armed && phase === 'POST_COMMIT') {
          hookFaults++;
          throw new Error('Injected POST_COMMIT fault');
        }
      },
    });
    const control = buildWorld('post-commit');
    if (mode === 'death-listener') {
      sim.onDeath(() => {
        if (armed) throw new Error('Listener failure');
      });
    }
    sim.stepMany(20);
    control.stepMany(20);

    armed = true;
    let faultedTicks = 0;
    for (let i = 0; i < 6; i++) {
      const rngBefore = JSON.stringify(sim.streams.snapshotStates());
      const committedBefore = sim.ledger.committedTxCount;
      const movesBefore = sim.spatial!.stats.moves;
      if (mode === 'phase-hook') {
        assert.throws(() => sim.step(), /Injected POST_COMMIT fault/);
        faultedTicks++;
      } else {
        sim.step(); // listener errors are isolated and never surface
      }
      control.step();
      assert.equal(sim.tick, control.tick, `${mode}: the tick stays committed`);
      assert.equal(sim.ledger.committedTxCount, committedBefore + 1, `${mode}: exactly one commit, never re-applied`);
      assert.equal(sim.ledger.activeTransaction, null);
      assert.notEqual(JSON.stringify(sim.streams.snapshotStates()), rngBefore, `${mode}: RNG must not be rewound`);
      assert.ok(sim.spatial!.stats.moves > movesBefore, `${mode}: the staged movement was applied with the commit`);
      assert.equal(digest(sim), digest(control), `${mode}: committed state equals the fault-free twin`);
      assertSpatialIndexExact(sim, `${mode} tick ${sim.tick}`);
    }
    if (mode === 'phase-hook') assert.equal(hookFaults, faultedTicks);
    else assert.ok(sim.getTotalDeathListenerErrors() > 0, 'the listener must really have failed');
    assertInvariants(sim, `${mode} after POST_COMMIT faults`);

    armed = false;
    sim.stepMany(10);
    control.stepMany(10);
    assert.equal(digest(sim), digest(control), `${mode}: later ticks stay bit-identical`);
  }
});

test('Spatial x P5: consecutive faults in every phase are lossless and recovery is bit-identical to control', () => {
  const phases: BiologyStepPhase[] = ['GATHER', 'RESOLVE', 'PRE_ALLOCATE', 'PREPARE', 'COMMIT'];
  let faultPhase: BiologyStepPhase | null = null;
  const sim = buildWorld('multi-fault', {
    onPhase: ({ phase }) => {
      if (phase === faultPhase) throw new Error(`Injected fault at ${phase}`);
    },
  });
  const control = buildWorld('multi-fault');

  let injected = 0;
  for (let round = 0; round < 8; round++) {
    sim.stepMany(5);
    control.stepMany(5);
    const before = digest(sim);
    const committedBefore = sim.ledger.committedTxCount;
    for (const phase of phases) {
      faultPhase = phase;
      assert.throws(() => sim.step(), new RegExp(`Injected fault at ${phase}`));
      injected++;
      assert.equal(sim.ledger.activeTransaction, null, `${phase}: no PREPARED/ACTIVE transaction may remain`);
      assert.equal(sim.ledger.committedTxCount, committedBefore, `${phase}: nothing committed`);
      assert.equal(digest(sim), before, `round ${round} ${phase}: state must be bit-identical after ABORT`);
    }
    faultPhase = null;
    assert.equal(digest(sim), digest(control), `round ${round}: still equal to control`);
  }
  assert.equal(injected, 40);
  assertInvariants(sim, 'after 40 aborted ticks');
  assertSpatialIndexExact(sim, 'after 40 aborted ticks');
  const births = IDS.reduce((s, sp) => s + sim.getStats(sp).birthsTotal, 0);
  const deaths = IDS.reduce((s, sp) => s + sim.getStats(sp).deathsTotal, 0);
  assert.ok(births > 0 && deaths > 0, 'aborted ticks must have contained births and deaths as well as movement');
  assert.ok(sim.spatial!.stats.huntAttempts > 0);
});

// -------------------------------------------------------------------------------------------------
// Interactions inside one biological tick
// -------------------------------------------------------------------------------------------------

test('Spatial x P5: feeding, movement, hunting, flight, reproduction and death share one exact transaction per tick', () => {
  const sim = buildWorld('one-tick');
  const kills: OrganismDeathEvent[] = [];
  const deathsAt = new Map<number, OrganismDeathEvent[]>();
  sim.onDeath((ev) => {
    if (ev.cause === 'predation') kills.push(ev);
    let list = deathsAt.get(ev.tick);
    if (!list) deathsAt.set(ev.tick, (list = []));
    list.push(ev);
  });

  let fedAndMoved = 0;
  let movedAndPaid = 0;
  let killerGained = 0;
  let fleeingMoved = 0;
  let bornWithSpatialState = 0;
  let inheritedGenomes = 0;
  let ticksWithEverything = 0;
  const prev = new Map<number, { cell: number; reserve: number; behavior: number }>();

  for (let t = 0; t < 140; t++) {
    prev.clear();
    for (const sp of IDS) {
      for (const o of sim.getOrganisms(sp)) {
        prev.set(o.id, {
          cell: o.cellIndex,
          reserve: sim.getOrganismMassAndEnergy(o.id)!.reserveMassQ,
          behavior: sim.getOrganismSpatialState(o.id)!.behavior,
        });
      }
    }
    const heatBefore = sim.ledger.heatEnergyOutQ;
    const committedBefore = sim.ledger.committedTxCount;
    const movesBefore = sim.spatial!.stats.moves;
    const locoBefore = sim.spatial!.stats.locomotionEnergyQ;
    const birthsBefore = IDS.reduce((s, sp) => s + sim.getStats(sp).birthsTotal, 0);
    sim.step();
    assert.equal(sim.ledger.committedTxCount, committedBefore + 1, 'one energy transaction per tick');

    let tickFed = false;
    let tickBirth = false;
    for (const sp of IDS) {
      for (const o of sim.getOrganisms(sp)) {
        const was = prev.get(o.id);
        const now = sim.getOrganismMassAndEnergy(o.id)!;
        if (!was) {
          // Born this tick: an egg with parents, a slot in the energy store and spatial state
          assert.equal(o.stage, 'egg');
          assert.equal(o.birthTick, sim.tick);
          const mother = sim.getOrganismById(sp, o.parentAId!);
          assert.ok(o.parentAId !== null && o.parentBId !== null, 'offspring must have two parents');
          assert.ok(now.structMassQ > 0, 'the egg is provisioned through the ledger');
          const st = sim.getOrganismSpatialState(o.id);
          assert.ok(st, 'newborn must have spatial state');
          assert.equal(st.natalCell, o.cellIndex);
          bornWithSpatialState++;
          tickBirth = true;
          if (mother) {
            assert.equal(o.generation > mother.generation || o.generation >= 1, true);
            assert.equal(o.genome.maternalAlleles.length, mother.genome.maternalAlleles.length);
            inheritedGenomes++;
          }
          continue;
        }
        const moved = was.cell !== o.cellIndex;
        if (moved) {
          const dx = Math.abs((was.cell % sim.grid.width) - o.x);
          const dy = Math.abs(((was.cell / sim.grid.width) | 0) - o.y);
          assert.ok(Math.max(dx, dy) <= sim.spatial!.maxStepsPerTick, 'no teleporting');
          if (now.reserveMassQ > was.reserve) {
            fedAndMoved++;
            tickFed = true;
          }
          if (now.reserveMassQ < was.reserve) movedAndPaid++;
          if (was.behavior === BEHAVIOR_FLEE || sim.getOrganismSpatialState(o.id)!.behavior === BEHAVIOR_FLEE) fleeingMoved++;
        }
      }
    }
    let tickKill = false;
    for (const ev of deathsAt.get(sim.tick) ?? []) {
      if (ev.cause !== 'predation') continue;
      tickKill = true;
      const was = prev.get(ev.killerId!);
      const killer = sim.getOrganismById('hunter', ev.killerId!);
      if (was && killer && killer.alive && sim.getOrganismMassAndEnergy(killer.id)!.reserveMassQ > was.reserve) {
        killerGained++;
      }
    }
    const moved = sim.spatial!.stats.moves - movesBefore;
    if (sim.spatial!.stats.locomotionEnergyQ > locoBefore) {
      assert.ok(sim.ledger.heatEnergyOutQ > heatBefore, 'locomotion energy must leave as heat through the ledger');
    }
    const births = IDS.reduce((s, sp) => s + sim.getStats(sp).birthsTotal, 0) - birthsBefore;
    assert.equal(births > 0, tickBirth);
    if (moved > 0 && tickFed && tickKill && births > 0) ticksWithEverything++;
    if (t % 10 === 9) {
      assertInvariants(sim, `tick ${sim.tick}`);
      assertSpatialIndexExact(sim, `tick ${sim.tick}`);
    }
  }

  assert.ok(fedAndMoved > 200, `organisms must eat and move in the same tick (${fedAndMoved})`);
  assert.ok(movedAndPaid > 200, `movement must cost reserve energy (${movedAndPaid})`);
  assert.ok(kills.length > 5, `predators must kill live prey (${kills.length})`);
  assert.ok(kills.every((k) => k.killerId !== null));
  assert.ok(killerGained > 0, 'a successful hunter must gain reserve from its kill');
  const s = sim.spatial!.stats;
  assert.ok(s.huntAttempts > s.huntSuccesses && s.huntSuccesses > 0, 'hunts both succeed and fail');
  assert.ok(fleeingMoved > 0, 'prey must flee by actually moving');
  assert.ok(bornWithSpatialState > 20 && inheritedGenomes > 20, 'reproduction must work in spatial mode');
  assert.ok(ticksWithEverything > 0, 'some tick must combine movement, feeding, a kill and a birth');
  assertInvariants(sim, 'end');
});

test('Spatial x P5: starvation, death and decomposition stay conservative while organisms move', () => {
  // Barren desert: nothing grows, so every grazer wanders, starves or dehydrates, and decomposes
  const grid = makeFlatGrid(20, 14, 'barren', { moisture: 0.05 });
  const sim = new BiologySimulation({
    grid,
    seed: 'barren-sim',
    speciesRegistry: registryOf(GRAZER, DIGGER),
    strictConservation: true,
    recordHistory: false,
    spatial: true,
    backgroundPreyCapacityScale: 0,
    plantCarryingCapacityScale: 0,
  });
  const founders: Organism[] = [];
  for (let i = 0; i < 30; i++) {
    founders.push(spawn(sim, GRAZER, 4 + (i % 12), 3 + ((i / 12) | 0) * 3, { sex: i % 2 ? 'male' : 'female', energy: 0.35 }));
  }
  const startCells = new Map(founders.map((o) => [o.id, o.cellIndex]));
  const massBefore = sim.getEnergyAudit().actualMassQ;
  const deaths: OrganismDeathEvent[] = [];
  sim.onDeath((ev) => deaths.push(ev));

  let movedBeforeDeath = 0;
  let peakCarrion = 0;
  const abioticStart = sim.ledger.globalAbioticMassQ;
  const heatStart = sim.ledger.heatEnergyOutQ;
  const seenMoved = new Set<number>();
  let ticksAfterExtinction = 0;
  for (let t = 0; t < 600 && ticksAfterExtinction < 40; t++) {
    sim.step();
    if (sim.getOrganisms('grazer').length === 0) ticksAfterExtinction++;
    for (const o of sim.getOrganisms('grazer')) {
      if (o.cellIndex !== startCells.get(o.id)) seenMoved.add(o.id);
    }
    const carrion = totalPool(sim, EnergyPool.CARRION);
    if (carrion > peakCarrion) peakCarrion = carrion;
    if (t % 20 === 0) assertInvariants(sim, `barren tick ${sim.tick}`);
  }
  for (const ev of deaths) if (seenMoved.has(ev.organismId)) movedBeforeDeath++;

  assert.equal(sim.getOrganisms('grazer').length, 0, 'nobody can survive without food');
  assert.equal(deaths.length, 30);
  assert.ok(
    deaths.every((d) => d.cause === 'starvation' || d.cause === 'dehydration'),
    `unexpected causes: ${[...new Set(deaths.map((d) => d.cause))].join(', ')}`
  );
  assert.ok(movedBeforeDeath >= 15, `starving animals must have searched on foot (${movedBeforeDeath})`);
  assert.ok(peakCarrion > 0, 'bodies must become carrion');
  // Decomposition returns the bodies' matter to the abiotic pool and their energy to heat
  assert.ok(totalPool(sim, EnergyPool.CARRION) < peakCarrion / 10, 'carrion must decompose after the deaths');
  assert.ok(sim.ledger.globalAbioticMassQ > abioticStart, 'decomposed matter returns to the abiotic pool');
  assert.ok(sim.ledger.heatEnergyOutQ > heatStart);
  assert.equal(sim.getEnergyAudit().actualMassQ, massBefore, 'total mass is conserved through death and decay');
  assertInvariants(sim, 'barren end');
});

// -------------------------------------------------------------------------------------------------
// Mode compatibility
// -------------------------------------------------------------------------------------------------

test('Spatial x P5: spatial stays opt-in and the non-spatial mode is unaffected by its presence', () => {
  const grid = WorldGrid.generate({ width: 24, height: 16, seed: 'mode-compat' });
  const run = (spatial: BiologySimulationConfig['spatial'] | 'omit') => {
    const sim = new BiologySimulation({
      grid,
      seed: 'mode-compat-sim',
      speciesRegistry: registryOf(GRAZER, HUNTER, CLEANER, DIGGER),
      strictConservation: true,
      ...(spatial === 'omit' ? {} : { spatial }),
    });
    for (const [sp, n] of [['grazer', 120], ['hunter', 12], ['cleaner', 12], ['digger', 20]] as const) {
      sim.spawnFounderPopulation(sp, n);
    }
    return sim;
  };
  const omitted = run('omit');
  const disabled = run(false);
  const enabled = run(true);
  assert.equal(omitted.spatial, null, 'spatial behavior must be off by default');
  assert.equal(disabled.spatial, null);
  assert.ok(enabled.spatial);

  const startCells = new Map<number, number>();
  for (const sp of IDS) for (const o of omitted.getOrganisms(sp)) startCells.set(o.id, o.cellIndex);
  omitted.stepMany(60);
  disabled.stepMany(60);
  enabled.stepMany(60);
  assert.equal(digest(omitted), digest(disabled), 'spatial:false equals the default configuration bit-for-bit');
  assert.notEqual(digest(omitted), digest(enabled));
  for (const sp of IDS) {
    for (const o of omitted.getOrganisms(sp)) {
      if (startCells.has(o.id)) assert.equal(o.cellIndex, startCells.get(o.id), 'nobody moves without spatial behavior');
      assert.equal(omitted.getOrganismSpatialState(o.id), undefined);
    }
  }
  assert.ok(enabled.spatial.stats.moves > 0);
  assertInvariants(omitted, 'non-spatial');
  assertInvariants(enabled, 'spatial');

  // Documented restrictions of the spatial mode
  const reg = registryOf(GRAZER);
  assert.throws(() => new BiologySimulation({ grid, seed: 's', speciesRegistry: reg, strictConservation: true, spatial: true, wrapX: true }), /wrapX/);
  assert.throws(() => new BiologySimulation({ grid, seed: 's', speciesRegistry: reg, strictConservation: false, spatial: true }), /strict/);
});

// -------------------------------------------------------------------------------------------------
// Long run
// -------------------------------------------------------------------------------------------------

test('Spatial x P5: 1000-tick multi-species spatial run keeps exact energetics, determinism and bounded memory', () => {
  const build = (): BiologySimulation => {
    const grid = WorldGrid.generate({ width: 72, height: 48, seed: 'living-world-long' });
    const world = new BiologySimulation({
      grid,
      seed: 'long-1000',
      speciesRegistry: registryOf(GRAZER, HUNTER, CLEANER, DIGGER),
      strictConservation: true,
      recordHistory: false,
      spatial: true,
      backgroundPreyCapacityScale: 0,
      statsInterval: 1_000_000,
    });
    world.spawnFounderPopulation('grazer', 500);
    world.spawnFounderPopulation('hunter', 60, { center: { x: 22, y: 20, radius: 7 } });
    world.spawnFounderPopulation('cleaner', 40, { center: { x: 22, y: 20, radius: 7 } });
    world.spawnFounderPopulation('digger', 100, { center: { x: 30, y: 22, radius: 9 } });
    return world;
  };
  const sim = build();
  const twin = build();
  const massStart = sim.getEnergyAudit().actualMassQ;

  let peakPopulation = 0;
  let capacityAt500 = 0;
  for (let tick = 1; tick <= 1000; tick++) {
    sim.step();
    if (tick % 50 === 0) {
      const audit = sim.assertEnergyAudit();
      assert.equal(audit.massResidualQ, 0n, `tick ${tick}: mass residual`);
      assert.equal(audit.energyResidualQ, 0n, `tick ${tick}: energy residual`);
      assert.equal(audit.actualMassQ, massStart, `tick ${tick}: closed-world mass is constant`);
      peakPopulation = Math.max(peakPopulation, IDS.reduce((s, sp) => s + sim.getOrganisms(sp).length, 0));
    }
    if (tick % 250 === 0) {
      assertInvariants(sim, `tick ${tick}`);
      assertSpatialIndexExact(sim, `tick ${tick}`);
      twin.stepMany(tick - twin.tick);
      assert.equal(digest(sim), digest(twin), `tick ${tick}: bit-identical to the same-seed twin`);
    }
    if (tick === 500) capacityAt500 = sim.entityStore.capacity;
  }

  const s = sim.spatial!.stats;
  assert.equal(s.ticks, 1000);
  assert.ok(s.moves > 100_000, `moves: ${s.moves}`);
  assert.ok(s.huntSuccesses > 100 && s.huntAttempts > s.huntSuccesses, `hunts: ${s.huntSuccesses}/${s.huntAttempts}`);
  assert.ok(s.migrationsStarted > 100, `migrations: ${s.migrationsStarted}`);
  assert.ok(s.drinks > 1000);
  for (const sp of IDS) {
    assert.ok(sim.getStats(sp).birthsTotal > 0, `${sp} reproduced`);
    assert.ok(sim.getStats(sp).deathsTotal > 0, `${sp} experienced mortality`);
  }
  assert.ok(sim.getOrganisms('grazer').length > 0 && sim.getOrganisms('hunter').length > 0, 'interacting species persist');
  assert.ok(sim.getStats('grazer').maxGeneration >= 10, 'many generations passed');
  // Slots of the dead are recycled: storage tracks the peak population, not the cumulative births
  const totalBirths = IDS.reduce((sum, sp) => sum + sim.getStats(sp).birthsTotal, 0);
  assert.ok(totalBirths > 4 * peakPopulation, 'turnover must far exceed the standing population');
  assert.ok(
    sim.entityStore.capacity <= Math.max(capacityAt500, 4 * (sim.grid.cellCount + peakPopulation)),
    `entity storage must stay bounded (capacity ${sim.entityStore.capacity}, peak population ${peakPopulation})`
  );
  assert.equal(sim.ledger.committedTxCount, twin.ledger.committedTxCount);
});
