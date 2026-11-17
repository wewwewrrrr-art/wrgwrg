import { ANATOMY_LOCUS_COUNT, deriveSpeciesAnatomyBaseline } from './anatomy';
import { SpeciesDefinition } from './species';
import { TrophicType } from './trophicProfile';

export type DivergenceCause = 'founder' | 'allopatric' | 'ecological' | 'parapatric';

export interface DivergenceMetricsSnapshot {
  readonly geneticDistance: number;
  readonly ecologicalDistance: number;
  readonly reproductiveIsolation: number;
  readonly persistenceTicks: number;
}

export interface HybridizationLinkRecord {
  readonly otherSpeciesId: string;
  readonly offspringSpeciesId: string;
  eventCount: number;
  firstTick: number;
  lastTick: number;
  totalViability: number;
  totalFertility: number;
  backcrossCount: number;
}

export interface PhylogenyNode {
  readonly speciesId: string;
  readonly lineageNumber: number;
  readonly rootSpeciesId: string;
  readonly parentIds: readonly string[];
  readonly childIds: string[];
  readonly divergenceTick: number;
  readonly divergenceCause: DivergenceCause;
  readonly divergenceMetrics: DivergenceMetricsSnapshot | null;
  readonly geneticSignature: readonly number[];
  readonly anatomySignature: readonly number[];
  readonly optimalTemperatureC: number;
  readonly diet: TrophicType;
  status: 'active' | 'extinct';
  extinctTick: number | null;
  peakPopulation: number;
  cumulativeBirths: number;
  cumulativeDeaths: number;
  readonly hybridLinks: HybridizationLinkRecord[];
}

export interface SpeciationEvent {
  readonly id: number;
  readonly tick: number;
  readonly parentSpeciesId: string;
  readonly daughterSpeciesId: string;
  readonly cause: Exclude<DivergenceCause, 'founder'>;
  readonly geneticDistance: number;
  readonly ecologicalDistance: number;
  readonly reproductiveIsolation: number;
  readonly founderCount: number;
  readonly cellCentroid: { readonly x: number; readonly y: number };
}

export interface HybridizationEvent {
  readonly tick: number;
  readonly motherSpeciesId: string;
  readonly fatherSpeciesId: string;
  readonly offspringSpeciesId: string;
  readonly viability: number;
  readonly fertility: number;
  readonly isBackcross: boolean;
}

export interface PhylogenySnapshot {
  readonly nodes: readonly PhylogenyNode[];
  readonly speciationEvents: readonly SpeciationEvent[];
  readonly hybridizationEvents: readonly HybridizationEvent[];
  readonly nextLineageNumber: number;
  readonly nextEventId: number;
}

function defaultGeneticSignature(species: SpeciesDefinition): number[] {
  const sig: number[] = [];
  for (const locus of species.genomeSchema.loci) {
    sig.push(species.traitBaselines[locus.id] ?? 1.0);
  }
  return sig;
}

function defaultAnatomySignature(species: SpeciesDefinition): number[] {
  const base = deriveSpeciesAnatomyBaseline(species);
  const sig: number[] = new Array(ANATOMY_LOCUS_COUNT);
  for (let i = 0; i < ANATOMY_LOCUS_COUNT; i++) {
    sig[i] = base[i];
  }
  return sig;
}

/**
 * Persistent phylogenetic DAG tracking lineages, divergences, speciation causes,
 * reticulate hybridization links, and extinctions across the full simulation lifetime.
 */
export class PhylogenyTracker {
  private readonly nodes = new Map<string, PhylogenyNode>();
  private readonly speciationEvents: SpeciationEvent[] = [];
  private readonly hybridizationEvents: HybridizationEvent[] = [];
  private readonly maxHybridEventHistory: number;
  private nextLineageNumber = 1;
  private nextEventId = 1;

  constructor(initialSpecies: readonly SpeciesDefinition[], maxHybridEventHistory = 2000) {
    this.maxHybridEventHistory = maxHybridEventHistory;
    for (const sp of initialSpecies) {
      this.ensureFounderNode(sp, 0);
    }
  }

