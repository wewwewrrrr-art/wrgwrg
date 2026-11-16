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

const DINO_HIDE_OLIVE: MaterialRamp = {
  id: 'dino_olive',
  name: 'Оливковая чешуя',
  role: 'Dinosaur hide',
  deep: '#2F4623',
  shadow: '#4A6B33',
  mid: '#6E9448',
  highlight: '#96BD65',
};

const DINO_OCHRE: MaterialRamp = {
  id: 'dino_ochre',
  name: 'Охра песчаная',
  role: 'Desert dinosaur hide',
  deep: '#5C3A1E',
  shadow: '#85572E',
  mid: '#B57B42',
  highlight: '#DEA466',
};

const DINO_SLATE_BLUE: MaterialRamp = {
  id: 'dino_slate',
  name: 'Сизый панцирь',
  role: 'Armored hide',
  deep: '#2C3442',
  shadow: '#435063',
  mid: '#64768F',
  highlight: '#8EA2BC',
};

const DINO_TEAL_SEA: MaterialRamp = {
  id: 'dino_sea',
  name: 'Глубинная лазурь',
  role: 'Marine reptile hide',
  deep: '#193C4D',
  shadow: '#275A70',
  mid: '#3F8299',
  highlight: '#6CB2C7',
};

const DINO_COPPER: MaterialRamp = {
  id: 'dino_copper',
  name: 'Терракота хищника',
  role: 'Predator scales',
  deep: '#4F231A',
  shadow: '#78382A',
  mid: '#A6543E',
  highlight: '#CF7A5E',
};

// 1. Compsognathus — Small Pack Predator (18×14, Tier I, ~12×9 core)
function renderPackCompy(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const lungeX = isAtk ? (phase < 0.35 ? 1 : phase < 0.7 ? -2 : 0) : 0;
  const buf = new PixelBuffer(18, 14);
  const cy = 8 + bounceY + (mode === 'swim' ? 2 : 0);
  const cx = 9 + lungeX;

  // Tail extending right
  for (let i = 0; i < 6; i++) {
    const ty = cy - Math.round(Math.sin(phase * Math.PI * 2 + i * 0.5) * 0.8);
    buf.setPixel(cx + 2 + i, ty, i < 3 ? DINO_HIDE_OLIVE.mid : DINO_HIDE_OLIVE.shadow);
  }
  // Ornate tail fan feather
  if (appLevel === 2) {
    buf.setPixel(cx + 7, cy - 1, RAMPS.magenta.mid);
    buf.setPixel(cx + 8, cy, RAMPS.cyanMask.mid);
  }

  // Legs (hidden in swim)
  if (mode !== 'swim') {
    const leg1X = cx + Math.round(legSwing * 0.6);
    const leg2X = cx + 1 - Math.round(legSwing * 0.6);
    buf.drawLine(cx, cy + 1, leg1X, 11, DINO_HIDE_OLIVE.shadow, 1);
    buf.drawLine(cx + 1, cy + 1, leg2X, 11, DINO_HIDE_OLIVE.deep, 1);
  }

  // Torso (5x3 core)
  buf.fillEllipse(cx, cy, 2.6, 1.8, (nx, ny) => pickTopLeftTone(nx, ny, DINO_HIDE_OLIVE));
  // Pack K1 dorsal stripe
  buf.setPixel(cx, cy - 1, RAMPS.magenta.mid);
  buf.setPixel(cx + 1, cy - 1, RAMPS.magenta.shadow);

  // Snout & Head facing left
  const hx = cx - 4;
  const hy = cy - 2;
  buf.fillEllipse(hx, hy, 2.2, 1.4, (nx, ny) => pickTopLeftTone(nx, ny, DINO_HIDE_OLIVE));
  buf.setPixel(hx - 1, hy, '#EAB308'); // eye
  if (appLevel >= 1) {
    buf.setPixel(hx + 1, hy - 2, appLevel === 2 ? RAMPS.cyanMask.highlight : RAMPS.magenta.highlight);
  }
  if (isAtk && phase >= 0.35 && phase < 0.7) {
    buf.setPixel(hx - 3, hy + 1, RAMPS.bone.highlight); // snapping bite glint
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 9, 2, 15, frame);
  return finalizeEraCreatureAction(buf, frame, total, 9, 10, action);
}

