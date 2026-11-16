import assert from 'node:assert/strict';
import test from 'node:test';
import { WorldGrid } from '../worldGrid';
import { BiologySimulation, DeathListenerError } from './biologySimulation';
import { DeterministicPreyFoodProvider, FoodEnvironmentContext, FoodProvider } from './foodProvider';
import { OrganismDeathEvent } from './organism';
import { PopulationManager, validateDeathCauseStrict } from './population';
import { RAPTOR_SPECIES } from './species';

function createLandGrid(width: number, height: number, seed: string): WorldGrid {
  const grid = WorldGrid.generate({ width, height, seed, seaLevel: -1 });
  for (let i = 0; i < grid.cellCount; i++) {
    grid.setCellByIndex(i, {
      terrain: 'lowland',
      biome: 'savanna',
      temperature: 24,
      hasWater: false,
    });
  }
  return grid;
}

test('Hardening 2.2.1a: nested step() and stepMany() from onDeath are rejected before mutating state', () => {
  const grid = createLandGrid(10, 8, 'reentrancy-guard');
  const food = new DeterministicPreyFoodProvider(grid, { regenerationRate: 0 });
  food.setUniformPrey(grid, 0, 0);

  const sim = new BiologySimulation({ grid, seed: 'reentrancy-sim', foodProvider: food });
  const founders = sim.spawnFounderPopulation('raptor', 6);
  for (const org of founders) {
    org.energy = 0;
    org.health = 0.01;
  }

  let nestedStepThrew: unknown = null;
  let nestedStepManyThrew: unknown = null;
  let observedTickDuringListener = -1;
  let secondListenerCount = 0;

  sim.onDeath((ev) => {
    observedTickDuringListener = ev.tick;
    try {
      sim.step();
    } catch (err) {
      nestedStepThrew = err;
      throw err; // Also verify exception isolation lets outer tick & second listener finish cleanly
    }
  });

  sim.onDeath(() => {
    secondListenerCount += 1;
    try {
      sim.stepMany(3);
    } catch (err) {
      nestedStepManyThrew = err;
    }
  });

  const summary = sim.step();
  assert.equal(summary.tick, 1);
  assert.ok(nestedStepThrew instanceof Error, 'Nested step() inside onDeath must throw');
  assert.ok(nestedStepManyThrew instanceof Error, 'Nested stepMany() inside onDeath must throw');
  assert.equal(observedTickDuringListener, 1);
  assert.equal(secondListenerCount, 6);

  // Outer tick MUST still have recorded every death accurately in PopulationManager
  const stats = summary.statsBySpecies.raptor;
  assert.equal(stats.deathsTotal, 6);
  assert.equal(stats.deathsThisTick, 6);
  assert.equal(stats.totalAlive, 0);
  assert.equal(stats.totalAlive, stats.introducedTotal + stats.birthsTotal - stats.deathsTotal);
  assert.equal(sim.getOrganisms('raptor').length, 0);
  assert.equal(sim.getDeathListenerErrors().length, 6);
  assert.equal(sim.getTotalDeathListenerErrors(), 6);

  // Simulation remains usable on subsequent ticks
  const next = sim.step();
  assert.equal(next.tick, 2);
});

