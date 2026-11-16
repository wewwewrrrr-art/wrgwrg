import {
  K1_MASK,
  K2_MASK,
  RAMPS,
  SKIN_MASK,
  WATER_LINE,
  calculateKingdomRamp,
  calculateSkinShades,
} from './palette';
import { PixelBuffer } from './pixelCanvas';
import { PixelMatrix, UnitAction, UnitMode } from './unitAssembler';
import type { StageBg } from '../models/types';

/**
 * ============================================================================
 * 6-LAYER HUMAN APPEARANCE DIVERSITY SYSTEM (TRUE 10×10 TOP-DOWN SCALE)
 * ============================================================================
 * Matches Sandbox_humans_visual_guide proportions & pixel economy:
 * - Output canvas: 12×12 px (10×10 body frame + 1px border margin), pivot (0.5, 0.0)
 * - No outer black contour; crisp top-lit material spots (4–8 colors avg)
 * - Body stores NO head; top rows 0..3 empty, 2×2 head marker bounces:
 *   - Adults: walk y=[6, 8, 7, 5], swim y=[4, 3, 4, 3]
 *   - Child (10×11): walk y=[4, 5, 4, 5], swim y=[3, 4, 3, 4]
 *   - Zombie: marker shifted 1px left (hunched), swim frame 10×9
 * - Heads: 2×2..4×4 micro-sprites, 1px skin face (#B8FF96), ZERO eye/nose clutter
 * - Stationary 7×3 unitShadow_5 (#11102B at alpha 0.404) planted under pivot
 * - Totals: 34 bodies (10M + 10F + 10W + king + leader + child + zombie),
 *           44 heads (11M + 11F + king + warrior + old_male + old_female + 7+7 festive + 4 zombie)
 * ============================================================================
 */

export const HUMAN_CANVAS_W = 12;
export const HUMAN_CANVAS_H = 12;

export type HumanRole =
  | 'man'
  | 'woman'
  | 'warrior'
  | 'king'
  | 'monarch'
  | 'leader'
  | 'child'
  | 'zombie';
export type HumanAgeStage = 'child' | 'adult' | 'elder';
export type HumanMutation = 'none' | 'giant' | 'energized' | 'plague' | 'fire_blood';

export interface HumanCultureDef {
  readonly id: number;
  readonly name: string;
  readonly costumeDesc: string;
}

export const HUMAN_CULTURES: readonly HumanCultureDef[] = [
  { id: 0, name: 'Речная Гильдия', costumeDesc: 'Лаконичная туника K1 с тёмными штанами' },
  { id: 1, name: 'Лесные Следопыты', costumeDesc: 'Мшистый капюшон, перевязь K1 и холст' },
  { id: 2, name: 'Горные Кланы', costumeDesc: 'Светлый меховой ворот и плотный жилет K1/K2' },
  { id: 3, name: 'Морская Лига', costumeDesc: 'Полосатый камзол K1/холст и пояс K2' },
  { id: 4, name: 'Степные Наездники', costumeDesc: 'Охристое пончо K1 с золотой каймой' },
  { id: 5, name: 'Северный Оплот', costumeDesc: 'Меховая дублёнка с накидкой K1' },
  { id: 6, name: 'Огненная Кузня', costumeDesc: 'Кожаный фартук кузнеца поверх цвета K1' },
  { id: 7, name: 'Орден Звёзд', costumeDesc: 'Двухцветная ряса K2 с перевязью K1' },
  { id: 8, name: 'Песчаные Кочевники', costumeDesc: 'Светлый хитон и шарф цвета державы K1' },
  { id: 9, name: 'Стальная Цитадель', costumeDesc: 'Тёмно-сланцевый гамбезон и табард K1' },
];

export interface HumanKingdomColor {
  readonly id: number;
  readonly name: string;
  readonly primaryHex: string;
  readonly secondaryHex: string;
}

const BASE_KINGDOM_NAMES = [
  'Алая Корона',
  'Лазурный Щит',
  'Изумрудный Дол',
  'Янтарный Престол',
  'Аметистовый Орден',
  'Бирюзовый Флот',
  'Золотой Легион',
  'Багровый Бастион',
  'Кобальтовый Дом',
  'Солнечный Союз',
  'Лиловый Двор',
];