// 2. Feathered Raptor — Deinonychus (34×26, Tier II)
function renderFeatheredRaptor(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const leapY = isAtk && phase >= 0.3 && phase < 0.68 ? -3 : 0;
  const lungeX = isAtk ? (phase < 0.3 ? 2 : phase < 0.7 ? -3 : 0) : 0;

  const buf = new PixelBuffer(34, 26);
  const cx = 17 + lungeX;
  const cy = 14 + bounceY + leapY + (mode === 'swim' ? 3 : 0);

  // Tail with feathered fan
  for (let i = 0; i < 11; i++) {
    const ty = cy - 1 + Math.round(Math.sin(phase * Math.PI * 2 - i * 0.35) * 1.1);
    const col = i < 6 ? DINO_COPPER.mid : DINO_COPPER.shadow;
    buf.fillEllipse(cx + 3 + i, ty, 1, Math.max(0.6, 1.4 - i * 0.08), col);
    if (appLevel >= 1 && i >= 6) {
      buf.setPixel(cx + 3 + i, ty - 1, RAMPS.magenta.mid);
      if (appLevel === 2) buf.setPixel(cx + 3 + i, ty + 1, RAMPS.cyanMask.mid);
    }
  }

  // Muscular hind legs + raised sickle claw
  if (mode !== 'swim') {
    drawShadedLimb(buf, cx + 1, cy + 1, cx + 2 - legSwing, 23, 1.3, DINO_COPPER);
    buf.layer((sub) => {
      drawShadedLimb(sub, cx - 1, cy + 1, cx - 2 + legSwing, 23, 1.3, DINO_COPPER);
      // Sickle claw highlight
      const clawY = isAtk && phase >= 0.3 && phase < 0.7 ? cy + 5 : 21;
      sub.setPixel(Math.round(cx - 3 + legSwing), clawY, RAMPS.bone.highlight);
    });
  }

  // Body & forelimb wing feathers
  buf.layer((sub) => {
    sub.fillEllipse(cx, cy, 5.2, 3.2, (nx, ny) => pickTopLeftTone(nx, ny, DINO_COPPER));
    if (appLevel >= 1) {
      sub.fillEllipse(cx - 2, cy + 1, 3.2, 1.8, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
      if (appLevel === 2) {
        sub.drawLine(cx - 4, cy + 2, cx + 1, cy + 3, RAMPS.cyanMask.highlight, 1);
      }
    }
  });

  // Arched neck & predator skull facing left
  buf.layer((sub) => {
    drawShadedLimb(sub, cx - 4, cy - 1, cx - 7, cy - 5, 1.8, DINO_COPPER);
    const hx = cx - 9;
    const hy = cy - 6;
    sub.fillEllipse(hx, hy, 3.5, 2.1, (nx, ny) => pickTopLeftTone(nx, ny, DINO_COPPER));
    sub.setPixel(hx - 1, hy - 1, '#FACC15'); // golden eye
    // Feather crest
    if (appLevel >= 1) {
      sub.drawLine(hx + 1, hy - 2, hx + 4, hy - 4 - (appLevel === 2 ? 1 : 0), RAMPS.magenta.highlight, 1);
      if (appLevel === 2) sub.setPixel(hx + 5, hy - 4, RAMPS.cyanMask.highlight);
    }
    if (isAtk && phase >= 0.35 && phase < 0.72) {
      // Open jaw & talon slash
      sub.drawLine(hx - 3, hy + 1, hx - 1, hy + 2, RAMPS.bone.highlight, 1);
      sub.drawLine(cx - 10, cy - 1, cx - 13, cy + 3, '#FFFFFF', 1);
    }
  });

  if (mode === 'swim') clipToSwimUpperBody(buf, 16, 4, 29, frame);
  return finalizeEraCreatureAction(buf, frame, total, 17, 21, action);
}

// 3. Sauropod — Brachiosaurus Giant Herbivore (76×62, Tier III, ~64×54 core)
function renderSauropod(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const neckLift = isAtk ? (phase < 0.38 ? -4 : phase < 0.68 ? 3 : 0) : 0;
  const stompOffset = isAtk && phase >= 0.45 && phase < 0.72 ? 2 : 0;

  const buf = new PixelBuffer(76, 62);
  const bx = 42;
  const by = 38 + bounceY + (mode === 'swim' ? 6 : 0);

  // Long counter-balancing tail to the right
  buf.layer((sub) => {
    for (let i = 0; i < 22; i++) {
      const u = i / 21;
      const tx = bx + 10 + i;
      const ty = by + 1 + Math.round(Math.sin(phase * Math.PI * 2 + u * 2.5) * 1.5 + u * 3);
      sub.fillEllipse(tx, ty, 1.5, Math.max(0.9, 4.2 * (1 - u * 0.78)), (nx, ny) =>
        pickTopLeftTone(nx, ny, DINO_SLATE_BLUE)
      );
    }
  });

  // Back pillar legs
  if (mode !== 'swim') {
    drawShadedLimb(buf, bx - 7, by + 5, bx - 8 - legSwing, 57, 3.2, DINO_SLATE_BLUE);
    drawShadedLimb(buf, bx + 8, by + 5, bx + 9 + legSwing, 57, 3.0, DINO_SLATE_BLUE);
  }

  // Massive domed torso + war blanket K1/K2
  buf.layer((sub) => {
    sub.fillEllipse(bx, by, 14.5, 9.5, (nx, ny) => pickTopLeftTone(nx, ny, DINO_SLATE_BLUE));
    // Saddle/harness cloth in K1/K2
    sub.fillEllipse(bx - 1, by - 3, 7.5, 4.2, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
    sub.drawLine(bx - 7, by - 1, bx + 5, by - 1, RAMPS.cyanMask.mid, 1);
    if (appLevel === 2) {
      for (let s = -4; s <= 6; s += 3) {
        sub.fillEllipse(bx + s, by - 9, 1.2, 2.0, RAMPS.bone.highlight);
      }
    }
  });

  // Front pillar legs (taller forelegs like Brachiosaurus)
  if (mode !== 'swim') {
    buf.layer((sub) => {
      const liftY = isAtk && phase < 0.42 ? -5 : stompOffset;
      drawShadedLimb(sub, bx - 9, by + 3, bx - 10 + legSwing, 57 + liftY, 3.4, DINO_SLATE_BLUE);
      drawShadedLimb(sub, bx + 6, by + 3, bx + 6 - legSwing, 57, 3.2, DINO_SLATE_BLUE);
    });
  }

  // Towering curved neck & small crested head facing left
  buf.layer((sub) => {
    const headX = 16;
    const headY = 12 + bounceY + neckLift + (mode === 'swim' ? 5 : 0);
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const nx = (bx - 10) * (1 - u) + (headX + 4) * u - Math.sin(u * Math.PI) * 3;
      const ny = (by - 4) * (1 - u) + headY * u;
      const r = 4.6 * (1 - u * 0.56);
      sub.fillEllipse(nx, ny, r, r * 0.9, (px, py) => pickTopLeftTone(px, py, DINO_SLATE_BLUE));
      if (appLevel >= 1 && i % 3 === 1 && u > 0.15 && u < 0.9) {
        sub.setPixel(Math.round(nx - r), Math.round(ny), RAMPS.cyanMask.highlight);
      }
    }
    sub.fillEllipse(headX, headY, 4.4, 2.7, (nx, ny) => pickTopLeftTone(nx, ny, DINO_SLATE_BLUE));
    sub.setPixel(headX - 2, headY, '#EAB308');
    // Nasal crest dome
    if (appLevel >= 1) {
      sub.fillEllipse(headX + 1, headY - 3, 1.8, 1.3 + (appLevel === 2 ? 1 : 0), RAMPS.magenta.highlight);
    }
  });

  // Stomp shockwave ring during heavy slam phase
  if (isAtk && phase >= 0.48 && phase < 0.78 && mode !== 'swim') {
    buf.drawLine(bx - 18, 58, bx - 3, 58, RAMPS.bone.highlight, 1);
    buf.drawLine(bx - 21, 59, bx - 14, 59, RAMPS.gold.mid, 1);
  }

  if (mode === 'swim') clipToSwimUpperBody(buf, 39, 8, 68, frame);
  return finalizeEraCreatureAction(buf, frame, total, 38, 46, action);
}

// 4. Triceratops — Horned Ceratopsian (44×30, Tier II)
function renderTriceratops(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const chargeX = isAtk ? (phase < 0.35 ? 2 : phase < 0.72 ? -4 : 0) : 0;

  const buf = new PixelBuffer(44, 30);
  const cx = 24 + chargeX;
  const cy = 16 + bounceY + (mode === 'swim' ? 3 : 0);

  // Tail
  drawShadedLimb(buf, cx + 8, cy, cx + 16, cy + 2, 2.2, DINO_OCHRE);

  // Back legs
  if (mode !== 'swim') {
    drawShadedLimb(buf, cx - 5, cy + 3, cx - 6 - legSwing, 26, 2.1, DINO_OCHRE);
    drawShadedLimb(buf, cx + 5, cy + 3, cx + 6 + legSwing, 26, 2.1, DINO_OCHRE);
  }

  // Barrel torso + K1 war blanket
  buf.layer((sub) => {
    sub.fillEllipse(cx, cy, 9.2, 5.8, (nx, ny) => pickTopLeftTone(nx, ny, DINO_OCHRE));
    sub.fillEllipse(cx + 1, cy - 2, 5.0, 2.8, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.magenta));
  });

  // Front legs
  if (mode !== 'swim') {
    buf.layer((sub) => {
      drawShadedLimb(sub, cx - 4, cy + 3, cx - 4 + legSwing, 26, 2.1, DINO_OCHRE);
      drawShadedLimb(sub, cx + 6, cy + 3, cx + 5 - legSwing, 26, 2.0, DINO_OCHRE);
    });
  }

  // Bony frill + Armored head + 3 Horns
  buf.layer((sub) => {
    const headPitch = isAtk && phase >= 0.3 && phase < 0.7 ? 2 : 0;
    const fx = cx - 8;
    const fy = cy - 2 + headPitch;
    // Scalloped K1/K2 shield frill
    sub.fillEllipse(fx + 1, fy - 2, 4.2, 5.2, (nx, ny) => pickTopLeftTone(nx, ny, DINO_OCHRE));
    sub.fillEllipse(fx + 1, fy - 2, 3.0, 3.8, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.cyanMask));
    if (appLevel === 2) {
      sub.setPixel(fx + 2, fy - 7, RAMPS.bone.highlight);
      sub.setPixel(fx + 4, fy - 6, RAMPS.bone.highlight);
      sub.setPixel(fx - 1, fy - 6, RAMPS.bone.highlight);
    }

    // Skull & Beak facing left
    const hx = fx - 4;
    const hy = fy + 1;
    sub.fillEllipse(hx, hy, 4.2, 2.9, (nx, ny) => pickTopLeftTone(nx, ny, DINO_OCHRE));
    sub.setPixel(hx - 1, hy - 1, '#261812');

    // Brow & Nasal Horns controlled by genes
    if (appLevel >= 1) {
      const len = appLevel === 2 ? 7 : 5;
      drawCurvedHorn(sub, hx, hy - 2, hx - len, hy - 5 - (appLevel === 2 ? 1 : 0), hx - 3, hy - 4, 1.1);
      drawCurvedHorn(sub, hx - 3, hy - 1, hx - 4 - appLevel, hy - 3, hx - 4, hy - 2, 0.9);
    }
  });

  if (isAtk && phase >= 0.35 && phase < 0.7) {
    buf.drawLine(cx - 19, cy - 3, cx - 21, cy + 1, '#FFFFFF', 1);
  }
  if (mode === 'swim') clipToSwimUpperBody(buf, 18, 4, 39, frame);
  return finalizeEraCreatureAction(buf, frame, total, 22, 22, action);
}

