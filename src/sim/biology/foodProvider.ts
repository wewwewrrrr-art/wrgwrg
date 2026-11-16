import { divCeilBig, safeAdd } from '../detMath';
import { AccountKind } from '../energyAccounts';
import { EnergyLedger } from '../energyLedger';
import { EnergyTransaction } from '../energyTransaction';
import { SeedInput, SeededRng, deriveSeed } from '../prng';
import { EntityEnergyStore } from '../stagedStore';
import {
  MassQ,
  PPM,
  RHO_DETRITUS,
  RHO_PLANT,
  applyPpm,
  assertQuanta,
  energyOfMass,
  fractionToPpm,
  muToQ,
  qToEU,
} from '../units';
import { EnergyPool, WorldEnergyGrid } from '../worldEnergyGrid';
import { TerrainType, WORLD_BIOME_IDS, WorldBiomeId, WorldGrid } from '../worldGrid';
import {
  EntityPreyFoodSource,
  NonConservingFoodProviderError,
} from './transactionalFoodSource';
import { MutableFeedingPlanOut, stageFeedingFast } from './trophicNutrition';
import { TrophicProfile, normalizeDietWeights, validateTrophicProfile } from './trophicProfile';

const LOCAL_MAX_SAFE_INT = Number.MAX_SAFE_INTEGER;
const LOCAL_PPM = PPM;
const PLANT_SAFE_MASS_LIMIT = 3_002_399_751_580_330;
const AK_CELL_PLANT = AccountKind.CELL_PLANT;
const AK_CELL_DETRITUS = AccountKind.CELL_DETRITUS;
const AK_ORGANISM_STRUCT = AccountKind.ORGANISM_STRUCT;
const AK_ORGANISM_RESERVE = AccountKind.ORGANISM_RESERVE;
const POOL_PLANT = EnergyPool.PLANT;
const POOL_DETRITUS = EnergyPool.DETRITUS;

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0n ? 1n : x;
}

const _preyFeedScratch: MutableFeedingPlanOut = {
  depositMassQ: 0,
  depositEnergyQ: 0,
  egestaMassQ: 0,
  egestaEnergyQ: 0,
  abioticMassQ: 0,
  heatQ: 0,
};

export interface FoodEnvironmentContext {
  readonly cellIndex: number;
  readonly x: number;
  readonly y: number;
  readonly terrain: TerrainType;
  readonly biome: WorldBiomeId;
  readonly temperature: number;
  readonly moisture: number;
  readonly tick: number;
}

export type FoodConservationMode = 'legacy-non-conserving' | 'conservative';

/**
 * Abstract prey resource provider for carnivorous/omnivorous organisms.
 * Deliberately decoupled from `WorldGrid.biomass` (plant biomass) so predators
 * never feed directly on normalized UI float buffers.
 */
export interface FoodProvider {
  readonly conservationMode?: FoodConservationMode;
  readonly isPhysicallyClosed?: boolean;
  /** Queries currently available prey energy units at `context` without mutating state. */
  getAvailablePrey(context: FoodEnvironmentContext): number;
  /** Consumes up to `requestedAmount` prey units at `context` and returns obtained energy units. */
  consumePrey(context: FoodEnvironmentContext, requestedAmount: number): number;
  /** Optional per-tick prey regeneration hook called once per simulation tick. */
  stepTick?(tick: number): void;
}

export interface ConservativePreyConfig {
  readonly ledger: EnergyLedger;
  readonly energyGrid: WorldEnergyGrid;
  readonly preyStore: EntityEnergyStore;
  /** First entity slot index reserved for per-cell prey pools (default: 0). */
  readonly preySlotOffset?: number;
  /** Fraction of prey grazing sourced from CELL_PLANT in [0, 1] (remainder from CELL_DETRITUS), default 0.75. */
  readonly plantDonorShare?: number;
  /** Gut absorption efficiency for prey grazing in (0, 1], default 0.8. */
  readonly absorptionEfficiency?: number;
  /** Assimilation retention (1 - SDA) for prey grazing in (0, 1], default 0.85. */
  readonly assimilationEfficiency?: number;
  /** Optional explicit herbivore/detritivore profile used when grazing donor pools. */
  readonly preyTrophicProfile?: TrophicProfile;
}