/** 88 distinct kingdom colors */
export const HUMAN_KINGDOM_COLORS_88: readonly HumanKingdomColor[] = Array.from(
  { length: 88 },
  (_, i) => {
    // First 8 match classic sandbox red/blue/green/yellow/purple/cyan/orange/teal readability
    const curated: readonly { name: string; primaryHex: string; secondaryHex: string }[] = [
      { name: 'Алая Корона #1', primaryHex: '#E6194B', secondaryHex: '#C51540' },
      { name: 'Лазурный Щит #2', primaryHex: '#638BFF', secondaryHex: '#3B66D9' },
      { name: 'Изумрудный Дол #3', primaryHex: '#3CB44B', secondaryHex: '#258B34' },
      { name: 'Янтарный Престол #4', primaryHex: '#F5C428', secondaryHex: '#D97C1E' },
      { name: 'Аметистовый Орден #5', primaryHex: '#AF5EF6', secondaryHex: '#8434C8' },
      { name: 'Бирюзовый Флот #6', primaryHex: '#3CD8D2', secondaryHex: '#159E9A' },
      { name: 'Золотой Легион #7', primaryHex: '#F58231', secondaryHex: '#C25814' },
      { name: 'Розовый Двор #8', primaryHex: '#F062A8', secondaryHex: '#B83474' },
    ];
    if (i < curated.length) {
      return { id: i, ...curated[i] };
    }
    const hue = Math.round((i * 137.508) % 360);
    const sat = 68 + (i % 3) * 10;
    const light = 48 + ((i >> 1) % 3) * 9;
    const secHue = (hue + 28 + (i % 5) * 14) % 360;
    const hslToHex = (h: number, s: number, l: number): string => {
      const sn = s / 100;
      const ln = l / 100;
      const k = (n: number) => (n + h / 30) % 12;
      const a = sn * Math.min(ln, 1 - ln);
      const f = (n: number) =>
        Math.round(255 * (ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
      return (
        '#' +
        [f(0), f(8), f(4)]
          .map((v) => v.toString(16).padStart(2, '0').toUpperCase())
          .join('')
      );
    };
    const baseName = BASE_KINGDOM_NAMES[i % BASE_KINGDOM_NAMES.length];
    return {
      id: i,
      name: `${baseName} #${i + 1}`,
      primaryHex: hslToHex(hue, sat, light),
      secondaryHex: hslToHex(secHue, Math.max(45, sat - 12), Math.max(36, light - 8)),
    };
  }
);

export interface HumanSkinColor {
  readonly id: number;
  readonly name: string;
  readonly fromHex: string;
  readonly toHex: string;
}

const SKIN_ANCHORS: readonly { name: string; from: [number, number, number]; to: [number, number, number] }[] = [
  { name: 'Светло-фарфоровый', from: [252, 232, 218], to: [232, 194, 182] },
  { name: 'Персиковый', from: [245, 214, 186], to: [224, 174, 150] },
  { name: 'Тёпло-золотистый', from: [235, 195, 148], to: [204, 149, 108] },
  { name: 'Оливковый', from: [214, 178, 134], to: [178, 136, 98] },
  { name: 'Смугло-бронзовый', from: [192, 144, 104], to: [154, 106, 74] },
  { name: 'Медно-каштановый', from: [164, 112, 76], to: [124, 78, 52] },
  { name: 'Глубокий умбра', from: [124, 90, 60], to: [89, 55, 49] },
  { name: 'Эбеновый', from: [92, 60, 44], to: [62, 38, 28] },
  { name: 'Нордически-румяный', from: [248, 224, 212], to: [226, 176, 172] },
  { name: 'Степной загар', from: [208, 158, 114], to: [172, 118, 84] },
  { name: 'Южно-карамельный', from: [182, 132, 88], to: [142, 92, 62] },
  { name: 'Морской ветер', from: [224, 188, 166], to: [186, 144, 126] },
  { name: 'Тайно-алебастровый', from: [242, 236, 232], to: [208, 198, 202] },
];

/** 52 distinct skin phenotypes × 4 shades = 208 variants */
export const HUMAN_SKIN_COLORS_52: readonly HumanSkinColor[] = Array.from(
  { length: 52 },
  (_, i) => {
    const aIdx = Math.floor(i / 4) % SKIN_ANCHORS.length;
    const sub = i % 4;
    const anchor = SKIN_ANCHORS[aIdx];
    const shift = (sub - 1.5) * 6;
    const rgbHex = (rgb: readonly [number, number, number], delta: number) =>
      '#' +
      rgb
        .map((c, idx) =>
          Math.max(24, Math.min(254, Math.round(c + delta + (idx === 0 ? sub * 2 : 0))))
            .toString(16)
            .padStart(2, '0')
            .toUpperCase()
        )
        .join('');
    return {
      id: i,
      name: `${anchor.name} (${sub + 1})`,
      fromHex: rgbHex(anchor.from, shift),
      toHex: rgbHex(anchor.to, shift * 0.8),
    };
  }
);

export interface HumanAppearanceSpec {
  readonly personalId: number;
  readonly cultureId: number; // Layer 1: 0..9
  readonly role: HumanRole; // Layer 2
  readonly headVariant: number; // Layer 3: personal fixed seed (0..10)
  readonly kingdomColorIdx: number; // Layer 4: 0..87
  readonly alliedKingdomColorIdx?: number; // Layer 4B: Allied partner kingdom color (0..87) for Alliance Monarch
  readonly skinColorIdx: number; // Layer 5: 0..51
  readonly skinShade: 0 | 1 | 2 | 3; // Layer 5: 4 shades per skin
  readonly ageStage: HumanAgeStage; // Layer 6: child / adult / elder
  readonly isZombie: boolean; // Layer 6: undead override
  readonly mutation: HumanMutation; // Layer 6: visible mutation
  readonly isFestive?: boolean; // Optional festive winter hat heads (7M + 7F)
}

export interface HumanLayerBreakdown {
  readonly bodyKey: string;
  readonly bodyLabel: string;
  readonly headKey: string;
  readonly headLabel: string;
  readonly cultureName: string;
  readonly kingdomColor: HumanKingdomColor;
  readonly alliedKingdomColor?: HumanKingdomColor;
  readonly skinColor: HumanSkinColor;
  readonly effectiveRole: HumanRole;
}

// ============================================================================
// MICRO LEGEND (NO BLACK CONTOUR, CLEAN SPOTS OF CLOTH/LEATHER/METAL/SKIN)
// ============================================================================

const MICRO_LEGEND: Readonly<Record<string, string>> = {
  // Layer 4: Kingdom Masks (K1 = 1..4, K2 = a..d)
  '1': RAMPS.magenta.highlight,
  '2': RAMPS.magenta.mid,
  '3': RAMPS.magenta.shadow,
  '4': RAMPS.magenta.deep,
  a: RAMPS.cyanMask.highlight,
  b: RAMPS.cyanMask.mid,
  c: RAMPS.cyanMask.shadow,
  d: RAMPS.cyanMask.deep,
  // Layer 5: Skin Mask (S/s/z/Z -> 4 shades #B8FF96..#4A831F)
  S: SKIN_MASK[0],
  s: SKIN_MASK[1],
  z: SKIN_MASK[2],
  Z: SKIN_MASK[3],
  // Materials (non-mask colors remain untouched during kingdom/skin recolor)
  I: '#BBBBBB', // bright steel / helmet
  i: '#888888', // steel shadow
  k: '#454750', // dark iron / slate
  K: '#3A485E', // dark steel-blue
  G: '#FFB800', // bright royal gold
  g: '#EDC916', // trim gold
  o: '#CD9400', // shaded gold
  T: '#9F643B', // warm wood / leather
  t: '#7A4C2D', // mid brown leather
  u: '#503422', // dark brown boots / strap
  U: '#4B2E1B', // deep umber leather
  J: '#D2D8C4', // natural light linen / canvas
  j: '#A6B6A7', // shaded linen / sage cloth
  P: '#AB7C3B', // ochre / steppe tan
  p: '#CB9243', // sandy trim
  F: '#8CD156', // bright moss
  f: '#5B9D38', // ranger green
  e: '#386B26', // deep forest green
  B: '#DBDBDB', // fur / white trim
  q: '#A1B1A2', // pale grey trim
  L: '#C0D5DE', // sky steel highlight
  l: '#7FA9BC', // sky steel shade
  W: WATER_LINE.light,
  w: WATER_LINE.mid,
  // Natural hair (NOT skin mask — stays constant when skin changes!)
  Y: '#E3E42B', // blonde
  H: '#4D3E11', // chestnut brown
  h: '#251F0E', // deep dark brown
  R: '#7F0000', // auburn / deep red
  r: '#917321', // honey brown
  N: '#382C0C', // dark espresso
  E: '#DBDBDB', // elder silver highlight
  V: '#D3D3D3', // elder silver shade
  // Festive winter hats (not masked)
  Q: '#C32327', // festive red cap
  m: '#95181C', // festive red shadow
  O: '#F2F2F2', // festive white fur trim
  v: '#C4C4C4', // festive trim shade
  // Zombie fixed palette (no K1/K2/skin masks, matches visual guide zombie sheet)
  X: '#00AD2C', // zombie bright skin
  x: '#008136', // zombie mid green
  y: '#00682B', // zombie deep green
  Z1: '#1C1C1C', // unused multi-char placeholder avoided
  D: '#1C1C1C', // zombie dark trousers (not an outline)
  d1: '#2B2B2B',
  M: '#8E3E36', // zombie exposed tissue / scar dot
};

// ============================================================================
// LAYER 3: EXACT 44 MICRO-HEADS (2×2 to 4×4 px, 1px skin face, ZERO EYES)
// Every head sits INSIDE the top rows of the 10×10 frame via 2×2 marker!
// ============================================================================

export const MALE_HEADS_11: readonly { name: string; matrix: PixelMatrix }[] = [
  { name: 'Светлый короткий', matrix: ['YY', 'SY'] }, // 2×2
  { name: 'Светлый чуб', matrix: ['YYY', 'YY.', 'SY.'] }, // 3×3
  { name: 'Светлая чёлка', matrix: ['YYY', 'SSY'] }, // 3×2
  { name: 'Высокий русый', matrix: ['YY', 'SY', 'YY'] }, // 2×3
  { name: 'Шатен короткий', matrix: ['HH', 'SH'] }, // 2×2
  { name: 'Густая каштановая', matrix: ['HHH', 'HSH', '.H.'] }, // 3×3
  { name: 'Тёмный боб', matrix: ['hhh', 'SSh'] }, // 3×2
  { name: 'Тёмный вихор', matrix: ['hhh', 'Shh'] }, // 3×2
  { name: 'Шатен с бородой', matrix: ['HH', 'SH', 'HH'] }, // 2×3
  { name: 'Лысина', matrix: ['SS', 'SS'] }, // 2×2 all skin
  { name: 'Тёмный ёршик', matrix: ['hh', 'Sh'] }, // 2×2
];

export const FEMALE_HEADS_11: readonly { name: string; matrix: PixelMatrix }[] = [
  { name: 'Длинная золотая коса', matrix: ['YYYY', 'YSYY', '..YY'] }, // 4×3
  { name: 'Светлое каре', matrix: ['YYY', 'SY.', 'YY.'] }, // 3×3
  { name: 'Светлый пучок', matrix: ['YYY', 'SYY'] }, // 3×2
  { name: 'Пышные золотые кудри', matrix: ['YYYY', 'YSYY', '.YYY'] }, // 4×3
  { name: 'Рыжий узел', matrix: ['RRR', 'SRR', '.RR'] }, // 3×3
  { name: 'Длинные каштановые', matrix: ['HHHH', 'HSHH', '..HH'] }, // 4×3
  { name: 'Каштановое каре', matrix: ['HHH', 'SHH', '.HH'] }, // 3×3
  { name: 'Волнистые чёрные', matrix: ['hhhh', 'hShh', '..hh'] }, // 4×3
  { name: 'Рыжая лента', matrix: ['RRR', 'SRR'] }, // 3×2
  { name: 'Медовые локоны', matrix: ['rrr', 'Srr', '.rr'] }, // 3×3
  { name: 'Тёмная коса', matrix: ['hhh', 'Shh', '.hh'] }, // 3×3
];

/** King golden crown + K1 jewel + 1px skin (3×4) */
export const KING_HEAD: { name: string; matrix: PixelMatrix } = {
  name: 'Золотая корона монарха',
  matrix: ['G.G', 'G1G', 'oSo', '.oo'],
};

/** 3 Imperial Alliance Monarch crowns uniting K1 + K2 pact gems (4×3 / 4×4, 9–10px, zero eyes) */
export const MONARCH_HEADS_3: readonly { name: string; matrix: PixelMatrix }[] = [
  { name: 'Имперская корона Альянса', matrix: ['G1aG', 'GGGG', '.oSo'] },
  { name: 'Солнечный венец Монарха', matrix: ['G.G.', '1GaG', '.SSo', '.GG.'] },
  { name: 'Крылатая тиара Содружества', matrix: ['B1aB', 'GGGG', '.SBo'] },
];

export const MONARCH_HEAD = MONARCH_HEADS_3[0];

/** Warrior iron helmet + K1 crest + 1px skin (3×3) */
export const WARRIOR_HEAD: { name: string; matrix: PixelMatrix } = {
  name: 'Железный шлем воина K1',
  matrix: ['14I', 'ISI', 'iIi'],
};

/** 10 culture-flavored helmet crests built cleanly on the 3×3 / 4×3 steel helmet core */
export const WARRIOR_HEADS_10: readonly { name: string; matrix: PixelMatrix }[] = [
  WARRIOR_HEAD,
  { name: 'Шлем следопыта', matrix: ['f1f', 'ISI', 'eie'] },
  { name: 'Рогатый шлем клана', matrix: ['B1B', 'ISI', 'iIi'] },
  { name: 'Морской шишак', matrix: ['1I1', 'ISI', 'KKi'] },
  { name: 'Степной золочёный', matrix: ['.g.', '1SI', 'iTi'] },
  { name: 'Меховой шлем оплота', matrix: ['B1B', 'BSI', 'uIu'] },
  { name: 'Литой шлем кузни', matrix: ['k1k', 'ISI', 'Kkk'] },
  { name: 'Пернатый шлем ордена', matrix: ['a1a', 'ISI', 'iIi'] },
  { name: 'Кочевничий тюрбан-шлем', matrix: ['11J', 'ISI', 'pTi'] },
  { name: 'Стальной барбют', matrix: ['I1I', 'ISI', 'KKi'] },
];

export const ELDER_MALE_HEAD: { name: string; matrix: PixelMatrix } = {
  name: 'Седина старика',
  matrix: ['EE', 'SV'],
};

export const ELDER_FEMALE_HEAD: { name: string; matrix: PixelMatrix } = {
  name: 'Седина старухи',
  matrix: ['EEEE', 'ESVV', '..VV'],
};

export const ELDER_HEADS_6: readonly { name: string; matrix: PixelMatrix }[] = [
  ELDER_MALE_HEAD,
  ELDER_FEMALE_HEAD,
  { name: 'Седой бородач', matrix: ['EE', 'SV', 'EV'] },
  { name: 'Седой мудрец', matrix: ['EEE', 'SSV'] },
  { name: 'Седой ветеран', matrix: ['VV', 'SV', 'EE'] },
  { name: 'Седая повязка', matrix: ['111', 'ESV', '.VV'] },
];

export const MALE_SANTA_HEADS_7: readonly { name: string; matrix: PixelMatrix }[] = [
  { name: 'Праздничная шапка (блок)', matrix: ['.QQ', 'OOQ', 'SOv', '.YO'] },
  { name: 'Праздничная шапка (мех)', matrix: ['.QQ.', 'OOOQ', 'HSHv', '.HO.'] },
  { name: 'Праздничная шапка (русый)', matrix: ['.QQ.', 'OOOQ', 'SSOv', '.HO.'] },
  { name: 'Праздничная шапка (тёмн.)', matrix: ['.QQ.', 'OOOQ', 'NSNv', '.NO.'] },
  { name: 'Праздничная шапка (ушан.)', matrix: ['.QQ', 'OOQ', 'SOv', '.HO'] },
  { name: 'Праздничная шапка (бород.)', matrix: ['.QQ', 'OOQ', 'SSv', '.OO'] },
  { name: 'Праздничная шапка (колп.)', matrix: ['.QQ', 'mOQ', 'SOv', '.HO'] },
];

export const FEMALE_SANTA_HEADS_7: readonly { name: string; matrix: PixelMatrix }[] = [
  { name: 'Зимний колпак (зол.)', matrix: ['.QQ', 'OOQ', 'SOv', '.YO'] },
  { name: 'Зимний колпак (коса)', matrix: ['.QQ.', 'OOOQ', 'HSHv', '.HH.'] },
  { name: 'Зимний колпак (каре)', matrix: ['.QQ', 'OOQ', 'SOv', '.HH'] },
  { name: 'Зимний колпак (тёмн.)', matrix: ['.QQ.', 'OOOQ', 'NSNv', '.NN.'] },
  { name: 'Зимний колпак (кудри)', matrix: ['.QQ.', 'OOOQ', 'HSHv', '.HO.'] },
  { name: 'Зимний колпак (мед.)', matrix: ['.QQ', 'OOQ', 'SOv', '.rr'] },
  { name: 'Зимний колпак (алый)', matrix: ['.QQ', 'OOQ', 'SOv', '.RR'] },
];

export const ZOMBIE_HEADS_4: readonly { name: string; matrix: PixelMatrix }[] = [
  { name: 'Зомби t_0', matrix: ['XX', 'MX'] },
  { name: 'Зомби t_1', matrix: ['XX', 'XM'] },
  { name: 'Зомби t_2', matrix: ['XX', '.X'] },
  { name: 'Зомби t_3', matrix: ['XX', 'xX'] },
];

export const ZOMBIE_HEAD = ZOMBIE_HEADS_4[0];

// ============================================================================
// LAYER 1 & 2: EXACT 34 MICRO-BODIES (10×10 FRAME, ROWS 0..3 EMPTY FOR HEAD)
// Rows below describe y=4..9 (6 rows, 10 chars wide) in the raw 10×10 walk_0!
// Notice zero black outline, ~17–32 opaque pixels, clear 4–8 color blocking!
// ============================================================================

interface BodyTemplate {
  readonly label: string;
  /** y=4..9 (6 rows of 10 chars): shoulders, arms/chest, waist, hem, legs, feet */
  readonly walkRows: readonly [string, string, string, string, string, string];
  /** y=6..8 (3 rows of 10 chars): upper chest & arms for swimming */
  readonly swimRows: readonly [string, string, string];
  readonly isChild?: boolean;
  readonly isZombie?: boolean;
}

const MALE_BODIES_10: readonly BodyTemplate[] = [
  {
    label: 'Речная туника',
    walkRows: [
      '...1SS1...',
      '.sS1S11...',
      '...1S11SS.',
      '...4444.S.',
      '...4..4...',
      '...S..S...',
    ],
    swimRows: ['...1SS1...', '.s.1S11.S.', '...4444...'],
  },
  {
    label: 'Лесной плащ',
    walkRows: [
      '...f11f...',
      '.s.fJJf...',
      '...1J1fSS.',
      '...eeee...',
      '...t..t...',
      '...S..S...',
    ],
    swimRows: ['...f11f...', '.s.fJJf.S.', '...eeee...'],
  },
  {
    label: 'Горный мех-жилет',
    walkRows: [
      '...BBBB...',
      '.s.B1aB...',
      '...12b1SS.',
      '...tuut...',
      '...u..u...',
      '...S..S...',
    ],
    swimRows: ['...BBBB...', '.s.B1aB.S.', '...tuut...'],
  },
  {
    label: 'Морской полосатый',
    walkRows: [
      '...1JJ1...',
      '.s.JJ1J...',
      '...1aJ1SS.',
      '...KKKK...',
      '...k..k...',
      '...S..S...',
    ],
    swimRows: ['...1JJ1...', '.s.JJ1J.S.', '...KKKK...'],
  },
  {
    label: 'Степное пончо',
    walkRows: [
      '...1gg1...',
      '.s.1P11...',
      '...g22gSS.',
      '...PPPP...',
      '...t..t...',
      '...S..S...',
    ],
    swimRows: ['...1gg1...', '.s.1P11.S.', '...PPPP...'],
  },
  {
    label: 'Северная дублёнка',
    walkRows: [
      '...BB1B...',
      '.s.T12T...',
      '...t33tSS.',
      '...uuuu...',
      '...U..U...',
      '...S..S...',
    ],
    swimRows: ['...BB1B...', '.s.T12T.S.', '...uuuu...'],
  },
  {
    label: 'Фартук кузнеца',
    walkRows: [
      '...1111...',
      '.s.1uu1...',
      '...2gU2SS.',
      '...uuuu...',
      '...k..k...',
      '...S..S...',
    ],
    swimRows: ['...1111...', '.s.1uu1.S.', '...uuuu...'],
  },
  {
    label: 'Орденская ряса',
    walkRows: [
      '...a11a...',
      '.s.ba1b...',
      '...b22bSS.',
      '...dddd...',
      '...K..K...',
      '...S..S...',
    ],
    swimRows: ['...a11a...', '.s.ba1b.S.', '...dddd...'],
  },
  {
    label: 'Хитон кочевника',
    walkRows: [
      '...J11J...',
      '.s.J12J...',
      '...pabpSS.',
      '...PPPP...',
      '...t..t...',
      '...S..S...',
    ],
    swimRows: ['...J11J...', '.s.J12J.S.', '...PPPP...'],
  },
  {
    label: 'Гамбезон цитадели',
    walkRows: [
      '...i11i...',
      '.s.K1aK...',
      '...k2bKSS.',
      '...KKKK...',
      '...k..k...',
      '...S..S...',
    ],
    swimRows: ['...i11i...', '.s.K1aK.S.', '...KKKK...'],
  },
];

const FEMALE_BODIES_10: readonly BodyTemplate[] = [
  {
    label: 'Платье с передником',
    walkRows: [
      '...1SS1...',
      '.s.1JJ1...',
      '...2JJ2.S.',
      '..333333..',
      '...3..3...',
      '...S..S...',
    ],
    swimRows: ['...1SS1...', '.s.1JJ1.S.', '...2JJ2...'],
  },
  {
    label: 'Лесной сарафан',
    walkRows: [
      '...f11f...',
      '.s.f22f...',
      '...faaf.S.',
      '..eeeeee..',
      '...e..e...',
      '...S..S...',
    ],
    swimRows: ['...f11f...', '.s.f22f.S.', '...faaf...'],
  },
  {
    label: 'Шерстяная шаль клана',
    walkRows: [
      '...BBBB...',
      '.s.B12B...',
      '...p2ap.S.',
      '..tttttt..',
      '...u..u...',
      '...S..S...',
    ],
    swimRows: ['...BBBB...', '.s.B12B.S.', '...p2ap...'],
  },
  {
    label: 'Морская юбка',
    walkRows: [
      '...1JJ1...',
      '.s.2aa2...',
      '...2JJ2.S.',
      '..44JJ44..',
      '...k..k...',
      '...S..S...',
    ],
    swimRows: ['...1JJ1...', '.s.2aa2.S.', '...2JJ2...'],
  },
  {
    label: 'Степное платье с каймой',
    walkRows: [
      '...1gg1...',
      '.s.12a1...',
      '...PggP.S.',
      '..PPPPPP..',
      '...t..t...',
      '...S..S...',
    ],
    swimRows: ['...1gg1...', '.s.12a1.S.', '...PggP...'],
  },
  {
    label: 'Зимний сарафан с мехом',
    walkRows: [
      '...B11B...',
      '.s.T22T...',
      '...taaT.S.',
      '..BBBBBB..',
      '...u..u...',
      '...S..S...',
    ],
    swimRows: ['...B11B...', '.s.T22T.S.', '...taaT...'],
  },
  {
    label: 'Платье ремесленницы',
    walkRows: [
      '...1111...',
      '.s.1uu1...',
      '...2gU2.S.',
      '..44uu44..',
      '...u..u...',
      '...S..S...',
    ],
    swimRows: ['...1111...', '.s.1uu1.S.', '...2gU2...'],
  },
  {
    label: 'Мантия звёзд',
    walkRows: [
      '...a11a...',
      '.s.ba1b...',
      '...bc2b.S.',
      '..dddddd..',
      '...K..K...',
      '...S..S...',
    ],
    swimRows: ['...a11a...', '.s.ba1b.S.', '...bc2b...'],
  },
  {
    label: 'Шёлковый хитон',
    walkRows: [
      '...J11J...',
      '.s.J12J...',
      '...pabp.S.',
      '..pppppp..',
      '...t..t...',
      '...S..S...',
    ],
    swimRows: ['...J11J...', '.s.J12J.S.', '...pabp...'],
  },
  {
    label: 'Придворный корсет',
    walkRows: [
      '...i11i...',
      '.s.K1aK...',
      '...k2bk.S.',
      '..KKKKKK..',
      '...k..k...',
      '...S..S...',
    ],
    swimRows: ['...i11i...', '.s.K1aK.S.', '...k2bk...'],
  },
];

const WARRIOR_BODIES_10: readonly BodyTemplate[] = [
  {
    label: 'Доспех Речной Гильдии',
    walkRows: ['..I1111...', '.Ii122iTT.', '..k333kTu.', '..k444kTT.', '...k..k...', '...S..S...'],
    swimRows: ['..I1111...', '.Ii122i...', '..k333k...'],
  },
  {
    label: 'Доспех Лесных Следопытов',
    walkRows: ['..f111f...', '.efI2Ifee.', '..e333efT.', '..etttet..', '...t..t...', '...S..S...'],
    swimRows: ['..f111f...', '.efI2If...', '..e333e...'],
  },
  {
    label: 'Доспех Горных Кланов',
    walkRows: ['..B1a1B...', '.IB2b2III.', '..kt3tkIi.', '..tuuutk..', '...u..u...', '...S..S...'],
    swimRows: ['..B1a1B...', '.IB2b2I...', '..kt3tk...'],
  },
  {
    label: 'Доспех Морской Лиги',
    walkRows: ['..I1J1I...', '.Ki1a1KTt.', '..k2J2kTT.', '..KKKKk...', '...k..k...', '...S..S...'],
    swimRows: ['..I1J1I...', '.Ki1a1K...', '..k2J2k...'],
  },
  {
    label: 'Доспех Степных Наездников',
    walkRows: ['..g111g...', '.Tg2a2Tgg.', '..t333tTt.', '..PPPPt...', '...t..t...', '...S..S...'],
    swimRows: ['..g111g...', '.Tg2a2T...', '..t333t...'],
  },
  {
    label: 'Доспех Северного Оплота',
    walkRows: ['..B111B...', '.IB121BII.', '..t333tkI.', '..uuuuuk..', '...U..U...', '...S..S...'],
    swimRows: ['..B111B...', '.IB121B...', '..t333t...'],
  },
  {
    label: 'Доспех Огненной Кузни',
    walkRows: ['..k111k...', '.Ik2g2IKk.', '..k3U3kKk.', '..kkkkK...', '...k..k...', '...S..S...'],
    swimRows: ['..k111k...', '.Ik2g2I...', '..k3U3k...'],
  },
  {
    label: 'Доспех Ордена Звёзд',
    walkRows: ['..L1a1L...', '.Ll1b1LII.', '..i232ilL.', '..ddddK...', '...K..K...', '...S..S...'],
    swimRows: ['..L1a1L...', '.Ll1b1L...', '..i232i...'],
  },
  {
    label: 'Доспех Песчаных Кочевников',
    walkRows: ['..p111p...', '.Jp1a1Jpp.', '..t2b2tTp.', '..PPPPt...', '...t..t...', '...S..S...'],
    swimRows: ['..p111p...', '.Jp1a1J...', '..t2b2t...'],
  },
  {
    label: 'Доспех Стальной Цитадели',
    walkRows: ['..I111I...', '.KI1a1KII.', '..k232kKk.', '..KKKKk...', '...K..K...', '...S..S...'],
    swimRows: ['..I111I...', '.KI1a1K...', '..k232k...'],
  },
];

const UNIQUE_ROLE_BODIES: Record<'king' | 'monarch' | 'leader' | 'child' | 'zombie', BodyTemplate> = {
  king: {
    label: 'Королевская мантия',
    walkRows: [
      '..G111G...',
      '.G31G13...',
      '..3GGG3SS.',
      '..44344...',
      '...o..o...',
      '...S..S...',
    ],
    swimRows: ['..G111G...', '.G31G13.S.', '..3GGG3...'],
  },
  monarch: {
    label: 'Имперская мантия Альянса',
    walkRows: [
      '.BG1aGB...',
      '.G1GGaG...',
      '..2GGb2SS.',
      '..33cbb...',
      '...G..G...',
      '...S..S...',
    ],
    swimRows: ['.BG1aGB...', '.G1GGaG.S.', '..2GGb2...'],
  },
  leader: {
    label: 'Накидка лидера',
    walkRows: [
      '..31113...',
      '.T31S13...',
      '..32223SS.',
      '..44344...',
      '...u..u...',
      '...S..S...',
    ],
    swimRows: ['..31113...', '.s.31S1.S.', '..32223...'],
  },
  child: {
    label: 'Детский костюм',
    walkRows: [
      '..........',
      '....111...',
      '..s.232...',
      '....333.S.',
      '....3.3...',
      '....S.S...',
    ],
    swimRows: ['..........', '...111....', '.s.232.S..'],
    isChild: true,
  },
  zombie: {
    label: 'Тело зомби',
    walkRows: [
      '..XXxX....',
      'X.xxyx....',
      '..yDDy....',
      '..DDDD....',
      '..D..D....',
      '..y..y....',
    ],
    swimRows: ['..XXxX....', 'X.xxyx....', '..yDDy....'],
    isZombie: true,
  },
};

export function resolveEffectiveRole(spec: HumanAppearanceSpec): HumanRole {
  if (spec.isZombie || spec.role === 'zombie') return 'zombie';
  if (spec.ageStage === 'child' || spec.role === 'child') return 'child';
  return spec.role;
}

export function describeHumanLayers(spec: HumanAppearanceSpec): HumanLayerBreakdown {
  const effectiveRole = resolveEffectiveRole(spec);
  const cultureId = ((spec.cultureId % 10) + 10) % 10;
  const culture = HUMAN_CULTURES[cultureId];
  const kingdomColor =
    HUMAN_KINGDOM_COLORS_88[((spec.kingdomColorIdx % 88) + 88) % 88];
  const alliedKingdomColor =
    spec.alliedKingdomColorIdx !== undefined
      ? HUMAN_KINGDOM_COLORS_88[((spec.alliedKingdomColorIdx % 88) + 88) % 88]
      : effectiveRole === 'monarch'
        ? HUMAN_KINGDOM_COLORS_88[(((spec.kingdomColorIdx + 1) % 88) + 88) % 88]
        : undefined;
  const skinColor =
    HUMAN_SKIN_COLORS_52[((spec.skinColorIdx % 52) + 52) % 52];

  let bodyKey = '';
  let bodyLabel = '';
  if (effectiveRole === 'man') {
    bodyKey = `male_${cultureId + 1}`;
    bodyLabel = `Мужчина · ${MALE_BODIES_10[cultureId].label}`;
  } else if (effectiveRole === 'woman') {
    bodyKey = `female_${cultureId + 1}`;
    bodyLabel = `Женщина · ${FEMALE_BODIES_10[cultureId].label}`;
  } else if (effectiveRole === 'warrior') {
    bodyKey = `warrior_${cultureId + 1}`;
    bodyLabel = `Воин · ${WARRIOR_BODIES_10[cultureId].label}`;
  } else {
    bodyKey = effectiveRole;
    bodyLabel = UNIQUE_ROLE_BODIES[effectiveRole].label;
  }

  let headKey = '';
  let headLabel = '';
  if (effectiveRole === 'zombie') {
    const idx = Math.abs(spec.headVariant) % ZOMBIE_HEADS_4.length;
    headKey = `t_${idx}`;
    headLabel = ZOMBIE_HEADS_4[idx].name;
  } else if (effectiveRole === 'child') {
    const idx = Math.abs(spec.headVariant) % MALE_HEADS_11.length;
    headKey = `head_male_${idx}`;
    headLabel = `${MALE_HEADS_11[idx].name} (Ребёнок)`;
  } else if (effectiveRole === 'monarch') {
    const idx = Math.abs(spec.headVariant) % MONARCH_HEADS_3.length;
    headKey = `head_monarch_${idx}`;
    headLabel = MONARCH_HEADS_3[idx].name;
  } else if (spec.ageStage === 'elder') {
    if (spec.role === 'woman') {
      headKey = 'head_old_female';
      headLabel = `${ELDER_FEMALE_HEAD.name} (Старуха)`;
    } else {
      headKey = 'head_old_male';
      headLabel = `${ELDER_MALE_HEAD.name} (Старик)`;
    }
  } else if (effectiveRole === 'king') {
    headKey = 'head_king';
    headLabel = KING_HEAD.name;
  } else if (effectiveRole === 'warrior') {
    headKey = `head_warrior_${cultureId}`;
    headLabel = WARRIOR_HEADS_10[cultureId].name;
  } else if (spec.isFestive) {
    if (effectiveRole === 'woman') {
      const idx = Math.abs(spec.headVariant) % FEMALE_SANTA_HEADS_7.length;
      headKey = `female_santa_${idx}`;
      headLabel = FEMALE_SANTA_HEADS_7[idx].name;
    } else {
      const idx = Math.abs(spec.headVariant) % MALE_SANTA_HEADS_7.length;
      headKey = `male_santa_${idx}`;
      headLabel = MALE_SANTA_HEADS_7[idx].name;
    }
  } else if (effectiveRole === 'leader') {
    headKey = 'head_male_3';
    headLabel = `${MALE_HEADS_11[3].name} (Лидер)`;
  } else if (effectiveRole === 'woman') {
    const idx = Math.abs(spec.headVariant) % FEMALE_HEADS_11.length;
    headKey = `female_head_${idx}`;
    headLabel = FEMALE_HEADS_11[idx].name;
  } else {
    const idx = Math.abs(spec.headVariant) % MALE_HEADS_11.length;
    headKey = `male_head_${idx}`;
    headLabel = MALE_HEADS_11[idx].name;
  }

  return {
    bodyKey,
    bodyLabel,
    headKey,
    headLabel,
    cultureName: culture.name,
    kingdomColor,
    alliedKingdomColor,
    skinColor,
    effectiveRole,
  };
}

function getBodyTemplate(effectiveRole: HumanRole, cultureId: number): BodyTemplate {
  const c = ((cultureId % 10) + 10) % 10;
  if (effectiveRole === 'man') return MALE_BODIES_10[c];
  if (effectiveRole === 'woman') return FEMALE_BODIES_10[c];
  if (effectiveRole === 'warrior') return WARRIOR_BODIES_10[c];
  return UNIQUE_ROLE_BODIES[effectiveRole];
}

function getHeadMatrix(spec: HumanAppearanceSpec, effectiveRole: HumanRole): PixelMatrix {
  if (effectiveRole === 'zombie') {
    return ZOMBIE_HEADS_4[Math.abs(spec.headVariant) % ZOMBIE_HEADS_4.length].matrix;
  }
  if (effectiveRole === 'child') {
    return MALE_HEADS_11[Math.abs(spec.headVariant) % MALE_HEADS_11.length].matrix;
  }
  if (effectiveRole === 'monarch') {
    return MONARCH_HEADS_3[Math.abs(spec.headVariant) % MONARCH_HEADS_3.length].matrix;
  }
  if (spec.ageStage === 'elder') {
    return spec.role === 'woman' ? ELDER_FEMALE_HEAD.matrix : ELDER_MALE_HEAD.matrix;
  }
  if (effectiveRole === 'king') return KING_HEAD.matrix;
  if (effectiveRole === 'warrior') {
    return WARRIOR_HEADS_10[((spec.cultureId % 10) + 10) % 10].matrix;
  }
  if (spec.isFestive) {
    if (effectiveRole === 'woman') {
      return FEMALE_SANTA_HEADS_7[Math.abs(spec.headVariant) % FEMALE_SANTA_HEADS_7.length].matrix;
    }
    return MALE_SANTA_HEADS_7[Math.abs(spec.headVariant) % MALE_SANTA_HEADS_7.length].matrix;
  }
  if (effectiveRole === 'leader') return MALE_HEADS_11[3].matrix;
  if (effectiveRole === 'woman') {
    return FEMALE_HEADS_11[Math.abs(spec.headVariant) % FEMALE_HEADS_11.length].matrix;
  }
  return MALE_HEADS_11[Math.abs(spec.headVariant) % MALE_HEADS_11.length].matrix;
}

function buildHumanColorLookup(spec: HumanAppearanceSpec): Map<string, string> {
  const map = new Map<string, string>();
  const effectiveRole = resolveEffectiveRole(spec);
  const kingdom = HUMAN_KINGDOM_COLORS_88[((spec.kingdomColorIdx % 88) + 88) % 88];
  const alliedKingdom =
    spec.alliedKingdomColorIdx !== undefined
      ? HUMAN_KINGDOM_COLORS_88[((spec.alliedKingdomColorIdx % 88) + 88) % 88]
      : effectiveRole === 'monarch'
        ? HUMAN_KINGDOM_COLORS_88[(((spec.kingdomColorIdx + 1) % 88) + 88) % 88]
        : null;
  const k1 = calculateKingdomRamp(kingdom.primaryHex);
  const k2 = calculateKingdomRamp(alliedKingdom ? alliedKingdom.primaryHex : kingdom.secondaryHex);
  K1_MASK.forEach((src, i) => map.set(src.toUpperCase(), k1[i]));
  K2_MASK.forEach((src, i) => map.set(src.toUpperCase(), k2[i]));

  const skin = HUMAN_SKIN_COLORS_52[((spec.skinColorIdx % 52) + 52) % 52];
  const skinStops = calculateSkinShades(skin.fromHex, skin.toHex, spec.skinShade);
  SKIN_MASK.forEach((src, i) => map.set(src.toUpperCase(), skinStops[i]));
  return map;
}

function stampCharMatrix(
  buf: PixelBuffer,
  matrix: PixelMatrix,
  ox: number,
  oy: number
): void {
  for (let r = 0; r < matrix.length; r++) {
    const line = matrix[r];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '.' || ch === ' ') continue;
      const col = MICRO_LEGEND[ch];
      if (col) buf.setPixel(ox + c, oy + r, col);
    }
  }
}

