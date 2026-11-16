import { getModelEntityType, getModelEra, ALL_MODELS } from '../models';
import type { BuildingState, CreatureGenes, PixelModelDef, StageBg } from '../models/types';
import {
  BUILDING_ANIMATION_SPEC,
  renderAnimatedBuildingFrame,
} from './buildingAnimations';
import { applyBuildingState } from './buildingStates';
import {
  CREATURE_ANIMATION_SPECS,
  type CreatureAnimationAction,
  renderAnimatedCreatureFrame,
} from './creatureAnimations';
import { K1_MASK, K2_MASK, INK } from './palette';
import { getAllModelPhenotypeSchemas } from './phenotypeRegistry';
import { PixelBuffer } from './pixelCanvas';
import {
  PIXEL_VFX_SPECS,
  type VfxEffectId,
  renderVfxFrame,
} from './pixelVfx';
import {
  FLAGSHIP_SIX_KINGDOMS,
  generateAnimalPhenotypeVariant,
  getAllMedievalAndBronzeBuildings,
  recolorSpriteWithLabKingdom,
} from './proceduralBuildingsAndAnimals';
import {
  ACTIVE_UNIT_ERAS,
  ACTIVE_UNIT_RACES,
  GeneratedHumanResult,
  MEDIEVAL_ROLE_LABELS,
  MedievalHumanRole,
  POWER_RANK_LABELS,
  PowerHierarchyRank,
  ProceduralAnchors,
  ProceduralHumanParams,
  ProceduralSpriteAudit,
  ResolvedHumanProfile,
  type UnitAnimationAction,
  ZoneTag,
  generateProceduralUnit,
  getRaceActionSpec,
} from './proceduralHuman';
import {
  HAIR_PALETTES_12,
  KINGDOM_PALETTES_84,
  KingdomPaletteDef,
  SKIN_PALETTES_14,
} from './proceduralPalettes';
import { ALL_RACE_BUILDINGS, MEDIEVAL_TOWN_HALL } from './proceduralRaceBuildings';
import { applySoftGroundShadow } from './softShadow';
import { AtlasStats, BakedSpriteAtlas } from './spriteAtlas';

/**
 * ============================================================================
 * PUBLIC GAME API — КОСТЯНАЯ КУЗНЯ (FORGE API)
 * ============================================================================
 * Единая точка входа для игрового движка и пайплайна экспорта:
 *   - getUnitSprite(seed, params)
 *   - getBuildingSprite(id, kingdom, state)
 *   - getCreatureSprite(species, genes)
 *   - bakeAtlas(list) -> { png, json, manifest, pages, atlas }
 *   - buildFullExportArchive() -> полный ZIP-архив (PNG + JSON) всех рас, построек и 205 моделей
 * ============================================================================
 */

export interface UnitSpriteResult {
  readonly buffer: PixelBuffer;
  readonly rgba: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly zoneMap: readonly (ZoneTag | null)[];
  readonly anchors: ProceduralAnchors;
  readonly profile: ResolvedHumanProfile;
  readonly audit: ProceduralSpriteAudit;
}

export interface BuildingSpriteResult {
  readonly modelId: string;
  readonly modelName: string;
  readonly kingdom: KingdomPaletteDef | null;
  readonly buildingState: BuildingState;
  readonly buffer: PixelBuffer;
  readonly rgba: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly k1ChangedPixels: number;
  readonly k2ChangedPixels: number;
  readonly inkPixels: number;
}

export interface CreatureSpriteResult {
  readonly modelId: string;
  readonly modelName: string;
  readonly genes: Required<CreatureGenes>;
  readonly kingdom: KingdomPaletteDef;
  readonly buffer: PixelBuffer;
  readonly rgba: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly opaquePixels: number;
  readonly uniqueColors: number;
  readonly inkPixels: number;
}

export type AtlasBakeInputItem =
  | {
      readonly kind: 'unit';
      readonly key?: string;
      readonly clipId?: string;
      readonly seed: number;
      readonly params?: Omit<ProceduralHumanParams, 'seed'>;
    }
  | {
      readonly kind: 'building';
      readonly key?: string;
      readonly clipId?: string;
      readonly id: string;
      readonly kingdom?: number | string | KingdomPaletteDef;
      readonly state?: BuildingState;
      readonly burning?: boolean;
      readonly frameIndex?: number;
      readonly stageBg?: StageBg;
      readonly showShadow?: boolean;
    }
  | {
      readonly kind: 'creature';
      readonly key?: string;
      readonly clipId?: string;
      readonly species: string;
      readonly genes?: CreatureGenes;
      readonly seed?: number;
      readonly kingdomId?: number;
      readonly action?: CreatureAnimationAction;
      readonly frameIndex?: number;
      readonly stageBg?: StageBg;
      readonly showShadow?: boolean;
    }
  | {
      readonly kind: 'vfx';
      readonly key?: string;
      readonly clipId?: string;
      readonly effectId: VfxEffectId;
      readonly frameIndex?: number;
      readonly k1Hex?: string;
      readonly direction?: 1 | -1;
    }
  | {
      readonly kind: 'buffer';
      readonly key: string;
      readonly clipId?: string;
      readonly durationMs?: number;
      readonly loop?: boolean;
      readonly buffer: PixelBuffer;
      readonly meta?: Record<string, unknown>;
    };

