import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { WorldGrid } from '../worldGrid';
import { BiologySimulation } from './biologySimulation';
import { DeterministicPreyFoodProvider } from './foodProvider';
import { OrganismDeathEvent } from './organism';
import { RAPTOR_SPECIES } from './species';

function hashWorldGridBuffers(grid: WorldGrid): string {
  const h = crypto.createHash('sha256');
  h.update(Buffer.from(grid.elevation.buffer));
  h.update(Buffer.from(grid.terrainCode.buffer));
  h.update(Buffer.from(grid.temperature.buffer));
  h.update(Buffer.from(grid.moisture.buffer));
  h.update(Buffer.from(grid.biomeCode.buffer));
  h.update(Buffer.from(grid.waterDepth.buffer));
  h.update(Buffer.from(grid.biomass.buffer));
  return h.digest('hex');
}

test('BiologySimulation: full Seed reproducibility, multi-generation stats, and zero mutation of WorldGrid buffers', () => {
  const gridA = WorldGrid.generate({ width: 48, height: 28, seed: 'cretaceous-basin' });
  const gridB = WorldGrid.generate({ width: 48, height: 28, seed: 'cretaceous-basin' });
  const gridHashBefore = hashWorldGridBuffers(gridA);

  const simA = new BiologySimulation({
    grid: gridA,
    seed: 'sim-root-99',
    trackMutationEvents: true,
  });
  const simB = new BiologySimulation({
    grid: gridB,
    seed: 'sim-root-99',
    trackMutationEvents: true,
  });

  simA.spawnFounderPopulation('raptor', 36);
  simB.spawnFounderPopulation('raptor', 36);

  const summaryA = simA.stepMany(120);
  const summaryB = simB.stepMany(120);

  // Bitwise identical statistics, organisms, and tracked mutations
  assert.deepEqual(summaryA, summaryB);
  assert.deepEqual(simA.getTrackedMutations(), simB.getTrackedMutations());

  const orgsA = simA.getOrganisms('raptor');
  const orgsB = simB.getOrganisms('raptor');
  assert.equal(orgsA.length, orgsB.length);
  for (let i = 0; i < orgsA.length; i++) {
    assert.equal(orgsA[i].id, orgsB[i].id);
    assert.equal(orgsA[i].sex, orgsB[i].sex);
    assert.equal(orgsA[i].stage, orgsB[i].stage);
    assert.equal(orgsA[i].energy, orgsB[i].energy);
    assert.deepEqual(orgsA[i].genome.maternalAlleles, orgsB[i].genome.maternalAlleles);
    assert.deepEqual(orgsA[i].genome.paternalAlleles, orgsB[i].genome.paternalAlleles);
  }

  const stats = simA.getStats('raptor');
  assert.equal(stats.introducedTotal, 36);
  assert.ok(stats.birthsTotal > 0, `Expected biological births over 120 ticks, got ${stats.birthsTotal}`);
  assert.equal(stats.totalAlive, stats.introducedTotal + stats.birthsTotal - stats.deathsTotal);
  assert.ok(stats.deathsTotal > 0, `Expected deaths over 120 ticks, got ${stats.deathsTotal}`);
  assert.ok(stats.maxGeneration >= 2, `Expected >= 2 generations over 120 ticks, got ${stats.maxGeneration}`);
  assert.ok(simA.getTrackedMutations().length > 0, 'Expected recorded mutations across generations');

  // WorldGrid TypedArrays must remain 100% untouched byte-for-byte
  assert.equal(hashWorldGridBuffers(gridA), gridHashBefore);

  // Source audit: biology modules must never call Math.random() or mutate grid.* buffers
  const bioDir = path.resolve('src/sim/biology');
  for (const file of fs.readdirSync(bioDir)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const raw = fs.readFileSync(path.join(bioDir, file), 'utf8');
    const codeOnly = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.equal(/\bMath\.random\s*\(/.test(codeOnly), false, `${file} must not call Math.random()`);
    assert.equal(
      /\bgrid\.(elevation|terrainCode|temperature|moisture|biomeCode|waterDepth|biomass)\s*\[[^\]]+\]\s*=/.test(codeOnly),
      false,
      `${file} must never write directly to WorldGrid TypedArrays`
    );
  }
});

