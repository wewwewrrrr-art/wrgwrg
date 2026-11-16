import { drawGroundPlinth } from '../engine/architectureGrammar';
import { RAMPS, VOID, WATER_LINE } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import { drawCurvedHorn, pickTopLeftTone } from './eraCreatureHelpers';
import { PixelModelDef } from './types';

/**
 * 1. Строматолитовый Риф (Primordial Stromatolite Reef, 46×40, animated 12f)
 */
function renderStromatoliteReef(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(46, 40);
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;

  // Seafloor sediment base
  drawGroundPlinth(buf, 23, 33, 18, 4.5, RAMPS.sandstone, RAMPS.obsidian);

  // Clustered Precambrian/Cambrian layered stromatolite mineral domes
  const domes = [
    { cx: 14, cy: 27, rx: 5.5, ry: 5.0 },
    { cx: 31, cy: 28, rx: 5.0, ry: 4.5 },
    { cx: 23, cy: 23, rx: 7.5, ry: 8.5 },
  ];
  for (const d of domes) {
    buf.layer((sub) => {
      sub.fillEllipse(d.cx, d.cy, d.rx, d.ry, (nx, ny, _px, py) => {
        if (ny > 0.52) return RAMPS.obsidian.deep;
        const band = py % 3 === 0;
        if (band && ny < 0.25) return nx < 0.2 ? RAMPS.copper.highlight : RAMPS.copper.mid;
        return pickTopLeftTone(nx, ny, RAMPS.sandstone);
      });
    });
  }

  // Seaweed strands & gentle oxygen bubbles rising through shallow lagoon ripples
  for (let i = 0; i < 4; i++) {
    const sway = Math.round(Math.sin(t + i * 1.4) * 1.2);
    const sx = 9 + i * 9;
    buf.drawLine(sx, 31, sx + sway, 22 - (i % 2) * 3, RAMPS.emerald.mid, 1);
    buf.setPixel(sx + sway, 22 - (i % 2) * 3, RAMPS.emerald.highlight);
    const by = Math.round(18 - ((frame + i * 3) % total) * 1.1);
    buf.setPixel(sx + 2, Math.max(4, by), i % 2 === 0 ? '#FFFFFF' : RAMPS.ice.highlight);
  }

  // Animated water ripple belt around reef base
  for (let x = 6; x < 40; x++) {
    const wy = 32 + Math.round(Math.sin(t + x * 0.35) * 0.8);
    if ((x + frame) % 3 === 0) {
      buf.setPixel(x, wy, (x + frame * 2) % 5 < 2 ? WATER_LINE.light : WATER_LINE.mid);
    }
  }

  return buf;
}

/**
 * 2. Древний Папоротник Карбона (Primordial Tree Fern, 48×54, animated 12f)
 */
