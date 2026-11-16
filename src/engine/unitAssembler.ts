import { RAMPS, SHADOW_COLOR, SKIN_MASK, WATER_LINE } from './palette';
import { PixelBuffer } from './pixelCanvas';

/**
 * ============================================================================
 * MODULAR SANDBOX UNIT ASSEMBLER
 * ============================================================================
 * Implements the multi-part assembly pipeline for small-scale sandbox
 * creatures & humanoids:
 *
 * 1. BODY SHEET WITHOUT HEAD: `walk_0..3` and `swim_0..3` have NO head drawn on
 *    the torso; instead, each frame specifies `headAnchor` (2x2 box) and
 *    `itemAnchor` (1x3 hand slot) relative to `pivot` (bottom-center feet).
 * 2. NO BLACK OUTER CONTOUR: Micro-sprites (10..14px) rely on silhouette +
 *    top-lit contrast + dark eye/boot pixels rather than 1px black outlines.
 * 3. AUTOMATIC HEAD & ITEM BOBBING: Because `head` and `item` attach to the
 *    per-frame anchors, they bounce naturally with walk/swim without separate
 *    head animation sheets.
 * 4. GROUND SHADOW (`unitShadow_N`): Fixed 3px-tall #11102B@40% shadow capsule
 *    anchored under `pivot` (does NOT rise with jump).
 * 5. WHOLE-SPRITE PROCEDURAL ACTIONS: Idle breathing, Attack tilt (±40° + slash arc),
 *    Damage flash (#FF1212 / white), Death fall (90° + darken + fade), and
 *    Dynamic Zombie (`applyZombieTransform`).
 * ============================================================================
 */

export type UnitMode = 'walk' | 'swim';
export type UnitAction = 'idle' | 'normal' | 'attack' | 'hit' | 'death' | 'zombie';

export interface AnchorRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface UnitFrameAnchors {
  readonly head: AnchorRect;
  readonly item: AnchorRect;
  readonly pivot: { readonly x: number; readonly y: number };
  readonly bodyOffsetY?: number;
}

export type PixelMatrix = readonly string[];

/**
 * Draws an ASCII-encoded pixel matrix using a legend map.
 * `.` or space is transparent.
 */
export function stampMatrix(
  buf: PixelBuffer,
  matrix: PixelMatrix,
  originX: number,
  originY: number,
  legend: Readonly<Record<string, string>>
): void {
  for (let row = 0; row < matrix.length; row++) {
    const line = matrix[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === '.' || ch === ' ') continue;
      const color = legend[ch];
      if (color) {
        buf.setPixel(originX + col, originY + row, color);
      }
    }
  }
}

/**
 * Draws a 3px-tall dark indigo ground shadow (`unitShadow_N`)
 * using `#11102B66` directly beneath the sprite's feet (`pivot`).
 */
export function drawUnitShadow(
  buf: PixelBuffer,
  pivotX: number,
  pivotY: number,
  width = 7
): void {
  const half = Math.max(2, Math.floor(width / 2));
  buf.fillEllipse(pivotX, pivotY, half, 1.35, SHADOW_COLOR);
}

/**
 * Draws a crisp procedural curved slash arc (`effects/slashes/*`)
 * on the left (facing) side during attack frames.
 */
export function drawSlashArc(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  progress: number,
  radius = 7.5
): void {
  const sweep = Math.PI * 0.92;
  const start = Math.PI * 0.62;
  const steps = 12;
  const maxStep = Math.max(2, Math.round(progress * steps));
  for (let i = 0; i <= maxStep; i++) {
    const a = start + (i / steps) * sweep;
    const x = Math.round(cx + Math.cos(a) * radius);
    const y = Math.round(cy + Math.sin(a) * radius);
    buf.setPixel(x, y, i >= maxStep - 1 ? '#FFFFFF' : RAMPS.ice.highlight);
    buf.setPixel(x + 1, y, RAMPS.ice.mid);
  }
}

