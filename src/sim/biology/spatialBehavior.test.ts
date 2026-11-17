import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { SeededRng } from '../prng';
import { EnergyPool } from '../worldEnergyGrid';
import { WorldCellPatch, WorldGrid } from '../worldGrid';
import { BiologySimulation, BiologySimulationConfig, BiologyStepPhase } from './biologySimulation';
import { createIndividualGenome } from './genome';
import { Organism, OrganismDeathEvent, Sex } from './organism';
import { RAPTOR_SPECIES, SpeciesDefinition, SpeciesRegistry } from './species';
import { BEHAVIOR_FLEE, BEHAVIOR_HUNT, BEHAVIOR_MIGRATE, SpatialBehaviorConfig } from './spatialBehavior';
import { SpatialSpeciesProfile } from './spatialProfile';
import { TrophicDietWeights, TrophicProfile, deriveDefaultTrophicProfile } from './trophicProfile';

// =================================================================================================
// Test world & species helpers
// =================================================================================================

/** Uniform warm, moist lowland savanna; tests then reshape regions with `paint`. */
function makeFlatGrid(width: number, height: number, seed: string, patch: WorldCellPatch = {}): WorldGrid {
  const grid = WorldGrid.generate({ width, height, seed });
  for (let i = 0; i < grid.cellCount; i++) {
    grid.setCellByIndex(i, { elevation: 0.5, temperature: 24, moisture: 0.56, ...patch });
  }
  return grid;
}

function paint(grid: WorldGrid, x0: number, y0: number, x1: number, y1: number, patch: WorldCellPatch): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      assert.equal(grid.setCell(x, y, patch), true);
    }
  }
}

const DESERT: WorldCellPatch = { moisture: 0.1 };
const WATER: WorldCellPatch = { terrain: 'deep-water' };
const PEAK: WorldCellPatch = { terrain: 'peak' };

interface SpeciesOptions {
  bodySize?: number;
  speed?: number;
  dietWeights?: TrophicDietWeights;
  trophic?: Partial<TrophicProfile>;
  physiology?: Partial<SpeciesDefinition['physiology']>;
  spatial?: Partial<SpatialSpeciesProfile>;
}

/** Species built on the Raptor genome with its own diet, body plan and (optionally) trophic tuning. */
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
    spatial: opts.spatial,
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
/** Pursuit predator that gorges on its kills and has a slow metabolism between meals. */
const HUNTER = makeSpecies('hunter', 'carnivore', {
  bodySize: 1.0,
  speed: 1.4,
  dietWeights: { plant: 0, prey: 0.5, carrion: 0.5, detritus: 0 },
  trophic: { basalMetabolicFactor: 0.16, activityCostFactor: 0.045, thermoregulationFactor: 0.07 },
  physiology: { maxForageIntakePerTick: 0.4 },
});
const CLEANER = makeSpecies('cleaner', 'scavenger', { bodySize: 0.7, speed: 1.1 });
const DIGGER = makeSpecies('digger', 'detritivore', { bodySize: 0.5, speed: 0.8 });

function registryOf(...species: SpeciesDefinition[]): SpeciesRegistry {
  const reg = new SpeciesRegistry();
  for (const sp of species) reg.register(sp);
  return reg;
}

function baselineGenome(species: SpeciesDefinition) {
  return createIndividualGenome(
    species.genomeSchema,
    species.traitBaselines,
    species.traitRanges,
    0,
    new SeededRng('spatial-test-genome')
  );
}

function spawn(
  sim: BiologySimulation,
  species: SpeciesDefinition,
  x: number,
  y: number,
  opts: { sex?: Sex; energy?: number; health?: number; stage?: 'juvenile' | 'adult' | 'elder'; ageTicks?: number } = {}
): Organism {
  return sim.spawnOrganism({
    speciesId: species.id,
    x,
    y,
    sex: opts.sex ?? 'female',
    stage: opts.stage ?? 'adult',
    ageTicks: opts.ageTicks,
    energy: opts.energy ?? 0.6,
    health: opts.health ?? 1,
    genome: baselineGenome(species),
  });
}

