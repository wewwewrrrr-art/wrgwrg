import assert from 'node:assert/strict';
import test from 'node:test';
import { SeededRng } from '../prng';
import { WorldGrid } from '../worldGrid';
import {
  ANATOMY_IDX,
  ANATOMY_LOCUS_COUNT,
  OrganismAnatomyState,
  computeAnatomyPhysiologyInto,
  createAnatomyPhysiology,
  expressAnatomy,
  getRelativeAnatomyPhysiology,
  getSpeciesBaselineAnatomy,
} from './anatomy';
import { BiologySimulation } from './biologySimulation';
import { createIndividualGenome } from './genome';
import { RAPTOR_SPECIES, SpeciesDefinition, SpeciesRegistry } from './species';

// =================================================================================================
// Helpers
// =================================================================================================

/** Genetically uniform, all-female raptors: individuals differ only where a test makes them differ. */
const UNIFORM: SpeciesDefinition = {
  ...RAPTOR_SPECIES,
  initialGeneticSpread: 0,
  reproduction: { ...RAPTOR_SPECIES.reproduction, femaleProbability: 1 },
};
const BASE_BMR = getSpeciesBaselineAnatomy(UNIFORM).expressed[ANATOMY_IDX.BASAL_METABOLIC_RATE];

function registryOf(...species: SpeciesDefinition[]): SpeciesRegistry {
  const reg = new SpeciesRegistry();
  for (const sp of species) reg.register(sp);
  return reg;
}

function flatGrid(width: number, height: number, seed: string, temperature = 24): WorldGrid {
  const grid = WorldGrid.generate({ width, height, seed });
  for (let i = 0; i < grid.cellCount; i++) grid.setCellByIndex(i, { elevation: 0.5, temperature, moisture: 0.56 });
  return grid;
}

/** Species-baseline anatomy with a different basal metabolic rate (both allele copies). */
function anatomyWithBmr(species: SpeciesDefinition, bmr: number): OrganismAnatomyState {
  const maternal = Float32Array.from(getSpeciesBaselineAnatomy(species).maternal);
  maternal[ANATOMY_IDX.BASAL_METABOLIC_RATE] = bmr;
  const paternal = Float32Array.from(maternal);
  const dominance = new Float32Array(ANATOMY_LOCUS_COUNT).fill(0.5);
  const { expressed, locomotionMode, viability } = expressAnatomy(maternal, paternal, dominance);
  return { maternal, paternal, dominance, expressed, locomotionMode, viability };
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : NaN;
}

function assertExact(sim: BiologySimulation, label: string): void {
  const audit = sim.assertEnergyAudit();
  assert.equal(audit.massResidualQ, 0n, `${label}: mass residual`);
  assert.equal(audit.energyResidualQ, 0n, `${label}: energy residual`);
}

/**
 * Two groups of genetically identical adult females that differ only in BMR (controlled inputs for
 * an energetic comparison; everything after spawning is the normal simulation).
 */
function bmrPair(
  tradeOffs: boolean,
  opts: { food: number; energy: number; stage?: 'adult' | 'juvenile'; spatial?: boolean; lowBmr?: number; highBmr?: number }
) {
  const grid = flatGrid(10, 8, 'bmr-pair');
  const sim = new BiologySimulation({
    grid,
    seed: 'bmr-pair',
    speciesRegistry: registryOf(UNIFORM),
    recordHistory: false,
    statsInterval: 1e9,
    spatial: opts.spatial ?? false,
    backgroundPreyCapacityScale: opts.food,
    evolution: tradeOffs ? true : { enablePhysiologicalTradeOffs: false },
  });
  const genome = createIndividualGenome(UNIFORM.genomeSchema, UNIFORM.traitBaselines, UNIFORM.traitRanges, 0, new SeededRng('g'));
  const low: number[] = [];
  const high: number[] = [];
  for (let i = 0; i < 20; i++) {
    for (const [bmr, ids] of [[opts.lowBmr ?? 0.7, low], [opts.highBmr ?? 1.4, high]] as const) {
      const stage = opts.stage ?? 'adult';
      const o = sim.spawnOrganism({ speciesId: 'raptor', x: i % 10, y: (i / 10) | 0, sex: 'female', genome, stage, ageTicks: stage === 'juvenile' ? 11 : 60, energy: opts.energy });
      o.anatomy = anatomyWithBmr(UNIFORM, bmr);
      ids.push(o.id);
    }
  }
  const reserve = (ids: number[]) => mean(ids.map((id) => sim.getOrganismMassAndEnergy(id)?.reserveMassQ ?? 0));
  const energy = (ids: number[]) => mean(ids.map((id) => sim.getOrganismById('raptor', id)?.energy ?? 0));
  return { sim, low, high, reserve, energy };
}

