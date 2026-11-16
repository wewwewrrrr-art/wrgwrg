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

  private readonly locusIds: readonly string[];
  private readonly locusCount: number;
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
    this.locusCount = n;
    const ids: string[] = new Array(n);
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
      ids[l] = def.id;
      const range = species.traitRanges[def.id] ?? def.defaultRange;
      const span = range.max - range.min;
      this.locusInvSpan[l] = span > 0 ? 1 / span : 0;
    }
    this.locusIds = ids;
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

  /**
   * Marks the intrusive spatial index stale after organisms changed `cellIndex` (movement).
   * The next spatial query rebuilds it lazily in O(cells + N).
   */
  invalidateSpatialIndex(): void {
    this.spatialIndexBuilt = false;
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
    const locusIds = this.locusIds;
    const locusCount = this.locusCount;
    const active = this.active;
    const activeLen = active.length;

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

    if (locusCount === 10 && activeLen > 0) {
      let sg0 = 0, sg1 = 0, sg2 = 0, sg3 = 0, sg4 = 0, sg5 = 0, sg6 = 0, sg7 = 0, sg8 = 0, sg9 = 0;
      let ss0 = 0, ss1 = 0, ss2 = 0, ss3 = 0, ss4 = 0, ss5 = 0, ss6 = 0, ss7 = 0, ss8 = 0, ss9 = 0;
      let sp0 = 0, sp1 = 0, sp2 = 0, sp3 = 0, sp4 = 0, sp5 = 0, sp6 = 0, sp7 = 0, sp8 = 0, sp9 = 0;
      let sa0 = 0, sa1 = 0, sa2 = 0, sa3 = 0, sa4 = 0, sa5 = 0, sa6 = 0, sa7 = 0, sa8 = 0, sa9 = 0;
      const inv0 = locusInvSpan[0], inv1 = locusInvSpan[1], inv2 = locusInvSpan[2], inv3 = locusInvSpan[3], inv4 = locusInvSpan[4];
      const inv5 = locusInvSpan[5], inv6 = locusInvSpan[6], inv7 = locusInvSpan[7], inv8 = locusInvSpan[8], inv9 = locusInvSpan[9];

      for (let i = 0; i < activeLen; i++) {
        const org = active[i];
        if (!org.alive) continue;

        totalAlive++;
        if (org.sex === 'female') female++;
        else male++;

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

        const phenObj = org.phenotype;
        const gen = phenObj.geneticExpression;
        const phen = phenObj.expressed;
        const genomeObj = org.genome;
        const mat = genomeObj.maternalAlleles;
        const pat = genomeObj.paternalAlleles;

        const g0 = gen[0]; sg0 += g0; ss0 += g0 * g0;
        const g1 = gen[1]; sg1 += g1; ss1 += g1 * g1;
        const g2 = gen[2]; sg2 += g2; ss2 += g2 * g2;
        const g3 = gen[3]; sg3 += g3; ss3 += g3 * g3;
        const g4 = gen[4]; sg4 += g4; ss4 += g4 * g4;
        const g5 = gen[5]; sg5 += g5; ss5 += g5 * g5;
        const g6 = gen[6]; sg6 += g6; ss6 += g6 * g6;
        const g7 = gen[7]; sg7 += g7; ss7 += g7 * g7;
        const g8 = gen[8]; sg8 += g8; ss8 += g8 * g8;
        const g9 = gen[9]; sg9 += g9; ss9 += g9 * g9;

        const p0 = phen[0], p1 = phen[1], p2 = phen[2], p3 = phen[3], p4 = phen[4];
        const p5 = phen[5], p6 = phen[6], p7 = phen[7], p8 = phen[8], p9 = phen[9];
        sp0 += p0; sp1 += p1; sp2 += p2; sp3 += p3; sp4 += p4;
        sp5 += p5; sp6 += p6; sp7 += p7; sp8 += p8; sp9 += p9;

        const stage = org.stage;
        if (stage === 'adult') {
          adultCount++;
          sa0 += p0; sa1 += p1; sa2 += p2; sa3 += p3; sa4 += p4;
          sa5 += p5; sa6 += p6; sa7 += p7; sa8 += p8; sa9 += p9;
        } else if (stage === 'egg') {
          eggCount++;
          sumEggPhen[0] += p0; sumEggPhen[1] += p1; sumEggPhen[2] += p2; sumEggPhen[3] += p3; sumEggPhen[4] += p4;
          sumEggPhen[5] += p5; sumEggPhen[6] += p6; sumEggPhen[7] += p7; sumEggPhen[8] += p8; sumEggPhen[9] += p9;
        } else if (stage === 'juvenile') {
          juvCount++;
          sumJuvPhen[0] += p0; sumJuvPhen[1] += p1; sumJuvPhen[2] += p2; sumJuvPhen[3] += p3; sumJuvPhen[4] += p4;
          sumJuvPhen[5] += p5; sumJuvPhen[6] += p6; sumJuvPhen[7] += p7; sumJuvPhen[8] += p8; sumJuvPhen[9] += p9;
        } else if (stage === 'elder') {
          elderCount++;
          sumElderPhen[0] += p0; sumElderPhen[1] += p1; sumElderPhen[2] += p2; sumElderPhen[3] += p3; sumElderPhen[4] += p4;
          sumElderPhen[5] += p5; sumElderPhen[6] += p6; sumElderPhen[7] += p7; sumElderPhen[8] += p8; sumElderPhen[9] += p9;
        }

        let d = mat[0] - pat[0]; let ad = d < 0 ? -d : d; sumAbsDiffAlleles += ad; sumNormalizedDiffAlleles += ad * inv0;
        d = mat[1] - pat[1]; ad = d < 0 ? -d : d; sumAbsDiffAlleles += ad; sumNormalizedDiffAlleles += ad * inv1;
        d = mat[2] - pat[2]; ad = d < 0 ? -d : d; sumAbsDiffAlleles += ad; sumNormalizedDiffAlleles += ad * inv2;
        d = mat[3] - pat[3]; ad = d < 0 ? -d : d; sumAbsDiffAlleles += ad; sumNormalizedDiffAlleles += ad * inv3;
        d = mat[4] - pat[4]; ad = d < 0 ? -d : d; sumAbsDiffAlleles += ad; sumNormalizedDiffAlleles += ad * inv4;
        d = mat[5] - pat[5]; ad = d < 0 ? -d : d; sumAbsDiffAlleles += ad; sumNormalizedDiffAlleles += ad * inv5;
        d = mat[6] - pat[6]; ad = d < 0 ? -d : d; sumAbsDiffAlleles += ad; sumNormalizedDiffAlleles += ad * inv6;
        d = mat[7] - pat[7]; ad = d < 0 ? -d : d; sumAbsDiffAlleles += ad; sumNormalizedDiffAlleles += ad * inv7;
        d = mat[8] - pat[8]; ad = d < 0 ? -d : d; sumAbsDiffAlleles += ad; sumNormalizedDiffAlleles += ad * inv8;
        d = mat[9] - pat[9]; ad = d < 0 ? -d : d; sumAbsDiffAlleles += ad; sumNormalizedDiffAlleles += ad * inv9;
      }

      sumGen[0] = sg0; sumGen[1] = sg1; sumGen[2] = sg2; sumGen[3] = sg3; sumGen[4] = sg4;
      sumGen[5] = sg5; sumGen[6] = sg6; sumGen[7] = sg7; sumGen[8] = sg8; sumGen[9] = sg9;
      sumSqGen[0] = ss0; sumSqGen[1] = ss1; sumSqGen[2] = ss2; sumSqGen[3] = ss3; sumSqGen[4] = ss4;
      sumSqGen[5] = ss5; sumSqGen[6] = ss6; sumSqGen[7] = ss7; sumSqGen[8] = ss8; sumSqGen[9] = ss9;
      sumPhen[0] = sp0; sumPhen[1] = sp1; sumPhen[2] = sp2; sumPhen[3] = sp3; sumPhen[4] = sp4;
      sumPhen[5] = sp5; sumPhen[6] = sp6; sumPhen[7] = sp7; sumPhen[8] = sp8; sumPhen[9] = sp9;
      sumAdultPhen[0] = sa0; sumAdultPhen[1] = sa1; sumAdultPhen[2] = sa2; sumAdultPhen[3] = sa3; sumAdultPhen[4] = sa4;
      sumAdultPhen[5] = sa5; sumAdultPhen[6] = sa6; sumAdultPhen[7] = sa7; sumAdultPhen[8] = sa8; sumAdultPhen[9] = sa9;
    } else if (activeLen > 0) {
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
    const meanEggPhenotype: Record<string, number> = {};
    const meanJuvenilePhenotype: Record<string, number> = {};
    const meanAdultPhenotype: Record<string, number> = {};
    const meanElderPhenotype: Record<string, number> = {};
    const meanMaturePhenotype: Record<string, number> = {};

    const matureCount = adultCount + elderCount;
    const invTotal = totalAlive > 0 ? 1 / totalAlive : 0;
    const invEgg = eggCount > 0 ? 1 / eggCount : 0;
    const invJuv = juvCount > 0 ? 1 / juvCount : 0;
    const invAdult = adultCount > 0 ? 1 / adultCount : 0;
    const invElder = elderCount > 0 ? 1 / elderCount : 0;
    const invMature = matureCount > 0 ? 1 / matureCount : 0;

    let totalVariance = 0;
    let totalStdDev = 0;

    for (let l = 0; l < locusCount; l++) {
      const id = locusIds[l];
      if (totalAlive > 0) {
        const meanG = sumGen[l] / totalAlive;
        const meanP = sumPhen[l] * invTotal;
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
      meanEggPhenotype[id] = eggCount > 0 ? sumEggPhen[l] * invEgg : 0;
      meanJuvenilePhenotype[id] = juvCount > 0 ? sumJuvPhen[l] * invJuv : 0;
      meanAdultPhenotype[id] = adultCount > 0 ? sumAdultPhen[l] * invAdult : 0;
      meanElderPhenotype[id] = elderCount > 0 ? sumElderPhen[l] * invElder : 0;
      meanMaturePhenotype[id] = matureCount > 0 ? (sumAdultPhen[l] + sumElderPhen[l]) * invMature : 0;
    }

    const denom = totalAlive * locusCount;
    const meanNormalizedAlleleDivergence = denom > 0 ? sumNormalizedDiffAlleles / denom : 0;
    const meanHeterozygosity = denom > 0 ? sumAbsDiffAlleles / denom : 0;

    const deathsByCause: Record<string, number> = {};
    for (const [cause, count] of this.deathsByCause) {
      if (cause === '__proto__') {
        Object.defineProperty(deathsByCause, cause, {
          value: count,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      } else {
        deathsByCause[cause] = count;
      }
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
