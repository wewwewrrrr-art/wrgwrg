import { detPow075, divCeilBig, safeAdd } from '../detMath';
import { AccountKind, AccountKindId, PostingReason } from '../energyAccounts';
import { EnergyTransaction } from '../energyTransaction';
import {
  CarrionBitePlan,
  EnergyQ,
  FeedingAllocationPlan,
  MassQ,
  MutableCarrionFractions,
  PPM,
  ReserveMetabolismPlan,
  RHO_DETRITUS,
  RHO_PLANT,
  RHO_RESERVE,
  RHO_STRUCT,
  RoundingMode,
  applyPpm,
  assertPpm,
  assertQuanta,
  energyOfMass,
  euToQ,
  fractionToPpm,
  massForEnergy,
  muToQ,
  numberToQuanta,
  planCarrionConsumption,
  planCarrionDecomposition,
  planFeedingAllocation,
  planReserveMetabolism,
  qToMU,
  scaleByRatio,
  splitCarrionMassInto,
} from '../units';
import { TrophicProfile, validateTrophicProfile } from './trophicProfile';

const LOCAL_MAX_SAFE_INT = Number.MAX_SAFE_INTEGER;
const LOCAL_PPM = PPM;
const PLANT_SAFE_MASS_LIMIT = 3_002_399_751_580_330; // floor(MAX_SAFE_INT / 3)
const STRUCT_SAFE_MASS_LIMIT = 1_801_439_850_948_198; // floor(MAX_SAFE_INT / 5)
const RESERVE_SAFE_MASS_LIMIT = 300_239_975_158_033; // floor(MAX_SAFE_INT / 30)

const AK_ABIOTIC = AccountKind.ABIOTIC;
const AK_HEAT = AccountKind.HEAT;
const AK_CELL_PLANT = AccountKind.CELL_PLANT;
const AK_CELL_CARRION = AccountKind.CELL_CARRION;
const AK_CELL_DETRITUS = AccountKind.CELL_DETRITUS;
const AK_ORGANISM_STRUCT = AccountKind.ORGANISM_STRUCT;
const AK_ORGANISM_RESERVE = AccountKind.ORGANISM_RESERVE;

const PR_INGESTION = PostingReason.INGESTION;
const PR_EGESTION = PostingReason.EGESTION;
const PR_SDA = PostingReason.SDA;
const PR_METABOLISM = PostingReason.METABOLISM;
const PR_GROWTH = PostingReason.GROWTH;
const PR_REPRODUCTION = PostingReason.REPRODUCTION;
const PR_DEATH = PostingReason.DEATH;
const PR_DECOMPOSITION = PostingReason.DECOMPOSITION;

const _carrionScratch: MutableCarrionFractions = {
  structMassQ: 0,
  structEnergyQ: 0,
  reserveMassQ: 0,
  reserveEnergyQ: 0,
};

export interface MetabolicDemandBreakdown {
  readonly basalDemandQ: EnergyQ;
  readonly thermoregulationDemandQ: EnergyQ;
  readonly activityDemandQ: EnergyQ;
  readonly totalDemandQ: EnergyQ;
}

export interface ExtendedFeedingPlan extends FeedingAllocationPlan {
  readonly absorptionPpm: number;
  readonly assimilationPpm: number;
  readonly sdaHeatQ: EnergyQ;
  readonly clampedByHeadroom: boolean;
}

export interface SomaticGrowthPlan {
  readonly targetStructMassQ: MassQ;
  readonly structGainMassQ: MassQ;
  readonly structGainEnergyQ: EnergyQ;
  readonly burnReserveMassQ: MassQ;
  readonly burnReserveEnergyQ: EnergyQ;
  readonly abioticInMassQ: MassQ;
  readonly abioticOutMassQ: MassQ;
  readonly heatQ: EnergyQ;
}

export interface ReproductionProvisioningResult {
  readonly provisioned: boolean;
  readonly reason: 'ok' | 'zero-request' | 'insufficient-reserve' | 'insufficient-abiotic';
  readonly childStructMassQ: MassQ;
  readonly childStructEnergyQ: EnergyQ;
  readonly childReserveMassQ: MassQ;
  readonly childReserveEnergyQ: EnergyQ;
  readonly burnReserveMassQ: MassQ;
  readonly burnReserveEnergyQ: EnergyQ;
  readonly abioticInMassQ: MassQ;
  readonly abioticOutMassQ: MassQ;
  readonly heatQ: EnergyQ;
}

export interface DecompositionPlan {
  readonly decomposedMassQ: MassQ;
  readonly decomposedEnergyQ: EnergyQ;
  readonly structMassQ: MassQ;
  readonly reserveMassQ: MassQ;
}

export interface CachedProfileQuanta {
  readonly adultMassQ: MassQ;
  readonly maxReserveRatioScaled: number;
  readonly absorptionPpm: number;
  readonly assimilationPpm: number;
  readonly sdaPpm: number;
  readonly growthEffPpm: number;
  readonly allocPpm: number;
  readonly reproEffPpm: number;
}

const cachedFrozenProfileQuanta = new WeakMap<TrophicProfile, CachedProfileQuanta>();

export function computeProfileQuanta(profile: TrophicProfile): CachedProfileQuanta {
  const existing = cachedFrozenProfileQuanta.get(profile);
  if (existing) return existing;
  const absorptionPpm = fractionToPpm(profile.absorptionEfficiency, 'half-even');
  const assimilationPpm = fractionToPpm(profile.assimilationEfficiency, 'half-even');
  return {
    adultMassQ: muToQ(profile.adultStructuralMassMU, 'half-even'),
    maxReserveRatioScaled: numberToQuanta(profile.maxReserveToStructuralRatio, LOCAL_PPM, 'half-even'),
    absorptionPpm,
    assimilationPpm,
    sdaPpm: LOCAL_PPM - assimilationPpm,
    growthEffPpm: fractionToPpm(profile.growthEfficiency, 'half-even'),
    allocPpm: fractionToPpm(profile.structuralAllocationFraction, 'half-even'),
    reproEffPpm: fractionToPpm(profile.reproductiveEfficiency, 'half-even'),
  };
}

function getOrCacheProfileQuanta(profile: TrophicProfile, validateFirst = false): CachedProfileQuanta | null {
  const existing = cachedFrozenProfileQuanta.get(profile);
  if (existing) return existing;
  if (validateFirst) {
    validateTrophicProfile(profile);
  }
  if (!Object.isFrozen(profile) || !Object.isFrozen(profile.dietWeights)) {
    return null;
  }
  const entry = computeProfileQuanta(profile);
  cachedFrozenProfileQuanta.set(profile, entry);
  return entry;
}

/** Computes target structural mass in `qMU` for a given `TrophicProfile` and `maturityScale` in `(0, 1]`. */
export function computeTargetStructMassQ(profile: TrophicProfile, maturityScale = 1): MassQ {
  let cached = cachedFrozenProfileQuanta.get(profile);
  if (!cached) {
    validateTrophicProfile(profile);
    cached = getOrCacheProfileQuanta(profile, false) ?? undefined;
  }
  if (typeof maturityScale !== 'number' || !Number.isFinite(maturityScale) || maturityScale <= 0 || maturityScale > 1) {
    throw new RangeError(`maturityScale must be in (0, 1], received: ${maturityScale}`);
  }
  const adultMassQ = cached ? cached.adultMassQ : muToQ(profile.adultStructuralMassMU, 'half-even');
  if (maturityScale === 1) return adultMassQ;
  const scalePpm = fractionToPpm(maturityScale, 'half-even');
  return Math.max(1, applyPpm(adultMassQ, scalePpm, 'floor'));
}

/** Maximum permitted reserve mass (`qMU`) for `structMassQ` under `profile.maxReserveToStructuralRatio`. */
export function computeMaxReserveMassQ(structMassQ: MassQ, profile: TrophicProfile): MassQ {
  assertQuanta(structMassQ, 'structMassQ');
  const cached = getOrCacheProfileQuanta(profile, false);
  const ratioScaled = cached
    ? cached.maxReserveRatioScaled
    : numberToQuanta(profile.maxReserveToStructuralRatio, PPM, 'half-even');
  return scaleByRatio(structMassQ, ratioScaled, PPM, 'floor');
}

/** Remaining reserve mass capacity (`qMU`) before hitting the species structural cap. */
export function computeReserveHeadroomMassQ(
  structMassQ: MassQ,
  currentReserveMassQ: MassQ,
  profile: TrophicProfile
): MassQ {
  assertQuanta(currentReserveMassQ, 'currentReserveMassQ');
  const maxReserveMassQ = computeMaxReserveMassQ(structMassQ, profile);
  return currentReserveMassQ >= maxReserveMassQ ? 0 : maxReserveMassQ - currentReserveMassQ;
}

/**
 * Orthogonal 3-component metabolic demand breakdown (`qEU` per step):
 *   - `basalDemandQ`:             `basalMetabolicFactor * bodyMassMU^0.75`
 *   - `thermoregulationDemandQ`:  `thermoregulationFactor * thermalStress * bodyMassMU^0.75`
 *   - `activityDemandQ`:          `activityCostFactor * activityLevel * bodyMassMU`
 * Zero overlap across all three parameters.
 */
