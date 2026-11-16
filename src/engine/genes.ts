import {
  K1_MASK,
  K2_MASK,
  SHADOW_COLOR,
  SKIN_MASK,
  WATER_LINE,
  hexToRgba,
  rgbToHex,
} from './palette';
import { PixelBuffer } from './pixelCanvas';
import {
  CreatureGenes,
  GeneAppendages,
  GeneBiomeTint,
  GeneCoat,
  GenePattern,
  GeneSize,
} from '../models/types';

export const DEFAULT_CREATURE_GENES: Required<CreatureGenes> = {
  size: 'standard',
  coat: 'natural',
  appendages: 'standard',
  biomeTint: 'none',
  pattern: 'solid',
};

export const GENE_SIZE_OPTIONS: { id: GeneSize; label: string }[] = [
  { id: 'compact', label: 'Карлик' },
  { id: 'standard', label: 'Обычный' },
  { id: 'colossal', label: 'Гигант' },
];

export const GENE_COAT_OPTIONS: { id: GeneCoat; label: string }[] = [
  { id: 'natural', label: 'Природный' },
  { id: 'dark', label: 'Меланист' },
  { id: 'albino', label: 'Альбинос' },
  { id: 'striped', label: 'Полосатый' },
];

export const GENE_APPENDAGE_OPTIONS: { id: GeneAppendages; label: string }[] = [
  { id: 'none', label: 'Без рогов/перьев' },
  { id: 'standard', label: 'Обычные' },
  { id: 'ornate', label: 'Венценосные' },
];

export const GENE_BIOME_OPTIONS: { id: GeneBiomeTint; label: string }[] = [
  { id: 'none', label: 'Без адаптации' },
  { id: 'forest', label: 'Лесной' },
  { id: 'tundra', label: 'Тундровый' },
  { id: 'desert', label: 'Пустынный' },
  { id: 'volcanic', label: 'Вулканический' },
];

export const GENE_PATTERN_OPTIONS: { id: GenePattern; label: string }[] = [
  { id: 'solid', label: 'Однотонный' },
  { id: 'striped', label: 'Полосатый' },
  { id: 'spotted', label: 'Пятнистый' },
  { id: 'dappled', label: 'Крапчатый' },
];

export function resolveCreatureGenes(genes?: CreatureGenes): Required<CreatureGenes> {
  return {
    size: genes?.size ?? DEFAULT_CREATURE_GENES.size,
    coat: genes?.coat ?? DEFAULT_CREATURE_GENES.coat,
    appendages: genes?.appendages ?? DEFAULT_CREATURE_GENES.appendages,
    biomeTint: genes?.biomeTint ?? DEFAULT_CREATURE_GENES.biomeTint,
    pattern: genes?.pattern ?? DEFAULT_CREATURE_GENES.pattern,
  };
}

export function isDefaultGenes(genes?: CreatureGenes): boolean {
  if (!genes) return true;
  const r = resolveCreatureGenes(genes);
  return (
    r.size === 'standard' &&
    r.coat === 'natural' &&
    r.appendages === 'standard' &&
    r.biomeTint === 'none' &&
    r.pattern === 'solid'
  );
}

export function serializeGenesKey(genes?: CreatureGenes): string {
  if (isDefaultGenes(genes)) return '';
  const r = resolveCreatureGenes(genes);
  const pat = r.pattern !== 'solid' ? `_${r.pattern}` : '';
  return `g:${r.size}_${r.coat}_${r.appendages}_${r.biomeTint}${pat}`;
}

const PROTECTED_HEX = new Set<string>([
  ...K1_MASK.map((h) => h.toUpperCase()),
  ...K2_MASK.map((h) => h.toUpperCase()),
  ...SKIN_MASK.map((h) => h.toUpperCase()),
  WATER_LINE.light.toUpperCase(),
  WATER_LINE.mid.toUpperCase(),
  SHADOW_COLOR.toUpperCase(),
]);

function blendRgb(
  r: number,
  g: number,
  b: number,
  tr: number,
  tg: number,
  tb: number,
  t: number
): [number, number, number] {
  return [
    r + (tr - r) * t,
    g + (tg - g) * t,
    b + (tb - b) * t,
  ];
}

/**
 * Applies subspecies genetic transformations (`coat`, `biomeTint`, and `size`)
 * to a rendered creature sprite while preserving faction masks (K1/K2/SKIN),
 * water ripples, top-left lighting contrast, and 1px clean canvas bounds.
 */
