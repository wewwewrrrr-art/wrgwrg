import { RAMPS, WATER_LINE } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import { UnitAction, UnitMode, drawSlashArc } from '../engine/unitAssembler';
import { PixelModelDef, RenderContextOptions } from './types';

function drawBiomeWaterline(
  buf: PixelBuffer,
  startX: number,
  endX: number,
  y: number,
  frame: number
): void {
  for (let x = startX; x <= endX; x++) {
    buf.setPixel(x, y, (x + frame * 2) % 4 < 2 ? WATER_LINE.light : WATER_LINE.mid);
    if ((x + frame) % 3 === 0) {
      buf.setPixel(x, y + 1, RAMPS.ice.mid);
    }
  }
}

function finalizeBiomeCreature(
  sprite: PixelBuffer,
  frame: number,
  total: number,
  pivotX: number,
  pivotY: number,
  action: UnitAction
): PixelBuffer {
  const phase = frame / Math.max(1, total);
  const t = phase * Math.PI * 2;
  if (action === 'hit') {
    const flash = Math.abs(Math.sin(t));
    return sprite.applyColorOverlay(flash > 0.5 ? '#FFFFFF' : '#FF1818', 0.52 + flash * 0.28);
  }
  if (action === 'death') {
    const rot = Math.min(82, phase * 180);
    const darken = Math.min(0.85, phase * 1.2);
    const alpha = Math.max(0.28, 1 - phase * 0.75);
    return sprite.rotateAround(pivotX, pivotY, rot).applyColorOverlay('#090808', darken, alpha);
  }
  if (action === 'zombie') {
    return sprite.applyZombieTransform('#3B8130');
  }
  return sprite;
}

/**
 * 1. Shadow Panther (36x28, Tier I, 12f)
 * Sleek midnight forest predator with K1 rune collar, glowing amber eyes,
 * whipping tail, bounding stride, and forward pounce-claw slash attack.
 */
function renderShadowPanther(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const mode: UnitMode = ctx?.unitMode ?? 'walk';
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;
  const isAtk = action === 'attack';

  const lungeX = isAtk ? (p < 0.3 ? Math.round((p / 0.3) * 3) : p < 0.65 ? -5 : -1) : 0;
  const pounceY = isAtk && p >= 0.3 && p < 0.65 ? -3 : 0;
  const swimSink = mode === 'swim' ? 3 : 0;
  const bob = Math.round(Math.sin(t * 2) * 0.8);
  const stride = Math.sin(t);
  const cy = 15 + bob + pounceY + swimSink;
  const cx = 18 + lungeX;

  const sprite = new PixelBuffer(36, 28);

  // Whipping feline tail
  sprite.layer((sub) => {
    for (let i = 0; i < 8; i++) {
      const tp = i / 7;
      const tx = Math.min(34, cx + 8 + i);
      const ty = Math.max(5, Math.round(cy - 1 - Math.sin(t - tp * 2.2) * 3.2 - tp * 2));
      sub.fillEllipse(tx, ty, 1.3, 1.1, tp > 0.75 ? RAMPS.magenta.mid : RAMPS.slate.deep);
    }
  });

  // Muscular lithe torso + bounding legs + K1 rune collar
  sprite.layer((sub) => {
    // Far legs
    const flx = cx - 5 - Math.round(stride * 3);
    const blx = cx + 6 + Math.round(stride * 3);
    sub.drawLine(cx - 4, cy + 2, flx, Math.min(24, cy + 8), RAMPS.slate.deep, 2);
    sub.drawLine(cx + 6, cy + 2, blx, Math.min(24, cy + 8), RAMPS.slate.deep, 2);

    // Torso
    sub.fillEllipse(cx + 1, cy + 1, 7.6, 3.6, (nx, ny) =>
      ny < -0.35 ? RAMPS.slate.mid : nx > 0.4 || ny > 0.4 ? RAMPS.slate.deep : RAMPS.slate.shadow
    );
    // K2 shoulder spirit stripes
    sub.setPixel(cx - 1, cy, RAMPS.cyanMask.highlight);
    sub.setPixel(cx + 2, cy, RAMPS.cyanMask.mid);

    // Near legs
    const nflx = isAtk && p >= 0.3 && p < 0.65 ? cx - 9 : cx - 4 + Math.round(stride * 3);
    const nfly = isAtk && p >= 0.3 && p < 0.65 ? cy + 3 : Math.min(24, cy + 9);
    const nblx = cx + 7 - Math.round(stride * 3);
    sub.drawLine(cx - 3, cy + 2, nflx, nfly, RAMPS.slate.shadow, 2);
    sub.setPixel(nflx - 1, nfly, '#EEF1F7'); // Sharp claw tip
    sub.drawLine(cx + 6, cy + 2, nblx, Math.min(24, cy + 9), RAMPS.slate.shadow, 2);

    // K1 Rune Collar
    sub.drawLine(cx - 5, cy - 2, cx - 4, cy + 3, RAMPS.magenta.mid, 2);
    sub.setPixel(cx - 5, cy + 2, RAMPS.gold.highlight);
  });

  // Sculpted feline head, ears & fangs
  sprite.layer((sub) => {
    const hx = cx - 8;
    const hy = cy - 2;
    sub.fillEllipse(hx, hy, 4.2, 3.2, (nx, ny) =>
      ny < -0.25 ? RAMPS.slate.mid : RAMPS.slate.shadow
    );
    // Pointed ears
    sub.fillRect(hx, hy - 5, 2, 2, RAMPS.slate.mid);
    sub.fillRect(hx + 3, hy - 5, 2, 2, RAMPS.slate.shadow);
    // Glowing amber predator eye
    sub.setPixel(hx - 2, hy - 1, RAMPS.gold.highlight);
    sub.setPixel(hx - 1, hy - 1, RAMPS.gold.mid);
    // Snarl teeth on attack
    if (isAtk && p > 0.25 && p < 0.72) {
      sub.setPixel(hx - 3, hy + 2, '#FFFFFF');
      sub.setPixel(hx - 1, hy + 2, '#FFFFFF');
    }
  });

  if (isAtk && p >= 0.32 && p < 0.68) {
    drawSlashArc(sprite, Math.max(2, cx - 13), cy - 1, 1 - Math.abs((p - 0.5) / 0.18));
  }

  if (mode === 'swim') {
    for (let y = 21; y < sprite.height; y++) {
      for (let x = 0; x < sprite.width; x++) {
        if (sprite.getPixel(x, y) !== null) sprite.setPixel(x, y, RAMPS.ice.deep);
      }
    }
  }

  const out = finalizeBiomeCreature(sprite, frame, total, 18, 24, action);
  if (mode === 'swim') drawBiomeWaterline(out, 5, 30, 20, frame);
  return out;
}