// =================================================================================================
// 1. The physiology model
// =================================================================================================

test('Physiology model: baseline-neutral, causal directions of BMR, pure per-organism cache', () => {
  const base = getRelativeAnatomyPhysiology(anatomyWithBmr(UNIFORM, BASE_BMR), UNIFORM);
  assert.ok(Math.abs(base.maintenanceScale - 1) < 1e-6 && Math.abs(base.intakeCapacityScale - 1) < 1e-6);
  assert.ok(Math.abs(base.growthScale - 1) < 1e-6 && Math.abs(base.recoveryScale - 1) < 1e-6);
  assert.ok(Math.abs(base.coldOffsetC) < 1e-6 && Math.abs(base.heatOffsetC) < 1e-6, 'the species norm is unaffected');

  const low = getRelativeAnatomyPhysiology(anatomyWithBmr(UNIFORM, 0.7), UNIFORM);
  const high = getRelativeAnatomyPhysiology(anatomyWithBmr(UNIFORM, 1.4), UNIFORM);
  // Low BMR saves upkeep and tolerates heat; high BMR processes food faster, grows, recovers and
  // produces heat against the cold. Neither side is better in every respect.
  assert.ok(low.maintenanceScale < 1 && high.maintenanceScale > 1);
  assert.ok(low.heatOffsetC > 0 && high.heatOffsetC < 0);
  assert.ok(low.coldOffsetC < 0 && high.coldOffsetC > 0);
  assert.ok(low.intakeCapacityScale < 1 && high.intakeCapacityScale > 1);
  assert.ok(low.growthScale < 1 && high.growthScale > 1);
  assert.ok(low.recoveryScale < 1 && high.recoveryScale > 1);

  // Cached value equals a fresh computation and never changes the genome
  const an = anatomyWithBmr(UNIFORM, 1.2);
  const before = Array.from(an.expressed);
  const a = getRelativeAnatomyPhysiology(an, UNIFORM);
  assert.equal(getRelativeAnatomyPhysiology(an, UNIFORM), a, 'cached');
  const fresh = computeAnatomyPhysiologyInto(an, createAnatomyPhysiology());
  const ref = computeAnatomyPhysiologyInto(getSpeciesBaselineAnatomy(UNIFORM), createAnatomyPhysiology());
  assert.ok(Math.abs(a.maintenanceScale - fresh.maintenanceScale / ref.maintenanceScale) < 1e-12);
  assert.deepEqual(Array.from(an.expressed), before);
  // A sister species with the same norms gets the same relative values (speciation-safe cache)
  const sister: SpeciesDefinition = { ...UNIFORM, id: 'raptor_d9', name: 'Sister' };
  const s = getRelativeAnatomyPhysiology(an, sister);
  assert.ok(Math.abs(s.maintenanceScale - a.maintenanceScale) < 1e-12 && Math.abs(s.heatOffsetC - a.heatOffsetC) < 1e-12);
});

// =================================================================================================
// 2. Energetic advantages and disadvantages of BMR levels (real energy flows)
// =================================================================================================

