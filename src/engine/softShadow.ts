import { StageBg } from '../models/types';
import { hexToRgba } from './palette';
import { PixelBuffer } from './pixelCanvas';

/**
 * ============================================================================
 * SHAPE-BASED, STAGE-ADAPTIVE SOFT SHADOW ENGINE
 * ============================================================================
 * Eliminates flat, hard-edged dark oval stamps (`#11102B66`) that appear as
 * dirty black smudges on terrain and dark cards.
 *
 * Instead, ground shadows are synthesized dynamically from each frame's actual
 * opaque foreground silhouette along top-left (-1, -1) key light:
 *   1. Contact ambient occlusion anchored beneath real ground-touching pixels
 *   2. Directional ground-plane projection (skewed right-back, foreshortened)
 *   3. Multi-pass separable Gaussian blur creating natural umbra -> penumbra falloff
 *   4. Canvas-perimeter edge fade so shadows never clip into box edges
 *   5. Stage-aware color temperature & contrast (`STAGE_SHADOW_THEMES`)
 *   6. Strictly composited UNDER foreground pixels (`compositeUnder`)
 * ============================================================================
 */

export interface StageShadowTheme {
  readonly id: StageBg;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly minAlpha: number;
  readonly maxAlpha: number;
  readonly gain: number;
}

export const STAGE_SHADOW_THEMES: Record<StageBg, StageShadowTheme> = {
  parchment: {
    id: 'parchment',
    // Warm sun-baked sepia umber harmonizing with sunlit #D6CBB3 ground
    r: 68,
    g: 51,
    b: 32,
    minAlpha: 0.05,
    maxAlpha: 0.34,
    gain: 0.34,
  },
  meadow: {
    id: 'meadow',
    // Deep forest moss shadow harmonizing with sunlit #354D32 turf
    r: 13,
    g: 28,
    b: 16,
    minAlpha: 0.05,
    maxAlpha: 0.4,
    gain: 0.36,
  },
  ocean: {
    id: 'ocean',
    // Abyssal slate-teal drop-off over #0E2B42 water
    r: 3,
    g: 13,
    b: 25,
    minAlpha: 0.04,
    maxAlpha: 0.28,
    gain: 0.3,
  },
  checker: {
    id: 'checker',
    // Clean neutral slate-charcoal over transparent checkerboard
    r: 6,
    g: 7,
    b: 11,
    minAlpha: 0.05,
    maxAlpha: 0.35,
    gain: 0.33,
  },
  dark: {
    id: 'dark',
    // Ultra-soft ambient ground contact occlusion over #1B1B20 dark cards
    r: 4,
    g: 4,
    b: 8,
    minAlpha: 0.04,
    maxAlpha: 0.3,
    gain: 0.3,
  },
};

export interface SoftShadowOptions {
  stageBg?: StageBg;
  /** Optional ground anchor Y (e.g. unit pivot.y + 1 so jump frames stay grounded) */
  groundY?: number;
  /** True for compact humanoid/creature sprites (tighter projection skew) */
  isCompactUnit?: boolean;
}

const GAUSS_KERNEL_5 = [0.0625, 0.25, 0.375, 0.25, 0.0625] as const;

function blurFieldSeparable(
  src: Float32Array,
  width: number,
  height: number,
  passes: number
): Float32Array {
  let current = new Float32Array(src);
  const temp = new Float32Array(width * height);

  for (let p = 0; p < passes; p++) {
    // Horizontal pass
    for (let y = 0; y < height; y++) {
      const rowOff = y * width;
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = -2; k <= 2; k++) {
          const sx = Math.max(0, Math.min(width - 1, x + k));
          sum += current[rowOff + sx] * GAUSS_KERNEL_5[k + 2];
        }
        temp[rowOff + x] = sum;
      }
    }
    // Vertical pass
    for (let y = 0; y < height; y++) {
      const rowOff = y * width;
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = -2; k <= 2; k++) {
          const sy = Math.max(0, Math.min(height - 1, y + k));
          sum += temp[sy * width + x] * GAUSS_KERNEL_5[k + 2];
        }
        current[rowOff + x] = sum;
      }
    }
  }

  return current;
}

function splatBilinear(
  field: Float32Array,
  width: number,
  height: number,
  fx: number,
  fy: number,
  weight: number
): void {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;

  const samples: [number, number, number][] = [
    [x0, y0, (1 - tx) * (1 - ty)],
    [x0 + 1, y0, tx * (1 - ty)],
    [x0, y0 + 1, (1 - tx) * ty],
    [x0 + 1, y0 + 1, tx * ty],
  ];

  for (const [sx, sy, frac] of samples) {
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
    field[sy * width + sx] += weight * frac;
  }
}

