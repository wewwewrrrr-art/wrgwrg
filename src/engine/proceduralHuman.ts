import { hexToRgba, INK } from './palette';
import { PixelBuffer } from './pixelCanvas';
import {
  FourToneRamp,
  HAIR_PALETTES_12,
  HairPaletteDef,
  KINGDOM_PALETTES_84,
  KingdomPaletteDef,
  SKIN_PALETTES_14,
  SkinPaletteDef,
} from './proceduralPalettes';
import {
  UNIT_ANIMATION_ACTIONS,
  UNIT_ANIMATION_SPECS,
  UNIT_CARRY_ITEMS,
  type UnitAnimationAction,
  type UnitAnimationSpec,
  type UnitCarryItem,
  computeWalkAnchors,
  getUnitActionSpec,
  normalizeActionFrameIndex,
  renderMedievalAnimatedUnit,
} from './proceduralHumanAnimations';
import {
  getRaceActionSpec,
  renderAnimatedCustomRaceUnit,
} from './proceduralRaceAnimations';
import {
  getCustomRaceSkinRamp,
  isCustomSilhouetteRace,
  renderCustomRaceLayers,
} from './proceduralRaces';
import { BakedSpriteAtlas } from './spriteAtlas';

export {
  UNIT_ANIMATION_ACTIONS,
  UNIT_ANIMATION_SPECS,
  UNIT_CARRY_ITEMS,
  getRaceActionSpec,
  getUnitActionSpec,
  normalizeActionFrameIndex,
  type UnitAnimationAction,
  type UnitAnimationSpec,
  type UnitCarryItem,
};

/**
 * ============================================================================
 * STAGE 1: LAYERED PAPER-DOLL PROCEDURAL GENERATOR (MEDIEVAL HUMANS, 10×10)
 * ============================================================================
 * Fixed strict 9-layer assembly order on a shared 10×10 pixel canvas:
 *   1. body       (base silhouette by gender & age + 1px walk stride)
 *   2. skin       (zone-tagged 4-tone skin ramp)
 *   3. faceEyes   (clean micro-face, brow & 1px eyes using existing dark stops)
 *   4. hairBeard  (12 hair 4-tone ramps incl. elder grey + beard variants)
 *   5. clothing   (tunic/dress/cloak/steed caparison with K1/K2 zone masks)
 *   6. armor      (cuirass, pauldrons, shield, horse barding)
 *   7. headgear   (hood, cap, helm, mitre, hat, circlet, crown, tiara)
 *   8. weaponTool (pitchfork, hammer, sword, bow, lance, staff, scepter, orb)
 *   9. statusSign (alliance crest, wounded, sick, zombie, possessed, captive)
 *
 * Style & Quality Invariants:
 * - Zero #131110 black exterior outline; top-left (-1, -1) lighting
 * - 100% opaque pixels inside sprite (zero semi-transparent smudges)
 * - Strictly <= 8 unique colors per assembled 10×10 frame
 * - Zero isolated 1px orphan noise specks
 * - Deterministic PRNG from `seed`: same seed -> pixel-identical output
 * ============================================================================
 */

export const PROCEDURAL_CANVAS_W = 10;
export const PROCEDURAL_CANVAS_H = 10;

export const PAPER_DOLL_LAYERS = [
  'body',
  'skin',
  'faceEyes',
  'hairBeard',
  'clothing',
  'armor',
  'headgear',
  'weaponTool',
  'statusSign',
] as const;

export type PaperDollLayer = (typeof PAPER_DOLL_LAYERS)[number];

export type UnitGender = 'male' | 'female';
export type UnitAge = 'child' | 'adult' | 'elder';
export type UnitEra =
  | 'primordial'
  | 'dinosaurs'
  | 'ice-age'
  | 'stone-age'
  | 'bronze-iron'
  | 'medieval';

export type ActiveUnitRace =
  | 'human'
  | 'marshfolk'
  | 'stonekin'
  | 'antlerfolk'
  | 'ash-nomads'
  | 'undead'
  | 'demon'
  | 'neanderthal'
  | 'raptor-kin'
  | 'hive-mind';

/**
 * @deprecated Скрытый резерв шаблонных рас (оставлен для обратной совместимости
 * и не участвует в активной генерации `ACTIVE_UNIT_RACES`).
 */
export type LegacyUnitRace = 'elf' | 'orc' | 'dwarf';
export const LEGACY_RESERVE_RACES: readonly LegacyUnitRace[] = ['elf', 'orc', 'dwarf'];
export type UnitRace = ActiveUnitRace | LegacyUnitRace;

export type MedievalHumanRole =
  | 'peasant'
  | 'worker'
  | 'warrior'
  | 'archer'
  | 'cavalry'
  | 'cleric'
  | 'merchant'
  | 'settlement-leader'
  | 'heir'
  | 'king'
  | 'queen';

export type PowerHierarchyRank =
  | 'none'
  | 'village-leader'
  | 'city-lord'
  | 'king'
  | 'alliance-leader';

export type UnitStatus =
  | 'healthy'
  | 'wounded'
  | 'sick'
  | 'zombie'
  | 'possessed'
  | 'captive';

export type ZoneTag =
  | 'skin'
  | 'hair'
  | 'k1'
  | 'k2'
  | 'metal'
  | 'gold'
  | 'wood'
  | 'cloth'
  | 'status';

export interface ProceduralHumanParams {
  readonly seed: number;
  readonly era?: UnitEra | 'auto';
  readonly race?: UnitRace | 'auto';
  readonly gender?: UnitGender | 'auto';
  readonly age?: UnitAge | 'auto';
  readonly role?: MedievalHumanRole | 'auto';
  readonly powerRank?: PowerHierarchyRank | 'auto';
  readonly status?: UnitStatus | 'auto';
  readonly kingdomId?: number | 'auto';
  readonly alliedKingdomId?: number | 'auto';
  readonly skinId?: number | 'auto';
  readonly hairId?: number | 'auto';
  readonly frameIndex?: number;
  readonly action?: UnitAnimationAction;
  readonly carry?: UnitCarryItem;
}

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface ProceduralAnchors {
  readonly pivot: Point2D;
  readonly head: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly face: Point2D;
  readonly belt: { readonly x: number; readonly y: number; readonly w: number };
  readonly hand: {
    readonly leftX: number;
    readonly leftY: number;
    readonly rightX: number;
    readonly rightY: number;
  };
  readonly feetY: number;
}

export interface ResolvedHumanProfile {
  readonly seed: number;
  readonly era: UnitEra;
  readonly race: UnitRace;
  readonly gender: UnitGender;
  readonly age: UnitAge;
  readonly role: MedievalHumanRole;
  readonly powerRank: PowerHierarchyRank;
  readonly status: UnitStatus;
  readonly kingdom: KingdomPaletteDef;
  readonly alliedKingdom: KingdomPaletteDef | null;
  readonly skin: SkinPaletteDef;
  readonly hair: HairPaletteDef;
  readonly hairStyle: number;
  readonly hasBeard: boolean;
  readonly frameIndex: number;
  readonly action: UnitAnimationAction;
  readonly carry: UnitCarryItem;
  readonly anchors: ProceduralAnchors;
}

