import type {
  LayeredGrid,
  MedievalHumanRole,
  ProceduralAnchors,
  ResolvedHumanProfile,
  UnitAge,
} from './proceduralHuman';
import type { FourToneRamp } from './proceduralPalettes';

export type UnitAnimationAction =
  | 'walk'
  | 'run'
  | 'idle'
  | 'chop'
  | 'mine'
  | 'build'
  | 'gather'
  | 'fish'
  | 'attack-melee'
  | 'attack-ranged'
  | 'cast'
  | 'hit'
  | 'death'
  | 'sleep';

export type UnitCarryItem = 'none' | 'log' | 'stone' | 'basket';

export interface UnitAnimationSpec {
  readonly id: UnitAnimationAction;
  readonly label: string;
  readonly category: 'move' | 'work' | 'combat' | 'state';
  readonly frameCount: 2 | 4;
  readonly frameDurationsMs: readonly number[];
  readonly loop: boolean;
}

export const UNIT_ANIMATION_SPECS: Readonly<Record<UnitAnimationAction, UnitAnimationSpec>> = {
  walk: {
    id: 'walk',
    label: 'Ходьба',
    category: 'move',
    frameCount: 4,
    frameDurationsMs: [160, 160, 160, 160],
    loop: true,
  },
  run: {
    id: 'run',
    label: 'Бег',
    category: 'move',
    frameCount: 4,
    frameDurationsMs: [105, 95, 105, 95],
    loop: true,
  },
  idle: {
    id: 'idle',
    label: 'Покой (дыхание)',
    category: 'move',
    frameCount: 2,
    frameDurationsMs: [460, 220],
    loop: true,
  },
  chop: {
    id: 'chop',
    label: 'Рубка',
    category: 'work',
    frameCount: 4,
    frameDurationsMs: [150, 120, 110, 170],
    loop: true,
  },
  mine: {
    id: 'mine',
    label: 'Добыча',
    category: 'work',
    frameCount: 4,
    frameDurationsMs: [150, 120, 110, 170],
    loop: true,
  },
  build: {
    id: 'build',
    label: 'Стройка',
    category: 'work',
    frameCount: 4,
    frameDurationsMs: [140, 110, 120, 150],
    loop: true,
  },
  gather: {
    id: 'gather',
    label: 'Сбор',
    category: 'work',
    frameCount: 4,
    frameDurationsMs: [160, 150, 150, 160],
    loop: true,
  },
  fish: {
    id: 'fish',
    label: 'Рыбалка',
    category: 'work',
    frameCount: 4,
    frameDurationsMs: [220, 180, 240, 180],
    loop: true,
  },
  'attack-melee': {
    id: 'attack-melee',
    label: 'Удар',
    category: 'combat',
    frameCount: 4,
    frameDurationsMs: [120, 95, 110, 140],
    loop: true,
  },
  'attack-ranged': {
    id: 'attack-ranged',
    label: 'Выстрел из лука',
    category: 'combat',
    frameCount: 4,
    frameDurationsMs: [140, 170, 95, 150],
    loop: true,
  },
  cast: {
    id: 'cast',
    label: 'Каст жреца',
    category: 'combat',
    frameCount: 4,
    frameDurationsMs: [150, 140, 130, 160],
    loop: true,
  },
  hit: {
    id: 'hit',
    label: 'Ранение',
    category: 'state',
    frameCount: 2,
    frameDurationsMs: [110, 150],
    loop: false,
  },
  death: {
    id: 'death',
    label: 'Смерть',
    category: 'state',
    frameCount: 4,
    frameDurationsMs: [120, 130, 140, 600],
    loop: false,
  },
  sleep: {
    id: 'sleep',
    label: 'Сон',
    category: 'state',
    frameCount: 2,
    frameDurationsMs: [560, 560],
    loop: true,
  },
};

export const UNIT_ANIMATION_ACTIONS: readonly UnitAnimationAction[] = [
  'walk',
  'run',
  'idle',
  'chop',
  'mine',
  'build',
  'gather',
  'fish',
  'attack-melee',
  'attack-ranged',
  'cast',
  'hit',
  'death',
  'sleep',
];

export const UNIT_CARRY_ITEMS: readonly { readonly id: UnitCarryItem; readonly label: string }[] = [
  { id: 'none', label: 'Без груза' },
  { id: 'log', label: 'Бревно' },
  { id: 'stone', label: 'Камень' },
  { id: 'basket', label: 'Корзина' },
];

export function getUnitActionSpec(action: UnitAnimationAction = 'walk'): UnitAnimationSpec {
  return UNIT_ANIMATION_SPECS[action] ?? UNIT_ANIMATION_SPECS.walk;
}

export function normalizeActionFrameIndex(
  action: UnitAnimationAction,
  rawFrameIndex = 0
): number {
  const count = getUnitActionSpec(action).frameCount;
  return ((rawFrameIndex % count) + count) % count;
}

export interface MedievalAnimPalette {
  readonly linenLight: string;
  readonly linenShadow: string;
  readonly leatherMid: string;
  readonly leatherDark: string;
  readonly steelLight: string;
  readonly steelShadow: string;
  readonly bronzeLight: string;
  readonly bronzeDark: string;
  readonly boneLight: string;
  readonly boneDark: string;
  readonly goldLight: string;
  readonly goldShadow: string;
  readonly darkCloth: string;
  readonly statusWound: string;
  readonly statusSick: string;
  readonly statusPossessed: string;
  readonly cyanEye: string;
}

export interface MedievalAnimRenderDeps {
  readonly mat: MedievalAnimPalette;
  readonly getEffectiveSkinRamp: (p: ResolvedHumanProfile) => FourToneRamp;
  readonly getEffectiveK2MidAndShadow: (p: ResolvedHumanProfile) => readonly [string, string];
  readonly getMetalPair: (era: ResolvedHumanProfile['era']) => readonly [string, string];
  readonly applyStatusSignLayer: (g: LayeredGrid, p: ResolvedHumanProfile, dy: number) => void;
}

interface FramePose {
  readonly bodyDx: number;
  readonly torsoDy: number;
  readonly headDx: number;
  readonly headDy: number;
  readonly blink: boolean;
  readonly leftArmX: number;
  readonly leftArmY: number;
  readonly leftHandX: number;
  readonly leftHandY: number;
  readonly rightArmX: number;
  readonly rightArmY: number;
  readonly rightHandX: number;
  readonly rightHandY: number;
  readonly leftLegX: number;
  readonly leftLegY: number;
  readonly rightLegX: number;
  readonly rightLegY: number;
  readonly weaponPose:
    | 'rest'
    | 'swing-back'
    | 'swing-high'
    | 'swing-strike'
    | 'swing-low'
    | 'bow-aim'
    | 'bow-draw'
    | 'bow-shoot'
    | 'cast-raise'
    | 'cast-charge'
    | 'cast-burst'
    | 'rod-back'
    | 'rod-cast'
    | 'rod-idle'
    | 'rod-pull'
    | 'recoil'
    | 'carry';
  readonly posture: 'standing' | 'kneeling' | 'falling' | 'lying';
}

function clampCoord(v: number, min = 0, max = 9): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Computes dynamic per-frame anchors for `walk` (preserving exact Stage 1 hand/feet coordinates).
 */
