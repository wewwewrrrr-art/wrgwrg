import { PixelBuffer } from './pixelCanvas';

/**
 * ============================================================================
 * PIXEL VFX ENGINE (КОСТЯНАЯ КУЗНЯ)
 * ============================================================================
 * Strictly borderless, 100% opaque pixel-art effects:
 *  - <= 8 unique opaque colors per frame
 *  - 0 semitransparent pixels (alpha === 255 for every non-null pixel)
 *  - 0 #131110 INK pixels
 *
 * Effects covered:
 *  - blood  : arterial pixel droplets arcing & spattering (4 frames, 12x12)
 *  - dust   : warm footstep dust puffs billowing & breaking up (4 frames, 10x10)
 *  - sparks : bright impact / forge sparks starburst (4 frames, 12x12)
 *  - arrow  : feathered arrow in crisp horizontal flight (4 frames, 12x6)
 *  - magic  : cleric / arcane star-rune flash & pulse (4 frames, 14x14)
 * ============================================================================
 */

export type VfxEffectId = 'blood' | 'dust' | 'sparks' | 'arrow' | 'magic';

export interface VfxSpec {
  readonly id: VfxEffectId;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly frameCount: 4;
  readonly frameDurationsMs: readonly number[];
  readonly loop: boolean;
}

export const PIXEL_VFX_SPECS: Readonly<Record<VfxEffectId, VfxSpec>> = {
  blood: {
    id: 'blood',
    label: 'Кровь',
    width: 12,
    height: 12,
    frameCount: 4,
    frameDurationsMs: [75, 85, 95, 130],
    loop: false,
  },
  dust: {
    id: 'dust',
    label: 'Пыль шагов',
    width: 10,
    height: 10,
    frameCount: 4,
    frameDurationsMs: [90, 100, 110, 110],
    loop: false,
  },
  sparks: {
    id: 'sparks',
    label: 'Искры удара',
    width: 12,
    height: 12,
    frameCount: 4,
    frameDurationsMs: [65, 75, 85, 95],
    loop: false,
  },
  arrow: {
    id: 'arrow',
    label: 'Стрела в полёте',
    width: 12,
    height: 6,
    frameCount: 4,
    frameDurationsMs: [70, 70, 70, 70],
    loop: true,
  },
  magic: {
    id: 'magic',
    label: 'Вспышка магии',
    width: 14,
    height: 14,
    frameCount: 4,
    frameDurationsMs: [90, 95, 110, 120],
    loop: false,
  },
};

export const PIXEL_VFX_IDS: readonly VfxEffectId[] = [
  'blood',
  'dust',
  'sparks',
  'arrow',
  'magic',
];

const BLOOD_PAL = {
  bright: '#F87171',
  mid: '#DC2626',
  shadow: '#991B1B',
  deep: '#5C1111',
} as const;

const DUST_PAL = {
  hi: '#E5DEC7',
  mid: '#C4B38E',
  sh: '#968462',
  dp: '#6B5C41',
} as const;

const SPARK_PAL = {
  core: '#FFF7C2',
  gold: '#FACC15',
  amber: '#F97316',
  ember: '#B91C1C',
} as const;

const ARROW_PAL = {
  tipHi: '#E2E8F0',
  tipDark: '#64748B',
  shaft: '#A66C3A',
  shaftDark: '#633C1D',
  fletchHi: '#F43F5E',
  fletchDark: '#9F1239',
  wind: '#CBD5E1',
} as const;

const MAGIC_PAL = {
  core: '#F8FAFC',
  cyanHi: '#67E8F9',
  cyanMid: '#06B6D4',
  violet: '#C084FC',
  violetDeep: '#7E22CE',
  gold: '#FDE047',
} as const;

