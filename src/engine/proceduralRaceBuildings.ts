import {
  VOID,
  drawAnimatedFlame,
  drawArchedPortal,
  drawBrazier,
  drawCrenellations,
  drawCylindricalTower,
  drawGlowingWindow,
  drawGroundPlinth,
  drawMasonryBox,
  drawShingledRoof,
  drawSwingingLantern,
  drawTimberWall,
  drawWavingBanner,
} from './architectureGrammar';
import { applyBuildingState } from './buildingStates';
import { K1_MASK, K2_MASK, MaterialRamp, RAMPS, WATER_LINE } from './palette';
import { PixelBuffer } from './pixelCanvas';
import type { ActiveUnitRace } from './proceduralHuman';
import { drawCurvedHorn, pickTopLeftTone } from '../models/eraCreatureHelpers';
import type { BuildingState, PixelModelDef, RenderContextOptions } from '../models/types';

/**
 * ============================================================================
 * ORIGINAL RACE & PREHISTORIC ARCHITECTURE (MIN 3 BUILDINGS PER RACE)
 * ============================================================================
 * High-craft 3/4 orthographic RTS buildings (48..58 x 46..60 px) using the
 * full architectural grammar (`drawGroundPlinth`, `drawMasonryBox`,
 * `drawCylindricalTower`, `drawTimberWall`, `drawShingledRoof`, `drawArchedPortal`,
 * `drawGlowingWindow`, `drawBrazier`, `drawWavingBanner`, `drawRibArch`,
 * `drawSkull`, `drawCrystal`, `drawCurvedHorn`).
 *
 * Kept separate from `ALL_MODELS` to preserve the locked 205-model catalog count.
 * Every building:
 *  - Has crisp K1_MASK + K2_MASK roofs, tapestries, runes & banners for 6-kingdom recolor
 *  - Supports all 4 BuildingStates (`constructing`, `ready`, `damaged`, `ruins`)
 *  - Uses top-left (-1,-1) shading and ZERO #131110 INK exterior lines
 * ============================================================================
 */

export type ArchitecturalRaceId = Exclude<ActiveUnitRace, 'human' | 'hive-mind'>;

export interface RaceArchitectureGroup {
  readonly raceId: ArchitecturalRaceId;
  readonly raceLabel: string;
  readonly subtitle: string;
  readonly buildings: readonly PixelModelDef[];
}

function withRaceBuildingState(
  renderReady: (frame: number, total: number) => PixelBuffer
): (frame: number, total: number, ctx?: RenderContextOptions) => PixelBuffer {
  return (frame, total, ctx) => {
    const state: BuildingState = ctx?.buildingState ?? 'ready';
    const ready = renderReady(frame, total);
    return applyBuildingState(ready, state, frame, total);
  };
}

function makeRaceBuilding(cfg: {
  id: string;
  name: string;
  subtitle: string;
  width: number;
  height: number;
  frameCount?: number;
  description: string;
  renderReady: (frame: number, total: number) => PixelBuffer;
}): PixelModelDef {
  return {
    id: cfg.id,
    name: cfg.name,
    subtitle: cfg.subtitle,
    kind: 'static',
    tier: 'II',
    entityType: 'building',
    supportsBuildingStates: true,
    faction: 'Цитадель',
    width: cfg.width,
    height: cfg.height,
    frameCount: cfg.frameCount ?? 6,
    defaultFps: 5,
    layersSpec: ['0. Вода/цоколь', '1. Каркас и кладка', '2. Кровля и маски K1/K2', '3. Знаки, декор и свет'],
    description: cfg.description,
    renderFrame: withRaceBuildingState(cfg.renderReady),
    codeSnippet: `// ${cfg.id}: ${cfg.width}x${cfg.height}`,
  };
}

function drawLagoonWaterBase(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  frame: number,
  lilyPads = true
): void {
  buf.layer((sub) => {
    sub.fillEllipse(cx, cy, rx, ry, (nx, ny, px, py) => {
      const ripple = (px + py * 2 + frame * 2) % 7 === 0;
      if (ripple && ny < 0.3) return WATER_LINE.light;
      if (ny < -0.25 && nx < 0.25) return WATER_LINE.mid;
      if (ny > 0.35 || nx > 0.4) return '#0A2C46';
      return RAMPS.ice.deep;
    });
    if (lilyPads) {
      sub.fillEllipse(cx - Math.round(rx * 0.55), cy + 1, 3.2, 1.5, RAMPS.moss.mid);
      sub.setPixel(cx - Math.round(rx * 0.55) - 1, cy, RAMPS.moss.highlight);
      sub.fillEllipse(cx + Math.round(rx * 0.5), cy - 1, 2.8, 1.3, RAMPS.moss.shadow);
      sub.setPixel(cx + Math.round(rx * 0.5) - 1, cy - 1, K1_MASK[0]);
    }
  });
}

function drawSmokeWisp(buf: PixelBuffer, x: number, y: number, frame: number, total: number, hex = '#C4CDD9'): void {
  const p = frame / Math.max(1, total);
  const darkHex = hex.length === 7 ? '#838D9C' : hex;
  for (let i = 0; i < 3; i++) {
    const u = (p + i * 0.31) % 1;
    const sx = Math.round(x + Math.sin(u * Math.PI * 2 + p * Math.PI * 2) * 1.6);
    const sy = Math.max(2, Math.round(y - u * 8));
    buf.fillEllipse(sx, sy, 1.4 - u * 0.35, 1.2 - u * 0.25, u > 0.65 ? darkHex : hex);
  }
}

function drawLeafLobe(sub: PixelBuffer, cx: number, cy: number, rx: number, ry: number, ramp: MaterialRamp, seed = 1): void {
  sub.fillEllipse(cx, cy, rx, ry, (nx, ny, px, py) => {
    const cluster = ((px * 5 + py * 3 + seed * 7) & 7) === 0;
    const tuft = ((px * 3 - py * 7 + seed * 11) & 7) === 1;
    if (ny > 0.48 || nx > 0.48) return ramp.deep;
    if (ny < -0.35 && nx < 0.25) return tuft ? ramp.mid : ramp.highlight;
    if (cluster) return ramp.shadow;
    if (tuft && nx < 0.15) return ramp.highlight;
    return ramp.mid;
  });
}

// ----------------------------------------------------------------------------
// 1. MARSHFOLK (Болотный народ: свайный дом, тотем жабр, заводь-питомник)
// ----------------------------------------------------------------------------

const MARSH_STILT_HUT = makeRaceBuilding({
  id: 'marsh-stilt-hut',
  name: 'Свайная хижина',
  subtitle: 'Болотный народ · Жильё',
  width: 54,
  height: 50,
  description: 'Многоуровневая хижина на мангровых сваях над лагуной с плетёной крышей K1/K2, камышом и качающимся фонарём.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(54, 50);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const sway = Math.round(Math.sin(t) * 0.8);
    const flicker = (Math.sin(t * 2) + 1) * 0.5;

    drawLagoonWaterBase(buf, 27, 42, 22, 5.5, frame, true);

    // Mangrove pilings with cross-bracing & timber boardwalk deck
    buf.layer((sub) => {
      for (const sx of [13, 21, 32, 40]) {
        sub.fillRect(sx, 31, 3, 12, sx > 30 ? RAMPS.timber.deep : RAMPS.timber.shadow);
        sub.fillRect(sx, 31, 1, 12, RAMPS.timber.mid);
        // Waterline moss ring
        sub.fillRect(sx, 40, 3, 2, RAMPS.moss.shadow);
      }
      sub.drawLine(14, 34, 21, 41, RAMPS.timber.shadow, 1);
      sub.drawLine(33, 41, 40, 34, RAMPS.timber.deep, 1);
      // Plank boardwalk platform + wooden railing posts
      drawMasonryBox(sub, 9, 29, 36, 4, RAMPS.timber, 5, false);
      for (const rx of [10, 17, 36, 43]) {
        sub.fillRect(rx, 25, 2, 4, RAMPS.timber.mid);
      }
      sub.fillRect(10, 26, 8, 1, RAMPS.timber.highlight);
      sub.fillRect(36, 26, 8, 1, RAMPS.timber.shadow);
      // Cattail reeds on flanks
      sub.drawLine(7, 42, 6, 31, RAMPS.moss.mid, 1);
      sub.fillRect(5, 30, 2, 3, RAMPS.timber.mid);
      sub.drawLine(46, 42, 47, 32, RAMPS.moss.shadow, 1);
      sub.fillRect(46, 31, 2, 3, RAMPS.timber.shadow);
    });

    // Reed-plaster cabin + stepped doorway & clay jars
    buf.layer((sub) => {
      drawTimberWall(sub, 14, 17, 26, 13, RAMPS.moss, RAMPS.timber);
      drawArchedPortal(sub, 26, 30, 4, 8, RAMPS.timber, 'void');
      sub.fillEllipse(26, 27, 1.5, 1.5, RAMPS.gold.highlight);
      drawGlowingWindow(sub, 17, 21, 3, 4, RAMPS.cyanMask, RAMPS.timber.deep);
      drawGlowingWindow(sub, 34, 21, 3, 4, RAMPS.cyanMask, RAMPS.timber.deep);
      // Clay amphorae on boardwalk
      sub.fillEllipse(13, 28, 2.0, 2.5, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.autumn));
    });

    // Steeply pitched K1/K2 reed-thatch canopy roof + ridge horn finial
    drawShingledRoof(buf, 27, 6, 17, 12, RAMPS.magenta, RAMPS.gold, true);
    buf.layer((sub) => {
      // K2 woven chevron band across eaves
      for (let x = 14; x <= 40; x += 4) {
        sub.fillRect(x, 15, 2, 2, K2_MASK[0]);
      }
      // Curved carved marsh-reed horns at gable apex
      drawCurvedHorn(sub, 25, 7, 20, 2, 22, 4, 1.1, RAMPS.bone);
      drawCurvedHorn(sub, 29, 7, 34, 2, 32, 4, 1.1, RAMPS.bone);
    });

    drawSwingingLantern(buf, 20, 29, sway, flicker);
    drawWavingBanner(buf, 41, 4, 19, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    return buf;
  },
});