export function computeWalkAnchors(
  age: UnitAge,
  role: MedievalHumanRole,
  gender: ResolvedHumanProfile['gender'],
  frameIndex: number,
  dy: number,
  carry: UnitCarryItem
): ProceduralAnchors {
  if (age === 'child') {
    const f = frameIndex % 4;
    const armBobL = carry !== 'none' ? -1 : f === 1 ? -1 : 0;
    const armBobR = carry !== 'none' ? -1 : f === 3 ? -1 : 0;
    return {
      pivot: { x: 4, y: 9 },
      head: { x: 3, y: 3, w: 4, h: 3 },
      face: { x: 4, y: 4 },
      belt: { x: 4, y: 7, w: 2 },
      hand: {
        leftX: 3,
        leftY: clampCoord(6 + armBobL),
        rightX: 6,
        rightY: clampCoord(6 + armBobR),
      },
      feetY: 9,
    };
  }
  if (role === 'cavalry') {
    const f = frameIndex % 4;
    const ry = clampCoord(4 + dy + (f === 1 ? -1 : f === 3 ? 1 : 0));
    return {
      pivot: { x: 4, y: 9 },
      head: { x: 4, y: 1 + dy, w: 3, h: 3 },
      face: { x: 4, y: 2 + dy },
      belt: { x: 4, y: 5 + dy, w: 3 },
      hand: { leftX: 3, leftY: clampCoord(4 + dy), rightX: 7, rightY: ry },
      feetY: 9,
    };
  }
  const f = frameIndex % 4;
  const armLX = gender === 'female' ? 3 : 2;
  const armRX = gender === 'female' ? 6 : 7;
  const torsoY = 4 + dy;
  const armBobL = carry !== 'none' ? -1 : f === 1 ? -1 : f === 3 ? 1 : 0;
  const armBobR = carry !== 'none' ? -1 : -armBobL;
  return {
    pivot: { x: 4, y: 9 },
    head: { x: 3, y: clampCoord(1 + dy), w: 4, h: 3 },
    face: { x: 4, y: clampCoord(2 + dy) },
    belt: { x: 3, y: clampCoord(6 + dy), w: 4 },
    hand: {
      leftX: armLX,
      leftY: clampCoord(torsoY + 1 + armBobL),
      rightX: armRX,
      rightY: clampCoord(torsoY + 1 + armBobR),
    },
    feetY: 9,
  };
}