/**
 * Shared modular legend supporting K1 (1..4), K2 (a..d), Skin (S,s,z,Z),
 * Steel/Marble (M,I,i,k,K), Gold (G,g,o), Timber/Leather (T,t,u,U),
 * Bone (B,p,q), Crimson/Ginger (R,r,v), Moss/Forest (F,f,e,E),
 * Ice Crystal (C,Q,N,X), Obsidian (O,V), Linen/Ermine (J,j),
 * Dark eyes/boots (D), Hair (H,h,Y,y), Water (W,w), Lava (L,l).
 */
export const UNIT_LEGEND: Readonly<Record<string, string>> = {
  // K1_MASK (primary kingdom color)
  '1': RAMPS.magenta.highlight,
  '2': RAMPS.magenta.mid,
  '3': RAMPS.magenta.shadow,
  '4': RAMPS.magenta.deep,
  // K2_MASK (secondary kingdom color)
  a: RAMPS.cyanMask.highlight,
  b: RAMPS.cyanMask.mid,
  c: RAMPS.cyanMask.shadow,
  d: RAMPS.cyanMask.deep,
  // SKIN_MASK
  S: SKIN_MASK[0],
  s: SKIN_MASK[1],
  z: SKIN_MASK[2],
  Z: SKIN_MASK[3],
  // Steel / Iron / Slate
  M: RAMPS.marble.highlight,
  I: RAMPS.marble.mid,
  i: RAMPS.slate.highlight,
  k: RAMPS.slate.shadow,
  K: RAMPS.slate.deep,
  // Gold / Brass
  G: RAMPS.gold.highlight,
  g: RAMPS.gold.mid,
  o: RAMPS.gold.shadow,
  // Timber / Leather
  T: RAMPS.timber.highlight,
  t: RAMPS.timber.mid,
  u: RAMPS.timber.shadow,
  U: RAMPS.timber.deep,
  // Bone / Ivory
  B: RAMPS.bone.highlight,
  p: RAMPS.bone.mid,
  q: RAMPS.bone.shadow,
  // Sandstone / Straw / Tan
  P: RAMPS.sandstone.highlight,
  // Crimson / Ginger Beard / Cloth
  R: '#E86A35',
  r: '#B53B1D',
  v: '#701D12',
  // Forest / Moss (non-SKIN_MASK greens)
  F: RAMPS.moss.highlight,
  f: RAMPS.moss.mid,
  e: RAMPS.moss.shadow,
  E: RAMPS.moss.deep,
  // Ice Crystal
  C: RAMPS.ice.highlight,
  Q: RAMPS.ice.mid,
  N: RAMPS.ice.shadow,
  X: RAMPS.ice.deep,
  // Obsidian armor
  O: RAMPS.obsidian.mid,
  V: RAMPS.obsidian.shadow,
  // Ermine / Sail / Linen
  J: RAMPS.sail.highlight,
  j: RAMPS.sail.mid,
  // Dark eyes / details (NO full outline!)
  D: '#1D1A18',
  // Hair tones
  H: '#5C4417',
  h: '#2D2311',
  Y: '#E8C547',
  y: '#B08A1E',
  // Waterline
  W: WATER_LINE.light,
  w: WATER_LINE.mid,
  // Lava / Magma glow
  L: RAMPS.lava.highlight,
  l: RAMPS.lava.mid,
  // Specular glint
  A: '#FFFFFF',
};

export interface ModularHumanoidSpec {
  readonly width: number;
  readonly height: number;
  readonly walkFrames: readonly { body: PixelMatrix; anchors: UnitFrameAnchors }[];
  readonly swimFrames: readonly { body: PixelMatrix; anchors: UnitFrameAnchors }[];
  readonly head: { matrix: PixelMatrix; offsetX: number; offsetY: number };
  readonly item: { matrix: PixelMatrix; offsetX: number; offsetY: number };
  readonly back?: {
    matrix?: PixelMatrix;
    frames?: readonly PixelMatrix[];
    offsetX: number;
    offsetY: number;
    showInSwim?: boolean;
  };
  readonly offhand?: {
    matrix: PixelMatrix;
    offsetX: number;
    offsetY: number;
  };
  readonly weaponSwing?: { readonly ampX?: number; readonly ampY?: number };
  readonly offhandSwing?: { readonly ampX?: number; readonly ampY?: number };
  readonly onBackSculpt?: (
    buf: PixelBuffer,
    frameIndex: number,
    totalFrames: number,
    bodyOriginX: number,
    bodyOriginY: number,
    mode: UnitMode
  ) => void;
  readonly onFrontSculpt?: (
    buf: PixelBuffer,
    frameIndex: number,
    totalFrames: number,
    bodyOriginX: number,
    bodyOriginY: number,
    mode: UnitMode,
    anchors: UnitFrameAnchors
  ) => void;
  readonly shadowWidth: number;
}