export interface BakeAtlasOptions {
  readonly pageSize?: number;
  readonly scale?: 1 | 2 | 4;
  readonly trimToContent?: boolean;
}

export interface ForgeAtlasFrameEntry {
  readonly key: string;
  readonly kind: AtlasBakeInputItem['kind'];
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly durationMs?: number;
  readonly meta: Record<string, unknown>;
}

export interface ForgeAtlasAnimationClip {
  readonly id: string;
  readonly kind: AtlasBakeInputItem['kind'];
  readonly action: string;
  readonly loop: boolean;
  readonly frames: readonly string[];
  readonly frameDurationsMs: readonly number[];
  readonly anchors: readonly (ProceduralAnchors | Record<string, unknown> | null)[];
}

export interface ForgeAtlasPageOutput {
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
  readonly png: Uint8Array;
}

export interface ForgeAtlasManifest {
  readonly version: string;
  readonly generator: string;
  readonly scale: number;
  readonly pageSize: number;
  readonly atlasStats: AtlasStats;
  readonly totalFrames: number;
  readonly pages: readonly {
    readonly pageIndex: number;
    readonly width: number;
    readonly height: number;
  }[];
  readonly frames: readonly ForgeAtlasFrameEntry[];
  readonly animations: Readonly<Record<string, ForgeAtlasAnimationClip>>;
}

export interface BakedAtlasOutput {
  readonly png: Uint8Array;
  readonly json: string;
  readonly pages: readonly ForgeAtlasPageOutput[];
  readonly manifest: ForgeAtlasManifest;
  readonly atlas: BakedSpriteAtlas;
}

// ----------------------------------------------------------------------------
// LOOKUP TABLES
// ----------------------------------------------------------------------------

const ALL_BUILDING_CATALOG: readonly PixelModelDef[] = [
  ...ALL_MODELS,
  ...ALL_RACE_BUILDINGS,
  MEDIEVAL_TOWN_HALL,
];

const MODELS_BY_ID = new Map<string, PixelModelDef>(
  ALL_BUILDING_CATALOG.map((m) => [m.id, m])
);

const MODELS_BY_NAME_LOWER = new Map<string, PixelModelDef>(
  ALL_BUILDING_CATALOG.map((m) => [m.name.toLowerCase(), m])
);

const LEGACY_KINGDOM_ALIAS: Readonly<Record<string, number>> = {
  red: 0,
  blue: 1,
  green: 2,
  yellow: 3,
  purple: 4,
  cyan: 5,
};

function resolveLabKingdom(
  kingdom?: number | string | KingdomPaletteDef
): KingdomPaletteDef | null {
  if (kingdom === 'original') return null;
  if (kingdom === undefined) return KINGDOM_PALETTES_84[0];
  if (typeof kingdom === 'object') return kingdom;
  if (typeof kingdom === 'number') {
    const idx =
      ((Math.floor(kingdom) % KINGDOM_PALETTES_84.length) + KINGDOM_PALETTES_84.length) %
      KINGDOM_PALETTES_84.length;
    return KINGDOM_PALETTES_84[idx];
  }
  const trimmed = kingdom.trim().toLowerCase();
  if (trimmed in LEGACY_KINGDOM_ALIAS) {
    return KINGDOM_PALETTES_84[LEGACY_KINGDOM_ALIAS[trimmed]];
  }
  const numMatch = /^k?(\d+)$/.exec(trimmed);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) % KINGDOM_PALETTES_84.length;
    return KINGDOM_PALETTES_84[idx];
  }
  const byName = KINGDOM_PALETTES_84.find((k) => k.name.toLowerCase() === trimmed);
  return byName ?? KINGDOM_PALETTES_84[0];
}

function resolveModel(idOrSpecies: string): PixelModelDef {
  const direct = MODELS_BY_ID.get(idOrSpecies);
  if (direct) return direct;
  const byName = MODELS_BY_NAME_LOWER.get(idOrSpecies.trim().toLowerCase());
  if (byName) return byName;
  throw new Error(`Unknown model/species id: "${idOrSpecies}"`);
}

// ----------------------------------------------------------------------------
// 1. getUnitSprite(seed, params)
// ----------------------------------------------------------------------------

export function getUnitSprite(
  seed: number,
  params?: Omit<ProceduralHumanParams, 'seed'>
): UnitSpriteResult {
  const generated: GeneratedHumanResult = generateProceduralUnit({
    ...(params ?? {}),
    seed,
  });
  return {
    buffer: generated.buffer,
    rgba: generated.buffer.toRgbaBytes(),
    width: generated.buffer.width,
    height: generated.buffer.height,
    zoneMap: generated.zoneMap,
    anchors: generated.profile.anchors,
    profile: generated.profile,
    audit: generated.audit,
  };
}

// ----------------------------------------------------------------------------
// 2. getBuildingSprite(id, kingdom, state)
// ----------------------------------------------------------------------------