export interface ProceduralSpriteAudit {
  readonly opaquePixels: number;
  readonly uniqueColors: number;
  readonly semitransparentPixels: number;
  readonly inkPixels: number;
  readonly orphanPixels: number;
  readonly k1ZonePixels: number;
  readonly k2ZonePixels: number;
  readonly skinZonePixels: number;
  readonly hairZonePixels: number;
  readonly boundingBox: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface GeneratedHumanResult {
  readonly buffer: PixelBuffer;
  readonly zoneMap: readonly (ZoneTag | null)[];
  readonly profile: ResolvedHumanProfile;
  readonly layerTrace: readonly PaperDollLayer[];
  readonly audit: ProceduralSpriteAudit;
}

export const ACTIVE_UNIT_ERAS: readonly UnitEra[] = [
  'primordial',
  'dinosaurs',
  'ice-age',
  'stone-age',
  'bronze-iron',
  'medieval',
];

export const ACTIVE_UNIT_RACES: readonly ActiveUnitRace[] = [
  'human',
  'marshfolk',
  'stonekin',
  'antlerfolk',
  'ash-nomads',
  'undead',
  'demon',
  'neanderthal',
  'raptor-kin',
  'hive-mind',
];

export const CORE_ORIGINAL_RACES: readonly ActiveUnitRace[] = [
  'human',
  'marshfolk',
  'stonekin',
  'antlerfolk',
  'ash-nomads',
  'undead',
  'demon',
];

export const UNIT_ERA_LABELS: Readonly<Record<UnitEra, string>> = {
  primordial: 'Первобытная жизнь',
  dinosaurs: 'Эра динозавров',
  'ice-age': 'Ледниковый период',
  'stone-age': 'Каменный век',
  'bronze-iron': 'Бронза и железо',
  medieval: 'Средневековье',
};

export const UNIT_RACE_LABELS: Readonly<Record<ActiveUnitRace, string>> = {
  human: 'Человек',
  marshfolk: 'Болотный народ',
  stonekin: 'Каменнокожие',
  antlerfolk: 'Лесной рогатый',
  'ash-nomads': 'Пепельные кочевники',
  undead: 'Нежить',
  demon: 'Демоны',
  neanderthal: 'Неандертальцы и Денисовцы',
  'raptor-kin': 'Ящеры-рапторы',
  'hive-mind': 'Улей-Разум',
};

export const ALL_UNIT_RACE_LABELS: Readonly<Record<UnitRace, string>> = {
  ...UNIT_RACE_LABELS,
  elf: 'Эльф (резерв)',
  orc: 'Орк (резерв)',
  dwarf: 'Дворф (резерв)',
};

export const MEDIEVAL_ROLE_LABELS: Readonly<Record<MedievalHumanRole, string>> = {
  peasant: 'Крестьянин',
  worker: 'Рабочий',
  warrior: 'Воин',
  archer: 'Лучник',
  cavalry: 'Всадник',
  cleric: 'Жрец / Монах',
  merchant: 'Торговец',
  'settlement-leader': 'Лидер поселения',
  heir: 'Наследник / Лорд',
  king: 'Король',
  queen: 'Королева',
};

export const POWER_RANK_LABELS: Readonly<Record<PowerHierarchyRank, string>> = {
  none: 'Житель / Воин',
  'village-leader': 'Глава деревни',
  'city-lord': 'Лорд города',
  king: 'Король / Королева',
  'alliance-leader': 'Лидер Альянса',
};

export const UNIT_STATUS_LABELS: Readonly<Record<UnitStatus, string>> = {
  healthy: 'Здоров',
  wounded: 'Ранен',
  sick: 'Болен',
  zombie: 'Зомби',
  possessed: 'Одержим',
  captive: 'Пленник',
};

// ----------------------------------------------------------------------------
// DETERMINISTIC PRNG (MULBERRY32)
// ----------------------------------------------------------------------------

function createSeededRng(seed: number): () => number {
  let state = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ANCHORS_CHILD: ProceduralAnchors = {
  pivot: { x: 4, y: 9 },
  head: { x: 3, y: 3, w: 4, h: 3 },
  face: { x: 4, y: 4 },
  belt: { x: 4, y: 7, w: 2 },
  hand: { leftX: 2, leftY: 6, rightX: 7, rightY: 6 },
  feetY: 9,
};

const ANCHORS_CAVALRY: ProceduralAnchors = {
  pivot: { x: 4, y: 9 },
  head: { x: 4, y: 1, w: 3, h: 3 },
  face: { x: 4, y: 2 },
  belt: { x: 4, y: 5, w: 3 },
  hand: { leftX: 3, leftY: 4, rightX: 7, rightY: 4 },
  feetY: 9,
};

const ANCHORS_ADULT: ProceduralAnchors = {
  pivot: { x: 4, y: 9 },
  head: { x: 3, y: 1, w: 4, h: 3 },
  face: { x: 4, y: 2 },
  belt: { x: 3, y: 6, w: 4 },
  hand: { leftX: 2, leftY: 5, rightX: 7, rightY: 5 },
  feetY: 9,
};

export function getAnchorsForAge(age: UnitAge, isCavalry: boolean): ProceduralAnchors {
  if (age === 'child') return ANCHORS_CHILD;
  if (isCavalry) return ANCHORS_CAVALRY;
  return ANCHORS_ADULT;
}

function computeWalkBounceDy(
  race: UnitRace,
  role: MedievalHumanRole,
  age: UnitAge,
  powerRank: PowerHierarchyRank,
  frameIndex: number
): number {
  const hasTallTopGear =
    race === 'antlerfolk' ||
    race === 'stonekin' ||
    race === 'hive-mind' ||
    race === 'demon' ||
    race === 'undead' ||
    race === 'raptor-kin' ||
    race === 'neanderthal' ||
    role === 'king' ||
    role === 'queen' ||
    role === 'cavalry' ||
    role === 'cleric' ||
    role === 'merchant' ||
    role === 'settlement-leader' ||
    role === 'heir' ||
    powerRank !== 'none';
  return age === 'child' || hasTallTopGear ? 0 : frameIndex === 1 ? -1 : 0;
}

const WEIGHTED_RANDOM_ROLES: readonly MedievalHumanRole[] = [
  'peasant',
  'peasant',
  'peasant',
  'worker',
  'worker',
  'warrior',
  'warrior',
  'archer',
  'cavalry',
  'cleric',
  'merchant',
  'settlement-leader',
  'heir',
  'king',
  'queen',
];

export function resolveHumanProfile(params: ProceduralHumanParams): ResolvedHumanProfile {
  const rng = createSeededRng(params.seed);

  const rGender = rng();
  const rAge = rng();
  const rRole = rng();
  const rKingdom = rng();
  const rAllied = rng();
  const rSkin = rng();
  const rHair = rng();
  const rStyle = rng();
  const rBeard = rng();
  const rStatus = rng();

  const era: UnitEra =
    params.era === 'auto'
      ? ACTIVE_UNIT_ERAS[Math.floor(rng() * ACTIVE_UNIT_ERAS.length)]
      : (params.era ?? 'medieval');

  let race: UnitRace;
  if (params.race && params.race !== 'auto') {
    race = params.race;
  } else if (params.race === 'auto') {
    if (era === 'primordial') {
      race = 'hive-mind';
    } else if (era === 'dinosaurs') {
      race = 'raptor-kin';
    } else if (era === 'ice-age') {
      race = 'neanderthal';
    } else {
      race = CORE_ORIGINAL_RACES[Math.floor(rng() * CORE_ORIGINAL_RACES.length)];
    }
  } else {
    race = 'human';
  }

  const role: MedievalHumanRole =
    params.role && params.role !== 'auto'
      ? params.role
      : WEIGHTED_RANDOM_ROLES[Math.floor(rRole * WEIGHTED_RANDOM_ROLES.length)];

  let gender: UnitGender;
  if (params.gender && params.gender !== 'auto') {
    gender = params.gender;
  } else if (race !== 'hive-mind' && role === 'king') {
    gender = 'male';
  } else if (race !== 'hive-mind' && role === 'queen') {
    gender = 'female';
  } else {
    gender = rGender < 0.5 ? 'male' : 'female';
  }

  let age: UnitAge;
  if (params.age && params.age !== 'auto') {
    age = params.age;
  } else {
    age = rAge < 0.16 ? 'child' : rAge < 0.82 ? 'adult' : 'elder';
  }

  let powerRank: PowerHierarchyRank;
  if (params.powerRank && params.powerRank !== 'auto') {
    powerRank = params.powerRank;
  } else if (race !== 'hive-mind' && (role === 'king' || role === 'queen')) {
    powerRank = 'king';
  } else if (race !== 'hive-mind' && role === 'heir') {
    powerRank = 'city-lord';
  } else if (race !== 'hive-mind' && role === 'settlement-leader') {
    powerRank = 'village-leader';
  } else {
    powerRank = 'none';
  }

  const status: UnitStatus =
    params.status && params.status !== 'auto'
      ? params.status
      : rStatus < 0.82
        ? 'healthy'
        : rStatus < 0.88
          ? 'wounded'
          : rStatus < 0.92
            ? 'sick'
            : rStatus < 0.95
              ? 'captive'
              : rStatus < 0.98
                ? 'possessed'
                : 'zombie';

  const kIdx =
    params.kingdomId !== undefined && params.kingdomId !== 'auto'
      ? ((params.kingdomId % KINGDOM_PALETTES_84.length) + KINGDOM_PALETTES_84.length) %
        KINGDOM_PALETTES_84.length
      : Math.floor(rKingdom * KINGDOM_PALETTES_84.length);
  const kingdom = KINGDOM_PALETTES_84[kIdx];

  const alliedKingdom =
    powerRank === 'alliance-leader'
      ? KINGDOM_PALETTES_84[
          params.alliedKingdomId !== undefined && params.alliedKingdomId !== 'auto'
            ? ((params.alliedKingdomId % KINGDOM_PALETTES_84.length) + KINGDOM_PALETTES_84.length) %
              KINGDOM_PALETTES_84.length
            : (kIdx + 1 + Math.floor(rAllied * 17)) % KINGDOM_PALETTES_84.length
        ]
      : null;

  // Natural humans pick from 0..10; non-human races bias to lore skin palettes when auto
  let skinIdx: number;
  if (params.skinId !== undefined && params.skinId !== 'auto') {
    skinIdx =
      ((params.skinId % SKIN_PALETTES_14.length) + SKIN_PALETTES_14.length) %
      SKIN_PALETTES_14.length;
  } else if (race === 'orc') {
    skinIdx = 11;
  } else if (race === 'elf') {
    skinIdx = rSkin < 0.7 ? Math.floor(rSkin * 3) : 12;
  } else if (race === 'undead') {
    skinIdx = Math.floor(rSkin * 4);
  } else if (race === 'dwarf') {
    skinIdx = 1 + Math.floor(rSkin * 4);
  } else {
    skinIdx = Math.floor(rSkin * 11);
  }
  const skin = SKIN_PALETTES_14[skinIdx];

  // Elders bias strongly to grey/silver hair; dwarves always favor thick beards
  let hairIdx: number;
  if (params.hairId !== undefined && params.hairId !== 'auto') {
    hairIdx =
      ((params.hairId % HAIR_PALETTES_12.length) + HAIR_PALETTES_12.length) %
      HAIR_PALETTES_12.length;
  } else if (age === 'elder' || race === 'undead') {
    hairIdx = rHair < 0.55 ? 11 : 10;
  } else if (race === 'elf') {
    hairIdx = rHair < 0.5 ? 7 : rHair < 0.8 ? 11 : 0;
  } else if (race === 'dwarf') {
    hairIdx = rHair < 0.45 ? 5 : Math.floor(rHair * 6);
  } else {
    hairIdx = Math.floor(rHair * 10);
  }
  const hair = HAIR_PALETTES_12[hairIdx];

  const hairStyle = Math.floor(rStyle * 4);
  const hasBeard =
    gender === 'male' &&
    age !== 'child' &&
    race !== 'elf' &&
    race !== 'undead' &&
    (race === 'dwarf' ? true : age === 'elder' ? rBeard < 0.72 : rBeard < 0.35);

  const action: UnitAnimationAction = params.action ?? 'walk';
  const carry: UnitCarryItem = params.carry ?? 'none';
  const frameIndex = normalizeActionFrameIndex(action, params.frameIndex ?? 0);
  const isCavalry = role === 'cavalry' && age !== 'child' && !isCustomSilhouetteRace(race);
  const walkDy = computeWalkBounceDy(race, role, age, powerRank, frameIndex);
  const anchors = !isCustomSilhouetteRace(race)
    ? computeWalkAnchors(age, role, gender, frameIndex, walkDy, carry)
    : getAnchorsForAge(age, isCavalry);

  return {
    seed: params.seed,
    era,
    race,
    gender,
    age,
    role,
    powerRank,
    status,
    kingdom,
    alliedKingdom,
    skin,
    hair,
    hairStyle,
    hasBeard,
    frameIndex,
    action,
    carry,
    anchors,
  };
}

// ----------------------------------------------------------------------------
// LAYERED RASTERIZER & ZONE-AWARE PIXEL CANVAS
// ----------------------------------------------------------------------------

export interface LayeredGrid {
  readonly buf: PixelBuffer;
  readonly raw: (string | null)[];
  readonly zones: (ZoneTag | null)[];
  set(x: number, y: number, color: string, zone: ZoneTag): void;
  get(x: number, y: number): string | null;
  getZone(x: number, y: number): ZoneTag | null;
  flush(): void;
}

function createLayeredGrid(trackZones = true): LayeredGrid {
  const raw = new Array<string | null>(100).fill(null);
  const buf = new PixelBuffer(PROCEDURAL_CANVAS_W, PROCEDURAL_CANVAS_H, raw);
  const zones = trackZones ? new Array<ZoneTag | null>(100).fill(null) : [];
  return {
    buf,
    raw,
    zones,
    set(x: number, y: number, color: string, zone: ZoneTag) {
      if (x < 0 || y < 0 || x >= 10 || y >= 10) return;
      const idx = y * 10 + x;
      raw[idx] = color;
      if (trackZones) zones[idx] = zone;
    },
    get(x: number, y: number) {
      if (x < 0 || y < 0 || x >= 10 || y >= 10) return null;
      return raw[y * 10 + x];
    },
    getZone(x: number, y: number) {
      if (!trackZones || x < 0 || y < 0 || x >= 10 || y >= 10) return null;
      return zones[y * 10 + x];
    },
    flush() {
      // `buf` directly shares `raw`, so no copy pass is required.
    },
  };
}

// Fixed compact material pairs (2 stops each to preserve <= 8 colors per frame!)
const MAT = {
  linenLight: '#E5DEC7',
  linenShadow: '#ACA38B',
  leatherMid: '#B2723E',
  leatherDark: '#6D4221',
  steelLight: '#CCD6E2',
  steelShadow: '#6D798C',
  bronzeLight: '#D89C4E',
  bronzeDark: '#8A561E',
  boneLight: '#DFD4B7',
  boneDark: '#8C8168',
  goldLight: '#F7C93B',
  goldShadow: '#B87A14',
  darkCloth: '#3F424D',
  statusWound: '#DC2626',
  statusSick: '#94C93B',
  statusZombieLight: '#689F48',
  statusZombieDark: '#3D632A',
  statusPossessed: '#B86BFF',
  statusShackle: '#8590A2',
  cyanEye: '#6CC0E5',
} as const;

function getEffectiveSkinRamp(profile: ResolvedHumanProfile): FourToneRamp {
  if (profile.status === 'zombie') {
    return ['#8BB865', MAT.statusZombieLight, MAT.statusZombieDark, '#27421B'];
  }
  const customRamp = getCustomRaceSkinRamp(profile);
  if (customRamp) return customRamp;
  if (profile.race === 'undead') {
    return [MAT.boneLight, '#C4B99B', MAT.boneDark, '#4D4638'];
  }
  if (profile.race === 'demon') {
    return ['#F07167', '#CF3B36', '#8F2323', '#521419'];
  }
  if (profile.status === 'sick') {
    // Pale greenish-tinted skin preserving undertone
    return ['#C9D8A2', '#A6BA7C', '#7B8F58', '#52613A'];
  }
  return profile.skin.ramp;
}

function getEffectiveK2MidAndShadow(profile: ResolvedHumanProfile): readonly [string, string] {
  const k2Source = profile.alliedKingdom ? profile.alliedKingdom.k1Ramp : profile.kingdom.k2Ramp;
  return [k2Source[1], k2Source[2]];
}

function getMetalPair(era: UnitEra): readonly [string, string] {
  if (era === 'bronze-iron') return [MAT.bronzeLight, MAT.bronzeDark];
  if (era === 'stone-age' || era === 'ice-age' || era === 'dinosaurs' || era === 'primordial') {
    return [MAT.boneLight, MAT.boneDark];
  }
  return [MAT.steelLight, MAT.steelShadow];
}

// 1. LAYER 1: BODY
function applyBodyLayer(g: LayeredGrid, p: ResolvedHumanProfile, dy: number): void {
  const skin = getEffectiveSkinRamp(p);
  const clothDark = MAT.darkCloth;

  if (p.age === 'child') {
    // Compact 6-7px tall child silhouette (y = 3..9, top rows 0..2 always empty!)
    // Head base placeholder (y=4..5)
    g.set(4, 4, skin[1], 'skin');
    g.set(5, 4, skin[1], 'skin');
    g.set(4, 5, skin[1], 'skin');
    g.set(5, 5, skin[2], 'skin');
    // Torso (y=6..7)
    g.set(4, 6, clothDark, 'cloth');
    g.set(5, 6, clothDark, 'cloth');
    g.set(4, 7, clothDark, 'cloth');
    g.set(5, 7, clothDark, 'cloth');
    // Arms (y=6)
    g.set(3, 6, skin[1], 'skin');
    g.set(6, 6, skin[2], 'skin');
    // Short legs/feet (y=8..9)
    const stride = p.frameIndex === 1 ? -1 : 0;
    g.set(4, 8 + stride, clothDark, 'cloth');
    g.set(5, 8, clothDark, 'cloth');
    g.set(4, 9, MAT.leatherDark, 'wood');
    g.set(5, 9, MAT.leatherDark, 'wood');
    return;
  }

  if (p.role === 'cavalry') {
    // Mounted horse + rider body silhouette
    // Horse body & neck (y=5..7)
    const horseMid = MAT.leatherMid;
    const horseDark = MAT.leatherDark;
    for (let x = 3; x <= 7; x++) {
      g.set(x, 6, horseMid, 'wood');
      g.set(x, 7, horseDark, 'wood');
    }
    // Horse neck & head on left (x=1..2, y=4..6)
    g.set(2, 4, horseMid, 'wood');
    g.set(2, 5, horseMid, 'wood');
    g.set(1, 5, horseMid, 'wood');
    g.set(1, 6, horseDark, 'wood');
    // Horse tail on right (x=8, y=6..7)
    g.set(8, 6, horseDark, 'wood');
    g.set(8, 7, horseDark, 'wood');
    // 4 horse legs (animated stride)
    const f = p.frameIndex;
    g.set(3, f === 1 ? 8 : 8, horseDark, 'wood');
    g.set(3, 9, horseDark, 'wood');
    g.set(4, 8, horseDark, 'wood');
    g.set(6, 8, horseDark, 'wood');
    g.set(7, f === 3 ? 8 : 8, horseDark, 'wood');
    g.set(7, 9, horseDark, 'wood');
    // Rider head & torso (x=4..6, y=1..5)
    g.set(4, 2 + dy, skin[1], 'skin');
    g.set(5, 2 + dy, skin[1], 'skin');
    g.set(4, 3 + dy, skin[1], 'skin');
    g.set(5, 3 + dy, skin[2], 'skin');
    g.set(4, 4 + dy, clothDark, 'cloth');
    g.set(5, 4 + dy, clothDark, 'cloth');
    g.set(4, 5 + dy, clothDark, 'cloth');
    g.set(5, 5 + dy, clothDark, 'cloth');
    return;
  }

  // Standard Adult / Elder body (head y=1..3, torso y=4..7, legs y=8..9)
  const headY = 1 + dy;
  // Cranium base
  for (let x = 3; x <= 6; x++) {
    g.set(x, headY + 1, skin[1], 'skin');
  }
  g.set(4, headY + 2, skin[1], 'skin');
  g.set(5, headY + 2, skin[2], 'skin');

  // Shoulders & torso (y=4..7)
  const torsoY = 4 + dy;
  const xMin = p.gender === 'female' ? 4 : 3;
  const xMax = p.gender === 'female' ? 5 : 6;
  for (let y = torsoY; y <= torsoY + 3; y++) {
    for (let x = xMin; x <= xMax; x++) {
      g.set(x, y, clothDark, 'cloth');
    }
  }
  // Arms at left/right
  const armLeftX = p.gender === 'female' ? 3 : 2;
  const armRightX = p.gender === 'female' ? 6 : 7;
  const armBobL = p.frameIndex === 1 ? -1 : p.frameIndex === 3 ? 1 : 0;
  const armBobR = -armBobL;
  g.set(armLeftX, torsoY + armBobL, clothDark, 'cloth');
  g.set(armLeftX, torsoY + 1 + armBobL, skin[1], 'skin');
  g.set(armRightX, torsoY + armBobR, clothDark, 'cloth');
  g.set(armRightX, torsoY + 1 + armBobR, skin[2], 'skin');

  // Legs & boots (y=7..9 — always anchored at y=7 so legs never detach on dy=-1 bounce)
  const leftLegY = p.frameIndex === 1 ? 8 : 9;
  const rightLegY = p.frameIndex === 3 ? 8 : 9;
  if (p.gender === 'female') {
    g.set(4, 7, clothDark, 'cloth');
    g.set(5, 7, clothDark, 'cloth');
    g.set(4, 8, clothDark, 'cloth');
    g.set(5, 8, clothDark, 'cloth');
    g.set(4, leftLegY, MAT.leatherDark, 'wood');
    g.set(5, rightLegY, MAT.leatherDark, 'wood');
  } else {
    g.set(3, 7, clothDark, 'cloth');
    g.set(6, 7, clothDark, 'cloth');
    g.set(3, 8, clothDark, 'cloth');
    g.set(6, 8, clothDark, 'cloth');
    g.set(3, leftLegY, MAT.leatherDark, 'wood');
    g.set(6, rightLegY, MAT.leatherDark, 'wood');
  }
}

// 2. LAYER 2: SKIN (explicit top-left light shading on exposed face, hands & elf ears)
function applySkinLayer(g: LayeredGrid, p: ResolvedHumanProfile, dy: number): void {
  const skin = getEffectiveSkinRamp(p);
  if (p.age === 'child') {
    g.set(3, 4, skin[0], 'skin');
    g.set(4, 4, skin[0], 'skin');
    g.set(5, 4, skin[1], 'skin');
    g.set(6, 4, skin[2], 'skin');
    g.set(4, 5, skin[1], 'skin');
    g.set(5, 5, skin[2], 'skin');
    g.set(3, 6, skin[0], 'skin');
    g.set(6, 6, skin[2], 'skin');
    if (p.race === 'elf') {
      g.set(2, 4, skin[0], 'skin');
      g.set(7, 4, skin[1], 'skin');
    }
    return;
  }

  if (p.role === 'cavalry') {
    g.set(4, 2 + dy, skin[0], 'skin');
    g.set(5, 2 + dy, skin[1], 'skin');
    g.set(4, 3 + dy, skin[1], 'skin');
    g.set(5, 3 + dy, skin[2], 'skin');
    g.set(6, 4 + dy, skin[1], 'skin');
    if (p.race === 'elf') {
      g.set(3, 2 + dy, skin[0], 'skin');
      g.set(6, 2 + dy, skin[1], 'skin');
    }
    return;
  }

  const hy = 2 + dy;
  // Top-left forehead highlight, mid right, shaded jaw
  g.set(3, hy, skin[0], 'skin');
  g.set(4, hy, skin[0], 'skin');
  g.set(5, hy, skin[1], 'skin');
  g.set(6, hy, skin[2], 'skin');
  g.set(3, hy + 1, skin[1], 'skin');
  g.set(4, hy + 1, skin[1], 'skin');
  g.set(5, hy + 1, skin[1], 'skin');
  g.set(6, hy + 1, skin[2], 'skin');

  // Race cranium/silhouette accents
  if (p.race === 'elf') {
    // Pointed outward ears
    g.set(2, hy, skin[0], 'skin');
    g.set(7, hy, skin[1], 'skin');
  } else if (p.race === 'orc') {
    // Broad muscular arms & heavy jaw
    g.set(2, 4 + dy, skin[1], 'skin');
    g.set(7, 4 + dy, skin[2], 'skin');
  } else if (p.race === 'dwarf') {
    // Broad stocky cheeks & stout arms
    g.set(2, hy + 1, skin[1], 'skin');
    g.set(7, hy + 1, skin[2], 'skin');
  }
}

// 3. LAYER 3: FACE & EYES (crisp 1px eyes using skin[3] / race eyes — zero black INK)
function applyFaceEyesLayer(g: LayeredGrid, p: ResolvedHumanProfile, dy: number): void {
  const skin = getEffectiveSkinRamp(p);
  const eyeColor =
    p.status === 'zombie'
      ? MAT.statusSick
      : p.status === 'possessed'
        ? MAT.statusPossessed
        : p.race === 'undead'
          ? MAT.cyanEye
          : p.race === 'demon'
            ? MAT.goldLight
            : skin[3];

  if (p.age === 'child') {
    g.set(4, 4, eyeColor, 'skin');
    g.set(5, 4, skin[0], 'skin');
    g.set(6, 4, eyeColor, 'skin');
    if (p.race === 'orc') {
      g.set(4, 5, MAT.boneLight, 'gold');
    }
    return;
  }

  if (p.role === 'cavalry') {
    g.set(4, 2 + dy, eyeColor, 'skin');
    g.set(5, 2 + dy, skin[0], 'skin');
    if (p.race === 'orc') g.set(4, 3 + dy, MAT.boneLight, 'gold');
    return;
  }

  const eyeY = 2 + dy;
  g.set(4, eyeY, eyeColor, 'skin');
  g.set(5, eyeY, skin[0], 'skin');
  g.set(6, eyeY, eyeColor, 'skin');

  if (p.race === 'orc') {
    // Prominent upward ivory tusks on lower jaw
    g.set(3, eyeY + 1, MAT.boneLight, 'gold');
    g.set(6, eyeY + 1, MAT.boneLight, 'gold');
  } else if (p.race === 'undead') {
    // Skeletal teeth ridge
    g.set(4, eyeY + 1, MAT.boneLight, 'skin');
    g.set(5, eyeY + 1, skin[3], 'skin');
  }
}

// 4. LAYER 4: HAIR & BEARD (12 4-tone hair ramps, incl. grey/silver for elders)
function applyHairBeardLayer(g: LayeredGrid, p: ResolvedHumanProfile, dy: number): void {
  if (p.race === 'undead') {
    // Undead skull shows bare bone cranium with only a tiny ragged crown tuft on style 1
    if (p.age !== 'child' && p.hairStyle === 1) {
      g.set(5, 1 + dy, p.hair.ramp[2], 'hair');
    }
    return;
  }

  const h = p.hair.ramp;
  const hLight = h[1];
  const hDark = h[2];

  if (p.age === 'child') {
    if (p.hairStyle !== 3) {
      g.set(4, 3, hLight, 'hair');
      g.set(5, 3, hDark, 'hair');
      if (p.gender === 'female') {
        g.set(3, 4, hLight, 'hair');
        g.set(3, 5, hDark, 'hair');
      }
    }
    return;
  }

  if (p.role === 'cavalry') {
    g.set(4, 1 + dy, hLight, 'hair');
    g.set(5, 1 + dy, hDark, 'hair');
    return;
  }

  const topY = 1 + dy;
  if (p.gender === 'female') {
    // Long flowing hair framing left/right sides + crown
    g.set(3, topY, hLight, 'hair');
    g.set(4, topY, hLight, 'hair');
    g.set(5, topY, hDark, 'hair');
    g.set(6, topY, hDark, 'hair');
    g.set(3, topY + 1, hLight, 'hair');
    g.set(3, topY + 2, hDark, 'hair');
    if (p.hairStyle % 2 === 0) {
      g.set(2, topY + 2, hLight, 'hair');
      g.set(2, topY + 3, hDark, 'hair');
    } else {
      g.set(6, topY + 2, hDark, 'hair');
      g.set(6, topY + 3, hDark, 'hair');
    }
    return;
  }

  // Male hair styles
  if (p.hairStyle === 0 || p.hairStyle === 1) {
    g.set(3, topY, hLight, 'hair');
    g.set(4, topY, hLight, 'hair');
    g.set(5, topY, hDark, 'hair');
    g.set(6, topY, hDark, 'hair');
    g.set(3, topY + 1, hDark, 'hair');
  } else if (p.hairStyle === 2) {
    // Side-parted hair with top highlight
    g.set(4, topY, hLight, 'hair');
    g.set(5, topY, hDark, 'hair');
    g.set(3, topY + 1, hLight, 'hair');
  } else {
    // Short cropped / bald monk tonsure look (on crown row, preserving face/eyes below)
    g.set(3, topY, hDark, 'hair');
    g.set(6, topY, hDark, 'hair');
  }

  // Beard for elder / male / dwarf / king / cleric / settlement-leader variants
  if (p.hasBeard) {
    g.set(4, topY + 2, hLight, 'hair');
    g.set(5, topY + 2, hDark, 'hair');
    g.set(6, topY + 2, hDark, 'hair');
    if (p.race === 'dwarf' || p.age === 'elder' || p.role === 'king' || p.role === 'cleric') {
      g.set(4, topY + 3, hDark, 'hair');
      g.set(5, topY + 3, hDark, 'hair');
      if (p.race === 'dwarf') {
        g.set(4, topY + 4, hLight, 'hair');
        g.set(5, topY + 4, hDark, 'hair');
      }
    }
  }
}

// 5. LAYER 5: CLOTHING (Kingdom zone-masked K1 & K2 garments across all 3 eras)
function applyClothingLayer(g: LayeredGrid, p: ResolvedHumanProfile, dy: number): void {
  const k1 = p.kingdom.k1Ramp;
  const k1Light = k1[1];
  const k1Dark = k1[2];
  const [k2Light, k2Dark] = getEffectiveK2MidAndShadow(p);

  if (p.age === 'child') {
    g.set(4, 6, k1Light, 'k1');
    g.set(5, 6, k1Dark, 'k1');
    g.set(4, 7, k2Light, 'k2');
    g.set(5, 7, k1Dark, 'k1');
    if (p.gender === 'female') {
      g.set(3, 7, k1Light, 'k1');
      g.set(6, 7, k1Dark, 'k1');
    }
    return;
  }

  if (p.role === 'cavalry') {
    g.set(4, 4 + dy, k1Light, 'k1');
    g.set(5, 4 + dy, k1Dark, 'k1');
    g.set(3, 6, k1Light, 'k1');
    g.set(4, 6, k1Light, 'k1');
    g.set(5, 6, k1Dark, 'k1');
    g.set(6, 6, k2Light, 'k2');
    g.set(4, 7, k2Dark, 'k2');
    g.set(5, 7, k1Dark, 'k1');
    return;
  }

  const ty = 4 + dy;

  // Stone Age fur hides & K1/K2 tribal sashes for non-medieval era
  if (p.era === 'stone-age') {
    g.set(3, ty, MAT.leatherMid, 'wood');
    g.set(4, ty, k1Light, 'k1');
    g.set(5, ty, MAT.leatherDark, 'wood');
    g.set(6, ty, MAT.leatherDark, 'wood');
    g.set(3, ty + 1, k1Light, 'k1');
    g.set(4, ty + 1, k1Light, 'k1');
    g.set(5, ty + 1, k2Light, 'k2');
    g.set(6, ty + 1, MAT.leatherDark, 'wood');
    g.set(4, ty + 2, MAT.leatherMid, 'wood');
    g.set(5, ty + 2, k1Dark, 'k1');
    if (p.role === 'king' || p.role === 'queen' || p.powerRank === 'king' || p.powerRank === 'alliance-leader') {
      g.set(2, ty, MAT.boneLight, 'gold');
      g.set(7, ty, MAT.boneLight, 'gold');
      g.set(2, ty + 1, k1Light, 'k1');
      g.set(7, ty + 1, k1Dark, 'k1');
      g.set(3, ty + 2, k2Light, 'k2');
      g.set(6, ty + 2, k2Dark, 'k2');
    } else if (p.gender === 'female') {
      g.set(3, ty + 2, k1Light, 'k1');
      g.set(6, ty + 2, k1Dark, 'k1');
    }
    return;
  }

  // Bronze & Iron chitons / togas + K1/K2 bronze-age wraps for non-special roles
  if (p.era === 'bronze-iron' && p.role !== 'king' && p.role !== 'queen' && p.powerRank !== 'king' && p.powerRank !== 'alliance-leader') {
    g.set(3, ty, MAT.linenLight, 'cloth');
    g.set(4, ty, k1Light, 'k1');
    g.set(5, ty, k1Dark, 'k1');
    g.set(6, ty, MAT.linenShadow, 'cloth');
    g.set(3, ty + 1, k1Light, 'k1');
    g.set(4, ty + 1, k2Light, 'k2');
    g.set(5, ty + 1, k1Dark, 'k1');
    g.set(6, ty + 1, k1Dark, 'k1');
    g.set(3, ty + 2, MAT.linenLight, 'cloth');
    g.set(4, ty + 2, k1Light, 'k1');
    g.set(5, ty + 2, k1Dark, 'k1');
    g.set(6, ty + 2, MAT.linenShadow, 'cloth');
    return;
  }

  // Medieval & royal/tier-3 role clothing silhouettes (Stage 1 preserved!)
  if (p.role === 'peasant') {
    // Simple linen + K1 vest tunic
    g.set(3, ty, MAT.linenLight, 'cloth');
    g.set(4, ty, k1Light, 'k1');
    g.set(5, ty, k1Dark, 'k1');
    g.set(6, ty, MAT.linenShadow, 'cloth');
    g.set(4, ty + 1, k1Light, 'k1');
    g.set(5, ty + 1, k1Dark, 'k1');
    g.set(4, ty + 2, MAT.leatherMid, 'wood');
    g.set(5, ty + 2, MAT.leatherDark, 'wood');
    if (p.gender === 'female') {
      g.set(3, ty + 2, k1Light, 'k1');
      g.set(6, ty + 2, k1Dark, 'k1');
      g.set(3, ty + 3, k1Light, 'k1');
      g.set(4, ty + 3, k1Light, 'k1');
      g.set(5, ty + 3, k1Dark, 'k1');
      g.set(6, ty + 3, k1Dark, 'k1');
    } else {
      g.set(3, ty + 1, MAT.linenLight, 'cloth');
      g.set(6, ty + 1, MAT.linenShadow, 'cloth');
    }
    return;
  }

  if (p.role === 'worker') {
    // K1 shirt + sturdy leather apron front
    g.set(3, ty, k1Light, 'k1');
    g.set(4, ty, k1Light, 'k1');
    g.set(5, ty, k1Dark, 'k1');
    g.set(6, ty, k1Dark, 'k1');
    g.set(3, ty + 1, k1Light, 'k1');
    g.set(4, ty + 1, MAT.leatherMid, 'wood');
    g.set(5, ty + 1, MAT.leatherDark, 'wood');
    g.set(6, ty + 1, k1Dark, 'k1');
    g.set(4, ty + 2, MAT.leatherMid, 'wood');
    g.set(5, ty + 2, MAT.leatherDark, 'wood');
    g.set(4, ty + 3, MAT.leatherDark, 'wood');
    g.set(5, ty + 3, MAT.leatherDark, 'wood');
    return;
  }

  if (p.role === 'cleric') {
    // Long flowing robe + K1/K2 vertical stole
    for (let y = ty; y <= ty + 4 && y <= 8; y++) {
      g.set(3, y, MAT.darkCloth, 'cloth');
      g.set(4, y, k1Light, 'k1');
      g.set(5, y, y === ty + 2 ? k2Light : k1Dark, y === ty + 2 ? 'k2' : 'k1');
      g.set(6, y, MAT.darkCloth, 'cloth');
    }
    return;
  }

  if (p.role === 'merchant') {
    // Broad fur-collared K1 coat with K2 trim
    g.set(3, ty, MAT.linenLight, 'cloth');
    g.set(4, ty, MAT.linenLight, 'cloth');
    g.set(5, ty, MAT.linenShadow, 'cloth');
    g.set(6, ty, MAT.linenShadow, 'cloth');
    for (let x = 2; x <= 7; x++) {
      g.set(x, ty + 1, x < 5 ? k1Light : k1Dark, 'k1');
      g.set(x, ty + 2, x === 4 || x === 5 ? k2Light : x < 5 ? k1Light : k1Dark, x === 4 || x === 5 ? 'k2' : 'k1');
    }
    g.set(3, ty + 3, k1Light, 'k1');
    g.set(4, ty + 3, k2Light, 'k2');
    g.set(5, ty + 3, k2Dark, 'k2');
    g.set(6, ty + 3, k1Dark, 'k1');
    return;
  }

  if (p.role === 'king' || p.role === 'queen' || p.powerRank === 'king' || p.powerRank === 'alliance-leader') {
    // Wide royal K1 mantle + K2/ermine lining
    g.set(2, ty, MAT.linenLight, 'cloth');
    g.set(3, ty, k1Light, 'k1');
    g.set(4, ty, k2Light, 'k2');
    g.set(5, ty, k2Light, 'k2');
    g.set(6, ty, k1Dark, 'k1');
    g.set(7, ty, MAT.linenShadow, 'cloth');

    g.set(2, ty + 1, k1Light, 'k1');
    g.set(3, ty + 1, k1Light, 'k1');
    g.set(4, ty + 1, k2Light, 'k2');
    g.set(5, ty + 1, k2Dark, 'k2');
    g.set(6, ty + 1, k1Dark, 'k1');
    g.set(7, ty + 1, k1Dark, 'k1');

    g.set(2, ty + 2, k1Light, 'k1');
    g.set(3, ty + 2, k1Light, 'k1');
    g.set(4, ty + 2, MAT.goldLight, 'gold');
    g.set(5, ty + 2, MAT.goldShadow, 'gold');
    g.set(6, ty + 2, k1Dark, 'k1');
    g.set(7, ty + 2, k1Dark, 'k1');

    const hemY = Math.min(8, ty + 3);
    if (p.role === 'queen' || p.gender === 'female') {
      // Flared royal gown
      for (let x = 2; x <= 7; x++) {
        g.set(x, hemY, x < 5 ? k1Light : k1Dark, 'k1');
      }
      g.set(4, hemY, k2Light, 'k2');
      g.set(5, hemY, k2Dark, 'k2');
    } else {
      for (let x = 3; x <= 6; x++) {
        g.set(x, hemY, x < 5 ? k1Light : k1Dark, 'k1');
      }
    }
    return;
  }

  if (p.role === 'settlement-leader' || p.powerRank === 'village-leader') {
    // Fur-trimmed mantle shoulders + K1 coat
    g.set(2, ty, MAT.linenLight, 'cloth');
    g.set(3, ty, MAT.linenLight, 'cloth');
    g.set(4, ty, k1Light, 'k1');
    g.set(5, ty, k1Dark, 'k1');
    g.set(6, ty, MAT.linenShadow, 'cloth');
    g.set(7, ty, MAT.linenShadow, 'cloth');
    g.set(3, ty + 1, k1Light, 'k1');
    g.set(4, ty + 1, k1Light, 'k1');
    g.set(5, ty + 1, k1Dark, 'k1');
    g.set(6, ty + 1, k1Dark, 'k1');
    g.set(3, ty + 2, k2Light, 'k2');
    g.set(4, ty + 2, k1Light, 'k1');
    g.set(5, ty + 2, k1Dark, 'k1');
    g.set(6, ty + 2, k2Dark, 'k2');
    return;
  }

  if (p.role === 'heir' || p.powerRank === 'city-lord') {
    // Flowing half-cape on left + K1 noble tunic + K2 sash
    g.set(2, ty, k1Light, 'k1');
    g.set(2, ty + 1, k1Light, 'k1');
    g.set(2, ty + 2, k1Dark, 'k1');
    g.set(2, ty + 3, k1Dark, 'k1');
    g.set(3, ty, k1Light, 'k1');
    g.set(4, ty, k1Light, 'k1');
    g.set(5, ty, k2Light, 'k2');
    g.set(6, ty, k1Dark, 'k1');
    g.set(3, ty + 1, k1Light, 'k1');
    g.set(4, ty + 1, k2Light, 'k2');
    g.set(5, ty + 1, k1Dark, 'k1');
    g.set(6, ty + 1, k1Dark, 'k1');
    g.set(3, ty + 2, k1Dark, 'k1');
    g.set(4, ty + 2, k1Light, 'k1');
    g.set(5, ty + 2, k1Dark, 'k1');
    g.set(6, ty + 2, k1Dark, 'k1');
    return;
  }

  // Archer / Warrior base tunic
  g.set(3, ty, k1Light, 'k1');
  g.set(4, ty, k1Light, 'k1');
  g.set(5, ty, k1Dark, 'k1');
  g.set(6, ty, k1Dark, 'k1');
  g.set(3, ty + 1, k1Light, 'k1');
  g.set(4, ty + 1, k1Light, 'k1');
  g.set(5, ty + 1, k1Dark, 'k1');
  g.set(6, ty + 1, k1Dark, 'k1');
  g.set(3, ty + 2, k2Light, 'k2');
  g.set(4, ty + 2, k2Light, 'k2');
  g.set(5, ty + 2, k2Dark, 'k2');
  g.set(6, ty + 2, k2Dark, 'k2');
  if (p.gender === 'female') {
    g.set(3, Math.min(8, ty + 3), k1Light, 'k1');
    g.set(4, Math.min(8, ty + 3), k1Light, 'k1');
    g.set(5, Math.min(8, ty + 3), k1Dark, 'k1');
    g.set(6, Math.min(8, ty + 3), k1Dark, 'k1');
  }
}

// 6. LAYER 6: ARMOR (era-aware: bone/hide, bronze, or medieval steel plate & shield)
function applyArmorLayer(g: LayeredGrid, p: ResolvedHumanProfile, dy: number): void {
  if (p.age === 'child') return;

  const [k2Light, k2Dark] = getEffectiveK2MidAndShadow(p);
  const k1 = p.kingdom.k1Ramp;
  const [metalLight, metalDark] = getMetalPair(p.era);

  if (p.role === 'warrior') {
    const ty = 4 + dy;
    g.set(3, ty, metalLight, 'metal');
    g.set(4, ty, metalLight, 'metal');
    g.set(5, ty, metalDark, 'metal');
    g.set(6, ty, metalDark, 'metal');
    g.set(4, ty + 1, metalLight, 'metal');
    g.set(5, ty + 1, metalDark, 'metal');
    // Shield on left arm (x=1..2, y=5..7)
    g.set(1, ty + 1, k2Light, 'k2');
    g.set(2, ty + 1, metalLight, 'metal');
    g.set(1, ty + 2, k2Dark, 'k2');
    g.set(2, ty + 2, k1[1], 'k1');
    g.set(2, ty + 3, k2Dark, 'k2');
    return;
  }

  if (p.role === 'cavalry') {
    g.set(4, 4 + dy, metalLight, 'metal');
    g.set(5, 4 + dy, metalDark, 'metal');
    g.set(1, 5, metalLight, 'metal');
    g.set(2, 5, metalDark, 'metal');
    return;
  }

  if (p.role === 'archer') {
    g.set(7, 4 + dy, MAT.leatherMid, 'wood');
    g.set(7, 5 + dy, MAT.leatherDark, 'wood');
    return;
  }

  if (p.role === 'heir' || p.powerRank === 'city-lord') {
    g.set(3, 4 + dy, metalLight, 'metal');
    g.set(6, 4 + dy, metalDark, 'metal');
    g.set(4, 5 + dy, MAT.goldLight, 'gold');
  }
}

// 7. LAYER 7: HEADGEAR (era + race + role + powerRank silhouettes)
function applyHeadgearLayer(g: LayeredGrid, p: ResolvedHumanProfile, dy: number): void {
  const k1 = p.kingdom.k1Ramp;
  const [k2Light] = getEffectiveK2MidAndShadow(p);
  const [metalLight, metalDark] = getMetalPair(p.era);

  if (p.age === 'child') {
    if (p.role === 'king' || p.role === 'queen' || p.powerRank === 'king') {
      g.set(3, 3, MAT.goldLight, 'gold');
      g.set(4, 3, k1[1], 'k1');
      g.set(5, 3, MAT.goldLight, 'gold');
      g.set(6, 3, MAT.goldShadow, 'gold');
    } else if (p.role === 'warrior') {
      g.set(4, 3, metalLight, 'metal');
      g.set(5, 3, metalDark, 'metal');
    } else if (p.race === 'demon') {
      g.set(3, 3, MAT.boneLight, 'gold');
      g.set(6, 3, MAT.boneDark, 'gold');
    }
    return;
  }

  const topY = Math.max(0, dy); // y=0..1

  // Demon curved black/bone horns always frame the crown row
  if (p.race === 'demon' && p.powerRank === 'none' && p.role !== 'king' && p.role !== 'queen') {
    g.set(2, topY, MAT.boneLight, 'gold');
    g.set(3, topY + 1, MAT.boneDark, 'gold');
    g.set(7, topY, MAT.boneLight, 'gold');
    g.set(6, topY + 1, MAT.boneDark, 'gold');
    return;
  }

  if (p.powerRank === 'alliance-leader') {
    const crownLight = p.era === 'stone-age' ? MAT.boneLight : p.era === 'bronze-iron' ? MAT.bronzeLight : MAT.goldLight;
    const crownDark = p.era === 'stone-age' ? MAT.boneDark : p.era === 'bronze-iron' ? MAT.bronzeDark : MAT.goldShadow;
    g.set(2, 0, crownLight, 'gold');
    g.set(4, 0, k2Light, 'k2');
    g.set(5, 0, crownLight, 'gold');
    g.set(7, 0, crownDark, 'gold');
    g.set(2, 1, k2Light, 'k2');
    g.set(3, 1, crownLight, 'gold');
    g.set(4, 1, k1[1], 'k1');
    g.set(5, 1, crownLight, 'gold');
    g.set(6, 1, crownDark, 'gold');
    g.set(7, 1, k2Light, 'k2');
    return;
  }

  if (p.role === 'king' || p.powerRank === 'king') {
    if (p.era === 'stone-age') {
      // Twin curved bone antlers + K1 war-crest
      g.set(2, 0, MAT.boneLight, 'gold');
      g.set(7, 0, MAT.boneDark, 'gold');
      g.set(3, 1, MAT.boneLight, 'gold');
      g.set(4, 1, k1[1], 'k1');
      g.set(5, 1, k2Light, 'k2');
      g.set(6, 1, MAT.boneDark, 'gold');
      return;
    }
    if (p.role === 'queen') {
      g.set(3, 0, MAT.goldLight, 'gold');
      g.set(6, 0, MAT.goldShadow, 'gold');
      g.set(3, 1, MAT.goldLight, 'gold');
      g.set(4, 1, k2Light, 'k2');
      g.set(5, 1, MAT.goldLight, 'gold');
      g.set(6, 1, MAT.goldShadow, 'gold');
      return;
    }
    if (p.era === 'bronze-iron') {
      // Sun-ray bronze crown
      g.set(2, 0, MAT.bronzeLight, 'gold');
      g.set(4, 0, MAT.goldLight, 'gold');
      g.set(6, 0, MAT.bronzeDark, 'gold');
      g.set(3, 1, MAT.bronzeLight, 'gold');
      g.set(4, 1, k1[1], 'k1');
      g.set(5, 1, MAT.bronzeLight, 'gold');
      g.set(6, 1, MAT.bronzeDark, 'gold');
      return;
    }
    // Distinct 3-spike king crown at x=2, 4, 6 (medieval)
    g.set(2, 0, MAT.goldLight, 'gold');
    g.set(4, 0, MAT.goldLight, 'gold');
    g.set(6, 0, MAT.goldShadow, 'gold');
    g.set(3, 1, MAT.goldLight, 'gold');
    g.set(4, 1, k1[1], 'k1');
    g.set(5, 1, MAT.goldLight, 'gold');
    g.set(6, 1, MAT.goldShadow, 'gold');
    return;
  }

  if (p.role === 'queen') {
    g.set(3, 0, MAT.goldLight, 'gold');
    g.set(6, 0, MAT.goldShadow, 'gold');
    g.set(3, 1, MAT.goldLight, 'gold');
    g.set(4, 1, k2Light, 'k2');
    g.set(5, 1, MAT.goldLight, 'gold');
    g.set(6, 1, MAT.goldShadow, 'gold');
    return;
  }

  if (p.role === 'heir' || p.powerRank === 'city-lord') {
    g.set(4, topY, MAT.goldLight, 'gold');
    g.set(3, topY + 1, metalLight, 'metal');
    g.set(4, topY + 1, MAT.goldLight, 'gold');
    g.set(5, topY + 1, k1[1], 'k1');
    g.set(6, topY + 1, metalDark, 'metal');
    return;
  }

  if (p.role === 'settlement-leader' || p.powerRank === 'village-leader') {
    g.set(4, topY, k1[1], 'k1');
    g.set(5, topY, k1[2], 'k1');
    g.set(3, topY + 1, MAT.linenLight, 'cloth');
    g.set(4, topY + 1, MAT.linenLight, 'cloth');
    g.set(5, topY + 1, MAT.linenShadow, 'cloth');
    g.set(6, topY + 1, MAT.linenShadow, 'cloth');
    return;
  }

  if (p.role === 'warrior') {
    if (p.era === 'stone-age') {
      // Tribal bone/feather headband
      g.set(3, topY, MAT.boneLight, 'gold');
      g.set(5, topY, k1[1], 'k1');
      g.set(3, topY + 1, MAT.leatherMid, 'wood');
      g.set(4, topY + 1, k1[1], 'k1');
      g.set(5, topY + 1, k1[2], 'k1');
      g.set(6, topY + 1, MAT.leatherDark, 'wood');
      return;
    }
    if (p.race === 'dwarf' || p.race === 'orc') {
      // Horned / winged warrior helm
      g.set(2, topY, MAT.boneLight, 'gold');
      g.set(4, topY, k1[1], 'k1');
      g.set(5, topY, k1[2], 'k1');
      g.set(7, topY, MAT.boneDark, 'gold');
      g.set(3, topY + 1, metalLight, 'metal');
      g.set(4, topY + 1, metalLight, 'metal');
      g.set(5, topY + 1, metalDark, 'metal');
      g.set(6, topY + 1, metalDark, 'metal');
      return;
    }
    g.set(4, topY, k1[1], 'k1');
    g.set(5, topY, k1[2], 'k1');
    g.set(3, topY + 1, metalLight, 'metal');
    g.set(4, topY + 1, metalLight, 'metal');
    g.set(5, topY + 1, metalDark, 'metal');
    g.set(6, topY + 1, metalDark, 'metal');
    return;
  }

  if (p.role === 'cavalry') {
    g.set(4, 0, metalLight, 'metal');
    g.set(5, 0, k1[1], 'k1');
    g.set(6, 0, k1[2], 'k1');
    g.set(4, 1, metalLight, 'metal');
    g.set(5, 1, metalDark, 'metal');
    return;
  }

  if (p.role === 'archer') {
    g.set(3, topY, k1[1], 'k1');
    g.set(4, topY, k1[1], 'k1');
    g.set(3, topY + 1, k1[1], 'k1');
    g.set(4, topY + 1, k1[1], 'k1');
    g.set(5, topY + 1, k1[2], 'k1');
    g.set(6, topY + 1, k1[2], 'k1');
    return;
  }

  if (p.role === 'cleric') {
    g.set(4, 0, MAT.linenLight, 'cloth');
    g.set(5, 0, k1[1], 'k1');
    g.set(3, 1, MAT.linenLight, 'cloth');
    g.set(4, 1, k1[1], 'k1');
    g.set(5, 1, k1[2], 'k1');
    g.set(6, 1, MAT.linenShadow, 'cloth');
    return;
  }

  if (p.role === 'merchant') {
    g.set(4, 0, k1[1], 'k1');
    g.set(5, 0, k1[2], 'k1');
    g.set(6, 0, k2Light, 'k2');
    for (let x = 2; x <= 7; x++) {
      g.set(x, 1, x < 5 ? k1[1] : k1[2], 'k1');
    }
    return;
  }

  if (p.role === 'worker') {
    g.set(3, topY + 1, MAT.leatherMid, 'wood');
    g.set(4, topY + 1, MAT.leatherMid, 'wood');
    g.set(5, topY + 1, MAT.leatherDark, 'wood');
    g.set(6, topY + 1, MAT.leatherDark, 'wood');
    return;
  }

  if (p.role === 'peasant' && p.hairStyle % 2 === 1) {
    g.set(3, topY + 1, MAT.linenLight, 'cloth');
    g.set(4, topY + 1, MAT.linenLight, 'cloth');
    g.set(5, topY + 1, MAT.linenShadow, 'cloth');
    g.set(6, topY + 1, MAT.linenShadow, 'cloth');
  }
}

// 8. LAYER 8: WEAPON OR TOOL (era-aware: flint/bone, bronze, medieval steel)
function applyWeaponToolLayer(g: LayeredGrid, p: ResolvedHumanProfile, dy: number): void {
  if (p.status === 'captive') return;

  const k1 = p.kingdom.k1Ramp;
  const [metalLight, metalDark] = getMetalPair(p.era);

  if (p.age === 'child') {
    if (p.role === 'warrior' || p.role === 'archer') {
      g.set(7, 5, MAT.leatherMid, 'wood');
      g.set(7, 6, MAT.leatherDark, 'wood');
    } else if (p.role === 'king' || p.role === 'queen') {
      g.set(7, 5, MAT.goldLight, 'gold');
      g.set(7, 6, MAT.goldShadow, 'gold');
    }
    return;
  }

  if (p.role === 'peasant') {
    if (p.era === 'stone-age') {
      // Wooden digging stick / flint pick
      for (let y = 3; y <= 8; y++) {
        g.set(8, y, MAT.leatherMid, 'wood');
      }
      g.set(7, 3, MAT.boneLight, 'gold');
      g.set(8, 2, MAT.boneDark, 'gold');
      return;
    }
    for (let y = 3; y <= 8; y++) {
      g.set(8, y, MAT.leatherMid, 'wood');
    }
    g.set(7, 2, metalLight, 'metal');
    g.set(8, 2, metalDark, 'metal');
    g.set(9, 2, metalLight, 'metal');
    return;
  }

  if (p.role === 'worker') {
    for (let y = 5; y <= 8; y++) {
      g.set(8, y, MAT.leatherMid, 'wood');
    }
    g.set(7, 3, metalLight, 'metal');
    g.set(8, 3, metalLight, 'metal');
    g.set(9, 3, metalDark, 'metal');
    g.set(7, 4, metalDark, 'metal');
    g.set(8, 4, metalDark, 'metal');
    return;
  }

  if (p.role === 'warrior') {
    if (p.era === 'stone-age') {
      // Flint-tipped tribal spear (tall pole + flint spearhead)
      for (let y = 3 + dy; y <= 8; y++) {
        g.set(8, y, MAT.leatherMid, 'wood');
      }
      g.set(8, 1 + dy, MAT.boneLight, 'gold');
      g.set(8, 2 + dy, MAT.boneDark, 'gold');
      return;
    }
    if (p.era === 'bronze-iron') {
      // Bronze leaf-blade & bronze crossguard
      g.set(8, 2 + dy, MAT.bronzeLight, 'metal');
      g.set(8, 3 + dy, MAT.bronzeLight, 'metal');
      g.set(8, 4 + dy, MAT.bronzeDark, 'metal');
      g.set(7, 5 + dy, MAT.bronzeLight, 'metal');
      g.set(8, 5 + dy, MAT.bronzeDark, 'metal');
      g.set(9, 5 + dy, MAT.bronzeDark, 'metal');
      g.set(8, 6 + dy, MAT.leatherDark, 'wood');
      return;
    }
    g.set(8, 2 + dy, MAT.steelLight, 'metal');
    g.set(8, 3 + dy, MAT.steelLight, 'metal');
    g.set(8, 4 + dy, MAT.steelShadow, 'metal');
    g.set(7, 5 + dy, MAT.goldLight, 'gold');
    g.set(8, 5 + dy, MAT.goldShadow, 'gold');
    g.set(9, 5 + dy, MAT.goldShadow, 'gold');
    g.set(8, 6 + dy, MAT.leatherDark, 'wood');
    return;
  }

  if (p.role === 'archer') {
    g.set(1, 3 + dy, MAT.leatherMid, 'wood');
    g.set(0, 4 + dy, MAT.leatherMid, 'wood');
    g.set(0, 5 + dy, MAT.leatherDark, 'wood');
    g.set(0, 6 + dy, MAT.leatherDark, 'wood');
    g.set(1, 7 + dy, MAT.leatherDark, 'wood');
    return;
  }

  if (p.role === 'cavalry') {
    for (let y = 0; y <= 6; y++) {
      g.set(8, y, y === 0 ? metalLight : MAT.leatherMid, y === 0 ? 'metal' : 'wood');
    }
    g.set(9, 1, k1[1], 'k1');
    g.set(9, 2, k1[2], 'k1');
    return;
  }

  if (p.role === 'cleric') {
    for (let y = 2; y <= 8; y++) {
      g.set(8, y, MAT.leatherMid, 'wood');
    }
    g.set(7, 1, MAT.goldLight, 'gold');
    g.set(8, 1, MAT.goldLight, 'gold');
    g.set(7, 2, MAT.goldShadow, 'gold');
    return;
  }

  if (p.role === 'merchant') {
    g.set(8, 5 + dy, MAT.goldLight, 'gold');
    g.set(8, 6 + dy, MAT.goldShadow, 'gold');
    g.set(9, 6 + dy, MAT.goldShadow, 'gold');
    return;
  }

  if (p.role === 'settlement-leader') {
    for (let y = 2; y <= 8; y++) {
      g.set(1, y, MAT.leatherMid, 'wood');
    }
    g.set(0, 1, k1[1], 'k1');
    g.set(1, 1, MAT.goldLight, 'gold');
    g.set(0, 2, k1[2], 'k1');
    return;
  }

  if (p.role === 'heir') {
    g.set(8, 2 + dy, metalLight, 'metal');
    g.set(8, 3 + dy, metalLight, 'metal');
    g.set(8, 4 + dy, metalDark, 'metal');
    g.set(7, 5 + dy, MAT.goldLight, 'gold');
    g.set(8, 5 + dy, MAT.goldLight, 'gold');
    g.set(9, 5 + dy, MAT.goldShadow, 'gold');
    return;
  }

  if (p.role === 'king') {
    const scepterTop = p.era === 'stone-age' ? MAT.boneLight : MAT.goldLight;
    const scepterBot = p.era === 'stone-age' ? MAT.boneDark : MAT.goldShadow;
    g.set(8, 1, k1[1], 'k1');
    g.set(8, 2, scepterTop, 'gold');
    g.set(8, 3, scepterTop, 'gold');
    g.set(8, 4, scepterBot, 'gold');
    g.set(8, 5, scepterBot, 'gold');
    g.set(8, 6, scepterBot, 'gold');
    return;
  }

  if (p.role === 'queen') {
    g.set(1, 2, MAT.goldLight, 'gold');
    g.set(1, 3, MAT.goldLight, 'gold');
    g.set(1, 4, MAT.goldShadow, 'gold');
    g.set(1, 5, MAT.goldShadow, 'gold');
    g.set(1, 6, MAT.goldShadow, 'gold');
    g.set(8, 5 + dy, MAT.goldLight, 'gold');
    g.set(8, 6 + dy, MAT.goldShadow, 'gold');
  }
}

// 9. LAYER 9: STATUS SIGNS + ALLIANCE LEADER SUPREME INSIGNIA
function applyStatusSignLayer(g: LayeredGrid, p: ResolvedHumanProfile, dy: number): void {
  const [k2Light, k2Dark] = getEffectiveK2MidAndShadow(p);

  // Alliance Leader supreme hierarchy sign: allied K2 banner standard on left + shoulder seal
  if (p.powerRank === 'alliance-leader' && p.age !== 'child') {
    for (let y = 2; y <= 7; y++) {
      g.set(1, y, MAT.goldLight, 'gold');
    }
    g.set(0, 2, k2Light, 'k2');
    g.set(0, 3, k2Dark, 'k2');
    g.set(2, 4 + dy, k2Light, 'k2');
    g.set(7, 4 + dy, k2Dark, 'k2');
  }

  if (p.status === 'healthy') return;

  if (p.status === 'wounded') {
    // Crimson blood/bandage marks connected cleanly to chest/brow
    const wy = p.age === 'child' ? 6 : 5 + dy;
    g.set(4, wy, MAT.statusWound, 'status');
    g.set(5, wy, MAT.statusWound, 'status');
    if (p.age !== 'child') {
      g.set(3, 2 + dy, MAT.statusWound, 'status');
    }
    return;
  }

  if (p.status === 'sick') {
    // Sickly green spots on cheek & torso
    const sy = p.age === 'child' ? 4 : 2 + dy;
    g.set(3, sy, MAT.statusSick, 'status');
    g.set(5, sy + 3, MAT.statusSick, 'status');
    return;
  }

  if (p.status === 'zombie') {
    // Tattered dark wound mark on chest & brow
    const zy = p.age === 'child' ? 6 : 5 + dy;
    g.set(4, zy, MAT.statusWound, 'status');
    g.set(5, zy, MAT.statusZombieDark, 'status');
    return;
  }

  if (p.status === 'possessed') {
    // Violet arcane horns/sparks attached directly to top of head/shoulders
    const py = p.age === 'child' ? 3 : 1 + dy;
    g.set(3, py, MAT.statusPossessed, 'status');
    g.set(6, py, MAT.statusPossessed, 'status');
    g.set(4, Math.min(8, py + 4), MAT.statusPossessed, 'status');
    return;
  }

  if (p.status === 'captive') {
    // Iron wrist/ankle shackles across waist & ankles
    const cy = p.age === 'child' ? 6 : 5 + dy;
    g.set(3, cy, MAT.statusShackle, 'status');
    g.set(4, cy, MAT.statusShackle, 'status');
    g.set(5, cy, MAT.statusShackle, 'status');
    g.set(6, cy, MAT.statusShackle, 'status');
    g.set(4, 8, MAT.statusShackle, 'status');
    g.set(5, 8, MAT.statusShackle, 'status');
  }
}

// ----------------------------------------------------------------------------
// STRICT PIXEL QUALITY GUARD (<= 8 COLORS, ZERO ORPHANS, ZERO ALPHA SMUDGE)
// ----------------------------------------------------------------------------

const rgbTupleCache = new Map<string, readonly [number, number, number]>();

function getRgbCached(hex: string): readonly [number, number, number] {
  let cached = rgbTupleCache.get(hex);
  if (!cached) {
    const [r, g, b] = hexToRgba(hex);
    cached = [r, g, b];
    if (rgbTupleCache.size < 2048) rgbTupleCache.set(hex, cached);
  }
  return cached;
}

function colorDistSq(hexA: string, hexB: string): number {
  const [r1, g1, b1] = getRgbCached(hexA);
  const [r2, g2, b2] = getRgbCached(hexB);
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

/**
 * Guarantees every frame strictly obeys <= maxColors (default 8) without
 * losing K1/skin readability: merges the closest pair of least-frequent colors
 * only when unique colors exceed `maxColors`.
 */
function enforceMaxColors(g: LayeredGrid, maxColors = 8): number {
  const raw = g.raw;
  const palette: string[] = [];
  const pCounts: number[] = [];

  for (let i = 0; i < 100; i++) {
    const c = raw[i];
    if (c === null) continue;
    let idx = -1;
    for (let k = 0; k < palette.length; k++) {
      if (palette[k] === c) {
        idx = k;
        break;
      }
    }
    if (idx === -1) {
      palette.push(c);
      pCounts.push(1);
    } else {
      pCounts[idx]++;
    }
  }

  while (palette.length > maxColors) {
    let bestI = 0;
    let bestJ = 1;
    let bestScore = Infinity;
    for (let i = 0; i < palette.length; i++) {
      for (let j = i + 1; j < palette.length; j++) {
        const dist = colorDistSq(palette[i], palette[j]);
        const freqPenalty = (pCounts[i] < pCounts[j] ? pCounts[i] : pCounts[j]) * 180;
        const score = dist + freqPenalty;
        if (score < bestScore) {
          bestScore = score;
          bestI = i;
          bestJ = j;
        }
      }
    }
    const keepIdx = pCounts[bestI] >= pCounts[bestJ] ? bestI : bestJ;
    const dropIdx = keepIdx === bestI ? bestJ : bestI;
    const keep = palette[keepIdx];
    const drop = palette[dropIdx];
    pCounts[keepIdx] += pCounts[dropIdx];
    palette.splice(dropIdx, 1);
    pCounts.splice(dropIdx, 1);
    for (let i = 0; i < 100; i++) {
      if (raw[i] === drop) raw[i] = keep;
    }
  }

  return palette.length;
}

function auditRawGrid(
  raw: readonly (string | null)[],
  zones: readonly (ZoneTag | null)[],
  w = 10,
  h = 10
): ProceduralSpriteAudit {
  const colors = new Set<string>();
  const inkUpper = INK.toUpperCase();
  let opaquePixels = 0;
  let semitransparentPixels = 0;
  let inkPixels = 0;
  let orphanPixels = 0;
  let k1ZonePixels = 0;
  let k2ZonePixels = 0;
  let skinZonePixels = 0;
  let hairZonePixels = 0;

  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      const c = raw[idx];
      if (!c) continue;
      opaquePixels++;
      colors.add(c);
      if (c === inkUpper) inkPixels++;
      if (c.length === 9) {
        const a = parseInt(c.slice(7, 9), 16);
        if (a > 0 && a < 255) semitransparentPixels++;
      }

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const z = zones[idx];
      if (z === 'k1') k1ZonePixels++;
      else if (z === 'k2') k2ZonePixels++;
      else if (z === 'skin') skinZonePixels++;
      else if (z === 'hair') hairZonePixels++;

      let hasNeighbor = false;
      const y0 = y > 0 ? y - 1 : 0;
      const y1 = y < h - 1 ? y + 1 : h - 1;
      const x0 = x > 0 ? x - 1 : 0;
      const x1 = x < w - 1 ? x + 1 : w - 1;
      for (let ny = y0; ny <= y1 && !hasNeighbor; ny++) {
        const nrow = ny * w;
        for (let nx = x0; nx <= x1; nx++) {
          if (nx === x && ny === y) continue;
          if (raw[nrow + nx] !== null) {
            hasNeighbor = true;
            break;
          }
        }
      }
      if (!hasNeighbor) orphanPixels++;
    }
  }

  return {
    opaquePixels,
    uniqueColors: colors.size,
    semitransparentPixels,
    inkPixels,
    orphanPixels,
    k1ZonePixels,
    k2ZonePixels,
    skinZonePixels,
    hairZonePixels,
    boundingBox:
      opaquePixels > 0
        ? {
            minX,
            maxX,
            minY,
            maxY,
            width: maxX - minX + 1,
            height: maxY - minY + 1,
          }
        : { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 },
  };
}

export function auditProceduralSprite(
  buf: PixelBuffer,
  zoneMap?: readonly (ZoneTag | null)[]
): ProceduralSpriteAudit {
  const raw = new Array<string | null>(buf.width * buf.height);
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      raw[y * buf.width + x] = buf.getPixel(x, y);
    }
  }
  return auditRawGrid(raw, zoneMap ?? new Array<ZoneTag | null>(buf.width * buf.height).fill(null), buf.width, buf.height);
}

