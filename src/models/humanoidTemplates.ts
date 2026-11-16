import { PixelMatrix, UnitFrameAnchors } from '../engine/unitAssembler';

/**
 * ============================================================================
 * SCULPTED HUMANOID BODY CYCLE BUILDERS (34×34, 36×36, 40×38)
 * ============================================================================
 * Generates crisp 4-pose articulated walk strides (16w/18w/20w) and shimmering
 * waterline swim loops, paired with 12-frame continuous weapon/offhand swing
 * and procedural cape/wing/halo sculpting inside `assembleModularUnitFrame`.
 * ============================================================================
 */

// 34×34 Standard Humanoid: 16w × 13h (9 torso + 4 legs), pivot (17, 30) -> y=18..30
export function make34Walk(
  torsoRows: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ],
  bootLight: string,
  bootMid: string,
  soleChar = 'U'
): { body: PixelMatrix; anchors: UnitFrameAnchors }[] {
  const L = bootLight;
  const M = bootMid;
  const S = soleChar;
  const poses: { legs: [string, string, string, string]; bob: number }[] = [
    {
      bob: 0,
      legs: [
        `....${L}${L}${M}..${M}${M}${M}....`,
        `....${L}${M}${M}..${M}${M}${S}....`,
        `....${M}${M}${S}..${M}${S}${S}....`,
        `...${S}${S}${S}${S}..${S}${S}${S}${S}...`,
      ],
    },
    {
      bob: -1,
      legs: [
        `...${L}${L}${M}....${M}${M}${M}...`,
        `..${L}${M}${M}......${M}${M}${S}..`,
        `..${S}${S}${S}${S}.....${M}${S}..`,
        `...........${S}${S}${S}..`,
      ],
    },
    {
      bob: 0,
      legs: [
        `.....${L}${L}${M}${M}${M}${M}.....`,
        `.....${L}${M}${M}.${M}${M}.....`,
        `.....${M}${M}${S}..${M}${S}.....`,
        `....${S}${S}${S}${S}.${S}${S}${S}....`,
      ],
    },
    {
      bob: -1,
      legs: [
        `...${M}${M}${M}....${L}${L}${M}...`,
        `...${M}${M}${S}.....${L}${M}${M}..`,
        `...${M}${S}.....${S}${S}${S}${S}.`,
        `..${S}${S}${S}...........`,
      ],
    },
  ];

  return poses.map((p) => ({
    body: [...torsoRows, ...p.legs],
    anchors: {
      head: { x: 16, y: 17 + p.bob, w: 2, h: 2 },
      item: { x: 8, y: 20 + p.bob, w: 1, h: 3 },
      pivot: { x: 17, y: 30 },
      bodyOffsetY: p.bob,
    },
  }));
}

export function make34Swim(
  upperRows: readonly [string, string, string, string, string]
): { body: PixelMatrix; anchors: UnitFrameAnchors }[] {
  const ripples: { rows: [string, string, string]; bob: number }[] = [
    {
      bob: 0,
      rows: ['.WwWwWwWwWwWwWw.', '..wWwWwWwWwWwW..', '....Ww....wW....'],
    },
    {
      bob: -1,
      rows: ['wWwWwWwWwWwWwWwW', '.WwWwWwWwWwWwWw.', '...wW......Ww...'],
    },
    {
      bob: 0,
      rows: ['WWwwWWwwWWwwWWww', '.wwWWwwWWwwWWww.', '....WW....ww....'],
    },
    {
      bob: 1,
      rows: ['wWWwwWWwwWWwwWWw', '.WWwwWWwwWWwwWW.', '...ww......WW...'],
    },
  ];

  return ripples.map((r) => ({
    body: [...upperRows, ...r.rows],
    anchors: {
      head: { x: 16, y: 22 + r.bob, w: 2, h: 2 },
      item: { x: 8, y: 24 + r.bob, w: 1, h: 3 },
      pivot: { x: 17, y: 30 },
      bodyOffsetY: r.bob,
    },
  }));
}

// 36×36 Heavy Armored Humanoid: 18w × 14h (10 torso + 4 legs), pivot (18, 32) -> y=19..32
export function make36Walk(
  torsoRows: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ],
  bootLight: string,
  bootMid: string,
  soleChar = 'K'
): { body: PixelMatrix; anchors: UnitFrameAnchors }[] {
  const L = bootLight;
  const M = bootMid;
  const S = soleChar;
  const poses: { legs: [string, string, string, string]; bob: number }[] = [
    {
      bob: 0,
      legs: [
        `.....${L}${L}${M}..${M}${M}${M}.....`,
        `.....${L}${M}${M}..${M}${M}${S}.....`,
        `.....${M}${M}${S}..${M}${S}${S}.....`,
        `....${S}${S}${S}${S}..${S}${S}${S}${S}....`,
      ],
    },
    {
      bob: -1,
      legs: [
        `....${L}${L}${M}....${M}${M}${M}....`,
        `...${L}${M}${M}......${M}${M}${S}...`,
        `...${S}${S}${S}${S}.....${M}${S}...`,
        `............${S}${S}${S}...`,
      ],
    },
    {
      bob: 0,
      legs: [
        `......${L}${L}${M}${M}${M}${M}......`,
        `......${L}${M}${M}.${M}${M}......`,
        `......${M}${M}${S}..${M}${S}......`,
        `.....${S}${S}${S}${S}.${S}${S}${S}.....`,
      ],
    },
    {
      bob: -1,
      legs: [
        `....${M}${M}${M}....${L}${L}${M}....`,
        `....${M}${M}${S}.....${L}${M}${M}...`,
        `....${M}${S}.....${S}${S}${S}${S}..`,
        `...${S}${S}${S}............`,
      ],
    },
  ];

  return poses.map((p) => ({
    body: [...torsoRows, ...p.legs],
    anchors: {
      head: { x: 17, y: 18 + p.bob, w: 2, h: 2 },
      item: { x: 8, y: 21 + p.bob, w: 1, h: 3 },
      pivot: { x: 18, y: 32 },
      bodyOffsetY: p.bob,
    },
  }));
}

