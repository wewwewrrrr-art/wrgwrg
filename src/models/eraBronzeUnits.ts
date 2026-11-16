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
 * Bronze & Iron Age Human Units (~10×10 px human core, chariot 34×24).
 * Borderless 4-tone top-left shading, K1/K2 faction recoloring, SKIN_MASK phenotypes.
 */

// 1. Bronze Spearman (22×20, Tier I) — Bronze Crested Helm + Round Shield + Spear
function renderBronzeSpearman(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';

  const buf = new PixelBuffer(22, 20);
  const cx = 11;
  const bodyY = 11 + bounceY + (mode === 'swim' ? 2 : 0);

  if (mode !== 'swim') {
    const l1 = Math.round(cx - 1 + legSwing * 0.8);
    const l2 = Math.round(cx + 1 - legSwing * 0.8);
    buf.drawLine(cx - 1, bodyY + 2, l1, 17, RAMPS.timber.shadow, 1);
    buf.drawLine(cx + 1, bodyY + 2, l2, 17, RAMPS.timber.deep, 1);
    buf.setPixel(l1, 17, RAMPS.gold.mid); // bronze greave
  }

  // Bronze breastplate + K1 kilt + K2 sash
  buf.layer((sub) => {
    sub.fillEllipse(cx, bodyY, 2.9, 2.8, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.gold));
    sub.fillRect(cx - 2, bodyY + 1, 5, 2, RAMPS.magenta.mid);
    sub.drawLine(cx - 2, bodyY, cx + 2, bodyY, RAMPS.cyanMask.mid, 1);
  });

  // Head on SKIN_MASK + Corinthian/Mycenaean bronze helm + horsehair crest
  buf.layer((sub) => {
    const hy = bodyY - 5;
    sub.fillRect(cx - 2, hy - 1, 4, 3, SKIN_MASK[0]);
    sub.setPixel(cx - 1, hy, '#261812');
    sub.fillRect(cx - 2, hy - 2, 4, 2, RAMPS.gold.highlight);
    sub.setPixel(cx + 1, hy - 1, RAMPS.gold.shadow);
    if (appLevel >= 1) {
      sub.drawLine(cx - 1, hy - 3, cx + 2, hy - 3, RAMPS.magenta.highlight, 1); // K1 plume crest
    }
  });

  // Embossed round bronze shield + forward thrusting bronze spear
  const thrust = isAtk ? (phase < 0.35 ? 2 : phase < 0.72 ? -4 : 0) : 0;
  buf.layer((sub) => {
    sub.fillEllipse(cx - 3, bodyY, 2.5, 2.9, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.gold));
    sub.fillRect(cx - 4, bodyY - 1, 2, 2, RAMPS.cyanMask.highlight);
  });
  buf.drawLine(cx + 2 + thrust, bodyY - 1, cx - 8 + thrust, bodyY - 2, RAMPS.timber.mid, 1);
  buf.setPixel(cx - 9 + thrust, bodyY - 2, RAMPS.gold.highlight); // leaf-shaped bronze tip
  if (isAtk && phase >= 0.35 && phase < 0.72) {
    buf.setPixel(cx - 10 + thrust, bodyY - 2, '#FFFFFF');
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 12, 3, 18, frame);
  return finalizeEraCreatureAction(buf, frame, total, 11, 16, action);
}