// 5. Ankylosaurus — Armored Club-Tail Tank (44×26, Tier II)
function renderAnkylosaurus(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const tailWhipY = isAtk ? (phase < 0.35 ? -4 : phase < 0.7 ? 3 : 0) : 0;

  const buf = new PixelBuffer(44, 26);
  const cx = 19;
  const cy = 15 + bounceY + (mode === 'swim' ? 2 : 0);

  // Armored tail + heavy bone club
  buf.layer((sub) => {
    const clubX = cx + 17;
    const clubY = cy + tailWhipY;
    drawShadedLimb(sub, cx + 8, cy, clubX - 2, clubY, 1.6, DINO_SLATE_BLUE);
    sub.fillEllipse(clubX, clubY, 3.0, 2.5, (nx, ny) => pickTopLeftTone(nx, ny, RAMPS.bone));
    if (isAtk && phase >= 0.38 && phase < 0.72) {
      sub.drawLine(clubX + 2, clubY - 3, clubX + 4, clubY + 3, '#FFFFFF', 1);
    }
  });

  // Short sturdy legs
  if (mode !== 'swim') {
    drawShadedLimb(buf, cx - 5, cy + 3, cx - 5 - legSwing, 23, 1.8, DINO_SLATE_BLUE);
    drawShadedLimb(buf, cx + 6, cy + 3, cx + 6 + legSwing, 23, 1.8, DINO_SLATE_BLUE);
  }

  // Wide low osteoderm carapace dome + K1/K2 trim
  buf.layer((sub) => {
    sub.fillEllipse(cx, cy, 10.5, 5.2, (nx, ny) => pickTopLeftTone(nx, ny, DINO_SLATE_BLUE));
    // Dorsal armor rows
    for (let sx = -7; sx <= 7; sx += 3.5) {
      sub.fillEllipse(cx + sx, cy - 3, 1.5, 1.1, RAMPS.magenta.mid);
      if (appLevel >= 1) {
        sub.setPixel(Math.round(cx + sx), cy - 5, appLevel === 2 ? RAMPS.bone.highlight : RAMPS.cyanMask.highlight);
      }
    }
    if (appLevel === 2) {
      // Lateral shoulder spikes
      sub.drawLine(cx - 7, cy + 1, cx - 9, cy - 2, RAMPS.bone.highlight, 1);
      sub.drawLine(cx + 6, cy + 1, cx + 9, cy - 2, RAMPS.bone.highlight, 1);
    }
  });

  // Low armored skull facing left
  buf.layer((sub) => {
    const hx = cx - 11;
    const hy = cy + 1;
    sub.fillEllipse(hx, hy, 3.8, 2.5, (nx, ny) => pickTopLeftTone(nx, ny, DINO_SLATE_BLUE));
    sub.setPixel(hx - 1, hy, '#EAB308');
    if (appLevel >= 1) {
      sub.setPixel(hx + 2, hy - 2, RAMPS.bone.highlight);
      sub.setPixel(hx + 3, hy - 3, RAMPS.bone.mid);
    }
  });

  if (mode === 'swim') clipToSwimUpperBody(buf, 16, 4, 38, frame);
  return finalizeEraCreatureAction(buf, frame, total, 20, 19, action);
}

