import { MaterialRamp, RAMPS, WATER_LINE } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import { UnitAction, UnitMode } from '../engine/unitAssembler';
import { CreatureGenes, RenderContextOptions } from './types';
import { resolveCreatureGenes } from '../engine/genes';

/**
 * Clean 4-tone material shading with top-left (-1, -1) key light.
 * Avoids noisy dithering and keeps ~6–8 crisp tones per creature.
 */
export function pickTopLeftTone(nx: number, ny: number, ramp: MaterialRamp): string {
  const lit = nx * 0.48 + ny * 0.85;
  if (lit < -0.58) return ramp.highlight;
  if (lit < 0.08) return ramp.mid;
  if (lit < 0.56) return ramp.shadow;
  return ramp.deep;
}

/**
 * Draws a clean borderless shaded capsule limb (no black outline).
 */
export function drawShadedLimb(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  ramp: MaterialRamp
): void {
  const steps = Math.max(3, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.4));
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const cx = x0 + (x1 - x0) * u;
    const cy = y0 + (y1 - y0) * u;
    buf.fillEllipse(cx, cy, radius, radius, (nx, ny) =>
      pickTopLeftTone(nx, ny - (1 - u) * 0.25, ramp)
    );
  }
}

/**
 * Draws an arched horn, tusk, claw, or crest using 4 ivory/bone tones.
 */
export function drawCurvedHorn(
  buf: PixelBuffer,
  baseX: number,
  baseY: number,
  tipX: number,
  tipY: number,
  bendX: number,
  bendY: number,
  baseRadius: number,
  ramp: MaterialRamp = RAMPS.bone
): void {
  const steps = Math.max(5, Math.ceil(Math.hypot(tipX - baseX, tipY - baseY) * 1.6));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const inv = 1 - t;
    const x = inv * inv * baseX + 2 * inv * t * bendX + t * t * tipX;
    const y = inv * inv * baseY + 2 * inv * t * bendY + t * t * tipY;
    const r = Math.max(0.45, baseRadius * (1 - t * 0.72));
    const color =
      t > 0.75 ? ramp.highlight : t > 0.35 ? ramp.mid : ramp.shadow;
    if (r <= 0.75) {
      buf.setPixel(Math.round(x), Math.round(y), color);
    } else {
      buf.fillEllipse(x, y, r, r, color);
    }
  }
}

/**
 * Draws clean water surface ripples and clips everything below `waterY`
 * so swimming creatures show ONLY their upper body above water.
 */
export function clipToSwimUpperBody(
  buf: PixelBuffer,
  waterY: number,
  leftX: number,
  rightX: number,
  frame: number
): void {
  // Strip any submerged lower pixels below waterY
  for (let y = waterY + 1; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      buf.setPixel(x, y, null);
    }
  }
  const spanL = Math.max(2, leftX);
  const spanR = Math.min(buf.width - 3, rightX);
  // Subtle translucent deep-water ripple veil below the waterline
  for (let x = spanL; x <= spanR; x++) {
    const waveOffset = Math.round(Math.sin(x * 0.35 + frame * 0.7) * 0.9);
    const wy = Math.min(buf.height - 3, waterY + waveOffset);
    for (let y = wy + 2; y < Math.min(buf.height - 1, waterY + 6); y++) {
      if ((x + y + frame) % 3 !== 0) {
        buf.setPixel(x, y, '#0C355477');
      }
    }
    const hasBodyAbove =
      buf.getPixel(x, wy - 1) !== null ||
      buf.getPixel(x, wy - 2) !== null ||
      buf.getPixel(x - 1, wy - 1) !== null ||
      buf.getPixel(x + 1, wy - 1) !== null;
    const isFoam = (x + frame * 2) % 7 < 2;
    if (hasBodyAbove || (x + frame) % 4 < 2) {
      buf.setPixel(x, wy, isFoam ? WATER_LINE.light : WATER_LINE.mid);
      if (isFoam && wy + 1 < buf.height - 1) {
        buf.setPixel(x, wy + 1, RAMPS.ice.mid);
      }
    }
  }
}