const MARSH_GILL_TOTEM = makeRaceBuilding({
  id: 'marsh-gill-totem',
  name: 'Тотем жабр',
  subtitle: 'Болотный народ · Святилище',
  width: 48,
  height: 56,
  description: 'Резной многоярусный столб-святилище с веерными жабрами державы K1/K2, каменным алтарём и биолюминесцентными очагами.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(48, 56);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const pulse = (Math.sin(t * 2) + 1) * 0.5;

    drawLagoonWaterBase(buf, 24, 48, 19, 5.2, frame, true);
    drawGroundPlinth(buf, 24, 46, 14, 4.0, RAMPS.slate, RAMPS.moss);

    // Carved stepped stone & moss altar base
    buf.layer((sub) => {
      drawMasonryBox(sub, 14, 38, 20, 8, RAMPS.slate, 4, false);
      sub.fillRect(19, 41, 10, 4, K1_MASK[1]);
      sub.fillRect(22, 41, 4, 4, K2_MASK[0]);
      // Towering carved cypress/moss monolith column
      drawCylindricalTower(sub, 24, 11, 6, 28, RAMPS.moss, RAMPS.timber);
    });

    // Wide sculpted amphibious gill-fin wings K1/K2 + 3 carved spirit masks
    buf.layer((sub) => {
      for (let tier = 0; tier < 4; tier++) {
        const y = 13 + tier * 2;
        const w = 11 - tier * 2;
        for (let dx = 0; dx < w; dx++) {
          const isRib = tier % 2 === 0;
          sub.setPixel(18 - dx, y + Math.floor(dx * 0.25), isRib ? K1_MASK[0] : K1_MASK[1]);
          sub.setPixel(18 - dx, y + 1 + Math.floor(dx * 0.25), K1_MASK[2]);
          sub.setPixel(30 + dx, y + Math.floor(dx * 0.25), isRib ? K1_MASK[1] : K1_MASK[2]);
          sub.setPixel(30 + dx, y + 1 + Math.floor(dx * 0.25), K1_MASK[3]);
        }
      }
      // 2 carved spirit faces with glowing bioluminescent eyes
      const eye = pulse > 0.5 ? '#FFFFFF' : K2_MASK[0];
      for (const fy of [14, 24]) {
        sub.fillRect(19, fy, 10, 6, RAMPS.timber.mid);
        sub.fillRect(26, fy, 3, 6, RAMPS.timber.deep);
        sub.fillRect(20, fy + 1, 2, 2, eye);
        sub.fillRect(25, fy + 1, 2, 2, eye);
        sub.fillRect(21, fy + 4, 6, 1, VOID);
        sub.setPixel(22, fy + 4, RAMPS.bone.highlight);
        sub.setPixel(25, fy + 4, RAMPS.bone.highlight);
      }
      // Crown fin & K2 pearl crest
      drawShingledRoof(sub, 24, 5, 7, 6, RAMPS.magenta, RAMPS.cyanMask, true);
      sub.fillEllipse(24, 8, 2.0, 2.0, eye);
    });

    drawBrazier(buf, 12, 41, t, RAMPS.cyanMask);
    drawBrazier(buf, 36, 41, t + 1.5, RAMPS.cyanMask);
    return buf;
  },
});

const MARSH_SPAWNING_POOL = makeRaceBuilding({
  id: 'marsh-spawning-pool',
  name: 'Заводь-питомник',
  subtitle: 'Болотный народ · Пища и род',
  width: 56,
  height: 48,
  description: 'Каменный восьмигранный бассейн-питомник с сияющими жемчужинами икры, аркой тотемов K1/K2 и водопадами ручьёв.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(56, 48);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const pulse = (Math.sin(t * 2) + 1) * 0.5;

    drawGroundPlinth(buf, 28, 39, 23, 6.2, RAMPS.moss, RAMPS.slate);

    // Sculpted stone basin rim & animated shimmering spawning water
    buf.layer((sub) => {
      sub.fillEllipse(28, 34, 21, 8.5, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.slate));
      sub.fillEllipse(28, 32, 19.5, 7.2, (nx, ny) => (nx < -0.2 ? RAMPS.marble.mid : RAMPS.slate.mid));
      sub.fillEllipse(28, 32, 16.5, 5.5, (nx, ny, px, py) => {
        const wave = (px + py * 2 + frame * 2) % 6 === 0;
        if (wave) return WATER_LINE.light;
        return ny < 0 ? WATER_LINE.mid : '#0A2C46';
      });
      // Moss & reed tufts hugging stone basin rim
      for (const [mx, my] of [[10, 34], [15, 39], [41, 39], [45, 34]]) {
        sub.fillEllipse(mx, my, 2.5, 1.5, RAMPS.moss.mid);
        sub.setPixel(mx - 1, my - 1, RAMPS.moss.highlight);
      }
    });

    // Twin carved stone guardian pillars + arched K1/K2 canopy bridge over the pool
    buf.layer((sub) => {
      drawMasonryBox(sub, 12, 17, 6, 16, RAMPS.slate, 2, true);
      drawMasonryBox(sub, 38, 17, 6, 16, RAMPS.slate, 2, true);
      sub.drawSkull(15, 22, 'mini', K2_MASK[0], RAMPS.bone);
      sub.drawSkull(41, 22, 'mini', K2_MASK[0], RAMPS.bone);

      // Peaked carved sanctuary arch beam + K1 shingled crest roof
      drawMasonryBox(sub, 11, 14, 34, 4, RAMPS.timber, 4, false);
      drawShingledRoof(sub, 28, 6, 18, 8, RAMPS.magenta, RAMPS.gold, false);
      sub.fillRect(24, 13, 8, 4, K2_MASK[1]);
      sub.fillRect(26, 14, 4, 2, RAMPS.gold.highlight);
    });

    // Luminous spawn egg clutches nestled on lily pads in the water
    buf.layer((sub) => {
      const pCol = pulse > 0.5 ? '#FFFFFF' : RAMPS.gold.highlight;
      for (const [ex, ey] of [[22, 32], [28, 34], [34, 31], [25, 30]]) {
        sub.fillEllipse(ex, ey + 1, 2.6, 1.3, RAMPS.moss.mid);
        sub.fillEllipse(ex, ey, 1.7, 1.7, RAMPS.gold.mid);
        sub.setPixel(ex - 1, ey - 1, pCol);
      }
    });

    drawWavingBanner(buf, 43, 3, 17, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    drawSwingingLantern(buf, 28, 19, Math.round(Math.sin(t)), pulse);
    return buf;
  },
});

// ----------------------------------------------------------------------------
// 2. STONEKIN (Каменнокожие: кристальный монолит, базальтовая кузня, бастион)
// ----------------------------------------------------------------------------

const STONEKIN_MONOLITH = makeRaceBuilding({
  id: 'stonekin-monolith',
  name: 'Кристальный монолит',
  subtitle: 'Каменнокожие · Святилище',
  width: 50,
  height: 58,
  description: 'Многогранный базальтовый монолит на ступенчатом постаменте с огромными кристаллами K1/K2 и парящими осколками.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(50, 58);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const pulse = (Math.sin(t * 2) + 1) * 0.5;
    const hover = Math.round(Math.sin(t) * 1.2);

    drawGroundPlinth(buf, 25, 50, 19, 5.2, RAMPS.slate, RAMPS.obsidian);

    // Stepped basalt plinth & chiseled monolithic column
    buf.layer((sub) => {
      drawMasonryBox(sub, 12, 41, 26, 8, RAMPS.slate, 5, false);
      drawMasonryBox(sub, 17, 15, 16, 27, RAMPS.slate, 4, true);
      // Chamfered top crown + recessed glowing mineral rune altar
      drawMasonryBox(sub, 19, 10, 12, 5, RAMPS.marble, 3, false);
      drawArchedPortal(sub, 25, 42, 4, 8, RAMPS.obsidian, 'void');
      sub.fillEllipse(25, 37, 2.2, 2.5, pulse > 0.5 ? '#FFFFFF' : K2_MASK[0]);
      // Carved stone rune channels
      drawGlowingWindow(sub, 23, 20, 4, 7, RAMPS.cyanMask, RAMPS.obsidian.deep);
    });

    // Asymmetric colossal K1/K2 crystal clusters erupting from shoulders & crown
    buf.layer((sub) => {
      sub.drawCrystal(13, 33, 14, -1, pulse, RAMPS.magenta);
      sub.drawCrystal(37, 35, 13, 1, 1 - pulse, RAMPS.cyanMask);
      sub.drawCrystal(15, 44, 8, -1, 0.8, RAMPS.cyanMask);
      sub.drawCrystal(35, 44, 8, 1, 0.4, RAMPS.magenta);
      sub.drawCrystal(25, 11, 10, 0, pulse, RAMPS.magenta);
      // Orbiting crystal shards
      const ox = Math.round(Math.cos(t) * 11);
      sub.drawCrystal(25 + ox, 18 + hover, 4, 0, 0.9, RAMPS.cyanMask);
    });

    return buf;
  },
});

const STONEKIN_FORGE = makeRaceBuilding({
  id: 'stonekin-forge',
  name: 'Базальтовая кузня',
  subtitle: 'Каменнокожие · Производство',
  width: 56,
  height: 52,
  description: 'Массивная базальтовая домна с дымящейся башней-трубой, потоком расплавленного металла, наковальней и кристаллами K1/K2.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(56, 52);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const pulse = (Math.sin(t * 2) + 1) * 0.5;

    drawGroundPlinth(buf, 28, 44, 22, 5.5, RAMPS.slate, RAMPS.obsidian);

    // Main smelter hall + tall side furnace chimney
    buf.layer((sub) => {
      drawMasonryBox(sub, 10, 21, 24, 23, RAMPS.slate, 5, true);
      drawMasonryBox(sub, 33, 9, 10, 35, RAMPS.obsidian, 3, true);
      drawCrenellations(sub, 33, 7, 10, RAMPS.slate);
      // K1 Sloped stone gable plate + K2 mineral conduits
      drawShingledRoof(sub, 22, 13, 14, 9, RAMPS.magenta, RAMPS.slate, false);
      sub.drawCrystal(11, 24, 9, -1, pulse, RAMPS.cyanMask);
      sub.drawCrystal(44, 26, 8, 1, 1 - pulse, RAMPS.cyanMask);
    });

    // Roaring furnace mouth, molten pour trough & blacksmith anvil station
    buf.layer((sub) => {
      drawArchedPortal(sub, 21, 44, 5, 10, RAMPS.obsidian, 'void');
      drawAnimatedFlame(sub, 21, 42, 3, 6, t * 2, RAMPS.lava);
      // Glowing molten channel pouring into stone trough
      sub.fillRect(19, 43, 5, 3, pulse > 0.5 ? RAMPS.gold.highlight : RAMPS.lava.highlight);
      // Oak anvil block + sculpted dark-iron horned anvil & glowing heated ingot
      sub.fillRect(43, 40, 5, 4, RAMPS.timber.shadow);
      sub.fillRect(43, 40, 2, 4, RAMPS.timber.mid);
      sub.fillRect(42, 37, 6, 2, RAMPS.slate.mid);
      sub.fillRect(41, 37, 3, 1, RAMPS.slate.highlight);
      sub.fillRect(44, 39, 3, 1, RAMPS.slate.deep);
      sub.fillRect(44, 36, 3, 1, RAMPS.lava.highlight);
      sub.fillRect(13, 28, 4, 8, K1_MASK[1]);
      sub.fillRect(14, 30, 2, 3, K2_MASK[0]);
    });

    drawBrazier(buf, 31, 38, t, RAMPS.lava);
    drawSmokeWisp(buf, 38, 6, frame, total, '#737988BB');
    return buf;
  },
});

