import assert from 'node:assert/strict';
import test from 'node:test';
import { TerrainType, WorldGrid } from '../worldGrid';
import {
  DEFAULT_OBSTACLE_LAYER,
  NAV_DX,
  NAV_DY,
  PATH_DEFERRED,
  PATH_FOUND,
  PATH_PARTIAL,
  PATH_TRIVIAL,
  PATH_UNREACHABLE,
  SpatialNavigator,
  directionOf,
  octileDistance,
} from './spatialNavigation';
import { buildTerrainCostByCode, resolveSpatialSpeciesProfile } from './spatialProfile';

/** Uniform walkable plain; individual cells are then reshaped with WorldGrid.setCell. */
function makeFlatGrid(width: number, height: number, seed = 'nav-flat'): WorldGrid {
  const grid = WorldGrid.generate({ width, height, seed });
  for (let i = 0; i < grid.cellCount; i++) {
    grid.setCellByIndex(i, { elevation: 0.5, temperature: 20, moisture: 0.55 });
  }
  return grid;
}

function setTerrain(grid: WorldGrid, x: number, y: number, terrain: TerrainType): void {
  assert.equal(grid.setCell(x, y, { terrain }), true);
}

const LAND = buildTerrainCostByCode(resolveSpatialSpeciesProfile('herbivore'));
const AMPHIBIOUS = buildTerrainCostByCode(resolveSpatialSpeciesProfile('herbivore', { locomotion: 'amphibious' }));
const AQUATIC = buildTerrainCostByCode(resolveSpatialSpeciesProfile('carnivore', { locomotion: 'aquatic' }));

/** Expands direction-change waypoints into the full cell sequence and validates every step. */
function walkWaypoints(nav: SpatialNavigator, cls: number, start: number, waypoints: number[]): number[] {
  const w = nav.width;
  const cells = [start];
  let cur = start;
  for (const wp of waypoints) {
    let guard = 0;
    while (cur !== wp) {
      const cy = Math.floor(cur / w);
      const cx = cur - cy * w;
      const ty = Math.floor(wp / w);
      const tx = wp - ty * w;
      const dir = directionOf(Math.sign(tx - cx), Math.sign(ty - cy));
      const next = nav.canStep(cls, cur, dir);
      assert.notEqual(next, -1, `waypoint segment must be walkable from cell ${cur} toward ${wp}`);
      cur = next;
      cells.push(cur);
      assert.ok(guard++ < nav.cellCount, 'waypoint walk must terminate');
    }
  }
  return cells;
}

test('SpatialNavigator: finite map - no step, neighbor or path ever crosses an edge', () => {
  const grid = makeFlatGrid(12, 8);
  const nav = new SpatialNavigator(grid, [LAND]);
  const w = grid.width;
  const h = grid.height;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = y * w + x;
      for (let dir = 0; dir < 8; dir++) {
        const nx = x + NAV_DX[dir];
        const ny = y + NAV_DY[dir];
        const dest = nav.canStep(0, cell, dir);
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
          assert.equal(dest, -1, `step off the map from (${x},${y}) dir ${dir} must be rejected`);
        } else {
          assert.equal(dest, ny * w + nx);
        }
      }
    }
  }

  // West edge to east edge on the same row: the route is the full width, never a 1-cell wrap
  const out = new Int32Array(16);
  const start = 3 * w + 0;
  const goal = 3 * w + (w - 1);
  assert.equal(nav.findPath(0, start, goal, -Infinity, Infinity, out, 0, 16), PATH_FOUND);
  const cells = walkWaypoints(nav, 0, start, Array.from(out.subarray(0, nav.lastWaypointCount)));
  assert.equal(cells.length, w, 'edge-to-edge route must traverse every column');
  assert.equal(cells[cells.length - 1], goal);

  // Local steering at the west edge toward a target on the east edge moves east, not "left"
  const next = nav.stepToward(0, start, goal, -1, -Infinity, Infinity);
  assert.equal(next % w, 1);
});

