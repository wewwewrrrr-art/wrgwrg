import { WORLD_BIOME_IDS, WorldBiomeId, WorldGrid } from '../worldGrid';
import {
  ANATOMY_IDX,
  ANATOMY_LOCUS_COUNT,
  ANATOMY_RANGES,
  deriveSpeciesAnatomyBaseline,
} from './anatomy';
import { measureReproductiveIsolation } from './evolution';
import { Organism } from './organism';
import { DivergenceCause } from './phylogeny';
import { SpeciesDefinition, validateSpeciesDefinition } from './species';

export interface EvolutionConfig {
  /** Enables autonomous evolution, selection, hybridization, anatomy adaptation & speciation (default: true). */
  readonly enabled?: boolean;
  /** Interval in ticks between population divergence & speciation evaluations (default: 25). */
  readonly evolutionCheckInterval?: number;
  /** Maximum Chebyshev cell distance considered connected gene flow within a subpopulation (default: 4). */
  readonly geneFlowLinkDistance?: number;
  /** Minimum living individuals in a diverging subpopulation to form an incipient species (default: 6). */
  readonly minClusterSize?: number;
  /** Minimum remaining individuals in the sister/parental subpopulation during cladogenesis (default: 4). */
  readonly minParentRemainSize?: number;
  /** Minimum normalized heritable genetic divergence across loci to speciate (default: 0.105). */
  readonly minGeneticDivergence?: number;
  /** Minimum ecological / anatomical divergence to speciate (default: 0.085). */
  readonly minEcologicalDivergence?: number;
  /** Minimum combined reproductive isolation score in [0, 1] required to speciate (default: 0.28). */
  readonly minReproductiveIsolation?: number;
  /** Number of consecutive checks where divergence & isolation must persist (default: 3). */
  readonly requiredPersistenceChecks?: number;
  /** Hard cap on total registered species to bound memory & spatial grids (default: 48). */
  readonly maxSpeciesCount?: number;
  /** Enables interspecific hybridization & backcrossing between compatible sister taxa (default: true). */
  readonly enableHybridization?: boolean;
  /** Enables sexual selection & assortative mate choice within bounded mate scans (default: true). */
  readonly enableSexualSelection?: boolean;
  /** Enables quantitative anatomy & physiology trait evolution & trade-offs (default: true). */
  readonly enableAnatomyEvolution?: boolean;
}

export interface ResolvedEvolutionConfig {
  readonly enabled: boolean;
  readonly evolutionCheckInterval: number;
  readonly geneFlowLinkDistance: number;
  readonly minClusterSize: number;
  readonly minParentRemainSize: number;
  readonly minGeneticDivergence: number;
  readonly minEcologicalDivergence: number;
  readonly minReproductiveIsolation: number;
  readonly requiredPersistenceChecks: number;
  readonly maxSpeciesCount: number;
  readonly enableHybridization: boolean;
  readonly enableSexualSelection: boolean;
  readonly enableAnatomyEvolution: boolean;
}

export function resolveEvolutionConfig(cfg?: EvolutionConfig): ResolvedEvolutionConfig {
  const interval = cfg?.evolutionCheckInterval ?? 25;
  if (!Number.isInteger(interval) || interval < 1) {
    throw new RangeError(`evolutionCheckInterval must be an integer >= 1, received: ${interval}`);
  }
  const linkDist = cfg?.geneFlowLinkDistance ?? 4;
  if (!Number.isInteger(linkDist) || linkDist < 1) {
    throw new RangeError(`geneFlowLinkDistance must be an integer >= 1, received: ${linkDist}`);
  }
  return {
    enabled: cfg?.enabled ?? true,
    evolutionCheckInterval: interval,
    geneFlowLinkDistance: linkDist,
    minClusterSize: Math.max(2, cfg?.minClusterSize ?? 6),
    minParentRemainSize: Math.max(2, cfg?.minParentRemainSize ?? 4),
    minGeneticDivergence: cfg?.minGeneticDivergence ?? 0.105,
    minEcologicalDivergence: cfg?.minEcologicalDivergence ?? 0.085,
    minReproductiveIsolation: cfg?.minReproductiveIsolation ?? 0.28,
    requiredPersistenceChecks: Math.max(1, cfg?.requiredPersistenceChecks ?? 3),
    maxSpeciesCount: Math.max(4, cfg?.maxSpeciesCount ?? 48),
    enableHybridization: cfg?.enableHybridization ?? true,
    enableSexualSelection: cfg?.enableSexualSelection ?? true,
    enableAnatomyEvolution: cfg?.enableAnatomyEvolution ?? true,
  };
}