test('Hardening 2.2.1a: onDeath listener errors are isolated, diagnostics captured, compactDead runs, and duplicate killOrganism is ignored', () => {
  const grid = createLandGrid(10, 8, 'listener-isolation');
  const food = new DeterministicPreyFoodProvider(grid, { regenerationRate: 0 });
  food.setUniformPrey(grid, 0, 0);

  const reportedErrors: DeathListenerError[] = [];
  const sim = new BiologySimulation({
    grid,
    seed: 'iso-sim',
    foodProvider: food,
    maxDeathListenerErrors: 4,
    onDeathListenerError: (rec) => reportedErrors.push(rec),
  });

  const founders = sim.spawnFounderPopulation('raptor', 5);
  for (const org of founders) {
    org.energy = 0;
    org.health = 0.01;
  }

  const listener2Events: OrganismDeathEvent[] = [];
  const listener3Events: OrganismDeathEvent[] = [];
  const duplicateKillResults: Array<OrganismDeathEvent | null> = [];

  sim.onDeath(() => {
    throw new Error('listener-1 failure');
  });
  sim.onDeath((ev) => {
    listener2Events.push(ev);
    // Attempt duplicate kill on same dying organism from inside onDeath
    duplicateKillResults.push(sim.killOrganism(ev.speciesId, ev.organismId, 'predation', 999));
  });
  sim.onDeath((ev) => {
    listener3Events.push(ev);
  });

  const summary = sim.step();
  assert.equal(summary.tick, 1);

  const stats = summary.statsBySpecies.raptor;
  assert.equal(stats.deathsTotal, 5);
  assert.equal(stats.totalAlive, 0);
  assert.equal(stats.deathsByCause.starvation, 5);
  assert.equal(stats.deathsByCause.predation ?? 0, 0);
  assert.equal(sim.getOrganisms('raptor').length, 0);
  assert.equal(listener2Events.length, 5);
  assert.equal(listener3Events.length, 5);
  assert.ok(duplicateKillResults.every((r) => r === null), 'Duplicate killOrganism in onDeath must return null');

  // Listener error diagnostics are bounded and accessible
  assert.equal(sim.getTotalDeathListenerErrors(), 5);
  assert.equal(reportedErrors.length, 5);
  const retainedErrors = sim.getDeathListenerErrors();
  assert.equal(retainedErrors.length, 4, 'Error buffer must respect maxDeathListenerErrors=4');
  assert.equal(retainedErrors[0].organismId, founders[1].id);
  assert.equal(retainedErrors[3].organismId, founders[4].id);
  assert.equal(retainedErrors[0].listenerIndex, 0);
  assert.match((retainedErrors[0].error as Error).message, /listener-1 failure/);

  sim.clearDeathListenerErrors();
  assert.equal(sim.getDeathListenerErrors().length, 0);
});

test('Hardening 2.2.1a: simulation recovers cleanly after an unexpected error mid-step', () => {
  const grid = createLandGrid(8, 8, 'error-recovery');
  let shouldThrow = true;
  const flakyProvider: FoodProvider = {
    getAvailablePrey(_env: FoodEnvironmentContext): number {
      return 1;
    },
    consumePrey(_env: FoodEnvironmentContext, requested: number): number {
      if (shouldThrow) {
        shouldThrow = false;
        throw new Error('transient food provider crash');
      }
      return requested;
    },
  };

  const sim = new BiologySimulation({ grid, seed: 'recovery-sim', foodProvider: flakyProvider });
  const founders = sim.spawnFounderPopulation('raptor', 4);
  const rngBefore = sim.streams.snapshotStates();
  const agesBefore = founders.map((f) => f.ageTicks);
  const energiesBefore = founders.map((f) => f.energy);

  assert.throws(() => sim.step(), /transient food provider crash/);

  // Atomic P3 guarantee: ABORT leaves tick, RNG streams, and organisms completely unmodified (no Torn Tick)
  assert.equal(sim.tick, 0);
  assert.deepEqual(sim.streams.snapshotStates(), rngBefore);
  assert.deepEqual(founders.map((f) => f.ageTicks), agesBefore);
  assert.deepEqual(founders.map((f) => f.energy), energiesBefore);

  // Re-entrancy flag & internal state must be recovered cleanly so subsequent steps succeed
  const summary = sim.step();
  assert.equal(summary.tick, 1);
  assert.equal(sim.getStats('raptor').totalAlive, 4);
  assert.equal(sim.getOrganisms('raptor').length, 4);
});

