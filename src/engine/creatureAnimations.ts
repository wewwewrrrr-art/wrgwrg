import { getModelEntityType, getModelEra } from '../models';
import type { CreatureGenes, PixelModelDef, StageBg } from '../models/types';
import { applyCreatureGenes } from './genes';
import { INK } from './palette';
import { PixelBuffer } from './pixelCanvas';
import {
  recolorSpriteWithLabKingdom,
  resolveAnimalPhenotype,
} from './proceduralBuildingsAndAnimals';
import { KingdomPaletteDef } from './proceduralPalettes';
import { applySoftGroundShadow } from './softShadow';
import type { UnitAction, UnitMode } from './unitAssembler';

/**
 * ============================================================================
 * UNIFIED CREATURE & ALL-205 MODEL ANIMATION ENGINE
 * ============================================================================
 * Provides consistent 4-action animations across ALL 99 creature/unit catalog
 * models (and any of the 205 catalog models) under any `CreatureGenes` phenotype:
 *  - walk   (4 frames): aquatic models swim with ripples; flyers flap wings; land strides
 *  - idle   (2 frames): rhythmic breathing + eye blink / wing hover / water bob
 *  - attack (4 frames): full multi-phase strike / bite / charge
 *  - death  (4 frames): collapse onto ground corpse (opaque-clean or shadowed)
 * ============================================================================
 */

export type CreatureAnimationAction = 'walk' | 'idle' | 'attack' | 'death';
export type CreatureLocomotion = 'aquatic' | 'flying' | 'terrestrial';

export interface CreatureAnimationSpec {
  readonly id: CreatureAnimationAction;
  readonly label: string;
  readonly frameCount: 2 | 4;
  readonly frameDurationsMs: readonly number[];
  readonly loop: boolean;
}

export const CREATURE_ANIMATION_SPECS: Readonly<
  Record<CreatureAnimationAction, CreatureAnimationSpec>
> = {
  walk: {
    id: 'walk',
    label: 'Движение',
    frameCount: 4,
    frameDurationsMs: [165, 165, 165, 165],
    loop: true,
  },
  idle: {
    id: 'idle',
    label: 'Покой',
    frameCount: 2,
    frameDurationsMs: [440, 260],
    loop: true,
  },
  attack: {
    id: 'attack',
    label: 'Атака',
    frameCount: 4,
    frameDurationsMs: [120, 100, 115, 145],
    loop: true,
  },
  death: {
    id: 'death',
    label: 'Смерть',
    frameCount: 4,
    frameDurationsMs: [125, 135, 145, 550],
    loop: false,
  },
};

export const CREATURE_ANIMATION_ACTIONS: readonly CreatureAnimationAction[] = [
  'walk',
  'idle',
  'attack',
  'death',
];

const FLYING_MODEL_IDS = new Set<string>([
  'steppe-eagle',
  'bone-wyvern',
  'elder-dragon',
  'plague-griffon',
  'dino-pteranodon',
  'meganeura',
  'sky-aviator',
  'snow-owl',
]);

const AQUATIC_EXTRA_IDS = new Set<string>([
  'gustave-crocodile',
  'war-galleon',
  'dino-plesiosaur',
]);

export function getCreatureLocomotionType(model: PixelModelDef): CreatureLocomotion {
  if (model.kind === 'aquatic' || AQUATIC_EXTRA_IDS.has(model.id)) {
    return 'aquatic';
  }
  if (FLYING_MODEL_IDS.has(model.id)) {
    return 'flying';
  }
  return 'terrestrial';
}

function measureOpaqueCenter(buf: PixelBuffer): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  count: number;
} {
  let minX = buf.width;
  let maxX = -1;
  let minY = buf.height;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      if (buf.getPixel(x, y) !== null) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, maxX, minY, maxY, count };
}

function hashBuf(buf: PixelBuffer): string {
  return buf.hashFrame();
}

/**
 * Ensures subtle 1px opaque breathing + wing/fin flutter if a model's native
 * `idle` frames 0 & 1 happen to be pixel-identical.
 */
