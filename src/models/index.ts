import { applyBuildingState } from '../engine/buildingStates';
import { SHADOW_COLOR, buildMaskColorLookup } from '../engine/palette';
import {
  PixelBuffer,
  buildFrameCacheKey,
  globalFrameCache,
} from '../engine/pixelCanvas';
import { applyCreatureGenes, resolveCreatureGenes, serializeGenesKey } from '../engine/genes';
import { applySoftGroundShadow } from '../engine/softShadow';
import { ANIMATED_MODELS } from './animatedStructures';
import { AQUATIC_MODELS } from './aquaticCreatures';
import { BIOME_CREATURE_MODELS } from './biomeCreatures';
import { CREATURE_MODELS } from './creatures';
import { ERA_BRONZE_UNITS } from './eraBronzeUnits';
import { ERA_DINOSAUR_MODELS } from './eraDinosaurs';
import { ERA_MEDIEVAL_UNITS } from './eraMedievalUnits';
import { ERA_MEGAFAUNA_MODELS } from './eraMegafauna';
import { ERA_PRIMORDIAL_MODELS } from './eraPrimordial';
import { ERA_PROP_MODELS } from './eraProps';
import { ERA_STONE_AGE_MODELS } from './eraStoneAge';
import { ERA_STRUCTURE_MODELS } from './eraStructures';
import { EXPANDED_UNIT_MODELS } from './expandedUnits';
import { MODULAR_UNIT_MODELS } from './modularUnits';
import { NATURE_MODELS } from './natureModels';
import { STATIC_MODELS } from './staticStructures';
import { SUBSTANCE_MODELS } from './substanceStructures';
import { WILDLIFE_CREATURE_MODELS } from './wildlifeCreatures';
import {
  BuildingFunction,
  BuildingState,
  EntityType,
  EraId,
  ModelKind,
  ModelTier,
  PixelModelDef,
  RenderContextOptions,
} from './types';
import { WEATHER_MODELS } from './weatherEffects';

export const ALL_MODELS: PixelModelDef[] = [
  ...AQUATIC_MODELS,
  ...NATURE_MODELS,
  ...SUBSTANCE_MODELS,
  ...WEATHER_MODELS,
  ...ANIMATED_MODELS,
  ...STATIC_MODELS,
  ...ERA_PROP_MODELS,
  ...ERA_STRUCTURE_MODELS,
  ...MODULAR_UNIT_MODELS,
  ...EXPANDED_UNIT_MODELS,
  ...CREATURE_MODELS,
  ...BIOME_CREATURE_MODELS,
  ...ERA_PRIMORDIAL_MODELS,
  ...ERA_DINOSAUR_MODELS,
  ...ERA_MEGAFAUNA_MODELS,
  ...ERA_STONE_AGE_MODELS,
  ...ERA_BRONZE_UNITS,
  ...ERA_MEDIEVAL_UNITS,
  ...WILDLIFE_CREATURE_MODELS,
];

export type FilterTab = 'all' | ModelKind;
export type TierFilter = 'all' | ModelTier;
export type EraFilter = 'all' | EraId;
export type EntityTypeFilter = 'all' | EntityType;

export const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: 'Все модели' },
  { id: 'aquatic', label: 'Водные монстры' },
  { id: 'nature', label: 'Кусты и деревья' },
  { id: 'substance', label: 'Вещества и материалы' },
  { id: 'weather', label: 'Погода и эффекты' },
  { id: 'animated', label: 'Механизмы' },
  { id: 'static', label: 'Постройки' },
  { id: 'unit', label: 'Существа и юниты' },
];

export const ENTITY_TYPE_TABS: { id: EntityTypeFilter; label: string }[] = [
  { id: 'all', label: 'Все типы' },
  { id: 'creature', label: 'Существа' },
  { id: 'unit', label: 'Юниты' },
  { id: 'building', label: 'Постройки' },
  { id: 'nature', label: 'Природа и стихии' },
];

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  creature: 'Существо',
  unit: 'Юнит',
  building: 'Постройка',
  nature: 'Природа',
};

export const BUILDING_STATE_OPTIONS: { id: BuildingState; label: string }[] = [
  { id: 'constructing', label: 'Строится' },
  { id: 'ready', label: 'Готово' },
  { id: 'damaged', label: 'Повреждено' },
  { id: 'ruins', label: 'Руины' },
];