/**
 * Computes head marker position inside the 10×10 (or 10×11 child) frame,
 * matching exact marker kinematics from Sandbox_humans_visual_guide:
 * - Adults: walk yFromBottom=[6, 8, 7, 5], swim yFromBottom=[4, 3, 4, 3]
 * - Child:  walk yFromBottom=[4, 5, 4, 5], swim yFromBottom=[3, 4, 3, 4]
 * - Zombie: x shifted 1px left (hunched)
 */
export function getHumanHeadMarker(
  effectiveRole: HumanRole,
  mode: UnitMode,
  frameIndex: number
): { x: number; yFromBottom: number } {
  const f = ((frameIndex % 4) + 4) % 4;
  if (effectiveRole === 'child') {
    const yArr = mode === 'swim' ? [3, 4, 3, 4] : [4, 5, 4, 5];
    const xArr = mode === 'swim' ? [4, 4, 4, 4] : [4, 4, 3, 4];
    return { x: xArr[f], yFromBottom: yArr[f] };
  }
  const yArr = mode === 'swim' ? [4, 3, 4, 3] : [6, 8, 7, 5];
  const x = effectiveRole === 'zombie' && mode !== 'swim' ? 3 : 4;
  return { x, yFromBottom: yArr[f] };
}

/**
 * Stamps the 34-sheet 10×10 micro-body onto a 12×12 PixelBuffer (offset +1,+1).
 * Walk frames animate torso bounce [0, -2, -1, +1] matching the marker [6,8,7,5]
 * plus clean 1px leg stride & arm swing. Swim frames render only upper torso + ripple.
 */