export interface DeterministicPreyConfig {
  readonly seed?: SeedInput;
  /** Baseline carrying capacity multiplier for deterministic prey density (default: 1.0) */
  readonly capacityScale?: number;
  /** Fraction of carrying capacity regenerated per tick in [0, 1] (default: 0.35) */
  readonly regenerationRate?: number;
  /**
   * Optional conservative energy-ledger backing. When omitted, provider operates in
   * explicit `legacy-non-conserving` mode (`isPhysicallyClosed = false`).
   */
  readonly conservative?: ConservativePreyConfig;
}

const BIOME_PREY_CAPACITY: Record<WorldBiomeId, number> = {
  ocean: 0,
  'coastal-wetland': 1.15,
  'tropical-forest': 1.35,
  'temperate-forest': 1.25,
  savanna: 1.4,
  shrubland: 0.9,
  desert: 0.25,
  tundra: 0.35,
  'alpine-rock': 0.15,
  'snow-cap': 0.05,
};

function createDefaultConservativePreyProfile(
  plantShare: number,
  absorption: number,
  assimilation: number
): TrophicProfile {
  const detritusShare = Math.max(0, 1 - plantShare);
  const feedingType = plantShare > 0 && detritusShare > 0 ? 'omnivore' : plantShare > 0 ? 'herbivore' : 'detritivore';
  const weights = normalizeDietWeights({
    plant: plantShare,
    prey: 0,
    carrion: 0,
    detritus: detritusShare,
  });
  const profile: TrophicProfile = Object.freeze({
    feedingType,
    dietWeights: weights,
    adultStructuralMassMU: 1.0,
    maxReserveToStructuralRatio: 2.0,
    absorptionEfficiency: absorption,
    assimilationEfficiency: assimilation,
    growthEfficiency: 0.7,
    structuralAllocationFraction: 0.25,
    basalMetabolicFactor: 0.1,
    thermoregulationFactor: 0.05,
    activityCostFactor: 0.05,
    reproductiveEfficiency: 0.75,
  });
  validateTrophicProfile(profile, feedingType, 'conservativePreyProfile');
  return profile;
}

/**
 * Deterministic prey provider supporting two explicit modes:
 *   - `'legacy-non-conserving'` (default when constructed without `conservative` backing):
 *     preserves original test/stub Float32 buffer behavior and explicitly reports `isPhysicallyClosed = false`.
 *   - `'conservative'` (Phase 2.2.1b / P2):
 *     backed by `EnergyLedger`, `WorldEnergyGrid` donor pools (`CELL_PLANT`, `CELL_DETRITUS`) and
 *     `EntityEnergyStore` prey slots (`isPhysicallyClosed = true`). Every unit of prey regeneration
 *     transfers real mass/energy from donor pools via `EnergyTransaction`; zero regeneration occurs
 *     when donor pools are empty.
 */
export class DeterministicPreyFoodProvider implements FoodProvider {
  public readonly cellCount: number;
  public readonly conservationMode: FoodConservationMode;
  public readonly isPhysicallyClosed: boolean;

  private readonly capacity: Float32Array;
  private readonly available: Float32Array;
  private readonly regenerationRate: number;
  private readonly regenerationRatePpm: number;

  private readonly conservativeBacking:
    | {
        readonly ledger: EnergyLedger;
        readonly energyGrid: WorldEnergyGrid;
        readonly preyStore: EntityEnergyStore;
        readonly preySlotOffset: number;
        readonly plantDonorSharePpm: number;
        readonly preyProfile: TrophicProfile;
        readonly absorptionPpm: number;
        readonly assimilationPpm: number;
        readonly sdaPpm: number;
        readonly grossNumBig: bigint;
        readonly grossDenBig: bigint;
        readonly grossNumSafe: number;
        readonly grossDenSafe: number;
        readonly grossSafeTargetLimit: number;
        readonly capacityQ: Float64Array;
        regenerableCells: Uint32Array;
        regenerableDirty: boolean;
      }
    | null;

