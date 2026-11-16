import { RAMPS } from '../engine/palette';
import {
  ModularHumanoidSpec,
  PixelMatrix,
  UnitFrameAnchors,
  drawAstrolabeHalo,
  drawFeatheredWings,
  drawSpinningPropeller,
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
import { renderUnitFromSpec } from './modularUnits';
import { PixelModelDef } from './types';

/**
 * ============================================================================
 * EXPANDED CROSS-GENRE & CROSS-CULTURE HUMANOID UNITS (12 MODELS, 34×34–40×38)
 * ============================================================================
 * Broadens the humanoid roster across steampunk, feudal east, plague alchemy,
 * celestial, desert solar, druidic, infernal, shadow, cosmic & magitek styles.
 * All units follow the strict headless-torso + head/item anchors + K1/K2/SKIN
 * mask pipeline with continuous 12-frame sculpting.
 * ============================================================================
 */

// ============================================================================
// WEAPONS (DETAILED MULTI-STOP SPRITES, FACING LEFT)
// ============================================================================

const FORGE_WARHAMMER: PixelMatrix = [
  'ALLIkk.',
  'Lll1aKk',
  'MII12Kk',
  'iikkkK.',
  '...G...',
  '...T...',
  '...t...',
  '...u...',
  '...U...',
];

const KATANA_LOTUS: PixelMatrix = [
  'A......',
  '.AM....',
  '..MI...',
  '...MIk.',
  '....MIk',
  '....G12',
  '.....t.',
  '.....u.',
];

const CENSER_PLAGUE: PixelMatrix = [
  '...G...',
  '..gGg..',
  '..i1i..',
  '..T.T..',
  '..t....',
  '..u....',
  '.GFG...',
  'Fa1aF..',
  '.fEf...',
];

const HOURGLASS_STAFF: PixelMatrix = [
  '.GGAGG.',
  'GaCCCaG',
  '.gLQlg.',
  '..gLg..',
  '.gQCQg.',
  'GGgGgGG',
  '...T...',
  '...t...',
  '...u...',
  '...U...',
];

const BLUNDERBUSS_BRASS: PixelMatrix = [
  'GG....',
  'gMIk..',
  '.MIIa.',
  '..GGo.',
  '..Ttu.',
  '...uU.',
];

const CUTLASS_CORSAIR: PixelMatrix = [
  '.AM...',
  'AMIk..',
  'MIik..',
  '.MIk..',
  'GG12..',
  '.gT...',
  '..u...',
];

const SUN_SPEAR: PixelMatrix = [
  '..A....',
  '.ALG...',
  'ALGgG..',
  '.G1a2..',
  '..G23..',
  '..T....',
  '..t....',
  '..T....',
  '..u....',
  '..U....',
];

const ANKH_SOLAR_STAFF: PixelMatrix = [
  '..GAG..',
  '.Ga1aG.',
  '.G1L1G.',
  '..gGg..',
  '.GGgGG.',
  '...G...',
  '...T...',
  '...t...',
  '...u...',
  '...U...',
];

const VINE_STAG_STAFF: PixelMatrix = [
  '.F..A..',
  'FtC1aC.',
  '.Ttf2..',
  '..T....',
  '..tF...',
  '..u....',
  '..T....',
  '..u....',
  '..U....',
];

const INFERNAL_GREATAXE: PixelMatrix = [
  '.AMII...',
  'ALIIOk..',
  'Ll1aOVk.',
  'LIiOOV..',
  'kk..K...',
  '....O...',
  '....V...',
  '....O...',
  '....K...',
  '....K...',
];

const SHADOW_BLADE_PAIR: PixelMatrix = [
  '.A....',
  'aC....',
  'a1k...',
  '.2Ik..',
  '..3K..',
  '..1t..',
  '...U..',
];

const PLASMA_HALBERD: PixelMatrix = [
  '..A....',
  '.CaM...',
  'Caa1Ik.',
  'Qa12Kk.',
  'X..G...',
  '...k...',
  '...T...',
  '...k...',
  '...K...',
  '...K...',
];

// ============================================================================
// HEADS (SCULPTED MULTI-LAYER SILHOUETTES, FACING LEFT)
// ============================================================================

const HEAD_DWARF_SMITH: PixelMatrix = [
  'B.........B',
  'Bp.AMIIk.pB',
  '.BM1a22Ik..',
  '..ISSDSsk..',
  '.RRRRSRRR..',
  'RRRRrRRRRr.',
  '.RRrGGrRr..',
  '..rRrrRr...',
];

const HEAD_SAMURAI: PixelMatrix = [
  '.G......G..',
  'GaG1111Gag.',
  '.MI12a21Ik.',
  '.MIIIkIIIk.',
  '..SSSDSSz..',
  '..11K2K11..',
  '...22332...',
];

const HEAD_PLAGUE: PixelMatrix = [
  '..KKKKKK...',
  '.K112211K..',
  'KKKKKKKKKK.',
  '..kKKaaKKk.',
  'BBpIkDDkk..',
  '.BBppKKk...',
  '...kkkk....',
];

const HEAD_CHRONO: PixelMatrix = [
  '...G.A.G...',
  '..G1aCa1G..',
  '.112222231.',
  '.22SCDCS3z.',
  '..2SSJJSS..',
  '...JJjjj...',
  '....jjj....',
];

const HEAD_AVIATOR: PixelMatrix = [
  '..TT121T...',
  '.TTuuGGuu..',
  '.uIaKaKIk..',
  '..SSSDSSz..',
  '..122122z..',
  '...23344...',
];

const HEAD_CORSAIR: PixelMatrix = [
  '..111A1....',
  '.11222211..',
  'KKKGGGGKKK.',
  '..SSSDSSK..',
  '..hhsHHs...',
  '...HhhHh...',
];

const HEAD_VALKYRIE: PixelMatrix = [
  'M.........M',
  'MI.G1A1G.Ik',
  '.MIGaa2GIk.',
  '..SSSDSSz..',
  '..YYYSSYY..',
  '..YYyYyy...',
];

const HEAD_SUNPRIEST: PixelMatrix = [
  '..G..A..G..',
  '.GaGG1GGaG.',
  '.GGSSSDSSG.',
  '.J1SSzSS1j.',
  '..J12221j..',
  '...jjjjj...',
];

const HEAD_STAG_DRUID: PixelMatrix = [
  'T..T...T..T',
  '.Tt.BBB.tT.',
  '..TBBpBBt..',
  '..f1BKB1f..',
  '..fFFSDf...',
  '...eeeee...',
];

const HEAD_EXECUTIONER: PixelMatrix = [
  'B.........B',
  '.OOVVVVVOO.',
  '.OI1a2a1IO.',
  '.OLKAKAKLO.',
  '.OOVVVVVOO.',
  '..KKKKKKK..',
];

const HEAD_ASSASSIN: PixelMatrix = [
  '...KK11KK..',
  '..K112211K.',
  '.KKDDaaDDK.',
  '.112222331.',
  '..2334433..',
];

const HEAD_CYBER_WARDEN: PixelMatrix = [
  '...aaAaa...',
  '..MMIIIkk..',
  '.MaCCaCCak.',
  '.MI11211Ik.',
  '..kKKGKKk..',
  '...kkkkk...',
];

// ============================================================================
// OFFHANDS & BACK MODULES
// ============================================================================

const SHIELD_RUNE_DWARF: PixelMatrix = [
  '.GG11G.',
  'G1aGa2g',
  'GaIIIag',
  'g23432o',
  '.ggogg.',
];

const OFFHAND_WAKIZASHI: PixelMatrix = [
  'AM.',
  'MI.',
  'Gk.',
  't..',
];

const OFFHAND_POTION: PixelMatrix = [
  '.T..',
  'iCi.',
  'aCAa',
  'bcbd',
  '.dd.',
];

const OFFHAND_CHRONO_ORB: PixelMatrix = [
  '.GA.',
  'GCQG',
  'gNaq',
  '.gg.',
];

const OFFHAND_COMPASS: PixelMatrix = [
  '.GG.',
  'GaCG',
  'gogg',
];

const OFFHAND_PISTOL: PixelMatrix = [
  'MIk.',
  'Gtu.',
  '.u..',
];

const SHIELD_VALKYRIE: PixelMatrix = [
  'GG1A1G.',
  'G1aGa1k',
  'MGGGGGk',
  'I2aGa3k',
  '.i343k.',
  '..iGk..',
];

const OFFHAND_SUN_ORB: PixelMatrix = [
  '.LA.',
  'GLlG',
  'gGLg',
  '.gg.',
];

const OFFHAND_LANTERN: PixelMatrix = [
  '.T..',
  'GCA.',
  'Faf.',
  'GGG.',
];

const OFFHAND_BRAZIER: PixelMatrix = [
  '.LA.',
  'OLlO',
  'KkVk',
  '.KK.',
];

const OFFHAND_KUNAI: PixelMatrix = [
  '.A.',
  'aC.',
  'Ik.',
  'k..',
];

const SHIELD_ENERGY_BUCKLER: PixelMatrix = [
  '.CCaC.',
  'C1a2aC',
  'QaAAAQ',
  'N2343N',
  '.XaaX.',
];

const BACK_SASHIMONO: PixelMatrix = [
  '.G11a1',
  '.T1222',
  '.T1a12',
  '.t2333',
  '.t3444',
  '.u....',
  '.U....',
];

const BACK_JETPACK: PixelMatrix = [
  'GG..GG',
  'i1MM1k',
  'k2II2K',
  'o.KK.o',
];

// ============================================================================
// 12 BRAND-NEW CROSS-GENRE HUMANOID SPECS
// ============================================================================

// 1. Дворф-Рунокузнец (36×36, Гильдия, Tier II)
const DWARF_SMITH_SPEC: ModularHumanoidSpec = {
  width: 36,
  height: 36,
  walkFrames: make36Walk(
    [
      '..GMI1122211IIk...',
      '.GMII11a22b33ikk..',
      '.ssRRR12GG34RRzz..',
      '..sRRRTuuGGuTRRz..',
      '...rrt2234432tr...',
      '...kkt3344433tk...',
      '...iIkk34..43kk...',
      '...iIk......kKk...',
      '...TTt......tUU...',
      '...UUU......UUU...',
    ],
    'T',
    't',
    'U'
  ),
  swimFrames: make36Swim([
    '..GMI1122211IIk...',
    '.GMII11a22b33ikk..',
    '.ssRRR12GG34RRzz..',
    '..sRRRTuuGGuTRRz..',
    '...rrt2234432tr...',
  ]),
  head: { matrix: HEAD_DWARF_SMITH, offsetX: -5, offsetY: -6 },
  item: { matrix: FORGE_WARHAMMER, offsetX: -4, offsetY: -7 },
  offhand: { matrix: SHIELD_RUNE_DWARF, offsetX: 12, offsetY: 2 },
  onFrontSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    if (Math.sin(t) > -0.2) {
      const sy = oy - 2 - (frame % 4);
      buf.setPixel(ox + 1 + (frame % 2), sy, RAMPS.lava.highlight);
      buf.setPixel(ox + 3, sy + 1, '#FFFFFF');
    }
  },
  weaponSwing: { ampX: 1.0, ampY: 1.0 },
  offhandSwing: { ampY: 0.7 },
  shadowWidth: 14,
};