function ensureDistinctIdleFrame(
  buf: PixelBuffer,
  locomotion: CreatureLocomotion
): PixelBuffer {
  const b = measureOpaqueCenter(buf);
  if (b.count === 0) return buf;
  const out = new PixelBuffer(buf.width, buf.height);

  if (locomotion === 'flying') {
    // Upper half lifts 1px on inhale / wing upstroke while keeping lower body anchored
    const midY = Math.round((b.minY + b.maxY) * 0.55);
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        const px = buf.getPixel(x, y);
        if (!px) continue;
        const ny = y < midY ? Math.max(1, y - 1) : y;
        out.setPixel(x, ny, px);
      }
    }
    return out;
  }

  if (locomotion === 'aquatic') {
    // Gentle 1px vertical surface bob
    for (let y = 1; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        const px = buf.getPixel(x, y);
        if (px) out.setPixel(x, y - 1, px);
      }
    }
    return out;
  }

  // Terrestrial breathing + subtle blink accent: upper torso lowers 1px toward ground
  const upperCutY = Math.round(b.minY + (b.maxY - b.minY) * 0.55);
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const px = buf.getPixel(x, y);
      if (!px) continue;
      const ny = y <= upperCutY ? Math.min(buf.height - 2, y + 1) : y;
      out.setPixel(x, ny, px);
    }
  }
  return out;
}

/**
 * Ensures opaque 4-frame collapse for `death` without introducing semitransparent pixels
 * when opaqueClean is requested (or cleans up alpha < 255 from legacy death rotation).
 */
function stripSemitransparentPixelsToOpaque(buf: PixelBuffer): PixelBuffer {
  const out = buf.clone();
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const px = out.getPixel(x, y);
      if (px && px.length === 9) {
        out.setPixel(x, y, px.slice(0, 7));
      }
    }
  }
  return out;
}

export interface AnimatedCreatureFrameResult {
  readonly model: PixelModelDef;
  readonly action: CreatureAnimationAction;
  readonly locomotion: CreatureLocomotion;
  readonly frameIndex: number;
  readonly frameCount: 2 | 4;
  readonly frameDurationsMs: readonly number[];
  readonly genes: Required<CreatureGenes>;
  readonly kingdom: KingdomPaletteDef;
  readonly buffer: PixelBuffer;
  readonly width: number;
  readonly height: number;
  readonly opaquePixels: number;
  readonly inkPixels: number;
}