export interface StagedClusterTrackerUpdate {
  readonly parentSpeciesId: string;
  readonly clusterKey: string;
  readonly nextStreak: number;
  readonly lastSeenTick: number;
  /** Divergence measured at this check (diagnostics; the decision uses the same values). */
  readonly geneticDistance: number;
  readonly ecologicalDistance: number;
  readonly reproductiveIsolation: number;
  readonly memberCount: number;
}

export interface StagedSpeciationProposal {
  readonly parentSpeciesId: string;
  readonly daughterSpecies: SpeciesDefinition;
  readonly cause: Exclude<DivergenceCause, 'founder'>;
  readonly geneticDistance: number;
  readonly ecologicalDistance: number;
  readonly reproductiveIsolation: number;
  readonly persistenceTicks: number;
  readonly founderCount: number;
  readonly cellCentroid: { readonly x: number; readonly y: number };
  readonly geneticSignature: readonly number[];
  readonly anatomySignature: readonly number[];
  readonly clusterKey: string;
  /** Draft indices of organisms belonging to this diverging subpopulation. */
  readonly memberDraftIndices: readonly number[];
}

export interface ClusterTrackerState {
  streak: number;
  lastSeenTick: number;
  assignedSpeciesId: string | null;
  geneticDistance: number;
  ecologicalDistance: number;
  reproductiveIsolation: number;
  memberCount: number;
}

const FLAG_DIED = 1 << 2;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Builds the SpeciesDefinition of a daughter lineage at the moment of cladogenesis.
 *
 * The daughter inherits every mechanical parameter of the parent unchanged (physiology, diet,
 * trophic, spatial and reproductive profiles, genome schema, trait baselines and ranges). At the
 * instant of speciation nothing about the founding organisms changes: their divergence already
 * lives in their inherited genomes and anatomies and keeps evolving through inheritance and
 * selection. Re-deriving physiology, diet or locomotion from population means here would
 * transform every founder instantly and arbitrarily, so the evolved centroids are used only for a
 * descriptive ecotype name (the measured signatures are kept in the phylogeny).
 */
export function synthesizeDaughterSpecies(params: {
  readonly parent: SpeciesDefinition;
  readonly newSpeciesId: string;
  readonly meanCoreAlleles: Float64Array;
  readonly meanAnatomyAlleles: Float64Array;
  readonly meanHabitatTempC: number;
  readonly meanHabitatMoisture: number;
  readonly dominantBiome?: WorldBiomeId;
  readonly cause: Exclude<DivergenceCause, 'founder'>;
}): SpeciesDefinition {
  const { parent, newSpeciesId, meanAnatomyAlleles, meanHabitatTempC } = params;
  const aq = meanAnatomyAlleles[ANATOMY_IDX.AQUATIC_AFFINITY];
  const climb = meanAnatomyAlleles[ANATOMY_IDX.CLIMBING_AFFINITY];
  const limb = meanAnatomyAlleles[ANATOMY_IDX.LIMB_LENGTH];
  const integ = meanAnatomyAlleles[ANATOMY_IDX.INTEGUMENT_THICKNESS];
  const parentAnatomy = deriveSpeciesAnatomyBaseline(parent);

  let ecotypeLabel = params.cause === 'allopatric' ? 'Insular' : 'Divergent';
  if (meanHabitatTempC <= parent.physiology.optimalTemperatureC - 6 || integ >= parentAnatomy[ANATOMY_IDX.INTEGUMENT_THICKNESS] + 0.12) {
    ecotypeLabel = 'Boreal';
  } else if (meanHabitatTempC >= parent.physiology.optimalTemperatureC + 6 || integ <= parentAnatomy[ANATOMY_IDX.INTEGUMENT_THICKNESS] - 0.12) {
    ecotypeLabel = 'Arid';
  } else if (aq >= parentAnatomy[ANATOMY_IDX.AQUATIC_AFFINITY] + 0.2) {
    ecotypeLabel = 'Littoral';
  } else if (climb >= parentAnatomy[ANATOMY_IDX.CLIMBING_AFFINITY] + 0.2) {
    ecotypeLabel = 'Montane';
  } else if (limb >= parentAnatomy[ANATOMY_IDX.LIMB_LENGTH] + 0.15) {
    ecotypeLabel = 'Cursorial';
  }

  const daughter: SpeciesDefinition = {
    ...parent,
    id: newSpeciesId,
    name: `${ecotypeLabel} ${parent.name}`,
  };
  validateSpeciesDefinition(daughter);
  return daughter;
}