test('Hardening 2.2.1a: PopulationManager.deathsByCause handles prototype-named and custom causes safely and rejects whitespace', () => {
  const grid = createLandGrid(6, 6, 'proto-causes');
  const pop = new PopulationManager(RAPTOR_SPECIES, grid);

  const protoAndCustomCauses = [
    'toString',
    'constructor',
    'valueOf',
    '__proto__',
    'hasOwnProperty',
    'predation',
    'custom-blight',
  ] as const;

  for (const cause of protoAndCustomCauses) {
    pop.recordDeath(cause);
    pop.recordDeath(cause);
  }

  const stats = pop.computeStats(1);
  assert.equal(stats.deathsTotal, protoAndCustomCauses.length * 2);

  for (const cause of protoAndCustomCauses) {
    assert.equal(typeof stats.deathsByCause[cause], 'number', `Expected number for cause "${cause}"`);
    assert.equal(stats.deathsByCause[cause], 2, `Expected count 2 for cause "${cause}"`);
  }

  const totalByCauses = Object.values(stats.deathsByCause).reduce((a, b) => a + b, 0);
  assert.equal(totalByCauses, stats.deathsTotal);
  assert.equal(Object.getPrototypeOf(stats.deathsByCause), Object.prototype);

  // Ensure standard baseline keys remain numeric
  assert.equal(stats.deathsByCause.none, 0);
  assert.equal(stats.deathsByCause['old-age'], 0);
  assert.equal(stats.deathsByCause.starvation, 0);

  // Reject empty strings and causes with leading/trailing whitespace
  const invalidCauses = ['', ' ', '   ', ' predation', 'predation ', '  predation  ', '\tpredation', 'predation\n'];
  for (const bad of invalidCauses) {
    assert.throws(() => pop.recordDeath(bad), RangeError, `Should reject "${bad}"`);
    assert.throws(() => validateDeathCauseStrict(bad), RangeError, `Strict validator should reject "${bad}"`);
  }

  const sim = new BiologySimulation({ grid, seed: 'bad-cause-sim' });
  const org = sim.spawnFounderPopulation('raptor', 1)[0];
  for (const bad of invalidCauses) {
    assert.throws(() => sim.killOrganism('raptor', org.id, bad), RangeError);
  }
  assert.equal(org.alive, true);
  assert.equal(sim.getStats('raptor').deathsTotal, 0);
});

test('Hardening 2.2.1a: deathEvents O(1) ring buffer preserves chronological order on overflow and supports maxDeathEventHistory=0', () => {
  const grid = createLandGrid(8, 8, 'ring-buffer');

  // 1. Overflow & exact FIFO eviction order with maxDeathEventHistory = 3
  const sim = new BiologySimulation({
    grid,
    seed: 'ring-3',
    maxDeathEventHistory: 3,
  });
  const orgs = sim.spawnFounderPopulation('raptor', 7);
  const streamedIds: number[] = [];
  sim.onDeath((ev) => streamedIds.push(ev.organismId));

  for (let i = 0; i < orgs.length; i++) {
    sim.killOrganism('raptor', orgs[i].id, i % 2 === 0 ? 'predation' : 'disease', 500 + i);
  }

  assert.deepEqual(
    streamedIds,
    orgs.map((o) => o.id)
  );

  // Expect only last 3 events in chronological order
  const retained = sim.getDeathEvents();
  assert.equal(retained.length, 3);
  assert.deepEqual(
    retained.map((e) => e.organismId),
    orgs.slice(4).map((o) => o.id)
  );

  // Returned array is a defensive copy (external mutation cannot corrupt ring buffer)
  (retained as OrganismDeathEvent[]).pop();
  assert.equal(sim.getDeathEvents().length, 3);

  // 2. maxDeathEventHistory = 0 retains nothing while listeners still receive every event
  const simZero = new BiologySimulation({
    grid,
    seed: 'ring-0',
    maxDeathEventHistory: 0,
  });
  const orgsZero = simZero.spawnFounderPopulation('raptor', 4);
  const receivedZero: number[] = [];
  simZero.onDeath((ev) => receivedZero.push(ev.organismId));

  for (const o of orgsZero) {
    simZero.killOrganism('raptor', o.id, 'injury');
  }
  assert.equal(simZero.getDeathEvents().length, 0);
  assert.deepEqual(
    receivedZero,
    orgsZero.map((o) => o.id)
  );

  // Also test natural step() deaths when maxDeathEventHistory=0 and listeners are attached
  const foodZero = new DeterministicPreyFoodProvider(grid, { regenerationRate: 0 });
  foodZero.setUniformPrey(grid, 0, 0);
  const simStepZero = new BiologySimulation({
    grid,
    seed: 'ring-0-step',
    foodProvider: foodZero,
    maxDeathEventHistory: 0,
  });
  const stepZeroOrgs = simStepZero.spawnFounderPopulation('raptor', 3);
  for (const o of stepZeroOrgs) {
    o.energy = 0;
    o.health = 0.01;
  }
  const receivedStepZero: number[] = [];
  simStepZero.onDeath((ev) => receivedStepZero.push(ev.organismId));
  simStepZero.step();
  assert.equal(simStepZero.getDeathEvents().length, 0);
  assert.deepEqual(
    receivedStepZero,
    stepZeroOrgs.map((o) => o.id)
  );
});