// 6. Pteranodon — Flying Reptile (44×32, Tier II)
function renderPteranodon(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const p = frame / Math.max(1, total);
  const isAtk = action === 'attack';
  const flap = action === 'idle' ? Math.sin(p * Math.PI * 2) * 1.5 : Math.sin(p * Math.PI * 2) * 6.5;
  const swoopY = isAtk ? (p < 0.35 ? -3 : p < 0.7 ? 5 : 0) : Math.round(Math.sin(p * Math.PI * 2) * 1.5);
  const lungeX = isAtk && p >= 0.3 && p < 0.7 ? -4 : 0;

  const buf = new PixelBuffer(44, 32);
  const cx = 22 + lungeX;
  const cy = 16 + swoopY + (mode === 'swim' ? 3 : 0);

  // Back soaring wing with shaded membrane
  buf.layer((sub) => {
    const tipX = cx + 12;
    const tipY = Math.max(2, Math.min(28, Math.round(cy - 6 - flap * 0.85)));
    for (let i = 0; i <= 14; i++) {
      const u = i / 14;
      const wx = cx + 2 + (tipX - cx) * u;
      const wy = cy + (tipY - cy) * u;
      sub.fillEllipse(wx, wy + u * 2, 1.8, Math.max(1.1, 3.6 * (1 - u * 0.55)), RAMPS.cyanMask.shadow);
    }
  });

  // Compact aerodynamic torso & tucked clawed hindlegs
  buf.layer((sub) => {
    sub.fillEllipse(cx, cy, 5.2, 2.9, (nx, ny) => pickTopLeftTone(nx, ny, DINO_OCHRE));
    if (mode !== 'swim') {
      sub.drawLine(cx + 4, cy + 1, cx + 9, cy + 3, DINO_OCHRE.shadow, 1);
      sub.setPixel(cx + 10, cy + 3, RAMPS.bone.highlight);
    }
  });

  // Front soaring wing with bone spar highlight + scalloped K1 patagium ribs
  buf.layer((sub) => {
    const tipX = cx + 15;
    const tipY = Math.max(2, Math.min(28, Math.round(cy - 5 + flap)));
    for (let i = 0; i <= 16; i++) {
      const u = i / 16;
      const wx = cx + 1 + (tipX - cx) * u;
      const wy = cy + (tipY - cy) * u;
      sub.fillEllipse(wx, wy, 1.8, 1.2, u < 0.55 ? DINO_OCHRE.highlight : DINO_OCHRE.mid);
      if (i > 1 && i < 14) {
        const memCol = i % 4 === 0 ? RAMPS.magenta.shadow : RAMPS.magenta.mid;
        sub.fillEllipse(wx + 1, wy + 2.3, 1.6, 2.7 * (1 - u * 0.5), memCol);
      }
    }
  });

  // Spear beak + sweeping head crest + keen amber eye
  buf.layer((sub) => {
    const hx = cx - 5;
    const hy = cy - 1;
    sub.fillEllipse(hx, hy, 2.8, 2.2, (nx, ny) => pickTopLeftTone(nx, ny, DINO_OCHRE));
    sub.drawLine(hx - 2, hy, hx - 10, hy + 1, RAMPS.gold.highlight, 1);
    sub.drawLine(hx - 2, hy + 1, hx - 8, hy + 2, RAMPS.gold.shadow, 1);
    sub.setPixel(hx - 1, hy - 1, '#EAB308');
    if (appLevel >= 1) {
      const crestLen = appLevel === 2 ? 10 : 7;
      sub.drawLine(hx + 1, hy - 1, hx + crestLen, hy - 5 - (appLevel === 2 ? 2 : 0), RAMPS.magenta.highlight, 1);
      sub.drawLine(hx + 1, hy, hx + crestLen - 1, hy - 4 - (appLevel === 2 ? 2 : 0), RAMPS.magenta.mid, 1);
      if (appLevel === 2) {
        sub.drawLine(hx + 2, hy - 2, hx + crestLen - 1, hy - 6, RAMPS.cyanMask.highlight, 1);
      }
    }
    if (isAtk && p >= 0.35 && p < 0.72) {
      sub.setPixel(hx - 11, hy + 1, '#FFFFFF');
    }
  });

  if (mode === 'swim') clipToSwimUpperBody(buf, 19, 6, 36, frame);
  return finalizeEraCreatureAction(buf, frame, total, 22, 17, action);
}