test('SpatialNavigator: obstacles, no corner cutting, mobility classes and connected components', () => {
  const grid = makeFlatGrid(10, 7);
  // Vertical deep-water channel at x = 4 with a single land bridge at y = 5
  for (let y = 0; y < 7; y++) {
    if (y !== 5) setTerrain(grid, 4, y, 'deep-water');
  }
  // Shallow ford at y = 1 (amphibious only)
  setTerrain(grid, 4, 1, 'shallow-water');
  // Impassable peak wall on the east side
  setTerrain(grid, 8, 3, 'peak');
  const nav = new SpatialNavigator(grid, [LAND, AMPHIBIOUS, AQUATIC]);
  const w = grid.width;
  const cellOf = (x: number, y: number) => y * w + x;

  assert.equal(nav.isPassable(0, cellOf(4, 0)), false, 'land walkers cannot enter deep water');
  assert.equal(nav.isPassable(0, cellOf(4, 1)), false, 'land walkers cannot enter shallow water');
  assert.equal(nav.isPassable(1, cellOf(4, 1)), true, 'amphibious species wade through shallow water');
  assert.equal(nav.isPassable(1, cellOf(4, 0)), false);
  assert.equal(nav.isPassable(2, cellOf(4, 0)), true, 'aquatic species live in water');
  assert.equal(nav.isPassable(2, cellOf(2, 2)), false, 'aquatic species cannot leave the water');
  assert.equal(nav.isPassable(0, cellOf(8, 3)), false, 'peaks are impassable');

  // Land walker must detour through the bridge at (4,5)
  const out = new Int32Array(16);
  const start = cellOf(1, 1);
  const goal = cellOf(7, 1);
  assert.equal(nav.findPath(0, start, goal, -Infinity, Infinity, out, 0, 16), PATH_FOUND);
  const landRoute = walkWaypoints(nav, 0, start, Array.from(out.subarray(0, nav.lastWaypointCount)));
  assert.ok(landRoute.includes(cellOf(4, 5)), 'land route must use the only bridge');
  for (const c of landRoute) assert.ok(nav.isPassable(0, c), `route cell ${c} must be passable`);

  // Amphibious walker takes the much shorter ford
  assert.equal(nav.findPath(1, start, goal, -Infinity, Infinity, out, 0, 16), PATH_FOUND);
  const fordRoute = walkWaypoints(nav, 1, start, Array.from(out.subarray(0, nav.lastWaypointCount)));
  assert.ok(fordRoute.includes(cellOf(4, 1)), 'amphibious route must use the ford');
  assert.ok(fordRoute.length < landRoute.length);

  // No corner cutting: a diagonal between two blocked orthogonal neighbors is illegal
  const g2 = makeFlatGrid(4, 4, 'nav-corner');
  setTerrain(g2, 1, 0, 'peak');
  setTerrain(g2, 0, 1, 'peak');
  const nav2 = new SpatialNavigator(g2, [LAND]);
  assert.equal(nav2.canStep(0, 0, directionOf(1, 1)), -1, 'cannot squeeze diagonally between two blocked cells');
  assert.equal(nav2.sameComponent(0, 0, 5), false, 'corner cell is its own component');
  assert.equal(nav2.findPath(0, 0, 5, -Infinity, Infinity, out, 0, 16), PATH_UNREACHABLE);

  // Removing the bridge splits the land into two components: unreachable is detected without search
  setTerrain(grid, 4, 5, 'deep-water');
  assert.equal(nav.refreshIfChanged(), true);
  assert.equal(nav.refreshIfChanged(), false, 'unchanged terrain must not trigger a rebuild');
  assert.equal(nav.sameComponent(0, start, goal), false);
  const requestsBefore = nav.totalRequests;
  assert.equal(nav.findPath(0, start, goal, -Infinity, Infinity, out, 0, 16), PATH_UNREACHABLE);
  assert.equal(nav.totalRequests, requestsBefore, 'component check answers unreachable goals for free');
  assert.equal(nav.findPath(0, start, start, -Infinity, Infinity, out, 0, 16), PATH_TRIVIAL);
});

test('SpatialNavigator: obstacle layer, hazard limits, route changes and epoch invalidation', () => {
  const grid = makeFlatGrid(9, 5);
  const nav = new SpatialNavigator(grid, [LAND]);
  const w = grid.width;
  const cellOf = (x: number, y: number) => y * w + x;
  const out = new Int32Array(16);
  const start = cellOf(0, 2);
  const goal = cellOf(8, 2);

  assert.equal(nav.findPath(0, start, goal, -Infinity, Infinity, out, 0, 16), PATH_FOUND);
  const direct = walkWaypoints(nav, 0, start, Array.from(out.subarray(0, nav.lastWaypointCount)));
  assert.equal(direct.length, 9);

  // A structure appears: obstacle layer wall at x = 4 except y = 0
  const epochBefore = nav.epoch;
  const layer = grid.ensureLayer(DEFAULT_OBSTACLE_LAYER, 0);
  for (let y = 1; y < 5; y++) layer[cellOf(4, y)] = 1;
  assert.equal(nav.refreshIfChanged(), true);
  assert.ok(nav.epoch > epochBefore, 'stored routes must be invalidated by a new epoch');
  assert.equal(nav.findPath(0, start, goal, -Infinity, Infinity, out, 0, 16), PATH_FOUND);
  const detour = walkWaypoints(nav, 0, start, Array.from(out.subarray(0, nav.lastWaypointCount)));
  assert.ok(detour.includes(cellOf(4, 0)), 'new route must pass through the only gap');
  const pathCost = (cells: number[]) => {
    let cost = 0;
    for (let i = 1; i < cells.length; i++) {
      const dx = (cells[i] % w) - (cells[i - 1] % w);
      const dy = Math.floor(cells[i] / w) - Math.floor(cells[i - 1] / w);
      cost += dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
    }
    return cost;
  };
  assert.ok(pathCost(detour) > pathCost(direct), 'the detour must be longer than the blocked straight line');

  // Hazard limits: the gap becomes lethally hot -> the goal is walled off for this traveller
  grid.setCell(4, 0, { temperature: 55 });
  assert.equal(nav.findPath(0, start, goal, -10, 40, out, 0, 16), PATH_UNREACHABLE);
  assert.equal(nav.findPath(0, start, goal, -Infinity, Infinity, out, 0, 16), PATH_FOUND);
  assert.equal(nav.stepToward(0, cellOf(3, 0), cellOf(5, 0), -1, -10, 40) === cellOf(4, 0), false);
});