function getPoseForAction(
  p: ResolvedHumanProfile,
  action: UnitAnimationAction,
  dy: number,
  carry: UnitCarryItem
): FramePose {
  const f = normalizeActionFrameIndex(action, p.frameIndex);
  const narrow = p.gender === 'female';
  const baseLeftX = narrow ? 3 : 2;
  const baseRightX = narrow ? 6 : 7;
  const baseLegL = narrow ? 4 : 3;
  const baseLegR = narrow ? 5 : 6;
  const isChild = p.age === 'child';

  if (action === 'walk') {
    const ty = isChild ? 1 : dy;
    const carrying = carry !== 'none';
    const armBobL = carrying ? -1 : f === 1 ? -1 : f === 3 ? 1 : 0;
    const armBobR = carrying ? -1 : -armBobL;
    return {
      bodyDx: 0,
      torsoDy: ty,
      headDx: 0,
      headDy: ty,
      blink: false,
      leftArmX: baseLeftX,
      leftArmY: clampCoord(4 + ty + (carrying ? -1 : armBobL)),
      leftHandX: baseLeftX,
      leftHandY: clampCoord(5 + ty + (carrying ? -2 : armBobL)),
      rightArmX: baseRightX,
      rightArmY: clampCoord(4 + ty + (carrying ? -1 : armBobR)),
      rightHandX: baseRightX,
      rightHandY: clampCoord(5 + ty + (carrying ? -2 : armBobR)),
      leftLegX: baseLegL,
      leftLegY: f === 1 ? 8 : 9,
      rightLegX: baseLegR,
      rightLegY: f === 3 ? 8 : 9,
      weaponPose: carrying ? 'carry' : 'rest',
      posture: 'standing',
    };
  }

  if (action === 'idle') {
    const breathe = f === 1 ? 1 : 0;
    const ty = isChild ? 1 : 0;
    return {
      bodyDx: 0,
      torsoDy: ty,
      headDx: 0,
      headDy: ty,
      blink: f === 1,
      leftArmX: baseLeftX,
      leftArmY: clampCoord(4 + ty),
      leftHandX: baseLeftX,
      leftHandY: clampCoord(5 + ty + breathe),
      rightArmX: baseRightX,
      rightArmY: clampCoord(4 + ty),
      rightHandX: baseRightX,
      rightHandY: clampCoord(5 + ty + breathe),
      leftLegX: baseLegL,
      leftLegY: 9,
      rightLegX: baseLegR,
      rightLegY: 9,
      weaponPose: 'rest',
      posture: 'standing',
    };
  }

  if (action === 'run') {
    // Energetic 4-frame sprint: alternating stride + 1px forward torso lean, grounded on feetY=9
    const lean = f === 1 || f === 3 ? 1 : 0;
    const bounce = isChild ? 1 : f === 1 || f === 3 ? -1 : 0;
    const leftHandDx = f === 0 ? -1 : f === 2 ? 1 : 0;
    const rightHandDy = f === 2 ? -1 : 0;
    return {
      bodyDx: 0,
      torsoDy: bounce,
      headDx: lean,
      headDy: bounce,
      blink: false,
      leftArmX: baseLeftX,
      leftArmY: clampCoord(4 + bounce),
      leftHandX: clampCoord(baseLeftX + leftHandDx),
      leftHandY: clampCoord(5 + bounce + (f === 1 ? -1 : 0)),
      rightArmX: baseRightX,
      rightArmY: clampCoord(4 + bounce),
      rightHandX: clampCoord(baseRightX + (f === 0 ? 1 : 0)),
      rightHandY: clampCoord(5 + bounce + rightHandDy),
      leftLegX: clampCoord(baseLegL + (f === 0 ? -1 : f === 2 ? 1 : 0)),
      leftLegY: f === 1 ? 8 : 9,
      rightLegX: clampCoord(baseLegR + (f === 2 ? 1 : f === 0 ? 0 : 1)),
      rightLegY: f === 3 ? 8 : 9,
      weaponPose: f === 1 || f === 3 ? 'swing-low' : 'rest',
      posture: 'standing',
    };
  }

  if (action === 'chop' || action === 'mine' || action === 'build') {
    // 4-frame overhead swing: 0=windup back, 1=apex high, 2=strike down, 3=recover
    const ty = isChild ? 1 : 0;
    if (f === 0) {
      return {
        bodyDx: 0,
        torsoDy: ty,
        headDx: 0,
        headDy: ty,
        blink: false,
        leftArmX: baseLeftX,
        leftArmY: 4 + ty,
        leftHandX: baseLeftX,
        leftHandY: 5 + ty,
        rightArmX: baseRightX,
        rightArmY: 3 + ty,
        rightHandX: 6,
        rightHandY: 3 + ty,
        leftLegX: baseLegL,
        leftLegY: 9,
        rightLegX: baseLegR,
        rightLegY: 9,
        weaponPose: 'swing-back',
        posture: 'standing',
      };
    }
    if (f === 1) {
      return {
        bodyDx: 0,
        torsoDy: ty,
        headDx: 0,
        headDy: ty,
        blink: false,
        leftArmX: baseLeftX,
        leftArmY: 4 + ty,
        leftHandX: baseLeftX,
        leftHandY: 4 + ty,
        rightArmX: 7,
        rightArmY: 2 + ty,
        rightHandX: 7,
        rightHandY: 2 + ty,
        leftLegX: baseLegL,
        leftLegY: 9,
        rightLegX: baseLegR,
        rightLegY: 9,
        weaponPose: 'swing-high',
        posture: 'standing',
      };
    }
    if (f === 2) {
      return {
        bodyDx: 1,
        torsoDy: ty,
        headDx: 1,
        headDy: ty,
        blink: false,
        leftArmX: baseLeftX + 1,
        leftArmY: 4 + ty,
        leftHandX: baseLeftX + 1,
        leftHandY: 5 + ty,
        rightArmX: 8,
        rightArmY: 4 + ty,
        rightHandX: 8,
        rightHandY: 5 + ty,
        leftLegX: baseLegL,
        leftLegY: 9,
        rightLegX: clampCoord(baseLegR + 1),
        rightLegY: 9,
        weaponPose: 'swing-strike',
        posture: 'standing',
      };
    }
    return {
      bodyDx: 0,
      torsoDy: ty,
      headDx: 0,
      headDy: ty,
      blink: false,
      leftArmX: baseLeftX,
      leftArmY: 4 + ty,
      leftHandX: baseLeftX,
      leftHandY: 5 + ty,
      rightArmX: baseRightX,
      rightArmY: 4 + ty,
      rightHandX: 7,
      rightHandY: 5 + ty,
      leftLegX: baseLegL,
      leftLegY: 9,
      rightLegX: baseLegR,
      rightLegY: 9,
      weaponPose: 'swing-low',
      posture: 'standing',
    };
  }

  if (action === 'gather') {
    // 4-frame crouch & harvest: 0=reach, 1=crouch low, 2=scoop, 3=rise with bundle
    const crouch = f === 1 ? 2 : f === 2 ? 1 : 0;
    const ty = isChild ? 1 : 0;
    const dx = f === 1 || f === 2 ? 1 : 0;
    return {
      bodyDx: dx,
      torsoDy: crouch + ty,
      headDx: dx,
      headDy: crouch + ty,
      blink: false,
      leftArmX: f === 1 ? 4 : baseLeftX + dx,
      leftArmY: clampCoord(4 + crouch + ty),
      leftHandX: f === 1 ? 5 : clampCoord(baseLeftX + dx + 1),
      leftHandY: clampCoord(5 + crouch + ty),
      rightArmX: clampCoord(baseRightX + dx),
      rightArmY: clampCoord(4 + crouch + ty),
      rightHandX: f === 1 || f === 2 ? 8 : 7,
      rightHandY: clampCoord(f === 1 ? 7 : f === 2 ? 6 : 5 + ty),
      leftLegX: baseLegL,
      leftLegY: 9,
      rightLegX: baseLegR,
      rightLegY: 9,
      weaponPose: f === 0 ? 'swing-low' : f === 1 ? 'swing-strike' : f === 2 ? 'swing-low' : 'rest',
      posture: f === 1 || f === 2 ? 'kneeling' : 'standing',
    };
  }

  if (action === 'fish') {
    const ty = isChild ? 1 : 0;
    const rodPose = f === 0 ? 'rod-back' : f === 1 ? 'rod-cast' : f === 2 ? 'rod-idle' : 'rod-pull';
    const rx = f === 0 ? 6 : 7;
    const ry = f === 0 ? 4 + ty : f === 3 ? 3 + ty : 5 + ty;
    return {
      bodyDx: 0,
      torsoDy: ty,
      headDx: 0,
      headDy: ty,
      blink: false,
      leftArmX: baseLeftX,
      leftArmY: 4 + ty,
      leftHandX: baseLeftX,
      leftHandY: 5 + ty,
      rightArmX: rx,
      rightArmY: clampCoord(ry - 1),
      rightHandX: rx,
      rightHandY: ry,
      leftLegX: baseLegL,
      leftLegY: 9,
      rightLegX: baseLegR,
      rightLegY: 9,
      weaponPose: rodPose,
      posture: 'standing',
    };
  }

  if (action === 'attack-melee') {
    // 4-frame melee combat: 0=windup, 1=lunge strike, 2=follow-through, 3=guard
    const ty = isChild ? 1 : 0;
    if (f === 0) {
      return {
        bodyDx: 0,
        torsoDy: ty,
        headDx: 0,
        headDy: ty,
        blink: false,
        leftArmX: baseLeftX,
        leftArmY: 4 + ty,
        leftHandX: baseLeftX,
        leftHandY: 5 + ty,
        rightArmX: 6,
        rightArmY: 3 + ty,
        rightHandX: 6,
        rightHandY: 3 + ty,
        leftLegX: clampCoord(baseLegL - 1),
        leftLegY: 9,
        rightLegX: baseLegR,
        rightLegY: 9,
        weaponPose: 'swing-back',
        posture: 'standing',
      };
    }
    if (f === 1) {
      return {
        bodyDx: 1,
        torsoDy: ty,
        headDx: 1,
        headDy: ty,
        blink: false,
        leftArmX: baseLeftX + 1,
        leftArmY: 4 + ty,
        leftHandX: baseLeftX + 1,
        leftHandY: 5 + ty,
        rightArmX: 8,
        rightArmY: 4 + ty,
        rightHandX: 8,
        rightHandY: 5 + ty,
        leftLegX: baseLegL,
        leftLegY: 9,
        rightLegX: clampCoord(baseLegR + 1),
        rightLegY: 9,
        weaponPose: 'swing-strike',
        posture: 'standing',
      };
    }
    if (f === 2) {
      return {
        bodyDx: 1,
        torsoDy: ty,
        headDx: 1,
        headDy: ty,
        blink: false,
        leftArmX: baseLeftX + 1,
        leftArmY: 4 + ty,
        leftHandX: baseLeftX + 1,
        leftHandY: 5 + ty,
        rightArmX: 8,
        rightArmY: 5 + ty,
        rightHandX: 8,
        rightHandY: 6 + ty,
        leftLegX: baseLegL,
        leftLegY: 9,
        rightLegX: clampCoord(baseLegR + 1),
        rightLegY: 9,
        weaponPose: 'swing-low',
        posture: 'standing',
      };
    }
    return {
      bodyDx: 0,
      torsoDy: ty,
      headDx: 0,
      headDy: ty,
      blink: false,
      leftArmX: baseLeftX,
      leftArmY: 4 + ty,
      leftHandX: baseLeftX,
      leftHandY: 5 + ty,
      rightArmX: baseRightX,
      rightArmY: 4 + ty,
      rightHandX: baseRightX,
      rightHandY: 5 + ty,
      leftLegX: baseLegL,
      leftLegY: 9,
      rightLegX: baseLegR,
      rightLegY: 9,
      weaponPose: 'rest',
      posture: 'standing',
    };
  }

  if (action === 'attack-ranged') {
    const ty = isChild ? 1 : 0;
    const pose = f === 0 ? 'bow-aim' : f === 1 ? 'bow-draw' : f === 2 ? 'bow-shoot' : 'rest';
    return {
      bodyDx: 0,
      torsoDy: ty,
      headDx: 0,
      headDy: ty,
      blink: false,
      leftArmX: baseLeftX,
      leftArmY: 4 + ty,
      leftHandX: f === 1 ? 5 : 6,
      leftHandY: 4 + ty,
      rightArmX: 7,
      rightArmY: 4 + ty,
      rightHandX: 7,
      rightHandY: 4 + ty,
      leftLegX: baseLegL,
      leftLegY: 9,
      rightLegX: baseLegR,
      rightLegY: 9,
      weaponPose: pose,
      posture: 'standing',
    };
  }

  if (action === 'cast') {
    const ty = isChild ? 1 : 0;
    const pose = f === 0 ? 'cast-raise' : f === 1 ? 'cast-charge' : f === 2 ? 'cast-burst' : 'rest';
    return {
      bodyDx: 0,
      torsoDy: ty,
      headDx: 0,
      headDy: ty,
      blink: f === 2,
      leftArmX: baseLeftX,
      leftArmY: f === 1 || f === 2 ? 3 + ty : 4 + ty,
      leftHandX: baseLeftX,
      leftHandY: f === 1 || f === 2 ? 2 + ty : 5 + ty,
      rightArmX: 7,
      rightArmY: f === 0 ? 4 + ty : 3 + ty,
      rightHandX: 7,
      rightHandY: f === 1 || f === 2 ? 3 + ty : 4 + ty,
      leftLegX: baseLegL,
      leftLegY: 9,
      rightLegX: baseLegR,
      rightLegY: 9,
      weaponPose: pose,
      posture: 'standing',
    };
  }

  if (action === 'hit') {
    // 2-frame impact flinch: 0=knockback recoil, 1=hunched recovery
    const ty = isChild ? 1 : 0;
    return {
      bodyDx: f === 0 ? -1 : 0,
      torsoDy: ty + (f === 1 ? 1 : 0),
      headDx: f === 0 ? -1 : 0,
      headDy: ty + (f === 1 ? 1 : 0),
      blink: f === 0,
      leftArmX: clampCoord(baseLeftX - (f === 0 ? 1 : 0)),
      leftArmY: 4 + ty,
      leftHandX: clampCoord(baseLeftX - (f === 0 ? 1 : 0)),
      leftHandY: 3 + ty,
      rightArmX: clampCoord(baseRightX - (f === 0 ? 1 : 0)),
      rightArmY: 4 + ty,
      rightHandX: f === 0 ? 6 : 7,
      rightHandY: f === 0 ? 4 + ty : 6 + ty,
      leftLegX: clampCoord(baseLegL - (f === 0 ? 1 : 0)),
      leftLegY: 9,
      rightLegX: clampCoord(baseLegR - (f === 0 ? 1 : 0)),
      rightLegY: 9,
      weaponPose: 'recoil',
      posture: 'standing',
    };
  }

  if (action === 'death') {
    // 4-frame collapse: 0=stagger, 1=kneel drop, 2=falling low, 3=lying flat corpse at y=7..9
    if (f === 0) {
      return {
        bodyDx: -1,
        torsoDy: isChild ? 1 : 0,
        headDx: -1,
        headDy: isChild ? 1 : 0,
        blink: true,
        leftArmX: 1,
        leftArmY: 4,
        leftHandX: 1,
        leftHandY: 5,
        rightArmX: 6,
        rightArmY: 4,
        rightHandX: 6,
        rightHandY: 5,
        leftLegX: 2,
        leftLegY: 9,
        rightLegX: 5,
        rightLegY: 9,
        weaponPose: 'recoil',
        posture: 'standing',
      };
    }
    if (f === 1) {
      return {
        bodyDx: -1,
        torsoDy: 2,
        headDx: -1,
        headDy: 2,
        blink: true,
        leftArmX: 1,
        leftArmY: 6,
        leftHandX: 1,
        leftHandY: 7,
        rightArmX: 6,
        rightArmY: 6,
        rightHandX: 6,
        rightHandY: 7,
        leftLegX: 3,
        leftLegY: 9,
        rightLegX: 6,
        rightLegY: 9,
        weaponPose: 'swing-low',
        posture: 'kneeling',
      };
    }
    if (f === 2) {
      return {
        bodyDx: 1,
        torsoDy: 3,
        headDx: -2,
        headDy: 4,
        blink: true,
        leftArmX: 2,
        leftArmY: 7,
        leftHandX: 2,
        leftHandY: 8,
        rightArmX: 7,
        rightArmY: 7,
        rightHandX: 7,
        rightHandY: 8,
        leftLegX: 5,
        leftLegY: 9,
        rightLegX: 7,
        rightLegY: 9,
        weaponPose: 'swing-low',
        posture: 'falling',
      };
    }
    return {
      bodyDx: 0,
      torsoDy: 4,
      headDx: 0,
      headDy: 6,
      blink: true,
      leftArmX: 3,
      leftArmY: 8,
      leftHandX: 3,
      leftHandY: 9,
      rightArmX: 5,
      rightArmY: 8,
      rightHandX: 5,
      rightHandY: 8,
      leftLegX: 7,
      leftLegY: 9,
      rightLegX: 8,
      rightLegY: 9,
      weaponPose: 'swing-low',
      posture: 'lying',
    };
  }

  // 'sleep' (2 frames: breathing rise while lying on ground y=7..9)
  return {
    bodyDx: 0,
    torsoDy: 4,
    headDx: 0,
    headDy: 6,
    blink: true,
    leftArmX: 3,
    leftArmY: 8,
    leftHandX: 3,
    leftHandY: 8,
    rightArmX: 5,
    rightArmY: 8,
    rightHandX: 5,
    rightHandY: 8,
    leftLegX: 7,
    leftLegY: 9,
    rightLegX: 8,
    rightLegY: 9,
    weaponPose: 'rest',
    posture: 'lying',
  };
}