test('Hardening 2.2.1a: killOrganism maintains full consistency between getOrganisms, getStats, PopulationManager, and onDeath listeners', () => {
  const grid = createLandGrid(8, 8, 'kill-consistency');
  const sim = new BiologySimulation({ grid, seed: 'kill-sync' });
  const orgs = sim.spawnFounderPopulation('raptor', 6);

  const [v1, v2, v3] = orgs;
  let insideListenerV1Visible = false;
  let insideListenerV1Alive = true;
  let cascadeKillResult: OrganismDeathEvent | null = null;
  let duplicateSelfKillResult: OrganismDeathEvent | null = null;

  sim.onDeath((ev) => {
    if (ev.organismId === v1.id) {
      const resolved = sim.getOrganismById('raptor', v1.id);
      insideListenerV1Visible = resolved !== undefined;
      insideListenerV1Alive = resolved ? resolved.alive : true;
      // Duplicate self-kill is a strict no-op
      duplicateSelfKillResult = sim.killOrganism('raptor', v1.id, 'injury');
      // Cascade kill on another organism during v1's death handler
      cascadeKillResult = sim.killOrganism('raptor', v2.id, 'toString', v1.id);
    }
  });

  const evt1 = sim.killOrganism('raptor', v1.id, 'predation', v3.id);
  assert.ok(evt1 !== null);
  assert.equal(insideListenerV1Visible, true, 'Victim must stay readable inside onDeath');
  assert.equal(insideListenerV1Alive, false);
  assert.equal(duplicateSelfKillResult, null);
  assert.ok(cascadeKillResult !== null);

  // Immediately after killOrganism() returns (BEFORE any step()), active population & stats MUST match
  const activeAfterKill = sim.getOrganisms('raptor');
  const statsAfterKill = sim.getStats('raptor');
  assert.equal(activeAfterKill.length, 4);
  assert.equal(statsAfterKill.totalAlive, 4);
  assert.equal(statsAfterKill.deathsTotal, 2);
  assert.equal(statsAfterKill.deathsByCause.predation, 1);
  assert.equal(statsAfterKill.deathsByCause.toString, 1);
  assert.equal(sim.getOrganismById('raptor', v1.id), undefined);
  assert.equal(sim.getOrganismById('raptor', v2.id), undefined);
  assert.ok(activeAfterKill.every((o) => o.alive));

  // Verify subsequent simulation step also runs cleanly with consistent counts
  const afterStep = sim.step().statsBySpecies.raptor;
  assert.equal(afterStep.totalAlive, sim.getOrganisms('raptor').length);
});

test('Hardening 2.2.1a: killOrganism targeting another organism from inside step() onDeath keeps lifecycle loop and counts consistent', () => {
  const grid = createLandGrid(8, 8, 'kill-in-step');
  const food = new DeterministicPreyFoodProvider(grid, { regenerationRate: 0 });
  food.setUniformPrey(grid, 0, 0);

  const sim = new BiologySimulation({ grid, seed: 'kill-in-step-sim', foodProvider: food });
  const orgs = sim.spawnFounderPopulation('raptor', 4);
  // Make org[0] die of starvation on tick 1; org[1]..org[3] stay healthy for tick 1
  orgs[0].energy = 0;
  orgs[0].health = 0.01;
  for (let i = 1; i < orgs.length; i++) {
    orgs[i].energy = 0.9;
    orgs[i].health = 1.0;
  }

  let cascadeTriggered = false;
  sim.onDeath((ev) => {
    if (ev.organismId === orgs[0].id && !cascadeTriggered) {
      cascadeTriggered = true;
      // Kill orgs[2] (middle of active array) from inside step()'s onDeath
      const res = sim.killOrganism('raptor', orgs[2].id, 'injury', ev.organismId);
      assert.ok(res !== null);
    }
  });

  const summary = sim.step();
  const stats = summary.statsBySpecies.raptor;
  assert.equal(cascadeTriggered, true);
  assert.equal(stats.deathsTotal, 2);
  assert.equal(stats.deathsByCause.starvation, 1);
  assert.equal(stats.deathsByCause.injury, 1);
  assert.equal(stats.totalAlive, 2);
  assert.equal(sim.getOrganisms('raptor').length, 2);
  // Ensure orgs[1] and orgs[3] were NOT skipped by premature mid-loop compaction
  assert.equal(orgs[1].ageTicks > 0, true);
  assert.equal(orgs[3].ageTicks > 0, true);
  assert.equal(sim.getOrganismById('raptor', orgs[0].id), undefined);
  assert.equal(sim.getOrganismById('raptor', orgs[2].id), undefined);
});

