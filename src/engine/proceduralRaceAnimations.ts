import type {
  ActiveUnitRace,
  LayeredGrid,
  ProceduralAnchors,
  ResolvedHumanProfile,
  UnitRace,
} from './proceduralHuman';
import {
  type MedievalAnimRenderDeps,
  type UnitAnimationAction,
  type UnitAnimationSpec,
  type UnitCarryItem,
  UNIT_ANIMATION_SPECS,
  normalizeActionFrameIndex,
} from './proceduralHumanAnimations';
import { getCustomRaceSkinRamp } from './proceduralRaces';

/**
 * ============================================================================
 * ALL-RACE PROCEDURAL ANIMATIONS (10 ACTIVE RACES × 14 ACTIONS × 3 CARRY)
 * ============================================================================
 * Extends the 14-action / 3-carry Paper-Doll animation system to ALL original
 * races & prehistoric eras with distinct racial movement mechanics ("пластика"):
 *  - marshfolk   : side-to-side waddle + flaring gills
 *  - antlerfolk  : slow & stately smooth glide (~1.55× slower frame durations)
 *  - raptor-kin  : forward-leaning sprint (~0.78× faster run) + counterbalance tail
 *  - hive-mind   : roleless pulsing colony across ALL 14 actions
 *  - stonekin    : heavy monolith stomp (~1.25× cadence) + crystal surge
 *  - ash-nomads  : gliding desert cloak + glowing eye flicker
 *  - undead      : spectral floating bob + reaper sweep
 *  - demon       : digitigrade pounce + barbed tail whip
 *  - neanderthal : heavy mammoth-fur lumbering stride
 *  - human       : all eras (stone-age / bronze-iron / medieval)
 * ============================================================================
 */

const RACE_CADENCE_SCALE: Readonly<Record<ActiveUnitRace, number>> = {
  human: 1.0,
  marshfolk: 1.08,
  stonekin: 1.25,
  antlerfolk: 1.55,
  'ash-nomads': 1.05,
  undead: 1.12,
  demon: 0.88,
  neanderthal: 1.18,
  'raptor-kin': 0.78,
  'hive-mind': 1.15,
};

export function getRaceActionSpec(
  race: UnitRace,
  action: UnitAnimationAction = 'walk'
): UnitAnimationSpec {
  const base = UNIT_ANIMATION_SPECS[action] ?? UNIT_ANIMATION_SPECS.walk;
  const activeRace: ActiveUnitRace =
    race === 'elf' || race === 'orc' || race === 'dwarf' ? 'human' : race;
  const mult = RACE_CADENCE_SCALE[activeRace] ?? 1.0;
  if (mult === 1.0) return base;
  return {
    ...base,
    frameDurationsMs: base.frameDurationsMs.map((ms) => Math.max(60, Math.round(ms * mult))),
  };
}

