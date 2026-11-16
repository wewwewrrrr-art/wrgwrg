import type { BuildingState, PixelModelDef, StageBg } from '../models/types';
import { applyBuildingState } from './buildingStates';
import { INK, K1_MASK, K2_MASK, RAMPS } from './palette';
import { PixelBuffer } from './pixelCanvas';
import { recolorSpriteWithLabKingdom } from './proceduralBuildingsAndAnimals';
import { KINGDOM_PALETTES_84, KingdomPaletteDef } from './proceduralPalettes';
import { applySoftGroundShadow } from './softShadow';

/**
 * ============================================================================
 * BUILDING ANIMATIONS ENGINE (SMOKE, HEARTH/FORGE FIRE, FLAGS, BURNING)
 * ============================================================================
 * Enhances both animated (6-12f) and static (1f) buildings with deterministic
 * 4-frame environmental animations:
 *  - Rising chimney smoke (100% opaque stepped pixel puffs)
 *  - Hearth / forge / brazier fire flicker
 *  - Kingdom-colored waving flags (K1 primary / K2 trim, 4 frames)
 *  - Burning building disaster state (`burning: true`: roaring flames, embers & smoke)
 *
 * Strictly zero `#131110` INK and zero semitransparent pixels in smoke/fire/flags.
 * ============================================================================
 */

export interface BuildingAnimationSpec {
  readonly frameCount: 4;
  readonly frameDurationsMs: readonly number[];
  readonly loop: true;
}

export const BUILDING_ANIMATION_SPEC: BuildingAnimationSpec = {
  frameCount: 4,
  frameDurationsMs: [180, 170, 180, 170],
  loop: true,
};

const SMOKE_OPAQUE = {
  light: '#D4DCE6',
  mid: '#98A2B0',
  dark: '#6B7380',
  soot: '#4B525E',
} as const;

const FIRE_OPAQUE = {
  core: '#FFF3B0',
  gold: '#FACC15',
  mid: '#F97316',
  deep: '#DC2626',
  ember: '#991B1B',
} as const;

function measureBounds(buf: PixelBuffer): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  topPeakX: number;
  count: number;
} {
  let minX = buf.width;
  let maxX = -1;
  let minY = buf.height;
  let maxY = -1;
  let topPeakX = Math.floor(buf.width / 2);
  let count = 0;

  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      if (buf.getPixel(x, y) !== null) {
        if (y < minY) {
          minY = y;
          topPeakX = x;
        }
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        count++;
      }
    }
  }
  return { minX, maxX, minY, maxY, topPeakX, count };
}

function drawOpaqueSmokePuff(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  frame: number,
  darkMode = false
): void {
  const f = ((frame % 4) + 4) % 4;
  const tones = darkMode
    ? [SMOKE_OPAQUE.mid, SMOKE_OPAQUE.dark, SMOKE_OPAQUE.soot]
    : [SMOKE_OPAQUE.light, SMOKE_OPAQUE.mid, SMOKE_OPAQUE.dark];

  for (let i = 0; i < 3; i++) {
    const step = (f + i) % 4;
    const px = cx + (step === 1 ? -1 : step === 3 ? 1 : 0);
    const py = Math.max(1, cy - step * 2 - i);
    const tone = tones[Math.min(tones.length - 1, Math.floor((step + i) / 2))];
    buf.setPixel(px, py, tone);
    if (step < 3 && px + 1 < buf.width - 1) {
      buf.setPixel(px + 1, py, tones[Math.min(tones.length - 1, tone === tones[0] ? 1 : 2)]);
    }
    if (step === 0 && py > 1) {
      buf.setPixel(px, py - 1, tones[0]);
    }
  }
}

function drawOpaqueFireCluster(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  frame: number,
  scale = 1
): void {
  const f = ((frame % 4) + 4) % 4;
  const sway = f === 1 ? -1 : f === 3 ? 1 : 0;
  const tall = f === 0 || f === 2 ? 1 : 0;

  // Base ember bed
  buf.setPixel(cx - 1, cy, FIRE_OPAQUE.deep);
  buf.setPixel(cx, cy, FIRE_OPAQUE.mid);
  buf.setPixel(cx + 1, cy, FIRE_OPAQUE.deep);

  // Inner bright flame
  buf.setPixel(cx, Math.max(1, cy - 1), FIRE_OPAQUE.gold);
  buf.setPixel(cx + sway, Math.max(1, cy - 1), FIRE_OPAQUE.core);
  if (scale >= 1) {
    buf.setPixel(cx + sway, Math.max(1, cy - 2 - tall), FIRE_OPAQUE.gold);
    buf.setPixel(cx - sway, Math.max(1, cy - 2), FIRE_OPAQUE.mid);
  }
  if (scale >= 2) {
    buf.setPixel(cx - 1, Math.max(1, cy - 1), FIRE_OPAQUE.mid);
    buf.setPixel(cx + 1, Math.max(1, cy - 1), FIRE_OPAQUE.mid);
    buf.setPixel(cx + sway, Math.max(1, cy - 3 - tall), FIRE_OPAQUE.mid);
    // Floating pixel spark
    const sx = Math.max(1, Math.min(buf.width - 2, cx + (f - 1)));
    const sy = Math.max(1, cy - 4 - (f % 2));
    buf.setPixel(sx, sy, FIRE_OPAQUE.gold);
  }
}