function drawToolInHand(
  g: LayeredGrid,
  p: ResolvedHumanProfile,
  pose: FramePose,
  action: UnitAnimationAction,
  deps: MedievalAnimRenderDeps
): void {
  if (p.status === 'captive') return;

  const { mat, getMetalPair } = deps;
  const k1 = p.kingdom.k1Ramp;
  const [metalLight, metalDark] = getMetalPair(p.era);
  const rx = pose.rightHandX;
  const ry = pose.rightHandY;
  const lx = pose.leftHandX;
  const ly = pose.leftHandY;

  // Flat weapon resting beside hand on lying/death-end/sleep frames
  if (pose.posture === 'lying') {
    if (action === 'death') {
      // Weapon lies flat along feetY=9 right under hand (5,8)
      const tipColor =
        p.role === 'king' || p.role === 'cleric' || p.role === 'queen'
          ? mat.goldLight
          : p.role === 'archer'
            ? mat.leatherMid
            : metalLight;
      g.set(rx, clampCoord(ry + 1), mat.leatherDark, 'wood');
      g.set(clampCoord(rx + 1), clampCoord(ry + 1), tipColor, p.role === 'archer' ? 'wood' : 'metal');
      g.set(clampCoord(rx + 2), clampCoord(ry + 1), tipColor, p.role === 'archer' ? 'wood' : 'metal');
    } else if (action === 'sleep') {
      // Weapon leaned right at (rx, ry+1)
      g.set(clampCoord(rx - 1), 9, mat.leatherDark, 'wood');
      g.set(rx, 9, mat.leatherMid, 'wood');
    }
    return;
  }

  // Work actions render specific work tools anchored directly at rightHand (rx, ry)
  if (action === 'chop') {
    // Stump/log target connected on right edge (x=8..9, y=8..9) using wood colors
    g.set(8, 8, mat.leatherMid, 'wood');
    g.set(9, 8, mat.leatherDark, 'wood');
    g.set(8, 9, mat.leatherDark, 'wood');
    g.set(9, 9, mat.leatherDark, 'wood');

    if (pose.weaponPose === 'swing-back') {
      g.set(rx, ry, mat.leatherMid, 'wood');
      g.set(clampCoord(rx - 1), clampCoord(ry - 1), mat.leatherMid, 'wood');
      g.set(clampCoord(rx - 1), clampCoord(ry - 2), metalLight, 'metal');
      g.set(clampCoord(rx - 2), clampCoord(ry - 1), metalDark, 'metal');
    } else if (pose.weaponPose === 'swing-high') {
      g.set(rx, clampCoord(ry - 1), mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 1), clampCoord(ry - 2), mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 2), clampCoord(ry - 2), metalLight, 'metal');
      g.set(clampCoord(rx + 2), clampCoord(ry - 1), metalDark, 'metal');
    } else if (pose.weaponPose === 'swing-strike') {
      g.set(rx, ry, mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 1), clampCoord(ry + 1), mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 1), clampCoord(ry + 2), metalLight, 'metal');
      g.set(clampCoord(rx + 1), clampCoord(ry + 3), mat.linenLight, 'cloth');
    } else {
      g.set(clampCoord(rx + 1), ry, mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 1), clampCoord(ry - 1), mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 2), clampCoord(ry - 2), metalLight, 'metal');
      g.set(clampCoord(rx + 2), clampCoord(ry - 1), metalDark, 'metal');
    }
    return;
  }

  if (action === 'mine') {
    // Rock vein target at (8..9, 8..9)
    g.set(8, 8, mat.steelShadow, 'metal');
    g.set(9, 8, mat.darkCloth, 'cloth');
    g.set(8, 9, mat.darkCloth, 'cloth');
    g.set(9, 9, mat.steelShadow, 'metal');

    if (pose.weaponPose === 'swing-back') {
      g.set(rx, ry, mat.leatherMid, 'wood');
      g.set(clampCoord(rx - 1), clampCoord(ry - 1), mat.leatherMid, 'wood');
      g.set(clampCoord(rx - 2), clampCoord(ry - 1), metalLight, 'metal');
      g.set(rx, clampCoord(ry - 2), metalDark, 'metal');
    } else if (pose.weaponPose === 'swing-high') {
      g.set(rx, clampCoord(ry - 1), mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 1), clampCoord(ry - 2), metalLight, 'metal');
      g.set(rx, clampCoord(ry - 2), metalDark, 'metal');
      g.set(clampCoord(rx + 2), clampCoord(ry - 1), metalLight, 'metal');
    } else if (pose.weaponPose === 'swing-strike') {
      g.set(rx, ry, mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 1), clampCoord(ry + 1), metalLight, 'metal');
      g.set(clampCoord(rx + 1), clampCoord(ry + 2), mat.goldLight, 'gold'); // strike spark connected to rock!
    } else {
      g.set(clampCoord(rx + 1), ry, mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 1), clampCoord(ry - 1), metalLight, 'metal');
      g.set(clampCoord(rx + 2), clampCoord(ry - 1), metalDark, 'metal');
    }
    return;
  }

  if (action === 'build') {
    // Timber post being nailed at (8..9, 7..9)
    g.set(9, 7, mat.leatherMid, 'wood');
    g.set(9, 8, mat.leatherMid, 'wood');
    g.set(9, 9, mat.leatherDark, 'wood');
    g.set(8, 9, mat.leatherDark, 'wood');

    if (pose.weaponPose === 'swing-back' || pose.weaponPose === 'swing-high') {
      g.set(rx, clampCoord(ry - 1), mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 1), clampCoord(ry - 2), metalLight, 'metal');
      g.set(rx, clampCoord(ry - 2), metalDark, 'metal');
    } else if (pose.weaponPose === 'swing-strike') {
      g.set(rx, ry, mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 1), ry, metalLight, 'metal');
      g.set(clampCoord(rx + 1), clampCoord(ry + 1), metalDark, 'metal');
    } else {
      g.set(clampCoord(rx + 1), ry, mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 1), clampCoord(ry - 1), metalLight, 'metal');
      g.set(clampCoord(rx + 2), clampCoord(ry - 1), metalDark, 'metal');
    }
    return;
  }

  if (action === 'gather') {
    // Harvest tuft/bundle anchored cleanly at hand
    if (pose.posture === 'kneeling') {
      g.set(clampCoord(rx), clampCoord(ry + 1), mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 1), clampCoord(ry + 1), mat.goldLight, 'gold');
      g.set(clampCoord(rx), 9, mat.leatherDark, 'wood');
      g.set(clampCoord(rx + 1), 9, mat.leatherDark, 'wood');
    } else if (pose.weaponPose === 'rest') {
      g.set(clampCoord(rx + 1), ry, mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 1), clampCoord(ry - 1), mat.goldLight, 'gold');
    }
    return;
  }

  if (action === 'fish') {
    if (pose.weaponPose === 'rod-back') {
      g.set(rx, clampCoord(ry - 1), mat.leatherMid, 'wood');
      g.set(clampCoord(rx - 1), clampCoord(ry - 2), mat.leatherMid, 'wood');
      g.set(clampCoord(rx - 2), clampCoord(ry - 3), mat.leatherDark, 'wood');
    } else if (pose.weaponPose === 'rod-cast') {
      g.set(clampCoord(rx + 1), clampCoord(ry - 1), mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 2), clampCoord(ry - 2), mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 2), clampCoord(ry - 1), mat.linenLight, 'cloth');
    } else if (pose.weaponPose === 'rod-idle') {
      g.set(clampCoord(rx + 1), clampCoord(ry - 1), mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 2), clampCoord(ry - 2), mat.leatherMid, 'wood');
      // Vertical connected fishing line + crimson bobber
      g.set(9, clampCoord(ry - 1), mat.linenLight, 'cloth');
      g.set(9, clampCoord(ry), mat.linenLight, 'cloth');
      g.set(9, clampCoord(ry + 1), mat.linenLight, 'cloth');
      g.set(9, clampCoord(ry + 2), k1[1], 'k1');
    } else {
      // rod-pull (bite!)
      g.set(clampCoord(rx + 1), clampCoord(ry - 1), mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 2), clampCoord(ry - 2), mat.leatherMid, 'wood');
      g.set(9, clampCoord(ry - 1), mat.linenLight, 'cloth');
      g.set(9, clampCoord(ry), mat.steelLight, 'metal'); // fish catch gleaming on line!
    }
    return;
  }

  if (action === 'attack-ranged') {
    const bowX = 8;
    if (pose.weaponPose === 'bow-aim') {
      g.set(bowX, 2, mat.leatherMid, 'wood');
      g.set(bowX + 1, 3, mat.leatherMid, 'wood');
      g.set(bowX + 1, 4, mat.leatherMid, 'wood');
      g.set(bowX + 1, 5, mat.leatherDark, 'wood');
      g.set(bowX, 6, mat.leatherDark, 'wood');
      g.set(rx, ry, mat.linenLight, 'cloth');
    } else if (pose.weaponPose === 'bow-draw') {
      g.set(bowX, 2, mat.leatherMid, 'wood');
      g.set(bowX + 1, 3, mat.leatherMid, 'wood');
      g.set(bowX + 1, 4, mat.leatherDark, 'wood');
      g.set(bowX + 1, 5, mat.leatherDark, 'wood');
      g.set(bowX, 6, mat.leatherDark, 'wood');
      // Drawn string + nocked arrow touching hand (rx, ry=4)
      g.set(rx, 3, mat.linenLight, 'cloth');
      g.set(rx, 5, mat.linenLight, 'cloth');
      g.set(rx, 4, mat.leatherMid, 'wood');
      g.set(bowX, 4, mat.steelLight, 'metal');
    } else if (pose.weaponPose === 'bow-shoot') {
      g.set(bowX, 2, mat.leatherMid, 'wood');
      g.set(bowX + 1, 3, mat.leatherMid, 'wood');
      g.set(bowX + 1, 5, mat.leatherDark, 'wood');
      g.set(bowX, 6, mat.leatherDark, 'wood');
      // Released arrow speeding past bow (connected 2px)
      g.set(bowX, 4, mat.linenLight, 'cloth');
      g.set(9, 4, mat.steelLight, 'metal');
    } else {
      g.set(bowX, 3, mat.leatherMid, 'wood');
      g.set(bowX, 4, mat.leatherMid, 'wood');
      g.set(bowX, 5, mat.leatherDark, 'wood');
      g.set(bowX, 6, mat.leatherDark, 'wood');
    }
    return;
  }

  if (action === 'cast') {
    const sx = clampCoord(rx + 1);
    if (pose.weaponPose === 'cast-raise') {
      for (let y = 1; y <= 7; y++) g.set(sx, y, mat.leatherMid, 'wood');
      g.set(sx, 1, mat.goldLight, 'gold');
      g.set(clampCoord(sx + 1), 1, mat.goldShadow, 'gold');
    } else if (pose.weaponPose === 'cast-charge') {
      for (let y = 2; y <= 7; y++) g.set(sx, y, mat.leatherMid, 'wood');
      g.set(sx, 0, mat.cyanEye, 'status');
      g.set(sx, 1, mat.goldLight, 'gold');
      g.set(clampCoord(sx + 1), 0, mat.goldLight, 'gold');
      g.set(clampCoord(sx + 1), 1, mat.cyanEye, 'status');
    } else if (pose.weaponPose === 'cast-burst') {
      for (let y = 2; y <= 7; y++) g.set(sx, y, mat.leatherMid, 'wood');
      g.set(sx, 0, mat.goldLight, 'gold');
      g.set(clampCoord(sx + 1), 0, mat.cyanEye, 'status');
      g.set(clampCoord(sx + 1), 1, mat.goldLight, 'gold');
      g.set(sx, 1, mat.goldLight, 'gold');
      // Left channeling spark attached to left hand
      g.set(clampCoord(lx - 1), ly, mat.cyanEye, 'status');
    } else {
      for (let y = 2; y <= 8; y++) g.set(sx, y, mat.leatherMid, 'wood');
      g.set(sx, 1, mat.goldLight, 'gold');
    }
    return;
  }

  // Standard Melee / Idle / Run / Hit weapon attached cleanly to rightHand (rx, ry)!
  const weaponKind: 'sword' | 'spear' | 'club' | 'staff' | 'bow' =
    p.role === 'archer'
      ? 'bow'
      : p.role === 'cleric' || p.role === 'king'
        ? 'staff'
        : p.role === 'peasant' || p.role === 'cavalry' || p.role === 'settlement-leader'
          ? 'spear'
          : p.role === 'worker' || p.role === 'merchant'
            ? 'club'
            : 'sword';

  const wx = clampCoord(rx + 1);
  if (pose.weaponPose === 'swing-back') {
    if (weaponKind === 'bow') {
      g.set(wx, clampCoord(ry - 1), mat.leatherMid, 'wood');
      g.set(wx, ry, mat.leatherDark, 'wood');
      g.set(wx, clampCoord(ry + 1), mat.leatherDark, 'wood');
    } else {
      g.set(rx, clampCoord(ry - 1), mat.leatherDark, 'wood');
      g.set(clampCoord(rx - 1), clampCoord(ry - 2), metalLight, 'metal');
      g.set(rx, clampCoord(ry - 2), metalDark, 'metal');
    }
    return;
  }

  if (pose.weaponPose === 'swing-strike') {
    if (weaponKind === 'spear') {
      g.set(rx, ry, mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 1), ry, metalLight, 'metal');
      g.set(clampCoord(rx + 1), clampCoord(ry - 1), mat.linenLight, 'cloth');
    } else if (weaponKind === 'club') {
      g.set(rx, ry, mat.leatherMid, 'wood');
      g.set(clampCoord(rx + 1), ry, mat.leatherDark, 'wood');
      g.set(clampCoord(rx + 1), clampCoord(ry + 1), metalLight, 'metal');
      g.set(clampCoord(rx + 1), clampCoord(ry - 1), mat.linenLight, 'cloth');
    } else {
      // Horizontal/diagonal forward slash attached at (rx, ry)
      g.set(rx, ry, mat.goldLight, 'gold');
      g.set(clampCoord(rx + 1), clampCoord(ry - 1), metalLight, 'metal');
      g.set(clampCoord(rx + 1), ry, metalLight, 'metal');
      g.set(clampCoord(rx + 1), clampCoord(ry - 2), mat.linenLight, 'cloth');
    }
    return;
  }

  if (pose.weaponPose === 'swing-low') {
    g.set(rx, ry, mat.leatherDark, 'wood');
    g.set(clampCoord(rx + 1), clampCoord(ry + 1), metalLight, 'metal');
    g.set(clampCoord(rx + 1), ry, metalDark, 'metal');
    return;
  }

  if (pose.weaponPose === 'recoil') {
    g.set(wx, ry, mat.leatherDark, 'wood');
    g.set(wx, clampCoord(ry + 1), metalLight, 'metal');
    g.set(wx, clampCoord(ry + 2), metalDark, 'metal');
    return;
  }

  // Resting / idle / run weapon cleanly tracking rightHand (rx, ry)
  if (weaponKind === 'bow') {
    const bx = clampCoord(lx - 1);
    g.set(bx, clampCoord(ly - 2), mat.leatherMid, 'wood');
    g.set(clampCoord(bx - 1), clampCoord(ly - 1), mat.leatherMid, 'wood');
    g.set(clampCoord(bx - 1), ly, mat.leatherDark, 'wood');
    g.set(bx, clampCoord(ly + 1), mat.leatherDark, 'wood');
  } else if (weaponKind === 'staff') {
    const topY = clampCoord(ry - 3);
    const botY = Math.min(8, clampCoord(ry + 2));
    for (let y = topY; y <= botY; y++) {
      g.set(wx, y, mat.leatherMid, 'wood');
    }
    g.set(wx, topY, mat.goldLight, 'gold');
    g.set(clampCoord(wx - 1), topY, mat.goldShadow, 'gold');
  } else if (weaponKind === 'spear') {
    const topY = clampCoord(ry - 3);
    const botY = Math.min(8, clampCoord(ry + 2));
    for (let y = topY + 1; y <= botY; y++) {
      g.set(wx, y, mat.leatherMid, 'wood');
    }
    g.set(wx, topY, metalLight, 'metal');
    g.set(clampCoord(wx + 1), topY + 1, k1[1], 'k1');
  } else if (weaponKind === 'club') {
    g.set(wx, ry, mat.leatherMid, 'wood');
    g.set(wx, clampCoord(ry + 1), mat.leatherDark, 'wood');
    g.set(wx, clampCoord(ry - 1), metalDark, 'metal');
    g.set(clampCoord(wx - 1), clampCoord(ry - 1), metalLight, 'metal');
  } else {
    // Sword anchored directly to hand (rx, ry): hilt at (wx, ry), crossguard at (wx-1..wx+1, ry-1), blade above
    g.set(wx, clampCoord(ry + 1), mat.leatherDark, 'wood');
    g.set(clampCoord(wx - 1), ry, mat.goldLight, 'gold');
    g.set(wx, ry, mat.goldShadow, 'gold');
    g.set(wx, clampCoord(ry - 1), metalDark, 'metal');
    g.set(wx, clampCoord(ry - 2), metalLight, 'metal');
    g.set(wx, clampCoord(ry - 3), metalLight, 'metal');
  }
}