function clamp(v: number, min = 0, max = 9): number {
  return v < min ? min : v > max ? max : v;
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

function getRaceSkin(p: ResolvedHumanProfile) {
  if (p.status === 'zombie') {
    return ['#8BB865', '#689F48', '#3D632A', '#27421B'] as const;
  }
  if (p.status === 'sick') {
    return ['#C9D8A2', '#A6BA7C', '#7B8F58', '#52613A'] as const;
  }
  return getCustomRaceSkinRamp(p) ?? p.skin.ramp;
}

function drawConnectedToolAtHand(
  g: LayeredGrid,
  p: ResolvedHumanProfile,
  action: UnitAnimationAction,
  f: number,
  hx: number,
  hy: number,
  lx: number,
  ly: number,
  deps: MedievalAnimRenderDeps
): void {
  if (p.status === 'captive') return;
  const k1 = p.kingdom.k1Ramp;
  const [metalL, metalD] = deps.getMetalPair(p.era);
  const wx = clamp(hx + 1);
  const effRole = p.race === 'hive-mind' ? 'peasant' : p.role;

  if (action === 'chop') {
    // Stump at right bottom + axe attached to hand (hx, hy)
    g.set(8, 8, RMAT.woodMid, 'wood');
    g.set(9, 8, RMAT.woodDark, 'wood');
    g.set(8, 9, RMAT.woodDark, 'wood');
    g.set(9, 9, RMAT.woodDark, 'wood');
    if (f === 0) {
      g.set(hx, hy, RMAT.woodMid, 'wood');
      g.set(clamp(hx - 1), clamp(hy - 1), metalL, 'metal');
      g.set(clamp(hx - 1), clamp(hy - 2), metalD, 'metal');
    } else if (f === 1) {
      g.set(hx, clamp(hy - 1), RMAT.woodMid, 'wood');
      g.set(clamp(hx + 1), clamp(hy - 2), metalL, 'metal');
      g.set(clamp(hx + 2), clamp(hy - 2), metalD, 'metal');
    } else if (f === 2) {
      g.set(hx, hy, RMAT.woodMid, 'wood');
      g.set(clamp(hx + 1), clamp(hy + 1), RMAT.woodMid, 'wood');
      g.set(clamp(hx + 1), clamp(hy + 2), metalL, 'metal');
    } else {
      g.set(clamp(hx + 1), hy, RMAT.woodMid, 'wood');
      g.set(clamp(hx + 1), clamp(hy - 1), metalL, 'metal');
    }
    return;
  }

  if (action === 'mine') {
    g.set(8, 8, RMAT.stoneLight, 'metal');
    g.set(9, 8, RMAT.stoneDark, 'metal');
    g.set(8, 9, RMAT.stoneDark, 'metal');
    g.set(9, 9, RMAT.stoneDark, 'metal');
    if (f === 0) {
      g.set(hx, clamp(hy - 1), RMAT.woodMid, 'wood');
      g.set(clamp(hx - 1), clamp(hy - 1), metalL, 'metal');
      g.set(hx, clamp(hy - 2), metalD, 'metal');
    } else if (f === 1) {
      g.set(hx, clamp(hy - 1), RMAT.woodMid, 'wood');
      g.set(clamp(hx + 1), clamp(hy - 2), metalL, 'metal');
      g.set(clamp(hx + 2), clamp(hy - 1), metalD, 'metal');
    } else if (f === 2) {
      g.set(hx, hy, RMAT.woodMid, 'wood');
      g.set(clamp(hx + 1), clamp(hy + 1), metalL, 'metal');
      g.set(clamp(hx + 1), clamp(hy + 2), RMAT.goldLight, 'gold');
    } else {
      g.set(clamp(hx + 1), hy, RMAT.woodMid, 'wood');
      g.set(clamp(hx + 1), clamp(hy - 1), metalL, 'metal');
    }
    return;
  }

  if (action === 'build') {
    g.set(9, 7, RMAT.woodMid, 'wood');
    g.set(9, 8, RMAT.woodDark, 'wood');
    g.set(9, 9, RMAT.woodDark, 'wood');
    g.set(8, 9, RMAT.woodDark, 'wood');
    if (f === 0 || f === 1) {
      g.set(hx, clamp(hy - 1), RMAT.woodMid, 'wood');
      g.set(clamp(hx + 1), clamp(hy - 2), metalL, 'metal');
    } else if (f === 2) {
      g.set(hx, hy, RMAT.woodMid, 'wood');
      g.set(clamp(hx + 1), hy, metalL, 'metal');
      g.set(clamp(hx + 1), clamp(hy + 1), metalD, 'metal');
    } else {
      g.set(clamp(hx + 1), hy, RMAT.woodMid, 'wood');
      g.set(clamp(hx + 1), clamp(hy - 1), metalL, 'metal');
    }
    return;
  }

  if (action === 'gather') {
    const gx = clamp(hx + 1);
    if (f === 1 || f === 2) {
      g.set(gx, clamp(hy + 1), RMAT.woodMid, 'wood');
      g.set(gx, 8, RMAT.woodDark, 'wood');
      g.set(gx, 9, RMAT.goldLight, 'gold');
    } else if (f === 3) {
      g.set(wx, hy, RMAT.woodMid, 'wood');
      g.set(wx, clamp(hy - 1), RMAT.goldLight, 'gold');
    }
    return;
  }

  if (action === 'fish') {
    if (f === 0) {
      g.set(hx, clamp(hy - 1), RMAT.woodMid, 'wood');
      g.set(clamp(hx - 1), clamp(hy - 2), RMAT.woodDark, 'wood');
    } else if (f === 1) {
      g.set(clamp(hx + 1), clamp(hy - 1), RMAT.woodMid, 'wood');
      g.set(clamp(hx + 2), clamp(hy - 2), RMAT.woodMid, 'wood');
      g.set(clamp(hx + 2), clamp(hy - 1), RMAT.linenLight, 'cloth');
    } else if (f === 2) {
      g.set(clamp(hx + 1), clamp(hy - 1), RMAT.woodMid, 'wood');
      g.set(clamp(hx + 2), clamp(hy - 2), RMAT.woodMid, 'wood');
      g.set(9, clamp(hy - 1), RMAT.linenLight, 'cloth');
      g.set(9, clamp(hy), RMAT.linenLight, 'cloth');
      g.set(9, clamp(hy + 1), k1[1], 'k1');
    } else {
      g.set(clamp(hx + 1), clamp(hy - 1), RMAT.woodMid, 'wood');
      g.set(clamp(hx + 2), clamp(hy - 2), RMAT.woodMid, 'wood');
      g.set(9, clamp(hy - 1), RMAT.linenLight, 'cloth');
      g.set(9, clamp(hy), metalL, 'metal');
    }
    return;
  }

  if (action === 'attack-ranged') {
    const bx = clamp(hx + 1, 6, 8);
    g.set(bx, clamp(hy - 1), RMAT.woodMid, 'wood');
    g.set(bx, hy, RMAT.woodMid, 'wood');
    g.set(clamp(bx + 1), hy, RMAT.woodMid, 'wood');
    g.set(clamp(bx + 1), clamp(hy + 1), RMAT.woodDark, 'wood');
    g.set(bx, clamp(hy + 2), RMAT.woodDark, 'wood');
    if (f === 0) {
      g.set(hx, hy, RMAT.linenLight, 'cloth');
    } else if (f === 1) {
      g.set(hx, hy, RMAT.woodMid, 'wood');
      g.set(clamp(bx + 1), hy, metalL, 'metal');
      g.set(hx, clamp(hy - 1), RMAT.linenLight, 'cloth');
    } else if (f === 2) {
      g.set(bx, hy, RMAT.linenLight, 'cloth');
      g.set(clamp(bx + 1), hy, metalL, 'metal');
      g.set(9, hy, metalL, 'metal');
    }
    return;
  }

  if (action === 'cast') {
    const sx = clamp(hx + 1);
    const orb =
      p.race === 'undead' || p.race === 'marshfolk' || p.race === 'hive-mind'
        ? RMAT.cyanGlow
        : RMAT.amberGlow;
    for (let y = 2; y <= 7; y++) g.set(sx, y, RMAT.woodMid, 'wood');
    if (f === 0) {
      g.set(sx, 1, orb, 'gold');
    } else if (f === 1) {
      g.set(sx, 0, orb, 'gold');
      g.set(sx, 1, RMAT.goldLight, 'gold');
      g.set(clamp(sx + 1), 1, orb, 'gold');
    } else if (f === 2) {
      g.set(sx, 0, RMAT.goldLight, 'gold');
      g.set(clamp(sx + 1), 0, orb, 'gold');
      g.set(sx, 1, orb, 'gold');
      g.set(clamp(lx - 1), ly, orb, 'gold');
    } else {
      g.set(sx, 1, RMAT.goldLight, 'gold');
    }
    return;
  }

  if (action === 'attack-melee') {
    if (f === 0) {
      g.set(hx, clamp(hy - 1), RMAT.woodMid, 'wood');
      g.set(clamp(hx - 1), clamp(hy - 2), metalL, 'metal');
      g.set(hx, clamp(hy - 2), metalD, 'metal');
    } else if (f === 1) {
      g.set(hx, hy, RMAT.woodMid, 'wood');
      g.set(clamp(hx + 1), hy, metalL, 'metal');
      g.set(clamp(hx + 1), clamp(hy - 1), RMAT.linenLight, 'cloth');
    } else if (f === 2) {
      g.set(hx, hy, RMAT.woodDark, 'wood');
      g.set(clamp(hx + 1), clamp(hy + 1), metalL, 'metal');
      g.set(clamp(hx + 1), hy, metalD, 'metal');
    } else {
      g.set(wx, hy, RMAT.woodMid, 'wood');
      g.set(wx, clamp(hy - 1), metalL, 'metal');
    }
    return;
  }

  // Idle / Run / Hit default weapon attached directly at hand (hx, hy)
  if (effRole === 'archer') {
    const bx = clamp(lx - 1);
    g.set(bx, clamp(ly - 1), RMAT.woodMid, 'wood');
    g.set(bx, ly, RMAT.woodDark, 'wood');
    g.set(bx, clamp(ly + 1), RMAT.woodDark, 'wood');
  } else if (effRole === 'cleric' || effRole === 'king' || effRole === 'queen') {
    const topY = clamp(hy - 3);
    for (let y = topY; y <= Math.min(8, clamp(hy + 2)); y++) {
      g.set(wx, y, RMAT.woodMid, 'wood');
    }
    g.set(wx, topY, RMAT.goldLight, 'gold');
  } else if (effRole === 'warrior' || effRole === 'cavalry' || effRole === 'heir') {
    g.set(wx, clamp(hy + 1), RMAT.woodDark, 'wood');
    g.set(wx, hy, RMAT.goldLight, 'gold');
    g.set(wx, clamp(hy - 1), metalL, 'metal');
    g.set(wx, clamp(hy - 2), metalL, 'metal');
  } else if (p.race !== 'hive-mind') {
    // Peasant / worker / merchant / leader light tool connected to hand
    g.set(wx, hy, RMAT.woodMid, 'wood');
    g.set(wx, clamp(hy - 1), metalD, 'metal');
  }
}

function drawRaceCarryCargo(
  g: LayeredGrid,
  p: ResolvedHumanProfile,
  carry: UnitCarryItem,
  topY: number
): void {
  if (carry === 'none') return;
  const k1 = p.kingdom.k1Ramp;
  const k2 = p.alliedKingdom ? p.alliedKingdom.k1Ramp : p.kingdom.k2Ramp;
  const y0 = clamp(topY, 0, 5);
  if (carry === 'log') {
    for (let x = 1; x <= 8; x++) {
      g.set(x, y0, x % 2 === 0 ? RMAT.woodMid : RMAT.woodDark, 'wood');
      g.set(x, y0 + 1, RMAT.woodDark, 'wood');
    }
    g.set(1, y0, RMAT.linenLight, 'cloth');
    return;
  }
  if (carry === 'stone') {
    g.set(6, y0, RMAT.steelLight, 'metal');
    g.set(7, y0, RMAT.steelLight, 'metal');
    g.set(5, y0 + 1, RMAT.steelLight, 'metal');
    g.set(6, y0 + 1, RMAT.steelDark, 'metal');
    g.set(7, y0 + 1, RMAT.steelDark, 'metal');
    g.set(8, y0 + 1, RMAT.wispDark, 'cloth');
    return;
  }
  // basket
  g.set(6, y0, k1[1], 'k1');
  g.set(7, y0, RMAT.goldLight, 'gold');
  g.set(8, y0, k2[1], 'k2');
  g.set(6, y0 + 1, RMAT.woodMid, 'wood');
  g.set(7, y0 + 1, RMAT.woodMid, 'wood');
  g.set(8, y0 + 1, RMAT.woodDark, 'wood');
}

function renderCustomRaceLyingState(
  g: LayeredGrid,
  p: ResolvedHumanProfile,
  action: 'death' | 'sleep',
  f: number,
  deps: MedievalAnimRenderDeps
): ProceduralAnchors {
  const skin = getRaceSkin(p);
  const k1 = p.kingdom.k1Ramp;
  const [k2L, k2D] = deps.getEffectiveK2MidAndShadow(p);
  const inhale = action === 'sleep' && f === 1 ? -1 : 0;

  // Flat corpse / sleeping body anchored at feetY=9 along x=1..8, y=7..9
  for (let x = 3; x <= 7; x++) {
    g.set(x, 7 + inhale, x < 5 ? k1[1] : k1[2], 'k1');
    g.set(x, 8, x === 4 ? k2L : x < 6 ? k1[2] : skin[2], x === 4 ? 'k2' : x < 6 ? 'k1' : 'skin');
    g.set(x, 9, skin[3], 'skin');
  }
  g.set(8, 8, skin[2], 'skin');
  g.set(8, 9, skin[3], 'skin');

  // Race-distinctive silhouette cues even when lying down!
  g.set(1, 7, skin[0], 'skin');
  g.set(2, 7, skin[1], 'skin');
  g.set(1, 8, skin[1], 'skin');
  g.set(2, 8, action === 'death' ? RMAT.statusWound : skin[3], action === 'death' ? 'status' : 'skin');
  g.set(1, 9, skin[2], 'skin');
  g.set(2, 9, skin[3], 'skin');

  if (p.race === 'antlerfolk') {
    g.set(0, 6, RMAT.woodMid, 'wood');
    g.set(1, 6, RMAT.woodDark, 'wood');
  } else if (p.race === 'stonekin') {
    g.set(2, 6, k1[0], 'k1');
    g.set(5, 6, k2L, 'k2');
  } else if (p.race === 'demon') {
    g.set(0, 6, RMAT.boneLight, 'gold');
    g.set(8, 7, k2D, 'k2');
  } else if (p.race === 'raptor-kin') {
    g.set(0, 8, skin[0], 'skin');
    g.set(9, 8, k2L, 'k2');
  } else if (p.race === 'marshfolk') {
    g.set(2, 6, k2L, 'k2');
  } else if (p.race === 'hive-mind') {
    // Dormant colonial spore mat
    g.set(3, 6 + inhale, RMAT.cyanGlow, 'gold');
    g.set(6, 7 + inhale, RMAT.amberGlow, 'gold');
  }

  if (action === 'sleep' && f === 1) {
    g.set(3, 5, RMAT.linenLight, 'cloth');
    g.set(4, 5, k2L, 'k2');
    g.set(3, 6, RMAT.linenDark, 'cloth');
  } else if (action === 'death' && p.race !== 'hive-mind') {
    // Dropped weapon beside hand (5, 8)
    g.set(5, 9, RMAT.woodDark, 'wood');
    g.set(6, 9, RMAT.steelLight, 'metal');
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
 * Renders ANY of the 9 custom/era races (`marshfolk`, `stonekin`, `antlerfolk`,
 * `ash-nomads`, `undead`, `demon`, `neanderthal`, `raptor-kin`, `hive-mind`)
 * across ALL 14 Item-1 actions and ALL 3 carry overlays while preserving
 * unmistakable racial silhouettes, dynamic `hand` anchor tracking, `<= 8` colors,
 * `0` INK, `0` orphans, and `0` semitransparency.
 */
export function renderAnimatedCustomRaceUnit(
  g: LayeredGrid,
  p: ResolvedHumanProfile,
  action: UnitAnimationAction,
  carry: UnitCarryItem,
  dy: number,
  deps: MedievalAnimRenderDeps
): ProceduralAnchors {
  const f = normalizeActionFrameIndex(action, p.frameIndex);
  const skin = getRaceSkin(p);
  const k1 = p.kingdom.k1Ramp;
  const [k2L, k2D] = deps.getEffectiveK2MidAndShadow(p);
  const isChild = p.age === 'child';
  const isElder = p.age === 'elder';
  const isFemale = p.gender === 'female';
  const effRole = p.race === 'hive-mind' ? 'peasant' : p.role;

  // Death f3 or Sleep (both frames) -> flat lying pose grounded at feetY=9
  if (action === 'sleep' || (action === 'death' && f === 3)) {
    return renderCustomRaceLyingState(g, p, action === 'sleep' ? 'sleep' : 'death', f, deps);
  }

  // Hive-Mind: strictly roleless pulsing colony across ALL remaining actions!
  if (p.race === 'hive-mind') {
    const collapseY = action === 'death' ? f : action === 'hit' && f === 0 ? 1 : 0;
    const pulseOut =
      action === 'run' || action === 'cast' || action === 'attack-melee' || action === 'attack-ranged'
        ? f === 1 || f === 2
        : action === 'idle'
          ? f === 1
          : f === 1 || f === 2;
    const shiftX = action === 'hit' && f === 0 ? -1 : action === 'chop' || action === 'mine' || action === 'build' ? (f === 2 ? 1 : 0) : 0;

    const topY = isChild ? clamp(4 + collapseY, 3, 7) : clamp(2 + collapseY, 1, 6);
    // Colonial spore dome
    g.set(clamp(4 + shiftX), clamp(topY - 1), k1[0], 'k1');
    g.set(clamp(3 + shiftX), topY, k1[0], 'k1');
    g.set(clamp(4 + shiftX), topY, skin[0], 'skin');
    g.set(clamp(5 + shiftX), topY, skin[1], 'skin');
    if (!isFemale && !isChild) g.set(clamp(6 + shiftX), topY, k2L, 'k2');

    const bodyStart = topY + 1;
    const bodyEnd = Math.min(7, bodyStart + (isChild ? 2 : 4));
    for (let y = bodyStart; y <= bodyEnd; y++) {
      for (let x = 2; x <= 7; x++) {
        const tx = clamp(x + shiftX);
        const isK1 = (x + y + (action === 'cast' ? f : 0)) % 3 === 0;
        g.set(tx, y, isK1 ? k1[1] : x < 5 ? skin[0] : skin[2], isK1 ? 'k1' : 'skin');
      }
    }
    // Pulsing lateral tentacles / appendages
    const armY = clamp(bodyStart + 1, 3, 7);
    if (pulseOut) {
      g.set(clamp(1 + shiftX), armY, k2L, 'k2');
      g.set(clamp(1 + shiftX), clamp(armY + 1), skin[2], 'skin');
      g.set(clamp(8 + shiftX), armY, k1[0], 'k1');
      g.set(clamp(8 + shiftX), clamp(armY + 1), skin[2], 'skin');
    }
    // Bioluminescent nodes (blink on idle f1)
    if (!(action === 'idle' && f === 1)) {
      g.set(clamp(3 + shiftX), clamp(bodyStart + 1), RMAT.cyanGlow, 'gold');
      g.set(clamp(6 + shiftX), clamp(bodyStart + 1), RMAT.cyanGlow, 'gold');
    }
    g.set(clamp(5 + shiftX), clamp(bodyStart + 2), RMAT.amberGlow, 'gold');

    // Grounded root tendrils at y=8..9
    const legLiftL = action === 'walk' || action === 'run' ? (f === 1 ? 8 : 9) : 9;
    const legLiftR = action === 'walk' || action === 'run' ? (f === 3 ? 8 : 9) : 9;
    g.set(clamp(2 + shiftX), 8, skin[2], 'skin');
    g.set(clamp(2 + shiftX), legLiftL, skin[3], 'skin');
    g.set(clamp(5 + shiftX), 8, skin[2], 'skin');
    g.set(clamp(5 + shiftX), 9, skin[3], 'skin');
    g.set(clamp(7 + shiftX), 8, skin[3], 'skin');
    g.set(clamp(7 + shiftX), legLiftR, skin[3], 'skin');

    // Roleless colony rank badge (ignores role completely!)
    if (p.powerRank === 'alliance-leader' || p.powerRank === 'king') {
      g.set(clamp(4 + shiftX), 0, RMAT.goldLight, 'gold');
      g.set(clamp(5 + shiftX), 0, k2L, 'k2');
    }

    const hx = clamp(7 + shiftX);
    const hy = armY;
    const lx = clamp(2 + shiftX);
    if (carry !== 'none') {
      drawRaceCarryCargo(g, p, carry, clamp(topY - 1));
    } else if (
      action === 'chop' ||
      action === 'mine' ||
      action === 'build' ||
      action === 'gather' ||
      action === 'fish' ||
      action === 'attack-melee' ||
      action === 'attack-ranged' ||
      action === 'cast'
    ) {
      drawConnectedToolAtHand(g, p, action, f, hx, hy, lx, hy, deps);
    }

    return {
      pivot: { x: 4, y: 9 },
      head: { x: clamp(3 + shiftX), y: topY, w: 3, h: 2 },
      face: { x: clamp(4 + shiftX), y: clamp(topY + 1) },
      belt: { x: clamp(3 + shiftX), y: bodyEnd, w: 4 },
      hand: { leftX: lx, leftY: hy, rightX: hx, rightY: hy },
      feetY: 9,
    };
  }

  // Racial biomechanics ("пластика")
  let bodyDx = 0;
  let headDx = 0;
  let bodyDy = isChild ? 1 : dy;

  if (p.race === 'marshfolk') {
    // Side-to-side waddle on walk & run
    if (action === 'walk' || action === 'run') {
      bodyDx = f === 1 ? -1 : f === 3 ? 1 : 0;
      headDx = bodyDx;
    }
    bodyDy += isChild ? 1 : 1; // lower, wider squat profile
  } else if (p.race === 'antlerfolk') {
    // Slow & upright smooth stride: no harsh vertical bob
    bodyDy = isChild ? 1 : 0;
  } else if (p.race === 'raptor-kin') {
    // Leaned-forward sprint & predator lunge
    if (action === 'run' || action === 'attack-melee') {
      headDx = -1;
      bodyDx = 0;
    }
  } else if (p.race === 'stonekin') {
    // Heavy stomp only on strike frames
    bodyDy = isChild ? 1 : action === 'run' && f === 2 ? 1 : 0;
  }

  // Action-specific body displacements
  if (action === 'gather' && (f === 1 || f === 2)) {
    bodyDy = Math.min(2, bodyDy + (f === 1 ? 2 : 1));
    bodyDx = 1;
    headDx = 1;
  } else if ((action === 'chop' || action === 'mine' || action === 'build' || action === 'attack-melee') && f === 2) {
    bodyDx = clamp(bodyDx + 1, -1, 1);
    headDx = bodyDx;
  } else if (action === 'hit' && f === 0) {
    bodyDx = -1;
    headDx = -1;
  } else if (action === 'death') {
    bodyDy = Math.min(3, f + 1);
    bodyDx = f === 0 ? -1 : 0;
    headDx = -1;
  }

  const headY = clamp(1 + bodyDy, 0, 6);
  const torsoY = clamp(headY + 2, 2, 7);
  const torsoBaseX = clamp(3 + bodyDx, 1, 5);
  const narrow = isFemale || p.race === 'antlerfolk';

  // --- LAYER 1 & 2: RACE SILHOUETTE TORSO + LEGS + ARMS ---
  // Grounded legs at feetY=9
  const strideL =
    p.race === 'antlerfolk'
      ? f === 2 ? -1 : 0
      : action === 'walk' || action === 'run'
        ? f === 1 ? -1 : 0
        : 0;
  const strideR =
    p.race === 'antlerfolk'
      ? 0
      : action === 'walk' || action === 'run'
        ? f === 3 ? -1 : 0
        : 0;

  const legLX = narrow ? clamp(torsoBaseX + 1) : clamp(torsoBaseX);
  const legRX = narrow ? clamp(torsoBaseX + 2) : clamp(torsoBaseX + 3);
  const hipY = Math.min(8, torsoY + 2);
  for (let ly = hipY; ly <= 8; ly++) {
    g.set(legLX, ly, ly === 8 ? skin[2] : skin[1], 'skin');
    g.set(legRX, ly, ly === 8 ? skin[3] : skin[2], 'skin');
  }
  g.set(legLX, clamp(9 + strideL, 8, 9), skin[3], 'skin');
  g.set(legRX, clamp(9 + strideR, 8, 9), skin[3], 'skin');
  if (p.race === 'marshfolk') {
    // Wide webbed feet
    g.set(clamp(legLX - 1), 9, skin[3], 'skin');
    g.set(clamp(legRX + 1), 9, skin[3], 'skin');
  } else if (p.race === 'demon') {
    g.set(legLX, 9, RMAT.stoneDark, 'metal');
    g.set(legRX, 9, RMAT.stoneDark, 'metal');
  } else if (p.race === 'raptor-kin') {
    // Sickle claws + counterbalance tail stretching right (raised during run!)
    g.set(legLX, 9, RMAT.boneLight, 'gold');
    g.set(legRX, 9, RMAT.boneDark, 'gold');
    const tailY = clamp(torsoY + (action === 'run' ? 0 : 1));
    g.set(clamp(torsoBaseX + 4), tailY, skin[1], 'skin');
    g.set(clamp(torsoBaseX + 5), clamp(tailY - (action === 'run' ? 1 : 0)), skin[2], 'skin');
    g.set(clamp(torsoBaseX + 6), clamp(tailY - (action === 'run' ? 1 : 0)), k2L, 'k2');
  }

  // Torso fill (K1/K2 race tunic / hide / stone plate)
  const wMax = narrow ? 2 : 3;
  for (let y = torsoY; y <= Math.min(7, torsoY + 2); y++) {
    for (let dx = 0; dx <= wMax; dx++) {
      const tx = clamp(torsoBaseX + dx);
      if (p.race === 'stonekin') {
        g.set(tx, y, y === torsoY + 1 ? k1[1] : dx < 2 ? skin[0] : skin[2], y === torsoY + 1 ? 'k1' : 'skin');
      } else if (p.race === 'undead' && y === torsoY + 1 && (dx === 0 || dx === wMax)) {
        // Hollow rib waist on undead
        g.set(tx, y, skin[2], 'skin');
      } else if (p.race === 'neanderthal' && y === torsoY) {
        g.set(tx, y, isElder ? RMAT.silverHair : RMAT.furLight, 'wood');
      } else {
        g.set(tx, y, dx <= 1 ? k1[1] : k1[2], 'k1');
      }
    }
  }
  // K2 sash / belt
  g.set(clamp(torsoBaseX + 1), Math.min(8, torsoY + 2), k2L, 'k2');
  if (!narrow) g.set(clamp(torsoBaseX + 2), Math.min(8, torsoY + 2), k2D, 'k2');

  // --- HEAD & RACIAL HEADSILHOUETTES ---
  const hX = clamp(3 + headDx, 1, 5);
  const hW = p.race === 'antlerfolk' || p.race === 'undead' ? 2 : 3;
  for (let dx = 0; dx < hW; dx++) {
    const cx = clamp(hX + dx);
    g.set(cx, headY, p.race === 'ash-nomads' ? k1[1] : skin[0], p.race === 'ash-nomads' ? 'k1' : 'skin');
    g.set(cx, clamp(headY + 1), p.race === 'ash-nomads' ? skin[3] : skin[1], 'skin');
  }

  // Face eyes (blink on idle frame 1 or hit/death)
  const blink = (action === 'idle' && f === 1) || action === 'hit' || action === 'death';
  if (!blink) {
    const eyeC =
      p.race === 'ash-nomads' || p.race === 'demon' || p.race === 'raptor-kin'
        ? RMAT.amberGlow
        : p.race === 'stonekin' || p.race === 'undead'
          ? RMAT.cyanGlow
          : skin[3];
    const eyeZone = p.race === 'marshfolk' || p.race === 'antlerfolk' || p.race === 'neanderthal' ? 'skin' : 'gold';
    g.set(hX, clamp(headY + 1), eyeC, eyeZone);
    g.set(clamp(hX + hW - 1), clamp(headY + 1), eyeC, eyeZone);
  }

  // Signature silhouette markers (100% preserved across all actions!)
  if (p.race === 'marshfolk') {
    const gillY = clamp(headY + 1);
    const flare = f === 1 || action === 'attack-melee' ? k2L : skin[1];
    g.set(clamp(hX - 1), gillY, flare, 'k2');
    g.set(clamp(hX + hW), gillY, k2D, 'k2');
  } else if (p.race === 'stonekin') {
    // Jutting crystal outcrops on BOTH shoulders
    const cy = Math.max(0, torsoY - 2);
    g.set(clamp(torsoBaseX - 1), cy, k1[0], 'k1');
    g.set(clamp(torsoBaseX - 1), clamp(cy + 1), k1[1], 'k1');
    g.set(clamp(torsoBaseX + 4), cy, k2L, 'k2');
    g.set(clamp(torsoBaseX + 4), clamp(cy + 1), k2D, 'k2');
  } else if (p.race === 'antlerfolk') {
    // Tall branching antlers
    const ay = Math.max(0, headY - 1);
    const antC = isElder ? RMAT.boneLight : RMAT.woodMid;
    g.set(clamp(hX - 2), ay, antC, 'wood');
    g.set(clamp(hX - 1), clamp(ay + 1), antC, 'wood');
    g.set(clamp(hX + 2), clamp(ay + 1), RMAT.woodDark, 'wood');
    g.set(clamp(hX + 3), ay, RMAT.woodDark, 'wood');
  } else if (p.race === 'ash-nomads') {
    // Sweeping desert robe flare down to y=8..9 + hood attached directly to head
    g.set(clamp(torsoBaseX - 1), 8, k1[1], 'k1');
    g.set(clamp(torsoBaseX + 4), 8, k1[2], 'k1');
    g.set(clamp(hX + hW), headY, k1[2], 'k1');
  } else if (p.race === 'undead') {
    // Asymmetric floating wraith shroud on left
    g.set(clamp(torsoBaseX - 1), 7, k1[1], 'k1');
    g.set(clamp(torsoBaseX - 1), 8, RMAT.wispDark, 'cloth');
  } else if (p.race === 'demon') {
    // Crescent horns + barbed tail
    const hy0 = Math.max(0, headY - 1);
    g.set(clamp(hX - 1), hy0, RMAT.boneLight, 'gold');
    g.set(clamp(hX + 3), hy0, RMAT.boneDark, 'gold');
    g.set(clamp(torsoBaseX + 4), clamp(torsoY + 2), skin[2], 'skin');
    g.set(clamp(torsoBaseX + 5), clamp(torsoY + 1), k2L, 'k2');
  } else if (p.race === 'neanderthal') {
    // Wide mammoth-fur mantle
    g.set(clamp(torsoBaseX - 1), torsoY, isElder ? RMAT.silverHair : RMAT.furLight, 'wood');
    g.set(clamp(torsoBaseX + 4), torsoY, isElder ? RMAT.linenDark : RMAT.furDark, 'wood');
  } else if (p.race === 'raptor-kin') {
    // Snout pointing left + crest feathers
    g.set(clamp(hX - 1), headY, skin[0], 'skin');
    g.set(clamp(hX - 2), clamp(headY + 1), skin[1], 'skin');
    g.set(clamp(hX + 1), Math.max(0, headY - 1), k1[0], 'k1');
    g.set(clamp(hX + 2), Math.max(0, headY - 1), k2L, 'k2');
  }

  // Power rank crown / banner
  if (p.powerRank === 'alliance-leader' && !isChild) {
    const bx = Math.max(0, torsoBaseX - 2);
    for (let y = 2; y <= 7; y++) g.set(bx + 1, y, RMAT.goldLight, 'gold');
    g.set(bx, 2, k2L, 'k2');
    g.set(bx, 3, k2D, 'k2');
  } else if (p.powerRank === 'king' || effRole === 'king' || effRole === 'queen') {
    const cy = Math.max(0, headY - 1);
    g.set(hX, cy, RMAT.goldLight, 'gold');
    g.set(clamp(hX + 1), cy, k1[1], 'k1');
  }

  // --- DYNAMIC HANDS + WEAPON / TOOL / CARRY OVERLAY ---
  const armLX = clamp(torsoBaseX - 1, 1, 7);
  const armRX = clamp(torsoBaseX + wMax + 1, 2, 8);
  let handLX = armLX;
  let handLY = clamp(torsoY + 1);
  let handRX = armRX;
  let handRY = clamp(torsoY + 1);

  if (carry !== 'none') {
    handLY = clamp(torsoY - 1);
    handRY = clamp(torsoY - 1);
  } else if (action === 'chop' || action === 'mine' || action === 'build' || action === 'attack-melee') {
    if (f === 0) {
      handRX = clamp(armRX - 1);
      handRY = clamp(torsoY - 1);
    } else if (f === 1) {
      handRX = clamp(armRX);
      handRY = clamp(torsoY - 1);
    } else if (f === 2) {
      handRX = clamp(armRX + 1, 2, 8);
      handRY = clamp(torsoY + 1);
    }
  } else if (action === 'idle') {
    handRY = clamp(torsoY + 1 + (f === 1 ? 1 : 0));
  } else if (action === 'run') {
    handLX = clamp(armLX + (f === 0 ? -1 : f === 2 ? 1 : 0));
    handRY = clamp(torsoY + (f === 2 ? 0 : 1));
  } else if (action === 'cast') {
    handRY = clamp(torsoY - (f === 1 || f === 2 ? 1 : 0));
    handLY = clamp(torsoY - (f === 1 || f === 2 ? 1 : 0));
  } else if (action === 'fish') {
    handRY = clamp(torsoY + (f === 0 ? 0 : f === 3 ? -1 : 1));
  } else if (action === 'gather') {
    handRX = clamp(armRX + (f === 1 || f === 2 ? 1 : 0), 2, 8);
    handRY = clamp(torsoY + 1);
  }

  g.set(armLX, clamp(torsoY), skin[1], 'skin');
  g.set(handLX, handLY, skin[1], 'skin');
  g.set(armRX, clamp(torsoY), skin[2], 'skin');
  g.set(handRX, handRY, skin[2], 'skin');

  if (carry !== 'none') {
    drawRaceCarryCargo(g, p, carry, clamp(torsoY - 2));
  } else {
    drawConnectedToolAtHand(g, p, action, f, handRX, handRY, handLX, handLY, deps);
  }

  // Status signs (connected to torso)
  if (action === 'hit' && f === 0) {
    g.set(clamp(torsoBaseX + 1), clamp(torsoY + 1), RMAT.statusWound, 'status');
  } else if (p.status === 'wounded') {
    g.set(clamp(torsoBaseX + 1), clamp(torsoY + 1), RMAT.statusWound, 'status');
  } else if (p.status === 'possessed') {
    g.set(clamp(torsoBaseX + 1), clamp(torsoY), RMAT.statusPossessed, 'status');
  } else if (p.status === 'captive') {
    g.set(clamp(torsoBaseX + 1), clamp(torsoY + 2), RMAT.statusShackle, 'status');
    g.set(clamp(torsoBaseX + 2), clamp(torsoY + 2), RMAT.statusShackle, 'status');
  }

  return {
    pivot: { x: 4, y: 9 },
    head: { x: hX, y: headY, w: hW, h: 2 },
    face: { x: hX, y: clamp(headY + 1) },
    belt: { x: torsoBaseX, y: Math.min(8, torsoY + 2), w: wMax + 1 },
    hand: { leftX: handLX, leftY: handLY, rightX: handRX, rightY: handRY },
    feetY: 9,
  };
}