/**
 * 2. Spore Hydra (46x42, Tier III, 14f)
 * Three-headed swamp serpent-hydra with glowing K2 mushroom caps, K1 crest scales,
 * undulating necks, and synchronized multi-head snap + toxic spore cloud attack.
 */
function renderSporeHydra(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const mode: UnitMode = ctx?.unitMode ?? 'walk';
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;
  const isAtk = action === 'attack';
  const swimSink = mode === 'swim' ? 4 : 0;
  const groundY = Math.min(38, 35 + swimSink);
  const bob = Math.round(Math.sin(t) * 1.1);

  const sprite = new PixelBuffer(46, 42);

  // Heavy swamp tail
  sprite.layer((sub) => {
    for (let i = 0; i < 9; i++) {
      const tp = i / 8;
      const tx = Math.min(43, 29 + i * 2);
      const ty = Math.min(groundY, Math.round(28 + tp * 6 + Math.sin(t - i * 0.5) * 1.8));
      sub.fillEllipse(tx, ty, Math.max(1.2, 3.8 - tp * 2.6), Math.max(1, 2.8 - tp * 1.8), RAMPS.pine.deep);
    }
  });

  // Wide clawed body + glowing K2/K1 mushroom caps on back
  sprite.layer((sub) => {
    sub.fillEllipse(26, 28 + bob + swimSink, 8.5, 6.2, (nx, ny) =>
      ny < -0.3 ? RAMPS.pine.highlight : ny > 0.45 ? RAMPS.pine.deep : RAMPS.pine.mid
    );
    // Glowing mushroom cluster on back
    for (const [mx, my, r] of [
      [25, 20 + bob + swimSink, 3.2],
      [30, 22 + bob + swimSink, 2.4],
      [21, 22 + bob + swimSink, 2.2],
    ]) {
      sub.fillEllipse(mx, my, r, r * 0.7, (nx, ny) =>
        ny < -0.2 ? RAMPS.cyanMask.highlight : nx > 0.3 ? RAMPS.magenta.shadow : RAMPS.cyanMask.mid
      );
    }
    // Thick swamp legs
    const step = Math.round(Math.sin(t) * 2);
    sub.drawLine(21, 31 + swimSink, 19 + step, groundY, RAMPS.pine.shadow, 3);
    sub.drawLine(29, 31 + swimSink, 31 - step, groundY, RAMPS.pine.deep, 3);
  });

  // Three articulated undulating serpentine necks & fanged heads
  const heads = [
    { baseX: 20, hx: 9, hy: 13, phase: 0, jawAmp: 1 },
    { baseX: 22, hx: 14, hy: 8, phase: 1.4, jawAmp: 1.1 },
    { baseX: 24, hx: 17, hy: 18, phase: 2.6, jawAmp: 0.9 },
  ];
  for (let hIdx = 0; hIdx < heads.length; hIdx++) {
    const hd = heads[hIdx];
    const lunge = isAtk
      ? p < 0.25
        ? Math.round((p / 0.25) * 3)
        : p < 0.62
          ? -Math.round(Math.sin(((p - 0.25) / 0.37) * Math.PI) * 5)
          : 0
      : 0;
    const headX = Math.max(5, hd.hx + lunge + Math.round(Math.sin(t + hd.phase) * 1.4));
    const headY = Math.max(5, hd.hy + Math.round(Math.cos(t + hd.phase) * 1.5) + swimSink);
    const jawOpen = isAtk && p > 0.22 && p < 0.72 ? 3 : 1;

    sprite.layer((sub) => {
      // Curved neck segments
      for (let s = 0; s <= 5; s++) {
        const sp = s / 5;
        const nx = Math.round(hd.baseX * (1 - sp) + headX * sp);
        const ny = Math.round((25 + bob + swimSink) * (1 - sp) + headY * sp - Math.sin(sp * Math.PI) * 2);
        sub.fillEllipse(nx, ny, 2.2 - sp * 0.4, 2.2 - sp * 0.4, s % 2 === 0 ? RAMPS.pine.mid : RAMPS.pine.shadow);
      }
      // Sculpted reptile head + K1 frill + glowing eye
      sub.fillEllipse(headX, headY, 3.6, 2.6, RAMPS.pine.highlight);
      sub.fillRect(headX + 1, headY - 3, 2, 2, RAMPS.magenta.mid);
      sub.setPixel(headX - 1, headY - 1, RAMPS.gold.highlight);
      // Lower hinged jaw + fangs
      sub.fillRect(headX - 4, headY + jawOpen, 4, 2, RAMPS.pine.shadow);
      sub.setPixel(headX - 3, headY + 1, '#FFFFFF');
      sub.setPixel(headX - 3, headY + jawOpen, '#FFF2A6');
    });
  }

  // Toxic spore burst cloud during attack
  if (isAtk && p > 0.3 && p < 0.78) {
    const sp = (p - 0.3) / 0.48;
    for (let i = 0; i < 6; i++) {
      const sx = Math.max(2, Math.round(7 - sp * 5 + Math.sin(i * 1.9 + sp * 4) * 3));
      const sy = Math.max(3, Math.round(12 + (i - 2.5) * 3 + Math.cos(i + sp * 5) * 2));
      sprite.setPixel(sx, sy, i % 2 === 0 ? RAMPS.cyanMask.highlight : '#73F2A6AA');
    }
  }

  const out = finalizeBiomeCreature(sprite, frame, total, 23, 36, action);
  if (mode === 'swim') drawBiomeWaterline(out, 6, 40, 32, frame);
  return out;
}

