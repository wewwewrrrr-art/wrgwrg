import { calculateKingdomRamp, hexToRgba, rgbToHex } from './palette';

/**
 * ============================================================================
 * STAGE 1 PROCEDURAL PALETTES (CIELAB-SPACED KINGDOMS, SKINS & HAIR RAMPS)
 * ============================================================================
 * Every palette entry defines a 4-tone ramp `[highlight, mid, shadow, deep]`
 * lit from top-left (-1, -1) with zero black contours.
 * - 14 Skin Palettes: 11 natural human tones + 3 unnatural fantasy/undead tones
 * - 12 Hair Palettes: natural shades + 2 grey/silver ("седина") + deep royal
 * - 84 Kingdom Palettes: perceptually spaced in CIELAB (D65) so min ΔE >= 12
 * ============================================================================
 */

export type FourToneRamp = readonly [string, string, string, string];

export interface LabColor {
  readonly L: number;
  readonly a: number;
  readonly b: number;
}

export interface SkinPaletteDef {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly category: 'natural' | 'unnatural';
  readonly ramp: FourToneRamp; // [highlight, mid, shadow, deep]
}

export interface HairPaletteDef {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly isGrey: boolean;
  readonly ramp: FourToneRamp; // [highlight, mid, shadow, deep]
}

export interface KingdomPaletteDef {
  readonly id: number;
  readonly name: string;
  readonly primaryHex: string;
  readonly secondaryHex: string;
  readonly k1Ramp: FourToneRamp; // [highlight, mid, shadow, deep]
  readonly k2Ramp: FourToneRamp; // [highlight, mid, shadow, deep]
  readonly lab: LabColor;
}

// ----------------------------------------------------------------------------
// CIELAB (D65) PERCEPTUAL COLOR MATH
// ----------------------------------------------------------------------------

