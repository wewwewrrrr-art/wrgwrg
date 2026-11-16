import { RAMPS } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import {
  ModularHumanoidSpec,
  PixelMatrix,
  UnitAction,
  UnitFrameAnchors,
  UnitMode,
  assembleModularUnitFrame,
  drawAstrolabeHalo,
  drawBatWings,
  drawWavingCape,
} from '../engine/unitAssembler';
import {
  make34Swim,
  make34Walk,
  make36Swim,
  make36Walk,
  make40Swim,
  make40Walk,
} from './humanoidTemplates';
import { PixelModelDef, RenderContextOptions } from './types';

/**
 * ============================================================================
 * HIGH-CRAFT MODULAR HUMANOID UNITS (12 TIERED MODELS, 34×34 TO 40×38)
 * ============================================================================
 * Upgraded multi-layer RPG pixel-art pipeline:
 * - Sculpted 34×34 (Standard), 36×36 (Heavy), and 40×38 (Tier III Boss) grids
 *   with top-left 4-stop shading, specular glints (A), articulated legs/boots,
 *   expressive shaded faces/helmets, and detailed weapons + offhand shields
 * - True 12-frame fluid animation: column-waving capes, articulated wings,
 *   orbiting arcane particles, pulsing runes, and counter-swinging weapon/shield
 * ============================================================================
 */

// ============================================================================
// WEAPONS (DETAILED MULTI-STOP SPRITES, FACING LEFT)
// ============================================================================

const SPEAR_PARTISAN: PixelMatrix = [
  '..A....',
  '.AMI...',
  'AMIk...',
  '.Mkk12.',
  '..T123.',
  '..T.34.',
  '..t....',
  '..T....',
  '..t....',
  '..u....',
  '..u....',
  '..U....',
];

const SWORD_RUNIC: PixelMatrix = [
  '..A...',
  '.AM...',
  '.MIk..',
  '.MaIk.',
  '.MIk..',
  '.MaIk.',
  'GGgGG.',
  '..T...',
  '..t...',
  '..o...',
];

const SCEPTRE_ROYAL: PixelMatrix = [
  '.G.A.G.',
  'GaM1MaG',
  'G1aMa2g',
  '.GgGgG.',
  '..T12..',
  '...g...',
  '...T...',
  '...t...',
  '...u...',
  '...U...',
];

const DAGGER_FANG: PixelMatrix = [
  '.A...',
  'MBI..',
  'Bpk..',
  '.Bik.',
  'GgG..',
  '.t...',
  '.U...',
];

const AXE_BATTLE: PixelMatrix = [
  'AMIk..',
  'AMIIk.',
  'MIIaT.',
  'MIikT.',
  'kk..t.',
  '....T.',
  '....t.',
  '....u.',
  '....U.',
];

const GREAT_CLEAVER: PixelMatrix = [
  '..AMII...',
  '.AMIIIk..',
  'AMII12kk.',
  'MII1a2k..',
  'MIikkkT..',
  'kkkk..t..',
  '......T..',
  '......t..',
  '......u..',
  '......u..',
  '......U..',
];

const SPEAR_NECRO: PixelMatrix = [
  '..I....',
  '.Iik...',
  'Iik....',
  '.k.B12.',
  '..T234.',
  '..t.4..',
  '..u....',
  '..T....',
  '..u....',
  '..U....',
];

const STAFF_ARCANE: PixelMatrix = [
  '..aAa..',
  '.a1M1a.',
  '.12B23.',
  '..gqg..',
  '...k...',
  '...T...',
  '...t...',
  '...T...',
  '...u...',
  '...U...',
];

const STAFF_LICH: PixelMatrix = [
  'a..A..a',
  'Ga1M1aG',
  '.g2B2g.',
  '.gqpqg.',
  '...k...',
  '..iTi..',
  '...t...',
  '...T...',
  '...u...',
  '...U...',
];

const BOW_YEW: PixelMatrix = [
  '...Tu..',
  '..T..M.',
  '.T..aMI',
  'T..22.k',
  't..3..k',
  '.T....i',
  '..t..u.',
  '...Uu..',
];

const HALBERD_FROST: PixelMatrix = [
  '..A....',
  '.CQM...',
  'CQQaIk.',
  'QNaIk..',
  'X..T...',
  '...t...',
  '...T...',
  '...t...',
  '...u...',
  '...U...',
];

const TRIDENT_LAVA: PixelMatrix = [
  'L..A..L',
  'Ll.M.lL',
  'LlkIkll',
  '.kGkGk.',
  '...k...',
  '...t...',
  '...u...',
  '...U...',
];

const HAMMER_RUNIC: PixelMatrix = [
  'AMMIk.',
  'MIIaKk',
  'iiaaKk',
  'kkkkK.',
  '..T...',
  '..t...',
  '..u...',
  '..U...',
];

// ============================================================================
// HEADS (SCULPTED 9×8 – 11×9 SPRITES, FACING LEFT)
// ============================================================================

const HEAD_PEASANT: PixelMatrix = [
  '...PPPPPP..',
  '..PP1221PP.',
  '.PPPPPPPPPP',
  '..SSSDSSz..',
  '..SRRsRzz..',
  '.RRRRRrR...',
  '..RRrRr....',
  '...rRr.....',
];

const HEAD_WARRIOR: PixelMatrix = [
  '...11121...',
  '..AMIIIIk..',
  '.MII1a2Ik..',
  '.MIIKAKIk..',
  '.MIssDSzk..',
  '..IskKsk...',
  '...IkKk....',
];

const HEAD_KING: PixelMatrix = [
  '.G.G.A.G.G.',
  'GaaG1G1GaaG',
  'GGGGgGgGgGg',
  '.SSSDSSSDz.',
  '.AMSSSSMz..',
  '..MIIsIzk..',
  '...IIkk....',
];

const HEAD_GOBLIN: PixelMatrix = [
  '...11221...',
  '..122a231..',
  'SS22LssL2z.',
  '.ssDszzsz..',
  '..sBssBz...',
  '...zzzzZ...',
  '....ZZZ....',
];