/**
 * Procedural billowing cape with K1/trim folds and smooth 12-frame sine wave.
 */
export function drawWavingCape(
  buf: PixelBuffer,
  shoulderX: number,
  shoulderY: number,
  width: number,
  length: number,
  t: number,
  useK1 = true,
  trimColor?: string
): void {
  const light = useK1 ? RAMPS.magenta.highlight : RAMPS.slate.highlight;
  const mid = useK1 ? RAMPS.magenta.mid : RAMPS.slate.mid;
  const shadow = useK1 ? RAMPS.magenta.shadow : RAMPS.slate.shadow;
  const deep = useK1 ? RAMPS.magenta.deep : RAMPS.slate.deep;

  for (let row = 0; row < length; row++) {
    const progress = row / Math.max(1, length - 1);
    const wave = Math.sin(t - row * 0.55) * (0.6 + progress * 1.4);
    const rowWidth = Math.round(width + progress * 2.5);
    const startX = Math.round(shoulderX + progress * 1.8 + wave);
    for (let dx = 0; dx < rowWidth; dx++) {
      const px = startX + dx;
      const py = shoulderY + row;
      if (trimColor && (dx === rowWidth - 1 || row === length - 1)) {
        buf.setPixel(px, py, trimColor);
      } else if (dx === 0 && progress < 0.5) {
        buf.setPixel(px, py, light);
      } else if (dx > rowWidth - 2 || progress > 0.72) {
        buf.setPixel(px, py, deep);
      } else if ((dx + Math.round(Math.sin(t + dx))) % 3 === 0) {
        buf.setPixel(px, py, shadow);
      } else {
        buf.setPixel(px, py, mid);
      }
    }
  }
}

/**
 * Procedural feathered Valkyrie / Angel wings with 12-frame downstroke flap.
 */
export function drawFeatheredWings(
  buf: PixelBuffer,
  rootX: number,
  rootY: number,
  span: number,
  t: number,
  primary: string = RAMPS.marble.highlight,
  mid: string = RAMPS.marble.mid,
  accent: string = RAMPS.gold.mid
): void {
  const flap = Math.sin(t);
  for (let side of [-1, 1] as const) {
    for (let i = 1; i <= span; i++) {
      const u = i / span;
      const wx = Math.round(rootX + side * (2 + i * 0.96));
      const wy = Math.round(rootY - 2 - Math.sin(u * 2.05) * (5.2 + flap * 2.2) + u * 2.8);
      const featherLen = Math.max(2, Math.round((1 - u * 0.35) * 6.5));
      for (let f = 0; f < featherLen; f++) {
        const col = f === 0 ? primary : f === featherLen - 1 ? accent : mid;
        buf.setPixel(wx, wy + f, col);
      }
    }
  }
}

/**
 * Procedural bat/demon wings with 12-frame articulated membrane curve.
 */
export function drawBatWings(
  buf: PixelBuffer,
  rootX: number,
  rootY: number,
  span: number,
  t: number
): void {
  const flap = Math.sin(t);
  for (let side of [-1, 1] as const) {
    const tipX = Math.round(rootX + side * span);
    const tipY = Math.round(rootY - 4 - flap * 2.8);
    const midX = Math.round(rootX + side * (span * 0.52));
    const midY = Math.round(rootY - 5 - flap * 2.0);
    buf.drawLine(rootX, rootY, midX, midY, RAMPS.obsidian.highlight, 1);
    buf.drawLine(midX, midY, tipX, tipY, RAMPS.obsidian.mid, 1);
    for (let i = 1; i <= span; i++) {
      const u = i / span;
      const topX = Math.round(rootX + side * i);
      const topY = Math.round(
        rootY - (u < 0.5 ? u * 2 * (rootY - midY) : (rootY - midY) + (u - 0.5) * 2 * (midY - tipY))
      );
      const memH = Math.max(1, Math.round((1 - Math.abs(u - 0.45)) * 4.5));
      for (let m = 1; m <= memH; m++) {
        const c = m === 1 ? RAMPS.magenta.mid : m === memH ? RAMPS.magenta.deep : RAMPS.magenta.shadow;
        buf.setPixel(topX, topY + m, c);
      }
    }
  }
}