const STONEKIN_BASTION = makeRaceBuilding({
  id: 'stonekin-bastion',
  name: 'Рунный бастион',
  subtitle: 'Каменнокожие · Оборона',
  width: 58,
  height: 56,
  description: 'Угловатая гранитная цитадель с контрфорсными башнями, рунными бойницами K2, кристальными зубцами K1 и решёткой врат.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(58, 56);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const pulse = (Math.sin(t * 2) + 1) * 0.5;

    drawGroundPlinth(buf, 29, 48, 24, 5.8, RAMPS.slate, RAMPS.obsidian);

    // Flanking angular corner bastion towers
    buf.layer((sub) => {
      drawMasonryBox(sub, 7, 20, 12, 28, RAMPS.slate, 3, true);
      drawCrenellations(sub, 7, 17, 12, RAMPS.marble);
      sub.drawCrystal(13, 18, 7, 0, pulse, RAMPS.magenta);

      drawMasonryBox(sub, 39, 20, 12, 28, RAMPS.slate, 3, true);
      drawCrenellations(sub, 39, 17, 12, RAMPS.marble);
      sub.drawCrystal(45, 18, 7, 0, 1 - pulse, RAMPS.magenta);
    });

    // Central recessed keep block + faceted crown + portcullis gate
    buf.layer((sub) => {
      drawMasonryBox(sub, 18, 15, 22, 33, RAMPS.marble, 5, true);
      drawCrenellations(sub, 18, 12, 22, RAMPS.marble);
      // K1 & K2 carved stone shield band + glowing crystal embrasures
      sub.fillRect(18, 24, 22, 3, K1_MASK[1]);
      sub.fillRect(18, 24, 14, 1, K1_MASK[0]);
      sub.fillEllipse(29, 25, 3.0, 3.0, K2_MASK[0]);
      sub.setPixel(28, 24, '#FFFFFF');
      drawGlowingWindow(sub, 11, 27, 3, 5, RAMPS.cyanMask, RAMPS.obsidian.deep);
      drawGlowingWindow(sub, 44, 27, 3, 5, RAMPS.cyanMask, RAMPS.obsidian.deep);
      drawArchedPortal(sub, 29, 48, 5, 11, RAMPS.slate, 'portcullis');
    });

    drawBrazier(buf, 21, 43, t, RAMPS.lava);
    drawBrazier(buf, 37, 43, t + 1.5, RAMPS.lava);
    drawWavingBanner(buf, 29, 3, 12, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    return buf;
  },
});

// ----------------------------------------------------------------------------
// 3. ANTLERFOLK (Лесной рогатый народ: живое древо, храм рогов, застава)
// ----------------------------------------------------------------------------

const ANTLER_LIVING_GROVE = makeRaceBuilding({
  id: 'antler-living-grove',
  name: 'Живое древо-роща',
  subtitle: 'Лесной рогатый · Жильё',
  width: 56,
  height: 58,
  description: 'Древний высокий ствол с мощными корнями, резным светящимся дуплом-входом, ветвистыми сучьями и многослойной кроной K1/K2.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(56, 58);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const flicker = (Math.sin(t * 2) + 1) * 0.5;

    drawGroundPlinth(buf, 28, 50, 21, 5.5, RAMPS.moss, RAMPS.timber);

    // Gnarled ancient tree trunk with flared buttress roots & bark grooves
    buf.layer((sub) => {
      for (let y = 21; y <= 49; y++) {
        const p = (y - 21) / 28;
        const flare = y > 39 ? Math.round((y - 39) * 1.15) : 0;
        const hw = Math.round(7 + (1 - p) * 1.5 + flare);
        for (let dx = -hw; dx <= hw; dx++) {
          const nx = dx / hw;
          const bark = (dx * 3 + Math.floor(y / 2)) % 5 === 0;
          const c =
            nx < -0.35
              ? RAMPS.timber.highlight
              : nx > 0.38 || bark
                ? RAMPS.timber.deep
                : RAMPS.timber.mid;
          sub.setPixel(28 + dx, y, c);
        }
      }
      // Antler-shaped heavy branches supporting canopy
      sub.drawLine(23, 24, 13, 15, RAMPS.timber.highlight, 3);
      sub.drawLine(33, 24, 43, 15, RAMPS.timber.shadow, 3);
      // Arched hollow doorway + warm window & hanging K1/K2 forest banner
      drawArchedPortal(sub, 28, 49, 4.5, 10, RAMPS.moss, 'void');
      sub.fillEllipse(28, 44, 2.2, 2.5, RAMPS.gold.highlight);
      drawGlowingWindow(sub, 26, 30, 4, 4, RAMPS.gold, RAMPS.timber.deep);
      sub.fillRect(19, 34, 4, 8, K1_MASK[1]);
      sub.fillRect(20, 36, 2, 3, K2_MASK[0]);
    });

    // Multi-lobe woodland canopy with K1 blossoms, K2 leaves & hanging vines
    buf.layer((sub) => {
      const lobes = [
        { cx: 14, cy: 20, rx: 8.5, ry: 6.5, ramp: RAMPS.moss },
        { cx: 42, cy: 20, rx: 8.5, ry: 6.5, ramp: RAMPS.pine },
        { cx: 21, cy: 13, rx: 9.5, ry: 7.0, ramp: RAMPS.magenta },
        { cx: 35, cy: 13, rx: 9.5, ry: 7.0, ramp: RAMPS.magenta },
        { cx: 28, cy: 9, rx: 10.5, ry: 7.0, ramp: RAMPS.moss },
      ];
      lobes.forEach((l, i) => drawLeafLobe(sub, l.cx, l.cy, l.rx, l.ry, l.ramp, i + 1));

      // K1/K2 Spirit blossoms & trailing moss vines
      for (const [bx, by] of [[12, 18], [22, 10], [34, 11], [43, 18], [28, 15]]) {
        sub.fillRect(bx, by, 3, 2, K1_MASK[0]);
        sub.setPixel(bx + 1, by + 1, K2_MASK[0]);
      }
      for (const [vx, vy, len] of [[10, 26, 6], [17, 25, 4], [39, 25, 5], [46, 26, 6]]) {
        sub.drawLine(vx, vy, vx, vy + len, RAMPS.moss.mid, 1);
      }
    });

    drawSwingingLantern(buf, 35, 39, Math.round(Math.sin(t)), flicker);
    return buf;
  },
});

const ANTLER_HORN_SHRINE = makeRaceBuilding({
  id: 'antler-horn-shrine',
  name: 'Храм ветвистых рогов',
  subtitle: 'Лесной рогатый · Святилище',
  width: 54,
  height: 56,
  description: 'Бело-мраморная лесная аркада, увенчанная колоссальными ветвистыми рогами, рунным алтарём и стягами K1/K2.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(54, 56);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const pulse = (Math.sin(t * 2) + 1) * 0.5;

    drawGroundPlinth(buf, 27, 48, 21, 5.5, RAMPS.moss, RAMPS.slate);

    // Stepped marble & birch sanctuary colonnade
    buf.layer((sub) => {
      drawMasonryBox(sub, 12, 40, 30, 8, RAMPS.slate, 5, false);
      drawMasonryBox(sub, 15, 22, 24, 18, RAMPS.birch, 5, true);
      // Carved columns flanking sanctuary arch
      drawCylindricalTower(sub, 16, 22, 2.5, 18, RAMPS.marble, RAMPS.gold);
      drawCylindricalTower(sub, 38, 22, 2.5, 18, RAMPS.marble, RAMPS.gold);
      drawArchedPortal(sub, 27, 40, 5, 11, RAMPS.gold, 'void');
      // Glowing emerald-cyan spirit orb inside shrine archway
      sub.fillEllipse(27, 34, 2.8, 3.0, pulse > 0.5 ? RAMPS.emerald.highlight : K2_MASK[0]);
      sub.setPixel(26, 33, '#FFFFFF');
    });

    // Peaked K1 sanctuary canopy & colossal multi-tined ivory antlers
    buf.layer((sub) => {
      drawShingledRoof(sub, 27, 14, 15, 9, RAMPS.magenta, RAMPS.gold, false);
      // Giant left & right sweeping multi-tined antlers
      drawCurvedHorn(sub, 22, 18, 7, 4, 12, 15, 1.8, RAMPS.bone);
      drawCurvedHorn(sub, 15, 13, 12, 3, 13, 7, 1.0, RAMPS.bone);
      drawCurvedHorn(sub, 10, 9, 6, 9, 8, 10, 0.9, RAMPS.bone);

      drawCurvedHorn(sub, 32, 18, 47, 4, 42, 15, 1.8, RAMPS.bone);
      drawCurvedHorn(sub, 39, 13, 42, 3, 41, 7, 1.0, RAMPS.bone);
      drawCurvedHorn(sub, 44, 9, 48, 9, 46, 10, 0.9, RAMPS.bone);

      // Hanging K1/K2 tapestries & spirit runes
      sub.fillRect(20, 26, 3, 9, K1_MASK[1]);
      sub.fillRect(21, 28, 1, 4, K2_MASK[0]);
      sub.fillRect(31, 26, 3, 9, K1_MASK[2]);
      sub.fillRect(32, 28, 1, 4, K2_MASK[1]);
    });

    drawSwingingLantern(buf, 11, 24, Math.round(Math.sin(t)), pulse);
    drawSwingingLantern(buf, 43, 24, -Math.round(Math.sin(t)), 1 - pulse);
    return buf;
  },
});