function makeSim(
  grid: WorldGrid,
  seed: string,
  species: SpeciesDefinition[],
  extra: Partial<BiologySimulationConfig> = {},
  spatial: SpatialBehaviorConfig | boolean = true
): BiologySimulation {
  return new BiologySimulation({
    grid,
    seed,
    speciesRegistry: registryOf(...species),
    strictConservation: true,
    recordHistory: false,
    spatial,
    ...extra,
  });
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function assertExactEnergy(sim: BiologySimulation, label = ''): void {
  const audit = sim.assertEnergyAudit();
  assert.equal(audit.massResidualQ, 0n, `${label} mass residual must be exactly 0`);
  assert.equal(audit.energyResidualQ, 0n, `${label} energy residual must be exactly 0`);
}

/** Bit-exact fingerprint of everything the spatial biology owns: organisms, positions, behavior state, pools. */
function fingerprint(sim: BiologySimulation, speciesIds: readonly string[]): string {
  const h = crypto.createHash('sha256');
  h.update(`tick=${sim.tick};`);
  for (const sp of speciesIds) {
    const orgs = [...sim.getOrganisms(sp)].sort((a, b) => a.id - b.id);
    h.update(`${sp}:${orgs.length};`);
    for (const o of orgs) {
      h.update(
        `${o.id},${o.sex},${o.stage},${o.ageTicks},${o.x},${o.y},${o.cellIndex},${o.health},${o.energy},${o.reproductionCooldown},${o.offspringCount},${o.generation};`
      );
      h.update(Buffer.from(o.genome.maternalAlleles.buffer));
      h.update(Buffer.from(o.genome.paternalAlleles.buffer));
      h.update(JSON.stringify(sim.getOrganismMassAndEnergy(o.id)));
      h.update(JSON.stringify(sim.getOrganismSpatialState(o.id)));
    }
    const st = sim.getStats(sp);
    h.update(`${st.birthsTotal},${st.deathsTotal},${JSON.stringify(st.deathsByCause)};`);
  }
  const big = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
  h.update(JSON.stringify(sim.getEnergyAudit(), big));
  h.update(JSON.stringify(sim.energyView.totals(), big));
  h.update(JSON.stringify(sim.streams.snapshotStates()));
  if (sim.spatial) {
    const { pathRequests: _p, pathNodesExpanded: _n, ...behavioral } = sim.spatial.stats;
    h.update(JSON.stringify(behavioral));
  }
  return h.digest('hex');
}

/**
 * Steps the simulation while checking, for every organism and every tick, the physical movement
 * invariants: stays on the finite map, never teleports, never stands on terrain it cannot enter.
 */
function stepChecked(
  sim: BiologySimulation,
  speciesIds: readonly string[],
  ticks: number,
  onTick?: (tick: number) => void
): { maxStep: number; moved: number } {
  const grid = sim.grid;
  const maxSteps = sim.spatial!.maxStepsPerTick;
  const before = new Map<number, number>();
  let maxStep = 0;
  let moved = 0;
  for (let t = 0; t < ticks; t++) {
    before.clear();
    for (const sp of speciesIds) {
      for (const o of sim.getOrganisms(sp)) before.set(o.id, o.cellIndex);
    }
    sim.step();
    for (let s = 0; s < speciesIds.length; s++) {
      const sp = speciesIds[s];
      const spIdx = sim.speciesRegistry.list().findIndex((d) => d.id === sp);
      for (const o of sim.getOrganisms(sp)) {
        assert.ok(o.x >= 0 && o.x < grid.width && o.y >= 0 && o.y < grid.height, 'organism must stay on the map');
        assert.equal(o.cellIndex, o.y * grid.width + o.x, 'x / y / cellIndex must stay consistent');
        assert.ok(sim.spatial!.isHabitableCell(spIdx, o.cellIndex), `${sp} ${o.id} stands on impassable terrain`);
        const prev = before.get(o.id);
        if (prev === undefined) continue; // born this tick
        const py = Math.floor(prev / grid.width);
        const px = prev - py * grid.width;
        const step = chebyshev(px, py, o.x, o.y);
        assert.ok(step <= maxSteps, `organism ${o.id} moved ${step} cells in one tick (limit ${maxSteps})`);
        if (step > maxStep) maxStep = step;
        if (step > 0) moved++;
      }
    }
    onTick?.(sim.tick);
  }
  return { maxStep, moved };
}

// =================================================================================================
// 1. Finite map
// =================================================================================================

test('Spatial 1: organisms move on a finite map and never cross from one edge to the opposite one', () => {
  const grid = makeFlatGrid(18, 9, 'finite-map');
  paint(grid, 0, 0, 5, 8, DESERT); // poor west strip, rich east
  assert.throws(
    () => makeSim(grid, 'finite-wrap', [GRAZER], { wrapX: true }),
    /finite geography/,
    'spatial behavior must reject horizontal wrapping'
  );

  const sim = makeSim(grid, 'finite-map-sim', [GRAZER], { plantPhotosynthesisRate: 0.05 }, { hydration: { enabled: false } });
  const orgs: Organism[] = [];
  // Along the west edge and in all four corners (wrapping would put them next to the rich east edge)
  for (let y = 0; y < 9; y++) {
    orgs.push(spawn(sim, GRAZER, 0, y, { energy: 0.35, sex: y % 2 ? 'male' : 'female' }));
    orgs.push(spawn(sim, GRAZER, 1, y, { energy: 0.35, sex: y % 2 ? 'female' : 'male' }));
  }
  orgs.push(spawn(sim, GRAZER, 17, 0), spawn(sim, GRAZER, 17, 8, { sex: 'male' }));

  const seenColumns = new Map<number, Set<number>>();
  const result = stepChecked(sim, ['grazer'], 90, () => {
    for (const o of sim.getOrganisms('grazer')) {
      let cols = seenColumns.get(o.id);
      if (!cols) seenColumns.set(o.id, (cols = new Set<number>()));
      cols.add(o.x);
    }
    assertExactEnergy(sim, 'finite map');
  });

  assert.ok(result.moved > 50, 'organisms must actually move');
  assert.ok(result.maxStep <= sim.spatial!.maxStepsPerTick);
  // Founders that started on the west edge and reached the rich east walked through the middle columns
  let travellers = 0;
  for (const o of orgs.slice(0, 18)) {
    const cols = seenColumns.get(o.id);
    if (!cols) continue;
    const maxX = Math.max(...cols);
    if (maxX >= 8) {
      travellers++;
      for (let x = 2; x <= 7; x++) {
        assert.ok(cols.has(x), `organism ${o.id} reached x=${maxX} without passing column ${x}`);
      }
    }
  }
  assert.ok(travellers >= 5, `west-edge organisms must walk east across the map (got ${travellers})`);
});

// =================================================================================================
// 2. Obstacles
// =================================================================================================

test('Spatial 2: organisms route around impassable obstacles and re-route when the terrain changes', () => {
  const grid = makeFlatGrid(22, 9, 'obstacles');
  paint(grid, 0, 0, 9, 8, DESERT); // hungry side
  paint(grid, 10, 1, 10, 8, PEAK); // mountain wall with a single pass at (10, 0)
  const sim = makeSim(
    grid,
    'obstacles-sim',
    [GRAZER],
    { plantPhotosynthesisRate: 0, backgroundPreyCapacityScale: 0 },
    { hydration: { enabled: false } }
  );
  const maxSteps = sim.spatial!.maxStepsPerTick;

  for (let i = 0; i < 16; i++) {
    spawn(sim, GRAZER, 6 + (i % 3), 5 + (i % 4), { energy: 0.3, sex: i % 2 ? 'male' : 'female' });
  }

  // Every change of side must be physically explainable by a walk through the open pass:
  // (distance from the old position to the pass) + (pass to the new position) <= steps per tick.
  const crossedNorth = new Set<number>();
  const crossedSouth = new Set<number>();
  const lastPos = new Map<number, { x: number; y: number }>();
  const record = () => {
    for (const o of sim.getOrganisms('grazer')) {
      const prev = lastPos.get(o.id);
      if (prev && prev.x !== 10 && o.x !== 10 && prev.x < 10 !== o.x < 10) {
        const viaNorth = chebyshev(prev.x, prev.y, 10, 0) + chebyshev(10, 0, o.x, o.y) <= maxSteps;
        const viaSouth = chebyshev(prev.x, prev.y, 10, 8) + chebyshev(10, 8, o.x, o.y) <= maxSteps;
        assert.ok(viaNorth || viaSouth, `organism ${o.id} changed side through the wall`);
        if (viaNorth) crossedNorth.add(o.id);
        else crossedSouth.add(o.id);
      }
      if (o.x === 10) (o.y === 0 ? crossedNorth : crossedSouth).add(o.id);
      lastPos.set(o.id, { x: o.x, y: o.y });
    }
  };
  record();

  // Phase A: only the north pass exists
  stepChecked(sim, ['grazer'], 45, record);
  // Founders only: offspring hatched on the east side never had to cross
  const eastA = sim.getOrganisms('grazer').filter((o) => o.x > 10 && o.generation === 0);
  assert.ok(eastA.length >= 3, `organisms must find the way around the wall (east side: ${eastA.length})`);
  for (const o of eastA) assert.ok(crossedNorth.has(o.id), `organism ${o.id} is east without using the pass`);
  assert.equal(crossedSouth.size, 0, 'the south end of the wall is still closed');
  assert.ok(sim.spatial!.stats.pathRequests > 0, 'blocked straight lines must trigger route planning');

  // Phase B: a rockfall closes the north pass and opens a south pass (world event; biology stays read-only)
  grid.setCell(10, 0, PEAK);
  grid.setCell(10, 8, { terrain: 'lowland' });
  assert.equal(sim.spatial!.refreshNavigation(), true);
  // A second hungry group starts on the poor side
  for (let i = 0; i < 12; i++) {
    spawn(sim, GRAZER, 7 + (i % 3), 2 + (i % 4), { energy: 0.3, sex: i % 2 ? 'male' : 'female' });
  }
  const northBefore = new Set(crossedNorth);
  record();
  stepChecked(sim, ['grazer'], 60, record);
  assert.deepEqual(crossedNorth, northBefore, 'nobody may walk through the closed pass');
  assert.ok(crossedSouth.size >= 2, `the new pass must be discovered and used (got ${crossedSouth.size})`);
  assertExactEnergy(sim, 'obstacles');
});

// =================================================================================================
// 3. Local food search
// =================================================================================================

test('Spatial 3: organisms find food inside their perception range, not through global knowledge', () => {
  const grid = makeFlatGrid(30, 9, 'local-food', DESERT);
  paint(grid, 7, 3, 8, 5, { moisture: 0.56 }); // near oasis, 2-3 cells from the group
  paint(grid, 24, 3, 26, 5, { moisture: 0.56 }); // far oasis, far outside anyone's perception
  const sim = makeSim(
    grid,
    'local-food-sim',
    [GRAZER],
    { plantPhotosynthesisRate: 0, backgroundPreyCapacityScale: 0 },
    { hydration: { enabled: false } }
  );
  const w = grid.width;
  const nearCells = [7, 8].flatMap((x) => [3, 4, 5].map((y) => y * w + x));
  const farCells = [24, 25, 26].flatMap((x) => [3, 4, 5].map((y) => y * w + x));
  const plantAt = (cells: number[]) => cells.reduce((sum, c) => sum + sim.energyGrid.getMassQ(EnergyPool.PLANT, c), 0);
  const nearInitial = plantAt(nearCells);
  const farInitial = plantAt(farCells);
  assert.ok(nearInitial > 0 && farInitial > 0);

  const group: Organism[] = [];
  for (let i = 0; i < 8; i++) {
    group.push(spawn(sim, GRAZER, 4 + (i % 2), 3 + (i % 3), { energy: 0.25, sex: i % 2 ? 'male' : 'female' }));
  }

  let firstArrivalTick = -1;
  const visitedOasis = new Set<number>();
  const rememberedOasis = new Set<number>();
  stepChecked(sim, ['grazer'], 25, (tick) => {
    for (const o of group) {
      if (!o.alive) continue;
      if (nearCells.includes(o.cellIndex)) visitedOasis.add(o.id);
      const st = sim.getOrganismSpatialState(o.id)!;
      assert.ok(st.memory.length <= 6, 'memory must stay bounded');
      if (st.memory.some((m) => m.kind === 'food' && nearCells.includes(m.cell))) rememberedOasis.add(o.id);
    }
    if (firstArrivalTick === -1 && visitedOasis.size > 0) {
      firstArrivalTick = tick;
      assert.equal(plantAt(farCells), farInitial, 'the unseen far oasis must be untouched');
    }
  });

  assert.ok(firstArrivalTick > 0 && firstArrivalTick <= 12, `the near oasis must be reached quickly (tick ${firstArrivalTick})`);
  assert.ok(plantAt(nearCells) < nearInitial, 'the near oasis must have been grazed');
  assert.equal(plantAt(farCells), farInitial, 'nobody could know about the far oasis');
  assert.ok(visitedOasis.size >= 6, `most of the group must find the near oasis (got ${visitedOasis.size})`);
  // They learned where food is: it entered their individual, bounded memory
  assert.ok(rememberedOasis.size >= 6, `organisms must remember the oasis (got ${rememberedOasis.size})`);
  assertExactEnergy(sim, 'local food');
});

// =================================================================================================
// 6. Starvation without reachable food
// =================================================================================================

test('Spatial 6: organisms starve when the only food they can see is unreachable', () => {
  const grid = makeFlatGrid(16, 7, 'island');
  paint(grid, 0, 0, 4, 6, DESERT); // barren island
  paint(grid, 5, 0, 6, 6, WATER); // strait
  const sim = makeSim(
    grid,
    'island-sim',
    [GRAZER],
    { plantPhotosynthesisRate: 0, backgroundPreyCapacityScale: 0 },
    { hydration: { enabled: false } }
  );
  const w = grid.width;
  const mainland: number[] = [];
  for (let y = 0; y < 7; y++) for (let x = 7; x < 16; x++) mainland.push(y * w + x);
  const mainlandPlants = () => mainland.reduce((s, c) => s + sim.energyGrid.getMassQ(EnergyPool.PLANT, c), 0);
  const initialMainland = mainlandPlants();
  assert.ok(initialMainland > 0, 'the mainland is full of food');

  for (let i = 0; i < 10; i++) {
    spawn(sim, GRAZER, 3 + (i % 2), 1 + (i % 5), { energy: 0.45, sex: i % 2 ? 'male' : 'female', ageTicks: 40 });
  }
  const deaths: OrganismDeathEvent[] = [];
  sim.onDeath((ev) => deaths.push(ev));

  let ticks = 0;
  while (sim.getOrganisms('grazer').some((o) => o.stage !== 'egg') && ticks < 260) {
    stepChecked(sim, ['grazer'], 1, () => {
      for (const o of sim.getOrganisms('grazer')) {
        assert.ok(o.x <= 4, `organism ${o.id} left the island (x=${o.x})`);
        const st = sim.getOrganismSpatialState(o.id)!;
        if (st.goalCell >= 0) assert.ok(st.goalCell % w <= 4, 'an unreachable cell must never become a goal');
        for (const m of st.memory) {
          if (m.kind === 'food') assert.ok(m.cell % w <= 4, 'unreachable food is not worth remembering');
        }
      }
    });
    ticks++;
  }

  const founders = deaths.filter((d) => d.organismId <= 10);
  assert.equal(founders.length, 10, 'every stranded founder must die');
  for (const d of founders) {
    assert.equal(d.cause, 'starvation', `organism ${d.organismId} died of ${d.cause}`);
    assert.ok(d.x <= 4);
  }
  assert.equal(mainlandPlants(), initialMainland, 'food across the water must remain untouched');
  assertExactEnergy(sim, 'island');
});

// =================================================================================================
// 4. Predator and prey: real pursuit
// =================================================================================================

test('Spatial 4: predators detect, pursue and strike prey only at close range; prey notices and flees', () => {
  const grid = makeFlatGrid(34, 13, 'pursuit');
  paint(grid, 24, 0, 25, 12, WATER); // a second herd lives beyond a strait, out of reach
  const sim = makeSim(
    grid,
    'pursuit-sim',
    [GRAZER, HUNTER],
    { backgroundPreyCapacityScale: 0 },
    { hydration: { enabled: false } }
  );
  const hunter = spawn(sim, HUNTER, 4, 6, { sex: 'male', energy: 0.3 });
  const herd: Organism[] = [];
  for (let i = 0; i < 8; i++) {
    herd.push(spawn(sim, GRAZER, 8 + (i % 4), 5 + (i % 3), { energy: 0.7, sex: i % 2 ? 'male' : 'female' }));
  }
  const farHerd: Organism[] = [];
  for (let i = 0; i < 6; i++) {
    farHerd.push(spawn(sim, GRAZER, 28 + (i % 3), 5 + (i % 2), { energy: 0.7, sex: i % 2 ? 'male' : 'female' }));
  }

  const positions = new Map<number, { x: number; y: number }>();
  const snapshotPositions = () => {
    positions.clear();
    for (const sp of ['grazer', 'hunter']) {
      for (const o of sim.getOrganisms(sp)) positions.set(o.id, { x: o.x, y: o.y });
    }
  };
  const predationDeaths: OrganismDeathEvent[] = [];
  sim.onDeath((ev) => {
    if (ev.cause !== 'predation') return;
    predationDeaths.push(ev);
    // The killer must have been in the same or an adjacent cell when the tick started
    assert.notEqual(ev.killerId, null);
    const killer = positions.get(ev.killerId!);
    const victim = positions.get(ev.organismId);
    assert.ok(killer && victim, 'killer and victim must both have existed before the tick');
    assert.ok(
      chebyshev(killer.x, killer.y, victim.x, victim.y) <= 1,
      `kill at distance ${chebyshev(killer.x, killer.y, victim.x, victim.y)} is impossible`
    );
  });

  let sawHunt = false;
  let sawFlee = false;
  let closingTicks = 0;
  let pursuedId = 0;
  let lastDistance = Infinity;
  for (let t = 0; t < 60; t++) {
    snapshotPositions();
    stepChecked(sim, ['grazer', 'hunter'], 1);
    if (!hunter.alive) break;
    const hs = sim.getOrganismSpatialState(hunter.id)!;
    if (hs.behavior === BEHAVIOR_HUNT && hs.targetId > 0) {
      sawHunt = true;
      const target = sim.getOrganismById('grazer', hs.targetId);
      assert.ok(target, 'a pursued target must be a real living prey organism');
      const d = chebyshev(hunter.x, hunter.y, target.x, target.y);
      assert.ok(d <= sim.spatial!.maxPerceptionRadius + sim.spatial!.maxStepsPerTick, 'targets must be within sensing range');
      if (hs.targetId === pursuedId && d < lastDistance) closingTicks++;
      pursuedId = hs.targetId;
      lastDistance = d;
    }
    for (const o of herd) {
      if (o.alive && sim.getOrganismSpatialState(o.id)!.behavior === BEHAVIOR_FLEE) sawFlee = true;
    }
    assertExactEnergy(sim, 'pursuit');
  }

  assert.ok(sawHunt, 'the hungry predator must start hunting prey it perceives');
  assert.ok(closingTicks >= 2, 'pursuit must close the distance over consecutive ticks');
  assert.ok(sawFlee, 'prey must react to a hunting predator by fleeing');
  assert.ok(sim.spatial!.stats.huntAttempts > 0, 'the chase must lead to at least one strike');
  // Nothing beyond the water could be hunted, however hungry the predator is
  for (const o of farHerd) {
    assert.ok(!predationDeaths.some((d) => d.organismId === o.id), 'prey across the strait must be safe');
    if (o.alive) assert.ok(o.x >= 26);
  }
  for (const d of predationDeaths) assert.ok(d.x < 24, 'kills only happen where the predator can go');
});

// =================================================================================================
// 5. Successful and failed hunts
// =================================================================================================

test('Spatial 5: hunts can succeed or fail depending on speed, size and condition; both cost energy', () => {
  // --- (a) fast, healthy prey: attempts fail and the predator pays for them -----------------
  const swift = makeSpecies('swift', 'herbivore', { bodySize: 0.9, speed: 2.2 });
  const slowHunter = makeSpecies('hunter', 'carnivore', {
    bodySize: 0.7,
    speed: 0.8,
    dietWeights: { plant: 0, prey: 0.5, carrion: 0.5, detritus: 0 },
    trophic: { basalMetabolicFactor: 0.16, activityCostFactor: 0.045, thermoregulationFactor: 0.07 },
  });
  // A small island: the herd cannot simply run out of the predator's reach
  const gridA = makeFlatGrid(11, 11, 'hunt-fail', WATER);
  paint(gridA, 3, 3, 7, 7, { terrain: 'lowland' });
  const simA = makeSim(gridA, 'hunt-fail-sim', [swift, slowHunter], { backgroundPreyCapacityScale: 0 }, {
    hydration: { enabled: false },
  });
  const predA = spawn(simA, slowHunter, 5, 5, { sex: 'male', energy: 0.5 });
  const herdA: Organism[] = [];
  for (let i = 0; i < 8; i++) {
    herdA.push(spawn(simA, swift, 4 + (i % 3), 4 + (i % 2) * 2, { energy: 0.9, sex: i % 2 ? 'male' : 'female' }));
  }
  const energyBefore = simA.getOrganismMassAndEnergy(predA.id)!.reserveEnergyQ;
  const killsA: OrganismDeathEvent[] = [];
  simA.onDeath((ev) => {
    if (ev.cause === 'predation') killsA.push(ev);
  });
  stepChecked(simA, ['swift', 'hunter'], 30, () => assertExactEnergy(simA, 'failed hunts'));
  const statsA = simA.spatial!.stats;
  const failuresA = statsA.huntAttempts - statsA.huntSuccesses;
  assert.ok(statsA.huntAttempts >= 6, `the predator must keep trying (attempts: ${statsA.huntAttempts})`);
  assert.ok(
    failuresA >= 5 && failuresA > statsA.huntSuccesses * 2,
    `strikes against fast healthy prey must mostly fail (${statsA.huntSuccesses}/${statsA.huntAttempts})`
  );
  // A failed strike never removes the prey: only landed, lethal bites kill
  assert.ok(killsA.length <= statsA.huntSuccesses);
  assert.equal(herdA.filter((o) => o.alive).length, herdA.length - killsA.filter((k) => k.organismId <= 9).length);
  assert.ok(herdA.filter((o) => o.alive).length >= 5, 'most of the swift herd must survive the attempts');
  assert.ok(predA.alive);
  assert.ok(
    simA.getOrganismMassAndEnergy(predA.id)!.reserveEnergyQ < energyBefore,
    'failed hunting must cost the predator energy'
  );
  assert.ok(statsA.locomotionEnergyQ > 0);

  // --- (b) slow, weakened prey: the same kind of strike succeeds and feeds the predator -------
  const sluggish = makeSpecies('sluggish', 'herbivore', { bodySize: 0.5, speed: 0.55 });
  const gridB = makeFlatGrid(20, 12, 'hunt-ok');
  const simB = makeSim(gridB, 'hunt-ok-sim', [sluggish, HUNTER], { backgroundPreyCapacityScale: 0 }, {
    hydration: { enabled: false },
  });
  const predB = spawn(simB, HUNTER, 9, 6, { sex: 'male', energy: 0.35 });
  for (let i = 0; i < 8; i++) {
    spawn(simB, sluggish, 10 + (i % 3), 5 + (i % 3), { energy: 0.9, health: 0.45, sex: i % 2 ? 'male' : 'female' });
  }
  const kills: OrganismDeathEvent[] = [];
  simB.onDeath((ev) => {
    if (ev.cause === 'predation') kills.push(ev);
  });
  let fedAfterKill = false;
  let reserveBeforeTick = simB.getOrganismMassAndEnergy(predB.id)!.reserveEnergyQ;
  stepChecked(simB, ['sluggish', 'hunter'], 30, () => {
    assertExactEnergy(simB, 'successful hunts');
    if (!predB.alive) return;
    const reserveNow = simB.getOrganismMassAndEnergy(predB.id)!.reserveEnergyQ;
    if (kills.length > 0 && reserveNow > reserveBeforeTick) fedAfterKill = true;
    reserveBeforeTick = reserveNow;
  });
  const statsB = simB.spatial!.stats;
  assert.ok(kills.length >= 1, `weak slow prey must be caught (attempts ${statsB.huntAttempts}, ok ${statsB.huntSuccesses})`);
  assert.ok(statsB.huntSuccesses >= kills.length);
  for (const k of kills) assert.equal(k.killerId, predB.id, 'the kill is attributed to the predator that struck');
  assert.ok(fedAfterKill, 'a successful hunt must feed the predator through the energy ledger');
  // Success rate against weak prey is clearly higher than against the swift herd
  const rateA = statsA.huntSuccesses / statsA.huntAttempts;
  const rateB = statsB.huntSuccesses / statsB.huntAttempts;
  assert.ok(rateB > rateA, `weak prey must be easier to catch (${rateB.toFixed(2)} vs ${rateA.toFixed(2)})`);
});

// =================================================================================================
// 7. Migration when conditions deteriorate
// =================================================================================================

test('Spatial 7: a population migrates away when its home region deteriorates', () => {
  const grid = makeFlatGrid(44, 12, 'heatwave');
  const sim = makeSim(grid, 'heatwave-sim', [GRAZER], { backgroundPreyCapacityScale: 0 });
  for (let i = 0; i < 40; i++) {
    spawn(sim, GRAZER, 3 + (i % 8), 2 + (i % 7), { energy: 0.7, sex: i % 2 ? 'male' : 'female', ageTicks: 34 + (i % 20) });
  }
  const centroidX = () => {
    const orgs = sim.getOrganisms('grazer').filter((o) => o.stage !== 'egg');
    return orgs.reduce((s, o) => s + o.x, 0) / Math.max(1, orgs.length);
  };

  // Phase 1: good conditions - the population stays where it is
  stepChecked(sim, ['grazer'], 40);
  const calmCentroid = centroidX();
  const calmMigrations = sim.spatial!.stats.migrationsStarted;
  assert.ok(calmCentroid < 12, `a satisfied population must not drift away (centroid x=${calmCentroid.toFixed(1)})`);
  assert.ok(sim.getOrganisms('grazer').every((o) => o.x < 22), 'nobody leaves a good home range');

  // Phase 2: a heat wave makes the western half hostile (hotter toward the west edge)
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 22; x++) grid.setCell(x, y, { temperature: 44.5 + (22 - x) * 0.35 });
  }
  const aliveAtOnset = sim.getOrganisms('grazer').length;
  assert.ok(aliveAtOnset >= 30);
  const firstMigrationTick = new Map<number, number>();
  let largestTravellingGroup = 0;
  stepChecked(sim, ['grazer'], 90, (tick) => {
    const sharedGoals = new Map<number, number>();
    for (const o of sim.getOrganisms('grazer')) {
      const st = sim.getOrganismSpatialState(o.id);
      if (!st) continue;
      if (st.migrations > 0 && !firstMigrationTick.has(o.id)) firstMigrationTick.set(o.id, tick);
      if (st.behavior === BEHAVIOR_MIGRATE && st.goalCell >= 0) {
        const n = (sharedGoals.get(st.goalCell) ?? 0) + 1;
        sharedGoals.set(st.goalCell, n);
        if (n > largestTravellingGroup) largestTravellingGroup = n;
      }
    }
    assertExactEnergy(sim, 'heat wave');
  });

  const survivors = sim.getOrganisms('grazer').filter((o) => o.stage !== 'egg');
  const inCoolEast = survivors.filter((o) => o.x >= 22).length;
  assert.ok(sim.spatial!.stats.migrationsStarted > calmMigrations + 5, 'deterioration must trigger migrations');
  assert.ok(survivors.length >= 10, `part of the population must survive by moving (survivors: ${survivors.length})`);
  assert.ok(
    inCoolEast >= survivors.length * 0.7,
    `survivors must have relocated to the habitable region (${inCoolEast}/${survivors.length})`
  );
  assert.ok(centroidX() > calmCentroid + 10, 'the population as a whole must have shifted');
  // Movement is the sum of individual decisions taken at different times, not one synchronous jump
  assert.ok(new Set(firstMigrationTick.values()).size >= 4, 'individuals must decide to leave at different moments');
  assert.ok(sim.spatial!.stats.migrationsSettled > 0, 'migrants must settle once they reach a good place');
  // Group migration: neighbours join an individual that is already under way and share its destination
  assert.ok(largestTravellingGroup >= 3, `some migrants must travel as a group (largest: ${largestTravellingGroup})`);
});

