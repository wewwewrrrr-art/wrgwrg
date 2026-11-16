import { applyBuildingState } from './buildingStates';
import { applyCreatureGenes, resolveCreatureGenes } from './genes';
import { INK, K1_MASK, K2_MASK } from './palette';
import { PixelBuffer } from './pixelCanvas';
import {
  ACTIVE_UNIT_ERAS,
  ACTIVE_UNIT_RACES,
  ActiveUnitRace,
  GeneratedHumanResult,
  MedievalHumanRole,
  Point2D,
  PowerHierarchyRank,
  ProceduralAnchors,
  UnitAge,
  type UnitAnimationAction,
  UnitEra,
  UnitGender,
  UnitRace,
  UnitStatus,
  generateProceduralUnit,
  getRaceActionSpec,
} from './proceduralHuman';
import { KINGDOM_PALETTES_84, KingdomPaletteDef } from './proceduralPalettes';
import { AtlasStats, BakedSpriteAtlas } from './spriteAtlas';
import { applySoftGroundShadow } from './softShadow';
import { BuildingState, CreatureGenes, GenePattern, PixelModelDef, StageBg } from '../models/types';
import { getModelEntityType, getModelEra } from '../models';

// ============================================================================
// ITEM 5: BUILDINGS IN 6 KINGDOMS (LAB K1/K2 RECOLORING + STATES)
// ============================================================================

export const FLAGSHIP_SIX_KINGDOMS: readonly KingdomPaletteDef[] =
  KINGDOM_PALETTES_84.slice(0, 6);

export const SHOWCASE_BUILDING_IDS = [
  'citadel-keep',
  'medieval-castle-walls',
  'medieval-church',
  'medieval-windmill',
  'bronze-ziggurat-shrine',
  'stone-wigwam-hut',
] as const;

/**
 * Returns ALL buildings belonging to the Medieval & Bronze/Iron eras
 * (16 medieval + 10 bronze-iron = 26 buildings) for kingdom K1/K2 recoloring.
 */
export function getAllMedievalAndBronzeBuildings(
  models: readonly PixelModelDef[]
): PixelModelDef[] {
  return models.filter((m) => {
    const et = getModelEntityType(m);
    const era = getModelEra(m);
    return et === 'building' && (era === 'medieval' || era === 'bronze-iron');
  });
}

/**
 * Recolors any PixelBuffer using a CIELAB-spaced `KingdomPaletteDef`
 * (mapping 4-stop K1_MASK -> kingdom.k1Ramp and K2_MASK -> kingdom.k2Ramp),
 * leaving stone masonry, timber, foliage, gold, and shading completely intact.
 */
export function recolorSpriteWithLabKingdom(
  src: PixelBuffer,
  kingdom: KingdomPaletteDef
): PixelBuffer {
  const lookup = new Map<string, string>();
  K1_MASK.forEach((maskHex, idx) => {
    lookup.set(maskHex.toUpperCase(), kingdom.k1Ramp[idx]);
  });
  K2_MASK.forEach((maskHex, idx) => {
    lookup.set(maskHex.toUpperCase(), kingdom.k2Ramp[idx]);
  });
  return src.recolorWithLookup(lookup);
}

export interface BuildingKingdomVariant {
  readonly modelId: string;
  readonly modelName: string;
  readonly kingdom: KingdomPaletteDef;
  readonly buildingState: BuildingState;
  readonly buffer: PixelBuffer;
  readonly k1ChangedPixels: number;
  readonly k2ChangedPixels: number;
  readonly inkPixels: number;
}

/**
 * Renders a building structure across 6 distinct Lab-spaced kingdoms
 * with optional construction/damage state (`constructing | ready | damaged | ruins`).
 */