const ANTLER_WATCHTREE = makeRaceBuilding({
  id: 'antler-watchtree',
  name: 'Лесная застава',
  subtitle: 'Лесной рогатый · Оборона',
  width: 50,
  height: 60,
  description: 'Высокая дозорная башня в развилке древнего дерева с консольной фахверковой галереей, лестницей, шатром K1/K2 и маяком.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(50, 60);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const flicker = (Math.sin(t * 2) + 1) * 0.5;

    drawGroundPlinth(buf, 25, 52, 18, 5.0, RAMPS.moss, RAMPS.timber);

    // Thick root-flared tree trunk + climbing rope ladder
    buf.layer((sub) => {
      for (let y = 26; y <= 51; y++) {
        const flare = y > 43 ? Math.round((y - 43) * 0.9) : 0;
        const hw = 5 + flare;
        for (let dx = -hw; dx <= hw; dx++) {
          const nx = dx / hw;
          const bark = (dx * 3 + Math.floor(y / 2)) % 4 === 0;
          sub.setPixel(
            25 + dx,
            y,
            nx < -0.35 ? RAMPS.timber.highlight : nx > 0.35 || bark ? RAMPS.timber.deep : RAMPS.timber.mid
          );
        }
      }
      // Rope ladder climbing up to platform
      sub.drawLine(18, 28, 18, 51, RAMPS.sandstone.shadow, 1);
      sub.drawLine(21, 28, 21, 51, RAMPS.sandstone.shadow, 1);
      for (let ry = 31; ry <= 49; ry += 3) {
        sub.drawLine(18, ry, 21, ry, RAMPS.timber.highlight, 1);
      }
      drawArchedPortal(sub, 26, 51, 3, 7, RAMPS.moss, 'wood');
    });

    // Cantilevered half-timbered woodland lookout house + battlements
    buf.layer((sub) => {
      drawMasonryBox(sub, 12, 24, 26, 4, RAMPS.timber, 4, false);
      drawTimberWall(sub, 14, 15, 22, 10, RAMPS.sandstone, RAMPS.timber);
      drawGlowingWindow(sub, 17, 18, 3, 4, RAMPS.gold, RAMPS.timber.deep);
      drawGlowingWindow(sub, 30, 18, 3, 4, RAMPS.gold, RAMPS.timber.deep);
      // Leaf & K1 shingle turret roof
      drawShingledRoof(sub, 25, 5, 14, 11, RAMPS.magenta, RAMPS.moss, true);
      // Hanging heraldic K1/K2 shield panels
      sub.fillRect(23, 23, 4, 6, K2_MASK[1]);
      sub.fillRect(24, 24, 2, 4, K1_MASK[0]);
      drawLeafLobe(sub, 13, 15, 4.5, 3.0, RAMPS.moss, 2);
      drawLeafLobe(sub, 37, 15, 4.5, 3.0, RAMPS.pine, 4);
    });

    drawSwingingLantern(buf, 14, 28, Math.round(Math.sin(t)), flicker);
    drawWavingBanner(buf, 25, 1, 6, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    return buf;
  },
});

// ----------------------------------------------------------------------------
// 4. ASH NOMADS (Пепельные кочевники: пепельный шатёр, очаг, башня миражей)
// ----------------------------------------------------------------------------

const ASH_NOMAD_TENT = makeRaceBuilding({
  id: 'ash-nomad-tent',
  name: 'Пепельный шатёр',
  subtitle: 'Пепельные кочевники · Жильё',
  width: 56,
  height: 48,
  description: 'Просторный наклонный шатёр кочевников из узорчатых тканей K1/K2 на костяных шестах с растяжками и углём у входа.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(56, 48);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const pulse = (Math.sin(t * 2) + 1) * 0.5;

    drawGroundPlinth(buf, 28, 40, 23, 5.5, RAMPS.sandstone, RAMPS.obsidian);

    // Tent guy-ropes, wooden stakes & rear bone ridge poles
    buf.layer((sub) => {
      sub.drawLine(14, 20, 6, 39, RAMPS.sandstone.shadow, 1);
      sub.drawLine(42, 20, 50, 39, RAMPS.obsidian.shadow, 1);
      sub.fillRect(5, 38, 2, 3, RAMPS.timber.mid);
      sub.fillRect(49, 38, 2, 3, RAMPS.timber.deep);
      sub.drawLine(25, 12, 23, 7, RAMPS.bone.highlight, 1);
      sub.drawLine(25, 12, 28, 7, RAMPS.bone.mid, 1);
    });

    // Sculpted asymmetrical billowing nomad pavilion canopy (K1/K2 woven stripes)
    buf.layer((sub) => {
      for (let ry = 0; ry < 24; ry++) {
        const u = ry / 23;
        const droop = Math.round(Math.sin(u * Math.PI) * -2);
        const left = Math.round(23 - u * 15 - droop);
        const right = Math.round(28 + u * 18 + droop);
        const py = 13 + ry;
        for (let x = left; x <= right; x++) {
          const isStripe = Math.abs(x - 25) <= 2 || ry === 18 || ry === 19;
          const isFolds = (x * 3 + ry) % 7 === 0;
          let c: string;
          if (isStripe) {
            c = x > 32 ? K2_MASK[2] : K2_MASK[0];
          } else if (x < 18 || ry < 4) {
            c = isFolds ? K1_MASK[1] : K1_MASK[0];
          } else if (x > 36) {
            c = isFolds ? K1_MASK[3] : K1_MASK[2];
          } else {
            c = isFolds ? K1_MASK[2] : K1_MASK[1];
          }
          sub.setPixel(x, py, c);
        }
      }
      // Scalloped woven hem along lower eave
      for (let x = 8; x <= 46; x += 2) {
        sub.fillRect(x, 37, 1, 2, x % 4 === 0 ? RAMPS.gold.mid : K2_MASK[1]);
      }
      // Shadowed recessed tent doorway + glowing ember hearth pot
      drawArchedPortal(sub, 26, 39, 5, 10, RAMPS.timber, 'void');
      sub.fillEllipse(26, 37, 2.5, 1.5, pulse > 0.5 ? RAMPS.lava.highlight : RAMPS.lava.mid);
      sub.setPixel(26, 36, RAMPS.gold.highlight);
      // Rolled nomad carpets & brass urns outside
      sub.fillEllipse(15, 38, 3.0, 1.8, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.autumn));
      sub.fillEllipse(37, 38, 2.5, 2.0, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.gold));
    });

    drawWavingBanner(buf, 25, 4, 13, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    drawSmokeWisp(buf, 26, 8, frame, total, '#E2C8AA99');
    return buf;
  },
});

const ASH_CINDER_HEARTH = makeRaceBuilding({
  id: 'ash-cinder-hearth',
  name: 'Обсидиановый очаг',
  subtitle: 'Пепельные кочевники · Кузница и дух',
  width: 54,
  height: 50,
  description: 'Ступенчатая обсидиановая жаровня с трещинами лавы, кованым котлом огня, фонарями и полотнами державы K1/K2.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(54, 50);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const flicker = (Math.sin(t * 2) + 1) * 0.5;

    drawGroundPlinth(buf, 27, 42, 22, 5.5, RAMPS.obsidian, RAMPS.sandstone);

    // 2-tiered stepped volcanic basalt plinth with glowing magma cracks
    buf.layer((sub) => {
      drawMasonryBox(sub, 10, 33, 34, 9, RAMPS.obsidian, 6, false);
      drawMasonryBox(sub, 15, 25, 24, 8, RAMPS.slate, 5, true);
      // Magma veins etched into lower dais
      sub.drawLine(14, 37, 20, 41, RAMPS.lava.mid, 1);
      sub.drawLine(34, 36, 39, 40, RAMPS.lava.highlight, 1);
      // K1/K2 ceremonial altar drapes
      sub.fillRect(19, 27, 16, 5, K1_MASK[1]);
      sub.fillRect(19, 27, 8, 2, K1_MASK[0]);
      sub.fillRect(24, 27, 6, 5, K2_MASK[0]);
      // Side iron wind-screen pillars
      drawMasonryBox(sub, 11, 18, 4, 15, RAMPS.obsidian, 1, false);
      drawMasonryBox(sub, 39, 18, 4, 15, RAMPS.obsidian, 1, false);
    });

    // Central grand iron fire-bowl roaring with multi-stop animated cinder flames
    buf.layer((sub) => {
      sub.fillEllipse(27, 23, 7.5, 3.2, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.obsidian));
      drawAnimatedFlame(sub, 27, 22, 5, 9, t * 2, RAMPS.lava);
      sub.setPixel(25, 11, RAMPS.gold.highlight);
      sub.setPixel(29, 13, '#FFFFFF');
    });

    drawSwingingLantern(buf, 13, 21, Math.round(Math.sin(t)), flicker);
    drawSwingingLantern(buf, 41, 21, -Math.round(Math.sin(t)), 1 - flicker);
    drawWavingBanner(buf, 9, 8, 33, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    drawWavingBanner(buf, 45, 8, 33, t * 2 + 1.4, RAMPS.magenta, RAMPS.cyanMask);
    drawSmokeWisp(buf, 27, 10, frame, total, '#737988AA');
    return buf;
  },
});

const ASH_MIRAGE_TOWER = makeRaceBuilding({
  id: 'ash-mirage-tower',
  name: 'Башня миражей',
  subtitle: 'Пепельные кочевники · Дозор',
  width: 50,
  height: 60,
  description: 'Изогнутый песчаниковый минарет кочевников с ажурным балконом, куполом миражей K1/K2 и горящим маяком.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(50, 60);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const pulse = (Math.sin(t * 2) + 1) * 0.5;

    drawGroundPlinth(buf, 25, 52, 18, 5.2, RAMPS.sandstone, RAMPS.obsidian);

    // Stepped sandstone & obsidian base + subtle leaning desert minaret shaft
    buf.layer((sub) => {
      drawMasonryBox(sub, 13, 41, 24, 11, RAMPS.sandstone, 5, true);
      drawArchedPortal(sub, 25, 52, 4, 8, RAMPS.obsidian, 'void');

      for (let y = 18; y <= 41; y++) {
        const u = (y - 18) / 23;
        const lean = Math.round(Math.sin((1 - u) * Math.PI * 0.5) * -2);
        const hw = Math.round(5 + u * 2.5);
        const mortar = y % 4 === 0;
        for (let dx = -hw; dx <= hw; dx++) {
          const nx = dx / hw;
          let c: string;
          if (y === 28 || y === 29) {
            c = nx < 0 ? K1_MASK[0] : K1_MASK[2];
          } else if (nx < -0.35) {
            c = RAMPS.sandstone.highlight;
          } else if (nx > 0.35) {
            c = mortar ? RAMPS.sandstone.deep : RAMPS.sandstone.shadow;
          } else {
            c = mortar && dx % 3 === 0 ? RAMPS.sandstone.shadow : RAMPS.sandstone.mid;
          }
          sub.setPixel(25 + lean + dx, y, c);
        }
      }
      // Cantilevered wooden observatory balcony + lantern slit
      drawMasonryBox(sub, 14, 15, 20, 4, RAMPS.timber, 4, false);
      sub.fillRect(16, 17, 16, 2, K2_MASK[1]);
      drawGlowingWindow(sub, 22, 22, 3, 5, RAMPS.lava, RAMPS.obsidian.deep);
    });

    // Filigree beacon lantern chamber + K1 onion dome & brass finial
    buf.layer((sub) => {
      drawMasonryBox(sub, 18, 10, 12, 6, RAMPS.obsidian, 3, false);
      sub.fillEllipse(24, 13, 3.0, 2.5, pulse > 0.5 ? '#FFFFFF' : RAMPS.gold.highlight);
      drawShingledRoof(sub, 24, 2, 9, 8, RAMPS.magenta, RAMPS.gold, true);
      sub.drawLine(24, 0, 24, 2, RAMPS.gold.highlight, 1);
    });

    drawWavingBanner(buf, 36, 16, 41, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    return buf;
  },
});