// 7. Plesiosaur — Marine Reptile (52×36, kind: 'aquatic', Tier II)
function renderPlesiosaur(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { action, appLevel } = getEraModeAction(ctx);
  const p = frame / Math.max(1, total);
  const isAtk = action === 'attack';
  const lungeX = isAtk ? (p < 0.3 ? 3 : p < 0.65 ? -5 : 0) : 0;

  const buf = new PixelBuffer(52, 36);
  const cx = 31 + lungeX;
  const waterY = 23;

  // Tail & upper rounded carapace visible above WATER_LINE
  buf.layer((sub) => {
    for (let i = 0; i < 12; i++) {
      const tx = cx + 8 + i;
      const ty = waterY - 2 + Math.round(Math.sin(p * Math.PI * 2 - i * 0.45) * 1.4);
      sub.fillEllipse(tx, ty, 1.3, Math.max(0.7, 2.2 - i * 0.14), (nx, ny) =>
        pickTopLeftTone(nx, ny, DINO_TEAL_SEA)
      );
    }
    sub.fillEllipse(cx, waterY - 2, 9.5, 4.6, (nx, ny) => pickTopLeftTone(nx, ny, DINO_TEAL_SEA));
    // K1 dorsal spot pattern
    sub.fillEllipse(cx - 2, waterY - 4, 2.5, 1.4, RAMPS.magenta.mid);
    sub.fillEllipse(cx + 3, waterY - 3, 2.0, 1.2, RAMPS.cyanMask.mid);
  });

  // Tall swan neck & nimble head above water
  buf.layer((sub) => {
    const reach = isAtk && p >= 0.3 && p < 0.7 ? -4 : 0;
    const headX = 11 + lungeX + reach;
    const headY = 10 + Math.round(Math.sin(p * Math.PI * 2) * 1.2) + (isAtk && p >= 0.35 && p < 0.65 ? 3 : 0);
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const nx = (cx - 7) * (1 - u) + headX * u - Math.sin(u * Math.PI) * 2.5;
      const ny = (waterY - 3) * (1 - u) + headY * u;
      sub.fillEllipse(nx, ny, 2.3 - u * 0.7, 2.1 - u * 0.6, (px, py) =>
        pickTopLeftTone(px, py, DINO_TEAL_SEA)
      );
      if (appLevel >= 1 && i % 3 === 1) {
        sub.setPixel(Math.round(nx + 2), Math.round(ny), RAMPS.cyanMask.highlight);
      }
    }
    sub.fillEllipse(headX - 1, headY, 3.4, 2.1, (nx, ny) => pickTopLeftTone(nx, ny, DINO_TEAL_SEA));
    sub.setPixel(headX - 2, headY - 1, '#FACC15');
    if (appLevel === 2) {
      sub.drawLine(headX + 1, headY - 2, headX + 4, headY - 4, RAMPS.magenta.highlight, 1);
    }
    if (isAtk && p >= 0.35 && p < 0.68) {
      sub.drawLine(headX - 4, headY + 1, headX - 6, headY + 2, RAMPS.bone.highlight, 1);
    }
  });

  // Subtle submerged paddles beneath water surface + wavy crests (matching aquaticMonsters)
  clipToSwimUpperBody(buf, waterY, 5, 48, frame);
  const paddleWave = Math.round(Math.sin(p * Math.PI * 2) * 2);
  buf.fillEllipse(cx - 4, waterY + 3 + Math.max(0, paddleWave), 3.4, 1.4, '#164E63AA');
  buf.fillEllipse(cx + 5, waterY + 3 - Math.min(0, paddleWave), 3.0, 1.3, '#164E63AA');
  return finalizeEraCreatureAction(buf, frame, total, 26, 20, action);
}