// ----------------------------------------------------------------------------
// PUBLIC GENERATION ENTRY POINT
// ----------------------------------------------------------------------------

function renderGridFast(
  params: ProceduralHumanParams,
  trackZones = true
): {
  grid: LayeredGrid;
  profile: ResolvedHumanProfile;
  uniqueColors: number;
} {
  let profile = resolveHumanProfile(params);
  const grid = createLayeredGrid(trackZones);

  const dy = computeWalkBounceDy(
    profile.race,
    profile.role,
    profile.age,
    profile.powerRank,
    profile.frameIndex
  );

  if (isCustomSilhouetteRace(profile.race)) {
    if (profile.action === 'walk' && profile.carry === 'none') {
      renderCustomRaceLayers(grid, profile, dy);
    } else {
      const animatedAnchors = renderAnimatedCustomRaceUnit(
        grid,
        profile,
        profile.action,
        profile.carry,
        dy,
        {
          mat: MAT,
          getEffectiveSkinRamp,
          getEffectiveK2MidAndShadow,
          getMetalPair,
          applyStatusSignLayer,
        }
      );
      profile = { ...profile, anchors: animatedAnchors };
    }
  } else if (profile.action !== 'walk' || profile.carry !== 'none') {
    const animatedAnchors = renderMedievalAnimatedUnit(
      grid,
      profile,
      profile.action,
      profile.carry,
      dy,
      {
        mat: MAT,
        getEffectiveSkinRamp,
        getEffectiveK2MidAndShadow,
        getMetalPair,
        applyStatusSignLayer,
      }
    );
    profile = { ...profile, anchors: animatedAnchors };
  } else {
    // Fixed 9-layer assembly sequence (Stage 1 human & hidden legacy reserve)
    applyBodyLayer(grid, profile, dy);
    applySkinLayer(grid, profile, dy);
    applyFaceEyesLayer(grid, profile, dy);
    applyHairBeardLayer(grid, profile, dy);
    applyClothingLayer(grid, profile, dy);
    applyArmorLayer(grid, profile, dy);
    applyHeadgearLayer(grid, profile, dy);
    applyWeaponToolLayer(grid, profile, dy);
    applyStatusSignLayer(grid, profile, dy);
  }

  const uniqueColors = enforceMaxColors(grid, 8);
  grid.flush();
  return { grid, profile, uniqueColors };
}

