/**
 * ============================================================================
 * FORMAL MATERIAL RAMP & DYNAMIC MASK RECOLORING SPECIFICATION
 * ============================================================================
 * Combines two complementary pixel-art systems:
 * 1. Structures & Props: 4-stop tonal ramps { deep, shadow, mid, highlight }
 *    with borderless material-tone isolation and VOID (#090808) deep recesses.
 * 2. Modular Units & Sandbox Recoloring:
 *    - K1_MASK (Magenta): Primary faction color mask (roofs, tunics, sails, banners)
 *    - K2_MASK (Cyan): Secondary faction trim mask (crests, shields, shoulder pads)
 *    - SKIN_MASK (Green): 4-stop skin phenotype mask (#B8FF96..#4A831F)
 *    - Exact RGB lookup replacement + Lerp((30,30,30), t_i) kingdom formula
 *    - SHADOW_COLOR (#11102B66): Unified 40% alpha dark-indigo ground shadow
 *    - WATER_LINE (#D1E3EB / #D5E2EA): Swim frame waterline mask
 * ============================================================================
 */

export interface MaterialRamp {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly deep: string;
  readonly shadow: string;
  readonly mid: string;
  readonly highlight: string;
}

export const INK = '#131110';
export const VOID = '#090808';

/** Unified ground shadow tint: #11102B at 40% opacity (0x66 = 102) */
export const SHADOW_COLOR = '#11102B66';

/** Swim waterline surface highlights */
export const WATER_LINE = {
  light: '#D1E3EB',
  mid: '#D5E2EA',
} as const;

export const RAMPS = {
  bone: {
    id: 'bone',
    name: 'Древняя кость',
    role: 'Черепа, рёбра, рога и костяные своды',
    deep: '#4D4638',
    shadow: '#736853',
    mid: '#A39678',
    highlight: '#DFD4B7',
  },
  slate: {
    id: 'slate',
    name: 'Некро-сланец',
    role: 'Бастионы, башни, каменная кладка',
    deep: '#24272D',
    shadow: '#3B3F47',
    mid: '#5B616C',
    highlight: '#848B98',
  },
  timber: {
    id: 'timber',
    name: 'Дубовый брус',
    role: 'Балки, настилы, лопасти и ворота',
    deep: '#382011',
    shadow: '#5A361D',
    mid: '#84512B',
    highlight: '#B47644',
  },
  sandstone: {
    id: 'sandstone',
    name: 'Песчаник и земля',
    role: 'Цоколи-платформы, стены гильдии, башни',
    deep: '#5C4021',
    shadow: '#855E31',
    mid: '#B08247',
    highlight: '#D5AA6B',
  },
  marble: {
    id: 'marble',
    name: 'Белый мрамор',
    role: 'Магические шпили, колоннады и арки',
    deep: '#5E6470',
    shadow: '#8B92A1',
    mid: '#C4CAD6',
    highlight: '#EEF1F7',
  },
  obsidian: {
    id: 'obsidian',
    name: 'Обсидиан и чугун',
    role: 'Адские горны, зиккураты и кованая броня',
    deep: '#19171C',
    shadow: '#2D2933',
    mid: '#46414F',
    highlight: '#6A6378',
  },
  ice: {
    id: 'ice',
    name: 'Ледяной хрусталь',
    role: 'Цитадели мороза, ледники и шпили',
    deep: '#1D4E6E',
    shadow: '#367CA3',
    mid: '#6CC0E5',
    highlight: '#C2F0FF',
  },
  moss: {
    id: 'moss',
    name: 'Лесной мох и листва',
    role: 'Кроны друидов, заросли и алхимия',
    deep: '#1F4219',
    shadow: '#386B26',
    mid: '#5B9D38',
    highlight: '#8CD156',
  },
  gold: {
    id: 'gold',
    name: 'Кованое золото и жар',
    role: 'Шпили, латунные шестерни, фонари и огонь',
    deep: '#854D0E',
    shadow: '#C27D14',
    mid: '#F0B829',
    highlight: '#FFF2A6',
  },
  lava: {
    id: 'lava',
    name: 'Магма и угли',
    role: 'Огонь горна, раскалённые трещины и искры',
    deep: '#7C1D13',
    shadow: '#C23B1B',
    mid: '#F2741F',
    highlight: '#FFD35C',
  },
  magenta: {
    id: 'magenta',
    name: 'Маска K1 (маджента)',
    role: 'Крыши, знамёна, кристаллы, паруса и одежда',
    deep: '#5C0066',
    shadow: '#9900A6',
    mid: '#D900EB',
    highlight: '#FF70FF',
  },
  cyanMask: {
    id: 'cyanMask',
    name: 'Маска K2 (бирюза)',
    role: 'Вторичный цвет фракции: щиты, отделка, пояса',
    deep: '#006666',
    shadow: '#009E9E',
    mid: '#00DBDB',
    highlight: '#00EFEF',
  },
  sail: {
    id: 'sail',
    name: 'Парусина и холст',
    role: 'Крылья мельниц, баллоны дирижаблей и тенты',
    deep: '#635C4B',
    shadow: '#8D846D',
    mid: '#B8AE93',
    highlight: '#DDD5BB',
  },
  sakura: {
    id: 'sakura',
    name: 'Цветущая сакура',
    role: 'Весенние лепестки, цветы и коралловые рифы',
    deep: '#7D2948',
    shadow: '#B54B71',
    mid: '#ED82A8',
    highlight: '#FFD1E3',
  },
  autumn: {
    id: 'autumn',
    name: 'Осенний клён и янтарь',
    role: 'Багряная крона, янтарные кристаллы и пыль',
    deep: '#6E2212',
    shadow: '#A83F1B',
    mid: '#E06D22',
    highlight: '#F7B443',
  },
  pine: {
    id: 'pine',
    name: 'Северная хвоя',
    role: 'Еловые лапы, кедры и тёмный подлесок',
    deep: '#122E24',
    shadow: '#1E4D3B',
    mid: '#2E7558',
    highlight: '#52A87E',
  },
  birch: {
    id: 'birch',
    name: 'Берёзовая кора и известняк',
    role: 'Белые стволы, кварцевые жилы и руины',
    deep: '#5C5852',
    shadow: '#8F8A80',
    mid: '#C7C2B6',
    highlight: '#F0ECE1',
  },
  copper: {
    id: 'copper',
    name: 'Патинированная медь',
    role: 'Окисленная бронза, патина и морская волна',
    deep: '#1D4D46',
    shadow: '#2D786C',
    mid: '#4CB39D',
    highlight: '#8CE8CE',
  },
  amethyst: {
    id: 'amethyst',
    name: 'Горный аметист',
    role: 'Кварцевые друзы, мистические кристаллы и споры',
    deep: '#3B185F',
    shadow: '#652E9E',
    mid: '#9C58E0',
    highlight: '#D6AEFF',
  },
  storm: {
    id: 'storm',
    name: 'Грозовая туча',
    role: 'Дождевые облака, свинцовые фронты и вихри',
    deep: '#242C3D',
    shadow: '#3B4761',
    mid: '#5D6E8F',
    highlight: '#8FA4C7',
  },
  mist: {
    id: 'mist',
    name: 'Туман и облачность',
    role: 'Пелена тумана, кучевые облака, снег и пар',
    deep: '#5A697A',
    shadow: '#8496AB',
    mid: '#B6C7D9',
    highlight: '#E6F0FA',
  },
  emerald: {
    id: 'emerald',
    name: 'Изумрудный кристалл',
    role: 'Живой малахит, северное сияние и мицелий',
    deep: '#0E472D',
    shadow: '#18754A',
    mid: '#2AB36E',
    highlight: '#73F2A6',
  },
} as const satisfies Record<string, MaterialRamp>;