export function generateBuildingSixKingdomVariants(
  model: PixelModelDef,
  buildingState: BuildingState = 'ready',
  kingdoms: readonly KingdomPaletteDef[] = FLAGSHIP_SIX_KINGDOMS,
  stageBg: StageBg = 'dark',
  frameIndex = 0
): BuildingKingdomVariant[] {
  const safeFrame = ((frameIndex % model.frameCount) + model.frameCount) % model.frameCount;
  let baseRaw = model.renderFrame(safeFrame, model.frameCount, {
    kingdomId: 'original',
    buildingState,
    showShadow: false,
    stageBg,
  });
  if (buildingState !== 'ready' && !model.supportsBuildingStates) {
    baseRaw = applyBuildingState(baseRaw, buildingState, safeFrame, model.frameCount);
  }

  const k1Set = new Set(K1_MASK.map((c) => c.toUpperCase()));
  const k2Set = new Set(K2_MASK.map((c) => c.toUpperCase()));
  const inkUpper = INK.toUpperCase();

  let k1Count = 0;
  let k2Count = 0;
  for (let y = 0; y < baseRaw.height; y++) {
    for (let x = 0; x < baseRaw.width; x++) {
      const px = baseRaw.getPixel(x, y);
      if (!px) continue;
      if (k1Set.has(px)) k1Count++;
      else if (k2Set.has(px)) k2Count++;
    }
  }

  return kingdoms.map((kingdom) => {
    const recolored = recolorSpriteWithLabKingdom(baseRaw, kingdom);
    const withShadow =
      model.supportsShadow !== false
        ? applySoftGroundShadow(recolored, { stageBg, isCompactUnit: false })
        : recolored;

    let inkPixels = 0;
    for (let y = 0; y < withShadow.height; y++) {
      for (let x = 0; x < withShadow.width; x++) {
        if (withShadow.getPixel(x, y) === inkUpper) inkPixels++;
      }
    }

    return {
      modelId: model.id,
      modelName: model.name,
      kingdom,
      buildingState,
      buffer: withShadow,
      k1ChangedPixels: k1Count,
      k2ChangedPixels: k2Count,
      inkPixels,
    };
  });
}

// ============================================================================
// ITEM 6: ANIMAL PHENOTYPES & GENETIC MUTATIONS
// ============================================================================

export const SHOWCASE_ANIMAL_IDS = [
  'wild-boar',
  'forest-stag',
  'brown-bear',
  'steppe-eagle',
  'dire-wolf',
  'mega-mammoth',
  'mega-sabertooth',
  'tyrannosaurus-rex',
] as const;

export interface ResolvedAnimalPhenotype {
  readonly seed: number;
  readonly modelId: string;
  readonly genes: Required<CreatureGenes>;
  readonly kingdom: KingdomPaletteDef;
}

export interface GeneratedAnimalPhenotypeResult {
  readonly model: PixelModelDef;
  readonly phenotype: ResolvedAnimalPhenotype;
  readonly buffer: PixelBuffer;
  readonly opaquePixels: number;
  readonly uniqueColors: number;
  readonly inkPixels: number;
}

const ANIMAL_COATS = ['natural', 'dark', 'albino', 'striped'] as const;
const ANIMAL_SIZES = ['compact', 'standard', 'colossal'] as const;
const ANIMAL_APPENDAGES = ['none', 'standard', 'ornate'] as const;
const ANIMAL_BIOMES = ['none', 'forest', 'tundra', 'desert', 'volcanic'] as const;
const ANIMAL_PATTERNS: readonly GenePattern[] = ['solid', 'striped', 'spotted', 'dappled'];

