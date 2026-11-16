import { WorldGrid } from '../worldGrid';
import {
  DeathCause,
  LifeStage,
  Organism,
  assertValidDeathCause,
} from './organism';
import { SpeciesDefinition } from './species';

export type OrganismOrigin = 'birth' | 'introduced';

/**
 * Validates a DeathCause identifier, rejecting non-strings, empty/whitespace-only values,
 * and causes containing leading or trailing whitespace.
 */
export function validateDeathCauseStrict(cause: DeathCause): DeathCause {
  const valid = assertValidDeathCause(cause);
  if (valid.trim() !== valid) {
    throw new RangeError(
      `DeathCause must not contain leading or trailing whitespace, received: "${cause}"`
    );
  }
  return valid;
}

export interface PopulationStats {
  readonly tick: number;
  readonly speciesId: string;
  readonly totalAlive: number;
  /** Total organisms introduced via founder seeding or manual spawning (never counted as biological births) */
  readonly introducedTotal: number;
  /** Total biological births resulting from reproduction */
  readonly birthsTotal: number;
  readonly deathsTotal: number;
  readonly birthsThisTick: number;
  readonly deathsThisTick: number;
  readonly deathsByCause: Readonly<Record<string, number>>;
  readonly sexCounts: Readonly<{ female: number; male: number }>;
  readonly femaleRatio: number;
  readonly stageCounts: Readonly<Record<Exclude<LifeStage, 'dead'>, number>>;
  readonly maxGeneration: number;
  readonly survivingGenerationsCount: number;
  /** Mean inherited diploid genetic expression across all living organisms */
  readonly meanGenotype: Readonly<Record<string, number>>;
  /** Mean currently expressed phenotype across all living organisms (all stages combined) */
  readonly meanPhenotype: Readonly<Record<string, number>>;
  /** Mean expressed phenotype strictly among prime adults (`stage === 'adult'`) */
  readonly meanAdultPhenotype: Readonly<Record<string, number>>;
  /** Mean expressed phenotype strictly among juveniles (`stage === 'juvenile'`) */
  readonly meanJuvenilePhenotype: Readonly<Record<string, number>>;
  /** Mean expressed phenotype strictly among incubating eggs (`stage === 'egg'`) */
  readonly meanEggPhenotype: Readonly<Record<string, number>>;
  /** Mean expressed phenotype strictly among elders (`stage === 'elder'`) */
  readonly meanElderPhenotype: Readonly<Record<string, number>>;
  /** Mean expressed phenotype among reproductively mature individuals (`adult` + `elder`) */
  readonly meanMaturePhenotype: Readonly<Record<string, number>>;
  readonly traitStdDev: Readonly<Record<string, number>>;
  readonly geneticDiversity: {
    readonly meanStdDev: number;
    readonly meanVariance: number;
    /** Mean range-normalized allelic divergence across loci: mean(|maternal - paternal| / (max - min)) in [0, 1] */
    readonly meanNormalizedAlleleDivergence: number;
    /**
     * @deprecated Unnormalized raw mean `|maternal - paternal|` across loci with differing units/ranges.
     * Retained temporarily for backward compatibility; use `meanNormalizedAlleleDivergence` instead.
     */
    readonly meanHeterozygosity: number;
  };
}

function emptyTraitRecord(species: SpeciesDefinition): Record<string, number> {
  const out: Record<string, number> = {};
  const loci = species.genomeSchema.loci;
  for (let l = 0; l < loci.length; l++) {
    out[loci[l].id] = 0;
  }
  return out;
}

function buildMeanRecord(
  species: SpeciesDefinition,
  sums: Float64Array,
  count: number
): Record<string, number> {
  const out: Record<string, number> = {};
  const loci = species.genomeSchema.loci;
  if (count <= 0) {
    for (let l = 0; l < loci.length; l++) {
      out[loci[l].id] = 0;
    }
    return out;
  }
  const inv = 1 / count;
  for (let l = 0; l < loci.length; l++) {
    out[loci[l].id] = sums[l] * inv;
  }
  return out;
}

/**
 * Population container using a low-allocation `Int32Array` intrusive spatial hash
 * index over `WorldGrid` cells to avoid O(N^2) mate scans.
 */
export class PopulationManager {
  public readonly species: SpeciesDefinition;
  public readonly cellCount: number;

  private active: Organism[] = [];
  private byId = new Map<number, Organism>();

  // Intrusive spatial index buffers (reused across ticks; grows on capacity doubling)
  private cellHead: Int32Array;
  private cellCounts: Uint32Array;
  private nextInCell: Int32Array;
  private spatialIndexBuilt = false;

