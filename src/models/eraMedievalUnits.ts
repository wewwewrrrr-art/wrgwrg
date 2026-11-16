import { RAMPS, SKIN_MASK } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import { PixelModelDef, RenderContextOptions } from './types';
import {
  clipToSwimUpperBody,
  drawShadedLimb,
  finalizeEraCreatureAction,
  getEraModeAction,
  getWalkCycle,
  pickTopLeftTone,
} from './eraCreatureHelpers';

/**
 * Medieval Human Units (~10×10 px human core, warhorse cavalry 32×24).
 * Borderless 4-tone top-left shading, K1/K2 faction recoloring, SKIN_MASK phenotypes.
 */

// 1. Medieval Peasant (20×18, Tier I) — Straw Hat + Tunic + Pitchfork
function renderMedievalPeasant(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';

  const buf = new PixelBuffer(20, 18);
  const cx = 10;
  const bodyY = 10 + bounceY + (mode === 'swim' ? 2 : 0);

  if (mode !== 'swim') {
    const l1 = Math.round(cx - 1 + legSwing * 0.7);
    const l2 = Math.round(cx + 1 - legSwing * 0.7);
    buf.drawLine(cx - 1, bodyY + 2, l1, 15, RAMPS.timber.shadow, 1);
    buf.drawLine(cx + 1, bodyY + 2, l2, 15, RAMPS.timber.deep, 1);
  }

  // Simple peasant tunic K1/K2 + rope belt
  buf.layer((sub) => {
    sub.fillEllipse(cx, bodyY, 2.7, 2.5, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.drawLine(cx - 2, bodyY + 1, cx + 2, bodyY + 1, RAMPS.cyanMask.mid, 1);
  });

  // 4×4 Head + broad straw hat
  buf.layer((sub) => {
    const hy = bodyY - 4;
    sub.fillRect(cx - 2, hy - 1, 4, 3, SKIN_MASK[0]);
    sub.setPixel(cx - 1, hy, '#261812');
    sub.fillRect(cx - 3, hy - 2, 6, 1, RAMPS.gold.highlight); // brim
    sub.fillRect(cx - 1, hy - 3, 3, 1, RAMPS.gold.mid); // crown
    if (appLevel === 2) sub.setPixel(cx + 2, hy - 3, RAMPS.cyanMask.highlight);
  });

  // 3-prong iron pitchfork (jabbing in attack)
  const jab = isAtk ? (phase < 0.35 ? 2 : phase < 0.72 ? -3 : 0) : 0;
  const fx = cx - 5 + jab;
  buf.drawLine(cx + 1 + jab, bodyY, fx, bodyY - 2, RAMPS.timber.mid, 1);
  buf.setPixel(fx - 1, bodyY - 3, RAMPS.marble.highlight);
  buf.setPixel(fx - 1, bodyY - 2, RAMPS.marble.mid);
  buf.setPixel(fx - 1, bodyY - 1, RAMPS.marble.shadow);

  if (mode === 'swim') clipToSwimUpperBody(buf, 11, 3, 16, frame);
  return finalizeEraCreatureAction(buf, frame, total, 10, 14, action);
}

// 2. Royal Longbow Archer (20×18, Tier II) — Hooded Tunic + Tall Yew Longbow
function renderMedievalArcher(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';

  const buf = new PixelBuffer(20, 18);
  const cx = 10;
  const bodyY = 10 + bounceY + (mode === 'swim' ? 2 : 0);

  if (mode !== 'swim') {
    const l1 = Math.round(cx - 1 + legSwing * 0.8);
    const l2 = Math.round(cx + 1 - legSwing * 0.8);
    buf.drawLine(cx - 1, bodyY + 2, l1, 15, RAMPS.slate.shadow, 1);
    buf.drawLine(cx + 1, bodyY + 2, l2, 15, RAMPS.slate.deep, 1);
  }

  // Arrow quiver on shoulder
  buf.drawLine(cx + 2, bodyY - 2, cx + 3, bodyY + 1, RAMPS.timber.shadow, 1);
  buf.setPixel(cx + 3, bodyY - 3, '#FFFFFF');

  // Hooded archer jerkin K1 + shoulder pad K2
  buf.layer((sub) => {
    sub.fillEllipse(cx, bodyY, 2.7, 2.6, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.fillRect(cx - 2, bodyY - 1, 2, 2, RAMPS.cyanMask.mid);
  });

  // 4×4 Head + peaked archer hood
  buf.layer((sub) => {
    const hy = bodyY - 4;
    sub.fillRect(cx - 2, hy - 1, 4, 3, SKIN_MASK[0]);
    sub.setPixel(cx - 1, hy, '#261812');
    sub.fillRect(cx - 2, hy - 2, 4, 1, RAMPS.magenta.highlight);
    sub.fillRect(cx + 1, hy - 1, 2, 2, RAMPS.magenta.shadow);
    if (appLevel >= 1) sub.setPixel(cx + 2, hy - 3, RAMPS.cyanMask.highlight); // feather
  });

  // Tall yew longbow + loosed arrow
  const bowX = cx - 4;
  buf.drawLine(bowX, bodyY - 4, bowX - 1, bodyY - 1, RAMPS.timber.highlight, 1);
  buf.drawLine(bowX - 1, bodyY - 1, bowX, bodyY + 3, RAMPS.timber.shadow, 1);
  buf.drawLine(bowX, bodyY - 4, bowX, bodyY + 3, RAMPS.marble.mid, 1);
  if (isAtk && phase >= 0.35) {
    const ax = Math.max(1, Math.round(bowX - 2 - (phase - 0.35) * 9));
    buf.drawLine(ax, bodyY - 1, ax + 3, bodyY - 1, RAMPS.marble.highlight, 1);
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 11, 3, 16, frame);
  return finalizeEraCreatureAction(buf, frame, total, 10, 14, action);
}

// 3. Medieval Knight Cavalry (32×24, Tier III) — Armored Charger + Lance Knight
function renderMedievalCavalry(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const charge = isAtk ? (phase < 0.3 ? 1 : phase < 0.72 ? -3 : 0) : 0;

  const buf = new PixelBuffer(32, 24);
  const cx = 16 + charge;
  const horseY = 14 + bounceY + (mode === 'swim' ? 3 : 0);

  // Flowing horse tail
  buf.drawLine(cx + 6, horseY - 1, cx + 10, horseY + 2, RAMPS.timber.deep, 1);

  // Far legs
  if (mode !== 'swim') {
    drawShadedLimb(buf, cx - 4, horseY + 2, cx - 6 - legSwing * 1.1, 21, 1.1, RAMPS.marble);
    drawShadedLimb(buf, cx + 4, horseY + 2, cx + 5 + legSwing * 1.1, 21, 1.1, RAMPS.marble);
  }

  // Armored warhorse body + heraldic K1/K2 barding cloth
  buf.layer((sub) => {
    sub.fillEllipse(cx, horseY, 6.4, 3.4, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.slate));
    sub.fillRect(cx - 5, horseY - 2, 10, 4, RAMPS.magenta.mid);
    sub.drawLine(cx - 4, horseY + 1, cx + 4, horseY + 1, RAMPS.cyanMask.highlight, 1);
    // Steel neck barding + charger head
    drawShadedLimb(sub, cx - 4, horseY - 1, cx - 7, horseY - 5, 1.8, RAMPS.marble);
    sub.fillRect(cx - 10, horseY - 6, 3, 2, RAMPS.marble.highlight);
    if (appLevel >= 1) sub.setPixel(cx - 8, horseY - 8, RAMPS.magenta.highlight); // horse crest
  });

  // Near legs
  if (mode !== 'swim') {
    drawShadedLimb(buf, cx - 4, horseY + 2, cx - 6 + legSwing * 1.1, 21, 1.1, RAMPS.slate);
    drawShadedLimb(buf, cx + 4, horseY + 2, cx + 5 - legSwing * 1.1, 21, 1.1, RAMPS.slate);
  }

  // Mounted Knight (~10×10 rider torso + steel greathelm + lance)
  buf.layer((sub) => {
    const ry = horseY - 6;
    sub.fillEllipse(cx + 1, ry, 2.6, 2.5, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.marble));
    sub.fillRect(cx - 1, ry - 1, 3, 2, RAMPS.magenta.highlight); // surcoat K1
    // Greathelm with SKIN_MASK visor slit
    sub.fillRect(cx - 1, ry - 5, 4, 3, RAMPS.marble.highlight);
    sub.fillRect(cx - 1, ry - 4, 2, 1, SKIN_MASK[0]); // visor eye slit
    if (appLevel === 2) sub.drawLine(cx + 1, ry - 6, cx + 3, ry - 6, RAMPS.cyanMask.highlight, 1); // helm plume

    // Couched jousting lance
    const lanceY = ry + (isAtk && phase >= 0.3 && phase < 0.75 ? 1 : -1);
    sub.drawLine(cx + 3, ry, cx - 12 + charge, lanceY, RAMPS.timber.highlight, 1);
    sub.setPixel(cx - 13 + charge, lanceY, RAMPS.marble.highlight);
    sub.setPixel(cx - 8 + charge, lanceY + 1, RAMPS.cyanMask.highlight); // lance pennon
  });

  if (mode === 'swim') clipToSwimUpperBody(buf, 16, 3, 28, frame);
  return finalizeEraCreatureAction(buf, frame, total, 16, 21, action);
}