export function computeMetabolicDemandBreakdownQ(
  profile: TrophicProfile,
  structMassQ: MassQ,
  reserveMassQ: MassQ,
  thermalStress = 0,
  activityLevel = 0
): MetabolicDemandBreakdown {
  assertQuanta(structMassQ, 'structMassQ');
  assertQuanta(reserveMassQ, 'reserveMassQ');
  if (typeof thermalStress !== 'number' || !Number.isFinite(thermalStress) || thermalStress < 0) {
    throw new RangeError(`thermalStress must be finite and >= 0, received: ${thermalStress}`);
  }
  if (typeof activityLevel !== 'number' || !Number.isFinite(activityLevel) || activityLevel < 0) {
    throw new RangeError(`activityLevel must be finite and >= 0, received: ${activityLevel}`);
  }

  const totalMassQ = safeAdd(structMassQ, reserveMassQ);
  const totalMassMU = qToMU(totalMassQ);
  const kleiberScale = totalMassMU > 0 ? detPow075(totalMassMU) : 0;

  const basalDemandQ = euToQ(profile.basalMetabolicFactor * kleiberScale, 'half-even');
  const thermoregulationDemandQ =
    thermalStress > 0
      ? euToQ(profile.thermoregulationFactor * thermalStress * kleiberScale, 'half-even')
      : 0;
  const activityDemandQ =
    activityLevel > 0 ? euToQ(profile.activityCostFactor * activityLevel * totalMassMU, 'half-even') : 0;

  const totalDemandQ = safeAdd(basalDemandQ, safeAdd(thermoregulationDemandQ, activityDemandQ));

  return Object.freeze({
    basalDemandQ,
    thermoregulationDemandQ,
    activityDemandQ,
    totalDemandQ,
  });
}

/**
 * Allocation-free scalar total metabolic demand (`qEU` per step), exact sum of the 3 orthogonal terms.
 */
export function computeTotalMetabolicDemandQ(
  profile: TrophicProfile,
  structMassQ: MassQ,
  reserveMassQ: MassQ,
  thermalStress = 0,
  activityLevel = 0
): EnergyQ {
  assertQuanta(structMassQ, 'structMassQ');
  assertQuanta(reserveMassQ, 'reserveMassQ');
  if (typeof thermalStress !== 'number' || !Number.isFinite(thermalStress) || thermalStress < 0) {
    throw new RangeError(`thermalStress must be finite and >= 0, received: ${thermalStress}`);
  }
  if (typeof activityLevel !== 'number' || !Number.isFinite(activityLevel) || activityLevel < 0) {
    throw new RangeError(`activityLevel must be finite and >= 0, received: ${activityLevel}`);
  }

  const totalMassQ = safeAdd(structMassQ, reserveMassQ);
  const totalMassMU = qToMU(totalMassQ);
  const kleiberScale = totalMassMU > 0 ? detPow075(totalMassMU) : 0;

  const basalDemandQ = euToQ(profile.basalMetabolicFactor * kleiberScale, 'half-even');
  const thermoregulationDemandQ =
    thermalStress > 0
      ? euToQ(profile.thermoregulationFactor * thermalStress * kleiberScale, 'half-even')
      : 0;
  const activityDemandQ =
    activityLevel > 0 ? euToQ(profile.activityCostFactor * activityLevel * totalMassMU, 'half-even') : 0;

  return safeAdd(basalDemandQ, safeAdd(thermoregulationDemandQ, activityDemandQ));
}

/**
 * Stages exact `ORGANISM_RESERVE` combustion for `demandQ` (`PostingReason.METABOLISM`).
 * Uses P0 `planReserveMetabolism` with sub-quantum `carryCreditQ`; never burns `ORGANISM_STRUCT`.
 */
export function stageMetabolism(
  tx: EnergyTransaction,
  organismSlot: number,
  reserveMassQ: MassQ,
  demandQ: EnergyQ,
  carryCreditQ: EnergyQ = 0
): ReserveMetabolismPlan {
  const plan = planReserveMetabolism(reserveMassQ, demandQ, carryCreditQ);
  if (plan.burnMassQ > 0) {
    tx.postMass(
      PostingReason.METABOLISM,
      AccountKind.ORGANISM_RESERVE,
      organismSlot,
      AccountKind.ABIOTIC,
      0,
      plan.burnMassQ
    );
  }
  if (plan.burnEnergyQ > 0) {
    tx.postEnergy(
      PostingReason.METABOLISM,
      AccountKind.ORGANISM_RESERVE,
      organismSlot,
      AccountKind.HEAT,
      0,
      plan.burnEnergyQ
    );
  }
  return plan;
}

/**
 * Partitions ingested food `(foodMassQ, foodEnergyQ)` using P0 `planFeedingAllocation` with
 * orthogonal gut `absorptionEfficiency` and post-absorptive `assimilationEfficiency` (`SDA = 1 - assim`).
 * Optionally enforces `reserveHeadroomMassQ` without dropping any mass or energy quantum.
 */
export function computeFeedingPlan(
  foodMassQ: MassQ,
  foodEnergyQ: EnergyQ,
  profile: TrophicProfile,
  reserveHeadroomMassQ?: MassQ
): ExtendedFeedingPlan {
  assertQuanta(foodMassQ, 'foodMassQ');
  assertQuanta(foodEnergyQ, 'foodEnergyQ');
  if (reserveHeadroomMassQ !== undefined) {
    assertQuanta(reserveHeadroomMassQ, 'reserveHeadroomMassQ');
  }

  const cached = getOrCacheProfileQuanta(profile, false);
  const absorptionPpm = cached ? cached.absorptionPpm : fractionToPpm(profile.absorptionEfficiency, 'half-even');
  const assimilationPpm = cached ? cached.assimilationPpm : fractionToPpm(profile.assimilationEfficiency, 'half-even');
  const sdaPpm = cached ? cached.sdaPpm : PPM - assimilationPpm;

  const absorbedEnergyQ = applyPpm(foodEnergyQ, absorptionPpm, 'floor');
  const sdaHeatQ = applyPpm(absorbedEnergyQ, sdaPpm, 'floor');

  const raw = planFeedingAllocation(foodMassQ, foodEnergyQ, absorptionPpm, sdaPpm);

  if (reserveHeadroomMassQ !== undefined && raw.depositMassQ > reserveHeadroomMassQ) {
    const depositMassQ = reserveHeadroomMassQ;
    const depositEnergyQ = energyOfMass(depositMassQ, RHO_RESERVE);
    const rejectedMassQ = raw.depositMassQ - depositMassQ;
    const rejectedEnergyQ = raw.depositEnergyQ - depositEnergyQ;
    return Object.freeze({
      depositMassQ,
      depositEnergyQ,
      egestaMassQ: raw.egestaMassQ,
      egestaEnergyQ: raw.egestaEnergyQ,
      abioticMassQ: safeAdd(raw.abioticMassQ, rejectedMassQ),
      heatQ: safeAdd(raw.heatQ, rejectedEnergyQ),
      absorptionPpm,
      assimilationPpm,
      sdaHeatQ,
      clampedByHeadroom: true,
    });
  }

  return Object.freeze({
    depositMassQ: raw.depositMassQ,
    depositEnergyQ: raw.depositEnergyQ,
    egestaMassQ: raw.egestaMassQ,
    egestaEnergyQ: raw.egestaEnergyQ,
    abioticMassQ: raw.abioticMassQ,
    heatQ: raw.heatQ,
    absorptionPpm,
    assimilationPpm,
    sdaHeatQ,
    clampedByHeadroom: false,
  });
}

/**
 * Computes the largest mass bite `<= availableFoodMassQ` (for plant/detritus/prey-like uniform or
 * mixed carrion source) whose deposited reserve stays within `reserveHeadroomMassQ`.
 */
export function computeBiteMassForHeadroom(
  availableMassQ: MassQ,
  availableEnergyQ: EnergyQ,
  requestedMassQ: MassQ,
  reserveHeadroomMassQ: MassQ,
  profile: TrophicProfile,
  sourceKind: 'plant' | 'detritus' | 'carrion' | 'uniform' = 'uniform'
): MassQ {
  assertQuanta(availableMassQ, 'availableMassQ');
  assertQuanta(availableEnergyQ, 'availableEnergyQ');
  assertQuanta(requestedMassQ, 'requestedMassQ');
  assertQuanta(reserveHeadroomMassQ, 'reserveHeadroomMassQ');

  const maxBite = Math.min(availableMassQ, requestedMassQ);
  if (maxBite === 0 || reserveHeadroomMassQ === 0) return 0;

  const energyForBite = (biteMassQ: MassQ): EnergyQ => {
    if (biteMassQ === 0) return 0;
    if (sourceKind === 'plant') return energyOfMass(biteMassQ, RHO_PLANT);
    if (sourceKind === 'detritus') return energyOfMass(biteMassQ, RHO_DETRITUS);
    if (sourceKind === 'carrion') {
      return planCarrionConsumption(availableMassQ, availableEnergyQ, biteMassQ).totalEnergyQ;
    }
    return scaleByRatio(availableEnergyQ, biteMassQ, availableMassQ, 'floor');
  };

  if (computeFeedingPlan(maxBite, energyForBite(maxBite), profile).depositMassQ <= reserveHeadroomMassQ) {
    return maxBite;
  }

  let lo = 0;
  let hi = maxBite;
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2);
    const plan = computeFeedingPlan(mid, energyForBite(mid), profile);
    if (plan.depositMassQ <= reserveHeadroomMassQ) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/**
 * Stages a feeding event from a single food account `(srcKind, srcId)` into `ORGANISM_RESERVE[eaterSlot]`,
 * `CELL_DETRITUS[detritusCellIndex]`, `ABIOTIC` and `HEAT`.
 */