/**
 * Fast O(N + occupiedCells) spatial-ecological divergence analyzer & autonomous speciation engine.
 * Holds reusable scratch buffers and transactional cluster persistence trackers.
 */
export class SpeciationEngine {
  private readonly cellCount: number;
  private readonly gridWidth: number;
  private readonly gridHeight: number;
  private readonly config: ResolvedEvolutionConfig;

  // Reusable per-cell clustering scratch (O(1) per cell, zero GC churn)
  private readonly cellPresent: Uint8Array;
  private readonly cellClusterId: Int32Array;
  private readonly occCells: Int32Array;
  private readonly bfsQueue: Int32Array;

  // Persistent cluster state across ticks (mutated ONLY on COMMIT)
  private readonly clusterTrackers = new Map<string, ClusterTrackerState>();
  private nextDaughterSeq = 2;

  constructor(grid: WorldGrid, config: ResolvedEvolutionConfig) {
    this.cellCount = grid.cellCount;
    this.gridWidth = grid.width;
    this.gridHeight = grid.height;
    this.config = config;

    this.cellPresent = new Uint8Array(this.cellCount);
    this.cellClusterId = new Int32Array(this.cellCount);
    this.cellClusterId.fill(-1);
    this.occCells = new Int32Array(this.cellCount);
    this.bfsQueue = new Int32Array(this.cellCount);
  }

  reserveDaughterSeq(): number {
    return this.nextDaughterSeq;
  }

  commitTrackerUpdates(
    updates: readonly StagedClusterTrackerUpdate[],
    committedSpeciations: readonly { readonly proposal: StagedSpeciationProposal; readonly assignedId: string }[],
    currentTick: number
  ): void {
    for (let i = 0; i < updates.length; i++) {
      const u = updates[i];
      const fullKey = `${u.parentSpeciesId}::${u.clusterKey}`;
      let state = this.clusterTrackers.get(fullKey);
      if (!state) {
        state = {
          streak: u.nextStreak,
          lastSeenTick: u.lastSeenTick,
          assignedSpeciesId: null,
          geneticDistance: u.geneticDistance,
          ecologicalDistance: u.ecologicalDistance,
          reproductiveIsolation: u.reproductiveIsolation,
          memberCount: u.memberCount,
        };
        this.clusterTrackers.set(fullKey, state);
      } else {
        state.streak = u.nextStreak;
        state.lastSeenTick = u.lastSeenTick;
        state.geneticDistance = u.geneticDistance;
        state.ecologicalDistance = u.ecologicalDistance;
        state.reproductiveIsolation = u.reproductiveIsolation;
        state.memberCount = u.memberCount;
      }
    }
    for (let i = 0; i < committedSpeciations.length; i++) {
      const { proposal, assignedId } = committedSpeciations[i];
      const fullKey = `${proposal.parentSpeciesId}::${proposal.clusterKey}`;
      const state = this.clusterTrackers.get(fullKey);
      if (state) {
        state.assignedSpeciesId = assignedId;
        state.streak = 0;
      } else {
        this.clusterTrackers.set(fullKey, {
          streak: 0,
          lastSeenTick: currentTick,
          assignedSpeciesId: assignedId,
          geneticDistance: proposal.geneticDistance,
          ecologicalDistance: proposal.ecologicalDistance,
          reproductiveIsolation: proposal.reproductiveIsolation,
          memberCount: proposal.founderCount,
        });
      }
      this.nextDaughterSeq += 1;
    }

    // Prune stale trackers unseen for > 12 intervals to keep memory bounded
    if (this.clusterTrackers.size > 256) {
      const staleAge = this.config.evolutionCheckInterval * 12;
      for (const [k, v] of this.clusterTrackers.entries()) {
        if (currentTick - v.lastSeenTick > staleAge && !v.assignedSpeciesId) {
          this.clusterTrackers.delete(k);
        }
      }
    }
  }