function stampAnimatedMicroBody(
  buf: PixelBuffer,
  tpl: BodyTemplate,
  effectiveRole: HumanRole,
  frameIndex: number,
  mode: UnitMode
): void {
  const f = ((frameIndex % 4) + 4) % 4;
  const ox = 1;
  const oy = 1;

  if (mode === 'swim') {
    const swimBob = f === 1 || f === 3 ? 1 : 0;
    const zDrop = tpl.isZombie ? 1 : 0;
    const baseY = oy + 6 + swimBob + zDrop;
    stampCharMatrix(buf, tpl.swimRows, ox, baseY);
    // Crisp 2-tone water ripple below chest
    const ripY = Math.min(HUMAN_CANVAS_H - 1, baseY + 3);
    const rip = f % 2 === 0 ? '..WwWwWw..' : '..wWwWwW..';
    stampCharMatrix(buf, [rip], ox, ripY);
    return;
  }

  // Walk cycle: body shifts vertically in sync with head marker [6, 8, 7, 5] (child [4, 5, 4, 5])
  const yShifts = tpl.isChild ? [0, -1, 0, -1] : [0, -2, -1, 1];
  const dy = yShifts[f];

  // Upper torso (rows 0..3 of walkRows -> y = 4..7 in 10×10)
  const upperRows = tpl.walkRows.slice(0, 4);
  for (let r = 0; r < upperRows.length; r++) {
    const line = upperRows[r];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '.' || ch === ' ') continue;
      // Subtle arm swing on outermost left/right hand columns (c <= 1 or c >= 8)
      let armDy = 0;
      if (c <= 1) armDy = f === 1 ? -1 : f === 3 ? 1 : 0;
      else if (c >= 8) armDy = f === 1 ? 1 : f === 3 ? -1 : 0;
      const col = MICRO_LEGEND[ch];
      if (col) buf.setPixel(ox + c, oy + 4 + r + dy + armDy, col);
    }
  }

  // Lower legs & 1px feet (rows 4..5 of walkRows -> y = 8..9 in 10×10)
  const legRow = tpl.walkRows[4];
  const footRow = tpl.walkRows[5];
  const legCols: { x: number; legCh: string; footCh: string }[] = [];
  for (let c = 0; c < legRow.length; c++) {
    if (legRow[c] !== '.' || footRow[c] !== '.') {
      legCols.push({
        x: c,
        legCh: legRow[c] !== '.' ? legRow[c] : footRow[c],
        footCh: footRow[c] !== '.' ? footRow[c] : legRow[c],
      });
    }
  }

  legCols.forEach((leg, idx) => {
    const isLeft = idx === 0;
    let dx = 0;
    let legLift = 0;
    if (f === 1) {
      dx = isLeft ? -1 : 1;
      legLift = isLeft ? -1 : 0;
    } else if (f === 2) {
      dx = isLeft ? 1 : -1;
      legLift = 0;
    } else if (f === 3) {
      dx = isLeft ? 0 : 1;
      legLift = 1;
    }
    const baseLegY = oy + 8 + Math.max(-1, Math.min(0, dy)) + legLift;
    const lc = MICRO_LEGEND[leg.legCh];
    const fc = MICRO_LEGEND[leg.footCh];
    if (lc) buf.setPixel(ox + leg.x + dx, Math.min(10, baseLegY), lc);
    if (fc && baseLegY + 1 <= 10) buf.setPixel(ox + leg.x + dx, baseLegY + 1, fc);
  });

  // Subtle role item marker pixel (sceptre tip for king/monarch, banner tip for leader)
  if (effectiveRole === 'king') {
    buf.setPixel(ox + 0, oy + 4 + dy, MICRO_LEGEND.G);
    buf.setPixel(ox + 0, oy + 5 + dy, MICRO_LEGEND.o);
  } else if (effectiveRole === 'monarch') {
    buf.setPixel(ox + 0, oy + 4 + dy, MICRO_LEGEND.G);
    buf.setPixel(ox + 0, oy + 5 + dy, MICRO_LEGEND.a);
    buf.setPixel(ox + 0, oy + 6 + dy, MICRO_LEGEND.o);
  } else if (effectiveRole === 'leader') {
    buf.setPixel(ox + 0, oy + 3 + dy, MICRO_LEGEND['1']);
    buf.setPixel(ox + 0, oy + 4 + dy, MICRO_LEGEND.T);
    buf.setPixel(ox + 0, oy + 5 + dy, MICRO_LEGEND.T);
  }
}

