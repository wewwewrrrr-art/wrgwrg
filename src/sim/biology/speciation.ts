import { WORLD_BIOME_IDS, WorldBiomeId, WorldGrid } from '../worldGrid';
import {
  ANATOMY_IDX,
  ANATOMY_LOCUS_COUNT,
  ANATOMY_RANGES,
  deriveSpeciesAnatomyBaseline,
  ensureOrganismAnatomy,
} from './anatomy';
import { TraitId } from './genome';
import { Organism } from './organism';
import { DivergenceCause } from './phylogeny';
import { SpatialSpeciesProfile } from './spatialProfile';
import { SpeciesDefinition, TrophicType, validateSpeciesDefinition } from './species';
import { TrophicProfile, resolveSpeciesTrophicProfile } from './trophicProfile';

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
}

const FLAG_DIED = 1 << 2;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Synthesizes a valid, gradually modified daughter SpeciesDefinition from a diverging
 * subpopulation's evolved genetic, anatomical, thermal, and habitat centroids.
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
  const { parent, newSpeciesId, meanCoreAlleles, meanAnatomyAlleles, meanHabitatTempC, dominantBiome } = params;
  const schema = parent.genomeSchema;

  const newBaselines: Partial<Record<TraitId, number>> = { ...parent.traitBaselines };
  for (let l = 0; l < schema.locusCount; l++) {
    const def = schema.loci[l];
    const r = parent.traitRanges[def.id] ?? def.defaultRange;
    const evolved = clamp(meanCoreAlleles[l], r.min, r.max);
    const parentVal = parent.traitBaselines[def.id] ?? evolved;
    // Gradual baseline consolidation (75% toward evolved cluster centroid)
    newBaselines[def.id] = clamp(parentVal + (evolved - parentVal) * 0.75, r.min, r.max);
  }

  // Gradual thermal optimum shift capped within +-9 C per speciation event
  const rawTempShift = meanHabitatTempC - parent.physiology.optimalTemperatureC;
  const boundedTempShift = clamp(rawTempShift * 0.65, -9.0, 9.0);
  const newOptTemp = clamp(parent.physiology.optimalTemperatureC + boundedTempShift, -25, 50);

  // Locomotion & terrain affinity gradual adaptation from evolved anatomy
  const aq = meanAnatomyAlleles[ANATOMY_IDX.AQUATIC_AFFINITY];
  const climb = meanAnatomyAlleles[ANATOMY_IDX.CLIMBING_AFFINITY];
  const limb = meanAnatomyAlleles[ANATOMY_IDX.LIMB_LENGTH];
  const integ = meanAnatomyAlleles[ANATOMY_IDX.INTEGUMENT_THICKNESS];

  let nextLocomotion: 'terrestrial' | 'amphibious' | 'aquatic' = parent.spatial?.locomotion ?? 'terrestrial';
  if (nextLocomotion === 'terrestrial' && aq >= 0.34) {
    nextLocomotion = 'amphibious';
  } else if (nextLocomotion === 'amphibious' && aq >= 0.70) {
    nextLocomotion = 'aquatic';
  } else if (nextLocomotion === 'aquatic' && aq < 0.45) {
    nextLocomotion = 'amphibious';
  }

  const baseSpatial = parent.spatial;
  const nextTerrainCost = baseSpatial?.terrainCost ? { ...baseSpatial.terrainCost } : {};
  if (aq >= 0.34) {
    nextTerrainCost['shallow-water'] = Math.max(1.0, (nextTerrainCost['shallow-water'] ?? 2.4) * (1 - 0.35 * aq));
    if (aq >= 0.68) {
      nextTerrainCost['deep-water'] = Math.max(1.0, (nextTerrainCost['deep-water'] ?? 3.5) * 0.45);
    }
  }
  if (climb >= 0.40) {
    nextTerrainCost.hills = Math.max(1.0, (nextTerrainCost.hills ?? 1.4) * (1 - 0.22 * climb));
    nextTerrainCost.mountains = Math.max(1.2, (nextTerrainCost.mountains ?? 2.4) * (1 - 0.28 * climb));
  }

  const nextSpatial: SpatialSpeciesProfile | undefined = baseSpatial
    ? {
        ...baseSpatial,
        locomotion: nextLocomotion,
        terrainCost: nextTerrainCost,
        thirstPerTick: aq >= 0.45 ? Math.max(0.01, (baseSpatial.thirstPerTick ?? 0.04) * 0.7) : baseSpatial.thirstPerTick,
      }
    : undefined;

  // Gradual trophic shift (only via viable omnivore/intermediate stepping stones; never carnivore <-> herbivore jump)
  const herbApp = meanAnatomyAlleles[ANATOMY_IDX.HERBIVORY_APPARATUS];
  const carnApp = meanAnatomyAlleles[ANATOMY_IDX.CARNIVORY_APPARATUS];
  const parentTrophic = resolveSpeciesTrophicProfile(parent);
  let nextDiet: TrophicType = parent.diet;
  let nextTrophic: TrophicProfile = { ...parentTrophic };

  if (parent.diet === 'herbivore' && carnApp >= 0.42 && herbApp <= 0.65) {
    nextDiet = 'omnivore';
    nextTrophic = {
      ...parentTrophic,
      feedingType: 'omnivore',
      dietWeights: { plant: 0.65, prey: 0.22, carrion: 0.13, detritus: 0 },
    };
  } else if (parent.diet === 'carnivore' && herbApp >= 0.42 && carnApp <= 0.65) {
    nextDiet = 'omnivore';
    nextTrophic = {
      ...parentTrophic,
      feedingType: 'omnivore',
      dietWeights: { plant: 0.28, prey: 0.56, carrion: 0.16, detritus: 0 },
    };
  } else if (parent.diet === 'omnivore') {
    if (herbApp - carnApp >= 0.36) {
      nextDiet = 'herbivore';
      nextTrophic = {
        ...parentTrophic,
        feedingType: 'herbivore',
        dietWeights: { plant: 0.85, prey: 0, carrion: 0, detritus: 0.15 },
      };
    } else if (carnApp - herbApp >= 0.36) {
      nextDiet = 'carnivore';
      nextTrophic = {
        ...parentTrophic,
        feedingType: 'carnivore',
        dietWeights: { plant: 0, prey: 0.82, carrion: 0.18, detritus: 0 },
      };
    }
  }

  // Body structural mass modulation from evolved bodyScale
  const parentBody = parent.traitBaselines.bodySize ?? 1.0;
  const evolvedBody = newBaselines.bodySize ?? parentBody;
  const sizeRatio = clamp(evolvedBody / Math.max(0.25, parentBody), 0.72, 1.40);
  nextTrophic = {
    ...nextTrophic,
    adultStructuralMassMU: Number((parentTrophic.adultStructuralMassMU * sizeRatio).toFixed(4)),
  };

  // Descriptive ecological suffix
  let ecotypeLabel = params.cause === 'allopatric' ? 'Insular' : 'Divergent';
  if (newOptTemp <= parent.physiology.optimalTemperatureC - 3.5 || integ >= 1.28) {
    ecotypeLabel = 'Boreal';
  } else if (newOptTemp >= parent.physiology.optimalTemperatureC + 3.5 || integ <= 0.72) {
    ecotypeLabel = 'Arid';
  } else if (nextLocomotion === 'amphibious' || nextLocomotion === 'aquatic') {
    ecotypeLabel = 'Littoral';
  } else if (climb >= 0.42) {
    ecotypeLabel = 'Montane';
  } else if (limb >= 1.25) {
    ecotypeLabel = 'Cursorial';
  }

  const nextPreferredBiomes =
    dominantBiome && !parent.preferredBiomes.includes(dominantBiome)
      ? [...parent.preferredBiomes, dominantBiome]
      : [...parent.preferredBiomes];

  const daughter: SpeciesDefinition = {
    id: newSpeciesId,
    name: `${ecotypeLabel} ${parent.name}`,
    diet: nextDiet,
    preferredBiomes: nextPreferredBiomes,
    timeScale: parent.timeScale,
    lifecycle: { ...parent.lifecycle },
    reproduction: { ...parent.reproduction },
    physiology: {
      ...parent.physiology,
      optimalTemperatureC: Number(newOptTemp.toFixed(2)),
    },
    genomeSchema: parent.genomeSchema,
    requiredTraits: parent.requiredTraits,
    traitRanges: parent.traitRanges,
    traitBaselines: newBaselines,
    initialGeneticSpread: parent.initialGeneticSpread,
    mutation: { ...parent.mutation },
    trophicProfile: nextTrophic,
    ...(nextSpatial ? { spatial: nextSpatial } : {}),
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
        state = { streak: u.nextStreak, lastSeenTick: u.lastSeenTick, assignedSpeciesId: null };
        this.clusterTrackers.set(fullKey, state);
      } else {
        state.streak = u.nextStreak;
        state.lastSeenTick = u.lastSeenTick;
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

  /**
   * Pure RESOLVE-phase evaluation: scans surviving drafts per species, detects isolated/divergent
   * subpopulations, computes genetic/ecological/reproductive isolation metrics, and emits
   * staged speciation proposals + tracker updates without mutating persistent state.
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
    outReset: {
      params.outProposals.length = 0;
      params.outTrackerUpdates.length = 0;
      break outReset;
    }

    const cfg = this.config;
    if (!cfg.enabled) return;
    if (params.targetTick % cfg.evolutionCheckInterval !== 0) return;

    const totalSpeciesCount = params.speciesCount;
    let remainingSpeciesBudget = Math.max(0, cfg.maxSpeciesCount - totalSpeciesCount);
    let seqCursor = this.nextDaughterSeq;

    const w = this.gridWidth;
    const h = this.gridHeight;
    const linkR = cfg.geneFlowLinkDistance;
    const temps = params.grid.temperature;
    const moists = params.grid.moisture;
    const cellPresent = this.cellPresent;
    const cellClusterId = this.cellClusterId;
    const occCells = this.occCells;
    const bfsQueue = this.bfsQueue;

    for (let s = 0; s < totalSpeciesCount; s++) {
      const start = params.speciesDraftStart[s];
      const end = params.speciesDraftEnd[s];
      const upperSpan = end - start;
      if (upperSpan < cfg.minClusterSize) continue;

      const species = params.speciesList[s];
      const schema = species.genomeSchema;
      const locusCount = schema.locusCount;
      const navComp =
        params.navComponents && params.speciesNavClass
          ? params.navComponents[params.speciesNavClass[s]] ?? null
          : null;

      // 1. Collect living draft indices and mark occupied cells in O(N_s)
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
      if (nAlive < cfg.minClusterSize) {
        for (let i = 0; i < occCount; i++) cellPresent[occCells[i]] = 0;
        continue;
      }

      // 2. Partition occupied cells into spatially cohesive clusters via BFS within linkDistance
      //    Respecting navigation barrier components when spatial mode is active!
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

      // 3. Bucket alive organisms into their spatial clusters
      let clusterMembers: number[][] = new Array(clusterCount);
      for (let c = 0; c < clusterCount; c++) clusterMembers[c] = [];
      for (let i = 0; i < nAlive; i++) {
        const d = aliveDrafts[i];
        const cid = cellClusterId[params.draftCellIndex[d]];
        clusterMembers[cid].push(d);
      }

      // Cleanup cell arrays immediately
      for (let i = 0; i < occCount; i++) {
        const c = occCells[i];
        cellPresent[c] = 0;
        cellClusterId[c] = -1;
      }

      // 4. Determine mode:
      //    - Multi-cluster (allopatric / parapatric spatial separation), OR
      //    - Single-cluster ecological split (if clear thermal/aquatic bimodality exists), OR
      //    - Single isolated population strongly diverged from registered baseline (anagenesis)
      let evalMode: Exclude<DivergenceCause, 'founder'> = 'allopatric';
      let isEcologicalBimodalSplit = false;

      if (clusterCount === 1 && nAlive >= cfg.minClusterSize * 2) {
        // Check if organisms span contrasting thermal or aquatic regimes (bimodal niche check)
        let minT = Infinity;
        let maxT = -Infinity;
        let minAq = Infinity;
        let maxAq = -Infinity;
        for (let i = 0; i < nAlive; i++) {
          const d = aliveDrafts[i];
          const c = params.draftCellIndex[d];
          const t = temps[c];
          if (t < minT) minT = t;
          if (t > maxT) maxT = t;
          const anat = ensureOrganismAnatomy(params.draftOrg[d], species);
          const aq = anat.expressed[ANATOMY_IDX.AQUATIC_AFFINITY];
          if (aq < minAq) minAq = aq;
          if (aq > maxAq) maxAq = aq;
        }

        if (maxT - minT >= 10.0) {
          const midT = (minT + maxT) * 0.5;
          const coldGroup: number[] = [];
          const warmGroup: number[] = [];
          for (let i = 0; i < nAlive; i++) {
            const d = aliveDrafts[i];
            if (temps[params.draftCellIndex[d]] < midT) coldGroup.push(d);
            else warmGroup.push(d);
          }
          if (coldGroup.length >= cfg.minClusterSize && warmGroup.length >= cfg.minClusterSize) {
            clusterMembers = [coldGroup, warmGroup];
            clusterCount = 2;
            evalMode = 'ecological';
            isEcologicalBimodalSplit = true;
          }
        } else if (maxAq - minAq >= 0.30) {
          const midAq = (minAq + maxAq) * 0.5;
          const landGroup: number[] = [];
          const waterGroup: number[] = [];
          for (let i = 0; i < nAlive; i++) {
            const d = aliveDrafts[i];
            const aq = ensureOrganismAnatomy(params.draftOrg[d], species).expressed[ANATOMY_IDX.AQUATIC_AFFINITY];
            if (aq < midAq) landGroup.push(d);
            else waterGroup.push(d);
          }
          if (landGroup.length >= cfg.minClusterSize && waterGroup.length >= cfg.minClusterSize) {
            clusterMembers = [landGroup, waterGroup];
            clusterCount = 2;
            evalMode = 'ecological';
            isEcologicalBimodalSplit = true;
          }
        }
      }

      // Compute whole-species sums for fast complement centroid computation
      const totalCoreSum = new Float64Array(locusCount);
      const totalAnatSum = new Float64Array(ANATOMY_LOCUS_COUNT);
      let totalTempSum = 0;
      let totalMoistSum = 0;
      for (let i = 0; i < nAlive; i++) {
        const d = aliveDrafts[i];
        const org = params.draftOrg[d];
        const c = params.draftCellIndex[d];
        totalTempSum += temps[c];
        totalMoistSum += moists[c];
        const mat = org.genome.maternalAlleles;
        const pat = org.genome.paternalAlleles;
        for (let l = 0; l < locusCount; l++) {
          totalCoreSum[l] += (mat[l] + pat[l]) * 0.5;
        }
        const anat = ensureOrganismAnatomy(org, species);
        for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) {
          totalAnatSum[a] += (anat.maternal[a] + anat.paternal[a]) * 0.5;
        }
      }

      // Evaluate each qualifying cluster against either its sister complement or ancestral baseline
      const clCoreSum = new Float64Array(locusCount);
      const clAnatSum = new Float64Array(ANATOMY_LOCUS_COUNT);
      const clMeanCore = new Float64Array(locusCount);
      const clMeanAnat = new Float64Array(ANATOMY_LOCUS_COUNT);
      const refMeanCore = new Float64Array(locusCount);
      const refMeanAnat = new Float64Array(ANATOMY_LOCUS_COUNT);

      // Sort clusters deterministically by smallest member organism ID so proposals are canonical
      const clusterMeta: Array<{ cid: number; minOrgId: number }> = [];
      for (let c = 0; c < clusterCount; c++) {
        const members = clusterMembers[c];
        if (members.length < cfg.minClusterSize) continue;
        let minId = Infinity;
        for (let i = 0; i < members.length; i++) {
          const id = params.draftOrg[members[i]].id;
          if (id < minId) minId = id;
        }
        clusterMeta.push({ cid: c, minOrgId: minId });
      }
      clusterMeta.sort((a, b) => a.minOrgId - b.minOrgId);

      // Avoid splitting ALL clusters at once on the same tick when there are only 2 clusters:
      // split the smaller/more-diverged sister subpopulation while keeping the larger parental lineage intact!
      let proposedForThisSpecies = false;

      for (let m = 0; m < clusterMeta.length; m++) {
        const members = clusterMembers[clusterMeta[m].cid];
        const clN = members.length;
        const restN = nAlive - clN;

        // Require either a valid sister population remaining OR strong divergence from registered baseline
        const hasSisterComplement = restN >= cfg.minParentRemainSize;
        if (!hasSisterComplement && clusterCount > 1) continue;

        clCoreSum.fill(0);
        clAnatSum.fill(0);
        let clTempSum = 0;
        let clMoistSum = 0;
        let sumX = 0;
        let sumY = 0;
        let eligibleOrAdultCount = 0;
        const biomeCodes = params.grid.biomeCode;
        const biomeCounts = new Int32Array(WORLD_BIOME_IDS.length);

        for (let i = 0; i < clN; i++) {
          const d = members[i];
          const org = params.draftOrg[d];
          const c = params.draftCellIndex[d];
          clTempSum += temps[c];
          clMoistSum += moists[c];
          const bCode = biomeCodes[c];
          if (bCode < biomeCounts.length) biomeCounts[bCode]++;
          const cy = (c / w) | 0;
          const cx = c - cy * w;
          sumX += cx;
          sumY += cy;
          if (org.stage === 'adult' || org.stage === 'elder') {
            eligibleOrAdultCount++;
          }
          const mat = org.genome.maternalAlleles;
          const pat = org.genome.paternalAlleles;
          for (let l = 0; l < locusCount; l++) {
            clCoreSum[l] += (mat[l] + pat[l]) * 0.5;
          }
          const anat = ensureOrganismAnatomy(org, species);
          for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) {
            clAnatSum[a] += (anat.maternal[a] + anat.paternal[a]) * 0.5;
          }
        }

        // Cannot form a new reproducing lineage from sterile eggs alone
        if (eligibleOrAdultCount < 2) continue;

        const invCl = 1 / clN;
        for (let l = 0; l < locusCount; l++) clMeanCore[l] = clCoreSum[l] * invCl;
        for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) clMeanAnat[a] = clAnatSum[a] * invCl;
        const clMeanTemp = clTempSum * invCl;
        const clMeanMoist = clMoistSum * invCl;
        const cxCentroid = Math.round(sumX * invCl);
        const cyCentroid = Math.round(sumY * invCl);

        // Build spatial/niche tracker key using quantized centroid bucket (16x16 grid region + ecotype)
        const regionX = cxCentroid >> 3;
        const regionY = cyCentroid >> 3;
        const clusterKey = isEcologicalBimodalSplit
          ? `eco_${clusterMeta[m].cid}_${Math.round(clMeanTemp / 5)}`
          : `allo_${regionX}_${regionY}`;

        // Compute reference centroid: sister complement if cladogenetic, else parent baseline if anagenetic
        let refTemp: number;
        if (hasSisterComplement) {
          const invRest = 1 / restN;
          for (let l = 0; l < locusCount; l++) {
            refMeanCore[l] = (totalCoreSum[l] - clCoreSum[l]) * invRest;
          }
          for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) {
            refMeanAnat[a] = (totalAnatSum[a] - clAnatSum[a]) * invRest;
          }
          refTemp = (totalTempSum - clTempSum) * invRest;
        } else {
          // Single-cluster comparison against ancestral registered SpeciesDefinition baseline
          for (let l = 0; l < locusCount; l++) {
            const def = schema.loci[l];
            refMeanCore[l] = species.traitBaselines[def.id] ?? 1.0;
          }
          const spBase = deriveSpeciesAnatomyBaseline(species);
          for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) {
            refMeanAnat[a] = spBase[a];
          }
          refTemp = species.physiology.optimalTemperatureC;
        }

        // Compute normalized heritable genetic divergence D_gen
        let sqGen = 0;
        let totalLoci = 0;
        for (let l = 0; l < locusCount; l++) {
          const def = schema.loci[l];
          const r = species.traitRanges[def.id] ?? def.defaultRange;
          const span = Math.max(1e-6, r.max - r.min);
          const diff = (clMeanCore[l] - refMeanCore[l]) / span;
          sqGen += diff * diff;
          totalLoci++;
        }
        for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) {
          const r = ANATOMY_RANGES[a];
          const diff = (clMeanAnat[a] - refMeanAnat[a]) / (r.max - r.min);
          sqGen += diff * diff;
          totalLoci++;
        }
        const geneticDistance = Math.sqrt(sqGen / Math.max(1, totalLoci));

        // Compute ecological & morphological divergence D_eco
        const dTemp = (clMeanTemp - refTemp) / 25;
        const dSize = (clMeanCore[0] ?? 1) - (refMeanCore[0] ?? 1);
        const dInteg = clMeanAnat[ANATOMY_IDX.INTEGUMENT_THICKNESS] - refMeanAnat[ANATOMY_IDX.INTEGUMENT_THICKNESS];
        const dAq = clMeanAnat[ANATOMY_IDX.AQUATIC_AFFINITY] - refMeanAnat[ANATOMY_IDX.AQUATIC_AFFINITY];
        const dHerb = clMeanAnat[ANATOMY_IDX.HERBIVORY_APPARATUS] - refMeanAnat[ANATOMY_IDX.HERBIVORY_APPARATUS];
        const dCarn = clMeanAnat[ANATOMY_IDX.CARNIVORY_APPARATUS] - refMeanAnat[ANATOMY_IDX.CARNIVORY_APPARATUS];
        const ecologicalDistance = Math.sqrt(
          (dTemp * dTemp + dSize * dSize + dInteg * dInteg + 1.5 * dAq * dAq + dHerb * dHerb + dCarn * dCarn) / 6.5
        );

        // Compute emergent reproductive isolation score from pre-zygotic + post-zygotic barriers
        const iPre = clamp01(1 - Math.exp(-3.8 * ecologicalDistance * ecologicalDistance));
        const postT = geneticDistance > 0.085 ? (geneticDistance - 0.085) / 0.30 : 0;
        const iPost = clamp01(0.75 * postT);
        const reproductiveIsolation = clamp01(1 - (1 - iPre) * (1 - iPost));

        // Apply stricter bar when no spatial barrier separates clusters (ecological / single-pop)
        const genReq = !hasSisterComplement
          ? cfg.minGeneticDivergence * 1.38
          : isEcologicalBimodalSplit
            ? cfg.minGeneticDivergence * 1.15
            : cfg.minGeneticDivergence;
        const ecoReq = !hasSisterComplement ? cfg.minEcologicalDivergence * 1.35 : cfg.minEcologicalDivergence;
        const isoReq = !hasSisterComplement ? cfg.minReproductiveIsolation * 1.15 : cfg.minReproductiveIsolation;
        const streakReq = !hasSisterComplement ? cfg.requiredPersistenceChecks + 1 : cfg.requiredPersistenceChecks;

        const prevState = this.clusterTrackers.get(`${species.id}::${clusterKey}`);
        if (prevState?.assignedSpeciesId) {
          // Already speciated cluster; decay/keep idle
          continue;
        }

        const prevStreak = prevState?.streak ?? 0;
        const meetsThresholds =
          geneticDistance >= genReq &&
          ecologicalDistance >= ecoReq &&
          reproductiveIsolation >= isoReq;

        // Track streak purely on sustained divergence & isolation so slight size fluctuations
        // do not wipe out an isolated subpopulation's divergence history.
        const nextStreak = meetsThresholds ? prevStreak + 1 : Math.max(0, prevStreak - 1);

        // When picking which subpopulation splits as a new taxon on cladogenesis:
        // split the smaller cluster OR (if larger) only if it diverged noticeably further from
        // the ancestral baseline than the remaining group.
        let isEligibleToBudOff = !hasSisterComplement || clN <= restN;
        if (hasSisterComplement && clN > restN && meetsThresholds) {
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
          for (let a = 0; a < ANATOMY_LOCUS_COUNT; a++) {
            const r = ANATOMY_RANGES[a];
            const span = r.max - r.min;
            const dC = (clMeanAnat[a] - spBaseAnat[a]) / span;
            const dR = (refMeanAnat[a] - spBaseAnat[a]) / span;
            sqCl += dC * dC;
            sqRest += dR * dR;
          }
          if (sqCl > sqRest * 1.35) {
            isEligibleToBudOff = true;
          }
        }

        params.outTrackerUpdates.push({
          parentSpeciesId: species.id,
          clusterKey,
          nextStreak,
          lastSeenTick: params.targetTick,
        });

        if (
          !proposedForThisSpecies &&
          remainingSpeciesBudget > 0 &&
          meetsThresholds &&
          isEligibleToBudOff &&
          nextStreak >= streakReq
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
          const dominantBiome = WORLD_BIOME_IDS[bestBiomeIdx];

          const daughter = synthesizeDaughterSpecies({
            parent: species,
            newSpeciesId: candidateId,
            meanCoreAlleles: clMeanCore,
            meanAnatomyAlleles: clMeanAnat,
            meanHabitatTempC: clMeanTemp,
            meanHabitatMoisture: clMeanMoist,
            dominantBiome,
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
            memberDraftIndices: members.slice(),
          });
        }
      }
    }
  }
}
