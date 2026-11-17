import { WorldGrid } from '../worldGrid';

/**
 * Navigation subsystem for spatial biology (`src/sim/biology/spatialNavigation.ts`).
 *
 * Strictly read-only toward `WorldGrid`: it derives per-mobility-class passability, movement cost
 * and connected components from terrain (plus an optional obstacle layer) and never touches world
 * generation. The map is FINITE: no neighbor query ever wraps across an edge.
 *
 * Two tiers, as required for large populations:
 *   1. cheap local stepping (`stepToward`, `canStep`) - O(8) per organism per tick;
 *   2. rare long-range planning (`findPath`) - bounded A* with a per-request node limit, a global
 *      per-tick node/request budget and a per-tick path cache shared by organisms that travel
 *      between the same cells (group movement).
 *
 * Everything derived here is a pure function of the grid, so it is not part of the transactional
 * simulation state: an aborted tick needs no rollback of navigation data.
 */

/** Moore neighborhood in the canonical `worldGrid.ts` order: N, NE, E, SE, S, SW, W, NW. */
export const NAV_DX = new Int8Array([0, 1, 1, 1, 0, -1, -1, -1]);
export const NAV_DY = new Int8Array([-1, -1, 0, 1, 1, 1, 0, -1]);
const DIR_COST = new Float32Array([1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2]);

export const PATH_FOUND = 0;
/** Node limit hit: waypoints lead to the explored cell closest to the goal. */
export const PATH_PARTIAL = 1;
/** Goal is impassable, in another connected component, or walled off by hazard limits. */
export const PATH_UNREACHABLE = 2;
/** Start equals goal. */
export const PATH_TRIVIAL = 3;
/** Per-tick planning budget exhausted; ask again on a later tick. */
export const PATH_DEFERRED = 4;

export type PathStatus = 0 | 1 | 2 | 3 | 4;

export const DEFAULT_OBSTACLE_LAYER = 'nav:obstacle';

export interface SpatialNavigatorOptions {
  /** A* closed-node limit for a single request (default 2048). */
  readonly maxNodesPerRequest?: number;
  /** Total A* closed nodes allowed per tick across all requests (default 60 000). */
  readonly nodeBudgetPerTick?: number;
  /** Maximum uncached A* requests per tick (default 256). */
  readonly maxRequestsPerTick?: number;
  /** Optional WorldGrid custom layer; cells with a value > 0 are impassable for every class. */
  readonly obstacleLayerName?: string;
}

export interface NavigatorTickStats {
  requests: number;
  cacheHits: number;
  deferred: number;
  nodesExpanded: number;
}

/** Step direction (0..7) for a unit cell delta, or -1 for a zero delta. */
export function directionOf(dx: number, dy: number): number {
  if (dx === 0) return dy < 0 ? 0 : dy > 0 ? 4 : -1;
  if (dx > 0) return dy < 0 ? 1 : dy === 0 ? 2 : 3;
  return dy > 0 ? 5 : dy === 0 ? 6 : 7;
}

export function octileDistance(dx: number, dy: number): number {
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  return ax > ay ? ax + ay * (Math.SQRT2 - 1) : ay + ax * (Math.SQRT2 - 1);
}

export class SpatialNavigator {
  public readonly grid: WorldGrid;
  public readonly width: number;
  public readonly height: number;
  public readonly cellCount: number;
  public readonly classCount: number;
  public readonly maxNodesPerRequest: number;
  public readonly nodeBudgetPerTick: number;
  public readonly maxRequestsPerTick: number;
  public readonly obstacleLayerName: string;

  /** Per-class movement cost of ENTERING a cell (`0` = impassable). */
  public readonly stepCost: Float32Array[];
  /** Per-class connected component label of a cell (`-1` = impassable). */
  public readonly component: Int32Array[];
  /** Per-class cheapest positive step cost (admissible A* heuristic scale). */
  public readonly minCost: Float32Array;
  /** Per-class number of passable cells. */
  public readonly passableCount: Int32Array;

  /** Incremented whenever passability data is rebuilt; stored routes from older epochs are stale. */
  public epoch = 0;
  public readonly tickStats: NavigatorTickStats = { requests: 0, cacheHits: 0, deferred: 0, nodesExpanded: 0 };
  public totalRequests = 0;
  public totalNodesExpanded = 0;

  /** Waypoint count written by the last `findPath` call. */
  public lastWaypointCount = 0;
  /** True when the last path's stored waypoints stop short of its end (waypoint buffer full). */
  public lastTruncated = false;