function renderBloodVfx(f: number): PixelBuffer {
  const buf = new PixelBuffer(12, 12);
  if (f === 0) {
    // Tight impact burst center-left
    buf.fillRect(4, 4, 3, 3, BLOOD_PAL.mid);
    buf.setPixel(4, 4, BLOOD_PAL.bright);
    buf.setPixel(6, 5, BLOOD_PAL.shadow);
    buf.setPixel(3, 5, BLOOD_PAL.bright);
    buf.setPixel(7, 4, BLOOD_PAL.bright);
    buf.setPixel(8, 3, BLOOD_PAL.mid);
    buf.setPixel(5, 3, BLOOD_PAL.mid);
    buf.setPixel(5, 7, BLOOD_PAL.shadow);
  } else if (f === 1) {
    // Arcing droplets spraying outward
    buf.setPixel(3, 4, BLOOD_PAL.bright);
    buf.setPixel(2, 5, BLOOD_PAL.mid);
    buf.setPixel(5, 3, BLOOD_PAL.bright);
    buf.setPixel(6, 3, BLOOD_PAL.mid);
    buf.setPixel(7, 4, BLOOD_PAL.mid);
    buf.setPixel(8, 5, BLOOD_PAL.shadow);
    buf.setPixel(9, 4, BLOOD_PAL.bright);
    buf.setPixel(6, 6, BLOOD_PAL.shadow);
    buf.setPixel(4, 7, BLOOD_PAL.mid);
    buf.setPixel(8, 7, BLOOD_PAL.deep);
  } else if (f === 2) {
    // Falling drops hitting ground plane y=9..10
    buf.setPixel(2, 7, BLOOD_PAL.mid);
    buf.setPixel(3, 8, BLOOD_PAL.shadow);
    buf.setPixel(6, 6, BLOOD_PAL.bright);
    buf.setPixel(7, 7, BLOOD_PAL.mid);
    buf.setPixel(9, 7, BLOOD_PAL.mid);
    buf.setPixel(10, 8, BLOOD_PAL.shadow);
    buf.setPixel(4, 9, BLOOD_PAL.shadow);
    buf.setPixel(5, 9, BLOOD_PAL.mid);
    buf.setPixel(8, 9, BLOOD_PAL.deep);
    buf.setPixel(9, 9, BLOOD_PAL.shadow);
  } else {
    // Ground splatter drops (100% opaque, <= 4 colors)
    buf.setPixel(2, 10, BLOOD_PAL.shadow);
    buf.setPixel(3, 10, BLOOD_PAL.deep);
    buf.setPixel(5, 10, BLOOD_PAL.mid);
    buf.setPixel(6, 10, BLOOD_PAL.shadow);
    buf.setPixel(7, 10, BLOOD_PAL.deep);
    buf.setPixel(9, 10, BLOOD_PAL.shadow);
    buf.setPixel(10, 10, BLOOD_PAL.deep);
    buf.setPixel(5, 9, BLOOD_PAL.bright);
  }
  return buf;
}

function renderDustVfx(f: number): PixelBuffer {
  const buf = new PixelBuffer(10, 10);
  if (f === 0) {
    buf.fillRect(3, 7, 4, 2, DUST_PAL.mid);
    buf.setPixel(3, 7, DUST_PAL.hi);
    buf.setPixel(4, 7, DUST_PAL.hi);
    buf.setPixel(6, 8, DUST_PAL.sh);
    buf.setPixel(2, 8, DUST_PAL.sh);
  } else if (f === 1) {
    buf.fillRect(2, 5, 3, 3, DUST_PAL.mid);
    buf.setPixel(2, 5, DUST_PAL.hi);
    buf.setPixel(3, 5, DUST_PAL.hi);
    buf.fillRect(6, 6, 2, 2, DUST_PAL.sh);
    buf.setPixel(6, 6, DUST_PAL.mid);
    buf.setPixel(4, 8, DUST_PAL.dp);
  } else if (f === 2) {
    buf.fillRect(1, 4, 3, 2, DUST_PAL.hi);
    buf.setPixel(2, 6, DUST_PAL.mid);
    buf.fillRect(5, 4, 3, 2, DUST_PAL.mid);
    buf.setPixel(6, 3, DUST_PAL.hi);
    buf.setPixel(7, 6, DUST_PAL.sh);
    buf.setPixel(3, 7, DUST_PAL.dp);
  } else {
    buf.setPixel(1, 3, DUST_PAL.hi);
    buf.setPixel(2, 3, DUST_PAL.mid);
    buf.setPixel(5, 2, DUST_PAL.hi);
    buf.setPixel(6, 3, DUST_PAL.mid);
    buf.setPixel(8, 4, DUST_PAL.sh);
    buf.setPixel(7, 6, DUST_PAL.dp);
    buf.setPixel(2, 6, DUST_PAL.sh);
  }
  return buf;
}