const HEAD_ORC: PixelMatrix = [
  '...h12h....',
  '..sssszz...',
  '.sLszzDzz..',
  '.sBsszzBzz.',
  '..zzzzzZZ..',
  '...ZZZZZ...',
];

const HEAD_WARLORD: PixelMatrix = [
  'B.........B',
  'Bp..1a2..pB',
  '.BOOVVVVOO.',
  '.ssLssDzss.',
  'BsszsszzBzz',
  '.OOzzzzzOO.',
  '..VVVVVVV..',
];

const HEAD_SKELETON: PixelMatrix = [
  '...BBBBp...',
  '..BBBBppp..',
  '.B11B11Bpq.',
  '.BDDpDDqq..',
  '..BBpBpqq..',
  '...qpqpq...',
];

const HEAD_NECRO: PixelMatrix = [
  '...21112...',
  '..212a232..',
  '.32DDKDD33.',
  '.3KaaKaa23.',
  '..4BqpqB4..',
  '...44q44...',
];

const HEAD_LICH: PixelMatrix = [
  '.G.G1A1G.G.',
  'Ga2B2a2B2aG',
  '.2B1B1B1B3.',
  '.2BDpDpDB3.',
  '..pqpqpqq..',
  '...qqqqq...',
];

const HEAD_RANGER: PixelMatrix = [
  '...f111f...',
  '..f22a2ef..',
  '.ffSDSSzE..',
  '.f122322e..',
  '..233433...',
];

const HEAD_FROST: PixelMatrix = [
  'C...111...C',
  'Q..AMIIk..N',
  '.QMIIa2IkN.',
  '.MIaCCCaIk.',
  '..IsSDskk..',
  '...kKkk....',
];

const HEAD_IMP: PixelMatrix = [
  'B.......B.',
  '.p..h..p..',
  '.sssszzs..',
  'sLssDzZzz.',
  '.BsszBzz..',
  '..zzzzZ...',
];

const HEAD_GOLEM: PixelMatrix = [
  'G....G.',
  '.MIIIk.',
  'MIaaIk.',
  'MaKKaK.',
  '.iKKk..',
  '..kkk..',
];

// ============================================================================
// OFFHAND & BACK MODULES
// ============================================================================

const SHIELD_BUCKLER: PixelMatrix = [
  '..iIi..',
  '.IT1tK.',
  'ITGagTK',
  'it23tuk',
  '.itukK.',
  '..kkk..',
];

const SHIELD_KITE: PixelMatrix = [
  'MMI1aIk.',
  'M112a2k.',
  'IaaaaaaK',
  'i223a3kK',
  '.i34a4k.',
  '..k44k..',
  '...kk...',
];

const SHIELD_ROYAL: PixelMatrix = [
  'GG11a1G.',
  'G1aGa2Gk',
  'GaGGGagk',
  'g2aGa3gK',
  '.g3443k.',
  '..g44k..',
  '...gg...',
];

const OFFHAND_VIAL: PixelMatrix = [
  '.B..',
  'iCi.',
  'FFAF',
  'fEfE',
];

const SHIELD_ORC: PixelMatrix = [
  '.i.B.i.',
  'BT1a1tK',
  'it2B2uk',
  'Ktu3uBK',
  '.ikkkK.',
];

const SHIELD_WARLORD: PixelMatrix = [
  'i..B..i',
  'O1a1a1K',
  'O2BGB2K',
  'V3a3a3K',
  '.VkVkV.',
];

const SHIELD_BONE: PixelMatrix = [
  '.BBpi..',
  'Bp12pk.',
  'pq23qk.',
  '.qqkk..',
];

const OFFHAND_GRIMOIRE: PixelMatrix = [
  '1BBB1',
  '2BaB2',
  '3a2a4',
  '.kkk.',
];

const OFFHAND_SOULORB: PixelMatrix = [
  '.CA.',
  'CaQC',
  'aNaQ',
  '.XX.',
];

const OFFHAND_KNIFE: PixelMatrix = [
  'AM.',
  'Ik.',
  't..',
];

const SHIELD_FROST: PixelMatrix = [
  'CM11aC.',
  'CQa2aQk',
  'QaCCCaK',
  'NQ3a3Nk',
  '.NXaXk.',
  '..XXX..',
];

const OFFHAND_EMBER: PixelMatrix = [
  '.LA.',
  'LlLl',
  '.rl.',
];

const BACK_QUIVER_DENSE: PixelMatrix = [
  '...B1a.',
  '...BT1.',
  '..Ttu2.',
  '..tuuU.',
  '...uU..',
];

const BACK_ORC_TROPHY: PixelMatrix = [
  'B....B',
  'p.12.p',
  '.T23T.',
  '.t34u.',
];

const BACK_WARLORD_RACK: PixelMatrix = [
  'B..11..B',
  'p..22..p',
  'B.1331.B',
  '..J44j..',
  '..jjjj..',
];

// ============================================================================
// 12 SCULPTED HUMANOID SPECS
// ============================================================================

// 1. Ополченец Цитадели (34×34, Tier I) — sturdy bearded villager-militiaman
const PEASANT_SPEC: ModularHumanoidSpec = {
  width: 34,
  height: 34,
  walkFrames: make34Walk(
    [
      '...SS1122211zz..',
      '..SS11u222u33zz.',
      '..ss11u2a2u33zz.',
      '...ss1u222u34z..',
      '...zzTuuGGuuTzz.',
      '....223344334...',
      '....233444334...',
      '....3344..444...',
      '....344....44...',
    ],
    'T',
    't',
    'U'
  ),
  swimFrames: make34Swim([
    '...SS1122211zz..',
    '..SS11u222u33zz.',
    '..ss11u2a2u33zz.',
    '...zzTuuGGuuTzz.',
    '....223344334...',
  ]),
  head: { matrix: HEAD_PEASANT, offsetX: -4, offsetY: -7 },
  item: { matrix: SPEAR_PARTISAN, offsetX: -4, offsetY: -8 },
  offhand: { matrix: SHIELD_BUCKLER, offsetX: 11, offsetY: 1 },
  weaponSwing: { ampX: 1.0, ampY: 0.9 },
  offhandSwing: { ampY: 0.7 },
  shadowWidth: 11,
};