export function applyCreatureGenes(
  src: PixelBuffer,
  rawGenes?: CreatureGenes,
  options?: { anchorY?: number; skipSize?: boolean }
): PixelBuffer {
  const genes = resolveCreatureGenes(rawGenes);
  if (
    genes.size === 'standard' &&
    genes.coat === 'natural' &&
    genes.biomeTint === 'none' &&
    genes.pattern === 'solid'
  ) {
    return src;
  }

  let working = src;

  // 1. Morphological size scaling anchored near bottom-center feet
  if (!options?.skipSize && genes.size !== 'standard') {
    const scale = genes.size === 'compact' ? 0.84 : 1.16;
    const out = new PixelBuffer(src.width, src.height);

    // Find current bounding box so scaled sprite stays inside 1px safety border
    let minX = src.width;
    let maxX = -1;
    let minY = src.height;
    let maxY = -1;
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        if (src.getPixel(x, y) !== null) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX >= minX && maxY >= minY) {
      const cx = (minX + maxX) * 0.5;
      const anchorY = options?.anchorY ?? maxY;
      // Fit scaled height inside [1, height - 2]
      const targetTop = anchorY - (anchorY - minY) * scale;
      const shiftY = targetTop < 1 ? Math.ceil(1 - targetTop) : 0;

      for (let y = 1; y < src.height - 1; y++) {
        for (let x = 1; x < src.width - 1; x++) {
          const sx = Math.round(cx + (x - cx) / scale);
          const sy = Math.round(anchorY + (y - shiftY - anchorY) / scale);
          const c = src.getPixel(sx, sy);
          if (c !== null) {
            out.setPixel(x, y, c);
          }
        }
      }
      working = out;
    }
  }

  // 2. Pre-analyze water surface & isolated eye clusters before pigment mutation
  const w = working.width;
  const h = working.height;
  const waterMask = new Uint8Array(w * h);
  const darkCandidate = new Uint8Array(w * h);
  const eyeMask = new Uint8Array(w * h);
  const waterLightUpper = WATER_LINE.light.toUpperCase();
  const waterMidUpper = WATER_LINE.mid.toUpperCase();
  const iceMidUpper = '#6CC0E5';

  let minOpY = h;
  let maxOpY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hex = working.getPixel(x, y);
      if (!hex) continue;
      if (y < minOpY) minOpY = y;
      if (y > maxOpY) maxOpY = y;

      const idx = y * w + x;
      const [r, g, b, a] = hexToRgba(hex);
      const isTranslucentBlue = a < 235 && b > r + 15;
      const isWaterHex =
        hex === waterLightUpper ||
        hex === waterMidUpper ||
        hex === '#0C3554' ||
        hex === '#0A2C46' ||
        hex === '#0B3B5C';

      if (isTranslucentBlue || isWaterHex) {
        waterMask[idx] = 1;
        continue;
      }

      if (!PROTECTED_HEX.has(hex)) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);
        if (luma < 34 && chroma < 18) {
          darkCandidate[idx] = 1;
        }
      }
    }
  }

  // Propagate water mask 1px to adjacent water-foam pixels (#6CC0E5 / #FFFFFF on wave crest)
  const waterCopy = new Uint8Array(waterMask);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (waterMask[idx]) continue;
      const hex = working.getPixel(x, y);
      if (hex !== iceMidUpper && hex !== '#FFFFFF') continue;
      let touchesWater = false;
      for (let dy = -1; dy <= 1 && !touchesWater; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && waterCopy[ny * w + nx]) {
            touchesWater = true;
            break;
          }
        }
      }
      if (touchesWater) {
        waterMask[idx] = 1;
      }
    }
  }

  // Connected-component filter: only tiny isolated dark clusters (<= 3 px) surrounded by
  // brighter body pixels in upper 78% of creature count as albino crimson eye pupils.
  const visited = new Uint8Array(w * h);
  const eyeMaxY = minOpY + (maxOpY - minOpY) * 0.78;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (!darkCandidate[start] || visited[start]) continue;
      const comp: number[] = [];
      const stack = [start];
      visited[start] = 1;
      while (stack.length > 0) {
        const cur = stack.pop()!;
        comp.push(cur);
        const cx = cur % w;
        const cy = Math.floor(cur / w);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const nIdx = ny * w + nx;
              if (darkCandidate[nIdx] && !visited[nIdx]) {
                visited[nIdx] = 1;
                stack.push(nIdx);
              }
            }
          }
        }
      }
      if (comp.length <= 2) {
        let validEye = true;
        let brighterNeighbors = 0;
        for (const cIdx of comp) {
          const cx = cIdx % w;
          const cy = Math.floor(cIdx / w);
          if (cy > eyeMaxY) {
            validEye = false;
            break;
          }
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const nHex = working.getPixel(nx, ny);
              if (nHex) {
                const [nr, ng, nb, na] = hexToRgba(nHex);
                const nl = 0.299 * nr + 0.587 * ng + 0.114 * nb;
                if (na >= 235 && nl >= 70) brighterNeighbors++;
              }
            }
          }
        }
        if (validEye && brighterNeighbors >= 3) {
          for (const cIdx of comp) eyeMask[cIdx] = 1;
        }
      }
    }
  }

  // 3. Coat & Biome Pigment Mutations (preserving K1/K2/SKIN/WATER_LINE/translucent water)
  if (genes.coat === 'natural' && genes.biomeTint === 'none' && genes.pattern === 'solid') {
    return working;
  }

  const out = new PixelBuffer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hex = working.getPixel(x, y);
      if (!hex) continue;
      const idx = y * w + x;
      if (PROTECTED_HEX.has(hex) || waterMask[idx]) {
        out.setPixel(x, y, hex);
        continue;
      }

      let [r, g, b, a] = hexToRgba(hex);
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const isEyeDot = eyeMask[idx] === 1;

      // Coat variant (cluster-clean stripes/spots without noisy intermediate gradients)
      if (genes.coat === 'dark') {
        if (!isEyeDot) {
          r *= 0.68;
          g *= 0.68;
          b *= 0.72;
        }
      } else if (genes.coat === 'albino') {
        if (isEyeDot) {
          r = 205;
          g = 48;
          b = 60;
        } else {
          const pale = Math.min(252, 162 + luma * 0.36);
          [r, g, b] = blendRgb(r, g, b, pale, pale * 0.98, pale * 0.94, 0.80);
        }
      } else if (genes.coat === 'striped' && !isEyeDot) {
        const stripePhase = ((x + Math.floor(y * 0.5)) % 5 + 5) % 5;
        if (stripePhase < 2) {
          r *= 0.74;
          g *= 0.74;
          b *= 0.76;
        }
      }

      // Surface pattern overlay (clean 2×2+ clusters, never single-pixel salt-and-pepper noise)
      if (!isEyeDot && genes.pattern !== 'solid') {
        if (genes.pattern === 'striped' && genes.coat !== 'striped') {
          const band = (((Math.floor(x * 0.7) + Math.floor(y * 0.45)) % 5) + 5) % 5;
          if (band < 2) {
            r *= 0.76;
            g *= 0.75;
            b *= 0.78;
          }
        } else if (genes.pattern === 'spotted') {
          const cx = Math.floor(x / 2);
          const cy = Math.floor(y / 2);
          if ((cx * 3 + cy * 5) % 7 < 2) {
            r *= 0.72;
            g *= 0.70;
            b *= 0.72;
          }
        } else if (genes.pattern === 'dappled') {
          const px = Math.floor(x / 2);
          const py = Math.floor(y / 2);
          if (((px + py) % 4) === 0) {
            [r, g, b] = blendRgb(r, g, b, Math.min(255, r * 1.24 + 18), Math.min(255, g * 1.2 + 16), Math.min(255, b * 1.16 + 12), 0.55);
          }
        }
      }

      // Biome adaptive tint
      if (!isEyeDot && genes.biomeTint !== 'none') {
        if (genes.biomeTint === 'forest') {
          [r, g, b] = blendRgb(r, g, b, 66, 118, 62, 0.24);
        } else if (genes.biomeTint === 'tundra') {
          const factor = luma > 130 ? 0.32 : 0.22;
          [r, g, b] = blendRgb(r, g, b, 198, 224, 240, factor);
        } else if (genes.biomeTint === 'desert') {
          [r, g, b] = blendRgb(r, g, b, 218, 178, 108, 0.25);
        } else if (genes.biomeTint === 'volcanic') {
          if (luma > 165) {
            [r, g, b] = blendRgb(r, g, b, 232, 98, 44, 0.28);
          } else {
            [r, g, b] = blendRgb(r, g, b, 58, 42, 48, 0.28);
          }
        }
      }

      // Snap mutated channels to compact 12-step grid to preserve crisp ~8-16 color economy
      const q = (v: number) => Math.min(255, Math.max(0, Math.round(v / 12) * 12));
      const alphaSuffix = a < 255 ? Math.round(a).toString(16).padStart(2, '0').toUpperCase() : '';
      out.setPixel(x, y, rgbToHex(q(r), q(g), q(b)) + alphaSuffix);
    }
  }

  return out;
}