/**
 * 3. Solar Scarab Colossus (38x30, Tier II, 12f)
 * Iridescent desert beetle with gold-trimmed wing covers (elytra), K1/K2 solar crest,
 * 6 articulated scuttling legs, fluttering wing-lift & solar horn beam attack.
 */
function renderScarabColossus(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;
  const isAtk = action === 'attack';
  const bob = Math.round(Math.sin(t * 2) * 0.8);
  const wingLift = isAtk && p > 0.2 && p < 0.75 ? Math.round(Math.sin(((p - 0.2) / 0.55) * Math.PI) * 3) : 0;
  const cx = 20;
  const cy = 17 + bob - (wingLift > 1 ? 1 : 0);

  const sprite = new PixelBuffer(38, 30);

  // 6 articulated scuttling desert legs
  sprite.layer((sub) => {
    for (let i = 0; i < 3; i++) {
      const lx = cx - 5 + i * 5;
      const swing = Math.round(Math.sin(t + i * 2.1) * 1.8);
      sub.drawLine(lx, cy + 2, lx - 2 + swing, Math.min(26, cy + 8), RAMPS.gold.deep, 2);
      sub.setPixel(lx - 3 + swing, Math.min(26, cy + 8), RAMPS.gold.mid);
    }
  });

  // Armored gold-and-K1 scarab carapace + fluttering elytra
  sprite.layer((sub) => {
    if (wingLift > 0) {
      // Translucent iridescent inner wings fluttering upward
      sub.fillEllipse(cx + 3, cy - 4 - wingLift, 6.2, 2.6, '#C2F0FFAA');
      sub.fillEllipse(cx + 1, cy - 3 - wingLift, 6.8, 3.0, RAMPS.magenta.mid);
    }
    sub.fillEllipse(cx + 2, cy, 8.2, 5.4, (nx, ny) => {
      if (ny < -0.45 && nx < 0.2) return RAMPS.gold.highlight;
      if (nx > 0.4 || ny > 0.45) return RAMPS.gold.deep;
      return nx < 0 ? RAMPS.magenta.mid : RAMPS.magenta.shadow;
    });
    // Gold carapace ridge + K2 solar jewel
    sub.drawLine(cx - 4, cy - 1, cx + 8, cy - 1, RAMPS.gold.mid, 1);
    sub.fillRect(cx - 1, cy - 3, 3, 2, RAMPS.cyanMask.highlight);
  });

  // Horned pronotum & curved golden scarab horn
  sprite.layer((sub) => {
    const hx = cx - 7;
    const hy = cy + 1;
    sub.fillEllipse(hx, hy, 3.8, 3.2, RAMPS.gold.shadow);
    sub.drawLine(hx - 2, hy, hx - 7, hy - 3, RAMPS.gold.mid, 2);
    sub.setPixel(hx - 7, hy - 4, RAMPS.gold.highlight);
    sub.setPixel(hx - 1, hy - 1, RAMPS.cyanMask.highlight);
  });

  // Solar beam burst from horn tip on attack
  if (isAtk && p >= 0.35 && p < 0.72) {
    const beamLen = Math.round(Math.sin(((p - 0.35) / 0.37) * Math.PI) * 5);
    for (let bx = 1; bx <= beamLen; bx++) {
      const px = Math.max(1, cx - 14 - bx);
      sprite.setPixel(px, cy - 3, bx % 2 === 0 ? '#FFF2A6' : RAMPS.gold.mid);
      sprite.setPixel(px, cy - 2, '#FFFFFF');
    }
  }

  return finalizeBiomeCreature(sprite, frame, total, 20, 25, action);
}