// =================================================================================================
// 8. Partial split of a population
// =================================================================================================

test('Spatial 8: only part of a crowded population leaves, producing spatially separated groups', () => {
  const grid = makeFlatGrid(40, 10, 'split', DESERT);
  paint(grid, 2, 2, 8, 7, { moisture: 0.56 }); // home valley
  paint(grid, 20, 1, 37, 8, { moisture: 0.56 }); // distant unoccupied range beyond a dry belt
  const sim = makeSim(
    grid,
    'split-sim',
    [GRAZER],
    { backgroundPreyCapacityScale: 0, plantPhotosynthesisRate: 0.03 },
    { hydration: { enabled: false } }
  );
  const founders: Organism[] = [];
  for (let i = 0; i < 200; i++) {
    founders.push(
      spawn(sim, GRAZER, 2 + (i % 7), 2 + (i % 6), { energy: 0.6, sex: i % 2 ? 'male' : 'female', ageTicks: 34 + (i % 30) })
    );
  }

  const leftAt = new Map<number, number>();
  stepChecked(sim, ['grazer'], 130, (tick) => {
    for (const o of sim.getOrganisms('grazer')) {
      if (o.x > 12 && !leftAt.has(o.id)) leftAt.set(o.id, tick);
    }
  });
  assert.equal(founders.length, 200);

  const living = sim.getOrganisms('grazer').filter((o) => o.stage !== 'egg');
  const home = living.filter((o) => o.x <= 10);
  const away = living.filter((o) => o.x >= 18);
  assert.ok(home.length >= 20, `a large part of the population must stay in the home valley (${home.length})`);
  assert.ok(away.length >= 10, `some individuals must have colonized the distant range (${away.length})`);
  assert.ok(sim.spatial!.stats.migrationsStarted >= 20 && sim.spatial!.stats.migrationsSettled >= 5);
  // Departures are spread over time and involve only a part of the population
  assert.ok(new Set(leftAt.values()).size >= 5, 'emigration must be a sequence of individual departures');
  const residents = home.filter((o) => sim.getOrganismSpatialState(o.id)!.migrations === 0).length;
  assert.ok(residents >= 10, `true residents (never migrated) must remain (${residents})`);

  // The split is measurable: at least two separated subpopulations with their own gene pools
  const groups = sim.getSubpopulations('grazer', 3).filter((g) => g.size >= 4);
  assert.ok(groups.length >= 2, `expected at least two separated groups, got ${groups.length}`);
  const west = groups.find((g) => g.centroidX <= 10);
  const east = groups.find((g) => g.centroidX >= 18);
  assert.ok(west && east, 'one group at home and one in the new range');
  assert.equal(west.meanGeneticExpression.length, GRAZER.genomeSchema.locusCount);
  assert.ok(east.organismIds.every((id) => !west.organismIds.includes(id)));
  assert.equal(
    sim.getSubpopulations('grazer', 3).reduce((s, g) => s + g.size, 0),
    sim.getOrganisms('grazer').length,
    'subpopulations must partition the whole population'
  );
  assertExactEnergy(sim, 'split');
});