  // Reusable scratch accumulators for computeStats()
  private readonly sumGen: Float64Array;
  private readonly sumSqGen: Float64Array;
  private readonly sumPhen: Float64Array;
  private readonly sumEggPhen: Float64Array;
  private readonly sumJuvPhen: Float64Array;
  private readonly sumAdultPhen: Float64Array;
  private readonly sumElderPhen: Float64Array;
  private readonly locusInvSpan: Float64Array;
  private readonly generationsScratch = new Set<number>();
  private readonly genSeenFlags = new Uint8Array(2048);
  private readonly genDirtyList: number[] = [];

  // Cumulative counters
  private introducedTotal = 0;
  private birthsTotal = 0;
  private deathsTotal = 0;
  private birthsThisTick = 0;
  private deathsThisTick = 0;
  private readonly deathsByCause = new Map<string, number>([
    ['none', 0],
    ['old-age', 0],
    ['starvation', 0],
    ['thermal-stress', 0],
    ['incubation-failure', 0],
  ]);

  constructor(species: SpeciesDefinition, grid: WorldGrid, initialCapacity = 256) {
    this.species = species;
    this.cellCount = grid.cellCount;
    this.cellHead = new Int32Array(grid.cellCount);
    this.cellHead.fill(-1);
    this.cellCounts = new Uint32Array(grid.cellCount);
    this.nextInCell = new Int32Array(Math.max(64, initialCapacity));
    this.nextInCell.fill(-1);

    const schema = species.genomeSchema;
    const n = schema.locusCount;
    this.sumGen = new Float64Array(n);
    this.sumSqGen = new Float64Array(n);
    this.sumPhen = new Float64Array(n);
    this.sumEggPhen = new Float64Array(n);
    this.sumJuvPhen = new Float64Array(n);
    this.sumAdultPhen = new Float64Array(n);
    this.sumElderPhen = new Float64Array(n);
    this.locusInvSpan = new Float64Array(n);
    for (let l = 0; l < n; l++) {
      const def = schema.loci[l];
      const range = species.traitRanges[def.id] ?? def.defaultRange;
      const span = range.max - range.min;
      this.locusInvSpan[l] = span > 0 ? 1 / span : 0;
    }
  }

  get size(): number {
    return this.active.length;
  }

  getActiveOrganisms(): readonly Organism[] {
    return this.active;
  }

  getById(id: number): Organism | undefined {
    return this.byId.get(id);
  }

  /**
   * Reserves capacity in the intrusive spatial index buffers BEFORE transaction commit so
   * `COMMIT` can register `extraCount` newly born organisms without allocating.
   */
  reserveAdditionalCapacity(extraCount: number): void {
    if (!Number.isSafeInteger(extraCount) || extraCount < 0) {
      throw new RangeError(
        `reserveAdditionalCapacity requires a non-negative integer, received: ${extraCount}`
      );
    }
    const needed = this.active.length + extraCount;
    if (this.nextInCell.length < needed) {
      let nextCap = Math.max(64, this.nextInCell.length);
      while (nextCap < needed) nextCap *= 2;
      this.nextInCell = new Int32Array(nextCap);
      this.nextInCell.fill(-1);
    }
  }

  private assertValidOrganismForAdd(organism: Organism): void {
    if (organism.speciesId !== this.species.id) {
      throw new RangeError(
        `Cannot add organism of species "${organism.speciesId}" to "${this.species.id}" population`
      );
    }
    if (!organism.alive) {
      throw new RangeError(`Cannot add dead organism (id=${organism.id}) to active population`);
    }
    if (!Number.isSafeInteger(organism.id) || organism.id < 1) {
      throw new RangeError(`Organism id must be a positive safe integer, received: ${organism.id}`);
    }
    if (!Number.isInteger(organism.cellIndex) || organism.cellIndex < 0 || organism.cellIndex >= this.cellCount) {
      throw new RangeError(
        `Organism ${organism.id} has invalid cellIndex ${organism.cellIndex} (expected [0, ${this.cellCount}))`
      );
    }
    if (this.byId.has(organism.id)) {
      throw new RangeError(`Duplicate organism id ${organism.id} in "${this.species.id}" population`);
    }
  }

  /**
   * Validates a contiguous subrange `[start, end)` of incoming organisms without slicing.
   * Skips `Set` allocation when IDs are strictly ascending.
   */
  validateBatchRange(organisms: readonly Organism[], start: number, end: number): void {
    if (end <= start) return;
    let prevId = -1;
    let strictlyAscending = true;
    for (let i = start; i < end; i++) {
      const org = organisms[i];
      this.assertValidOrganismForAdd(org);
      if (org.id <= prevId) strictlyAscending = false;
      prevId = org.id;
    }
    if (!strictlyAscending) {
      const batchIds = new Set<number>();
      for (let i = start; i < end; i++) {
        const id = organisms[i].id;
        if (batchIds.has(id)) {
          throw new RangeError(`Duplicate organism id ${id} within addition batch`);
        }
        batchIds.add(id);
      }
    }
  }