function drawCarryOverlay(
  g: LayeredGrid,
  p: ResolvedHumanProfile,
  carry: UnitCarryItem,
  dy: number,
  deps: MedievalAnimRenderDeps
): void {
  if (carry === 'none') return;
  const { mat } = deps;
  const k1 = p.kingdom.k1Ramp;
  const [k2Light] = deps.getEffectiveK2MidAndShadow(p);
  const topY = p.age === 'child' ? 3 : Math.max(0, 2 + dy);

  if (carry === 'log') {
    // Timber log held across shoulder & raised arms (x=1..8, y=topY..topY+1)
    for (let x = 1; x <= 8; x++) {
      g.set(x, topY, x % 2 === 0 ? mat.leatherMid : mat.leatherDark, 'wood');
      g.set(x, topY + 1, mat.leatherDark, 'wood');
    }
    g.set(1, topY, mat.linenLight, 'cloth'); // cut timber grain end
    g.set(8, topY + 1, mat.linenShadow, 'cloth');
    return;
  }

  if (carry === 'stone') {
    // Heavy chiseled boulder carried in raised arms on shoulder-front (x=5..8)
    g.set(6, topY, mat.steelLight, 'metal');
    g.set(7, topY, mat.steelLight, 'metal');
    g.set(5, topY + 1, mat.steelLight, 'metal');
    g.set(6, topY + 1, mat.steelShadow, 'metal');
    g.set(7, topY + 1, mat.steelShadow, 'metal');
    g.set(8, topY + 1, mat.darkCloth, 'cloth');
    g.set(6, topY + 2, mat.darkCloth, 'cloth');
    g.set(7, topY + 2, mat.darkCloth, 'cloth');
    return;
  }

  // 'basket' — woven harvest basket brimming with grain/apples at front chest/shoulder
  g.set(6, topY, k1[1], 'k1');
  g.set(7, topY, mat.goldLight, 'gold');
  g.set(8, topY, k2Light, 'k2');
  g.set(6, topY + 1, mat.leatherMid, 'wood');
  g.set(7, topY + 1, mat.leatherMid, 'wood');
  g.set(8, topY + 1, mat.leatherDark, 'wood');
  g.set(6, topY + 2, mat.leatherDark, 'wood');
  g.set(7, topY + 2, mat.leatherDark, 'wood');
}

