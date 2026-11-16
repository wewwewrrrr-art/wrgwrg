import {
  INK,
  K1_MASK,
  K2_MASK,
  MaterialRamp,
  RAMPS,
  SHADOW_COLOR,
  SKIN_MASK,
  VOID,
  hexToRgba,
  rgbToHex,
} from './palette';

/**
 * ============================================================================
 * PURE-CODE PIXEL BUFFER ENGINE & FRAME ATLAS CACHE
 * ============================================================================
 * Core integer-grid rasterizer with zero DOM dependencies.
 *
 * CRITICAL DESIGN INVARIANTS:
 * 1. SUB-ASSEMBLY LAYERING (`layer(...)`): Drawing parts inside `buf.layer(fn)`
 *    separates overlapping assemblies using a darker tone of their own material
 *    (borderless, zero `#131110` black outer contour).
 * 2. EXACT MASK RECOLORING (`recolorWithLookup(...)`): Substitutes K1, K2,
 *    and SKIN_MASK pixels by exact uppercase hex match without mutating source.
 * 3. DETERMINISTIC FRAME CACHE (`FrameAtlasCache`): Caches recolored, shadowed,
 *    and genetically modified frames by key so frames are computed once and reused.
 * ============================================================================
 */

export interface PixelStats {
  opaquePixels: number;
  uniqueColors: number;
  darkPixels: number;
  k1Pixels: number;
  k2Pixels: number;
  skinPixels: number;
  semitransparentPixels: number;
}

export class PixelBuffer {
  readonly width: number;
  readonly height: number;
  private grid: (string | null)[];

  constructor(width: number, height: number, initialGrid?: (string | null)[]) {
    this.width = width;
    this.height = height;
    this.grid = initialGrid ?? new Array<string | null>(width * height).fill(null);
  }

  getRawGrid(): readonly (string | null)[] {
    return this.grid;
  }

  getPixel(x: number, y: number): string | null {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return null;
    return this.grid[iy * this.width + ix];
  }