// 4. Medieval Chronicle Monk (20×18, Tier II) — Hooded Robe + Illuminated Tome
function renderMedievalMonk(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { stepIdx, phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';

  const buf = new PixelBuffer(20, 18);
  const cx = 10;
  const bodyY = 10 + bounceY + (mode === 'swim' ? 2 : 0);

  if (mode !== 'swim') {
    const l1 = Math.round(cx - 1 + legSwing * 0.95);
    const l2 = Math.round(cx + 1 - legSwing * 0.95);
    buf.drawLine(cx - 1, bodyY + 2, l1, 16, RAMPS.timber.shadow, 1);
    buf.drawLine(cx + 1, bodyY + 2, l2, 16, RAMPS.timber.deep, 1);
    buf.setPixel(l1 + (stepIdx === 1 ? -1 : 0), 16, RAMPS.timber.mid);
  }

  // Long monastic robe K1 + cord sash K2
  buf.layer((sub) => {
    sub.fillEllipse(cx, bodyY + 1, 3.0, 3.2, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.drawLine(cx - 2, bodyY, cx + 2, bodyY, RAMPS.cyanMask.highlight, 1);
  });

  // 4×4 Head + tonsure / cowl
  buf.layer((sub) => {
    const hy = bodyY - 4;
    sub.fillRect(cx - 2, hy - 1, 4, 3, SKIN_MASK[0]);
    sub.setPixel(cx - 1, hy, '#261812');
    sub.fillRect(cx + 1, hy - 2, 2, 3, RAMPS.magenta.shadow); // dropped cowl
    if (appLevel >= 1) sub.setPixel(cx, hy - 2, RAMPS.gold.highlight); // brass circlet / halo glint
  });

  // Illuminated chronicle tome + golden blessing beam on attack
  const lift = isAtk ? -1 : 0;
  buf.fillRect(cx - 5, bodyY - 1 + lift, 3, 3, RAMPS.gold.mid);
  buf.fillRect(cx - 4, bodyY - 1 + lift, 2, 2, '#FFF2A6');
  if (isAtk && phase >= 0.3 && phase < 0.78) {
    const bx = Math.max(2, Math.round(cx - 5 - phase * 4));
    buf.setPixel(bx, bodyY - 2, '#FFF2A6');
    buf.setPixel(bx, bodyY, '#FFFFFF');
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 11, 3, 16, frame);
  return finalizeEraCreatureAction(buf, frame, total, 10, 14, action);
}

export const ERA_MEDIEVAL_UNITS: PixelModelDef[] = [
  {
    id: 'medieval-peasant',
    name: 'Средневековый Крестьянин',
    subtitle: 'Житель в соломенной шляпе с вилами (~10×10 ядро)',
    kind: 'unit',
    tier: 'I',
    era: 'medieval',
    entityType: 'unit',
    faction: 'Цитадель',
    width: 20,
    height: 18,
    frameCount: 8,
    defaultFps: 10,
    attackName: 'Тычок железными вилами',
    unitMeta: {
      coreSize: '10×10 человек',
      usesSkinMask: true,
      defaultPhenotype: 'skin_light',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 8,
      supportsGenes: true,
    },
    layersSpec: ['1. Простая туника K1/K2, соломенная шляпа и SKIN_MASK', '2. Трёхзубые железные вилы'],
    description: 'Деревенский землепашец средневекового королевства: широкая соломенная шляпа, перекрашиваемая рубаха и железные вилы.',
    renderFrame: renderMedievalPeasant,
    getAnchors: () => ({ head: { x: 8, y: 3, w: 4, h: 4 }, item: { x: 3, y: 7, w: 5, h: 4 }, pivot: { x: 10, y: 15 } }),
    codeSnippet: `function renderMedievalPeasant(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(20, 18); }`,
  },
  {
    id: 'medieval-archer',
    name: 'Королевский Лучник',
    subtitle: 'Стрелок в капюшоне с тисовым луком (~10×10 ядро)',
    kind: 'unit',
    tier: 'II',
    era: 'medieval',
    entityType: 'unit',
    faction: 'Лесной Круг',
    width: 20,
    height: 18,
    frameCount: 8,
    defaultFps: 11,
    attackName: 'Выстрел из длинного лука',
    unitMeta: {
      coreSize: '10×10 человек',
      usesSkinMask: true,
      defaultPhenotype: 'skin_light',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 8,
      supportsGenes: true,
    },
    layersSpec: ['1. Капюшон и плащ державы K1/K2 + SKIN_MASK', '2. Высокий тисовый длинный лук и колчан'],
    description: 'Королевский стрелок с высоким тисовым луком: носит капюшон державы с пером и выпускает оперенные стрелы.',
    renderFrame: renderMedievalArcher,
    getAnchors: () => ({ head: { x: 8, y: 4, w: 4, h: 4 }, item: { x: 4, y: 6, w: 4, h: 7 }, pivot: { x: 10, y: 15 } }),
    codeSnippet: `function renderMedievalArcher(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(20, 18); }`,
  },
  {
    id: 'medieval-cavalry',
    name: 'Рыцарский Всадник',
    subtitle: 'Бронированный конь и латник с копьём (32×24)',
    kind: 'unit',
    tier: 'III',
    era: 'medieval',
    entityType: 'unit',
    faction: 'Цитадель',
    width: 32,
    height: 24,
    frameCount: 8,
    defaultFps: 12,
    attackName: 'Копейная сшибка на полном скаку',
    unitMeta: {
      coreSize: '26×18 всадник + латник 10×10',
      usesSkinMask: true,
      defaultPhenotype: 'skin_light',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 16,
      supportsGenes: true,
    },
    layersSpec: ['1. Боевой конь в попоне державы K1/K2', '2. Рыцарь в топфхельме с плюмажем и рыцарским копьём'],
    description: 'Тяжёлый кавалерист средневековья: стальная броня коня, геральдическая попона K1/K2 и таранный удар турнирным копьём.',
    renderFrame: renderMedievalCavalry,
    getAnchors: () => ({ head: { x: 15, y: 3, w: 4, h: 4 }, item: { x: 3, y: 6, w: 12, h: 4 }, pivot: { x: 16, y: 21 } }),
    codeSnippet: `function renderMedievalCavalry(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(32, 24); }`,
  },
  {
    id: 'medieval-monk',
    name: 'Монах-Летописец',
    subtitle: 'Духовный книжник с фолиантом (~10×10 ядро)',
    kind: 'unit',
    tier: 'II',
    era: 'medieval',
    entityType: 'unit',
    faction: 'Цитадель',
    width: 20,
    height: 18,
    frameCount: 8,
    defaultFps: 10,
    attackName: 'Озарение древнего манускрипта',
    unitMeta: {
      coreSize: '10×10 человек',
      usesSkinMask: true,
      defaultPhenotype: 'skin_pale',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 8,
      supportsGenes: true,
    },
    layersSpec: ['1. Ряса с поясом K1/K2 и лицо SKIN_MASK', '2. Золотой манускрипт со вспышкой благословения'],
    description: 'Учёный монах средневекового аббатства в длинной рясе державы, хранящий золотой иллюминированный фолиант.',
    renderFrame: renderMedievalMonk,
    getAnchors: () => ({ head: { x: 8, y: 4, w: 4, h: 4 }, item: { x: 4, y: 8, w: 4, h: 4 }, pivot: { x: 10, y: 15 } }),
    codeSnippet: `function renderMedievalMonk(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(20, 18); }`,
  },
];