export const BUILDING_FUNCTION_LABELS: Record<BuildingFunction, string> = {
  housing: 'Жильё',
  food: 'Еда',
  defense: 'Оборона',
  religion: 'Религия',
  production: 'Производство',
  nature: 'Природа',
};

export const TIER_TABS: { id: TierFilter; label: string }[] = [
  { id: 'all', label: 'Все уровни' },
  { id: 'I', label: 'Ур. I' },
  { id: 'II', label: 'Ур. II' },
  { id: 'III', label: 'Ур. III' },
];

export const ERA_TABS: { id: EraFilter; label: string }[] = [
  { id: 'all', label: 'Все эпохи' },
  { id: 'primordial', label: 'Первобытная жизнь' },
  { id: 'dinosaurs', label: 'Динозавры' },
  { id: 'ice-age', label: 'Кайнозой и Ледниковье' },
  { id: 'stone-age', label: 'Каменный век' },
  { id: 'bronze-iron', label: 'Бронза и железо' },
  { id: 'medieval', label: 'Средневековье' },
  { id: 'wildlife', label: 'Дикая природа' },
  { id: 'common-nature', label: 'Общая природа' },
  { id: 'mythic', label: 'Мифические' },
];

export const ERA_LABELS: Record<EraId, string> = {
  primordial: 'Первобытная жизнь',
  dinosaurs: 'Динозавры',
  'ice-age': 'Кайнозой и Ледниковье',
  'stone-age': 'Каменный век',
  'bronze-iron': 'Бронза и железо',
  medieval: 'Средневековье',
  wildlife: 'Дикая природа',
  'common-nature': 'Общая природа',
  mythic: 'Мифические',
};

/**
 * Explicit historical & taxonomic mapping for all existing models that do not
 * declare `era` / `entityType` directly inside their module definition.
 */
const LEGACY_CLASSIFICATION: Record<string, { era: EraId; entityType: EntityType }> = {
  // --- Primordial Life (pre-dinosaur marine/land life & Paleozoic reefs; ZERO buildings) ---
  dunkleosteus: { era: 'primordial', entityType: 'creature' },
  'eurypterid-king': { era: 'primordial', entityType: 'creature' },
  'coral-reef-colony': { era: 'primordial', entityType: 'nature' },

  // --- Dinosaurs & Mesozoic Era (marine, land, flying reptiles & Mesozoic fossils; ZERO buildings) ---
  'tyrannosaurus-rex': { era: 'dinosaurs', entityType: 'creature' },
  mosasaurus: { era: 'dinosaurs', entityType: 'creature' },
  liopleurodon: { era: 'dinosaurs', entityType: 'creature' },
  elasmosaurus: { era: 'dinosaurs', entityType: 'creature' },
  xiphactinus: { era: 'dinosaurs', entityType: 'creature' },
  'amber-fossil-pillar': { era: 'dinosaurs', entityType: 'nature' },

  // --- Cenozoic & Ice Age Megafauna (Cenozoic sea titans + Ice Age mammals) ---
  megalodon: { era: 'ice-age', entityType: 'creature' },
  livyatan: { era: 'ice-age', entityType: 'creature' },
  basilosaurus: { era: 'ice-age', entityType: 'creature' },

  // --- Stone Age (human tribe + megalithic dolmen building) ---
  'mossy-dolmen': { era: 'stone-age', entityType: 'building' },

  // --- Bronze & Iron ---
  'dune-sunpriest': { era: 'bronze-iron', entityType: 'unit' },
  'obsidian-ziggurat': { era: 'bronze-iron', entityType: 'building' },

  // --- Medieval Kingdoms & Sieges (pure medieval; steampunk clocktower moved to mythic) ---
  'peasant-militia': { era: 'medieval', entityType: 'unit' },
  'paladin-knight': { era: 'medieval', entityType: 'unit' },
  'faction-king': { era: 'medieval', entityType: 'unit' },
  'alliance-monarch': { era: 'medieval', entityType: 'unit' },
  'lotus-samurai': { era: 'medieval', entityType: 'unit' },
  'war-galleon': { era: 'medieval', entityType: 'unit' },
  'siege-catapult': { era: 'medieval', entityType: 'unit' },
  'citadel-keep': { era: 'medieval', entityType: 'building' },
  'grand-cathedral': { era: 'medieval', entityType: 'building' },
  'harbor-bastion': { era: 'medieval', entityType: 'building' },
  'ironclad-armory': { era: 'medieval', entityType: 'building' },
  'guild-watermill': { era: 'medieval', entityType: 'building' },
  'watchtower-t1': { era: 'medieval', entityType: 'building' },

  // --- Real Modern Wild Fauna ("Дикая природа") ---
  'gustave-crocodile': { era: 'wildlife', entityType: 'creature' },
  'dire-wolf': { era: 'wildlife', entityType: 'creature' },

  // --- Mythic / Magic / Undead / Monsters / Steampunk & Cyber ---
  'guild-clocktower': { era: 'mythic', entityType: 'building' },
  'brass-steam-boiler': { era: 'mythic', entityType: 'building' },
  'mana-shrub': { era: 'mythic', entityType: 'nature' },
  'blighted-deadwood': { era: 'mythic', entityType: 'nature' },
  'obsidian-monolith': { era: 'mythic', entityType: 'nature' },
  leviathan: { era: 'mythic', entityType: 'creature' },
  kraken: { era: 'mythic', entityType: 'creature' },
  'river-monster': { era: 'mythic', entityType: 'creature' },
  'distortus-rex': { era: 'mythic', entityType: 'creature' },
  'slime-cube': { era: 'mythic', entityType: 'creature' },
  'iron-golem': { era: 'mythic', entityType: 'creature' },
  'forest-treant': { era: 'mythic', entityType: 'creature' },
  'crystal-elemental': { era: 'mythic', entityType: 'creature' },
  'frost-yeti': { era: 'mythic', entityType: 'creature' },
  'bone-wyvern': { era: 'mythic', entityType: 'creature' },
  'mech-spider': { era: 'mythic', entityType: 'creature' },
  'magma-colossus': { era: 'mythic', entityType: 'creature' },
  'elder-dragon': { era: 'mythic', entityType: 'creature' },
  'shadow-panther': { era: 'mythic', entityType: 'creature' },
  'spore-hydra': { era: 'mythic', entityType: 'creature' },
  'scarab-colossus': { era: 'mythic', entityType: 'creature' },
  'lava-salamander': { era: 'mythic', entityType: 'creature' },
  'plague-griffon': { era: 'mythic', entityType: 'creature' },
  'abyssal-reaper': { era: 'mythic', entityType: 'creature' },
  'clockwork-rhino': { era: 'mythic', entityType: 'creature' },
};

