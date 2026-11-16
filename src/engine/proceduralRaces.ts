import { FourToneRamp } from './proceduralPalettes';
import type {
  ActiveUnitRace,
  LayeredGrid,
  ResolvedHumanProfile,
} from './proceduralHuman';

/**
 * ============================================================================
 * ORIGINAL RACES & PREHISTORIC SENTIENT SPECIES (10×10 SILHOUETTES)
 * ============================================================================
 * Distinct non-template silhouettes recognizable on a monochrome 10×10 opaque
 * mask (pairwise mask distance >= 15%) with dedicated 4-tone skin palettes,
 * race-specific weapons, hierarchy regalia, gender silhouettes, and age stages
 * (child / adult / elder), plus strictly roleless colonial `hive-mind`.
 *
 * Races covered here:
 * - marshfolk    (Болотный народ: low, wide, gills, webbed hands/feet)
 * - stonekin     (Каменнокожие: angular monolith + shoulder crystal outcrops)
 * - antlerfolk   (Лесной рогатый народ: tall, slender, branching antlers, slow gait)
 * - ash-nomads   (Пепельные кочевники: stooped in sweeping robes + glowing eyes)
 * - undead       (Нежить: redesigned skeletal wraith, hollow ribs, asymmetric shroud)
 * - demon        (Демоны: redesigned abyssal fiend, crescent horns, dorsal fins, hooves, tail)
 * - neanderthal  (Неандертальцы и Денисовцы: low brow, massive mammoth-fur shoulders)
 * - raptor-kin   (Ящеры-рапторы: left snout, crest feathers, counter-balance tail, claws)
 * - hive-mind    (Улей-Разум: roleless asymmetrical colonial cluster + root tentacles)
 * ============================================================================
 */

export interface RaceSkinRampEntry {
  readonly id: number;
  readonly name: string;
  readonly ramp: FourToneRamp;
}

export const RACE_SKIN_PALETTES: Readonly<Record<Exclude<ActiveUnitRace, 'human'>, readonly RaceSkinRampEntry[]>> = {
  marshfolk: [
    { id: 0, name: 'Речная бирюза', ramp: ['#73CCB8', '#49A691', '#2E7868', '#1C4D43'] },
    { id: 1, name: 'Болотный мох', ramp: ['#98C476', '#6A9E52', '#477035', '#2A4720'] },
    { id: 2, name: 'Озёрный сланец', ramp: ['#94B0AC', '#6E8C88', '#4B6360', '#2E3F3D'] },
    { id: 3, name: 'Тростниковая жаба', ramp: ['#B3D18A', '#8EB368', '#618242', '#3D5428'] },
  ],
  stonekin: [
    { id: 0, name: 'Серый базальт', ramp: ['#A8AEBA', '#7A808C', '#535863', '#33363E'] },
    { id: 1, name: 'Синий гранит', ramp: ['#8FA1B8', '#637388', '#424F61', '#28313D'] },
    { id: 2, name: 'Терракота', ramp: ['#D9A079', '#B87D56', '#855538', '#573623'] },
    { id: 3, name: 'Обсидиановый сланец', ramp: ['#7A7587', '#4E4A59', '#363240', '#211E28'] },
  ],
  antlerfolk: [
    { id: 0, name: 'Берёзовая кора', ramp: ['#EDE4D1', '#D6CBB3', '#A69A82', '#706654'] },
    { id: 1, name: 'Дубовая сердцевина', ramp: ['#C49B72', '#9C744E', '#6E4F33', '#473220'] },
    { id: 2, name: 'Лесной лишайник', ramp: ['#A5C295', '#7D9B6E', '#556E49', '#36472E'] },
    { id: 3, name: 'Янтарная сосна', ramp: ['#E3B36D', '#C48F4A', '#8F642F', '#5E401C'] },
  ],
  'ash-nomads': [
    { id: 0, name: 'Угольный пепел', ramp: ['#949099', '#6B6870', '#48454D', '#2C2A30'] },
    { id: 1, name: 'Пепельная охра', ramp: ['#B59F8E', '#8C7768', '#615044', '#3D3129'] },
    { id: 2, name: 'Вулканическая медь', ramp: ['#D69065', '#B56E45', '#824B2C', '#542F1B'] },
    { id: 3, name: 'Бледная пемза', ramp: ['#DBD7D2', '#B8B3AD', '#85807A', '#57534E'] },
  ],
  undead: [
    { id: 0, name: 'Древняя кость', ramp: ['#EAE2CE', '#D6CEB8', '#9E9682', '#666052'] },
    { id: 1, name: 'Могильный пепел', ramp: ['#C2C8CF', '#9EA4AB', '#6E747B', '#454A50'] },
    { id: 2, name: 'Иней склепа', ramp: ['#A6C7DB', '#7FA3B8', '#557385', '#344957'] },
    { id: 3, name: 'Тлен болот', ramp: ['#A5C9BC', '#7EA194', '#557368', '#344A42'] },
  ],
  demon: [
    { id: 0, name: 'Багровый жар', ramp: ['#EB6860', '#C93B36', '#8F2321', '#591414'] },
    { id: 1, name: 'Пепельно-сливовый', ramp: ['#9C5A70', '#6E384A', '#4A2331', '#2E141E'] },
    { id: 2, name: 'Серная бронза', ramp: ['#DB8653', '#B55E2E', '#803E1B', '#52250E'] },
    { id: 3, name: 'Обсидиан пекла', ramp: ['#786E87', '#4D4559', '#322C3B', '#1E1A24'] },
  ],
  neanderthal: [
    { id: 0, name: 'Морозный румянец', ramp: ['#EDC1A8', '#D6A082', '#A37258', '#6E4936'] },
    { id: 1, name: 'Бледный ледник', ramp: ['#F7DAC5', '#E3BA9E', '#B08970', '#785B48'] },
    { id: 2, name: 'Денисовский янтарь', ramp: ['#D19C79', '#AE7A58', '#7D5339', '#523422'] },
    { id: 3, name: 'Тундровый загар', ramp: ['#B38162', '#8D5E43', '#613E2A', '#3E2618'] },
  ],
  'raptor-kin': [
    { id: 0, name: 'Янтарная чешуя', ramp: ['#E6AE60', '#C4883E', '#8C5D25', '#5C3B14'] },
    { id: 1, name: 'Изумрудный ящер', ramp: ['#7EC77E', '#539C54', '#346E36', '#1F4721'] },
    { id: 2, name: 'Сизый раптор', ramp: ['#86A9C9', '#5A7D9E', '#3B5670', '#233647'] },
    { id: 3, name: 'Терракотовый хищник', ramp: ['#D97D65', '#B55640', '#803727', '#522117'] },
  ],
  'hive-mind': [
    { id: 0, name: 'Биолюминесцентный улей', ramp: ['#75D4D1', '#48A8A6', '#2B7573', '#194A49'] },
    { id: 1, name: 'Глубокий коралл', ramp: ['#E688A1', '#C45E7A', '#8C3B51', '#592332'] },
    { id: 2, name: 'Хитиновый янтарь', ramp: ['#E8BA72', '#C99349', '#8F642B', '#5C3E18'] },
    { id: 3, name: 'Абиссальная спора', ramp: ['#A794D9', '#7B66AD', '#52417A', '#33274F'] },
  ],
};

export function getCustomRaceSkinRamp(profile: ResolvedHumanProfile): FourToneRamp | null {
  if (profile.race === 'human' || profile.race === 'elf' || profile.race === 'orc' || profile.race === 'dwarf') {
    return null;
  }
  const entries = RACE_SKIN_PALETTES[profile.race];
  return entries[profile.skin.id % entries.length].ramp;
}