test('BiologySimulation: emergent natural selection favors heatTolerance in hot worlds and coldTolerance in cold worlds', () => {
  const runClimateExperiment = (tempOffset: number, seedLabel: string) => {
    const grid = WorldGrid.generate({
      width: 24,
      height: 16,
      seed: 'selection-arena',
      temperatureOffset: tempOffset,
    });
    // Stabilize uniform temperature across land cells so selection signal is sharp & clean
    for (let i = 0; i < grid.cellCount; i++) {
      const { x, y } = grid.fromIndex(i);
      const t = grid.getTerrain(x, y);
      if (t !== 'deep-water' && t !== 'shallow-water') {
        grid.setCellByIndex(i, {
          terrain: 'lowland',
          biome: tempOffset > 0 ? 'savanna' : 'tundra',
          temperature: tempOffset > 0 ? 44.5 : 4.5,
          hasWater: false,
        });
      }
    }

    const food = new DeterministicPreyFoodProvider(grid, { regenerationRate: 0.7 });
    food.setUniformPrey(grid, 2.2, 2.2);

    const sim = new BiologySimulation({
      grid,
      seed: seedLabel,
      foodProvider: food,
      recordHistory: false,
    });
    sim.spawnFounderPopulation('raptor', 80);
    const initialStats = sim.getStats('raptor');
    const finalSummary = sim.stepMany(140);
    return { initialStats, finalStats: finalSummary.statsBySpecies.raptor };
  };

  const hot = runClimateExperiment(24, 'hot-selection');
  const cold = runClimateExperiment(-24, 'cold-selection');

  assert.ok(hot.finalStats.totalAlive > 0, 'Hot population should survive via heat-tolerant individuals');
  assert.ok(cold.finalStats.totalAlive > 0, 'Cold population should survive via cold-tolerant individuals');

  const hotHeat = hot.finalStats.meanGenotype.heatTolerance;
  const hotCold = hot.finalStats.meanGenotype.coldTolerance;
  const coldHeat = cold.finalStats.meanGenotype.heatTolerance;
  const coldCold = cold.finalStats.meanGenotype.coldTolerance;

  assert.ok(
    hotHeat > coldHeat,
    `Hot climate should select higher heatTolerance (${hotHeat.toFixed(3)} vs ${coldHeat.toFixed(3)})`
  );
  assert.ok(
    coldCold > hotCold,
    `Cold climate should select higher coldTolerance (${coldCold.toFixed(3)} vs ${hotCold.toFixed(3)})`
  );
  assert.ok(
    hotHeat > hot.initialStats.meanGenotype.heatTolerance,
    `Hot climate should shift heatTolerance upward from initial baseline (${hot.initialStats.meanGenotype.heatTolerance.toFixed(3)} -> ${hotHeat.toFixed(3)})`
  );
  assert.ok(
    coldCold > cold.initialStats.meanGenotype.coldTolerance,
    `Cold climate should shift coldTolerance upward from initial baseline (${cold.initialStats.meanGenotype.coldTolerance.toFixed(3)} -> ${coldCold.toFixed(3)})`
  );
});

test('BiologySimulation: resource scarcity causes competition & higher starvation mortality than abundant prey', () => {
  const runFoodExperiment = (preyLevel: number) => {
    const grid = WorldGrid.generate({ width: 20, height: 14, seed: 'prey-test' });
    const food = new DeterministicPreyFoodProvider(grid, { regenerationRate: 0.2 });
    food.setUniformPrey(grid, preyLevel, preyLevel);

    const sim = new BiologySimulation({
      grid,
      seed: 'food-competition',
      foodProvider: food,
      recordHistory: false,
    });
    sim.spawnFounderPopulation('raptor', 60);
    return sim.stepMany(50).statsBySpecies.raptor;
  };

  const abundant = runFoodExperiment(3.0);
  const scarce = runFoodExperiment(0.02);

  assert.ok(
    scarce.deathsByCause.starvation > abundant.deathsByCause.starvation,
    `Expected more starvation deaths in scarce prey world (${scarce.deathsByCause.starvation} vs ${abundant.deathsByCause.starvation})`
  );
  assert.ok(
    abundant.totalAlive > scarce.totalAlive,
    `Expected larger surviving population with abundant prey (${abundant.totalAlive} vs ${scarce.totalAlive})`
  );
});