  /**
   * Validates an entire batch of incoming organisms without mutating any population state.
   */
  validateBatchAdditions(organisms: readonly Organism[]): void {
    this.validateBatchRange(organisms, 0, organisms.length);
  }

  addOrganism(organism: Organism, origin: OrganismOrigin | boolean = 'birth'): void {
    this.assertValidOrganismForAdd(organism);
    this.active.push(organism);
    this.byId.set(organism.id, organism);

    const resolvedOrigin: OrganismOrigin =
      origin === 'birth' || origin === true ? 'birth' : 'introduced';
    if (resolvedOrigin === 'birth') {
      this.birthsTotal += 1;
      this.birthsThisTick += 1;
    } else {
      this.introducedTotal += 1;
    }
    this.spatialIndexBuilt = false;
  }

  /**
   * @internal Adds pre-validated provisioned organisms from `[start, end)` without re-validating or slicing.
   */
  addPrevalidatedRange(
    organisms: readonly Organism[],
    start: number,
    end: number,
    provisioned: Uint8Array,
    origin: OrganismOrigin | boolean = 'birth'
  ): void {
    if (end <= start) return;
    const isBirth = origin === 'birth' || origin === true;
    let added = 0;
    for (let i = start; i < end; i++) {
      if (provisioned[i] === 0) continue;
      const org = organisms[i];
      this.active.push(org);
      this.byId.set(org.id, org);
      added++;
    }
    if (added > 0) {
      if (isBirth) {
        this.birthsTotal += added;
        this.birthsThisTick += added;
      } else {
        this.introducedTotal += added;
      }
      this.spatialIndexBuilt = false;
    }
  }

  /**
   * Validates the full batch and ensures spatial index capacity before adding any organism,
   * preventing partial population registration.
   */
  addOrganismsBatch(organisms: readonly Organism[], origin: OrganismOrigin | boolean = 'birth'): void {
    if (organisms.length === 0) return;
    this.validateBatchAdditions(organisms);
    this.reserveAdditionalCapacity(organisms.length);

    const isBirth = origin === 'birth' || origin === true;
    const len = organisms.length;
    for (let i = 0; i < len; i++) {
      const org = organisms[i];
      this.active.push(org);
      this.byId.set(org.id, org);
    }
    if (isBirth) {
      this.birthsTotal += len;
      this.birthsThisTick += len;
    } else {
      this.introducedTotal += len;
    }
    this.spatialIndexBuilt = false;
  }

  beginTick(): void {
    this.birthsThisTick = 0;
    this.deathsThisTick = 0;
  }

  recordDeath(cause: DeathCause): void {
    const validCause = validateDeathCauseStrict(cause);
    this.deathsTotal += 1;
    this.deathsThisTick += 1;
    this.deathsByCause.set(validCause, (this.deathsByCause.get(validCause) ?? 0) + 1);
  }

  /**
   * Compacts dead organisms out of the active array in-place while preserving
   * ascending deterministic organism processing order.
   */
  compactDead(onRemoved?: (organism: Organism) => void): void {
    let write = 0;
    for (let read = 0; read < this.active.length; read++) {
      const org = this.active[read];
      if (org.alive) {
        if (write !== read) {
          this.active[write] = org;
        }
        write++;
      } else {
        this.byId.delete(org.id);
        if (onRemoved) {
          onRemoved(org);
        }
      }
    }
    this.active.length = write;
    this.spatialIndexBuilt = false;
  }

  /**
   * Rebuilds the intrusive cell linked-list spatial index in O(cells + N).
   */
  rebuildSpatialIndex(): void {
    const n = this.active.length;
    if (this.nextInCell.length < n) {
      let nextCap = Math.max(64, this.nextInCell.length);
      while (nextCap < n) nextCap *= 2;
      this.nextInCell = new Int32Array(nextCap);
    }
    this.cellHead.fill(-1);
    this.cellCounts.fill(0);
    // Insert in reverse order so bucket traversal visits organisms in deterministic ascending order
    for (let i = n - 1; i >= 0; i--) {
      const org = this.active[i];
      if (!org.alive) continue;
      const cell = org.cellIndex;
      if (cell < 0 || cell >= this.cellCount) continue;
      this.nextInCell[i] = this.cellHead[cell];
      this.cellHead[cell] = i;
      this.cellCounts[cell] += 1;
    }
    this.spatialIndexBuilt = true;
  }