function drawWavingKingdomFlag(
  buf: PixelBuffer,
  poleX: number,
  topY: number,
  frame: number,
  k1: readonly [string, string, string, string],
  k2: readonly [string, string, string, string]
): void {
  const f = ((frame % 4) + 4) % 4;
  const px = Math.max(2, Math.min(buf.width - 8, poleX));
  const py = Math.max(2, topY);
  // Gold finial & timber staff
  buf.setPixel(px, py - 1, RAMPS.gold.highlight);
  for (let y = py; y <= Math.min(buf.height - 2, py + 7); y++) {
    buf.setPixel(px, y, RAMPS.timber.mid);
  }
  // 5px-wide K1/K2 pennant waving smoothly across frames 0..3
  for (let dx = 1; dx <= 5; dx++) {
    const wave =
      dx <= 2
        ? f === 2 ? -1 : 0
        : dx <= 4
          ? f === 1 ? -1 : f === 3 ? 1 : 0
          : f === 0 ? 1 : f === 2 ? -1 : 0;
    const fy0 = Math.max(1, py + wave);
    const fy1 = Math.min(buf.height - 2, py + 1 + wave);
    buf.setPixel(px + dx, fy0, dx <= 2 ? k1[0] : k1[1]);
    if (dx <= 4) {
      buf.setPixel(px + dx, fy1, dx === 2 || dx === 3 ? k2[0] : k1[2]);
    }
  }
}

/**
 * Adds crisp, 100% opaque 4-frame animations onto any building sprite:
 * - Waving K1/K2 kingdom flag (especially on static `frameCount === 1` structures)
 * - Rising chimney smoke + hearth/forge fire flicker
 * - Full `burning` state overlay (flames across eaves/roof, sparks & dark smoke plumes)
 */
export function applyBuildingEnvironmentalEffects(
  source: PixelBuffer,
  model: PixelModelDef,
  state: BuildingState,
  frameIndex: number,
  options?: {
    burning?: boolean;
  }
): PixelBuffer {
  const f = ((Math.floor(frameIndex) % 4) + 4) % 4;
  const out = source.clone();
  const bounds = measureBounds(out);
  if (bounds.count === 0) return out;

  const spanW = Math.max(8, bounds.maxX - bounds.minX + 1);
  const spanH = Math.max(8, bounds.maxY - bounds.minY + 1);
  const midX = Math.round((bounds.minX + bounds.maxX) / 2);

  if (state === 'ready' && !options?.burning) {
    // 1. Static structures (`frameCount === 1`) or keeps gain a crisp animated K1/K2 flag + smoke/hearth
    if (model.frameCount === 1) {
      const flagX = Math.max(bounds.minX + 3, Math.min(bounds.maxX - 7, bounds.topPeakX + 2));
      const flagY = Math.max(3, bounds.minY + 1);
      drawWavingKingdomFlag(out, flagX, flagY, f, K1_MASK, K2_MASK);

      // Chimney smoke plume on offset side of roof
      const chimneyX =
        bounds.topPeakX > midX
          ? Math.max(bounds.minX + 4, midX - Math.round(spanW * 0.24))
          : Math.min(bounds.maxX - 4, midX + Math.round(spanW * 0.24));
      const chimneyY = Math.max(4, bounds.minY + Math.round(spanH * 0.24));
      drawOpaqueSmokePuff(out, chimneyX, chimneyY, f, false);

      // Hearth / forge brazier flame near lower entrance or smithy side
      const hearthX = Math.max(bounds.minX + 4, midX - Math.round(spanW * 0.22));
      const hearthY = Math.min(bounds.maxY - 3, bounds.minY + Math.round(spanH * 0.78));
      drawOpaqueFireCluster(out, hearthX, hearthY, f, 1);
    } else {
      // Multi-frame race/era buildings still receive a crisp animated hearth ember boost on forge/smithies/halls
      const isForgeOrHall =
        model.id.includes('forge') ||
        model.id.includes('smithy') ||
        model.id.includes('kiln') ||
        model.id.includes('smelter') ||
        model.id.includes('hall') ||
        model.id.includes('hut') ||
        model.id.includes('longhouse');
      if (isForgeOrHall) {
        const hearthX = Math.max(bounds.minX + 4, midX + Math.round(spanW * 0.2));
        const hearthY = Math.min(bounds.maxY - 3, bounds.minY + Math.round(spanH * 0.76));
        drawOpaqueFireCluster(out, hearthX, hearthY, f, 1);
      }
    }
  }

  if (options?.burning) {
    // Roaring 4-frame burning building state: multi-point fire plumes + embers + dark ash smoke
    const fireSpots: readonly [number, number, number][] = [
      [Math.max(bounds.minX + 3, midX - Math.round(spanW * 0.26)), Math.max(4, bounds.minY + Math.round(spanH * 0.36)), 2],
      [midX, Math.max(4, bounds.minY + Math.round(spanH * 0.25)), 2],
      [Math.min(bounds.maxX - 3, midX + Math.round(spanW * 0.25)), Math.max(4, bounds.minY + Math.round(spanH * 0.44)), 1],
      [Math.max(bounds.minX + 4, midX - Math.round(spanW * 0.14)), Math.min(bounds.maxY - 3, bounds.minY + Math.round(spanH * 0.72)), 1],
    ];
    for (let i = 0; i < fireSpots.length; i++) {
      const [fx, fy, sc] = fireSpots[i];
      drawOpaqueFireCluster(out, fx, fy, (f + i) % 4, sc);
    }
    // Thick rising opaque dark smoke clouds above burning roof
    drawOpaqueSmokePuff(out, midX - 2, Math.max(3, bounds.minY + 3), f, true);
    drawOpaqueSmokePuff(out, midX + 3, Math.max(3, bounds.minY + 5), (f + 2) % 4, true);
  }

  return out;
}