test('BiologySimulation: performance scaling across multiple population sizes (1k, 5k, 15k organisms)', () => {
  const grid = WorldGrid.generate({ width: 120, height: 80, seed: 'perf-world' });
  const sizes = [1000, 5000, 15000] as const;
  const results: Array<{ size: number; msPerTick: number }> = [];

  for (const size of sizes) {
    const food = new DeterministicPreyFoodProvider(grid, { regenerationRate: 0.5 });
    food.setUniformPrey(grid, 4.0, 4.0);
    const sim = new BiologySimulation({
      grid,
      seed: `perf-${size}`,
      foodProvider: food,
      recordHistory: false,
    });
    sim.spawnFounderPopulation('raptor', size);

    // Warmup 2 ticks
    sim.stepMany(2);

    const ticks = 8;
    const t0 = performance.now();
    sim.stepMany(ticks);
    const elapsed = performance.now() - t0;
    const msPerTick = elapsed / ticks;
    results.push({ size, msPerTick });
  }

  // Verify sub-quadratic scaling: 15x organisms should take well under 40x time per tick,
  // and 15,000 organisms must execute comfortably (< 150ms/tick even on cold/emulated CPU)
  const ratio = results[2].msPerTick / Math.max(0.05, results[0].msPerTick);
  assert.ok(
    ratio < 40,
    `Expected near-linear scaling from 1k to 15k organisms, got ratio ${ratio.toFixed(2)} (${JSON.stringify(results)})`
  );
  assert.ok(
    results[2].msPerTick < 150,
    `Expected 15k organisms tick < 150ms, got ${results[2].msPerTick.toFixed(2)}ms`
  );

  // Keep reference to RAPTOR_SPECIES sanity
  assert.equal(RAPTOR_SPECIES.id, 'raptor');
});

test('BiologySimulation: introducedTotal vs birthsTotal accounting, stage-separated phenotype stats, and RNG stream isolation', () => {
  const grid = WorldGrid.generate({ width: 24, height: 16, seed: 'phase21-accounting' });
  for (let i = 0; i < grid.cellCount; i++) {
    const { x, y } = grid.fromIndex(i);
    const t = grid.getTerrain(x, y);
    if (t !== 'deep-water' && t !== 'shallow-water') {
      grid.setCellByIndex(i, {
        terrain: 'lowland',
        biome: 'temperate-forest',
        temperature: 24,
        hasWater: false,
      });
    }
  }
  const food = new DeterministicPreyFoodProvider(grid, { regenerationRate: 0.8 });
  food.setUniformPrey(grid, 2.5, 2.5);

  const simSmall = new BiologySimulation({ grid, seed: 'stream-iso', foodProvider: food, recordHistory: false });
  const simLarge = new BiologySimulation({ grid, seed: 'stream-iso', foodProvider: food, recordHistory: false });

  simSmall.spawnFounderPopulation('raptor', 10);
  simLarge.spawnFounderPopulation('raptor', 50);

  // Spawning different founder counts must NOT perturb the biology:genetics stream
  assert.equal(
    simSmall.streams.get('biology:genetics').nextFloat(),
    simLarge.streams.get('biology:genetics').nextFloat(),
    'Founder spawning must not consume biology:genetics'
  );

  // Immediately after seeding 10 founders + 1 manual organism: birthsTotal must be 0, introducedTotal must be 11
  const manualGenome = simSmall.getOrganisms('raptor')[0].genome;
  simSmall.spawnOrganism({
    speciesId: 'raptor',
    x: simSmall.getOrganisms('raptor')[0].x,
    y: simSmall.getOrganisms('raptor')[0].y,
    sex: 'male',
    genome: manualGenome,
  });
  const initStats = simSmall.getStats('raptor');
  assert.equal(initStats.introducedTotal, 11);
  assert.equal(initStats.birthsTotal, 0);
  assert.equal(initStats.totalAlive, 11);

  // Advance 80 ticks and verify accounting balance + stage-separated phenotypes
  const mid = simSmall.stepMany(80).statsBySpecies.raptor;
  assert.equal(mid.introducedTotal, 11);
  assert.ok(mid.birthsTotal > 0);
  assert.equal(mid.totalAlive, mid.introducedTotal + mid.birthsTotal - mid.deathsTotal);

  const sumCauses = Object.values(mid.deathsByCause).reduce((a, b) => a + b, 0);
  assert.equal(sumCauses, mid.deathsTotal);

  if (mid.stageCounts.egg > 0 && mid.stageCounts.adult > 0) {
    assert.ok(
      mid.meanEggPhenotype.bodySize < mid.meanAdultPhenotype.bodySize * 0.5,
      'Egg phenotype must be tracked separately from adult phenotype'
    );
    assert.ok(
      mid.meanAdultPhenotype.bodySize > mid.meanPhenotype.bodySize,
      'Overall meanPhenotype is pulled down by eggs/juveniles while meanAdultPhenotype stays accurate'
    );
  }
});