// 2. Самурай Багряного Лотоса (36×36, Цитадель, Tier II)
const SAMURAI_SPEC: ModularHumanoidSpec = {
  width: 36,
  height: 36,
  walkFrames: make36Walk(
    [
      '..11I1122211I11...',
      '.122I11a22b11I23..',
      '.233K122GG344K34..',
      '..ssK1234434Kzz...',
      '...kGG23aa43GGk...',
      '...112344434221...',
      '...223434434332...',
      '...3344....4433...',
      '...iIkK....kKKk...',
      '...KKK......KKK...',
    ],
    'I',
    'k',
    'K'
  ),
  swimFrames: make36Swim([
    '..11I1122211I11...',
    '.122I11a22b11I23..',
    '.233K122GG344K34..',
    '..ssK1234434Kzz...',
    '...kGG23aa43GGk...',
  ]),
  head: { matrix: HEAD_SAMURAI, offsetX: -5, offsetY: -6 },
  item: { matrix: KATANA_LOTUS, offsetX: -4, offsetY: -6 },
  back: { matrix: BACK_SASHIMONO, offsetX: 11, offsetY: -8 },
  offhand: { matrix: OFFHAND_WAKIZASHI, offsetX: 13, offsetY: 3 },
  onBackSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const wave = Math.round(Math.sin(t) * 1.2);
    buf.setPixel(ox + 17 + wave, oy - 7, RAMPS.magenta.highlight);
    buf.setPixel(ox + 17 + wave, oy - 6, RAMPS.cyanMask.highlight);
  },
  weaponSwing: { ampX: 1.2, ampY: 0.9 },
  offhandSwing: { ampY: 0.7 },
  shadowWidth: 13,
};