// =================================================================================================
// 9. Exact energy balance while moving
// =================================================================================================

test('Spatial 9: locomotion is paid from reserves through the ledger with exact conservation', () => {
  // A lone predator in a world without any food: every joule it spends is metabolism.
  const build = (spatial: boolean) => {
    const grid = makeFlatGrid(40, 9, 'energy-move');
    const sim = makeSim(grid, 'energy-move-sim', [HUNTER], { backgroundPreyCapacityScale: 0 }, spatial ? { hydration: { enabled: false } } : false);
    const org = spawn(sim, HUNTER, 5, 4, { sex: 'male', energy: 0.9 });
    return { sim, org };
  };
  const walker = build(true);
  const sitter = build(false);
  assert.deepEqual(
    walker.sim.getOrganismMassAndEnergy(walker.org.id),
    sitter.sim.getOrganismMassAndEnergy(sitter.org.id),
    'both start with identical bodies'
  );

  let gapQ = 0;
  for (let t = 0; t < 30; t++) {
    walker.sim.step();
    sitter.sim.step();
    assertExactEnergy(walker.sim, 'walker');
    assertExactEnergy(sitter.sim, 'sitter');
    const w = walker.sim.getOrganismMassAndEnergy(walker.org.id)!;
    const s = sitter.sim.getOrganismMassAndEnergy(sitter.org.id)!;
    assert.equal(w.structMassQ, s.structMassQ, 'movement never burns structural tissue');
    gapQ = s.reserveEnergyQ - w.reserveEnergyQ;
    if (walker.sim.spatial!.stats.pathCost > 0) {
      assert.ok(gapQ > 0, 'once it has moved, the walker has less reserve than the resting twin');
    } else {
      assert.equal(gapQ, 0, 'before any movement both bodies are identical');
    }
  }
  const stats = walker.sim.spatial!.stats;
  assert.equal(sitter.org.cellIndex, 4 * 40 + 5, 'without spatial behavior nothing moves');
  assert.ok(stats.pathCost >= 8, `the hungry predator must have travelled (path cost ${stats.pathCost.toFixed(1)})`);
  assert.ok(stats.locomotionEnergyQ > 0);
  // The reserve gap is the locomotion bill. It is slightly smaller than the bill because the
  // lighter walker has a marginally lower baseline metabolism; it can never exceed it.
  assert.ok(gapQ <= stats.locomotionEnergyQ + 60, `gap ${gapQ} must not exceed the locomotion bill ${stats.locomotionEnergyQ}`);
  assert.ok(gapQ >= stats.locomotionEnergyQ * 0.8, `gap ${gapQ} must account for the locomotion bill ${stats.locomotionEnergyQ}`);
  // Energy left the organism as heat; total matter is untouched by walking
  assert.equal(walker.sim.getEnergyAudit().actualMassQ, sitter.sim.getEnergyAudit().actualMassQ);
  assert.ok(walker.sim.getEnergyAudit().actualEnergyQ < sitter.sim.getEnergyAudit().actualEnergyQ);
});