/**
 * 5. Lava Salamander (40x30, Tier II, 12f)
 * Magma-ribbed cavern lizard with undulating spine, glowing fiery gill frills,
 * obsidian K1 collar, and blazing fireball spit attack.
 */
function renderLavaSalamander(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const mode: UnitMode = ctx?.unitMode ?? 'walk';
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;
  const isAtk = action === 'attack';
  const swimSink = mode === 'swim' ? 3 : 0;
  const cy = 19 + swimSink;

  const sprite = new PixelBuffer(40, 30);

  // Undulating serpentine tail + magma dorsal glow
  sprite.layer((sub) => {
    for (let i = 0; i < 10; i++) {
      const tp = i / 9;
      const tx = Math.min(37, 23 + Math.round(tp * 14));
      const ty = Math.min(26, Math.round(cy + Math.sin(t - i * 0.55) * (1.2 + tp * 2.1)));
      sub.fillEllipse(tx, ty, Math.max(1.1, 3.2 - tp * 2.1), Math.max(1.0, 2.6 - tp * 1.6), i % 3 === 0 ? RAMPS.gold.mid : RAMPS.slate.deep);
    }
  });

  // Splayed lizard body & 4 clawed legs
  sprite.layer((sub) => {
    const step = Math.round(Math.sin(t) * 2);
    sub.drawLine(15, cy + 1, 13 + step, Math.min(26, cy + 6), RAMPS.slate.shadow, 2);
    sub.drawLine(23, cy + 1, 24 - step, Math.min(26, cy + 6), RAMPS.slate.deep, 2);

    sub.fillEllipse(19, cy, 6.8, 3.6, (nx, ny, px) => {
      if (ny < -0.45 && px % 3 === 0) return RAMPS.gold.mid; // Glowing magma spine ribs
      if (ny < -0.3) return RAMPS.magenta.mid; // K1 crest
      if (ny > 0.35) return RAMPS.gold.deep;
      return RAMPS.slate.deep;
    });
    sub.setPixel(18, cy, RAMPS.cyanMask.highlight);
  });

  // Head + fiery gill frills + jaw
  sprite.layer((sub) => {
    const hx = 10 + (isAtk && p < 0.3 ? 2 : 0);
    const hy = cy - 1 + Math.round(Math.sin(t) * 0.7);
    // Glowing fiery gill frills behind head
    for (const fy of [-3, 0, 2]) {
      sub.drawLine(hx + 3, hy + fy, hx + 6, hy + fy - 1, '#FF3B4E', 1);
      sub.setPixel(hx + 6, hy + fy - 1, RAMPS.gold.highlight);
    }
    sub.fillEllipse(hx, hy, 4.0, 2.8, RAMPS.slate.shadow);
    sub.setPixel(hx - 2, hy - 1, RAMPS.gold.highlight);
    if (isAtk && p > 0.25 && p < 0.75) {
      sub.fillRect(hx - 4, hy + 2, 4, 2, '#FF3B4E');
    }
  });

  // Blazing fireball projectile on attack
  if (isAtk && p >= 0.32 && p <= 0.85) {
    const fp = (p - 0.32) / 0.53;
    const fx = Math.max(2, Math.round(7 - fp * 5));
    const fy = Math.round(cy - 1 + Math.sin(fp * Math.PI) * -2);
    sprite.fillEllipse(fx, fy, 2.1, 1.8, '#FF3B4E');
    sprite.setPixel(fx, fy, '#FFF2A6');
  }

  const out = finalizeBiomeCreature(sprite, frame, total, 20, 25, action);
  if (mode === 'swim') drawBiomeWaterline(out, 5, 34, 22, frame);
  return out;
}

/**
 * 6. Dawn Griffon (42x38, Tier II, 12f)
 * Winged eagle-lion guardian with sweeping marble/gold wings, golden beak,
 * lion haunches, K1 knight barding, and aerial dive-talon attack.
 */