test('Hardening 2.2.1a.1: OrganismDeathEvent is frozen and protected against mutations across listeners and getDeathEvents()', () => {
  const grid = createLandGrid(8, 8, 'immutable-death-event');
  const sim = new BiologySimulation({ grid, seed: 'imm-evt-sim' });
  const orgs = sim.spawnFounderPopulation('raptor', 2);
  const victim = orgs[0];
  const killer = orgs[1];

  const listener1FrozenChecks: boolean[] = [];
  const listener1MutationErrors: unknown[] = [];
  const listener2Snapshots: Array<{
    frozen: boolean;
    cause: string;
    tick: number;
    killerId: number | null;
    x: number;
    y: number;
  }> = [];
  let listener3Called = false;

  // Listener 1 attempts to mutate the event in-place (caught locally to test propagation, and uncaught case tested below)
  sim.onDeath((ev) => {
    listener1FrozenChecks.push(Object.isFrozen(ev));
    try {
      (ev as unknown as Record<string, unknown>).cause = 'tampered';
    } catch (err) {
      listener1MutationErrors.push(err);
    }
    try {
      (ev as unknown as Record<string, unknown>).tick = 9999;
    } catch (err) {
      listener1MutationErrors.push(err);
    }
    try {
      (ev as unknown as Record<string, unknown>).injectedProp = true;
    } catch (err) {
      listener1MutationErrors.push(err);
    }
  });

  // Listener 2 observes exact unmodified event
  sim.onDeath((ev) => {
    listener2Snapshots.push({
      frozen: Object.isFrozen(ev),
      cause: ev.cause,
      tick: ev.tick,
      killerId: ev.killerId,
      x: ev.x,
      y: ev.y,
    });
  });

  // Listener 3 still runs cleanly
  sim.onDeath(() => {
    listener3Called = true;
  });

  const expectedX = victim.x;
  const expectedY = victim.y;
  const returnedEvent = sim.killOrganism('raptor', victim.id, 'predation', killer.id);
  assert.ok(returnedEvent !== null);
  assert.equal(Object.isFrozen(returnedEvent), true);
  assert.equal(listener1FrozenChecks[0], true);
  assert.equal(listener1MutationErrors.length, 3);
  assert.ok(listener1MutationErrors.every((e) => e instanceof TypeError));

  assert.equal(listener2Snapshots.length, 1);
  assert.deepEqual(listener2Snapshots[0], {
    frozen: true,
    cause: 'predation',
    tick: 0,
    killerId: killer.id,
    x: expectedX,
    y: expectedY,
  });
  assert.equal(listener3Called, true);

  // Returned event itself cannot be mutated
  assert.throws(() => {
    (returnedEvent as unknown as Record<string, unknown>).cause = 'disease';
  }, TypeError);
  assert.equal(returnedEvent.cause, 'predation');

  // getDeathEvents() returns frozen events inside a defensive array copy
  const history1 = sim.getDeathEvents();
  assert.equal(history1.length, 1);
  assert.equal(Object.isFrozen(history1[0]), true);
  assert.throws(() => {
    (history1[0] as unknown as Record<string, unknown>).cause = 'tampered-history';
  }, TypeError);
  assert.throws(() => {
    (history1[0] as unknown as Record<string, unknown>).tick = 777;
  }, TypeError);

  // External array mutation (overwrite/pop/push) cannot corrupt internal deathEvents
  (history1 as OrganismDeathEvent[])[0] = {
    ...history1[0],
    cause: 'corrupted',
  };
  (history1 as OrganismDeathEvent[]).pop();
  assert.equal(history1.length, 0);

  // Re-reading returns intact original values
  const history2 = sim.getDeathEvents();
  assert.equal(history2.length, 1);
  assert.equal(Object.isFrozen(history2[0]), true);
  assert.equal(history2[0].organismId, victim.id);
  assert.equal(history2[0].cause, 'predation');
  assert.equal(history2[0].tick, 0);
  assert.equal(history2[0].killerId, killer.id);
  assert.equal(history2[0].x, expectedX);
  assert.equal(history2[0].y, expectedY);
});