test('BMR energetics: low BMR saves basal energy only and outlasts starvation; high BMR refuels faster', () => {
  // (a) Without food: reserve burn of the first ticks and time to starvation
  const burn = (tradeOffs: boolean) => {
    const p = bmrPair(tradeOffs, { food: 0, energy: 0.9 });
    const r0 = { low: p.reserve(p.low), high: p.reserve(p.high) };
    p.sim.stepMany(5);
    const used = { low: r0.low - p.reserve(p.low), high: r0.high - p.reserve(p.high) };
    const death = new Map<number, number>();
    for (let t = 1; t <= 300 && death.size < 40; t++) {
      p.sim.step();
      for (const id of [...p.low, ...p.high]) if (!death.has(id) && !p.sim.getOrganismById('raptor', id)) death.set(id, p.sim.tick);
    }
    assertExact(p.sim, `starvation ${tradeOffs}`);
    const survival = (ids: number[]) => mean(ids.map((id) => death.get(id) ?? 305));
    return { burnRatio: used.low / used.high, survivalRatio: survival(p.low) / survival(p.high) };
  };
  const legacy = burn(false);
  const model = burn(true);
  // Phase 2.3.2 scaled the TOTAL demand with BMR: half the BMR, about half the burn
  assert.ok(legacy.burnRatio < 0.62, `legacy: whole demand scaled (${legacy.burnRatio.toFixed(3)})`);
  // Now BMR scales resting upkeep only; activity costs are mechanical
  assert.ok(model.burnRatio > 0.8 && model.burnRatio < 0.97, `basal-only saving (${model.burnRatio.toFixed(3)})`);
  assert.ok(model.survivalRatio > 1.1, `low BMR still outlasts starvation (${model.survivalRatio.toFixed(3)})`);
  assert.ok(model.survivalRatio < legacy.survivalRatio, 'but the advantage is no longer inflated');

  // (b) Abundant food after a fast: the larger metabolic machinery refuels faster
  const refuel = (tradeOffs: boolean) => {
    const p = bmrPair(tradeOffs, { food: 3.5, energy: 0.15 });
    p.sim.stepMany(8);
    assertExact(p.sim, `refuel ${tradeOffs}`);
    return { low: p.energy(p.low), high: p.energy(p.high) };
  };
  const rl = refuel(false);
  const rm = refuel(true);
  assert.ok(rl.low > rl.high, 'legacy: low BMR wins even when food is abundant (the one-sided bias)');
  assert.ok(rm.high > rm.low + 0.03, `with the model high BMR refuels faster (${rm.high.toFixed(3)} vs ${rm.low.toFixed(3)})`);
});

test('BMR in behaviour: thermal choices use the physiological envelope, fatigue recovery follows aerobic capacity', () => {
  // Hot half at the species' upper thermal limit, cool half at the optimum. Low BMR tolerates the
  // hot half (less metabolic heat), high BMR does not: only the latter is pushed out.
  const grid = flatGrid(16, 6, 'bmr-heat');
  for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) grid.setCell(x, y, { temperature: 43.6 });
  const sim = new BiologySimulation({
    grid,
    seed: 'bmr-heat',
    speciesRegistry: registryOf(UNIFORM),
    recordHistory: false,
    statsInterval: 1e9,
    spatial: true,
    evolution: true,
  });
  const genome = createIndividualGenome(UNIFORM.genomeSchema, UNIFORM.traitBaselines, UNIFORM.traitRanges, 0, new SeededRng('g'));
  const low: number[] = [];
  const high: number[] = [];
  for (let i = 0; i < 18; i++) {
    for (const [bmr, ids] of [[0.7, low], [1.4, high]] as const) {
      const o = sim.spawnOrganism({ speciesId: 'raptor', x: i % 3, y: i % 6, sex: 'female', genome, stage: 'adult', ageTicks: 60, energy: 0.8 });
      o.anatomy = anatomyWithBmr(UNIFORM, bmr);
      ids.push(o.id);
    }
  }
  const hl = getRelativeAnatomyPhysiology(anatomyWithBmr(UNIFORM, 0.7), UNIFORM).heatOffsetC;
  const hh = getRelativeAnatomyPhysiology(anatomyWithBmr(UNIFORM, 1.4), UNIFORM).heatOffsetC;
  assert.ok(43.65 + hl > 43.6 && 43.65 + hh < 43.6, 'the hot half lies between the two upper limits');
  let coolLow = 0;
  let coolHigh = 0;
  for (let t = 0; t < 40; t++) {
    sim.step();
    const cool = (ids: number[]) => ids.filter((id) => (sim.getOrganismById('raptor', id)?.x ?? -1) >= 8).length;
    coolLow += cool(low);
    coolHigh += cool(high);
  }
  assert.ok(coolHigh > 1.5 * coolLow + 20, `high-BMR individuals leave the heat (${coolHigh} vs ${coolLow} cool-side organism-ticks)`);
  assertExact(sim, 'heat choice');

  // Fatigue: same exertion, faster clearance with higher aerobic capacity
  const spatial = sim.spatial! as unknown as { fatigue: Float32Array; slotBase: number };
  const slotOf = (id: number) => sim.getOrganismEntitySlot(id)! - spatial.slotBase;
  const alive = (ids: number[]) => ids.filter((id) => sim.getOrganismById('raptor', id));
  const [l] = alive(low);
  const [h] = alive(high);
  spatial.fatigue[slotOf(l)] = 0.9;
  spatial.fatigue[slotOf(h)] = 0.9;
  sim.step();
  assert.ok(spatial.fatigue[slotOf(h)] < spatial.fatigue[slotOf(l)], 'higher BMR clears fatigue faster');
});