export function getModelEra(model: PixelModelDef): EraId {
  if (model.era) return model.era;
  const mapped = LEGACY_CLASSIFICATION[model.id];
  if (mapped) return mapped.era;
  if (model.kind === 'nature' || model.kind === 'substance' || model.kind === 'weather') {
    return 'common-nature';
  }
  return 'mythic';
}

export function getModelEntityType(model: PixelModelDef): EntityType {
  if (model.entityType) return model.entityType;
  const mapped = LEGACY_CLASSIFICATION[model.id];
  if (mapped) return mapped.entityType;
  if (model.kind === 'static' || model.kind === 'animated') return 'building';
  if (model.kind === 'nature' || model.kind === 'substance' || model.kind === 'weather') {
    return 'nature';
  }
  if (model.kind === 'aquatic') {
    // Remaining aquatic entities already mapped above, default to creature
    return 'creature';
  }
  // Dinosaur & megafauna models declared `era` directly without `entityType`
  if (model.id.startsWith('dino-') || model.id.startsWith('mega-')) {
    return 'creature';
  }
  return 'unit';
}

export function getModelBuildingFunction(model: PixelModelDef): BuildingFunction | undefined {
  if (model.buildingFunction) return model.buildingFunction;
  if (getModelEntityType(model) !== 'building') return undefined;
  switch (model.id) {
    case 'citadel-keep':
    case 'watchtower-t1':
    case 'glacier-bastion':
    case 'harbor-bastion':
    case 'orc-war-camp-t1':
    case 'necro-citadel-t3':
      return 'defense';
    case 'grand-cathedral':
    case 'obsidian-ziggurat':
    case 'mossy-dolmen':
    case 'druid-shrine':
    case 'elder-grove-t3':
    case 'summoning-obelisk':
    case 'hellfire-portal':
      return 'religion';
    case 'guild-watermill':
    case 'druid-totem-mill':
      return 'food';
    default:
      return 'production';
  }
}

export interface EraTypeSummaryRow {
  era: EraId;
  label: string;
  creature: number;
  unit: number;
  building: number;
  nature: number;
  total: number;
}