// =================================================================================================
// 10. Full ABORT before COMMIT
// =================================================================================================

function buildActiveWorld(seed: string, onPhase?: BiologySimulationConfig['onPhase']): BiologySimulation {
  const grid = WorldGrid.generate({ width: 36, height: 24, seed: 'active-world' });
  const sim = makeSim(grid, seed, [GRAZER, HUNTER, CLEANER, DIGGER], { backgroundPreyCapacityScale: 0, onPhase });
  sim.spawnFounderPopulation('grazer', 160);
  sim.spawnFounderPopulation('hunter', 24, { center: { x: 18, y: 12, radius: 8 } });
  sim.spawnFounderPopulation('cleaner', 20);
  sim.spawnFounderPopulation('digger', 30);
  return sim;
}
const ACTIVE_IDS = ['grazer', 'hunter', 'cleaner', 'digger'] as const;

function populationIndexSnapshot(sim: BiologySimulation): string {
  const parts: string[] = [];
  for (const sp of ACTIVE_IDS) {
    for (let c = 0; c < sim.grid.cellCount; c++) {
      const n = sim.getCellPopulationCount(sp, c);
      if (n > 0) parts.push(`${sp}:${c}:${n}`);
    }
  }
  return parts.join('|');
}

test('Spatial 10: an error before COMMIT leaves positions, behavior state, energy and RNG untouched', () => {
  const phases: BiologyStepPhase[] = ['GATHER', 'RESOLVE', 'PRE_ALLOCATE', 'PREPARE', 'COMMIT'];
  const reference = buildActiveWorld('abort-sim');
  reference.stepMany(12);

  for (const faultPhase of phases) {
    let armed = false;
    const sim = buildActiveWorld('abort-sim', ({ phase }) => {
      if (armed && phase === faultPhase) throw new Error(`Injected fault at ${faultPhase}`);
    });
    sim.stepMany(12);
    assert.equal(fingerprint(sim, ACTIVE_IDS), fingerprint(reference, ACTIVE_IDS), 'twin worlds must agree before the fault');

    const before = fingerprint(sim, ACTIVE_IDS);
    const positionsBefore = ACTIVE_IDS.flatMap((sp) => sim.getOrganisms(sp).map((o) => `${o.id}@${o.x},${o.y},${o.cellIndex}`));
    const indexBefore = populationIndexSnapshot(sim);
    const rngBefore = sim.streams.snapshotStates();
    const statsBefore = JSON.stringify(sim.spatial!.stats);
    const committedBefore = sim.ledger.committedTxCount;

    armed = true;
    assert.throws(() => sim.step(), new RegExp(`Injected fault at ${faultPhase}`));
    // A second failing attempt must not accumulate anything either
    assert.throws(() => sim.step(), new RegExp(`Injected fault at ${faultPhase}`));

    assert.equal(sim.tick, 12, `${faultPhase}: tick must not advance`);
    assert.deepEqual(
      ACTIVE_IDS.flatMap((sp) => sim.getOrganisms(sp).map((o) => `${o.id}@${o.x},${o.y},${o.cellIndex}`)),
      positionsBefore,
      `${faultPhase}: coordinates must be unchanged`
    );
    assert.equal(populationIndexSnapshot(sim), indexBefore, `${faultPhase}: spatial indices must be intact`);
    assert.deepEqual(sim.streams.snapshotStates(), rngBefore, `${faultPhase}: RNG streams must be restored`);
    assert.equal(JSON.stringify(sim.spatial!.stats), statsBefore, `${faultPhase}: behavior statistics must not move`);
    assert.equal(fingerprint(sim, ACTIVE_IDS), before, `${faultPhase}: full state must be bit-identical`);
    assert.equal(sim.ledger.committedTxCount, committedBefore);
    assert.equal(sim.ledger.activeTransaction, null);
    assert.equal(sim.entityStore.isSynchronized(), true);
    assert.equal(sim.energyGrid.isSynchronized(), true);
    assertExactEnergy(sim, `${faultPhase} after abort`);

    // Retry: no double movement, no double feeding - the world continues exactly like its twin
    armed = false;
    sim.stepMany(8);
    const twin = buildActiveWorld('abort-sim');
    twin.stepMany(20);
    assert.equal(fingerprint(sim, ACTIVE_IDS), fingerprint(twin, ACTIVE_IDS), `${faultPhase}: retry must be deterministic`);
    assertExactEnergy(sim, `${faultPhase} after retry`);
  }
});