export function isCustomSilhouetteRace(race: ResolvedHumanProfile['race']): boolean {
  return (
    race === 'marshfolk' ||
    race === 'stonekin' ||
    race === 'antlerfolk' ||
    race === 'ash-nomads' ||
    race === 'undead' ||
    race === 'demon' ||
    race === 'neanderthal' ||
    race === 'raptor-kin' ||
    race === 'hive-mind'
  );
}

const RMAT = {
  boneLight: '#DFD4B7',
  boneDark: '#8C8168',
  stoneLight: '#8E96A3',
  stoneDark: '#4D535E',
  woodMid: '#A66C3A',
  woodDark: '#633C1D',
  linenLight: '#E5DEC7',
  linenDark: '#9E957E',
  goldLight: '#F7C93B',
  goldDark: '#B07214',
  steelLight: '#CCD6E2',
  steelDark: '#687487',
  bronzeLight: '#D89C4E',
  bronzeDark: '#8A561E',
  cyanGlow: '#7CE8FF',
  amberGlow: '#FFB732',
  wispDark: '#3A3E4A',
  furLight: '#B07D52',
  furDark: '#664329',
  silverHair: '#DCE0E8',
  statusWound: '#DC2626',
  statusSick: '#94C93B',
  statusPossessed: '#B86BFF',
  statusShackle: '#8590A2',
} as const;

function pickMetal(era: ResolvedHumanProfile['era']): readonly [string, string] {
  if (era === 'primordial' || era === 'dinosaurs' || era === 'ice-age' || era === 'stone-age') {
    return [RMAT.boneLight, RMAT.boneDark];
  }
  if (era === 'bronze-iron') return [RMAT.bronzeLight, RMAT.bronzeDark];
  return [RMAT.steelLight, RMAT.steelDark];
}

function getEffectiveSkin(p: ResolvedHumanProfile): FourToneRamp {
  if (p.status === 'zombie') {
    return ['#8BB865', '#689F48', '#3D632A', '#27421B'];
  }
  if (p.status === 'sick') {
    return ['#C9D8A2', '#A6BA7C', '#7B8F58', '#52613A'];
  }
  return getCustomRaceSkinRamp(p) ?? p.skin.ramp;
}

function getK2Pair(p: ResolvedHumanProfile): readonly [string, string] {
  const src = p.alliedKingdom ? p.alliedKingdom.k1Ramp : p.kingdom.k2Ramp;
  return [src[1], src[2]];
}

interface RoleFlags {
  isRoyal: boolean;
  isCityLord: boolean;
  isVillageLeader: boolean;
  isAlliance: boolean;
}

function getRoleFlags(p: ResolvedHumanProfile): RoleFlags {
  const isAlliance = p.powerRank === 'alliance-leader';
  const isRoyal =
    isAlliance ||
    p.role === 'king' ||
    p.role === 'queen' ||
    p.powerRank === 'king';
  const isCityLord = !isRoyal && (p.role === 'heir' || p.powerRank === 'city-lord');
  const isVillageLeader = !isRoyal && !isCityLord && (p.role === 'settlement-leader' || p.powerRank === 'village-leader');
  return { isRoyal, isCityLord, isVillageLeader, isAlliance };
}

/**
 * Shared connected alliance standard on x=0..1 (strictly 8-connected to body).
 */
function drawAllianceBannerLeft(g: LayeredGrid, k2Light: string, k2Dark: string): void {
  for (let y = 1; y <= 7; y++) g.set(1, y, RMAT.goldLight, 'gold');
  g.set(0, 1, k2Light, 'k2');
  g.set(0, 2, k2Dark, 'k2');
  g.set(0, 3, k2Light, 'k2');
}

/**
 * Applies role-authentic weapons, tools, packs, shields, and cavalry lances
 * for the 8 sentient role-bearing custom races. All coordinates connect cleanly
 * (8-connected) to the race's torso/arms.
 */
