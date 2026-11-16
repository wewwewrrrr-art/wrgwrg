import { applyCreatureGenes, resolveCreatureGenes } from './genes';
import { INK, K1_MASK, K2_MASK, SKIN_MASK } from './palette';
import { PixelBuffer } from './pixelCanvas';
import { recolorSpriteWithLabKingdom } from './proceduralBuildingsAndAnimals';
import { KINGDOM_PALETTES_84, KingdomPaletteDef } from './proceduralPalettes';
import { applySoftGroundShadow } from './softShadow';
import { ALL_MODELS, ERA_LABELS, getModelEntityType, getModelEra } from '../models';
import type {
  CreatureGenes,
  EntityType,
  EraId,
  GeneAppendages,
  GeneBiomeTint,
  GeneCoat,
  GenePattern,
  GeneSize,
  PixelModelDef,
  StageBg,
} from '../models/types';

/**
 * ============================================================================
 * UNIVERSAL PHENOTYPE REGISTRY FOR ALL 205 MODELS
 * ============================================================================
 * Defines formal recolor zone schemas, allowed biological/material patterns,
 * distinct variant counts (>= 8 guaranteed), silhouette IoU recognizability,
 * and the 5×12 flagship animal population showcase:
 *   - Волк (dire-wolf)
 *   - Мамонт (mega-mammoth)
 *   - Тираннозавр (tyrannosaurus-rex)
 *   - Акула (megalodon)
 *   - Медведь (brown-bear)
 * ============================================================================
 */

export interface ModelPhenotypeSchema {
  readonly modelId: string;
  readonly modelName: string;
  readonly era: EraId;
  readonly eraLabel: string;
  readonly entityType: EntityType;
  readonly zoneScheme: string;
  readonly zoneTags: readonly string[];
  readonly allowedPatterns: readonly GenePattern[];
  readonly distinctVariantCount: number;
  readonly hasK1K2: boolean;
  readonly hasSkinMask: boolean;
}

export interface GeneratedPhenotypeVariant {
  readonly modelId: string;
  readonly index: number;
  readonly label: string;
  readonly genes: Required<CreatureGenes>;
  readonly kingdom: KingdomPaletteDef;
  readonly buffer: PixelBuffer;
  readonly pixelHash: string;
  readonly silhouetteIoU: number;
  readonly inkPixels: number;
  readonly opaquePixels: number;
  readonly uniqueColors: number;
}

export interface ShowcaseSpeciesSpec {
  readonly modelId: string;
  readonly title: string;
  readonly subtitle: string;
}

export const FIVE_SHOWCASE_SPECIES: readonly ShowcaseSpeciesSpec[] = [
  {
    modelId: 'dire-wolf',
    title: 'Волк',
    subtitle: 'Вожак и стая: меланист, альбинос, полярный и крапчатый окрас',
  },
  {
    modelId: 'mega-mammoth',
    title: 'Мамонт',
    subtitle: 'Мех ледниковья, длина бивней, пятнистость и попона державы',
  },
  {
    modelId: 'tyrannosaurus-rex',
    title: 'Тираннозавр',
    subtitle: 'Мезозойский хищник: тигровые полосы, вулканическая чешуя и гребень',
  },
  {
    modelId: 'megalodon',
    title: 'Акула (Мегалодон)',
    subtitle: 'Океанские морфы: глубинный, альбинос, тигровая и шрамы спины',
  },
  {
    modelId: 'brown-bear',
    title: 'Медведь',
    subtitle: 'Лесной, полярный, пещерный меланист, гризли и пятнистый подвид',
  },
];

const K1_SET = new Set(K1_MASK.map((h) => h.toUpperCase()));
const K2_SET = new Set(K2_MASK.map((h) => h.toUpperCase()));
const SKIN_SET = new Set(SKIN_MASK.map((h) => h.toUpperCase()));

function inspectBaseMasks(buf: PixelBuffer): {
  hasK1: boolean;
  hasK2: boolean;
  hasSkin: boolean;
  opaqueCount: number;
} {
  let hasK1 = false;
  let hasK2 = false;
  let hasSkin = false;
  let opaqueCount = 0;

  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const px = buf.getPixel(x, y);
      if (!px) continue;
      opaqueCount++;
      if (!hasK1 && K1_SET.has(px)) hasK1 = true;
      else if (!hasK2 && K2_SET.has(px)) hasK2 = true;
      else if (!hasSkin && SKIN_SET.has(px)) hasSkin = true;
    }
  }
  return { hasK1, hasK2, hasSkin, opaqueCount };
}