  ensureSpatialIndex(): void {
    if (!this.spatialIndexBuilt) {
      this.rebuildSpatialIndex();
    }
  }

  /** @internal Read-only spatial index head per cell (call ensureSpatialIndex() first). */
  getSpatialIndexHead(): Int32Array {
    return this.cellHead;
  }

  /** @internal Read-only spatial next pointer per active index (call ensureSpatialIndex() first). */
  getSpatialIndexNext(): Int32Array {
    return this.nextInCell;
  }

  /** @internal Read-only O(1) cell counts (call ensureSpatialIndex() first). */
  getCellCountsBuffer(): Uint32Array {
    return this.cellCounts;
  }

  /**
   * Iterates alive organisms located in `cellIndex` without allocating temporary arrays.
   * Returning `false` from `visitor` stops iteration early.
   */
  forEachInCell(cellIndex: number, visitor: (org: Organism, activeIdx: number) => boolean | void): void {
    if (!this.spatialIndexBuilt) {
      this.rebuildSpatialIndex();
    }
    if (cellIndex < 0 || cellIndex >= this.cellCount) return;
    let idx = this.cellHead[cellIndex];
    while (idx !== -1) {
      const org = this.active[idx];
      if (org.alive) {
        const cont = visitor(org, idx);
        if (cont === false) return;
      }
      idx = this.nextInCell[idx];
    }
  }

  getCellPopulationCount(cellIndex: number): number {
    if (!this.spatialIndexBuilt) {
      this.rebuildSpatialIndex();
    }
    if (cellIndex < 0 || cellIndex >= this.cellCount) return 0;
    return this.cellCounts[cellIndex];
  }