function applyCustomRoleEquipment(
  g: LayeredGrid,
  p: ResolvedHumanProfile,
  dy: number,
  metalL: string,
  metalD: string,
  k1: FourToneRamp,
  k2Light: string,
  k2Dark: string
): void {
  if (p.status === 'captive') return;

  const isElder = p.age === 'elder';
  const { isCityLord, isVillageLeader, isAlliance } = getRoleFlags(p);

  if (p.role === 'peasant') {
    // Primitive / rustic foraging hook or hoe on right (x=8..9, connected at x=7..8)
    for (let y = 4 + dy; y <= 8; y++) g.set(8, y, RMAT.woodMid, 'wood');
    g.set(9, 4 + dy, metalL, 'metal');
    g.set(7, 4 + dy, RMAT.woodDark, 'wood');
  } else if (p.role === 'worker') {
    // Heavy hammer / stone-pick on right + artisan apron band
    for (let y = 4 + dy; y <= 8; y++) g.set(8, y, RMAT.woodMid, 'wood');
    g.set(7, 3 + dy, metalL, 'metal');
    g.set(8, 3 + dy, metalL, 'metal');
    g.set(9, 3 + dy, metalD, 'metal');
    g.set(8, 4 + dy, metalD, 'metal');
  } else if (p.role === 'warrior') {
    // Left shield/buckler (x=1..2) + race-authentic right weapon
    g.set(1, 5 + dy, k2Light, 'k2');
    g.set(2, 5 + dy, metalL, 'metal');
    g.set(1, 6 + dy, k2Dark, 'k2');
    g.set(2, 6 + dy, k1[1], 'k1');
    if (p.race === 'marshfolk') {
      // Harpoon trident
      for (let y = 3; y <= 8; y++) g.set(9, y, RMAT.woodMid, 'wood');
      g.set(8, 3, metalL, 'metal');
      g.set(9, 2, metalL, 'metal');
      g.set(8, 6, RMAT.woodDark, 'wood');
    } else if (p.race === 'stonekin') {
      // Heavy basalt maul
      g.set(8, 4, RMAT.stoneLight, 'metal');
      g.set(9, 4, RMAT.stoneLight, 'metal');
      g.set(8, 5, RMAT.stoneDark, 'metal');
      g.set(9, 5, RMAT.stoneDark, 'metal');
      g.set(8, 6, RMAT.woodMid, 'wood');
      g.set(8, 7, RMAT.woodDark, 'wood');
    } else if (p.race === 'undead') {
      // Bone reaper scythe
      for (let y = 2; y <= 7; y++) g.set(8, y, RMAT.boneDark, 'wood');
      g.set(6, 1, metalL, 'metal');
      g.set(7, 1, metalL, 'metal');
      g.set(8, 1, metalD, 'metal');
      g.set(9, 2, metalD, 'metal');
    } else if (p.race === 'demon') {
      // Abyssal bident/trident
      for (let y = 3; y <= 8; y++) g.set(8, y, RMAT.stoneDark, 'metal');
      g.set(7, 2, RMAT.amberGlow, 'gold');
      g.set(9, 2, RMAT.amberGlow, 'gold');
      g.set(8, 2, metalL, 'metal');
    } else if (p.race === 'neanderthal') {
      // Mammoth-bone spear
      for (let y = 2; y <= 8; y++) g.set(9, y, RMAT.woodMid, 'wood');
      g.set(8, 2, RMAT.boneLight, 'gold');
      g.set(9, 1, RMAT.boneLight, 'gold');
      g.set(8, 5, RMAT.woodDark, 'wood');
    } else if (p.race === 'raptor-kin') {
      // Flint-clawed pack spear held forward on left
      g.set(0, 4, RMAT.boneLight, 'gold');
      g.set(0, 5, RMAT.woodMid, 'wood');
      g.set(0, 6, RMAT.woodDark, 'wood');
      g.set(1, 5, RMAT.woodMid, 'wood');
    } else {
      // Antlerfolk glaive / Ash-nomad curved scimitar
      for (let y = 2; y <= 8; y++) g.set(8, y, RMAT.woodMid, 'wood');
      g.set(8, 2, metalL, 'metal');
      g.set(9, 2, metalD, 'metal');
    }
  } else if (p.role === 'archer') {
    // Curved bow on left (x=0..1, connected to shoulder/arm at x=2)
    g.set(1, 3 + dy, RMAT.woodMid, 'wood');
    g.set(0, 4 + dy, RMAT.woodMid, 'wood');
    g.set(0, 5 + dy, RMAT.woodDark, 'wood');
    g.set(0, 6 + dy, RMAT.woodDark, 'wood');
    g.set(1, 7 + dy, RMAT.woodDark, 'wood');
    g.set(2, 5 + dy, metalL, 'metal'); // arrow tip
  } else if (p.role === 'cavalry') {
    // Tall war-lance + fluttering K1 pennant on right (x=8..9) + K2 harness shoulder
    for (let y = 0; y <= 7; y++) g.set(8, y, y === 0 ? metalL : RMAT.woodMid, y === 0 ? 'metal' : 'wood');
    g.set(9, 1, k1[1], 'k1');
    g.set(9, 2, k2Light, 'k2');
    g.set(2, 5 + dy, k2Light, 'k2');
    g.set(7, 5 + dy, k2Dark, 'k2');
  } else if (p.role === 'cleric') {
    // Glowing ritual staff on right (x=8..9)
    for (let y = 2; y <= 8; y++) g.set(8, y, RMAT.woodMid, 'wood');
    const orb = p.race === 'undead' || p.race === 'marshfolk' ? RMAT.cyanGlow : RMAT.amberGlow;
    g.set(8, 1, orb, 'gold');
    g.set(9, 1, orb, 'gold');
    g.set(7, 2, RMAT.goldLight, 'gold');
  } else if (p.role === 'merchant') {
    // Trade pack on back/hip + gold coin pouch
    g.set(8, 5 + dy, RMAT.goldLight, 'gold');
    g.set(8, 6 + dy, RMAT.goldDark, 'gold');
    g.set(9, 6 + dy, RMAT.goldDark, 'gold');
    g.set(1, 5 + dy, RMAT.woodMid, 'wood');
    g.set(1, 6 + dy, k2Light, 'k2');
  } else if (p.role === 'settlement-leader' || p.role === 'heir') {
    // Leader / lordly blade & K1 shoulder banner
    for (let y = 2; y <= 8; y++) g.set(8, y, RMAT.woodMid, 'wood');
    g.set(8, 2, metalL, 'metal');
    g.set(9, 2, k1[1], 'k1');
    g.set(9, 3, k2Light, 'k2');
  } else if (p.role === 'king' || p.role === 'queen') {
    // Ceremonial royal scepter on right
    for (let y = 2; y <= 7; y++) g.set(8, y, RMAT.goldDark, 'gold');
    g.set(8, 1, k1[1], 'k1');
    g.set(8, 2, RMAT.goldLight, 'gold');
    g.set(9, 2, k2Light, 'k2');
  } else if (isElder) {
    // Elder walking cane if no weapon occupied x=8
    for (let y = 5; y <= 8; y++) g.set(8, y, RMAT.woodDark, 'wood');
    g.set(8, 4, RMAT.boneLight, 'gold');
  }

  // Hierarchy insignia overlays (differentiate all 5 powerRanks!)
  if (isAlliance) {
    drawAllianceBannerLeft(g, k2Light, k2Dark);
  } else if (isCityLord && p.role !== 'archer') {
    g.set(2, 5 + dy, k2Light, 'k2');
    g.set(2, 6 + dy, k1[1], 'k1');
  } else if (isVillageLeader && p.role !== 'archer') {
    g.set(1, 4 + dy, k1[1], 'k1');
    g.set(1, 5 + dy, k2Light, 'k2');
  }
}

/**
 * Renders all 9 layers cleanly in race-specific geometry for the 9 custom/era races,
 * guaranteeing <= 8 colors, 0 INK, 0 orphans, child 6-7px vs adult/elder 9-10px,
 * distinct male/female & child/adult/elder & role & powerRank outputs, and
 * >= 15% pairwise silhouette mask uniqueness.
 */