function drawLyingBodyAndLayers(
  g: LayeredGrid,
  p: ResolvedHumanProfile,
  action: 'death' | 'sleep',
  pose: FramePose,
  deps: MedievalAnimRenderDeps
): ProceduralAnchors {
  const skin = deps.getEffectiveSkinRamp(p);
  const k1 = p.kingdom.k1Ramp;
  const [k2Light, k2Dark] = deps.getEffectiveK2MidAndShadow(p);
  const [metalLight, metalDark] = deps.getMetalPair(p.era);
  const { mat } = deps;
  const f = normalizeActionFrameIndex(action, p.frameIndex);
  const inhale = action === 'sleep' && f === 1 ? -1 : 0;

  // 1. Body base lying along y=7..9 (grounded on feetY=9)
  // Legs/boots on right (x=6..8, y=8..9)
  g.set(6, 8, mat.darkCloth, 'cloth');
  g.set(7, 8, mat.darkCloth, 'cloth');
  g.set(7, 9, mat.leatherDark, 'wood');
  g.set(8, 9, mat.leatherDark, 'wood');
  g.set(8, 8, mat.leatherMid, 'wood');

  // Torso horizontal (x=3..6, y=7..8)
  for (let x = 3; x <= 6; x++) {
    g.set(x, 7 + inhale, k1[1], 'k1');
    g.set(x, 8, k1[2], 'k1');
    g.set(x, 9, mat.darkCloth, 'cloth');
  }

  // 2. Skin (head resting at left x=1..2, y=7..8, hand at (5, 8))
  g.set(1, 7, skin[0], 'skin');
  g.set(2, 7, skin[1], 'skin');
  g.set(1, 8, skin[1], 'skin');
  g.set(2, 8, skin[2], 'skin');
  g.set(1, 9, skin[2], 'skin');
  g.set(5, 8, skin[1], 'skin'); // right hand resting forward

  // 3. Face & closed eyes
  g.set(2, 8, action === 'death' ? mat.statusWound : skin[3], action === 'death' ? 'status' : 'skin');

  // 4. Hair
  g.set(0, 7, p.hair.ramp[1], 'hair');
  g.set(0, 8, p.hair.ramp[2], 'hair');

  // 5. Clothing accents (K2 sash)
  g.set(4, 7 + inhale, k2Light, 'k2');
  g.set(4, 8, k2Dark, 'k2');

  // 6. Armor (warrior/cavalry/heir chestplate)
  if (p.role === 'warrior' || p.role === 'cavalry' || p.role === 'heir') {
    g.set(3, 7 + inhale, metalLight, 'metal');
    g.set(5, 7 + inhale, metalDark, 'metal');
  }

  // 7. Headgear on resting head
  if (p.role === 'king' || p.role === 'queen' || p.powerRank === 'king' || p.powerRank === 'alliance-leader') {
    g.set(1, 6, mat.goldLight, 'gold');
    g.set(2, 6, mat.goldShadow, 'gold');
  } else if (p.role === 'warrior' || p.role === 'cavalry') {
    g.set(1, 6, metalLight, 'metal');
    g.set(2, 6, metalDark, 'metal');
  } else if (p.role === 'cleric' || p.role === 'merchant') {
    g.set(1, 6, k1[1], 'k1');
    g.set(2, 6, k1[2], 'k1');
  }

  // 8. Weapon lying beside hand
  drawToolInHand(g, p, pose, action, deps);

  // 9. Sleep Z-breath puff (2px connected cluster -> 0 orphans) or Death/Status mark
  if (action === 'sleep' && f === 1) {
    g.set(3, 5, mat.linenLight, 'cloth');
    g.set(4, 5, k2Light, 'k2');
    g.set(3, 6, mat.linenShadow, 'cloth'); // touches chest at y=6 -> 0 orphans!
  } else if (p.status !== 'healthy') {
    g.set(5, 7 + inhale, mat.statusWound, 'status');
  }

  return {
    pivot: { x: 4, y: 9 },
    head: { x: 1, y: 7, w: 2, h: 2 },
    face: { x: 2, y: 8 },
    belt: { x: 4, y: 7 + inhale, w: 2 },
    hand: { leftX: 3, leftY: 8, rightX: 5, rightY: 8 },
    feetY: 9,
  };
}