  setPixel(x: number, y: number, color: string | null): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return;
    this.grid[iy * this.width + ix] = color ? color.toUpperCase() : null;
  }

  clone(): PixelBuffer {
    const copy = new PixelBuffer(this.width, this.height);
    for (let i = 0; i < this.grid.length; i++) {
      copy.grid[i] = this.grid[i];
    }
    return copy;
  }

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    const x1 = x0 + Math.round(w);
    const y1 = y0 + Math.round(h);
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        this.setPixel(px, py, color);
      }
    }
  }

  fillEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    colorFn: string | ((nx: number, ny: number, px: number, py: number) => string | null)
  ): void {
    const minX = Math.floor(cx - rx);
    const maxX = Math.ceil(cx + rx);
    const minY = Math.floor(cy - ry);
    const maxY = Math.ceil(cy + ry);
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const nx = (px - cx) / (rx || 1);
        const ny = (py - cy) / (ry || 1);
        if (nx * nx + ny * ny <= 1.02) {
          const color = typeof colorFn === 'string' ? colorFn : colorFn(nx, ny, px, py);
          if (color) this.setPixel(px, py, color);
        }
      }
    }
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, color: string, thickness = 1): void {
    let ix0 = Math.round(x0);
    let iy0 = Math.round(y0);
    const ix1 = Math.round(x1);
    const iy1 = Math.round(y1);
    const dx = Math.abs(ix1 - ix0);
    const dy = Math.abs(iy1 - iy0);
    const sx = ix0 < ix1 ? 1 : -1;
    const sy = iy0 < iy1 ? 1 : -1;
    let err = dx - dy;

    const plot = (px: number, py: number) => {
      if (thickness <= 1) {
        this.setPixel(px, py, color);
      } else {
        const r = Math.floor(thickness / 2);
        this.fillRect(px - r, py - r, thickness, thickness, color);
      }
    };

    while (true) {
      plot(ix0, iy0);
      if (ix0 === ix1 && iy0 === iy1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        ix0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        iy0 += sy;
      }
    }
  }

  drawRotatedRect(
    cx: number,
    cy: number,
    length: number,
    halfWidth: number,
    angleRad: number,
    colorFn: (u: number, v: number, px: number, py: number) => string | null
  ): void {
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const bound = Math.ceil(Math.hypot(length, halfWidth)) + 2;
    const minX = Math.floor(cx - bound);
    const maxX = Math.ceil(cx + bound);
    const minY = Math.floor(cy - bound);
    const maxY = Math.ceil(cy + bound);

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const rx = px - cx;
        const ry = py - cy;
        const u = rx * cos + ry * sin;
        const v = -rx * sin + ry * cos;
        if (u >= 0 && u <= length && Math.abs(v) <= halfWidth) {
          const c = colorFn(u / (length || 1), v / (halfWidth || 1), px, py);
          if (c) this.setPixel(px, py, c);
        }
      }
    }
  }

  /**
   * Sculpt a sub-assembly in an isolated buffer and separate overlapping regions
   * with a dark shade of their own material (never a black exterior contour).
   * If an explicit `outlineColor` other than INK is provided, stamps that border.
   */
  layer(drawFn: (sub: PixelBuffer) => void, outlineColor: string | null = null): void {
    const sub = new PixelBuffer(this.width, this.height);
    drawFn(sub);
    if (outlineColor && outlineColor.toUpperCase() !== INK.toUpperCase()) {
      sub.applyOutline(outlineColor);
    } else {
      this.applyMaterialSeamIsolation(sub);
    }
    this.composite(sub);
  }

  /**
   * Darkens existing parent pixels directly bordering `sub` by a material-hue
   * shade factor (~0.62) so overlapping assemblies stay crisp without black INK.
   */
  private applyMaterialSeamIsolation(sub: PixelBuffer): void {
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const parentHex = this.getPixel(x, y);
        if (!parentHex || sub.getPixel(x, y) !== null) continue;
        let touchesSub = false;
        for (const [dx, dy] of dirs) {
          if (sub.getPixel(x + dx, y + dy) !== null) {
            touchesSub = true;
            break;
          }
        }
        if (!touchesSub) continue;
        const [r, g, b, a] = hexToRgba(parentHex);
        if (a < 180) continue;
        const shaded = rgbToHex(
          Math.max(26, r * 0.62),
          Math.max(26, g * 0.62),
          Math.max(28, b * 0.64)
        );
        this.setPixel(x, y, shaded);
      }
    }
  }

  composite(src: PixelBuffer, offsetX = 0, offsetY = 0): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const c = src.getPixel(x, y);
        if (c !== null) {
          this.setPixel(x + offsetX, y + offsetY, c);
        }
      }
    }
  }

  /**
   * Composites `src` ONLY onto empty (transparent) pixels so ground shadows
   * sit cleanly behind the sprite without overwriting foreground boots.
   */
  compositeUnder(src: PixelBuffer, offsetX = 0, offsetY = 0): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const c = src.getPixel(x, y);
        if (c !== null && this.getPixel(x + offsetX, y + offsetY) === null) {
          this.setPixel(x + offsetX, y + offsetY, c);
        }
      }
    }
  }

  /**
   * Optional 4-connected 1px outline pass (never applied by default).
   */
  applyOutline(outlineColor: string = INK): void {
    const upperOutline = outlineColor.toUpperCase();
    const toOutline: [number, number][] = [];
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.getPixel(x, y) !== null) continue;
        for (const [dx, dy] of dirs) {
          const neighbor = this.getPixel(x + dx, y + dy);
          if (neighbor !== null && neighbor !== upperOutline) {
            toOutline.push([x, y]);
            break;
          }
        }
      }
    }

    for (const [x, y] of toOutline) {
      this.setPixel(x, y, upperOutline);
    }
  }

  /**
   * Exact RGB mask replacement returning a fresh PixelBuffer.
   */
  recolorWithLookup(lookup: ReadonlyMap<string, string>): PixelBuffer {
    const out = new PixelBuffer(this.width, this.height);
    for (let i = 0; i < this.grid.length; i++) {
      const c = this.grid[i];
      if (!c) continue;
      out.grid[i] = (lookup.get(c) ?? c).toUpperCase();
    }
    return out;
  }

  /**
   * Returns a cloned PixelBuffer with all pixels matching `colorHex` removed
   * (used when rendering without cast ground shadow `#11102B66`).
   */
  stripColor(colorHex: string = SHADOW_COLOR): PixelBuffer {
    const target = colorHex.toUpperCase();
    const out = new PixelBuffer(this.width, this.height);
    for (let i = 0; i < this.grid.length; i++) {
      const c = this.grid[i];
      if (!c || c === target) continue;
      out.grid[i] = c;
    }
    return out;
  }

  /**
   * Dynamic Zombie Transform:
   * 1. Multiply each non-shadow pixel by `zombieColorHex` (#3B8130 or #00AD2C)
   * 2. Pseudo-random per atlas coordinate: 50% blood multiply (#CE566E @ k=0.2),
   *    otherwise +0..19 brightness boost.
   */
  applyZombieTransform(zombieColorHex = '#3B8130'): PixelBuffer {
    const [zr, zg, zb] = hexToRgba(zombieColorHex);
    const [br, bg, bb] = hexToRgba('#CE566E');
    const out = new PixelBuffer(this.width, this.height);
    const shadowUpper = SHADOW_COLOR.toUpperCase();

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const c = this.getPixel(x, y);
        if (!c) continue;
        if (c === shadowUpper) {
          out.setPixel(x, y, c);
          continue;
        }
        const [r, g, b, a] = hexToRgba(c);
        // multiply(base, target, 1)
        let mr = (r * zr) / 255;
        let mg = (g * zg) / 255;
        let mb = (b * zb) / 255;
        const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        if (hash % 2 === 0) {
          // multiply(m, blood, 0.2)
          const lerp = (t: number) => 255 + (t - 255) * 0.2;
          mr = (mr * lerp(br)) / 255;
          mg = (mg * lerp(bg)) / 255;
          mb = (mb * lerp(bb)) / 255;
        } else {
          const boost = hash % 20;
          mr += boost;
          mg += boost;
          mb += boost;
        }
        if (a < 255) {
          out.setPixel(x, y, c);
        } else {
          out.setPixel(x, y, rgbToHex(mr, mg, mb));
        }
      }
    }
    return out;
  }

  /**
   * Nearest-neighbor whole-sprite rotation around `(pivotX, pivotY)`.
   * Used for attack tilt (±40°), unconscious/death fall (90°), avoiding extra frames.
   */
  rotateAround(pivotX: number, pivotY: number, angleDeg: number): PixelBuffer {
    if (Math.abs(angleDeg) < 0.5) return this.clone();
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const out = new PixelBuffer(this.width, this.height);

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const dx = x - pivotX;
        const dy = y - pivotY;
        const sx = Math.round(pivotX + dx * cos + dy * sin);
        const sy = Math.round(pivotY - dx * sin + dy * cos);
        const c = this.getPixel(sx, sy);
        if (c !== null) {
          out.setPixel(x, y, c);
        }
      }
    }
    return out;
  }

  /**
   * Whole-sprite tint / fade pass for Hit Flash (`damaged` #FF1212 / `highlighted` #FFFFFF)
   * or Death darken + fade.
   */
  applyColorOverlay(tintHex: string, strength: number, alphaScale = 1): PixelBuffer {
    const [tr, tg, tb] = hexToRgba(tintHex);
    const out = new PixelBuffer(this.width, this.height);
    const shadowUpper = SHADOW_COLOR.toUpperCase();

    for (let i = 0; i < this.grid.length; i++) {
      const c = this.grid[i];
      if (!c) continue;
      if (c === shadowUpper) {
        out.grid[i] = c;
        continue;
      }
      const [r, g, b, a] = hexToRgba(c);
      const nr = Math.round(r + (tr - r) * strength);
      const ng = Math.round(g + (tg - g) * strength);
      const nb = Math.round(b + (tb - b) * strength);
      const na = Math.max(0, Math.min(255, Math.round(a * alphaScale)));
      if (na === 0) continue;
      const hex = rgbToHex(nr, ng, nb);
      out.grid[i] =
        na < 255 ? `${hex}${na.toString(16).padStart(2, '0').toUpperCase()}` : hex;
    }
    return out;
  }

  /**
   * 3-stop curved bone rib arch or horn.
   */
  drawRibArch(
    x0: number,
    y0: number,
    cx: number,
    cy: number,
    x1: number,
    y1: number,
    thickness = 2,
    ramp: MaterialRamp = RAMPS.bone
  ): void {
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const px = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
      const py = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
      const c = t > 0.72 ? ramp.highlight : t > 0.3 ? ramp.mid : ramp.shadow;
      this.setPixel(px, py, c);
      if (thickness >= 2) {
        this.setPixel(px + 1, py, ramp.deep);
        this.setPixel(px, py - 1, t > 0.4 ? ramp.highlight : ramp.mid);
      }
    }
  }

  /**
   * Expressive pixel skull with deep VOID sockets and optional glowing eye color.
   */
  drawSkull(
    cx: number,
    cy: number,
    size: 'mini' | 'medium' | 'large',
    eyeColor: string = RAMPS.magenta.highlight,
    ramp: MaterialRamp = RAMPS.bone
  ): void {
    if (size === 'mini') {
      this.fillEllipse(cx, cy - 1, 3, 2.5, (nx, ny) =>
        ny < -0.2 ? ramp.highlight : nx > 0.3 ? ramp.shadow : ramp.mid
      );
      this.fillRect(cx - 2, cy + 1, 5, 2, ramp.mid);
      this.setPixel(cx - 1, cy - 1, eyeColor);
      this.setPixel(cx + 1, cy - 1, eyeColor);
      this.setPixel(cx, cy + 1, VOID);
      this.setPixel(cx - 1, cy + 2, ramp.highlight);
      this.setPixel(cx + 1, cy + 2, ramp.highlight);
      return;
    }

    if (size === 'medium') {
      this.fillEllipse(cx, cy - 1, 4.5, 4, (nx, ny) => {
        if (ny < -0.35 && nx < 0.35) return ramp.highlight;
        if (nx > 0.4 || ny > 0.5) return ramp.shadow;
        return ramp.mid;
      });
      this.fillRect(cx - 3, cy + 2, 7, 3, ramp.shadow);
      this.fillRect(cx - 3, cy - 1, 2, 2, VOID);
      this.fillRect(cx + 2, cy - 1, 2, 2, VOID);
      this.setPixel(cx - 2, cy, eyeColor);
      this.setPixel(cx + 2, cy, eyeColor);
      this.setPixel(cx, cy + 1, VOID);
      for (let tx = -2; tx <= 2; tx += 2) {
        this.setPixel(cx + tx, cy + 3, ramp.highlight);
      }
      return;
    }

    this.fillEllipse(cx, cy - 2, 6, 5, (nx, ny) => {
      if (ny < -0.4 && nx < 0.25) return ramp.highlight;
      if (nx > 0.4 || ny > 0.5) return ramp.shadow;
      return ramp.mid;
    });
    this.fillRect(cx - 4, cy + 3, 9, 3, ramp.shadow);
    this.fillRect(cx - 4, cy - 2, 3, 3, VOID);
    this.fillRect(cx + 2, cy - 2, 3, 3, VOID);
    this.setPixel(cx - 3, cy - 1, eyeColor);
    this.setPixel(cx + 3, cy - 1, eyeColor);
    this.fillRect(cx, cy + 1, 1, 2, VOID);
    for (let tx = -3; tx <= 3; tx += 2) {
      this.setPixel(cx + tx, cy + 4, ramp.highlight);
    }
  }

  /**
   * Faceted crystal cluster using any 4-stop ramp (defaults to K1 magenta channel).
   */
  drawCrystal(
    cx: number,
    baseY: number,
    height: number,
    tilt = 0,
    pulsePhase = 0,
    ramp: MaterialRamp = RAMPS.magenta
  ): void {
    const tip = pulsePhase > 0.5 ? '#FFFFFF' : ramp.highlight;
    for (let i = 0; i < height; i++) {
      const y = baseY - i;
      const x = cx + Math.round((i / height) * tilt);
      if (i < height * 0.72) {
        this.setPixel(x - 1, y, ramp.highlight);
        this.setPixel(x, y, i > height * 0.45 ? ramp.mid : ramp.shadow);
        this.setPixel(x + 1, y, ramp.deep);
      } else {
        this.setPixel(x, y, tip);
      }
    }
  }

  countOpaquePixels(): number {
    let count = 0;
    for (const p of this.grid) {
      if (p !== null) count++;
    }
    return count;
  }

  /**
   * Computes pixel composition telemetry.
   */
  countPixelStats(): PixelStats {
    const k1Set = new Set(K1_MASK.map((c) => c.toUpperCase()));
    const k2Set = new Set(K2_MASK.map((c) => c.toUpperCase()));
    const skinSet = new Set(SKIN_MASK.map((c) => c.toUpperCase()));
    const colors = new Set<string>();
    let opaquePixels = 0;
    let darkPixels = 0;
    let k1Pixels = 0;
    let k2Pixels = 0;
    let skinPixels = 0;
    let semitransparentPixels = 0;

    for (const p of this.grid) {
      if (!p) continue;
      opaquePixels++;
      colors.add(p);
      if (k1Set.has(p)) k1Pixels++;
      if (k2Set.has(p)) k2Pixels++;
      if (skinSet.has(p)) skinPixels++;
      const [r, g, b, a] = hexToRgba(p);
      if (a > 0 && a < 255) semitransparentPixels++;
      if (r < 55 && g < 55 && b < 55) darkPixels++;
    }

    return {
      opaquePixels,
      uniqueColors: colors.size,
      darkPixels,
      k1Pixels,
      k2Pixels,
      skinPixels,
      semitransparentPixels,
    };
  }

  /**
   * Verifies that every non-INK interior pixel has no un-outlined edge touching
   * transparent void (boundary pixels are expected to be INK).
   */
  hasClosedOutline(outlineColor: string = INK): boolean {
    const upperOutline = outlineColor.toUpperCase();
    const shadowUpper = SHADOW_COLOR.toUpperCase();
    const isShadowLike = (px: string | null) => {
      if (px === null || px === shadowUpper) return true;
      if (px.length === 9) {
        const [, , , a] = hexToRgba(px);
        if (a < 128) return true;
      }
      return false;
    };
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const c = this.getPixel(x, y);
        if (c === upperOutline || isShadowLike(c)) continue;
        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < this.width && ny < this.height) {
            const nb = this.getPixel(nx, ny);
            if (isShadowLike(nb)) return false;
          }
        }
      }
    }
    return true;
  }

  toRgbaBytes(): Uint8ClampedArray {
    const data = new Uint8ClampedArray(this.width * this.height * 4);
    for (let i = 0; i < this.grid.length; i++) {
      const hex = this.grid[i];
      if (!hex) continue;
      const [r, g, b, a] = hexToRgba(hex);
      const idx = i * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
    return data;
  }

  hashFrame(): string {
    let h = 2166136261;
    for (let i = 0; i < this.grid.length; i++) {
      const c = this.grid[i] ?? '_';
      for (let j = 0; j < c.length; j++) {
        h ^= c.charCodeAt(j);
        h = Math.imul(h, 16777619);
      }
    }
    return (h >>> 0).toString(16);
  }
}