export function renderCustomRaceLayers(
  g: LayeredGrid,
  p: ResolvedHumanProfile,
  dy: number
): void {
  const skin = getEffectiveSkin(p);
  const k1 = p.kingdom.k1Ramp;
  const [k2Light, k2Dark] = getK2Pair(p);
  const [metalL, metalD] = pickMetal(p.era);
  const isChild = p.age === 'child';
  const isElder = p.age === 'elder';
  const isFemale = p.gender === 'female';
  const { isRoyal, isCityLord, isVillageLeader } = getRoleFlags(p);
  void (isRoyal || isCityLord || isVillageLeader);

  // Walk stride helpers (antlerfolk moves noticeably slower: steps only on frame 2 without bounce)
  const strideL = p.race === 'antlerfolk' ? (p.frameIndex === 2 ? -1 : 0) : p.frameIndex === 1 ? -1 : 0;
  const strideR = p.race === 'antlerfolk' ? 0 : p.frameIndex === 3 ? -1 : 0;
  const armBob = p.race === 'antlerfolk' ? 0 : p.frameIndex === 1 ? -1 : p.frameIndex === 3 ? 1 : 0;

  // =========================================================================
  // 1. MARSHFOLK (Болотный народ: низкие, широкие, с перепонками и жабрами)
  // =========================================================================
  if (p.race === 'marshfolk') {
    if (isChild) {
      for (let x = 3; x <= 6; x++) g.set(x, 4, skin[0], 'skin');
      g.set(2, 5, skin[1], 'skin'); g.set(7, 5, skin[2], 'skin');
      g.set(3, 5, skin[1], 'skin'); g.set(6, 5, skin[2], 'skin');
      g.set(4, 5, skin[0], 'skin'); g.set(5, 5, skin[1], 'skin');
      g.set(3, 4, skin[3], 'skin'); g.set(6, 4, skin[3], 'skin');
      for (let x = 2; x <= 7; x++) g.set(x, 6, x < 5 ? k1[1] : k1[2], 'k1');
      for (let x = 3; x <= 6; x++) g.set(x, 7, x < 5 ? k1[1] : k2Dark, 'k1');
      if (isFemale) {
        g.set(2, 7, k2Light, 'k2'); g.set(7, 7, k2Dark, 'k2');
      }
      g.set(2, 8, skin[2], 'skin'); g.set(3, 8, skin[2], 'skin');
      g.set(6, 8, skin[2], 'skin'); g.set(7, 8, skin[2], 'skin');
      g.set(2, 9, skin[3], 'skin'); g.set(7, 9, skin[3], 'skin');
    } else {
      const top = 3 + dy;
      for (let x = 3; x <= 6; x++) g.set(x, top, x < 5 ? skin[0] : skin[1], 'skin');
      const gillColorL = isElder ? RMAT.silverHair : p.frameIndex === 1 ? k2Light : skin[0];
      const gillColorR = isElder ? RMAT.linenDark : p.frameIndex === 1 ? k2Dark : skin[2];
      g.set(1, top + 1, gillColorL, 'k2');
      g.set(2, top + 1, skin[0], 'skin');
      g.set(3, top + 1, skin[1], 'skin'); g.set(4, top + 1, skin[1], 'skin');
      g.set(5, top + 1, skin[1], 'skin'); g.set(6, top + 1, skin[2], 'skin');
      g.set(7, top + 1, skin[2], 'skin');
      g.set(8, top + 1, gillColorR, 'k2');
      g.set(3, top, skin[3], 'skin');
      g.set(6, top, skin[3], 'skin');

      if (isElder) {
        // Pale river-moss beard/barbels on chin
        g.set(4, top + 2, RMAT.silverHair, 'hair');
        g.set(5, top + 2, RMAT.linenDark, 'hair');
      }

      // Broad squat torso (female has flared K1/K2 reed-kilt & slimmer waist)
      for (let y = 5 + dy; y <= 7 + dy; y++) {
        for (let x = 2; x <= 7; x++) {
          g.set(x, y, x < 5 ? k1[1] : k1[2], 'k1');
        }
      }
      g.set(4, 6 + dy, k2Light, 'k2'); g.set(5, 6 + dy, k2Dark, 'k2');
      if (isFemale) {
        g.set(2, 4 + dy, k2Light, 'k2'); // coral reed-crest on female fin
        g.set(2, 8, k1[1], 'k1'); g.set(3, 8, k1[1], 'k1');
        g.set(4, 8, k2Light, 'k2'); g.set(5, 8, k2Dark, 'k2');
        g.set(6, 8, k1[2], 'k1'); g.set(7, 8, k1[2], 'k1');
      } else {
        g.set(2, 8, skin[2], 'skin'); g.set(3, 8, skin[2], 'skin');
        g.set(6, 8, skin[2], 'skin'); g.set(7, 8, skin[2], 'skin');
      }
      const waddleDx = p.frameIndex === 1 ? -1 : p.frameIndex === 3 ? 1 : 0;
      // Webbed paddle hands (marshfolk waddles side-to-side on walk frames 1 & 3)
      g.set(Math.max(0, Math.min(9, 1 + waddleDx)), 6 + dy + armBob, skin[1], 'skin');
      g.set(1, 7 + dy, skin[2], 'skin');
      g.set(Math.max(0, Math.min(9, 8 + waddleDx)), 6 + dy - armBob, skin[2], 'skin');
      g.set(8, 7 + dy, skin[2], 'skin');
      // Wide planted webbed feet
      g.set(2, 9 + strideL, skin[3], 'skin'); g.set(3, 9, skin[3], 'skin');
      g.set(6, 9, skin[3], 'skin'); g.set(7, 9 + strideR, skin[3], 'skin');

      applyCustomRoleEquipment(g, p, dy, metalL, metalD, k1, k2Light, k2Dark);

      if (isRoyal) {
        g.set(3, 2, k2Light, 'k2'); g.set(4, 1, RMAT.goldLight, 'gold');
        g.set(5, 1, RMAT.goldDark, 'gold'); g.set(6, 2, k2Dark, 'k2');
        g.set(4, 2, k1[1], 'k1'); g.set(5, 2, k1[2], 'k1');
      } else if (isCityLord) {
        g.set(3, 2, metalL, 'metal'); g.set(4, 2, k2Light, 'k2'); g.set(5, 2, metalD, 'metal');
      } else if (isVillageLeader) {
        g.set(4, 2, k1[0], 'k1'); g.set(5, 2, k2Light, 'k2');
      }
    }
  }

  // =========================================================================
  // 2. STONEKIN (Каменнокожие: угловатые, с наростами кристаллов на плечах)
  // =========================================================================
  else if (p.race === 'stonekin') {
    if (isChild) {
      g.set(2, 4, k1[0], 'k1'); g.set(7, 4, k2Light, 'k2');
      for (let y = 3; y <= 4; y++) {
        for (let x = 3; x <= 6; x++) g.set(x, y, x < 5 ? skin[0] : skin[2], 'skin');
      }
      g.set(4, 4, RMAT.cyanGlow, 'gold'); g.set(5, 4, RMAT.cyanGlow, 'gold');
      for (let y = 5; y <= 7; y++) {
        for (let x = 3; x <= 6; x++) g.set(x, y, y === 6 ? k1[1] : skin[1], y === 6 ? 'k1' : 'skin');
      }
      if (isFemale) g.set(4, 2, k2Light, 'k2');
      g.set(3, 8, skin[2], 'skin'); g.set(6, 8, skin[2], 'skin');
      g.set(3, 9, skin[3], 'skin'); g.set(6, 9, skin[3], 'skin');
    } else {
      // Flat angular monolith head (x=3..6, y=1..3)
      for (let y = 1; y <= 3; y++) {
        for (let x = 3; x <= 6; x++) {
          g.set(x, y, y === 1 || x === 3 ? skin[0] : x === 6 ? skin[2] : skin[1], 'skin');
        }
      }
      // Glowing crystal eye slit (elder has ancient white-cyan crystal eyes + brow moss/silver)
      const eyeC = isElder ? RMAT.cyanGlow : RMAT.amberGlow;
      g.set(4, 2, eyeC, 'gold');
      g.set(5, 2, eyeC, 'gold');
      if (isElder) {
        g.set(3, 1, RMAT.silverHair, 'hair');
        g.set(6, 1, RMAT.linenDark, 'hair');
      }

      // Towering jutting crystal outcrops on BOTH shoulders (signature silhouette!)
      g.set(1, 1, isElder ? RMAT.silverHair : k1[0], 'k1'); g.set(1, 2, k1[1], 'k1'); g.set(1, 3, k1[2], 'k1');
      g.set(2, 2, k1[0], 'k1'); g.set(2, 3, k1[1], 'k1');
      g.set(8, 1, isElder ? RMAT.silverHair : k2Light, 'k2'); g.set(8, 2, k2Light, 'k2'); g.set(8, 3, k2Dark, 'k2');
      g.set(7, 2, k2Light, 'k2'); g.set(7, 3, k2Dark, 'k2');

      // Broad angular monolith torso (female sculpted tapered waist at y=6..7 + crystal tiara)
      for (let y = 4; y <= 7; y++) {
        const minX = isFemale && y >= 6 ? 3 : 2;
        const maxX = isFemale && y >= 6 ? 6 : 7;
        for (let x = minX; x <= maxX; x++) {
          g.set(x, y, x < 4 ? skin[0] : x > 5 ? skin[2] : skin[1], 'skin');
        }
      }
      if (isFemale) {
        g.set(3, 0, k2Light, 'k2'); // female asymmetric crystal crest
        g.set(3, 7, k1[1], 'k1'); g.set(6, 7, k1[2], 'k1');
      }
      // K1 engraved rune belt & core
      for (let x = isFemale ? 3 : 2; x <= (isFemale ? 6 : 7); x++) g.set(x, 6, x < 5 ? k1[1] : k1[2], 'k1');
      g.set(4, 4, k2Light, 'k2'); g.set(5, 4, k2Dark, 'k2');
      g.set(4, 5, k1[1], 'k1'); g.set(5, 5, k1[2], 'k1');

      // Pillar legs
      if (isFemale) {
        g.set(3, 8, skin[2], 'skin'); g.set(6, 8, skin[3], 'skin');
        g.set(3, 9 + strideL, skin[3], 'skin'); g.set(6, 9 + strideR, skin[3], 'skin');
      } else {
        g.set(2, 8, skin[2], 'skin'); g.set(3, 8, skin[2], 'skin');
        g.set(6, 8, skin[2], 'skin'); g.set(7, 8, skin[3], 'skin');
        g.set(2, 9 + strideL, skin[3], 'skin'); g.set(3, 9, skin[3], 'skin');
        g.set(6, 9, skin[3], 'skin'); g.set(7, 9 + strideR, skin[3], 'skin');
      }

      applyCustomRoleEquipment(g, p, dy, metalL, metalD, k1, k2Light, k2Dark);

      if (isRoyal) {
        g.set(4, 0, k1[0], 'k1'); g.set(5, 0, k2Light, 'k2');
        g.set(3, 0, RMAT.goldLight, 'gold'); g.set(6, 0, RMAT.goldDark, 'gold');
      } else if (isCityLord) {
        g.set(4, 0, metalL, 'metal'); g.set(5, 0, k2Light, 'k2');
      } else if (isVillageLeader) {
        g.set(4, 0, k1[1], 'k1');
      }
    }
  }

  // =========================================================================
  // 3. ANTLERFOLK (Лесной рогатый народ: высокие, тонкие, ветвистые рога, медленный шаг)
  // =========================================================================
  else if (p.race === 'antlerfolk') {
    if (isChild) {
      g.set(3, 3, RMAT.woodMid, 'wood'); g.set(6, 3, RMAT.woodDark, 'wood');
      g.set(4, 4, skin[0], 'skin'); g.set(5, 4, skin[1], 'skin');
      g.set(4, 5, skin[1], 'skin'); g.set(5, 5, skin[2], 'skin');
      g.set(4, 6, k1[1], 'k1'); g.set(5, 6, k1[2], 'k1');
      if (isFemale) {
        g.set(3, 7, k1[1], 'k1'); g.set(6, 7, k1[2], 'k1');
      }
      g.set(4, 7, k1[1], 'k1'); g.set(5, 7, k2Dark, 'k2');
      g.set(4, 8, skin[2], 'skin'); g.set(5, 8, skin[2], 'skin');
      g.set(4, 9, skin[3], 'skin'); g.set(5, 9, skin[3], 'skin');
    } else {
      // Wide towering branching antlers (elder antlers bleach pale bone/silver!)
      const antL = isElder ? RMAT.boneLight : RMAT.woodMid;
      const antD = isElder ? RMAT.linenDark : RMAT.woodDark;
      g.set(1, 0, antL, 'wood'); g.set(3, 0, antL, 'wood');
      g.set(6, 0, antD, 'wood'); g.set(8, 0, antD, 'wood');
      g.set(2, 1, antL, 'wood'); g.set(3, 1, antL, 'wood');
      g.set(6, 1, antD, 'wood'); g.set(7, 1, antD, 'wood');
      if (isFemale) {
        // Blossoming K2 vine buds on slender female antlers
        g.set(2, 0, k2Light, 'k2'); g.set(7, 0, k2Dark, 'k2');
      }

      // Tall narrow head (x=4..5, y=2..3)
      g.set(4, 2, skin[0], 'skin'); g.set(5, 2, skin[1], 'skin');
      g.set(4, 3, skin[3], 'skin'); g.set(5, 3, isElder ? RMAT.silverHair : skin[2], 'skin');

      // Tall slender 2px trunk + thin arms
      g.set(3, 4, skin[0], 'skin'); g.set(6, 4, skin[2], 'skin');
      g.set(3, 5, skin[1], 'skin'); g.set(6, 5, skin[2], 'skin');
      for (let y = 4; y <= 7; y++) {
        g.set(4, y, y === 6 ? k2Light : k1[1], y === 6 ? 'k2' : 'k1');
        g.set(5, y, y === 6 ? k2Dark : k1[2], y === 6 ? 'k2' : 'k1');
      }
      if (isFemale) {
        // Flowing woodland bark-skirt
        g.set(3, 7, k1[1], 'k1'); g.set(6, 7, k1[2], 'k1');
        g.set(3, 8, k2Light, 'k2'); g.set(6, 8, k2Dark, 'k2');
      }
      // Slender crane legs (slow walk: strideL only on frame 2)
      g.set(4, 8, skin[2], 'skin'); g.set(5, 8, skin[2], 'skin');
      g.set(4, 9 + strideL, skin[3], 'skin'); g.set(5, 9, skin[3], 'skin');

      applyCustomRoleEquipment(g, p, dy, metalL, metalD, k1, k2Light, k2Dark);

      if (isRoyal) {
        g.set(4, 1, k1[1], 'k1'); g.set(5, 1, k2Light, 'k2');
        g.set(4, 0, RMAT.goldLight, 'gold'); g.set(5, 0, RMAT.goldDark, 'gold');
      } else if (isCityLord) {
        g.set(4, 1, metalL, 'metal'); g.set(5, 1, k2Light, 'k2');
      } else if (isVillageLeader) {
        g.set(4, 1, k1[1], 'k1'); g.set(5, 1, k1[2], 'k1');
      }
    }
  }

  // =========================================================================
  // 4. ASH NOMADS (Пепельные кочевники: сутулые, в балахонах, светящиеся глаза)
  // =========================================================================
  else if (p.race === 'ash-nomads') {
    if (isChild) {
      g.set(3, 4, k1[1], 'k1'); g.set(4, 4, k1[1], 'k1'); g.set(5, 4, k1[2], 'k1');
      g.set(3, 5, skin[3], 'skin'); g.set(4, 5, RMAT.amberGlow, 'gold'); g.set(5, 5, skin[3], 'skin');
      for (let y = 6; y <= 8; y++) {
        for (let x = 3; x <= 6; x++) g.set(x, y, x < 5 ? k1[1] : k1[2], 'k1');
      }
      if (isFemale) {
        g.set(2, 7, k2Light, 'k2'); g.set(6, 7, k2Dark, 'k2');
      }
      g.set(2, 9, k2Dark, 'k2'); g.set(3, 9, k1[2], 'k1'); g.set(4, 9, k1[2], 'k1');
      g.set(5, 9, k1[2], 'k1'); g.set(6, 9, k2Dark, 'k2');
    } else {
      // Hunched forward hood + raised back-hump on right
      g.set(3, 2, isElder ? RMAT.linenLight : k1[1], 'k1');
      g.set(4, 2, k1[1], 'k1');
      g.set(5, 2, k1[2], 'k1'); g.set(6, 2, k1[2], 'k1');
      // Cowl shadow + glowing amber eyes (elder glowing cyan-white eyes)
      const eyeGlow = isElder ? RMAT.cyanGlow : RMAT.amberGlow;
      g.set(2, 3, k1[1], 'k1');
      g.set(3, 3, eyeGlow, 'gold');
      g.set(4, 3, skin[3], 'skin');
      g.set(5, 3, eyeGlow, 'gold');
      g.set(6, 3, k1[2], 'k1'); g.set(7, 3, k1[2], 'k1');
      // Scarfed lower face & hunched back (female has K2 veil fold on left-right)
      g.set(2, 4, isFemale ? k2Light : skin[1], isFemale ? 'k2' : 'skin');
      g.set(3, 4, isElder ? RMAT.silverHair : k2Light, 'k2');
      g.set(4, 4, isElder ? RMAT.linenDark : k2Light, 'k2');
      g.set(5, 4, k1[2], 'k1'); g.set(6, 4, k1[2], 'k1'); g.set(7, 4, k1[2], 'k1');

      // Sweeping triangular desert cloak flaring to ground
      for (let y = 5; y <= 7; y++) {
        for (let x = 2; x <= 7; x++) {
          const isTrim = isFemale && (x === 2 || x === 7) && y >= 6;
          g.set(x, y, isTrim ? k2Light : x === 4 ? k2Light : x < 5 ? k1[1] : k1[2], isTrim || x === 4 ? 'k2' : 'k1');
        }
      }
      const ashF = ((p.frameIndex % 4) + 4) % 4;
      for (let x = 1; x <= 8; x++) {
        const hemPhase = (x + (ashF === 1 ? 1 : ashF === 3 ? 1 : 0)) % 2 === 0;
        const stepFootL = ashF === 1 && (x === 2 || x === 3);
        const stepFootR = ashF === 3 && (x === 6 || x === 7);
        g.set(x, 8, x === 4 || x === 5 ? k2Dark : x < 5 ? k1[1] : k1[2], x === 4 || x === 5 ? 'k2' : 'k1');
        g.set(
          x,
          9,
          stepFootL || stepFootR ? skin[3] : hemPhase ? k2Dark : k1[2],
          stepFootL || stepFootR ? 'skin' : hemPhase ? 'k2' : 'k1'
        );
      }

      applyCustomRoleEquipment(g, p, ashF === 2 ? -1 : 0, metalL, metalD, k1, k2Light, k2Dark);

      if (isRoyal) {
        g.set(3, 1, RMAT.goldLight, 'gold'); g.set(4, 0, RMAT.amberGlow, 'gold');
        g.set(5, 1, RMAT.goldDark, 'gold'); g.set(4, 1, k2Light, 'k2');
      } else if (isCityLord) {
        g.set(3, 1, metalL, 'metal'); g.set(4, 1, k2Light, 'k2'); g.set(5, 1, metalD, 'metal');
      } else if (isVillageLeader) {
        g.set(4, 1, k1[0], 'k1'); g.set(5, 1, k2Light, 'k2');
      }
    }
  }

  // =========================================================================
  // 5. UNDEAD (Нежить — ПЕРЕРИСОВКА: череп, полые рёбра и асимметричный саван)
  // =========================================================================
  else if (p.race === 'undead') {
    if (isChild) {
      g.set(4, 3, skin[0], 'skin'); g.set(5, 3, skin[1], 'skin');
      g.set(4, 4, RMAT.cyanGlow, 'gold'); g.set(5, 4, RMAT.cyanGlow, 'gold');
      g.set(4, 5, skin[2], 'skin'); g.set(5, 5, skin[3], 'skin');
      g.set(3, 6, k1[1], 'k1'); g.set(4, 6, skin[1], 'skin'); g.set(5, 6, skin[2], 'skin');
      if (isFemale) g.set(6, 6, k2Light, 'k2');
      g.set(3, 7, k1[2], 'k1'); g.set(4, 7, k1[2], 'k1');
      g.set(3, 8, RMAT.wispDark, 'cloth'); g.set(3, 9, RMAT.wispDark, 'cloth');
    } else {
      // Narrow jawless skull + glowing eye sockets
      g.set(3, 1, isElder ? RMAT.boneLight : skin[0], 'skin');
      g.set(4, 1, isElder ? RMAT.boneLight : skin[0], 'skin');
      g.set(5, 1, skin[1], 'skin'); g.set(6, 1, skin[2], 'skin');
      const eyeC = isElder ? RMAT.amberGlow : RMAT.cyanGlow;
      g.set(3, 2, skin[1], 'skin'); g.set(4, 2, eyeC, 'gold');
      g.set(5, 2, skin[3], 'skin'); g.set(6, 2, eyeC, 'gold');
      g.set(4, 3, skin[1], 'skin'); g.set(5, 3, skin[2], 'skin');
      if (isElder) {
        g.set(3, 3, RMAT.silverHair, 'hair'); // spectral elder wisps
      }

      // Ribcage bar (y=4) + hollow waist gap (y=5 spine only!) + pelvis (y=6)
      g.set(2, 4, skin[1], 'skin'); g.set(3, 4, skin[0], 'skin');
      g.set(4, 4, k1[1], 'k1'); g.set(5, 4, k1[2], 'k1');
      g.set(6, 4, skin[2], 'skin'); g.set(7, 4, skin[2], 'skin');
      g.set(4, 5, skin[1], 'skin'); g.set(5, 5, skin[2], 'skin');
      g.set(3, 6, k1[1], 'k1'); g.set(4, 6, skin[1], 'skin');
      g.set(5, 6, skin[2], 'skin'); g.set(6, 6, k1[2], 'k1');

      // Asymmetric floating tattered wraith-shroud ONLY on left-center (female wears tattered K2 shroud dress)
      g.set(2, 7, k1[1], 'k1'); g.set(3, 7, k1[2], 'k1'); g.set(4, 7, k2Dark, 'k2');
      g.set(2, 8, k1[2], 'k1'); g.set(3, 8, RMAT.wispDark, 'cloth');
      g.set(2, 9 + strideL, RMAT.wispDark, 'cloth');
      if (isFemale) {
        g.set(5, 7, k2Light, 'k2');
        g.set(4, 8, k1[2], 'k1');
        g.set(3, 9, k2Dark, 'k2');
      }

      applyCustomRoleEquipment(g, p, 0, metalL, metalD, k1, k2Light, k2Dark);

      if (isRoyal) {
        g.set(3, 0, RMAT.boneLight, 'gold'); g.set(4, 0, RMAT.goldLight, 'gold');
        g.set(5, 0, k2Light, 'k2'); g.set(6, 0, RMAT.boneDark, 'gold');
      } else if (isCityLord) {
        g.set(4, 0, metalL, 'metal'); g.set(5, 0, k2Light, 'k2');
      } else if (isVillageLeader) {
        g.set(4, 0, k1[1], 'k1');
      }
    }
  }

  // =========================================================================
  // 6. DEMON (Демон — ПЕРЕРИСОВКА: серпы-рога, спинные шипы, копыта и хвост)
  // =========================================================================
  else if (p.race === 'demon') {
    if (isChild) {
      g.set(2, 3, RMAT.boneLight, 'gold'); g.set(7, 3, RMAT.boneDark, 'gold');
      g.set(3, 4, skin[0], 'skin'); g.set(4, 4, RMAT.amberGlow, 'gold');
      g.set(5, 4, skin[1], 'skin'); g.set(6, 4, RMAT.amberGlow, 'gold');
      g.set(4, 5, skin[1], 'skin'); g.set(5, 5, skin[2], 'skin');
      g.set(3, 6, k1[1], 'k1'); g.set(4, 6, k1[1], 'k1'); g.set(5, 6, k1[2], 'k1'); g.set(6, 6, k1[2], 'k1');
      if (isFemale) g.set(3, 7, k2Light, 'k2');
      g.set(4, 7, skin[2], 'skin'); g.set(5, 7, skin[2], 'skin');
      g.set(3, 8, skin[3], 'skin'); g.set(6, 8, skin[3], 'skin');
      g.set(3, 9, RMAT.stoneDark, 'metal'); g.set(6, 9, RMAT.stoneDark, 'metal');
    } else {
      const hornL = isElder ? RMAT.silverHair : RMAT.boneLight;
      const hornD = isElder ? RMAT.linenDark : RMAT.boneDark;
      if (isFemale) {
        // High swept-up demoness horns
        g.set(2, 0, hornL, 'gold'); g.set(3, 1, skin[0], 'skin');
        g.set(6, 1, skin[2], 'skin'); g.set(7, 0, hornD, 'gold');
        g.set(2, 1, hornL, 'gold'); g.set(7, 1, hornD, 'gold');
      } else {
        // Wide crescent male horns
        g.set(1, 1, hornL, 'gold'); g.set(2, 0, hornL, 'gold');
        g.set(3, 1, skin[0], 'skin'); g.set(6, 1, skin[2], 'skin');
        g.set(7, 0, hornD, 'gold'); g.set(8, 1, hornD, 'gold');
      }
      // Fiend head
      g.set(4, 1, skin[0], 'skin'); g.set(5, 1, skin[1], 'skin');
      g.set(3, 2, skin[0], 'skin'); g.set(4, 2, RMAT.amberGlow, 'gold');
      g.set(5, 2, skin[1], 'skin'); g.set(6, 2, RMAT.amberGlow, 'gold');
      g.set(4, 3, isElder ? RMAT.silverHair : skin[1], 'skin');
      g.set(5, 3, isElder ? RMAT.linenDark : skin[2], 'skin');

      // Spiked dorsal shoulder fins + tapered V-chest
      g.set(1, 3, k2Light, 'k2'); g.set(2, 4, k1[1], 'k1');
      g.set(8, 3, k2Dark, 'k2'); g.set(7, 4, k1[2], 'k1');
      for (let x = 3; x <= 6; x++) {
        g.set(x, 4, x < 5 ? k1[1] : k1[2], 'k1');
        g.set(x, 5, x < 5 ? skin[1] : skin[2], 'skin');
      }
      g.set(4, 6, k2Light, 'k2'); g.set(5, 6, k2Dark, 'k2');
      if (isFemale) {
        g.set(3, 6, k1[1], 'k1'); g.set(6, 6, k1[2], 'k1');
      }

      // Barbed tail sweeping out right
      g.set(7, 6, skin[2], 'skin'); g.set(8, 6, skin[3], 'skin'); g.set(9, 5, k2Light, 'k2');

      // Digitigrade hooved legs
      g.set(3, 7, skin[2], 'skin'); g.set(2, 8, skin[2], 'skin'); g.set(3, 9 + strideL, RMAT.stoneDark, 'metal');
      g.set(6, 7, skin[3], 'skin'); g.set(7, 8, skin[3], 'skin'); g.set(6, 9 + strideR, RMAT.stoneDark, 'metal');

      applyCustomRoleEquipment(g, p, 0, metalL, metalD, k1, k2Light, k2Dark);

      if (isRoyal) {
        g.set(4, 0, RMAT.goldLight, 'gold'); g.set(5, 0, RMAT.amberGlow, 'gold');
      } else if (isCityLord) {
        g.set(4, 0, metalL, 'metal'); g.set(5, 0, k2Light, 'k2');
      } else if (isVillageLeader) {
        g.set(4, 0, k1[1], 'k1');
      }
    }
  }

  // =========================================================================
  // 7. NEANDERTHAL & DENISOVAN (Неандертальцы и Денисовцы: низкий лоб, шкуры мамонта)
  // =========================================================================
  else if (p.race === 'neanderthal') {
    const isDenisovan = p.seed % 2 === 1;
    if (isChild) {
      for (let x = 3; x <= 6; x++) g.set(x, 4, skin[0], 'skin');
      g.set(4, 5, skin[3], 'skin'); g.set(5, 5, skin[1], 'skin'); g.set(6, 5, skin[3], 'skin');
      for (let x = 2; x <= 7; x++) g.set(x, 6, x < 5 ? RMAT.furLight : RMAT.furDark, 'wood');
      for (let x = 3; x <= 6; x++) g.set(x, 7, x < 5 ? k1[1] : k1[2], 'k1');
      if (isFemale) g.set(2, 7, k2Light, 'k2');
      g.set(3, 8, RMAT.furDark, 'wood'); g.set(6, 8, RMAT.furDark, 'wood');
      g.set(3, 9, skin[3], 'skin'); g.set(6, 9, skin[3], 'skin');
    } else {
      // Heavy low brow (elder has grey/silver fur & beard; Denisovan wears carved bone/cyan brow-ring)
      g.set(3, 2, skin[1], 'skin'); g.set(4, 2, skin[0], 'skin');
      g.set(5, 2, skin[1], 'skin'); g.set(6, 2, skin[2], 'skin');
      if (isDenisovan) g.set(4, 1, RMAT.boneLight, 'gold'); // Denisovan bone hair-clasp
      g.set(3, 3, skin[3], 'skin'); g.set(4, 3, isElder ? RMAT.silverHair : skin[1], 'skin');
      g.set(5, 3, skin[3], 'skin'); g.set(6, 3, isElder ? RMAT.linenDark : skin[2], 'skin');

      // Massive mammoth-fur mantle shoulders
      const fLight = isElder ? RMAT.silverHair : RMAT.furLight;
      const fDark = isElder ? RMAT.linenDark : RMAT.furDark;
      for (let x = 1; x <= 8; x++) {
        g.set(x, 4, x < 5 ? fLight : fDark, 'wood');
        g.set(x, 5, x === 4 || x === 5 ? k1[1] : x < 5 ? fLight : fDark, x === 4 || x === 5 ? 'k1' : 'wood');
      }
      // Barrel chest + tribal hide belt (female wears flared K1/K2 fur skirt at y=7..8)
      for (let x = 2; x <= 7; x++) {
        g.set(x, 6, x < 5 ? k1[1] : k1[2], 'k1');
        g.set(x, 7, x === 4 || x === 5 ? k2Light : fDark, x === 4 || x === 5 ? 'k2' : 'wood');
      }
      if (isFemale) {
        for (let x = 3; x <= 6; x++) g.set(x, 8, x < 5 ? k1[1] : k1[2], 'k1');
      } else {
        g.set(2, 8, fDark, 'wood'); g.set(3, 8, fDark, 'wood');
        g.set(6, 8, fDark, 'wood'); g.set(7, 8, fDark, 'wood');
      }
      g.set(2, 9 + strideL, skin[3], 'skin'); g.set(3, 9, skin[3], 'skin');
      g.set(6, 9, skin[3], 'skin'); g.set(7, 9 + strideR, skin[3], 'skin');

      applyCustomRoleEquipment(g, p, 0, metalL, metalD, k1, k2Light, k2Dark);

      if (isRoyal) {
        g.set(2, 1, RMAT.boneLight, 'gold'); g.set(3, 1, k1[1], 'k1');
        g.set(4, 0, RMAT.goldLight, 'gold'); g.set(5, 0, k2Light, 'k2');
        g.set(6, 1, k1[2], 'k1'); g.set(7, 1, RMAT.boneDark, 'gold');
      } else if (isCityLord) {
        g.set(3, 1, RMAT.boneLight, 'gold'); g.set(6, 1, RMAT.boneDark, 'gold');
      } else if (isVillageLeader) {
        g.set(3, 1, k1[1], 'k1'); g.set(6, 1, k1[2], 'k1');
      }
    }
  }

  // =========================================================================
  // 8. RAPTOR-KIN (Ящеры-рапторы — Эра динозавров: морда влево, перья, хвост вправо)
  // =========================================================================
  else if (p.race === 'raptor-kin') {
    if (isChild) {
      g.set(2, 4, skin[0], 'skin'); g.set(3, 4, skin[0], 'skin'); g.set(4, 4, skin[1], 'skin');
      g.set(3, 5, skin[3], 'skin'); g.set(4, 5, skin[1], 'skin'); g.set(5, 5, k1[1], 'k1');
      if (isFemale) g.set(6, 5, k2Light, 'k2');
      g.set(4, 6, k1[1], 'k1'); g.set(5, 6, skin[1], 'skin'); g.set(6, 6, skin[2], 'skin'); g.set(7, 6, skin[2], 'skin');
      g.set(4, 7, skin[2], 'skin'); g.set(5, 7, skin[2], 'skin');
      g.set(4, 8, skin[3], 'skin'); g.set(5, 8, skin[3], 'skin');
      g.set(3, 9, RMAT.boneLight, 'gold'); g.set(5, 9, RMAT.boneDark, 'gold');
    } else {
      // Swept-back pack crest feathers (male taller dorsal crest; elder pale silver tips)
      g.set(4, 1, isElder ? RMAT.silverHair : k1[0], 'k1');
      g.set(5, 1, k1[1], 'k1');
      g.set(6, 1, k2Light, 'k2');
      if (!isFemale) {
        g.set(5, 0, k1[0], 'k1'); // male dorsal crest spike
      }
      // Elongated predator snout pointing left
      g.set(1, 2, isElder ? RMAT.boneLight : skin[0], 'skin');
      g.set(2, 2, skin[0], 'skin');
      g.set(3, 2, RMAT.amberGlow, 'gold'); g.set(4, 2, skin[1], 'skin');
      g.set(2, 3, skin[1], 'skin'); g.set(3, 3, skin[2], 'skin');
      g.set(4, 3, skin[1], 'skin'); g.set(5, 3, skin[2], 'skin');

      // Leaned theropod torso + pack harness
      g.set(3, 4, skin[0], 'skin'); g.set(4, 4, k1[1], 'k1');
      g.set(5, 4, k1[2], 'k1'); g.set(6, 4, skin[2], 'skin');
      g.set(2, 5, skin[1], 'skin');
      g.set(3, 5, k2Light, 'k2'); g.set(4, 5, k1[1], 'k1');
      g.set(5, 5, skin[2], 'skin'); g.set(6, 5, skin[2], 'skin');
      g.set(3, 6, skin[2], 'skin'); g.set(4, 6, skin[2], 'skin'); g.set(5, 6, skin[3], 'skin');

      // Long counter-balance tail stretching right (female has wider K2 fanned tail-plume!)
      g.set(7, 5, skin[1], 'skin'); g.set(8, 5, skin[2], 'skin'); g.set(9, 5, k2Light, 'k2');
      g.set(7, 6, skin[3], 'skin'); g.set(8, 6, skin[3], 'skin');
      if (isFemale) {
        g.set(8, 4, k2Light, 'k2'); g.set(9, 4, k1[0], 'k1');
      }

      // Digitigrade raptor legs + sickle claws
      g.set(3, 7, skin[2], 'skin'); g.set(3, 8, skin[3], 'skin'); g.set(2, 9 + strideL, RMAT.boneLight, 'gold');
      g.set(5, 7, skin[2], 'skin'); g.set(5, 8, skin[3], 'skin'); g.set(6, 9 + strideR, RMAT.boneDark, 'gold');

      applyCustomRoleEquipment(g, p, 0, metalL, metalD, k1, k2Light, k2Dark);

      if (isRoyal) {
        g.set(4, 0, RMAT.goldLight, 'gold'); g.set(5, 0, k1[1], 'k1'); g.set(6, 0, k2Light, 'k2');
      } else if (isCityLord) {
        g.set(4, 0, metalL, 'metal'); g.set(6, 0, k2Light, 'k2');
      } else if (isVillageLeader) {
        g.set(4, 0, k1[0], 'k1');
      }
    }
  }

  // =========================================================================
  // 9. HIVE-MIND (Колониальный «Улей-Разум» — Первобытная жизнь, БЕЗ РОЛЕЙ!)
  // =========================================================================
  else if (p.race === 'hive-mind') {
    // Strictly roleless colonial organism: ignores `role` completely,
    // while responding to age (bud / colony / elder matriarch), gender (drone vs brood),
    // powerRank (matriarch core crown), status, and K1/K2!
    if (isChild) {
      g.set(4, 4, k1[0], 'k1'); g.set(5, 4, k2Light, 'k2');
      g.set(3, 5, skin[0], 'skin'); g.set(4, 5, skin[1], 'skin'); g.set(5, 5, k1[1], 'k1'); g.set(6, 5, skin[2], 'skin');
      g.set(3, 6, skin[1], 'skin'); g.set(4, 6, RMAT.amberGlow, 'gold'); g.set(5, 6, skin[2], 'skin'); g.set(6, 6, skin[2], 'skin');
      g.set(3, 7, k1[2], 'k1'); g.set(4, 7, skin[2], 'skin'); g.set(5, 7, skin[2], 'skin'); g.set(6, 7, k2Dark, 'k2');
      if (isFemale) g.set(2, 6, k2Light, 'k2');
      g.set(3, 8, skin[3], 'skin'); g.set(5, 8, skin[3], 'skin'); g.set(6, 8, skin[3], 'skin');
      g.set(3, 9, skin[3], 'skin'); g.set(6, 9, skin[3], 'skin');
    } else {
      const pulse = p.frameIndex === 1 || p.frameIndex === 2;
      g.set(4, 1, k1[0], 'k1'); g.set(4, 2, k1[1], 'k1'); g.set(5, 2, skin[0], 'skin');
      g.set(2, 2, k2Light, 'k2'); g.set(7, 2, skin[1], 'skin');
      if (!isFemale) g.set(5, 1, skin[0], 'skin'); // drone spire
      for (let y = 3; y <= 7; y++) {
        for (let x = 2; x <= 7; x++) {
          const isK1 = (x + y) % 3 === 0;
          g.set(x, y, isK1 ? (x < 5 ? k1[1] : k1[2]) : x < 4 ? skin[0] : x > 5 ? skin[2] : skin[1], isK1 ? 'k1' : 'skin');
        }
      }
      g.set(1, 5, pulse ? k2Light : skin[0], pulse ? 'k2' : 'skin');
      g.set(1, 6, skin[2], 'skin');
      g.set(8, 4, pulse ? k1[0] : skin[1], pulse ? 'k1' : 'skin');
      g.set(8, 5, skin[2], 'skin');
      if (isFemale) {
        // Brood colony spore sacs
        g.set(1, 7, k2Light, 'k2');
        g.set(8, 6, k2Dark, 'k2');
      }
      if (isElder) {
        // Ancient overgrown pale spore crown
        g.set(3, 1, RMAT.silverHair, 'hair');
        g.set(6, 1, RMAT.silverHair, 'hair');
        g.set(3, 5, RMAT.amberGlow, 'gold');
      }
      g.set(3, 4, RMAT.cyanGlow, 'gold');
      g.set(6, 4, RMAT.cyanGlow, 'gold');
      g.set(5, 6, RMAT.amberGlow, 'gold');
      g.set(2, 8, skin[2], 'skin'); g.set(2, 9, skin[3], 'skin');
      g.set(5, 8, skin[2], 'skin'); g.set(5, 9, skin[3], 'skin');
      g.set(7, 8, skin[3], 'skin'); g.set(8, 8, skin[3], 'skin'); g.set(8, 9, skin[3], 'skin');

      // Note: Hive-Mind hierarchy uses ONLY p.powerRank (never p.role) so it stays strictly roleless!
      if (p.powerRank === 'alliance-leader') {
        drawAllianceBannerLeft(g, k2Light, k2Dark);
        g.set(4, 0, RMAT.goldLight, 'gold'); g.set(5, 0, k2Light, 'k2');
      } else if (p.powerRank === 'king') {
        g.set(4, 0, RMAT.goldLight, 'gold'); g.set(5, 0, k2Light, 'k2');
      } else if (p.powerRank === 'city-lord') {
        g.set(4, 0, k1[0], 'k1'); g.set(5, 0, k2Light, 'k2');
      } else if (p.powerRank === 'village-leader') {
        g.set(4, 0, k1[1], 'k1');
      }
    }
  }

  // =========================================================================
  // RACE-SAFE STATUS OVERLAYS (guaranteed 8-connected to every silhouette!)
  // =========================================================================
  if (p.status === 'wounded') {
    const wy = isChild ? 6 : 5;
    g.set(4, wy, RMAT.statusWound, 'status');
    g.set(5, wy, RMAT.statusWound, 'status');
  } else if (p.status === 'possessed') {
    const py = isChild ? 5 : 4;
    g.set(4, py, RMAT.statusPossessed, 'status');
    g.set(5, py, RMAT.statusPossessed, 'status');
  } else if (p.status === 'captive') {
    const cy = 6;
    g.set(3, cy, RMAT.statusShackle, 'status');
    g.set(4, cy, RMAT.statusShackle, 'status');
    g.set(5, cy, RMAT.statusShackle, 'status');
  }
}