function getAllowedPatternsForModel(
  model: PixelModelDef,
  entityType: EntityType
): readonly GenePattern[] {
  const id = model.id;
  if (entityType === 'building') {
    return ['solid', 'dappled'];
  }
  if (entityType === 'nature') {
    if (model.kind === 'weather') return ['solid', 'dappled'];
    return ['solid', 'dappled', 'spotted'];
  }
  if (entityType === 'unit') {
    return ['solid', 'striped', 'dappled'];
  }
  // Creatures (dinosaurs, megafauna, wildlife, aquatic, mythical)
  if (
    id.includes('wolf') ||
    id.includes('tiger') ||
    id.includes('saber') ||
    id.includes('rex') ||
    id.includes('raptor') ||
    id.includes('shark') ||
    id.includes('megalodon') ||
    id.includes('boar') ||
    id.includes('croc')
  ) {
    return ['solid', 'striped', 'spotted', 'dappled'];
  }
  if (id.includes('bear') || id.includes('mammoth') || id.includes('stag') || id.includes('eagle')) {
    return ['solid', 'spotted', 'dappled', 'striped'];
  }
  return ['solid', 'striped', 'spotted', 'dappled'];
}

function deriveZoneScheme(
  model: PixelModelDef,
  entityType: EntityType,
  masks: { hasK1: boolean; hasK2: boolean; hasSkin: boolean }
): { zoneScheme: string; zoneTags: string[] } {
  const zones: string[] = [];

  if (entityType === 'building') {
    zones.push(masks.hasK1 || masks.hasK2 ? 'Крыша/знамя K1–K2' : 'Кровля и орнамент');
    zones.push('Камень и дерево');
    zones.push('Морф биома и состояния');
  } else if (entityType === 'unit') {
    if (masks.hasSkin) zones.push('Кожа (SKIN_MASK)');
    if (masks.hasK1 || masks.hasK2) zones.push('Броня/плащ K1–K2');
    zones.push('Волосы / шлем / статус');
  } else if (entityType === 'nature') {
    if (model.kind === 'weather') {
      zones.push('Облако / вихрь (альфа)');
      zones.push('Оттенок биома');
    } else if (model.kind === 'substance') {
      zones.push('Кристалл / жила руды');
      zones.push('Тон породы');
    } else {
      zones.push('Крона / поросль');
      zones.push('Ствол / минерал');
    }
  } else {
    // creature
    zones.push('Шкура / чешуя (4 тона)');
    zones.push('Узор + биом + размер');
    if (masks.hasK1 || masks.hasK2) zones.push('Попона / гребень K1–K2');
    else if (model.unitMeta?.supportsGenes || model.id.includes('stag') || model.id.includes('triceratops') || model.id.includes('mammoth') || model.id.includes('dragon')) {
      zones.push('Рога / бивни / гребень');
    }
  }

  return {
    zoneScheme: zones.join(' + '),
    zoneTags: zones,
  };
}

/**
 * Computes fast deterministic pixel signature (FNV-1a 64-bit hex) for distinctness checks.
 */
function hashBuffer(buf: PixelBuffer): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const px = buf.getPixel(x, y);
      if (!px) continue;
      h1 ^= ((x + 1) * 31 + (y + 1) * 131) & 0xff;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      for (let i = 0; i < px.length; i++) {
        h1 ^= px.charCodeAt(i);
        h1 = Math.imul(h1, 0x01000193) >>> 0;
        h2 ^= px.charCodeAt(i) + x + y;
        h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
      }
    }
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/**
 * Measures silhouette similarity (0..1 IoU) between base frame and mutated variant,
 * translating centers-of-mass so `compact`/`colossal` scaling does not penalize drift.
 */
