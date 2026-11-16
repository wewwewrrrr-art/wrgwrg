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
 * Stone Age Humans (~10×10 px core body with 3–4px head inside 20×18 / 22×20 frame).
 * Borderless style: fur tunics on K1/K2 masks, faces/arms on SKIN_MASK, flint/bone tools.
 */

// 1. Stone Age Hunter (20×18, Tier I) — Furs + Flint Spear
function renderStoneHunter(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';

  const buf = new PixelBuffer(20, 18);
  const cx = 10;
  const footY = 15;
  const bodyY = 10 + bounceY + (mode === 'swim' ? 2 : 0);

  // Legs (hidden in swim)
  if (mode !== 'swim') {
    const l1 = Math.round(cx - 1 + legSwing * 0.8);
    const l2 = Math.round(cx + 1 - legSwing * 0.8);
    buf.drawLine(cx - 1, bodyY + 2, l1, footY, RAMPS.timber.shadow, 1);
    buf.drawLine(cx + 1, bodyY + 2, l2, footY, RAMPS.timber.deep, 1);
  }

  // Shaggy fur tunic (K1 primary + K2 hide belt) ~6x5 px core
  buf.layer((sub) => {
    sub.fillEllipse(cx, bodyY, 2.8, 2.5, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.drawLine(cx - 2, bodyY + 1, cx + 2, bodyY + 1, RAMPS.cyanMask.mid, 1);
    if (appLevel >= 1) {
      sub.setPixel(cx - 1, bodyY - 1, RAMPS.bone.highlight); // bone tooth necklace
    }
  });

  // Compact 4×4 Head on SKIN_MASK + shaggy cave-hair
  buf.layer((sub) => {
    const hy = bodyY - 4;
    sub.fillRect(cx - 2, hy - 1, 4, 3, SKIN_MASK[0]);
    sub.fillRect(cx, hy, 2, 2, SKIN_MASK[1]);
    sub.fillRect(cx - 2, hy - 2, 4, 1, RAMPS.timber.shadow); // wild hair
    sub.setPixel(cx + 1, hy - 1, RAMPS.timber.deep);
    sub.setPixel(cx - 1, hy, '#261812'); // eye dot facing left
    if (appLevel === 2) {
      sub.setPixel(cx + 1, hy - 3, RAMPS.cyanMask.highlight); // hunter feather
    }
  });

  // Flint-tipped wooden spear (thrusts forward in attack)
  const thrust = isAtk ? (phase < 0.35 ? 2 : phase < 0.7 ? -4 : 0) : 0;
  const sx0 = cx + 2 + thrust;
  const sx1 = cx - 6 + thrust;
  const sy = bodyY - 1;
  buf.drawLine(sx0, sy, sx1, sy - 2, RAMPS.timber.mid, 1);
  buf.setPixel(sx1 - 1, sy - 2, RAMPS.marble.highlight); // sharp flint tip
  buf.setPixel(sx1, sy - 3, RAMPS.slate.mid);
  if (isAtk && phase >= 0.35 && phase < 0.72) {
    buf.setPixel(sx1 - 2, sy - 2, '#FFFFFF');
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 11, 3, 16, frame);
  return finalizeEraCreatureAction(buf, frame, total, 10, 14, action);
}

// 2. Stone Age Chieftain (22×20, Tier II) — Pelt Cloak + Heavy Club
function renderStoneChieftain(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';

  const buf = new PixelBuffer(22, 20);
  const cx = 11;
  const bodyY = 11 + bounceY + (mode === 'swim' ? 2 : 0);

  if (mode !== 'swim') {
    const l1 = Math.round(cx - 2 + legSwing * 0.8);
    const l2 = Math.round(cx + 1 - legSwing * 0.8);
    buf.drawLine(cx - 1, bodyY + 2, l1, 17, RAMPS.timber.shadow, 1);
    buf.drawLine(cx + 1, bodyY + 2, l2, 17, RAMPS.timber.deep, 1);
  }

  // Broad pelt cloak + shoulder fur mantle (K1/K2)
  buf.layer((sub) => {
    sub.fillEllipse(cx + 1, bodyY, 3.4, 3.0, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.fillEllipse(cx, bodyY - 2, 3.8, 1.4, RAMPS.cyanMask.mid);
    if (appLevel >= 1) {
      sub.setPixel(cx + 3, bodyY - 3, RAMPS.bone.highlight); // shoulder horn trophy
    }
  });

  // Compact 4×4 Head + bone crown
  buf.layer((sub) => {
    const hy = bodyY - 5;
    sub.fillRect(cx - 2, hy - 1, 4, 3, SKIN_MASK[0]);
    sub.setPixel(cx - 1, hy, '#261812');
    sub.fillRect(cx - 2, hy - 2, 4, 1, RAMPS.timber.deep);
    if (appLevel === 2) {
      sub.setPixel(cx - 2, hy - 3, RAMPS.bone.highlight);
      sub.setPixel(cx + 1, hy - 3, RAMPS.bone.highlight);
    }
  });

  // Heavy studded war club (swings overhead -> down in attack)
  const swing = isAtk ? (phase < 0.35 ? -4 : phase < 0.7 ? 2 : 0) : 0;
  const cxClub = cx - 4;
  const cyClub = bodyY - 2 + swing;
  buf.drawLine(cx - 2, bodyY, cxClub - 1, cyClub - 3, RAMPS.timber.mid, 1);
  buf.fillEllipse(cxClub - 2, cyClub - 4, 1.8, 1.8, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.timber));
  buf.setPixel(cxClub - 3, cyClub - 4, RAMPS.marble.highlight); // flint stud
  if (isAtk && phase >= 0.38 && phase < 0.72) {
    buf.drawLine(cxClub - 4, cyClub - 2, cxClub - 5, cyClub + 2, '#FFFFFF', 1);
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 12, 3, 18, frame);
  return finalizeEraCreatureAction(buf, frame, total, 11, 16, action);
}

// 3. Stone Age Shaman (22×20, Tier II) — Antler Mask + Spirit Totem Staff
function renderStoneShaman(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';

  const buf = new PixelBuffer(22, 20);
  const cx = 11;
  const bodyY = 11 + bounceY + (mode === 'swim' ? 2 : 0);

  if (mode !== 'swim') {
    const l1 = Math.round(cx - 1 + legSwing * 0.8);
    const l2 = Math.round(cx + 1 - legSwing * 0.8);
    buf.drawLine(cx - 1, bodyY + 2, l1, 17, RAMPS.timber.deep, 1);
    buf.drawLine(cx + 1, bodyY + 2, l2, 17, RAMPS.timber.deep, 1);
  }

  // Ceremonial hide robes K1/K2
  buf.layer((sub) => {
    sub.fillEllipse(cx, bodyY, 3.0, 3.0, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.drawLine(cx - 2, bodyY, cx + 2, bodyY, RAMPS.cyanMask.highlight, 1);
  });

  // Head + Skull Mask & Antlers (genes)
  buf.layer((sub) => {
    const hy = bodyY - 5;
    sub.fillRect(cx - 2, hy - 1, 4, 3, SKIN_MASK[0]);
    sub.fillRect(cx - 2, hy - 2, 4, 2, RAMPS.bone.highlight); // bone skull mask
    sub.setPixel(cx - 1, hy - 1, '#38BDF8'); // glowing spirit eye
    if (appLevel >= 1) {
      sub.drawLine(cx - 2, hy - 2, cx - 4, hy - 4 - (appLevel === 2 ? 1 : 0), RAMPS.bone.mid, 1);
      sub.drawLine(cx + 1, hy - 2, cx + 3, hy - 4 - (appLevel === 2 ? 1 : 0), RAMPS.bone.mid, 1);
    }
  });

  // Totem staff & spirit cast orb
  const liftY = isAtk ? -2 : 0;
  const staffX = cx - 4;
  buf.drawLine(staffX, bodyY + 3 + liftY, staffX, bodyY - 5 + liftY, RAMPS.timber.mid, 1);
  buf.setPixel(staffX, bodyY - 6 + liftY, RAMPS.cyanMask.highlight);
  if (isAtk && phase >= 0.3) {
    const orbX = Math.max(2, staffX - Math.round(phase * 5));
    const orbY = bodyY - 5 + Math.round(Math.sin(phase * 8) * 1.2);
    buf.fillEllipse(orbX, orbY, 1.3, 1.3, '#67E8F9');
    buf.setPixel(orbX, orbY, '#FFFFFF');
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 12, 3, 18, frame);
  return finalizeEraCreatureAction(buf, frame, total, 11, 16, action);
}

// 4. Stone Age Gatherer (20×18, Tier I) — Woven Berry Basket + Foraging Stick
function renderStoneGatherer(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
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

  // Woven hide tunic K1/K2 + shoulder strap
  buf.layer((sub) => {
    sub.fillEllipse(cx, bodyY, 2.7, 2.6, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.drawLine(cx - 2, bodyY - 1, cx + 1, bodyY + 2, RAMPS.cyanMask.highlight, 1);
  });

  // Back berry basket filled with berries/herbs
  buf.layer((sub) => {
    const bx = cx + 3;
    const by = bodyY - 1;
    sub.fillRect(bx, by, 3, 4, RAMPS.timber.mid);
    sub.fillRect(bx + 1, by + 1, 2, 3, RAMPS.timber.shadow);
    sub.setPixel(bx, by - 1, '#F43F5E'); // berries
    sub.setPixel(bx + 2, by - 1, '#73F2A6'); // herbs
    if (appLevel >= 1) sub.setPixel(bx + 1, by - 1, RAMPS.bone.highlight);
  });

  // 4×4 Head on SKIN_MASK + braided hair bun
  buf.layer((sub) => {
    const hy = bodyY - 4;
    sub.fillRect(cx - 2, hy - 1, 4, 3, SKIN_MASK[0]);
    sub.fillRect(cx, hy, 2, 2, SKIN_MASK[1]);
    sub.fillRect(cx - 2, hy - 2, 4, 1, RAMPS.timber.mid);
    sub.fillRect(cx + 2, hy - 1, 2, 2, RAMPS.timber.shadow); // braid bun
    sub.setPixel(cx - 1, hy, '#261812');
    if (appLevel === 2) sub.setPixel(cx, hy - 2, '#F43F5E'); // berry blossom
  });

  // Digging stick (jabs forward on attack)
  const jab = isAtk ? (phase < 0.4 ? -2 : 1) : 0;
  buf.drawLine(cx - 2, bodyY + 1, cx - 5 + jab, bodyY + 3 - jab, RAMPS.timber.highlight, 1);
  if (isAtk && phase >= 0.3 && phase < 0.72) {
    buf.setPixel(cx - 6 + jab, bodyY + 2, '#FFFFFF');
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 11, 3, 16, frame);
  return finalizeEraCreatureAction(buf, frame, total, 10, 14, action);
}

// 5. Stone Age Child (18×16, Tier I) — Small Compact Kid with Toy Sling-Stick
function renderStoneChild(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';

  const buf = new PixelBuffer(18, 16);
  const cx = 9;
  const bodyY = 10 + bounceY + (mode === 'swim' ? 2 : 0);

  if (mode !== 'swim') {
    const l1 = Math.round(cx - 1 + legSwing * 0.9);
    const l2 = Math.round(cx + 1 - legSwing * 0.9);
    buf.drawLine(cx - 1, bodyY + 1, l1, 14, RAMPS.timber.shadow, 1);
    buf.drawLine(cx + 1, bodyY + 1, l2, 14, RAMPS.timber.deep, 1);
  }

  // Smaller 5×4 fur tunic (K1/K2)
  buf.layer((sub) => {
    sub.fillEllipse(cx, bodyY, 2.2, 2.0, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.drawLine(cx - 1, bodyY + 1, cx + 1, bodyY + 1, RAMPS.cyanMask.mid, 1);
  });

  // Proportionally larger child 3×3 / 4×3 head
  buf.layer((sub) => {
    const hy = bodyY - 3;
    sub.fillRect(cx - 2, hy - 1, 4, 3, SKIN_MASK[0]);
    sub.fillRect(cx, hy, 2, 1, SKIN_MASK[1]);
    sub.fillRect(cx - 2, hy - 2, 4, 1, RAMPS.timber.highlight);
    sub.setPixel(cx - 1, hy, '#261812');
    if (appLevel === 2) sub.setPixel(cx + 1, hy - 3, RAMPS.cyanMask.highlight);
  });

  // Playful stick / thrown pebble
  const armLift = isAtk ? (phase < 0.4 ? -2 : 0) : Math.round(Math.sin(phase * Math.PI * 2));
  buf.drawLine(cx - 2, bodyY, cx - 4, bodyY - 2 + armLift, RAMPS.timber.mid, 1);
  if (isAtk && phase >= 0.45) {
    const px = Math.max(2, Math.round(cx - 4 - (phase - 0.45) * 8));
    buf.setPixel(px, bodyY - 2, RAMPS.slate.highlight);
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 10, 3, 14, frame);
  return finalizeEraCreatureAction(buf, frame, total, 9, 13, action);
}

// 6. Stone Age Slinger (20×18, Tier I) — Leather Headband + Whirling Stone Sling
function renderStoneSlinger(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';

  const buf = new PixelBuffer(20, 18);
  const cx = 10;
  const bodyY = 10 + bounceY + (mode === 'swim' ? 2 : 0);

  if (mode !== 'swim') {
    const l1 = Math.round(cx - 1 + legSwing * 0.8);
    const l2 = Math.round(cx + 1 - legSwing * 0.8);
    buf.drawLine(cx - 1, bodyY + 2, l1, 15, RAMPS.timber.shadow, 1);
    buf.drawLine(cx + 1, bodyY + 2, l2, 15, RAMPS.timber.deep, 1);
  }

  // Hide vest K1/K2 + stone pouch at waist
  buf.layer((sub) => {
    sub.fillEllipse(cx, bodyY, 2.7, 2.5, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.fillRect(cx + 1, bodyY + 1, 2, 2, RAMPS.timber.mid);
    sub.drawLine(cx - 2, bodyY, cx + 1, bodyY, RAMPS.cyanMask.mid, 1);
  });

  // 4×4 Head + K2 headband
  buf.layer((sub) => {
    const hy = bodyY - 4;
    sub.fillRect(cx - 2, hy - 1, 4, 3, SKIN_MASK[0]);
    sub.fillRect(cx, hy, 2, 2, SKIN_MASK[1]);
    sub.fillRect(cx - 2, hy - 2, 4, 1, RAMPS.cyanMask.highlight);
    sub.setPixel(cx - 1, hy, '#261812');
    if (appLevel >= 1) sub.setPixel(cx + 2, hy - 2, RAMPS.cyanMask.mid);
  });

  // Whirling leather sling + flying stone projectile in attack
  const ang = phase * Math.PI * 2 * (isAtk ? 2 : 1);
  const sx = Math.round(cx - 3 + Math.cos(ang) * 2.5);
  const sy = Math.round(bodyY - 3 + Math.sin(ang) * 2.5);
  buf.drawLine(cx - 2, bodyY - 1, sx, sy, RAMPS.timber.highlight, 1);
  buf.setPixel(sx, sy, RAMPS.slate.highlight);
  if (isAtk && phase >= 0.45) {
    const projX = Math.max(2, Math.round(cx - 5 - (phase - 0.45) * 9));
    buf.fillRect(projX, bodyY - 3, 2, 2, RAMPS.marble.highlight);
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 11, 3, 16, frame);
  return finalizeEraCreatureAction(buf, frame, total, 10, 14, action);
}

// 7. Stone Age Tamed Wolf (26×18, Tier I) — Tribal Painted Companion Wolf
function renderStoneTamedWolf(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const lunge = isAtk ? (phase < 0.35 ? 2 : phase < 0.72 ? -3 : 0) : 0;

  const buf = new PixelBuffer(26, 18);
  const cx = 14 + lunge;
  const cy = 11 + bounceY + (mode === 'swim' ? 2 : 0);

  // Wagging bushy tail
  const tailY = cy - 2 + Math.round(Math.sin(phase * Math.PI * 2) * 1.2);
  drawShadedLimb(buf, cx + 4, cy - 1, cx + 8, tailY, 1.3, RAMPS.slate);

  // Far legs
  if (mode !== 'swim') {
    drawShadedLimb(buf, cx - 3, cy + 2, cx - 4 - legSwing, 15, 1.0, RAMPS.slate);
    drawShadedLimb(buf, cx + 3, cy + 2, cx + 4 + legSwing, 15, 1.0, RAMPS.slate);
  }

  // Wolf body + tribal K1/K2 collar & war-paint stripe
  buf.layer((sub) => {
    sub.fillEllipse(cx, cy, 5.2, 3.0, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.slate));
    sub.drawLine(cx - 2, cy - 2, cx + 2, cy - 1, RAMPS.cyanMask.highlight, 1); // tribal paint
    sub.drawLine(cx - 4, cy - 2, cx - 3, cy + 1, RAMPS.magenta.mid, 1); // K1 collar
    if (appLevel === 2) sub.setPixel(cx - 4, cy - 3, RAMPS.bone.highlight); // fang collar charm
  });

  // Near legs
  if (mode !== 'swim') {
    drawShadedLimb(buf, cx - 3, cy + 1, cx - 4 + legSwing, 15, 1.1, RAMPS.slate);
    drawShadedLimb(buf, cx + 3, cy + 1, cx + 3 - legSwing, 15, 1.1, RAMPS.slate);
  }

  // Wolf head, pointed ears & snapping jaw
  buf.layer((sub) => {
    const hx = cx - 6;
    const hy = cy - 2;
    sub.fillEllipse(hx, hy, 2.8, 2.3, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.slate));
    sub.fillRect(hx - 4, hy, 3, 2, RAMPS.slate.mid); // muzzle
    sub.setPixel(hx - 1, hy - 3, RAMPS.slate.shadow); // ear 1
    sub.setPixel(hx + 1, hy - 3, RAMPS.slate.deep); // ear 2
    sub.setPixel(hx - 2, hy - 1, '#FBBF24'); // amber eye
    if (isAtk && phase >= 0.3 && phase < 0.72) {
      sub.setPixel(hx - 4, hy + 2, '#FFFFFF'); // snapping fangs
      sub.setPixel(hx - 5, hy + 1, '#FFFFFF');
    }
  });

  if (mode === 'swim') clipToSwimUpperBody(buf, 11, 3, 23, frame);
  return finalizeEraCreatureAction(buf, frame, total, 13, 15, action);
}

export const ERA_STONE_AGE_MODELS: PixelModelDef[] = [
  {
    id: 'stone-hunter',
    name: 'Охотник Каменного Века',
    subtitle: 'Юнит в шкурах с копьём (~10×10 ядро)',
    kind: 'unit',
    tier: 'I',
    era: 'stone-age',
    faction: 'Орда',
    width: 20,
    height: 18,
    frameCount: 8,
    defaultFps: 10,
    attackName: 'Выпад кремнёвого копья',
    unitMeta: {
      coreSize: '10×10 человек',
      usesSkinMask: true,
      defaultPhenotype: 'skin_medium',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 8,
      supportsGenes: true,
    },
    layersSpec: ['1. Шкура охотника K1/K2 и лицо SKIN_MASK (3–4 px)', '2. Кремнёвое копьё и перья по генам'],
    description: 'Первобытный охотник в шкурах (масштаб ~10×10 px, голова 3–4 px): подпрыгивает при ходьбе на 1 px, бьёт кремнёвым копьём.',
    renderFrame: renderStoneHunter,
    getAnchors: () => ({ head: { x: 8, y: 4, w: 4, h: 4 }, item: { x: 3, y: 7, w: 6, h: 4 }, pivot: { x: 10, y: 15 } }),
    codeSnippet: `function renderStoneHunter(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(20, 18); }`,
  },
  {
    id: 'stone-chieftain',
    name: 'Вождь Племени',
    subtitle: 'Боец в накидке с тяжёлой дубиной (~11×11 ядро)',
    kind: 'unit',
    tier: 'II',
    era: 'stone-age',
    faction: 'Орда',
    width: 22,
    height: 20,
    frameCount: 8,
    defaultFps: 10,
    attackName: 'Удар кремнёвой дубиной',
    unitMeta: {
      coreSize: '11×11 человек',
      usesSkinMask: true,
      defaultPhenotype: 'skin_dark',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 9,
      supportsGenes: true,
    },
    layersSpec: ['1. Меховой плащ державы K1/K2 и корона из кости', '2. Тяжёлая шипастая дубина'],
    description: 'Могучий племенной вождь в звериной шкуре державы, с трофеями на плечах и кремнёвой дубиной.',
    renderFrame: renderStoneChieftain,
    getAnchors: () => ({ head: { x: 9, y: 4, w: 4, h: 4 }, item: { x: 4, y: 5, w: 5, h: 6 }, pivot: { x: 11, y: 17 } }),
    codeSnippet: `function renderStoneChieftain(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(22, 20); }`,
  },
  {
    id: 'stone-shaman',
    name: 'Шаман Предков',
    subtitle: 'Мистик в рогатой маске с тотемом (~11×11 ядро)',
    kind: 'unit',
    tier: 'II',
    era: 'stone-age',
    faction: 'Лесной Круг',
    width: 22,
    height: 20,
    frameCount: 8,
    defaultFps: 10,
    attackName: 'Заклятие тотемных духов',
    unitMeta: {
      coreSize: '11×11 человек',
      usesSkinMask: true,
      defaultPhenotype: 'skin_light',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 9,
      supportsGenes: true,
    },
    layersSpec: ['1. Одеяние K1/K2 и рогатая костяная маска', '2. Тотемный посох духов'],
    description: 'Древний шаман в обрядовых шкурах и рогатой черепной маске: призывает искры духов с вершины посоха.',
    renderFrame: renderStoneShaman,
    getAnchors: () => ({ head: { x: 9, y: 4, w: 4, h: 4 }, item: { x: 5, y: 5, w: 4, h: 8 }, pivot: { x: 11, y: 17 } }),
    codeSnippet: `function renderStoneShaman(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(22, 20); }`,
  },
  {
    id: 'stone-gatherer',
    name: 'Собирательница Племени',
    subtitle: 'Юнит с корзиной ягод и палкой-копалкой (~10×10 ядро)',
    kind: 'unit',
    tier: 'I',
    era: 'stone-age',
    entityType: 'unit',
    faction: 'Лесной Круг',
    width: 20,
    height: 18,
    frameCount: 8,
    defaultFps: 10,
    attackName: 'Удар палкой-копалкой',
    unitMeta: {
      coreSize: '10×10 человек',
      usesSkinMask: true,
      defaultPhenotype: 'skin_medium',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 8,
      supportsGenes: true,
    },
    layersSpec: ['1. Туника державы K1/K2, коса и кожа SKIN_MASK', '2. Плетёная корзина с ягодами и травами'],
    description: 'Племенная собирательница в одежде из шкур K1/K2 с плетёной корзиной даров леса за спиной.',
    renderFrame: renderStoneGatherer,
    getAnchors: () => ({ head: { x: 8, y: 4, w: 4, h: 4 }, item: { x: 12, y: 8, w: 4, h: 5 }, pivot: { x: 10, y: 15 } }),
    codeSnippet: `function renderStoneGatherer(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(20, 18); }`,
  },
  {
    id: 'stone-child',
    name: 'Ребёнок Племени',
    subtitle: 'Малый житель в шкурах с палкой (~8×8 ядро)',
    kind: 'unit',
    tier: 'I',
    era: 'stone-age',
    entityType: 'unit',
    faction: 'Лесной Круг',
    width: 18,
    height: 16,
    frameCount: 8,
    defaultFps: 11,
    attackName: 'Бросок камешка',
    unitMeta: {
      coreSize: '8×8 человек',
      usesSkinMask: true,
      defaultPhenotype: 'skin_light',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 6,
      supportsGenes: true,
    },
    layersSpec: ['1. Короткая накидка из меха K1/K2 и SKIN_MASK', '2. Игрушечный прутик и бросок камешка'],
    description: 'Небольшой первобытный ребёнок: пропорционально компактный силуэт с весёлой походкой и броском камешка.',
    renderFrame: renderStoneChild,
    getAnchors: () => ({ head: { x: 7, y: 5, w: 4, h: 3 }, item: { x: 4, y: 7, w: 4, h: 4 }, pivot: { x: 9, y: 14 } }),
    codeSnippet: `function renderStoneChild(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(18, 16); }`,
  },
  {
    id: 'stone-slinger',
    name: 'Метатель Камней',
    subtitle: 'Дальний боец с кожаной пращой (~10×10 ядро)',
    kind: 'unit',
    tier: 'I',
    era: 'stone-age',
    entityType: 'unit',
    faction: 'Орда',
    width: 20,
    height: 18,
    frameCount: 8,
    defaultFps: 11,
    attackName: 'Выстрел из каменной пращи',
    unitMeta: {
      coreSize: '10×10 человек',
      usesSkinMask: true,
      defaultPhenotype: 'skin_dark',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 8,
      supportsGenes: true,
    },
    layersSpec: ['1. Набедренная повязка K1/K2, повязка на лбу и SKIN_MASK', '2. Вращающаяся кожаная праща с камнем'],
    description: 'Первобытный пращник: раскручивает кожаную пращу над головой и запускает острые речные камни.',
    renderFrame: renderStoneSlinger,
    getAnchors: () => ({ head: { x: 8, y: 4, w: 4, h: 4 }, item: { x: 3, y: 5, w: 5, h: 5 }, pivot: { x: 10, y: 15 } }),
    codeSnippet: `function renderStoneSlinger(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(20, 18); }`,
  },
  {
    id: 'stone-tamed-wolf',
    name: 'Приручённый Волк Племени',
    subtitle: 'Верный пёс охотников в раскрасе (26×18)',
    kind: 'unit',
    tier: 'I',
    era: 'stone-age',
    entityType: 'creature',
    faction: 'Орда',
    width: 26,
    height: 18,
    frameCount: 8,
    defaultFps: 12,
    attackName: 'Бросок и хват клыками',
    unitMeta: {
      coreSize: '18×12 зверь',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 11,
      supportsGenes: true,
    },
    layersSpec: ['1. Поджарое тело серого волка без контура', '2. Ошейник державы K1 и племенной раскрас K2'],
    description: 'Первый приручённый волк каменного века: помогает охотникам на стоянке, носит племенной ошейник державы K1/K2.',
    renderFrame: renderStoneTamedWolf,
    getAnchors: () => ({ head: { x: 4, y: 6, w: 6, h: 5 }, item: { x: 2, y: 8, w: 4, h: 4 }, pivot: { x: 13, y: 15 } }),
    codeSnippet: `function renderStoneTamedWolf(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(26, 18); }`,
  },
];