  getTrackerStreak(speciesId: string, clusterKey: string): number {
    return this.clusterTrackers.get(`${speciesId}::${clusterKey}`)?.streak ?? 0;
  }

  getAssignedSpeciesForCluster(speciesId: string, clusterKey: string): string | null {
    return this.clusterTrackers.get(`${speciesId}::${clusterKey}`)?.assignedSpeciesId ?? null;
  }

  /** Committed divergence trackers (read-only snapshot, deterministic key order). */
  getTrackers(): readonly ({ readonly key: string } & Readonly<ClusterTrackerState>)[] {
    return [...this.clusterTrackers.entries()]
      .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
      .map(([key, v]) => Object.freeze({ key, ...v }));
  }

  /**
   * Pure RESOLVE-phase evaluation: scans surviving drafts per species, detects spatially (or
   * ecologically) separated subpopulations, measures their heritable divergence and their
   * reproductive isolation, and emits staged speciation proposals and tracker updates. Persistent
   * state is never mutated here (see `commitTrackerUpdates`), organisms are only read.
   *
   * A subpopulation becomes a proposal only when, for `requiredPersistenceChecks` consecutive
   * checks, all of the following hold:
   *   - a sister group of at least `minParentRemainSize` individuals remains (cladogenesis; a
   *     lineage that merely drifted away from its registered baseline is not split off);
   *   - heritable divergence (core + anatomy allele means) >= `minGeneticDivergence`;
   *   - ecological divergence >= `minEcologicalDivergence`;
   *   - measured reproductive isolation >= `minReproductiveIsolation`, where isolation is the
   *     reduction of expected fertile offspring when members of the two groups mate, computed with
   *     the same compatibility model that decides real matings (`measureReproductiveIsolation`).
   *     Living apart is not isolation: fully compatible groups measure 0.
   * Cost per check: O(N + occupied cells * linkDistance^2) plus a bounded pair sample per cluster.
   */
  evaluateTick(params: {
    readonly targetTick: number;
    readonly grid: WorldGrid;
    readonly speciesCount: number;
    readonly speciesList: readonly SpeciesDefinition[];
    readonly existingSpeciesIds: ReadonlySet<string>;
    readonly speciesDraftStart: Int32Array;
    readonly speciesDraftEnd: Int32Array;
    readonly draftOrg: readonly Organism[];
    readonly draftCellIndex: Uint32Array;
    readonly draftFlags: Uint8Array;
    readonly navComponents: readonly Int32Array[] | null;
    readonly speciesNavClass: Int32Array | null;
    readonly outProposals: StagedSpeciationProposal[];
    readonly outTrackerUpdates: StagedClusterTrackerUpdate[];
    readonly rootSpeciesResolver: (speciesId: string) => string;
  }): void {
    params.outProposals.length = 0;
    params.outTrackerUpdates.length = 0;

    const cfg = this.config;
    if (!cfg.enabled) return;
    if (params.targetTick % cfg.evolutionCheckInterval !== 0) return;

    let remainingSpeciesBudget = Math.max(0, cfg.maxSpeciesCount - params.speciesCount);
    let seqCursor = this.nextDaughterSeq;

    const w = this.gridWidth;
    const h = this.gridHeight;
    const linkR = cfg.geneFlowLinkDistance;
    const temps = params.grid.temperature;
    const moists = params.grid.moisture;
    const biomeCodes = params.grid.biomeCode;
    const cellPresent = this.cellPresent;
    const cellClusterId = this.cellClusterId;
    const occCells = this.occCells;
    const bfsQueue = this.bfsQueue;
    const minTotal = cfg.minClusterSize + cfg.minParentRemainSize;

    for (let s = 0; s < params.speciesCount; s++) {
      const start = params.speciesDraftStart[s];
      const end = params.speciesDraftEnd[s];
      if (end - start < minTotal) continue;

      const species = params.speciesList[s];
      const schema = species.genomeSchema;
      const locusCount = schema.locusCount;
      const navComp =
        params.navComponents && params.speciesNavClass
          ? params.navComponents[params.speciesNavClass[s]] ?? null
          : null;

      // 1. Living drafts (ascending id order) and occupied cells, O(N_s)
      const aliveDrafts: number[] = [];
      let occCount = 0;
      for (let d = start; d < end; d++) {
        if ((params.draftFlags[d] & FLAG_DIED) !== 0) continue;
        aliveDrafts.push(d);
        const c = params.draftCellIndex[d];
        if (cellPresent[c] === 0) {
          cellPresent[c] = 1;
          occCells[occCount++] = c;
        }
      }
      const nAlive = aliveDrafts.length;
      if (nAlive < minTotal) {
        for (let i = 0; i < occCount; i++) cellPresent[occCells[i]] = 0;
        continue;
      }

      // 2. Spatial clusters: occupied cells linked within linkDistance, never across a navigation
      //    barrier (impassable terrain) when spatial navigation is active
      let clusterCount = 0;
      for (let i = 0; i < occCount; i++) {
        const seedCell = occCells[i];
        if (cellClusterId[seedCell] !== -1) continue;
        const cid = clusterCount++;
        let qHead = 0;
        let qTail = 0;
        bfsQueue[qTail++] = seedCell;
        cellClusterId[seedCell] = cid;
        while (qHead < qTail) {
          const cur = bfsQueue[qHead++];
          const cy = (cur / w) | 0;
          const cx = cur - cy * w;
          const myNav = navComp ? navComp[cur] : 0;
          const x0 = cx - linkR < 0 ? 0 : cx - linkR;
          const x1 = cx + linkR >= w ? w - 1 : cx + linkR;
          const y0 = cy - linkR < 0 ? 0 : cy - linkR;
          const y1 = cy + linkR >= h ? h - 1 : cy + linkR;
          for (let ny = y0; ny <= y1; ny++) {
            const row = ny * w;
            for (let nx = x0; nx <= x1; nx++) {
              const nc = row + nx;
              if (cellPresent[nc] === 0 || cellClusterId[nc] !== -1) continue;
              if (navComp !== null && navComp[nc] !== myNav) continue;
              cellClusterId[nc] = cid;
              bfsQueue[qTail++] = nc;
            }
          }
        }
      }

      // 3. Cluster label per living draft (index-aligned with aliveDrafts)
      const clusterOf = new Int32Array(nAlive);
      for (let i = 0; i < nAlive; i++) clusterOf[i] = cellClusterId[params.draftCellIndex[aliveDrafts[i]]];
      for (let i = 0; i < occCount; i++) {
        const c = occCells[i];
        cellPresent[c] = 0;
        cellClusterId[c] = -1;
      }

      // 4. A single contiguous population may still hold ecologically separated groups (contrasting
      //    thermal or aquatic niches). Whether they are reproductively isolated is measured below.
      let evalMode: Exclude<DivergenceCause, 'founder'> = 'allopatric';
      let isEcologicalSplit = false;
      if (clusterCount === 1) {
        let minT = Infinity;
        let maxT = -Infinity;
        let minAq = Infinity;
        let maxAq = -Infinity;
        for (let i = 0; i < nAlive; i++) {
          const d = aliveDrafts[i];
          const t = temps[params.draftCellIndex[d]];
          if (t < minT) minT = t;
          if (t > maxT) maxT = t;
          const an = params.draftOrg[d].anatomy;
          if (an !== undefined) {
            const aq = an.expressed[ANATOMY_IDX.AQUATIC_AFFINITY];
            if (aq < minAq) minAq = aq;
            if (aq > maxAq) maxAq = aq;
          }
        }
        let n0 = 0;
        if (maxT - minT >= 10.0) {
          const midT = (minT + maxT) * 0.5;
          for (let i = 0; i < nAlive; i++) {
            clusterOf[i] = temps[params.draftCellIndex[aliveDrafts[i]]] < midT ? 0 : 1;
            if (clusterOf[i] === 0) n0++;
          }
        } else if (maxAq - minAq >= 0.3) {
          const midAq = (minAq + maxAq) * 0.5;
          for (let i = 0; i < nAlive; i++) {
            const an = params.draftOrg[aliveDrafts[i]].anatomy;
            clusterOf[i] = an !== undefined && an.expressed[ANATOMY_IDX.AQUATIC_AFFINITY] >= midAq ? 1 : 0;
            if (clusterOf[i] === 0) n0++;
          }
        } else {
          continue; // one interbreeding population, nothing to split
        }
        if (n0 < cfg.minClusterSize || nAlive - n0 < cfg.minClusterSize) continue;
        clusterCount = 2;
        evalMode = 'ecological';
        isEcologicalSplit = true;
      }

      // 5. Whole-species sums (core: everyone; anatomy: carriers only, nothing is synthesized)
      const clusterSize = new Int32Array(clusterCount);
      const clusterMinId = new Float64Array(clusterCount).fill(Infinity);
      const totalCoreSum = new Float64Array(locusCount);
      const totalAnatSum = new Float64Array(ANATOMY_LOCUS_COUNT);
      let totalAnatN = 0;
      let totalTempSum = 0;
      for (let i = 0; i < nAlive; i++) {
        const d = aliveDrafts[i];
        const org = params.draftOrg[d];
        const cid = clusterOf[i];
        clusterSize[cid]++;
        if (org.id < clusterMinId[cid]) clusterMinId[cid] = org.id;
        totalTempSum += temps[params.draftCellIndex[d]];
        const mat = org.genome.maternalAlleles;
        const pat = org.genome.paternalAlleles;
        for (let l = 0; l < locusCount; l++) totalCoreSum[l] += (mat[l] + pat[l]) * 0.5;
        const an = org.anatomy;
        if (an !== undefined) {
          totalAnatN++;
          for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) totalAnatSum[a] += (an.maternal[a] + an.paternal[a]) * 0.5;
        }
      }

      // Deterministic cluster order: smallest member id first
      const order: number[] = [];
      for (let c = 0; c < clusterCount; c++) if (clusterSize[c] >= cfg.minClusterSize) order.push(c);
      order.sort((a, b) => clusterMinId[a] - clusterMinId[b]);

      const clCoreSum = new Float64Array(locusCount);
      const clAnatSum = new Float64Array(ANATOMY_LOCUS_COUNT);
      const clMeanCore = new Float64Array(locusCount);
      const clMeanAnat = new Float64Array(ANATOMY_LOCUS_COUNT);
      const refMeanCore = new Float64Array(locusCount);
      const refMeanAnat = new Float64Array(ANATOMY_LOCUS_COUNT);
      let proposedForThisSpecies = false;

      for (const cid of order) {
        const clN = clusterSize[cid];
        const restN = nAlive - clN;
        if (restN < cfg.minParentRemainSize) continue;

        clCoreSum.fill(0);
        clAnatSum.fill(0);
        let clAnatN = 0;
        let clTempSum = 0;
        let clMoistSum = 0;
        let sumX = 0;
        let sumY = 0;
        let matureCount = 0;
        const biomeCounts = new Int32Array(WORLD_BIOME_IDS.length);
        const members: number[] = [];
        const memberOrgs: Organism[] = [];
        const restSample: Organism[] = [];
        const restStride = Math.max(1, Math.floor(restN / 96));
        let restSeen = 0;
        for (let i = 0; i < nAlive; i++) {
          const d = aliveDrafts[i];
          const org = params.draftOrg[d];
          if (clusterOf[i] !== cid) {
            if (restSeen++ % restStride === 0) restSample.push(org);
            continue;
          }
          members.push(d);
          memberOrgs.push(org);
          const c = params.draftCellIndex[d];
          clTempSum += temps[c];
          clMoistSum += moists[c];
          const bCode = biomeCodes[c];
          if (bCode < biomeCounts.length) biomeCounts[bCode]++;
          const cy = (c / w) | 0;
          sumX += c - cy * w;
          sumY += cy;
          if (org.stage === 'adult' || org.stage === 'elder') matureCount++;
          const mat = org.genome.maternalAlleles;
          const pat = org.genome.paternalAlleles;
          for (let l = 0; l < locusCount; l++) clCoreSum[l] += (mat[l] + pat[l]) * 0.5;
          const an = org.anatomy;
          if (an !== undefined) {
            clAnatN++;
            for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) clAnatSum[a] += (an.maternal[a] + an.paternal[a]) * 0.5;
          }
        }
        // A lineage cannot be founded by eggs and juveniles alone
        if (matureCount < 2) continue;

        const invCl = 1 / clN;
        const invRest = 1 / restN;
        for (let l = 0; l < locusCount; l++) {
          clMeanCore[l] = clCoreSum[l] * invCl;
          refMeanCore[l] = (totalCoreSum[l] - clCoreSum[l]) * invRest;
        }
        const restAnatN = totalAnatN - clAnatN;
        const hasAnatomy = clAnatN > 0 && restAnatN > 0;
        for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) {
          clMeanAnat[a] = clAnatN > 0 ? clAnatSum[a] / clAnatN : 0;
          refMeanAnat[a] = restAnatN > 0 ? (totalAnatSum[a] - clAnatSum[a]) / restAnatN : 0;
        }
        const clMeanTemp = clTempSum * invCl;
        const clMeanMoist = clMoistSum * invCl;
        const refTemp = (totalTempSum - clTempSum) * invRest;
        const cxCentroid = Math.round(sumX * invCl);
        const cyCentroid = Math.round(sumY * invCl);
        const clusterKey = isEcologicalSplit
          ? `eco_${cid}_${Math.round(clMeanTemp / 5)}`
          : `allo_${cxCentroid >> 3}_${cyCentroid >> 3}`;