function renderPlagueGriffon(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;
  const isAtk = action === 'attack';

  const flap = Math.sin(t);
  const farFlap = Math.sin(t + 0.6);
  const hoverY = isAtk && p < 0.45 ? -4 : Math.round(Math.cos(t) * 2.2);
  const diveX = isAtk && p >= 0.35 && p < 0.7 ? -4 : Math.round(Math.sin(t) * 1.2);
  const cx = 22 + diveX;
  const cy = 21 + hoverY;

  const sprite = new PixelBuffer(42, 38);

  // Far feathered wing
  sprite.layer((sub) => {
    const wingY = cy - 6 - Math.round(farFlap * 6);
    sub.drawLine(cx, cy - 2, cx + 6, wingY, RAMPS.marble.shadow, 4);
    sub.drawLine(cx + 6, wingY, cx + 13, wingY + 3 + Math.round(farFlap * 2), RAMPS.marble.deep, 3);
  });

  // Lion hindquarters, tufted tail & armored K1 barding
  sprite.layer((sub) => {
    // Tufted lion tail
    const tailY = cy - 2 + Math.round(Math.sin(t + 1.2) * 3);
    sub.drawLine(cx + 7, cy + 1, cx + 13, tailY, RAMPS.gold.shadow, 1);
    sub.setPixel(cx + 14, tailY, RAMPS.timber.deep);

    // Body
    sub.fillEllipse(cx + 1, cy + 2, 7.6, 4.6, (nx, ny) =>
      ny < -0.35 ? RAMPS.marble.highlight : nx < 0.1 ? RAMPS.gold.mid : RAMPS.timber.mid
    );
    // K1 knight barding & K2 breastplate sigil
    sub.fillRect(cx - 4, cy, 6, 4, RAMPS.magenta.mid);
    sub.setPixel(cx - 2, cy + 1, RAMPS.cyanMask.highlight);

    // Eagle forelegs & lion hind legs
    const talonY = isAtk && p >= 0.35 && p < 0.72 ? cy + 7 : 32 + Math.round(Math.sin(t) * 1.5);
    const talonX = cx - 7 + Math.round(Math.cos(t) * 1.2);
    sub.drawLine(cx - 4, cy + 4, talonX, talonY, RAMPS.gold.mid, 2);
    sub.setPixel(talonX - 1, talonY, '#171316');
    sub.drawLine(cx + 6, cy + 4, cx + 7, 33, RAMPS.timber.shadow, 2);
  });

  // Eagle head, golden hooked beak & crest
  sprite.layer((sub) => {
    const hx = cx - 8;
    const hy = cy - 3;
    sub.fillEllipse(hx, hy, 4.2, 3.6, RAMPS.marble.highlight);
    sub.fillRect(hx - 6, hy - 1, 3, 2, RAMPS.gold.mid); // Hooked golden beak
    sub.setPixel(hx - 6, hy + 1, RAMPS.gold.highlight);
    sub.setPixel(hx - 1, hy - 1, RAMPS.cyanMask.highlight);
  });

  // Near sweeping feathered wing
  sprite.layer((sub) => {
    const tipY = cy - 8 - Math.round(flap * 7);
    sub.drawLine(cx - 1, cy, cx + 4, tipY, RAMPS.marble.highlight, 4);
    sub.drawLine(cx + 4, tipY, cx + 12, tipY + 4 + Math.round(flap * 2), RAMPS.marble.mid, 3);
    sub.setPixel(cx + 13, tipY + 5 + Math.round(flap * 2), RAMPS.gold.highlight);
  });

  if (isAtk && p >= 0.36 && p < 0.72) {
    drawSlashArc(sprite, Math.max(2, cx - 13), cy + 2, 1);
  }

  return finalizeBiomeCreature(sprite, frame, total, 21, 33, action);
}

/**
 * 7. Abyssal Bone Reaper (38x40, Tier II, 12f)
 * Floating necropolis wraith-mantis with tattered K1 shroud, K2 soul-lantern core,
 * twin bone scythe-arms, and dual-scythe reaping slash attack.
 */
function renderAbyssalReaper(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;
  const isAtk = action === 'attack';

  const floatY = Math.round(Math.sin(t) * 1.8);
  const lungeX = isAtk && p > 0.25 && p < 0.65 ? -4 : 0;
  const cx = 20 + lungeX;
  const cy = 18 + floatY;

  const sprite = new PixelBuffer(38, 40);

  // Floating soul wisps
  for (let i = 0; i < 3; i++) {
    const wx = cx + 6 + (i - 1) * 4;
    const wy = cy + 12 - ((frame + i * 3) % 7);
    sprite.setPixel(wx, wy, i === 1 ? RAMPS.cyanMask.highlight : '#6CC0E5AA');
  }

  // Tattered K1 shroud & ribcage + K2 soul-lantern core
  sprite.layer((sub) => {
    sub.fillEllipse(cx + 1, cy + 5, 5.2, 8.2, (nx, ny) =>
      ny > 0.45 ? RAMPS.magenta.deep : nx < -0.2 ? RAMPS.magenta.mid : RAMPS.magenta.shadow
    );
    // Exposed bone ribs
    for (let r = 0; r < 3; r++) {
      sub.drawLine(cx - 2, cy + r * 2, cx + 3, cy + r * 2, RAMPS.bone.highlight, 1);
    }
    sub.fillRect(cx - 1, cy + 2, 2, 2, RAMPS.cyanMask.highlight);
  });

  // Hooded skull head
  sprite.layer((sub) => {
    sub.fillEllipse(cx - 1, cy - 6, 4.4, 4.4, RAMPS.magenta.shadow);
    sub.fillEllipse(cx - 2, cy - 5, 2.8, 2.8, RAMPS.bone.mid);
    sub.setPixel(cx - 3, cy - 5, RAMPS.cyanMask.highlight);
    sub.setPixel(cx - 1, cy - 5, RAMPS.cyanMask.highlight);
  });

  // Twin curved bone scythe-arms
  sprite.layer((sub) => {
    const swing = isAtk ? (p < 0.3 ? -5 : p < 0.65 ? 6 : 0) : Math.round(Math.sin(t) * 1.5);
    const tipX = Math.max(3, cx - 10 - Math.max(0, swing));
    const tipY = Math.max(4, cy + swing);
    sub.drawLine(cx - 3, cy - 1, cx - 7, cy - 4 + Math.round(swing * 0.4), RAMPS.bone.mid, 2);
    sub.drawLine(cx - 7, cy - 4 + Math.round(swing * 0.4), tipX, tipY, RAMPS.marble.highlight, 2);
    sub.setPixel(tipX, tipY + 1, '#FFFFFF');
  });

  if (isAtk && p >= 0.32 && p < 0.68) {
    drawSlashArc(sprite, Math.max(2, cx - 12), cy + 1, 1);
  }

  return finalizeBiomeCreature(sprite, frame, total, 20, 34, action);
}