/**
 * Stamps stationary 7×3 unitShadow_5 (#11102B at alpha 0.404 -> #11102B67)
 * directly beneath pivot (0.5, 0.0) without overwriting foreground pixels!
 */
function applyUnitShadow5(buf: PixelBuffer, stageBg: StageBg): void {
  const shadowHex =
    stageBg === 'dark'
      ? '#06061270'
      : stageBg === 'parchment'
        ? '#11102B48'
        : '#11102B67';
  const rows: readonly [number, number, number][] = [
    // [y, xStart, xEnd] — crisp 7×3 rounded ellipse centered at x=6
    [9, 4, 8],
    [10, 3, 9],
    [11, 4, 8],
  ];
  for (const [y, x0, x1] of rows) {
    for (let x = x0; x <= x1; x++) {
      if (!buf.getPixel(x, y)) {
        buf.setPixel(x, y, shadowHex);
      }
    }
  }
}

export interface HumanRenderOptions {
  readonly frameIndex?: number;
  readonly totalFrames?: number;
  readonly mode?: UnitMode;
  readonly action?: UnitAction;
  readonly showShadow?: boolean;
  readonly stageBg?: StageBg;
  readonly partOnly?: 'full' | 'body' | 'head';
  readonly showMarkers?: boolean;
}