/**
 * Applies standard combat / death / zombie / hit whole-sprite transforms
 * cleanly inside the sprite's 1px margin without external clipping.
 */
export function finalizeEraCreatureAction(
  sprite: PixelBuffer,
  frame: number,
  total: number,
  pivotX: number,
  pivotY: number,
  action: UnitAction
): PixelBuffer {
  const p = frame / Math.max(1, total);
  if (action === 'hit') {
    const flash = Math.abs(Math.sin(p * Math.PI * 2));
    return sprite.applyColorOverlay(
      flash > 0.5 ? '#FFFFFF' : '#FF1212',
      0.52 + flash * 0.24
    );
  }
  if (action === 'death') {
    const darken = p > 0.28 ? Math.min(0.8, (p - 0.28) * 1.45) : 0;
    const alpha = p > 0.7 ? Math.max(0.32, 1 - (p - 0.7) * 1.8) : 1;
    const progress = Math.min(1, p * 1.4);

    if (sprite.width > sprite.height + 6) {
      // Wide quadruped/dinosaur collapses onto its side onto the ground plane
      const tiltDeg = Math.round(progress * 22);
      const safePivotX = Math.round(sprite.width * 0.5);
      const safePivotY = Math.round(sprite.height * 0.65);
      const tilted = sprite.rotateAround(safePivotX, safePivotY, tiltDeg);
      const collapsed = new PixelBuffer(sprite.width, sprite.height);
      const groundY = sprite.height - 3;
      const squash = 1 - progress * 0.28;
      for (let y = 1; y < sprite.height - 1; y++) {
        for (let x = 1; x < sprite.width - 1; x++) {
          const c = tilted.getPixel(x, y);
          if (!c) continue;
          const ny = Math.min(
            sprite.height - 2,
            Math.max(1, Math.round(groundY - (groundY - y) * squash))
          );
          collapsed.setPixel(x, ny, c);
        }
      }
      return collapsed.applyColorOverlay('#090808', darken, alpha);
    }

    const rot = Math.min(80, p * 180);
    const safePivotX = Math.round(sprite.width * 0.5);
    const safePivotY = Math.round(sprite.height * 0.58);
    return sprite
      .rotateAround(safePivotX, safePivotY, rot)
      .applyColorOverlay('#090808', darken, alpha);
  }
  if (action === 'zombie') {
    return sprite.applyZombieTransform('#3B8130');
  }
  return sprite;
}

/**
 * Cleanly extracts 2..4 step discrete walk gait with 1px vertical body bounce.
 */
export function getWalkCycle(
  frame: number,
  total: number,
  action: UnitAction
): { stepIdx: number; phase: number; bounceY: number; legSwing: number } {
  if (action === 'idle') {
    const p = frame / Math.max(1, total);
    const breath = Math.sin(p * Math.PI * 2) > 0.35 ? -1 : 0;
    return { stepIdx: 0, phase: p, bounceY: breath, legSwing: 0 };
  }
  const p = frame / Math.max(1, total);
  const stepIdx = Math.floor(p * 4) % 4;
  // Walk bounce: body lifts by -1px on mid-stride frames 1 & 3 across 4 distinct leg positions
  const bounceY = stepIdx === 1 || stepIdx === 3 ? -1 : 0;
  const swings = [1.8, 0.8, -1.8, -0.8] as const;
  const legSwing = swings[stepIdx];
  return { stepIdx, phase: p, bounceY, legSwing };
}

export function getAppendageLevel(genes?: CreatureGenes): 0 | 1 | 2 {
  const g = resolveCreatureGenes(genes);
  if (g.appendages === 'none') return 0;
  if (g.appendages === 'ornate') return 2;
  return 1;
}

export function getEraModeAction(ctx?: RenderContextOptions): {
  mode: UnitMode;
  action: UnitAction;
  appLevel: 0 | 1 | 2;
} {
  return {
    mode: ctx?.unitMode ?? 'walk',
    action: ctx?.unitAction ?? 'normal',
    appLevel: getAppendageLevel(ctx?.genes),
  };
}