// 8. Spinosaurus — Giant Sail-Backed Predator (68×48, Tier III)
function renderSpinosaurus(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const lungeX = isAtk ? (phase < 0.3 ? 3 : phase < 0.68 ? -5 : 0) : 0;

  const buf = new PixelBuffer(68, 48);
  const cx = 34 + lungeX;
  const cy = 28 + bounceY + (mode === 'swim' ? 5 : 0);

  // Heavy crocodile-like tail
  for (let i = 0; i < 19; i++) {
    const u = i / 18;
    const ty = cy + Math.round(Math.sin(phase * Math.PI * 2 - i * 0.3) * 1.4);
    buf.fillEllipse(cx + 8 + i, ty, 1.5, Math.max(0.8, 3.8 * (1 - u * 0.72)), (nx, ny) =>
      pickTopLeftTone(nx, ny, DINO_HIDE_OLIVE)
    );
    if (i < 10 && appLevel >= 1) {
      buf.setPixel(cx + 8 + i, Math.round(ty - 3 * (1 - u)), RAMPS.cyanMask.mid);
    }
  }

  // Far leg
  if (mode !== 'swim') {
    drawShadedLimb(buf, cx + 2, cy + 3, cx + 4 - legSwing, 42, 2.4, DINO_HIDE_OLIVE);
  }

  // Iconic giant dorsal sail + K1/K2 coloration
  buf.layer((sub) => {
    const sailH = appLevel === 0 ? 5 : appLevel === 2 ? 15 : 12;
    for (let sx = -9; sx <= 10; sx++) {
      const arch = Math.cos((sx / 10.5) * (Math.PI * 0.5));
      const h = Math.max(2, Math.round(arch * sailH));
      for (let dy = 0; dy < h; dy++) {
        const isEdge = dy > h - 3;
        const col =
          isEdge
            ? RAMPS.magenta.highlight
            : sx % 4 === 0
              ? RAMPS.cyanMask.mid
              : RAMPS.magenta.mid;
        sub.setPixel(cx + sx, cy - 4 - dy, col);
      }
      if (appLevel === 2 && sx % 3 === 0) {
        sub.setPixel(cx + sx, cy - 5 - h, RAMPS.bone.highlight);
      }
    }
  });

  // Heavy torso & near leg
  buf.layer((sub) => {
    sub.fillEllipse(cx, cy, 10.5, 6.2, (nx, ny) => pickTopLeftTone(nx, ny, DINO_HIDE_OLIVE));
    if (mode !== 'swim') {
      drawShadedLimb(sub, cx - 2, cy + 3, cx - 3 + legSwing, 42, 2.5, DINO_HIDE_OLIVE);
      // Slashing claws
      drawShadedLimb(sub, cx - 7, cy + 1, cx - 11, cy + 5, 1.3, DINO_HIDE_OLIVE);
    }
  });

  // Elongated crocodilian skull & crest
  buf.layer((sub) => {
    drawShadedLimb(sub, cx - 8, cy - 2, cx - 14, cy - 7, 2.6, DINO_HIDE_OLIVE);
    const hx = cx - 18;
    const hy = cy - 9;
    sub.fillEllipse(hx, hy, 6.2, 2.6, (nx, ny) => pickTopLeftTone(nx, ny, DINO_HIDE_OLIVE));
    sub.setPixel(hx + 2, hy - 1, '#FACC15');
    if (appLevel >= 1) {
      sub.drawLine(hx, hy - 3, hx + 3, hy - 4 - (appLevel === 2 ? 1 : 0), RAMPS.magenta.highlight, 1);
    }
    if (isAtk && phase >= 0.32 && phase < 0.72) {
      sub.drawLine(hx - 6, hy + 2, hx, hy + 3, RAMPS.bone.highlight, 1);
      sub.drawLine(hx - 7, hy - 1, hx - 10, hy + 4, '#FFFFFF', 1);
    }
  });

  if (mode === 'swim') clipToSwimUpperBody(buf, 31, 6, 62, frame);
  return finalizeEraCreatureAction(buf, frame, total, 34, 34, action);
}

// 9. Stegosaurus — Plated Herbivore (48×32, Tier II)
function renderStegosaurus(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const { mode, action, appLevel } = getEraModeAction(ctx);
  const { phase, bounceY, legSwing } = getWalkCycle(frame, total, action);
  const isAtk = action === 'attack';
  const tailLift = isAtk ? (phase < 0.35 ? -4 : phase < 0.7 ? 2 : 0) : 0;

  const buf = new PixelBuffer(48, 32);
  const cx = 23;
  const cy = 18 + bounceY + (mode === 'swim' ? 3 : 0);

  // Tail + 4-spike thagomizer
  buf.layer((sub) => {
    const tx = cx + 16;
    const ty = cy + tailLift;
    drawShadedLimb(sub, cx + 7, cy, tx, ty, 1.8, DINO_OCHRE);
    if (appLevel >= 1) {
      sub.drawLine(tx - 2, ty - 1, tx, ty - 5, RAMPS.bone.highlight, 1);
      sub.drawLine(tx, ty - 1, tx + 3, ty - 4, RAMPS.bone.highlight, 1);
      if (appLevel === 2) {
        sub.drawLine(tx - 1, ty + 1, tx + 2, ty + 4, RAMPS.bone.mid, 1);
      }
    }
    if (isAtk && phase >= 0.38 && phase < 0.7) {
      sub.drawLine(tx + 2, ty - 5, tx + 4, ty + 3, '#FFFFFF', 1);
    }
  });

  // Back legs
  if (mode !== 'swim') {
    drawShadedLimb(buf, cx - 5, cy + 3, cx - 5 - legSwing, 29, 2.0, DINO_OCHRE);
    drawShadedLimb(buf, cx + 6, cy + 3, cx + 6 + legSwing, 29, 2.1, DINO_OCHRE);
  }

  // Iconic diamond dorsal plates (K1/K2) — alternating pointed silhouettes
  buf.layer((sub) => {
    const count = appLevel === 0 ? 3 : appLevel === 2 ? 7 : 5;
    for (let i = 0; i < count; i++) {
      const px = Math.round(cx - 7 + i * (14 / Math.max(1, count - 1)));
      const arch = 1 - Math.abs(i - (count - 1) / 2) / Math.max(1, (count + 1) / 2);
      const h = appLevel === 0 ? 2 : Math.max(3, Math.round((3 + arch * 3.5) * (appLevel === 2 ? 1.25 : 1)));
      const baseY = cy - 4;
      const ramp = i % 2 === 0 ? RAMPS.magenta : RAMPS.cyanMask;
      for (let dy = 0; dy <= h; dy++) {
        const w = dy === 0 ? 1 : dy === h ? 0 : dy < h * 0.65 ? 1 : 0;
        for (let dx = -w; dx <= w; dx++) {
          const col = dy >= h - 1 ? ramp.highlight : dx < 0 ? ramp.highlight : ramp.mid;
          sub.setPixel(px + dx, baseY - dy, col);
        }
      }
    }
  });

  // Arched body + near legs + sloping neck & distinct beaked head facing left
  buf.layer((sub) => {
    sub.fillEllipse(cx, cy, 9.2, 5.6, (nx, ny) => pickTopLeftTone(nx, ny, DINO_OCHRE));
    if (mode !== 'swim') {
      drawShadedLimb(sub, cx - 3, cy + 3, cx - 3 + legSwing, 29, 1.9, DINO_OCHRE);
      drawShadedLimb(sub, cx + 4, cy + 3, cx + 4 - legSwing, 29, 2.1, DINO_OCHRE);
    }
    drawShadedLimb(sub, cx - 8, cy, cx - 14, cy + 2, 1.5, DINO_OCHRE);
    sub.fillEllipse(cx - 16, cy + 2, 2.7, 1.6, (nx, ny) => pickTopLeftTone(nx, ny, DINO_OCHRE));
    sub.setPixel(cx - 19, cy + 2, DINO_OCHRE.shadow);
    sub.setPixel(cx - 16, cy + 1, '#261812');
  });

  if (mode === 'swim') clipToSwimUpperBody(buf, 20, 4, 43, frame);
  return finalizeEraCreatureAction(buf, frame, total, 23, 22, action);
}