function renderPrimordialTreeFern(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(48, 54);
  const p = frame / Math.max(1, total);
  const sway = Math.sin(p * Math.PI * 2) * 1.6;

  drawGroundPlinth(buf, 24, 47, 15, 4.2, RAMPS.moss, RAMPS.timber);

  // Fibrous Carboniferous trunk with diagonal diamond leaf-scar bark
  buf.layer((sub) => {
    for (let y = 21; y <= 46; y++) {
      const u = (y - 21) / 25;
      const flare = y > 40 ? Math.round((y - 40) * 0.7) : 0;
      const hw = 2 + flare;
      const lean = Math.round(sway * (1 - u) * 0.6);
      for (let dx = -hw; dx <= hw; dx++) {
        const diamond = (dx + y) % 3 === 0;
        const c =
          dx < -hw * 0.3
            ? RAMPS.timber.highlight
            : dx > hw * 0.35
              ? RAMPS.timber.deep
              : diamond
                ? RAMPS.timber.shadow
                : RAMPS.timber.mid;
        sub.setPixel(24 + dx + lean, y, c);
      }
    }
  });

  // Radiating arching feathery fern fronds & spiral fiddlehead shoots
  const cx = 24 + Math.round(sway * 0.7);
  const fronds = [
    { ang: -2.75, len: 17 },
    { ang: -2.2, len: 16 },
    { ang: -1.57, len: 14 },
    { ang: -0.95, len: 16 },
    { ang: -0.4, len: 17 },
    { ang: 0.25, len: 14 },
    { ang: 2.9, len: 14 },
  ];
  buf.layer((sub) => {
    for (const f of fronds) {
      const ang = f.ang + sway * 0.04;
      for (let i = 0; i <= f.len; i++) {
        const u = i / f.len;
        const fx = Math.round(cx + Math.cos(ang) * i * 1.1);
        const fy = Math.round(21 + Math.sin(ang) * i * 0.9 + u * u * 5);
        const leafletW = Math.max(1, Math.round(Math.sin(u * Math.PI) * 3));
        for (let w = -leafletW; w <= leafletW; w++) {
          const px = fx;
          const py = fy + w;
          if (px >= 2 && px < 46 && py >= 2 && py < 51) {
            const c =
              w < 0 && u < 0.75
                ? RAMPS.moss.highlight
                : u > 0.7 || w > 1
                  ? RAMPS.pine.shadow
                  : RAMPS.moss.mid;
            sub.setPixel(px, py, c);
          }
        }
      }
    }
    // Coiled young fiddlehead shoots at center crown
    sub.fillEllipse(cx, 19, 3, 2.5, RAMPS.moss.highlight);
    sub.setPixel(cx - 1, 18, RAMPS.emerald.highlight);
  });

  return buf;
}

/**
 * 3. Гнездо с Яйцами Ящера (Mesozoic Dinosaur Nest, 46×34, animated 12f)
 */
function renderDinoEggNest(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(46, 34);
  const p = frame / Math.max(1, total);
  const wobble = Math.sin(p * Math.PI * 2);

  // Earthy crater bowl + woven dry fern & twig rim
  buf.layer((sub) => {
    sub.fillEllipse(23, 25, 16, 6.2, (nx, ny, px, py) => {
      const twig = (px * 5 + py * 3) % 7 === 0;
      if (ny > 0.45 || nx > 0.45) return RAMPS.timber.deep;
      if (twig) return RAMPS.sandstone.shadow;
      return pickTopLeftTone(nx, ny, RAMPS.timber);
    });
    // Hollow dark warm bedding inside crater
    sub.fillEllipse(23, 23, 11, 3.8, RAMPS.timber.deep);
  });

  // 4 speckled oval dinosaur eggs nestled cleanly inside (center egg wobbles gently!)
  const eggs = [
    { x: 16, y: 21, rx: 3.0, ry: 4.0, dx: 0 },
    { x: 29, y: 22, rx: 3.1, ry: 4.1, dx: 0 },
    { x: 20, y: 19, rx: 3.2, ry: 4.4, dx: 0 },
    { x: 25, y: 20, rx: 3.3, ry: 4.6, dx: Math.round(wobble) },
  ];
  buf.layer((sub) => {
    for (const e of eggs) {
      sub.fillEllipse(e.x + e.dx, e.y, e.rx, e.ry, (nx, ny, px, py) => {
        const spot = (px * 3 + py * 7) % 11 === 0;
        if (spot) return RAMPS.moss.mid;
        return pickTopLeftTone(nx, ny, RAMPS.bone);
      });
    }
    // Zigzag hatch crack on animated egg
    sub.setPixel(24 + Math.round(wobble), 18, VOID);
    sub.setPixel(25 + Math.round(wobble), 19, VOID);
    sub.setPixel(26 + Math.round(wobble), 18, VOID);
  });

  // Front woven rim twigs + fern sprig
  buf.layer((sub) => {
    for (let dx = -12; dx <= 12; dx += 3) {
      sub.drawLine(23 + dx, 27, 25 + dx, 25, dx < 0 ? RAMPS.sandstone.highlight : RAMPS.timber.shadow, 1);
    }
    sub.drawLine(9, 25, 4, 19, RAMPS.moss.highlight, 1);
    sub.drawLine(10, 26, 6, 22, RAMPS.moss.mid, 1);
    sub.drawLine(37, 25, 42, 20, RAMPS.moss.mid, 1);
  });

  // Gentle warm forest fireflies drifting above warm nest bowl
  const t = p * Math.PI * 2;
  const fx = Math.round(23 + Math.sin(t) * 6);
  const fy = Math.round(11 + Math.cos(t * 2) * 2);
  buf.setPixel(fx, fy, RAMPS.gold.highlight);
  buf.setPixel(Math.round(14 - Math.cos(t) * 3), Math.round(13 + Math.sin(t) * 2), RAMPS.emerald.highlight);

  return buf;
}