test('Efficiency-power trade-off: efficient metabolism burns less energy but delivers less burst power', () => {
  const grid = flatGrid(8, 6, 'eff');
  const sim = new BiologySimulation({ grid, seed: 'eff', speciesRegistry: registryOf(UNIFORM), recordHistory: false, statsInterval: 1e9, spatial: true, evolution: true });
  const schema = UNIFORM.genomeSchema;
  const mk = (metEff: number) =>
    createIndividualGenome(schema, { ...UNIFORM.traitBaselines, metabolismEfficiency: metEff }, UNIFORM.traitRanges, 0, new SeededRng('e'));
  const eff = sim.spawnOrganism({ speciesId: 'raptor', x: 1, y: 1, sex: 'female', genome: mk(1.9), stage: 'adult', ageTicks: 60, energy: 0.5 });
  const pow = sim.spawnOrganism({ speciesId: 'raptor', x: 1, y: 1, sex: 'female', genome: mk(0.6), stage: 'adult', ageTicks: 60, energy: 0.5 });
  const burst = (o: typeof eff) =>
    (sim.spatial as unknown as { burstPower(o: unknown, rt: unknown): number; species: unknown[] }).burstPower(
      o,
      (sim.spatial as unknown as { species: unknown[] }).species[0]
    );
  sim.step();
  assert.ok(burst(eff) < 1 && burst(pow) > 1, 'burst speed follows the efficiency-power trade-off');
  // Disabled model: no burst effect
  const legacy = new BiologySimulation({ grid: flatGrid(8, 6, 'eff'), seed: 'eff', speciesRegistry: registryOf(UNIFORM), recordHistory: false, statsInterval: 1e9, spatial: true, evolution: { enablePhysiologicalTradeOffs: false } });
  const e2 = legacy.spawnOrganism({ speciesId: 'raptor', x: 1, y: 1, sex: 'female', genome: mk(1.9), stage: 'adult', ageTicks: 60, energy: 0.5 });
  legacy.step();
  assert.equal(
    (legacy.spatial as unknown as { burstPower(o: unknown, rt: unknown): number; species: unknown[] }).burstPower(e2, (legacy.spatial as unknown as { species: unknown[] }).species[0]),
    1
  );
  assertExact(sim, 'efficiency');

  // Energy side of the trade-off: without food the efficient genotype burns its reserve more slowly
  const starve = new BiologySimulation({ grid: flatGrid(8, 6, 'eff-starve'), seed: 'eff-starve', speciesRegistry: registryOf(UNIFORM), recordHistory: false, statsInterval: 1e9, spatial: false, backgroundPreyCapacityScale: 0, evolution: true });
  const effIds = [0, 1, 2, 3].map((i) => starve.spawnOrganism({ speciesId: 'raptor', x: i, y: 0, sex: 'female', genome: mk(1.9), stage: 'adult', ageTicks: 60, energy: 0.9 }).id);
  const powIds = [0, 1, 2, 3].map((i) => starve.spawnOrganism({ speciesId: 'raptor', x: i, y: 1, sex: 'female', genome: mk(0.6), stage: 'adult', ageTicks: 60, energy: 0.9 }).id);
  const res = (ids: number[]) => mean(ids.map((id) => starve.getOrganismMassAndEnergy(id)!.reserveMassQ));
  const r0 = { eff: res(effIds), pow: res(powIds) };
  starve.stepMany(5);
  assert.ok(r0.eff - res(effIds) < r0.pow - res(powIds), 'efficient metabolism spends less on activity');
  assertExact(starve, 'efficiency starvation');
});