function renderSparksVfx(f: number): PixelBuffer {
  const buf = new PixelBuffer(12, 12);
  if (f === 0) {
    // Bright clash cross core
    buf.fillRect(5, 5, 2, 2, SPARK_PAL.core);
    buf.setPixel(4, 5, SPARK_PAL.gold);
    buf.setPixel(7, 5, SPARK_PAL.gold);
    buf.setPixel(5, 4, SPARK_PAL.gold);
    buf.setPixel(5, 7, SPARK_PAL.gold);
    buf.setPixel(3, 3, SPARK_PAL.amber);
    buf.setPixel(8, 3, SPARK_PAL.amber);
    buf.setPixel(3, 8, SPARK_PAL.amber);
    buf.setPixel(8, 8, SPARK_PAL.amber);
  } else if (f === 1) {
    buf.setPixel(5, 5, SPARK_PAL.core);
    buf.setPixel(6, 6, SPARK_PAL.gold);
    buf.setPixel(3, 3, SPARK_PAL.core);
    buf.setPixel(2, 2, SPARK_PAL.gold);
    buf.setPixel(8, 3, SPARK_PAL.core);
    buf.setPixel(9, 2, SPARK_PAL.amber);
    buf.setPixel(3, 8, SPARK_PAL.gold);
    buf.setPixel(2, 9, SPARK_PAL.ember);
    buf.setPixel(8, 8, SPARK_PAL.gold);
    buf.setPixel(9, 9, SPARK_PAL.amber);
    buf.setPixel(6, 2, SPARK_PAL.amber);
    buf.setPixel(10, 5, SPARK_PAL.gold);
  } else if (f === 2) {
    buf.setPixel(2, 1, SPARK_PAL.gold);
    buf.setPixel(1, 2, SPARK_PAL.amber);
    buf.setPixel(9, 2, SPARK_PAL.gold);
    buf.setPixel(10, 3, SPARK_PAL.ember);
    buf.setPixel(2, 9, SPARK_PAL.amber);
    buf.setPixel(1, 10, SPARK_PAL.ember);
    buf.setPixel(9, 9, SPARK_PAL.gold);
    buf.setPixel(10, 10, SPARK_PAL.ember);
    buf.setPixel(6, 1, SPARK_PAL.core);
    buf.setPixel(10, 6, SPARK_PAL.amber);
  } else {
    buf.setPixel(1, 2, SPARK_PAL.ember);
    buf.setPixel(10, 1, SPARK_PAL.amber);
    buf.setPixel(1, 10, SPARK_PAL.ember);
    buf.setPixel(10, 10, SPARK_PAL.ember);
    buf.setPixel(5, 1, SPARK_PAL.gold);
    buf.setPixel(11, 7, SPARK_PAL.ember);
  }
  return buf;
}

function renderArrowVfx(f: number, fletchHex?: string): PixelBuffer {
  const buf = new PixelBuffer(12, 6);
  const fHi = fletchHex ?? ARROW_PAL.fletchHi;
  const fDark = ARROW_PAL.fletchDark;
  const bobY = f === 1 ? 2 : f === 3 ? 3 : 2;
  // Wind streak trailing left
  const streakX = f % 2 === 0 ? 0 : 1;
  buf.setPixel(streakX, bobY, ARROW_PAL.wind);
  buf.setPixel(streakX + 1, bobY, ARROW_PAL.wind);
  // Fletching feathers
  buf.setPixel(2, bobY - 1, fHi);
  buf.setPixel(3, bobY - 1, fDark);
  buf.setPixel(2, bobY + 1, fDark);
  buf.setPixel(3, bobY + 1, fDark);
  // Wooden shaft
  for (let x = 2; x <= 8; x++) {
    buf.setPixel(x, bobY, x % 2 === 0 ? ARROW_PAL.shaft : ARROW_PAL.shaftDark);
  }
  // Steel broadhead tip pointing right
  buf.setPixel(9, bobY - 1, ARROW_PAL.tipHi);
  buf.setPixel(9, bobY, ARROW_PAL.tipHi);
  buf.setPixel(10, bobY, ARROW_PAL.tipHi);
  buf.setPixel(11, bobY, ARROW_PAL.tipHi);
  buf.setPixel(9, bobY + 1, ARROW_PAL.tipDark);
  return buf;
}