/**
 * 4. Кладка Яиц в Папоротнике (Prehistoric Egg Clutch, 44×32, static 1f)
 */
function renderDinoEggClutch(): PixelBuffer {
  const buf = new PixelBuffer(44, 32);

  drawGroundPlinth(buf, 22, 25, 16, 4.5, RAMPS.moss, RAMPS.sandstone);

  // Smooth protective boulders & cycad leaves around mossy clutch hollow
  buf.layer((sub) => {
    sub.fillEllipse(11, 22, 4.2, 3.2, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.slate));
    sub.fillEllipse(33, 23, 4.0, 3.0, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.slate));
    sub.fillEllipse(22, 22, 9.0, 3.2, RAMPS.timber.deep);
  });

  // 5 clustered speckled eggs tucked tightly together
  const spots = [
    { x: 17, y: 20 },
    { x: 21, y: 18 },
    { x: 26, y: 19 },
    { x: 20, y: 22 },
    { x: 25, y: 22 },
  ];
  buf.layer((sub) => {
    for (const s of spots) {
      sub.fillEllipse(s.x, s.y, 2.7, 3.5, (nx, ny, px, py) => {
        if ((px + py * 2) % 6 === 0) return RAMPS.sandstone.mid;
        return pickTopLeftTone(nx, ny, RAMPS.birch);
      });
    }
  });

  // Broad arching fern leaves sheltering the clutch
  buf.layer((sub) => {
    for (const dir of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const fx = 22 + dir * (6 + i);
        const fy = Math.round(24 - Math.sin((i / 8) * Math.PI) * 7);
        sub.fillEllipse(fx, fy, 1.8, 1.3, dir < 0 ? RAMPS.moss.highlight : RAMPS.moss.mid);
      }
    }
  });

  return buf;
}

/**
 * 5. Гигантский Мезозойский Саговник (Mesozoic Giant Cycad Fern, 48×52, animated 12f)
 */
function renderDinoGiantFern(frame: number, total: number): PixelBuffer {
  const buf = new PixelBuffer(48, 52);
  const p = frame / Math.max(1, total);
  const breeze = Math.sin(p * Math.PI * 2) * 1.4;

  drawGroundPlinth(buf, 24, 45, 15, 4.2, RAMPS.sandstone, RAMPS.moss);

  // Thick armored cycad trunk ringed by overlapping leaf-scales
  buf.layer((sub) => {
    for (let y = 23; y <= 44; y++) {
      const hw = 4 + (y > 38 ? 2 : 0);
      for (let dx = -hw; dx <= hw; dx++) {
        const scale = (Math.floor(y / 3) % 2 === 0 ? dx : dx + 2) % 4 === 0;
        const c =
          dx < -hw * 0.3
            ? RAMPS.sandstone.highlight
            : dx > hw * 0.3
              ? RAMPS.timber.deep
              : scale
                ? RAMPS.timber.shadow
                : RAMPS.sandstone.mid;
        sub.setPixel(24 + dx, y, c);
      }
    }
  });

  // Radiant rosette of spiky emerald cycad fronds + central golden amber cone
  const cx = 24 + Math.round(breeze * 0.5);
  buf.layer((sub) => {
    const rays = [
      { ang: -2.85, len: 18 },
      { ang: -2.35, len: 17 },
      { ang: -1.85, len: 15 },
      { ang: -1.25, len: 15 },
      { ang: -0.75, len: 17 },
      { ang: -0.25, len: 18 },
      { ang: 0.35, len: 13 },
      { ang: 2.75, len: 13 },
    ];
    for (const r of rays) {
      const ang = r.ang + breeze * 0.04;
      for (let i = 0; i <= r.len; i++) {
        const u = i / r.len;
        const fx = Math.round(cx + Math.cos(ang) * i);
        const fy = Math.round(23 + Math.sin(ang) * i * 0.8 + u * u * 4);
        const half = u < 0.8 ? 1 : 0;
        for (let h = -half; h <= half; h++) {
          sub.setPixel(
            fx,
            fy + h,
            h < 0 ? RAMPS.emerald.highlight : u > 0.65 ? RAMPS.pine.mid : RAMPS.emerald.mid
          );
        }
      }
    }
    // Golden prehistoric cycad seed cone at crown center
    sub.fillEllipse(cx, 19, 2.8, 3.6, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.gold));
  });

  return buf;
}