export function getBuildingSprite(
  id: string,
  kingdom: number | string | KingdomPaletteDef = 0,
  state: BuildingState = 'ready',
  options?: {
    frameIndex?: number;
    stageBg?: StageBg;
    showShadow?: boolean;
    burning?: boolean;
  }
): BuildingSpriteResult {
  const model = resolveModel(id);
  const labKingdom = resolveLabKingdom(kingdom);
  const stageBg = options?.stageBg ?? 'dark';

  if (options?.burning) {
    const animRes = renderAnimatedBuildingFrame(
      model,
      labKingdom ?? 'original',
      state,
      options?.frameIndex ?? 0,
      {
        burning: true,
        stageBg,
        showShadow: options?.showShadow ?? true,
      }
    );
    return {
      modelId: model.id,
      modelName: model.name,
      kingdom: labKingdom,
      buildingState: state,
      buffer: animRes.buffer,
      rgba: animRes.buffer.toRgbaBytes(),
      width: animRes.width,
      height: animRes.height,
      k1ChangedPixels: labKingdom ? 1 : 0,
      k2ChangedPixels: labKingdom ? 1 : 0,
      inkPixels: animRes.inkPixels,
    };
  }

  const safeFrame =
    (((options?.frameIndex ?? 0) % model.frameCount) + model.frameCount) % model.frameCount;

  let baseRaw = model.renderFrame(safeFrame, model.frameCount, {
    kingdomId: 'original',
    buildingState: state,
    showShadow: false,
    stageBg,
  });
  if (state !== 'ready' && !model.supportsBuildingStates) {
    baseRaw = applyBuildingState(baseRaw, state, safeFrame, model.frameCount);
  }

  const k1Set = new Set(K1_MASK.map((c) => c.toUpperCase()));
  const k2Set = new Set(K2_MASK.map((c) => c.toUpperCase()));
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

  const recolored = labKingdom ? recolorSpriteWithLabKingdom(baseRaw, labKingdom) : baseRaw;
  const finalBuf =
    options?.showShadow !== false && model.supportsShadow !== false
      ? applySoftGroundShadow(recolored, { stageBg, isCompactUnit: false })
      : recolored;

  const inkUpper = INK.toUpperCase();
  let inkPixels = 0;
  for (let y = 0; y < finalBuf.height; y++) {
    for (let x = 0; x < finalBuf.width; x++) {
      if (finalBuf.getPixel(x, y) === inkUpper) inkPixels++;
    }
  }

  return {
    modelId: model.id,
    modelName: model.name,
    kingdom: labKingdom,
    buildingState: state,
    buffer: finalBuf,
    rgba: finalBuf.toRgbaBytes(),
    width: finalBuf.width,
    height: finalBuf.height,
    k1ChangedPixels: labKingdom ? k1Count : 0,
    k2ChangedPixels: labKingdom ? k2Count : 0,
    inkPixels,
  };
}

// ----------------------------------------------------------------------------
// 3. getCreatureSprite(species, genes)
// ----------------------------------------------------------------------------

export function getCreatureSprite(
  species: string,
  genes?: CreatureGenes,
  options?: {
    seed?: number;
    kingdomId?: number;
    action?: CreatureAnimationAction;
    frameIndex?: number;
    stageBg?: StageBg;
    showShadow?: boolean;
  }
): CreatureSpriteResult {
  const model = resolveModel(species);
  if (options?.action && options.action !== 'walk') {
    const anim = renderAnimatedCreatureFrame(
      model,
      options.action,
      options.frameIndex ?? 0,
      genes,
      options.kingdomId ?? 0,
      {
        seed: options.seed,
        stageBg: options.stageBg,
        showShadow: options.showShadow,
      }
    );
    const colors = new Set<string>();
    for (let y = 0; y < anim.buffer.height; y++) {
      for (let x = 0; x < anim.buffer.width; x++) {
        const px = anim.buffer.getPixel(x, y);
        if (px) colors.add(px);
      }
    }
    return {
      modelId: anim.model.id,
      modelName: anim.model.name,
      genes: anim.genes,
      kingdom: anim.kingdom,
      buffer: anim.buffer,
      rgba: anim.buffer.toRgbaBytes(),
      width: anim.width,
      height: anim.height,
      opaquePixels: anim.opaquePixels,
      uniqueColors: colors.size,
      inkPixels: anim.inkPixels,
    };
  }

  const res = generateAnimalPhenotypeVariant(model, options?.seed ?? 101, {
    genes,
    kingdomId: options?.kingdomId ?? 0,
    frameIndex: options?.frameIndex ?? 0,
    stageBg: options?.stageBg ?? 'dark',
    showShadow: options?.showShadow ?? true,
  });

  return {
    modelId: res.model.id,
    modelName: res.model.name,
    genes: res.phenotype.genes,
    kingdom: res.phenotype.kingdom,
    buffer: res.buffer,
    rgba: res.buffer.toRgbaBytes(),
    width: res.buffer.width,
    height: res.buffer.height,
    opaquePixels: res.opaquePixels,
    uniqueColors: res.uniqueColors,
    inkPixels: res.inkPixels,
  };
}