  ensureFounderNode(species: SpeciesDefinition, tick = 0): PhylogenyNode {
    const existing = this.nodes.get(species.id);
    if (existing) return existing;

    const node: PhylogenyNode = {
      speciesId: species.id,
      lineageNumber: this.nextLineageNumber++,
      rootSpeciesId: species.id,
      parentIds: [],
      childIds: [],
      divergenceTick: tick,
      divergenceCause: 'founder',
      divergenceMetrics: null,
      geneticSignature: defaultGeneticSignature(species),
      anatomySignature: defaultAnatomySignature(species),
      optimalTemperatureC: species.physiology.optimalTemperatureC,
      diet: species.diet,
      status: 'active',
      extinctTick: null,
      peakPopulation: 0,
      cumulativeBirths: 0,
      cumulativeDeaths: 0,
      hybridLinks: [],
    };
    this.nodes.set(species.id, node);
    return node;
  }

  recordSpeciation(params: {
    readonly tick: number;
    readonly parentSpecies: SpeciesDefinition;
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
  }): SpeciationEvent {
    const parentNode = this.ensureFounderNode(params.parentSpecies, 0);
    if (this.nodes.has(params.daughterSpecies.id)) {
      throw new Error(`Phylogeny node "${params.daughterSpecies.id}" already exists`);
    }

    const daughterNode: PhylogenyNode = {
      speciesId: params.daughterSpecies.id,
      lineageNumber: this.nextLineageNumber++,
      rootSpeciesId: parentNode.rootSpeciesId,
      parentIds: [parentNode.speciesId],
      childIds: [],
      divergenceTick: params.tick,
      divergenceCause: params.cause,
      divergenceMetrics: {
        geneticDistance: params.geneticDistance,
        ecologicalDistance: params.ecologicalDistance,
        reproductiveIsolation: params.reproductiveIsolation,
        persistenceTicks: params.persistenceTicks,
      },
      geneticSignature: params.geneticSignature.slice(),
      anatomySignature: params.anatomySignature.slice(),
      optimalTemperatureC: params.daughterSpecies.physiology.optimalTemperatureC,
      diet: params.daughterSpecies.diet,
      status: 'active',
      extinctTick: null,
      peakPopulation: params.founderCount,
      cumulativeBirths: 0,
      cumulativeDeaths: 0,
      hybridLinks: [],
    };

    parentNode.childIds.push(daughterNode.speciesId);
    this.nodes.set(daughterNode.speciesId, daughterNode);

    const event: SpeciationEvent = Object.freeze({
      id: this.nextEventId++,
      tick: params.tick,
      parentSpeciesId: parentNode.speciesId,
      daughterSpeciesId: daughterNode.speciesId,
      cause: params.cause,
      geneticDistance: params.geneticDistance,
      ecologicalDistance: params.ecologicalDistance,
      reproductiveIsolation: params.reproductiveIsolation,
      founderCount: params.founderCount,
      cellCentroid: Object.freeze({ x: params.cellCentroid.x, y: params.cellCentroid.y }),
    });
    this.speciationEvents.push(event);
    return event;
  }

  recordHybridization(event: HybridizationEvent): void {
    const nodeA = this.nodes.get(event.motherSpeciesId);
    const nodeB = this.nodes.get(event.fatherSpeciesId);

    const updateLink = (node: PhylogenyNode | undefined, otherId: string) => {
      if (!node) return;
      let link = node.hybridLinks.find(
        (l) => l.otherSpeciesId === otherId && l.offspringSpeciesId === event.offspringSpeciesId
      );
      if (!link) {
        link = {
          otherSpeciesId: otherId,
          offspringSpeciesId: event.offspringSpeciesId,
          eventCount: 0,
          firstTick: event.tick,
          lastTick: event.tick,
          totalViability: 0,
          totalFertility: 0,
          backcrossCount: 0,
        };
        node.hybridLinks.push(link);
      }
      link.eventCount += 1;
      link.lastTick = event.tick;
      link.totalViability += event.viability;
      link.totalFertility += event.fertility;
      if (event.isBackcross) link.backcrossCount += 1;
    };

    updateLink(nodeA, event.fatherSpeciesId);
    if (event.fatherSpeciesId !== event.motherSpeciesId) {
      updateLink(nodeB, event.motherSpeciesId);
    }

    if (this.maxHybridEventHistory > 0) {
      this.hybridizationEvents.push(Object.freeze({ ...event }));
      if (this.hybridizationEvents.length > this.maxHybridEventHistory) {
        this.hybridizationEvents.shift();
      }
    }
  }