        // Heritable divergence between the group and its sister group (allele means, range-normalized)
        let sqGen = 0;
        let nLoci = 0;
        for (let l = 0; l < locusCount; l++) {
          const def = schema.loci[l];
          const r = species.traitRanges[def.id] ?? def.defaultRange;
          const span = Math.max(1e-6, r.max - r.min);
          const diff = (clMeanCore[l] - refMeanCore[l]) / span;
          sqGen += diff * diff;
          nLoci++;
        }
        if (hasAnatomy) {
          for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) {
            const r = ANATOMY_RANGES[a];
            const diff = (clMeanAnat[a] - refMeanAnat[a]) / (r.max - r.min);
            sqGen += diff * diff;
            nLoci++;
          }
        }
        const geneticDistance = Math.sqrt(sqGen / Math.max(1, nLoci));

        // Ecological & morphological divergence (habitat temperature, body size, key anatomy)
        const dTemp = (clMeanTemp - refTemp) / 25;
        const dSize = (clMeanCore[0] ?? 1) - (refMeanCore[0] ?? 1);
        const anatDiff = (idx: number) => (hasAnatomy ? clMeanAnat[idx] - refMeanAnat[idx] : 0);
        const dInteg = anatDiff(ANATOMY_IDX.INTEGUMENT_THICKNESS);
        const dAq = anatDiff(ANATOMY_IDX.AQUATIC_AFFINITY);
        const dHerb = anatDiff(ANATOMY_IDX.HERBIVORY_APPARATUS);
        const dCarn = anatDiff(ANATOMY_IDX.CARNIVORY_APPARATUS);
        const ecologicalDistance = Math.sqrt(
          (dTemp * dTemp + dSize * dSize + dInteg * dInteg + 1.5 * dAq * dAq + dHerb * dHerb + dCarn * dCarn) / 6.5
        );

        // Reproductive isolation measured with the mating model itself
        const iso = measureReproductiveIsolation(memberOrgs, species, restSample, species, true, 24);
        const reproductiveIsolation = Number.isNaN(iso.isolation) ? 0 : iso.isolation;

        const genReq = isEcologicalSplit ? cfg.minGeneticDivergence * 1.15 : cfg.minGeneticDivergence;
        const meetsThresholds =
          geneticDistance >= genReq &&
          ecologicalDistance >= cfg.minEcologicalDivergence &&
          reproductiveIsolation >= cfg.minReproductiveIsolation;

        const prevState = this.clusterTrackers.get(`${species.id}::${clusterKey}`);
        if (prevState?.assignedSpeciesId) continue;
        const prevStreak = prevState?.streak ?? 0;
        // Persistence: consecutive checks build the streak; any lapse restarts it
        const nextStreak = meetsThresholds ? prevStreak + 1 : 0;

        // The smaller group buds off; a larger one only if it is clearly the more derived lineage
        let isEligibleToBudOff = clN <= restN;
        if (clN > restN && meetsThresholds) {
          const spBaseAnat = deriveSpeciesAnatomyBaseline(species);
          let sqCl = 0;
          let sqRest = 0;
          for (let l = 0; l < locusCount; l++) {
            const def = schema.loci[l];
            const r = species.traitRanges[def.id] ?? def.defaultRange;
            const span = Math.max(1e-6, r.max - r.min);
            const baseVal = species.traitBaselines[def.id] ?? 1.0;
            const dC = (clMeanCore[l] - baseVal) / span;
            const dR = (refMeanCore[l] - baseVal) / span;
            sqCl += dC * dC;
            sqRest += dR * dR;
          }
          if (hasAnatomy) {
            for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) {
              const r = ANATOMY_RANGES[a];
              const span = r.max - r.min;
              const dC = (clMeanAnat[a] - spBaseAnat[a]) / span;
              const dR = (refMeanAnat[a] - spBaseAnat[a]) / span;
              sqCl += dC * dC;
              sqRest += dR * dR;
            }
          }
          if (sqCl > sqRest * 1.35) isEligibleToBudOff = true;
        }

        params.outTrackerUpdates.push({
          parentSpeciesId: species.id,
          clusterKey,
          nextStreak,
          lastSeenTick: params.targetTick,
          geneticDistance,
          ecologicalDistance,
          reproductiveIsolation,
          memberCount: clN,
        });

        if (
          !proposedForThisSpecies &&
          remainingSpeciesBudget > 0 &&
          meetsThresholds &&
          isEligibleToBudOff &&
          nextStreak >= cfg.requiredPersistenceChecks
        ) {
          const rootId = params.rootSpeciesResolver(species.id);
          let candidateId = `${rootId}_d${seqCursor}`;
          while (params.existingSpeciesIds.has(candidateId)) {
            seqCursor++;
            candidateId = `${rootId}_d${seqCursor}`;
          }
          seqCursor++;
          remainingSpeciesBudget--;
          proposedForThisSpecies = true;

          let bestBiomeIdx = 0;
          let bestBiomeCnt = -1;
          for (let b = 0; b < biomeCounts.length; b++) {
            if (biomeCounts[b] > bestBiomeCnt) {
              bestBiomeCnt = biomeCounts[b];
              bestBiomeIdx = b;
            }
          }
          const daughter = synthesizeDaughterSpecies({
            parent: species,
            newSpeciesId: candidateId,
            meanCoreAlleles: clMeanCore,
            meanAnatomyAlleles: hasAnatomy ? clMeanAnat : Float64Array.from(deriveSpeciesAnatomyBaseline(species)),
            meanHabitatTempC: clMeanTemp,
            meanHabitatMoisture: clMeanMoist,
            dominantBiome: WORLD_BIOME_IDS[bestBiomeIdx],
            cause: evalMode,
          });

          const genSig: number[] = new Array(locusCount);
          for (let l = 0; l < locusCount; l++) genSig[l] = Number(clMeanCore[l].toFixed(4));
          const anatSig: number[] = new Array(ANATOMY_LOCUS_COUNT);
          for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) anatSig[a] = Number(clMeanAnat[a].toFixed(4));

          params.outProposals.push({
            parentSpeciesId: species.id,
            daughterSpecies: daughter,
            cause: evalMode,
            geneticDistance: Number(geneticDistance.toFixed(4)),
            ecologicalDistance: Number(ecologicalDistance.toFixed(4)),
            reproductiveIsolation: Number(reproductiveIsolation.toFixed(4)),
            persistenceTicks: nextStreak * cfg.evolutionCheckInterval,
            founderCount: clN,
            cellCentroid: { x: cxCentroid, y: cyCentroid },
            geneticSignature: genSig,
            anatomySignature: anatSig,
            clusterKey,
            memberDraftIndices: members,
          });
        }
      }
    }
  }
}