function createAnimalRng(seed: number): () => number {
  let state = (Math.floor(seed) ^ 0x85ebca6b) >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function resolveAnimalPhenotype(
  seed: number,
  modelId: string,
  overrides?: {
    genes?: CreatureGenes;
    kingdomId?: number;
  }
): ResolvedAnimalPhenotype {
  const rng = createAnimalRng(seed);
  const autoGenes: Required<CreatureGenes> = {
    coat: ANIMAL_COATS[Math.floor(rng() * ANIMAL_COATS.length)],
    size: ANIMAL_SIZES[Math.floor(rng() * ANIMAL_SIZES.length)],
    appendages: ANIMAL_APPENDAGES[Math.floor(rng() * ANIMAL_APPENDAGES.length)],
    biomeTint: ANIMAL_BIOMES[Math.floor(rng() * ANIMAL_BIOMES.length)],
    pattern: ANIMAL_PATTERNS[Math.floor(rng() * ANIMAL_PATTERNS.length)],
  };
  const genes = resolveCreatureGenes(overrides?.genes ? { ...autoGenes, ...overrides.genes } : autoGenes);
  const kIdx =
    overrides?.kingdomId !== undefined
      ? ((overrides.kingdomId % KINGDOM_PALETTES_84.length) + KINGDOM_PALETTES_84.length) %
        KINGDOM_PALETTES_84.length
      : Math.floor(rng() * KINGDOM_PALETTES_84.length);

  return {
    seed,
    modelId,
    genes,
    kingdom: KINGDOM_PALETTES_84[kIdx],
  };
}

/**
 * Renders any animal / beast model with explicit or seeded CreatureGenes
 * (coat, size, appendages, biomeTint) and optional Lab Kingdom K1/K2 harness recolor.
 */
export function generateAnimalPhenotypeVariant(
  model: PixelModelDef,
  seed: number,
  overrides?: {
    genes?: CreatureGenes;
    kingdomId?: number;
    frameIndex?: number;
    stageBg?: StageBg;
    showShadow?: boolean;
  }
): GeneratedAnimalPhenotypeResult {
  const phenotype = resolveAnimalPhenotype(seed, model.id, overrides);
  const safeFrame = (((overrides?.frameIndex ?? 0) % model.frameCount) + model.frameCount) % model.frameCount;
  const stageBg = overrides?.stageBg ?? 'dark';

  const raw = model.renderFrame(safeFrame, model.frameCount, {
    kingdomId: 'original',
    unitMode: 'walk',
    unitAction: 'normal',
    showShadow: false,
    stageBg,
    genes: phenotype.genes,
  });

  const anchors = model.getAnchors
    ? model.getAnchors(safeFrame, model.frameCount, {
        kingdomId: 'original',
        unitMode: 'walk',
        unitAction: 'normal',
        showShadow: false,
        stageBg,
        genes: phenotype.genes,
      })
    : null;

  const mutated = applyCreatureGenes(raw, phenotype.genes, {
    anchorY: anchors?.pivot.y,
  });
  const recolored = recolorSpriteWithLabKingdom(mutated, phenotype.kingdom);
  const finalBuf =
    overrides?.showShadow !== false && model.supportsShadow !== false
      ? applySoftGroundShadow(recolored, {
          stageBg,
          groundY: anchors ? anchors.pivot.y + 1 : undefined,
          isCompactUnit: false,
        })
      : recolored;

  const inkUpper = INK.toUpperCase();
  const colors = new Set<string>();
  let opaquePixels = 0;
  let inkPixels = 0;
  for (let y = 0; y < finalBuf.height; y++) {
    for (let x = 0; x < finalBuf.width; x++) {
      const c = finalBuf.getPixel(x, y);
      if (!c) continue;
      opaquePixels++;
      colors.add(c);
      if (c === inkUpper) inkPixels++;
    }
  }

  return {
    model,
    phenotype,
    buffer: finalBuf,
    opaquePixels,
    uniqueColors: colors.size,
    inkPixels,
  };
}

// ============================================================================
// ITEMS 7 & 8: UNIFIED ATLAS PACKING & FULL JSON MANIFEST EXPORT
// ============================================================================

export interface ProceduralAtlasFrameEntry {
  readonly key: string;
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly era: UnitEra;
  readonly race: UnitRace;
  readonly gender: UnitGender;
  readonly age: UnitAge;
  readonly role: MedievalHumanRole;
  readonly powerRank: PowerHierarchyRank;
  readonly status: UnitStatus;
  readonly action: UnitAnimationAction;
  readonly durationMs: number;
  readonly loop: boolean;
  readonly frameIndex: number;
  readonly kingdom: {
    readonly id: number;
    readonly name: string;
    readonly primaryHex: string;
    readonly secondaryHex: string;
  };
  readonly skin: { readonly id: number; readonly name: string };
  readonly hair: { readonly id: number; readonly name: string };
  readonly anchors: {
    readonly pivot: Point2D;
    readonly head: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
    readonly face: Point2D;
    readonly belt: { readonly x: number; readonly y: number; readonly w: number };
    readonly hand: {
      readonly leftX: number;
      readonly leftY: number;
      readonly rightX: number;
      readonly rightY: number;
    };
    readonly feetY: number;
  };
  readonly zones: {
    readonly k1: number;
    readonly k2: number;
    readonly skin: number;
    readonly hair: number;
  };
  readonly audit: {
    readonly uniqueColors: number;
    readonly opaquePixels: number;
    readonly orphanPixels: number;
  };
}

export interface ProceduralAtlasAnimationClip {
  readonly id: string;
  readonly race: UnitRace;
  readonly action: UnitAnimationAction;
  readonly loop: boolean;
  readonly frames: readonly string[];
  readonly frameDurationsMs: readonly number[];
  readonly anchors: readonly ProceduralAnchors[];
}

export interface ProceduralAtlasManifest {
  readonly version: string;
  readonly generator: string;
  readonly tileSize: { readonly width: number; readonly height: number };
  readonly atlasStats: AtlasStats;
  readonly summary: {
    readonly totalFrames: number;
    readonly eras: readonly UnitEra[];
    readonly races: readonly UnitRace[];
    readonly maxColorsObserved: number;
    readonly totalOrphanPixels: number;
  };
  readonly frames: readonly ProceduralAtlasFrameEntry[];
  readonly animations: Readonly<Record<string, ProceduralAtlasAnimationClip>>;
}

export interface PackedProceduralAtlasBundle {
  readonly atlas: BakedSpriteAtlas;
  readonly units: readonly GeneratedHumanResult[];
  readonly manifest: ProceduralAtlasManifest;
  readonly jsonString: string;
}

/**
 * Generates a curated or seeded batch of procedural 10×10 units across all 3 eras
 * and all 6 fantasy/human races, packs them cleanly into `BakedSpriteAtlas`,
 * and produces a complete JSON manifest with atlas coords, anchors, zones & metadata.
 */
export function packProceduralAtlasBatch(options?: {
  count?: number;
  baseSeed?: number;
  includeAllEras?: boolean;
  includeAllRaces?: boolean;
}): PackedProceduralAtlasBundle {
  const count = Math.max(12, Math.min(2000, options?.count ?? 144));
  const baseSeed = options?.baseSeed ?? 8000;
  const eras: readonly UnitEra[] = options?.includeAllEras !== false
    ? ACTIVE_UNIT_ERAS
    : ['medieval'];
  const races: readonly ActiveUnitRace[] = options?.includeAllRaces !== false
    ? ACTIVE_UNIT_RACES
    : ['human'];

  const atlas = new BakedSpriteAtlas(1024);
  const units: GeneratedHumanResult[] = [];
  const frames: ProceduralAtlasFrameEntry[] = [];
  const animations: Record<string, ProceduralAtlasAnimationClip> = {};
  const eraSeen = new Set<UnitEra>();
  const raceSeen = new Set<UnitRace>();

  let maxColorsObserved = 0;
  let totalOrphanPixels = 0;

  for (let i = 0; i < count; i++) {
    const era = eras[i % eras.length];
    const race = races[Math.floor(i / eras.length) % races.length];
    const seed = baseSeed + i * 3571;
    const action: UnitAnimationAction = 'walk';
    const unit = generateProceduralUnit({
      seed,
      era,
      race,
      action,
      frameIndex: i % 4,
    });

    const p = unit.profile;
    const spec = getRaceActionSpec(p.race, p.action);
    const durationMs = spec.frameDurationsMs[p.frameIndex] ?? 160;
    eraSeen.add(p.era);
    raceSeen.add(p.race);
    if (unit.audit.uniqueColors > maxColorsObserved) {
      maxColorsObserved = unit.audit.uniqueColors;
    }
    totalOrphanPixels += unit.audit.orphanPixels;

    const key = `u_${p.era}_${p.race}_${p.role}_${p.powerRank}_k${p.kingdom.id}_s${p.seed}_f${p.frameIndex}`;
    const { region } = atlas.getOrBake(key, () => unit.buffer);

    const clipKey = `${p.era}_${p.race}_${p.action}`;
    if (!animations[clipKey]) {
      animations[clipKey] = {
        id: clipKey,
        race: p.race,
        action: p.action,
        loop: spec.loop,
        frames: [key],
        frameDurationsMs: [durationMs],
        anchors: [p.anchors],
      };
    } else {
      animations[clipKey] = {
        ...animations[clipKey],
        frames: [...animations[clipKey].frames, key],
        frameDurationsMs: [...animations[clipKey].frameDurationsMs, durationMs],
        anchors: [...animations[clipKey].anchors, p.anchors],
      };
    }

    units.push(unit);
    frames.push({
      key,
      pageIndex: region.pageIndex,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      seed: p.seed,
      era: p.era,
      race: p.race,
      gender: p.gender,
      age: p.age,
      role: p.role,
      powerRank: p.powerRank,
      status: p.status,
      action: p.action,
      durationMs,
      loop: spec.loop,
      frameIndex: p.frameIndex,
      kingdom: {
        id: p.kingdom.id,
        name: p.kingdom.name,
        primaryHex: p.kingdom.primaryHex,
        secondaryHex: p.kingdom.secondaryHex,
      },
      skin: { id: p.skin.id, name: p.skin.name },
      hair: { id: p.hair.id, name: p.hair.name },
      anchors: p.anchors,
      zones: {
        k1: unit.audit.k1ZonePixels,
        k2: unit.audit.k2ZonePixels,
        skin: unit.audit.skinZonePixels,
        hair: unit.audit.hairZonePixels,
      },
      audit: {
        uniqueColors: unit.audit.uniqueColors,
        opaquePixels: unit.audit.opaquePixels,
        orphanPixels: unit.audit.orphanPixels,
      },
    });
  }

  const manifest: ProceduralAtlasManifest = {
    version: '1.1.0',
    generator: 'Kostyanaya Kuznya Procedural Unit & Phenotype Forge',
    tileSize: { width: 10, height: 10 },
    atlasStats: atlas.getStats(),
    summary: {
      totalFrames: frames.length,
      eras: Array.from(eraSeen),
      races: Array.from(raceSeen),
      maxColorsObserved,
      totalOrphanPixels,
    },
    frames,
    animations,
  };

  return {
    atlas,
    units,
    manifest,
    jsonString: JSON.stringify(manifest, null, 2),
  };
}

/**
 * Renders a crisp scaled grid sprite sheet of any `PackedProceduralAtlasBundle`
 * onto a target HTMLCanvasElement (useful for live preview & browser PNG export).
 */
export function drawPackedBatchToCanvas(
  canvas: HTMLCanvasElement,
  units: readonly GeneratedHumanResult[],
  scale = 4,
  cols = 12
): void {
  const safeCols = Math.max(1, cols);
  const rows = Math.max(1, Math.ceil(units.length / safeCols));
  const cellW = 12 * scale;
  const cellH = 12 * scale;
  canvas.width = safeCols * cellW;
  canvas.height = rows * cellH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;

  units.forEach((u, idx) => {
    const col = idx % safeCols;
    const row = Math.floor(idx / safeCols);
    const ox = col * cellW + scale;
    const oy = row * cellH + scale;
    for (let y = 0; y < u.buffer.height; y++) {
      for (let x = 0; x < u.buffer.width; x++) {
        const c = u.buffer.getPixel(x, y);
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
    }
  });
}

export function triggerJsonDownload(jsonString: string, filename: string): void {
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function triggerPackedBatchPngDownload(
  units: readonly GeneratedHumanResult[],
  filename: string,
  scale = 4,
  cols = 12
): void {
  const canvas = document.createElement('canvas');
  drawPackedBatchToCanvas(canvas, units, scale, cols);
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