  private readonly terrainCostByClass: Float32Array[];
  private signature = 0;

  // A* scratch (generation-stamped so nothing is cleared between searches)
  private readonly gScore: Float32Array;
  private readonly parentDir: Int8Array;
  private readonly seenGen: Uint32Array;
  private readonly closedGen: Uint32Array;
  private generation = 0;
  private heapCell: Int32Array;
  private heapF: Float64Array;
  private heapSize = 0;
  private readonly pathScratch: Int32Array;
  private readonly floodQueue: Int32Array;

  // Per-tick path cache
  private readonly cacheIndex = new Map<number, number>();
  private cachePool: Int32Array;
  private cacheCount = 0;
  private readonly cacheStride: number;
  private static readonly CACHE_WAYPOINTS = 16;

  constructor(grid: WorldGrid, terrainCostByClass: readonly Float32Array[], options: SpatialNavigatorOptions = {}) {
    if (terrainCostByClass.length === 0) {
      throw new RangeError('SpatialNavigator requires at least one mobility class');
    }
    this.grid = grid;
    this.width = grid.width;
    this.height = grid.height;
    this.cellCount = grid.cellCount;
    this.classCount = terrainCostByClass.length;
    this.maxNodesPerRequest = options.maxNodesPerRequest ?? 2048;
    this.nodeBudgetPerTick = options.nodeBudgetPerTick ?? 60_000;
    this.maxRequestsPerTick = options.maxRequestsPerTick ?? 256;
    this.obstacleLayerName = options.obstacleLayerName ?? DEFAULT_OBSTACLE_LAYER;
    for (const [name, v] of [
      ['maxNodesPerRequest', this.maxNodesPerRequest],
      ['nodeBudgetPerTick', this.nodeBudgetPerTick],
      ['maxRequestsPerTick', this.maxRequestsPerTick],
    ] as const) {
      if (!Number.isInteger(v) || v < 1) {
        throw new RangeError(`SpatialNavigator ${name} must be a positive integer, received: ${v}`);
      }
    }

    this.terrainCostByClass = terrainCostByClass.map((t) => Float32Array.from(t));
    this.stepCost = [];
    this.component = [];
    for (let c = 0; c < this.classCount; c++) {
      this.stepCost.push(new Float32Array(this.cellCount));
      this.component.push(new Int32Array(this.cellCount));
    }
    this.minCost = new Float32Array(this.classCount);
    this.passableCount = new Int32Array(this.classCount);

    this.gScore = new Float32Array(this.cellCount);
    this.parentDir = new Int8Array(this.cellCount);
    this.seenGen = new Uint32Array(this.cellCount);
    this.closedGen = new Uint32Array(this.cellCount);
    const heapCap = Math.min(this.cellCount, this.maxNodesPerRequest) * 8 + 16;
    this.heapCell = new Int32Array(heapCap);
    this.heapF = new Float64Array(heapCap);
    this.pathScratch = new Int32Array(Math.min(this.cellCount, this.maxNodesPerRequest) + 2);
    this.floodQueue = new Int32Array(this.cellCount);

    this.cacheStride = SpatialNavigator.CACHE_WAYPOINTS + 3;
    this.cachePool = new Int32Array(this.cacheStride * 64);

    this.signature = this.computeSignature();
    this.rebuild();
  }

  /** FNV-1a over terrain codes and the obstacle layer: cheap detector for external world edits. */
  private computeSignature(): number {
    const terrain = this.grid.terrainCode;
    const obstacle = this.grid.getLayer(this.obstacleLayerName);
    let h = 2166136261 >>> 0;
    const n = this.cellCount;
    if (obstacle) {
      for (let i = 0; i < n; i++) {
        h ^= terrain[i] | (obstacle[i] > 0 ? 0x80 : 0);
        h = Math.imul(h, 16777619);
      }
    } else {
      for (let i = 0; i < n; i++) {
        h ^= terrain[i];
        h = Math.imul(h, 16777619);
      }
    }
    return h >>> 0;
  }

  /** Rebuilds passability, movement cost and connected components from the current grid. */
  rebuild(): void {
    const terrain = this.grid.terrainCode;
    const obstacle = this.grid.getLayer(this.obstacleLayerName);
    const n = this.cellCount;
    for (let c = 0; c < this.classCount; c++) {
      const table = this.terrainCostByClass[c];
      const cost = this.stepCost[c];
      let min = Infinity;
      let passable = 0;
      for (let i = 0; i < n; i++) {
        const v = obstacle !== undefined && obstacle[i] > 0 ? 0 : table[terrain[i]];
        cost[i] = v;
        if (v > 0) {
          passable++;
          if (v < min) min = v;
        }
      }
      this.minCost[c] = passable > 0 ? min : 1;
      this.passableCount[c] = passable;
      this.labelComponents(c);
    }
    this.epoch++;
    this.clearCache();
  }