test('SpatialNavigator: bounded search, per-tick budget, cache sharing and deterministic results', () => {
  const grid = makeFlatGrid(40, 30);
  // Long wall forcing a detour larger than a tiny node budget can explore
  for (let y = 0; y < 28; y++) setTerrain(grid, 20, y, 'peak');
  const tight = new SpatialNavigator(grid, [LAND], { maxNodesPerRequest: 40, nodeBudgetPerTick: 80, maxRequestsPerTick: 2 });
  const w = grid.width;
  const cellOf = (x: number, y: number) => y * w + x;
  const out = new Int32Array(8);
  const start = cellOf(18, 2);
  const goal = cellOf(22, 2);

  tight.beginTick();
  const s1 = tight.findPath(0, start, goal, -Infinity, Infinity, out, 0, 8);
  assert.equal(s1, PATH_PARTIAL, 'node limit must yield a partial route, not a full-map search');
  assert.ok(tight.lastWaypointCount >= 1);
  assert.ok(tight.tickStats.nodesExpanded <= 41);
  // Same request again in the same tick is served from the cache (group movement)
  const first = Array.from(out.subarray(0, tight.lastWaypointCount));
  assert.equal(tight.findPath(0, start, goal, -Infinity, Infinity, out, 0, 8), PATH_PARTIAL);
  assert.equal(tight.tickStats.cacheHits, 1);
  assert.deepEqual(Array.from(out.subarray(0, tight.lastWaypointCount)), first);
  // Budget: after two uncached requests further planning is deferred to a later tick
  assert.notEqual(tight.findPath(0, cellOf(1, 1), cellOf(10, 20), -Infinity, Infinity, out, 0, 8), PATH_DEFERRED);
  assert.equal(tight.findPath(0, cellOf(2, 2), cellOf(11, 21), -Infinity, Infinity, out, 0, 8), PATH_DEFERRED);
  assert.equal(tight.tickStats.deferred, 1);
  tight.beginTick();
  assert.notEqual(tight.findPath(0, cellOf(2, 2), cellOf(11, 21), -Infinity, Infinity, out, 0, 8), PATH_DEFERRED);

  // A generous navigator finds the real detour and two instances agree bit-for-bit
  const a = new SpatialNavigator(grid, [LAND]);
  const b = new SpatialNavigator(grid, [LAND]);
  const outA = new Int32Array(16);
  const outB = new Int32Array(16);
  assert.equal(a.findPath(0, start, goal, -Infinity, Infinity, outA, 0, 16), PATH_FOUND);
  assert.equal(b.findPath(0, start, goal, -Infinity, Infinity, outB, 0, 16), PATH_FOUND);
  assert.deepEqual(outA, outB);
  const route = walkWaypoints(a, 0, start, Array.from(outA.subarray(0, a.lastWaypointCount)));
  assert.ok(route.some((c) => Math.floor(c / w) >= 28), 'route must go around the south end of the wall');
  // Path cost is at least the octile lower bound and every step is to an adjacent cell
  assert.ok(route.length - 1 >= octileDistance(4, 0));
  for (let i = 1; i < route.length; i++) {
    const dx = (route[i] % w) - (route[i - 1] % w);
    const dy = Math.floor(route[i] / w) - Math.floor(route[i - 1] / w);
    assert.ok(Math.abs(dx) <= 1 && Math.abs(dy) <= 1, 'route must be contiguous (no teleport)');
  }
});
