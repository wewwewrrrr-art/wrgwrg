import { MaterialRamp, RAMPS, VOID, WATER_LINE } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import { UnitAction } from '../engine/unitAssembler';
import { PixelModelDef, RenderContextOptions } from './types';

/**
 * ============================================================================
 * PREHISTORIC & MYTHICAL AQUATIC MONSTERS (12 ANIMATED MODELS + UNIQUE ATTACKS)
 * ============================================================================
 * Architectural Rules for Aquatic Sprites:
 * 1. WATERLINE & DEPTH: Animated 2-layer water surface (`WATER_LINE` + foam
 *    crests) with semi-transparent submerged wave tint (`#0B3B5C66`).
 * 2. UNDULATING SWIMMING: Spine segments, dorsal crests, flippers, and tails
 *    propagate a smooth sinusoidal wave `sin(t - x * freq)`.
 * 3. UNIQUE PROCEDURAL ATTACKS (`unitAction === 'attack'`): Every predator has
 *    a custom multi-phase attack state machine (windup -> strike -> splash/VFX),
 *    never a generic sprite rotation.
 * 4. NO GROUND SHADOW: `supportsShadow: false` & `noOutlineRequired: true` so
 *    water droplets, ink clouds, and plasma beams stay crisp without black smears.
 * ============================================================================
 */

function finalizeAquaticAction(
  sprite: PixelBuffer,
  frame: number,
  total: number,
  action: UnitAction
): PixelBuffer {
  const phase = frame / Math.max(1, total);
  const t = phase * Math.PI * 2;
  if (action === 'hit') {
    const flash = Math.abs(Math.sin(t));
    return sprite.applyColorOverlay(
      flash > 0.5 ? '#FFFFFF' : '#FF1212',
      0.55 + flash * 0.25
    );
  }
  if (action === 'death') {
    const rot = Math.min(72, phase * 150);
    const darken = Math.min(0.85, phase * 1.2);
    const alpha = Math.max(0.28, 1 - phase * 0.72);
    return sprite
      .rotateAround(Math.round(sprite.width / 2), Math.round(sprite.height * 0.65), rot)
      .applyColorOverlay('#090808', darken, alpha);
  }
  if (action === 'zombie') {
    return sprite.applyZombieTransform('#3B8130');
  }
  return sprite;
}

/**
 * Draws layered animated water ripples, foam crests, and submerged depth tint.
 */
function drawWaterSurface(
  buf: PixelBuffer,
  waterY: number,
  frame: number,
  total: number,
  tintHex = '#0C355477',
  crestColor: string = WATER_LINE.light,
  midColor: string = WATER_LINE.mid
): void {
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const cx = buf.width * 0.5;
  const halfSpan = Math.max(8, buf.width * 0.43);
  const maxDepth = Math.min(buf.height - 2 - waterY, 7);

  for (let x = 2; x < buf.width - 2; x++) {
    const nx = (x - cx) / halfSpan;
    if (Math.abs(nx) > 1.0) continue;
    const arch = Math.sqrt(Math.max(0, 1 - nx * nx));
    const waveY = waterY + Math.round(Math.sin(t + x * 0.32) * 1.0);
    const localDepth = Math.max(1, Math.round(arch * maxDepth));

    // Organic tapered underwater depth wake (no rectangular plaid wall)
    for (let dy = 1; dy <= localDepth; dy++) {
      const py = waveY + dy;
      if (py >= buf.height - 1) break;
      if (buf.getPixel(x, py) === null && (dy <= 2 || (x + dy + frame) % 2 === 0)) {
        buf.setPixel(x, py, tintHex);
      }
    }
    const isFoam = ((x + frame * 2) % 7) < 2;
    buf.setPixel(x, waveY, isFoam ? crestColor : midColor);
    if (isFoam && arch > 0.45 && waveY + 1 < buf.height - 1) {
      buf.setPixel(x, waveY + 1, RAMPS.ice.mid);
    }
  }
}

function drawSplashSpray(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  progress: number,
  count: number,
  colorA = '#FFFFFF',
  colorB: string = WATER_LINE.light
): void {
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI * 0.88 + (i / Math.max(1, count - 1)) * Math.PI * 0.76;
    const dist = 2 + progress * (7 + (i % 3) * 2.5);
    const sx = Math.round(cx + Math.cos(angle) * dist);
    const sy = Math.round(cy + Math.sin(angle) * dist + progress * progress * 5);
    buf.setPixel(sx, sy, i % 2 === 0 ? colorA : colorB);
  }
}

function drawBubbleTrail(
  buf: PixelBuffer,
  startX: number,
  startY: number,
  frame: number,
  total: number,
  spreadX = 10
): void {
  for (let i = 0; i < 4; i++) {
    const p = ((frame + i * 3) % total) / total;
    const bx = Math.round(startX + (i - 1.5) * (spreadX / 4) + Math.sin(p * Math.PI * 2 + i) * 1.5);
    const by = Math.round(startY - p * 9);
    buf.setPixel(bx, by, i % 2 === 0 ? '#FFFFFF' : RAMPS.ice.highlight);
  }
}

function shadeScale(
  nx: number,
  ny: number,
  px: number,
  py: number,
  ramp: MaterialRamp,
  seed = 1
): string {
  const scale = ((px * 3 + py * 5 + seed) & 7) === 0;
  if (ny > 0.48 || nx > 0.52) return ramp.deep;
  if (ny < -0.35 && nx < 0.25) return ramp.highlight;
  if (scale) return ramp.shadow;
  return ramp.mid;
}

/**
 * 1. Мозазавр (Mosasaurus) — 56x38, Tier III
 * Unique Attack: Jaw-Lunge Death Snap (hinged snapping jaw + shock spray)
 */
function renderMosasaurus(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(56, 38);
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const isAtk = action === 'attack';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;

  // Attack timing: 0..0.28 windup pull-back, 0.28..0.62 rapid forward snap, 0.62..1 recovery
  let lungeX = 0;
  let jawOpen = Math.sin(t) > 0.55 ? 2 : 1;
  let strikeFlash = 0;
  if (isAtk) {
    if (p < 0.28) {
      lungeX = Math.round((p / 0.28) * 4); // pull back right
      jawOpen = Math.round(2 + (p / 0.28) * 4);
    } else if (p < 0.58) {
      const k = (p - 0.28) / 0.3;
      lungeX = Math.round(4 - k * 10); // explosive lunge left!
      jawOpen = k < 0.5 ? 6 : 1;
      strikeFlash = k > 0.45 ? 1 - (k - 0.45) * 1.8 : 0;
    } else {
      const k = (p - 0.58) / 0.42;
      lungeX = Math.round(-6 * (1 - k));
      jawOpen = 1;
    }
  }

  const headX = 14 + lungeX;
  const bodyY = 20 + (isAtk && p >= 0.28 && p < 0.58 ? -2 : Math.round(Math.sin(t) * 1.0));

  // Layer 1: Undulating serpentine tail + vertical caudal fluke + rear paddle
  buf.layer((sub) => {
    for (let i = 0; i < 18; i++) {
      const tx = headX + 20 + i;
      const ty = bodyY + Math.round(Math.sin(t - i * 0.38) * (1.2 + i * 0.14));
      const thickness = Math.max(1.2, 4.2 - i * 0.17);
      sub.fillEllipse(tx, ty, 1.5, thickness, (nx, ny) =>
        ny < -0.25 ? RAMPS.pine.highlight : ny > 0.35 ? RAMPS.pine.deep : RAMPS.pine.mid
      );
      if (i % 3 === 0) {
        sub.setPixel(tx, Math.round(ty - thickness) - 1, RAMPS.bone.mid);
      }
    }
    // Sweeping paddle tail fin
    const tailEndX = headX + 37;
    const tailEndY = bodyY + Math.round(Math.sin(t - 6.5) * 3.5);
    sub.drawLine(tailEndX, tailEndY, tailEndX + 4, tailEndY - 5, RAMPS.magenta.mid, 2);
    sub.drawLine(tailEndX, tailEndY, tailEndX + 3, tailEndY + 4, RAMPS.pine.shadow, 2);
  });

  // Layer 2: Muscular armored torso + dorsal scutes + K1 ridge stripe
  buf.layer((sub) => {
    sub.fillEllipse(headX + 12, bodyY, 10.5, 5.8, (nx, ny, px, py) => {
      if (ny > 0.45) return RAMPS.birch.mid; // pale belly
      if (Math.abs(ny + 0.1) < 0.16) return RAMPS.magenta.mid; // K1 flank band
      return shadeScale(nx, ny, px, py, RAMPS.pine, 2);
    });
    // Dorsal crest ridges
    for (let sx = headX + 5; sx <= headX + 20; sx += 3) {
      sub.fillRect(sx, bodyY - 7, 2, 2, RAMPS.bone.highlight);
    }
    // Fore & hind hydrofoil flippers
    const stroke = Math.round(Math.sin(t) * 2.2);
    sub.drawLine(headX + 8, bodyY + 3, headX + 12, bodyY + 8 + stroke, RAMPS.pine.shadow, 3);
    sub.drawLine(headX + 9, bodyY + 5, headX + 12, bodyY + 8 + stroke, RAMPS.cyanMask.mid, 1);
    sub.drawLine(headX + 19, bodyY + 3, headX + 22, bodyY + 7 - stroke, RAMPS.pine.deep, 2);
  });

  // Layer 3: Sculpted elongated Mosasaur skull & hinged snapping jaws
  buf.layer((sub) => {
    // Upper snout facing LEFT
    sub.fillEllipse(headX - 1, bodyY - 2, 7.5, 3.2, (nx, ny, px, py) =>
      shadeScale(nx, ny, px, py, RAMPS.pine, 5)
    );
    // Fierce K2 glowing eye + brow ridge
    sub.fillRect(headX + 1, bodyY - 4, 3, 1, RAMPS.bone.highlight);
    sub.fillRect(headX + 1, bodyY - 3, 2, 2, RAMPS.cyanMask.highlight);
    // Lower hinged jaw
    sub.drawLine(headX + 5, bodyY + 1, headX - 7, bodyY + 1 + jawOpen, RAMPS.pine.shadow, 2);
    // Interlocking conical ivory teeth
    for (let tx = headX - 6; tx <= headX + 1; tx += 2) {
      sub.setPixel(tx, bodyY + 1, '#FFFFFF');
      sub.setPixel(tx + 1, bodyY + jawOpen, RAMPS.bone.highlight);
    }
  });

  drawWaterSurface(buf, 26, frame, total);
  drawBubbleTrail(buf, headX + 28, 22, frame, total, 14);

  if (strikeFlash > 0) {
    drawSplashSpray(buf, headX - 6, bodyY + 2, 1 - strikeFlash, 8, '#FFFFFF', RAMPS.cyanMask.highlight);
    buf.drawLine(headX - 10, bodyY - 2, headX - 7, bodyY + 5, '#FFFFFF', 1);
  }

  return finalizeAquaticAction(buf, frame, total, action);
}