// 2. Рыцарь Цитадели (36×36, Tier II) — full plate paladin with billowing cape & kite shield
const PALADIN_SPEC: ModularHumanoidSpec = {
  width: 36,
  height: 36,
  walkFrames: make36Walk(
    [
      '..GGM1122211Ikk...',
      '.GMII11a22b33ikk..',
      '.MIii122GG344kkK..',
      '..Sii1234434kkK...',
      '..zzik23aa43kK....',
      '...ki1234434kk....',
      '...k223344334k....',
      '...i3344..443k....',
      '...iIkK....kKK....',
      '...iIkK....kKK....',
    ],
    'M',
    'i',
    'K'
  ),
  swimFrames: make36Swim([
    '..GGM1122211Ikk...',
    '.GMII11a22b33ikk..',
    '.MIii122GG344kkK..',
    '..Sii1234434kkK...',
    '...ki1234434kk....',
  ]),
  head: { matrix: HEAD_WARRIOR, offsetX: -4, offsetY: -6 },
  item: { matrix: SWORD_RUNIC, offsetX: -4, offsetY: -7 },
  offhand: { matrix: SHIELD_KITE, offsetX: 12, offsetY: 1 },
  onBackSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawWavingCape(buf, ox + 9, oy + 1, 6, 10, t, true, RAMPS.gold.mid);
  },
  weaponSwing: { ampX: 1.1, ampY: 0.9 },
  offhandSwing: { ampY: 0.8 },
  shadowWidth: 13,
};

// 3. Король Фракции (40×38, Tier III Boss) — sweeping ermine cloak, gilded armor & crown
const KING_SPEC: ModularHumanoidSpec = {
  width: 40,
  height: 38,
  walkFrames: make40Walk(
    [
      '...GGG11222211GGG...',
      '..Ggg11a1222b33ggo..',
      '.SSg11222aGa3444gzz.',
      '.ssg122334444344gzz.',
      '..zzGG2234a434GGzz..',
      '...gg2234444344oo...',
      '...JJ2334a2b434JJ...',
      '...jj3344444434jj...',
      '...IIk344..444kKk...',
      '...IIk......kKKk....',
      '...IIk......kKKk....',
    ],
    'G',
    'o',
    'K'
  ),
  swimFrames: make40Swim([
    '...GGG11222211GGG...',
    '..Ggg11a1222b33ggo..',
    '.SSg11222aGa3444gzz.',
    '.ssg122334444344gzz.',
    '..zzGG2234a434GGzz..',
    '...gg2234444344oo...',
  ]),
  head: { matrix: HEAD_KING, offsetX: -4, offsetY: -6 },
  item: { matrix: SCEPTRE_ROYAL, offsetX: -4, offsetY: -7 },
  offhand: { matrix: SHIELD_ROYAL, offsetX: 13, offsetY: 2 },
  onBackSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawWavingCape(buf, ox + 11, oy + 1, 7, 12, t, true, RAMPS.sail.highlight);
  },
  weaponSwing: { ampX: 0.9, ampY: 0.8 },
  offhandSwing: { ampY: 0.7 },
  shadowWidth: 15,
};

// 4. Гоблин-Разведчик (34×34, Tier I) — hunched agile scout with quiver, poison vial & glint
const GOBLIN_SPEC: ModularHumanoidSpec = {
  width: 34,
  height: 34,
  walkFrames: make34Walk(
    [
      '..SST112211uSS..',
      '.ssT1t22a23uZzZ.',
      '.zz11ut343tuZ...',
      '..z123tGGt34z...',
      '...23344434z....',
      '...234...44z....',
      '...z3.....4z....',
      '...zZ.....ZZ....',
      '...zZ.....ZZ....',
    ],
    't',
    'u',
    'U'
  ),
  swimFrames: make34Swim([
    '..SST112211uSS..',
    '.ssT1t22a23uZzZ.',
    '.zz11ut343tuZ...',
    '..z123tGGt34z...',
    '...23344434z....',
  ]),
  head: { matrix: HEAD_GOBLIN, offsetX: -4, offsetY: -6 },
  item: { matrix: DAGGER_FANG, offsetX: -3, offsetY: -4 },
  back: { matrix: BACK_QUIVER_DENSE, offsetX: 9, offsetY: 0 },
  offhand: { matrix: OFFHAND_VIAL, offsetX: 12, offsetY: 2 },
  onFrontSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    if (Math.sin(t) > 0.3) {
      buf.setPixel(ox + 13, oy + 1 - (frame % 3), RAMPS.moss.highlight);
    }
  },
  weaponSwing: { ampX: 1.2, ampY: 1.0 },
  offhandSwing: { ampY: 0.9 },
  shadowWidth: 11,
};

// 5. Воин Орды (36×36, Tier II) — muscular berserker with warpaint, bone pauldron & double axe
const ORC_SPEC: ModularHumanoidSpec = {
  width: 36,
  height: 36,
  walkFrames: make36Walk(
    [
      '..SSS1122BBppB....',
      '.SSssSa22bBBpqq...',
      '.sszz122GG34zzZZ..',
      '..zzzTT3443ttZZ...',
      '...zz1234434zz....',
      '...zz234..44zz....',
      '...tt34....4tt....',
      '...zz4......zz....',
      '...zzZ......ZZ....',
      '...ZZZ......ZZ....',
    ],
    't',
    'u',
    'U'
  ),
  swimFrames: make36Swim([
    '..SSS1122BBppB....',
    '.SSssSa22bBBpqq...',
    '.sszz122GG34zzZZ..',
    '..zzzTT3443ttZZ...',
    '...zz1234434zz....',
  ]),
  head: { matrix: HEAD_ORC, offsetX: -4, offsetY: -5 },
  item: { matrix: AXE_BATTLE, offsetX: -4, offsetY: -6 },
  back: { matrix: BACK_ORC_TROPHY, offsetX: 11, offsetY: -1 },
  offhand: { matrix: SHIELD_ORC, offsetX: 12, offsetY: 2 },
  weaponSwing: { ampX: 1.1, ampY: 1.0 },
  offhandSwing: { ampY: 0.7 },
  shadowWidth: 13,
};