// 3. Чумной Алхимик (36×36, Гильдия, Tier II)
const PLAGUE_ALCHEMIST_SPEC: ModularHumanoidSpec = {
  width: 36,
  height: 36,
  walkFrames: make36Walk(
    [
      '..KKK1122211KKK...',
      '.KKt11aC2aC31tKK..',
      '.KKut12GGaG23tuK..',
      '..KKu2234432uKK...',
      '...kT234aa43Tk....',
      '...k223444342k....',
      '...k3344..443k....',
      '...K44......4K....',
      '...utK......Kut...',
      '...KKK......KKK...',
    ],
    't',
    'u',
    'K'
  ),
  swimFrames: make36Swim([
    '..KKK1122211KKK...',
    '.KKt11aC2aC31tKK..',
    '.KKut12GGaG23tuK..',
    '..KKu2234432uKK...',
    '...kT234aa43Tk....',
  ]),
  head: { matrix: HEAD_PLAGUE, offsetX: -5, offsetY: -6 },
  item: { matrix: CENSER_PLAGUE, offsetX: -4, offsetY: -6 },
  offhand: { matrix: OFFHAND_POTION, offsetX: 13, offsetY: 2 },
  onBackSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawWavingCape(buf, ox + 10, oy + 1, 6, 10, t, true, RAMPS.moss.highlight);
  },
  onFrontSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const lift = frame % 5;
    buf.setPixel(ox - 2, oy + 1 - lift, RAMPS.moss.highlight);
    if (frame % 2 === 0) buf.setPixel(ox + 15, oy - (frame % 3), RAMPS.cyanMask.highlight);
  },
  weaponSwing: { ampX: 1.0, ampY: 1.0 },
  offhandSwing: { ampY: 0.9 },
  shadowWidth: 13,
};

// 4. Хрономант Эфира (40×38, Цитадель, Tier III Boss)
const CHRONO_BODY_ROWS = [
  '...GG1122aa2211GG...',
  '..G1122aCCCCa223gg..',
  '.SS1223GaaGaG344zz..',
  '.ss223444aa44344zz..',
  '..zzGG344aC434GGzz..',
  '...gg2344444434oo...',
  '...1134a....a4311...',
  '...234..aGGa..432...',
  '....34...33...43....',
  '.....4........4.....',
] as const;

const CHRONO_WALK_FRAMES: { body: PixelMatrix; anchors: UnitFrameAnchors }[] = [0, 1, 2, 3].map(
  (step) => {
    const bob = step === 0 ? 0 : step === 2 ? -2 : -1;
    const hemRows =
      step % 2 === 0
        ? [
            '.....44..a...44.....',
            '......4.......4.....',
            '....................',
            '....................',
            '....................',
          ]
        : [
            '....44..aaa..44.....',
            '.....4.......4......',
            '....................',
            '....................',
            '....................',
          ];
    return {
      body: [...CHRONO_BODY_ROWS, ...hemRows],
      anchors: {
        head: { x: 19, y: 19 + bob, w: 2, h: 2 },
        item: { x: 9, y: 22 + bob, w: 1, h: 3 },
        pivot: { x: 20, y: 34 },
        bodyOffsetY: bob,
      },
    };
  }
);

const CHRONOMANCER_SPEC: ModularHumanoidSpec = {
  width: 40,
  height: 38,
  walkFrames: CHRONO_WALK_FRAMES,
  swimFrames: make40Swim([
    '...GG1122aa2211GG...',
    '..G1122aCCCCa223gg..',
    '.SS1223GaaGaG344zz..',
    '.ss223444aa44344zz..',
    '..zzGG344aC434GGzz..',
    '...gg2344444434oo...',
  ]),
  head: { matrix: HEAD_CHRONO, offsetX: -5, offsetY: -6 },
  item: { matrix: HOURGLASS_STAFF, offsetX: -5, offsetY: -8 },
  offhand: { matrix: OFFHAND_CHRONO_ORB, offsetX: 15, offsetY: 1 },
  onBackSculpt: (buf, frame, total, ox, oy) => {
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawAstrolabeHalo(buf, ox + 10, oy + 1, 9.5, t, RAMPS.gold.highlight, RAMPS.cyanMask.highlight);
    drawAstrolabeHalo(buf, ox + 10, oy + 1, 6.0, -t, RAMPS.ice.mid, '#FFFFFF');
    drawWavingCape(buf, ox + 11, oy + 2, 5, 11, t, true, RAMPS.gold.highlight);
  },
  onFrontSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const mx = ox + 10 + Math.round(Math.cos(t) * 8);
    const my = oy + 5 + Math.round(Math.sin(t) * 3);
    buf.setPixel(mx, my, '#FFFFFF');
    buf.setPixel(mx + 1, my, RAMPS.gold.highlight);
  },
  weaponSwing: { ampX: 0.7, ampY: 1.0 },
  offhandSwing: { ampY: 1.1 },
  shadowWidth: 14,
};