// ----------------------------------------------------------------------------
// PURE-TS BINARY PNG & ZIP ENCODERS (WORKS IDENTICALLY IN NODE.JS & BROWSER)
// ----------------------------------------------------------------------------

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let s1 = 1;
  let s2 = 0;
  for (let i = 0; i < bytes.length; i++) {
    s1 = (s1 + bytes[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  return ((s2 << 16) | s1) >>> 0;
}

function wrapStoredDeflate(raw: Uint8Array): Uint8Array {
  const MAX_BLOCK = 65535;
  const numBlocks = Math.max(1, Math.ceil(raw.length / MAX_BLOCK));
  const out = new Uint8Array(2 + raw.length + numBlocks * 5 + 4);
  let p = 0;
  // Zlib header: CMF=0x78 (deflate, 32K window), FLG=0x01 (no dict, fastest)
  out[p++] = 0x78;
  out[p++] = 0x01;

  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const remaining = raw.length - offset;
    const blockLen = Math.min(MAX_BLOCK, remaining);
    const isFinal = b === numBlocks - 1 ? 1 : 0;
    out[p++] = isFinal;
    out[p++] = blockLen & 0xff;
    out[p++] = (blockLen >>> 8) & 0xff;
    const nlen = (~blockLen) & 0xffff;
    out[p++] = nlen & 0xff;
    out[p++] = (nlen >>> 8) & 0xff;
    if (blockLen > 0) {
      out.set(raw.subarray(offset, offset + blockLen), p);
      p += blockLen;
      offset += blockLen;
    }
  }

  const adler = adler32(raw);
  out[p++] = (adler >>> 24) & 0xff;
  out[p++] = (adler >>> 16) & 0xff;
  out[p++] = (adler >>> 8) & 0xff;
  out[p++] = adler & 0xff;
  return out;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = type.charCodeAt(i);
  }
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc, false);
  return chunk;
}

export function encodeRgbaToPng(
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray
): Uint8Array {
  const safeW = Math.max(1, Math.floor(width));
  const safeH = Math.max(1, Math.floor(height));
  const stride = safeW * 4 + 1;
  const scanlines = new Uint8Array(stride * safeH);
  for (let y = 0; y < safeH; y++) {
    const rowStart = y * stride;
    scanlines[rowStart] = 0; // filter type 0 (None)
    const srcStart = y * safeW * 4;
    scanlines.set(rgba.subarray(srcStart, srcStart + safeW * 4), rowStart + 1);
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, safeW, false);
  ihdrView.setUint32(4, safeH, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = wrapStoredDeflate(scanlines);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = makePngChunk('IHDR', ihdr);
  const idatChunk = makePngChunk('IDAT', idat);
  const iendChunk = makePngChunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(
    sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  );
  let pos = 0;
  png.set(sig, pos);
  pos += sig.length;
  png.set(ihdrChunk, pos);
  pos += ihdrChunk.length;
  png.set(idatChunk, pos);
  pos += idatChunk.length;
  png.set(iendChunk, pos);
  return png;
}

export interface ZipEntryInput {
  readonly name: string;
  readonly data: Uint8Array | string;
}

/**
 * Builds a standard PKZIP archive (STORE method 0) synchronously in pure TypeScript.
 */
export function createZipArchive(entries: readonly ZipEntryInput[]): Uint8Array {
  const textEncoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const dataBytes =
      typeof entry.data === 'string' ? textEncoder.encode(entry.data) : entry.data;
    const crc = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lhView = new DataView(localHeader.buffer);
    lhView.setUint32(0, 0x04034b50, true);
    lhView.setUint16(4, 20, true); // version needed
    lhView.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lhView.setUint16(8, 0, true); // STORE compression method
    lhView.setUint16(10, 0, true);
    lhView.setUint16(12, 0x5421, true);
    lhView.setUint32(14, crc, true);
    lhView.setUint32(18, dataBytes.length, true);
    lhView.setUint32(22, dataBytes.length, true);
    lhView.setUint16(26, nameBytes.length, true);
    lhView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const chView = new DataView(centralHeader.buffer);
    chView.setUint32(0, 0x02014b50, true);
    chView.setUint16(4, 20, true);
    chView.setUint16(6, 20, true);
    chView.setUint16(8, 0x0800, true);
    chView.setUint16(10, 0, true);
    chView.setUint16(12, 0, true);
    chView.setUint16(14, 0x5421, true);
    chView.setUint32(16, crc, true);
    chView.setUint32(20, dataBytes.length, true);
    chView.setUint32(24, dataBytes.length, true);
    chView.setUint16(28, nameBytes.length, true);
    chView.setUint16(30, 0, true);
    chView.setUint16(32, 0, true);
    chView.setUint16(34, 0, true);
    chView.setUint16(36, 0, true);
    chView.setUint32(38, 0, true);
    chView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, dataBytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  let centralSize = 0;
  for (const cp of centralParts) centralSize += cp.length;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);
  eocdView.setUint16(20, 0, true);

  const totalSize = offset + centralSize + eocd.length;
  const archive = new Uint8Array(totalSize);
  let cursor = 0;
  for (const part of localParts) {
    archive.set(part, cursor);
    cursor += part.length;
  }
  for (const cp of centralParts) {
    archive.set(cp, cursor);
    cursor += cp.length;
  }
  archive.set(eocd, cursor);
  return archive;
}

// ----------------------------------------------------------------------------
// 4. bakeAtlas(list) -> { png, json, pages, manifest, atlas }
// ----------------------------------------------------------------------------

function scaleBufferNearest(src: PixelBuffer, scale: 1 | 2 | 4): PixelBuffer {
  if (scale === 1) return src;
  const out = new PixelBuffer(src.width * scale, src.height * scale);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const c = src.getPixel(x, y);
      if (!c) continue;
      out.fillRect(x * scale, y * scale, scale, scale, c);
    }
  }
  return out;
}