// 6. Вождь Орды (40×38, Tier III Boss) — hulking warlord with skull rack, obsidian plates & cleaver
const WARLORD_SPEC: ModularHumanoidSpec = {
  width: 40,
  height: 38,
  walkFrames: make40Walk(
    [
      '..BB11OOO22OOO11BB..',
      '.SS112O11aa11O34zz..',
      '.sszz212BBBB234zzZZ.',
      '.szzzOO344443OOzzZZ.',
      '..zzzTT12BBGG23ttZ..',
      '...zz1234444334zz...',
      '...zz234....444zz...',
      '...zz34......44zz...',
      '...zkk........kkz...',
      '...kKK........KKK...',
      '...kKK........KKK...',
    ],
    'O',
    'V',
    'K'
  ),
  swimFrames: make40Swim([
    '..BB11OOO22OOO11BB..',
    '.SS112O11aa11O34zz..',
    '.sszz212BBBB234zzZZ.',
    '.szzzOO344443OOzzZZ.',
    '..zzzTT12BBGG23ttZ..',
    '...zz1234444334zz...',
  ]),
  head: { matrix: HEAD_WARLORD, offsetX: -4, offsetY: -6 },
  item: { matrix: GREAT_CLEAVER, offsetX: -5, offsetY: -8 },
  back: { matrix: BACK_WARLORD_RACK, offsetX: 12, offsetY: -2 },
  offhand: { matrix: SHIELD_WARLORD, offsetX: 13, offsetY: 2 },
  onBackSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawWavingCape(buf, ox + 12, oy + 2, 5, 11, t, true, RAMPS.bone.mid);
  },
  weaponSwing: { ampX: 1.0, ampY: 0.9 },
  offhandSwing: { ampY: 0.8 },
  shadowWidth: 16,
};

// 7. Скелет-Копейщик (34×34, Tier I) — sculpted anatomical ribcage, tattered cloak & bone shield
const SKELETON_SPEC: ModularHumanoidSpec = {
  width: 34,
  height: 34,
  walkFrames: make34Walk(
    [
      '...BBBppKBBpp...',
      '..pBBKBBpBBKqq..',
      '.B.BBKKBBpp.qq..',
      '...pBKBBpKq.....',
      '...112aa234.....',
      '...22344434.....',
      '....pK..Kq......',
      '....pK..Kq......',
      '....qq..qq......',
    ],
    'B',
    'p',
    'q'
  ),
  swimFrames: make34Swim([
    '...BBBppKBBpp...',
    '..pBBKBBpBBKqq..',
    '.B.BBKKBBpp.qq..',
    '...112aa234.....',
    '...22344434.....',
  ]),
  head: { matrix: HEAD_SKELETON, offsetX: -4, offsetY: -5 },
  item: { matrix: SPEAR_NECRO, offsetX: -4, offsetY: -7 },
  offhand: { matrix: SHIELD_BONE, offsetX: 11, offsetY: 1 },
  onBackSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawWavingCape(buf, ox + 10, oy + 1, 4, 9, t, true);
  },
  weaponSwing: { ampX: 1.0, ampY: 0.8 },
  offhandSwing: { ampY: 0.6 },
  shadowWidth: 10,
};

// 8. Некромант (36×36, Tier II) — pleated K1/K2 robes, arcane rune aura & chained grimoire
const NECRO_SPEC: ModularHumanoidSpec = {
  width: 36,
  height: 36,
  walkFrames: make36Walk(
    [
      '..21112BB2B2112...',
      '.221aa2ppKp2bb33..',
      'pp223444aa44344p..',
      '.33344322234433...',
      '..344aa44bb443....',
      '..344344443443....',
      '..4434....4344....',
      '...434....434.....',
      '...4q4....4q4.....',
      '...VVV....VVV.....',
    ],
    '4',
    'V',
    'K'
  ),
  swimFrames: make36Swim([
    '..21112BB2B2112...',
    '.221aa2ppKp2bb33..',
    'pp223444aa44344p..',
    '.33344322234433...',
    '..344aa44bb443....',
  ]),
  head: { matrix: HEAD_NECRO, offsetX: -4, offsetY: -5 },
  item: { matrix: STAFF_ARCANE, offsetX: -4, offsetY: -7 },
  offhand: { matrix: OFFHAND_GRIMOIRE, offsetX: 12, offsetY: 2 },
  onBackSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawWavingCape(buf, ox + 10, oy + 1, 5, 10, t, true, RAMPS.cyanMask.mid);
  },
  onFrontSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const orbX = ox + 13 + Math.round(Math.cos(t) * 1.5);
    const orbY = oy + Math.round(Math.sin(t) * 1.5);
    buf.setPixel(orbX, orbY, RAMPS.cyanMask.highlight);
  },
  weaponSwing: { ampX: 0.8, ampY: 0.9 },
  offhandSwing: { ampY: 0.9 },
  shadowWidth: 12,
};

// 9. Верховный Лич (40×38, Tier III Boss) — hovering archmage with bone-rune halo & phylactery
const LICH_HOVER_BODY_ROWS = [
  '...GG1122BaaB2211GG.',
  '..23222BppKpB222344.',
  '.pp322aa4GG1GG4bb34q',
  '..33444322aa2344434.',
  '...344344444443443..',
  '...44334a....a4334..',
  '....4334..aa..4334..',
  '....443...44...344..',
  '.....44........44...',
  '.....4..........4...',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
] as const;