export function generateProceduralUnit(params: ProceduralHumanParams): GeneratedHumanResult {
  const { grid, profile } = renderGridFast(params, true);
  const audit = auditRawGrid(grid.raw, grid.zones, 10, 10);

  return {
    buffer: grid.buf,
    zoneMap: grid.zones,
    profile,
    layerTrace: PAPER_DOLL_LAYERS,
    audit,
  };
}

export function generateMedievalHuman(params: ProceduralHumanParams): GeneratedHumanResult {
  return generateProceduralUnit(params);
}

/**
 * Generates a 10×10 grid (100 units) of deterministic medieval humans or multi-era/multi-race units.
 */
export function generateMedievalCrowdGrid(baseSeed = 1000, count = 100): GeneratedHumanResult[] {
  const out: GeneratedHumanResult[] = [];
  for (let i = 0; i < count; i++) {
    out.push(
      generateProceduralUnit({
        seed: baseSeed + i * 7919,
        era: 'medieval',
        race: 'human',
        frameIndex: i % 4,
      })
    );
  }
  return out;
}

export function generateProceduralMultiEraRaceGrid(baseSeed = 3000, count = 100): GeneratedHumanResult[] {
  const out: GeneratedHumanResult[] = [];
  for (let i = 0; i < count; i++) {
    out.push(
      generateProceduralUnit({
        seed: baseSeed + i * 6271,
        era: 'auto',
        race: 'auto',
        frameIndex: i % 4,
      })
    );
  }
  return out;
}