/**
 * 2. Бездонный Левиафан (Abyssal Leviathan) — 58x42, Tier III
 * Unique Attack: Abyssal Tidal Surge / Plasma Breath (coils up + beam blast)
 */
function renderLeviathan(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(58, 42);
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const isAtk = action === 'attack';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;

  const coilAmp = isAtk ? (p < 0.35 ? 2.5 : 4.2) : 2.2;
  const firing = isAtk && p >= 0.35 && p <= 0.85;
  const charging = isAtk && p < 0.35;

  // Sinuous abyssal sea-dragon body coils piercing the water
  buf.layer((sub) => {
    for (let i = 0; i < 36; i++) {
      const x = 15 + i;
      const crest = Math.sin(t - i * 0.26) * coilAmp;
      const y = Math.round(25 + crest + (i > 24 ? (i - 24) * 0.35 : 0));
      const r = Math.max(1.5, 4.4 - i * 0.08);
      sub.fillEllipse(x, y, 1.4, r, (nx, ny) => {
        if (Math.abs(ny) < 0.25 && i % 4 === 0) return RAMPS.cyanMask.highlight; // glowing K2 runes
        if (ny > 0.35) return RAMPS.obsidian.deep;
        if (ny < -0.3) return RAMPS.ice.mid;
        return RAMPS.obsidian.mid;
      });
      // Bioluminescent K1 dorsal fin spines
      if (i % 3 === 1 && y < 29) {
        const spineH = i < 20 ? 4 : 3;
        sub.drawLine(x, Math.round(y - r), x + 1, Math.round(y - r - spineH), RAMPS.magenta.highlight, 1);
      }
    }
    // Crowned sea-serpent head rising on left
    const hy = Math.round(16 + Math.sin(t) * 2 + (isAtk ? -3 : 0));
    const hx = isAtk && firing ? 12 : 14;
    sub.fillEllipse(hx, hy, 6.5, 4.5, (nx, ny) =>
      ny < -0.25 ? RAMPS.ice.highlight : nx > 0.3 ? RAMPS.obsidian.deep : RAMPS.obsidian.mid
    );
    // Swept abyssal horns & glowing whiskers
    sub.drawLine(hx + 2, hy - 3, hx + 8, hy - 8, RAMPS.magenta.highlight, 2);
    sub.drawLine(hx - 2, hy - 4, hx + 3, hy - 8, RAMPS.bone.highlight, 1);
    sub.drawLine(hx - 5, hy + 2, hx - 9, hy + 5 + Math.round(Math.sin(t) * 2), RAMPS.cyanMask.highlight, 1);
    // Eye + glowing maw
    sub.fillRect(hx - 2, hy - 2, 2, 2, RAMPS.gold.highlight);
    if (isAtk) {
      sub.fillRect(hx - 6, hy, 4, 3, VOID);
      sub.setPixel(hx - 5, hy + 1, RAMPS.cyanMask.highlight);
    }
  });

  drawWaterSurface(buf, 27, frame, total, '#08263D88');

  if (charging) {
    const r = 1.5 + (p / 0.35) * 2.5;
    buf.fillEllipse(8, 14, r, r, RAMPS.cyanMask.highlight);
    buf.setPixel(8, 14, '#FFFFFF');
  } else if (firing) {
    // Surging abyssal plasma tide blasting left
    const beamProg = (p - 0.35) / 0.5;
    const len = Math.round(8 + Math.sin(beamProg * Math.PI) * 6);
    for (let bx = 1; bx <= len; bx++) {
      const by = 14 + Math.round(Math.sin(t * 2 + bx * 0.6) * 1.4);
      buf.fillRect(bx, by - 1, 1, 3, RAMPS.cyanMask.highlight);
      buf.setPixel(bx, by, '#FFFFFF');
    }
    drawSplashSpray(buf, 4, 24, beamProg, 7, '#FFFFFF', RAMPS.cyanMask.highlight);
  }

  return finalizeAquaticAction(buf, frame, total, action);
}

/**
 * 3. Кракен Глубин (Giant Kraken) — 54x48, Tier III
 * Unique Attack: Tentacle Slam & Ink Vortex (rears tentacles up -> slams water + ink burst)
 */
function renderKraken(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(54, 48);
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const isAtk = action === 'attack';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;

  const mantlePulse = Math.sin(t * 2) * 1.2;
  const slamPhase = isAtk ? (p < 0.38 ? -p / 0.38 : p < 0.65 ? (p - 0.38) / 0.27 : 1 - (p - 0.65) / 0.35) : 0;

  // Back tentacles (coiled behind mantle)
  buf.layer((sub) => {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 14; i++) {
        const u = i / 13;
        const lift = isAtk ? (slamPhase < 0 ? slamPhase * 10 : slamPhase * 6) : Math.sin(t + side) * 2.5;
        const tx = Math.round(27 + side * (8 + u * 12 + Math.sin(t + i * 0.4) * 2.2));
        const ty = Math.round(31 - u * 16 + lift + u * u * 5);
        sub.fillEllipse(tx, ty, 1.8 - u * 0.7, 1.8 - u * 0.7, (nx, ny) =>
          ny < 0 ? RAMPS.magenta.shadow : RAMPS.magenta.deep
        );
      }
    }
  });

  // Domed pulsing squid mantle + fin ears + fierce golden eyes
  buf.layer((sub) => {
    const my = 20 + Math.round(mantlePulse * 0.8 + (isAtk && slamPhase > 0.2 ? 2 : 0));
    // Side mantle fins
    sub.fillEllipse(19, my - 6, 4.5, 2.5, RAMPS.magenta.mid);
    sub.fillEllipse(35, my - 6, 4.5, 2.5, RAMPS.magenta.shadow);
    // Main bulbous cephalopod hood
    sub.fillEllipse(27, my, 8.5 + mantlePulse * 0.4, 10.5, (nx, ny, px, py) => {
      const spot = ((px * 5 + py * 3) & 7) === 0;
      if (spot) return RAMPS.cyanMask.highlight; // glowing chromatophore spots
      if (nx < -0.3 && ny < 0.1) return RAMPS.magenta.highlight;
      if (nx > 0.35 || ny > 0.45) return RAMPS.magenta.deep;
      return RAMPS.magenta.mid;
    });
    // Brow collar + fierce twin eyes
    sub.fillRect(22, my + 6, 3, 2, RAMPS.gold.highlight);
    sub.fillRect(29, my + 6, 3, 2, RAMPS.gold.highlight);
    sub.setPixel(23, my + 6, VOID);
    sub.setPixel(30, my + 6, VOID);
  });

  // 4 foreground writhing suction-cupped tentacles
  buf.layer((sub) => {
    const anchors = [-11, -5, 5, 11];
    anchors.forEach((ax, idx) => {
      for (let i = 0; i < 15; i++) {
        const u = i / 14;
        const wave = Math.sin(t + idx * 1.4 - u * 3.2) * 3.0;
        const slamY = isAtk ? (slamPhase < 0 ? slamPhase * 11 * u : slamPhase * 7 * u) : 0;
        const tx = Math.round(27 + ax * (1 + u * 0.65) + wave);
        const ty = Math.round(30 - Math.sin(u * Math.PI) * 10 + slamY + u * 4);
        const r = Math.max(1.1, 2.4 - u * 1.2);
        sub.fillEllipse(tx, ty, r, r, (nx, ny) =>
          i % 3 === 0 && ny > 0 ? RAMPS.bone.highlight : nx < 0 ? RAMPS.magenta.highlight : RAMPS.magenta.mid
        );
      }
    });
  });

  drawWaterSurface(buf, 34, frame, total, '#12132988');

  // Feathered abyssal indigo ink cloud & dual geyser bursts during Tentacle Slam
  if (isAtk && p >= 0.42 && p <= 0.92) {
    const k = (p - 0.42) / 0.5;
    const inkRx = Math.max(2, 14 * Math.sin(k * Math.PI));
    buf.fillEllipse(27, 35, inkRx, 3.6, (nx, ny) => {
      const d = nx * nx + ny * ny;
      if (d <= 0.35) return '#0A2038B8';
      if (d <= 0.68) return '#0D29457A';
      return '#1337593D';
    });
    drawSplashSpray(buf, 14, 34, k, 6, '#FFFFFF', WATER_LINE.light);
    drawSplashSpray(buf, 40, 34, k, 6, '#FFFFFF', WATER_LINE.light);
  }

  return finalizeAquaticAction(buf, frame, total, action);
}

