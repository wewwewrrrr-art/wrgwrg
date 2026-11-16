import { RAMPS, VOID, WATER_LINE } from '../engine/palette';
import { PixelBuffer } from '../engine/pixelCanvas';
import {
  PixelMatrix,
  UnitAction,
  UnitMode,
  drawSlashArc,
  stampMatrix,
  UNIT_LEGEND,
} from '../engine/unitAssembler';
import { GOLEM_SPEC, renderUnitFromSpec } from './modularUnits';
import { PixelModelDef, RenderContextOptions } from './types';

/**
 * ============================================================================
 * HIGH-CRAFT CREATURES, ELEMENTALS, BOSSES & COMBAT VESSELS (12 TIERED MODELS)
 * ============================================================================
 * Sculpted anatomical pixel art with 4-stop top-left volumetric shading,
 * crisp silhouette read, surface micro-texture (scales, fur tufts, bark grain,
 * crystal facets, brass rivets, magma fissures), K1/K2 faction masks, fixed
 * `#11102B66` ground shadow, swim waterlines, and full action transforms.
 * ============================================================================
 */

function applyCreatureAction(
  sprite: PixelBuffer,
  frame: number,
  total: number,
  pivotX: number,
  pivotY: number,
  slashX: number,
  slashY: number,
  action: UnitAction
): PixelBuffer {
  const phase = frame / Math.max(1, total);
  const t = phase * Math.PI * 2;
  if (action === 'attack') {
    const swing = Math.sin(t);
    const out = sprite.rotateAround(pivotX, pivotY, swing * -20);
    if (swing > 0.15) {
      drawSlashArc(out, slashX, slashY, Math.min(1, swing));
    }
    return out;
  }
  if (action === 'hit') {
    const flash = Math.abs(Math.sin(t));
    return sprite.applyColorOverlay(flash > 0.5 ? '#FFFFFF' : '#FF1212', 0.55 + flash * 0.25);
  }
  if (action === 'death') {
    const rot = Math.min(80, phase * 180);
    const darken = Math.min(0.85, phase * 1.2);
    const alpha = Math.max(0.28, 1 - phase * 0.75);
    return sprite
      .rotateAround(pivotX, pivotY, rot)
      .applyColorOverlay('#090808', darken, alpha);
  }
  if (action === 'zombie') {
    return sprite.applyZombieTransform('#3B8130');
  }
  return sprite;
}

function applyCreatureShadow(
  _out: PixelBuffer,
  _pivotX: number,
  _pivotY: number,
  _width: number,
  _ctx?: RenderContextOptions
): void {
  // Delegated to unified shape-based, stageBg-adaptive soft shadow pass in renderModelWithContext
}