/**
 * Renders a true 10×10 micro human sprite inside a 12×12 PixelBuffer
 * combining all 6 independent layers with zero black outline.
 */
export function renderHumanSprite(
  spec: HumanAppearanceSpec,
  opts?: HumanRenderOptions
): PixelBuffer {
  const frameIndex = opts?.frameIndex ?? 0;
  const totalFrames = opts?.totalFrames ?? 4;
  const mode = opts?.mode ?? 'walk';
  const action = opts?.action ?? 'normal';
  const partOnly = opts?.partOnly ?? 'full';
  const effectiveRole = resolveEffectiveRole(spec);

  const bodyTpl = getBodyTemplate(effectiveRole, spec.cultureId);
  const headMatrix = getHeadMatrix(spec, effectiveRole);
  const marker = getHumanHeadMarker(effectiveRole, mode, frameIndex);

  const raw = new PixelBuffer(HUMAN_CANVAS_W, HUMAN_CANVAS_H);

  // 1 & 2: Micro Body (10×10 frame stamped at +1,+1; empty top rows for head)
  if (partOnly === 'full' || partOnly === 'body') {
    stampAnimatedMicroBody(raw, bodyTpl, effectiveRole, frameIndex, mode);
  }

  // 3: Micro Head (2×2 to 4×4) pasted at the exact frame marker position!
  if (partOnly === 'full' || partOnly === 'head') {
    const hw = headMatrix[0].length;
    const hh = headMatrix.length;
    if (partOnly === 'head') {
      const hx = Math.floor((HUMAN_CANVAS_W - hw) / 2);
      const hy = Math.floor((HUMAN_CANVAS_H - hh) / 2);
      stampCharMatrix(raw, headMatrix, hx, hy);
    } else {
      const markerBottomY = 11 - marker.yFromBottom; // 11 = bottom of 10×10 inside 12×12
      const markerLeftX = 1 + marker.x;
      const hx = Math.max(0, Math.min(HUMAN_CANVAS_W - hw, markerLeftX - Math.floor((hw - 2) / 2)));
      const hy = Math.max(0, markerBottomY - hh);
      stampCharMatrix(raw, headMatrix, hx, hy);
    }
  }

  // 4 & 5: Recolor K1/K2 (88 kingdom colors) + SKIN_MASK (52 skins × 4 shades)
  // Hair, gold crown, steel armor, and zombie green remain untouched!
  const lookup = buildHumanColorLookup(spec);
  let out = raw.recolorWithLookup(lookup);

  // 6: Layer 6 Visual Mutations (compact 1-2px micro markers matching 10×10 scale)
  if (spec.mutation === 'giant') {
    const sy = 5 + (frameIndex % 4 === 1 ? -1 : 0);
    const colL = out.getPixel(3, sy) ?? RAMPS.gold.mid;
    const colR = out.getPixel(8, sy) ?? RAMPS.gold.mid;
    out.setPixel(2, sy, colL);
    out.setPixel(9, sy, colR);
  } else if (spec.mutation === 'energized') {
    const sparkX = frameIndex % 2 === 0 ? 1 : 10;
    out.setPixel(sparkX, 2 + (frameIndex % 3), '#7BF5FF');
    out.setPixel(11 - sparkX, 7, '#38BDF8');
  } else if (spec.mutation === 'plague') {
    out.setPixel(2, 4 + (frameIndex % 2), '#9DFF47');
    out.setPixel(9, 6, '#A855F7');
  } else if (spec.mutation === 'fire_blood') {
    out.setPixel(2, 3 + (frameIndex % 2), '#FF6A1A');
    out.setPixel(9, 4 + ((frameIndex + 1) % 2), '#FFD34D');
  }

  // Combat & Action transforms
  const p = frameIndex / Math.max(1, totalFrames);
  if (action === 'attack') {
    const tilt = Math.sin(p * Math.PI * 2) > 0 ? -18 : 8;
    out = out.rotateAround(6, 11, tilt);
    out.setPixel(1, 5, '#FFFFFF');
    out.setPixel(2, 6, '#C2F0FF');
  } else if (action === 'hit') {
    out = out.applyColorOverlay(frameIndex % 2 === 0 ? '#FFFFFF' : '#FF2424', 0.55);
  } else if (action === 'death') {
    out = out.rotateAround(6, 11, Math.min(90, p * 220)).applyColorOverlay('#090808', 0.45, 0.7);
  }

  // Optional debug overlay for guide markers (2×2 yellow head marker, 1×3 blue item, red pivot)
  if (opts?.showMarkers && partOnly !== 'head') {
    const markerBottomY = 11 - marker.yFromBottom;
    const mx = 1 + marker.x;
    for (let y = Math.max(0, markerBottomY - 2); y < markerBottomY; y++) {
      for (let x = mx; x < mx + 2; x++) {
        if (!out.getPixel(x, y)) out.setPixel(x, y, '#EAB308AA');
      }
    }
    if (mode !== 'swim') {
      for (let y = 5; y <= 7; y++) {
        if (!out.getPixel(1, y)) out.setPixel(1, y, '#38BDF8AA');
      }
    }
    out.setPixel(6, 11, '#EF4444');
  }

  // Stationary unitShadow_5 under pivot (never jumps with body!)
  if (opts?.showShadow && mode !== 'swim' && action !== 'death' && partOnly === 'full') {
    applyUnitShadow5(out, opts.stageBg ?? 'meadow');
  }

  return out;
}