export function bakeAtlas(
  list: readonly AtlasBakeInputItem[],
  options?: BakeAtlasOptions
): BakedAtlasOutput {
  const pageSize = options?.pageSize ?? 1024;
  const scale: 1 | 2 | 4 = options?.scale ?? 1;
  const trimToContent = options?.trimToContent !== false;
  const atlas = new BakedSpriteAtlas(pageSize);

  const frames: ForgeAtlasFrameEntry[] = [];
  const clipAccumulators = new Map<
    string,
    {
      kind: AtlasBakeInputItem['kind'];
      action: string;
      loop: boolean;
      frames: string[];
      frameDurationsMs: number[];
      anchors: (ProceduralAnchors | Record<string, unknown> | null)[];
    }
  >();
  const pageBuffers = new Map<number, { maxX: number; maxY: number; rgba: Uint8ClampedArray }>();

  const ensurePage = (idx: number) => {
    let p = pageBuffers.get(idx);
    if (!p) {
      p = {
        maxX: 1,
        maxY: 1,
        rgba: new Uint8ClampedArray(pageSize * pageSize * 4),
      };
      pageBuffers.set(idx, p);
    }
    return p;
  };

  const registerClipFrame = (
    clipId: string,
    kind: AtlasBakeInputItem['kind'],
    action: string,
    loop: boolean,
    frameKey: string,
    durationMs: number,
    anchor: ProceduralAnchors | Record<string, unknown> | null
  ) => {
    let clip = clipAccumulators.get(clipId);
    if (!clip) {
      clip = {
        kind,
        action,
        loop,
        frames: [],
        frameDurationsMs: [],
        anchors: [],
      };
      clipAccumulators.set(clipId, clip);
    }
    clip.frames.push(frameKey);
    clip.frameDurationsMs.push(durationMs);
    clip.anchors.push(anchor);
  };

  list.forEach((item, index) => {
    let key: string;
    let rawBuf: PixelBuffer;
    let meta: Record<string, unknown>;
    let durationMs = 160;
    let clipId: string | undefined = item.clipId;
    let clipAction = 'walk';
    let clipLoop = true;
    let clipAnchor: ProceduralAnchors | Record<string, unknown> | null = null;

    if (item.kind === 'unit') {
      const u = getUnitSprite(item.seed, item.params);
      const spec = getRaceActionSpec(u.profile.race, u.profile.action);
      durationMs = spec.frameDurationsMs[u.profile.frameIndex] ?? 160;
      clipAction = u.profile.action;
      clipLoop = spec.loop;
      clipAnchor = u.anchors;
      clipId =
        item.clipId ??
        `unit_${u.profile.era}_${u.profile.race}_${u.profile.role}_${u.profile.action}_s${item.seed}`;
      key =
        item.key ??
        `unit_${u.profile.era}_${u.profile.race}_${u.profile.role}_${u.profile.action}_k${u.profile.kingdom.id}_s${item.seed}_f${u.profile.frameIndex}_${index}`;
      rawBuf = u.buffer;
      meta = {
        seed: u.profile.seed,
        era: u.profile.era,
        race: u.profile.race,
        gender: u.profile.gender,
        age: u.profile.age,
        role: u.profile.role,
        action: u.profile.action,
        carry: u.profile.carry,
        frameIndex: u.profile.frameIndex,
        durationMs,
        loop: spec.loop,
        powerRank: u.profile.powerRank,
        kingdomId: u.profile.kingdom.id,
        anchors: u.anchors,
      };
    } else if (item.kind === 'building') {
      const b = getBuildingSprite(item.id, item.kingdom ?? 0, item.state ?? 'ready', {
        frameIndex: item.frameIndex,
        stageBg: item.stageBg,
        showShadow: item.showShadow,
        burning: item.burning,
      });
      const bFrame = (((item.frameIndex ?? 0) % 4) + 4) % 4;
      durationMs = BUILDING_ANIMATION_SPEC.frameDurationsMs[bFrame] ?? 180;
      clipAction = item.burning ? 'burning' : b.buildingState;
      clipLoop = true;
      clipAnchor = { pivot: { x: Math.floor(b.width / 2), y: b.height - 2 } };
      if (item.clipId || item.frameIndex !== undefined || item.burning) {
        clipId =
          item.clipId ??
          `bld_${b.modelId}_k${b.kingdom?.id ?? 'orig'}_${clipAction}`;
      }
      key =
        item.key ??
        `bld_${b.modelId}_k${b.kingdom?.id ?? 'orig'}_${b.buildingState}_f${bFrame}_${index}`;
      rawBuf = b.buffer;
      meta = {
        modelId: b.modelId,
        modelName: b.modelName,
        kingdomId: b.kingdom?.id ?? null,
        buildingState: b.buildingState,
        burning: Boolean(item.burning),
        frameIndex: bFrame,
        durationMs,
        k1ChangedPixels: b.k1ChangedPixels,
        k2ChangedPixels: b.k2ChangedPixels,
      };
    } else if (item.kind === 'creature') {
      const action: CreatureAnimationAction = item.action ?? 'walk';
      const spec = CREATURE_ANIMATION_SPECS[action];
      const fIdx = (((item.frameIndex ?? 0) % spec.frameCount) + spec.frameCount) % spec.frameCount;
      durationMs = spec.frameDurationsMs[fIdx] ?? 165;
      const c = getCreatureSprite(item.species, item.genes, {
        seed: item.seed,
        kingdomId: item.kingdomId,
        action,
        frameIndex: item.frameIndex,
        stageBg: item.stageBg,
        showShadow: item.showShadow,
      });
      const resolvedModel = resolveModel(item.species);
      const rawAnchors = resolvedModel.getAnchors
        ? resolvedModel.getAnchors(fIdx, resolvedModel.frameCount, {
            kingdomId: 'original',
            unitAction: action === 'walk' ? 'normal' : action,
          })
        : null;
      clipAction = action;
      clipLoop = spec.loop;
      clipAnchor = rawAnchors
        ? (rawAnchors as unknown as Record<string, unknown>)
        : { pivot: { x: Math.floor(c.width / 2), y: c.height - 2 } };
      if (item.clipId || item.action !== undefined || item.frameIndex !== undefined) {
        clipId = item.clipId ?? `cre_${c.modelId}_${action}_s${item.seed ?? 101}`;
      }
      key =
        item.key ??
        `cre_${c.modelId}_${action}_${c.genes.coat}_${c.genes.pattern}_${c.genes.size}_k${c.kingdom.id}_f${fIdx}_${index}`;
      rawBuf = c.buffer;
      meta = {
        modelId: c.modelId,
        modelName: c.modelName,
        action,
        frameIndex: fIdx,
        durationMs,
        loop: spec.loop,
        genes: c.genes,
        kingdomId: c.kingdom.id,
        anchors: clipAnchor,
      };
    } else if (item.kind === 'vfx') {
      const spec = PIXEL_VFX_SPECS[item.effectId];
      const fIdx = (((item.frameIndex ?? 0) % spec.frameCount) + spec.frameCount) % spec.frameCount;
      durationMs = spec.frameDurationsMs[fIdx] ?? 90;
      rawBuf = renderVfxFrame(item.effectId, fIdx, {
        k1Hex: item.k1Hex,
        direction: item.direction,
      });
      clipAction = item.effectId;
      clipLoop = spec.loop;
      clipAnchor = { pivot: { x: Math.floor(rawBuf.width / 2), y: Math.floor(rawBuf.height / 2) } };
      clipId = item.clipId ?? `vfx_${item.effectId}`;
      key = item.key ?? `vfx_${item.effectId}_f${fIdx}_${index}`;
      meta = {
        effectId: item.effectId,
        frameIndex: fIdx,
        durationMs,
        loop: spec.loop,
      };
    } else {
      key = item.key;
      rawBuf = item.buffer;
      meta = item.meta ?? {};
      durationMs = item.durationMs ?? 160;
      clipLoop = item.loop ?? true;
    }

    const scaled = scaleBufferNearest(rawBuf, scale);
    const { region } = atlas.getOrBake(key, () => scaled);

    const page = ensurePage(region.pageIndex);
    const srcRgba = scaled.toRgbaBytes();
    for (let y = 0; y < region.height; y++) {
      const dstRow = ((region.y + y) * pageSize + region.x) * 4;
      const srcRow = y * region.width * 4;
      page.rgba.set(srcRgba.subarray(srcRow, srcRow + region.width * 4), dstRow);
    }
    if (region.x + region.width + 1 > page.maxX) page.maxX = region.x + region.width + 1;
    if (region.y + region.height + 1 > page.maxY) page.maxY = region.y + region.height + 1;

    frames.push({
      key,
      kind: item.kind,
      pageIndex: region.pageIndex,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      durationMs,
      meta,
    });

    if (clipId) {
      registerClipFrame(
        clipId,
        item.kind,
        clipAction,
        clipLoop,
        key,
        durationMs,
        clipAnchor
      );
    }
  });

  if (pageBuffers.size === 0) {
    ensurePage(0);
  }

  const pages: ForgeAtlasPageOutput[] = [];
  const sortedIndices = Array.from(pageBuffers.keys()).sort((a, b) => a - b);
  for (const pageIndex of sortedIndices) {
    const p = pageBuffers.get(pageIndex)!;
    const w = trimToContent ? Math.min(pageSize, Math.max(16, p.maxX)) : pageSize;
    const h = trimToContent ? Math.min(pageSize, Math.max(16, p.maxY)) : pageSize;
    const cropped = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const srcOff = y * pageSize * 4;
      cropped.set(p.rgba.subarray(srcOff, srcOff + w * 4), y * w * 4);
    }
    pages.push({
      pageIndex,
      width: w,
      height: h,
      png: encodeRgbaToPng(w, h, cropped),
    });
  }

  const animations: Record<string, ForgeAtlasAnimationClip> = {};
  for (const [id, clip] of clipAccumulators.entries()) {
    animations[id] = {
      id,
      kind: clip.kind,
      action: clip.action,
      loop: clip.loop,
      frames: clip.frames,
      frameDurationsMs: clip.frameDurationsMs,
      anchors: clip.anchors,
    };
  }

  const manifest: ForgeAtlasManifest = {
    version: '2.1.0',
    generator: 'Kostyanaya Kuznya Public Forge API',
    scale,
    pageSize,
    atlasStats: atlas.getStats(),
    totalFrames: frames.length,
    pages: pages.map((p) => ({
      pageIndex: p.pageIndex,
      width: p.width,
      height: p.height,
    })),
    frames,
    animations,
  };

  return {
    png: pages[0].png,
    json: JSON.stringify(manifest, null, 2),
    pages,
    manifest,
    atlas,
  };
}