const LICH_WALK_FRAMES: { body: PixelMatrix; anchors: UnitFrameAnchors }[] = [0, 1, 2, 3].map(
  (step) => {
    const bob = step === 0 ? 0 : step === 2 ? -2 : -1;
    const hemRows =
      step % 2 === 0
        ? [
            '.....44........44...',
            '.....4..........4...',
            '....................',
            '....................',
            '....................',
          ]
        : [
            '....44...44...44....',
            '....4..........4....',
            '....................',
            '....................',
            '....................',
          ];
    return {
      body: [...LICH_HOVER_BODY_ROWS.slice(0, 10), ...hemRows],
      anchors: {
        head: { x: 19, y: 19 + bob, w: 2, h: 2 },
        item: { x: 9, y: 22 + bob, w: 1, h: 3 },
        pivot: { x: 20, y: 34 },
        bodyOffsetY: bob,
      },
    };
  }
);

const LICH_SPEC: ModularHumanoidSpec = {
  width: 40,
  height: 38,
  walkFrames: LICH_WALK_FRAMES,
  swimFrames: make40Swim([
    '...GG1122BaaB2211GG.',
    '..23222BppKpB222344.',
    '.pp322aa4GG1GG4bb34q',
    '..33444322aa2344434.',
    '...344344444443443..',
    '...44334a....a4334..',
  ]),
  head: { matrix: HEAD_LICH, offsetX: -4, offsetY: -5 },
  item: { matrix: STAFF_LICH, offsetX: -4, offsetY: -8 },
  offhand: { matrix: OFFHAND_SOULORB, offsetX: 15, offsetY: 1 },
  onBackSculpt: (buf, frame, total, ox, oy) => {
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawAstrolabeHalo(buf, ox + 10, oy + 1, 8.5, t, RAMPS.bone.mid, RAMPS.cyanMask.highlight);
    drawWavingCape(buf, ox + 11, oy + 2, 5, 11, t, true, RAMPS.cyanMask.mid);
  },
  onFrontSculpt: (buf, frame, total, ox, oy, mode) => {
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const fx = ox + 10 + Math.round(Math.cos(t * 2) * 5.5);
    const fy = oy + 6 + Math.round(Math.sin(t * 2) * 2.5);
    if (mode !== 'swim') {
      buf.setPixel(fx, fy, RAMPS.cyanMask.highlight);
      buf.setPixel(fx + 1, fy, '#FFFFFF');
    }
  },
  weaponSwing: { ampX: 0.6, ampY: 1.0 },
  offhandSwing: { ampY: 1.2 },
  shadowWidth: 14,
};

// 10. Следопыт Круга (34×34, Tier I) — hooded woodland sniper with quiver, recurve bow & cloak
const RANGER_SPEC: ModularHumanoidSpec = {
  width: 34,
  height: 34,
  walkFrames: make34Walk(
    [
      '..FFf112211eFF..',
      '.ssftt22a23eezz.',
      '.zzf11tGG34Ezz..',
      '..ee223t443EE...',
      '..112344434E....',
      '..2334...44E....',
      '...Ttu...utT....',
      '...Ttu...utT....',
      '...UUU...UUU....',
    ],
    'T',
    't',
    'U'
  ),
  swimFrames: make34Swim([
    '..FFf112211eFF..',
    '.ssftt22a23eezz.',
    '.zzf11tGG34Ezz..',
    '..ee223t443EE...',
    '..112344434E....',
  ]),
  head: { matrix: HEAD_RANGER, offsetX: -4, offsetY: -4 },
  item: { matrix: BOW_YEW, offsetX: -4, offsetY: -5 },
  back: { matrix: BACK_QUIVER_DENSE, offsetX: 9, offsetY: -1 },
  offhand: { matrix: OFFHAND_KNIFE, offsetX: 12, offsetY: 4 },
  onBackSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawWavingCape(buf, ox + 10, oy + 1, 5, 9, t, true, RAMPS.moss.highlight);
  },
  weaponSwing: { ampX: 0.9, ampY: 0.8 },
  offhandSwing: { ampY: 0.7 },
  shadowWidth: 11,
};

// 11. Страж Мороза (36×36, Tier II) — crystal glacier pauldron, frost helm, prism shield & cape
const FROST_SPEC: ModularHumanoidSpec = {
  width: 36,
  height: 36,
  walkFrames: make36Walk(
    [
      '.CCC1122211MQNN...',
      'CCQI11a22b33NXX...',
      'sMIii12aa344kNN...',
      '.zzJJ234434kkJ....',
      '..QQ123aa43NN.....',
      '..i223344334k.....',
      '..Q3344..443N.....',
      '..iQkK....kNX.....',
      '..QIkK....kXX.....',
      '..XXX......XX.....',
    ],
    'Q',
    'N',
    'X'
  ),
  swimFrames: make36Swim([
    '.CCC1122211MQNN...',
    'CCQI11a22b33NXX...',
    'sMIii12aa344kNN...',
    '.zzJJ234434kkJ....',
    '..QQ123aa43NN.....',
  ]),
  head: { matrix: HEAD_FROST, offsetX: -4, offsetY: -5 },
  item: { matrix: HALBERD_FROST, offsetX: -4, offsetY: -7 },
  offhand: { matrix: SHIELD_FROST, offsetX: 12, offsetY: 1 },
  onBackSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawWavingCape(buf, ox + 10, oy + 1, 6, 10, t, true, RAMPS.ice.highlight);
  },
  weaponSwing: { ampX: 1.0, ampY: 0.8 },
  offhandSwing: { ampY: 0.7 },
  shadowWidth: 13,
};