// =================================================================================================
// 11. Determinism
// =================================================================================================

test('Spatial 11: identical seeds give bit-identical spatial worlds; different seeds diverge', () => {
  const a = buildActiveWorld('determinism-A');
  const b = buildActiveWorld('determinism-A');
  const c = buildActiveWorld('determinism-C');
  for (const checkpoint of [15, 40, 80]) {
    a.stepMany(checkpoint - a.tick);
    b.stepMany(checkpoint - b.tick);
    c.stepMany(checkpoint - c.tick);
    assert.equal(fingerprint(a, ACTIVE_IDS), fingerprint(b, ACTIVE_IDS), `tick ${checkpoint}: same seed must match exactly`);
    assert.notEqual(fingerprint(a, ACTIVE_IDS), fingerprint(c, ACTIVE_IDS), `tick ${checkpoint}: other seed must differ`);
  }
  assert.ok(a.spatial!.stats.moves > 500, 'the compared worlds must contain real movement');
  assert.ok(a.spatial!.stats.huntAttempts > 0, 'and real predator-prey interaction');
  assert.deepEqual(a.spatial!.stats, b.spatial!.stats);
});

// =================================================================================================
// 12. Independence from camera position and render frequency
// =================================================================================================

test('Spatial 12: behavior does not depend on observation, camera position or render frequency', () => {
  // "Headless": no observer at all, batches of ticks
  const headless = buildActiveWorld('observer-sim');
  headless.stepMany(60);

  // "Rendered": a viewer looks at changing regions between ticks at an irregular frame rate,
  // with different diagnostic settings
  const grid = WorldGrid.generate({ width: 36, height: 24, seed: 'active-world' });
  const rendered = makeSim(grid, 'observer-sim', [GRAZER, HUNTER, CLEANER, DIGGER], {
    backgroundPreyCapacityScale: 0,
    recordHistory: true,
    statsInterval: 3,
    maxHistoryEntries: 5,
  });
  rendered.spawnFounderPopulation('grazer', 160);
  rendered.spawnFounderPopulation('hunter', 24, { center: { x: 18, y: 12, radius: 8 } });
  rendered.spawnFounderPopulation('cleaner', 20);
  rendered.spawnFounderPopulation('digger', 30);
  const camera = new SeededRng('camera-path');
  let frames = 0;
  while (rendered.tick < 60) {
    rendered.step();
    const renderPasses = rendered.tick % 4 === 0 ? 3 : rendered.tick % 3 === 0 ? 0 : 1;
    for (let f = 0; f < renderPasses; f++) {
      frames++;
      const camX = camera.nextInt(0, grid.width - 1);
      const camY = camera.nextInt(0, grid.height - 1);
      for (const sp of ACTIVE_IDS) {
        for (const o of rendered.getOrganisms(sp)) {
          if (Math.abs(o.x - camX) <= 6 && Math.abs(o.y - camY) <= 4) rendered.getOrganismSpatialState(o.id);
        }
        rendered.getStats(sp);
        rendered.getSubpopulations(sp, 2);
        rendered.getCellPopulationCount(sp, camY * grid.width + camX);
      }
      rendered.getEnergyAudit();
    }
  }
  assert.ok(frames > 30);
  assert.equal(fingerprint(rendered, ACTIVE_IDS), fingerprint(headless, ACTIVE_IDS), 'observation must not change the world');

  // Static guarantee: the spatial modules cannot even see rendering, wall-clock or DOM state
  const bioDir = path.resolve(process.cwd(), 'src/sim/biology');
  for (const file of ['spatialBehavior.ts', 'spatialNavigation.ts', 'spatialProfile.ts']) {
    // Code only: comments may of course mention what the module deliberately does not do
    const src = fs
      .readFileSync(path.join(bioDir, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s\/\/ .*$/gm, '');
    for (const forbidden of [
      'Math.random(',
      'Date.now',
      'performance.',
      'requestAnimationFrame',
      'window.',
      'document.',
      'camera',
      'viewport',
      "from '../../engine",
      "from '../../components",
    ]) {
      assert.equal(src.includes(forbidden), false, `${file} must not reference "${forbidden}"`);
    }
    assert.equal(
      /grid\.(elevation|temperature|moisture|terrainCode|biomeCode|waterDepth|biomass)\[[^\]]+\]\s*[-+*/]?=[^=]/.test(src),
      false,
      `${file} must never write WorldGrid buffers`
    );
  }
});

// =================================================================================================
// 13. PopulationManager consistency after mass movement
// =================================================================================================

test('Spatial 13: population spatial indices stay exact after mass movement, births and deaths', () => {
  const sim = buildActiveWorld('index-sim');
  let checkedCells = 0;
  for (let round = 0; round < 6; round++) {
    sim.stepMany(12);
    for (const sp of ACTIVE_IDS) {
      const expected = new Map<number, number[]>();
      for (const o of sim.getOrganisms(sp)) {
        assert.equal(o.alive, true, 'active list must only contain living organisms');
        assert.equal(sim.getOrganismById(sp, o.id), o, 'id lookup must return the same organism');
        let ids = expected.get(o.cellIndex);
        if (!ids) expected.set(o.cellIndex, (ids = []));
        ids.push(o.id);
      }
      let total = 0;
      for (let c = 0; c < sim.grid.cellCount; c++) {
        const want = expected.get(c);
        const count = sim.getCellPopulationCount(sp, c);
        assert.equal(count, want ? want.length : 0, `${sp} count in cell ${c}`);
        total += count;
        if (!want) continue;
        const got: number[] = [];
        sim.forEachOrganismInCell(sp, c, (o) => {
          assert.equal(o.cellIndex, c, 'indexed organism must really be in that cell');
          got.push(o.id);
        });
        assert.deepEqual(got, want.slice().sort((a, b) => a - b), `${sp} members of cell ${c} in ascending id order`);
        checkedCells++;
      }
      assert.equal(total, sim.getOrganisms(sp).length);
    }
  }
  assert.ok(checkedCells > 500);
  assert.ok(sim.spatial!.stats.moves > 2000, `mass movement expected (moves: ${sim.spatial!.stats.moves})`);
  const births = ACTIVE_IDS.reduce((s, sp) => s + sim.getStats(sp).birthsTotal, 0);
  const deaths = ACTIVE_IDS.reduce((s, sp) => s + sim.getStats(sp).deathsTotal, 0);
  assert.ok(births > 50 && deaths > 20, 'mates must still find each other through the index after moving');
  assertExactEnergy(sim, 'index');
});