/**
 * 6. Кости и Рёбра Гиганта (Fossilized Giant Ribcage & Bones, 54×38, static 1f)
 */
function renderDinoFossilRibcage(): PixelBuffer {
  const buf = new PixelBuffer(54, 38);

  drawGroundPlinth(buf, 27, 30, 21, 5.2, RAMPS.sandstone, RAMPS.timber);

  // Back row ribs curving upward from sandy soil
  buf.layer((sub) => {
    const spineXs = [15, 20, 25, 30, 35];
    for (const sx of spineXs) {
      drawCurvedHorn(sub, sx, 29, sx + 2, 12, sx + 5, 20, 1.5, RAMPS.bone);
    }
  });

  // Heavy articulated vertebral spinal column + half-buried giant theropod jawbone
  buf.layer((sub) => {
    for (let x = 12; x <= 40; x += 4) {
      sub.fillEllipse(x, 26, 2.3, 2.6, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.birch));
      sub.fillRect(x - 1, 22, 2, 3, RAMPS.bone.highlight);
    }
    // Near arching curved rib bones
    for (const sx of [16, 21, 26, 31, 36]) {
      drawCurvedHorn(sub, sx, 27, sx - 2, 10, sx - 5, 18, 1.7, RAMPS.birch);
    }
    // Half-buried skull & toothed jaw on right
    sub.fillEllipse(43, 26, 5.5, 3.8, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.bone));
    sub.fillRect(42, 24, 2, 2, VOID);
    for (let tx = 44; tx <= 47; tx += 2) {
      sub.setPixel(tx, 28, '#FFFFFF');
    }
  });

  // Moss & fern shoots sprouting around ancient bones
  buf.layer((sub) => {
    sub.fillEllipse(11, 29, 3.2, 2.2, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.moss));
    sub.drawLine(34, 30, 38, 25, RAMPS.moss.highlight, 1);
    sub.drawLine(35, 30, 40, 27, RAMPS.moss.mid, 1);
  });

  return buf;
}