// ----------------------------------------------------------------------------
// 5. UNDEAD (Нежить: оссуарий, некро-обелиск, шпиль костяного праха)
// ----------------------------------------------------------------------------

const UNDEAD_OSSUARY = makeRaceBuilding({
  id: 'undead-ossuary',
  name: 'Склеп-оссуарий',
  subtitle: 'Нежить · Покой и сбор',
  width: 56,
  height: 54,
  description: 'Готическая усыпальница из чёрного камня с костяными контрфорсами из рёбер, черепами, морозными окнами и саваном K1/K2.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(56, 54);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const pulse = (Math.sin(t * 2) + 1) * 0.5;

    drawGroundPlinth(buf, 28, 46, 22, 5.5, RAMPS.slate, RAMPS.obsidian);

    // Necro-slate mausoleum walls + glowing frost lancets + iron-gated crypt portal
    buf.layer((sub) => {
      drawMasonryBox(sub, 13, 21, 30, 25, RAMPS.slate, 6, true);
      sub.fillRect(13, 21, 30, 2, K1_MASK[1]);
      sub.fillRect(13, 21, 18, 1, K1_MASK[0]);
      drawGlowingWindow(sub, 16, 28, 3, 6, RAMPS.cyanMask, RAMPS.obsidian.deep);
      drawGlowingWindow(sub, 37, 28, 3, 6, RAMPS.cyanMask, RAMPS.obsidian.deep);
      drawArchedPortal(sub, 28, 46, 5, 11, RAMPS.bone, 'portcullis');
    });

    // Rib-vaulted K1/K2 shrouded roof + massive flying mammoth-rib buttresses + skull keystone
    buf.layer((sub) => {
      drawShingledRoof(sub, 28, 9, 17, 13, RAMPS.magenta, RAMPS.bone, true);
      sub.drawRibArch(8, 45, 5, 31, 14, 21, 2, RAMPS.bone);
      sub.drawRibArch(48, 45, 51, 31, 42, 21, 2, RAMPS.bone);
      sub.drawRibArch(21, 14, 16, 5, 23, 2, 2, RAMPS.bone);
      sub.drawRibArch(35, 14, 40, 5, 33, 2, 2, RAMPS.bone);
      sub.drawSkull(28, 28, 'large', pulse > 0.5 ? '#FFFFFF' : K2_MASK[0], RAMPS.bone);
    });

    // Graveyard skulls & necromantic soul braziers
    buf.layer((sub) => {
      sub.drawSkull(17, 44, 'mini', K2_MASK[0], RAMPS.bone);
      sub.drawSkull(39, 44, 'mini', K2_MASK[0], RAMPS.bone);
    });
    drawBrazier(buf, 20, 40, t, RAMPS.cyanMask);
    drawBrazier(buf, 36, 40, t + 1.5, RAMPS.cyanMask);
    drawWavingBanner(buf, 43, 5, 22, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    return buf;
  },
});

const UNDEAD_OBELISK = makeRaceBuilding({
  id: 'undead-obelisk',
  name: 'Некро-обелиск',
  subtitle: 'Нежить · Магия склепа',
  width: 50,
  height: 60,
  description: 'Расколотый обсидианово-костяной обелиск, парящий над рунным алтарём благодаря некротическому разлому и печатям K1/K2.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(50, 60);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const hover = Math.round(Math.sin(t) * 1.6);
    const pulse = (Math.sin(t * 2) + 1) * 0.5;

    drawGroundPlinth(buf, 25, 52, 19, 5.2, RAMPS.obsidian, RAMPS.slate);

    // Lower fractured pedestal & skull circle dais
    buf.layer((sub) => {
      drawMasonryBox(sub, 13, 42, 24, 9, RAMPS.slate, 5, false);
      drawMasonryBox(sub, 18, 34, 14, 8, RAMPS.obsidian, 4, true);
      sub.drawSkull(25, 44, 'medium', K2_MASK[0], RAMPS.bone);
      // K1/K2 draped altar banners
      sub.fillRect(14, 42, 3, 7, K1_MASK[1]);
      sub.fillRect(33, 42, 3, 7, K1_MASK[2]);
      sub.drawCrystal(13, 47, 7, -1, pulse, RAMPS.cyanMask);
      sub.drawCrystal(37, 47, 7, 1, 1 - pulse, RAMPS.cyanMask);
    });

    // Necromantic rift lightning + floating bone-and-obsidian obelisk spire
    buf.layer((sub) => {
      const riftCol = pulse > 0.5 ? '#FFFFFF' : K2_MASK[0];
      sub.fillEllipse(25, 32, 7.5, 2.2, RAMPS.cyanMask.mid);
      sub.fillEllipse(25, 32, 4.5, 1.2, riftCol);

      const topY = 6 + hover;
      const botY = 29 + hover;
      for (let y = topY; y <= botY; y++) {
        const p = (y - topY) / (botY - topY);
        const hw = y < topY + 6 ? Math.max(1, y - topY) : Math.round(5 + (1 - p) * 2.0);
        for (let dx = -hw; dx <= hw; dx++) {
          const isBand = y === 17 + hover || y === 18 + hover || y === 24 + hover;
          const c = isBand
            ? K1_MASK[dx < 0 ? 0 : 2]
            : dx < -2
              ? RAMPS.obsidian.highlight
              : dx > 2
                ? RAMPS.obsidian.deep
                : RAMPS.obsidian.mid;
          sub.setPixel(25 + dx, y, c);
        }
      }
      // Carved bone ribs clasping the floating shaft + K2 rune heart
      sub.drawRibArch(19, 25 + hover, 15, 16 + hover, 21, 12 + hover, 1, RAMPS.bone);
      sub.drawRibArch(31, 25 + hover, 35, 16 + hover, 29, 12 + hover, 1, RAMPS.bone);
      drawGlowingWindow(sub, 23, 19 + hover, 4, 4, RAMPS.cyanMask, RAMPS.bone.mid);
    });

    return buf;
  },
});

const UNDEAD_BONE_SPIRE = makeRaceBuilding({
  id: 'undead-bone-spire',
  name: 'Башня костяного праха',
  subtitle: 'Нежить · Оборона',
  width: 52,
  height: 60,
  description: 'Оборонительный некро-шпиль из позвонков, чёрного камня и рёберных арок с клеткой душ и разорванным штандартом K1/K2.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(52, 60);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const pulse = (Math.sin(t * 2) + 1) * 0.5;

    drawGroundPlinth(buf, 26, 52, 19, 5.2, RAMPS.slate, RAMPS.obsidian);

    // Reinforced octagonal bone-banded tower shaft
    buf.layer((sub) => {
      drawCylindricalTower(sub, 26, 22, 8, 30, RAMPS.obsidian, RAMPS.bone);
      // Vertebrae bone rings & skull ornaments
      for (const ry of [28, 36, 44]) {
        sub.fillRect(18, ry, 16, 2, RAMPS.bone.mid);
        sub.fillRect(18, ry, 7, 1, RAMPS.bone.highlight);
      }
      drawArchedPortal(sub, 26, 52, 4, 8, RAMPS.bone, 'portcullis');
      drawGlowingWindow(sub, 24, 24, 4, 4, RAMPS.cyanMask, RAMPS.bone.deep);
      sub.drawRibArch(16, 51, 14, 39, 19, 31, 2, RAMPS.bone);
      sub.drawRibArch(36, 51, 38, 39, 33, 31, 2, RAMPS.bone);
    });

    // Upper bone-crown battlements, gothic K1 spire & hanging soul-lantern
    buf.layer((sub) => {
      drawMasonryBox(sub, 15, 17, 22, 6, RAMPS.slate, 4, false);
      drawCrenellations(sub, 15, 15, 22, RAMPS.bone);
      drawShingledRoof(sub, 26, 5, 11, 11, RAMPS.magenta, RAMPS.bone, true);
      sub.drawSkull(26, 18, 'mini', K2_MASK[0], RAMPS.bone);
      sub.fillRect(22, 31, 8, 5, K1_MASK[1]);
      sub.fillRect(24, 32, 4, 3, K2_MASK[0]);
    });

    drawSwingingLantern(buf, 14, 24, Math.round(Math.sin(t)), pulse);
    drawWavingBanner(buf, 26, 1, 6, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    return buf;
  },
});

// ----------------------------------------------------------------------------
// 6. DEMON (Демоны: врата пекла, алтарь серы, бастион рогов)
// ----------------------------------------------------------------------------