// 5. Авиатор-Стрелок Гильдии (34×34, Гильдия, Tier I)
const AVIATOR_SPEC: ModularHumanoidSpec = {
  width: 34,
  height: 34,
  walkFrames: make34Walk(
    [
      '..TT1122211uTT..',
      '.ssTu12a23uTTzz.',
      '..zzT2GaaG3uZz..',
      '...zTu2343uTz...',
      '...TTuGGGuuT....',
      '....t233432t....',
      '....u34..43u....',
      '....u4....4u....',
      '....UU....UU....',
    ],
    'T',
    't',
    'U'
  ),
  swimFrames: make34Swim([
    '..TT1122211uTT..',
    '.ssTu12a23uTTzz.',
    '..zzT2GaaG3uZz..',
    '...zTu2343uTz...',
    '...TTuGGGuuT....',
  ]),
  head: { matrix: HEAD_AVIATOR, offsetX: -4, offsetY: -5 },
  item: { matrix: BLUNDERBUSS_BRASS, offsetX: -4, offsetY: -2 },
  back: { matrix: BACK_JETPACK, offsetX: 11, offsetY: 0 },
  offhand: { matrix: OFFHAND_COMPASS, offsetX: 12, offsetY: 2 },
  onBackSculpt: (buf, frame, total, ox, oy, mode) => {
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawSpinningPropeller(buf, ox + 15, oy + 1, 3.2, t);
    if (mode !== 'swim') {
      // Fluttering scarf tail
      for (let i = 0; i < 4; i++) {
        const sy = oy + Math.round(Math.sin(t - i * 0.7) * 1.1);
        buf.setPixel(ox + 12 + i, sy, i % 2 === 0 ? RAMPS.magenta.highlight : RAMPS.magenta.mid);
      }
    }
  },
  weaponSwing: { ampX: 0.8, ampY: 0.7 },
  offhandSwing: { ampY: 0.7 },
  shadowWidth: 11,
};

// 6. Корсар Бездны (34×34, Гильдия, Tier I)
const CORSAIR_SPEC: ModularHumanoidSpec = {
  width: 34,
  height: 34,
  walkFrames: make34Walk(
    [
      '..JJ1122211JJ...',
      '.SSJ11a22b33Jzz.',
      '.zz112JJJ334zz..',
      '..z12GGaaG34z...',
      '...233444334....',
      '...2344..443....',
      '...344....44....',
      '...KK......KK...',
      '...KK......KK...',
    ],
    'O',
    'k',
    'K'
  ),
  swimFrames: make34Swim([
    '..JJ1122211JJ...',
    '.SSJ11a22b33Jzz.',
    '.zz112JJJ334zz..',
    '..z12GGaaG34z...',
    '...233444334....',
  ]),
  head: { matrix: HEAD_CORSAIR, offsetX: -4, offsetY: -5 },
  item: { matrix: CUTLASS_CORSAIR, offsetX: -4, offsetY: -4 },
  offhand: { matrix: OFFHAND_PISTOL, offsetX: 12, offsetY: 2 },
  onBackSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawWavingCape(buf, ox + 10, oy + 1, 4, 8, t, true, RAMPS.gold.highlight);
  },
  weaponSwing: { ampX: 1.1, ampY: 1.0 },
  offhandSwing: { ampY: 0.8 },
  shadowWidth: 11,
};

// 7. Валькирия Рассвета (40×38, Цитадель, Tier III Boss)
const VALKYRIE_SPEC: ModularHumanoidSpec = {
  width: 40,
  height: 38,
  walkFrames: make40Walk(
    [
      '...MGG1122211GGM....',
      '..MMG11a222b33GII...',
      '.SSGI122aGa344IGzz..',
      '.ssGI123444344IGzz..',
      '..zzGG23aa434GGzz...',
      '...gg234444344oo....',
      '...11344..44311.....',
      '...234......432.....',
      '...GII......IIG.....',
      '...GGk......kGG.....',
      '...KKK......KKK.....',
    ],
    'G',
    'M',
    'K'
  ),
  swimFrames: make40Swim([
    '...MGG1122211GGM....',
    '..MMG11a222b33GII...',
    '.SSGI122aGa344IGzz..',
    '.ssGI123444344IGzz..',
    '..zzGG23aa434GGzz...',
    '...gg234444344oo....',
  ]),
  head: { matrix: HEAD_VALKYRIE, offsetX: -5, offsetY: -5 },
  item: { matrix: SUN_SPEAR, offsetX: -4, offsetY: -8 },
  offhand: { matrix: SHIELD_VALKYRIE, offsetX: 14, offsetY: 2 },
  onBackSculpt: (buf, frame, total, ox, oy) => {
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawFeatheredWings(buf, ox + 10, oy + 2, 13, t, '#FFFFFF', RAMPS.marble.mid, RAMPS.gold.highlight);
  },
  onFrontSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    if (frame % 3 === 0) {
      buf.setPixel(ox + 10 + ((frame * 3) % 7) - 3, oy - 3, '#FFFFFF');
    }
  },
  weaponSwing: { ampX: 1.0, ampY: 0.9 },
  offhandSwing: { ampY: 0.8 },
  shadowWidth: 15,
};

// 8. Жрец Солнца Дюн (36×36, Лесной Круг, Tier II)
const SUNPRIEST_SPEC: ModularHumanoidSpec = {
  width: 36,
  height: 36,
  walkFrames: make36Walk(
    [
      '..GGG1122211GGG...',
      '.GGJ11a2L2b33JGG..',
      '.SSJ122GGG344Jzz..',
      '.ssJJ2344434JJzz..',
      '..zzGG23aa34GGz...',
      '...JJ2344434JJ....',
      '...JJ34....4JJ....',
      '...jj4......jj....',
      '...GGg......gGG...',
      '...ooo......ooo...',
    ],
    'G',
    'g',
    'o'
  ),
  swimFrames: make36Swim([
    '..GGG1122211GGG...',
    '.GGJ11a2L2b33JGG..',
    '.SSJ122GGG344Jzz..',
    '.ssJJ2344434JJzz..',
    '..zzGG23aa34GGz...',
  ]),
  head: { matrix: HEAD_SUNPRIEST, offsetX: -5, offsetY: -6 },
  item: { matrix: ANKH_SOLAR_STAFF, offsetX: -5, offsetY: -8 },
  offhand: { matrix: OFFHAND_SUN_ORB, offsetX: 13, offsetY: 2 },
  onBackSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawWavingCape(buf, ox + 10, oy + 1, 6, 10, t, true, RAMPS.gold.highlight);
  },
  onFrontSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    if (Math.cos(t) > 0.2) {
      buf.setPixel(ox + 1, oy - 3 - (frame % 2), RAMPS.lava.highlight);
    }
  },
  weaponSwing: { ampX: 0.9, ampY: 0.9 },
  offhandSwing: { ampY: 0.9 },
  shadowWidth: 13,
};