/**
 * Rotating astrolabe / arcane rune ring behind mages & chronomancers.
 */
export function drawAstrolabeHalo(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  radius: number,
  t: number,
  ringColor: string = RAMPS.gold.mid,
  orbColor: string = RAMPS.cyanMask.highlight
): void {
  const dots = 12;
  for (let i = 0; i < dots; i++) {
    const a = t + (i / dots) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * radius);
    const y = Math.round(cy + Math.sin(a) * (radius * 0.85));
    buf.setPixel(x, y, i % 3 === 0 ? orbColor : ringColor);
  }
}

/**
 * Spinning twin-blade brass propeller for steampunk aviators.
 */
export function drawSpinningPropeller(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  radius: number,
  t: number
): void {
  for (const offset of [0, Math.PI / 2]) {
    const a = t * 2 + offset;
    const x1 = Math.round(cx - Math.cos(a) * radius);
    const y1 = Math.round(cy - Math.sin(a) * radius);
    const x2 = Math.round(cx + Math.cos(a) * radius);
    const y2 = Math.round(cy + Math.sin(a) * radius);
    buf.drawLine(x1, y1, x2, y2, RAMPS.gold.highlight, 1);
  }
  buf.fillRect(cx - 1, cy - 1, 2, 2, RAMPS.obsidian.highlight);
}

/**
 * Assembles a modular humanoid frame,
 * returning both the composed PixelBuffer and the active anchor geometry.
 */