/**
 * 4. Лиоплевродон (Liopleurodon) — 54x38, Tier II
 * Unique Attack: Hydro-Flipper Rip-Tide Snap (4-flipper burst thrust + V bow spray)
 */
function renderLiopleurodon(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(54, 38);
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const isAtk = action === 'attack';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;

  const thrust = isAtk ? (p < 0.3 ? Math.round((p / 0.3) * 3) : p < 0.65 ? -5 : -Math.round((1 - (p - 0.65) / 0.35) * 5)) : 0;
  const cx = 29 + thrust;
  const cy = 21 + Math.round(Math.sin(t) * 0.9);
  const flap = Math.round(Math.sin(t * (isAtk ? 2 : 1)) * 3.5);
  const jawDrop = isAtk && p > 0.2 && p < 0.6 ? 4 : 1;

  // Far flippers
  buf.layer((sub) => {
    sub.drawRotatedRect(cx - 4, cy + 1, 9, 2.2, 2.1 + flap * 0.14, () => RAMPS.obsidian.deep);
    sub.drawRotatedRect(cx + 8, cy + 1, 8, 2.0, 2.0 - flap * 0.14, () => RAMPS.obsidian.deep);
  });

  // Heavy barrel pliosaur body + short wedge tail + scarred snout
  buf.layer((sub) => {
    // Muscular barrel torso
    sub.fillEllipse(cx + 2, cy, 13, 6.5, (nx, ny, px, py) => {
      if (ny > 0.42) return RAMPS.birch.mid;
      if (Math.abs(nx + 0.1) < 0.18 && ny < 0.2) return RAMPS.magenta.mid; // K1 war stripe
      return shadeScale(nx, ny, px, py, RAMPS.slate, 4);
    });
    // Short wedge pliosaur tail
    sub.drawLine(cx + 13, cy, cx + 21, cy + Math.round(Math.sin(t) * 2), RAMPS.slate.shadow, 3);
    // Massive triangular pliosaur head
    sub.fillEllipse(cx - 12, cy - 1, 8, 3.6, (nx, ny, px, py) =>
      shadeScale(nx, ny, px, py, RAMPS.slate, 9)
    );
    sub.fillRect(cx - 11, cy - 3, 2, 2, RAMPS.gold.highlight); // Amber predator eye
    // Hinged lower jaw + sharp fang teeth
    sub.drawLine(cx - 7, cy + 2, cx - 19, cy + 2 + jawDrop, RAMPS.slate.deep, 2);
    for (let tx = cx - 18; tx <= cx - 10; tx += 2) {
      sub.setPixel(tx, cy + 2, '#FFFFFF');
      sub.setPixel(tx + 1, cy + 1 + jawDrop, RAMPS.bone.highlight);
    }
  });

  // Near muscular hydrofoil paddles with K2 trim
  buf.layer((sub) => {
    sub.drawRotatedRect(cx - 2, cy + 3, 10, 2.5, 1.35 + flap * 0.18, (u) =>
      u > 0.7 ? RAMPS.cyanMask.mid : RAMPS.slate.highlight
    );
    sub.drawRotatedRect(cx + 9, cy + 3, 9, 2.3, 1.45 - flap * 0.18, (u) =>
      u > 0.7 ? RAMPS.cyanMask.mid : RAMPS.slate.mid
    );
  });

  drawWaterSurface(buf, 25, frame, total);
  drawBubbleTrail(buf, cx + 18, 23, frame, total, 10);

  if (isAtk && p >= 0.3 && p <= 0.8) {
    drawSplashSpray(buf, cx - 17, cy + 2, (p - 0.3) / 0.5, 8, '#FFFFFF', WATER_LINE.light);
  }

  return finalizeAquaticAction(buf, frame, total, action);
}

/**
 * 5. Ксифактин (Xiphactinus) — 50x34, Tier I
 * Unique Attack: Arrow-Dart Breach & Fang Snap (leaps out of waves in diagonal arc)
 */
function renderXiphactinus(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(50, 34);
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const isAtk = action === 'attack';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;

  const breachArc = isAtk ? Math.sin(p * Math.PI) : 0;
  const fx = 25 + (isAtk ? Math.round(2 - breachArc * 6) : 0);
  const fy = Math.round(20 - breachArc * 9 + Math.sin(t) * 1.1);
  const tailWag = Math.round(Math.sin(t * 2) * 2.5);
  const finFlutter = Math.round(Math.cos(t * 2) * 1.2);

  // Layer 1: Deeply forked predatory mackerel tail + upper/lower ray finlets
  buf.layer((sub) => {
    // Muscular caudal peduncle
    sub.fillEllipse(fx + 10, fy, 4.5, 2.4, (nx, ny) =>
      ny < -0.2 ? RAMPS.obsidian.highlight : ny > 0.35 ? RAMPS.ice.shadow : RAMPS.ice.mid
    );
    // Upper & lower forked crescent tail lobes with bony fin rays
    for (let i = 0; i < 7; i++) {
      const u = i / 6;
      const tx = fx + 13 + i;
      const uy = Math.round(fy - 1 - u * 6 + tailWag * (0.4 + u * 0.6));
      const ly = Math.round(fy + 1 + u * 6 + tailWag * (0.4 + u * 0.6));
      sub.fillEllipse(tx, uy, 1.3, 1.4 - u * 0.6, (nx, ny) =>
        ny < 0 ? RAMPS.obsidian.highlight : RAMPS.ice.mid
      );
      sub.fillEllipse(tx, ly, 1.3, 1.4 - u * 0.6, (nx, ny) =>
        ny < 0 ? RAMPS.ice.mid : RAMPS.ice.deep
      );
    }
    // Trailing dorsal & anal finlets (K1 bioluminescent fin streaks)
    sub.drawLine(fx + 4, fy - 4, fx + 9, fy - 10 + finFlutter, RAMPS.magenta.mid, 2);
    sub.drawLine(fx + 5, fy - 5, fx + 9, fy - 10 + finFlutter, RAMPS.magenta.highlight, 1);
    sub.drawLine(fx + 5, fy + 3, fx + 8, fy + 7 - finFlutter, RAMPS.ice.shadow, 2);
  });

  // Layer 2: Sleek streamlined torpedo fuselage with pelagic countershading, lateral line & scale facets
  buf.layer((sub) => {
    sub.fillEllipse(fx, fy, 12.2, 4.8, (nx, ny, px, py) => {
      const dist = Math.hypot(nx * 0.9, ny * 0.9);
      const scale = ((px * 3 + py * 5) & 7) === 0;
      const latLine = Math.abs(ny + 0.08 + Math.sin(nx * 2) * 0.04) < 0.11;
      if (ny < -0.45) return nx < 0.2 ? RAMPS.obsidian.highlight : RAMPS.obsidian.deep;
      if (ny < -0.15) return scale ? RAMPS.obsidian.mid : RAMPS.ice.deep;
      if (latLine) return RAMPS.cyanMask.highlight;
      if (ny > 0.42 || dist < 0.38) return '#E8F2F8';
      return scale ? RAMPS.ice.shadow : RAMPS.ice.mid;
    });

    // Articulated spiky pectoral hydrofoil fin
    sub.drawLine(fx - 3, fy + 2, fx + 2, fy + 7 + finFlutter, RAMPS.ice.highlight, 2);
    sub.drawLine(fx - 2, fy + 3, fx + 1, fy + 7 + finFlutter, RAMPS.ice.shadow, 1);
    // Secondary ventral fin
    sub.drawLine(fx + 2, fy + 4, fx + 5, fy + 7, RAMPS.ice.mid, 1);
  });

  // Layer 3: Sculpted gill opercle plate, gleaming predator eye & upturned bulldog fang-jaw
  buf.layer((sub) => {
    // Curved bony gill opercle & rib crease
    sub.fillEllipse(fx - 5, fy, 2.2, 3.6, (nx, ny) =>
      nx > 0.2 ? RAMPS.ice.deep : ny < -0.2 ? RAMPS.ice.highlight : RAMPS.ice.mid
    );
    // Heavy predatory skull crest
    sub.fillEllipse(fx - 10, fy - 1, 4.5, 3.0, (nx, ny) =>
      ny < -0.25 ? RAMPS.obsidian.highlight : ny > 0.2 ? RAMPS.ice.mid : RAMPS.ice.shadow
    );
    // Sculpted socket & gleaming golden-amber eye
    sub.fillRect(fx - 11, fy - 2, 2, 2, RAMPS.gold.highlight);
    sub.setPixel(fx - 11, fy - 2, VOID);

    // Upturned pugnacious bulldog mandible with interlocking white needle fangs
    const mouthOpen = isAtk && breachArc > 0.25 ? 4 : 1;
    if (mouthOpen > 1) {
      sub.fillEllipse(fx - 12, fy + 1, 3.0, mouthOpen * 0.55, RAMPS.lava.deep);
    }
    sub.drawLine(fx - 8, fy + 2, fx - 16, fy - 1 + mouthOpen, RAMPS.ice.highlight, 2);
    sub.drawLine(fx - 9, fy + 3, fx - 15, fy + mouthOpen, RAMPS.ice.shadow, 1);
    for (let i = 0; i < 4; i++) {
      const tx = fx - 15 + i * 2;
      sub.setPixel(tx, fy, '#FFFFFF');
      sub.setPixel(tx, fy + Math.max(1, mouthOpen - 1), RAMPS.bone.highlight);
    }
  });

  drawWaterSurface(buf, 22, frame, total);
  drawBubbleTrail(buf, fx + 14, 21, frame, total, 8);

  if (isAtk && p > 0.15 && p < 0.85) {
    drawSplashSpray(buf, fx - 8, 22, p, 8, '#FFFFFF', WATER_LINE.light);
  }

  return finalizeAquaticAction(buf, frame, total, action);
}