const DEMON_HELLGATE = makeRaceBuilding({
  id: 'demon-hellgate',
  name: 'Врата пекла',
  subtitle: 'Демоны · Портал',
  width: 58,
  height: 58,
  description: 'Колоссальные обсидиановые врата с гигантскими рогами, замковым черепом, цепями, жаровнями и огненным порталом державы K1/K2.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(58, 58);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const pulse = (Math.sin(t * 2) + 1) * 0.5;

    drawGroundPlinth(buf, 29, 50, 23, 5.8, RAMPS.obsidian, RAMPS.lava);

    // Lava fissures radiating across obsidian dais
    buf.layer((sub) => {
      drawMasonryBox(sub, 9, 44, 40, 6, RAMPS.obsidian, 6, false);
      sub.drawLine(14, 47, 21, 51, RAMPS.lava.highlight, 1);
      sub.drawLine(43, 47, 36, 51, RAMPS.lava.mid, 1);
      // Heavy spiked obsidian gate pillars + glowing rune engravings
      drawMasonryBox(sub, 11, 18, 10, 27, RAMPS.obsidian, 3, true);
      drawMasonryBox(sub, 37, 18, 10, 27, RAMPS.obsidian, 3, true);
      drawMasonryBox(sub, 14, 13, 30, 8, RAMPS.slate, 5, true);
      drawGlowingWindow(sub, 14, 24, 3, 6, RAMPS.lava, RAMPS.obsidian.deep);
      drawGlowingWindow(sub, 41, 24, 3, 6, RAMPS.lava, RAMPS.obsidian.deep);
    });

    // Swirling magma vortex inside portal arch + iron chains
    buf.layer((sub) => {
      for (let py = 21; py <= 44; py++) {
        for (let px = 21; px <= 36; px++) {
          const dx = (px - 28.5) / 7.5;
          const dy = (py - 33) / 11.5;
          const r = Math.hypot(dx, dy);
          const swirl = Math.sin(r * 6 - t * 2 + Math.atan2(dy, dx) * 2);
          const c =
            r < 0.35
              ? pulse > 0.5
                ? '#FFFFFF'
                : RAMPS.gold.highlight
              : swirl > 0.25
                ? RAMPS.lava.highlight
                : r > 0.85
                  ? RAMPS.obsidian.deep
                  : RAMPS.lava.mid;
          sub.setPixel(px, py, c);
        }
      }
      // Hanging iron chains inside upper portal arch
      sub.drawLine(22, 21, 24, 29, RAMPS.slate.highlight, 1);
      sub.drawLine(35, 21, 33, 29, RAMPS.slate.mid, 1);
    });

    // Colossal sweeping demon horns + K1/K2 heraldic lintel & horned skull keystone
    buf.layer((sub) => {
      drawCurvedHorn(sub, 15, 16, 4, 2, 7, 13, 2.4, RAMPS.bone);
      drawCurvedHorn(sub, 43, 16, 54, 2, 51, 13, 2.4, RAMPS.bone);
      drawShingledRoof(sub, 29, 7, 12, 7, RAMPS.magenta, RAMPS.gold, false);
      sub.fillRect(18, 14, 22, 4, K1_MASK[1]);
      sub.fillRect(18, 14, 10, 2, K1_MASK[0]);
      sub.drawSkull(29, 17, 'large', K2_MASK[0], RAMPS.bone);
    });

    drawBrazier(buf, 11, 41, t, RAMPS.lava);
    drawBrazier(buf, 47, 41, t + 1.5, RAMPS.lava);
    drawWavingBanner(buf, 8, 13, 39, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    drawWavingBanner(buf, 50, 13, 39, t * 2 + 1.1, RAMPS.magenta, RAMPS.cyanMask);
    return buf;
  },
});

const DEMON_BRIMSTONE_ALTAR = makeRaceBuilding({
  id: 'demon-brimstone-altar',
  name: 'Алтарь серного пламени',
  subtitle: 'Демоны · Жертвенник',
  width: 54,
  height: 50,
  description: 'Трёхступенчатый серный алтарь-зиккурат с рогатыми чашами огня, цепями, жилами лавы и знамёнами державы K1/K2.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(54, 50);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const pulse = (Math.sin(t * 2) + 1) * 0.5;

    drawGroundPlinth(buf, 27, 42, 22, 5.5, RAMPS.obsidian, RAMPS.lava);

    // 3-tier stepped obsidian ziggurat altar with molten channels
    buf.layer((sub) => {
      drawMasonryBox(sub, 8, 35, 38, 7, RAMPS.obsidian, 6, false);
      drawMasonryBox(sub, 13, 27, 28, 8, RAMPS.slate, 5, true);
      drawMasonryBox(sub, 18, 20, 18, 7, RAMPS.obsidian, 4, true);
      // Central magma stair channels & K1/K2 sacrificial cloth runner
      for (let y = 26; y <= 41; y += 2) {
        sub.fillRect(24, y, 6, 2, y % 4 === 0 ? RAMPS.lava.highlight : RAMPS.lava.mid);
      }
      sub.fillRect(14, 28, 26, 2, K1_MASK[1]);
      sub.fillRect(20, 20, 14, 3, K2_MASK[0]);
      sub.drawSkull(27, 24, 'mini', RAMPS.lava.highlight, RAMPS.bone);
    });

    // Horned obsidian fire basin & towering multi-stop brimstone flame
    buf.layer((sub) => {
      drawCurvedHorn(sub, 18, 21, 13, 12, 14, 19, 1.5, RAMPS.bone);
      drawCurvedHorn(sub, 36, 21, 41, 12, 40, 19, 1.5, RAMPS.bone);
      sub.fillEllipse(27, 19, 7.0, 2.5, RAMPS.obsidian.highlight);
      drawAnimatedFlame(sub, 27, 19, 5, 10, t * 2, RAMPS.lava);
      sub.setPixel(27, 8, pulse > 0.5 ? '#FFFFFF' : RAMPS.gold.highlight);
    });

    drawBrazier(buf, 11, 32, t, RAMPS.lava);
    drawBrazier(buf, 43, 32, t + 1.5, RAMPS.lava);
    drawWavingBanner(buf, 8, 10, 35, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    drawWavingBanner(buf, 46, 10, 35, t * 2 + 1.2, RAMPS.magenta, RAMPS.cyanMask);
    return buf;
  },
});

const DEMON_HORN_KEEP = makeRaceBuilding({
  id: 'demon-horn-keep',
  name: 'Бастион рогов',
  subtitle: 'Демоны · Цитадель',
  width: 58,
  height: 58,
  description: 'Цитадель легионов из чёрного железа и обсидиана с зубчатыми башнями, рогами, раскалённой решёткой и знамёнами K1/K2.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(58, 58);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;

    drawGroundPlinth(buf, 29, 50, 24, 5.8, RAMPS.obsidian, RAMPS.lava);

    // Flanking spiked corner towers
    buf.layer((sub) => {
      drawCylindricalTower(sub, 12, 23, 5, 26, RAMPS.obsidian, RAMPS.lava);
      drawCrenellations(sub, 7, 20, 11, RAMPS.slate);
      drawCurvedHorn(sub, 11, 20, 5, 10, 7, 15, 1.5, RAMPS.bone);

      drawCylindricalTower(sub, 46, 23, 5, 26, RAMPS.obsidian, RAMPS.lava);
      drawCrenellations(sub, 41, 20, 11, RAMPS.slate);
      drawCurvedHorn(sub, 47, 20, 53, 10, 51, 15, 1.5, RAMPS.bone);
    });

    // Central grand obsidian keep + spiked iron crown + glowing furnace gate
    buf.layer((sub) => {
      drawMasonryBox(sub, 17, 16, 24, 33, RAMPS.obsidian, 5, true);
      drawCrenellations(sub, 17, 13, 24, RAMPS.slate);
      drawShingledRoof(sub, 29, 6, 12, 8, RAMPS.magenta, RAMPS.gold, true);

      // Giant sweeping crown horns
      drawCurvedHorn(sub, 21, 16, 15, 4, 17, 10, 1.8, RAMPS.bone);
      drawCurvedHorn(sub, 37, 16, 43, 4, 41, 10, 1.8, RAMPS.bone);

      // Glowing magma furnace eyes & iron portcullis over lava glow
      drawGlowingWindow(sub, 20, 21, 3, 5, RAMPS.lava, RAMPS.obsidian.deep);
      drawGlowingWindow(sub, 35, 21, 3, 5, RAMPS.lava, RAMPS.obsidian.deep);
      sub.drawSkull(29, 25, 'medium', K2_MASK[0], RAMPS.bone);
      drawArchedPortal(sub, 29, 49, 5, 11, RAMPS.slate, 'portcullis');
      // Glowing magma under portcullis bars
      sub.fillRect(26, 42, 6, 6, RAMPS.lava.mid);
      sub.fillRect(27, 43, 4, 4, RAMPS.gold.highlight);
    });

    // Heraldic K1/K2 wall banners on flanking towers
    buf.layer((sub) => {
      sub.fillRect(10, 32, 4, 9, K1_MASK[1]);
      sub.fillRect(11, 34, 2, 4, K2_MASK[0]);
      sub.fillRect(44, 32, 4, 9, K1_MASK[2]);
      sub.fillRect(45, 34, 2, 4, K2_MASK[1]);
    });

    drawBrazier(buf, 20, 44, t, RAMPS.lava);
    drawBrazier(buf, 38, 44, t + 1.5, RAMPS.lava);
    drawWavingBanner(buf, 29, 1, 7, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    return buf;
  },
});

// ----------------------------------------------------------------------------
// 7. NEANDERTHAL (Неандертальцы — Ледниковый период: чум, пещерный очаг, ледник)
// ----------------------------------------------------------------------------

const NEANDERTHAL_TUSK_LODGE = makeRaceBuilding({
  id: 'neanderthal-tusk-lodge',
  name: 'Мамонтовый чум из бивней',
  subtitle: 'Неандертальцы · Ледниковье',
  width: 58,
  height: 52,
  description: 'Просторный купол из сшитых шкур мамонта на арках гигантских бивней со снежной шапкой, кострищем и знаменем K1/K2.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(58, 52);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const pulse = (Math.sin(t * 2) + 1) * 0.5;

    drawGroundPlinth(buf, 29, 44, 24, 5.8, RAMPS.birch, RAMPS.slate);

    // Domed stitched mammoth hide body + fur seams + K1/K2 tribal chevron trim
    buf.layer((sub) => {
      sub.fillEllipse(29, 32, 18, 12, (nx, ny, px, py) => {
        if (ny > 0.55) return RAMPS.timber.deep;
        const seam = (px * 3 + py * 2) % 9 === 0;
        if (seam) return RAMPS.timber.shadow;
        return pickTopLeftTone(nx, ny, RAMPS.sandstone);
      });
      // Painted K1/K2 clan cloak over upper dome + snow drift cap
      for (let dy = 0; dy < 7; dy++) {
        const hw = Math.round(5 + dy * 1.6);
        for (let dx = -hw; dx <= hw; dx++) {
          const isTrim = dy === 6;
          sub.setPixel(
            29 + dx,
            20 + dy,
            isTrim ? K2_MASK[0] : dx < -2 ? K1_MASK[0] : dx > 3 ? K1_MASK[2] : K1_MASK[1]
          );
        }
      }
      sub.fillEllipse(29, 20, 7.5, 2.5, RAMPS.ice.highlight);
      sub.fillEllipse(29, 19, 2.5, 1.0, VOID);
    });

    // Colossal curved mammoth tusks framing dome + hearth entrance
    buf.layer((sub) => {
      drawCurvedHorn(sub, 10, 42, 24, 11, 9, 20, 2.6, RAMPS.bone);
      drawCurvedHorn(sub, 48, 42, 34, 11, 49, 20, 2.6, RAMPS.bone);
      drawArchedPortal(sub, 29, 43, 5, 10, RAMPS.bone, 'void');
      sub.fillEllipse(29, 41, 3.0, 2.0, pulse > 0.5 ? RAMPS.gold.highlight : RAMPS.lava.mid);
      // Stacked firewood & mammoth skull trophy
      sub.fillRect(11, 39, 5, 4, RAMPS.timber.mid);
      sub.drawSkull(42, 39, 'mini', K2_MASK[0], RAMPS.bone);
    });

    drawWavingBanner(buf, 43, 12, 38, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    drawSmokeWisp(buf, 29, 17, frame, total, '#E2EBF2AA');
    return buf;
  },
});