  /** Re-derives navigation data iff terrain / obstacles changed since the last build. */
  refreshIfChanged(): boolean {
    const sig = this.computeSignature();
    if (sig === this.signature) return false;
    this.signature = sig;
    this.rebuild();
    return true;
  }

  private labelComponents(cls: number): void {
    const cost = this.stepCost[cls];
    const comp = this.component[cls];
    const queue = this.floodQueue;
    const w = this.width;
    const h = this.height;
    comp.fill(-1);
    let label = 0;
    for (let seed = 0; seed < this.cellCount; seed++) {
      if (cost[seed] <= 0 || comp[seed] !== -1) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = seed;
      comp[seed] = label;
      while (head < tail) {
        const cell = queue[head++];
        const cy = (cell / w) | 0;
        const cx = cell - cy * w;
        for (let d = 0; d < 8; d++) {
          const nx = cx + NAV_DX[d];
          const ny = cy + NAV_DY[d];
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nIdx = ny * w + nx;
          if (cost[nIdx] <= 0 || comp[nIdx] !== -1) continue;
          if ((d & 1) === 1 && (cost[cy * w + nx] <= 0 || cost[ny * w + cx] <= 0)) continue;
          comp[nIdx] = label;
          queue[tail++] = nIdx;
        }
      }
      label++;
    }
  }

  beginTick(): void {
    this.tickStats.requests = 0;
    this.tickStats.cacheHits = 0;
    this.tickStats.deferred = 0;
    this.tickStats.nodesExpanded = 0;
    this.clearCache();
  }

  private clearCache(): void {
    if (this.cacheCount > 0) {
      this.cacheIndex.clear();
      this.cacheCount = 0;
    }
  }

  isPassable(cls: number, cell: number): boolean {
    return cell >= 0 && cell < this.cellCount && this.stepCost[cls][cell] > 0;
  }

  sameComponent(cls: number, a: number, b: number): boolean {
    const comp = this.component[cls];
    const ca = comp[a];
    return ca >= 0 && ca === comp[b];
  }

  /**
   * Destination cell of a single step from `from` in direction `dir`, or `-1` when the step leaves
   * the finite map, enters an impassable cell, or would cut a corner between two blocked cells.
   */
  canStep(cls: number, from: number, dir: number): number {
    const w = this.width;
    const fy = (from / w) | 0;
    const fx = from - fy * w;
    const nx = fx + NAV_DX[dir];
    const ny = fy + NAV_DY[dir];
    if (nx < 0 || nx >= w || ny < 0 || ny >= this.height) return -1;
    const cost = this.stepCost[cls];
    const dest = ny * w + nx;
    if (cost[dest] <= 0) return -1;
    if ((dir & 1) === 1 && (cost[fy * w + nx] <= 0 || cost[ny * w + fx] <= 0)) return -1;
    return dest;
  }

  /** Path cost of one step in direction `dir` into `dest`. */
  stepCostOf(cls: number, dest: number, dir: number): number {
    return this.stepCost[cls][dest] * DIR_COST[dir];
  }

  /**
   * Cheap local steering: the legal neighbor of `from` closest (octile) to `target`.
   * Cells whose temperature lies outside `[tLo, tHi]` and the cell `avoid` are skipped.
   * Returns `-1` when no legal neighbor exists. Never plans; O(8).
   */
  stepToward(cls: number, from: number, target: number, avoid: number, tLo: number, tHi: number): number {
    const w = this.width;
    const h = this.height;
    const cost = this.stepCost[cls];
    const temps = this.grid.temperature;
    const fy = (from / w) | 0;
    const fx = from - fy * w;
    const ty = (target / w) | 0;
    const tx = target - ty * w;
    let best = -1;
    let bestScore = Infinity;
    for (let d = 0; d < 8; d++) {
      const nx = fx + NAV_DX[d];
      const ny = fy + NAV_DY[d];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const dest = ny * w + nx;
      const c = cost[dest];
      if (c <= 0 || dest === avoid) continue;
      if ((d & 1) === 1 && (cost[fy * w + nx] <= 0 || cost[ny * w + fx] <= 0)) continue;
      const t = temps[dest];
      if (t < tLo || t > tHi) continue;
      const score = octileDistance(tx - nx, ty - ny) + c * DIR_COST[d] * 0.001;
      if (score < bestScore) {
        bestScore = score;
        best = dest;
      }
    }
    return best;
  }