test('Hardening 2.2.1a.1: uncaught mutation attempt in first onDeath listener does not affect remaining listeners or stored history', () => {
  const grid = createLandGrid(8, 8, 'uncaught-event-mutation');
  const food = new DeterministicPreyFoodProvider(grid, { regenerationRate: 0 });
  food.setUniformPrey(grid, 0, 0);

  const sim = new BiologySimulation({ grid, seed: 'uncaught-mut-sim', foodProvider: food });
  const org = sim.spawnFounderPopulation('raptor', 1)[0];
  org.energy = 0;
  org.health = 0.01;

  const observedBySecond: OrganismDeathEvent[] = [];

  // Listener 1 attempts an unguarded mutation on ev -> throws TypeError in strict mode
  sim.onDeath((ev) => {
    (ev as unknown as { cause: string }).cause = 'hijacked';
  });

  // Listener 2 must still execute and see the original 'starvation' event
  sim.onDeath((ev) => {
    observedBySecond.push(ev);
  });

  const summary = sim.step();
  assert.equal(summary.statsBySpecies.raptor.deathsTotal, 1);
  assert.equal(summary.statsBySpecies.raptor.deathsByCause.starvation, 1);
  assert.equal(observedBySecond.length, 1);
  assert.equal(observedBySecond[0].cause, 'starvation');
  assert.equal(observedBySecond[0].tick, 1);

  const events = sim.getDeathEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].cause, 'starvation');
  assert.equal(events[0].tick, 1);

  const errors = sim.getDeathListenerErrors();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].listenerIndex, 0);
  assert.equal((errors[0].error as Error).name, 'TypeError');
});