// =================================================================================================
// 14. Long multi-species run across varied ecological conditions
// =================================================================================================

function hashWorldGrid(grid: WorldGrid): string {
  const h = crypto.createHash('sha256');
  for (const buf of [grid.elevation, grid.terrainCode, grid.temperature, grid.moisture, grid.biomeCode, grid.waterDepth, grid.biomass]) {
    h.update(Buffer.from(buf.buffer));
  }
  return h.digest('hex');
}

function buildLivingWorld(seed: string): { sim: BiologySimulation; grid: WorldGrid } {
  const grid = WorldGrid.generate({ width: 72, height: 48, seed: 'living-world-long' });
  const sim = makeSim(grid, seed, [GRAZER, HUNTER, CLEANER, DIGGER], { backgroundPreyCapacityScale: 0, statsInterval: 1_000_000 });
  sim.spawnFounderPopulation('grazer', 500);
  sim.spawnFounderPopulation('hunter', 60, { center: { x: 22, y: 20, radius: 7 } });
  sim.spawnFounderPopulation('cleaner', 40, { center: { x: 22, y: 20, radius: 7 } });
  sim.spawnFounderPopulation('digger', 100, { center: { x: 30, y: 22, radius: 9 } });
  return { sim, grid };
}

test('Spatial 14: 600-tick multi-species world with feeding, hunting, reproduction, mortality and migration', () => {
  const ids = ['grazer', 'hunter', 'cleaner', 'digger'] as const;
  const { sim, grid } = buildLivingWorld('living-world-long-sim');
  const twin = buildLivingWorld('living-world-long-sim').sim;
  const gridHash = hashWorldGrid(grid);
  const stats = grid.getStats();
  const biomesPresent = Object.values(stats.biomeCounts).filter((n) => n > 0).length;
  assert.ok(biomesPresent >= 6, `the world must offer varied ecological conditions (${biomesPresent} biomes)`);
  assert.ok(stats.waterCells > 0 && stats.landCells > 0);

  const grazerSeries: number[] = [];
  const hunterSeries: number[] = [];
  const occupiedBiomes = new Set<number>();
  const predationKills: OrganismDeathEvent[] = [];
  sim.onDeath((ev) => {
    if (ev.cause === 'predation') predationKills.push(ev);
  });

  stepChecked(sim, ids, 600, (tick) => {
    if (tick % 25 === 0) {
      assertExactEnergy(sim, `long run tick ${tick}`);
      grazerSeries.push(sim.getOrganisms('grazer').length);
      hunterSeries.push(sim.getOrganisms('hunter').length);
      for (const sp of ids) for (const o of sim.getOrganisms(sp)) occupiedBiomes.add(grid.biomeCode[o.cellIndex]);
    }
    if (tick === 200) {
      twin.stepMany(200);
      assert.equal(fingerprint(sim, ids), fingerprint(twin, ids), 'the long run must be reproducible from its seed');
    }
  });

  assert.equal(hashWorldGrid(grid), gridHash, 'biology must never write to WorldGrid');
  const s = sim.spatial!.stats;
  const grazers = sim.getStats('grazer');
  const hunters = sim.getStats('hunter');

  // Persistence and turnover
  assert.ok(grazers.totalAlive > 100, `grazers must persist (${grazers.totalAlive})`);
  assert.ok(hunters.totalAlive >= 2, `hunters must persist on live prey alone (${hunters.totalAlive})`);
  assert.ok(Math.min(...hunterSeries) >= 2 && Math.min(...grazerSeries) >= 50, 'neither population may collapse on the way');
  assert.ok(grazers.maxGeneration >= 8 && hunters.maxGeneration >= 4, 'many generations must have passed');
  for (const sp of ids) {
    assert.ok(sim.getStats(sp).birthsTotal > 0, `${sp} must have reproduced`);
    assert.ok(sim.getStats(sp).deathsTotal > 0, `${sp} must have experienced mortality`);
  }

  // Every mortality pathway is exercised
  const causes = (name: string) => ids.reduce((sum, sp) => sum + (sim.getStats(sp).deathsByCause[name] ?? 0), 0);
  for (const cause of ['old-age', 'predation', 'starvation', 'thermal-stress', 'dehydration']) {
    assert.ok(causes(cause) > 0, `expected deaths by ${cause}`);
  }
  assert.equal(predationKills.length, causes('predation'));
  assert.ok(predationKills.every((k) => k.killerId !== null));

  // Real feeding and hunting
  assert.ok(s.huntAttempts > 1000 && s.huntSuccesses > 300, `hunting must be routine (${s.huntSuccesses}/${s.huntAttempts})`);
  assert.ok(s.huntAttempts - s.huntSuccesses > 300, 'a large share of hunts must fail');
  assert.ok(hunters.birthsTotal > 100, 'predators must gain enough from hunting to breed');

  // Movement, navigation, water and migration
  assert.ok(s.moves > 100_000, `organisms must move constantly (${s.moves})`);
  assert.ok(s.drinks > 1000, 'animals must travel to water and drink');
  assert.ok(s.pathRequests > 0, 'obstacles must force route planning');
  assert.ok(s.migrationsStarted > 500 && s.migrationsSettled > 200, `migrations must start and end (${s.migrationsStarted}/${s.migrationsSettled})`);
  assert.ok(occupiedBiomes.size >= 4, `life must spread over several biomes (${occupiedBiomes.size})`);

  // Predator-prey dynamics: the prey population swings strongly while predators track it
  const afterStart = grazerSeries.slice(4);
  assert.ok(Math.max(...afterStart) >= 2 * Math.min(...afterStart), 'prey numbers must oscillate under predation');
  assert.ok(Math.max(...hunterSeries) >= 3 * 60, 'predators must have boomed when prey was abundant');

  // The populations are spatially structured (foundation for isolation)
  const grazerGroups = sim.getSubpopulations('grazer', 3);
  assert.equal(grazerGroups.reduce((sum, g) => sum + g.size, 0), grazers.totalAlive);
  assert.ok(grazerGroups[0].cellCount > 50, 'the main group must occupy a real territory');
  assertExactEnergy(sim, 'long run end');
});

// =================================================================================================
// Hydration, locomotion modes, configuration and load
// =================================================================================================

test('Spatial: thirsty animals walk to water they perceive or remember; without water they die of dehydration', () => {
  // Dry plain with a single wet strip on the east side
  const grid = makeFlatGrid(26, 9, 'water', { moisture: 0.3 });
  paint(grid, 9, 0, 10, 8, { moisture: 0.62 });
  const sim = makeSim(grid, 'water-sim', [GRAZER], { backgroundPreyCapacityScale: 0 });
  const w = grid.width;
  const group: Organism[] = [];
  for (let i = 0; i < 8; i++) {
    group.push(spawn(sim, GRAZER, 5 + (i % 2), 2 + (i % 5), { energy: 0.8, sex: i % 2 ? 'male' : 'female', ageTicks: 40 }));
  }
  const drank = new Set<number>();
  const remembered = new Set<number>();
  let minHydration = 1;
  stepChecked(sim, ['grazer'], 60, () => {
    for (const o of group) {
      if (!o.alive) continue;
      const st = sim.getOrganismSpatialState(o.id)!;
      if (st.hydration < minHydration) minHydration = st.hydration;
      if (o.x === 9 || o.x === 10) drank.add(o.id);
      if (st.memory.some((m) => m.kind === 'water' && (m.cell % w === 9 || m.cell % w === 10))) remembered.add(o.id);
    }
  });
  assert.ok(drank.size >= 7, `animals must reach the water (${drank.size}/8)`);
  assert.ok(remembered.size >= 7, 'the water place must be remembered');
  assert.ok(sim.spatial!.stats.drinks >= 16, 'they must come back to drink repeatedly');
  assert.ok(minHydration > 0, 'with water within reach nobody should run completely dry');
  assert.equal(sim.getStats('grazer').deathsByCause['dehydration'] ?? 0, 0);

  // Same animals on a plain with no water at all
  const dry = makeFlatGrid(26, 9, 'no-water', { moisture: 0.3 });
  const drySim = makeSim(dry, 'no-water-sim', [GRAZER], { backgroundPreyCapacityScale: 0 });
  for (let i = 0; i < 6; i++) {
    spawn(drySim, GRAZER, 5 + (i % 2), 2 + (i % 5), { energy: 0.8, sex: 'female', ageTicks: 40 });
  }
  const causes: string[] = [];
  drySim.onDeath((ev) => causes.push(ev.cause));
  stepChecked(drySim, ['grazer'], 70);
  assert.equal(causes.length, 6, 'nobody survives without water');
  assert.ok(causes.every((c) => c === 'dehydration'), `expected dehydration, got ${causes.join(',')}`);
  assertExactEnergy(drySim, 'no water');
});