test('BiologySimulation: 1x1 and 2x2 grids with wrapX=true never revisit center or duplicate neighbors', () => {
  const grid1x1 = WorldGrid.generate({ width: 1, height: 1, seed: 'tiny-1x1', seaLevel: -1 });
  grid1x1.setCellByIndex(0, { terrain: 'lowland', biome: 'savanna', hasWater: false });
  const sim1 = new BiologySimulation({ grid: grid1x1, seed: 's1x1', wrapX: true });
  assert.deepEqual(sim1.getNeighborCellIndices(0, 0), []);
  const founders = sim1.spawnFounderPopulation('raptor', 2);
  assert.equal(founders.length, 2);
  const res1 = sim1.stepMany(15).statsBySpecies.raptor;
  assert.equal(res1.introducedTotal, 2);
  assert.equal(res1.totalAlive, res1.introducedTotal + res1.birthsTotal - res1.deathsTotal);

  const grid2x2 = WorldGrid.generate({ width: 2, height: 2, seed: 'tiny-2x2', seaLevel: -1 });
  for (let i = 0; i < grid2x2.cellCount; i++) {
    grid2x2.setCellByIndex(i, { terrain: 'lowland', biome: 'savanna', hasWater: false });
  }
  const sim2 = new BiologySimulation({ grid: grid2x2, seed: 's2x2', wrapX: true });
  const neighbors2 = sim2.getNeighborCellIndices(0, 0);
  assert.equal(new Set(neighbors2).size, neighbors2.length, 'Neighbors on 2x2 wrapX must be unique');
});

test('BiologySimulation: OrganismDeathEvent dispatches before active population removal and killOrganism guarantees single registration', () => {
  const grid = WorldGrid.generate({ width: 12, height: 10, seed: 'death-hook' });
  for (let i = 0; i < grid.cellCount; i++) {
    const { x, y } = grid.fromIndex(i);
    const t = grid.getTerrain(x, y);
    if (t !== 'deep-water' && t !== 'shallow-water') {
      grid.setCellByIndex(i, {
        terrain: 'lowland',
        biome: 'savanna',
        temperature: 25,
        hasWater: false,
      });
    }
  }
  const food = new DeterministicPreyFoodProvider(grid, { regenerationRate: 0 });
  food.setUniformPrey(grid, 0, 0);

  const sim = new BiologySimulation({ grid, seed: 'death-hook-sim', foodProvider: food });
  const founders = sim.spawnFounderPopulation('raptor', 6);
  const victimA = founders[0];
  const victimB = founders[1];
  const killer = founders[2];

  const observedInListener: Array<{
    event: OrganismDeathEvent;
    presentInById: boolean;
    aliveFlagAtEvent: boolean;
    recordedDeathsAtEvent: number;
  }> = [];

  const unsub = sim.onDeath((ev) => {
    const org = sim.getOrganismById(ev.speciesId, ev.organismId);
    const statsSnapshot = sim.getStats(ev.speciesId);
    observedInListener.push({
      event: ev,
      presentInById: org !== undefined,
      aliveFlagAtEvent: org ? org.alive : true,
      recordedDeathsAtEvent: statsSnapshot.deathsTotal,
    });
  });

  // External predation kill before compaction
  const predEvent = sim.killOrganism('raptor', victimA.id, 'predation', killer.id);
  assert.ok(predEvent !== null);
  assert.equal(predEvent.cause, 'predation');
  assert.equal(predEvent.killerId, killer.id);
  assert.equal(observedInListener.length, 1);
  assert.equal(observedInListener[0].presentInById, true, 'Organism must still be resolvable in listener before compactDead()');
  assert.equal(observedInListener[0].aliveFlagAtEvent, false);
  assert.equal(observedInListener[0].recordedDeathsAtEvent, 1);

  // Duplicate kill on already-dead organism must be ignored
  assert.equal(sim.killOrganism('raptor', victimA.id, 'injury', killer.id), null);
  assert.equal(observedInListener.length, 1);

  // Custom ecological cause also works seamlessly
  const diseaseEvent = sim.killOrganism('raptor', victimB.id, 'disease');
  assert.ok(diseaseEvent !== null);
  assert.equal(diseaseEvent.cause, 'disease');
  assert.equal(diseaseEvent.killerId, null);

  // Advance ticks until remaining starving organisms die naturally via lifecycle
  for (let t = 0; t < 60; t++) {
    sim.step();
    if (sim.getOrganisms('raptor').length === 0) break;
  }

  // Every death (external + lifecycle) occurred strictly once and was resolvable before compactDead()
  const finalStats = sim.getStats('raptor');
  assert.equal(finalStats.totalAlive, 0);
  assert.equal(finalStats.deathsTotal, 6);
  assert.equal(observedInListener.length, 6);
  for (const item of observedInListener) {
    assert.equal(item.presentInById, true);
    assert.equal(item.aliveFlagAtEvent, false);
  }
  assert.equal(new Set(observedInListener.map((o) => o.event.organismId)).size, 6);
  assert.equal(finalStats.deathsByCause.predation, 1);
  assert.equal(finalStats.deathsByCause.disease, 1);
  assert.equal(finalStats.deathsByCause.starvation, 4);
  assert.equal(sim.getOrganismById('raptor', victimA.id), undefined, 'Compacted dead organism must be removed after step()');
  assert.equal(sim.getDeathEvents().length, 6);

  unsub();
});

