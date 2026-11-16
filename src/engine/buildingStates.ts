import { RAMPS, VOID, hexToRgba, rgbToHex } from './palette';
import { PixelBuffer } from './pixelCanvas';
import { BuildingState } from '../models/types';

/**
 * Finds the bounding box of opaque pixels in a PixelBuffer so building-state
 * transforms (scaffolding, damage cracks, rubble ruins) adapt cleanly to any
 * structure's exact silhouette without clipping outside canvas margins.
 */
function measureOpaqueBounds(buf: PixelBuffer): {
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

function darkenHex(hex: string, factor: number): string {
  const [r, g, b, a] = hexToRgba(hex);
  const out = rgbToHex(
    Math.max(16, r * factor),
    Math.max(16, g * factor),
    Math.max(18, b * factor)
  );
  if (a < 255) {
    return `${out}${a.toString(16).padStart(2, '0').toUpperCase()}`;
  }
  return out;
}

/**
 * Transforms a rendered "ready" structure PixelBuffer cleanly into one of the
 * 4 canonical construction / destruction states:
 * - `constructing`: foundation & partial lower walls framed by timber scaffolding & ropes
 * - `ready`: pristine complete building
 * - `damaged`: chipped roof eaves, scorch marks, structural masonry cracks & smoke
 * - `ruins`: collapsed jagged wall stumps, fallen rubble piles & moss overgrowth
 *
 * Strictly borderless: uses 4-tone material shading with zero `#131110` black ink.
 */
export function applyBuildingState(
  source: PixelBuffer,
  state: BuildingState,
  frame = 0,
  _totalFrames = 1
): PixelBuffer {
  if (state === 'ready') return source;

  const bounds = measureOpaqueBounds(source);
  if (bounds.count === 0) return source;

  const spanH = Math.max(8, bounds.maxY - bounds.minY + 1);
  const spanW = Math.max(8, bounds.maxX - bounds.minX + 1);
  const midX = Math.round((bounds.minX + bounds.maxX) / 2);

  if (state === 'constructing') {
    const out = new PixelBuffer(source.width, source.height);
    // Keep foundation + lower ~48% of walls with stepped unfinished masonry edge
    const baseCutY = bounds.minY + Math.round(spanH * 0.52);

    for (let y = baseCutY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        const px = source.getPixel(x, y);
        if (!px) continue;
        // Stepped unfinished top course edge along cutY
        const stepOffset = ((Math.floor(x / 3) * 7) % 4) - 1;
        if (y < baseCutY + stepOffset + 2) continue;
        // Slightly pale raw construction stone/timber tone on upper rim
        if (y === baseCutY + stepOffset + 2) {
          out.setPixel(x, y, RAMPS.sandstone.highlight);
        } else {
          out.setPixel(x, y, px);
        }
      }
    }

    // Timber scaffolding poles & crossbars around construction site
    const leftPole = Math.max(2, bounds.minX + 1);
    const rightPole = Math.min(source.width - 4, bounds.maxX - 1);
    const topScaffoldY = Math.max(4, bounds.minY + Math.round(spanH * 0.24));
    const botScaffoldY = Math.min(source.height - 3, bounds.maxY);

    out.layer((sub) => {
      // Vertical timber posts
      sub.fillRect(leftPole, topScaffoldY, 2, botScaffoldY - topScaffoldY, RAMPS.timber.mid);
      sub.fillRect(leftPole, topScaffoldY, 1, botScaffoldY - topScaffoldY, RAMPS.timber.highlight);
      sub.fillRect(rightPole, topScaffoldY, 2, botScaffoldY - topScaffoldY, RAMPS.timber.shadow);
      sub.fillRect(rightPole + 1, topScaffoldY, 1, botScaffoldY - topScaffoldY, RAMPS.timber.deep);

      if (spanW >= 24) {
        sub.fillRect(midX, topScaffoldY + 3, 2, botScaffoldY - topScaffoldY - 4, RAMPS.timber.mid);
        sub.fillRect(midX, topScaffoldY + 3, 1, botScaffoldY - topScaffoldY - 4, RAMPS.timber.highlight);
      }

      // Upper and middle horizontal scaffolding catwalk planks
      const catwalkY1 = topScaffoldY + 4;
      const catwalkY2 = Math.min(botScaffoldY - 5, baseCutY + 2);
      for (const cy of [catwalkY1, catwalkY2]) {
        if (cy >= topScaffoldY && cy < botScaffoldY) {
          sub.fillRect(leftPole, cy, rightPole - leftPole + 2, 2, RAMPS.timber.mid);
          sub.fillRect(leftPole, cy, rightPole - leftPole, 1, RAMPS.timber.highlight);
        }
      }

      // Rope lashings (sandstone highlights) & diagonal bracing
      sub.drawLine(leftPole + 2, catwalkY1 + 2, midX, catwalkY2, RAMPS.timber.shadow);
      sub.drawLine(rightPole - 1, catwalkY1 + 2, midX + 1, catwalkY2, RAMPS.timber.deep);
      sub.fillRect(leftPole, catwalkY1, 2, 1, RAMPS.sandstone.highlight);
      sub.fillRect(rightPole, catwalkY1, 2, 1, RAMPS.sandstone.mid);

      // Stacked building supplies at base (cut stone & planks)
      const pileY = Math.max(4, botScaffoldY - 3);
      sub.fillRect(leftPole + 3, pileY, 5, 3, RAMPS.sandstone.mid);
      sub.fillRect(leftPole + 3, pileY, 4, 1, RAMPS.sandstone.highlight);
      sub.fillRect(rightPole - 7, pileY, 5, 3, RAMPS.slate.mid);
      sub.fillRect(rightPole - 7, pileY, 3, 1, RAMPS.slate.highlight);
    });

    return out;
  }

  if (state === 'damaged') {
    const out = source.clone();

    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        const px = out.getPixel(x, y);
        if (!px) continue;

        const relY = (y - bounds.minY) / spanH;
        const relX = (x - bounds.minX) / spanW;

        // Chip ragged holes out of upper roof / right cornice
        const topBreach =
          relY < 0.32 &&
          ((relX > 0.52 && relX < 0.78 && Math.abs(x + y * 2) % 5 < 3) ||
            (relX > 0.18 && relX < 0.34 && relY < 0.22));
        if (topBreach) {
          out.setPixel(x, y, null);
          continue;
        }

        // Diagonal structural fracture cracks down masonry
        const crack1 = Math.abs(x - bounds.minX - Math.round(spanW * 0.35) - Math.round((y - bounds.minY) * 0.3)) === 0;
        const crack2 = Math.abs(x - bounds.minX - Math.round(spanW * 0.68) + Math.round((y - bounds.minY) * 0.25)) === 0;
        if ((crack1 && relY > 0.25 && relY < 0.85) || (crack2 && relY > 0.35 && relY < 0.78)) {
          out.setPixel(x, y, VOID);
          continue;
        }

        // Soot scorch bands near breaches & base corners
        const nearScorch =
          (Math.hypot(x - (bounds.minX + spanW * 0.64), y - (bounds.minY + spanH * 0.28)) < spanW * 0.22) ||
          (Math.hypot(x - (bounds.minX + spanW * 0.28), y - (bounds.minY + spanH * 0.56)) < spanW * 0.14);
        if (nearScorch) {
          out.setPixel(x, y, darkenHex(px, 0.56));
        }
      }
    }

    // Drifting crisp opaque smoke puffs from roof breach (subtle animation across frames)
    const drift = frame % 4;
    const smokeX = Math.round(bounds.minX + spanW * 0.62);
    const smokeY = Math.max(2, bounds.minY + Math.round(spanH * 0.22));
    out.setPixel(smokeX - (drift % 2), smokeY - drift, '#6B7380');
    out.setPixel(smokeX + 1, Math.max(2, smokeY - 2 - drift), '#98A2B0');
    return out;
  }

  // `ruins`: collapsed jagged lower wall stumps, darkened weathered stone, scattered debris & moss
  const out = new PixelBuffer(source.width, source.height);
  const ruinHorizon = bounds.minY + Math.round(spanH * 0.56);

  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const px = source.getPixel(x, y);
      if (!px) continue;

      const relX = (x - bounds.minX) / spanW;
      // Stepped jagged broken wall profile (twin broken buttresses low in middle)
      const pillarWave =
        Math.sin(relX * Math.PI * 3.2) * 3.5 +
        ((Math.floor(x / 2) * 5) % 4);
      const localTop = ruinHorizon + Math.round(pillarWave);

      if (y < localTop) continue;
      // Weather & darken remaining masonry; add rim highlight on freshly snapped top edge
      if (y === localTop) {
        out.setPixel(x, y, (x * 3) % 5 === 0 ? RAMPS.moss.mid : RAMPS.slate.highlight);
      } else {
        const mossHint = y > bounds.maxY - 5 && ((x * 7 + y * 3) % 9 === 0);
        out.setPixel(x, y, mossHint ? RAMPS.moss.shadow : darkenHex(px, 0.72));
      }
    }
  }

  // Fallen masonry blocks, broken beams & moss clusters strewn over collapsed plinth
  out.layer((sub) => {
    const rubbleBase = Math.min(source.height - 3, bounds.maxY - 1);
    const blocks = [
      { x: bounds.minX + 3, y: rubbleBase - 2, w: 4, h: 2, r: RAMPS.slate },
      { x: midX - 5, y: rubbleBase - 2, w: 5, h: 3, r: RAMPS.sandstone },
      { x: midX + 3, y: rubbleBase - 1, w: 4, h: 2, r: RAMPS.slate },
      { x: bounds.maxX - 7, y: rubbleBase - 2, w: 4, h: 2, r: RAMPS.timber },
    ];
    for (const b of blocks) {
      sub.fillRect(b.x, b.y, b.w, b.h, b.r.mid);
      sub.fillRect(b.x, b.y, Math.max(1, b.w - 1), 1, b.r.highlight);
      sub.fillRect(b.x + b.w - 1, b.y, 1, b.h, b.r.deep);
    }
    // Splintered fallen beam
    sub.drawLine(midX - 6, ruinHorizon + 5, midX + 2, rubbleBase - 1, RAMPS.timber.shadow, 2);
    sub.drawLine(midX - 6, ruinHorizon + 5, midX - 2, rubbleBase - 3, RAMPS.timber.highlight, 1);
  });

  return out;
}