export type RampKey = keyof typeof RAMPS;

export const PALETTE_GROUPS: MaterialRamp[] = [
  RAMPS.bone,
  RAMPS.slate,
  RAMPS.timber,
  RAMPS.marble,
  RAMPS.ice,
  RAMPS.moss,
  RAMPS.gold,
  RAMPS.magenta,
];

/**
 * Exact RGB Mask Channels (Highlight -> Mid -> Shadow -> Deep)
 */
export const K1_MASK = [
  RAMPS.magenta.highlight,
  RAMPS.magenta.mid,
  RAMPS.magenta.shadow,
  RAMPS.magenta.deep,
] as const;

export const K2_MASK = [
  RAMPS.cyanMask.highlight,
  RAMPS.cyanMask.mid,
  RAMPS.cyanMask.shadow,
  RAMPS.cyanMask.deep,
] as const;

/** Exact skin phenotype mask */
export const SKIN_MASK = ['#B8FF96', '#00FF00', '#00AF00', '#4A831F'] as const;

export interface KingdomPreset {
  readonly id: string;
  readonly name: string;
  readonly primaryHex: string; // color_text -> K1
  readonly secondaryHex: string; // color_main -> K2
}

/** Curated kingdom palettes (colors_general) */
export const KINGDOM_PRESETS: KingdomPreset[] = [
  { id: 'original', name: 'Маска', primaryHex: '#FF70FF', secondaryHex: '#00EFEF' },
  { id: 'red', name: 'Алый', primaryHex: '#E6194B', secondaryHex: '#C51540' },
  { id: 'blue', name: 'Лазурь', primaryHex: '#8AA3FF', secondaryHex: '#5C98E1' },
  { id: 'green', name: 'Изумруд', primaryHex: '#3CB44B', secondaryHex: '#4DE860' },
  { id: 'yellow', name: 'Янтарь', primaryHex: '#FFE06D', secondaryHex: '#F58231' },
  { id: 'purple', name: 'Аметист', primaryHex: '#AF5EF6', secondaryHex: '#911EB4' },
  { id: 'teal', name: 'Бирюза', primaryHex: '#AAFFF6', secondaryHex: '#00675C' },
  { id: 'black', name: 'Обсидиан', primaryHex: '#737373', secondaryHex: '#262626' },
];