/**
 * Renders a Medieval Human through the strict 9-layer Paper-Doll pipeline for
 * ANY of the 14 Item-1 actions (`walk` + carry, `run`, `idle`, `chop`, `mine`,
 * `build`, `gather`, `fish`, `attack-melee`, `attack-ranged`, `cast`, `hit`,
 * `death`, `sleep`) with frame-accurate dynamic `ProceduralAnchors`.
 */
export function renderMedievalAnimatedUnit(
  g: LayeredGrid,
  p: ResolvedHumanProfile,
  action: UnitAnimationAction,
  carry: UnitCarryItem,
  dy: number,
  deps: MedievalAnimRenderDeps
): ProceduralAnchors {
  const pose = getPoseForAction(p, action, dy, carry);

  if (pose.posture === 'lying' && (action === 'death' || action === 'sleep')) {
    return drawLyingBodyAndLayers(g, p, action, pose, deps);
  }

  const skin = deps.getEffectiveSkinRamp(p);
  const k1 = p.kingdom.k1Ramp;
  const [k2Light, k2Dark] = deps.getEffectiveK2MidAndShadow(p);
  const [metalLight, metalDark] = deps.getMetalPair(p.era);
  const { mat } = deps;

  const hX = clampCoord(3 + pose.headDx, 1, 5);
  const hY = clampCoord(1 + pose.headDy, 0, 5);
  const tX = clampCoord(3 + pose.bodyDx, 1, 5);
  const tY = clampCoord(4 + pose.torsoDy, 2, 7);
  const narrow = p.gender === 'female';

  const horseDrawn =
    p.role === 'cavalry' &&
    p.age !== 'child' &&
    (action === 'walk' || action === 'run' || action === 'idle' || action === 'attack-melee' || action === 'hit');

  // --- 1. BODY LAYER (grounded on feetY = 9) ---
  // Mounted horse base preserved for cavalry in upright combat/movement actions
  if (horseDrawn) {
    const f = normalizeActionFrameIndex(action, p.frameIndex);
    const horseShift = action === 'attack-melee' && f === 1 ? 1 : action === 'hit' && f === 0 ? -1 : 0;
    for (let x = 3; x <= 7; x++) {
      g.set(clampCoord(x + horseShift), 6, mat.leatherMid, 'wood');
      g.set(clampCoord(x + horseShift), 7, mat.leatherDark, 'wood');
    }
    g.set(clampCoord(2 + horseShift), 4, mat.leatherMid, 'wood');
    g.set(clampCoord(2 + horseShift), 5, mat.leatherMid, 'wood');
    g.set(clampCoord(1 + horseShift), 5, mat.leatherMid, 'wood');
    g.set(clampCoord(1 + horseShift), 6, mat.leatherDark, 'wood');
    g.set(clampCoord(8 + horseShift), 6, mat.leatherDark, 'wood');
    g.set(clampCoord(8 + horseShift), 7, mat.leatherDark, 'wood');
    g.set(clampCoord(3 + horseShift), 8, mat.leatherDark, 'wood');
    g.set(clampCoord(3 + horseShift), f === 1 ? 8 : 9, mat.leatherDark, 'wood');
    g.set(clampCoord(4 + horseShift), 9, mat.leatherDark, 'wood');
    g.set(clampCoord(6 + horseShift), 8, mat.leatherDark, 'wood');
    g.set(clampCoord(7 + horseShift), 8, mat.leatherDark, 'wood');
    g.set(clampCoord(7 + horseShift), f === 3 ? 8 : 9, mat.leatherDark, 'wood');
  }

  // Head cranium placeholder
  for (let x = hX; x <= hX + 3; x++) {
    g.set(x, clampCoord(hY + 1), skin[1], 'skin');
  }
  g.set(hX + 1, clampCoord(hY + 2), skin[1], 'skin');
  g.set(hX + 2, clampCoord(hY + 2), skin[2], 'skin');

  // Torso core
  const bodyMinX = narrow ? tX + 1 : tX;
  const bodyMaxX = narrow ? tX + 2 : tX + 3;
  const torsoEnd = Math.min(8, tY + 3);
  for (let y = tY; y <= torsoEnd; y++) {
    for (let x = bodyMinX; x <= bodyMaxX; x++) {
      g.set(x, y, mat.darkCloth, 'cloth');
    }
  }

  // Arms & hands anchored explicitly at pose.leftHand / pose.rightHand
  g.set(pose.leftArmX, pose.leftArmY, mat.darkCloth, 'cloth');
  g.set(pose.leftHandX, pose.leftHandY, skin[1], 'skin');
  g.set(pose.rightArmX, pose.rightArmY, mat.darkCloth, 'cloth');
  g.set(pose.rightHandX, pose.rightHandY, skin[2], 'skin');

  // Legs connecting torso to boots on feetY = 9 (skipped when mounted on horse)
  if (!horseDrawn) {
    for (let y = Math.min(7, torsoEnd); y <= 8; y++) {
      g.set(pose.leftLegX, y, mat.darkCloth, 'cloth');
      g.set(pose.rightLegX, y, mat.darkCloth, 'cloth');
    }
    g.set(pose.leftLegX, pose.leftLegY, mat.leatherDark, 'wood');
    g.set(pose.rightLegX, pose.rightLegY, mat.leatherDark, 'wood');
    // Ensure grounded contact at y = 9
    g.set(pose.leftLegX, 9, mat.leatherDark, 'wood');
    g.set(pose.rightLegX, 9, mat.leatherDark, 'wood');
  }

  // --- 2. SKIN LAYER ---
  const faceY = clampCoord(hY + 1);
  g.set(hX, faceY, skin[0], 'skin');
  g.set(hX + 1, faceY, skin[0], 'skin');
  g.set(hX + 2, faceY, skin[1], 'skin');
  g.set(hX + 3, faceY, skin[2], 'skin');
  g.set(hX, faceY + 1, skin[1], 'skin');
  g.set(hX + 1, faceY + 1, skin[1], 'skin');
  g.set(hX + 2, faceY + 1, skin[1], 'skin');
  g.set(hX + 3, faceY + 1, skin[2], 'skin');
  g.set(pose.leftHandX, pose.leftHandY, skin[0], 'skin');
  g.set(pose.rightHandX, pose.rightHandY, skin[1], 'skin');

  // --- 3. FACE & EYES LAYER (with blink support for idle/hit/death) ---
  const eyeColor = pose.blink
    ? skin[2]
    : p.status === 'zombie'
      ? mat.statusSick
      : p.status === 'possessed'
        ? mat.statusPossessed
        : skin[3];
  g.set(hX + 1, faceY, eyeColor, 'skin');
  g.set(hX + 2, faceY, skin[0], 'skin');
  g.set(hX + 3, faceY, eyeColor, 'skin');

  // --- 4. HAIR & BEARD LAYER ---
  const hRamp = p.hair.ramp;
  if (pose.posture === 'standing' && hY >= 0) {
    g.set(hX, hY, hRamp[1], 'hair');
    g.set(hX + 1, hY, hRamp[1], 'hair');
    g.set(hX + 2, hY, hRamp[2], 'hair');
    g.set(hX + 3, hY, hRamp[2], 'hair');
    if (p.gender === 'female') {
      g.set(hX, faceY, hRamp[1], 'hair');
      g.set(hX, faceY + 1, hRamp[2], 'hair');
    } else if (p.hasBeard) {
      g.set(hX + 1, faceY + 1, hRamp[1], 'hair');
      g.set(hX + 2, faceY + 1, hRamp[2], 'hair');
    }
  }

  // --- 5. CLOTHING LAYER (K1 / K2 role tunic) ---
  if (p.role === 'king' || p.role === 'queen' || p.powerRank === 'king' || p.powerRank === 'alliance-leader') {
    for (let y = tY; y <= Math.min(7, tY + 2); y++) {
      g.set(tX, y, k1[1], 'k1');
      g.set(tX + 1, y, y === tY + 1 ? k2Light : k1[1], y === tY + 1 ? 'k2' : 'k1');
      g.set(tX + 2, y, y === tY + 1 ? k2Dark : k1[2], y === tY + 1 ? 'k2' : 'k1');
      g.set(tX + 3, y, k1[2], 'k1');
    }
  } else if (p.role === 'peasant') {
    g.set(tX, tY, mat.linenLight, 'cloth');
    g.set(tX + 1, tY, k1[1], 'k1');
    g.set(tX + 2, tY, k1[2], 'k1');
    g.set(tX + 3, tY, mat.linenShadow, 'cloth');
    g.set(tX + 1, tY + 1, k1[1], 'k1');
    g.set(tX + 2, tY + 1, k1[2], 'k1');
    g.set(tX + 1, Math.min(8, tY + 2), k2Light, 'k2');
    g.set(tX + 2, Math.min(8, tY + 2), mat.leatherDark, 'wood');
  } else if (p.role === 'cleric') {
    for (let y = tY; y <= Math.min(8, tY + 3); y++) {
      g.set(tX, y, mat.darkCloth, 'cloth');
      g.set(tX + 1, y, k1[1], 'k1');
      g.set(tX + 2, y, y === tY + 1 ? k2Light : k1[2], y === tY + 1 ? 'k2' : 'k1');
      g.set(tX + 3, y, mat.darkCloth, 'cloth');
    }
  } else {
    g.set(tX, tY, k1[1], 'k1');
    g.set(tX + 1, tY, k1[1], 'k1');
    g.set(tX + 2, tY, k1[2], 'k1');
    g.set(tX + 3, tY, k1[2], 'k1');
    g.set(tX + 1, tY + 1, k1[1], 'k1');
    g.set(tX + 2, tY + 1, k1[2], 'k1');
    g.set(tX + 1, Math.min(8, tY + 2), k2Light, 'k2');
    g.set(tX + 2, Math.min(8, tY + 2), k2Dark, 'k2');
  }

  // --- 6. ARMOR LAYER ---
  if (p.age !== 'child' && (p.role === 'warrior' || p.role === 'cavalry' || p.role === 'heir')) {
    g.set(tX, tY, metalLight, 'metal');
    g.set(tX + 1, tY, metalLight, 'metal');
    g.set(tX + 2, tY, metalDark, 'metal');
    g.set(tX + 3, tY, metalDark, 'metal');
    if (p.role === 'warrior' && pose.leftArmX >= 1) {
      // Compact shield attached to left arm
      g.set(clampCoord(pose.leftArmX - 1), clampCoord(tY + 1), k2Light, 'k2');
      g.set(clampCoord(pose.leftArmX - 1), clampCoord(tY + 2), k2Dark, 'k2');
    }
  }

  // --- 7. HEADGEAR LAYER ---
  if (p.role === 'king' || p.role === 'queen' || p.powerRank === 'king' || p.powerRank === 'alliance-leader') {
    const cy = Math.max(0, hY - 1);
    g.set(hX, cy, mat.goldLight, 'gold');
    g.set(hX + 1, cy, k1[1], 'k1');
    g.set(hX + 2, cy, mat.goldLight, 'gold');
    g.set(hX + 3, cy, mat.goldShadow, 'gold');
  } else if (p.role === 'warrior' || p.role === 'cavalry') {
    g.set(hX, hY, metalLight, 'metal');
    g.set(hX + 1, hY, k1[1], 'k1');
    g.set(hX + 2, hY, metalDark, 'metal');
    g.set(hX + 3, hY, metalDark, 'metal');
  } else if (p.role === 'archer' || p.role === 'merchant' || p.role === 'cleric') {
    g.set(hX, hY, k1[1], 'k1');
    g.set(hX + 1, hY, k1[1], 'k1');
    g.set(hX + 2, hY, k1[2], 'k1');
  }

  // --- 8. WEAPON / TOOL LAYER (moves strictly with hand anchor!) ---
  if (carry === 'none') {
    drawToolInHand(g, p, pose, action, deps);
  } else {
    drawCarryOverlay(g, p, carry, pose.torsoDy, deps);
  }

  // --- 9. STATUS SIGN LAYER ---
  if (action === 'hit' && p.frameIndex === 0) {
    // Crimson impact flash on chest
    g.set(tX + 1, tY + 1, mat.statusWound, 'status');
  }
  if (hX === 3 && tX === 3) {
    deps.applyStatusSignLayer(g, p, pose.torsoDy);
  } else {
    if (p.powerRank === 'alliance-leader' && p.age !== 'child') {
      const bx = Math.max(0, tX - 2);
      for (let y = 2; y <= 7; y++) {
        g.set(bx + 1, y, mat.goldLight, 'gold');
      }
      g.set(bx, 2, k2Light, 'k2');
      g.set(bx, 3, k2Dark, 'k2');
    }
    if (p.status === 'wounded') {
      g.set(tX + 1, Math.min(8, tY + 1), mat.statusWound, 'status');
      g.set(tX + 2, Math.min(8, tY + 1), mat.statusWound, 'status');
    } else if (p.status === 'sick') {
      g.set(hX, faceY, mat.statusSick, 'status');
      g.set(tX + 2, Math.min(8, tY + 1), mat.statusSick, 'status');
    } else if (p.status === 'zombie') {
      g.set(tX + 1, Math.min(8, tY + 1), mat.statusWound, 'status');
    } else if (p.status === 'possessed') {
      g.set(hX, hY, mat.statusPossessed, 'status');
      g.set(hX + 3, hY, mat.statusPossessed, 'status');
      g.set(tX + 1, Math.min(8, tY + 1), mat.statusPossessed, 'status');
    } else if (p.status === 'captive') {
      const sy = Math.min(8, tY + 1);
      for (let x = tX; x <= tX + 3; x++) {
        g.set(x, sy, mat.steelShadow, 'status');
      }
    }
  }

  return {
    pivot: { x: clampCoord(tX + 1), y: 9 },
    head: { x: hX, y: hY, w: 4, h: 3 },
    face: { x: hX + 1, y: faceY },
    belt: { x: tX, y: clampCoord(tY + 2), w: 4 },
    hand: {
      leftX: pose.leftHandX,
      leftY: pose.leftHandY,
      rightX: pose.rightHandX,
      rightY: pose.rightHandY,
    },
    feetY: 9,
  };
}
