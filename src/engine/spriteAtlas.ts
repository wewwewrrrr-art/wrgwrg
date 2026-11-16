import { hexToRgba } from './palette';
import { PixelBuffer, buildFrameCacheKey } from './pixelCanvas';
import { serializeGenesKey } from './genes';
import { PixelModelDef, RenderContextOptions } from '../models/types';

export const ATLAS_PAGE_SIZE = 1024;

export interface AtlasRegion {
  readonly key: string;
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AtlasStats {
  readonly pageSize: number;
  readonly pagesCount: number;
  readonly bakedFrames: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly fillRatio: number;
}

interface AtlasPage {
  readonly index: number;
  readonly rgba: Uint8ClampedArray;
  cursorX: number;
  cursorY: number;
  shelfHeight: number;
  usedArea: number;
  canvas?: HTMLCanvasElement | null;
  dirty: boolean;
}

export class BakedSpriteAtlas {
  private readonly pageSize: number;
  private pages: AtlasPage[] = [];
  private regions = new Map<string, AtlasRegion>();
  private buffers = new Map<string, PixelBuffer>();
  private rgbaCache = new Map<string, readonly [number, number, number, number]>();
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(pageSize = ATLAS_PAGE_SIZE) {
    this.pageSize = pageSize;
  }

  private createPage(): AtlasPage {
    const page: AtlasPage = {
      index: this.pages.length,
      rgba: new Uint8ClampedArray(this.pageSize * this.pageSize * 4),
      cursorX: 1,
      cursorY: 1,
      shelfHeight: 0,
      usedArea: 0,
      canvas: null,
      dirty: true,
    };
    this.pages.push(page);
    return page;
  }

  private allocateSlot(w: number, h: number): { page: AtlasPage; x: number; y: number } {
    const padW = w + 1;
    const padH = h + 1;
    let page = this.pages[this.pages.length - 1];
    if (!page) {
      page = this.createPage();
    }

    if (page.cursorX + padW > this.pageSize) {
      page.cursorX = 1;
      page.cursorY += page.shelfHeight + 1;
      page.shelfHeight = 0;
    }

    if (page.cursorY + padH > this.pageSize) {
      page = this.createPage();
    }

    const x = page.cursorX;
    const y = page.cursorY;
    page.cursorX += padW;
    if (h > page.shelfHeight) page.shelfHeight = h;
    page.usedArea += w * h;
    return { page, x, y };
  }

  private blitBufferIntoPage(page: AtlasPage, buf: PixelBuffer, destX: number, destY: number): void {
    const stride = this.pageSize * 4;
    const src = buf.getRawGrid();
    const w = buf.width;
    const h = buf.height;
    const pageRgba = page.rgba;
    for (let y = 0; y < h; y++) {
      const rowOffset = (destY + y) * stride;
      const srcRow = y * w;
      for (let x = 0; x < w; x++) {
        const hex = src[srcRow + x];
        if (!hex) continue;
        let rgba = this.rgbaCache.get(hex);
        if (!rgba) {
          rgba = hexToRgba(hex);
          if (this.rgbaCache.size < 4096) this.rgbaCache.set(hex, rgba);
        }
        const idx = rowOffset + (destX + x) * 4;
        pageRgba[idx] = rgba[0];
        pageRgba[idx + 1] = rgba[1];
        pageRgba[idx + 2] = rgba[2];
        pageRgba[idx + 3] = rgba[3];
      }
    }
    page.dirty = true;
  }

  getOrBake(
    key: string,
    producer: () => PixelBuffer
  ): { region: AtlasRegion; buffer: PixelBuffer; fromCache: boolean } {
    const existing = this.regions.get(key);
    if (existing) {
      this.cacheHits++;
      return {
        region: existing,
        buffer: this.buffers.get(key)!,
        fromCache: true,
      };
    }

    this.cacheMisses++;
    const buf = producer();
    const { page, x, y } = this.allocateSlot(buf.width, buf.height);
    this.blitBufferIntoPage(page, buf, x, y);

    const region: AtlasRegion = {
      key,
      pageIndex: page.index,
      x,
      y,
      width: buf.width,
      height: buf.height,
    };
    this.regions.set(key, region);
    this.buffers.set(key, buf);
    return { region, buffer: buf, fromCache: false };
  }

  getPageCanvas(pageIndex: number): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;
    const page = this.pages[pageIndex];
    if (!page) return null;
    if (!page.canvas) {
      page.canvas = document.createElement('canvas');
      page.canvas.width = this.pageSize;
      page.canvas.height = this.pageSize;
      page.dirty = true;
    }
    if (page.dirty) {
      const ctx = page.canvas.getContext('2d');
      if (ctx) {
        const imgData = new ImageData(
          new Uint8ClampedArray(page.rgba),
          this.pageSize,
          this.pageSize
        );
        ctx.putImageData(imgData, 0, 0);
      }
      page.dirty = false;
    }
    return page.canvas;
  }