// 9. Друид-Олень (36×36, Лесной Круг, Tier II)
const STAG_DRUID_SPEC: ModularHumanoidSpec = {
  width: 36,
  height: 36,
  walkFrames: make36Walk(
    [
      '..FFf11BBB11efF...',
      '.FFftt2aBBa2eeff..',
      '.ssftT23113Ttfzz..',
      '..zzfT234432Tfz...',
      '...eeT23aa32Te....',
      '...e123444342e....',
      '...e234....43e....',
      '...EE4......EE....',
      '...Ttu......utT...',
      '...UUU......UUU...',
    ],
    'T',
    't',
    'U'
  ),
  swimFrames: make36Swim([
    '..FFf11BBB11efF...',
    '.FFftt2aBBa2eeff..',
    '.ssftT23113Ttfzz..',
    '..zzfT234432Tfz...',
    '...eeT23aa32Te....',
  ]),
  head: { matrix: HEAD_STAG_DRUID, offsetX: -5, offsetY: -6 },
  item: { matrix: VINE_STAG_STAFF, offsetX: -4, offsetY: -7 },
  offhand: { matrix: OFFHAND_LANTERN, offsetX: 13, offsetY: 2 },
  onBackSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawWavingCape(buf, ox + 10, oy + 1, 6, 10, t, false, RAMPS.moss.highlight);
  },
  onFrontSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const fx = ox + 3 + Math.round(Math.cos(t * 2) * 3);
    const fy = oy - 2 + Math.round(Math.sin(t * 2) * 2);
    buf.setPixel(fx, fy, RAMPS.moss.highlight);
    buf.setPixel(ox + 15, oy + 1 - (frame % 3), RAMPS.cyanMask.highlight);
  },
  weaponSwing: { ampX: 0.9, ampY: 0.9 },
  offhandSwing: { ampY: 1.0 },
  shadowWidth: 13,
};

// 10. Палач Инферно (40×38, Кузня Пекла, Tier III Boss)
const EXECUTIONER_SPEC: ModularHumanoidSpec = {
  width: 40,
  height: 38,
  walkFrames: make40Walk(
    [
      '..BOO11222211OOB....',
      '.BOO11a2LL2b33OOB...',
      '.ssOO122LL2234OOzz..',
      '.ssVO123444344OVzz..',
      '..zzOO23aa434OOzz...',
      '...VV234444344VV....',
      '...OO344..4434OO....',
      '...VV44....444VV....',
      '...OOV......VOO.....',
      '...OKK......KKO.....',
      '...KKK......KKK.....',
    ],
    'O',
    'V',
    'K'
  ),
  swimFrames: make40Swim([
    '..BOO11222211OOB....',
    '.BOO11a2LL2b33OOB...',
    '.ssOO122LL2234OOzz..',
    '.ssVO123444344OVzz..',
    '..zzOO23aa434OOzz...',
    '...VV234444344VV....',
  ]),
  head: { matrix: HEAD_EXECUTIONER, offsetX: -5, offsetY: -5 },
  item: { matrix: INFERNAL_GREATAXE, offsetX: -6, offsetY: -8 },
  offhand: { matrix: OFFHAND_BRAZIER, offsetX: 14, offsetY: 2 },
  onBackSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawWavingCape(buf, ox + 12, oy + 2, 6, 11, t, true, RAMPS.lava.mid);
  },
  onFrontSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const sparkY = oy - 1 - (frame % 5);
    buf.setPixel(ox + 16, sparkY, frame % 2 === 0 ? RAMPS.lava.highlight : RAMPS.lava.mid);
    buf.setPixel(ox + 2, sparkY + 2, RAMPS.lava.highlight);
  },
  weaponSwing: { ampX: 1.0, ampY: 1.0 },
  offhandSwing: { ampY: 0.9 },
  shadowWidth: 16,
};

// 11. Фантом-Ассасин (36×36, Некрополь, Tier II)
const ASSASSIN_SPEC: ModularHumanoidSpec = {
  width: 36,
  height: 36,
  walkFrames: make36Walk(
    [
      '..KK1122211KK.....',
      '.KK11a222b33KK....',
      '.KK2112aa344KK....',
      '..KK2234434KK.....',
      '...O123aa43O......',
      '...V2234434V......',
      '...k334..43k......',
      '...K44....4K......',
      '...kK......Kk.....',
      '...KK......KK.....',
    ],
    'O',
    'k',
    'K'
  ),
  swimFrames: make36Swim([
    '..KK1122211KK.....',
    '.KK11a222b33KK....',
    '.KK2112aa344KK....',
    '..KK2234434KK.....',
    '...O123aa43O......',
  ]),
  head: { matrix: HEAD_ASSASSIN, offsetX: -5, offsetY: -4 },
  item: { matrix: SHADOW_BLADE_PAIR, offsetX: -4, offsetY: -5 },
  offhand: { matrix: OFFHAND_KUNAI, offsetX: 13, offsetY: 3 },
  onBackSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawWavingCape(buf, ox + 10, oy + 1, 5, 11, t, true, RAMPS.cyanMask.highlight);
  },
  onFrontSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const wisp = (frame % 4) + 1;
    buf.setPixel(ox + 15 + wisp, oy + 4, RAMPS.cyanMask.highlight);
    buf.setPixel(ox + 14 + wisp, oy + 7, RAMPS.magenta.mid);
  },
  weaponSwing: { ampX: 1.4, ampY: 1.0 },
  offhandSwing: { ampY: 0.9 },
  shadowWidth: 12,
};