/**
 * 6. Дунклеостей (Dunkleosteus) — 52x36, Tier II
 * Unique Attack: Bone-Shear Guillotine Crunch (armored head hinges up, bone blades snap with sparks)
 */
function renderDunkleosteus(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(52, 36);
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const isAtk = action === 'attack';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;

  let headLift = 0;
  let jawSnap = 0;
  let impactSpark = false;
  if (isAtk) {
    if (p < 0.4) {
      headLift = Math.round((p / 0.4) * 4);
      jawSnap = Math.round((p / 0.4) * 3);
    } else if (p < 0.62) {
      headLift = 0;
      jawSnap = 0;
      impactSpark = true;
    } else {
      headLift = 0;
      jawSnap = 1;
    }
  } else {
    jawSnap = Math.sin(t) > 0.4 ? 1 : 0;
  }

  const cy = 20 + Math.round(Math.sin(t) * 0.8);

  // Layer 1: Muscular scaleless Devonian trunk + heterocercal asymmetric shark tail
  buf.layer((sub) => {
    for (let i = 0; i < 16; i++) {
      const tx = 28 + i;
      const ty = cy + Math.round(Math.sin(t - i * 0.34) * (1.2 + i * 0.13));
      const r = Math.max(1.2, 4.3 - i * 0.18);
      sub.fillEllipse(tx, ty, 1.4, r, (nx, ny) => {
        if (Math.abs(ny) < 0.18 && i % 3 === 0) return RAMPS.cyanMask.mid; // lateral sensory line
        if (ny > 0.42) return RAMPS.timber.deep;
        if (ny < -0.28) return RAMPS.autumn.highlight;
        return RAMPS.autumn.mid;
      });
    }
    // Swept dorsal trunk fin (K1 membrane) + asymmetric upper/lower heterocercal tail lobes
    sub.drawLine(32, cy - 3, 36, cy - 8, RAMPS.magenta.mid, 2);
    sub.setPixel(35, cy - 8, RAMPS.magenta.highlight);
    const tailTipY = cy + Math.round(Math.sin(t - 5) * 2.4);
    sub.drawLine(42, cy, 48, tailTipY - 7, RAMPS.autumn.highlight, 2);
    sub.drawLine(43, cy + 1, 47, tailTipY - 5, RAMPS.magenta.mid, 1);
    sub.drawLine(42, cy + 1, 45, tailTipY + 4, RAMPS.timber.deep, 2);
  });

  // Layer 2: Multi-plate hinged thoracic placoderm armor belt & pectoral paddle
  buf.layer((sub) => {
    // Broad armored pectoral paddle beneath thoracic belt
    const finSwing = Math.round(Math.sin(t) * 1.6);
    sub.drawLine(25, cy + 4, 30, cy + 9 + finSwing, RAMPS.autumn.shadow, 3);
    sub.drawLine(26, cy + 5, 29, cy + 8 + finSwing, RAMPS.bone.mid, 1);

    // Sculpted thoracic bony cuirass with diagonal suture seam & beveled plate edges
    sub.fillEllipse(24, cy, 7.6, 6.0, (nx, ny, px, py) => {
      const suture = Math.abs(nx * 5 + ny * 3 - 0.6) < 0.32 || Math.abs(ny + 0.25) < 0.12;
      const rivet = (px + py) % 7 === 0 && ny < 0.15;
      if (suture) return RAMPS.bone.deep;
      if (rivet) return RAMPS.gold.highlight;
      if (ny < -0.35 && nx < 0.25) return RAMPS.bone.highlight;
      if (ny > 0.38 || nx > 0.45) return RAMPS.bone.deep;
      return RAMPS.bone.mid;
    });
    // Dorsal median bone ridge crest
    sub.drawLine(20, cy - 6, 28, cy - 5, RAMPS.bone.highlight, 1);
  });

  // Layer 3: Hinged Devonian cranial shield, orbital bone ring & self-sharpening guillotine blades
  buf.layer((sub) => {
    // Deep buccal cavity behind bone jaw shears
    if (jawSnap > 0 || headLift > 0) {
      sub.fillEllipse(13, cy + 1, 4.2, 2.2 + jawSnap * 0.4, RAMPS.lava.deep);
    }

    // Heavy lower jawbone shear plate
    sub.fillEllipse(14, cy + 3 + Math.round(jawSnap * 0.7), 5.8, 2.2, (nx, ny) =>
      ny < -0.1 ? RAMPS.bone.highlight : ny > 0.35 ? RAMPS.bone.deep : RAMPS.bone.mid
    );
    // Razor lower bone fang tusk & serrated shear edge
    sub.drawLine(9, cy + 2 + jawSnap, 17, cy + 2 + Math.round(jawSnap * 0.4), '#FFFFFF', 1);

    // Sculpted hinged upper cranial shield with orbital cheek ridge & K2 war glyph
    sub.fillEllipse(15, cy - 2 - headLift, 7.2, 4.4, (nx, ny) => {
      const cheekSeam = Math.abs(nx + 0.15 - ny * 0.5) < 0.16;
      if (cheekSeam) return RAMPS.bone.deep;
      if (ny < -0.32 && nx < 0.2) return RAMPS.bone.highlight;
      if (ny > 0.36 || nx > 0.42) return RAMPS.bone.shadow;
      return RAMPS.bone.mid;
    });
    // Bony orbital ring & glowing crimson-amber Devonian eye
    sub.fillEllipse(13, cy - 3 - headLift, 2.1, 2.1, RAMPS.bone.highlight);
    sub.fillRect(12, cy - 4 - headLift, 2, 2, RAMPS.lava.highlight);
    sub.setPixel(12, cy - 4 - headLift, VOID);
    // K2 ceremonial notch on cheek shield
    sub.fillRect(19, cy - 3 - headLift, 2, 2, RAMPS.cyanMask.highlight);

    // Upper bone guillotine fang plates
    sub.drawLine(8, cy + 1 - headLift, 16, cy + 1 - headLift, '#FFFFFF', 1);
    sub.setPixel(9, cy + 2 - headLift, '#FFFFFF');
  });

  drawWaterSurface(buf, 25, frame, total, '#1C223077');
  drawBubbleTrail(buf, 34, 22, frame, total, 8);

  if (impactSpark) {
    buf.fillEllipse(9, cy + 1, 3, 3, '#FFFFFF');
    buf.drawLine(5, cy - 2, 13, cy + 4, RAMPS.gold.highlight, 1);
    buf.drawLine(5, cy + 4, 13, cy - 2, RAMPS.gold.highlight, 1);
    drawSplashSpray(buf, 9, 25, 0.5, 6, '#FFFFFF', WATER_LINE.light);
  }

  return finalizeAquaticAction(buf, frame, total, action);
}

/**
 * 7. Левиафан Мелвилла / Мальвела (Livyatan melvillei) — 56x40, Tier III
 * Unique Attack: Spermaceti Headbutt & Tidal Breach (massive blunt brow smash)
 */
function renderLivyatan(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(56, 40);
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const isAtk = action === 'attack';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;

  let ramX = 0;
  let liftY = Math.round(Math.sin(t) * 1.0);
  let breachSmash = false;
  if (isAtk) {
    if (p < 0.35) {
      ramX = 3;
      liftY = -Math.round((p / 0.35) * 6);
    } else if (p < 0.65) {
      ramX = -5;
      liftY = Math.round(((p - 0.35) / 0.3) * 5) - 3;
      breachSmash = true;
    } else {
      ramX = Math.round(-5 * (1 - (p - 0.65) / 0.35));
    }
  }

  const cx = 27 + ramX;
  const cy = 21 + liftY;

  buf.layer((sub) => {
    // Sweeping horizontal whale tail fluke
    const flukeY = cy + Math.round(Math.sin(t - 1.5) * 3);
    sub.drawLine(cx + 12, cy, cx + 22, flukeY, RAMPS.slate.shadow, 3);
    sub.fillEllipse(cx + 22, flukeY, 2.5, 4.5, RAMPS.obsidian.mid);

    // Colossal scarred whale torso + K1 battle markings
    sub.fillEllipse(cx + 2, cy, 13, 6.5, (nx, ny, px, py) => {
      if (ny > 0.45) return RAMPS.marble.mid;
      if ((px * 2 + py) % 11 === 0) return RAMPS.marble.highlight; // battle scars
      if (Math.abs(ny + 0.15) < 0.15) return RAMPS.magenta.mid; // K1 flank band
      return ny < -0.3 ? RAMPS.slate.highlight : RAMPS.slate.mid;
    });

    // Iconic massive square blunt spermaceti battering brow
    sub.fillRect(cx - 16, cy - 6, 12, 8, RAMPS.slate.mid);
    sub.fillRect(cx - 16, cy - 6, 12, 2, RAMPS.slate.highlight);
    sub.fillRect(cx - 16, cy - 6, 2, 7, RAMPS.bone.highlight); // reinforced ramming brow!
    sub.fillRect(cx - 8, cy - 3, 2, 2, RAMPS.gold.highlight); // fierce eye

    // Huge conical teeth in lower jaw
    const jawY = cy + (isAtk && p < 0.5 ? 5 : 2);
    sub.drawLine(cx - 6, cy + 2, cx - 15, jawY, RAMPS.marble.shadow, 2);
    for (let tx = cx - 15; tx <= cx - 8; tx += 2) {
      sub.setPixel(tx, jawY - 1, '#FFFFFF');
    }
    // Pectoral flipper
    sub.drawLine(cx - 1, cy + 4, cx + 3, cy + 9, RAMPS.slate.deep, 3);
  });

  drawWaterSurface(buf, 26, frame, total);
  drawBubbleTrail(buf, cx + 16, 22, frame, total, 10);

  if (breachSmash) {
    // Towering vertical tidal wall & seismic foam shockwave
    for (let wy = 10; wy <= 28; wy += 2) {
      buf.fillRect(cx - 19, wy, 3, 2, wy < 16 ? '#FFFFFF' : WATER_LINE.light);
    }
    drawSplashSpray(buf, cx - 17, 25, (p - 0.35) / 0.3, 9, '#FFFFFF', WATER_LINE.light);
  }

  return finalizeAquaticAction(buf, frame, total, action);
}