// 12. Огненный Бес (34×34, Tier I) — flapping bat wings, spiked tail, magma trident & embers
const IMP_SPEC: ModularHumanoidSpec = {
  width: 34,
  height: 34,
  walkFrames: make34Walk(
    [
      '..OO1SS22ssOO...',
      '.SSs1Ls2a3zzZO..',
      '.zzzO12343OzzZ..',
      '..zzV23443Vzz...',
      '...z1234432z....',
      '...zz3....3z....',
      '...zz......z....',
      '...KK......K....',
      '...KK......K....',
    ],
    'z',
    'Z',
    'K'
  ),
  swimFrames: make34Swim([
    '..OO1SS22ssOO...',
    '.SSs1Ls2a3zzZO..',
    '.zzzO12343OzzZ..',
    '..zzV23443Vzz...',
    '...z1234432z....',
  ]),
  head: { matrix: HEAD_IMP, offsetX: -4, offsetY: -5 },
  item: { matrix: TRIDENT_LAVA, offsetX: -4, offsetY: -7 },
  offhand: { matrix: OFFHAND_EMBER, offsetX: 12, offsetY: 1 },
  onBackSculpt: (buf, frame, total, ox, oy) => {
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawBatWings(buf, ox + 9, oy + 3, 9, t);
    // Swishing barbed tail
    for (let i = 0; i < 6; i++) {
      const tx = ox + 12 + i;
      const ty = oy + 6 + Math.round(Math.sin(t - i * 0.5) * 1.4 - i * 0.3);
      buf.setPixel(tx, ty, i === 5 ? RAMPS.lava.highlight : RAMPS.obsidian.mid);
    }
  },
  weaponSwing: { ampX: 1.1, ampY: 1.1 },
  offhandSwing: { ampY: 1.0 },
  shadowWidth: 11,
};

// Shared Runic Golem (30×28, used by `iron-golem` in creatures.ts)
const GOLEM_WALK_BODIES: { body: PixelMatrix; anchors: UnitFrameAnchors }[] = [
  {
    body: [
      '.MI112211Ik...',
      'MII1a2a23kk...',
      'Iii12aa34kK...',
      'sik23443kKk...',
      '.ziI3443kK....',
      '..iIk..kkK....',
      '..kkk..KKK....',
    ],
    anchors: {
      head: { x: 14, y: 15, w: 2, h: 2 },
      item: { x: 9, y: 17, w: 1, h: 3 },
      pivot: { x: 15, y: 23 },
      bodyOffsetY: 0,
    },
  },
  {
    body: [
      '.MI112211Ik...',
      'MII1a2a23kk...',
      'Iii12aa34kK...',
      'sik23443kKk...',
      '.ziI3443kK....',
      '.iIk....kkK...',
      '.KKK.....kkk..',
    ],
    anchors: {
      head: { x: 14, y: 14, w: 2, h: 2 },
      item: { x: 9, y: 16, w: 1, h: 3 },
      pivot: { x: 15, y: 23 },
      bodyOffsetY: -1,
    },
  },
  {
    body: [
      '.MI112211Ik...',
      'MII1a2a23kk...',
      'Iii12aa34kK...',
      'sik23443kKk...',
      '.ziI3443kK....',
      '...iIkkkK.....',
      '...KKKKKK.....',
    ],
    anchors: {
      head: { x: 14, y: 15, w: 2, h: 2 },
      item: { x: 9, y: 17, w: 1, h: 3 },
      pivot: { x: 15, y: 23 },
      bodyOffsetY: 0,
    },
  },
  {
    body: [
      '.MI112211Ik...',
      'MII1a2a23kk...',
      'Iii12aa34kK...',
      'sik23443kKk...',
      '.ziI3443kK....',
      '..iIk..kkkK...',
      '..kkk..KKK....',
    ],
    anchors: {
      head: { x: 14, y: 14, w: 2, h: 2 },
      item: { x: 9, y: 16, w: 1, h: 3 },
      pivot: { x: 15, y: 23 },
      bodyOffsetY: -1,
    },
  },
];

const GOLEM_SWIM_BODIES: { body: PixelMatrix; anchors: UnitFrameAnchors }[] = [
  {
    body: [
      '.MI112211Ik...',
      'MII1a2a23kk...',
      'Iii12aa34kK...',
      'WwWwWwWwWwWwWw',
      '.wWwWwWwWwWwW.',
    ],
    anchors: {
      head: { x: 14, y: 18, w: 2, h: 2 },
      item: { x: 9, y: 19, w: 1, h: 3 },
      pivot: { x: 15, y: 23 },
      bodyOffsetY: 0,
    },
  },
  {
    body: [
      '.MI112211Ik...',
      'MII1a2a23kk...',
      'Iii12aa34kK...',
      'wWwWwWwWwWwWwW',
      '.WwWwWwWwWwWw.',
    ],
    anchors: {
      head: { x: 14, y: 17, w: 2, h: 2 },
      item: { x: 9, y: 18, w: 1, h: 3 },
      pivot: { x: 15, y: 23 },
      bodyOffsetY: -1,
    },
  },
  {
    body: [
      '.MI112211Ik...',
      'MII1a2a23kk...',
      'Iii12aa34kK...',
      'WWwwWWwwWWwwWW',
      '.wwWWwwWWwwWW.',
    ],
    anchors: {
      head: { x: 14, y: 18, w: 2, h: 2 },
      item: { x: 9, y: 19, w: 1, h: 3 },
      pivot: { x: 15, y: 23 },
      bodyOffsetY: 0,
    },
  },
  {
    body: [
      '.MI112211Ik...',
      'MII1a2a23kk...',
      'Iii12aa34kK...',
      'wWWwwWWwwWWwwW',
      '.WWwwWWwwWWww.',
    ],
    anchors: {
      head: { x: 14, y: 19, w: 2, h: 2 },
      item: { x: 9, y: 20, w: 1, h: 3 },
      pivot: { x: 15, y: 23 },
      bodyOffsetY: 1,
    },
  },
];