// 12. Кибер-Страж Маны (40×38, Гильдия, Tier III Boss)
const CYBER_WARDEN_SPEC: ModularHumanoidSpec = {
  width: 40,
  height: 38,
  walkFrames: make40Walk(
    [
      '...MMG1122211GMM....',
      '..MMG11aCCCa33GMM...',
      '.MIIG12aAAAa34GIk...',
      '.MIIk223aa4344kKk...',
      '..ikGG2344434GGk....',
      '...II234444344kk....',
      '...II344..4434kk....',
      '...kk44....444KK....',
      '...iIk......kKK.....',
      '...IIk......kKK.....',
      '...KKK......KKK.....',
    ],
    'M',
    'I',
    'K'
  ),
  swimFrames: make40Swim([
    '...MMG1122211GMM....',
    '..MMG11aCCCa33GMM...',
    '.MIIG12aAAAa34GIk...',
    '.MIIk223aa4344kKk...',
    '..ikGG2344434GGk....',
    '...II234444344kk....',
  ]),
  head: { matrix: HEAD_CYBER_WARDEN, offsetX: -5, offsetY: -5 },
  item: { matrix: PLASMA_HALBERD, offsetX: -4, offsetY: -8 },
  offhand: { matrix: SHIELD_ENERGY_BUCKLER, offsetX: 14, offsetY: 2 },
  onBackSculpt: (buf, frame, total, ox, oy) => {
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawAstrolabeHalo(buf, ox + 10, oy + 2, 8.5, t * 2, RAMPS.gold.mid, RAMPS.cyanMask.highlight);
  },
  onFrontSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    if (frame % 2 === 0) {
      buf.setPixel(ox + 9, oy + 2, '#FFFFFF');
      buf.setPixel(ox + 10, oy + 2, RAMPS.cyanMask.highlight);
    }
  },
  weaponSwing: { ampX: 0.9, ampY: 0.8 },
  offhandSwing: { ampY: 0.7 },
  shadowWidth: 15,
};

// 13. Монарх Альянса / Лидер Содружества (40×38, Цитадель, Tier III Supreme Boss)
const SCEPTER_ALLIANCE_PACT: PixelMatrix = [
  'G..A..G',
  'G1aCa1G',
  'BM1AabM',
  '.GgCgG.',
  '..G1a..',
  '...G...',
  '...g...',
  '...T...',
  '...G...',
  '...o...',
  '...U...',
];

const HEAD_ALLIANCE_MONARCH: PixelMatrix = [
  'G.G..A..G.G',
  'B1aG1A1Ga2B',
  '.GGGGgGGGG.',
  '.B1aGGGa2B.',
  '..SSSDSSDz.',
  '..SSsGGszz.',
  '..GGgSSgo..',
  '...Ggooo...',
];

const OFFHAND_UNITY_ORB: PixelMatrix = [
  '..GAG..',
  '.G1Aab.',
  'G1aCa2g',
  'GaCCabg',
  '.g2b3o.',
  '..ggo..',
];

const ALLIANCE_MONARCH_SPEC: ModularHumanoidSpec = {
  width: 40,
  height: 38,
  walkFrames: make40Walk(
    [
      '..BGG1122aa2211GGB..',
      '.BGgg11aCGACb33ggGB.',
      '.SSg1122GAAAG34bgzz.',
      '.ssg1223G1aCG34bczz.',
      '..zzGG234aa434GGzz..',
      '...gg2334ab4434oo...',
      '...BB234a11b434BB...',
      '...pp3344ab4434pp...',
      '...GGk344..444kGg...',
      '...GMk......kKGo....',
      '...IIk......kKKk....',
    ],
    'G',
    'o',
    'K'
  ),
  swimFrames: make40Swim([
    '..BGG1122aa2211GGB..',
    '.BGgg11aCGACb33ggGB.',
    '.SSg1122GAAAG34bgzz.',
    '.ssg1223G1aCG34bczz.',
    '..zzGG234aa434GGzz..',
    '...gg2334ab4434oo...',
  ]),
  head: { matrix: HEAD_ALLIANCE_MONARCH, offsetX: -5, offsetY: -7 },
  item: { matrix: SCEPTER_ALLIANCE_PACT, offsetX: -5, offsetY: -8 },
  offhand: { matrix: OFFHAND_UNITY_ORB, offsetX: 13, offsetY: 1 },
  onBackSculpt: (buf, frame, total, ox, oy, mode) => {
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    drawAstrolabeHalo(buf, ox + 10, oy + 1, 9.0, t, RAMPS.gold.highlight, RAMPS.cyanMask.highlight);
    if (mode !== 'swim') {
      drawWavingCape(buf, ox + 11, oy + 1, 8, 12, t, true, RAMPS.sail.highlight);
    }
  },
  onFrontSculpt: (buf, frame, total, ox, oy, mode) => {
    if (mode === 'swim') return;
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const sigilX = ox + 10 + Math.round(Math.cos(t) * 8);
    const sigilY = oy + 3 + Math.round(Math.sin(t) * 3);
    buf.setPixel(sigilX, sigilY, '#FFFFFF');
    buf.setPixel(sigilX + 1, sigilY, frame % 2 === 0 ? RAMPS.gold.highlight : RAMPS.cyanMask.highlight);
    // Pact Scepter sovereign spark
    const sparkLift = frame % 3;
    buf.setPixel(ox - 2, oy - 7 - sparkLift, RAMPS.gold.highlight);
  },
  weaponSwing: { ampX: 1.0, ampY: 0.9 },
  offhandSwing: { ampY: 0.8 },
  shadowWidth: 16,
};