/**
 * 8. Clockwork Steam Rhino (46x36, Tier III, 14f)
 * Riveted brass & oak armored mechanical rhinoceros with rotating flank gear,
 * puffing smokestack, K1 pennant, and steam-charged horn-ram attack.
 */
function renderClockworkRhino(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const mode: UnitMode = ctx?.unitMode ?? 'walk';
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;
  const isAtk = action === 'attack';

  const chargeX = isAtk ? (p < 0.28 ? 3 : p < 0.68 ? -5 : -1) : 0;
  const swimSink = mode === 'swim' ? 3 : 0;
  const bob = Math.round(Math.sin(t * 2) * 0.7);
  const stride = Math.sin(t);
  const cx = 24 + chargeX;
  const cy = 20 + bob + swimSink;
  const groundY = Math.min(32, 30 + swimSink);

  const sprite = new PixelBuffer(46, 36);

  // Far mechanical piston legs
  sprite.layer((sub) => {
    const fStep = Math.round(-stride * 2.5);
    sub.drawLine(cx - 5, cy + 3, cx - 6 + fStep, groundY, RAMPS.slate.deep, 3);
    sub.drawLine(cx + 6, cy + 3, cx + 6 - fStep, groundY, RAMPS.slate.deep, 3);
  });

  // Riveted brass & oak hull + rotating flank gear + K1 banner
  sprite.layer((sub) => {
    sub.fillEllipse(cx + 1, cy, 9.6, 6.2, (nx, ny) =>
      ny < -0.4 ? RAMPS.gold.mid : ny > 0.45 ? RAMPS.timber.deep : RAMPS.timber.mid
    );
    // Brass armor plates & rotating gear teeth on flank
    sub.fillEllipse(cx + 1, cy, 3.6, 3.6, RAMPS.gold.shadow);
    const gearAngle = t * 2;
    for (let g = 0; g < 4; g++) {
      const a = gearAngle + (g * Math.PI) / 2;
      sub.setPixel(
        cx + 1 + Math.round(Math.cos(a) * 3.5),
        cy + Math.round(Math.sin(a) * 3.5),
        RAMPS.gold.highlight
      );
    }
    sub.setPixel(cx + 1, cy, RAMPS.cyanMask.highlight);

    // Smokestack + K1 heraldic pennant
    sub.fillRect(cx + 4, cy - 9, 3, 5, RAMPS.slate.shadow);
    sub.fillRect(cx + 3, cy - 10, 5, 2, RAMPS.gold.mid);
    sub.drawLine(cx + 9, cy - 2, cx + 9, cy - 10, RAMPS.timber.highlight, 1);
    sub.fillRect(cx + 10, cy - 10, 4, 3, RAMPS.magenta.mid);
  });

  // Steam puffs from stack
  for (let i = 0; i < 3; i++) {
    const py = Math.max(2, cy - 12 - ((frame + i * 2) % 6));
    const px = Math.min(43, cx + 6 + ((frame + i) % 3));
    sprite.setPixel(px, py, i === 0 ? '#EEF1F7AA' : '#C4CAD688');
  }

  // Near piston legs
  sprite.layer((sub) => {
    const nStep = Math.round(stride * 2.5);
    sub.drawLine(cx - 4, cy + 3, cx - 5 + nStep, groundY, RAMPS.slate.mid, 3);
    sub.fillRect(cx - 7 + nStep, groundY - 1, 4, 2, RAMPS.gold.shadow);
    sub.drawLine(cx + 7, cy + 3, cx + 7 - nStep, groundY, RAMPS.slate.mid, 3);
    sub.fillRect(cx + 5 - nStep, groundY - 1, 4, 2, RAMPS.gold.shadow);
  });

  // Armored rhino head + heavy brass ramming horn
  sprite.layer((sub) => {
    const hx = cx - 9;
    const hy = cy;
    sub.fillEllipse(hx, hy, 4.6, 3.8, RAMPS.slate.mid);
    sub.setPixel(hx - 2, hy - 1, RAMPS.cyanMask.highlight);
    // Giant curved brass horn
    sub.drawLine(hx - 3, hy, hx - 9, hy - 4, RAMPS.gold.mid, 2);
    sub.setPixel(hx - 9, hy - 5, RAMPS.gold.highlight);
  });

  // Charge sparks at horn tip during attack
  if (isAtk && p >= 0.3 && p < 0.72) {
    sprite.setPixel(Math.max(1, cx - 19), cy - 4, '#FFF2A6');
    sprite.setPixel(Math.max(1, cx - 18), cy - 6, '#FF3B4E');
    sprite.setPixel(Math.max(1, cx - 17), cy - 2, '#FFFFFF');
  }

  const out = finalizeBiomeCreature(sprite, frame, total, 23, 30, action);
  if (mode === 'swim') drawBiomeWaterline(out, 6, 40, 26, frame);
  return out;
}

