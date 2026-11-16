import {
  K1_MASK,
  K2_MASK,
  KINGDOM_PRESETS,
  SHADOW_COLOR,
  SKIN_MASK,
  SKIN_PHENOTYPES,
} from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import { UnitFrameAnchors } from '../engine/unitAssembler';
import { renderModelWithContext } from '../models';
import { PixelModelDef, RenderContextOptions } from '../models/types';

export interface EncodedModelAtlas {
  palette: string[];
  frames: {
    index: number;
    hash: string;
    opaquePixels: number;
    anchors: UnitFrameAnchors | null;
    rle: string;
  }[];
}

/**
 * Encodes all raw (mask-preserving) frames of a model into a compact,
 * lossless palette-indexed RLE representation (`count:paletteIdx`, `-1` = empty).
 */
export function encodeModelFramesRle(
  model: PixelModelDef,
  renderCtx?: RenderContextOptions
): EncodedModelAtlas {
  const palette: string[] = [];
  const paletteIndex = new Map<string, number>();

  const getColorIdx = (hex: string | null): number => {
    if (!hex) return -1;
    const upper = hex.toUpperCase();
    const existing = paletteIndex.get(upper);
    if (existing !== undefined) return existing;
    const next = palette.length;
    palette.push(upper);
    paletteIndex.set(upper, next);
    return next;
  };

  const ctxForRaw: RenderContextOptions = {
    kingdomId: 'original',
    phenotypeId:
      renderCtx?.phenotypeId ?? model.unitMeta?.defaultPhenotype ?? 'skin_light',
    unitMode: renderCtx?.unitMode ?? 'walk',
    unitAction: renderCtx?.unitAction ?? 'normal',
    showShadow: renderCtx?.showShadow,
    stageBg: renderCtx?.stageBg,
    buildingState: renderCtx?.buildingState,
  };

  const frames: EncodedModelAtlas['frames'] = [];

  for (let f = 0; f < model.frameCount; f++) {
    const buf: PixelBuffer = renderModelWithContext(model, f, ctxForRaw);
    const tokens: string[] = [];
    let currentIdx = -2;
    let runLen = 0;

    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        const idx = getColorIdx(buf.getPixel(x, y));
        if (idx === currentIdx) {
          runLen++;
        } else {
          if (runLen > 0) tokens.push(`${runLen}:${currentIdx}`);
          currentIdx = idx;
          runLen = 1;
        }
      }
    }
    if (runLen > 0) tokens.push(`${runLen}:${currentIdx}`);

    const anchors = model.getAnchors
      ? model.getAnchors(f, model.frameCount, ctxForRaw)
      : null;

    frames.push({
      index: f,
      hash: buf.hashFrame(),
      opaquePixels: buf.countOpaquePixels(),
      anchors,
      rle: tokens.join(','),
    });
  }

  return { palette, frames };
}

/**
 * Generates a complete, self-contained, zero-dependency TypeScript module
 * for a single pixel model, including:
 * - Metadata & unit anchors (`MODEL_META`)
 * - Standalone `PixelBuffer` & K1/K2/SKIN mask recoloring runtime
 * - Exact lossless multi-frame RLE data (`renderModelFrame`, `renderToRgbaBytes`, `renderToCanvas`)
 * - Original procedural generator blueprint (`REFERENCE_GENERATOR_CODE`)
 */