/**
 * 8. Базилозавр / Базиловар (Basilosaurus) — 58x34, Tier II
 * Unique Attack: Serpentine Whip-Coil & Spine Lash (coils tight -> snaps out with tail smash)
 */
function renderBasilosaurus(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(58, 34);
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const isAtk = action === 'attack';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;

  const whipMode = isAtk && p >= 0.32 && p <= 0.75;
  const coilAmp = isAtk ? (p < 0.32 ? 4.2 : 2.8) : 2.6;
  const headX = isAtk ? (p < 0.32 ? 15 : whipMode ? 7 : 12) : 12;

  buf.layer((sub) => {
    // 32-segment elongated undulating archaeocete body
    for (let i = 0; i < 34; i++) {
      const compress = isAtk && p < 0.32 ? 0.8 : 1;
      const sx = Math.round(headX + 5 + i * compress);
      const wave = Math.sin(t - i * 0.3) * coilAmp;
      const sy = Math.round(20 + wave);
      const r = Math.max(1.2, 3.6 - i * 0.06);
      sub.fillEllipse(sx, sy, 1.3, r, (nx, ny) => {
        if (ny > 0.4) return RAMPS.sandstone.highlight;
        if (i % 5 === 0 && ny < 0.1) return RAMPS.magenta.mid;
        return ny < -0.25 ? RAMPS.copper.highlight : RAMPS.copper.mid;
      });
    }
    // Tail fluke at end
    const tailY = Math.round(20 + Math.sin(t - 10) * coilAmp);
    sub.drawLine(headX + 36, tailY, headX + 41, tailY - 4, RAMPS.copper.shadow, 2);
    sub.drawLine(headX + 36, tailY, headX + 41, tailY + 4, RAMPS.copper.deep, 2);

    // Narrow elongated whale skull with serrated teeth
    const hy = Math.round(18 + Math.sin(t) * 1.6);
    sub.fillEllipse(headX, hy, 6.5, 2.8, (nx, ny) =>
      ny < -0.2 ? RAMPS.copper.highlight : RAMPS.copper.mid
    );
    sub.setPixel(headX + 1, hy - 1, RAMPS.cyanMask.highlight);
    const open = isAtk && whipMode ? 3 : 1;
    sub.drawLine(headX + 3, hy + 2, headX - 6, hy + 2 + open, RAMPS.sandstone.mid, 1);
    for (let tx = headX - 5; tx <= headX; tx += 2) {
      sub.setPixel(tx, hy + 1, '#FFFFFF');
    }
  });

  drawWaterSurface(buf, 22, frame, total);
  drawBubbleTrail(buf, headX + 28, 20, frame, total, 12);

  if (whipMode) {
    drawSplashSpray(buf, headX - 4, 21, (p - 0.32) / 0.43, 8, '#FFFFFF', RAMPS.cyanMask.highlight);
  }

  return finalizeAquaticAction(buf, frame, total, action);
}

/**
 * 9. Мегалодон (Megalodon) — 56x40, Tier III
 * Unique Attack: Breach-Jaws Fin-Slash & Frenzy (rises vertically with cavernous snapping jaws)
 */
function renderMegalodon(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(56, 40);
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const isAtk = action === 'attack';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;

  const breach = isAtk ? Math.sin(p * Math.PI) : 0;
  const cx = 27 + (isAtk ? Math.round(-breach * 4) : 0);
  const cy = Math.round(23 - breach * 9 + Math.sin(t) * 0.8);
  const jawOpen = isAtk && breach > 0.25 ? Math.round(breach * 6) : 1;

  buf.layer((sub) => {
    // Sweeping crescent shark tail fin (tapered lobes)
    const wag = Math.round(Math.sin(t) * 2.2);
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      const tx = cx + 11 + i;
      const topY = Math.round(cy - u * 9 + wag * u);
      const thick = Math.max(0, Math.round((1 - u) * 2.2));
      for (let dy = -thick; dy <= 1; dy++) {
        sub.setPixel(tx, topY + dy, dy < 0 ? RAMPS.slate.highlight : RAMPS.slate.shadow);
      }
      if (i <= 7) {
        const botY = Math.round(cy + 1 + (i / 7) * 6 + wag * u);
        sub.setPixel(tx, botY, RAMPS.slate.deep);
        sub.setPixel(tx - 1, botY, RAMPS.slate.shadow);
      }
    }

    // Sculpted swept dorsal fin + K1/K2 war stripe & notch
    for (let dy = 0; dy < 10; dy++) {
      const u = dy / 9;
      const span = Math.max(1, Math.round((1 - u) * 4.5));
      const fy = cy - 5 - dy;
      const fx = cx + Math.round(u * 4);
      for (let dx = -1; dx <= span; dx++) {
        const isStripe = dy >= 3 && dy <= 5 && dx === span - 1;
        sub.setPixel(
          fx + dx,
          fy,
          isStripe ? RAMPS.magenta.highlight : dx <= 0 ? RAMPS.slate.highlight : RAMPS.slate.mid
        );
      }
    }

    // Torpedo shark body + shaded lateral line + white underbelly
    sub.fillEllipse(cx, cy, 14.0, 6.2, (nx, ny) => {
      if (ny > 0.25) return nx > 0.35 ? '#C4D1DF' : '#E8EEF4';
      if (ny < -0.35 && nx < 0.3) return RAMPS.slate.highlight;
      if (nx > 0.45) return RAMPS.slate.shadow;
      return RAMPS.slate.mid;
    });
    // 5 crisp gill slits
    for (let g = 0; g < 5; g++) {
      sub.drawLine(cx - 5 + g * 2, cy - 1, cx - 5 + g * 2, cy + 2, RAMPS.slate.deep, 1);
    }
    // K2 dorsal ridge accent
    sub.setPixel(cx + 2, cy - 6, RAMPS.cyanMask.highlight);
    sub.setPixel(cx + 3, cy - 6, RAMPS.cyanMask.mid);

    // Conical shark snout + dark predator eye + multi-row serrated jaws
    sub.fillEllipse(cx - 12, cy - 2, 6.2, 3.2, (nx, ny) =>
      ny < -0.2 ? RAMPS.slate.highlight : RAMPS.slate.mid
    );
    sub.setPixel(cx - 13, cy - 2, VOID);
    sub.setPixel(cx - 12, cy - 2, RAMPS.gold.highlight);

    if (jawOpen > 1) {
      sub.fillEllipse(cx - 13, cy + 2 + Math.floor(jawOpen * 0.35), 4.5, jawOpen * 0.65, RAMPS.lava.deep);
    }
    sub.drawLine(cx - 7, cy + 2, cx - 16, cy + 2 + jawOpen, '#DDE6EE', 2);
    for (let tx = cx - 16; tx <= cx - 9; tx += 2) {
      sub.setPixel(tx, cy + 1, '#FFFFFF');
      sub.setPixel(tx + 1, cy + 1 + jawOpen, '#FFFFFF');
    }
    // Swept shaded pectoral fin
    for (let i = 0; i < 6; i++) {
      const w = Math.max(1, 3 - Math.floor(i / 2));
      for (let dx = 0; dx < w; dx++) {
        sub.setPixel(cx - 2 + i + dx, cy + 4 + i, dx === 0 ? RAMPS.slate.mid : RAMPS.slate.deep);
      }
    }
  });

  drawWaterSurface(buf, 25, frame, total);
  drawBubbleTrail(buf, cx + 17, 23, frame, total, 10);

  if (isAtk && breach > 0.2) {
    drawSplashSpray(buf, cx - 10, 25, p, 9, '#FFFFFF', RAMPS.lava.highlight);
  }

  return finalizeAquaticAction(buf, frame, total, action);
}

/**
 * 10. Речной Монстр (Swamp & River Leviathan) — 54x40, Tier II
 * Unique Attack: Ambush Tail-Sweep & Mud-Geyser Bite (erupts from murky ripples + barbed tail whip)
 */