function renderMagicVfx(f: number, accentHex?: string): PixelBuffer {
  const buf = new PixelBuffer(14, 14);
  const cHi = accentHex ?? MAGIC_PAL.cyanHi;
  if (f === 0) {
    // Tight pulsing spell orb
    buf.fillRect(6, 6, 2, 2, MAGIC_PAL.core);
    buf.setPixel(5, 6, cHi);
    buf.setPixel(8, 6, cHi);
    buf.setPixel(6, 5, cHi);
    buf.setPixel(6, 8, cHi);
    buf.setPixel(5, 5, MAGIC_PAL.violet);
    buf.setPixel(8, 8, MAGIC_PAL.violet);
  } else if (f === 1) {
    // Expanding 4-point arcane star
    buf.fillRect(6, 6, 2, 2, MAGIC_PAL.core);
    for (let d = 2; d <= 4; d++) {
      const tone = d === 2 ? cHi : d === 3 ? MAGIC_PAL.cyanMid : MAGIC_PAL.violet;
      buf.setPixel(6 - d, 6, tone);
      buf.setPixel(7 + d, 6, tone);
      buf.setPixel(6, 6 - d, tone);
      buf.setPixel(6, 7 + d, tone);
    }
    buf.setPixel(4, 4, MAGIC_PAL.gold);
    buf.setPixel(9, 4, MAGIC_PAL.gold);
    buf.setPixel(4, 9, MAGIC_PAL.gold);
    buf.setPixel(9, 9, MAGIC_PAL.gold);
  } else if (f === 2) {
    // Rune ring flash
    buf.setPixel(6, 6, MAGIC_PAL.core);
    buf.setPixel(7, 7, MAGIC_PAL.gold);
    const pts: readonly [number, number][] = [
      [6, 1], [7, 1], [10, 3], [12, 6], [12, 7], [10, 10],
      [7, 12], [6, 12], [3, 10], [1, 7], [1, 6], [3, 3],
    ];
    pts.forEach(([x, y], i) => {
      buf.setPixel(x, y, i % 3 === 0 ? MAGIC_PAL.gold : i % 2 === 0 ? cHi : MAGIC_PAL.violet);
    });
    buf.setPixel(4, 4, cHi);
    buf.setPixel(9, 9, cHi);
  } else {
    // Dissipating sparkling arcane motes
    const motes: readonly [number, number, string][] = [
      [2, 2, MAGIC_PAL.violet],
      [11, 2, cHi],
      [2, 11, cHi],
      [11, 11, MAGIC_PAL.violetDeep],
      [6, 0, MAGIC_PAL.gold],
      [13, 6, MAGIC_PAL.cyanMid],
      [6, 13, MAGIC_PAL.violet],
      [0, 7, MAGIC_PAL.gold],
    ];
    for (const [x, y, c] of motes) {
      buf.setPixel(x, y, c);
    }
  }
  return buf;
}

export function renderVfxFrame(
  effectId: VfxEffectId,
  frameIndex: number,
  options?: {
    k1Hex?: string;
    direction?: 1 | -1;
  }
): PixelBuffer {
  const safeFrame = ((Math.floor(frameIndex) % 4) + 4) % 4;
  let buf: PixelBuffer;
  switch (effectId) {
    case 'blood':
      buf = renderBloodVfx(safeFrame);
      break;
    case 'dust':
      buf = renderDustVfx(safeFrame);
      break;
    case 'sparks':
      buf = renderSparksVfx(safeFrame);
      break;
    case 'arrow':
      buf = renderArrowVfx(safeFrame, options?.k1Hex);
      break;
    case 'magic':
      buf = renderMagicVfx(safeFrame, options?.k1Hex);
      break;
  }
  if (options?.direction === -1) {
    const flipped = new PixelBuffer(buf.width, buf.height);
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        const px = buf.getPixel(x, y);
        if (px) flipped.setPixel(buf.width - 1 - x, y, px);
      }
    }
    return flipped;
  }
  return buf;
}
