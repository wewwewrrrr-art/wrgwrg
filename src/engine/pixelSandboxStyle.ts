import { INK, RAMPS, WATER_LINE, hexToRgba, rgbToHex } from './palette';
import { PixelBuffer } from './pixelCanvas';

export interface PixelSandboxSpriteOptions {
  isAquatic?: boolean;
  isWeather?: boolean;
}

const UPPER_INK = INK.toUpperCase();
const DARK_OUTLINE_SET = new Set<string>([UPPER_INK, '#14121D', '#111015']);
const WATER_STRIP_HEXES = new Set<string>([
  WATER_LINE.light.toUpperCase(),
  WATER_LINE.mid.toUpperCase(),
  RAMPS.ice.mid.toUpperCase(),
]);

function isSolidAquaticBodyPixel(hex: string | null): boolean {
  if (!hex) return false;
  const [, , , a] = hexToRgba(hex);
  if (a < 210) return false;
  if (WATER_STRIP_HEXES.has(hex.toUpperCase())) return false;
  return true;
}

/**
 * Converts a PixelBuffer into clean borderless material-shaded sprite style:
 * 1. Strips baked water-box rectangles (#0C355477) and stray horizontal water lines
 *    from aquatic creatures while keeping foam/splash pixels touching the body.
 * 2. Replaces any legacy dark outline pixels (#131110 / #14121D) with
 *    hue-shifted material highlights or shadow tones of the adjacent surface.
 */
export function toPixelSandboxSprite(
  src: PixelBuffer,
  opts: PixelSandboxSpriteOptions = {}
): PixelBuffer {
  const { width, height } = src;
  const cleaned = new PixelBuffer(width, height);

  // Pass 1: Strip semi-transparent shadow/water-box rects and detached wave bars
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const hex = src.getPixel(x, y);
      if (!hex) continue;
      const [, , , a] = hexToRgba(hex);

      if (opts.isWeather) {
        cleaned.setPixel(x, y, hex);
        continue;
      }

      if (a < 185) {
        continue;
      }

      if (opts.isAquatic && WATER_STRIP_HEXES.has(hex.toUpperCase())) {
        let nearBody = false;
        for (let dy = -2; dy <= 2 && !nearBody; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (isSolidAquaticBodyPixel(src.getPixel(x + dx, y + dy))) {
              nearBody = true;
              break;
            }
          }
        }
        if (!nearBody) continue;
      }

      cleaned.setPixel(x, y, hex);
    }
  }

  if (opts.isWeather) {
    return cleaned;
  }

  // Pass 2: Replace any dark border/outline pixels with self-material cel-shading
  const out = cleaned.clone();
  const cardinals: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const diagonals: [number, number][] = [
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const hex = cleaned.getPixel(x, y);
      if (!hex || !DARK_OUTLINE_SET.has(hex.toUpperCase())) continue;

      const cardinalSolid: string[] = [];
      let emptyCardinals = 0;
      let brightNeighborCount = 0;

      for (const [dx, dy] of cardinals) {
        const nb = cleaned.getPixel(x + dx, y + dy);
        if (!nb) {
          emptyCardinals++;
        } else if (!DARK_OUTLINE_SET.has(nb.toUpperCase())) {
          cardinalSolid.push(nb);
          const [nr, ng, nbCh] = hexToRgba(nb);
          if (nr + ng + nbCh > 560) brightNeighborCount++;
        }
      }

      // Remove stray diagonal-only corner pixels
      if (cardinalSolid.length === 0) {
        let diagCount = 0;
        for (const [dx, dy] of diagonals) {
          const nb = cleaned.getPixel(x + dx, y + dy);
          if (nb && !DARK_OUTLINE_SET.has(nb.toUpperCase())) diagCount++;
        }
        if (diagCount <= 1) {
          out.setPixel(x, y, null);
          continue;
        }
      }

      // Preserve crisp 1-2px eye pupils / doorway recesses inside bright sclera/stone
      if (emptyCardinals === 0 && brightNeighborCount >= 2 && cardinalSolid.length >= 3) {
        out.setPixel(x, y, '#2B2430');
        continue;
      }

      let sampleHex = cardinalSolid[0];
      if (!sampleHex) {
        for (const [dx, dy] of diagonals) {
          const nb = cleaned.getPixel(x + dx, y + dy);
          if (nb && !DARK_OUTLINE_SET.has(nb.toUpperCase())) {
            sampleHex = nb;
            break;
          }
        }
      }
      if (!sampleHex) {
        out.setPixel(x, y, null);
        continue;
      }

      const [r, g, b] = hexToRgba(sampleHex);
      const isTopOrLeftExposed =
        cleaned.getPixel(x - 1, y) === null || cleaned.getPixel(x, y - 1) === null;
      const isBottomOrRightExposed =
        cleaned.getPixel(x + 1, y) === null || cleaned.getPixel(x, y + 1) === null;
      const isExterior = emptyCardinals > 0;
      const isGreenFoliage = g > r + 14 && g > b + 14;

      if (isExterior && isTopOrLeftExposed && !isBottomOrRightExposed) {
        const liftR = isGreenFoliage ? r * 0.92 + 6 : Math.min(255, r * 0.92 + 10);
        const liftG = isGreenFoliage ? Math.min(255, g * 0.96 + 8) : Math.min(255, g * 0.9 + 8);
        const liftB = isGreenFoliage ? r * 0.65 + 4 : b * 0.86;
        out.setPixel(x, y, rgbToHex(liftR, liftG, liftB));
      } else if (isExterior) {
        const k = isGreenFoliage ? 0.68 : 0.66;
        out.setPixel(
          x,
          y,
          rgbToHex(
            Math.max(36, r * k),
            Math.max(40, g * (isGreenFoliage ? 0.76 : k)),
            Math.max(36, b * (k + 0.04))
          )
        );
      } else {
        const k = isGreenFoliage ? 0.64 : 0.6;
        out.setPixel(
          x,
          y,
          rgbToHex(Math.max(34, r * k), Math.max(36, g * k), Math.max(34, b * (k + 0.03)))
        );
      }
    }
  }

  return out;
}