test('Hardening 2.2.1a.1: DeathListenerError is frozen, snapshots Error without freezing external Error, and isolates callback/history mutations', () => {
  const grid = createLandGrid(8, 8, 'immutable-error-records');
  const externalError = new TypeError('external-listener-boom');
  externalError.stack = 'TypeError: external-listener-boom\n    at test:1:1';

  const callbackObserved: DeathListenerError[] = [];
  const callbackMutationErrors: unknown[] = [];

  const sim = new BiologySimulation({
    grid,
    seed: 'imm-err-sim',
    maxDeathListenerErrors: 2,
    onDeathListenerError: (record) => {
      callbackObserved.push(record);
      try {
        (record as unknown as Record<string, unknown>).tick = 9999;
      } catch (e) {
        callbackMutationErrors.push(e);
      }
      try {
        (record.error as Error).message = 'mutated-via-callback';
      } catch (e) {
        callbackMutationErrors.push(e);
      }
      try {
        (record as unknown as Record<string, unknown>).extra = 'injected';
      } catch (e) {
        callbackMutationErrors.push(e);
      }
    },
  });

  const orgs = sim.spawnFounderPopulation('raptor', 3);
  let secondListenerRuns = 0;

  sim.onDeath(() => {
    throw externalError;
  });
  sim.onDeath(() => {
    secondListenerRuns += 1;
  });

  // Trigger 3 errors to also verify ring buffer (capacity 2) behavior
  sim.killOrganism('raptor', orgs[0].id, 'predation', 11);
  // External code mutates the original Error after throwing — must remain possible AND not affect stored snapshot!
  assert.equal(Object.isFrozen(externalError), false, 'External Error object must NOT be frozen');
  externalError.message = 'mutated-externally-later';
  (externalError as unknown as { externalMeta: string }).externalMeta = 'allowed';
  assert.equal(externalError.message, 'mutated-externally-later');

  sim.killOrganism('raptor', orgs[1].id, 'disease', 12);
  sim.killOrganism('raptor', orgs[2].id, 'injury', 13);

  assert.equal(secondListenerRuns, 3);
  assert.equal(sim.getTotalDeathListenerErrors(), 3);
  assert.equal(callbackObserved.length, 3);
  assert.equal(callbackMutationErrors.length, 9);
  assert.ok(callbackMutationErrors.every((e) => e instanceof TypeError));

  for (const rec of callbackObserved) {
    assert.equal(Object.isFrozen(rec), true);
    assert.equal(Object.isFrozen(rec.error), true);
  }

  // Ring buffer retained last 2 errors in chronological order (orgs[1] and orgs[2])
  const errHistory1 = sim.getDeathListenerErrors();
  assert.equal(errHistory1.length, 2);
  assert.equal(errHistory1[0].organismId, orgs[1].id);
  assert.equal(errHistory1[1].organismId, orgs[2].id);
  assert.equal(Object.isFrozen(errHistory1[0]), true);
  assert.equal(Object.isFrozen(errHistory1[0].error), true);

  // Snapshot preserved name, stack, and message (first snapshot preserved original message before external mutation)
  const firstSnap = callbackObserved[0].error as Error;
  assert.equal(firstSnap instanceof Error, true);
  assert.equal(firstSnap.name, 'TypeError');
  assert.equal(firstSnap.message, 'external-listener-boom');
  assert.equal(firstSnap.stack, 'TypeError: external-listener-boom\n    at test:1:1');

  // Attempt to mutate retained record, nested error, and returned array
  assert.throws(() => {
    (errHistory1[0] as unknown as Record<string, unknown>).cause = 'tampered';
  }, TypeError);
  assert.throws(() => {
    (errHistory1[0].error as Error).message = 'tampered-msg';
  }, TypeError);
  (errHistory1 as DeathListenerError[])[0] = {
    ...errHistory1[0],
    cause: 'corrupted',
  };
  (errHistory1 as DeathListenerError[]).pop();

  // Re-reading returns intact original values
  const errHistory2 = sim.getDeathListenerErrors();
  assert.equal(errHistory2.length, 2);
  assert.equal(errHistory2[0].organismId, orgs[1].id);
  assert.equal(errHistory2[0].cause, 'disease');
  assert.equal((errHistory2[0].error as Error).name, 'TypeError');
  assert.equal((errHistory2[0].error as Error).message, 'mutated-externally-later');
  assert.equal(errHistory2[1].organismId, orgs[2].id);
  assert.equal(errHistory2[1].cause, 'injury');
});

test('Hardening 2.2.1a.1: DeathListenerError safely snapshots non-Error objects and primitives without freezing external objects', () => {
  const grid = createLandGrid(8, 8, 'non-error-snapshot');
  const sim = new BiologySimulation({ grid, seed: 'non-err-snap' });
  const orgs = sim.spawnFounderPopulation('raptor', 2);

  const externalPayload: Record<string, unknown> = { code: 'E_FAIL', meta: { step: 1 } };
  externalPayload.self = externalPayload; // circular reference

  let step = 0;
  sim.onDeath(() => {
    step += 1;
    if (step === 1) throw externalPayload;
    throw 'string-failure';
  });

  sim.killOrganism('raptor', orgs[0].id, 'injury');
  assert.equal(Object.isFrozen(externalPayload), false, 'External thrown object must NOT be frozen');
  (externalPayload.meta as { step: number }).step = 999;

  sim.killOrganism('raptor', orgs[1].id, 'disease');

  const errors = sim.getDeathListenerErrors();
  assert.equal(errors.length, 2);
  assert.equal(Object.isFrozen(errors[0]), true);
  assert.equal(Object.isFrozen(errors[0].error), true);
  const snapObj = errors[0].error as { code: string; meta: { step: number }; self: string };
  assert.equal(snapObj.code, 'E_FAIL');
  assert.equal(snapObj.meta.step, 1);
  assert.equal(snapObj.self, '[Circular]');
  assert.equal(Object.isFrozen(snapObj.meta), true);
  assert.throws(() => {
    snapObj.meta.step = 42;
  }, TypeError);

  assert.equal(Object.isFrozen(errors[1]), true);
  assert.equal(errors[1].error, 'string-failure');
});