export function stageFeeding(
  tx: EnergyTransaction,
  srcKind: AccountKindId,
  srcId: number,
  eaterSlot: number,
  detritusCellIndex: number,
  foodMassQ: MassQ,
  foodEnergyQ: EnergyQ,
  profile: TrophicProfile,
  reserveHeadroomMassQ?: MassQ
): ExtendedFeedingPlan {
  const plan = computeFeedingPlan(foodMassQ, foodEnergyQ, profile, reserveHeadroomMassQ);
  if (foodMassQ === 0 && foodEnergyQ === 0) {
    return plan;
  }

  if (plan.depositMassQ > 0 || plan.depositEnergyQ > 0) {
    tx.transferBiomass(
      PostingReason.INGESTION,
      srcKind,
      srcId,
      AccountKind.ORGANISM_RESERVE,
      eaterSlot,
      plan.depositMassQ,
      plan.depositEnergyQ
    );
  }
  if ((plan.egestaMassQ > 0 || plan.egestaEnergyQ > 0) && !(srcKind === AccountKind.CELL_DETRITUS && srcId === detritusCellIndex)) {
    tx.transferBiomass(
      PostingReason.EGESTION,
      srcKind,
      srcId,
      AccountKind.CELL_DETRITUS,
      detritusCellIndex,
      plan.egestaMassQ,
      plan.egestaEnergyQ
    );
  }
  if (plan.abioticMassQ > 0) {
    tx.postMass(PostingReason.SDA, srcKind, srcId, AccountKind.ABIOTIC, 0, plan.abioticMassQ);
  }
  if (plan.heatQ > 0) {
    tx.postEnergy(PostingReason.SDA, srcKind, srcId, AccountKind.HEAT, 0, plan.heatQ);
  }

  return plan;
}

/**
 * Proportional `(STRUCT=5, RESERVE=30)` bite calculator for live prey predation, matching
 * `planCarrionConsumption` so remaining prey tissue stays strictly on `(5, 30)` stoichiometry.
 */
export function planProportionalPreyBite(
  preyStructMassQ: MassQ,
  preyReserveMassQ: MassQ,
  biteMassQ: MassQ,
  mode: RoundingMode = 'half-even'
): CarrionBitePlan {
  assertQuanta(preyStructMassQ, 'preyStructMassQ');
  assertQuanta(preyReserveMassQ, 'preyReserveMassQ');
  assertQuanta(biteMassQ, 'biteMassQ');

  const totalPreyMassQ = safeAdd(preyStructMassQ, preyReserveMassQ);
  const totalPreyEnergyQ = safeAdd(
    energyOfMass(preyStructMassQ, RHO_STRUCT),
    energyOfMass(preyReserveMassQ, RHO_RESERVE)
  );
  return planCarrionConsumption(totalPreyMassQ, totalPreyEnergyQ, biteMassQ, mode);
}

/**
 * Stages scavenging from `CELL_CARRION[cellIndex]` while strictly preserving exact `(5, 30)`
 * carrion stoichiometry on the remaining pool.
 */
export function stageCarrionScavenge(
  tx: EnergyTransaction,
  cellIndex: number,
  eaterSlot: number,
  detritusCellIndex: number,
  requestedMassQ: MassQ,
  profile: TrophicProfile,
  reserveHeadroomMassQ?: MassQ
): { readonly bite: CarrionBitePlan; readonly feeding: ExtendedFeedingPlan } {
  assertQuanta(requestedMassQ, 'requestedMassQ');
  const carrionMassQ = Number(tx.stagedMassQ(AccountKind.CELL_CARRION, cellIndex));
  const carrionEnergyQ = Number(tx.stagedEnergyQ(AccountKind.CELL_CARRION, cellIndex));
  const biteMassQ = Math.min(requestedMassQ, carrionMassQ);

  const bite = planCarrionConsumption(carrionMassQ, carrionEnergyQ, biteMassQ);
  const feeding = stageFeeding(
    tx,
    AccountKind.CELL_CARRION,
    cellIndex,
    eaterSlot,
    detritusCellIndex,
    bite.totalMassQ,
    bite.totalEnergyQ,
    profile,
    reserveHeadroomMassQ
  );
  return Object.freeze({ bite, feeding });
}

/**
 * Stages live predation debiting proportional fractions from `ORGANISM_RESERVE[preySlot]` and
 * `ORGANISM_STRUCT[preySlot]` without violating `5 / 30 / 3` strict stoichiometry on prey, eater,
 * or detritus.
 */
export function stagePreyPredation(
  tx: EnergyTransaction,
  preySlot: number,
  eaterSlot: number,
  detritusCellIndex: number,
  requestedMassQ: MassQ,
  profile: TrophicProfile,
  reserveHeadroomMassQ?: MassQ
): { readonly bite: CarrionBitePlan; readonly feeding: ExtendedFeedingPlan } {
  assertQuanta(requestedMassQ, 'requestedMassQ');
  const preyStructMassQ = Number(tx.stagedMassQ(AccountKind.ORGANISM_STRUCT, preySlot));
  const preyReserveMassQ = Number(tx.stagedMassQ(AccountKind.ORGANISM_RESERVE, preySlot));
  const totalPreyMassQ = safeAdd(preyStructMassQ, preyReserveMassQ);
  const biteMassQ = Math.min(requestedMassQ, totalPreyMassQ);

  const bite = planProportionalPreyBite(preyStructMassQ, preyReserveMassQ, biteMassQ);
  const feeding = computeFeedingPlan(bite.totalMassQ, bite.totalEnergyQ, profile, reserveHeadroomMassQ);
  if (bite.totalMassQ === 0 && bite.totalEnergyQ === 0) {
    return Object.freeze({ bite, feeding });
  }

  // Distribute mass outflows cleanly across reserveMass and structMass
  let remReserveMass = bite.reserveMassQ;
  let remStructMass = bite.structMassQ;
  const routeMass = (reason: (typeof PostingReason)[keyof typeof PostingReason], dstKind: AccountKindId, dstId: number, amount: number) => {
    let left = amount;
    if (left > 0 && remReserveMass > 0) {
      const take = Math.min(left, remReserveMass);
      tx.postMass(reason, AccountKind.ORGANISM_RESERVE, preySlot, dstKind, dstId, take);
      remReserveMass -= take;
      left -= take;
    }
    if (left > 0 && remStructMass > 0) {
      const take = Math.min(left, remStructMass);
      tx.postMass(reason, AccountKind.ORGANISM_STRUCT, preySlot, dstKind, dstId, take);
      remStructMass -= take;
      left -= take;
    }
  };

  routeMass(PostingReason.INGESTION, AccountKind.ORGANISM_RESERVE, eaterSlot, feeding.depositMassQ);
  routeMass(PostingReason.EGESTION, AccountKind.CELL_DETRITUS, detritusCellIndex, feeding.egestaMassQ);
  routeMass(PostingReason.SDA, AccountKind.ABIOTIC, 0, feeding.abioticMassQ);

  // Independently distribute energy outflows across reserveEnergy and structEnergy
  let remReserveEnergy = bite.reserveEnergyQ;
  let remStructEnergy = bite.structEnergyQ;
  const routeEnergy = (reason: (typeof PostingReason)[keyof typeof PostingReason], dstKind: AccountKindId, dstId: number, amount: number) => {
    let left = amount;
    if (left > 0 && remReserveEnergy > 0) {
      const take = Math.min(left, remReserveEnergy);
      tx.postEnergy(reason, AccountKind.ORGANISM_RESERVE, preySlot, dstKind, dstId, take);
      remReserveEnergy -= take;
      left -= take;
    }
    if (left > 0 && remStructEnergy > 0) {
      const take = Math.min(left, remStructEnergy);
      tx.postEnergy(reason, AccountKind.ORGANISM_STRUCT, preySlot, dstKind, dstId, take);
      remStructEnergy -= take;
      left -= take;
    }
  };

  routeEnergy(PostingReason.INGESTION, AccountKind.ORGANISM_RESERVE, eaterSlot, feeding.depositEnergyQ);
  routeEnergy(PostingReason.EGESTION, AccountKind.CELL_DETRITUS, detritusCellIndex, feeding.egestaEnergyQ);
  routeEnergy(PostingReason.SDA, AccountKind.HEAT, 0, feeding.heatQ);

  return Object.freeze({ bite, feeding });
}

function neededReserveForStructGain(structGainMassQ: MassQ, growthEffPpm: number): MassQ {
  if (structGainMassQ === 0) return 0;
  const structEnergyQ = energyOfMass(structGainMassQ, RHO_STRUCT);
  const neededReserveEnergyQ = divCeilBig(BigInt(structEnergyQ) * BigInt(PPM), BigInt(growthEffPpm));
  const euScale = 30n; // RHO_RESERVE = 30 EU/MU and MU_SCALE === EU_SCALE
  return Number(divCeilBig(neededReserveEnergyQ, euScale));
}