export const ERA_PROP_MODELS: PixelModelDef[] = [
  {
    id: 'primordial-stromatolite',
    name: 'Строматолитовый Риф',
    subtitle: 'Древнейшие микробные колонии (46×40)',
    kind: 'nature',
    tier: 'I',
    era: 'primordial',
    entityType: 'nature',
    buildingFunction: 'nature',
    faction: 'Лесной Круг',
    width: 46,
    height: 40,
    frameCount: 12,
    defaultFps: 8,
    layersSpec: ['1. Известняковый морской грунт', '2. Слоистые купола строматолитов', '3. Водоросли и пузырьки кислорода'],
    description: 'Древнейшие мелководные рифы Земли, насыщающие первобытный океан кислородом.',
    renderFrame: renderStromatoliteReef,
    codeSnippet: '// Procedural Primordial Stromatolite Reef — zero black contours',
  },
  {
    id: 'primordial-tree-fern',
    name: 'Гигантский Папоротник',
    subtitle: 'Древовидный папоротник карбона (48×54)',
    kind: 'nature',
    tier: 'I',
    era: 'primordial',
    entityType: 'nature',
    buildingFunction: 'nature',
    faction: 'Лесной Круг',
    width: 48,
    height: 54,
    frameCount: 12,
    defaultFps: 8,
    layersSpec: ['1. Волокнистый ствол со следами черешков', '2. Перистые вайи кроны', '3. Молодые завитки-улитки'],
    description: 'Высокий древовидный папоротник влажных болот карбона с раскачивающимися перистыми листьями.',
    renderFrame: renderPrimordialTreeFern,
    codeSnippet: '// Procedural Carboniferous Tree Fern — borderless 4-tone foliage',
  },
  {
    id: 'dino-egg-nest',
    name: 'Гнездо с Яйцами Ящера',
    subtitle: 'Выводок динозавров (46×34)',
    kind: 'nature',
    tier: 'I',
    era: 'dinosaurs',
    entityType: 'nature',
    buildingFunction: 'nature',
    faction: 'Орда',
    width: 46,
    height: 34,
    frameCount: 12,
    defaultFps: 9,
    layersSpec: ['1. Земляной вал гнезда', '2. Четыре крапчатых яйца с трещиной', '3. Ветви и побеги папоротника'],
    description: 'Утоптанное гнездо хищного ящера с тёплой подстилкой и готовым вылупиться яйцом.',
    renderFrame: renderDinoEggNest,
    codeSnippet: '// Procedural Dinosaur Nest with Hatching Egg',
  },
  {
    id: 'dino-egg-clutch',
    name: 'Кладка Яиц в Папоротнике',
    subtitle: 'Лесная кладка мезозоя (44×32)',
    kind: 'nature',
    tier: 'I',
    era: 'dinosaurs',
    entityType: 'nature',
    buildingFunction: 'nature',
    faction: 'Лесной Круг',
    width: 44,
    height: 32,
    frameCount: 1,
    defaultFps: 1,
    layersSpec: ['1. Валуны укрытия', '2. Пять кожистых яиц', '3. Укрытие из листьев'],
    description: 'Скрытая среди камней и широких папоротников кладка травоядного ящера.',
    renderFrame: renderDinoEggClutch,
    codeSnippet: '// Procedural Mesozoic Egg Clutch',
  },
  {
    id: 'dino-giant-fern',
    name: 'Мезозойский Саговник',
    subtitle: 'Древняя пальма с золотой шишкой (48×52)',
    kind: 'nature',
    tier: 'I',
    era: 'dinosaurs',
    entityType: 'nature',
    buildingFunction: 'nature',
    faction: 'Лесной Круг',
    width: 48,
    height: 52,
    frameCount: 12,
    defaultFps: 8,
    layersSpec: ['1. Чешуйчатый бронированный ствол', '2. Розетка жёстких листьев', '3. Золотистая семенная шишка'],
    description: 'Мощный мезозойский саговник — основная кормовая база длинношеих и рогатых динозавров.',
    renderFrame: renderDinoGiantFern,
    codeSnippet: '// Procedural Mesozoic Cycad Fern',
  },
  {
    id: 'dino-fossil-ribcage',
    name: 'Кости и Рёбра Гиганта',
    subtitle: 'Останки гигантского ящера (54×38)',
    kind: 'nature',
    tier: 'II',
    era: 'dinosaurs',
    entityType: 'nature',
    buildingFunction: 'nature',
    faction: 'Некрополь',
    width: 54,
    height: 38,
    frameCount: 1,
    defaultFps: 1,
    layersSpec: ['1. Задний ряд рёбер', '2. Позвоночник и череп в земле', '3. Побеги мха на костях'],
    description: 'Выбеленные солнцем позвонки, изогнутые рёбра и челюсть павшего исполина мезозоя.',
    renderFrame: renderDinoFossilRibcage,
    codeSnippet: '// Procedural Giant Dinosaur Ribcage & Fossil Bones',
  },
];