export const GOLEM_SPEC: ModularHumanoidSpec = {
  width: 30,
  height: 28,
  walkFrames: GOLEM_WALK_BODIES,
  swimFrames: GOLEM_SWIM_BODIES,
  head: { matrix: HEAD_GOLEM, offsetX: -3, offsetY: -3 },
  item: { matrix: HAMMER_RUNIC, offsetX: -3, offsetY: -4 },
  offhand: { matrix: SHIELD_WARLORD, offsetX: 9, offsetY: 1 },
  onFrontSculpt: (buf, frame, total, ox, oy) => {
    const pulse = Math.sin((frame / Math.max(1, total)) * Math.PI * 2);
    if (pulse > 0.2) {
      buf.setPixel(ox + 6, oy + 2, '#FFFFFF');
    }
  },
  weaponSwing: { ampX: 0.8, ampY: 0.7 },
  offhandSwing: { ampY: 0.6 },
  shadowWidth: 12,
};

export function renderUnitFromSpec(
  spec: ModularHumanoidSpec,
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): { buffer: PixelBuffer; anchors: UnitFrameAnchors } {
  const mode: UnitMode = ctx?.unitMode ?? 'walk';
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  return assembleModularUnitFrame(spec, frame, total, mode, action, ctx?.showShadow !== false);
}