/**
 * Convenience helper to bake a complete multi-frame animated clip (all frames
 * of a unit action, creature action, building animation, or VFX) into `bakeAtlas`.
 */
export function bakeAnimatedUnitAtlas(
  seed: number,
  params: Omit<ProceduralHumanParams, 'seed' | 'frameIndex'> & { action?: UnitAnimationAction },
  options?: BakeAtlasOptions
): BakedAtlasOutput {
  const action: UnitAnimationAction = params.action ?? 'walk';
  const race = params.race ?? 'human';
  const spec =
    race === 'auto'
      ? getRaceActionSpec('human', action)
      : getRaceActionSpec(race, action);
  const items: AtlasBakeInputItem[] = [];
  for (let f = 0; f < spec.frameCount; f++) {
    items.push({
      kind: 'unit',
      seed,
      params: {
        ...params,
        action,
        frameIndex: f,
      },
    });
  }
  return bakeAtlas(items, options);
}

// ----------------------------------------------------------------------------
// 5. FULL PROJECT EXPORT ("ЭКСПОРТ ВСЕГО": RACES + BUILDINGS + 205 MODELS -> ZIP)
// ----------------------------------------------------------------------------

export interface FullExportArchiveResult {
  readonly filename: string;
  readonly zipBytes: Uint8Array;
  readonly entries: readonly { readonly name: string; readonly sizeBytes: number }[];
  readonly summary: {
    readonly totalRaces: number;
    readonly totalRoles: number;
    readonly totalRaceBuildings: number;
    readonly totalMedBronzeBuildings: number;
    readonly totalCatalogModels: number;
    readonly totalUnitFramesBaked: number;
    readonly totalBuildingFramesBaked: number;
    readonly totalModelFramesBaked: number;
  };
}