function drawSwimWaterline(
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

/**
 * 1. Alchemical Gel Slime (28x26, Tier I, 12f)
 * Translucent faceted gel dome with undulating pseudopod skirt, suspended skull
 * relic & glowing K2 core shard, rising micro-bubbles, and crisp glass speculars.
 */
function renderSlimeCube(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const buf = new PixelBuffer(28, 26);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const mode: UnitMode = ctx?.unitMode ?? 'walk';
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const squash = Math.sin(t);
  const rx = 7.5 + squash * 1.3;
  const ry = 6.2 - squash * 1.2;
  const cy = (mode === 'swim' ? 16 : 14) + Math.round(squash * 1.2);

  const sprite = new PixelBuffer(28, 26);

  // Translucent sculpted gel body with dome curvature + bottom ooze skirt
  sprite.fillEllipse(14, cy, rx, ry, (nx, ny) => {
    const rim = Math.hypot(nx, ny);
    if (ny > 0.55) return RAMPS.magenta.deep;
    if (nx > 0.5 || ny > 0.25) return RAMPS.magenta.shadow;
    if (rim > 0.8 && nx < 0.2 && ny < 0.2) return RAMPS.magenta.highlight;
    if (nx < -0.2 && ny < -0.3) return RAMPS.magenta.highlight;
    return RAMPS.magenta.mid;
  });

  // Dripping pseudopod puddles on base
  if (mode !== 'swim') {
    for (const [dx, w] of [
      [-6, 3],
      [-1, 4],
      [4, 3],
    ]) {
      const drip = Math.round(Math.sin(t + dx) * 0.6);
      sprite.fillEllipse(14 + dx, cy + Math.round(ry) - 1, w, 1.5 + drip * 0.3, RAMPS.magenta.deep);
    }
  }

  // Suspended bone skull + glowing K2 crystal relic drifting inside gel
  const driftY = cy + Math.round(Math.cos(t) * 1.1);
  const INNER_RELIC: PixelMatrix = [
    '.BBB.',
    'BqpqB',
    'BDqDB',
    '.a2b.',
    '..a..',
  ];
  stampMatrix(sprite, INNER_RELIC, 12, driftY - 3, UNIT_LEGEND);

  // Rising sparkling bubbles & curved glossy specular sheen
  const b1Y = cy + 3 - (frame % 6);
  sprite.setPixel(9, b1Y, RAMPS.cyanMask.highlight);
  sprite.setPixel(19, cy + 2 - ((frame + 3) % 6), '#FFFFFF');
  sprite.drawLine(9, cy - 3, 11, cy - 4, '#FFFFFF', 1);
  sprite.setPixel(8, cy - 2, '#FFFFFF');

  // Expressive dark gel eyes on left front slope
  sprite.fillRect(9, cy + 1, 2, 2, VOID);
  sprite.fillRect(12, cy + 1, 2, 2, VOID);
  sprite.setPixel(9, cy + 1, RAMPS.cyanMask.highlight);
  sprite.setPixel(12, cy + 1, RAMPS.cyanMask.highlight);

  const out = applyCreatureAction(sprite, frame, total, 14, 21, 5, cy, action);
  if (mode === 'swim') {
    drawSwimWaterline(out, 5, 22, 19, frame);
  } else if (action !== 'death') {
    applyCreatureShadow(out, 14, 22, 11, ctx);
  }

  buf.composite(out);
  return buf;
}

/**
 * 2. Dire Wolf (34x28, Tier I, 12f)
 * Muscular galloping wolf facing LEFT with sculpted haunches, bristling ruff,
 * pointed ears, fanged muzzle, armored K1/K2 war harness, and articulated 4 legs.
 */
function renderDireWolf(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const buf = new PixelBuffer(34, 28);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const mode: UnitMode = ctx?.unitMode ?? 'walk';
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const gallop = Math.sin(t);
  const bob = Math.round(Math.cos(t * 2) * 0.9);
  const by = (mode === 'swim' ? 19 : 16) + bob;

  const sprite = new PixelBuffer(34, 28);

  // Articulated bushy multi-tone tail curling right
  for (let i = 0; i < 8; i++) {
    const tx = 23 + i;
    const ty = by - 2 + Math.round(Math.sin(t - i * 0.45) * 1.4 - i * 0.25);
    const thick = i < 6 ? 2 : 1;
    sprite.fillRect(
      tx,
      ty,
      1,
      thick,
      i > 5 ? RAMPS.bone.highlight : i < 2 ? RAMPS.slate.shadow : i % 2 === 0 ? RAMPS.slate.mid : RAMPS.slate.highlight
    );
  }

  // Articulated back legs (drawn first for depth)
  if (mode !== 'swim') {
    const strideBack = Math.round(gallop * 2.5);
    // Rear far leg
    sprite.drawLine(22, by + 1, 24 - strideBack, by + 4, RAMPS.slate.deep, 2);
    sprite.drawLine(24 - strideBack, by + 4, 23 - strideBack, 23, RAMPS.slate.deep, 1);
    // Front far leg
    sprite.drawLine(12, by + 1, 10 + strideBack, by + 4, RAMPS.slate.deep, 2);
    sprite.drawLine(10 + strideBack, by + 4, 9 + strideBack, 23, RAMPS.slate.deep, 1);
  }

  // Muscular arched wolf ribcage, tucked loin & hindquarters
  sprite.fillEllipse(18, by, 7.2, 3.6, (nx, ny) => {
    if (ny < -0.35 && nx < 0.2) return RAMPS.slate.highlight;
    if (ny > 0.35 || nx > 0.4) return RAMPS.slate.deep;
    return RAMPS.slate.mid;
  });
  // Shaggy layered chest ruff
  sprite.fillEllipse(12, by - 1, 4.3, 4.1, (nx, ny) =>
    nx < -0.25 || ny < -0.3 ? RAMPS.marble.highlight : ny > 0.4 ? RAMPS.slate.shadow : RAMPS.marble.mid
  );

  // Armored K1 war-saddle + K2 iron collar crest
  sprite.fillEllipse(18, by - 1, 3.6, 2.5, (nx, ny) =>
    ny < -0.2 ? RAMPS.magenta.highlight : nx > 0.3 ? RAMPS.magenta.deep : RAMPS.magenta.mid
  );
  sprite.drawLine(13, by - 3, 14, by + 2, RAMPS.gold.mid, 1);
  sprite.fillRect(12, by - 2, 2, 2, RAMPS.cyanMask.highlight);

  // Sculpted wolf head, shaded pointed ears, fanged jaw & fierce glowing eye (facing LEFT)
  sprite.fillEllipse(9, by - 4, 4, 3, (nx, ny) =>
    ny < -0.2 ? RAMPS.slate.highlight : nx > 0.3 ? RAMPS.slate.shadow : RAMPS.slate.mid
  );
  // Pointed ears with warm inner ear tone
  sprite.drawLine(10, by - 6, 11, by - 9, RAMPS.slate.highlight, 1);
  sprite.setPixel(11, by - 8, RAMPS.slate.deep);
  sprite.drawLine(12, by - 6, 13, by - 9, RAMPS.slate.mid, 1);
  // Tapered muzzle + open jaw + ivory fangs + shaded nose tip
  sprite.fillRect(3, by - 4, 5, 2, RAMPS.slate.highlight);
  sprite.setPixel(3, by - 4, '#3D3532');
  sprite.fillRect(4, by - 1, 4, 1, RAMPS.slate.shadow);
  sprite.setPixel(4, by - 2, RAMPS.bone.highlight); // Fang
  sprite.setPixel(6, by - 2, RAMPS.bone.highlight);
  sprite.setPixel(7, by - 5, RAMPS.lava.highlight); // Glowing predator eye

  // Articulated foreground legs with clawed paws
  if (mode !== 'swim') {
    const strideFront = Math.round(-gallop * 2.8);
    // Front near leg
    sprite.drawLine(11, by + 1, 9 + strideFront, by + 4, RAMPS.slate.highlight, 2);
    sprite.drawLine(9 + strideFront, by + 4, 8 + strideFront, 23, RAMPS.slate.mid, 1);
    sprite.setPixel(7 + strideFront, 23, RAMPS.bone.highlight);
    // Rear near leg
    sprite.drawLine(21, by + 1, 22 - strideFront, by + 4, RAMPS.slate.mid, 2);
    sprite.drawLine(22 - strideFront, by + 4, 21 - strideFront, 23, RAMPS.slate.shadow, 1);
    sprite.setPixel(20 - strideFront, 23, RAMPS.bone.mid);
  }

  const out = applyCreatureAction(sprite, frame, total, 17, 23, 3, by - 2, action);
  if (mode === 'swim') {
    drawSwimWaterline(out, 5, 29, 21, frame);
  } else if (action !== 'death') {
    applyCreatureShadow(out, 17, 24, 15, ctx);
  }

  buf.composite(out);
  return buf;
}

/**
 * 3. Ancient Forest Treant (38x38, Tier II, 12f)
 * Twisted gnarled oak titan with flared roots, furrowed bark, glowing amber
 * brow & open K2 heartwood rune hollow, crooked branch arms, and K1 blossom canopy.
 */
function renderForestTreant(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const buf = new PixelBuffer(38, 38);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const mode: UnitMode = ctx?.unitMode ?? 'walk';
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const sway = Math.round(Math.sin(t) * 1.2);
  const step = Math.round(Math.sin(t) * 1.8);
  const cy = mode === 'swim' ? 23 : 20;

  const sprite = new PixelBuffer(38, 38);

  // Far swinging branch arm
  sprite.drawLine(24, cy - 3, 29, cy - 1 + step, RAMPS.timber.deep, 2);
  sprite.drawLine(29, cy - 1 + step, 32, cy + 4 + step, RAMPS.timber.shadow, 2);
  sprite.setPixel(33, cy + 5 + step, RAMPS.moss.highlight);

  // Flared root legs (left forward, right trailing)
  if (mode !== 'swim') {
    const lFoot = Math.max(-1, step);
    const rFoot = Math.max(-1, -step);
    for (let y = cy + 5; y <= 31 + lFoot; y++) {
      const flare = y >= 29 ? 1 : 0;
      sprite.fillRect(13 - flare, y, 4 + flare, 1, RAMPS.timber.mid);
      sprite.setPixel(13 - flare, y, RAMPS.timber.highlight);
    }
    for (let y = cy + 5; y <= 31 + rFoot; y++) {
      const flare = y >= 29 ? 1 : 0;
      sprite.fillRect(21, y, 4 + flare, 1, RAMPS.timber.deep);
    }
  }

  // Sculpted tapered & furrowed ancient oak trunk (no blocky rectangle!)
  for (let dy = -7; dy <= 6; dy++) {
    const halfW = Math.round(5.5 + (dy + 7) * 0.12 + Math.sin(dy * 0.7) * 0.7);
    for (let dx = -halfW; dx <= halfW; dx++) {
      const nx = dx / halfW;
      const furrow = (dx + dy * 2) % 4 === 0;
      const c =
        nx < -0.35
          ? RAMPS.timber.highlight
          : nx > 0.38 || furrow
            ? RAMPS.timber.deep
            : RAMPS.timber.mid;
      sprite.setPixel(19 + dx, cy + dy, c);
    }
  }

  // Glowing ancient eyes beneath bark brow ridge + glowing K2 rune hollow in chest
  sprite.fillRect(14, cy - 5, 10, 2, RAMPS.timber.deep);
  sprite.fillRect(15, cy - 3, 2, 2, RAMPS.gold.highlight);
  sprite.fillRect(19, cy - 3, 2, 2, RAMPS.gold.highlight);
  sprite.fillEllipse(18, cy + 2, 2.5, 3, VOID);
  sprite.fillEllipse(18, cy + 2, 1.5, 2, RAMPS.cyanMask.highlight);
  sprite.setPixel(18, cy + 2, '#FFFFFF');

  // Moss shoulders & hanging beard vines
  sprite.fillEllipse(14, cy - 6, 3, 2, RAMPS.moss.highlight);
  sprite.fillEllipse(24, cy - 6, 3, 2, RAMPS.moss.mid);

  // Foreground crooked gnarly oak arm with thorny claws
  sprite.drawLine(14, cy - 3, 8, cy - 1 - step, RAMPS.timber.highlight, 2);
  sprite.drawLine(8, cy - 1 - step, 6, cy + 5 - step, RAMPS.timber.mid, 2);
  sprite.setPixel(5, cy + 6 - step, RAMPS.timber.highlight);
  sprite.setPixel(7, cy + 6 - step, RAMPS.timber.shadow);

  // Multi-lobed lush swaying canopy with K1 glowing blossoms & golden fruit
  const lobes = [
    { cx: 12 + sway, cy: cy - 11, rx: 6, ry: 4.5 },
    { cx: 26 + sway, cy: cy - 11, rx: 6, ry: 4.5 },
    { cx: 19 + sway, cy: cy - 14, rx: 8, ry: 5.5 },
  ];
  for (const l of lobes) {
    sprite.fillEllipse(l.cx, l.cy, l.rx, l.ry, (nx, ny, px, py) => {
      const leaf = (px * 3 + py * 5) % 6 === 0;
      if (ny > 0.45 || nx > 0.45) return RAMPS.moss.deep;
      if (ny < -0.3 && nx < 0.25) return RAMPS.moss.highlight;
      return leaf ? RAMPS.moss.shadow : RAMPS.moss.mid;
    });
  }
  // K1 blossoms & K2 spirit buds on canopy
  for (const [bx, by] of [
    [13 + sway, cy - 12],
    [20 + sway, cy - 16],
    [25 + sway, cy - 11],
  ]) {
    sprite.fillRect(bx, by, 2, 2, RAMPS.magenta.highlight);
    sprite.setPixel(bx + 1, by + 1, RAMPS.cyanMask.highlight);
  }
  sprite.drawLine(11 + sway, cy - 7, 11 + sway, cy - 4, RAMPS.moss.shadow, 1);
  sprite.setPixel(11 + sway, cy - 3, RAMPS.gold.highlight);

  const out = applyCreatureAction(sprite, frame, total, 19, 32, 5, cy, action);
  if (mode === 'swim') {
    drawSwimWaterline(out, 6, 31, 27, frame);
  } else if (action !== 'death') {
    applyCreatureShadow(out, 19, 33, 15, ctx);
  }

  buf.composite(out);
  return buf;
}

/**
 * 4. Floating Crystal Elemental (34x36, Tier II, 12f)
 * Levitating faceted arcane sentinel: spired crystal crown, glowing K2 rune halo,
 * beveled octahedral chest with orbiting waist shards, and articulated floating fists.
 */
function renderCrystalElemental(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const buf = new PixelBuffer(34, 36);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const hover = Math.round(Math.sin(t) * 1.6);
  const cx = 17;
  const cy = 17 + hover;

  const sprite = new PixelBuffer(34, 36);

  // Rotating arcane rune halo behind shoulders
  for (let i = 0; i < 6; i++) {
    const a = t + (i * Math.PI * 2) / 6;
    const hx = Math.round(cx + Math.cos(a) * 10);
    const hy = Math.round(cy - 3 + Math.sin(a) * 5);
    sprite.setPixel(hx, hy, i % 2 === 0 ? RAMPS.cyanMask.highlight : RAMPS.ice.highlight);
  }

  // Faceted tapering lower crystal tail + orbiting levitating shards
  for (let dy = 3; dy <= 10; dy++) {
    const hw = Math.max(1, Math.round((10 - dy) * 0.55));
    for (let dx = -hw; dx <= hw; dx++) {
      sprite.setPixel(
        cx + dx,
        cy + dy,
        dx < 0 ? RAMPS.magenta.mid : dx === 0 ? RAMPS.cyanMask.highlight : RAMPS.magenta.deep
      );
    }
  }
  const shardOrbit = Math.round(Math.cos(t) * 5);
  sprite.drawCrystal(cx - 5 + Math.round(shardOrbit * 0.4), cy + 11, 4, -1, 0.9, RAMPS.ice);
  sprite.drawCrystal(cx + 5 - Math.round(shardOrbit * 0.4), cy + 11, 4, 1, 0.3, RAMPS.magenta);

  // Broad sculpted crystal chest + beveled K2 glowing energy heart
  for (let dy = -6; dy <= 3; dy++) {
    const hw = Math.round(6.5 - Math.abs(dy + 1) * 0.55);
    for (let dx = -hw; dx <= hw; dx++) {
      const isCore = Math.hypot(dx, dy + 1) <= 2.3;
      const color = isCore
        ? Math.hypot(dx, dy + 1) < 1.1
          ? '#FFFFFF'
          : RAMPS.cyanMask.highlight
        : dx < -2 && dy < 0
          ? RAMPS.magenta.highlight
          : dx > 2 || dy > 1
            ? RAMPS.magenta.deep
            : dx > 0
              ? RAMPS.magenta.shadow
              : RAMPS.magenta.mid;
      sprite.setPixel(cx + dx, cy + dy, color);
    }
  }

  // Multi-spired crystalline head & glowing visor eyes (facing LEFT)
  sprite.drawCrystal(cx, cy - 6, 7, 0, 0.95, RAMPS.magenta);
  sprite.drawCrystal(cx - 4, cy - 5, 5, -1, 0.8, RAMPS.ice);
  sprite.drawCrystal(cx + 4, cy - 5, 5, 1, 0.25, RAMPS.ice);
  sprite.setPixel(cx - 2, cy - 8, '#FFFFFF');
  sprite.setPixel(cx, cy - 8, RAMPS.cyanMask.highlight);

  // Floating articulated crystal gauntlets (shoulder shard + clawed fist)
  const lY = cy + Math.round(Math.cos(t) * 2.2);
  const rY = cy - Math.round(Math.cos(t) * 2.2);
  sprite.drawCrystal(7, lY + 2, 6, -1, 0.9, RAMPS.cyanMask);
  sprite.fillRect(5, lY + 1, 3, 3, RAMPS.magenta.highlight);
  sprite.setPixel(4, lY + 3, '#FFFFFF');

  sprite.drawCrystal(27, rY + 2, 6, 1, 0.3, RAMPS.cyanMask);
  sprite.fillRect(26, rY + 1, 3, 3, RAMPS.magenta.shadow);

  const out = applyCreatureAction(sprite, frame, total, cx, 29, 5, cy - 1, action);
  if (action !== 'death') {
    applyCreatureShadow(out, cx, 30, 12, ctx);
  }

  buf.composite(out);
  return buf;
}

/**
 * 5. Frost Yeti (36x36, Tier II, 12f)
 * Hunched snow-fur glacier beast with shaggy fur tufts, jagged shoulder ice
 * spikes, curved mammoth horns, K1/K2 war-belt & bracers, and heavy fists.
 */
function renderFrostYeti(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const buf = new PixelBuffer(36, 36);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const mode: UnitMode = ctx?.unitMode ?? 'walk';
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const stomp = Math.round(Math.sin(t) * 1.8);
  const bounce = Math.round(Math.abs(Math.sin(t)) * -1);
  const cy = (mode === 'swim' ? 21 : 17) + bounce;

  const sprite = new PixelBuffer(36, 36);

  // Far swinging ape arm
  sprite.drawLine(25, cy - 2, 29, cy + 4 + stomp, RAMPS.ice.mid, 4);
  sprite.fillEllipse(29, cy + 7 + stomp, 2.5, 2.5, RAMPS.ice.deep);

  // Heavy stomping legs with shaggy fur cuffs
  if (mode !== 'swim') {
    const lDrop = Math.max(0, stomp);
    const rDrop = Math.max(0, -stomp);
    sprite.fillEllipse(14, cy + 9 + lDrop, 2.8, 3.5, RAMPS.marble.mid);
    sprite.fillRect(11, cy + 11 + lDrop, 4, 2, RAMPS.ice.deep);
    sprite.fillEllipse(22, cy + 9 + rDrop, 2.8, 3.5, RAMPS.ice.mid);
    sprite.fillRect(20, cy + 11 + rDrop, 4, 2, RAMPS.slate.deep);
  }

  // Broad hunched fur torso with shaggy stepped fur contour (no rectangle!)
  sprite.fillEllipse(18, cy + 1, 8.2, 7.2, (nx, ny, px, py) => {
    const tuft = (px + py * 2) % 5 === 0;
    if (ny < -0.3 && nx < 0.25) return RAMPS.marble.highlight;
    if (nx > 0.35 || ny > 0.45) return RAMPS.ice.mid;
    return tuft ? RAMPS.marble.shadow : RAMPS.marble.mid;
  });

  // Braided K1 war-belt & glowing K2 rune buckle
  sprite.fillEllipse(18, cy + 5, 7, 1.8, (nx) =>
    nx < -0.2 ? RAMPS.magenta.highlight : nx > 0.3 ? RAMPS.magenta.deep : RAMPS.magenta.mid
  );
  sprite.fillRect(14, cy + 4, 3, 3, RAMPS.cyanMask.highlight);

  // Jagged glacier crystals erupting from shoulders
  sprite.drawCrystal(23, cy - 4, 7, 1, 0.25, RAMPS.ice);
  sprite.drawCrystal(26, cy - 1, 5, 1, 0.3, RAMPS.ice);

  // Fierce horned yeti skull & frosty blue face (facing LEFT)
  sprite.fillEllipse(14, cy - 6, 5.2, 4.5, (nx, ny) =>
    ny < -0.25 ? RAMPS.marble.highlight : nx > 0.3 ? RAMPS.ice.mid : RAMPS.marble.mid
  );
  sprite.fillEllipse(12, cy - 5, 3, 2.5, RAMPS.ice.deep); // Deep face shadow
  sprite.setPixel(10, cy - 6, RAMPS.cyanMask.highlight); // Glowing frost eyes
  sprite.setPixel(13, cy - 6, RAMPS.cyanMask.highlight);
  sprite.setPixel(10, cy - 3, RAMPS.bone.highlight); // Lower tusks
  sprite.setPixel(13, cy - 3, RAMPS.bone.highlight);
  // Curved mammoth horns
  sprite.drawRibArch(11, cy - 9, 8, cy - 13, 10, cy - 11, 2, RAMPS.bone);
  sprite.drawRibArch(17, cy - 9, 20, cy - 13, 18, cy - 11, 2, RAMPS.bone);

  // Foreground massive fur arm + K1 bracer + icy claws
  sprite.drawLine(11, cy - 2, 7, cy + 5 - stomp, RAMPS.marble.highlight, 4);
  sprite.fillRect(5, cy + 3 - stomp, 4, 2, RAMPS.magenta.mid);
  sprite.fillEllipse(7, cy + 7 - stomp, 3, 2.5, RAMPS.ice.mid);
  sprite.setPixel(5, cy + 9 - stomp, RAMPS.bone.highlight);
  sprite.setPixel(7, cy + 9 - stomp, RAMPS.bone.highlight);

  const out = applyCreatureAction(sprite, frame, total, 18, 30, 5, cy, action);
  if (mode === 'swim') {
    drawSwimWaterline(out, 6, 29, 25, frame);
  } else if (action !== 'death') {
    applyCreatureShadow(out, 18, 31, 16, ctx);
  }

  buf.composite(out);
  return buf;
}

/**
 * 6. Bone Wyvern (38x34, Tier II, 12f)
 * Flying skeletal drake with horned skull, open fanged jaw, exposed ribcage,
 * clawed 3-spar scalloped K1 wing membrane, K2 chest crest & barbed whip tail.
 */
function renderBoneWyvern(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const buf = new PixelBuffer(38, 34);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const hover = Math.round(Math.sin(t) * 1.6);
  const wingFlap = Math.sin(t);
  const action: UnitAction = ctx?.unitAction ?? 'normal';

  const wyvern = new PixelBuffer(38, 34);

  // Articulated bone spine tail with barbed K1 stinger
  for (let i = 0; i < 11; i++) {
    const tx = 21 + i;
    const ty = Math.round(18 + hover + Math.sin(t - i * 0.5) * 1.8);
    wyvern.fillRect(tx, ty, 2, 2, i % 2 === 0 ? RAMPS.bone.highlight : RAMPS.bone.mid);
    if (i % 3 === 0) wyvern.setPixel(tx, ty - 1, RAMPS.bone.highlight);
    if (i === 10) wyvern.fillRect(tx + 1, ty - 1, 2, 2, RAMPS.magenta.highlight);
  }

  // Far wing silhouette
  const backTipY = Math.round(9 + hover - wingFlap * 4.5);
  wyvern.drawLine(17, 15 + hover, 23, backTipY, RAMPS.bone.shadow, 1);
  for (let wx = 18; wx <= 25; wx++) {
    const p = (wx - 18) / 7;
    const ty = Math.round((15 + hover) * (1 - p) + (backTipY + 1) * p);
    wyvern.fillRect(wx, ty, 1, 4, RAMPS.magenta.deep);
  }

  // Ribbed skeletal torso + K1/K2 saddle armor
  wyvern.fillEllipse(17, 17 + hover, 5.5, 3.5, (nx, ny, px) => {
    if (ny > 0.25 && px % 2 === 0) return RAMPS.bone.deep;
    return ny < -0.2 ? RAMPS.bone.highlight : RAMPS.bone.mid;
  });
  wyvern.fillRect(14, 14 + hover, 6, 3, RAMPS.magenta.mid);
  wyvern.fillRect(15, 14 + hover, 3, 2, RAMPS.cyanMask.highlight);

  // Curved neck vertebrae & horned dragon skull facing LEFT
  wyvern.drawLine(13, 16 + hover, 10, 14 + hover, RAMPS.bone.highlight, 2);
  const HEAD_WYVERN: PixelMatrix = [
    '..BB.B',
    '.BB1B.',
    'BBDBB.',
    'B.qqq.',
  ];
  stampMatrix(wyvern, HEAD_WYVERN, 4, 11 + hover, UNIT_LEGEND);

  // Hanging bone talons
  wyvern.drawLine(16, 20 + hover, 15, 24 + hover, RAMPS.bone.mid, 1);
  wyvern.setPixel(14, 24 + hover, RAMPS.bone.highlight);
  wyvern.drawLine(20, 20 + hover, 21, 24 + hover, RAMPS.bone.shadow, 1);

  // Multi-spar skeletal wing with scalloped tattered K1 membrane
  const apexX = 23;
  const apexY = Math.round(7 + hover - wingFlap * 5.8);
  const outerX = 32;
  const outerY = Math.round(11 + hover - wingFlap * 4.5);
  wyvern.drawLine(17, 15 + hover, apexX, apexY, RAMPS.bone.highlight, 2);
  wyvern.drawLine(apexX, apexY, outerX, outerY, RAMPS.bone.mid, 1);
  wyvern.drawLine(apexX, apexY, 27, apexY + 8, RAMPS.bone.mid, 1);
  wyvern.setPixel(apexX, apexY - 1, RAMPS.cyanMask.highlight);

  for (let wx = 18; wx <= outerX; wx++) {
    const p = (wx - 18) / (outerX - 18);
    const topY =
      wx <= apexX
        ? Math.round((15 + hover) * (1 - (wx - 18) / (apexX - 18)) + apexY * ((wx - 18) / (apexX - 18)))
        : Math.round(apexY * (1 - (wx - apexX) / (outerX - apexX)) + outerY * ((wx - apexX) / (outerX - apexX)));
    const scallop = Math.round(Math.sin(p * Math.PI * 3) * 1.4);
    const botY = Math.round(topY + 6 + (1 - p) * 2 - Math.abs(scallop));
    for (let wy = topY + 1; wy <= botY; wy++) {
      wyvern.setPixel(
        wx,
        wy,
        wy < topY + 3 ? RAMPS.magenta.highlight : wx > 27 ? RAMPS.magenta.shadow : RAMPS.magenta.mid
      );
    }
  }

  const out = applyCreatureAction(wyvern, frame, total, 18, 26, 4, 14 + hover, action);
  if (action !== 'death') {
    applyCreatureShadow(out, 18, 28, 13, ctx);
  }

  buf.composite(out);
  return buf;
}

/**
 * 7. Clockwork Mech Spider-Bot (38x32, Tier II, 12f)
 * Riveted Guild brass & gunmetal arachnid: domed K1 carapace with glowing
 * boiler vents, rotating K2 radar gear + smokestack puffs, tri-lens optic,
 * brass mandibles, and 6 multi-jointed legs in alternating tripod gait.
 */
function renderMechSpider(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const buf = new PixelBuffer(38, 32);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const mode: UnitMode = ctx?.unitMode ?? 'walk';
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const bob = Math.round(Math.sin(t * 2) * 0.7);
  const cy = (mode === 'swim' ? 19 : 16) + bob;

  const sprite = new PixelBuffer(38, 32);

  // Far-side 3 articulated legs
  if (mode !== 'swim') {
    [-5, 1, 7].forEach((ox, idx) => {
      const lift = Math.round(Math.sin(t + idx * Math.PI + Math.PI) * 1.8);
      const bx = 20 + ox;
      const kx = bx + 4;
      const ky = cy - 2 - lift;
      const fx = bx + 6;
      const fy = 26 - Math.max(0, lift);
      sprite.drawLine(bx, cy + 1, kx, ky, RAMPS.slate.shadow, 1);
      sprite.drawLine(kx, ky, fx, fy, RAMPS.gold.deep, 1);
    });
  }

  // Rear brass pressure tank + K1 enameled abdomen dome
  sprite.fillEllipse(24, cy - 1, 5.5, 4.5, (nx, ny) =>
    ny < -0.3 ? RAMPS.gold.highlight : nx > 0.35 ? RAMPS.gold.deep : RAMPS.gold.mid
  );
  sprite.fillRect(23, cy - 7, 2, 3, RAMPS.slate.mid); // Exhaust chimney
  const puffY = cy - 9 - (frame % 4);
  sprite.setPixel(24 + (frame % 2), puffY, RAMPS.marble.highlight);

  // Armored chassis thorax with K1 plates & glowing orange boiler core slit
  sprite.fillEllipse(16, cy, 6.8, 4.8, (nx, ny) => {
    if (ny < -0.25 && nx < 0.25) return RAMPS.magenta.highlight;
    if (nx > 0.35 || ny > 0.35) return RAMPS.magenta.deep;
    return RAMPS.magenta.mid;
  });
  sprite.fillRect(14, cy + 1, 5, 2, RAMPS.lava.highlight);
  sprite.drawLine(11, cy - 2, 21, cy - 2, RAMPS.gold.highlight, 1); // Riveted brass rim

  // Rotating dorsal K2 radar gear atop carapace
  const cogX = 16 + Math.round(Math.cos(t) * 2);
  sprite.fillRect(14, cy - 6, 4, 2, RAMPS.cyanMask.mid);
  sprite.setPixel(cogX, cy - 7, RAMPS.cyanMask.highlight);
  sprite.setPixel(cogX, cy - 5, '#FFFFFF');

  // Tri-lens glowing sensor visor + articulated brass mandibles facing LEFT
  sprite.fillEllipse(10, cy, 2.5, 2.5, RAMPS.obsidian.deep);
  sprite.fillRect(9, cy - 1, 2, 2, RAMPS.cyanMask.highlight);
  sprite.setPixel(9, cy - 1, '#FFFFFF');
  sprite.drawLine(10, cy + 3, 7, cy + 4, RAMPS.gold.highlight, 1);
  sprite.setPixel(6, cy + 3, RAMPS.slate.highlight);

  // Near-side 3 articulated brass arachnid legs
  if (mode !== 'swim') {
    [-6, 0, 6].forEach((ox, idx) => {
      const lift = Math.round(Math.sin(t + idx * Math.PI) * 2);
      const bx = 14 + ox;
      const kx = bx - 4;
      const ky = cy - 2 - lift;
      const fx = bx - 6;
      const fy = 26 - Math.max(0, lift);
      sprite.drawLine(bx, cy + 2, kx, ky, RAMPS.slate.highlight, 2);
      sprite.drawLine(kx, ky, fx, fy, RAMPS.gold.highlight, 1);
      sprite.setPixel(kx, ky - 1, RAMPS.gold.mid); // Brass knee joint
      sprite.setPixel(fx, fy, RAMPS.slate.highlight); // Steel foot claw
    });
  }

  const out = applyCreatureAction(sprite, frame, total, 19, 26, 5, cy, action);
  if (mode === 'swim') {
    drawSwimWaterline(out, 6, 31, 22, frame);
  } else if (action !== 'death') {
    applyCreatureShadow(out, 19, 27, 17, ctx);
  }

  buf.composite(out);
  return buf;
}

/**
 * 8. Magma Colossus Titan (40x40, Tier III, 16f)
 * Towering obsidian volcano titan: horned basalt helmet, sculpted shoulder
 * plates with K1/K2 runes, glowing furnace chest core + lava veins, heavy
 * boulder-armored gauntlets with glowing knuckles, and stomping basalt legs.
 */
function renderMagmaColossus(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const buf = new PixelBuffer(40, 40);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const mode: UnitMode = ctx?.unitMode ?? 'walk';
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const stomp = Math.round(Math.sin(t) * 2);
  const pulse = Math.sin(t * 2) > 0;
  const bounce = Math.round(Math.abs(Math.sin(t)) * -1);
  const cy = (mode === 'swim' ? 23 : 19) + bounce;

  const sprite = new PixelBuffer(40, 40);

  // Far basalt arm
  sprite.drawLine(28, cy - 3, 32, cy + 4 + stomp, RAMPS.obsidian.deep, 4);
  sprite.fillEllipse(32, cy + 7 + stomp, 3.2, 3.2, RAMPS.obsidian.deep);
  sprite.setPixel(32, cy + 8 + stomp, RAMPS.lava.mid);

  // Heavy stomping pillar legs with glowing knee seams
  if (mode !== 'swim') {
    const lY = Math.max(0, stomp);
    const rY = Math.max(0, -stomp);
    sprite.fillEllipse(15, cy + 10 + lY, 3, 4.5, (nx) =>
      nx < 0 ? RAMPS.obsidian.mid : RAMPS.obsidian.deep
    );
    sprite.fillRect(13, cy + 9 + lY, 3, 1, RAMPS.lava.mid);
    sprite.fillEllipse(24, cy + 10 + rY, 3, 4.5, RAMPS.obsidian.deep);
    sprite.fillRect(23, cy + 9 + rY, 2, 1, RAMPS.lava.shadow);
  }

  // Sculpted volcanic chest + glowing molten furnace core + pulsing veins
  sprite.fillEllipse(20, cy, 8.8, 7.8, (nx, ny) => {
    if (ny < -0.35 && nx < 0.2) return RAMPS.obsidian.highlight;
    if (nx > 0.35 || ny > 0.4) return RAMPS.obsidian.deep;
    return RAMPS.obsidian.mid;
  });
  // Glowing lava core & radiating rib fissures
  sprite.fillEllipse(19, cy, 3, 3.5, (nx, ny) =>
    Math.hypot(nx, ny) < 0.55 ? '#FFFFFF' : pulse ? RAMPS.lava.highlight : RAMPS.lava.mid
  );
  sprite.drawLine(14, cy - 3, 17, cy - 1, RAMPS.lava.mid, 1);
  sprite.drawLine(22, cy - 1, 25, cy - 3, RAMPS.lava.mid, 1);
  sprite.drawLine(15, cy + 4, 18, cy + 2, RAMPS.lava.mid, 1);

  // Horned basalt shoulder pauldrons with K1/K2 runic plates
  sprite.fillEllipse(11, cy - 5, 4.5, 3.5, (nx, ny) =>
    ny < -0.2 ? RAMPS.magenta.highlight : nx > 0.3 ? RAMPS.magenta.deep : RAMPS.magenta.mid
  );
  sprite.fillRect(10, cy - 6, 2, 2, RAMPS.cyanMask.highlight);
  sprite.drawCrystal(10, cy - 7, 5, -1, 0.85, RAMPS.obsidian);

  sprite.fillEllipse(28, cy - 5, 4.5, 3.5, (nx, ny) =>
    ny < -0.2 ? RAMPS.magenta.mid : RAMPS.magenta.deep
  );
  sprite.fillRect(27, cy - 6, 2, 2, RAMPS.cyanMask.mid);
  sprite.drawCrystal(29, cy - 7, 5, 1, 0.25, RAMPS.obsidian);

  // Sculpted horned volcanic head facing LEFT
  sprite.fillEllipse(18, cy - 9, 4.5, 4, (nx, ny) =>
    ny < -0.2 ? RAMPS.obsidian.highlight : RAMPS.obsidian.mid
  );
  sprite.drawRibArch(16, cy - 12, 13, cy - 16, 15, cy - 14, 2, RAMPS.lava);
  sprite.drawRibArch(21, cy - 12, 24, cy - 16, 22, cy - 14, 2, RAMPS.lava);
  sprite.fillRect(15, cy - 9, 2, 2, RAMPS.lava.highlight);
  sprite.fillRect(18, cy - 9, 2, 2, RAMPS.lava.highlight);

  // Foreground massive boulder forearm + molten fist knuckles
  sprite.drawLine(10, cy - 2, 6, cy + 5 - stomp, RAMPS.obsidian.highlight, 4);
  sprite.fillEllipse(6, cy + 8 - stomp, 3.5, 3.2, (nx, ny) =>
    ny > 0.25 ? RAMPS.lava.mid : nx < 0 ? RAMPS.obsidian.highlight : RAMPS.obsidian.mid
  );
  sprite.setPixel(4, cy + 9 - stomp, RAMPS.lava.highlight);
  sprite.setPixel(6, cy + 10 - stomp, RAMPS.lava.highlight);

  const out = applyCreatureAction(sprite, frame, total, 20, 34, 4, cy, action);
  if (mode === 'swim') {
    drawSwimWaterline(out, 6, 33, 28, frame);
  } else if (action !== 'death') {
    applyCreatureShadow(out, 20, 35, 18, ctx);
  }

  buf.composite(out);
  return buf;
}

/**
 * 9. Boss Elder Dragon (48x42, Tier III, 16f)
 * Monumental flying fire dragon facing LEFT: swept horned wyrm skull with jaw
 * & fire breath embers, overlapping golden belly plates, dorsal spine ridge,
 * muscular clawed limbs, barbed serpent tail, and dual multi-fingered K1 wings.
 */
function renderElderDragon(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const buf = new PixelBuffer(48, 42);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const hover = Math.round(Math.sin(t) * 1.5);
  const wingFlap = Math.sin(t);

  const dragon = new PixelBuffer(48, 42);

  // Far-back wing with dark shadow membrane & bone spars
  const backApexX = 28;
  const backApexY = Math.round(8 + hover - wingFlap * 5);
  dragon.drawLine(21, 18 + hover, backApexX, backApexY, RAMPS.obsidian.highlight, 1);
  dragon.drawLine(backApexX, backApexY, 36, backApexY + 4, RAMPS.obsidian.mid, 1);
  for (let wx = 22; wx <= 35; wx++) {
    const p = (wx - 22) / 13;
    const topY =
      wx <= backApexX
        ? Math.round((18 + hover) * (1 - (wx - 22) / 6) + backApexY * ((wx - 22) / 6))
        : Math.round(backApexY * (1 - (wx - backApexX) / 7) + (backApexY + 4) * ((wx - backApexX) / 7));
    const botY = Math.round(topY + 6 - Math.abs(Math.sin(p * Math.PI * 2)) * 1.5);
    for (let wy = topY + 1; wy <= botY; wy++) {
      dragon.setPixel(wx, wy, RAMPS.magenta.deep);
    }
  }

  // Long muscular undulating tail with dorsal bone spikes & barbed K1/K2 spear tip
  for (let i = 0; i < 15; i++) {
    const tx = 28 + i;
    const ty = Math.round(23 + hover + Math.sin(t - i * 0.42) * 2.2);
    const r = i < 5 ? 2 : 1;
    dragon.fillRect(tx, ty, 2, r + 1, i < 9 ? RAMPS.obsidian.mid : RAMPS.obsidian.deep);
    if (i % 3 === 0) dragon.setPixel(tx, ty - 1, RAMPS.bone.highlight);
    if (i === 14) {
      dragon.fillRect(tx + 1, ty - 1, 2, 3, RAMPS.magenta.highlight);
      dragon.setPixel(tx + 3, ty, RAMPS.cyanMask.highlight);
    }
  }

  // Scaled dragon body with overlapping golden belly plates & dorsal ridge spikes
  dragon.fillEllipse(23, 22 + hover, 7.5, 5.2, (nx, ny, px, py) => {
    const scale = (px + py) % 3 === 0;
    if (ny > 0.35 && nx < 0.3) return px % 2 === 0 ? RAMPS.gold.highlight : RAMPS.gold.mid;
    if (ny < -0.35 && nx < 0.25) return RAMPS.obsidian.highlight;
    if (nx > 0.35) return RAMPS.obsidian.deep;
    return scale ? RAMPS.obsidian.shadow : RAMPS.obsidian.mid;
  });
  dragon.fillEllipse(20, 21 + hover, 3, 2, RAMPS.cyanMask.mid); // K2 chest crest
  dragon.setPixel(20, 16 + hover, RAMPS.bone.highlight); // Dorsal spikes
  dragon.setPixel(24, 16 + hover, RAMPS.bone.highlight);
  dragon.setPixel(27, 17 + hover, RAMPS.bone.mid);

  // Arched scaled neck & golden throat scutes
  for (let i = 0; i < 6; i++) {
    const nx = Math.round(17 - i * 0.9);
    const ny = Math.round(19 + hover - i * 1.0);
    dragon.fillEllipse(nx, ny, 2.3, 2.2, RAMPS.obsidian.mid);
    dragon.setPixel(nx - 1, ny + 1, RAMPS.gold.mid);
  }

  // Fierce horned dragon head & open fanged jaw (facing LEFT)
  dragon.fillEllipse(10, 12 + hover, 4.2, 3.2, (nx, ny) =>
    ny < -0.2 ? RAMPS.obsidian.highlight : RAMPS.obsidian.mid
  );
  dragon.fillRect(4, 12 + hover, 4, 2, RAMPS.obsidian.highlight); // Upper snout
  dragon.fillRect(5, 15 + hover, 4, 1, RAMPS.obsidian.shadow); // Lower jaw
  dragon.setPixel(5, 14 + hover, RAMPS.bone.highlight); // Ivory fang
  dragon.setPixel(7, 14 + hover, RAMPS.bone.highlight);
  dragon.setPixel(4, 12 + hover, RAMPS.lava.highlight); // Glowing nostril
  dragon.setPixel(8, 12 + hover, RAMPS.lava.highlight); // Fierce eye
  // Swept curved dragon horns
  dragon.drawRibArch(12, 10 + hover, 17, 5 + hover, 15, 7 + hover, 2, RAMPS.bone);
  dragon.drawRibArch(13, 11 + hover, 18, 8 + hover, 16, 9 + hover, 1, RAMPS.bone);

  // Articulated clawed forelimb & muscular hind haunch
  dragon.drawLine(17, 25 + hover, 14, 29 + hover, RAMPS.obsidian.highlight, 2);
  dragon.fillRect(12, 29 + hover, 3, 1, RAMPS.bone.highlight);
  dragon.fillEllipse(26, 25 + hover, 3, 2.5, RAMPS.obsidian.mid);
  dragon.drawLine(27, 27 + hover, 29, 31 + hover, RAMPS.obsidian.shadow, 2);
  dragon.fillRect(28, 31 + hover, 3, 1, RAMPS.bone.mid);

  // Foreground grand multi-fingered wing with scalloped K1 membrane & K2 claw spur
  const shoulderX = 21;
  const shoulderY = 19 + hover;
  const apexX = 28;
  const apexY = Math.round(5 + hover - wingFlap * 6.5);
  const tipX = 41;
  const tipY = Math.round(10 + hover - wingFlap * 5);
  dragon.drawLine(shoulderX, shoulderY, apexX, apexY, RAMPS.bone.highlight, 2);
  dragon.drawLine(apexX, apexY, tipX, tipY, RAMPS.bone.mid, 1);
  dragon.drawLine(apexX, apexY, 36, apexY + 9, RAMPS.obsidian.highlight, 1);
  dragon.drawLine(apexX, apexY, 30, apexY + 12, RAMPS.obsidian.highlight, 1);
  dragon.setPixel(apexX, apexY - 1, RAMPS.cyanMask.highlight);

  for (let wx = shoulderX + 1; wx <= tipX; wx++) {
    const p = (wx - shoulderX) / (tipX - shoulderX);
    const topY =
      wx <= apexX
        ? Math.round(shoulderY * (1 - (wx - shoulderX) / (apexX - shoulderX)) + apexY * ((wx - shoulderX) / (apexX - shoulderX)))
        : Math.round(apexY * (1 - (wx - apexX) / (tipX - apexX)) + tipY * ((wx - apexX) / (tipX - apexX)));
    const scallop = Math.abs(Math.sin(p * Math.PI * 3)) * 2.4;
    const botY = Math.round(topY + 9 + (1 - p) * 3 - scallop);
    for (let wy = topY + 1; wy <= botY; wy++) {
      dragon.setPixel(
        wx,
        wy,
        wy < topY + 3
          ? RAMPS.magenta.highlight
          : wx > 35 || wy > botY - 2
            ? RAMPS.magenta.shadow
            : RAMPS.magenta.mid
      );
    }
  }

  // Flickering breath embers drifting ahead of jaws
  for (let e = 0; e < 3; e++) {
    const ep = ((frame + e * 2) % 6) / 6;
    const ex = Math.round(4 - ep * 3);
    const ey = Math.round(14 + hover + Math.sin(t + e * 2) * 1.4);
    dragon.setPixel(ex, ey, ep < 0.4 ? '#FFFFFF' : ep < 0.75 ? RAMPS.lava.highlight : RAMPS.lava.mid);
  }

  const out = applyCreatureAction(dragon, frame, total, 23, 34, 4, 14 + hover, action);
  if (action !== 'death') {
    applyCreatureShadow(out, 23, 36, 19, ctx);
  }

  buf.composite(out);
  return buf;
}

/**
 * 9b. Distortus rex / D-Rex (68x56, Tier III Apex Mutant Titan, 20f)
 * Heavy front-loaded 6-limbed mutant with gorilla-like 45-degree sloped spine
 * from towering muscular withers down to a low narrow pelvis:
 * - Short flat-fronted face (no snout) under a giant smooth pale-yellow dome
 * - Tiny sunken orange eyes in skin folds; wide rounded lipless jaws exposing
 *   pink gums and a crooked palisade of irregular ivory teeth
 * - Very short thick neck with heavy longitudinal skin folds, barrel chest,
 *   sagging belly with reddish-rust/pink undertone, and spineless coarse
 *   dirty-yellow/ochre hide mottled with blurred dark-olive & umber spots
 * - Short thick-based limp tail hanging down toward ground
 * - Exactly 6 limbs: 2 colossal knuckle-walking 3-fingered arms (opposable
 *   thumb, curved black claws), 2 tiny thin 2-fingered chest arms tucked
 *   against the center of the chest, and 2 short half-bent pillar hind legs
 *   with 3 blunt black-clawed toes + rear heel dewclaw spur
 * - 4-phase attack: rear up on hind legs & roar -> overhead fist smash ->
 *   grab prey with long arm, inspect face-to-face & bite with short jaws -> recover
 */
const DREX_SKIN = {
  domePale: '#F4E6B4',
  domeMid: '#E0C77E',
  bodyLight: '#CAAE63',
  bodyMid: '#A68542',
  oliveMid: '#72733C',
  oliveDark: '#53572E',
  umberShadow: '#6E4F2C',
  umberDeep: '#45311B',
  bellyRose: '#AC574E',
  bellyRust: '#8F4336',
  foldDark: '#5E2722',
  gumPink: '#B54F55',
  toothWhite: '#F7EED6',
  toothDirty: '#D4C5A3',
  eyeOrange: '#FF7D1A',
  eyeGlow: '#FFC454',
  clawBlack: '#171316',
  clawEdge: '#3B3338',
};

interface DistortusRexPose {
  mode: UnitMode;
  action: UnitAction;
  p: number;
  t: number;
  bodyShiftX: number;
  bodyShiftY: number;
  rearLift: number; // 0 = 45-deg gorilla stance, 1 = reared up on hind legs
  headX: number;
  headY: number;
  jawOpen: number;
  armRaise: number; // 0 = knuckle-planted, 1 = spread wide / raised high
  grabProgress: number; // >0 during grab -> lift to face -> bite phase
  preyBiteFlash: number;
  slamFlash: number;
  stride: number;
  waddle: number;
  swimSink: number;
}

function getDistortusRexPose(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): DistortusRexPose {
  const mode: UnitMode = ctx?.unitMode ?? 'walk';
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;
  const swimSink = mode === 'swim' ? 4 : 0;

  if (action === 'attack') {
    if (p < 0.25) {
      // Phase 1: Rear briefly up onto hind legs, spread huge front arms wide, roar open-jawed
      const w = Math.sin((p / 0.25) * (Math.PI * 0.5));
      return {
        mode,
        action,
        p,
        t,
        bodyShiftX: Math.round(w * 2),
        bodyShiftY: Math.round(-w * 3) + swimSink,
        rearLift: w,
        headX: Math.round(18 + w * 3),
        headY: Math.round(15 - w * 3) + swimSink,
        jawOpen: 0.45 + w * 0.75,
        armRaise: w,
        grabProgress: 0,
        preyBiteFlash: 0,
        slamFlash: 0,
        stride: -w * 0.4,
        waddle: 0,
        swimSink,
      };
    }
    if (p < 0.50) {
      // Phase 2: Overhead top-down fist & claw smash onto the ground (lands cleanly at sp >= 0.42)
      const sp = (p - 0.25) / 0.25;
      const slam = Math.min(1, sp * 2.35);
      const impact = slam >= 0.9 ? Math.max(0, 1 - (sp - 0.38) / 0.62) : 0;
      return {
        mode,
        action,
        p,
        t,
        bodyShiftX: Math.round(2 - slam * 4),
        bodyShiftY: Math.round(-3 + slam * 4) + swimSink,
        rearLift: Math.max(0, 1 - slam * 1.1),
        headX: Math.round(21 - slam * 5),
        headY: Math.round(12 + slam * 5) + swimSink,
        jawOpen: sp < 0.4 ? 0.95 - sp * 1.5 : 0.3,
        armRaise: Math.max(0, 1 - slam * 1.08),
        grabProgress: 0,
        preyBiteFlash: 0,
        slamFlash: impact,
        stride: slam * 0.6,
        waddle: 0,
        swimSink,
      };
    }
    if (p < 0.82) {
      // Phase 3: Long arm reaches out, grabs prey, lifts close to flat face, inspects & bites!
      const gp = (p - 0.50) / 0.32;
      const liftToFace = gp < 0.38 ? gp / 0.38 : 1;
      const bitePhase = gp >= 0.65 ? (gp - 0.65) / 0.35 : 0;
      const rear = Math.sin(Math.min(1, liftToFace) * Math.PI * 0.5) * 0.5;
      return {
        mode,
        action,
        p,
        t,
        bodyShiftX: Math.round(-1 + rear * 2),
        bodyShiftY: Math.round(-rear * 2) + swimSink,
        rearLift: rear,
        headX: Math.round(17 + rear * 2 - (bitePhase > 0.2 ? 2 : 0)),
        headY: Math.round(15 - rear * 2 + (bitePhase > 0.3 ? 1 : 0)) + swimSink,
        jawOpen: bitePhase < 0.22 ? 0.9 : Math.max(0.08, 0.9 - (bitePhase - 0.22) * 1.6),
        armRaise: 0.22 + liftToFace * 0.28,
        grabProgress: gp,
        preyBiteFlash: bitePhase >= 0.32 && bitePhase < 0.88 ? 1 - (bitePhase - 0.32) * 1.8 : 0,
        slamFlash: 0,
        stride: 0.2,
        waddle: 0,
        swimSink,
      };
    }
    // Phase 4: Heavy lumbering drop back to 4-limb knuckle-walking stance
    const rec = (p - 0.82) / 0.18;
    const ease = 1 - Math.sin(rec * Math.PI * 0.5);
    return {
      mode,
      action,
      p,
      t,
      bodyShiftX: Math.round(ease),
      bodyShiftY: Math.round(-1 * ease) + swimSink,
      rearLift: 0.35 * ease,
      headX: Math.round(17 + ease),
      headY: Math.round(15) + swimSink,
      jawOpen: 0.2 + 0.15 * ease,
      armRaise: 0.25 * ease,
      grabProgress: 0,
      preyBiteFlash: 0,
      slamFlash: 0,
      stride: 0.2 * ease,
      waddle: 0,
      swimSink,
    };
  }

  // Slow heavy quadrupedal lumbering waddle resting on knuckles/phalanges
  const bob = Math.round(Math.sin(t * 2) * 0.8);
  const waddle = Math.sin(t) * 1.1;
  const stride = Math.sin(t);
  return {
    mode,
    action,
    p,
    t,
    bodyShiftX: Math.round(Math.cos(t) * 0.6),
    bodyShiftY: bob + swimSink,
    rearLift: 0,
    headX: 17 + Math.round(Math.cos(t) * 0.7),
    headY: 15 + bob + swimSink,
    jawOpen: 0.25 + Math.max(0, Math.sin(t + 0.4)) * 0.2,
    armRaise: 0,
    grabProgress: 0,
    preyBiteFlash: 0,
    slamFlash: 0,
    stride,
    waddle,
    swimSink,
  };
}

function getDistortusRexAnchors(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
) {
  const pose = getDistortusRexPose(frame, total, ctx);
  const fistX = Math.max(8, Math.min(28, 19 + pose.bodyShiftX + Math.round(pose.stride * 2.5)));
  const fistY =
    pose.action === 'attack'
      ? Math.max(12, Math.min(49, Math.round(48 - pose.armRaise * 24)))
      : Math.min(49, 48 - Math.max(0, Math.round(pose.stride * 2)));
  return {
    head: { x: pose.headX - 7, y: Math.max(3, pose.headY - 7), w: 16, h: 13 },
    item: { x: fistX - 4, y: fistY - 3, w: 8, h: 6 },
    pivot: { x: 34, y: 50 },
  };
}

function renderDistortusRex(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const buf = new PixelBuffer(68, 56);
  const pose = getDistortusRexPose(frame, total, ctx);
  const {
    mode,
    action,
    t,
    bodyShiftX,
    bodyShiftY,
    rearLift,
    headX,
    headY,
    jawOpen,
    armRaise,
    grabProgress,
    preyBiteFlash,
    slamFlash,
    stride,
    waddle,
    swimSink,
  } = pose;

  const dino = new PixelBuffer(68, 56);

  // High massive withers (холка) & low pelvis creating strict ~45-deg gorilla slope
  const withersX = 30 + bodyShiftX;
  const withersY = 18 + bodyShiftY;
  const pelvisX = 46 + bodyShiftX - Math.round(rearLift * 3);
  const pelvisY = 33 + Math.round(bodyShiftY * 0.45) + Math.round(rearLift * 3);
  const groundY = Math.min(51, 48 + swimSink);

  // 1. Far limbs & short limp tapered tail behind pelvis
  dino.layer((sub) => {
    // Far short pillar-like hind leg (permanently half-bent at knee)
    const farHipX = pelvisX + 3;
    const farHipY = pelvisY;
    const farStep = Math.round(-stride * 2.5);
    const farKneeX = farHipX + 4;
    const farKneeY = Math.min(groundY - 7, farHipY + 7);
    const farAnkleX = farHipX + 8;
    const farAnkleY = Math.min(groundY - 3, farKneeY + 4);
    const farFootX = Math.min(61, farHipX + 7 + farStep);

    sub.fillEllipse(farHipX, farHipY + 1, 4.2, 4.4, DREX_SKIN.umberDeep);
    sub.drawLine(farHipX, farHipY + 2, farKneeX, farKneeY, DREX_SKIN.umberDeep, 4);
    sub.drawLine(farKneeX, farKneeY, farAnkleX, farAnkleY, DREX_SKIN.oliveDark, 3);
    sub.drawLine(farAnkleX, farAnkleY, farFootX, groundY, DREX_SKIN.umberDeep, 3);
    // Broad 3-toed pillar foot with blunt BLACK claws + small rear heel dewclaw spur
    sub.fillRect(farFootX - 5, groundY, 7, 2, DREX_SKIN.umberDeep);
    sub.setPixel(farFootX - 6, groundY + 1, DREX_SKIN.clawBlack);
    sub.setPixel(farFootX - 3, groundY + 1, DREX_SKIN.clawBlack);
    sub.setPixel(farFootX + 2, groundY - 1, DREX_SKIN.clawEdge); // Rear heel spur

    // Short tail: thick base, rapidly tapering and hanging LIMP straight down toward ground
    for (let i = 0; i < 10; i++) {
      const tp = i / 9;
      const limpSway = Math.sin(t - i * 0.3) * (0.6 + tp * 1.1);
      const tx = Math.min(62, Math.round(pelvisX + 4 + tp * 4.5 + limpSway));
      const ty = Math.min(groundY - 1, Math.round(pelvisY + 1 + Math.pow(tp, 1.15) * 14));
      const rad = Math.max(0.7, 3.6 * Math.pow(1 - tp, 1.25));
      sub.fillEllipse(tx, ty, rad, rad * 0.9, tp < 0.4 ? DREX_SKIN.umberShadow : DREX_SKIN.umberDeep);
    }

    // Far colossal front arm (reaching forward/down to ground or grappling prey)
    const farShX = withersX - 9;
    const farShY = withersY + 3;
    let farHandX = Math.max(8, Math.min(22, 11 + bodyShiftX - Math.round(stride * 2.5)));
    let farHandY = Math.max(
      14,
      Math.min(groundY - 1, 46 - Math.round(armRaise * 26) - Math.max(0, Math.round(-stride * 2)))
    );
    if (grabProgress > 0) {
      // Reach forward -> clutch prey -> lift straight up in front of flat domed face!
      if (grabProgress < 0.25) {
        const rp = grabProgress / 0.25;
        farHandX = Math.round(12 - rp * 5);
        farHandY = Math.round(40 - rp * 6);
      } else {
        const lp = Math.min(1, (grabProgress - 0.25) / 0.35);
        farHandX = Math.round(7 + lp * Math.max(1, headX - 15));
        farHandY = Math.round(34 - lp * (34 - (headY + 6)));
      }
    }
    const farElbowX = Math.max(5, Math.round((farShX + farHandX) * 0.5) - 2);
    const farElbowY = Math.max(10, Math.round((farShY + farHandY) * 0.48) - 1);

    sub.drawLine(farShX, farShY, farElbowX, farElbowY, DREX_SKIN.umberShadow, 4);
    sub.drawLine(farElbowX, farElbowY, farHandX, farHandY, DREX_SKIN.umberDeep, 4);
    sub.drawLine(farElbowX - 1, farElbowY, farHandX - 1, farHandY, DREX_SKIN.oliveDark, 2);

    // Broad 3-fingered knuckle-resting hand with opposable inner thumb & curved BLACK claws
    sub.fillEllipse(farHandX, farHandY, 3.2, 2.2, DREX_SKIN.umberDeep);
    sub.setPixel(farHandX + 2, farHandY + 1, DREX_SKIN.clawBlack); // Opposable inner thumb claw
    sub.drawLine(farHandX - 2, farHandY + 1, farHandX - 4, farHandY + 3, DREX_SKIN.clawBlack, 1);
    sub.drawLine(farHandX, farHandY + 1, farHandX - 1, farHandY + 4, DREX_SKIN.clawBlack, 1);
  });

  // 2. Heavy 45-deg gorilla-sloped torso, blurred olive-umber blotches, sagging reddish belly, thick neck folds & flat-faced domed skull
  dino.layer((sub) => {
    // 45-degree diagonal spine core connecting massive high withers to low narrow pelvis
    for (let s = 0; s <= 10; s++) {
      const sp = s / 10;
      const cx = Math.round(withersX * (1 - sp) + pelvisX * sp);
      const cy = Math.round(withersY * (1 - sp) + pelvisY * sp + Math.round(waddle * (1 - sp) * 0.5));
      const rx = 9.5 * (1 - sp * 0.32);
      const ry = 7.8 * (1 - sp * 0.25);
      sub.fillEllipse(cx, cy, rx, ry, (nx, ny, px, py) => {
        // Organic blurred dark-olive & umber mottling (not checkerboard grid!)
        const blotch =
          Math.sin(px * 0.44 + py * 0.22) * 0.55 + Math.cos(px * 0.24 - py * 0.48) * 0.45;
        const grain = ((px * 5 + py * 3) & 7) === 0;
        if (ny < -0.42 && nx < 0.22) {
          if (blotch > 0.38) return DREX_SKIN.oliveMid;
          return grain ? DREX_SKIN.bodyMid : DREX_SKIN.bodyLight;
        }
        if (ny > 0.42 && nx < 0.28) return grain ? DREX_SKIN.foldDark : DREX_SKIN.bellyRose;
        if (nx > 0.42 || ny > 0.58) return DREX_SKIN.umberDeep;
        if (blotch > 0.42) return DREX_SKIN.oliveDark;
        if (blotch > 0.16) return DREX_SKIN.oliveMid;
        if (blotch < -0.45) return DREX_SKIN.umberShadow;
        return grain ? DREX_SKIN.umberShadow : DREX_SKIN.bodyMid;
      });
    }

    // Barrel chest & sagging underbelly with reddish-rust / pinkish-rose folds
    sub.fillEllipse(withersX - 3, withersY + 8, 8.2, 6.2, (nx, ny, px, py) => {
      const wrinkle = (py % 3 === 0 && ny > 0.1) || ((px + py) % 9 === 0);
      if (ny > 0.25) return wrinkle ? DREX_SKIN.foldDark : DREX_SKIN.bellyRose;
      if (nx < -0.2 && ny < 0.1) return DREX_SKIN.bodyLight;
      return wrinkle ? DREX_SKIN.bellyRust : DREX_SKIN.bodyMid;
    });
    // Slightly sagging belly pouch transitioning toward low groin
    sub.fillEllipse(withersX + 6, withersY + 13, 6.8, 4.4, (nx, ny, px, py) =>
      ny > 0.12 ? ((px + py) % 4 === 0 ? DREX_SKIN.foldDark : DREX_SKIN.bellyRose) : DREX_SKIN.bellyRust
    );

    // Subtle deep-toned K1/K2 accents tucked inside dark groin/under-belly creases (keeps back/flank pure ochre-olive)
    sub.setPixel(withersX + 5, withersY + 14, RAMPS.magenta.deep);
    sub.setPixel(withersX + 6, withersY + 14, RAMPS.magenta.deep);
    sub.setPixel(withersX + 3, withersY + 15, RAMPS.cyanMask.deep);

    // Very short super-thick neck with HEAVY HANGING LONGITUDINAL SKIN FOLDS underneath
    sub.drawLine(withersX - 6, withersY - 1, headX + 4, headY + 2, DREX_SKIN.bodyMid, 8);
    sub.drawLine(withersX - 7, withersY - 4, headX + 4, headY - 1, DREX_SKIN.bodyLight, 3);
    // Vertical hanging dewlap/neck skin folds (deep wrinkled reddish-brown creases)
    for (let fx = 0; fx < 4; fx++) {
      const foldX = headX + 2 + fx * 2;
      const foldTop = headY + 7;
      const foldBot = headY + 13 - (fx % 2);
      sub.drawLine(foldX, foldTop, foldX + 1, foldBot, fx % 2 === 0 ? DREX_SKIN.bellyRust : DREX_SKIN.bellyRose, 2);
      sub.drawLine(foldX + 1, foldTop + 1, foldX + 1, foldBot, DREX_SKIN.foldDark, 1);
    }

    // SHORT FLAT-FRONTED HEAD (NO SNOUT) + GIANT SMOOTH SPHERICAL FOREHEAD DOME
    // Recessed short facial block under the overhanging dome
    sub.fillRect(headX - 4, headY, 8, 7, DREX_SKIN.bodyMid);
    sub.fillRect(headX - 5, headY + 1, 2, 4, DREX_SKIN.umberShadow);

    // GIANT SMOOTH SPHERICAL BELUGA DOME overhanging the flat face (smooth taut pale-yellow skin!)
    sub.fillEllipse(headX + 1, headY - 3, 8.6, 6.6, (nx, ny, px, py) => {
      const subtle = (px * 2 + py * 3) % 17 === 0;
      if (ny < -0.1 && nx < 0.2 && nx > -0.74 && ny > -0.85) {
        return ny < -0.36 && nx < -0.04 ? DREX_SKIN.domePale : DREX_SKIN.domeMid;
      }
      if (ny < 0.3 && nx < 0.38) return subtle ? DREX_SKIN.bodyMid : DREX_SKIN.bodyLight;
      if (nx > 0.45 || ny > 0.5) return DREX_SKIN.umberShadow;
      return subtle ? DREX_SKIN.oliveDark : DREX_SKIN.bodyMid;
    });

    // Deep sunken skin-fold hollow + TINY ORANGE EYE tucked at side base of dome
    sub.fillRect(headX - 4, headY + 1, 4, 2, DREX_SKIN.foldDark);
    sub.setPixel(headX - 3, headY + 1, DREX_SKIN.eyeOrange);
    sub.setPixel(headX - 2, headY + 1, DREX_SKIN.eyeGlow);

    // Wide rounded LIPLESS JAWS exposing curved PINK GUMS & JAGGED CROOKED TEETH PALISADE
    const jawDrop = Math.max(2, Math.round(jawOpen * 4.2));
    // Curved upper exposed pink gum ridge (narrower at nose edge so face isn't a brick)
    sub.fillRect(headX - 5, headY + 4, 7, 1, DREX_SKIN.gumPink);
    sub.setPixel(headX + 2, headY + 5, DREX_SKIN.foldDark);
    // Open dark mouth cavity
    for (let my = headY + 5; my <= headY + 4 + jawDrop; my++) {
      for (let mx = headX - 5; mx <= headX + 1; mx++) {
        sub.setPixel(mx, my, mx >= headX ? DREX_SKIN.foldDark : '#24090D');
      }
    }

    // Thick rounded lower jaw with exposed pink lower gums & chin folds
    const lowerJawY = headY + 5 + jawDrop;
    sub.fillRect(headX - 5, lowerJawY - 1, 7, 1, DREX_SKIN.gumPink);
    sub.fillRect(headX - 5, lowerJawY, 8, 2, DREX_SKIN.umberShadow);
    sub.fillRect(headX - 4, lowerJawY + 1, 6, 1, DREX_SKIN.bellyRust);

    // Jagged crooked uneven teeth of different sizes with dark mouth gaps between them
    const upperTeeth = [
      { x: headX - 5, len: 2, col: DREX_SKIN.toothWhite },
      { x: headX - 3, len: 1, col: DREX_SKIN.toothDirty },
      { x: headX - 1, len: 2, col: DREX_SKIN.toothWhite },
      { x: headX + 1, len: 1, col: DREX_SKIN.toothDirty },
    ];
    for (const tooth of upperTeeth) {
      sub.setPixel(tooth.x, headY + 5, tooth.col);
      if (tooth.len > 1 && jawDrop >= 3) {
        sub.setPixel(tooth.x, headY + 6, DREX_SKIN.toothDirty);
      }
    }
    if (jawDrop >= 2) {
      sub.setPixel(headX - 4, lowerJawY - 2, DREX_SKIN.toothWhite);
      sub.setPixel(headX - 2, lowerJawY - 2, DREX_SKIN.toothDirty);
      sub.setPixel(headX, lowerJawY - 2, DREX_SKIN.toothWhite);
      if (jawDrop >= 4) {
        sub.setPixel(headX - 4, lowerJawY - 3, DREX_SKIN.toothDirty);
      }
    }
  });

  // 3. Secondary chest pair: TWO TINY THIN 2-FINGERED T-REX ARMS growing from CENTER OF CHEST,
  // extending forward into clear silhouette gap between giant arms & twitching reflexively
  dino.layer((sub) => {
    const chestCenterX = withersX - 8;
    const chestCenterY = withersY + 8;
    const reflexTwitch =
      action === 'attack'
        ? Math.round(Math.sin(t * 6) * 1.4)
        : Math.round(Math.sin(t * 2) * 0.6);

    // Upper tiny 2-fingered chest arm reaching slightly forward into empty chest gap
    sub.drawLine(chestCenterX + 1, chestCenterY - 1, chestCenterX - 3, chestCenterY + 1, DREX_SKIN.umberShadow, 1);
    sub.drawLine(
      chestCenterX - 3,
      chestCenterY + 1,
      chestCenterX - 6,
      chestCenterY + 3 + reflexTwitch,
      DREX_SKIN.bodyMid,
      1
    );
    sub.setPixel(chestCenterX - 7, chestCenterY + 3 + reflexTwitch, DREX_SKIN.clawBlack);
    sub.setPixel(chestCenterX - 6, chestCenterY + 4 + reflexTwitch, DREX_SKIN.clawBlack);

    // Lower tiny 2-fingered chest arm tucked close below
    sub.drawLine(chestCenterX + 2, chestCenterY + 2, chestCenterX - 2, chestCenterY + 5, DREX_SKIN.bodyMid, 1);
    sub.drawLine(
      chestCenterX - 2,
      chestCenterY + 5,
      chestCenterX - 5,
      chestCenterY + 7 + reflexTwitch,
      DREX_SKIN.bodyLight,
      1
    );
    sub.setPixel(chestCenterX - 6, chestCenterY + 7 + reflexTwitch, DREX_SKIN.clawBlack);
    sub.setPixel(chestCenterX - 5, chestCenterY + 8 + reflexTwitch, DREX_SKIN.clawBlack);
  });

  // 4. Near short thick pillar-like dinosaur hind leg (always half-bent at knee,
  // olive-brown spotted shin, broad 3-toed foot with blunt BLACK claws + rear heel spur)
  dino.layer((sub) => {
    const hipX = pelvisX - 2;
    const hipY = pelvisY;
    const nearStep = Math.round(stride * 2.5);
    const kneeX = hipX - 6 + Math.round(nearStep * 0.4); // Permanently half-bent forward knee
    const kneeY = Math.min(groundY - 7, hipY + 7);
    const ankleX = hipX - 1 + Math.round(nearStep * 0.6);
    const ankleY = Math.min(groundY - 3, kneeY + 4);
    const footX = hipX - 3 + nearStep;

    // Short thick muscular thigh with organic olive blotch
    sub.fillEllipse(hipX, hipY + 2, 4.6, 4.8, (nx, ny, px, py) => {
      const blotch = Math.sin(px * 0.4 + py * 0.3) > 0.25;
      if (nx < 0.1 && ny < 0.1) return blotch ? DREX_SKIN.oliveMid : DREX_SKIN.bodyMid;
      return nx > 0.35 ? DREX_SKIN.umberDeep : DREX_SKIN.umberShadow;
    });
    // Half-bent knee & pillar-like olive-mottled shin
    sub.drawLine(hipX - 1, hipY + 2, kneeX, kneeY, DREX_SKIN.bodyMid, 4);
    sub.drawLine(kneeX, kneeY, ankleX, ankleY, DREX_SKIN.oliveDark, 4);
    sub.drawLine(kneeX - 1, kneeY, ankleX - 1, ankleY, DREX_SKIN.oliveMid, 2);
    sub.drawLine(ankleX, ankleY, footX + 1, groundY, DREX_SKIN.umberShadow, 3);

    // Broad pillar foot: 3 thick toes with BLUNT BLACK claws + small rear heel dewclaw spur
    sub.fillRect(footX - 4, groundY - 1, 9, 3, DREX_SKIN.umberShadow);
    sub.fillRect(footX - 3, groundY - 1, 7, 1, DREX_SKIN.oliveMid);
    sub.setPixel(footX - 5, groundY + 1, DREX_SKIN.clawBlack); // Front blunt black claws
    sub.setPixel(footX - 2, groundY + 1, DREX_SKIN.clawBlack);
    sub.setPixel(footX + 1, groundY + 1, DREX_SKIN.clawBlack);
    sub.setPixel(footX + 5, groundY - 1, DREX_SKIN.clawEdge); // Small rear heel spur
    sub.setPixel(footX + 6, groundY, DREX_SKIN.clawBlack);
  });

  // 5. Enormous foreground gorilla-like arm (reaching ground, mottled olive-brown forearm,
  // broad 3-fingered hand with opposable inner thumb resting on knuckles/phalanges + curved black claws)
  dino.layer((sub) => {
    const shX = withersX - 3;
    const shY = withersY + 1;
    const liftPx = armRaise > 0 ? Math.round(armRaise * 27) : Math.round(-armRaise * 2);
    // Spread wider outward in Phase 1 roar/smash windup
    const spreadX = action === 'attack' && armRaise > 0.35 ? Math.round(armRaise * 4) : 0;
    const fistX = Math.max(
      12,
      Math.min(
        31,
        20 + bodyShiftX + Math.round(stride * 2.5) + spreadX - (slamFlash > 0 ? 2 : 0)
      )
    );
    const fistY = Math.max(
      13,
      Math.min(groundY, 47 - liftPx - Math.max(0, Math.round(stride * 2.2)))
    );
    const elbowX = Math.max(shX - 1, Math.round((shX + fistX) * 0.5) + 4 + spreadX);
    const elbowY = Math.max(10, Math.round((shY + fistY) * 0.45));

    // Smoothly stretched giant shoulder & deltoid cap
    sub.fillEllipse(shX, shY + 1, 4.8, 4.6, (nx, ny) =>
      ny < -0.15 && nx < 0.25 ? DREX_SKIN.bodyLight : nx > 0.35 ? DREX_SKIN.umberShadow : DREX_SKIN.bodyMid
    );

    // Massive bicep & thick mottled dark-olive/ochre forearm
    sub.drawLine(shX, shY + 2, elbowX, elbowY, DREX_SKIN.bodyMid, 5);
    sub.drawLine(shX - 1, shY + 2, elbowX - 1, elbowY, DREX_SKIN.bodyLight, 2);
    sub.drawLine(elbowX, elbowY, fistX, fistY, DREX_SKIN.oliveDark, 5);
    sub.drawLine(elbowX - 1, elbowY, fistX - 1, fistY, DREX_SKIN.bodyMid, 2);
    // Joint crease wrinkle at elbow
    sub.setPixel(elbowX - 1, elbowY, DREX_SKIN.foldDark);

    // Broad 3-fingered knuckle-resting hand (opposable inner thumb + curved BLACK claws!)
    sub.fillEllipse(fistX, fistY, 3.8, 2.4, (nx, ny) =>
      ny < 0 && nx < 0 ? DREX_SKIN.bodyMid : DREX_SKIN.umberShadow
    );
    const clawDirY = armRaise > 0.45 ? -1 : 1;
    // Knuckle/phalanx resting bar + curved black claws
    sub.fillRect(fistX - 4, fistY + clawDirY, 8, 1, DREX_SKIN.umberDeep);
    sub.setPixel(fistX - 4, fistY + clawDirY * 2, DREX_SKIN.clawBlack);
    sub.setPixel(fistX - 5, fistY + clawDirY * 2, DREX_SKIN.clawEdge);
    sub.setPixel(fistX - 1, fistY + clawDirY * 2, DREX_SKIN.clawBlack);
    sub.setPixel(fistX + 2, fistY + clawDirY * 2, DREX_SKIN.clawBlack);
    // Opposable inner thumb & black claw
    sub.setPixel(fistX + 3, fistY + clawDirY, DREX_SKIN.clawEdge);
    sub.setPixel(fistX + 4, fistY + clawDirY * 2, DREX_SKIN.clawBlack);
  });

  // 6. Attack prey grab/inspect/bite cinematic + smash arcs + ground shockwave
  if (action === 'attack') {
    if (armRaise > 0.45 && grabProgress === 0) {
      // Subtle sonic breath mist in front of roaring jaws
      for (let i = 0; i < 3; i++) {
        const rx = Math.max(2, headX - 7 - i * 2);
        const ry = Math.max(4, headY + 5 + (i % 2 === 0 ? -1 : 1));
        dino.setPixel(rx, ry, i === 0 ? '#FFF2A6AA' : '#D4C5A377');
      }
    }

    if (slamFlash > 0.05) {
      // Earth-shattering overhead fist & claw smash arc + warm shockwave dust at ground impact
      const impactX = Math.max(10, headX + 2);
      const arcTopY = Math.max(20, groundY - 14);
      const arcBotY = Math.min(50, groundY - 1);
      for (let sy = arcTopY; sy <= arcBotY; sy++) {
        const sp = (sy - arcTopY) / Math.max(1, arcBotY - arcTopY);
        const sx = Math.round(impactX - Math.sin(sp * Math.PI) * 5);
        dino.setPixel(sx, sy, sp > 0.55 ? '#FFF2A6' : '#E0C77E');
        if (sx + 1 < 66) dino.setPixel(sx + 1, sy, '#D4C5A3AA');
      }
      if (armRaise <= 0.15) {
        const waveSpread = Math.round((1 - slamFlash) * 8) + 3;
        for (const dir of [-1, 1]) {
          const sx = Math.max(2, Math.min(65, impactX + dir * waveSpread));
          const sy = Math.min(51, groundY + 1);
          dino.setPixel(sx, sy, '#FFF2A6');
          dino.setPixel(sx, Math.max(2, sy - 2), DREX_SKIN.domePale);
          if (sx + dir >= 2 && sx + dir <= 65) {
            dino.setPixel(sx + dir, sy - 1, '#C4CAD6AA');
          }
        }
      }
    }

    // Grabbed struggling soldier/prey silhouette lifted up close to flat face & crushed by short jaws!
    if (grabProgress > 0.08 && grabProgress < 0.92) {
      let px = 8;
      let py = 32;
      if (grabProgress < 0.25) {
        const rp = grabProgress / 0.25;
        px = Math.round(11 - rp * 4);
        py = Math.round(39 - rp * 5);
      } else {
        const lp = Math.min(1, (grabProgress - 0.25) / 0.35);
        px = Math.round(7 + lp * Math.max(1, headX - 16));
        py = Math.round(34 - lp * (34 - (headY + 5)));
      }
      px = Math.max(3, Math.min(headX - 5, px));
      py = Math.max(6, Math.min(groundY - 3, py));

      if (preyBiteFlash <= 0.1) {
        // Captured RTS soldier silhouette (bright steel helmet + armored torso + crimson cape + boots) held in front of jaws
        dino.setPixel(px, py - 3, '#EEF1F7'); // Helmet highlight
        dino.setPixel(px - 1, py - 2, '#C4CAD6'); // Helmet side
        dino.setPixel(px, py - 2, '#EEF1F7'); // Helmet face/visor
        dino.fillRect(px - 1, py - 1, 3, 2, '#8B92A1'); // Armored chestplate
        dino.setPixel(px + 1, py - 1, '#E6194B'); // Crimson cape accent
        dino.setPixel(px - 1, py + 1, '#382011'); // Boot L
        dino.setPixel(px + 1, py + 1, '#382011'); // Boot R
      } else {
        // Jaw crunch flash & bite impact sparks!
        dino.setPixel(px, py, '#FFFFFF');
        dino.setPixel(px - 1, py - 1, '#FFF2A6');
        dino.setPixel(px + 1, py + 1, '#FF3B4E');
        dino.setPixel(px - 2, py + 1, '#FF3B4E');
      }
    }
  } else if (frame % 5 < 2) {
    // Faint warm snort vapor in front of flat jaws
    const vx = Math.max(2, headX - 7 - (frame % 2));
    dino.setPixel(vx, headY + 6, '#E6F0FA77');
  }

  // Submerged aquatic shading in swim mode
  if (mode === 'swim') {
    const waterY = 43;
    for (let y = waterY + 1; y < dino.height; y++) {
      for (let x = 0; x < dino.width; x++) {
        if (dino.getPixel(x, y) !== null) {
          dino.setPixel(x, y, y > waterY + 3 ? RAMPS.ice.deep : '#1B4965AA');
        }
      }
    }
  }

  const out =
    action === 'attack' || action === 'normal'
      ? dino
      : applyCreatureAction(dino, frame, total, 34, 49, 9, 28, action);

  if (mode === 'swim') {
    drawSwimWaterline(out, 6, 61, 43, frame);
  } else if (action !== 'death') {
    applyCreatureShadow(out, 34, 51, 32, ctx);
  }

  buf.composite(out);
  return buf;
}

/**
 * 9c. Tyrannosaurus rex (68x52, Tier III Apex Theropod, 16f)
 * Classic horizontal-backed Jurassic apex predator facing LEFT:
 * - Massive boxy skull with lacrimal brow ridges, fenestra cheek hollows,
 *   vertical-slit amber eye, hinged tooth-studded jaws, and articulated tongue
 * - Thick muscular S-curved neck, tiger-striped bronze-olive dorsal hide,
 *   ribbed cream-ochre belly scutes, and tribal K1/K2 war-collar markings
 * - Signature tiny 2-clawed T-Rex forelimbs tucked under deep chest
 * - Powerful digitigrade hind legs in alternating theropod stride + 3-toed
 *   bird-like feet with dark claws and rear hallux spur
 * - Long counterbalancing striped tail curving smoothly to the right
 * - 4-phase attack: low stalk -> lunging jaw crunch -> skyward stomp & roar -> recover
 */
const TREX_HIDE = {
  crest: '#9A3B1E',
  ridge: '#C75824',
  hideLight: '#8F7343',
  hideMid: '#6B5834',
  hideDark: '#473B24',
  hideDeep: '#292216',
  stripeDark: '#2E261B',
  bellyLight: '#E3CF9E',
  bellyMid: '#BAA372',
  gum: '#9E333E',
  mouthDark: '#26080C',
  toothIvory: '#F7F1DF',
  toothShade: '#D4C8AA',
  eyeAmber: '#FF9E1B',
  eyeGlow: '#FFF07A',
  eyePupil: '#14100E',
  clawDark: '#1B1718',
  clawEdge: '#4A403C',
} as const;

interface TRexPose {
  mode: UnitMode;
  action: UnitAction;
  p: number;
  t: number;
  lungeX: number;
  bodyY: number;
  headLiftY: number;
  jawOpen: number;
  tailLift: number;
  biteFlash: boolean;
  roarRing: number;
  stompDust: number;
  stride: number;
  swimSink: number;
}

function getTRexPose(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): TRexPose {
  const mode: UnitMode = ctx?.unitMode ?? 'walk';
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;
  const swimSink = mode === 'swim' ? 5 : 0;

  if (action === 'attack') {
    if (p < 0.25) {
      // Phase 1: Stalking ambush crouch — body drops low, head pulls slightly back, jaws open
      const w = Math.sin((p / 0.25) * (Math.PI * 0.5));
      return {
        mode,
        action,
        p,
        t,
        lungeX: Math.round(w * 3),
        bodyY: Math.round(w * 2) + swimSink,
        headLiftY: Math.round(w * 2),
        jawOpen: 0.35 + w * 0.65,
        tailLift: -w * 2,
        biteFlash: false,
        roarRing: 0,
        stompDust: 0,
        stride: -w * 0.5,
        swimSink,
      };
    }
    if (p < 0.56) {
      // Phase 2: Explosive forward lunge & crushing bone bite
      const sp = (p - 0.25) / 0.31;
      const lungeWave = Math.sin(Math.min(1, sp * 1.45) * (Math.PI * 0.5));
      const crunch = sp >= 0.42;
      return {
        mode,
        action,
        p,
        t,
        lungeX: Math.round(3 - lungeWave * 10),
        bodyY: Math.round(2 - lungeWave * 1) + swimSink,
        headLiftY: crunch ? 2 : 0,
        jawOpen: sp < 0.36 ? 1.0 - (sp / 0.36) * 0.85 : 0.08,
        tailLift: -1,
        biteFlash: sp >= 0.34 && sp <= 0.64,
        roarRing: 0,
        stompDust: sp >= 0.34 && sp <= 0.72 ? 1 - Math.abs(sp - 0.52) * 3 : 0,
        stride: lungeWave * 0.7,
        swimSink,
      };
    }
    if (p < 0.86) {
      // Phase 3: Victory roar — neck cranes up high, jaws roar wide, sonic rings ripple out
      const rp = (p - 0.56) / 0.30;
      const arch = Math.sin(rp * Math.PI);
      return {
        mode,
        action,
        p,
        t,
        lungeX: Math.round(-4 + rp * 3),
        bodyY: Math.round(-arch * 2) + swimSink,
        headLiftY: Math.round(-arch * 5),
        jawOpen: 0.45 + arch * 0.75,
        tailLift: arch * 2,
        biteFlash: false,
        roarRing: arch,
        stompDust: rp < 0.4 ? (1 - rp / 0.4) * 0.7 : 0,
        stride: 0.3 * (1 - rp),
        swimSink,
      };
    }
    // Phase 4: Heavy theropod recovery into balanced stance
    const rec = (p - 0.86) / 0.14;
    const ease = 1 - Math.sin(rec * Math.PI * 0.5);
    return {
      mode,
      action,
      p,
      t,
      lungeX: Math.round(-1 * ease),
      bodyY: swimSink,
      headLiftY: Math.round(-1 * ease),
      jawOpen: 0.25 * ease + 0.15,
      tailLift: 0,
      biteFlash: false,
      roarRing: 0,
      stompDust: 0,
      stride: 0.15 * ease,
      swimSink,
    };
  }

  // Heavy rhythmic bipedal predator walk cycle
  const bob = Math.round(Math.abs(Math.sin(t)) * -1);
  return {
    mode,
    action,
    p,
    t,
    lungeX: Math.round(Math.cos(t) * 0.6),
    bodyY: bob + swimSink,
    headLiftY: Math.round(Math.sin(t * 2) * 0.6),
    jawOpen: 0.18 + Math.max(0, Math.sin(t + 0.5)) * 0.22,
    tailLift: Math.sin(t) * 1.2,
    biteFlash: false,
    roarRing: 0,
    stompDust: 0,
    stride: Math.sin(t),
    swimSink,
  };
}

function getTRexAnchors(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
) {
  const pose = getTRexPose(frame, total, ctx);
  const hipX = 38 + pose.lungeX;
  const chestX = hipX - 11;
  const headX = Math.max(13, chestX - 10);
  const headY = Math.max(10, 17 + pose.bodyY + pose.headLiftY);
  const pivotY = Math.min(48, 45 + pose.swimSink);
  return {
    head: { x: headX - 8, y: Math.max(2, headY - 6), w: 16, h: 12 },
    item: { x: Math.max(3, headX - 11), y: headY + 1, w: 7, h: 6 },
    pivot: { x: hipX - 3, y: pivotY },
  };
}

function renderTyrannosaurusRex(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const pose = getTRexPose(frame, total, ctx);
  const {
    mode,
    action,
    p,
    t,
    lungeX,
    bodyY,
    headLiftY,
    jawOpen,
    tailLift,
    biteFlash,
    roarRing,
    stompDust,
    stride,
    swimSink,
  } = pose;

  const dino = new PixelBuffer(68, 52);

  const groundY = Math.min(47, 45 + swimSink);
  const hipX = 38 + lungeX;
  const hipY = 26 + bodyY;
  const chestX = hipX - 11;
  const chestY = hipY - 2;
  const headX = Math.max(13, chestX - 10);
  const headY = Math.max(10, chestY - 7 + headLiftY);

  // 1. Far digitigrade hind leg (drawn behind tail/hip for clear Z-bend stride)
  dino.layer((sub) => {
    if (mode === 'swim') {
      const kick = Math.round(Math.sin(t + Math.PI) * 2.4);
      sub.fillEllipse(hipX + 2, hipY + 5, 4.2, 4.8, TREX_HIDE.hideDeep);
      sub.drawLine(hipX + 2, hipY + 7, hipX + 6 + kick, hipY + 13, TREX_HIDE.hideDeep, 3);
      return;
    }
    const farStep = Math.round(-stride * 4.4);
    const footLift = Math.max(0, Math.round(stride * 2.5));
    const farFootY = Math.min(groundY, groundY - footLift);
    const farKneeX = hipX - 4 + Math.round(farStep * 0.35);
    const farKneeY = hipY + 7;
    const farAnkleX = hipX + 3 + Math.round(farStep * 0.72);
    const farAnkleY = Math.min(farFootY - 4, farKneeY + 5);
    const farFootX = hipX + farStep;

    sub.fillEllipse(hipX + 2, hipY + 2, 4.4, 5.0, TREX_HIDE.hideDeep);
    sub.drawLine(hipX + 2, hipY + 3, farKneeX, farKneeY, TREX_HIDE.hideDeep, 4);
    sub.drawLine(farKneeX, farKneeY, farAnkleX, farAnkleY, TREX_HIDE.stripeDark, 3);
    sub.drawLine(farAnkleX, farAnkleY, farFootX + 1, farFootY, TREX_HIDE.hideDeep, 2);
    // Far 3-toed foot & dark claws
    sub.fillRect(farFootX - 4, farFootY - 1, 6, 2, TREX_HIDE.hideDeep);
    sub.setPixel(farFootX - 5, farFootY, TREX_HIDE.clawDark);
    sub.setPixel(farFootX - 2, farFootY + 1, TREX_HIDE.clawDark);
    sub.setPixel(farFootX + 2, farFootY - 2, TREX_HIDE.clawEdge);
  });

  // 2. Long heavy muscular counterbalancing tail sweeping horizontally right in an S-curve
  dino.layer((sub) => {
    for (let i = 0; i < 18; i++) {
      const tp = i / 17;
      const sway = Math.sin(t - i * 0.28) * (0.6 + tp * 1.2);
      const tx = Math.min(64, Math.round(hipX + 3 + tp * 22));
      const arch = Math.sin(tp * Math.PI) * (2.6 + tailLift * 0.45);
      const tipLift = tp > 0.65 ? (tp - 0.65) * 3.2 : 0;
      const ty = Math.max(
        6,
        Math.min(
          groundY - 6,
          Math.round(hipY - 3 + tp * (2.4 + tailLift * 0.25) - arch - tipLift + sway)
        )
      );
      const ry = Math.max(0.85, 5.2 * Math.pow(1 - tp, 0.92));
      const rx = Math.max(1.0, 2.7 * (1 - tp * 0.4));
      const isStripe = i % 3 === 1 && i < 14;

      sub.fillEllipse(tx, ty, rx, ry, (nx, ny) => {
        if (ny > 0.42 && tp < 0.68) return TREX_HIDE.bellyMid;
        if (ny < -0.45) {
          return isStripe ? TREX_HIDE.stripeDark : i % 2 === 0 ? TREX_HIDE.crest : TREX_HIDE.hideLight;
        }
        if (ny > 0.18) return TREX_HIDE.hideDeep;
        return isStripe ? TREX_HIDE.stripeDark : TREX_HIDE.hideMid;
      });
      if (i % 2 === 0 && i < 13) {
        sub.setPixel(tx, Math.max(3, Math.round(ty - ry - 0.4)), TREX_HIDE.crest);
      }
    }
  });

  // 3. Far tiny 2-clawed T-Rex forelimb
  dino.layer((sub) => {
    const fArmX = chestX - 5;
    const fArmY = chestY + 5;
    const twitch = Math.round(Math.sin(t * 2) * 0.7);
    sub.drawLine(fArmX, fArmY, fArmX - 3, fArmY + 2 + twitch, TREX_HIDE.hideDeep, 2);
    sub.setPixel(fArmX - 4, fArmY + 2 + twitch, TREX_HIDE.clawDark);
    sub.setPixel(fArmX - 3, fArmY + 3 + twitch, TREX_HIDE.clawDark);
  });

  // 4. Horizontal muscular torso, ribbed underbelly scutes, thick S-neck & iconic T-Rex skull
  dino.layer((sub) => {
    // Muscular horizontal theropod back & ribcage (pelvis to deep chest)
    for (let s = 0; s <= 10; s++) {
      const sp = s / 10;
      const bx = Math.round(chestX * (1 - sp) + hipX * sp);
      const by = Math.round(chestY * (1 - sp) + hipY * sp);
      const rx = 7.0 - Math.abs(sp - 0.4) * 1.3;
      const ry = 7.0 - sp * 0.45;
      sub.fillEllipse(bx, by, rx, ry, (nx, ny, px, py) => {
        const stripe = Math.sin(px * 0.72 + py * 0.16) > 0.44;
        if (ny > 0.48 && nx < 0.35) {
          return px % 2 === 0 ? TREX_HIDE.bellyLight : TREX_HIDE.bellyMid;
        }
        if (ny < -0.42 && nx < 0.25) {
          return stripe ? TREX_HIDE.crest : TREX_HIDE.hideLight;
        }
        if (ny > 0.28 || nx > 0.48) return TREX_HIDE.hideDeep;
        if (stripe && ny < 0.24) return TREX_HIDE.stripeDark;
        return TREX_HIDE.hideMid;
      });
    }

    // Dorsal spine osteoderm ridge
    for (let sx = chestX - 2; sx <= hipX + 2; sx += 3) {
      sub.setPixel(sx, Math.min(chestY, hipY) - 6, TREX_HIDE.crest);
    }

    // Thick S-curved muscular neck connecting chest seamlessly to cranium
    for (let s = 0; s <= 7; s++) {
      const sp = s / 7;
      const curveX = Math.round(chestX * (1 - sp) + (headX + 4) * sp - Math.sin(sp * Math.PI) * 1.9);
      const curveY = Math.round((chestY - 1) * (1 - sp) + (headY + 2) * sp);
      const rad = 5.0 - sp * 0.75;
      sub.fillEllipse(curveX, curveY, rad, rad * 0.92, (nx, ny, px) => {
        if (ny > 0.42 && nx < 0.2) return TREX_HIDE.bellyLight;
        if (ny < -0.35) return px % 3 === 0 ? TREX_HIDE.crest : TREX_HIDE.hideLight;
        return nx > 0.35 ? TREX_HIDE.hideDark : TREX_HIDE.hideMid;
      });
    }

    // Cohesive bronze-framed tribal K1 / K2 war-collar around lower neck / shoulder (clean in all palettes)
    sub.drawLine(chestX - 4, chestY - 5, chestX + 1, chestY + 4, TREX_HIDE.hideDeep, 3);
    sub.drawLine(chestX - 4, chestY - 5, chestX + 1, chestY + 4, RAMPS.magenta.deep, 2);
    sub.drawLine(chestX - 5, chestY - 4, chestX, chestY + 3, RAMPS.magenta.mid, 1);
    sub.fillRect(chestX - 2, chestY - 1, 2, 2, RAMPS.cyanMask.mid);
    sub.setPixel(chestX - 2, chestY - 1, RAMPS.cyanMask.highlight);

    // ICONIC SCULPTED T-REX SKULL (deep curved cranium, connected jaw muscle hinge, lacrimal crest, curved fangs)
    const jawDrop = Math.max(1, Math.round(jawOpen * 5.2));
    const headTiltUp = headLiftY < -2 ? -1 : 0;

    // Back of cranium + heavy masseter jaw-hinge pillar (keeps upper and lower jaws organically joined)
    sub.fillEllipse(headX + 3, headY + 1, 5.5, 5.0, (nx, ny) => {
      if (ny < -0.38 && nx < 0.2) return TREX_HIDE.hideLight;
      if (nx > 0.38 || ny > 0.42) return TREX_HIDE.hideDark;
      return TREX_HIDE.hideMid;
    });
    // Jaw hinge muscle bridge connecting cranium smoothly into rear of lower jaw
    sub.fillEllipse(headX + 2, headY + 3 + Math.round(jawDrop * 0.35), 3.4, 2.8, (nx, ny) =>
      nx > 0.25 || ny > 0.3 ? TREX_HIDE.hideDark : TREX_HIDE.hideMid
    );

    // Sculpted arched upper snout extending LEFT (tapered tip, heavy nasal ridge)
    sub.fillEllipse(headX - 3, headY + headTiltUp, 6.2, 3.4, (nx, ny, px) => {
      if (ny < -0.45) return px % 3 === 0 ? TREX_HIDE.stripeDark : TREX_HIDE.ridge;
      if (ny > 0.38) return TREX_HIDE.hideDark;
      return nx < -0.15 ? TREX_HIDE.hideLight : TREX_HIDE.hideMid;
    });
    // Tapered rounded snout nose tip + flared nostril + upper lip edge
    sub.fillRect(headX - 9, headY - 1 + headTiltUp, 3, 3, TREX_HIDE.hideMid);
    sub.setPixel(headX - 10, headY + headTiltUp, TREX_HIDE.hideDark);
    sub.setPixel(headX - 8, headY - 2 + headTiltUp, TREX_HIDE.ridge);
    sub.setPixel(headX - 8, headY - 1 + headTiltUp, TREX_HIDE.hideDeep); // Flared nostril

    // Raised lacrimal horn/brow ridge + orbital hollow + fierce amber predator eye
    sub.fillRect(headX - 3, headY - 4 + headTiltUp, 5, 2, TREX_HIDE.ridge);
    sub.setPixel(headX - 1, headY - 5 + headTiltUp, TREX_HIDE.crest);
    sub.setPixel(headX - 4, headY - 3 + headTiltUp, TREX_HIDE.ridge);
    sub.fillRect(headX + 2, headY - 2, 2, 2, TREX_HIDE.hideDeep); // Temporal fenestra hollow
    sub.setPixel(headX - 1, headY - 2 + headTiltUp, TREX_HIDE.eyeAmber);
    sub.setPixel(headX, headY - 2 + headTiltUp, TREX_HIDE.eyePupil);
    sub.setPixel(headX - 1, headY - 3 + headTiltUp, TREX_HIDE.eyeGlow);

    // Open mouth interior + pink tongue during roar/snap
    if (jawDrop >= 2) {
      for (let my = headY + 2; my <= headY + 1 + jawDrop; my++) {
        for (let mx = headX - 7; mx <= headX + 2; mx++) {
          sub.setPixel(mx, my, mx >= headX ? TREX_HIDE.gum : TREX_HIDE.mouthDark);
        }
      }
      if (jawDrop >= 3) {
        sub.fillRect(headX - 4, headY + jawDrop, 5, 1, TREX_HIDE.gum);
      }
    }

    // Articulated hinged lower jaw (tapers forward to chin, thickens into cheek hinge)
    const lowerJawY = headY + 2 + jawDrop;
    sub.fillRect(headX - 8, lowerJawY, 10, 2, TREX_HIDE.hideDark);
    sub.fillRect(headX - 3, lowerJawY - 1, 6, 3, TREX_HIDE.hideDark);
    sub.fillRect(headX - 1, lowerJawY, 4, 2, TREX_HIDE.hideMid);
    sub.fillRect(headX - 7, lowerJawY + 1, 8, 1, TREX_HIDE.bellyMid);
    sub.setPixel(headX - 9, lowerJawY, TREX_HIDE.hideDeep); // Tapered chin tip

    // Jagged conical T-Rex teeth (overhanging upper fangs + opposing lower teeth)
    const upperTeethOffsets = [-8, -6, -4, -2, 0];
    for (let i = 0; i < upperTeethOffsets.length; i++) {
      const tx = headX + upperTeethOffsets[i];
      const toothCol = i % 2 === 0 ? TREX_HIDE.toothIvory : TREX_HIDE.toothShade;
      sub.setPixel(tx, headY + 2, toothCol);
      if (jawDrop >= 2 && (i === 1 || i === 2)) {
        sub.setPixel(tx, headY + 3, TREX_HIDE.toothShade);
      }
    }
    if (jawDrop >= 2) {
      for (const tx of [-7, -5, -3]) {
        sub.setPixel(headX + tx, lowerJawY - 1, TREX_HIDE.toothIvory);
      }
    }
  });

  // 5. Signature tiny near 2-fingered T-Rex arm with dark shoulder socket so it pops against the chest
  dino.layer((sub) => {
    const armX = chestX - 5;
    const armY = chestY + 6;
    const armBob = action === 'attack' ? Math.round(Math.sin(t * 4) * 1.1) : Math.round(Math.cos(t * 2) * 0.6);
    sub.fillRect(armX, armY - 2, 2, 2, TREX_HIDE.hideDeep); // Shoulder hollow contrast
    sub.drawLine(armX + 1, armY - 1, armX - 1, armY + 2, TREX_HIDE.hideLight, 2);
    sub.drawLine(armX - 1, armY + 2, armX - 4, armY + 3 + armBob, TREX_HIDE.hideMid, 2);
    sub.setPixel(armX - 5, armY + 3 + armBob, TREX_HIDE.toothIvory);
    sub.setPixel(armX - 4, armY + 4 + armBob, TREX_HIDE.clawEdge);
  });

  // 6. Near colossal muscular digitigrade hind leg + 3-toed bird-like foot with claws & hallux spur
  dino.layer((sub) => {
    if (mode === 'swim') {
      const kick = Math.round(Math.sin(t) * 2.2);
      sub.fillEllipse(hipX - 1, hipY + 5, 4.6, 5.0, TREX_HIDE.hideMid);
      sub.drawLine(hipX - 1, hipY + 8, hipX + 3 + kick, hipY + 13, TREX_HIDE.hideDark, 3);
      return;
    }

    const nearStep = Math.round(stride * 4.5);
    const footLift = Math.max(0, Math.round(-stride * 2.5));
    const footY = Math.min(groundY, groundY - footLift);
    const kneeX = hipX - 6 + Math.round(nearStep * 0.42);
    const kneeY = hipY + 7;
    const ankleX = hipX + 1 + Math.round(nearStep * 0.72);
    const ankleY = Math.min(footY - 4, kneeY + 5);
    const footX = hipX - 2 + nearStep;

    // Massive sculpted thigh with natural tiger stripes
    sub.fillEllipse(hipX - 1, hipY + 2, 4.9, 5.6, (nx, ny, px) => {
      if (nx < 0.05 && ny < 0.15) return px % 3 === 0 ? TREX_HIDE.stripeDark : TREX_HIDE.hideLight;
      return nx > 0.35 ? TREX_HIDE.hideDeep : TREX_HIDE.hideMid;
    });

    // Muscular shin & digitigrade metatarsal column
    sub.drawLine(hipX - 1, hipY + 4, kneeX, kneeY, TREX_HIDE.hideLight, 4);
    sub.drawLine(kneeX, kneeY, ankleX, ankleY, TREX_HIDE.hideMid, 3);
    sub.drawLine(ankleX, ankleY, footX + 1, footY, TREX_HIDE.hideDark, 3);

    // Broad 3-toed theropod foot + black curved talons + rear hallux spur
    sub.fillRect(footX - 4, footY - 1, 7, 2, TREX_HIDE.hideMid);
    sub.fillRect(footX - 3, footY - 1, 5, 1, TREX_HIDE.hideLight);
    sub.setPixel(footX - 5, footY, TREX_HIDE.clawDark);
    sub.setPixel(footX - 5, footY + 1, TREX_HIDE.clawEdge);
    sub.setPixel(footX - 2, footY + 1, TREX_HIDE.clawDark);
    sub.setPixel(footX + 1, footY + 1, TREX_HIDE.clawDark);
    sub.setPixel(footX + 3, footY - 2, TREX_HIDE.clawEdge);
  });

  // 7. Attack VFX: Bone-crushing Jaw Snap Sparks, Skyward Sonic Roar Rings, & Stomp Dust
  if (action === 'attack') {
    if (biteFlash) {
      const bx = Math.max(6, headX - 7);
      const by = headY + 2;
      drawSlashArc(dino, bx, by, 0.95, 4);
      dino.setPixel(bx - 2, by, '#FFFFFF');
      dino.setPixel(bx - 3, by - 2, '#FFF2A6');
      dino.setPixel(bx - 3, by + 2, '#FF3B4E');
      dino.setPixel(bx - 1, by + 2, '#FF9E1B');
    }
    if (roarRing > 0.12) {
      const rxBase = Math.max(3, headX - 10 - Math.round((p - 0.56) * 14));
      const ryBase = Math.max(4, headY + 1);
      for (let i = -3; i <= 3; i++) {
        const sy = ryBase + i;
        const curve = Math.abs(i) > 1 ? 1 : 0;
        if (sy >= 2 && sy < dino.height - 2) {
          dino.setPixel(Math.max(2, rxBase + curve), sy, i % 2 === 0 ? '#FFF2A6DD' : '#FF9E1BAA');
        }
      }
    }
    if (stompDust > 0.1) {
      for (const dir of [-1, 1]) {
        const sx = Math.max(2, Math.min(64, hipX + dir * Math.round(4 + (1 - stompDust) * 5)));
        dino.setPixel(sx, groundY, '#E3CF9EAA');
        dino.setPixel(sx, groundY - 1, '#C4CAD688');
      }
    }
  } else if (frame % 6 < 2) {
    // Subtle warm breath puff ahead of snout
    dino.setPixel(Math.max(3, headX - 10), headY + 1, '#E6F0FA77');
  }

  // Submerged aquatic tint in swim mode
  if (mode === 'swim') {
    const waterY = 39;
    for (let y = waterY + 1; y < dino.height; y++) {
      for (let x = 0; x < dino.width; x++) {
        if (dino.getPixel(x, y) !== null) {
          dino.setPixel(x, y, y > waterY + 3 ? RAMPS.ice.deep : '#1B4965AA');
        }
      }
    }
  }

  const out =
    action === 'attack' || action === 'normal'
      ? dino
      : applyCreatureAction(dino, frame, total, hipX, groundY, Math.max(2, headX - 10), headY + 1, action);

  if (mode === 'swim') {
    drawSwimWaterline(out, 6, 61, 39, frame);
  } else if (action !== 'death') {
    applyCreatureShadow(out, hipX, groundY + 1, 28, ctx);
  }

  const buf = new PixelBuffer(68, 52);
  buf.composite(out);
  return buf;
}

const GUSTAVE_HIDE = {
  scuteDeep: '#1E2816',
  hideDark: '#2E3B21',
  hideMid: '#445730',
  hideLight: '#5E7541',
  scuteRidge: '#768D53',
  bellyCream: '#DFD4AC',
  bellyShade: '#B6A77C',
  scarPink: '#9E534E',
  scarPale: '#CC8D82',
  jawMouth: '#6E2328',
  toothIvory: '#F5F2E6',
  toothOld: '#D6CEB2',
  eyeGold: '#F5B82E',
  eyeSlit: '#141210',
  clawDark: '#1C1A18',
} as const;

function getGustaveAnchors(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
) {
  const mode: UnitMode = ctx?.unitMode ?? 'walk';
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const p = frame / Math.max(1, total);
  const swimSink = mode === 'swim' ? 3 : 0;
  let lungeX = 0;
  if (action === 'attack') {
    if (p < 0.25) lungeX = Math.round((p / 0.25) * 4);
    else if (p < 0.55) {
      const sp = (p - 0.25) / 0.3;
      lungeX = Math.round(4 - Math.sin(Math.min(1, sp * 1.4) * (Math.PI / 2)) * 10);
    } else if (p < 0.85) {
      const rp = (p - 0.55) / 0.3;
      lungeX = Math.round(-4 + rp * 3);
    }
  }
  const pivotY = Math.min(32, 29 + swimSink);
  return {
    head: { x: Math.max(2, 10 + lungeX), y: 14 + swimSink, w: 15, h: 10 },
    item: { x: Math.max(1, 5 + lungeX), y: 17 + swimSink, w: 6, h: 6 },
    pivot: { x: 31 + Math.round(lungeX * 0.5), y: pivotY },
  };
}

/**
 * 9b. Legendary Crocodile Gustave (64x36, Tier III, 16f)
 * Colossal battle-scarred Nile crocodile with heavy U-snout, interlocking teeth,
 * armored osteoderm scute rows, iconic bullet scars, undulating scuted tail,
 * K1/K2 tribal war markings, and 4-phase Ambush Snap + Death Roll attack.
 */
function renderGustaveCrocodile(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const mode: UnitMode = ctx?.unitMode ?? 'walk';
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const p = frame / Math.max(1, total);
  const t = p * Math.PI * 2;
  const isAtk = action === 'attack';

  let lungeX = 0;
  let jawOpen = 0;
  let rollAngle = 0;
  let biteFlash = false;

  if (isAtk) {
    if (p < 0.25) {
      // Phase 1: Ambush crouch & wide menacing jaw gape
      const wp = p / 0.25;
      lungeX = Math.round(wp * 4);
      jawOpen = Math.round(wp * 5);
    } else if (p < 0.55) {
      // Phase 2: Lightning lunge & crushing jaw snap
      const sp = (p - 0.25) / 0.3;
      lungeX = Math.round(4 - Math.sin(Math.min(1, sp * 1.45) * (Math.PI / 2)) * 10);
      jawOpen = sp < 0.42 ? Math.round((1 - sp / 0.42) * 5) : 0;
      biteFlash = sp >= 0.36 && sp <= 0.64;
    } else if (p < 0.85) {
      // Phase 3: Violent Death Roll twisting cream belly & armored back
      const rp = (p - 0.55) / 0.3;
      lungeX = Math.round(-4 + rp * 3);
      rollAngle = Math.sin(rp * Math.PI * 2);
      jawOpen = 1;
    } else {
      // Phase 4: Settle back into low ambush stance
      const rec = (p - 0.85) / 0.15;
      lungeX = Math.round(-1 * (1 - rec));
    }
  }

  const swimSink = mode === 'swim' ? 3 : 0;
  const groundY = Math.min(32, 29 + swimSink);
  const stride = Math.sin(t);
  const breathY = isAtk && p < 0.25 ? 1 : Math.round(Math.sin(t * 2) * 0.5);
  const cx = 30 + lungeX;
  const cy = 21 + breathY + swimSink - Math.round(Math.abs(rollAngle) * 1.5);

  const croc = new PixelBuffer(64, 36);

  // 1. Far sprawling clawed legs (or tucked horizontally back when swimming)
  if (mode === 'walk') {
    croc.layer((sub) => {
      const fSwing = Math.round(-stride * 2.5);
      const bSwing = Math.round(stride * 2.5);
      // Far front leg
      sub.drawLine(cx - 8, cy + 3, cx - 10 + fSwing, groundY, GUSTAVE_HIDE.scuteDeep, 3);
      sub.fillRect(cx - 12 + fSwing, groundY - 1, 4, 2, GUSTAVE_HIDE.hideDark);
      sub.setPixel(cx - 13 + fSwing, groundY, GUSTAVE_HIDE.clawDark);
      // Far back leg
      sub.drawLine(cx + 8, cy + 3, cx + 9 + bSwing, groundY, GUSTAVE_HIDE.scuteDeep, 3);
      sub.fillRect(cx + 7 + bSwing, groundY - 1, 4, 2, GUSTAVE_HIDE.hideDark);
      sub.setPixel(cx + 6 + bSwing, groundY, GUSTAVE_HIDE.clawDark);
    });
  }

  // 2. Massive laterally compressed undulating tail with twin dorsal scute crests
  croc.layer((sub) => {
    for (let i = 0; i < 16; i++) {
      const tp = i / 15;
      const tx = Math.min(59, cx + 10 + Math.round(tp * 19));
      const waveAmp = (mode === 'swim' ? 2.4 : 1.4) + tp * 2.2 + Math.abs(rollAngle) * 2.0;
      const ty = Math.min(
        32,
        Math.max(6, Math.round(cy + 1 + tp * 2.2 + Math.sin(t - i * 0.42) * waveAmp))
      );
      const radY = Math.max(1.0, 3.8 * (1 - tp * 0.72));
      const radX = Math.max(1.2, 2.2 * (1 - tp * 0.4));
      sub.fillEllipse(tx, ty, radX, radY, (nx, ny) => {
        if (ny > 0.45 && tp < 0.7) return GUSTAVE_HIDE.bellyShade;
        if (ny < -0.35) return i % 2 === 0 ? GUSTAVE_HIDE.scuteRidge : GUSTAVE_HIDE.hideLight;
        return tp > 0.6 ? GUSTAVE_HIDE.scuteDeep : GUSTAVE_HIDE.hideDark;
      });
      // Raised jagged vertical scute fins along tail crest
      if (i % 2 === 0 && i < 13 && ty > 5) {
        const notch = i === 6; // Battle-damaged scute notch!
        sub.setPixel(
          tx,
          Math.max(4, Math.round(ty - radY - (notch ? 0 : 1))),
          notch ? GUSTAVE_HIDE.scarPink : GUSTAVE_HIDE.scuteRidge
        );
      }
    }
  });

  // 3. Broad, armored, battle-scarred crocodile torso + ribbed cream belly + death-roll twist
  croc.layer((sub) => {
    const rollShift = rollAngle * 0.85;
    sub.fillEllipse(cx, cy, 12.5, 5.8, (nx, ny, px, py) => {
      const rolledNy = ny + rollShift;
      // During death roll, pale cream ventral ribs rotate clearly into view!
      if (rolledNy > 0.36 || rolledNy < -0.88) {
        return (px + py) % 3 === 0 ? GUSTAVE_HIDE.bellyShade : GUSTAVE_HIDE.bellyCream;
      }
      // Osteoderm dorsal armor scute pattern
      const isScute = ny < -0.25 && Math.abs(px % 3) <= 1;
      if (ny < -0.52) return isScute ? GUSTAVE_HIDE.scuteRidge : GUSTAVE_HIDE.hideLight;
      if (ny > 0.2 || nx > 0.5) return GUSTAVE_HIDE.scuteDeep;
      return (px + py) % 4 === 0 ? GUSTAVE_HIDE.hideDark : GUSTAVE_HIDE.hideMid;
    });

    // Armored dorsal scute spine bumps along back
    if (Math.abs(rollAngle) < 0.55) {
      for (let sx = cx - 9; sx <= cx + 9; sx += 3) {
        sub.fillRect(sx, cy - 6, 2, 1, GUSTAVE_HIDE.scuteRidge);
        sub.setPixel(sx + 1, cy - 5, GUSTAVE_HIDE.hideDark);
      }
    }

    // Gustave's iconic healed bullet & battle scars across flank/shoulder!
    sub.drawLine(cx - 5, cy - 2, cx - 2, cy + 1, GUSTAVE_HIDE.scarPink, 1);
    sub.setPixel(cx - 4, cy - 2, GUSTAVE_HIDE.scarPale);
    sub.drawLine(cx + 2, cy - 1, cx + 6, cy - 3, GUSTAVE_HIDE.scarPink, 1);
    sub.setPixel(cx + 4, cy - 2, GUSTAVE_HIDE.scarPale);

    // K1/K2 Faction war-paint collar/totem accents on shoulder armor (supports kingdom recolor)
    sub.drawLine(cx - 9, cy - 3, cx - 8, cy + 2, RAMPS.magenta.mid, 1);
    sub.setPixel(cx - 9, cy - 4, RAMPS.magenta.highlight);
    sub.setPixel(cx - 7, cy - 1, RAMPS.cyanMask.highlight);
    sub.setPixel(cx - 4, cy - 4, RAMPS.cyanMask.mid);
  });

  // 4. Colossal crocodilian skull, piercing golden slit eye & hinged tooth-studded jaws
  const headX = Math.max(13, cx - 14);
  const headY = cy - 1 - (jawOpen > 2 ? 1 : 0);
  croc.layer((sub) => {
    // Heavy armored cranium behind eye
    sub.fillEllipse(headX + 2, headY - 1, 5.2, 3.8, (nx, ny) =>
      ny < -0.3 ? GUSTAVE_HIDE.hideLight : nx > 0.35 ? GUSTAVE_HIDE.hideDark : GUSTAVE_HIDE.hideMid
    );
    // Raised supraorbital brow ridge + piercing golden crocodile eye with vertical slit
    sub.fillRect(headX - 1, headY - 5, 4, 2, GUSTAVE_HIDE.scuteRidge);
    sub.setPixel(headX, headY - 4, GUSTAVE_HIDE.eyeGold);
    sub.setPixel(headX + 1, headY - 4, GUSTAVE_HIDE.eyeSlit);
    sub.setPixel(headX + 2, headY - 4, GUSTAVE_HIDE.eyeGold);
    // K1 brow war-crest & K2 rune dot
    sub.setPixel(headX + 3, headY - 4, RAMPS.magenta.mid);
    sub.setPixel(headX + 4, headY - 3, RAMPS.cyanMask.highlight);

    // Long heavy U-shaped upper snout extending left
    sub.fillRect(headX - 10, headY - 1, 11, 3, GUSTAVE_HIDE.hideMid);
    sub.fillRect(headX - 9, headY - 2, 8, 1, GUSTAVE_HIDE.hideLight);
    // Elevated snout-tip nostril bump
    sub.fillRect(headX - 10, headY - 3, 2, 2, GUSTAVE_HIDE.scuteRidge);
    sub.setPixel(headX - 10, headY - 3, GUSTAVE_HIDE.scuteDeep);
    // Famous snout battle scar across nose bridge
    sub.drawLine(headX - 7, headY - 2, headX - 5, headY, GUSTAVE_HIDE.scarPink, 1);

    // Open mouth interior when gaping
    const drop = Math.max(0, jawOpen);
    if (drop > 0) {
      sub.fillRect(headX - 9, headY + 2, 10, drop + 1, GUSTAVE_HIDE.jawMouth);
    }

    // Articulated heavy lower jaw (cream chin underside + armored dark jawline)
    const lowerJawY = headY + 2 + drop;
    sub.fillRect(headX - 9, lowerJawY, 11, 2, GUSTAVE_HIDE.hideDark);
    sub.fillRect(headX - 8, lowerJawY + 2, 9, 1, GUSTAVE_HIDE.bellyShade);

    // Interlocking jagged conical crocodile teeth (upper protruding down, lower 4th fang sticking up!)
    for (const tx of [-9, -7, -5, -3, -1]) {
      sub.setPixel(headX + tx, headY + 2, tx === -7 ? GUSTAVE_HIDE.toothIvory : GUSTAVE_HIDE.toothOld);
    }
    if (drop >= 2) {
      for (const tx of [-8, -6, -4, -2]) {
        sub.setPixel(headX + tx, lowerJawY - 1, GUSTAVE_HIDE.toothIvory);
      }
    } else {
      // Iconic overlapping 4th mandibular tooth jutting visibly even with closed jaws!
      sub.setPixel(headX - 8, headY + 1, GUSTAVE_HIDE.toothIvory);
      sub.setPixel(headX - 4, headY + 2, GUSTAVE_HIDE.toothIvory);
    }
  });

  // 5. Near sprawling clawed limbs (or swept sleekly along belly in swim mode)
  croc.layer((sub) => {
    if (mode === 'swim') {
      sub.drawLine(cx - 7, cy + 3, cx - 2, cy + 5, GUSTAVE_HIDE.hideDark, 2);
      sub.drawLine(cx + 8, cy + 3, cx + 13, cy + 5, GUSTAVE_HIDE.hideDark, 2);
      sub.setPixel(cx - 1, cy + 5, GUSTAVE_HIDE.clawDark);
      sub.setPixel(cx + 14, cy + 5, GUSTAVE_HIDE.clawDark);
    } else {
      const fStep = Math.round(stride * 2.5);
      const bStep = Math.round(-stride * 2.5);
      // Near front sprawling leg + 3 webbed claws
      sub.drawLine(cx - 7, cy + 2, cx - 8 + fStep, groundY, GUSTAVE_HIDE.hideMid, 3);
      sub.fillRect(cx - 11 + fStep, groundY - 1, 5, 2, GUSTAVE_HIDE.hideDark);
      sub.setPixel(cx - 12 + fStep, groundY, GUSTAVE_HIDE.clawDark);
      sub.setPixel(cx - 9 + fStep, groundY + 1, GUSTAVE_HIDE.clawDark);
      // Near rear muscular haunch & clawed foot
      sub.drawLine(cx + 9, cy + 2, cx + 10 + bStep, groundY, GUSTAVE_HIDE.hideMid, 3);
      sub.fillRect(cx + 7 + bStep, groundY - 1, 5, 2, GUSTAVE_HIDE.hideDark);
      sub.setPixel(cx + 6 + bStep, groundY, GUSTAVE_HIDE.clawDark);
    }
  });

  // 6. Attack VFX: Jaw Crunch Star & Death Roll Water/Dust Spray
  if (biteFlash) {
    const bx = Math.max(2, headX - 11);
    const by = headY + 1;
    croc.setPixel(bx, by, '#FFFFFF');
    croc.setPixel(bx - 1, by - 2, '#FFF2A6');
    croc.setPixel(bx + 1, by - 2, '#FFF2A6');
    croc.setPixel(bx - 2, by + 2, '#FF7B24');
    croc.setPixel(bx + 1, by + 2, '#FF7B24');
  }
  if (isAtk && p >= 0.55 && p < 0.85) {
    // Swirling splash/spray rings whipping around Gustave during Death Roll
    const rp = (p - 0.55) / 0.3;
    for (let i = 0; i < 6; i++) {
      const ang = rp * Math.PI * 4 + i * 1.05;
      const sx = Math.max(3, Math.min(60, Math.round(cx - 2 + Math.cos(ang) * 12)));
      const sy = Math.max(3, Math.min(33, Math.round(cy + Math.sin(ang) * 7)));
      croc.setPixel(sx, sy, i % 2 === 0 ? '#FFFFFFCC' : WATER_LINE.light);
    }
  }

  // Submerged aquatic shading in swim mode
  if (mode === 'swim') {
    const waterY = 23;
    for (let y = waterY + 1; y < croc.height; y++) {
      for (let x = 0; x < croc.width; x++) {
        if (croc.getPixel(x, y) !== null) {
          croc.setPixel(x, y, y > waterY + 2 ? RAMPS.ice.deep : '#1B4965AA');
        }
      }
    }
  }

  const out =
    action === 'attack' || action === 'normal'
      ? croc
      : applyCreatureAction(croc, frame, total, 31, groundY, 7, 19, action);

  if (mode === 'swim') {
    drawSwimWaterline(out, 6, 59, 23, frame);
  } else if (action !== 'death') {
    applyCreatureShadow(out, 31, groundY + 1, 34, ctx);
  }

  const buf = new PixelBuffer(64, 36);
  buf.composite(out);
  return buf;
}

/**
 * 10. War Galleon Flagship (42x42, Tier II, 12f)
 */
function renderWarGalleon(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const buf = new PixelBuffer(42, 42);
  const t = (frame / Math.max(1, total)) * Math.PI * 2;
  const bob = Math.round(Math.sin(t) * 1.1);
  const action: UnitAction = ctx?.unitAction ?? 'normal';

  drawSwimWaterline(buf, 6, 35, 33, frame);

  const shipLayer = new PixelBuffer(42, 42);
  for (let y = 25 + bob; y <= 32 + bob; y++) {
    const progress = (y - (25 + bob)) / 7;
    const leftX = Math.round(8 + progress * 4.5);
    const rightX = Math.round(34 - progress * 2.5);
    for (let x = leftX; x <= rightX; x++) {
      const isGunwale = y === 25 + bob;
      const isKeel = y >= 31 + bob;
      const isPort = y === 28 + bob && (x === 15 || x === 20 || x === 25);
      const plank = (x + y) % 5 === 0;
      const c = isPort
        ? RAMPS.obsidian.deep
        : isKeel
          ? RAMPS.timber.deep
          : isGunwale
            ? RAMPS.timber.highlight
            : x > 26
              ? RAMPS.timber.shadow
              : plank
                ? RAMPS.timber.shadow
                : RAMPS.timber.mid;
      shipLayer.setPixel(x, y, c);
    }
  }
  shipLayer.fillRect(26, 21 + bob, 8, 5, RAMPS.timber.mid);
  shipLayer.fillRect(26, 21 + bob, 8, 1, RAMPS.gold.highlight);
  shipLayer.fillRect(28, 23 + bob, 3, 2, RAMPS.cyanMask.highlight);
  shipLayer.fillRect(34, 22 + bob, 2, 2, RAMPS.gold.highlight);
  shipLayer.fillRect(5, 24 + bob, 4, 2, RAMPS.bone.highlight);

  shipLayer.drawLine(19, 6 + bob, 19, 26 + bob, RAMPS.timber.highlight);
  shipLayer.drawLine(28, 11 + bob, 28, 22 + bob, RAMPS.timber.mid);

  const billow = Math.round(Math.sin(t) * 0.9);
  for (let y = 13 + bob; y <= 23 + bob; y++) {
    const curve = y >= 15 + bob && y <= 21 + bob ? -1 : 0;
    for (let x = 12 + curve; x <= 25 + billow; x++) {
      const isCross = x === 18 || y === 18 + bob;
      const isRightShade = x > 22;
      const isLeftLit = x < 15;
      shipLayer.setPixel(
        x,
        y,
        isCross
          ? isRightShade
            ? RAMPS.sail.shadow
            : RAMPS.sail.highlight
          : isLeftLit
            ? RAMPS.magenta.highlight
            : isRightShade
              ? RAMPS.magenta.shadow
              : RAMPS.magenta.mid
      );
    }
  }
  for (let y = 8 + bob; y <= 12 + bob; y++) {
    for (let x = 14; x <= 22 + billow; x++) {
      shipLayer.setPixel(
        x,
        y,
        x < 17 ? RAMPS.magenta.highlight : x > 20 ? RAMPS.magenta.shadow : RAMPS.magenta.mid
      );
    }
  }

  for (let i = 0; i < 7; i++) {
    const wy = 6 + bob + Math.round(Math.sin(t * 2 - i * 0.75) * 0.7);
    shipLayer.setPixel(19 + i, wy, i < 4 ? RAMPS.cyanMask.highlight : RAMPS.cyanMask.mid);
  }

  const out = applyCreatureAction(shipLayer, frame, total, 21, 32, 6, 24, action);
  buf.composite(out);
  return buf;
}

/**
 * 11. Heavy Siege Trebuchet (42x42, Tier III, 16f)
 */
function renderSiegeCatapult(
  frame: number,
  total: number,
  ctx?: RenderContextOptions
): PixelBuffer {
  const buf = new PixelBuffer(42, 42);
  const phase = frame / Math.max(1, total);
  const t = phase * Math.PI * 2;
  const action: UnitAction = ctx?.unitAction ?? 'normal';
  const mode: UnitMode = ctx?.unitMode ?? 'walk';

  const mech = new PixelBuffer(42, 42);
  mech.fillRect(9, 28, 24, 4, RAMPS.timber.mid);
  mech.fillRect(9, 28, 19, 1, RAMPS.timber.highlight);
  mech.drawLine(13, 28, 20, 15, RAMPS.timber.highlight, 2);
  mech.drawLine(29, 28, 21, 15, RAMPS.timber.shadow, 2);

  mech.fillRect(16, 21, 9, 7, RAMPS.magenta.mid);
  mech.fillRect(16, 21, 3, 6, RAMPS.magenta.highlight);
  mech.fillRect(23, 21, 2, 7, RAMPS.magenta.deep);
  mech.fillRect(19, 23, 3, 3, RAMPS.cyanMask.highlight);

  const fireCurve =
    phase < 0.3 ? Math.sin((phase / 0.3) * (Math.PI / 2)) : 1 - (phase - 0.3) / 0.7;
  const armAngle = 0.75 - fireCurve * 1.9;
  const armLen = 13;
  const tipX = Math.round(20 - Math.cos(armAngle) * armLen);
  const tipY = Math.round(15 - Math.sin(armAngle) * armLen);
  mech.drawLine(20, 15, tipX, tipY, RAMPS.timber.highlight, 2);
  mech.fillEllipse(tipX, tipY, 2, 2, RAMPS.slate.mid);

  const cwX = Math.round(20 + Math.cos(armAngle) * 5);
  const cwY = Math.round(15 + Math.sin(armAngle) * 5);
  mech.fillRect(cwX - 2, cwY, 4, 4, RAMPS.obsidian.mid);
  mech.fillRect(cwX - 2, cwY, 2, 1, RAMPS.gold.highlight);

  if (phase >= 0.14 && phase <= 0.68) {
    const p = (phase - 0.14) / 0.54;
    const px = Math.round(15 - p * 12);
    const py = Math.round(5 + Math.pow(p - 0.42, 2) * 16);
    mech.fillRect(px, py, 3, 3, RAMPS.lava.highlight);
    mech.fillRect(px + 1, py + 1, 2, 2, RAMPS.slate.highlight);
  }

  for (const wx of [13, 29]) {
    mech.fillEllipse(wx, 32, 3.8, 3.8, (nx, ny) => {
      const r2 = nx * nx + ny * ny;
      if (r2 < 0.18) return RAMPS.gold.mid;
      if (r2 > 0.55) return RAMPS.slate.mid;
      return RAMPS.timber.deep;
    });
    const spoke = Math.round(Math.cos(t) * 2.5);
    mech.setPixel(wx + spoke, 32, RAMPS.timber.highlight);
    mech.setPixel(wx, 32 + (spoke === 0 ? 2 : -2), RAMPS.timber.highlight);
  }

  const out = applyCreatureAction(mech, frame, total, 21, 34, 7, 25, action);
  if (mode === 'swim') {
    drawSwimWaterline(out, 7, 34, 33, frame);
  } else if (action !== 'death') {
    applyCreatureShadow(out, 21, 36, 21, ctx);
  }

  buf.composite(out);
  return buf;
}

export const CREATURE_MODELS: PixelModelDef[] = [
  {
    id: 'slime-cube',
    name: 'Алхимический Слизень',
    subtitle: 'Прыгучий гелевый купол с реликвией',
    kind: 'unit',
    tier: 'I',
    faction: 'Лесной Круг',
    width: 28,
    height: 26,
    frameCount: 12,
    defaultFps: 11,
    unitMeta: {
      coreSize: '15×13 слизь',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 13,
    },
    layersSpec: [
      '0. Тень unitShadow_11 под прыжковым циклом',
      '1. Купол полупрозрачного геля K1 с ложноножками и бликом стекла',
      '2. Взвешенный костяной череп и ядро K2 внутри',
      '3. Поддержка водной поверхности WATER_LINE в режиме swim',
    ],
    description:
      'Существо уровня I: объёмный алхимический слизень с просвечивающим черепом-реликвией, кристальным ядром K2, пузырьками и циклом упругого сжатия.',
    renderFrame: renderSlimeCube,
    codeSnippet: `function renderSlimeCube(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  // Translucent sculpted K1 dome + internal bone skull & K2 shard + rising bubbles
  return renderSlimeCubeImpl(frame, total, ctx);
}`,
  },
  {
    id: 'dire-wolf',
    name: 'Лютый Волк',
    subtitle: 'Четырёхлапый хищник с бронепопоной',
    kind: 'unit',
    tier: 'I',
    faction: 'Орда',
    width: 34,
    height: 28,
    frameCount: 12,
    defaultFps: 12,
    unitMeta: {
      coreSize: '23×15 зверь',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 15,
    },
    layersSpec: [
      '0. Вытянутая тень unitShadow_13 под лапами',
      '1. Передние и задние сочленённые лапы с фазой галопа и когтями',
      '2. Мускулистый корпус, мохнатый загривок, оскаленная пасть и клыки',
      '3. Боевая попона K1/K2 с золотой пряжкой и режим плавания',
    ],
    description:
      'Зверь уровня I для Орды: скульптурный силуэт волка с косматой гривой, оскалом, боевой сбруей державы и 12-кадровым галопом.',
    renderFrame: renderDireWolf,
    codeSnippet: `function renderDireWolf(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  // Sculpted wolf musculature + 4 articulated legs + fanged snout + K1/K2 harness
  return renderDireWolfImpl(frame, total, ctx);
}`,
  },
  {
    id: 'iron-golem',
    name: 'Рунический Голем',
    subtitle: 'Тяжёлый титан (ядро 30×28)',
    kind: 'unit',
    tier: 'II',
    faction: 'Цитадель',
    width: 30,
    height: 28,
    frameCount: 12,
    defaultFps: 8,
    unitMeta: {
      coreSize: '15×17 ядро',
      usesSkinMask: true,
      defaultPhenotype: 'skin_light',
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 11,
    },
    layersSpec: [
      '0. Расширенная тень unitShadow_9 (11px)',
      '1. Массивный каменный торс с рунами K1/K2',
      '2. Рогатый монолитный шлем head_golem',
      '3. Рунный молот w_hammer_runic в маркере руки',
    ],
    description:
      'Конструкт уровня II увеличенного масштаба (30×28 px): демонстрирует масштабирование модульного пайплайна для тяжёлых юнитов.',
    renderFrame: (f, tot, ctx) => renderUnitFromSpec(GOLEM_SPEC, f, tot, ctx).buffer,
    getAnchors: (f, tot, ctx) => renderUnitFromSpec(GOLEM_SPEC, f, tot, ctx).anchors,
    codeSnippet: `function renderIronGolem(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  return assembleModularUnitFrame(GOLEM_SPEC, frame, total, ctx?.unitMode ?? 'walk', ctx?.unitAction ?? 'normal').buffer;
}`,
  },
  {
    id: 'forest-treant',
    name: 'Древень-Хранитель',
    subtitle: 'Узловатый дуб с рунным дуплом (38×38)',
    kind: 'unit',
    tier: 'II',
    faction: 'Лесной Круг',
    width: 38,
    height: 38,
    frameCount: 12,
    defaultFps: 9,
    unitMeta: {
      coreSize: '24×28 титан',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 15,
    },
    layersSpec: [
      '0. Тень под раскидистыми корнями',
      '1. Бороздчатый ствол с мхом, янтарными глазами и светящимся дуплом K2',
      '2. Трёхдольная покачивающаяся крона с цветами K1 и лианой',
      '3. Кривые ветви-руки с когтями и тяжёлая поступь корней',
    ],
    description:
      'Лесной хранитель уровня II (38×38 px): рельефный узловатый ствол с бороздами коры, светящимся рунным дуплом, мшистыми наплечниками и пышной кроной.',
    renderFrame: renderForestTreant,
    codeSnippet: `function renderForestTreant(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  // Furrowed oak trunk + glowing K2 hollow + 3-lobe moss/K1 canopy + crooked boughs
  return renderForestTreantImpl(frame, total, ctx);
}`,
  },
  {
    id: 'crystal-elemental',
    name: 'Элементаль Кристалла',
    subtitle: 'Огранённый дух маны с нимбом (34×36)',
    kind: 'unit',
    tier: 'II',
    faction: 'Цитадель',
    width: 34,
    height: 36,
    frameCount: 12,
    defaultFps: 10,
    unitMeta: {
      coreSize: '22×26 призма',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 12,
    },
    layersSpec: [
      '0. Фиксированная тень парения под кристаллом',
      '1. Вращающееся рунное кольцо-нимб и парящие осколки шлейфа',
      '2. Огранённый торс K1 с белым/бирюзовым ядром K2 и короной шпилей',
      '3. Парные левитирующие кулаки-кристаллы в противофазе',
    ],
    description:
      'Магический элементаль уровня II (34×36 px): коронованная призма с вращающимся нимбом рун, левитирующими осколками и кристальными перчатками.',
    renderFrame: renderCrystalElemental,
    codeSnippet: `function renderCrystalElemental(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  // Crowned crystal torso + rotating rune halo + orbiting crystal gauntlets
  return renderCrystalElementalImpl(frame, total, ctx);
}`,
  },
  {
    id: 'frost-yeti',
    name: 'Ледяной Йети',
    subtitle: 'Косматый зверь с ледяными шипами (36×36)',
    kind: 'unit',
    tier: 'II',
    faction: 'Бастион Мороза',
    width: 36,
    height: 36,
    frameCount: 12,
    defaultFps: 9,
    unitMeta: {
      coreSize: '24×26 зверь',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 16,
    },
    layersSpec: [
      '0. Тень тяжёлой поступи unitShadow_14',
      '1. Рельефная косматая шерсть, изогнутые рога и клыкастая пасть',
      '2. Ледяные кристаллы на плече и боевой пояс с наручами K1/K2',
      '3. Могучие когтистые лапы и шаг по снегу или воде',
    ],
    description:
      'Ледниковый гигант уровня II (36×36 px): косматый мех со ступенчатой текстурой, изогнутые мамонтовые рога, наплечные глыбы льда и мощные удары лап.',
    renderFrame: renderFrostYeti,
    codeSnippet: `function renderFrostYeti(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  // Shaggy snow-fur beast + mammoth horns + glacier spikes + K1/K2 war belt
  return renderFrostYetiImpl(frame, total, ctx);
}`,
  },
  {
    id: 'bone-wyvern',
    name: 'Костяная Виверна',
    subtitle: 'Летучий зверь с гребенчатым крылом (38×34)',
    kind: 'unit',
    tier: 'II',
    faction: 'Некрополь',
    width: 38,
    height: 34,
    frameCount: 12,
    defaultFps: 12,
    unitMeta: {
      coreSize: '26×21 полёт',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 13,
    },
    layersSpec: [
      '0. Парящая тень на земле (не поднимается со взмахом)',
      '1. Череп дракона, ребристая грудь, когти и хвост с жалом K1',
      '2. Двухплановые костяные крылья с фестончатой перепонкой K1',
      '3. Броненагрудник с вторичной маской K2',
    ],
    description:
      'Летающее существо уровня II (38×34 px): двукрылый костяной ящер с сочленёнными пальцами крыла, фестончатой перепонкой и жалом на хвосте.',
    renderFrame: renderBoneWyvern,
    codeSnippet: `function renderBoneWyvern(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  // Dual-depth scalloped K1 wing + articulated ribs + dragon skull + tail stinger
  return renderBoneWyvernImpl(frame, total, ctx);
}`,
  },
  {
    id: 'mech-spider',
    name: 'Паровой Паук-Бот',
    subtitle: 'Шестилапый дрон Гильдии с котлом (38×32)',
    kind: 'unit',
    tier: 'II',
    faction: 'Гильдия',
    width: 38,
    height: 32,
    frameCount: 12,
    defaultFps: 12,
    unitMeta: {
      coreSize: '26×20 дрон',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 17,
    },
    layersSpec: [
      '0. Широкая тень под шасси арахнида',
      '1. Латунный котёл с дымящей трубой и эмалевым панцирем K1',
      '2. Вращающийся радар K2, окуляр и медные мандибулы',
      '3. 6 двусуставных лап с коленными шарнирами и трёхточечной походкой',
    ],
    description:
      'Паровой автоматон уровня II (38×32 px): клёпаный латунный корпус с топкой, дымящейся трубой, вращающимся радаром K2 и шестью сочленёнными лапами.',
    renderFrame: renderMechSpider,
    codeSnippet: `function renderMechSpider(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  // Riveted brass boiler + puffing smokestack + K1 dome + 6 multi-jointed legs
  return renderMechSpiderImpl(frame, total, ctx);
}`,
  },
  {
    id: 'magma-colossus',
    name: 'Магматический Колосс',
    subtitle: 'Вулканический великан с горном (40×40)',
    kind: 'unit',
    tier: 'III',
    faction: 'Кузня Пекла',
    width: 40,
    height: 40,
    frameCount: 16,
    defaultFps: 9,
    unitMeta: {
      coreSize: '28×28 босс',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 18,
    },
    layersSpec: [
      '0. Массивная тень 18px под базальтовыми ногами',
      '1. Обсидиановая броня с пульсирующим горном и трещинами магмы',
      '2. Шипастые наплечники с каналами K1 и K2 + огненные рога',
      '3. Раскалённые каменные кулаки и тяжёлая поступь титана',
    ],
    description:
      'Вулканический титан уровня III (40×40 px, 16 к.): светящееся белое ядро печи в груди, обсидиановые пики на плечах, огненные рога и каменные кулаки.',
    renderFrame: renderMagmaColossus,
    codeSnippet: `function renderMagmaColossus(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  // Furnace chest core + obsidian shoulder spikes + K1/K2 pauldrons + magma fists
  return renderMagmaColossusImpl(frame, total, ctx);
}`,
  },
  {
    id: 'elder-dragon',
    name: 'Древний Дракон',
    subtitle: 'Крылатый босс-титан (48×42, 16 к.)',
    kind: 'unit',
    tier: 'III',
    faction: 'Кузня Пекла',
    width: 48,
    height: 42,
    frameCount: 16,
    defaultFps: 11,
    unitMeta: {
      coreSize: '40×31 босс',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 19,
    },
    layersSpec: [
      '0. Тень парения 19px на уровне земли',
      '1. Дальнее крыло (K1 deep) и мускулистый хвост с костяными шипами',
      '2. Чешуйчатый корпус, золотые щитки брюха, клыки и изогнутые рога',
      '3. Многопалое крыло K1 с фестонами и огненные искры дыхания',
    ],
    description:
      'Верховный босс уровня III (48×42 px, 16 к.): анатомический крылатый дракон с золотой чешуёй брюха, гребнем на спине, двуплановыми крыльями и огненным дыханием.',
    renderFrame: renderElderDragon,
    codeSnippet: `function renderElderDragon(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  // Anatomical 48x42 winged dragon + dual scalloped K1 wings + gold belly scales + embers
  return renderElderDragonImpl(frame, total, ctx);
}`,
  },
  {
    id: 'distortus-rex',
    name: 'Дистортус Рекс',
    subtitle: 'Шестилапый гориллоподобный титан с куполом лба (68×56)',
    kind: 'unit',
    tier: 'III',
    faction: 'Орда',
    width: 68,
    height: 56,
    frameCount: 20,
    defaultFps: 10,
    attackName: 'Рёв на задних лапах, сокрушение и захват пастью',
    unitMeta: {
      coreSize: '64×50 титан',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 32,
    },
    layersSpec: [
      '0. Адаптивная мягкая тень под фалангами передних рук и тремя пальцами стоп',
      '1. Дальняя рука с чёрными когтями, полусогнутая нога с пяточным отростком и безвольный хвост',
      '2. Гладкий купол лба без шипов, плоская безгубая пасть с дёснами, оранжевые глаза и складки шеи',
      '3. Пара тонких двупалых грудных лапок в центре груди и оливково-бурая пятнистая шкура',
      '4. 4-фазный бой: подъём с рёвом → удар кулаками сверху вниз → захват, осмотр и перекус челюстями',
    ],
    description:
      'Титанический шестилапый мутант (68×56 px, 20 к.): сутулая осанка гориллы со спиной под 45° от мощной холки к низкому тазу, гладкий бледно-жёлтый купол лба над плоским лицом без морды, глубокие складки шеи, розовато-рыжий живот, оливково-бурые пятна, короткий опущенный хвост и 4-фазная атака с захватом жертвы.',
    renderFrame: renderDistortusRex,
    getAnchors: getDistortusRexAnchors,
    codeSnippet: `function renderDistortusRex(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  // 68x56 45-deg gorilla-sloped 6-limbed D-Rex + smooth pale-yellow dome + lipless crooked jaws + 4-phase grab-bite
  return renderDistortusRexImpl(frame, total, ctx);
}`,
  },
  {
    id: 'tyrannosaurus-rex',
    name: 'Тираннозавр Рекс',
    subtitle: 'Высший двуногий хищник мезозоя (68×52)',
    kind: 'unit',
    tier: 'III',
    faction: 'Орда',
    width: 68,
    height: 52,
    frameCount: 16,
    defaultFps: 11,
    attackName: 'Выпад с сокрушительным укусом и победным рёвом',
    unitMeta: {
      coreSize: '60×42 титан',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 28,
    },
    layersSpec: [
      '0. Адаптивная мягкая тень под трёхпалыми лапами хищника',
      '1. Дальняя нога, длинный противовесный тигровый хвост и вторая крошечная двупалая лапка',
      '2. Горизонтальный мускулистый корпус, S-изогнутая шея и массивный коробчатый череп с гребнями и пастью',
      '3. Знаковые крошечные передние лапы, мощные пальцеходящие задние ноги и боевой ремень K1/K2',
      '4. 4-фазная атака: низкий подкрадывающийся выпад → укус с искрами → рёв к небу с ударными кольцами',
    ],
    description:
      'Классический Тираннозавр Рекс уровня III (68×52 px, 16 к.): массивный коробчатый череп с надбровными роговыми гребнями, изогнутые конические клыки, тигровый окрас спины, ребристое светлое брюхо, знаковые крошечные двупалые передние лапки, мощные трёхпалые задние ноги и 4-фазный цикл сокрушительного укуса и рёва.',
    renderFrame: renderTyrannosaurusRex,
    getAnchors: getTRexAnchors,
    codeSnippet: `function renderTyrannosaurusRex(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  // 68x52 bipedal apex theropod + boxy ridged skull + tiny 2-clawed forelimbs + 4-phase ambush bite & roar
  return renderTyrannosaurusRexImpl(frame, total, ctx);
}`,
  },
  {
    id: 'gustave-crocodile',
    name: 'Крокодил Густав',
    subtitle: 'Легендарный бронированный нильский гигант (64×36)',
    kind: 'unit',
    tier: 'III',
    faction: 'Орда',
    width: 64,
    height: 36,
    frameCount: 16,
    defaultFps: 10,
    attackName: 'Бросок челюстей и смертельное вращение',
    unitMeta: {
      coreSize: '58×24 хищник',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 34,
    },
    layersSpec: [
      '0. Адаптивная мягкая тень под приземистым корпусом и растопыренными лапами',
      '1. Массивный гребенчатый хвост с волнообразным изгибом и боевым вырезом',
      '2. Бронированная тёмно-оливковая шкура со старыми пулевыми шрамами, ребристым светлым брюхом и знаками K1/K2',
      '3. Широкая U-образная морда с золотым глазом, торчащими клыками и 4-фазным смертельным вращением',
    ],
    description:
      'Легендарный шестиметровый нильский крокодил уровня III (64×36 px, 16 к.): массивная приземистая пасть со сцепленными зубами и выступающим нижним клыком, зажившие боевые шрамы на морде и боку, двойной гребень щитков на хвосте, боевая раскраска K1/K2, режим плавания и 4-фазная атака «Смертельное вращение».',
    renderFrame: renderGustaveCrocodile,
    getAnchors: getGustaveAnchors,
    codeSnippet: `function renderGustaveCrocodile(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  // 64x36 scarred Nile crocodile + U-snout fangs + dorsal scutes + 4-phase ambush snap & death roll
  return renderGustaveCrocodileImpl(frame, total, ctx);
}`,
  },
  {
    id: 'war-galleon',
    name: 'Фрегат Фракции',
    subtitle: 'Двухмачтовый парусник с флагом',
    kind: 'unit',
    tier: 'II',
    faction: 'Гильдия',
    width: 42,
    height: 42,
    frameCount: 12,
    defaultFps: 8,
    unitMeta: {
      coreSize: '30×28 корабль',
      usesSkinMask: false,
      supportsSwim: false,
      supportsActions: true,
      shadowWidth: 20,
    },
    layersSpec: [
      '0. Водная ватерлиния #D1E3EB / #D5E2EA с бегущей рябью',
      '1. Дубовый корпус с пушечными портами и ютом',
      '2. Надутый прямой парус K1 и марсель с тенью справа',
      '3. Волнообразный вымпел K2 на грот-мачте и носовой бушприт',
    ],
    description:
      'Боевой фрегат уровня II: дубовый корпус с бортовыми портами, кормовой надстройкой и перекрашиваемыми парусами K1/K2 на живой волне.',
    renderFrame: renderWarGalleon,
    codeSnippet: `function renderWarGalleon(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  // Oak hull + cannon ports + billowing K1 sails + K2 pennant + ocean wake
  return renderWarGalleonImpl(frame, total, ctx);
}`,
  },
  {
    id: 'siege-catapult',
    name: 'Осадный Требушет',
    subtitle: 'Колёсная метательная машина (16 к.)',
    kind: 'unit',
    tier: 'III',
    faction: 'Гильдия',
    width: 42,
    height: 42,
    frameCount: 16,
    defaultFps: 10,
    unitMeta: {
      coreSize: '26×24 машина',
      usesSkinMask: false,
      supportsSwim: true,
      supportsActions: true,
      shadowWidth: 21,
    },
    layersSpec: [
      '0. Тень 21px под колёсной рамой',
      '1. Дубовая А-опора, железный щиток K1 и герб K2',
      '2. Качающийся рычаг с противовесом и спицы колёс',
      '3. Баллистическая дуга огненного снаряда в фазе выстрела',
    ],
    description:
      'Осадная машина уровня III (16 кадров): сочленённый рычаг с противовесом, гербовый щит державы и параболический полёт раскалённого снаряда.',
    renderFrame: renderSiegeCatapult,
    codeSnippet: `function renderSiegeCatapult(frame: number, total: number, ctx?: RenderContextOptions): PixelBuffer {
  // Wheeled A-frame + counterweight lever + parabolic fireball arc
  return renderSiegeCatapultImpl(frame, total, ctx);
}`,
  },
];