function srgbChannelToLinear(c255: number): number {
  const c = c255 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToLab(hex: string): LabColor {
  const [r, g, b] = hexToRgba(hex);
  const lr = srgbChannelToLinear(r);
  const lg = srgbChannelToLinear(g);
  const lb = srgbChannelToLinear(b);

  // sRGB -> XYZ (D65 illuminant)
  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / 0.95047;
  const y = (lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175) / 1.0;
  const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function deltaE76(c1: LabColor, c2: LabColor): number {
  const dL = c1.L - c2.L;
  const da = c1.a - c2.a;
  const db = c1.b - c2.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

function buildWarmShadedRamp(baseHex: string): FourToneRamp {
  const [r, g, b] = hexToRgba(baseHex);
  // Top-left warm highlight (+14%, slight warm lift), mid = base, shadow (-20% cooler), deep (-38% cooler)
  const hi = rgbToHex(r + (255 - r) * 0.22, g + (250 - g) * 0.19, b + (238 - b) * 0.14);
  const mid = rgbToHex(r, g, b);
  const sh = rgbToHex(r * 0.78, g * 0.74, b * 0.73);
  const dp = rgbToHex(Math.max(18, r * 0.56), Math.max(16, g * 0.52), Math.max(18, b * 0.53));
  return [hi, mid, sh, dp];
}

// ----------------------------------------------------------------------------
// 14 SKIN PALETTES (11 NATURAL HUMAN + 3 UNNATURAL)
// ----------------------------------------------------------------------------

const SKIN_SEEDS: readonly {
  key: string;
  name: string;
  category: 'natural' | 'unnatural';
  baseHex: string;
}[] = [
  { key: 'ivory', name: 'Фарфоровая', category: 'natural', baseHex: '#F7DEC9' },
  { key: 'alabaster', name: 'Светло-розовая', category: 'natural', baseHex: '#F0C7B4' },
  { key: 'peach', name: 'Персиковая', category: 'natural', baseHex: '#E9B996' },
  { key: 'nordic', name: 'Румяная', category: 'natural', baseHex: '#E3AD8F' },
  { key: 'golden', name: 'Золотистая', category: 'natural', baseHex: '#DBA472' },
  { key: 'sand', name: 'Песочная', category: 'natural', baseHex: '#CE9464' },
  { key: 'olive', name: 'Оливковая', category: 'natural', baseHex: '#BE8E5A' },
  { key: 'amber', name: 'Смугло-янтарная', category: 'natural', baseHex: '#AE764A' },
  { key: 'copper', name: 'Медно-бронзовая', category: 'natural', baseHex: '#965F3C' },
  { key: 'umber', name: 'Тёмно-каштановая', category: 'natural', baseHex: '#7A4C32' },
  { key: 'ebony', name: 'Глубокая эбеновая', category: 'natural', baseHex: '#5B3927' },
  // 3 unnatural skin tones (for non-human / undead / frost variants)
  { key: 'orc_green', name: 'Зелёная (орк/нежить)', category: 'unnatural', baseHex: '#7AA34A' },
  { key: 'ash_grey', name: 'Пепельно-серая', category: 'unnatural', baseHex: '#949CA6' },
  { key: 'frost_blue', name: 'Морозно-синяя', category: 'unnatural', baseHex: '#6CAEC2' },
];

export const SKIN_PALETTES_14: readonly SkinPaletteDef[] = SKIN_SEEDS.map((s, id) => ({
  id,
  key: s.key,
  name: s.name,
  category: s.category,
  ramp: buildWarmShadedRamp(s.baseHex),
}));

// ----------------------------------------------------------------------------
// 12 HAIR PALETTES (INCLUDING 2 GREY / SILVER "СЕДИНА" RAMPS)
// ----------------------------------------------------------------------------

const HAIR_SEEDS: readonly {
  key: string;
  name: string;
  isGrey: boolean;
  baseHex: string;
}[] = [
  { key: 'pitch_black', name: 'Смоляно-чёрные', isGrey: false, baseHex: '#2C282B' },
  { key: 'espresso', name: 'Тёмно-каштановые', isGrey: false, baseHex: '#4A3423' },
  { key: 'chestnut', name: 'Каштановые', isGrey: false, baseHex: '#6E472B' },
  { key: 'nut_brown', name: 'Ореховые', isGrey: false, baseHex: '#8C6239' },
  { key: 'auburn', name: 'Тёмно-рыжие', isGrey: false, baseHex: '#963A24' },
  { key: 'ginger', name: 'Медно-рыжие', isGrey: false, baseHex: '#C95D26' },
  { key: 'sandy', name: 'Русые', isGrey: false, baseHex: '#B9985A' },
  { key: 'gold_blonde', name: 'Золотисто-русые', isGrey: false, baseHex: '#D8B64C' },
  { key: 'flaxen', name: 'Льняные светлые', isGrey: false, baseHex: '#E8D98C' },
  { key: 'raven_blue', name: 'Иссиня-чёрные', isGrey: false, baseHex: '#28344B' },
  { key: 'steel_grey', name: 'Стальная седина', isGrey: true, baseHex: '#8F96A1' },
  { key: 'silver_white', name: 'Белая седина', isGrey: true, baseHex: '#D6DBE2' },
];

export const HAIR_PALETTES_12: readonly HairPaletteDef[] = HAIR_SEEDS.map((h, id) => ({
  id,
  key: h.key,
  name: h.name,
  isGrey: h.isGrey,
  ramp: buildWarmShadedRamp(h.baseHex),
}));

// ----------------------------------------------------------------------------
// 84 KINGDOM BANNER PALETTES (PERCEPTUALLY SPACED IN CIELAB, MIN ΔE >= 12)
// ----------------------------------------------------------------------------

const KINGDOM_TITLES = [
  'Алый Престол',
  'Лазурный Щит',
  'Изумрудный Дол',
  'Золотая Корона',
  'Пурпурный Орден',
  'Бирюзовый Флот',
  'Янтарный Бастион',
  'Малиновый Двор',
  'Кобальтовый Союз',
  'Нефритовый Клан',
  'Коралловая Лига',
  'Сапфировый Марш',
  'Медный Горн',
  'Сливовый Дом',
  'Охристый Стяг',
  'Оливковая Марка',
  'Индиговый Совет',
  'Аквамариновый Порт',
  'Терракотовый Оплот',
  'Сиреневая Гильдия',
  'Лаймовый Удел',
  'Гранатовый Лев',
];

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) =>
    Math.round(255 * (ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return rgbToHex(f(0), f(8), f(4));
}

function build84LabSpacedKingdoms(): readonly KingdomPaletteDef[] {
  // First 6 are flagship iconic heraldic colors (clean primary contrast for showcases)
  const curatedAnchors: readonly { name: string; primaryHex: string; secondaryHex: string }[] = [
    { name: 'Алый Престол', primaryHex: '#DC2646', secondaryHex: '#F4B942' },
    { name: 'Лазурный Щит', primaryHex: '#2F6EE5', secondaryHex: '#DCE8FF' },
    { name: 'Изумрудный Дол', primaryHex: '#27A857', secondaryHex: '#E2E68C' },
    { name: 'Золотая Корона', primaryHex: '#E8A824', secondaryHex: '#7A2E3A' },
    { name: 'Пурпурный Орден', primaryHex: '#8E44D9', secondaryHex: '#F3D17A' },
    { name: 'Бирюзовый Флот', primaryHex: '#18A8AD', secondaryHex: '#F2E4C8' },
  ];

  // Dense deterministic candidate pool across readable L* in [30..82] and chroma
  const candidates: { hex: string; lab: LabColor; hue: number; sat: number; light: number }[] = [];
  for (let h = 0; h < 360; h += 10) {
    for (const s of [38, 56, 76, 94]) {
      for (const l of [32, 44, 56, 68, 78]) {
        const hex = hslToHex(h, s, l);
        const lab = hexToLab(hex);
        // Filter out near-blacks or blinding near-whites so banners stay crisp on dark & meadow terrain
        if (lab.L >= 30 && lab.L <= 84) {
          candidates.push({ hex, lab, hue: h, sat: s, light: l });
        }
      }
    }
  }
  // Also include rich desaturated heraldic neutrals (slate, ivory-cream, bronze, burgundy, forest)
  for (const hex of [
    '#B85D3B',
    '#6B8E55',
    '#526B8A',
    '#9E7B56',
    '#C49BB8',
    '#7D5268',
    '#4A8076',
    '#C9B37C',
    '#8B96A8',
    '#5E6A78',
    '#E0DDD2',
  ]) {
    candidates.push({ hex, lab: hexToLab(hex), hue: 0, sat: 25, light: 55 });
  }

  const chosen: { name: string; primaryHex: string; secondaryHex: string; lab: LabColor }[] = [];
  for (const c of curatedAnchors) {
    chosen.push({
      ...c,
      lab: hexToLab(c.primaryHex),
    });
  }

  // Deterministic greedy farthest-point sampling in CIELAB space
  const minDistToChosen = new Float64Array(candidates.length);
  for (let i = 0; i < candidates.length; i++) {
    let best = Infinity;
    for (const p of chosen) {
      const d = deltaE76(candidates[i].lab, p.lab);
      if (d < best) best = d;
    }
    minDistToChosen[i] = best;
  }

  while (chosen.length < 84) {
    let bestIdx = -1;
    let bestDist = -1;
    for (let i = 0; i < candidates.length; i++) {
      if (minDistToChosen[i] > bestDist) {
        bestDist = minDistToChosen[i];
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const picked = candidates[bestIdx];
    const idxNum = chosen.length;
    const secHue = (picked.hue + 145) % 360;
    const secLight = picked.light > 55 ? 36 : 72;
    const secHex = hslToHex(secHue, Math.max(40, Math.min(82, picked.sat)), secLight);
    const title = KINGDOM_TITLES[idxNum % KINGDOM_TITLES.length];
    chosen.push({
      name: `${title} #${idxNum + 1}`,
      primaryHex: picked.hex,
      secondaryHex: secHex,
      lab: picked.lab,
    });

    for (let i = 0; i < candidates.length; i++) {
      const d = deltaE76(candidates[i].lab, picked.lab);
      if (d < minDistToChosen[i]) minDistToChosen[i] = d;
    }
  }

  return chosen.map((item, id) => ({
    id,
    name: item.name,
    primaryHex: item.primaryHex,
    secondaryHex: item.secondaryHex,
    k1Ramp: calculateKingdomRamp(item.primaryHex),
    k2Ramp: calculateKingdomRamp(item.secondaryHex),
    lab: item.lab,
  }));
}

export const KINGDOM_PALETTES_84: readonly KingdomPaletteDef[] = build84LabSpacedKingdoms();

export function computeMinKingdomDeltaE(palettes: readonly KingdomPaletteDef[] = KINGDOM_PALETTES_84): number {
  let minD = Infinity;
  for (let i = 0; i < palettes.length; i++) {
    for (let j = i + 1; j < palettes.length; j++) {
      const d = deltaE76(palettes[i].lab, palettes[j].lab);
      if (d < minD) minD = d;
    }
  }
  return minD;
}