// =================================================================================================
// 3. Inheritance, determinism, ABORT, conservation
// =================================================================================================

const FAST: SpeciesDefinition = {
  ...RAPTOR_SPECIES,
  lifecycle: { ...RAPTOR_SPECIES.lifecycle, incubationTicks: 4, juvenileTicks: 10, elderAgeTicks: 70, maxLifespanTicks: 100 },
  reproduction: { ...RAPTOR_SPECIES.reproduction, cooldownTicks: 6 },
  mutation: { ...RAPTOR_SPECIES.mutation, baseRate: 0.12, stepScale: 0.12 },
};

function fastSim(seed: string, onPhase?: (ctx: { tick: number; phase: string }) => void): BiologySimulation {
  const sim = new BiologySimulation({
    grid: flatGrid(14, 10, `${seed}-grid`),
    seed,
    speciesRegistry: registryOf(FAST),
    recordHistory: false,
    statsInterval: 1e9,
    spatial: true,
    evolution: true,
    onPhase: onPhase as never,
  });
  sim.spawnFounderPopulation('raptor', 90);
  return sim;
}

function fingerprint(sim: BiologySimulation): string {
  const parts: string[] = [`t${sim.tick}`];
  for (const o of [...sim.getOrganisms('raptor')].sort((a, b) => a.id - b.id)) {
    const me = sim.getOrganismMassAndEnergy(o.id)!;
    parts.push(`${o.id},${o.stage},${o.x},${o.y},${o.health},${o.energy},${me.structMassQ},${me.reserveMassQ},${Array.from(o.anatomy!.expressed).join(':')}`);
  }
  const big = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
  parts.push(JSON.stringify(sim.getEnergyAudit(), big), JSON.stringify(sim.streams.snapshotStates()), JSON.stringify(sim.evolutionStats));
  return parts.join('|');
}

test('Physiological differences are heritable: offspring maintenance cost follows the parents', () => {
  const sim = fastSim('heritability');
  const bmrOf = new Map<number, number>();
  const record = () => {
    for (const o of sim.getOrganisms('raptor')) if (!bmrOf.has(o.id)) bmrOf.set(o.id, o.anatomy!.expressed[ANATOMY_IDX.BASAL_METABOLIC_RATE]);
  };
  record();
  const pairs: [number, number][] = [];
  for (let t = 0; t < 250; t++) {
    sim.step();
    for (const o of sim.getOrganisms('raptor')) {
      if (o.birthTick !== sim.tick || o.parentAId === null || o.parentBId === null) continue;
      const a = bmrOf.get(o.parentAId);
      const b = bmrOf.get(o.parentBId);
      if (a !== undefined && b !== undefined) pairs.push([(a + b) / 2, o.anatomy!.expressed[ANATOMY_IDX.BASAL_METABOLIC_RATE]]);
    }
    record();
  }
  assert.ok(pairs.length > 300, `${pairs.length} parent-offspring pairs`);
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  const cov = mean(pairs.map((p) => (p[0] - mx) * (p[1] - my)));
  const varx = mean(pairs.map((p) => (p[0] - mx) ** 2));
  const slope = cov / varx;
  // Mid-parent regression estimates narrow-sense heritability (additive loci: ~1 minus noise)
  assert.ok(slope > 0.5 && slope < 1.3, `mid-parent regression slope ${slope.toFixed(3)}`);
  assertExact(sim, 'heritability');
});