export const MODULAR_UNIT_MODELS: PixelModelDef[] = [
  {
    id: 'peasant-militia',
    name: 'Ополченец Цитадели',
    subtitle: 'Бородатый ополченец с протазаном (34×34)',
    kind: 'unit',
    tier: 'I',
    faction: 'Цитадель',
    width: 34,
    height: 34,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '20×23 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_light',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 11,
    },
    layersSpec: [
      '0. Тень unitShadow_11 (#11102B 40%) под pivot',
      '1. Безголовое тело walk_0..3 / swim_0..3 с подтяжками и пряжкой',
      '2. Широкополая шляпа и густая окладистая борода (headAnchor)',
      '3. Плавный замах протазана K1 (itemAnchor) и круглый баклер',
    ],
    description:
      'Юнит уровня I (34×34 px): рельефный ополченец в соломенной шляпе с густой трёхтоновой бородой, кожаными подтяжками, пряжкой, стальным протазаном и баклером.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(PEASANT_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(PEASANT_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderPeasantMilitia(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(PEASANT_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'paladin-knight',
    name: 'Рыцарь Цитадели',
    subtitle: 'Латный паладин с плащом и щитом (36×36)',
    kind: 'unit',
    tier: 'II',
    faction: 'Цитадель',
    width: 36,
    height: 36,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '23×25 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_light',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 13,
    },
    layersSpec: [
      '0. Тень unitShadow_13 (#11102B 40%) под точкой pivot',
      '1. Волнообразный 12-кадровый плащ K1 с золотой каймой',
      '2. Стальные латы walk_0..3 / swim_0..3 с масками K1, K2 и SKIN',
      '3. Забрало с султаном K1 (headAnchor), рунный меч и каплевидный щит',
    ],
    description:
      'Эталон модульного воина уровня II (36×36 px): плавно развевающийся 12-кадровый плащ с золотой каймой, золочёные наплечники, качающийся рунный меч и щит K1/K2.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(PALADIN_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(PALADIN_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderPaladinKnight(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(PALADIN_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'faction-king',
    name: 'Король Фракции',
    subtitle: 'Монарх в горностаевой мантии со щитом (40×38)',
    kind: 'unit',
    tier: 'III',
    faction: 'Цитадель',
    width: 40,
    height: 38,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '26×27 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_light',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 15,
    },
    layersSpec: [
      '0. Тень unitShadow_15 под pivot',
      '1. Широкая 12-кадровая горностаевая мантия K1',
      '2. Чеканная золотая кираса, поножи и седая борода',
      '3. Трёхзубчатая корона, царский скипетр и львиный щит',
    ],
    description:
      'Величественный правитель уровня III (40×38 px): волнующаяся горностаевая мантия, позолоченный доспех, корона с самоцветами K2, скипетр и щит.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(KING_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(KING_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderFactionKing(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(KING_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'goblin-scout',
    name: 'Гоблин-Разведчик',
    subtitle: 'Ловкий лазутчик с колчаном и ядом (34×34)',
    kind: 'unit',
    tier: 'I',
    faction: 'Орда',
    width: 34,
    height: 34,
    frameCount: 12,
    defaultFps: 11,
    unitMeta: {
      coreSize: '20×22 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_green',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 11,
    },
    layersSpec: [
      '0. Тень unitShadow_11 под pivot',
      '1. Заплечный колчан с оперением K1/K2',
      '2. Кожаный жилет и открытая мускулатура SKIN_MASK',
      '3. Остроухая голова, зубчатый клинок и пузырящаяся склянка яда',
    ],
    description:
      'Юнит уровня I (34×34 px): хитрый гоблин с заплечным колчаном, испарениями над склянкой яда во второй руке, длинными ушами и зазубренным кинжалом.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(GOBLIN_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(GOBLIN_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderGoblinScout(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(GOBLIN_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'orc-raider',
    name: 'Воин Орды',
    subtitle: 'Берсерк с костяным наплечником и секирой (36×36)',
    kind: 'unit',
    tier: 'II',
    faction: 'Орда',
    width: 36,
    height: 36,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '24×24 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_green',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 13,
    },
    layersSpec: [
      '0. Тень unitShadow_13 под pivot',
      '1. Спинной трофейный рог и костяной наплечник',
      '2. Рельефный торс SKIN_MASK с боевой раскраской K2 и килтом K1',
      '3. Клыкастая голова, двойная секира и шипастый щит',
    ],
    description:
      'Боец уровня II (36×36 px): атлетический торс SKIN_MASK с боевой раскраской K2, костяной наплечник, трофейные бивни, тяжёлая секира и окованный щит.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(ORC_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(ORC_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderOrcRaider(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(ORC_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'orc-warlord',
    name: 'Вождь Орды',
    subtitle: 'Босс в обсидиановой броне со стягом (40×38)',
    kind: 'unit',
    tier: 'III',
    faction: 'Орда',
    width: 40,
    height: 38,
    frameCount: 12,
    defaultFps: 9,
    unitMeta: {
      coreSize: '28×28 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_green',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 16,
    },
    layersSpec: [
      '0. Массивная тень unitShadow_16 под pivot',
      '1. Развевающийся боевой плащ и стойка с черепами',
      '2. Обсидиановая броня, пряжка-череп и торс SKIN_MASK',
      '3. Рогатый начелюстник, осадный тесак и крепостной щит',
    ],
    description:
      'Полководец уровня III (40×38 px): гигантский вождь со стойкой черепов и колышущимся плащом за спиной, обсидиановыми пластинами и двуручным тесаком.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(WARLORD_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(WARLORD_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderOrcWarlord(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(WARLORD_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'skeleton-levy',
    name: 'Скелет-Копейщик',
    subtitle: 'Костяной страж с рёбрами и плащом (34×34)',
    kind: 'unit',
    tier: 'I',
    faction: 'Некрополь',
    width: 34,
    height: 34,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '21×23 ядро',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 10,
    },
    layersSpec: [
      '0. Тень unitShadow_10 под ступнями',
      '1. Волнообразный погребальный плащ K1',
      '2. Скульптурная грудная клетка с позвоночником и набедренником K1/K2',
      '3. Череп с горящими глазницами, копьё с вымпелом и костяной щит',
    ],
    description:
      'Юнит уровня I (34×34 px): анатомически читаемый скелет с отдельными рёбрами, колышущимся погребальным плащом, копьём с вымпелом и треснутым щитом.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(SKELETON_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(SKELETON_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderSkeletonLevy(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(SKELETON_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'necromancer-acolyte',
    name: 'Некромант',
    subtitle: 'Тёмный колдун с гримуаром и орбитой (36×36)',
    kind: 'unit',
    tier: 'II',
    faction: 'Некрополь',
    width: 36,
    height: 36,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '23×24 ядро',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 12,
    },
    layersSpec: [
      '0. Тень unitShadow_12 под мантией',
      '1. Волнообразный плащ с бирюзовой рунной каймой K2',
      '2. Складчатое одеяние с костяной застёжкой и рунами',
      '3. Капюшон, посох душ, гримуар и орбитальная искра',
    ],
    description:
      'Маг уровня II (36×36 px): многослойная роба со складками, колышущийся плащ, кружащая искра маны, черепной посох и раскрытый гримуар.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(NECRO_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(NECRO_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderNecromancer(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(NECRO_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'lich-archmage',
    name: 'Верховный Лич',
    subtitle: 'Парящий архимаг с рунным нимбом (40×38)',
    kind: 'unit',
    tier: 'III',
    faction: 'Некрополь',
    width: 40,
    height: 38,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '26×28 ядро',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 14,
    },
    layersSpec: [
      '0. Фиксированная тень unitShadow_14 под парящим силуэтом',
      '1. Вращающийся 12-кадровый нимб и волнующаяся мантия K1/K2',
      '2. Золотая ребристая кираса с рунами без контакта с землёй',
      '3. Коронованный череп, великий жезл и орбитальная сфера души',
    ],
    description:
      'Верховный маг уровня III (40×38 px): левитирует в центре вращающегося рунного нимба, с золотой короной, волнующейся мантией, жезлом и орбитальным огоньком.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(LICH_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(LICH_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderLichArchmage(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(LICH_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'forest-ranger',
    name: 'Следопыт Круга',
    subtitle: 'Лесной стрелок с плащом и колчаном (34×34)',
    kind: 'unit',
    tier: 'I',
    faction: 'Лесной Круг',
    width: 34,
    height: 34,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '21×23 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_light',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 11,
    },
    layersSpec: [
      '0. Тень unitShadow_11 под сапогами',
      '1. Плавно колышущийся лесной плащ и колчан со стрелами',
      '2. Мшистая бригантина с ремнями и маской-шарфом K1',
      '3. Капюшон, тисовый лук со стрелой K2 и охотничий нож',
    ],
    description:
      'Стрелок уровня I (34×34 px): лесной охотник в колышущемся мшистом плаще с заплечным колчаном, изогнутым тисовым луком и поясным клинком.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(RANGER_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(RANGER_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderForestRanger(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(RANGER_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'frost-warden',
    name: 'Страж Мороза',
    subtitle: 'Ледниковый витязь с призменным щитом (36×36)',
    kind: 'unit',
    tier: 'II',
    faction: 'Бастион Мороза',
    width: 36,
    height: 36,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '24×25 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_blue',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 13,
    },
    layersSpec: [
      '0. Тень unitShadow_13 под поножами',
      '1. Волнообразный зимний плащ K1 с ледяной каймой',
      '2. Кристаллическое плечо, стальная броня и кожа SKIN_MASK',
      '3. Рогатый ледяной шлем, алебарда и щит-призма',
    ],
    description:
      'Защитник уровня II (36×36 px): северный рыцарь с колышущимся зимним плащом, ледяным наплечником, меховой опушкой, алебардой и призменным щитом.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(FROST_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(FROST_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderFrostWarden(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(FROST_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'demon-imp',
    name: 'Огненный Бес',
    subtitle: 'Крылатый бес с машущими крыльями (34×34)',
    kind: 'unit',
    tier: 'I',
    faction: 'Кузня Пекла',
    width: 34,
    height: 34,
    frameCount: 12,
    defaultFps: 12,
    unitMeta: {
      coreSize: '23×23 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_red',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 11,
    },
    layersSpec: [
      '0. Тень unitShadow_11 под копытцами',
      '1. Плавные 12-кадровые перепончатые крылья K1 и гибкий хвост',
      '2. Мускулистое тело SKIN_MASK (skin_red) с обсидиановыми наручами',
      '3. Рогатая голова, магмовый трезубец и огненный шар',
    ],
    description:
      'Быстрый боец уровня I (34×34 px): крылатый бес с процедурным 12-кадровым взмахом перепончатых крыльев, виляющим хвостом, трезубцем и искрой пламени.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(IMP_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(IMP_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderDemonImp(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(IMP_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
];