  getStats(): AtlasStats {
    const totalCap = Math.max(1, this.pages.length * this.pageSize * this.pageSize);
    const totalUsed = this.pages.reduce((acc, p) => acc + p.usedArea, 0);
    return {
      pageSize: this.pageSize,
      pagesCount: this.pages.length,
      bakedFrames: this.regions.size,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      fillRatio: Number((totalUsed / totalCap).toFixed(4)),
    };
  }

  clear(): void {
    this.pages = [];
    this.regions.clear();
    this.buffers.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
}

export const globalSpriteAtlas = new BakedSpriteAtlas();

export type FrameProducer = (
  model: PixelModelDef,
  frameIndex: number,
  ctx?: RenderContextOptions
) => PixelBuffer;

export function buildAtlasFrameKey(
  model: PixelModelDef,
  frameIndex: number,
  ctx?: RenderContextOptions
): string {
  const safeFrame = ((frameIndex % model.frameCount) + model.frameCount) % model.frameCount;
  return buildFrameCacheKey({
    modelId: model.id,
    frame: safeFrame,
    kingdomId: ctx?.kingdomId ?? 'original',
    phenotypeId: ctx?.phenotypeId ?? model.unitMeta?.defaultPhenotype ?? 'skin_light',
    unitMode: ctx?.unitMode ?? 'walk',
    unitAction: ctx?.unitAction ?? 'normal',
    showShadow: ctx?.showShadow !== false,
    stageBg: ctx?.stageBg ?? 'dark',
    genesKey: serializeGenesKey(ctx?.genes),
    buildingState: ctx?.buildingState ?? 'ready',
  });
}

export function getOrBakeFrame(
  model: PixelModelDef,
  frameIndex: number,
  ctx: RenderContextOptions | undefined,
  producer: FrameProducer,
  atlas: BakedSpriteAtlas = globalSpriteAtlas
): { region: AtlasRegion; buffer: PixelBuffer; fromCache: boolean } {
  const safeFrame = ((frameIndex % model.frameCount) + model.frameCount) % model.frameCount;
  const key = buildAtlasFrameKey(model, safeFrame, ctx);
  return atlas.getOrBake(key, () => producer(model, safeFrame, ctx));
}

export function bakeModelVariant(
  model: PixelModelDef,
  ctx: RenderContextOptions | undefined,
  producer: FrameProducer,
  atlas: BakedSpriteAtlas = globalSpriteAtlas
): AtlasRegion[] {
  const regions: AtlasRegion[] = [];
  for (let f = 0; f < model.frameCount; f++) {
    const res = getOrBakeFrame(model, f, ctx, producer, atlas);
    regions.push(res.region);
  }
  return regions;
}

/**
 * Draws a pre-baked sprite frame straight from the packed atlas HTMLCanvasElement page
 * onto any 2D target context via a single hardware-accelerated `drawImage` blit.
 */
export function drawBakedSpriteToCanvas(
  targetCtx: CanvasRenderingContext2D,
  model: PixelModelDef,
  frameIndex: number,
  ctx: RenderContextOptions | undefined,
  producer: FrameProducer,
  dx: number,
  dy: number,
  scale = 1,
  atlas: BakedSpriteAtlas = globalSpriteAtlas
): AtlasRegion | null {
  const { region } = getOrBakeFrame(model, frameIndex, ctx, producer, atlas);
  const pageCanvas = atlas.getPageCanvas(region.pageIndex);
  if (!pageCanvas) return null;
  targetCtx.imageSmoothingEnabled = false;
  targetCtx.drawImage(
    pageCanvas,
    region.x,
    region.y,
    region.width,
    region.height,
    dx,
    dy,
    region.width * scale,
    region.height * scale
  );
  return region;
}

export interface AtlasBenchmarkResult {
  readonly entityCount: number;
  readonly uniqueVariants: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly pagesUsed: number;
  readonly elapsedMs: number;
}

/**
 * Verifies instanced crowd throughput by baking unique variants once
 * and resolving 20,000+ creature draw lookups directly from the atlas cache.
 */
export function runAtlasInstancingBenchmark(
  models: PixelModelDef[],
  producer: FrameProducer,
  entityCount = 20000
): AtlasBenchmarkResult {
  const atlas = new BakedSpriteAtlas(1024);
  const kingdoms = ['red', 'blue', 'green', 'yellow'] as const;
  const actions = ['idle', 'normal', 'attack'] as const;
  const subset = models.slice(0, Math.min(8, models.length));

  const start = performance.now();
  for (let i = 0; i < entityCount; i++) {
    const model = subset[i % subset.length];
    const kingdomId = kingdoms[(i >> 3) % kingdoms.length];
    const unitAction = actions[(i >> 5) % actions.length];
    const frame = (i * 3) % model.frameCount;
    getOrBakeFrame(model, frame, { kingdomId, unitAction, showShadow: true, stageBg: 'meadow' }, producer, atlas);
  }
  const elapsedMs = Number((performance.now() - start).toFixed(2));
  const stats = atlas.getStats();

  return {
    entityCount,
    uniqueVariants: stats.bakedFrames,
    cacheHits: stats.cacheHits,
    cacheMisses: stats.cacheMisses,
    pagesUsed: stats.pagesCount,
    elapsedMs,
  };
}