function renderRiverMonster(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(54, 40);
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const isAtk = action === 'attack';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;

  const ambushSurge = isAtk ? Math.sin(p * Math.PI) : 0;
  const cx = 26 + Math.round(-ambushSurge * 4);
  const cy = Math.round(23 - ambushSurge * 5 + Math.sin(t) * 0.8);
  const tailWhip = isAtk ? Math.sin(p * Math.PI * 2) * 8 : Math.sin(t) * 2.5;

  buf.layer((sub) => {
    // Barbed crocodile tail sweeping sharply during attack
    for (let i = 0; i < 16; i++) {
      const u = i / 15;
      const tx = Math.round(cx + 10 + i);
      const ty = Math.round(cy + Math.sin(t - i * 0.3) * 1.5 - u * tailWhip);
      sub.fillEllipse(tx, ty, 1.4, 3.2 - u * 2, (nx, ny) =>
        ny < -0.2 ? RAMPS.moss.highlight : RAMPS.moss.deep
      );
      if (i % 3 === 0) sub.setPixel(tx, ty - 3, RAMPS.bone.mid);
    }

    // Spiny dorsal swamp-sail (K1 faction spines + moss membranes)
    for (let i = 0; i < 7; i++) {
      const sx = cx - 3 + i * 2;
      const h = 8 - Math.abs(sx - (cx + 3)) * 0.6;
      sub.drawLine(
        sx,
        cy - 4,
        sx + 1,
        Math.round(cy - 4 - h),
        i % 2 === 1 ? RAMPS.magenta.mid : RAMPS.moss.highlight,
        1
      );
    }

    // Armored moss-scaled crocodile body
    sub.fillEllipse(cx + 2, cy, 11.5, 5.5, (nx, ny, px, py) =>
      shadeScale(nx, ny, px, py, RAMPS.moss, 7)
    );

    // Narrow ambush snout, glowing eyes & long river barbels
    sub.fillEllipse(cx - 11, cy - 1, 7.5, 3, (nx, ny, px, py) =>
      shadeScale(nx, ny, px, py, RAMPS.moss, 3)
    );
    sub.fillRect(cx - 9, cy - 4, 2, 2, RAMPS.gold.highlight);
    const snap = isAtk && ambushSurge > 0.35 ? 4 : 1;
    sub.drawLine(cx - 5, cy + 1, cx - 18, cy + 1 + snap, RAMPS.sandstone.mid, 2);
    for (let tx = cx - 17; tx <= cx - 10; tx += 2) {
      sub.setPixel(tx, cy + 1, '#FFFFFF');
    }
    // River catfish whiskers
    sub.drawLine(cx - 16, cy + 1, cx - 19, cy + 4 + Math.round(Math.sin(t) * 1.5), RAMPS.emerald.highlight, 1);
  });

  drawWaterSurface(buf, 26, frame, total, '#1C352288', '#D1E3EB', '#8AB09A');
  drawBubbleTrail(buf, cx + 15, 24, frame, total, 9);

  if (isAtk && p >= 0.25 && p <= 0.8) {
    drawSplashSpray(buf, cx - 14, 25, (p - 0.25) / 0.55, 8, RAMPS.sandstone.highlight, RAMPS.moss.highlight);
    drawSplashSpray(buf, cx + 21, 24, (p - 0.25) / 0.55, 5, '#FFFFFF', WATER_LINE.light);
  }

  return finalizeAquaticAction(buf, frame, total, action);
}

/**
 * 11. Эласмозавр (Elasmosaurus) — 54x42, Tier I
 * Unique Attack: Whip-Neck Spear Strike (S-coil pullback -> harpoon neck lunge!)
 */
function renderElasmosaurus(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(54, 42);
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const isAtk = action === 'attack';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;

  let headExtendX = 0;
  let headExtendY = 0;
  if (isAtk) {
    if (p < 0.35) {
      // Pull neck back into spring S-coil
      const k = p / 0.35;
      headExtendX = Math.round(k * 7);
      headExtendY = Math.round(k * 3);
    } else if (p < 0.65) {
      // Harpoon dart strike left!
      const k = (p - 0.35) / 0.3;
      headExtendX = Math.round(7 - k * 15);
      headExtendY = Math.round(3 + k * 4);
    } else {
      const k = (p - 0.65) / 0.35;
      headExtendX = Math.round(-8 * (1 - k));
      headExtendY = Math.round(7 * (1 - k));
    }
  }

  const bodyX = 33;
  const bodyY = 27 + Math.round(Math.sin(t) * 0.8);
  const paddle = Math.round(Math.sin(t) * 2.5);

  buf.layer((sub) => {
    // Broad plesiosaur body & four diamond flippers
    sub.fillEllipse(bodyX, bodyY, 10, 5.2, (nx, ny, px, py) =>
      shadeScale(nx, ny, px, py, RAMPS.ice, 6)
    );
    sub.drawLine(bodyX + 8, bodyY, bodyX + 16, bodyY + Math.round(Math.sin(t) * 2), RAMPS.ice.shadow, 2);
    sub.drawLine(bodyX - 4, bodyY + 3, bodyX - 1, bodyY + 9 + paddle, RAMPS.magenta.mid, 3);
    sub.drawLine(bodyX + 5, bodyY + 3, bodyX + 8, bodyY + 8 - paddle, RAMPS.ice.deep, 2);

    // Graceful 18-segment S-curved neck terminating in small toothed head
    const startX = bodyX - 7;
    const startY = bodyY - 2;
    const targetX = 14 + headExtendX;
    const targetY = 12 + headExtendY + Math.round(Math.sin(t) * 1.4);

    for (let i = 0; i <= 16; i++) {
      const u = i / 16;
      const curve = isAtk && p < 0.35 ? Math.sin(u * Math.PI * 2) * 4.5 : Math.sin(u * Math.PI + t * 0.5) * 2.5;
      const nx = Math.round(startX + (targetX - startX) * u + curve * (1 - u));
      const ny = Math.round(startY + (targetY - startY) * u - Math.sin(u * Math.PI) * 3);
      sub.fillEllipse(nx, ny, 1.8 - u * 0.5, 1.8 - u * 0.5, (lx, ly) =>
        ly < 0 ? RAMPS.ice.highlight : RAMPS.ice.mid
      );
    }

    // Small horned plesiosaur head + snapping needle teeth
    sub.fillEllipse(targetX - 2, targetY, 4.2, 2.3, (nx, ny) =>
      ny < 0 ? RAMPS.ice.highlight : RAMPS.ice.mid
    );
    sub.setPixel(targetX - 2, targetY - 1, RAMPS.gold.highlight);
    sub.setPixel(targetX - 5, targetY + 1, '#FFFFFF');
    if (isAtk && p >= 0.35 && p < 0.68) {
      sub.drawLine(targetX - 3, targetY + 2, targetX - 7, targetY + 3, '#FFFFFF', 1);
    }
  });

  drawWaterSurface(buf, 29, frame, total);
  drawBubbleTrail(buf, 42, 26, frame, total, 7);

  if (isAtk && p >= 0.42 && p <= 0.78) {
    drawSplashSpray(buf, 7, 22, (p - 0.42) / 0.36, 6, '#FFFFFF', RAMPS.cyanMask.highlight);
  }

  return finalizeAquaticAction(buf, frame, total, action);
}

/**
 * 12. Гигантский Ракоскорпион (Eurypterid King) — 50x38, Tier I
 * Unique Attack: Crushing Pincer Clamp & Stinger Lash (pincers slam + glowing stinger whips forward)
 */