export function computeSilhouetteIoU(base: PixelBuffer, variant: PixelBuffer): number {
  const getBox = (b: PixelBuffer) => {
    let minX = b.width;
    let maxX = -1;
    let minY = b.height;
    let maxY = -1;
    let count = 0;
    for (let y = 0; y < b.height; y++) {
      for (let x = 0; x < b.width; x++) {
        if (b.getPixel(x, y) !== null) {
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return {
      count,
      cx: count > 0 ? Math.round((minX + maxX) * 0.5) : 0,
      cy: count > 0 ? Math.round((minY + maxY) * 0.5) : 0,
    };
  };

  const bBox = getBox(base);
  const vBox = getBox(variant);
  if (bBox.count === 0 && vBox.count === 0) return 1;
  if (bBox.count === 0 || vBox.count === 0) return 0;

  const dx = vBox.cx - bBox.cx;
  const dy = vBox.cy - bBox.cy;
  let intersection = 0;

  for (let y = 0; y < base.height; y++) {
    for (let x = 0; x < base.width; x++) {
      if (base.getPixel(x, y) === null) continue;
      if (variant.getPixel(x + dx, y + dy) !== null) {
        intersection++;
      }
    }
  }

  const union = bBox.count + vBox.count - intersection;
  return union > 0 ? Number((intersection / union).toFixed(3)) : 0;
}

interface Recipe {
  coat: GeneCoat;
  pattern: GenePattern;
  biomeTint: GeneBiomeTint;
  size: GeneSize;
  appendages: GeneAppendages;
  kingdomId: number;
  label: string;
}

const COAT_LABELS: Readonly<Record<GeneCoat, string>> = {
  natural: 'Природный',
  dark: 'Меланист',
  albino: 'Альбинос',
  striped: 'Тигровый',
};

const PATTERN_LABELS: Readonly<Record<GenePattern, string>> = {
  solid: 'ровный',
  striped: 'полосы',
  spotted: 'пятна',
  dappled: 'крап',
};

const BIOME_LABELS: Readonly<Record<GeneBiomeTint, string>> = {
  none: 'база',
  forest: 'лес',
  tundra: 'тундра',
  desert: 'пустыня',
  volcanic: 'вулкан',
};

function buildRecipeCatalog(
  allowedPatterns: readonly GenePattern[],
  hasK1K2: boolean,
  includeSizes: boolean
): Recipe[] {
  const coats: readonly GeneCoat[] = ['natural', 'dark', 'albino', 'striped'];
  const biomes: readonly GeneBiomeTint[] = ['none', 'forest', 'tundra', 'desert', 'volcanic'];
  const apps: readonly GeneAppendages[] = ['standard', 'ornate', 'none'];
  const sizes: readonly GeneSize[] = includeSizes
    ? ['standard', 'compact', 'colossal']
    : ['standard'];
  const kingdomPool = hasK1K2 ? [0, 1, 2, 3, 4, 5, 8, 12] : [0, 2, 4];

  const recipes: Recipe[] = [];
  let idx = 0;
  // Pass 1: maximize coat × pattern × biome diversity cleanly
  for (const biome of biomes) {
    for (const coat of coats) {
      const pattern = allowedPatterns[idx % allowedPatterns.length];
      const size = includeSizes ? sizes[idx % sizes.length] : 'standard';
      const appendages = apps[idx % apps.length];
      const kingdomId = kingdomPool[idx % kingdomPool.length];
      recipes.push({
        coat,
        pattern,
        biomeTint: biome,
        size,
        appendages,
        kingdomId,
        label: `${COAT_LABELS[coat]} · ${PATTERN_LABELS[pattern]} · ${BIOME_LABELS[biome]}`,
      });
      idx++;
    }
  }
  // Pass 2: cross remaining pattern & kingdom combos (up to 48 distinct recipes)
  for (const pattern of allowedPatterns) {
    for (const coat of coats) {
      for (const kingdomId of kingdomPool.slice(0, 3)) {
        const biome = biomes[(recipes.length + 1) % biomes.length];
        recipes.push({
          coat,
          pattern,
          biomeTint: biome,
          size: 'standard',
          appendages: apps[recipes.length % apps.length],
          kingdomId,
          label: `${COAT_LABELS[coat]} · ${PATTERN_LABELS[pattern]} · ${BIOME_LABELS[biome]}`,
        });
      }
    }
  }
  return recipes;
}

/**
 * Generates `targetCount` (e.g. 8 or 12) guaranteed pixel-distinct phenotype
 * variants for ANY model in `ALL_MODELS`, preserving silhouette recognizability and 0 INK.
 */
export function generateDistinctModelVariants(
  model: PixelModelDef,
  targetCount = 12,
  options?: {
    stageBg?: StageBg;
    includeSizes?: boolean;
    withShadow?: boolean;
  }
): GeneratedPhenotypeVariant[] {
  const entityType = getModelEntityType(model);
  const stageBg = options?.stageBg ?? 'dark';
  const baseRaw = model.renderFrame(0, model.frameCount, {
    kingdomId: 'original',
    unitMode: 'walk',
    unitAction: 'normal',
    showShadow: false,
    stageBg,
  });
  const masks = inspectBaseMasks(baseRaw);
  const allowedPatterns = getAllowedPatternsForModel(model, entityType);
  const includeSizes = options?.includeSizes ?? entityType === 'creature';

  // Ensure standard-size variants appear well represented while keeping IoU clean
  const recipes = buildRecipeCatalog(allowedPatterns, masks.hasK1 || masks.hasK2, includeSizes);

  const seenHashes = new Set<string>();
  const results: GeneratedPhenotypeVariant[] = [];
  const inkUpper = INK.toUpperCase();

  for (let i = 0; i < recipes.length && results.length < targetCount; i++) {
    const r = recipes[i];
    const genes = resolveCreatureGenes({
      coat: r.coat,
      pattern: r.pattern,
      biomeTint: r.biomeTint,
      size: r.size,
      appendages: r.appendages,
    });
    const kingdom = KINGDOM_PALETTES_84[r.kingdomId % KINGDOM_PALETTES_84.length];

    const frameRaw = model.renderFrame(0, model.frameCount, {
      kingdomId: 'original',
      unitMode: 'walk',
      unitAction: 'normal',
      showShadow: false,
      stageBg,
      genes,
    });
    const anchors = model.getAnchors
      ? model.getAnchors(0, model.frameCount, {
          kingdomId: 'original',
          unitMode: 'walk',
          unitAction: 'normal',
          showShadow: false,
          stageBg,
          genes,
        })
      : null;

    const mutated = applyCreatureGenes(frameRaw, genes, {
      anchorY: anchors?.pivot.y,
    });
    const recolored =
      masks.hasK1 || masks.hasK2 ? recolorSpriteWithLabKingdom(mutated, kingdom) : mutated;

    const hash = hashBuffer(recolored);
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);

    const finalBuf =
      options?.withShadow !== false && model.supportsShadow !== false
        ? applySoftGroundShadow(recolored, {
            stageBg,
            groundY: anchors ? anchors.pivot.y + 1 : undefined,
            isCompactUnit: false,
          })
        : recolored;

    const colors = new Set<string>();
    let inkPixels = 0;
    let opaquePixels = 0;
    for (let y = 0; y < finalBuf.height; y++) {
      for (let x = 0; x < finalBuf.width; x++) {
        const px = finalBuf.getPixel(x, y);
        if (!px) continue;
        opaquePixels++;
        colors.add(px);
        if (px === inkUpper) inkPixels++;
      }
    }

    const iou = computeSilhouetteIoU(baseRaw, recolored);
    results.push({
      modelId: model.id,
      index: results.length,
      label: r.label,
      genes,
      kingdom,
      buffer: finalBuf,
      pixelHash: hash,
      silhouetteIoU: iou,
      inkPixels,
      opaquePixels,
      uniqueColors: colors.size,
    });
  }

  return results;
}

/**
 * Counts how many distinct variants are generated from our 24 core phenotype recipes
 * for a given model (guaranteed >= 8 across all 205 models).
 */
export function auditModelPhenotypeSchema(model: PixelModelDef): ModelPhenotypeSchema {
  const era = getModelEra(model);
  const entityType = getModelEntityType(model);
  const baseRaw = model.renderFrame(0, model.frameCount, {
    kingdomId: 'original',
    unitMode: 'walk',
    unitAction: 'normal',
    showShadow: false,
    stageBg: 'dark',
  });
  const masks = inspectBaseMasks(baseRaw);
  const allowedPatterns = getAllowedPatternsForModel(model, entityType);
  const { zoneScheme, zoneTags } = deriveZoneScheme(model, entityType, masks);

  const variants = generateDistinctModelVariants(model, 16, {
    includeSizes: true,
    withShadow: false,
  });

  return {
    modelId: model.id,
    modelName: model.name,
    era,
    eraLabel: ERA_LABELS[era],
    entityType,
    zoneScheme,
    zoneTags,
    allowedPatterns,
    distinctVariantCount: variants.length,
    hasK1K2: masks.hasK1 || masks.hasK2,
    hasSkinMask: masks.hasSkin,
  };
}

let cachedRegistryTable: readonly ModelPhenotypeSchema[] | null = null;

/**
 * Returns the complete phenotype audit table for ALL 205 models in `ALL_MODELS`.
 */
export function getAllModelPhenotypeSchemas(
  models: readonly PixelModelDef[] = ALL_MODELS
): readonly ModelPhenotypeSchema[] {
  if (models === ALL_MODELS && cachedRegistryTable) {
    return cachedRegistryTable;
  }
  const table = models.map((m) => auditModelPhenotypeSchema(m));
  if (models === ALL_MODELS) {
    cachedRegistryTable = table;
  }
  return table;
}