  syncPopulationState(
    speciesId: string,
    aliveCount: number,
    birthsTotal: number,
    deathsTotal: number,
    tick: number
  ): void {
    const node = this.nodes.get(speciesId);
    if (!node) return;
    if (aliveCount > node.peakPopulation) {
      node.peakPopulation = aliveCount;
    }
    node.cumulativeBirths = birthsTotal;
    node.cumulativeDeaths = deathsTotal;

    const hadEverMembers = birthsTotal > 0 || node.peakPopulation > 0 || deathsTotal > 0;
    if (aliveCount === 0 && hadEverMembers) {
      if (node.status === 'active') {
        node.status = 'extinct';
        node.extinctTick = tick;
      }
    } else if (aliveCount > 0 && node.status === 'extinct') {
      node.status = 'active';
      node.extinctTick = null;
    }
  }

  getNode(speciesId: string): PhylogenyNode | undefined {
    return this.nodes.get(speciesId);
  }

  getNodes(): readonly PhylogenyNode[] {
    return Array.from(this.nodes.values());
  }

  getActiveLineages(): readonly PhylogenyNode[] {
    return this.getNodes().filter((n) => n.status === 'active');
  }

  getExtinctLineages(): readonly PhylogenyNode[] {
    return this.getNodes().filter((n) => n.status === 'extinct');
  }

  getRootSpeciesId(speciesId: string): string {
    return this.nodes.get(speciesId)?.rootSpeciesId ?? speciesId;
  }

  /**
   * Computes evolutionary clade distance (graph edge hops to MRCA, or Infinity if distinct roots).
   */
  getCladeHopDistance(speciesA: string, speciesB: string): number {
    if (speciesA === speciesB) return 0;
    const nodeA = this.nodes.get(speciesA);
    const nodeB = this.nodes.get(speciesB);
    if (!nodeA || !nodeB) return Infinity;
    if (nodeA.rootSpeciesId !== nodeB.rootSpeciesId) return Infinity;

    const ancA = new Map<string, number>();
    let cur: PhylogenyNode | undefined = nodeA;
    let dA = 0;
    while (cur) {
      ancA.set(cur.speciesId, dA);
      cur = cur.parentIds.length > 0 ? this.nodes.get(cur.parentIds[0]) : undefined;
      dA++;
    }

    let curB: PhylogenyNode | undefined = nodeB;
    let dB = 0;
    while (curB) {
      const match = ancA.get(curB.speciesId);
      if (match !== undefined) return match + dB;
      curB = curB.parentIds.length > 0 ? this.nodes.get(curB.parentIds[0]) : undefined;
      dB++;
    }
    return Infinity;
  }

  getAncestors(speciesId: string): readonly PhylogenyNode[] {
    const result: PhylogenyNode[] = [];
    let cur = this.nodes.get(speciesId);
    while (cur && cur.parentIds.length > 0) {
      const parent = this.nodes.get(cur.parentIds[0]);
      if (!parent) break;
      result.push(parent);
      cur = parent;
    }
    return result;
  }

  getDescendants(speciesId: string): readonly PhylogenyNode[] {
    const start = this.nodes.get(speciesId);
    if (!start) return [];
    const result: PhylogenyNode[] = [];
    const queue: string[] = [...start.childIds];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = this.nodes.get(id);
      if (!node) continue;
      result.push(node);
      for (const c of node.childIds) queue.push(c);
    }
    return result;
  }

  getSpeciationEvents(): readonly SpeciationEvent[] {
    return this.speciationEvents;
  }

  getHybridizationEvents(): readonly HybridizationEvent[] {
    return this.hybridizationEvents;
  }

  toSnapshot(): PhylogenySnapshot {
    return {
      nodes: this.getNodes().map((n) => ({
        ...n,
        parentIds: [...n.parentIds],
        childIds: [...n.childIds],
        divergenceMetrics: n.divergenceMetrics ? { ...n.divergenceMetrics } : null,
        geneticSignature: [...n.geneticSignature],
        anatomySignature: [...n.anatomySignature],
        hybridLinks: n.hybridLinks.map((l) => ({ ...l })),
      })),
      speciationEvents: [...this.speciationEvents],
      hybridizationEvents: [...this.hybridizationEvents],
      nextLineageNumber: this.nextLineageNumber,
      nextEventId: this.nextEventId,
    };
  }
}