function formatShadowRgba(r: number, g: number, b: number, alpha: number): string {
  const hex2 = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  const aByte = Math.max(1, Math.min(255, Math.round(alpha * 255)));
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${hex2(aByte)}`;
}

/**
 * Checks whether a hex color belongs to any soft stage shadow palette
 * (used by outline & telemetry invariants).
 */
export function isSoftShadowPixel(hex: string): boolean {
  const [r, g, b, a] = hexToRgba(hex);
  if (a >= 140) return false;
  for (const theme of Object.values(STAGE_SHADOW_THEMES)) {
    if (r === theme.r && g === theme.g && b === theme.b) {
      return true;
    }
  }
  return false;
}

/**
 * Generates a pure shape-based soft shadow layer from `fg`'s actual opaque
 * silhouette pixels, calibrated for the active `stageBg`.
 */
export function generateShapeBasedSoftShadow(
  fg: PixelBuffer,
  opts: SoftShadowOptions = {}
): PixelBuffer {
  const { width, height } = fg;
  const stageBg: StageBg = opts.stageBg ?? 'dark';
  const theme = STAGE_SHADOW_THEMES[stageBg] ?? STAGE_SHADOW_THEMES.dark;

  const colMaxY = new Int16Array(width).fill(-1);
  const solidCoords: [number, number][] = [];
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = fg.getPixel(x, y);
      if (!c) continue;
      const [, , , a] = hexToRgba(c);
      if (a < 140) continue; // Faint aura/sparks do not cast hard ground shadows
      solidCoords.push([x, y]);
      if (y > colMaxY[x]) colMaxY[x] = y;
      if (y > maxY) maxY = y;
    }
  }

  const shadowBuf = new PixelBuffer(width, height);
  if (solidCoords.length < 4 || maxY < 1) {
    return shadowBuf;
  }

  // Clamp groundY so at least 1px below ground remains for soft contact penumbra
  const rawGroundY = opts.groundY !== undefined ? opts.groundY : maxY;
  const groundY = Math.max(2, Math.min(height - 2, rawGroundY));

  const isCompact = opts.isCompactUnit ?? (width <= 42 && height <= 42);
  const skewX = isCompact ? 0.16 : 0.21;
  const liftY = isCompact ? 0.06 : 0.08;

  const field = new Float32Array(width * height);

  // 1. Project foreground silhouette onto 3/4 ground plane (away from -1, -1 light)
  for (let i = 0; i < solidCoords.length; i++) {
    const [x, y] = solidCoords[i];
    const h = Math.max(0, groundY - y);
    const gx = x + h * skewX;
    const gy = groundY - h * liftY + 0.55;
    const castWeight = 0.58 / (1 + h * 0.04);
    splatBilinear(field, width, height, gx, gy, castWeight);
  }

  // 2. Ground contact ambient occlusion directly beneath real bottom footprint pixels
  for (let x = 0; x < width; x++) {
    const bot = colMaxY[x];
    if (bot < 0) continue;
    const distAboveGround = Math.max(0, groundY - bot);
    if (distAboveGround <= 4) {
      const contactWeight = 1.05 * (1 - distAboveGround / 5.5);
      const cy = Math.min(height - 1.5, bot + 0.85);
      splatBilinear(field, width, height, x + 0.35, cy, contactWeight);
      splatBilinear(field, width, height, x + 0.65, Math.min(height - 1.2, cy + 0.5), contactWeight * 0.65);
    }
  }

  // 3. Multi-pass separable Gaussian blur for silky umbra -> penumbra falloff
  const blurPasses = width >= 44 ? 2 : 1;
  const blurred = blurFieldSeparable(field, width, height, blurPasses);

  // 4. Exponential saturation + canvas-border edge vignette + 7-stop alpha ramp
  const stops = 7;
  for (let y = 0; y < height; y++) {
    const edgeDistY = Math.min(y, height - 1 - y);
    const edgeAttenY = edgeDistY === 0 ? 0.25 : edgeDistY === 1 ? 0.68 : 1.0;

    for (let x = 0; x < width; x++) {
      const val = blurred[y * width + x];
      if (val <= 0.02) continue;

      const edgeDistX = Math.min(x, width - 1 - x);
      const edgeAttenX = edgeDistX === 0 ? 0.25 : edgeDistX === 1 ? 0.68 : 1.0;

      const saturated = (1 - Math.exp(-val * theme.gain)) * edgeAttenX * edgeAttenY;
      if (saturated < 0.09) continue;

      const norm = Math.min(1, (saturated - 0.09) / 0.91);
      const curved = Math.pow(norm, 0.9);
      const quantized = Math.max(1, Math.round(curved * stops)) / stops;
      const alpha = theme.minAlpha + quantized * (theme.maxAlpha - theme.minAlpha);

      shadowBuf.setPixel(x, y, formatShadowRgba(theme.r, theme.g, theme.b, alpha));
    }
  }

  return shadowBuf;
}

/**
 * Returns a fresh PixelBuffer with a shape-based, `stageBg`-adaptive soft shadow
 * composited strictly underneath `fg`'s transparent cells.
 */
export function applySoftGroundShadow(
  fg: PixelBuffer,
  opts: SoftShadowOptions = {}
): PixelBuffer {
  const out = fg.clone();
  const shadowBuf = generateShapeBasedSoftShadow(fg, opts);
  out.compositeUnder(shadowBuf);
  return out;
}