  computeStats(tick: number): PopulationStats {
    const schema = this.species.genomeSchema;
    const locusCount = schema.locusCount;
    const activeLen = this.active.length;

    let totalAlive = 0;
    let female = 0;
    let male = 0;
    let eggCount = 0;
    let juvCount = 0;
    let adultCount = 0;
    let elderCount = 0;

    let maxGeneration = 0;
    const generationsAlive = this.generationsScratch;
    generationsAlive.clear();
    const genSeen = this.genSeenFlags;
    const genDirty = this.genDirtyList;
    const genLimit = genSeen.length;
    let uniqueSmallGen = 0;

    const sumGen = this.sumGen;
    const sumSqGen = this.sumSqGen;
    const sumPhen = this.sumPhen;
    const sumEggPhen = this.sumEggPhen;
    const sumJuvPhen = this.sumJuvPhen;
    const sumAdultPhen = this.sumAdultPhen;
    const sumElderPhen = this.sumElderPhen;
    const locusInvSpan = this.locusInvSpan;

    sumGen.fill(0);
    sumSqGen.fill(0);
    sumPhen.fill(0);
    sumEggPhen.fill(0);
    sumJuvPhen.fill(0);
    sumAdultPhen.fill(0);
    sumElderPhen.fill(0);

    let sumAbsDiffAlleles = 0;
    let sumNormalizedDiffAlleles = 0;
    const active = this.active;

    for (let i = 0; i < activeLen; i++) {
      const org = active[i];
      if (!org.alive) continue;

      totalAlive++;
      if (org.sex === 'female') female++;
      else male++;

      const stage = org.stage;
      let stageSums: Float64Array | null;
      if (stage === 'adult') {
        adultCount++;
        stageSums = sumAdultPhen;
      } else if (stage === 'egg') {
        eggCount++;
        stageSums = sumEggPhen;
      } else if (stage === 'juvenile') {
        juvCount++;
        stageSums = sumJuvPhen;
      } else if (stage === 'elder') {
        elderCount++;
        stageSums = sumElderPhen;
      } else {
        stageSums = null;
      }

      const gNum = org.generation;
      if (gNum > maxGeneration) maxGeneration = gNum;
      if (gNum >= 0 && gNum < genLimit) {
        if (genSeen[gNum] === 0) {
          genSeen[gNum] = 1;
          genDirty.push(gNum);
          uniqueSmallGen++;
        }
      } else {
        generationsAlive.add(gNum);
      }

      const gen = org.phenotype.geneticExpression;
      const phen = org.phenotype.expressed;
      const mat = org.genome.maternalAlleles;
      const pat = org.genome.paternalAlleles;

      if (stageSums !== null) {
        for (let l = 0; l < locusCount; l++) {
          const g = gen[l];
          const p = phen[l];
          sumGen[l] += g;
          sumSqGen[l] += g * g;
          sumPhen[l] += p;
          stageSums[l] += p;
          const d = mat[l] - pat[l];
          const absDiff = d < 0 ? -d : d;
          sumAbsDiffAlleles += absDiff;
          sumNormalizedDiffAlleles += absDiff * locusInvSpan[l];
        }
      } else {
        for (let l = 0; l < locusCount; l++) {
          const g = gen[l];
          const p = phen[l];
          sumGen[l] += g;
          sumSqGen[l] += g * g;
          sumPhen[l] += p;
          const d = mat[l] - pat[l];
          const absDiff = d < 0 ? -d : d;
          sumAbsDiffAlleles += absDiff;
          sumNormalizedDiffAlleles += absDiff * locusInvSpan[l];
        }
      }
    }

    const totalUniqueGens = uniqueSmallGen + generationsAlive.size;
    for (let i = 0; i < genDirty.length; i++) {
      genSeen[genDirty[i]] = 0;
    }
    genDirty.length = 0;

    const stageCounts: Record<Exclude<LifeStage, 'dead'>, number> = {
      egg: eggCount,
      juvenile: juvCount,
      adult: adultCount,
      elder: elderCount,
    };

    const meanGenotype: Record<string, number> = {};
    const meanPhenotype: Record<string, number> = {};
    const traitStdDev: Record<string, number> = {};

    let totalVariance = 0;
    let totalStdDev = 0;

    for (let l = 0; l < locusCount; l++) {
      const id = schema.loci[l].id;
      if (totalAlive > 0) {
        const meanG = sumGen[l] / totalAlive;
        const meanP = sumPhen[l] / totalAlive;
        const variance = Math.max(0, sumSqGen[l] / totalAlive - meanG * meanG);
        const stdDev = Math.sqrt(variance);
        meanGenotype[id] = meanG;
        meanPhenotype[id] = meanP;
        traitStdDev[id] = stdDev;
        totalVariance += variance;
        totalStdDev += stdDev;
      } else {
        meanGenotype[id] = 0;
        meanPhenotype[id] = 0;
        traitStdDev[id] = 0;
      }
    }

    const meanEggPhenotype = buildMeanRecord(this.species, sumEggPhen, stageCounts.egg);
    const meanJuvenilePhenotype = buildMeanRecord(this.species, sumJuvPhen, stageCounts.juvenile);
    const meanAdultPhenotype = buildMeanRecord(this.species, sumAdultPhen, stageCounts.adult);
    const meanElderPhenotype = buildMeanRecord(this.species, sumElderPhen, stageCounts.elder);

    const matureCount = stageCounts.adult + stageCounts.elder;
    let meanMaturePhenotype: Record<string, number>;
    if (matureCount <= 0) {
      meanMaturePhenotype = emptyTraitRecord(this.species);
    } else {
      meanMaturePhenotype = {};
      const invMature = 1 / matureCount;
      for (let l = 0; l < locusCount; l++) {
        meanMaturePhenotype[schema.loci[l].id] = (sumAdultPhen[l] + sumElderPhen[l]) * invMature;
      }
    }

    const denom = totalAlive * locusCount;
    const meanNormalizedAlleleDivergence = denom > 0 ? sumNormalizedDiffAlleles / denom : 0;
    const meanHeterozygosity = denom > 0 ? sumAbsDiffAlleles / denom : 0;

    const deathsByCause: Record<string, number> = {};
    for (const [cause, count] of this.deathsByCause) {
      Object.defineProperty(deathsByCause, cause, {
        value: count,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }

    return {
      tick,
      speciesId: this.species.id,
      totalAlive,
      introducedTotal: this.introducedTotal,
      birthsTotal: this.birthsTotal,
      deathsTotal: this.deathsTotal,
      birthsThisTick: this.birthsThisTick,
      deathsThisTick: this.deathsThisTick,
      deathsByCause,
      sexCounts: { female, male },
      femaleRatio: totalAlive > 0 ? female / totalAlive : 0,
      stageCounts,
      maxGeneration,
      survivingGenerationsCount: totalUniqueGens,
      meanGenotype,
      meanPhenotype,
      meanAdultPhenotype,
      meanJuvenilePhenotype,
      meanEggPhenotype,
      meanElderPhenotype,
      meanMaturePhenotype,
      traitStdDev,
      geneticDiversity: {
        meanStdDev: locusCount > 0 ? totalStdDev / locusCount : 0,
        meanVariance: locusCount > 0 ? totalVariance / locusCount : 0,
        meanNormalizedAlleleDivergence,
        meanHeterozygosity,
      },
    };
  }
}