// ============================================================================
// DETERMINISTIC FACTORY, FAMILY INHERITANCE & COMBINATORIAL TELEMETRY
// ============================================================================

export function createHumanFromId(
  personalId: number,
  overrides?: Partial<HumanAppearanceSpec>
): HumanAppearanceSpec {
  const s = Math.abs(Math.round(personalId)) + 1;
  const h1 = ((s * 2654435761) >>> 0);
  const h2 = (((s + 17) * 2246822519) >>> 0);
  const rolePool: HumanRole[] = ['man', 'man', 'man', 'woman', 'woman', 'woman', 'warrior', 'warrior', 'child', 'leader', 'king'];

  return {
    personalId,
    cultureId: h1 % 10,
    role: rolePool[h2 % rolePool.length],
    headVariant: (h1 >>> 5) % 11,
    kingdomColorIdx: (h2 >>> 4) % 88,
    skinColorIdx: (h1 >>> 9) % 52,
    skinShade: ((h2 >>> 10) % 4) as 0 | 1 | 2 | 3,
    ageStage: (h2 % 11 === 8) ? 'child' : (h1 % 9 === 0 ? 'elder' : 'adult'),
    isZombie: false,
    mutation: 'none',
    isFestive: false,
    ...overrides,
  };
}

export function createChildFromParents(
  parentA: HumanAppearanceSpec,
  parentB: HumanAppearanceSpec,
  childPersonalId: number,
  adultRole: 'man' | 'woman' = (childPersonalId % 2 === 0 ? 'man' : 'woman')
): HumanAppearanceSpec {
  const hash = ((Math.abs(childPersonalId) * 2654435761) >>> 0);
  const pickParentB = (hash & 1) === 1;
  const inheritedSkin = pickParentB ? parentB.skinColorIdx : parentA.skinColorIdx;
  const inheritedShade = ((pickParentB ? parentB.skinShade : parentA.skinShade) + ((hash >> 2) % 2)) % 4;
  return {
    personalId: childPersonalId,
    cultureId: parentA.cultureId,
    role: adultRole,
    headVariant: (hash >>> 4) % 11,
    kingdomColorIdx: parentA.kingdomColorIdx,
    skinColorIdx: inheritedSkin,
    skinShade: inheritedShade as 0 | 1 | 2 | 3,
    ageStage: 'child',
    isZombie: false,
    mutation: 'none',
    isFestive: false,
  };
}