const NEANDERTHAL_HEARTH_CAVE = makeRaceBuilding({
  id: 'neanderthal-hearth-cave',
  name: 'Пещерное кострище',
  subtitle: 'Неандертальцы · Огонь и обряд',
  width: 56,
  height: 50,
  description: 'Скальный ледниковый грот с сосульками, наскальной росписью мамонтов, кольцом камней и жарким костром.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(56, 50);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;

    drawGroundPlinth(buf, 28, 43, 23, 5.5, RAMPS.birch, RAMPS.slate);

    // Craggy stratified glacial rock overhang + snow cap + icicles
    buf.layer((sub) => {
      sub.fillEllipse(28, 27, 21, 16, (nx, ny, _px, py) => {
        const strata = py % 4 === 0;
        if (strata && ny < 0.2) return RAMPS.slate.shadow;
        return pickTopLeftTone(nx, ny, RAMPS.slate);
      });
      // Snow cap on cliff ridge & hanging icicles
      sub.fillEllipse(26, 12, 15, 3.2, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.ice));
      for (const [ix, iy, len] of [[15, 24, 4], [22, 23, 5], [34, 23, 5], [40, 25, 4]]) {
        sub.drawLine(ix, iy, ix, iy + len, RAMPS.ice.highlight, 1);
      }
      // Deep cave hollow + ochre & K1/K2 tribal rock art
      sub.fillEllipse(28, 34, 10, 9, VOID);
      sub.fillRect(11, 24, 5, 3, RAMPS.autumn.highlight);
      sub.fillRect(10, 22, 3, 2, K1_MASK[0]);
      sub.fillRect(40, 22, 5, 4, K1_MASK[1]);
      sub.fillRect(41, 27, 3, 2, K2_MASK[0]);
    });

    // Stone fire-ring, roasting spit & animated campfire flames inside cavern
    buf.layer((sub) => {
      for (let dx = -6; dx <= 6; dx += 3) {
        sub.fillEllipse(28 + dx, 41, 1.8, 1.3, RAMPS.slate.mid);
      }
      sub.drawLine(21, 41, 24, 30, RAMPS.timber.mid, 1);
      sub.drawLine(35, 41, 32, 30, RAMPS.timber.shadow, 1);
      sub.drawLine(22, 32, 34, 32, RAMPS.timber.highlight, 1);
      drawAnimatedFlame(sub, 28, 40, 4, 7, t * 2, RAMPS.lava);
    });

    drawWavingBanner(buf, 43, 10, 38, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    drawSmokeWisp(buf, 28, 22, frame, total, '#DCE5EDAA');
    return buf;
  },
});

const NEANDERTHAL_ICE_CACHE = makeRaceBuilding({
  id: 'neanderthal-ice-cache',
  name: 'Ледяная кладовая',
  subtitle: 'Неандертальцы · Запасы',
  width: 54,
  height: 48,
  description: 'Сводчатое хранилище из блоков глетчерного льда с каркасом из брёвен и костей, меховым пологом K1/K2 и припасами.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(54, 48);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;

    drawGroundPlinth(buf, 27, 40, 21, 5.5, RAMPS.ice, RAMPS.slate);

    // Translucent carved glacier-ice block vault with internal refraction facets
    buf.layer((sub) => {
      sub.fillEllipse(27, 29, 17, 12, (nx, ny, px, py) => {
        const block = (px + Math.floor(py / 3) * 3) % 7 === 0 || py % 4 === 0;
        if (ny > 0.48 || nx > 0.42) return block ? RAMPS.ice.deep : RAMPS.ice.shadow;
        if (nx < -0.3 && ny < 0.2) return RAMPS.ice.highlight;
        return block ? RAMPS.ice.highlight : RAMPS.ice.mid;
      });
      // Snow cap drift & ice crystal spires
      sub.fillEllipse(24, 18, 9, 3.0, '#FFFFFF');
      sub.drawCrystal(13, 35, 9, -1, 0.8, RAMPS.ice);
      sub.drawCrystal(41, 35, 8, 1, 0.2, RAMPS.ice);
    });

    // Timber & mammoth-rib doorway frame, fur pelt K1/K2 awning & frozen meat rack
    buf.layer((sub) => {
      drawArchedPortal(sub, 27, 40, 5, 10, RAMPS.timber, 'wood');
      sub.drawRibArch(19, 40, 17, 29, 25, 25, 2, RAMPS.bone);
      sub.drawRibArch(35, 40, 37, 29, 29, 25, 2, RAMPS.bone);
      // K1/K2 draped fur canopy & clan totems
      sub.fillRect(19, 23, 16, 4, K1_MASK[1]);
      sub.fillRect(19, 23, 8, 2, K1_MASK[0]);
      sub.fillRect(25, 22, 4, 5, K2_MASK[0]);
      // Side meat storage crate & frozen fish
      sub.fillRect(11, 36, 6, 4, RAMPS.timber.mid);
      sub.fillRect(12, 35, 4, 2, RAMPS.autumn.mid);
    });

    drawWavingBanner(buf, 39, 11, 37, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    return buf;
  },
});

// ----------------------------------------------------------------------------
// 8. RAPTOR-KIN (Ящеры-рапторы — Эра динозавров: кладка-гнездо, насест, скала)
// ----------------------------------------------------------------------------

const RAPTOR_EGG_NEST = makeRaceBuilding({
  id: 'raptor-egg-nest',
  name: 'Кладка-гнездо ящеров',
  subtitle: 'Ящеры-рапторы · Эра динозавров',
  width: 54,
  height: 46,
  description: 'Огромное плетёное гнездо из папоротников, брёвен и костей с кладкой тёплых яиц и перьевыми копьями стаи K1/K2.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(54, 46);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const wobble = frame % 3 === 0 ? -1 : 0;

    drawGroundPlinth(buf, 27, 38, 22, 5.5, RAMPS.sandstone, RAMPS.moss);

    // Woven fern, log & ribcage nest crater
    buf.layer((sub) => {
      sub.fillEllipse(27, 31, 19, 8.5, (nx, ny, px, py) => {
        const weave = (px * 3 + py * 5) % 6 === 0;
        if (ny > 0.35 || nx > 0.4) return RAMPS.timber.deep;
        return weave ? RAMPS.timber.highlight : pickTopLeftTone(nx, ny, RAMPS.timber);
      });
      // Deep warm moss-lined bowl
      sub.fillEllipse(27, 29, 14, 5.5, RAMPS.timber.deep);
      sub.fillEllipse(27, 29, 11.5, 4.2, RAMPS.moss.shadow);
      // Giant fern fronds radiating out
      for (const [fx, fy, dx, dy] of [
        [10, 32, -5, -4],
        [14, 37, -6, 2],
        [44, 32, 5, -4],
        [40, 37, 6, 2],
      ]) {
        sub.drawLine(fx, fy, fx + dx, fy + dy, RAMPS.moss.highlight, 2);
      }
    });

    // Clutch of 5 mottled dinosaur eggs + feathered pack spears K1/K2 + trophy skull
    buf.layer((sub) => {
      const eggs: [number, number][] = [
        [20, 29],
        [25, 27 + wobble],
        [30, 28],
        [34, 30],
        [26, 31],
      ];
      for (const [ex, ey] of eggs) {
        sub.fillEllipse(ex, ey, 2.3, 3.0, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.bone));
        sub.setPixel(ex, ey - 1, K2_MASK[0]);
        sub.setPixel(ex + 1, ey + 1, K1_MASK[1]);
      }
      // Trophy prey skull on nest rim
      sub.drawSkull(15, 33, 'mini', K2_MASK[0], RAMPS.bone);

      // Feathered pack totem poles flanking nest
      sub.drawLine(12, 30, 10, 11, RAMPS.bone.highlight, 1);
      sub.drawLine(42, 30, 44, 11, RAMPS.bone.mid, 1);
      for (let i = 0; i < 3; i++) {
        sub.fillRect(8, 12 + i * 3, 4, 2, i % 2 === 0 ? K1_MASK[0] : K2_MASK[0]);
        sub.fillRect(42, 12 + i * 3, 4, 2, i % 2 === 0 ? K1_MASK[1] : K2_MASK[1]);
      }
    });

    drawWavingBanner(buf, 27, 6, 24, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    return buf;
  },
});

const RAPTOR_BONE_ROOST = makeRaceBuilding({
  id: 'raptor-bone-roost',
  name: 'Костяной насест стаи',
  subtitle: 'Ящеры-рапторы · Охотничий лагерь',
  width: 56,
  height: 52,
  description: 'Охотничий шатёр стаи под сводами рёбер завропода с чешуйчатым пологом K1/K2, стойкой копий и костром.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(56, 52);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const pulse = (Math.sin(t * 2) + 1) * 0.5;

    drawGroundPlinth(buf, 28, 44, 22, 5.5, RAMPS.sandstone, RAMPS.timber);

    // Sauropod ribcage vault & scaled leather K1/K2 draped canopy
    buf.layer((sub) => {
      sub.drawRibArch(11, 43, 13, 18, 28, 12, 2, RAMPS.bone);
      sub.drawRibArch(45, 43, 43, 18, 28, 12, 2, RAMPS.bone);
      // Tapered hide pavilion interior walls with K1/K2 scale stripes
      for (let y = 16; y <= 43; y++) {
        const u = (y - 16) / 27;
        const hw = Math.round(4 + u * 12);
        for (let dx = -hw; dx <= hw; dx++) {
          const isFeatherBand = y >= 22 && y <= 24;
          const isStripe = Math.abs(dx) <= 2;
          const c = isFeatherBand
            ? K2_MASK[dx < 0 ? 0 : 1]
            : isStripe
              ? K2_MASK[0]
              : dx < -3
                ? K1_MASK[0]
                : dx > 4
                  ? K1_MASK[2]
                  : K1_MASK[1];
          sub.setPixel(28 + dx, y, c);
        }
      }
      // Shadowed cave-like entry & glowing ember pit
      drawArchedPortal(sub, 28, 43, 5, 10, RAMPS.bone, 'void');
      sub.fillEllipse(28, 41, 2.5, 1.5, pulse > 0.5 ? RAMPS.gold.highlight : RAMPS.lava.mid);
      // Giant horned prey skull crest at gable peak
      sub.drawSkull(28, 17, 'medium', K2_MASK[0], RAMPS.bone);
      // Spear rack outside
      sub.drawLine(14, 43, 17, 29, RAMPS.timber.mid, 1);
      sub.setPixel(17, 28, RAMPS.marble.highlight);
      sub.drawLine(42, 43, 39, 29, RAMPS.timber.shadow, 1);
      sub.setPixel(39, 28, RAMPS.marble.mid);
    });

    drawWavingBanner(buf, 28, 3, 14, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    return buf;
  },
});