test('BiologySimulation: bounded maxHistoryEntries, statsInterval, and zero biological side-effects from diagnostics', () => {
  const gridA = WorldGrid.generate({ width: 24, height: 16, seed: 'history-bounds' });
  const gridB = WorldGrid.generate({ width: 24, height: 16, seed: 'history-bounds' });

  assert.throws(() => new BiologySimulation({ grid: gridA, maxHistoryEntries: -1 }), RangeError);
  assert.throws(() => new BiologySimulation({ grid: gridA, maxHistoryEntries: 1.5 }), RangeError);
  assert.throws(() => new BiologySimulation({ grid: gridA, statsInterval: 0 }), RangeError);
  assert.throws(() => new BiologySimulation({ grid: gridA, maxDeathEventHistory: -2 }), RangeError);

  const simDefault = new BiologySimulation({
    grid: gridA,
    seed: 'diag-iso',
  });
  const simThinned = new BiologySimulation({
    grid: gridB,
    seed: 'diag-iso',
    maxHistoryEntries: 4,
    statsInterval: 5,
    maxDeathEventHistory: 3,
  });

  simDefault.spawnFounderPopulation('raptor', 20);
  simThinned.spawnFounderPopulation('raptor', 20);

  // Verify single-step statsInterval behavior on non-interval ticks
  const s1 = simThinned.step();
  assert.equal(s1.tick, 1);
  assert.deepEqual(s1.statsBySpecies, {});
  assert.equal(simThinned.getHistory().length, 0);

  simDefault.step();

  // Step remaining 34 ticks -> total 35 ticks
  const finalDefault = simDefault.stepMany(34);
  const finalThinned = simThinned.stepMany(34);

  // Thinned history recorded ticks 5,10,15,20,25,30,35 capped at last 4 => [20, 25, 30, 35]
  assert.deepEqual(
    simThinned.getHistory().map((h) => h.tick),
    [20, 25, 30, 35]
  );
  assert.equal(simDefault.getHistory().length, 35);
  assert.ok(simThinned.getDeathEvents().length <= 3);

  // Zero diagnostic influence on biological state, stats, and RNG streams
  assert.deepEqual(finalThinned.statsBySpecies, finalDefault.statsBySpecies);
  assert.equal(simThinned.getOrganisms('raptor').length, simDefault.getOrganisms('raptor').length);
  const orgsD = simDefault.getOrganisms('raptor');
  const orgsT = simThinned.getOrganisms('raptor');
  for (let i = 0; i < orgsD.length; i++) {
    assert.equal(orgsT[i].id, orgsD[i].id);
    assert.equal(orgsT[i].health, orgsD[i].health);
    assert.equal(orgsT[i].energy, orgsD[i].energy);
    assert.equal(orgsT[i].stage, orgsD[i].stage);
    assert.deepEqual(orgsT[i].genome.maternalAlleles, orgsD[i].genome.maternalAlleles);
    assert.deepEqual(orgsT[i].genome.paternalAlleles, orgsD[i].genome.paternalAlleles);
  }
  assert.equal(
    simThinned.streams.get('biology:lifecycle').getState(),
    simDefault.streams.get('biology:lifecycle').getState()
  );
  assert.equal(
    simThinned.streams.get('biology:reproduction').getState(),
    simDefault.streams.get('biology:reproduction').getState()
  );
  assert.equal(
    simThinned.streams.get('biology:genetics').getState(),
    simDefault.streams.get('biology:genetics').getState()
  );
});