export const EXPANDED_UNIT_MODELS: PixelModelDef[] = [
  {
    id: 'alliance-monarch',
    name: 'Монарх Альянса',
    subtitle: 'Верховный лидер союза королевств с короной и печатью Пакта (40×38)',
    kind: 'unit',
    tier: 'III',
    faction: 'Цитадель',
    width: 40,
    height: 38,
    frameCount: 12,
    defaultFps: 10,
    attackName: 'Вердикт Великого Альянса (Удар скипетром Пакта)',
    unitMeta: {
      coreSize: '28×29 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_light',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 16,
    },
    layersSpec: [
      '0. Тень unitShadow_16 под золочёными сабатонами',
      '1. Имперская мантия с горностаем и вращающийся ореол Печати Альянса',
      '2. Двухцветный геральдический сюрко K1 + K2 со Звездой Единства и маской кожи SKIN',
      '3. Высокая корона Альянса, Скипетр Великого Пакта и Держава Содружества',
    ],
    description:
      'Верховный правитель союза королевств уровня III (40×38 px): стоит выше отдельных королей, объединяя цвета держав K1 и K2 в имперской мантии с горностаем, высокой короне Альянса, Скипетре Пакта и вращающемся ореоле Единства. Полностью поддерживает все фенотипы кожи (SKIN_MASK) и палитры держав.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(ALLIANCE_MONARCH_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(ALLIANCE_MONARCH_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderAllianceMonarch(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(ALLIANCE_MONARCH_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'dwarf-runesmith',
    name: 'Дворф-Рунокузнец',
    subtitle: 'Бородатый рунический молотобоец с искрами (36×36)',
    kind: 'unit',
    tier: 'II',
    faction: 'Гильдия',
    width: 36,
    height: 36,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '24×24 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_light',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 14,
    },
    layersSpec: [
      '0. Тень unitShadow_14 под сапогами',
      '1. Кольчуга и кожаный фартук кузнеца (K1/K2/SKIN)',
      '2. Рогатый кузнечный шлем и пышная рыжая борода',
      '3. Пылающий рунный молот, щит с руной K2 и летящие искры',
    ],
    description:
      'Мастер-кузнец уровня II (36×36 px): коренастый дворф с пышной рыжей бородой, рогатым стальным шлемом, окованным рунным щитом и искрами от раскалённого молота.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(DWARF_SMITH_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(DWARF_SMITH_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderDwarfRunesmith(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(DWARF_SMITH_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'lotus-samurai',
    name: 'Самурай Багряного Лотоса',
    subtitle: 'Воин в доспехах о-ёрой со знаменем сасимоно (36×36)',
    kind: 'unit',
    tier: 'II',
    faction: 'Цитадель',
    width: 36,
    height: 36,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '25×26 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_light',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 13,
    },
    layersSpec: [
      '0. Тень unitShadow_13 под поножами',
      '1. Развевающийся 12-кадровый штандарт сасимоно за спиной',
      '2. Пластинчатый доспех о-ёрой с золотой шнуровкой K1/K2',
      '3. Шлем кабуто с полумесяцем, катана и парный вакидзаси',
    ],
    description:
      'Феодальный мечник уровня II (36×36 px): самурай в шлеме кабуто с золотым полумесяцем, ламеллярной броне K1, изогнутой катаной и живым флагом за спиной.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(SAMURAI_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(SAMURAI_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderLotusSamurai(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(SAMURAI_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'plague-alchemist',
    name: 'Чумной Алхимик',
    subtitle: 'Доктор в клювастой маске с кадилом и колбами (36×36)',
    kind: 'unit',
    tier: 'II',
    faction: 'Гильдия',
    width: 36,
    height: 36,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '24×25 ядро',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 13,
    },
    layersSpec: [
      '0. Тень unitShadow_13 под плащом',
      '1. Длинный волнующийся плащ K1 с мшистой оторочкой',
      '2. Кожаная портупея с пробирками K2 и тёмный сюртук',
      '3. Шляпа с клювом, очки K2, дымящее кадило и пузырящийся эликсир',
    ],
    description:
      'Алхимик уровня II (36×36 px): зловещий доктор в клювастой маске со светящимися линзами, перевязью зелий, волнующимся плащом и дымящимся ядовитым кадилом.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(PLAGUE_ALCHEMIST_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(PLAGUE_ALCHEMIST_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderPlagueAlchemist(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(PLAGUE_ALCHEMIST_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'ether-chronomancer',
    name: 'Хрономант Эфира',
    subtitle: 'Парящий звездочёт с двойной астролябией (40×38)',
    kind: 'unit',
    tier: 'III',
    faction: 'Цитадель',
    width: 40,
    height: 38,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '27×28 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_light',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 14,
    },
    layersSpec: [
      '0. Фиксированная тень unitShadow_14 под левитирующей мантией',
      '1. Встречно-вращающиеся золотой и ледяной кольца астролябии',
      '2. Звёздная мантия K1/K2 с горностаевым воротником',
      '3. Посох песочных часов, сфера времени и орбитальная комета',
    ],
    description:
      'Повелитель времени уровня III (40×38 px): левитирует внутри встречно-вращающихся колец астролябии, с посохом-песочными часами и орбитальной кометой.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(CHRONOMANCER_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(CHRONOMANCER_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderEtherChronomancer(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(CHRONOMANCER_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'sky-aviator',
    name: 'Авиатор-Стрелок',
    subtitle: 'Стимпанк-пилот с вращающимся винтом ранца (34×34)',
    kind: 'unit',
    tier: 'I',
    faction: 'Гильдия',
    width: 34,
    height: 34,
    frameCount: 12,
    defaultFps: 12,
    unitMeta: {
      coreSize: '21×23 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_light',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 11,
    },
    layersSpec: [
      '0. Тень unitShadow_11 под лётными сапогами',
      '1. Реактивный ранец с быстро вращающимся латунным винтом и шарфом',
      '2. Лётная кожаная куртка со стальной пряжкой и ремнями',
      '3. Шлем с очками-гогглами, мушкетон и латунный компас',
    ],
    description:
      'Стрелок уровня I (34×34 px): стимпанк-авиатор в кожаном лётном шлеме с гогглами, развевающимся шарфом, мушкетоном и вращающимся винтом за спиной.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(AVIATOR_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(AVIATOR_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderSkyAviator(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(AVIATOR_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'abyssal-corsair',
    name: 'Корсар Бездны',
    subtitle: 'Морской капитан в треуголке с саблей и пистолем (34×34)',
    kind: 'unit',
    tier: 'I',
    faction: 'Гильдия',
    width: 34,
    height: 34,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '21×23 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_medium',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 11,
    },
    layersSpec: [
      '0. Тень unitShadow_11 под сапогами',
      '1. Колышущийся морской камзол с золотым галуном',
      '2. Тельняшка и кушак K1/K2 с пиратской пряжкой',
      '3. Треуголка с пером, повязка, абордажная сабля и кремнёвый пистоль',
    ],
    description:
      'Пират уровня I (34×34 px): лихой капитан в треуголке с плюмажем K1, повязкой на глазу, развевающимся камзолом, саблей и кремнёвым пистолем.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(CORSAIR_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(CORSAIR_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderAbyssalCorsair(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(CORSAIR_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'dawn-valkyrie',
    name: 'Валькирия Рассвета',
    subtitle: 'Крылатая воительница с солнечным копьём (40×38)',
    kind: 'unit',
    tier: 'III',
    faction: 'Цитадель',
    width: 40,
    height: 38,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '28×27 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_light',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 15,
    },
    layersSpec: [
      '0. Тень unitShadow_15 под позолоченными сабатонами',
      '1. Широкие 12-кадровые перьевые крылья с золотой окантовкой',
      '2. Светлый мифрилово-золотой доспех K1/K2 с латными юбками',
      '3. Крылатый венец, солнечное копьё, щит и искры рассвета',
    ],
    description:
      'Герой уровня III (40×38 px): небесная воительница с широким взмахом перьевых крыльев, золотым венцом, солнечным копьём и лучистым щитом.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(VALKYRIE_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(VALKYRIE_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderDawnValkyrie(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(VALKYRIE_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'dune-sunpriest',
    name: 'Жрец Солнца Дюн',
    subtitle: 'Пустынный пророк в короне и льняных ризах (36×36)',
    kind: 'unit',
    tier: 'II',
    faction: 'Лесной Круг',
    width: 36,
    height: 36,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '23×25 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_medium',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 13,
    },
    layersSpec: [
      '0. Тень unitShadow_13 под сандалиями',
      '1. Плавно струящаяся накидка с золотым краем',
      '2. Белые льняные ризы и ожерелье-пектораль K1/K2',
      '3. Солнечная корона, жезл-анкх и пылающая сфера солнца',
    ],
    description:
      'Жрец уровня II (36×36 px): хранитель пустынных храмов в золотой солнечной короне, белом льняном облачении K1, с жезлом-анкхом и пылающим кадилом.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(SUNPRIEST_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(SUNPRIEST_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderDuneSunpriest(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(SUNPRIEST_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'stag-druid',
    name: 'Друид-Олень',
    subtitle: 'Хранитель рощи в рогатой маске со светлячками (36×36)',
    kind: 'unit',
    tier: 'II',
    faction: 'Лесной Круг',
    width: 36,
    height: 36,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '24×26 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_light',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 13,
    },
    layersSpec: [
      '0. Тень unitShadow_13 под сапогами',
      '1. Мшистый лесной плащ с живой волной',
      '2. Древесная накидка, цветы K1 и лесные обмотки',
      '3. Ветвистые рога оленьего черепа, живой посох, фонарь и светлячки',
    ],
    description:
      'Маг природы уровня II (36×36 px): древний друид в короне из ветвистых оленьих рогов, мшистой накидке с цветами K1 и живым посохом в окружении светлячков.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(STAG_DRUID_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(STAG_DRUID_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderStagDruid(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(STAG_DRUID_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'inferno-executioner',
    name: 'Палач Инферно',
    subtitle: 'Тяжёлый титан в клетчатой маске с секирой (40×38)',
    kind: 'unit',
    tier: 'III',
    faction: 'Кузня Пекла',
    width: 40,
    height: 38,
    frameCount: 12,
    defaultFps: 9,
    unitMeta: {
      coreSize: '27×28 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_red',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 16,
    },
    layersSpec: [
      '0. Тяжёлая тень unitShadow_16 под ногами',
      '1. Обгоревший боевой плащ K1 с тлеющей кромкой',
      '2. Обсидиановая броня с магмовой сердцевиной и рогами',
      '3. Решётчатый шлем с горящими глазами, гигантская секира и жаровня',
    ],
    description:
      'Боец-титан уровня III (40×38 px): грозный палач из Кузни Пекла с раскалённой гигантской секирой, клетчатой рогатой маской, жаровней душ и искрами.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(EXECUTIONER_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(EXECUTIONER_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderInfernoExecutioner(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(EXECUTIONER_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'phantom-assassin',
    name: 'Фантом-Ассасин',
    subtitle: 'Теневой клинок в маске с энергетическими дагами (36×36)',
    kind: 'unit',
    tier: 'II',
    faction: 'Некрополь',
    width: 36,
    height: 36,
    frameCount: 12,
    defaultFps: 12,
    unitMeta: {
      coreSize: '23×25 ядро',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 12,
    },
    layersSpec: [
      '0. Тень unitShadow_12 под походкой',
      '1. Струящийся длинный шарф K1 с бирюзовым следом',
      '2. Плотная чёрно-обсидиановая броня без бликов с акцентами K2',
      '3. Капюшон, светящиеся глаза, парные теневые клинки и кунай',
    ],
    description:
      'Убийца уровня II (36×36 px): бесшумный теневой ассасин в маске со светящимися глазами, длинным развевающимся шарфом, энергетическими клинками и шлейфом.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(ASSASSIN_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(ASSASSIN_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderPhantomAssassin(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(ASSASSIN_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'cyber-warden',
    name: 'Кибер-Страж Маны',
    subtitle: 'Магитек-автоматон с тесла-кольцом и плазма-алебардой (40×38)',
    kind: 'unit',
    tier: 'III',
    faction: 'Гильдия',
    width: 40,
    height: 38,
    frameCount: 12,
    defaultFps: 11,
    unitMeta: {
      coreSize: '26×28 ядро',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 15,
    },
    layersSpec: [
      '0. Тень unitShadow_15 под шасси автоматона',
      '1. Быстро вращающийся спинной тесла-генератор K2/золото',
      '2. Клёпаный мраморно-латунный экзоскелет с пульсирующим реактором',
      '3. Плазменный визор, энергетический баклеp и плазма-алебарда',
    ],
    description:
      'Механический страж уровня III (40×38 px): магитек-автоматон в мраморно-латунном экзоскелете с вращающимся тесла-кольцом, пульсирующим ядром и плазма-алебардой.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(CYBER_WARDEN_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(CYBER_WARDEN_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderCyberWarden(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(CYBER_WARDEN_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
];
