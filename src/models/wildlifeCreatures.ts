import { MaterialRamp, RAMPS } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import { PixelModelDef, RenderContextOptions } from './types';
import {
  clipToSwimUpperBody,
  drawCurvedHorn,
  drawShadedLimb,
  finalizeEraCreatureAction,
  getEraModeAction,
  getWalkCycle,
  pickTopLeftTone,
} from './eraCreatureHelpers';

/**
 * Modern Wild Fauna ("Дикая природа" — real-world animals, zero fantasy/mythic).
 * Borderless 4-tone top-left shading, K1/K2 faction collars/ribbons, CreatureGenes.
 */

const BOAR_HIDE: MaterialRamp = {
  id: 'boar-hide',
  name: 'Щетина вепря',
  role: 'Дикий кабан',
  highlight: '#7A5442',
  mid: '#5B3D30',
  shadow: '#402920',
  deep: '#291913',
};

const DEER_COAT: MaterialRamp = {
  id: 'deer-coat',
  name: 'Шкура оленя',
  role: 'Благородный олень',
  highlight: '#C98C56',
  mid: '#A56A3B',
  shadow: '#7D4B28',
  deep: '#573219',
};

const BEAR_FUR: MaterialRamp = {
  id: 'bear-fur',
  name: 'Шерсть медведя',
  role: 'Бурый медведь',
  highlight: '#82573C',
  mid: '#613E29',
  shadow: '#452A1B',
  deep: '#2C1910',
};

// 1. Wild Boar (28×20, Tier I) — Sculpted Bristled Ridge, Trotting Hooved Legs + Upturned Tusks
function renderWildBoar(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const lunge = isAtk ? (phase < 0.35 ? 2 : phase < 0.72 ? -3 : 0) : 0;

  const buf = new PixelBuffer(28, 20);
  const cx = 15 + lunge;
  const cy = 11 + bounceY + (mode === 'swim' ? 2 : 0);

  // Curled tufted tail
  buf.drawLine(cx + 6, cy - 1, cx + 8, cy - 3, BOAR_HIDE.shadow, 1);
  buf.setPixel(cx + 8, cy - 1, BOAR_HIDE.deep);

  if (mode !== 'swim') {
    const fl = -legSwing * 0.9;
    const hl = legSwing * 0.9;
    drawShadedLimb(buf, cx - 3, cy + 2, cx - 4 + fl, cy + 4, 1.2, BOAR_HIDE);
    drawShadedLimb(buf, cx - 4 + fl, cy + 4, cx - 5 + fl, 17, 0.9, BOAR_HIDE);
    buf.setPixel(Math.round(cx - 5 + fl), 17, '#3E3631');
    drawShadedLimb(buf, cx + 4, cy + 2, cx + 5 + hl, cy + 4, 1.2, BOAR_HIDE);
    drawShadedLimb(buf, cx + 5 + hl, cy + 4, cx + 4 + hl, 17, 0.9, BOAR_HIDE);
    buf.setPixel(Math.round(cx + 4 + hl), 17, '#3E3631');
  }

  // Barrel-chested boar torso, muscular shoulder crest, bristled mane & K1/K2 harness
  buf.layer((sub) => {
    sub.fillEllipse(cx + 1, cy + 1, 5.4, 3.6, (nx, ny) => pickTopLeftTone(nx, ny, BOAR_HIDE));
    sub.fillEllipse(cx - 2, cy, 4.4, 3.9, (nx, ny) => pickTopLeftTone(nx, ny, BOAR_HIDE));
    // Bristled dorsal crest tufts along spine
    for (let x = cx - 5; x <= cx + 4; x += 2) {
      sub.setPixel(x, cy - 4, BOAR_HIDE.highlight);
      sub.setPixel(x + 1, cy - 3, BOAR_HIDE.shadow);
    }
    // Contoured leather + K1/K2 war blanket behind shoulder
    sub.fillRect(cx - 1, cy - 3, 4, 3, RAMPS.magenta.mid);
    sub.fillRect(cx - 1, cy - 3, 2, 1, RAMPS.magenta.highlight);
    sub.setPixel(cx + 1, cy - 1, RAMPS.cyanMask.highlight);
    sub.setPixel(cx + 2, cy - 1, RAMPS.cyanMask.mid);
  });

  if (mode !== 'swim') {
    buf.layer((sub) => {
      const fl = legSwing;
      const hl = -legSwing;
      drawShadedLimb(sub, cx - 3, cy + 2, cx - 3 + fl * 0.6, cy + 4, 1.3, BOAR_HIDE);
      drawShadedLimb(sub, cx - 3 + fl * 0.6, cy + 4, cx - 4 + fl, 17, 1.0, BOAR_HIDE);
      sub.setPixel(Math.round(cx - 4 + fl), 17, '#4B413B');
      drawShadedLimb(sub, cx + 4, cy + 2, cx + 4 + hl * 0.6, cy + 4, 1.3, BOAR_HIDE);
      drawShadedLimb(sub, cx + 4 + hl * 0.6, cy + 4, cx + 3 + hl, 17, 1.0, BOAR_HIDE);
      sub.setPixel(Math.round(cx + 3 + hl), 17, '#4B413B');
    });
  }

  // Sculpted angular boar head, ear, flat pink snout, sharp eye & upturned ivory tusks
  buf.layer((sub) => {
    const hx = cx - 6;
    const hy = cy;
    sub.fillEllipse(hx, hy, 3.4, 2.8, (nx, ny) => pickTopLeftTone(nx, ny, BOAR_HIDE));
    sub.setPixel(hx + 1, hy - 3, BOAR_HIDE.mid); // upright ear
    sub.setPixel(hx + 2, hy - 3, BOAR_HIDE.deep);
    sub.fillRect(hx - 4, hy, 2, 2, '#D0837B'); // beveled pig snout disc
    sub.setPixel(hx - 4, hy, '#E5A199');
    sub.setPixel(hx - 2, hy - 1, '#583A2E');
    sub.setPixel(hx - 1, hy - 1, '#D9A040');
    if (appLevel >= 1) {
      drawCurvedHorn(sub, hx - 3, hy + 1, hx - 5, hy - 2 - (appLevel === 2 ? 1 : 0), hx - 5, hy + 1, 0.7, RAMPS.bone);
    }
  });

  if (isAtk && phase >= 0.36 && phase < 0.72) {
    buf.drawLine(cx - 11, cy - 2, cx - 12, cy + 1, '#FFFFFF', 1);
  }
  if (mode === 'swim') clipToSwimUpperBody(buf, 12, 3, 25, frame);
  return finalizeEraCreatureAction(buf, frame, total, 14, 17, action);
}