function appendAtlasPagesToZip(
  entries: ZipEntryInput[],
  prefix: string,
  baked: BakedAtlasOutput
): void {
  if (baked.pages.length === 1) {
    entries.push({ name: `${prefix}.png`, data: baked.png });
  } else {
    baked.pages.forEach((p) => {
      entries.push({ name: `${prefix}-p${p.pageIndex}.png`, data: p.png });
    });
  }
  entries.push({ name: `${prefix}.json`, data: baked.json });
}

/**
 * Generates a single ZIP archive containing baked PNG sprite sheets + JSON manifests
 * covering ALL 10 active races (all eras, genders, ages, roles, power ranks),
 * ALL 24 race buildings + 27 Medieval/Bronze buildings across 6 kingdoms, and
 * ALL 205 catalog models with phenotype variants.
 */
export function buildFullExportArchive(options?: {
  scale?: 1 | 2 | 4;
}): FullExportArchiveResult {
  const scale: 1 | 2 | 4 = options?.scale ?? 1;

  // 1. All 10 active races × 6 eras × system matrix (gender, age, roles, hierarchy)
  const unitItems: AtlasBakeInputItem[] = [];
  const allRoles = Object.keys(MEDIEVAL_ROLE_LABELS) as MedievalHumanRole[];
  const allRanks = Object.keys(POWER_RANK_LABELS) as PowerHierarchyRank[];

  ACTIVE_UNIT_RACES.forEach((race, rIdx) => {
    const era =
      race === 'hive-mind'
        ? 'primordial'
        : race === 'raptor-kin'
          ? 'dinosaurs'
          : race === 'neanderthal'
            ? 'ice-age'
            : ACTIVE_UNIT_ERAS[(rIdx + 3) % ACTIVE_UNIT_ERAS.length];

    // Male/Female + Child/Adult/Elder
    unitItems.push(
      { kind: 'unit', seed: 1000 + rIdx, params: { era, race, gender: 'male', age: 'adult', role: 'peasant', kingdomId: rIdx % 6 } },
      { kind: 'unit', seed: 1100 + rIdx, params: { era, race, gender: 'female', age: 'adult', role: 'peasant', kingdomId: rIdx % 6 } },
      { kind: 'unit', seed: 1200 + rIdx, params: { era, race, gender: 'male', age: 'child', role: 'peasant', kingdomId: rIdx % 6 } },
      { kind: 'unit', seed: 1300 + rIdx, params: { era, race, gender: 'male', age: 'elder', role: 'cleric', kingdomId: rIdx % 6 } }
    );
    // All 11 roles
    allRoles.forEach((role, roleIdx) => {
      unitItems.push({
        kind: 'unit',
        seed: 2000 + rIdx * 20 + roleIdx,
        params: {
          era,
          race,
          gender: role === 'queen' ? 'female' : 'male',
          age: 'adult',
          role,
          kingdomId: (rIdx + roleIdx) % 6,
        },
      });
    });
    // All 5 power ranks
    allRanks.forEach((powerRank, rkIdx) => {
      unitItems.push({
        kind: 'unit',
        seed: 3000 + rIdx * 10 + rkIdx,
        params: {
          era,
          race,
          gender: 'male',
          age: 'adult',
          role: powerRank === 'king' || powerRank === 'alliance-leader' ? 'king' : 'warrior',
          powerRank,
          kingdomId: rIdx % 6,
          alliedKingdomId: (rIdx + 3) % 6,
        },
      });
    });
  });

  const unitsAtlas = bakeAtlas(unitItems, { pageSize: 1024, scale });

  // 2. All 24 race buildings + all 27 Medieval & Bronze buildings across flagship kingdoms
  const buildingItems: AtlasBakeInputItem[] = [];
  ALL_RACE_BUILDINGS.forEach((b, idx) => {
    const k = FLAGSHIP_SIX_KINGDOMS[idx % FLAGSHIP_SIX_KINGDOMS.length];
    buildingItems.push({
      kind: 'building',
      id: b.id,
      kingdom: k,
      state: 'ready',
      showShadow: true,
    });
  });

  const medBronze = [...getAllMedievalAndBronzeBuildings(ALL_MODELS), MEDIEVAL_TOWN_HALL];
  medBronze.forEach((b) => {
    FLAGSHIP_SIX_KINGDOMS.forEach((k) => {
      buildingItems.push({
        kind: 'building',
        id: b.id,
        kingdom: k,
        state: 'ready',
        showShadow: true,
      });
    });
  });

  const buildingsAtlas = bakeAtlas(buildingItems, { pageSize: 2048, scale });

  // 3. All 205 catalog models (base + genetic phenotype variant)
  const modelItems: AtlasBakeInputItem[] = [];
  const schemas = getAllModelPhenotypeSchemas(ALL_MODELS);
  ALL_MODELS.forEach((m, idx) => {
    const et = getModelEntityType(m);
    const era = getModelEra(m);
    if (et === 'building') {
      modelItems.push({
        kind: 'building',
        key: `m_${m.id}_base`,
        id: m.id,
        kingdom: idx % 6,
        state: 'ready',
        showShadow: m.supportsShadow !== false,
      });
    } else if (et === 'creature' || et === 'unit') {
      modelItems.push({
        kind: 'creature',
        key: `m_${m.id}_var0`,
        species: m.id,
        genes: { coat: 'natural', pattern: 'solid', size: 'standard', biomeTint: 'none', appendages: 'standard' },
        seed: 500 + idx,
        kingdomId: idx % 6,
        showShadow: m.supportsShadow !== false,
      });
      modelItems.push({
        kind: 'creature',
        key: `m_${m.id}_var1`,
        species: m.id,
        genes: {
          coat: idx % 2 === 0 ? 'dark' : 'albino',
          pattern: idx % 2 === 0 ? 'striped' : 'spotted',
          size: idx % 3 === 0 ? 'colossal' : 'compact',
          biomeTint: era === 'ice-age' ? 'tundra' : era === 'dinosaurs' ? 'volcanic' : 'forest',
          appendages: 'ornate',
        },
        seed: 900 + idx,
        kingdomId: (idx + 2) % 6,
        showShadow: m.supportsShadow !== false,
      });
    } else {
      const buf = m.renderFrame(0, m.frameCount, {
        kingdomId: 'original',
        showShadow: m.supportsShadow !== false,
        stageBg: 'dark',
      });
      modelItems.push({
        kind: 'buffer',
        key: `m_${m.id}_nature`,
        buffer: buf,
        meta: { modelId: m.id, modelName: m.name, era, entityType: et },
      });
    }
  });

  const modelsAtlas = bakeAtlas(modelItems, { pageSize: 2048, scale });

  const zipInputs: ZipEntryInput[] = [];
  appendAtlasPagesToZip(zipInputs, '01-units-all-races', unitsAtlas);
  appendAtlasPagesToZip(zipInputs, '02-buildings-all-kingdoms', buildingsAtlas);
  appendAtlasPagesToZip(zipInputs, '03-models-205-phenotypes', modelsAtlas);

  const summary = {
    totalRaces: ACTIVE_UNIT_RACES.length,
    totalRoles: allRoles.length,
    totalRaceBuildings: ALL_RACE_BUILDINGS.length,
    totalMedBronzeBuildings: medBronze.length,
    totalCatalogModels: ALL_MODELS.length,
    totalUnitFramesBaked: unitsAtlas.manifest.totalFrames,
    totalBuildingFramesBaked: buildingsAtlas.manifest.totalFrames,
    totalModelFramesBaked: modelsAtlas.manifest.totalFrames,
  };

  const fullIndex = {
    version: '2.0.0',
    generator: 'Kostyanaya Kuznya — Full Export Bundle',
    scale,
    summary,
    palettes: {
      kingdoms: KINGDOM_PALETTES_84.length,
      skins: SKIN_PALETTES_14.length,
      hairs: HAIR_PALETTES_12.length,
    },
    phenotypeSchemas205: schemas,
  };
  zipInputs.push({
    name: 'manifest-index.json',
    data: JSON.stringify(fullIndex, null, 2),
  });

  const zipBytes = createZipArchive(zipInputs);
  return {
    filename: `kostyanaya-kuznya-full-export-${scale}x.zip`,
    zipBytes,
    entries: zipInputs.map((e) => ({
      name: e.name,
      sizeBytes: typeof e.data === 'string' ? new TextEncoder().encode(e.data).length : e.data.length,
    })),
    summary,
  };
}

export function triggerFullExportZipDownload(scale: 1 | 2 | 4 = 1): FullExportArchiveResult {
  const bundle = buildFullExportArchive({ scale });
  const copy = new Uint8Array(bundle.zipBytes.length);
  copy.set(bundle.zipBytes);
  const blob = new Blob([copy.buffer], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = bundle.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return bundle;
}