test('Spatial: terrestrial, amphibious and aquatic species obey their own terrain', () => {
  const wader = makeSpecies('wader', 'herbivore', { bodySize: 0.6, spatial: { locomotion: 'amphibious' } });
  const swimmer = makeSpecies('swimmer', 'scavenger', { bodySize: 0.7, spatial: { locomotion: 'aquatic' } });
  const grid = makeFlatGrid(20, 9, 'modes', DESERT);
  paint(grid, 8, 0, 9, 8, { terrain: 'shallow-water' }); // a ford: only waders can cross
  paint(grid, 16, 0, 19, 8, WATER);
  paint(grid, 10, 0, 15, 8, { moisture: 0.56 }); // rich land beyond the ford
  const sim = makeSim(
    grid,
    'modes-sim',
    [GRAZER, wader, swimmer],
    { backgroundPreyCapacityScale: 0, plantPhotosynthesisRate: 0 },
    { hydration: { enabled: false } }
  );

  assert.throws(() => spawn(sim, GRAZER, 8, 4), /impassable for its locomotion/);
  assert.throws(() => spawn(sim, swimmer, 3, 3), /impassable for its locomotion/);
  const walkers: Organism[] = [];
  const waders: Organism[] = [];
  for (let i = 0; i < 6; i++) {
    walkers.push(spawn(sim, GRAZER, 6, 1 + i, { energy: 0.3, sex: i % 2 ? 'male' : 'female', ageTicks: 40 }));
    waders.push(spawn(sim, wader, 7, 1 + i, { energy: 0.3, sex: i % 2 ? 'male' : 'female', ageTicks: 40 }));
  }
  const fish = [spawn(sim, swimmer, 17, 2, { ageTicks: 40 }), spawn(sim, swimmer, 18, 6, { sex: 'male', ageTicks: 40 })];
  const founded = sim.spawnFounderPopulation('swimmer', 12);
  assert.ok(founded.every((o) => grid.hasWater(o.x, o.y)), 'aquatic founders are placed in water');

  const wadersAcross = new Set<number>();
  stepChecked(sim, ['grazer', 'wader', 'swimmer'], 40, () => {
    for (const o of walkers) if (o.alive) assert.ok(o.x <= 7, 'a land animal cannot enter the water');
    for (const o of waders) if (o.alive && o.x >= 10) wadersAcross.add(o.id);
    for (const o of sim.getOrganisms('swimmer')) assert.ok(grid.hasWater(o.x, o.y), 'an aquatic animal cannot leave the water');
  });
  assert.ok(wadersAcross.size >= 4, `amphibious animals must wade to the food (${wadersAcross.size}/6)`);
  assert.ok(fish.some((o) => !o.alive || sim.getOrganismSpatialState(o.id)!.pathCostTravelled >= 0));
  assertExactEnergy(sim, 'locomotion modes');
});

test('Spatial: configuration is validated and the feature is strictly opt-in', () => {
  const grid = makeFlatGrid(8, 6, 'config');
  const plain = makeSim(grid, 'config-off', [GRAZER], {}, false);
  assert.equal(plain.spatial, null);
  const o = spawn(plain, GRAZER, 2, 2);
  plain.stepMany(5);
  assert.equal(plain.getOrganismSpatialState(o.id), undefined);
  assert.equal(o.x, 2, 'without spatial behavior organisms never move');
  assert.equal(plain.getSubpopulations('grazer', 2)[0].size, 1);

  assert.throws(() => new BiologySimulation({ grid, strictConservation: false, spatial: true }), /strict conservation/);
  assert.throws(() => makeSim(grid, 'x', [GRAZER], {}, { thinkInterval: 0 }), /thinkInterval/);
  assert.throws(() => makeSim(grid, 'x', [GRAZER], {}, { maxStepsPerTick: 0 }), /maxStepsPerTick/);
  assert.throws(() => makeSim(grid, 'x', [GRAZER], {}, { hydration: { drinkPerTick: 2 } }), /drinkPerTick/);
  assert.throws(
    () => makeSim(grid, 'x', [GRAZER], {}, { speciesProfiles: { grazer: { sprintMultiplier: 0.5 } } }).spawnFounderPopulation('grazer', 1),
    /sprintMultiplier/
  );
  assert.throws(
    () => makeSim(grid, 'x', [makeSpecies('odd', 'herbivore', { spatial: { locomotion: 'flying' as never } })]).spawnFounderPopulation('odd', 1),
    /locomotion invalid/
  );
  assert.throws(() => makeSim(grid, 'x', [GRAZER], { backgroundPreyCapacityScale: -1 }), /backgroundPreyCapacityScale/);

  // Per-species overrides reach the behavior system
  const tuned = makeSim(grid, 'config-tuned', [GRAZER], {}, { speciesProfiles: { grazer: { perceptionRangeCells: 5, cellsPerTick: 2 } } });
  tuned.spawnFounderPopulation('grazer', 4);
  assert.equal(tuned.spatial!.getSpeciesProfile(0).perceptionRangeCells, 5);
  assert.equal(tuned.spatial!.getSpeciesProfile(0).cellsPerTick, 2);
});

test('Spatial: load smoke test at 1 000 and 10 000 organisms with exact conservation', () => {
  for (const n of [1_000, 10_000]) {
    const grid = WorldGrid.generate({ width: 128, height: 96, seed: 'spatial-load' });
    const sim = makeSim(grid, 'spatial-load-sim', [GRAZER, HUNTER, CLEANER], { statsInterval: 1_000_000 });
    sim.spawnFounderPopulation('grazer', Math.round(n * 0.75));
    sim.spawnFounderPopulation('hunter', Math.round(n * 0.1));
    sim.spawnFounderPopulation('cleaner', Math.round(n * 0.15));
    sim.stepMany(3); // warm-up
    const ticks = 8;
    const t0 = performance.now();
    sim.stepMany(ticks);
    const msPerTick = (performance.now() - t0) / ticks;
    const alive = ['grazer', 'hunter', 'cleaner'].reduce((s, sp) => s + sim.getOrganisms(sp).length, 0);
    assertExactEnergy(sim, `load ${n}`);
    assert.ok(alive >= n * 0.8, `population must still be there (${alive})`);
    assert.ok(sim.spatial!.stats.moves > n, 'organisms must be moving under load');
    // Generous regression guard, not a performance target (measured: a few microseconds per organism)
    assert.ok(msPerTick < 60 + n * 0.05, `${n} organisms took ${msPerTick.toFixed(1)} ms/tick`);
    // Navigation stays budgeted regardless of population size
    assert.ok(sim.spatial!.navigator.tickStats.requests <= sim.spatial!.navigator.maxRequestsPerTick);
    assert.ok(sim.spatial!.navigator.tickStats.nodesExpanded <= sim.spatial!.navigator.nodeBudgetPerTick + sim.spatial!.navigator.maxNodesPerRequest);
    // Per-organism spatial state is compact fixed-size typed-array storage
    assert.ok(sim.spatial!.estimateStateBytes() / sim.entityStore.capacity < 400);
  }
});