// 2. Forest Stag (32×28, Tier II) — Slender Buck, Jointed Legs, White Scut + Multi-Tine Antlers
function renderForestStag(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const lunge = isAtk ? (phase < 0.35 ? 2 : phase < 0.7 ? -3 : 0) : 0;

  const buf = new PixelBuffer(32, 28);
  const cx = 17 + lunge;
  const cy = 16 + bounceY + (mode === 'swim' ? 3 : 0);

  // White scut tail + dark rump edge
  buf.fillRect(cx + 6, cy - 2, 2, 2, RAMPS.bone.highlight);
  buf.setPixel(cx + 6, cy, DEER_COAT.deep);

  if (mode !== 'swim') {
    const fl = -legSwing * 1.1;
    const hl = legSwing * 1.1;
    drawShadedLimb(buf, cx - 4, cy + 2, cx - 5 + fl * 0.6, cy + 5, 1.1, DEER_COAT);
    drawShadedLimb(buf, cx - 5 + fl * 0.6, cy + 5, cx - 5 + fl, 25, 0.85, DEER_COAT);
    buf.setPixel(Math.round(cx - 5 + fl), 25, '#3E3631');

    drawShadedLimb(buf, cx + 4, cy + 2, cx + 6 + hl * 0.5, cy + 5, 1.2, DEER_COAT);
    drawShadedLimb(buf, cx + 6 + hl * 0.5, cy + 5, cx + 5 + hl, 25, 0.85, DEER_COAT);
    buf.setPixel(Math.round(cx + 5 + hl), 25, '#3E3631');
  }

  // Slender sculpted stag ribcage, pale underbelly & contoured K1/K2 woodland caparison
  buf.layer((sub) => {
    sub.fillEllipse(cx, cy, 6.4, 3.5, (nx, ny) => {
      if (ny > 0.52 && nx > -0.4 && nx < 0.5) return RAMPS.birch.highlight;
      return pickTopLeftTone(nx, ny, DEER_COAT);
    });
    sub.fillEllipse(cx - 3, cy, 3.6, 3.7, (nx, ny) => pickTopLeftTone(nx, ny, DEER_COAT));
    sub.fillEllipse(cx + 1, cy - 1, 3.2, 2.2, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.drawLine(cx - 1, cy, cx + 3, cy, RAMPS.cyanMask.highlight, 1);
  });

  if (mode !== 'swim') {
    buf.layer((sub) => {
      const fl = legSwing * 1.1;
      const hl = -legSwing * 1.1;
      drawShadedLimb(sub, cx - 4, cy + 2, cx - 4 + fl * 0.6, cy + 5, 1.1, DEER_COAT);
      drawShadedLimb(sub, cx - 4 + fl * 0.6, cy + 5, cx - 4 + fl, 25, 0.85, DEER_COAT);
      sub.setPixel(Math.round(cx - 4 + fl), 25, '#4A403A');

      drawShadedLimb(sub, cx + 4, cy + 2, cx + 5 + hl * 0.5, cy + 5, 1.2, DEER_COAT);
      drawShadedLimb(sub, cx + 5 + hl * 0.5, cy + 5, cx + 4 + hl, 25, 0.85, DEER_COAT);
      sub.setPixel(Math.round(cx + 4 + hl), 25, '#4A403A');
    });
  }

  // Graceful arched neck, alert ears, tapered muzzle & multi-tine antlers
  buf.layer((sub) => {
    const headDrop = isAtk && phase >= 0.32 && phase < 0.72 ? 3 : 0;
    drawShadedLimb(sub, cx - 4, cy - 1, cx - 7, cy - 7 + headDrop, 1.7, DEER_COAT);
    sub.drawLine(cx - 6, cy - 4 + headDrop, cx - 4, cy - 4 + headDrop, RAMPS.magenta.highlight, 1);
    const hx = cx - 8;
    const hy = cy - 7 + headDrop;
    sub.fillEllipse(hx, hy, 2.9, 2.0, (nx, ny) => pickTopLeftTone(nx, ny, DEER_COAT));
    sub.setPixel(hx - 3, hy, DEER_COAT.deep); // nose tip
    sub.setPixel(hx - 1, hy - 1, '#583A2E');
    sub.setPixel(hx + 2, hy - 2, DEER_COAT.highlight); // alert ear
    sub.setPixel(hx + 3, hy - 3, DEER_COAT.shadow);
    if (appLevel >= 1) {
      drawCurvedHorn(sub, hx + 1, hy - 2, hx - 3, hy - 8, hx - 2, hy - 4, 0.85, RAMPS.bone);
      drawCurvedHorn(sub, hx + 1, hy - 2, hx + 5, hy - 8, hx + 3, hy - 5, 0.85, RAMPS.bone);
      if (appLevel === 2) {
        sub.drawLine(hx - 1, hy - 5, hx - 4, hy - 6, RAMPS.bone.highlight, 1);
        sub.drawLine(hx + 3, hy - 6, hx + 2, hy - 9, RAMPS.bone.highlight, 1);
      }
    }
  });

  if (mode === 'swim') clipToSwimUpperBody(buf, 17, 3, 28, frame);
  return finalizeEraCreatureAction(buf, frame, total, 16, 25, action);
}

// 3. Brown Bear (36×28, Tier II) — Shaggy Grizzly with Muscular Shoulder Hump, Jointed Paws & Claws
function renderBrownBear(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const rearUp = isAtk && phase > 0.15 && phase < 0.78;

  const buf = new PixelBuffer(36, 28);
  const cx = 19;
  const cy = (rearUp ? 13 : 16) + bounceY + (mode === 'swim' ? 3 : 0);

  // Far heavy jointed legs + broad paws
  if (mode !== 'swim') {
    const fl = -legSwing * 0.9;
    const hl = legSwing * 0.9;
    drawShadedLimb(buf, cx - 5, cy + 2, cx - 6 + fl * 0.5, cy + 6, 1.9, BEAR_FUR);
    drawShadedLimb(buf, cx - 6 + fl * 0.5, cy + 6, cx - 7 + fl, 25, 1.5, BEAR_FUR);
    buf.fillRect(Math.round(cx - 8 + fl), 24, 3, 2, BEAR_FUR.deep);

    drawShadedLimb(buf, cx + 5, cy + 2, cx + 6 + hl * 0.5, cy + 6, 1.9, BEAR_FUR);
    drawShadedLimb(buf, cx + 6 + hl * 0.5, cy + 6, cx + 5 + hl, 25, 1.5, BEAR_FUR);
    buf.fillRect(Math.round(cx + 4 + hl), 24, 3, 2, BEAR_FUR.deep);
  }

  // Shaggy rounded bear body, prominent shoulder hump, fur tufts & K1/K2 leather harness
  buf.layer((sub) => {
    if (rearUp) {
      sub.fillEllipse(cx - 1, cy + 3, 6.2, 7.6, (nx, ny) => pickTopLeftTone(nx, ny, BEAR_FUR));
    } else {
      sub.fillEllipse(cx + 1, cy + 1, 7.6, 5.2, (nx, ny) => pickTopLeftTone(nx, ny, BEAR_FUR));
      sub.fillEllipse(cx - 4, cy - 2, 4.8, 4.0, (nx, ny) => pickTopLeftTone(nx, ny, BEAR_FUR));
      // Shaggy underbelly fur tufts
      for (let x = cx - 4; x <= cx + 6; x += 3) {
        sub.setPixel(x, cy + 6, BEAR_FUR.deep);
        sub.setPixel(x + 1, cy + 6, BEAR_FUR.shadow);
      }
    }
    // Contoured K1 harness + K2 medallion
    sub.drawLine(cx - 3, cy - 4, cx, cy + 3, RAMPS.magenta.mid, 2);
    sub.setPixel(cx - 2, cy - 3, RAMPS.magenta.highlight);
    sub.setPixel(cx - 1, cy, RAMPS.cyanMask.highlight);
    sub.setPixel(cx, cy + 1, RAMPS.gold.mid);
  });

  // Near muscular jointed legs with clawed bear paws
  if (mode !== 'swim') {
    buf.layer((sub) => {
      const swipeLift = rearUp ? -6 : 0;
      const fl = legSwing;
      const hl = -legSwing;
      drawShadedLimb(sub, cx - 5, cy + 2, cx - 6 + fl * 0.5, cy + 6 + swipeLift * 0.5, 2.0, BEAR_FUR);
      drawShadedLimb(sub, cx - 6 + fl * 0.5, cy + 6 + swipeLift * 0.5, cx - 7 + fl, 25 + swipeLift, 1.6, BEAR_FUR);
      sub.fillRect(Math.round(cx - 9 + fl), 24 + swipeLift, 3, 2, BEAR_FUR.shadow);
      sub.setPixel(Math.round(cx - 10 + fl), 25 + swipeLift, RAMPS.bone.highlight);

      drawShadedLimb(sub, cx + 5, cy + 2, cx + 5 + hl * 0.5, cy + 6, 2.0, BEAR_FUR);
      drawShadedLimb(sub, cx + 5 + hl * 0.5, cy + 6, cx + 4 + hl, 25, 1.6, BEAR_FUR);
      sub.fillRect(Math.round(cx + 3 + hl), 24, 3, 2, BEAR_FUR.shadow);
      sub.setPixel(Math.round(cx + 2 + hl), 25, RAMPS.bone.mid);
    });
  }

  // Sculpted grizzly head, rounded furry ears, distinct pale snout + wet nose & bright eye
  buf.layer((sub) => {
    const hx = rearUp ? cx - 5 : cx - 9;
    const hy = rearUp ? cy - 5 : cy - 3;
    sub.fillEllipse(hx, hy, 4.0, 3.5, (nx, ny) => pickTopLeftTone(nx, ny, BEAR_FUR));
    // Rounded bear ears with inner shade
    sub.fillEllipse(hx - 1, hy - 4, 1.3, 1.2, BEAR_FUR.mid);
    sub.setPixel(hx - 1, hy - 4, BEAR_FUR.shadow);
    sub.fillEllipse(hx + 3, hy - 3, 1.3, 1.2, BEAR_FUR.shadow);
    // Pale tan snout + wet dark nose
    sub.fillEllipse(hx - 4, hy + 1, 2.0, 1.4, RAMPS.timber.highlight);
    sub.setPixel(hx - 6, hy, '#3D2B24');
    sub.setPixel(hx - 5, hy, '#4E382F');
    sub.setPixel(hx - 2, hy - 1, '#EAB308');
    if (appLevel === 2) {
      sub.setPixel(hx - 4, hy + 2, RAMPS.bone.highlight);
      sub.setPixel(hx - 2, hy - 2, RAMPS.bone.mid);
    }
  });

  if (rearUp && phase >= 0.38 && phase < 0.72) {
    buf.drawLine(cx - 12, cy - 1, cx - 14, cy + 4, '#FFFFFF', 1);
  }
  if (mode === 'swim') clipToSwimUpperBody(buf, 17, 4, 31, frame);
  return finalizeEraCreatureAction(buf, frame, total, 18, 25, action);
}

// 4. Steppe Eagle (30×24, Tier I) — Layered Primary/Secondary Pinions, Hooked Beak & Talons
function renderSteppeEagle(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const flap = Math.sin(phase * Math.PI * 2) * 3.8;
  const diveY = isAtk && phase >= 0.3 && phase < 0.72 ? 3 : 0;

  const buf = new PixelBuffer(30, 24);
  const cx = 16;
  const cy = 11 + diveY + (mode === 'swim' ? 3 : 0);

  // Far soaring wing with fanned feather tips
  buf.layer((sub) => {
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      const wx = cx + 1 + u * 6;
      const wy = cy - 1 - u * (4.5 + flap);
      sub.fillEllipse(wx, wy, 1.5, 1.3 * (1 - u * 0.45), i > 4 ? BEAR_FUR.deep : BEAR_FUR.shadow);
    }
  });

  // Fanned barred tail + tapered raptor torso + K1/K2 falconry jess ribbons
  buf.layer((sub) => {
    sub.drawLine(cx + 4, cy, cx + 10, cy + 2, BEAR_FUR.deep, 2);
    sub.drawLine(cx + 4, cy + 1, cx + 9, cy + 4, BEAR_FUR.shadow, 1);
    sub.setPixel(cx + 10, cy + 2, RAMPS.bone.highlight);
    sub.fillEllipse(cx, cy, 4.6, 2.7, (nx, ny) => pickTopLeftTone(nx, ny, BEAR_FUR));
    sub.setPixel(cx + 1, cy + 2, RAMPS.magenta.highlight);
    sub.setPixel(cx + 2, cy + 3, RAMPS.cyanMask.highlight);
  });

  // Eagle head, golden-cream crown sheen, hooked beak & feathered breeches + talons
  buf.layer((sub) => {
    const hx = cx - 5;
    const hy = cy - 2;
    sub.fillEllipse(hx, hy, 2.7, 2.2, (nx, ny) => pickTopLeftTone(nx, ny, BEAR_FUR));
    sub.setPixel(hx - 1, hy - 2, RAMPS.timber.highlight);
    sub.setPixel(hx - 3, hy, RAMPS.gold.highlight);
    sub.setPixel(hx - 4, hy, RAMPS.gold.mid);
    sub.setPixel(hx - 4, hy + 1, RAMPS.gold.shadow);
    sub.setPixel(hx - 1, hy - 1, '#FBBF24');
    if (appLevel >= 1) {
      sub.setPixel(cx - 1, cy + 3, BEAR_FUR.shadow);
      sub.setPixel(cx - 2, cy + 4, RAMPS.gold.mid);
      sub.setPixel(cx - 3, cy + 5, RAMPS.bone.highlight);
    }
  });

  // Near sweeping wing with layered covert highlights & dark primary flight feathers
  buf.layer((sub) => {
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      const wx = cx + u * 6;
      const wy = cy - u * (5.5 - flap);
      sub.fillEllipse(
        wx,
        wy,
        1.7,
        1.5 * (1 - u * 0.4),
        u < 0.35 ? RAMPS.timber.highlight : u < 0.7 ? BEAR_FUR.mid : BEAR_FUR.deep
      );
      if (i >= 4 && i % 2 === 0) {
        sub.setPixel(Math.round(wx + 1), Math.round(wy - 1), RAMPS.bone.mid);
      }
    }
  });

  if (isAtk && phase >= 0.38 && phase < 0.72) {
    buf.drawLine(cx - 6, cy + 2, cx - 8, cy + 5, '#FFFFFF', 1);
  }
  if (mode === 'swim') clipToSwimUpperBody(buf, 13, 4, 26, frame);
  return finalizeEraCreatureAction(buf, frame, total, 15, 20, action);
}