// 2. Bronze Archer (22×20, Tier I) — Scaled Bronze Corslet + Recurve Bow
function renderBronzeArcher(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';

  const buf = new PixelBuffer(22, 20);
  const cx = 11;
  const bodyY = 11 + bounceY + (mode === 'swim' ? 2 : 0);

  if (mode !== 'swim') {
    const l1 = Math.round(cx - 1 + legSwing * 0.8);
    const l2 = Math.round(cx + 1 - legSwing * 0.8);
    buf.drawLine(cx - 1, bodyY + 2, l1, 17, RAMPS.timber.shadow, 1);
    buf.drawLine(cx + 1, bodyY + 2, l2, 17, RAMPS.timber.deep, 1);
  }

  // Quiver on back
  buf.drawLine(cx + 2, bodyY - 2, cx + 4, bodyY + 1, RAMPS.timber.mid, 1);
  buf.setPixel(cx + 3, bodyY - 3, '#FFFFFF');

  // Tunic K1 + bronze scale belt K2
  buf.layer((sub) => {
    sub.fillEllipse(cx, bodyY, 2.7, 2.6, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.drawLine(cx - 2, bodyY + 1, cx + 2, bodyY + 1, RAMPS.gold.mid, 1);
    sub.setPixel(cx, bodyY - 1, RAMPS.cyanMask.highlight);
  });

  // 4×4 Head + bronze headband
  buf.layer((sub) => {
    const hy = bodyY - 5;
    sub.fillRect(cx - 2, hy - 1, 4, 3, SKIN_MASK[0]);
    sub.fillRect(cx - 2, hy - 2, 4, 1, RAMPS.gold.highlight);
    sub.setPixel(cx + 1, hy - 1, RAMPS.timber.deep);
    sub.setPixel(cx - 1, hy, '#261812');
    if (appLevel === 2) sub.setPixel(cx + 1, hy - 3, RAMPS.cyanMask.highlight);
  });

  // Composite recurve bow & flying bronze-tipped arrow
  const bowX = cx - 4;
  buf.drawLine(bowX, bodyY - 3, bowX - 2, bodyY - 1, RAMPS.gold.mid, 1);
  buf.drawLine(bowX - 2, bodyY - 1, bowX, bodyY + 2, RAMPS.gold.shadow, 1);
  buf.drawLine(bowX, bodyY - 3, bowX, bodyY + 2, RAMPS.bone.highlight, 1);
  if (isAtk && phase >= 0.35) {
    const ax = Math.max(2, Math.round(bowX - 2 - (phase - 0.35) * 8));
    buf.drawLine(ax, bodyY - 1, ax + 3, bodyY - 1, RAMPS.gold.highlight, 1);
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 12, 3, 18, frame);
  return finalizeEraCreatureAction(buf, frame, total, 11, 16, action);
}

// 3. Bronze War Chariot (34×24, Tier III) — Warhorse + Spoked Wheel + Charioteer
function renderBronzeChariot(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const surge = isAtk ? (phase < 0.3 ? 1 : phase < 0.7 ? -2 : 0) : 0;

  const buf = new PixelBuffer(34, 24);
  const hx = 10 + surge;
  const hy = 13 + bounceY + (mode === 'swim' ? 3 : 0);
  const wheelX = 24 + surge;
  const wheelY = 18 + (mode === 'swim' ? 3 : 0);

  // Galloping warhorse (front)
  if (mode !== 'swim') {
    drawShadedLimb(buf, hx - 3, hy + 2, hx - 5 + legSwing * 1.1, 21, 1.1, RAMPS.timber);
    drawShadedLimb(buf, hx + 3, hy + 2, hx + 4 - legSwing * 1.1, 21, 1.1, RAMPS.timber);
  }
  buf.layer((sub) => {
    sub.fillEllipse(hx, hy, 5.2, 3.0, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.timber));
    // K1/K2 bronze war caparison
    sub.fillRect(hx - 3, hy - 2, 6, 3, RAMPS.magenta.mid);
    sub.drawLine(hx - 2, hy, hx + 2, hy, RAMPS.cyanMask.highlight, 1);
    // Neck & armored horse head
    drawShadedLimb(sub, hx - 3, hy - 1, hx - 6, hy - 5, 1.6, RAMPS.timber);
    sub.fillRect(hx - 8, hy - 6, 3, 2, RAMPS.gold.highlight); // bronze chamfron
    if (appLevel >= 1) sub.setPixel(hx - 6, hy - 8, RAMPS.magenta.highlight); // horse plume
  });

  // Wooden draught pole connecting horse & chariot cab
  buf.drawLine(hx + 4, hy + 1, wheelX - 2, wheelY - 2, RAMPS.timber.shadow, 1);

  // Chariot body & bronze-shielded driver (~10×10 driver core)
  buf.layer((sub) => {
    const driverY = wheelY - 6 + bounceY;
    // Charioteer torso K1/K2 + SKIN_MASK head + bronze crest
    sub.fillEllipse(wheelX, driverY, 2.5, 2.5, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.fillRect(wheelX - 2, driverY - 5, 3, 3, SKIN_MASK[0]);
    sub.fillRect(wheelX - 2, driverY - 6, 4, 1, RAMPS.gold.highlight);
    if (appLevel === 2) sub.drawLine(wheelX - 1, driverY - 7, wheelX + 2, driverY - 7, RAMPS.cyanMask.highlight, 1);
    // Bronze-plated chariot front cab
    sub.fillRect(wheelX - 3, wheelY - 5, 6, 5, RAMPS.gold.mid);
    sub.fillRect(wheelX - 2, wheelY - 4, 3, 2, RAMPS.cyanMask.mid);
    // Driver spear thrusting left
    const spLift = isAtk && phase >= 0.35 && phase < 0.72 ? -3 : 0;
    sub.drawLine(wheelX + 1, driverY - 1, wheelX - 9 + spLift, driverY - 4, RAMPS.timber.highlight, 1);
    sub.setPixel(wheelX - 10 + spLift, driverY - 4, RAMPS.gold.highlight);
  });

  // Rotating 4-spoke bronze chariot wheel
  if (mode !== 'swim') {
    buf.layer((sub) => {
      sub.fillEllipse(wheelX, wheelY, 3.3, 3.3, (nx, ny) => {
        const d = Math.hypot(nx, ny);
        if (d > 0.68) return nx + ny < 0 ? RAMPS.gold.highlight : RAMPS.gold.shadow;
        return null;
      });
      const spokeDiag = frame % 2 === 0;
      if (spokeDiag) {
        sub.drawLine(wheelX - 2, wheelY - 2, wheelX + 2, wheelY + 2, RAMPS.timber.mid, 1);
        sub.drawLine(wheelX - 2, wheelY + 2, wheelX + 2, wheelY - 2, RAMPS.timber.mid, 1);
      } else {
        sub.drawLine(wheelX, wheelY - 2, wheelX, wheelY + 2, RAMPS.timber.mid, 1);
        sub.drawLine(wheelX - 2, wheelY, wheelX + 2, wheelY, RAMPS.timber.mid, 1);
      }
      sub.setPixel(wheelX, wheelY, RAMPS.gold.highlight);
    });
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 16, 3, 31, frame);
  return finalizeEraCreatureAction(buf, frame, total, 17, 20, action);
}

// 4. Bronze King (22×20, Tier III) — Horned Solar Diadem + Mantle + Khopesh
function renderBronzeKing(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';

  const buf = new PixelBuffer(22, 20);
  const cx = 11;
  const bodyY = 11 + bounceY + (mode === 'swim' ? 2 : 0);

  if (mode !== 'swim') {
    const l1 = Math.round(cx - 1 + legSwing * 0.75);
    const l2 = Math.round(cx + 1 - legSwing * 0.75);
    buf.drawLine(cx - 1, bodyY + 2, l1, 17, RAMPS.gold.shadow, 1);
    buf.drawLine(cx + 1, bodyY + 2, l2, 17, RAMPS.gold.deep, 1);
  }

  // Royal pleated cape & pectoral collar (K1/K2 + gold)
  buf.layer((sub) => {
    sub.fillEllipse(cx + 1, bodyY, 3.4, 3.0, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.fillRect(cx - 2, bodyY - 2, 5, 2, RAMPS.gold.highlight); // golden pectoral
    sub.drawLine(cx - 2, bodyY + 1, cx + 2, bodyY + 1, RAMPS.cyanMask.highlight, 1);
  });

  // 4×4 Head + Golden Solar-Horn Crown
  buf.layer((sub) => {
    const hy = bodyY - 5;
    sub.fillRect(cx - 2, hy - 1, 4, 3, SKIN_MASK[0]);
    sub.setPixel(cx - 1, hy, '#261812');
    sub.fillRect(cx - 2, hy - 3, 4, 2, RAMPS.gold.highlight);
    sub.setPixel(cx, hy - 4, RAMPS.cyanMask.highlight); // solar gem
    if (appLevel >= 1) {
      sub.setPixel(cx - 3, hy - 3, RAMPS.gold.mid); // diadem horns
      sub.setPixel(cx + 2, hy - 3, RAMPS.gold.mid);
    }
  });

  // Curved Bronze Khopesh Sword (slashes on attack)
  const swing = isAtk ? (phase < 0.35 ? -3 : phase < 0.72 ? 2 : 0) : 0;
  buf.drawLine(cx - 3, bodyY + swing, cx - 6, bodyY - 3 + swing, RAMPS.gold.highlight, 1);
  buf.setPixel(cx - 7, bodyY - 2 + swing, RAMPS.gold.mid);
  if (isAtk && phase >= 0.38 && phase < 0.74) {
    buf.drawLine(cx - 8, bodyY - 3, cx - 8, bodyY + 1, '#FFF2A6', 1);
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 12, 3, 18, frame);
  return finalizeEraCreatureAction(buf, frame, total, 11, 16, action);
}

// 5. Bronze Smith (20×18, Tier II) — Leather Apron + Foundry Hammer & Sparks
function renderBronzeSmith(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
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

  // Heavy smith tunic K1 + apron K2
  buf.layer((sub) => {
    sub.fillEllipse(cx, bodyY, 3.0, 2.7, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.fillRect(cx - 2, bodyY - 1, 3, 4, RAMPS.cyanMask.shadow);
    if (appLevel >= 1) sub.setPixel(cx + 1, bodyY, RAMPS.gold.highlight);
  });

  // 4×4 Head + smith bandana & beard
  buf.layer((sub) => {
    const hy = bodyY - 4;
    sub.fillRect(cx - 2, hy - 1, 4, 3, SKIN_MASK[0]);
    sub.fillRect(cx - 2, hy - 2, 4, 1, RAMPS.cyanMask.mid);
    sub.fillRect(cx - 2, hy + 1, 3, 1, RAMPS.timber.deep); // beard
    sub.setPixel(cx - 1, hy, '#261812');
  });

  // Heavy bronze forging hammer + ember sparks
  const strike = isAtk ? (phase < 0.35 ? -3 : phase < 0.7 ? 2 : 0) : 0;
  buf.drawLine(cx - 2, bodyY, cx - 5, bodyY - 2 + strike, RAMPS.timber.mid, 1);
  buf.fillRect(cx - 7, bodyY - 4 + strike, 3, 2, RAMPS.gold.highlight);
  if (isAtk && phase >= 0.38 && phase < 0.75) {
    buf.setPixel(cx - 7, bodyY + 1, '#FFF2A6');
    buf.setPixel(cx - 5, bodyY + 2, '#F97316');
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 11, 3, 16, frame);
  return finalizeEraCreatureAction(buf, frame, total, 10, 14, action);
}

// 6. Bronze Caravan Merchant (22×20, Tier II) — Robes + Amphora Pack + Scales Staff
function renderBronzeMerchant(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';

  const buf = new PixelBuffer(22, 20);
  const cx = 11;
  const bodyY = 11 + bounceY + (mode === 'swim' ? 2 : 0);

  if (mode !== 'swim') {
    const l1 = Math.round(cx - 1 + legSwing * 0.65);
    const l2 = Math.round(cx + 1 - legSwing * 0.65);
    buf.drawLine(cx - 1, bodyY + 2, l1, 17, RAMPS.timber.shadow, 1);
    buf.drawLine(cx + 1, bodyY + 2, l2, 17, RAMPS.timber.deep, 1);
  }

  // Caravan amphora / trade bundle strapped to back
  buf.layer((sub) => {
    sub.fillEllipse(cx + 4, bodyY - 1, 2.2, 2.8, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.gold));
    sub.setPixel(cx + 4, bodyY - 4, RAMPS.gold.highlight);
  });

  // Ornate merchant robe K1/K2
  buf.layer((sub) => {
    sub.fillEllipse(cx, bodyY, 3.0, 2.8, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.drawLine(cx - 2, bodyY, cx + 2, bodyY, RAMPS.cyanMask.highlight, 1);
  });

  // 4×4 Head + wrapped caravan turban
  buf.layer((sub) => {
    const hy = bodyY - 5;
    sub.fillRect(cx - 2, hy - 1, 4, 3, SKIN_MASK[0]);
    sub.fillEllipse(cx, hy - 2, 2.6, 1.5, RAMPS.cyanMask.highlight);
    sub.setPixel(cx - 1, hy, '#261812');
    if (appLevel === 2) sub.setPixel(cx - 1, hy - 3, RAMPS.gold.highlight); // jewel pin
  });

  // Bronze balance staff
  const lift = isAtk ? (phase < 0.4 ? -2 : 1) : 0;
  buf.drawLine(cx - 4, bodyY + 3 + lift, cx - 4, bodyY - 4 + lift, RAMPS.timber.highlight, 1);
  buf.drawLine(cx - 6, bodyY - 4 + lift, cx - 2, bodyY - 4 + lift, RAMPS.gold.highlight, 1);
  buf.setPixel(cx - 6, bodyY - 2 + lift, RAMPS.gold.mid);
  buf.setPixel(cx - 2, bodyY - 2 + lift, RAMPS.gold.mid);

  if (mode === 'swim') clipToSwimUpperBody(buf, 12, 3, 18, frame);
  return finalizeEraCreatureAction(buf, frame, total, 11, 16, action);
}

export const ERA_BRONZE_UNITS: PixelModelDef[] = [
  {
    id: 'bronze-spearman',
    name: 'Копейщик Бронзового Века',
    subtitle: 'Воин с круглым щитом и копьём (~10×10 ядро)',
    kind: 'unit',
    tier: 'I',
    era: 'bronze-iron',
    entityType: 'unit',
    faction: 'Цитадель',
    width: 22,
    height: 20,
    frameCount: 8,
    defaultFps: 10,
    attackName: 'Удар бронзовым копьём из-за щита',
    unitMeta: {
      coreSize: '10×10 человек',
      usesSkinMask: true,
      defaultPhenotype: 'skin_medium',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 9,
      supportsGenes: true,
    },
    layersSpec: ['1. Бронзовый шлем с гребнем K1, кираса и SKIN_MASK', '2. Круглый чеканный щит K2 и бронзовое копьё'],
    description: 'Строевой пехотинец ранних цивилизаций в бронзовом шлеме с конским гребнем, круглым щитом и листовидным копьём.',
    renderFrame: renderBronzeSpearman,
    getAnchors: () => ({ head: { x: 9, y: 4, w: 4, h: 4 }, item: { x: 2, y: 8, w: 7, h: 5 }, pivot: { x: 11, y: 17 } }),
    codeSnippet: `function renderBronzeSpearman(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(22, 20); }`,
  },
  {
    id: 'bronze-archer',
    name: 'Бронзовый Лучник',
    subtitle: 'Стрелок с изогнутым луком и колчаном (~10×10 ядро)',
    kind: 'unit',
    tier: 'I',
    era: 'bronze-iron',
    entityType: 'unit',
    faction: 'Цитадель',
    width: 22,
    height: 20,
    frameCount: 8,
    defaultFps: 11,
    attackName: 'Залп из композитного лука',
    unitMeta: {
      coreSize: '10×10 человек',
      usesSkinMask: true,
      defaultPhenotype: 'skin_medium',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 8,
      supportsGenes: true,
    },
    layersSpec: ['1. Туника державы K1/K2, бронзовый пояс и SKIN_MASK', '2. Композитный лук и стрела с бронзовым наконечником'],
    description: 'Меткий лучник древних царств с композитным луком и колчаном стрел за спиной.',
    renderFrame: renderBronzeArcher,
    getAnchors: () => ({ head: { x: 9, y: 4, w: 4, h: 4 }, item: { x: 4, y: 7, w: 4, h: 6 }, pivot: { x: 11, y: 17 } }),
    codeSnippet: `function renderBronzeArcher(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(22, 20); }`,
  },
  {
    id: 'bronze-chariot',
    name: 'Боевая Колесница',
    subtitle: 'Двухколёсная упряжка с возничим (34×24)',
    kind: 'unit',
    tier: 'III',
    era: 'bronze-iron',
    entityType: 'unit',
    faction: 'Цитадель',
    width: 34,
    height: 24,
    frameCount: 8,
    defaultFps: 12,
    attackName: 'Таранный наезд колесницей',
    unitMeta: {
      coreSize: '28×18 колесница + воин 10×10',
      usesSkinMask: true,
      defaultPhenotype: 'skin_medium',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 16,
      supportsGenes: true,
    },
    layersSpec: ['1. Боевой конь в попоне державы K1/K2', '2. Бронзовая колесница со спицами и копейщик SKIN_MASK'],
    description: 'Ударная боевая колесница бронзового века: запряжённый конь с налобником, вращающиеся спицованные колёса и воин с копьём.',
    renderFrame: renderBronzeChariot,
    getAnchors: () => ({ head: { x: 22, y: 5, w: 4, h: 4 }, item: { x: 14, y: 7, w: 7, h: 4 }, pivot: { x: 17, y: 21 } }),
    codeSnippet: `function renderBronzeChariot(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(34, 24); }`,
  },
  {
    id: 'bronze-king',
    name: 'Царь Бронзового Века',
    subtitle: 'Правитель в солнечной диадеме с хопешем (~11×11 ядро)',
    kind: 'unit',
    tier: 'III',
    era: 'bronze-iron',
    entityType: 'unit',
    faction: 'Цитадель',
    width: 22,
    height: 20,
    frameCount: 8,
    defaultFps: 10,
    attackName: 'Размах царского хопеша',
    unitMeta: {
      coreSize: '11×11 человек',
      usesSkinMask: true,
      defaultPhenotype: 'skin_dark',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 9,
      supportsGenes: true,
    },
    layersSpec: ['1. Золотое ожерелье, плащ державы K1/K2 и SKIN_MASK', '2. Рогатая солнечная корона и изогнутый меч хопеш'],
    description: 'Владыка бронзовых городов-государств в золотой солнечной диадеме с серповидным клинком хопеш.',
    renderFrame: renderBronzeKing,
    getAnchors: () => ({ head: { x: 9, y: 3, w: 4, h: 5 }, item: { x: 3, y: 7, w: 5, h: 5 }, pivot: { x: 11, y: 17 } }),
    codeSnippet: `function renderBronzeKing(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(22, 20); }`,
  },
  {
    id: 'bronze-smith',
    name: 'Ремесленник-Кузнец',
    subtitle: 'Литейщик в фартуке с молотом (~10×10 ядро)',
    kind: 'unit',
    tier: 'II',
    era: 'bronze-iron',
    entityType: 'unit',
    faction: 'Кузня Пекла',
    width: 20,
    height: 18,
    frameCount: 8,
    defaultFps: 10,
    attackName: 'Удар бронзовым молотом с искрами',
    unitMeta: {
      coreSize: '10×10 человек',
      usesSkinMask: true,
      defaultPhenotype: 'skin_medium',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 8,
      supportsGenes: true,
    },
    layersSpec: ['1. Кожаный фартук K2, туника K1 и лицо SKIN_MASK', '2. Тяжёлый литейный молот с искрами'],
    description: 'Мастер плавки олова, меди и железа: носит плотный фартук ремесленника и бьёт массивным молотом.',
    renderFrame: renderBronzeSmith,
    getAnchors: () => ({ head: { x: 8, y: 4, w: 4, h: 4 }, item: { x: 3, y: 6, w: 5, h: 5 }, pivot: { x: 10, y: 15 } }),
    codeSnippet: `function renderBronzeSmith(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(20, 18); }`,
  },
  {
    id: 'bronze-merchant',
    name: 'Торговец Караванов',
    subtitle: 'Купец с амфорами и весами (~10×10 ядро)',
    kind: 'unit',
    tier: 'II',
    era: 'bronze-iron',
    entityType: 'unit',
    faction: 'Гильдия',
    width: 22,
    height: 20,
    frameCount: 8,
    defaultFps: 10,
    attackName: 'Взмах посохом с весами',
    unitMeta: {
      coreSize: '10×10 человек',
      usesSkinMask: true,
      defaultPhenotype: 'skin_dark',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 8,
      supportsGenes: true,
    },
    layersSpec: ['1. Богатая туника K1, тюрбан K2 и лицо SKIN_MASK', '2. Заплечная бронзовая амфора и весы торговли'],
    description: 'Странствующий караванный торговец древнего мира с расписанной амфорой за спиной и бронзовыми весами.',
    renderFrame: renderBronzeMerchant,
    getAnchors: () => ({ head: { x: 9, y: 3, w: 4, h: 4 }, item: { x: 5, y: 6, w: 5, h: 8 }, pivot: { x: 11, y: 17 } }),
    codeSnippet: `function renderBronzeMerchant(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(22, 20); }`,
  },
];