  constructor(grid: WorldGrid, config: DeterministicPreyConfig = {}) {
    const capacityScale = config.capacityScale ?? 1.0;
    const regenerationRate = config.regenerationRate ?? 0.35;
    if (!Number.isFinite(capacityScale) || capacityScale < 0) {
      throw new RangeError(`capacityScale must be finite and >= 0, received: ${capacityScale}`);
    }
    if (!Number.isFinite(regenerationRate) || regenerationRate < 0 || regenerationRate > 1) {
      throw new RangeError(`regenerationRate must be in [0, 1], received: ${regenerationRate}`);
    }

    this.cellCount = grid.cellCount;
    this.regenerationRate = regenerationRate;
    this.regenerationRatePpm = fractionToPpm(regenerationRate, 'half-even');
    this.capacity = new Float32Array(grid.cellCount);
    this.available = new Float32Array(grid.cellCount);

    const rng = new SeededRng(deriveSeed(config.seed ?? grid.seed, 'biology:prey-stub'));
    for (let i = 0; i < grid.cellCount; i++) {
      const cell = grid.getCellByIndex(i);
      const isWater = cell.terrain === 'deep-water' || cell.terrain === 'shallow-water';
      if (isWater) {
        this.capacity[i] = 0;
        this.available[i] = 0;
        continue;
      }
      const base = BIOME_PREY_CAPACITY[cell.biome] ?? 0.4;
      const jitter = rng.range(0.85, 1.15);
      const cap = Math.max(0, base * capacityScale * jitter);
      this.capacity[i] = cap;
      this.available[i] = cap;
    }

    if (config.conservative) {
      const c = config.conservative;
      if (c.energyGrid.cellCount !== grid.cellCount) {
        throw new RangeError(
          `energyGrid.cellCount (${c.energyGrid.cellCount}) must match grid.cellCount (${grid.cellCount})`
        );
      }
      const offset = c.preySlotOffset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset + grid.cellCount > c.preyStore.capacity) {
        throw new RangeError(
          `preyStore capacity (${c.preyStore.capacity}) cannot hold slots [${offset}..${offset + grid.cellCount - 1}]`
        );
      }
      const plantShare = c.plantDonorShare ?? 0.75;
      if (!Number.isFinite(plantShare) || plantShare < 0 || plantShare > 1) {
        throw new RangeError(`plantDonorShare must be in [0, 1], received: ${plantShare}`);
      }
      const absorption = c.absorptionEfficiency ?? 0.8;
      const assimilation = c.assimilationEfficiency ?? 0.85;
      const preyProfile =
        c.preyTrophicProfile ?? createDefaultConservativePreyProfile(plantShare, absorption, assimilation);
      validateTrophicProfile(preyProfile, undefined, 'conservative.preyTrophicProfile');

      const capacityQ = new Float64Array(grid.cellCount);
      let regenCount = 0;
      for (let i = 0; i < grid.cellCount; i++) {
        const cap = this.capacity[i] > 0 ? muToQ(this.capacity[i], 'half-even') : 0;
        capacityQ[i] = cap;
        if (cap > 0) regenCount++;
      }
      const regenerableCells = new Uint32Array(regenCount);
      let rIdx = 0;
      for (let i = 0; i < grid.cellCount; i++) {
        if (capacityQ[i] > 0) regenerableCells[rIdx++] = i;
      }

      const absorptionPpm = fractionToPpm(preyProfile.absorptionEfficiency, 'half-even');
      const assimilationPpm = fractionToPpm(preyProfile.assimilationEfficiency, 'half-even');
      const yieldNum = BigInt(absorptionPpm) * BigInt(assimilationPpm);
      const effRatioDen = yieldNum > 0n ? (yieldNum * 3n) / 30n : 1n;
      const rawDen = effRatioDen > 0n ? effRatioDen : 1n;
      const rawNum = 1_000_000_000_000n;
      const g = gcdBig(rawNum, rawDen);
      const grossNumBig = rawNum / g;
      const grossDenBig = rawDen / g;
      const grossFitsSafe = grossNumBig <= BigInt(LOCAL_MAX_SAFE_INT) && grossDenBig <= BigInt(LOCAL_MAX_SAFE_INT);
      const grossNumSafe = grossFitsSafe ? Number(grossNumBig) : 0;
      const grossDenSafe = grossFitsSafe ? Number(grossDenBig) : 1;
      const grossSafeTargetLimit = grossFitsSafe ? Math.floor(LOCAL_MAX_SAFE_INT / grossNumSafe) : -1;

      // In conservative mode, nothing spawns ex-nihilo into `available`
      this.available.fill(0);
      this.conservationMode = 'conservative';
      this.isPhysicallyClosed = true;
      this.conservativeBacking = {
        ledger: c.ledger,
        energyGrid: c.energyGrid,
        preyStore: c.preyStore,
        preySlotOffset: offset,
        plantDonorSharePpm: fractionToPpm(plantShare, 'half-even'),
        preyProfile,
        absorptionPpm,
        assimilationPpm,
        sdaPpm: LOCAL_PPM - assimilationPpm,
        grossNumBig,
        grossDenBig,
        grossNumSafe,
        grossDenSafe,
        grossSafeTargetLimit,
        capacityQ,
        regenerableCells,
        regenerableDirty: false,
      };
    } else {
      this.conservationMode = 'legacy-non-conserving';
      this.isPhysicallyClosed = false;
      this.conservativeBacking = null;
    }
  }

  getAvailablePrey(context: FoodEnvironmentContext): number {
    const idx = context.cellIndex;
    if (idx < 0 || idx >= this.cellCount) return 0;
    if (this.conservativeBacking) {
      return qToEU(this.getAvailablePreyEnergyQ(idx));
    }
    return this.available[idx];
  }

  getAvailablePreyMassQ(cellIndex: number, tx?: EnergyTransaction): MassQ {
    if (cellIndex < 0 || cellIndex >= this.cellCount) return 0;
    if (!this.conservativeBacking) {
      return muToQ(this.available[cellIndex], 'floor');
    }
    const slot = this.conservativeBacking.preySlotOffset + cellIndex;
    if (tx && (tx.state === 'ACTIVE' || tx.state === 'PREPARED')) {
      return safeAdd(
        Number(tx.stagedMassQ(AccountKind.ORGANISM_STRUCT, slot)),
        Number(tx.stagedMassQ(AccountKind.ORGANISM_RESERVE, slot))
      );
    }
    return safeAdd(
      this.conservativeBacking.preyStore.structMassQ(slot),
      this.conservativeBacking.preyStore.reserveMassQ(slot)
    );
  }

  getAvailablePreyEnergyQ(cellIndex: number, tx?: EnergyTransaction): number {
    if (cellIndex < 0 || cellIndex >= this.cellCount) return 0;
    if (!this.conservativeBacking) {
      return muToQ(this.available[cellIndex], 'floor');
    }
    const slot = this.conservativeBacking.preySlotOffset + cellIndex;
    if (tx && (tx.state === 'ACTIVE' || tx.state === 'PREPARED')) {
      return safeAdd(
        Number(tx.stagedEnergyQ(AccountKind.ORGANISM_STRUCT, slot)),
        Number(tx.stagedEnergyQ(AccountKind.ORGANISM_RESERVE, slot))
      );
    }
    return safeAdd(
      this.conservativeBacking.preyStore.structEnergyQ(slot),
      this.conservativeBacking.preyStore.reserveEnergyQ(slot)
    );
  }

  consumePrey(context: FoodEnvironmentContext, requestedAmount: number): number {
    if (this.conservativeBacking) {
      throw new NonConservingFoodProviderError(
        'Conservative prey provider cannot mutate outside an EnergyTransaction; use createTransactionalFoodSource() or EntityPreyFoodSource inside a ledger transaction'
      );
    }
    const idx = context.cellIndex;
    if (idx < 0 || idx >= this.cellCount || requestedAmount <= 0 || !Number.isFinite(requestedAmount)) {
      return 0;
    }
    const avail = this.available[idx];
    if (avail <= 0) return 0;
    const taken = requestedAmount < avail ? requestedAmount : avail;
    this.available[idx] = avail - taken;
    return taken;
  }

  stepTick(_tick: number): void {
    if (this.conservativeBacking) {
      throw new NonConservingFoodProviderError(
        'Conservative prey provider cannot regenerate outside an EnergyTransaction; call stepTickConservative(tx, tick)'
      );
    }
    const rate = this.regenerationRate;
    if (rate <= 0) return;
    for (let i = 0; i < this.cellCount; i++) {
      const cap = this.capacity[i];
      if (cap <= 0) continue;
      const cur = this.available[i];
      if (cur < cap) {
        const next = cur + (cap - cur) * rate;
        this.available[i] = next > cap ? cap : next;
      }
    }
  }

  /**
   * Regenerates prey biomass on `cellIndex` strictly by grazing real `CELL_PLANT` / `CELL_DETRITUS`
   * pools inside `tx`. When donor pools are 0, regenerated mass/energy is strictly 0.
   */
  regenerateCellConservative(tx: EnergyTransaction, cellIndex: number): MassQ {
    const b = this.conservativeBacking;
    if (!b) {
      throw new NonConservingFoodProviderError(
        'regenerateCellConservative() requires conservative backing configuration'
      );
    }
    if ((cellIndex >>> 0) !== cellIndex || cellIndex >= this.cellCount) {
      throw new RangeError(`Cell index out of bounds: ${cellIndex}`);
    }
    const regenPpm = this.regenerationRatePpm;
    if (regenPpm <= 0) return 0;
    const capQ = b.capacityQ[cellIndex];
    if (capQ <= 0) return 0;

    const slot = b.preySlotOffset + cellIndex;
    const isLedgerTx = b.ledger.activeTransaction === tx;
    const curMassQ = isLedgerTx
      ? b.preyStore.stagedStructMassUnsafe(slot) + b.preyStore.stagedReserveMassUnsafe(slot)
      : this.getAvailablePreyMassQ(cellIndex, tx);
    if (curMassQ >= capQ) return 0;

    const deficitQ = capQ - curMassQ;
    const prodDef = deficitQ * regenPpm;
    const targetGainMassQ =
      prodDef <= LOCAL_MAX_SAFE_INT
        ? (prodDef - (prodDef % LOCAL_PPM)) / LOCAL_PPM
        : applyPpm(deficitQ, regenPpm, 'floor');
    if (targetGainMassQ <= 0) return 0;

    const plantAvailQ = isLedgerTx
      ? b.energyGrid.getStagedMassUnsafe(POOL_PLANT, cellIndex)
      : Number(tx.stagedMassQ(AK_CELL_PLANT, cellIndex));
    const detritusAvailQ = isLedgerTx
      ? b.energyGrid.getStagedMassUnsafe(POOL_DETRITUS, cellIndex)
      : Number(tx.stagedMassQ(AK_CELL_DETRITUS, cellIndex));
    if (plantAvailQ === 0 && detritusAvailQ === 0) {
      return 0;
    }

    let grossNeededQ: number;
    if (targetGainMassQ <= b.grossSafeTargetLimit) {
      const num = targetGainMassQ * b.grossNumSafe;
      const r = num % b.grossDenSafe;
      const q = (num - r) / b.grossDenSafe;
      grossNeededQ = r === 0 ? q : q + 1;
    } else {
      const grossNeededBig = divCeilBig(BigInt(targetGainMassQ) * b.grossNumBig, b.grossDenBig);
      grossNeededQ =
        grossNeededBig > BigInt(LOCAL_MAX_SAFE_INT) ? LOCAL_MAX_SAFE_INT : Number(grossNeededBig);
    }

    const plantProd = grossNeededQ * b.plantDonorSharePpm;
    const desiredPlantMassQ =
      plantProd <= LOCAL_MAX_SAFE_INT
        ? (plantProd - (plantProd % LOCAL_PPM)) / LOCAL_PPM
        : applyPpm(grossNeededQ, b.plantDonorSharePpm, 'floor');
    const desiredDetritusMassQ = grossNeededQ - desiredPlantMassQ;

    let remainingHeadroomQ = targetGainMassQ;
    let totalGainedMassQ = 0;

    const grazePlantQ = plantAvailQ < desiredPlantMassQ ? plantAvailQ : desiredPlantMassQ;
    if (grazePlantQ > 0 && remainingHeadroomQ > 0) {
      stageFeedingFast(
        tx,
        AK_CELL_PLANT,
        cellIndex,
        slot,
        cellIndex,
        grazePlantQ,
        grazePlantQ <= PLANT_SAFE_MASS_LIMIT ? grazePlantQ * 3 : energyOfMass(grazePlantQ, RHO_PLANT),
        b.absorptionPpm,
        b.assimilationPpm,
        b.sdaPpm,
        remainingHeadroomQ,
        _preyFeedScratch
      );
      totalGainedMassQ += _preyFeedScratch.depositMassQ;
      remainingHeadroomQ -= _preyFeedScratch.depositMassQ;
    }

    const grazeDetritusQ = detritusAvailQ < desiredDetritusMassQ ? detritusAvailQ : desiredDetritusMassQ;
    if (grazeDetritusQ > 0 && remainingHeadroomQ > 0) {
      stageFeedingFast(
        tx,
        AK_CELL_DETRITUS,
        cellIndex,
        slot,
        cellIndex,
        grazeDetritusQ,
        grazeDetritusQ <= PLANT_SAFE_MASS_LIMIT
          ? grazeDetritusQ * 3
          : energyOfMass(grazeDetritusQ, RHO_DETRITUS),
        b.absorptionPpm,
        b.assimilationPpm,
        b.sdaPpm,
        remainingHeadroomQ,
        _preyFeedScratch
      );
      totalGainedMassQ += _preyFeedScratch.depositMassQ;
      remainingHeadroomQ -= _preyFeedScratch.depositMassQ;
    }

    return totalGainedMassQ;
  }

  /**
   * Runs one full deterministic conservative prey regeneration step across all land cells within `tx`.
   */
  stepTickConservative(tx: EnergyTransaction, _tick: number): MassQ {
    const b = this.conservativeBacking;
    if (!b) {
      throw new NonConservingFoodProviderError(
        'stepTickConservative() requires conservative backing configuration'
      );
    }
    const regenPpm = this.regenerationRatePpm;
    if (regenPpm <= 0) return 0;
    if (b.regenerableDirty) {
      let count = 0;
      const capArr = b.capacityQ;
      for (let i = 0; i < this.cellCount; i++) {
        if (capArr[i] > 0) count++;
      }
      const next = new Uint32Array(count);
      let k = 0;
      for (let i = 0; i < this.cellCount; i++) {
        if (capArr[i] > 0) next[k++] = i;
      }
      b.regenerableCells = next;
      b.regenerableDirty = false;
    }
    const cells = b.regenerableCells;
    if (b.ledger.activeTransaction !== tx) {
      let totalDepositedQ = 0;
      for (let i = 0; i < cells.length; i++) {
        totalDepositedQ += this.regenerateCellConservative(tx, cells[i]);
      }
      return totalDepositedQ;
    }

    const capArr = b.capacityQ;
    const preyChBack = b.preyStore._getChannelStore().back;
    const preyStructBack = preyChBack[0];
    const preyReserveBack = preyChBack[2];
    const gridChBack = b.energyGrid._getChannelStore().back;
    const plantBack = gridChBack[0];
    const detritusBack = gridChBack[4];
    const preySlotOffset = b.preySlotOffset;
    const plantSharePpm = b.plantDonorSharePpm;
    const absorptionPpm = b.absorptionPpm;
    const assimilationPpm = b.assimilationPpm;
    const sdaPpm = b.sdaPpm;
    const grossNumSafe = b.grossNumSafe;
    const grossDenSafe = b.grossDenSafe;
    const grossSafeTargetLimit = b.grossSafeTargetLimit;
    const grossNumBig = b.grossNumBig;
    const grossDenBig = b.grossDenBig;

    let totalDepositedQ = 0;
    for (let i = 0; i < cells.length; i++) {
      const cellIndex = cells[i];
      const capQ = capArr[cellIndex];
      const slot = preySlotOffset + cellIndex;
      const curMassQ = preyStructBack[slot] + preyReserveBack[slot];
      if (curMassQ >= capQ) continue;

      const deficitQ = capQ - curMassQ;
      const prodDef = deficitQ * regenPpm;
      const targetGainMassQ =
        prodDef <= LOCAL_MAX_SAFE_INT
          ? (prodDef - (prodDef % LOCAL_PPM)) / LOCAL_PPM
          : applyPpm(deficitQ, regenPpm, 'floor');
      if (targetGainMassQ <= 0) continue;

      const plantAvailQ = plantBack[cellIndex];
      const detritusAvailQ = detritusBack[cellIndex];
      if (plantAvailQ === 0 && detritusAvailQ === 0) continue;

      let grossNeededQ: number;
      if (targetGainMassQ <= grossSafeTargetLimit) {
        const num = targetGainMassQ * grossNumSafe;
        const r = num % grossDenSafe;
        const q = (num - r) / grossDenSafe;
        grossNeededQ = r === 0 ? q : q + 1;
      } else {
        const grossNeededBig = divCeilBig(BigInt(targetGainMassQ) * grossNumBig, grossDenBig);
        grossNeededQ =
          grossNeededBig > BigInt(LOCAL_MAX_SAFE_INT) ? LOCAL_MAX_SAFE_INT : Number(grossNeededBig);
      }

      const plantProd = grossNeededQ * plantSharePpm;
      const desiredPlantMassQ =
        plantProd <= LOCAL_MAX_SAFE_INT
          ? (plantProd - (plantProd % LOCAL_PPM)) / LOCAL_PPM
          : applyPpm(grossNeededQ, plantSharePpm, 'floor');
      const desiredDetritusMassQ = grossNeededQ - desiredPlantMassQ;

      let remainingHeadroomQ = targetGainMassQ;
      const grazePlantQ = plantAvailQ < desiredPlantMassQ ? plantAvailQ : desiredPlantMassQ;
      if (grazePlantQ > 0 && remainingHeadroomQ > 0) {
        stageFeedingFast(
          tx,
          AK_CELL_PLANT,
          cellIndex,
          slot,
          cellIndex,
          grazePlantQ,
          grazePlantQ <= PLANT_SAFE_MASS_LIMIT ? grazePlantQ * 3 : energyOfMass(grazePlantQ, RHO_PLANT),
          absorptionPpm,
          assimilationPpm,
          sdaPpm,
          remainingHeadroomQ,
          _preyFeedScratch
        );
        totalDepositedQ += _preyFeedScratch.depositMassQ;
        remainingHeadroomQ -= _preyFeedScratch.depositMassQ;
      }

      const grazeDetritusQ = detritusAvailQ < desiredDetritusMassQ ? detritusAvailQ : desiredDetritusMassQ;
      if (grazeDetritusQ > 0 && remainingHeadroomQ > 0) {
        stageFeedingFast(
          tx,
          AK_CELL_DETRITUS,
          cellIndex,
          slot,
          cellIndex,
          grazeDetritusQ,
          grazeDetritusQ <= PLANT_SAFE_MASS_LIMIT
            ? grazeDetritusQ * 3
            : energyOfMass(grazeDetritusQ, RHO_DETRITUS),
          absorptionPpm,
          assimilationPpm,
          sdaPpm,
          remainingHeadroomQ,
          _preyFeedScratch
        );
        totalDepositedQ += _preyFeedScratch.depositMassQ;
        remainingHeadroomQ -= _preyFeedScratch.depositMassQ;
      }
    }
    return totalDepositedQ;
  }

  /** Creates a `TransactionalFoodSource` view backed by the conservative prey `EntityEnergyStore`. */
  createTransactionalFoodSource(sourceId = 'conservative-prey-provider'): EntityPreyFoodSource {
    if (!this.conservativeBacking) {
      throw new NonConservingFoodProviderError(
        'Cannot create conservative EntityPreyFoodSource from a legacy-non-conserving provider'
      );
    }
    return new EntityPreyFoodSource(
      this.conservativeBacking.preyStore,
      this.cellCount,
      this.conservativeBacking.preySlotOffset,
      sourceId
    );
  }

  /** Sets cell capacity (and legacy buffer amount in non-conservative mode). */
  setCellPrey(cellIndex: number, availableAmount: number, capacityAmount = availableAmount): void {
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= this.cellCount) {
      throw new RangeError(`Cell index out of bounds: ${cellIndex}`);
    }
    if (!Number.isFinite(availableAmount) || availableAmount < 0 || !Number.isFinite(capacityAmount) || capacityAmount < 0) {
      throw new RangeError('Prey amounts must be finite and >= 0');
    }
    if (this.conservativeBacking) {
      if (availableAmount !== 0) {
        throw new NonConservingFoodProviderError(
          'Cannot inject unbacked availableAmount in conservative mode; seed donor pools via GENESIS transaction'
        );
      }
      this.capacity[cellIndex] = capacityAmount;
      this.conservativeBacking.capacityQ[cellIndex] =
        capacityAmount > 0 ? muToQ(capacityAmount, 'half-even') : 0;
      this.conservativeBacking.regenerableDirty = true;
      return;
    }
    this.capacity[cellIndex] = capacityAmount;
    this.available[cellIndex] = availableAmount;
  }

  /** Overrides prey capacity and current stock uniformly across all non-water cells. */
  setUniformPrey(grid: WorldGrid, amount: number, capacity = amount): void {
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(capacity) || capacity < 0) {
      throw new RangeError('Prey amounts must be finite and >= 0');
    }
    if (this.conservativeBacking && amount !== 0) {
      throw new NonConservingFoodProviderError(
        'Cannot inject unbacked uniform prey in conservative mode; seed donor pools via GENESIS transaction'
      );
    }
    for (let i = 0; i < this.cellCount; i++) {
      const { x, y } = grid.fromIndex(i);
      const terrain = grid.getTerrain(x, y);
      const isWater = terrain === 'deep-water' || terrain === 'shallow-water';
      this.capacity[i] = isWater ? 0 : capacity;
      if (this.conservativeBacking) {
        this.conservativeBacking.capacityQ[i] =
          !isWater && capacity > 0 ? muToQ(capacity, 'half-even') : 0;
      } else {
        this.available[i] = isWater ? 0 : amount;
      }
    }
    if (this.conservativeBacking) {
      this.conservativeBacking.regenerableDirty = true;
    }
  }

  /** Helper returning biome code check without mutating WorldGrid */
  static getBiomeBasePrey(biome: WorldBiomeId): number {
    return BIOME_PREY_CAPACITY[biome];
  }

  static listBiomeCapacities(): Record<WorldBiomeId, number> {
    const out = {} as Record<WorldBiomeId, number>;
    for (const b of WORLD_BIOME_IDS) {
      out[b] = BIOME_PREY_CAPACITY[b];
    }
    return out;
  }
}

export { assertQuanta };