const RAPTOR_CRAG_OUTPOST = makeRaceBuilding({
  id: 'raptor-crag-outpost',
  name: 'Смотровая скала стаи',
  subtitle: 'Ящеры-рапторы · Дозор',
  width: 54,
  height: 58,
  description: 'Слоистый мезозойский утёс с костяной лестницей, деревянным гнездом-платформой, жаровней и перьевым штандартом K1/K2.',
  renderReady: (frame, total) => {
    const buf = new PixelBuffer(54, 58);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;

    drawGroundPlinth(buf, 27, 50, 21, 5.5, RAMPS.sandstone, RAMPS.autumn);

    // Stratified red-sandstone mesa pinnacle with stepped ledges
    buf.layer((sub) => {
      drawMasonryBox(sub, 14, 24, 26, 26, RAMPS.sandstone, 6, false);
      drawMasonryBox(sub, 17, 17, 20, 9, RAMPS.autumn, 5, false);
      // Fern cluster & bone ladder ascending cliff face
      sub.fillEllipse(12, 46, 4.5, 3.0, RAMPS.moss.mid);
      sub.fillEllipse(41, 47, 4.0, 2.5, RAMPS.moss.shadow);
      sub.drawLine(21, 25, 19, 50, RAMPS.bone.highlight, 1);
      sub.drawLine(25, 25, 23, 50, RAMPS.bone.mid, 1);
      for (let ry = 28; ry <= 48; ry += 3) {
        const shift = Math.round((ry - 25) * -0.08);
        sub.drawLine(21 + shift, ry, 25 + shift, ry, RAMPS.timber.highlight, 1);
      }
      // Carved raptor claw-totem relief on cliffside
      sub.fillRect(30, 32, 6, 9, K1_MASK[1]);
      sub.fillRect(31, 34, 4, 4, K2_MASK[0]);
    });

    // Cantilevered wooden lookout nest platform & bone spikes on summit
    buf.layer((sub) => {
      drawMasonryBox(sub, 12, 13, 30, 5, RAMPS.timber, 5, false);
      drawCrenellations(sub, 12, 10, 30, RAMPS.bone);
      sub.fillRect(14, 15, 26, 2, K1_MASK[0]);
      sub.fillRect(23, 15, 8, 2, K2_MASK[0]);
      sub.drawSkull(27, 20, 'mini', K2_MASK[0], RAMPS.bone);
    });

    drawBrazier(buf, 16, 11, t, RAMPS.lava);
    drawWavingBanner(buf, 34, 2, 12, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    return buf;
  },
});

// ----------------------------------------------------------------------------
// EXPORTS: ALL 8 ARCHITECTURAL RACES × 3 BUILDINGS = 24 MODELS
// ----------------------------------------------------------------------------

export const RACE_ARCHITECTURE_GROUPS: readonly RaceArchitectureGroup[] = [
  {
    raceId: 'marshfolk',
    raceLabel: 'Болотный народ',
    subtitle: 'Сваи, жаберные тотемы и заводи',
    buildings: [MARSH_STILT_HUT, MARSH_GILL_TOTEM, MARSH_SPAWNING_POOL],
  },
  {
    raceId: 'stonekin',
    raceLabel: 'Каменнокожие',
    subtitle: 'Монолиты, кристальные кузни и бастионы',
    buildings: [STONEKIN_MONOLITH, STONEKIN_FORGE, STONEKIN_BASTION],
  },
  {
    raceId: 'antlerfolk',
    raceLabel: 'Лесной рогатый народ',
    subtitle: 'Живые рощи, храмы рогов и дозорные древа',
    buildings: [ANTLER_LIVING_GROVE, ANTLER_HORN_SHRINE, ANTLER_WATCHTREE],
  },
  {
    raceId: 'ash-nomads',
    raceLabel: 'Пепельные кочевники',
    subtitle: 'Балахон-шатры, обсидиановые очаги и башни',
    buildings: [ASH_NOMAD_TENT, ASH_CINDER_HEARTH, ASH_MIRAGE_TOWER],
  },
  {
    raceId: 'undead',
    raceLabel: 'Нежить (обновлённая)',
    subtitle: 'Оссуарии, некро-обелиски и костяные шпили',
    buildings: [UNDEAD_OSSUARY, UNDEAD_OBELISK, UNDEAD_BONE_SPIRE],
  },
  {
    raceId: 'demon',
    raceLabel: 'Демоны (обновлённая)',
    subtitle: 'Рогатые врата, серные алтари и бастионы',
    buildings: [DEMON_HELLGATE, DEMON_BRIMSTONE_ALTAR, DEMON_HORN_KEEP],
  },
  {
    raceId: 'neanderthal',
    raceLabel: 'Неандертальцы и Денисовцы (Ледниковье)',
    subtitle: 'Мамонтовый чум из бивней, пещерное кострище и ледяная кладовая',
    buildings: [NEANDERTHAL_TUSK_LODGE, NEANDERTHAL_HEARTH_CAVE, NEANDERTHAL_ICE_CACHE],
  },
  {
    raceId: 'raptor-kin',
    raceLabel: 'Ящеры-рапторы (Эра динозавров)',
    subtitle: 'Гнёзда-кладки, костяной насест и скала стаи',
    buildings: [RAPTOR_EGG_NEST, RAPTOR_BONE_ROOST, RAPTOR_CRAG_OUTPOST],
  },
];

export const ALL_RACE_BUILDINGS: readonly PixelModelDef[] = RACE_ARCHITECTURE_GROUPS.flatMap(
  (g) => g.buildings
);

/**
 * Ратуша Королевства (Medieval Town Hall) — дополняет матрицу 26+1 построек
 * Средневековья и Бронзы для демонстрации всех ключевых типов зданий (вкл. ратушу)
 * в 6 королевствах, не нарушая инвариант ALL_MODELS === 205.
 */
export const MEDIEVAL_TOWN_HALL: PixelModelDef = {
  id: 'medieval-town-hall',
  name: 'Ратуша Королевства',
  subtitle: 'Средневековье · Городское управление и совет',
  kind: 'static',
  tier: 'II',
  era: 'medieval',
  entityType: 'building',
  buildingFunction: 'housing',
  supportsBuildingStates: true,
  faction: 'Цитадель',
  width: 58,
  height: 58,
  frameCount: 6,
  defaultFps: 5,
  layersSpec: ['0. Каменный цоколь и крыльцо', '1. Фахверковый зал совета', '2. Крыша и знамёна K1/K2', '3. Часовая башня и колокол'],
  description: 'Средневековая городская ратуша с каменной аркадой, фахверковым залом совета, черепичной кровлей K1, часовой башенкой, колоколом и стягами K2.',
  renderFrame: withRaceBuildingState((frame, total) => {
    const buf = new PixelBuffer(58, 58);
    const t = (frame / Math.max(1, total)) * Math.PI * 2;
    const bellSwing = Math.round(Math.sin(t) * 1.1);
    const flicker = (Math.sin(t * 2) + 1) * 0.5;

    // Layer 0: Wide cobblestone terrace plinth & stone steps
    drawGroundPlinth(buf, 29, 50, 24, 5.8, RAMPS.slate, RAMPS.timber);

    // Layer 1: Ground ashlar arcade & upper half-timbered guild council hall
    buf.layer((sub) => {
      drawMasonryBox(sub, 9, 34, 40, 15, RAMPS.slate, 6, true);
      drawTimberWall(sub, 8, 22, 42, 12, RAMPS.birch, RAMPS.timber);
      // Warm arched council windows & ground lancets
      for (const wx of [12, 18, 37, 43]) {
        drawGlowingWindow(sub, wx, 37, 3, 5, RAMPS.gold, RAMPS.slate.deep);
      }
      for (const wx of [11, 17, 38, 44]) {
        drawGlowingWindow(sub, wx, 25, 3, 4, RAMPS.gold, RAMPS.timber.deep);
      }
      // Grand stone portico portal & steps
      drawArchedPortal(sub, 29, 49, 5, 11, RAMPS.marble, 'wood');
      sub.fillRect(23, 49, 13, 2, RAMPS.marble.highlight);
    });

    // Layer 2: Scalloped K1 shingled roof + K2 heraldic council shield & banners
    drawShingledRoof(buf, 29, 11, 22, 12, RAMPS.magenta, RAMPS.gold, false);
    buf.layer((sub) => {
      sub.fillRect(25, 22, 8, 9, K2_MASK[1]);
      sub.fillRect(26, 23, 6, 7, K2_MASK[0]);
      sub.fillRect(27, 24, 4, 4, K1_MASK[0]);
      sub.setPixel(28, 25, RAMPS.gold.highlight);
      // Flanking wall tapestries
      sub.fillRect(10, 35, 2, 6, K1_MASK[1]);
      sub.fillRect(46, 35, 2, 6, K1_MASK[2]);
    });

    // Layer 3: Central clock & bell belfry spire
    buf.layer((sub) => {
      drawMasonryBox(sub, 23, 7, 12, 15, RAMPS.marble, 3, true);
      // Circular gilded town clock
      sub.fillEllipse(29, 14, 3.6, 3.6, RAMPS.gold.mid);
      sub.fillEllipse(29, 14, 2.5, 2.5, RAMPS.bone.highlight);
      sub.setPixel(29, 13, RAMPS.obsidian.deep);
      sub.setPixel(29, 14, RAMPS.obsidian.deep);
      sub.setPixel(30, 14, RAMPS.obsidian.deep);
      // Swinging brass bell inside belfry arch
      drawGlowingWindow(sub, 27, 18, 4, 3, RAMPS.gold, RAMPS.slate.deep);
      sub.fillRect(28 + bellSwing, 18, 2, 3, RAMPS.gold.shadow);
      // Pointed belfry spire roof K1 + golden weathervane
      drawShingledRoof(sub, 29, 1, 7, 7, RAMPS.magenta, RAMPS.gold, true);
      sub.drawLine(29, 0, 29, 2, RAMPS.gold.highlight, 1);
    });

    drawSwingingLantern(buf, 22, 41, Math.round(Math.sin(t)), flicker);
    drawSwingingLantern(buf, 36, 41, -Math.round(Math.sin(t)), 1 - flicker);
    drawWavingBanner(buf, 13, 5, 16, t * 2, RAMPS.magenta, RAMPS.cyanMask);
    drawWavingBanner(buf, 45, 5, 16, t * 2 + 1.4, RAMPS.magenta, RAMPS.cyanMask);
    return buf;
  }),
  codeSnippet: '// medieval-town-hall: 58x58',
};