  private heapPush(cell: number, f: number): void {
    if (this.heapSize >= this.heapCell.length) {
      const nextCap = this.heapCell.length * 2;
      const nc = new Int32Array(nextCap);
      nc.set(this.heapCell);
      this.heapCell = nc;
      const nf = new Float64Array(nextCap);
      nf.set(this.heapF);
      this.heapF = nf;
    }
    const hc = this.heapCell;
    const hf = this.heapF;
    let i = this.heapSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pf = hf[p];
      if (pf < f || (pf === f && hc[p] <= cell)) break;
      hc[i] = hc[p];
      hf[i] = pf;
      i = p;
    }
    hc[i] = cell;
    hf[i] = f;
  }

  private heapPop(): number {
    const hc = this.heapCell;
    const hf = this.heapF;
    const top = hc[0];
    const n = --this.heapSize;
    if (n > 0) {
      const cell = hc[n];
      const f = hf[n];
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        const r = child + 1;
        if (r < n && (hf[r] < hf[child] || (hf[r] === hf[child] && hc[r] < hc[child]))) child = r;
        if (f < hf[child] || (f === hf[child] && cell <= hc[child])) break;
        hc[i] = hc[child];
        hf[i] = hf[child];
        i = child;
      }
      hc[i] = cell;
      hf[i] = f;
    }
    return top;
  }

  /**
   * Bounded A* from `start` to `goal` for mobility class `cls`.
   *
   * Cells whose temperature lies outside `[tLo, tHi]` are treated as impassable (lethal-condition
   * avoidance); pass `-Infinity / Infinity` to disable. On `PATH_FOUND` / `PATH_PARTIAL` the route is
   * written to `out[outOffset ..]` as up to `maxWaypoints` direction-change waypoints (the last one
   * is the route end) and `lastWaypointCount` / `lastTruncated` are set.
   */
  findPath(
    cls: number,
    start: number,
    goal: number,
    tLo: number,
    tHi: number,
    out: Int32Array,
    outOffset: number,
    maxWaypoints: number
  ): PathStatus {
    this.lastWaypointCount = 0;
    this.lastTruncated = false;
    if (start === goal) return PATH_TRIVIAL;
    const cost = this.stepCost[cls];
    const comp = this.component[cls];
    if (start < 0 || goal < 0 || start >= this.cellCount || goal >= this.cellCount) return PATH_UNREACHABLE;
    if (cost[goal] <= 0 || comp[start] < 0 || comp[start] !== comp[goal]) return PATH_UNREACHABLE;

    const unconstrained = tLo === -Infinity && tHi === Infinity;
    const cacheKey = (start * this.cellCount + goal) * this.classCount + cls;
    if (unconstrained) {
      const hit = this.cacheIndex.get(cacheKey);
      if (hit !== undefined) {
        this.tickStats.cacheHits++;
        return this.readCache(hit, out, outOffset, maxWaypoints);
      }
    }

    if (
      this.tickStats.requests >= this.maxRequestsPerTick ||
      this.tickStats.nodesExpanded >= this.nodeBudgetPerTick
    ) {
      this.tickStats.deferred++;
      return PATH_DEFERRED;
    }
    this.tickStats.requests++;
    this.totalRequests++;

    const w = this.width;
    const h = this.height;
    const temps = this.grid.temperature;
    const g = this.gScore;
    const parentDir = this.parentDir;
    const seen = this.seenGen;
    const closed = this.closedGen;
    let gen = ++this.generation;
    if (gen >= 0xfffffff0) {
      seen.fill(0);
      closed.fill(0);
      this.generation = 1;
      gen = 1;
    }
    const hScale = this.minCost[cls];
    const gy = (goal / w) | 0;
    const gx = goal - gy * w;

    this.heapSize = 0;
    g[start] = 0;
    seen[start] = gen;
    parentDir[start] = -1;
    const sy = (start / w) | 0;
    const sx = start - sy * w;
    this.heapPush(start, octileDistance(gx - sx, gy - sy) * hScale);

    let bestCell = start;
    let bestH = octileDistance(gx - sx, gy - sy);
    let lastPopped = start;
    let expanded = 0;
    let found = false;
    let hazardBlocked = false;
    const maxNodes = this.maxNodesPerRequest;

    while (this.heapSize > 0) {
      const cell = this.heapPop();
      if (closed[cell] === gen) continue;
      closed[cell] = gen;
      if (cell === goal) {
        found = true;
        break;
      }
      if (++expanded > maxNodes) break;
      lastPopped = cell;
      const cy = (cell / w) | 0;
      const cx = cell - cy * w;
      const hCell = octileDistance(gx - cx, gy - cy);
      if (hCell < bestH) {
        bestH = hCell;
        bestCell = cell;
      }
      const gCell = g[cell];
      for (let d = 0; d < 8; d++) {
        const nx = cx + NAV_DX[d];
        const ny = cy + NAV_DY[d];
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const nIdx = ny * w + nx;
        const c = cost[nIdx];
        if (c <= 0 || closed[nIdx] === gen) continue;
        if ((d & 1) === 1 && (cost[cy * w + nx] <= 0 || cost[ny * w + cx] <= 0)) continue;
        if (!unconstrained) {
          const t = temps[nIdx];
          if (t < tLo || t > tHi) {
            hazardBlocked = true;
            continue;
          }
        }
        const ng = gCell + c * DIR_COST[d];
        if (seen[nIdx] !== gen || ng < g[nIdx]) {
          seen[nIdx] = gen;
          g[nIdx] = ng;
          parentDir[nIdx] = d;
          this.heapPush(nIdx, ng + octileDistance(gx - nx, gy - ny) * hScale);
        }
      }
    }
    this.tickStats.nodesExpanded += expanded;
    this.totalNodesExpanded += expanded;

    let status: PathStatus;
    let endCell: number;
    if (found) {
      status = PATH_FOUND;
      endCell = goal;
    } else if (expanded > maxNodes) {
      // Node limit: head for the explored cell nearest the goal, or (when a detour first leads
      // away from it) for the most promising frontier cell, and re-plan from there.
      status = PATH_PARTIAL;
      endCell = bestCell !== start ? bestCell : lastPopped;
      if (endCell === start) status = PATH_UNREACHABLE;
    } else {
      // Open set exhausted: the goal is walled off by hazard limits
      status = PATH_UNREACHABLE;
      endCell = start;
    }

    if (status !== PATH_UNREACHABLE) {
      // Reconstruct end -> start, then emit direction-change waypoints start -> end
      const scratch = this.pathScratch;
      let len = 0;
      let cur = endCell;
      while (cur !== start && len < scratch.length) {
        scratch[len++] = cur;
        const d = parentDir[cur];
        cur = cur - NAV_DX[d] - NAV_DY[d] * w;
      }
      let count = 0;
      let prevDir = -2;
      let truncated = false;
      for (let i = len - 1; i >= 0; i--) {
        const d = parentDir[scratch[i]];
        if (prevDir !== -2 && d !== prevDir) {
          if (count >= maxWaypoints) {
            truncated = true;
            break;
          }
          out[outOffset + count++] = scratch[i + 1];
        }
        prevDir = d;
      }
      if (!truncated) {
        if (count >= maxWaypoints) {
          truncated = true;
        } else {
          out[outOffset + count++] = endCell;
        }
      }
      this.lastWaypointCount = count;
      this.lastTruncated = truncated;
    }

    if (unconstrained || !hazardBlocked) {
      this.writeCache(cacheKey, status, out, outOffset);
    }
    return status;
  }

  private writeCache(key: number, status: PathStatus, out: Int32Array, outOffset: number): void {
    const count = this.lastWaypointCount;
    if (count > SpatialNavigator.CACHE_WAYPOINTS) return;
    const stride = this.cacheStride;
    if ((this.cacheCount + 1) * stride > this.cachePool.length) {
      const next = new Int32Array(this.cachePool.length * 2);
      next.set(this.cachePool);
      this.cachePool = next;
    }
    const base = this.cacheCount * stride;
    const pool = this.cachePool;
    pool[base] = status;
    pool[base + 1] = count;
    pool[base + 2] = this.lastTruncated ? 1 : 0;
    for (let i = 0; i < count; i++) pool[base + 3 + i] = out[outOffset + i];
    this.cacheIndex.set(key, this.cacheCount++);
  }

  private readCache(entry: number, out: Int32Array, outOffset: number, maxWaypoints: number): PathStatus {
    const base = entry * this.cacheStride;
    const pool = this.cachePool;
    const status = pool[base] as PathStatus;
    const stored = pool[base + 1];
    const count = stored < maxWaypoints ? stored : maxWaypoints;
    for (let i = 0; i < count; i++) out[outOffset + i] = pool[base + 3 + i];
    this.lastWaypointCount = count;
    this.lastTruncated = pool[base + 2] === 1 || count < stored;
    return status;
  }
}