/**
 * Computes and stages somatic growth (`ORGANISM_RESERVE -> ORGANISM_STRUCT` + `ABIOTIC` balance +
 * synthesis `HEAT`) governed orthogonally by:
 *   - `adultStructuralMassMU`
 *   - `structuralAllocationFraction`
 *   - `growthEfficiency`
 */
export function stageSomaticGrowth(
  tx: EnergyTransaction,
  organismSlot: number,
  structMassQ: MassQ,
  reserveMassQ: MassQ,
  availableAbioticMassQ: MassQ,
  profile: TrophicProfile,
  maturityScale = 1
): SomaticGrowthPlan {
  assertQuanta(structMassQ, 'structMassQ');
  assertQuanta(reserveMassQ, 'reserveMassQ');
  assertQuanta(availableAbioticMassQ, 'availableAbioticMassQ');

  const targetStructMassQ = computeTargetStructMassQ(profile, maturityScale);
  if (structMassQ >= targetStructMassQ || reserveMassQ === 0) {
    return Object.freeze({
      targetStructMassQ,
      structGainMassQ: 0,
      structGainEnergyQ: 0,
      burnReserveMassQ: 0,
      burnReserveEnergyQ: 0,
      abioticInMassQ: 0,
      abioticOutMassQ: 0,
      heatQ: 0,
    });
  }

  const cached = getOrCacheProfileQuanta(profile, false);
  const allocPpm = cached ? cached.allocPpm : fractionToPpm(profile.structuralAllocationFraction, 'half-even');
  const allocatedReserveMassQ = applyPpm(reserveMassQ, allocPpm, 'floor');
  if (allocatedReserveMassQ === 0) {
    return Object.freeze({
      targetStructMassQ,
      structGainMassQ: 0,
      structGainEnergyQ: 0,
      burnReserveMassQ: 0,
      burnReserveEnergyQ: 0,
      abioticInMassQ: 0,
      abioticOutMassQ: 0,
      heatQ: 0,
    });
  }

  const growthEffPpm = cached ? cached.growthEffPpm : fractionToPpm(profile.growthEfficiency, 'half-even');
  const budgetReserveEnergyQ = energyOfMass(allocatedReserveMassQ, RHO_RESERVE);
  const rawUsefulEnergyQ = applyPpm(budgetReserveEnergyQ, growthEffPpm, 'floor');
  const maxStructFromBudget = massForEnergy(rawUsefulEnergyQ, RHO_STRUCT, 'floor');
  const deficitStructMassQ = targetStructMassQ - structMassQ;
  let structGainMassQ = Math.min(deficitStructMassQ, maxStructFromBudget);

  // Enforce available abiotic mass pool ceiling when turning high-density reserve into structural tissue
  const abioticNeededFor = (gainQ: MassQ): number => {
    const burnQ = neededReserveForStructGain(gainQ, growthEffPpm);
    return gainQ > burnQ ? gainQ - burnQ : 0;
  };
  if (abioticNeededFor(structGainMassQ) > availableAbioticMassQ) {
    let lo = 0;
    let hi = structGainMassQ;
    while (lo < hi) {
      const mid = lo + Math.ceil((hi - lo) / 2);
      if (abioticNeededFor(mid) <= availableAbioticMassQ) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    structGainMassQ = lo;
  }

  if (structGainMassQ === 0) {
    return Object.freeze({
      targetStructMassQ,
      structGainMassQ: 0,
      structGainEnergyQ: 0,
      burnReserveMassQ: 0,
      burnReserveEnergyQ: 0,
      abioticInMassQ: 0,
      abioticOutMassQ: 0,
      heatQ: 0,
    });
  }

  const structGainEnergyQ = energyOfMass(structGainMassQ, RHO_STRUCT);
  const burnReserveMassQ = neededReserveForStructGain(structGainMassQ, growthEffPpm);
  const burnReserveEnergyQ = energyOfMass(burnReserveMassQ, RHO_RESERVE);
  const heatQ = burnReserveEnergyQ - structGainEnergyQ;
  const abioticInMassQ = structGainMassQ > burnReserveMassQ ? structGainMassQ - burnReserveMassQ : 0;
  const abioticOutMassQ = burnReserveMassQ > structGainMassQ ? burnReserveMassQ - structGainMassQ : 0;

  // Post energy
  tx.postEnergy(
    PostingReason.GROWTH,
    AccountKind.ORGANISM_RESERVE,
    organismSlot,
    AccountKind.ORGANISM_STRUCT,
    organismSlot,
    structGainEnergyQ
  );
  if (heatQ > 0) {
    tx.postEnergy(
      PostingReason.GROWTH,
      AccountKind.ORGANISM_RESERVE,
      organismSlot,
      AccountKind.HEAT,
      0,
      heatQ
    );
  }

  // Post mass
  const directReserveToStruct = Math.min(burnReserveMassQ, structGainMassQ);
  if (directReserveToStruct > 0) {
    tx.postMass(
      PostingReason.GROWTH,
      AccountKind.ORGANISM_RESERVE,
      organismSlot,
      AccountKind.ORGANISM_STRUCT,
      organismSlot,
      directReserveToStruct
    );
  }
  if (abioticInMassQ > 0) {
    tx.postMass(
      PostingReason.GROWTH,
      AccountKind.ABIOTIC,
      0,
      AccountKind.ORGANISM_STRUCT,
      organismSlot,
      abioticInMassQ
    );
  }
  if (abioticOutMassQ > 0) {
    tx.postMass(
      PostingReason.GROWTH,
      AccountKind.ORGANISM_RESERVE,
      organismSlot,
      AccountKind.ABIOTIC,
      0,
      abioticOutMassQ
    );
  }

  return Object.freeze({
    targetStructMassQ,
    structGainMassQ,
    structGainEnergyQ,
    burnReserveMassQ,
    burnReserveEnergyQ,
    abioticInMassQ,
    abioticOutMassQ,
    heatQ,
  });
}

/**
 * Provisions an offspring/egg at `childSlot` from maternal `ORGANISM_RESERVE[motherSlot]`,
 * governed by `profile.reproductiveEfficiency`. Rejects cleanly (`provisioned: false`, 0 postings)
 * when maternal reserve or abiotic matter cannot cover the exact requirement.
 */
export function stageReproductionProvisioning(
  tx: EnergyTransaction,
  motherSlot: number,
  childSlot: number,
  motherReserveMassQ: MassQ,
  availableAbioticMassQ: MassQ,
  desiredOffspringStructMassQ: MassQ,
  desiredOffspringReserveMassQ: MassQ,
  profile: TrophicProfile
): ReproductionProvisioningResult {
  assertQuanta(motherReserveMassQ, 'motherReserveMassQ');
  assertQuanta(availableAbioticMassQ, 'availableAbioticMassQ');
  assertQuanta(desiredOffspringStructMassQ, 'desiredOffspringStructMassQ');
  assertQuanta(desiredOffspringReserveMassQ, 'desiredOffspringReserveMassQ');

  if (desiredOffspringStructMassQ === 0 && desiredOffspringReserveMassQ === 0) {
    return Object.freeze({
      provisioned: false,
      reason: 'zero-request',
      childStructMassQ: 0,
      childStructEnergyQ: 0,
      childReserveMassQ: 0,
      childReserveEnergyQ: 0,
      burnReserveMassQ: 0,
      burnReserveEnergyQ: 0,
      abioticInMassQ: 0,
      abioticOutMassQ: 0,
      heatQ: 0,
    });
  }

  const cached = getOrCacheProfileQuanta(profile, false);
  const reproEffPpm = cached ? cached.reproEffPpm : fractionToPpm(profile.reproductiveEfficiency, 'half-even');
  const childStructEnergyQ = energyOfMass(desiredOffspringStructMassQ, RHO_STRUCT);
  const childReserveEnergyQ = energyOfMass(desiredOffspringReserveMassQ, RHO_RESERVE);

  const structReserveCostEnergyQ =
    childStructEnergyQ > 0
      ? divCeilBig(BigInt(childStructEnergyQ) * BigInt(PPM), BigInt(reproEffPpm))
      : 0n;
  const totalReserveEnergyNeededQ = structReserveCostEnergyQ + BigInt(childReserveEnergyQ);
  const burnReserveMassQ = Number(divCeilBig(totalReserveEnergyNeededQ, 30n));

  if (burnReserveMassQ > motherReserveMassQ) {
    return Object.freeze({
      provisioned: false,
      reason: 'insufficient-reserve',
      childStructMassQ: 0,
      childStructEnergyQ: 0,
      childReserveMassQ: 0,
      childReserveEnergyQ: 0,
      burnReserveMassQ: 0,
      burnReserveEnergyQ: 0,
      abioticInMassQ: 0,
      abioticOutMassQ: 0,
      heatQ: 0,
    });
  }

  const remainingBurnAfterYolk = burnReserveMassQ - desiredOffspringReserveMassQ;
  const abioticInMassQ =
    desiredOffspringStructMassQ > remainingBurnAfterYolk
      ? desiredOffspringStructMassQ - remainingBurnAfterYolk
      : 0;
  const abioticOutMassQ =
    remainingBurnAfterYolk > desiredOffspringStructMassQ
      ? remainingBurnAfterYolk - desiredOffspringStructMassQ
      : 0;

  if (abioticInMassQ > availableAbioticMassQ) {
    return Object.freeze({
      provisioned: false,
      reason: 'insufficient-abiotic',
      childStructMassQ: 0,
      childStructEnergyQ: 0,
      childReserveMassQ: 0,
      childReserveEnergyQ: 0,
      burnReserveMassQ: 0,
      burnReserveEnergyQ: 0,
      abioticInMassQ: 0,
      abioticOutMassQ: 0,
      heatQ: 0,
    });
  }

  const burnReserveEnergyQ = energyOfMass(burnReserveMassQ, RHO_RESERVE);
  const heatQ = burnReserveEnergyQ - childStructEnergyQ - childReserveEnergyQ;

  // Post energy
  if (childStructEnergyQ > 0) {
    tx.postEnergy(
      PostingReason.REPRODUCTION,
      AccountKind.ORGANISM_RESERVE,
      motherSlot,
      AccountKind.ORGANISM_STRUCT,
      childSlot,
      childStructEnergyQ
    );
  }
  if (childReserveEnergyQ > 0) {
    tx.postEnergy(
      PostingReason.REPRODUCTION,
      AccountKind.ORGANISM_RESERVE,
      motherSlot,
      AccountKind.ORGANISM_RESERVE,
      childSlot,
      childReserveEnergyQ
    );
  }
  if (heatQ > 0) {
    tx.postEnergy(
      PostingReason.REPRODUCTION,
      AccountKind.ORGANISM_RESERVE,
      motherSlot,
      AccountKind.HEAT,
      0,
      heatQ
    );
  }

  // Post mass
  if (desiredOffspringReserveMassQ > 0) {
    tx.postMass(
      PostingReason.REPRODUCTION,
      AccountKind.ORGANISM_RESERVE,
      motherSlot,
      AccountKind.ORGANISM_RESERVE,
      childSlot,
      desiredOffspringReserveMassQ
    );
  }
  const directReserveToStruct = Math.min(remainingBurnAfterYolk, desiredOffspringStructMassQ);
  if (directReserveToStruct > 0) {
    tx.postMass(
      PostingReason.REPRODUCTION,
      AccountKind.ORGANISM_RESERVE,
      motherSlot,
      AccountKind.ORGANISM_STRUCT,
      childSlot,
      directReserveToStruct
    );
  }
  if (abioticInMassQ > 0) {
    tx.postMass(
      PostingReason.REPRODUCTION,
      AccountKind.ABIOTIC,
      0,
      AccountKind.ORGANISM_STRUCT,
      childSlot,
      abioticInMassQ
    );
  }
  if (abioticOutMassQ > 0) {
    tx.postMass(
      PostingReason.REPRODUCTION,
      AccountKind.ORGANISM_RESERVE,
      motherSlot,
      AccountKind.ABIOTIC,
      0,
      abioticOutMassQ
    );
  }

  return Object.freeze({
    provisioned: true,
    reason: 'ok',
    childStructMassQ: desiredOffspringStructMassQ,
    childStructEnergyQ,
    childReserveMassQ: desiredOffspringReserveMassQ,
    childReserveEnergyQ,
    burnReserveMassQ,
    burnReserveEnergyQ,
    abioticInMassQ,
    abioticOutMassQ,
    heatQ,
  });
}

/** Stages full death biomass transfer (`ORGANISM_STRUCT` + `ORGANISM_RESERVE` -> `CELL_CARRION[cellIndex]`). */
export function stageDeathToCarrion(
  tx: EnergyTransaction,
  organismSlot: number,
  cellIndex: number,
  structMassQ: MassQ,
  reserveMassQ: MassQ
): void {
  assertQuanta(structMassQ, 'structMassQ');
  assertQuanta(reserveMassQ, 'reserveMassQ');

  if (structMassQ > 0) {
    tx.transferBiomass(
      PostingReason.DEATH,
      AccountKind.ORGANISM_STRUCT,
      organismSlot,
      AccountKind.CELL_CARRION,
      cellIndex,
      structMassQ,
      energyOfMass(structMassQ, RHO_STRUCT)
    );
  }
  if (reserveMassQ > 0) {
    tx.transferBiomass(
      PostingReason.DEATH,
      AccountKind.ORGANISM_RESERVE,
      organismSlot,
      AccountKind.CELL_CARRION,
      cellIndex,
      reserveMassQ,
      energyOfMass(reserveMassQ, RHO_RESERVE)
    );
  }
}

/** Stages exact `(5, 30)` fraction decomposition of `CELL_CARRION[cellIndex]` -> `ABIOTIC` + `HEAT`. */
export function stageCarrionDecomposition(
  tx: EnergyTransaction,
  cellIndex: number,
  ratePpm: number
): DecompositionPlan {
  assertPpm(ratePpm, 'ratePpm');
  const massQ = Number(tx.stagedMassQ(AccountKind.CELL_CARRION, cellIndex));
  const energyQ = Number(tx.stagedEnergyQ(AccountKind.CELL_CARRION, cellIndex));
  const plan = planCarrionDecomposition(massQ, energyQ, ratePpm, 'floor');
  if (plan.totalMassQ > 0) {
    tx.postMass(PostingReason.DECOMPOSITION, AccountKind.CELL_CARRION, cellIndex, AccountKind.ABIOTIC, 0, plan.totalMassQ);
  }
  if (plan.totalEnergyQ > 0) {
    tx.postEnergy(PostingReason.DECOMPOSITION, AccountKind.CELL_CARRION, cellIndex, AccountKind.HEAT, 0, plan.totalEnergyQ);
  }
  return Object.freeze({
    decomposedMassQ: plan.totalMassQ,
    decomposedEnergyQ: plan.totalEnergyQ,
    structMassQ: plan.structMassQ,
    reserveMassQ: plan.reserveMassQ,
  });
}

/** Stages exact `3 EU/MU` decomposition of `CELL_DETRITUS[cellIndex]` -> `ABIOTIC` + `HEAT`. */
export function stageDetritusDecomposition(
  tx: EnergyTransaction,
  cellIndex: number,
  ratePpm: number
): DecompositionPlan {
  assertPpm(ratePpm, 'ratePpm');
  const massQ = Number(tx.stagedMassQ(AccountKind.CELL_DETRITUS, cellIndex));
  const decomposedMassQ = applyPpm(massQ, ratePpm, 'floor');
  const decomposedEnergyQ = energyOfMass(decomposedMassQ, RHO_DETRITUS);
  if (decomposedMassQ > 0) {
    tx.postMass(PostingReason.DECOMPOSITION, AccountKind.CELL_DETRITUS, cellIndex, AccountKind.ABIOTIC, 0, decomposedMassQ);
  }
  if (decomposedEnergyQ > 0) {
    tx.postEnergy(PostingReason.DECOMPOSITION, AccountKind.CELL_DETRITUS, cellIndex, AccountKind.HEAT, 0, decomposedEnergyQ);
  }
  return Object.freeze({
    decomposedMassQ,
    decomposedEnergyQ,
    structMassQ: 0,
    reserveMassQ: 0,
  });
}

// ===========================================================================
// Allocation-free fast paths for BiologySimulation and DeterministicPreyFoodProvider
// ===========================================================================

export interface MutableFeedingPlanOut {
  depositMassQ: MassQ;
  depositEnergyQ: EnergyQ;
  egestaMassQ: MassQ;
  egestaEnergyQ: EnergyQ;
  abioticMassQ: MassQ;
  heatQ: EnergyQ;
}

export interface MutableReserveMetabolismOut {
  burnMassQ: MassQ;
  burnEnergyQ: EnergyQ;
  nextCarryCreditQ: EnergyQ;
  deficitQ: EnergyQ;
}

export interface MutableCarrionBiteOut {
  structMassQ: MassQ;
  structEnergyQ: EnergyQ;
  reserveMassQ: MassQ;
  reserveEnergyQ: EnergyQ;
  totalMassQ: MassQ;
  totalEnergyQ: EnergyQ;
}

export interface MutableReproductionProvisioningOut {
  provisioned: boolean;
  childStructMassQ: MassQ;
  childStructEnergyQ: EnergyQ;
  childReserveMassQ: MassQ;
  childReserveEnergyQ: EnergyQ;
  burnReserveMassQ: MassQ;
  burnReserveEnergyQ: EnergyQ;
  abioticInMassQ: MassQ;
  abioticOutMassQ: MassQ;
  heatQ: EnergyQ;
}

const _biteScratch: MutableCarrionBiteOut = {
  structMassQ: 0,
  structEnergyQ: 0,
  reserveMassQ: 0,
  reserveEnergyQ: 0,
  totalMassQ: 0,
  totalEnergyQ: 0,
};

const _feedScratch: MutableFeedingPlanOut = {
  depositMassQ: 0,
  depositEnergyQ: 0,
  egestaMassQ: 0,
  egestaEnergyQ: 0,
  abioticMassQ: 0,
  heatQ: 0,
};

function applyPpmFloorFast(q: number, ppm: number): number {
  const p = q * ppm;
  if (p <= LOCAL_MAX_SAFE_INT) {
    return (p - (p % LOCAL_PPM)) / LOCAL_PPM;
  }
  return applyPpm(q, ppm, 'floor');
}

function energyOfStructFast(m: number): number {
  return m <= STRUCT_SAFE_MASS_LIMIT ? m * 5 : energyOfMass(m, RHO_STRUCT);
}

function energyOfReserveFast(m: number): number {
  return m <= RESERVE_SAFE_MASS_LIMIT ? m * 30 : energyOfMass(m, RHO_RESERVE);
}

function energyOfDetritusFast(m: number): number {
  return m <= PLANT_SAFE_MASS_LIMIT ? m * 3 : energyOfMass(m, RHO_DETRITUS);
}

function neededReserveForStructGainFast(structGainMassQ: number, growthEffPpm: number): number {
  if (structGainMassQ === 0) return 0;
  const structEnergyQ = energyOfStructFast(structGainMassQ);
  const p = structEnergyQ * LOCAL_PPM;
  if (p <= LOCAL_MAX_SAFE_INT) {
    const r = p % growthEffPpm;
    const base = (p - r) / growthEffPpm;
    const neededReserveEnergyQ = r === 0 ? base : base + 1;
    const r30 = neededReserveEnergyQ % 30;
    const base30 = (neededReserveEnergyQ - r30) / 30;
    return r30 === 0 ? base30 : base30 + 1;
  }
  const neededReserveEnergyQ = divCeilBig(BigInt(structEnergyQ) * BigInt(LOCAL_PPM), BigInt(growthEffPpm));
  return Number(divCeilBig(neededReserveEnergyQ, 30n));
}

export function computeTotalMetabolicDemandFast(
  basalFactor: number,
  thermoFactor: number,
  activityFactor: number,
  structMassQ: number,
  reserveMassQ: number,
  thermalStress: number,
  activityLevel: number
): EnergyQ {
  const totalMassQ = structMassQ + reserveMassQ;
  const totalMassMU = totalMassQ / 1_000_000;
  const kleiberScale = totalMassMU > 0 ? detPow075(totalMassMU) : 0;

  const basalDemandQ = euToQ(basalFactor * kleiberScale, 'half-even');
  const thermoDemandQ =
    thermalStress > 0 ? euToQ(thermoFactor * thermalStress * kleiberScale, 'half-even') : 0;
  const actDemandQ =
    activityLevel > 0 ? euToQ(activityFactor * activityLevel * totalMassMU, 'half-even') : 0;

  return basalDemandQ + thermoDemandQ + actDemandQ;
}

export function stageMetabolismFast(
  tx: EnergyTransaction,
  organismSlot: number,
  reserveMassQ: number,
  demandQ: number,
  carryCreditQ: number,
  out: MutableReserveMetabolismOut
): void {
  if (demandQ <= carryCreditQ) {
    out.burnMassQ = 0;
    out.burnEnergyQ = 0;
    out.nextCarryCreditQ = carryCreditQ - demandQ;
    out.deficitQ = 0;
    return;
  }
  const netDemandQ = demandQ - carryCreditQ;
  const rem30 = netDemandQ % 30;
  const neededMassQ = rem30 === 0 ? netDemandQ / 30 : (netDemandQ - rem30) / 30 + 1;
  const burnMassQ = reserveMassQ < neededMassQ ? reserveMassQ : neededMassQ;
  const burnEnergyQ = energyOfReserveFast(burnMassQ);

  out.burnMassQ = burnMassQ;
  out.burnEnergyQ = burnEnergyQ;
  if (burnEnergyQ >= netDemandQ) {
    out.nextCarryCreditQ = burnEnergyQ - netDemandQ;
    out.deficitQ = 0;
  } else {
    out.nextCarryCreditQ = 0;
    out.deficitQ = netDemandQ - burnEnergyQ;
  }

  if (burnMassQ > 0) {
    tx.postMass(PR_METABOLISM, AK_ORGANISM_RESERVE, organismSlot, AK_ABIOTIC, 0, burnMassQ);
  }
  if (burnEnergyQ > 0) {
    tx.postEnergy(PR_METABOLISM, AK_ORGANISM_RESERVE, organismSlot, AK_HEAT, 0, burnEnergyQ);
  }
}

export function computeFeedingPlanFast(
  foodMassQ: number,
  foodEnergyQ: number,
  absorptionPpm: number,
  assimilationPpm: number,
  sdaPpm: number,
  reserveHeadroomMassQ: number,
  out: MutableFeedingPlanOut
): void {
  const assimilated = applyPpmFloorFast(foodEnergyQ, absorptionPpm);
  const unassimilatedEnergy = foodEnergyQ - assimilated;
  const sda = applyPpmFloorFast(assimilated, sdaPpm);
  const depositable = assimilated - sda;

  const rawDepCap = (depositable - (depositable % 30)) / 30;
  const rawDepositMassQ = foodMassQ < rawDepCap ? foodMassQ : rawDepCap;
  const rawDepositEnergyQ = energyOfReserveFast(rawDepositMassQ);

  const remainingMassQ = foodMassQ - rawDepositMassQ;
  const rawEgestaCap = (unassimilatedEnergy - (unassimilatedEnergy % 3)) / 3;
  const egestaMassQ = remainingMassQ < rawEgestaCap ? remainingMassQ : rawEgestaCap;
  const egestaEnergyQ = energyOfDetritusFast(egestaMassQ);

  const rawAbioticMassQ = foodMassQ - rawDepositMassQ - egestaMassQ;
  const rawHeatQ = foodEnergyQ - rawDepositEnergyQ - egestaEnergyQ;

  if (reserveHeadroomMassQ >= 0 && rawDepositMassQ > reserveHeadroomMassQ) {
    const depositMassQ = reserveHeadroomMassQ;
    const depositEnergyQ = energyOfReserveFast(depositMassQ);
    out.depositMassQ = depositMassQ;
    out.depositEnergyQ = depositEnergyQ;
    out.egestaMassQ = egestaMassQ;
    out.egestaEnergyQ = egestaEnergyQ;
    out.abioticMassQ = rawAbioticMassQ + (rawDepositMassQ - depositMassQ);
    out.heatQ = rawHeatQ + (rawDepositEnergyQ - depositEnergyQ);
    return;
  }

  out.depositMassQ = rawDepositMassQ;
  out.depositEnergyQ = rawDepositEnergyQ;
  out.egestaMassQ = egestaMassQ;
  out.egestaEnergyQ = egestaEnergyQ;
  out.abioticMassQ = rawAbioticMassQ;
  out.heatQ = rawHeatQ;
}

export function stageFeedingFast(
  tx: EnergyTransaction,
  srcKind: AccountKindId,
  srcId: number,
  eaterSlot: number,
  detritusCellIndex: number,
  foodMassQ: number,
  foodEnergyQ: number,
  absorptionPpm: number,
  assimilationPpm: number,
  sdaPpm: number,
  reserveHeadroomMassQ: number,
  out: MutableFeedingPlanOut
): void {
  computeFeedingPlanFast(
    foodMassQ,
    foodEnergyQ,
    absorptionPpm,
    assimilationPpm,
    sdaPpm,
    reserveHeadroomMassQ,
    out
  );
  if (foodMassQ === 0 && foodEnergyQ === 0) return;

  if (out.depositMassQ > 0 || out.depositEnergyQ > 0) {
    tx.transferBiomass(
      PR_INGESTION,
      srcKind,
      srcId,
      AK_ORGANISM_RESERVE,
      eaterSlot,
      out.depositMassQ,
      out.depositEnergyQ
    );
  }
  if ((out.egestaMassQ > 0 || out.egestaEnergyQ > 0) && !(srcKind === AK_CELL_DETRITUS && srcId === detritusCellIndex)) {
    tx.transferBiomass(
      PR_EGESTION,
      srcKind,
      srcId,
      AK_CELL_DETRITUS,
      detritusCellIndex,
      out.egestaMassQ,
      out.egestaEnergyQ
    );
  }
  if (out.abioticMassQ > 0) {
    tx.postMass(PR_SDA, srcKind, srcId, AK_ABIOTIC, 0, out.abioticMassQ);
  }
  if (out.heatQ > 0) {
    tx.postEnergy(PR_SDA, srcKind, srcId, AK_HEAT, 0, out.heatQ);
  }
}

export function planCarrionConsumptionFast(
  carrionMassQ: number,
  carrionEnergyQ: number,
  biteMassQ: number,
  out: MutableCarrionBiteOut
): void {
  splitCarrionMassInto(carrionMassQ, carrionEnergyQ, _carrionScratch);
  if (biteMassQ > carrionMassQ) {
    throw new Error(`Cannot consume ${biteMassQ} qMU from carrion holding ${carrionMassQ} qMU`);
  }
  if (biteMassQ === 0) {
    out.structMassQ = 0;
    out.structEnergyQ = 0;
    out.reserveMassQ = 0;
    out.reserveEnergyQ = 0;
    out.totalMassQ = 0;
    out.totalEnergyQ = 0;
    return;
  }
  let takeReserve = scaleByRatio(_carrionScratch.reserveMassQ, biteMassQ, carrionMassQ, 'half-even');
  const minReserve = biteMassQ > _carrionScratch.structMassQ ? biteMassQ - _carrionScratch.structMassQ : 0;
  const maxReserve = biteMassQ < _carrionScratch.reserveMassQ ? biteMassQ : _carrionScratch.reserveMassQ;
  if (takeReserve < minReserve) takeReserve = minReserve;
  if (takeReserve > maxReserve) takeReserve = maxReserve;
  const takeStruct = biteMassQ - takeReserve;
  const structEnergyQ = energyOfStructFast(takeStruct);
  const reserveEnergyQ = energyOfReserveFast(takeReserve);
  out.structMassQ = takeStruct;
  out.structEnergyQ = structEnergyQ;
  out.reserveMassQ = takeReserve;
  out.reserveEnergyQ = reserveEnergyQ;
  out.totalMassQ = takeStruct + takeReserve;
  out.totalEnergyQ = structEnergyQ + reserveEnergyQ;
}

export function stageCarrionScavengeFast(
  tx: EnergyTransaction,
  cellIndex: number,
  carrionMassQ: number,
  carrionEnergyQ: number,
  eaterSlot: number,
  detritusCellIndex: number,
  requestedMassQ: number,
  absorptionPpm: number,
  assimilationPpm: number,
  sdaPpm: number,
  reserveHeadroomMassQ: number,
  outFeed: MutableFeedingPlanOut
): number {
  const biteMassQ = requestedMassQ < carrionMassQ ? requestedMassQ : carrionMassQ;
  planCarrionConsumptionFast(carrionMassQ, carrionEnergyQ, biteMassQ, _biteScratch);
  stageFeedingFast(
    tx,
    AK_CELL_CARRION,
    cellIndex,
    eaterSlot,
    detritusCellIndex,
    _biteScratch.totalMassQ,
    _biteScratch.totalEnergyQ,
    absorptionPpm,
    assimilationPpm,
    sdaPpm,
    reserveHeadroomMassQ,
    outFeed
  );
  return biteMassQ;
}

export function stagePreyPredationFast(
  tx: EnergyTransaction,
  preySlot: number,
  preyStructMassQ: number,
  preyReserveMassQ: number,
  eaterSlot: number,
  detritusCellIndex: number,
  requestedMassQ: number,
  absorptionPpm: number,
  assimilationPpm: number,
  sdaPpm: number,
  reserveHeadroomMassQ: number,
  outFeed: MutableFeedingPlanOut
): number {
  const totalPreyMassQ = preyStructMassQ + preyReserveMassQ;
  const biteMassQ = requestedMassQ < totalPreyMassQ ? requestedMassQ : totalPreyMassQ;
  const totalPreyEnergyQ = energyOfStructFast(preyStructMassQ) + energyOfReserveFast(preyReserveMassQ);
  planCarrionConsumptionFast(totalPreyMassQ, totalPreyEnergyQ, biteMassQ, _biteScratch);

  computeFeedingPlanFast(
    _biteScratch.totalMassQ,
    _biteScratch.totalEnergyQ,
    absorptionPpm,
    assimilationPpm,
    sdaPpm,
    reserveHeadroomMassQ,
    outFeed
  );
  if (_biteScratch.totalMassQ === 0 && _biteScratch.totalEnergyQ === 0) {
    return biteMassQ;
  }

  let remReserveMass = _biteScratch.reserveMassQ;
  let remStructMass = _biteScratch.structMassQ;

  // INGESTION mass
  let left = outFeed.depositMassQ;
  if (left > 0 && remReserveMass > 0) {
    const take = left < remReserveMass ? left : remReserveMass;
    tx.postMass(PR_INGESTION, AK_ORGANISM_RESERVE, preySlot, AK_ORGANISM_RESERVE, eaterSlot, take);
    remReserveMass -= take;
    left -= take;
  }
  if (left > 0 && remStructMass > 0) {
    const take = left < remStructMass ? left : remStructMass;
    tx.postMass(PR_INGESTION, AK_ORGANISM_STRUCT, preySlot, AK_ORGANISM_RESERVE, eaterSlot, take);
    remStructMass -= take;
  }

  // EGESTION mass
  left = outFeed.egestaMassQ;
  if (left > 0 && remReserveMass > 0) {
    const take = left < remReserveMass ? left : remReserveMass;
    tx.postMass(PR_EGESTION, AK_ORGANISM_RESERVE, preySlot, AK_CELL_DETRITUS, detritusCellIndex, take);
    remReserveMass -= take;
    left -= take;
  }
  if (left > 0 && remStructMass > 0) {
    const take = left < remStructMass ? left : remStructMass;
    tx.postMass(PR_EGESTION, AK_ORGANISM_STRUCT, preySlot, AK_CELL_DETRITUS, detritusCellIndex, take);
    remStructMass -= take;
  }

  // SDA abiotic mass
  left = outFeed.abioticMassQ;
  if (left > 0 && remReserveMass > 0) {
    const take = left < remReserveMass ? left : remReserveMass;
    tx.postMass(PR_SDA, AK_ORGANISM_RESERVE, preySlot, AK_ABIOTIC, 0, take);
    remReserveMass -= take;
    left -= take;
  }
  if (left > 0 && remStructMass > 0) {
    const take = left < remStructMass ? left : remStructMass;
    tx.postMass(PR_SDA, AK_ORGANISM_STRUCT, preySlot, AK_ABIOTIC, 0, take);
    remStructMass -= take;
  }

  let remReserveEnergy = _biteScratch.reserveEnergyQ;
  let remStructEnergy = _biteScratch.structEnergyQ;

  // INGESTION energy
  left = outFeed.depositEnergyQ;
  if (left > 0 && remReserveEnergy > 0) {
    const take = left < remReserveEnergy ? left : remReserveEnergy;
    tx.postEnergy(PR_INGESTION, AK_ORGANISM_RESERVE, preySlot, AK_ORGANISM_RESERVE, eaterSlot, take);
    remReserveEnergy -= take;
    left -= take;
  }
  if (left > 0 && remStructEnergy > 0) {
    const take = left < remStructEnergy ? left : remStructEnergy;
    tx.postEnergy(PR_INGESTION, AK_ORGANISM_STRUCT, preySlot, AK_ORGANISM_RESERVE, eaterSlot, take);
    remStructEnergy -= take;
  }

  // EGESTION energy
  left = outFeed.egestaEnergyQ;
  if (left > 0 && remReserveEnergy > 0) {
    const take = left < remReserveEnergy ? left : remReserveEnergy;
    tx.postEnergy(PR_EGESTION, AK_ORGANISM_RESERVE, preySlot, AK_CELL_DETRITUS, detritusCellIndex, take);
    remReserveEnergy -= take;
    left -= take;
  }
  if (left > 0 && remStructEnergy > 0) {
    const take = left < remStructEnergy ? left : remStructEnergy;
    tx.postEnergy(PR_EGESTION, AK_ORGANISM_STRUCT, preySlot, AK_CELL_DETRITUS, detritusCellIndex, take);
    remStructEnergy -= take;
  }

  // SDA heat
  left = outFeed.heatQ;
  if (left > 0 && remReserveEnergy > 0) {
    const take = left < remReserveEnergy ? left : remReserveEnergy;
    tx.postEnergy(PR_SDA, AK_ORGANISM_RESERVE, preySlot, AK_HEAT, 0, take);
    remReserveEnergy -= take;
    left -= take;
  }
  if (left > 0 && remStructEnergy > 0) {
    const take = left < remStructEnergy ? left : remStructEnergy;
    tx.postEnergy(PR_SDA, AK_ORGANISM_STRUCT, preySlot, AK_HEAT, 0, take);
    remStructEnergy -= take;
  }

  return biteMassQ;
}

export function stageSomaticGrowthFast(
  tx: EnergyTransaction,
  organismSlot: number,
  structMassQ: number,
  reserveMassQ: number,
  availableAbioticMassQ: number,
  targetStructMassQ: number,
  allocPpm: number,
  growthEffPpm: number
): number {
  if (structMassQ >= targetStructMassQ || reserveMassQ === 0) return 0;

  const allocatedReserveMassQ = applyPpmFloorFast(reserveMassQ, allocPpm);
  if (allocatedReserveMassQ === 0) return 0;

  const budgetReserveEnergyQ = energyOfReserveFast(allocatedReserveMassQ);
  const rawUsefulEnergyQ = applyPpmFloorFast(budgetReserveEnergyQ, growthEffPpm);
  const maxStructFromBudget = (rawUsefulEnergyQ - (rawUsefulEnergyQ % 5)) / 5;
  const deficitStructMassQ = targetStructMassQ - structMassQ;
  let structGainMassQ = deficitStructMassQ < maxStructFromBudget ? deficitStructMassQ : maxStructFromBudget;

  if (structGainMassQ > 0) {
    const burnCheck = neededReserveForStructGainFast(structGainMassQ, growthEffPpm);
    const abioticNeed = structGainMassQ > burnCheck ? structGainMassQ - burnCheck : 0;
    if (abioticNeed > availableAbioticMassQ) {
      let lo = 0;
      let hi = structGainMassQ;
      while (lo < hi) {
        const mid = lo + Math.ceil((hi - lo) / 2);
        const midBurn = neededReserveForStructGainFast(mid, growthEffPpm);
        const midNeed = mid > midBurn ? mid - midBurn : 0;
        if (midNeed <= availableAbioticMassQ) lo = mid;
        else hi = mid - 1;
      }
      structGainMassQ = lo;
    }
  }

  if (structGainMassQ === 0) return 0;

  const structGainEnergyQ = energyOfStructFast(structGainMassQ);
  const burnReserveMassQ = neededReserveForStructGainFast(structGainMassQ, growthEffPpm);
  const burnReserveEnergyQ = energyOfReserveFast(burnReserveMassQ);
  const heatQ = burnReserveEnergyQ - structGainEnergyQ;
  const abioticInMassQ = structGainMassQ > burnReserveMassQ ? structGainMassQ - burnReserveMassQ : 0;
  const abioticOutMassQ = burnReserveMassQ > structGainMassQ ? burnReserveMassQ - structGainMassQ : 0;

  tx.postEnergy(PR_GROWTH, AK_ORGANISM_RESERVE, organismSlot, AK_ORGANISM_STRUCT, organismSlot, structGainEnergyQ);
  if (heatQ > 0) {
    tx.postEnergy(PR_GROWTH, AK_ORGANISM_RESERVE, organismSlot, AK_HEAT, 0, heatQ);
  }

  const directReserveToStruct = burnReserveMassQ < structGainMassQ ? burnReserveMassQ : structGainMassQ;
  if (directReserveToStruct > 0) {
    tx.postMass(PR_GROWTH, AK_ORGANISM_RESERVE, organismSlot, AK_ORGANISM_STRUCT, organismSlot, directReserveToStruct);
  }
  if (abioticInMassQ > 0) {
    tx.postMass(PR_GROWTH, AK_ABIOTIC, 0, AK_ORGANISM_STRUCT, organismSlot, abioticInMassQ);
  }
  if (abioticOutMassQ > 0) {
    tx.postMass(PR_GROWTH, AK_ORGANISM_RESERVE, organismSlot, AK_ABIOTIC, 0, abioticOutMassQ);
  }

  return structGainMassQ;
}

export function stageReproductionProvisioningFast(
  tx: EnergyTransaction,
  motherSlot: number,
  childSlot: number,
  motherReserveMassQ: number,
  availableAbioticMassQ: number,
  desiredOffspringStructMassQ: number,
  desiredOffspringReserveMassQ: number,
  reproEffPpm: number,
  out: MutableReproductionProvisioningOut
): boolean {
  if (desiredOffspringStructMassQ === 0 && desiredOffspringReserveMassQ === 0) {
    out.provisioned = false;
    return false;
  }

  const childStructEnergyQ = energyOfStructFast(desiredOffspringStructMassQ);
  const childReserveEnergyQ = energyOfReserveFast(desiredOffspringReserveMassQ);

  let burnReserveMassQ: number;
  const p = childStructEnergyQ * LOCAL_PPM;
  if (p <= LOCAL_MAX_SAFE_INT) {
    let structReserveCostEnergyQ = 0;
    if (childStructEnergyQ > 0) {
      const r = p % reproEffPpm;
      const base = (p - r) / reproEffPpm;
      structReserveCostEnergyQ = r === 0 ? base : base + 1;
    }
    const totalReserveEnergyNeededQ = structReserveCostEnergyQ + childReserveEnergyQ;
    const r30 = totalReserveEnergyNeededQ % 30;
    const base30 = (totalReserveEnergyNeededQ - r30) / 30;
    burnReserveMassQ = r30 === 0 ? base30 : base30 + 1;
  } else {
    const structReserveCostEnergyQ =
      childStructEnergyQ > 0
        ? divCeilBig(BigInt(childStructEnergyQ) * BigInt(LOCAL_PPM), BigInt(reproEffPpm))
        : 0n;
    const totalReserveEnergyNeededQ = structReserveCostEnergyQ + BigInt(childReserveEnergyQ);
    burnReserveMassQ = Number(divCeilBig(totalReserveEnergyNeededQ, 30n));
  }

  if (burnReserveMassQ > motherReserveMassQ) {
    out.provisioned = false;
    return false;
  }

  const remainingBurnAfterYolk = burnReserveMassQ - desiredOffspringReserveMassQ;
  const abioticInMassQ =
    desiredOffspringStructMassQ > remainingBurnAfterYolk
      ? desiredOffspringStructMassQ - remainingBurnAfterYolk
      : 0;
  const abioticOutMassQ =
    remainingBurnAfterYolk > desiredOffspringStructMassQ
      ? remainingBurnAfterYolk - desiredOffspringStructMassQ
      : 0;

  if (abioticInMassQ > availableAbioticMassQ) {
    out.provisioned = false;
    return false;
  }

  const burnReserveEnergyQ = energyOfReserveFast(burnReserveMassQ);
  const heatQ = burnReserveEnergyQ - childStructEnergyQ - childReserveEnergyQ;

  if (childStructEnergyQ > 0) {
    tx.postEnergy(PR_REPRODUCTION, AK_ORGANISM_RESERVE, motherSlot, AK_ORGANISM_STRUCT, childSlot, childStructEnergyQ);
  }
  if (childReserveEnergyQ > 0) {
    tx.postEnergy(PR_REPRODUCTION, AK_ORGANISM_RESERVE, motherSlot, AK_ORGANISM_RESERVE, childSlot, childReserveEnergyQ);
  }
  if (heatQ > 0) {
    tx.postEnergy(PR_REPRODUCTION, AK_ORGANISM_RESERVE, motherSlot, AK_HEAT, 0, heatQ);
  }

  if (desiredOffspringReserveMassQ > 0) {
    tx.postMass(PR_REPRODUCTION, AK_ORGANISM_RESERVE, motherSlot, AK_ORGANISM_RESERVE, childSlot, desiredOffspringReserveMassQ);
  }
  const directReserveToStruct =
    remainingBurnAfterYolk < desiredOffspringStructMassQ ? remainingBurnAfterYolk : desiredOffspringStructMassQ;
  if (directReserveToStruct > 0) {
    tx.postMass(PR_REPRODUCTION, AK_ORGANISM_RESERVE, motherSlot, AK_ORGANISM_STRUCT, childSlot, directReserveToStruct);
  }
  if (abioticInMassQ > 0) {
    tx.postMass(PR_REPRODUCTION, AK_ABIOTIC, 0, AK_ORGANISM_STRUCT, childSlot, abioticInMassQ);
  }
  if (abioticOutMassQ > 0) {
    tx.postMass(PR_REPRODUCTION, AK_ORGANISM_RESERVE, motherSlot, AK_ABIOTIC, 0, abioticOutMassQ);
  }

  out.provisioned = true;
  out.childStructMassQ = desiredOffspringStructMassQ;
  out.childStructEnergyQ = childStructEnergyQ;
  out.childReserveMassQ = desiredOffspringReserveMassQ;
  out.childReserveEnergyQ = childReserveEnergyQ;
  out.burnReserveMassQ = burnReserveMassQ;
  out.burnReserveEnergyQ = burnReserveEnergyQ;
  out.abioticInMassQ = abioticInMassQ;
  out.abioticOutMassQ = abioticOutMassQ;
  out.heatQ = heatQ;
  return true;
}

export function stageDeathToCarrionFast(
  tx: EnergyTransaction,
  organismSlot: number,
  cellIndex: number,
  structMassQ: MassQ,
  reserveMassQ: MassQ
): void {
  if (structMassQ > 0) {
    tx.transferBiomass(
      PR_DEATH,
      AK_ORGANISM_STRUCT,
      organismSlot,
      AK_CELL_CARRION,
      cellIndex,
      structMassQ,
      energyOfStructFast(structMassQ)
    );
  }
  if (reserveMassQ > 0) {
    tx.transferBiomass(
      PR_DEATH,
      AK_ORGANISM_RESERVE,
      organismSlot,
      AK_CELL_CARRION,
      cellIndex,
      reserveMassQ,
      energyOfReserveFast(reserveMassQ)
    );
  }
}

export function stageCarrionDecompositionFast(
  tx: EnergyTransaction,
  cellIndex: number,
  massQ: number,
  energyQ: number,
  ratePpm: number
): void {
  splitCarrionMassInto(massQ, energyQ, _carrionScratch);
  const structMassQ = applyPpmFloorFast(_carrionScratch.structMassQ, ratePpm);
  const reserveMassQ = applyPpmFloorFast(_carrionScratch.reserveMassQ, ratePpm);
  const totalMassQ = structMassQ + reserveMassQ;
  const totalEnergyQ = energyOfStructFast(structMassQ) + energyOfReserveFast(reserveMassQ);
  if (totalMassQ > 0) {
    tx.postMass(PR_DECOMPOSITION, AK_CELL_CARRION, cellIndex, AK_ABIOTIC, 0, totalMassQ);
  }
  if (totalEnergyQ > 0) {
    tx.postEnergy(PR_DECOMPOSITION, AK_CELL_CARRION, cellIndex, AK_HEAT, 0, totalEnergyQ);
  }
}

export function stageDetritusDecompositionFast(
  tx: EnergyTransaction,
  cellIndex: number,
  massQ: number,
  ratePpm: number
): void {
  const decomposedMassQ = applyPpmFloorFast(massQ, ratePpm);
  const decomposedEnergyQ = energyOfDetritusFast(decomposedMassQ);
  if (decomposedMassQ > 0) {
    tx.postMass(PR_DECOMPOSITION, AK_CELL_DETRITUS, cellIndex, AK_ABIOTIC, 0, decomposedMassQ);
  }
  if (decomposedEnergyQ > 0) {
    tx.postEnergy(PR_DECOMPOSITION, AK_CELL_DETRITUS, cellIndex, AK_HEAT, 0, decomposedEnergyQ);
  }
}