export function make36Swim(
  upperRows: readonly [string, string, string, string, string]
): { body: PixelMatrix; anchors: UnitFrameAnchors }[] {
  const ripples: { rows: [string, string, string]; bob: number }[] = [
    {
      bob: 0,
      rows: ['.WwWwWwWwWwWwWwWw.', '..wWwWwWwWwWwWwW..', '.....Ww....wW.....'],
    },
    {
      bob: -1,
      rows: ['wWwWwWwWwWwWwWwWwW', '.WwWwWwWwWwWwWwWw.', '....wW......Ww....'],
    },
    {
      bob: 0,
      rows: ['WWwwWWwwWWwwWWwwWW', '.wwWWwwWWwwWWwwWW.', '.....WW....ww.....'],
    },
    {
      bob: 1,
      rows: ['wWWwwWWwwWWwwWWwwW', '.WWwwWWwwWWwwWWww.', '....ww......WW....'],
    },
  ];

  return ripples.map((r) => ({
    body: [...upperRows, ...r.rows],
    anchors: {
      head: { x: 17, y: 24 + r.bob, w: 2, h: 2 },
      item: { x: 8, y: 26 + r.bob, w: 1, h: 3 },
      pivot: { x: 18, y: 32 },
      bodyOffsetY: r.bob,
    },
  }));
}

// 40×38 Boss Humanoid: 20w × 15h (11 torso + 4 legs), pivot (20, 34) -> y=20..34
export function make40Walk(
  torsoRows: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ],
  bootLight: string,
  bootMid: string,
  soleChar = 'K'
): { body: PixelMatrix; anchors: UnitFrameAnchors }[] {
  const L = bootLight;
  const M = bootMid;
  const S = soleChar;
  const poses: { legs: [string, string, string, string]; bob: number }[] = [
    {
      bob: 0,
      legs: [
        `......${L}${L}${M}..${M}${M}${M}......`,
        `......${L}${M}${M}..${M}${M}${S}......`,
        `......${M}${M}${S}..${M}${S}${S}......`,
        `.....${S}${S}${S}${S}..${S}${S}${S}${S}.....`,
      ],
    },
    {
      bob: -1,
      legs: [
        `.....${L}${L}${M}....${M}${M}${M}.....`,
        `....${L}${M}${M}......${M}${M}${S}....`,
        `....${S}${S}${S}${S}.....${M}${S}....`,
        `.............${S}${S}${S}....`,
      ],
    },
    {
      bob: 0,
      legs: [
        `.......${L}${L}${M}${M}${M}${M}.......`,
        `.......${L}${M}${M}.${M}${M}.......`,
        `.......${M}${M}${S}..${M}${S}.......`,
        `......${S}${S}${S}${S}.${S}${S}${S}......`,
      ],
    },
    {
      bob: -1,
      legs: [
        `.....${M}${M}${M}....${L}${L}${M}.....`,
        `.....${M}${M}${S}.....${L}${M}${M}....`,
        `.....${M}${S}.....${S}${S}${S}${S}...`,
        `....${S}${S}${S}.............`,
      ],
    },
  ];

  return poses.map((p) => ({
    body: [...torsoRows, ...p.legs],
    anchors: {
      head: { x: 19, y: 19 + p.bob, w: 2, h: 2 },
      item: { x: 9, y: 22 + p.bob, w: 1, h: 3 },
      pivot: { x: 20, y: 34 },
      bodyOffsetY: p.bob,
    },
  }));
}

export function make40Swim(
  upperRows: readonly [string, string, string, string, string, string]
): { body: PixelMatrix; anchors: UnitFrameAnchors }[] {
  const ripples: { rows: [string, string, string]; bob: number }[] = [
    {
      bob: 0,
      rows: ['.WwWwWwWwWwWwWwWwWw.', '..wWwWwWwWwWwWwWwW..', '......Ww....wW......'],
    },
    {
      bob: -1,
      rows: ['wWwWwWwWwWwWwWwWwWwW', '.WwWwWwWwWwWwWwWwWw.', '.....wW......Ww.....'],
    },
    {
      bob: 0,
      rows: ['WWwwWWwwWWwwWWwwWWww', '.wwWWwwWWwwWWwwWWww.', '......WW....ww......'],
    },
    {
      bob: 1,
      rows: ['wWWwwWWwwWWwwWWwwWWw', '.WWwwWWwwWWwwWWwwWW.', '.....ww......WW.....'],
    },
  ];

  return ripples.map((r) => ({
    body: [...upperRows, ...r.rows],
    anchors: {
      head: { x: 19, y: 25 + r.bob, w: 2, h: 2 },
      item: { x: 9, y: 27 + r.bob, w: 1, h: 3 },
      pivot: { x: 20, y: 34 },
      bodyOffsetY: r.bob,
    },
  }));
}