export const WILDLIFE_CREATURE_MODELS: PixelModelDef[] = [
  {
    id: 'wild-boar',
    name: 'Дикий Кабан',
    subtitle: 'Щетинистый зверь с клыками (28×20)',
    kind: 'unit',
    tier: 'I',
    era: 'wildlife',
    entityType: 'creature',
    faction: 'Орда',
    width: 28,
    height: 20,
    frameCount: 8,
    defaultFps: 11,
    attackName: 'Таранный выпад клыками',
    unitMeta: {
      coreSize: '20×14 зверь',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 12,
      supportsGenes: true,
    },
    layersSpec: ['1. Щетинистый бурый корпус без контура', '2. Сбруя державы K1/K2 и загнутые клыки'],
    description: 'Коренастый лесной вепрь реального животного мира: бросается в яростный таран острыми белыми клыками.',
    renderFrame: renderWildBoar,
    getAnchors: () => ({ head: { x: 5, y: 8, w: 6, h: 5 }, item: { x: 3, y: 9, w: 4, h: 4 }, pivot: { x: 14, y: 17 } }),
    codeSnippet: `function renderWildBoar(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(28, 20); }`,
  },
  {
    id: 'forest-stag',
    name: 'Благородный Олень',
    subtitle: 'Стройный лесной олень с рогами (32×28)',
    kind: 'unit',
    tier: 'II',
    era: 'wildlife',
    entityType: 'creature',
    faction: 'Лесной Круг',
    width: 32,
    height: 28,
    frameCount: 8,
    defaultFps: 11,
    attackName: 'Удар ветвистыми рогами',
    unitMeta: {
      coreSize: '24×20 зверь',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 14,
      supportsGenes: true,
    },
    layersSpec: ['1. Рыже-бурое тело, белый хвост и лента K1/K2', '2. Ветвистые костяные рога (гены)'],
    description: 'Изящный благородный олень умеренных лесов: стремительно скачет по опушкам и защищается ветвистыми рогами.',
    renderFrame: renderForestStag,
    getAnchors: () => ({ head: { x: 6, y: 6, w: 6, h: 5 }, item: { x: 5, y: 1, w: 8, h: 6 }, pivot: { x: 16, y: 25 } }),
    codeSnippet: `function renderForestStag(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(32, 28); }`,
  },
  {
    id: 'brown-bear',
    name: 'Бурый Медведь',
    subtitle: 'Мощный лесной хищник (36×28)',
    kind: 'unit',
    tier: 'II',
    era: 'wildlife',
    entityType: 'creature',
    faction: 'Лесной Круг',
    width: 36,
    height: 28,
    frameCount: 10,
    defaultFps: 10,
    attackName: 'Удар лапой на дыбах',
    unitMeta: {
      coreSize: '28×20 крупный зверь',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 16,
      supportsGenes: true,
    },
    layersSpec: ['1. Косматая бурая шкура со светлой мордой', '2. Перевязь державы K1/K2 и атака на дыбах'],
    description: 'Хозяин лесной чащи: тяжело шагает по бурелому, в бою поднимается на дыбы и наносит мощный удар когтями.',
    renderFrame: renderBrownBear,
    getAnchors: () => ({ head: { x: 7, y: 9, w: 7, h: 6 }, item: { x: 4, y: 13, w: 5, h: 6 }, pivot: { x: 18, y: 25 } }),
    codeSnippet: `function renderBrownBear(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(36, 28); }`,
  },
  {
    id: 'steppe-eagle',
    name: 'Степной Орёл',
    subtitle: 'Хищная птица в полёте (30×24)',
    kind: 'unit',
    tier: 'I',
    era: 'wildlife',
    entityType: 'creature',
    faction: 'Гильдия',
    width: 30,
    height: 24,
    frameCount: 8,
    defaultFps: 12,
    attackName: 'Пикирующий удар когтями',
    unitMeta: {
      coreSize: '22×16 птица',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 12,
      supportsGenes: true,
    },
    layersSpec: ['1. Широкие крылья с 4-тоновой тенью', '2. Золотой клюв, когти и ленты державы K1/K2'],
    description: 'Зоркий степной орёл: парит с широким взмахом бурых крыльев и пикирует на добычу с вытянутыми когтями.',
    renderFrame: renderSteppeEagle,
    getAnchors: () => ({ head: { x: 8, y: 7, w: 5, h: 4 }, item: { x: 11, y: 12, w: 5, h: 4 }, pivot: { x: 15, y: 20 } }),
    codeSnippet: `function renderSteppeEagle(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(30, 24); }`,
  },
];