export const ERA_DINOSAUR_MODELS: PixelModelDef[] = [
  {
    id: 'dino-pack-compy',
    name: 'Компсогнат (Стая)',
    subtitle: 'Стайный мелкий хищник (18×14)',
    kind: 'unit',
    tier: 'I',
    era: 'dinosaurs',
    faction: 'Лесной Круг',
    width: 18,
    height: 14,
    frameCount: 8,
    defaultFps: 12,
    attackName: 'Стайный выпад',
    unitMeta: {
      coreSize: '12×9 мелкий',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 8,
      supportsGenes: true,
    },
    layersSpec: ['1. Прыгучий корпус и хвост без контура', '2. Стайная полоса K1 и гребень гена'],
    description: 'Мелкий быстрый хищник эпохи динозавров (масштаб 6–16 px): подпрыгивает при беге, плавает только спиной и головой.',
    renderFrame: renderPackCompy,
    getAnchors: () => ({ head: { x: 3, y: 4, w: 4, h: 3 }, item: { x: 2, y: 6, w: 3, h: 3 }, pivot: { x: 9, y: 11 } }),
    codeSnippet: `function renderPackCompy(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(18, 14); }`,
  },
  {
    id: 'dino-feathered-raptor',
    name: 'Пернатый Раптор',
    subtitle: 'Стремительный охотник в оперении (34×26)',
    kind: 'unit',
    tier: 'II',
    era: 'dinosaurs',
    faction: 'Орда',
    width: 34,
    height: 26,
    frameCount: 12,
    defaultFps: 12,
    attackName: 'Прыжок серповидного когтя',
    unitMeta: {
      coreSize: '26×18 хищник',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 14,
      supportsGenes: true,
    },
    layersSpec: ['1. Мускулистое тело и серповидный коготь', '2. Перья крыльев и хвоста K1/K2 по генам'],
    description: 'Пернатый дромеозаврид с расписным веером хвоста и крыльев: охотится в прыжке, адаптирует длину оперения через гены.',
    renderFrame: renderFeatheredRaptor,
    getAnchors: () => ({ head: { x: 5, y: 5, w: 7, h: 5 }, item: { x: 3, y: 9, w: 5, h: 5 }, pivot: { x: 17, y: 23 } }),
    codeSnippet: `function renderFeatheredRaptor(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(34, 26); }`,
  },
  {
    id: 'dino-sauropod',
    name: 'Брахиозавр',
    subtitle: 'Длинношеий травоядный гигант (76×62)',
    kind: 'unit',
    tier: 'III',
    era: 'dinosaurs',
    faction: 'Цитадель',
    width: 76,
    height: 62,
    frameCount: 12,
    defaultFps: 8,
    attackName: 'Сотрясающий топот',
    unitMeta: {
      coreSize: '64×54 гигант',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 34,
      supportsGenes: true,
    },
    layersSpec: ['1. Колоннообразные ноги и длинный хвост', '2. Попона державы K1/K2 и высокая шея с гребнем'],
    description: 'Титанический длинношеий ящер (гигант 60–120 px): перекрашиваемая попона державы, сотрясающий удар передних ног и переходы по рекам.',
    renderFrame: renderSauropod,
    getAnchors: () => ({ head: { x: 11, y: 8, w: 9, h: 6 }, item: { x: 26, y: 48, w: 8, h: 8 }, pivot: { x: 38, y: 57 } }),
    codeSnippet: `function renderSauropod(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(76, 62); }`,
  },
  {
    id: 'dino-triceratops',
    name: 'Трицератопс',
    subtitle: 'Рогатый ящер с костяным щитом (44×30)',
    kind: 'unit',
    tier: 'II',
    era: 'dinosaurs',
    faction: 'Цитадель',
    width: 44,
    height: 30,
    frameCount: 12,
    defaultFps: 10,
    attackName: 'Таран тремя рогами',
    unitMeta: {
      coreSize: '34×22 крупный зверь',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 20,
      supportsGenes: true,
    },
    layersSpec: ['1. Мощный корпус и боевая попона K1', '2. Костяной воротник K2 и 3 рога (гены)'],
    description: 'Бронированный рогатый травоядный ящер с фестончатым щитом K1/K2 и таранным выпадом рогов.',
    renderFrame: renderTriceratops,
    getAnchors: () => ({ head: { x: 4, y: 8, w: 10, h: 9 }, item: { x: 1, y: 11, w: 6, h: 6 }, pivot: { x: 22, y: 26 } }),
    codeSnippet: `function renderTriceratops(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(44, 30); }`,
  },
  {
    id: 'dino-ankylosaurus',
    name: 'Анкилозавр',
    subtitle: 'Бронированный панцирный ящер (44×26)',
    kind: 'unit',
    tier: 'II',
    era: 'dinosaurs',
    faction: 'Бастион Мороза',
    width: 44,
    height: 26,
    frameCount: 12,
    defaultFps: 10,
    attackName: 'Удар костяной булавой',
    unitMeta: {
      coreSize: '34×18 крупный зверь',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 22,
      supportsGenes: true,
    },
    layersSpec: ['1. Шипастый щит-панцирь K1/K2', '2. Хвост с тяжёлой костяной булавой'],
    description: 'Живая крепость с низким остеодермальным панцирем и тяжёлым хвостом-булавой для круговых ударов.',
    renderFrame: renderAnkylosaurus,
    getAnchors: () => ({ head: { x: 4, y: 12, w: 7, h: 5 }, item: { x: 33, y: 11, w: 6, h: 6 }, pivot: { x: 20, y: 23 } }),
    codeSnippet: `function renderAnkylosaurus(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(44, 26); }`,
  },
  {
    id: 'dino-pteranodon',
    name: 'Птеранодон',
    subtitle: 'Летающий ящер (44×32)',
    kind: 'unit',
    tier: 'II',
    era: 'dinosaurs',
    faction: 'Гильдия',
    width: 44,
    height: 32,
    frameCount: 12,
    defaultFps: 12,
    attackName: 'Пикирующий удар клювом',
    unitMeta: {
      coreSize: '32×22 летун',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 16,
      supportsGenes: true,
    },
    layersSpec: ['1. Перепончатые крылья K1/K2 в 12-кадровом взмахе', '2. Острый клюв и затылочный гребень'],
    description: 'Размашистый летающий ящер с переливающимися перепонками крыльев и пикирующей атакой.',
    renderFrame: renderPteranodon,
    getAnchors: () => ({ head: { x: 10, y: 10, w: 9, h: 6 }, item: { x: 5, y: 12, w: 7, h: 4 }, pivot: { x: 22, y: 22 } }),
    codeSnippet: `function renderPteranodon(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(44, 32); }`,
  },
  {
    id: 'dino-plesiosaur',
    name: 'Плезиозавр',
    subtitle: 'Длинношеий морской ящер (52×36)',
    kind: 'aquatic',
    tier: 'II',
    era: 'dinosaurs',
    faction: 'Бастион Мороза',
    width: 52,
    height: 36,
    frameCount: 14,
    defaultFps: 12,
    attackName: 'Бросок длинной шеи из воды',
    unitMeta: {
      coreSize: '42×24 водный ящер',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 20,
      supportsGenes: true,
    },
    layersSpec: ['1. Выступающая над водой спина и волна WATER_LINE', '2. Гибкая лебединая шея с окраской K1/K2'],
    description: 'Морской ящер эпохи динозавров: при плавании видна лишь верхняя часть туловища, спинной гребень и длинная шея.',
    renderFrame: renderPlesiosaur,
    supportsShadow: false,
    noOutlineRequired: true,
    codeSnippet: `function renderPlesiosaur(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(52, 36); }`,
  },
  {
    id: 'dino-spinosaurus',
    name: 'Спинозавр',
    subtitle: 'Парусный гигантский хищник (68×48)',
    kind: 'unit',
    tier: 'III',
    era: 'dinosaurs',
    faction: 'Орда',
    width: 68,
    height: 48,
    frameCount: 14,
    defaultFps: 10,
    attackName: 'Разрывающий выпад когтей и челюстей',
    unitMeta: {
      coreSize: '58×40 гигант',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 28,
      supportsGenes: true,
    },
    layersSpec: ['1. Огромный спинной парус на маске K1/K2', '2. Удлинённая крокодилья пасть и сильные когти'],
    description: 'Полуводный парусный суперхищник: эффектно возвышается над водой огромным парусом державы и разрывает врага когтями.',
    renderFrame: renderSpinosaurus,
    getAnchors: () => ({ head: { x: 8, y: 14, w: 12, h: 7 }, item: { x: 6, y: 24, w: 7, h: 7 }, pivot: { x: 34, y: 44 } }),
    codeSnippet: `function renderSpinosaurus(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(68, 48); }`,
  },
  {
    id: 'dino-stegosaurus',
    name: 'Стегозавр',
    subtitle: 'Пластинчатый гигант с шипастым хвостом (48×32)',
    kind: 'unit',
    tier: 'II',
    era: 'dinosaurs',
    faction: 'Лесной Круг',
    width: 48,
    height: 32,
    frameCount: 12,
    defaultFps: 10,
    attackName: 'Размашистый удар тагомайзера',
    unitMeta: {
      coreSize: '38×24 крупный зверь',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 22,
      supportsGenes: true,
    },
    layersSpec: ['1. Два ряда ромбовидных пластин K1/K2', '2. Четыре костяных шипа на хвосте (гены)'],
    description: 'Древний травоядный гигант с высокими ромбовидными пластинами вдоль хребта и сокрушительным взмахом шипастого хвоста.',
    renderFrame: renderStegosaurus,
    getAnchors: () => ({ head: { x: 5, y: 17, w: 6, h: 5 }, item: { x: 36, y: 14, w: 7, h: 7 }, pivot: { x: 23, y: 29 } }),
    codeSnippet: `function renderStegosaurus(f: number, t: number, ctx?: RenderContextOptions) { return new PixelBuffer(48, 32); }`,
  },
];