export function getEraTypeSummaryMatrix(models: PixelModelDef[] = ALL_MODELS): EraTypeSummaryRow[] {
  const eras = ERA_TABS.filter((e): e is { id: EraId; label: string } => e.id !== 'all');
  const rows = eras.map<EraTypeSummaryRow>((e) => ({
    era: e.id,
    label: e.label,
    creature: 0,
    unit: 0,
    building: 0,
    nature: 0,
    total: 0,
  }));
  const rowMap = new Map(rows.map((r) => [r.era, r]));
  for (const m of models) {
    const row = rowMap.get(getModelEra(m));
    if (!row) continue;
    const et = getModelEntityType(m);
    row[et] += 1;
    row.total += 1;
  }
  return rows;
}

export function filterModels(
  models: PixelModelDef[],
  filter: FilterTab,
  tierFilter: TierFilter = 'all',
  eraFilter: EraFilter = 'all',
  entityTypeFilter: EntityTypeFilter = 'all'
): PixelModelDef[] {
  return models.filter((m) => {
    if (filter !== 'all' && m.kind !== filter) return false;
    if (tierFilter !== 'all' && m.tier !== tierFilter) return false;
    if (eraFilter !== 'all' && getModelEra(m) !== eraFilter) return false;
    if (entityTypeFilter !== 'all' && getModelEntityType(m) !== entityTypeFilter) return false;
    return true;
  });
}

/**
 * Renders a model frame through the FrameAtlasCache + Building State +
 * Gene Variations + Mask Recoloring + Shape-Based Stage-Adaptive Soft Shadow pipeline:
 * `key = modelId | kingdom | phenotype | mode | action | shadowStage | genesKey | b_state | frame`
 */
export function renderModelWithContext(
  model: PixelModelDef,
  frameIndex: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const safeFrame = ((frameIndex % model.frameCount) + model.frameCount) % model.frameCount;
  const kingdomId = ctx?.kingdomId ?? 'original';
  const phenotypeId =
    ctx?.phenotypeId ?? model.unitMeta?.defaultPhenotype ?? 'skin_light';
  const unitMode = ctx?.unitMode ?? 'walk';
  const unitAction = ctx?.unitAction ?? 'normal';
  const showShadow = ctx?.showShadow !== false;
  const stageBg = ctx?.stageBg ?? 'dark';
  const genes = resolveCreatureGenes(ctx?.genes);
  const entityType = getModelEntityType(model);
  const buildingState: BuildingState =
    entityType === 'building' ? (ctx?.buildingState ?? 'ready') : 'ready';

  const key = buildFrameCacheKey({
    modelId: model.id,
    frame: safeFrame,
    kingdomId,
    phenotypeId,
    unitMode,
    unitAction,
    showShadow,
    stageBg,
    genesKey: serializeGenesKey(genes),
    buildingState,
  });

  const cached = globalFrameCache.get(key);
  if (cached) return cached;

  let raw = model.renderFrame(safeFrame, model.frameCount, {
    kingdomId,
    phenotypeId,
    unitMode,
    unitAction,
    showShadow: false,
    stageBg,
    genes,
    buildingState,
  });

  if (entityType === 'building' && buildingState !== 'ready' && !model.supportsBuildingStates) {
    raw = applyBuildingState(raw, buildingState, safeFrame, model.frameCount);
  }

  // Ensure zero legacy flat #11102B66 oval pixels ever leak into foreground
  raw = raw.stripColor(SHADOW_COLOR);

  const anchors = model.getAnchors
    ? model.getAnchors(safeFrame, model.frameCount, {
        kingdomId,
        phenotypeId,
        unitMode,
        unitAction,
        showShadow: false,
        stageBg,
        genes,
        buildingState,
      })
    : null;

  // Apply subspecies gene mutations (coat, biome tint, size) while keeping masks pure
  raw = applyCreatureGenes(raw, genes, {
    anchorY: anchors?.pivot.y,
  });

  const lookup = buildMaskColorLookup(kingdomId, phenotypeId, 1);
  let output = lookup.size > 0 ? raw.recolorWithLookup(lookup) : raw;

  const shouldRenderShadow =
    showShadow &&
    model.supportsShadow !== false &&
    !(model.kind === 'unit' && (unitMode === 'swim' || unitAction === 'death'));

  if (shouldRenderShadow) {
    output = applySoftGroundShadow(output, {
      stageBg,
      groundY: anchors ? anchors.pivot.y + 1 : undefined,
      isCompactUnit: model.kind === 'unit',
    });
  }

  globalFrameCache.set(key, output);
  return output;
}