export interface PixelSandboxShadowResult {
  buffer: PixelBuffer;
  offsetX: number;
  offsetY: number;
}

/**
 * Generates a crisp 1-tone diagonal bottom-right cast shadow on the ground plane
 * from top-left (-1, -1) sun illumination.
 */
export function buildPixelSandboxCastShadow(
  fg: PixelBuffer,
  shadowHex = '#1024064A',
  padRight = 24,
  padBottom = 14
): PixelSandboxShadowResult {
  let maxY = -1;
  const coords: [number, number][] = [];
  for (let y = 0; y < fg.height; y++) {
    for (let x = 0; x < fg.width; x++) {
      const c = fg.getPixel(x, y);
      if (!c) continue;
      const [, , , a] = hexToRgba(c);
      if (a < 185) continue;
      coords.push([x, y]);
      if (y > maxY) maxY = y;
    }
  }

  const outW = fg.width + padRight;
  const outH = fg.height + padBottom;
  const shadowBuf = new PixelBuffer(outW, outH);
  if (coords.length < 4 || maxY < 1) {
    return { buffer: shadowBuf, offsetX: 0, offsetY: 0 };
  }

  for (let i = 0; i < coords.length; i++) {
    const [x, y] = coords[i];
    const h = Math.max(0, maxY - y);
    const sx = Math.round(x + h * 0.44 + 2);
    const sy = Math.round(maxY - 2 + h * 0.14);
    shadowBuf.setPixel(sx, sy, shadowHex);
    shadowBuf.setPixel(sx + 1, sy, shadowHex);
    if (h > 2) {
      shadowBuf.setPixel(sx, sy + 1, shadowHex);
    }
  }

  return { buffer: shadowBuf, offsetX: 0, offsetY: 0 };
}