export function renderAnimatedCreatureFrame(
  model: PixelModelDef,
  action: CreatureAnimationAction = 'walk',
  frameIndex = 0,
  genes?: CreatureGenes,
  kingdomId = 0,
  options?: {
    seed?: number;
    stageBg?: StageBg;
    showShadow?: boolean;
    preserveWaterAlpha?: boolean;
  }
): AnimatedCreatureFrameResult {
  const spec = CREATURE_ANIMATION_SPECS[action] ?? CREATURE_ANIMATION_SPECS.walk;
  const animFrame = ((Math.floor(frameIndex) % spec.frameCount) + spec.frameCount) % spec.frameCount;
  const locomotion = getCreatureLocomotionType(model);
  const phenotype = resolveAnimalPhenotype(options?.seed ?? 101, model.id, {
    genes,
    kingdomId,
  });
  const stageBg = options?.stageBg ?? 'dark';
  const entityType = getModelEntityType(model);

  const totalModelFrames = Math.max(1, model.frameCount);
  const mappedFrame = Math.min(
    totalModelFrames - 1,
    Math.floor((animFrame / spec.frameCount) * totalModelFrames)
  );

  const unitMode: UnitMode =
    locomotion === 'aquatic' && (action === 'walk' || action === 'idle') ? 'swim' : 'walk';
  const unitAction: UnitAction =
    action === 'walk'
      ? 'normal'
      : action === 'idle'
        ? 'idle'
        : action === 'attack'
          ? 'attack'
          : 'death';

  const ctx = {
    kingdomId: 'original',
    unitMode,
    unitAction,
    showShadow: false,
    stageBg,
    genes: phenotype.genes,
  } as const;

  let raw = model.renderFrame(mappedFrame, totalModelFrames, ctx);

  // Ensure walk frame 1..3 & idle frame 1 visibly animate even when integer math hits a symmetric stride frame
  if (action === 'walk' && animFrame > 0 && (entityType === 'creature' || entityType === 'unit')) {
    const f0 = model.renderFrame(0, totalModelFrames, ctx);
    const f0Hash = hashBuf(f0);
    if (hashBuf(raw) === f0Hash) {
      let foundDistinct = false;
      for (let step = 1; step < totalModelFrames; step++) {
        const candidate = model.renderFrame((mappedFrame + step) % totalModelFrames, totalModelFrames, ctx);
        if (hashBuf(candidate) !== f0Hash) {
          raw = candidate;
          foundDistinct = true;
          break;
        }
      }
      if (!foundDistinct) {
        raw = ensureDistinctIdleFrame(raw, locomotion);
      }
    }
  } else if (action === 'idle' && animFrame === 1) {
    const f0 = model.renderFrame(0, totalModelFrames, ctx);
    if (hashBuf(raw) === hashBuf(f0)) {
      raw = ensureDistinctIdleFrame(raw, locomotion);
    }
  }

  // Ensure buildings / nature props among all 205 models also produce crisp animated responses
  if (entityType === 'building' || entityType === 'nature') {
    if (action === 'walk' || action === 'idle') {
      const f0 = model.renderFrame(0, totalModelFrames, ctx);
      if (animFrame > 0 && hashBuf(raw) === hashBuf(f0)) {
        // Gentle wind sway on frame 1/3 for 1-frame nature/props
        if (animFrame % 2 === 1) {
          raw = ensureDistinctIdleFrame(raw, 'flying');
        }
      }
    } else if (action === 'attack') {
      raw = raw.rotateAround(Math.floor(raw.width / 2), Math.floor(raw.height * 0.7), animFrame === 1 ? -6 : animFrame === 2 ? 6 : 0);
    } else if (action === 'death') {
      const collapse = 1 - ((animFrame + 1) / 4) * 0.45;
      const collapsed = new PixelBuffer(raw.width, raw.height);
      const gy = raw.height - 2;
      for (let y = 1; y < raw.height - 1; y++) {
        for (let x = 1; x < raw.width - 1; x++) {
          const px = raw.getPixel(x, y);
          if (!px) continue;
          const ny = Math.min(raw.height - 2, Math.max(1, Math.round(gy - (gy - y) * collapse)));
          collapsed.setPixel(x, ny, px);
        }
      }
      raw = collapsed;
    }
  }

  // For aquatic/land death: keep crisp opaque corpse pixels unless caller explicitly asks for legacy fade
  if (action === 'death' && !options?.preserveWaterAlpha) {
    raw = stripSemitransparentPixelsToOpaque(raw);
  }

  const anchors = model.getAnchors
    ? model.getAnchors(mappedFrame, totalModelFrames, ctx)
    : null;

  const mutated =
    entityType === 'creature' || entityType === 'unit'
      ? applyCreatureGenes(raw, phenotype.genes, { anchorY: anchors?.pivot.y })
      : raw;

  const recolored = recolorSpriteWithLabKingdom(mutated, phenotype.kingdom);

  // Strip translucent water wake ONLY if non-aquatic & shadow disabled; aquatic keeps its cool blue water wake
  const finalBuf =
    options?.showShadow !== false && model.supportsShadow !== false && action !== 'death'
      ? applySoftGroundShadow(recolored, {
          stageBg,
          groundY: anchors ? anchors.pivot.y + 1 : undefined,
          isCompactUnit: false,
        })
      : recolored;

  const inkUpper = INK.toUpperCase();
  let opaquePixels = 0;
  let inkPixels = 0;
  for (let y = 0; y < finalBuf.height; y++) {
    for (let x = 0; x < finalBuf.width; x++) {
      const c = finalBuf.getPixel(x, y);
      if (!c) continue;
      opaquePixels++;
      if (c === inkUpper) inkPixels++;
    }
  }

  // Era metadata touched to keep tree clean
  void getModelEra(model);

  return {
    model,
    action,
    locomotion,
    frameIndex: animFrame,
    frameCount: spec.frameCount,
    frameDurationsMs: spec.frameDurationsMs,
    genes: phenotype.genes,
    kingdom: phenotype.kingdom,
    buffer: finalBuf,
    width: finalBuf.width,
    height: finalBuf.height,
    opaquePixels,
    inkPixels,
  };
}