export function generateStandaloneModelTs(
  model: PixelModelDef,
  renderCtx?: RenderContextOptions
): string {
  const defaultKingdom = renderCtx?.kingdomId ?? 'original';
  const defaultPhenotype =
    renderCtx?.phenotypeId ?? model.unitMeta?.defaultPhenotype ?? 'skin_light';
  const defaultMode = renderCtx?.unitMode ?? 'walk';
  const defaultAction = renderCtx?.unitAction ?? 'normal';

  const encoded = encodeModelFramesRle(model, {
    kingdomId: 'original',
    phenotypeId: defaultPhenotype,
    unitMode: defaultMode,
    unitAction: defaultAction,
    showShadow: renderCtx?.showShadow,
    stageBg: renderCtx?.stageBg,
  });

  const metaObj = {
    id: model.id,
    name: model.name,
    subtitle: model.subtitle,
    kind: model.kind,
    tier: model.tier,
    faction: model.faction,
    width: model.width,
    height: model.height,
    frameCount: model.frameCount,
    defaultFps: model.defaultFps,
    layersSpec: model.layersSpec,
    unitMeta: model.unitMeta ?? null,
    exportContext: {
      defaultKingdom,
      defaultPhenotype,
      unitMode: defaultMode,
      unitAction: defaultAction,
    },
    anchorsByFrame: encoded.frames.map((f) => f.anchors),
  };

  const indentedBlueprint = model.codeSnippet
    .replace(/\*\//g, '* /')
    .split('\n')
    .map((line) => ` * ${line}`)
    .join('\n');

  return `/**
 * ============================================================================
 * STANDALONE PIXEL MODEL MODULE: ${model.name} (${model.id})
 * ============================================================================
 * Kind: ${model.kind} | Tier: ${model.tier} | Faction: ${model.faction} | Grid: ${model.width}x${model.height} px | Frames: ${model.frameCount} (${model.defaultFps} FPS)
 * Zero external dependencies. Drop directly into TypeScript, Canvas, or Node.
 *
 * USAGE:
 *   const frame0 = renderModelFrame(0, '${defaultKingdom}', '${defaultPhenotype}');
 *   const rgba = frame0.toRgbaBytes(); // Uint8ClampedArray (${model.width} * ${model.height} * 4)
 *   // Or in browser: renderToCanvas(canvasElement, 0, 4, '${defaultKingdom}', '${defaultPhenotype}');
 * ============================================================================
 */

export const MODEL_META = ${JSON.stringify(metaObj, null, 2)} as const;

export const K1_MASK = ${JSON.stringify(K1_MASK)} as const;
export const K2_MASK = ${JSON.stringify(K2_MASK)} as const;
export const SKIN_MASK = ${JSON.stringify(SKIN_MASK)} as const;
export const SHADOW_COLOR = '${SHADOW_COLOR}';

export const KINGDOM_PRESETS: Record<string, { primaryHex: string; secondaryHex: string }> = {
${KINGDOM_PRESETS.map(
  (k) => `  ${k.id}: { primaryHex: '${k.primaryHex}', secondaryHex: '${k.secondaryHex}' },`
).join('\n')}
};

export const SKIN_PHENOTYPES: Record<string, { fromHex: string; toHex: string }> = {
${SKIN_PHENOTYPES.map(
  (p) => `  ${p.id}: { fromHex: '${p.fromHex}', toHex: '${p.toHex}' },`
).join('\n')}
};

const PALETTE: readonly string[] = ${JSON.stringify(encoded.palette)};

const FRAMES_RLE: readonly string[] = [
${encoded.frames.map((f) => `  '${f.rle}',`).join('\n')}
];

export class PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly grid: (string | null)[];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.grid = new Array<string | null>(width * height).fill(null);
  }

  getPixel(x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return this.grid[y * this.width + x];
  }

  setPixel(x: number, y: number, hex: string | null): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.grid[y * this.width + x] = hex ? hex.toUpperCase() : null;
  }

  recolorWithLookup(lookup: ReadonlyMap<string, string>): PixelBuffer {
    const out = new PixelBuffer(this.width, this.height);
    for (let i = 0; i < this.grid.length; i++) {
      const c = this.grid[i];
      if (c) out.grid[i] = (lookup.get(c) ?? c).toUpperCase();
    }
    return out;
  }

  toRgbaBytes(): Uint8ClampedArray {
    const data = new Uint8ClampedArray(this.width * this.height * 4);
    for (let i = 0; i < this.grid.length; i++) {
      const hex = this.grid[i];
      if (!hex) continue;
      const [r, g, b, a] = hexToRgba(hex);
      const off = i * 4;
      data[off] = r;
      data[off + 1] = g;
      data[off + 2] = b;
      data[off + 3] = a;
    }
    return data;
  }
}

function hexToRgba(hex: string): [number, number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const a = clean.length === 8 ? parseInt(clean.slice(6, 8), 16) : 255;
  return [r, g, b, a];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase();
  return \`#\${c(r)}\${c(g)}\${c(b)}\`;
}

export function calculateKingdomRamp(baseHex: string): [string, string, string, string] {
  let [r, g, b] = hexToRgba(baseHex);
  if (r < 128 && g < 128 && b < 128) {
    r = Math.min(255, r + 50);
    g = Math.min(255, g + 50);
    b = Math.min(255, b + 50);
  }
  return [0, 0.13, 0.35, 0.56].map((t) =>
    rgbToHex(r + (30 - r) * t, g + (30 - g) * t, b + (30 - b) * t)
  ) as [string, string, string, string];
}

export function calculateSkinShades(
  fromHex: string,
  toHex: string,
  shadeVariant = 1
): [string, string, string, string] {
  const [fr, fg, fb] = hexToRgba(fromHex);
  const [tr, tg, tb] = hexToRgba(toHex);
  const t = 1 - Math.max(0, Math.min(3, shadeVariant)) / 3;
  const br = tr + (fr - tr) * t;
  const bg = tg + (fg - tg) * t;
  const bb = tb + (fb - tb) * t;
  return [1.0, 0.9, 0.8, 0.7].map((m) => rgbToHex(br * m, bg * m, bb * m)) as [
    string,
    string,
    string,
    string,
  ];
}

export function buildMaskColorLookup(
  kingdomId = '${defaultKingdom}',
  phenotypeId = '${defaultPhenotype}'
): Map<string, string> {
  const map = new Map<string, string>();
  const kingdom = KINGDOM_PRESETS[kingdomId];
  if (kingdom && kingdomId !== 'original') {
    const k1 = calculateKingdomRamp(kingdom.primaryHex);
    const k2 = calculateKingdomRamp(kingdom.secondaryHex);
    K1_MASK.forEach((src, i) => map.set(src.toUpperCase(), k1[i]));
    K2_MASK.forEach((src, i) => map.set(src.toUpperCase(), k2[i]));
  }
  const skin = SKIN_PHENOTYPES[phenotypeId] ?? SKIN_PHENOTYPES.skin_light;
  const shades = calculateSkinShades(skin.fromHex, skin.toHex, 1);
  SKIN_MASK.forEach((src, i) => map.set(src.toUpperCase(), shades[i]));
  return map;
}

export function decodeRawModelFrame(frameIndex = 0): PixelBuffer {
  const safe = ((frameIndex % FRAMES_RLE.length) + FRAMES_RLE.length) % FRAMES_RLE.length;
  const buf = new PixelBuffer(MODEL_META.width, MODEL_META.height);
  const tokens = FRAMES_RLE[safe].split(',');
  let cursor = 0;
  for (const tok of tokens) {
    const sep = tok.indexOf(':');
    if (sep === -1) continue;
    const count = parseInt(tok.slice(0, sep), 10);
    const idx = parseInt(tok.slice(sep + 1), 10);
    const hex = idx >= 0 ? PALETTE[idx] : null;
    for (let i = 0; i < count && cursor < buf.grid.length; i++) {
      buf.grid[cursor++] = hex;
    }
  }
  return buf;
}

export function renderModelFrame(
  frameIndex = 0,
  kingdomId = '${defaultKingdom}',
  phenotypeId = '${defaultPhenotype}'
): PixelBuffer {
  const raw = decodeRawModelFrame(frameIndex);
  const lookup = buildMaskColorLookup(kingdomId, phenotypeId);
  return lookup.size > 0 ? raw.recolorWithLookup(lookup) : raw;
}

export function renderToRgbaBytes(
  frameIndex = 0,
  kingdomId = '${defaultKingdom}',
  phenotypeId = '${defaultPhenotype}'
): Uint8ClampedArray {
  return renderModelFrame(frameIndex, kingdomId, phenotypeId).toRgbaBytes();
}

export function renderToCanvas(
  canvas: HTMLCanvasElement,
  frameIndex = 0,
  scale = 4,
  kingdomId = '${defaultKingdom}',
  phenotypeId = '${defaultPhenotype}'
): void {
  const buf = renderModelFrame(frameIndex, kingdomId, phenotypeId);
  canvas.width = buf.width * scale;
  canvas.height = buf.height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const off = document.createElement('canvas');
  off.width = buf.width;
  off.height = buf.height;
  const offCtx = off.getContext('2d');
  if (!offCtx) return;
  offCtx.putImageData(new ImageData(new Uint8ClampedArray(buf.toRgbaBytes()), buf.width, buf.height), 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
}

/*
 * ============================================================================
 * PROCEDURAL ARCHITECTURE / UNIT BLUEPRINT (ORIGINAL ENGINE CALLS)
 * ============================================================================
${indentedBlueprint}
 */
`;
}

/**
 * Generates a structured JSON model passport with exact palette-indexed RLE
 * frame matrices and unit anchor coordinates.
 */
export function generateModelJson(
  model: PixelModelDef,
  renderCtx?: RenderContextOptions
): string {
  const encoded = encodeModelFramesRle(model, renderCtx);
  const payload = {
    schema: 'kostyanaya-kuznya.pixel-model.v2',
    id: model.id,
    name: model.name,
    subtitle: model.subtitle,
    kind: model.kind,
    tier: model.tier,
    faction: model.faction,
    width: model.width,
    height: model.height,
    frameCount: model.frameCount,
    defaultFps: model.defaultFps,
    layersSpec: model.layersSpec,
    description: model.description,
    unitMeta: model.unitMeta ?? null,
    context: {
      kingdomId: renderCtx?.kingdomId ?? 'original',
      phenotypeId:
        renderCtx?.phenotypeId ?? model.unitMeta?.defaultPhenotype ?? 'skin_light',
      unitMode: renderCtx?.unitMode ?? 'walk',
      unitAction: renderCtx?.unitAction ?? 'normal',
    },
    masks: {
      K1_MASK,
      K2_MASK,
      SKIN_MASK,
      SHADOW_COLOR,
    },
    rleEncoding: 'count:paletteIndex (-1 = transparent)',
    palette: encoded.palette,
    frames: encoded.frames,
    codeBlueprint: model.codeSnippet,
  };
  return JSON.stringify(payload, null, 2);
}

function triggerTextDownload(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadModelCodeTs(
  model: PixelModelDef,
  renderCtx?: RenderContextOptions
): void {
  const code = generateStandaloneModelTs(model, renderCtx);
  triggerTextDownload(code, `${model.id}.model.ts`, 'text/typescript;charset=utf-8');
}

export function downloadModelCodeJson(
  model: PixelModelDef,
  renderCtx?: RenderContextOptions
): void {
  const json = generateModelJson(model, renderCtx);
  triggerTextDownload(json, `${model.id}.model.json`, 'application/json;charset=utf-8');
}