function renderEurypterid(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  const buf = new PixelBuffer(50, 38);
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const isAtk = action === 'attack';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;

  const snapClose = isAtk ? (p < 0.38 ? p / 0.38 : p < 0.58 ? 0 : 0.4) : 0.3 + Math.sin(t) * 0.2;
  const stingerFwd = isAtk && p >= 0.35 && p <= 0.75 ? Math.sin(((p - 0.35) / 0.4) * Math.PI) : 0;
  const cy = 24 + Math.round(Math.sin(t) * 0.8);

  // Layer 1: Segmented Silurian mesosoma plates, articulated swimming paddles & jointed walking legs
  buf.layer((sub) => {
    // Broad fan swimming paddle (signature 6th appendage pair!)
    const paddleWave = Math.round(Math.sin(t) * 2.5);
    sub.drawRotatedRect(20, cy + 3, 8, 2.3, 0.9 + paddleWave * 0.12, (u, v) =>
      u > 0.7 ? RAMPS.cyanMask.mid : v < 0 ? RAMPS.autumn.highlight : RAMPS.timber.mid
    );
    // 3 jointed walking appendages underneath
    for (let l = 0; l < 3; l++) {
      const kick = Math.round(Math.sin(t + l * 1.1) * 1.8);
      sub.drawLine(17 + l * 3, cy + 3, 19 + l * 3 + kick, cy + 8, RAMPS.timber.shadow, 2);
      sub.setPixel(19 + l * 3 + kick, cy + 8, RAMPS.autumn.mid);
    }

    // 6 overlapping chitinous tergite carapace plates with pleural side spines
    for (let s = 5; s >= 0; s--) {
      const sx = 20 + s * 3.4;
      const rx = 2.6;
      const ry = 4.6 - s * 0.42;
      sub.fillEllipse(sx, cy, rx, ry, (nx, ny) => {
        if (nx > 0.35) return RAMPS.timber.deep;
        if (ny < -0.3) return RAMPS.autumn.highlight;
        if (Math.abs(ny) < 0.2 && s % 2 === 0) return RAMPS.magenta.mid; // K1 dorsal carapace chevron
        return ny > 0.35 ? RAMPS.autumn.shadow : RAMPS.autumn.mid;
      });
      // Pleural ridge thorn at top edge of each plate
      sub.setPixel(Math.round(sx + 1), Math.round(cy - ry), RAMPS.bone.mid);
    }
  });

  // Layer 2: Broad horseshoe-crescent prosoma head shield + twin kidney compound eyes + heavy pincers
  buf.layer((sub) => {
    sub.fillEllipse(15, cy, 5.8, 5.2, (nx, ny) => {
      if (nx < -0.25 && ny < -0.2) return RAMPS.autumn.highlight;
      if (nx > 0.4 || ny > 0.45) return RAMPS.timber.deep;
      return ny > 0.15 ? RAMPS.autumn.shadow : RAMPS.autumn.mid;
    });
    // Twin glowing crescent compound eyes + central ocelli
    sub.fillRect(12, cy - 3, 2, 2, RAMPS.cyanMask.highlight);
    sub.fillRect(12, cy + 1, 2, 2, RAMPS.cyanMask.mid);
    sub.setPixel(15, cy - 1, RAMPS.gold.highlight);

    // Articulated chelicerae pincer arms + curved serrated claws
    const clampSpread = Math.round(snapClose * 5);
    sub.drawLine(11, cy - 2, 7, cy - 3 - Math.round(clampSpread * 0.5), RAMPS.autumn.mid, 2);
    sub.drawLine(11, cy + 2, 7, cy + 2 + Math.round(clampSpread * 0.5), RAMPS.autumn.shadow, 2);
    // Claws
    sub.drawLine(7, cy - 3 - Math.round(clampSpread * 0.5), 4, cy - 2 - clampSpread, RAMPS.magenta.highlight, 2);
    sub.drawLine(7, cy + 2 + Math.round(clampSpread * 0.5), 4, cy + 1 + clampSpread, RAMPS.magenta.mid, 2);
    sub.setPixel(4, cy - 2 - clampSpread, '#FFFFFF');
    sub.setPixel(4, cy + 1 + clampSpread, '#FFFFFF');
  });

  // Layer 3: Multi-segment curved metasoma tail + razor telson venom spine
  buf.layer((sub) => {
    const segCount = 6;
    const p0x = 38;
    const p0y = cy;
    const p1x = 43;
    const p1y = 14 - Math.round(stingerFwd * 3);
    const arcX = Math.round(36 - stingerFwd * 23);
    const arcY = Math.round(11 - stingerFwd * 2 + Math.sin(t) * 1.1);

    for (let i = 0; i <= segCount; i++) {
      const u = i / segCount;
      const inv = 1 - u;
      const sx = inv * inv * p0x + 2 * inv * u * p1x + u * u * arcX;
      const sy = inv * inv * p0y + 2 * inv * u * p1y + u * u * arcY;
      sub.fillEllipse(sx, sy, 1.8 - u * 0.5, 1.6 - u * 0.4, (nx, ny) =>
        u > 0.75 ? RAMPS.magenta.highlight : ny < 0 ? RAMPS.autumn.highlight : RAMPS.autumn.shadow
      );
    }
    // Glowing barbed venom telson needle pointing forward-left
    sub.fillRect(arcX - 3, arcY, 3, 2, RAMPS.cyanMask.highlight);
    sub.setPixel(arcX - 4, arcY + 1, '#FFFFFF');
  });

  drawWaterSurface(buf, 27, frame, total, '#261E1477');
  drawBubbleTrail(buf, 33, 25, frame, total, 8);

  if (isAtk && p >= 0.4 && p <= 0.68) {
    buf.fillEllipse(7, cy, 2.5, 2.5, '#FFFFFF');
    drawSplashSpray(buf, 6, 26, (p - 0.4) / 0.28, 6, RAMPS.cyanMask.highlight, '#FFFFFF');
  }

  return finalizeAquaticAction(buf, frame, total, action);
}