/**
 * Deterministic render cache key:
 * `key = modelId | kingdom | phenotype | mode | action | shadowStage | genesKey | frame`
 */
export function buildFrameCacheKey(params: {
  modelId: string;
  frame: number;
  kingdomId: string;
  phenotypeId: string;
  unitMode: string;
  unitAction: string;
  showShadow?: boolean;
  stageBg?: string;
  genesKey?: string;
  buildingState?: string;
}): string {
  const shadowFlag = params.showShadow === false ? 'noshadow' : `shadow_${params.stageBg ?? 'dark'}`;
  const genesPart = params.genesKey ? `|${params.genesKey}` : '';
  const statePart =
    params.buildingState && params.buildingState !== 'ready' ? `|b_${params.buildingState}` : '';
  return `${params.modelId}|${params.kingdomId}|${params.phenotypeId}|${params.unitMode}|${params.unitAction}|${shadowFlag}${genesPart}${statePart}|${params.frame}`;
}

export class FrameAtlasCache {
  private readonly maxEntries = 512;
  private cache = new Map<string, PixelBuffer>();

  get(key: string): PixelBuffer | undefined {
    return this.cache.get(key);
  }

  set(key: string, buf: PixelBuffer): void {
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, buf);
  }

  get size(): number {
    return this.cache.size;
  }
}

export const globalFrameCache = new FrameAtlasCache();