export function getHumanDiversitySummary() {
  const bodiesCount =
    MALE_BODIES_10.length +
    FEMALE_BODIES_10.length +
    WARRIOR_BODIES_10.length +
    Object.keys(UNIQUE_ROLE_BODIES).length; // 10+10+10+5 = 35
  const headsCount =
    MALE_HEADS_11.length +
    FEMALE_HEADS_11.length +
    1 + // head_king
    MONARCH_HEADS_3.length + // 3 monarch crowns
    1 + // head_warrior
    2 + // head_old_male + head_old_female
    MALE_SANTA_HEADS_7.length +
    FEMALE_SANTA_HEADS_7.length +
    ZOMBIE_HEADS_4.length; // 11+11+1+3+1+2+7+7+4 = 47 exact!
  const kingdomColors = HUMAN_KINGDOM_COLORS_88.length; // 88
  const skinVariants = HUMAN_SKIN_COLORS_52.length * 4; // 208
  const totalCombinations =
    10 * // cultures
    22 * // standard heads (11m+11f)
    kingdomColors *
    skinVariants *
    3 * // age stages
    5; // mutations

  return {
    bodiesCount,
    headsCount,
    culturesCount: HUMAN_CULTURES.length,
    kingdomColors,
    skinColors: HUMAN_SKIN_COLORS_52.length,
    skinShades: 4,
    totalCombinations,
  };
}

// ============================================================================
// TOP-DOWN CROWD SIMULATION (8×8 MAP TILES, 10×10 MICRO HUMANS)
// ============================================================================

export interface CrowdCitizen {
  readonly spec: HumanAppearanceSpec;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: -1 | 1;
  walkPhase: number;
}

export type CrowdScenario = 'two-cultures-same-kingdom' | 'one-culture-two-kingdoms' | 'full-empire-mix';

export function buildHumanCrowd(
  scenario: CrowdScenario,
  seed = 101,
  mapW = 240,
  mapH = 112
): CrowdCitizen[] {
  const citizens: CrowdCitizen[] = [];
  const rolesPattern: HumanRole[] = [
    'monarch',
    'king',
    'leader',
    'warrior',
    'warrior',
    'warrior',
    'man',
    'man',
    'woman',
    'woman',
    'woman',
    'child',
  ];

  const count = 24;
  for (let i = 0; i < count; i++) {
    const id = seed * 100 + i;
    const isGroupB = i >= count / 2;
    let cultureId = 0;
    let kingdomColorIdx = 0;
    let skinColorIdx = 4;

    if (scenario === 'two-cultures-same-kingdom') {
      cultureId = isGroupB ? 4 : 0;
      kingdomColorIdx = 0;
      skinColorIdx = isGroupB ? 22 + (i % 8) : 4 + (i % 8);
    } else if (scenario === 'one-culture-two-kingdoms') {
      cultureId = 2;
      kingdomColorIdx = isGroupB ? 1 : 0;
      skinColorIdx = 8 + ((i * 3) % 16);
    } else {
      cultureId = isGroupB ? 9 : 4;
      kingdomColorIdx = isGroupB ? 3 : 1;
      skinColorIdx = (i * 5) % 52;
    }

    const rawRole = rolesPattern[i % rolesPattern.length];
    const isElder = i === 6 || i === 18;
    const spec = createHumanFromId(id, {
      cultureId,
      role: rawRole,
      headVariant: i % 11,
      kingdomColorIdx,
      skinColorIdx,
      skinShade: (i % 4) as 0 | 1 | 2 | 3,
      ageStage: rawRole === 'child' ? 'child' : isElder ? 'elder' : 'adult',
    });

    const baseX = isGroupB
      ? mapW * 0.56 + ((i % 6) * (mapW * 0.065))
      : mapW * 0.08 + ((i % 6) * (mapW * 0.065));
    const baseY = 24 + Math.floor((i % 12) / 6) * (mapH * 0.32) + ((i * 11) % 18);
    const ang = ((i * 73) % 360) * (Math.PI / 180);
    citizens.push({
      spec,
      x: Math.max(14, Math.min(mapW - 14, baseX + ((i * 5) % 11))),
      y: Math.max(18, Math.min(mapH - 10, baseY)),
      vx: Math.cos(ang) * 10,
      vy: Math.sin(ang) * 6.5,
      facing: Math.cos(ang) >= 0 ? 1 : -1,
      walkPhase: i * 0.7,
    });
  }
  return citizens;
}

export function stepHumanCrowd(citizens: CrowdCitizen[], dt: number, mapW = 240, mapH = 112): void {
  for (const c of citizens) {
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.walkPhase += dt * (c.spec.isZombie ? 4 : 6.5);

    if (c.x < 12) {
      c.x = 12;
      c.vx = Math.abs(c.vx);
    } else if (c.x > mapW - 12) {
      c.x = mapW - 12;
      c.vx = -Math.abs(c.vx);
    }

    if (c.y < 16) {
      c.y = 16;
      c.vy = Math.abs(c.vy);
    } else if (c.y > mapH - 8) {
      c.y = mapH - 8;
      c.vy = -Math.abs(c.vy);
    }
    c.facing = c.vx >= 0 ? 1 : -1;
  }
}