export const AQUATIC_MODELS: PixelModelDef[] = [
  {
    id: 'mosasaurus',
    name: 'Мозазавр',
    subtitle: 'Морской ящер-апекс (56×38)',
    kind: 'aquatic',
    tier: 'III',
    faction: 'Орда',
    width: 56,
    height: 38,
    frameCount: 12,
    defaultFps: 10,
    noOutlineRequired: true,
    supportsShadow: false,
    attackName: 'Смертельный выпад челюстей',
    unitMeta: {
      coreSize: '56×38 морской',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 0,
    },
    layersSpec: [
      '0. Анимированная поверхность воды WATER_LINE + пузырьковый след',
      '1. Змеевидный хвост с костяными гребнями и хвостовым плавником',
      '2. Бронированное туловище с полосой K1 и 4 гидро-ластами',
      '3. Двухшарнирная зубастая пасть + уникальная атака «Выпад челюстей»',
    ],
    description:
      'Гигантский морской ящер: плавает за счёт волнообразного хвоста и гребков ласт, при атаке оттягивается назад и совершает стремительный бросок с широким захватом челюстей и брызгами.',
    renderFrame: renderMosasaurus,
    codeSnippet: `function renderMosasaurus(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer { /* jaw-lunge snap */ return new PixelBuffer(56, 38); }`,
  },
  {
    id: 'leviathan',
    name: 'Бездонный Левиафан',
    subtitle: 'Бездный змей с плазмой K2 (58×42)',
    kind: 'aquatic',
    tier: 'III',
    faction: 'Некрополь',
    width: 58,
    height: 42,
    frameCount: 12,
    defaultFps: 10,
    noOutlineRequired: true,
    supportsShadow: false,
    attackName: 'Бездный плазменный залп',
    unitMeta: {
      coreSize: '58×42 титан',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 0,
    },
    layersSpec: [
      '0. Глубинная вода и биолюминесцентные руны K2 вдоль хребта',
      '1. 36-сегментный S-образный корпус со светящимися гребнями K1',
      '2. Рогатая драконья голова с усами',
      '3. Уникальная атака: заряд сферы маны и мощный бирюзовый плазменный луч',
    ],
    description:
      'Древний повелитель глубин: извивается кольцами над поверхностью воды. При атаке поднимает гребни, заряжает горловой реактор и выпускает волну плазменного дыхания.',
    renderFrame: renderLeviathan,
    codeSnippet: `function renderLeviathan(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer { /* abyssal breath beam */ return new PixelBuffer(58, 42); }`,
  },
  {
    id: 'kraken',
    name: 'Кракен Глубин',
    subtitle: 'Гигантский головоногий (54×48)',
    kind: 'aquatic',
    tier: 'III',
    faction: 'Некрополь',
    width: 54,
    height: 48,
    frameCount: 12,
    defaultFps: 10,
    noOutlineRequired: true,
    supportsShadow: false,
    attackName: 'Удар щупалец и чернильный водоворот',
    unitMeta: {
      coreSize: '54×48 босс',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 0,
    },
    layersSpec: [
      '0. Задние колышущиеся щупальца и тёмный водяной слой',
      '1. Пульсирующая мантия с хроматофорами K1/K2 и золотыми глазами',
      '2. 4 передних щупальца с костяными присосками',
      '3. Уникальная атака: замах щупальцами вверх, удар по воде, гейзеры и чернильное облако',
    ],
    description:
      'Колоссальный кракен с живой пульсацией мантии и 6 гибкими щупальцами. В режиме атаки вздымает щупальца вверх и обрушивает их в воду с двойными фонтанами брызг и чернильным вихрем.',
    renderFrame: renderKraken,
    codeSnippet: `function renderKraken(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer { /* tentacle slam & ink vortex */ return new PixelBuffer(54, 48); }`,
  },
  {
    id: 'liopleurodon',
    name: 'Лиоплевродон',
    subtitle: 'Четырёхластый плиозавр (54×38)',
    kind: 'aquatic',
    tier: 'II',
    faction: 'Цитадель',
    width: 54,
    height: 38,
    frameCount: 12,
    defaultFps: 10,
    noOutlineRequired: true,
    supportsShadow: false,
    attackName: 'Таран четырёх ласт и укус',
    unitMeta: {
      coreSize: '54×38 плиозавр',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 0,
    },
    layersSpec: [
      '0. Дальние гидро-ласты с асинхронным гребком',
      '1. Массивный мускулистый торс со шрамами, полосой K1 и клыкастой мордой',
      '2. Передние мощные ласты с бирюзовой каймой K2',
      '3. Уникальная атака: синхронный рывок всех 4 ласт вперёд и рассекающий веер пены',
    ],
    description:
      'Сверххищник юрских морей с тяжёлой треугольной головой и четырьмя крыловидными ластами. При атаке синхронно отталкивается всеми четырьмя ластами для мощного таранного укуса.',
    renderFrame: renderLiopleurodon,
    codeSnippet: `function renderLiopleurodon(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer { /* 4-flipper rip-tide ram */ return new PixelBuffer(54, 38); }`,
  },
  {
    id: 'xiphactinus',
    name: 'Ксифактин',
    subtitle: 'Стреловидная саблезубая рыба (50×34)',
    kind: 'aquatic',
    tier: 'I',
    faction: 'Бастион Мороза',
    width: 50,
    height: 34,
    frameCount: 12,
    defaultFps: 12,
    noOutlineRequired: true,
    supportsShadow: false,
    attackName: 'Бросок-свеча из воды',
    unitMeta: {
      coreSize: '50×34 хищник',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 0,
    },
    layersSpec: [
      '0. Стремительный серебристо-ледяной торпедный корпус',
      '1. Высокий спинной плавник K1 и раздвоенный хвостовой винт',
      '2. Вздернутая бульдожья челюсть с клыками-иглами',
      '3. Уникальная атака: дуговой прыжок над волнами с каскадом воздушных брызг',
    ],
    description:
      'Быстрая доисторическая рыба-бульдог со стальной чешуёй и длинными клыками. Плавает стремительными рывками хвоста, а в атаке выпрыгивает дугой над поверхностью воды.',
    renderFrame: renderXiphactinus,
    codeSnippet: `function renderXiphactinus(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer { /* breach arc snap */ return new PixelBuffer(50, 34); }`,
  },
  {
    id: 'dunkleosteus',
    name: 'Дунклеостей',
    subtitle: 'Панцирная девонская рыба (52×36)',
    kind: 'aquatic',
    tier: 'II',
    faction: 'Кузня Пекла',
    width: 52,
    height: 36,
    frameCount: 12,
    defaultFps: 10,
    noOutlineRequired: true,
    supportsShadow: false,
    attackName: 'Гильотинный хруст брони',
    unitMeta: {
      coreSize: '52×36 панцирь',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 0,
    },
    layersSpec: [
      '0. Гибкий угревидный хвост с плавником K1',
      '1. Костяной клёпаный нагрудный панцирь с рунами K2',
      '2. Подъёмный черепной щит и костяные лезвия-челюсти',
      '3. Уникальная атака: подъём черепа и молниеносное смыкание лезвий с искрами удара',
    ],
    description:
      'Девонский броненосный монстр с самозатачивающимися костяными пластинами вместо зубов. Во время атаки запрокидывает верхний черепной щит и захлопывает гильотину пасти со снопом искр.',
    renderFrame: renderDunkleosteus,
    codeSnippet: `function renderDunkleosteus(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer { /* bone-shear crunch */ return new PixelBuffer(52, 36); }`,
  },
  {
    id: 'livyatan',
    name: 'Левиафан Мелвилла (Мальвела)',
    subtitle: 'Гигантский хищный кашалот (56×40)',
    kind: 'aquatic',
    tier: 'III',
    faction: 'Орда',
    width: 56,
    height: 40,
    frameCount: 12,
    defaultFps: 10,
    noOutlineRequired: true,
    supportsShadow: false,
    attackName: 'Лобный таран и приливная стена',
    unitMeta: {
      coreSize: '56×40 кашалот',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 0,
    },
    layersSpec: [
      '0. Горизонтальный хвостовой плавник и корпус в боевых шрамах',
      '1. Массивная квадратная спермацетовая лобная кость-таран',
      '2. Огромные конические бивни-зубы и полоса K1',
      '3. Уникальная атака: подъём туши и сокрушительный таран лбом с подъёмом стены воды',
    ],
    description:
      'Доисторический макрохищный кашалот (Livyatan melvillei / Мальвела): обладает гигантской бронированной лобной подушкой, которой в атаке с разгона таранит врага, поднимая стену пены.',
    renderFrame: renderLivyatan,
    codeSnippet: `function renderLivyatan(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer { /* spermaceti headbutt */ return new PixelBuffer(56, 40); }`,
  },
  {
    id: 'basilosaurus',
    name: 'Базилозавр (Базиловар)',
    subtitle: 'Змеевидный древний кит (58×34)',
    kind: 'aquatic',
    tier: 'II',
    faction: 'Гильдия',
    width: 58,
    height: 34,
    frameCount: 12,
    defaultFps: 10,
    noOutlineRequired: true,
    supportsShadow: false,
    attackName: 'Пружинный хлыст позвоночника',
    unitMeta: {
      coreSize: '58×34 змей-кит',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 0,
    },
    layersSpec: [
      '0. 34-сегментный длинный гибкий хребет с медным отливом',
      '1. Пояски K1, светлое брюхо и раздвоенный хвост',
      '2. Узкий череп с пилообразными зубами и глазом K2',
      '3. Уникальная атака: сжатие тела в тугую синусоидальную пружину и мгновенный выстрел вперёд',
    ],
    description:
      'Вытянутый древний морской кит-змея: грациозно рассекает поверхность тройной волной корпуса. При атаке сжимает гибкий хребет в гармошку и выстреливает вперёд как гарпун.',
    renderFrame: renderBasilosaurus,
    codeSnippet: `function renderBasilosaurus(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer { /* whip-coil strike */ return new PixelBuffer(58, 34); }`,
  },
  {
    id: 'megalodon',
    name: 'Мегалодон',
    subtitle: 'Колоссальная доисторическая акула (56×40)',
    kind: 'aquatic',
    tier: 'III',
    faction: 'Бастион Мороза',
    width: 56,
    height: 40,
    frameCount: 12,
    defaultFps: 10,
    noOutlineRequired: true,
    supportsShadow: false,
    attackName: 'Прыжок с раскрытием пасти',
    unitMeta: {
      coreSize: '56×40 акула',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 0,
    },
    layersSpec: [
      '0. Высокий спинной плавник со шрамом K1 и серповидный хвост',
      '1. Торпедный корпус со стальной спиной, жабрами и белым брюхом',
      '2. Многорядная зубастая пасть, раскрывающаяся при атаке',
      '3. Уникальная атака: вертикальный вылет из волн с алыми брызгами и пеной',
    ],
    description:
      'Легендарная исполинская акула океанов. В обычном цикле режет гладь огромным спинным плавником, а в атаке взлетает из воды с широко раскрытой многорядной пастью.',
    renderFrame: renderMegalodon,
    codeSnippet: `function renderMegalodon(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer { /* breach-jaws frenzy */ return new PixelBuffer(56, 40); }`,
  },
  {
    id: 'river-monster',
    name: 'Речной Монстр',
    subtitle: 'Болотно-речной ящер с парусом (54×40)',
    kind: 'aquatic',
    tier: 'II',
    faction: 'Лесной Круг',
    width: 54,
    height: 40,
    frameCount: 12,
    defaultFps: 10,
    noOutlineRequired: true,
    supportsShadow: false,
    attackName: 'Засадный удар хвостом и грязевой выброс',
    unitMeta: {
      coreSize: '54×40 амфибия',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 0,
    },
    layersSpec: [
      '0. Мутная речная рябь и шипастый хвост',
      '1. Бронированный замшелый панцирь и высокий спинной парус',
      '2. Узкая засадная пасть с длинными усами',
      '3. Уникальная атака: бросок из засады с широкой дугой хвоста и фонтаном речного ила',
    ],
    description:
      'Опасный речной хищник-амфибия со спинным парусом и крокодильей бронёй. При атаке вырывается из засады, кусает и одновременно наносит круговой удар шипастым хвостом.',
    renderFrame: renderRiverMonster,
    codeSnippet: `function renderRiverMonster(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer { /* ambush tail-sweep */ return new PixelBuffer(54, 40); }`,
  },
  {
    id: 'elasmosaurus',
    name: 'Эласмозавр',
    subtitle: 'Длинношеий плезиозавр (54×42)',
    kind: 'aquatic',
    tier: 'I',
    faction: 'Цитадель',
    width: 54,
    height: 42,
    frameCount: 12,
    defaultFps: 10,
    noOutlineRequired: true,
    supportsShadow: false,
    attackName: 'Копьевидный выпад шеи',
    unitMeta: {
      coreSize: '54×42 плезиозавр',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 0,
    },
    layersSpec: [
      '0. Широкий корпус плезиозавра и гребущие ласты с отделкой K1',
      '1. 17-сегментная гибкая шея с плавным лебединым изгибом',
      '2. Изящная голова с игловидными зубами',
      '3. Уникальная атака: скручивание шеи в кольцо и молниеносный укол вперёд как копьём',
    ],
    description:
      'Длинношеий морской ящер, плавающий при помощи четырёх плавников. В атаке складывает шею S-образной пружиной и выбрасывает её вперёд для точечного укола.',
    renderFrame: renderElasmosaurus,
    codeSnippet: `function renderElasmosaurus(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer { /* whip-neck spear strike */ return new PixelBuffer(54, 42); }`,
  },
  {
    id: 'eurypterid-king',
    name: 'Гигантский Ракоскорпион',
    subtitle: 'Панцирный эвриптерид глубин (50×38)',
    kind: 'aquatic',
    tier: 'I',
    faction: 'Кузня Пекла',
    width: 50,
    height: 38,
    frameCount: 12,
    defaultFps: 10,
    noOutlineRequired: true,
    supportsShadow: false,
    attackName: 'Сжим клешней и удар жалом',
    unitMeta: {
      coreSize: '50×38 членистое',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 0,
    },
    layersSpec: [
      '0. Сегментированный янтарно-дубовый панцирь и гребные ножки',
      '1. Парные зубастые клешни в цветах державы K1',
      '2. Загнутый хвостовой сегмент с ядовитым жалом K2',
      '3. Уникальная атака: одновременное захлопывание клешней и выпад жала над головой',
    ],
    description:
      'Древний гигантский морской скорпион мелководья. При атаке мощно сжимает зубчатые клешни перед мордой и параллельно бьёт ядовитым хвостовым жалом через спину.',
    renderFrame: renderEurypterid,
    codeSnippet: `function renderEurypterid(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer { /* pincer clamp & stinger */ return new PixelBuffer(50, 38); }`,
  },
];