test('Physiology model is deterministic, atomic under ABORT and creates no energy', () => {
  const a = fastSim('determinism');
  const b = fastSim('determinism');
  a.stepMany(120);
  b.stepMany(120);
  assert.equal(fingerprint(a), fingerprint(b), 'same seed, same world');
  assertExact(a, 'determinism');

  const massStart = fastSim('abort').getEnergyAudit().actualMassQ;
  let fault: string | null = null;
  const sim = fastSim('abort', ({ phase }) => {
    if (fault !== null && phase === fault) throw new Error(`fault at ${phase}`);
  });
  const ref = fastSim('abort');
  sim.stepMany(80);
  ref.stepMany(81);
  const before = fingerprint(sim);
  for (const phase of ['GATHER', 'RESOLVE', 'PRE_ALLOCATE', 'PREPARE', 'COMMIT']) {
    fault = phase;
    assert.throws(() => sim.step(), new RegExp(`fault at ${phase}`));
    assert.equal(fingerprint(sim), before, `${phase}: state restored`);
  }
  fault = null;
  sim.step();
  assert.equal(fingerprint(sim), fingerprint(ref), 'the retried tick equals the undisturbed one');
  assert.equal(sim.getEnergyAudit().actualMassQ, massStart, 'no mass created');
  assertExact(sim, 'abort');
});

// =================================================================================================
// 4. Selection: the one-sided BMR advantage is gone, variation is kept
// =================================================================================================

test('Selection on BMR: no collapse to the lower bound in rich or scarce worlds, variation retained', () => {
  const run = (tradeOffs: boolean, food: number) => {
    const sim = new BiologySimulation({
      grid: flatGrid(12, 10, 'bmr-sel-grid'),
      seed: 'bmr-sel',
      speciesRegistry: registryOf(FAST),
      recordHistory: false,
      statsInterval: 1e9,
      spatial: true,
      backgroundPreyCapacityScale: food,
      evolution: tradeOffs ? true : { enablePhysiologicalTradeOffs: false },
    });
    sim.spawnFounderPopulation('raptor', 80);
    sim.stepMany(2000);
    const b = sim.getOrganisms('raptor').map((o) => o.anatomy!.expressed[ANATOMY_IDX.BASAL_METABOLIC_RATE]);
    const m = mean(b);
    assertExact(sim, `selection ${tradeOffs} ${food}`);
    return { mean: m, sd: Math.sqrt(mean(b.map((v) => (v - m) ** 2))), atFloor: b.filter((v) => v < 0.7).length / b.length, n: b.length };
  };
  const legacy = run(false, 3.5);
  const rich = run(true, 3.5);
  const scarce = run(true, 2.0);
  // Phase 2.3.2 rules: minimal BMR wins everywhere (the reported bias)
  assert.ok(legacy.mean < 0.8, `legacy BMR collapses towards the bound (${legacy.mean.toFixed(3)}, ${(legacy.atFloor * 100).toFixed(0)}% below 0.7)`);
  for (const [label, r] of [['rich', rich], ['scarce', scarce]] as const) {
    assert.ok(r.n > 50, `${label}: population persists`);
    assert.ok(r.mean > BASE_BMR - 0.12 && r.mean < BASE_BMR + 0.2, `${label}: BMR stays inside the range (${r.mean.toFixed(3)})`);
    assert.ok(r.mean > legacy.mean + 0.12, `${label}: no drift to minimal BMR (${r.mean.toFixed(3)} vs legacy ${legacy.mean.toFixed(3)})`);
    assert.ok(r.atFloor < legacy.atFloor / 2, `${label}: no pile-up at the lower bound (${(r.atFloor * 100).toFixed(1)}% vs ${(legacy.atFloor * 100).toFixed(1)}%)`);
    assert.ok(r.sd > 0.035, `${label}: heritable variation retained (sd ${r.sd.toFixed(3)})`);
  }
});