export interface AnimatedBuildingFrameResult {
  readonly modelId: string;
  readonly modelName: string;
  readonly kingdom: KingdomPaletteDef | null;
  readonly state: BuildingState;
  readonly burning: boolean;
  readonly frameIndex: number;
  readonly frameCount: 4;
  readonly frameDurationsMs: readonly number[];
  readonly buffer: PixelBuffer;
  readonly width: number;
  readonly height: number;
  readonly inkPixels: number;
  readonly semitransparentPixels: number;
}

export function renderAnimatedBuildingFrame(
  model: PixelModelDef,
  kingdom: number | string | KingdomPaletteDef = 0,
  state: BuildingState = 'ready',
  frameIndex = 0,
  options?: {
    burning?: boolean;
    stageBg?: StageBg;
    showShadow?: boolean;
  }
): AnimatedBuildingFrameResult {
  const animFrame = ((Math.floor(frameIndex) % 4) + 4) % 4;
  const modelFrame = animFrame % Math.max(1, model.frameCount);
  const stageBg = options?.stageBg ?? 'dark';

  const resolvedKingdom: KingdomPaletteDef | null =
    kingdom === 'original'
      ? null
      : typeof kingdom === 'object'
        ? kingdom
        : typeof kingdom === 'number'
          ? KINGDOM_PALETTES_84[
              ((Math.floor(kingdom) % KINGDOM_PALETTES_84.length) + KINGDOM_PALETTES_84.length) %
                KINGDOM_PALETTES_84.length
            ]
          : KINGDOM_PALETTES_84[0];

  const effectiveState: BuildingState =
    options?.burning && state === 'ready' ? 'damaged' : state;

  let base = model.renderFrame(modelFrame, Math.max(1, model.frameCount), {
    kingdomId: 'original',
    buildingState: effectiveState,
    showShadow: false,
    stageBg,
  });
  if (effectiveState !== 'ready' && !model.supportsBuildingStates) {
    base = applyBuildingState(base, effectiveState, animFrame, 4);
  }

  const withEffects = applyBuildingEnvironmentalEffects(base, model, state, animFrame, {
    burning: options?.burning,
  });
  const recolored = resolvedKingdom
    ? recolorSpriteWithLabKingdom(withEffects, resolvedKingdom)
    : withEffects;

  // Optionally keep soft ground shadow (note: softShadow uses translucent indigo under feet on dark/meadow)
  const finalBuf =
    options?.showShadow !== false && model.supportsShadow !== false
      ? applySoftGroundShadow(recolored, { stageBg, isCompactUnit: false })
      : recolored;

  const inkUpper = INK.toUpperCase();
  let inkPixels = 0;
  let semitransparentPixels = 0;
  for (let y = 0; y < finalBuf.height; y++) {
    for (let x = 0; x < finalBuf.width; x++) {
      const px = finalBuf.getPixel(x, y);
      if (!px) continue;
      if (px === inkUpper) inkPixels++;
      if (px.length === 9) {
        const a = parseInt(px.slice(7, 9), 16);
        if (a > 0 && a < 255) semitransparentPixels++;
      }
    }
  }

  return {
    modelId: model.id,
    modelName: model.name,
    kingdom: resolvedKingdom,
    state,
    burning: Boolean(options?.burning),
    frameIndex: animFrame,
    frameCount: 4,
    frameDurationsMs: BUILDING_ANIMATION_SPEC.frameDurationsMs,
    buffer: finalBuf,
    width: finalBuf.width,
    height: finalBuf.height,
    inkPixels,
    semitransparentPixels,
  };
}