export function assembleModularUnitFrame(
  spec: ModularHumanoidSpec,
  frameIndex: number,
  totalFrames: number,
  mode: UnitMode,
  action: UnitAction,
  showShadow = true
): { buffer: PixelBuffer; anchors: UnitFrameAnchors } {
  const seq = mode === 'swim' ? spec.swimFrames : spec.walkFrames;
  const isIdle = action === 'idle';
  const seqIdx = isIdle
    ? 0
    : Math.floor((frameIndex / Math.max(1, totalFrames)) * seq.length) % seq.length;
  const baseFrame = seq[seqIdx];
  const t = (frameIndex / Math.max(1, totalFrames)) * Math.PI * 2;
  const idleBreathY = isIdle && Math.sin(t) > 0.35 ? -1 : 0;

  const swingX =
    mode === 'swim' || isIdle ? 0 : Math.round(Math.sin(t) * (spec.weaponSwing?.ampX ?? 0.9));
  const swingY =
    mode === 'swim'
      ? 0
      : isIdle
        ? idleBreathY
        : Math.round(Math.cos(t * 2) * (spec.weaponSwing?.ampY ?? 0.8));
  const offX =
    mode === 'swim' || isIdle ? 0 : Math.round(-Math.sin(t) * (spec.offhandSwing?.ampX ?? 0.6));
  const offY =
    mode === 'swim'
      ? 0
      : isIdle
        ? idleBreathY
        : Math.round(Math.sin(t) * (spec.offhandSwing?.ampY ?? 0.7));

  const anchors: UnitFrameAnchors = {
    head: {
      ...baseFrame.anchors.head,
      y: baseFrame.anchors.head.y + idleBreathY,
    },
    item: {
      ...baseFrame.anchors.item,
      x: baseFrame.anchors.item.x + swingX,
      y: baseFrame.anchors.item.y + swingY,
    },
    pivot: baseFrame.anchors.pivot,
    bodyOffsetY: (baseFrame.anchors.bodyOffsetY ?? 0) + idleBreathY,
  };

  const spriteLayer = new PixelBuffer(spec.width, spec.height);
  const bodyOriginX = Math.round(anchors.pivot.x - baseFrame.body[0].length / 2);
  const bodyOriginY = Math.round(
    anchors.pivot.y - baseFrame.body.length + 1 + (anchors.bodyOffsetY ?? 0)
  );

  // 0. Optional Back module (capes, wings, quivers, trophy racks, procedural aura)
  if (spec.onBackSculpt) {
    spec.onBackSculpt(spriteLayer, frameIndex, totalFrames, bodyOriginX, bodyOriginY, mode);
  }
  if (spec.back && (mode !== 'swim' || spec.back.showInSwim)) {
    const backMatrix =
      spec.back.frames && spec.back.frames.length > 0
        ? spec.back.frames[seqIdx % spec.back.frames.length]
        : spec.back.matrix;
    if (backMatrix) {
      stampMatrix(
        spriteLayer,
        backMatrix,
        bodyOriginX + spec.back.offsetX,
        bodyOriginY + spec.back.offsetY,
        UNIT_LEGEND
      );
    }
  }

  // 1. Stamp headless body (with K1/K2/SKIN masks)
  stampMatrix(spriteLayer, baseFrame.body, bodyOriginX, bodyOriginY, UNIT_LEGEND);

  // 2. Attach detachable Head at *_head marker
  stampMatrix(
    spriteLayer,
    spec.head.matrix,
    anchors.head.x + spec.head.offsetX,
    anchors.head.y + spec.head.offsetY,
    UNIT_LEGEND
  );

  // 3. Attach held Item at *_item marker (hidden when submerged in swim)
  if (mode !== 'swim') {
    stampMatrix(
      spriteLayer,
      spec.item.matrix,
      anchors.item.x + spec.item.offsetX,
      anchors.item.y + spec.item.offsetY,
      UNIT_LEGEND
    );
  }

  // 3b. Optional Offhand module (shields, bucklers, spellbooks, orbs)
  if (spec.offhand && mode !== 'swim') {
    stampMatrix(
      spriteLayer,
      spec.offhand.matrix,
      bodyOriginX + spec.offhand.offsetX + offX,
      bodyOriginY + spec.offhand.offsetY + offY,
      UNIT_LEGEND
    );
  }

  // 3c. Optional Foreground 12-frame procedural details (sparks, runes, glints, embers)
  if (spec.onFrontSculpt) {
    spec.onFrontSculpt(spriteLayer, frameIndex, totalFrames, bodyOriginX, bodyOriginY, mode, anchors);
  }

  // 4. Whole-sprite procedural transforms
  const phase = frameIndex / Math.max(1, totalFrames);
  let transformed = spriteLayer;

  if (action === 'attack') {
    const swingCurve = Math.sin(phase * Math.PI * 2);
    const tiltDeg = swingCurve > 0 ? -36 * swingCurve : 12 * swingCurve;
    transformed = spriteLayer.rotateAround(
      anchors.pivot.x,
      anchors.pivot.y,
      tiltDeg
    );
    if (swingCurve > 0.15) {
      drawSlashArc(
        transformed,
        anchors.item.x - 1,
        anchors.item.y - 3,
        Math.min(1, swingCurve),
        spec.width >= 36 ? 9 : 7.5
      );
    }
  } else if (action === 'hit') {
    const flash = Math.abs(Math.sin(phase * Math.PI * 2));
    transformed = spriteLayer.applyColorOverlay(
      flash > 0.5 ? '#FFFFFF' : '#FF1212',
      0.55 + flash * 0.25
    );
  } else if (action === 'death') {
    const rot = Math.min(90, phase * 220);
    const darken = phase > 0.35 ? Math.min(0.85, (phase - 0.35) * 1.6) : 0;
    const alpha = phase > 0.7 ? Math.max(0.25, 1 - (phase - 0.7) * 2.2) : 1;
    transformed = spriteLayer
      .rotateAround(anchors.pivot.x, anchors.pivot.y, rot)
      .applyColorOverlay('#090808', darken, alpha);
  } else if (action === 'zombie') {
    transformed = spriteLayer.applyZombieTransform('#3B8130');
  }

  // Ground shadows are now synthesized dynamically from the assembled silhouette
  // via the shape-based soft shadow engine inside renderModelWithContext.
  void showShadow;

  return { buffer: transformed, anchors };
}