export interface SkinPhenotype {
  readonly id: string;
  readonly name: string;
  readonly fromHex: string;
  readonly toHex: string;
}

/** Skin phenotype gradients */
export const SKIN_PHENOTYPES: SkinPhenotype[] = [
  { id: 'skin_light', name: 'Светлая', fromHex: '#F5D6BA', toHex: '#F3C6BE' },
  { id: 'skin_medium', name: 'Смуглая', fromHex: '#C5966D', toHex: '#C06859' },
  { id: 'skin_dark', name: 'Тёмная', fromHex: '#7C5A3C', toHex: '#593731' },
  { id: 'skin_pale', name: 'Бледная', fromHex: '#FFF9F4', toHex: '#ECD9D5' },
  { id: 'skin_green', name: 'Орочья', fromHex: '#9DB361', toHex: '#425338' },
  { id: 'skin_blue', name: 'Ледяная', fromHex: '#7FC1C7', toHex: '#37617A' },
  { id: 'skin_red', name: 'Багровая', fromHex: '#DB4D48', toHex: '#7F2E39' },
  { id: 'skin_purple', name: 'Тайная', fromHex: '#C29FD5', toHex: '#5C54A2' },
];

export function hexToRgba(hex: string): [number, number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length === 6) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
      255,
    ];
  }
  if (clean.length === 8) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
      parseInt(clean.slice(6, 8), 16),
    ];
  }
  return [0, 0, 0, 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Exact Kingdom Color Ramp Formula:
 * 1. If all RGB channels of `baseHex` < 128, add +50 to each channel so dark
 *    faction colors stay readable on terrain.
 * 2. Compute 4 shades via `Lerp(k0, (30, 30, 30), t_i)` with t = [0, 0.13, 0.35, 0.56].
 */
export function calculateKingdomRamp(baseHex: string): [string, string, string, string] {
  let [r, g, b] = hexToRgba(baseHex);
  if (r < 128 && g < 128 && b < 128) {
    r = Math.min(255, r + 50);
    g = Math.min(255, g + 50);
    b = Math.min(255, b + 50);
  }
  const factors = [0, 0.13, 0.35, 0.56] as const;
  return factors.map((t) =>
    rgbToHex(
      r + (30 - r) * t,
      g + (30 - g) * t,
      b + (30 - b) * t
    )
  ) as [string, string, string, string];
}

/**
 * Exact Skin Phenotype Shade Formula:
 * 1. Blend `fromHex -> toHex` by `1 - shadeVariant / 3` (`shadeVariant` in 0..3).
 * 2. Multiply by `[1.0, 0.9, 0.8, 0.7]` for the 4 SKIN_MASK stops.
 */
export function calculateSkinShades(
  fromHex: string,
  toHex: string,
  shadeVariant = 1
): [string, string, string, string] {
  const [fr, fg, fb] = hexToRgba(fromHex);
  const [tr, tg, tb] = hexToRgba(toHex);
  const blendT = 1 - Math.max(0, Math.min(3, shadeVariant)) / 3;
  const br = tr + (fr - tr) * blendT;
  const bg = tg + (fg - tg) * blendT;
  const bb = tb + (fb - tb) * blendT;
  const multipliers = [1.0, 0.9, 0.8, 0.7] as const;
  return multipliers.map((m) => rgbToHex(br * m, bg * m, bb * m)) as [
    string,
    string,
    string,
    string,
  ];
}

/**
 * Builds an exact-RGB hex lookup map for fast O(1) pixel mask substitution.
 */
export function buildMaskColorLookup(
  kingdomId: string,
  phenotypeId = 'skin_light',
  shadeVariant = 1
): Map<string, string> {
  const map = new Map<string, string>();
  const kingdom = KINGDOM_PRESETS.find((k) => k.id === kingdomId) ?? KINGDOM_PRESETS[0];

  if (kingdom.id !== 'original') {
    const k1 = calculateKingdomRamp(kingdom.primaryHex);
    const k2 = calculateKingdomRamp(kingdom.secondaryHex);
    K1_MASK.forEach((src, idx) => map.set(src.toUpperCase(), k1[idx]));
    K2_MASK.forEach((src, idx) => map.set(src.toUpperCase(), k2[idx]));
  }

  const phenotype = SKIN_PHENOTYPES.find((p) => p.id === phenotypeId) ?? SKIN_PHENOTYPES[0];
  const skinStops = calculateSkinShades(phenotype.fromHex, phenotype.toHex, shadeVariant);
  SKIN_MASK.forEach((src, idx) => map.set(src.toUpperCase(), skinStops[idx]));

  return map;
}