export const BIOME_CREATURE_MODELS: PixelModelDef[] = [
  {
    id: 'shadow-panther',
    name: 'Теневая Пантера',
    subtitle: 'Стремительный лесной хищник (36×28)',
    kind: 'unit',
    tier: 'I',
    faction: 'Лесной Круг',
    width: 36,
    height: 28,
    frameCount: 12,
    defaultFps: 12,
    attackName: 'Прыжок и удар когтями',
    unitMeta: {
      coreSize: '24×19 зверь',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 15,
    },
    layersSpec: [
      '0. Адаптивная мягкая тень на земле под лапами',
      '1. Гибкий хвост-кнут и мускулистое тело в тёмном сланце',
      '2. Ошейник K1, рунические полосы K2 и прыжок с дугой когтей',
    ],
    description:
      'Стремительная лесная пантера уровня I (36×28 px, 12 к.): гибкий шаг, янтарный взгляд, рунный ошейник K1/K2 и молниеносный бросок с ударом когтями.',
    renderFrame: renderShadowPanther,
    getAnchors: (frame, total, ctx) => {
      const sink = ctx?.unitMode === 'swim' ? 3 : 0;
      const y = 24 + sink;
      return {
        head: { x: 6, y: 9 + sink, w: 8, h: 7 },
        item: { x: 3, y: 12 + sink, w: 6, h: 6 },
        pivot: { x: 18, y },
      };
    },
    codeSnippet: `function renderShadowPanther(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return renderShadowPantherImpl(frame, total, ctx);
}`,
  },
  {
    id: 'spore-hydra',
    name: 'Грибная Гидра',
    subtitle: 'Трёхголовый болотный зверь (46×42)',
    kind: 'unit',
    tier: 'III',
    faction: 'Лесной Круг',
    width: 46,
    height: 42,
    frameCount: 14,
    defaultFps: 10,
    attackName: 'Тройной выпад голов и споровый взрыв',
    unitMeta: {
      coreSize: '34×30 босс',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 20,
    },
    layersSpec: [
      '0. Мягкая тень болотной поступи',
      '1. Три извивающиеся шеи с клыкастыми головами и гребнями K1',
      '2. Биолюминесцентные грибные шляпки K2/K1 и облако спор в атаке',
    ],
    description:
      'Трёхголовая болотная гидра уровня III (46×42 px, 14 к.): синхронное волнообразное движение трёх шей, светящиеся шляпки K2 на спине и ядовитый выпад.',
    renderFrame: renderSporeHydra,
    getAnchors: () => ({
      head: { x: 6, y: 6, w: 14, h: 14 },
      item: { x: 3, y: 10, w: 8, h: 8 },
      pivot: { x: 23, y: 36 },
    }),
    codeSnippet: `function renderSporeHydra(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return renderSporeHydraImpl(frame, total, ctx);
}`,
  },
  {
    id: 'scarab-colossus',
    name: 'Солнечный Скарабей',
    subtitle: 'Бронированный жук оазиса (38×30)',
    kind: 'unit',
    tier: 'II',
    faction: 'Цитадель',
    width: 38,
    height: 30,
    frameCount: 12,
    defaultFps: 10,
    attackName: 'Раскрытие надкрылий и солнечный луч',
    unitMeta: {
      coreSize: '26×20 зверь',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 16,
    },
    layersSpec: [
      '0. Мягкая тень под шестью лапками',
      '1. Надкрылья K1 с золотым хребтом и солнечным кристаллом K2',
      '2. Взмах внутренних крыльев и золотой импульс с рога при атаке',
    ],
    description:
      'Пустынный гигантский скарабей уровня II (38×30 px, 12 к.): переливающийся панцирь K1/K2, 6 сочленённых лап, раскрывающиеся крылья и солнечный удар рогом.',
    renderFrame: renderScarabColossus,
    getAnchors: () => ({
      head: { x: 8, y: 14, w: 8, h: 7 },
      item: { x: 3, y: 11, w: 6, h: 6 },
      pivot: { x: 20, y: 25 },
    }),
    codeSnippet: `function renderScarabColossus(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return renderScarabColossusImpl(frame, total, ctx);
}`,
  },
  {
    id: 'lava-salamander',
    name: 'Огненная Саламандра',
    subtitle: 'Вулканическая ящерица с жабрами (40×30)',
    kind: 'unit',
    tier: 'II',
    faction: 'Кузня Пекла',
    width: 40,
    height: 30,
    frameCount: 12,
    defaultFps: 11,
    attackName: 'Плевок огненным шаром',
    unitMeta: {
      coreSize: '30×18 зверь',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 16,
    },
    layersSpec: [
      '0. Мягкая тень под расставленными лапами',
      '1. Извивающийся хвост, магматические рёбра и гребень K1/K2',
      '2. Пылающие жаберные веера и вылет огненного шара в атаке',
    ],
    description:
      'Пещерная огненная саламандра уровня II (40×30 px, 12 к.): обсидиановая шкура с раскалёнными рёбрами, пылающие жабры и огненный снаряд при атаке.',
    renderFrame: renderLavaSalamander,
    getAnchors: () => ({
      head: { x: 6, y: 14, w: 8, h: 7 },
      item: { x: 2, y: 15, w: 5, h: 5 },
      pivot: { x: 20, y: 25 },
    }),
    codeSnippet: `function renderLavaSalamander(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return renderLavaSalamanderImpl(frame, total, ctx);
}`,
  },
  {
    id: 'plague-griffon',
    name: 'Грифон Рассвета',
    subtitle: 'Крылатый лев-орёл Цитадели (42×38)',
    kind: 'unit',
    tier: 'II',
    faction: 'Цитадель',
    width: 42,
    height: 38,
    frameCount: 12,
    defaultFps: 11,
    attackName: 'Воздушный выпад когтями',
    unitMeta: {
      coreSize: '30×26 крылья',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 16,
    },
    layersSpec: [
      '0. Тень парения на земле',
      '1. Двухплановые мраморные крылья с золотыми кончиками перьев',
      '2. Львиный круп, орлиный клюв, попона K1/K2 и удар когтями в пике',
    ],
    description:
      'Благородный грифон уровня II (42×38 px, 12 к.): мощные взмахи двуплановых крыльев, золотой орлиный клюв, доспехи K1/K2 и стремительное пикирование.',
    renderFrame: renderPlagueGriffon,
    getAnchors: () => ({
      head: { x: 8, y: 13, w: 9, h: 8 },
      item: { x: 9, y: 24, w: 7, h: 7 },
      pivot: { x: 21, y: 33 },
    }),
    codeSnippet: `function renderPlagueGriffon(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return renderPlagueGriffonImpl(frame, total, ctx);
}`,
  },
  {
    id: 'abyssal-reaper',
    name: 'Жнец Бездны',
    subtitle: 'Парящий призрак с костяными косами (38×40)',
    kind: 'unit',
    tier: 'II',
    faction: 'Некрополь',
    width: 38,
    height: 40,
    frameCount: 12,
    defaultFps: 10,
    attackName: 'Рассекающий удар двойными косами',
    unitMeta: {
      coreSize: '24×30 дух',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 14,
    },
    layersSpec: [
      '0. Парящая тень призрака на земле',
      '1. Оборванный плащ K1, открытая грудная клетка и ядро душ K2',
      '2. Парные изогнутые костяные косы и дуга удара в фазе атаки',
    ],
    description:
      'Нежить Некрополя уровня II (38×40 px, 12 к.): парящий жнец в плаще K1 со светящимся фонарём душ K2, огоньками блуждания и парными косами.',
    renderFrame: renderAbyssalReaper,
    getAnchors: () => ({
      head: { x: 14, y: 9, w: 9, h: 9 },
      item: { x: 6, y: 14, w: 8, h: 8 },
      pivot: { x: 20, y: 34 },
    }),
    codeSnippet: `function renderAbyssalReaper(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return renderAbyssalReaperImpl(frame, total, ctx);
}`,
  },
  {
    id: 'clockwork-rhino',
    name: 'Паровой Носорог',
    subtitle: 'Бронированный шагоход Гильдии (46×36)',
    kind: 'unit',
    tier: 'III',
    faction: 'Гильдия',
    width: 46,
    height: 36,
    frameCount: 14,
    defaultFps: 10,
    attackName: 'Паровой таран латунным рогом',
    unitMeta: {
      coreSize: '34×26 машина',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 20,
    },
    layersSpec: [
      '0. Мягкая тень под поршневыми опорами',
      '1. Латунный корпус с вращающейся шестернёй, дымоходом и флагом K1',
      '2. Тяжёлый бронзовый рог со снопом искр при таранной атаке',
    ],
    description:
      'Механический носорог Гильдии уровня III (46×36 px, 14 к.): вращающаяся шестерня на борту, дымящая труба, флаг державы K1, индикатор K2 и таран рогом.',
    renderFrame: renderClockworkRhino,
    getAnchors: () => ({
      head: { x: 9, y: 14, w: 10, h: 9 },
      item: { x: 3, y: 12, w: 6, h: 6 },
      pivot: { x: 23, y: 30 },
    }),
    codeSnippet: `function renderClockworkRhino(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return renderClockworkRhinoImpl(frame, total, ctx);
}`,
  },
];