export interface ProceduralAtlasBenchmarkResult {
  readonly generatedCount: number;
  readonly bakedFrames: number;
  readonly pagesUsed: number;
  readonly elapsedMs: number;
  readonly maxColorsObserved: number;
}

/**
 * Performance benchmark: generates `count` (default 10,000) unique procedural
 * medieval human sprites and bakes them into `BakedSpriteAtlas`.
 */
export function benchmarkProceduralUnitsToAtlas(count = 10000): ProceduralAtlasBenchmarkResult {
  const atlas = new BakedSpriteAtlas(1024);
  let maxColorsObserved = 0;
  const start = performance.now();

  for (let i = 0; i < count; i++) {
    const key = `proc_med_${i}`;
    atlas.getOrBake(key, () => {
      const { grid, uniqueColors } = renderGridFast(
        {
          seed: 50000 + i * 31,
          era: 'medieval',
          frameIndex: i % 4,
        },
        false
      );
      if (uniqueColors > maxColorsObserved) {
        maxColorsObserved = uniqueColors;
      }
      return grid.buf;
    });
  }

  const elapsedMs = Number((performance.now() - start).toFixed(2));
  const stats = atlas.getStats();
  return {
    generatedCount: count,
    bakedFrames: stats.bakedFrames,
    pagesUsed: stats.pagesCount,
    elapsedMs,
    maxColorsObserved,
  };
}
